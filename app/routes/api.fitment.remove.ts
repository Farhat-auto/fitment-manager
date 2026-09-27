/**
 * LEGACY isolated endpoint. Writes to Shopify vehicle metafields are disabled.
 * Historical fitment.vehicles data remains in Shopify untouched.
 */
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { rejectLegacyVehicleWrite } from "../ocean/legacy";

const BodySchema = z.object({
  productId: z.string().min(1),
  vehicleId: z.string().min(1),
});

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  await authenticate.admin(request);
  return json(rejectLegacyVehicleWrite("fitment.vehicles"), { status: 409 });
}
