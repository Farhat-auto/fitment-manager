/**
 * Catalogue parent-link contract used by the storefront:
 *   catalog_system_group.parent_category → catalog_main_category
 *   catalog_subcategory.parent_group     → catalog_system_group
 *
 * Admin GraphQL may return that link as reference.id, value GID, JSON, handle,
 * or display name. Parse every representation; never invent a parent.
 */

export type CatalogParentRef = {
  id: string;
  handle: string;
  label: string;
  rawValue: string;
  fieldKey: string;
  representation: string;
};

export type CatalogIdentity = {
  id?: string;
  handle?: string;
  label?: string;
};

function norm(v: unknown): string {
  return String(v ?? "").trim();
}

export function metaobjectIdMatch(a: unknown, b: unknown): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.endsWith(y) || y.endsWith(x)) return true;
  const nx = x.split("/").pop() || "";
  const ny = y.split("/").pop() || "";
  return Boolean(nx && ny && nx === ny);
}

function normLabel(v: unknown): string {
  return norm(v).toLowerCase().replace(/\s+/g, " ");
}

function handleize(v: unknown): string {
  return norm(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function catalogIdentityMatch(parent: CatalogParentRef | null | undefined, category: CatalogIdentity): boolean {
  if (!parent) return false;
  const keys = [category.id, category.handle, category.label].map(norm).filter(Boolean);
  if (!keys.length) return false;
  const parentKeys = [parent.id, parent.handle, parent.label, parent.rawValue].map(norm).filter(Boolean);
  for (const a of parentKeys) {
    for (const b of keys) {
      if (metaobjectIdMatch(a, b)) return true;
      if (normLabel(a) && normLabel(a) === normLabel(b)) return true;
      if (handleize(a) && handleize(a) === handleize(b)) return true;
    }
  }
  return false;
}

export function resolveCatalogIdentity(
  categories: Array<{ value: string; label: string; handle?: string }>,
  selected: CatalogIdentity,
): CatalogIdentity {
  const hit = (categories || []).find((c) =>
    catalogIdentityMatch(
      {
        id: c.value,
        handle: c.handle || "",
        label: c.label,
        rawValue: c.value,
        fieldKey: "self",
        representation: "category",
      },
      selected,
    ),
  );
  if (!hit) return { id: selected.id || "", handle: selected.handle || "", label: selected.label || "" };
  return {
    id: hit.value || selected.id || "",
    handle: hit.handle || selected.handle || "",
    label: hit.label || selected.label || "",
  };
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

function textHandleOrLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const s = value.trim();
  if (!s) return "";
  if (s.startsWith("gid://")) return "";
  if (s.startsWith("[") || s.startsWith("{")) return "";
  return s;
}

export function catalogParentRefFromField(field: unknown, fieldKey: string): CatalogParentRef | null {
  if (!field || typeof field !== "object") return null;
  const f = field as Record<string, any>;
  const ref = f.reference && typeof f.reference === "object" ? f.reference : null;
  const refNode = Array.isArray(f.references?.nodes) ? f.references.nodes[0] : null;
  const target = ref || refNode || null;
  const id =
    gidFromUnknown(target?.id) ||
    gidFromUnknown(f.value) ||
    gidFromUnknown(f.jsonValue);
  const handle = norm(target?.handle) || textHandleOrLabel(f.value);
  const label = norm(target?.displayName) || (!handle ? textHandleOrLabel(f.value) : "");
  const rawValue = typeof f.value === "string" ? f.value.trim() : rawJson(f.jsonValue);
  if (!id && !handle && !label && !rawValue) return null;

  let representation = "empty";
  if (gidFromUnknown(ref?.id)) representation = "reference.id";
  else if (gidFromUnknown(refNode?.id)) representation = "references.nodes.id";
  else if (typeof f.value === "string" && f.value.trim().startsWith("gid://")) representation = "value.gid";
  else if (typeof f.value === "string" && f.value.trim().startsWith("[")) representation = "value.json_gid_array";
  else if (handle && !id) representation = "value.handle_or_label";
  else if (gidFromUnknown(f.jsonValue)) representation = "jsonValue.gid";
  else if (id) representation = "value.parsed_gid";

  return {
    id,
    handle,
    label,
    rawValue,
    fieldKey,
    representation,
  };
}

function rawJson(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

function aliasedOrKeyedField(node: any, key: string): unknown {
  if (node && typeof node === "object" && node[key] && typeof node[key] === "object" && !Array.isArray(node[key])) {
    const candidate = node[key];
    if ("value" in candidate || "reference" in candidate || "jsonValue" in candidate || "references" in candidate) {
      return candidate;
    }
  }
  const fields: any[] = Array.isArray(node?.fields) ? node.fields : [];
  return fields.find((x: any) => String(x?.key ?? "") === key) ?? null;
}

export function metaobjectReferenceIdForFieldKey(node: any, key: string): string {
  return catalogParentRefFromField(aliasedOrKeyedField(node, key), key)?.id || "";
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

export function parentCatalogCategoryRefFromSystemGroupNode(node: any): CatalogParentRef | null {
  for (const k of SYSTEM_GROUP_PARENT_KEYS) {
    const ref = catalogParentRefFromField(aliasedOrKeyedField(node, k), k);
    if (ref) return ref;
  }
  const fields = Array.isArray(node?.fields) ? node.fields : [];
  for (const f of fields) {
    const refType = String(f?.reference?.type ?? "").trim().toLowerCase();
    const ref = catalogParentRefFromField(f, String(f?.key ?? ""));
    if (ref && refType === "catalog_main_category") return ref;
  }
  for (const f of fields) {
    const key = String(f?.key ?? "").trim().toLowerCase();
    if (
      !key.includes("main_category") &&
      !key.includes("catalog_category") &&
      !key.includes("parent_category") &&
      key !== "category"
    ) {
      continue;
    }
    const ref = catalogParentRefFromField(f, String(f?.key ?? ""));
    if (ref) return ref;
  }
  return null;
}

export function parentCatalogCategoryIdFromSystemGroupNode(node: any): string {
  const ref = parentCatalogCategoryRefFromSystemGroupNode(node);
  return ref?.id || ref?.handle || ref?.rawValue || "";
}

export function catalogSystemGroupRefFromSubcategoryNode(node: any): CatalogParentRef | null {
  for (const k of SUBCATEGORY_PARENT_KEYS) {
    const ref = catalogParentRefFromField(aliasedOrKeyedField(node, k), k);
    if (ref) return ref;
  }
  const fields = Array.isArray(node?.fields) ? node.fields : [];
  for (const f of fields) {
    const refType = String(f?.reference?.type ?? "").trim().toLowerCase();
    const ref = catalogParentRefFromField(f, String(f?.key ?? ""));
    if (ref && (refType === "catalog_system_group" || refType === "catalog_system-group")) return ref;
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
    const ref = catalogParentRefFromField(f, String(f?.key ?? ""));
    if (ref) return ref;
  }
  return null;
}

export function catalogSystemGroupIdFromSubcategoryNode(node: any): string {
  const ref = catalogSystemGroupRefFromSubcategoryNode(node);
  return ref?.id || ref?.handle || ref?.rawValue || "";
}

export type CatalogLinkRow = {
  value: string;
  label: string;
  handle?: string;
  parentCategoryId?: string;
  parentCategoryHandle?: string;
  parentCategoryLabel?: string;
  systemGroupId?: string;
  systemGroupHandle?: string;
  systemGroupLabel?: string;
};

export function systemGroupsForCategory(rows: CatalogLinkRow[], category: CatalogIdentity | string): CatalogLinkRow[] {
  const ident: CatalogIdentity = typeof category === "string" ? { id: category } : category || {};
  const hasParent = rows.some(
    (r) => !!(r.parentCategoryId || r.parentCategoryHandle || r.parentCategoryLabel),
  );
  if (!hasParent) return [];
  return rows.filter((r) =>
    catalogIdentityMatch(
      {
        id: r.parentCategoryId || "",
        handle: r.parentCategoryHandle || "",
        label: r.parentCategoryLabel || "",
        rawValue: r.parentCategoryId || r.parentCategoryHandle || r.parentCategoryLabel || "",
        fieldKey: "parent_category",
        representation: "cached",
      },
      ident,
    ),
  );
}

export function subcategoriesForSystemGroup(rows: CatalogLinkRow[], systemGroup: CatalogIdentity | string): CatalogLinkRow[] {
  const ident: CatalogIdentity = typeof systemGroup === "string" ? { id: systemGroup } : systemGroup || {};
  const hasParent = rows.some((r) => !!(r.systemGroupId || r.systemGroupHandle || r.systemGroupLabel));
  if (!hasParent) return [];
  return rows.filter((r) =>
    catalogIdentityMatch(
      {
        id: r.systemGroupId || "",
        handle: r.systemGroupHandle || "",
        label: r.systemGroupLabel || "",
        rawValue: r.systemGroupId || r.systemGroupHandle || r.systemGroupLabel || "",
        fieldKey: "parent_group",
        representation: "cached",
      },
      ident,
    ),
  );
}

export function probeParentFields(node: any): Array<{ key: string; type?: string; value?: string; hasReference: boolean; representation: string }> {
  const fields: any[] = Array.isArray(node?.fields) ? node.fields : [];
  return fields.map((f) => {
    const ref = catalogParentRefFromField(f, String(f?.key ?? ""));
    return {
      key: String(f?.key ?? ""),
      type: typeof f?.type === "string" ? f.type : undefined,
      value: typeof f?.value === "string" ? f.value.slice(0, 120) : undefined,
      hasReference: Boolean(f?.reference?.id),
      representation: ref?.representation || "unparsed",
    };
  });
}
