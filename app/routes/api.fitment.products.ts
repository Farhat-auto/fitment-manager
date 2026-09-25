import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { getProductHandlesByVehicle, resolveShopDomain } from "../fitment/fitment.server";
import { unauthenticated } from "../shopify.server";

const QuerySchema = z.object({
  vehicle_key: z.string().min(1),
  vehicle_handle: z.string().optional(),
  subcategory_key: z.string().optional(),
});

const VEHICLE_PRODUCTS = `#graphql
  query VehicleProductRefs($handle: MetaobjectHandleInput!, $after: String) {
    metaobjectByHandle(handle: $handle) {
      id
      handle
      displayName
      engine: field(key: "engine_code") { value }
      powerKw: field(key: "power_kw") { value }
      powerHp: field(key: "power_hp") { value }
      referencedBy(first: 100, after: $after) {
        nodes {
          namespace
          key
          referencer {
            ... on Product {
              id
              handle
              title
              status
              vendor
              productType
              subcategory: metafield(namespace: "custom", key: "catalog_subcategory_key") { value }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

type LinkedProduct = {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  product_type: string;
  subcategory_key: string;
};

function responseHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const allowed = new Set([
    "https://www.oceancarparts.com",
    "https://oceancarparts.com",
    "https://g5uxzq-gb.myshopify.com",
  ]);
  return {
    ...(allowed.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    Vary: "Origin",
    "Cache-Control": "public, max-age=60",
  };
}

async function shopifyProducts(shopDomain: string, vehicleHandle: string): Promise<{
  vehicle: Record<string, string> | null;
  products: LinkedProduct[];
}> {
  const { admin } = await unauthenticated.admin(shopDomain);
  const products = new Map<string, LinkedProduct>();
  let after: string | null = null;
  let vehicle: Record<string, string> | null = null;

  for (let page = 0; page < 10; page += 1) {
    const response = await admin.graphql(VEHICLE_PRODUCTS, {
      variables: { handle: { type: "vehicle", handle: vehicleHandle }, after },
    });
    const body = await response.json();
    if (!response.ok || body.errors?.length) {
      throw new Error("Shopify vehicle fitment lookup failed");
    }
    const obj = body.data?.metaobjectByHandle;
    if (!obj) break;
    vehicle = {
      id: String(obj.id || ""),
      handle: String(obj.handle || ""),
      display_name: String(obj.displayName || ""),
      engine_code: String(obj.engine?.value || ""),
      power_kw: String(obj.powerKw?.value || ""),
      power_hp: String(obj.powerHp?.value || ""),
    };
    for (const ref of obj.referencedBy?.nodes || []) {
      if (ref.namespace !== "fitment" || ref.key !== "vehicles") continue;
      const product = ref.referencer;
      if (!product?.id || !product.handle || product.status !== "ACTIVE") continue;
      products.set(product.handle, {
        id: String(product.id),
        handle: String(product.handle),
        title: String(product.title || ""),
        vendor: String(product.vendor || ""),
        product_type: String(product.productType || ""),
        subcategory_key: String(product.subcategory?.value || ""),
      });
    }
    if (!obj.referencedBy?.pageInfo?.hasNextPage) break;
    after = obj.referencedBy.pageInfo.endCursor || null;
    if (!after) throw new Error("Incomplete Shopify vehicle fitment lookup");
    if (page === 9) throw new Error("Shopify vehicle fitment lookup exceeds page limit");
  }
  return { vehicle, products: [...products.values()] };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const headers = responseHeaders(request);
  try {
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop_domain") || url.searchParams.get("shop") || resolveShopDomain(request);
    if (!shopDomain || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopDomain)) {
      return json({ error: "Invalid shop_domain" }, { status: 400, headers });
    }
    const parsed = QuerySchema.safeParse({
      vehicle_key: url.searchParams.get("vehicle_key") || "",
      vehicle_handle: url.searchParams.get("vehicle_handle") || undefined,
      subcategory_key: url.searchParams.get("subcategory_key") || undefined,
    });
    if (!parsed.success) {
      return json({ error: "Invalid query" }, { status: 400, headers });
    }

    const { vehicle_key, vehicle_handle, subcategory_key } = parsed.data;
    const recordedHandles = await getProductHandlesByVehicle({
      shop_domain: shopDomain,
      vehicle_key,
      subcategory_key: subcategory_key || null,
    });
    const shopify = await shopifyProducts(shopDomain, vehicle_handle || vehicle_key);
    const matched = shopify.products.filter((product) =>
      !subcategory_key || product.subcategory_key === subcategory_key,
    );
    const handles = [...new Set([...recordedHandles, ...matched.map((product) => product.handle)])];

    return json({
      shop_domain: shopDomain,
      vehicle_key,
      subcategory_key: subcategory_key || null,
      vehicle: shopify.vehicle,
      products: matched,
      product_handles: handles,
      count: handles.length,
      source: "supabase_and_shopify_fitment_vehicles",
    }, { headers });
  } catch (error) {
    console.error("[api.fitment.products:error]", error);
    return json({ ok: false, error: "Vehicle fitment could not be loaded" }, { status: 502, headers });
  }
}
