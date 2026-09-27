import assert from "node:assert/strict";
import { runPreviewFixture } from "../app/ocean/previewFixture.server.ts";

const vehicle = "ovh-00000000000000000001";
const candidate = "ovh-00000000000000000002";

function event(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    event_id: "fixture-evt-1",
    canonical_sku: "FIXTURE-OCP-NOT-SHOPIFY",
    shopify_product_id: "0",
    shopify_variant_id: "0",
    operation: "upsert",
    source: "ocean_catalogue",
    timestamp: "2026-09-27T17:45:00Z",
    relationships: [
      { vehicle_key: vehicle, verification_status: "VERIFIED", review_status: "verified" },
      { vehicle_key: candidate, verification_status: "UNVERIFIED", review_status: "candidate" },
    ],
    ...overrides,
  };
}

const accepted = await runPreviewFixture({ mode: "dry_run", event: event() });
assert.equal(accepted.ok, true);
assert.equal(accepted.shopify_network_writes, 0);
assert.equal(accepted.intercepted_writes, 0);
assert.deepEqual(accepted.verified_vehicle_keys, [vehicle]);
assert.equal(JSON.parse(String(accepted.metafields?.[0].value)).includes(candidate), false);
assert.equal(accepted.metafields?.[2].value, "1");
assert.equal(accepted.metafields?.[3].value, "verified");
assert.equal(accepted.reconciliation?.applied, false);
assert.equal(accepted.reconciliation?.rollback_manifest.shopify_product_id, "gid://shopify/Product/0");

const invalid = await runPreviewFixture({ event: event({ schema_version: 99 }) });
assert.equal(invalid.ok, false);
assert.equal(invalid.error, "unsupported_schema");
assert.equal(invalid.shopify_network_writes, 0);

const replay = await runPreviewFixture({ replay: true, event: event({ event_id: "fixture-replay" }) });
assert.equal(replay.ok, true);
assert.equal(replay.shopify_network_writes, 0);
assert.equal(replay.intercepted_writes, 1);
assert.equal(replay.replay?.duplicate, true);
assert.equal(replay.replay?.wrote, false);
assert.equal(replay.replay?.intercepted_writes, 0);

const removed = await runPreviewFixture({
  event: event({
    event_id: "fixture-remove",
    operation: "remove",
    relationships: [{ vehicle_key: vehicle, verification_status: "UNVERIFIED", review_status: "candidate" }],
  }),
});
assert.equal(removed.ok, true);
assert.equal(removed.shopify_network_writes, 0);
assert.deepEqual(removed.verified_vehicle_keys, []);
assert.equal(removed.metafields?.[3].value, "none");

const reconcile = await runPreviewFixture({
  event: event({ event_id: "fixture-full", operation: "full_reconcile" }),
  current_keys: [],
  current_count: 0,
  current_status: "none",
  current_metafields: {
    verified_vehicle_keys: "[]",
    fitment_keys: "[]",
    fitment_count: "0",
    fitment_status: "none",
  },
});
assert.equal(reconcile.ok, true);
assert.equal(reconcile.shopify_network_writes, 0);
assert.equal(reconcile.intercepted_writes, 0);
assert.equal(reconcile.reconciliation?.mode, "dry_run");
assert.equal(reconcile.reconciliation?.applied, false);
assert.equal(reconcile.reconciliation?.rollback_manifest.before.fitment_status, "none");
assert.equal(reconcile.reconciliation?.rollback_manifest.after.fitment_status, "verified");

const missing = await runPreviewFixture({
  event: event({ event_id: "fixture-missing", shopify_product_id: "", product_missing: true }),
});
assert.equal(missing.ok, false);
assert.equal(missing.error, "missing_product");
assert.equal(missing.shopify_network_writes, 0);
assert.equal(missing.intercepted_writes, 0);

console.log("PASS preview fixture");
