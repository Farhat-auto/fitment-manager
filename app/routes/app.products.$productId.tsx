import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { Badge, Banner, BlockStack, Button, Card, InlineStack, Page, Text, Thumbnail } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { CarFitmentPanel } from "../components/CarFitment";
import { oceanGet, oceanProductFitmentGet, oceanProductFitmentPost } from "../ocean/client.server";
import { stableIdentity } from "../ocean/identity";
import { catalogueFitmentMetafields, verifiedVehicleKeys, METAFIELDS_SET, PRODUCT_IDENTITY_QUERY, productFromAdminNode } from "../ocean/metafields";
import { odooUrl, shopifyAdminUrl, storefrontUrl } from "../ocean/product-link";
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

function text(value: unknown) {
  return String(value ?? "").trim();
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
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
  const link = resolved.ok
    ? await oceanGet("/product-link", new URLSearchParams({
        shopify_product_id: resolved.identity.shopify_product_id,
        shopify_variant_id: resolved.identity.shopify_variant_id,
        sku: resolved.identity.sku,
        handle: resolved.identity.handle,
        brand: resolved.identity.brand,
        mpn: resolved.identity.mpn,
        barcode: resolved.identity.barcode,
      }).toString())
    : { ok: false, error: "ambiguous_identity", title_used: false, labels: ["AMBIGUOUS"] };
  const catalogueSku = text((link as { catalogue?: { sku?: string } })?.catalogue?.sku);
  const reviewSku = catalogueSku || article.sku;
  const review = reviewSku
    ? await oceanGet("/fitment-review", new URLSearchParams({ sku: reviewSku }).toString())
    : { ok: false, error: "catalogue SKU is missing." };
  const variant = (((node || {}).variants || {}).nodes || [])[0] || {};
  const shop = String(session?.shop || "");
  const adminLink = shopifyAdminUrl(shop, article.numericId);
  const storefront = storefrontUrl(shop, article.handle);
  const odooTemplate = text((link as { odoo?: { template_id?: string } })?.odoo?.template_id);
  const odooProduct = text((link as { odoo?: { product_id?: string } })?.odoo?.product_id);
  const odoo = odooUrl(process.env.ODOO_WEB_URL || "", odooTemplate, odooProduct);
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
  const linkRecord = link && typeof link === "object" ? (link as Record<string, any>) : {};
  const catalogue = linkRecord.catalogue || {};
  const linkTaxonomy = catalogue.taxonomy || {};
  return json({
    article,
    listing,
    review,
    link: linkRecord,
    catalogueSku,
    reviewSku,
    imageUrl: String(node?.featuredImage?.url || (review as { image_url?: string } | null)?.image_url || ""),
    shopifyFitment: {
      count: String(node?.fitmentCount?.value || ""),
      status: String(node?.fitmentStatus?.value || ""),
      verifiedKeys: String(node?.verifiedKeys?.value || ""),
      fitmentKeys: String(node?.fitmentKeys?.value || ""),
    },
    shopify: {
      status: String(node?.status || ""),
      price: String(variant?.price || ""),
      inventory: variant?.inventoryQuantity ?? "",
      adminUrl: adminLink.url,
      adminError: adminLink.error,
      storefrontUrl: storefront.url,
      storefrontError: storefront.error,
    },
    odooLink: { url: odoo.url, error: odoo.error },
    taxonomy: {
      assembly: String(linkTaxonomy.assembly || linkTaxonomy.assembly_group_id || oceanArticle.assembly_group_id || ""),
      category: String(linkTaxonomy.category || linkTaxonomy.category_id || oceanArticle.category_id || ""),
      productGroup: String(linkTaxonomy.product_group_id || oceanArticle.product_group_id || ""),
      brand: String(catalogue.brand || oceanArticle.brand || article.vendor || ""),
      mpn: String(catalogue.mpn || oceanArticle.mpn || article.mpn || ""),
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

function ExternalAction({ href, label, error }: { href: string; label: string; error: string }) {
  if (!href) return <Text as="p" tone="critical">{error || `${label} failed.`}</Text>;
  return (
    <a href={href} target="_top" rel="noreferrer" style={{ textDecoration: "none" }}>
      <Button>{label}</Button>
    </a>
  );
}

function integrationMark(value: string) {
  const status = String(value || "").toLowerCase();
  if (status === "ok") return "✓";
  if (status === "pending") return "pending";
  if (status === "failed") return "error";
  if (status === "ambiguous") return "AMBIGUOUS";
  if (status === "needs review") return "warning";
  if (status === "missing") return "missing";
  return value || "missing";
}

export default function ProductCarFitment() {
  const data = useLoaderData<typeof loader>();
  const { article, listing, review, imageUrl, shopifyFitment, taxonomy, link, shopify, odooLink, catalogueSku, reviewSku } = data;
  const navigate = useNavigate();
  const location = useLocation();
  const mapped = Boolean(article.numericId && (article.sku || article.vendor));
  const reviewOk = Boolean(review && (review as { ok?: boolean }).ok);
  const loaded = reviewOk ? (review as {
    oe_numbers?: Array<{ number?: string }>;
    cross_references?: Array<{ brand?: string; number?: string }>;
    candidate_fitments?: unknown[];
    verified_fitments?: unknown[];
    rejected_fitments?: unknown[];
    conflicts?: unknown[];
    brand?: string;
    mpn?: string;
    error?: string;
  }) : null;
  const reviewError = reviewOk ? "" : String((review as { error?: string } | null)?.error || "Fitment review failed.");
  const linkError = link && link.ok === false ? String(link.error || "Product link failed.") : "";
  const labels = Array.isArray(link?.labels) ? link.labels.map((item: unknown) => String(item)) : [];
  const fitment = (link?.fitment || {}) as Record<string, number>;
  const odoo = (link?.odoo || {}) as Record<string, string>;
  const catalogue = (link?.catalogue || {}) as Record<string, any>;
  const integration = (link?.integration || {}) as Record<string, string>;
  const oe = (Array.isArray(catalogue.oe) && catalogue.oe.length)
    ? catalogue.oe.join(", ")
    : joinNumbers(loaded?.oe_numbers) || "none";
  const cross = (Array.isArray(catalogue.cross_references) && catalogue.cross_references.length)
    ? catalogue.cross_references.join(", ")
    : joinNumbers(loaded?.cross_references, true) || "none";
  const embedded = location.search ? `&${location.search.replace(/^\?/, "")}` : "";
  const reviewHref = reviewSku
    ? appHref("/app/catalogue-fitment-review", `sku=${encodeURIComponent(reviewSku)}${embedded}`)
    : "";
  const catalogueHref = catalogueSku
    ? appHref("/app/product-linker", `sku=${encodeURIComponent(catalogueSku)}${embedded}`)
    : "";
  const storefrontLabel = integration.storefront === "OK" ? "✓" : "not visible";

  return (
    <Page
      title={article.title || article.sku || "Product"}
      backAction={{
        content: "Back to Products",
        onAction: () => navigate(appHref("/app/products", location.search || "")),
      }}
    >
      <BlockStack gap="400">
        {linkError ? <Banner tone="critical" title="Product link failed"><p>{linkError}</p></Banner> : null}
        {labels.length ? <Banner tone={labels.includes("OK") && labels.length === 1 ? "success" : "warning"}><p>{labels.join(" · ")}</p></Banner> : null}
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Shopify</Text>
            <Thumbnail source={imageUrl || "https://cdn.shopify.com/static/images/placeholders/product-1.png"} alt={article.sku || article.numericId} size="large" />
            <Text as="p">Product {article.numericId || "—"} · variant {article.variantNumericId || "—"}</Text>
            <Text as="p">SKU {article.sku || "—"} · handle {article.handle || "—"} · {shopify.status || "status unknown"}</Text>
            <Text as="p">Price {shopify.price || "—"} · inventory {shopify.inventory === "" ? "—" : String(shopify.inventory)}</Text>
            <InlineStack gap="200">
              <ExternalAction href={shopify.adminUrl} label="Open Shopify Admin" error={shopify.adminError} />
              <ExternalAction href={shopify.storefrontUrl} label="Open Storefront" error={shopify.storefrontError} />
            </InlineStack>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Odoo</Text>
            <Text as="p">Template ID {odoo.template_id || "—"} · variant ID {odoo.product_id || "—"}</Text>
            <Text as="p">Internal reference {odoo.internal_reference || "—"}</Text>
            {odoo.internal_reference_error ? <Text as="p" tone="subdued">{odoo.internal_reference_error}</Text> : null}
            <Text as="p">Barcode {odoo.barcode || article.barcode || "—"} · category {odoo.category || taxonomy.category || "—"} · company {odoo.company || "—"}</Text>
            <Text as="p">Stock {odoo.stock || "—"}</Text>
            <ExternalAction href={odooLink.url} label="Open Odoo" error={odooLink.error} />
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Ocean Catalogue</Text>
            <Text as="p">Article {catalogue.article_id || catalogueSku || "—"} · brand {catalogue.brand || taxonomy.brand || "—"} · MPN {catalogue.mpn || taxonomy.mpn || "—"}</Text>
            <Text as="p">OE {oe}</Text>
            <Text as="p">Cross references {cross}</Text>
            <Text as="p">Assembly {taxonomy.assembly || "—"} · Category {taxonomy.category || "—"} · Product group {taxonomy.productGroup || "—"}</Text>
            {catalogueHref ? (
              <Link to={catalogueHref} style={{ textDecoration: "none" }}><Button>Open Catalogue Record</Button></Link>
            ) : (
              <Text as="p" tone="critical">Open Catalogue Record failed: CATALOGUE LINK MISSING</Text>
            )}
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Fitment</Text>
            {reviewError ? <Text as="p" tone="critical">Fitment review failed: {reviewError}</Text> : null}
            <InlineStack gap="200">
              <Badge>{`${loaded?.candidate_fitments?.length ?? fitment.candidate ?? 0} candidates`}</Badge>
              <Badge>{`${fitment.authoritative ?? 0} authoritative`}</Badge>
              <Badge tone="success">{`${loaded?.verified_fitments?.length ?? fitment.verified ?? 0} verified`}</Badge>
              <Badge tone="warning">{`${fitment.needs_review ?? 0} needs review`}</Badge>
              <Badge tone="critical">{`${loaded?.rejected_fitments?.length ?? fitment.rejected ?? 0} rejected`}</Badge>
              <Badge tone="warning">{`${loaded?.conflicts?.length ?? fitment.conflicts ?? 0} conflicts`}</Badge>
            </InlineStack>
            {reviewHref ? (
              <Link to={reviewHref} style={{ textDecoration: "none" }}><Button variant="primary">Open Fitment Review</Button></Link>
            ) : (
              <Text as="p" tone="critical">Open Fitment Review failed: catalogue SKU is missing.</Text>
            )}
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">Integration</Text>
            <Text as="p">Shopify {integrationMark(integration.shopify)} · Odoo {integrationMark(integration.odoo)} · Catalogue {integrationMark(integration.catalogue)} · Taxonomy {integrationMark(integration.taxonomy)}</Text>
            <Text as="p">Fitment {integrationMark(integration.fitment)} · Sync {integrationMark(integration.sync)} · Storefront {storefrontLabel}</Text>
            <Text as="p">Shopify sync cache: ocean.fitment_count {shopifyFitment.count || "—"} · ocean.fitment_status {shopifyFitment.status || "—"}</Text>
            <Text as="p" tone="subdued">ocean.verified_vehicle_keys {shopifyFitment.verifiedKeys || "—"} · custom.fitment_keys {shopifyFitment.fitmentKeys || "—"}</Text>
            <Text as="p" tone="subdued">Evidence stays on Fitment Review. OE numbers are not application proof. Title is not identity.</Text>
          </BlockStack>
        </Card>
        {!mapped ? (
          <Banner tone="warning">
            No mapping. Fitment: 0 vehicles / unmapped. Resolve Shopify product ID, variant ID, SKU, or
            Brand+MPN before adding compatibility.
          </Banner>
        ) : (
          <CarFitmentPanel article={article} initialListing={listing as any} imageUrl={imageUrl} />
        )}
      </BlockStack>
    </Page>
  );
}
