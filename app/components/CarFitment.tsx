import * as React from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Collapsible,
  InlineStack,
  Modal,
  Select,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import {
  UNVERIFIED,
  canonicalOceanVehicleId,
  catalogueMappingRequired,
  isOperationalOceanError,
  listingBelongsTo,
  resetProductScreen,
  storefrontLabel,
  vehicleFitmentEnabled,
} from "../ocean/identity";
import { CatalogueMappingCard } from "./CatalogueMapping";

type VehicleRow = {
  id?: string;
  vehicle_id?: string;
  vehicle_key?: string;
  ocean_vehicle_id?: string;
  title?: string;
  detail?: string;
  make_name?: string;
  model_name?: string;
  generation_name?: string;
  engine?: string;
  engine_code?: string;
  year_range?: string;
  power_kw?: string | number;
  power_hp?: string | number;
  body_type?: string;
  type_code?: string;
  checkbox_label?: string;
  customer_label?: string;
  source?: string;
  source_label?: string;
  verification_status?: string;
  public_fits?: boolean;
  position?: string;
  side?: string;
  fitment_note?: string;
};

type Listing = {
  ok?: boolean;
  error?: string;
  sku?: string;
  shopify_product_id?: string;
  fitments?: VehicleRow[];
  count?: number;
  fitment_label?: string;
  zero_fitment?: boolean;
  unmapped?: boolean;
  catalogue_mapped?: boolean;
  match?: string | null;
  sources?: Array<{ id: string; label: string }>;
  verification_statuses?: string[];
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
  };
};

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
  imageUrl?: string;
  variantId: string;
  variantNumericId: string;
};

type Classification = {
  category?: { value?: string; label?: string };
  systemGroup?: { value?: string; label?: string };
  subcategory?: { value?: string; label?: string };
};

function qs(params: Record<string, string | undefined>) {
  return Object.keys(params)
    .filter((key) => params[key])
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key])))
    .join("&");
}

function withVehicles<T extends { has_vehicles?: boolean; type_count?: number }>(rows: T[]): T[] {
  return (rows || []).filter((row) => {
    if (row.has_vehicles === false) return false;
    if (typeof row.type_count === "number" && row.type_count <= 0) return false;
    return true;
  });
}

function powerLabel(row: VehicleRow) {
  if (row.power_kw) return `${row.power_kw} kW`;
  if (row.power_hp) return `${row.power_hp} hp`;
  return "";
}

function motorisationLine(row: VehicleRow) {
  return [
    row.detail || row.customer_label || row.engine || row.title,
    row.engine_code,
    powerLabel(row),
    row.year_range,
    row.type_code || row.body_type,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" · ");
}

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

async function oceanGet(path: string) {
  const res = await fetch("/api/ocean" + path, {
    credentials: "include",
    headers: await shopifySessionHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ocean GET ${res.status} ${text}`.trim());
  }
  return res.json();
}

async function oceanPost(body: Record<string, unknown>) {
  const res = await fetch("/api/ocean/product-fitment", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...(await shopifySessionHeaders()) },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function CarFitmentPanel({
  article,
  initialListing,
  classification,
}: {
  article: Article;
  initialListing: Listing;
  classification?: Classification;
}) {
  const [listing, setListing] = React.useState<Listing>(initialListing || { fitments: [], count: 0 });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [hits, setHits] = React.useState<VehicleRow[]>([]);
  const [makes, setMakes] = React.useState<Array<{ id: string; name: string; has_vehicles?: boolean; type_count?: number }>>([]);
  const [models, setModels] = React.useState<Array<{ id: string; name?: string; title?: string; has_vehicles?: boolean; type_count?: number }>>([]);
  const [generations, setGenerations] = React.useState<Array<{ id: string; name: string; year_range?: string }>>([]);
  const [engines, setEngines] = React.useState<VehicleRow[]>([]);
  const [makeId, setMakeId] = React.useState("");
  const [modelId, setModelId] = React.useState("");
  const [generationId, setGenerationId] = React.useState("");
  const [skipGeneration, setSkipGeneration] = React.useState(true);
  const [checked, setChecked] = React.useState<Record<string, boolean>>({});
  const [editing, setEditing] = React.useState<VehicleRow | null>(null);
  const [source, setSource] = React.useState("manual");
  const [verification, setVerification] = React.useState(UNVERIFIED);
  const [importText, setImportText] = React.useState("");
  const [confirmSave, setConfirmSave] = React.useState(false);
  const [confirmBulk, setConfirmBulk] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [showDiagnostics, setShowDiagnostics] = React.useState(false);

  const identity = React.useMemo(
    () => ({
      shopify_product_id: article.numericId,
      shopify_variant_id: article.variantNumericId,
      sku: article.sku,
      handle: article.handle,
      product: {
        id: article.id,
        sku: article.sku,
        handle: article.handle,
        barcode: article.barcode,
        vendor: article.vendor,
        variant_id: article.variantId,
        mpn: article.mpn,
      },
    }),
    [article],
  );

  const reset = React.useCallback(() => {
    const blank = resetProductScreen(article.numericId);
    setListing(initialListing || blank.listing);
    setChecked({});
    setHits([]);
    setSearch("");
    setEditing(null);
    setError("");
    setStatus("");
    setImportText("");
    setSource("manual");
    setVerification(UNVERIFIED);
    setMakeId("");
    setModelId("");
    setGenerationId("");
    setModels([]);
    setGenerations([]);
    setEngines([]);
    setSkipGeneration(true);
    setConfirmSave(false);
    setConfirmBulk(false);
  }, [article.numericId, initialListing]);

  React.useEffect(() => {
    reset();
    oceanGet("/makes?has_vehicles=1")
      .then((payload) => setMakes(withVehicles(payload.makes || [])))
      .catch((err) => setError(String(err?.message || err)));
    // Isolation: changing Shopify product ID wipes listing/search/checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.numericId]);

  const mutate = React.useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError("");
      setStatus("");
      const payload = await oceanPost({ ...identity, ...body });
      setBusy(false);
      if (!payload || payload.ok === false) {
        if (catalogueMappingRequired(payload)) {
          setListing((current) => ({ ...current, ...payload, unmapped: true, count: current.count || 0 }));
          setError("");
          return payload;
        }
        setError(payload?.error || "Could not update fitment.");
        return payload;
      }
      if (!listingBelongsTo(payload, identity)) {
        setError("stale product payload ignored");
        return payload;
      }
      setListing(payload);
      setStatus("Vehicle compatibility saved.");
      return payload;
    },
    [identity],
  );

  const oceanVehicleId = (row: VehicleRow) => canonicalOceanVehicleId(row);

  const toggleChecked = (key: string, val: boolean) => {
    setChecked((current) => {
      const next = { ...current };
      if (val) next[key] = true;
      else delete next[key];
      return next;
    });
  };

  const onMake = async (value: string) => {
    setMakeId(value);
    setModelId("");
    setGenerationId("");
    setModels([]);
    setGenerations([]);
    setEngines([]);
    setSkipGeneration(true);
    setChecked({});
    if (!value) return;
    const payload = await oceanGet("/models?" + qs({ make_id: value, has_vehicles: "1" }));
    setModels(withVehicles(payload.models || []));
  };

  const onModel = async (value: string) => {
    setModelId(value);
    setGenerationId("");
    setGenerations([]);
    setEngines([]);
    setChecked({});
    if (!value || !makeId) return;
    const gens = await oceanGet("/generations?" + qs({ make_id: makeId, model_id: value }));
    const skip = Boolean(gens.skip_generation) || !(gens.generations || []).length;
    setSkipGeneration(skip);
    setGenerations(gens.generations || []);
    if (!skip) return;
    const payload = await oceanGet("/engines?" + qs({ make_id: makeId, model_id: value }));
    setEngines((payload.engines || payload.types || []).filter((row: VehicleRow) => Boolean(canonicalOceanVehicleId(row))));
  };

  const onGeneration = async (value: string) => {
    setGenerationId(value);
    setChecked({});
    if (!value || !makeId || !modelId) return;
    const payload = await oceanGet(
      "/engines?" + qs({ make_id: makeId, model_id: modelId, generation_id: value }),
    );
    setEngines((payload.engines || payload.types || []).filter((row: VehicleRow) => Boolean(canonicalOceanVehicleId(row))));
  };

  const runSearch = async (value: string) => {
    setSearch(value);
    if (!value || value.trim().length < 2) {
      setHits([]);
      return;
    }
    const payload = await oceanGet("/vehicle-search?q=" + encodeURIComponent(value));
    setHits((payload.results || []).filter((row: VehicleRow) => Boolean(canonicalOceanVehicleId(row))));
  };

  const selectedEngines = React.useMemo(() => {
    const fromHits = hits.filter((row) => checked[oceanVehicleId(row)]);
    const fromEngines = engines.filter((row) => checked[oceanVehicleId(row)]);
    const merged = new Map<string, VehicleRow>();
    for (const row of [...fromHits, ...fromEngines]) {
      const key = oceanVehicleId(row);
      if (key) merged.set(key, row);
    }
    return Array.from(merged.values());
  }, [engines, checked, hits]);

  const addIds = selectedEngines.map((row) => oceanVehicleId(row)).filter(Boolean);
  const mappingRequired = catalogueMappingRequired(listing);
  const fitmentEnabled = vehicleFitmentEnabled(listing);
  const operationalError = isOperationalOceanError(error) ? error : "";
  const oeReferences = (article.oeReferences || []).filter(Boolean);
  const fitments = listing.fitments || [];
  const count = listing.count || fitments.length;
  const classificationPath = [classification?.category?.label, classification?.systemGroup?.label, classification?.subcategory?.label]
    .filter(Boolean)
    .join(" → ");

  const saveFitment = async () => {
    if (!addIds.length || mappingRequired) return;
    const payload = await mutate({
      action: "add",
      vehicle_ids: addIds,
      ocean_vehicle_ids: addIds,
      source,
      verification_status: UNVERIFIED,
    });
    if (payload && payload.ok !== false) {
      setChecked({});
      setConfirmSave(false);
    }
  };

  const importRows = async () => {
    if (mappingRequired) return;
    const payload = await mutate({
      action: "import",
      content: importText,
      source: source || "catalogue_import",
      verification_status: UNVERIFIED,
    });
    if (payload && payload.ok !== false) {
      setImportText("");
    }
  };

  const selectAllFiltered = () => {
    const next: Record<string, boolean> = {};
    for (const row of engines) {
      const key = oceanVehicleId(row);
      if (key) next[key] = true;
    }
    setChecked(next);
    setConfirmBulk(false);
  };

  return (
    <BlockStack gap="400">
      <Card>
        <InlineStack gap="300" blockAlign="center">
          <Thumbnail
            source={article.imageUrl || "https://cdn.shopify.com/static/images/placeholders/product-1.png"}
            alt={article.title || article.sku || article.numericId}
            size="medium"
          />
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              {article.title || article.sku || "Product"}
            </Text>
            <Text as="p" variant="bodySm">
              {article.vendor || "—"} · SKU {article.sku || "—"} · Article {article.articleNumber || "—"} · MPN{" "}
              {article.mpn || "—"}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              OE {oeReferences.length ? oeReferences.join(", ") : "—"}
            </Text>
            {classificationPath ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {classificationPath}
              </Text>
            ) : null}
            <InlineStack gap="200">
              <Badge tone={mappingRequired ? "warning" : "success"}>
                {mappingRequired ? "No article mapped" : "Article mapped"}
              </Badge>
              <Badge tone={count ? "success" : "warning"}>{`Fitment: ${count} vehicles`}</Badge>
            </InlineStack>
          </BlockStack>
        </InlineStack>
      </Card>

      <CatalogueMappingCard
        article={article}
        listing={listing}
        classification={classification}
        identity={identity}
        onMapped={(payload) => {
          setListing(payload as Listing);
          setStatus("Article mapped. Select vehicles below.");
        }}
      />

      {operationalError ? (
        <Banner tone="critical" title="CAR FITMENT">
          {operationalError}
        </Banner>
      ) : null}
      {status ? (
        <Banner tone="success">{status}</Banner>
      ) : null}

      {fitmentEnabled ? (
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Vehicle Compatibility
              </Text>
              <Badge>{`Fitment: ${count} vehicles`}</Badge>
            </InlineStack>
            {fitments.map((row) => {
              const key = String(row.id || row.vehicle_id || row.vehicle_key);
              return (
                    <InlineStack key={key} align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd">
                      {row.title || `${row.make_name || ""} ${row.model_name || ""}`.trim()}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {[row.engine_code, powerLabel(row), row.year_range].filter(Boolean).join(" · ")}
                      {" · "}
                      {storefrontLabel(String(row.verification_status || ""), row.public_fits)}
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200">
                    <Button
                      onClick={() => {
                        setEditing(row);
                        setSource(row.source || "manual");
                        setVerification(row.verification_status || UNVERIFIED);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      tone="critical"
                      disabled={busy}
                      onClick={() => mutate({ action: "remove", fitment_id: row.id, vehicle_id: row.vehicle_id })}
                    >
                      Remove
                    </Button>
                  </InlineStack>
                </InlineStack>
              );
            })}

            <TextField
              label="Search"
              value={search}
              placeholder="Search make, model, engine, chassis..."
              autoComplete="off"
              onChange={runSearch}
            />
            {hits.length ? (
              <BlockStack gap="100">
                {hits.map((row) => {
                  const key = oceanVehicleId(row);
                  if (!key) return null;
                  return (
                    <Checkbox
                      key={`search-${key}`}
                      label={motorisationLine(row)}
                      checked={!!checked[key]}
                      onChange={(val) => toggleChecked(key, val)}
                    />
                  );
                })}
              </BlockStack>
            ) : null}

            <Select
              label="Make"
              options={[{ label: "Select make", value: "" }, ...makes.map((row) => ({ label: row.name, value: row.id }))]}
              value={makeId}
              onChange={onMake}
            />
            <Select
              label="Model"
              disabled={!makeId}
              options={[
                { label: "Select model", value: "" },
                ...models.map((row) => ({ label: row.name || row.title || row.id, value: row.id })),
              ]}
              value={modelId}
              onChange={onModel}
            />
            {!skipGeneration ? (
              <Select
                label="Generation"
                disabled={!modelId}
                options={[
                  { label: "Select generation", value: "" },
                  ...generations.map((row) => ({
                    label: `${row.name}${row.year_range ? " " + row.year_range : ""}`,
                    value: row.id,
                  })),
                ]}
                value={generationId}
                onChange={onGeneration}
              />
            ) : null}

            {engines.length ? (
              <BlockStack gap="100">
                <Text as="p" variant="bodySm">
                  Motorization — filtered list, none selected until checked
                </Text>
                {engines.map((row) => {
                  const key = oceanVehicleId(row);
                  if (!key) return null;
                  return (
                    <Checkbox
                      key={`engine-${key}`}
                      label={motorisationLine(row)}
                      checked={!!checked[key]}
                      onChange={(val) => toggleChecked(key, val)}
                    />
                  );
                })}
                {engines.length > 1 ? (
                  <Button onClick={() => setConfirmBulk(true)}>
                    {`Select all ${engines.length} motorisations`}
                  </Button>
                ) : null}
              </BlockStack>
            ) : null}

            {selectedEngines.length ? (
              <Banner tone="info" title={`Selected vehicles (${selectedEngines.length})`}>
                {selectedEngines.map((row) => {
                  const key = oceanVehicleId(row);
                  return (
                    <InlineStack key={key} gap="200" blockAlign="center">
                      <Text as="p" variant="bodySm">
                        {motorisationLine(row)}
                      </Text>
                      <Button onClick={() => toggleChecked(key, false)}>Remove</Button>
                    </InlineStack>
                  );
                })}
              </Banner>
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">
                No vehicles selected. Choosing a make or model only filters the list.
              </Text>
            )}

            <InlineStack gap="200">
              <Button
                variant="primary"
                loading={busy}
                disabled={!addIds.length || mappingRequired}
                onClick={() => setConfirmSave(true)}
              >
                Save Fitment
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      ) : null}

      {fitmentEnabled ? (
        <Card>
          <BlockStack gap="200">
            <Button onClick={() => setShowAdvanced((value) => !value)} disclosure={showAdvanced ? "up" : "down"}>
              Advanced
            </Button>
            <Collapsible open={showAdvanced} id="car-fitment-advanced">
              <BlockStack gap="300">
                <Text as="p" variant="bodySm" tone="subdued">
                  Bulk and import are separate from ordinary selection. Import cannot skip article mapping
                  or review.
                </Text>
                <Select
                  label="Fitment source"
                  options={(listing.sources || [{ id: "manual", label: "Manual" }]).map((row) => ({
                    label: row.label,
                    value: row.id,
                  }))}
                  value={source}
                  onChange={setSource}
                />
                <TextField
                  label="Import vehicle IDs or CSV"
                  value={importText}
                  multiline={4}
                  autoComplete="off"
                  onChange={setImportText}
                />
                <Button loading={busy} disabled={!importText || mappingRequired} onClick={importRows}>
                  Import fitment
                </Button>
              </BlockStack>
            </Collapsible>
          </BlockStack>
        </Card>
      ) : null}

      {editing ? (
        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              {editing.title}
            </Text>
            <Select
              label="Fitment source"
              options={(listing.sources || [{ id: "manual", label: "Manual" }]).map((row) => ({
                label: row.label,
                value: row.id,
              }))}
              value={source}
              onChange={setSource}
            />
            <Select
              label="Review state"
              options={(listing.verification_statuses || ["VERIFIED", "UNVERIFIED", "NEEDS_REVIEW"]).map((row) => ({
                label: row.replace("_", " "),
                value: row,
              }))}
              value={verification}
              onChange={setVerification}
            />
            <InlineStack gap="200">
              <Button
                variant="primary"
                loading={busy}
                onClick={async () => {
                  await mutate({
                    action: "update",
                    fitment_id: editing.id,
                    source,
                    verification_status: verification,
                  });
                  setEditing(null);
                }}
              >
                Save
              </Button>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      ) : null}

      <Card>
        <BlockStack gap="200">
          <Button onClick={() => setShowDiagnostics((value) => !value)} disclosure={showDiagnostics ? "up" : "down"}>
            Diagnostics
          </Button>
          <Collapsible open={showDiagnostics} id="car-fitment-diagnostics">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Product {article.numericId || "—"} · variant {article.variantNumericId || "—"}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Title is display-only and is never used as identity.
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Only explicit saved compatibility counts. Unverified is not verified. OE overlap never
                creates verified fitment.
              </Text>
            </BlockStack>
          </Collapsible>
        </BlockStack>
      </Card>

      <Modal
        open={confirmSave}
        onClose={() => setConfirmSave(false)}
        title="Save Fitment"
        primaryAction={{
          content: "Confirm save",
          onAction: saveFitment,
          loading: busy,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmSave(false) }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            {`You are assigning this product to ${addIds.length} vehicle motorisations.`}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Compatibility is saved for review. It is not marked verified automatically.
          </Text>
        </Modal.Section>
      </Modal>

      <Modal
        open={confirmBulk}
        onClose={() => setConfirmBulk(false)}
        title="Select all motorisations"
        primaryAction={{
          content: "Select all",
          onAction: selectAllFiltered,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmBulk(false) }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            {`You are about to assign ${engines.length} motorisations.`}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            This only checks the boxes. Fitment is not saved until you confirm Save Fitment.
          </Text>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}
