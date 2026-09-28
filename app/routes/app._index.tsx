import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { Page, Card, Text, BlockStack, Banner, Button, InlineStack, InlineGrid } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { oceanConfigured, oceanGet } from "../ocean/client.server";
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
  const counts = (quality && quality.counts) || {};
  return json({
    configured: oceanConfigured(),
    error: coverage?.error || quality?.error || "",
    products: num(coverage?.products),
    makes: num(coverage?.makes),
    models: num(coverage?.models),
    vehicles: num(coverage?.engines),
    candidates: num(coverage?.candidate_relationships ?? counts.total_candidates),
    verified: num(coverage?.verified_relationships ?? counts.verified),
    needsReview: num(counts.candidates_without_evidence),
    conflicts: num(coverage?.conflict_relationships ?? counts.conflicts),
    legacy: num(counts.legacy_keys ?? counts.legacy_fitment_keys),
    pendingSync: num(coverage?.sync_pending ?? counts.sync_pending),
    failedSync: num(coverage?.sync_failed ?? counts.sync_failed),
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

export default function AppIndex() {
  const data = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const search = location.search || "";
  const to = (path: string) => appHref(path, search);

  return (
    <Page title="Dashboard">
      <BlockStack gap="400">
        <Banner title="Ocean catalogue is the fitment authority" tone="info">
          <p>
            Compatibility is Ocean article → product_fitment → canonical vehicle key. Verify a
            relationship only from an authoritative application record.
          </p>
        </Banner>
        {!data.configured || data.error ? (
          <Banner tone="warning" title="Catalogue connection">
            <p>{data.error || "OCEAN_CATALOGUE_URL is not set. Counts stay at zero until the catalogue API is configured."}</p>
          </Banner>
        ) : null}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="300">
          <Stat label="Products" value={data.products} />
          <Stat label="Vehicle makes" value={data.makes} />
          <Stat label="Models" value={data.models} />
          <Stat label="Exact vehicles" value={data.vehicles} />
          <Stat label="Fitment candidates" value={data.candidates} />
          <Stat label="Verified fitments" value={data.verified} />
          <Stat label="Needs review" value={data.needsReview} />
          <Stat label="Conflicts" value={data.conflicts} />
          <Stat label="Legacy relationships" value={data.legacy} />
          <Stat label="Pending sync" value={data.pendingSync} />
          <Stat label="Failed sync" value={data.failedSync} />
        </InlineGrid>
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Quick actions</Text>
            <InlineStack gap="200">
              <Button variant="primary" onClick={() => navigate(to("/app/catalogue-fitment-review"))}>Review Fitments</Button>
              <Button onClick={() => navigate(to("/app/vehicle-catalogue"))}>Browse Vehicle Catalogue</Button>
              <Button onClick={() => navigate(to("/app/application-import"))}>Import Application Data</Button>
              <Button onClick={() => navigate(to("/app/catalogue-quality"))}>Catalogue Quality</Button>
              <Button onClick={() => navigate(to("/app/sync"))}>Sync Status</Button>
            </InlineStack>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Catalogue tools</Text>
            <Text as="p" variant="bodyMd">
              Products open the Ocean article. Legacy Shopify import, export, and images stay available
              for migration and are not the fitment authority.
            </Text>
            <InlineStack gap="200">
              <Button onClick={() => navigate(to("/app/products"))}>Products</Button>
              <Button onClick={() => navigate(to("/app/import"))}>Legacy import</Button>
              <Button onClick={() => navigate(to("/app/export"))}>Legacy export</Button>
              <Button onClick={() => navigate(to("/app/images"))}>Images</Button>
              <Button onClick={() => navigate(to("/app/settings"))}>Settings</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
