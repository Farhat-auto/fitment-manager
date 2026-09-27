export const PRODUCT_IDENTITY_QUERY = `#graphql
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
      fitmentCount: metafield(namespace: "ocean", key: "fitment_count") { value }
      mpn: metafield(namespace: "custom", key: "mpn") { value }
      oeRefs: metafield(namespace: "custom", key: "oe_references") { value }
      legacyVehicles: metafield(namespace: "fitment", key: "vehicles") { value }
      customVehicles: metafield(namespace: "custom", key: "compatible_vehicles") { value }
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

export function fitmentVehicleMetafields(ownerId: string, fitments: unknown) {
  const rows = Array.isArray(fitments) ? fitments : [];
  const vehicleKeys = [...new Set(rows.filter((row: any) => {
    const status = String(row?.verification_status || row?.verificationStatus || "").trim().toUpperCase();
    const source = String(row?.source || "").trim().toLowerCase();
    return row?.public_fits === true || row?.visible === true || status === "VERIFIED" || (source === "manual" && status !== "NEEDS_REVIEW");
  }).map((row: any) => String(row?.ocean_vehicle_id || row?.vehicle_key || row?.vehicle_id || row?.vehicle_handle || "").trim())
    .filter((value) => value && !/^(unknown|null|undefined)$/i.test(value) && !/^\d+$/.test(value)))];
  return [{ ownerId, namespace: "ocean", key: "verified_vehicle_keys", type: "json", value: JSON.stringify(vehicleKeys) }];
}

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
