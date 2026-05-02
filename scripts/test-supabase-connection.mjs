/**
 * Safe connectivity check for Supabase REST + `@supabase/supabase-js`.
 *
 * Prints key fingerprints only (length, prefix12, suffix8). Never prints the full key.
 * Confirms PostgREST receives `apikey` and `Authorization: Bearer <same key>`.
 *
 * Usage (from fitment-manager):
 *   npm run test:supabase
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (after `.env` + `.env.local` load).
 */

import { createClient } from "@supabase/supabase-js";
import {
  assertSupabaseServiceEnvForSessions,
  decodeSupabaseKeyPayload,
  describeSupabaseEnvFileLayout,
  extractSupabaseProjectRefFromUrl,
  getProjectRoot,
  loadDotenvFiles,
  logSupabaseKeyDiagnostics,
  sanitizeSupabaseServiceRoleKey,
  trimEnvQuotes,
} from "./shopify-admin-env.mjs";

const projectRoot = getProjectRoot(import.meta.url);
loadDotenvFiles(projectRoot);

const url = trimEnvQuotes(process.env.SUPABASE_URL);
const serviceKey = sanitizeSupabaseServiceRoleKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
const table = process.env.SHOPIFY_SESSIONS_TABLE?.trim() || "shopify_sessions";

console.info("[test:supabase] Env file layout (values not shown):", describeSupabaseEnvFileLayout(projectRoot));

if (!url || !serviceKey) {
  console.error("[test:supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY after loading .env / .env.local.");
  process.exit(1);
}

logSupabaseKeyDiagnostics(projectRoot, url, serviceKey);

try {
  assertSupabaseServiceEnvForSessions(url, serviceKey);
} catch (e) {
  console.error("[test:supabase]", e instanceof Error ? e.message : String(e));
  process.exit(1);
}

const jwt = decodeSupabaseKeyPayload(serviceKey);
const urlRef = extractSupabaseProjectRefFromUrl(url);
console.info("[test:supabase] JWT vs URL:", {
  jwt_role: jwt.ok ? jwt.role : "(decode failed)",
  jwt_ref: jwt.ok ? jwt.ref : "",
  project_ref_from_url: urlRef || "(unparsed)",
});

const base = url.replace(/\/+$/, "");

async function restFetchWithExplicitHeaders() {
  const restUrl = `${base}/rest/v1/${encodeURIComponent(table)}?select=id&limit=1`;
  const res = await fetch(restUrl, {
    method: "GET",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
  });
  const bodyText = await res.text();
  let preview = bodyText;
  if (preview.length > 800) preview = `${preview.slice(0, 800)}…`;
  console.info("[test:supabase] Raw fetch (explicit apikey + Authorization Bearer):", {
    url: restUrl,
    status: res.status,
    ok: res.ok,
    body_preview: preview,
  });
  return res.ok;
}

async function supabaseJsSelect() {
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const r = await supabase.from(table).select("id").limit(1);
  if (r.error) {
    console.error("[test:supabase] @supabase/supabase-js error:", {
      message: r.error.message,
      code: r.error.code,
      details: r.error.details,
      hint: r.error.hint,
    });
    return false;
  }
  console.info("[test:supabase] @supabase/supabase-js select ok:", { rowCount: Array.isArray(r.data) ? r.data.length : 0 });
  return true;
}

const okFetch = await restFetchWithExplicitHeaders();
const okJs = await supabaseJsSelect();

console.info("[test:supabase] Summary:", {
  explicit_fetch_ok: okFetch,
  supabase_js_ok: okJs,
});

process.exit(okFetch && okJs ? 0 : 1);
