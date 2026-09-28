export const PRODUCT_IDENTITY_QUERY = `#graphql
  query OceanCarFitmentProduct($id: ID!) {
    product(id: $id) {
      id
      handle
      status
      vendor
      title
      description
      productType
      category { name }
      featuredImage { url }
      fitmentCount: metafield(namespace: "ocean", key: "fitment_count") { value }
      fitmentStatus: metafield(namespace: "ocean", key: "fitment_status") { value }
      verifiedKeys: metafield(namespace: "ocean", key: "verified_vehicle_keys") { value }
      fitmentKeys: metafield(namespace: "custom", key: "fitment_keys") { value }
      mpn: metafield(namespace: "custom", key: "mpn") { value }
      articleNumber: metafield(namespace: "custom", key: "article_number") { value }
      crossRefs: metafield(namespace: "custom", key: "cross_references") { value }
      catalogCategory: metafield(namespace: "custom", key: "catalog_main_category") {
        value
        reference { ... on Metaobject { id displayName } }
      }
      catalogItemCategory: metafield(namespace: "custom", key: "catalog_system_group") {
        value
        reference { ... on Metaobject { id displayName } }
      }
      catalogSubcategory: metafield(namespace: "custom", key: "catalog_subcategory") {
        value
        reference { ... on Metaobject { id displayName } }
      }
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

export function verifiedVehicleKeys(fitments: unknown): string[] {
  const rows = Array.isArray(fitments) ? fitments : [];
  const vehicleKeys: string[] = [];
  for (const row of rows as any[]) {
    const status = String(row?.verification_status || row?.verificationStatus || "").trim().toUpperCase();
    const verified = row?.public_fits === true || row?.visible === true || status === "VERIFIED";
    if (!verified) continue;
    const value = String(row?.ocean_vehicle_id || row?.vehicle_key || row?.vehicle_id || row?.vehicle_handle || "").trim();
    if (!value || /^(unknown|null|undefined)$/i.test(value) || /^\d+$/.test(value)) continue;
    if (!vehicleKeys.includes(value)) vehicleKeys.push(value);
  }
  return vehicleKeys;
}

function fieldText(value: unknown) {
  return String(value ?? "").trim();
}

function verifiedFitment(row: Record<string, unknown>) {
  const status = fieldText(row.verification_status || row.verificationStatus).toUpperCase();
  return row.public_fits === true || row.visible === true || status === "VERIFIED";
}

/** Catalogue path for the products-page filter. Make and model are required, so a bare chassis code is not a choice. */
export function catalogueVehicleLabel(row: Record<string, unknown>) {
  const make = fieldText(row.make_name || row.make);
  const model = fieldText(row.model_name || row.model);
  if (!make || !model) return "";
  const generation = fieldText(row.generation_name || row.generation);
  const engine = fieldText(row.engine_code || row.engine);
  return [make, model, generation, engine].filter(Boolean).join(" / ");
}

export function linkedVehicleLabels(fitments: unknown) {
  const rows = Array.isArray(fitments) ? fitments : [];
  const labels: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (!verifiedFitment(record)) continue;
    const label = catalogueVehicleLabel(record);
    if (!label || labels.includes(label)) continue;
    labels.push(label);
  }
  return labels.slice(0, 128);
}

export function linkedVehicleFilterMetafield(ownerId: string, fitments: unknown) {
  return {
    ownerId,
    namespace: "custom",
    key: "linked_vehicle",
    type: "list.single_line_text_field",
    value: JSON.stringify(linkedVehicleLabels(fitments)),
  };
}

export const ENSURE_LINKED_VEHICLE_DEFINITION = `#graphql
  mutation EnsureLinkedVehicleDefinition {
    metafieldDefinitionCreate(
      definition: {
        name: "Vehicle"
        namespace: "custom"
        key: "linked_vehicle"
        description: "Catalogue vehicle linked to this product: make / model / generation / engine."
        type: "list.single_line_text_field"
        ownerType: PRODUCT
        pin: true
        capabilities: { adminFilterable: { enabled: true } }
      }
    ) {
      createdDefinition { id }
      userErrors { code message }
    }
  }
`;

let linkedVehicleFilterReady = false;

export async function ensureLinkedVehicleFilter(admin: {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<{ json: () => Promise<unknown> }>;
}) {
  if (linkedVehicleFilterReady) return { ok: true };
  const response = await admin.graphql(ENSURE_LINKED_VEHICLE_DEFINITION);
  const body = (await response.json()) as {
    data?: { metafieldDefinitionCreate?: { userErrors?: Array<{ code?: string; message?: string }> } };
  };
  const errors = body?.data?.metafieldDefinitionCreate?.userErrors ?? [];
  const blocking = errors.filter((error) => {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    return code !== "TAKEN" && !/already exists|taken|in use/i.test(message);
  });
  if (!blocking.length) {
    linkedVehicleFilterReady = true;
    return { ok: true };
  }
  return { ok: false, userErrors: blocking };
}

export function fitmentVehicleMetafields(ownerId: string, fitments: unknown) {
  return catalogueFitmentMetafields(ownerId, verifiedVehicleKeys(fitments)).filter(
    (field) => field.namespace === "ocean" && field.key === "verified_vehicle_keys",
  );
}

/** Single Shopify writer payload for verified catalogue fitment. */
export function catalogueFitmentMetafields(ownerId: string, vehicleKeys: string[]) {
  const keys = [...new Set((vehicleKeys || []).map((value) => String(value || "").trim()).filter(Boolean))];
  const value = JSON.stringify(keys);
  const count = String(keys.length);
  return [
    { ownerId, namespace: "ocean", key: "verified_vehicle_keys", type: "json", value },
    { ownerId, namespace: "custom", key: "fitment_keys", type: "json", value },
    { ownerId, namespace: "ocean", key: "fitment_count", type: "number_integer", value: count },
    { ownerId, namespace: "ocean", key: "fitment_status", type: "single_line_text_field", value: keys.length ? "verified" : "none" },
  ];
}

/** @deprecated Use catalogueFitmentMetafields. This helper must not be a second writer. */
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
