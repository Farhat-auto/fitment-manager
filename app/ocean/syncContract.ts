/** Catalogue → Fitment Manager sync contract, schema 1. */

export const SYNC_SCHEMA_VERSION = 1;
export const SYNC_OPERATIONS = ["upsert", "remove", "full_reconcile"] as const;
const VEHICLE_KEY = /^ovh-[a-f0-9]+$/i;

export type SyncDeriveResult =
  | { ok: true; keys: string[] }
  | { ok: false; error: string };

export function deriveVerifiedKeys(event: unknown): SyncDeriveResult {
  const body = (event || {}) as Record<string, unknown>;
  if (body.metafields || body.metafield_payload) {
    return { ok: false, error: "untrusted_metafield_payload" };
  }
  if (body.schema_version !== SYNC_SCHEMA_VERSION) {
    return { ok: false, error: "unsupported_schema" };
  }
  const operation = String(body.operation || "");
  if (!SYNC_OPERATIONS.includes(operation as (typeof SYNC_OPERATIONS)[number])) {
    return { ok: false, error: "unknown_operation" };
  }
  if (!Array.isArray(body.relationships)) {
    return { ok: false, error: "missing_relationships" };
  }
  const keys: string[] = [];
  for (const row of body.relationships as Array<Record<string, unknown>>) {
    const status = String(row.verification_status || "").trim().toUpperCase();
    const review = String(row.review_status || "").trim().toLowerCase();
    if (status !== "VERIFIED" && review !== "verified") continue;
    const key = String(row.vehicle_key || "").trim();
    if (!VEHICLE_KEY.test(key)) return { ok: false, error: "invalid_vehicle_key" };
    if (!keys.includes(key)) keys.push(key);
  }
  keys.sort();
  return { ok: true, keys };
}

export function isVehicleKey(value: string) {
  return VEHICLE_KEY.test(String(value || "").trim());
}
