import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { Page, Card, BlockStack, Text, Banner, InlineStack, Button, InlineGrid } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { oceanConfigured, oceanGet } from "../ocean/client.server";
import { appHref } from "../embedded-nav";

function hostOf(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const coverage = await oceanGet("/catalogue-coverage");
  return json({
    configured: oceanConfigured() && !coverage?.error,
    detail: coverage?.error || "",
    host: hostOf(process.env.OCEAN_CATALOGUE_URL || ""),
    environment: process.env.VERCEL_ENV || "local",
    makes: Number(coverage?.makes) || 0,
    models: Number(coverage?.models) || 0,
    vehicles: Number(coverage?.engines) || 0,
    pending: Number(coverage?.sync_pending) || 0,
    failed: Number(coverage?.sync_failed) || 0,
    synced: Number(coverage?.sync_synced) || 0,
    verified: Number(coverage?.verified_relationships) || 0,
  });
}

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const to = (path: string) => appHref(path, location.search || "");

  return (
    <Page title="Settings" backAction={{ content: "Dashboard", onAction: () => navigate(to("/app")) }}>
      <BlockStack gap="400">
        <Banner tone="info" title="Current Ocean configuration">
          <p>
            Canonical Ocean vehicles and product_fitment are the authority. Shopify metafields are a
            cache written by Fitment Manager after a relationship is verified.
          </p>
        </Banner>
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Catalogue API connection</Text>
              <Text as="p">{data.configured ? "Connected" : "Not connected"}</Text>
              <Text as="p" tone="subdued">{data.host || "OCEAN_CATALOGUE_URL is not set"}</Text>
              {data.detail ? <Text as="p">{data.detail}</Text> : null}
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Catalogue environment</Text>
              <Text as="p">{data.environment}</Text>
              <Text as="p" tone="subdued">Staging catalogue data is not replaced from this screen.</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Canonical vehicle system</Text>
              <Text as="p">{data.makes} makes · {data.models} models · {data.vehicles} exact vehicles</Text>
              <Button onClick={() => navigate(to("/app/vehicle-catalogue"))}>Browse Vehicle Catalogue</Button>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Fitment Manager sync status</Text>
              <Text as="p">{data.verified} verified relationships</Text>
              <Text as="p">{data.pending} pending · {data.failed} failed · {data.synced} synced</Text>
              <Button onClick={() => navigate(to("/app/sync"))}>Open Sync Status</Button>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Shopify metafield sync</Text>
              <Text as="p">
                ocean.verified_vehicle_keys, custom.fitment_keys, ocean.fitment_count, and
                ocean.fitment_status are written only for verified canonical keys.
              </Text>
              <Text as="p" tone="subdued">Unverified candidates stay off the storefront.</Text>
            </BlockStack>
          </Card>
        </InlineGrid>
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Legacy / Migration</Text>
            <Text as="h3" variant="headingSm">Legacy Shopify fitment — read only</Text>
            <Text as="p">
              fitment.vehicles, custom.compatible_vehicles, and legacy vehicle metaobjects are retained
              only for migration and reference. They are not the current vehicle catalogue and they do
              not verify Ocean fitment.
            </Text>
            <InlineStack gap="200">
              <Button onClick={() => navigate(to("/app/import"))}>Legacy import</Button>
              <Button onClick={() => navigate(to("/app/export"))}>Legacy export</Button>
              <Button onClick={() => navigate(to("/app/images"))}>Images</Button>
              <Button onClick={() => navigate(to("/app/fitment-validation"))}>Legacy validation</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
