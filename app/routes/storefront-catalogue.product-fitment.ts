import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  getFitmentByProductHandle,
  getProductHandlesByVehicle,
  resolveShopDomain,
} from "../fitment/fitment.server";

function cors(payload: unknown, status = 200) {
  return json(payload, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop_domain =
    url.searchParams.get("shop_domain") ||
    url.searchParams.get("shop") ||
    resolveShopDomain(request);
  if (!shop_domain) return cors({ ok: false, error: "Missing shop_domain" }, 400);

  const vehicle_key = url.searchParams.get("vehicle_key") || "";
  const product_handle = url.searchParams.get("product_handle") || url.searchParams.get("handle") || "";

  if (product_handle) {
    const rows = await getFitmentByProductHandle({ shop_domain, product_handle });
    return cors({ ok: true, shop_domain, product_handle, rows, count: rows.length });
  }

  if (!vehicle_key) return cors({ ok: false, error: "Missing vehicle_key" }, 400);

  const product_handles = await getProductHandlesByVehicle({
    shop_domain,
    vehicle_key,
    subcategory_key: url.searchParams.get("subcategory_key") || null,
  });

  return cors({
    ok: true,
    shop_domain,
    vehicle_key,
    product_handles,
    handles: product_handles,
    products: product_handles.map((handle) => ({ handle })),
    count: product_handles.length,
  });
}
