/**
 * LEGACY Admin product block — pointer only.
 *
 * Do not read or write Shopify vehicle metafields/metaobjects here.
 * Forward CAR FITMENT is /app/products/:productId (Ocean product_fitment → ocean_vehicle_id).
 * Historical fitment.vehicles data is retained in Shopify for rollback/audit only.
 */
import React, { useMemo } from "react";
import { BlockStack, InlineStack, Link, Text } from "@shopify/ui-extensions-react/admin";
import { reactExtension, useApi } from "@shopify/ui-extensions-react/admin";

function extractNumericProductId(productGid: string): string {
  const value = String(productGid || "").trim();
  if (!value) return "";
  const match = value.match(/\/Product\/(\d+)(?:\D.*)?$/i) || value.match(/(\d+)$/);
  return match?.[1] ?? "";
}

export default reactExtension("admin.product-details.block.render", () => <FitmentBlock />);

function FitmentBlock() {
  const api = useApi();
  const productId = String((api as any)?.data?.product?.id ?? "").trim();
  const manageUrl = useMemo(() => {
    const numericId = extractNumericProductId(productId);
    return numericId ? `/app/products/${encodeURIComponent(numericId)}` : `/app/products`;
  }, [productId]);

  return (
    <BlockStack gap="base">
      <InlineStack blockAlign="center" inlineAlign="space-between" gap="base">
        <BlockStack gap="tight">
          <Text fontWeight="bold">Ocean CAR FITMENT</Text>
          <Text tone="subdued">
            Vehicle identity is ocean_vehicle_id in the Ocean Catalogue. Shopify does not store the
            vehicle database.
          </Text>
        </BlockStack>
        <Link to={manageUrl}>Open Fitment</Link>
      </InlineStack>
    </BlockStack>
  );
}
