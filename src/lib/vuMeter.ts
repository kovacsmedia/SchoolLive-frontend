// src/lib/vuMeter.ts
//
// KIVEZÉRLÉSJELZŐ – közös definíciók.
//
// Két helyen jelenik meg ugyanez a jelző: a fejléc monitorozásánál
// (`MonitorPill.tsx`) és az Iskolai Rádió „Élő hangbemenet" fülén
// (`SchoolRadio.tsx`). Azért itt vannak a konstansok, hogy a kettő ne
// csúszhasson szét: ugyanaz a skála, ugyanazok a színhatárok.
//
// FOLYTONOS SÁV, RÉSZENKÉNT FIX SZÍNNEL.
//
// A színátmenet a sáv TELJES hosszán ül, és nem a kitöltés méretéhez
// igazodik – a zöld/sárga/piros határ tehát mindig ugyanott van, akármekkora
// a kivezérlés. Ezt `clip-path`-szal érjük el: a festett elem végig
// teljes szélességű, csak a jobb oldalát vágjuk le a szint arányában.
// (Ha a szélességét változtatnánk, az átmenet vele együtt zsugorodna, és a
// színhatárok vándorolnának – pont azt a hibát hozná vissza, ami miatt
// korábban az egész sáv színe váltott.)

/** A skála alja dBFS-ben. Efölött 0…100% a kitöltés. */
export const VU_MIN_DB = -60;

/**
 * A fix színzónák. A százalékok a -60…0 dB skálán:
 *   zöld   -60 … -18 dB   (0 … 70%)
 *   sárga  -18 …  -6 dB   (70 … 90%)
 *   piros   -6 …   0 dB   (90 … 100%)
 */
export const VU_GRADIENT =
  "linear-gradient(90deg," +
  "#22c55e 0%,#22c55e 70%," +
  "#eab308 70%,#eab308 90%," +
  "#dc2626 90%,#dc2626 100%)";

/** A ki nem vezérelt rész áttetszősége – a skála halványan végig látszik. */
export const VU_DIM = "0.13";

/** dBFS → a sáv kitöltése százalékban (0…100). */
export function vuPercent(db: number): number {
  const pct = ((db - VU_MIN_DB) / -VU_MIN_DB) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * `clip-path` érték adott kitöltéshez: a jobb oldalt vágjuk le.
 * A festett elem végig teljes szélességű marad, ezért a színhatárok
 * a helyükön maradnak.
 */
export function vuClip(percent: number): string {
  return `inset(0 ${(100 - percent).toFixed(1)}% 0 0)`;
}

/**
 * Egy hangcsomag RMS-szintje dBFS-ben.
 *
 * A `1e-9` a csend logaritmusát fogja meg: enélkül teljes némaságnál
 * `-Infinity` jönne, amiből `NaN` százalék lenne.
 */
export function vuRmsDb(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
}

/** Egy hangcsomag csúcsszintje dBFS-ben (csúcstartóhoz). */
export function vuPeakDb(buf: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  return 20 * Math.log10(peak + 1e-9);
}
