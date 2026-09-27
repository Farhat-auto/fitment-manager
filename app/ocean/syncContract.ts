/** Catalogue → Fitment Manager sync contract, schema 1. */

export const SYNC_SCHEMA_VERSION = 1;
export const SYNC_OPERATIONS = ["upsert", "remove", "full_reconcile"] as const;
const VEHICLE_KEY = /^ovh-[a-f0-9]+$/i;

export type SyncDeriveResult =
  | {
      ok: true;
      keys: string[];
      legacy_verified_review_required: string[];
      unknown_vehicle_review_required: string[];
    }
  | { ok: false; error: string };

const APPROVED_STATES = new Set(["verified", "imported_verified", "manually_verified"]);

function relationshipEligible(row: Record<string, unknown>) {
  const status = String(row.verification_status || "").trim().toUpperCase();
  const review = String(row.review_status || "").trim().toLowerCase();
  const state = String(row.state || "").trim().toLowerCase();
  const rejected = status === "REJECTED" || review === "rejected" || state === "rejected";
  const verified = !rejected && (status === "VERIFIED" || review === "verified" || APPROVED_STATES.has(state));
  return { verified, rejected };
}

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
  const canonical = new Set(
    (Array.isArray(body.canonical_vehicle_keys) ? body.canonical_vehicle_keys : [])
      .map((value) => String(value || "").trim())
      .filter((value) => VEHICLE_KEY.test(value)),
  );
  const keys: string[] = [];
  const legacy: string[] = [];
  const unknown: string[] = [];
  for (const row of body.relationships as Array<Record<string, unknown>>) {
    const decision = relationshipEligible(row);
    if (!decision.verified) continue;
    const key = String(row.vehicle_key || "").trim();
    if (!VEHICLE_KEY.test(key)) {
      if (key && !legacy.includes(key)) legacy.push(key);
      continue;
    }
    if (!canonical.has(key)) {
      if (!unknown.includes(key)) unknown.push(key);
      continue;
    }
    if (!keys.includes(key)) keys.push(key);
  }
  keys.sort();
  legacy.sort();
  unknown.sort();
  return {
    ok: true,
    keys,
    legacy_verified_review_required: legacy,
    unknown_vehicle_review_required: unknown,
  };
}

export function isVehicleKey(value: string) {
  return VEHICLE_KEY.test(String(value || "").trim());
}
