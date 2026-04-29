import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { getProductHandlesByVehicle, resolveShopDomain } from "../fitment/fitment.server";

const QuerySchema = z.object({
  vehicle_key: z.string().min(1),
  subcategory_key: z.string().min(1).optional(),
});

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    console.log("[fitment-api-config]", {
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
      hasServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    });

    const url = new URL(request.url);
    const shop_domain =
      url.searchParams.get("shop_domain") ||
      url.searchParams.get("shop") ||
      resolveShopDomain(request);
    if (!shop_domain) {
      return json({ error: "Missing shop_domain" }, { status: 400 });
    }

    const parsed = QuerySchema.safeParse({
      vehicle_key: url.searchParams.get("vehicle_key") ?? "",
      subcategory_key: url.searchParams.get("subcategory_key") ?? undefined,
    });

    if (!parsed.success) {
      return json({ error: "Invalid query", details: parsed.error.flatten() }, { status: 400 });
    }

    const handles = await getProductHandlesByVehicle({
      shop_domain,
      vehicle_key: parsed.data.vehicle_key,
      subcategory_key: parsed.data.subcategory_key ?? null,
    });

    return json({
      shop_domain,
      vehicle_key: parsed.data.vehicle_key,
      subcategory_key: parsed.data.subcategory_key ?? null,
      product_handles: handles,
      count: handles.length,
    });
  } catch (error) {
    console.error("[api.fitment.products:error]", error);
    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : JSON.stringify(error),
      },
      { status: 500 },
    );
  }
}

