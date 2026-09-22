import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFitmentRouteData } from "../app/fitment/fitmentRouteLoad.server.ts";
import { setDurableCatalogIndexStoreForTests, type CatalogIndexCache } from "../app/utils/catalogIndex.server.ts";
import {
  getVehicleIndex,
  indexSummary,
  listMakes,
  listModels,
  vehiclesForMakeModel,
} from "../app/vehicles/vehicleIndex.server.ts";
import {
  setDurableVehicleIndexStoreForTests,
  type DurableVehicleIndexStore,
  type VehicleIndexCache,
} from "../app/vehicles/vehicleIndexDurable.server.ts";
import type { VehicleIndexRow } from "../app/vehicles/vehicleIndexQuery.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

let failed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log("PASS", name);
    })
    .catch((error) => {
      failed += 1;
      console.error("FAIL", name, error);
    });
}

function memoryStore(): DurableVehicleIndexStore & { map: Map<string, VehicleIndexCache> } {
  const map = new Map<string, VehicleIndexCache>();
  return {
    map,
    async load(shopDomain: string) {
      return map.get(String(shopDomain || "").trim().toLowerCase()) ?? null;
    },
    async save(shopDomain: string, cache: VehicleIndexCache) {
      map.set(String(shopDomain || "").trim().toLowerCase(), cache);
    },
  };
}

function row(i: number, make = "Mercedes-Benz", model = "C-Class"): VehicleIndexRow {
  return {
    gid: `gid://shopify/Metaobject/${i}`,
    handle: `veh-${i}`,
    vehicleKey: `ocean-veh-${i}`,
    displayName: `${make} ${model} ${i}`,
    makeName: make,
    modelName: model,
    engineName: i % 2 ? "M274" : "N54",
    variant: "",
    yearFrom: "2014",
    yearTo: "2021",
    bodyType: "",
  };
}

const PRODUCT = {
  id: "gid://shopify/Product/111",
  title: "HI-BRIT-HB-00294-Electric Water pump M274 W205 2742000207",
  handle: "hi-brit-hb-00294-electric-water-pump-m274-w205-2742000207",
  variants: { nodes: [{ id: "gid://shopify/ProductVariant/222", sku: "HB-00294" }] },
  brand: { value: "Hi-Brit" },
  mpn: { value: "HB-00294" },
  category: {
    value: "gid://shopify/Metaobject/cooling-system",
    reference: {
      id: "gid://shopify/Metaobject/cooling-system",
      handle: "cooling-system",
      displayName: "Cooling System",
    },
  },
  systemGroup: { value: "", reference: null },
  subcategory: { value: "", reference: null },
  fitmentVehicles: { references: { nodes: [] } },
};

function okResponse(data: unknown) {
  return {
    status: 200,
    headers: { get: () => null },
    json: async () => ({ data }),
  };
}

const SHOP = "g5uxzq-gb.myshopify.com";

await check("process memory and .cache disk are not the vehicle-index source of truth", () => {
  const vi = source("app/vehicles/vehicleIndex.server.ts");
  assert.doesNotMatch(vi, /memCache/);
  assert.doesNotMatch(vi, /writeDiskCache/);
  assert.doesNotMatch(vi, /readDiskCache/);
  assert.match(vi, /vehicle_index_cache/);
  assert.match(vi, /getDurableVehicleIndexStore/);
  const durable = source("app/vehicles/vehicleIndexDurable.server.ts");
  assert.match(durable, /from\("vehicle_index_cache"\)/);
  const migration = source("supabase/migrations/20260922_0005_vehicle_and_catalog_index_cache.sql");
  assert.match(migration, /create table if not exists public.vehicle_index_cache/);
  assert.match(migration, /create table if not exists public.catalog_index_cache/);
  assert.match(migration, /NOT Ocean/);
  assert.match(migration, /fitment authority/);
});

await check("cold-start regression: two serverless reads share 3792 durable vehicles with zero GraphQL", async () => {
  const store = memoryStore();
  setDurableVehicleIndexStoreForTests(store);
  const vehicles = Array.from({ length: 3792 }, (_, i) => row(i + 1));
  await store.save(SHOP, { builtAt: 1_700_000_000_000, count: 3792, vehicles });

  let graphqlCalls = 0;
  const admin = {
    graphql: async () => {
      graphqlCalls += 1;
      throw new Error("durable read must not hit Shopify");
    },
  };

  const instanceA = await getVehicleIndex({ admin, shopDomain: SHOP, refresh: false });
  const instanceB = await getVehicleIndex({ admin, shopDomain: "G5UXZQ-GB.myshopify.com", refresh: false });
  assert.equal(graphqlCalls, 0);
  assert.equal(instanceA?.vehicles.length, 3792);
  assert.equal(instanceB?.vehicles.length, 3792);
  assert.equal(indexSummary(instanceA).ready, true);
  assert.equal(indexSummary(instanceA).count, 3792);
  assert.equal(indexSummary(instanceB).ready, true);
  setDurableVehicleIndexStoreForTests(null);
});

await check("index_makes is 409 only when durable store is empty, never because of a cold instance", async () => {
  const store = memoryStore();
  setDurableVehicleIndexStoreForTests(store);
  const admin = { graphql: async () => { throw new Error("no shopify"); } };

  const empty = await getVehicleIndex({ admin, shopDomain: SHOP, refresh: false });
  assert.equal(empty, null);
  const needsRefreshEmpty = !empty?.vehicles?.length;
  assert.equal(needsRefreshEmpty, true);

  await store.save(SHOP, {
    builtAt: Date.now(),
    count: 3792,
    vehicles: Array.from({ length: 3792 }, (_, i) => row(i + 1)),
  });
  const built = await getVehicleIndex({ admin, shopDomain: SHOP, refresh: false });
  assert.equal(built?.vehicles.length, 3792);
  assert.equal(!built?.vehicles?.length, false);
  setDurableVehicleIndexStoreForTests(null);
});

await check("Make → Model → Vehicle reads the durable Ocean-preserving vehicle rows", async () => {
  const store = memoryStore();
  setDurableVehicleIndexStoreForTests(store);
  const vehicles = [
    row(1, "BMW", "3 Series"),
    row(2, "Mercedes-Benz", "C-Class"),
    row(3, "Mercedes-Benz", "C-Class"),
  ];
  vehicles[1].vehicleKey = "mercedes-w205-m274";
  vehicles[2].vehicleKey = "mercedes-w205-m274-b";
  await store.save(SHOP, { builtAt: 1, count: 3, vehicles });
  const idx = await getVehicleIndex({
    admin: { graphql: async () => { throw new Error("no shopify"); } },
    shopDomain: SHOP,
    refresh: false,
  });
  assert.ok(idx);
  assert.deepEqual(listMakes(idx!), ["BMW", "Mercedes-Benz"]);
  assert.deepEqual(listModels(idx!, "Mercedes-Benz"), ["C-Class"]);
  const rows = vehiclesForMakeModel(idx!, "Mercedes-Benz", "C-Class");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].vehicleKey, "mercedes-w205-m274");
  assert.equal(rows[0].gid, "gid://shopify/Metaobject/2");
  setDurableVehicleIndexStoreForTests(null);
});

await check("product GET reads durable index and does not rebuild Shopify vehicles", async () => {
  const store = memoryStore();
  setDurableVehicleIndexStoreForTests(store);
  await store.save(SHOP, {
    builtAt: 1,
    count: 3792,
    vehicles: Array.from({ length: 3792 }, (_, i) => row(i + 1)),
  });
  const catalog: CatalogIndexCache = {
    builtAt: 1,
    categories: [
      { value: "gid://shopify/Metaobject/cooling-system", label: "Cooling System", handle: "cooling-system" },
    ],
    systemGroups: [
      {
        value: "gid://shopify/Metaobject/water-pumps",
        label: "Water Pumps",
        handle: "water-pumps",
        parentCategoryId: "gid://shopify/Metaobject/cooling-system",
        parentCategoryHandle: "cooling-system",
        parentCategoryLabel: "Cooling System",
      },
    ],
    subcategories: [],
    parentFieldProbe: [{ key: "parent_category", representation: "reference.id", hasReference: true }],
  };
  setDurableCatalogIndexStoreForTests({
    async load() {
      return catalog;
    },
    async save() {},
  });

  const queries: string[] = [];
  const admin = {
    graphql: async (query: string) => {
      queries.push(query);
      if (query.includes("GetProductForFitmentPage")) return okResponse({ productByHandle: PRODUCT });
      throw new Error(`unexpected graphql: ${query.slice(0, 80)}`);
    },
  };
  const loaded = await loadFitmentRouteData({
    admin,
    shopDomain: SHOP,
    productHandle: PRODUCT.handle,
    maxRetries: 0,
    sleepFn: async () => {},
  });
  assert.equal(loaded.notFound, false);
  if (loaded.notFound) return;
  assert.equal(loaded.payload.vehicleIndex.ready, true);
  assert.equal(loaded.payload.vehicleIndex.count, 3792);
  assert.ok(loaded.payload.makes.includes("Mercedes-Benz"));
  assert.deepEqual(loaded.payload.indexVehicles, []);
  assert.equal(loaded.payload.classification.category.label, "Cooling System");
  assert.equal(loaded.payload.classification.category.handle, "cooling-system");
  assert.equal(
    queries.some((q) => q.includes("ListVehiclesForIndex")),
    false,
  );
  assert.equal(queries.length, 1);
  setDurableVehicleIndexStoreForTests(null);
  setDurableCatalogIndexStoreForTests(null);
});

await check("GET cache miss does not list the Shopify vehicle catalogue", async () => {
  setDurableVehicleIndexStoreForTests({
    async load() {
      return null;
    },
    async save() {},
  });
  let graphqlCalls = 0;
  const idx = await getVehicleIndex({
    admin: {
      graphql: async () => {
        graphqlCalls += 1;
        throw new Error("no");
      },
    },
    shopDomain: "empty.myshopify.com",
    refresh: false,
  });
  assert.equal(idx, null);
  assert.equal(graphqlCalls, 0);
  assert.equal(indexSummary(idx).ready, false);
  setDurableVehicleIndexStoreForTests(null);
});

await check("identity is preserved on durable rows and title is never used as identity", () => {
  const load = source("app/fitment/fitmentRouteLoad.server.ts");
  assert.match(load, /Shopify product ID → variant ID → SKU → Brand\+MPN/);
  assert.match(load, /Title is never identity/);
  const vi = source("app/vehicles/vehicleIndex.server.ts");
  assert.match(vi, /vehicleKey/);
  assert.doesNotMatch(vi, /title as identity/);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll durable vehicle-index tests passed");
