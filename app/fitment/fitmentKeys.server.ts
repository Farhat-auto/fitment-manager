import { getSupabaseAdmin } from "../supabase.server";

type AdminGraphql = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

export type VehicleKeyResolution = {
  gid: string;
  vehicle_key: string;
  handle: string;
};

function norm(v: unknown): string {
  return String(v ?? "").trim();
}

function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * Resolve Shopify vehicle metaobject GIDs -> canonical vehicle_key string.
 * Falls back to metaobject field "vehicle_key", then "slug", then system handle.
 */
export async function resolveVehicleKeysFromMetaobjectGids(params: {
  admin: { graphql: AdminGraphql };
  vehicleGids: string[];
}): Promise<VehicleKeyResolution[]> {
  const gids = Array.from(new Set((params.vehicleGids || []).map((x) => norm(x)).filter(Boolean)));
  if (!gids.length) return [];

  const NODES = `#graphql
    query ResolveVehiclesForFitmentKeys($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Metaobject {
          id
          handle
          type
          vehicle_key: field(key: "vehicle_key") { value }
          slug: field(key: "slug") { value }
        }
      }
    }
  `;

  const resp = await params.admin.graphql(NODES, { variables: { ids: gids } });
  const json = await resp.json();
  const nodes = safeArray<any>(json?.data?.nodes);

  const out: VehicleKeyResolution[] = [];
  for (const n of nodes) {
    const gid = norm(n?.id);
    if (!gid) continue;
    const handle = norm(n?.handle);
    const vk = norm(n?.vehicle_key?.value) || norm(n?.slug?.value) || handle;
    if (!vk) continue;
    out.push({ gid, vehicle_key: vk, handle });
  }
  return out;
}

export async function upsertProductFitmentRows(params: {
  shop_domain: string;
  product_id: string; // Shopify Product GID
  vehicle_keys: string[];
}): Promise<{ ok: true; upserted: number }> {
  const shop_domain = norm(params.shop_domain);
  const product_id = norm(params.product_id);
  const vehicle_keys = Array.from(new Set((params.vehicle_keys || []).map((x) => norm(x)).filter(Boolean)));
  if (!shop_domain) throw new Error("Missing shop_domain");
  if (!product_id) throw new Error("Missing product_id");

  const supabase = getSupabaseAdmin();

  // Phase 1 safety: we only upsert rows for keys present; we do NOT delete removed keys yet.
  if (!vehicle_keys.length) return { ok: true, upserted: 0 };

  const { data, error } = await supabase
    .from("product_fitment")
    .upsert(
      vehicle_keys.map((vehicle_key) => ({
        shop_domain,
        product_id,
        vehicle_key,
      })),
      { onConflict: "shop_domain,product_id,vehicle_key" },
    )
    .select("id");

  if (error) throw error;
  return { ok: true, upserted: Array.isArray(data) ? data.length : 0 };
}

export async function countProductFitmentRows(params: {
  shop_domain: string;
  product_id: string;
}): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from("product_fitment")
    .select("id", { count: "exact", head: true })
    .eq("shop_domain", norm(params.shop_domain))
    .eq("product_id", norm(params.product_id));
  if (error) throw error;
  return Number(count ?? 0);
}

/**
 * Writes `custom.fitment_keys` metafield as JSON array string: ["key1","key2",...]
 * Shopify Admin GraphQL expects `value` as a string; for `type: "json"`, pass JSON string.
 */
export async function setShopifyFitmentKeysMetafield(params: {
  admin: { graphql: AdminGraphql };
  productId: string;
  vehicleKeys: string[];
}): Promise<{ ok: true; userErrors: Array<{ field?: string[] | null; message: string }> }> {
  const ownerId = norm(params.productId);
  const vehicleKeys = Array.from(new Set((params.vehicleKeys || []).map((x) => norm(x)).filter(Boolean)));

  const MUT = `#graphql
    mutation SetFitmentKeys($ownerId: ID!, $value: String!) {
      metafieldsSet(
        metafields: [
          {
            ownerId: $ownerId
            namespace: "custom"
            key: "fitment_keys"
            type: "json"
            value: $value
          }
        ]
      ) {
        metafields { id }
        userErrors { field message }
      }
    }
  `;

  const value = JSON.stringify(vehicleKeys);
  const resp = await params.admin.graphql(MUT, { variables: { ownerId, value } });
  const json = await resp.json();
  const userErrors = safeArray<any>(json?.data?.metafieldsSet?.userErrors).map((e) => ({
    field: Array.isArray(e?.field) ? (e.field as string[]) : null,
    message: norm(e?.message) || "Unknown metafield error",
  }));

  return { ok: true, userErrors };
}

