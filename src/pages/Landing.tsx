import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="sl-landing">
      {/* Local, route-scoped styles to avoid touching global index.css yet */}
      <style>{`
        :root {
          color-scheme: light dark;
        }

        .sl-landing {
          min-height: 100vh;
          width: 100%;
          padding: clamp(16px, 4vw, 48px);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sl-shell {
          width: 100%;
          max-width: 1080px;
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: clamp(18px, 4vw, 42px);
          align-items: center;
        }

        .sl-card {
          border-radius: 20px;
          border: 1px solid rgba(127,127,127,0.25);
          background: rgba(255,255,255,0.65);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          box-shadow: 0 10px 30px rgba(0,0,0,0.12);
          padding: clamp(18px, 4vw, 36px);
        }

        .sl-title {
          font-size: clamp(28px, 4vw, 44px);
          line-height: 1.06;
          letter-spacing: -0.02em;
          margin: 0 0 10px;
        }

        .sl-subtitle {
          font-size: clamp(14px, 1.7vw, 18px);
          line-height: 1.5;
          margin: 0 0 18px;
          opacity: 0.9;
        }

        .sl-bullets {
          display: grid;
          gap: 10px;
          margin: 18px 0 0;
          padding: 0;
          list-style: none;
        }

        .sl-bullet {
          display: grid;
          grid-template-columns: 12px 1fr;
          gap: 10px;
          align-items: start;
          font-size: 15px;
          line-height: 1.45;
          opacity: 0.95;
        }

        .sl-dot {
          width: 10px;
          height: 10px;
          margin-top: 6px;
          border-radius: 999px;
          background: currentColor;
          opacity: 0.55;
        }

        .sl-actions {
          display: flex;
          gap: 12px;
          margin-top: 22px;
          flex-wrap: wrap;
        }

        .sl-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 12px 16px;
          border-radius: 14px;
          border: 1px solid rgba(127,127,127,0.35);
          text-decoration: none;
          font-weight: 600;
          font-size: 14px;
          line-height: 1;
          transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
          user-select: none;
        }

        .sl-btn:active {
          transform: translateY(1px);
        }

        .sl-btn-primary {
          background: rgba(94, 78, 161, 0.14);
          box-shadow: 0 8px 18px rgba(94, 78, 161, 0.18);
        }

        .sl-btn-primary:hover {
          background: rgba(94, 78, 161, 0.18);
          box-shadow: 0 10px 22px rgba(94, 78, 161, 0.22);
        }

        .sl-btn-ghost {
          background: rgba(127,127,127,0.08);
        }

        .sl-btn-ghost:hover {
          background: rgba(127,127,127,0.12);
        }

        .sl-logoWrap {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sl-logo {
          width: min(320px, 72vw);
          height: auto;
          filter: drop-shadow(0 10px 18px rgba(0,0,0,0.12));
        }

        .sl-footnote {
          margin-top: 16px;
          font-size: 12.5px;
          line-height: 1.45;
          opacity: 0.75;
        }

        .sl-badgeRow {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 14px;
        }

        .sl-badge {
          font-size: 12px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(127,127,127,0.28);
          background: rgba(127,127,127,0.08);
          opacity: 0.95;
          white-space: nowrap;
        }

        .sl-gridBg {
          position: fixed;
          inset: 0;
          pointer-events: none;
          opacity: 0.35;
          background:
            radial-gradient(600px 280px at 15% 15%, rgba(105, 176, 214, 0.25), transparent 70%),
            radial-gradient(520px 260px at 85% 20%, rgba(94, 78, 161, 0.22), transparent 70%),
            linear-gradient(to bottom, rgba(127,127,127,0.08), transparent 35%),
            repeating-linear-gradient(0deg, rgba(127,127,127,0.08) 0px, rgba(127,127,127,0.08) 1px, transparent 1px, transparent 44px),
            repeating-linear-gradient(90deg, rgba(127,127,127,0.06) 0px, rgba(127,127,127,0.06) 1px, transparent 1px, transparent 44px);
        }

        @media (prefers-color-scheme: dark) {
          .sl-card {
            background: rgba(15, 15, 18, 0.55);
            border-color: rgba(255,255,255,0.14);
            box-shadow: 0 14px 36px rgba(0,0,0,0.35);
          }
          .sl-btn {
            border-color: rgba(255,255,255,0.16);
          }
          .sl-btn-ghost {
            background: rgba(255,255,255,0.06);
          }
          .sl-btn-ghost:hover {
            background: rgba(255,255,255,0.10);
          }
          .sl-btn-primary {
            background: rgba(105, 176, 214, 0.16);
            box-shadow: 0 10px 22px rgba(105, 176, 214, 0.16);
          }
          .sl-btn-primary:hover {
            background: rgba(105, 176, 214, 0.20);
            box-shadow: 0 12px 26px rgba(105, 176, 214, 0.20);
          }
          .sl-gridBg {
            opacity: 0.30;
          }
        }

        @media (max-width: 860px) {
          .sl-shell {
            grid-template-columns: 1fr;
          }
          .sl-logoWrap {
            order: -1;
          }
        }
      `}</style>

      <div className="sl-gridBg" />

      <div className="sl-shell">
        <div className="sl-card">
          <h1 className="sl-title">SchoolLive</h1>
          <p className="sl-subtitle">
            Felhő- és IoT-alapú iskolai kommunikációs rendszer: üzenetküldés, kijelzők és okoshangszórók
            vezérlése, több szerepkörrel és biztonságos, determinisztikus parancs-végrehajtási folyamattal.
          </p>

          <div className="sl-badgeRow" aria-label="Kulcs jellemzők">
            <span className="sl-badge">JWT auth</span>
            <span className="sl-badge">Multi-tenant</span>
            <span className="sl-badge">Device poll / ack</span>
            <span className="sl-badge">Retry / backoff</span>
          </div>

          <ul className="sl-bullets">
            <li className="sl-bullet">
              <span className="sl-dot" />
              <span>
                Admin oldalon parancsok küldése eszközökre (pl. <b>SET_VOLUME</b>), és a státusz követése
                (QUEUED → SENT → ACKED / FAILED).
              </span>
            </li>
            <li className="sl-bullet">
              <span className="sl-dot" />
              <span>
                Szerepkör-alapú hozzáférés: SUPER_ADMIN, TENANT_ADMIN, ORG_ADMIN, TEACHER, OPERATOR, PLAYER.
              </span>
            </li>
            <li className="sl-bullet">
              <span className="sl-dot" />
              <span>
                Publikus landing page — a védett funkciók csak sikeres belépés után érhetők el.
                <br />
                <span className="sl-footnote">
                  (Superadmin bejelentkezést nem tárolunk: nincs “remember me”, nincs cookie-s session.)
                </span>
              </span>
            </li>
          </ul>

          <div className="sl-actions">
            <Link to="/login" className="sl-btn sl-btn-primary" aria-label="Tovább a bejelentkezéshez">
              Bejelentkezés
              <span aria-hidden="true">→</span>
            </Link>

            <a
              className="sl-btn sl-btn-ghost"
              href="https://github.com/kovacsmedia"
              target="_blank"
              rel="noreferrer"
              aria-label="Projekt forráskód (GitHub)"
            >
              Forráskód
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>

        <div className="sl-logoWrap">
          <picture>
            <source srcSet="/brand/schoollive-logow.svg" type="image/svg+xml" />
            <img
              className="sl-logo"
              src="/brand/schoollive-logo.png"
              alt="SchoolLive logo"
              loading="eager"
              decoding="async"
            />
          </picture>
        </div>
      </div>
    </div>
  );
}