type AdminApiContext = {
  graphql: (query: string, options?: any) => Promise<any>;
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

export async function paginateMetaobjects(params: {
  admin: AdminApiContext;
  query: string;
  variables: Record<string, any>;
  pathToConnection: (data: any) => { pageInfo?: any; nodes?: any[] } | null | undefined;
  pageSize?: number;
}): Promise<MetaobjectNode[]> {
  const { admin, query, variables, pathToConnection, pageSize = 250 } = params;

  let after: string | null = null;
  let hasNextPage = true;
  const out: MetaobjectNode[] = [];
  const seen = new Set<string>();

  while (hasNextPage) {
    const resp = await admin.graphql(query, {
      variables: { ...variables, first: pageSize, after },
    });
    const json = await resp.json();
    const conn = pathToConnection(json?.data);
    const nodes: any[] = Array.isArray(conn?.nodes) ? conn!.nodes! : [];

    for (const n of nodes) {
      const id = typeof n?.id === "string" ? n.id : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(n);
    }

    hasNextPage = !!conn?.pageInfo?.hasNextPage;
    after = typeof conn?.pageInfo?.endCursor === "string" ? conn.pageInfo.endCursor : null;
  }

  return out;
}

