/**
 * Resolve parent links between catalog metaobjects. Shopify stores use different field keys
 * (`parent_category`, `catalog_main_category`, …). Admin GraphQL returns `fields[]` with `reference.id` + `reference.type`.
 */

export function metaobjectReferenceIdForFieldKey(node: any, key: string): string {
  const fields: any[] = Array.isArray(node?.fields) ? node.fields : [];
  const f = fields.find((x) => String(x?.key ?? "") === key);
  const refId = typeof f?.reference?.id === "string" ? f.reference.id.trim() : "";
  if (refId) return refId;
  const v = typeof f?.value === "string" ? f.value.trim() : "";
  if (v.startsWith("gid://")) return v;
  return "";
}

/** `catalog_system_group` → parent `catalog_main_category` metaobject GID. */
export function parentCatalogCategoryIdFromSystemGroupNode(node: any): string {
  const keysPriority = [
    "catalog_main_category",
    "parent_category",
    "parentCategory",
    "main_category",
    "mainCategory",
    "catalog_category",
    "catalog_main_cat",
    "category",
  ];
  for (const k of keysPriority) {
    const id = metaobjectReferenceIdForFieldKey(node, k);
    if (id) return id;
  }
  const fields = Array.isArray(node?.fields) ? node.fields : [];
  for (const f of fields) {
    const refType = String(f?.reference?.type ?? "").trim().toLowerCase();
    const id = typeof f?.reference?.id === "string" ? f.reference.id.trim() : "";
    if (id && refType === "catalog_main_category") return id;
  }
  for (const f of fields) {
    const key = String(f?.key ?? "").trim().toLowerCase();
    if (!key.includes("main_category") && !key.includes("catalog_category") && !key.includes("parent_category")) continue;
    const id = typeof f?.reference?.id === "string" ? f.reference.id.trim() : "";
    if (id) return id;
  }
  return "";
}

/** `catalog_subcategory` → parent `catalog_system_group` metaobject GID. */
export function catalogSystemGroupIdFromSubcategoryNode(node: any): string {
  const keysPriority = [
    "catalog_system_group",
    "system_group",
    "systemGroup",
    "system_group_ref",
    "parent_system_group",
    "parentSystemGroup",
  ];
  for (const k of keysPriority) {
    const id = metaobjectReferenceIdForFieldKey(node, k);
    if (id) return id;
  }
  const fields = Array.isArray(node?.fields) ? node.fields : [];
  for (const f of fields) {
    const refType = String(f?.reference?.type ?? "").trim().toLowerCase();
    const id = typeof f?.reference?.id === "string" ? f.reference.id.trim() : "";
    if (id && refType === "catalog_system_group") return id;
  }
  for (const f of fields) {
    const key = String(f?.key ?? "").trim().toLowerCase();
    if (!key.includes("system_group") && !key.includes("systemgroup")) continue;
    const id = typeof f?.reference?.id === "string" ? f.reference.id.trim() : "";
    if (id) return id;
  }
  return "";
}
