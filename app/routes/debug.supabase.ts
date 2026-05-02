import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { createClient } from "@supabase/supabase-js";

export async function loader(_args: LoaderFunctionArgs) {
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  const env = {
    SUPABASE_URL_exists: Boolean(supabaseUrl),
    SUPABASE_SERVICE_ROLE_KEY_startsWith_eyJ: serviceRoleKey.startsWith("eyJ"),
    SUPABASE_SERVICE_ROLE_KEY_length: serviceRoleKey.length,
  };

  try {
    if (!supabaseUrl || !serviceRoleKey) {
      return json(
        {
          ok: false,
          env,
          error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 500 },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from("shopify_sessions")
      .select("id")
      .limit(1);

    if (error) {
      return json(
        {
          ok: false,
          env,
          error: error.message,
        },
        { status: 500 },
      );
    }

    return json({ ok: true, env, sample: data ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, env, error: message }, { status: 500 });
  }
}

