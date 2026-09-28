import * as React from "react";
import { Banner, BlockStack, Button, Card, Text } from "@shopify/polaris";

type Candidate = {
  ocean_article_id?: string;
  sku?: string;
  brand?: string;
  mpn?: string;
  description?: string;
  mapping_reason?: string;
  evidence_kind?: string;
  discovery_only?: boolean;
  fitment_count?: number;
};

type Preview = {
  sku?: string;
  brand?: string;
  mpn?: string;
  article_number?: string;
};

function catalogueArticleSku(preview: Preview | null, sku: string, brand: string, mpn: string) {
  const fromPreview = String(preview?.sku || "").trim();
  const fromShopify = String(sku || "").trim();
  if (fromPreview || fromShopify) return fromPreview || fromShopify;
  if (String(brand || "").trim() && String(mpn || "").trim()) return String(mpn).trim();
  return "";
}

function qs(params: Record<string, string | undefined>) {
  return Object.keys(params)
    .filter((key) => params[key])
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key])))
    .join("&");
}

async function oceanGet(path: string) {
  const res = await fetch("/api/ocean" + path);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(payload?.error || `Ocean GET ${res.status}`));
  }
  return payload;
}

async function oceanPost(path: string, body: Record<string, unknown>) {
  const res = await fetch("/api/ocean" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function CatalogueArticleLink({
  shopifyProductId,
  shopifyVariantId,
  sku,
  brand,
  mpn,
  barcode,
  handle,
  articleNumber,
  oeText,
  onLinked,
}: {
  shopifyProductId: string;
  shopifyVariantId: string;
  sku: string;
  brand: string;
  mpn: string;
  barcode: string;
  handle: string;
  articleNumber?: string;
  oeText?: string;
  onLinked: (listing: Record<string, unknown>) => void;
}) {
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [pending, setPending] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const identity = React.useMemo(
    () => ({
      shopify_product_id: shopifyProductId,
      shopify_variant_id: shopifyVariantId,
      sku,
      brand,
      mpn,
      barcode,
      handle,
    }),
    [shopifyProductId, shopifyVariantId, sku, brand, mpn, barcode, handle],
  );

  React.useEffect(() => {
    let cancelled = false;
    setPending("");
    setError("");
    oceanGet("/article-candidates?" + qs(identity))
      .then((payload) => {
        if (cancelled) return;
        setCandidates(Array.isArray(payload?.candidates) ? payload.candidates : []);
        setPreview(payload?.create_preview || null);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message || err));
      });
    return () => {
      cancelled = true;
    };
  }, [identity]);

  const catalogueSku = catalogueArticleSku(preview, sku, brand, mpn);
  const identityMatch = candidates.some((row) => !row.discovery_only);

  const apply = async (path: string, extra: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    const payload = await oceanPost(path, {
      ...identity,
      ...extra,
      confirm: true,
      mapped_by: "fitment-manager-staff",
      article_number: articleNumber || "",
      oe_references: String(oeText || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    });
    setBusy(false);
    if (!payload || payload.ok === false || payload.applied !== true) {
      if (payload?.error === "article_exists") {
        setError(`Catalogue article ${payload.ocean_article_id || catalogueSku || sku} already exists. Map that article instead of creating a new one.`);
      } else if (payload?.error === "article_not_found") {
        setError("That catalogue article was not found.");
      } else {
        setError(String(payload?.error || "Catalogue article was not linked."));
      }
      return;
    }
    setPending("");
    onLinked(payload);
  };

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">Catalogue article</Text>
        <Banner tone="warning" title="Catalogue article not linked">
          <p>
            SKU {sku || "—"} is not linked to an Ocean catalogue article, so the selected vehicles cannot be saved.
            Choose an existing article, or create one from the SKU. When the SKU is blank, the catalogue article uses the brand and MPN. The product title is not used as the article or the MPN.
          </p>
        </Banner>
        {error ? <Banner tone="critical" title="Catalogue article">{error}</Banner> : null}
        {candidates.length ? (
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">Matching catalogue articles. OE overlap is evidence only and is not applied until you confirm.</Text>
            {candidates.slice(0, 8).map((row) => {
              const id = String(row.ocean_article_id || row.sku || "");
              return (
                <BlockStack key={id} gap="100">
                  <Text as="p" variant="bodyMd">
                    {row.brand || "—"} · {id} · MPN {row.mpn || "—"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {row.mapping_reason || row.evidence_kind || "Candidate"}
                    {row.discovery_only ? " · discovery evidence, not identity" : ""}
                    {typeof row.fitment_count === "number" ? ` · ${row.fitment_count} fitments` : ""}
                  </Text>
                  {pending === `map:${id}` ? (
                    <Button variant="primary" loading={busy} onClick={() => apply("/article-map", { ocean_article_id: id })}>
                      Confirm map {id}
                    </Button>
                  ) : (
                    <Button disabled={!id || busy} onClick={() => setPending(`map:${id}`)}>
                      Use this article
                    </Button>
                  )}
                </BlockStack>
              );
            })}
          </BlockStack>
        ) : (
          <Text as="p" variant="bodySm">No catalogue article matches this SKU, Shopify id, or brand and MPN.</Text>
        )}
        <Text as="p" variant="bodySm">
          {identityMatch
            ? "This brand and MPN already match a catalogue article. Map that article. A second article is not created."
            : `Create a catalogue article for SKU ${catalogueSku || "—"}, brand ${preview?.brand || brand || "—"}, MPN ${mpn || preview?.mpn || "none"}, article number ${articleNumber || "none"}.`}
        </Text>
        {pending === "create" ? (
          <Button variant="primary" loading={busy} disabled={!catalogueSku || identityMatch} onClick={() => apply("/article-create", {})}>
            Confirm create {catalogueSku}
          </Button>
        ) : (
          <Button disabled={!catalogueSku || identityMatch || busy} onClick={() => setPending("create")}>
            Create catalogue article
          </Button>
        )}
      </BlockStack>
    </Card>
  );
}
