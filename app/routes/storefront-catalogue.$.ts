import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { oceanGet, oceanProductFitmentGet } from "../ocean/client.server";
import { stableIdentity } from "../ocean/identity";
import { classifyCatalogueProducts, systemsFromLinkedProducts } from "../ocean/storefrontClassification.server";
import {
  filterLinkedProducts,
  normalizeStorefrontProducts,
  productGroupsFromLinkedProducts,
  withCanonicalVehicle,
} from "../ocean/storefrontClassification";
import { resolveVehicleKey } from "../ocean/vehicleResolver.server";

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
  "https://oceancarparts-com-2.myshopify.com",
]);

const CHANGING_CATALOGUE = new Set([
  "systems", "assembly-groups", "product-groups", "categories", "products",
  "product", "product-review", "product-fitment", "car-fitment", "fitments",
  "storefront-compatibility", "catalogue-search", "oe-family", "oe",
]);

function routeName(params: Record<string, string | undefined>) {
  return String(params["*"] || "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")[0];
}

function corsHeaders(request: Request, route: string) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://www.oceancarparts.com",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": CHANGING_CATALOGUE.has(route)
      ? "no-store, max-age=0" : "public, max-age=60, stale-while-revalidate=300",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function catalogueJson(payload: any, headers: HeadersInit, vehicleKey = "") {
  return json(vehicleKey ? withCanonicalVehicle(payload, vehicleKey) : payload, { headers });
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
  // Normalize reviewed legacy theme IDs before every vehicle-specific read.
  // Product verification is still taken exclusively from the linked record.
  if (upstream.has("vehicle_key")) {
    upstream.set("vehicle_key", await resolveVehicleKey(upstream.get("vehicle_key") || ""));
  }

  const vehicleKey = upstream.get("vehicle_key") || "";

  if (name === "product-fitment" || name === "car-fitment" || name === "fitments") {
    const resolved = stableIdentity({
      shopify_product_id: upstream.get("shopify_product_id") || "",
      shopify_variant_id: upstream.get("shopify_variant_id") || "",
      sku: upstream.get("sku") || "",
      handle: upstream.get("handle") || "",
      brand: upstream.get("brand") || "",
      mpn: upstream.get("mpn") || "",
    });
    if (!resolved.ok) return catalogueJson(resolved, headers, vehicleKey);
    return catalogueJson(await oceanProductFitmentGet(resolved.identity), headers, vehicleKey);
  }

  if (name === "product") {
    return catalogueJson(await oceanGet("/product-review", upstream.toString()), headers, vehicleKey);
  }

  if (name === "product-groups" && vehicleKey &&
      (upstream.get("assembly_group_id") || upstream.get("system_id"))) {
    const payload = await oceanGet("/product-groups", upstream.toString());
    const vehicleQuery = new URLSearchParams({ vehicle_key: vehicleKey });
    const linked = await oceanGet("/products", vehicleQuery.toString());
    if (!Array.isArray(linked?.products) || !linked.products.length) {
      return catalogueJson(payload, headers, vehicleKey);
    }
    const categorized = await classifyCatalogueProducts(linked.products);
    const systemId = upstream.get("assembly_group_id") || upstream.get("system_id") || "";
    const additions = productGroupsFromLinkedProducts(categorized, systemId);
    if (!additions.length) return catalogueJson(payload, headers, vehicleKey);
    const byId = new Map((Array.isArray(payload?.product_groups) ? payload.product_groups : [])
      .filter((row: any) => row?.id).map((row: any) => [String(row.id), row]));
    for (const row of additions) {
      const existing: any = byId.get(row.id);
      byId.set(row.id, existing ? {
        ...existing,
        pending_fitment_count: Math.max(Number(existing.pending_fitment_count || 0), row.pending_fitment_count),
        article_count: Math.max(Number(existing.article_count || 0), row.article_count),
      } : row);
    }
    return catalogueJson({ ...payload, error: undefined, ok: true, product_groups: [...byId.values()] }, headers, vehicleKey);
  }

  if ((name === "products" || name === "systems") && vehicleKey) {
    // The manager's product category can lag behind Shopify tags. Fetch the
    // explicit vehicle links before filtering, then classify from Shopify.
    const vehicleQuery = new URLSearchParams({ vehicle_key: vehicleKey });
    const payload = await oceanGet(`/${name}`, name === "products" ? vehicleQuery.toString() : upstream.toString());
    if (name === "products") {
      if (!Array.isArray(payload?.products)) return catalogueJson(payload, headers, vehicleKey);
      const classified = await classifyCatalogueProducts(payload.products);
      return catalogueJson({
        ...payload,
        products: normalizeStorefrontProducts(filterLinkedProducts(classified, upstream), vehicleKey),
      }, headers, vehicleKey);
    }
    const linked = await oceanGet("/products", vehicleQuery.toString());
    if (!Array.isArray(linked?.products) || !linked.products.length) {
      return catalogueJson(payload, headers, vehicleKey);
    }
    const categorized = await classifyCatalogueProducts(linked.products);
    const additions = systemsFromLinkedProducts(categorized);
    if (!additions.length) return catalogueJson(payload, headers, vehicleKey);
    const byId = new Map((Array.isArray(payload?.systems) ? payload.systems : [])
      .filter((row: any) => row?.id).map((row: any) => [String(row.id), row]));
    for (const row of additions) {
      const existing: any = byId.get(row.id);
      byId.set(row.id, existing ? {
        ...existing,
        pending_fitment_count: Math.max(Number(existing.pending_fitment_count || 0), row.pending_fitment_count),
      } : row);
    }
    return catalogueJson({ ...payload, error: undefined, ok: true, systems: [...byId.values()] }, headers, vehicleKey);
  }

  return catalogueJson(await oceanGet(`/${name}`, upstream.toString()), headers, vehicleKey);
}
