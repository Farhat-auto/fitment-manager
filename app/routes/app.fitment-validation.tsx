import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import * as React from "react";
import { Page, Card, BlockStack, TextField, Button, Banner, Text, InlineStack, IndexTable, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { resolveShopDomain } from "../fitment/fitment.server";
import { countProductFitmentRows } from "../fitment/fitmentKeys.server";

function norm(v: unknown): string {
  return String(v ?? "").trim();
}

function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

const GET_PRODUCT_FITMENT_COUNTS = `#graphql
  query ProductFitmentCounts($handle: String!) {
    productByHandle(handle: $handle) {
      id
      title
      handle
      mf_fitment: metafield(namespace: "fitment", key: "vehicles") {
        type
        value
      }
      mf_compat: metafield(namespace: "custom", key: "compatible_vehicles") {
        type
        value
      }
      mf_keys: metafield(namespace: "custom", key: "fitment_keys") {
        type
        value
      }
    }
  }
`;

function countJsonArrayString(raw: unknown): number {
  const s = norm(raw);
  if (!s) return 0;
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop_domain = norm((session as any)?.shop) || resolveShopDomain(request) || "";
  if (!shop_domain) return json({ ok: false, error: "Missing shop_domain" }, { status: 400 });

  const fd = await request.formData();
  const handlesRaw = norm(fd.get("handles"));
  const handles = Array.from(
    new Set(
      handlesRaw
        .split(/[\n\r,]+/g)
        .map((h) => norm(h))
        .filter(Boolean),
    ),
  ).slice(0, 50);

  if (!handles.length) return json({ ok: false, error: "Enter at least one product handle" }, { status: 400 });

  const rows: any[] = [];
  for (const handle of handles) {
    const resp = await admin.graphql(GET_PRODUCT_FITMENT_COUNTS, { variables: { handle } });
    const gql = await resp.json();
    const p = gql?.data?.productByHandle;
    if (!p?.id) {
      rows.push({ handle, error: "Not found" });
      continue;
    }

    const product_id = norm(p.id);
    let supabaseCount = 0;
    try {
      supabaseCount = await countProductFitmentRows({ shop_domain, product_id });
    } catch (e) {
      rows.push({ handle, product_id, title: norm(p.title), error: `Supabase error: ${String((e as any)?.message ?? e)}` });
      continue;
    }

    rows.push({
      handle,
      product_id,
      title: norm(p.title),
      supabase_vehicle_count: supabaseCount,
      fitment_keys_count: countJsonArrayString(p?.mf_keys?.value),
      fitment_vehicles_gid_count: countJsonArrayString(p?.mf_fitment?.value),
      compatible_vehicles_gid_count: countJsonArrayString(p?.mf_compat?.value),
    });
  }

  return json({ ok: true, rows });
}

export default function FitmentValidation() {
  const fetcher = useFetcher<typeof action>();
  const [handles, setHandles] = React.useState("");

  const busy = fetcher.state !== "idle";
  const data: any = fetcher.data;
  const rows = safeArray<any>(data?.rows);

  return (
    <Page title="Fitment validation (Phase 1)">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" tone="subdued">
              Enter up to 50 product handles (comma/newline separated). This compares Supabase `product_fitment` vs Shopify metafields.
            </Text>
            <TextField
              label="Product handles"
              value={handles}
              onChange={setHandles}
              multiline={4}
              autoComplete="off"
              placeholder="example-product-handle-1\nexample-product-handle-2"
            />
            <InlineStack gap="200">
              <Button
                variant="primary"
                loading={busy}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("handles", handles);
                  fetcher.submit(fd, { method: "post" });
                }}
              >
                Validate
              </Button>
            </InlineStack>
            {data?.ok === false && (
              <Banner tone="critical">
                <p>{String(data?.error || "Validation failed")}</p>
              </Banner>
            )}
          </BlockStack>
        </Card>

        {rows.length > 0 && (
          <Card>
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={rows.length}
              headings={[
                { title: "Handle" },
                { title: "Shopify product ID" },
                { title: "Supabase count" },
                { title: "custom.fitment_keys" },
                { title: "fitment.vehicles" },
                { title: "custom.compatible_vehicles" },
                { title: "Status" },
              ]}
              selectable={false}
            >
              {rows.map((r: any, idx: number) => {
                const err = norm(r?.error);
                const ok =
                  !err &&
                  Number(r?.supabase_vehicle_count ?? 0) === Number(r?.fitment_keys_count ?? 0) &&
                  Number(r?.supabase_vehicle_count ?? 0) > 0;
                return (
                  <IndexTable.Row id={String(r?.product_id || r?.handle || idx)} key={String(r?.product_id || r?.handle || idx)} position={idx}>
                    <IndexTable.Cell>
                      <BlockStack gap="050">
                        <Text as="p" variant="bodySm">
                          {String(r?.handle || "")}
                        </Text>
                        {r?.title ? (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {String(r.title)}
                          </Text>
                        ) : null}
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{String(r?.product_id || "—")}</IndexTable.Cell>
                    <IndexTable.Cell>{String(r?.supabase_vehicle_count ?? "—")}</IndexTable.Cell>
                    <IndexTable.Cell>{String(r?.fitment_keys_count ?? "—")}</IndexTable.Cell>
                    <IndexTable.Cell>{String(r?.fitment_vehicles_gid_count ?? "—")}</IndexTable.Cell>
                    <IndexTable.Cell>{String(r?.compatible_vehicles_gid_count ?? "—")}</IndexTable.Cell>
                    <IndexTable.Cell>
                      {err ? <Badge tone="critical">Error</Badge> : ok ? <Badge tone="success">OK</Badge> : <Badge tone="attention">Mismatch</Badge>}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>
            {rows.some((r: any) => norm(r?.error)) ? (
              <Banner tone="warning">
                <p>Some rows failed to validate. Fix the errors then re-run.</p>
              </Banner>
            ) : null}
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}

