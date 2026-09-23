/**
 * Fail-closed product identity for Fitment Manager → Ocean.
 *
 * Allowed keys, in order:
 * 1. Shopify product ID
 * 2. Shopify variant ID
 * 3. SKU
 * 4. Brand + MPN
 *
 * Product title is never an identity key. Ambiguous identity returns
 * Fitment: 0 vehicles / unmapped and must not borrow another product.
 */

export const UNVERIFIED = "UNVERIFIED";
export const NEEDS_REVIEW = "NEEDS_REVIEW";
export const VERIFIED = "VERIFIED";

export const LEGACY_TEST_PRODUCT_ID = "10746583548247";
export const LEGACY_TEST_SKU = "VEMO-V20-16-0004";

export type StableIdentity = {
  shopify_product_id: string;
  shopify_variant_id: string;
  sku: string;
  handle: string;
  brand: string;
  mpn: string;
  barcode: string;
};

export type IdentityResult =
  | { ok: true; identity: StableIdentity; title_used: false }
  | {
      ok: false;
      error: "ambiguous_identity";
      identity: StableIdentity;
      title_used: false;
      fitments: [];
      count: 0;
      fitment_label: "Fitment: 0 vehicles";
      zero_fitment: true;
      unmapped: true;
    };

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function numericId(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";
  const match = raw.match(/(\d+)\s*$/);
  return match ? match[1] : "";
}

/** Public Circosoft identity. Never raw catalogue.type.id and never a title. */
export function isCanonicalOceanVehicleId(value: unknown): boolean {
  return /^ovh-[a-z0-9]+$/i.test(text(value));
}

export function isRawOdooId(value: unknown): boolean {
  const raw = text(value);
  return Boolean(raw) && /^\d+$/.test(raw);
}

export function isShopifyMetaobjectGid(value: unknown): boolean {
  return text(value).includes("gid://shopify/Metaobject/");
}

export function canonicalOceanVehicleId(row: {
  ocean_vehicle_id?: string;
  vehicle_id?: string;
  vehicle_key?: string;
  id?: string;
  title?: string;
} | null | undefined): string {
  const candidates = [row?.ocean_vehicle_id, row?.vehicle_id, row?.vehicle_key, row?.id];
  for (const candidate of candidates) {
    if (isCanonicalOceanVehicleId(candidate)) return text(candidate);
    if (isRawOdooId(candidate) || isShopifyMetaobjectGid(candidate)) continue;
  }
  return "";
}

export function stripTitle(payload: Record<string, unknown> | null | undefined) {
  const next = { ...(payload || {}) };
  delete next.title;
  delete next.product_title;
  delete next.name;
  if (next.product && typeof next.product === "object") {
    const product = { ...(next.product as Record<string, unknown>) };
    delete product.title;
    delete product.product_title;
    delete product.name;
    next.product = product;
  }
  return next;
}

export function stableIdentity(input: Record<string, unknown> | null | undefined): IdentityResult {
  const raw = input || {};
  const product =
    raw.product && typeof raw.product === "object"
      ? (raw.product as Record<string, unknown>)
      : {};
  const identity: StableIdentity = {
    shopify_product_id: numericId(
      raw.shopify_product_id || raw.product_id || product.id || product.shopify_product_id,
    ),
    shopify_variant_id: numericId(
      raw.shopify_variant_id || raw.variant_id || product.variant_id || product.shopify_variant_id,
    ),
    sku: text(raw.sku || product.sku),
    handle: text(raw.handle || product.handle),
    brand: text(raw.brand || product.vendor || product.brand),
    mpn: text(raw.mpn || product.mpn),
    barcode: text(raw.barcode || product.barcode || product.ean),
  };
  const hasBrandMpn = Boolean(identity.brand && identity.mpn);
  if (
    !identity.shopify_product_id &&
    !identity.shopify_variant_id &&
    !identity.sku &&
    !hasBrandMpn
  ) {
    return {
      ok: false,
      error: "ambiguous_identity",
      identity,
      title_used: false,
      fitments: [],
      count: 0,
      fitment_label: "Fitment: 0 vehicles",
      zero_fitment: true,
      unmapped: true,
    };
  }
  return { ok: true, identity, title_used: false };
}

export function listingBelongsTo(
  listing: Record<string, unknown> | null | undefined,
  identity: Partial<StableIdentity>,
) {
  const row = listing || {};
  const wantedSku = text(identity.sku);
  const gotSku = text(row.sku);
  const wantedId = numericId(identity.shopify_product_id);
  const gotId = numericId(row.shopify_product_id);
  if (wantedSku && gotSku && wantedSku.toLowerCase() !== gotSku.toLowerCase()) return false;
  if (wantedId && gotId && wantedId !== gotId) return false;
  return true;
}

export function emptyListing(identity: Partial<StableIdentity> = {}, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    sku: identity.sku || "",
    shopify_product_id: identity.shopify_product_id || "",
    shopify_variant_id: identity.shopify_variant_id || "",
    fitments: [],
    count: 0,
    fitment_label: "Fitment: 0 vehicles",
    zero_fitment: true,
    unmapped: true,
    copied_fitment: false,
    title_used: false,
    stale: false,
    master: "ocean_product_fitment",
    sources: [
      { id: "manual", label: "Manual" },
      { id: "supplier", label: "Supplier" },
      { id: "manufacturer", label: "Manufacturer" },
      { id: "oe_cross_reference", label: "OE cross-reference" },
      { id: "catalogue_import", label: "Catalogue import" },
      { id: "tecdoc_authorised", label: "TecDoc-authorised source" },
      { id: "other_verified", label: "Other verified source" },
    ],
    verification_statuses: [VERIFIED, UNVERIFIED, NEEDS_REVIEW],
    ...extra,
  };
}

export function defaultVerification(action: string, requested?: string, source?: string) {
  const status = text(requested).toUpperCase().replace(/ /g, "_");
  const src = text(source).toLowerCase();
  const legacy = /^(test|legacy_test|legacy|legacy_supabase|supabase)$/.test(src);
  if (legacy && action !== "update") return UNVERIFIED;
  if (action === "import" && (!status || status === VERIFIED)) {
    if (status === NEEDS_REVIEW) return NEEDS_REVIEW;
    return UNVERIFIED;
  }
  if (action === "add" || action === "bulk") {
    if (status === VERIFIED || status === NEEDS_REVIEW || status === UNVERIFIED) return status;
    return UNVERIFIED;
  }
  if (action === "update" && (status === VERIFIED || status === NEEDS_REVIEW || status === UNVERIFIED)) {
    return status;
  }
  if (status === VERIFIED || status === NEEDS_REVIEW || status === UNVERIFIED) return status;
  return UNVERIFIED;
}

export function storefrontLabel(verificationStatus: string, publicFits?: boolean) {
  if (publicFits === true || text(verificationStatus).toUpperCase() === VERIFIED) {
    return "Fits your vehicle";
  }
  return "Compatibility not confirmed";
}

export function isLegacyTestRow(identity: Partial<StableIdentity>) {
  return (
    numericId(identity.shopify_product_id) === LEGACY_TEST_PRODUCT_ID ||
    text(identity.sku).toUpperCase() === LEGACY_TEST_SKU
  );
}

export type ScreenState = {
  productId: string;
  listing: ReturnType<typeof emptyListing>;
  search: string;
  checked: Record<string, boolean>;
  verification: string;
  source: string;
  rejectedStale?: boolean;
};

export function resetProductScreen(productId: string): ScreenState {
  return {
    productId: numericId(productId) || text(productId),
    listing: emptyListing({ shopify_product_id: numericId(productId) }),
    search: "",
    checked: {},
    verification: UNVERIFIED,
    source: "manual",
  };
}

export function acceptListing(
  screen: ScreenState,
  listing: Record<string, unknown>,
  identity: Partial<StableIdentity>,
) {
  if (!listingBelongsTo(listing, identity)) {
    return { ...screen, rejectedStale: true, listing: screen.listing };
  }
  return {
    ...screen,
    rejectedStale: false,
    listing: {
      ...emptyListing(identity),
      ...listing,
      unmapped: Number(listing.count || 0) === 0,
      copied_fitment: false,
      title_used: false,
    },
  };
}
