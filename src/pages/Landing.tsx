import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="sl-landing">
      <div className="sl-shell">
        <div className="sl-card">
          <h1 className="sl-title">Egyszerűbb iskolai kommunikáció</h1>

          <p className="sl-subtitle">
            A SchoolLive segít, hogy az iskolai üzenetek mindig időben, érthetően és
            megbízhatóan eljussanak oda, ahol szükség van rájuk — így kevesebb a
            félreértés, gyorsabb a reagálás, és nyugodtabb a mindennapi működés.
          </p>

          <ul className="sl-bullets">
            <li className="sl-bullet">
              <span className="sl-dot" aria-hidden="true" />
              <span>Egy felületről, gyorsan küldhetsz tájékoztatást több helyre.</span>
            </li>
            <li className="sl-bullet">
              <span className="sl-dot" aria-hidden="true" />
              <span>Fontos üzeneteknél is kiszámítható, követhető működés.</span>
            </li>
            <li className="sl-bullet">
              <span className="sl-dot" aria-hidden="true" />
              <span>Biztonságos belépés és szerepkörök az iskola folyamataihoz igazítva.</span>
            </li>
          </ul>

          <div className="sl-actions">
            <Link to="/login" className="sl-btn sl-btn-primary" aria-label="Bejelentkezés">
              Bejelentkezés
            </Link>

            <a
              className="sl-btn sl-btn-ghost"
              href="https://github.com/kovacsmedia"
              target="_blank"
              rel="noreferrer"
              aria-label="További információk"
            >
              Tudj meg többet
            </a>
          </div>
        </div>

        <div className="sl-logoWrap">
          <picture>
            {/* Dark mode logo (white "School") */}
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
              decoding="async"
            />
          </picture>
        </div>
      </div>
    </div>
  );
}