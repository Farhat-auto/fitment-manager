import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useFetcher, useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import * as React from "react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  InlineStack,
  IndexTable,
  Checkbox,
  Select,
  TextField,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { GET_PRODUCTS_FOR_FITMENT_ADMIN, LIST_METAOBJECTS_BY_TYPE } from "../graphql/fitment";
import { paginateMetaobjects } from "../utils/paginateMetaobjects.server";

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type Option = { value: string; label: string };

type ProductRow = {
  id: string;
  title: string;
  handle: string;
  sku: string;
  category: { value: string; label: string } | null;
  systemGroup: { value: string; label: string } | null;
  subcategory: { value: string; label: string } | null;
};

function metaobjectFieldValue(node: any, key: string): string {
  const fields: any[] = Array.isArray(node?.fields) ? node.fields : [];
  const f = fields.find((x) => String(x?.key ?? "") === key);
  return typeof f?.value === "string" ? f.value.trim() : "";
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
  return typeof f?.value === "string" ? f.value.trim() : "";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  // CSV download endpoint (avoids returning HTML in embedded contexts)
  if (url.searchParams.get("download") === "1") {
    const raw = String(url.searchParams.get("product_ids") ?? "").trim();
    let productIds: string[] = [];
    try {
      const parsed = JSON.parse(raw || "[]");
      if (Array.isArray(parsed)) productIds = parsed.map((x) => String(x || "")).filter(Boolean);
    } catch {
      return json({ ok: false, error: "Invalid product_ids" }, { status: 400 });
    }

    productIds = Array.from(new Set(productIds));
    if (!productIds.length) {
      return json({ ok: false, error: "No products selected" }, { status: 400 });
    }

    const rows: string[] = [];
    rows.push(
      [
        "product_id",
        "product_handle",
        "product_title",
        "product_sku",
        "category",
        "system_group",
        "subcategory",
        "vehicle_gid",
        "vehicle_key",
        "vehicle_handle",
        "make",
        "model",
        "year_from",
        "year_to",
        "engine",
        "variant",
        "body_type",
      ].join(","),
    );

    const QUERY = `#graphql
      query ExportProducts($ids: [ID!]!, $refsFirst: Int! = 250) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            handle
            variants(first: 1) { nodes { sku } }
            category: metafield(namespace: "custom", key: "catalog_main_category") {
              value
              reference { ... on Metaobject { displayName } }
            }
            systemGroup: metafield(namespace: "custom", key: "catalog_system_group") {
              value
              reference { ... on Metaobject { displayName } }
            }
            subcategory: metafield(namespace: "custom", key: "catalog_subcategory") {
              value
              reference { ... on Metaobject { displayName } }
            }
            fitmentVehicles: metafield(namespace: "fitment", key: "vehicles") {
              references(first: $refsFirst) {
                nodes {
                  ... on Metaobject {
                    id
                    handle
                    displayName
                    fields {
                      key
                      value
                      reference {
                        ... on Metaobject {
                          id
                          displayName
                          name: field(key: "name") { value }
                          display_name: field(key: "display_name") { value }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const chunkSize = 50;
    for (let i = 0; i < productIds.length; i += chunkSize) {
      const chunk = productIds.slice(i, i + chunkSize);
      const resp = await admin.graphql(QUERY, { variables: { ids: chunk, refsFirst: 250 } });
      const gql = await resp.json();
      const nodes: any[] = Array.isArray(gql?.data?.nodes) ? gql.data.nodes : [];

      for (const p of nodes) {
        if (!p || typeof p !== "object") continue;
        const productId = String(p?.id ?? "");
        const productHandle = String(p?.handle ?? "");
        const productTitle = String(p?.title ?? "");
        const sku = String(p?.variants?.nodes?.[0]?.sku ?? "").trim();

        const categoryLabel =
          String(p?.category?.reference?.displayName ?? "").trim() || String(p?.category?.value ?? "").trim();
        const systemGroupLabel =
          String(p?.systemGroup?.reference?.displayName ?? "").trim() || String(p?.systemGroup?.value ?? "").trim();
        const subcategoryLabel =
          String(p?.subcategory?.reference?.displayName ?? "").trim() || String(p?.subcategory?.value ?? "").trim();

        const vNodes: any[] = Array.isArray(p?.fitmentVehicles?.references?.nodes)
          ? p.fitmentVehicles.references.nodes
          : [];

        if (!vNodes.length) {
          rows.push(
            [
              csvEscape(productId),
              csvEscape(productHandle),
              csvEscape(productTitle),
              csvEscape(sku),
              csvEscape(categoryLabel),
              csvEscape(systemGroupLabel),
              csvEscape(subcategoryLabel),
              "",
              "",
              "",
              "",
              "",
              "",
              "",
              "",
              "",
              "",
            ].join(","),
          );
          continue;
        }

        for (const v of vNodes) {
          const vehicleGid = String(v?.id ?? "");
          const vehicleHandle = String(v?.handle ?? "");
          const vehicleKey = metaobjectFieldValue(v, "vehicle_key");

          const make = metaobjectFieldLabel(v, "make");
          const model = metaobjectFieldLabel(v, "model");
          const yearFrom = metaobjectFieldValue(v, "year_from");
          const yearTo = metaobjectFieldValue(v, "year_to");
          const engine =
            metaobjectFieldLabel(v, "engine_code") ||
            metaobjectFieldLabel(v, "engine") ||
            metaobjectFieldValue(v, "engine_code") ||
            metaobjectFieldValue(v, "engine");
          const variant =
            metaobjectFieldLabel(v, "variant") ||
            metaobjectFieldValue(v, "variant") ||
            metaobjectFieldValue(v, "power_hp") ||
            metaobjectFieldValue(v, "power_kw");
          const bodyType =
            metaobjectFieldLabel(v, "body_type") ||
            metaobjectFieldLabel(v, "body") ||
            metaobjectFieldValue(v, "body_type") ||
            metaobjectFieldValue(v, "body");

          rows.push(
            [
              csvEscape(productId),
              csvEscape(productHandle),
              csvEscape(productTitle),
              csvEscape(sku),
              csvEscape(categoryLabel),
              csvEscape(systemGroupLabel),
              csvEscape(subcategoryLabel),
              csvEscape(vehicleGid),
              csvEscape(vehicleKey),
              csvEscape(vehicleHandle),
              csvEscape(make),
              csvEscape(model),
              csvEscape(yearFrom),
              csvEscape(yearTo),
              csvEscape(engine),
              csvEscape(variant),
              csvEscape(bodyType),
            ].join(","),
          );
        }
      }
    }

    const body = rows.join("\n");
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=\"fitment-export.csv\"",
        "cache-control": "no-store",
      },
    });
  }

  const after = url.searchParams.get("after");
  const includeMetaobjectOptions = url.searchParams.get("meta") !== "0";

  const resp = await admin.graphql(GET_PRODUCTS_FOR_FITMENT_ADMIN, {
    variables: { first: 50, after, query: null },
  });
  const gql = await resp.json();
  const conn = gql?.data?.products;
  const nodes: any[] = Array.isArray(conn?.nodes) ? conn.nodes : [];
  const pageInfo = conn?.pageInfo ?? { hasNextPage: false, endCursor: null };

  const products: ProductRow[] = nodes.map((p: any) => {
    const catValue = String(p?.category?.value ?? "").trim();
    const sysValue = String(p?.systemGroup?.value ?? "").trim();
    const subValue = String(p?.subcategory?.value ?? "").trim();
    const catLabel = String(p?.category?.reference?.displayName ?? "").trim() || catValue;
    const sysLabel = String(p?.systemGroup?.reference?.displayName ?? "").trim() || sysValue;
    const subLabel = String(p?.subcategory?.reference?.displayName ?? "").trim() || subValue;
    return {
      id: String(p?.id ?? ""),
      title: String(p?.title ?? ""),
      handle: String(p?.handle ?? ""),
      sku: String(p?.variants?.nodes?.[0]?.sku ?? "").trim(),
      category: catValue ? { value: catValue, label: catLabel } : null,
      systemGroup: sysValue ? { value: sysValue, label: sysLabel } : null,
      subcategory: subValue ? { value: subValue, label: subLabel } : null,
    };
  });

  let categoryOptions: Option[] = [];
  let systemGroupOptions: Option[] = [];
  let subcategoryOptions: Option[] = [];

  if (includeMetaobjectOptions) {
    const [allCategories, allSystemGroups, allSubcategories] = await Promise.all([
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
    systemGroupOptions = allSystemGroups.map(toOption).filter(Boolean) as any;
    subcategoryOptions = allSubcategories.map(toOption).filter(Boolean) as any;
  }

  return json({
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
    },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "").trim();
  if (intent !== "export_selected") {
    return json({ ok: false, error: "Unknown intent" }, { status: 400 });
  }

  const raw = String(fd.get("product_ids") || "").trim();
  let productIds: string[] = [];
  try {
    const parsed = JSON.parse(raw || "[]");
    if (Array.isArray(parsed)) productIds = parsed.map((x) => String(x || "")).filter(Boolean);
  } catch {
    return json({ ok: false, error: "Invalid product_ids" }, { status: 400 });
  }

  productIds = Array.from(new Set(productIds));
  if (!productIds.length) {
    return json({ ok: false, error: "No products selected" }, { status: 400 });
  }

  const rows: string[] = [];
  rows.push(
    [
      "product_id",
      "product_handle",
      "product_title",
      "product_sku",
      "category",
      "system_group",
      "subcategory",
      "vehicle_gid",
      "vehicle_key",
      "vehicle_handle",
      "make",
      "model",
      "year_from",
      "year_to",
      "engine",
      "variant",
      "body_type",
    ].join(","),
  );

  const QUERY = `#graphql
    query ExportProducts($ids: [ID!]!, $refsFirst: Int! = 250) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          handle
          variants(first: 1) { nodes { sku } }
          category: metafield(namespace: "custom", key: "catalog_main_category") {
            value
            reference { ... on Metaobject { displayName } }
          }
          systemGroup: metafield(namespace: "custom", key: "catalog_system_group") {
            value
            reference { ... on Metaobject { displayName } }
          }
          subcategory: metafield(namespace: "custom", key: "catalog_subcategory") {
            value
            reference { ... on Metaobject { displayName } }
          }
          fitmentVehicles: metafield(namespace: "fitment", key: "vehicles") {
            references(first: $refsFirst) {
              nodes {
                ... on Metaobject {
                  id
                  handle
                  displayName
                  fields {
                    key
                    value
                    reference {
                      ... on Metaobject {
                        id
                        displayName
                        name: field(key: "name") { value }
                        display_name: field(key: "display_name") { value }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const chunkSize = 50;
  for (let i = 0; i < productIds.length; i += chunkSize) {
    const chunk = productIds.slice(i, i + chunkSize);
    const resp = await admin.graphql(QUERY, { variables: { ids: chunk, refsFirst: 250 } });
    const gql = await resp.json();
    const nodes: any[] = Array.isArray(gql?.data?.nodes) ? gql.data.nodes : [];

    for (const p of nodes) {
      if (!p || typeof p !== "object") continue;
      const productId = String(p?.id ?? "");
      const productHandle = String(p?.handle ?? "");
      const productTitle = String(p?.title ?? "");
      const sku = String(p?.variants?.nodes?.[0]?.sku ?? "").trim();

      const categoryLabel =
        String(p?.category?.reference?.displayName ?? "").trim() || String(p?.category?.value ?? "").trim();
      const systemGroupLabel =
        String(p?.systemGroup?.reference?.displayName ?? "").trim() || String(p?.systemGroup?.value ?? "").trim();
      const subcategoryLabel =
        String(p?.subcategory?.reference?.displayName ?? "").trim() || String(p?.subcategory?.value ?? "").trim();

      const vNodes: any[] = Array.isArray(p?.fitmentVehicles?.references?.nodes)
        ? p.fitmentVehicles.references.nodes
        : [];

      if (!vNodes.length) {
        rows.push(
          [
            csvEscape(productId),
            csvEscape(productHandle),
            csvEscape(productTitle),
            csvEscape(sku),
            csvEscape(categoryLabel),
            csvEscape(systemGroupLabel),
            csvEscape(subcategoryLabel),
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ].join(","),
        );
        continue;
      }

      for (const v of vNodes) {
        const vehicleGid = String(v?.id ?? "");
        const vehicleHandle = String(v?.handle ?? "");
        const vehicleKey = metaobjectFieldValue(v, "vehicle_key");

        const make = metaobjectFieldLabel(v, "make");
        const model = metaobjectFieldLabel(v, "model");
        const yearFrom = metaobjectFieldValue(v, "year_from");
        const yearTo = metaobjectFieldValue(v, "year_to");
        const engine =
          metaobjectFieldLabel(v, "engine_code") ||
          metaobjectFieldLabel(v, "engine") ||
          metaobjectFieldValue(v, "engine_code") ||
          metaobjectFieldValue(v, "engine");
        const variant =
          metaobjectFieldLabel(v, "variant") ||
          metaobjectFieldValue(v, "variant") ||
          metaobjectFieldValue(v, "power_hp") ||
          metaobjectFieldValue(v, "power_kw");
        const bodyType =
          metaobjectFieldLabel(v, "body_type") ||
          metaobjectFieldLabel(v, "body") ||
          metaobjectFieldValue(v, "body_type") ||
          metaobjectFieldValue(v, "body");

        rows.push(
          [
            csvEscape(productId),
            csvEscape(productHandle),
            csvEscape(productTitle),
            csvEscape(sku),
            csvEscape(categoryLabel),
            csvEscape(systemGroupLabel),
            csvEscape(subcategoryLabel),
            csvEscape(vehicleGid),
            csvEscape(vehicleKey),
            csvEscape(vehicleHandle),
            csvEscape(make),
            csvEscape(model),
            csvEscape(yearFrom),
            csvEscape(yearTo),
            csvEscape(engine),
            csvEscape(variant),
            csvEscape(bodyType),
          ].join(","),
        );
      }
    }
  }

  const body = rows.join("\n");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=\"fitment-export.csv\"",
      "cache-control": "no-store",
    },
  });
}

export default function ExportCsvPage() {
  const { products, pageInfo, metaobjectOptions } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const moreFetcher = useFetcher<typeof loader>();

  const [allProducts, setAllProducts] = React.useState<ProductRow[]>(() => (Array.isArray(products) ? products : []));
  const [cursor, setCursor] = React.useState<string | null>(pageInfo?.endCursor ?? null);
  const [hasNext, setHasNext] = React.useState<boolean>(!!pageInfo?.hasNextPage);

  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [systemGroup, setSystemGroup] = React.useState("");
  const [subcategory, setSubcategory] = React.useState("");

  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);

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
    setCursor(d?.pageInfo?.endCursor ?? null);
    setHasNext(!!d?.pageInfo?.hasNextPage);
  }, [moreFetcher.data]);

  const filteredProducts = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return allProducts.filter((p) => {
      if (category && String(p?.category?.value ?? "") !== category) return false;
      if (systemGroup && String(p?.systemGroup?.value ?? "") !== systemGroup) return false;
      if (subcategory && String(p?.subcategory?.value ?? "") !== subcategory) return false;
      if (!q) return true;
      return (
        String(p?.title ?? "").toLowerCase().includes(q) ||
        String(p?.handle ?? "").toLowerCase().includes(q) ||
        String(p?.sku ?? "").toLowerCase().includes(q)
      );
    });
  }, [allProducts, query, category, systemGroup, subcategory]);

  const allVisibleSelected =
    filteredProducts.length > 0 && filteredProducts.every((p) => p?.id && selectedSet.has(String(p.id)));

  function toggleSelectAllVisible(checked: boolean) {
    if (checked) {
      const toAdd = filteredProducts.map((p) => String(p?.id ?? "")).filter(Boolean);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...toAdd])));
    } else {
      const toRemove = new Set(filteredProducts.map((p) => String(p?.id ?? "")).filter(Boolean));
      setSelectedIds((prev) => prev.filter((id) => !toRemove.has(id)));
    }
  }

  const onChangeCategory = React.useCallback((v: string) => {
    setCategory(v);
    setSystemGroup("");
    setSubcategory("");
  }, []);

  const onChangeSystemGroup = React.useCallback((v: string) => {
    setSystemGroup(v);
    setSubcategory("");
  }, []);

  const metaCategories: Option[] = Array.isArray((metaobjectOptions as any)?.categories)
    ? ((metaobjectOptions as any).categories as any)
    : [];
  const metaSystemGroups: Option[] = Array.isArray((metaobjectOptions as any)?.systemGroups)
    ? ((metaobjectOptions as any).systemGroups as any)
    : [];
  const metaSubcategories: Option[] = Array.isArray((metaobjectOptions as any)?.subcategories)
    ? ((metaobjectOptions as any).subcategories as any)
    : [];

  return (
    <Page
      title="Export CSV"
      backAction={{
        content: "Back to Products",
        onAction: () => navigate(`/app/products${location.search || ""}`),
      }}
    >
      <BlockStack gap="400">
        <Banner tone="info" title="CSV export">
          <p>
            This exports products and their linked vehicles from <code>fitment.vehicles</code>.
          </p>
        </Banner>

        <Card>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              Select products, then export a CSV suitable for editing and re-importing.
            </Text>

            <InlineStack gap="200" blockAlign="center" wrap>
              <Badge tone={selectedIds.length ? "success" : "read-only"}>{`${selectedIds.length} selected`}</Badge>
              <Checkbox
                label="Select all visible"
                checked={allVisibleSelected}
                onChange={(val) => toggleSelectAllVisible(Boolean(val))}
                disabled={filteredProducts.length === 0}
              />
            </InlineStack>

            <InlineStack gap="300" wrap>
              <Select
                label="Category"
                options={[{ label: "All", value: "" }, ...metaCategories.map((o) => ({ label: o.label, value: o.value }))]}
                value={category}
                onChange={onChangeCategory}
              />
              <Select
                label="System Group"
                options={[{ label: "All", value: "" }, ...metaSystemGroups.map((o) => ({ label: o.label, value: o.value }))]}
                value={systemGroup}
                onChange={onChangeSystemGroup}
              />
              <Select
                label="Sub-category"
                options={[{ label: "All", value: "" }, ...metaSubcategories.map((o) => ({ label: o.label, value: o.value }))]}
                value={subcategory}
                onChange={setSubcategory}
              />
              <Button
                variant="secondary"
                onClick={() => {
                  setCategory("");
                  setSystemGroup("");
                  setSubcategory("");
                  setQuery("");
                }}
              >
                Reset
              </Button>
              {hasNext ? (
                <Button
                  variant="plain"
                  onClick={() => {
                    if (moreFetcher.state !== "idle") return;
                    const sp = new URLSearchParams(location.search);
                    if (cursor) sp.set("after", cursor);
                    sp.set("meta", "0");
                    moreFetcher.load(`/app/export?${sp.toString()}`);
                  }}
                  disabled={moreFetcher.state !== "idle"}
                >
                  Load more products
                </Button>
              ) : null}
            </InlineStack>

            <TextField
              label="Search by title, handle, SKU"
              value={query}
              onChange={setQuery}
              autoComplete="off"
              placeholder="Search by title, handle, SKU..."
            />

            <Form method="post" reloadDocument>
              <input type="hidden" name="_intent" value="export_selected" />
              <input type="hidden" name="product_ids" value={JSON.stringify(selectedIds)} />
              <InlineStack>
                <Button variant="primary" submit disabled={!selectedIds.length}>
                  {`Export selected (${selectedIds.length})`}
                </Button>
              </InlineStack>
            </Form>
          </BlockStack>
        </Card>

        <Card>
          <IndexTable itemCount={filteredProducts.length} headings={[{ title: "Select / SKU" }, { title: "Handle" }, { title: "Title" }]} selectable={false}>
            {filteredProducts.slice(0, 300).map((p, idx) => {
              const id = String(p.id || "");
              const checked = !!(id && selectedSet.has(id));
              return (
                <IndexTable.Row id={id || String(idx)} key={id || String(idx)} position={idx}>
                  <IndexTable.Cell>
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <Checkbox
                        label=""
                        checked={checked}
                        onChange={(val) => {
                          if (!id) return;
                          if (val) setSelectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
                          else setSelectedIds((prev) => prev.filter((x) => x !== id));
                        }}
                      />
                      <Text as="span" variant="bodyMd">
                        {p.sku || "—"}
                      </Text>
                    </InlineStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{p.handle || "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{p.title || "(untitled)"}</IndexTable.Cell>
                </IndexTable.Row>
              );
            })}
          </IndexTable>

          {filteredProducts.length > 300 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              Showing first 300 visible products. Refine filters/search to narrow further.
            </Text>
          ) : null}
        </Card>
      </BlockStack>
    </Page>
  );
}

