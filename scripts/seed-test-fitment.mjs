import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const row = {
  shop_domain: "g5uxzq-gb.myshopify.com",
  product_handle: "vemo-v20-16-0004-electric-water-pump-for-engine-cooling",
  vehicle_key: "bmw-x6-e71-e72-xdrive35i-n54-n55-225-kw-306-hp-2979-cc-petrol-suv-01-2008-07-2014",
  vehicle_handle: "bmw-x6-e71-e72-xdrive35i-n54-n55-012008-072014-306-225-2979-cc",
  subcategory_key: "electric-water-pump",
  source: "test",
};

const { data, error } = await supabase
  .from("fitment")
  .upsert(row, {
    onConflict: "shop_domain,product_handle,vehicle_key,subcategory_key",
  })
  .select("id,shop_domain,product_handle,vehicle_key,subcategory_key,source,created_at,updated_at")
  .limit(1)
  .maybeSingle();

if (error) {
  console.error("[seed-test-fitment:error]", error);
  process.exitCode = 1;
} else {
  console.log("[seed-test-fitment:ok]", data);
}

