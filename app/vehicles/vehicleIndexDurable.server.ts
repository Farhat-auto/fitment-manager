import { getSupabaseAdmin } from "../supabase.server.ts";
import {
  VEHICLE_INDEX_SCHEMA_VERSION,
  type VehicleIndexRow,
} from "./vehicleIndexQuery.ts";

export type VehicleIndexCache = {
  builtAt: number;
  count: number;
  vehicles: VehicleIndexRow[];
  complete: boolean;
  pageCount: number;
  hasNextPage: boolean;
  schemaVersion: string;
  lastError?: string;
};

export type DurableVehicleIndexStore = {
  load(shopDomain: string): Promise<VehicleIndexCache | null>;
  save(shopDomain: string, cache: VehicleIndexCache): Promise<void>;
};

function normShop(shopDomain: string): string {
  return String(shopDomain || "").trim().toLowerCase();
}

function parseCache(row: any): VehicleIndexCache | null {
  const vehicles = Array.isArray(row?.vehicles_json) ? row.vehicles_json : [];
  if (!vehicles.length) return null;
  const builtAt = Date.parse(String(row?.built_at ?? "")) || Number(row?.built_at ?? 0) || Date.now();
  return {
    builtAt,
    count: vehicles.length,
    vehicles,
    complete: row?.complete === true,
    pageCount: Number(row?.page_count ?? 0),
    hasNextPage: row?.source_has_next_page === true,
    schemaVersion: String(row?.schema_version || VEHICLE_INDEX_SCHEMA_VERSION),
    lastError: typeof row?.last_error === "string" ? row.last_error : undefined,
  };
}

const supabaseStore: DurableVehicleIndexStore = {
  async load(shopDomain: string) {
    const shop = normShop(shopDomain);
    if (!shop) return null;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("vehicle_index_cache")
      .select("built_at, vehicle_count, vehicles_json, complete, page_count, source_has_next_page, schema_version, last_error")
      .eq("shop_domain", shop)
      .maybeSingle();
    if (error) {
      const fallback = await supabase
        .from("vehicle_index_cache")
        .select("built_at, vehicle_count, vehicles_json")
        .eq("shop_domain", shop)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      return parseCache(fallback.data);
    }
    return parseCache(data);
  },
  async save(shopDomain: string, cache: VehicleIndexCache) {
    const shop = normShop(shopDomain);
    if (!shop) throw new Error("Missing shop_domain");
    const supabase = getSupabaseAdmin();
    const payload = {
      shop_domain: shop,
      built_at: new Date(cache.builtAt || Date.now()).toISOString(),
      vehicle_count: cache.vehicles.length,
      vehicles_json: cache.vehicles,
      complete: cache.complete === true,
      page_count: cache.pageCount || 0,
      source_has_next_page: cache.hasNextPage === true,
      schema_version: cache.schemaVersion || VEHICLE_INDEX_SCHEMA_VERSION,
      last_error: cache.lastError || null,
    };
    const { error } = await supabase.from("vehicle_index_cache").upsert(payload, { onConflict: "shop_domain" });
    if (!error) return;
    const msg = String((error as any)?.message || (error as any)?.details || "");
    if (!/complete|page_count|schema_version|source_has_next|last_error|column/i.test(msg)) throw error;
    const fallback = await supabase.from("vehicle_index_cache").upsert(
      {
        shop_domain: shop,
        built_at: payload.built_at,
        vehicle_count: payload.vehicle_count,
        vehicles_json: payload.vehicles_json,
      },
      { onConflict: "shop_domain" },
    );
    if (fallback.error) throw fallback.error;
  },
};

let overrideStore: DurableVehicleIndexStore | null = null;

export function setDurableVehicleIndexStoreForTests(store: DurableVehicleIndexStore | null) {
  overrideStore = store;
}

export function getDurableVehicleIndexStore(): DurableVehicleIndexStore {
  return overrideStore || supabaseStore;
}
