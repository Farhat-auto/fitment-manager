import { Link, useLocation, useNavigate } from "@remix-run/react";
import { Page, Card, Text, BlockStack, Banner, Button, InlineStack } from "@shopify/polaris";

export default function AppIndex() {
  const location = useLocation();
  const navigate = useNavigate();
  const qs = location.search || "";
  return (
    <Page title="Fitment Manager">
      <BlockStack gap="400">
        <Banner title="Fitment metafield ready" tone="success">
          <p>The <code>fitment.vehicles</code> metafield definition is configured and ready to use.</p>
        </Banner>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Manage Product Fitment</Text>
            <Text as="p" variant="bodyMd">
              Select a product and link it to compatible vehicle metaobjects.
            </Text>
            <InlineStack>
              <Button variant="primary" onClick={() => navigate(`/app/products${qs}`)}>
                Open
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Bulk Import CSV</Text>
            <Text as="p" variant="bodyMd">
              Upload a CSV file to link multiple products to vehicles at once.
            </Text>
            <InlineStack>
              <Button variant="primary" onClick={() => navigate(`/app/import${qs}`)}>
                Open
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Export CSV</Text>
            <Text as="p" variant="bodyMd">
              Export current product fitment to CSV (product + linked vehicles).
            </Text>
            <InlineStack>
              <Button variant="primary" onClick={() => navigate(`/app/export${qs}`)}>
                Open
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Fitment Validation</Text>
            <Text as="p" variant="bodyMd">
              Validate Supabase vs Shopify fitment data.
            </Text>
            <InlineStack>
              <Link to={`/app/fitment-validation${qs}`} style={{ textDecoration: "none" }}>
                <Button variant="primary">Open</Button>
              </Link>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Image Manager</Text>
            <Text as="p" variant="bodyMd">
              Search products, view images, and update image alt text.
            </Text>
            <InlineStack>
              <Button variant="primary" onClick={() => navigate(`/app/images${qs}`)}>
                Open
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Settings</Text>
            <Text as="p" variant="bodyMd">
              View metafield configuration and vehicle metaobject details.
            </Text>
            <InlineStack>
              <Button variant="primary" onClick={() => navigate(`/app/settings${qs}`)}>
                Open
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

