import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function AppShell() {
  const { logout, state } = useAuth();
  const navigate = useNavigate();

  function onLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const userLabel =
    state.status === "authed"
      ? `${state.user?.name || state.user?.email || "Felhasználó"}${state.user?.role ? ` · ${state.user.role}` : ""}`
      : "";

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
        }

        .sl-brandRow {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 6px 14px;
        }

        .sl-brandTitle {
          font-weight: 800;
          letter-spacing: -0.01em;
        }

        .sl-nav {
          display: grid;
          gap: 8px;
          margin-top: 10px;
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
          min-width: 0;
          display: flex;
          flex-direction: column;
        }

        .sl-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 18px;
          border-bottom: 1px solid var(--sl-border);
          background: rgba(127,127,127,0.03);
        }

        .sl-user {
          font-size: 13px;
          color: var(--sl-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 55vw;
        }

        .sl-logoutBtn {
          height: 38px;
          padding: 0 12px;
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
          min-width: 0;
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
        }
      `}</style>

      <aside className="sl-side" aria-label="Oldalsáv">
        <div className="sl-brandRow">
          <div className="sl-brandTitle">SchoolLive</div>
        </div>

        <nav className="sl-nav" aria-label="Navigáció">
          <Link to="/app/devices">Eszközök</Link>
          <Link to="/app/messages">Üzenetek</Link>
          {/* később role alapján */}
        </nav>
      </aside>

      <div className="sl-main">
        <header className="sl-topbar" aria-label="Felső sáv">
          <div className="sl-user">{userLabel}</div>

          <button className="sl-logoutBtn" onClick={onLogout} type="button">
            Kijelentkezés
          </button>
        </header>

        <main className="sl-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}