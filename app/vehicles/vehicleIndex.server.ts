import {
  VEHICLE_INDEX_SCHEMA_VERSION,
  indexSummaryFromCache,
  listGenerationsFromRows,
  listMakesFromRows,
  listModelsFromRows,
  vehiclesForMakeModelFromRows,
  vehiclesForMakeModelGenerationFromRows,
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

export type VehicleIndexBuildResult = {
  cache: VehicleIndexCache;
  complete: boolean;
  throttled: boolean;
  pageCount: number;
  hasNextPage: boolean;
  error?: string;
};

/** Shopify connections allow up to 250. The complete 3792-vehicle walk used this size. */
const PAGE_SIZE = 250;
/** Circuit breaker only. A hit marks the walk incomplete and must not save. */
const MAX_PAGES_CIRCUIT_BREAKER = 200;
const SCHEMA_VERSION = VEHICLE_INDEX_SCHEMA_VERSION;

function norm(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

const LIST_VEHICLES_FOR_INDEX = `#graphql
  query ListVehiclesForIndex($first: Int! = 250, $after: String) {
    metaobjects(type: "vehicle", first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        vehicle_key: field(key: "vehicle_key") { value }
        display_name: field(key: "display_name") { value }
        body_type: field(key: "body_type") { value }
        series: field(key: "series") {
          value
          reference { ... on Metaobject { displayName handle name: field(key: "name") { value } } }
        }
        generation: field(key: "generation") {
          value
          reference { ... on Metaobject { displayName handle name: field(key: "name") { value } } }
        }
        chassis: field(key: "chassis") {
          value
          reference { ... on Metaobject { displayName handle name: field(key: "name") { value } } }
        }
        make: field(key: "make") {
          value
          reference { ... on Metaobject { displayName handle name: field(key: "name") { value } display_name: field(key: "display_name") { value } } }
        }
        model: field(key: "model") {
          value
          reference { ... on Metaobject { displayName handle name: field(key: "name") { value } display_name: field(key: "display_name") { value } } }
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
        power_hp: field(key: "power_hp") { value }
        power_kw: field(key: "power_kw") { value }
      }
    }
  }
`;

function optLabel(field: any): string {
  const candidates = [
    norm(field?.reference?.displayName),
    norm(field?.reference?.name?.value),
    norm(field?.reference?.display_name?.value),
    norm(field?.reference?.handle),
    norm(field?.value),
  ];
  return candidates.find((c) => c && !c.toLowerCase().startsWith("gid://")) || "";
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

function mapNode(n: any): VehicleIndexRow | null {
  const gid = norm(n?.id);
  if (!gid) return null;
  const engineCode = optLabel(n?.engine_code);
  const engineName = optLabel(n?.engine) || engineCode;
  const powerHp = norm(n?.power_hp?.value);
  const powerKw = norm(n?.power_kw?.value);
  const power = powerHp ? `${powerHp} hp` : powerKw ? `${powerKw} kW` : "";
  return {
    gid,
    handle: norm(n?.handle),
    vehicleKey: norm(n?.vehicle_key?.value),
    displayName: norm(n?.display_name?.value),
    makeName: optLabel(n?.make),
    modelName: optLabel(n?.model),
    generationName: optLabel(n?.generation),
    series: optLabel(n?.series),
    chassis: optLabel(n?.chassis),
    engineName,
    engineCode,
    variant: optLabel(n?.variant),
    yearFrom: norm(n?.year_from?.value),
    yearTo: norm(n?.year_to?.value),
    bodyType: norm(n?.body_type?.value),
    power,
  };
}

async function loadDurable(shopDomain: string): Promise<VehicleIndexCache | null> {
  try {
    return await getDurableVehicleIndexStore().load(shopDomain);
  } catch {
    return null;
  }
}

/**
 * Walk Shopify vehicle metaobjects until hasNextPage=false.
 * Does not write public.vehicle_index_cache. Refresh must validate then replace atomically.
 * Cache miss / GET must not call this.
 */
export async function buildVehicleIndex(params: {
  admin: ShopifyAdmin;
  shopDomain: string;
}): Promise<VehicleIndexBuildResult> {
  const vehicles: VehicleIndexRow[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  let hasNext = true;
  let pageCount = 0;
  let pageSize = PAGE_SIZE;
  let throttled = false;
  let error: string | undefined;

  while (hasNext && pageCount < MAX_PAGES_CIRCUIT_BREAKER) {
    let resp: Response;
    try {
      resp = await graphqlWithBackoff(params.admin, LIST_VEHICLES_FOR_INDEX, { first: pageSize, after });
    } catch (e: any) {
      throttled = String(e?.message ?? "").toLowerCase().includes("throttl") || String(e?.message ?? "").includes("429");
      error = String(e?.message ?? "Shopify vehicle listing failed");
      break;
    }
    pageCount += 1;
    const data = await resp.json();
    const gqlErrors = data?.errors;
    const errText = JSON.stringify(gqlErrors || "");
    const errLower = errText.toLowerCase();
    if (errLower.includes("throttled")) {
      throttled = true;
      error = "Shopify Admin API throttled this request.";
      break;
    }
    if (errLower.includes("max_cost") || errLower.includes("max query cost") || errLower.includes("cost exceeded")) {
      if (pageSize > 25) {
        pageSize = Math.max(25, Math.floor(pageSize / 2));
        pageCount -= 1;
        continue;
      }
      error = "Shopify rejected the vehicle listing query as too expensive.";
      break;
    }
    if (Array.isArray(gqlErrors) && gqlErrors.length) {
      error = String(gqlErrors[0]?.message || "Shopify vehicle listing GraphQL error");
      break;
    }
    const conn = data?.data?.metaobjects;
    if (!conn) {
      error = "Shopify vehicle listing returned no metaobjects connection.";
      break;
    }
    const nodes: any[] = Array.isArray(conn?.nodes) ? conn.nodes : [];
    for (const n of nodes) {
      const row = mapNode(n);
      if (!row || seen.has(row.gid)) continue;
      seen.add(row.gid);
      vehicles.push(row);
    }
    hasNext = !!conn?.pageInfo?.hasNextPage;
    after = typeof conn?.pageInfo?.endCursor === "string" ? conn.pageInfo.endCursor : null;
    if (!after) hasNext = false;
    if (hasNext) await sleep(50);
  }

  const hitCircuitBreaker = hasNext && pageCount >= MAX_PAGES_CIRCUIT_BREAKER;
  if (hitCircuitBreaker) {
    error = error || `Vehicle listing stopped at the ${MAX_PAGES_CIRCUIT_BREAKER}-page circuit breaker.`;
  }
  const complete = !throttled && !hasNext && !error && vehicles.length > 0;
  const cache: VehicleIndexCache = {
    builtAt: Date.now(),
    count: vehicles.length,
    vehicles,
    complete,
    pageCount,
    hasNextPage: hasNext,
    schemaVersion: SCHEMA_VERSION,
    lastError: error,
  };
  return { cache, complete, throttled, pageCount, hasNextPage: hasNext, error };
}

/**
 * Explicit Refresh Vehicle Index. Builds a candidate, then replaces the durable
 * snapshot only when pagination completed. A throttled/partial walk keeps the
 * previous complete index.
 */
export async function refreshVehicleIndex(params: {
  admin: ShopifyAdmin;
  shopDomain: string;
}): Promise<{
  ok: boolean;
  cache: VehicleIndexCache | null;
  keptPrevious: boolean;
  error?: string;
}> {
  const previous = await loadDurable(params.shopDomain);
  let built: VehicleIndexBuildResult;
  try {
    built = await buildVehicleIndex(params);
  } catch (e: any) {
    return {
      ok: false,
      cache: previous,
      keptPrevious: !!(previous?.vehicles && previous.vehicles.length),
      error: String(e?.message ?? "Vehicle index refresh failed"),
    };
  }
  if (!built.complete) {
    return {
      ok: false,
      cache: previous,
      keptPrevious: !!(previous?.vehicles && previous.vehicles.length),
      error:
        built.error ||
        (built.throttled
          ? "Shopify throttled the vehicle listing. The previous complete index was kept."
          : "Vehicle index refresh was incomplete and was not saved."),
    };
  }
  await getDurableVehicleIndexStore().save(params.shopDomain, built.cache);
  return { ok: true, cache: built.cache, keptPrevious: false };
}

/**
 * Loader GET and POST actions must read the SAME durable vehicle-index state.
 * Cache miss: do not list the whole Shopify vehicle catalogue on a product GET.
 */
export async function getVehicleIndex(params: {
  admin: ShopifyAdmin;
  shopDomain: string;
  refresh?: boolean;
}): Promise<VehicleIndexCache | null> {
  if (!params.refresh) {
    return loadDurable(params.shopDomain);
  }
  const result = await refreshVehicleIndex(params);
  return result.cache;
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

export function listGenerations(cache: VehicleIndexCache, make: string, model: string): string[] {
  return listGenerationsFromRows(cache.vehicles, make, model);
}

export function vehiclesForMakeModel(cache: VehicleIndexCache, make: string, model: string): VehicleIndexRow[] {
  return vehiclesForMakeModelFromRows(cache.vehicles, make, model);
}

export function vehiclesForMakeModelGeneration(
  cache: VehicleIndexCache,
  make: string,
  model: string,
  generation: string,
): VehicleIndexRow[] {
  return vehiclesForMakeModelGenerationFromRows(cache.vehicles, make, model, generation);
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
