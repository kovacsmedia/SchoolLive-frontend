import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

type DeviceClass = "SPEAKER" | "DISPLAY" | "MULTI";
type WifiSecurity = "OPEN" | "WPA2_PERSONAL" | "WPA3_PERSONAL" | "WPA2_ENTERPRISE";

type DeviceItem = {
  deviceId: string; name: string; deviceClass: DeviceClass;
  isOnline: boolean; ipAddress: string | null; firmwareVersion: string | null;
  secondsSinceLastSeen: number | null; isVirtualPlayer?: boolean;
  hwModel?: string | null;
  otaStatus?: string; otaProgress?: number; otaVersion?: string | null;
};
type HealthResponse = { ok: boolean; devices: DeviceItem[] };
type PendingDevice  = { id: string; mac: string; ipAddress: string | null; firmwareVersion: string | null; lastSeenAt: string };
type PendingResponse = { ok: boolean; pending: PendingDevice[] };
type TenantItem     = { id: string; name: string };
type TenantsResponse = { ok: boolean; tenants: TenantItem[] };

// ── OTA típusok ───────────────────────────────────────────────────────────────
type OtaStatus = "UP_TO_DATE"|"PENDING"|"DOWNLOADING"|"INSTALLING"|"FAILED"|"ROLLBACK";
type FirmwareRelease = {
  id:string; version:string; filename:string; fileUrl:string;
  sizeBytes:number; sha256:string; notes:string|null; mandatory:boolean;
  targetClass:string; createdAt:string;
  createdBy:{ email:string; displayName:string|null };
};

const HW_MODEL_OPTIONS = [
  { value:"ESP32_S3",         label:"ESP32-S3-N16R8",    icon:"🔧" },
  { value:"ESP32_WROOM",      label:"ESP32-WROOM-32",    icon:"🔧" },
  { value:"ESP32_S3_DISPLAY", label:"ESP32-S3 Kijelző",  icon:"🖥️" },
  { value:"ESP32_S3_MULTI",   label:"ESP32-S3 Multi",    icon:"🎛️" },
  { value:"VIRTUAL",          label:"Virtuális (WP)",    icon:"📱" },
];
const HW_MODEL_BADGE: Record<string,{bg:string;color:string;border:string}> = {
  ESP32_S3:         { bg:"#eff6ff", color:"#1d4ed8", border:"#bfdbfe" },
  ESP32_WROOM:      { bg:"#f5f3ff", color:"#7c3aed", border:"#ddd6fe" },
  ESP32_S3_DISPLAY: { bg:"#f0fdf4", color:"#15803d", border:"#bbf7d0" },
  ESP32_S3_MULTI:   { bg:"#fffbeb", color:"#d97706", border:"#fde68a" },
  VIRTUAL:          { bg:"#f8fafc", color:"#64748b", border:"#e2e8f0" },
};
const OTA_STATUS_BADGE: Record<OtaStatus,{bg:string;color:string;border:string;label:string;icon:string}> = {
  UP_TO_DATE:  { bg:"#f0fdf4", color:"#15803d", border:"#bbf7d0", label:"Naprakész",     icon:"✅" },
  PENDING:     { bg:"#fffbeb", color:"#d97706", border:"#fde68a", label:"Frissítés vár", icon:"⏳" },
  DOWNLOADING: { bg:"#eff6ff", color:"#1d4ed8", border:"#bfdbfe", label:"Letöltés…",    icon:"⬇️" },
  INSTALLING:  { bg:"#f5f3ff", color:"#7c3aed", border:"#ddd6fe", label:"Telepítés…",   icon:"🔧" },
  FAILED:      { bg:"#fef2f2", color:"#dc2626", border:"#fecaca", label:"Sikertelen",    icon:"❌" },
  ROLLBACK:    { bg:"#fff7ed", color:"#c2410c", border:"#fed7aa", label:"Visszagörgetés",icon:"↩️" },
};

const DEVICE_CLASS_OPTIONS = [
  { value:"SPEAKER", label:"🔊 Hangszóró", description:"Csak hanglejátszás" },
  { value:"DISPLAY", label:"🖥️ Kijelző", description:"Vizuális megjelenítés" },
  { value:"MULTI",   label:"🎛️ Multi", description:"Hang + kijelző" },
];
const WIFI_SECURITY_OPTIONS = [
  { value:"WPA2_PERSONAL",  label:"WPA2 Personal (leggyakoribb)" },
  { value:"WPA3_PERSONAL",  label:"WPA3 Personal" },
  { value:"WPA2_ENTERPRISE",label:"WPA2 Enterprise (802.1X/PEAP)" },
  { value:"OPEN",           label:"Nyílt hálózat (nem titkosított)" },
];

function formatDateTime(iso?: string | null) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("hu-HU");
}
function safeErrorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const a = e as any;
    return a?.data?.message || a?.data?.error || a?.message || "Ismeretlen hiba";
  }
  return "Ismeretlen hiba";
}

const CLASS_BADGE: Record<DeviceClass, {bg:string;color:string;border:string;icon:string}> = {
  SPEAKER:{ bg:"#eff6ff", color:"#1d4ed8", border:"#bfdbfe", icon:"🔊" },
  DISPLAY:{ bg:"#f5f3ff", color:"#7c3aed", border:"#ddd6fe", icon:"🖥️" },
  MULTI:  { bg:"#fffbeb", color:"#d97706", border:"#fde68a", icon:"🎛️" },
};

type ActivateForm = {
  pendingId:string; tenantId:string; name:string; deviceClass:DeviceClass;
  wifiSsid:string; wifiHidden:boolean; wifiSecurity:WifiSecurity; wifiPassword:string; wifiUser:string; orgUnitId:string;
};

const CSS = `
  .dv-header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap}
  .dv-title{font-family:'Nunito',sans-serif;font-size:22px;font-weight:900;color:var(--sl-text);letter-spacing:-0.5px}
  .dv-subtitle{font-size:13px;color:var(--sl-muted);margin-top:3px}
  .dv-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .dv-search{
    padding:9px 13px;border:1.5px solid var(--sl-border);border-radius:11px;
    background:var(--sl-surface);color:var(--sl-text);font-size:13.5px;outline:none;
    transition:all 0.15s;width:260px;font-family:inherit;
  }
  .dv-search:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.11)}
  .dv-search::placeholder{color:var(--sl-muted)}
  .dv-card{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(59,130,246,0.07)}
  .dv-card-hdr{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--sl-border);background:var(--sl-surface)}
  .dv-card-title{font-family:'Nunito',sans-serif;font-size:14px;font-weight:800;color:var(--sl-text);display:flex;align-items:center;gap:7px}
  .dv-card-meta{font-size:12px;color:var(--sl-muted)}
  .dv-table{width:100%;border-collapse:collapse;font-size:13.5px}
  .dv-table th{text-align:left;padding:10px 16px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;color:var(--sl-muted);border-bottom:1px solid var(--sl-border);background:var(--sl-bg);white-space:nowrap;font-family:'Nunito',sans-serif}
  .dv-table td{padding:12px 16px;border-bottom:1px solid var(--sl-border);color:var(--sl-text);vertical-align:middle}
  .dv-table tr:last-child td{border-bottom:none}
  .dv-table tr:hover td{background:rgba(59,130,246,0.03)}
  .dv-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:700;white-space:nowrap;font-family:'Nunito',sans-serif;border:1px solid}
  .dv-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:11px;border:none;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.15s;font-family:'Nunito',sans-serif;white-space:nowrap}
  .dv-btn:disabled{opacity:0.55;cursor:not-allowed}
  .dv-btn-primary{background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;box-shadow:0 3px 10px rgba(99,102,241,0.28)}
  .dv-btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 5px 14px rgba(99,102,241,0.35)}
  .dv-btn-ghost{background:var(--sl-bg);border:1.5px solid var(--sl-border);color:var(--sl-text-2)}
  .dv-btn-ghost:hover:not(:disabled){background:var(--sl-border)}
  .dv-btn-danger{background:#fff5f5;border:1.5px solid #fecaca;color:#dc2626}
  .dv-btn-danger:hover:not(:disabled){background:#fee2e2}
  .dv-btn-sm{padding:5px 11px;font-size:12px;border-radius:8px}
  .dv-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.42);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;animation:dvFade 0.15s ease}
  .dv-modal{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:22px;box-shadow:0 20px 60px rgba(0,0,0,0.18);width:100%;max-width:580px;max-height:90vh;overflow-y:auto;animation:dvSlide 0.2s ease}
  .dv-modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--sl-border);position:sticky;top:0;background:var(--sl-surface);z-index:1}
  .dv-modal-title{font-family:'Nunito',sans-serif;font-size:16px;font-weight:900;color:var(--sl-text);display:flex;align-items:center;gap:8px}
  .dv-modal-body{padding:20px 22px;display:flex;flex-direction:column;gap:14px}
  .dv-modal-footer{padding:14px 22px;border-top:1px solid var(--sl-border);display:flex;justify-content:flex-end;gap:10px}
  .dv-close{width:32px;height:32px;border-radius:8px;border:1.5px solid var(--sl-border);background:var(--sl-bg);color:var(--sl-muted);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s}
  .dv-close:hover{background:var(--sl-border);color:var(--sl-text)}
  .dv-label{display:block;font-size:12px;font-weight:800;color:var(--sl-text-2);margin-bottom:5px;font-family:'Nunito',sans-serif;letter-spacing:0.2px}
  .dv-input,.dv-select{width:100%;padding:9px 12px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg);color:var(--sl-text);font-size:13.5px;outline:none;transition:all 0.15s;font-family:inherit}
  .dv-input:focus,.dv-select:focus{border-color:#3b82f6;background:var(--sl-surface);box-shadow:0 0 0 3px rgba(59,130,246,0.11)}
  .dv-input::placeholder{color:var(--sl-muted)}
  .dv-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .dv-wifi-section{background:var(--sl-bg);border:1px solid var(--sl-border);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px}
  .dv-wifi-title{font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.7px;color:var(--sl-muted)}
  .dv-alert{padding:10px 14px;border-radius:11px;font-size:13px;display:flex;align-items:flex-start;gap:8px}
  .dv-alert-error{background:#fef2f2;border:1px solid #fecaca;color:#dc2626}
  .dv-alert-success{background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d}
  .dv-alert-warn{background:#fffbeb;border:1px solid #fde68a;color:#d97706}
  .dv-check{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--sl-text-2)}
  .dv-pending-item{
    width:100%;background:var(--sl-bg);border:1.5px solid var(--sl-border);border-radius:13px;
    padding:13px 16px;text-align:left;cursor:pointer;transition:all 0.15s;
    display:flex;flex-direction:column;gap:4px;margin-bottom:8px;
  }
  .dv-pending-item:hover{border-color:#bfdbfe;background:#f0f7ff}
  .dv-pending-mac{font-size:14px;font-weight:800;color:var(--sl-text);font-family:monospace}
  .dv-pending-meta{font-size:12px;color:var(--sl-muted);display:flex;gap:14px}
  .dv-empty{text-align:center;padding:48px 20px;color:var(--sl-muted)}
  .dv-empty-icon{font-size:44px;margin-bottom:12px}
  .dv-empty-txt{font-size:14px;font-family:'Nunito',sans-serif;font-weight:700;color:var(--sl-text-2)}
  .dv-key-box{background:var(--sl-bg);border:1px solid var(--sl-border);border-radius:9px;padding:6px 10px;font-family:monospace;font-size:12px;color:var(--sl-text);word-break:break-all}
  @keyframes dvFade{from{opacity:0}to{opacity:1}}
  @keyframes dvSlide{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}
  /* Csoportok panel */
  .dv-group-list{display:flex;flex-direction:column;gap:8px;margin-top:12px}
  .dv-group-item{background:var(--sl-bg);border:1.5px solid var(--sl-border);border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .dv-group-name{font-size:14px;font-weight:800;color:var(--sl-text);flex:1;min-width:0}
  .dv-device-check-list{display:flex;flex-direction:column;gap:5px;max-height:200px;overflow-y:auto;padding:8px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg);margin-top:8px}
  .dv-device-check-item{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:9px;cursor:pointer;transition:background 0.12s}
  .dv-device-check-item:hover{background:var(--sl-border)}
  .dv-device-check-item input[type=checkbox]{accent-color:#3b82f6;width:15px;height:15px;cursor:pointer;flex-shrink:0}
  .dv-wp-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;font-family:'Nunito',sans-serif}
  .dv-wp-section{background:linear-gradient(135deg,#f0fdf4,#eff6ff);border:1.5px solid #bbf7d0;border-radius:13px;padding:13px 16px;margin-bottom:8px}
  .dv-wp-section-title{font-size:12px;font-weight:800;color:#15803d;font-family:'Nunito',sans-serif;margin-bottom:8px;display:flex;align-items:center;gap:6px}
  /* OTA */
  .dv-ota-bar{height:5px;background:var(--sl-border);border-radius:99px;overflow:hidden;margin-top:4px;width:80px}
  .dv-ota-fill{height:100%;background:linear-gradient(90deg,#3b82f6,#6366f1);border-radius:99px;transition:width 0.4s}
  .dv-fw-item{padding:12px 16px;border-bottom:1px solid var(--sl-border);display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center}
  .dv-fw-item:last-child{border-bottom:none}
  .dv-fw-version{font-size:15px;font-weight:900;color:var(--sl-text);font-family:monospace}
  .dv-fw-meta{font-size:11.5px;color:var(--sl-muted);margin-top:3px;display:flex;gap:10px;flex-wrap:wrap}
  .dv-upload-zone{margin:14px;border:2px dashed var(--sl-border);border-radius:14px;padding:20px;text-align:center;cursor:pointer;transition:all 0.2s;background:var(--sl-bg)}
  .dv-upload-zone:hover{border-color:#3b82f6;background:#eff6ff}
  @media(max-width:600px){.dv-grid2{grid-template-columns:1fr}.dv-search{width:100%}}
`;

function Modal({ title, icon, children, onClose }: { title:string; icon:string; children:React.ReactNode; onClose:()=>void }) {
  return (
    <div className="dv-overlay" onClick={onClose}>
      <div className="dv-modal" onClick={e => e.stopPropagation()}>
        <div className="dv-modal-hdr">
          <div className="dv-modal-title"><span>{icon}</span>{title}</div>
          <button className="dv-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Devices() {
  const { state } = useAuth();
  const role = state.status === "authed" ? (state.user as any)?.role ?? "" : "";
  const isSuperAdmin = role === "SUPER_ADMIN";
  const canWrite = role === "SUPER_ADMIN" || role === "TENANT_ADMIN";

  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pendingOpen, setPendingOpen] = useState(false);
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [activateForm, setActivateForm] = useState<ActivateForm | null>(null);
  const [busyActivate, setBusyActivate] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [activateSuccess, setActivateSuccess] = useState<{ deviceKey: string; name: string } | null>(null);

  // ── OTA state ─────────────────────────────────────────────────────────────
  const [otaOpen,         setOtaOpen]         = useState(false);
  const [releases,        setReleases]        = useState<FirmwareRelease[]>([]);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [uploadBusy,      setUploadBusy]      = useState(false);
  const [uploadError,     setUploadError]     = useState<string | null>(null);
  const [uploadSuccess,   setUploadSuccess]   = useState<string | null>(null);
  const [uploadForm,      setUploadForm]      = useState({ version:"", notes:"", mandatory:false, targetClass:"ALL" });
  const uploadFileRef = useRef<HTMLInputElement>(null);

  const [pendingWeb, setPendingWeb] = useState<PendingWebPlayer[]>([]);
  const [wpActivateForm, setWpActivateForm] = useState<{ pendingId: string; name: string } | null>(null);
  const [wpActivateBusy, setWpActivateBusy] = useState(false);
  const [wpActivateError, setWpActivateError] = useState<string | null>(null);
  const healthTimer = useRef<number | null>(null);
  const pendingTimer = useRef<number | null>(null);

  // ── Csoportok ─────────────────────────────────────────────────────────────
  const [groupsOpen,    setGroupsOpen]    = useState(false);
  const [groups,        setGroups]        = useState<DeviceGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsBusy,    setGroupsBusy]    = useState(false);
  const [groupsError,   setGroupsError]   = useState<string|null>(null);
  const [newGroupName,  setNewGroupName]  = useState("");
  const [editGroup,     setEditGroup]     = useState<DeviceGroup|null>(null);
  const [editGroupName, setEditGroupName] = useState("");

  // ── OTA funkciók ──────────────────────────────────────────────────────────
  async function loadReleases() {
    setReleasesLoading(true);
    try { const r = await apiFetch<{ok:boolean;releases:FirmwareRelease[]}>("/firmware/releases"); setReleases(r.releases??[]); }
    catch { setReleases([]); }
    finally { setReleasesLoading(false); }
  }

  async function uploadFirmware(file: File) {
    if (!uploadForm.version.trim()) { setUploadError("Verziószám kötelező!"); return; }
    setUploadBusy(true); setUploadError(null); setUploadSuccess(null);
    try {
      const token    = sessionStorage.getItem("accessToken")    ?? localStorage.getItem("accessToken")    ?? "";
      const tenantId = sessionStorage.getItem("activeTenantId") ?? localStorage.getItem("activeTenantId") ?? "";
      const fd = new FormData();
      fd.append("file", file);
      fd.append("version", uploadForm.version.trim());
      if (uploadForm.notes.trim()) fd.append("notes", uploadForm.notes.trim());
      fd.append("mandatory", String(uploadForm.mandatory));
      fd.append("targetClass", uploadForm.targetClass);
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? "https://api.schoollive.hu"}/firmware/upload`, {
        method: "POST",
        headers: {
          ...(token    ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenantId ? { "x-tenant-id": tenantId }         : {}),
        },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Feltöltés sikertelen");
      setUploadSuccess(`✅ ${data.release.version} sikeresen feltöltve`);
      setUploadForm({ version:"", notes:"", mandatory:false, targetClass:"ALL" });
      void loadReleases();
    } catch (e:any) { setUploadError(e?.message ?? "Feltöltés sikertelen"); }
    finally { setUploadBusy(false); }
  }

  async function deleteRelease(id: string, version: string) {
    if (!window.confirm(`Törlöd a ${version} verziót?`)) return;
    try { await apiFetch(`/firmware/releases/${id}`, { method:"DELETE" }); void loadReleases(); }
    catch (e:any) { setUploadError(e?.message ?? "Törlés sikertelen"); }
  }

  async function loadGroups() {
    setGroupsLoading(true);
    try { const r = await apiFetch<{ok:boolean;groups:DeviceGroup[]}>("/admin/devices/groups"); setGroups(r.groups??[]); }
    catch { setGroupsError("Csoportok betöltése sikertelen"); }
    finally { setGroupsLoading(false); }
  }
  async function createGroup() {
    if (!newGroupName.trim()) return;
    setGroupsBusy(true); setGroupsError(null);
    try {
      await apiFetch("/admin/devices/groups", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name: newGroupName.trim() }) });
      setNewGroupName(""); await loadGroups();
    } catch (e:any) { setGroupsError(e?.message??"Létrehozás sikertelen"); }
    finally { setGroupsBusy(false); }
  }
  async function saveGroupMembers(g: DeviceGroup, deviceIds: string[]) {
    setGroupsBusy(true); setGroupsError(null);
    try {
      await apiFetch(`/admin/devices/groups/${g.id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ deviceIds }) });
      await loadGroups(); setEditGroup(null);
    } catch (e:any) { setGroupsError(e?.message??"Mentés sikertelen"); }
    finally { setGroupsBusy(false); }
  }
  async function renameGroup(g: DeviceGroup, name: string) {
    if (!name.trim() || name === g.name) { setEditGroup(null); return; }
    setGroupsBusy(true);
    try {
      await apiFetch(`/admin/devices/groups/${g.id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name: name.trim() }) });
      await loadGroups(); setEditGroup(null);
    } catch (e:any) { setGroupsError(e?.message??"Átnevezés sikertelen"); }
    finally { setGroupsBusy(false); }
  }
  async function deleteGroup(id: string) {
    if (!window.confirm("Törlöd ezt a csoportot?")) return;
    try { await apiFetch(`/admin/devices/groups/${id}`, { method:"DELETE" }); await loadGroups(); }
    catch { setGroupsError("Törlés sikertelen"); }
  }

  async function loadPendingWeb() {
    try {
      const data = await apiFetch<PendingWebResponse>("/admin/devices/pending-web");
      setPendingWeb(Array.isArray(data.pendingWeb) ? data.pendingWeb : []);
    } catch { setPendingWeb([]); }
  }
  async function submitWpActivate() {
    if (!wpActivateForm) return;
    if (!wpActivateForm.name.trim()) { setWpActivateError("Az eszköznév megadása kötelező."); return; }
    setWpActivateError(null); setWpActivateBusy(true);
    try {
      await apiFetch(`/admin/devices/activate-web/${wpActivateForm.pendingId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: wpActivateForm.name.trim() }),
      });
      setWpActivateForm(null); void loadDevices(); void loadPendingWeb();
    } catch (e) { setWpActivateError(safeErrorMessage(e)); }
    finally { setWpActivateBusy(false); }
  }

  async function loadDevices() {
    try {
      const data = await apiFetch<HealthResponse>("/admin/devices/health");
      setDevices(Array.isArray(data.devices) ? data.devices : []);
      setError(null);
    } catch (e) { setError(safeErrorMessage(e)); }
    finally { setLoading(false); }
  }
  async function loadPending() {
    setPendingLoading(true);
    try {
      const data = await apiFetch<PendingResponse>("/provision/pending");
      setPending(Array.isArray(data.pending) ? data.pending : []);
    } catch { setPending([]); }
    finally { setPendingLoading(false); }
  }
  async function loadTenants() {
    if (!isSuperAdmin) return;
    try {
      const data = await apiFetch<TenantsResponse>("/admin/tenants");
      setTenants(Array.isArray(data.tenants) ? data.tenants : []);
    } catch { setTenants([]); }
  }

  useEffect(() => {
    void loadDevices();
    void loadPendingWeb();
    healthTimer.current = window.setInterval(loadDevices, 10_000);
    if (canWrite) void loadTenants();
    return () => {
      if (healthTimer.current) window.clearInterval(healthTimer.current);
      if (pendingTimer.current) window.clearInterval(pendingTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openPending() {
    setPendingOpen(true); void loadPending();
    pendingTimer.current = window.setInterval(loadPending, 5_000);
  }
  function closePending() {
    setPendingOpen(false);
    if (pendingTimer.current) { window.clearInterval(pendingTimer.current); pendingTimer.current = null; }
  }
  function selectPending(p: PendingDevice) {
    const autoTenantId = state.status === "authed" ? ((state.user as any)?.tenantId ?? "") : "";
    setActivateForm({ pendingId:p.id, tenantId:autoTenantId, name:"", deviceClass:"SPEAKER",
      wifiSsid:"", wifiHidden:false, wifiSecurity:"WPA2_PERSONAL", wifiPassword:"", wifiUser:"", orgUnitId:"" });
    setActivateError(null); setActivateSuccess(null); closePending();
  }
  async function submitActivate() {
    if (!activateForm) return;
    const { pendingId, tenantId, name, deviceClass, wifiSsid, wifiHidden, wifiSecurity, wifiPassword, wifiUser } = activateForm;
    if (!name.trim()) { setActivateError("Az eszköznév megadása kötelező."); return; }
    if (!tenantId) { setActivateError("Intézmény kiválasztása kötelező."); return; }
    if (!wifiSsid.trim()) { setActivateError("WiFi SSID megadása kötelező."); return; }
    if (wifiSecurity !== "OPEN" && !wifiPassword.trim()) { setActivateError("WiFi jelszó megadása kötelező."); return; }
    if (wifiSecurity === "WPA2_ENTERPRISE" && !wifiUser.trim()) { setActivateError("WPA2 Enterprise esetén bejelentkezési név kötelező."); return; }
    setActivateError(null); setBusyActivate(true);
    try {
      const res = await apiFetch<{ ok:true; device:{ name:string }; deviceKey:string }>(
        "/provision/activate", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ pendingId, tenantId, name:name.trim(), deviceClass,
            wifiSsid:wifiSsid.trim(), wifiHidden, wifiSecurity,
            wifiPassword: wifiSecurity !== "OPEN" ? wifiPassword.trim() : "",
            wifiUser: wifiSecurity === "WPA2_ENTERPRISE" ? wifiUser.trim() : "",
            orgUnitId: activateForm.orgUnitId.trim() || undefined }),
        }
      );
      setActivateSuccess({ deviceKey:res.deviceKey, name:res.device.name });
      setActivateForm(null); void loadDevices();
    } catch (e) { setActivateError(safeErrorMessage(e)); }
    finally { setBusyActivate(false); }
  }

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return devices;
    return devices.filter(d => [d.name,d.deviceClass,d.ipAddress,d.firmwareVersion,d.hwModel].join(" ").toLowerCase().includes(n));
  }, [q, devices]);

  return (
    <div>
      <style>{CSS}</style>

      {/* Header */}
      <div className="dv-header">
        <div>
          <div className="dv-title">🔊 Intézményi eszközök</div>
          <div className="dv-subtitle">Az összes hangszóró és kijelző egy helyen — valós idejű státusszal.</div>
        </div>
        <div className="dv-actions">
          <input className="dv-search" placeholder="🔍 Keresés…" value={q} onChange={e => setQ(e.target.value)} />
          {canWrite && (
            <button className="dv-btn dv-btn-primary" onClick={openPending} type="button">
              ＋ Új eszköz
            </button>
          )}
          <button className="dv-btn dv-btn-ghost" type="button" onClick={() => { setGroupsOpen(true); void loadGroups(); }}>
            👥 Csoportok
          </button>
          {isSuperAdmin && (
            <button className="dv-btn dv-btn-ghost" type="button"
              onClick={() => { setOtaOpen(true); void loadReleases(); }}>
              📦 Firmware OTA
            </button>
          )}
          <button className="dv-btn dv-btn-ghost" onClick={() => void loadDevices()} disabled={loading} type="button">
            🔄 Frissítés
          </button>
        </div>
      </div>

      {error && <div className="dv-alert dv-alert-error" style={{ marginBottom:16 }}><span>⚠️</span>{error}</div>}

      {activateSuccess && (
        <div className="dv-alert dv-alert-success" style={{ marginBottom:16, flexDirection:"column", alignItems:"flex-start" }}>
          <div style={{ fontWeight:800, fontFamily:"'Nunito',sans-serif" }}>✅ Eszköz aktiválva: {activateSuccess.name}</div>
          <div style={{ fontSize:12, marginTop:4 }}>
            Device key (csak egyszer látható!):
            <div className="dv-key-box" style={{ marginTop:6 }}>{activateSuccess.deviceKey}</div>
          </div>
          <button onClick={() => setActivateSuccess(null)} style={{ fontSize:12, color:"inherit", opacity:0.7, background:"none", border:"none", cursor:"pointer", padding:0, marginTop:6 }}>Bezár</button>
        </div>
      )}

      {/* Device list */}
      <div className="dv-card">
        <div className="dv-card-hdr">
          <div className="dv-card-title">📋 Eszközök listája</div>
          <div className="dv-card-meta">{loading ? "Betöltés…" : `${filtered.length} / ${devices.length} eszköz`}</div>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table className="dv-table">
            <thead>
              <tr>
                <th>Eszköznév</th><th>Típus</th><th>HW modell</th><th>Státusz</th><th>IP cím</th><th>Firmware</th><th>OTA</th><th>Utolsó aktivitás</th>
                {canWrite && <th style={{ textAlign:"right" }}>Műveletek</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={canWrite?9:8} style={{ textAlign:"center", padding:"40px", color:"var(--sl-muted)" }}>
                  <span style={{ fontSize:24 }}>⏳</span><div style={{ marginTop:8, fontSize:13 }}>Betöltés…</div>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={canWrite?9:8}>
                  <div className="dv-empty">
                    <div className="dv-empty-icon">🔇</div>
                    <div className="dv-empty-txt">Nincs megjeleníthető eszköz</div>
                    <div style={{ fontSize:13, marginTop:6 }}>Adj hozzá eszközöket az „Új eszköz" gombbal</div>
                  </div>
                </td></tr>
              )}
              {filtered.map(d => {
                const cb = CLASS_BADGE[d.deviceClass] || CLASS_BADGE.SPEAKER;
                return (
                  <tr key={d.deviceId}>
                    <td><strong style={{ fontWeight:700 }}>{d.name}</strong></td>
                    <td>
                      <span className="dv-badge" style={{ background:cb.bg, color:cb.color, borderColor:cb.border }}>
                        {cb.icon} {d.deviceClass === "SPEAKER" ? "Hangszóró" : d.deviceClass === "DISPLAY" ? "Kijelző" : "Multi"}
                      </span>
                    </td>
                    <td style={{ fontSize:12 }}>
                      {d.hwModel ? (() => {
                        const hw  = HW_MODEL_OPTIONS.find(h => h.value === d.hwModel);
                        const bdg = HW_MODEL_BADGE[d.hwModel ?? ""] ?? { bg:"var(--sl-bg)", color:"var(--sl-muted)", border:"var(--sl-border)" };
                        return (
                          <span className="dv-badge" style={{ background:bdg.bg, color:bdg.color, borderColor:bdg.border, fontSize:11 }}>
                            {hw?.icon ?? "🔧"} {hw?.label ?? d.hwModel}
                          </span>
                        );
                      })() : <span style={{ color:"var(--sl-muted)" }}>—</span>}
                    </td>
                    <td>
                      <span className="dv-badge" style={d.isOnline
                        ? { background:"#f0fdf4", color:"#15803d", borderColor:"#bbf7d0" }
                        : { background:"var(--sl-bg)", color:"var(--sl-muted)", borderColor:"var(--sl-border)" }
                      }>
                        <span style={{ width:7,height:7,borderRadius:"50%",background:d.isOnline?"#22c55e":"#94a3b8",display:"inline-block" }} />
                        {d.isOnline ? "Online" : "Offline"}
                      </span>
                    </td>
                    <td style={{ fontFamily:"monospace", fontSize:12 }}>{d.ipAddress ?? <span style={{ color:"var(--sl-muted)" }}>—</span>}</td>
                    <td style={{ fontSize:12 }}>{d.firmwareVersion ?? <span style={{ color:"var(--sl-muted)" }}>—</span>}</td>
                    <td style={{ fontSize:12 }}>
                      {d.otaStatus && d.otaStatus !== "UP_TO_DATE" ? (() => {
                        const os = d.otaStatus as OtaStatus;
                        const ob = OTA_STATUS_BADGE[os] ?? OTA_STATUS_BADGE.UP_TO_DATE;
                        return (
                          <div>
                            <span className="dv-badge" style={{ background:ob.bg, color:ob.color, borderColor:ob.border, fontSize:11 }}>
                              {ob.icon} {ob.label}
                            </span>
                            {(os==="DOWNLOADING"||os==="INSTALLING") && (d.otaProgress??0)>0 && (
                              <div className="dv-ota-bar"><div className="dv-ota-fill" style={{width:`${d.otaProgress}%`}}/></div>
                            )}
                          </div>
                        );
                      })() : <span style={{color:"var(--sl-muted)",fontSize:11}}>—</span>}
                    </td>
                    <td style={{ fontSize:12 }}>
                      {d.secondsSinceLastSeen !== null && d.secondsSinceLastSeen !== undefined ? `${d.secondsSinceLastSeen}mp` : "—"}
                    </td>
                    {canWrite && (
                      <td style={{ textAlign:"right" }}>
                        <button className="dv-btn dv-btn-danger dv-btn-sm" type="button"
                          onClick={async () => {
                            if (!window.confirm(`Törlöd? (${d.name})`)) return;
                            try { await apiFetch(`/admin/devices/${d.deviceId}`, { method:"DELETE" }); void loadDevices(); }
                            catch (e) { setError(safeErrorMessage(e)); }
                          }}>
                          🗑 Törlés
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending modal */}
      {pendingOpen && (
        <Modal title="Aktiválásra váró eszközök" icon="📡" onClose={closePending}>
          <div className="dv-modal-body">
            {/* WebPlayer szekció */}
            {pendingWeb.length > 0 && (
              <div className="dv-wp-section">
                <div className="dv-wp-section-title">📱 Virtuális lejátszók (WebPlayer)</div>
                {pendingWeb.map(wp => (
                  <button key={wp.id} className="dv-pending-item" type="button"
                    style={{ border:"1.5px solid #bbf7d0", background:"#f0fdf4" }}
                    onClick={() => { setWpActivateForm({ pendingId: wp.id, name: "" }); setWpActivateError(null); closePending(); }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span className="dv-pending-mac" style={{ color:"#15803d" }}>
                        📱 WP-{wp.clientId?.slice(0,8).toUpperCase() ?? "?"}
                      </span>
                      <span style={{ fontSize:11, color:"var(--sl-muted)" }}>Utoljára: {formatDateTime(wp.lastSeenAt)}</span>
                    </div>
                    <div className="dv-pending-meta">
                      {wp.ipAddress && <span>📍 {wp.ipAddress}</span>}
                      {wp.userAgent && <span style={{ maxWidth:300, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>🌐 {wp.userAgent.slice(0,60)}…</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="dv-alert dv-alert-warn" style={{ fontSize:13 }}>
              <span>💡</span>
              Az alábbi eszközök provisioning módban várják az aktiválást. Kattints egyre az aktiváláshoz.
            </div>
            {pendingLoading && pending.length === 0 && (
              <div style={{ textAlign:"center", padding:"20px", color:"var(--sl-muted)", fontSize:13 }}>🔍 Keresés…</div>
            )}
            {!pendingLoading && pending.length === 0 && (
              <div style={{ textAlign:"center", padding:"24px", color:"var(--sl-muted)", fontSize:13 }}>
                <div style={{ fontSize:36, marginBottom:10 }}>📡</div>
                Nincs aktiválásra váró eszköz. Győződj meg róla, hogy az ESP32 be van kapcsolva.
              </div>
            )}
            {pending.map(p => (
              <button key={p.id} className="dv-pending-item" type="button" onClick={() => selectPending(p)}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span className="dv-pending-mac">{p.mac}</span>
                  <span style={{ fontSize:11, color:"var(--sl-muted)" }}>Utoljára: {formatDateTime(p.lastSeenAt)}</span>
                </div>
                <div className="dv-pending-meta">
                  {p.ipAddress && <span>📍 {p.ipAddress}</span>}
                  {p.firmwareVersion && <span>⚙️ {p.firmwareVersion}</span>}
                </div>
              </button>
            ))}
          </div>
          <div className="dv-modal-footer">
            <button className="dv-btn dv-btn-ghost" onClick={() => void loadPending()} disabled={pendingLoading} type="button">
              🔄 Frissítés
            </button>
            <button className="dv-btn dv-btn-ghost" onClick={closePending} type="button">Mégse</button>
          </div>
        </Modal>
      )}

      {/* Activate modal */}
      {activateForm && (
        <Modal title="Eszköz aktiválása" icon="⚡" onClose={() => setActivateForm(null)}>
          <div className="dv-modal-body">
            <div style={{ fontSize:12, color:"var(--sl-muted)", fontFamily:"monospace", background:"var(--sl-bg)", padding:"6px 10px", borderRadius:8 }}>
              Pending ID: {activateForm.pendingId}
            </div>

            <div className="dv-grid2">
              <div>
                <label className="dv-label">Eszköznév *</label>
                <input className="dv-input" placeholder="pl. 14. terem hangszóró"
                  value={activateForm.name} onChange={e => setActivateForm(s => s?{...s,name:e.target.value}:s)} />
              </div>
              <div>
                <label className="dv-label">Eszköztípus *</label>
                <select className="dv-select" value={activateForm.deviceClass}
                  onChange={e => setActivateForm(s => s?{...s,deviceClass:e.target.value as DeviceClass}:s)}>
                  {DEVICE_CLASS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <div style={{ fontSize:11, color:"var(--sl-muted)", marginTop:4 }}>
                  {DEVICE_CLASS_OPTIONS.find(o => o.value === activateForm.deviceClass)?.description}
                </div>
              </div>
            </div>

            {isSuperAdmin && (
              <div>
                <label className="dv-label">Intézmény *</label>
                <select className="dv-select" value={activateForm.tenantId}
                  onChange={e => setActivateForm(s => s?{...s,tenantId:e.target.value}:s)}>
                  <option value="">Válassz intézményt…</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}

            <div className="dv-wifi-section">
              <div className="dv-wifi-title">📶 WiFi konfiguráció</div>
              <div>
                <label className="dv-label">WiFi SSID *</label>
                <input className="dv-input" placeholder="pl. Iskola-WiFi"
                  value={activateForm.wifiSsid} onChange={e => setActivateForm(s => s?{...s,wifiSsid:e.target.value}:s)} />
                <label className="dv-check" style={{ marginTop:8 }}>
                  <input type="checkbox" checked={activateForm.wifiHidden}
                    onChange={e => setActivateForm(s => s?{...s,wifiHidden:e.target.checked}:s)} />
                  Rejtett hálózat
                </label>
              </div>
              <div>
                <label className="dv-label">Biztonsági típus</label>
                <select className="dv-select" value={activateForm.wifiSecurity}
                  onChange={e => setActivateForm(s => s?{...s,wifiSecurity:e.target.value as WifiSecurity,wifiPassword:"",wifiUser:""}:s)}>
                  {WIFI_SECURITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {(activateForm.wifiSecurity==="WPA2_PERSONAL"||activateForm.wifiSecurity==="WPA3_PERSONAL") && (
                <div>
                  <label className="dv-label">WiFi jelszó *</label>
                  <input type="password" className="dv-input" placeholder="Jelszó"
                    value={activateForm.wifiPassword} onChange={e => setActivateForm(s => s?{...s,wifiPassword:e.target.value}:s)} />
                </div>
              )}
              {activateForm.wifiSecurity==="WPA2_ENTERPRISE" && (
                <div className="dv-grid2">
                  <div>
                    <label className="dv-label">Bejelentkezési név *</label>
                    <input className="dv-input" placeholder="pl. user@iskola.hu"
                      value={activateForm.wifiUser} onChange={e => setActivateForm(s => s?{...s,wifiUser:e.target.value}:s)} />
                  </div>
                  <div>
                    <label className="dv-label">Jelszó *</label>
                    <input type="password" className="dv-input" placeholder="Jelszó"
                      value={activateForm.wifiPassword} onChange={e => setActivateForm(s => s?{...s,wifiPassword:e.target.value}:s)} />
                  </div>
                  <div style={{ fontSize:11, color:"var(--sl-muted)", gridColumn:"1/-1" }}>WPA2 Enterprise (802.1X/PEAP) – tanúsítvány nélküli</div>
                </div>
              )}
              {activateForm.wifiSecurity==="OPEN" && (
                <div className="dv-alert dv-alert-warn" style={{ fontSize:12 }}>⚠ Nyílt hálózat – nem javasolt éles környezetben</div>
              )}
            </div>

            {activateError && <div className="dv-alert dv-alert-error"><span>⚠️</span>{activateError}</div>}
          </div>
          <div className="dv-modal-footer">
            <button className="dv-btn dv-btn-ghost" onClick={() => setActivateForm(null)} disabled={busyActivate} type="button">Mégse</button>
            <button className="dv-btn dv-btn-primary" onClick={() => void submitActivate()} disabled={busyActivate} type="button">
              {busyActivate ? "⏳ Aktiválás…" : "⚡ Aktivál"}
            </button>
          </div>
        </Modal>
      )}
      {/* WP Activate modal */}
      {wpActivateForm && (
        <Modal title="Virtuális lejátszó aktiválása" icon="📱" onClose={() => setWpActivateForm(null)}>
          <div className="dv-modal-body">
            <div className="dv-alert" style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", color:"#15803d", fontSize:13 }}>
              <span>📱</span>
              Egy WebPlayer eszközt aktiválsz. A PLAYER felhasználó böngészője virtuális hangszóró/kijelzőként fog működni.
            </div>
            <div>
              <label className="dv-label">Eszköznév *</label>
              <input className="dv-input" placeholder="pl. Portás tablet, Ebédlő kijelző"
                value={wpActivateForm.name}
                onChange={e => setWpActivateForm(s => s ? { ...s, name: e.target.value } : s)} />
            </div>
            {wpActivateError && <div className="dv-alert dv-alert-error"><span>⚠️</span>{wpActivateError}</div>}
          </div>
          <div className="dv-modal-footer">
            <button className="dv-btn dv-btn-ghost" onClick={() => setWpActivateForm(null)} disabled={wpActivateBusy} type="button">Mégse</button>
            <button className="dv-btn dv-btn-primary" onClick={() => void submitWpActivate()} disabled={wpActivateBusy} type="button">
              {wpActivateBusy ? "⏳ Aktiválás…" : "📱 Aktivál"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Csoportok modal ─────────────────────────────────────────── */}
      {groupsOpen && (
        <div className="dv-overlay" onClick={() => setGroupsOpen(false)}>
          <div className="dv-modal" style={{ maxWidth:560 }} onClick={e => e.stopPropagation()}>
            <div className="dv-modal-hdr">
              <div className="dv-modal-title">👥 Eszköz csoportok</div>
              <button className="dv-close" onClick={() => setGroupsOpen(false)}>✕</button>
            </div>
            <div style={{ padding:"18px 22px", overflowY:"auto", maxHeight:"70vh" }}>
              {groupsError && <div className="dv-alert dv-alert-error" style={{marginBottom:12}}><span>⚠️</span>{groupsError}</div>}

              {/* Új csoport */}
              <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                <input
                  className="dv-input" style={{ flex:1 }}
                  placeholder="Új csoport neve…"
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  onKeyDown={e => e.key==="Enter" && void createGroup()}
                />
                <button className="dv-btn dv-btn-primary" onClick={() => void createGroup()} disabled={groupsBusy||!newGroupName.trim()} type="button">
                  ＋ Létrehoz
                </button>
              </div>

              {/* Csoport lista */}
              {groupsLoading ? (
                <div style={{ textAlign:"center", padding:24, color:"var(--sl-muted)" }}>⏳ Betöltés…</div>
              ) : groups.length === 0 ? (
                <div style={{ textAlign:"center", padding:24, color:"var(--sl-muted)", fontSize:13 }}>Még nincs csoport. Hozz létre egyet!</div>
              ) : (
                <div className="dv-group-list">
                  {groups.map(g => (
                    <div key={g.id} className="dv-group-item">
                      {editGroup?.id === g.id ? (
                        <>
                          <input
                            className="dv-input" style={{ flex:1 }}
                            value={editGroupName}
                            onChange={e => setEditGroupName(e.target.value)}
                            onKeyDown={e => e.key==="Enter" && void renameGroup(g, editGroupName)}
                            autoFocus
                          />
                          <button className="dv-btn dv-btn-primary dv-btn-sm" onClick={() => void renameGroup(g, editGroupName)} disabled={groupsBusy} type="button">Ment</button>
                          <button className="dv-btn dv-btn-ghost dv-btn-sm" onClick={() => setEditGroup(null)} type="button">Mégse</button>
                        </>
                      ) : (
                        <>
                          <div style={{ flex:1 }}>
                            <div className="dv-group-name">👥 {g.name}</div>
                            <div style={{ fontSize:11, color:"var(--sl-muted)", marginTop:2 }}>
                              {g.deviceIds.length === 0 ? "Nincs tag" : `${g.deviceIds.length} eszköz`}
                              {g.deviceIds.length > 0 && ": " + devices.filter(d => g.deviceIds.includes(d.deviceId)).map(d => d.name).join(", ")}
                            </div>
                          </div>
                          <button className="dv-btn dv-btn-ghost dv-btn-sm" type="button"
                            onClick={() => {
                              setEditGroup({...g, _editMembers: true} as any);
                              setEditGroupName(g.name);
                            }}>
                            ✏️ Tagok
                          </button>
                          <button className="dv-btn dv-btn-ghost dv-btn-sm" type="button"
                            onClick={() => { setEditGroup(g); setEditGroupName(g.name); }}>
                            📝 Átnevez
                          </button>
                          <button className="dv-btn dv-btn-danger dv-btn-sm" type="button"
                            onClick={() => void deleteGroup(g.id)}>
                            🗑
                          </button>
                        </>
                      )}
                      {/* Tag szerkesztő – eszközök jelölőnégyzetekkel */}
                      {(editGroup as any)?._editMembers && editGroup?.id === g.id && (
                        <div style={{ width:"100%", marginTop:8 }}>
                          <div style={{ fontSize:11, fontWeight:800, color:"var(--sl-muted)", marginBottom:4 }}>TAGOK KIVÁLASZTÁSA</div>
                          <div className="dv-device-check-list">
                            {devices.length === 0 && <div style={{ fontSize:12, color:"var(--sl-muted)", padding:6 }}>Nincs eszköz</div>}
                            {devices.map(d => {
                              const isMember = editGroup.deviceIds.includes(d.deviceId);
                              return (
                                <label key={d.deviceId} className="dv-device-check-item">
                                  <input type="checkbox" checked={isMember} onChange={() => {
                                    const ids = isMember
                                      ? editGroup.deviceIds.filter((id: string) => id !== d.deviceId)
                                      : [...editGroup.deviceIds, d.deviceId];
                                    setEditGroup({ ...editGroup, deviceIds: ids });
                                  }} />
                                  <span className={isDeviceOnline(d) ? "dv-dot-on" : "dv-dot-off"} style={{ width:7, height:7, borderRadius:"50%", background: isDeviceOnline(d) ? "#22c55e" : "#94a3b8", flexShrink:0 }} />
                                  <span style={{ fontSize:13, fontWeight:600 }}>{d.name}</span>
                                </label>
                              );
                            })}
                          </div>
                          <div style={{ display:"flex", gap:8, marginTop:10 }}>
                            <button className="dv-btn dv-btn-primary dv-btn-sm" disabled={groupsBusy} type="button"
                              onClick={() => void saveGroupMembers(g, editGroup.deviceIds)}>
                              {groupsBusy ? "Mentés…" : "💾 Mentés"}
                            </button>
                            <button className="dv-btn dv-btn-ghost dv-btn-sm" type="button" onClick={() => setEditGroup(null)}>Mégse</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {otaOpen && (
        <div className="dv-overlay" onClick={() => setOtaOpen(false)}>
          <div className="dv-modal" style={{ maxWidth:640 }} onClick={e => e.stopPropagation()}>
            <div className="dv-modal-hdr">
              <div className="dv-modal-title">📦 Firmware OTA kezelő</div>
              <button className="dv-close" onClick={() => setOtaOpen(false)}>✕</button>
            </div>
            <div style={{ padding:"18px 22px", overflowY:"auto", maxHeight:"75vh", display:"flex", flexDirection:"column", gap:16 }}>

              {/* Feltöltés */}
              <div style={{ background:"var(--sl-bg)", border:"1px solid var(--sl-border)", borderRadius:14, padding:16 }}>
                <div style={{ fontSize:13, fontWeight:800, color:"var(--sl-text)", marginBottom:12, fontFamily:"'Nunito',sans-serif" }}>⬆️ Új firmware feltöltése</div>
                <div className="dv-grid2" style={{ marginBottom:10 }}>
                  <div>
                    <label className="dv-label">Verzió *</label>
                    <input className="dv-input" placeholder="pl. S3.5" value={uploadForm.version}
                      onChange={e => setUploadForm(s => ({ ...s, version:e.target.value }))} />
                  </div>
                  <div>
                    <label className="dv-label">Céleszköz</label>
                    <select className="dv-select" value={uploadForm.targetClass}
                      onChange={e => setUploadForm(s => ({ ...s, targetClass:e.target.value }))}>
                      <option value="ALL">Minden eszköz (ALL)</option>
                      <option value="ESP32_S3">ESP32-S3-N16R8</option>
                      <option value="ESP32_WROOM">ESP32-WROOM-32</option>
                      <option value="ESP32_S3_DISPLAY">ESP32-S3 Kijelző</option>
                      <option value="ESP32_S3_MULTI">ESP32-S3 Multi</option>
                      <option value="SPEAKER">Összes hangszóró (SPEAKER)</option>
                      <option value="DISPLAY">Összes kijelző (DISPLAY)</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom:10 }}>
                  <label className="dv-label">Megjegyzés</label>
                  <input className="dv-input" placeholder="Release notes…" value={uploadForm.notes}
                    onChange={e => setUploadForm(s => ({ ...s, notes:e.target.value }))} />
                </div>
                <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"var(--sl-text-2)", marginBottom:12, cursor:"pointer" }}>
                  <input type="checkbox" checked={uploadForm.mandatory}
                    onChange={e => setUploadForm(s => ({ ...s, mandatory:e.target.checked }))}
                    style={{ accentColor:"#dc2626" }} />
                  <span>⚠️ Kötelező frissítés (eszközök azonnal frissítenek)</span>
                </label>
                <input ref={uploadFileRef} type="file" accept=".bin" style={{ display:"none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void uploadFirmware(f); e.target.value = ""; }} />
                <div className="dv-upload-zone" onClick={() => !uploadBusy && uploadFileRef.current?.click()}>
                  <div style={{ fontSize:28, marginBottom:6 }}>{uploadBusy ? "⏳" : "📁"}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:"var(--sl-text-2)" }}>
                    {uploadBusy ? "Feltöltés folyamatban…" : "Kattints a .bin fájl kiválasztásához"}
                  </div>
                </div>
                {uploadError   && <div className="dv-alert dv-alert-error"   style={{marginTop:8}}><span>⚠️</span>{uploadError}</div>}
                {uploadSuccess && <div className="dv-alert dv-alert-success" style={{marginTop:8}}><span>✅</span>{uploadSuccess}</div>}
              </div>

              {/* Verziólista */}
              <div style={{ background:"var(--sl-surface)", border:"1px solid var(--sl-border)", borderRadius:14, overflow:"hidden" }}>
                <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--sl-border)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div style={{ fontSize:13, fontWeight:800, color:"var(--sl-text)", fontFamily:"'Nunito',sans-serif" }}>📋 Elérhető verziók</div>
                  <button className="dv-btn dv-btn-ghost dv-btn-sm" onClick={() => void loadReleases()} disabled={releasesLoading} type="button">🔄</button>
                </div>
                {releasesLoading ? (
                  <div style={{ padding:24, textAlign:"center", color:"var(--sl-muted)", fontSize:13 }}>⏳ Betöltés…</div>
                ) : releases.length === 0 ? (
                  <div style={{ padding:24, textAlign:"center", color:"var(--sl-muted)", fontSize:13 }}>
                    <div style={{ fontSize:32, marginBottom:8 }}>📭</div>Még nincs feltöltött firmware.
                  </div>
                ) : releases.map(r => (
                  <div key={r.id} className="dv-fw-item">
                    <div>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                        <span className="dv-fw-version">{r.version}</span>
                        {r.mandatory && <span className="dv-badge" style={{ background:"#fef2f2", color:"#dc2626", borderColor:"#fecaca", fontSize:11 }}>⚠️ Kötelező</span>}
                        {r.targetClass !== "ALL" && <span className="dv-badge" style={{ background:"var(--sl-bg)", color:"var(--sl-muted)", borderColor:"var(--sl-border)", fontSize:11 }}>{r.targetClass}</span>}
                      </div>
                      <div className="dv-fw-meta">
                        <span>💾 {(r.sizeBytes/1024).toFixed(0)} KB</span>
                        <span>🔐 {r.sha256.slice(0,12)}…</span>
                        <span>📅 {new Date(r.createdAt).toLocaleDateString("hu-HU")}</span>
                        <span>👤 {r.createdBy?.displayName ?? r.createdBy?.email ?? "?"}</span>
                        {r.notes && <span>📝 {r.notes}</span>}
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:6 }}>
                      <a href={r.fileUrl} download className="dv-btn dv-btn-ghost dv-btn-sm">⬇️</a>
                      <button className="dv-btn dv-btn-danger dv-btn-sm" type="button"
                        onClick={() => void deleteRelease(r.id, r.version)}>🗑</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Eszközök OTA státusza */}
              <div style={{ background:"var(--sl-surface)", border:"1px solid var(--sl-border)", borderRadius:14, overflow:"hidden" }}>
                <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--sl-border)" }}>
                  <div style={{ fontSize:13, fontWeight:800, color:"var(--sl-text)", fontFamily:"'Nunito',sans-serif" }}>🔊 Eszközök frissítési állapota</div>
                </div>
                {devices.filter(d => !d.isVirtualPlayer).map(d => {
                  const s2  = (d.otaStatus ?? "UP_TO_DATE") as OtaStatus;
                  const b2  = OTA_STATUS_BADGE[s2] ?? OTA_STATUS_BADGE.UP_TO_DATE;
                  const ver = d.otaVersion ?? d.firmwareVersion;
                  return (
                    <div key={d.deviceId} style={{ padding:"10px 16px", borderBottom:"1px solid var(--sl-border)", display:"flex", alignItems:"center", gap:12 }}>
                      <span style={{ width:7, height:7, borderRadius:"50%", background:isDeviceOnline(d)?"#22c55e":"#94a3b8", flexShrink:0 }} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:"var(--sl-text)" }}>{d.name}</div>
                        <div style={{ fontSize:11, color:"var(--sl-muted)", marginTop:2 }}>
                          FW: {d.firmwareVersion ?? "–"}{ver && ver !== d.firmwareVersion && ` → ${ver}`}
                        </div>
                      </div>
                      <span className="dv-badge" style={{ background:b2.bg, color:b2.color, borderColor:b2.border, fontSize:11 }}>
                        {b2.icon} {b2.label}
                      </span>
                    </div>
                  );
                })}
                {devices.filter(d => !d.isVirtualPlayer).length === 0 && (
                  <div style={{ padding:20, textAlign:"center", color:"var(--sl-muted)", fontSize:13 }}>Nincs fizikai eszköz</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
    </div>
  );
}