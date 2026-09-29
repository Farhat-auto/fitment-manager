import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectedProductIds } from "../extensions/car-fitment/src/selection.js";
import {
  filterVehicles,
  loadCompatible,
  makesFrom,
  parseReferenceList,
  pickCandidate,
  vehicleModel,
  vehiclesFromLabels,
} from "../extensions/car-fitment/src/item-vehicles.js";
import {
  UNVERIFIED,
  NEEDS_REVIEW,
  VERIFIED,
  acceptListing,
  defaultVerification,
  emptyListing,
  isLegacyTestRow,
  listingBelongsTo,
  resetProductScreen,
  stableIdentity,
  storefrontLabel,
  stripTitle,
} from "../app/ocean/identity.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

const PRODUCT_A = "9000000001";
const PRODUCT_B = "9000000002";
const PRODUCT_C = "9000000003";
const SKU_A = "OCP-A";
const SKU_B = "OCP-B";
const SKU_C = "OCP-C";
const VEHICLE_A = "bmw-e82-135i-240";
const VEHICLE_B = "bmw-e90-330i";

const identityA = { shopify_product_id: PRODUCT_A, sku: SKU_A };
const identityB = { shopify_product_id: PRODUCT_B, sku: SKU_B };
const identityC = { shopify_product_id: PRODUCT_C, sku: SKU_C };

function listing(id: string, sku: string, vehicles: string[], verification = VERIFIED) {
  return {
    ok: true,
    shopify_product_id: id,
    sku,
    count: vehicles.length,
    zero_fitment: vehicles.length === 0,
    fitment_label: `Fitment: ${vehicles.length} vehicles`,
    fitments: vehicles.map((vehicle_id) => ({
      vehicle_id,
      verification_status: verification,
      public_fits: verification === VERIFIED,
    })),
    copied_fitment: false,
    title_used: false,
  };
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

const pending: Promise<void>[] = [];
function checkAsync(name: string, fn: () => Promise<void>) {
  pending.push(
    fn().then(
      () => console.log("PASS", name),
      (error) => {
        failed += 1;
        console.error("FAIL", name, error);
      },
    ),
  );
}

check("title is not an identity key", () => {
  const resolved = stableIdentity({ title: "VEMO water pump", product: { title: "Borrowed title" } });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) {
    assert.equal(resolved.error, "ambiguous_identity");
    assert.equal(resolved.count, 0);
    assert.equal(resolved.unmapped, true);
  }
  const stripped = stripTitle({ title: "nope", sku: SKU_A, product: { title: "nope", sku: SKU_A } });
  assert.equal("title" in stripped, false);
});

check("identity order: shopify ids, sku, brand+mpn", () => {
  assert.equal(stableIdentity({ shopify_product_id: PRODUCT_A }).ok, true);
  assert.equal(stableIdentity({ shopify_variant_id: "555" }).ok, true);
  assert.equal(stableIdentity({ sku: SKU_A }).ok, true);
  assert.equal(stableIdentity({ brand: "VEMO", mpn: "V20-16-0004" }).ok, true);
  assert.equal(stableIdentity({ brand: "VEMO" }).ok, false);
});

check("A listing is rejected on B", () => {
  const listingA = listing(PRODUCT_A, SKU_A, [VEHICLE_A]);
  assert.equal(listingBelongsTo(listingA, identityA), true);
  assert.equal(listingBelongsTo(listingA, identityB), false);
});

check("matching Shopify product id wins over a different SKU string", () => {
  const catalogue = listing(PRODUCT_A, "HI-BRIT-HB-00319", [VEHICLE_A]);
  assert.equal(listingBelongsTo(catalogue, { shopify_product_id: PRODUCT_A, sku: "HB-00319" }), true);
  assert.equal(listingBelongsTo(catalogue, { shopify_product_id: PRODUCT_B, sku: "HI-BRIT-HB-00319" }), false);
  assert.equal(listingBelongsTo(catalogue, { sku: "HB-00319" }), false);
});

check("A → B → C → A isolation", () => {
  let screen = resetProductScreen(PRODUCT_A);
  screen = acceptListing(screen, listing(PRODUCT_A, SKU_A, [VEHICLE_A]), identityA);
  assert.deepEqual(screen.listing.fitments?.map((row: any) => row.vehicle_id), [VEHICLE_A]);
  assert.equal(screen.verification, UNVERIFIED);

  screen = resetProductScreen(PRODUCT_B);
  screen = acceptListing(screen, listing(PRODUCT_B, SKU_B, [VEHICLE_B]), identityB);
  assert.deepEqual(screen.listing.fitments?.map((row: any) => row.vehicle_id), [VEHICLE_B]);
  assert.equal(screen.search, "");
  assert.deepEqual(screen.checked, {});
  const rejected = acceptListing(screen, listing(PRODUCT_A, SKU_A, [VEHICLE_A]), identityB);
  assert.equal(rejected.rejectedStale, true);
  assert.deepEqual(rejected.listing.fitments?.map((row: any) => row.vehicle_id), [VEHICLE_B]);

  screen = resetProductScreen(PRODUCT_C);
  screen = acceptListing(screen, emptyListing(identityC, { count: 0 }), identityC);
  assert.equal(screen.listing.count, 0);
  assert.equal(screen.listing.zero_fitment, true);

  screen = resetProductScreen(PRODUCT_A);
  screen = acceptListing(screen, listing(PRODUCT_A, SKU_A, [VEHICLE_A]), identityA);
  assert.deepEqual(screen.listing.fitments?.map((row: any) => row.vehicle_id), [VEHICLE_A]);
  assert.notDeepEqual(screen.listing.fitments?.map((row: any) => row.vehicle_id), [VEHICLE_B]);
});

check("verification defaults", () => {
  assert.equal(defaultVerification("add", undefined, "manual"), UNVERIFIED);
  assert.equal(defaultVerification("bulk", undefined, "manual"), UNVERIFIED);
  assert.equal(defaultVerification("import", undefined, "catalogue_import"), UNVERIFIED);
  assert.equal(defaultVerification("import", VERIFIED, "catalogue_import"), UNVERIFIED);
  assert.equal(defaultVerification("import", NEEDS_REVIEW, "catalogue_import"), NEEDS_REVIEW);
  assert.equal(defaultVerification("add", VERIFIED, "supplier"), VERIFIED);
  assert.equal(defaultVerification("add", VERIFIED, "legacy_test"), UNVERIFIED);
  assert.equal(defaultVerification("update", VERIFIED, "manual"), VERIFIED);
  assert.equal(storefrontLabel(UNVERIFIED), "Compatibility not confirmed");
  assert.equal(storefrontLabel(NEEDS_REVIEW), "Compatibility not confirmed");
  assert.equal(storefrontLabel(VERIFIED), "Fits your vehicle");
});

check("legacy test row is not auto-verified", () => {
  assert.equal(isLegacyTestRow({ shopify_product_id: "10746583548247", sku: "VEMO-V20-16-0004" }), true);
  assert.equal(defaultVerification("import", VERIFIED, "test"), UNVERIFIED);
  assert.equal(storefrontLabel(UNVERIFIED, false), "Compatibility not confirmed");
});

check("embed 410 recovery is wired", () => {
  const root = source("app/root.tsx");
  assert.match(root, /boundary\.error/);
  assert.match(root, /boundary\.headers/);
  assert.doesNotMatch(root, /await authenticate/);
  const app = source("app/routes/app.tsx");
  assert.match(app, /boundary\.error/);
  assert.match(app, /AppProvider/);
  assert.match(app, /isEmbeddedApp/);
  const entry = source("app/entry.server.tsx");
  assert.match(entry, /addDocumentResponseHeaders/);
  const shopify = source("app/shopify.server.ts");
  assert.match(shopify, /unstable_newEmbeddedAuthStrategy:\s*true/);
  assert.match(shopify, /SupabaseSessionStorage/);
});

check("CAR FITMENT port preserves proven reset/isolation", () => {
  const app = source("extensions/car-fitment/src/FitmentApp.jsx");
  assert.match(app, /resetProductScreen/);
  assert.match(app, /shopify_product_id/);
  assert.match(app, /stale product payload ignored/);
  assert.match(app, /UNVERIFIED/);
  assert.match(app, /Same OE number does not automatically mean same vehicle fitment|oe-warning/);
  assert.match(app, /PRODUCT IDENTITY/);
  const api = source("extensions/car-fitment/src/api.js");
  assert.match(api, /sessionToken/);
  assert.match(api, /\/api\/ocean/);
  assert.doesNotMatch(api, /ocean-catalogue-manager/);
  const payload = source("extensions/car-fitment/src/payload.js");
  assert.match(payload, /ocean/);
  assert.match(payload, /fitment_count/);
  assert.doesNotMatch(payload, /vehicle_fitment/);
  const toml = source("extensions/car-fitment/shopify.extension.toml");
  assert.match(toml, /admin.product-details.block.render/);
  assert.doesNotMatch(toml, /admin.product-index.action.render/);
  const index = source("extensions/car-fitment-index/shopify.extension.toml");
  assert.match(index, /admin.product-index.action.render/);
  assert.match(index, /9ff4b93f-9764-80f5-5645-648f40c0968790d16581/);
  const bulk = source("extensions/car-fitment-bulk/shopify.extension.toml");
  assert.match(bulk, /admin.product-index.selection-action.render/);
  assert.match(bulk, /4130cb4c-2d0b-cde5-d1de-06c064360c720b8d414e/);
  const indexEntry = source("extensions/car-fitment-index/src/Action.jsx");
  assert.match(indexEntry, /mount-action\.jsx/);
  assert.doesNotMatch(indexEntry, /from "preact"/);
  assert.match(source("extensions/car-fitment/src/mount-action.jsx"), /@shopify\/ui-extensions\/preact/);
  assert.match(source("extensions/car-fitment/src/mount-action.jsx"), /loading=\{false\}/);
  assert.match(source("extensions/car-fitment/src/mount-action.jsx"), /VehicleSearch/);
  assert.doesNotMatch(source("extensions/car-fitment/src/mount-action.jsx"), /\.remove\(\)/);
  assert.doesNotMatch(source("extensions/car-fitment/src/mount-action.jsx"), /Loading car fitment/);
  const locales = source("extensions/car-fitment/locales/en.default.json");
  assert.match(locales, /Ocean Catalogue \/ CAR FITMENT/);
  assert.match(locales, /Select one or more products, then open CAR FITMENT/);
});

check("CAR FITMENT product-page action leaves the host spinner", () => {
  const action = source("extensions/car-fitment/src/mount-action.jsx");
  const block = source("extensions/car-fitment/src/Block.jsx");
  assert.match(action, /@shopify\/ui-extensions\/preact/);
  assert.doesNotMatch(action, /Loading car fitment/);
  assert.match(action, /render\(<SearchAction \/>, document\.body\)/);
  assert.doesNotMatch(action, /stale\[index\]\.remove\(\)/);
  assert.match(source("extensions/car-fitment/src/vehicle-search.jsx"), /VEHICLE/);
  assert.match(source("extensions/car-fitment/src/vehicle-search.jsx"), /Exact Fitment/);
  assert.match(source("extensions/car-fitment/src/vehicle-search.jsx"), /All for Model/);
  assert.match(source("extensions/car-fitment/src/vehicle-search.jsx"), /All for Engine/);
  assert.match(source("extensions/car-fitment/src/vehicle-search.jsx"), /\/products\?vehicle_key=/);
  assert.match(source("extensions/car-fitment/src/vehicle-search.jsx"), /loadCompatible/);
  assert.match(source("extensions/car-fitment/src/vehicle-search.jsx"), /oeRefs/);
  assert.match(source("extensions/car-fitment/src/item-vehicles.js"), /\/fitments\?/);
  assert.match(source("extensions/car-fitment/src/item-vehicles.js"), /\/oe\?number=/);
  assert.match(source("extensions/fitment-block/src/VehicleBar.tsx"), /storefront-catalogue/);
  assert.match(source("extensions/car-fitment/src/api.js"), /publicCatalogueGet/);
  assert.match(source("extensions/car-fitment/src/item-vehicles.js"), /make_name/);
  assert.match(source("extensions/fitment-block/src/VehicleBar.tsx"), /loadCompatible/);
  assert.match(source("extensions/fitment-block/src/VehicleBar.tsx"), /data\.selected/);
  assert.match(source("extensions/fitment-block/src/VehicleBar.tsx"), /oe_references/);
  assert.match(source("extensions/fitment-block/src/VehicleBar.tsx"), /Compatible vehicles/);
  assert.doesNotMatch(source("extensions/fitment-block/src/VehicleBar.tsx"), /No makes were returned by the vehicle catalogue/);
  assert.equal(
    source("extensions/fitment-block/src/item-vehicles.js"),
    source("extensions/car-fitment/src/item-vehicles.js"),
  );
  assert.match(source("extensions/car-fitment/src/vehicle-search.jsx"), /label="Make"/);
  assert.match(source("extensions/car-fitment/src/vehicle-search.jsx"), /label="Engine"/);
  assert.doesNotMatch(source("extensions/car-fitment/src/FitmentApp.jsx"), /Download import template/);
  assert.doesNotMatch(source("extensions/car-fitment/src/guard.jsx"), /Download import template/);
  assert.match(block, /@shopify\/ui-extensions\/preact/);
  assert.match(block, /VehicleSearch/);
  const app = source("extensions/car-fitment/src/FitmentApp.jsx");
  assert.match(app, /@shopify\/ui-extensions\/preact/);
  assert.match(app, /loading: false/);
  assert.match(app, /Search products linked to a vehicle/);
  assert.match(app, /\/products\?/);
  assert.match(app, /vehicle_key: engineId/);
  assert.match(app, /loadMakes\(\)/);
  assert.match(app, /has_vehicles=0/);
  assert.match(app, /selectedProductIds/);
  assert.match(source("extensions/car-fitment/src/selection.js"), /Array\.isArray/);
  assert.deepEqual(selectedProductIds(undefined), []);
  assert.deepEqual(selectedProductIds({}), []);
  assert.deepEqual(
    selectedProductIds({ selected: { peek: () => [{ id: "gid://shopify/Product/1" }] } }),
    ["gid://shopify/Product/1"],
  );
  assert.deepEqual(selectedProductIds({ selected: [{ id: "gid://shopify/Product/2" }] }), [
    "gid://shopify/Product/2",
  ]);
  assert.deepEqual(selectedProductIds({ product: { id: "gid://shopify/Product/3" } }), [
    "gid://shopify/Product/3",
  ]);
  assert.deepEqual(selectedProductIds({ selected: { peek: () => { throw new Error("unready"); } } }), []);
  assert.deepEqual(
    selectedProductIds({
      selected: {
        value: [{ id: "gid://shopify/Product/9" }],
        peek: () => [{ id: "gid://shopify/Product/1" }],
      },
    }),
    ["gid://shopify/Product/9"],
  );
  const api = source("extensions/car-fitment/src/api.js");
  assert.match(api, /\/makes\?has_vehicles=0/);
  assert.match(api, /has_next/);
  const pkg = source("extensions/car-fitment/package.json");
  assert.match(pkg, /@shopify\/ui-extensions/);
  assert.match(pkg, /@preact\/signals/);
  assert.match(action, /\.\/vehicle-search\.jsx/);
  assert.match(block, /\.\/vehicle-search\.jsx/);
  const guard = source("extensions/car-fitment/src/guard.jsx");
  assert.match(guard, /s-admin-action/);
  assert.match(guard, /loading=\{false\}/);
});

check("OE family never copies fitment", () => {
  const app = source("extensions/car-fitment/src/FitmentApp.jsx");
  assert.match(app, /copied_fitment/);
  const bff = source("app/routes/api.ocean.$.ts");
  assert.match(bff, /oe-family/);
  assert.match(bff, /product-review/);
  assert.match(bff, /"products"/);
});

check("legacy writes are disabled", () => {
  const legacy = source("app/ocean/legacy.ts");
  assert.match(legacy, /writesEnabled: false/);
  const save = source("app/routes/app.fitment.$productHandle.tsx");
  assert.match(save, /rejectLegacyVehicleWrite/);
  const productPage = source("app/routes/app.products.$productId.tsx");
  assert.doesNotMatch(productPage, /from\("fitments"\)/);
  assert.match(productPage, /oceanProductFitmentGet/);
});

checkAsync("product card links this item to its vehicles", async () => {
  assert.deepEqual(parseReferenceList('["LR124259","LR061969"]'), ["LR124259", "LR061969"]);
  assert.equal(vehiclesFromLabels('["LAND ROVER / Range Rover Sport / L320 / 276DT"]').length, 1);
  assert.equal(vehiclesFromLabels('["LAND ROVER / Range Rover Sport / L320 / 276DT"]')[0].make_name, "LAND ROVER");
  assert.deepEqual(parseReferenceList("LR124259, LR061969"), ["LR124259", "LR061969"]);
  const rows = [
    {
      make_name: "LAND ROVER",
      model_name: "Range Rover Sport",
      generation_name: "(L320)",
      year_range: "2005 - 2013",
      engine_code: "276DT",
      vehicle_key: "v1",
    },
    {
      make_name: "LAND ROVER",
      model_name: "Discovery",
      generation_name: "3",
      engine_code: "276DT",
      vehicle_key: "v2",
    },
  ];
  assert.deepEqual(
    makesFrom(rows).map((row) => row.name),
    ["LAND ROVER"],
  );
  assert.match(vehicleModel(rows[0]), /Range Rover Sport/);
  assert.match(vehicleModel(rows[0]), /\(L320\)/);
  const key = (row: { vehicle_key?: string }) => String(row.vehicle_key || "");
  const code = (row: { engine_code?: string }) => String(row.engine_code || "");
  assert.equal(filterVehicles(rows, "LAND ROVER", "", "v1", "exact", key, code).length, 1);
  assert.equal(filterVehicles(rows, "LAND ROVER", "", "v1", "engine", key, code).length, 2);
  assert.equal(
    pickCandidate(
      [
        { sku: "OTHER", brand: "BOSCH", fitment_count: 3, discovery_only: true },
        { sku: "AHE-1", brand: "AHE", fitment_count: 2, discovery_only: true },
      ],
      { vendor: "AHE" },
    ).sku,
    "AHE-1",
  );
  const result = await loadCompatible(
    async (path: string) => {
      if (path.startsWith("/fitments?shopify_product_id=")) return { fitments: [], unmapped: true };
      if (path.startsWith("/oe?number=")) {
        assert.match(path, /number=LR124259/);
        return { results: [{ sku: "AHE-842", brand: "AHE", mpn: "842.019M1" }] };
      }
      if (path.startsWith("/fitments?sku=")) return { fitments: rows };
      return { status: 500 };
    },
    { sku: "", vendor: "AHE", mpn: "", oe: ["LR124259"], handle: "" },
    "111900662365527",
    "",
  );
  assert.equal(result.rows.length, 2);
  assert.match(result.matchNote, /AHE 842\.019M1/);
  assert.match(result.matchNote, /OE LR124259/);
  const direct = await loadCompatible(
    async () => ({ fitments: rows }),
    { sku: "842.019M1", vendor: "AHE", mpn: "842.019M1", oe: ["LR124259"], handle: "cooler" },
    "111900662365527",
    "",
  );
  assert.equal(direct.rows.length, 2);
  assert.equal(direct.matchNote, "");
});

await Promise.all(pending);

if (failed) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log("\nAll Fitment Manager identity/isolation/embed checks passed");
