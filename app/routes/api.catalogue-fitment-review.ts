import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

function catalogueOrigin(): string {
  return String(process.env.OCEAN_CATALOGUE_URL || "").trim().replace(/\/$/, "");
}

function reviewUrl(origin: string, sku: string): string {
  const u = new URL(origin + "/ocean-catalogue-manager/shopify-admin/fitment-review");
  u.searchParams.set("sku", sku);
  return u.toString();
}

async function catalogueJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({ ok: false, error: "invalid_catalogue_response" }));
  return json(body, { status: response.status });
}

/** Authenticated Shopify Admin proxy for Ocean catalogue fitment review. */
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const origin = catalogueOrigin();
  if (!origin) return json({ ok: false, error: "ocean_catalogue_url_missing" }, { status: 503 });

  const sku = String(new URL(request.url).searchParams.get("sku") || "").trim();
  if (!sku) return json({ ok: false, error: "sku_required" }, { status: 400 });

  return catalogueJson(reviewUrl(origin, sku), { method: "GET" });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const origin = catalogueOrigin();
  if (!origin) return json({ ok: false, error: "ocean_catalogue_url_missing" }, { status: 503 });

  const fd = await request.formData();
  const action = String(fd.get("action") || "").trim();
  const sku = String(fd.get("sku") || "").trim();
  const vehicle_key = String(fd.get("vehicle_key") || "").trim();
  const reason = String(fd.get("reason") || "").trim();

  if (!["verify", "reject", "delete", "bulk_verify_authoritative", "bulk_reject"].includes(action)) {
    return json({ ok: false, error: "unsupported_action" }, { status: 400 });
  }
  if (!sku && !["bulk_verify_authoritative"].includes(action)) {
    return json({ ok: false, error: "sku_required" }, { status: 400 });
  }
  if (["verify", "reject", "delete"].includes(action) && !/^ovh-[a-f0-9]+$/i.test(vehicle_key)) {
    return json({ ok: false, error: "canonical_vehicle_key_required" }, { status: 400 });
  }

  const actor = String((session as any)?.email || (session as any)?.shop || "shopify-admin").trim();
  return catalogueJson(origin + "/ocean-catalogue-manager/shopify-admin/fitment-review", {
    method: "POST",
    body: JSON.stringify({ action, sku, vehicle_key, actor, reason }),
  });
}
