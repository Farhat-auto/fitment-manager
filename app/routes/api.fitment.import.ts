import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { FitmentRowInsertSchema, resolveShopDomain, upsertFitmentRows } from "../fitment/fitment.server";

const BodySchema = z.object({
  rows: z.array(FitmentRowInsertSchema).min(1),
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

  // Ensure shop_domain is consistent with request context.
  const rows = parsed.data.rows.map((r) => ({ ...r, shop_domain }));
  const inserted = await upsertFitmentRows(rows);

  return json({ ok: true, upserted: inserted.length });
}

