import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { oceanGet, oceanPost, oceanProductFitmentGet, oceanProductFitmentPost } from "../ocean/client.server";
import { emptyListing, stableIdentity } from "../ocean/identity";

const ALLOWED = new Set([
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
  "product-fitment",
  "car-fitment",
  "fitments",
  "oe-family",
  "product-review",
  "analyse",
  "storefront-compatibility",
  "article-candidates",
  "article-search",
  "article-map",
  "map-article",
  "article-create",
  "create-article",
]);

function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

function routeName(params: { "*": string } | Record<string, string | undefined>) {
  return String(params["*"] || "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")[0];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") return preflight();
  const { cors } = await authenticate.admin(request);
  const name = routeName(params as { "*": string });
  if (!ALLOWED.has(name)) {
    return cors(json({ ok: false, error: "not_found", path: name }, { status: 404 }));
  }
  const url = new URL(request.url);
  if (name === "product-fitment" || name === "car-fitment" || name === "fitments") {
    const resolved = stableIdentity({
      shopify_product_id: url.searchParams.get("shopify_product_id") || "",
      shopify_variant_id: url.searchParams.get("shopify_variant_id") || "",
      sku: url.searchParams.get("sku") || "",
      handle: url.searchParams.get("handle") || "",
      brand: url.searchParams.get("brand") || "",
      mpn: url.searchParams.get("mpn") || "",
    });
    if (!resolved.ok) return cors(json(resolved));
    const listing = await oceanProductFitmentGet(resolved.identity);
    return cors(json(listing));
  }
  const payload = await oceanGet(`/${name}`, url.searchParams.toString());
  return cors(json(payload));
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return preflight();
  const { cors } = await authenticate.admin(request);
  const name = routeName(params as { "*": string });
  if (!ALLOWED.has(name)) {
    return cors(json({ ok: false, error: "not_found", path: name }, { status: 404 }));
  }
  if (name === "product-review" || name === "analyse" || name === "oe-family") {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const payload = await oceanPost(`/${name}`, body);
    return cors(json(payload));
  }
  if (
    name === "article-candidates" ||
    name === "article-search" ||
    name === "article-map" ||
    name === "map-article" ||
    name === "article-create" ||
    name === "create-article"
  ) {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const payload = await oceanPost(`/${name}`, body);
    return cors(json(payload));
  }
  if (name !== "product-fitment" && name !== "car-fitment" && name !== "fitments") {
    return cors(json({ ok: false, error: "method_not_allowed" }, { status: 405 }));
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const mutation = String(body.action || "").trim().toLowerCase();
  if (mutation === "add" && body.explicit_confirmation !== "save_fitment") {
    return cors(
      json(
        { ok: false, error: "explicit_confirmation_required", action: mutation },
        { status: 409 },
      ),
    );
  }
  // Confirmation is a Fitment Manager safety gate only; never forward it to
  // the catalogue service as fitment data.
  if ("explicit_confirmation" in body) delete body.explicit_confirmation;
  const payload = await oceanProductFitmentPost(body);
  const status = payload && payload.ok === false && payload.error === "ambiguous_identity" ? 400 : 200;
  return cors(json(payload, { status }));
}

export const emptyUnmapped = emptyListing;
