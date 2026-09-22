import { Link, useLocation, useNavigate } from "@remix-run/react";
import { Page, Card, Text, BlockStack, Banner, Button, InlineStack } from "@shopify/polaris";

function embeddedPath(path: string, search: string) {
  const qs = new URLSearchParams(search);
  // Shopify Admin may mount the embedded app under /apps/<handle>. Internal
  // Remix navigation must stay relative to the app's /app route so that
  // Shopify's admin prefix is never sent to the Vercel Remix router.
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return `../${path.replace(/^\/+/, "")}${suffix}`;
}

export default function AppIndex() {
  const location = useLocation();
  const navigate = useNavigate();
  const to = (path: string) => embeddedPath(path, location.search || "");

  return (
    <Page title="Fitment Manager">
      <BlockStack gap="400">
        <Banner title="Ocean is the fitment authority" tone="info">
          <p>
            This Remix app is the authenticated Shopify Admin frontend. Compatibility is stored as
            Ocean catalogue article → <code>product_fitment</code> → Ocean <code>vehicle_id</code>.
            Supabase is session infrastructure only. Legacy Shopify vehicle metafields are read-only.
          </p>
        </Banner>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">CAR FITMENT</Text>
            <Text as="p" variant="bodyMd">
              Open a Shopify product and manage Make → Model → Generation → Engine → Ocean vehicle_id.
              Identity is Shopify product ID, variant ID, SKU, or Brand+MPN — never title.
            </Text>
            <InlineStack>
              <Button variant="primary" onClick={() => navigate(to("products"))}>
                Open products
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">LEGACY Shopify vehicle tools</Text>
            <Text as="p" variant="bodyMd">
              Import/export against <code>fitment.vehicles</code> is retained but no longer writes new
              compatibility. Use CAR FITMENT instead.
            </Text>
            <InlineStack>
              <Button onClick={() => navigate(to("import"))}>Legacy import</Button>
              <Button onClick={() => navigate(to("export"))}>Legacy export</Button>
              <Link to={to("fitment-validation")} style={{ textDecoration: "none" }}>
                <Button>Legacy validation</Button>
              </Link>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Image Manager</Text>
            <InlineStack>
              <Button onClick={() => navigate(to("images"))}>Open</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Settings</Text>
            <InlineStack>
              <Button onClick={() => navigate(to("settings"))}>Open</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
