import { Link } from "react-router-dom";

const FEATURES = [
  { icon:"🔔", title:"Csengetési rend", desc:"Automatikus, pontos jelzések az iskola napirendje szerint." },
  { icon:"📢", title:"Azonnali üzenetek", desc:"Küldj hangüzenetet az épület bármely részébe másodpercek alatt." },
  { icon:"🔊", title:"Több eszköz", desc:"Minden hangszóró és kijelző egy helyen, egyszerűen kezelhető." },
  { icon:"🛡️", title:"Biztonságos",  desc:"Szerepkörök, hozzáférés-kezelés, auditált műveletek." },
];

export default function Landing() {
  return (
    <div style={{ minHeight:"100vh", fontFamily:"'Nunito','Segoe UI',sans-serif", background:"linear-gradient(160deg,#f0f7ff 0%,#f5f3ff 55%,#fff7ed 100%)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        .lnd-nav{
          display:flex; align-items:center; justify-content:space-between;
          padding:18px 48px; background:rgba(255,255,255,0.7);
          backdrop-filter:blur(12px); border-bottom:1px solid rgba(59,130,246,0.1);
          position:sticky; top:0; z-index:10;
        }
        .lnd-nav img{width:140px;height:auto}
        .lnd-nav-btn{
          padding:9px 22px; border-radius:12px;
          background:linear-gradient(135deg,#3b82f6,#6366f1);
          color:#fff; font-size:14px; font-weight:800; text-decoration:none;
          box-shadow:0 3px 10px rgba(99,102,241,0.3); transition:all 0.2s; font-family:inherit;
        }
        .lnd-nav-btn:hover{transform:translateY(-1px);box-shadow:0 5px 14px rgba(99,102,241,0.38)}
        .lnd-hero{
          max-width:1100px; margin:0 auto;
          display:grid; grid-template-columns:1fr 1fr; gap:64px;
          align-items:center; padding:80px 48px;
        }
        .lnd-hero-tag{
          display:inline-flex; align-items:center; gap:6px;
          background:#dbeafe; border:1px solid #bfdbfe; border-radius:20px;
          padding:5px 14px; font-size:12px; font-weight:800; color:#1d4ed8;
          margin-bottom:20px;
        }
        .lnd-hero h1{
          font-size:42px; font-weight:900; color:#0f172a; line-height:1.15;
          letter-spacing:-1.5px; margin-bottom:20px;
        }
        .lnd-hero h1 span{
          background:linear-gradient(135deg,#3b82f6,#8b5cf6);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent;
        }
        .lnd-hero p{
          font-size:16px; color:#475569; line-height:1.75; margin-bottom:32px; font-weight:500;
        }
        .lnd-actions{display:flex;gap:12px;flex-wrap:wrap}
        .lnd-btn-main{
          padding:13px 28px; border-radius:13px;
          background:linear-gradient(135deg,#3b82f6,#6366f1);
          color:#fff; font-size:15px; font-weight:800; text-decoration:none;
          box-shadow:0 4px 14px rgba(99,102,241,0.32); transition:all 0.2s;
          display:inline-flex; align-items:center; gap:8px; font-family:inherit;
        }
        .lnd-btn-main:hover{transform:translateY(-2px);box-shadow:0 7px 18px rgba(99,102,241,0.40)}
        .lnd-btn-ghost{
          padding:13px 24px; border-radius:13px;
          border:1.5px solid #bfdbfe; color:#1d4ed8;
          font-size:15px; font-weight:700; text-decoration:none;
          background:rgba(255,255,255,0.8); transition:all 0.2s;
          display:inline-flex; align-items:center; gap:8px; font-family:inherit;
        }
        .lnd-btn-ghost:hover{background:#eff6ff;border-color:#93c5fd}
        .lnd-hero-right{
          display:flex; flex-direction:column; gap:14px;
        }
        .lnd-feature-card{
          background:rgba(255,255,255,0.85); border:1px solid rgba(59,130,246,0.15);
          border-radius:16px; padding:16px 20px;
          display:flex; align-items:center; gap:14px;
          box-shadow:0 2px 12px rgba(59,130,246,0.08);
          transition:all 0.2s;
        }
        .lnd-feature-card:hover{transform:translateX(4px);box-shadow:0 4px 18px rgba(59,130,246,0.14)}
        .lnd-feature-icon{
          font-size:28px; width:52px; height:52px; border-radius:14px;
          background:linear-gradient(135deg,#eff6ff,#f5f3ff);
          display:flex; align-items:center; justify-content:center; flex-shrink:0;
          border:1px solid #dbeafe;
        }
        .lnd-feature-title{font-size:14px;font-weight:800;color:#1e293b;margin-bottom:3px}
        .lnd-feature-desc{font-size:13px;color:#64748b;line-height:1.5}
        .lnd-footer{
          text-align:center; padding:32px;
          border-top:1px solid rgba(59,130,246,0.1);
          font-size:13px; color:#94a3b8;
        }
        @media(max-width:760px){
          .lnd-hero{grid-template-columns:1fr;padding:48px 24px;gap:40px}
          .lnd-hero h1{font-size:30px}
          .lnd-nav{padding:14px 20px}
        }
        @media(prefers-color-scheme:dark){
          body{background:linear-gradient(160deg,#07111f,#0d0a1e,#140d06) !important}
          div[style*="linear-gradient(160deg"]{background:linear-gradient(160deg,#07111f,#0d0a1e,#140d06) !important}
          .lnd-nav{background:rgba(10,20,40,0.8);border-color:rgba(59,130,246,0.15)}
          .lnd-hero h1{color:#f0f6ff}
          .lnd-hero p{color:#8da4c0}
          .lnd-feature-card{background:rgba(13,27,46,0.9);border-color:rgba(59,130,246,0.2)}
          .lnd-feature-title{color:#e2eeff}
          .lnd-feature-desc{color:#6b8aad}
          .lnd-feature-icon{background:linear-gradient(135deg,#0c2040,#130a2e);border-color:#1a2d47}
          .lnd-hero-tag{background:#0c2040;border-color:#1a3a6a;color:#60a5fa}
          .lnd-footer{border-color:rgba(59,130,246,0.12);color:#4a6280}
        }
      `}</style>

      {/* Navbar */}
      <nav className="lnd-nav">
        <picture>
          <source srcSet="/brand/schoollive-logow.svg" media="(prefers-color-scheme:dark)" type="image/svg+xml" />
          <source srcSet="/brand/schoollive-logo.svg"  media="(prefers-color-scheme:light)" type="image/svg+xml" />
          <img src="/brand/schoollive-logo.svg" alt="SchoolLive" loading="eager" decoding="async" />
        </picture>
        <Link to="/login" className="lnd-nav-btn">Bejelentkezés →</Link>
      </nav>

      {/* Hero */}
      <section className="lnd-hero">
        <div>
          <div className="lnd-hero-tag">🏫 Iskolai kommunikációs rendszer</div>
          <h1>Egyszerűbb iskolai <span>kommunikáció</span></h1>
          <p>
            A SchoolLive segít, hogy az iskolai üzenetek mindig időben, érthetően és
            megbízhatóan eljussanak oda, ahol szükség van rájuk — kevesebb félreértés,
            gyorsabb reagálás, nyugodtabb mindennapok.
          </p>
          <div className="lnd-actions">
            <Link to="/login" className="lnd-btn-main">🚀 Belépés a rendszerbe</Link>
            <a href="https://github.com/kovacsmedia" target="_blank" rel="noreferrer" className="lnd-btn-ghost">Tudj meg többet ↗</a>
          </div>
        </div>

        <div className="lnd-hero-right">
          {FEATURES.map(f => (
            <div key={f.title} className="lnd-feature-card">
              <div className="lnd-feature-icon">{f.icon}</div>
              <div>
                <div className="lnd-feature-title">{f.title}</div>
                <div className="lnd-feature-desc">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="lnd-footer">
        © {new Date().getFullYear()} SchoolLive · Iskolai kommunikációs rendszer
      </footer>
    </div>
  );
}
