import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { resolveShopDomain } from "../fitment/fitment.server";

const BodySchema = z.object({
  productHandle: z.string().min(1),
  dryRun: z.boolean().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const url = new URL(request.url);
  const shop_domain =
    url.searchParams.get("shop_domain") ||
    url.searchParams.get("shop") ||
    resolveShopDomain(request);
  if (!shop_domain) {
    return json({ error: "Missing shop_domain" }, { status: 400 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  return json(
    {
      error: "Shopify sync is not available on public API routes.",
      hint: "Use the embedded admin UI fitment editor Sync button instead.",
    },
    { status: 400 },
  );
}

