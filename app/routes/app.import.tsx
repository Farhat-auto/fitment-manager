import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { appHref } from "../embedded-nav";

// This path formerly wrote fitment.vehicles using Shopify vehicle metaobjects.
// Keep old navigation links usable without reopening the retired writer.
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return redirect(appHref("/app/application-import", new URL(request.url).search));
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);
  return json({ ok: false, error: "This legacy importer is retired. Use /app/application-import with the current application template." }, { status: 410 });
}

export default function ImportRedirect() { return null; }
