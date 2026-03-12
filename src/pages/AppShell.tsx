import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

type TenantListItem = { id:string; name:string; domain?:string|null; isActive?:boolean|null; };
type TenantsResponse = { ok:true; tenants:TenantListItem[]; };
const ACTIVE_TENANT_KEY = "activeTenantId";

function safeGet(s:Storage,k:string){try{return s.getItem(k)}catch{return null}}
function safeSet(s:Storage,k:string,v:string){try{s.setItem(k,v)}catch{}}
function safeRemove(s:Storage,k:string){try{s.removeItem(k)}catch{}}

const NAV_ITEMS = [
  {to:"/app/devices",  label:"Eszközök",       icon:"🔊", roles:["all"]},
  {to:"/app/messages", label:"Üzenetek",        icon:"📢", roles:["all"]},
  {to:"/app/radio",    label:"Iskolai Rádió",   icon:"📻", roles:["SUPER_ADMIN","TENANT_ADMIN","ORG_ADMIN"]},
  {to:"/app/bells",    label:"Csengetési rend", icon:"🔔", roles:["SUPER_ADMIN","TENANT_ADMIN","ORG_ADMIN"]},
  {to:"/app/users",    label:"Felhasználók",    icon:"👥", roles:["SUPER_ADMIN","TENANT_ADMIN","ORG_ADMIN"]},
  {to:"/app/tenants",  label:"Intézmények",     icon:"🏫", roles:["SUPER_ADMIN"]},
];

const ROLE_LABELS:Record<string,string> = {
  SUPER_ADMIN:"Rendszergazda", TENANT_ADMIN:"Intézmény-adminisztrátor",
  ORG_ADMIN:"Szervezeti adminisztrátor", OPERATOR:"Operátor", TEACHER:"Pedagógus", PLAYER:"Player",
};

const THEME = `
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
:root{
  --sl-font:'Nunito','Segoe UI',sans-serif;
  --sl-blue:#3b82f6; --sl-blue-dark:#1d4ed8; --sl-blue-light:#eff6ff;
  --sl-indigo:#6366f1; --sl-purple:#8b5cf6; --sl-green:#22c55e; --sl-red:#ef4444;
  --sl-bg:#f1f5fd; --sl-surface:#fff; --sl-border:#e2eaf8;
  --sl-text:#1e293b; --sl-text-2:#475569; --sl-muted:#94a3b8;
  --sl-shadow:0 4px 20px rgba(59,130,246,0.11);
  --sl-shadow-sm:0 2px 8px rgba(59,130,246,0.08);
  --sl-r:12px; --sl-r-lg:18px; --sl-r-xl:22px;
}
@media(prefers-color-scheme:dark){
  :root{
    --sl-bg:#07101f; --sl-surface:#0d1b2e; --sl-border:#1a2d47;
    --sl-text:#f0f6ff; --sl-text-2:#8da4c0; --sl-muted:#4a6280;
    --sl-blue-light:#0c2040;
    --sl-shadow:0 4px 20px rgba(0,0,0,0.45);
    --sl-shadow-sm:0 2px 8px rgba(0,0,0,0.3);
  }
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--sl-font);background:var(--sl-bg);color:var(--sl-text)}

/* ── Sidebar ── */
.asl-sidebar{
  width:238px; min-height:100vh;
  background:var(--sl-surface); border-right:1px solid var(--sl-border);
  display:flex; flex-direction:column; flex-shrink:0;
  box-shadow:2px 0 18px rgba(59,130,246,0.07);
}
.asl-logo-area{
  padding:22px 18px 16px; border-bottom:1px solid var(--sl-border); text-align:center;
}
.asl-logo-area img{width:148px; height:auto}
.asl-inst-badge{
  margin-top:10px; display:inline-flex; align-items:center; gap:5px;
  padding:5px 12px; background:linear-gradient(135deg,#dbeafe,#ede9fe);
  border:1px solid #bfdbfe; border-radius:20px;
  font-size:11.5px; font-weight:800; color:var(--sl-blue-dark);
  max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.asl-inst-badge.warn{background:linear-gradient(135deg,#fffbeb,#fef3c7);border-color:#fde68a;color:#d97706}
.asl-nav-area{flex:1;padding:14px 10px;overflow-y:auto}
.asl-nav-link{
  display:flex; align-items:center; gap:11px;
  padding:10px 13px; border-radius:13px; text-decoration:none;
  font-size:14px; font-family:var(--sl-font); font-weight:600;
  color:var(--sl-text-2); border:1.5px solid transparent; transition:all 0.15s;
  margin-bottom:3px;
}
.asl-nav-link:hover{background:#cbd5e1;color:var(--sl-text)}
.asl-nav-link.active{
  font-weight:800; color:var(--sl-blue-dark);
  background:linear-gradient(135deg,#dbeafe,#ede9fe);
  border-color:#bfdbfe;
}
.asl-nav-dot{width:6px;height:6px;border-radius:50%;background:var(--sl-blue);margin-left:auto;flex-shrink:0}
.asl-nav-icon{font-size:19px;line-height:1;flex-shrink:0}
.asl-sidebar-footer{padding:12px 14px;border-top:1px solid var(--sl-border)}
.asl-user-card{
  display:flex; align-items:center; gap:10px;
  padding:10px 12px; border-radius:13px;
  background:var(--sl-blue-light); border:1px solid #dbeafe; margin-bottom:9px;
}
.asl-avatar{
  width:36px; height:36px; border-radius:50%;
  background:linear-gradient(135deg,var(--sl-blue),var(--sl-purple));
  color:#fff; font-family:var(--sl-font); font-weight:900; font-size:15px;
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
}
.asl-uname{font-size:12.5px;font-weight:800;color:var(--sl-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.asl-urole{font-size:11px;color:var(--sl-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.asl-logout{
  width:100%; padding:9px; border-radius:11px;
  border:1.5px solid #fecaca; background:#fff5f5; color:#dc2626;
  font-size:13px; font-weight:800; cursor:pointer;
  font-family:var(--sl-font); display:flex; align-items:center; justify-content:center; gap:7px;
  transition:all 0.15s;
}
.asl-logout:hover{background:#fee2e2;border-color:#fca5a5}

/* ── Topbar ── */
.asl-topbar{
  background:var(--sl-surface); border-bottom:1px solid var(--sl-border);
  padding:11px 22px; display:flex; align-items:center;
  justify-content:space-between; gap:16px; flex-wrap:wrap;
  position:sticky; top:0; z-index:10;
  box-shadow:0 1px 8px rgba(59,130,246,0.07);
}
.asl-topbar-title{
  font-family:var(--sl-font); font-size:17px; font-weight:900;
  color:var(--sl-text); display:flex; align-items:center; gap:9px;
}
.asl-burger{
  display:none; width:38px; height:36px; border-radius:10px;
  border:1.5px solid var(--sl-border); background:var(--sl-bg);
  font-size:18px; cursor:pointer; align-items:center; justify-content:center;
  color:var(--sl-text-2); transition:all 0.15s;
}
.asl-burger:hover{background:var(--sl-border)}
.asl-tenant-pill{
  display:flex; align-items:center; gap:8px;
  background:var(--sl-blue-light); border:1.5px solid #bfdbfe; border-radius:11px;
  padding:6px 13px;
}
.asl-tenant-pill select{
  border:none; background:transparent;
  font-size:13px; font-weight:700; color:var(--sl-blue-dark);
  cursor:pointer; outline:none; font-family:var(--sl-font); min-width:160px;
}

/* ── Content ── */
.asl-content{flex:1;padding:26px;overflow-y:auto}

/* ── Guard ── */
.asl-guard-wrap{display:flex;justify-content:center;padding-top:60px}
.asl-guard-card{
  background:var(--sl-surface); border:1px solid var(--sl-border);
  border-radius:var(--sl-r-xl); padding:48px 40px; max-width:500px;
  text-align:center; box-shadow:var(--sl-shadow);
}
.asl-guard-card .gi{font-size:52px;margin-bottom:18px}
.asl-guard-card h2{font-size:21px;font-weight:900;margin-bottom:10px}
.asl-guard-card p{font-size:14px;color:var(--sl-muted);line-height:1.65}

/* ── Drawer ── */
.asl-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.38);backdrop-filter:blur(3px);z-index:50}
.asl-drawer{
  position:fixed;top:0;left:0;height:100%;width:min(80vw,268px);
  background:var(--sl-surface);border-right:1px solid var(--sl-border);
  z-index:60;box-shadow:4px 0 24px rgba(0,0,0,0.15);
  display:flex;flex-direction:column;overflow-y:auto;
  animation:slideRight 0.2s ease;
}
@keyframes slideRight{from{transform:translateX(-100%)}to{transform:translateX(0)}}
.asl-drawer-hdr{
  display:flex;align-items:center;justify-content:space-between;
  padding:15px 15px;border-bottom:1px solid var(--sl-border);
}
.asl-drawer-hdr img{width:128px}
.asl-close-btn{
  width:34px;height:34px;border-radius:9px;border:1.5px solid var(--sl-border);
  background:var(--sl-bg);color:var(--sl-muted);font-size:14px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;transition:all 0.15s;
}
.asl-close-btn:hover{background:var(--sl-border);color:var(--sl-text)}

@media(max-width:860px){
  .asl-sidebar{display:none}
  .asl-burger{display:inline-flex}
  .asl-content{padding:16px}
}
`;


// ─── Topbar státuszsáv ────────────────────────────────────────────────────────
type BellEntry = { hour: number; minute: number; type: string; soundFile: string };

function pad2(n: number) { return String(n).padStart(2, "0"); }

function useStatusBar(isAuthed: boolean) {
  const [now,         setNow]         = useState(() => new Date());
  const [bells,       setBells]       = useState<BellEntry[]>([]);
  const [nextMessage, setNextMessage] = useState<string | null>(null);
  const [nextRadio,   setNextRadio]   = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    let alive = true;
    async function refresh() {
      try {
        const rb = await apiFetch<{ ok: boolean; bells?: BellEntry[] }>("/bells/today").catch(() => null);
        if (alive && rb?.bells) setBells(rb.bells);
      } catch {}
      try {
        const rm = await apiFetch<{ ok: boolean; messages?: any[] }>("/messages?limit=50").catch(() => null);
        if (alive && rm?.messages) {
          const n = new Date();
          const next = rm.messages
            .filter(m => m.scheduledAt && new Date(m.scheduledAt) > n)
            .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
          setNextMessage(next ? `${pad2(new Date(next.scheduledAt).getHours())}:${pad2(new Date(next.scheduledAt).getMinutes())}` : null);
        }
      } catch {}
      try {
        const from = new Date().toISOString();
        const rr = await apiFetch<{ ok: boolean; schedules?: any[] }>(`/radio/schedules?from=${from}`).catch(() => null);
        if (alive && rr?.schedules) {
          const next = rr.schedules
            .filter(s => new Date(s.scheduledAt) > new Date())
            .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
          setNextRadio(next ? `${pad2(new Date(next.scheduledAt).getHours())}:${pad2(new Date(next.scheduledAt).getMinutes())}` : null);
        }
      } catch {}
    }
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [isAuthed]);

  const nextBell = useMemo(() => {
    const mins = now.getHours() * 60 + now.getMinutes();
    const next = bells
      .map(b => ({ ...b, total: b.hour * 60 + b.minute }))
      .filter(b => b.total > mins)
      .sort((a, b) => a.total - b.total)[0];
    return next ? `${pad2(next.hour)}:${pad2(next.minute)}` : null;
  }, [bells, now]);

  const timeStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  return { timeStr, nextBell, nextMessage, nextRadio };
}

function StatusPill({ icon, label, value }: { icon: string; label: string; value: string | null }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      background: "var(--sl-bg)", border: "1px solid var(--sl-border)",
      borderRadius: 10, padding: "4px 10px", fontSize: 12, fontWeight: 700,
      color: value ? "var(--sl-text)" : "var(--sl-muted)", whiteSpace: "nowrap",
    }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ color: "var(--sl-muted)", fontWeight: 600 }}>{label}</span>
      <span style={{ color: value ? "var(--sl-blue)" : "var(--sl-muted)" }}>{value ?? "–"}</span>
    </div>
  );
}

export default function AppShell() {
  const { logout, state } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();

  const isAuthed     = state.status === "authed";
  const role         = isAuthed ? (state.user as any)?.role || "" : "";
  const isSuperAdmin = role === "SUPER_ADMIN";
  const tenantName   = isAuthed
    ? (state.user as any)?.tenantName || (state.user as any)?.tenant?.name || "" : "";
  const userName  = isAuthed
    ? (state.user as any)?.name || (state.user as any)?.displayName || (state.user as any)?.email || "Felhasználó" : "";

  const [navOpen, setNavOpen] = useState(false);
  const [tenants, setTenants] = useState<TenantListItem[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [tenantsError, setTenantsError] = useState<string|null>(null);

  const [activeTenantId, setActiveTenantId] = useState<string>(() =>
    safeGet(sessionStorage, ACTIVE_TENANT_KEY) || safeGet(localStorage, ACTIVE_TENANT_KEY) || ""
  );

  function onLogout() {
    safeRemove(sessionStorage, ACTIVE_TENANT_KEY);
    safeRemove(localStorage, ACTIVE_TENANT_KEY);
    logout(); navigate("/login", { replace: true });
  }

  useEffect(() => {
    const h = () => { if (window.innerWidth > 860) setNavOpen(false); };
    window.addEventListener("resize", h, { passive: true });
    return () => window.removeEventListener("resize", h);
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    if (!isSuperAdmin) {
      safeRemove(sessionStorage, ACTIVE_TENANT_KEY);
      safeRemove(localStorage, ACTIVE_TENANT_KEY);
      setActiveTenantId(""); return;
    }
    if (activeTenantId) { safeSet(sessionStorage, ACTIVE_TENANT_KEY, activeTenantId); safeRemove(localStorage, ACTIVE_TENANT_KEY); }
    else { safeRemove(sessionStorage, ACTIVE_TENANT_KEY); safeRemove(localStorage, ACTIVE_TENANT_KEY); }
  }, [isAuthed, isSuperAdmin, activeTenantId]);

  useEffect(() => {
    if (!isAuthed || !isSuperAdmin) return;
    let cancelled = false;
    (async () => {
      setTenantsLoading(true); setTenantsError(null);
      try {
        const res = await apiFetch<TenantsResponse>("/admin/tenants");
        if (cancelled) return;
        const list = Array.isArray(res.tenants) ? res.tenants : [];
        setTenants(list);
        if (activeTenantId && !list.some(t => t.id === activeTenantId)) setActiveTenantId("");
      } catch (e: any) { if (!cancelled) setTenantsError(e?.message ?? "Betöltés sikertelen"); }
      finally { if (!cancelled) setTenantsLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, isSuperAdmin]);

  const activeTenantLabel = useMemo(() =>
    isSuperAdmin ? (tenants.find(x => x.id === activeTenantId)?.name || "") : tenantName,
    [isSuperAdmin, tenants, activeTenantId, tenantName]
  );

  const { timeStr, nextBell, nextMessage, nextRadio } = useStatusBar(isAuthed);
  const tenantGuardBlocked = isAuthed && isSuperAdmin && !activeTenantId;
  const institutionLabel   = isSuperAdmin ? activeTenantLabel : tenantName;
  const avatarLetter       = userName.charAt(0).toUpperCase();

  function navAllowed(roles: string[]) { return roles.includes("all") || roles.includes(role); }

  function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <nav>
        {NAV_ITEMS.filter(n => navAllowed(n.roles)).map(item => {
          const active = location.pathname.startsWith(item.to);
          return (
            <a
              key={item.to}
              href={item.to}
              className={"asl-nav-link" + (active ? " active" : "")}
              onClick={e => { e.preventDefault(); navigate(item.to); onNavigate?.(); }}
            >
              <span className="asl-nav-icon">{item.icon}</span>
              <span style={{ flex:1 }}>{item.label}</span>
              {active && <span className="asl-nav-dot" />}
            </a>
          );
        })}
      </nav>
    );
  }

  const UserCard = () => (
    <>
      <div className="asl-user-card">
        <div className="asl-avatar">{avatarLetter}</div>
        <div style={{ minWidth:0 }}>
          <div className="asl-uname">{userName}</div>
          <div className="asl-urole">{ROLE_LABELS[role] || role}</div>
        </div>
      </div>
      <button className="asl-logout" onClick={onLogout} type="button">🚪 Kijelentkezés</button>
    </>
  );

  return (
    <div style={{ minHeight:"100vh", display:"flex", background:"var(--sl-bg)", fontFamily:"var(--sl-font)" }}>
      <style>{THEME}</style>

      {/* Desktop sidebar */}
      <aside className="asl-sidebar">
        <div className="asl-logo-area">
          <Link to="/app" style={{ textDecoration:"none", display:"block" }}>
            <picture>
              <source srcSet="/brand/schoollive-logow.svg" media="(prefers-color-scheme:dark)" type="image/svg+xml" />
              <source srcSet="/brand/schoollive-logo.svg"  media="(prefers-color-scheme:light)" type="image/svg+xml" />
              <img src="/brand/schoollive-logo.svg" alt="SchoolLive" loading="eager" decoding="async" />
            </picture>
          </Link>
          {institutionLabel
            ? <div className="asl-inst-badge" title={institutionLabel}>🏫 {institutionLabel}</div>
            : isSuperAdmin ? <div className="asl-inst-badge warn">⚠️ Válassz intézményt</div> : null
          }
        </div>
        <div className="asl-nav-area"><NavLinks /></div>
        <div className="asl-sidebar-footer"><UserCard /></div>
      </aside>

      {/* Mobile drawer */}
      {navOpen && <>
        <div className="asl-backdrop" onClick={() => setNavOpen(false)} aria-hidden />
        <aside className="asl-drawer">
          <div className="asl-drawer-hdr">
            <Link to="/app" onClick={() => setNavOpen(false)} style={{ textDecoration:"none" }}>
              <picture>
                <source srcSet="/brand/schoollive-logow.svg" media="(prefers-color-scheme:dark)" type="image/svg+xml" />
                <source srcSet="/brand/schoollive-logo.svg"  media="(prefers-color-scheme:light)" type="image/svg+xml" />
                <img src="/brand/schoollive-logo.svg" alt="SchoolLive" loading="eager" decoding="async" />
              </picture>
            </Link>
            <button className="asl-close-btn" onClick={() => setNavOpen(false)}>✕</button>
          </div>
          {institutionLabel && (
            <div style={{ padding:"8px 14px" }}>
              <div className="asl-inst-badge">🏫 {institutionLabel}</div>
            </div>
          )}
          <div style={{ padding:"12px 10px", flex:1 }}>
            <NavLinks onNavigate={() => setNavOpen(false)} />
          </div>
          <div className="asl-sidebar-footer"><UserCard /></div>
        </aside>
      </>}

      {/* Main */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>
        <header className="asl-topbar">
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <button className="asl-burger" onClick={() => setNavOpen(true)} aria-label="Menü" type="button">☰</button>
            <StatusPill icon="🕐" label="Idő:" value={timeStr} />
            <StatusPill icon="🔔" label="Csengő:" value={nextBell} />
            <StatusPill icon="📢" label="Üzenet:" value={nextMessage} />
            <StatusPill icon="📻" label="Rádió:" value={nextRadio} />
          </div>
          {isSuperAdmin && (
            <div className="asl-tenant-pill">
              <span style={{ fontSize:15 }}>🏫</span>
              <select value={activeTenantId} onChange={e => setActiveTenantId(e.target.value)} disabled={tenantsLoading||!!tenantsError}>
                <option value="">{tenantsLoading ? "Betöltés…" : "Válassz intézményt…"}</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}{t.isActive===false?" (inaktív)":""}</option>
                ))}
              </select>
              {tenantsError && <span style={{ fontSize:12, color:"var(--sl-red)" }}>⚠</span>}
            </div>
          )}
        </header>

        <main className="asl-content" key={isSuperAdmin ? activeTenantId : "non-super"}>
          {tenantGuardBlocked ? (
            <div className="asl-guard-wrap">
              <div className="asl-guard-card">
                <div className="gi">🏫</div>
                <h2>Válassz intézményt!</h2>
                <p>Rendszergazda módban a felső sávban válassz ki egy intézményt, hogy hozzáférhess az adatokhoz.</p>
              </div>
            </div>
          ) : <Outlet />}
        </main>
      </div>
    </div>
  );
}