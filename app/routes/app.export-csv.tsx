import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

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

async function exportCsv(admin: any, productIds: string[]) {
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

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const raw = String(url.searchParams.get("productIds") ?? "").trim();
  let productIds: string[] = [];
  try {
    const parsed = JSON.parse(raw || "[]");
    if (Array.isArray(parsed)) productIds = parsed.map((x) => String(x || "")).filter(Boolean);
  } catch {
    return json({ ok: false, error: "Invalid productIds" }, { status: 400 });
  }
  productIds = Array.from(new Set(productIds));
  if (!productIds.length) return json({ ok: false, error: "No products selected" }, { status: 400 });
  return exportCsv(admin, productIds);
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const fd = await request.formData();
  const raw = String(fd.get("productIds") ?? "").trim();
  let productIds: string[] = [];
  try {
    const parsed = JSON.parse(raw || "[]");
    if (Array.isArray(parsed)) productIds = parsed.map((x) => String(x || "")).filter(Boolean);
  } catch {
    return json({ ok: false, error: "Invalid productIds" }, { status: 400 });
  }
  productIds = Array.from(new Set(productIds));
  if (!productIds.length) return json({ ok: false, error: "No products selected" }, { status: 400 });
  return exportCsv(admin, productIds);
}

