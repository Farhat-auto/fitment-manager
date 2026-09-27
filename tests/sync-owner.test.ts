import assert from "node:assert/strict";
import { catalogueFitmentMetafields } from "../app/ocean/metafields.ts";
import { classifyShopifyFitment, reconcileFitment } from "../app/ocean/reconcile.ts";
import { deriveVerifiedKeys } from "../app/ocean/syncContract.ts";
import { processCatalogueSyncEvent, type SyncAdmin } from "../app/ocean/syncConsumer.ts";
import { METAFIELDS_SET } from "../app/ocean/metafields.ts";

const owner = "gid://shopify/Product/100";
const verified = "ovh-11c5baf33d0d9d77cfbb";
const other = "ovh-f37b24b99a8b17119f28";

function event(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    event_id: "evt-1",
    canonical_sku: "TEST-OCP-SYNC",
    shopify_product_id: "100",
    shopify_variant_id: "200",
    operation: "upsert",
    source: "ocean_catalogue",
    timestamp: "2026-09-27T17:00:00Z",
    relationships: [
      { vehicle_key: verified, verification_status: "VERIFIED", review_status: "verified" },
      { vehicle_key: other, verification_status: "UNVERIFIED", review_status: "candidate" },
    ],
    verified_vehicle_keys: [verified, other],
    metafields: undefined,
    ...overrides,
  };
}

function admin(handler: (query: string, variables: unknown) => { status?: number; body?: Record<string, unknown> }): SyncAdmin {
  return {
    session: { accessToken: "offline-session", isOnline: false, expires: null },
    graphql: async (query, options) => {
      const result = handler(query, options?.variables);
      return { status: result.status || 200, json: async () => result.body || { data: { metafieldsSet: { userErrors: [] } } } };
    },
  };
}

const derived = deriveVerifiedKeys(event());
assert.equal(derived.ok, true);
if (derived.ok) assert.deepEqual(derived.keys, [verified]);

const blinded = deriveVerifiedKeys(event({ metafields: [{ key: "verified_vehicle_keys", value: "[]" }] }));
assert.equal(blinded.ok, false);
if (!blinded.ok) assert.equal(blinded.error, "untrusted_metafield_payload");

const fields = catalogueFitmentMetafields(owner, derived.ok ? derived.keys : []);
assert.deepEqual(fields.map((field) => field.namespace + "." + field.key), [
  "ocean.verified_vehicle_keys",
  "custom.fitment_keys",
  "ocean.fitment_count",
  "ocean.fitment_status",
]);
assert.equal(fields[2].value, "1");
assert.equal(fields[3].value, "verified");
assert.equal(JSON.parse(fields[0].value).includes(other), false);
assert.match(METAFIELDS_SET, /metafieldsSet/);

const seen = new Map();
let writes = 0;
const client = admin(() => {
  writes += 1;
  return { status: 200 };
});
const first = await processCatalogueSyncEvent(event(), client, { seen });
assert.equal(first.ok, true);
assert.equal(first.wrote, true);
assert.deepEqual(first.verified_vehicle_keys, [verified]);
const second = await processCatalogueSyncEvent(event(), client, { seen });
assert.equal(second.duplicate, true);
assert.equal(second.wrote, false);
assert.equal(writes, 1);

const removed = await processCatalogueSyncEvent(event({
  event_id: "evt-remove",
  operation: "remove",
  relationships: [{ vehicle_key: verified, verification_status: "UNVERIFIED", review_status: "candidate" }],
}), client, { seen });
assert.deepEqual(removed.verified_vehicle_keys, []);
assert.equal(removed.metafields?.[2].value, "0");
assert.equal(removed.metafields?.[3].value, "none");

const reconciled = reconcileFitment({
  ownerId: owner,
  productFound: true,
  canonicalKeys: [verified],
  shopifyKeys: [],
  shopifyCount: 0,
  shopifyStatus: "none",
}, "dry_run");
assert.equal(reconciled.classification, "shopify_missing_fitments");
assert.equal(reconciled.applied, false);
const applied = reconcileFitment({
  ownerId: owner,
  productFound: true,
  canonicalKeys: [verified],
  shopifyKeys: [verified, "ovh-aaaaaaaaaaaaaaaaaaaa"],
  shopifyCount: 2,
  shopifyStatus: "verified",
}, "apply");
assert.equal(applied.classification, "shopify_stale_fitments");
assert.equal(applied.applied, true);
assert.equal(JSON.parse(String(applied.metafields?.[0].value)).includes("ovh-aaaaaaaaaaaaaaaaaaaa"), false);

assert.equal(classifyShopifyFitment({
  ownerId: owner, productFound: true, canonicalKeys: [verified], shopifyKeys: [verified], shopifyCount: 2, shopifyStatus: "verified",
}).classification, "wrong_count");
assert.equal(classifyShopifyFitment({
  ownerId: owner, productFound: true, canonicalKeys: [verified], shopifyKeys: [verified], shopifyCount: 1, shopifyStatus: "Fitment: 1 vehicles",
}).classification, "wrong_status");
assert.equal(classifyShopifyFitment({
  ownerId: owner, productFound: true, canonicalKeys: [], shopifyKeys: ["516118249815"], shopifyCount: 1, shopifyStatus: "none",
}).classification, "invalid_vehicle_key");
assert.equal(classifyShopifyFitment({
  ownerId: owner, productFound: false, canonicalKeys: [verified], shopifyKeys: [], shopifyCount: null, shopifyStatus: null,
}).classification, "product_missing");
assert.equal(classifyShopifyFitment({
  ownerId: owner, productFound: true, syncFailed: true, canonicalKeys: [verified], shopifyKeys: [verified], shopifyCount: 1, shopifyStatus: "verified",
}).classification, "sync_failed");
assert.equal(classifyShopifyFitment({
  ownerId: owner, productFound: true, canonicalKeys: [], shopifyKeys: [], shopifyCount: 0, shopifyStatus: "none",
}).classification, "in_sync");

let attempts = 0;
const limited = admin(() => {
  attempts += 1;
  return { status: attempts < 3 ? 429 : 200 };
});
const retried = await processCatalogueSyncEvent(event({ event_id: "evt-429" }), limited, { seen, maxAttempts: 3 });
assert.equal(retried.ok, true);
assert.equal(retried.attempts, 3);

attempts = 0;
const serverError = admin(() => {
  attempts += 1;
  return { status: 503 };
});
const failed = await processCatalogueSyncEvent(event({ event_id: "evt-5xx" }), serverError, { seen, maxAttempts: 2 });
assert.equal(failed.error, "shopify_5xx");
assert.equal(failed.attempts, 2);

const expired = await processCatalogueSyncEvent(event({ event_id: "evt-expired" }), {
  session: { accessToken: "offline-session", isOnline: false, expires: "2000-01-01T00:00:00Z" },
  graphql: async () => ({ status: 200, json: async () => ({}) }),
}, { seen });
assert.equal(expired.error, "expired_session");
assert.equal(expired.wrote, false);

const invalid = await processCatalogueSyncEvent(event({ event_id: "evt-invalid" }), {
  session: { accessToken: "", isOnline: false, expires: null },
  graphql: async () => ({ status: 200, json: async () => ({}) }),
}, { seen });
assert.equal(invalid.error, "invalid_session");

const missing = await processCatalogueSyncEvent(event({ event_id: "evt-missing", product_missing: true }), client, { seen });
assert.equal(missing.error, "missing_product");
const deleted = await processCatalogueSyncEvent(event({ event_id: "evt-deleted", product_deleted: true }), client, { seen });
assert.equal(deleted.error, "deleted_product");

const duplicateSkuA = await processCatalogueSyncEvent(event({
  event_id: "evt-sku-a",
  shopify_product_id: "111",
  canonical_sku: "SAME-SKU",
}), client, { seen });
const duplicateSkuB = await processCatalogueSyncEvent(event({
  event_id: "evt-sku-b",
  shopify_product_id: "222",
  canonical_sku: "SAME-SKU",
  relationships: [{ vehicle_key: other, verification_status: "VERIFIED", review_status: "verified" }],
}), client, { seen });
assert.equal(duplicateSkuA.metafields?.[0].ownerId, "gid://shopify/Product/111");
assert.equal(duplicateSkuB.metafields?.[0].ownerId, "gid://shopify/Product/222");
assert.notEqual(duplicateSkuA.verified_vehicle_keys?.[0], duplicateSkuB.verified_vehicle_keys?.[0]);

const zero = await processCatalogueSyncEvent(event({
  event_id: "evt-zero",
  operation: "full_reconcile",
  relationships: [],
}), client, { seen });
assert.deepEqual(zero.verified_vehicle_keys, []);
assert.equal(zero.metafields?.[0].value, "[]");
assert.equal(zero.metafields?.[1].value, "[]");
assert.equal(zero.metafields?.[2].value, "0");

console.log("PASS fitment manager sync owner");
