/**
 * Backward-compatible bridge for leftover live links:
 *   /app/fitment/:handle  →  /app/products/:productId
 *
 * This is NOT a second fitment UI. Vehicle selection lives only on the Ocean
 * CAR FITMENT page. Historical vehicle-index modules remain isolated and are
 * not loaded here.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Page, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { PRODUCT_ID_BY_HANDLE_QUERY } from "../ocean/metafields";
import { rejectLegacyVehicleWrite } from "../ocean/legacy";
import { appHref } from "../embedded-nav";

const LEGACY_VEHICLE_INTENTS = new Set([
  "save_fitment",
  "vehicle_index_status",
  "vehicle_index_refresh",
  "index_makes",
  "index_models",
  "index_make_model",
]);

async function redirectToCanonicalProduct(
  request: Request,
  params: { productHandle?: string },
) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const productHandle = String(params.productHandle || "").trim();
  if (!productHandle) throw new Response("Missing productHandle", { status: 400 });

  if (productHandle === "validation") {
    return redirect(appHref("/app/fitment-validation", url.search));
  }

  const resp = await admin.graphql(PRODUCT_ID_BY_HANDLE_QUERY, {
    variables: { handle: productHandle },
  });
  const gql = await resp.json();
  const product = gql?.data?.productByHandle;
  const numericId = String(product?.id || "")
    .split("/")
    .pop()
    ?.trim();
  if (!numericId || !/^\d+$/.test(numericId)) {
    throw new Response("Product not found", { status: 404 });
  }
  return redirect(appHref(`/app/products/${numericId}`, url.search));
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  return redirectToCanonicalProduct(request, params);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const contentType = String(request.headers.get("content-type") || "");
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const intent = String(formData.get("_intent") || "").trim();
    if (LEGACY_VEHICLE_INTENTS.has(intent) || intent === "save_fitment") {
      return json(rejectLegacyVehicleWrite(intent || "fitment.vehicles"), { status: 409 });
    }
  }
  return redirectToCanonicalProduct(request, params);
}

export default function LegacyFitmentBridge() {
  return (
    <Page title="CAR FITMENT">
      <Text as="p" variant="bodyMd">
        Opening Ocean CAR FITMENT. This /app/fitment/:handle route is not the normal product
        workflow and redirects to /app/products/:productId.
      </Text>
    </Page>
  );
}
