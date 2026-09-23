import * as React from "react";
import { Banner, BlockStack, Button, Card, InlineStack, Text, TextField } from "@shopify/polaris";
import {
  CREATE_OCEAN_ARTICLE,
  MAP_THIS_ARTICLE,
  MAPPING_MAPPED_LABEL,
  MAPPING_REQUIRED_DETAIL,
  MAPPING_REQUIRED_LABEL,
  NO_MATCHING_ARTICLE,
  SUGGESTED_MATCHES,
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
  match_label?: string;
  evidence_kind?: string;
  discovery_only?: boolean;
};

type Listing = {
  ok?: boolean;
  error?: string;
  unmapped?: boolean;
  catalogue_mapped?: boolean;
  article?: {
    ocean_article_id?: string;
    sku?: string;
    brand?: string;
    mpn?: string;
    article_number?: string;
    name?: string;
  };
  mapping?: { ocean_article_id?: string };
};

async function shopifySessionHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { accept: "application/json" };
  try {
    const bridge = (globalThis as { shopify?: { idToken?: () => Promise<string> } }).shopify;
    const token = bridge?.idToken ? await bridge.idToken() : "";
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // Session cookie is enough when App Bridge token is unavailable.
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
  const [busy, setBusy] = React.useState(false);
  const [searched, setSearched] = React.useState(false);
  const [error, setError] = React.useState("");
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [showCreate, setShowCreate] = React.useState(false);
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
    setShowCreate(false);
    setSearched(false);
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
      setSearched(true);
      if (!payload.candidates || !payload.candidates.length) setShowCreate(true);
      if (payload.ok === false && payload.error && payload.error !== "unmapped") {
        setError(String(payload.error));
        setShowCreate(true);
      }
    } catch (err) {
      setCandidates([]);
      setSearched(true);
      setShowCreate(true);
      setError(String((err as Error)?.message || err));
    }
    setBusy(false);
  }, [article]);

  React.useEffect(() => {
    if (mappingRequired) searchCandidates();
  }, [mappingRequired, searchCandidates]);

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
        mapping_evidence: candidate.match_label || candidate.mapping_reason,
        confirm: true,
      }),
    });
    const payload = await res.json();
    setBusy(false);
    if (!payload || payload.ok === false || payload.confirmation_required) {
      setError(payload?.error || "Could not use this article.");
      return;
    }
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
      setError(payload?.error || "Could not create catalogue article.");
      return;
    }
    onMapped(payload);
  };

  const mappedArticle = listing.article || {};
  const mappedId = mappedArticle.ocean_article_id || mappedArticle.sku || listing.mapping?.ocean_article_id || "";

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Catalogue Article
          </Text>
          <Text as="p" variant="bodySm">
            {mappingRequired ? MAPPING_REQUIRED_LABEL : MAPPING_MAPPED_LABEL}
          </Text>
        </InlineStack>

        {!mappingRequired ? (
          <Banner tone="success" title={MAPPING_MAPPED_LABEL}>
            <p>
              {mappedArticle.brand || article.vendor} {mappedArticle.article_number || mappedArticle.sku || mappedId}
            </p>
          </Banner>
        ) : (
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" tone="subdued">
              {MAPPING_REQUIRED_DETAIL}
            </Text>
            {busy && !searched ? (
              <Text as="p" variant="bodySm">
                Searching catalogue…
              </Text>
            ) : null}
            {candidates.length ? (
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  {SUGGESTED_MATCHES}
                </Text>
                {candidates.map((row) => (
                  <BlockStack key={row.ocean_article_id || row.sku} gap="100">
                    <Text as="p" variant="bodyMd">
                      {row.brand || "—"} {row.article_number || row.sku || ""}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      MPN {row.mpn || "—"} · {row.description || "No description"}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      OE {(row.oe_references || []).join(", ") || "—"}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {[row.classification?.category, row.classification?.system_group, row.classification?.subcategory]
                        .filter(Boolean)
                        .join(" → ") || "—"}
                      {" · "}
                      {row.fitment_count || 0} vehicles
                    </Text>
                    <Text as="p" variant="bodySm">
                      Why it matched: {row.match_label || row.mapping_reason}
                      {row.discovery_only ? " (discovery only — not proof this is the same article)" : ""}
                    </Text>
                    <Button loading={busy} onClick={() => mapCandidate(row)}>
                      {MAP_THIS_ARTICLE}
                    </Button>
                  </BlockStack>
                ))}
              </BlockStack>
            ) : searched ? (
              <Banner tone="warning" title={NO_MATCHING_ARTICLE}>
                <p>Create a catalogue article from this product’s brand, SKU, article number and OE references.</p>
              </Banner>
            ) : null}

            {showCreate || searched ? (
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  {CREATE_OCEAN_ARTICLE}
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
                  helpText="Left blank when the product has no MPN. The title is not used."
                  onChange={() => undefined}
                />
                <TextField
                  label="OE references"
                  value={oeText}
                  multiline={4}
                  autoComplete="off"
                  onChange={setOeText}
                />
                <Text as="p" variant="bodySm">
                  Category: {classificationPath(classification) || "—"}
                </Text>
                {createStep === "confirm" ? (
                  <Banner tone="warning" title="Confirm create">
                    <p>
                      Create catalogue article {sku || "—"} for this product. This does not assign vehicles
                      and does not mark fitment as verified.
                    </p>
                  </Banner>
                ) : null}
                <InlineStack gap="200">
                  <Button variant="primary" loading={busy} onClick={createArticle}>
                    {createStep === "confirm" ? "Confirm create" : CREATE_OCEAN_ARTICLE}
                  </Button>
                  {createStep === "confirm" ? (
                    <Button onClick={() => setCreateStep("form")}>Back</Button>
                  ) : null}
                </InlineStack>
              </BlockStack>
            ) : null}
          </BlockStack>
        )}
        {error ? (
          <Banner tone="critical" title="Catalogue article">
            {error}
          </Banner>
        ) : null}
      </BlockStack>
    </Card>
  );
}
