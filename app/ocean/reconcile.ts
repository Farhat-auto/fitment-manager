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

export type ReconciliationInput = {
  ownerId: string;
  productFound: boolean;
  syncFailed?: boolean;
  canonicalKeys: string[];
  shopifyKeys: string[];
  shopifyCount: number | null;
  shopifyStatus: string | null;
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

export function reconcileFitment(input: ReconciliationInput, mode: "dry_run" | "apply" = "dry_run") {
  const report = classifyShopifyFitment(input);
  const canonical = [...new Set(input.canonicalKeys || [])].filter((key) => isVehicleKey(key)).sort();
  if (mode !== "apply" || !input.productFound) {
    return { ...report, mode, applied: false, metafields: null };
  }
  return {
    ...report,
    mode,
    applied: true,
    metafields: catalogueFitmentMetafields(input.ownerId, canonical),
  };
}
