// Preview branch stays on the recorded catalogue proxy.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { oceanGet, oceanProductFitmentGet } from "../ocean/client.server";
import { stableIdentity } from "../ocean/identity";
import { getProductHandlesByVehicle, resolveShopDomain } from "../fitment/fitment.server";
import { getProductIdsByVehicleKey } from "../fitment/fitmentKeys.server";

const PUBLIC_GET = new Set([
  "makes",
  "manufacturers",
  "models",
  "generations",
  "chassis",
  "engines",
  "types",
  "vehicle-types",
  "vehicle-search",
  "search-vehicles",
  "vehicles",
  "vehicle",
  "vehicle-get",
  "systems",
  "product-groups",
  "assembly-groups",
  "categories",
  "products",
  "product",
  "product-review",
  "analyse",
  "oe-family",
  "oe",
  "catalogue-search",
  "ladder-slice",
  "storefront-compatibility",
  "product-fitment",
  "car-fitment",
  "fitments",
]);

const ALLOWED_ORIGINS = new Set([
  "https://www.oceancarparts.com",
  "https://oceancarparts.com",
  "https://g5uxzq-gb.myshopify.com",
]);

function routeName(params: Record<string, string | undefined>) {
  return String(params["*"] || "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")[0];
}

const CHANGING_CATALOGUE = new Set([
  "systems", "assembly-groups", "product-groups", "categories", "products",
  "product", "product-review", "product-fitment", "car-fitment", "fitments",
  "storefront-compatibility", "catalogue-search", "oe-family", "oe",
]);

function corsHeaders(request: Request, route: string) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://www.oceancarparts.com",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": CHANGING_CATALOGUE.has(route)
      ? "no-store, max-age=0"
      : "public, max-age=60, stale-while-revalidate=300",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const name = routeName(params as Record<string, string | undefined>);
  const headers = corsHeaders(request, name);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET") {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405, headers });
  }

  if (!PUBLIC_GET.has(name)) {
    return json({ ok: false, error: "not_found", path: name }, { status: 404, headers });
  }

  const url = new URL(request.url);
  const upstream = new URLSearchParams();
  url.searchParams.forEach((value, key) => upstream.append(key, value));

  if (name === "product-fitment" || name === "car-fitment" || name === "fitments") {
    const resolved = stableIdentity({
      shopify_product_id: upstream.get("shopify_product_id") || "",
      shopify_variant_id: upstream.get("shopify_variant_id") || "",
      sku: upstream.get("sku") || "",
      handle: upstream.get("handle") || "",
      brand: upstream.get("brand") || "",
      mpn: upstream.get("mpn") || "",
    });
    if (!resolved.ok) return json(resolved, { headers });
    return json(await oceanProductFitmentGet(resolved.identity), { headers });
  }

  if (name === "product") {
    return json(await oceanGet("/product-review", upstream.toString()), { headers });
  }

  // Product compatibility is authoritative in Fitment Manager/Supabase.
  // Do not depend on the external catalogue service to rediscover a
  // vehicle -> Shopify product relationship that the merchant already verified.
  if (name === "products" && upstream.get("vehicle_key")) {
    const vehicleKey = String(upstream.get("vehicle_key") || "").trim();
    const shopDomain =
      upstream.get("shop_domain") ||
      upstream.get("shop") ||
      resolveShopDomain(request) ||
      "g5uxzq-gb.myshopify.com";

    const productIds = await getProductIdsByVehicleKey({
      shop_domain: shopDomain,
      vehicle_key: vehicleKey,
    });
    const legacyHandles = productIds.length ? [] : await getProductHandlesByVehicle({
      shop_domain: shopDomain,
      vehicle_key: vehicleKey,
      subcategory_key:
        upstream.get("subcategory_key") ||
        upstream.get("product_group_id") ||
        upstream.get("category_id") ||
        null,
    });

    if (productIds.length || legacyHandles.length) {
      return json(
        {
          ok: true,
          source: productIds.length ? "product_fitment" : "legacy_fitment",
          shop_domain: shopDomain,
          vehicle_key: vehicleKey,
          product_ids: productIds,
          product_handles: legacyHandles,
          products: [
            ...productIds.map((product_id) => ({
              product_id,
              shopify_product_id: product_id,
              shopify_fitment: true,
              pending_fitment: false,
            })),
            ...legacyHandles.map((handle) => ({
              handle,
              product_handle: handle,
              shopify_fitment: true,
              pending_fitment: false,
            })),
          ],
          confirmed_fitment_count: productIds.length + legacyHandles.length,
          pending_fitment_count: 0,
          count: productIds.length + legacyHandles.length,
        },
        { headers },
      );
    }
    // Fail closed and preserve taxonomy-aware upstream behavior when there are
    // no merchant-confirmed rows for this vehicle/category.
  }

  return json(await oceanGet(`/${name}`, upstream.toString()), { headers });
}
