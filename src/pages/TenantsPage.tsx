import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useNavigate } from "react-router-dom";

type TenantDto = { id:string; name:string; domain?:string|null; isActive:boolean; createdAt?:string|null; address?:string|null; directorName?:string|null; directorPhone?:string|null; directorEmail?:string|null; eduId?:string|null; };
type FormState = { name:string; domain:string; isActive:boolean; address:string; directorName:string; directorPhone:string; directorEmail:string; eduId:string; };
const EMPTY_FORM:FormState = { name:"",domain:"",isActive:true,address:"",directorName:"",directorPhone:"",directorEmail:"",eduId:"" };

function fmtDT(iso?:string|null) { if (!iso) return "–"; const d=new Date(iso); return isNaN(d.getTime())?"–":d.toLocaleString("hu-HU"); }
function safeErr(e:unknown):string {
  if (typeof e==="string") return e;
  if (e&&typeof e==="object") { const a=e as any; return a?.data?.message||a?.data?.error||a?.message||"Ismeretlen hiba"; }
  return "Ismeretlen hiba";
}

const CSS = `
  .tp-hdr{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap}
  .tp-title{font-family:'Nunito',sans-serif;font-size:22px;font-weight:900;color:var(--sl-text);letter-spacing:-0.5px}
  .tp-subtitle{font-size:13px;color:var(--sl-muted);margin-top:3px}
  .tp-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .tp-search{padding:9px 13px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-surface);color:var(--sl-text);font-size:13.5px;outline:none;transition:all 0.15s;width:260px;font-family:inherit}
  .tp-search:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.11)}
  .tp-search::placeholder{color:var(--sl-muted)}
  .tp-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:11px;border:none;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.15s;font-family:'Nunito',inherit;white-space:nowrap}
  .tp-btn:disabled{opacity:0.55;cursor:not-allowed}
  .tp-btn-primary{background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;box-shadow:0 3px 10px rgba(99,102,241,0.28)}
  .tp-btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 5px 14px rgba(99,102,241,0.36)}
  .tp-btn-ghost{background:var(--sl-bg);border:1.5px solid var(--sl-border);color:var(--sl-text-2)}
  .tp-btn-ghost:hover:not(:disabled){background:var(--sl-border)}
  .tp-btn-danger{background:#fff5f5;border:1.5px solid #fecaca;color:#dc2626}
  .tp-btn-danger:hover:not(:disabled){background:#fee2e2}
  .tp-btn-sm{padding:5px 11px;font-size:12px;border-radius:8px}
  .tp-card{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(59,130,246,0.07)}
  .tp-table{width:100%;border-collapse:collapse;font-size:13.5px}
  .tp-table th{text-align:left;padding:10px 16px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;color:var(--sl-muted);border-bottom:1px solid var(--sl-border);background:var(--sl-bg);white-space:nowrap;font-family:'Nunito',sans-serif}
  .tp-table td{padding:12px 16px;border-bottom:1px solid var(--sl-border);color:var(--sl-text);vertical-align:middle}
  .tp-table tr:last-child td{border-bottom:none}
  .tp-table tr:hover td{background:rgba(59,130,246,0.03)}
  .tp-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:700;border:1px solid;white-space:nowrap;font-family:'Nunito',sans-serif}
  .tp-alert{padding:10px 14px;border-radius:11px;font-size:13px;display:flex;align-items:flex-start;gap:8px;margin-bottom:14px}
  .tp-alert-error{background:#fef2f2;border:1px solid #fecaca;color:#dc2626}
  .tp-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.44);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;animation:tpFade 0.15s ease}
  .tp-modal{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:22px;box-shadow:0 20px 60px rgba(0,0,0,0.18);width:100%;max-width:600px;max-height:90vh;overflow-y:auto;animation:tpSlide 0.2s ease}
  .tp-modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--sl-border);position:sticky;top:0;background:var(--sl-surface);z-index:1}
  .tp-modal-title{font-family:'Nunito',sans-serif;font-size:16px;font-weight:900;color:var(--sl-text);display:flex;align-items:center;gap:8px}
  .tp-modal-body{padding:20px 22px;display:flex;flex-direction:column;gap:14px}
  .tp-modal-footer{padding:14px 22px;border-top:1px solid var(--sl-border);display:flex;justify-content:flex-end;gap:10px}
  .tp-close{width:32px;height:32px;border-radius:8px;border:1.5px solid var(--sl-border);background:var(--sl-bg);color:var(--sl-muted);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s}
  .tp-close:hover{background:var(--sl-border);color:var(--sl-text)}
  .tp-label{display:block;font-size:12px;font-weight:800;color:var(--sl-text-2);margin-bottom:5px;letter-spacing:0.2px;font-family:'Nunito',sans-serif}
  .tp-input,.tp-select{width:100%;padding:9px 12px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg);color:var(--sl-text);font-size:13.5px;outline:none;transition:all 0.15s;font-family:inherit}
  .tp-input:focus,.tp-select:focus{border-color:#3b82f6;background:var(--sl-surface);box-shadow:0 0 0 3px rgba(59,130,246,0.11)}
  .tp-input::placeholder{color:var(--sl-muted)}
  .tp-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .tp-section-title{font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.7px;color:var(--sl-muted);padding:10px 0 6px;border-top:1px solid var(--sl-border);margin-top:6px}
  .tp-check-row{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--sl-text-2)}
  @keyframes tpFade{from{opacity:0}to{opacity:1}}
  @keyframes tpSlide{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}
  @media(max-width:600px){.tp-grid2{grid-template-columns:1fr}.tp-search{width:100%}}
`;

function Modal({ title, icon, onClose, children }: { title:string; icon:string; onClose:()=>void; children:React.ReactNode }) {
  return (
    <div className="tp-overlay" onClick={onClose}>
      <div className="tp-modal" onClick={e => e.stopPropagation()}>
        <div className="tp-modal-hdr">
          <div className="tp-modal-title"><span>{icon}</span>{title}</div>
          <button className="tp-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function TenantsPage() {
  const { state } = useAuth();
  const navigate  = useNavigate();

  useEffect(() => {
    if (state.status === "authed" && (state.user as any)?.role !== "SUPER_ADMIN") navigate("/app", { replace:true });
  }, [state, navigate]);

  const [loading, setLoading]   = useState(false);
  const [tenants, setTenants]   = useState<TenantDto[]>([]);
  const [error, setError]       = useState<string|null>(null);
  const [q, setQ]               = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen]     = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selected, setSelected] = useState<TenantDto|null>(null);
  const [form, setForm]         = useState<FormState>(EMPTY_FORM);
  const [busyAction, setBusyAction] = useState<null|"create"|"update"|"delete">(null);

  async function load() {
    setLoading(true); setError(null);
    try { const r = await apiFetch<{ok:boolean;tenants:TenantDto[]}>("/admin/tenants"); setTenants(Array.isArray(r?.tenants)?r.tenants:[]); }
    catch (e) { setError(safeErr(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase(); if (!n) return tenants;
    return tenants.filter(t => [t.name,t.domain,t.eduId,t.directorName].join(" ").toLowerCase().includes(n));
  }, [q, tenants]);

  function openCreate() { setSelected(null); setForm(EMPTY_FORM); setIsCreateOpen(true); }
  function openEdit(t:TenantDto) {
    setSelected(t); setForm({ name:t.name,domain:t.domain??"",isActive:t.isActive,address:t.address??"",directorName:t.directorName??"",directorPhone:t.directorPhone??"",directorEmail:t.directorEmail??"",eduId:t.eduId??"" });
    setIsEditOpen(true);
  }
  function openDetail(t:TenantDto) { setSelected(t); setIsDetailOpen(true); }

  async function submitCreate() {
    if (!form.name.trim()) { setError("Az intézmény neve kötelező."); return; }
    setBusyAction("create");
    try {
      const r = await apiFetch<{ok:boolean}>("/admin/tenants",{ method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ name:form.name.trim(), domain:form.domain.trim()||null, isActive:form.isActive, address:form.address.trim()||null, directorName:form.directorName.trim()||null, directorPhone:form.directorPhone.trim()||null, directorEmail:form.directorEmail.trim()||null, eduId:form.eduId.trim()||null }) });
      if (!r?.ok) throw new Error("Backend hiba");
      setIsCreateOpen(false); await load();
    } catch (e) { setError(safeErr(e)); }
    finally { setBusyAction(null); }
  }
  async function submitUpdate() {
    if (!selected||!form.name.trim()) { setError("Az intézmény neve kötelező."); return; }
    setBusyAction("update");
    try {
      const r = await apiFetch<{ok:boolean}>(`/admin/tenants/${selected.id}`,{ method:"PATCH", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ name:form.name.trim(), domain:form.domain.trim()||null, isActive:form.isActive, address:form.address.trim()||null, directorName:form.directorName.trim()||null, directorPhone:form.directorPhone.trim()||null, directorEmail:form.directorEmail.trim()||null, eduId:form.eduId.trim()||null }) });
      if (!r?.ok) throw new Error("Backend hiba");
      setIsEditOpen(false); setSelected(null); await load();
    } catch (e) { setError(safeErr(e)); }
    finally { setBusyAction(null); }
  }
  async function doDelete(t:TenantDto) {
    if (!window.confirm(`Törlöd az intézményt? (${t.name})`)) return;
    setBusyAction("delete");
    try {
      const r = await apiFetch<{ok:boolean}>(`/admin/tenants/${t.id}`,{method:"DELETE"});
      if (!r?.ok) throw new Error("Backend hiba");
      await load();
    } catch (e) { setError(safeErr(e)); }
    finally { setBusyAction(null); }
  }

  function TenantForm() {
    return (
      <>
        <div className="tp-grid2">
          <div>
            <label className="tp-label">Intézmény neve *</label>
            <input className="tp-input" value={form.name} onChange={e => setForm(s=>({...s,name:e.target.value}))} placeholder="pl. Kossuth Lajos Általános Iskola" />
          </div>
          <div>
            <label className="tp-label">Domain / subdomain</label>
            <input className="tp-input" value={form.domain} onChange={e => setForm(s=>({...s,domain:e.target.value}))} placeholder="pl. kossuth.schoollive.hu" />
          </div>
        </div>
        <label className="tp-check-row">
          <input type="checkbox" checked={form.isActive} onChange={e => setForm(s=>({...s,isActive:e.target.checked}))} />
          Aktív intézmény
        </label>
        <div className="tp-section-title">🏫 Kapcsolattartó / Igazgató</div>
        <div className="tp-grid2">
          <div>
            <label className="tp-label">Igazgató neve</label>
            <input className="tp-input" value={form.directorName} onChange={e => setForm(s=>({...s,directorName:e.target.value}))} placeholder="pl. Nagy István" />
          </div>
          <div>
            <label className="tp-label">Telefon</label>
            <input className="tp-input" value={form.directorPhone} onChange={e => setForm(s=>({...s,directorPhone:e.target.value}))} placeholder="+36 20 123 4567" />
          </div>
        </div>
        <div>
          <label className="tp-label">E-mail</label>
          <input className="tp-input" type="email" value={form.directorEmail} onChange={e => setForm(s=>({...s,directorEmail:e.target.value}))} placeholder="igazgato@iskola.hu" />
        </div>
        <div className="tp-section-title">📋 Egyéb adatok</div>
        <div className="tp-grid2">
          <div>
            <label className="tp-label">Cím</label>
            <input className="tp-input" value={form.address} onChange={e => setForm(s=>({...s,address:e.target.value}))} placeholder="1234 Budapest, Fő u. 1." />
          </div>
          <div>
            <label className="tp-label">OM azonosító</label>
            <input className="tp-input" value={form.eduId} onChange={e => setForm(s=>({...s,eduId:e.target.value}))} placeholder="032456" />
          </div>
        </div>
      </>
    );
  }

  return (
    <div>
      <style>{CSS}</style>

      <div className="tp-hdr">
        <div>
          <div className="tp-title">🏫 Intézmények</div>
          <div className="tp-subtitle">Tenant-szintű intézmények és beállításaik kezelése.</div>
        </div>
        <div className="tp-actions">
          <input className="tp-search" placeholder="🔍 Keresés…" value={q} onChange={e => setQ(e.target.value)} />
          <button className="tp-btn tp-btn-primary" onClick={openCreate} disabled={loading} type="button">＋ Új intézmény</button>
          <button className="tp-btn tp-btn-ghost" onClick={() => void load()} disabled={loading} type="button">🔄</button>
        </div>
      </div>

      {error && <div className="tp-alert tp-alert-error"><span>⚠️</span>{error}</div>}

      <div className="tp-card">
        <div style={{ overflowX:"auto" }}>
          <table className="tp-table">
            <thead>
              <tr>
                <th>Intézmény</th><th>Domain</th><th>Státusz</th><th>OM azonosító</th><th>Létrehozva</th><th style={{ textAlign:"right" }}>Műveletek</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} style={{ textAlign:"center", padding:"40px", color:"var(--sl-muted)" }}>
                  <span style={{ fontSize:22 }}>⏳</span><div style={{ fontSize:13, marginTop:8 }}>Betöltés…</div>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign:"center", padding:"48px", color:"var(--sl-muted)" }}>
                  <div style={{ fontSize:40, marginBottom:10 }}>🏫</div>
                  <div style={{ fontWeight:700, fontFamily:"'Nunito',sans-serif" }}>Nincs intézmény</div>
                </td></tr>
              )}
              {filtered.map(t => (
                <tr key={t.id}>
                  <td>
                    <div style={{ fontWeight:700, fontSize:14 }}>{t.name}</div>
                    {t.directorName && <div style={{ fontSize:11, color:"var(--sl-muted)", marginTop:2 }}>👤 {t.directorName}</div>}
                  </td>
                  <td style={{ fontSize:12, fontFamily:"monospace" }}>{t.domain || <span style={{ color:"var(--sl-muted)" }}>—</span>}</td>
                  <td>
                    <span className="tp-badge" style={t.isActive
                      ? {background:"#f0fdf4",color:"#15803d",borderColor:"#bbf7d0"}
                      : {background:"#fef2f2",color:"#dc2626",borderColor:"#fecaca"}}>
                      {t.isActive ? "✓ Aktív" : "✗ Inaktív"}
                    </span>
                  </td>
                  <td style={{ fontSize:12 }}>{t.eduId || <span style={{ color:"var(--sl-muted)" }}>—</span>}</td>
                  <td style={{ fontSize:12 }}>{fmtDT(t.createdAt)}</td>
                  <td style={{ textAlign:"right" }}>
                    <div style={{ display:"flex", gap:6, justifyContent:"flex-end" }}>
                      <button className="tp-btn tp-btn-ghost tp-btn-sm" onClick={() => openDetail(t)} type="button">🔍 Részletek</button>
                      <button className="tp-btn tp-btn-ghost tp-btn-sm" onClick={() => openEdit(t)} disabled={!!busyAction} type="button">✏️ Szerkeszt</button>
                      <button className="tp-btn tp-btn-danger tp-btn-sm" onClick={() => void doDelete(t)} disabled={busyAction==="delete"} type="button">🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create modal */}
      {isCreateOpen && (
        <Modal title="Új intézmény" icon="🏫" onClose={() => setIsCreateOpen(false)}>
          <div className="tp-modal-body"><TenantForm /></div>
          <div className="tp-modal-footer">
            <button className="tp-btn tp-btn-ghost" onClick={() => setIsCreateOpen(false)} disabled={busyAction==="create"} type="button">Mégse</button>
            <button className="tp-btn tp-btn-primary" onClick={() => void submitCreate()} disabled={busyAction==="create"} type="button">
              {busyAction==="create" ? "⏳ Létrehozás…" : "✅ Létrehoz"}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit modal */}
      {isEditOpen && selected && (
        <Modal title={`Szerkesztés: ${selected.name}`} icon="✏️" onClose={() => setIsEditOpen(false)}>
          <div className="tp-modal-body"><TenantForm /></div>
          <div className="tp-modal-footer">
            <button className="tp-btn tp-btn-ghost" onClick={() => setIsEditOpen(false)} disabled={busyAction==="update"} type="button">Mégse</button>
            <button className="tp-btn tp-btn-primary" onClick={() => void submitUpdate()} disabled={busyAction==="update"} type="button">
              {busyAction==="update" ? "⏳ Mentés…" : "💾 Mentés"}
            </button>
          </div>
        </Modal>
      )}

      {/* Detail modal */}
      {isDetailOpen && selected && (
        <Modal title={selected.name} icon="🏫" onClose={() => setIsDetailOpen(false)}>
          <div className="tp-modal-body">
            {[
              ["Státusz", selected.isActive ? "✓ Aktív" : "✗ Inaktív"],
              ["Domain", selected.domain||"—"],
              ["OM azonosító", selected.eduId||"—"],
              ["Cím", selected.address||"—"],
              ["Igazgató", selected.directorName||"—"],
              ["Telefon", selected.directorPhone||"—"],
              ["E-mail", selected.directorEmail||"—"],
              ["Létrehozva", fmtDT(selected.createdAt)],
            ].map(([k,v]) => (
              <div key={k} style={{ display:"flex", gap:16, alignItems:"flex-start" }}>
                <div style={{ minWidth:110, fontSize:12, fontWeight:800, color:"var(--sl-muted)", fontFamily:"'Nunito',sans-serif", textTransform:"uppercase", letterSpacing:"0.5px", paddingTop:2 }}>{k}</div>
                <div style={{ fontSize:13.5, color:"var(--sl-text)" }}>{v}</div>
              </div>
            ))}
          </div>
          <div className="tp-modal-footer">
            <button className="tp-btn tp-btn-ghost" onClick={() => { setIsDetailOpen(false); openEdit(selected); }} type="button">✏️ Szerkeszt</button>
            <button className="tp-btn tp-btn-ghost" onClick={() => setIsDetailOpen(false)} type="button">Bezár</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
