import { getSupabaseAdmin } from "../supabase.server.ts";
import type { VehicleIndexRow } from "./vehicleIndexQuery.ts";

export type VehicleIndexCache = {
  builtAt: number;
  count: number;
  vehicles: VehicleIndexRow[];
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
  };
}

const supabaseStore: DurableVehicleIndexStore = {
  async load(shopDomain: string) {
    const shop = normShop(shopDomain);
    if (!shop) return null;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("vehicle_index_cache")
      .select("built_at, vehicle_count, vehicles_json")
      .eq("shop_domain", shop)
      .maybeSingle();
    if (error) throw error;
    return parseCache(data);
  },
  async save(shopDomain: string, cache: VehicleIndexCache) {
    const shop = normShop(shopDomain);
    if (!shop) throw new Error("Missing shop_domain");
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("vehicle_index_cache").upsert(
      {
        shop_domain: shop,
        built_at: new Date(cache.builtAt || Date.now()).toISOString(),
        vehicle_count: cache.vehicles.length,
        vehicles_json: cache.vehicles,
      },
      { onConflict: "shop_domain" },
    );
    if (error) throw error;
  },
};

let overrideStore: DurableVehicleIndexStore | null = null;

export function setDurableVehicleIndexStoreForTests(store: DurableVehicleIndexStore | null) {
  overrideStore = store;
}

export function getDurableVehicleIndexStore(): DurableVehicleIndexStore {
  return overrideStore || supabaseStore;
}
