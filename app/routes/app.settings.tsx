import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { Page, Card, BlockStack, Text, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({ ok: true });
}

export default function SettingsPage() {
  useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const qs = location.search || "";

  return (
    <Page
      title="Settings"
      backAction={{
        content: "Back to Products",
        onAction: () => navigate(`/app/products${location.search || ""}`),
      }}
    >
      <BlockStack gap="400">
        <Banner tone="success" title="Fitment metafield ready">
          <p>
            The <code>fitment.vehicles</code> metafield is used to store compatible vehicle metaobject references.
          </p>
        </Banner>
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Metafield
            </Text>
            <Text as="p" variant="bodyMd">
              Namespace: <code>fitment</code>
              <br />
              Key: <code>vehicles</code>
              <br />
              Type: <code>list.metaobject_reference</code>
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

