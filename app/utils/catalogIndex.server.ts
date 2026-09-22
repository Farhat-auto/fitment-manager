import { LIST_CATALOG_METAOBJECTS, LIST_METAOBJECT_LABELS_BY_TYPE } from "../graphql/fitment.ts";
import { getSupabaseAdmin } from "../supabase.server.ts";
import type { CatalogLinkRow } from "./catalogMetaobjectParents.server.ts";
import {
  catalogSystemGroupRefFromSubcategoryNode,
  parentCatalogCategoryRefFromSystemGroupNode,
  probeParentFields,
} from "./catalogMetaobjectParents.server.ts";
import { paginateMetaobjectsDetailed } from "./paginateMetaobjects.server.ts";
import type { ShopifyGraphqlClient } from "./shopifyGraphql.server.ts";

export type CatalogIndexCache = {
  builtAt: number;
  categories: Array<{ value: string; label: string; handle?: string }>;
  systemGroups: CatalogLinkRow[];
  subcategories: CatalogLinkRow[];
  parentFieldProbe: unknown;
};

export type DurableCatalogIndexStore = {
  load(shopDomain: string): Promise<CatalogIndexCache | null>;
  save(shopDomain: string, cache: CatalogIndexCache): Promise<void>;
};

function normShop(shopDomain: string): string {
  return String(shopDomain || "").trim().toLowerCase();
}

function parseCache(row: any): CatalogIndexCache | null {
  const categories = Array.isArray(row?.categories_json) ? row.categories_json : [];
  const systemGroups = Array.isArray(row?.system_groups_json) ? row.system_groups_json : [];
  const subcategories = Array.isArray(row?.subcategories_json) ? row.subcategories_json : [];
  if (!categories.length && !systemGroups.length && !subcategories.length) return null;
  const builtAt = Date.parse(String(row?.built_at ?? "")) || Date.now();
  return {
    builtAt,
    categories,
    systemGroups,
    subcategories,
    parentFieldProbe: row?.parent_field_probe ?? null,
  };
}

const supabaseStore: DurableCatalogIndexStore = {
  async load(shopDomain: string) {
    const shop = normShop(shopDomain);
    if (!shop) return null;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("catalog_index_cache")
      .select("built_at, categories_json, system_groups_json, subcategories_json, parent_field_probe")
      .eq("shop_domain", shop)
      .maybeSingle();
    if (error) throw error;
    return parseCache(data);
  },
  async save(shopDomain: string, cache: CatalogIndexCache) {
    const shop = normShop(shopDomain);
    if (!shop) throw new Error("Missing shop_domain");
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("catalog_index_cache").upsert(
      {
        shop_domain: shop,
        built_at: new Date(cache.builtAt || Date.now()).toISOString(),
        categories_json: cache.categories,
        system_groups_json: cache.systemGroups,
        subcategories_json: cache.subcategories,
        parent_field_probe: cache.parentFieldProbe ?? null,
      },
      { onConflict: "shop_domain" },
    );
    if (error) throw error;
  },
};

let overrideStore: DurableCatalogIndexStore | null = null;

export function setDurableCatalogIndexStoreForTests(store: DurableCatalogIndexStore | null) {
  overrideStore = store;
}

function getStore(): DurableCatalogIndexStore {
  return overrideStore || supabaseStore;
}

function toCategory(n: any) {
  const id = String(n?.id ?? "").trim();
  if (!id) return null;
  return {
    value: id,
    handle: String(n?.handle ?? "").trim(),
    label: String(n?.displayName ?? n?.handle ?? id).trim() || id,
  };
}

function toSystemGroup(n: any): CatalogLinkRow | null {
  const id = String(n?.id ?? "").trim();
  if (!id) return null;
  const parent = parentCatalogCategoryRefFromSystemGroupNode(n);
  return {
    value: id,
    handle: String(n?.handle ?? "").trim(),
    label: String(n?.displayName ?? n?.handle ?? id).trim() || id,
    parentCategoryId: parent?.id || "",
    parentCategoryHandle: parent?.handle || "",
    parentCategoryLabel: parent?.label || parent?.rawValue || "",
  };
}

function toSubcategory(n: any): CatalogLinkRow | null {
  const id = String(n?.id ?? "").trim();
  if (!id) return null;
  const parent = catalogSystemGroupRefFromSubcategoryNode(n);
  return {
    value: id,
    handle: String(n?.handle ?? "").trim(),
    label: String(n?.displayName ?? n?.handle ?? id).trim() || id,
    systemGroupId: parent?.id || "",
    systemGroupHandle: parent?.handle || "",
    systemGroupLabel: parent?.label || parent?.rawValue || "",
  };
}

export async function readCatalogIndex(shopDomain: string): Promise<CatalogIndexCache | null> {
  try {
    return await getStore().load(shopDomain);
  } catch {
    return null;
  }
}

export async function buildCatalogIndexFromShopify(params: {
  admin: ShopifyGraphqlClient;
  shopDomain: string;
  sleepFn?: (ms: number) => Promise<void>;
  maxRetries?: number;
}): Promise<{ cache: CatalogIndexCache | null; throttled: boolean; incomplete: boolean }> {
  const cats = await paginateMetaobjectsDetailed({
    admin: params.admin,
    query: LIST_METAOBJECT_LABELS_BY_TYPE,
    variables: { type: "catalog_main_category" },
    pathToConnection: (d) => d?.metaobjects,
    pageSize: 25,
    maxPages: 20,
    maxRetries: params.maxRetries,
    sleepFn: params.sleepFn,
  });
  const groups = await paginateMetaobjectsDetailed({
    admin: params.admin,
    query: LIST_CATALOG_METAOBJECTS,
    variables: { type: "catalog_system_group" },
    pathToConnection: (d) => d?.metaobjects,
    pageSize: 25,
    maxPages: 30,
    maxRetries: params.maxRetries,
    sleepFn: params.sleepFn,
  });
  const subs = await paginateMetaobjectsDetailed({
    admin: params.admin,
    query: LIST_CATALOG_METAOBJECTS,
    variables: { type: "catalog_subcategory" },
    pathToConnection: (d) => d?.metaobjects,
    pageSize: 25,
    maxPages: 30,
    maxRetries: params.maxRetries,
    sleepFn: params.sleepFn,
  });

  const throttled = cats.throttled || groups.throttled || subs.throttled;
  const incomplete = cats.incomplete || groups.incomplete || subs.incomplete;
  const categories = (cats.nodes || []).map(toCategory).filter(Boolean) as CatalogIndexCache["categories"];
  const systemGroups = (groups.nodes || []).map(toSystemGroup).filter(Boolean) as CatalogLinkRow[];
  const subcategories = (subs.nodes || []).map(toSubcategory).filter(Boolean) as CatalogLinkRow[];
  const parentFieldProbe = groups.nodes[0] ? probeParentFields(groups.nodes[0]) : null;

  if (!categories.length && !systemGroups.length) {
    return { cache: null, throttled, incomplete };
  }

  const cache: CatalogIndexCache = {
    builtAt: Date.now(),
    categories,
    systemGroups,
    subcategories,
    parentFieldProbe,
  };
  if (!throttled && !incomplete) {
    try {
      await getStore().save(params.shopDomain, cache);
    } catch {
      /* keep serving this request even if persist fails */
    }
  }
  return { cache, throttled, incomplete };
}

export async function getCatalogIndex(params: {
  admin: ShopifyGraphqlClient;
  shopDomain: string;
  refresh?: boolean;
  sleepFn?: (ms: number) => Promise<void>;
  maxRetries?: number;
}): Promise<{ cache: CatalogIndexCache | null; throttled: boolean; fromShopify: boolean }> {
  if (!params.refresh) {
    const existing = await readCatalogIndex(params.shopDomain);
    if (existing) return { cache: existing, throttled: false, fromShopify: false };
  }
  const built = await buildCatalogIndexFromShopify(params);
  return { cache: built.cache, throttled: built.throttled, fromShopify: true };
}
