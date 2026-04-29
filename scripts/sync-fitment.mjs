import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function normalizeShopDomain(input) {
  let s = String(input ?? "").trim();
  if (!s) return "";
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/\/.*$/g, ""); // strip any path
  s = s.replace(/\/+$/g, "");
  return s;
}

function normalizeRef(v) {
  // Deterministic normalization (no fuzzy matching):
  // uppercase + keep only alphanumeric characters.
  return String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function splitRefs(value) {
  const s = String(value ?? "").trim();
  if (!s) return [];
  // Accept common formats: JSON array string or delimited string.
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map((x) => String(x ?? "")).filter(Boolean);
    } catch {}
  }
  return s
    .split(/[\n\r,;|]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function csvParse(text) {
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      pushField();
      pushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  pushField();
  if (row.length > 1 || (row.length === 1 && row[0] !== "")) pushRow();
  return rows;
}

function readFitmentSourceCsv(csvPath) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const table = csvParse(raw);
  if (!table.length) return [];

  const header = table[0].map((h) => String(h ?? "").trim().toLowerCase());
  const idx = (name) => header.indexOf(name);

  const iArticle = idx("article_number");
  const iBrand = idx("brand");
  const iOe = idx("oe_reference");
  const iCross = idx("cross_reference");
  const iVk = idx("vehicle_key");
  const iVh = idx("vehicle_handle");
  const iVdn = idx("vehicle_display_name");
  const iCat = idx("category_key");
  const iGroup = idx("system_group_key");
  const iSub = idx("subcategory_key");

  const out = [];
  for (let r = 1; r < table.length; r++) {
    const cols = table[r] || [];
    const row = {
      article_number: iArticle !== -1 ? String(cols[iArticle] ?? "").trim() : "",
      brand: iBrand !== -1 ? String(cols[iBrand] ?? "").trim() : "",
      oe_reference: iOe !== -1 ? String(cols[iOe] ?? "").trim() : "",
      cross_reference: iCross !== -1 ? String(cols[iCross] ?? "").trim() : "",
      vehicle_key: iVk !== -1 ? String(cols[iVk] ?? "").trim() : "",
      vehicle_handle: iVh !== -1 ? String(cols[iVh] ?? "").trim() : "",
      vehicle_display_name: iVdn !== -1 ? String(cols[iVdn] ?? "").trim() : "",
      category_key: iCat !== -1 ? String(cols[iCat] ?? "").trim() : "",
      system_group_key: iGroup !== -1 ? String(cols[iGroup] ?? "").trim() : "",
      subcategory_key: iSub !== -1 ? String(cols[iSub] ?? "").trim() : "",
      line: r + 1,
    };
    if (!row.vehicle_key) continue;
    if (!(row.article_number || row.oe_reference || row.cross_reference)) continue;
    out.push(row);
  }
  return out;
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
  if (!resp.ok) {
    throw new Error(`Shopify GraphQL HTTP ${resp.status} (${url}): ${JSON.stringify(json)}`);
  }
  if (json?.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json;
}

const shop_domain = normalizeShopDomain(reqEnv("SHOP_DOMAIN"));
const adminToken = reqEnv("SHOPIFY_ADMIN_ACCESS_TOKEN");
const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || "2024-10";

if (/^shpss_/i.test(adminToken)) {
  throw new Error(
    "SHOPIFY_ADMIN_ACCESS_TOKEN looks like a Shopify app secret (shpss_*), not an Admin API access token (shpat_*).",
  );
}

const supabaseUrl = reqEnv("SUPABASE_URL");
const serviceKey = reqEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const csvPath = path.resolve(process.cwd(), "data", "fitment-source.csv");
if (!fs.existsSync(csvPath)) {
  throw new Error(`Missing fitment source file at ${csvPath}`);
}

const sourceRows = readFitmentSourceCsv(csvPath);

// Build indexes for matching.
const byArticle = new Map();
const byOe = new Map();
const byCross = new Map();

function addToIndex(map, key, row) {
  const k = normalizeRef(key);
  if (!k) return;
  const arr = map.get(k) || [];
  arr.push(row);
  map.set(k, arr);
}

for (const r of sourceRows) {
  addToIndex(byArticle, r.article_number, r);
  addToIndex(byOe, r.oe_reference, r);
  addToIndex(byCross, r.cross_reference, r);
}

const PRODUCTS_QUERY = `#graphql
  query ProductsForAutoFitment($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        variants(first: 10) { nodes { sku } }
        article_number: metafield(namespace: "custom", key: "article_number") { value }
        oe_references: metafield(namespace: "custom", key: "oe_references") { value }
        cross_references: metafield(namespace: "custom", key: "cross_references") { value }
        catalog_subcategory_key: metafield(namespace: "custom", key: "catalog_subcategory_key") { value }
        catalog_system_group_key: metafield(namespace: "custom", key: "catalog_system_group_key") { value }
        brand: metafield(namespace: "custom", key: "brand") { value }
      }
    }
  }
`;

let after = null;
let totalProducts = 0;
let totalMatches = 0;
let totalUpserts = 0;

async function main() {
  while (true) {
    const resp = await shopifyGraphql(shop_domain, adminToken, apiVersion, PRODUCTS_QUERY, {
      first: 100,
      after,
    });

    const root = resp?.data?.products;
    const nodes = Array.isArray(root?.nodes) ? root.nodes : [];
    const pageInfo = root?.pageInfo ?? { hasNextPage: false, endCursor: null };

    for (const p of nodes) {
      totalProducts++;

    const product_gid = String(p?.id ?? "");
    const product_handle = String(p?.handle ?? "").trim();
    const skuList = Array.isArray(p?.variants?.nodes)
      ? p.variants.nodes.map((v) => String(v?.sku ?? "").trim()).filter(Boolean)
      : [];
    const sku = skuList[0] || null;

    const article_number = String(p?.article_number?.value ?? "").trim();
    const brand = String(p?.brand?.value ?? "").trim();

    const productOeRefs = splitRefs(p?.oe_references?.value).map(normalizeRef).filter(Boolean);
    const productCrossRefs = splitRefs(p?.cross_references?.value).map(normalizeRef).filter(Boolean);

    const productCatalogSub = String(p?.catalog_subcategory_key?.value ?? "").trim();
    const productCatalogGroup = String(p?.catalog_system_group_key?.value ?? "").trim();

    // Matching priority:
    // 1) article_number
    // 2) SKU
    // 3) OE reference
    // 4) cross reference
    const candidateRows = [];

    const articleKey = normalizeRef(article_number);
    if (articleKey && byArticle.has(articleKey)) {
      candidateRows.push(...(byArticle.get(articleKey) || []));
    } else {
      // SKU match uses same normalization but indexes are not built for SKU in the source format;
      // we match SKU against cross_reference/oe_reference if your source provides those as SKUs,
      // otherwise it will fall through to OE/Cross.
      const skuKey = normalizeRef(sku);
      if (skuKey) {
        if (byArticle.has(skuKey)) candidateRows.push(...(byArticle.get(skuKey) || []));
        if (byOe.has(skuKey)) candidateRows.push(...(byOe.get(skuKey) || []));
        if (byCross.has(skuKey)) candidateRows.push(...(byCross.get(skuKey) || []));
      }

      if (!candidateRows.length && productOeRefs.length) {
        for (const r of productOeRefs) {
          if (byOe.has(r)) candidateRows.push(...(byOe.get(r) || []));
        }
      }

      if (!candidateRows.length && productCrossRefs.length) {
        for (const r of productCrossRefs) {
          if (byCross.has(r)) candidateRows.push(...(byCross.get(r) || []));
        }
      }
    }

    if (!candidateRows.length) continue;
    totalMatches++;

    // Dedupe by vehicle_key + subcategory_key.
    const dedup = new Map();
    for (const r of candidateRows) {
      const k = `${String(r.vehicle_key).trim()}|||${String(r.subcategory_key || "").trim()}`;
      if (!dedup.has(k)) dedup.set(k, r);
    }

    const upsertRows = Array.from(dedup.values()).map((r) => ({
      shop_domain,
      product_gid,
      product_handle,
      sku,
      article_number: article_number || r.article_number || null,
      brand: brand || r.brand || null,
      vehicle_key: r.vehicle_key,
      vehicle_handle: r.vehicle_handle || null,
      vehicle_display_name: r.vehicle_display_name || null,
      category_key: r.category_key || null,
      system_group_key: r.system_group_key || productCatalogGroup || null,
      subcategory_key: r.subcategory_key || productCatalogSub || null,
      source: "auto-sync",
    }));

    const { error } = await supabase
      .from("fitment")
      .upsert(upsertRows, {
        onConflict: "shop_domain,product_gid,product_handle,vehicle_key,subcategory_key",
      });
    if (error) throw error;

      totalUpserts += upsertRows.length;
    }

    if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) break;
    after = String(pageInfo.endCursor);
  }

  console.log("[sync-fitment:done]", {
    shop_domain,
    sourceFile: csvPath,
    sourceRows: sourceRows.length,
    productsScanned: totalProducts,
    productsMatched: totalMatches,
    fitmentRowsUpserted: totalUpserts,
  });
}

try {
  await main();
} catch (err) {
  console.error("[sync-fitment:error]", err);
  process.exit(1);
}

