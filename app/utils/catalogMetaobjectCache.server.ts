/**
 * Short-lived in-memory cache for catalog metaobject lists used by Fitment
 * classification dropdowns. This is NOT fitment authority and must never be
 * used to invent product compatibility.
 */

import {
  LIST_CATALOG_METAOBJECTS,
  LIST_CATALOG_SUBCATEGORIES,
  LIST_CATALOG_SYSTEM_GROUPS,
  LIST_METAOBJECT_LABELS_BY_TYPE,
} from "../graphql/fitment.ts";
import { paginateMetaobjectsDetailed, type MetaobjectNode } from "./paginateMetaobjects.server.ts";
import type { ShopifyGraphqlClient } from "./shopifyGraphql.server.ts";

type CatalogCacheEntry = {
  at: number;
  nodes: MetaobjectNode[];
  incomplete: boolean;
};

const TTL_MS = 5 * 60 * 1000;
const mem = new Map<string, CatalogCacheEntry>();

function cacheKey(shopDomain: string, type: string, mode: string): string {
  return `${String(shopDomain || "").trim().toLowerCase()}::${type}::${mode}`;
}

export async function listCatalogMetaobjectsCached(params: {
  admin: ShopifyGraphqlClient;
  shopDomain: string;
  type: string;
  mode: "labels" | "fields" | "system_groups" | "subcategories";
  sleepFn?: (ms: number) => Promise<void>;
  maxRetries?: number;
}): Promise<{ nodes: MetaobjectNode[]; throttled: boolean; incomplete: boolean; fromCache: boolean }> {
  const key = cacheKey(params.shopDomain, params.type, params.mode);
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < TTL_MS && hit.nodes.length && !hit.incomplete) {
    return { nodes: hit.nodes, throttled: false, incomplete: false, fromCache: true };
  }

  const query =
    params.mode === "labels"
      ? LIST_METAOBJECT_LABELS_BY_TYPE
      : params.mode === "system_groups"
        ? LIST_CATALOG_SYSTEM_GROUPS
        : params.mode === "subcategories"
          ? LIST_CATALOG_SUBCATEGORIES
          : LIST_CATALOG_METAOBJECTS;

  const pageSize = params.mode === "labels" ? 25 : 50;
  const result = await paginateMetaobjectsDetailed({
    admin: params.admin,
    query,
    variables: params.mode === "system_groups" || params.mode === "subcategories" ? {} : { type: params.type },
    pathToConnection: (d) => d?.metaobjects,
    pageSize,
    maxPages: 30,
    maxRetries: params.maxRetries,
    sleepFn: params.sleepFn,
  });

  if (result.nodes.length && !result.throttled && !result.incomplete) {
    mem.set(key, { at: Date.now(), nodes: result.nodes, incomplete: false });
  }

  return {
    nodes: result.nodes,
    throttled: result.throttled,
    incomplete: result.incomplete,
    fromCache: false,
  };
}
