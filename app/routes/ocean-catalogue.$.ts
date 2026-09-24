import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
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

  return json(await oceanGet(`/${name}`, upstream.toString()));
}
