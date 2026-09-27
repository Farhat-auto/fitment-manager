/**
 * LEGACY isolated endpoint.
 *
 * Do not load Shopify vehicle metafields/metaobjects here. Product display and
 * vehicle selection belong to Ocean CAR FITMENT at /app/products/:productId.
 * Historical fitment.vehicles data remains in Shopify untouched.
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";

const QuerySchema = z.object({
  productId: z.string().min(1),
});

function numericProductId(raw: string): string {
  const value = String(raw || "").trim();
  const match = value.match(/\/Product\/(\d+)(?:\D.*)?$/i) || value.match(/(\d+)$/);
  return match?.[1] ?? "";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const query = QuerySchema.safeParse({
    productId: url.searchParams.get("productId") ?? "",
  });
  if (!query.success) {
    return json({ error: "Missing or invalid productId" }, { status: 400 });
  }

  await authenticate.admin(request);
  const productId = query.data.productId;
  const numericId = numericProductId(productId);
  return json({
    productId,
    vehicles: [],
    authority: "ocean.product_fitment → ocean_vehicle_id",
    editor: numericId ? `/app/products/${numericId}` : "/app/products",
    legacy: true,
    message:
      "Shopify vehicle metafields are not loaded. Open Ocean CAR FITMENT to manage compatibility.",
  });
}
