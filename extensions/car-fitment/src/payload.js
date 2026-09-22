export const PRODUCT_QUERY = `
query OceanCarFitmentProduct($id: ID!) {
  product(id: $id) {
    id
    handle
    vendor
    title
    description
    productType
    category { name }
    featuredImage { url }
    images(first: 6) { nodes { url } }
    fitmentCount: metafield(namespace: "ocean", key: "fitment_count") { value }
    fitmentStatus: metafield(namespace: "ocean", key: "fitment_status") { value }
    zeroFitment: metafield(namespace: "ocean", key: "zero_fitment") { value }
    mpn: metafield(namespace: "custom", key: "mpn") { value }
    oeRefs: metafield(namespace: "custom", key: "oe_references") { value }
    crossRefs: metafield(namespace: "custom", key: "cross_references") { value }
    legacyVehicles: metafield(namespace: "fitment", key: "vehicles") { value }
    customVehicles: metafield(namespace: "custom", key: "compatible_vehicles") { value }
    variants(first: 20) {
      nodes {
        id
        sku
        barcode
        price
        inventoryQuantity
      }
    }
  }
}
`;

export const METAFIELDS_SET = `
mutation OceanCarFitmentCount($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id key }
    userErrors { field message }
  }
}
`;

export function productFromNode(node) {
  const variants = (((node || {}).variants || {}).nodes || []);
  const variant = variants[0] || {};
  const images = ((((node || {}).images || {}).nodes) || []).map((row) => row.url).filter(Boolean);
  if ((node || {}).featuredImage && (node || {}).featuredImage.url) {
    images.unshift(node.featuredImage.url);
  }
  return {
    id: (node && node.id) || "",
    handle: (node && node.handle) || "",
    vendor: (node && node.vendor) || "",
    title: (node && node.title) || "",
    description: (node && node.description) || "",
    productType: (node && node.productType) || "",
    category: (node && node.category && node.category.name) || "",
    sku: variant.sku || "",
    barcode: variant.barcode || "",
    price: variant.price || "",
    inventory: variant.inventoryQuantity,
    mpn: ((node && node.mpn) || {}).value || "",
    oeRefs: ((node && node.oeRefs) || {}).value || "",
    crossRefs: ((node && node.crossRefs) || {}).value || "",
    legacyVehicles: ((node && node.legacyVehicles) || {}).value || "",
    customVehicles: ((node && node.customVehicles) || {}).value || "",
    oceanCount: ((node && node.fitmentCount) || {}).value || "",
    images: Array.from(new Set(images)),
    variantId: variant.id || "",
    variantIds: variants.map((row) => String(row.id || "").split("/").pop()).filter(Boolean),
    numericId: String((node && node.id) || "").split("/").pop(),
    variantNumericId: String(variant.id || "").split("/").pop(),
  };
}

export function countMetafields(ownerId, count) {
  const n = Number(count) || 0;
  return [
    {
      ownerId,
      namespace: "ocean",
      key: "fitment_count",
      type: "number_integer",
      value: String(n),
    },
    {
      ownerId,
      namespace: "ocean",
      key: "fitment_status",
      type: "single_line_text_field",
      value: "Fitment: " + n + " vehicles",
    },
    {
      ownerId,
      namespace: "ocean",
      key: "zero_fitment",
      type: "boolean",
      value: n === 0 ? "true" : "false",
    },
  ];
}
