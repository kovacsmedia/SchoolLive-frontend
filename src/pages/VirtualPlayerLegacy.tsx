// src/pages/VirtualPlayerLegacy.tsx
// ────────────────────────────────────────────────────────────────────────────
// Android 4.1+ kompatibilis legacy lejátszó
//   • Nincs AudioContext / WebAudio API
//   • Nincs IndexedDB
//   • Nincs fetch → XMLHttpRequest alapú xhrFetch
//   • Nincs crypto.randomUUID → saját UUID generátor
//   • Nincs CSS változók / clamp() / backdrop-filter / Grid
//   • Nincs AbortSignal, WakeLock, Fullscreen API
//   • Csak <audio> elemek a hanglejátszáshoz
//   • Webkit prefix-es CSS
// ────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from "react";

// ─── Konstansok ───────────────────────────────────────────────────────────────
const API_BASE = "https://api.schoollive.hu";
const POLL_INTERVAL_MS   = 5000;
const BEACON_INTERVAL_MS = 30000;
const BELL_SYNC_INTERVAL_MS = 60000;
const BELL_TICK_INTERVAL_MS = 5000;
const WS_URL             = "wss://api.schoollive.hu/sync";
const WS_RECONNECT_MS    = 3000;

// ─── Típusok ─────────────────────────────────────────────────────────────────
type PlayerStatus = "registering" | "pending" | "active";
type CommandPayload = {
  action:       string;
  url?:         string;
  text?:        string;
  title?:       string;
  durationSec?: number;
  source?:      string;
};
type BellEntry  = { hour: number; minute: number; type: string; soundFile: string };
type RadioState   = { url: string; currentTime: number; isStream: boolean; isPlaying: boolean };
type PrepareCmd   = { phase: "PREPARE"; commandId: string; action: string; url?: string; text?: string; title?: string; prepareDeadline: string };
type PlayCmd      = { phase: "PLAY"; commandId: string; playAt: string };

// ─── UUID generátor (crypto.randomUUID nincs Android 4.1-en) ─────────────────
function generateUUID(): string {
  let d = new Date().getTime();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    const r = (d + Math.random() * 16) % 16 | 0;
    d = Math.floor(d / 16);
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function getOrCreateClientId(): string {
  const KEY = "vpClientId";
  let id = localStorage.getItem(KEY);
  if (!id) { id = generateUUID(); localStorage.setItem(KEY, id); }
  return id;
}

// ─── XHR alapú fetch (fetch API helyett) ─────────────────────────────────────
function getToken(): string {
  try { return sessionStorage.getItem("accessToken") || localStorage.getItem("accessToken") || ""; }
  catch { return ""; }
}

function xhrFetch<T>(
  path: string,
  options?: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<T> {
  return new Promise(function(resolve, reject) {
    const xhr = new XMLHttpRequest();
    const method = (options && options.method) || "GET";
    xhr.open(method, API_BASE + path, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", "Bearer " + token);
    if (options && options.headers) {
      const hkeys = Object.keys(options.headers);
      for (let i = 0; i < hkeys.length; i++) {
        xhr.setRequestHeader(hkeys[i], options.headers[hkeys[i]]);
      }
    }
    xhr.timeout = 12000;
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText) as T); }
        catch (e) { reject({ status: xhr.status, message: "JSON parse error" }); }
      } else {
        reject({ status: xhr.status, message: xhr.statusText || "HTTP " + xhr.status });
      }
    };
    xhr.onerror   = function() { reject({ status: 0, message: "Network error" }); };
    xhr.ontimeout = function() { reject({ status: 0, message: "Timeout" }); };
    xhr.send((options && options.body) || null);
  });
}

// ─── IP lekérdezés (timeout XHR-rel) ─────────────────────────────────────────
function getPublicIp(): Promise<string> {
  return new Promise(function(resolve) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://api.ipify.org?format=json", true);
      xhr.timeout = 4000;
      xhr.onreadystatechange = function() {
        if (xhr.readyState !== 4) return;
        try { resolve(JSON.parse(xhr.responseText).ip || ""); }
        catch { resolve(""); }
      };
      xhr.onerror = xhr.ontimeout = function() { resolve(""); };
      xhr.send(null);
    } catch { resolve(""); }
  });
}

// ─── JWT dekódolás UTF-8 safe (TextDecoder nincs Android 4.1-en) ──────────────
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    // decodeURIComponent + escape trick: minden platformon működik
    const decoded = decodeURIComponent(
      atob(padded).split("").map(function(c) {
        return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
      }).join("")
    );
    return JSON.parse(decoded);
  } catch { return null; }
}

// ─── Idő formázás ─────────────────────────────────────────────────────────────
function fmtTime(d: Date): string {
  const h = ("0" + d.getHours()).slice(-2);
  const m = ("0" + d.getMinutes()).slice(-2);
  const s = ("0" + d.getSeconds()).slice(-2);
  return h + ":" + m + ":" + s;
}

const HU_DAYS   = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];
const HU_MONTHS = ["január","február","március","április","május","június",
                   "július","augusztus","szeptember","október","november","december"];

function fmtDate(d: Date): string {
  return d.getFullYear() + ". " + HU_MONTHS[d.getMonth()] + " " +
         d.getDate() + "., " + HU_DAYS[d.getDay()];
}

function nextBellLabel(bells: BellEntry[]): string | null {
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  let best: BellEntry | null = null;
  let bestMin = 9999;
  for (let i = 0; i < bells.length; i++) {
    const t = bells[i].hour * 60 + bells[i].minute;
    if (t > mins && t < bestMin) { bestMin = t; best = bells[i]; }
  }
  if (!best) return null;
  return ("0" + best.hour).slice(-2) + ":" + ("0" + best.minute).slice(-2);
}

// ─── Olvasási idő kalkulátor ──────────────────────────────────────────────────
function calcReadingMs(text: string): number {
  const chars = text.trim().length;
  return Math.max(6000, Math.min(30000, chars * 300));
}

// ─── CSS (nem használ CSS változókat, clamp-et, grid-et, backdrop-filter-t) ───
const CSS = `
  * { -webkit-box-sizing: border-box; box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #07101f; }
  .vp-root {
    width: 100%; height: 100%;
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    overflow: hidden;
    background: #07101f;
    font-family: 'Noto Sans', 'Droid Sans', Arial, sans-serif;
    color: #f0f6ff;
    display: -webkit-box; display: -webkit-flex; display: flex;
    -webkit-box-orient: vertical; -webkit-flex-direction: column; flex-direction: column;
    -webkit-box-align: center; -webkit-align-items: center; align-items: center;
    -webkit-box-pack: center; -webkit-justify-content: center; justify-content: center;
  }

  /* ── Unlock ── */
  .vp-unlock {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 100;
    background: #07101f;
    display: -webkit-box; display: -webkit-flex; display: flex;
    -webkit-box-orient: vertical; -webkit-flex-direction: column; flex-direction: column;
    -webkit-box-align: center; -webkit-align-items: center; align-items: center;
    -webkit-box-pack: center; -webkit-justify-content: center; justify-content: center;
    cursor: pointer;
  }
  .vp-unlock-icon  { font-size: 64px; margin-bottom: 16px; }
  .vp-unlock-title { font-size: 22px; font-weight: bold; color: #f0f6ff; margin-bottom: 8px; }
  .vp-unlock-sub   { font-size: 14px; color: #8da4c0; margin-bottom: 24px; text-align: center; padding: 0 20px; }
  .vp-unlock-btn {
    padding: 14px 36px; border-radius: 14px; border: none;
    background: #3b82f6; color: #fff;
    font-size: 17px; font-weight: bold; cursor: pointer;
  }

  /* ── Pending ── */
  .vp-pending {
    display: -webkit-box; display: -webkit-flex; display: flex;
    -webkit-box-orient: vertical; -webkit-flex-direction: column; flex-direction: column;
    -webkit-box-align: center; -webkit-align-items: center; align-items: center;
    padding: 40px; text-align: center; max-width: 460px;
  }
  .vp-pending-icon  { font-size: 56px; margin-bottom: 16px; }
  .vp-pending-title { font-size: 24px; font-weight: bold; color: #f0f6ff; margin-bottom: 10px; }
  .vp-pending-sub   { font-size: 14px; color: #8da4c0; line-height: 1.6; margin-bottom: 18px; }
  .vp-pending-id {
    background: #0d1b2e; border: 1px solid #1a2d47; border-radius: 12px;
    padding: 12px 20px; font-size: 13px; color: #3b82f6; font-weight: bold;
    margin-bottom: 14px;
  }
  .vp-pending-wait { font-size: 13px; color: #4a6280; }

  /* ── Főképernyő ── */
  .vp-screen {
    width: 100%; height: 100%;
    display: -webkit-box; display: -webkit-flex; display: flex;
    -webkit-box-orient: vertical; -webkit-flex-direction: column; flex-direction: column;
  }
  .vp-header {
    display: -webkit-box; display: -webkit-flex; display: flex;
    -webkit-box-align: center; -webkit-align-items: center; align-items: center;
    -webkit-box-pack: justify; -webkit-justify-content: space-between; justify-content: space-between;
    padding: 16px 24px;
    background: #0d1b2e; border-bottom: 1px solid #1a2d47;
  }
  .vp-inst-wrap { display: -webkit-box; display: -webkit-flex; display: flex;
    -webkit-box-orient: vertical; -webkit-flex-direction: column; flex-direction: column; }
  .vp-brand     { font-size: 15px; font-weight: bold; color: #3b82f6; }
  .vp-inst-name { font-size: 12px; color: #8da4c0; margin-top: 2px; max-width: 180px; word-wrap: break-word; }
  .vp-online-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .vp-status-txt { font-size: 12px; color: #4a6280; font-weight: bold; }

  /* ── Közép ── */
  .vp-center {
    -webkit-box-flex: 1; -webkit-flex: 1; flex: 1;
    display: -webkit-box; display: -webkit-flex; display: flex;
    -webkit-box-orient: vertical; -webkit-flex-direction: column; flex-direction: column;
    -webkit-box-align: center; -webkit-align-items: center; align-items: center;
    -webkit-box-pack: center; -webkit-justify-content: center; justify-content: center;
    position: relative; padding: 20px;
  }
  .vp-clock {
    font-size: 96px; font-weight: bold; color: #f0f6ff;
    letter-spacing: -3px; line-height: 1;
    text-align: center; position: relative; z-index: 1;
  }
  .vp-date  {
    font-size: 18px; color: #8da4c0; font-weight: bold;
    text-align: center; margin-top: 8px; position: relative; z-index: 1;
  }
  .vp-next-bell {
    margin-top: 20px;
    display: -webkit-box; display: -webkit-flex; display: flex;
    -webkit-box-align: center; -webkit-align-items: center; align-items: center;
    background: #0d1b2e; border: 1px solid #1a2d47;
    border-radius: 14px; padding: 10px 20px; position: relative; z-index: 1;
  }
  .vp-bell-icon  { font-size: 20px; margin-right: 10px; }
  .vp-bell-label { font-size: 13px; color: #8da4c0; font-weight: bold; }
  .vp-bell-time  { font-size: 20px; font-weight: bold; color: #f0f6ff; margin-left: 8px; }

  /* ── Watermark ── */
  .vp-watermark {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    display: -webkit-box; display: -webkit-flex; display: flex;
    -webkit-box-align: center; -webkit-align-items: center; align-items: center;
    -webkit-box-pack: center; -webkit-justify-content: center; justify-content: center;
    pointer-events: none; z-index: 0;
  }
  .vp-watermark img { opacity: 0.08; width: 60%; max-width: 380px; }

  /* ── Üzenet overlay ── */
  .vp-msg-overlay {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    display: -webkit-box; display: -webkit-flex; display: flex;
    -webkit-box-orient: vertical; -webkit-flex-direction: column; flex-direction: column;
    -webkit-box-align: center; -webkit-align-items: center; align-items: center;
    -webkit-box-pack: center; -webkit-justify-content: center; justify-content: center;
    background: rgba(7,16,31,0.96);
    padding: 40px; z-index: 10;
  }
  .vp-msg-icon  { font-size: 52px; margin-bottom: 16px; }
  .vp-msg-title {
    font-size: 28px; font-weight: bold; color: #3b82f6;
    text-align: center; margin-bottom: 16px;
  }
  .vp-msg-text {
    font-size: 28px; font-weight: bold; color: #f0f6ff;
    text-align: center; line-height: 1.4;
    max-width: 90%; word-wrap: break-word; margin-bottom: 20px;
  }
  .vp-msg-text.large  { font-size: 42px; }
  .vp-msg-text.medium { font-size: 30px; }
  .vp-msg-text.small  { font-size: 22px; }
  .vp-msg-text.tiny   { font-size: 17px; }
  .vp-progress-wrap {
    width: 100%; max-width: 440px; height: 5px;
    background: #1a2d47; border-radius: 99px; overflow: hidden;
  }
  .vp-progress-bar {
    height: 100%; border-radius: 99px;
    -webkit-transition: width 0.4s linear; transition: width 0.4s linear;
  }
  .vp-progress-play   { background: #3b82f6; }
  .vp-progress-read   { background: #22c55e; }
  .vp-progress-linger { background: #f59e0b; }
  .vp-radio-title {
    font-size: 36px; font-weight: bold; color: #3b82f6;
    text-align: center; margin-bottom: 10px;
  }
  .vp-radio-timeleft { font-size: 20px; color: #8da4c0; margin-bottom: 14px; }

  /* ── Bell sáv ── */
  .vp-bell-banner {
    position: fixed; top: 0; left: 0; right: 0; z-index: 50;
    background: #f59e0b; color: #fff;
    font-size: 15px; font-weight: bold; text-align: center; padding: 8px;
  }

  /* ── Footer ── */
  .vp-footer {
    display: -webkit-box; display: -webkit-flex; display: flex;
    -webkit-box-align: center; -webkit-align-items: center; align-items: center;
    -webkit-box-pack: center; -webkit-justify-content: center; justify-content: center;
    -webkit-flex-wrap: wrap; flex-wrap: wrap;
    padding: 12px 20px; background: #0d1b2e; border-top: 1px solid #1a2d47;
    gap: 16px; font-size: 12px; color: #4a6280;
  }
  .vp-footer-item {
    display: -webkit-box; display: -webkit-flex; display: flex;
    -webkit-box-align: center; -webkit-align-items: center; align-items: center;
  }
  .vp-vol-wrap {
    display: -webkit-box; display: -webkit-flex; display: flex;
    -webkit-box-align: center; -webkit-align-items: center; align-items: center;
  }
  .vp-vol-btn {
    width: 32px; height: 32px; border-radius: 8px;
    border: 1px solid #1a2d47; background: transparent;
    color: #8da4c0; font-size: 18px; cursor: pointer;
    margin: 0 2px;
  }
  .vp-vol-val { font-size: 13px; color: #8da4c0; min-width: 22px; text-align: center; }
  .vp-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    margin-right: 5px; vertical-align: middle;
  }
  @-webkit-keyframes vp-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
  @keyframes vp-blink          { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .vp-blink { -webkit-animation: vp-blink 1.5s ease-in-out infinite; animation: vp-blink 1.5s ease-in-out infinite; }
`;

// ─── Font méret kategória ─────────────────────────────────────────────────────
function textSizeClass(text: string): string {
  const len = text.trim().length;
  if (len <= 40)  return "large";
  if (len <= 90)  return "medium";
  if (len <= 170) return "small";
  return "tiny";
}

// ══════════════════════════════════════════════════════════════════════════════
export default function VirtualPlayerLegacy() {
  const clientId = getOrCreateClientId();

  const [status,     setStatus]     = useState<PlayerStatus>("registering");
  const [time,       setTime]       = useState(new Date());
  const [bells,      setBells]      = useState<BellEntry[]>([]);
  const [instName,   setInstName]   = useState("");
  const [isOnline,   setIsOnline]   = useState(
    typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
      ? navigator.onLine : true
  );
  const [unlocked,   setUnlocked]   = useState(false);
  const [volume,     setVolume]     = useState(7);

  // Üzenet overlay
  const [activeMsg,    setActiveMsg]    = useState<CommandPayload | null>(null);
  const [progressPct,  setProgressPct]  = useState(0);
  const [progressType, setProgressType] = useState<"play"|"read"|"linger">("play");
  const [bellBanner,   setBellBanner]   = useState(false);

  // Audio elemek – 3 db bell slot + főhang
  const mainAudioRef  = useRef<HTMLAudioElement>(null);
  const bellAudio1Ref = useRef<HTMLAudioElement>(null);
  const bellAudio2Ref = useRef<HTMLAudioElement>(null);
  const bellAudio3Ref = useRef<HTMLAudioElement>(null);

  // Ref-ek closure-okhoz
  const bellsRef          = useRef<BellEntry[]>([]);
  const volumeRef         = useRef(volume);
  const radioStateRef     = useRef<RadioState | null>(null);
  const lastBellKeyRef    = useRef("");
  const activeMsgRef      = useRef<string>("");
  const dismissTimerRef   = useRef<any>(null);
  const progressTimerRef  = useRef<any>(null);
  const lingerTimerRef    = useRef<any>(null);
  const pollTimerRef      = useRef<any>(null);
  const beaconTimerRef    = useRef<any>(null);
  const bellSyncTimerRef  = useRef<any>(null);
  const bellTickTimerRef  = useRef<any>(null);
  const clockTimerRef     = useRef<any>(null);
  const wsRef             = useRef<WebSocket | null>(null);
  const wsReconnectRef    = useRef<any>(null);
  const serverOffsetRef   = useRef<number>(0);
  const pendingPreparesRef = useRef<{ [key: string]: HTMLAudioElement }>({});

  useEffect(() => { bellsRef.current  = bells;  }, [bells]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  // ── Hangerő szinkron ──────────────────────────────────────────────────────
  useEffect(() => {
    const v = volume / 10;
    if (mainAudioRef.current)  mainAudioRef.current.volume  = v;
    if (bellAudio1Ref.current) bellAudio1Ref.current.volume = v;
    if (bellAudio2Ref.current) bellAudio2Ref.current.volume = v;
    if (bellAudio3Ref.current) bellAudio3Ref.current.volume = v;
  }, [volume]);

  // ── Dismiss üzenet ────────────────────────────────────────────────────────
  const dismissMsg = useCallback(() => {
    if (dismissTimerRef.current)  { clearTimeout(dismissTimerRef.current);   dismissTimerRef.current  = null; }
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
    if (lingerTimerRef.current)   { clearInterval(lingerTimerRef.current);   lingerTimerRef.current   = null; }
    setActiveMsg(null);
    setProgressPct(0);
    activeMsgRef.current = "";
  }, []);

  // ── Show üzenet ───────────────────────────────────────────────────────────
  const showMsg = useCallback((payload: CommandPayload, autoDismissMs?: number) => {
    if (dismissTimerRef.current)  { clearTimeout(dismissTimerRef.current);   dismissTimerRef.current  = null; }
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
    if (lingerTimerRef.current)   { clearInterval(lingerTimerRef.current);   lingerTimerRef.current   = null; }

    activeMsgRef.current = payload.action;
    setActiveMsg(payload);
    setProgressPct(0);

    if (autoDismissMs && autoDismissMs > 0) {
      const start = Date.now();
      setProgressType("read");
      progressTimerRef.current = setInterval(() => {
        const pct = Math.min(100, ((Date.now() - start) / autoDismissMs) * 100);
        setProgressPct(pct);
        if (pct >= 100) {
          clearInterval(progressTimerRef.current);
          progressTimerRef.current = null;
        }
      }, 150);
      dismissTimerRef.current = setTimeout(dismissMsg, autoDismissMs);
    }
  }, [dismissMsg]);

  // ── Rádió folytatása ──────────────────────────────────────────────────────
  const resumeRadio = useCallback(() => {
    const rs = radioStateRef.current;
    if (!rs || !rs.isPlaying) return;
    const a = mainAudioRef.current;
    if (!a) return;
    a.volume = volumeRef.current / 10;
    if (rs.isStream) {
      a.src = rs.url + (rs.url.indexOf("?") >= 0 ? "&" : "?") + "_r=" + Date.now();
      a.load();
      a.play();
    } else {
      a.src = rs.url;
      a.load();
      const seek = () => {
        a.removeEventListener("canplay", seek);
        if (rs.currentTime > 0) { try { a.currentTime = rs.currentTime; } catch (e) {} }
        a.play();
      };
      a.addEventListener("canplay", seek);
    }
    showMsg({ action: "PLAY_URL", url: rs.url, title: "Iskolarádió", source: "RADIO" });
  }, [showMsg]);

  // ── Bell lejátszás (szabad <audio> slot keresés) ──────────────────────────
  const playBell = useCallback((soundFile: string) => {
    // Főhang szüneteltetése ha rádió megy
    const main = mainAudioRef.current;
    if (main && !main.paused && radioStateRef.current && radioStateRef.current.isPlaying) {
      radioStateRef.current.currentTime = main.currentTime;
      main.pause();
    }

    setBellBanner(true);
    const url = API_BASE + "/audio/bells/" + soundFile;
    const v   = volumeRef.current / 10;

    // Szabad slot keresése
    const slots = [bellAudio1Ref.current, bellAudio2Ref.current, bellAudio3Ref.current];
    let slot: HTMLAudioElement | null = null;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && (slots[i]!.paused || slots[i]!.ended)) {
        slot = slots[i];
        break;
      }
    }
    if (!slot) slot = slots[0]; // fallback: első slot felülír

    if (!slot) { setBellBanner(false); return; }
    slot.src    = url;
    slot.volume = v;
    slot.load();
    slot.play();
  }, []);

  // ── Audio lejátszás helper ─────────────────────────────────────────────────
  const playAudio = useCallback((url: string) => {
    const a = mainAudioRef.current;
    if (!a) return;
    a.src    = url;
    a.volume = volumeRef.current / 10;
    a.load();
    a.play();
  }, []);

  // ── Bell hangok előtöltése (link preload HTML audio) ─────────────────────
  // Android 4.1-en nincs AudioContext → letöltjük a csengőhangokat <audio> preload-dal
  const preloadBellSounds = useCallback((bellList: BellEntry[]) => {
    const sounds = Array.from(new Set(bellList.map(function(b) { return b.soundFile; })));
    // Dinamikusan létrehozunk hidden <audio> elemeket preload="auto"-val
    sounds.forEach(function(name) {
      const id = "vp-bell-preload-" + name.replace(/\./g, "-");
      if (!document.getElementById(id)) {
        const el = document.createElement("audio");
        el.id       = id;
        el.src      = API_BASE + "/audio/bells/" + name;
        el.preload  = "auto";
        el.style.display = "none";
        document.body.appendChild(el);
      }
    });
  }, []);

  const fetchBells = useCallback(() => {
    xhrFetch<{ ok: boolean; bells?: BellEntry[] }>("/bells/today")
      .then(function(r) {
        if (r.bells && r.bells.length > 0) {
          setBells(r.bells);
          preloadBellSounds(r.bells);
        }
      })
      .catch(function(e) { console.warn("[VP-LEGACY] fetchBells hiba:", e); });
  }, [preloadBellSounds]);

  // ── Parancs kezelő ────────────────────────────────────────────────────────
  // ── WebSocket kapcsolat ────────────────────────────────────────────────────

  const handleCommand = useCallback((cmd: { id: string; payload: CommandPayload }) => {
    const p = cmd.payload;
    const action = p.action;
    console.log("[VP-LEGACY] Command:", action, p.url || p.text || "");

    if (action === "BELL" && p.url) {
      // Deduplikáció: ha az offline ticker már elsütötte ebben a percben, csak ACK-olunk
      const now = new Date();
      const bellKey = now.getHours() + ":" + now.getMinutes();
      if (lastBellKeyRef.current === bellKey) {
        console.log("[VP-LEGACY] BELL parancs kihagyva (ticker már lejátszta): " + bellKey);
      } else {
        lastBellKeyRef.current = bellKey;
        const soundFile = p.url.split("/").pop() || p.url;
        playBell(soundFile);
      }

    } else if (action === "SYNC_BELLS") {
      fetchBells();

    } else if (action === "PLAY_URL" && p.url) {
      const isStream = !/\.(mp3|wav|ogg|aac|m4a)(\?|$)/i.test(p.url);
      radioStateRef.current = { url: p.url, currentTime: 0, isStream: isStream, isPlaying: true };
      showMsg({ action: action, url: p.url, title: p.title || "Iskolarádió", source: p.source });
      playAudio(p.url);

    } else if (action === "TTS" && p.url) {
      const main = mainAudioRef.current;
      if (main && radioStateRef.current && radioStateRef.current.isPlaying && !main.paused) {
        radioStateRef.current.currentTime = main.currentTime;
        main.pause();
      }
      const readMs = p.text ? calcReadingMs(p.text) : 8000;
      showMsg({ action: action, url: p.url, text: p.text, title: p.title || "Üzenet" }, readMs);
      playAudio(p.url);

    } else if (action === "STOP_PLAYBACK") {
      const a = mainAudioRef.current;
      if (a) { a.pause(); a.src = ""; }
      radioStateRef.current = null;
      dismissMsg();
    }

    // ACK
    xhrFetch("/player/device/ack", {
      method: "POST",
      body: JSON.stringify({ commandId: cmd.id }),
    }).catch(function() {});
  }, [playAudio, playBell, fetchBells, showMsg, dismissMsg]);

  // ── Csengetési rend lekérdezése ───────────────────────────────────────────
  const connectWS = useCallback(function() {
    if (wsRef.current && wsRef.current.readyState === 1) return;
    const token = getToken();
    if (!token) return;
    try {
      const ws = new WebSocket(WS_URL + "?token=" + encodeURIComponent(token));
      wsRef.current = ws;
      ws.onopen = function() {
        console.log("[VP-LEGACY-SYNC] WebSocket csatlakozva");
        syncClock();
      };
      ws.onmessage = function(evt: MessageEvent) {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "HELLO") {
            serverOffsetRef.current = new Date(msg.serverNow).getTime() - Date.now();
            return;
          }
          if (msg.phase === "PREPARE") { handlePrepare(msg as PrepareCmd); return; }
          if (msg.phase === "PLAY") {
            handlePlay(msg as PlayCmd);
            const audio = pendingPreparesRef.current[msg.commandId];
            if (audio) {
              const delay = Math.max(0, new Date(msg.playAt).getTime() - (Date.now() + serverOffsetRef.current));
              setTimeout(function() {
                handleCommand({ id: msg.commandId || "ws-cmd", payload: { action: "BELL", url: audio.src } });
              }, delay);
            }
            return;
          }
          if (msg.action) {
            handleCommand({ id: msg.commandId || "ws-cmd", payload: msg as CommandPayload });
          }
        } catch (e) { console.warn("[VP-LEGACY-SYNC] parse hiba:", e); }
      };
      ws.onclose = function(evt: CloseEvent) {
        wsRef.current = null;
        wsReconnectRef.current = setTimeout(connectWS, WS_RECONNECT_MS);
        console.log("[VP-LEGACY-SYNC] WS lezárva (" + evt.code + ")");
      };
      ws.onerror = function() { ws.close(); };
    } catch (e) { console.warn("[VP-LEGACY-SYNC] WS nem támogatott:", e); }
  }, [syncClock, handlePrepare, handlePlay, handleCommand]);


  // ── Offline bell ticker ───────────────────────────────────────────────────
  const offlineBellTick = useCallback(() => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();
    const key = h + ":" + m;
    if (s > 58 || lastBellKeyRef.current === key) return;
    const list = bellsRef.current;
    let due: BellEntry | null = null;
    for (let i = 0; i < list.length; i++) {
      if (list[i].hour === h && list[i].minute === m) { due = list[i]; break; }
    }
    if (!due) return;
    lastBellKeyRef.current = key;
    playBell(due.soundFile);
  }, [playBell]);

  // ── Autoplay unlock ────────────────────────────────────────────────────────
  const unlockAudio = useCallback(() => {
    // Android 4.1-en: user gesture kell az első play()-hoz
    // Csendesen lejátszunk minden audio elemet, hogy feloldjuk az autoplay blokkolást
    const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    const refs = [mainAudioRef, bellAudio1Ref, bellAudio2Ref, bellAudio3Ref];
    refs.forEach(function(r) {
      if (!r.current) return;
      r.current.src = SILENT;
      r.current.volume = 0;
      const p = r.current.play();
      if (p && p.then) {
        p.then(function() {
          if (r.current) { r.current.pause(); r.current.src = ""; r.current.volume = volumeRef.current / 10; }
        }).catch(function() {
          if (r.current) { r.current.src = ""; r.current.volume = volumeRef.current / 10; }
        });
      }
    });
    setUnlocked(true);
    fetchBells();
  }, [fetchBells]);

  // ── Regisztráció ──────────────────────────────────────────────────────────
  const register = useCallback(() => {
    setStatus("registering");
    getPublicIp().then(function(ip) {
      xhrFetch<{ ok: boolean; status: string }>("/player/device/register", {
        method: "POST",
        body: JSON.stringify({ clientId: clientId, ipAddress: ip, userAgent: navigator.userAgent }),
      })
        .then(function(res) {
          setStatus(res.status === "active" ? "active" : "pending");
        })
        .catch(function() { setStatus("pending"); });
    });
  }, [clientId]);

  // ── Audio event handlers ──────────────────────────────────────────────────
  const onMainTimeUpdate = () => {
    const a = mainAudioRef.current;
    if (!a) return;
    if (a.duration && !isNaN(a.duration) && a.duration > 0) {
      const pct = (a.currentTime / a.duration) * 100;
      if (activeMsgRef.current === "PLAY_URL") {
        setProgressType("play");
        setProgressPct(pct);
      }
      if (radioStateRef.current && radioStateRef.current.isPlaying && !radioStateRef.current.isStream) {
        radioStateRef.current.currentTime = a.currentTime;
      }
    }
  };

  const onMainEnded = () => {
    const act = activeMsgRef.current;
    if (act === "TTS") {
      if (radioStateRef.current && radioStateRef.current.isPlaying) {
        setTimeout(resumeRadio, 300);
      } else {
        // 8mp linger
        const LINGER = 8000;
        const start = Date.now();
        setProgressType("linger");
        setProgressPct(100);
        lingerTimerRef.current = setInterval(function() {
          const elapsed = Date.now() - start;
          const remaining = Math.max(0, LINGER - elapsed);
          setProgressPct((remaining / LINGER) * 100);
          if (elapsed >= LINGER) {
            clearInterval(lingerTimerRef.current);
            lingerTimerRef.current = null;
            dismissMsg();
          }
        }, 150);
      }
    } else if (act === "PLAY_URL") {
      radioStateRef.current = null;
      dismissMsg();
    }
  };

  const onMainError = () => {
    dismissMsg();
    if (radioStateRef.current && radioStateRef.current.isPlaying) {
      setTimeout(resumeRadio, 1500);
    }
  };

  const onBellEnded = () => {
    setBellBanner(false);
    if (radioStateRef.current && radioStateRef.current.isPlaying) {
      setTimeout(resumeRadio, 300);
    }
  };

  // ── Óra ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    clockTimerRef.current = setInterval(function() { setTime(new Date()); }, 1000);
    return function() { clearInterval(clockTimerRef.current); };
  }, []);

  // ── Online/Offline ────────────────────────────────────────────────────────
  useEffect(() => {
    const onOnline  = function() { setIsOnline(true);  if (unlocked) fetchBells(); };
    const onOffline = function() { setIsOnline(false); };
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return function() {
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [unlocked, fetchBells]);

  // ── Regisztráció indítása ─────────────────────────────────────────────────
  useEffect(function() { register(); }, [register]);

  // ── Active state beállítás: bells + intézmény neve ───────────────────────
  useEffect(function() {
    if (status !== "active") return;
    const token = getToken();
    if (token) {
      const p = decodeJwtPayload(token);
      if (p) setInstName(p.tenantName || (p.tenant && p.tenant.name) || "");
    }
    fetchBells();
    bellSyncTimerRef.current = setInterval(fetchBells, BELL_SYNC_INTERVAL_MS);
    return function() { clearInterval(bellSyncTimerRef.current); };
  }, [status, fetchBells]);

  // ── WebSocket + Crystal Clock Sync indítása ─────────────────────────────
  useEffect(function() {
    if (status !== "active") return;
    connectWS();
    const clockSync = setInterval(syncClock, 60 * 60000);
    return function() {
      clearInterval(clockSync);
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current);
      if (wsRef.current) { wsRef.current.close(1000, "unmount"); wsRef.current = null; }
    };
  }, [status, connectWS, syncClock]);

  // ── Offline bell ticker ────────────────────────────────────────────────────
  useEffect(function() {
    if (status !== "active") return;
    offlineBellTick();
    bellTickTimerRef.current = setInterval(offlineBellTick, BELL_TICK_INTERVAL_MS);
    return function() { clearInterval(bellTickTimerRef.current); };
  }, [status, offlineBellTick]);

  // ── Polling ───────────────────────────────────────────────────────────────
  useEffect(function() {
    if (status === "registering") return;
    let failCount = 0;
    const poll = function() {
      xhrFetch<{ ok: boolean; status: string; command: { id: string; payload: CommandPayload } | null }>(
        "/player/device/poll", { method: "POST", body: "{}" }
      )
        .then(function(res) {
          failCount = 0;
          if (res.status === "active" && status !== "active") setStatus("active");
          if (res.status === "active" && res.command) handleCommand(res.command);
        })
        .catch(function(err) {
          failCount++;
          if (err && (err.status === 401 || (err.message && err.message.indexOf("401") >= 0))) {
            // Token lejárt – próbál újrabejelentkezni
            const creds = localStorage.getItem("vpCredentials");
            if (creds) {
              try {
                const c = JSON.parse(creds) as { email: string; password: string };
                xhrFetch<{ accessToken?: string }>("/auth/login", {
                  method: "POST",
                  body: JSON.stringify({ email: c.email, password: c.password }),
                }).then(function(d) {
                  if (d.accessToken) {
                    if (sessionStorage.getItem("accessToken")) sessionStorage.setItem("accessToken", d.accessToken);
                    else localStorage.setItem("accessToken", d.accessToken);
                  }
                }).catch(function() {});
              } catch (e) {}
            }
          }
        });
    };
    poll();
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return function() { clearInterval(pollTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ── Beacon ────────────────────────────────────────────────────────────────
  useEffect(function() {
    if (status !== "active") return;
    const beacon = function() {
      getPublicIp().then(function(ip) {
        xhrFetch("/player/device/beacon", {
          method: "POST",
          body: JSON.stringify({ clientId: clientId, ipAddress: ip }),
        }).catch(function() {});
      });
    };
    beacon();
    beaconTimerRef.current = setInterval(beacon, BEACON_INTERVAL_MS);
    return function() { clearInterval(beaconTimerRef.current); };
  }, [status, clientId]);

  const nextBell = nextBellLabel(bells);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="vp-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Audio elemek */}
      <audio ref={mainAudioRef}  onTimeUpdate={onMainTimeUpdate} onEnded={onMainEnded}  onError={onMainError}  preload="none" style={{ display:"none" }} />
      <audio ref={bellAudio1Ref} onEnded={onBellEnded}          onError={() => { setBellBanner(false); if (radioStateRef.current?.isPlaying) setTimeout(resumeRadio,300); }} preload="none" style={{ display:"none" }} />
      <audio ref={bellAudio2Ref} onEnded={onBellEnded}          onError={() => setBellBanner(false)} preload="none" style={{ display:"none" }} />
      <audio ref={bellAudio3Ref} onEnded={onBellEnded}          onError={() => setBellBanner(false)} preload="none" style={{ display:"none" }} />

      {/* Bell sáv */}
      {bellBanner && <div className="vp-bell-banner">🔔 Csengetés folyamatban</div>}

      {/* Unlock overlay */}
      {!unlocked && (
        <div className="vp-unlock" onClick={unlockAudio}>
          <div className="vp-unlock-icon">🔊</div>
          <div className="vp-unlock-title">SchoolLive Player</div>
          <div className="vp-unlock-sub">Érintsd meg a képernyőt a hang engedélyezéséhez</div>
          <button className="vp-unlock-btn" type="button">▶ Indítás</button>
        </div>
      )}

      {/* Várakozás aktiválásra */}
      {unlocked && (status === "pending" || status === "registering") && (
        <div className="vp-pending">
          <div className="vp-pending-icon">📱</div>
          <div className="vp-pending-title">Virtuális lejátszó</div>
          <div className="vp-pending-sub">
            Ez az eszköz még nincs aktiválva.<br />
            Kérj meg egy rendszergazdát, hogy aktiválja az <strong>Eszközök</strong> menüben.
          </div>
          <div className="vp-pending-id">
            <div style={{ marginBottom:4, color:"#8da4c0", fontSize:11 }}>ESZKÖZ AZONOSÍTÓ</div>
            <div>WP-{clientId.slice(0,8).toUpperCase()}</div>
          </div>
          <div className="vp-pending-wait">
            <span className="vp-dot vp-blink" style={{ background:"#f59e0b" }} />
            Várakozás aktiválásra…
          </div>
        </div>
      )}

      {/* Főképernyő */}
      {unlocked && status === "active" && (
        <div className="vp-screen">
          {/* Header */}
          <div className="vp-header">
            <div className="vp-inst-wrap">
              <div className="vp-brand">SchoolLive</div>
              {instName ? <div className="vp-inst-name">{instName}</div> : null}
            </div>
            <div className="vp-status-txt">
              <span
                className="vp-online-dot"
                style={{ background: isOnline ? "#22c55e" : "#ef4444" }}
              />
              {isOnline ? "Online" : "Offline"}
            </div>
          </div>

          {/* Közép */}
          <div className="vp-center">
            {/* Üzenet overlay */}
            {activeMsg && (
              <div className="vp-msg-overlay">
                {activeMsg.source === "RADIO" ? (
                  <>
                    <div className="vp-msg-icon">📻</div>
                    <div className="vp-radio-title">Iskolarádió</div>
                    {progressPct > 0 && (
                      <div className="vp-progress-wrap">
                        <div className={"vp-progress-bar vp-progress-play"} style={{ width: progressPct + "%" }} />
                      </div>
                    )}
                  </>
                ) : activeMsg.action === "TTS" ? (
                  <>
                    {activeMsg.text && (
                      <div className={"vp-msg-text " + textSizeClass(activeMsg.text)}>
                        {activeMsg.text}
                      </div>
                    )}
                    <div className="vp-progress-wrap">
                      <div
                        className={"vp-progress-bar vp-progress-" + progressType}
                        style={{ width: progressPct + "%" }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="vp-msg-icon">🎵</div>
                    {progressPct > 0 && (
                      <div className="vp-progress-wrap">
                        <div className={"vp-progress-bar vp-progress-play"} style={{ width: progressPct + "%" }} />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Vízjel logo */}
            <div className="vp-watermark">
              <img src="/brand/schoollive-logo.svg" alt="" />
            </div>

            {/* Óra + dátum */}
            <div className="vp-clock" style={{ position:"relative", zIndex:1 }}>{fmtTime(time)}</div>
            <div className="vp-date"  style={{ position:"relative", zIndex:1 }}>{fmtDate(time)}</div>

            {/* Következő csengetés */}
            {bells.length > 0 && (
              <div className="vp-next-bell">
                {nextBell ? (
                  <>
                    <span className="vp-bell-icon">🔔</span>
                    <span className="vp-bell-label">Következő csengetés:</span>
                    <span className="vp-bell-time">{nextBell}</span>
                  </>
                ) : (
                  <span style={{ opacity:0.45, fontSize:"0.85em" }}>Nincs több csengetés ma</span>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="vp-footer">
            <div className="vp-footer-item">
              <span style={{ marginRight:4 }}>📱</span>
              <span>WP-{clientId.slice(0,8).toUpperCase()}</span>
            </div>
            <div className="vp-footer-item">
              <span className="vp-dot" style={{ background: bells.length > 0 ? "#22c55e" : "#ef4444" }} />
              <span>{bells.length > 0 ? bells.length + " csengő betöltve" : "Csengetési rend betöltés…"}</span>
            </div>
            <div className="vp-vol-wrap">
              <span style={{ marginRight:4 }}>🔈</span>
              <button className="vp-vol-btn" type="button" onClick={() => setVolume(function(v) { return Math.max(0, v - 1); })}>−</button>
              <span className="vp-vol-val">{volume}</span>
              <button className="vp-vol-btn" type="button" onClick={() => setVolume(function(v) { return Math.min(10, v + 1); })}>+</button>
              <span style={{ marginLeft:4 }}>🔊</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}