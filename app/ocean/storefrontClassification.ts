export type CatalogueProduct = Record<string, any>;
export type Classification = { system: string; group: string; subcategory: string };

function tagValue(tags: unknown, prefix: string) {
  if (!Array.isArray(tags)) return "";
  const tag = tags.find((value) => typeof value === "string" && value.toUpperCase().startsWith(prefix));
  const value = String(tag || "").slice(prefix.length).trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : "";
}

export function classificationFromTags(tags: unknown): Classification {
  return {
    system: tagValue(tags, "CAT:"),
    group: tagValue(tags, "GROUP:"),
    subcategory: tagValue(tags, "SUBCAT:"),
  };
}

export function enrichCatalogueProducts(products: CatalogueProduct[], byId: Map<string, Classification>) {
  return products.map((product) => {
    const classification = byId.get(String(product.shopify_product_id || ""));
    if (!classification) return product;
    return {
      ...product,
      assembly_group_id: product.assembly_group_id || classification.system || null,
      category_id: product.category_id || classification.group || null,
      product_group_id: product.product_group_id || classification.subcategory || null,
    };
  });
}

export function filterLinkedProducts(products: CatalogueProduct[], params: URLSearchParams) {
  const system = params.get("assembly_group_id") || params.get("system_id") || "";
  const category = params.get("category_id") || "";
  const productGroup = params.get("product_group_id") || "";
  return products.filter((product) =>
    (!system || system === "all-compatible" || product.assembly_group_id === system) &&
    (!category || category === "all-compatible" || product.category_id === category) &&
    (!productGroup || productGroup === "all-compatible" ||
      product.product_group_id === productGroup || product.category_id === productGroup),
  );
}

export function systemsFromLinkedProducts(products: CatalogueProduct[]) {
  const systems = new Map<string, { id: string; name: string; article_count: number; pending_fitment_count: number }>();
  for (const product of products) {
    const state = String(product.fitment?.state || "").toLowerCase();
    if (state !== "unverified" && !(state === "verified" && product.fitment?.visible === true)) continue;
    const id = String(product.assembly_group_id || "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) continue;
    if (!systems.has(id)) systems.set(id, {
      id, name: id.replace(/(^|-)[a-z]/g, (part) => part.replace("-", " ").toUpperCase()),
      article_count: 0, pending_fitment_count: 0,
    });
    const system = systems.get(id)!;
    if (state === "verified") system.article_count += 1;
    else system.pending_fitment_count += 1;
  }
  return [...systems.values()];
}

export function productGroupsFromLinkedProducts(products: CatalogueProduct[], systemId: string) {
  const groups = new Map<string, { id: string; name: string; group_id: string; article_count: number; pending_fitment_count: number }>();
  for (const product of products) {
    if (product.assembly_group_id !== systemId) continue;
    const state = String(product.fitment?.state || "").toLowerCase();
    if (state !== "unverified" && !(state === "verified" && product.fitment?.visible === true)) continue;
    const id = String(product.category_id || "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) continue;
    if (!groups.has(id)) groups.set(id, {
      id, name: id.replace(/(^|-)[a-z]/g, (part) => part.replace("-", " ").toUpperCase()),
      group_id: systemId, article_count: 0, pending_fitment_count: 0,
    });
    const group = groups.get(id)!;
    if (state === "verified") group.article_count += 1;
    else group.pending_fitment_count += 1;
  }
  return [...groups.values()];
}
