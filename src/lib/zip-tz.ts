import "server-only";

// ZIP → IANA time zone via ZIP3 prefix ranges (SPEC §9.5, M12 quiet hours use the
// recipient's zone). Approximate at split-state borders; the company zone is the
// fallback. Ranges are [firstZip3, lastZip3, zone]; earlier entries win.

const E = "America/New_York";
const C = "America/Chicago";
const M = "America/Denver";
const P = "America/Los_Angeles";

const RANGES: readonly [number, number, string][] = [
  // --- split-state exceptions first
  [324, 325, C], // FL panhandle (Pensacola, Panama City)
  [373, 374, E], // TN Chattanooga
  [376, 379, E], // TN east (Johnson City, Knoxville)
  [400, 402, "America/Kentucky/Louisville"],
  [420, 427, C], // KY west
  [463, 464, C], // IN northwest (Gary)
  [476, 477, C], // IN southwest (Evansville)
  [460, 479, "America/Indiana/Indianapolis"],
  [480, 499, "America/Detroit"],
  [577, 577, M], // SD west (Rapid City)
  [586, 586, M], // ND southwest (Dickinson)
  [693, 693, M], // NE panhandle
  [798, 799, M], // TX El Paso
  [835, 835, P], // ID north (Lewiston)
  [838, 838, P], // ID panhandle (Coeur d'Alene)
  [832, 838, "America/Boise"],
  [979, 979, "America/Boise"], // OR Malheur county
  // --- states
  [5, 5, E], // NY Holtsville
  [6, 7, "America/Puerto_Rico"],
  [8, 8, "America/St_Thomas"],
  [9, 9, "America/Puerto_Rico"],
  [10, 89, E], // New England, NJ
  [100, 299, E], // NY, PA, DE, DC, MD, VA, WV, NC, SC
  [300, 349, E], // GA, FL
  [350, 372, C], // AL, TN (Nashville, Memphis…)
  [375, 375, C],
  [380, 397, C], // TN west, MS
  [398, 399, E], // GA
  [403, 419, E], // KY east
  [430, 459, E], // OH
  [500, 576, C], // IA, WI, MN, DC(569→E handled below), SD
  [578, 588, C], // SD, ND
  [590, 599, M], // MT
  [600, 692, C], // IL, MO, KS, NE
  [700, 797, C], // LA, AR, OK, TX
  [800, 831, M], // CO, WY
  [840, 847, M], // UT
  [850, 865, "America/Phoenix"],
  [870, 884, M], // NM
  [885, 885, M], // TX El Paso (885)
  [889, 898, P], // NV
  [900, 961, P], // CA
  [967, 968, "Pacific/Honolulu"],
  [969, 969, "Pacific/Guam"],
  [970, 978, P], // OR
  [980, 994, P], // WA
  [995, 999, "America/Anchorage"],
];

/** IANA zone for a US ZIP (5-digit or ZIP+4), or null if unknown/military. */
export function timezoneForZip(zip: string | null | undefined): string | null {
  const digits = (zip ?? "").replace(/\D/g, "");
  if (digits.length < 3) return null;
  const z3 = Number(digits.slice(0, 3));
  if (z3 === 569) return E; // DC
  for (const [a, b, tz] of RANGES) if (z3 >= a && z3 <= b) return tz;
  return null;
}
