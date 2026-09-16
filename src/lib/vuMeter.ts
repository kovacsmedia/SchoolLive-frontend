// src/lib/vuMeter.ts
//
// KIVEZÉRLÉSJELZŐ – közös definíciók.
//
// Két helyen jelenik meg ugyanez a jelző: a fejléc monitorozásánál
// (`MonitorPill.tsx`) és az Iskolai Rádió „Élő hangbemenet" fülén
// (`SchoolRadio.tsx`). Azért itt vannak a konstansok, hogy a kettő ne
// csúszhasson szét: ugyanaz a skála, ugyanazok a színhatárok.
//
// A megjelenés klasszikus hifi LED-sor: a színzónák FIXEK, nem a sáv színe
// vált. Mindig ugyanaz a LED világít ugyanabban a színben, és a ki nem
// gyulladt szegmens a saját színének sötét változata – ettől néz ki igazi
// LED-sornak akkor is, amikor néma.

/** LED-ek száma csatornánként. A -60…0 dB skálán ez 3 dB / szegmens. */
export const VU_SEGMENTS = 20;

/** A kialudt LED áttetszősége (a saját színének sötét változata). */
export const VU_DIM = "0.13";

/**
 * Egy szegmens színe az indexe alapján.
 *
 *   zöld   –60 … –18 dB   (0–13)
 *   sárga  –18 …  –6 dB   (14–17)
 *   piros   –6 …   0 dB   (18–19)
 */
export function vuSegmentColor(i: number): string {
  if (i >= 18) return "#dc2626";
  if (i >= 14) return "#eab308";
  return "#22c55e";
}

/** dBFS → hány LED égjen (0…VU_SEGMENTS). A skála alja –60 dB. */
export function vuLitCount(db: number): number {
  const n = Math.round(((db + 60) / 60) * VU_SEGMENTS);
  return Math.max(0, Math.min(VU_SEGMENTS, n));
}

/**
 * Egy hangcsomag RMS-szintje dBFS-ben.
 *
 * A `1e-9` a csend logaritmusát fogja meg: enélkül teljes némaságnál
 * `-Infinity` jönne, amiből `NaN` szegmens-index lenne.
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
