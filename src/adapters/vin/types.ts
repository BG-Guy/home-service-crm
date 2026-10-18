// VIN decoder interface (SPEC §9.5) — FROZEN shape.
export interface VehicleDecoded {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  engine: string | null;
  fuel: string | null;
  gvwr: string | null;
  /** Lower bound of the GVWR class in lb (USDOT fields shown at ≥ 10,001). */
  gvwrLb: number | null;
  bodyClass: string | null;
  driveType: string | null;
  raw?: unknown;
}
export interface Recall {
  campaign: string;
  component: string | null;
  summary: string | null;
  consequence: string | null;
  remedy: string | null;
  reportedOn: string | null;
}
export interface VinDecoder {
  decode(vin: string, modelYear?: number): Promise<VehicleDecoded | null>;
  recalls(make: string, model: string, year: number): Promise<Recall[]>;
}
