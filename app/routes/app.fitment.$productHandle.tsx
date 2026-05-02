import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  isRouteErrorResponse,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useParams,
  useRevalidator,
  useRouteError,
} from "@remix-run/react";
import * as React from "react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  InlineStack,
  Banner,
  Divider,
  Badge,
  Checkbox,
  Select,
  IndexTable,
  Tag,
  Box,
  Combobox,
  Listbox,
  AutoSelection,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { GET_PRODUCT_FITMENT, LIST_METAOBJECTS_BY_TYPE, SET_FITMENT_VEHICLES } from "../graphql/fitment";
import { resolveShopDomain } from "../fitment/fitment.server";
import { paginateMetaobjects } from "../utils/paginateMetaobjects.server";
import {
  catalogSystemGroupIdFromSubcategoryNode,
  parentCatalogCategoryIdFromSystemGroupNode,
} from "../utils/catalogMetaobjectParents.server";
import {
  getVehicleIndex,
  indexSummary,
  listMakes,
  listModels,
  vehiclesForMakeModel,
} from "../vehicles/vehicleIndex.server";
import { syncProductCatalogClassificationDerivatives } from "../utils/catalogClassificationTags.server";
import {
  resolveVehicleKeysFromMetaobjectGids,
  setShopifyFitmentKeysMetafield,
  upsertProductFitmentRows,
} from "../fitment/fitmentKeys.server";

function fieldValue(x: any): string {
  const v = x?.value;
  return typeof v === "string" ? v.trim() : "";
}

function normalizeLabel(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

type VehicleSearchNode = {
  id: string;
  handle: string;
  vehicle_key: { value?: string | null } | null;
  display_name: { value?: string | null } | null;
  make: { value: string; label: string } | null;
  model: { value: string; label: string } | null;
};

type Opt = { value: string; label: string };
type Option = { value: string; label: string };

type ClassificationSystemGroupRow = Opt & { parentCategoryId?: string };
type ClassificationSubcategoryRow = Opt & { systemGroupId?: string };

function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Drops null rows, enforces string value/label, de-dupes by value (Polaris Select crashes on dup values). */
function normalizeSystemGroupRows(raw: unknown): ClassificationSystemGroupRow[] {
  const rows = safeArray<any>(raw);
  const out: ClassificationSystemGroupRow[] = [];
  const seen = new Set<string>();
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const value = String((item as any).value ?? "").trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    const label = String((item as any).label ?? value).trim() || value;
    const parentCategoryId = String((item as any).parentCategoryId ?? "").trim();
    out.push({ value, label, parentCategoryId });
  }
  return out;
}

function normalizeSubcategoryRows(raw: unknown): ClassificationSubcategoryRow[] {
  const rows = safeArray<any>(raw);
  const out: ClassificationSubcategoryRow[] = [];
  const seen = new Set<string>();
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const value = String((item as any).value ?? "").trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    const label = String((item as any).label ?? value).trim() || value;
    const systemGroupId = String((item as any).systemGroupId ?? "").trim();
    out.push({ value, label, systemGroupId });
  }
  return out;
}

/**
 * Drops bogus catalog rows (e.g. placeholder metaobjects named "All System Groups") from dropdowns.
 */
function filterSpuriousCatalogRows<T extends Opt>(rows: T[] | undefined): T[] {
  return (safeArray(rows) as T[]).filter((r) => {
    if (!r || typeof (r as Opt).value !== "string") return false;
    const lb = String((r as Opt).label ?? "").trim().toLowerCase();
    if (lb === "all system groups" || lb === "all subcategories" || lb === "all categories") return false;
    return true;
  });
}

function metaobjectFieldValue(node: any, key: string): string {
  const fields: any[] = Array.isArray(node?.fields) ? node.fields : [];
  const f = fields.find((x) => String(x?.key ?? "") === key);
  return typeof f?.value === "string" ? f.value : "";
}

function metaobjectFieldLabel(node: any, key: string): string {
  const fields: any[] = Array.isArray(node?.fields) ? node.fields : [];
  const f = fields.find((x) => String(x?.key ?? "") === key);
  const ref = f?.reference;
  const displayName = typeof ref?.displayName === "string" ? ref.displayName.trim() : "";
  if (displayName) return displayName;
  const name = typeof ref?.name?.value === "string" ? ref.name.value.trim() : "";
  if (name) return name;
  const display_name = typeof ref?.display_name?.value === "string" ? ref.display_name.value.trim() : "";
  if (display_name) return display_name;
  return typeof f?.value === "string" ? f.value : "";
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const productHandle = params.productHandle;
  if (!productHandle) throw new Response("Missing productHandle", { status: 400 });

  if (productHandle === "validation") {
    const url = new URL(request.url);
    return redirect(`/app/fitment-validation${url.search}`);
  }

  const shop_domain =
    String((session as any)?.shop ?? "").trim() || resolveShopDomain(request) || "";
  if (!shop_domain) throw new Response("Missing shop_domain", { status: 400 });

  const resp = await admin.graphql(
    `#graphql
      query GetProductIdByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          id
        }
      }
    `,
    { variables: { handle: productHandle } },
  );
  const idData = await resp.json();
  const productId = idData?.data?.productByHandle?.id;
  if (!productId) throw new Response("Product not found", { status: 404 });

  const fitmentResp = await admin.graphql(GET_PRODUCT_FITMENT, { variables: { id: productId, refsFirst: 250 } });
  const fitmentJson = await fitmentResp.json();
  const p = fitmentJson?.data?.product;
  if (!p) throw new Response("Product not found", { status: 404 });

  const refs = p?.fitmentVehicles?.references?.nodes;
  const selected = Array.isArray(refs) ? refs : [];

  // Product classification (custom.* metaobject references)
  const classification = {
    category: {
      value: String(p?.category?.value ?? "").trim(),
      label: String(p?.category?.reference?.displayName ?? "").trim(),
    },
    systemGroup: {
      value: String(p?.systemGroup?.value ?? "").trim(),
      label: String(p?.systemGroup?.reference?.displayName ?? "").trim(),
    },
    subcategory: {
      value: String(p?.subcategory?.value ?? "").trim(),
      label: String(p?.subcategory?.reference?.displayName ?? "").trim(),
    },
  };

  // Load all categories for the dropdown.
  const categories = await paginateMetaobjects({
    admin,
    query: LIST_METAOBJECTS_BY_TYPE,
    variables: { type: "catalog_main_category" },
    pathToConnection: (d) => d?.metaobjects,
  });
  const categoryOptions: Option[] = (categories || [])
    .map((n: any) => {
      const id = typeof n?.id === "string" ? n.id.trim() : "";
      if (!id) return null;
      const label = String(n?.displayName ?? n?.handle ?? id).trim();
      return { value: id, label };
    })
    .filter(Boolean) as any;

  return json({
    shop_domain,
    product: {
      id: String(p?.id ?? ""),
      title: String(p?.title ?? ""),
      handle: String(p?.handle ?? ""),
    },
    vehicleIndex: indexSummary(await getVehicleIndex({ admin, shopDomain: shop_domain, refresh: false })),
    classification,
    classificationOptions: {
      categories: categoryOptions,
    },
    selectedVehicles: selected.map((n: any) => ({
      id: String(n?.id ?? ""),
      handle: String(n?.handle ?? ""),
      vehicle_key: n?.vehicle_key ?? null,
      display_name: n?.display_name ?? null,
    })),
    // Progressive filters: don't load vehicle datasets at page load.
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const productHandle = params.productHandle;
    if (!productHandle) return json({ ok: false, error: "Missing productHandle" }, { status: 400 });

    const shop_domain =
      String((session as any)?.shop ?? "").trim() || resolveShopDomain(request) || "";
    if (!shop_domain) return json({ ok: false, error: "Missing shop_domain" }, { status: 400 });

    const fd = await request.formData();
    const intent = String(fd.get("_intent") || "").trim();

    // Vehicle Index (cached). Normal filtering must never query Shopify live.
    if (intent === "vehicle_index_status") {
      const idx = await getVehicleIndex({ admin, shopDomain: shop_domain, refresh: false });
      return json({ ok: true, index: indexSummary(idx) });
    }

    if (intent === "vehicle_index_refresh") {
      // Controlled background/index operation (runs in this request).
      const idx = await getVehicleIndex({ admin, shopDomain: shop_domain, refresh: true });
      if (!idx?.vehicles?.length) {
        return json({ ok: false, error: "Vehicle index refresh failed. Try again in a moment." }, { status: 500 });
      }
      return json({ ok: true, index: indexSummary(idx) });
    }

    if (intent === "index_makes") {
      const idx = await getVehicleIndex({ admin, shopDomain: shop_domain, refresh: false });
      if (!idx?.vehicles?.length) {
        return json({ ok: false, error: "Vehicle index is not built yet.", needsRefresh: true }, { status: 409 });
      }
      return json({ ok: true, makes: listMakes(idx), index: indexSummary(idx) });
    }

    if (intent === "index_models") {
      const make = String(fd.get("make") || "").trim();
      const idx = await getVehicleIndex({ admin, shopDomain: shop_domain, refresh: false });
      if (!idx?.vehicles?.length) {
        return json({ ok: false, error: "Vehicle index is not built yet.", needsRefresh: true }, { status: 409 });
      }
      return json({ ok: true, models: make ? listModels(idx, make) : [], index: indexSummary(idx) });
    }

    if (intent === "index_make_model") {
      const make = String(fd.get("make") || "").trim();
      const model = String(fd.get("model") || "").trim();
      const idx = await getVehicleIndex({ admin, shopDomain: shop_domain, refresh: false });
      if (!idx?.vehicles?.length) {
        return json({ ok: false, error: "Vehicle index is not built yet.", needsRefresh: true }, { status: 409 });
      }
      const rows = make && model ? vehiclesForMakeModel(idx, make, model) : [];
      return json({
        ok: true,
        rows,
        index: indexSummary(idx),
      });
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

    // NOTE: Legacy live vehicle querying removed.
    // Fitment filters should rely on the cached Vehicle Index only.

    // Product classification options (catalog_* metaobject types).
    if (intent === "classification_system_groups") {
      const category = String(fd.get("category") || "").trim();
      if (!category) return json({ ok: true, systemGroups: [], classificationLinkage: { scope: "system_groups" as const } });
      const groups = await paginateMetaobjects({
        admin,
        query: LIST_METAOBJECTS_BY_TYPE,
        variables: { type: "catalog_system_group" },
        pathToConnection: (d) => d?.metaobjects,
      });
      const allRows = (groups || [])
        .map((n: any) => {
          const id = typeof n?.id === "string" ? n.id.trim() : "";
          if (!id) return null;
          const label = String(n?.displayName ?? n?.handle ?? id).trim();
          const parentCategoryId = parentCatalogCategoryIdFromSystemGroupNode(n);
          return { value: id, label, parentCategoryId: String(parentCategoryId || "").trim() };
        })
        .filter(Boolean) as Array<{ value: string; label: string; parentCategoryId: string }>;

      const storeHasParentLinks = allRows.some((r) => !!String(r.parentCategoryId || "").trim());
      /**
       * Strict cascade: only show system groups whose parent category matches the selected category.
       * If the store has no parent links at all, return none (admin must link metaobjects in Custom Data).
       */
      const systemGroups = storeHasParentLinks
        ? allRows
            .filter((r) => String(r.parentCategoryId || "").trim() === category)
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }))
        : [];

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
      const systemGroup = String(fd.get("systemGroup") || "").trim();
      if (!systemGroup) return json({ ok: true, subcategories: [], classificationLinkage: { scope: "subcategories" as const } });
      const subs = await paginateMetaobjects({
        admin,
        query: LIST_METAOBJECTS_BY_TYPE,
        variables: { type: "catalog_subcategory" },
        pathToConnection: (d) => d?.metaobjects,
      });
      const allRows = (subs || [])
        .map((n: any) => {
          const id = typeof n?.id === "string" ? n.id.trim() : "";
          if (!id) return null;
          const label = String(n?.displayName ?? n?.handle ?? id).trim();
          const systemGroupId = catalogSystemGroupIdFromSubcategoryNode(n);
          return { value: id, label, systemGroupId: String(systemGroupId || "").trim() };
        })
        .filter(Boolean) as Array<{ value: string; label: string; systemGroupId: string }>;

      const storeHasSystemGroupLinks = allRows.some((r) => !!String(r.systemGroupId || "").trim());
      const subcategories = storeHasSystemGroupLinks
        ? allRows
            .filter((r) => String(r.systemGroupId || "").trim() === systemGroup)
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }))
        : [];

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
      const ownerId = String(fd.get("product_gid") || "").trim();
      const category = String(fd.get("category") || "").trim();
      const systemGroup = String(fd.get("systemGroup") || "").trim();
      const subcategory = String(fd.get("subcategory") || "").trim();
      if (!ownerId) return json({ ok: false, error: "Missing product_gid" }, { status: 400 });
      if (!category || !systemGroup || !subcategory) {
        return json({ ok: false, error: "Please select Category, System Group, and Sub-category." }, { status: 400 });
      }
      const resp = await admin.graphql(SET_PRODUCT_CLASSIFICATION, {
        variables: { ownerId, category, systemGroup, subcategory },
      });
      const data = await resp.json();
      const errs = data?.data?.metafieldsSet?.userErrors ?? [];
      if (Array.isArray(errs) && errs.length) return json({ ok: false, userErrors: errs }, { status: 400 });

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

    // Legacy intents removed.

    if (intent === "save_fitment") {
      const product_gid = String(fd.get("product_gid") || "").trim();
      const vehicle_gids_raw = String(fd.get("vehicle_gids") || "").trim();
      if (!product_gid) return json({ ok: false, error: "Missing product_gid" }, { status: 400 });

      let vehicleGids: string[] = [];
      try {
        const parsed = JSON.parse(vehicle_gids_raw || "[]");
        if (Array.isArray(parsed)) vehicleGids = parsed.map((x) => String(x || "")).filter(Boolean);
      } catch {
        return json({ ok: false, error: "Invalid vehicle_gids" }, { status: 400 });
      }

      const value = JSON.stringify(Array.from(new Set(vehicleGids)));
      const resp = await admin.graphql(SET_FITMENT_VEHICLES, {
        variables: { ownerId: product_gid, value },
      });
      const data = await resp.json();
      const errs = data?.data?.metafieldsSet?.userErrors ?? [];
      if (Array.isArray(errs) && errs.length) {
        return json({ ok: false, userErrors: errs }, { status: 400 });
      }

      // Phase 1 (safe): keep legacy metafields untouched, but also write:
      // - Supabase product_fitment rows (vehicle_key strings)
      // - Shopify custom.fitment_keys JSON (vehicle_key strings)
      let vehicle_keys: string[] = [];
      try {
        const resolved = await resolveVehicleKeysFromMetaobjectGids({
          admin,
          vehicleGids,
        });
        vehicle_keys = Array.from(
          new Set(
            (resolved || [])
              .map((r) => String(r?.vehicle_key ?? "").trim())
              .filter(Boolean),
          ),
        );
      } catch (e) {
        console.warn("FITMENT_KEYS_RESOLVE_FAILED", e);
      }

      let supabaseUpserted = 0;
      try {
        if (vehicle_keys.length) {
          const up = await upsertProductFitmentRows({
            shop_domain,
            product_id: product_gid,
            vehicle_keys,
          });
          supabaseUpserted = up.upserted;
        }
      } catch (e) {
        console.warn("FITMENT_SUPABASE_UPSERT_FAILED", e);
      }

      let fitmentKeysUserErrors: Array<{ field?: string[] | null; message: string }> = [];
      try {
        const r = await setShopifyFitmentKeysMetafield({
          admin,
          productId: product_gid,
          vehicleKeys: vehicle_keys,
        });
        fitmentKeysUserErrors = r.userErrors || [];
        if (fitmentKeysUserErrors.length) console.warn("FITMENT_KEYS_METAFIELD_WARN", fitmentKeysUserErrors);
      } catch (e) {
        console.warn("FITMENT_KEYS_METAFIELD_FAILED", e);
      }

      return json({
        ok: true,
        vehicleCount: vehicleGids.length,
        fitmentKeys: {
          vehicle_keys_count: vehicle_keys.length,
          supabase_upserted: supabaseUpserted,
          metafield_userErrors: fitmentKeysUserErrors,
        },
      });
    }

    return json({ ok: false, error: "Unknown intent" }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("FITMENT_ACTION_ERROR", error);
    const msg = String((error as any)?.message ?? "");
    const isThrottled = msg.toLowerCase().includes("throttled");
    const status = isThrottled ? 429 : 500;
    const safe =
      msg && msg.length < 500
        ? msg
        : isThrottled
          ? "Shopify Admin API throttled this request. Please wait a moment and try again."
          : "Unexpected error. Please try again.";
    return json({ ok: false, error: safe }, { status });
  }
}

export default function FitmentEditor() {
  const { shop_domain, product, selectedVehicles, classification, classificationOptions, vehicleIndex } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const revalidator = useRevalidator();

  const facetFetcher = useFetcher<typeof action>();
  const saveFetcher = useFetcher<typeof action>();
  const classificationFetcher = useFetcher<typeof action>();
  const makeModelFetcher = useFetcher<typeof action>();
  const indexFetcher = useFetcher<typeof action>();

  const [error, setError] = React.useState<string | null>(null);
  const [classificationMsg, setClassificationMsg] = React.useState<string | null>(null);

  // Progressive filter state/options.
  const [filterMake, setFilterMake] = React.useState("");
  const [makeOptions, setMakeOptions] = React.useState<string[]>([]);

  const [filterModel, setFilterModel] = React.useState("");
  const [modelOptions, setModelOptions] = React.useState<string[]>([]);

  const [vehicles, setVehicles] = React.useState<any[]>([]);
  const [makeModelVehicles, setMakeModelVehicles] = React.useState<any[]>([]);
  const [showSelectedOnly, setShowSelectedOnly] = React.useState(false);
  const [rateLimitMsg, setRateLimitMsg] = React.useState<string | null>(null);

  // In-memory caches (per page session).
  const makesCacheRef = React.useRef<string[] | null>(null);
  const modelsByMakeCacheRef = React.useRef<Map<string, string[]>>(new Map());
  const vehiclesByMakeModelCacheRef = React.useRef<Map<string, VehicleSearchNode[]>>(new Map());
  const makeModelRetryOnceRef = React.useRef<Map<string, boolean>>(new Map());

  // Product classification state.
  const [classCategory, setClassCategory] = React.useState<string>(() => String((classification as any)?.category?.value ?? ""));
  const [classSystemGroup, setClassSystemGroup] = React.useState<string>(() => String((classification as any)?.systemGroup?.value ?? ""));
  const [classSubcategory, setClassSubcategory] = React.useState<string>(() => String((classification as any)?.subcategory?.value ?? ""));
  const [allSystemGroups, setAllSystemGroups] = React.useState<ClassificationSystemGroupRow[]>([]);
  const [allSubcategories, setAllSubcategories] = React.useState<ClassificationSubcategoryRow[]>([]);
  const [classificationLinkage, setClassificationLinkage] = React.useState<{
    storeHasParentLinks?: boolean;
    storeHasSystemGroupLinks?: boolean;
    totalSystemGroupsInStore?: number;
    systemGroupsShown?: number;
    totalSubcategoriesInStore?: number;
    subcategoriesShown?: number;
  }>({});

  const isBusy =
    navigation.state !== "idle" ||
    facetFetcher.state !== "idle" ||
    saveFetcher.state !== "idle" ||
    classificationFetcher.state !== "idle";

  const [selectedVehicleGids, setSelectedVehicleGids] = React.useState<string[]>(() =>
    (Array.isArray(selectedVehicles) ? selectedVehicles : [])
      .map((v: any) => String(v?.id ?? ""))
      .filter(Boolean),
  );

  const selectedVehicleGidSet = React.useMemo(() => new Set(selectedVehicleGids), [selectedVehicleGids]);
  const selectedCount = selectedVehicleGids.length;

  function cacheKey(intent: string, payload: Record<string, string>) {
    const entries = Object.entries(payload)
      .map(([k, v]) => [k, String(v ?? "")] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
    return `${intent}::${entries.map(([k, v]) => `${k}=${v}`).join("&")}`;
  }

  function submitFacet(intent: string, payload: Record<string, string>) {
    if (intent === "index_makes" && makesCacheRef.current?.length) {
      setMakeOptions(makesCacheRef.current);
      return;
    }
    if (intent === "index_models") {
      const make = String(payload.make || "").trim().toLowerCase();
      const cached = modelsByMakeCacheRef.current.get(make);
      if (cached) {
        setModelOptions(cached);
        return;
      }
    }

    const fd = new FormData();
    fd.set("_intent", intent);
    for (const [k, v] of Object.entries(payload)) fd.set(k, v);
    facetFetcher.submit(fd, { method: "post" });
  }

  function makeModelKey(make: string, model: string) {
    return `${String(make || "").trim()}::${String(model || "").trim()}`;
  }


  const [indexInfo, setIndexInfo] = React.useState<{ builtAt: number; count: number }>(() => (vehicleIndex as any) ?? { builtAt: 0, count: 0 });
  const indexReady = !!indexInfo?.count;

  // Page load: read Make options from cached index (no Shopify).
  React.useEffect(() => {
    const fd = new FormData();
    fd.set("_intent", "index_makes");
    facetFetcher.submit(fd, { method: "post" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount/loader refresh: if classification already selected, load dependent options.
  React.useEffect(() => {
    const cat = String((classification as any)?.category?.value ?? "").trim();
    const sg = String((classification as any)?.systemGroup?.value ?? "").trim();
    const sub = String((classification as any)?.subcategory?.value ?? "").trim();
    setClassCategory(cat);
    setClassSystemGroup(sg);
    setClassSubcategory(sub);
    if (cat) {
      const fd = new FormData();
      fd.set("_intent", "classification_system_groups");
      fd.set("category", cat);
      classificationFetcher.submit(fd, { method: "post" });
    }
    if (sg) {
      const fd = new FormData();
      fd.set("_intent", "classification_subcategories");
      fd.set("systemGroup", sg);
      classificationFetcher.submit(fd, { method: "post" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revalidator.state]);

  // Consume facet fetcher responses.
  React.useEffect(() => {
    const d: any = facetFetcher.data;
    if (!d) return;
    if (d.ok === false && d.needsRefresh) {
      setRateLimitMsg("Vehicle index is not built yet. Click Refresh Vehicle Index.");
      return;
    }
    if (d.ok !== true) return;
    if (d.index) setIndexInfo(d.index);
    if (Array.isArray(d.makes)) {
      const makes = d.makes.map((x: any) => String(x || "").trim()).filter(Boolean);
      makesCacheRef.current = makes;
      setMakeOptions(makes);
    }
    if (Array.isArray(d.models)) {
      const models = d.models.map((x: any) => String(x || "").trim()).filter(Boolean);
      const key = String((facetFetcher as any).submission?.formData?.get("make") || "").trim().toLowerCase();
      if (key) modelsByMakeCacheRef.current.set(key, models);
      setModelOptions(models);
    }
  }, [facetFetcher.data]);

  // Consume make+model vehicles fetcher.
  React.useEffect(() => {
    const d: any = makeModelFetcher.data;
    if (!d) return;
    if (d.ok === true && Array.isArray(d.rows)) {
      const key = makeModelKey(filterMake, filterModel);
      const rows = (d.rows as any[]).filter(Boolean);
      vehiclesByMakeModelCacheRef.current.set(key, rows);
      setMakeModelVehicles(rows);
      setRateLimitMsg(null);
      makeModelRetryOnceRef.current.set(key, false);
      return;
    }
    if (d.ok === false && Number(d.status) === 429) {
      const key = makeModelKey(filterMake, filterModel);
      const alreadyRetried = makeModelRetryOnceRef.current.get(key) === true;
      setRateLimitMsg("Waiting for Shopify rate limit...");
      if (!alreadyRetried) {
        makeModelRetryOnceRef.current.set(key, true);
        setTimeout(() => {
          const fd = new FormData();
          fd.set("_intent", "index_make_model");
          fd.set("make", filterMake);
          fd.set("model", filterModel);
          makeModelFetcher.submit(fd, { method: "post" });
        }, 2000);
      }
    }
  }, [makeModelFetcher.data, filterMake, filterModel]);

  // Consume classification fetcher.
  React.useEffect(() => {
    const d: any = classificationFetcher.data;
    if (!d) return;
    if (d.ok === true && Array.isArray(d.systemGroups)) {
      setAllSystemGroups(normalizeSystemGroupRows(d.systemGroups));
    }
    if (d.ok === true && Array.isArray(d.subcategories)) {
      setAllSubcategories(normalizeSubcategoryRows(d.subcategories));
    }
    if (d.ok === true && d.classificationLinkage && typeof d.classificationLinkage === "object") {
      setClassificationLinkage((prev) => ({ ...prev, ...(d.classificationLinkage as Record<string, unknown>) }));
    }
    if (d.ok === true && d.mode === "classification_saved") {
      const sync = (d as any)?.classificationSync as
        | {
            incompleteKeys?: boolean;
            graphqlErrors?: string[];
            keyMetafieldUserErrors?: Array<{ message?: string }>;
          }
        | undefined;
      let msg = "Classification saved.";
      if (sync?.incompleteKeys) {
        const ge = Array.isArray(sync.graphqlErrors) ? sync.graphqlErrors.filter(Boolean).join("; ") : "";
        msg +=
          " Catalog key metafields (catalog_*_key) may be incomplete — check metaobject slug/handle and Shopify Admin API logs.";
        if (ge) msg += ` Details: ${ge}`;
      }
      const ku = sync?.keyMetafieldUserErrors;
      if (Array.isArray(ku) && ku.length) {
        const first = ku.map((x) => String(x?.message ?? "").trim()).filter(Boolean)[0];
        if (first) msg += ` Metafield definition issue: ${first}`;
      }
      setClassificationMsg(msg);
      revalidator.revalidate();
    }
    if (d.ok === false) {
      setClassificationMsg(String(d.error || "Failed to save classification"));
    }
  }, [classificationFetcher.data, revalidator]);

  const visibleSystemGroups = React.useMemo((): ClassificationSystemGroupRow[] => {
    try {
      if (!String(classCategory || "").trim()) return [];
      const rows = safeArray<ClassificationSystemGroupRow>(allSystemGroups).filter((g) => g && typeof g.value === "string");
      return filterSpuriousCatalogRows(rows);
    } catch (e) {
      console.error("FITMENT_VISIBLE_SYSTEM_GROUPS", e);
      return [];
    }
  }, [allSystemGroups, classCategory]);

  const visibleSubcategories = React.useMemo((): ClassificationSubcategoryRow[] => {
    try {
      if (!String(classSystemGroup || "").trim()) return [];
      const rows = safeArray<ClassificationSubcategoryRow>(allSubcategories).filter((s) => s && typeof s.value === "string");
      return filterSpuriousCatalogRows(rows);
    } catch (e) {
      console.error("FITMENT_VISIBLE_SUBCATEGORIES", e);
      return [];
    }
  }, [allSubcategories, classSystemGroup]);

  /** Clear system group / sub-category when they are not in the strictly filtered lists (avoid invalid saves & Polaris mismatches). */
  React.useEffect(() => {
    const sg = String(classSystemGroup || "").trim();
    if (!sg) return;
    const ok = visibleSystemGroups.some((g) => g.value === sg);
    if (!ok) {
      setClassSystemGroup("");
      setClassSubcategory("");
      setAllSubcategories([]);
    }
  }, [visibleSystemGroups, classSystemGroup]);

  React.useEffect(() => {
    const sub = String(classSubcategory || "").trim();
    if (!sub) return;
    const ok = visibleSubcategories.some((s) => s.value === sub);
    if (!ok) setClassSubcategory("");
  }, [visibleSubcategories, classSubcategory]);

  React.useEffect(() => {
    if (!String(classCategory || "").trim()) setClassificationLinkage({});
  }, [classCategory]);

  const classificationIdle = classificationFetcher.state === "idle";
  const loadingSystemGroups =
    !classificationIdle &&
    String((classificationFetcher as any).submission?.formData?.get("_intent") || "").trim() === "classification_system_groups";
  const loadingSubcategories =
    !classificationIdle &&
    String((classificationFetcher as any).submission?.formData?.get("_intent") || "").trim() === "classification_subcategories";

  const showSystemGroupLinkageWarning =
    !!String(classCategory || "").trim() &&
    classificationIdle &&
    !loadingSystemGroups &&
    (classificationLinkage.storeHasParentLinks === false ||
      (classificationLinkage.storeHasParentLinks === true && visibleSystemGroups.length === 0));

  const showSubcategoryLinkageWarning =
    !!String(classSystemGroup || "").trim() &&
    classificationIdle &&
    !loadingSubcategories &&
    (classificationLinkage.storeHasSystemGroupLinks === false ||
      (classificationLinkage.storeHasSystemGroupLinks === true && visibleSubcategories.length === 0));

  React.useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const sp = new URLSearchParams(window.location.search || "");
      if (sp.get("fitment_debug") !== "1") return;
      console.log("[fitment_debug]", {
        selectedCategoryId: String(classCategory || "").trim() || null,
        selectedSystemGroupId: String(classSystemGroup || "").trim() || null,
        selectedSubcategoryId: String(classSubcategory || "").trim() || null,
        systemGroupsLen: safeArray(allSystemGroups).length,
        visibleSystemGroupsLen: safeArray(visibleSystemGroups).length,
        subcategoriesLen: safeArray(allSubcategories).length,
        visibleSubcategoriesLen: safeArray(visibleSubcategories).length,
      });
    } catch (e) {
      console.warn("[fitment_debug] log failed", e);
    }
  }, [
    classCategory,
    classSystemGroup,
    classSubcategory,
    allSystemGroups,
    visibleSystemGroups,
    allSubcategories,
    visibleSubcategories,
  ]);

  function addVehicleGid(gid: string) {
    const next = String(gid || "").trim();
    if (!next) return;
    if (selectedVehicleGidSet.has(next)) return;
    setSelectedVehicleGids((prev) => [...prev, next]);
  }

  function removeVehicleGid(gid: string) {
    const next = String(gid || "").trim();
    if (!next) return;
    setSelectedVehicleGids((prev) => prev.filter((x) => x !== next));
  }

  function saveFitment() {
    const pid = String(product?.id ?? "").trim();
    if (!pid) {
      setError("Missing product id. Reload the page and try again.");
      return;
    }
    const fd = new FormData();
    fd.set("_intent", "save_fitment");
    fd.set("product_gid", pid);
    fd.set("vehicle_gids", JSON.stringify(selectedVehicleGids));
    saveFetcher.submit(fd, { method: "post" });
  }

  React.useEffect(() => {
    const d: any = saveFetcher.data;
    if (!d || d.ok !== true) return;
    // After successful save, return to Products list so the loader re-reads fitment.vehicles.
    navigate(`/app/products${location.search || ""}`);
  }, [saveFetcher.data, navigate, location.search]);

  // Cascading behavior: reset downstream and progressively load the next options.
  const onSelectMake = React.useCallback(
    (next: string) => {
      setFilterMake(next);
      setFilterModel("");
      setModelOptions([]);
      setVehicles([]);
      setMakeModelVehicles([]);
      if (next) {
        const fd = new FormData();
        fd.set("_intent", "index_models");
        fd.set("make", next);
        facetFetcher.submit(fd, { method: "post" });
      }
    },
    [facetFetcher],
  );

  const onSelectModel = React.useCallback(
    (next: string) => {
      setFilterModel(next);
      setVehicles([]);
      setMakeModelVehicles([]);

      if (filterMake && next) {
        const key = makeModelKey(filterMake, next);
        const cached = vehiclesByMakeModelCacheRef.current.get(key);
        if (cached) {
          setMakeModelVehicles(cached);
          return;
        }
        const fd = new FormData();
        fd.set("_intent", "index_make_model");
        fd.set("make", filterMake);
        fd.set("model", next);
        makeModelFetcher.submit(fd, { method: "post" });
      }
    },
    [filterMake, makeModelFetcher],
  );

  const shownCount = vehicles.length;
  const allVisibleSelected =
    shownCount > 0 && vehicles.every((v) => v?.id && selectedVehicleGidSet.has(String(v.id)));

  const vehicleOptions = React.useMemo(() => {
    const opts = (makeModelVehicles || [])
      .map((v: any) => {
        const gid = String(v?.gid ?? v?.id ?? "").trim();
        if (!gid) return null;
        const dn = String(v?.displayName ?? v?.display_name ?? "").trim();
        const vk = String(v?.vehicleKey ?? v?.vehicle_key ?? "").trim();
        const handle = String(v?.handle ?? "").trim();
        const label = dn || vk || handle || gid;
        return { value: gid, label };
      })
      .filter(Boolean) as Array<{ value: string; label: string }>;

    const m = new Map<string, string>();
    for (const o of opts) if (!m.has(o.value)) m.set(o.value, o.label);
    return Array.from(m.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
  }, [makeModelVehicles]);

  function VehicleCheckboxPicker(props: {
    label: string;
    options: Array<{ value: string; label: string }>;
    selectedVehicleGids: string[];
    setSelectedVehicleGids: React.Dispatch<React.SetStateAction<string[]>>;
    disabled?: boolean;
  }) {
    const { label, options, selectedVehicleGids, setSelectedVehicleGids, disabled } = props;
    const [vehicleInput, setVehicleInput] = React.useState("");

    const optionIds = React.useMemo(() => new Set(options.map((o) => o.value)), [options]);

    const optionById = React.useMemo(() => {
      const m = new Map<string, string>();
      for (const o of options) m.set(o.value, o.label);
      return m;
    }, [options]);

    const selectedInScope = React.useMemo(
      () => selectedVehicleGids.filter((id) => optionIds.has(id)),
      [selectedVehicleGids, optionIds],
    );

    const normalized = vehicleInput.trim().toLowerCase();
    const filteredOptions = React.useMemo(() => {
      if (!normalized) return options.slice(0, 200);
      return options
        .filter((o) => o.label.toLowerCase().includes(normalized))
        .slice(0, 200);
    }, [options, normalized]);

    const selectedLookup = React.useMemo(() => new Set(selectedVehicleGids), [selectedVehicleGids]);

    const handleListboxSelect = React.useCallback(
      (value: string) => {
        if (!value || value === "__none__") return;
        setSelectedVehicleGids((prev) =>
          prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value],
        );
      },
      [setSelectedVehicleGids],
    );

    const selectAllVisible = React.useCallback(() => {
      const ids = filteredOptions.map((o) => o.value);
      setSelectedVehicleGids((prev) => Array.from(new Set([...prev, ...ids])));
    }, [filteredOptions, setSelectedVehicleGids]);

    const clearSelectedInScope = React.useCallback(() => {
      setSelectedVehicleGids((prev) => prev.filter((id) => !optionIds.has(id)));
    }, [optionIds, setSelectedVehicleGids]);

    const fieldDisabled = disabled || options.length === 0;

    const listboxMarkup =
      fieldDisabled ? null : (
        <Listbox autoSelection={AutoSelection.None} onSelect={handleListboxSelect}>
          <Listbox.Section
            divider={false}
            title={
              <InlineStack gap="200" wrap blockAlign="center">
                <Button
                  size="micro"
                  variant="secondary"
                  onClick={selectAllVisible}
                  disabled={filteredOptions.length === 0}
                >
                  Select all visible
                </Button>
                <Button
                  size="micro"
                  variant="secondary"
                  tone="critical"
                  onClick={clearSelectedInScope}
                  disabled={selectedInScope.length === 0}
                >
                  Clear selected
                </Button>
              </InlineStack>
            }
          >
            {filteredOptions.length === 0 ? (
              <Listbox.Option value="__none__" disabled>
                No matches for your search.
              </Listbox.Option>
            ) : (
              filteredOptions.map((o) => (
                <Listbox.Option key={o.value} value={o.value} selected={selectedLookup.has(o.value)}>
                  {o.label}
                </Listbox.Option>
              ))
            )}
          </Listbox.Section>
        </Listbox>
      );

    return (
      <BlockStack gap="200">
        <Box minWidth="240px" maxWidth="min(560px, 92vw)">
          <Combobox
            allowMultiple
            preferredPosition="below"
            height="min(360px, 55vh)"
            activator={
              <Combobox.TextField
                label={label}
                value={vehicleInput}
                onChange={(value) => setVehicleInput(value)}
                placeholder="Type to search vehicles..."
                autoComplete="off"
                disabled={fieldDisabled}
                clearButton={vehicleInput.length > 0}
                onClearButtonClick={() => setVehicleInput("")}
                helpText={
                  disabled
                    ? "Select make and model first."
                    : options.length === 0
                      ? "No vehicles for this make/model."
                      : selectedInScope.length > 0
                        ? `${selectedInScope.length} selected (saved when you click Save Fitment).`
                        : "Search, then tick vehicles in the dropdown."
                }
              />
            }
          >
            {listboxMarkup}
          </Combobox>
          {options.length > 200 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              Showing up to 200 matches while typing.
            </Text>
          ) : null}
        </Box>
        {selectedInScope.length ? (
          <InlineStack gap="100" wrap blockAlign="center">
            {selectedInScope.map((id) => (
              <Tag
                key={id}
                onRemove={
                  disabled ? undefined : () => setSelectedVehicleGids((prev) => prev.filter((x) => x !== id))
                }
              >
                {optionById.get(id) ?? id}
              </Tag>
            ))}
          </InlineStack>
        ) : null}
      </BlockStack>
    );
  }

  // When make+model rows load, show full list in the table (vehicle picker is multi-select).
  React.useEffect(() => {
    if (!filterMake || !filterModel) {
      setVehicles([]);
      return;
    }
    setVehicles(makeModelVehicles);
  }, [filterMake, filterModel, makeModelVehicles]);

  function toggleSelectAllVisible(checked: boolean) {
    if (checked) {
      const toAdd = vehicles.map((v) => String(v?.id ?? "")).filter(Boolean);
      setSelectedVehicleGids((prev) => Array.from(new Set([...prev, ...toAdd])));
    } else {
      const toRemove = new Set(vehicles.map((v) => String(v?.id ?? "")).filter(Boolean));
      setSelectedVehicleGids((prev) => prev.filter((gid) => !toRemove.has(gid)));
    }
  }

  const visibleVehicles = React.useMemo(() => {
    if (!showSelectedOnly) return vehicles;
    return vehicles.filter((v) => v?.id && selectedVehicleGidSet.has(String(v.id)));
  }, [vehicles, selectedVehicleGidSet, showSelectedOnly]);

  return (
    <Page
      title="Manage Product Fitment"
      subtitle={`Manage Fitment: ${product.title || product.handle}`}
      backAction={{
        content: "Back to Products",
        onAction: () => navigate(`/app/products${location.search || ""}`),
      }}
    >
      <BlockStack gap="400">
        {error ? (
          <Banner title="Error" tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Manage Fitment: {product.title || product.handle}
              </Text>
              <Button variant="primary" onClick={saveFitment} disabled={isBusy}>
                Save Fitment
              </Button>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Handle: {product.handle}
            </Text>

            <Divider />

            <InlineStack align="space-between" blockAlign="center" wrap>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">
                  Vehicle index:{" "}
                  {indexReady
                    ? `${indexInfo.count} vehicles cached`
                    : "not built"}
                </Text>
                {indexReady && indexInfo.builtAt ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Built: {new Date(indexInfo.builtAt).toLocaleString()}
                  </Text>
                ) : null}
              </BlockStack>

              <indexFetcher.Form method="post">
                <input type="hidden" name="_intent" value="vehicle_index_refresh" />
                <Button
                  submit
                  variant="secondary"
                  loading={indexFetcher.state !== "idle"}
                  disabled={indexFetcher.state !== "idle"}
                >
                  Refresh Vehicle Index
                </Button>
              </indexFetcher.Form>
            </InlineStack>

            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                Product Classification
              </Text>
              {showSystemGroupLinkageWarning ? (
                <Banner tone="warning" title="Catalog hierarchy">
                  <p>Some system groups are not linked to this category yet.</p>
                  <p style={{ marginTop: 8 }}>
                    In Shopify <strong>Settings → Custom data</strong>, ensure each <code>catalog_system_group</code>{" "}
                    references the correct <code>catalog_main_category</code> (for example, Water Pumps → Cooling System).
                  </p>
                </Banner>
              ) : null}
              {showSubcategoryLinkageWarning ? (
                <Banner tone="warning" title="Catalog hierarchy">
                  <p>Some sub-categories are not linked to this system group yet.</p>
                  <p style={{ marginTop: 8 }}>
                    Ensure each <code>catalog_subcategory</code> references its parent <code>catalog_system_group</code>{" "}
                    (for example, Electric Water Pump → Water Pumps).
                  </p>
                </Banner>
              ) : null}
              {classificationMsg ? (
                <Banner
                  title={String(classificationMsg).toLowerCase().includes("saved") ? "Saved" : "Classification"}
                  tone={String(classificationMsg).toLowerCase().includes("saved") ? "success" : "critical"}
                  onDismiss={() => setClassificationMsg(null)}
                >
                  <p>{classificationMsg}</p>
                </Banner>
              ) : null}
              <InlineStack gap="300" wrap>
                <Select
                  label="Category"
                  options={[
                    { label: "Select category", value: "" },
                    ...safeArray<any>((classificationOptions as any)?.categories)
                      .filter((o) => o && (o.value != null || o.label != null))
                      .map((o: any) => ({
                        label: String(o.label ?? o.value ?? ""),
                        value: String(o.value ?? ""),
                      })),
                  ]}
                  value={classCategory}
                  onChange={(v) => {
                    const next = String(v || "").trim();
                    setClassCategory(next);
                    setClassSystemGroup("");
                    setClassSubcategory("");
                    setAllSystemGroups([]);
                    setAllSubcategories([]);
                    setClassificationLinkage({});
                    if (next) {
                      const fd = new FormData();
                      fd.set("_intent", "classification_system_groups");
                      fd.set("category", next);
                      classificationFetcher.submit(fd, { method: "post" });
                    }
                  }}
                  helpText={
                    loadingSystemGroups
                      ? "Loading system groups…"
                      : classCategory && visibleSystemGroups.length === 0
                        ? "No system groups are linked to this category until metaobject parents are set."
                        : undefined
                  }
                  disabled={classificationFetcher.state !== "idle"}
                />

                <Select
                  label="System Group"
                  options={[
                    { label: "Select system group", value: "" },
                    ...visibleSystemGroups.map((o) => ({
                      label: String(o.label ?? o.value ?? ""),
                      value: String(o.value ?? ""),
                    })),
                  ]}
                  value={classSystemGroup}
                  onChange={(v) => {
                    const next = String(v || "").trim();
                    setClassSystemGroup(next);
                    setClassSubcategory("");
                    setAllSubcategories([]);
                    if (next) {
                      const fd = new FormData();
                      fd.set("_intent", "classification_subcategories");
                      fd.set("systemGroup", next);
                      classificationFetcher.submit(fd, { method: "post" });
                    }
                  }}
                  helpText={
                    loadingSubcategories
                      ? "Loading sub-categories…"
                      : classSystemGroup && visibleSubcategories.length === 0
                        ? "No sub-categories are linked to this system group until metaobject parents are set."
                        : undefined
                  }
                  disabled={!classCategory || classificationFetcher.state !== "idle"}
                />

                <Select
                  label="Sub-category"
                  options={[
                    { label: "Select sub-category", value: "" },
                    ...visibleSubcategories.map((o) => ({
                      label: String(o.label ?? o.value ?? ""),
                      value: String(o.value ?? ""),
                    })),
                  ]}
                  value={classSubcategory}
                  onChange={(v) => setClassSubcategory(String(v || "").trim())}
                  disabled={!classSystemGroup || classificationFetcher.state !== "idle"}
                />

                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Selected category GID: {classCategory || "—"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    System groups for this category: {safeArray(visibleSystemGroups).length}
                    {classificationLinkage.totalSystemGroupsInStore != null
                      ? ` (${String(classificationLinkage.totalSystemGroupsInStore)} in store)`
                      : ""}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Selected system group GID: {classSystemGroup || "—"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Sub-categories for this system group: {safeArray(visibleSubcategories).length}
                    {classificationLinkage.totalSubcategoriesInStore != null
                      ? ` (${String(classificationLinkage.totalSubcategoriesInStore)} in store)`
                      : ""}
                  </Text>
                </BlockStack>

                <Button
                  onClick={() => {
                    const pid = String(product?.id ?? "").trim();
                    if (!pid) {
                      setClassificationMsg("Missing product id. Reload and try again.");
                      return;
                    }
                    setClassificationMsg(null);
                    const fd = new FormData();
                    fd.set("_intent", "classification_save");
                    fd.set("product_gid", pid);
                    fd.set("category", classCategory);
                    fd.set("systemGroup", classSystemGroup);
                    fd.set("subcategory", classSubcategory);
                    classificationFetcher.submit(fd, { method: "post" });
                  }}
                  disabled={!classCategory || !classSystemGroup || !classSubcategory || classificationFetcher.state !== "idle"}
                  loading={classificationFetcher.state !== "idle" && ((classificationFetcher as any).submission?.formData?.get("_intent") as any) === "classification_save"}
                >
                  Save Classification
                </Button>
              </InlineStack>
            </BlockStack>

            <Divider />

            <InlineStack gap="300" wrap>
              <Select
                label="Make"
                options={[
                  { label: "Any", value: "" },
                  ...makeOptions.map((v) => ({ label: v, value: v })),
                ]}
                value={filterMake}
                onChange={onSelectMake}
                disabled={isBusy || facetFetcher.state !== "idle" || !indexReady}
                helpText={!indexReady ? "Build the vehicle index first." : facetFetcher.state !== "idle" && !filterMake ? "Loading makes..." : undefined}
              />

              <Select
                label="Model"
                options={[
                  { label: "Any", value: "" },
                  ...modelOptions.map((v) => ({ label: v, value: v })),
                ]}
                value={filterModel}
                onChange={onSelectModel}
                disabled={isBusy || !filterMake || !indexReady}
                helpText={!indexReady ? "Build the vehicle index first." : facetFetcher.state !== "idle" && !!filterMake && !filterModel ? "Loading models..." : undefined}
              />
              <VehicleCheckboxPicker
                label="Vehicle"
                options={vehicleOptions}
                selectedVehicleGids={selectedVehicleGids}
                setSelectedVehicleGids={setSelectedVehicleGids}
                disabled={isBusy || !filterModel}
              />
              <Button
                variant="secondary"
                onClick={() => {
                  setFilterMake("");
                  setFilterModel("");
                  setModelOptions([]);
                  setVehicles([]);
                  setMakeModelVehicles([]);
                }}
                disabled={isBusy}
              >
                Reset Filters
              </Button>
            </InlineStack>

            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="bodyMd">
                <strong>{selectedCount}</strong> vehicles selected
              </Text>
              <Text as="span" variant="bodyMd" tone="subdued">
                ({visibleVehicles.length} shown)
              </Text>
              {facetFetcher.state !== "idle" ? (
                <Text as="span" variant="bodySm" tone="subdued">
                  Loading options…
                </Text>
              ) : null}
              {makeModelFetcher.state !== "idle" ? (
                <Text as="span" variant="bodySm" tone="subdued">
                  Loading vehicles…
                </Text>
              ) : null}
            </InlineStack>

            {rateLimitMsg ? (
              <Banner tone="warning" title="Vehicle index" onDismiss={() => setRateLimitMsg(null)}>
                <p>{rateLimitMsg}</p>
              </Banner>
            ) : null}

            <InlineStack gap="200" wrap>
              <Checkbox
                label="Select all visible"
                checked={allVisibleSelected}
                onChange={(val) => toggleSelectAllVisible(Boolean(val))}
                disabled={isBusy || vehicles.length === 0}
              />
              <Button
                variant={showSelectedOnly ? "primary" : "secondary"}
                onClick={() => setShowSelectedOnly((v) => !v)}
                disabled={isBusy}
              >
                {showSelectedOnly ? "Showing Selected" : "Show Selected Only"}
              </Button>
              <Button
                tone="critical"
                variant="secondary"
                onClick={() => setSelectedVehicleGids([])}
                disabled={isBusy || selectedCount === 0}
              >
                Clear Fitment
              </Button>
            </InlineStack>

            {Array.isArray(visibleVehicles) && visibleVehicles.length ? (
              <IndexTable
                itemCount={visibleVehicles.length}
                selectable={false}
                headings={[
                  { title: "" },
                  { title: "Vehicle Display Name" },
                  { title: "Make" },
                  { title: "Model" },
                  { title: "Handle" },
                ]}
              >
                {visibleVehicles.map((v: any, idx: number) => {
                  const gid = String(v?.gid ?? v?.id ?? "");
                  const checked = !!(gid && selectedVehicleGidSet.has(gid));
                  const displayName = String(v?.displayName ?? v?.display_name ?? "").trim();
                  const makeLabel = String(v?.makeName ?? v?.make?.label ?? v?.make?.value ?? "").trim();
                  const modelLabel = String(v?.modelName ?? v?.model?.label ?? v?.model?.value ?? "").trim();
                  const handle = String(v?.handle ?? "").trim();
                  return (
                    <IndexTable.Row id={gid || String(idx)} key={gid || String(idx)} position={idx}>
                      <IndexTable.Cell>
                        <Checkbox
                          label=""
                          checked={checked}
                          onChange={(val) => (val ? addVehicleGid(gid) : removeVehicleGid(gid))}
                          disabled={isBusy || !gid}
                        />
                      </IndexTable.Cell>
                      <IndexTable.Cell>{displayName || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{makeLabel || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{modelLabel || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{handle || "—"}</IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            ) : (
              <Text as="p" variant="bodyMd">
                {filterMake && filterModel
                  ? "No vehicles match your search."
                  : filterMake
                    ? "Select a Model to load vehicles."
                    : "Select a Make to load vehicles."}
              </Text>
            )}

            {saveFetcher.data && (saveFetcher.data as any).ok === false ? (
              <Banner title="Save failed" tone="critical">
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify((saveFetcher.data as any).userErrors ?? saveFetcher.data, null, 2)}
                </pre>
              </Banner>
            ) : null}

            {saveFetcher.data && (saveFetcher.data as any).ok === true ? (
              <Banner title="Fitment saved" tone="success">
                <p>
                  Saved {String((saveFetcher.data as any).vehicleCount ?? 0)} vehicle references to{" "}
                  <code>fitment.vehicles</code>.
                </p>
              </Banner>
            ) : null}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  const summary = React.useMemo(() => {
    try {
      return {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
    } catch {
      return { message: "Unknown error", stack: undefined as string | undefined };
    }
  }, [error]);

  React.useEffect(() => {
    console.error("FITMENT_ROUTE_ERROR_BOUNDARY", summary);
  }, [summary]);

  if (isRouteErrorResponse(error)) {
    return (
      <Page title="Manage Product Fitment">
        <Banner tone="critical" title={`${error.status} ${error.statusText}`}>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(error.data, null, 2)}</pre>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="Manage Product Fitment — error"
      backAction={{
        content: "Back to Products",
        onAction: () => navigate("/app/products"),
      }}
    >
      <Card>
        <BlockStack gap="300">
          <Banner tone="critical" title="This page crashed">
            <p>{summary.message}</p>
          </Banner>
          {summary.stack ? (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, overflow: "auto", maxHeight: 360 }}>
              {summary.stack}
            </pre>
          ) : null}
          <Text as="p" variant="bodySm" tone="subdued">
            Details were logged as <code>FITMENT_ROUTE_ERROR_BOUNDARY</code>. For classification debugging, reload with{" "}
            <code>?fitment_debug=1</code>.
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
