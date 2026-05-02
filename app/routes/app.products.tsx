import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, Link as RemixLink, useLocation, useNavigate, useRevalidator } from "@remix-run/react";
import * as React from "react";
import {
  Page,
  Card,
  BlockStack,
  Thumbnail,
  Text,
  InlineStack,
  Button,
  ResourceList,
  ResourceItem,
  Badge,
  Select,
  TextField,
  Checkbox,
  Banner,
  Modal,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { GET_PRODUCTS_FOR_FITMENT_ADMIN, LIST_METAOBJECTS_BY_TYPE } from "../graphql/fitment";
import { paginateMetaobjects } from "../utils/paginateMetaobjects.server";
import { normalizeOeReferenceLine, normalizeOeReferenceLinesFromForm, buildCustomSearchIndexValue } from "../utils/oeReferences";
import {
  catalogSystemGroupIdFromSubcategoryNode,
  parentCatalogCategoryIdFromSystemGroupNode,
} from "../utils/catalogMetaobjectParents.server";

type Option = { value: string; label: string };

/** System group metaobject may reference its parent `catalog_main_category` (field varies by store). */
type CatalogSystemGroupOption = Option & { parentCategoryId?: string | null };

/** Sub-category metaobject may reference its parent `catalog_system_group` (field varies by store). */
type CatalogSubcategoryOption = Option & { systemGroupId?: string | null };

type ProductRow = {
  id: string;
  title: string;
  vendor: string;
  handle: string;
  sku: string;
  article_number: string;
  brand: string;
  featuredImageUrl: string;
  featuredImageAlt: string;
  vehicleCount: number;
  oe_references: string[];
  cross_references: string[];
  brand_reference?: { id: string; displayName: string } | null;
  search_index?: string;
  category: { value: string; label: string } | null;
  systemGroup: { value: string; label: string } | null;
  subcategory: { value: string; label: string } | null;
};

function parseStringListMetafield(metafield: any): string[] {
  const j = metafield?.jsonValue;
  if (Array.isArray(j)) {
    return j.map((x) => String(x ?? "").trim()).filter(Boolean);
  }

  const rawVal = metafield?.value;
  if (Array.isArray(rawVal)) {
    return rawVal.map((x: any) => String(x ?? "").trim()).filter(Boolean);
  }

  const s = typeof rawVal === "string" ? rawVal.trim() : "";
  if (!s) return [];

  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x ?? "").trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  return [];
}

function tryShowShopifyToast(message: string): boolean {
  if (typeof window === "undefined") return false;
  const shopify = (window as unknown as { shopify?: { toast?: { show?: (m: string) => void } } }).shopify;
  const show = shopify?.toast?.show;
  if (typeof show !== "function") return false;
  try {
    show(message);
    return true;
  } catch {
    return false;
  }
}

/** Normalize Brand metaobject reference from the Save modal (full GID, or numeric id only). */
function parseBrandMetaobjectField(raw: unknown):
  | { kind: "clear" }
  | { kind: "set"; gid: string }
  | { kind: "invalid"; detail: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { kind: "clear" };
  if (s.startsWith("gid://shopify/Metaobject/")) return { kind: "set", gid: s };
  if (/^\d+$/.test(s)) return { kind: "set", gid: `gid://shopify/Metaobject/${s}` };
  return { kind: "invalid", detail: "Brand reference must be a Metaobject GID, numeric id, or blank." };
}

function parseFitmentGids(metafield: any): string[] {
  const rawJson = metafield?.jsonValue;
  if (Array.isArray(rawJson)) {
    return rawJson.map((x) => String(x || "")).filter(Boolean);
  }

  const rawVal = metafield?.value;
  if (Array.isArray(rawVal)) {
    return rawVal.map((x: any) => String(x || "")).filter(Boolean);
  }

  const s = typeof rawVal === "string" ? rawVal.trim() : "";
  if (!s) return [];

  // Shopify commonly stores list.metaobject_reference as a JSON string array in `value`.
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x || "")).filter(Boolean);
    } catch {
      return [];
    }
  }

  return [];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const includeMetaobjectOptions = url.searchParams.get("meta") !== "0";

  const q = String(url.searchParams.get("q") ?? "").trim();
  const category = String(url.searchParams.get("category") ?? "").trim();
  const systemGroup = String(url.searchParams.get("systemGroup") ?? "").trim();
  const subcategory = String(url.searchParams.get("subcategory") ?? "").trim();

  function quoteGid(v: string): string {
    const s = String(v ?? "").trim();
    if (!s) return "";
    // Shopify product query syntax expects quotes around GIDs when used as metafield filter values.
    if (s.startsWith("'") && s.endsWith("'")) return s;
    if (s.startsWith("gid://")) return `'${s}'`;
    return s;
  }

  function escapeSearchTerm(term: string): string {
    // Keep it simple: Shopify search query doesn't like unescaped quotes.
    return String(term ?? "").replace(/["']/g, " ").trim();
  }

  const queryParts: string[] = [];
  if (q) {
    const term = escapeSearchTerm(q);
    if (term) {
      // Requirement: Title/SKU search. Primary requested format is `title:*term*`.
      queryParts.push(`(title:*${term}* OR sku:*${term}*)`);
    }
  }
  if (category) queryParts.push(`metafield:custom.catalog_main_category:${quoteGid(category)}`);
  if (systemGroup) queryParts.push(`metafield:custom.catalog_system_group:${quoteGid(systemGroup)}`);
  if (subcategory) queryParts.push(`metafield:custom.catalog_subcategory:${quoteGid(subcategory)}`);
  const productQuery = queryParts.length ? queryParts.join(" AND ") : null;

  const resp = await admin.graphql(GET_PRODUCTS_FOR_FITMENT_ADMIN, {
    variables: { first: 50, after, query: productQuery },
  });
  const gql = await resp.json();

  const productsNode = gql?.data?.products;
  const nodes: any[] = Array.isArray(productsNode?.nodes) ? productsNode.nodes : [];
  const pageInfo = productsNode?.pageInfo ?? { hasNextPage: false, endCursor: null };

  const products: ProductRow[] = nodes.map((p: any) => {
    const handle = String(p?.handle ?? "");
    const sku = String(p?.variants?.nodes?.[0]?.sku ?? "").trim();
    const article_number = String(p?.article_number?.value ?? "").trim();
    const brand = String(p?.brand?.value ?? "").trim();
    const vendor = String(p?.vendor ?? "").trim();
    const vehicleCount = parseFitmentGids(p?.fitment).length;
    const oe_references = parseStringListMetafield(p?.oe_references)
      .map((line) => normalizeOeReferenceLine(line))
      .filter(Boolean);
    const cross_references = parseStringListMetafield(p?.cross_references);
    const brandRef = p?.brand_reference?.reference;
    const brand_reference =
      brandRef && typeof brandRef.id === "string"
        ? {
            id: String(brandRef.id),
            displayName: String(brandRef.displayName ?? "").trim() || String(brandRef.id),
          }
        : null;
    const catValue = String(p?.category?.value ?? "").trim();
    const sysValue = String(p?.systemGroup?.value ?? "").trim();
    const subValue = String(p?.subcategory?.value ?? "").trim();
    const catLabel = String(p?.category?.reference?.displayName ?? "").trim() || catValue;
    const sysLabel = String(p?.systemGroup?.reference?.displayName ?? "").trim() || sysValue;
    const subLabel = String(p?.subcategory?.reference?.displayName ?? "").trim() || subValue;
    const search_index = String(p?.search_index?.value ?? "").trim();
    return {
      id: String(p?.id ?? ""),
      title: String(p?.title ?? ""),
      vendor,
      handle,
      sku,
      article_number,
      brand,
      featuredImageUrl: String(p?.featuredImage?.url ?? ""),
      featuredImageAlt: String(p?.featuredImage?.altText ?? p?.title ?? ""),
      vehicleCount,
      oe_references,
      cross_references,
      brand_reference,
      search_index: search_index || undefined,
      category: catValue ? { value: catValue, label: catLabel } : null,
      systemGroup: sysValue ? { value: sysValue, label: sysLabel } : null,
      subcategory: subValue ? { value: subValue, label: subLabel } : null,
    };
  });

  let categoryOptions: Option[] = [];
  let systemGroupOptions: CatalogSystemGroupOption[] = [];
  let subcategoryOptions: CatalogSubcategoryOption[] = [];
  let brandOptions: Option[] = [];

  if (includeMetaobjectOptions) {
    const [allCategories, allSystemGroups, allSubcategories, allBrands] = await Promise.all([
      paginateMetaobjects({
        admin,
        query: LIST_METAOBJECTS_BY_TYPE,
        variables: { type: "catalog_main_category" },
        pathToConnection: (d) => d?.metaobjects,
      }),
      paginateMetaobjects({
        admin,
        query: LIST_METAOBJECTS_BY_TYPE,
        variables: { type: "catalog_system_group" },
        pathToConnection: (d) => d?.metaobjects,
      }),
      paginateMetaobjects({
        admin,
        query: LIST_METAOBJECTS_BY_TYPE,
        variables: { type: "catalog_subcategory" },
        pathToConnection: (d) => d?.metaobjects,
      }),
      paginateMetaobjects({
        admin,
        query: LIST_METAOBJECTS_BY_TYPE,
        variables: { type: "brand" },
        pathToConnection: (d) => d?.metaobjects,
      }),
    ]);

    const toOption = (n: any): Option | null => {
      const id = typeof n?.id === "string" ? n.id.trim() : "";
      if (!id) return null;
      const label =
        (typeof n?.displayName === "string" ? n.displayName.trim() : "") ||
        (typeof n?.handle === "string" ? n.handle.trim() : "") ||
        id;
      return { value: id, label };
    };

    categoryOptions = allCategories.map(toOption).filter(Boolean) as any;
    systemGroupOptions = allSystemGroups
      .map((n) => {
        const opt = toOption(n);
        if (!opt) return null;
        const row: CatalogSystemGroupOption = {
          ...opt,
          parentCategoryId: parentCatalogCategoryIdFromSystemGroupNode(n) || null,
        };
        return row;
      })
      .filter(Boolean) as CatalogSystemGroupOption[];
    subcategoryOptions = allSubcategories
      .map((n) => {
        const opt = toOption(n);
        if (!opt) return null;
        const row: CatalogSubcategoryOption = {
          ...opt,
          systemGroupId: catalogSystemGroupIdFromSubcategoryNode(n) || null,
        };
        return row;
      })
      .filter(Boolean) as CatalogSubcategoryOption[];
    brandOptions = allBrands.map(toOption).filter(Boolean) as any;
  }

  return json({
    shop: session.shop,
    products,
    pageInfo: {
      hasNextPage: !!pageInfo?.hasNextPage,
      endCursor: pageInfo?.endCursor ? String(pageInfo.endCursor) : null,
    },
    after,
    metaobjectOptions: {
      categories: categoryOptions,
      systemGroups: systemGroupOptions,
      subcategories: subcategoryOptions,
      brands: brandOptions,
    },
    appliedFilters: { q, category, systemGroup, subcategory },
  });
}

const PRODUCT_UPDATE = `#graphql
  mutation ProductUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
        vendor
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SET_PRODUCT_CORE_FIELDS = `#graphql
  mutation SetProductCoreFields(
    $ownerId: ID!
    $oeReferencesJson: String!
    $crossRefsJson: String!
    $articleNumber: String!
    $searchIndex: String!
  ) {
    metafieldsSet(
      metafields: [
        {
          ownerId: $ownerId
          namespace: "custom"
          key: "oe_references"
          type: "list.single_line_text_field"
          value: $oeReferencesJson
        }
        {
          ownerId: $ownerId
          namespace: "custom"
          key: "cross_references"
          type: "list.single_line_text_field"
          value: $crossRefsJson
        }
        {
          ownerId: $ownerId
          namespace: "custom"
          key: "article_number"
          type: "single_line_text_field"
          value: $articleNumber
        }
        {
          ownerId: $ownerId
          namespace: "custom"
          key: "search_index"
          type: "multi_line_text_field"
          value: $searchIndex
        }
      ]
    ) {
      metafields {
        id
        namespace
        key
        type
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SET_BRAND_REFERENCE_METAFIELD = `#graphql
  mutation SetBrandReferenceMetafield($ownerId: ID!, $brandReferenceGid: String!) {
    metafieldsSet(
      metafields: [
        {
          ownerId: $ownerId
          namespace: "custom"
          key: "brand_reference"
          type: "metaobject_reference"
          value: $brandReferenceGid
        }
      ]
    ) {
      metafields {
        id
        namespace
        key
        type
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DELETE_PRODUCT_METAFIELDS = `#graphql
  mutation DeleteProductMetafields($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields {
        ownerId
        namespace
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const NODE_METAOBJECT_LABEL = `#graphql
  query NodeMetaobjectLabel($id: ID!) {
    node(id: $id) {
      ... on Metaobject {
        id
        displayName
      }
    }
  }
`;

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { admin } = await authenticate.admin(request);
    const fd = await request.formData();
    const intent = String(fd.get("intent") || "").trim();

    if (intent !== "product_update") {
      return json({ ok: false, error: "Unsupported intent" }, { status: 400 });
    }

    const productId = String(fd.get("productId") || "").trim();
    const title = String(fd.get("title") || "").trim();
    const vendor = String(fd.get("vendor") || "").trim();
    const oeLines = normalizeOeReferenceLinesFromForm(fd.get("oe_references"));
    const crossLines = String(fd.get("cross_references") ?? "")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    const articleNumber = String(fd.get("article_number") ?? "").trim();

    if (!productId) return json({ ok: false, error: "Missing productId" }, { status: 400 });
    if (!title) return json({ ok: false, error: "Title is required" }, { status: 400 });

    const resp = await admin.graphql(PRODUCT_UPDATE, {
      variables: { input: { id: productId, title, vendor } },
    });
    const gql = await resp.json();
    const gqlTop = Array.isArray((gql as any)?.errors) ? ((gql as any).errors as any[]) : [];
    if (gqlTop.length) {
      const msg = gqlTop.map((e) => String(e?.message ?? "")).filter(Boolean).join("; ") || "Shopify GraphQL error";
      return json({ ok: false, error: msg }, { status: 502 });
    }
    const userErrors = gql?.data?.productUpdate?.userErrors ?? [];
    if (Array.isArray(userErrors) && userErrors.length) {
      return json({ ok: false, userErrors }, { status: 400 });
    }

    const product = gql?.data?.productUpdate?.product ?? null;
    if (!product?.id) return json({ ok: false, error: "Product update failed" }, { status: 500 });

    const searchIndex = buildCustomSearchIndexValue({
      oeLines,
      crossLines,
      articleNumber,
    });

    const mfResp = await admin.graphql(SET_PRODUCT_CORE_FIELDS, {
      variables: {
        ownerId: productId,
        oeReferencesJson: JSON.stringify(oeLines),
        crossRefsJson: JSON.stringify(crossLines),
        articleNumber,
        searchIndex,
      },
    });
    const mfJson = await mfResp.json();
    const mfTop = Array.isArray((mfJson as any)?.errors) ? ((mfJson as any).errors as any[]) : [];
    if (mfTop.length) {
      const msg = mfTop.map((e) => String(e?.message ?? "")).filter(Boolean).join("; ") || "Shopify GraphQL error";
      return json({ ok: false, error: msg, partial: true }, { status: 502 });
    }
    const mfErrors = mfJson?.data?.metafieldsSet?.userErrors ?? [];
    if (Array.isArray(mfErrors) && mfErrors.length) {
      return json({ ok: false, userErrors: mfErrors, partial: true }, { status: 400 });
    }

    const brandParsed = parseBrandMetaobjectField(fd.get("brand_reference"));
    if (brandParsed.kind === "invalid") {
      return json({ ok: false, error: brandParsed.detail }, { status: 400 });
    }

    let resolvedBrandGid: string | null = null;
    if (brandParsed.kind === "set") {
      resolvedBrandGid = brandParsed.gid;
      const brResp = await admin.graphql(SET_BRAND_REFERENCE_METAFIELD, {
        variables: {
          ownerId: productId,
          brandReferenceGid: resolvedBrandGid,
        },
      });
      const brJson = await brResp.json();
      const brTop = Array.isArray((brJson as any)?.errors) ? ((brJson as any).errors as any[]) : [];
      if (brTop.length) {
        const msg = brTop.map((e) => String(e?.message ?? "")).filter(Boolean).join("; ") || "Shopify GraphQL error";
        return json({ ok: false, error: msg, partial: true }, { status: 502 });
      }
      const brErrors = brJson?.data?.metafieldsSet?.userErrors ?? [];
      if (Array.isArray(brErrors) && brErrors.length) {
        return json({ ok: false, userErrors: brErrors, partial: true }, { status: 400 });
      }
    } else {
      const delResp = await admin.graphql(DELETE_PRODUCT_METAFIELDS, {
        variables: {
          metafields: [{ ownerId: productId, namespace: "custom", key: "brand_reference" }],
        },
      });
      const delJson = await delResp.json();
      const delTop = Array.isArray((delJson as any)?.errors) ? ((delJson as any).errors as any[]) : [];
      if (delTop.length) {
        const msg = delTop.map((e) => String(e?.message ?? "")).filter(Boolean).join("; ") || "Shopify GraphQL error";
        return json({ ok: false, error: msg, partial: true }, { status: 502 });
      }
      const delErrors = delJson?.data?.metafieldsDelete?.userErrors ?? [];
      if (Array.isArray(delErrors) && delErrors.length) {
        return json({ ok: false, userErrors: delErrors, partial: true }, { status: 400 });
      }
    }

    let brand_reference: { id: string; displayName: string } | null = null;
    if (resolvedBrandGid) {
      const moResp = await admin.graphql(NODE_METAOBJECT_LABEL, {
        variables: { id: resolvedBrandGid },
      });
      const moJson = await moResp.json();
      const node = moJson?.data?.node as { id?: string; displayName?: string } | undefined;
      if (node?.id) {
        brand_reference = {
          id: String(node.id),
          displayName: String(node.displayName ?? "").trim() || String(node.id),
        };
      } else {
        brand_reference = { id: resolvedBrandGid, displayName: resolvedBrandGid };
      }
    }

    return json({
      ok: true,
      product: {
        id: String(product.id),
        title: String(product.title ?? ""),
        vendor: String(product.vendor ?? ""),
        handle: String(product.handle ?? ""),
        oe_references: oeLines,
        cross_references: crossLines,
        article_number: articleNumber,
        brand_reference,
        search_index: searchIndex || undefined,
      },
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("PRODUCT_UPDATE_ACTION_ERROR", error);
    const msg = String((error as Error)?.message ?? error ?? "").trim();
    const safe = msg && msg.length < 800 ? msg : "Unexpected error while saving the product.";
    return json({ ok: false, error: safe }, { status: 500 });
  }
}

export default function Products() {
  const { products, pageInfo, shop, metaobjectOptions, appliedFilters } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const storeHandle = String(shop || "").trim().replace(/\.myshopify\.com$/i, "");
  const moreFetcher = useFetcher<typeof loader>();
  const updateFetcher = useFetcher<typeof action>();

  const [allProducts, setAllProducts] = React.useState<ProductRow[]>(() => (Array.isArray(products) ? products : []));
  const [cursor, setCursor] = React.useState<string | null>(pageInfo?.endCursor ?? null);
  const [hasNext, setHasNext] = React.useState<boolean>(!!pageInfo?.hasNextPage);

  const [query, setQuery] = React.useState<string>(() => String((appliedFilters as any)?.q ?? ""));
  const [category, setCategory] = React.useState<string>(() => String((appliedFilters as any)?.category ?? ""));
  const [systemGroup, setSystemGroup] = React.useState<string>(() => String((appliedFilters as any)?.systemGroup ?? ""));
  const [subcategory, setSubcategory] = React.useState<string>(() => String((appliedFilters as any)?.subcategory ?? ""));

  // Selection (checkboxes)
  const [selectedProductIds, setSelectedProductIds] = React.useState<string[]>([]);
  const selectedSet = React.useMemo(() => new Set(selectedProductIds), [selectedProductIds]);
  const [exportWarning, setExportWarning] = React.useState<string | null>(null);
  const [isExporting, setIsExporting] = React.useState(false);

  const [updateBanner, setUpdateBanner] = React.useState<{ tone: "success" | "critical"; message: string } | null>(null);
  const [lastUpdatedProductId, setLastUpdatedProductId] = React.useState<string | null>(null);
  const productRowRefs = React.useRef<Map<string, HTMLElement>>(new Map());
  const pendingScrollProductId = React.useRef<string | null>(null);
  const [editing, setEditing] = React.useState<ProductRow | null>(null);
  const [editTitle, setEditTitle] = React.useState<string>("");
  const [editVendor, setEditVendor] = React.useState<string>("");
  const [editOeText, setEditOeText] = React.useState("");
  const [editCrossText, setEditCrossText] = React.useState("");
  const [editArticleNumber, setEditArticleNumber] = React.useState("");
  const [editBrandRefId, setEditBrandRefId] = React.useState("");

  React.useEffect(() => {
    if (!editing) return;
    setEditTitle(editing.title);
    setEditVendor(editing.vendor);
    setEditOeText((editing.oe_references ?? []).join("\n"));
    setEditCrossText((editing.cross_references ?? []).join("\n"));
    setEditArticleNumber(String(editing.article_number ?? ""));
    setEditBrandRefId(String(editing.brand_reference?.id ?? ""));
  }, [editing]);

  React.useEffect(() => {
    const d: any = moreFetcher.data;
    if (!d || !Array.isArray(d.products)) return;
    setAllProducts((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      const merged = [...prev];
      for (const p of d.products as ProductRow[]) {
        if (p?.id && !seen.has(p.id)) merged.push(p);
      }
      return merged;
    });
    const nextCursor = d?.pageInfo?.endCursor ? String(d.pageInfo.endCursor) : null;
    const nextHasNext = !!d?.pageInfo?.hasNextPage && !!nextCursor;
    setCursor((prev) => {
      if (prev && nextCursor && prev === nextCursor) {
        setHasNext(false);
        return prev;
      }
      return nextCursor;
    });
    setHasNext(nextHasNext);
  }, [moreFetcher.data]);

  React.useEffect(() => {
    const d: any = updateFetcher.data;
    if (!d) return;
    if (d.ok && d.product?.id) {
      const updated = d.product as {
        id: string;
        title: string;
        vendor: string;
        handle?: string;
        oe_references?: string[];
        cross_references?: string[];
        article_number?: string;
        search_index?: string;
        brand_reference?: ProductRow["brand_reference"];
      };
      const updatedId = String(updated.id);

      // Close modal immediately so the user returns to the list (do not wait on revalidation).
      setEditing(null);

      const toastShown = tryShowShopifyToast("Product updated successfully");
      setUpdateBanner(
        toastShown ? null : { tone: "success", message: "Product updated successfully." },
      );

      setLastUpdatedProductId(updatedId);
      pendingScrollProductId.current = updatedId;

      setAllProducts((prev) =>
        prev.map((p) =>
          String(p.id) === String(updated.id)
            ? {
                ...p,
                title: updated.title,
                vendor: updated.vendor,
                oe_references: updated.oe_references ?? p.oe_references,
                cross_references: updated.cross_references ?? p.cross_references,
                article_number: updated.article_number ?? p.article_number,
                search_index: updated.search_index !== undefined ? updated.search_index : p.search_index,
                brand_reference:
                  updated.brand_reference !== undefined ? updated.brand_reference ?? null : p.brand_reference,
              }
            : p,
        ),
      );

      revalidator.revalidate();
      return;
    }
    const msg =
      typeof d.error === "string"
        ? d.error
        : Array.isArray(d.userErrors) && d.userErrors.length
          ? String(d.userErrors.map((e: any) => e?.message).filter(Boolean).join("; ") || "Update failed")
          : "Update failed";
    setUpdateBanner({ tone: "critical", message: msg });
  }, [updateFetcher.data, revalidator]);

  React.useEffect(() => {
    if (!lastUpdatedProductId) return;
    const t = window.setTimeout(() => setLastUpdatedProductId(null), 8000);
    return () => window.clearTimeout(t);
  }, [lastUpdatedProductId]);

  // After list & revalidation settle, scroll the updated row into view.
  React.useEffect(() => {
    if (revalidator.state !== "idle") return;
    const id = pendingScrollProductId.current;
    if (!id) return;
    const timer = window.setTimeout(() => {
      const el = productRowRefs.current.get(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      pendingScrollProductId.current = null;
    }, 200);
    return () => window.clearTimeout(timer);
  }, [revalidator.state, allProducts]);

  // When filters change, refetch from the server (Shopify query) so we don't get "only first page matches".
  const pushFiltersToUrl = React.useCallback(
    (next: { q?: string; category?: string; systemGroup?: string; subcategory?: string }) => {
      const sp = new URLSearchParams(location.search);
      const nextQ = typeof next.q === "string" ? next.q : query;
      const nextCat = typeof next.category === "string" ? next.category : category;
      const nextSys = typeof next.systemGroup === "string" ? next.systemGroup : systemGroup;
      const nextSub = typeof next.subcategory === "string" ? next.subcategory : subcategory;

      if (nextQ) sp.set("q", nextQ);
      else sp.delete("q");
      if (nextCat) sp.set("category", nextCat);
      else sp.delete("category");
      if (nextSys) sp.set("systemGroup", nextSys);
      else sp.delete("systemGroup");
      if (nextSub) sp.set("subcategory", nextSub);
      else sp.delete("subcategory");

      // Reset pagination cursor on filter changes.
      sp.delete("after");
      sp.delete("meta");
      navigate(`/app/products?${sp.toString()}`);
    },
    [location.search, navigate, query, category, systemGroup, subcategory],
  );

  React.useEffect(() => {
    // When the loader refetches due to URL filter changes, reset list to the new result set.
    setAllProducts(Array.isArray(products) ? products : []);
    setCursor(pageInfo?.endCursor ?? null);
    setHasNext(!!pageInfo?.hasNextPage && !!(pageInfo?.endCursor ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, pageInfo?.endCursor, pageInfo?.hasNextPage]);

  // Cascading options
  const uniqPairs = React.useCallback((items: Array<{ value: string; label: string }>) => {
    const m = new Map<string, string>();
    for (const it of items) {
      const v = String(it?.value ?? "").trim();
      if (!v) continue;
      if (!m.has(v)) m.set(v, String(it?.label ?? v));
    }
    return Array.from(m.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
  }, []);

  const categoryOptions = React.useMemo(() => {
    const base = Array.isArray(metaobjectOptions?.categories) ? metaobjectOptions.categories : [];
    return uniqPairs(base as any);
  }, [metaobjectOptions, uniqPairs]);

  const systemGroupOptions = React.useMemo(() => {
    const base = Array.isArray(metaobjectOptions?.systemGroups) ? metaobjectOptions.systemGroups : [];
    const cat = String(category ?? "").trim();
    const parentKnown = base.some((o: any) => String(o?.parentCategoryId ?? "").trim().length > 0);
    const scoped =
      !cat
        ? base
        : parentKnown
          ? base.filter((o: any) => String(o?.parentCategoryId ?? "").trim() === cat)
          : [];
    const pairs = scoped.map((o: any) => ({ value: String(o?.value ?? ""), label: String(o?.label ?? o?.value ?? "") }));
    return uniqPairs(pairs);
  }, [metaobjectOptions, uniqPairs, category]);

  const systemGroupFilterHelp = React.useMemo(() => {
    const cat = String(category ?? "").trim();
    if (!cat) {
      return "Select a catalog category to narrow system groups to that branch (when metaobjects define the link).";
    }
    const base = Array.isArray(metaobjectOptions?.systemGroups) ? metaobjectOptions.systemGroups : [];
    const parentKnown = base.some((o: any) => String(o?.parentCategoryId ?? "").trim().length > 0);
    if (!parentKnown) {
      return "No category parent link was found on system group metaobjects yet. Link each catalog_system_group to catalog_main_category in Shopify Custom Data, then system groups will list only under the right category.";
    }
    return "Showing only system groups whose parent category matches the selected filter.";
  }, [category, metaobjectOptions?.systemGroups]);

  const subcategoryOptions = React.useMemo(() => {
    const base = Array.isArray(metaobjectOptions?.subcategories) ? metaobjectOptions.subcategories : [];
    const sg = String(systemGroup ?? "").trim();
    const groupLinked = base.some((o: any) => String(o?.systemGroupId ?? "").trim().length > 0);
    const scoped =
      !sg
        ? base
        : groupLinked
          ? base.filter((o: any) => String(o?.systemGroupId ?? "").trim() === sg)
          : [];
    return uniqPairs(scoped as any);
  }, [metaobjectOptions, uniqPairs, systemGroup]);

  const brandOptionsForSelect = React.useMemo(() => {
    const base = Array.isArray(metaobjectOptions?.brands) ? metaobjectOptions.brands : [];
    const pairs = uniqPairs(base as any);
    const currentId = String(editBrandRefId ?? "").trim();
    const curMeta = editing?.brand_reference;
    if (currentId && !pairs.some((o) => o.value === currentId)) {
      const label =
        curMeta?.id === currentId && String(curMeta?.displayName ?? "").trim()
          ? String(curMeta.displayName).trim()
          : currentId;
      return uniqPairs([...pairs, { value: currentId, label }]);
    }
    return pairs;
  }, [metaobjectOptions, uniqPairs, editBrandRefId, editing?.brand_reference]);

  const selectedBrandLabel = React.useMemo(() => {
    const id = String(editBrandRefId ?? "").trim();
    if (!id) return "";
    const opt = brandOptionsForSelect.find((o) => o.value === id);
    if (opt) return opt.label;
    const br = editing?.brand_reference;
    return br?.id === id ? String(br.displayName ?? "").trim() || id : id;
  }, [editBrandRefId, brandOptionsForSelect, editing?.brand_reference]);

  const onChangeCategory = React.useCallback((v: string) => {
    setCategory(v);
    setSystemGroup("");
    setSubcategory("");
    pushFiltersToUrl({ category: v, systemGroup: "", subcategory: "" });
  }, [pushFiltersToUrl]);

  const onChangeSystemGroup = React.useCallback((v: string) => {
    setSystemGroup(v);
    setSubcategory("");
    pushFiltersToUrl({ systemGroup: v, subcategory: "" });
  }, [pushFiltersToUrl]);

  const onChangeSubcategory = React.useCallback(
    (v: string) => {
      setSubcategory(v);
      pushFiltersToUrl({ subcategory: v });
    },
    [pushFiltersToUrl],
  );

  const onChangeQuery = React.useCallback(
    (v: string) => {
      setQuery(v);
    },
    [setQuery],
  );

  const submitQuery = React.useCallback(() => {
    pushFiltersToUrl({ q: query });
  }, [pushFiltersToUrl, query]);

  const allVisibleSelected =
    allProducts.length > 0 && allProducts.every((p) => p?.id && selectedSet.has(String(p.id)));
  const toggleSelectAllVisible = React.useCallback(
    (checked: boolean) => {
      if (checked) {
        const toAdd = allProducts.map((p) => String(p?.id ?? "")).filter(Boolean);
        setSelectedProductIds((prev) => Array.from(new Set([...prev, ...toAdd])));
      } else {
        const toRemove = new Set(allProducts.map((p) => String(p?.id ?? "")).filter(Boolean));
        setSelectedProductIds((prev) => prev.filter((gid) => !toRemove.has(gid)));
      }
    },
    [allProducts],
  );

  const exportSelected = React.useCallback(async () => {
    if (!selectedProductIds.length) {
      setExportWarning("Please select at least one product to export.");
      return;
    }
    setExportWarning(null);
    setIsExporting(true);
    try {
      const fd = new FormData();
      fd.set("productIds", JSON.stringify(selectedProductIds));

      const resp = await fetch(`/app/export-csv${location.search || ""}`, {
        method: "POST",
        body: fd,
        credentials: "include",
        headers: { Accept: "text/csv" },
        redirect: "manual",
      });
      if (!resp.ok) throw new Error(`Export failed (${resp.status})`);

      const ct = resp.headers.get("content-type") || "";
      if (!ct.toLowerCase().includes("text/csv")) {
        const preview = (await resp.text()).slice(0, 200);
        throw new Error(`Export did not return CSV. Got: ${ct || "unknown"}; preview: ${preview}`);
      }

      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "fitment-export.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e: any) {
      setExportWarning(String(e?.message ?? "Export failed"));
    } finally {
      setIsExporting(false);
    }
  }, [selectedProductIds, location.search]);

  return (
    <Page
      title="Products"
    >
      <BlockStack gap="400">
        <InlineStack align="end">
          <InlineStack gap="200">
            <Button onClick={exportSelected} disabled={isExporting} loading={isExporting}>
              Export CSV
            </Button>

            <RemixLink to={`../import${location.search || ""}`} style={{ textDecoration: "none" }}>
              <Button variant="primary">Import CSV</Button>
            </RemixLink>
          </InlineStack>
        </InlineStack>

        {updateBanner ? (
          <Banner tone={updateBanner.tone} title="Update Product" onDismiss={() => setUpdateBanner(null)}>
            <p>{updateBanner.message}</p>
          </Banner>
        ) : null}

        {exportWarning ? (
          <Banner tone="warning" title="Export" onDismiss={() => setExportWarning(null)}>
            <p>{exportWarning}</p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Select a Product
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Search for a product to manage its vehicle fitment links.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Showing <strong>{allProducts.length}</strong> products
            </Text>
            <Checkbox
              label="Select all visible"
              checked={allVisibleSelected}
              onChange={(val) => toggleSelectAllVisible(Boolean(val))}
              disabled={!allProducts.length}
            />
            <InlineStack gap="300" wrap>
              <Select
                label="Category"
                options={[
                  { label: "All Categories", value: "" },
                  ...categoryOptions.map((o) => ({ label: o.label, value: o.value })),
                ]}
                value={category}
                onChange={onChangeCategory}
              />
              <Select
                label="System Group"
                helpText={systemGroupFilterHelp}
                options={[
                  { label: "All System Groups", value: "" },
                  ...systemGroupOptions.map((o) => ({ label: o.label, value: o.value })),
                ]}
                value={systemGroup}
                onChange={onChangeSystemGroup}
              />
              <Select
                label="Sub-category"
                options={[
                  { label: "All Sub-categories", value: "" },
                  ...subcategoryOptions.map((o) => ({ label: o.label, value: o.value })),
                ]}
                value={subcategory}
                onChange={onChangeSubcategory}
              />
              <Button
                variant="secondary"
                onClick={() => {
                  setCategory("");
                  setSystemGroup("");
                  setSubcategory("");
                  setQuery("");
                  pushFiltersToUrl({ q: "", category: "", systemGroup: "", subcategory: "" });
                }}
              >
                Reset
              </Button>
            </InlineStack>
            <TextField
              label="Search by title or handle"
              value={query}
              onChange={onChangeQuery}
              autoComplete="off"
              placeholder="Search by title or handle..."
              connectedRight={
                <Button onClick={submitQuery} disabled={!query.trim()}>
                  Search
                </Button>
              }
            />
            {hasNext ? (
              <InlineStack align="end">
                <Button
                  variant="plain"
                  onClick={() => {
                    if (moreFetcher.state !== "idle") return;
                    const sp = new URLSearchParams(location.search);
                    if (cursor) sp.set("after", cursor);
                    sp.set("meta", "0");
                    moreFetcher.load(`/app/products?${sp.toString()}`);
                  }}
                  disabled={moreFetcher.state !== "idle"}
                  loading={moreFetcher.state !== "idle"}
                >
                  Load more
                </Button>
              </InlineStack>
            ) : null}
          </BlockStack>
        </Card>

        <Card>
          <ResourceList
            resourceName={{ singular: "product", plural: "products" }}
            items={allProducts}
            renderItem={(p: any) => {
              const productNumId = String(p?.id ?? "").split("/").pop() || "";
              const adminUrl = productNumId
                ? `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/products/${encodeURIComponent(productNumId)}`
                : "";
              const checked = !!(p?.id && selectedSet.has(String(p.id)));
              const gid = String(p?.id ?? "");
              const isHighlighted = !!lastUpdatedProductId && lastUpdatedProductId === gid;
              return (
                <ResourceItem id={p.id} accessibilityLabel={p.title || p.handle} onClick={() => {}}>
                  <div
                    ref={(el) => {
                      if (!gid) return;
                      if (el) productRowRefs.current.set(gid, el);
                      else productRowRefs.current.delete(gid);
                    }}
                    style={{
                      borderRadius: "12px",
                      padding: isHighlighted ? "10px 12px" : "2px 4px",
                      margin: isHighlighted ? "-6px -10px" : "0",
                      transition: "background-color 0.2s ease, box-shadow 0.2s ease",
                      ...(isHighlighted
                        ? {
                            backgroundColor: "rgba(22, 163, 74, 0.09)",
                            boxShadow: "inset 0 0 0 2px rgba(22, 163, 74, 0.38)",
                          }
                        : {}),
                    }}
                  >
                  <InlineStack gap="300" align="space-between" blockAlign="center" wrap>
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      <Checkbox
                        label=""
                        checked={checked}
                        onChange={(val) => {
                          if (!gid) return;
                          if (val) setSelectedProductIds((prev) => (prev.includes(gid) ? prev : [...prev, gid]));
                          else setSelectedProductIds((prev) => prev.filter((x) => x !== gid));
                        }}
                      />
                      <Thumbnail
                        source={p.featuredImageUrl || "https://cdn.shopify.com/static/images/placeholders/product-1.png"}
                        alt={p.featuredImageAlt}
                        size="small"
                      />
                      <BlockStack gap="050">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          {p.title || "(untitled)"}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {p.handle}
                        </Text>
                        {String(p?.vendor ?? "").trim() ? (
                          <Text as="p" variant="bodySm" tone="subdued">
                            Vendor: {String(p.vendor).trim()}
                          </Text>
                        ) : null}
                        <InlineStack gap="200" wrap>
                          <Badge tone={p.vehicleCount > 0 ? "success" : "read-only"}>
                            {p.vehicleCount > 0 ? `${p.vehicleCount} vehicles` : "No fitment"}
                          </Badge>
                        </InlineStack>
                      </BlockStack>
                    </InlineStack>

                    <InlineStack gap="200" wrap>
                      <RemixLink
                        to={`../fitment/${encodeURIComponent(p.handle)}${location.search || ""}`}
                        style={{ textDecoration: "none" }}
                      >
                        <Button variant="primary">Manage Fitment</Button>
                      </RemixLink>
                      <Button
                        onClick={() => {
                          if (!p?.id) return;
                          setEditing(p);
                        }}
                      >
                        Update Product
                      </Button>
                      <RemixLink
                        to={`../images?productId=${encodeURIComponent(String(p?.id ?? ""))}${location.search || ""}`}
                        style={{ textDecoration: "none" }}
                      >
                        <Button>Upload Images</Button>
                      </RemixLink>
                      {adminUrl ? (
                        <a
                          href={adminUrl}
                          target="_top"
                          rel="noreferrer"
                          style={{ textDecoration: "none" }}
                        >
                          <Button>View Product</Button>
                        </a>
                      ) : null}
                    </InlineStack>
                  </InlineStack>
                  </div>
                </ResourceItem>
              );
            }}
          />
        </Card>

        <Modal
          open={!!editing}
          onClose={() => setEditing(null)}
          title={editing?.title ? `Update: ${editing.title}` : "Update Product"}
          size="large"
          limitHeight
          primaryAction={{
            content: "Save",
            onAction: () => {
              if (!editing?.id) return;
              const fd = new FormData();
              fd.set("intent", "product_update");
              fd.set("productId", editing.id);
              fd.set("title", editTitle);
              fd.set("vendor", editVendor);
              fd.set("oe_references", editOeText);
              fd.set("cross_references", editCrossText);
              fd.set("article_number", editArticleNumber);
              fd.set("brand_reference", editBrandRefId);
              updateFetcher.submit(fd, { method: "post" });
            },
            loading: updateFetcher.state !== "idle",
            disabled: !String(editTitle || "").trim(),
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setEditing(null),
              disabled: updateFetcher.state !== "idle",
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <TextField label="Product title" value={editTitle} onChange={setEditTitle} autoComplete="off" />
              <TextField label="Vendor (brand)" value={editVendor} onChange={setEditVendor} autoComplete="off" />
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Brand reference
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Links this product to the Brand metaobject (custom.brand_reference).
                </Text>
                {selectedBrandLabel ? (
                  <Text as="p" variant="bodySm">
                    Brand: <strong>{selectedBrandLabel}</strong>
                  </Text>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No brand linked.
                  </Text>
                )}
                <InlineStack gap="200" wrap blockAlign="end">
                  <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                    <Select
                      label="Brand"
                      options={[
                        { label: "Select entry…", value: "" },
                        ...brandOptionsForSelect.map((o) => ({ label: o.label, value: o.value })),
                      ]}
                      value={editBrandRefId}
                      onChange={setEditBrandRefId}
                    />
                  </div>
                  <Button onClick={() => setEditBrandRefId("")} disabled={!editBrandRefId} variant="secondary">
                    Clear
                  </Button>
                </InlineStack>
              </BlockStack>
              <TextField
                label="OE References"
                value={editOeText}
                onChange={setEditOeText}
                autoComplete="off"
                multiline={5}
                helpText="One OE reference per line."
              />
              <TextField
                label="Cross References"
                value={editCrossText}
                onChange={setEditCrossText}
                autoComplete="off"
                multiline={5}
                helpText="One cross reference per line."
              />
              <TextField label="Article number" value={editArticleNumber} onChange={setEditArticleNumber} autoComplete="off" />
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}

