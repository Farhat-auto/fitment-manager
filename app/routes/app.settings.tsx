import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { Page, Card, BlockStack, Text, Banner, InlineStack, Badge, Divider } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { appHref } from "../embedded-nav";
import { oceanConfigured } from "../ocean/client.server";
import { LEGACY_SHOPIFY_VEHICLE_SYSTEM } from "../ocean/legacy";

function oceanOrigin(): string {
  const raw = String(process.env.OCEAN_CATALOGUE_URL || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "configured";
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const configured = oceanConfigured();
  const origin = oceanOrigin();
  const tokenConfigured = Boolean(String(process.env.OCEAN_CATALOGUE_MANAGER_TOKEN || "").trim());
  const proxySecretConfigured = Boolean(String(process.env.OCEAN_CATALOGUE_PROXY_SECRET || "").trim());
  return json({
    configured,
    origin,
    tokenConfigured,
    proxySecretConfigured,
    vehicleIdentity: "ocean_vehicle_id",
    fitmentAuthority: "product_fitment",
    vehicleSource: "Ocean Catalogue API",
    technicalAuthority: "Ocean Catalogue / PostgreSQL",
    shopifyRole: "Commerce + compact fitment status only",
    compactStatus: LEGACY_SHOPIFY_VEHICLE_SYSTEM.metafieldsAllowed,
  });
}

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Page
      title="Settings"
      backAction={{
        content: "Back to Products",
        onAction: () => navigate(appHref("/app/products", location.search || "")),
      }}
    >
      <BlockStack gap="400">
        <Banner tone="info" title="Ocean Catalogue is the technical authority">
          <p>
            Vehicle identity and compatibility live in the independent Ocean technical catalogue.
            Shopify is the commerce client. It does not store or paginate a vehicle database.
          </p>
        </Banner>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Ocean Catalogue
            </Text>
            <BlockStack gap="150">
              <Text as="p" variant="bodyMd">
                Technical catalogue authority: <code>{data.technicalAuthority}</code>
              </Text>
              <Text as="p" variant="bodyMd">
                Vehicle identity: <code>{data.vehicleIdentity}</code>
              </Text>
              <Text as="p" variant="bodyMd">
                Fitment authority: <code>{data.fitmentAuthority}</code>
              </Text>
              <Text as="p" variant="bodyMd">
                Vehicle source: <code>{data.vehicleSource}</code>
              </Text>
              <Text as="p" variant="bodyMd">
                Shopify role: <code>{data.shopifyRole}</code>
              </Text>
            </BlockStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Connection / readiness
              </Text>
              <Badge tone={data.configured ? "success" : "attention"}>
                {data.configured ? "Ocean API configured" : "Ocean API not configured"}
              </Badge>
            </InlineStack>
            <Text as="p" variant="bodyMd">
              Catalogue origin: <code>{data.origin || "OCEAN_CATALOGUE_URL missing"}</code>
            </Text>
            <Text as="p" variant="bodyMd">
              Manager token: {data.tokenConfigured ? "present" : "missing"}
            </Text>
            <Text as="p" variant="bodyMd">
              Proxy secret: {data.proxySecretConfigured ? "present (optional)" : "not set (optional)"}
            </Text>
            <Divider />
            <Text as="p" variant="bodyMd">
              Compact Shopify status cache (commerce only):{" "}
              {data.compactStatus.map((key) => (
                <code key={key}>ocean.{key} </code>
              ))}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Product classification Category → System Group → Sub-category remains merchandising
              only. It is not vehicle identity.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Migration / reference only
            </Text>
            <Text as="p" variant="bodyMd">
              Historical Shopify compatibility fields are retained temporarily for rollback and
              audit. They are <strong>NOT active authority</strong> and are not Fitment Manager
              configuration.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Read-only leftovers: Shopify vehicle metaobjects and old compatibility metafields.
              Leftover <code>/app/fitment/:handle</code> bookmarks redirect to{" "}
              <code>/app/products/:productId</code>. The normal workflow does not read the
              Shopify vehicle index.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
