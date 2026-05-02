/**
 * After saving catalog metaobject references on a product, derive storefront-facing keys + tags so:
 * - Theme filters (`filter.p.m.custom.catalog_*_key`) match metaobject slug/handle (same as car-parts JSON).
 * - Tag-based `/search?q=tag:CAT:…` listings work without manual theme edits.
 */

type AdminGraphql = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

const CLASSIFICATION_TAG_RE = /^(CAT|GROUP|SUBCAT):/i;

/** String value from a metaobject field (supports plain string or JSON-encoded string in some APIs). */
function metaobjectFieldStringValue(f: any): string {
  if (!f || typeof f !== "object") return "";
  const raw = f?.value;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  const jv = (f as any)?.jsonValue;
  if (jv === null || jv === undefined) {
    /* noop */
  } else if (typeof jv === "string" && jv.trim()) {
    return jv.trim();
  } else if (typeof jv === "object" && typeof (jv as any).value === "string") {
    return String((jv as any).value).trim();
  }
  return "";
}

/**
 * Mirrors storefront JSON in `car-parts-catalog-landing.liquid`:
 * `item.slug.value | default: item.slug | default: item.system.handle`
 * Admin GraphQL exposes `slug` as a field entry when defined on the metaobject type + `handle` as system handle.
 */
export function taxonomyKeyFromMetaobjectNode(node: any): string {
  if (!node || typeof node !== "object") return "";
  const sysHandle = String((node as any).handle ?? "").trim();
  const fields: any[] = Array.isArray((node as any).fields) ? (node as any).fields : [];
  for (const f of fields) {
    const key = String(f?.key ?? "").trim().toLowerCase();
    if (key === "slug") {
      const s = metaobjectFieldStringValue(f);
      if (s) return s;
    }
  }
  return sysHandle;
}

export type ClassificationSyncResult = {
  keys?: { cat: string; sg: string; sub: string };
  tags?: string[];
  incompleteKeys?: boolean;
  graphqlErrors?: string[];
  keyMetafieldUserErrors?: Array<{ field?: string[] | null; message: string }>;
};

export async function syncProductCatalogClassificationDerivatives(params: {
  admin: { graphql: AdminGraphql };
  productId: string;
  categoryGid: string;
  systemGroupGid: string;
  subcategoryGid: string;
}): Promise<ClassificationSyncResult | undefined> {
  const { admin, productId, categoryGid, systemGroupGid, subcategoryGid } = params;
  const ids = [categoryGid, systemGroupGid, subcategoryGid].filter(Boolean);
  if (ids.length !== 3) return { incompleteKeys: true, graphqlErrors: ["Missing one or more classification GIDs."] };

  const NODES = `#graphql
    query ClassificationNodes($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Metaobject {
          id
          handle
          fields {
            key
            value
            jsonValue
          }
        }
      }
    }
  `;

  const nodesResp = await admin.graphql(NODES, { variables: { ids } });
  const nodesJson = await nodesResp.json();
  const gqlErrors: string[] = Array.isArray((nodesJson as any)?.errors)
    ? ((nodesJson as any).errors as any[]).map((e) => String(e?.message ?? "").trim()).filter(Boolean)
    : [];
  const nodes: any[] = Array.isArray(nodesJson?.data?.nodes) ? nodesJson.data.nodes : [];
  const byId = new Map<string, any>();
  for (const n of nodes) {
    if (n?.id) byId.set(String(n.id), n);
  }

  const mk = taxonomyKeyFromMetaobjectNode(byId.get(categoryGid));
  const gk = taxonomyKeyFromMetaobjectNode(byId.get(systemGroupGid));
  const sk = taxonomyKeyFromMetaobjectNode(byId.get(subcategoryGid));

  if (!mk || !gk || !sk) {
    console.warn("CLASSIFICATION_SYNC_INCOMPLETE_KEYS", { mk, gk, sk, gqlErrors });
    return {
      incompleteKeys: true,
      graphqlErrors: gqlErrors.length ? gqlErrors : ["Could not resolve slug/handle for one or more catalog metaobjects."],
      keys: {
        cat: mk,
        sg: gk,
        sub: sk,
      },
    };
  }

  const KEYS_SET = `#graphql
    mutation SetCatalogKeyMetafields($ownerId: ID!, $mk: String!, $gk: String!, $sk: String!) {
      metafieldsSet(
        metafields: [
          {
            ownerId: $ownerId
            namespace: "custom"
            key: "catalog_main_category_key"
            type: "single_line_text_field"
            value: $mk
          }
          {
            ownerId: $ownerId
            namespace: "custom"
            key: "catalog_system_group_key"
            type: "single_line_text_field"
            value: $gk
          }
          {
            ownerId: $ownerId
            namespace: "custom"
            key: "catalog_subcategory_key"
            type: "single_line_text_field"
            value: $sk
          }
        ]
      ) {
        metafields {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  let keyMetafieldUserErrors: Array<{ field?: string[] | null; message: string }> = [];
  try {
    const kResp = await admin.graphql(KEYS_SET, {
      variables: { ownerId: productId, mk, gk, sk },
    });
    const kJson = await kResp.json();
    const topErrs = Array.isArray((kJson as any)?.errors)
      ? ((kJson as any).errors as any[]).map((e) => String(e?.message ?? "").trim()).filter(Boolean)
      : [];
    if (topErrs.length) console.warn("CLASSIFICATION_KEY_METAFIELDS_GRAPHQL", topErrs);
    const kErrs = kJson?.data?.metafieldsSet?.userErrors ?? [];
    keyMetafieldUserErrors = Array.isArray(kErrs) ? kErrs : [];
    if (keyMetafieldUserErrors.length) {
      console.warn("CLASSIFICATION_KEY_METAFIELDS_WARN", keyMetafieldUserErrors);
    }

    /** One-at-a-time retry when batch fails (definition/type quirks per shop). */
    if (keyMetafieldUserErrors.length) {
      const singles: Array<{ key: string; value: string }> = [
        { key: "catalog_main_category_key", value: mk },
        { key: "catalog_system_group_key", value: gk },
        { key: "catalog_subcategory_key", value: sk },
      ];
      for (const row of singles) {
        const ONE = `#graphql
          mutation SetOneCatalogKey($ownerId: ID!, $value: String!, $catalogKey: String!) {
            metafieldsSet(
              metafields: [
                {
                  ownerId: $ownerId
                  namespace: "custom"
                  key: $catalogKey
                  type: "single_line_text_field"
                  value: $value
                }
              ]
            ) {
              metafields {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `;
        const r = await admin.graphql(ONE, {
          variables: { ownerId: productId, catalogKey: row.key, value: row.value },
        });
        const j = await r.json();
        const u = j?.data?.metafieldsSet?.userErrors ?? [];
        if (Array.isArray(u) && u.length) {
          console.warn("CLASSIFICATION_KEY_SINGLE_WARN", row.key, u);
        }
      }
    }
  } catch (e) {
    console.warn("CLASSIFICATION_KEY_METAFIELDS_THROW", e);
  }

  const catTag = `CAT:${mk}`;
  const groupTag = `GROUP:${gk}`;
  const subTag = `SUBCAT:${sk}`;
  const catalogTriple = [catTag, groupTag, subTag];

  const TAGS_Q = `#graphql
    query ProductTagsForClassification($id: ID!) {
      product(id: $id) {
        id
        tags
      }
    }
  `;

  try {
    const tResp = await admin.graphql(TAGS_Q, { variables: { id: productId } });
    const tJson = await tResp.json();
    const existingRaw = tJson?.data?.product?.tags;
    const existing: string[] = Array.isArray(existingRaw)
      ? existingRaw.map((t: any) => String(t ?? "").trim()).filter(Boolean)
      : typeof existingRaw === "string"
        ? existingRaw
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

    const merged = existing.filter((t) => t && !CLASSIFICATION_TAG_RE.test(t));
    for (const t of catalogTriple) {
      if (t && !merged.includes(t)) merged.push(t);
    }

    const UPDATE = `#graphql
      mutation ProductUpdateClassificationTags($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            tags
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const uResp = await admin.graphql(UPDATE, {
      variables: { input: { id: productId, tags: merged } },
    });
    const uJson = await uResp.json();
    const uErrs = uJson?.data?.productUpdate?.userErrors ?? [];
    if (Array.isArray(uErrs) && uErrs.length) {
      console.warn("PRODUCT_UPDATE_TAGS_WARN", uErrs);
    }
  } catch (e) {
    console.warn("CLASSIFICATION_TAGS_THROW", e);
  }

  return {
    keys: { cat: mk, sg: gk, sub: sk },
    tags: catalogTriple,
    keyMetafieldUserErrors,
    graphqlErrors: gqlErrors.length ? gqlErrors : undefined,
  };
}
