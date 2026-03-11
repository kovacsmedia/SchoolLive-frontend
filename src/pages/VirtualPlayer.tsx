// src/pages/VirtualPlayer.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch } from "../lib/api";

// ─── Típusok ──────────────────────────────────────────────────────────────
type PlayerStatus = "registering" | "pending" | "active";
type CommandPayload = {
  action:       string;
  url?:         string;
  text?:        string;
  title?:       string;
  durationSec?: number;
  source?:      string;
};
type BellEntry = { hour: number; minute: number; type: string; soundFile: string };
type RadioState = {
  url:         string;
  currentTime: number;
  isStream:    boolean;
  isPlaying:   boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────
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
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const next = bells
    .map(b => ({ ...b, totalMin: b.hour * 60 + b.minute }))
    .filter(b => b.totalMin > mins)
    .sort((a, b) => a.totalMin - b.totalMin)[0];
  if (!next) return null;
  return `${String(next.hour).padStart(2,"0")}:${String(next.minute).padStart(2,"0")}`;
}

// ─── Bell hangfájl cache (localStorage base64 Data URL) ───────────────────
const BELL_CACHE_PREFIX = "vpBellCache_";

async function cacheBellSound(filename: string, url: string): Promise<void> {
  const key = BELL_CACHE_PREFIX + filename;
  try { if (localStorage.getItem(key)) return; } catch { return; }
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    await new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        try { localStorage.setItem(key, reader.result as string); } catch (e) {
          console.warn("[VP] Bell cache save failed (storage full?):", e);
        }
        resolve();
      };
      reader.onerror = () => resolve();
      reader.readAsDataURL(blob);
    });
    console.log("[VP] Cached bell sound:", filename);
  } catch (e) {
    console.warn("[VP] Failed to cache bell sound:", filename, e);
  }
}

function getCachedBellUrl(filename: string, fallbackUrl: string): string {
  try {
    const cached = localStorage.getItem(BELL_CACHE_PREFIX + filename);
    if (cached) return cached;
  } catch {}
  return fallbackUrl;
}

// ─── CSS ──────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .vp-root {
    width: 100vw; height: 100vh; overflow: hidden;
    background: #07101f; font-family: 'Nunito', 'Segoe UI', sans-serif;
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
  .vp-pending-icon { font-size: 64px; animation: vp-pulse 2s ease-in-out infinite; }
  @keyframes vp-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
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
  .vp-screen { width: 100%; height: 100%; display: grid; grid-template-rows: auto 1fr auto; }
  .vp-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 36px; background: rgba(13,27,46,0.8); border-bottom: 1px solid #1a2d47;
  }
  .vp-inst-name { font-size: 18px; font-weight: 900; color: #3b82f6; }
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
  .vp-date { font-size: clamp(14px,2vw,22px); color: #8da4c0; font-weight: 700; text-transform: capitalize; }
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
    background: rgba(7,16,31,0.92); backdrop-filter: blur(8px);
    gap: 20px; padding: 40px; animation: vp-fadein 0.4s ease; z-index: 10;
  }
  @keyframes vp-fadein { from{opacity:0;transform:scale(0.96)} to{opacity:1;transform:scale(1)} }
  .vp-msg-icon  { font-size: 52px; }
  .vp-msg-title { font-size: clamp(18px,3vw,32px); font-weight: 900; color: #3b82f6; text-align: center; }
  .vp-msg-text  { font-size: clamp(14px,2.5vw,24px); color: #f0f6ff; text-align: center; line-height: 1.5; max-width: 700px; }
  .vp-audio-bar { width: 100%; max-width: 400px; height: 4px; background: #1a2d47; border-radius: 99px; overflow: hidden; margin-top: 8px; }
  .vp-audio-progress { height: 100%; background: linear-gradient(90deg,#3b82f6,#6366f1); border-radius: 99px; transition: width 0.5s linear; }
  .vp-footer {
    display: flex; align-items: center; justify-content: center;
    padding: 14px 36px; background: rgba(13,27,46,0.8); border-top: 1px solid #1a2d47;
    gap: 20px; font-size: 12px; color: #4a6280;
  }
  .vp-footer-item { display: flex; align-items: center; gap: 6px; }
  .vp-vol-wrap { display: flex; align-items: center; gap: 8px; }
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
    color: #fff; font-size: 14px; font-weight: 800;
    text-align: center; padding: 7px;
    animation: vp-fadein 0.2s ease;
  }
`;

// ═══════════════════════════════════════════════════════════════════════════
export default function VirtualPlayer() {
  const clientId = getOrCreateClientId();

  const [status,    setStatus]    = useState<PlayerStatus>("registering");
  const [time,      setTime]      = useState(new Date());
  const [bells,     setBells]     = useState<BellEntry[]>([]);
  const [instName,  setInstName]  = useState<string>("");
  const [activeMsg, setActiveMsg] = useState<CommandPayload | null>(null);
  const [audioPct,  setAudioPct]  = useState(0);
  const [volume,    setVolume]    = useState(7);
  const [isOnline,  setIsOnline]  = useState(navigator.onLine);
  const [unlocked,  setUnlocked]  = useState(false);
  const [bellBanner, setBellBanner] = useState(false);

  // Két külön audio elem: főhang (rádió/TTS) és csengő (prioritás)
  const audioRef     = useRef<HTMLAudioElement>(null);
  const bellAudioRef = useRef<HTMLAudioElement>(null);

  const pollTimer      = useRef<ReturnType<typeof setInterval> | null>(null);
  const beaconTimer    = useRef<ReturnType<typeof setInterval> | null>(null);
  const offlineBellRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Rádió állapot – megszakítás utáni folytatáshoz
  const radioStateRef = useRef<RadioState | null>(null);

  // Offline csengetés deduplikáció
  const lastBellKeyRef = useRef<string>("");

  // Ref-ek closure-okhoz
  const bellsRef  = useRef<BellEntry[]>([]);
  const volumeRef = useRef(volume);
  const activeMsgRef = useRef<CommandPayload | null>(null);

  useEffect(() => { bellsRef.current  = bells;     }, [bells]);
  useEffect(() => { volumeRef.current = volume;    }, [volume]);
  useEffect(() => { activeMsgRef.current = activeMsg; }, [activeMsg]);

  // ── Rádió folytatása megszakítás után ────────────────────────────────────
  const resumeRadio = useCallback(() => {
    const rs = radioStateRef.current;
    if (!rs || !rs.isPlaying) return;
    const a = audioRef.current;
    if (!a) return;

    if (rs.isStream) {
      // Élő stream: elejétől
      a.src = rs.url;
      a.volume = volumeRef.current / 10;
      a.load();
      a.play().catch(() => {});
    } else {
      // MP3 fájl: mentett pozícióból
      a.src = rs.url;
      a.volume = volumeRef.current / 10;
      a.load();
      const seekAndPlay = () => {
        if (rs.currentTime > 0) a.currentTime = rs.currentTime;
        a.play().catch(() => {});
        a.removeEventListener("canplay", seekAndPlay);
      };
      a.addEventListener("canplay", seekAndPlay);
    }
    setActiveMsg({ action: "PLAY_URL", url: rs.url, title: "Iskolarádió", source: "RADIO" });
    setAudioPct(0);
  }, []);

  // ── Csengetés lejátszása (legmagasabb prioritás) ──────────────────────────
  const playBell = useCallback((url: string) => {
    const mainAudio = audioRef.current;
    const bellAudio = bellAudioRef.current;
    if (!bellAudio) return;

    // Főhang szüneteltetése, de állapot megőrzése
    if (mainAudio && !mainAudio.paused && radioStateRef.current) {
      radioStateRef.current.currentTime = mainAudio.currentTime;
      mainAudio.pause();
    }

    setBellBanner(true);
    bellAudio.src = url;
    bellAudio.volume = volumeRef.current / 10;
    bellAudio.load();
    bellAudio.play().catch(err => console.warn("[VP] bell play() blocked:", err));
  }, []);

  // ── Audio lejátszás helper ───────────────────────────────────────────────
  const playAudio = useCallback((url: string) => {
    const a = audioRef.current;
    if (!a) return;
    a.src = url;
    a.volume = volumeRef.current / 10;
    a.load();
    a.play().catch(err => console.warn("[VP] play() blocked:", err));
  }, []);

  // ── Command kezelő ───────────────────────────────────────────────────────
  const handleCommand = useCallback(async (cmd: { id: string; payload: CommandPayload }) => {
    const { action, url, text, title } = cmd.payload;

    if (action === "BELL" && url) {
      // Csengetés – LEGMAGASABB PRIORITÁS, rádió fölé megy
      playBell(url);

    } else if (action === "PLAY_URL" && url) {
      // Rádió indítása
      const isStream = !url.match(/\.(mp3|wav|ogg|aac|m4a)(\?|$)/i);
      radioStateRef.current = { url, currentTime: 0, isStream, isPlaying: true };
      setActiveMsg({ action, url, title: title ?? "Iskolarádió", source: cmd.payload.source });
      setAudioPct(0);
      playAudio(url);

    } else if (action === "TTS" && url) {
      // TTS üzenet – rádió szüneteltetése, de NEM töröljük az állapotát
      const mainAudio = audioRef.current;
      if (mainAudio && radioStateRef.current?.isPlaying && !mainAudio.paused) {
        radioStateRef.current.currentTime = mainAudio.currentTime;
        mainAudio.pause();
      }
      setActiveMsg({ action, url, text, title: title ?? "Üzenet" });
      setAudioPct(0);
      playAudio(url);
    }

    await apiFetch("/player/device/ack", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: cmd.id }),
    }).catch(() => {});
  }, [playAudio, playBell]);

  // ── Bell hangfájlok cache-elése ──────────────────────────────────────────
  const cacheBells = useCallback(async (bellList: BellEntry[]) => {
    const unique = Array.from(new Set(bellList.map(b => b.soundFile)));
    for (const filename of unique) {
      const url = `https://api.schoollive.hu/audio/bells/${filename}`;
      await cacheBellSound(filename, url);
    }
  }, []);

  // ── Offline csengetés ticker (30 mp-enként fut) ──────────────────────────
  const offlineBellTick = useCallback(() => {
    const now = new Date();
    const h   = now.getHours();
    const m   = now.getMinutes();
    const s   = now.getSeconds();
    const key = `${h}:${m}`;

    // Csak az adott perc első 30 mp-ében játssza le
    if (s > 30) return;
    if (lastBellKeyRef.current === key) return;

    const due = bellsRef.current.find(b => b.hour === h && b.minute === m);
    if (!due) return;

    lastBellKeyRef.current = key;
    const url = getCachedBellUrl(due.soundFile, `https://api.schoollive.hu/audio/bells/${due.soundFile}`);
    console.log(`[VP-BELL] ${key} → ${due.soundFile} (${url.startsWith("data:") ? "cached" : "network"})`);
    playBell(url);
  }, [playBell]);

  // ── Autoplay unlock ──────────────────────────────────────────────────────
  const unlockAudio = useCallback(() => {
    const a    = audioRef.current;
    const bell = bellAudioRef.current;
    const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    const tryUnlock = (el: HTMLAudioElement | null) => {
      if (!el) return Promise.resolve();
      el.src = SILENT; el.volume = 0;
      return el.play().then(() => el.pause()).catch(() => {});
    };
    Promise.all([tryUnlock(a), tryUnlock(bell)]).finally(() => {
      if (a)    { a.src    = ""; a.volume    = volumeRef.current / 10; }
      if (bell) { bell.src = ""; bell.volume = volumeRef.current / 10; }
      setUnlocked(true);
    });
  }, []);

  // ── Regisztráció ─────────────────────────────────────────────────────────
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

  // ── Logout on page unload (session felszabadítás) ──────────────────────
  useEffect(() => {
    const onUnload = () => {
      const token = sessionStorage.getItem("accessToken") ?? localStorage.getItem("accessToken") ?? "";
      if (!token) return;
      try {
        navigator.sendBeacon(
          "https://api.schoollive.hu/auth/logout",
          new Blob([JSON.stringify({})], { type: "application/json" })
        );
      } catch {}
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  // ── Fullscreen + Wake Lock ───────────────────────────────────────────────
  useEffect(() => {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
    let wakeLock: WakeLockSentinel | null = null;
    (async () => {
      try { if ("wakeLock" in navigator) wakeLock = await (navigator as any).wakeLock.request("screen"); } catch {}
    })();
    const onOnline  = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      wakeLock?.release().catch(() => {});
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // ── Óra ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Intézmény neve + csengetési rend + cache ─────────────────────────────
  const fetchBells = useCallback(() => {
    apiFetch<{ ok: boolean; bells?: BellEntry[] }>("/bells/today")
      .then(r => { if (r.bells) { setBells(r.bells); cacheBells(r.bells); } })
      .catch(() => {});
  }, [cacheBells]);

  useEffect(() => {
    if (status !== "active") return;
    const token = sessionStorage.getItem("accessToken") ?? localStorage.getItem("accessToken") ?? "";
    if (token) {
      try {
        const p = JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
        setInstName(p.tenantName ?? p.tenant?.name ?? "");
      } catch {}
    }
    fetchBells();
    // 5 percenként újraszinkronizálja a csengetési rendet
    const bellSyncTimer = setInterval(fetchBells, 5 * 60 * 1000);
    return () => clearInterval(bellSyncTimer);
  }, [status, fetchBells]);

  // ── Offline bell ticker indítása ─────────────────────────────────────────
  useEffect(() => {
    if (status !== "active") return;
    offlineBellTick();
    offlineBellRef.current = setInterval(offlineBellTick, 30_000);
    return () => { if (offlineBellRef.current) clearInterval(offlineBellRef.current); };
  }, [status, offlineBellTick]);

  // ── Regisztráció indítása ────────────────────────────────────────────────
  useEffect(() => { void register(); }, [register]);

  // ── Polling ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === "registering") return;
    const poll = async () => {
      try {
        const res = await apiFetch<{ ok: boolean; status: string; command: { id: string; payload: CommandPayload } | null }>(
          "/player/device/poll", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
        );
        if (res.status === "active" && status !== "active") setStatus("active");
        if (res.status === "active" && res.command) await handleCommand(res.command);
      } catch {}
    };
    poll();
    pollTimer.current = setInterval(poll, 5000);
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ── Beacon ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== "active") return;
    const beacon = async () => {
      const ip = await getPublicIp();
      apiFetch("/player/device/beacon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, ipAddress: ip }) }).catch(() => {});
    };
    beacon();
    beaconTimer.current = setInterval(beacon, 30000);
    return () => { if (beaconTimer.current) clearInterval(beaconTimer.current); };
  }, [status, clientId]);

  // ── Hangerő ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (audioRef.current)     audioRef.current.volume     = volume / 10;
    if (bellAudioRef.current) bellAudioRef.current.volume = volume / 10;
  }, [volume]);

  // ── Audio event handlers ─────────────────────────────────────────────────
  const onMainTimeUpdate = () => {
    const a = audioRef.current;
    if (a?.duration) {
      setAudioPct((a.currentTime / a.duration) * 100);
      // Rádió pozíció folyamatos mentése
      if (radioStateRef.current?.isPlaying && !radioStateRef.current.isStream) {
        radioStateRef.current.currentTime = a.currentTime;
      }
    }
  };

  const onMainEnded = () => {
    const msg = activeMsgRef.current;
    if (msg?.action === "TTS") {
      // TTS véget ért → rádió folytatása ha volt
      setActiveMsg(null);
      setAudioPct(0);
      if (radioStateRef.current?.isPlaying) resumeRadio();
    } else {
      // Rádió fájl véget ért
      radioStateRef.current = null;
      setActiveMsg(null);
      setAudioPct(0);
    }
  };

  const onMainError = () => {
    setActiveMsg(null);
    setAudioPct(0);
    if (radioStateRef.current?.isPlaying) resumeRadio();
  };

  const onBellEnded = () => {
    setBellBanner(false);
    // Csengő után rádió folytatása ha volt
    if (radioStateRef.current?.isPlaying) resumeRadio();
  };

  const nextBell = nextBellLabel(bells);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="vp-root">
      <style>{CSS}</style>

      {/* Főhang – rádió és TTS, mindig mounted */}
      <audio
        ref={audioRef}
        onTimeUpdate={onMainTimeUpdate}
        onEnded={onMainEnded}
        onError={onMainError}
        style={{ display: "none" }}
      />

      {/* Csengő audio – külön elem, legmagasabb prioritás */}
      <audio
        ref={bellAudioRef}
        onEnded={onBellEnded}
        onError={() => { setBellBanner(false); if (radioStateRef.current?.isPlaying) resumeRadio(); }}
        style={{ display: "none" }}
      />

      {/* Csengetés jelzősáv */}
      {bellBanner && <div className="vp-bell-banner">🔔 Csengetés</div>}

      {/* Autoplay unlock overlay */}
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
          <div className="vp-pending-sub">Ez az eszköz még nincs aktiválva.<br />Kérj meg egy rendszergazdát, hogy aktiválja az <strong>Eszközök</strong> menüben.</div>
          <div className="vp-pending-id">
            <div style={{ marginBottom:6, color:"#8da4c0", fontSize:11, textTransform:"uppercase", letterSpacing:"0.8px" }}>Eszköz azonosító</div>
            <div>WP-{clientId.slice(0,8).toUpperCase()}</div>
          </div>
          <div style={{ fontSize:13, color:"#4a6280", display:"flex", alignItems:"center" }}>
            <span className="vp-pending-dot" />Várakozás aktiválásra…
          </div>
        </div>
      )}

      {unlocked && status === "active" && (
        <div className="vp-screen">
          <div className="vp-header">
            <div className="vp-inst-name">{instName || "SchoolLive"}</div>
            <div className="vp-status-txt">
              <span className="vp-online-dot" style={{ background: isOnline ? "#22c55e" : "#ef4444", boxShadow: isOnline ? "0 0 8px #22c55e" : "none" }} />
              {isOnline ? "Online" : "Offline"}
            </div>
          </div>
          <div className="vp-center">
            {activeMsg && (
              <div className="vp-msg-overlay">
                <div className="vp-msg-icon">{activeMsg.source === "RADIO" ? "📻" : activeMsg.action === "TTS" ? "📢" : "🎵"}</div>
                {activeMsg.title && <div className="vp-msg-title">{activeMsg.title}</div>}
                {activeMsg.text  && <div className="vp-msg-text">{activeMsg.text}</div>}
                <div className="vp-audio-bar"><div className="vp-audio-progress" style={{ width:`${audioPct}%` }} /></div>
              </div>
            )}
            <div className="vp-clock">{fmtTime(time)}</div>
            <div className="vp-date">{fmtDate(time)}</div>
            {nextBell && (
              <div className="vp-next-bell">
                <span className="vp-bell-icon">🔔</span>
                <span className="vp-bell-label">Következő csengetés:</span>
                <span className="vp-bell-time">{nextBell}</span>
              </div>
            )}
          </div>
          <div className="vp-footer">
            <div className="vp-footer-item"><span style={{ fontSize:14 }}>📱</span><span>Virtuális lejátszó · WP-{clientId.slice(0,8).toUpperCase()}</span></div>
            <div className="vp-vol-wrap">
              <span style={{ fontSize:13 }}>🔈</span>
              <button className="vp-vol-btn" onClick={() => setVolume(v => Math.max(0, v-1))} type="button">−</button>
              <span className="vp-vol-val">{volume}</span>
              <button className="vp-vol-btn" onClick={() => setVolume(v => Math.min(10, v+1))} type="button">+</button>
              <span style={{ fontSize:13 }}>🔊</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}