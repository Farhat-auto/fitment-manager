import { syncProductCatalogClassificationDerivatives } from "../utils/catalogClassificationTags.server";
import { listCatalogMetaobjectsCached } from "../utils/catalogMetaobjectCache.server";
import {
  catalogSystemGroupIdFromSubcategoryNode,
  parentCatalogCategoryIdFromSystemGroupNode,
} from "../utils/catalogMetaobjectParents.server";
import type { ShopifyGraphqlClient } from "../utils/shopifyGraphql.server";

function labelOf(node: { id?: string; displayName?: string; handle?: string }) {
  return String(node?.displayName || node?.handle || node?.id || "").trim();
}

function optionFrom(node: { id?: string; displayName?: string; handle?: string }) {
  const value = String(node?.id || "").trim();
  if (!value) return null;
  return { value, label: labelOf(node) || value };
}

export async function loadItemClassificationOptions(admin: ShopifyGraphqlClient, shopDomain: string) {
  const [categories, groups, subs] = await Promise.all([
    listCatalogMetaobjectsCached({
      admin,
      shopDomain,
      type: "catalog_main_category",
      mode: "labels",
    }),
    listCatalogMetaobjectsCached({
      admin,
      shopDomain,
      type: "catalog_system_group",
      mode: "system_groups",
    }),
    listCatalogMetaobjectsCached({
      admin,
      shopDomain,
      type: "catalog_subcategory",
      mode: "subcategories",
    }),
  ]);
  if (categories.throttled || groups.throttled || subs.throttled) {
    return {
      ok: false as const,
      error: "Shopify Admin API throttled the category list. Wait a moment and reload this product.",
      throttled: true,
    };
  }
  return {
    ok: true as const,
    categories: categories.nodes.map((node) => optionFrom(node)).filter(Boolean),
    itemCategories: groups.nodes
      .map((node) => {
        const row = optionFrom(node);
        if (!row) return null;
        return { ...row, parentId: parentCatalogCategoryIdFromSystemGroupNode(node) || "" };
      })
      .filter(Boolean),
    subcategories: subs.nodes
      .map((node) => {
        const row = optionFrom(node);
        if (!row) return null;
        return { ...row, parentId: catalogSystemGroupIdFromSubcategoryNode(node) || "" };
      })
      .filter(Boolean),
  };
}

const SET_PRODUCT_CLASSIFICATION = `#graphql
  mutation SetProductClassification(
    $ownerId: ID!
    $category: String!
    $systemGroup: String!
    $subcategory: String!
  ) {
    metafieldsSet(
      metafields: [
        {
          ownerId: $ownerId
          namespace: "custom"
          key: "catalog_main_category"
          type: "metaobject_reference"
          value: $category
        }
        {
          ownerId: $ownerId
          namespace: "custom"
          key: "catalog_system_group"
          type: "metaobject_reference"
          value: $systemGroup
        }
        {
          ownerId: $ownerId
          namespace: "custom"
          key: "catalog_subcategory"
          type: "metaobject_reference"
          value: $subcategory
        }
      ]
    ) {
      metafields { id key namespace value }
      userErrors { field message }
    }
  }
`;

export async function saveItemClassification(
  admin: ShopifyGraphqlClient,
  ownerId: string,
  input: { category: string; itemCategory: string; subcategory: string },
) {
  const category = String(input.category || "").trim();
  const systemGroup = String(input.itemCategory || "").trim();
  const subcategory = String(input.subcategory || "").trim();
  if (!ownerId) return { ok: false as const, saved: false, error: "Missing product." };
  if (!category || !systemGroup || !subcategory) {
    return {
      ok: false as const,
      saved: false,
      error: "Select a category, an item category, and a subcategory.",
    };
  }
  const resp = await admin.graphql(SET_PRODUCT_CLASSIFICATION, {
    variables: { ownerId, category, systemGroup, subcategory },
  });
  const data = await resp.json();
  const topErrors = Array.isArray(data?.errors) ? data.errors : [];
  if (topErrors.length) {
    return {
      ok: false as const,
      saved: false,
      error: topErrors.map((row: { message?: string }) => row?.message).filter(Boolean).join("; ")
        || "Shopify did not accept the category write.",
    };
  }
  const userErrors = data?.data?.metafieldsSet?.userErrors ?? [];
  if (Array.isArray(userErrors) && userErrors.length) {
    return {
      ok: false as const,
      saved: false,
      error: userErrors.map((row: { message?: string }) => row?.message).filter(Boolean).join("; ")
        || "Shopify did not accept the category write.",
      userErrors,
    };
  }
  if (!data?.data?.metafieldsSet) {
    return { ok: false as const, saved: false, error: "Shopify did not accept the category write." };
  }
  try {
    const classificationSync = await syncProductCatalogClassificationDerivatives({
      admin,
      productId: ownerId,
      categoryGid: category,
      systemGroupGid: systemGroup,
      subcategoryGid: subcategory,
    });
    return { ok: true as const, saved: true, classificationSync: classificationSync ?? null };
  } catch (error) {
    return {
      ok: true as const,
      saved: true,
      classificationSync: {
        incompleteKeys: true,
        graphqlErrors: [String((error as Error)?.message || error || "classification_sync_failed")],
      },
    };
  }
}
