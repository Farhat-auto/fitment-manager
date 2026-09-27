import { unauthenticated } from "../shopify.server";
import { classificationFromTags, enrichCatalogueProducts, type CatalogueProduct, type Classification } from "./storefrontClassification";
export { systemsFromLinkedProducts } from "./storefrontClassification";

const QUERY = `#graphql
  query StorefrontClassification($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Product { id status tags productType } }
  }
`;

const SHOP_DOMAIN = "g5uxzq-gb.myshopify.com";
const MAX_PRODUCTS = 50;
const CACHE_MS = 15_000;
const cache = new Map<string, { expires: number; classification: Classification }>();

export async function classifyCatalogueProducts(products: CatalogueProduct[]) {
  if (!products.length || products.length > MAX_PRODUCTS) return products;
  const ids = [...new Set(products.filter((product) =>
    !product.assembly_group_id || !product.category_id || !product.product_group_id,
  ).map((product) => String(product.shopify_product_id || "")).filter((id) => /^\d+$/.test(id)))];
  if (!ids.length) return products;
  const now = Date.now();
  const missing = ids.filter((id) => !cache.get(id) || cache.get(id)!.expires <= now);
  if (missing.length) {
    try {
      const { admin } = await unauthenticated.admin(process.env.STOREFRONT_SHOPIFY_DOMAIN || SHOP_DOMAIN);
      const response = await admin.graphql(QUERY, {
        variables: { ids: missing.map((id) => `gid://shopify/Product/${id}`) },
      });
      const result: any = await response.json();
      if (!response.ok || result.errors?.length || !Array.isArray(result.data?.nodes)) {
        throw new Error("Shopify classification lookup failed");
      }
      for (const node of result.data.nodes) {
        const id = String(node?.id || "").split("/").pop() || "";
        if (!missing.includes(id) || node.status !== "ACTIVE") continue;
        const classification = classificationFromTags(node.tags);
        const tags = Array.isArray(node.tags) ? node.tags.map((tag: unknown) => String(tag).toLowerCase()) : [];
        const productType = String(node.productType || "").toLowerCase();
        if (!classification.system && (tags.includes("suspension") || /shock\s*absorber/.test(productType))) {
          classification.system = "suspension-system";
        }
        if (!classification.group && (tags.some((tag: string) => tag.includes("shock absorber")) || /shock\s*absorber/.test(productType))) {
          classification.group = "shock-absorbers";
        }
        if (!classification.subcategory && classification.group === "shock-absorbers") {
          classification.subcategory = "shock-absorbers-parts";
        }
        cache.set(id, { expires: now + CACHE_MS, classification });
      }
      if (cache.size > 500) cache.clear();
    } catch (error) {
      console.warn("STOREFRONT_CLASSIFICATION_LOOKUP_FAILED", error);
    }
  }
  const current = new Map<string, Classification>();
  for (const id of ids) {
    const entry = cache.get(id);
    if (entry && entry.expires > now) current.set(id, entry.classification);
  }
  return enrichCatalogueProducts(products, current);
}
