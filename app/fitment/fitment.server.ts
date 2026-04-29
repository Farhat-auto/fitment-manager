import { z } from "zod";
import { getSupabaseAdmin } from "../supabase.server";

export const FitmentRowInsertSchema = z.object({
  shop_domain: z.string().min(1),

  product_gid: z.string().optional().nullable(),
  product_handle: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  article_number: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),

  vehicle_gid: z.string().optional().nullable(),
  vehicle_handle: z.string().optional().nullable(),
  vehicle_key: z.string().min(1),
  vehicle_display_name: z.string().optional().nullable(),

  category_key: z.string().optional().nullable(),
  system_group_key: z.string().optional().nullable(),
  subcategory_key: z.string().optional().nullable(),

  source: z.string().optional().nullable(),
});

export type FitmentRowInsert = z.infer<typeof FitmentRowInsertSchema>;

export function resolveShopDomain(request: Request): string | null {
  const url = new URL(request.url);
  const qp =
    url.searchParams.get("shop_domain") ??
    url.searchParams.get("shop") ??
    url.searchParams.get("shopDomain");
  const header = request.headers.get("x-shopify-shop-domain");
  return qp ?? header ?? process.env.SHOP_DOMAIN ?? null;
}

export async function getProductHandlesByVehicle(params: {
  shop_domain: string;
  vehicle_key: string;
  subcategory_key?: string | null;
}) {
  const supabase = getSupabaseAdmin();
  const q = supabase
    .from("fitment")
    .select("product_handle")
    .eq("shop_domain", params.shop_domain)
    .eq("vehicle_key", params.vehicle_key)
    .not("product_handle", "is", null);

  const q2 = params.subcategory_key
    ? q.eq("subcategory_key", params.subcategory_key)
    : q;

  const { data, error } = await q2;
  if (error) throw error;

  const handles = Array.from(
    new Set(
      (data ?? [])
        .map((r: any) => (r?.product_handle ? String(r.product_handle) : ""))
        .filter(Boolean),
    ),
  );

  return handles;
}

export async function getFitmentByProductHandle(params: {
  shop_domain: string;
  product_handle: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("fitment")
    .select(
      [
        "shop_domain",
        "product_gid",
        "product_handle",
        "sku",
        "article_number",
        "brand",
        "vehicle_gid",
        "vehicle_handle",
        "vehicle_key",
        "vehicle_display_name",
        "category_key",
        "system_group_key",
        "subcategory_key",
        "source",
        "created_at",
        "updated_at",
      ].join(","),
    )
    .eq("shop_domain", params.shop_domain)
    .eq("product_handle", params.product_handle)
    .order("vehicle_display_name", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function upsertFitmentRows(rows: FitmentRowInsert[]) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("fitment")
    .upsert(
      rows.map((r) => ({
        ...r,
        source: r.source ?? "import",
      })),
      {
        onConflict: "shop_domain,product_handle,vehicle_key,subcategory_key",
      },
    )
    .select("id");

  if (error) throw error;
  return data ?? [];
}

export async function deleteFitmentForProductVehicle(params: {
  shop_domain: string;
  product_handle: string;
  vehicle_key: string;
}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("fitment")
    .delete()
    .eq("shop_domain", params.shop_domain)
    .eq("product_handle", params.product_handle)
    .eq("vehicle_key", params.vehicle_key);

  if (error) throw error;
  return { ok: true as const };
}

export async function getFitmentCountsByProductHandle(params: {
  shop_domain: string;
  product_handles: string[];
}) {
  const handles = (params.product_handles || [])
    .map((h) => String(h || "").trim())
    .filter(Boolean);
  if (!handles.length) return new Map<string, number>();

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("fitment")
    .select("product_handle")
    .eq("shop_domain", params.shop_domain)
    .in("product_handle", handles)
    .not("product_handle", "is", null);

  if (error) throw error;

  const m = new Map<string, number>();
  for (const r of data ?? []) {
    const ph = r?.product_handle ? String(r.product_handle) : "";
    if (!ph) continue;
    m.set(ph, (m.get(ph) ?? 0) + 1);
  }
  return m;
}

