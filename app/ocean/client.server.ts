import {
  defaultVerification,
  emptyListing,
  listingBelongsTo,
  stableIdentity,
  stripTitle,
  type StableIdentity,
} from "./identity";
import { isHttpUrl, oceanCatalogueBase } from "./catalogueUrl";

const MANAGER_PREFIX = "/ocean-catalogue-manager/shopify-admin";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function oceanBase() {
  return oceanCatalogueBase(process.env.OCEAN_CATALOGUE_URL);
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return text((error as { code?: unknown }).code);
  }
  return "";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return text(error) || "ocean_request_failed";
}

function oceanHeaders() {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  const token = text(process.env.OCEAN_CATALOGUE_MANAGER_TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;
  const secret = text(process.env.OCEAN_CATALOGUE_PROXY_SECRET);
  if (secret) headers["X-Ocean-Proxy-Secret"] = secret;
  headers["X-Ocean-Fitment-Manager"] = "1";
  return headers;
}

function joinUrl(path: string, search = "") {
  const base = oceanBase();
  if (!base) return "";
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const query = search && !search.startsWith("?") ? `?${search}` : search;
  const href = `${base}${MANAGER_PREFIX}${suffix}${query}`;
  return isHttpUrl(href) ? href : "";
}

async function oceanFetch(method: "GET" | "POST", path: string, search = "", body?: Record<string, unknown>) {
  if (!oceanConfigured()) {
    return emptyListing({}, { ok: false, error: "ocean_catalogue_url_missing" });
  }
  const href = joinUrl(path, search);
  if (!href) {
    console.warn("OCEAN_CATALOGUE_URL_INVALID");
    return emptyListing({}, { ok: false, error: "ocean_catalogue_url_invalid" });
  }
  try {
    const res = await fetch(href, {
      method,
      headers: oceanHeaders(),
      body: method === "POST" ? JSON.stringify(body || {}) : undefined,
    });
    let host = "";
    try {
      host = new URL(href).host;
    } catch {
      host = "";
    }
    console.info("OCEAN_UPSTREAM", method, path, res.status, host);
    const payload = await readJson(res);
    if (!res.ok && payload && typeof payload === "object") {
      return { ...payload, ok: false, error: payload.error || `ocean_http_${res.status}` };
    }
    return payload;
  } catch (error) {
    const code = errorCode(error);
    console.warn("OCEAN_REQUEST_FAILED", code || errorMessage(error));
    return emptyListing(
      {},
      {
        ok: false,
        error: code === "ERR_INVALID_URL" ? "ocean_catalogue_url_invalid" : "ocean_request_failed",
      },
    );
  }
}

async function readJson(res: Response) {
  const textBody = await res.text();
  try {
    return textBody ? JSON.parse(textBody) : {};
  } catch {
    return { ok: false, error: "ocean_non_json", status: res.status, body: textBody.slice(0, 300) };
  }
}

export function oceanConfigured() {
  return Boolean(oceanBase());
}

export async function oceanGet(path: string, search = "") {
  return oceanFetch("GET", path, search);
}

export async function oceanPost(path: string, body: Record<string, unknown>) {
  return oceanFetch("POST", path, "", body);
}

export async function oceanProductFitmentGet(identity: Partial<StableIdentity>) {
  try {
    const params = new URLSearchParams();
    if (identity.shopify_product_id) params.set("shopify_product_id", identity.shopify_product_id);
    if (identity.shopify_variant_id) params.set("shopify_variant_id", identity.shopify_variant_id);
    if (identity.sku) params.set("sku", identity.sku);
    if (identity.handle) params.set("handle", identity.handle);
    if (identity.brand) params.set("brand", identity.brand);
    if (identity.mpn) params.set("mpn", identity.mpn);
    const listing = await oceanGet("/product-fitment", params.toString());
    if (!listingBelongsTo(listing, identity)) {
      return emptyListing(identity, { ok: false, error: "stale_product_payload", stale: true });
    }
    return listing;
  } catch (error) {
    console.warn("OCEAN_PRODUCT_FITMENT_FAILED", error);
    return emptyListing(identity, { ok: false, error: "ocean_product_fitment_failed" });
  }
}

export async function oceanProductFitmentPost(rawBody: Record<string, unknown>) {
  const body = stripTitle(rawBody);
  const resolved = stableIdentity(body);
  if (!resolved.ok) return resolved;
  const action = text(body.action || "add").toLowerCase() || "add";
  const source = text(body.source || (action === "import" ? "catalogue_import" : "manual"));
  const verification = defaultVerification(action, text(body.verification_status), source);
  const forwarded = {
    ...body,
    action,
    source,
    verification_status: verification,
    shopify_product_id: resolved.identity.shopify_product_id,
    shopify_variant_id: resolved.identity.shopify_variant_id,
    sku: resolved.identity.sku,
    handle: resolved.identity.handle,
    brand: resolved.identity.brand,
    mpn: resolved.identity.mpn,
    title: undefined,
    product: {
      id: resolved.identity.shopify_product_id,
      sku: resolved.identity.sku,
      handle: resolved.identity.handle,
      barcode: resolved.identity.barcode,
      vendor: resolved.identity.brand,
      variant_id: resolved.identity.shopify_variant_id,
      mpn: resolved.identity.mpn,
    },
  };
  delete forwarded.title;
  const listing = await oceanPost("/product-fitment", forwarded);
  if (!listingBelongsTo(listing, resolved.identity)) {
    return emptyListing(resolved.identity, { ok: false, error: "stale_product_payload", stale: true });
  }
  return listing;
}

export const OCEAN_ENDPOINT = `${MANAGER_PREFIX}/product-fitment`;
export const OCEAN_AUTH_METHOD =
  "Fitment Manager session-token (authenticate.admin) → server Bearer/HMAC to Ocean Catalogue Manager";
