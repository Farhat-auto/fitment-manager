import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getFitmentByProductHandle, resolveShopDomain } from "../fitment/fitment.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop_domain =
    url.searchParams.get("shop_domain") ||
    url.searchParams.get("shop") ||
    resolveShopDomain(request);
  if (!shop_domain) {
    return json({ error: "Missing shop_domain" }, { status: 400 });
  }

  const productHandle = params.productHandle;
  if (!productHandle) {
    return json({ error: "Missing productHandle" }, { status: 400 });
  }

  const rows = await getFitmentByProductHandle({
    shop_domain,
    product_handle: productHandle,
  });

  return json({
    shop_domain,
    product_handle: productHandle,
    rows,
    count: rows.length,
  });
}

