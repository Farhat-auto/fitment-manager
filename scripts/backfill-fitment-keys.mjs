import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import {
  getProjectRoot,
  loadDotenvFiles,
  resolveShopifyAdminAccessTokenAsync,
  throwIfShopifyGraphqlErrors,
} from "./shopify-admin-env.mjs";

const projectRoot = getProjectRoot(import.meta.url);
loadDotenvFiles(projectRoot);

function reqEnv(name, hint = "") {
  const v = process.env[name];
  const t = v == null ? "" : String(v).trim();
  if (!t) throw new Error(hint ? `Missing ${name}. ${hint}` : `Missing ${name}`);
  return t;
}

function normalizeShopDomain(input) {
  let s = String(input ?? "").trim();
  if (!s) return "";
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/\/.*$/g, "");
  s = s.replace(/\/+$/g, "");
  return s;
}

function norm(v) {
  return String(v ?? "").trim();
}

function parseCli(argv) {
  const out = { dryRun: false, limit: null, resetCheckpoint: false };
  for (const raw of argv.slice(2)) {
    const a = String(raw ?? "").trim();
    if (a === "--dry-run" || a === "--dry") out.dryRun = true;
    else if (a === "--reset-checkpoint" || a === "--no-resume") out.resetCheckpoint = true;
    else if (a.startsWith("--limit=")) {
      const n = Number.parseInt(a.slice("--limit=".length).trim(), 10);
      out.limit = Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return out;
}

function defaultCheckpointPath() {
  return path.join(projectRoot, ".backfill-fitment-keys.checkpoint.json");
}

async function readCheckpoint(fp) {
  try {
    const raw = await fs.readFile(fp, "utf8");
    const j = JSON.parse(raw);
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
}

async function writeCheckpoint(fp, ck) {
  await fs.writeFile(fp, JSON.stringify(ck, null, 2), "utf8");
}

async function shopifyGraphql(shopDomain, accessToken, apiVersion, query, variables) {
  const url = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-access-token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(`Shopify GraphQL HTTP ${resp.status}: ${JSON.stringify(json)}`);
  if (json?.errors?.length) throwIfShopifyGraphqlErrors(json);
  return json;
}

const cli = parseCli(process.argv);

const shop_domain = normalizeShopDomain(reqEnv("SHOP_DOMAIN", "e.g. oceancarparts-com-2.myshopify.com"));
const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-04";

const supabaseUrl = reqEnv("SUPABASE_URL");
const serviceKey = reqEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const checkpointPath = defaultCheckpointPath();
if (cli.resetCheckpoint) {
  try {
    await fs.unlink(checkpointPath);
  } catch {}
}

const checkpoint = (await readCheckpoint(checkpointPath)) || { after: null, processed: 0 };

const accessToken = await resolveShopifyAdminAccessTokenAsync(projectRoot, shop_domain);

const LIST_PRODUCTS = `#graphql
  query ListProductsForFitmentBackfill($first: Int! = 50, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        mf_fitment: metafield(namespace: "fitment", key: "vehicles") { type value jsonValue }
        mf_compat: metafield(namespace: "custom", key: "compatible_vehicles") { type value jsonValue }
      }
    }
  }
`;

const RESOLVE_VEHICLES = `#graphql
  query ResolveVehicleKeys($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Metaobject {
        id
        handle
        type
        vehicle_key: field(key: "vehicle_key") { value }
        slug: field(key: "slug") { value }
      }
    }
  }
`;

const SET_FITMENT_KEYS = `#graphql
  mutation SetFitmentKeys($ownerId: ID!, $value: String!) {
    metafieldsSet(
      metafields: [
        {
          ownerId: $ownerId
          namespace: "custom"
          key: "fitment_keys"
          type: "json"
          value: $value
        }
      ]
    ) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

function parseGidListFromMetafield(rawMf) {
  if (!rawMf || typeof rawMf !== "object") return [];
  const jv = rawMf.jsonValue;
  if (Array.isArray(jv)) return jv.map((x) => norm(x)).filter(Boolean);
  const s = String(rawMf.value ?? "").trim();
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr.map((x) => norm(x)).filter(Boolean);
  } catch {}
  return s
    .split(/[\n\r,]+/g)
    .map((x) => norm(x))
    .filter(Boolean);
}

async function resolveVehicleGidsToKeys(ids) {
  const unique = Array.from(new Set((ids || []).map((x) => norm(x)).filter(Boolean)));
  if (!unique.length) return [];
  const json = await shopifyGraphql(shop_domain, accessToken, apiVersion, RESOLVE_VEHICLES, { ids: unique });
  const nodes = Array.isArray(json?.data?.nodes) ? json.data.nodes : [];
  const keys = [];
  for (const n of nodes) {
    const handle = norm(n?.handle);
    const vk = norm(n?.vehicle_key?.value) || norm(n?.slug?.value) || handle;
    if (vk) keys.push(vk);
  }
  return Array.from(new Set(keys));
}

let after = checkpoint.after;
let processed = Number(checkpoint.processed || 0);
let pages = 0;
let nonEmptyLegacyMetafieldCount = 0;
let resolvedVehicleKeysTotal = 0;

if (cli.limit != null && processed >= cli.limit) {
  console.warn("[backfill-fitment-keys] Checkpoint indicates already processed >= limit. Use --reset-checkpoint to restart.", {
    processed,
    limit: cli.limit,
    checkpointPath,
  });
}

while (true) {
  const json = await shopifyGraphql(shop_domain, accessToken, apiVersion, LIST_PRODUCTS, { first: 50, after });
  const conn = json?.data?.products;
  const nodes = Array.isArray(conn?.nodes) ? conn.nodes : [];
  const pageInfo = conn?.pageInfo ?? {};

  if (!nodes.length) break;
  pages += 1;

  for (const p of nodes) {
    if (cli.limit != null && processed >= cli.limit) break;

    const product_id = norm(p?.id);
    const handle = norm(p?.handle);

    const fitmentGids = parseGidListFromMetafield(p?.mf_fitment);
    const compatGids = parseGidListFromMetafield(p?.mf_compat);
    const vehicleGids = Array.from(new Set([...fitmentGids, ...compatGids])).filter(Boolean);
    if (vehicleGids.length) nonEmptyLegacyMetafieldCount += 1;

    const vehicle_keys = await resolveVehicleGidsToKeys(vehicleGids);
    if (vehicle_keys.length) resolvedVehicleKeysTotal += vehicle_keys.length;

    if (vehicle_keys.length) {
      if (!cli.dryRun) {
        // Supabase: upsert product_fitment rows (no deletion yet).
        const { error } = await supabase.from("product_fitment").upsert(
          vehicle_keys.map((vehicle_key) => ({
            shop_domain,
            product_id,
            vehicle_key,
          })),
          { onConflict: "shop_domain,product_id,vehicle_key" },
        );
        if (error) throw error;

        // Shopify: write custom.fitment_keys
        const set = await shopifyGraphql(shop_domain, accessToken, apiVersion, SET_FITMENT_KEYS, {
          ownerId: product_id,
          value: JSON.stringify(vehicle_keys),
        });
        const uErrs = set?.data?.metafieldsSet?.userErrors ?? [];
        if (Array.isArray(uErrs) && uErrs.length) {
          console.warn("FITMENT_KEYS_USER_ERRORS", { product_id, handle, uErrs });
        }
      }
    }

    processed += 1;
    if (processed % 25 === 0) {
      await writeCheckpoint(checkpointPath, { after, processed, pages });
      console.log("[backfill-fitment-keys]", { processed, pages, lastHandle: handle, vehicleKeys: vehicle_keys.length });
    }
  }

  if (cli.limit != null && processed >= cli.limit) break;

  after = pageInfo?.hasNextPage ? pageInfo?.endCursor ?? null : null;
  await writeCheckpoint(checkpointPath, { after, processed, pages });
  if (!after) break;
}

console.log("[backfill-fitment-keys:done]", {
  processed,
  pages,
  dryRun: cli.dryRun,
  checkpointPath,
  nonEmptyLegacyMetafieldCount,
  resolvedVehicleKeysTotal,
});

