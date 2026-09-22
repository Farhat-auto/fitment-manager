/**
 * Client-safe vehicle-index query helpers.
 * Make → Model → Generation/type → Engine/exact vehicle.
 * This is picker UX over canonical Ocean/Shopify vehicle identity, not a second vehicle DB.
 */

export const VEHICLE_INDEX_SCHEMA_VERSION = "vehicle-index-v2";

export type VehicleIndexRow = {
  gid: string;
  handle: string;
  vehicleKey: string;
  displayName: string;
  makeName: string;
  modelName: string;
  generationName: string;
  series: string;
  chassis: string;
  engineName: string;
  engineCode: string;
  variant: string;
  yearFrom: string;
  yearTo: string;
  bodyType: string;
  power: string;
};

export type VehicleIndexSummary = {
  builtAt: number;
  count: number;
  ready: boolean;
  complete: boolean;
  pageCount: number;
  hasNextPage: boolean;
  schemaVersion: string;
};

function norm(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normKey(v: unknown): string {
  return norm(v).toLowerCase();
}

export function generationLabelFromRow(v: VehicleIndexRow): string {
  return (
    norm(v.generationName) ||
    norm(v.series) ||
    norm(v.chassis) ||
    norm(v.bodyType) ||
    [norm(v.yearFrom), norm(v.yearTo)].filter(Boolean).join("–")
  );
}

export function engineLabelFromRow(v: VehicleIndexRow): string {
  const parts = [
    norm(v.engineName) || norm(v.engineCode),
    norm(v.variant),
    norm(v.power),
    [norm(v.yearFrom), norm(v.yearTo)].filter(Boolean).join("–"),
    norm(v.vehicleKey),
  ].filter(Boolean);
  return parts.join(" · ") || norm(v.displayName) || norm(v.handle) || v.gid;
}

export function vehicleIndexIsReady(index: {
  ready?: boolean;
  complete?: boolean;
  count?: number;
  vehicles?: unknown[];
  makes?: unknown[];
} | null | undefined): boolean {
  if (!index) return false;
  if (Array.isArray(index.vehicles) && index.vehicles.length > 0) return true;
  if (Array.isArray(index.makes) && index.makes.length > 0) return true;
  return false;
}

export function indexSummaryFromCache(
  cache: {
    builtAt: number;
    count: number;
    vehicles?: unknown[];
    complete?: boolean;
    pageCount?: number;
    hasNextPage?: boolean;
    schemaVersion?: string;
  } | null,
): VehicleIndexSummary {
  const count = cache?.vehicles?.length ? cache.vehicles.length : Number(cache?.count ?? 0);
  const ready = Array.isArray(cache?.vehicles) && cache.vehicles.length > 0;
  return {
    builtAt: cache?.builtAt ?? 0,
    count: ready ? count : 0,
    ready,
    complete: cache?.complete === true && ready,
    pageCount: Number(cache?.pageCount ?? 0),
    hasNextPage: cache?.hasNextPage === true,
    schemaVersion: String(cache?.schemaVersion || ""),
  };
}

export function listMakesFromRows(vehicles: VehicleIndexRow[]): string[] {
  const seen = new Set<string>();
  for (const v of vehicles) {
    const m = norm(v.makeName);
    if (m) seen.add(m);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function listModelsFromRows(vehicles: VehicleIndexRow[], make: string): string[] {
  const makeK = normKey(make);
  const seen = new Set<string>();
  for (const v of vehicles) {
    if (normKey(v.makeName) !== makeK) continue;
    const m = norm(v.modelName);
    if (m) seen.add(m);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function listGenerationsFromRows(vehicles: VehicleIndexRow[], make: string, model: string): string[] {
  const makeK = normKey(make);
  const modelK = normKey(model);
  const seen = new Set<string>();
  for (const v of vehicles) {
    if (normKey(v.makeName) !== makeK || normKey(v.modelName) !== modelK) continue;
    const g = generationLabelFromRow(v);
    if (g) seen.add(g);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function vehiclesForMakeModelFromRows(
  vehicles: VehicleIndexRow[],
  make: string,
  model: string,
): VehicleIndexRow[] {
  const makeK = normKey(make);
  const modelK = normKey(model);
  return vehicles.filter((v) => normKey(v.makeName) === makeK && normKey(v.modelName) === modelK);
}

export function vehiclesForMakeModelGenerationFromRows(
  vehicles: VehicleIndexRow[],
  make: string,
  model: string,
  generation: string,
): VehicleIndexRow[] {
  const rows = vehiclesForMakeModelFromRows(vehicles, make, model);
  const genK = normKey(generation);
  if (!genK) return [];
  return rows.filter((v) => normKey(generationLabelFromRow(v)) === genK);
}

export function countsByMakeFromRows(vehicles: VehicleIndexRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of vehicles) {
    const m = norm(v.makeName) || "(blank make)";
    out[m] = (out[m] || 0) + 1;
  }
  return out;
}
