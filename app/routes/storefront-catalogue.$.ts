import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { oceanGet, oceanProductFitmentGet } from "../ocean/client.server";
import { stableIdentity } from "../ocean/identity";

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

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://www.oceancarparts.com",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET") {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405, headers });
  }

  const name = routeName(params as Record<string, string | undefined>);
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

  return json(await oceanGet(`/${name}`, upstream.toString()), { headers });
}
