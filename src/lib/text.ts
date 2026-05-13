// src/lib/text.ts
//
// Szöveg-normalizálás helperei. A SchoolLive admin UI több helyen sztrájkol
// az ékezetes betűkkel (régebbi backend/audio-pipeline szabadon, de fájlnév-
// és listanév-szinten kompatibilitási problémák voltak), ezért minden olyan
// inputot, ami fájlra / rádióra / lejátszási listára vonatkozik, ékezet-
// mentesítünk a beírás pillanatában.
//
// FONTOS: a TTS-en felolvasandó szövegre (Messages composer "Üzenet szövege")
// NE használd ezt – a Piper TTS pontosan az ékezetes betűk alapján mondja
// ki a magyar szavakat.

/**
 * Eltávolít minden combining diacritic jelet (ékezetek, mellékjelek)
 * a stringből. Magyar példák:
 *   "rádió"        → "radio"
 *   "Csukás"       → "Csukas"
 *   "ÁRVÍZTŰRŐ"    → "ARVIZTURO"
 *   "Pőtyörgő"     → "Potyorgo"
 * Egyéb jelek (szóköz, kötőjel, számok, írásjelek) változatlanok maradnak.
 */
export function stripAccents(s: string): string {
  if (!s) return s;
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Onchange-eseményekben hasznos: ha egy textarea/input ékezetes karaktert kap,
 * azonnal cseréljük a hozzá tartozó base-karakterre. Az `onChange` handler-ben:
 *   onChange={e => setName(stripAccents(e.target.value))}
 */
export const normalizeFileName = stripAccents;
