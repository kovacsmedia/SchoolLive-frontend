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
import { apiFetch, getWsUrl, resolveTenantId } from "../lib/api";
import { VU_GRADIENT, VU_DIM, vuPercent, vuClip, vuRmsDb } from "../lib/vuMeter";

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
  /*
   * A kapcsolat TÉNYLEGES fázisa.
   *
   * Korábban a gomb közvetlenül a `client.start()` után váltott aktívra – az
   * viszont szinkron hívás, ami csak elindítja a csatlakozást. Egy sikertelen
   * WS-kapcsolat így pontosan úgy nézett ki, mint egy működő monitorozás.
   *
   *   "connecting" – WS nyitás alatt
   *   "connected"  – a snap-szerver fogad, de hang még nem jött
   *   "playing"    – megjött az első hangcsomag
   */
  const [phase, setPhase] = useState<"off"|"connecting"|"connected"|"playing">("off");

  const clientRef    = useRef<SnapWsClient | null>(null);
  const ctxRef       = useRef<AudioContext | null>(null);
  const analysersRef = useRef<AnalyserNode[]>([]);
  const rafRef       = useRef<number | null>(null);
  /* A mérőt közvetlen DOM-írással frissítjük ~60 Hz-en: React-állapoton
     keresztül ez az egész app-shell újrarajzolása lenne másodpercenként
     hatvanszor. */
  const fillRef      = useRef<(HTMLDivElement | null)[]>([null, null]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    analysersRef.current = [];
    for (const el of fillRef.current) if (el) el.style.clipPath = vuClip(0);

    clientRef.current?.stop();
    clientRef.current = null;

    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => { /* ignore */ });

    setOn(false);
    setPhase("off");
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
        const el = fillRef.current[ch];
        if (el) el.style.clipPath = vuClip(vuPercent(vuRmsDb(buf)));
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
       * AZ AUDIOCONTEXT A KATTINTÁS UTÁN AZONNAL JÖN LÉTRE.
       *
       * A böngésző autoplay-szabálya szerint a `resume()` csak friss
       * felhasználói interakció után sikerül. Ha előbb megvárnánk a
       * szerver-lekérdezést és a megerősítő ablakot, a kontextus
       * `suspended` maradhat – a snap-kliens pedig ilyenkor NÉMÁN eldob
       * minden hangcsomagot (ld. `scheduleChunk`), tehát a monitorozás
       * hiba nélkül, de hangtalanul futna.
       *
       * UGYANAZ A BEÁLLÍTÁS, MINT A WEBPLAYERÉ: a snap stream fixen 48 kHz-es;
       * a gép alapértelmezett (gyakran 44,1 kHz-es) frekvenciáján a böngészőnek
       * minden csomagot újra kellene mintavételeznie. A `latencyHint:
       * "playback"` nagyobb kimeneti puffert kér – folyamatos streamnél ez a
       * jó kompromisszum, nem az alacsony késleltetés.
       */
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
        latencyHint: "playback",
        sampleRate:  48000,
      }) as AudioContext;
      ctxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

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
        stop();   // a már megnyitott AudioContext ne maradjon a nyakunkon
        return;
      }

      /*
       * A megerősítő ablak alatt a böngésző felfüggeszthette a kontextust –
       * és egy `suspended` kontextus némán nyeli el az egész streamet.
       */
      if (ctx.state === "suspended") await ctx.resume();

      const split = ctx.createChannelSplitter(2);
      const anL = ctx.createAnalyser(); anL.fftSize = 1024; anL.smoothingTimeConstant = 0.3;
      const anR = ctx.createAnalyser(); anR.fftSize = 1024; anR.smoothingTimeConstant = 0.3;
      split.connect(anL, 0);
      split.connect(anR, 1);
      analysersRef.current = [anL, anR];

      /*
       * A tenantot a query-ben is elküldjük.
       *
       * WebSocketre nem tehetünk `x-tenant-id` fejlécet, amit az `apiFetch`
       * használ. A SUPER_ADMIN tokenjében nincs tenantId (az aktív intézményt
       * a felületen választja ki), így nélküle a proxy 4003-mal bontana.
       * Más szerepköröknél a szerver a tokenben lévő tenantot használja, és
       * ezt a paramétert figyelmen kívül hagyja.
       */
      const tenantId = resolveTenantId(token) ?? "";
      const clientId = monitorClientId();
      const qs = new URLSearchParams({ token, ...(tenantId ? { tenantId } : {}) });

      setPhase("connecting");
      const client = new SnapWsClient({
        url:      `${getWsUrl("/snap-stream")}?${qs.toString()}`,
        deviceId: clientId,
        audioCtx: ctx,
        tapNode:  split,
        onConnected: () => {
          setPhase("connected");
          setError(null);
          /*
           * A snapserver megjegyzi a kliensek némítását azonosító szerint, és
           * a NÉMÍTOTT kliensnek nem küld hangcsomagot. A monitor célzott
           * eszköznek sosem számít, így egy korábbi célzás némán ottfelejtheti
           * némítva – ilyenkor a kapcsolat és a kodek-egyeztetés hibátlan, csak
           * hang nem jön. A backend a célzásnál már kihagyja a monitort, de a
           * MÁR TÁROLT néma állapotot itt kell feloldani.
           */
          void apiFetch("/radio/monitor/unmute", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ clientId }),
          }).catch(() => { /* nem kritikus – a hang ettől még jöhet */ });
        },
        onStreamStarted: () => setPhase("playing"),
        // A kliens magától újracsatlakozik; a fázist visszavesszük, hogy a
        // felületen látszódjon, ha a kapcsolat elszállt.
        onDisconnected:  () => setPhase(p => (p === "off" ? p : "connecting")),
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
        {starting || phase === "connecting"
          ? t("appshell:monitorConnecting")
          : on ? t("appshell:monitorStop") : t("appshell:monitorStart")}
      </button>

      {/* Csatlakozott, de hang még nem jött: ezt ki kell mondani, különben a
          néma monitorozás megkülönböztethetetlen a hibától. */}
      {on && phase === "connected" && (
        <span style={{ fontSize: 11, color: "var(--sl-muted)" }}>
          {t("appshell:monitorNoAudio")}
        </span>
      )}

      {/* Sztereó kivezérlésjelző – folytonos sáv, részenként fix színnel.
          A szélesség felső korlát: keskeny kijelzőn a sáv szűkül, nem lóg ki.
          A fejléc `flex-wrap`-je miatt a jelző álló nézetben magától saját
          sorba kerül. */}
      <div
        style={{ display: "flex", flexDirection: "column", gap: 3, width: 208, maxWidth: "48vw" }}
        aria-label={t("appshell:monitorMeterAria")}
      >
        {[0, 1].map((ch) => (
          /* A halvány alsó réteg végig mutatja a skálát; a felső, teljes
             szélességű réteg ugyanazt festi, csak a jobb oldala van
             levágva a szint arányában. */
          <div key={ch} style={{ position: "relative", height: 6, borderRadius: 3, overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 0, background: VU_GRADIENT, opacity: VU_DIM }} />
            <div
              ref={(el) => { fillRef.current[ch] = el; }}
              style={{
                position: "absolute", inset: 0,
                background: VU_GRADIENT,
                clipPath: vuClip(0),
                transition: "clip-path 0.05s linear",
              }}
            />
          </div>
        ))}
      </div>

      {error && <span style={{ fontSize: 12, color: "var(--sl-red)" }}>⚠</span>}
    </div>
  );
}
