import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
}

export default function Index() {
  const { shop } = useLoaderData<typeof loader>();
  return (
    <Page title="Fitment Manager">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              Connected shop: {shop}
            </Text>
            <Text as="p" variant="bodyMd">
              Go to <Link to="/app/products">Products</Link> to manage fitment.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

