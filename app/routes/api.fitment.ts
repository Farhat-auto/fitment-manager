import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";

const QuerySchema = z.object({
  productId: z.string().min(1),
});

const VehicleSchema = z.object({
  id: z.string().min(1),
  handle: z.string().optional().default(""),
  vehicle_key: z.string().optional().default(""),
  display_name: z.string().optional().default(""),
});

const GET_FITMENT_METAFIELD = `#graphql
  query GetFitmentVehicles($id: ID!) {
    product(id: $id) {
      id
      metafield(namespace: "fitment", key: "vehicles") {
        id
        jsonValue
      }
    }
  }
`;

function parseVehicles(raw: unknown) {
  if (!Array.isArray(raw)) return [];

  const vehicles: Array<z.infer<typeof VehicleSchema>> = [];
  for (const item of raw) {
    const safe = VehicleSchema.safeParse(item);
    if (safe.success) vehicles.push(safe.data);
  }
  return vehicles;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const query = QuerySchema.safeParse({
    productId: url.searchParams.get("productId") ?? "",
  });
  if (!query.success) {
    return json({ error: "Missing or invalid productId" }, { status: 400 });
  }

  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(GET_FITMENT_METAFIELD, {
    variables: { id: query.data.productId },
  });
  const gql = await response.json();

  const product = gql?.data?.product;
  if (!product?.id) {
    return json({ error: "Product not found" }, { status: 404 });
  }

  const vehicles = parseVehicles(product?.metafield?.jsonValue);
  return json({
    productId: String(product.id),
    vehicles,
  });
}
