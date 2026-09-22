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
        <Banner tone="warning" title="LEGACY Shopify vehicle system">
          <p>
            <code>fitment.vehicles</code>, <code>custom.compatible_vehicles</code>, and vehicle metaobjects
            are retained read-only. New compatibility is Ocean <code>product_fitment</code> →{" "}
            <code>vehicle_id</code>. Status cache only: <code>ocean.fitment_count</code>,{" "}
            <code>ocean.fitment_status</code>, <code>ocean.zero_fitment</code>.
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

