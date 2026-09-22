import {
  indexSummaryFromCache,
  listMakesFromRows,
  listModelsFromRows,
  vehiclesForMakeModelFromRows,
  type VehicleIndexRow as VehicleIndexRowBase,
} from "./vehicleIndexQuery.ts";
import {
  getDurableVehicleIndexStore,
  type VehicleIndexCache,
} from "./vehicleIndexDurable.server.ts";

/** Return value of `authenticate.admin(request).admin` — GraphQL admin client. */
export type ShopifyAdmin = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type VehicleIndexRow = VehicleIndexRowBase;
export type { VehicleIndexCache };

function norm(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

const LIST_VEHICLES_FOR_INDEX = `#graphql
  query ListVehiclesForIndex($first: Int! = 25, $after: String) {
    metaobjects(type: "vehicle", first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        vehicle_key: field(key: "vehicle_key") { value }
        display_name: field(key: "display_name") { value }
        body_type: field(key: "body_type") { value }
        make: field(key: "make") {
          value
          reference { ... on Metaobject { displayName name: field(key: "name") { value } display_name: field(key: "display_name") { value } } }
        }
        model: field(key: "model") {
          value
          reference { ... on Metaobject { displayName name: field(key: "name") { value } display_name: field(key: "display_name") { value } } }
        }
        year_from: field(key: "year_from") { value }
        year_to: field(key: "year_to") { value }
        engine_code: field(key: "engine_code") {
          value
          reference { ... on Metaobject { displayName name: field(key: "name") { value } display_name: field(key: "display_name") { value } } }
        }
        engine: field(key: "engine") {
          value
          reference { ... on Metaobject { displayName name: field(key: "name") { value } display_name: field(key: "display_name") { value } } }
        }
        variant: field(key: "variant") {
          value
          reference { ... on Metaobject { displayName name: field(key: "name") { value } display_name: field(key: "display_name") { value } } }
        }
      }
    }
  }
`;

function optLabel(field: any): string {
  const value = norm(field?.value);
  const ref = field?.reference;
  const dn = norm(ref?.displayName);
  const name = norm(ref?.name?.value);
  const displayName2 = norm(ref?.display_name?.value);
  return dn || name || displayName2 || value;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function graphqlWithBackoff(admin: ShopifyAdmin, query: string, variables: any) {
  const delays = [1000, 2000, 4000];
  let lastErr: any = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const resp = await admin.graphql(query, { variables });
      if (resp.status === 429) {
        const ra = Number(resp.headers.get("retry-after") ?? "");
        const waitMs = Number.isFinite(ra) && ra > 0 ? Math.round(ra * 1000) : delays[Math.min(attempt, delays.length - 1)] ?? 4000;
        if (attempt === delays.length) throw new Error("Shopify Admin API throttled this request (HTTP 429).");
        await sleep(waitMs);
        continue;
      }
      return resp;
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? "");
      const isThrottled = msg.toLowerCase().includes("throttled") || msg.includes("429");
      if (!isThrottled) throw e;
      if (attempt === delays.length) throw e;
      await sleep(delays[attempt] ?? 4000);
    }
  }
  throw lastErr ?? new Error("Shopify request failed");
}

async function loadDurable(shopDomain: string): Promise<VehicleIndexCache | null> {
  try {
    return await getDurableVehicleIndexStore().load(shopDomain);
  } catch {
    // Missing SUPABASE_* or table: fail closed. Never invent a ready index.
    return null;
  }
}

/**
 * Explicit Refresh Vehicle Index only. Writes public.vehicle_index_cache.
 * Process memory and .cache disk are not the source of truth.
 */
export async function buildVehicleIndex(params: {
  admin: ShopifyAdmin;
  shopDomain: string;
}): Promise<VehicleIndexCache> {
  const vehicles: VehicleIndexRow[] = [];
  let after: string | null = null;
  let hasNext = true;

  const pageSize = 25;
  const maxPages = 40;
  let pageCount = 0;

  while (hasNext && pageCount < maxPages) {
    const resp = await graphqlWithBackoff(params.admin, LIST_VEHICLES_FOR_INDEX, { first: pageSize, after });
    pageCount += 1;
    const data = await resp.json();
    const conn = data?.data?.metaobjects;
    const nodes: any[] = Array.isArray(conn?.nodes) ? conn.nodes : [];

    for (const n of nodes) {
      const gid = norm(n?.id);
      if (!gid) continue;
      vehicles.push({
        gid,
        handle: norm(n?.handle),
        vehicleKey: norm(n?.vehicle_key?.value),
        displayName: norm(n?.display_name?.value),
        makeName: optLabel(n?.make),
        modelName: optLabel(n?.model),
        engineName: optLabel(n?.engine_code) || optLabel(n?.engine),
        variant: optLabel(n?.variant),
        yearFrom: norm(n?.year_from?.value),
        yearTo: norm(n?.year_to?.value),
        bodyType: norm(n?.body_type?.value),
      });
    }

    hasNext = !!conn?.pageInfo?.hasNextPage;
    after = typeof conn?.pageInfo?.endCursor === "string" ? conn.pageInfo.endCursor : null;
    if (!after) hasNext = false;
  }

  const cache: VehicleIndexCache = {
    builtAt: Date.now(),
    count: vehicles.length,
    vehicles,
  };

  await getDurableVehicleIndexStore().save(params.shopDomain, cache);
  return cache;
}

/**
 * Loader GET and POST actions must read the SAME durable vehicle-index state.
 * Cache miss: do not list the whole Shopify vehicle catalogue on a product GET.
 * Make/Model/Engine options come from public.vehicle_index_cache only after an explicit refresh.
 */
export async function getVehicleIndex(params: {
  admin: ShopifyAdmin;
  shopDomain: string;
  refresh?: boolean;
}): Promise<VehicleIndexCache | null> {
  if (!params.refresh) {
    return loadDurable(params.shopDomain);
  }
  try {
    return await buildVehicleIndex({ admin: params.admin, shopDomain: params.shopDomain });
  } catch {
    return loadDurable(params.shopDomain);
  }
}

export function indexSummary(cache: VehicleIndexCache | null) {
  return indexSummaryFromCache(cache);
}

export function listMakes(cache: VehicleIndexCache): string[] {
  return listMakesFromRows(cache.vehicles);
}

export function listModels(cache: VehicleIndexCache, make: string): string[] {
  return listModelsFromRows(cache.vehicles, make);
}

export function vehiclesForMakeModel(cache: VehicleIndexCache, make: string, model: string): VehicleIndexRow[] {
  return vehiclesForMakeModelFromRows(cache.vehicles, make, model);
}

export function facetEngines(rows: VehicleIndexRow[]): string[] {
  const seen = new Set<string>();
  for (const v of rows) {
    const e = norm(v.engineName);
    if (e) seen.add(e);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function facetVariants(rows: VehicleIndexRow[], engines: string[]): string[] {
  const enginesK = new Set((engines || []).map((x) => norm(x).toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  for (const v of rows) {
    if (enginesK.size && !enginesK.has(norm(v.engineName).toLowerCase())) continue;
    const vv = norm(v.variant);
    if (vv) seen.add(vv);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function facetYears(rows: VehicleIndexRow[], engines: string[], variants: string[]) {
  const enginesK = new Set((engines || []).map((x) => norm(x).toLowerCase()).filter(Boolean));
  const variantsK = new Set((variants || []).map((x) => norm(x).toLowerCase()).filter(Boolean));
  const from = new Set<string>();
  const to = new Set<string>();
  for (const v of rows) {
    if (enginesK.size && !enginesK.has(norm(v.engineName).toLowerCase())) continue;
    if (variantsK.size && !variantsK.has(norm(v.variant).toLowerCase())) continue;
    const yf = norm(v.yearFrom);
    const yt = norm(v.yearTo);
    if (yf) from.add(yf);
    if (yt) to.add(yt);
  }
  return {
    yearFrom: Array.from(from).sort(),
    yearTo: Array.from(to).sort(),
  };
}

export function filterRows(params: {
  rows: VehicleIndexRow[];
  engines: string[];
  variants: string[];
  yearFrom: string;
  yearTo: string;
}) {
  const enginesK = new Set((params.engines || []).map((x) => norm(x).toLowerCase()).filter(Boolean));
  const variantsK = new Set((params.variants || []).map((x) => norm(x).toLowerCase()).filter(Boolean));
  const yFrom = norm(params.yearFrom);
  const yTo = norm(params.yearTo);

  return params.rows.filter((v) => {
    if (enginesK.size && !enginesK.has(norm(v.engineName).toLowerCase())) return false;
    if (variantsK.size && !variantsK.has(norm(v.variant).toLowerCase())) return false;
    if (yFrom && norm(v.yearFrom) !== yFrom) return false;
    if (yTo && norm(v.yearTo) !== yTo) return false;
    return true;
  });
}
