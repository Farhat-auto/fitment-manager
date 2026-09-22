export const PRODUCT_QUERY = `
query OceanCarFitmentProduct($id: ID!) {
  product(id: $id) {
    id
    handle
    vendor
    fitmentCount: metafield(namespace: "ocean", key: "fitment_count") { value }
    variants(first: 5) {
      nodes { id sku barcode }
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
  const variant = (((node || {}).variants || {}).nodes || [])[0] || {};
  return {
    id: (node && node.id) || "",
    handle: (node && node.handle) || "",
    vendor: (node && node.vendor) || "",
    sku: variant.sku || "",
    barcode: variant.barcode || "",
    variantId: variant.id || "",
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
