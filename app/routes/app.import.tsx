import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
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
import { SEARCH_VEHICLES } from "../graphql/fitment";
import { resolveShopDomain, upsertFitmentRows } from "../fitment/fitment.server";

type CsvRow = {
  product_handle?: string;
  sku?: string;
  article_number?: string;
  brand?: string;
  vehicle_key?: string;
  vehicle_handle?: string;
  category_key?: string;
  system_group_key?: string;
  subcategory_key?: string;
  line: number;
};

type ValidatedStatus = "ready" | "warning" | "error";
type ValidatedRow = CsvRow & {
  status: ValidatedStatus;
  message: string;
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
  const idxProductHandle = header.indexOf("product_handle");
  const idxSku = header.indexOf("sku");
  const idxArticle = header.indexOf("article_number");
  const idxBrand = header.indexOf("brand");
  const idxVehicleKey = header.indexOf("vehicle_key");
  const idxVehicleHandle = header.indexOf("vehicle_handle");
  const idxCategory = header.indexOf("category_key");
  const idxGroup = header.indexOf("system_group_key");
  const idxSub = header.indexOf("subcategory_key");

  const headerOk =
    (idxProductHandle !== -1 || idxSku !== -1 || idxArticle !== -1) &&
    (idxVehicleKey !== -1 || idxVehicleHandle !== -1);

  const out: Array<CsvRow & { status: "ok" | "invalid"; error?: string }> = [];
  for (let r = 1; r < raw.length; r++) {
    const cols = raw[r];
    const product_handle = idxProductHandle !== -1 ? str(cols[idxProductHandle] ?? "") : "";
    const sku = idxSku !== -1 ? str(cols[idxSku] ?? "") : "";
    const article_number = idxArticle !== -1 ? str(cols[idxArticle] ?? "") : "";
    const brand = idxBrand !== -1 ? str(cols[idxBrand] ?? "") : "";
    const vehicle_key = idxVehicleKey !== -1 ? str(cols[idxVehicleKey] ?? "") : "";
    const vehicle_handle = idxVehicleHandle !== -1 ? str(cols[idxVehicleHandle] ?? "") : "";
    const category_key = idxCategory !== -1 ? str(cols[idxCategory] ?? "") : "";
    const system_group_key = idxGroup !== -1 ? str(cols[idxGroup] ?? "") : "";
    const subcategory_key = idxSub !== -1 ? str(cols[idxSub] ?? "") : "";

    const base: CsvRow = {
      product_handle: product_handle || undefined,
      sku: sku || undefined,
      article_number: article_number || undefined,
      brand: brand || undefined,
      vehicle_key: vehicle_key || undefined,
      vehicle_handle: vehicle_handle || undefined,
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
          "Missing required headers. Need one of product_handle|sku|article_number and one of vehicle_key|vehicle_handle.",
      });
      continue;
    }
    const hasProduct = !!(product_handle || sku || article_number);
    const hasVehicle = !!(vehicle_key || vehicle_handle);
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
      product_handle: str(r.product_handle) || undefined,
      sku: str(r.sku) || undefined,
      article_number: str(r.article_number) || undefined,
      brand: str(r.brand) || undefined,
      vehicle_key: str(r.vehicle_key) || undefined,
      vehicle_handle: str(r.vehicle_handle) || undefined,
      category_key: str(r.category_key) || undefined,
      system_group_key: str(r.system_group_key) || undefined,
      subcategory_key: str(r.subcategory_key) || undefined,
      line: Number(r.line || 0) || 0,
    }));
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "Invalid rows JSON" }, { status: 400 });
  }

  const valid = rows.filter(
    (r) => !!((r.product_handle || r.sku || r.article_number) && (r.vehicle_key || r.vehicle_handle)),
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
    const ph = str(r.product_handle || "").toLowerCase();
    if (ph) {
      if (productByHandleCache.has(ph)) return productByHandleCache.get(ph) ?? null;
      const resp = await admin.graphql(PRODUCT_BY_HANDLE, { variables: { handle: ph } });
      const json = await resp.json();
      const p = json?.data?.productByHandle ?? null;
      productByHandleCache.set(ph, p);
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
    const vk = str(r.vehicle_key || "");
    const vh = str(r.vehicle_handle || "");
    const key = vk ? `vk:${vk}` : vh ? `vh:${vh}` : "";
    if (!key) return null;
    if (vehicleCache.has(key)) return vehicleCache.get(key) ?? null;

    const q = vk || vh;
    const resp = await admin.graphql(SEARCH_VEHICLES, { variables: { first: 15, after: null, query: q || null } });
    const json = await resp.json();
    const nodes: any[] = Array.isArray(json?.data?.metaobjectsByType?.nodes)
      ? json.data.metaobjectsByType.nodes
      : [];

    let chosen: any | null = null;
    if (vk) chosen = nodes.find((n) => fieldValue(n?.vehicle_key) === vk) ?? null;
    if (!chosen && vh) chosen = nodes.find((n) => String(n?.handle ?? "") === vh) ?? null;
    if (!chosen) chosen = nodes[0] ?? null;
    vehicleCache.set(key, chosen);
    return chosen;
  }

  const validatedRows: ValidatedRow[] = [];
  const upserts: any[] = [];

  for (const r of valid.slice(0, 500)) {
    const product = await resolveProduct(r);
    if (!product?.id || !product?.handle) {
      validatedRows.push({ ...r, status: "error", message: "Product not found (handle → SKU → article_number)" });
      continue;
    }
    const vehicle = await resolveVehicle(r);
    const vehicleKeyResolved = fieldValue(vehicle?.vehicle_key) || str(r.vehicle_key || "");
    if (!vehicle?.id || !vehicleKeyResolved) {
      validatedRows.push({ ...r, status: "error", message: "Vehicle not found (vehicle_key → handle → display_name)" });
      continue;
    }

    const skuResolved = String(product?.variants?.nodes?.[0]?.sku ?? "").trim();
    const articleResolved = String(product?.article_number?.value ?? "").trim();
    const brandResolved = String(product?.brand?.value ?? "").trim();

    validatedRows.push({
      ...r,
      status: "ready",
      message: "OK",
      product_id: String(product.id),
      product_handle_resolved: String(product.handle),
      vehicle_id: String(vehicle.id),
      vehicle_key_resolved: vehicleKeyResolved,
    });

    upserts.push({
      shop_domain,
      product_gid: String(product.id),
      product_handle: String(product.handle),
      sku: skuResolved || (r.sku ? String(r.sku) : null),
      article_number: articleResolved || (r.article_number ? String(r.article_number) : null),
      brand: brandResolved || (r.brand ? String(r.brand) : null),
      vehicle_gid: String(vehicle.id),
      vehicle_handle: String(vehicle.handle ?? "") || null,
      vehicle_key: vehicleKeyResolved,
      vehicle_display_name: fieldValue(vehicle.display_name) || null,
      category_key: r.category_key ? String(r.category_key) : null,
      system_group_key: r.system_group_key ? String(r.system_group_key) : null,
      subcategory_key: r.subcategory_key ? String(r.subcategory_key) : null,
      source: "import",
    });
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

  await upsertFitmentRows(upserts);
  return json({
    ok: true,
    mode: "apply",
    counts,
    rows: validatedRows,
    summary: { rows: valid.length, upserted: upserts.length },
  });
}

export default function ImportCsv() {
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
              product_handle: r.product_handle,
              sku: r.sku,
              article_number: r.article_number,
              brand: r.brand,
              vehicle_key: r.vehicle_key,
              vehicle_handle: r.vehicle_handle,
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
      setError("CSV must include one of product_handle|sku|article_number and one of vehicle_key|vehicle_handle");
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
          product_handle: r.product_handle,
          sku: r.sku,
          article_number: r.article_number,
          brand: r.brand,
          vehicle_key: r.vehicle_key,
          vehicle_handle: r.vehicle_handle,
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
      backAction={{ content: "Products", url: "/app/products" }}
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
                CSV columns: <Text as="span">product_handle</Text> or <Text as="span">sku</Text> or{" "}
                <Text as="span">article_number</Text>, <Text as="span">brand</Text>,{" "}
                <Text as="span">vehicle_key</Text> or <Text as="span">vehicle_handle</Text>,{" "}
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
                { title: "Category/Subcat" },
                { title: "Status" },
              ]}
              selectable={false}
            >
              {(Array.isArray(validated) ? validated : okRows).slice(0, 300).map((r: any, idx: number) => {
                const status: ValidatedStatus | "invalid" | "ok" = r.status;
                const msg = String(r.message || r.error || "");
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
                        {r.product_handle || r.sku || r.article_number || "—"}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd">
                        {r.vehicle_key || r.vehicle_handle || "—"}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {(r.category_key || "—") + " / " + (r.subcategory_key || "—")}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="200" blockAlign="center">
                        {badge}
                        {msg ? (
                          <Text as="span" tone={status === "error" || status === "invalid" ? "critical" : undefined} variant="bodySm">
                            {msg}
                          </Text>
                        ) : null}
                      </InlineStack>
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

