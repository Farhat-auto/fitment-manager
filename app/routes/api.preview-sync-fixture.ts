import { json, type ActionFunctionArgs } from "@remix-run/node";
import { catalogueOriginProblem } from "../ocean/catalogueOrigin.server.ts";
import { runPreviewFixture } from "../ocean/previewFixture.server.ts";

function previewEnabled() {
  return process.env.VERCEL_ENV === "preview" && Boolean(String(process.env.PREVIEW_FIXTURE_TOKEN || "").trim());
}

function tokensMatch(presented: string, expected: string) {
  if (!presented || !expected || presented.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

/** Preview-only sync fixture. Production returns 404. The adapter never calls Shopify. */
export async function action({ request }: ActionFunctionArgs) {
  if (!previewEnabled()) return json({ ok: false, error: "not_found" }, { status: 404 });
  const originProblem = catalogueOriginProblem();
  if (originProblem) {
    return json({ ok: false, error: "ocean_catalogue_url_missing", detail: originProblem, shopify_network_writes: 0 }, { status: 503 });
  }
  if (request.headers.get("x-preview-auth") === "expired") {
    return json({ ok: false, error: "expired_session", wrote: false, shopify_network_writes: 0 }, { status: 401 });
  }
  const header = request.headers.get("authorization") || "";
  const presented = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!tokensMatch(presented, String(process.env.PREVIEW_FIXTURE_TOKEN || ""))) {
    return json({ ok: false, error: "invalid_session", wrote: false, shopify_network_writes: 0 }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_event", wrote: false, shopify_network_writes: 0 }, { status: 400 });
  }
  const result = await runPreviewFixture(body);
  return json(result, { status: result.ok ? 200 : 400 });
}

export function loader() {
  return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
