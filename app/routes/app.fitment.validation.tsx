import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Many people try /app/fitment/validation, which otherwise matches fitment/:productHandle
 * and returns 404 when no product handle is "validation". Send them to the real tool path.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const dest = `/app/fitment-validation${url.search}`;
  return redirect(dest);
}

export default function FitmentValidationRedirect() {
  return null;
}
