/**
 * Client-safe helpers for the LEGACY Shopify vehicle-index cache.
 * Used only by /app/fitment/:handle. Not Ocean fitment authority.
 */

export type VehicleIndexRow = {
  gid: string;
  handle: string;
  vehicleKey: string;
  displayName: string;
  makeName: string;
  modelName: string;
  engineName: string;
  variant: string;
  yearFrom: string;
  yearTo: string;
  bodyType: string;
};

export type VehicleIndexSummary = {
  builtAt: number;
  count: number;
  ready: boolean;
};

function norm(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normKey(v: unknown): string {
  return norm(v).toLowerCase();
}

export function vehicleIndexIsReady(index: {
  ready?: boolean;
  count?: number;
  vehicles?: unknown[];
  makes?: unknown[];
} | null | undefined): boolean {
  if (!index) return false;
  if (index.ready === true) return true;
  if (index.ready === false) return false;
  if (Array.isArray(index.vehicles) && index.vehicles.length > 0) return true;
  if (Array.isArray(index.makes) && index.makes.length > 0) return true;
  return false;
}

export function indexSummaryFromCache(cache: { builtAt: number; count: number; vehicles?: unknown[] } | null): VehicleIndexSummary {
  const count = cache?.vehicles?.length ? cache.vehicles.length : Number(cache?.count ?? 0);
  const ready = Array.isArray(cache?.vehicles) && cache.vehicles.length > 0;
  return {
    builtAt: cache?.builtAt ?? 0,
    count: ready ? count : 0,
    ready,
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

export function vehiclesForMakeModelFromRows(
  vehicles: VehicleIndexRow[],
  make: string,
  model: string,
): VehicleIndexRow[] {
  const makeK = normKey(make);
  const modelK = normKey(model);
  return vehicles.filter((v) => normKey(v.makeName) === makeK && normKey(v.modelName) === modelK);
}
