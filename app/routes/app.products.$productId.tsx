import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { Badge, Banner, BlockStack, Button, Card, InlineStack, Page, Text, Thumbnail } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { CarFitmentPanel } from "../components/CarFitment";
import { oceanGet, oceanProductFitmentGet, oceanProductFitmentPost } from "../ocean/client.server";
import { stableIdentity } from "../ocean/identity";
import { catalogueFitmentMetafields, verifiedVehicleKeys, METAFIELDS_SET, PRODUCT_IDENTITY_QUERY, productFromAdminNode } from "../ocean/metafields";
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
  const review = article.sku
    ? await oceanGet("/fitment-review", new URLSearchParams({ sku: article.sku }).toString())
    : null;
  // Reconcile pre-sync products on read. This makes existing Ocean fitments
  // publish to Shopify without forcing the merchant to re-save every product.
  if (resolved.ok && listing && typeof (listing as any).count === "number" && gid) {
    await admin.graphql(METAFIELDS_SET, {
      variables: {
        metafields: catalogueFitmentMetafields(gid, verifiedVehicleKeys((listing as any).fitments)),
      },
    });
  }
  const oceanArticle = (listing && typeof listing === "object" && (listing as { article?: Record<string, unknown> }).article) || {};
  return json({
    article,
    listing,
    review,
    imageUrl: String(node?.featuredImage?.url || (review as { image_url?: string } | null)?.image_url || ""),
    shopifyFitment: {
      count: String(node?.fitmentCount?.value || ""),
      status: String(node?.fitmentStatus?.value || ""),
      verifiedKeys: String(node?.verifiedKeys?.value || ""),
      fitmentKeys: String(node?.fitmentKeys?.value || ""),
    },
    taxonomy: {
      assembly: String(oceanArticle.assembly_group_id || ""),
      category: String(oceanArticle.category_id || ""),
      productGroup: String(oceanArticle.product_group_id || ""),
      brand: String(oceanArticle.brand || article.vendor || ""),
      mpn: String(oceanArticle.mpn || article.mpn || ""),
    },
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
      variables: { metafields: catalogueFitmentMetafields(gid, verifiedVehicleKeys(payload.fitments)) },
    });
  }
  return json(payload);
}

function joinNumbers(rows: Array<{ number?: string; brand?: string }> | undefined, withBrand = false) {
  return (rows || [])
    .map((row) => [withBrand ? row.brand : "", row.number].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");
}

export default function ProductCarFitment() {
  const { article, listing, review, imageUrl, shopifyFitment, taxonomy } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();
  const mapped = Boolean(article.numericId && (article.sku || article.vendor));
  const loaded = review && (review as { ok?: boolean }).ok ? (review as {
    oe_numbers?: Array<{ number?: string }>;
    cross_references?: Array<{ brand?: string; number?: string }>;
    candidate_fitments?: unknown[];
    verified_fitments?: unknown[];
    rejected_fitments?: unknown[];
    conflicts?: unknown[];
    brand?: string;
    mpn?: string;
    source?: string;
  }) : null;
  const reviewHref = appHref(
    "/app/catalogue-fitment-review",
    `sku=${encodeURIComponent(article.sku || "")}${location.search ? `&${location.search.replace(/^\?/, "")}` : ""}`,
  );

  return (
    <Page
      title={article.title || article.sku || "Product"}
      backAction={{
        content: "Back to Products",
        onAction: () => navigate(appHref("/app/products", location.search || "")),
      }}
    >
      <BlockStack gap="400">
        <Card>
          <InlineStack gap="300" blockAlign="start">
            <Thumbnail
              source={imageUrl || "https://cdn.shopify.com/static/images/placeholders/product-1.png"}
              alt={article.sku || article.numericId}
              size="large"
            />
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">{article.title || "Catalogue article"}</Text>
              <Text as="p">SKU {article.sku || "—"} · Brand {loaded?.brand || taxonomy.brand || article.vendor || "—"} · MPN {loaded?.mpn || taxonomy.mpn || "—"}</Text>
              <Text as="p">Shopify product {article.numericId || "—"} · variant {article.variantNumericId || "—"}</Text>
              <Text as="p">Assembly {taxonomy.assembly || "—"} · Category {taxonomy.category || "—"} · Product group {taxonomy.productGroup || "—"}</Text>
              <Text as="p">OE {joinNumbers(loaded?.oe_numbers) || "none"}</Text>
              <Text as="p">Cross references {joinNumbers(loaded?.cross_references, true) || "none"}</Text>
              <InlineStack gap="200">
                <Badge>{`${loaded?.candidate_fitments?.length || 0} candidates`}</Badge>
                <Badge tone="success">{`${loaded?.verified_fitments?.length || 0} verified`}</Badge>
                <Badge tone="critical">{`${loaded?.rejected_fitments?.length || 0} rejected`}</Badge>
                <Badge tone="warning">{`${loaded?.conflicts?.length || 0} conflicts`}</Badge>
              </InlineStack>
              <Text as="p">
                Shopify sync cache: ocean.fitment_count {shopifyFitment.count || "—"} · ocean.fitment_status {shopifyFitment.status || "—"}
              </Text>
              <Text as="p" tone="subdued">
                ocean.verified_vehicle_keys {shopifyFitment.verifiedKeys || "—"} · custom.fitment_keys {shopifyFitment.fitmentKeys || "—"}
              </Text>
              <Text as="p" tone="subdued">Evidence stays on Fitment Review. OE numbers are not application proof.</Text>
              {article.sku ? (
                <Link to={reviewHref} style={{ textDecoration: "none" }}>
                  <Button variant="primary">Open Fitment Review</Button>
                </Link>
              ) : null}
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
