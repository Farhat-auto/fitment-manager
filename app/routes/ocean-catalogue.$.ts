import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { oceanGet, oceanProductFitmentGet } from "../ocean/client.server";
import { stableIdentity } from "../ocean/identity";
import { resolveVehicleKey } from "../ocean/vehicleResolver.server";
import { classifyCatalogueProducts, systemsFromLinkedProducts } from "../ocean/storefrontClassification.server";
import { filterLinkedProducts, productGroupsFromLinkedProducts } from "../ocean/storefrontClassification";

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
  "catalogue-search",
  "ladder-slice",
  "storefront-compatibility",
  "product-fitment",
  "car-fitment",
  "fitments",
]);

function routeName(params: { "*": string } | Record<string, string | undefined>) {
  return String(params["*"] || "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")[0];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request);

  const name = routeName(params as { "*": string });
  if (!PUBLIC_GET.has(name)) {
    return json({ ok: false, error: "not_found", path: name }, { status: 404 });
  }

  const url = new URL(request.url);
  const upstream = new URLSearchParams(url.searchParams);
  upstream.delete("signature");
  upstream.delete("shop");
  upstream.delete("timestamp");
  upstream.delete("logged_in_customer_id");
  upstream.delete("path_prefix");
  // This authenticated Shopify app proxy is the draft theme's API entrypoint.
  // Keep its vehicle and product classification identical to the direct
  // storefront endpoint so the theme does not retain stale category counts.
  if (upstream.has("vehicle_key")) {
    upstream.set("vehicle_key", await resolveVehicleKey(upstream.get("vehicle_key") || ""));
  }

  if (name === "product-fitment" || name === "car-fitment" || name === "fitments") {
    const resolved = stableIdentity({
      shopify_product_id: upstream.get("shopify_product_id") || "",
      shopify_variant_id: upstream.get("shopify_variant_id") || "",
      sku: upstream.get("sku") || "",
      handle: upstream.get("handle") || "",
      brand: upstream.get("brand") || "",
      mpn: upstream.get("mpn") || "",
    });
    if (!resolved.ok) return json(resolved);
    return json(await oceanProductFitmentGet(resolved.identity));
  }

  if (name === "product") {
    return json(await oceanGet("/product-review", upstream.toString()));
  }
  if (name === "product-groups" && upstream.get("vehicle_key") &&
      (upstream.get("assembly_group_id") || upstream.get("system_id"))) {
    const payload = await oceanGet("/product-groups", upstream.toString());
    const linked = await oceanGet("/products", new URLSearchParams({ vehicle_key: upstream.get("vehicle_key")! }).toString());
    if (!Array.isArray(linked?.products) || !linked.products.length) return json(payload);
    const categorized = await classifyCatalogueProducts(linked.products);
    const additions = productGroupsFromLinkedProducts(categorized, upstream.get("assembly_group_id") || upstream.get("system_id") || "");
    if (!additions.length) return json(payload);
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
    return json({ ...payload, error: undefined, ok: true, product_groups: [...byId.values()] });
  }
  if ((name === "products" || name === "systems") && upstream.get("vehicle_key")) {
    const vehicleQuery = new URLSearchParams({ vehicle_key: upstream.get("vehicle_key")! });
    const payload = await oceanGet(`/${name}`, name === "products" ? vehicleQuery.toString() : upstream.toString());
    if (name === "products") {
      if (!Array.isArray(payload?.products)) return json(payload);
      const categorized = await classifyCatalogueProducts(payload.products);
      return json({ ...payload, products: filterLinkedProducts(categorized, upstream) });
    }
    const linked = await oceanGet("/products", vehicleQuery.toString());
    if (!Array.isArray(linked?.products) || !linked.products.length) return json(payload);
    const categorized = await classifyCatalogueProducts(linked.products);
    const additions = systemsFromLinkedProducts(categorized);
    if (!additions.length) return json(payload);
    const byId = new Map((Array.isArray(payload?.systems) ? payload.systems : [])
      .filter((row: any) => row?.id).map((row: any) => [String(row.id), row]));
    for (const row of additions) {
      const existing: any = byId.get(row.id);
      byId.set(row.id, existing ? {
        ...existing,
        pending_fitment_count: Math.max(Number(existing.pending_fitment_count || 0), row.pending_fitment_count),
      } : row);
    }
    return json({ ...payload, error: undefined, ok: true, systems: [...byId.values()] });
  }
  return json(await oceanGet(`/${name}`, upstream.toString()));
}
