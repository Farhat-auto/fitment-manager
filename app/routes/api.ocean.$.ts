import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { oceanGet, oceanPost, oceanProductFitmentGet, oceanProductFitmentPost } from "../ocean/client.server";
import { emptyListing, stableIdentity } from "../ocean/identity";
import { METAFIELDS_SET, catalogueFitmentMetafields, ensureLinkedVehicleFilter, linkedVehicleFilterMetafield, verifiedVehicleKeys } from "../ocean/metafields";

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
  "products",
  "product-fitment",
  "car-fitment",
  "fitments",
  "oe-family",
  "oe",
  "oe-numbers",
  "oe-search",
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
  const { admin, cors } = await authenticate.admin(request);
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
  if (name === "makes") {
    try {
      await ensureLinkedVehicleFilter(admin);
    } catch (error) {
      console.error("VEHICLE_FILTER_DEFINITION_FAILED", error);
    }
  }
  const payload = await oceanGet(`/${name}`, url.searchParams.toString());
  return cors(json(payload));
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return preflight();
  const { admin, cors } = await authenticate.admin(request);
  const name = routeName(params as { "*": string });
  if (!ALLOWED.has(name)) {
    return cors(json({ ok: false, error: "not_found", path: name }, { status: 404 }));
  }
  if (
    name === "product-review"
    || name === "analyse"
    || name === "oe-family"
    || name === "article-map"
    || name === "map-article"
    || name === "article-create"
    || name === "create-article"
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
  const payload = await oceanProductFitmentPost(body);
  const status = payload && payload.ok === false && payload.error === "ambiguous_identity" ? 400 : 200;

  // Keep Shopify storefront fitment in lockstep with the canonical Ocean fitment
  // service. The technical catalogue uses ocean.verified_vehicle_keys, so every
  // successful Fitment Manager mutation must refresh that contract immediately.
  if (status === 200 && payload && payload.ok !== false) {
    const productId = String(
      payload.shopify_product_id || body.shopify_product_id || body.product_id || "",
    ).trim();
    const ownerId = productId
      ? (productId.startsWith("gid://shopify/Product/") ? productId : `gid://shopify/Product/${productId}`)
      : "";
    if (ownerId) {
      const fitments = Array.isArray(payload.fitments) ? payload.fitments : [];
      const metafields = catalogueFitmentMetafields(ownerId, verifiedVehicleKeys(fitments));
      const syncResponse = await admin.graphql(METAFIELDS_SET, { variables: { metafields } });
      const syncJson = await syncResponse.json();
      const userErrors = syncJson?.data?.metafieldsSet?.userErrors ?? [];
      if (Array.isArray(userErrors) && userErrors.length) {
        console.error("STOREFRONT_FITMENT_SYNC_FAILED", { ownerId, userErrors });
        return cors(json({ ...payload, storefront_sync: { ok: false, userErrors } }, { status: 502 }));
      }
      let vehicleFilter: { ok: boolean; userErrors?: unknown } = { ok: false };
      try {
        const ready = await ensureLinkedVehicleFilter(admin);
        if (ready.ok) {
          const filterResponse = await admin.graphql(METAFIELDS_SET, {
            variables: { metafields: [linkedVehicleFilterMetafield(ownerId, fitments)] },
          });
          const filterJson = await filterResponse.json();
          const filterErrors = filterJson?.data?.metafieldsSet?.userErrors ?? [];
          vehicleFilter = filterErrors.length ? { ok: false, userErrors: filterErrors } : { ok: true };
        } else {
          vehicleFilter = ready;
        }
      } catch (error) {
        console.error("VEHICLE_FILTER_SYNC_FAILED", error);
      }
      payload.storefront_sync = {
        ok: true,
        verified_vehicle_keys: verifiedVehicleKeys(fitments),
        vehicle_filter: vehicleFilter,
      };
    }
  }

  return cors(json(payload, { status }));
}

export const emptyUnmapped = emptyListing;
