import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

type BackendRole = "SUPER_ADMIN"|"TENANT_ADMIN"|"ORG_ADMIN"|"TEACHER"|"OPERATOR"|"PLAYER"|string;
type UiRole = "ADMIN"|"EDITOR"|"CONTRIBUTOR"|"PLAYER";
type UserDto = { id:string; email:string; displayName?:string|null; role:BackendRole; tenantId?:string|null; orgUnitId?:string|null; isActive?:boolean; lastLoginAt?:string|null; createdAt?:string|null; };

const UI_ROLE_OPTIONS: Array<{uiRole:UiRole;label:string;description:string;backendRole:BackendRole}> = [
  { uiRole:"ADMIN",       label:"Admin",        description:"Tenant admin: teljes körű tenant jogosultság.", backendRole:"TENANT_ADMIN" },
  { uiRole:"EDITOR",      label:"Szerkesztő",   description:"Üzenetküldés, ütemezett jelzések kezelése.",   backendRole:"ORG_ADMIN" },
  { uiRole:"CONTRIBUTOR", label:"Közreműködő",  description:"Azonnali üzenetek küldése.",                    backendRole:"OPERATOR" },
  { uiRole:"PLAYER",      label:"Player",       description:"Player nézet jogosultsága.",                    backendRole:"PLAYER" },
];

function formatDT(iso?:string|null) { if (!iso) return "–"; const d=new Date(iso); return isNaN(d.getTime())?"–":d.toLocaleString("hu-HU"); }
function safeErr(e:unknown):string {
  if (typeof e==="string") return e;
  if (e&&typeof e==="object") { const a=e as any; return a?.data?.message||a?.data?.error||a?.message||"Ismeretlen hiba"; }
  return "Ismeretlen hiba";
}
function uiToBackend(uiRole:UiRole):BackendRole { return UI_ROLE_OPTIONS.find(x=>x.uiRole===uiRole)?.backendRole??"OPERATOR"; }
function backendToUi(role:BackendRole):UiRole {
  if (role==="TENANT_ADMIN") return "ADMIN"; if (role==="ORG_ADMIN") return "EDITOR"; if (role==="PLAYER") return "PLAYER"; return "CONTRIBUTOR";
}

const ROLE_COLORS:Record<string,{bg:string;color:string;border:string}> = {
  SUPER_ADMIN: {bg:"#f5f3ff",color:"#7c3aed",border:"#ddd6fe"},
  TENANT_ADMIN:{bg:"#eff6ff",color:"#1d4ed8",border:"#bfdbfe"},
  ORG_ADMIN:   {bg:"#f0fdf4",color:"#15803d",border:"#bbf7d0"},
  OPERATOR:    {bg:"#fffbeb",color:"#d97706",border:"#fde68a"},
  TEACHER:     {bg:"#fffbeb",color:"#d97706",border:"#fde68a"},
  PLAYER:      {bg:"#f8fafc",color:"#64748b",border:"#e2e8f0"},
};

const CSS = `
  .us-hdr{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap}
  .us-title{font-family:'Nunito',sans-serif;font-size:22px;font-weight:900;color:var(--sl-text);letter-spacing:-0.5px}
  .us-subtitle{font-size:13px;color:var(--sl-muted);margin-top:3px}
  .us-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .us-search{padding:9px 13px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-surface);color:var(--sl-text);font-size:13.5px;outline:none;transition:all 0.15s;width:280px;font-family:inherit}
  .us-search:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.11)}
  .us-search::placeholder{color:var(--sl-muted)}
  .us-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:11px;border:none;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.15s;font-family:'Nunito',inherit;white-space:nowrap}
  .us-btn:disabled{opacity:0.55;cursor:not-allowed}
  .us-btn-primary{background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;box-shadow:0 3px 10px rgba(99,102,241,0.28)}
  .us-btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 5px 14px rgba(99,102,241,0.36)}
  .us-btn-ghost{background:var(--sl-bg);border:1.5px solid var(--sl-border);color:var(--sl-text-2)}
  .us-btn-ghost:hover:not(:disabled){background:var(--sl-border)}
  .us-btn-danger{background:#fff5f5;border:1.5px solid #fecaca;color:#dc2626}
  .us-btn-danger:hover:not(:disabled){background:#fee2e2}
  .us-btn-sm{padding:5px 11px;font-size:12px;border-radius:8px}
  .us-card{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(59,130,246,0.07)}
  .us-table{width:100%;border-collapse:collapse;font-size:13.5px}
  .us-table th{text-align:left;padding:10px 16px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;color:var(--sl-muted);border-bottom:1px solid var(--sl-border);background:var(--sl-bg);white-space:nowrap;font-family:'Nunito',sans-serif}
  .us-table td{padding:12px 16px;border-bottom:1px solid var(--sl-border);color:var(--sl-text);vertical-align:middle}
  .us-table tr:last-child td{border-bottom:none}
  .us-table tr:hover td{background:rgba(59,130,246,0.03)}
  .us-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:700;border:1px solid;white-space:nowrap;font-family:'Nunito',sans-serif}
  .us-alert{padding:10px 14px;border-radius:11px;font-size:13px;display:flex;align-items:flex-start;gap:8px;margin-bottom:14px}
  .us-alert-error{background:#fef2f2;border:1px solid #fecaca;color:#dc2626}
  .us-empty{text-align:center;padding:48px;color:var(--sl-muted)}
  .us-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.44);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;animation:usFade 0.15s ease}
  .us-modal{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:22px;box-shadow:0 20px 60px rgba(0,0,0,0.18);width:100%;max-width:560px;max-height:90vh;overflow-y:auto;animation:usSlide 0.2s ease}
  .us-modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--sl-border);position:sticky;top:0;background:var(--sl-surface);z-index:1}
  .us-modal-title{font-family:'Nunito',sans-serif;font-size:16px;font-weight:900;color:var(--sl-text);display:flex;align-items:center;gap:8px}
  .us-modal-body{padding:20px 22px;display:flex;flex-direction:column;gap:14px}
  .us-modal-footer{padding:14px 22px;border-top:1px solid var(--sl-border);display:flex;justify-content:flex-end;gap:10px}
  .us-close{width:32px;height:32px;border-radius:8px;border:1.5px solid var(--sl-border);background:var(--sl-bg);color:var(--sl-muted);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s}
  .us-close:hover{background:var(--sl-border);color:var(--sl-text)}
  .us-label{display:block;font-size:12px;font-weight:800;color:var(--sl-text-2);margin-bottom:5px;letter-spacing:0.2px;font-family:'Nunito',sans-serif}
  .us-input,.us-select{width:100%;padding:9px 12px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg);color:var(--sl-text);font-size:13.5px;outline:none;transition:all 0.15s;font-family:inherit}
  .us-input:focus,.us-select:focus{border-color:#3b82f6;background:var(--sl-surface);box-shadow:0 0 0 3px rgba(59,130,246,0.11)}
  .us-input::placeholder{color:var(--sl-muted)}
  .us-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .us-hint{font-size:11px;color:var(--sl-muted);margin-top:4px}
  .us-check-row{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--sl-text-2)}
  .us-meta-row{font-size:11px;color:var(--sl-muted);display:flex;gap:12px;flex-wrap:wrap}
  @keyframes usFade{from{opacity:0}to{opacity:1}}
  @keyframes usSlide{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}
  @media(max-width:600px){.us-grid2{grid-template-columns:1fr}.us-search{width:100%}}
`;

function Modal({ title, icon, onClose, children }: { title:string; icon:string; onClose:()=>void; children:React.ReactNode }) {
  return (
    <div className="us-overlay" onClick={onClose}>
      <div className="us-modal" onClick={e => e.stopPropagation()}>
        <div className="us-modal-hdr">
          <div className="us-modal-title"><span>{icon}</span>{title}</div>
          <button className="us-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

type UserFormState = { email:string; displayName:string; uiRole:UiRole; password:string; isActive:boolean };

export default function Users() {
  const { state } = useAuth();
  const role = state.status === "authed" ? (state.user as any)?.role || "" : "";
  const canDelete = role === "SUPER_ADMIN" || role === "TENANT_ADMIN";
  const [loading, setLoading] = useState(false);
  const [users, setUsers]     = useState<UserDto[]>([]);
  const [error, setError]     = useState<string|null>(null);
  const [q, setQ]             = useState("");
  const [isCreateOpen, setIsCreateOpen]   = useState(false);
  const [isEditOpen, setIsEditOpen]       = useState(false);
  const [isMessagesOpen, setIsMessagesOpen] = useState(false);
  const [selectedUser, setSelectedUser]   = useState<UserDto|null>(null);
  const [form, setForm] = useState<UserFormState>({ email:"", displayName:"", uiRole:"CONTRIBUTOR", password:"", isActive:true });
  const [busyAction, setBusyAction] = useState<null|"create"|"update"|"delete">(null);

  async function loadUsers() {
    setLoading(true); setError(null);
    try { const r = await apiFetch<{ok:boolean;users:UserDto[]}>("/admin/users"); setUsers(Array.isArray(r?.users)?r.users:[]); }
    catch (e) { setError(safeErr(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadUsers(); }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase(); if (!n) return users;
    return users.filter(u => [u.email,u.displayName,u.role,u.lastLoginAt,u.createdAt].join(" ").toLowerCase().includes(n));
  }, [q, users]);

  function openCreate() {
    setSelectedUser(null); setForm({ email:"",displayName:"",uiRole:"CONTRIBUTOR",password:"",isActive:true }); setIsCreateOpen(true);
  }
  function openEdit(u:UserDto) {
    setSelectedUser(u); setForm({ email:u.email??"",displayName:u.displayName??"",uiRole:backendToUi(u.role),password:"",isActive:typeof u.isActive==="boolean"?u.isActive:true }); setIsEditOpen(true);
  }
  async function submitCreate() {
    setError(null);
    if (!form.email.trim()) { setError("E-mail megadása kötelező."); return; }
    if (!form.password.trim()) { setError("Jelszó megadása kötelező."); return; }
    setBusyAction("create");
    try {
      const r = await apiFetch<{ok:boolean}>("/admin/users",{ method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ email:form.email.trim(), displayName:form.displayName.trim()||null, role:uiToBackend(form.uiRole), password:form.password, isActive:form.isActive }) });
      if (!r?.ok) throw new Error("A backend nem ok státusszal válaszolt.");
      setIsCreateOpen(false); await loadUsers();
    } catch (e) { setError("Nem sikerült létrehozni. "+safeErr(e)); }
    finally { setBusyAction(null); }
  }
  async function submitUpdate() {
    if (!selectedUser) return; setError(null);
    if (!form.email.trim()) { setError("E-mail kötelező."); return; }
    setBusyAction("update");
    try {
      const payload:Record<string,unknown> = { email:form.email.trim(), displayName:form.displayName.trim()||null, role:uiToBackend(form.uiRole), isActive:form.isActive };
      if (form.password.trim()) payload.password=form.password;
      const r = await apiFetch<{ok:boolean}>(`/admin/users/${selectedUser.id}`,{ method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
      if (!r?.ok) throw new Error("A backend nem ok státusszal válaszolt.");
      setIsEditOpen(false); setSelectedUser(null); await loadUsers();
    } catch (e) { setError("Nem sikerült módosítani. "+safeErr(e)); }
    finally { setBusyAction(null); }
  }
  async function doDeactivate(u:UserDto) {
    if (!window.confirm(`Biztos deaktiválod? (${u.email})`)) return;
    setError(null); setBusyAction("delete");
    try {
      const r = await apiFetch<{ok:boolean}>(`/admin/users/${u.id}`,{method:"DELETE"});
      if (!r?.ok) throw new Error("A backend nem ok státusszal válaszolt.");
      await loadUsers();
    } catch (e) { setError("Nem sikerült deaktiválni. "+safeErr(e)); }
    finally { setBusyAction(null); }
  }
  async function doHardDelete(u:UserDto) {
    if (!window.confirm(`Véglegesen törlöd? Ez nem visszafordítható! (${u.email})`)) return;
    setError(null); setBusyAction("delete");
    try {
      const r = await apiFetch<{ok:boolean}>(`/admin/users/${u.id}`,{method:"DELETE"});
      if (!r?.ok) throw new Error("A backend nem ok státusszal válaszolt.");
      await loadUsers();
    } catch (e) { setError("Nem sikerült törölni. "+safeErr(e)); }
    finally { setBusyAction(null); }
  }

  function UserForm() {
    return (
      <>
        <div className="us-grid2">
          <div>
            <label className="us-label">E-mail cím *</label>
            <input className="us-input" type="email" value={form.email} onChange={e => setForm(s=>({...s,email:e.target.value}))} placeholder="pl. tanar@iskola.hu" />
          </div>
          <div>
            <label className="us-label">Megjelenített név</label>
            <input className="us-input" value={form.displayName} onChange={e => setForm(s=>({...s,displayName:e.target.value}))} placeholder="pl. Kiss Péter" />
            <div className="us-hint">Opcionális</div>
          </div>
        </div>
        <div className="us-grid2">
          <div>
            <label className="us-label">Szerepkör</label>
            <select className="us-select" value={form.uiRole} onChange={e => setForm(s=>({...s,uiRole:e.target.value as UiRole}))}>
              {UI_ROLE_OPTIONS.map(r => <option key={r.uiRole} value={r.uiRole}>{r.label}</option>)}
            </select>
            <div className="us-hint">{UI_ROLE_OPTIONS.find(r=>r.uiRole===form.uiRole)?.description}</div>
          </div>
          <div>
            <label className="us-label">Státusz</label>
            <label className="us-check-row" style={{ marginTop:10 }}>
              <input type="checkbox" checked={form.isActive} onChange={e => setForm(s=>({...s,isActive:e.target.checked}))} />
              Aktív felhasználó
            </label>
          </div>
        </div>
        <div>
          <label className="us-label">Jelszó</label>
          <input type="password" className="us-input" value={form.password} onChange={e => setForm(s=>({...s,password:e.target.value}))} placeholder="Minimum 6 karakter" />
          <div className="us-hint">{isEditOpen ? "Ha üres, nem változik." : "Kötelező új felhasználónál."}</div>
        </div>
      </>
    );
  }

  return (
    <div>
      <style>{CSS}</style>

      <div className="us-hdr">
        <div>
          <div className="us-title">👥 Felhasználók</div>
          <div className="us-subtitle">Intézményi felhasználók és jogosultságok kezelése.</div>
        </div>
        <div className="us-actions">
          <input className="us-search" placeholder="🔍 Keresés…" value={q} onChange={e => setQ(e.target.value)} />
          <button className="us-btn us-btn-primary" onClick={openCreate} disabled={loading} type="button">＋ Új felhasználó</button>
          <button className="us-btn us-btn-ghost" onClick={() => void loadUsers()} disabled={loading} type="button">🔄</button>
        </div>
      </div>

      {error && <div className="us-alert us-alert-error"><span>⚠️</span>{error}</div>}

      <div className="us-card">
        <div style={{ overflowX:"auto" }}>
          <table className="us-table">
            <thead>
              <tr>
                <th>E-mail</th><th>Név</th><th>Státusz</th><th>Szerepkör</th><th>Létrehozva</th><th>Utolsó belépés</th><th style={{ textAlign:"right" }}>Műveletek</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} style={{ textAlign:"center", padding:"40px", color:"var(--sl-muted)" }}>
                  <span style={{ fontSize:22 }}>⏳</span><div style={{ fontSize:13, marginTop:8 }}>Betöltés…</div>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7}>
                  <div className="us-empty">
                    <div style={{ fontSize:40, marginBottom:10 }}>👤</div>
                    <div style={{ fontWeight:700, fontFamily:"'Nunito',sans-serif" }}>Nincs találat</div>
                  </div>
                </td></tr>
              )}
              {filtered.map(u => {
                const rc = ROLE_COLORS[u.role] || { bg:"var(--sl-bg)", color:"var(--sl-muted)", border:"var(--sl-border)" };
                const active = typeof u.isActive==="boolean" ? u.isActive : true;
                return (
                  <tr key={u.id}>
                    <td><strong style={{ fontWeight:700, fontSize:13.5 }}>{u.email}</strong></td>
                    <td>{u.displayName || <span style={{ color:"var(--sl-muted)" }}>—</span>}</td>
                    <td>
                      <span className="us-badge" style={active
                        ? {background:"#f0fdf4",color:"#15803d",borderColor:"#bbf7d0"}
                        : {background:"#fef2f2",color:"#dc2626",borderColor:"#fecaca"}}>
                        {active ? "✓ Aktív" : "✗ Inaktív"}
                      </span>
                    </td>
                    <td><span className="us-badge" style={{ background:rc.bg, color:rc.color, borderColor:rc.border }}>{u.role}</span></td>
                    <td style={{ fontSize:12 }}>{formatDT(u.createdAt)}</td>
                    <td style={{ fontSize:12 }}>{formatDT(u.lastLoginAt)}</td>
                    <td style={{ textAlign:"right" }}>
                      <div style={{ display:"flex", gap:6, justifyContent:"flex-end" }}>
                        <button className="us-btn us-btn-ghost us-btn-sm" onClick={() => { setSelectedUser(u); setIsMessagesOpen(true); }} type="button">📧</button>
                        <button className="us-btn us-btn-ghost us-btn-sm" onClick={() => openEdit(u)} disabled={!!busyAction} type="button">✏️ Szerkeszt</button>
                        <button className="us-btn us-btn-danger us-btn-sm" onClick={() => void doDeactivate(u)} disabled={busyAction==="delete"} type="button">🗑 Deaktivál</button>
                        {canDelete && (
                          <button className="us-btn us-btn-sm" style={{ background:"#dc2626", color:"#fff", border:"none" }} onClick={() => void doHardDelete(u)} disabled={busyAction==="delete"} type="button">🗑 Törlés</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create modal */}
      {isCreateOpen && (
        <Modal title="Új felhasználó" icon="👤" onClose={() => setIsCreateOpen(false)}>
          <div className="us-modal-body"><UserForm /></div>
          <div className="us-modal-footer">
            <button className="us-btn us-btn-ghost" onClick={() => setIsCreateOpen(false)} disabled={busyAction==="create"} type="button">Mégse</button>
            <button className="us-btn us-btn-primary" onClick={() => void submitCreate()} disabled={busyAction==="create"} type="button">
              {busyAction==="create" ? "⏳ Létrehozás…" : "✅ Létrehoz"}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit modal */}
      {isEditOpen && selectedUser && (
        <Modal title={`Szerkesztés: ${selectedUser.email}`} icon="✏️" onClose={() => setIsEditOpen(false)}>
          <div className="us-modal-body">
            <UserForm />
            <div className="us-meta-row">
              <span>Létrehozva: {formatDT(selectedUser.createdAt)}</span>
              <span>Utolsó belépés: {formatDT(selectedUser.lastLoginAt)}</span>
            </div>
          </div>
          <div className="us-modal-footer">
            <button className="us-btn us-btn-ghost" onClick={() => setIsEditOpen(false)} disabled={busyAction==="update"} type="button">Mégse</button>
            <button className="us-btn us-btn-primary" onClick={() => void submitUpdate()} disabled={busyAction==="update"} type="button">
              {busyAction==="update" ? "⏳ Mentés…" : "💾 Mentés"}
            </button>
          </div>
        </Modal>
      )}

      {/* Messages modal */}
      {isMessagesOpen && selectedUser && (
        <Modal title={`Üzenetek: ${selectedUser.email}`} icon="📧" onClose={() => setIsMessagesOpen(false)}>
          <div className="us-modal-body">
            <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:11, padding:"10px 14px", fontSize:13, color:"#d97706" }}>
              ⚠ Ez a nézet még nincs bekötve – a backend endpointot a következő lépésben implementáljuk.
            </div>
          </div>
          <div className="us-modal-footer">
            <button className="us-btn us-btn-ghost" onClick={() => setIsMessagesOpen(false)} type="button">Bezár</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
