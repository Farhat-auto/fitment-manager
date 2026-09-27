import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { oceanGet, oceanPost } from "../ocean/client.server.ts";

const ACTIONS = new Set([
  "verify",
  "reject",
  "delete",
  "conflict",
  "needs_review",
  "bulk_verify_authoritative",
  "bulk_reject",
]);

function text(value: unknown) {
  return String(value ?? "").trim();
}

function statusFor(payload: { error?: string; ok?: boolean }) {
  if (payload?.error === "ocean_catalogue_url_missing") return 503;
  if (payload?.error) return 400;
  return payload?.ok === false ? 400 : 200;
}

/** Authenticated Shopify Admin proxy. Fitment Manager derives metafields later; this route never writes them. */
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const sku = text(new URL(request.url).searchParams.get("sku"));
  if (!sku) return json({ ok: false, error: "sku_required" }, { status: 400 });
  const review = await oceanGet("/fitment-review", new URLSearchParams({ sku }).toString());
  return json(review, { status: statusFor(review) });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const actionName = text(fd.get("action"));
  const sku = text(fd.get("sku"));
  const vehicle_key = text(fd.get("vehicle_key"));
  const reason = text(fd.get("reason"));
  if (!ACTIONS.has(actionName)) return json({ ok: false, error: "unsupported_action" }, { status: 400 });
  if (!sku && actionName !== "bulk_verify_authoritative") {
    return json({ ok: false, error: "sku_required" }, { status: 400 });
  }
  if (["verify", "reject", "delete", "conflict", "needs_review"].includes(actionName) && !/^ovh-[a-f0-9]+$/i.test(vehicle_key)) {
    return json({ ok: false, error: "canonical_vehicle_key_required" }, { status: 400 });
  }
  const actor = text((session as { email?: string; shop?: string }).email || session.shop || "shopify-admin");
  const review = await oceanPost("/fitment-review", { action: actionName, sku, vehicle_key, actor, reason });
  return json(review, { status: statusFor(review) });
}
