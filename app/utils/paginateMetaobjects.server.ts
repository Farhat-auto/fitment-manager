import {
  adminGraphqlJson,
  sleep,
  waitMsForNextPage,
  type ShopifyGraphqlClient,
} from "./shopifyGraphql.server.ts";

type AdminApiContext = {
  graphql: ShopifyGraphqlClient["graphql"];
};

export type MetaobjectNode = {
  id: string;
  type?: string;
  handle?: string;
  displayName?: string;
  fields?: Array<{
    key?: string;
    value?: string | null;
    reference?: {
      id?: string;
      type?: string;
      displayName?: string;
      name?: { value?: string | null };
      display_name?: { value?: string | null };
    } | null;
  }>;
};

export type PaginateMetaobjectsResult = {
  nodes: MetaobjectNode[];
  throttled: boolean;
  incomplete: boolean;
  pageCount: number;
};

const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_MAX_PAGES = 20;

export async function paginateMetaobjectsDetailed(params: {
  admin: AdminApiContext;
  query: string;
  variables: Record<string, any>;
  pathToConnection: (data: any) => { pageInfo?: any; nodes?: any[] } | null | undefined;
  pageSize?: number;
  maxPages?: number;
  maxRetries?: number;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<PaginateMetaobjectsResult> {
  const pageSize = Math.max(1, Math.min(params.pageSize ?? DEFAULT_PAGE_SIZE, 50));
  const maxPages = Math.max(1, Math.min(params.maxPages ?? DEFAULT_MAX_PAGES, 40));
  const sleepFn = params.sleepFn ?? sleep;

  let after: string | null = null;
  let hasNextPage = true;
  const out: MetaobjectNode[] = [];
  const seen = new Set<string>();
  let throttled = false;
  let pageCount = 0;
  let incomplete = false;

  while (hasNextPage && pageCount < maxPages) {
    const { json, throttled: pageThrottled } = await adminGraphqlJson({
      admin: params.admin,
      query: params.query,
      variables: { ...params.variables, first: pageSize, after },
      maxRetries: params.maxRetries,
      sleepFn,
    });
    pageCount += 1;
    if (pageThrottled) {
      throttled = true;
      incomplete = true;
      break;
    }

    const conn = params.pathToConnection(json?.data);
    const nodes: any[] = Array.isArray(conn?.nodes) ? conn!.nodes! : [];

    for (const n of nodes) {
      const id = typeof n?.id === "string" ? n.id : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(n);
    }

    hasNextPage = !!conn?.pageInfo?.hasNextPage;
    after = typeof conn?.pageInfo?.endCursor === "string" ? conn.pageInfo.endCursor : null;
    if (!after) hasNextPage = false;

    if (hasNextPage) {
      const waitMs = waitMsForNextPage(json);
      if (waitMs > 0) await sleepFn(waitMs);
    }
  }

  if (hasNextPage) incomplete = true;

  return { nodes: out, throttled, incomplete, pageCount };
}

/**
 * Backward-compatible helper: returns nodes only.
 * THROTTLED no longer throws — callers receive whatever was collected.
 */
export async function paginateMetaobjects(params: {
  admin: AdminApiContext;
  query: string;
  variables: Record<string, any>;
  pathToConnection: (data: any) => { pageInfo?: any; nodes?: any[] } | null | undefined;
  pageSize?: number;
  maxPages?: number;
  maxRetries?: number;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<MetaobjectNode[]> {
  const result = await paginateMetaobjectsDetailed(params);
  return result.nodes;
}
