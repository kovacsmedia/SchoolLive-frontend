import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

type DeviceClass = "SPEAKER" | "DISPLAY" | "MULTI";
type WifiSecurity = "OPEN" | "WPA2_PERSONAL" | "WPA3_PERSONAL" | "WPA2_ENTERPRISE";

type DeviceItem = {
  deviceId: string; name: string; deviceClass: DeviceClass;
  isOnline: boolean; ipAddress: string | null; firmwareVersion: string | null;
  secondsSinceLastSeen: number | null; isVirtualPlayer?: boolean;
};
type HealthResponse = { ok: boolean; devices: DeviceItem[] };
type PendingDevice  = { id: string; mac: string; ipAddress: string | null; firmwareVersion: string | null; lastSeenAt: string };
type PendingResponse = { ok: boolean; pending: PendingDevice[] };
type PendingWebPlayer = { id: string; mac: string; clientId: string | null; userId: string | null; ipAddress: string | null; userAgent: string | null; firstSeenAt: string; lastSeenAt: string };
type PendingWebResponse = { ok: boolean; pendingWeb: PendingWebPlayer[] };
type TenantItem     = { id: string; name: string };
type TenantsResponse = { ok: boolean; tenants: TenantItem[] };

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
  .dv-wp-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;font-family:'Nunito',sans-serif}
  .dv-wp-section{background:linear-gradient(135deg,#f0fdf4,#eff6ff);border:1.5px solid #bbf7d0;border-radius:13px;padding:13px 16px;margin-bottom:8px}
  .dv-wp-section-title{font-size:12px;font-weight:800;color:#15803d;font-family:'Nunito',sans-serif;margin-bottom:8px;display:flex;align-items:center;gap:6px}
  @keyframes dvFade{from{opacity:0}to{opacity:1}}
  @keyframes dvSlide{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}
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

  const [pendingWeb, setPendingWeb] = useState<PendingWebPlayer[]>([]);
  const [wpActivateForm, setWpActivateForm] = useState<{ pendingId: string; name: string } | null>(null);
  const [wpActivateBusy, setWpActivateBusy] = useState(false);
  const [wpActivateError, setWpActivateError] = useState<string | null>(null);
  const healthTimer = useRef<number | null>(null);
  const pendingTimer = useRef<number | null>(null);

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
    return devices.filter(d => [d.name,d.deviceClass,d.ipAddress,d.firmwareVersion].join(" ").toLowerCase().includes(n));
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
                <th>Eszköznév</th><th>Típus</th><th>Státusz</th><th>IP cím</th><th>Firmware</th><th>Utolsó aktivitás</th>
                {canWrite && <th style={{ textAlign:"right" }}>Műveletek</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={canWrite?7:6} style={{ textAlign:"center", padding:"40px", color:"var(--sl-muted)" }}>
                  <span style={{ fontSize:24 }}>⏳</span><div style={{ marginTop:8, fontSize:13 }}>Betöltés…</div>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={canWrite?7:6}>
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
                    <td style={{ fontSize:12 }}>
                      {d.isVirtualPlayer
                        ? <span className="dv-wp-badge">📱 WP</span>
                        : (d.firmwareVersion ?? <span style={{ color:"var(--sl-muted)" }}>—</span>)
                      }
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
    </div>
  );
}