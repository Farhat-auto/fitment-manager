import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useLocation } from "@remix-run/react";
import { Banner, BlockStack, Card, IndexTable, InlineGrid, Page, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { oceanGet } from "../ocean/client.server";
import { appHref } from "../embedded-nav";

const SAMPLE = 200;

const BUCKETS: Record<string, { title: string; empty: string }> = {
  candidates: { title: "Total candidates", empty: "No candidate relationships." },
  authoritative: { title: "Authoritative candidates", empty: "No authoritative candidates. This queue is empty." },
  manual: { title: "Manual candidates", empty: "No manual candidates." },
  identity: { title: "Identity-only candidates", empty: "No identity-only candidates." },
  verified: { title: "Verified", empty: "No verified relationships." },
  rejected: { title: "Rejected", empty: "No rejected relationships." },
  conflicts: { title: "Conflicts", empty: "No conflicts." },
  legacy: { title: "Legacy vehicle keys", empty: "No legacy vehicle keys." },
  unknown: { title: "Unknown vehicle keys", empty: "No unknown vehicle keys." },
  needs_review: { title: "Needs review", empty: "No candidates without evidence." },
};

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function list(value: unknown) {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function tagged(value: unknown, bucket: string) {
  return list(value).map((row) => ({ ...row, bucket }));
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const bucket = new URL(request.url).searchParams.get("bucket") || "";
  const quality = await oceanGet("/catalogue-quality");
  const counts = quality?.counts || {};
  const authoritative = tagged(quality?.authoritative_candidates, "authoritative");
  const manual = tagged(quality?.manual_candidates, "manual");
  const identity = tagged(quality?.identity_only_candidates, "identity");
  const buckets: Record<string, Array<Record<string, unknown>>> = {
    candidates: [...authoritative, ...manual, ...identity],
    authoritative,
    manual,
    identity,
    verified: tagged(quality?.verified_relationships, "verified"),
    rejected: tagged(quality?.rejected_relationships, "rejected"),
    conflicts: tagged(quality?.conflicts, "conflicts"),
    legacy: tagged(quality?.legacy_fitment_keys, "legacy"),
    unknown: tagged(quality?.unknown_canonical_keys, "unknown"),
    needs_review: tagged(quality?.candidates_without_evidence, "needs_review"),
  };
  const active = buckets[bucket] || [];
  return json({
    bucket,
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
    activeRows: active.slice(0, SAMPLE),
    activeTotal: bucket && buckets[bucket] ? active.length : 0,
    legacyRows: list(quality?.legacy_fitment_keys).slice(0, 30),
    unknownRows: list(quality?.unknown_canonical_keys).slice(0, 30),
    conflictRows: list(quality?.conflicts).slice(0, 30),
  });
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link to={href} style={{ textDecoration: "none", color: "inherit" }}>
      <Card>
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
          <Text as="p" variant="headingLg">{value}</Text>
        </BlockStack>
      </Card>
    </Link>
  );
}

function Rows({ title, rows, review, empty = "None." }: { title: string; rows: Array<Record<string, unknown>>; review: (sku: string) => string; empty?: string }) {
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
          <Text as="p">{empty}</Text>
        )}
      </BlockStack>
    </Card>
  );
}

export default function CatalogueQuality() {
  const data = useLoaderData<typeof loader>();
  const location = useLocation();
  const params = new URLSearchParams(location.search.replace(/^\?/, ""));
  const href = (bucket: string) => {
    const next = new URLSearchParams(params);
    next.set("bucket", bucket);
    return appHref("/app/catalogue-quality", `?${next.toString()}`);
  };
  const syncHref = (status: string) => {
    const next = new URLSearchParams(params);
    next.delete("bucket");
    next.set("status", status);
    return appHref("/app/sync", `?${next.toString()}`);
  };
  const review = (sku: string) => appHref("/app/catalogue-fitment-review", `sku=${encodeURIComponent(sku)}${location.search ? `&${location.search.replace(/^\?/, "")}` : ""}`);
  const selected = BUCKETS[data.bucket];
  return (
    <Page title="Catalogue Quality">
      <BlockStack gap="400">
        {data.error ? <Text as="p">{data.error}</Text> : null}
        {data.note ? <Text as="p" tone="subdued">{data.note}</Text> : null}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="300">
          <Stat label="Total candidates" value={data.total} href={href("candidates")} />
          <Stat label="Authoritative candidates" value={data.authoritative} href={href("authoritative")} />
          <Stat label="Manual candidates" value={data.manual} href={href("manual")} />
          <Stat label="Identity-only candidates" value={data.identity} href={href("identity")} />
          <Stat label="Verified" value={data.verified} href={href("verified")} />
          <Stat label="Rejected" value={data.rejected} href={href("rejected")} />
          <Stat label="Conflicts" value={data.conflicts} href={href("conflicts")} />
          <Stat label="Legacy vehicle keys" value={data.legacy} href={href("legacy")} />
          <Stat label="Unknown vehicle keys" value={data.unknown} href={href("unknown")} />
          <Stat label="Sync pending" value={data.pending} href={syncHref("pending")} />
          <Stat label="Sync failed" value={data.failed} href={syncHref("failed")} />
        </InlineGrid>
        {selected ? (
          <BlockStack gap="200">
            <Banner tone="info" title={selected.title}>
              <p>
                {data.activeTotal} records. Showing {Math.min(data.activeTotal, SAMPLE)}. Legacy keys are not deleted or rewritten. This report does not verify anything.
              </p>
            </Banner>
            <Rows title={selected.title} rows={data.activeRows as Array<Record<string, unknown>>} review={review} empty={selected.empty} />
          </BlockStack>
        ) : (
          <>
            <Rows title="Legacy vehicle keys" rows={data.legacyRows as Array<Record<string, unknown>>} review={review} />
            <Rows title="Unknown vehicle keys" rows={data.unknownRows as Array<Record<string, unknown>>} review={review} />
            <Rows title="Conflicts" rows={data.conflictRows as Array<Record<string, unknown>>} review={review} />
          </>
        )}
        <Text as="p" tone="subdued">Open a SKU in Fitment Review. This report does not verify anything.</Text>
      </BlockStack>
    </Page>
  );
}
