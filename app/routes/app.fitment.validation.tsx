import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { appHref } from "../embedded-nav";

/**
 * Many people try /app/fitment/validation, which otherwise matches fitment/:productHandle
 * and returns 404 when no product handle is "validation". Send them to the real tool path.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const url = new URL(request.url);
  return redirect(appHref("/app/fitment-validation", url.search));
}

export default function FitmentValidationRedirect() {
  return null;
}
