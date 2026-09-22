import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { Banner, BlockStack, Card, InlineStack, Page, Text, Thumbnail } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { CarFitmentPanel } from "../components/CarFitment";
import { oceanProductFitmentGet, oceanProductFitmentPost } from "../ocean/client.server";
import { stableIdentity } from "../ocean/identity";
import { countMetafields, METAFIELDS_SET, PRODUCT_IDENTITY_QUERY, productFromAdminNode } from "../ocean/metafields";

function normalizeProductId(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function toShopifyProductGid(rawProductId: string): { gid: string; numericId: string } {
  const raw = String(rawProductId || "").trim();
  if (!raw) return { gid: "", numericId: "" };
  if (raw.startsWith("gid://shopify/Product/")) {
    const numericId = raw.split("/").pop() || "";
    return { gid: raw, numericId };
  }
  return { gid: `gid://shopify/Product/${raw}`, numericId: raw };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const rawProductId = params.productId ?? "";
  const decodedProductId = normalizeProductId(rawProductId);
  const { gid, numericId } = toShopifyProductGid(decodedProductId);
  if (!numericId || !/^\d+$/.test(numericId)) {
    throw new Response("Invalid productId (expected numeric product ID)", { status: 404 });
  }

  const resp = await admin.graphql(PRODUCT_IDENTITY_QUERY, { variables: { id: gid } });
  const gql = await resp.json();
  const node = gql?.data?.product;
  if (!node) throw new Response("Product not found", { status: 404 });
  const article = productFromAdminNode(node);
  const resolved = stableIdentity({
    shopify_product_id: article.numericId,
    shopify_variant_id: article.variantNumericId,
    sku: article.sku,
    handle: article.handle,
    brand: article.vendor,
    mpn: article.mpn,
    barcode: article.barcode,
  });
  const listing = resolved.ok
    ? await oceanProductFitmentGet(resolved.identity)
    : resolved;
  return json({
    article,
    listing,
    ocean_endpoint: "/ocean-catalogue-manager/shopify-admin/product-fitment",
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const { gid, numericId } = toShopifyProductGid(normalizeProductId(params.productId ?? ""));
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const payload = await oceanProductFitmentPost({
    ...body,
    shopify_product_id: numericId,
  });
  if (payload && typeof payload.count === "number" && gid) {
    await admin.graphql(METAFIELDS_SET, {
      variables: { metafields: countMetafields(gid, payload.count) },
    });
  }
  return json(payload);
}

export default function ProductCarFitment() {
  const { article, listing } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();
  const mapped = Boolean(article.numericId && (article.sku || article.vendor));

  return (
    <Page
      title="CAR FITMENT"
      backAction={{
        content: "Back to Products",
        onAction: () => navigate(`/app/products${location.search || ""}`),
      }}
    >
      <BlockStack gap="400">
        <Card>
          <InlineStack gap="300" blockAlign="center">
            <Thumbnail
              source="https://cdn.shopify.com/static/images/placeholders/product-1.png"
              alt={article.sku || article.numericId}
              size="medium"
            />
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                {article.vendor || "Catalogue article"} {article.sku}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Display title is not an identity key: {article.title || "—"}
              </Text>
            </BlockStack>
          </InlineStack>
        </Card>
        {!mapped ? (
          <Banner tone="warning">
            No mapping. Fitment: 0 vehicles / unmapped. Resolve Shopify product ID, variant ID, SKU, or
            Brand+MPN before adding compatibility.
          </Banner>
        ) : (
          <CarFitmentPanel article={article} initialListing={listing as any} />
        )}
      </BlockStack>
    </Page>
  );
}
