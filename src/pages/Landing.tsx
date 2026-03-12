import { useState } from "react";
import { Link } from "react-router-dom";

const FEATURES = [
  { icon:"🔔", title:"Csengetési rend",   desc:"Automatikus, pontos jelzések az iskola napirendje szerint. Naptárba szervezett sablonokkal, ünnepnapokkal." },
  { icon:"📢", title:"Azonnali üzenetek", desc:"Küldj szöveges hangüzenetet az épület bármely részébe másodpercek alatt, TTS hanggal." },
  { icon:"📻", title:"Iskolarádió",        desc:"Zenét és műsorokat ütemezve, az egész épületbe egyszerre – közvetlenül a böngészőből vezérelve." },
  { icon:"🔊", title:"Több eszköz",        desc:"Minden hangszóró és kijelző egy helyen, valós idejű státusszal, csoportokba rendezve." },
  { icon:"🛡️", title:"Biztonságos",        desc:"Szerepkörök, hozzáférés-kezelés, intézményi szétválasztás, auditált műveletek." },
];

type ContactForm = { name: string; institution: string; email: string; phone: string };

export default function Landing() {
  const [contactOpen, setContactOpen] = useState(false);
  const [form, setForm]               = useState<ContactForm>({ name:"", institution:"", email:"", phone:"" });
  const [sending, setSending]         = useState(false);
  const [sent, setSent]               = useState(false);
  const [sendError, setSendError]     = useState<string|null>(null);

  function setField(k: keyof ContactForm, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function submitContact(e: React.FormEvent) {
    e.preventDefault();
    setSending(true); setSendError(null);
    try {
      const resp = await fetch("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Hiba történt.");
      setSent(true);
    } catch (err: any) {
      setSendError(err.message || "Az e-mail küldése nem sikerült.");
    } finally {
      setSending(false);
    }
  }

  function closeContact() {
    setContactOpen(false);
    setTimeout(() => { setSent(false); setSendError(null); setForm({ name:"", institution:"", email:"", phone:"" }); }, 300);
  }

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
          align-items:start; padding:80px 48px 48px;
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
        .lnd-hero-right{ display:flex; flex-direction:column; gap:12px; }
        .lnd-feature-card{
          background:rgba(255,255,255,0.85); border:1px solid rgba(59,130,246,0.15);
          border-radius:16px; padding:14px 18px;
          display:flex; align-items:center; gap:14px;
          box-shadow:0 2px 12px rgba(59,130,246,0.08); transition:all 0.2s;
        }
        .lnd-feature-card:hover{transform:translateX(4px);box-shadow:0 4px 18px rgba(59,130,246,0.14)}
        .lnd-feature-icon{
          font-size:26px; width:48px; height:48px; border-radius:13px;
          background:linear-gradient(135deg,#eff6ff,#f5f3ff);
          display:flex; align-items:center; justify-content:center; flex-shrink:0;
          border:1px solid #dbeafe;
        }
        .lnd-feature-title{font-size:14px;font-weight:800;color:#1e293b;margin-bottom:2px}
        .lnd-feature-desc{font-size:12.5px;color:#64748b;line-height:1.5}
        /* CTA section */
        .lnd-cta{
          max-width:1100px; margin:0 auto; padding:40px 48px 80px;
        }
        .lnd-cta-card{
          background:linear-gradient(135deg,#eff6ff,#f5f3ff,#fff7ed);
          border:1px solid #bfdbfe; border-radius:20px; padding:40px 48px;
          display:flex; align-items:center; justify-content:space-between; gap:32px; flex-wrap:wrap;
          box-shadow:0 4px 24px rgba(99,102,241,0.10);
        }
        .lnd-cta-card h2{font-size:22px;font-weight:900;color:#0f172a;margin-bottom:8px}
        .lnd-cta-card p{font-size:15px;color:#475569;font-weight:500}
        .lnd-contact-btn{
          padding:14px 30px; border-radius:14px; border:none; cursor:pointer;
          background:linear-gradient(135deg,#3b82f6,#6366f1);
          color:#fff; font-size:15px; font-weight:800; font-family:inherit;
          box-shadow:0 4px 14px rgba(99,102,241,0.32); transition:all 0.2s; white-space:nowrap;
        }
        .lnd-contact-btn:hover{transform:translateY(-2px);box-shadow:0 7px 18px rgba(99,102,241,0.40)}
        /* Modal */
        .lnd-overlay{
          position:fixed; inset:0; background:rgba(15,23,42,0.45); backdrop-filter:blur(4px);
          z-index:100; display:flex; align-items:center; justify-content:center; padding:24px;
        }
        .lnd-modal{
          background:#fff; border-radius:20px; padding:36px 40px;
          max-width:480px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.2);
          animation:lnd-pop 0.18s ease;
        }
        @keyframes lnd-pop{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}
        .lnd-modal h2{font-size:20px;font-weight:900;color:#0f172a;margin-bottom:6px}
        .lnd-modal p{font-size:13.5px;color:#64748b;margin-bottom:24px}
        .lnd-field{margin-bottom:14px}
        .lnd-label{display:block;font-size:12px;font-weight:800;color:#374151;margin-bottom:4px}
        .lnd-input{
          width:100%; padding:10px 13px; border:1.5px solid #e2e8f0;
          border-radius:10px; font-size:14px; font-family:inherit; color:#1e293b;
          background:#f8fafc; transition:all 0.15s; outline:none;
        }
        .lnd-input:focus{border-color:#3b82f6;background:#fff;box-shadow:0 0 0 3px rgba(59,130,246,0.1)}
        .lnd-modal-actions{display:flex;gap:10px;margin-top:20px}
        .lnd-modal-submit{
          flex:1; padding:12px; border-radius:12px; border:none; cursor:pointer;
          background:linear-gradient(135deg,#3b82f6,#6366f1); color:#fff;
          font-size:14px; font-weight:800; font-family:inherit; transition:all 0.2s;
        }
        .lnd-modal-submit:disabled{opacity:0.6;cursor:not-allowed}
        .lnd-modal-cancel{
          padding:12px 20px; border-radius:12px;
          border:1.5px solid #e2e8f0; background:#f8fafc;
          color:#64748b; font-size:14px; font-weight:700; font-family:inherit; cursor:pointer;
        }
        .lnd-modal-cancel:hover{background:#e2e8f0}
        .lnd-error{background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px 13px;font-size:13px;color:#dc2626;margin-bottom:12px;display:flex;gap:7px}
        .lnd-success{text-align:center;padding:20px 0}
        .lnd-success .si{font-size:56px;margin-bottom:12px}
        .lnd-success h3{font-size:19px;font-weight:900;color:#0f172a;margin-bottom:8px}
        .lnd-success p{font-size:14px;color:#64748b;margin-bottom:20px}
        .lnd-footer{
          text-align:center; padding:28px;
          border-top:1px solid rgba(59,130,246,0.1);
          font-size:13px; color:#94a3b8;
        }
        @media(max-width:760px){
          .lnd-hero{grid-template-columns:1fr;padding:40px 20px 32px;gap:32px}
          .lnd-hero h1{font-size:28px}
          .lnd-nav{padding:14px 20px}
          .lnd-cta{padding:20px 20px 48px}
          .lnd-cta-card{padding:28px 24px;flex-direction:column;text-align:center}
          .lnd-modal{padding:28px 22px}
        }
        @media(prefers-color-scheme:dark){
          body{background:linear-gradient(160deg,#07111f,#0d0a1e,#140d06) !important}
          div[style*="linear-gradient(160deg"]{background:linear-gradient(160deg,#07111f,#0d0a1e,#140d06) !important}
          .lnd-nav{background:rgba(10,20,40,0.8);border-color:rgba(59,130,246,0.15)}
          .lnd-hero h1{color:#f0f6ff} .lnd-hero p{color:#8da4c0}
          .lnd-feature-card{background:rgba(13,27,46,0.9);border-color:rgba(59,130,246,0.2)}
          .lnd-feature-title{color:#e2eeff} .lnd-feature-desc{color:#6b8aad}
          .lnd-feature-icon{background:linear-gradient(135deg,#0c2040,#130a2e);border-color:#1a2d47}
          .lnd-hero-tag{background:#0c2040;border-color:#1a3a6a;color:#60a5fa}
          .lnd-cta-card{background:linear-gradient(135deg,#0c1e33,#130a2e,#1a0f04);border-color:#1a2d47}
          .lnd-cta-card h2{color:#f0f6ff} .lnd-cta-card p{color:#8da4c0}
          .lnd-modal{background:#0d1b2e;border:1px solid #1a2d47}
          .lnd-modal h2{color:#f0f6ff} .lnd-modal p{color:#8da4c0}
          .lnd-label{color:#8da4c0}
          .lnd-input{background:#0c1e33;border-color:#1a3a6a;color:#e2eeff}
          .lnd-input:focus{background:#0c1e33;border-color:#3b82f6}
          .lnd-modal-cancel{background:#0c1e33;border-color:#1a2d47;color:#8da4c0}
          .lnd-footer{border-color:rgba(59,130,246,0.12);color:#4a6280}
          .lnd-success h3{color:#f0f6ff} .lnd-success p{color:#8da4c0}
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

      {/* CTA */}
      <section className="lnd-cta">
        <div className="lnd-cta-card">
          <div>
            <h2>🎯 Szeretné kipróbálni az Ön intézményében is?</h2>
            <p>Kérjen ingyenes próbalehetőséget — díjmentes bevezető, személyes bemutatóval!</p>
          </div>
          <button className="lnd-contact-btn" onClick={() => setContactOpen(true)}>
            📩 Kapcsolatfelvétel
          </button>
        </div>
      </section>

      {/* Contact modal */}
      {contactOpen && (
        <div className="lnd-overlay" onClick={e => { if (e.target === e.currentTarget) closeContact(); }}>
          <div className="lnd-modal">
            {sent ? (
              <div className="lnd-success">
                <div className="si">✅</div>
                <h3>Köszönjük az érdeklődést!</h3>
                <p>Üzenetét megkaptuk, hamarosan felvesszük Önnel a kapcsolatot.</p>
                <button className="lnd-contact-btn" onClick={closeContact} style={{ width:"100%" }}>
                  Bezárás
                </button>
              </div>
            ) : (
              <>
                <h2>📩 Kapcsolatfelvétel</h2>
                <p>Töltse ki az alábbi űrlapot, és hamarosan felvesszük Önnel a kapcsolatot!</p>

                {sendError && (
                  <div className="lnd-error"><span>⚠️</span><span>{sendError}</span></div>
                )}

                <form onSubmit={submitContact}>
                  <div className="lnd-field">
                    <label className="lnd-label">Az Ön neve *</label>
                    <input className="lnd-input" type="text" required placeholder="pl. Kiss János"
                      value={form.name} onChange={e => setField("name", e.target.value)} disabled={sending} />
                  </div>
                  <div className="lnd-field">
                    <label className="lnd-label">Intézménye</label>
                    <input className="lnd-input" type="text" placeholder="pl. Ilosvai Selymes Péter Általános Iskola"
                      value={form.institution} onChange={e => setField("institution", e.target.value)} disabled={sending} />
                  </div>
                  <div className="lnd-field">
                    <label className="lnd-label">E-mail cím *</label>
                    <input className="lnd-input" type="email" required placeholder="pl. kiss.janos@iskola.hu"
                      value={form.email} onChange={e => setField("email", e.target.value)} disabled={sending} />
                  </div>
                  <div className="lnd-field">
                    <label className="lnd-label">Telefonszám</label>
                    <input className="lnd-input" type="tel" placeholder="pl. +36 30 123 4567"
                      value={form.phone} onChange={e => setField("phone", e.target.value)} disabled={sending} />
                  </div>
                  <div className="lnd-modal-actions">
                    <button type="button" className="lnd-modal-cancel" onClick={closeContact} disabled={sending}>
                      Mégse
                    </button>
                    <button type="submit" className="lnd-modal-submit" disabled={sending}>
                      {sending ? "⏳ Küldés…" : "📨 Elküldés"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      <footer className="lnd-footer">
        © {new Date().getFullYear()} SchoolLive · Iskolai kommunikációs rendszer
      </footer>
    </div>
  );
}