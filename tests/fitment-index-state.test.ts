import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  indexSummaryFromCache,
  listMakesFromRows,
  listModelsFromRows,
  vehicleIndexIsReady,
  vehiclesForMakeModelFromRows,
  type VehicleIndexRow,
} from "../app/vehicles/vehicleIndexQuery.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

const vehicles: VehicleIndexRow[] = [
  {
    gid: "gid://shopify/Metaobject/1",
    handle: "bmw-3",
    vehicleKey: "bmw-3",
    displayName: "BMW 3 Series",
    makeName: "BMW",
    modelName: "3 Series",
    engineName: "N54",
    variant: "",
    yearFrom: "2007",
    yearTo: "2013",
    bodyType: "",
  },
  {
    gid: "gid://shopify/Metaobject/2",
    handle: "mercedes-w205",
    vehicleKey: "mercedes-w205",
    displayName: "Mercedes W205",
    makeName: "Mercedes-Benz",
    modelName: "C-Class",
    engineName: "M274",
    variant: "",
    yearFrom: "2014",
    yearTo: "2021",
    bodyType: "",
  },
];

let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log("PASS", name);
  } catch (error) {
    failed += 1;
    console.error("FAIL", name, error);
  }
}

check("count alone does not make an unusable index ready", () => {
  assert.equal(vehicleIndexIsReady({ count: 3792 }), false);
  assert.equal(vehicleIndexIsReady({ count: 3792, ready: false, makes: [], vehicles: [] }), false);
});

check("cached 3792-vehicle index with makes is built, not unbuilt", () => {
  const summary = indexSummaryFromCache({
    builtAt: 1,
    count: 3792,
    vehicles: Array.from({ length: 3792 }, (_, i) => ({
      ...vehicles[0],
      gid: `gid://shopify/Metaobject/${i + 1}`,
    })),
  });
  assert.equal(summary.ready, true);
  assert.equal(summary.count, 3792);
  assert.equal(vehicleIndexIsReady({ ...summary, makes: ["BMW"] }), true);
});

check("cached rows populate Make then Model then vehicles", () => {
  const makes = listMakesFromRows(vehicles);
  assert.deepEqual(makes, ["BMW", "Mercedes-Benz"]);
  const models = listModelsFromRows(vehicles, "BMW");
  assert.deepEqual(models, ["3 Series"]);
  const rows = vehiclesForMakeModelFromRows(vehicles, "BMW", "3 Series");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gid, "gid://shopify/Metaobject/1");
});

check("Fitment loader ships makes/indexVehicles from cache and skips index_makes when ready", () => {
  const load = source("app/fitment/fitmentRouteLoad.server.ts");
  assert.match(load, /makes/);
  assert.match(load, /indexVehicles/);
  assert.match(load, /refresh: false/);
  const route = source("app/routes/app.fitment.$productHandle.tsx");
  assert.match(route, /Do not POST index_makes when/);
  assert.match(route, /vehicleIndexIsReady/);
  assert.match(route, /listModelsFromRows/);
  assert.match(route, /vehiclesForMakeModelFromRows/);
  assert.doesNotMatch(
    route,
    /const indexReady = !!indexInfo\?\.count/,
  );
});

check("empty cache is the only unbuilt state", () => {
  const empty = indexSummaryFromCache(null);
  assert.equal(empty.ready, false);
  assert.equal(empty.count, 0);
  assert.equal(vehicleIndexIsReady(empty), false);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll cached vehicle-index tests passed");
