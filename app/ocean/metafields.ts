/** Product identity + compact Ocean status only. Do not fetch Shopify vehicle metafields. */
export const PRODUCT_IDENTITY_QUERY = `#graphql
  query OceanCarFitmentProduct($id: ID!) {
    product(id: $id) {
      id
      handle
      vendor
      title
      description
      productType
      taxonomyCategory: category { name }
      featuredImage { url }
      fitmentCount: metafield(namespace: "ocean", key: "fitment_count") { value }
      fitmentStatus: metafield(namespace: "ocean", key: "fitment_status") { value }
      zeroFitment: metafield(namespace: "ocean", key: "zero_fitment") { value }
      mpn: metafield(namespace: "custom", key: "mpn") { value }
      oeRefs: metafield(namespace: "custom", key: "oe_references") { value }
      category: metafield(namespace: "custom", key: "catalog_main_category") {
        value
        reference { ... on Metaobject { id displayName } }
      }
      systemGroup: metafield(namespace: "custom", key: "catalog_system_group") {
        value
        reference { ... on Metaobject { id displayName } }
      }
      subcategory: metafield(namespace: "custom", key: "catalog_subcategory") {
        value
        reference { ... on Metaobject { id displayName } }
      }
      variants(first: 20) {
        nodes { id sku barcode price inventoryQuantity }
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

/** Resolve a leftover /app/fitment/:handle bookmark to the numeric product ID. Identity only. */
export const PRODUCT_ID_BY_HANDLE_QUERY = `#graphql
  query OceanProductIdByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      handle
    }
  }
`;

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
