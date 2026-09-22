/**
 * Catalogue hierarchy data contract used by the storefront
 * (`car-parts-catalog-landing.liquid`):
 *
 *   catalog_system_group.parent_category → catalog_main_category
 *   catalog_subcategory.parent_group     → catalog_system_group
 *
 * Admin GraphQL may expose the same link as `fields[]`, aliased `field(key:)`,
 * `value` GID, `jsonValue`, or `references`. None of this is fitment authority.
 */

export function metaobjectIdMatch(a: unknown, b: unknown): boolean {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.endsWith(y) || y.endsWith(x)) return true;
  const nx = x.split("/").pop() || "";
  const ny = y.split("/").pop() || "";
  return Boolean(nx && ny && nx === ny);
}

export function gidFromUnknown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return "";
    if (s.startsWith("gid://")) return s;
    if ((s.startsWith("[") || s.startsWith("{") || s.startsWith('"')) && s.length < 2000) {
      try {
        return gidFromUnknown(JSON.parse(s));
      } catch {
        /* not JSON */
      }
    }
    if (/^\d+$/.test(s)) return s;
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = gidFromUnknown(item);
      if (id) return id;
    }
    return "";
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return (
      gidFromUnknown(rec.id) ||
      gidFromUnknown(rec.gid) ||
      gidFromUnknown(rec.value) ||
      gidFromUnknown((rec as any)?.system?.id)
    );
  }
  return "";
}

export function gidFromMetaobjectField(field: unknown): string {
  if (!field || typeof field !== "object") return "";
  const f = field as Record<string, any>;
  const fromRef = gidFromUnknown(f.reference?.id);
  if (fromRef) return fromRef;
  const refNodes = f.references?.nodes;
  if (Array.isArray(refNodes) && refNodes.length) {
    const fromList = gidFromUnknown(refNodes[0]?.id);
    if (fromList) return fromList;
  }
  const fromValue = gidFromUnknown(f.value);
  if (fromValue) return fromValue;
  return gidFromUnknown(f.jsonValue);
}

function aliasedOrKeyedField(node: any, key: string): unknown {
  if (node && typeof node === "object" && node[key] && typeof node[key] === "object" && !Array.isArray(node[key])) {
    const candidate = node[key];
    if ("value" in candidate || "reference" in candidate || "jsonValue" in candidate || "references" in candidate) {
      return candidate;
    }
  }
  const fields: any[] = Array.isArray(node?.fields) ? node.fields : [];
  return fields.find((x) => String(x?.key ?? "") === key) ?? null;
}

export function metaobjectReferenceIdForFieldKey(node: any, key: string): string {
  return gidFromMetaobjectField(aliasedOrKeyedField(node, key));
}

const SYSTEM_GROUP_PARENT_KEYS = [
  "parent_category",
  "catalog_main_category",
  "parentCategory",
  "main_category",
  "mainCategory",
  "catalog_category",
  "catalog_main_cat",
  "category",
] as const;

const SUBCATEGORY_PARENT_KEYS = [
  "parent_group",
  "group",
  "system_group",
  "catalog_system_group",
  "systemGroup",
  "system_group_ref",
  "parent_system_group",
  "parentSystemGroup",
] as const;

/** `catalog_system_group` → parent `catalog_main_category` metaobject GID. */
export function parentCatalogCategoryIdFromSystemGroupNode(node: any): string {
  for (const k of SYSTEM_GROUP_PARENT_KEYS) {
    const id = metaobjectReferenceIdForFieldKey(node, k);
    if (id) return id;
  }
  const fields = Array.isArray(node?.fields) ? node.fields : [];
  for (const f of fields) {
    const refType = String(f?.reference?.type ?? "").trim().toLowerCase();
    const id = gidFromMetaobjectField(f);
    if (id && refType === "catalog_main_category") return id;
  }
  for (const f of fields) {
    const key = String(f?.key ?? "").trim().toLowerCase();
    if (
      !key.includes("main_category") &&
      !key.includes("catalog_category") &&
      !key.includes("parent_category")
    ) {
      continue;
    }
    const id = gidFromMetaobjectField(f);
    if (id) return id;
  }
  return "";
}

/** `catalog_subcategory` → parent `catalog_system_group` metaobject GID. */
export function catalogSystemGroupIdFromSubcategoryNode(node: any): string {
  for (const k of SUBCATEGORY_PARENT_KEYS) {
    const id = metaobjectReferenceIdForFieldKey(node, k);
    if (id) return id;
  }
  const fields = Array.isArray(node?.fields) ? node.fields : [];
  for (const f of fields) {
    const refType = String(f?.reference?.type ?? "").trim().toLowerCase();
    const id = gidFromMetaobjectField(f);
    if (id && (refType === "catalog_system_group" || refType === "catalog_system-group")) return id;
  }
  for (const f of fields) {
    const key = String(f?.key ?? "").trim().toLowerCase();
    if (
      !key.includes("system_group") &&
      !key.includes("systemgroup") &&
      key !== "parent_group" &&
      key !== "group"
    ) {
      continue;
    }
    const id = gidFromMetaobjectField(f);
    if (id) return id;
  }
  return "";
}

export function systemGroupsForCategory<T extends { parentCategoryId?: string | null }>(
  rows: T[],
  categoryId: string,
): T[] {
  const cat = String(categoryId || "").trim();
  if (!cat) return [];
  const storeHasParentLinks = rows.some((r) => !!String(r.parentCategoryId || "").trim());
  if (!storeHasParentLinks) return [];
  return rows.filter((r) => metaobjectIdMatch(r.parentCategoryId, cat));
}

export function subcategoriesForSystemGroup<T extends { systemGroupId?: string | null }>(
  rows: T[],
  systemGroupId: string,
): T[] {
  const sg = String(systemGroupId || "").trim();
  if (!sg) return [];
  const storeHasLinks = rows.some((r) => !!String(r.systemGroupId || "").trim());
  if (!storeHasLinks) return [];
  return rows.filter((r) => metaobjectIdMatch(r.systemGroupId, sg));
}
