import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useActionData, useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { Badge, Banner, BlockStack, Button, Card, IndexTable, InlineStack, Page, Text, TextField } from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { oceanGet, oceanPost } from "../ocean/client.server";
import { LINKER_FILTERS } from "../ocean/product-link";
import { appHref } from "../embedded-nav";

const LINK_PRODUCTS = `#graphql
  query ProductLinkerPage($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        vendor
        variants(first: 1) {
          nodes { id sku barcode }
        }
      }
    }
  }
`;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numericId(value: string) {
  const id = value.split("/").pop() || "";
  return /^\d+$/.test(id) ? id : "";
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") || "";
  const q = url.searchParams.get("q") || "";
  const sku = url.searchParams.get("sku") || "";
  const params = new URLSearchParams();
  if (filter) params.set("filter", filter);
  if (q) params.set("q", q);
  const [list, focus] = await Promise.all([
    oceanGet("/product-links", params.toString()),
    sku
      ? oceanGet("/product-link", new URLSearchParams({ catalogue_sku: sku, sku }).toString())
      : Promise.resolve(null),
  ]);
  return json({
    filter,
    q,
    sku,
    error: text(list?.error),
    note: text(list?.note),
    total: Number(list?.total || 0),
    summary: (list?.summary || {}) as Record<string, number>,
    items: Array.isArray(list?.items) ? list.items : [],
    focus,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  if (text(form.get("intent")) !== "auto_link_safe") {
    return json({ ok: false, error: "unknown_action", title_used: false });
  }
  const identities: Array<Record<string, string>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const resp: any = await admin.graphql(LINK_PRODUCTS, { variables: { cursor } });
    const body: any = await resp.json();
    const connection: any = body?.data?.products;
    for (const node of connection?.nodes || []) {
      const variant = node?.variants?.nodes?.[0] || {};
      identities.push({
        shopify_product_id: numericId(String(node?.id || "")),
        shopify_variant_id: numericId(String(variant?.id || "")),
        sku: text(variant?.sku),
        handle: text(node?.handle),
        brand: text(node?.vendor),
        barcode: text(variant?.barcode),
      });
    }
    if (!connection?.pageInfo?.hasNextPage) break;
    cursor = connection.pageInfo.endCursor || null;
    if (!cursor) break;
  }
  const payload = await oceanPost("/product-links", {
    action: "auto_link_safe",
    identities,
    mapped_by: "auto_link_safe",
  });
  return json(payload || { ok: false, error: "product_link_failed" });
}

export default function ProductLinker() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as Record<string, any> | undefined;
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState(data.q || "");
  const search = location.search || "";
  const href = (filter: string) => {
    const params = new URLSearchParams(search.replace(/^\?/, ""));
    if (filter) params.set("filter", filter);
    else params.delete("filter");
    const qs = params.toString();
    return appHref("/app/product-linker", qs ? `?${qs}` : "");
  };
  const items = data.items as Array<Record<string, any>>;
  const embedded = search ? `&${search.replace(/^\?/, "")}` : "";

  return (
    <Page
      title="Product Linker"
      backAction={{ content: "Products", onAction: () => navigate(appHref("/app/products", search)) }}
    >
      <BlockStack gap="400">
        <Banner tone="info" title="Safe identity only">
          <p>
            Auto Link Safe Matches writes a Shopify map only when one article matches by permanent id,
            Shopify id, exact SKU, brand + MPN, or barcode. Ambiguous rows, shared OE, and titles stay unlinked.
            Fitment is not verified.
          </p>
        </Banner>
        {data.error ? <Banner tone="critical" title="Product link failed"><p>{data.error}</p></Banner> : null}
        {data.note ? <Banner tone="warning"><p>{data.note}</p></Banner> : null}
        <InlineStack gap="200" wrap>
          {LINKER_FILTERS.map((filter) => (
            <Link key={filter.id || "all"} to={href(filter.id)} style={{ textDecoration: "none" }}>
              <Button variant={data.filter === filter.id ? "primary" : undefined}>
                {filter.label}{filter.id && data.summary?.[filter.id] != null ? ` (${data.summary[filter.id]})` : ""}
              </Button>
            </Link>
          ))}
        </InlineStack>
        <Card>
          <form method="get" action={appHref("/app/product-linker", search)}>
            <InlineStack gap="200" blockAlign="end">
              <TextField
                label="Search SKU, MPN, barcode, or id"
                value={query}
                onChange={setQuery}
                name="q"
                autoComplete="off"
              />
              {data.filter ? <input type="hidden" name="filter" value={data.filter} /> : null}
              <Button submit>Search</Button>
            </InlineStack>
          </form>
        </Card>
        <form method="post">
          <input type="hidden" name="intent" value="auto_link_safe" />
          <Button submit variant="primary">Auto Link Safe Matches</Button>
        </form>
        {result ? (
          <Banner tone={result.ok === false ? "critical" : "info"} title="Auto Link result">
            <p>
              {result.error
                ? String(result.error)
                : `Linked ${result.linked || 0}. Already linked ${result.already_linked || 0}. Ambiguous ${result.ambiguous || 0}. Catalogue missing ${result.catalogue_missing || 0}. OE review only ${result.oe_review_only || 0}. Fitments written ${result.fitments_written || 0}.`}
            </p>
          </Banner>
        ) : null}
        {data.focus ? (
          <Card>
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Catalogue record {data.sku}</Text>
              <Text as="p">{Array.isArray((data.focus as any).labels) ? (data.focus as any).labels.join(" · ") : text((data.focus as any).error)}</Text>
              <Text as="p">Match {(data.focus as any).match_method || "—"} · Shopify {(data.focus as any).shopify?.product_id || "—"} · Odoo {(data.focus as any).odoo?.template_id || "—"}</Text>
            </BlockStack>
          </Card>
        ) : null}
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Articles ({data.total})</Text>
            {items.length ? (
              <IndexTable
                resourceName={{ singular: "article", plural: "articles" }}
                itemCount={items.length}
                selectable={false}
                headings={[{ title: "Article" }, { title: "Status" }, { title: "Shopify" }, { title: "Odoo" }, { title: "Fitment" }, { title: "Open" }]}
              >
                {items.map((item, index) => {
                  const sku = text(item?.catalogue?.sku);
                  const shopifyId = text(item?.shopify?.product_id);
                  const labels = Array.isArray(item.labels) ? item.labels.join(", ") : "";
                  return (
                    <IndexTable.Row id={sku || String(index)} key={sku || index} position={index}>
                      <IndexTable.Cell>{sku || "—"}</IndexTable.Cell>
                      <IndexTable.Cell><Badge>{labels || item.status || "—"}</Badge></IndexTable.Cell>
                      <IndexTable.Cell>{shopifyId || "SHOPIFY LINK MISSING"}</IndexTable.Cell>
                      <IndexTable.Cell>{text(item?.odoo?.template_id) || "ODOO LINK MISSING"}</IndexTable.Cell>
                      <IndexTable.Cell>{String(item?.fitment?.verified ?? 0)} verified</IndexTable.Cell>
                      <IndexTable.Cell>
                        <InlineStack gap="200">
                          {shopifyId ? <Link to={appHref(`/app/products/${shopifyId}`, search)}>Product</Link> : <Text as="span" tone="critical">Open product failed: Shopify product ID is missing.</Text>}
                          {sku ? <Link to={appHref("/app/catalogue-fitment-review", `sku=${encodeURIComponent(sku)}${embedded}`)}>Fitment Review</Link> : null}
                        </InlineStack>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            ) : (
              <Text as="p">{data.filter === "missing_catalogue" ? "No catalogue row is missing an article. Use Auto Link Safe Matches to surface Shopify listings with CATALOGUE LINK MISSING." : "No articles in this filter."}</Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
