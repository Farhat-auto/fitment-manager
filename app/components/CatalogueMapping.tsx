import * as React from "react";
import { Banner, BlockStack, Button, Card, InlineStack, Text, TextField } from "@shopify/polaris";
import {
  CREATE_OCEAN_ARTICLE,
  DISCOVERY_EVIDENCE_LABEL,
  MAP_CATALOGUE_ARTICLE,
  MAP_THIS_ARTICLE,
  MAPPING_MAPPED_LABEL,
  MAPPING_REQUIRED_DETAIL,
  MAPPING_REQUIRED_LABEL,
  articleCreatePreview,
  catalogueMappingRequired,
  structuredMpn,
} from "../ocean/identity";

type Article = {
  id: string;
  numericId: string;
  title: string;
  handle: string;
  vendor: string;
  sku: string;
  barcode: string;
  mpn: string;
  articleNumber?: string;
  oeReferences?: string[];
  variantId: string;
  variantNumericId: string;
};

type Classification = {
  category?: { value?: string; label?: string };
  systemGroup?: { value?: string; label?: string };
  subcategory?: { value?: string; label?: string };
};

type Candidate = {
  ocean_article_id?: string;
  sku?: string;
  brand?: string;
  mpn?: string;
  article_number?: string;
  description?: string;
  oe_references?: string[];
  classification?: { category?: string; system_group?: string; subcategory?: string };
  fitment_count?: number;
  mapping_reason?: string;
  evidence_kind?: string;
  discovery_only?: boolean;
};

type Listing = {
  ok?: boolean;
  error?: string;
  unmapped?: boolean;
  catalogue_mapped?: boolean;
  catalogue_mapping_label?: string;
  article?: {
    ocean_article_id?: string;
    sku?: string;
    brand?: string;
    mpn?: string;
    article_number?: string;
    name?: string;
  };
  mapping?: {
    ocean_article_id?: string;
    mapping_method?: string;
    mapped_at?: string;
    mapped_by?: string;
    verified_fitment?: boolean;
  };
};

async function shopifySessionHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { accept: "application/json" };
  try {
    const bridge = (globalThis as { shopify?: { idToken?: () => Promise<string> } }).shopify;
    const token = bridge?.idToken ? await bridge.idToken() : "";
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // App Bridge token is optional when the Remix session cookie is already present.
  }
  return headers;
}

function qs(params: Record<string, string | undefined>) {
  return Object.keys(params)
    .filter((key) => params[key])
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key])))
    .join("&");
}

function classificationPath(classification?: Classification) {
  return [classification?.category?.label, classification?.systemGroup?.label, classification?.subcategory?.label]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" → ");
}

export function CatalogueMappingCard({
  article,
  listing,
  classification,
  identity,
  onMapped,
}: {
  article: Article;
  listing: Listing;
  classification?: Classification;
  identity: Record<string, unknown>;
  onMapped: (payload: Listing) => void;
}) {
  const mappingRequired = catalogueMappingRequired(listing as Record<string, unknown>);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [createStep, setCreateStep] = React.useState<"form" | "confirm">("form");
  const preview = React.useMemo(
    () => articleCreatePreview(article, classification),
    [article, classification],
  );
  const [brand, setBrand] = React.useState(preview.brand);
  const [sku, setSku] = React.useState(preview.sku);
  const [articleNumber, setArticleNumber] = React.useState(preview.article_number);
  const mpn = structuredMpn({ mpn: article.mpn, title: article.title, product: { mpn: article.mpn, title: article.title } });
  const [oeText, setOeText] = React.useState((preview.oe_references || []).join("\n"));

  React.useEffect(() => {
    setBrand(preview.brand);
    setSku(preview.sku);
    setArticleNumber(preview.article_number);
    setOeText((preview.oe_references || []).join("\n"));
    setCreateStep("form");
  }, [preview, article.numericId]);

  const searchCandidates = React.useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const query = qs({
        shopify_product_id: article.numericId,
        shopify_variant_id: article.variantNumericId,
        sku: article.sku,
        brand: article.vendor,
        mpn: article.mpn,
        article_number: article.articleNumber,
        oe_references: (article.oeReferences || []).join(","),
      });
      const res = await fetch("/api/ocean/article-candidates?" + query, {
        credentials: "include",
        headers: await shopifySessionHeaders(),
      });
      const payload = await res.json();
      setCandidates(payload.candidates || []);
      if (payload.ok === false && payload.error && payload.error !== "unmapped") {
        setError(String(payload.error));
      }
    } catch (err) {
      setCandidates([]);
      setError(String((err as Error)?.message || err));
    }
    setBusy(false);
  }, [article]);

  React.useEffect(() => {
    if (open && mappingRequired) searchCandidates();
  }, [open, mappingRequired, searchCandidates]);

  const mapCandidate = async (candidate: Candidate) => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/ocean/article-map", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...(await shopifySessionHeaders()) },
      body: JSON.stringify({
        ...identity,
        ocean_article_id: candidate.ocean_article_id || candidate.sku,
        mapping_evidence: candidate.mapping_reason,
        confirm: true,
      }),
    });
    const payload = await res.json();
    setBusy(false);
    if (!payload || payload.ok === false || payload.confirmation_required) {
      setError(payload?.error || "Could not map catalogue article.");
      return;
    }
    setOpen(false);
    onMapped(payload);
  };

  const createArticle = async () => {
    if (createStep !== "confirm") {
      setCreateStep("confirm");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/ocean/article-create", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...(await shopifySessionHeaders()) },
      body: JSON.stringify({
        ...identity,
        sku,
        brand,
        mpn,
        article_number: articleNumber,
        oe_references: oeText.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
        classification: preview.classification,
        shopify_product_id: article.numericId,
        shopify_variant_id: article.variantNumericId,
        confirm: true,
      }),
    });
    const payload = await res.json();
    setBusy(false);
    if (!payload || payload.ok === false || payload.confirmation_required) {
      setError(payload?.error || "Could not create Ocean article.");
      return;
    }
    setOpen(false);
    onMapped(payload);
  };

  const mappedArticle = listing.article || {};
  const mappedId = mappedArticle.ocean_article_id || mappedArticle.sku || listing.mapping?.ocean_article_id || "";

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Catalogue Mapping
          </Text>
          <Text as="p" variant="bodySm">
            Status: {mappingRequired ? "Mapping required" : "Mapped"}
          </Text>
        </InlineStack>
        {mappingRequired ? (
          <Banner tone="warning" title={MAPPING_REQUIRED_LABEL}>
            <p>{MAPPING_REQUIRED_DETAIL}</p>
            <p>This mapping is not VERIFIED vehicle fitment.</p>
          </Banner>
        ) : (
          <Banner tone="success" title={MAPPING_MAPPED_LABEL}>
            <p>
              ✓ Mapped to Ocean Article {mappedId || "—"}
              {mappedArticle.brand ? ` · ${mappedArticle.brand}` : ""}
              {mappedArticle.sku ? ` · ${mappedArticle.sku}` : ""}
            </p>
            <p>Mapping is not VERIFIED vehicle fitment.</p>
          </Banner>
        )}
        {mappingRequired ? (
          <InlineStack gap="200">
            <Button variant="primary" onClick={() => setOpen(true)}>
              {MAP_CATALOGUE_ARTICLE}
            </Button>
          </InlineStack>
        ) : null}

        {open && mappingRequired ? (
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              Find existing Ocean article
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Search uses structured evidence only: Shopify product ID, variant ID, exact SKU,
              Brand + MPN when MPN exists, article number, then OE references as {DISCOVERY_EVIDENCE_LABEL}.
              Title is never identity. No candidate is mapped until you confirm.
            </Text>
            <InlineStack gap="200">
              <Button onClick={searchCandidates} loading={busy}>
                Search existing articles
              </Button>
            </InlineStack>
            {candidates.length ? (
              candidates.map((row) => (
                <BlockStack key={row.ocean_article_id || row.sku} gap="100">
                  <Text as="p" variant="bodyMd">
                    Ocean article {row.ocean_article_id || row.sku}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Brand {row.brand || "—"} · MPN {row.mpn || "—"} · SKU {row.sku || "—"} · Article{" "}
                    {row.article_number || "—"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {row.description || "No description"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    OE {(row.oe_references || []).join(", ") || "—"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Classification {[row.classification?.category, row.classification?.system_group, row.classification?.subcategory]
                      .filter(Boolean)
                      .join(" → ") || "—"}
                    {" · "}Fitment {row.fitment_count || 0} vehicles
                  </Text>
                  <Text as="p" variant="bodySm">
                    {row.discovery_only ? `${DISCOVERY_EVIDENCE_LABEL}: ` : "Evidence: "}
                    {row.mapping_reason}
                  </Text>
                  <Button loading={busy} onClick={() => mapCandidate(row)}>
                    {MAP_THIS_ARTICLE}
                  </Button>
                </BlockStack>
              ))
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">
                No legitimate existing Ocean article matched this Shopify identity. You can create one.
              </Text>
            )}

            <Text as="h3" variant="headingSm">
              {CREATE_OCEAN_ARTICLE}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Pre-filled from structured Shopify fields only. MPN stays blank when Shopify MPN is
              missing. Digits in the display title are not copied.
            </Text>
            <TextField label="Brand" value={brand} autoComplete="off" onChange={setBrand} />
            <TextField label="SKU" value={sku} autoComplete="off" onChange={setSku} />
            <TextField
              label="Article number"
              value={articleNumber}
              autoComplete="off"
              onChange={setArticleNumber}
            />
            <TextField
              label="MPN"
              value={mpn}
              autoComplete="off"
              disabled
              helpText="Structured Shopify MPN only. Title is never used to fill this field."
              onChange={() => undefined}
            />
            <TextField
              label="OE references"
              value={oeText}
              multiline={4}
              autoComplete="off"
              helpText="Structured OE fields. Overlap is discovery evidence, not verified fitment."
              onChange={setOeText}
            />
            <Text as="p" variant="bodySm">
              Classification: {classificationPath(classification) || "—"}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Shopify product ID {article.numericId || "—"} · variant {article.variantNumericId || "—"}
            </Text>
            {createStep === "confirm" ? (
              <Banner tone="warning" title="Confirm create">
                <p>
                  This will create Ocean article {sku || "—"} and map Shopify product {article.numericId}.
                  It will not create vehicle fitment and will not mark compatibility VERIFIED.
                </p>
              </Banner>
            ) : null}
            <InlineStack gap="200">
              <Button variant="primary" loading={busy} onClick={createArticle}>
                {createStep === "confirm" ? "Confirm create and map" : CREATE_OCEAN_ARTICLE}
              </Button>
              <Button
                onClick={() => {
                  setOpen(false);
                  setCreateStep("form");
                }}
              >
                Cancel
              </Button>
            </InlineStack>
          </BlockStack>
        ) : null}
        {error ? (
          <Banner tone="critical" title="Catalogue mapping">
            {error}
          </Banner>
        ) : null}
      </BlockStack>
    </Card>
  );
}
