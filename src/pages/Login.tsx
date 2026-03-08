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
    <div style={{ minHeight:"100vh", display:"flex", fontFamily:"'Nunito','Segoe UI',sans-serif", background:"linear-gradient(160deg,#f0f7ff 0%,#f5f3ff 55%,#fff7ed 100%)" }}>
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
        /* Right panel */
        .lg-right{
          flex:1; display:none; align-items:center; justify-content:center;
          padding:60px; position:relative; overflow:hidden;
        }
        .lg-blob{
          position:absolute; border-radius:50%; filter:blur(70px); opacity:0.35;
          pointer-events:none;
        }
        .lg-right-inner{position:relative;z-index:2;text-align:center;max-width:400px}
        .lg-right-inner h2{
          font-size:34px; font-weight:900; color:#0f172a;
          margin-bottom:14px; line-height:1.2; letter-spacing:-1px;
        }
        .lg-right-inner h2 span{
          background:linear-gradient(135deg,#3b82f6,#8b5cf6);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent;
        }
        .lg-right-inner p{font-size:15px;color:#475569;line-height:1.7;margin-bottom:30px}
        .lg-feats{display:flex;flex-direction:column;gap:11px;text-align:left}
        .lg-feat{
          display:flex; align-items:center; gap:13px;
          background:rgba(255,255,255,0.85); border:1px solid rgba(59,130,246,0.15);
          border-radius:14px; padding:13px 16px;
          box-shadow:0 2px 10px rgba(59,130,246,0.08);
        }
        .lg-feat-icon{font-size:24px;flex-shrink:0}
        .lg-feat-text{font-size:13px;font-weight:700;color:#374151}
        @media(min-width:860px){.lg-right{display:flex}}
        @media(prefers-color-scheme:dark){
          div[style*="linear-gradient(160deg"]{background:linear-gradient(160deg,#07111f,#0d0a1e,#140d06) !important}
          .lg-card{background:rgba(13,27,46,0.97);border-color:#1a2d47}
          .lg-heading{color:#f0f6ff}
          .lg-sub{color:#8da4c0}
          .lg-label{color:#8da4c0}
          .lg-input{background:#0c1e33;border-color:#1a3a6a;color:#e2eeff}
          .lg-input:focus{background:#0c1e33;border-color:#3b82f6}
          .lg-right-inner h2{color:#f0f6ff}
          .lg-right-inner p{color:#6b8aad}
          .lg-feat{background:rgba(13,27,46,0.9);border-color:rgba(59,130,246,0.2)}
          .lg-feat-text{color:#c4d4e8}
          .lg-back{color:#4a6280}
        }
      `}</style>

      <div className="lg-left">
        <div className="lg-card">
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

      <div className="lg-right">
        <div className="lg-blob" style={{ width:420,height:420,background:"#bfdbfe",top:-120,right:-80 }} />
        <div className="lg-blob" style={{ width:320,height:320,background:"#ddd6fe",bottom:-100,left:-60 }} />
        <div className="lg-blob" style={{ width:200,height:200,background:"#fed7aa",bottom:80,right:40 }} />
        <div className="lg-right-inner">
          <div style={{ fontSize:62,marginBottom:20 }}>🏫</div>
          <h2>Iskolai kommunikáció <span>egy helyen</span></h2>
          <p>A SchoolLive segít, hogy az iskolai üzenetek mindig időben és érthetően eljussanak mindenhova.</p>
          <div className="lg-feats">
            <div className="lg-feat"><span className="lg-feat-icon">🔔</span><span className="lg-feat-text">Automatikus csengetési rend kezelése</span></div>
            <div className="lg-feat"><span className="lg-feat-icon">📢</span><span className="lg-feat-text">Azonnali hangüzenet küldés az épületbe</span></div>
            <div className="lg-feat"><span className="lg-feat-icon">🔊</span><span className="lg-feat-text">Több eszköz, egyetlen vezérlőpanel</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
