import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFitmentRouteData } from "../app/fitment/fitmentRouteLoad.server.ts";
import { setDurableCatalogIndexStoreForTests } from "../app/utils/catalogIndex.server.ts";
import {
  buildVehicleIndex,
  getVehicleIndex,
  refreshVehicleIndex,
} from "../app/vehicles/vehicleIndex.server.ts";
import {
  setDurableVehicleIndexStoreForTests,
  type DurableVehicleIndexStore,
  type VehicleIndexCache,
} from "../app/vehicles/vehicleIndexDurable.server.ts";
import {
  countsByMakeFromRows,
  engineLabelFromRow,
  listGenerationsFromRows,
  listMakesFromRows,
  listModelsFromRows,
  vehiclesForMakeModelGenerationFromRows,
  type VehicleIndexRow,
} from "../app/vehicles/vehicleIndexQuery.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function source(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

let failed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log("PASS", name))
    .catch((error) => {
      failed += 1;
      console.error("FAIL", name, error);
    });
}

function memoryStore(): DurableVehicleIndexStore & { map: Map<string, VehicleIndexCache> } {
  const map = new Map<string, VehicleIndexCache>();
  return {
    map,
    async load(shop) {
      return map.get(String(shop || "").trim().toLowerCase()) ?? null;
    },
    async save(shop, cache) {
      map.set(String(shop || "").trim().toLowerCase(), cache);
    },
  };
}

function row(partial: Partial<VehicleIndexRow> & { gid: string; makeName: string; modelName: string; vehicleKey: string }): VehicleIndexRow {
  return {
    handle: partial.handle || partial.vehicleKey,
    displayName: partial.displayName || `${partial.makeName} ${partial.modelName}`,
    generationName: partial.generationName || "",
    series: partial.series || "",
    chassis: partial.chassis || "",
    engineName: partial.engineName || "",
    engineCode: partial.engineCode || partial.engineName || "",
    variant: partial.variant || "",
    yearFrom: partial.yearFrom || "",
    yearTo: partial.yearTo || "",
    bodyType: partial.bodyType || "",
    power: partial.power || "",
    ...partial,
  };
}

function completeCache(vehicles: VehicleIndexRow[]): VehicleIndexCache {
  return {
    builtAt: 1,
    count: vehicles.length,
    vehicles,
    complete: true,
    pageCount: Math.ceil(vehicles.length / 50) || 1,
    hasNextPage: false,
    schemaVersion: "vehicle-index-v2",
  };
}

const MAKES = ["BMW", "Mercedes-Benz", "Audi", "Volkswagen", "Land Rover", "Jaguar", "Ford", "Toyota"];

function catalogue(count = 1205): VehicleIndexRow[] {
  const out: VehicleIndexRow[] = [];
  for (let i = 0; i < count; i++) {
    const make = MAKES[i % MAKES.length];
    const model = i % 3 === 0 ? "C-Class" : i % 3 === 1 ? "3 Series" : "Golf";
    const gen = i % 2 === 0 ? "W205" : "W206";
    const engine = i % 2 === 0 ? "M274" : "OM654";
    out.push(
      row({
        gid: `gid://shopify/Metaobject/${i + 1}`,
        vehicleKey: `ocean-${make.toLowerCase()}-${i + 1}`,
        makeName: make,
        modelName: model,
        generationName: gen,
        chassis: gen,
        engineName: engine,
        engineCode: engine,
        yearFrom: i % 2 === 0 ? "2014" : "2021",
        yearTo: i % 2 === 0 ? "2021" : "2024",
        power: i % 2 === 0 ? "184 hp" : "194 hp",
      }),
    );
  }
  return out;
}

function gqlVehicle(n: VehicleIndexRow) {
  return {
    id: n.gid,
    handle: n.handle,
    vehicle_key: { value: n.vehicleKey },
    display_name: { value: n.displayName },
    body_type: { value: n.bodyType },
    series: { value: n.series },
    generation: { value: n.generationName },
    chassis: { value: n.chassis },
    make: { value: n.makeName },
    model: { value: n.modelName },
    year_from: { value: n.yearFrom },
    year_to: { value: n.yearTo },
    engine_code: { value: n.engineCode },
    engine: { value: n.engineName },
    variant: { value: n.variant },
    power_hp: { value: n.power.replace(" hp", "") },
    power_kw: { value: "" },
  };
}

function pagingAdmin(all: VehicleIndexRow[], pageSize = 50, throttleAfterPage?: number) {
  let calls = 0;
  return {
    calls: () => calls,
    graphql: async (_q: string, opts?: { variables?: Record<string, unknown> }) => {
      calls += 1;
      if (throttleAfterPage && calls > throttleAfterPage) {
        const err: any = new Error("Throttled");
        err.body = { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] };
        throw err;
      }
      const after = typeof opts?.variables?.after === "string" ? Number(opts.variables.after) : 0;
      const start = after;
      const nodes = all.slice(start, start + pageSize).map(gqlVehicle);
      const end = start + nodes.length;
      const hasNextPage = end < all.length;
      return {
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          data: {
            metaobjects: {
              pageInfo: { hasNextPage, endCursor: hasNextPage ? String(end) : null },
              nodes,
            },
          },
        }),
      };
    },
  };
}

const SHOP = "g5uxzq-gb.myshopify.com";

await check("indexer does not hard-stop at 1000 = 40*25", () => {
  const vi = source("app/vehicles/vehicleIndex.server.ts");
  assert.doesNotMatch(vi, /const maxPages = 40/);
  assert.doesNotMatch(vi, /const pageSize = 25/);
  assert.match(vi, /PAGE_SIZE = 250/);
  assert.match(vi, /MAX_PAGES_CIRCUIT_BREAKER/);
  assert.match(vi, /hasNextPage=false|hasNext = !!conn/);
  assert.match(vi, /refreshVehicleIndex/);
});

await check(">1000 vehicle records are not truncated", async () => {
  const store = memoryStore();
  setDurableVehicleIndexStoreForTests(store);
  const all = catalogue(1205);
  const admin = pagingAdmin(all, 50);
  const built = await buildVehicleIndex({ admin, shopDomain: SHOP });
  assert.equal(built.complete, true);
  assert.equal(built.hasNextPage, false);
  assert.equal(built.cache.vehicles.length, 1205);
  assert.ok(built.pageCount > 20);
  assert.equal(admin.calls(), built.pageCount);
  setDurableVehicleIndexStoreForTests(null);
});

await check("pagination continues until hasNextPage is false", async () => {
  const all = catalogue(175);
  const admin = pagingAdmin(all, 50);
  const built = await buildVehicleIndex({ admin, shopDomain: SHOP });
  assert.equal(built.pageCount, 4);
  assert.equal(built.complete, true);
  assert.equal(built.cache.vehicles[0].vehicleKey, "ocean-bmw-1");
  assert.equal(built.cache.vehicles[174].makeName, "Ford");
  assert.ok(built.cache.vehicles.some((v) => v.makeName === "BMW"));
  assert.ok(built.cache.vehicles.some((v) => v.makeName === "Mercedes-Benz"));
});

await check("incomplete/throttled refresh cannot replace the previous complete index", async () => {
  const store = memoryStore();
  setDurableVehicleIndexStoreForTests(store);
  const previous = completeCache(catalogue(3792));
  await store.save(SHOP, previous);
  const admin = pagingAdmin(catalogue(1200), 50, 2);
  const result = await refreshVehicleIndex({ admin, shopDomain: SHOP });
  assert.equal(result.ok, false);
  assert.equal(result.keptPrevious, true);
  assert.equal(store.map.get(SHOP)?.vehicles.length, 3792);
  assert.equal(store.map.get(SHOP)?.complete, true);
  setDurableVehicleIndexStoreForTests(null);
});

await check("multiple makes survive indexing", () => {
  const vehicles = catalogue(1205);
  const makes = listMakesFromRows(vehicles);
  for (const make of MAKES) assert.ok(makes.includes(make), `missing ${make}`);
  const counts = countsByMakeFromRows(vehicles);
  assert.ok(counts["BMW"] > 100);
  assert.ok(counts["Mercedes-Benz"] > 100);
  assert.ok(counts["Land Rover"] > 100);
});

await check("all models and distinct generations/engines survive", () => {
  const vehicles = [
    row({
      gid: "gid://shopify/Metaobject/w205-m274",
      vehicleKey: "mercedes-w205-m274",
      makeName: "Mercedes-Benz",
      modelName: "C-Class",
      generationName: "W205",
      chassis: "W205",
      engineName: "M274",
      yearFrom: "2014",
      yearTo: "2021",
    }),
    row({
      gid: "gid://shopify/Metaobject/w206-om654",
      vehicleKey: "mercedes-w206-om654",
      makeName: "Mercedes-Benz",
      modelName: "C-Class",
      generationName: "W206",
      chassis: "W206",
      engineName: "OM654",
      yearFrom: "2021",
      yearTo: "2024",
    }),
  ];
  assert.deepEqual(listModelsFromRows(vehicles, "Mercedes-Benz"), ["C-Class"]);
  const gens = listGenerationsFromRows(vehicles, "Mercedes-Benz", "C-Class");
  assert.deepEqual(gens, ["W205", "W206"]);
  const w205 = vehiclesForMakeModelGenerationFromRows(vehicles, "Mercedes-Benz", "C-Class", "W205");
  const w206 = vehiclesForMakeModelGenerationFromRows(vehicles, "Mercedes-Benz", "C-Class", "W206");
  assert.equal(w205.length, 1);
  assert.equal(w206.length, 1);
  assert.equal(w205[0].engineName, "M274");
  assert.equal(w206[0].engineName, "OM654");
  assert.equal(w205[0].vehicleKey, "mercedes-w205-m274");
  assert.notEqual(w205[0].gid, w206[0].gid);
  assert.match(engineLabelFromRow(w205[0]), /M274/);
});

await check("Make → Model → Generation → Engine preserves canonical vehicle identity", () => {
  const vehicles = catalogue(24);
  const makes = listMakesFromRows(vehicles);
  const make = "Mercedes-Benz";
  assert.ok(makes.includes(make));
  const models = listModelsFromRows(vehicles, make);
  assert.ok(models.length >= 1);
  const gens = listGenerationsFromRows(vehicles, make, models[0]);
  assert.ok(gens.length >= 1);
  const exact = vehiclesForMakeModelGenerationFromRows(vehicles, make, models[0], gens[0]);
  assert.ok(exact.length >= 1);
  assert.equal(vehiclesForMakeModelGenerationFromRows(vehicles, make, models[0], "").length, 0);
  for (const v of exact) {
    assert.match(v.gid, /^gid:\/\/shopify\/Metaobject\//);
    assert.match(v.vehicleKey, /^ocean-/);
    assert.equal(v.makeName, make);
  }
});

await check("cold instance reads the same durable index", async () => {
  const store = memoryStore();
  setDurableVehicleIndexStoreForTests(store);
  await store.save(SHOP, completeCache(catalogue(1205)));
  const a = await getVehicleIndex({
    admin: { graphql: async () => { throw new Error("no shopify"); } },
    shopDomain: SHOP,
    refresh: false,
  });
  const b = await getVehicleIndex({
    admin: { graphql: async () => { throw new Error("no shopify"); } },
    shopDomain: SHOP,
    refresh: false,
  });
  assert.equal(a?.vehicles.length, 1205);
  assert.equal(b?.vehicles.length, 1205);
  assert.equal(listMakesFromRows(a!.vehicles).length, MAKES.length);
  setDurableVehicleIndexStoreForTests(null);
});

await check("normal product GET does zero full-index rebuilds", async () => {
  setDurableVehicleIndexStoreForTests({
    async load() {
      return completeCache(catalogue(80));
    },
    async save() {
      throw new Error("GET must not write");
    },
  });
  setDurableCatalogIndexStoreForTests({
    async load() {
      return {
        builtAt: 1,
        categories: [{ value: "gid://shopify/Metaobject/cooling-system", label: "Cooling System", handle: "cooling-system" }],
        systemGroups: [],
        subcategories: [],
        parentFieldProbe: [],
      };
    },
    async save() {
      throw new Error("GET must not write catalog");
    },
  });
  const queries: string[] = [];
  const loaded = await loadFitmentRouteData({
    admin: {
      graphql: async (query: string) => {
        queries.push(query);
        if (query.includes("GetProductForFitmentPage")) {
          return {
            status: 200,
            headers: { get: () => null },
            json: async () => ({
              data: {
                productByHandle: {
                  id: "gid://shopify/Product/1",
                  title: "pump",
                  handle: "hi-brit-hb-00294-electric-water-pump-m274-w205-2742000207",
                  variants: { nodes: [{ id: "gid://shopify/ProductVariant/2", sku: "HB-00294" }] },
                  brand: { value: "Hi-Brit" },
                  mpn: { value: "HB-00294" },
                  category: { value: "", reference: null },
                  systemGroup: { value: "", reference: null },
                  subcategory: { value: "", reference: null },
                  fitmentVehicles: { references: { nodes: [] } },
                },
              },
            }),
          };
        }
        throw new Error(`unexpected ${query.slice(0, 60)}`);
      },
    },
    shopDomain: SHOP,
    productHandle: "hi-brit-hb-00294-electric-water-pump-m274-w205-2742000207",
    maxRetries: 0,
    sleepFn: async () => {},
  });
  assert.equal(loaded.notFound, false);
  if (!loaded.notFound) {
    assert.equal(loaded.payload.vehicleIndex.count, 80);
    assert.ok(loaded.payload.makes.includes("BMW"));
    assert.ok(loaded.payload.makes.includes("Mercedes-Benz"));
  }
  assert.equal(
    queries.some((q) => q.includes("ListVehiclesForIndex")),
    false,
  );
  assert.equal(queries.length, 1);
  setDurableVehicleIndexStoreForTests(null);
  setDurableCatalogIndexStoreForTests(null);
});

await check("Shopify THROTTLED refresh cannot HTTP 500 or replace the previous index", async () => {
  const store = memoryStore();
  setDurableVehicleIndexStoreForTests(store);
  await store.save(SHOP, completeCache(catalogue(3792)));
  const admin = pagingAdmin(catalogue(2000), 50, 1);
  let threw = false;
  let result: Awaited<ReturnType<typeof refreshVehicleIndex>> | null = null;
  try {
    result = await refreshVehicleIndex({ admin, shopDomain: SHOP });
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result?.ok, false);
  assert.equal(result?.keptPrevious, true);
  assert.equal(store.map.get(SHOP)?.vehicles.length, 3792);
  assert.match(String(result?.error || ""), /throttl/i);
  setDurableVehicleIndexStoreForTests(null);
});

await check("source still documents the 1000-row throttle regression", () => {
  const vi = source("app/vehicles/vehicleIndex.server.ts");
  assert.match(vi, /do not list the whole Shopify vehicle catalogue/);
  assert.match(source("app/routes/app.fitment.$productHandle.tsx"), /refreshVehicleIndex/);
  assert.match(source("app/routes/app.fitment.$productHandle.tsx"), /Generation \/ type/);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll vehicle coverage tests passed");
