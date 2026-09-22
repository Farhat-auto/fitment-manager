import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const marker = "/apps/fitment-manager-2/";
  const markerIndex = url.pathname.indexOf(marker);

  // Shopify Admin can proxy the embedded iframe path into the app URL as
  // /apps/fitment-manager-2/app/.... Normalize that external mount prefix
  // back to the real Remix route before normal app routing runs.
  if (markerIndex >= 0) {
    const nested = url.pathname.slice(markerIndex + marker.length).replace(/^\/+/, "");
    return redirect(`/${nested || "app"}${url.search}`);
  }

  return redirect(`/app${url.search}`);
}
