// src/pages/SchoolRadio.tsx
import { useEffect, useRef, useState, useCallback } from "react";
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
  { id: "oxygen-music",   name: "Oxygen Music",     genre: "pop / dance",       streams: [{ label: "Foadas", url: "https://onair.oxygenmusic.hu/oxygenmusic.mp3" }] },
  { id: "radio-1",        name: "Radio 1",          genre: "kereskedelmi pop",  streams: [{ label: "Foadas", url: "https://stream.radio1.hu/radio1.mp3" }] },
  { id: "retro-radio",    name: "Retro Radio",      genre: "retro",             streams: [{ label: "Foadas", url: "https://icast.connectmedia.hu/5201/retroradio.mp3" }] },
  { id: "petofi-radio",   name: "Petofi Radio",     genre: "kozszolgalati pop", streams: [{ label: "Foadas", url: "https://icast.connectmedia.hu/4736/mr2.mp3" }] },
  { id: "laza-radio",     name: "Laza Radio",       genre: "soft pop / chill",  streams: [{ label: "Foadas", url: "" }] },
  { id: "megadance",      name: "Megadance Radio",  genre: "dance / EDM",       streams: [{ label: "Foadas", url: "" }] },
  { id: "radio-sunrise",  name: "Radio Sunrise",    genre: "chill / lounge",    streams: [{ label: "Foadas", url: "" }] },
  { id: "juventus-radio", name: "Juventus Radio",   genre: "kereskedelmi pop",  streams: [{ label: "Foadas", url: "" }] },
  { id: "radio-gaga",     name: "Radio GaGa",       genre: "magyar zene",       streams: [{ label: "Foadas", url: "" }] },
  { id: "radio-88",       name: "Radio 88",         genre: "kereskedelmi",      streams: [{ label: "Foadas", url: "" }] },
  { id: "poptarisznya",   name: "Poptarisznya",     genre: "retro / oldies",    streams: [{ label: "Foadas", url: "" }] },
  { id: "sunshine-radio", name: "Sunshine Radio",   genre: "pop / chart",       streams: [{ label: "Foadas", url: "" }] },
  { id: "roxy-radio",     name: "Roxy Radio",       genre: "rock",              streams: [{ label: "Foadas", url: "" }] },
  { id: "mix-radio",      name: "Mix Radio",        genre: "vegyes / pop",      streams: [{ label: "Foadas", url: "" }] },
  { id: "csukas-mese",    name: "Csukas Meseradio", genre: "gyermek / mese",    streams: [{ label: "Foadas", url: "" }] },
  { id: "rohely-radio",   name: "Rohely Radio",     genre: "humor / talk",      streams: [{ label: "Foadas", url: "" }] },
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

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  PENDING: { bg: "#eff6ff", color: "#1d4ed8", label: "Vár" },
  DISPATCHED: { bg: "#f0fdf4", color: "#15803d", label: "Elküldve" },
  CANCELLED: { bg: "#f9fafb", color: "#6b7280", label: "Törölve" },
};

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

  // ── Új: stream-volume slider (0..10) – csak a rádió/play-now stream-re hat,
  // a csengetésre és üzenetekre NEM. A backend a játszás indításakor ffmpeg
  // pre-gain filter-rel veszi át (volume=X/10).
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
      setError(e?.message ?? "Betöltés sikertelen");
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
      setError(e?.message ?? "Azonnali lejátszás sikertelen");
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
      setStreamError(`A(z) "${station.name}" kiválasztott stream URL-je üres. Szerkeszd az állomást.`);
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setStreamError("Érvénytelen URL (http/https kell).");
      return;
    }
    if (streamTargetType !== "ALL" && !streamTargetId) {
      setStreamError("Válassz egy célt (eszközt/csoportot).");
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
      setStreamError(e?.message ?? "Stream indítása sikertelen");
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
    if (!name) { setStationError("A név kötelező."); return; }
    if (streams.length === 0) { setStationError("Legalább egy stream-et add meg (a label kötelező)."); return; }
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
    if (!window.confirm(`Törlöd a(z) "${r.name}" rádióállomást?`)) return;
    setNetRadios(prev => prev.filter(x => x.id !== id));
    setStreamPick(prev => { const c = { ...prev }; delete c[id]; return c; });
  }
  function restoreDefaultStations() {
    if (!window.confirm("Visszaállítod a rádiólistát az alapértelmezettre? A saját bejegyzések elvesznek.")) return;
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
      alert("Lementés sikertelen: " + (e?.message ?? "ismeretlen"));
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
        if (list.length === 0) { alert("A fájl üres vagy érvénytelen formátum."); return; }
        if (!window.confirm(`Visszatöltöd a listát? Az aktuális (${netRadios.length} állomás) felülíródik. Új lista: ${list.length} állomás.`)) return;
        setNetRadios(list); setStreamPick({});
      } catch (e:any) {
        alert("Olvasási hiba: " + (e?.message ?? "ismeretlen"));
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
    if (!window.confirm(`Beállítod a jelenlegi listát az intézmény alapértelmezettjének? Minden új felhasználó / új böngésző ezt fogja látni először (${netRadios.length} állomás).`)) return;
    setDefaultBusy(true);
    try {
      await apiFetch("/tenants/me/netradio-presets", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ presets: netRadios }),
      });
      alert("Alapértelmezett lista elmentve.");
    } catch (e:any) {
      alert("Mentés sikertelen: " + (e?.message ?? "ismeretlen"));
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
        const r = await apiFetch<{ ok:boolean; presets: any }>("/tenants/me/netradio-presets");
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
        ? "Mikrofon hozzáférés megtagadva."
        : "Mikrofon nem érhető el: " + e.message);
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
      if (!resp.ok) throw new Error(data.error || "Feltöltés sikertelen");
      const rf = data.radioFile ?? data.file ?? data;
      const fileUrl: string  = rf.fileUrl;
      const title:   string  = rf.originalName ?? "Saját felvétel";
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
      setRecRadioError(e?.message ?? "Feltöltés sikertelen");
    } finally {
      setRecRadioUploading(false);
    }
  }

  // ── Upload (könyvtár) ─────────────────────────────────────────────────────
  async function handleUpload(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["mp3", "wav", "ogg", "m4a", "aac"].includes(ext)) {
      setError("Csak hangfájl tölthető fel (.mp3, .wav, .ogg, .m4a, .aac)");
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
        xhr.onerror = () => reject(new Error("Hálózati hiba"));

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
      setError("Feltöltés sikertelen: " + e.message);
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  }

  // ── Fájl törlés ───────────────────────────────────────────────────────────
  async function deleteFile(file: RadioFile) {
    const warn =
      file._count.schedules > 0
        ? `⚠️ Ezzel ${file._count.schedules} ütemezés IS TÖRLŐDIK!\n\nBiztos törlöd: "${file.originalName}"?`
        : `Törlöd: "${file.originalName}"?`;

    if (!window.confirm(warn)) return;

    try {
      await apiFetch(`/radio/files/${file.id}`, { method: "DELETE" });
      if (selectedFile?.id === file.id) setSelectedFile(null);
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? "Törlés sikertelen");
    }
  }

  // ── Ütemezés törlés ───────────────────────────────────────────────────────
  async function deleteSchedule(id: string) {
    if (!window.confirm("Törlöd ezt az ütemezést?")) return;
    try {
      await apiFetch(`/radio/schedules/${id}`, { method: "DELETE" });
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? "Törlés sikertelen");
    }
  }

  // ── Ütemezés létrehozás ───────────────────────────────────────────────────
  async function submitSchedule(overrideFileId?: string) {
    const fileId = overrideFileId ?? formFileId;
    setFormError(null);

    if (!fileId) {
      setFormError("Válassz hangfájlt!");
      return;
    }
    if (!formDate || !formTime) {
      setFormError("Adj meg dátumot és időt!");
      return;
    }
    if (formTarget !== "ALL" && !formTargetId) {
      setFormError("Válassz célt!");
      return;
    }

    const scheduledAt = new Date(`${formDate}T${formTime}:00`);
    if (isNaN(scheduledAt.getTime())) {
      setFormError("Érvénytelen dátum/idő");
      return;
    }
    if (scheduledAt < new Date()) {
      setFormError("Az időpont a múltban van!");
      return;
    }

    const durSec = files.find((f) => f.id === fileId)?.durationSec ?? null;

    // Tanítási óra ütközés
    if (checkTeachingHourOverlap(scheduledAt, durSec, mainBells)) {
      if (!window.confirm("⚠️ A rádióműsor tanítási órát érint!\n\nBiztosan így szeretnéd ütemezni?")) return;
    }

    // Szünetbe nem fér el – trim ajánlat
    if (durSec && mainBells.length >= 2) {
      const hours = getTeachingHours(mainBells, scheduledAt);
      const nextLesson = hours.find((h) => h.start > scheduledAt);

      if (nextLesson) {
        const breakSec = (nextLesson.start.getTime() - scheduledAt.getTime()) / 1000;
        if (durSec > breakSec) {
          const wantTrim = window.confirm(
            `⚠️ A hangfájl (${fmtDuration(durSec)}) nem fér bele a szünetbe (${fmtDuration(
              Math.floor(breakSec)
            )})!\n\n` +
              `Levágjuk a végét, hogy beleférjen (5mp fade-out átmenettel)? Az eredeti fájl megmarad.\n\n` +
              `Igen → levágott verzió ütemezése\nNem → az eredeti hosszú fájl ütemezése`
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
              setFormError("Vágás sikertelen: " + (e?.message ?? ""));
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
          ? `Időütközés: "${data.conflict.originalName}" körül már foglalt`
          : (e?.message ?? "Létrehozás sikertelen")
      );
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
      title: "Betöltés…",
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
              errorMsg: info ? undefined : "Nem sikerült betölteni az adatokat",
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
      setPlError(e?.message ?? "Drive betöltési hiba");
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
      setPlError("Csak hangfájl adható hozzá");
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
        xhr.onerror = () => reject(new Error("Hálózati hiba"));

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
      setPlError("Adj hozzá legalább egy kész elemet!");
      return;
    }
    if (!plName.trim()) {
      setPlError("Adj nevet az összeállításnak!");
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
            setPlError("Összeállítás sikertelen. Ellenőrizd a linkeket!");
            setPlBusy(false);
          }
        } catch {
          clearInterval(poll);
          setPlError("Hiba az állapotlekérdezéskor");
          setPlBusy(false);
        }
      }, 3000);
    } catch (e: any) {
      setPlError(e?.message ?? "Build hiba");
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
          <div className="sr-title">📻 Iskolai Rádió</div>
          <div className="sr-subtitle">Hanganyag feltöltése és ütemezett lejátszása az épület hangszóróin.</div>
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
                  <span>Nem játszik semmi</span>
                )}
              </div>
            );
          })()}

          <button
            className="sr-btn sr-btn-ghost"
            type="button"
            onClick={() => setHistoryOpen(true)}
            title="Jövőbeli és korábbi lejátszások egy ablakban"
          >
            📥 Időzített lejátszások{schedules.length > 0 ? ` (${schedules.length})` : ""}
          </button>

          <button
            className="sr-stop-btn"
            disabled={stopBusy}
            type="button"
            onClick={async () => {
              if (!window.confirm("Leállítod az összes lejátszót?")) return;
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
                alert("Hiba: " + (e?.message ?? "ismeretlen"));
              } finally {
                setStopBusy(false);
              }
            }}
          >
            🛑 {stopBusy ? "Leállítás…" : "RÁDIÓ STOP"}
          </button>

          {/* Stream-volume slider – CSAK a rádió/play-now streamre hat.
              A csengetésre és üzenetekre nincs hatása. A volume a backend
              ffmpeg pre-gain filteren át érvényesül; új lejátszáskor él. */}
          <div className="sr-stream-vol" title={`Stream hangerő: ${streamVolume}/10`}>
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
                🎵 Hangfájl könyvtár
              </button>
              <button
                className={`sr-tab${sourceTab === "netradio" ? " active" : ""}`}
                type="button"
                onClick={() => setSourceTab("netradio")}>
                📻 Internetrádió
              </button>
            </div>

            {/* ── Internetrádió tab ─────────────────────────────────────── */}
            {sourceTab === "netradio" && (
              <div style={{padding:"14px 18px",display:"flex",flexDirection:"column",gap:12}}>
                <div style={{fontSize:12,color:"var(--sl-muted)"}}>
                  Görgesd át a listát, válaszd ki az állomást és — ha van —
                  egy alstreamet, majd nyomd a ▶ gombot. A célt és a stream URL-eket
                  alább, illetve a Szerkesztés gombbal módosíthatod.
                </div>

                {/* Cél választó (közös az összes állomásra) */}
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--sl-muted)",letterSpacing:0.3,textTransform:"uppercase",marginBottom:6}}>🎯 Cél</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                    {(["ALL","DEVICE","GROUP"] as const).map(t => (
                      <button key={t} type="button"
                        className={`sr-btn ${streamTargetType===t?"sr-btn-primary":"sr-btn-ghost"} sr-btn-sm`}
                        onClick={() => { setStreamTargetType(t); setStreamTargetId(""); }}>
                        {t==="ALL"?"📡 Összes":t==="DEVICE"?"🔊 Egyedi":"👥 Csoport"}
                      </button>
                    ))}
                    {streamTargetType==="DEVICE" && (
                      <select className="sr-select" style={{flex:1,minWidth:140}}
                        value={streamTargetId} onChange={e => setStreamTargetId(e.target.value)}>
                        <option value="">— Eszköz —</option>
                        {devices.map(d => (
                          <option key={d.id} value={d.id}>{d.online?"🟢":"⚪"} {d.name}</option>
                        ))}
                      </select>
                    )}
                    {streamTargetType==="GROUP" && (
                      <select className="sr-select" style={{flex:1,minWidth:140}}
                        value={streamTargetId} onChange={e => setStreamTargetId(e.target.value)}>
                        <option value="">— Csoport —</option>
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
                      <div style={{fontSize:13,fontWeight:700}}>Üres a rádiólista – használd a "Visszaállítás alapra" gombot.</div>
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
                              {s.label}{!s.url ? " (URL hiányzik)" : ""}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={`sr-btn sr-btn-primary sr-btn-sm${stateClass}`}
                          onClick={() => void playStation(r)}
                          disabled={status === "connecting" || !r.streams[safeIdx]?.url}
                          title={
                            status === "connecting" ? "Stream megnyitása folyamatban..." :
                            status === "playing"    ? "Szól – újraküldéshez nyomd meg" :
                            status === "error"      ? "A stream nem nyitható meg" :
                            "Azonnali adásba küldés"
                          }>
                          {stateLabel}
                        </button>
                        <div className="sr-radio-actions">
                          <button type="button" className="sr-btn sr-btn-ghost sr-btn-sm"
                            onClick={() => openEditStation(r)}
                            title="Szerkesztés (név, műfaj, alstreamek)">
                            ✏️
                          </button>
                          <button type="button" className="sr-btn sr-btn-danger sr-btn-sm"
                            onClick={() => removeStation(r.id)}
                            title="Törlés">
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
                    ＋ Új állomás
                  </button>
                  <button type="button" className="sr-btn sr-btn-ghost sr-btn-sm" onClick={exportNetRadios}
                    title="A jelenlegi listát .json fájlba menti">
                    📥 Lementés (.json)
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
                    title="Korábban exportált .json fájl visszatöltése">
                    📤 Visszatöltés
                  </button>
                  {canSetTenantDefault && (
                    <button type="button" className="sr-btn sr-btn-ghost sr-btn-sm"
                      onClick={() => void setAsTenantDefault()}
                      disabled={defaultBusy}
                      title="Az intézmény minden új felhasználója ezt a listát látja először">
                      {defaultBusy ? "⏳ Mentés…" : "⭐ Alapértelmezetté tesz"}
                    </button>
                  )}
                  <div style={{flex:1}} />
                  <button type="button" className="sr-btn sr-btn-ghost sr-btn-sm" onClick={restoreDefaultStations}
                    title="A lista visszaáll az induló 16 állomásra (a saját bejegyzések elvesznek)">
                    🔄 Visszaállítás alapra
                  </button>
                </div>

                <div style={{fontSize:11,color:"var(--sl-muted)"}}>
                  💡 Az alstream URL-eket a myonlineradio.hu-n érdemes ellenőrizni.
                  A lista a böngészőben tárolódik (intézményenként és eszközönként){canSetTenantDefault ? " – az ⭐ gombbal az egész intézmény alapértelmezetté teheted." : "."}
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
                {uploading ? `Feltöltés… ${uploadPct}%` : "Húzd ide vagy kattints a feltöltéshez"}
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
              <div style={{fontSize:11,fontWeight:800,color:"var(--sl-muted)",letterSpacing:0.3,textTransform:"uppercase",marginBottom:6}}>🎯 Cél (azonnali ▶ és ütemezett 📅 is)</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                {(["ALL","DEVICE","GROUP"] as const).map(t => (
                  <button key={t} type="button"
                    className={`sr-btn ${formTarget===t?"sr-btn-primary":"sr-btn-ghost"} sr-btn-sm`}
                    onClick={() => { setFormTarget(t); setFormTargetId(""); }}>
                    {t==="ALL"?"📡 Összes":t==="DEVICE"?"🔊 Egyedi":"👥 Csoport"}
                  </button>
                ))}
                {formTarget==="DEVICE" && (
                  <select className="sr-select" style={{flex:1,minWidth:140}}
                    value={formTargetId}
                    onChange={e => setFormTargetId(e.target.value)}>
                    <option value="">— Eszköz —</option>
                    {devices.map(d => (
                      <option key={d.id} value={d.id}>{d.online?"🟢":"⚪"} {d.name}</option>
                    ))}
                  </select>
                )}
                {formTarget==="GROUP" && (
                  <select className="sr-select" style={{flex:1,minWidth:140}}
                    value={formTargetId}
                    onChange={e => setFormTargetId(e.target.value)}>
                    <option value="">— Csoport —</option>
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
                <div style={{ fontSize: 14, fontWeight: 700 }}>Még nincs feltöltött hangfájl</div>
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
                          fst === "connecting" ? "Lejátszás indítása folyamatban..." :
                          fst === "playing"    ? "Most szól – újraindításhoz nyomd meg" :
                          fst === "error"      ? "A lejátszás nem sikerült" :
                          "Azonnali lejátszás (az aktuálisan kiválasztott célon)";
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
                        title="Ütemezés"
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
                        title="Törlés"
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
                <div className="sr-panel-title">📅 Új ütemezés</div>
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
                  <label className="sr-label">Hangfájl</label>
                  <select className="sr-select" value={formFileId} onChange={(e) => setFormFileId(e.target.value)}>
                    <option value="">Válassz hangfájlt…</option>
                    {files.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.originalName} ({fmtDuration(f.durationSec)})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label className="sr-label">Dátum</label>
                    <input
                      type="date"
                      className="sr-input"
                      value={formDate}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setFormDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="sr-label">Kezdési idő</label>
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
                        Hossz: {fmtDuration(previewFile.durationSec)}
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <div className="sr-label">Lejátszó eszközök</div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    {(["ALL", "DEVICE", "GROUP"] as const).map((t) => (
                      <div
                        key={t}
                        className={`sr-chip${formTarget === t ? " active" : ""}`}
                        onClick={() => {
                          setFormTarget(t);
                          setFormTargetId("");
                        }}
                      >
                        {t === "ALL" ? "📡 Összes" : t === "DEVICE" ? "🔊 Egyedi" : "👥 Csoport"}
                      </div>
                    ))}
                  </div>

                  {formTarget === "DEVICE" && (
                    <div className="sr-device-list">
                      {devices.length === 0 ? (
                        <div style={{ fontSize: 13, color: "var(--sl-muted)", padding: 8 }}>Nincs elérhető eszköz</div>
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
                      <option value="">Válassz csoportot…</option>
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
                    Mégse
                  </button>

                  <button
                    className="sr-btn sr-btn-primary"
                    type="button"
                    onClick={() => void submitSchedule()}
                    disabled={formBusy}
                  >
                    {formBusy ? "⏳ Mentés…" : "📅 Ütemezés hozzáadása"}
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
              ＋ Új ütemezés
            </button>
          )}

          {/* ═══ Playlist összeállító ═══ */}
          <div className="sr-panel">
            <div className="sr-panel-hdr">
              <div className="sr-panel-title">🎼 Lejátszási lista készítő</div>
              {plItems.length > 0 && (
                <button
                  className="sr-btn sr-btn-danger sr-btn-sm"
                  type="button"
                  onClick={() => {
                    if (window.confirm("Törlöd az összeállítást?")) setPlItems([]);
                  }}
                >
                  🗑 Töröl
                </button>
              )}
            </div>

            {/* Tabs */}
            <div className="sr-tabs">
              {([
                { id: "list", label: `📋 Lista (${plItems.length})` },
                { id: "yt-search", label: "🔍 YouTube keresés" },
                { id: "yt-url", label: "🔗 YouTube link" },
                { id: "gdrive", label: "📁 Google Drive" },
                { id: "recording", label: "🎙️ Hangfelvétel" },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  className={`sr-tab${plTab === t.id ? " active" : ""}`}
                  type="button"
                  onClick={() => setPlTab(t.id)}
                >
                  {t.label}
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
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Üres lista</div>
                    <div style={{ fontSize: 12, color: "var(--sl-muted)", marginTop: 4 }}>
                      Adj hozzá dalokat a többi fülről
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
                            {item.source === "youtube" ? "▶ YouTube" : item.source === "gdrive" ? "📁 Drive" : item.source === "recording" ? "🎙️ Felvétel" : "🎵 Feltöltés"}
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
                    ＋ Hangfájl feltöltése a listához
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
                    placeholder="Keresés YouTube-on…"
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
                      ＋ Hozzáadás a listához
                    </button>
                  </>
                )}

                {ytResults.length === 0 && !ytSearching && ytQuery && (
                  <div style={{ textAlign: "center", fontSize: 13, color: "var(--sl-muted)", padding: "12px 0" }}>
                    Nincs találat
                  </div>
                )}
              </div>
            )}

            {/* YT URL tab */}
            {plTab === "yt-url" && (
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, color: "var(--sl-muted)" }}>
                  Illeszd be a YouTube videó linkjét. A cím és hossz automatikusan betöltődik.
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
                      const t = await navigator.clipboard.readText().catch(() => "");
                      if (t) setYtPasteUrl(t);
                    }}
                  >
                    📋 Beilleszt
                  </button>
                </div>

                <button
                  className="sr-btn sr-btn-primary"
                  type="button"
                  style={{ justifyContent: "center" }}
                  disabled={ytFetching || !ytPasteUrl.trim()}
                  onClick={addYtUrl}
                >
                  {ytFetching ? "⏳ Betöltés…" : "＋ Hozzáadás"}
                </button>
              </div>
            )}

            {/* Drive tab */}
            {plTab === "gdrive" && (
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, color: "var(--sl-muted)" }}>
                  Google Drive fájl vagy mappa linkjét illeszd be. Hangfájlokat automatikusan listázza.
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
                      const t = await navigator.clipboard.readText().catch(() => "");
                      if (t) setDriveUrl(t);
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
                  {driveFetching ? "⏳ Betöltés…" : "🔍 Fájlok lekérése"}
                </button>

                {driveFiles.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--sl-muted)" }}>
                      {driveFiles.length} hangfájl találva:
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
                  Vegyél fel egy bemondott szövegrészt, és add hozzá a lejátszási listához.
                  A felvétel feltöltődik a könyvtárba, és onnan kerül a lista végére.
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14,padding:"22px 16px",border:"1.5px solid var(--sl-border)",borderRadius:14,background:"var(--sl-bg)"}}>
                  {recRadioState === "idle" && (
                    <>
                      <div style={{fontSize:50,lineHeight:1}}>🎙️</div>
                      <div style={{fontSize:13,color:"var(--sl-muted)",textAlign:"center"}}>
                        Kattints a gombra a felvétel megkezdéséhez.
                      </div>
                      <button className="sr-btn sr-btn-primary" type="button" onClick={() => void startRecRadio()}>
                        ⏺ Felvétel indítása
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
                      <div style={{fontSize:12,fontWeight:700,color:"#ef4444"}}>● Felvétel folyamatban…</div>
                      <button className="sr-btn sr-btn-danger" type="button" onClick={stopRecRadio}>
                        ⏹ Felvétel befejezése
                      </button>
                    </>
                  )}
                  {recRadioState === "recorded" && recRadioAudioUrl && (
                    <>
                      <div style={{fontSize:50,lineHeight:1}}>✅</div>
                      <div style={{fontSize:13,color:"var(--sl-muted)",textAlign:"center"}}>Felvétel kész – hallgasd meg!</div>
                      <audio controls src={recRadioAudioUrl} style={{width:"100%",maxWidth:380}} />
                      <div style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center"}}>
                        <button className="sr-btn sr-btn-ghost" type="button" onClick={resetRecRadio} disabled={recRadioUploading}>
                          🔄 Új felvétel
                        </button>
                        <button className="sr-btn sr-btn-primary" type="button" onClick={() => void addRecordingToPlaylist()} disabled={recRadioUploading}>
                          {recRadioUploading ? "⏳ Feltöltés…" : "＋ Hozzáad a listához"}
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
                  <span>📋 {plItems.filter((i) => i.status === "ready").length} dal • Teljes hossz:</span>
                  <span>{fmtDuration(plTotalSec)}</span>
                </div>

                <div style={{ padding: "10px 14px", display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="sr-input"
                    style={{ flex: 1 }}
                    placeholder="Összeállítás neve (pl. Szünet – dec. 5.)"
                    value={plName}
                    onChange={(e) => setPlName(stripAccents(e.target.value))}
                  />
                  <button
                    className={`sr-btn sr-btn-primary${plBusy ? " sr-build-busy" : ""}`}
                    type="button"
                    disabled={plBusy}
                    onClick={buildPlaylist}>
                    {plBusy ? "⏳ Készül…" : "🔨 Összeállít"}
                  </button>
                </div>
              </>
            )}

            {/* Kész összeállítás */}
            {plBuiltUrl && plBuiltName && (
              <div className="sr-built-result">
                <div style={{ fontSize: 13, fontWeight: 800, color: "#15803d" }}>✅ {plBuiltName} – elkészült!</div>
                <audio controls src={plBuiltUrl} style={{ width: "100%", height: 32, borderRadius: 8 }} preload="metadata" />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a href={plBuiltUrl} download={plBuiltName + ".mp3"} className="sr-btn sr-btn-ghost sr-btn-sm">
                    ⬇ Letöltés
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
                      📅 Ütemezés
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
                    🔄 Új összeállítás
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
                {stationForm.mode === "new" ? "＋ Új rádióállomás" : "✏️ Állomás szerkesztése"}
              </div>
              <button className="sr-overlay-close" type="button" onClick={() => setStationForm(null)}>✕</button>
            </div>
            <div className="sr-overlay-body" style={{display:"flex",flexDirection:"column",gap:12}}>
              {stationError && (
                <div className="sr-alert sr-alert-error"><span>⚠️</span><span>{stationError}</span></div>
              )}
              <div>
                <div style={{fontSize:11,fontWeight:800,color:"var(--sl-muted)",textTransform:"uppercase",letterSpacing:0.3,marginBottom:5}}>Név</div>
                <input className="sr-input" style={{width:"100%"}}
                  value={stationForm.name}
                  onChange={e => setStationForm(s => s ? { ...s, name: stripAccents(e.target.value) } : s)}
                  placeholder="pl. Radio 88 (ékezetek nélkül)" autoFocus />
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:800,color:"var(--sl-muted)",textTransform:"uppercase",letterSpacing:0.3,marginBottom:5}}>Műfaj</div>
                <input className="sr-input" style={{width:"100%"}}
                  value={stationForm.genre}
                  onChange={e => setStationForm(s => s ? { ...s, genre: stripAccents(e.target.value) } : s)}
                  placeholder="pl. rock, retro, jazz" />
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:800,color:"var(--sl-muted)",textTransform:"uppercase",letterSpacing:0.3,marginBottom:5,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>Alstreamek (legalább 1)</span>
                  <button type="button" className="sr-btn sr-btn-ghost sr-btn-sm"
                    onClick={() => setStationForm(s => s ? { ...s, streams: [...s.streams, { label: "", url: "" }] } : s)}>
                    ＋ Hozzáad
                  </button>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {stationForm.streams.map((s, idx) => (
                    <div key={idx} className="sr-stream-row">
                      <input className="sr-input"
                        placeholder="Label (pl. Foadas, Rock, Jazz)"
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
                        title={stationForm.streams.length <= 1 ? "Legalább egy stream kell" : "Stream törlése"}>
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:11,color:"var(--sl-muted)",marginTop:6}}>
                  💡 A myonlineradio.hu-n megnézheted a publikus stream URL-eket és alcsatornákat.
                </div>
              </div>
              <div style={{display:"flex",justifyContent:"flex-end",gap:10,paddingTop:4}}>
                <button type="button" className="sr-btn sr-btn-ghost" onClick={() => setStationForm(null)}>
                  Mégse
                </button>
                <button type="button" className="sr-btn sr-btn-primary" onClick={submitStation}>
                  {stationForm.mode === "new" ? "＋ Hozzáadás" : "💾 Mentés"}
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
              <div className="sr-overlay-title">📥 Időzített lejátszások</div>
              <button className="sr-overlay-close" type="button" onClick={() => setHistoryOpen(false)}>✕</button>
            </div>
            <div className="sr-overlay-body">
              {/* Jövőbeli (időrend szerinti sorrend, legközelebbi felül) */}
              {upcomingSchedules.length === 0 ? (
                <div className="sr-empty" style={{padding:"24px 16px"}}>
                  <div className="sr-empty-icon">⏰</div>
                  <div style={{fontSize:13,fontWeight:700}}>Nincs közelgő ütemezés</div>
                </div>
              ) : (
                upcomingSchedules.map(s => {
                  const endTime = addSeconds(s.scheduledAt, s.radioFile.durationSec);
                  const targetLabel =
                    s.targetType === "ALL" ? "📡 Összes" : s.targetType === "DEVICE" ? "🔊 Egyedi" : "👥 Csoport";
                  const isWarn = checkTeachingHourOverlap(new Date(s.scheduledAt), s.radioFile.durationSec, mainBells);
                  return (
                    <div key={s.id} className="sr-sched-item">
                      <div>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <span className="sr-sched-time">{fmtDateTimeFull(s.scheduledAt)}</span>
                          {endTime && <span className="sr-sched-end">→ {endTime}</span>}
                          {isWarn && <span className="sr-lesson-warn">⚠️ Tanítási óra</span>}
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
              <div className="sr-section-divider">Elhangzott lejátszások</div>

              {/* Múltbeli (legutóbbi felül) */}
              {pastSchedules.length === 0 ? (
                <div className="sr-empty" style={{padding:"18px 16px"}}>
                  <div className="sr-empty-icon">🕐</div>
                  <div style={{fontSize:13,fontWeight:700}}>Még nem volt lejátszás</div>
                </div>
              ) : (
                pastSchedules.map(s => {
                  const badge = STATUS_BADGE[s.status] ?? STATUS_BADGE.PENDING;
                  const endTime = addSeconds(s.scheduledAt, s.radioFile.durationSec);
                  const targetLabel =
                    s.targetType === "ALL" ? "📡 Összes" : s.targetType === "DEVICE" ? "🔊 Egyedi" : "👥 Csoport";
                  return (
                    <div key={s.id} className="sr-sched-item sr-sched-past">
                      <div>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <span className="sr-sched-time" style={{color:"var(--sl-muted)",fontSize:13}}>{fmtDateTimeFull(s.scheduledAt)}</span>
                          {endTime && <span className="sr-sched-end">→ {endTime}</span>}
                          <span className="sr-badge" style={{background:badge.bg,color:badge.color,borderColor:badge.color+"44"}}>{badge.label}</span>
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
                        title="Újraütemezés"
                        onClick={() => {
                          const n = new Date();
                          setFormFileId(s.radioFileId);
                          setFormDate(n.toISOString().slice(0, 10));
                          setFormTime(`${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`);
                          setFormOpen(true);
                          setHistoryOpen(false);
                        }}>
                        🔁 Újra
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