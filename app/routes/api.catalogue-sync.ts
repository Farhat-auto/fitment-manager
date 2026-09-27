import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { assertCatalogueOrigin, authenticate } from "../shopify.server";
import { processCatalogueSyncEvent } from "../ocean/syncConsumer.ts";

/** Consumes a catalogue sync event with the installed offline Admin session. */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  try {
    assertCatalogueOrigin();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "ocean_catalogue_url_missing";
    return json({ ok: false, error: "ocean_catalogue_url_missing", detail, wrote: false }, { status: 503 });
  }
  let admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
  let session: { accessToken?: string; isOnline?: boolean; expires?: Date | string | null };
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch {
    return json({ ok: false, error: "expired_session", wrote: false }, { status: 401 });
  }
  let event: Record<string, unknown> = {};
  try {
    event = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_event", wrote: false }, { status: 400 });
  }
  const result = await processCatalogueSyncEvent(event, {
    session: {
      accessToken: session.accessToken,
      isOnline: session.isOnline,
      expires: session.expires ? String(session.expires) : null,
    },
    graphql: (query, options) => admin.graphql(query, options),
  });
  return json(result, { status: result.ok ? 200 : 400 });
}
