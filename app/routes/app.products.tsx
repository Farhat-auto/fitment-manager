import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  IndexTable,
  Thumbnail,
  Text,
  InlineStack,
  Button,
  Pagination,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { GET_PRODUCTS_FOR_FITMENT_ADMIN } from "../graphql/fitment";
import { getFitmentCountsByProductHandle } from "../fitment/fitment.server";

type ProductRow = {
  id: string;
  title: string;
  handle: string;
  sku: string;
  article_number: string;
  brand: string;
  featuredImageUrl: string;
  featuredImageAlt: string;
  vehicleCount: number;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const after = url.searchParams.get("after");

  const resp = await admin.graphql(GET_PRODUCTS_FOR_FITMENT_ADMIN, {
    variables: { first: 50, after, query: null },
  });
  const json = await resp.json();

  const productsNode = json?.data?.products;
  const nodes: any[] = Array.isArray(productsNode?.nodes) ? productsNode.nodes : [];
  const pageInfo = productsNode?.pageInfo ?? { hasNextPage: false, endCursor: null };

  const shop_domain = String((session as any)?.shop ?? "").trim();
  const handles = nodes.map((p: any) => String(p?.handle ?? "")).filter(Boolean);
  const counts = shop_domain
    ? await getFitmentCountsByProductHandle({ shop_domain, product_handles: handles })
    : new Map<string, number>();

  const products: ProductRow[] = nodes.map((p: any) => {
    const handle = String(p?.handle ?? "");
    const sku = String(p?.variants?.nodes?.[0]?.sku ?? "").trim();
    const article_number = String(p?.article_number?.value ?? "").trim();
    const brand = String(p?.brand?.value ?? "").trim();
    const vehicleCount = counts.get(handle) ?? 0;
    return {
      id: String(p?.id ?? ""),
      title: String(p?.title ?? ""),
      handle,
      sku,
      article_number,
      brand,
      featuredImageUrl: String(p?.featuredImage?.url ?? ""),
      featuredImageAlt: String(p?.featuredImage?.altText ?? p?.title ?? ""),
      vehicleCount,
    };
  });

  return {
    products,
    pageInfo: {
      hasNextPage: !!pageInfo?.hasNextPage,
      endCursor: pageInfo?.endCursor ? String(pageInfo.endCursor) : null,
    },
    after,
  };
}

export default function Products() {
  const { products, pageInfo } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  const nextHref = (() => {
    if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) return "";
    const sp = new URLSearchParams(searchParams);
    sp.set("after", String(pageInfo.endCursor));
    return `?${sp.toString()}`;
  })();

  return (
    <Page
      title="Products"
      primaryAction={{
        content: "Import CSV",
        url: "/app/import",
      }}
    >
      <BlockStack gap="400">
        <Card>
          <IndexTable
            itemCount={products.length}
            headings={[
              { title: "Image" },
              { title: "Title" },
              { title: "Handle" },
              { title: "SKU" },
              { title: "Article #" },
              { title: "Brand" },
              { title: "Vehicles Assigned" },
              { title: "Action" },
            ]}
            selectable={false}
          >
            {products.map((p, idx) => (
              <IndexTable.Row id={p.id} key={p.id} position={idx}>
                <IndexTable.Cell>
                  <Thumbnail
                    source={p.featuredImageUrl || "https://cdn.shopify.com/static/images/placeholders/product-1.png"}
                    alt={p.featuredImageAlt}
                    size="small"
                  />
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {p.title || "(untitled)"}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">
                    {p.handle}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">
                    {p.sku || "—"}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">
                    {p.article_number || "—"}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">
                    {p.brand || "—"}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">
                    {p.vehicleCount}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Button url={`/app/fitment/${encodeURIComponent(p.handle)}`} variant="primary">
                    Manage
                  </Button>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
        <InlineStack align="end">
          <Pagination
            hasNext={!!pageInfo?.hasNextPage}
            nextURL={nextHref || undefined}
            hasPrevious={false}
          />
        </InlineStack>
      </BlockStack>
    </Page>
  );
}

