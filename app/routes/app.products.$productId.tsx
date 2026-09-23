import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { Banner, BlockStack, Card, InlineStack, Page, Text, Thumbnail } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { CarFitmentPanel } from "../components/CarFitment";
import { ProductClassification } from "../components/ProductClassification";
import {
  classificationFromProductNode,
  handleClassificationIntent,
  loadClassificationCategories,
} from "../classification/classification.server";
import { oceanProductFitmentGet, oceanProductFitmentPost } from "../ocean/client.server";
import { emptyListing, stableIdentity } from "../ocean/identity";
import { countMetafields, METAFIELDS_SET, PRODUCT_IDENTITY_QUERY, productFromAdminNode } from "../ocean/metafields";
import { appHref } from "../embedded-nav";

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

function shopDomainFrom(session: { shop?: string } | null | undefined, request: Request): string {
  const fromSession = String(session?.shop ?? "").trim();
  if (fromSession) return fromSession;
  const url = new URL(request.url);
  return String(url.searchParams.get("shop") || url.searchParams.get("shop_domain") || "").trim();
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const rawProductId = params.productId ?? "";
  const decodedProductId = normalizeProductId(rawProductId);
  const { gid, numericId } = toShopifyProductGid(decodedProductId);
  if (!numericId || !/^\d+$/.test(numericId)) {
    throw new Response("Invalid productId (expected numeric product ID)", { status: 404 });
  }

  let node: any = null;
  try {
    const resp = await admin.graphql(PRODUCT_IDENTITY_QUERY, { variables: { id: gid } });
    const gql = await resp.json();
    node = gql?.data?.product ?? null;
  } catch (error) {
    console.warn("PRODUCT_IDENTITY_QUERY_FAILED", error);
  }
  const article = node
    ? productFromAdminNode(node)
    : {
        id: gid,
        title: "",
        handle: "",
        vendor: "",
        sku: "",
        barcode: "",
        mpn: "",
        articleNumber: "",
        oeReferences: [] as string[],
        variantId: "",
        numericId,
        variantNumericId: "",
      };
  const resolved = stableIdentity({
    shopify_product_id: article.numericId,
    shopify_variant_id: article.variantNumericId,
    sku: article.sku,
    handle: article.handle,
    brand: article.vendor,
    mpn: article.mpn,
    barcode: article.barcode,
  });
  let listing: Awaited<ReturnType<typeof oceanProductFitmentGet>> | typeof resolved = resolved;
  if (resolved.ok) {
    try {
      listing = await oceanProductFitmentGet(resolved.identity);
    } catch (error) {
      console.warn("OCEAN_PRODUCT_FITMENT_FAILED", error);
      listing = emptyListing(resolved.identity, { ok: false, error: "ocean_product_fitment_failed" });
    }
  }
  const shopDomain = shopDomainFrom(session, request);
  let categories: Array<{ value: string; label: string }> = [];
  try {
    const catalog = await loadClassificationCategories({ admin, shopDomain });
    categories = catalog.categories;
  } catch (error) {
    console.warn("CLASSIFICATION_CATEGORIES_FAILED", error);
  }
  return json({
    article,
    listing,
    classification: classificationFromProductNode(node),
    classificationOptions: { categories },
    ocean_endpoint: "/ocean-catalogue-manager/shopify-admin/product-fitment",
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const contentType = String(request.headers.get("content-type") || "");
  if (!contentType.includes("application/json")) {
    const formData = await request.formData();
    const intent = String(formData.get("_intent") || "").trim();
    const classified = await handleClassificationIntent({
      admin,
      shopDomain: shopDomainFrom(session, request),
      intent,
      formData,
    });
    if (classified) return classified;
    return json({ ok: false, error: "Unknown intent" }, { status: 400 });
  }

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
  const { article, listing, classification, classificationOptions } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();
  const mapped = Boolean(article.numericId && (article.sku || article.vendor));

  return (
    <Page
      title={article.sku || article.numericId || "Product"}
      subtitle="CAR FITMENT"
      backAction={{
        content: "Back to Products",
        onAction: () => navigate(appHref("/app/products", location.search || "")),
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
                {article.vendor || "Product"} {article.sku}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Display title is not an identity key: {article.title || "—"}
              </Text>
            </BlockStack>
          </InlineStack>
        </Card>
        <ProductClassification
          productGid={article.id || `gid://shopify/Product/${article.numericId}`}
          classification={classification}
          categories={classificationOptions.categories || []}
        />
        {!mapped ? (
          <Banner tone="warning">
            Shopify identity is incomplete. CAR FITMENT still loads. Add SKU or Brand+MPN before saving
            compatibility.
          </Banner>
        ) : null}
        <CarFitmentPanel article={article} initialListing={listing as any} />
      </BlockStack>
    </Page>
  );
}
