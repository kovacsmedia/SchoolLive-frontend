// src/lib/snapWsClient.ts
//
// Snapcast kliens böngészőben – az Android `SnapcastClient.kt` és a Python
// `snapcast_manager.py` browser-megfelelője. WebSocket-en keresztül beszél a
// backend `/snap-stream` WS↔TCP proxyjával, ami 1:1 továbbítja a snap-protokoll
// frame-eket a tenant snapserveréhez.
//
//   Browser  ──WSS──> backend `/snap-stream` ──TCP──> snapserver:<snapPort>
//
// Protokoll-üzenetek (Snapcast 0.26 wire):
//   • HELLO          (5) – kliens identitása JSON-ben
//   • CODEC_HEADER   (1) – stream-codec + sample-format
//   • WIRE_CHUNK     (2) – egy időbélyegzett opus/PCM payload
//   • SERVER_SETTINGS(3) – bufferMs, volume, muted (a bufferMs kritikus!)
//   • TIME           (4) – kliens-szerver clock-sync exchange
//
// Lejátszás: Web Audio API + sample-pontos `AudioBufferSourceNode.start(when)`.
// A `when` kiszámolása:
//
//   serverPlayTimeMs   = chunk.serverTimestampMs + serverBufferMs + syncOffsetMs
//   localPlayTimeMs    = serverPlayTimeMs - serverClockOffsetMs
//   ctxPlayTime        = (localPlayTimeMs - performance.now()) / 1000
//                        + audioContext.currentTime
//                        - audioContext.outputLatency        (DAC kompenzáció)
//
// A serverBufferMs (1000 ms) MINDEN kliensnél azonos kell legyen, hogy
// multiroom szinkron meglegyen az ESP/Android/Linux kollégákkal.

import { OpusDecoder } from "opus-decoder";

const TYPE_CODEC_HEADER   = 1;
const TYPE_WIRE_CHUNK     = 2;
const TYPE_SERVER_SETTINGS = 3;
const TYPE_TIME           = 4;
const TYPE_HELLO          = 5;

const RECONNECT_DELAY_MS = 3_000;
const TIME_RESYNC_MS     = 10_000;

interface SnapWsOptions {
  /** WS-URL pl. wss://api.schoollive.hu/snap-stream?token=... */
  url:        string;
  /** Snap-HELLO ID mező – a Device.id (a backend admin UI ezt látja). */
  deviceId:   string;
  /** Web Audio destination – ide csatlakozik a GainNode (volume). */
  audioCtx:   AudioContext;
  /** 0..1 lineáris gain (a user-volume / muted állapotot a hívó kombinálja). */
  initialGain?: number;
  /** Hallás-alapú finomhangoló offset (ms). */
  initialSyncOffsetMs?: number;
  onConnected?:    () => void;
  onDisconnected?: () => void;
  onActivity?:     () => void;
  onStreamStarted?: () => void;
}

type Codec = "unknown" | "opus" | "pcm";

interface AudioChunk {
  buffer: AudioBuffer;
  serverTimestampMs: number;
}

export class SnapWsClient {
  private readonly opts: SnapWsOptions;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private timeSyncTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private codec: Codec = "unknown";
  private sampleRate = 48000;
  private channelCount = 2;
  // OpusDecoder generic-je a sampleRate literal-uniót szigorúan ellenőrzi
  // (8000|12000|16000|24000|48000). A snapserver konfigurációnk fixen 48 kHz-es,
  // de futáskor a sample_rate-et a CodecHeader-ből olvassuk – a típust `any`-ra
  // engedjük, hogy a deklaráció és az ensureOpusDecoder() konzisztens legyen.
  private opusDecoder: OpusDecoder<any> | null = null;
  private opusReady = false;

  /** Snap server clock minus local clock (ms). +X → server előrébb jár. */
  private serverOffsetMs = 0;
  private serverOffsetKnown = false;
  private timeSentLocalMs = 0;

  /** Snapserver jitter-buffer mélysége (ServerSettings → bufferMs). */
  private serverBufferMs = 1000;

  /** Manuális szinkron-eltolás ms-ben (Device.syncOffsetMs). */
  private syncOffsetMs = 0;

  private gainNode: GainNode;

  /** Eddig már ütemezett (és/vagy lejátszott) AudioBufferSourceNode-ok – a
   *  destruktorban explicit stop-oljuk őket, hogy reconnect-kor ne menjenek
   *  egymással szembe. */
  private scheduledSources: AudioBufferSourceNode[] = [];

  private streamStartedNotified = false;

  constructor(opts: SnapWsOptions) {
    this.opts = opts;
    this.syncOffsetMs = opts.initialSyncOffsetMs ?? 0;
    this.gainNode = opts.audioCtx.createGain();
    this.gainNode.gain.value = opts.initialGain ?? 1.0;
    this.gainNode.connect(opts.audioCtx.destination);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
    void this.ensureOpusDecoder();
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.timeSyncTimer)  { clearInterval(this.timeSyncTimer); this.timeSyncTimer = null; }
    try { this.ws?.close(1000, "client stop"); } catch {}
    this.ws = null;
    this.flushScheduledSources();
    try { this.gainNode.disconnect(); } catch {}
  }

  /** 0..1 lineáris gain – a UI volume × mute kombinációja. */
  setGain(g: number): void {
    const v = Math.max(0, Math.min(1, g));
    try {
      this.gainNode.gain.setTargetAtTime(v, this.opts.audioCtx.currentTime, 0.02);
    } catch {
      this.gainNode.gain.value = v;
    }
  }

  setSyncOffset(ms: number): void {
    this.syncOffsetMs = Math.max(-2000, Math.min(2000, ms));
  }

  getSyncOffset(): number {
    return this.syncOffsetMs;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Belső: WS-kapcsolat ───────────────────────────────────────────────────

  private connect(): void {
    if (!this.running) return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url);
    } catch (e) {
      console.warn("[SnapWS] WebSocket konstrukció hiba:", e);
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      console.log("[SnapWS] 🔌 csatlakozva");
      this.serverOffsetKnown = false;
      this.serverOffsetMs = 0;
      this.streamStartedNotified = false;
      this.sendHello();
      // Egy gyors TIME-csomag a kezdeti offset-becsléshez.
      setTimeout(() => this.sendTimeRequest(), 200);
      if (this.timeSyncTimer) clearInterval(this.timeSyncTimer);
      this.timeSyncTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.sendTimeRequest();
      }, TIME_RESYNC_MS);
      this.opts.onConnected?.();
    };

    ws.onmessage = (evt) => {
      try {
        const data = evt.data;
        if (!(data instanceof ArrayBuffer)) return;
        this.handleFrame(new DataView(data));
        this.opts.onActivity?.();
      } catch (e) {
        console.warn("[SnapWS] frame parse hiba:", e);
      }
    };

    ws.onclose = (evt) => {
      console.log(`[SnapWS] 🔌 lezárva (${evt.code}) – reconnect ${RECONNECT_DELAY_MS}ms`);
      this.ws = null;
      this.serverOffsetKnown = false;
      this.flushScheduledSources();
      this.opts.onDisconnected?.();
      if (this.timeSyncTimer) { clearInterval(this.timeSyncTimer); this.timeSyncTimer = null; }
      this.scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.warn("[SnapWS] WS hiba:", e);
      try { ws.close(); } catch {}
    };
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  // ── Belső: snap-frame küldés ──────────────────────────────────────────────

  private buildHeader(type: number, payloadSize: number): Uint8Array {
    // A snap-header 26 byte LE:
    //   uint16 type, uint16 id, uint16 refersTo,
    //   int32  sent.sec,   int32 sent.usec,
    //   int32  received.sec, int32 received.usec,
    //   int32  size
    const buf = new ArrayBuffer(26);
    const dv = new DataView(buf);
    dv.setUint16(0, type, true);
    dv.setUint16(2, 0, true);
    dv.setUint16(4, 0, true);
    dv.setInt32(6, 0, true);
    dv.setInt32(10, 0, true);
    dv.setInt32(14, 0, true);
    dv.setInt32(18, 0, true);
    dv.setInt32(22, payloadSize, true);
    return new Uint8Array(buf);
  }

  private sendBinary(type: number, payload: Uint8Array): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const header = this.buildHeader(type, payload.byteLength);
    const out = new Uint8Array(header.byteLength + payload.byteLength);
    out.set(header, 0);
    out.set(payload, header.byteLength);
    ws.send(out.buffer);
  }

  private sendHello(): void {
    const id = this.opts.deviceId || "schoollive-web-unknown";
    const json = JSON.stringify({
      MAC:        "00:00:00:00:00:00",
      HostName:   id,
      Version:    "0.26.0",
      ClientName: id,
      OS:         "Browser",
      Arch:       "web",
      Instance:   1,
      ID:         id,
      SnapStreamProtocolVersion: 2,
    });
    const jsonBytes = new TextEncoder().encode(json);
    const payload = new Uint8Array(4 + jsonBytes.byteLength);
    const dv = new DataView(payload.buffer);
    dv.setInt32(0, jsonBytes.byteLength, true);
    payload.set(jsonBytes, 4);
    this.sendBinary(TYPE_HELLO, payload);
    console.log(`[SnapWS] HELLO sent: id=${id}`);
  }

  private sendTimeRequest(): void {
    this.timeSentLocalMs = Date.now();
    const nowUs = this.timeSentLocalMs * 1000;
    const payload = new Uint8Array(8);
    const dv = new DataView(payload.buffer);
    dv.setInt32(0, Math.floor(nowUs / 1_000_000), true);
    dv.setInt32(4, Math.floor(nowUs % 1_000_000), true);
    this.sendBinary(TYPE_TIME, payload);
  }

  // ── Belső: snap-frame fogadás ─────────────────────────────────────────────

  private handleFrame(dv: DataView): void {
    if (dv.byteLength < 26) return;
    const type = dv.getUint16(0, true);
    const sec  = dv.getInt32(6, true);
    const us   = dv.getInt32(10, true);
    const size = dv.getInt32(22, true);
    if (size < 0 || 26 + size > dv.byteLength) return;
    const payload = new Uint8Array(dv.buffer, dv.byteOffset + 26, size);

    switch (type) {
      case TYPE_CODEC_HEADER:    this.handleCodecHeader(payload); break;
      case TYPE_WIRE_CHUNK:      this.handleWireChunk(payload); break;
      case TYPE_SERVER_SETTINGS: this.handleServerSettings(payload); break;
      case TYPE_TIME:            this.handleTimeResponse(sec, us); break;
      default: break;
    }
  }

  private handleTimeResponse(serverSec: number, serverUs: number): void {
    const received = Date.now();
    const rttMs = received - this.timeSentLocalMs;
    const serverNowMs = serverSec * 1000 + Math.floor(serverUs / 1000);
    this.serverOffsetMs = serverNowMs - (this.timeSentLocalMs + rttMs / 2);
    this.serverOffsetKnown = true;
    // Túl nagy RTT-nél megőrizzük, csak logoljuk; a snap audio TIME-sync
    // mediánra dolgozik (az Android is csak 1-1 mintát vesz, a serverBufferMs
    // úgyis 1 sec → +-30ms hiba elnyelődik).
    if (rttMs > 300) console.log(`[SnapWS] TIME sync: offset=${this.serverOffsetMs.toFixed(0)}ms rtt=${rttMs}ms (magas)`);
  }

  private handleCodecHeader(payload: Uint8Array): void {
    try {
      const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const nameLen = dv.getInt32(0, true);
      if (nameLen <= 0 || nameLen > payload.byteLength - 4) {
        console.warn("[SnapWS] Codec name length invalid:", nameLen);
        return;
      }
      const codecName = new TextDecoder().decode(payload.subarray(4, 4 + nameLen)).toLowerCase();
      const rest = new DataView(payload.buffer, payload.byteOffset + 4 + nameLen, payload.byteLength - 4 - nameLen);
      if (codecName === "opus") this.setupOpus(rest);
      else if (codecName === "pcm") this.setupPcm(rest);
      else console.warn("[SnapWS] Unsupported codec:", codecName);
    } catch (e) {
      console.warn("[SnapWS] CodecHeader parse hiba:", e);
    }
  }

  private setupOpus(dv: DataView): void {
    if (dv.byteLength < 4 + 12) return;
    const codecDataSize = dv.getInt32(0, true);
    if (codecDataSize < 12) return;
    // skip magic 4 + sample_rate 4 + bits 2 + channels 2 (Android layout)
    const sampleRate = dv.getInt32(8, true);
    const channels   = dv.getUint16(14, true);
    this.codec = "opus";
    this.sampleRate = sampleRate || 48000;
    this.channelCount = channels || 2;
    console.log(`[SnapWS] Codec opus: ${this.channelCount}ch ${this.sampleRate}Hz`);
    void this.ensureOpusDecoder(true);
  }

  private setupPcm(dv: DataView): void {
    // RIFF-fmt chunk-szerű layout (Android setupPcm). Offsetek a dv kezdetétől
    // (vagyis a codecDataSize prefixtől):
    //   0..3   : headerSize (uint32)
    //   4..23  : 5×uint32 skip (RIFF/WAVE/fmt /chunkSize/audioFormat …)
    //   24..25 : 1×uint16 skip
    //   26..27 : channels (uint16)
    //   28..31 : sample_rate (uint32)
    if (dv.byteLength < 4 + 28) return;
    const headerSize = dv.getInt32(0, true);
    if (headerSize < 28) return;
    const channels   = dv.getUint16(26, true);
    const sampleRate = dv.getInt32(28, true);
    this.codec = "pcm";
    this.sampleRate = sampleRate || 48000;
    this.channelCount = channels || 2;
    console.log(`[SnapWS] Codec pcm: ${this.channelCount}ch ${this.sampleRate}Hz`);
  }

  private async ensureOpusDecoder(force = false): Promise<void> {
    if (!force && this.opusDecoder) return;
    try {
      // sampleRate-et kihagyjuk a constructorból – az OpusDecoder default-ja
      // 48 kHz, ami pont a snapserver konfigurációja. (A literal-union típus
      // miatt a futáskor kiolvasott `this.sampleRate: number` nem passzol a
      // szigorú `8000|12000|16000|24000|48000`-be.)
      const decoder = new OpusDecoder({
        channels: this.channelCount as 1 | 2,
      });
      await decoder.ready;
      this.opusDecoder = decoder;
      this.opusReady = true;
      console.log("[SnapWS] Opus decoder kész");
    } catch (e) {
      console.error("[SnapWS] Opus decoder init hiba:", e);
    }
  }

  private handleWireChunk(payload: Uint8Array): void {
    if (payload.byteLength <= 12) return;
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const sec     = dv.getInt32(0, true);
    const us      = dv.getInt32(4, true);
    const encSize = dv.getInt32(8, true);
    if (encSize <= 0 || 12 + encSize > payload.byteLength) return;

    const serverTimestampMs = sec * 1000 + Math.floor(us / 1000);
    const encoded = payload.subarray(12, 12 + encSize);

    let chunk: AudioChunk | null = null;
    if (this.codec === "opus") {
      if (!this.opusDecoder || !this.opusReady) return; // codec még készül
      try {
        const decoded = this.opusDecoder.decodeFrame(encoded);
        const samples = decoded.samplesDecoded;
        if (samples <= 0) return;
        const audioBuf = this.opts.audioCtx.createBuffer(
          this.channelCount, samples, this.sampleRate
        );
        // copyToChannel a szigorú `Float32Array<ArrayBuffer>`-t várja, az
        // opus-decoder pedig `Float32Array<ArrayBufferLike>`-ot ad vissza.
        // A különbséget elkerüljük úgy, hogy közvetlenül a getChannelData()-ra
        // hívunk `.set()`-et (ArrayLike<number> párosítható minden Float32-vel).
        for (let ch = 0; ch < this.channelCount; ch++) {
          audioBuf.getChannelData(ch).set(decoded.channelData[ch]);
        }
        chunk = { buffer: audioBuf, serverTimestampMs };
      } catch (e) {
        // egy chunk parse-hibája ne dobja le a stream-et
        console.warn("[SnapWS] opus decode hiba:", e);
        return;
      }
    } else if (this.codec === "pcm") {
      const samples = encSize / (2 * this.channelCount);
      const audioBuf = this.opts.audioCtx.createBuffer(
        this.channelCount, samples, this.sampleRate
      );
      const i16 = new Int16Array(encoded.buffer, encoded.byteOffset, encSize / 2);
      for (let ch = 0; ch < this.channelCount; ch++) {
        const out = audioBuf.getChannelData(ch);
        for (let s = 0; s < samples; s++) {
          out[s] = i16[s * this.channelCount + ch] / 32768;
        }
      }
      chunk = { buffer: audioBuf, serverTimestampMs };
    } else {
      return;
    }

    if (chunk) this.scheduleChunk(chunk);
  }

  private handleServerSettings(payload: Uint8Array): void {
    try {
      const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const jsonLen = dv.getInt32(0, true);
      if (jsonLen <= 0 || jsonLen > payload.byteLength - 4) return;
      const json = JSON.parse(new TextDecoder().decode(payload.subarray(4, 4 + jsonLen)));
      // Csak a bufferMs-t alkalmazzuk – a server-side mute/volume-ot
      // szándékosan ignoráljuk (lásd Android applyEffectiveVolume).
      const buf = typeof json.bufferMs === "number" ? json.bufferMs : 1000;
      this.serverBufferMs = Math.max(200, Math.min(5000, buf));
    } catch (e) {
      console.warn("[SnapWS] ServerSettings parse hiba:", e);
    }
  }

  // ── Belső: lejátszás ütemezés ─────────────────────────────────────────────

  private scheduleChunk(chunk: AudioChunk): void {
    if (!this.serverOffsetKnown) return; // még kalibrálunk; eldobható kezdő chunk

    const ctx = this.opts.audioCtx;
    if (ctx.state === "suspended") {
      // A user még nem unlock-olt; eldobjuk, mert a scheduling úgyis hibás lenne
      return;
    }

    // serverPlayTimeMs: ekkor kéne hangzania a chunk-nak a snap multiroom sync szerint
    const serverPlayTimeMs = chunk.serverTimestampMs + this.serverBufferMs + this.syncOffsetMs;
    const localPlayTimeMs  = serverPlayTimeMs - this.serverOffsetMs;
    const aheadMs          = localPlayTimeMs - Date.now();

    // outputLatency – a Web Audio specifikus DAC-kompenzáció. Új Chrome/Firefox
    // ismeri (típusosan 20-100 ms); régebbieken 0 → bukik vissza baseLatency-re.
    const outputLatencyS =
      (ctx as any).outputLatency ?? (ctx as any).baseLatency ?? 0;

    const ctxPlayTime = ctx.currentTime + Math.max(0, aheadMs / 1000) - outputLatencyS;

    if (aheadMs < -300) {
      // Túl későn jött, eldobjuk – nem érdemes "now"-on lejátszani, mert az
      // multiroom-szempontból elcsúszott
      return;
    }

    const src = ctx.createBufferSource();
    src.buffer = chunk.buffer;
    src.connect(this.gainNode);
    try {
      src.start(Math.max(ctx.currentTime, ctxPlayTime));
    } catch {
      // pl. már lejárt; eldobjuk
      try { src.disconnect(); } catch {}
      return;
    }
    this.scheduledSources.push(src);
    src.onended = () => {
      const i = this.scheduledSources.indexOf(src);
      if (i >= 0) this.scheduledSources.splice(i, 1);
      try { src.disconnect(); } catch {}
    };

    if (!this.streamStartedNotified) {
      this.streamStartedNotified = true;
      this.opts.onStreamStarted?.();
    }
  }

  private flushScheduledSources(): void {
    for (const src of this.scheduledSources) {
      try { src.stop(); } catch {}
      try { src.disconnect(); } catch {}
    }
    this.scheduledSources = [];
  }
}
