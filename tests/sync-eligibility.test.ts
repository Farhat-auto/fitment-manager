import assert from "node:assert/strict";
import { deriveVerifiedKeys } from "../app/ocean/syncContract.ts";
import { processCatalogueSyncEvent, type SyncAdmin } from "../app/ocean/syncConsumer.ts";
import { reconcileFitment } from "../app/ocean/reconcile.ts";

const canonical = "ovh-d1bd300d05c7a189edd8";
const unknown = "ovh-aaaaaaaaaaaaaaaaaaaa";
const legacy = "bmw-1-series-coupe-e82-135-i-n54-b30-a-n55-b30-a-225-kw-306-hp-3000-cc-petrol-coupe-10-2007-10-2013";
const owner = "gid://shopify/Product/0";

function event(relationships: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    event_id: "elig-1",
    canonical_sku: "FIXTURE-OCP-NOT-SHOPIFY",
    shopify_product_id: "0",
    operation: "upsert",
    source: "ocean_catalogue",
    timestamp: "2026-09-27T18:00:00Z",
    canonical_vehicle_keys: [canonical],
    relationships,
    ...extra,
  };
}

const admin: SyncAdmin = {
  session: { accessToken: "offline-session", isOnline: false, expires: null },
  graphql: async () => {
    throw new Error("shopify write must not run");
  },
};

const eligible = deriveVerifiedKeys(event([
  { vehicle_key: canonical, verification_status: "VERIFIED", review_status: "verified" },
]));
assert.equal(eligible.ok, true);
if (eligible.ok) assert.deepEqual(eligible.keys, [canonical]);

const slug = deriveVerifiedKeys(event([
  { vehicle_key: legacy, state: "manually_verified", verification_status: "VERIFIED", review_status: "verified" },
]));
assert.equal(slug.ok, true);
if (slug.ok) {
  assert.deepEqual(slug.keys, []);
  assert.deepEqual(slug.legacy_verified_review_required, [legacy]);
}

const missingKey = deriveVerifiedKeys(event([
  { vehicle_key: unknown, verification_status: "VERIFIED", review_status: "verified" },
]));
assert.equal(missingKey.ok, true);
if (missingKey.ok) {
  assert.deepEqual(missingKey.keys, []);
  assert.deepEqual(missingKey.unknown_vehicle_review_required, [unknown]);
}

const candidate = deriveVerifiedKeys(event([
  { vehicle_key: canonical, verification_status: "UNVERIFIED", review_status: "candidate" },
]));
assert.equal(candidate.ok, true);
if (candidate.ok) assert.deepEqual(candidate.keys, []);

const rejected = deriveVerifiedKeys(event([
  { vehicle_key: canonical, verification_status: "REJECTED", review_status: "rejected", state: "rejected" },
]));
assert.equal(rejected.ok, true);
if (rejected.ok) assert.deepEqual(rejected.keys, []);

const held = await processCatalogueSyncEvent(event([
  { vehicle_key: legacy, state: "manually_verified", verification_status: "VERIFIED" },
], { event_id: "elig-hold" }), admin);
assert.equal(held.wrote, false);
assert.equal(held.held, true);
assert.deepEqual(held.legacy_verified_review_required, [legacy]);

const dry = reconcileFitment({
  ownerId: owner,
  productFound: true,
  canonicalKeys: [],
  legacyReviewKeys: [legacy],
  shopifyKeys: [],
  shopifyCount: 0,
  shopifyStatus: "none",
}, "dry_run");
assert.deepEqual(dry.legacy_verified_review_required, [legacy]);
assert.equal(dry.applied, false);
assert.equal(JSON.parse(dry.rollback_manifest.after.verified_vehicle_keys).includes(legacy), false);

const preserved = reconcileFitment({
  ownerId: owner,
  productFound: true,
  canonicalKeys: [],
  legacyReviewKeys: [legacy],
  shopifyKeys: [legacy],
  shopifyCount: 1,
  shopifyStatus: "verified",
  currentMetafields: {
    verified_vehicle_keys: JSON.stringify([legacy]),
    fitment_keys: JSON.stringify([legacy]),
    fitment_count: "1",
    fitment_status: "verified",
  },
}, "dry_run");
assert.deepEqual(preserved.legacy_verified_review_required, [legacy]);
assert.equal(preserved.classification, "in_sync");
assert.equal(JSON.parse(preserved.rollback_manifest.after.verified_vehicle_keys).includes(legacy), true);
assert.equal(preserved.applied, false);

console.log("PASS sync eligibility");
