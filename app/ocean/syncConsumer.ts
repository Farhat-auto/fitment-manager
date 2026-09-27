import { METAFIELDS_SET, catalogueFitmentMetafields } from "./metafields.ts";
import { deriveVerifiedKeys } from "./syncContract.ts";

export type SyncAdmin = {
  session?: { accessToken?: string; isOnline?: boolean; expires?: string | null };
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<{
    status?: number;
    json: () => Promise<Record<string, unknown>>;
  }>;
};

export type SyncResult = {
  ok: boolean;
  wrote: boolean;
  duplicate: boolean;
  error?: string;
  attempts?: number;
  verified_vehicle_keys?: string[];
  metafields?: ReturnType<typeof catalogueFitmentMetafields>;
  retryable?: boolean;
};

const memory = new Map<string, SyncResult>();

export function sessionProblem(admin: SyncAdmin | null | undefined) {
  if (!admin || !admin.session) return "missing_session";
  if (!admin.session.accessToken) return "invalid_session";
  if (admin.session.isOnline) return "online_session_not_offline";
  if (admin.session.expires && Date.parse(admin.session.expires) < Date.now()) return "expired_session";
  return "";
}

function ownerId(productId: string) {
  return productId.startsWith("gid://shopify/Product/")
    ? productId
    : `gid://shopify/Product/${productId}`;
}

export async function processCatalogueSyncEvent(
  event: Record<string, unknown>,
  admin: SyncAdmin,
  options: { seen?: Map<string, SyncResult>; maxAttempts?: number } = {},
): Promise<SyncResult> {
  const seen = options.seen || memory;
  const eventId = String(event.event_id || "");
  if (eventId && seen.has(eventId)) {
    return { ...seen.get(eventId), duplicate: true, wrote: false };
  }
  const problem = sessionProblem(admin);
  if (problem) return { ok: false, wrote: false, duplicate: false, error: problem };
  const derived = deriveVerifiedKeys(event);
  if (!derived.ok) return { ok: false, wrote: false, duplicate: false, error: derived.error };
  const productId = String(event.shopify_product_id || "").trim();
  if (!productId || event.product_missing === true) {
    return { ok: false, wrote: false, duplicate: false, error: "missing_product" };
  }
  if (event.product_deleted === true) {
    return { ok: false, wrote: false, duplicate: false, error: "deleted_product" };
  }
  const metafields = catalogueFitmentMetafields(ownerId(productId), derived.keys);
  const maxAttempts = options.maxAttempts ?? 3;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    let response: { status?: number; json: () => Promise<Record<string, unknown>> };
    try {
      response = await admin.graphql(METAFIELDS_SET, { variables: { metafields } });
    } catch (error) {
      if (attempt >= maxAttempts) {
        return { ok: false, wrote: false, duplicate: false, error: "sync_failed", attempts: attempt, retryable: false };
      }
      continue;
    }
    const status = Number(response.status || 200);
    if (status === 429 || status >= 500) {
      if (attempt >= maxAttempts) {
        return {
          ok: false,
          wrote: false,
          duplicate: false,
          error: status === 429 ? "shopify_429" : "shopify_5xx",
          attempts: attempt,
          retryable: false,
        };
      }
      continue;
    }
    if (status === 401 || status === 403) {
      return { ok: false, wrote: false, duplicate: false, error: "expired_session", attempts: attempt };
    }
    const body = await response.json();
    const userErrors = ((body.data as { metafieldsSet?: { userErrors?: Array<{ message?: string }> } })?.metafieldsSet?.userErrors) || [];
    if (userErrors.length) {
      const message = userErrors.map((item) => item.message || "").join(" ");
      if (/not found|deleted/i.test(message)) {
        return { ok: false, wrote: false, duplicate: false, error: "deleted_product", attempts: attempt };
      }
      return { ok: false, wrote: false, duplicate: false, error: "sync_failed", attempts: attempt };
    }
    const result: SyncResult = {
      ok: true,
      wrote: true,
      duplicate: false,
      attempts: attempt,
      verified_vehicle_keys: derived.keys,
      metafields,
    };
    if (eventId) seen.set(eventId, result);
    return result;
  }
  return { ok: false, wrote: false, duplicate: false, error: "sync_failed", attempts: attempt };
}
