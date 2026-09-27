import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";

function previewFixtureOrigin() {
  return process.env.VERCEL_ENV === "preview";
}

/** Read-only catalogue fixture. Only the preview deployment answers; writes stay disabled. */
export async function loader({ params }: LoaderFunctionArgs) {
  if (!previewFixtureOrigin()) return json({ ok: false, error: "not_found" }, { status: 404 });
  return json({
    ok: true,
    origin: "preview-fixture",
    production: false,
    path: String(params["*"] || ""),
    makes: [],
    fitments: [],
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (!previewFixtureOrigin()) return json({ ok: false, error: "not_found" }, { status: 404 });
  return json(
    { ok: false, error: "catalogue_writes_disabled", method: request.method, shopify_network_writes: 0 },
    { status: 403 },
  );
}
