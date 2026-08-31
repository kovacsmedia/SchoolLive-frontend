// src/lib/clientKey.ts
//
// A böngészőnként (pontosabban: localStorage-profilonként) stabil, de NEM
// valódi hardver-azonosító – egy böngésző sandboxból nincs elérhető igazi
// hardver-ID, ez a gyakorlatban elfogadott helyettesítője: egyszer generált,
// localStorage-ban perzisztált UUID, ami túléli a ki/bejelentkezéseket, így
// a multi-session bejelentkezett-kliens listában (ld. auth.controller.ts
// GET /auth/sessions) meg lehet különböztetni "ezt a gépet" a többitől –
// pl. egyik teremben futó webplayer a másiktól.

const CLIENT_KEY_STORAGE = "sl_client_key";

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
    // ignore – privát böngészés / letiltott storage esetén a login így is
    // működik, csak a kliens nem lesz megkülönböztethető a listában
  }
}

export function getClientKey(): string {
  const existing = safeGet(CLIENT_KEY_STORAGE);
  if (existing) return existing;

  const generated: string =
    (crypto as any)?.randomUUID?.() ?? `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  safeSet(CLIENT_KEY_STORAGE, generated);
  return generated;
}

/** Rövid, ember-olvasható böngésző/OS leírás a User-Agentből – csak
 *  megjelenítési célra (a bejelentkezett kliensek listájában), nem
 *  megbízható azonosítás. */
export function friendlyUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Ismeretlen kliens";

  let os = "";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iOS/i.test(ua)) os = "iOS";
  else if (/Mac OS X/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  else browser = "Böngésző";

  return [browser, os].filter(Boolean).join(" · ") || "Ismeretlen kliens";
}
