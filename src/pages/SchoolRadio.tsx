// src/pages/SchoolRadio.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

// ─── Típusok ──────────────────────────────────────────────────────────────
type RadioFile = {
  id: string; originalName: string; filename: string;
  sizeBytes: number; durationSec: number | null; fileUrl: string;
  createdAt: string;
  createdBy: { id: string; displayName: string | null; email: string };
  _count: { schedules: number };
};
type RadioSchedule = {
  id: string; radioFileId: string; targetType: string; targetId: string | null;
  scheduledAt: string; status: "PENDING" | "DISPATCHED" | "CANCELLED";
  dispatchedAt: string | null; createdAt: string;
  radioFile: { id: string; originalName: string; durationSec: number | null; fileUrl: string };
};
type Device      = { id: string; name: string; online: boolean; deviceClass: string };
type DeviceGroup = { id: string; name: string };
type BellEntry   = { hour: number; minute: number; type: string };
type NowPlaying  = { name: string; durationSec: number | null; startsAt: Date } | null;

// Playlist builder item
type PlItem = {
  id: string;
  source: "upload" | "youtube" | "gdrive";
  url: string;
  title: string;
  durationSec: number | null;
  status: "idle" | "fetching" | "ready" | "error";
  errorMsg?: string;
  audioPreviewUrl?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────
function fmtDuration(sec: number | null | undefined): string {
  if (!sec) return "–";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
}
function fmtSize(bytes: number): string {
  if (bytes >= 1024*1024) return `${(bytes/1024/1024).toFixed(1)} MB`;
  return `${(bytes/1024).toFixed(0)} KB`;
}
function fmtDateTimeFull(iso: string): string {
  return new Date(iso).toLocaleString("hu-HU", {
    year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"
  });
}
function addSeconds(iso: string, sec: number | null | undefined): string | null {
  if (!sec) return null;
  return new Date(new Date(iso).getTime() + sec * 1000).toLocaleTimeString("hu-HU",{hour:"2-digit",minute:"2-digit"});
}
function uid(): string { return Math.random().toString(36).slice(2,10); }

const STATUS_BADGE: Record<string,{bg:string;color:string;label:string}> = {
  PENDING:    {bg:"#eff6ff",  color:"#1d4ed8", label:"Vár"},
  DISPATCHED: {bg:"#f0fdf4",  color:"#15803d", label:"Elküldve"},
  CANCELLED:  {bg:"#f9fafb",  color:"#6b7280", label:"Törölve"},
};

function getTeachingHours(bells: BellEntry[], onDay: Date): Array<{start:Date;end:Date}> {
  const pairs: Array<{start:Date;end:Date}> = [];
  const sorted = [...bells].sort((a,b)=>(a.hour*60+a.minute)-(b.hour*60+b.minute));
  for (let i=0; i<sorted.length-1; i+=2) {
    const s = new Date(onDay); s.setHours(sorted[i].hour, sorted[i].minute, 0, 0);
    const e = new Date(onDay); e.setHours(sorted[i+1].hour, sorted[i+1].minute, 0, 0);
    pairs.push({start:s, end:e});
  }
  return pairs;
}
function checkTeachingHourOverlap(start: Date, durSec: number|null|undefined, bells: BellEntry[]): boolean {
  if (!durSec || bells.length < 2) return false;
  const end = new Date(start.getTime() + durSec*1000);
  const hours = getTeachingHours(bells, start);
  return hours.some(h => start < h.end && end > h.start);
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
  .sr-search-result.sel{background:#eff6ff;border-color:#3b82f6}
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

  @media(max-width:1000px){.sr-layout{grid-template-columns:1fr}}
`;

export default function SchoolRadio() {
  const { state } = useAuth();

  // ── Alap állapot ──────────────────────────────────────────────────────────
  const [files,     setFiles]     = useState<RadioFile[]>([]);
  const [schedules, setSchedules] = useState<RadioSchedule[]>([]);
  const [devices,   setDevices]   = useState<Device[]>([]);
  const [groups,    setGroups]    = useState<DeviceGroup[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string|null>(null);

  // Upload
  const [uploading,    setUploading]    = useState(false);
  const [uploadPct,    setUploadPct]    = useState(0);
  const [drag,         setDrag]         = useState(false);
  const fileInputRef                    = useRef<HTMLInputElement>(null);
  const plFileInputRef                  = useRef<HTMLInputElement>(null);

  // Fájl választó + lejátszó
  const [selectedFile, setSelectedFile] = useState<RadioFile|null>(null);

  // Ütemezés form
  const [formOpen,     setFormOpen]     = useState(false);
  const [formFileId,   setFormFileId]   = useState("");
  const [formDate,     setFormDate]     = useState("");
  const [formTime,     setFormTime]     = useState("");
  const [formTarget,   setFormTarget]   = useState<"ALL"|"DEVICE"|"GROUP">("ALL");
  const [formTargetId, setFormTargetId] = useState("");
  const [formBusy,     setFormBusy]     = useState(false);
  const [formError,    setFormError]    = useState<string|null>(null);

  // Csengetési rend
  const [mainBells, setMainBells] = useState<BellEntry[]>([]);

  // Vészleállító
  const [stopBusy, setStopBusy] = useState(false);

  // Now Playing
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>(null);
  const [nowTick,    setNowTick]    = useState(0);

  // ── Playlist builder állapot ──────────────────────────────────────────────
  const [plItems,      setPlItems]      = useState<PlItem[]>([]);
  const [plName,       setPlName]       = useState("");
  const [plBusy,       setPlBusy]       = useState(false);
  const [plError,      setPlError]      = useState<string|null>(null);
  const [plBuiltFileId,setPlBuiltFileId]= useState<string|null>(null);
  const [plBuiltUrl,   setPlBuiltUrl]   = useState<string|null>(null);
  const [plBuiltName,  setPlBuiltName]  = useState<string|null>(null);
  const [plTab,        setPlTab]        = useState<"list"|"yt-search"|"yt-url"|"gdrive">("list");

  // YT keresés
  const [ytQuery,     setYtQuery]     = useState("");
  const [ytResults,   setYtResults]   = useState<{id:string;title:string;duration:string;thumbnail:string}[]>([]);
  const [ytSearching, setYtSearching] = useState(false);
  const [ytSelResult, setYtSelResult] = useState<string|null>(null);

  // YT URL paste
  const [ytPasteUrl,  setYtPasteUrl]  = useState("");
  const [ytFetching,  setYtFetching]  = useState(false);

  // Drive
  const [driveUrl,     setDriveUrl]     = useState("");
  const [driveFetching,setDriveFetching]= useState(false);
  const [driveFiles,   setDriveFiles]   = useState<{name:string;url:string;durationSec?:number}[]>([]);

  // Drag reorder
  const dragIdx = useRef<number|null>(null);

  // ── Betöltés ─────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [filesRes, schedsRes, targetsRes] = await Promise.all([
        apiFetch<{ok:boolean;files:RadioFile[]}>("/radio/files"),
        apiFetch<{ok:boolean;schedules:RadioSchedule[]}>("/radio/schedules"),
        apiFetch<{ok:boolean;devices:Device[];groups:DeviceGroup[]}>("/radio/targets"),
      ]);
      setFiles(filesRes.files ?? []);
      setSchedules(schedsRes.schedules ?? []);
      setDevices(targetsRes.devices ?? []);
      setGroups(targetsRes.groups ?? []);
    } catch (e:any) { setError(e?.message ?? "Betöltés sikertelen"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    const t = setInterval(() => setNowTick(n => n+1), 5_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const now = new Date();
    const playing = schedules.find(s => {
      if (s.status === "CANCELLED") return false;
      const start = new Date(s.dispatchedAt ?? s.scheduledAt);
      const dur = s.radioFile.durationSec;
      if (!dur) return false;
      return now >= start && now <= new Date(start.getTime() + dur*1000);
    });
    setNowPlaying(playing ? {
      name: playing.radioFile.originalName,
      durationSec: playing.radioFile.durationSec,
      startsAt: new Date(playing.dispatchedAt ?? playing.scheduledAt),
    } : null);
  }, [schedules, nowTick]);

  useEffect(() => {
    apiFetch<{ok:boolean;templates:Array<{bells:BellEntry[];isDefault:boolean}>}>("/bells/templates")
      .then(r => {
        const def = r.templates?.find(t=>t.isDefault) ?? r.templates?.[0];
        if (def) setMainBells(def.bells.filter(b=>b.type==="MAIN"));
      }).catch(()=>{});
  }, []);

  // ── Upload (könyvtár) ─────────────────────────────────────────────────────
  async function handleUpload(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["mp3","wav","ogg","m4a","aac"].includes(ext)) {
      setError("Csak hangfájl tölthető fel (.mp3, .wav, .ogg, .m4a, .aac)"); return;
    }
    setUploading(true); setUploadPct(0); setError(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.upload.onprogress = e => { if (e.lengthComputable) setUploadPct(Math.round(e.loaded/e.total*100)); };
        xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(JSON.parse(xhr.responseText)?.error ?? `HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Hálózati hiba"));
        const token = (state as any).token ?? localStorage.getItem("token") ?? "";
        const tenantId = sessionStorage.getItem("activeTenantId") ?? "";
        xhr.open("POST", `${import.meta.env.VITE_API_URL ?? "https://api.schoollive.hu"}/radio/files`);
        if (token)    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        if (tenantId) xhr.setRequestHeader("x-tenant-id", tenantId);
        xhr.send(formData);
      });
      await loadAll();
    } catch (e:any) { setError("Feltöltés sikertelen: " + e.message); }
    finally { setUploading(false); setUploadPct(0); }
  }

  // ── Fájl törlés ───────────────────────────────────────────────────────────
  async function deleteFile(file: RadioFile) {
    const warn = file._count.schedules > 0
      ? `⚠️ Ezzel ${file._count.schedules} ütemezés IS TÖRLŐDIK!\n\nBiztos törlöd: "${file.originalName}"?`
      : `Törlöd: "${file.originalName}"?`;
    if (!window.confirm(warn)) return;
    try {
      await apiFetch(`/radio/files/${file.id}`, { method:"DELETE" });
      if (selectedFile?.id === file.id) setSelectedFile(null);
      await loadAll();
    } catch (e:any) { setError(e?.message ?? "Törlés sikertelen"); }
  }

  // ── Ütemezés törlés ───────────────────────────────────────────────────────
  async function deleteSchedule(id: string) {
    if (!window.confirm("Törlöd ezt az ütemezést?")) return;
    try { await apiFetch(`/radio/schedules/${id}`, {method:"DELETE"}); await loadAll(); }
    catch (e:any) { setError(e?.message ?? "Törlés sikertelen"); }
  }

  // ── Ütemezés létrehozás ───────────────────────────────────────────────────
  async function submitSchedule(overrideFileId?: string) {
    const fileId = overrideFileId ?? formFileId;
    setFormError(null);
    if (!fileId)             { setFormError("Válassz hangfájlt!"); return; }
    if (!formDate||!formTime){ setFormError("Adj meg dátumot és időt!"); return; }
    if (formTarget !== "ALL" && !formTargetId) { setFormError("Válassz célt!"); return; }
    const scheduledAt = new Date(`${formDate}T${formTime}:00`);
    if (isNaN(scheduledAt.getTime())) { setFormError("Érvénytelen dátum/idő"); return; }
    if (scheduledAt < new Date())     { setFormError("Az időpont a múltban van!"); return; }

    const durSec = files.find(f=>f.id===fileId)?.durationSec ?? null;

    // Tanítási óra ütközés
    if (checkTeachingHourOverlap(scheduledAt, durSec, mainBells)) {
      if (!window.confirm("⚠️ A rádióműsor tanítási órát érint!\n\nBiztosan így szeretnéd ütemezni?")) return;
    }

    // Szünetbe nem fér el – trim ajánlat
    if (durSec && mainBells.length >= 2) {
      const hours = getTeachingHours(mainBells, scheduledAt);
      const nextLesson = hours.find(h => h.start > scheduledAt);
      if (nextLesson) {
        const breakSec = (nextLesson.start.getTime() - scheduledAt.getTime()) / 1000;
        if (durSec > breakSec) {
          const wantTrim = window.confirm(
            `⚠️ A hangfájl (${fmtDuration(durSec)}) nem fér bele a szünetbe (${fmtDuration(Math.floor(breakSec))})!\n\n`+
            `Levágjuk a végét, hogy beleférjen (5mp fade-out átmenettel)? Az eredeti fájl megmarad.\n\n`+
            `Igen → levágott verzió ütemezése\nNem → az eredeti hosszú fájl ütemezése`
          );
          if (wantTrim) {
            setFormBusy(true);
            try {
              const trimSec = Math.max(1, Math.floor(breakSec) - 10);
              const trimRes = await apiFetch<{ok:boolean;fileId:string;filename:string}>("/radio/files/trim", {
                method:"POST", headers:{"Content-Type":"application/json"},
                body: JSON.stringify({ fileId, trimSec, fadeOut: 5 }),
              });
              if (trimRes.ok) {
                await loadAll();
                await apiFetch("/radio/schedules", {
                  method:"POST", headers:{"Content-Type":"application/json"},
                  body: JSON.stringify({ radioFileId: trimRes.fileId, targetType: formTarget, targetId: formTarget==="ALL"?null:formTargetId, scheduledAt: scheduledAt.toISOString() }),
                });
                setFormOpen(false); setFormDate(""); setFormTime(""); setFormTargetId("");
                await loadAll(); return;
              }
            } catch(e:any) { setFormError("Vágás sikertelen: " + (e?.message??"")); setFormBusy(false); return; }
          }
        }
      }
    }

    setFormBusy(true);
    try {
      await apiFetch("/radio/schedules", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ radioFileId: fileId, targetType: formTarget, targetId: formTarget==="ALL"?null:formTargetId, scheduledAt: scheduledAt.toISOString() }),
      });
      setFormOpen(false); setFormDate(""); setFormTime(""); setFormTargetId("");
      await loadAll();
    } catch(e:any) {
      const data = (e as any)?.data ?? {};
      setFormError(data?.conflict ? `Időütközés: "${data.conflict.originalName}" körül már foglalt` : (e?.message ?? "Létrehozás sikertelen"));
    } finally { setFormBusy(false); }
  }

  // ── Playlist builder – YT info lekérés ───────────────────────────────────
  async function fetchYtInfo(url: string): Promise<{title:string;durationSec:number}|null> {
    try {
      const res = await apiFetch<{ok:boolean;title:string;durationSec:number}>(`/radio/yt-info?url=${encodeURIComponent(url)}`);
      if (res.ok) return { title: res.title, durationSec: res.durationSec };
    } catch {}
    return null;
  }

  async function addYtUrl() {
    const url = ytPasteUrl.trim();
    if (!url) return;
    setYtFetching(true);
    const itemId = uid();
    const newItem: PlItem = { id: itemId, source:"youtube", url, title:"Betöltés…", durationSec:null, status:"fetching" };
    setPlItems(prev => [...prev, newItem]);
    setPlTab("list");
    const info = await fetchYtInfo(url);
    setPlItems(prev => prev.map(i => i.id===itemId ? {
      ...i,
      title: info?.title ?? url,
      durationSec: info?.durationSec ?? null,
      status: info ? "ready" : "error",
      errorMsg: info ? undefined : "Nem sikerült betölteni az adatokat",
    } : i));
    setYtPasteUrl("");
    setYtFetching(false);
  }

  async function searchYt() {
    if (!ytQuery.trim()) return;
    setYtSearching(true); setYtResults([]);
    try {
      const res = await apiFetch<{ok:boolean;results:typeof ytResults}>(`/radio/yt-search?q=${encodeURIComponent(ytQuery)}&limit=5`);
      setYtResults(res.results ?? []);
    } catch { setYtResults([]); }
    finally { setYtSearching(false); }
  }

  async function addYtSearchResult() {
    const result = ytResults.find(r=>r.id===ytSelResult);
    if (!result) return;
    const url = `https://www.youtube.com/watch?v=${result.id}`;
    const durParts = result.duration?.split(":").map(Number) ?? [];
    const durationSec = durParts.length===2 ? durParts[0]*60+durParts[1] : durParts.length===3 ? durParts[0]*3600+durParts[1]*60+durParts[2] : null;
    setPlItems(prev => [...prev, { id:uid(), source:"youtube", url, title:result.title, durationSec, status:"ready" }]);
    setYtSelResult(null);
    setPlTab("list");
  }

  // ── Playlist builder – Drive lekérés ──────────────────────────────────────
  async function fetchDrive() {
    if (!driveUrl.trim()) return;
    setDriveFetching(true); setDriveFiles([]);
    try {
      const res = await apiFetch<{ok:boolean;files:{name:string;url:string;durationSec?:number}[]}>(`/radio/gdrive-files?url=${encodeURIComponent(driveUrl.trim())}`);
      setDriveFiles(res.files ?? []);
    } catch(e:any) { setPlError(e?.message ?? "Drive betöltési hiba"); }
    finally { setDriveFetching(false); }
  }

  function addDriveFile(f: {name:string;url:string;durationSec?:number}) {
    setPlItems(prev => [...prev, { id:uid(), source:"gdrive", url:f.url, title:f.name, durationSec:f.durationSec??null, status:"ready" }]);
  }

  // ── Playlist builder – Upload a listába ───────────────────────────────────
  async function handlePlUpload(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["mp3","wav","ogg","m4a","aac"].includes(ext)) { setPlError("Csak hangfájl adható hozzá"); return; }
    setPlError(null);
    const itemId = uid();
    setPlItems(prev => [...prev, { id:itemId, source:"upload", url:"", title:file.name, durationSec:null, status:"fetching" }]);
    setPlTab("list");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const xhr = new XMLHttpRequest();
      const uploadedUrl = await new Promise<string>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status < 300) { const r = JSON.parse(xhr.responseText); resolve(r.file?.fileUrl ?? ""); }
          else reject(new Error(JSON.parse(xhr.responseText)?.error ?? `HTTP ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Hálózati hiba"));
        const token = (state as any).token ?? localStorage.getItem("token") ?? "";
        const tenantId = sessionStorage.getItem("activeTenantId") ?? "";
        xhr.open("POST", `${import.meta.env.VITE_API_URL ?? "https://api.schoollive.hu"}/radio/files`);
        if (token)    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        if (tenantId) xhr.setRequestHeader("x-tenant-id", tenantId);
        xhr.send(formData);
      });
      await loadAll();
      const uploaded = files.find(f => f.originalName === file.name);
      setPlItems(prev => prev.map(i => i.id===itemId ? {
        ...i, url: uploadedUrl, title: file.name,
        durationSec: uploaded?.durationSec ?? null,
        status: "ready", audioPreviewUrl: uploadedUrl,
      } : i));
    } catch(e:any) {
      setPlItems(prev => prev.map(i => i.id===itemId ? {...i, status:"error", errorMsg:e.message} : i));
    }
  }

  // ── Playlist builder – Összeállítás ──────────────────────────────────────
  async function buildPlaylist() {
    const readyItems = plItems.filter(i => i.status === "ready");
    if (readyItems.length === 0) { setPlError("Adj hozzá legalább egy kész elemet!"); return; }
    if (!plName.trim()) { setPlError("Adj nevet az összeállításnak!"); return; }
    setPlBusy(true); setPlError(null); setPlBuiltFileId(null); setPlBuiltUrl(null);
    try {
      const res = await apiFetch<{ok:boolean;fileId:string;fileUrl:string;name:string}>("/radio/ytplaylists/build-custom", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          name: plName.trim(),
          items: readyItems.map(i => ({ url: i.url, title: i.title, source: i.source })),
        }),
      });
      // Poll
      const fileId = res.fileId;
      const poll = setInterval(async () => {
        try {
          const s = await apiFetch<{ok:boolean;status:string;fileUrl:string;name:string}>(`/radio/ytplaylists/build-status/${fileId}`);
          if (s.status === "DONE") {
            clearInterval(poll);
            setPlBuiltFileId(fileId); setPlBuiltUrl(s.fileUrl); setPlBuiltName(s.name);
            setPlBusy(false); await loadAll();
          } else if (s.status === "ERROR") {
            clearInterval(poll);
            setPlError("Összeállítás sikertelen. Ellenőrizd a linkeket!"); setPlBusy(false);
          }
        } catch { clearInterval(poll); setPlError("Hiba az állapotlekérdezéskor"); setPlBusy(false); }
      }, 3000);
    } catch(e:any) { setPlError(e?.message ?? "Build hiba"); setPlBusy(false); }
  }

  // ── Drag-reorder ──────────────────────────────────────────────────────────
  function onDragStart(idx: number) { dragIdx.current = idx; }
  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    setPlItems(prev => {
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
    .filter(s => s.status === "PENDING" && new Date(s.scheduledAt) > now)
    .sort((a,b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const pastSchedules = schedules
    .filter(s => s.status === "DISPATCHED" || (s.status === "PENDING" && new Date(s.scheduledAt) <= now))
    .sort((a,b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
    .slice(0, 30);

  const previewFile = files.find(f => f.id === formFileId);
  const previewEnd  = (formDate && formTime && previewFile?.durationSec)
    ? addSeconds(`${formDate}T${formTime}:00`, previewFile.durationSec) : null;

  const plTotalSec = plItems.filter(i=>i.status==="ready").reduce((s,i) => s + (i.durationSec??0), 0);

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
            const shortName = nowPlaying ? (nowPlaying.name.length>16 ? nowPlaying.name.slice(0,16)+"…" : nowPlaying.name) : null;
            return (
              <div className={`sr-now-playing ${nowPlaying?"sr-now-playing-active":"sr-now-playing-idle"}`}>
                <span className={`sr-now-playing-dot ${nowPlaying?"sr-now-playing-dot-active":"sr-now-playing-dot-idle"}`} />
                {nowPlaying ? <span>🎵 <strong>{shortName}</strong></span> : <span>Nem játszik semmi</span>}
              </div>
            );
          })()}
          <button className="sr-stop-btn" disabled={stopBusy} type="button"
            onClick={async () => {
              if (!window.confirm("Leállítod az összes lejátszót?")) return;
              setStopBusy(true);
              try { await apiFetch("/radio/stop-all",{method:"POST"}); setNowPlaying(null); }
              catch(e:any){ alert("Hiba: "+(e?.message??"ismeretlen")); }
              finally { setStopBusy(false); }
            }}>
            🛑 {stopBusy?"Leállítás…":"RÁDIÓ STOP"}
          </button>
          <button className="sr-btn sr-btn-primary" onClick={()=>void loadAll()} disabled={loading} type="button">🔄</button>
        </div>
      </div>

      {error && (
        <div className="sr-alert sr-alert-error">
          <span>⚠️</span><span>{error}</span>
          <button style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#dc2626"}} onClick={()=>setError(null)}>✕</button>
        </div>
      )}

      <div className="sr-layout">

        {/* ═══ BAL PANEL ═══ */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>

          {/* Hangfájl könyvtár */}
          <div className="sr-panel">
            <div className="sr-panel-hdr">
              <div className="sr-panel-title">🎵 Hangfájl könyvtár</div>
              <span style={{fontSize:12,color:"var(--sl-muted)"}}>max 200 MB</span>
            </div>
            <div
              className={`sr-upload-zone${drag?" drag":""}`}
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDragOver={e=>{e.preventDefault();setDrag(true);}}
              onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files?.[0];if(f)void handleUpload(f);}}
            >
              <input ref={fileInputRef} type="file" accept="audio/*" style={{display:"none"}}
                onChange={e=>{const f=e.target.files?.[0];if(f)void handleUpload(f);e.target.value="";}} disabled={uploading} />
              <div className="sr-upload-icon">{uploading?"⏳":"🎵"}</div>
              <div className="sr-upload-txt">{uploading?`Feltöltés… ${uploadPct}%`:"Húzd ide vagy kattints a feltöltéshez"}</div>
              <div className="sr-upload-sub">MP3, WAV, OGG, M4A, AAC</div>
            </div>
            {uploading && <div className="sr-upload-progress"><div className="sr-upload-bar" style={{width:`${uploadPct}%`}} /></div>}

            {files.length === 0 && !loading ? (
              <div className="sr-empty"><div className="sr-empty-icon">🎵</div><div style={{fontSize:14,fontWeight:700}}>Még nincs feltöltött hangfájl</div></div>
            ) : files.map(f => (
              <div key={f.id} className={`sr-file-item${selectedFile?.id===f.id?" selected":""}`}
                onClick={()=>setSelectedFile(selectedFile?.id===f.id?null:f)}>
                <div style={{display:"flex",alignItems:"center",gap:10,justifyContent:"space-between"}}>
                  <div style={{minWidth:0}}>
                    <div className="sr-file-name" title={f.originalName}>🎵 {f.originalName}</div>
                    <div className="sr-file-meta">
                      <span>⏱ {fmtDuration(f.durationSec)}</span>
                      <span>💾 {fmtSize(f.sizeBytes)}</span>
                      {f._count.schedules>0 && <span style={{color:"#6366f1"}}>📅 {f._count.schedules}×</span>}
                    </div>
                  </div>
                  <div className="sr-file-actions" onClick={e=>e.stopPropagation()}>
                    <button className="sr-btn sr-btn-primary sr-btn-sm" title="Ütemezés"
                      onClick={()=>{setFormFileId(f.id);setFormOpen(true);}} type="button">📅</button>
                    <button className="sr-btn sr-btn-danger sr-btn-sm" title="Törlés"
                      onClick={()=>void deleteFile(f)} type="button">🗑</button>
                  </div>
                </div>
                {selectedFile?.id===f.id && (
                  <div className="sr-player" onClick={e=>e.stopPropagation()}>
                    <div className="sr-player-name">▶ {f.originalName}</div>
                    <audio controls src={f.fileUrl} preload="metadata" style={{width:"100%",height:32}} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ═══ Playlist összeállító ═══ */}
          <div className="sr-panel">
            <div className="sr-panel-hdr">
              <div className="sr-panel-title">🎼 Lejátszási lista készítő</div>
              {plItems.length > 0 && (
                <button className="sr-btn sr-btn-danger sr-btn-sm" type="button"
                  onClick={()=>{if(window.confirm("Törlöd az összeállítást?"))setPlItems([]);}}>🗑 Töröl</button>
              )}
            </div>

            {/* Tabs */}
            <div className="sr-tabs">
              {([
                {id:"list",    label:`📋 Lista (${plItems.length})`},
                {id:"yt-search",label:"🔍 YouTube keresés"},
                {id:"yt-url",  label:"🔗 YouTube link"},
                {id:"gdrive",  label:"📁 Google Drive"},
              ] as const).map(t => (
                <button key={t.id} className={`sr-tab${plTab===t.id?" active":""}`}
                  type="button" onClick={()=>setPlTab(t.id)}>{t.label}</button>
              ))}
            </div>

            {plError && (
              <div style={{margin:"10px 14px 0"}} className="sr-alert sr-alert-error">
                ⚠️ {plError}
                <button style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#dc2626"}} onClick={()=>setPlError(null)}>✕</button>
              </div>
            )}

            {/* Lista tab */}
            {plTab === "list" && (
              <div style={{padding:"12px 14px"}}>
                {plItems.length === 0 ? (
                  <div className="sr-empty" style={{padding:"28px 20px"}}>
                    <div className="sr-empty-icon">🎼</div>
                    <div style={{fontSize:13,fontWeight:700}}>Üres lista</div>
                    <div style={{fontSize:12,color:"var(--sl-muted)",marginTop:4}}>Adj hozzá dalokat a többi fülről</div>
                  </div>
                ) : (
                  plItems.map((item, idx) => (
                    <div key={item.id} className="sr-pl-item"
                      draggable onDragStart={()=>onDragStart(idx)} onDragOver={e=>onDragOver(e,idx)}>
                      <span className="sr-pl-drag">⠿</span>
                      <span className="sr-pl-num">{idx+1}</span>
                      <div className="sr-pl-info">
                        <div className="sr-pl-title" title={item.title}>
                          {item.status==="fetching" ? "⏳ " : item.status==="error" ? "❌ " : ""}
                          {item.title}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginTop:3}}>
                          <span className={`sr-pl-src sr-pl-src-${item.source==="youtube"?"yt":item.source==="gdrive"?"gd":"up"}`}>
                            {item.source==="youtube"?"▶ YouTube":item.source==="gdrive"?"📁 Drive":"🎵 Feltöltés"}
                          </span>
                          <span className="sr-pl-dur">{fmtDuration(item.durationSec)}</span>
                          {item.errorMsg && <span style={{fontSize:10,color:"#dc2626"}}>{item.errorMsg}</span>}
                        </div>
                      </div>
                      {(item.audioPreviewUrl || item.source==="upload") && (
                        <audio controls src={item.audioPreviewUrl} style={{height:24,width:80}} preload="none" />
                      )}
                      <div style={{display:"flex",gap:4,flexShrink:0}}>
                        <button type="button" className="sr-btn sr-btn-ghost sr-btn-sm"
                          disabled={idx===0} onClick={()=>setPlItems(prev=>{const n=[...prev];[n[idx-1],n[idx]]=[n[idx],n[idx-1]];return n;})}>↑</button>
                        <button type="button" className="sr-btn sr-btn-ghost sr-btn-sm"
                          disabled={idx===plItems.length-1} onClick={()=>setPlItems(prev=>{const n=[...prev];[n[idx],n[idx+1]]=[n[idx+1],n[idx]];return n;})}>↓</button>
                        <button type="button" className="sr-btn sr-btn-danger sr-btn-sm"
                          onClick={()=>setPlItems(prev=>prev.filter((_,j)=>j!==idx))}>✕</button>
                      </div>
                    </div>
                  ))
                )}

                {/* Fájl feltöltés a listához */}
                <div style={{marginTop:10}}>
                  <input ref={plFileInputRef} type="file" accept="audio/*" style={{display:"none"}}
                    onChange={e=>{const f=e.target.files?.[0];if(f)void handlePlUpload(f);e.target.value="";}} />
                  <button type="button" className="sr-btn sr-btn-ghost" style={{width:"100%",justifyContent:"center",fontSize:12}}
                    onClick={()=>plFileInputRef.current?.click()}>
                    ＋ Hangfájl feltöltése a listához
                  </button>
                </div>
              </div>
            )}

            {/* YT keresés tab */}
            {plTab === "yt-search" && (
              <div style={{padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
                <div style={{display:"flex",gap:8}}>
                  <input className="sr-input" style={{flex:1}} placeholder="Keresés YouTube-on…"
                    value={ytQuery} onChange={e=>setYtQuery(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&searchYt()} />
                  <button className="sr-btn sr-btn-primary sr-btn-sm" type="button"
                    onClick={searchYt} disabled={ytSearching}>
                    {ytSearching?"⏳":"🔍"}
                  </button>
                </div>
                {ytResults.length > 0 && (
                  <>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {ytResults.map(r => (
                        <div key={r.id} className={`sr-search-result${ytSelResult===r.id?" sel":""}`}
                          onClick={()=>setYtSelResult(ytSelResult===r.id?null:r.id)}>
                          <img src={r.thumbnail} alt="" className="sr-search-thumb" />
                          <div style={{minWidth:0}}>
                            <div className="sr-search-title">{r.title}</div>
                            <div className="sr-search-meta">⏱ {r.duration}</div>
                          </div>
                          {ytSelResult===r.id && <span style={{color:"#3b82f6",fontSize:18}}>✓</span>}
                        </div>
                      ))}
                    </div>
                    <button className="sr-btn sr-btn-primary" type="button" style={{justifyContent:"center"}}
                      disabled={!ytSelResult} onClick={addYtSearchResult}>
                      ＋ Hozzáadás a listához
                    </button>
                  </>
                )}
                {ytResults.length===0 && !ytSearching && ytQuery && (
                  <div style={{textAlign:"center",fontSize:13,color:"var(--sl-muted)",padding:"12px 0"}}>Nincs találat</div>
                )}
              </div>
            )}

            {/* YT URL tab */}
            {plTab === "yt-url" && (
              <div style={{padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
                <div style={{fontSize:12,color:"var(--sl-muted)"}}>
                  Illeszd be a YouTube videó linkjét. A cím és hossz automatikusan betöltődik.
                </div>
                <div style={{display:"flex",gap:8}}>
                  <input className="sr-input" style={{flex:1}} placeholder="https://youtube.com/watch?v=..."
                    value={ytPasteUrl} onChange={e=>setYtPasteUrl(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&addYtUrl()} />
                  <button className="sr-btn sr-btn-ghost sr-btn-sm" type="button"
                    onClick={async()=>{const t=await navigator.clipboard.readText().catch(()=>"");if(t)setYtPasteUrl(t);}}>
                    📋 Beilleszt
                  </button>
                </div>
                <button className="sr-btn sr-btn-primary" type="button" style={{justifyContent:"center"}}
                  disabled={ytFetching||!ytPasteUrl.trim()} onClick={addYtUrl}>
                  {ytFetching?"⏳ Betöltés…":"＋ Hozzáadás"}
                </button>
              </div>
            )}

            {/* Drive tab */}
            {plTab === "gdrive" && (
              <div style={{padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
                <div style={{fontSize:12,color:"var(--sl-muted)"}}>
                  Google Drive fájl vagy mappa linkjét illeszd be. Hangfájlokat automatikusan listázza.
                </div>
                <div style={{display:"flex",gap:8}}>
                  <input className="sr-input" style={{flex:1}} placeholder="https://drive.google.com/..."
                    value={driveUrl} onChange={e=>setDriveUrl(e.target.value)} />
                  <button className="sr-btn sr-btn-ghost sr-btn-sm" type="button"
                    onClick={async()=>{const t=await navigator.clipboard.readText().catch(()=>"");if(t)setDriveUrl(t);}}>
                    📋
                  </button>
                </div>
                <button className="sr-btn sr-btn-primary sr-btn-sm" type="button" style={{justifyContent:"center"}}
                  disabled={driveFetching||!driveUrl.trim()} onClick={fetchDrive}>
                  {driveFetching?"⏳ Betöltés…":"🔍 Fájlok lekérése"}
                </button>
                {driveFiles.length > 0 && (
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <div style={{fontSize:12,fontWeight:700,color:"var(--sl-muted)"}}>{driveFiles.length} hangfájl találva:</div>
                    {driveFiles.map((f,i) => (
                      <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 10px",border:"1px solid var(--sl-border)",borderRadius:10,background:"var(--sl-bg)"}}>
                        <span style={{flex:1,fontSize:13,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>🎵 {f.name}</span>
                        {f.durationSec && <span style={{fontSize:11,color:"var(--sl-muted)"}}>{fmtDuration(f.durationSec)}</span>}
                        <button className="sr-btn sr-btn-primary sr-btn-sm" type="button" onClick={()=>addDriveFile(f)}>＋</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Összesítő + Összeállít */}
            {plItems.filter(i=>i.status==="ready").length > 0 && (
              <>
                <div className="sr-total-bar">
                  <span>📋 {plItems.filter(i=>i.status==="ready").length} dal • Teljes hossz:</span>
                  <span>{fmtDuration(plTotalSec)}</span>
                </div>
                <div style={{padding:"10px 14px",display:"flex",gap:8,alignItems:"center"}}>
                  <input className="sr-input" style={{flex:1}} placeholder="Összeállítás neve (pl. Szünet – dec. 5.)"
                    value={plName} onChange={e=>setPlName(e.target.value)} />
                  <button className="sr-btn sr-btn-primary" type="button" disabled={plBusy} onClick={buildPlaylist}>
                    {plBusy?"⏳ Épül…":"🔨 Összeállít"}
                  </button>
                </div>
              </>
            )}

            {/* Kész összeállítás */}
            {plBuiltUrl && plBuiltName && (
              <div className="sr-built-result">
                <div style={{fontSize:13,fontWeight:800,color:"#15803d"}}>✅ {plBuiltName} – elkészült!</div>
                <audio controls src={plBuiltUrl} style={{width:"100%",height:32,borderRadius:8}} preload="metadata" />
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <a href={plBuiltUrl} download={plBuiltName+".mp3"} className="sr-btn sr-btn-ghost sr-btn-sm">⬇ Letöltés</a>
                  {plBuiltFileId && (
                    <button className="sr-btn sr-btn-primary sr-btn-sm" type="button"
                      onClick={()=>{setFormFileId(plBuiltFileId);setFormOpen(true);}}>
                      📅 Ütemezés
                    </button>
                  )}
                  <button className="sr-btn sr-btn-ghost sr-btn-sm" type="button"
                    onClick={()=>{setPlBuiltUrl(null);setPlBuiltFileId(null);setPlItems([]);setPlName("");}}>
                    🔄 Új összeállítás
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Ütemezés form */}
          {formOpen && (
            <div className="sr-panel">
              <div className="sr-panel-hdr">
                <div className="sr-panel-title">📅 Új ütemezés</div>
                <button className="sr-btn sr-btn-ghost sr-btn-sm" type="button"
                  onClick={()=>{setFormOpen(false);setFormError(null);}}>✕</button>
              </div>
              <div className="sr-form">
                {formError && <div className="sr-alert sr-alert-error"><span>⚠️</span>{formError}</div>}
                <div>
                  <label className="sr-label">Hangfájl</label>
                  <select className="sr-select" value={formFileId} onChange={e=>setFormFileId(e.target.value)}>
                    <option value="">Válassz hangfájlt…</option>
                    {files.map(f => <option key={f.id} value={f.id}>{f.originalName} ({fmtDuration(f.durationSec)})</option>)}
                  </select>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <div>
                    <label className="sr-label">Dátum</label>
                    <input type="date" className="sr-input" value={formDate}
                      min={new Date().toISOString().slice(0,10)} onChange={e=>setFormDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="sr-label">Kezdési idő</label>
                    <input type="time" className="sr-input" value={formTime} onChange={e=>setFormTime(e.target.value)} />
                  </div>
                </div>
                {formDate && formTime && previewFile && (
                  <div className="sr-time-preview">
                    <span>⏰</span>
                    <div>
                      <div style={{fontWeight:800}}>{formDate} {formTime}{previewEnd&&<span style={{color:"#475569"}}> → {previewEnd}</span>}</div>
                      <div style={{fontSize:11,color:"#475569",marginTop:2}}>Hossz: {fmtDuration(previewFile.durationSec)}</div>
                    </div>
                  </div>
                )}
                <div>
                  <div className="sr-label">Lejátszó eszközök</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                    {(["ALL","DEVICE","GROUP"] as const).map(t => (
                      <div key={t} className={`sr-chip${formTarget===t?" active":""}`}
                        onClick={()=>{setFormTarget(t);setFormTargetId("");}}>
                        {t==="ALL"?"📡 Összes":t==="DEVICE"?"🔊 Egyedi":"👥 Csoport"}
                      </div>
                    ))}
                  </div>
                  {formTarget==="DEVICE" && (
                    <div className="sr-device-list">
                      {devices.length===0
                        ? <div style={{fontSize:13,color:"var(--sl-muted)",padding:8}}>Nincs elérhető eszköz</div>
                        : devices.map(d => (
                          <div key={d.id} className={`sr-device-item${formTargetId===d.id?" sel":""}`}
                            onClick={()=>setFormTargetId(formTargetId===d.id?"":d.id)}>
                            <span className={d.online?"sr-dot-on":"sr-dot-off"} />
                            <span style={{fontSize:13.5,fontWeight:600}}>{d.name}</span>
                            <span style={{fontSize:11,color:"var(--sl-muted)",marginLeft:"auto"}}>{d.deviceClass}</span>
                          </div>
                        ))}
                    </div>
                  )}
                  {formTarget==="GROUP" && (
                    <select className="sr-select" value={formTargetId} onChange={e=>setFormTargetId(e.target.value)}>
                      <option value="">Válassz csoportot…</option>
                      {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  )}
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button className="sr-btn sr-btn-ghost" type="button"
                    onClick={()=>{setFormOpen(false);setFormError(null);}} disabled={formBusy}>Mégse</button>
                  <button className="sr-btn sr-btn-primary" type="button"
                    onClick={()=>void submitSchedule()} disabled={formBusy}>
                    {formBusy?"⏳ Mentés…":"📅 Ütemezés hozzáadása"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ═══ JOBB PANEL: Ütemezések ═══ */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>

          {/* Közelgő lejátszások */}
          <div className="sr-panel">
            <div className="sr-panel-hdr">
              <div className="sr-panel-title">⏰ Közelgő lejátszások</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:12,color:"var(--sl-muted)"}}>{upcomingSchedules.length} aktív</span>
                <button className="sr-btn sr-btn-primary sr-btn-sm" type="button"
                  onClick={()=>{setFormOpen(true);setFormDate(new Date().toISOString().slice(0,10));}}>
                  ＋ Új ütemezés
                </button>
              </div>
            </div>

            {upcomingSchedules.length === 0 ? (
              <div className="sr-empty">
                <div className="sr-empty-icon">⏰</div>
                <div style={{fontSize:13,fontWeight:700}}>Nincs közelgő lejátszás</div>
              </div>
            ) : upcomingSchedules.map(s => {
              const endTime = addSeconds(s.scheduledAt, s.radioFile.durationSec);
              const targetLabel = s.targetType==="ALL"?"📡 Összes":s.targetType==="DEVICE"?"🔊 Egyedi":"👥 Csoport";
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
                      {s.radioFile.durationSec && <span style={{color:"var(--sl-muted)",fontWeight:400}}> · {fmtDuration(s.radioFile.durationSec)}</span>}
                    </div>
                    <div className="sr-sched-target">{targetLabel}</div>
                  </div>
                  <button className="sr-btn sr-btn-danger sr-btn-sm" type="button"
                    onClick={()=>void deleteSchedule(s.id)}>🗑</button>
                </div>
              );
            })}
          </div>

          {/* Korábbi lejátszások */}
          <div className="sr-panel">
            <div className="sr-panel-hdr">
              <div className="sr-panel-title">🕐 Korábbi lejátszások</div>
              <span style={{fontSize:12,color:"var(--sl-muted)"}}>utolsó 30</span>
            </div>
            {pastSchedules.length === 0 ? (
              <div className="sr-empty">
                <div className="sr-empty-icon">🕐</div>
                <div style={{fontSize:13,fontWeight:700}}>Még nem volt lejátszás</div>
              </div>
            ) : pastSchedules.map(s => {
              const badge = STATUS_BADGE[s.status] ?? STATUS_BADGE.PENDING;
              const endTime = addSeconds(s.scheduledAt, s.radioFile.durationSec);
              const targetLabel = s.targetType==="ALL"?"📡 Összes":s.targetType==="DEVICE"?"🔊 Egyedi":"👥 Csoport";
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
                      {s.radioFile.durationSec && <span style={{color:"var(--sl-muted)",fontWeight:400}}> · {fmtDuration(s.radioFile.durationSec)}</span>}
                    </div>
                    <div className="sr-sched-target">{targetLabel}</div>
                  </div>
                  <button className="sr-btn sr-btn-primary sr-btn-sm" type="button" title="Újraütemezés"
                    onClick={()=>{setFormFileId(s.radioFileId);setFormOpen(true);}}>
                    🔁 Újra
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}