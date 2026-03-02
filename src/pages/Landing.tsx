import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="sl-landing">
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
          font-family: "Ubuntu", system-ui, -apple-system, BlinkMacSystemFont,
                       "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        .sl-shell {
          width: 100%;
          max-width: 1100px;
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: clamp(20px, 4vw, 48px);
          align-items: center;
        }

        .sl-card {
          border-radius: 20px;
          border: 1px solid rgba(127,127,127,0.25);
          background: rgba(255,255,255,0.75);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          box-shadow: 0 14px 40px rgba(0,0,0,0.12);
          padding: clamp(22px, 4vw, 42px);
        }

        .sl-title {
          font-size: clamp(32px, 4vw, 48px);
          margin: 0 0 16px;
          letter-spacing: -0.02em;
        }

        .sl-subtitle {
          font-size: clamp(15px, 1.8vw, 19px);
          line-height: 1.6;
          margin-bottom: 22px;
          opacity: 0.9;
        }

        .sl-bullets {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 14px;
        }

        .sl-bullet {
          display: flex;
          gap: 10px;
          font-size: 15px;
          line-height: 1.5;
        }

        .sl-dot {
          width: 8px;
          height: 8px;
          margin-top: 8px;
          border-radius: 999px;
          background: currentColor;
          opacity: 0.6;
        }

        .sl-actions {
          margin-top: 28px;
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
        }

        .sl-btn {
          padding: 12px 18px;
          border-radius: 14px;
          font-weight: 600;
          text-decoration: none;
          border: 1px solid rgba(127,127,127,0.35);
          transition: all 120ms ease;
        }

        .sl-btn-primary {
          background: rgba(94, 78, 161, 0.15);
        }

        .sl-btn-primary:hover {
          background: rgba(94, 78, 161, 0.22);
        }

        .sl-btn-ghost {
          background: rgba(127,127,127,0.08);
        }

        .sl-btn-ghost:hover {
          background: rgba(127,127,127,0.15);
        }

        .sl-logoWrap {
          display: flex;
          justify-content: center;
        }

        .sl-logo {
          width: min(340px, 70vw);
          height: auto;
        }

        .sl-gridBg {
          position: fixed;
          inset: 0;
          pointer-events: none;
          opacity: 0.35;
          background:
            radial-gradient(600px 280px at 15% 15%, rgba(105,176,214,0.25), transparent 70%),
            radial-gradient(520px 260px at 85% 20%, rgba(94,78,161,0.22), transparent 70%);
        }

        @media (prefers-color-scheme: dark) {
          .sl-card {
            background: rgba(18,18,22,0.7);
            border-color: rgba(255,255,255,0.14);
            box-shadow: 0 16px 46px rgba(0,0,0,0.35);
          }
        }

        @media (max-width: 860px) {
          .sl-shell {
            grid-template-columns: 1fr;
          }
          .sl-logoWrap {
            order: -1;
            margin-bottom: 20px;
          }
        }
      `}</style>

      <div className="sl-gridBg" />

      <div className="sl-shell">
        <div className="sl-card">
          <h1 className="sl-title">Egyszerűbb iskolai kommunikáció</h1>

          <p className="sl-subtitle">
            A SchoolLive segít, hogy az iskolai üzenetek mindig időben,
            egyértelműen és minden érintetthez eljussanak — legyen szó
            tanárokról, diákokról vagy technikai személyzetről.
          </p>

          <ul className="sl-bullets">
            <li className="sl-bullet">
              <span className="sl-dot" />
              <span>
                Egy kattintással küldhetsz üzenetet több eszközre és helyszínre.
              </span>
            </li>
            <li className="sl-bullet">
              <span className="sl-dot" />
              <span>
                Azonnali reakció, megbízható működés — akkor is, ha fontos bejelentésről van szó.
              </span>
            </li>
            <li className="sl-bullet">
              <span className="sl-dot" />
              <span>
                Modern, biztonságos rendszer, amely alkalmazkodik az iskola igényeihez.
              </span>
            </li>
          </ul>

          <div className="sl-actions">
            <Link to="/login" className="sl-btn sl-btn-primary">
              Bejelentkezés
            </Link>

            <a
              className="sl-btn sl-btn-ghost"
              href="https://github.com/kovacsmedia"
              target="_blank"
              rel="noreferrer"
            >
              Tudj meg többet
            </a>
          </div>
        </div>

        <div className="sl-logoWrap">
          <picture>
            {/* Dark mode logo */}
            <source
              srcSet="/brand/schoollive-logow.svg"
              media="(prefers-color-scheme: dark)"
              type="image/svg+xml"
            />
            {/* Light mode logo */}
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
            />
          </picture>
        </div>
      </div>
    </div>
  );
}