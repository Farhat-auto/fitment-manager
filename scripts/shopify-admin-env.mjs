import { Session } from "@shopify/shopify-api";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Package root (`fitment-manager/`), one level above `scripts/`. */
export function getProjectRoot(importMetaUrl) {
  const __dirname = path.dirname(fileURLToPath(importMetaUrl));
  return path.resolve(__dirname, "..");
}

/** Load `.env` then `.env.local` (override) from the package root. */
export function loadDotenvFiles(projectRoot) {
  loadEnv({ path: path.join(projectRoot, ".env") });
  loadEnv({ path: path.join(projectRoot, ".env.local"), override: true });
}

function readOptionalAdminTokenFile(rootDir) {
  const p = path.join(rootDir, ".shopify-admin-token");
  try {
    if (!fs.existsSync(p)) return "";
    const raw = fs.readFileSync(p, "utf8");
    const line = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#"));
    return line ? line.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Returns Admin token from env / file only (no Supabase). Empty string if unset.
 */
export function getShopifyAdminTokenFromEnvOrFile(projectRoot) {
  const primary = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
  const fallback = process.env.SHOPIFY_ACCESS_TOKEN?.trim();
  const fromFile = readOptionalAdminTokenFile(projectRoot);
  return primary || fallback || fromFile || "";
}

export function assertNotClientSecretToken(token) {
  if (/^shpss_/i.test(token)) {
    throw new Error(
      "Shopify Admin token looks like a client secret (shpss_*). Use an Admin API access token (shpat_*) or an offline session token from Supabase.",
    );
  }
}

/**
 * Synchronous resolver (env / file only). Throws if missing.
 * For embedded apps, prefer {@link resolveShopifyAdminAccessTokenAsync}.
 */
export function resolveShopifyAdminAccessToken(projectRoot) {
  const token = getShopifyAdminTokenFromEnvOrFile(projectRoot);
  if (!token) {
    throw new Error(
      [
        "No Shopify Admin API access token found (env / file).",
        "",
        "Set SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_… or use resolveShopifyAdminAccessTokenAsync() to load the offline session from Supabase.",
      ].join("\n"),
    );
  }
  assertNotClientSecretToken(token);
  return token;
}

/** Normalize shop hostname for session rows (`*.myshopify.com`, lowercase). */
export function normalizeShopDomainForSession(input) {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/\/.*$/, "");
  return s.replace(/\/+$/, "");
}

/** Extract project ref from `https://<ref>.supabase.co` */
export function extractSupabaseProjectRefFromUrl(urlStr) {
  let u = String(urlStr ?? "").trim();
  if (!u) return "";
  try {
    const host = new URL(u.startsWith("http") ? u : `https://${u}`).hostname;
    const m = /^([a-z0-9]+)\.supabase\.co$/i.exec(host);
    return m ? String(m[1]).toLowerCase() : "";
  } catch {
    return "";
  }
}

/**
 * Decode Supabase JWT key payload (anon / service_role). Does not log the key.
 */
export function decodeSupabaseKeyPayload(serviceKey) {
  const s = String(serviceKey ?? "").trim();
  const parts = s.split(".");
  if (parts.length !== 3) return { ok: false, reason: "not_a_jwt" };
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json);
    const role = typeof payload.role === "string" ? payload.role : "";
    const ref = typeof payload.ref === "string" ? payload.ref.toLowerCase() : "";
    return { ok: true, role, ref };
  } catch {
    return { ok: false, reason: "jwt_parse_failed" };
  }
}

export function trimEnvQuotes(v) {
  let s = String(v ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Removes accidental whitespace/newlines/extra text around the JWT. Does not print the key.
 */
export function sanitizeSupabaseServiceRoleKey(raw) {
  let s = trimEnvQuotes(raw);
  s = s.replace(/\s+/g, "");
  const line = s.split(/[\r\n]/)[0] ?? s;
  return String(line).trim();
}

/**
 * Safe key metadata for logs (never log full secret).
 * @param {string} key
 */
export function safeServiceKeyFingerprint(key) {
  const s = String(key ?? "").trim();
  const len = s.length;
  if (!len) {
    return { length: 0, prefix12: "(empty)", suffix8: "(empty)" };
  }
  return {
    length: len,
    prefix12: len >= 12 ? s.slice(0, 12) : s,
    suffix8: len >= 8 ? s.slice(-8) : s,
  };
}

/**
 * Whether `.env` / `.env.local` contain Supabase key lines (values not read).
 * `.shopify-admin-token` is Shopify-only; does not override Supabase.
 */
export function describeSupabaseEnvFileLayout(projectRoot) {
  const envPath = path.join(projectRoot, ".env");
  const localPath = path.join(projectRoot, ".env.local");
  const shopifyTokenPath = path.join(projectRoot, ".shopify-admin-token");

  const scan = (p) => {
    if (!fs.existsSync(p)) {
      return { exists: false, setsUrl: false, setsServiceKey: false };
    }
    const t = fs.readFileSync(p, "utf8");
    return {
      exists: true,
      setsUrl: /^\s*SUPABASE_URL\s*=/m.test(t),
      setsServiceKey: /^\s*SUPABASE_SERVICE_ROLE_KEY\s*=/m.test(t),
    };
  };

  return {
    loadOrder: "dotenv loads .env then .env.local (values in .env.local override .env for same keys).",
    envFile: scan(envPath),
    envLocalFile: scan(localPath),
    shopifyAdminTokenFile: {
      exists: fs.existsSync(shopifyTokenPath),
      note: "Used only for SHOPIFY_ADMIN_ACCESS_TOKEN fallback — does not change Supabase env.",
    },
  };
}

/** Logs safe fingerprints only; never prints the full key. */
export function logSupabaseKeyDiagnostics(projectRoot, supabaseUrl, serviceKey) {
  const files = describeSupabaseEnvFileLayout(projectRoot);
  const fp = safeServiceKeyFingerprint(serviceKey);
  console.info("[shopify-admin-env] Supabase key load debug:", {
    supabase_url: supabaseUrl,
    service_key_length: fp.length,
    service_key_prefix12: fp.prefix12,
    service_key_suffix8: fp.suffix8,
    envFiles: files,
  });
}
/**
 * Validates URL + service_role JWT match; throws helpful errors (never prints the key).
 */
export function assertSupabaseServiceEnvForSessions(urlRaw, serviceKeyRaw) {
  const url = trimEnvQuotes(urlRaw);
  const serviceKey = sanitizeSupabaseServiceRoleKey(serviceKeyRaw);
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set to load shopify_sessions.");
  }

  const urlRef = extractSupabaseProjectRefFromUrl(url);
  if (!urlRef) {
    throw new Error(
      `SUPABASE_URL must look like https://<project-ref>.supabase.co (got hostname could not be parsed).`,
    );
  }

  const meta = decodeSupabaseKeyPayload(serviceKey);
  if (!meta.ok) {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY must be a JWT (three dot-separated segments). ${meta.reason === "jwt_parse_failed" ? "Payload could not be decoded." : "Format is not a JWT."}`,
    );
  }

  if (meta.role === "anon") {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is the anon/public key (role=anon). Use the service_role secret from Supabase Dashboard → Project Settings → API → Project API keys → service_role (secret).",
    );
  }

  if (meta.role !== "service_role") {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY has unexpected JWT role "${meta.role}". Expected service_role.`,
    );
  }

  if (meta.ref && meta.ref !== urlRef) {
    throw new Error(
      `SUPABASE_URL project ref (${urlRef}) does not match the ref embedded in SUPABASE_SERVICE_ROLE_KEY (${meta.ref}). Use URL + service_role key from the same Supabase project.`,
    );
  }
}

function logSupabaseSessionLookup(url, table, urlRef, jwtRef, jwtRole) {
  console.info("[shopify-admin-env] Supabase shopify_sessions lookup:", {
    supabase_url: url,
    project_ref_from_url: urlRef || "(unparsed)",
    jwt_ref: jwtRef || "(none)",
    jwt_role: jwtRole || "(none)",
    table,
  });
}

function enrichSupabaseQueryError(err, context) {
  const raw = err && typeof err === "object" && "message" in err ? String((err).message) : String(err);
  if (/invalid api key|jwt expired|malformed jwt/i.test(raw.toLowerCase())) {
    return new Error(
      [
        `Supabase API error (${context}): ${raw}`,
        "",
        "Fix:",
        "  • Dashboard → Project Settings → API → copy Project URL into SUPABASE_URL",
        "  • Copy the service_role secret (not anon) into SUPABASE_SERVICE_ROLE_KEY",
        "  • Same project for both; no extra quotes/spaces. If the key was rotated, paste the new secret.",
      ].join("\n"),
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Reads offline OAuth session access token from Supabase `shopify_sessions` (same store as Remix app).
 * Matches {@link SupabaseSessionStorage}: table default `shopify_sessions`, offline id `offline_{shop}`.
 */
export async function loadOfflineSessionAccessTokenFromSupabase(opts) {
  const shopDomain = normalizeShopDomainForSession(opts.shopDomain);
  if (!shopDomain) return "";

  const url = trimEnvQuotes(process.env.SUPABASE_URL);
  const serviceKey = sanitizeSupabaseServiceRoleKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const table =
    opts.tableName?.trim() ||
    process.env.SHOPIFY_SESSIONS_TABLE?.trim() ||
    "shopify_sessions";

  if (!url || !serviceKey) return "";

  if (opts.projectRoot) {
    logSupabaseKeyDiagnostics(opts.projectRoot, url, serviceKey);
  }

  assertSupabaseServiceEnvForSessions(url, serviceKey);

  const urlRef = extractSupabaseProjectRefFromUrl(url);
  const jwtMeta = decodeSupabaseKeyPayload(serviceKey);
  const jwtRef = jwtMeta.ok ? jwtMeta.ref : "";
  const jwtRole = jwtMeta.ok ? jwtMeta.role : "";
  logSupabaseSessionLookup(url, table, urlRef, jwtRef, jwtRole);

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const offlineId = `offline_${shopDomain}`;

  const byId = await supabase.from(table).select("data").eq("id", offlineId).maybeSingle();
  if (byId.error) throw enrichSupabaseQueryError(byId.error, `select id=${offlineId}`);

  let rawData = byId.data?.data;
  if (!rawData) {
    const byShop = await supabase
      .from(table)
      .select("data")
      .eq("shop", shopDomain)
      .eq("is_online", false)
      .limit(1);
    if (byShop.error) throw enrichSupabaseQueryError(byShop.error, "select shop+offline");
    rawData = Array.isArray(byShop.data) && byShop.data[0]?.data ? byShop.data[0].data : null;
  }

  if (!rawData) return "";

  let session;
  try {
    session = Session.fromPropertyArray(rawData, true);
  } catch (e) {
    throw new Error(
      `Could not parse Shopify session row in ${table} for ${shopDomain}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const token = session?.accessToken ? String(session.accessToken).trim() : "";
  return token;
}

/**
 * Resolver order:
 * 1. SHOPIFY_ADMIN_ACCESS_TOKEN / SHOPIFY_ACCESS_TOKEN / `.shopify-admin-token`
 * 2. Offline session in Supabase (`shopify_sessions`) for {@link shopDomain}
 * 3. Throws with guidance
 */
export async function resolveShopifyAdminAccessTokenAsync(projectRoot, shopDomain) {
  let token = getShopifyAdminTokenFromEnvOrFile(projectRoot);
  if (token) {
    assertNotClientSecretToken(token);
    return token;
  }

  token = await loadOfflineSessionAccessTokenFromSupabase({ shopDomain, projectRoot });
  if (token) {
    assertNotClientSecretToken(token);
    return token;
  }

  throw new Error(
    [
      "No Shopify Admin API access token available.",
      "",
      "Tried:",
      "  1. SHOPIFY_ADMIN_ACCESS_TOKEN / SHOPIFY_ACCESS_TOKEN / fitment-manager/.shopify-admin-token",
      "  2. Offline session in Supabase table shopify_sessions for this shop (embedded app install).",
      "",
      "Fix:",
      "  • Set SHOPIFY_ADMIN_ACCESS_TOKEN in .env (optional), OR",
      "  • Ensure SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set and the app is installed on the store",
      "    so a row exists with id offline_<shop>.myshopify.com or shop + is_online=false.",
      "",
      `Current SHOP_DOMAIN: ${normalizeShopDomainForSession(shopDomain) || "(missing)"}`,
      "Optional: SHOPIFY_SESSIONS_TABLE=custom_table_name if not shopify_sessions.",
    ].join("\n"),
  );
}

/**
 * Throws with actionable hint when Shopify returns ACCESS_DENIED (missing Admin API scopes).
 */
export function throwIfShopifyGraphqlErrors(json) {
  if (!json?.errors?.length) return;
  const errs = json.errors;
  const denied = errs.some(
    (e) =>
      e?.extensions?.code === "ACCESS_DENIED" ||
      String(e?.message || "").toLowerCase().includes("access denied"),
  );
  let msg = `Shopify GraphQL errors: ${JSON.stringify(errs)}`;
  if (denied) {
    msg += [
      "",
      "ACCESS_DENIED: This Admin API token is missing required scopes (or was created before scopes were added).",
      "",
      "Fix in Shopify Admin:",
      "  Settings → Apps and sales channels → Develop apps → [your app] → Configuration",
      "  → Admin API integration → enable at least: read_products, write_products",
      "  → Save → Install / Update install on the store if prompted.",
      "",
      "Then generate a NEW Admin API access token (shpat_…) — old tokens do not pick up new scopes.",
      "",
      "Docs: https://shopify.dev/docs/api/usage/access-scopes",
    ].join("\n");
  }
  throw new Error(msg);
}
