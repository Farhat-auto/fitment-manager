function numericId(value: unknown): string {
  const raw = String(value ?? "").trim();
  const match = raw.match(/(\d+)\s*$/);
  return match ? match[1] : "";
}

export function shopifyAdminUrl(shop: string, productId: string): { url: string; error: string } {
  const id = numericId(productId);
  const store = String(shop || "").trim().replace(/\.myshopify\.com$/i, "");
  if (!id) return { url: "", error: "Shopify Admin URL failed: Shopify product ID is missing." };
  if (!store) return { url: "", error: "Shopify Admin URL failed: shop domain is missing." };
  return {
    url: `https://admin.shopify.com/store/${encodeURIComponent(store)}/products/${encodeURIComponent(id)}`,
    error: "",
  };
}

export function storefrontUrl(shop: string, handle: string): { url: string; error: string } {
  const domain = String(shop || "").trim();
  const slug = String(handle || "").trim();
  if (!slug) return { url: "", error: "Storefront URL failed: Shopify handle is missing." };
  if (!domain) return { url: "", error: "Storefront URL failed: shop domain is missing." };
  const host = domain.includes(".") ? domain : `${domain}.myshopify.com`;
  return { url: `https://${host}/products/${encodeURIComponent(slug)}`, error: "" };
}

export function odooUrl(base: string, templateId: string, productId: string): { url: string; error: string } {
  const template = String(templateId || "").trim();
  const product = String(productId || "").trim();
  const root = String(base || "").trim().replace(/\/$/, "");
  if (!template && !product) return { url: "", error: "ODOO LINK MISSING" };
  if (!root) return { url: "", error: "Odoo host is not configured." };
  if (template) {
    return {
      url: `${root}/web#id=${encodeURIComponent(template)}&model=product.template&view_type=form`,
      error: "",
    };
  }
  return {
    url: `${root}/web#id=${encodeURIComponent(product)}&model=product.product&view_type=form`,
    error: "",
  };
}

export const LINKER_FILTERS = [
  { id: "", label: "All catalogue articles" },
  { id: "fully_linked", label: "Fully linked" },
  { id: "missing_odoo", label: "Missing Odoo" },
  { id: "missing_shopify", label: "Missing Shopify" },
  { id: "missing_catalogue", label: "Missing Catalogue" },
  { id: "ambiguous", label: "Ambiguous" },
  { id: "missing_taxonomy", label: "Missing taxonomy" },
  { id: "no_verified_fitment", label: "No verified fitment" },
  { id: "sync_pending", label: "Sync pending" },
  { id: "sync_failed", label: "Sync failed" },
] as const;
