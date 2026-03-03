import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

type LocationState = {
  from?: string;
};

function formatAuthError(err: any): string {
  const status = err?.status;
  const data = err?.data;

  const apiMsg =
    (data && typeof data === "object" && (data.error || data.message)) || err?.message;

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

  // Navigate only after we are truly authed
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
      await login(email.trim(), password);
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sl-login">
      <div className="sl-loginBg" />

      <div className="sl-loginShell">
        <div className="sl-loginCard">
          <h1 className="sl-loginTitle">Bejelentkezés</h1>
          <p className="sl-loginSubtitle">
            Add meg az e-mail címed és jelszavad. Ha hiba van, itt kiírjuk.
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
                placeholder="pl. admin@iskola.hu"
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
                placeholder="••••••••"
              />
            </div>

            <div className="sl-loginActions">
              <button className="sl-loginBtn" type="submit" disabled={busy}>
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
            <img
              className="sl-logo"
              src="/brand/schoollive-logo.svg"
              alt="SchoolLive logó"
              loading="eager"
              decoding="async"
            />
          </picture>
        </div>
      </div>
    </div>
  );
}