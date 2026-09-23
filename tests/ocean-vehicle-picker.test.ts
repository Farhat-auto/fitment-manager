import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
const productsLayout = source("app/routes/app.products.tsx");
const products = source("app/routes/app.products._index.tsx");
const legacy = source("app/routes/app.fitment.$productHandle.tsx");
const classificationUi = source("app/components/ProductClassification.tsx");
const classificationServer = source("app/classification/classification.server.ts");
const api = source("app/routes/api.ocean.$.ts");
const client = source("app/ocean/client.server.ts");
const settings = source("app/routes/app.settings.tsx");
const metafields = source("app/ocean/metafields.ts");
const graphql = source("app/graphql/fitment.ts");
const payload = source("extensions/car-fitment/src/payload.js");
const extensionApp = source("extensions/car-fitment/src/FitmentApp.jsx");
const fitmentBlock = source("extensions/fitment-block/src/FitmentBlock.tsx");
const adminListQuery = graphql.split("export const GET_PRODUCTS_FOR_FITMENT_ADMIN")[1]?.split("export const")[0] || "";
const identityQuery = metafields.split("export const PRODUCT_IDENTITY_QUERY")[1]?.split("export const")[0] || "";

check("1. Products Manage Fitment opens /app/products/:productId", () => {
  assert.match(products, /\/app\/products\/\$\{numericId\(p\.id\)\}/);
  assert.match(products, /Manage Fitment/);
  assert.match(products, /navigate\(appHref\(`\/app\/products\/\$\{numericId\(p\.id\)\}`/);
  assert.doesNotMatch(products, /\/app\/fitment\/\$\{encodeURIComponent\(p\.handle\)\}/);
  assert.match(productPage, /CarFitmentPanel/);
  assert.match(productPage, /PRODUCT_IDENTITY_QUERY_FAILED/);
  assert.match(picker, /No fitment assigned/);
  assert.match(picker, /idToken/);
  assert.match(productPage, /oceanProductFitmentGet/);
  assert.match(productsLayout, /<Outlet \/>/);
  assert.doesNotMatch(productsLayout, /GET_PRODUCTS_FOR_FITMENT_ADMIN/);
  assert.doesNotMatch(productsLayout, /authenticate/);
  assert.doesNotMatch(productPage, /GET_PRODUCTS_FOR_FITMENT_ADMIN/);
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

check("14. classification remains on the canonical product page", () => {
  assert.match(products, /label="Category"/);
  assert.match(products, /label="System Group"/);
  assert.match(products, /label="Sub-category"/);
  assert.match(productPage, /ProductClassification/);
  assert.match(classificationUi, /Product Classification/);
  assert.match(classificationUi, /label="Category"/);
  assert.match(classificationUi, /label="System Group"/);
  assert.match(classificationUi, /label="Sub-category"/);
  assert.match(classificationServer, /catalog_main_category/);
  assert.doesNotMatch(classificationServer, /getVehicleIndex/);
  assert.doesNotMatch(classificationUi, /Vehicle index:/);
  assert.doesNotMatch(classificationUi, /Refresh Vehicle Index/);
});

check("legacy /app/fitment/:handle is a redirect bridge, not a second UI", () => {
  assert.match(legacy, /\/app\/products\/\$\{numericId\}/);
  assert.match(legacy, /PRODUCT_ID_BY_HANDLE_QUERY/);
  assert.match(legacy, /rejectLegacyVehicleWrite/);
  assert.match(legacy, /is not the normal product/);
  assert.doesNotMatch(legacy, /Refresh Vehicle Index/);
  assert.doesNotMatch(legacy, /Vehicle index:/);
  assert.doesNotMatch(legacy, /getVehicleIndex/);
  assert.doesNotMatch(legacy, /Select a Make to load vehicles/);
  assert.doesNotMatch(legacy, /loadFitmentRouteData/);
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

check("15. Settings presents Ocean Catalogue authority, not fitment.vehicles config", () => {
  assert.match(settings, /Ocean Catalogue \/ PostgreSQL/);
  assert.match(settings, /ocean_vehicle_id/);
  assert.match(settings, /product_fitment/);
  assert.match(settings, /Ocean Catalogue API/);
  assert.match(settings, /Commerce \+ compact fitment status only/);
  assert.match(settings, /oceanConfigured/);
  assert.match(settings, /NOT active authority/);
  assert.doesNotMatch(settings, /list\.metaobject_reference/);
  assert.doesNotMatch(settings, /Namespace:\s*<code>fitment<\/code>/);
  assert.doesNotMatch(settings, /Key:\s*<code>vehicles<\/code>/);
  assert.doesNotMatch(settings, /getVehicleIndex/);
  assert.doesNotMatch(settings, /refreshVehicleIndex/);
});

check("16. /app/products/:productId vehicle discovery uses Ocean API only", () => {
  assert.match(productPage, /oceanProductFitmentGet/);
  assert.match(productPage, /oceanProductFitmentPost/);
  assert.match(productPage, /OCEAN_PRODUCT_FITMENT_FAILED/);
  assert.match(productPage, /try \{\s*listing = await oceanProductFitmentGet/);
  assert.match(picker, /fetch\("\/api\/ocean"/);
  assert.match(picker, /oceanGet\("\/makes\?has_vehicles=1/);
  assert.doesNotMatch(productPage, /getVehicleIndex/);
  assert.doesNotMatch(productPage, /refreshVehicleIndex/);
  assert.doesNotMatch(productPage, /vehicleIndex/);
  assert.doesNotMatch(productPage, /vehicle_index_cache/);
  assert.doesNotMatch(productPage, /from "\.\.\/vehicles\//);
  assert.doesNotMatch(picker, /from "\.\.\/vehicles\//);
  assert.doesNotMatch(identityQuery, /namespace: "fitment", key: "vehicles"/);
  assert.doesNotMatch(identityQuery, /compatible_vehicles/);
  assert.doesNotMatch(identityQuery, /legacyVehicles/);
  assert.match(identityQuery, /namespace: "ocean", key: "fitment_count"/);
});

check("17. no Shopify vehicle index or vehicle metaobject catalogue pagination on normal path", () => {
  assert.doesNotMatch(productPage, /paginateMetaobjects/);
  assert.doesNotMatch(productPage, /type: "vehicle"/);
  assert.doesNotMatch(picker, /metaobjects\(type: "vehicle"/);
  assert.doesNotMatch(picker, /paginateMetaobjects/);
  assert.doesNotMatch(settings, /paginateMetaobjects/);
  assert.doesNotMatch(products, /type: "vehicle"/);
  assert.match(products, /type: "catalog_main_category"/);
  assert.match(products, /type: "catalog_system_group"/);
  assert.match(products, /type: "catalog_subcategory"/);
  assert.match(adminListQuery, /namespace: "ocean", key: "fitment_count"/);
  assert.doesNotMatch(adminListQuery, /namespace: "fitment", key: "vehicles"/);
  assert.doesNotMatch(adminListQuery, /compatible_vehicles/);
  assert.match(products, /parseOceanFitmentCount/);
  assert.doesNotMatch(products, /parseFitmentGids/);
});

check("18. saving Ocean compatibility does not write Shopify vehicle metafields", () => {
  assert.match(productPage, /countMetafields/);
  assert.match(metafields, /namespace: "ocean"/);
  assert.match(metafields, /key: "fitment_count"/);
  assert.match(metafields, /key: "fitment_status"/);
  assert.match(metafields, /key: "zero_fitment"/);
  assert.doesNotMatch(productPage, /SET_FITMENT_VEHICLES/);
  assert.doesNotMatch(productPage, /namespace: "fitment"/);
  assert.doesNotMatch(productPage, /compatible_vehicles/);
  assert.doesNotMatch(picker, /SET_FITMENT_VEHICLES/);
  assert.doesNotMatch(picker, /fitment\.vehicles/);
  assert.doesNotMatch(payload, /namespace: "fitment"/);
  assert.doesNotMatch(payload, /compatible_vehicles/);
  assert.doesNotMatch(payload, /legacyVehicles/);
  assert.doesNotMatch(extensionApp, /legacyVehicles/);
  assert.doesNotMatch(extensionApp, /customVehicles/);
  assert.doesNotMatch(extensionApp, /legacy_fitment/);
  assert.match(extensionApp, /countMetafields\(product\.id, count\)/);
});

check("19. final vehicle identity is ovh-* not Shopify metaobject GIDs", () => {
  const id = canonicalOceanVehicleId({
    ocean_vehicle_id: "ovh-8ff6795d995621d47b0f",
    id: "gid://shopify/Metaobject/99",
  });
  assert.equal(id, "ovh-8ff6795d995621d47b0f");
  assert.equal(isCanonicalOceanVehicleId("ovh-8ff6795d995621d47b0f"), true);
  assert.equal(isShopifyMetaobjectGid("gid://shopify/Metaobject/99"), true);
  assert.equal(canonicalOceanVehicleId({ id: "gid://shopify/Metaobject/99" }), "");
  assert.match(picker, /ocean_vehicle_ids: addIds/);
  assert.match(picker, /canonicalOceanVehicleId/);
});

check("20. leftover /app/fitment/:handle cannot become authoritative", () => {
  assert.match(products, /\/app\/products\/\$\{numericId\(p\.id\)\}/);
  assert.doesNotMatch(products, /\/app\/fitment\/\$\{/);
  assert.match(legacy, /rejectLegacyVehicleWrite/);
  assert.match(legacy, /status: 409/);
  assert.match(legacy, /\/app\/products\/\$\{numericId\}/);
  assert.match(source("app/ocean/legacy.ts"), /writesEnabled: false/);
  assert.match(fitmentBlock, /\/app\/products\/\$\{encodeURIComponent\(numericId\)\}/);
  assert.doesNotMatch(fitmentBlock, /\/app\/fitment\//);
  assert.doesNotMatch(fitmentBlock, /\/api\/fitment/);
  assert.doesNotMatch(fitmentBlock, /quickRemove/);
});

check("21. Admin product block opens Ocean CAR FITMENT and does not load Shopify vehicles", () => {
  assert.match(fitmentBlock, /Ocean CAR FITMENT/);
  assert.match(fitmentBlock, /\/app\/products\/\$\{encodeURIComponent\(numericId\)\}/);
  assert.doesNotMatch(fitmentBlock, /admin\.graphql/);
  assert.doesNotMatch(fitmentBlock, /metaobjects\(type: "vehicle"/);
  assert.doesNotMatch(fitmentBlock, /namespace: "fitment"/);
  assert.equal(existsSync(join(root, "extensions/fitment-block/dist/fitment-block.js")), false);
});

check("22. /api/fitment does not read Shopify vehicle metafields for display", () => {
  const fitmentApi = source("app/routes/api.fitment.ts");
  const removeApi = source("app/routes/api.fitment.remove.ts");
  assert.doesNotMatch(fitmentApi, /admin\.graphql/);
  assert.doesNotMatch(fitmentApi, /namespace: "fitment"/);
  assert.doesNotMatch(fitmentApi, /compatible_vehicles/);
  assert.match(fitmentApi, /\/app\/products\//);
  assert.match(fitmentApi, /vehicles: \[\]/);
  assert.match(removeApi, /rejectLegacyVehicleWrite/);
  assert.doesNotMatch(removeApi, /admin\.graphql/);
});

check("23. normal navigation does not include Shopify vehicle import/export", () => {
  const appShell = source("app/routes/app.tsx");
  assert.match(appShell, /to="\/app\/products"/);
  assert.match(appShell, /to="\/app\/images"/);
  assert.match(appShell, /to="\/app\/settings"/);
  assert.doesNotMatch(appShell, /to="\/app\/import"/);
  assert.doesNotMatch(appShell, /to="\/app\/export"/);
  assert.doesNotMatch(appShell, /to="\/app\/fitment/);
  const home = source("app/routes/app._index.tsx");
  assert.match(home, /LEGACY Shopify vehicle tools/);
  assert.match(home, /to\("\/app\/import"\)/);
  assert.match(home, /to\("\/app\/export"\)/);
});

check("24. ACTIVE NORMAL PATH files have zero Shopify vehicle DB dependencies", () => {
  const vehicleDb = [
    /ListMetaobjectsByType/,
    /fitment\.vehicles/,
    /custom\.compatible_vehicles/,
    /getVehicleIndex/,
    /refreshVehicleIndex/,
    /vehicle_index_cache/,
    /vehicle_metaobject/,
    /list\.metaobject_reference/,
    /metaobjects\(type: "vehicle"/,
    /namespace: "fitment", key: "vehicles"/,
    /key: "compatible_vehicles"/,
    /SET_FITMENT_VEHICLES/,
    /SEARCH_VEHICLES/,
    /GET_PRODUCT_FOR_FITMENT_PAGE/,
    /from "\.\.\/vehicles\/vehicleIndex/,
  ];
  const normalPath = [
    "app/routes/app.tsx",
    "app/routes/app.products.tsx",
    "app/routes/app.products._index.tsx",
    "app/routes/app.products.$productId.tsx",
    "app/components/ProductClassification.tsx",
    "app/classification/classification.server.ts",
    "app/routes/app.settings.tsx",
    "app/components/CarFitment.tsx",
    "app/ocean/metafields.ts",
    "app/ocean/client.server.ts",
    "app/ocean/identity.ts",
    "app/routes/api.ocean.$.ts",
    "extensions/car-fitment/src/payload.js",
    "extensions/car-fitment/src/FitmentApp.jsx",
    "extensions/car-fitment/src/api.js",
    "extensions/car-fitment/src/Block.jsx",
    "extensions/car-fitment/src/Action.jsx",
    "extensions/fitment-block/src/FitmentBlock.tsx",
  ];
  for (const rel of normalPath) {
    const text = source(rel);
    for (const pattern of vehicleDb) {
      assert.doesNotMatch(text, pattern, `${rel} matched ${pattern}`);
    }
  }
  assert.match(products, /key: "brand_reference"/);
  assert.match(products, /type: "metaobject_reference"/);
  assert.match(products, /label="Category"/);
  assert.match(products, /label="System Group"/);
  assert.match(products, /label="Sub-category"/);
});

check("25. canonical page has no vehicle-index chrome and does not hardcode BMW", () => {
  assert.doesNotMatch(productPage, /Vehicle index:/);
  assert.doesNotMatch(productPage, /1000 vehicles cached/);
  assert.doesNotMatch(productPage, /Refresh Vehicle Index/);
  assert.doesNotMatch(picker, /Vehicle index:/);
  assert.doesNotMatch(picker, /Refresh Vehicle Index/);
  assert.doesNotMatch(picker, /BMW/);
  assert.doesNotMatch(productPage, /BMW/);
  assert.match(picker, /oceanGet\("\/makes\?has_vehicles=1/);
  assert.match(picker, /withVehicles/);
  assert.doesNotMatch(products, /ListMetaobjectsByType/);
  assert.doesNotMatch(productPage, /ListMetaobjectsByType/);
  assert.doesNotMatch(classificationServer, /ListMetaobjectsByType/);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll Ocean Circosoft vehicle picker tests passed");
