import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

type LocationState = { from?: string; };
function formatAuthError(err: any): string {
  const s = err?.status;
  const d = err?.data;
  const m = (d && typeof d === "object" && (d.error || d.message)) || err?.message;
  return s ? `${m || "Sikertelen bejelentkezés."} (HTTP ${s})` : (m || "Sikertelen bejelentkezés.");
}

export default function Login() {
  const { login, state } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = useMemo(() => ((location.state||{}) as LocationState).from||"/app",[location.state]);

  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]   = useState(false);
  const [error, setError]     = useState<string|null>(null);
  const [busy, setBusy]       = useState(false);

  useEffect(() => { if (state.status === "authed") navigate(from, { replace: true }); }, [state.status, navigate, from]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try { await login(email.trim(), password); }
    catch (err: any) { setError(formatAuthError(err)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Nunito','Segoe UI',sans-serif", background:"linear-gradient(160deg,#f0f7ff 0%,#f5f3ff 55%,#fff7ed 100%)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        .lg-left{
          flex:1; display:flex; align-items:center; justify-content:center;
          padding:40px 24px; min-height:100vh;
        }
        .lg-card{
          width:100%; max-width:420px;
          background:rgba(255,255,255,0.95); border-radius:24px;
          padding:40px 36px; box-shadow:0 8px 40px rgba(59,130,246,0.13);
          border:1px solid rgba(255,255,255,0.9);
        }
        .lg-logo{display:block;margin:0 auto 26px;width:158px;height:auto}
        .lg-heading{font-size:26px;font-weight:900;color:#0f172a;text-align:center;margin-bottom:6px;letter-spacing:-0.5px}
        .lg-sub{font-size:14px;color:#64748b;text-align:center;margin-bottom:28px;font-weight:500}
        .lg-field{margin-bottom:16px}
        .lg-label{display:block;font-size:12.5px;font-weight:800;color:#374151;margin-bottom:5px;letter-spacing:0.2px}
        .lg-input-wrap{position:relative}
        .lg-input{
          width:100%; padding:11px 14px; border:1.5px solid #e2e8f0;
          border-radius:12px; font-size:14px; font-family:inherit;
          color:#1e293b; background:#f8fafc; transition:all 0.15s; outline:none;
        }
        .lg-input:focus{border-color:#3b82f6;background:#fff;box-shadow:0 0 0 3px rgba(59,130,246,0.11)}
        .lg-input::placeholder{color:#94a3b8}
        .lg-eye{
          position:absolute; right:12px; top:50%; transform:translateY(-50%);
          background:none; border:none; cursor:pointer; font-size:16px;
          color:#94a3b8; padding:4px; line-height:1;
        }
        .lg-error{
          background:#fef2f2; border:1px solid #fecaca; border-radius:11px;
          padding:10px 14px; font-size:13px; color:#dc2626; margin-bottom:16px;
          display:flex; align-items:flex-start; gap:7px;
        }
        .lg-btn{
          width:100%; padding:13px; border-radius:13px; border:none;
          background:linear-gradient(135deg,#3b82f6,#6366f1);
          color:#fff; font-size:15px; font-weight:900; cursor:pointer;
          font-family:inherit; transition:all 0.2s;
          box-shadow:0 4px 12px rgba(99,102,241,0.32);
        }
        .lg-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 16px rgba(99,102,241,0.4)}
        .lg-btn:disabled{opacity:0.65;cursor:not-allowed}
        .lg-back{
          display:block; text-align:center; margin-top:18px;
          font-size:13px; color:#64748b; text-decoration:none;
          transition:color 0.15s; font-weight:600;
        }
        .lg-back:hover{color:#3b82f6}
        @media(prefers-color-scheme:dark){
          div[style*="linear-gradient(160deg"]{background:linear-gradient(160deg,#07111f,#0d0a1e,#140d06) !important}
          .lg-card{background:rgba(13,27,46,0.97);border-color:#1a2d47}
          .lg-heading{color:#f0f6ff}
          .lg-sub{color:#8da4c0}
          .lg-label{color:#8da4c0}
          .lg-input{background:#0c1e33;border-color:#1a3a6a;color:#e2eeff}
          .lg-input:focus{background:#0c1e33;border-color:#3b82f6}
          .lg-back{color:#4a6280}
        }
      `}</style>

      <div className="lg-card" style={{ width:"100%", maxWidth:420, margin:"0 24px" }}>
          <picture>
            <source srcSet="/brand/schoollive-logow.svg" media="(prefers-color-scheme:dark)" type="image/svg+xml" />
            <source srcSet="/brand/schoollive-logo.svg"  media="(prefers-color-scheme:light)" type="image/svg+xml" />
            <img className="lg-logo" src="/brand/schoollive-logo.svg" alt="SchoolLive" loading="eager" decoding="async" />
          </picture>
          <h1 className="lg-heading">Üdvözlünk! 👋</h1>
          <p className="lg-sub">Jelentkezz be az iskolai rendszerbe</p>

          {error && <div className="lg-error"><span>⚠️</span><span>{error}</span></div>}

          <form onSubmit={onSubmit}>
            <div className="lg-field">
              <label className="lg-label" htmlFor="lg-email">E-mail cím</label>
              <input id="lg-email" className="lg-input" type="email"
                value={email} onChange={e => setEmail(e.target.value)}
                autoComplete="username" inputMode="email" required disabled={busy}
                placeholder="pl. tanár@iskola.hu" />
            </div>
            <div className="lg-field">
              <label className="lg-label" htmlFor="lg-pw">Jelszó</label>
              <div className="lg-input-wrap">
                <input id="lg-pw" className="lg-input" type={showPw?"text":"password"}
                  value={password} onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password" required disabled={busy}
                  placeholder="••••••••" style={{ paddingRight:40 }} />
                <button type="button" className="lg-eye" onClick={() => setShowPw(v=>!v)} tabIndex={-1}>
                  {showPw ? "🙈" : "👁️"}
                </button>
              </div>
            </div>
            <button className="lg-btn" type="submit" disabled={busy}>
              {busy ? "⏳ Bejelentkezés…" : "Belépés →"}
            </button>
          </form>
          <Link className="lg-back" to="/">← Vissza a főoldalra</Link>
      </div>

    </div>
  );
}