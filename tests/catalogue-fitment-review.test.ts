import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync("app/routes/api.catalogue-fitment-review.ts", "utf8");
const ui = readFileSync("app/routes/app.catalogue-fitment-review.tsx", "utf8");

assert.match(api, /canonical_vehicle_key_required/);
assert.match(api, /\/\^ovh-\[a-f0-9\]\+\$\/i/);
assert.match(ui, /canonical_vehicle_key_required/);
assert.match(api, /bulk_verify_authoritative/);
assert.match(ui, /value="bulk_verify_authoritative"/);
assert.match(ui, /Verify authoritative candidates only/);
assert.match(ui, /OE and cross-reference data are identity evidence only/);
assert.match(ui, /authoritative application evidence/);
assert.match(api, /oceanGet/);
assert.match(api, /oceanPost/);
assert.doesNotMatch(api, /metafieldsSet/);
assert.match(ui, /Needs review/);
assert.match(ui, /Remove invalid candidate/);
assert.match(ui, /vehicle_active !== false/);
assert.match(ui, /Open product in Shopify/);
assert.match(ui, /trust_class/);
assert.doesNotMatch(ui, /metafieldsSet/);

console.log("PASS catalogue fitment review");
