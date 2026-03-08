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

// ─── Helpers ──────────────────────────────────────────────────────────────
function getOrCreateClientId(): string {
  const KEY = "vpClientId";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

async function getPublicIp(): Promise<string> {
  try {
    const r = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(4000) });
    const d = await r.json();
    return d.ip ?? "";
  } catch {
    return "";
  }
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
  const h = String(next.hour).padStart(2, "0");
  const m = String(next.minute).padStart(2, "0");
  return `${h}:${m}`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800;900&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  .vp-root {
    width: 100vw; height: 100vh; overflow: hidden;
    background: #07101f;
    font-family: 'Nunito', 'Segoe UI', sans-serif;
    color: #f0f6ff;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    user-select: none;
  }

  /* ── Pending képernyő ── */
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
    letter-spacing: 0.5px;
  }
  .vp-pending-dot {
    width: 10px; height: 10px; border-radius: 50%; background: #f59e0b;
    display: inline-block; margin-right: 8px;
    animation: vp-pulse 1.5s ease-in-out infinite;
  }

  /* ── Fő lejátszó képernyő ── */
  .vp-screen {
    width: 100%; height: 100%;
    display: grid;
    grid-template-rows: auto 1fr auto;
    padding: 0;
  }

  /* Fejléc */
  .vp-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 36px;
    background: rgba(13, 27, 46, 0.8);
    border-bottom: 1px solid #1a2d47;
  }
  .vp-inst-name {
    font-size: 18px; font-weight: 900; color: #3b82f6;
    letter-spacing: 0.3px;
  }
  .vp-online-dot {
    width: 9px; height: 9px; border-radius: 50%; background: #22c55e;
    display: inline-block; margin-right: 7px;
    box-shadow: 0 0 8px #22c55e;
  }
  .vp-status-txt { font-size: 12px; color: #4a6280; font-weight: 700; }

  /* Közép */
  .vp-center {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 12px; padding: 20px;
    position: relative;
  }

  /* Óra */
  .vp-clock {
    font-size: clamp(72px, 14vw, 160px);
    font-weight: 900;
    color: #f0f6ff;
    letter-spacing: -4px;
    line-height: 1;
    text-shadow: 0 0 60px rgba(59,130,246,0.3);
    font-variant-numeric: tabular-nums;
  }
  .vp-date {
    font-size: clamp(14px, 2vw, 22px);
    color: #8da4c0;
    font-weight: 700;
    text-transform: capitalize;
  }

  /* Következő csengetés */
  .vp-next-bell {
    margin-top: 16px;
    display: flex; align-items: center; gap: 12px;
    background: rgba(13, 27, 46, 0.7);
    border: 1px solid #1a2d47;
    border-radius: 16px;
    padding: 12px 24px;
  }
  .vp-bell-icon  { font-size: 22px; }
  .vp-bell-label { font-size: 14px; color: #8da4c0; font-weight: 700; }
  .vp-bell-time  { font-size: 22px; font-weight: 900; color: #f0f6ff; margin-left: 4px; }

  /* Üzenet overlay */
  .vp-msg-overlay {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: rgba(7, 16, 31, 0.92);
    backdrop-filter: blur(8px);
    gap: 20px; padding: 40px;
    animation: vp-fadein 0.4s ease;
    z-index: 10;
  }
  @keyframes vp-fadein { from{opacity:0;transform:scale(0.96)} to{opacity:1;transform:scale(1)} }
  .vp-msg-icon  { font-size: 52px; }
  .vp-msg-title { font-size: clamp(18px, 3vw, 32px); font-weight: 900; color: #3b82f6; text-align: center; }
  .vp-msg-text  { font-size: clamp(14px, 2.5vw, 24px); color: #f0f6ff; text-align: center; line-height: 1.5; max-width: 700px; }

  /* Lejátszás progress */
  .vp-audio-bar {
    width: 100%; max-width: 400px; height: 4px;
    background: #1a2d47; border-radius: 99px; overflow: hidden; margin-top: 8px;
  }
  .vp-audio-progress {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #6366f1);
    border-radius: 99px;
    transition: width 0.5s linear;
  }

  /* Lábléc */
  .vp-footer {
    display: flex; align-items: center; justify-content: center;
    padding: 14px 36px;
    background: rgba(13, 27, 46, 0.8);
    border-top: 1px solid #1a2d47;
    gap: 20px;
    font-size: 12px; color: #4a6280;
  }
  .vp-footer-item { display: flex; align-items: center; gap: 6px; }

  /* Volume */
  .vp-vol-wrap {
    display: flex; align-items: center; gap: 8px;
  }
  .vp-vol-btn {
    width: 30px; height: 30px; border-radius: 8px;
    border: 1px solid #1a2d47; background: transparent;
    color: #8da4c0; font-size: 14px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .vp-vol-btn:hover { background: #1a2d47; color: #f0f6ff; }
  .vp-vol-val { font-size: 13px; color: #8da4c0; min-width: 24px; text-align: center; }
`;

// ═══════════════════════════════════════════════════════════════════════════
export default function VirtualPlayer() {
  const clientId = getOrCreateClientId();

  const [status,      setStatus]      = useState<PlayerStatus>("registering");
  const [time,        setTime]        = useState(new Date());
  const [bells,       setBells]       = useState<BellEntry[]>([]);
  const [instName,    setInstName]    = useState<string>("");
  const [activeMsg,   setActiveMsg]   = useState<CommandPayload | null>(null);
  const [audioSrc,    setAudioSrc]    = useState<string | null>(null);
  const [audioPct,    setAudioPct]    = useState(0);
  const [volume,      setVolume]      = useState(7);
  const [isOnline,    setIsOnline]    = useState(navigator.onLine);
  const audioRef  = useRef<HTMLAudioElement>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const beaconTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Regisztráció ─────────────────────────────────────────────────────────
  const register = useCallback(async () => {
    setStatus("registering");
    const ipAddress = await getPublicIp();
    try {
      const res = await apiFetch<{ ok: boolean; status: string; deviceId?: string }>(
        "/player/device/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            ipAddress,
            userAgent: navigator.userAgent,
          }),
        }
      );
      if (res.status === "active") {
        setStatus("active");
      } else {
        setStatus("pending");
      }
    } catch {
      setStatus("pending");
    }
  }, [clientId]);

  // ── Fullscreen + Wake Lock ───────────────────────────────────────────────
  useEffect(() => {
    // Fullscreen kérés
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    }
    // Wake Lock
    let wakeLock: WakeLockSentinel | null = null;
    const acquireWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await (navigator as any).wakeLock.request("screen");
        }
      } catch {}
    };
    void acquireWakeLock();
    // Online/offline
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

  // ── Intézmény neve + csengetési rend betöltése ───────────────────────────
  useEffect(() => {
    if (status !== "active") return;

    // Intézmény neve a JWT-ből
    const token = sessionStorage.getItem("accessToken") ?? localStorage.getItem("accessToken") ?? "";
    if (token) {
      try {
        const parts   = token.split(".");
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        setInstName(payload.tenantName ?? payload.tenant?.name ?? "");
      } catch {}
    }

    // Csengetési rend
    apiFetch<{ ok: boolean; bells?: BellEntry[] }>("/bells/today")
      .then(r => { if (r.bells) setBells(r.bells); })
      .catch(() => {});
  }, [status]);

  // ── Regisztráció indítása ────────────────────────────────────────────────
  useEffect(() => { void register(); }, [register]);

  // ── Polling – pending állapotban is fut (aktiválás detektálás) ───────────
  useEffect(() => {
    if (status === "registering") return;

    const poll = async () => {
      try {
        const res = await apiFetch<{
          ok: boolean;
          status: string;
          command: { id: string; payload: CommandPayload } | null;
        }>("/player/device/poll", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

        if (res.status === "active" && status !== "active") {
          setStatus("active");
        }

        if (res.status === "active" && res.command) {
          await handleCommand(res.command);
        }
      } catch {}
    };

    poll();
    pollTimer.current = setInterval(poll, 5000);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ── Beacon ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== "active") return;

    const beacon = async () => {
      const ipAddress = await getPublicIp();
      apiFetch("/player/device/beacon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, ipAddress }),
      }).catch(() => {});
    };

    beacon();
    beaconTimer.current = setInterval(beacon, 30000);
    return () => {
      if (beaconTimer.current) clearInterval(beaconTimer.current);
    };
  }, [status, clientId]);

  // ── Hangerő ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 10;
  }, [volume]);

  // ── Command kezelő ───────────────────────────────────────────────────────
  const handleCommand = async (cmd: { id: string; payload: CommandPayload }) => {
    const { action, url, text, title } = cmd.payload;

    if (action === "PLAY_URL" && url) {
      setActiveMsg({ action, url, title: title ?? "Iskolarádió", source: cmd.payload.source });
      setAudioSrc(url);
      setAudioPct(0);
    } else if (action === "TTS" && url) {
      setActiveMsg({ action, url, text, title: title ?? "Üzenet" });
      setAudioSrc(url);
      setAudioPct(0);
    } else if (action === "BELL" && url) {
      setAudioSrc(url);
      // Bell: nincs overlay, csak hang
    }

    // ACK
    await apiFetch("/player/device/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: cmd.id }),
    }).catch(() => {});
  };

  // ── Audio progress ────────────────────────────────────────────────────────
  const onAudioTimeUpdate = () => {
    const a = audioRef.current;
    if (a && a.duration) setAudioPct((a.currentTime / a.duration) * 100);
  };
  const onAudioEnded = () => {
    setActiveMsg(null);
    setAudioSrc(null);
    setAudioPct(0);
  };

  const nextBell = nextBellLabel(bells);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="vp-root">
      <style>{CSS}</style>

      {/* Hidden audio element */}
      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          autoPlay
          onTimeUpdate={onAudioTimeUpdate}
          onEnded={onAudioEnded}
          onError={onAudioEnded}
          style={{ display: "none" }}
        />
      )}

      {/* ── PENDING képernyő ── */}
      {(status === "pending" || status === "registering") && (
        <div className="vp-pending">
          <div className="vp-pending-icon">📱</div>
          <div className="vp-pending-title">Virtuális lejátszó</div>
          <div className="vp-pending-sub">
            Ez az eszköz még nincs aktiválva.<br />
            Kérj meg egy rendszergazdát, hogy aktiválja az <strong>Eszközök</strong> menüben.
          </div>
          <div className="vp-pending-id">
            <div style={{ marginBottom: 6, color: "#8da4c0", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.8px" }}>Eszköz azonosító</div>
            <div>WP-{clientId.slice(0, 8).toUpperCase()}</div>
            <div style={{ marginTop: 4, fontSize: 11, color: "#4a6280" }}>IP: {/* IP-t a register kéri le */}</div>
          </div>
          <div style={{ fontSize: 13, color: "#4a6280", display: "flex", alignItems: "center" }}>
            <span className="vp-pending-dot" />
            Várakozás aktiválásra…
          </div>
        </div>
      )}

      {/* ── AKTÍV képernyő ── */}
      {status === "active" && (
        <div className="vp-screen">
          {/* Fejléc */}
          <div className="vp-header">
            <div className="vp-inst-name">
              {instName || "SchoolLive"}
            </div>
            <div className="vp-status-txt">
              <span className="vp-online-dot" style={{ background: isOnline ? "#22c55e" : "#ef4444", boxShadow: isOnline ? "0 0 8px #22c55e" : "none" }} />
              {isOnline ? "Online" : "Offline"}
            </div>
          </div>

          {/* Közép */}
          <div className="vp-center">
            {/* Üzenet overlay */}
            {activeMsg && (
              <div className="vp-msg-overlay">
                <div className="vp-msg-icon">
                  {activeMsg.source === "RADIO" ? "📻" : activeMsg.action === "TTS" ? "📢" : "🎵"}
                </div>
                {activeMsg.title && <div className="vp-msg-title">{activeMsg.title}</div>}
                {activeMsg.text  && <div className="vp-msg-text">{activeMsg.text}</div>}
                <div className="vp-audio-bar">
                  <div className="vp-audio-progress" style={{ width: `${audioPct}%` }} />
                </div>
              </div>
            )}

            {/* Óra */}
            <div className="vp-clock">{fmtTime(time)}</div>
            <div className="vp-date">{fmtDate(time)}</div>

            {/* Következő csengetés */}
            {nextBell && (
              <div className="vp-next-bell">
                <span className="vp-bell-icon">🔔</span>
                <span className="vp-bell-label">Következő csengetés:</span>
                <span className="vp-bell-time">{nextBell}</span>
              </div>
            )}
          </div>

          {/* Lábléc */}
          <div className="vp-footer">
            <div className="vp-footer-item">
              <span style={{ fontSize: 14 }}>📱</span>
              <span>Virtuális lejátszó · WP-{clientId.slice(0, 8).toUpperCase()}</span>
            </div>
            <div className="vp-vol-wrap">
              <span style={{ fontSize: 13 }}>🔈</span>
              <button className="vp-vol-btn" onClick={() => setVolume(v => Math.max(0, v - 1))} type="button">−</button>
              <span className="vp-vol-val">{volume}</span>
              <button className="vp-vol-btn" onClick={() => setVolume(v => Math.min(10, v + 1))} type="button">+</button>
              <span style={{ fontSize: 13 }}>🔊</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}