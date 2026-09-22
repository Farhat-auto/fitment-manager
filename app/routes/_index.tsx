import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { inboundRemixPath } from "../embedded-nav";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  // Inbound only. Shopify may leak /apps/<handle> into the iframe request URL.
  // Canonicalize onto a Remix route. Outbound navigation must never generate
  // /apps/fitment-manager-2 (see app/embedded-nav.ts). Keep this until real
  // Admin iframe proof; do not stack extra prefixes here.
  return redirect(`${inboundRemixPath(url.pathname)}${url.search}`);
}
