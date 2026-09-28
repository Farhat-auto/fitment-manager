import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(rel: string) {
  return readFileSync(rel, "utf8");
}

const nav = source("app/routes/app.tsx");
const home = source("app/routes/app._index.tsx");
const settings = source("app/routes/app.settings.tsx");
const vehicles = source("app/routes/app.vehicle-catalogue.tsx");
const quality = source("app/routes/app.catalogue-quality.tsx");
const sync = source("app/routes/app.sync.tsx");
const importer = source("app/routes/app.application-import.tsx");
const product = source("app/routes/app.products.$productId.tsx");
const review = source("app/routes/app.catalogue-fitment-review.tsx");

assert.match(nav, /Dashboard/);
assert.match(nav, /Vehicle Catalogue/);
assert.match(nav, /Fitment Review/);
assert.match(nav, /Catalogue Quality/);
assert.match(nav, /to="\/app\/application-import"/);
assert.match(nav, /to="\/app\/sync"/);
assert.doesNotMatch(nav, /to="\/app\/images"/);

assert.match(home, /oceanGet\("\/catalogue-coverage"\)/);
assert.match(home, /oceanGet\("\/catalogue-quality"\)/);
assert.match(home, /Review Fitments/);
assert.match(home, /Browse Vehicle Catalogue/);
assert.match(home, /Import Application Data/);
assert.match(home, /title="Dashboard"/);

assert.match(settings, /Catalogue API connection/);
assert.match(settings, /Canonical vehicle system/);
assert.match(settings, /Shopify metafield sync/);
assert.match(settings, /Legacy Shopify fitment — read only/);
assert.match(settings, /fitment\.vehicles/);
assert.doesNotMatch(settings, /title="LEGACY Shopify vehicle system"/);
assert.ok(settings.indexOf("Catalogue API connection") < settings.indexOf("Legacy Shopify fitment"));

assert.match(vehicles, /oceanGet\("\/makes"\)/);
assert.match(vehicles, /\/api\/ocean/);
assert.match(vehicles, /Canonical key/);
assert.doesNotMatch(vehicles, /metaobject/);

assert.match(quality, /oceanGet\("\/catalogue-quality"\)/);
assert.match(quality, /Authoritative candidates/);
assert.match(quality, /Legacy vehicle keys/);
assert.match(quality, /Unknown vehicle keys/);
assert.match(quality, /catalogue-fitment-review/);

assert.match(sync, /Catalogue → Fitment Manager → Shopify/);
assert.match(sync, /ocean\.verified_vehicle_keys/);
assert.match(sync, /stale_pending_sync_events/);
assert.match(sync, /shopify_sync_failures/);
assert.doesNotMatch(sync, /metafieldsSet/);

assert.match(importer, /import_applications/);
assert.match(importer, /oceanPost\("\/fitment-review"/);
assert.doesNotMatch(importer, /allow_supplier_verify/);
assert.match(importer, /OE equality/);

assert.match(product, /Open Fitment Review/);
assert.match(product, /oceanGet\("\/fitment-review"/);
assert.match(product, /Assembly/);
assert.match(product, /ocean\.fitment_count/);
assert.match(review, /canonical_vehicle_key_required/);
assert.match(review, /Verify authoritative candidates only/);

const products = source("app/routes/app.products.tsx");
assert.match(products, /Open product/);
assert.match(products, /Fitment Review/);
assert.match(products, /catalogue-fitment-review/);

console.log("PASS admin navigation");
