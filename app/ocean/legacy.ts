/**
 * Old Shopify vehicle compatibility structures. Keep them. Stop writing.
 *
 * Ocean vehicle_id / product_fitment is the forward architecture.
 * These Shopify objects are LEGACY and must not receive new compatibility.
 */
export const LEGACY_SHOPIFY_VEHICLE_SYSTEM = {
  status: "LEGACY",
  structures: [
    "custom.compatible_vehicles",
    "fitment.vehicles",
    "vehicle metaobjects",
  ],
  writesEnabled: false,
  authority: "ocean.product_fitment → ocean.vehicle_id",
  metafieldsAllowed: ["ocean.fitment_count", "ocean.fitment_status", "ocean.zero_fitment"],
} as const;

export function rejectLegacyVehicleWrite(target: string) {
  return {
    ok: false,
    error: "legacy_shopify_vehicle_writes_disabled",
    target,
    status: "LEGACY",
    message:
      "New compatibility is stored as Ocean product_fitment → vehicle_id. Legacy Shopify vehicle metafields and metaobjects are retained read-only.",
  };
}

export const STATUS_METAFIELDS = ["fitment_count", "fitment_status", "zero_fitment"] as const;
