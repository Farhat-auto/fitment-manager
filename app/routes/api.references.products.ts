import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import { referenceKey, referenceValues } from "../utils/referenceLookup";

const ALLOWED_ORIGINS = new Set([
  "https://www.oceancarparts.com",
  "https://oceancarparts.com",
  "https://g5uxzq-gb.myshopify.com",
]);

const PRODUCT_REFERENCES = `#graphql
  query ReferenceProducts($after: String) {
    products(first: 250, after: $after, sortKey: ID) {
      nodes {
        id
        handle
        title
        vendor
        status
        featuredImage { url }
        oe: metafield(namespace: "custom", key: "oe_references") { value }
        cross: metafield(namespace: "custom", key: "cross_references") { value }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

type ReferenceProduct = {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  image: string;
  oe: string[];
  cross: string[];
};

let cached: { shop: string; expires: number; products: ReferenceProduct[] } | null = null;
let loading: Promise<ReferenceProduct[]> | null = null;

async function scanProducts(shop: string): Promise<ReferenceProduct[]> {
  const { admin } = await unauthenticated.admin(shop);
  const products: ReferenceProduct[] = [];
  let after: string | null = null;
  for (let page = 0; page < 40; page += 1) {
    const response = await admin.graphql(PRODUCT_REFERENCES, { variables: { after } });
    const body = await response.json();
    if (!response.ok || body.errors?.length || !body.data?.products) {
      throw new Error("Shopify reference lookup failed");
    }
    for (const product of body.data.products.nodes || []) {
      if (product.status !== "ACTIVE" || !product.handle || !product.id) continue;
      products.push({
        id: String(product.id),
        handle: String(product.handle),
        title: String(product.title || ""),
        vendor: String(product.vendor || ""),
        image: String(product.featuredImage?.url || ""),
        oe: referenceValues(product.oe?.value),
        cross: referenceValues(product.cross?.value),
      });
    }
    if (!body.data.products.pageInfo.hasNextPage) return products;
    after = body.data.products.pageInfo.endCursor;
    if (!after) throw new Error("Incomplete Shopify reference lookup");
  }
  throw new Error("Reference lookup exceeds pagination limit");
}

async function productsForShop(shop: string): Promise<ReferenceProduct[]> {
  if (cached?.shop === shop && cached.expires > Date.now()) return cached.products;
  if (!loading) {
    loading = scanProducts(shop).then((products) => {
      cached = { shop, products, expires: Date.now() + 60_000 };
      return products;
    }).finally(() => { loading = null; });
  }
  return loading;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const origin = request.headers.get("origin") || "";
  const headers = {
    ...(ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const raw = url.searchParams.get("ref") || "";
  if ((kind !== "oe" && kind !== "cross") || raw.length < 3 || raw.length > 120) {
    return json({ ok: false, error: "Invalid reference" }, { status: 400, headers });
  }
  const shop = process.env.SHOPIFY_STORE_DOMAIN || "g5uxzq-gb.myshopify.com";
  const wanted = referenceKey(kind, raw);
  if (wanted.length < 3) {
    return json({ ok: false, error: "Invalid reference" }, { status: 400, headers });
  }
  try {
    const products = (await productsForShop(shop)).filter((product) => {
      const references = kind === "oe" ? product.oe : product.cross;
      return references.some((value) => referenceKey(kind, value) === wanted);
    }).map(({ id, handle, title, vendor, image }) => ({ id, handle, title, vendor, image }));
    return json({ ok: true, kind, reference: raw, products, count: products.length }, { headers });
  } catch (error) {
    console.error("[api.references.products:error]", error);
    return json({ ok: false, error: "Reference lookup is temporarily unavailable" }, { status: 502, headers });
  }
}
