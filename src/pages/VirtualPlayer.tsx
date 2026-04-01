// src/pages/VirtualPlayer.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch } from "../lib/api";

// ─── Típusok ──────────────────────────────────────────────────────────────────
type PlayerStatus = "registering" | "pending" | "active";
type CommandPayload = {
  action:       string;
  url?:         string;
  text?:        string;
  title?:       string;
  durationSec?: number;
  source?:      string;
};
type BellEntry    = { hour: number; minute: number; type: string; soundFile: string };
type RadioState   = { url: string; currentTime: number; isStream: boolean; isPlaying: boolean };
type PrepareCmd   = { phase: "PREPARE"; commandId: string; action: string; url?: string; text?: string; title?: string; prepareDeadline: string };
type PlayCmd      = { phase: "PLAY"; commandId: string; playAt: string };

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
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const next = bells
    .map(b => ({ ...b, totalMin: b.hour * 60 + b.minute }))
    .filter(b => b.totalMin > mins)
    .sort((a, b) => a.totalMin - b.totalMin)[0];
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

// ─── Bell hangfájl cache ──────────────────────────────────────────────────────
const DEFAULT_SOUNDS = ["jelzo.mp3", "kibe.mp3"];
const API_BASE       = "https://api.schoollive.hu";
const WS_URL         = "wss://api.schoollive.hu/sync";
const WS_RECONNECT_MS = 3_000;
const BELL_DB_NAME   = "sl-bells-v3";
const BELL_STORE     = "ab";

const bellBuffers  = new Map<string, AudioBuffer>();
let   audioCtx: AudioContext | null = null;
let   idbConn: IDBDatabase  | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}
function unlockAudioCtx(): void {
  const ctx = getAudioCtx();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
}

async function getIDB(): Promise<IDBDatabase> {
  if (idbConn) return idbConn;
  return new Promise((res, rej) => {
    const r = indexedDB.open(BELL_DB_NAME, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(BELL_STORE)) r.result.createObjectStore(BELL_STORE); };
    r.onsuccess = () => { idbConn = r.result; res(r.result); };
    r.onerror   = () => rej(r.error);
  });
}
async function idbRead(name: string): Promise<ArrayBuffer | null> {
  try {
    const db = await getIDB();
    return await new Promise((res, rej) => {
      const r = db.transaction(BELL_STORE, "readonly").objectStore(BELL_STORE).get(name);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror   = () => rej(r.error);
    });
  } catch { return null; }
}
async function idbWrite(name: string, buf: ArrayBuffer): Promise<void> {
  try {
    const db = await getIDB();
    await new Promise<void>((res, rej) => {
      const r = db.transaction(BELL_STORE, "readwrite").objectStore(BELL_STORE).put(buf, name);
      r.onsuccess = () => res();
      r.onerror   = () => rej(r.error);
    });
  } catch {}
}
async function idbAllKeys(): Promise<string[]> {
  try {
    const db = await getIDB();
    return await new Promise((res, rej) => {
      const r = db.transaction(BELL_STORE, "readonly").objectStore(BELL_STORE).getAllKeys();
      r.onsuccess = () => res(r.result as string[]);
      r.onerror   = () => rej(r.error);
    });
  } catch { return []; }
}

async function loadBellSound(name: string): Promise<boolean> {
  if (bellBuffers.has(name)) return true;
  let buf: ArrayBuffer | null = null;
  buf = await idbRead(name);
  if (buf) {
    console.log(`[BELL] 📦 IDB: ${name} (${(buf.byteLength/1024).toFixed(0)} KB)`);
  } else {
    try {
      const resp = await fetch(`${API_BASE}/audio/bells/${name}`, { cache: "reload" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      buf = await resp.arrayBuffer();
      console.log(`[BELL] ⬇️ Letöltve: ${name} (${(buf.byteLength/1024).toFixed(0)} KB)`);
      idbWrite(name, buf.slice(0)).catch(() => {});
    } catch (e) {
      console.error(`[BELL] ❌ Letöltés sikertelen: ${name}`, e);
      return false;
    }
  }
  try {
    const ctx = getAudioCtx();
    const audio = await ctx.decodeAudioData(buf.slice(0));
    bellBuffers.set(name, audio);
    console.log(`[BELL] ✅ Kész: ${name}`);
    return true;
  } catch (e) {
    console.error(`[BELL] ❌ Dekódolás sikertelen: ${name}`, e);
    return false;
  }
}

async function pruneOldSounds(keep: string[]): Promise<void> {
  const keepSet = new Set([...keep, ...DEFAULT_SOUNDS]);
  const keys    = await idbAllKeys();
  for (const k of keys) {
    if (!keepSet.has(k)) {
      try {
        const db = await getIDB();
        db.transaction(BELL_STORE, "readwrite").objectStore(BELL_STORE).delete(k);
      } catch {}
      bellBuffers.delete(k);
    }
  }
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
  .vp-msg-overlay.vp-msg-fadeout { animation: vp-fadeout 0.5s ease forwards; }
  @keyframes vp-fadein  { from{opacity:0;transform:scale(0.97)} to{opacity:1;transform:scale(1)} }
  @keyframes vp-fadeout { from{opacity:1} to{opacity:0} }
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
  .vp-msg-progress-wrap {
    width: min(500px, 80vw); height: 5px;
    background: #1a2d47; border-radius: 99px; overflow: hidden;
  }
  .vp-msg-progress {
    height: 100%; border-radius: 99px;
    background: linear-gradient(90deg,#3b82f6,#6366f1);
    transition: width 0.5s linear;
  }
  .vp-msg-reading-progress {
    height: 100%; border-radius: 99px;
    background: linear-gradient(90deg,#22c55e,#3b82f6);
    transition: width 0.25s linear;
  }
  .vp-msg-linger-progress {
    height: 100%; border-radius: 99px;
    background: linear-gradient(90deg,#f59e0b,#ef4444);
    transition: width 0.25s linear;
  }
  .vp-radio-title {
    font-size: clamp(22px,4vw,52px); font-weight: 900;
    color: #3b82f6; text-align: center; letter-spacing: -0.5px;
    text-shadow: 0 0 40px rgba(59,130,246,0.5);
  }
  .vp-radio-timeleft {
    font-size: clamp(14px,2vw,24px); font-weight: 700;
    color: #8da4c0; font-variant-numeric: tabular-nums; letter-spacing: 1px;
  }
  .vp-audio-bar { width: 100%; max-width: 400px; height: 4px; background: #1a2d47; border-radius: 99px; overflow: hidden; margin-top: 8px; }
  .vp-audio-progress { height: 100%; background: linear-gradient(90deg,#3b82f6,#6366f1); border-radius: 99px; transition: width 0.5s linear; }
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
  .vp-cache-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    margin-right: 4px; vertical-align: middle;
  }
`;

// ═══════════════════════════════════════════════════════════════════════════════
export default function VirtualPlayer() {
  const clientId = getOrCreateClientId();

  const [status,     setStatus]     = useState<PlayerStatus>("registering");
  const [time,       setTime]       = useState(new Date());
  const correctedNow = () => new Date(Date.now() + serverTimeOffsetRef.current);
  const [bells,      setBells]      = useState<BellEntry[]>([]);
  const [instName,   setInstName]   = useState<string>("");
  const [activeMsg,  setActiveMsg]  = useState<CommandPayload | null>(null);
  const [msgFadeout, setMsgFadeout] = useState(false);
  const [audioPct,   setAudioPct]   = useState(0);
  const [readingPct, setReadingPct] = useState(0);
  const [volume,     setVolume]     = useState(7);
  const [isOnline,   setIsOnline]   = useState(navigator.onLine);
  const [unlocked,   setUnlocked]   = useState(false);
  const [bellBanner,      setBellBanner]      = useState(false);
  const [cachedBellCount, setCachedBellCount] = useState(0);
  const [timeLeft,        setTimeLeft]        = useState<number|null>(null);
  const [lingerPct,       setLingerPct]       = useState(0);

  const audioRef     = useRef<HTMLAudioElement>(null);
  const bellAudioRef = useRef<HTMLAudioElement>(null);

  const pollTimer      = useRef<ReturnType<typeof setInterval> | null>(null);
  const beaconTimer    = useRef<ReturnType<typeof setInterval> | null>(null);
  const offlineBellRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const readingTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const dismissTimer   = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const lingerTimer    = useRef<ReturnType<typeof setInterval> | null>(null);
  const dismissGenRef  = useRef(0);

  const radioStateRef  = useRef<RadioState | null>(null);

  const wsRef               = useRef<WebSocket | null>(null);
  const wsReconnectRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverTimeOffsetRef = useRef<number>(0);

  const pendingPreparesRef = useRef<Map<string, {
    audio:       HTMLAudioElement;
    audioBuffer: AudioBuffer | null;
    startedAt:   number;
    action:      string;
    url?:        string;
    text?:       string;
    title?:      string;
  }>>(new Map());

  const activeMsgActionRef = useRef<string>("");
  const lastBellKeyRef     = useRef<string>("");
  const wakeLockRef        = useRef<WakeLockSentinel | null>(null);
  const keepAliveRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const bellsRef           = useRef<BellEntry[]>([]);
  const volumeRef          = useRef(volume);

  useEffect(() => { bellsRef.current  = bells;  }, [bells]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  // ── Üzenet overlay eltüntetése ────────────────────────────────────────────
  const dismissMsg = useCallback(() => {
    if (readingTimer.current) { clearInterval(readingTimer.current); readingTimer.current = null; }
    if (dismissTimer.current) { clearTimeout(dismissTimer.current);  dismissTimer.current = null; }
    if (lingerTimer.current)  { clearInterval(lingerTimer.current);  lingerTimer.current  = null; }
    setMsgFadeout(true);
    const gen = ++dismissGenRef.current;
    setTimeout(() => {
      if (dismissGenRef.current !== gen) return;
      setActiveMsg(null);
      setAudioPct(0);
      setReadingPct(0);
      setLingerPct(0);
      setTimeLeft(null);
      setMsgFadeout(false);
      activeMsgActionRef.current = "";
    }, 500);
  }, []);

  // ── Üzenet megjelenítése ──────────────────────────────────────────────────
  const showMsg = useCallback((payload: CommandPayload, readingMs?: number) => {
    if (dismissTimer.current) { clearTimeout(dismissTimer.current);  dismissTimer.current = null; }
    if (readingTimer.current) { clearInterval(readingTimer.current); readingTimer.current = null; }
    if (lingerTimer.current)  { clearInterval(lingerTimer.current);  lingerTimer.current  = null; }
    dismissGenRef.current++;
    activeMsgActionRef.current = payload.action;
    setActiveMsg(payload);
    setMsgFadeout(false);
    setAudioPct(0);
    setReadingPct(0);
    setLingerPct(0);
    setTimeLeft(null);

    if (readingMs && readingMs > 0) {
      const startTime = Date.now();
      readingTimer.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const pct = Math.min(100, (elapsed / readingMs) * 100);
        setReadingPct(pct);
        if (elapsed >= readingMs) {
          if (readingTimer.current) { clearInterval(readingTimer.current); readingTimer.current = null; }
        }
      }, 100);
      dismissTimer.current = setTimeout(dismissMsg, readingMs);
    }
  }, [dismissMsg]);

  // ── Rádió folytatása megszakítás után ─────────────────────────────────────
  const resumeRadio = useCallback(() => {
    const rs = radioStateRef.current;
    if (!rs || !rs.isPlaying) return;
    const a = audioRef.current;
    if (!a) return;
    a.volume = volumeRef.current / 10;
    if (rs.isStream) {
      a.src = rs.url + (rs.url.includes("?") ? "&" : "?") + "_r=" + Date.now();
      a.load();
      a.play().catch(e => console.warn("[VP] stream resume blocked:", e));
    } else {
      a.src = rs.url;
      a.load();
      const seekAndPlay = () => {
        a.removeEventListener("canplay", seekAndPlay);
        if (rs.currentTime > 0) { try { a.currentTime = rs.currentTime; } catch {} }
        a.play().catch(e => console.warn("[VP] mp3 resume blocked:", e));
      };
      a.addEventListener("canplay", seekAndPlay);
    }
    showMsg({ action: "PLAY_URL", url: rs.url, title: "Iskolarádió", source: "RADIO" });
  }, [showMsg]);

  // ── Csengetés lejátszása ───────────────────────────────────────────────────
  const playBell = useCallback((soundFile: string, fallbackUrl: string) => {
    const mainAudio = audioRef.current;
    if (mainAudio && !mainAudio.paused && radioStateRef.current?.isPlaying) {
      radioStateRef.current.currentTime = mainAudio.currentTime;
      mainAudio.pause();
    }
    setBellBanner(true);
    const buffer = bellBuffers.get(soundFile);
    if (buffer) {
      const ctx = getAudioCtx();
      const resume = () => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.value = volumeRef.current / 10;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.onended = () => {
          setBellBanner(false);
          if (radioStateRef.current?.isPlaying) setTimeout(resumeRadio, 200);
        };
        source.start(0);
      };
      if (ctx.state === "suspended") {
        ctx.resume().then(resume).catch(() => setBellBanner(false));
      } else {
        resume();
      }
    } else {
      const bellAudio = bellAudioRef.current;
      if (!bellAudio) { setBellBanner(false); return; }
      bellAudio.src = fallbackUrl;
      bellAudio.volume = volumeRef.current / 10;
      bellAudio.load();
      bellAudio.play().catch(err => {
        console.warn("[VP-BELL] fallback play() blocked:", err);
        setBellBanner(false);
      });
    }
  }, [resumeRadio]);

  // ── Audio lejátszás helper ─────────────────────────────────────────────────
  const playAudio = useCallback((url: string) => {
    const a = audioRef.current;
    if (!a) return;
    a.src = url;
    a.volume = volumeRef.current / 10;
    a.load();
    a.play().catch(err => console.warn("[VP] play() blocked:", err));
  }, []);

  // ── Bell cache ─────────────────────────────────────────────────────────────
  const cacheBells = useCallback(async (bellList: BellEntry[]) => {
    const todaySounds = Array.from(new Set(bellList.map(b => b.soundFile)));
    const allNeeded   = Array.from(new Set([...todaySounds, ...DEFAULT_SOUNDS]));
    await pruneOldSounds(todaySounds);
    const ctx = getAudioCtx();
    const canDecode = ctx.state !== "suspended";
    let ready = 0;
    for (const name of allNeeded) {
      if (canDecode) {
        const ok = await loadBellSound(name);
        if (ok) ready++;
      } else {
        const cached = await idbRead(name);
        if (!cached) {
          try {
            const resp = await fetch(`${API_BASE}/audio/bells/${name}`, { cache: "reload" });
            if (resp.ok) { const buf = await resp.arrayBuffer(); await idbWrite(name, buf); ready++; }
          } catch (e) { console.error(`[BELL] ❌ ${name}`, e); }
        } else { ready++; }
      }
    }
    console.log(`[BELL] ${canDecode ? "✅ Kész" : "💾 IDB-ben"}: ${ready}/${allNeeded.length} hang`);
    setCachedBellCount(bellBuffers.size);
  }, []);

  // ── Csengetési rend lekérdezése ───────────────────────────────────────────
  const fetchBells = useCallback(() => {
    apiFetch<{ ok: boolean; bells?: BellEntry[] }>("/bells/today")
      .then(r => {
        if (r.bells && r.bells.length > 0) {
          setBells(r.bells);
          void cacheBells(r.bells);
        }
      })
      .catch(e => console.error("[VP-BELL] ❌ fetchBells hiba:", e));
  }, [cacheBells]);

  // ── Command kezelő ────────────────────────────────────────────────────────
  const handleCommand = useCallback(async (cmd: { id: string; payload: CommandPayload }) => {
    const { action, url, text, title } = cmd.payload;
    console.log(`[VP] 📨 Command: ${action}`, url ?? text ?? "");

    // Ha WebSocket aktív, TTS és PLAY_URL a PREPARE/PLAY flow-on jön
    // Ne játssza le a polling is → dupla lejátszás elkerülése
    const wsConnected = wsRef.current?.readyState === WebSocket.OPEN;
    if (wsConnected && (action === "TTS" || action === "PLAY_URL")) {
      console.log(`[VP] Polling ${action} kihagyva – WS aktív`);
      await apiFetch("/player/device/ack", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandId: cmd.id }),
      }).catch(() => {});
      return;
    }

    if (action === "BELL" && url) {
      const now = new Date();
      const bellKey = `${now.getHours()}:${now.getMinutes()}`;
      if (lastBellKeyRef.current === bellKey) {
        console.log(`[VP-BELL] ⏭ BELL kihagyva (offline ticker már lejátszta): ${bellKey}`);
      } else {
        lastBellKeyRef.current = bellKey;
        const soundFile = url.split("/").pop() ?? url;
        const absoluteUrl = url.startsWith("http")
          ? url
          : `https://api.schoollive.hu${url.startsWith("/") ? url : "/audio/bells/" + soundFile}`;
        playBell(soundFile, absoluteUrl);
      }
    } else if (action === "SYNC_BELLS") {
      fetchBells();
    } else if (action === "PLAY_URL" && url) {
      const isStream = !url.match(/\.(mp3|wav|ogg|aac|m4a)(\?|$)/i);
      radioStateRef.current = { url, currentTime: 0, isStream, isPlaying: true };
      showMsg({ action, url, title: title ?? "Iskolarádió", source: cmd.payload.source });
      playAudio(url);
    } else if (action === "TTS" && url) {
      const mainAudio = audioRef.current;
      if (mainAudio && radioStateRef.current?.isPlaying && !mainAudio.paused) {
        radioStateRef.current.currentTime = mainAudio.currentTime;
        mainAudio.pause();
      }
      const readingMs = text ? calcReadingMs(text) : 0;
      showMsg({ action, url, text, title: title ?? "Üzenet" }, readingMs);
      playAudio(url);
    } else if (action === "STOP_PLAYBACK") {
      const a = audioRef.current;
      if (a) { a.pause(); a.src = ""; }
      radioStateRef.current = null;
      dismissMsg();
    }

    await apiFetch("/player/device/ack", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: cmd.id }),
    }).catch(() => {});
  }, [playAudio, playBell, fetchBells, showMsg, dismissMsg]);

  // ── Crystal Clock Sync ────────────────────────────────────────────────────
  const syncClock = useCallback(async () => {
    const samples: Array<{ offset: number; rtt: number }> = [];
    for (let i = 0; i < 8; i++) {
      try {
        const t0 = performance.now();
        const r  = await fetch(`${API_BASE}/time`, { cache: "no-store" });
        const t1 = performance.now();
        const { now: serverNow } = await r.json();
        const rtt = t1 - t0;
        if (rtt < 200) {
          const t0epoch = Date.now() - (performance.now() - t0);
          samples.push({ offset: serverNow - (t0epoch + rtt / 2), rtt });
        }
      } catch {}
      await new Promise(res => setTimeout(res, 100));
    }
    if (samples.length === 0) return;
    samples.sort((a, b) => a.rtt - b.rtt);
    const best = samples.slice(0, Math.min(5, samples.length)).map(s => s.offset);
    best.sort((a, b) => a - b);
    serverTimeOffsetRef.current = best[Math.floor(best.length / 2)];
    console.log(`[VP-SYNC] ⏱ Offset: ${serverTimeOffsetRef.current.toFixed(1)}ms`);
  }, []);

  // ── PREPARE handler ───────────────────────────────────────────────────────
  const handlePrepare = useCallback(async (cmd: PrepareCmd) => {
    console.log(`[VP-SYNC] 📦 PREPARE: ${cmd.action} commandId=${cmd.commandId}`);
    const startedAt = Date.now();

    if (!cmd.url) {
      wsRef.current?.send(JSON.stringify({
        type: "READY_ACK", commandId: cmd.commandId,
        deviceId: clientId, readyAt: new Date().toISOString(), bufferMs: 0,
      }));
      return;
    }

    if (cmd.action === "BELL" && cmd.url) {
      const soundFile = cmd.url.split("/").pop() ?? "";
      if (bellBuffers.has(soundFile)) {
        const bufferMs = Date.now() - startedAt;
        const audio = new Audio();
        audio.src = cmd.url;
        pendingPreparesRef.current.set(cmd.commandId, {
          audio, audioBuffer: null, startedAt,
          action: cmd.action, url: cmd.url, text: cmd.text, title: cmd.title,
        });
        wsRef.current?.send(JSON.stringify({
          type: "READY_ACK", commandId: cmd.commandId,
          deviceId: clientId, readyAt: new Date().toISOString(), bufferMs,
        }));
        return;
      }
    }

    const audio = new Audio();
    audio.preload = "auto";
    audio.volume  = volumeRef.current / 10;
    audio.src     = cmd.url;

    pendingPreparesRef.current.set(cmd.commandId, {
      audio, audioBuffer: null, startedAt,
      action: cmd.action, url: cmd.url, text: cmd.text, title: cmd.title,
    });

    const deadline  = new Date(cmd.prepareDeadline).getTime();
    const timeoutMs = Math.max(100, deadline - Date.now() - 200);

    let audioBuffer: AudioBuffer | null = null;
    try {
      const ctx = getAudioCtx();
      if (ctx.state !== "suspended") {
        const fetchAndDecode = fetch(cmd.url)
          .then(r => r.arrayBuffer())
          .then(buf => ctx.decodeAudioData(buf));
        audioBuffer = await Promise.race([
          fetchAndDecode,
          new Promise<null>((_, reject) => setTimeout(() => reject("timeout"), timeoutMs))
        ]) as AudioBuffer | null;
        if (audioBuffer) {
          const entry = pendingPreparesRef.current.get(cmd.commandId);
          if (entry) entry.audioBuffer = audioBuffer;
        }
      }
    } catch {}

    if (!audioBuffer) {
      await new Promise<void>((resolve) => {
        const done = () => { audio.removeEventListener("canplaythrough", done); resolve(); };
        audio.addEventListener("canplaythrough", done);
        setTimeout(resolve, timeoutMs);
        audio.load();
      });
    }

    const bufferMs = Date.now() - startedAt;
    wsRef.current?.send(JSON.stringify({
      type: "READY_ACK", commandId: cmd.commandId,
      deviceId: clientId, readyAt: new Date().toISOString(), bufferMs,
    }));
  }, [clientId]);

  // ── PLAY handler ──────────────────────────────────────────────────────────
  // FIX: TTS/PLAY_URL audioRef.current-en keresztül → onMainEnded lefut
  const handlePlay = useCallback((cmd: PlayCmd) => {
    const serverNow = Date.now() + serverTimeOffsetRef.current;
    const delayMs   = Math.max(0, new Date(cmd.playAt).getTime() - serverNow);
    const delaySec  = delayMs / 1000;
    console.log(`[VP-SYNC] 🎵 PLAY in ${delayMs}ms: commandId=${cmd.commandId}`);

    const prepare = pendingPreparesRef.current.get(cmd.commandId);
    if (!prepare) return;

    // ── BELL: AudioContext sample-accurate scheduling ──────────────────────
    if (prepare.audioBuffer && prepare.action === "BELL") {
      try {
        const ctx = getAudioCtx();
        if (ctx.state !== "suspended") {
          const scheduleAt = ctx.currentTime + delaySec;
          const source = ctx.createBufferSource();
          source.buffer = prepare.audioBuffer;
          const gain = ctx.createGain();
          gain.gain.value = volumeRef.current / 10;
          source.connect(gain);
          gain.connect(ctx.destination);
          source.start(Math.max(ctx.currentTime, scheduleAt));
          pendingPreparesRef.current.delete(cmd.commandId);
          console.log(`[VP-SYNC] 🔔 BELL AudioContext @ ctx+${delaySec.toFixed(3)}s`);
          return;
        }
      } catch (e) {
        console.warn("[VP-SYNC] AudioContext schedule hiba:", e);
      }
    }

    // ── TTS / PLAY_URL: audioRef.current-en keresztül ─────────────────────
    // onMainTimeUpdate és onMainEnded lefut → progress, linger, radio resume OK
    if (prepare.url && (prepare.action === "TTS" || prepare.action === "PLAY_URL")) {
      const url = prepare.url;
      setTimeout(() => {
        const a = audioRef.current;
        if (a) {
          a.src    = url;
          a.volume = volumeRef.current / 10;
          a.load();
          a.play().catch(e => console.warn("[VP-SYNC] play blocked:", e));
        }
        pendingPreparesRef.current.delete(cmd.commandId);
      }, Math.max(0, delayMs));
      return;
    }

    // ── Fallback: prepare.audio elem ──────────────────────────────────────
    if (!prepare.audio) return;
    setTimeout(() => {
      prepare.audio.volume = volumeRef.current / 10;
      prepare.audio.play().catch(e => console.warn("[VP-SYNC] play blocked:", e));
      pendingPreparesRef.current.delete(cmd.commandId);
    }, Math.max(0, delayMs));
  }, []);

  // ── WebSocket kapcsolat ────────────────────────────────────────────────────
  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const token = sessionStorage.getItem("accessToken") ?? localStorage.getItem("accessToken") ?? "";
    if (!token) return;

    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[VP-SYNC] 🔌 WebSocket csatlakozva");
      void syncClock();
      setTimeout(() => void syncClock(), 2000);
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);

        if (msg.type === "HELLO") {
          const serverNow = new Date(msg.serverNow).getTime();
          serverTimeOffsetRef.current = serverNow - Date.now();
          return;
        }

        if (msg.phase === "PREPARE") {
          void handlePrepare(msg as PrepareCmd);
          return;
        }

        if (msg.phase === "PLAY") {
          const playCmd = msg as PlayCmd;
          const prepare    = pendingPreparesRef.current.get(playCmd.commandId);
          const serverNow  = Date.now() + serverTimeOffsetRef.current;
          const delayMs    = Math.max(0, new Date(playCmd.playAt).getTime() - serverNow);

          // 1. Audio lejátszás ütemezése
          handlePlay(playCmd);

          // 2. Overlay megjelenítése pontosan playAt-kor
          if (prepare) {
            const overlayPayload: CommandPayload = {
              action: prepare.action as CommandPayload["action"],
              url:    prepare.url,
              text:   prepare.text,
              title:  prepare.title ?? (
                prepare.action === "TTS"      ? "Üzenet"      :
                prepare.action === "PLAY_URL" ? "Iskolarádió" : undefined
              ),
              source: prepare.action === "PLAY_URL" ? "RADIO" : undefined,
            };

            const showOverlay = () => {
              if (prepare.action === "TTS") {
                const readingMs = prepare.text ? calcReadingMs(prepare.text) : 0;
                showMsg(overlayPayload, readingMs);
                const mainAudio = audioRef.current;
                if (mainAudio && radioStateRef.current?.isPlaying && !mainAudio.paused) {
                  radioStateRef.current.currentTime = mainAudio.currentTime;
                  mainAudio.pause();
                }
              } else if (prepare.action === "PLAY_URL" && prepare.url) {
                const isStream = !prepare.url.match(/\.(mp3|wav|ogg|aac|m4a)(\?|$)/i);
                radioStateRef.current = {
                  url: prepare.url, currentTime: 0, isStream, isPlaying: true,
                };
                showMsg(overlayPayload);
              }
            };

            if (delayMs > 50) setTimeout(showOverlay, delayMs);
            else showOverlay();
          }
          return;
        }

        // Azonnali broadcast parancsok
        if (msg.action) {
          void handleCommand({ id: msg.commandId ?? "ws-cmd", payload: msg as CommandPayload });
        }
      } catch (e) {
        console.warn("[VP-SYNC] WS üzenet parse hiba:", e);
      }
    };

    ws.onclose = (evt) => {
      console.log(`[VP-SYNC] 🔌 WS lezárva (${evt.code}) – reconnect ${WS_RECONNECT_MS}ms`);
      wsRef.current = null;
      wsReconnectRef.current = setTimeout(connectWS, WS_RECONNECT_MS);
    };

    ws.onerror = (e) => {
      console.warn("[VP-SYNC] WS hiba:", e);
      ws.close();
    };
  }, [syncClock, handlePrepare, handlePlay, handleCommand, showMsg]);

  // ── Offline bell ticker ────────────────────────────────────────────────────
  const offlineBellTick = useCallback(() => {
    const now = new Date();
    const h   = now.getHours();
    const m   = now.getMinutes();
    const s   = now.getSeconds();
    const key = `${h}:${m}`;
    if (s > 58) return;
    if (lastBellKeyRef.current === key) return;
    const bells = bellsRef.current;
    if (bells.length === 0) return;
    const due = bells.find(b => b.hour === h && b.minute === m);
    if (!due) return;
    lastBellKeyRef.current = key;
    const fallbackUrl = `https://api.schoollive.hu/audio/bells/${due.soundFile}`;
    playBell(due.soundFile, fallbackUrl);
  }, [playBell]);

  // ── Autoplay unlock ────────────────────────────────────────────────────────
  const unlockAudio = useCallback(async () => {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    unlockAudioCtx();
    const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    const a = audioRef.current;
    if (a) {
      a.src = SILENT; a.volume = 0;
      a.play().then(() => a.pause()).catch(() => {}).finally(() => { a.src = ""; a.volume = volumeRef.current / 10; });
    }
    const b = bellAudioRef.current;
    if (b) { b.play().then(() => b.pause()).catch(() => {}); }
    setUnlocked(true);
    const existing = bellsRef.current;
    const toLoad = Array.from(new Set([...existing.map(e => e.soundFile), ...DEFAULT_SOUNDS]));
    let ready = 0;
    for (const name of toLoad) {
      bellBuffers.delete(name);
      const ok = await loadBellSound(name);
      if (ok) ready++;
    }
    console.log(`[BELL] ✅ Unlock kész: ${ready}/${toLoad.length} hang`);
    setCachedBellCount(bellBuffers.size);
    fetchBells();
  }, [fetchBells]);

  const reloginPlayer = useCallback(async () => {
    try {
      const storedCreds = localStorage.getItem("vpCredentials");
      if (!storedCreds) return;
      const { email, password } = JSON.parse(storedCreds) as { email: string; password: string };
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? "https://api.schoollive.hu"}/auth/login`, {
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

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onUnload = () => {
      const token = sessionStorage.getItem("accessToken") ?? localStorage.getItem("accessToken") ?? "";
      if (!token) return;
      try { navigator.sendBeacon("https://api.schoollive.hu/auth/logout", new Blob([JSON.stringify({ token })], { type: "application/json" })); } catch {}
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
    const requestWakeLock = async () => {
      try { if ("wakeLock" in navigator) wakeLockRef.current = await (navigator as any).wakeLock.request("screen"); } catch {}
    };
    void requestWakeLock();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock();
        if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      }
    };
    const onOnline  = () => { setIsOnline(true);  fetchBells(); };
    const onOffline = () => setIsOnline(false);
    const SILENT_BUFFER = (() => { const ctx = getAudioCtx(); return ctx.createBuffer(1, 1, 22050); })();
    keepAliveRef.current = setInterval(() => {
      const ctx = getAudioCtx();
      if (ctx.state === "suspended") { ctx.resume().catch(() => {}); return; }
      try { const src = ctx.createBufferSource(); src.buffer = SILENT_BUFFER; src.connect(ctx.destination); src.start(0); } catch {}
    }, 30_000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      wakeLockRef.current?.release().catch(() => {});
      if (keepAliveRef.current) clearInterval(keepAliveRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTime(correctedNow()), 1000);
    return () => clearInterval(t);
  }, []);

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
    return () => clearInterval(bellSyncTimer);
  }, [status, fetchBells]);

  useEffect(() => {
    if (status !== "active") return;
    connectWS();
    const clockSync = setInterval(syncClock, 5 * 60_000);
    return () => {
      clearInterval(clockSync);
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current);
      wsRef.current?.close(1000, "component unmount");
    };
  }, [status, connectWS, syncClock]);

  useEffect(() => {
    if (status !== "active") return;
    offlineBellTick();
    offlineBellRef.current = setInterval(offlineBellTick, 5_000);
    return () => { if (offlineBellRef.current) clearInterval(offlineBellRef.current); };
  }, [status, offlineBellTick]);

  useEffect(() => { void register(); }, [register]);

  useEffect(() => {
    if (status === "registering") return;
    let failCount = 0;
    const poll = async () => {
      try {
        const res = await apiFetch<{ ok: boolean; status: string; command: { id: string; payload: CommandPayload } | null }>(
          "/player/device/poll", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
        );
        failCount = 0;
        if (res.status === "active" && status !== "active") setStatus("active");
        if (res.status === "active" && res.command) await handleCommand(res.command);
      } catch (err: any) {
        failCount++;
        const is401 = err?.status === 401 || String(err?.message ?? "").includes("401");
        if (is401) void reloginPlayer();
        else if (failCount >= 5) console.warn(`[VP] ⚠️ ${failCount} sikertelen poll`);
      }
    };
    poll();
    pollTimer.current = setInterval(poll, 5000);
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (status !== "active") return;
    const beacon = async () => {
      const ip = await getPublicIp();
      apiFetch("/player/device/beacon", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, ipAddress: ip }),
      }).catch(() => {});
    };
    beacon();
    beaconTimer.current = setInterval(beacon, 30000);
    return () => { if (beaconTimer.current) clearInterval(beaconTimer.current); };
  }, [status, clientId]);

  useEffect(() => {
    if (audioRef.current)     audioRef.current.volume     = volume / 10;
    if (bellAudioRef.current) bellAudioRef.current.volume = volume / 10;
  }, [volume]);

  // ── Audio event handlers ──────────────────────────────────────────────────
  const onMainTimeUpdate = () => {
    const a = audioRef.current;
    if (a?.duration && !isNaN(a.duration) && a.duration > 0) {
      setAudioPct((a.currentTime / a.duration) * 100);
      setTimeLeft(Math.max(0, Math.ceil(a.duration - a.currentTime)));
      if (radioStateRef.current?.isPlaying && !radioStateRef.current.isStream) {
        radioStateRef.current.currentTime = a.currentTime;
      }
    }
  };

  const onMainEnded = () => {
    const currentAction = activeMsgActionRef.current;
    if (currentAction === "TTS") {
      if (radioStateRef.current?.isPlaying) {
        setTimeout(resumeRadio, 200);
      } else {
        const LINGER_MS = 10_000;
        const startTime = Date.now();
        setLingerPct(100);
        lingerTimer.current = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const remaining = Math.max(0, LINGER_MS - elapsed);
          setLingerPct((remaining / LINGER_MS) * 100);
          if (elapsed >= LINGER_MS) {
            if (lingerTimer.current) { clearInterval(lingerTimer.current); lingerTimer.current = null; }
            dismissMsg();
          }
        }, 100);
      }
    } else if (currentAction === "PLAY_URL") {
      radioStateRef.current = null;
      dismissMsg();
    }
  };

  const onMainError = () => {
    dismissMsg();
    if (radioStateRef.current?.isPlaying) setTimeout(resumeRadio, 1000);
  };

  const onBellEnded = () => {
    setBellBanner(false);
    if (radioStateRef.current?.isPlaying) setTimeout(resumeRadio, 200);
  };

  const nextBell = nextBellLabel(bells);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="vp-root">
      <style>{CSS}</style>

      <audio ref={audioRef} onTimeUpdate={onMainTimeUpdate} onEnded={onMainEnded} onError={onMainError} style={{ display: "none" }} />
      <audio ref={bellAudioRef} onEnded={onBellEnded} onError={() => { setBellBanner(false); if (radioStateRef.current?.isPlaying) setTimeout(resumeRadio, 200); }} style={{ display: "none" }} />

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
            Ez az eszköz még nincs aktiválva.<br />
            Kérj meg egy rendszergazdát, hogy aktiválja az <strong>Eszközök</strong> menüben.
          </div>
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
            {activeMsg && (
              <div className={`vp-msg-overlay${msgFadeout ? " vp-msg-fadeout" : ""}`}>
                {activeMsg.source === "RADIO" ? (
                  <>
                    <div style={{fontSize:64}}>📻</div>
                    <div className="vp-radio-title">Iskolarádió</div>
                    {timeLeft !== null && (
                      <div className="vp-radio-timeleft">
                        {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2,"0")}
                      </div>
                    )}
                    {audioPct > 0 && (
                      <div className="vp-msg-progress-wrap">
                        <div className="vp-msg-progress" style={{ width: `${audioPct}%` }} />
                      </div>
                    )}
                  </>
                ) : activeMsg.action === "TTS" ? (
                  <>
                    {activeMsg.text && (
                      <div className="vp-msg-text" style={{ fontSize: calcFontSize(activeMsg.text) }}>
                        {activeMsg.text}
                      </div>
                    )}
                    {readingPct > 0 && lingerPct === 0 && (
                      <div className="vp-msg-progress-wrap">
                        <div className="vp-msg-reading-progress" style={{ width: `${readingPct}%` }} />
                      </div>
                    )}
                    {lingerPct > 0 && (
                      <div className="vp-msg-progress-wrap">
                        <div className="vp-msg-linger-progress" style={{ width: `${lingerPct}%` }} />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{fontSize:48}}>🎵</div>
                    {audioPct > 0 && (
                      <div className="vp-msg-progress-wrap">
                        <div className="vp-msg-progress" style={{ width: `${audioPct}%` }} />
                      </div>
                    )}
                  </>
                )}
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
              <span className="vp-cache-dot" style={{ background: cachedBellCount > 0 ? "#22c55e" : bells.length > 0 ? "#f59e0b" : "#ef4444" }} />
              <span>
                {bells.length === 0 ? "Csengetési rend betöltés…" : cachedBellCount === 0 ? `${bells.length} csengő – letöltés…` : `${bells.length} csengő, ${cachedBellCount} hang kész`}
              </span>
            </div>
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