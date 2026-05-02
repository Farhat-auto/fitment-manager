import fs from "node:fs/promises";
import path from "node:path";
import {
  getProjectRoot,
  loadDotenvFiles,
  resolveShopifyAdminAccessTokenAsync,
  throwIfShopifyGraphqlErrors,
} from "./shopify-admin-env.mjs";
import { parseMetafieldToLines } from "./lib/oe-metafield-lines.mjs";

const projectRoot = getProjectRoot(import.meta.url);
loadDotenvFiles(projectRoot);

/**
 * Bulk-write `custom.search_index` (multi-line text, one normalized key per line) from
 * `oe_references`, `cross_references`, and `article_number` — same logic as app/utils/oeReferences.ts.
 *
 * Required env:
 *   SHOP_DOMAIN — store hostname (e.g. oceancarparts-com-2.myshopify.com)
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — to load offline OAuth token from shopify_sessions when SHOPIFY_ADMIN_ACCESS_TOKEN is unset (embedded app).
 * Optional:
 *   SHOPIFY_ADMIN_ACCESS_TOKEN — overrides session DB when set
 *   SHOPIFY_SESSIONS_TABLE — default shopify_sessions
 *   SHOPIFY_ADMIN_API_VERSION — default 2024-10
 *   BACKFILL_SEARCH_INDEX_CHECKPOINT — override checkpoint file path (default: `.backfill-search-index.checkpoint.json` in repo root)
 *   BACKFILL_SEARCH_INDEX_STATS=1 — extra counts (sources present, mismatches, …)
 *
 * CLI:
 *   npm run backfill:search-index -- --dry-run
 *   npm run backfill:search-index -- --limit=20
 *   npm run backfill:search-index -- --reset-checkpoint
 *
 * Define metafield in Shopify admin if needed: custom.search_index, type: Multi line text.
 * Also adds product tags `OE:{NORMALIZED_KEY}` for each line (Shopify search indexes tags).
 */

const INITIAL_BATCH_SIZE = 50;
const MIN_BATCH_SIZE = 5;
/** Exponential backoff caps at 60s (per requirement). */
const BACKOFF_MS = [2000, 5000, 10000, 20000, 60000];

function parseCli(argv) {
  const out = {
    dryRun: false,
    limit: null,
    resetCheckpoint: false,
  };
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
  const env = process.env.BACKFILL_SEARCH_INDEX_CHECKPOINT?.trim();
  if (env) return path.isAbsolute(env) ? env : path.join(projectRoot, env);
  return path.join(projectRoot, ".backfill-search-index.checkpoint.json");
}

function reqEnv(name, hint) {
  const v = process.env[name];
  const t = v == null ? "" : String(v).trim();
  if (!t) {
    throw new Error(hint ? `Missing ${name}. ${hint}` : `Missing ${name}`);
  }
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

function normalizeOeReferenceLine(raw) {
  let line = String(raw ?? "").trim();
  if (!line) return "";
  while (/^OE\s+OE\s+/i.test(line)) {
    line = line.replace(/^OE\s+OE\s+/i, "OE ");
  }
  line = line.replace(/\s+/g, " ");
  return line.trim();
}

const EM_DASH = "\u2014";
const EN_DASH = "\u2013";

function normalizeOeSearchKey(raw) {
  const rawStr = String(raw ?? "").trim();
  if (!rawStr) return "";
  if (rawStr === "*") return "*";

  let seg = rawStr.split(EM_DASH)[0] ?? "";
  seg = (seg.split(EN_DASH)[0] ?? "").trim();
  seg = (seg.split(" - ")[0] ?? "").trim();

  let t = seg.replace(/["'\u201c\u201d\u2018\u2019]/g, "").trim();

  for (let i = 0; i < 12; i++) {
    const u = t.toUpperCase();
    if (u.startsWith("OEM")) {
      t = t.slice(3).trim();
      continue;
    }
    if (u.startsWith("OE")) {
      t = t.slice(2).trim();
      continue;
    }
    break;
  }

  return t.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** TecDoc-style cross refs often prefix supplier tokens (`PIERBURG 7.05171.65.0`). Mirrors `oe-crossref-normalize-one.liquid`. */
function normalizeCrossRefSearchKey(raw) {
  const base = normalizeOeSearchKey(String(raw ?? "").trim());
  if (!base || base === "*") return "";
  if (!/\d/.test(base)) return "";
  const idx = base.search(/[0-9]/);
  if (idx < 0) return "";
  if (idx >= 5) return base.slice(idx);
  return base;
}

/** Extra index lines so Shopify search can match TecDoc-style cross refs (bare digits, dotted, concatenated brand+digits). */
function addCrossReferenceSearchIndexKeys(rawLine, keys) {
  const raw = String(rawLine ?? "").trim();
  if (!raw) return;
  keys.add(raw);
  const kFull = normalizeOeSearchKey(raw);
  if (kFull && kFull !== "*") keys.add(kFull);
  const kxr = normalizeCrossRefSearchKey(raw);
  if (kxr && kxr !== "*") keys.add(kxr);
  for (const part of raw.split(/\s+/)) {
    const p = part.trim();
    if (!p) continue;
    if (/^[\d.]+$/.test(p) && /[0-9]/.test(p)) keys.add(p);
  }
}

function buildCustomSearchIndexValue({ oeLines, crossLines, articleNumber }) {
  const keys = new Set();
  for (const line of oeLines) {
    const normalized = normalizeOeReferenceLine(line);
    const k = normalizeOeSearchKey(normalized);
    if (k && k !== "*") keys.add(k);
    const kx = normalizeCrossRefSearchKey(normalized);
    if (kx && kx !== "*") keys.add(kx);
  }
  for (const line of crossLines) {
    addCrossReferenceSearchIndexKeys(line, keys);
  }
  const art = String(articleNumber ?? "").trim();
  if (art) {
    const k = normalizeOeSearchKey(art);
    if (k && k !== "*") keys.add(k);
    const kx = normalizeCrossRefSearchKey(art);
    if (kx && kx !== "*") keys.add(kx);
  }
  return Array.from(keys)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .join("\n");
}

/** Compare stored metafield text to computed index: ignore CRLF vs LF, blank lines, and line order. */
function canonicalSearchIndexText(raw) {
  const lines = String(raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).join("\n");
}

function oeTagsFromSearchIndexText(searchIndexText) {
  const lines = String(searchIndexText ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const tags = [];
  for (const k of lines) {
    if (!k || k === "*") continue;
    tags.push(`OE:${k}`);
    if (k.length >= 10 && /^A\d+$/i.test(k)) {
      const noA = k.slice(1);
      if (noA) tags.push(`OE:${noA}`);
    }
  }
  return Array.from(new Set(tags));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffMs(attemptIndex) {
  const i = Math.max(0, Math.floor(attemptIndex));
  return BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)];
}

function isThrottledPayload(json, httpStatus) {
  if (httpStatus === 429) return true;
  const errs = json?.errors;
  if (!Array.isArray(errs) || errs.length === 0) return false;
  return errs.some((e) => {
    const code = String(e?.extensions?.code ?? "").toUpperCase();
    const msg = String(e?.message ?? "").toUpperCase();
    return code === "THROTTLED" || msg.includes("THROTTLE");
  });
}

async function shopifyGraphqlFetch(shopDomain, accessToken, apiVersion, query, variables) {
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
  return { resp, json };
}

/**
 * Shopify GraphQL with THROTTLED / 429 handling: wait + retry with backoff; optionally shrink batch size.
 */
async function shopifyGraphqlWithRetry(ctx, shopDomain, accessToken, apiVersion, query, variables, label) {
  let attempt = 0;
  let throttleBurst = 0;

  while (true) {
    const { resp, json } = await shopifyGraphqlFetch(shopDomain, accessToken, apiVersion, query, variables);

    if (!resp.ok && resp.status !== 429) {
      throw new Error(`Shopify GraphQL HTTP ${resp.status}: ${JSON.stringify(json)}`);
    }

    const throttled = isThrottledPayload(json, resp.status);

    if (throttled) {
      throttleBurst++;
      ctx.stablePages = 0;
      const waitMs = getBackoffMs(attempt);
      console.warn(
        `[backfill-search-index:throttled] ${label} → wait ${waitMs}ms (attempt ${attempt + 1}, burst ${throttleBurst}, batchSize=${ctx.batchSize})`,
      );
      await sleep(waitMs);
      attempt++;

      if (throttleBurst >= 2) {
        const prev = ctx.batchSize;
        ctx.batchSize = Math.max(MIN_BATCH_SIZE, Math.floor(ctx.batchSize / 2));
        if (ctx.batchSize !== prev) {
          console.warn(`[backfill-search-index:batch] reduced batchSize ${prev} → ${ctx.batchSize} (repeated throttle)`);
        }
        throttleBurst = 0;
      }

      if (attempt > 40) {
        throw new Error(`Shopify GraphQL: too many THROTTLED retries for ${label} (last payload: ${JSON.stringify(json?.errors ?? json)})`);
      }
      continue;
    }

    if (json?.errors?.length) {
      throwIfShopifyGraphqlErrors(json);
    }
    return json;
  }
}

async function readCheckpoint(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    if (data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

async function writeCheckpoint(filePath, state) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

async function removeCheckpoint(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    /* ignore */
  }
}

const PRODUCTS_QUERY = `#graphql
  query ProductsBackfillSearchIndex($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        oe_references: metafield(namespace: "custom", key: "oe_references") {
          value
          jsonValue
        }
        cross_references: metafield(namespace: "custom", key: "cross_references") {
          value
          jsonValue
        }
        article_number: metafield(namespace: "custom", key: "article_number") { value }
        search_index: metafield(namespace: "custom", key: "search_index") { value }
        tags
      }
    }
  }
`;

const TAGS_ADD = `#graphql
  mutation OcpOeTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        ... on Product {
          id
          tags
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SET_SEARCH_INDEX = `#graphql
  mutation SetSearchIndex($ownerId: ID!, $searchIndex: String!) {
    metafieldsSet(
      metafields: [
        {
          ownerId: $ownerId
          namespace: "custom"
          key: "search_index"
          type: "multi_line_text_field"
          value: $searchIndex
        }
      ]
    ) {
      metafields { id key value }
      userErrors { field message }
    }
  }
`;

async function main() {
  const cli = parseCli(process.argv);
  const shop_domain = normalizeShopDomain(
    reqEnv("SHOP_DOMAIN", "Example: SHOP_DOMAIN=your-store.myshopify.com"),
  );
  const adminToken = await resolveShopifyAdminAccessTokenAsync(projectRoot, shop_domain);
  const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION?.trim() || "2024-10";

  const checkpointPath = defaultCheckpointPath();

  if (cli.resetCheckpoint) {
    await removeCheckpoint(checkpointPath);
    console.info("[backfill-search-index:checkpoint] reset", checkpointPath);
  }

  let checkpoint = await readCheckpoint(checkpointPath);
  if (checkpoint && checkpoint.shop_domain && checkpoint.shop_domain !== shop_domain) {
    console.warn(
      `[backfill-search-index:checkpoint] file shop_domain mismatch (${checkpoint.shop_domain} vs ${shop_domain}) — starting fresh`,
    );
    checkpoint = null;
  }

  const ctx = {
    batchSize: Number.isFinite(checkpoint?.batchSize)
      ? Math.max(MIN_BATCH_SIZE, Math.min(INITIAL_BATCH_SIZE, Number(checkpoint.batchSize)))
      : INITIAL_BATCH_SIZE,
    stablePages: 0,
  };

  let requestAfter = checkpoint?.nextAfter ?? null;
  let scanned = Number.isFinite(checkpoint?.scanned) ? Number(checkpoint.scanned) : 0;
  let updated = Number.isFinite(checkpoint?.updated) ? Number(checkpoint.updated) : 0;
  let skipped = Number.isFinite(checkpoint?.skipped) ? Number(checkpoint.skipped) : 0;

  const stats =
    process.env.BACKFILL_SEARCH_INDEX_STATS === "1"
      ? {
          withSources: 0,
          nonemptyNext: 0,
          indexMismatch: 0,
          tagsWouldAdd: 0,
        }
      : null;

  if (cli.dryRun) {
    console.info("[backfill-search-index:dry-run] no metafield/tag writes will be performed");
  }
  if (cli.limit != null) {
    console.info("[backfill-search-index:limit] stop after", cli.limit, "products scanned (this run)");
  }
  if (checkpoint && !cli.resetCheckpoint) {
    console.info("[backfill-search-index:checkpoint] resume from", checkpointPath, {
      nextAfter: requestAfter,
      batchSize: ctx.batchSize,
      scanned,
      updated,
      skipped,
    });
  }

  while (true) {
    const pageLabel = `products(first=${ctx.batchSize}, after=${requestAfter ?? "null"})`;
    const resp = await shopifyGraphqlWithRetry(
      ctx,
      shop_domain,
      adminToken,
      apiVersion,
      PRODUCTS_QUERY,
      { first: ctx.batchSize, after: requestAfter },
      pageLabel,
    );

    const root = resp?.data?.products;
    const nodes = Array.isArray(root?.nodes) ? root.nodes : [];
    const pageInfo = root?.pageInfo ?? { hasNextPage: false, endCursor: null };

    console.info(
      `[backfill-search-index:page] batchSize=${ctx.batchSize} nodes=${nodes.length} scanned=${scanned} updated=${updated} skipped=${skipped}${cli.dryRun ? " dry-run" : ""}`,
    );

    ctx.stablePages = (ctx.stablePages ?? 0) + 1;
    if (ctx.stablePages >= 5 && ctx.batchSize < INITIAL_BATCH_SIZE) {
      const prev = ctx.batchSize;
      ctx.batchSize = Math.min(INITIAL_BATCH_SIZE, ctx.batchSize + 10);
      ctx.stablePages = 0;
      console.info(`[backfill-search-index:batch] recovered batchSize ${prev} → ${ctx.batchSize} (5 pages without throttle)`);
    }

    const requestAfterThisPage = requestAfter;

    for (const p of nodes) {
      if (cli.limit != null && scanned >= cli.limit) {
        await writeCheckpoint(checkpointPath, {
          version: 1,
          shop_domain,
          nextAfter: requestAfterThisPage,
          batchSize: ctx.batchSize,
          scanned,
          updated,
          skipped,
          stoppedReason: "limit",
          savedAt: new Date().toISOString(),
        });
        console.info("[backfill-search-index:limit] reached -- checkpoint saved", checkpointPath);
        if (cli.dryRun) {
          console.info(
            `[backfill-search-index:dry-run] summary: ${updated} product(s) would be written; ${skipped} already match — stopped by --limit`,
          );
        }
        console.log("[backfill-search-index:done]", {
          shop_domain,
          scanned,
          updated,
          skipped,
          batchSize: ctx.batchSize,
          dryRun: cli.dryRun,
          limit: cli.limit,
          checkpoint: checkpointPath,
          ...(stats ?? {}),
        });
        return;
      }

      scanned++;
      const ownerId = String(p?.id ?? "");
      const oeLines = parseMetafieldToLines(p?.oe_references)
        .map((line) => normalizeOeReferenceLine(line))
        .filter(Boolean);
      const crossLines = parseMetafieldToLines(p?.cross_references);
      const articleNumber = String(p?.article_number?.value ?? "").trim();
      const currentRaw = String(p?.search_index?.value ?? "");
      const existingTagUpper = new Set(
        (Array.isArray(p?.tags) ? p.tags : []).map((t) => String(t).trim().toUpperCase()),
      );

      const next = buildCustomSearchIndexValue({ oeLines, crossLines, articleNumber });
      const currentCanon = canonicalSearchIndexText(currentRaw);
      const nextCanon = canonicalSearchIndexText(next);
      const indexOutOfSync = currentCanon !== nextCanon;

      if (stats) {
        const hasSources = oeLines.length > 0 || crossLines.length > 0 || Boolean(articleNumber);
        if (hasSources) stats.withSources++;
        if (next.trim()) stats.nonemptyNext++;
        if (indexOutOfSync) stats.indexMismatch++;
      }

      const wantTags = oeTagsFromSearchIndexText(next);
      const missingTags = wantTags.filter((t) => !existingTagUpper.has(String(t).trim().toUpperCase()));

      if (stats && missingTags.length > 0) stats.tagsWouldAdd++;

      if (!indexOutOfSync && missingTags.length === 0) {
        skipped++;
        continue;
      }

      if (cli.dryRun) {
        updated++;
        console.info(
          `[backfill-search-index:dry-run] would sync ${ownerId} indexOutOfSync=${indexOutOfSync} missingTags=${missingTags.length}`,
        );
        continue;
      }

      if (indexOutOfSync) {
        const write = await shopifyGraphqlWithRetry(
          ctx,
          shop_domain,
          adminToken,
          apiVersion,
          SET_SEARCH_INDEX,
          { ownerId, searchIndex: next },
          `metafieldsSet(${ownerId})`,
        );
        const errs = write?.data?.metafieldsSet?.userErrors ?? [];
        if (Array.isArray(errs) && errs.length) {
          throw new Error(`metafieldsSet failed for ${ownerId}: ${JSON.stringify(errs)}`);
        }
      }

      if (missingTags.length > 0) {
        const tagResp = await shopifyGraphqlWithRetry(
          ctx,
          shop_domain,
          adminToken,
          apiVersion,
          TAGS_ADD,
          { id: ownerId, tags: missingTags },
          `tagsAdd(${ownerId})`,
        );
        const tagErrs = tagResp?.data?.tagsAdd?.userErrors ?? [];
        if (Array.isArray(tagErrs) && tagErrs.length) {
          throw new Error(`tagsAdd failed for ${ownerId}: ${JSON.stringify(tagErrs)}`);
        }
      }

      updated++;
    }

    await writeCheckpoint(checkpointPath, {
      version: 1,
      shop_domain,
      nextAfter: pageInfo?.endCursor ? String(pageInfo.endCursor) : null,
      batchSize: ctx.batchSize,
      scanned,
      updated,
      skipped,
      savedAt: new Date().toISOString(),
    });

    if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) {
      await removeCheckpoint(checkpointPath);
      console.info("[backfill-search-index:checkpoint] completed — checkpoint removed", checkpointPath);
      break;
    }

    requestAfter = String(pageInfo.endCursor);
  }

  if (cli.dryRun) {
    if (updated === 0) {
      console.info(
        `[backfill-search-index:dry-run] summary: no writes needed — ${skipped} product(s) already match computed custom.search_index + OE: tags`,
      );
    } else {
      console.info(
        `[backfill-search-index:dry-run] summary: ${updated} product(s) would be written; ${skipped} already in sync`,
      );
    }
  }

  console.log("[backfill-search-index:done]", {
    shop_domain,
    scanned,
    updated,
    skipped,
    batchSize: ctx.batchSize,
    dryRun: cli.dryRun,
    limit: cli.limit ?? null,
    checkpoint: checkpointPath,
    ...(stats ?? {}),
  });
}

try {
  await main();
} catch (err) {
  console.error("[backfill-search-index:error]", err);
  process.exit(1);
}
