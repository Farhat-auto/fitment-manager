import { createClient } from "@supabase/supabase-js";
import invariant from "tiny-invariant";

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  invariant(url, "Missing SUPABASE_URL");
  invariant(serviceRoleKey, "Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

