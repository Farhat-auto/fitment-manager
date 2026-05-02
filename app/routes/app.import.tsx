import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLocation, useNavigate } from "@remix-run/react";
import * as React from "react";
import {
  Page,
  Card,
  BlockStack,
  DropZone,
  Text,
  InlineStack,
  Button,
  IndexTable,
  Banner,
  ProgressBar,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { SEARCH_VEHICLES, SET_FITMENT_VEHICLES } from "../graphql/fitment";
import { resolveShopDomain } from "../fitment/fitment.server";

type CsvRow = {
  product_id?: string;
  product_handle?: string;
  product_sku?: string;
  product_title?: string;
  category?: string;
  system_group?: string;
  subcategory?: string;
  sku?: string;
  article_number?: string;
  brand?: string;
  vehicle_gid?: string;
  vehicle_key?: string;
  vehicle_handle?: string;
  make?: string;
  model?: string;
  year_from?: string;
  year_to?: string;
  engine?: string;
  variant?: string;
  body_type?: string;
  category_key?: string;
  system_group_key?: string;
  subcategory_key?: string;
  line: number;
};

type ValidatedStatus = "ready" | "warning" | "error";
type ValidatedRow = CsvRow & {
  status: ValidatedStatus;
  errors: string[];
  product_id?: string;
  product_handle_resolved?: string;
  vehicle_id?: string;
  vehicle_key_resolved?: string;
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function fieldValue(x: any): string {
  const v = x?.value;
  return typeof v === "string" ? v.trim() : "";
}

function csvParse(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    // ignore trailing empty line
    if (row.length === 1 && row[0] === "" && rows.length === 0) return;
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      pushField();
      pushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  pushField();
  if (row.length > 1 || (row.length === 1 && row[0] !== "")) pushRow();
  return rows;
}

function buildPreview(csvText: string): {
  rows: Array<CsvRow & { status: "ok" | "invalid"; error?: string }>;
  headerOk: boolean;
  header: string[];
} {
  const raw = csvParse(csvText);
  if (!raw.length) return { rows: [], headerOk: false, header: [] };

  const header = raw[0].map((h) => str(h).toLowerCase());
  const idxProductId = header.indexOf("product_id");
  const idxProductHandle = header.indexOf("product_handle");
  const idxProductSku = header.indexOf("product_sku");
  const idxProductTitle = header.indexOf("product_title");
  const idxSku = header.indexOf("sku");
  const idxArticle = header.indexOf("article_number");
  const idxBrand = header.indexOf("brand");
  const idxVehicleGid = header.indexOf("vehicle_gid");
  const idxVehicleKey = header.indexOf("vehicle_key");
  const idxVehicleHandle = header.indexOf("vehicle_handle");
  const idxMake = header.indexOf("make");
  const idxModel = header.indexOf("model");
  const idxYearFrom = header.indexOf("year_from");
  const idxYearTo = header.indexOf("year_to");
  const idxEngine = header.indexOf("engine");
  const idxVariant = header.indexOf("variant");
  const idxBodyType = header.indexOf("body_type");
  const idxCategoryLabel = header.indexOf("category");
  const idxSystemGroupLabel = header.indexOf("system_group");
  const idxSubcategoryLabel = header.indexOf("subcategory");
  const idxCategory = header.indexOf("category_key");
  const idxGroup = header.indexOf("system_group_key");
  const idxSub = header.indexOf("subcategory_key");

  const headerOk =
    (idxProductId !== -1 || idxProductHandle !== -1 || idxProductSku !== -1 || idxSku !== -1 || idxArticle !== -1) &&
    (idxVehicleGid !== -1 || idxVehicleKey !== -1 || idxVehicleHandle !== -1 || (idxMake !== -1 && idxModel !== -1));

  const out: Array<CsvRow & { status: "ok" | "invalid"; error?: string }> = [];
  for (let r = 1; r < raw.length; r++) {
    const cols = raw[r];
    const product_id = idxProductId !== -1 ? str(cols[idxProductId] ?? "") : "";
    const product_handle = idxProductHandle !== -1 ? str(cols[idxProductHandle] ?? "") : "";
    const product_sku = idxProductSku !== -1 ? str(cols[idxProductSku] ?? "") : "";
    const product_title = idxProductTitle !== -1 ? str(cols[idxProductTitle] ?? "") : "";
    const sku = idxSku !== -1 ? str(cols[idxSku] ?? "") : "";
    const article_number = idxArticle !== -1 ? str(cols[idxArticle] ?? "") : "";
    const brand = idxBrand !== -1 ? str(cols[idxBrand] ?? "") : "";
    const vehicle_gid = idxVehicleGid !== -1 ? str(cols[idxVehicleGid] ?? "") : "";
    const vehicle_key = idxVehicleKey !== -1 ? str(cols[idxVehicleKey] ?? "") : "";
    const vehicle_handle = idxVehicleHandle !== -1 ? str(cols[idxVehicleHandle] ?? "") : "";
    const make = idxMake !== -1 ? str(cols[idxMake] ?? "") : "";
    const model = idxModel !== -1 ? str(cols[idxModel] ?? "") : "";
    const year_from = idxYearFrom !== -1 ? str(cols[idxYearFrom] ?? "") : "";
    const year_to = idxYearTo !== -1 ? str(cols[idxYearTo] ?? "") : "";
    const engine = idxEngine !== -1 ? str(cols[idxEngine] ?? "") : "";
    const variant = idxVariant !== -1 ? str(cols[idxVariant] ?? "") : "";
    const body_type = idxBodyType !== -1 ? str(cols[idxBodyType] ?? "") : "";
    const category = idxCategoryLabel !== -1 ? str(cols[idxCategoryLabel] ?? "") : "";
    const system_group = idxSystemGroupLabel !== -1 ? str(cols[idxSystemGroupLabel] ?? "") : "";
    const subcategory = idxSubcategoryLabel !== -1 ? str(cols[idxSubcategoryLabel] ?? "") : "";
    const category_key = idxCategory !== -1 ? str(cols[idxCategory] ?? "") : "";
    const system_group_key = idxGroup !== -1 ? str(cols[idxGroup] ?? "") : "";
    const subcategory_key = idxSub !== -1 ? str(cols[idxSub] ?? "") : "";

    const base: CsvRow = {
      product_id: product_id || undefined,
      product_handle: product_handle || undefined,
      product_sku: product_sku || undefined,
      product_title: product_title || undefined,
      category: category || undefined,
      system_group: system_group || undefined,
      subcategory: subcategory || undefined,
      sku: sku || undefined,
      article_number: article_number || undefined,
      brand: brand || undefined,
      vehicle_gid: vehicle_gid || undefined,
      vehicle_key: vehicle_key || undefined,
      vehicle_handle: vehicle_handle || undefined,
      make: make || undefined,
      model: model || undefined,
      year_from: year_from || undefined,
      year_to: year_to || undefined,
      engine: engine || undefined,
      variant: variant || undefined,
      body_type: body_type || undefined,
      category_key: category_key || undefined,
      system_group_key: system_group_key || undefined,
      subcategory_key: subcategory_key || undefined,
      line: r + 1,
    };
    if (!headerOk) {
      out.push({
        ...base,
        status: "invalid",
        error:
          "Missing required headers. Need one of product_id|product_handle|product_sku|sku|article_number and one of vehicle_gid|vehicle_key|vehicle_handle or make+model.",
      });
      continue;
    }
    const hasProduct = !!(product_id || product_handle || product_sku || sku || article_number);
    const hasVehicle = !!(vehicle_gid || vehicle_key || vehicle_handle || (make && model));
    if (!hasProduct || !hasVehicle) {
      out.push({ ...base, status: "invalid", error: "Missing product identifier or vehicle identifier" });
      continue;
    }
    out.push({ ...base, status: "ok" });
  }
  return { rows: out, headerOk, header };
}

function uniqStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const s = String(it ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop_domain =
    String((session as any)?.shop ?? "").trim() || resolveShopDomain(request) || "";
  if (!shop_domain) return json({ ok: false, error: "Missing shop_domain" }, { status: 400 });

  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "validate").trim() || "validate";
  const rowsRaw = String(fd.get("rows") || "").trim();
  if (!rowsRaw) return json({ ok: false, error: "Missing rows" }, { status: 400 });

  let rows: CsvRow[] = [];
  try {
    const parsed = JSON.parse(rowsRaw);
    if (!Array.isArray(parsed)) throw new Error("rows must be an array");
    rows = parsed.map((r: any) => ({
      product_id: str(r.product_id) || undefined,
      product_handle: str(r.product_handle) || undefined,
      product_sku: str(r.product_sku) || undefined,
      product_title: str(r.product_title) || undefined,
      category: str(r.category) || undefined,
      system_group: str(r.system_group) || undefined,
      subcategory: str(r.subcategory) || undefined,
      sku: str(r.sku) || undefined,
      article_number: str(r.article_number) || undefined,
      brand: str(r.brand) || undefined,
      vehicle_gid: str(r.vehicle_gid) || undefined,
      vehicle_key: str(r.vehicle_key) || undefined,
      vehicle_handle: str(r.vehicle_handle) || undefined,
      make: str(r.make) || undefined,
      model: str(r.model) || undefined,
      year_from: str(r.year_from) || undefined,
      year_to: str(r.year_to) || undefined,
      engine: str(r.engine) || undefined,
      variant: str(r.variant) || undefined,
      body_type: str(r.body_type) || undefined,
      category_key: str(r.category_key) || undefined,
      system_group_key: str(r.system_group_key) || undefined,
      subcategory_key: str(r.subcategory_key) || undefined,
      line: Number(r.line || 0) || 0,
    }));
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "Invalid rows JSON" }, { status: 400 });
  }

  const valid = rows.filter(
    (r) =>
      !!(
        (r.product_id || r.product_handle || r.product_sku || r.sku || r.article_number) &&
        (r.vehicle_gid || r.vehicle_key || r.vehicle_handle || (r.make && r.model))
      ),
  );
  if (!valid.length) return json({ ok: false, error: "No valid rows" }, { status: 400 });

  const PRODUCT_BY_HANDLE = `#graphql
    query ProductByHandle($handle: String!) {
      productByHandle(handle: $handle) {
        id
        title
        handle
        variants(first: 1) { nodes { sku } }
        article_number: metafield(namespace: "custom", key: "article_number") { value }
        brand: metafield(namespace: "custom", key: "brand") { value }
      }
    }
  `;
  const PRODUCTS_BY_QUERY = `#graphql
    query ProductsByQuery($first: Int!, $query: String!) {
      products(first: $first, query: $query) {
        nodes {
          id
          title
          handle
          variants(first: 1) { nodes { sku } }
          article_number: metafield(namespace: "custom", key: "article_number") { value }
          brand: metafield(namespace: "custom", key: "brand") { value }
        }
      }
    }
  `;

  const productByHandleCache = new Map<string, any | null>();
  const productBySkuCache = new Map<string, any | null>();
  const productByArticleCache = new Map<string, any | null>();

  async function resolveProduct(r: CsvRow) {
    const productId = str(r.product_id || "");
    if (productId.startsWith("gid://")) {
      // Product GID from export - already resolved.
      return { id: productId, handle: r.product_handle || null };
    }

    const ph = str(r.product_handle || "").toLowerCase();
    if (ph) {
      if (productByHandleCache.has(ph)) return productByHandleCache.get(ph) ?? null;
      const resp = await admin.graphql(PRODUCT_BY_HANDLE, { variables: { handle: ph } });
      const json = await resp.json();
      const p = json?.data?.productByHandle ?? null;
      productByHandleCache.set(ph, p);
      if (p?.id) return p;
    }

    const productSku = str(r.product_sku || "");
    if (productSku) {
      if (productBySkuCache.has(productSku)) return productBySkuCache.get(productSku) ?? null;
      const resp = await admin.graphql(PRODUCTS_BY_QUERY, { variables: { first: 3, query: `sku:${productSku}` } });
      const json = await resp.json();
      const nodes = json?.data?.products?.nodes;
      const p = Array.isArray(nodes) && nodes.length ? nodes[0] : null;
      productBySkuCache.set(productSku, p);
      if (p?.id) return p;
    }

    const sku = str(r.sku || "");
    if (sku) {
      if (productBySkuCache.has(sku)) return productBySkuCache.get(sku) ?? null;
      const resp = await admin.graphql(PRODUCTS_BY_QUERY, { variables: { first: 3, query: `sku:${sku}` } });
      const json = await resp.json();
      const nodes = json?.data?.products?.nodes;
      const p = Array.isArray(nodes) && nodes.length ? nodes[0] : null;
      productBySkuCache.set(sku, p);
      if (p?.id) return p;
    }
    const an = str(r.article_number || "");
    if (an) {
      if (productByArticleCache.has(an)) return productByArticleCache.get(an) ?? null;
      const resp = await admin.graphql(PRODUCTS_BY_QUERY, {
        variables: { first: 3, query: `metafield:custom.article_number:${an}` },
      });
      const json = await resp.json();
      const nodes = json?.data?.products?.nodes;
      const p = Array.isArray(nodes) && nodes.length ? nodes[0] : null;
      productByArticleCache.set(an, p);
      if (p?.id) return p;
    }
    return null;
  }

  const vehicleCache = new Map<string, any | null>();
  async function resolveVehicle(r: CsvRow) {
    const gid = str(r.vehicle_gid || "");
    if (gid) {
      if (!gid.startsWith("gid://shopify/Metaobject/")) {
        vehicleCache.set(`gid:${gid}`, null);
        return null;
      }
      const key = `gid:${gid}`;
      if (vehicleCache.has(key)) return vehicleCache.get(key) ?? null;
      const resp = await admin.graphql(
        `#graphql
          query VehicleById($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Metaobject {
                id
                type
                handle
                fields { key value }
              }
            }
          }
        `,
        { variables: { ids: [gid] } },
      );
      const json = await resp.json();
      const node = Array.isArray(json?.data?.nodes) ? json.data.nodes[0] : null;
      if (!node?.id) {
        vehicleCache.set(key, null);
        return null;
      }
      if (String(node?.type ?? "") !== "vehicle") {
        vehicleCache.set(key, null);
        return null;
      }
      vehicleCache.set(key, node);
      return node;
    }

    const vk = str(r.vehicle_key || "");
    const vh = str(r.vehicle_handle || "");
    const make = str(r.make || "");
    const model = str(r.model || "");
    const key = gid ? `gid:${gid}` : vk ? `vk:${vk}` : vh ? `vh:${vh}` : make && model ? `mm:${make}|${model}` : "";
    if (!key) return null;
    if (vehicleCache.has(key)) return vehicleCache.get(key) ?? null;

    const q = [vk, vh, make, model, str(r.year_from || ""), str(r.year_to || ""), str(r.engine || ""), str(r.variant || "")]
      .filter(Boolean)
      .join(" ");
    const resp = await admin.graphql(SEARCH_VEHICLES, { variables: { first: 30, after: null, query: q || null } });
    const json = await resp.json();
    const nodesRaw: any[] = Array.isArray(json?.data?.metaobjects?.nodes)
      ? json.data.metaobjects.nodes
      : [];
    const nodes: any[] = nodesRaw.map((n) => {
      const fields: any[] = Array.isArray(n?.fields) ? n.fields : [];
      const fieldValueByKey = (key: string) =>
        String(fields.find((f) => String(f?.key ?? "") === key)?.value ?? "").trim();
      return {
        ...n,
        vehicle_key: { value: fieldValueByKey("vehicle_key") },
        display_name: { value: fieldValueByKey("display_name") },
      };
    });

    let chosen: any | null = null;
    if (vk) chosen = nodes.find((n) => fieldValue(n?.vehicle_key) === vk) ?? null;
    if (!chosen && vh) chosen = nodes.find((n) => String(n?.handle ?? "") === vh) ?? null;
    if (!chosen) chosen = nodes[0] ?? null;
    vehicleCache.set(key, chosen);
    return chosen;
  }

  const validatedRows: ValidatedRow[] = [];
  const byProduct = new Map<string, Set<string>>();

  for (const r of valid.slice(0, 500)) {
    const errors: string[] = [];
    if (!(r.product_id || r.product_handle || r.product_sku || r.sku || r.article_number)) {
      errors.push("Missing product_id/product_handle/product_sku");
    }
    if (!(r.vehicle_gid || r.vehicle_handle || r.vehicle_key || (r.make && r.model))) {
      errors.push("Missing vehicle fields");
    }

    const product = await resolveProduct(r);
    if (!product?.id) {
      errors.push("Product not found");
      validatedRows.push({ ...r, status: "error", errors });
      continue;
    }
    const vehicle = await resolveVehicle(r);
    const vehicleKeyResolved = fieldValue(vehicle?.vehicle_key) || str(r.vehicle_key || "");
    if (!vehicle?.id || !vehicleKeyResolved) {
      if (r.vehicle_gid && !String(r.vehicle_gid).startsWith("gid://shopify/Metaobject/")) {
        errors.push("Invalid vehicle_gid");
      } else if (r.vehicle_gid) {
        errors.push("Vehicle not found by vehicle_gid");
      } else if (r.vehicle_handle) {
        errors.push("Vehicle not found by vehicle_handle");
      } else if (r.vehicle_key) {
        errors.push("Vehicle not found by vehicle_key");
      } else {
        errors.push("Vehicle not found by make/model/year/engine/variant");
      }
      validatedRows.push({
        ...r,
        status: "error",
        errors,
        product_id: String(product.id),
        product_handle_resolved: String(product.handle ?? r.product_handle ?? ""),
      });
      continue;
    }

    const skuResolved = String(product?.variants?.nodes?.[0]?.sku ?? "").trim();
    const articleResolved = String(product?.article_number?.value ?? "").trim();
    const brandResolved = String(product?.brand?.value ?? "").trim();

    validatedRows.push({
      ...r,
      status: "ready",
      errors: [],
      product_id: String(product.id),
      product_handle_resolved: String(product.handle ?? r.product_handle ?? ""),
      vehicle_id: String(vehicle.id),
      vehicle_key_resolved: vehicleKeyResolved,
    });

    const pid = String(product.id);
    if (!byProduct.has(pid)) byProduct.set(pid, new Set());
    byProduct.get(pid)!.add(String(vehicle.id));
  }

  const counts = {
    ready: validatedRows.filter((r) => r.status === "ready").length,
    warning: validatedRows.filter((r) => r.status === "warning").length,
    error: validatedRows.filter((r) => r.status === "error").length,
  };

  if (intent === "validate") {
    return json({ ok: true, mode: "validate", counts, rows: validatedRows });
  }

  const ready = validatedRows.filter((r) => r.status === "ready");
  if (!ready.length) {
    return json({ ok: false, error: "No rows ready to import", mode: "apply", counts, rows: validatedRows }, { status: 400 });
  }

  // Apply to Shopify metafield fitment.vehicles (no Supabase).
  for (const [productGid, set] of byProduct.entries()) {
    const value = JSON.stringify(Array.from(set));
    const resp = await admin.graphql(SET_FITMENT_VEHICLES, { variables: { ownerId: productGid, value } });
    const data = await resp.json();
    const errs = data?.data?.metafieldsSet?.userErrors ?? [];
    if (Array.isArray(errs) && errs.length) {
      return json(
        { ok: false, error: `Failed to set fitment for a product`, userErrors: errs, mode: "apply", counts, rows: validatedRows },
        { status: 400 },
      );
    }
  }
  return json({
    ok: true,
    mode: "apply",
    counts,
    rows: validatedRows,
    summary: { rows: valid.length, updatedProducts: byProduct.size },
  });
}

export default function ImportCsv() {
  const navigate = useNavigate();
  const location = useLocation();
  const validateFetcher = useFetcher<typeof action>();
  const applyFetcher = useFetcher<typeof action>();
  const [fileName, setFileName] = React.useState<string>("");
  const [csvText, setCsvText] = React.useState<string>("");
  const [preview, setPreview] = React.useState<Array<CsvRow & { status: "ok" | "invalid"; error?: string }>>([]);
  const [headerOk, setHeaderOk] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const busy = validateFetcher.state !== "idle" || applyFetcher.state !== "idle";

  React.useEffect(() => {
    if (!csvText) {
      setPreview([]);
      setHeaderOk(false);
      return;
    }
    const p = buildPreview(csvText);
    setPreview(p.rows);
    setHeaderOk(p.headerOk);

    // Kick off validation when headers look OK and we have parseable rows.
    if (p.headerOk) {
      const ok = p.rows.filter((r) => r.status === "ok");
      if (ok.length) {
        const fd = new FormData();
        fd.set("_intent", "validate");
        fd.set(
          "rows",
          JSON.stringify(
            ok.map((r) => ({
              product_id: r.product_id,
              product_handle: r.product_handle,
              product_sku: r.product_sku,
              product_title: r.product_title,
              category: r.category,
              system_group: r.system_group,
              subcategory: r.subcategory,
              sku: r.sku,
              article_number: r.article_number,
              brand: r.brand,
              vehicle_gid: r.vehicle_gid,
              vehicle_key: r.vehicle_key,
              vehicle_handle: r.vehicle_handle,
              make: r.make,
              model: r.model,
              year_from: r.year_from,
              year_to: r.year_to,
              engine: r.engine,
              variant: r.variant,
              body_type: r.body_type,
              category_key: r.category_key,
              system_group_key: r.system_group_key,
              subcategory_key: r.subcategory_key,
              line: r.line,
            })),
          ),
        );
        validateFetcher.submit(fd, { method: "post" });
      }
    }
  }, [csvText]);

  function onDrop(_droppedFiles: File[], acceptedFiles: File[]) {
    setError(null);
    const f = acceptedFiles[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ""));
    reader.onerror = () => setError("Failed to read file");
    reader.readAsText(f);
  }

  const okRows = preview.filter((r) => r.status === "ok");
  const invalidRows = preview.filter((r) => r.status === "invalid");

  const validated = (validateFetcher.data as any)?.rows as ValidatedRow[] | undefined;
  const counts = (validateFetcher.data as any)?.counts as { ready: number; warning: number; error: number } | undefined;
  const readyRows = Array.isArray(validated) ? validated.filter((r) => r.status === "ready") : [];

  function submitApply() {
    setError(null);
    if (!headerOk) {
      setError(
        "CSV must include one of product_id|product_handle|product_sku|sku|article_number and one of vehicle_gid|vehicle_handle|vehicle_key or make+model",
      );
      return;
    }
    if (!readyRows.length) {
      setError("No ready rows to import");
      return;
    }
    const fd = new FormData();
    fd.set("_intent", "apply");
    fd.set(
      "rows",
      JSON.stringify(
        readyRows.map((r) => ({
          product_id: r.product_id,
          product_handle: r.product_handle,
          product_sku: r.product_sku,
          product_title: r.product_title,
          category: r.category,
          system_group: r.system_group,
          subcategory: r.subcategory,
          sku: r.sku,
          article_number: r.article_number,
          brand: r.brand,
          vehicle_gid: r.vehicle_gid,
          vehicle_key: r.vehicle_key,
          vehicle_handle: r.vehicle_handle,
          make: r.make,
          model: r.model,
          year_from: r.year_from,
          year_to: r.year_to,
          engine: r.engine,
          variant: r.variant,
          body_type: r.body_type,
          category_key: r.category_key,
          system_group_key: r.system_group_key,
          subcategory_key: r.subcategory_key,
          line: r.line,
        })),
      ),
    );
    applyFetcher.submit(fd, { method: "post" });
  }

  const result = applyFetcher.data as any;

  return (
    <Page
      title="Bulk import (CSV)"
      backAction={{
        content: "Back to Products",
        onAction: () => navigate(`/app/products${location.search || ""}`),
      }}
      primaryAction={{
        content: counts ? `Import ${counts.ready} rows` : "Import",
        onAction: submitApply,
        disabled: busy || !readyRows.length,
        loading: busy,
      }}
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Import error">
            <p>{error}</p>
          </Banner>
        ) : null}

        {result?.ok === false ? (
          <Banner tone="critical" title="Import failed">
            <p>{String(result.error || "Unknown error")}</p>
          </Banner>
        ) : null}

        {result?.ok === true ? (
          <Banner tone="success" title="Import complete">
            <p>
              Rows parsed: {result.summary?.rows} • Upserted: {result.summary?.upserted}
            </p>
          </Banner>
        ) : null}

        {counts ? (
          <Banner
            tone={counts.error ? "critical" : counts.warning ? "warning" : "success"}
            title="Validation summary"
          >
            <p>
              {counts.ready} rows ready, {counts.warning} warnings, {counts.error} errors — Import {counts.ready} rows?
            </p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Upload CSV
            </Text>
            <DropZone accept=".csv" type="file" onDrop={onDrop}>
              <DropZone.FileUpload />
            </DropZone>
            {fileName ? (
              <Text as="p" variant="bodyMd" tone="subdued">
                Loaded: <Text as="span">{fileName}</Text>
              </Text>
            ) : (
              <Text as="p" variant="bodyMd" tone="subdued">
                CSV columns: <Text as="span">product_id</Text> or <Text as="span">product_handle</Text> or{" "}
                <Text as="span">product_sku</Text> or <Text as="span">sku</Text> or{" "}
                <Text as="span">article_number</Text>, <Text as="span">brand</Text>,{" "}
                <Text as="span">vehicle_gid</Text> or <Text as="span">vehicle_key</Text> or{" "}
                <Text as="span">vehicle_handle</Text> or <Text as="span">make</Text>+<Text as="span">model</Text>,{" "}
                <Text as="span">category_key</Text>, <Text as="span">system_group_key</Text>,{" "}
                <Text as="span">subcategory_key</Text>.
              </Text>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Preview
              </Text>
              <InlineStack gap="200" blockAlign="center">
                <Badge tone={headerOk ? "success" : "critical"}>{headerOk ? "Headers OK" : "Bad headers"}</Badge>
                {counts ? (
                  <>
                    <Badge tone="success">{`${counts.ready} ready`}</Badge>
                    <Badge tone="warning">{`${counts.warning} warnings`}</Badge>
                    <Badge tone={counts.error ? "critical" : "success"}>{`${counts.error} errors`}</Badge>
                  </>
                ) : (
                  <Badge tone={invalidRows.length ? "warning" : "success"}>
                    {invalidRows.length ? `${invalidRows.length} invalid` : "Parsed"}
                  </Badge>
                )}
              </InlineStack>
            </InlineStack>

            {busy ? <ProgressBar progress={50} /> : null}

            <IndexTable
              itemCount={preview.length}
              headings={[
                { title: "Row" },
                { title: "Product" },
                { title: "Vehicle" },
                { title: "Status" },
                { title: "Error" },
              ]}
              selectable={false}
            >
              {(Array.isArray(validated) ? validated : okRows).slice(0, 300).map((r: any, idx: number) => {
                const status: ValidatedStatus | "invalid" | "ok" = r.status;
                const msg = Array.isArray(r.errors)
                  ? r.errors.map((x: any) => String(x || "").trim()).filter(Boolean).join("; ")
                  : String(r.error || "");
                const badge =
                  status === "ready" ? <Badge tone="success">Ready</Badge> :
                  status === "warning" ? <Badge tone="warning">Warning</Badge> :
                  status === "error" ? <Badge tone="critical">Error</Badge> :
                  status === "invalid" ? <Badge tone="critical">Error</Badge> :
                  <Badge>Parsed</Badge>;

                return (
                  <IndexTable.Row id={`${r.line}:${idx}`} key={`${r.line}:${idx}`} position={idx}>
                    <IndexTable.Cell>{r.line}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd">
                        {r.product_id || r.product_handle || r.product_sku || r.sku || r.article_number || "—"}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd">
                        {r.vehicle_gid || r.vehicle_handle || r.vehicle_key || "—"}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="200" blockAlign="center">
                        {badge}
                        {status === "ready" ? (
                          <Text as="span" variant="bodySm" tone="subdued">
                            OK
                          </Text>
                        ) : null}
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text
                        as="span"
                        variant="bodySm"
                        tone={status === "error" || status === "invalid" ? "critical" : "subdued"}
                      >
                        {msg || "—"}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>

            {preview.length > 300 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                Showing first 300 rows.
              </Text>
            ) : null}

            <InlineStack align="end">
              <Button onClick={submitApply} disabled={busy || !readyRows.length} loading={busy}>
                Import {String(counts ? counts.ready : 0)} rows
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

