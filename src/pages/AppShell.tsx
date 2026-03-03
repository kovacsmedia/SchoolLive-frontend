import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function AppShell() {
  const { logout, state } = useAuth();
  const navigate = useNavigate();

  function onLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const userName =
    state.status === "authed"
      ? state.user?.name || state.user?.email || "Ismeretlen felhasználó"
      : "";

  const role =
    state.status === "authed"
      ? state.user?.role || "n/a"
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
        </nav>
      </aside>

      <div className="sl-main">
        <header className="sl-topbar">
          <div className="sl-userInfo">
            <div>
              Bejelentkezett felhasználó: <strong>{userName}</strong>
            </div>
            <div>
              Szerepkör: <strong>{role}</strong>
            </div>
          </div>

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