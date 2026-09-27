import { Link, useLocation, useNavigate } from "@remix-run/react";
import { Page, Card, Text, BlockStack, Banner, Button, InlineStack } from "@shopify/polaris";
import { appHref } from "../embedded-nav";

export default function AppIndex() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = location.search || "";
  const to = (path: string) => appHref(path, search);

  return (
    <Page title="Fitment Manager">
      <BlockStack gap="400">
        <Banner title="Ocean is the fitment authority" tone="info">
          <p>
            This Remix app is the authenticated Shopify Admin frontend. Compatibility is stored as
            Ocean catalogue article → <code>product_fitment</code> → Ocean <code>ocean_vehicle_id</code>.
            Shopify is commerce only. Legacy Shopify vehicle tools are isolated below and are not
            the normal workflow.
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
              <Button variant="primary" onClick={() => navigate(to("/app/products"))}>
                Open products
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">LEGACY Shopify vehicle tools</Text>
            <Text as="p" variant="bodyMd">
              Import/export against historical Shopify vehicle metafields is isolated here for
              rollback/audit. Those tools are not in the normal navigation and do not write new
              compatibility. Use CAR FITMENT instead.
            </Text>
            <InlineStack>
              <Button onClick={() => navigate(to("/app/import"))}>Legacy import</Button>
              <Button onClick={() => navigate(to("/app/export"))}>Legacy export</Button>
              <Link to={to("/app/fitment-validation")} style={{ textDecoration: "none" }}>
                <Button>Legacy validation</Button>
              </Link>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Image Manager</Text>
            <InlineStack>
              <Button onClick={() => navigate(to("/app/images"))}>Open</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Settings</Text>
            <InlineStack>
              <Button onClick={() => navigate(to("/app/settings"))}>Open</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
