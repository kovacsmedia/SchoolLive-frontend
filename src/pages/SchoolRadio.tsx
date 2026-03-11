// src/pages/SchoolRadio.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

// ─── Típusok ──────────────────────────────────────────────────────────────
type RadioFile = {
  id:           string;
  originalName: string;
  filename:     string;
  sizeBytes:    number;
  durationSec:  number | null;
  fileUrl:      string;
  createdAt:    string;
  createdBy:    { id: string; displayName: string | null; email: string };
  _count:       { schedules: number };
};
type RadioSchedule = {
  id:          string;
  radioFileId: string;
  targetType:  string;
  targetId:    string | null;
  scheduledAt: string;
  status:      "PENDING" | "DISPATCHED" | "CANCELLED";
  dispatchedAt:string | null;
  createdAt:   string;
  radioFile:   { id: string; originalName: string; durationSec: number | null; fileUrl: string };
};
type Device      = { id: string; name: string; online: boolean; deviceClass: string };
type DeviceGroup = { id: string; name: string };

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
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("hu-HU", {
    year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"
  });
}
function addSeconds(iso: string, sec: number | null | undefined): string | null {
  if (!sec) return null;
  return new Date(new Date(iso).getTime() + sec * 1000).toLocaleTimeString("hu-HU", {
    hour:"2-digit", minute:"2-digit"
  });
}
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfWeek(year: number, month: number) {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1; // Hétfőtől kezdve
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
const MONTH_NAMES = ["Január","Február","Március","Április","Május","Június",
                     "Július","Augusztus","Szeptember","Október","November","December"];
const DAY_NAMES   = ["H","K","Sze","Cs","P","Szo","V"];

const STATUS_BADGE: Record<string,{bg:string;color:string;label:string}> = {
  PENDING:    {bg:"#eff6ff",  color:"#1d4ed8", label:"Vár"},
  DISPATCHED: {bg:"#f0fdf4",  color:"#15803d", label:"Elküldve"},
  CANCELLED:  {bg:"#fef2f2",  color:"#dc2626", label:"Törölve"},
};

// ─── CSS ──────────────────────────────────────────────────────────────────
const CSS = `
  .sr-page{font-family:'Nunito','Segoe UI',sans-serif;max-width:1200px}
  .sr-hdr{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:24px;flex-wrap:wrap}
  .sr-title{font-size:22px;font-weight:900;color:var(--sl-text);letter-spacing:-0.5px}
  .sr-subtitle{font-size:13px;color:var(--sl-muted);margin-top:3px}
  .sr-layout{display:grid;grid-template-columns:400px 1fr;gap:20px;align-items:start}
  .sr-panel{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(59,130,246,0.07)}
  .sr-panel-hdr{padding:14px 18px;border-bottom:1px solid var(--sl-border);display:flex;align-items:center;justify-content:space-between;gap:10px}
  .sr-panel-title{font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.6px;color:var(--sl-muted);font-family:'Nunito',sans-serif}
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
    padding:28px 20px;text-align:center;cursor:pointer;
    transition:all 0.2s;background:var(--sl-bg);
  }
  .sr-upload-zone:hover,.sr-upload-zone.drag{border-color:#3b82f6;background:#eff6ff}
  .sr-upload-icon{font-size:36px;margin-bottom:8px}
  .sr-upload-txt{font-size:14px;font-weight:700;color:var(--sl-text-2)}
  .sr-upload-sub{font-size:12px;color:var(--sl-muted);margin-top:4px}
  .sr-upload-progress{height:4px;background:var(--sl-border);border-radius:99px;overflow:hidden;margin:12px 16px 0}
  .sr-upload-bar{height:100%;background:linear-gradient(90deg,#3b82f6,#6366f1);border-radius:99px;transition:width 0.3s}

  /* File list */
  .sr-file-item{
    padding:12px 16px;border-bottom:1px solid var(--sl-border);
    transition:background 0.12s;cursor:pointer;
  }
  .sr-file-item:last-child{border-bottom:none}
  .sr-file-item:hover{background:rgba(59,130,246,0.03)}
  .sr-file-item.selected{background:linear-gradient(135deg,#eff6ff,#f5f3ff)}
  .sr-file-name{font-size:13.5px;font-weight:700;color:var(--sl-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
  .sr-file-meta{font-size:11px;color:var(--sl-muted);display:flex;gap:10px;margin-top:3px;flex-wrap:wrap}
  .sr-file-actions{display:flex;gap:6px;align-items:center;flex-shrink:0}

  /* Audio player */
  .sr-player{margin:12px 16px;background:var(--sl-bg);border:1px solid var(--sl-border);border-radius:12px;padding:12px 14px}
  .sr-player-name{font-size:12.5px;font-weight:800;color:var(--sl-text);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sr-player audio{width:100%;height:32px;border-radius:8px;accent-color:#3b82f6}
  .sr-player-dur{font-size:11px;color:var(--sl-muted);margin-top:5px;text-align:right}

  /* Calendar */
  .sr-cal{padding:16px}
  .sr-cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
  .sr-cal-month{font-size:15px;font-weight:900;color:var(--sl-text);font-family:'Nunito',sans-serif}
  .sr-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
  .sr-cal-dow{font-size:10px;font-weight:800;text-transform:uppercase;color:var(--sl-muted);text-align:center;padding:4px 0;letter-spacing:0.5px}
  .sr-cal-day{
    aspect-ratio:1;border-radius:10px;display:flex;flex-direction:column;
    align-items:center;justify-content:flex-start;padding:5px 3px;
    font-size:12px;font-weight:700;color:var(--sl-text-2);cursor:pointer;
    transition:all 0.15s;position:relative;border:1.5px solid transparent;
    min-height:44px;
  }
  .sr-cal-day:hover{background:var(--sl-bg);border-color:var(--sl-border)}
  .sr-cal-day.today{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
  .sr-cal-day.selected{background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;border-color:transparent}
  .sr-cal-day.other-month{opacity:0.35}
  .sr-cal-day.has-events .sr-cal-dots{display:flex;gap:2px;margin-top:2px}
  .sr-cal-dot{width:5px;height:5px;border-radius:50%;background:#6366f1;flex-shrink:0}
  .sr-cal-dot.dispatched{background:#22c55e}
  .sr-cal-day.selected .sr-cal-dot{background:rgba(255,255,255,0.8)}

  /* Schedule list */
  .sr-sched-item{
    padding:12px 16px;border-bottom:1px solid var(--sl-border);
    display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;
  }
  .sr-sched-item:last-child{border-bottom:none}
  .sr-sched-time{font-size:15px;font-weight:900;color:var(--sl-text);font-family:'Nunito',sans-serif}
  .sr-sched-end{font-size:12px;color:var(--sl-muted)}
  .sr-sched-file{font-size:12.5px;font-weight:700;color:var(--sl-text-2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
  .sr-sched-target{font-size:11px;color:var(--sl-muted);margin-top:2px}
  .sr-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;border:1px solid;font-family:'Nunito',sans-serif}

  /* Schedule form */
  .sr-form{padding:16px;display:flex;flex-direction:column;gap:14px}
  .sr-label{display:block;font-size:11.5px;font-weight:800;color:var(--sl-text-2);margin-bottom:5px;letter-spacing:0.3px;text-transform:uppercase;font-family:'Nunito',sans-serif}
  .sr-input,.sr-select{width:100%;padding:9px 12px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg);color:var(--sl-text);font-size:13.5px;outline:none;transition:all 0.15s;font-family:inherit}
  .sr-input:focus,.sr-select:focus{border-color:#3b82f6;background:var(--sl-surface);box-shadow:0 0 0 3px rgba(59,130,246,0.11)}
  .sr-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:20px;border:1.5px solid var(--sl-border);background:var(--sl-bg);font-size:13px;font-weight:600;font-family:'Nunito',sans-serif;color:var(--sl-text-2);cursor:pointer;transition:all 0.15s}
  .sr-chip.active{background:linear-gradient(135deg,#eff6ff,#f5f3ff);border-color:#bfdbfe;color:#1d4ed8;font-weight:800}
  .sr-chip:hover:not(.active){border-color:#bfdbfe;color:var(--sl-text)}
  .sr-device-list{display:flex;flex-direction:column;gap:4px;max-height:150px;overflow-y:auto;padding:6px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg)}
  .sr-device-item{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:9px;cursor:pointer;transition:background 0.12s;border:1.5px solid transparent}
  .sr-device-item:hover{background:var(--sl-border)}
  .sr-device-item.sel{background:#eff6ff;border-color:#bfdbfe}
  .sr-dot-on{width:6px;height:6px;border-radius:50%;background:#22c55e;flex-shrink:0}
  .sr-dot-off{width:6px;height:6px;border-radius:50%;background:#94a3b8;flex-shrink:0}
  .sr-time-preview{background:linear-gradient(135deg,#eff6ff,#f5f3ff);border:1px solid #bfdbfe;border-radius:11px;padding:10px 14px;font-size:13px;color:#1d4ed8;display:flex;align-items:center;gap:10px}
  .sr-empty{text-align:center;padding:40px 20px;color:var(--sl-muted)}
  .sr-empty-icon{font-size:36px;margin-bottom:10px}

  @media(max-width:900px){
    .sr-layout{grid-template-columns:1fr}
  }
`;

// ═══════════════════════════════════════════════════════════════════════════
// Fő komponens
// ═══════════════════════════════════════════════════════════════════════════
export default function SchoolRadio() {
  const { state } = useAuth();


  // ── Állapot ──────────────────────────────────────────────────────────────
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

  // Kiválasztott fájl + lejátszó
  const [selectedFile, setSelectedFile] = useState<RadioFile|null>(null);

  // Naptár
  const today     = new Date();
  const [calYear,  setCalYear]  = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [selDay,   setSelDay]   = useState<Date|null>(null);

  // Ütemezés form
  const [formOpen,     setFormOpen]     = useState(false);
  const [formFileId,   setFormFileId]   = useState("");
  const [formDate,     setFormDate]     = useState("");
  const [formTime,     setFormTime]     = useState("");
  const [formTarget,   setFormTarget]   = useState<"ALL"|"DEVICE"|"GROUP">("ALL");
  const [formTargetId, setFormTargetId] = useState("");
  const [formBusy,     setFormBusy]     = useState(false);
  const [formError,    setFormError]    = useState<string|null>(null);
  const [, setFormConflict] = useState<any>(null);

  // ── Betöltés ─────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [filesRes, schedsRes, targetsRes, ytRes] = await Promise.all([
        apiFetch<{ok:boolean;files:RadioFile[]}>("/radio/files"),
        apiFetch<{ok:boolean;schedules:RadioSchedule[]}>("/radio/schedules"),
        apiFetch<{ok:boolean;devices:Device[];groups:DeviceGroup[]}>("/radio/targets"),
        apiFetch<{ok:boolean;playlists:YtPlaylist[]}>("/radio/ytplaylists").catch(() => ({ ok:false, playlists:[] })),
      ]);
      setFiles(filesRes.files ?? []);
      setSchedules(schedsRes.schedules ?? []);
      setDevices(targetsRes.devices ?? []);
      setGroups(targetsRes.groups ?? []);
      setYtPlaylists((ytRes as any)?.playlists ?? []);
    } catch (e:any) {
      setError(e?.message ?? "Betöltés sikertelen");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ── Upload ────────────────────────────────────────────────────────────────
  async function handleUpload(file: File) {
    if (!file) return;
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
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadPct(Math.round(e.loaded/e.total*100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(JSON.parse(xhr.responseText)?.error ?? `HTTP ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Hálózati hiba"));

        // JWT token
        const token = (state as any).token ?? localStorage.getItem("token") ?? "";
        const tenantId = sessionStorage.getItem("activeTenantId") ?? "";

        xhr.open("POST", `${import.meta.env.VITE_API_URL ?? "https://api.schoollive.hu"}/radio/files`);
        if (token)    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        if (tenantId) xhr.setRequestHeader("x-tenant-id", tenantId);
        xhr.send(formData);
      });
      await loadAll();
    } catch (e:any) {
      setError("Feltöltés sikertelen: " + e.message);
    } finally {
      setUploading(false); setUploadPct(0);
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void handleUpload(f);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleUpload(f);
  }

  // ── Fájl törlés ───────────────────────────────────────────────────────────
  async function deleteFile(file: RadioFile) {
    const schedCount = file._count.schedules;
    const warn = schedCount > 0
      ? `⚠️ Ezzel ${schedCount} ütemezés IS TÖRLŐDIK!\n\nBiztos törlöd: "${file.originalName}"?`
      : `Törlöd: "${file.originalName}"?`;
    if (!window.confirm(warn)) return;
    try {
      await apiFetch(`/radio/files/${file.id}`, { method: "DELETE" });
      if (selectedFile?.id === file.id) setSelectedFile(null);
      await loadAll();
    } catch (e:any) { setError(e?.message ?? "Törlés sikertelen"); }
  }

  // ── Ütemezés törlés ───────────────────────────────────────────────────────
  async function deleteSchedule(id: string) {
    if (!window.confirm("Törlöd ezt az ütemezést?")) return;
    try {
      await apiFetch(`/radio/schedules/${id}`, { method: "DELETE" });
      await loadAll();
    } catch (e:any) { setError(e?.message ?? "Törlés sikertelen"); }
  }

  // ── Ütemezés létrehozás ───────────────────────────────────────────────────
  async function submitSchedule() {
    setFormError(null); setFormConflict(null);
    if (!formFileId) { setFormError("Válassz hangfájlt!"); return; }
    if (!formDate || !formTime) { setFormError("Adj meg dátumot és időt!"); return; }
    if (formTarget !== "ALL" && !formTargetId) { setFormError("Válassz célt!"); return; }

    const scheduledAt = new Date(`${formDate}T${formTime}:00`);
    if (isNaN(scheduledAt.getTime())) { setFormError("Érvénytelen dátum/idő"); return; }
    if (scheduledAt < new Date()) { setFormError("Az időpont a múltban van!"); return; }

    setFormBusy(true);
    try {
      await apiFetch("/radio/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          radioFileId: formFileId,
          targetType:  formTarget,
          targetId:    formTarget === "ALL" ? null : formTargetId,
          scheduledAt: scheduledAt.toISOString(),
        }),
      });
      setFormOpen(false);
      setFormDate(""); setFormTime(""); setFormTargetId("");
      await loadAll();
    } catch (e:any) {
      const data = e?.data ?? {};
      if (data?.conflict) {
        setFormConflict(data.conflict);
        setFormError(`Időütközés: "${data.conflict.originalName}" ${fmtDateTime(data.conflict.scheduledAt)} körül már foglalt`);
      } else {
        setFormError(e?.message ?? "Létrehozás sikertelen");
      }
    } finally {
      setFormBusy(false);
    }
  }

  // ── Naptár logika ─────────────────────────────────────────────────────────
  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y-1); setCalMonth(11); }
    else setCalMonth(m => m-1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y+1); setCalMonth(0); }
    else setCalMonth(m => m+1);
  }

  const daysInMonth  = getDaysInMonth(calYear, calMonth);
  const firstDow     = getFirstDayOfWeek(calYear, calMonth);
  const prevDays     = getDaysInMonth(calYear, calMonth === 0 ? 11 : calMonth - 1);

  // Ütemezések napok szerint
  const schedByDay = new Map<string, RadioSchedule[]>();
  for (const s of schedules) {
    const d = new Date(s.scheduledAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!schedByDay.has(key)) schedByDay.set(key, []);
    schedByDay.get(key)!.push(s);
  }

  // Kiválasztott nap ütemezései
  const selDaySchedules = selDay
    ? (schedByDay.get(`${selDay.getFullYear()}-${selDay.getMonth()}-${selDay.getDate()}`) ?? [])
        .sort((a,b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    : [];

  // Kiválasztott fájl adatai a time preview-hoz
  const previewFile = files.find(f => f.id === formFileId);
  const previewEnd  = (formDate && formTime && previewFile?.durationSec)
    ? addSeconds(`${formDate}T${formTime}:00`, previewFile.durationSec)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="sr-page">
      <style>{CSS}</style>

      <div className="sr-hdr">
        <div>
          <div className="sr-title">📻 Iskolai Rádió</div>
          <div className="sr-subtitle">Hanganyag feltöltése és ütemezett lejátszása az épület hangszóróin.</div>
        </div>
        <button className="sr-btn sr-btn-primary" onClick={() => void loadAll()} disabled={loading} type="button">
          🔄 Frissítés
        </button>
      </div>

      {error && (
        <div className="sr-alert sr-alert-error">
          <span>⚠️</span><span>{error}</span>
          <button style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#dc2626"}} onClick={()=>setError(null)}>✕</button>
        </div>
      )}

      <div className="sr-layout">
        {/* ═══ BAL PANEL: Fájlkezelő ═══ */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

          {/* Upload */}
          <div className="sr-panel">
            <div className="sr-panel-hdr">
              <div className="sr-panel-title">🎵 Hangfájl könyvtár</div>
              <span style={{fontSize:12,color:"var(--sl-muted)"}}>max 200 MB</span>
            </div>

            <div
              className={`sr-upload-zone${drag?" drag":""}`}
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            >
              <input ref={fileInputRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac" style={{display:"none"}} onChange={onFileInput} disabled={uploading} />
              <div className="sr-upload-icon">{uploading ? "⏳" : "🎵"}</div>
              <div className="sr-upload-txt">
                {uploading ? `Feltöltés… ${uploadPct}%` : "Húzd ide a hangfájlt, vagy kattints"}
              </div>
              <div className="sr-upload-sub">MP3, WAV, OGG, M4A, AAC formátum</div>
            </div>

            {uploading && (
              <div className="sr-upload-progress">
                <div className="sr-upload-bar" style={{width:`${uploadPct}%`}} />
              </div>
            )}

            {/* Fájllista */}
            {files.length === 0 && !loading ? (
              <div className="sr-empty">
                <div className="sr-empty-icon">🎵</div>
                <div style={{fontSize:14,fontWeight:700}}>Még nincs feltöltött hangfájl</div>
              </div>
            ) : (
              <div>
                {files.map(f => (
                  <div
                    key={f.id}
                    className={`sr-file-item${selectedFile?.id===f.id?" selected":""}`}
                    onClick={() => setSelectedFile(selectedFile?.id===f.id ? null : f)}
                  >
                    <div style={{display:"flex",alignItems:"center",gap:10,justifyContent:"space-between"}}>
                      <div style={{minWidth:0}}>
                        <div className="sr-file-name" title={f.originalName}>🎵 {f.originalName}</div>
                        <div className="sr-file-meta">
                          <span>⏱ {fmtDuration(f.durationSec)}</span>
                          <span>💾 {fmtSize(f.sizeBytes)}</span>
                          {f._count.schedules > 0 && (
                            <span style={{color:"#6366f1"}}>📅 {f._count.schedules} ütemezés</span>
                          )}
                        </div>
                      </div>
                      <div className="sr-file-actions" onClick={e => e.stopPropagation()}>
                        <button
                          className="sr-btn sr-btn-primary sr-btn-sm"
                          onClick={() => { setFormFileId(f.id); setFormOpen(true); }}
                          title="Ütemezés hozzáadása"
                          type="button"
                        >📅</button>
                        <button
                          className="sr-btn sr-btn-danger sr-btn-sm"
                          onClick={() => void deleteFile(f)}
                          title="Törlés"
                          type="button"
                        >🗑</button>
                      </div>
                    </div>

                    {/* Beépített lejátszó */}
                    {selectedFile?.id === f.id && (
                      <div className="sr-player" onClick={e => e.stopPropagation()}>
                        <div className="sr-player-name">▶ {f.originalName}</div>
                        <audio controls src={f.fileUrl} preload="metadata" style={{width:"100%",height:32}} />
                        {f.durationSec && (
                          <div className="sr-player-dur">Hossz: {fmtDuration(f.durationSec)}</div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ═══ YouTube lejátszási listák ═══ */}
          <div className="sr-panel">
            <div className="sr-panel-hdr">
              <div className="sr-panel-title">▶️ YouTube lejátszási listák</div>
              <button className="sr-btn sr-btn-primary" style={{padding:"5px 12px",fontSize:12}} onClick={()=>{setYtOpen("new");setYtName("");setYtItems([{url:"",title:""}]);setYtError(null);}} type="button">＋ Új lista</button>
            </div>
            <div style={{padding:"10px 14px",display:"flex",flexDirection:"column",gap:8}}>
              {ytError && <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"8px 12px",fontSize:12,color:"#dc2626"}}>⚠️ {ytError}</div>}

              {ytPlaylists.length === 0 && ytOpen !== "new" && (
                <div style={{textAlign:"center",padding:"24px 0",color:"var(--sl-muted)",fontSize:13}}>
                  <div style={{fontSize:32,marginBottom:8}}>▶️</div>
                  Még nincs YouTube lista. Hozz létre egyet!
                </div>
              )}

              {/* Meglévő listák */}
              {ytPlaylists.map(pl => (
                <div key={pl.id} style={{border:"1px solid var(--sl-border)",borderRadius:12,overflow:"hidden"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:"var(--sl-bg)"}}>
                    <span style={{fontWeight:800,fontSize:13,flex:1,color:"var(--sl-text)"}}>{pl.name}</span>
                    <span className={`sr-yt-badge sr-yt-badge-${pl.status.toLowerCase()}`}>
                      {pl.status === "IDLE" && "⏸ Kész"}
                      {pl.status === "BUILDING" && "⏳ Épül…"}
                      {pl.status === "DONE" && "✅ Elkészült"}
                      {pl.status === "ERROR" && "❌ Hiba"}
                    </span>
                    <span style={{fontSize:11,color:"var(--sl-muted)"}}>{pl.items.length} dal</span>
                    {pl.status !== "BUILDING" && (
                      <button className="sr-btn sr-btn-ghost" style={{padding:"3px 9px",fontSize:11}} type="button"
                        onClick={()=>{setYtOpen(pl.id);setYtName(pl.name);setYtItems(pl.items.map(i=>({url:i.youtubeUrl,title:i.title??""}))||[{url:"",title:""}]);setYtError(null);}}>
                        ✏️
                      </button>
                    )}
                    {pl.status === "DONE" && pl.radioFileId && (
                      <button className="sr-btn sr-btn-primary" style={{padding:"3px 9px",fontSize:11}} type="button"
                        onClick={()=>{setFormFileId(pl.radioFileId!);setFormOpen(true);}}>
                        📅 Ütemez
                      </button>
                    )}
                    {(pl.status === "IDLE" || pl.status === "ERROR" || pl.status === "DONE") && (
                      <button className="sr-btn sr-btn-primary" style={{padding:"3px 9px",fontSize:11,background:"linear-gradient(135deg,#f59e0b,#f97316)"}} type="button"
                        onClick={async () => {
                          setYtBusy(pl.id); setYtError(null);
                          try {
                            await apiFetch(`/radio/ytplaylists/${pl.id}/build`, {method:"POST"});
                            // Polling indítása
                            const timer = setInterval(async () => {
                              try {
                                const s = await apiFetch<any>(`/radio/ytplaylists/${pl.id}/status`);
                                setYtPlaylists(prev => prev.map(p => p.id === pl.id ? {...p, status: s.status, errorMsg: s.errorMsg, radioFileId: s.radioFileId} : p));
                                if (s.status !== "BUILDING") {
                                  clearInterval(timer);
                                  setYtBusy(null);
                                  if (s.status === "DONE") void loadAll();
                                }
                              } catch { clearInterval(timer); setYtBusy(null); }
                            }, 3000);
                            setYtPollTimer(timer);
                          } catch(e:any) { setYtError(e?.message??"Build hiba"); setYtBusy(null); }
                        }}
                        disabled={ytBusy === pl.id}>
                        {ytBusy === pl.id ? "⏳ Épül…" : "🔨 Build"}
                      </button>
                    )}
                    <button className="sr-btn" style={{padding:"3px 9px",fontSize:11,background:"#fef2f2",border:"1px solid #fecaca",color:"#dc2626",borderRadius:8}} type="button"
                      onClick={async ()=>{
                        if (!window.confirm(`Törlöd: ${pl.name}?`)) return;
                        try { await apiFetch(`/radio/ytplaylists/${pl.id}`,{method:"DELETE"}); void loadAll(); }
                        catch(e:any){setYtError(e?.message??"Törlés sikertelen");}
                      }}>🗑</button>
                  </div>
                  {pl.status === "ERROR" && pl.errorMsg && (
                    <div style={{padding:"6px 14px",fontSize:11,color:"#dc2626",background:"#fef2f2",borderTop:"1px solid #fecaca"}}>⚠️ {pl.errorMsg}</div>
                  )}
                  {/* Szerkesztő */}
                  {ytOpen === pl.id && (
                    <div style={{padding:"12px 14px",borderTop:"1px solid var(--sl-border)",display:"flex",flexDirection:"column",gap:10}}>
                      <div>
                        <label className="sr-label">Lista neve</label>
                        <input className="sr-input" value={ytName} onChange={e=>setYtName(e.target.value)} placeholder="pl. Reggeli zene" />
                      </div>
                      <div>
                        <label className="sr-label">YouTube linkek</label>
                        {ytItems.map((item,i)=>(
                          <div key={i} className="sr-yt-item">
                            <span style={{fontSize:11,color:"var(--sl-muted)",minWidth:18,textAlign:"right"}}>{i+1}.</span>
                            <input className="sr-yt-url" value={item.url} onChange={e=>setYtItems(prev=>prev.map((x,j)=>j===i?{...x,url:e.target.value}:x))} placeholder="https://youtube.com/watch?v=..." />
                            <input className="sr-yt-url" style={{maxWidth:160}} value={item.title} onChange={e=>setYtItems(prev=>prev.map((x,j)=>j===i?{...x,title:e.target.value}:x))} placeholder="Cím (opcionális)" />
                            <button type="button" style={{background:"none",border:"none",cursor:"pointer",color:"#dc2626",fontSize:16}} onClick={()=>setYtItems(prev=>prev.filter((_,j)=>j!==i))}>✕</button>
                          </div>
                        ))}
                        <button className="sr-btn sr-btn-ghost" style={{padding:"5px 12px",fontSize:12,marginTop:4}} type="button" onClick={()=>setYtItems(prev=>[...prev,{url:"",title:""}])}>＋ Link hozzáadása</button>
                      </div>
                      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                        <button className="sr-btn sr-btn-ghost" style={{padding:"5px 12px",fontSize:12}} type="button" onClick={()=>setYtOpen(null)}>Mégse</button>
                        <button className="sr-btn sr-btn-primary" style={{padding:"5px 12px",fontSize:12}} type="button" onClick={async()=>{
                          const validItems = ytItems.filter(i=>i.url.trim());
                          if (!ytName.trim()||validItems.length===0){setYtError("Adj meg nevet és legalább egy linket!");return;}
                          setYtBusy(pl.id);
                          try {
                            await apiFetch(`/radio/ytplaylists/${pl.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},
                              body:JSON.stringify({name:ytName.trim(),items:validItems.map(i=>({youtubeUrl:i.url.trim(),title:i.title.trim()||null}))})});
                            setYtOpen(null); void loadAll();
                          } catch(e:any){setYtError(e?.message??"Mentés sikertelen");} finally{setYtBusy(null);}
                        }}>💾 Mentés</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Új lista form */}
              {ytOpen === "new" && (
                <div style={{border:"1.5px solid #3b82f6",borderRadius:12,padding:"14px",display:"flex",flexDirection:"column",gap:10}}>
                  <div>
                    <label className="sr-label">Lista neve *</label>
                    <input className="sr-input" value={ytName} onChange={e=>setYtName(e.target.value)} placeholder="pl. Reggeli zene" />
                  </div>
                  <div>
                    <label className="sr-label">YouTube linkek *</label>
                    {ytItems.map((item,i)=>(
                      <div key={i} className="sr-yt-item">
                        <span style={{fontSize:11,color:"var(--sl-muted)",minWidth:18,textAlign:"right"}}>{i+1}.</span>
                        <input className="sr-yt-url" value={item.url} onChange={e=>setYtItems(prev=>prev.map((x,j)=>j===i?{...x,url:e.target.value}:x))} placeholder="https://youtube.com/watch?v=..." />
                        <input className="sr-yt-url" style={{maxWidth:160}} value={item.title} onChange={e=>setYtItems(prev=>prev.map((x,j)=>j===i?{...x,title:e.target.value}:x))} placeholder="Cím (opcionális)" />
                        {ytItems.length>1 && <button type="button" style={{background:"none",border:"none",cursor:"pointer",color:"#dc2626",fontSize:16}} onClick={()=>setYtItems(prev=>prev.filter((_,j)=>j!==i))}>✕</button>}
                      </div>
                    ))}
                    <button className="sr-btn sr-btn-ghost" style={{padding:"5px 12px",fontSize:12,marginTop:4}} type="button" onClick={()=>setYtItems(prev=>[...prev,{url:"",title:""}])}>＋ Link hozzáadása</button>
                  </div>
                  <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                    <button className="sr-btn sr-btn-ghost" style={{padding:"5px 12px",fontSize:12}} type="button" onClick={()=>setYtOpen(null)}>Mégse</button>
                    <button className="sr-btn sr-btn-primary" style={{padding:"5px 12px",fontSize:12}} type="button" onClick={async()=>{
                      const validItems = ytItems.filter(i=>i.url.trim());
                      if (!ytName.trim()||validItems.length===0){setYtError("Adj meg nevet és legalább egy linket!");return;}
                      setYtBusy("new");
                      try {
                        await apiFetch("/radio/ytplaylists",{method:"POST",headers:{"Content-Type":"application/json"},
                          body:JSON.stringify({name:ytName.trim(),items:validItems.map(i=>({youtubeUrl:i.url.trim(),title:i.title.trim()||null}))})});
                        setYtOpen(null); void loadAll();
                      } catch(e:any){setYtError(e?.message??"Létrehozás sikertelen");} finally{setYtBusy(null);}
                    }} disabled={ytBusy==="new"}>
                      {ytBusy==="new"?"⏳ Létrehozás…":"✅ Létrehoz"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Ütemezés form */}
          {formOpen && (
            <div className="sr-panel">
              <div className="sr-panel-hdr">
                <div className="sr-panel-title">📅 Új ütemezés</div>
                <button className="sr-btn sr-btn-ghost sr-btn-sm" onClick={() => { setFormOpen(false); setFormError(null); setFormConflict(null); }} type="button">✕</button>
              </div>
              <div className="sr-form">
                {formError && (
                  <div className="sr-alert sr-alert-error"><span>⚠️</span>{formError}</div>
                )}

                {/* Fájl választó */}
                <div>
                  <label className="sr-label">Hangfájl</label>
                  <select className="sr-select" value={formFileId} onChange={e => setFormFileId(e.target.value)}>
                    <option value="">Válassz hangfájlt…</option>
                    {files.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.originalName} ({fmtDuration(f.durationSec)})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Dátum + idő */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <div>
                    <label className="sr-label">Dátum</label>
                    <input type="date" className="sr-input"
                      value={formDate}
                      min={new Date().toISOString().slice(0,10)}
                      onChange={e => setFormDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="sr-label">Kezdési idő</label>
                    <input type="time" className="sr-input" value={formTime} onChange={e => setFormTime(e.target.value)} />
                  </div>
                </div>

                {/* Időpont előnézet */}
                {formDate && formTime && previewFile && (
                  <div className="sr-time-preview">
                    <span>⏰</span>
                    <div>
                      <div style={{fontWeight:800}}>
                        {formDate} {formTime}
                        {previewEnd && <span style={{color:"#475569"}}> → {previewEnd}</span>}
                      </div>
                      <div style={{fontSize:11,color:"#475569",marginTop:2}}>
                        Hossz: {fmtDuration(previewFile.durationSec)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Cél */}
                <div>
                  <div className="sr-label">Lejátszó eszközök</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                    {(["ALL","DEVICE","GROUP"] as const).map(t => (
                      <div key={t} className={`sr-chip${formTarget===t?" active":""}`}
                        onClick={() => { setFormTarget(t); setFormTargetId(""); }}>
                        {t==="ALL" ? "📡 Összes" : t==="DEVICE" ? "🔊 Egyedi" : "👥 Csoport"}
                      </div>
                    ))}
                  </div>
                  {formTarget === "DEVICE" && (
                    <div className="sr-device-list">
                      {devices.length === 0
                        ? <div style={{fontSize:13,color:"var(--sl-muted)",padding:8}}>Nincs elérhető eszköz</div>
                        : devices.map(d => (
                          <div key={d.id}
                            className={`sr-device-item${formTargetId===d.id?" sel":""}`}
                            onClick={() => setFormTargetId(d.id)}>
                            <span className={d.online?"sr-dot-on":"sr-dot-off"} />
                            <span style={{fontSize:13.5,fontWeight:600}}>{d.name}</span>
                            <span style={{fontSize:11,color:"var(--sl-muted)",marginLeft:"auto"}}>{d.deviceClass}</span>
                          </div>
                        ))
                      }
                    </div>
                  )}
                  {formTarget === "GROUP" && (
                    <select className="sr-select" value={formTargetId} onChange={e => setFormTargetId(e.target.value)}>
                      <option value="">Válassz csoportot…</option>
                      {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  )}
                </div>

                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button className="sr-btn sr-btn-ghost" onClick={() => { setFormOpen(false); setFormError(null); }} disabled={formBusy} type="button">Mégse</button>
                  <button className="sr-btn sr-btn-primary" onClick={() => void submitSchedule()} disabled={formBusy} type="button">
                    {formBusy ? "⏳ Mentés…" : "📅 Ütemezés hozzáadása"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ═══ JOBB PANEL: Naptár + ütemezések ═══ */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>

          {/* Naptár */}
          <div className="sr-panel">
            <div className="sr-panel-hdr">
              <div className="sr-panel-title">📅 Ütemezési naptár</div>
              <button
                className="sr-btn sr-btn-primary sr-btn-sm"
                onClick={() => { setFormOpen(true); if (selDay) setFormDate(selDay.toISOString().slice(0,10)); }}
                type="button"
              >＋ Új ütemezés</button>
            </div>

            <div className="sr-cal">
              {/* Navigáció */}
              <div className="sr-cal-nav">
                <button className="sr-btn sr-btn-ghost sr-btn-sm" onClick={prevMonth} type="button">←</button>
                <div className="sr-cal-month">{MONTH_NAMES[calMonth]} {calYear}</div>
                <button className="sr-btn sr-btn-ghost sr-btn-sm" onClick={nextMonth} type="button">→</button>
              </div>

              {/* Napok fejléce */}
              <div className="sr-cal-grid">
                {DAY_NAMES.map(d => (
                  <div key={d} className="sr-cal-dow">{d}</div>
                ))}

                {/* Előző hónap napjai */}
                {Array.from({length: firstDow}).map((_,i) => {
                  const day = prevDays - firstDow + i + 1;
                  return (
                    <div key={`prev-${i}`} className="sr-cal-day other-month">
                      <span>{day}</span>
                    </div>
                  );
                })}

                {/* Aktuális hónap napjai */}
                {Array.from({length: daysInMonth}).map((_,i) => {
                  const day  = i + 1;
                  const date = new Date(calYear, calMonth, day);
                  const key  = `${calYear}-${calMonth}-${day}`;
                  const daySched = schedByDay.get(key) ?? [];
                  const isToday  = isSameDay(date, today);
                  const isSel    = selDay ? isSameDay(date, selDay) : false;
                  const hasPending    = daySched.some(s => s.status === "PENDING");
                  const hasDispatched = daySched.some(s => s.status === "DISPATCHED");

                  return (
                    <div
                      key={day}
                      className={`sr-cal-day${isToday?" today":""}${isSel?" selected":""}${daySched.length>0?" has-events":""}`}
                      onClick={() => setSelDay(isSel ? null : date)}
                    >
                      <span>{day}</span>
                      {daySched.length > 0 && (
                        <div className="sr-cal-dots">
                          {hasPending    && <div className="sr-cal-dot" />}
                          {hasDispatched && <div className="sr-cal-dot dispatched" />}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Jelmagyarázat */}
              <div style={{display:"flex",gap:14,marginTop:12,padding:"0 4px",fontSize:11,color:"var(--sl-muted)"}}>
                <div style={{display:"flex",alignItems:"center",gap:5}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:"#6366f1"}} />Ütemezve
                </div>
                <div style={{display:"flex",alignItems:"center",gap:5}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:"#22c55e"}} />Elküldve
                </div>
              </div>
            </div>
          </div>

          {/* Kiválasztott nap ütemezései */}
          {selDay && (
            <div className="sr-panel">
              <div className="sr-panel-hdr">
                <div className="sr-panel-title">
                  {selDay.toLocaleDateString("hu-HU", {year:"numeric",month:"long",day:"numeric"})}
                </div>
                <button
                  className="sr-btn sr-btn-primary sr-btn-sm"
                  onClick={() => { setFormOpen(true); setFormDate(selDay.toISOString().slice(0,10)); }}
                  type="button"
                >＋ Hozzáad</button>
              </div>

              {selDaySchedules.length === 0 ? (
                <div className="sr-empty">
                  <div className="sr-empty-icon">📅</div>
                  <div style={{fontSize:13,fontWeight:700}}>Nincs ütemezés ezen a napon</div>
                </div>
              ) : (
                selDaySchedules.map(s => {
                  const badge = STATUS_BADGE[s.status] ?? STATUS_BADGE.PENDING;
                  const startTime = new Date(s.scheduledAt).toLocaleTimeString("hu-HU",{hour:"2-digit",minute:"2-digit"});
                  const endTime   = addSeconds(s.scheduledAt, s.radioFile.durationSec);
                  const targetLabel = s.targetType === "ALL" ? "📡 Összes eszköz"
                                    : s.targetType === "DEVICE" ? `🔊 ${s.targetId?.slice(0,8)}…`
                                    : `👥 Csoport`;
                  return (
                    <div key={s.id} className="sr-sched-item">
                      <div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span className="sr-sched-time">{startTime}</span>
                          {endTime && <span className="sr-sched-end">→ {endTime}</span>}
                          <span className="sr-badge" style={{background:badge.bg,color:badge.color,borderColor:badge.color+"33"}}>
                            {badge.label}
                          </span>
                        </div>
                        <div className="sr-sched-file" title={s.radioFile.originalName}>
                          🎵 {s.radioFile.originalName}
                          {s.radioFile.durationSec && <span style={{color:"var(--sl-muted)",fontWeight:400}}> · {fmtDuration(s.radioFile.durationSec)}</span>}
                        </div>
                        <div className="sr-sched-target">{targetLabel}</div>
                      </div>
                      {s.status === "PENDING" && (
                        <button
                          className="sr-btn sr-btn-danger sr-btn-sm"
                          onClick={() => void deleteSchedule(s.id)}
                          title="Ütemezés törlése"
                          type="button"
                        >🗑</button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Összes közelgő ütemezés */}
          <div className="sr-panel">
            <div className="sr-panel-hdr">
              <div className="sr-panel-title">⏰ Közelgő lejátszások</div>
              <span style={{fontSize:12,color:"var(--sl-muted)"}}>
                {schedules.filter(s => s.status==="PENDING").length} aktív
              </span>
            </div>
            {schedules.filter(s => s.status==="PENDING").slice(0,10).length === 0 ? (
              <div className="sr-empty">
                <div className="sr-empty-icon">⏰</div>
                <div style={{fontSize:13,fontWeight:700}}>Nincs közelgő lejátszás</div>
              </div>
            ) : (
              schedules
                .filter(s => s.status==="PENDING")
                .slice(0, 10)
                .map(s => {
                  const endTime = addSeconds(s.scheduledAt, s.radioFile.durationSec);
                  const targetLabel = s.targetType === "ALL" ? "📡 Összes" : s.targetType === "DEVICE" ? "🔊 Egyedi" : "👥 Csoport";
                  return (
                    <div key={s.id} className="sr-sched-item">
                      <div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span className="sr-sched-time">{fmtDateTime(s.scheduledAt)}</span>
                          {endTime && <span className="sr-sched-end">→ {endTime}</span>}
                        </div>
                        <div className="sr-sched-file">🎵 {s.radioFile.originalName}</div>
                        <div className="sr-sched-target">{targetLabel}</div>
                      </div>
                      <button
                        className="sr-btn sr-btn-danger sr-btn-sm"
                        onClick={() => void deleteSchedule(s.id)}
                        type="button"
                      >🗑</button>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}