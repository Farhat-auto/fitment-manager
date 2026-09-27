import { catalogueFitmentMetafields } from "./metafields.ts";
import { isVehicleKey } from "./syncContract.ts";

export type ReconciliationClass =
  | "in_sync"
  | "shopify_missing_fitments"
  | "shopify_stale_fitments"
  | "wrong_count"
  | "wrong_status"
  | "invalid_vehicle_key"
  | "product_missing"
  | "sync_failed";

export type MetafieldSnapshot = {
  verified_vehicle_keys: string;
  fitment_keys: string;
  fitment_count: string;
  fitment_status: string;
};

export type RollbackManifest = {
  shopify_product_id: string;
  before: MetafieldSnapshot;
  after: MetafieldSnapshot;
};

export type ReconciliationInput = {
  ownerId: string;
  productFound: boolean;
  syncFailed?: boolean;
  canonicalKeys: string[];
  shopifyKeys: string[];
  shopifyCount: number | null;
  shopifyStatus: string | null;
  currentMetafields?: Partial<MetafieldSnapshot> | null;
  rollbackManifest?: RollbackManifest | null;
};

export function classifyShopifyFitment(input: ReconciliationInput) {
  if (!input.productFound) {
    return { classification: "product_missing" as ReconciliationClass, missing: [], stale: [], invalid: [] };
  }
  if (input.syncFailed) {
    return { classification: "sync_failed" as ReconciliationClass, missing: [], stale: [], invalid: [] };
  }
  const shopifyKeys = (input.shopifyKeys || []).map((value) => String(value || "").trim()).filter(Boolean);
  const invalid = shopifyKeys.filter((key) => !isVehicleKey(key));
  if (invalid.length) {
    return { classification: "invalid_vehicle_key" as ReconciliationClass, missing: [], stale: [], invalid };
  }
  const canonical = [...new Set(input.canonicalKeys || [])].sort();
  const shopify = [...new Set(shopifyKeys)].sort();
  const missing = canonical.filter((key) => !shopify.includes(key));
  const stale = shopify.filter((key) => !canonical.includes(key));
  if (missing.length) {
    return { classification: "shopify_missing_fitments" as ReconciliationClass, missing, stale, invalid: [] };
  }
  if (stale.length) {
    return { classification: "shopify_stale_fitments" as ReconciliationClass, missing, stale, invalid: [] };
  }
  if (Number(input.shopifyCount) !== canonical.length) {
    return { classification: "wrong_count" as ReconciliationClass, missing, stale, invalid: [] };
  }
  const expected = canonical.length ? "verified" : "none";
  if (String(input.shopifyStatus || "none") !== expected) {
    return { classification: "wrong_status" as ReconciliationClass, missing, stale, invalid: [] };
  }
  return { classification: "in_sync" as ReconciliationClass, missing, stale, invalid: [] };
}

function text(value: unknown) {
  return value == null ? "" : String(value);
}

export function buildRollbackManifest(input: ReconciliationInput): RollbackManifest {
  const canonical = [...new Set(input.canonicalKeys || [])].filter((key) => isVehicleKey(key)).sort();
  const afterFields = catalogueFitmentMetafields(input.ownerId, canonical);
  const after = Object.fromEntries(afterFields.map((field) => [field.key, field.value])) as MetafieldSnapshot;
  const current = input.currentMetafields || {};
  const beforeKeys = JSON.stringify([...(input.shopifyKeys || [])].map((key) => String(key || "").trim()).filter(Boolean));
  return {
    shopify_product_id: input.ownerId,
    before: {
      verified_vehicle_keys: text(current.verified_vehicle_keys ?? beforeKeys),
      fitment_keys: text(current.fitment_keys ?? beforeKeys),
      fitment_count: text(current.fitment_count ?? input.shopifyCount),
      fitment_status: text(current.fitment_status ?? input.shopifyStatus),
    },
    after: {
      verified_vehicle_keys: after.verified_vehicle_keys,
      fitment_keys: after.fitment_keys,
      fitment_count: after.fitment_count,
      fitment_status: after.fitment_status,
    },
  };
}

export function reconcileFitment(input: ReconciliationInput, mode: "dry_run" | "apply" = "dry_run") {
  const report = classifyShopifyFitment(input);
  const canonical = [...new Set(input.canonicalKeys || [])].filter((key) => isVehicleKey(key)).sort();
  const rollback_manifest = buildRollbackManifest(input);
  if (mode !== "apply" || !input.productFound) {
    return { ...report, mode, applied: false, metafields: null, rollback_manifest };
  }
  if (!input.rollbackManifest) {
    return {
      ...report,
      mode,
      applied: false,
      metafields: null,
      rollback_manifest,
      error: "rollback_manifest_required",
    };
  }
  if (input.rollbackManifest.shopify_product_id !== input.ownerId) {
    return {
      ...report,
      mode,
      applied: false,
      metafields: null,
      rollback_manifest,
      error: "rollback_manifest_product_mismatch",
    };
  }
  return {
    ...report,
    mode,
    applied: true,
    metafields: catalogueFitmentMetafields(input.ownerId, canonical),
    rollback_manifest,
  };
}
