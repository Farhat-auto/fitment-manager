import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useLocation } from "@remix-run/react";
import { Banner, BlockStack, Card, IndexTable, InlineGrid, Page, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { oceanGet } from "../ocean/client.server";
import { appHref } from "../embedded-nav";

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const [coverage, quality] = await Promise.all([
    oceanGet("/catalogue-coverage"),
    oceanGet("/catalogue-quality"),
  ]);
  return json({
    error: coverage?.error || quality?.error || "",
    pending: num(coverage?.sync_pending),
    failed: num(coverage?.sync_failed),
    synced: num(coverage?.sync_synced),
    pendingRows: Array.isArray(quality?.stale_pending_sync_events) ? quality.stale_pending_sync_events : [],
    failedRows: Array.isArray(quality?.shopify_sync_failures) ? quality.shopify_sync_failures : [],
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
        <Text as="p" variant="headingLg">{value}</Text>
      </BlockStack>
    </Card>
  );
}

export default function SyncStatus() {
  const data = useLoaderData<typeof loader>();
  const location = useLocation();
  const review = (sku: string) => appHref("/app/catalogue-fitment-review", `sku=${encodeURIComponent(sku)}${location.search ? `&${location.search.replace(/^\?/, "")}` : ""}`);
  const failed = data.failedRows as Array<Record<string, unknown>>;
  const pending = data.pendingRows as Array<Record<string, unknown>>;
  return (
    <Page title="Sync status">
      <BlockStack gap="400">
        <Banner tone="info" title="Catalogue → Fitment Manager → Shopify">
          <p>
            A verified Ocean relationship enqueues a sync job. Fitment Manager is the only writer of
            ocean.verified_vehicle_keys, custom.fitment_keys, ocean.fitment_count, and ocean.fitment_status.
            Unverified candidates are not synced. This screen reports jobs; it does not create fitment.
          </p>
        </Banner>
        {data.error ? <Banner tone="warning"><p>{data.error}</p></Banner> : null}
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
          <Stat label="Pending" value={data.pending} />
          <Stat label="Failed" value={data.failed} />
          <Stat label="Synced" value={data.synced} />
        </InlineGrid>
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Pending jobs</Text>
            {pending.length ? (
              <IndexTable resourceName={{ singular: "job", plural: "jobs" }} itemCount={pending.length} selectable={false} headings={[{ title: "Job" }, { title: "SKU" }, { title: "Attempts" }, { title: "Created" }]}>
                {pending.map((row, index) => (
                  <IndexTable.Row id={String(row.id || index)} key={String(row.id || index)} position={index}>
                    <IndexTable.Cell>{String(row.id || "—")}</IndexTable.Cell>
                    <IndexTable.Cell>{row.product_sku ? <Link to={review(String(row.product_sku))}>{String(row.product_sku)}</Link> : "—"}</IndexTable.Cell>
                    <IndexTable.Cell>{String(row.attempts ?? "—")}</IndexTable.Cell>
                    <IndexTable.Cell>{String(row.created_at || "—")}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            ) : <Text as="p">No pending sync jobs.</Text>}
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Failed jobs</Text>
            {failed.length ? (
              <IndexTable resourceName={{ singular: "job", plural: "jobs" }} itemCount={failed.length} selectable={false} headings={[{ title: "Job" }, { title: "SKU" }, { title: "Attempts" }, { title: "Error" }]}>
                {failed.map((row, index) => (
                  <IndexTable.Row id={String(row.id || index)} key={String(row.id || index)} position={index}>
                    <IndexTable.Cell>{String(row.id || "—")}</IndexTable.Cell>
                    <IndexTable.Cell>{row.product_sku ? <Link to={review(String(row.product_sku))}>{String(row.product_sku)}</Link> : "—"}</IndexTable.Cell>
                    <IndexTable.Cell>{String(row.attempts ?? "—")}</IndexTable.Cell>
                    <IndexTable.Cell>{String(row.last_error || "—")}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            ) : <Text as="p">No failed sync jobs.</Text>}
            <Text as="p" tone="subdued">Retries stay on the existing Fitment Manager sync consumer. A failed Admin session is not rewritten from this page.</Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
