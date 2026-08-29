// src/i18n/index.ts
// UI-lokalizáció: react-i18next inicializálás. A src/i18n/locales/<lang>/<ns>.json
// fájlokat Vite import.meta.glob-bal, eager módban tölti be (a teljes szótár
// méret kicsi, nem éri meg lazy-backend-et bevezetni érte).
//
// A user által választott nyelv forrása: User.locale (DB), a localStorage
// "uiLocale" kulcs csak app-indításkor, a bejelentkezett user betöltéséig
// szolgál gyors, villanásmentes kezdőértékként (ld. AuthContext.tsx).
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const SUPPORTED_LOCALES = ["hu", "en", "de", "sk", "pl", "ro", "uk", "sr", "hr"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_NATIVE_NAMES: Record<SupportedLocale, string> = {
  hu: "Magyar",
  en: "English",
  de: "Deutsch",
  sk: "Slovenčina",
  pl: "Polski",
  ro: "Română",
  uk: "Українська",
  sr: "Српски",
  hr: "Hrvatski",
};

const DEFAULT_LOCALE: SupportedLocale = "hu";
const UI_LOCALE_STORAGE_KEY = "uiLocale";

// path minta: ./locales/<lang>/<namespace>.json
const modules = import.meta.glob("./locales/*/*.json", { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;

const resources: Record<string, Record<string, Record<string, unknown>>> = {};

for (const [path, mod] of Object.entries(modules)) {
  const m = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!m) continue;
  const [, lang, namespace] = m;
  resources[lang] ??= {};
  resources[lang][namespace] = mod.default;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

// Első látogatáskor (még nincs sem tárolt uiLocale, sem bejelentkezett user)
// a böngésző nyelvét próbáljuk meg — ha egyezik valamelyik támogatott
// nyelvvel, azt használjuk; ha a böngésző nyelve a 9 támogatotton KÍVÜLI,
// akkor angolra esünk vissza (NEM magyarra — ez szándékos, user-döntés: a
// landing/login oldal első benyomása legyen a látogató saját nyelvén, vagy
// ha az nem elérhető, angolul, ne automatikusan magyarul).
function detectBrowserLocale(): SupportedLocale {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const candidates = nav?.languages?.length ? nav.languages : (nav?.language ? [nav.language] : []);
  for (const lang of candidates) {
    const primary = lang.split("-")[0].toLowerCase();
    if (isSupportedLocale(primary)) return primary;
  }
  return "en";
}

const storedLocale = safeGet(UI_LOCALE_STORAGE_KEY);
const initialLocale: SupportedLocale = isSupportedLocale(storedLocale) ? storedLocale : detectBrowserLocale();

i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: DEFAULT_LOCALE,
  ns: Object.keys(resources[DEFAULT_LOCALE] ?? {}),
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
});

// AuthContext hívja sikeres login/refresh után, hogy a DB-ben tárolt
// user.locale legyen az igazság forrása, és a localStorage tükrözve legyen
// a köv. app-indításhoz (mielőtt az /auth/me válasz megérkezne).
export function applyLocale(locale: unknown) {
  if (!isSupportedLocale(locale)) return;
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
  safeSet(UI_LOCALE_STORAGE_KEY, locale);
}

export default i18n;
