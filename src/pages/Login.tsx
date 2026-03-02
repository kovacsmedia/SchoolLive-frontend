import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

type LocationState = {
  from?: string;
};

function formatAuthError(err: any): string {
  // apiFetch throws Error with extra fields: status, data
  const status = err?.status;
  const data = err?.data;

  const apiMsg =
    (data && typeof data === "object" && (data.error || data.message)) ||
    err?.message;

  if (status) return `${apiMsg || "Sikertelen bejelentkezés."} (HTTP ${status})`;
  return apiMsg || "Sikertelen bejelentkezés.";
}

export default function Login() {
  const { login, state } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = useMemo(() => {
    const s = (location.state || {}) as LocationState;
    return s.from || "/app";
  }, [location.state]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ✅ Only navigate when we are truly authed
  useEffect(() => {
    if (state.status === "authed") {
      navigate(from, { replace: true });
    }
  }, [state.status, navigate, from]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      // ✅ Don't navigate here. Let the effect decide after auth state is updated.
      await login(email.trim(), password);
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sl-login">
      {/* Route-scoped styling */}
      <style>{`
        .sl-login {
          min-height: 100vh;
          padding: clamp(16px, 4vw, 48px);
          display: grid;
          place-items: center;
        }

        .sl-loginShell {
          width: 100%;
          max-width: 980px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: clamp(18px, 4vw, 46px);
          align-items: center;
        }

        .sl-loginCard {
          border-radius: 20px;
          border: 1px solid var(--sl-border);
          background: var(--sl-card);
          box-shadow: var(--sl-shadow, 0 12px 32px rgba(0,0,0,0.12));
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          padding: clamp(22px, 4vw, 42px);
        }

        .sl-loginTitle {
          margin: 0 0 10px;
          font-size: clamp(26px, 3.2vw, 36px);
          line-height: 1.12;
          letter-spacing: -0.02em;
        }

        .sl-loginSubtitle {
          margin: 0 0 22px;
          color: var(--sl-muted);
          font-size: 14.5px;
          line-height: 1.55;
        }

        .sl-form {
          display: grid;
          gap: 14px;
        }

        .sl-field {
          display: grid;
          gap: 8px;
        }

        .sl-label {
          font-size: 13px;
          color: var(--sl-muted);
        }

        .sl-input {
          height: 44px;
          border-radius: 14px;
          border: 1px solid var(--sl-border);
          background: rgba(127,127,127,0.06);
          padding: 0 12px;
        }

        @media (prefers-color-scheme: dark) {
          .sl-input {
            background: rgba(255,255,255,0.06);
          }
        }

        .sl-input:focus-visible {
          outline: 2px solid rgba(105, 176, 214, 0.7);
          outline-offset: 2px;
        }

        .sl-error {
          border: 1px solid rgba(220, 60, 60, 0.35);
          background: rgba(220, 60, 60, 0.10);
          border-radius: 14px;
          padding: 10px 12px;
          font-size: 13.5px;
          white-space: pre-wrap;
        }

        .sl-actions {
          margin-top: 6px;
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
        }

        .sl-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 44px;
          padding: 0 16px;
          border-radius: 14px;
          border: 1px solid var(--sl-border);
          background: rgba(94, 78, 161, 0.16);
          font-weight: 700;
          user-select: none;
        }

        .sl-btn:hover {
          background: rgba(94, 78, 161, 0.22);
        }

        .sl-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .sl-link {
          color: inherit;
          opacity: 0.85;
          text-decoration: none;
          border-bottom: 1px dashed rgba(127,127,127,0.45);
          padding-bottom: 2px;
        }

        .sl-link:hover {
          opacity: 1;
        }

        .sl-brand {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sl-logo {
          width: min(360px, 78vw);
          height: auto;
          filter: drop-shadow(0 12px 22px rgba(0,0,0,0.14));
        }

        .sl-bg {
          position: fixed;
          inset: 0;
          pointer-events: none;
          opacity: 0.35;
          background:
            radial-gradient(620px 300px at 15% 15%, rgba(105,176,214,0.25), transparent 70%),
            radial-gradient(520px 280px at 85% 20%, rgba(94,78,161,0.22), transparent 70%);
        }

        @media (max-width: 860px) {
          .sl-loginShell {
            grid-template-columns: 1fr;
          }
          .sl-brand {
            order: -1;
          }
        }
      `}</style>

      <div className="sl-bg" />

      <div className="sl-loginShell">
        <div className="sl-loginCard">
          <h1 className="sl-loginTitle">Bejelentkezés</h1>
          <p className="sl-loginSubtitle">
            Add meg az e-mail címed és jelszavad. Ha hiba van, itt kiírjuk részletesen.
          </p>

          {error && <div className="sl-error">{error}</div>}

          <form className="sl-form" onSubmit={onSubmit}>
            <div className="sl-field">
              <label className="sl-label" htmlFor="email">
                E-mail cím
              </label>
              <input
                id="email"
                className="sl-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                inputMode="email"
                required
                disabled={busy}
              />
            </div>

            <div className="sl-field">
              <label className="sl-label" htmlFor="password">
                Jelszó
              </label>
              <input
                id="password"
                className="sl-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={busy}
              />
            </div>

            <div className="sl-actions">
              <button className="sl-btn" type="submit" disabled={busy}>
                {busy ? "Bejelentkezés…" : "Belépés"}
              </button>

              <Link className="sl-link" to="/">
                ← Vissza a főoldalra
              </Link>
            </div>
          </form>
        </div>

        <div className="sl-brand" aria-label="SchoolLive brand">
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
            <img className="sl-logo" src="/brand/schoollive-logo.svg" alt="SchoolLive logó" loading="eager" />
          </picture>
        </div>
      </div>
    </div>
  );
}