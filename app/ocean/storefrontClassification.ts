export type CatalogueProduct = Record<string, any>;
export type Classification = { system: string; group: string; subcategory: string };

function tagValue(tags: unknown, prefix: string) {
  if (!Array.isArray(tags)) return "";
  const tag = tags.find((value) => typeof value === "string" && value.toUpperCase().startsWith(prefix));
  const value = String(tag || "").slice(prefix.length).trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : "";
}

export function taxonomyIdsMatch(requested: string, actual: unknown) {
  const want = String(requested || "");
  const have = String(actual || "");
  if (!want || want === "all-compatible") return true;
  if (want === have) return true;
  const strip = (value: string) => value.replace(/-system$/, "");
  return Boolean(want && have && strip(want) === strip(have));
}

export function withCanonicalVehicle<T>(payload: T, vehicleKey: string): T {
  if (!payload || typeof payload !== "object") return payload;
  const key = String(vehicleKey || (payload as { vehicle_key?: unknown }).vehicle_key || "");
  if (!key) return payload;
  return {
    ...payload,
    vehicle_key: key,
    ocean_vehicle_id: (payload as { ocean_vehicle_id?: unknown }).ocean_vehicle_id || key,
  };
}

export function normalizeStorefrontProduct(product: CatalogueProduct, vehicleKey = ""): CatalogueProduct {
  const state = String(product.fitment?.state || "unverified").toLowerCase();
  const visible = product.fitment?.visible === true;
  const shopify_fitment = state === "verified" && visible;
  const pending_fitment = state === "unverified";
  const handle = String(product.handle || "").replace(/^\/+|\/+$/g, "");
  const pdp_path = String(product.pdp_path || (handle ? `/products/${handle}` : ""));
  let indication = String(product.compatibility_indication || "");
  if (shopify_fitment) indication = "Fits your vehicle";
  else if (pending_fitment) indication = "Confirmation pending";
  else if (!indication) indication = "Compatibility not confirmed";
  return {
    ...product,
    shopify_product_id: String(product.shopify_product_id || ""),
    shopify_variant_id: String(product.shopify_variant_id || ""),
    sku: String(product.sku || ""),
    brand: String(product.brand || ""),
    handle,
    pdp_path,
    assembly_group_id: product.assembly_group_id || null,
    category_id: product.category_id || null,
    product_group_id: product.product_group_id || null,
    fitment: {
      ...(product.fitment || {}),
      state: product.fitment?.state || "unverified",
      visible,
    },
    shopify_fitment,
    pending_fitment,
    compatibility_indication: indication,
    vehicle_key: vehicleKey || product.vehicle_key || "",
  };
}

export function normalizeStorefrontProducts(products: CatalogueProduct[], vehicleKey = "") {
  return products.map((product) => normalizeStorefrontProduct(product, vehicleKey));
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
    taxonomyIdsMatch(system, product.assembly_group_id) &&
    taxonomyIdsMatch(category, product.category_id) &&
    (!productGroup || productGroup === "all-compatible" ||
      taxonomyIdsMatch(productGroup, product.product_group_id) ||
      taxonomyIdsMatch(productGroup, product.category_id)),
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
    if (!taxonomyIdsMatch(systemId, product.assembly_group_id)) continue;
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
