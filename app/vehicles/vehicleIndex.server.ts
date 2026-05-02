import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Return value of `authenticate.admin(request).admin` — GraphQL admin client. */
export type ShopifyAdmin = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

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

type VehicleIndexCache = {
  builtAt: number;
  count: number;
  vehicles: VehicleIndexRow[];
};

const memCache = new Map<string, VehicleIndexCache>();

function norm(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normKey(v: unknown): string {
  return norm(v).toLowerCase();
}

function cacheKey(shopDomain: string): string {
  return normKey(shopDomain || "");
}

async function ensureCacheDir(): Promise<string> {
  const dir = path.join(process.cwd(), ".cache");
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
  return dir;
}

async function readDiskCache(shopDomain: string): Promise<VehicleIndexCache | null> {
  const dir = await ensureCacheDir();
  const fp = path.join(dir, `vehicle-index.${cacheKey(shopDomain)}.json`);
  try {
    const raw = await fs.readFile(fp, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const builtAt = Number((parsed as any).builtAt ?? 0);
    const vehicles = Array.isArray((parsed as any).vehicles) ? (parsed as any).vehicles : [];
    const count = Number((parsed as any).count ?? vehicles.length);
    if (!builtAt || !Array.isArray(vehicles)) return null;
    return { builtAt, count, vehicles } as VehicleIndexCache;
  } catch {
    return null;
  }
}

async function writeDiskCache(shopDomain: string, cache: VehicleIndexCache): Promise<void> {
  const dir = await ensureCacheDir();
  const fp = path.join(dir, `vehicle-index.${cacheKey(shopDomain)}.json`);
  try {
    await fs.writeFile(fp, JSON.stringify(cache), "utf8");
  } catch {
    // ignore
  }
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

export async function buildVehicleIndex(params: {
  admin: ShopifyAdmin;
  shopDomain: string;
}): Promise<VehicleIndexCache> {
  const vehicles: VehicleIndexRow[] = [];
  let after: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const resp = await graphqlWithBackoff(params.admin, LIST_VEHICLES_FOR_INDEX, { first: 250, after });
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

  memCache.set(cacheKey(params.shopDomain), cache);
  await writeDiskCache(params.shopDomain, cache);
  return cache;
}

export async function getVehicleIndex(params: {
  admin: ShopifyAdmin;
  shopDomain: string;
  refresh?: boolean;
}): Promise<VehicleIndexCache | null> {
  const key = cacheKey(params.shopDomain);
  if (!params.refresh) {
    const mem = memCache.get(key);
    if (mem?.vehicles?.length) return mem;
    const disk = await readDiskCache(params.shopDomain);
    if (disk?.vehicles?.length) {
      memCache.set(key, disk);
      return disk;
    }
  }
  try {
    return await buildVehicleIndex({ admin: params.admin, shopDomain: params.shopDomain });
  } catch {
    const mem = memCache.get(key);
    return mem?.vehicles?.length ? mem : null;
  }
}

export function indexSummary(cache: VehicleIndexCache | null) {
  return cache
    ? { builtAt: cache.builtAt, count: cache.count }
    : { builtAt: 0, count: 0 };
}

export function listMakes(cache: VehicleIndexCache): string[] {
  const seen = new Set<string>();
  for (const v of cache.vehicles) {
    const m = norm(v.makeName);
    if (m) seen.add(m);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function listModels(cache: VehicleIndexCache, make: string): string[] {
  const makeK = normKey(make);
  const seen = new Set<string>();
  for (const v of cache.vehicles) {
    if (normKey(v.makeName) !== makeK) continue;
    const m = norm(v.modelName);
    if (m) seen.add(m);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function vehiclesForMakeModel(cache: VehicleIndexCache, make: string, model: string): VehicleIndexRow[] {
  const makeK = normKey(make);
  const modelK = normKey(model);
  return cache.vehicles.filter((v) => normKey(v.makeName) === makeK && normKey(v.modelName) === modelK);
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
  const enginesK = new Set((engines || []).map(normKey).filter(Boolean));
  const seen = new Set<string>();
  for (const v of rows) {
    if (enginesK.size && !enginesK.has(normKey(v.engineName))) continue;
    const vv = norm(v.variant);
    if (vv) seen.add(vv);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function facetYears(rows: VehicleIndexRow[], engines: string[], variants: string[]) {
  const enginesK = new Set((engines || []).map(normKey).filter(Boolean));
  const variantsK = new Set((variants || []).map(normKey).filter(Boolean));
  const from = new Set<string>();
  const to = new Set<string>();
  for (const v of rows) {
    if (enginesK.size && !enginesK.has(normKey(v.engineName))) continue;
    if (variantsK.size && !variantsK.has(normKey(v.variant))) continue;
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
  const enginesK = new Set((params.engines || []).map(normKey).filter(Boolean));
  const variantsK = new Set((params.variants || []).map(normKey).filter(Boolean));
  const yFrom = norm(params.yearFrom);
  const yTo = norm(params.yearTo);

  return params.rows.filter((v) => {
    if (enginesK.size && !enginesK.has(normKey(v.engineName))) return false;
    if (variantsK.size && !variantsK.has(normKey(v.variant))) return false;
    if (yFrom && norm(v.yearFrom) !== yFrom) return false;
    if (yTo && norm(v.yearTo) !== yTo) return false;
    return true;
  });
}

