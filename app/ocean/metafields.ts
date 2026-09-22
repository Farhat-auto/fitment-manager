export const PRODUCT_IDENTITY_QUERY = `#graphql
  query OceanCarFitmentProduct($id: ID!) {
    product(id: $id) {
      id
      handle
      vendor
      title
      fitmentCount: metafield(namespace: "ocean", key: "fitment_count") { value }
      mpn: metafield(namespace: "custom", key: "mpn") { value }
      variants(first: 5) {
        nodes { id sku barcode }
      }
    }
  }
`;

export const METAFIELDS_SET = `#graphql
  mutation OceanCarFitmentCount($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key }
      userErrors { field message }
    }
  }
`;

export function countMetafields(ownerId: string, count: number) {
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

export function productFromAdminNode(node: any) {
  const variant = (((node || {}).variants || {}).nodes || [])[0] || {};
  return {
    id: String((node && node.id) || ""),
    title: String((node && node.title) || ""),
    handle: String((node && node.handle) || ""),
    vendor: String((node && node.vendor) || ""),
    sku: String(variant.sku || ""),
    barcode: String(variant.barcode || ""),
    mpn: String((node && node.mpn && node.mpn.value) || ""),
    variantId: String(variant.id || ""),
    numericId: String((node && node.id) || "").split("/").pop() || "",
    variantNumericId: String(variant.id || "").split("/").pop() || "",
  };
}
