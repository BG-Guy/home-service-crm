import "server-only";
import type { Recall, VehicleDecoded, VinDecoder } from "./types";

// NHTSA vPIC (free) VIN decode + NHTSA recalls API (SPEC M17, §9.5). Plain fetch.

export type { Recall, VehicleDecoded, VinDecoder } from "./types";

const clean = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s !== "Not Applicable" && s !== "0" ? s : null;
};

function gvwrLb(gvwr: string | null): number | null {
  const m = gvwr?.match(/([\d,]+)\s*lb/i);
  return m?.[1] ? Number(m[1].replace(/,/g, "")) : null;
}

export const nhtsaVinDecoder: VinDecoder = {
  async decode(vin, modelYear) {
    const v = vin.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(v)) return null;
    const qs = new URLSearchParams({ format: "json" });
    if (modelYear) qs.set("modelyear", String(modelYear));
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${v}?${qs}`,
      {
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) throw new Error(`vPIC HTTP ${res.status}`);
    const json = (await res.json()) as { Results?: Record<string, string>[] };
    const r = json.Results?.[0];
    if (!r || !clean(r.Make)) return null;
    const engine = [
      clean(r.DisplacementL) ? `${clean(r.DisplacementL)}L` : null,
      clean(r.EngineCylinders) ? `${clean(r.EngineCylinders)} cyl` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const gvwr = clean(r.GVWR);
    const decoded: VehicleDecoded = {
      vin: v,
      year: clean(r.ModelYear) ? Number(r.ModelYear) : null,
      make: clean(r.Make),
      model: clean(r.Model),
      trim: clean(r.Trim),
      engine: engine || null,
      fuel: clean(r.FuelTypePrimary),
      gvwr,
      gvwrLb: gvwrLb(gvwr),
      bodyClass: clean(r.BodyClass),
      driveType: clean(r.DriveType),
      raw: r,
    };
    return decoded;
  },
  async recalls(make, model, year) {
    // NHTSA answers 400 when it has no match for make/model/year; that's "no
    // recalls", not an error. vPIC model names can carry trim/cab words NHTSA
    // doesn't know ("F-150 SuperCrew"), so a miss retries with the base model.
    for (const m of modelCandidates(model)) {
      const list = await fetchRecalls(make, m, year);
      if (list) return list;
    }
    return [];
  },
};

/** The model as given, then its first two words, then the first word alone. */
export function modelCandidates(model: string): string[] {
  const words = model.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const m of [
    words.join(" "),
    words.slice(0, 2).join(" "),
    words[0] ?? "",
  ])
    if (m && !out.includes(m)) out.push(m);
  return out;
}

/** Recalls for one model name; null = NHTSA has no match (HTTP 400/404). */
async function fetchRecalls(
  make: string,
  model: string,
  year: number,
): Promise<Recall[] | null> {
  const qs = new URLSearchParams({ make, model, modelYear: String(year) });
  const res = await fetch(
    `https://api.nhtsa.gov/recalls/recallsByVehicle?${qs}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`NHTSA recalls HTTP ${res.status}`);
  const json = (await res.json()) as { results?: Record<string, string>[] };
  return parseRecalls(json.results);
}

export function parseRecalls(
  results: Record<string, string>[] | undefined,
): Recall[] {
  return (results ?? []).map(
    (r): Recall => ({
      campaign: r.NHTSACampaignNumber ?? "",
      component: clean(r.Component),
      summary: clean(r.Summary),
      consequence: clean(r.Consequence),
      remedy: clean(r.Remedy),
      reportedOn: clean(r.ReportReceivedDate),
    }),
  );
}

export function getVinDecoder(): VinDecoder {
  return nhtsaVinDecoder;
}
