// src/pages/SchoolRadio.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { stripAccents } from "../lib/text";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

// ─── Típusok ──────────────────────────────────────────────────────────────
type RadioFile = {
  id: string;
  originalName: string;
  filename: string;
  sizeBytes: number;
  durationSec: number | null;
  fileUrl: string;
  createdAt: string;
  createdBy: { id: string; displayName: string | null; email: string };
  _count: { schedules: number };
};

type RadioSchedule = {
  id: string;
  radioFileId: string;
  targetType: string;
  targetId: string | null;
  scheduledAt: string;
  status: "PENDING" | "DISPATCHED" | "CANCELLED";
  dispatchedAt: string | null;
  createdAt: string;
  radioFile: {
    id: string;
    originalName: string;
    durationSec: number | null;
    fileUrl: string;
  };
};

type Device = { id: string; name: string; online: boolean; deviceClass: string };
type DeviceGroup = { id: string; name: string };
type BellEntry = { hour: number; minute: number; type: string };
type NowPlaying = { name: string; durationSec: number | null; startsAt: Date } | null;

// Playlist builder item
type PlItem = {
  id: string;
  source: "upload" | "youtube" | "gdrive" | "recording";
  url: string;
  title: string;
  durationSec: number | null;
  status: "idle" | "fetching" | "ready" | "error";
  errorMsg?: string;
  audioPreviewUrl?: string;
};

// Internetrádió típusok – egy állomás több stream-mel (al-csatornákkal)
type NetRadioStream = { label: string; url: string };
type NetRadio = {
  id:      string;
  name:    string;
  genre:   string;
  streams: NetRadioStream[];   // legalább egy elem (Főadás)
};

// Initial seed – 16 magyar online rádió. A stream URL-eket a myonlineradio.hu-n
// érdemes ellenőrizni; alstreameket (műfaj-specifikus csatornákat) a UI-n
// keresztül lehet hozzáadni mindegyik adóhoz. A felhasználó az egész listát
// bővítheti / törölheti / visszaállíthatja az alapértelmezettre.
// Az UI ékezet-mentesen tárolja és jeleníti meg a rádióneveket
// (lásd `stripAccents`), ezért a seed is ékezet nélküli.
const NET_RADIOS_INITIAL: NetRadio[] = [
  { id: "oxygen-music", name: "Oxygen Music", genre: "pop / dance", streams: [
    { label: "Main 320kbit", url: "https://oxygenmusic.hu:8443/oxygenmusic" },
    { label: "Main 192kbit", url: "https://oxygenmusic.hu:8443/oxygenmusic_192" },
    { label: "OzoneFM",      url: "https://oxygenmusic.hu:8443/ozonefm_192" },
    { label: "90s",          url: "https://oxygenmusic.hu:8443/oxygenthe90shits" },
    { label: "80s",          url: "https://oxygenmusic.hu:8443/oxygenthe80shits_192" },
    { label: "00s",          url: "https://oxygenmusic.hu:8443/oxygenthe00shits_192" },
    { label: "10s",          url: "https://oxygenmusic.hu:8443/oxygenthe10shits" },
    { label: "Xmas",         url: "https://oxygenmusic.hu:8443/xmas_320" },
  ] },
  { id: "radio-1", name: "Radio 1", genre: "kereskedelmi pop", streams: [
    { label: "Main 128kbit", url: "https://icast.connectmedia.hu/5202/live.mp3" },
  ] },
  { id: "retro-radio", name: "Retro Radio", genre: "retro", streams: [
    { label: "Main 128kbit", url: "https://icast.connectmedia.hu/5001/live.mp3" },
  ] },
  { id: "petofi-radio", name: "Petofi Radio", genre: "magyar pop", streams: [
    { label: "Main", url: "https://icast.connectmedia.hu/4736/mr2.mp3" },
  ] },
  { id: "roxy-radio", name: "Roxy Radio", genre: "poprock", streams: [
    { label: "Main 192kbit", url: "https://s2.audiostream.hu/roxy_192k" },
  ] },
  { id: "cool-fm-2af7", name: "Cool FM", genre: "multi genre", streams: [
    { label: "Top40",       url: "https://mediagw.e-tiger.net/stream/coolfm" },
    { label: "Dance",       url: "https://mediagw.e-tiger.net/stream/dds" },
    { label: "Pop",         url: "https://mediagw.e-tiger.net/stream/zc01" },
    { label: "Rap, HipHop", url: "https://mediagw.e-tiger.net/stream/zc08" },
    { label: "Acoustic",    url: "https://mediagw.e-tiger.net/stream/zc12" },
    { label: "Jazzy",       url: "https://mediagw.e-tiger.net/stream/zc13" },
    { label: "Alternative", url: "https://mediagw.e-tiger.net/stream/zc16" },
  ] },
  { id: "laza-radio-vylu", name: "Laza Radio", genre: "PopDance", streams: [
    { label: "Main 320kbit", url: "https://stream.lazaradio.com/live.ogg" },
  ] },
  { id: "mixradio-3zxm", name: "MixRadio", genre: "Dance", streams: [
    { label: "Dance",  url: "https://stream.phost.hu:8006/live" },
    { label: "Retro",  url: "https://stream.phost.hu:8004/retro" },
    { label: "Summer", url: "https://stream.phost.hu:8010/creamix" },
  ] },
  { id: "poptarisznya-tr2z", name: "Poptarisznya", genre: "Multi", streams: [
    { label: "Live",   url: "http://adas.poptarisznya.hu:8200/live.mp3" },
    { label: "Oldies", url: "http://adas.poptarisznya.hu:8200/oldies.mp3" },
  ] },
  { id: "magic-disco-klsx", name: "Magic Disco", genre: "Disco Italo", streams: [
    { label: "Italo disco", url: "http://178.238.212.164:4420/live.mp3" },
  ] },
];

// localStorage perzisztencia tenant-szétválasztva. A kulcs:
//   sl-netradios:<tenantId>     – egy tenant felhasználóinak listája
//   sl-netradios                – fallback a régi (pre-tenant) adatoknak
// A getTenantId() a session-/localStorage activeTenantId-ből olvas.
const LS_KEY_NETRADIOS_BASE = "sl-netradios";
function getActiveTenantId(): string {
  try {
    return sessionStorage.getItem("activeTenantId")
      ?? localStorage.getItem("activeTenantId")
      ?? "";
  } catch { return ""; }
}
function lsKeyForTenant(tenantId?: string): string {
  const t = tenantId ?? getActiveTenantId();
  return t ? `${LS_KEY_NETRADIOS_BASE}:${t}` : LS_KEY_NETRADIOS_BASE;
}

function normalizeNetRadios(arr: any): NetRadio[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((r: any) =>
      r && typeof r.id === "string" && typeof r.name === "string"
      && Array.isArray(r.streams) && r.streams.length > 0)
    .map((r: any) => ({
      id:      r.id,
      name:    stripAccents(String(r.name)),
      genre:   stripAccents(String(r.genre ?? "")),
      streams: r.streams.map((s: any) => ({
        label: stripAccents(String(s.label ?? "")),
        url:   String(s.url ?? ""),
      })),
    }));
}

function loadNetRadiosFromLS(): NetRadio[] {
  try {
    const tKey = lsKeyForTenant();
    // 1) Tenant-specifikus kulcs
    const raw = window.localStorage.getItem(tKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      const list = normalizeNetRadios(parsed);
      if (list.length > 0) return list;
    }
    // 2) Legacy "sl-netradios" (pre-tenant) – ha van, migráljuk a tenant-kulcsra
    if (tKey !== LS_KEY_NETRADIOS_BASE) {
      const legacy = window.localStorage.getItem(LS_KEY_NETRADIOS_BASE);
      if (legacy) {
        const list = normalizeNetRadios(JSON.parse(legacy));
        if (list.length > 0) {
          try { window.localStorage.setItem(tKey, JSON.stringify(list)); } catch {}
          return list;
        }
      }
    }
  } catch { /* fall through */ }
  return NET_RADIOS_INITIAL;
}

function saveNetRadiosToLS(list: NetRadio[]): void {
  try { window.localStorage.setItem(lsKeyForTenant(), JSON.stringify(list)); } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function fmtDuration(sec: number | null | undefined): string {
  if (!sec) return "–";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function fmtDateTimeFull(iso: string): string {
  return new Date(iso).toLocaleString("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function addSeconds(iso: string, sec: number | null | undefined): string | null {
  if (!sec) return null;
  return new Date(new Date(iso).getTime() + sec * 1000).toLocaleTimeString("hu-HU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// A "label" mezőt (felhasználónak látszó szöveg) a render-ben, t()-vel
// állítjuk elő (lásd statusLabelKey), mert ez a konstans a komponensen
// kívül van, hooks (useTranslation) nélkül.
const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  PENDING: { bg: "#eff6ff", color: "#1d4ed8" },
  DISPATCHED: { bg: "#f0fdf4", color: "#15803d" },
  CANCELLED: { bg: "#f9fafb", color: "#6b7280" },
};
function statusLabelKey(status: string): string {
  return status === "DISPATCHED" ? "status.dispatched" : status === "CANCELLED" ? "status.cancelled" : "status.pending";
}

function getTeachingHours(bells: BellEntry[], onDay: Date): Array<{ start: Date; end: Date }> {
  const pairs: Array<{ start: Date; end: Date }> = [];
  const sorted = [...bells].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  for (let i = 0; i < sorted.length - 1; i += 2) {
    const s = new Date(onDay);
    s.setHours(sorted[i].hour, sorted[i].minute, 0, 0);
    const e = new Date(onDay);
    e.setHours(sorted[i + 1].hour, sorted[i + 1].minute, 0, 0);
    pairs.push({ start: s, end: e });
  }
  return pairs;
}

function checkTeachingHourOverlap(start: Date, durSec: number | null | undefined, bells: BellEntry[]): boolean {
  if (!durSec || bells.length < 2) return false;
  const end = new Date(start.getTime() + durSec * 1000);
  const hours = getTeachingHours(bells, start);
  return hours.some((h) => start < h.end && end > h.start);
}

// ─── CSS ──────────────────────────────────────────────────────────────────
const CSS = `
  .sr-page{font-family:'Nunito','Segoe UI',sans-serif;max-width:1300px}
  .sr-hdr{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:24px;flex-wrap:wrap}
  .sr-title{font-size:22px;font-weight:900;color:var(--sl-text);letter-spacing:-0.5px}
  .sr-subtitle{font-size:13px;color:var(--sl-muted);margin-top:3px}
  .sr-layout{display:grid;grid-template-columns:520px 1fr;gap:20px;align-items:start}
  .sr-panel{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(59,130,246,0.07)}
  .sr-panel-hdr{padding:14px 18px;border-bottom:1px solid var(--sl-border);display:flex;align-items:center;justify-content:space-between;gap:10px}
  .sr-panel-title{font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.6px;color:var(--sl-muted)}
  .sr-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:11px;border:none;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.15s;font-family:inherit;white-space:nowrap}
  .sr-btn:disabled{opacity:0.55;cursor:not-allowed}
  .sr-btn-primary{background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;box-shadow:0 3px 10px rgba(99,102,241,0.28)}
  .sr-btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 5px 14px rgba(99,102,241,0.36)}
  .sr-btn-ghost{background:var(--sl-bg);border:1.5px solid var(--sl-border);color:var(--sl-text-2)}
  .sr-btn-ghost:hover:not(:disabled){background:var(--sl-border)}
  .sr-btn-danger{background:#fff5f5;border:1.5px solid #fecaca;color:#dc2626}
  .sr-btn-danger:hover:not(:disabled){background:#fee2e2}
  .sr-btn-sm{padding:5px 10px;font-size:12px;border-radius:8px}
  .sr-alert{padding:10px 14px;border-radius:11px;font-size:13px;display:flex;align-items:flex-start;gap:8px;margin-bottom:14px}
  .sr-alert-error{background:#fef2f2;border:1px solid #fecaca;color:#dc2626}
  .sr-alert-warn{background:#fffbeb;border:1px solid #fde68a;color:#d97706}
  .sr-alert-ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d}

  /* Upload zone */
  .sr-upload-zone{
    margin:16px;border:2px dashed var(--sl-border);border-radius:14px;
    padding:22px 20px;text-align:center;cursor:pointer;
    transition:all 0.2s;background:var(--sl-bg);
  }
  .sr-upload-zone:hover,.sr-upload-zone.drag{border-color:#3b82f6;background:#eff6ff}
  .sr-upload-icon{font-size:32px;margin-bottom:6px}
  .sr-upload-txt{font-size:14px;font-weight:700;color:var(--sl-text-2)}
  .sr-upload-sub{font-size:12px;color:var(--sl-muted);margin-top:4px}
  .sr-upload-progress{height:4px;background:var(--sl-border);border-radius:99px;overflow:hidden;margin:8px 16px 0}
  .sr-upload-bar{height:100%;background:linear-gradient(90deg,#3b82f6,#6366f1);border-radius:99px;transition:width 0.3s}

  /* File list */
  .sr-file-item{padding:11px 16px;border-bottom:1px solid var(--sl-border);transition:background 0.12s;cursor:pointer}
  .sr-file-item:last-child{border-bottom:none}
  .sr-file-item:hover{background:rgba(59,130,246,0.03)}
  .sr-file-item.selected{background:rgba(59,130,246,0.10);border-left:3px solid #3b82f6}
  .sr-file-name{font-size:13.5px;font-weight:700;color:var(--sl-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}
  .sr-file-meta{font-size:11px;color:var(--sl-muted);display:flex;gap:10px;margin-top:3px;flex-wrap:wrap}
  .sr-file-actions{display:flex;gap:6px;align-items:center;flex-shrink:0}

  /* Audio player */
  .sr-player{margin:10px 14px;background:var(--sl-bg);border:1px solid var(--sl-border);border-radius:12px;padding:10px 14px}
  .sr-player-name{font-size:12px;font-weight:800;color:var(--sl-text);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sr-player audio{width:100%;height:32px;border-radius:8px;accent-color:#3b82f6}

  /* Schedule list */
  .sr-sched-item{padding:12px 16px;border-bottom:1px solid var(--sl-border);display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center}
  .sr-sched-item:last-child{border-bottom:none}
  .sr-sched-time{font-size:15px;font-weight:900;color:var(--sl-text)}
  .sr-sched-end{font-size:12px;color:var(--sl-muted)}
  .sr-sched-file{font-size:12.5px;font-weight:700;color:var(--sl-text-2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}
  .sr-sched-target{font-size:11px;color:var(--sl-muted);margin-top:2px}
  .sr-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;border:1px solid}

  /* Past schedules */
  .sr-sched-past{background:var(--sl-bg);opacity:0.75}
  .sr-sched-past:hover{opacity:1;background:rgba(59,130,246,0.04)}

  /* Schedule form */
  .sr-form{padding:16px;display:flex;flex-direction:column;gap:14px}
  .sr-label{display:block;font-size:11.5px;font-weight:800;color:var(--sl-text-2);margin-bottom:5px;letter-spacing:0.3px;text-transform:uppercase}
  .sr-input,.sr-select{width:100%;padding:9px 12px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg);color:var(--sl-text);font-size:13.5px;outline:none;transition:all 0.15s;font-family:inherit}
  .sr-input:focus,.sr-select:focus{border-color:#3b82f6;background:var(--sl-surface);box-shadow:0 0 0 3px rgba(59,130,246,0.11)}
  .sr-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:20px;border:1.5px solid var(--sl-border);background:var(--sl-bg);font-size:13px;font-weight:600;color:var(--sl-text-2);cursor:pointer;transition:all 0.15s}
  .sr-chip.active{background:linear-gradient(135deg,#eff6ff,#f5f3ff);border-color:#bfdbfe;color:#1d4ed8;font-weight:800}
  .sr-chip:hover:not(.active){border-color:#bfdbfe;color:var(--sl-text)}
  .sr-device-list{display:flex;flex-direction:column;gap:4px;max-height:150px;overflow-y:auto;padding:6px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg)}
  .sr-device-item{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:9px;cursor:pointer;transition:background 0.12s;border:1.5px solid transparent}
  .sr-device-item:hover{background:var(--sl-border)}
  .sr-device-item.sel{background:rgba(59,130,246,0.18);border-color:#3b82f6}
  .sr-dot-on{width:6px;height:6px;border-radius:50%;background:#22c55e;flex-shrink:0}
  .sr-dot-off{width:6px;height:6px;border-radius:50%;background:#94a3b8;flex-shrink:0}
  .sr-time-preview{background:linear-gradient(135deg,#eff6ff,#f5f3ff);border:1px solid #bfdbfe;border-radius:11px;padding:10px 14px;font-size:13px;color:#1d4ed8;display:flex;align-items:center;gap:10px}
  .sr-empty{text-align:center;padding:36px 20px;color:var(--sl-muted)}
  .sr-empty-icon{font-size:34px;margin-bottom:10px}
  .sr-lesson-warn{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:800;color:#b45309;background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:2px 7px}

  /* Now Playing + Stop */
  .sr-stop-btn{background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;border:none;border-radius:10px;padding:8px 18px;font-size:13px;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:7px;box-shadow:0 3px 10px rgba(220,38,38,0.35);transition:all 0.15s;white-space:nowrap}
  .sr-stop-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 5px 16px rgba(220,38,38,0.45)}
  .sr-stop-btn:disabled{opacity:0.6;cursor:not-allowed}
  .sr-now-playing{display:flex;align-items:center;gap:9px;padding:7px 14px;border-radius:10px;border:1px solid;font-size:12px;font-weight:700;transition:all 0.4s;white-space:nowrap;min-width:220px;max-width:300px}
  .sr-now-playing-idle{background:#1e293b;border-color:#334155;color:#64748b}
  .sr-now-playing-active{background:linear-gradient(135deg,#14532d,#166534);border-color:#22c55e;color:#bbf7d0;box-shadow:0 2px 12px rgba(34,197,94,0.2)}
  .sr-now-playing-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .sr-now-playing-dot-idle{background:#475569}
  .sr-now-playing-dot-active{background:#22c55e;box-shadow:0 0 6px #22c55e;animation:sr-pulse 1.5s infinite}
  @keyframes sr-pulse{0%,100%{opacity:1}50%{opacity:0.4}}
  .sr-hdr-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}

  /* Playlist builder */
  .sr-pl-item{display:flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid var(--sl-border);border-radius:11px;background:var(--sl-bg);margin-bottom:6px;transition:background 0.12s}
  .sr-pl-item:hover{background:var(--sl-border)}
  .sr-pl-drag{cursor:grab;color:var(--sl-muted);font-size:16px;padding:0 2px}
  .sr-pl-num{font-size:11px;font-weight:800;color:var(--sl-muted);min-width:18px;text-align:center}
  .sr-pl-info{flex:1;min-width:0}
  .sr-pl-title{font-size:13px;font-weight:700;color:var(--sl-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sr-pl-dur{font-size:11px;color:var(--sl-muted);margin-top:2px}
  .sr-pl-src{font-size:10px;padding:2px 7px;border-radius:20px;font-weight:700}
  .sr-pl-src-yt{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
  .sr-pl-src-up{background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0}
  .sr-pl-src-gd{background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}

  /* Search results */
  .sr-search-result{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;cursor:pointer;transition:background 0.12s;border:1.5px solid transparent}
  .sr-search-result:hover{background:var(--sl-bg);border-color:var(--sl-border)}
  .sr-search-result.sel{background:rgba(59,130,246,0.18);border-color:#3b82f6;color:var(--sl-text)}
  .sr-search-thumb{width:60px;height:45px;border-radius:7px;object-fit:cover;flex-shrink:0;background:#1e293b}
  .sr-search-title{font-size:13px;font-weight:700;color:var(--sl-text);line-height:1.4}
  .sr-search-meta{font-size:11px;color:var(--sl-muted);margin-top:2px}

  /* Tabs */
  .sr-tabs{display:flex;gap:4px;padding:10px 14px 0;border-bottom:1px solid var(--sl-border)}
  .sr-tab{padding:7px 14px;border-radius:10px 10px 0 0;font-size:12px;font-weight:700;cursor:pointer;border:1px solid transparent;border-bottom:none;transition:all 0.15s;font-family:inherit;background:none;color:var(--sl-muted)}
  .sr-tab.active{background:var(--sl-surface);border-color:var(--sl-border);color:var(--sl-blue);border-bottom-color:var(--sl-surface)}
  .sr-tab:hover:not(.active){color:var(--sl-text);background:var(--sl-bg)}

  /* Drive paste */
  .sr-paste-row{display:flex;gap:8px;margin:12px 14px}
  .sr-paste-input{flex:1;padding:8px 12px;border:1.5px solid var(--sl-border);border-radius:10px;background:var(--sl-bg);color:var(--sl-text);font-size:13px;outline:none;font-family:inherit}
  .sr-paste-input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.11)}

  /* Total bar */
  .sr-total-bar{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:linear-gradient(135deg,#eff6ff,#f5f3ff);border-top:1px solid #bfdbfe;font-size:13px;font-weight:800;color:#1d4ed8}

  /* Built result */
  .sr-built-result{padding:14px;background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border-top:1px solid #bbf7d0;display:flex;flex-direction:column;gap:10px}

  /* ── Új: 3-sor scrollable hangfájl-lista ──────────────────────────────── */
  /* Pontosan 3 sor magas, görgethető; egy sor magassága ≈ 64px (badge + meta) */
  .sr-files-scroll{max-height:230px;overflow-y:auto}
  .sr-files-scroll::-webkit-scrollbar{width:8px}
  .sr-files-scroll::-webkit-scrollbar-thumb{background:var(--sl-border);border-radius:4px}
  .sr-files-scroll::-webkit-scrollbar-track{background:transparent}

  /* ── Új: tab bar a bal alsó panelen (Könyvtár / Internetrádió) ───────── */
  .sr-tab-bar{display:flex;gap:0;border-bottom:1.5px solid var(--sl-border);background:var(--sl-bg)}
  .sr-tab{flex:1;padding:11px 16px;border:none;background:transparent;font-size:13px;font-weight:700;font-family:'Nunito',sans-serif;cursor:pointer;color:var(--sl-muted);transition:all 0.15s;border-bottom:2.5px solid transparent}
  .sr-tab:hover{color:var(--sl-text-2);background:rgba(59,130,246,0.04)}
  .sr-tab.active{color:#1d4ed8;border-bottom-color:#3b82f6;background:var(--sl-surface)}

  /* ── Új: internetrádió listanézet (görgethető táblázat) ───────────────── */
  .sr-radio-list-wrap{max-height:380px;overflow-y:auto;border-top:1px solid var(--sl-border);border-bottom:1px solid var(--sl-border)}
  .sr-radio-list-wrap::-webkit-scrollbar{width:8px}
  .sr-radio-list-wrap::-webkit-scrollbar-thumb{background:var(--sl-border);border-radius:4px}
  .sr-radio-row{display:grid;grid-template-columns:32px 1.4fr 1fr auto auto;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--sl-border);font-family:'Nunito',sans-serif;font-size:13px;color:var(--sl-text);transition:background 0.12s}
  .sr-radio-row:last-child{border-bottom:none}
  .sr-radio-row:hover{background:rgba(59,130,246,0.05)}
  .sr-radio-num{font-size:11px;font-weight:800;color:var(--sl-muted);font-variant-numeric:tabular-nums;letter-spacing:0.3px}
  .sr-radio-name{font-weight:800;color:var(--sl-text)}
  .sr-radio-genre{font-size:12px;color:var(--sl-muted);font-weight:500}
  .sr-radio-stream-pick{padding:5px 8px;border:1.5px solid var(--sl-border);border-radius:8px;background:var(--sl-surface);color:var(--sl-text);font-size:12.5px;font-family:inherit;min-width:120px;cursor:pointer}
  .sr-radio-stream-pick:disabled{opacity:0.5;cursor:default}
  .sr-radio-actions{display:flex;gap:5px}
  .sr-radio-actions .sr-btn-sm{padding:4px 8px;font-size:12px}
  @media(max-width:760px){
    .sr-radio-row{grid-template-columns:28px 1fr auto;row-gap:6px}
    .sr-radio-genre,.sr-radio-stream-pick{grid-column:2/-1}
    .sr-radio-actions{grid-column:1/-1;justify-content:flex-end}
  }
  /* Új állomás / szerkesztés modal mezőlistája */
  .sr-stream-row{display:grid;grid-template-columns:1fr 2fr auto;gap:8px;align-items:center}
  .sr-stream-row .sr-input{height:34px}

  /* ── Play gomb állapot-vizualizáció ─ közös a netrádió és a könyvtár fájl-
     során is. Disabled-on a !important felülírja a globális opacity-t. */
  .sr-play-connecting{
    background:#16a34a !important;color:#fff !important;border-color:transparent !important;
    animation:sr-blink-green 0.7s ease-in-out infinite;opacity:1 !important;
  }
  .sr-play-playing{
    background:linear-gradient(135deg,#16a34a,#15803d) !important;color:#fff !important;
    border-color:transparent !important;box-shadow:0 2px 8px rgba(22,163,74,0.35);opacity:1 !important;
  }
  .sr-play-error{
    background:linear-gradient(135deg,#dc2626,#b91c1c) !important;color:#fff !important;
    border-color:transparent !important;animation:sr-blink-red 0.5s ease-in-out 4;opacity:1 !important;
  }
  @keyframes sr-blink-green{0%,100%{opacity:1}50%{opacity:0.45}}
  @keyframes sr-blink-red{0%,100%{opacity:1}50%{opacity:0.4}}

  /* "🔨 Összeállít" gomb amíg a backend build fut – pulzáló háttér,
     hogy a felhasználó lássa, hogy aktív (a backend yt-dlp + ffmpeg
     pipeline-ja akár 30+ másodperc is lehet). A disabled állapotot
     a !important override-olja a globális .sr-btn:disabled-on. */
  .sr-build-busy{
    background:linear-gradient(135deg,#3b82f6,#8b5cf6,#3b82f6) !important;
    background-size:200% 100% !important;
    opacity:1 !important;
    color:#fff !important;
    animation:sr-build-pulse 1.6s ease-in-out infinite;
    cursor:wait !important;
  }
  @keyframes sr-build-pulse{
    0%   {background-position:0% 50%;  box-shadow:0 0 0 0 rgba(99,102,241,0.55);}
    50%  {background-position:100% 50%;box-shadow:0 0 0 8px rgba(99,102,241,0);}
    100% {background-position:0% 50%;  box-shadow:0 0 0 0 rgba(99,102,241,0);}
  }

  /* ── Stream-volume slider a fejlécben (a RÁDIÓ STOP mellett) ──────────── */
  .sr-stream-vol{display:flex;align-items:center;gap:8px;padding:6px 12px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-surface);min-width:170px}
  .sr-stream-vol-icon{font-size:14px;line-height:1;flex-shrink:0}
  .sr-stream-vol-slider{flex:1;-webkit-appearance:none;appearance:none;height:6px;border-radius:5px;background:linear-gradient(90deg,#3b82f6 var(--vol),#e2e8f0 var(--vol));outline:none;cursor:pointer}
  .sr-stream-vol-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:#3b82f6;cursor:pointer;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.2)}
  .sr-stream-vol-slider::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#3b82f6;cursor:pointer;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.2)}
  .sr-stream-vol-val{font-family:monospace;font-size:12px;font-weight:800;color:var(--sl-text-2);min-width:18px;text-align:right;letter-spacing:0.3px}

  /* ── Új: Időzített lejátszások overlay (jövő/múlt elválasztó) ──────────── */
  .sr-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.42);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto;animation:sr-fade 0.15s ease}
  .sr-overlay-modal{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:22px;width:100%;max-width:780px;box-shadow:0 24px 64px rgba(0,0,0,0.18);animation:sr-slide 0.2s ease}
  .sr-overlay-hdr{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--sl-border);position:sticky;top:0;background:var(--sl-surface);border-radius:22px 22px 0 0}
  .sr-overlay-title{font-family:'Nunito',sans-serif;font-size:17px;font-weight:900;color:var(--sl-text);display:flex;align-items:center;gap:8px}
  .sr-overlay-close{width:32px;height:32px;border-radius:8px;border:1.5px solid var(--sl-border);background:var(--sl-bg);color:var(--sl-muted);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .sr-overlay-body{padding:18px 22px;max-height:70vh;overflow-y:auto}
  .sr-section-divider{display:flex;align-items:center;gap:12px;margin:18px 0 10px;color:var(--sl-muted);font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px}
  .sr-section-divider::before,.sr-section-divider::after{content:"";flex:1;height:1.5px;background:var(--sl-border)}
  @keyframes sr-fade{from{opacity:0}to{opacity:1}}
  @keyframes sr-slide{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}

  @media(max-width:1000px){.sr-layout{grid-template-columns:1fr}}
`;

export default function SchoolRadio() {
  const { t } = useTranslation(["radio", "common"]);
  const { state } = useAuth();
  const role = state.status === "authed" ? ((state.user as any)?.role ?? "") : "";
  const canSetTenantDefault = role === "TENANT_ADMIN" || role === "SUPER_ADMIN";

  // ── Alap állapot ──────────────────────────────────────────────────────────
  const [files, setFiles] = useState<RadioFile[]>([]);
  const [schedules, setSchedules] = useState<RadioSchedule[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [drag, setDrag] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plFileInputRef = useRef<HTMLInputElement>(null);

  // Fájl választó + lejátszó
  const [selectedFile, setSelectedFile] = useState<RadioFile | null>(null);

  // Ütemezés form
  const [formOpen, setFormOpen] = useState(false);
  const [formFileId, setFormFileId] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formTarget, setFormTarget] = useState<"ALL" | "DEVICE" | "GROUP">("ALL");
  const [formTargetId, setFormTargetId] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Csengetési rend
  const [mainBells, setMainBells] = useState<BellEntry[]>([]);

  // Vészleállító
  const [stopBusy, setStopBusy] = useState(false);

  // Now Playing
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>(null);
  const [nowTick, setNowTick] = useState(0);

  // ── Playlist builder állapot ──────────────────────────────────────────────
  const [plItems, setPlItems] = useState<PlItem[]>([]);
  const [plName, setPlName] = useState("");
  const [plBusy, setPlBusy] = useState(false);
  const [plError, setPlError] = useState<string | null>(null);
  const [plBuiltFileId, setPlBuiltFileId] = useState<string | null>(null);
  const [plBuiltUrl, setPlBuiltUrl] = useState<string | null>(null);
  const [plBuiltName, setPlBuiltName] = useState<string | null>(null);
  const [plTab, setPlTab] = useState<"list" | "yt-search" | "yt-url" | "gdrive" | "recording">("list");

  // YT keresés
  const [ytQuery, setYtQuery] = useState("");
  const [ytResults, setYtResults] = useState<{ id: string; title: string; duration: string; thumbnail: string }[]>([]);
  const [ytSearching, setYtSearching] = useState(false);
  const [ytSelResult, setYtSelResult] = useState<string | null>(null);

  // YT URL paste
  const [ytPasteUrl, setYtPasteUrl] = useState("");
  const [ytFetching, setYtFetching] = useState(false);

  // Drive
  const [driveUrl, setDriveUrl] = useState("");
  const [driveFetching, setDriveFetching] = useState(false);
  const [driveFiles, setDriveFiles] = useState<{ name: string; url: string; durationSec?: number }[]>([]);

  // Drag reorder
  const dragIdx = useRef<number | null>(null);

  // ── Új: Időzített lejátszások overlay (összevont jövő + múlt) ──────────────
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── Új: bal alsó panel tabok – Hangfájl könyvtár / Internetrádió ───────────
  const [sourceTab, setSourceTab] = useState<"library" | "netradio">("library");

  // ── Új: internetrádió listája + kiválasztott állomás/stream/target ─────────
  const [netRadios, setNetRadios] = useState<NetRadio[]>(() => loadNetRadiosFromLS());
  // Per-állomás: melyik stream van kiválasztva (label vagy index). Map<id, index>
  const [streamPick, setStreamPick] = useState<Record<string, number>>({});
  // Per-állomás státusz a ▶ gomb vizualizációjához:
  //   "connecting" - épp indítjuk (zöld villogás)
  //   "playing"    - sikerült indítani, fut (folyamatos zöld)
  //   "error"      - hibás stream (piros, ~3 sec)
  const [streamStatus, setStreamStatus] =
    useState<Record<string, "connecting"|"playing"|"error">>({});
  const [streamError,      setStreamError]      = useState<string|null>(null);
  const [streamTargetType, setStreamTargetType] = useState<"ALL"|"DEVICE"|"GROUP">("ALL");
  const [streamTargetId,   setStreamTargetId]   = useState("");

  // ── Új: manuálisan elindított "most játszó" (a backend schedule-based
  // nowPlaying mellett, netrádió + play-now eseteket lefedi). Mindkettő
  // szerepelhet, az effective most-játszó: schedule > manual.
  const [manualNowPlaying, setManualNowPlaying] =
    useState<{ name: string; source: "stream"|"file" } | null>(null);

  // ── Stream-volume slider (0..10) – CSAK a rádió/play-now streamre hat,
  // a csengetésre és üzenetekre NEM.
  //
  // Mapping a backend-en (sliderToLinearGain):
  //   slider=10 → 0 dB    (max amplitúdó)
  //   slider=1  → -36 dB  (~0.016 lineáris)
  //   slider=0  → mute
  //   9 lépés: -4 dB/egység, decibel-egyenletes.
  //
  // A változás LIVE: a slider mozgásakor azonnal (debouncolt, 150ms-os)
  // PUT /radio/stream-volume megy ki, és a backend mixer a köv. PCM chunk-tól
  // alkalmazza az új gain-t. A snapserver puffer (~1 sec) miatt a klienseken
  // kb. 1 másodperc késéssel hallható a változás.
  const [streamVolume, setStreamVolume] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem("sl-stream-volume");
      const n = raw ? parseInt(raw, 10) : NaN;
      if (isFinite(n) && n >= 0 && n <= 10) return n;
    } catch {}
    return 8;
  });
  useEffect(() => {
    try { window.localStorage.setItem("sl-stream-volume", String(streamVolume)); } catch {}
  }, [streamVolume]);

  // Debounce-olt live push a backendre. Kerüli, hogy minden 1-egységnyi
  // slider-mozdulatra hívás menjen ki (chrome 1 egységenként emit-el).
  // 150ms ablak: kényelmes vonszolásnak, mégis prompt érzet.
  const liveVolumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (liveVolumeTimer.current) clearTimeout(liveVolumeTimer.current);
    liveVolumeTimer.current = setTimeout(() => {
      apiFetch("/radio/stream-volume", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ value: streamVolume }),
      }).catch(() => { /* lehet, hogy nem szól rádió – nem fatal */ });
    }, 150);
    return () => {
      if (liveVolumeTimer.current) clearTimeout(liveVolumeTimer.current);
    };
  }, [streamVolume]);
  // Új állomás / szerkesztés modal
  type StationForm = {
    mode: "new" | "edit";
    id:    string;
    name:  string;
    genre: string;
    streams: NetRadioStream[];
  };
  const [stationForm,  setStationForm]  = useState<StationForm|null>(null);
  const [stationError, setStationError] = useState<string|null>(null);

  // Lista perzisztálása minden módosításra
  useEffect(() => { saveNetRadiosToLS(netRadios); }, [netRadios]);

  // ── Új: per-fájl azonnali lejátszás státusza (ugyanaz a vizualizáció,
  // mint a netrádió listán: connecting=zöld villogás, playing=folyamatos
  // zöld, error=piros 3 sec-ig). Egyszerre csak egy fájl szólhat.
  const [fileStatus, setFileStatus] =
    useState<Record<string, "connecting"|"playing"|"error">>({});

  // ── Új: playlist builder "hangfelvétel" tab ────────────────────────────────
  const [recRadioState, setRecRadioState]       = useState<"idle"|"recording"|"recorded">("idle");
  const [recRadioSeconds, setRecRadioSeconds]   = useState(0);
  const [recRadioBlob, setRecRadioBlob]         = useState<Blob|null>(null);
  const [recRadioAudioUrl, setRecRadioAudioUrl] = useState<string|null>(null);
  const [recRadioError, setRecRadioError]       = useState<string|null>(null);
  const [recRadioUploading, setRecRadioUploading] = useState(false);
  const recRadioRecorder = useRef<MediaRecorder|null>(null);
  const recRadioChunks   = useRef<BlobPart[]>([]);
  const recRadioTimer    = useRef<ReturnType<typeof setInterval>|null>(null);

  // ── Betöltés ─────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [filesRes, schedsRes, targetsRes] = await Promise.all([
        apiFetch<{ ok: boolean; files: RadioFile[] }>("/radio/files"),
        apiFetch<{ ok: boolean; schedules: RadioSchedule[] }>("/radio/schedules"),
        apiFetch<{ ok: boolean; devices: Device[]; groups: DeviceGroup[] }>("/radio/targets"),
      ]);
      setFiles(filesRes.files ?? []);
      setSchedules(schedsRes.schedules ?? []);
      setDevices(targetsRes.devices ?? []);
      setGroups(targetsRes.groups ?? []);
    } catch (e: any) {
      setError(e?.message ?? t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 5_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const now = new Date();
    const playing = schedules.find((s) => {
      if (s.status === "CANCELLED" || s.status === "PENDING") return false;
      const start = new Date(s.dispatchedAt ?? s.scheduledAt);
      const dur = s.radioFile.durationSec;
      if (!dur) return false;
      return now >= start && now <= new Date(start.getTime() + dur * 1000);
    });

    setNowPlaying(
      playing
        ? {
            name: playing.radioFile.originalName,
            durationSec: playing.radioFile.durationSec,
            startsAt: new Date(playing.dispatchedAt ?? playing.scheduledAt),
          }
        : null
    );
  }, [schedules, nowTick]);

  // ── Snap-mixer ÉLŐ állapotának pollolása ─────────────────────────────────
  // A backend `/radio/snap-playing` a snap-pipe-ról közvetlenül adja vissza,
  // hogy épp megy-e RADIO. Page-mount-on + nowTick-enként (5 sec) frissítjük
  // a `manualNowPlaying`-et – így:
  //   • elnavigálás → vissza: a HUD nem felejti el a rádiót
  //   • másik user bejelentkezik: ő is rögtön látja, mi szól
  //   • pausedStack (bell/TTS megszakította): továbbra is "playing" jelzés
  // A felhasználói "Play" gombbal indított optimistic UI nem ütközik:
  // ha a backend még nem látja (pre-silence alatt), a következő tick átveszi.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ ok: boolean; playing: { name: string; source: "stream" | "file" } | null }>(
      "/radio/snap-playing",
    )
      .then((res) => {
        if (cancelled) return;
        if (res.playing) {
          setManualNowPlaying({
            name:   res.playing.name,
            source: res.playing.source,
          });
        } else {
          // Csak akkor töröljük, ha a backend tényleg nem lát semmit.
          // (Ha a user éppen most kattintott Play-re és a snap még pre-silence-
          // ben van, a backend null-t adhat – de a következő tick eléri.)
          setManualNowPlaying(null);
        }
      })
      .catch(() => {
        /* hálózati hiba: ne piszkáljuk a UI-t */
      });
    return () => {
      cancelled = true;
    };
  }, [nowTick]);

  useEffect(() => {
    apiFetch<{ ok: boolean; templates: Array<{ bells: BellEntry[]; isDefault: boolean }> }>("/bells/templates")
      .then((r) => {
        const def = r.templates?.find((t) => t.isDefault) ?? r.templates?.[0];
        if (def) setMainBells(def.bells.filter((b) => b.type === "MAIN"));
      })
      .catch(() => {});
  }, []);

  // ── Azonnali lejátszás (meglévő RadioFile) ────────────────────────────────
  // POST /radio/files/:id/play-now – a backend SnapcastService.play-on át
  // azonnal indítja a hangfájlt a kiválasztott céleszközökön. A komponens
  // jelenlegi cél/group state-jét használjuk (formTarget / formTargetId);
  // ha nincs aktív választás, az "ALL" megy.
  async function playFileNow(file: RadioFile) {
    // Másik fájl/rádió épp connecting-ben? Ne hagyjuk félbe.
    if (Object.values(fileStatus).some(s => s === "connecting")) return;
    // Új lejátszás → minden korábbi állomány- és stream-státusz reset
    setFileStatus({ [file.id]: "connecting" });
    setStreamStatus({});
    setError(null);
    try {
      const body: any = { targetType: formTarget, streamVolume };
      if (formTarget !== "ALL" && formTargetId) body.targetId = formTargetId;
      await apiFetch(`/radio/files/${file.id}/play-now`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      // Sikeres indítás: zöld + now-playing label
      setFileStatus({ [file.id]: "playing" });
      setManualNowPlaying({ name: file.originalName, source: "file" });
      await loadAll();
    } catch (e:any) {
      // 3 sec-ig piros, aztán reset (mint a stream-nél)
      setFileStatus({ [file.id]: "error" });
      setError(e?.message ?? t("errors.playNowFailed"));
      window.setTimeout(() => {
        setFileStatus(prev => {
          if (prev[file.id] !== "error") return prev;
          const { [file.id]: _, ...rest } = prev;
          return rest;
        });
      }, 3000);
    }
  }

  // ── Internetrádió: stream indítás egy állomás kiválasztott alstream-jével ──
  async function playStation(station: NetRadio) {
    setStreamError(null);
    const idx = streamPick[station.id] ?? 0;
    const stream = station.streams[idx];
    const url = (stream?.url ?? "").trim();
    if (!url) {
      setStreamError(t("errors.emptyStreamUrl", { name: station.name }));
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setStreamError(t("errors.invalidUrl"));
      return;
    }
    if (streamTargetType !== "ALL" && !streamTargetId) {
      setStreamError(t("errors.chooseTarget"));
      return;
    }
    // Egyszerre csak egy állomás játszhat – előzőek státuszát töröljük,
    // a kiválasztott állomásra "connecting" (zöld villog) state-et adunk.
    setStreamStatus({ [station.id]: "connecting" });
    const fullTitle =
      `${station.name}${stream.label && stream.label !== "Főadás" ? " · " + stream.label : ""}`;
    try {
      const body: any = {
        url,
        title:        fullTitle,
        targetType:   streamTargetType,
        streamVolume,                   // 0..10, a backend ffmpeg gain-be alakítja
      };
      if (streamTargetType !== "ALL") body.targetId = streamTargetId;
      await apiFetch("/radio/play-stream", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      // Sikeres indítás: folyamatos zöld + now-playing label.
      setStreamStatus({ [station.id]: "playing" });
      setManualNowPlaying({ name: fullTitle, source: "stream" });
    } catch (e:any) {
      // Pirosba villantjuk a gombot 3 másodpercig, majd resetelünk.
      setStreamStatus({ [station.id]: "error" });
      setStreamError(e?.message ?? t("errors.streamStartFailed"));
      window.setTimeout(() => {
        setStreamStatus(prev => {
          if (prev[station.id] !== "error") return prev;
          const { [station.id]: _, ...rest } = prev;
          return rest;
        });
      }, 3000);
    }
  }

  // ── CRUD: állomások + alstreamek ───────────────────────────────────────────
  function openNewStation() {
    setStationError(null);
    setStationForm({
      // "Főadás" itt alapértelmezett adat-mező (a stream lista első eleme),
      // nem UI-szöveg – a felhasználó szabadon átírhatja, ezért nem t()-vel
      // fordított kulcs (lásd a fájl elején a data-vs-UI-szöveg elhatárolást).
      mode: "new", id: "", name: "", genre: "",
      streams: [{ label: "Főadás", url: "" }],
    });
  }
  function openEditStation(r: NetRadio) {
    setStationError(null);
    setStationForm({
      mode: "edit", id: r.id, name: r.name, genre: r.genre,
      streams: r.streams.map(s => ({ ...s })),
    });
  }
  function submitStation() {
    if (!stationForm) return;
    const name  = stationForm.name.trim();
    const genre = stationForm.genre.trim();
    const streams = stationForm.streams
      .map(s => ({ label: s.label.trim(), url: s.url.trim() }))
      .filter(s => s.label.length > 0);
    if (!name) { setStationError(t("errors.nameRequired")); return; }
    if (streams.length === 0) { setStationError(t("errors.atLeastOneStream")); return; }
    if (stationForm.mode === "new") {
      const newId = (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "radio")
                    + "-" + Math.random().toString(36).slice(2, 6);
      setNetRadios(prev => [...prev, { id: newId, name, genre, streams }]);
    } else {
      setNetRadios(prev => prev.map(r => r.id === stationForm.id ? { ...r, name, genre, streams } : r));
    }
    setStationForm(null);
  }
  function removeStation(id: string) {
    const r = netRadios.find(x => x.id === id);
    if (!r) return;
    if (!window.confirm(t("confirm.deleteStation", { name: r.name }))) return;
    setNetRadios(prev => prev.filter(x => x.id !== id));
    setStreamPick(prev => { const c = { ...prev }; delete c[id]; return c; });
  }
  function restoreDefaultStations() {
    if (!window.confirm(t("confirm.restoreDefaults"))) return;
    setNetRadios(NET_RADIOS_INITIAL);
    setStreamPick({});
  }

  // ── Export / Import / Tenant default ─────────────────────────────────────
  // Export: a current netradios listából egy .json fájl letöltése.
  function exportNetRadios() {
    try {
      const data = JSON.stringify(netRadios, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      const ts   = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
      a.download = `schoollive-netradios-${ts}.json`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e:any) {
      alert(t("errors.exportFailed", { message: e?.message ?? t("errors.unknown") }));
    }
  }

  // Import: file picker, json parse, normalize, replace
  const importInputRef = useRef<HTMLInputElement|null>(null);
  function importNetRadios(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "[]"));
        const list = normalizeNetRadios(parsed);
        if (list.length === 0) { alert(t("errors.importEmptyOrInvalid")); return; }
        if (!window.confirm(t("confirm.importReplace", { current: netRadios.length, next: list.length }))) return;
        setNetRadios(list); setStreamPick({});
      } catch (e:any) {
        alert(t("errors.readError", { message: e?.message ?? t("errors.unknown") }));
      } finally {
        if (importInputRef.current) importInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  }

  // "Alapértelmezetté tesz" – csak TENANT_ADMIN / SUPER_ADMIN. A current
  // listát menti a backendre, és új felhasználók (új böngészők) ezt fogják
  // betölteni, ha még nincs lokális szerkesztett adatuk.
  const [defaultBusy, setDefaultBusy] = useState(false);
  async function setAsTenantDefault() {
    if (!window.confirm(t("confirm.setTenantDefault", { count: netRadios.length }))) return;
    setDefaultBusy(true);
    try {
      await apiFetch("/admin/tenants/me/netradio-presets", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ presets: netRadios }),
      });
      alert(t("info.tenantDefaultSaved"));
    } catch (e:any) {
      alert(t("errors.saveFailed", { message: e?.message ?? t("errors.unknown") }));
    } finally {
      setDefaultBusy(false);
    }
  }

  // Kezdeti tenant-default betöltés: ha a localStorage üres, megpróbáljuk
  // a backend-ről. Csak first-mount-on fut, és csak ha még a hardcoded
  // initial seedet látnánk.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tKey = lsKeyForTenant();
        // Ha van local-szerkesztett, ne nyúljunk hozzá
        if (window.localStorage.getItem(tKey)) return;
        const r = await apiFetch<{ ok:boolean; presets: any }>("/admin/tenants/me/netradio-presets");
        if (cancelled) return;
        if (r?.presets) {
          const list = normalizeNetRadios(r.presets);
          if (list.length > 0) {
            setNetRadios(list);
            saveNetRadiosToLS(list);   // attól, hogy a backend válasza érkezett, az LS-be is mentjük
          }
        }
      } catch { /* csendes – fallback az initial seed marad */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Playlist builder: hangfelvétel ─────────────────────────────────────────
  function stopRecRadioCleanup() {
    if (recRadioTimer.current) { clearInterval(recRadioTimer.current); recRadioTimer.current = null; }
    if (recRadioRecorder.current && recRadioRecorder.current.state !== "inactive") {
      try { recRadioRecorder.current.stop(); } catch {}
    }
    recRadioRecorder.current = null;
  }
  async function startRecRadio() {
    setRecRadioError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recRadioChunks.current = [];
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      recRadioRecorder.current = mr;
      mr.ondataavailable = e => { if (e.data.size > 0) recRadioChunks.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(recRadioChunks.current, { type: "audio/webm" });
        setRecRadioBlob(blob);
        setRecRadioAudioUrl(URL.createObjectURL(blob));
        setRecRadioState("recorded");
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start(100);
      setRecRadioState("recording");
      setRecRadioSeconds(0);
      recRadioTimer.current = setInterval(() => setRecRadioSeconds(s => s + 1), 1000);
    } catch (e:any) {
      setRecRadioError(e?.name === "NotAllowedError"
        ? t("errors.micDenied")
        : t("errors.micUnavailable", { message: e.message }));
    }
  }
  function stopRecRadio() {
    if (recRadioTimer.current) { clearInterval(recRadioTimer.current); recRadioTimer.current = null; }
    if (recRadioRecorder.current) recRadioRecorder.current.stop();
  }
  function resetRecRadio() {
    stopRecRadioCleanup();
    if (recRadioAudioUrl) URL.revokeObjectURL(recRadioAudioUrl);
    setRecRadioState("idle"); setRecRadioBlob(null); setRecRadioAudioUrl(null);
    setRecRadioSeconds(0); setRecRadioError(null);
  }
  // A rögzített hangot feltöltjük /radio/files-be (mint sima upload),
  // és a kapott fileUrl-t hozzáadjuk PlItem-ként a playlistbe.
  async function addRecordingToPlaylist() {
    if (!recRadioBlob) return;
    setRecRadioUploading(true);
    setRecRadioError(null);
    try {
      const fd = new FormData();
      fd.append("file", recRadioBlob, `radio_rec_${Date.now()}.webm`);
      const token    = sessionStorage.getItem("accessToken") ?? localStorage.getItem("accessToken") ?? "";
      const tenantId = sessionStorage.getItem("activeTenantId") ?? localStorage.getItem("activeTenantId") ?? "";
      const resp = await fetch(`${(import.meta as any).env?.VITE_API_BASE ?? "https://api.schoollive.hu"}/radio/files`, {
        method: "POST",
        headers: {
          ...(token    ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenantId ? { "x-tenant-id": tenantId } : {}),
        },
        body: fd,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || t("errors.uploadFailed"));
      const rf = data.radioFile ?? data.file ?? data;
      const fileUrl: string  = rf.fileUrl;
      const title:   string  = rf.originalName ?? t("recording.defaultTitle");
      const dur:     number|null = rf.durationSec ?? null;
      setPlItems(prev => [...prev, {
        id: uid(),
        source: "recording",
        url: fileUrl,
        title,
        durationSec: dur,
        status: "ready",
      }]);
      // Megújítjuk a könyvtárat is, mert új RadioFile rekord született
      await loadAll();
      resetRecRadio();
    } catch (e:any) {
      setRecRadioError(e?.message ?? t("errors.uploadFailed"));
    } finally {
      setRecRadioUploading(false);
    }
  }

  // ── Upload (könyvtár) ─────────────────────────────────────────────────────
  async function handleUpload(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["mp3", "wav", "ogg", "m4a", "aac"].includes(ext)) {
      setError(t("errors.invalidFileType"));
      return;
    }

    setUploading(true);
    setUploadPct(0);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status < 300
            ? resolve()
            : reject(new Error(JSON.parse(xhr.responseText)?.error ?? `HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error(t("errors.networkError")));

        const token =
          sessionStorage.getItem("accessToken") ??
          localStorage.getItem("accessToken") ??
          (state as any).token ??
          "";
        const tenantId = sessionStorage.getItem("activeTenantId") ?? localStorage.getItem("activeTenantId") ?? "";

        xhr.open("POST", `${import.meta.env.VITE_API_URL ?? "https://api.schoollive.hu"}/radio/files`);
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        if (tenantId) xhr.setRequestHeader("x-tenant-id", tenantId);
        xhr.send(formData);
      });

      await loadAll();
    } catch (e: any) {
      setError(t("errors.uploadFailedWithMessage", { message: e.message }));
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  }

  // ── Fájl törlés ───────────────────────────────────────────────────────────
  async function deleteFile(file: RadioFile) {
    const warn =
      file._count.schedules > 0
        ? t("confirm.deleteFileWithSchedules", { count: file._count.schedules, name: file.originalName })
        : t("confirm.deleteFile", { name: file.originalName });

    if (!window.confirm(warn)) return;

    try {
      await apiFetch(`/radio/files/${file.id}`, { method: "DELETE" });
      if (selectedFile?.id === file.id) setSelectedFile(null);
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? t("errors.deleteFailed"));
    }
  }

  // ── Ütemezés törlés ───────────────────────────────────────────────────────
  async function deleteSchedule(id: string) {
    if (!window.confirm(t("confirm.deleteSchedule"))) return;
    try {
      await apiFetch(`/radio/schedules/${id}`, { method: "DELETE" });
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? t("errors.deleteFailed"));
    }
  }

  // ── Ütemezés létrehozás ───────────────────────────────────────────────────
  async function submitSchedule(overrideFileId?: string) {
    const fileId = overrideFileId ?? formFileId;
    setFormError(null);

    if (!fileId) {
      setFormError(t("errors.chooseFile"));
      return;
    }
    if (!formDate || !formTime) {
      setFormError(t("errors.chooseDateTime"));
      return;
    }
    if (formTarget !== "ALL" && !formTargetId) {
      setFormError(t("errors.chooseTarget"));
      return;
    }

    const scheduledAt = new Date(`${formDate}T${formTime}:00`);
    if (isNaN(scheduledAt.getTime())) {
      setFormError(t("errors.invalidDateTime"));
      return;
    }
    if (scheduledAt < new Date()) {
      setFormError(t("errors.pastDateTime"));
      return;
    }

    const durSec = files.find((f) => f.id === fileId)?.durationSec ?? null;

    // Tanítási óra ütközés
    if (checkTeachingHourOverlap(scheduledAt, durSec, mainBells)) {
      if (!window.confirm(t("confirm.teachingHourOverlap"))) return;
    }

    // Szünetbe nem fér el – trim ajánlat
    if (durSec && mainBells.length >= 2) {
      const hours = getTeachingHours(mainBells, scheduledAt);
      const nextLesson = hours.find((h) => h.start > scheduledAt);

      if (nextLesson) {
        const breakSec = (nextLesson.start.getTime() - scheduledAt.getTime()) / 1000;
        if (durSec > breakSec) {
          const wantTrim = window.confirm(
            t("confirm.trimToFitBreak", {
              fileDur: fmtDuration(durSec),
              breakDur: fmtDuration(Math.floor(breakSec)),
            })
          );

          if (wantTrim) {
            setFormBusy(true);
            try {
              const trimSec = Math.max(1, Math.floor(breakSec) - 10);
              const trimRes = await apiFetch<{ ok: boolean; fileId: string; filename: string }>("/radio/files/trim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fileId, trimSec, fadeOut: 5 }),
              });

              if (trimRes.ok) {
                await loadAll();
                await apiFetch("/radio/schedules", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    radioFileId: trimRes.fileId,
                    targetType: formTarget,
                    targetId: formTarget === "ALL" ? null : formTargetId,
                    scheduledAt: scheduledAt.toISOString(),
                  }),
                });

                setFormOpen(false);
                setFormDate("");
                setFormTime("");
                setFormTargetId("");
                await loadAll();
                return;
              }
            } catch (e: any) {
              setFormError(t("errors.trimFailed", { message: e?.message ?? "" }));
              setFormBusy(false);
              return;
            }
          }
        }
      }
    }

    setFormBusy(true);
    try {
      await apiFetch("/radio/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          radioFileId: fileId,
          targetType: formTarget,
          targetId: formTarget === "ALL" ? null : formTargetId,
          scheduledAt: scheduledAt.toISOString(),
        }),
      });

      setFormOpen(false);
      setFormDate("");
      setFormTime("");
      setFormTargetId("");
      await loadAll();
    } catch (e: any) {
      const data = (e as any)?.data ?? {};
      setFormError(
        data?.conflict
          ? t("errors.timeConflict", { name: data.conflict.originalName })
          : (e?.message ?? t("errors.createFailed"))
      );
    } finally {
      setFormBusy(false);
    }
  }

  // ── Azonnali lejátszás a form-ról (▶ Azonnali gomb) ───────────────────────
  // A formFileId-t és formTarget-et használja, és az endpoint /radio/files/:id/play-now.
  // Időt nem kér, közvetlenül indít. A pastSchedules "🔁 Újra" gombja is ezen
  // a formon nyitja meg a célt, és innen indíthatod azonnal vagy időzítve.
  async function submitImmediateFromForm() {
    setFormError(null);
    if (!formFileId) { setFormError(t("errors.chooseFile")); return; }
    if (formTarget !== "ALL" && !formTargetId) {
      setFormError(t("errors.chooseTarget")); return;
    }
    const file = files.find(f => f.id === formFileId);
    if (!file) { setFormError(t("errors.fileNoLongerExists")); return; }
    setFormBusy(true);
    try {
      await playFileNow(file);
      // form zárás – sikeresen elment
      setFormOpen(false);
      setFormFileId("");
      setFormError(null);
    } catch (e: any) {
      setFormError(e?.message ?? t("errors.playNowFailed"));
    } finally {
      setFormBusy(false);
    }
  }

  // ── Playlist builder – YT info lekérés ───────────────────────────────────
  async function fetchYtInfo(url: string): Promise<{ title: string; durationSec: number } | null> {
    try {
      const res = await apiFetch<{ ok: boolean; title: string; durationSec: number }>(
        `/radio/yt-info?url=${encodeURIComponent(url)}`
      );
      if (res.ok) return { title: res.title, durationSec: res.durationSec };
    } catch {}
    return null;
  }

  async function addYtUrl() {
    const url = ytPasteUrl.trim();
    if (!url) return;

    setYtFetching(true);
    const itemId = uid();
    const newItem: PlItem = {
      id: itemId,
      source: "youtube",
      url,
      title: t("common:actions.loading"),
      durationSec: null,
      status: "fetching",
    };

    setPlItems((prev) => [...prev, newItem]);
    setPlTab("list");

    const info = await fetchYtInfo(url);

    setPlItems((prev) =>
      prev.map((i) =>
        i.id === itemId
          ? {
              ...i,
              title: info?.title ?? url,
              durationSec: info?.durationSec ?? null,
              status: info ? "ready" : "error",
              errorMsg: info ? undefined : t("errors.ytInfoFailed"),
            }
          : i
      )
    );

    setYtPasteUrl("");
    setYtFetching(false);
  }

  async function searchYt() {
    if (!ytQuery.trim()) return;
    setYtSearching(true);
    setYtResults([]);
    try {
      const res = await apiFetch<{ ok: boolean; results: typeof ytResults }>(
        `/radio/yt-search?q=${encodeURIComponent(ytQuery)}&limit=10`
      );
      setYtResults(res.results ?? []);
    } catch {
      setYtResults([]);
    } finally {
      setYtSearching(false);
    }
  }

  async function addYtSearchResult() {
    const result = ytResults.find((r) => r.id === ytSelResult);
    if (!result) return;

    const url = `https://www.youtube.com/watch?v=${result.id}`;
    const durParts = result.duration?.split(":").map(Number) ?? [];
    const durationSec =
      durParts.length === 2
        ? durParts[0] * 60 + durParts[1]
        : durParts.length === 3
        ? durParts[0] * 3600 + durParts[1] * 60 + durParts[2]
        : null;

    setPlItems((prev) => [
      ...prev,
      { id: uid(), source: "youtube", url, title: result.title, durationSec, status: "ready" },
    ]);

    setYtSelResult(null);
    setPlTab("list");
  }

  // ── Playlist builder – Drive lekérés ──────────────────────────────────────
  async function fetchDrive() {
    if (!driveUrl.trim()) return;
    setDriveFetching(true);
    setDriveFiles([]);
    try {
      const res = await apiFetch<{ ok: boolean; files: { name: string; url: string; durationSec?: number }[] }>(
        `/radio/gdrive-files?url=${encodeURIComponent(driveUrl.trim())}`
      );
      setDriveFiles(res.files ?? []);
    } catch (e: any) {
      setPlError(e?.message ?? t("errors.driveLoadFailed"));
    } finally {
      setDriveFetching(false);
    }
  }

  function addDriveFile(f: { name: string; url: string; durationSec?: number }) {
    setPlItems((prev) => [
      ...prev,
      { id: uid(), source: "gdrive", url: f.url, title: f.name, durationSec: f.durationSec ?? null, status: "ready" },
    ]);
  }

  // ── Playlist builder – Upload a listába ───────────────────────────────────
  async function handlePlUpload(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["mp3", "wav", "ogg", "m4a", "aac"].includes(ext)) {
      setPlError(t("errors.audioOnly"));
      return;
    }

    setPlError(null);
    const itemId = uid();
    setPlItems((prev) => [
      ...prev,
      { id: itemId, source: "upload", url: "", title: file.name, durationSec: null, status: "fetching" },
    ]);
    setPlTab("list");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const xhr = new XMLHttpRequest();
      const uploadedUrl = await new Promise<string>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status < 300) {
            const r = JSON.parse(xhr.responseText);
            resolve(r.file?.fileUrl ?? "");
          } else {
            reject(new Error(JSON.parse(xhr.responseText)?.error ?? `HTTP ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error(t("errors.networkError")));

        const token =
          sessionStorage.getItem("accessToken") ??
          localStorage.getItem("accessToken") ??
          (state as any).token ??
          "";
        const tenantId = sessionStorage.getItem("activeTenantId") ?? localStorage.getItem("activeTenantId") ?? "";

        xhr.open("POST", `${import.meta.env.VITE_API_URL ?? "https://api.schoollive.hu"}/radio/files`);
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        if (tenantId) xhr.setRequestHeader("x-tenant-id", tenantId);
        xhr.send(formData);
      });

      await loadAll();

      const uploaded = files.find((f) => f.originalName === file.name);
      setPlItems((prev) =>
        prev.map((i) =>
          i.id === itemId
            ? {
                ...i,
                url: uploadedUrl,
                title: file.name,
                durationSec: uploaded?.durationSec ?? null,
                status: "ready",
                audioPreviewUrl: uploadedUrl,
              }
            : i
        )
      );
    } catch (e: any) {
      setPlItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, status: "error", errorMsg: e.message } : i))
      );
    }
  }

  // ── Playlist builder – Összeállítás ──────────────────────────────────────
  async function buildPlaylist() {
    const readyItems = plItems.filter((i) => i.status === "ready");
    if (readyItems.length === 0) {
      setPlError(t("errors.needOneReadyItem"));
      return;
    }
    if (!plName.trim()) {
      setPlError(t("errors.needPlaylistName"));
      return;
    }

    setPlBusy(true);
    setPlError(null);
    setPlBuiltFileId(null);
    setPlBuiltUrl(null);

    try {
      const res = await apiFetch<{ ok: boolean; fileId: string }>("/radio/ytplaylists/build-custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: plName.trim(),
          // A backend build-custom route a "recording" forrást nem ismeri
          // explicit – ám a recording item ugyanolyan letölthető URL-t hordoz
          // (a RadioFile, ami már feltöltve a könyvtárba), ezért "upload"
          // forrásként adjuk át. A backend így a HTTP-fetch ágon dolgozza fel.
          items: readyItems.map((i) => ({
            url:    i.url,
            title:  i.title,
            source: i.source === "recording" ? "upload" : i.source,
          })),
        }),
      });

      const buildId = res.fileId;

      const poll = setInterval(async () => {
        try {
          const s = await apiFetch<{ ok: boolean; status: string; fileUrl: string; name: string; fileId?: string }>(
            `/radio/ytplaylists/build-status/${buildId}`
          );

          if (s.status === "DONE") {
            clearInterval(poll);
            setPlBuiltFileId(s.fileId ?? null);
            setPlBuiltUrl(s.fileUrl);
            setPlBuiltName(s.name);
            setPlBusy(false);
            await loadAll();
          } else if (s.status === "ERROR") {
            clearInterval(poll);
            setPlError(t("errors.buildFailed"));
            setPlBusy(false);
          }
        } catch {
          clearInterval(poll);
          setPlError(t("errors.buildStatusFetchError"));
          setPlBusy(false);
        }
      }, 3000);
    } catch (e: any) {
      setPlError(e?.message ?? t("errors.buildError"));
      setPlBusy(false);
    }
  }

  // ── Drag-reorder ──────────────────────────────────────────────────────────
  function onDragStart(idx: number) {
    dragIdx.current = idx;
  }

  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;

    setPlItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx.current!, 1);
      next.splice(idx, 0, moved);
      dragIdx.current = idx;
      return next;
    });
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const now = new Date();

  const upcomingSchedules = schedules
    .filter((s) => s.status === "PENDING" && new Date(s.scheduledAt) > now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const pastSchedules = schedules
    .filter((s) => s.status === "DISPATCHED" || (s.status === "PENDING" && new Date(s.scheduledAt) <= now))
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
    .slice(0, 30);

  const previewFile = files.find((f) => f.id === formFileId);
  const previewEnd =
    formDate && formTime && previewFile?.durationSec
      ? addSeconds(`${formDate}T${formTime}:00`, previewFile.durationSec)
      : null;

  const plTotalSec = plItems.filter((i) => i.status === "ready").reduce((s, i) => s + (i.durationSec ?? 0), 0);

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="sr-page">
      <style>{CSS}</style>

      {/* Header */}
      <div className="sr-hdr">
        <div>
          <div className="sr-title">📻 {t("header.title")}</div>
          <div className="sr-subtitle">{t("header.subtitle")}</div>
        </div>

        <div className="sr-hdr-right">
          {(() => {
            // Effektív "most játszik" érték:
            //  - elsődleges: schedule-based nowPlaying (radio scheduler állítja)
            //  - fallback:   manualNowPlaying (azonnal indított fájl / netrádió)
            const effective = nowPlaying
              ? { name: nowPlaying.name, icon: "🎵" }
              : manualNowPlaying
              ? { name: manualNowPlaying.name, icon: manualNowPlaying.source === "stream" ? "📻" : "🎵" }
              : null;
            const shortName = effective
              ? effective.name.length > 22 ? effective.name.slice(0, 22) + "…" : effective.name
              : null;
            return (
              <div className={`sr-now-playing ${effective ? "sr-now-playing-active" : "sr-now-playing-idle"}`}>
                <span
                  className={`sr-now-playing-dot ${effective ? "sr-now-playing-dot-active" : "sr-now-playing-dot-idle"}`}
                />
                {effective ? (
                  <span>{effective.icon} <strong>{shortName}</strong></span>
                ) : (
                  <span>{t("header.nothingPlaying")}</span>
                )}
              </div>
            );
          })()}

          <button
            className="sr-btn sr-btn-ghost"
            type="button"
            onClick={() => setHistoryOpen(true)}
            title={t("header.scheduledPlaybacksTooltip")}
          >
            📥 {t("header.scheduledPlaybacks")}{schedules.length > 0 ? ` (${schedules.length})` : ""}
          </button>

          <button
            className="sr-stop-btn"
            disabled={stopBusy}
            type="button"
            onClick={async () => {
              if (!window.confirm(t("confirm.stopAll"))) return;
              setStopBusy(true);
              // Azonnali UI feedback – a header-state-eket nem várjuk be a
              // backend válaszra, hogy a felhasználó rögtön lássa: STOP ment.
              setNowPlaying(null);
              setManualNowPlaying(null);
              setStreamStatus({});
              setFileStatus({});
              try {
                await apiFetch("/radio/stop-all", { method: "POST" });
                await loadAll();
              } catch (e: any) {
                alert(t("errors.genericError", { message: e?.message ?? t("errors.unknown") }));
              } finally {
                setStopBusy(false);
              }
            }}
          >
            🛑 {stopBusy ? t("header.stopping") : t("header.radioStop")}
          </button>

          {/* Stream-volume slider – CSAK a rádió/play-now streamre hat.
              A csengetésre és üzenetekre nincs hatása. A volume a backend
              ffmpeg pre-gain filteren át érvényesül; új lejátszáskor él. */}
          <div className="sr-stream-vol" title={t("header.streamVolumeTooltip", { value: streamVolume })}>
            <span className="sr-stream-vol-icon">
              {streamVolume === 0 ? "🔇" : streamVolume <= 3 ? "🔈" : streamVolume <= 7 ? "🔉" : "🔊"}
            </span>
            <input
              type="range" min={0} max={10} step={1}
              value={streamVolume}
              onChange={e => setStreamVolume(Number(e.target.value))}
              className="sr-stream-vol-slider"
              style={{ ["--vol" as any]: `${streamVolume * 10}%` }} />
            <span className="sr-stream-vol-val">{streamVolume}</span>
          </div>

          <button
            className="sr-btn sr-btn-primary"
            onClick={() => void loadAll()}
            disabled={loading}
            type="button"
          >
            🔄
          </button>
        </div>
      </div>

      {error && (
        <div className="sr-alert sr-alert-error">
          <span>⚠️</span>
          <span>{error}</span>
          <button
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#dc2626" }}
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}

      <div className="sr-layout">
        {/* ═══ BAL PANEL ═══ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Hangfájl könyvtár / Internetrádió – tab-os panel */}
          <div className="sr-panel">
            <div className="sr-tab-bar">
              <button
                className={`sr-tab${sourceTab === "library" ? " active" : ""}`}
                type="button"
                onClick={() => setSourceTab("library")}>
                🎵 {t("tabs.library")}
              </button>
              <button
                className={`sr-tab${sourceTab === "netradio" ? " active" : ""}`}
                type="button"
                onClick={() => setSourceTab("netradio")}>
                📻 {t("tabs.netradio")}
              </button>
            </div>

            {/* ── Internetrádió tab ─────────────────────────────────────── */}
            {sourceTab === "netradio" && (
              <div style={{padding:"14px 18px",display:"flex",flexDirection:"column",gap:12}}>
                <div style={{fontSize:12,color:"var(--sl-muted)"}}>
                  {t("netradio.description")}
                </div>

                {/* Cél választó (közös az összes állomásra) */}
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--sl-muted)",letterSpacing:0.3,textTransform:"uppercase",marginBottom:6}}>🎯 {t("target.label")}</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                    {(["ALL","DEVICE","GROUP"] as const).map(opt => (
                      <button key={opt} type="button"
                        className={`sr-btn ${streamTargetType===opt?"sr-btn-primary":"sr-btn-ghost"} sr-btn-sm`}
                        onClick={() => { setStreamTargetType(opt); setStreamTargetId(""); }}>
                        {opt==="ALL"?`📡 ${t("target.all")}`:opt==="DEVICE"?`🔊 ${t("target.device")}`:`👥 ${t("target.group")}`}
                      </button>
                    ))}
                    {streamTargetType==="DEVICE" && (
                      <select className="sr-select" style={{flex:1,minWidth:140}}
                        value={streamTargetId} onChange={e => setStreamTargetId(e.target.value)}>
                        <option value="">— {t("target.devicePlaceholder")} —</option>
                        {devices.map(d => (
                          <option key={d.id} value={d.id}>{d.online?"🟢":"⚪"} {d.name}</option>
                        ))}
                      </select>
                    )}
                    {streamTargetType==="GROUP" && (
                      <select className="sr-select" style={{flex:1,minWidth:140}}
                        value={streamTargetId} onChange={e => setStreamTargetId(e.target.value)}>
                        <option value="">— {t("target.groupPlaceholder")} —</option>
                        {groups.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {streamError && (
                  <div className="sr-alert sr-alert-error"><span>⚠️</span><span>{streamError}</span></div>
                )}

                {/* Állomás-lista */}
                <div className="sr-radio-list-wrap">
                  {netRadios.length === 0 ? (
                    <div className="sr-empty" style={{padding:"24px 16px"}}>
                      <div className="sr-empty-icon">📻</div>
                      <div style={{fontSize:13,fontWeight:700}}>{t("netradio.emptyList")}</div>
                    </div>
                  ) : netRadios.map((r, i) => {
                    const pickIdx = streamPick[r.id] ?? 0;
                    const safeIdx = Math.min(pickIdx, r.streams.length - 1);
                    const status  = streamStatus[r.id];
                    const stateClass =
                      status === "connecting" ? " sr-play-connecting" :
                      status === "playing"    ? " sr-play-playing" :
                      status === "error"      ? " sr-play-error" : "";
                    const stateLabel =
                      status === "connecting" ? "⏳" :
                      status === "error"      ? "✕" : "▶";
                    return (
                      <div className="sr-radio-row" key={r.id}>
                        <div className="sr-radio-num">{String(i+1).padStart(2,"0")}.</div>
                        <div>
                          <div className="sr-radio-name">📻 {r.name}</div>
                          <div className="sr-radio-genre">{r.genre || "—"}</div>
                        </div>
                        <select
                          className="sr-radio-stream-pick"
                          value={safeIdx}
                          disabled={r.streams.length <= 1 && !r.streams[0]?.url}
                          onChange={e => setStreamPick(prev => ({ ...prev, [r.id]: Number(e.target.value) }))}>
                          {r.streams.map((s, idx) => (
                            <option key={idx} value={idx}>
                              {s.label}{!s.url ? ` (${t("netradio.urlMissing")})` : ""}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={`sr-btn sr-btn-primary sr-btn-sm${stateClass}`}
                          onClick={() => void playStation(r)}
                          disabled={status === "connecting" || !r.streams[safeIdx]?.url}
                          title={
                            status === "connecting" ? t("netradio.playTooltip.connecting") :
                            status === "playing"    ? t("netradio.playTooltip.playing") :
                            status === "error"      ? t("netradio.playTooltip.error") :
                            t("netradio.playTooltip.idle")
                          }>
                          {stateLabel}
                        </button>
                        <div className="sr-radio-actions">
                          <button type="button" className="sr-btn sr-btn-ghost sr-btn-sm"
                            onClick={() => openEditStation(r)}
                            title={t("netradio.editTooltip")}>
                            ✏️
                          </button>
                          <button type="button" className="sr-btn sr-btn-danger sr-btn-sm"
                            onClick={() => removeStation(r.id)}
                            title={t("common:actions.delete")}>
                            🗑
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer: új / mentés / visszatöltés / default / restore */}
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <button type="button" className="sr-btn sr-btn-primary sr-btn-sm" onClick={openNewStation}>
                    ＋ {t("netradio.addStation")}
                  </button>
                  <button type="button" className="sr-btn sr-btn-ghost sr-btn-sm" onClick={exportNetRadios}
                    title={t("netradio.exportTooltip")}>
                    📥 {t("netradio.exportButton")}
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    style={{display:"none"}}
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) importNetRadios(f);
                    }} />
                  <button type="button" className="sr-btn sr-btn-ghost sr-btn-sm"
                    onClick={() => importInputRef.current?.click()}
                    title={t("netradio.importTooltip")}>
                    📤 {t("netradio.importButton")}
                  </button>
                  {canSetTenantDefault && (
                    <button type="button" className="sr-btn sr-btn-ghost sr-btn-sm"
                      onClick={() => void setAsTenantDefault()}
                      disabled={defaultBusy}
                      title={t("netradio.setDefaultTooltip")}>
                      {defaultBusy ? `⏳ ${t("busy.saving")}` : `⭐ ${t("netradio.setDefaultButton")}`}
                    </button>
                  )}
                  <div style={{flex:1}} />
                  <button type="button" className="sr-btn sr-btn-ghost sr-btn-sm" onClick={restoreDefaultStations}
                    title={t("netradio.restoreTooltip")}>
                    🔄 {t("netradio.restoreButton")}
                  </button>
                </div>

                <div style={{fontSize:11,color:"var(--sl-muted)"}}>
                  💡 {t("netradio.footerHint")}{canSetTenantDefault ? t("netradio.footerHintAdminSuffix") : "."}
                </div>
              </div>
            )}

            {/* ── Hangfájl könyvtár tab ─────────────────────────────────── */}
            {sourceTab === "library" && (
            <>
            <div
              className={`sr-upload-zone${drag ? " drag" : ""}`}
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleUpload(f);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                  e.target.value = "";
                }}
                disabled={uploading}
              />
              <div className="sr-upload-icon">{uploading ? "⏳" : "🎵"}</div>
              <div className="sr-upload-txt">
                {uploading ? t("library.uploading", { pct: uploadPct }) : t("library.uploadPrompt")}
              </div>
              <div className="sr-upload-sub">MP3, WAV, OGG, M4A, AAC</div>
            </div>

            {uploading && (
              <div className="sr-upload-progress">
                <div className="sr-upload-bar" style={{ width: `${uploadPct}%` }} />
              </div>
            )}

            {/* Cél választó a könyvtárban – a ▶ Azonnali és az ütemezés
                ugyanezt a formTarget/formTargetId state-et használja, így a
                kiválasztás közös. A user explicit látja, hova fog menni a
                lejátszás. */}
            <div style={{padding:"10px 16px 12px",borderBottom:"1px solid var(--sl-border)",background:"var(--sl-bg)"}}>
              <div style={{fontSize:11,fontWeight:800,color:"var(--sl-muted)",letterSpacing:0.3,textTransform:"uppercase",marginBottom:6}}>🎯 {t("library.targetLabel")}</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                {(["ALL","DEVICE","GROUP"] as const).map(tt => (
                  <button key={tt} type="button"
                    className={`sr-btn ${formTarget===tt?"sr-btn-primary":"sr-btn-ghost"} sr-btn-sm`}
                    onClick={() => { setFormTarget(tt); setFormTargetId(""); }}>
                    {tt==="ALL"?`📡 ${t("target.all")}`:tt==="DEVICE"?`🔊 ${t("target.device")}`:`👥 ${t("target.group")}`}
                  </button>
                ))}
                {formTarget==="DEVICE" && (
                  <select className="sr-select" style={{flex:1,minWidth:140}}
                    value={formTargetId}
                    onChange={e => setFormTargetId(e.target.value)}>
                    <option value="">— {t("target.devicePlaceholder")} —</option>
                    {devices.map(d => (
                      <option key={d.id} value={d.id}>{d.online?"🟢":"⚪"} {d.name}</option>
                    ))}
                  </select>
                )}
                {formTarget==="GROUP" && (
                  <select className="sr-select" style={{flex:1,minWidth:140}}
                    value={formTargetId}
                    onChange={e => setFormTargetId(e.target.value)}>
                    <option value="">— {t("target.groupPlaceholder")} —</option>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {files.length === 0 && !loading ? (
              <div className="sr-empty">
                <div className="sr-empty-icon">🎵</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{t("library.emptyLibrary")}</div>
              </div>
            ) : (
              <div className="sr-files-scroll">
              {files.map((f) => (
                <div
                  key={f.id}
                  className={`sr-file-item${selectedFile?.id === f.id ? " selected" : ""}`}
                  onClick={() => setSelectedFile(selectedFile?.id === f.id ? null : f)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="sr-file-name" title={f.originalName}>
                        🎵 {f.originalName}
                      </div>
                      <div className="sr-file-meta">
                        <span>⏱ {fmtDuration(f.durationSec)}</span>
                        <span>💾 {fmtSize(f.sizeBytes)}</span>
                        {f._count.schedules > 0 && <span style={{ color: "#6366f1" }}>📅 {f._count.schedules}×</span>}
                      </div>
                    </div>

                    <div className="sr-file-actions" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        // A ▶ gomb státusz-vizualizációja egyezik a netrádió
                        // listán használt logikával (lásd .sr-play-* CSS).
                        const fst = fileStatus[f.id];
                        const cls =
                          fst === "connecting" ? " sr-play-connecting" :
                          fst === "playing"    ? " sr-play-playing" :
                          fst === "error"      ? " sr-play-error" : "";
                        const lbl =
                          fst === "connecting" ? "⏳" :
                          fst === "error"      ? "✕" : "▶";
                        const title =
                          fst === "connecting" ? t("library.playTooltip.connecting") :
                          fst === "playing"    ? t("library.playTooltip.playing") :
                          fst === "error"      ? t("library.playTooltip.error") :
                          t("library.playTooltip.idle");
                        return (
                          <button
                            className={`sr-btn sr-btn-primary sr-btn-sm${cls}`}
                            title={title}
                            onClick={() => void playFileNow(f)}
                            disabled={fst === "connecting"}
                            type="button"
                          >
                            {lbl}
                          </button>
                        );
                      })()}
                      <button
                        className="sr-btn sr-btn-ghost sr-btn-sm"
                        title={t("schedule.tooltip")}
                        onClick={() => {
                          const n = new Date();
                          setFormFileId(f.id);
                          setFormDate(n.toISOString().slice(0, 10));
                          setFormTime(
                            `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`
                          );
                          setFormOpen(true);
                        }}
                        type="button"
                      >
                        📅
                      </button>

                      <button
                        className="sr-btn sr-btn-danger sr-btn-sm"
                        title={t("common:actions.delete")}
                        onClick={() => void deleteFile(f)}
                        type="button"
                      >
                        🗑
                      </button>
                    </div>
                  </div>

                  {selectedFile?.id === f.id && (
                    <div className="sr-player" onClick={(e) => e.stopPropagation()}>
                      <div className="sr-player-name">▶ {f.originalName}</div>
                      <audio controls src={f.fileUrl} preload="metadata" style={{ width: "100%", height: 32 }} />
                    </div>
                  )}
                </div>
              ))}
              </div>
            )}
            </>
            )}
          </div>
          {/* A "Korábbi lejátszások" panel kikerült innen – az
              "📥 Időzített lejátszások" overlay-ben jelenik meg
              a jövő + múlt egységes nézetben. */}
        </div>

        {/* ═══ JOBB PANEL: Ütemezések + Playlist ═══ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Ütemezés form */}
          {formOpen && (
            <div className="sr-panel">
              <div className="sr-panel-hdr">
                <div className="sr-panel-title">📅 {t("schedule.newTitle")}</div>
                <button
                  className="sr-btn sr-btn-ghost sr-btn-sm"
                  type="button"
                  onClick={() => {
                    setFormOpen(false);
                    setFormError(null);
                  }}
                >
                  ✕
                </button>
              </div>

              <div className="sr-form">
                {formError && (
                  <div className="sr-alert sr-alert-error">
                    <span>⚠️</span>
                    {formError}
                  </div>
                )}

                <div>
                  <label className="sr-label">{t("schedule.fileLabel")}</label>
                  <select className="sr-select" value={formFileId} onChange={(e) => setFormFileId(e.target.value)}>
                    <option value="">{t("schedule.selectFilePlaceholder")}</option>
                    {files.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.originalName} ({fmtDuration(f.durationSec)})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label className="sr-label">{t("schedule.dateLabel")}</label>
                    <input
                      type="date"
                      className="sr-input"
                      value={formDate}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setFormDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="sr-label">{t("schedule.startTimeLabel")}</label>
                    <input
                      type="time"
                      className="sr-input"
                      value={formTime}
                      onChange={(e) => setFormTime(e.target.value)}
                    />
                  </div>
                </div>

                {formDate && formTime && previewFile && (
                  <div className="sr-time-preview">
                    <span>⏰</span>
                    <div>
                      <div style={{ fontWeight: 800 }}>
                        {formDate} {formTime}
                        {previewEnd && <span style={{ color: "#475569" }}> → {previewEnd}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                        {t("schedule.durationLabel", { duration: fmtDuration(previewFile.durationSec) })}
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <div className="sr-label">{t("schedule.targetDevicesLabel")}</div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    {(["ALL", "DEVICE", "GROUP"] as const).map((tt) => (
                      <div
                        key={tt}
                        className={`sr-chip${formTarget === tt ? " active" : ""}`}
                        onClick={() => {
                          setFormTarget(tt);
                          setFormTargetId("");
                        }}
                      >
                        {tt === "ALL" ? `📡 ${t("target.all")}` : tt === "DEVICE" ? `🔊 ${t("target.device")}` : `👥 ${t("target.group")}`}
                      </div>
                    ))}
                  </div>

                  {formTarget === "DEVICE" && (
                    <div className="sr-device-list">
                      {devices.length === 0 ? (
                        <div style={{ fontSize: 13, color: "var(--sl-muted)", padding: 8 }}>{t("schedule.noDevicesAvailable")}</div>
                      ) : (
                        devices.map((d) => (
                          <div
                            key={d.id}
                            className={`sr-device-item${formTargetId === d.id ? " sel" : ""}`}
                            onClick={() => setFormTargetId(formTargetId === d.id ? "" : d.id)}
                          >
                            <span className={d.online ? "sr-dot-on" : "sr-dot-off"} />
                            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{d.name}</span>
                            <span style={{ fontSize: 11, color: "var(--sl-muted)", marginLeft: "auto" }}>
                              {d.deviceClass}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {formTarget === "GROUP" && (
                    <select className="sr-select" value={formTargetId} onChange={(e) => setFormTargetId(e.target.value)}>
                      <option value="">{t("target.chooseGroupPlaceholder")}</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    className="sr-btn sr-btn-ghost"
                    type="button"
                    onClick={() => {
                      setFormOpen(false);
                      setFormError(null);
                    }}
                    disabled={formBusy}
                  >
                    {t("common:actions.cancel")}
                  </button>

                  {/* ▶ Azonnali – a fájl rögtön szól, dátum/idő nem kell */}
                  <button
                    className="sr-btn sr-btn-primary"
                    type="button"
                    onClick={() => void submitImmediateFromForm()}
                    disabled={formBusy || !formFileId}
                    title={t("schedule.immediateTooltip")}
                    style={{background:"linear-gradient(135deg,#16a34a,#15803d)"}}>
                    {formBusy ? "⏳…" : t("schedule.immediateButton")}
                  </button>

                  <button
                    className="sr-btn sr-btn-primary"
                    type="button"
                    onClick={() => void submitSchedule()}
                    disabled={formBusy}
                  >
                    {formBusy ? t("schedule.saving") : t("schedule.addButton")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* A "Közelgő lejátszások" panel kikerült innen – az
              "📥 Időzített lejátszások" overlay-ben jelenik meg
              időrendi sorrendben a múltbeli rekordok fölött. */}

          {/* Új ütemezés indító gomb (ha a form most nincs nyitva) */}
          {!formOpen && (
            <button
              className="sr-btn sr-btn-primary"
              type="button"
              style={{alignSelf:"flex-start"}}
              onClick={() => {
                const n = new Date();
                setFormDate(n.toISOString().slice(0, 10));
                setFormTime(
                  `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`
                );
                setFormOpen(true);
              }}
            >
              ＋ {t("schedule.newScheduleButton")}
            </button>
          )}

          {/* ═══ Playlist összeállító ═══ */}
          <div className="sr-panel">
            <div className="sr-panel-hdr">
              <div className="sr-panel-title">🎼 {t("playlist.title")}</div>
              {plItems.length > 0 && (
                <button
                  className="sr-btn sr-btn-danger sr-btn-sm"
                  type="button"
                  onClick={() => {
                    if (window.confirm(t("playlist.deleteConfirm"))) setPlItems([]);
                  }}
                >
                  🗑 {t("common:actions.delete")}
                </button>
              )}
            </div>

            {/* Tabs */}
            <div className="sr-tabs">
              {([
                { id: "list", label: `📋 ${t("playlist.tabs.list")} (${plItems.length})` },
                { id: "yt-search", label: `🔍 ${t("playlist.tabs.youtubeSearch")}` },
                { id: "yt-url", label: `🔗 ${t("playlist.tabs.youtubeLink")}` },
                { id: "gdrive", label: `📁 ${t("playlist.tabs.googleDrive")}` },
                { id: "recording", label: `🎙️ ${t("playlist.tabs.recording")}` },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  className={`sr-tab${plTab === tab.id ? " active" : ""}`}
                  type="button"
                  onClick={() => setPlTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {plError && (
              <div style={{ margin: "10px 14px 0" }} className="sr-alert sr-alert-error">
                ⚠️ {plError}
                <button
                  style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#dc2626" }}
                  onClick={() => setPlError(null)}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Lista tab */}
            {plTab === "list" && (
              <div style={{ padding: "12px 14px" }}>
                {plItems.length === 0 ? (
                  <div className="sr-empty" style={{ padding: "28px 20px" }}>
                    <div className="sr-empty-icon">🎼</div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{t("playlist.emptyTitle")}</div>
                    <div style={{ fontSize: 12, color: "var(--sl-muted)", marginTop: 4 }}>
                      {t("playlist.emptyHint")}
                    </div>
                  </div>
                ) : (
                  plItems.map((item, idx) => (
                    <div
                      key={item.id}
                      className="sr-pl-item"
                      draggable
                      onDragStart={() => onDragStart(idx)}
                      onDragOver={(e) => onDragOver(e, idx)}
                    >
                      <span className="sr-pl-drag">⠿</span>
                      <span className="sr-pl-num">{idx + 1}</span>

                      <div className="sr-pl-info">
                        <div className="sr-pl-title" title={item.title}>
                          {item.status === "fetching" ? "⏳ " : item.status === "error" ? "❌ " : ""}
                          {item.title}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                          <span
                            className={`sr-pl-src sr-pl-src-${
                              item.source === "youtube" ? "yt" : item.source === "gdrive" ? "gd" : item.source === "recording" ? "rec" : "up"
                            }`}
                          >
                            {item.source === "youtube" ? "▶ YouTube" : item.source === "gdrive" ? `📁 ${t("playlist.sourceDrive")}` : item.source === "recording" ? `🎙️ ${t("playlist.sourceRecording")}` : `🎵 ${t("playlist.sourceUpload")}`}
                          </span>
                          <span className="sr-pl-dur">{fmtDuration(item.durationSec)}</span>
                          {item.errorMsg && <span style={{ fontSize: 10, color: "#dc2626" }}>{item.errorMsg}</span>}
                        </div>
                      </div>

                      {(item.audioPreviewUrl || item.source === "upload") && (
                        <audio controls src={item.audioPreviewUrl} style={{ height: 24, width: 80 }} preload="none" />
                      )}

                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          type="button"
                          className="sr-btn sr-btn-ghost sr-btn-sm"
                          disabled={idx === 0}
                          onClick={() =>
                            setPlItems((prev) => {
                              const n = [...prev];
                              [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]];
                              return n;
                            })
                          }
                        >
                          ↑
                        </button>

                        <button
                          type="button"
                          className="sr-btn sr-btn-ghost sr-btn-sm"
                          disabled={idx === plItems.length - 1}
                          onClick={() =>
                            setPlItems((prev) => {
                              const n = [...prev];
                              [n[idx], n[idx + 1]] = [n[idx + 1], n[idx]];
                              return n;
                            })
                          }
                        >
                          ↓
                        </button>

                        <button
                          type="button"
                          className="sr-btn sr-btn-danger sr-btn-sm"
                          onClick={() => setPlItems((prev) => prev.filter((_, j) => j !== idx))}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
                )}

                {/* Fájl feltöltés a listához */}
                <div style={{ marginTop: 10 }}>
                  <input
                    ref={plFileInputRef}
                    type="file"
                    accept="audio/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handlePlUpload(f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className="sr-btn sr-btn-ghost"
                    style={{ width: "100%", justifyContent: "center", fontSize: 12 }}
                    onClick={() => plFileInputRef.current?.click()}
                  >
                    ＋ {t("playlist.uploadToListButton")}
                  </button>
                </div>
              </div>
            )}

            {/* YT keresés tab */}
            {plTab === "yt-search" && (
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="sr-input"
                    style={{ flex: 1 }}
                    placeholder={t("playlist.youtubeSearchPlaceholder")}
                    value={ytQuery}
                    onChange={(e) => setYtQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchYt()}
                  />
                  <button className="sr-btn sr-btn-primary sr-btn-sm" type="button" onClick={searchYt} disabled={ytSearching}>
                    {ytSearching ? "⏳" : "🔍"}
                  </button>
                </div>

                {ytResults.length > 0 && (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {ytResults.map((r) => (
                        <div
                          key={r.id}
                          className={`sr-search-result${ytSelResult === r.id ? " sel" : ""}`}
                          onClick={() => setYtSelResult(ytSelResult === r.id ? null : r.id)}
                        >
                          <img
                            src={`https://i.ytimg.com/vi/${r.id}/mqdefault.jpg`}
                            alt=""
                            className="sr-search-thumb"
                            referrerPolicy="no-referrer"
                          />
                          <div style={{ minWidth: 0 }}>
                            <div className="sr-search-title">{r.title}</div>
                            <div className="sr-search-meta">⏱ {r.duration}</div>
                          </div>
                          {ytSelResult === r.id && <span style={{ color: "#3b82f6", fontSize: 18 }}>✓</span>}
                        </div>
                      ))}
                    </div>

                    <button
                      className="sr-btn sr-btn-primary"
                      type="button"
                      style={{ justifyContent: "center" }}
                      disabled={!ytSelResult}
                      onClick={addYtSearchResult}
                    >
                      ＋ {t("playlist.addToListButton")}
                    </button>
                  </>
                )}

                {ytResults.length === 0 && !ytSearching && ytQuery && (
                  <div style={{ textAlign: "center", fontSize: 13, color: "var(--sl-muted)", padding: "12px 0" }}>
                    {t("playlist.noResults")}
                  </div>
                )}
              </div>
            )}

            {/* YT URL tab */}
            {plTab === "yt-url" && (
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, color: "var(--sl-muted)" }}>
                  {t("playlist.youtubeUrlHint")}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="sr-input"
                    style={{ flex: 1 }}
                    placeholder="https://youtube.com/watch?v=..."
                    value={ytPasteUrl}
                    onChange={(e) => setYtPasteUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addYtUrl()}
                  />
                  <button
                    className="sr-btn sr-btn-ghost sr-btn-sm"
                    type="button"
                    onClick={async () => {
                      const clip = await navigator.clipboard.readText().catch(() => "");
                      if (clip) setYtPasteUrl(clip);
                    }}
                  >
                    📋 {t("playlist.pasteButton")}
                  </button>
                </div>

                <button
                  className="sr-btn sr-btn-primary"
                  type="button"
                  style={{ justifyContent: "center" }}
                  disabled={ytFetching || !ytPasteUrl.trim()}
                  onClick={addYtUrl}
                >
                  {ytFetching ? t("common:actions.loading") : `＋ ${t("common:actions.add")}`}
                </button>
              </div>
            )}

            {/* Drive tab */}
            {plTab === "gdrive" && (
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, color: "var(--sl-muted)" }}>
                  {t("playlist.googleDriveHint")}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="sr-input"
                    style={{ flex: 1 }}
                    placeholder="https://drive.google.com/..."
                    value={driveUrl}
                    onChange={(e) => setDriveUrl(e.target.value)}
                  />
                  <button
                    className="sr-btn sr-btn-ghost sr-btn-sm"
                    type="button"
                    onClick={async () => {
                      const clip = await navigator.clipboard.readText().catch(() => "");
                      if (clip) setDriveUrl(clip);
                    }}
                  >
                    📋
                  </button>
                </div>

                <button
                  className="sr-btn sr-btn-primary sr-btn-sm"
                  type="button"
                  style={{ justifyContent: "center" }}
                  disabled={driveFetching || !driveUrl.trim()}
                  onClick={fetchDrive}
                >
                  {driveFetching ? t("common:actions.loading") : t("playlist.driveFetchButton")}
                </button>

                {driveFiles.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--sl-muted)" }}>
                      {t("playlist.driveFilesFound", { count: driveFiles.length })}
                    </div>
                    {driveFiles.map((f, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "7px 10px",
                          border: "1px solid var(--sl-border)",
                          borderRadius: 10,
                          background: "var(--sl-bg)",
                        }}
                      >
                        <span
                          style={{
                            flex: 1,
                            fontSize: 13,
                            fontWeight: 700,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          🎵 {f.name}
                        </span>
                        {f.durationSec && <span style={{ fontSize: 11, color: "var(--sl-muted)" }}>{fmtDuration(f.durationSec)}</span>}
                        <button className="sr-btn sr-btn-primary sr-btn-sm" type="button" onClick={() => addDriveFile(f)}>
                          ＋
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Hangfelvétel tab – mikrofon → blob → /radio/files upload → playlist item */}
            {plTab === "recording" && (
              <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
                <div style={{fontSize:12,color:"var(--sl-muted)"}}>
                  {t("playlist.recordingHint")}
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14,padding:"22px 16px",border:"1.5px solid var(--sl-border)",borderRadius:14,background:"var(--sl-bg)"}}>
                  {recRadioState === "idle" && (
                    <>
                      <div style={{fontSize:50,lineHeight:1}}>🎙️</div>
                      <div style={{fontSize:13,color:"var(--sl-muted)",textAlign:"center"}}>
                        {t("playlist.recordingStartHint")}
                      </div>
                      <button className="sr-btn sr-btn-primary" type="button" onClick={() => void startRecRadio()}>
                        ⏺ {t("playlist.recordingStartButton")}
                      </button>
                      {recRadioError && (
                        <div className="sr-alert sr-alert-error" style={{margin:0}}>
                          <span>⚠️</span><span>{recRadioError}</span>
                        </div>
                      )}
                    </>
                  )}
                  {recRadioState === "recording" && (
                    <>
                      <div style={{fontSize:50,lineHeight:1,color:"#ef4444",animation:"sr-pulse 1s ease-in-out infinite"}}>🎙️</div>
                      <div style={{fontSize:30,fontWeight:900,fontFamily:"monospace",color:"#ef4444"}}>
                        {String(Math.floor(recRadioSeconds/60)).padStart(2,"0")}:{String(recRadioSeconds%60).padStart(2,"0")}
                      </div>
                      <div style={{fontSize:12,fontWeight:700,color:"#ef4444"}}>● {t("playlist.recordingInProgress")}</div>
                      <button className="sr-btn sr-btn-danger" type="button" onClick={stopRecRadio}>
                        ⏹ {t("playlist.recordingStopButton")}
                      </button>
                    </>
                  )}
                  {recRadioState === "recorded" && recRadioAudioUrl && (
                    <>
                      <div style={{fontSize:50,lineHeight:1}}>✅</div>
                      <div style={{fontSize:13,color:"var(--sl-muted)",textAlign:"center"}}>{t("playlist.recordingDoneHint")}</div>
                      <audio controls src={recRadioAudioUrl} style={{width:"100%",maxWidth:380}} />
                      <div style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center"}}>
                        <button className="sr-btn sr-btn-ghost" type="button" onClick={resetRecRadio} disabled={recRadioUploading}>
                          🔄 {t("playlist.newRecordingButton")}
                        </button>
                        <button className="sr-btn sr-btn-primary" type="button" onClick={() => void addRecordingToPlaylist()} disabled={recRadioUploading}>
                          {recRadioUploading ? t("playlist.uploading") : `＋ ${t("playlist.addRecordingToListButton")}`}
                        </button>
                      </div>
                      {recRadioError && (
                        <div className="sr-alert sr-alert-error" style={{margin:0}}>
                          <span>⚠️</span><span>{recRadioError}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Összesítő + Összeállít */}
            {plItems.filter((i) => i.status === "ready").length > 0 && (
              <>
                <div className="sr-total-bar">
                  <span>📋 {t("playlist.totalBar", { count: plItems.filter((i) => i.status === "ready").length })}</span>
                  <span>{fmtDuration(plTotalSec)}</span>
                </div>

                <div style={{ padding: "10px 14px", display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="sr-input"
                    style={{ flex: 1 }}
                    placeholder={t("playlist.namePlaceholder")}
                    value={plName}
                    onChange={(e) => setPlName(stripAccents(e.target.value))}
                  />
                  <button
                    className={`sr-btn sr-btn-primary${plBusy ? " sr-build-busy" : ""}`}
                    type="button"
                    disabled={plBusy}
                    onClick={buildPlaylist}>
                    {plBusy ? t("playlist.building") : t("playlist.buildButton")}
                  </button>
                </div>
              </>
            )}

            {/* Kész összeállítás */}
            {plBuiltUrl && plBuiltName && (
              <div className="sr-built-result">
                <div style={{ fontSize: 13, fontWeight: 800, color: "#15803d" }}>✅ {t("playlist.builtDone", { name: plBuiltName })}</div>
                <audio controls src={plBuiltUrl} style={{ width: "100%", height: 32, borderRadius: 8 }} preload="metadata" />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a href={plBuiltUrl} download={plBuiltName + ".mp3"} className="sr-btn sr-btn-ghost sr-btn-sm">
                    ⬇ {t("playlist.downloadButton")}
                  </a>

                  {plBuiltFileId && (
                    <button
                      className="sr-btn sr-btn-primary sr-btn-sm"
                      type="button"
                      onClick={() => {
                        const n = new Date();
                        setFormFileId(plBuiltFileId);
                        setFormDate(n.toISOString().slice(0, 10));
                        setFormTime(
                          `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`
                        );
                        setFormOpen(true);
                      }}
                    >
                      📅 {t("schedule.scheduleButton")}
                    </button>
                  )}

                  <button
                    className="sr-btn sr-btn-ghost sr-btn-sm"
                    type="button"
                    onClick={() => {
                      setPlBuiltUrl(null);
                      setPlBuiltFileId(null);
                      setPlItems([]);
                      setPlName("");
                    }}
                  >
                    🔄 {t("playlist.newCompositionButton")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════ Új / szerkesztett rádióállomás modal ══════════ */}
      {stationForm && (
        <div className="sr-overlay" onClick={() => setStationForm(null)}>
          <div className="sr-overlay-modal" style={{maxWidth:560}} onClick={e => e.stopPropagation()}>
            <div className="sr-overlay-hdr">
              <div className="sr-overlay-title">
                {stationForm.mode === "new" ? `＋ ${t("stationModal.newTitle")}` : `✏️ ${t("stationModal.editTitle")}`}
              </div>
              <button className="sr-overlay-close" type="button" onClick={() => setStationForm(null)}>✕</button>
            </div>
            <div className="sr-overlay-body" style={{display:"flex",flexDirection:"column",gap:12}}>
              {stationError && (
                <div className="sr-alert sr-alert-error"><span>⚠️</span><span>{stationError}</span></div>
              )}
              <div>
                <div style={{fontSize:11,fontWeight:800,color:"var(--sl-muted)",textTransform:"uppercase",letterSpacing:0.3,marginBottom:5}}>{t("stationModal.nameLabel")}</div>
                <input className="sr-input" style={{width:"100%"}}
                  value={stationForm.name}
                  onChange={e => setStationForm(s => s ? { ...s, name: stripAccents(e.target.value) } : s)}
                  placeholder={t("stationModal.namePlaceholder")} autoFocus />
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:800,color:"var(--sl-muted)",textTransform:"uppercase",letterSpacing:0.3,marginBottom:5}}>{t("stationModal.genreLabel")}</div>
                <input className="sr-input" style={{width:"100%"}}
                  value={stationForm.genre}
                  onChange={e => setStationForm(s => s ? { ...s, genre: stripAccents(e.target.value) } : s)}
                  placeholder={t("stationModal.genrePlaceholder")} />
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:800,color:"var(--sl-muted)",textTransform:"uppercase",letterSpacing:0.3,marginBottom:5,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>{t("stationModal.substreamsLabel")}</span>
                  <button type="button" className="sr-btn sr-btn-ghost sr-btn-sm"
                    onClick={() => setStationForm(s => s ? { ...s, streams: [...s.streams, { label: "", url: "" }] } : s)}>
                    ＋ {t("common:actions.add")}
                  </button>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {stationForm.streams.map((s, idx) => (
                    <div key={idx} className="sr-stream-row">
                      <input className="sr-input"
                        placeholder={t("stationModal.streamLabelPlaceholder")}
                        value={s.label}
                        onChange={e => setStationForm(f => f ? {
                          ...f, streams: f.streams.map((x,i) => i===idx ? { ...x, label: stripAccents(e.target.value) } : x),
                        } : f)} />
                      <input className="sr-input"
                        placeholder="https://stream.example.com/live.mp3"
                        value={s.url}
                        onChange={e => setStationForm(f => f ? {
                          ...f, streams: f.streams.map((x,i) => i===idx ? { ...x, url: e.target.value } : x),
                        } : f)} />
                      <button type="button" className="sr-btn sr-btn-danger sr-btn-sm"
                        onClick={() => setStationForm(f => f ? {
                          ...f, streams: f.streams.filter((_,i) => i!==idx),
                        } : f)}
                        disabled={stationForm.streams.length <= 1}
                        title={stationForm.streams.length <= 1 ? t("stationModal.needAtLeastOneStream") : t("stationModal.deleteStreamTooltip")}>
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:11,color:"var(--sl-muted)",marginTop:6}}>
                  💡 {t("stationModal.myonlineradioHint")}
                </div>
              </div>
              <div style={{display:"flex",justifyContent:"flex-end",gap:10,paddingTop:4}}>
                <button type="button" className="sr-btn sr-btn-ghost" onClick={() => setStationForm(null)}>
                  {t("common:actions.cancel")}
                </button>
                <button type="button" className="sr-btn sr-btn-primary" onClick={submitStation}>
                  {stationForm.mode === "new" ? `＋ ${t("common:actions.add")}` : t("common:actions.save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ Időzített lejátszások overlay ══════════ */}
      {historyOpen && (
        <div className="sr-overlay" onClick={() => setHistoryOpen(false)}>
          <div className="sr-overlay-modal" onClick={e => e.stopPropagation()}>
            <div className="sr-overlay-hdr">
              <div className="sr-overlay-title">📥 {t("history.overlayTitle")}</div>
              <button className="sr-overlay-close" type="button" onClick={() => setHistoryOpen(false)}>✕</button>
            </div>
            <div className="sr-overlay-body">
              {/* Jövőbeli (időrend szerinti sorrend, legközelebbi felül) */}
              {upcomingSchedules.length === 0 ? (
                <div className="sr-empty" style={{padding:"24px 16px"}}>
                  <div className="sr-empty-icon">⏰</div>
                  <div style={{fontSize:13,fontWeight:700}}>{t("history.noUpcoming")}</div>
                </div>
              ) : (
                upcomingSchedules.map(s => {
                  const endTime = addSeconds(s.scheduledAt, s.radioFile.durationSec);
                  const targetLabel =
                    s.targetType === "ALL" ? `📡 ${t("target.all")}` : s.targetType === "DEVICE" ? `🔊 ${t("target.device")}` : `👥 ${t("target.group")}`;
                  const isWarn = checkTeachingHourOverlap(new Date(s.scheduledAt), s.radioFile.durationSec, mainBells);
                  return (
                    <div key={s.id} className="sr-sched-item">
                      <div>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <span className="sr-sched-time">{fmtDateTimeFull(s.scheduledAt)}</span>
                          {endTime && <span className="sr-sched-end">→ {endTime}</span>}
                          {isWarn && <span className="sr-lesson-warn">⚠️ {t("history.lessonWarning")}</span>}
                        </div>
                        <div className="sr-sched-file" title={s.radioFile.originalName}>
                          🎵 {s.radioFile.originalName}
                          {s.radioFile.durationSec && (
                            <span style={{color:"var(--sl-muted)",fontWeight:400}}> · {fmtDuration(s.radioFile.durationSec)}</span>
                          )}
                        </div>
                        <div className="sr-sched-target">{targetLabel}</div>
                      </div>
                      <button className="sr-btn sr-btn-danger sr-btn-sm" type="button" onClick={() => void deleteSchedule(s.id)}>
                        🗑
                      </button>
                    </div>
                  );
                })
              )}

              {/* Elválasztó */}
              <div className="sr-section-divider">{t("history.pastSectionTitle")}</div>

              {/* Múltbeli (legutóbbi felül) */}
              {pastSchedules.length === 0 ? (
                <div className="sr-empty" style={{padding:"18px 16px"}}>
                  <div className="sr-empty-icon">🕐</div>
                  <div style={{fontSize:13,fontWeight:700}}>{t("history.noPast")}</div>
                </div>
              ) : (
                pastSchedules.map(s => {
                  const badge = STATUS_BADGE[s.status] ?? STATUS_BADGE.PENDING;
                  const endTime = addSeconds(s.scheduledAt, s.radioFile.durationSec);
                  const targetLabel =
                    s.targetType === "ALL" ? `📡 ${t("target.all")}` : s.targetType === "DEVICE" ? `🔊 ${t("target.device")}` : `👥 ${t("target.group")}`;
                  return (
                    <div key={s.id} className="sr-sched-item sr-sched-past">
                      <div>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <span className="sr-sched-time" style={{color:"var(--sl-muted)",fontSize:13}}>{fmtDateTimeFull(s.scheduledAt)}</span>
                          {endTime && <span className="sr-sched-end">→ {endTime}</span>}
                          <span className="sr-badge" style={{background:badge.bg,color:badge.color,borderColor:badge.color+"44"}}>{t(statusLabelKey(s.status))}</span>
                        </div>
                        <div className="sr-sched-file" title={s.radioFile.originalName}>
                          🎵 {s.radioFile.originalName}
                          {s.radioFile.durationSec && (
                            <span style={{color:"var(--sl-muted)",fontWeight:400}}> · {fmtDuration(s.radioFile.durationSec)}</span>
                          )}
                        </div>
                        <div className="sr-sched-target">{targetLabel}</div>
                      </div>
                      <button
                        className="sr-btn sr-btn-primary sr-btn-sm"
                        type="button"
                        title={t("history.rescheduleTooltip")}
                        onClick={() => {
                          const n = new Date();
                          setFormFileId(s.radioFileId);
                          setFormDate(n.toISOString().slice(0, 10));
                          setFormTime(`${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`);
                          setFormOpen(true);
                          setHistoryOpen(false);
                        }}>
                        🔁 {t("history.replayButton")}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}