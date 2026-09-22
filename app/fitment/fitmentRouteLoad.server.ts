/**
 * Fitment product-page loader data.
 *
 * Shopify GraphQL throttle on catalog/vehicle listing must not 500 this page.
 * Compatibility is fail-closed: if selected-product data cannot be read, return
 * zero vehicles and never invent fitment. Ocean remains the fitment authority.
 * Identity: Shopify product ID → variant ID → SKU → Brand+MPN. Title is never identity.
 */

import { GET_PRODUCT_FOR_FITMENT_PAGE } from "../graphql/fitment.ts";
import { readCatalogIndex } from "../utils/catalogIndex.server.ts";
import { listCatalogMetaobjectsCached } from "../utils/catalogMetaobjectCache.server.ts";
import { adminGraphqlJson, isShopifyThrottled, type ShopifyGraphqlClient } from "../utils/shopifyGraphql.server.ts";
import { getVehicleIndex, indexSummary, listMakes } from "../vehicles/vehicleIndex.server.ts";
import type { VehicleIndexRow, VehicleIndexSummary } from "../vehicles/vehicleIndexQuery.ts";

export type FitmentRouteProduct = {
  id: string;
  title: string;
  handle: string;
  variantId: string;
  sku: string;
  brand: string;
  mpn: string;
};

export type FitmentRoutePayload = {
  shop_domain: string;
  product: FitmentRouteProduct;
  vehicleIndex: VehicleIndexSummary;
  makes: string[];
  indexVehicles: VehicleIndexRow[];
  classification: {
    category: { value: string; label: string; handle: string };
    systemGroup: { value: string; label: string; handle: string };
    subcategory: { value: string; label: string; handle: string };
  };
  classificationOptions: {
    categories: Array<{ value: string; label: string; handle?: string }>;
  };
  selectedVehicles: Array<{
    id: string;
    handle: string;
    vehicle_key: { value?: string | null } | null;
    display_name: { value?: string | null } | null;
  }>;
  shopifyThrottled: boolean;
  compatibilityUnavailable: boolean;
  catalogOptionsIncomplete: boolean;
};

function emptyClassification() {
  return {
    category: { value: "", label: "", handle: "" },
    systemGroup: { value: "", label: "", handle: "" },
    subcategory: { value: "", label: "", handle: "" },
  };
}

function emptyProduct(handle: string): FitmentRouteProduct {
  return {
    id: "",
    title: "",
    handle,
    variantId: "",
    sku: "",
    brand: "",
    mpn: "",
  };
}

export function emptyFitmentRoutePayload(params: {
  shopDomain: string;
  productHandle: string;
  shopifyThrottled?: boolean;
  product?: FitmentRouteProduct;
}): FitmentRoutePayload {
  return {
    shop_domain: params.shopDomain,
    product: params.product ?? emptyProduct(params.productHandle),
    vehicleIndex: { builtAt: 0, count: 0, ready: false },
    makes: [],
    indexVehicles: [],
    classification: emptyClassification(),
    classificationOptions: { categories: [] },
    selectedVehicles: [],
    shopifyThrottled: params.shopifyThrottled === true,
    compatibilityUnavailable: true,
    catalogOptionsIncomplete: true,
  };
}

function fieldText(value: unknown): string {
  return String(value ?? "").trim();
}

function mapSelectedVehicles(refs: unknown): FitmentRoutePayload["selectedVehicles"] {
  if (!Array.isArray(refs)) return [];
  const out: FitmentRoutePayload["selectedVehicles"] = [];
  const seen = new Set<string>();
  for (const n of refs) {
    const id = fieldText((n as any)?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      handle: fieldText((n as any)?.handle),
      vehicle_key: (n as any)?.vehicle_key ?? null,
      display_name: (n as any)?.display_name ?? null,
    });
  }
  return out;
}

export async function loadFitmentRouteData(params: {
  admin: ShopifyGraphqlClient;
  shopDomain: string;
  productHandle: string;
  sleepFn?: (ms: number) => Promise<void>;
  maxRetries?: number;
}): Promise<{ notFound: true } | { notFound: false; payload: FitmentRoutePayload }> {
  const handle = fieldText(params.productHandle);
  const shopDomain = fieldText(params.shopDomain);

  let shopifyThrottled = false;

  const productResult = await adminGraphqlJson({
    admin: params.admin,
    query: GET_PRODUCT_FOR_FITMENT_PAGE,
    variables: { handle, refsFirst: 50 },
    maxRetries: params.maxRetries,
    sleepFn: params.sleepFn,
  });

  if (productResult.throttled) {
    return {
      notFound: false,
      payload: emptyFitmentRoutePayload({
        shopDomain,
        productHandle: handle,
        shopifyThrottled: true,
      }),
    };
  }

  const p = productResult.json?.data?.productByHandle;
  if (!p?.id) {
    const gqlErrors = productResult.json?.errors;
    if (isShopifyThrottled(gqlErrors) || isShopifyThrottled(productResult.json)) {
      return {
        notFound: false,
        payload: emptyFitmentRoutePayload({
          shopDomain,
          productHandle: handle,
          shopifyThrottled: true,
        }),
      };
    }
    return { notFound: true };
  }

  const variant = Array.isArray(p?.variants?.nodes) ? p.variants.nodes[0] : null;
  const product: FitmentRouteProduct = {
    id: fieldText(p?.id),
    title: fieldText(p?.title),
    handle: fieldText(p?.handle) || handle,
    variantId: fieldText(variant?.id),
    sku: fieldText(variant?.sku),
    brand: fieldText(p?.brand?.value),
    mpn: fieldText(p?.mpn?.value) || fieldText(p?.article_number?.value),
  };

  const selectedVehicles = mapSelectedVehicles(p?.fitmentVehicles?.references?.nodes);
  const classification = {
    category: {
      value: fieldText(p?.category?.value) || fieldText(p?.category?.reference?.id),
      handle: fieldText(p?.category?.reference?.handle),
      label: fieldText(p?.category?.reference?.displayName),
    },
    systemGroup: {
      value: fieldText(p?.systemGroup?.value) || fieldText(p?.systemGroup?.reference?.id),
      handle: fieldText(p?.systemGroup?.reference?.handle),
      label: fieldText(p?.systemGroup?.reference?.displayName),
    },
    subcategory: {
      value: fieldText(p?.subcategory?.value) || fieldText(p?.subcategory?.reference?.id),
      handle: fieldText(p?.subcategory?.reference?.handle),
      label: fieldText(p?.subcategory?.reference?.displayName),
    },
  };

  const idx = await getVehicleIndex({
    admin: params.admin,
    shopDomain,
    refresh: false,
  });
  const vehicleIndex = indexSummary(idx);
  const makes = idx?.vehicles?.length ? listMakes(idx) : [];
  // Do not ship the full durable vehicle catalogue in the HTML payload.
  // POST index_makes / index_models / index_make_model read the same durable store.
  const indexVehicles: VehicleIndexRow[] = [];

  let categoryOptions: Array<{ value: string; label: string; handle?: string }> = [];
  let catalogOptionsIncomplete = false;
  const durableCatalog = await readCatalogIndex(shopDomain);
  if (durableCatalog?.categories?.length) {
    categoryOptions = durableCatalog.categories.map((c) => ({
      value: fieldText(c.value),
      label: fieldText(c.label) || fieldText(c.value),
      handle: fieldText(c.handle),
    }));
  } else {
    try {
      const catalog = await listCatalogMetaobjectsCached({
        admin: params.admin,
        shopDomain,
        type: "catalog_main_category",
        mode: "labels",
        sleepFn: params.sleepFn,
        maxRetries: params.maxRetries,
      });
      if (catalog.throttled) shopifyThrottled = true;
      if (catalog.incomplete || catalog.throttled) catalogOptionsIncomplete = true;
      categoryOptions = (catalog.nodes || [])
        .map((n) => {
          const id = fieldText(n?.id);
          if (!id) return null;
          const handle = fieldText(n?.handle);
          const label = fieldText(n?.displayName ?? n?.handle ?? id) || id;
          return { value: id, label, handle };
        })
        .filter(Boolean) as Array<{ value: string; label: string; handle?: string }>;
    } catch (error) {
      if (!isShopifyThrottled(error)) throw error;
      shopifyThrottled = true;
      catalogOptionsIncomplete = true;
      categoryOptions = [];
    }
  }

  return {
    notFound: false,
    payload: {
      shop_domain: shopDomain,
      product,
      vehicleIndex,
      makes,
      indexVehicles,
      classification,
      classificationOptions: { categories: categoryOptions },
      selectedVehicles,
      shopifyThrottled,
      compatibilityUnavailable: false,
      catalogOptionsIncomplete,
    },
  };
}
