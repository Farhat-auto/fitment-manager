import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";

const BodySchema = z.object({
  productId: z.string().min(1),
  vehicleId: z.string().min(1),
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

const SET_FITMENT_METAFIELD = `#graphql
  mutation SetFitment($input: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $input) {
      userErrors {
        field
        message
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

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const { productId, vehicleId } = parsed.data;
  const { admin } = await authenticate.admin(request);

  const readResponse = await admin.graphql(GET_FITMENT_METAFIELD, {
    variables: { id: productId },
  });
  const readData = await readResponse.json();
  const product = readData?.data?.product;
  if (!product?.id) {
    return json({ error: "Product not found" }, { status: 404 });
  }

  const currentVehicles = parseVehicles(product?.metafield?.jsonValue);
  const vehicles = currentVehicles.filter((v) => String(v.id) !== String(vehicleId));

  const writeResponse = await admin.graphql(SET_FITMENT_METAFIELD, {
    variables: {
      input: [
        {
          ownerId: String(product.id),
          namespace: "fitment",
          key: "vehicles",
          type: "json",
          value: JSON.stringify(vehicles),
        },
      ],
    },
  });
  const writeData = await writeResponse.json();
  const userErrors = writeData?.data?.metafieldsSet?.userErrors ?? [];
  if (Array.isArray(userErrors) && userErrors.length > 0) {
    return json({ ok: false, userErrors }, { status: 400 });
  }

  return json({
    ok: true,
    productId: String(product.id),
    vehicles,
  });
}
