/**
 * Short-lived in-memory cache for catalog metaobject lists used by Fitment
 * classification dropdowns. This is NOT fitment authority and must never be
 * used to invent product compatibility.
 */

import { LIST_CATALOG_METAOBJECTS, LIST_METAOBJECT_LABELS_BY_TYPE } from "../graphql/fitment.ts";
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
  mode: "labels" | "fields";
  sleepFn?: (ms: number) => Promise<void>;
  maxRetries?: number;
}): Promise<{ nodes: MetaobjectNode[]; throttled: boolean; incomplete: boolean; fromCache: boolean }> {
  const key = cacheKey(params.shopDomain, params.type, params.mode);
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < TTL_MS && hit.nodes.length && !hit.incomplete) {
    return { nodes: hit.nodes, throttled: false, incomplete: false, fromCache: true };
  }

  const query = params.mode === "labels" ? LIST_METAOBJECT_LABELS_BY_TYPE : LIST_CATALOG_METAOBJECTS;
  const result = await paginateMetaobjectsDetailed({
    admin: params.admin,
    query,
    variables: { type: params.type },
    pathToConnection: (d) => d?.metaobjects,
    pageSize: 25,
    maxPages: 20,
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
