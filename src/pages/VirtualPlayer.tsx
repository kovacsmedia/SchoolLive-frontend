// src/pages/VirtualPlayer.tsx
//
// PLAYER-felhasználó webplayere — a tenant snap-portjához kapcsolódik
// WebSocket-en keresztül (backend `/snap-stream` proxy → loopback TCP →
// snapserver), és onnan kapja a hangot ugyanolyan szinkronnal, mint az
// Android/Linux/Windows kliensek.
//
// Audio: kizárólag snap-streamből (BELL/TTS/RADIO mixer keveri, mi csak
//         dekódolunk + ütemezünk Web Audio API-val). Nincs HTTP-play.
// HUD:   a SyncEngine `/sync` WS-üzeneteiből vezérelve (NOW_PLAYING_INFO,
//         BELL/TTS/PLAY_URL/STOP_PLAYBACK action). A kliens NEM játszik le
//         maga audio-asset URL-eket – csak a vizuális overlay-t mutatja.

import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch } from "../lib/api";
import { SnapWsClient } from "../lib/snapWsClient";

// ─── Típusok ──────────────────────────────────────────────────────────────────
type PlayerStatus = "registering" | "pending" | "active";
type BellEntry    = { hour: number; minute: number; type: string; soundFile: string };
type HudKind      = "idle" | "bell" | "tts" | "radio";
interface HudState {
  kind:    HudKind;
  title?:  string;
  text?:   string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getOrCreateClientId(): string {
  const KEY = "vpClientId";
  let id = localStorage.getItem(KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(KEY, id); }
  return id;
}
async function getPublicIp(): Promise<string> {
  try {
    const r = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(4000) });
    return (await r.json()).ip ?? "";
  } catch { return ""; }
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}
function nextBellLabel(bells: BellEntry[]): string | null {
  const now    = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const next = bells
    .map(b => ({ ...b, bellSec: b.hour * 3600 + b.minute * 60 }))
    .filter(b => b.bellSec >= nowSec - 10)
    .sort((a, b) => a.bellSec - b.bellSec)[0];
  if (!next) return null;
  return `${String(next.hour).padStart(2,"0")}:${String(next.minute).padStart(2,"0")}`;
}
function calcReadingMs(text: string): number {
  const chars = text.trim().length;
  return Math.max(6000, Math.min(30000, chars * 300));
}
function calcFontSize(text: string): string {
  const len = text.trim().length;
  if (len <= 40)  return "clamp(28px, 5vw, 64px)";
  if (len <= 80)  return "clamp(22px, 4vw, 48px)";
  if (len <= 160) return "clamp(18px, 3vw, 38px)";
  return "clamp(15px, 2.5vw, 28px)";
}

// ─── Konfiguráció ─────────────────────────────────────────────────────────────
const API_BASE        = "https://api.schoollive.hu";
const SYNC_WS_URL     = "wss://api.schoollive.hu/sync";
const SNAP_WS_URL     = "wss://api.schoollive.hu/snap-stream";
const WS_RECONNECT_MS = 3_000;

// ─── Audio context (singleton) ────────────────────────────────────────────────
let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
      latencyHint: "playback",
      sampleRate:  48000,
    });
  }
  return audioCtx;
}

// ─── Frontend slider (0..10) → lineáris gain ──────────────────────────────────
// A backend `sliderToLinearGain` decibel-egyenletes mappingjét tükrözi, hogy
// minden kliens (ESP, Android, Linux, Web) ugyanazt a hallás-szabályosságot
// hozza. 10→0 dB, 1→-36 dB, 0→mute.
function sliderToLinearGain(slider: number): number {
  if (!Number.isFinite(slider) || slider <= 0) return 0;
  if (slider >= 10) return 1;
  const db = (slider - 10) * 4;
  return Math.pow(10, db / 20);
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800;900&family=Noto+Sans:wght@400;700;800;900&display=swap&subset=latin,latin-ext');
  @charset "UTF-8";
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .vp-root {
    width: 100vw; height: 100vh; overflow: hidden;
    background: #07101f; font-family: 'Nunito', 'Noto Sans', 'Segoe UI', Arial, sans-serif;
    color: #f0f6ff; display: flex; flex-direction: column;
    align-items: center; justify-content: center; user-select: none;
  }
  .vp-unlock {
    position: fixed; inset: 0; z-index: 100;
    background: rgba(7,16,31,0.97);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 24px; cursor: pointer;
  }
  .vp-unlock-icon  { font-size: 72px; animation: vp-pulse 2s ease-in-out infinite; }
  .vp-unlock-title { font-size: 24px; font-weight: 900; color: #f0f6ff; }
  .vp-unlock-sub   { font-size: 15px; color: #8da4c0; }
  .vp-unlock-btn {
    padding: 14px 36px; border-radius: 14px; border: none;
    background: linear-gradient(135deg, #3b82f6, #6366f1);
    color: #fff; font-size: 17px; font-weight: 800;
    cursor: pointer; font-family: inherit;
  }
  .vp-pending {
    display: flex; flex-direction: column; align-items: center;
    gap: 20px; padding: 40px; text-align: center; max-width: 500px;
  }
  .vp-pending-icon  { font-size: 64px; animation: vp-pulse 2s ease-in-out infinite; }
  .vp-pending-title { font-size: 26px; font-weight: 900; color: #f0f6ff; }
  .vp-pending-sub   { font-size: 15px; color: #8da4c0; line-height: 1.6; }
  .vp-pending-id {
    background: #0d1b2e; border: 1px solid #1a2d47; border-radius: 12px;
    padding: 12px 20px; font-size: 13px; color: #3b82f6; font-weight: 700;
  }
  .vp-pending-dot {
    width: 10px; height: 10px; border-radius: 50%; background: #f59e0b;
    display: inline-block; margin-right: 8px;
    animation: vp-pulse 1.5s ease-in-out infinite;
  }
  @keyframes vp-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .vp-screen { width: 100%; height: 100%; display: grid; grid-template-rows: auto 1fr auto; }
  .vp-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 36px; background: rgba(13,27,46,0.8); border-bottom: 1px solid #1a2d47;
  }
  .vp-inst-name  { font-size: 18px; font-weight: 900; color: #3b82f6; }
  .vp-online-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; margin-right: 7px; }
  .vp-status-txt { font-size: 12px; color: #4a6280; font-weight: 700; }
  .vp-center {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 12px; padding: 20px; position: relative;
  }
  .vp-clock {
    font-size: clamp(72px,14vw,160px); font-weight: 900; color: #f0f6ff;
    letter-spacing: -4px; line-height: 1;
    text-shadow: 0 0 60px rgba(59,130,246,0.3);
    font-variant-numeric: tabular-nums;
  }
  .vp-date     { font-size: clamp(14px,2vw,22px); color: #8da4c0; font-weight: 700; text-transform: capitalize; }
  .vp-next-bell {
    margin-top: 16px; display: flex; align-items: center; gap: 12px;
    background: rgba(13,27,46,0.7); border: 1px solid #1a2d47;
    border-radius: 16px; padding: 12px 24px;
  }
  .vp-bell-icon  { font-size: 22px; }
  .vp-bell-label { font-size: 14px; color: #8da4c0; font-weight: 700; }
  .vp-bell-time  { font-size: 22px; font-weight: 900; color: #f0f6ff; margin-left: 4px; }
  .vp-msg-overlay {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: rgba(7,16,31,0.95); backdrop-filter: blur(12px);
    gap: 24px; padding: 48px;
    animation: vp-fadein 0.35s ease; z-index: 10;
  }
  @keyframes vp-fadein  { from{opacity:0;transform:scale(0.97)} to{opacity:1;transform:scale(1)} }
  .vp-msg-icon  { font-size: 56px; }
  .vp-msg-title {
    font-size: clamp(18px,3vw,36px); font-weight: 900;
    color: #3b82f6; text-align: center;
    text-shadow: 0 0 30px rgba(59,130,246,0.5);
  }
  .vp-msg-text {
    font-weight: 800; color: #f0f6ff; text-align: center;
    line-height: 1.4; max-width: 85vw;
    text-shadow: 0 2px 12px rgba(0,0,0,0.6);
  }
  .vp-radio-title {
    font-size: clamp(22px,4vw,52px); font-weight: 900;
    color: #3b82f6; text-align: center; letter-spacing: -0.5px;
    text-shadow: 0 0 40px rgba(59,130,246,0.5);
  }
  .vp-footer {
    display: flex; align-items: center; justify-content: center;
    padding: 14px 36px; background: rgba(13,27,46,0.8); border-top: 1px solid #1a2d47;
    gap: 20px; font-size: 12px; color: #4a6280; flex-wrap: wrap;
  }
  .vp-footer-item { display: flex; align-items: center; gap: 6px; }
  .vp-vol-wrap    { display: flex; align-items: center; gap: 8px; }
  .vp-vol-btn {
    width: 30px; height: 30px; border-radius: 8px;
    border: 1px solid #1a2d47; background: transparent;
    color: #8da4c0; font-size: 14px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; transition: all 0.15s;
  }
  .vp-vol-btn:hover { background: #1a2d47; color: #f0f6ff; }
  .vp-vol-val { font-size: 13px; color: #8da4c0; min-width: 24px; text-align: center; }
  .vp-bell-banner {
    position: fixed; top: 0; left: 0; right: 0; z-index: 50;
    background: linear-gradient(90deg, #f59e0b, #f97316);
    color: #fff; font-size: 15px; font-weight: 800;
    text-align: center; padding: 8px;
    animation: vp-fadein 0.2s ease;
  }
  .vp-snap-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    margin-right: 4px; vertical-align: middle;
  }
`;

// ═══════════════════════════════════════════════════════════════════════════════
export default function VirtualPlayer() {
  const clientId = getOrCreateClientId();

  // ── State ─────────────────────────────────────────────────────────────────
  const [status,     setStatus]     = useState<PlayerStatus>("registering");
  const [time,       setTime]       = useState(new Date());
  const [bells,      setBells]      = useState<BellEntry[]>([]);
  const [instName,   setInstName]   = useState<string>("");
  const [hud,        setHud]        = useState<HudState>({ kind: "idle" });
  const [volume,     setVolume]     = useState(7);
  const [muted,      setMuted]      = useState(false);
  const [isOnline,   setIsOnline]   = useState(navigator.onLine);
  const [unlocked,   setUnlocked]   = useState(false);
  const [bellBanner, setBellBanner] = useState(false);
  const [snapConnected, setSnapConnected] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const wsRef          = useRef<WebSocket | null>(null);
  const wsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapClientRef  = useRef<SnapWsClient | null>(null);
  const snapDeviceIdRef = useRef<string>("");
  const wakeLockRef    = useRef<WakeLockSentinel | null>(null);
  const beaconTimer    = useRef<ReturnType<typeof setInterval> | null>(null);
  const bellBannerTimer = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const hudDismissTimer = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const volumeRef       = useRef(volume);
  const mutedRef        = useRef(muted);

  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current  = muted;  }, [muted]);

  // ── Volume → SnapWsClient gain ───────────────────────────────────────────
  useEffect(() => {
    const c = snapClientRef.current;
    if (!c) return;
    const g = muted ? 0 : sliderToLinearGain(volume);
    c.setGain(g);
  }, [volume, muted]);

  // ── HUD helper-ek ────────────────────────────────────────────────────────
  const dismissHud = useCallback(() => {
    if (hudDismissTimer.current) { clearTimeout(hudDismissTimer.current); hudDismissTimer.current = null; }
    setHud({ kind: "idle" });
  }, []);

  const showHud = useCallback((next: HudState, autoDismissMs?: number) => {
    if (hudDismissTimer.current) { clearTimeout(hudDismissTimer.current); hudDismissTimer.current = null; }
    setHud(next);
    if (autoDismissMs && autoDismissMs > 0) {
      hudDismissTimer.current = setTimeout(() => {
        hudDismissTimer.current = null;
        setHud({ kind: "idle" });
      }, autoDismissMs);
    }
  }, []);

  const flashBellBanner = useCallback((ms = 6000) => {
    setBellBanner(true);
    if (bellBannerTimer.current) clearTimeout(bellBannerTimer.current);
    bellBannerTimer.current = setTimeout(() => {
      bellBannerTimer.current = null;
      setBellBanner(false);
    }, ms);
  }, []);

  // ── Bells lekérdezés (UI: "Következő csengetés") ─────────────────────────
  const fetchBells = useCallback(() => {
    apiFetch<{ ok: boolean; bells?: BellEntry[] }>("/bells/today")
      .then(r => { if (r.bells) setBells(r.bells); })
      .catch(e => console.warn("[VP] fetchBells hiba:", e));
  }, []);

  // ── Snap-WS kliens start ─────────────────────────────────────────────────
  const startSnapClient = useCallback((deviceId: string) => {
    if (snapClientRef.current) return;
    const token = sessionStorage.getItem("accessToken") ?? localStorage.getItem("accessToken") ?? "";
    if (!token) return;
    const url = `${SNAP_WS_URL}?token=${encodeURIComponent(token)}`;
    const ctx = getAudioCtx();
    const initialGain = mutedRef.current ? 0 : sliderToLinearGain(volumeRef.current);
    const client = new SnapWsClient({
      url,
      deviceId,
      audioCtx: ctx,
      initialGain,
      onConnected:    () => setSnapConnected(true),
      onDisconnected: () => setSnapConnected(false),
    });
    client.start();
    snapClientRef.current = client;
    console.log(`[VP] SnapWS indítva: deviceId=${deviceId}`);
  }, []);

  const stopSnapClient = useCallback(() => {
    snapClientRef.current?.stop();
    snapClientRef.current = null;
    setSnapConnected(false);
  }, []);

  // ── /sync WS – HUD vezérlés + HELLO + SET_VOLUME/MUTE/SYNC_OFFSET ────────
  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const token = sessionStorage.getItem("accessToken") ?? localStorage.getItem("accessToken") ?? "";
    if (!token) return;

    const ws = new WebSocket(`${SYNC_WS_URL}?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[VP] /sync WS csatlakozva");
      ws.send(JSON.stringify({ type: "TIME_SYNC", seq: Date.now() }));
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);

        if (msg.type === "HELLO") {
          // snapDeviceId = a valódi Device.id (a backend a userId+tenantId-ből
          // oldja fel). Ezt használjuk a snap-HELLO ID mezőhöz.
          const snapDeviceId = msg.snapDeviceId ?? msg.deviceId;
          if (snapDeviceId && snapDeviceId !== "unknown") {
            snapDeviceIdRef.current = snapDeviceId;
            // Snap-stream indítása amint az unlock megvolt és tudjuk a deviceId-t
            if (unlocked) startSnapClient(snapDeviceId);
          }
          if (typeof msg.syncOffsetMs === "number") {
            snapClientRef.current?.setSyncOffset(msg.syncOffsetMs);
          }
          return;
        }

        // A backend PREPARE/PLAY a snap-aware klienseknek HUD-ütemezésre is
        // mehet, de a tényleges hangot a snap-stream szolgálja → mi csak a
        // HUD-state-et frissítjük.
        const action = msg.action ?? "";
        const phase  = msg.phase ?? "";

        const fireForAction = (act: string, payload: any) => {
          if (act === "BELL") {
            flashBellBanner(6000);
            // Bell-banner felülíródik a HUD aktuális tartalmán (nem váltunk
            // overlay-t, a banner külön elem). A HUD-bell-feliratot nem
            // mutatunk: a banner elég, a kliens-hang a snap-streamből jön.
          } else if (act === "TTS") {
            const text  = payload.text ?? "";
            const title = payload.title ?? "Üzenet";
            const readingMs = text ? calcReadingMs(text) : 8000;
            showHud({ kind: "tts", title, text }, readingMs + 4000);
          } else if (act === "PLAY_URL") {
            const title = payload.title ?? "Iskolarádió";
            showHud({ kind: "radio", title });
          } else if (act === "STOP_PLAYBACK") {
            dismissHud();
          } else if (act === "NOW_PLAYING_INFO") {
            const jobType    = payload.jobType ?? "";
            const title      = payload.title ?? "";
            const text       = payload.text ?? "";
            if (jobType === "BELL") {
              flashBellBanner(6000);
            } else if (jobType === "TTS") {
              showHud({ kind: "tts", title, text }, text ? calcReadingMs(text) + 4000 : 8000);
            } else if (jobType === "RADIO") {
              showHud({ kind: "radio", title });
            }
          } else if (act === "SYNC_BELLS") {
            fetchBells();
          } else if (act === "SET_VOLUME") {
            const v = msg.volume;
            if (typeof v === "number" && v >= 0 && v <= 10) {
              setVolume(v);
            }
          } else if (act === "MUTE") {
            const m = msg.mute;
            if (typeof m === "boolean") setMuted(m);
          } else if (act === "SET_SYNC_OFFSET") {
            const off = msg.offsetMs;
            if (typeof off === "number") snapClientRef.current?.setSyncOffset(off);
          }
        };

        if (phase === "PREPARE") {
          // A backend READY_ACK-ot vár – a snap-stream alapú kliens "azonnal
          // készen áll", mert a tényleges hangot a folyamatos snap-stream
          // szolgálja. Visszaküldjük az ACK-ot, hogy a backend ne timeout-oljon.
          ws.send(JSON.stringify({
            type: "READY_ACK",
            commandId: msg.commandId,
            deviceId: snapDeviceIdRef.current || clientId,
            readyAt: new Date().toISOString(),
            bufferMs: 0,
          }));
          // HUD-ot a PLAY phase-ben mutatjuk, hogy a többi klienssel egyszerre
          // jelenjen meg.
          return;
        }

        if (phase === "PLAY") {
          // PLAY-kor frissítjük a HUD-ot az action alapján
          fireForAction(msg.action ?? "", msg);
          return;
        }

        if (action) {
          fireForAction(action, msg);
          return;
        }
      } catch (e) {
        console.warn("[VP] /sync WS üzenet hiba:", e);
      }
    };

    ws.onclose = (evt) => {
      console.log(`[VP] /sync WS lezárva (${evt.code})`);
      wsRef.current = null;
      wsReconnectRef.current = setTimeout(connectWS, WS_RECONNECT_MS);
    };

    ws.onerror = () => { try { ws.close(); } catch {} };
  }, [clientId, unlocked, startSnapClient, showHud, dismissHud, fetchBells, flashBellBanner]);

  // ── JWT-relogin (a tokeneknek 15 perces TTL-je van; a webplayer egy nap
  //  nyitva marad → szilárdság miatt csendben megújítjuk, ha vannak vpCredentials
  //  a localStorage-ben). Az élő /sync és /snap-stream WS-ek megmaradnak (azokat
  //  upgrade-kor authentikáljuk egyszer); csak a következő HTTP-kérés viszi az
  //  új tokent.
  const reloginPlayer = useCallback(async () => {
    try {
      const storedCreds = localStorage.getItem("vpCredentials");
      if (!storedCreds) return;
      const { email, password } = JSON.parse(storedCreds) as { email: string; password: string };
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.accessToken) {
        if (sessionStorage.getItem("accessToken")) sessionStorage.setItem("accessToken", data.accessToken);
        else localStorage.setItem("accessToken", data.accessToken);
      }
    } catch (e) { console.warn("[VP] reloginPlayer hiba:", e); }
  }, []);

  // ── Reg + status ─────────────────────────────────────────────────────────
  const register = useCallback(async () => {
    setStatus("registering");
    const ipAddress = await getPublicIp();
    try {
      const res = await apiFetch<{ ok: boolean; status: string }>(
        "/player/device/register",
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, ipAddress, userAgent: navigator.userAgent }) }
      );
      setStatus(res.status === "active" ? "active" : "pending");
    } catch { setStatus("pending"); }
  }, [clientId]);

  // ── Autoplay unlock ───────────────────────────────────────────────────────
  const unlockAudio = useCallback(async () => {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch {}
    }
    setUnlocked(true);
    // Ha a /sync WS már megadta a deviceId-t, csak unlock után startoljuk
    if (snapDeviceIdRef.current && !snapClientRef.current) {
      startSnapClient(snapDeviceIdRef.current);
    }
  }, [startSnapClient]);

  // ── Lifecycle ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onUnload = () => {
      const token = sessionStorage.getItem("accessToken") ?? localStorage.getItem("accessToken") ?? "";
      if (!token) return;
      try {
        navigator.sendBeacon(
          `${API_BASE}/auth/logout`,
          new Blob([JSON.stringify({ token })], { type: "application/json" })
        );
      } catch {}
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
      } catch {}
    };
    void requestWakeLock();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock();
        const ctx = getAudioCtx();
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
      }
    };
    const onOnline  = () => { setIsOnline(true);  fetchBells(); };
    const onOffline = () => setIsOnline(false);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      wakeLockRef.current?.release().catch(() => {});
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { void register(); }, [register]);

  // Status="active" → bell-fetch + WS + beacon
  useEffect(() => {
    if (status !== "active") return;

    const token = sessionStorage.getItem("accessToken") ?? localStorage.getItem("accessToken") ?? "";
    if (token) {
      try {
        const b64 = token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
        const decoded = new TextDecoder("utf-8").decode(
          Uint8Array.from(atob(b64.padEnd(b64.length + (4 - b64.length % 4) % 4, "=")), ch => ch.charCodeAt(0))
        );
        const p = JSON.parse(decoded);
        setInstName(p.tenantName ?? p.tenant?.name ?? "");
      } catch {}
    }

    fetchBells();
    const bellSyncTimer = setInterval(fetchBells, 60_000);

    connectWS();

    const beacon = async () => {
      const ip = await getPublicIp();
      try {
        await apiFetch("/player/device/beacon", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, ipAddress: ip }),
        });
      } catch (err: any) {
        const is401 = err?.status === 401 || String(err?.message ?? "").includes("401");
        if (is401) void reloginPlayer();
      }
    };
    beacon();
    beaconTimer.current = setInterval(beacon, 30_000);

    return () => {
      clearInterval(bellSyncTimer);
      if (beaconTimer.current) clearInterval(beaconTimer.current);
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current);
      wsRef.current?.close(1000, "component unmount");
      stopSnapClient();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Unlock után próbáljuk meg a snap-stream-et indítani, ha a deviceId már
  // megérkezett a HELLO-ban.
  useEffect(() => {
    if (unlocked && status === "active" && snapDeviceIdRef.current && !snapClientRef.current) {
      startSnapClient(snapDeviceIdRef.current);
    }
  }, [unlocked, status, startSnapClient]);

  const nextBell = nextBellLabel(bells);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="vp-root">
      <style>{CSS}</style>

      {bellBanner && <div className="vp-bell-banner">🔔 Csengetés folyamatban</div>}

      {!unlocked && (
        <div className="vp-unlock" onClick={unlockAudio}>
          <div className="vp-unlock-icon">🔊</div>
          <div className="vp-unlock-title">SchoolLive Player</div>
          <div className="vp-unlock-sub">Kattints a hang engedélyezéséhez</div>
          <button className="vp-unlock-btn" type="button">▶ Indítás</button>
        </div>
      )}

      {unlocked && (status === "pending" || status === "registering") && (
        <div className="vp-pending">
          <div className="vp-pending-icon">📱</div>
          <div className="vp-pending-title">Virtuális lejátszó</div>
          <div className="vp-pending-sub">
            {status === "registering" ? (
              <>Eszköz regisztrálása folyamatban…</>
            ) : (
              <>
                Nem sikerült csatlakozni a kiszolgálóhoz.<br />
                Próbáld újra később, vagy jelentkezz ki és vissza.
              </>
            )}
          </div>
          <div className="vp-pending-id">
            <div style={{ marginBottom:6, color:"#8da4c0", fontSize:11, textTransform:"uppercase", letterSpacing:"0.8px" }}>Eszköz azonosító</div>
            <div>WP-{clientId.slice(0,8).toUpperCase()}</div>
          </div>
          <div style={{ fontSize:13, color:"#4a6280", display:"flex", alignItems:"center" }}>
            <span className="vp-pending-dot" />
            {status === "registering" ? "Csatlakozás…" : "Kapcsolat hiba"}
          </div>
        </div>
      )}

      {unlocked && status === "active" && (
        <div className="vp-screen">
          <div className="vp-header">
            <div style={{display:"flex",flexDirection:"column",gap:0,lineHeight:1.15}}>
              <div style={{fontSize:15,fontWeight:900,letterSpacing:"-0.3px",color:"#3b82f6",fontFamily:"'Nunito','Noto Sans',sans-serif"}}>SchoolLive</div>
              {instName && <div style={{fontSize:13,fontWeight:700,color:"#8da4c0",wordBreak:"break-word",maxWidth:180,fontFamily:"'Nunito','Noto Sans',sans-serif"}}>{instName}</div>}
            </div>
            <div className="vp-status-txt">
              <span className="vp-online-dot" style={{ background: isOnline ? "#22c55e" : "#ef4444", boxShadow: isOnline ? "0 0 8px #22c55e" : "none" }} />
              {isOnline ? "Online" : "Offline"}
            </div>
          </div>

          <div className="vp-center">
            {hud.kind !== "idle" && (
              <div className="vp-msg-overlay">
                {hud.kind === "radio" ? (
                  <>
                    <div style={{fontSize:64}}>📻</div>
                    <div className="vp-radio-title">{hud.title ?? "Iskolarádió"}</div>
                  </>
                ) : hud.kind === "tts" ? (
                  <>
                    {hud.title && <div className="vp-msg-title">{hud.title}</div>}
                    {hud.text && (
                      <div className="vp-msg-text" style={{ fontSize: calcFontSize(hud.text) }}>
                        {hud.text}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            )}

            <picture style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none", zIndex:0 }}>
              <source srcSet="/brand/schoollive-logow.svg" type="image/svg+xml" />
              <img src="/brand/schoollive-logo.svg" alt="" style={{ opacity:0.10, width:"min(80vw, 55vh)", height:"auto", objectFit:"contain", display:"block" }} />
            </picture>
            <div className="vp-clock" style={{position:"relative",zIndex:1}}>{fmtTime(time)}</div>
            <div className="vp-date"  style={{position:"relative",zIndex:1}}>{fmtDate(time)}</div>
            {bells.length > 0 && (
              <div className="vp-next-bell" style={{position:"relative",zIndex:1}}>
                {nextBell ? (
                  <>
                    <span className="vp-bell-icon">🔔</span>
                    <span className="vp-bell-label">Következő csengetés:</span>
                    <span className="vp-bell-time">{nextBell}</span>
                  </>
                ) : (
                  <span style={{opacity:0.45,fontSize:"0.85em"}}>Nincs több csengetés ma</span>
                )}
              </div>
            )}
          </div>

          <div className="vp-footer">
            <div className="vp-footer-item">
              <span style={{ fontSize:14 }}>📱</span>
              <span>WP-{clientId.slice(0,8).toUpperCase()}</span>
            </div>
            <div className="vp-footer-item">
              <span
                className="vp-snap-dot"
                style={{ background: snapConnected ? "#22c55e" : "#ef4444" }}
                title={snapConnected ? "Snap-stream csatlakozva" : "Snap-stream offline"}
              />
              <span>{snapConnected ? "Hang-stream OK" : "Hang-stream várakozik…"}</span>
            </div>
            <div className="vp-vol-wrap">
              <button
                className="vp-vol-btn"
                onClick={() => setMuted(m => !m)}
                type="button"
                title={muted ? "Némítás feloldása" : "Némítás"}
              >
                {muted ? "🔇" : "🔈"}
              </button>
              <button className="vp-vol-btn" onClick={() => { setMuted(false); setVolume(v => Math.max(0, v-1)); }} type="button">−</button>
              <span className="vp-vol-val">{volume}</span>
              <button className="vp-vol-btn" onClick={() => { setMuted(false); setVolume(v => Math.min(10, v+1)); }} type="button">+</button>
              <span style={{ fontSize:13 }}>🔊</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
