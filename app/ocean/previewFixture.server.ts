import { catalogueFitmentMetafields } from "./metafields.ts";
import { reconcileFitment } from "./reconcile.ts";
import { deriveVerifiedKeys } from "./syncContract.ts";
import { processCatalogueSyncEvent, type SyncAdmin } from "./syncConsumer.ts";

export type PreviewFixtureResult = {
  ok: boolean;
  wrote: boolean;
  shopify_network_writes: number;
  intercepted_writes: number;
  error?: string;
  duplicate?: boolean;
  verified_vehicle_keys?: string[];
  metafields?: ReturnType<typeof catalogueFitmentMetafields>;
  reconciliation?: ReturnType<typeof reconcileFitment>;
  replay?: { duplicate: boolean; wrote: boolean; intercepted_writes: number };
};

function fakeAdmin(intercepted: { count: number }): SyncAdmin {
  return {
    session: { accessToken: "preview-fixture-offline", isOnline: false, expires: null },
    graphql: async () => {
      intercepted.count += 1;
      return {
        status: 200,
        json: async () => ({ data: { metafieldsSet: { userErrors: [] } } }),
      };
    },
  };
}

/** Preview HTTP fixture. The admin client never calls Shopify. */
export async function runPreviewFixture(body: Record<string, unknown>): Promise<PreviewFixtureResult> {
  const event = (body.event && typeof body.event === "object" ? body.event : body) as Record<string, unknown>;
  const operation = String(event.operation || "");
  const derived = deriveVerifiedKeys(event);
  const intercepted = { count: 0 };
  const productId = String(event.shopify_product_id || "0");
  const ownerId = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId || "0"}`;

  if (!derived.ok) {
    return { ok: false, wrote: false, shopify_network_writes: 0, intercepted_writes: 0, error: derived.error };
  }
  if (operation === "full_reconcile" || body.mode === "dry_run") {
    const reconciliation = reconcileFitment({
      ownerId,
      productFound: event.product_missing !== true && Boolean(String(event.shopify_product_id || "").trim()),
      canonicalKeys: derived.keys,
      shopifyKeys: Array.isArray(body.current_keys) ? body.current_keys.map(String) : [],
      shopifyCount: body.current_count == null ? 0 : Number(body.current_count),
      shopifyStatus: body.current_status == null ? "none" : String(body.current_status),
      currentMetafields: (body.current_metafields || null) as never,
    }, "dry_run");
    return {
      ok: event.product_missing === true ? false : true,
      wrote: false,
      shopify_network_writes: 0,
      intercepted_writes: 0,
      error: event.product_missing === true ? "missing_product" : undefined,
      verified_vehicle_keys: derived.keys,
      metafields: catalogueFitmentMetafields(ownerId, derived.keys),
      reconciliation,
    };
  }

  const seen = new Map();
  const admin = fakeAdmin(intercepted);
  const first = await processCatalogueSyncEvent(event, admin, { seen });
  const result: PreviewFixtureResult = {
    ok: first.ok,
    wrote: false,
    shopify_network_writes: 0,
    intercepted_writes: intercepted.count,
    error: first.error,
    duplicate: first.duplicate,
    verified_vehicle_keys: first.verified_vehicle_keys,
    metafields: first.metafields,
  };
  if (body.replay === true) {
    const before = intercepted.count;
    const second = await processCatalogueSyncEvent(event, admin, { seen });
    result.replay = {
      duplicate: Boolean(second.duplicate),
      wrote: false,
      intercepted_writes: intercepted.count - before,
    };
  }
  return result;
}
