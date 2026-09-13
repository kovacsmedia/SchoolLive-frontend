// src/lib/playerAuth.ts
//
// A WEBPLAYER (PLAYER szerepkör) SOHA NEM KERÜLHET A BEJELENTKEZŐ KÉPERNYŐRE.
//
// Egy teremben futó kijelzőhöz senki nem fog odamenni jelszót írni, ezért a
// követelmény abszolút: sem magától, sem a backend miatt, sem egy másik
// eszközről történő bejelentkezés miatt nem léphet ki.
//
// A backend oldalon ez már adott: a PLAYER szerep multi-session (ld.
// auth.service.ts – a `deleteMany` csak a NEM-player ágon fut), tehát egy
// másik terem belépése nem üti ki ezt a munkamenetet.
//
// Ami hiányzott: a kliens 401-kezelése. A csendes újra-bejelentkezés eddig
// KIZÁRÓLAG a `session_revoked` hibakódra futott le. Egy sima "Invalid token"
// 401 – például ha a backend JWT-titka cserélődik egy deploynál, vagy a token
// bármi miatt érvénytelenné válik – a login-képernyőre dobta a kijelzőt.
//
// Ez a modul azért külön, mert KÉT helyről kell elérni:
//   • api.ts – bármelyik 401-es válasznál,
//   • AuthContext.tsx – az induló /auth/me hívás 401-jénél, amikor a
//     VirtualPlayer komponens még be sem töltődött, tehát kezelőt sem
//     regisztrálhatott.

const CREDS_KEY = "vpCredentials";

function readCreds(): { email: string; password: string } | null {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as { email?: string; password?: string };
    if (!c?.email || !c?.password) return null;
    return { email: c.email, password: c.password };
  } catch {
    return null;
  }
}

/** Van-e eltárolt webplayer-hitelesítés, amivel csendben vissza tudunk lépni? */
export function hasPlayerCredentials(): boolean {
  return readCreds() !== null;
}

// Egyszerre csak EGY újra-bejelentkezés fusson: több párhuzamos 401-es kérés
// (a webplayer több végpontot is hív) különben egymásra torlódó login-okat
// indítana, és felesleges terhelést tenne a backendre.
let inFlight: Promise<boolean> | null = null;

/**
 * Csendes újra-bejelentkezés a tárolt hitelesítő adatokkal.
 * @returns true, ha sikerült friss tokent szerezni.
 */
export function tryPlayerRelogin(apiBase: string): Promise<boolean> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const creds = readCreds();
    if (!creds) return false;
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(creds),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data?.accessToken) return false;

      // Ugyanabba a tárolóba írjuk vissza, ahonnan eddig olvastuk – a
      // szerepkör-alapú tárolási szabályt (sessionStorage vs localStorage)
      // nem írhatjuk felül itt.
      if (sessionStorage.getItem("accessToken")) {
        sessionStorage.setItem("accessToken", data.accessToken);
      } else {
        localStorage.setItem("accessToken", data.accessToken);
      }
      console.info("[playerAuth] csendes ujra-bejelentkezes sikeres");
      return true;
    } catch (e) {
      console.warn("[playerAuth] csendes ujra-bejelentkezes hiba:", e);
      return false;
    } finally {
      // A következő 401 újra próbálkozhat.
      setTimeout(() => { inFlight = null; }, 0);
    }
  })();

  return inFlight;
}
