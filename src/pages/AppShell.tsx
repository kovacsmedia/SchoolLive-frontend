import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

type TenantListItem = {
  id: string;
  name: string;
  domain?: string | null;
  isActive?: boolean | null;
};

type TenantsResponse = {
  ok: true;
  tenants: TenantListItem[];
};

const ACTIVE_TENANT_KEY = "activeTenantId";

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeRemove(storage: Storage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

export default function AppShell() {
  const { logout, state } = useAuth();
  const navigate = useNavigate();

  const isAuthed = state.status === "authed";
  const role = isAuthed ? state.user?.role || "n/a" : "n/a";
  const isSuperAdmin = role === "SUPER_ADMIN";

  const userName = isAuthed
    ? state.user?.name || state.user?.email || "Ismeretlen felhasználó"
    : "";

  // tenant state (SUPER_ADMIN only)
  const [tenants, setTenants] = useState<TenantListItem[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [tenantsError, setTenantsError] = useState<string | null>(null);

  const [activeTenantId, setActiveTenantId] = useState<string>(() => {
    return safeGet(sessionStorage, ACTIVE_TENANT_KEY) || safeGet(localStorage, ACTIVE_TENANT_KEY) || "";
  });

  function onLogout() {
    // clear tenant selection too (session-only UX)
    safeRemove(sessionStorage, ACTIVE_TENANT_KEY);
    safeRemove(localStorage, ACTIVE_TENANT_KEY);

    logout();
    navigate("/login", { replace: true });
  }

  // Keep storage aligned with state
  useEffect(() => {
    if (!isAuthed) return;

    if (!isSuperAdmin) {
      // Non-superadmin: tenant comes from token, do not allow cross-tenant selection
      safeRemove(sessionStorage, ACTIVE_TENANT_KEY);
      safeRemove(localStorage, ACTIVE_TENANT_KEY);
      setActiveTenantId("");
      return;
    }

    // SUPER_ADMIN: persist in sessionStorage (preferred)
    if (activeTenantId) {
      safeSet(sessionStorage, ACTIVE_TENANT_KEY, activeTenantId);
      safeRemove(localStorage, ACTIVE_TENANT_KEY);
    } else {
      safeRemove(sessionStorage, ACTIVE_TENANT_KEY);
      safeRemove(localStorage, ACTIVE_TENANT_KEY);
    }
  }, [isAuthed, isSuperAdmin, activeTenantId]);

  // Load tenants list for SUPER_ADMIN
  useEffect(() => {
    if (!isAuthed || !isSuperAdmin) return;

    let cancelled = false;

    (async () => {
      setTenantsLoading(true);
      setTenantsError(null);

      try {
        const res = await apiFetch<TenantsResponse>("/admin/tenants", { method: "GET" });
        if (cancelled) return;

        const list = Array.isArray(res.tenants) ? res.tenants : [];
        setTenants(list);

        // If no selection yet, keep empty (force user to choose)
        // If selection exists but is no longer in list, clear it.
        if (activeTenantId && !list.some((t) => t.id === activeTenantId)) {
          setActiveTenantId("");
        }
      } catch (e: any) {
        if (cancelled) return;
        setTenantsError(e?.message ?? "Tenant lista betöltése sikertelen.");
      } finally {
        if (!cancelled) setTenantsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthed, isSuperAdmin]); // intentionally NOT depending on activeTenantId

  const activeTenantLabel = useMemo(() => {
    if (!isSuperAdmin) return "";
    const t = tenants.find((x) => x.id === activeTenantId);
    return t ? t.name : "";
  }, [isSuperAdmin, tenants, activeTenantId]);

  const tenantGuardBlocked = isAuthed && isSuperAdmin && !activeTenantId;

  return (
    <div className="sl-appShell">
      <style>{`
        .sl-appShell {
          min-height: 100vh;
          display: flex;
        }

        .sl-side {
          width: 260px;
          border-right: 1px solid var(--sl-border);
          padding: 16px;
          background: rgba(127,127,127,0.03);
          display: flex;
          flex-direction: column;
        }

        .sl-brand {
          display: flex;
          align-items: center;
          justify-content: center;
          padding-bottom: 16px;
          margin-bottom: 12px;
          border-bottom: 1px solid var(--sl-border);
          text-decoration: none;
        }

        .sl-brand img {
          width: 160px;
          height: auto;
        }

        .sl-nav {
          display: grid;
          gap: 8px;
        }

        .sl-nav a {
          color: inherit;
          text-decoration: none;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid transparent;
          background: rgba(127,127,127,0.06);
        }

        .sl-nav a:hover {
          background: rgba(127,127,127,0.10);
        }

        .sl-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .sl-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 20px;
          border-bottom: 1px solid var(--sl-border);
          background: rgba(127,127,127,0.03);
          flex-wrap: wrap;
          gap: 12px;
        }

        .sl-leftInfo {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 260px;
        }

        .sl-userInfo {
          display: flex;
          flex-direction: column;
          font-size: 13px;
          color: var(--sl-muted);
        }

        .sl-userInfo strong {
          color: var(--sl-text);
          font-weight: 600;
        }

        .sl-tenantRow {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }

        .sl-tenantLabel {
          font-size: 12.5px;
          color: var(--sl-muted);
        }

        .sl-tenantSelect {
          height: 36px;
          border-radius: 12px;
          border: 1px solid var(--sl-border);
          background: rgba(127,127,127,0.06);
          color: inherit;
          padding: 0 10px;
          min-width: min(420px, 72vw);
        }

        @media (prefers-color-scheme: dark) {
          .sl-tenantSelect {
            background: rgba(255,255,255,0.06);
          }
        }

        .sl-tenantHint {
          font-size: 12px;
          color: var(--sl-muted);
        }

        .sl-logoutBtn {
          height: 38px;
          padding: 0 14px;
          border-radius: 12px;
          border: 1px solid var(--sl-border);
          background: rgba(127,127,127,0.08);
          color: inherit;
          font-weight: 700;
          cursor: pointer;
        }

        .sl-logoutBtn:hover {
          background: rgba(127,127,127,0.14);
        }

        .sl-content {
          flex: 1;
          padding: 24px;
        }

        .sl-guard {
          border: 1px solid var(--sl-border);
          background: rgba(127,127,127,0.06);
          border-radius: 16px;
          padding: 18px;
          max-width: 820px;
        }

        .sl-guard h2 {
          margin: 0 0 8px;
          font-size: 18px;
        }

        .sl-guard p {
          margin: 0;
          color: var(--sl-muted);
        }

        @media (max-width: 860px) {
          .sl-appShell {
            flex-direction: column;
          }

          .sl-side {
            width: auto;
            border-right: none;
            border-bottom: 1px solid var(--sl-border);
          }

          .sl-content {
            padding: 16px;
          }

          .sl-brand img {
            width: 140px;
          }
        }
      `}</style>

      <aside className="sl-side">
        <Link to="/app" className="sl-brand" aria-label="SchoolLive kezdőoldal">
          <picture>
            <source
              srcSet="/brand/schoollive-logow.svg"
              media="(prefers-color-scheme: dark)"
              type="image/svg+xml"
            />
            <source
              srcSet="/brand/schoollive-logo.svg"
              media="(prefers-color-scheme: light)"
              type="image/svg+xml"
            />
            <img
              src="/brand/schoollive-logo.svg"
              alt="SchoolLive logó"
              loading="eager"
              decoding="async"
            />
          </picture>
        </Link>

        <nav className="sl-nav">
          <Link to="/app/devices">Eszközök</Link>
          <Link to="/app/messages">Üzenetek</Link>
          {/* később: Tenants / Users / Devices admin oldalak külön menüpontok */}
        </nav>
      </aside>

      <div className="sl-main">
        <header className="sl-topbar">
          <div className="sl-leftInfo">
            <div className="sl-userInfo">
              <div>
                Bejelentkezett felhasználó: <strong>{userName}</strong>
              </div>
              <div>
                Szerepkör: <strong>{role}</strong>
              </div>
            </div>

            {isAuthed && isSuperAdmin && (
              <div className="sl-tenantRow">
                <span className="sl-tenantLabel">Aktív tenant:</span>

                <select
                  className="sl-tenantSelect"
                  value={activeTenantId}
                  onChange={(e) => setActiveTenantId(e.target.value)}
                  disabled={tenantsLoading || !!tenantsError}
                >
                  <option value="">
                    {tenantsLoading
                      ? "Tenant lista betöltése…"
                      : "Válassz tenantot…"}
                  </option>

                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.domain ? ` · ${t.domain}` : ""}
                      {t.isActive === false ? " (inaktív)" : ""}
                    </option>
                  ))}
                </select>

                {tenantsError ? (
                  <span className="sl-tenantHint">Hiba: {tenantsError}</span>
                ) : activeTenantId ? (
                  <span className="sl-tenantHint">Kiválasztva: {activeTenantLabel}</span>
                ) : (
                  <span className="sl-tenantHint">
                    Tenant nélkül a SUPER_ADMIN nem módosít adatot.
                  </span>
                )}
              </div>
            )}
          </div>

          <button className="sl-logoutBtn" onClick={onLogout} type="button">
            Kijelentkezés
          </button>
        </header>

        {/* key forces remount on tenant change so pages refetch naturally */}
        <main className="sl-content" key={isSuperAdmin ? activeTenantId : "non-super"}>
          {tenantGuardBlocked ? (
            <div className="sl-guard">
              <h2>Tenant kiválasztása szükséges</h2>
              <p>
                SUPER_ADMIN módban válassz ki egy tenantot a felső sávban. Ezután minden oldal az
                aktuális tenant adatait fogja megjeleníteni, és egyszerre csak azt lehet
                módosítani.
              </p>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}