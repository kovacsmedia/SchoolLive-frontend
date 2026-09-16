// src/components/MonitorPill.tsx
//
// MONITOROZÁS – a kezelői felület felső sávjában.
//
// Egy gomb + egy kisméretű sztereó kivezérlésjelző. Bekapcsolva ugyanúgy
// csatlakozik a tenant snap streamjéhez, ahogy a webplayer teszi: a kezelő a
// SAJÁT gépén hallja, mi szól épp az épület hangszóróin.
//
//   /snap-stream (WS) ──► SnapWsClient ──► GainNode ─┬─► hangszóró
//                                                     └─► AnalyserNode (mérő)
//
// MIÉRT A SNAP STREAM: az a TÉNYLEGES kimenet – ugyanaz a kevert jel, amit az
// eszközök kapnak, a csengetéssel, üzenettel és a rádióval együtt. Bármi más
// forrás (pl. a rádiófájl közvetlen lejátszása) csak közelítés lenne.
//
// A snap-proxy csak érvényes JWT-t és tenantId-t kér, Device-rekordot nem –
// ezért a kezelő tokenje is jó hozzá, nem kell hozzá lejátszó-eszköz.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SnapWsClient } from "../lib/snapWsClient";
import { apiFetch, getWsUrl } from "../lib/api";

/** Egyedi, de felismerhető snap-kliens azonosító. Nem ütközik Device.id-vel. */
function monitorClientId(): string {
  let id = "";
  try { id = sessionStorage.getItem("sl-monitor-id") ?? ""; } catch { /* ignore */ }
  if (!id) {
    id = `monitor-${Math.random().toString(36).slice(2, 10)}`;
    try { sessionStorage.setItem("sl-monitor-id", id); } catch { /* ignore */ }
  }
  return id;
}

export default function MonitorPill() {
  const { t } = useTranslation(["appshell"]);

  const [on,       setOn]       = useState(false);
  const [starting, setStarting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const clientRef    = useRef<SnapWsClient | null>(null);
  const ctxRef       = useRef<AudioContext | null>(null);
  const analysersRef = useRef<AnalyserNode[]>([]);
  const rafRef       = useRef<number | null>(null);
  /* A mérőt közvetlen DOM-írással frissítjük ~60 Hz-en: React-állapoton
     keresztül ez az egész app-shell újrarajzolása lenne másodpercenként
     hatvanszor. */
  const barRef       = useRef<(HTMLDivElement | null)[]>([null, null]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    analysersRef.current = [];
    for (const bar of barRef.current) if (bar) bar.style.width = "0%";

    clientRef.current?.stop();
    clientRef.current = null;

    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => { /* ignore */ });

    setOn(false);
  }, []);

  // Lapelhagyás / kijelentkezés: ne maradjon nyitva a hang és a WS.
  useEffect(() => stop, [stop]);

  function meterLoop() {
    const ans = analysersRef.current;
    if (ans.length === 2) {
      for (let ch = 0; ch < 2; ch++) {
        const an  = ans[ch];
        const buf = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const db  = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
        // -60 dB … 0 dB → 0 … 100%
        const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
        const bar = barRef.current[ch];
        if (bar) {
          bar.style.width = `${pct}%`;
          bar.style.background = db > -1 ? "#dc2626" : db > -12 ? "#eab308" : "#22c55e";
        }
      }
    }
    rafRef.current = requestAnimationFrame(meterLoop);
  }

  async function start() {
    if (on || starting) return;
    setError(null);

    const token =
      sessionStorage.getItem("accessToken") ??
      localStorage.getItem("accessToken") ?? "";
    if (!token) { setError(t("appshell:monitorNoSession")); return; }

    setStarting(true);
    try {
      /*
       * GERJEDÉS-FIGYELMEZTETÉS.
       *
       * Ha épp élő hangbemenet megy, a mikrofon és a most megszólaló monitor
       * tipikusan ugyanazon a gépen van – a hangszóróból visszajutó jel
       * körbeér, és másodperceken belül üvöltő gerjedés lesz belőle. Ezt a
       * kezelőnek a HANGSZÓRÓ MEGSZÓLALÁSA ELŐTT kell tudnia.
       *
       * A lekérdezés hibája nem blokkol: a monitorozás fontosabb, mint egy
       * figyelmeztetés, amit amúgy is le lehet okézni.
       */
      let liveInput = false;
      try {
        const res = await apiFetch<{ ok: boolean; liveInput?: boolean }>("/radio/snap-playing");
        liveInput = res?.liveInput === true;
      } catch { /* nem kritikus */ }

      if (liveInput && !window.confirm(t("appshell:monitorFeedbackWarning"))) {
        return;
      }

      // Az AudioContext felhasználói kattintásból jön létre – enélkül az
      // autoplay-szabály felfüggesztett állapotban tartaná.
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      const split = ctx.createChannelSplitter(2);
      const anL = ctx.createAnalyser(); anL.fftSize = 1024; anL.smoothingTimeConstant = 0.3;
      const anR = ctx.createAnalyser(); anR.fftSize = 1024; anR.smoothingTimeConstant = 0.3;
      split.connect(anL, 0);
      split.connect(anR, 1);
      analysersRef.current = [anL, anR];

      const client = new SnapWsClient({
        url:      `${getWsUrl("/snap-stream")}?token=${encodeURIComponent(token)}`,
        deviceId: monitorClientId(),
        audioCtx: ctx,
        tapNode:  split,
        onDisconnected: () => { /* a kliens magától újracsatlakozik */ },
      });
      client.start();
      clientRef.current = client;

      if (rafRef.current === null) rafRef.current = requestAnimationFrame(meterLoop);
      setOn(true);
    } catch (e: any) {
      setError(e?.message ?? t("appshell:monitorError"));
      stop();
    } finally {
      setStarting(false);
    }
  }

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8,
        background: "var(--sl-bg)", border: "1px solid var(--sl-border)",
        borderRadius: 10, padding: "3px 8px 3px 4px", whiteSpace: "nowrap",
      }}
      title={error ?? t("appshell:monitorTooltip")}
    >
      <button
        type="button"
        onClick={() => (on ? stop() : void start())}
        disabled={starting}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          border: "none", borderRadius: 8, cursor: starting ? "default" : "pointer",
          padding: "3px 8px", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
          background: on ? "var(--sl-blue)" : "transparent",
          color:      on ? "#fff" : "var(--sl-text)",
        }}
      >
        <span style={{ fontSize: 13 }}>🎧</span>
        {starting
          ? t("appshell:monitorConnecting")
          : on ? t("appshell:monitorStop") : t("appshell:monitorStart")}
      </button>

      {/* Kisméretű sztereó kivezérlésjelző – két vékony sáv egymás alatt. */}
      <div
        style={{ display: "flex", flexDirection: "column", gap: 2, width: 52 }}
        aria-label={t("appshell:monitorMeterAria")}
      >
        {[0, 1].map((ch) => (
          <div
            key={ch}
            style={{
              height: 4, borderRadius: 2, overflow: "hidden",
              background: "var(--sl-border)",
            }}
          >
            <div
              ref={(el) => { barRef.current[ch] = el; }}
              style={{ width: "0%", height: "100%", background: "#22c55e", transition: "width 0.05s linear" }}
            />
          </div>
        ))}
      </div>

      {error && <span style={{ fontSize: 12, color: "var(--sl-red)" }}>⚠</span>}
    </div>
  );
}
