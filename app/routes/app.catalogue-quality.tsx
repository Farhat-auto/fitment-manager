import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useLocation } from "@remix-run/react";
import { BlockStack, Card, IndexTable, InlineGrid, Page, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { oceanGet } from "../ocean/client.server";
import { appHref } from "../embedded-nav";

const SAMPLE = 30;

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function list(value: unknown) {
  return Array.isArray(value) ? value.slice(0, SAMPLE) : [];
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const quality = await oceanGet("/catalogue-quality");
  const counts = quality?.counts || {};
  return json({
    error: quality?.error || "",
    note: quality?.evidence_note || "",
    total: num(counts.total_candidates),
    authoritative: num(counts.authoritative_candidates),
    manual: num(counts.manual_candidates),
    identity: num(counts.identity_only_candidates),
    verified: num(counts.verified),
    rejected: num(counts.rejected),
    conflicts: num(counts.conflicts),
    legacy: num(counts.legacy_keys),
    unknown: num(counts.unknown_canonical_keys),
    pending: num(counts.sync_pending),
    failed: num(counts.sync_failed),
    legacyRows: list(quality?.legacy_fitment_keys),
    unknownRows: list(quality?.unknown_canonical_keys),
    conflictRows: list(quality?.conflicts),
    pendingRows: list(quality?.stale_pending_sync_events),
    failedRows: list(quality?.shopify_sync_failures),
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

function Rows({ title, rows, review }: { title: string; rows: Array<Record<string, unknown>>; review: (sku: string) => string }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h2" variant="headingMd">{title}</Text>
        {rows.length ? (
          <IndexTable
            resourceName={{ singular: "row", plural: "rows" }}
            itemCount={rows.length}
            selectable={false}
            headings={[{ title: "SKU" }, { title: "Vehicle" }, { title: "Detail" }]}
          >
            {rows.map((row, index) => {
              const sku = String(row.product_sku || "");
              const detail = String(row.last_error || row.review_status || row.state || row.source || "");
              return (
                <IndexTable.Row id={String(row.id || sku || index)} key={String(row.id || index)} position={index}>
                  <IndexTable.Cell>{sku ? <Link to={review(sku)}>{sku}</Link> : "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{String(row.vehicle_key || "—")}</IndexTable.Cell>
                  <IndexTable.Cell>{detail || "—"}</IndexTable.Cell>
                </IndexTable.Row>
              );
            })}
          </IndexTable>
        ) : (
          <Text as="p">None.</Text>
        )}
      </BlockStack>
    </Card>
  );
}

export default function CatalogueQuality() {
  const data = useLoaderData<typeof loader>();
  const location = useLocation();
  const review = (sku: string) => appHref("/app/catalogue-fitment-review", `sku=${encodeURIComponent(sku)}${location.search ? `&${location.search.replace(/^\?/, "")}` : ""}`);
  return (
    <Page title="Catalogue Quality">
      <BlockStack gap="400">
        {data.error ? <Text as="p">{data.error}</Text> : null}
        {data.note ? <Text as="p" tone="subdued">{data.note}</Text> : null}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="300">
          <Stat label="Total candidates" value={data.total} />
          <Stat label="Authoritative candidates" value={data.authoritative} />
          <Stat label="Manual candidates" value={data.manual} />
          <Stat label="Identity-only candidates" value={data.identity} />
          <Stat label="Verified" value={data.verified} />
          <Stat label="Rejected" value={data.rejected} />
          <Stat label="Conflicts" value={data.conflicts} />
          <Stat label="Legacy vehicle keys" value={data.legacy} />
          <Stat label="Unknown vehicle keys" value={data.unknown} />
          <Stat label="Sync pending" value={data.pending} />
          <Stat label="Sync failed" value={data.failed} />
        </InlineGrid>
        <Rows title="Legacy vehicle keys" rows={data.legacyRows as Array<Record<string, unknown>>} review={review} />
        <Rows title="Unknown vehicle keys" rows={data.unknownRows as Array<Record<string, unknown>>} review={review} />
        <Rows title="Conflicts" rows={data.conflictRows as Array<Record<string, unknown>>} review={review} />
        <Text as="p" tone="subdued">Lists show the first {SAMPLE} rows. Open a SKU in Fitment Review. This report does not verify anything.</Text>
      </BlockStack>
    </Page>
  );
}
