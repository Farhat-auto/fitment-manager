/**
 * Product merchandising classification (Category → System Group → Sub-category).
 *
 * This is NOT vehicle identity and must not import the Shopify vehicle index.
 * Catalog metaobjects are merchandising only. Ocean remains fitment authority.
 */
import { json } from "@remix-run/node";
import { listCatalogMetaobjectsCached } from "../utils/catalogMetaobjectCache.server";
import {
  catalogSystemGroupIdFromSubcategoryNode,
  parentCatalogCategoryIdFromSystemGroupNode,
  subcategoriesForSystemGroup,
  systemGroupsForCategory,
} from "../utils/catalogMetaobjectParents.server";
import { syncProductCatalogClassificationDerivatives } from "../utils/catalogClassificationTags.server";
import type { ShopifyGraphqlClient } from "../utils/shopifyGraphql.server";

export type ClassificationValue = { value: string; label: string };

export type ProductClassificationState = {
  category: ClassificationValue;
  systemGroup: ClassificationValue;
  subcategory: ClassificationValue;
};

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

function fieldText(value: unknown): string {
  return String(value ?? "").trim();
}

function metafieldChoice(node: any, key: string): ClassificationValue {
  const mf = node?.[key];
  return {
    value: fieldText(mf?.value),
    label: fieldText(mf?.reference?.displayName),
  };
}

export function emptyClassification(): ProductClassificationState {
  return {
    category: { value: "", label: "" },
    systemGroup: { value: "", label: "" },
    subcategory: { value: "", label: "" },
  };
}

export function classificationFromProductNode(node: any): ProductClassificationState {
  if (!node || typeof node !== "object") return emptyClassification();
  return {
    category: metafieldChoice(node, "category"),
    systemGroup: metafieldChoice(node, "systemGroup"),
    subcategory: metafieldChoice(node, "subcategory"),
  };
}

export async function loadClassificationCategories(params: {
  admin: ShopifyGraphqlClient;
  shopDomain: string;
}): Promise<{ categories: ClassificationValue[]; throttled: boolean; incomplete: boolean }> {
  const shopDomain = fieldText(params.shopDomain);
  if (!shopDomain) return { categories: [], throttled: false, incomplete: true };
  const catalog = await listCatalogMetaobjectsCached({
    admin: params.admin,
    shopDomain,
    type: "catalog_main_category",
    mode: "labels",
  });
  const categories = (catalog.nodes || [])
    .map((n) => {
      const id = fieldText(n?.id);
      if (!id) return null;
      const label = fieldText(n?.displayName ?? n?.handle ?? id) || id;
      return { value: id, label };
    })
    .filter(Boolean) as ClassificationValue[];
  return {
    categories,
    throttled: catalog.throttled,
    incomplete: catalog.incomplete,
  };
}

export async function handleClassificationIntent(params: {
  admin: ShopifyGraphqlClient;
  shopDomain: string;
  intent: string;
  formData: FormData;
}): Promise<Response | null> {
  const { admin, intent, formData } = params;
  const shopDomain = fieldText(params.shopDomain);

  if (intent === "classification_system_groups") {
    const category = fieldText(formData.get("category"));
    if (!category) {
      return json({
        ok: true,
        systemGroups: [],
        classificationLinkage: { scope: "system_groups" as const },
      });
    }
    const listed = await listCatalogMetaobjectsCached({
      admin,
      shopDomain,
      type: "catalog_system_group",
      mode: "system_groups",
    });
    if (listed.throttled) {
      return json(
        {
          ok: false,
          error: "Shopify Admin API throttled this request. Please wait a moment and try again.",
          throttled: true,
        },
        { status: 429 },
      );
    }
    const allRows = (listed.nodes || [])
      .map((n: any) => {
        const id = fieldText(n?.id);
        if (!id) return null;
        const label = fieldText(n?.displayName ?? n?.handle ?? id) || id;
        const parentCategoryId = parentCatalogCategoryIdFromSystemGroupNode(n);
        return { value: id, label, parentCategoryId: fieldText(parentCategoryId) };
      })
      .filter(Boolean) as Array<{ value: string; label: string; parentCategoryId: string }>;
    const storeHasParentLinks = allRows.some((r) => !!r.parentCategoryId);
    const systemGroups = systemGroupsForCategory(allRows, category).sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }),
    );
    return json({
      ok: true,
      systemGroups,
      classificationLinkage: {
        scope: "system_groups" as const,
        storeHasParentLinks,
        totalSystemGroupsInStore: allRows.length,
        systemGroupsShown: systemGroups.length,
      },
    });
  }

  if (intent === "classification_subcategories") {
    const systemGroup = fieldText(formData.get("systemGroup"));
    if (!systemGroup) {
      return json({
        ok: true,
        subcategories: [],
        classificationLinkage: { scope: "subcategories" as const },
      });
    }
    const listed = await listCatalogMetaobjectsCached({
      admin,
      shopDomain,
      type: "catalog_subcategory",
      mode: "subcategories",
    });
    if (listed.throttled) {
      return json(
        {
          ok: false,
          error: "Shopify Admin API throttled this request. Please wait a moment and try again.",
          throttled: true,
        },
        { status: 429 },
      );
    }
    const allRows = (listed.nodes || [])
      .map((n: any) => {
        const id = fieldText(n?.id);
        if (!id) return null;
        const label = fieldText(n?.displayName ?? n?.handle ?? id) || id;
        const systemGroupId = catalogSystemGroupIdFromSubcategoryNode(n);
        return { value: id, label, systemGroupId: fieldText(systemGroupId) };
      })
      .filter(Boolean) as Array<{ value: string; label: string; systemGroupId: string }>;
    const storeHasSystemGroupLinks = allRows.some((r) => !!r.systemGroupId);
    const subcategories = subcategoriesForSystemGroup(allRows, systemGroup).sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }),
    );
    return json({
      ok: true,
      subcategories,
      classificationLinkage: {
        scope: "subcategories" as const,
        storeHasSystemGroupLinks,
        totalSubcategoriesInStore: allRows.length,
        subcategoriesShown: subcategories.length,
      },
    });
  }

  if (intent === "classification_save") {
    const ownerId = fieldText(formData.get("product_gid"));
    const category = fieldText(formData.get("category"));
    const systemGroup = fieldText(formData.get("systemGroup"));
    const subcategory = fieldText(formData.get("subcategory"));
    if (!ownerId) return json({ ok: false, error: "Missing product_gid" }, { status: 400 });
    if (!category || !systemGroup || !subcategory) {
      return json(
        { ok: false, error: "Please select Category, System Group, and Sub-category." },
        { status: 400 },
      );
    }
    const resp = await admin.graphql(SET_PRODUCT_CLASSIFICATION, {
      variables: { ownerId, category, systemGroup, subcategory },
    });
    const data = await resp.json();
    const errs = data?.data?.metafieldsSet?.userErrors ?? [];
    if (Array.isArray(errs) && errs.length) {
      return json({ ok: false, userErrors: errs }, { status: 400 });
    }
    try {
      const classificationSync = await syncProductCatalogClassificationDerivatives({
        admin,
        productId: ownerId,
        categoryGid: category,
        systemGroupGid: systemGroup,
        subcategoryGid: subcategory,
      });
      return json({
        ok: true,
        mode: "classification_saved",
        classificationSync: classificationSync ?? null,
      });
    } catch (e) {
      console.warn("CLASSIFICATION_DERIVATIVES_FAILED", e);
      return json({
        ok: true,
        mode: "classification_saved",
        classificationSync: {
          incompleteKeys: true,
          graphqlErrors: [String((e as Error)?.message ?? e ?? "classification_sync_failed")],
        },
      });
    }
  }

  return null;
}
