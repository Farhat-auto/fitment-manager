import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UNVERIFIED,
  NEEDS_REVIEW,
  VERIFIED,
  acceptListing,
  articleCreatePreview,
  defaultVerification,
  emptyListing,
  catalogueMappingRequired,
  isLegacyTestRow,
  listingBelongsTo,
  resetProductScreen,
  stableIdentity,
  storefrontLabel,
  stripTitle,
  structuredMpn,
  vehicleFitmentEnabled,
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
  assert.match(toml, /admin.product-index.selection-action.render/);
  const locales = source("extensions/car-fitment/locales/en.default.json");
  assert.match(locales, /Ocean Catalogue \/ CAR FITMENT/);
});

check("OE family never copies fitment", () => {
  const app = source("extensions/car-fitment/src/FitmentApp.jsx");
  assert.match(app, /copied_fitment/);
  const bff = source("app/routes/api.ocean.$.ts");
  assert.match(bff, /oe-family/);
  assert.match(bff, /product-review/);
});

check("catalogue mapping required is not VERIFIED fitment", () => {
  assert.equal(catalogueMappingRequired(emptyListing(identityA)), true);
  assert.equal(catalogueMappingRequired({ unmapped: false, count: 1 }), false);
  assert.equal(defaultVerification("add", VERIFIED, "manual"), VERIFIED);
  const mappingSrc = source("app/ocean/identity.ts");
  assert.match(mappingSrc, /No article mapped/);
  assert.match(mappingSrc, /Never treat mapping evidence as VERIFIED/);
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

check("unmapped product cannot save fitment", () => {
  const listing = emptyListing({ shopify_product_id: "10639645671767", sku: "HI-BRIT-HB-00294" });
  assert.equal(catalogueMappingRequired(listing), true);
  assert.equal(vehicleFitmentEnabled(listing), false);
  const picker = source("app/components/CarFitment.tsx");
  assert.match(picker, /mappingRequired/);
  assert.match(picker, /if \(!addIds.length \|\| mappingRequired\) return;/);
});

check("mapping candidates are evidence only", () => {
  const mappingUi = source("app/components/CatalogueMapping.tsx");
  assert.match(mappingUi, /DISCOVERY EVIDENCE|DISCOVERY_EVIDENCE_LABEL|discovery only/);
  assert.match(mappingUi, /Use this article|MAP_THIS_ARTICLE/);
  assert.doesNotMatch(mappingUi, /autoMap|auto-map/);
});

check("title cannot supply MPN", () => {
  assert.equal(
    structuredMpn({
      title: "Electric Water Pump M274 W205 2742000207",
      product: { title: "Electric Water Pump M274 W205 2742000207", mpn: "" },
    }),
    "",
  );
  const preview = articleCreatePreview({
    vendor: "HI-BRIT",
    sku: "HI-BRIT-HB-00294",
    articleNumber: "HB-00294",
    mpn: "",
    title: "Electric Water Pump M274 W205 2742000207",
    numericId: "10639645671767",
    variantNumericId: "53087436898647",
  });
  assert.equal(preview.mpn, "");
  assert.equal(preview.mpn_from_title, false);
});

check("explicit article mapping enables vehicle controls", () => {
  assert.equal(vehicleFitmentEnabled({ unmapped: true }), false);
  assert.equal(vehicleFitmentEnabled({ unmapped: false, catalogue_mapped: true }), true);
  const mappingUi = source("app/components/CatalogueMapping.tsx");
  assert.match(mappingUi, /MAP_THIS_ARTICLE/);
  assert.match(mappingUi, /CREATE_OCEAN_ARTICLE/);
});

check("refresh clears unsaved selection", () => {
  const screen = resetProductScreen("10639645671767");
  assert.deepEqual(screen.checked, {});
  assert.equal(screen.search, "");
  const picker = source("app/components/CarFitment.tsx");
  assert.match(picker, /setChecked\(\{\}\)/);
  assert.match(picker, /reset\(\)/);
});

if (failed) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log("\nAll Fitment Manager identity/isolation/embed checks passed");
