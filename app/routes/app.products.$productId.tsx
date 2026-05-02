import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useLocation, useNavigate, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  TextField,
  FormLayout,
  InlineStack,
  IndexTable,
  Thumbnail,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getSupabaseAdmin } from "../supabase.server";

function normalizeProductId(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    // Deep links can pass URL-encoded GIDs from extensions.
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

type FitmentRow = {
  id: string;
  shop: string;
  product_id: string;
  product_title: string | null;
  make: string;
  model: string;
  year_from: number | null;
  year_to: number | null;
  engine: string | null;
  variant: string | null;
  body_type: string | null;
  created_at: string;
};

const GET_PRODUCT_BASIC = `#graphql
  query ProductBasic($id: ID!) {
    product(id: $id) {
      id
      title
      featuredImage {
        url
        altText
      }
    }
  }
`;

function parseIntOrNull(v: FormDataEntryValue | null): number | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  let admin;
  let session;

  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (error) {
    if (error instanceof Response) throw error;
    throw error;
  }

  const rawProductId = params.productId ?? "";
  const decodedProductId = normalizeProductId(rawProductId);
  const { gid: shopifyProductGid, numericId } = toShopifyProductGid(decodedProductId);
  try {
    console.error("PRODUCT_LOOKUP_DEBUG", {
      rawProductId,
      decodedProductId,
      shopifyProductGid,
      shop: session.shop,
    });

    if (!decodedProductId) throw new Response("Missing productId", { status: 400 });
    if (!shopifyProductGid || !numericId || !/^\d+$/.test(numericId)) {
      throw new Response("Invalid productId (expected numeric product ID)", { status: 404 });
    }

    const shop = String(session.shop || "").trim();
    if (!shop) throw new Response("Missing shop", { status: 400 });

    const resp = await admin.graphql(GET_PRODUCT_BASIC, {
      variables: { id: shopifyProductGid },
    });
    const gql = await resp.json();
    const p = gql?.data?.product;
    if (!p) throw new Response("Product not found", { status: 404 });

    const supabase = getSupabaseAdmin();
    const { data: fitments, error } = await supabase
      .from("fitments")
      .select(
        "id,shop,product_id,product_title,make,model,year_from,year_to,engine,variant,body_type,created_at",
      )
      .eq("shop", shop)
      .eq("product_id", shopifyProductGid)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Response(error.message, { status: 500 });
    }

    return json({
      product: {
        id: String(p.id),
        title: String(p.title ?? ""),
        featuredImageUrl: String(p.featuredImage?.url ?? ""),
        featuredImageAlt: String(p.featuredImage?.altText ?? p.title ?? ""),
      },
      fitments: (fitments ?? []) as FitmentRow[],
    });
  } catch (error) {
    console.error("FITMENT_PRODUCT_ROUTE_ERROR", {
      productIdParam: rawProductId,
      decodedProductId,
      shopifyProductGid,
      numericId,
      error,
    });
    throw error;
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const rawProductId = params.productId ?? "";
  const decodedProductId = normalizeProductId(rawProductId);
  const { gid: shopifyProductGid, numericId } = toShopifyProductGid(decodedProductId);
  try {
    const { session } = await authenticate.admin(request);

    if (!decodedProductId) throw new Response("Missing productId", { status: 400 });
    if (!shopifyProductGid || !numericId || !/^\d+$/.test(numericId)) {
      return json({ ok: false, error: "Invalid productId (expected numeric product ID)" }, { status: 404 });
    }

    const fd = await request.formData();

    const shop = String(session.shop || "").trim();
    if (!shop) throw new Response("Missing shop", { status: 400 });
    const make = str(fd.get("make"));
    const model = str(fd.get("model"));
    const year_from = parseIntOrNull(fd.get("year_from"));
    const year_to = parseIntOrNull(fd.get("year_to"));
    const engine = str(fd.get("engine")) || null;
    const variant = str(fd.get("variant")) || null;
    const body_type = str(fd.get("body_type")) || null;

    if (!make || !model) {
      return json(
        { ok: false, error: "make and model are required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("fitments").insert({
      shop,
      product_id: shopifyProductGid,
      make,
      model,
      year_from,
      year_to,
      engine,
      variant,
      body_type,
    });

    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 });
    }

    const url = new URL(request.url);
    return redirect(`/app/products/${encodeURIComponent(numericId)}${url.search}`);
  } catch (error) {
    console.error("FITMENT_PRODUCT_ROUTE_ERROR", {
      productIdParam: rawProductId,
      decodedProductId,
      shopifyProductGid,
      numericId,
      error,
    });
    throw error;
  }
}

export default function ProductFitment() {
  const { product, fitments } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <Page
      title={`${product.title} — Fitment`}
      backAction={{
        content: "Back to Products",
        onAction: () => navigate(`/app/products${location.search || ""}`),
      }}
    >
      <BlockStack gap="400">
        <Card>
          <InlineStack gap="300" blockAlign="center">
            <Thumbnail
              source={
                product.featuredImageUrl ||
                "https://cdn.shopify.com/static/images/placeholders/product-1.png"
              }
              alt={product.featuredImageAlt}
              size="medium"
            />
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                {product.title}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {product.id}
              </Text>
            </BlockStack>
          </InlineStack>
        </Card>

        <Card>
          <Form method="post">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Add fitment
              </Text>
              <FormLayout>
                <FormLayout.Group>
                  <TextField name="make" label="Make" autoComplete="off" requiredIndicator />
                  <TextField name="model" label="Model" autoComplete="off" requiredIndicator />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField name="year_from" label="Year from" type="number" autoComplete="off" />
                  <TextField name="year_to" label="Year to" type="number" autoComplete="off" />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField name="engine" label="Engine" autoComplete="off" />
                  <TextField name="variant" label="Variant" autoComplete="off" />
                  <TextField name="body_type" label="Body type" autoComplete="off" />
                </FormLayout.Group>
              </FormLayout>
              <InlineStack align="end">
                <Button submit variant="primary" loading={isSubmitting}>
                  Save fitment
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Existing fitments ({fitments.length})
            </Text>
            <IndexTable
              itemCount={fitments.length}
              headings={[
                { title: "Make" },
                { title: "Model" },
                { title: "Years" },
                { title: "Engine" },
                { title: "Variant" },
                { title: "Body type" },
              ]}
              selectable={false}
            >
              {fitments.map((f, idx) => (
                <IndexTable.Row id={f.id} key={f.id} position={idx}>
                  <IndexTable.Cell>{f.make}</IndexTable.Cell>
                  <IndexTable.Cell>{f.model}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {(f.year_from ?? "—").toString()} - {(f.year_to ?? "—").toString()}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{f.engine ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{f.variant ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{f.body_type ?? "—"}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
