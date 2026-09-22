/**
 * Bounded Shopify Admin GraphQL helpers.
 *
 * A THROTTLED response must never become an unbounded retry loop, and callers
 * should treat missing data as unavailable (fail closed) rather than inventing it.
 */

export type ShopifyGraphqlClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<any>;
};

export type ShopifyCost = {
  requestedQueryCost?: number;
  actualQueryCost?: number;
  throttleStatus?: {
    maximumAvailable?: number;
    currentlyAvailable?: number;
    restoreRate?: number;
  };
};

export type ShopifyGraphqlJson = {
  data?: any;
  errors?: unknown;
  extensions?: { cost?: ShopifyCost };
};

const MAX_RETRY_ATTEMPTS = 3; // first try + 2 retries; never unlimited
const MAX_BACKOFF_MS = 2500;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function collectErrorMessages(source: unknown, into: string[]): void {
  if (source == null) return;
  if (typeof source === "string") {
    into.push(source);
    return;
  }
  if (Array.isArray(source)) {
    for (const item of source) collectErrorMessages(item, into);
    return;
  }
  if (typeof source !== "object") return;
  const rec = source as Record<string, unknown>;
  if (typeof rec.message === "string") into.push(rec.message);
  if (typeof rec.code === "string") into.push(rec.code);
  const ext = rec.extensions;
  if (ext && typeof ext === "object" && typeof (ext as any).code === "string") {
    into.push(String((ext as any).code));
  }
  if ("graphQLErrors" in rec) collectErrorMessages(rec.graphQLErrors, into);
  if ("errors" in rec) collectErrorMessages(rec.errors, into);
  if ("body" in rec) collectErrorMessages(rec.body, into);
}

export function isShopifyThrottled(errorOrJson: unknown, httpStatus?: number): boolean {
  if (httpStatus === 429) return true;
  const messages: string[] = [];
  if (errorOrJson && typeof errorOrJson === "object") {
    const rec = errorOrJson as Record<string, unknown>;
    collectErrorMessages(errorOrJson, messages);
    if (typeof rec.message === "string") messages.push(rec.message);
    if (typeof rec.name === "string") messages.push(rec.name);
    const status = Number((rec as any)?.response?.status ?? (rec as any)?.status ?? NaN);
    if (status === 429) return true;
  } else if (typeof errorOrJson === "string") {
    messages.push(errorOrJson);
  }
  return messages.some((m) => {
    const s = m.toLowerCase();
    return s.includes("throttled") || s === "throttled" || s.includes("too many requests");
  });
}

export function shopifyCostFrom(json: unknown): ShopifyCost | undefined {
  if (!json || typeof json !== "object") return undefined;
  const cost = (json as any)?.extensions?.cost;
  if (!cost || typeof cost !== "object") return undefined;
  return cost as ShopifyCost;
}

export function backoffMsFromThrottle(json: unknown, attempt: number, retryAfterHeader?: string | null): number {
  const ra = Number(retryAfterHeader ?? "");
  if (Number.isFinite(ra) && ra > 0) {
    return Math.min(Math.round(ra * 1000), MAX_BACKOFF_MS);
  }
  const cost = shopifyCostFrom(json);
  const available = Number(cost?.throttleStatus?.currentlyAvailable ?? NaN);
  const restore = Number(cost?.throttleStatus?.restoreRate ?? NaN);
  const requested = Number(cost?.requestedQueryCost ?? NaN);
  if (Number.isFinite(available) && Number.isFinite(restore) && restore > 0 && Number.isFinite(requested) && available < requested) {
    const waitSec = Math.ceil((requested - available) / restore);
    return Math.min(Math.max(waitSec, 1) * 1000, MAX_BACKOFF_MS);
  }
  const stepped = [400, 1000, 2000][Math.min(attempt, 2)] ?? 2000;
  return Math.min(stepped, MAX_BACKOFF_MS);
}

export function waitMsForNextPage(json: unknown): number {
  const cost = shopifyCostFrom(json);
  const available = Number(cost?.throttleStatus?.currentlyAvailable ?? NaN);
  const restore = Number(cost?.throttleStatus?.restoreRate ?? NaN);
  const requested = Number(cost?.requestedQueryCost ?? NaN);
  if (!Number.isFinite(available) || !Number.isFinite(restore) || restore <= 0) return 0;
  const need = Number.isFinite(requested) && requested > 0 ? requested : 50;
  if (available >= need) return 0;
  const waitSec = Math.ceil((need - available) / restore);
  return Math.min(Math.max(waitSec, 1) * 400, MAX_BACKOFF_MS);
}

function jsonFromThrown(error: unknown): ShopifyGraphqlJson {
  if (!error || typeof error !== "object") return {};
  const rec = error as Record<string, unknown>;
  const body = rec.body;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (b.data || b.errors || b.extensions) return b as ShopifyGraphqlJson;
    if (b.errors && typeof b.errors === "object" && (b.errors as any).graphQLErrors) {
      return {
        errors: (b.errors as any).graphQLErrors,
        extensions: (b.extensions as ShopifyGraphqlJson["extensions"]) ?? undefined,
        data: b.data,
      };
    }
  }
  return { errors: [{ message: text((error as Error).message) }] };
}

export async function adminGraphqlJson(params: {
  admin: ShopifyGraphqlClient;
  query: string;
  variables?: Record<string, unknown>;
  maxRetries?: number;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<{ json: ShopifyGraphqlJson; throttled: boolean; httpStatus: number }> {
  const maxRetries = Math.max(0, Math.min(params.maxRetries ?? 2, MAX_RETRY_ATTEMPTS - 1));
  const sleepFn = params.sleepFn ?? sleep;
  let throttled = false;
  let lastJson: ShopifyGraphqlJson = {};
  let lastStatus = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await params.admin.graphql(params.query, {
        variables: params.variables,
      });
      lastStatus = Number(resp?.status ?? 200);
      const json: ShopifyGraphqlJson =
        resp && typeof resp.json === "function" ? await resp.json() : resp && typeof resp === "object" ? resp : {};
      lastJson = json;
      const retryAfter =
        typeof resp?.headers?.get === "function" ? resp.headers.get("retry-after") : null;
      if (isShopifyThrottled(json, lastStatus)) {
        throttled = true;
        if (attempt === maxRetries) break;
        await sleepFn(backoffMsFromThrottle(json, attempt, retryAfter));
        continue;
      }
      return { json, throttled: false, httpStatus: lastStatus };
    } catch (error) {
      if (!isShopifyThrottled(error)) throw error;
      throttled = true;
      lastJson = jsonFromThrown(error);
      const retryAfter =
        error && typeof error === "object"
          ? String((error as any)?.headers?.["retry-after"] ?? (error as any)?.headers?.["Retry-After"] ?? "") || null
          : null;
      if (attempt === maxRetries) break;
      await sleepFn(backoffMsFromThrottle(lastJson, attempt, retryAfter));
    }
  }

  return { json: lastJson, throttled: true, httpStatus: lastStatus || 429 };
}
