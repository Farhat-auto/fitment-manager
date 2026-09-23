import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalOceanVehicleId,
  isCanonicalOceanVehicleId,
  isRawOdooId,
  isShopifyMetaobjectGid,
  stableIdentity,
  stripTitle,
} from "../app/ocean/identity.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

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

const picker = source("app/components/CarFitment.tsx");
const productPage = source("app/routes/app.products.$productId.tsx");
const products = source("app/routes/app.products.tsx");
const legacy = source("app/routes/app.fitment.$productHandle.tsx");
const api = source("app/routes/api.ocean.$.ts");
const client = source("app/ocean/client.server.ts");

check("1. Products Manage Fitment opens /app/products/:productId", () => {
  assert.match(products, /\/app\/products\/\$\{numericId\(p\.id\)\}/);
  assert.match(products, />Manage Fitment</);
  assert.doesNotMatch(products, /\/app\/fitment\/\$\{encodeURIComponent\(p\.handle\)\}/);
  assert.match(productPage, /CarFitmentPanel/);
  assert.match(productPage, /oceanProductFitmentGet/);
});

check("2. makes uses has_vehicles=1", () => {
  assert.match(picker, /oceanGet\("\/makes\?has_vehicles=1/);
  assert.match(picker, /has_vehicles: "1"/);
});

check("3. models are progressive after make_id", () => {
  assert.match(picker, /\/models\?" \+ qs\(\{ make_id: value, has_vehicles: "1" \}\)/);
  assert.match(picker, /if \(!value\) return;/);
});

check("4. generation can be skipped", () => {
  assert.match(picker, /skip_generation/);
  assert.match(picker, /setSkipGeneration\(skip\)/);
  assert.match(picker, /\{\!skipGeneration \? \(/);
});

check("5. motorisations load progressively", () => {
  assert.match(picker, /label="Motorization"/);
  assert.match(picker, /\/engines\?" \+ qs\(\{ make_id: makeId, model_id: value \}\)/);
  assert.match(picker, /generation_id: value/);
  assert.match(picker, /if \(!skip\) return;/);
});

check("6. final selected identity is ocean_vehicle_id", () => {
  assert.match(picker, /canonicalOceanVehicleId/);
  assert.match(picker, /ocean_vehicle_ids: addIds/);
  assert.match(picker, /ocean_vehicle_id/);
  const id = canonicalOceanVehicleId({
    ocean_vehicle_id: "ovh-8ff6795d995621d47b0f",
    id: "1",
    title: "BMW 1 (E81) 116 d",
  });
  assert.equal(id, "ovh-8ff6795d995621d47b0f");
});

check("7. raw Odoo ID rejected", () => {
  assert.equal(isRawOdooId("1"), true);
  assert.equal(isRawOdooId("9938"), true);
  assert.equal(isCanonicalOceanVehicleId("1"), false);
  assert.equal(canonicalOceanVehicleId({ id: "1", vehicle_id: "57" }), "");
  assert.equal(canonicalOceanVehicleId({ ocean_vehicle_id: "1" }), "");
});

check("8. title is not identity", () => {
  const resolved = stableIdentity({ title: "BMW 330i water pump" });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.error, "ambiguous_identity");
  const stripped = stripTitle({ title: "nope", sku: "OCP-1" });
  assert.equal("title" in stripped, false);
  assert.equal(canonicalOceanVehicleId({ title: "BMW 1 (E81) 116 d" }), "");
  const identity = source("app/ocean/identity.ts");
  assert.match(identity, /Shopify product ID/);
  assert.match(identity, /variant ID/);
  assert.match(identity, /SKU/);
  assert.match(identity, /Brand \+ MPN/);
  assert.match(identity, /never an identity key/);
});

check("9. server-side vehicle search", () => {
  assert.match(picker, /\/vehicle-search\?q=/);
  assert.doesNotMatch(picker, /getVehicleIndex/);
  assert.match(api, /"vehicle-search"/);
  assert.match(client, /OCEAN_CATALOGUE_URL/);
  assert.match(client, /shopify-admin/);
});

check("10. no full catalogue download", () => {
  assert.doesNotMatch(picker, /vehicles\.json/);
  assert.doesNotMatch(picker, /full_dump/);
  assert.doesNotMatch(picker, /\/dump/);
  assert.doesNotMatch(productPage, /\/dump/);
  assert.doesNotMatch(api, /"dump"/);
});

check("11. no normal-path getVehicleIndex", () => {
  assert.doesNotMatch(picker, /getVehicleIndex/);
  assert.doesNotMatch(productPage, /getVehicleIndex/);
  assert.doesNotMatch(productPage, /from "\.\.\/vehicles\/vehicleIndex/);
  assert.doesNotMatch(products, /getVehicleIndex/);
});

check("12. no normal-path refreshVehicleIndex", () => {
  assert.doesNotMatch(picker, /refreshVehicleIndex/);
  assert.doesNotMatch(picker, /vehicle_index_refresh/);
  assert.doesNotMatch(productPage, /refreshVehicleIndex/);
  assert.doesNotMatch(productPage, /vehicle_index_refresh/);
  assert.doesNotMatch(productPage, /Refresh Vehicle Index/);
  assert.doesNotMatch(picker, /Vehicle index:/);
  assert.doesNotMatch(productPage, /1000 vehicles cached/);
});

check("13. no legacy Shopify fitment writes on Ocean editor", () => {
  assert.doesNotMatch(picker, /SET_FITMENT_VEHICLES/);
  assert.doesNotMatch(picker, /fitment\.vehicles/);
  assert.doesNotMatch(picker, /custom\.compatible_vehicles/);
  assert.doesNotMatch(productPage, /SET_FITMENT_VEHICLES/);
  assert.doesNotMatch(productPage, /compatible_vehicles/);
  assert.match(source("app/ocean/legacy.ts"), /writesEnabled: false/);
  assert.match(source("app/ocean/legacy.ts"), /fitment.vehicles/);
  assert.equal(isShopifyMetaobjectGid("gid://shopify/Metaobject/99"), true);
  assert.equal(canonicalOceanVehicleId({ id: "gid://shopify/Metaobject/99" }), "");
});

check("14. classification remains unaffected", () => {
  assert.match(products, /label="Category"/);
  assert.match(products, /label="System Group"/);
  assert.match(products, /label="Sub-category"/);
  assert.match(legacy, /Product Classification/);
});

check("legacy /app/fitment/:handle remains but is not the normal workflow", () => {
  assert.match(legacy, /Legacy Shopify vehicle-metaobject editor/);
  assert.match(legacy, /loadFitmentRouteData/);
  assert.match(legacy, /getVehicleIndex/);
  assert.match(legacy, /Refresh Vehicle Index/);
});

check("Ocean API proxy allows vehicle lookup without a dump", () => {
  assert.match(api, /"vehicle"/);
  assert.match(api, /"vehicle-get"/);
  assert.match(api, /"makes"/);
  assert.match(api, /"models"/);
  assert.match(api, /"engines"/);
  assert.doesNotMatch(picker, /isShopifyThrottled/);
  assert.doesNotMatch(productPage, /paginateMetaobjects/);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll Ocean Circosoft vehicle picker tests passed");
