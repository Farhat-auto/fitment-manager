import * as React from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import {
  MAPPING_REQUIRED_DETAIL,
  MAPPING_REQUIRED_LABEL,
  UNVERIFIED,
  canonicalOceanVehicleId,
  catalogueMappingRequired,
  isOperationalOceanError,
  listingBelongsTo,
  resetProductScreen,
  storefrontLabel,
} from "../ocean/identity";

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
  match?: string | null;
  sources?: Array<{ id: string; label: string }>;
  verification_statuses?: string[];
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
  variantId: string;
  variantNumericId: string;
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

function vehicleLabel(row: VehicleRow, fallback = "") {
  return (
    row.checkbox_label ||
    row.customer_label ||
    row.detail ||
    row.title ||
    `${row.make_name || ""} ${row.model_name || ""} ${row.engine || ""}`.trim() ||
    fallback
  );
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

export function CarFitmentPanel({ article, initialListing }: { article: Article; initialListing: Listing }) {
  const [listing, setListing] = React.useState<Listing>(initialListing || { fitments: [], count: 0 });
  const [view, setView] = React.useState<"list" | "add" | "bulk" | "import" | "edit">("list");
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
  const [engineId, setEngineId] = React.useState("");
  const [skipGeneration, setSkipGeneration] = React.useState(true);
  const [checked, setChecked] = React.useState<Record<string, boolean>>({});
  const [editing, setEditing] = React.useState<VehicleRow | null>(null);
  const [source, setSource] = React.useState("manual");
  const [verification, setVerification] = React.useState(UNVERIFIED);
  const [position, setPosition] = React.useState("");
  const [side, setSide] = React.useState("");
  const [note, setNote] = React.useState("");
  const [importText, setImportText] = React.useState("");

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
    setPosition("");
    setSide("");
    setNote("");
    setMakeId("");
    setModelId("");
    setGenerationId("");
    setEngineId("");
    setModels([]);
    setGenerations([]);
    setEngines([]);
    setSkipGeneration(true);
    setView("list");
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
        setError(payload?.error || "Could not update car fitment.");
        return payload;
      }
      if (!listingBelongsTo(payload, identity)) {
        setError("stale product payload ignored");
        return payload;
      }
      setListing(payload);
      setStatus("Vehicle compatibility updated.");
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
    setEngineId("");
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
    setEngineId("");
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
    setEngineId("");
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
    const fromSelect = engineId ? engines.filter((row) => oceanVehicleId(row) === engineId) : [];
    const merged = new Map<string, VehicleRow>();
    for (const row of [...fromHits, ...fromEngines, ...fromSelect]) {
      const key = oceanVehicleId(row);
      if (key) merged.set(key, row);
    }
    return Array.from(merged.values());
  }, [engines, checked, engineId, hits]);

  const addIds = selectedEngines.map((row) => oceanVehicleId(row)).filter(Boolean);
  const mappingRequired = catalogueMappingRequired(listing);
  const operationalError = isOperationalOceanError(error) ? error : "";
  const oeReferences = (article.oeReferences || []).filter(Boolean);

  const addSelected = async () => {
    if (!addIds.length || mappingRequired) return;
    const payload = await mutate({
      action: "add",
      vehicle_ids: addIds,
      ocean_vehicle_ids: addIds,
      source,
      verification_status: verification,
      position,
      side,
      fitment_note: note,
    });
    if (payload && payload.ok !== false) {
      setView("list");
      setChecked({});
      setEngineId("");
    }
  };

  const importRows = async () => {
    if (mappingRequired) return;
    const payload = await mutate({
      action: "import",
      content: importText,
      source: source || "catalogue_import",
      verification_status: verification,
    });
    if (payload && payload.ok !== false) {
      setView("list");
      setImportText("");
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const payload = await mutate({
      action: "update",
      fitment_id: editing.id,
      source,
      verification_status: verification,
      position,
      side,
      fitment_note: note,
    });
    if (payload && payload.ok !== false) {
      setEditing(null);
      setView("list");
    }
  };

  const openPicker = (next: "add" | "bulk") => {
    setChecked({});
    setEngineId("");
    setView(next);
  };

  const fitments = listing.fitments || [];
  const count = listing.count || fitments.length;
  const sources = listing.sources || [{ id: "manual", label: "Manual" }];
  const statuses = listing.verification_statuses || ["VERIFIED", "UNVERIFIED", "NEEDS_REVIEW"];

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              CAR FITMENT
            </Text>
            <Badge tone={count ? "success" : "warning"}>
              {listing.fitment_label || `Fitment: ${count} vehicles`}
            </Badge>
          </InlineStack>
          <Text as="p" variant="bodyMd">
            Identity: Shopify product {article.numericId || "—"}
            {article.variantNumericId ? ` · variant ${article.variantNumericId}` : ""}
            {article.sku ? ` · SKU ${article.sku}` : ""}
            {article.vendor ? ` · Brand ${article.vendor}` : ""}
            {article.mpn ? ` · MPN ${article.mpn}` : ""}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Structured fields: Brand {article.vendor || "—"} · MPN {article.mpn || "—"} · SKU{" "}
            {article.sku || "—"}
            {article.articleNumber ? ` · Article number ${article.articleNumber}` : " · Article number —"}
            {oeReferences.length ? ` · OE ${oeReferences.join(", ")}` : " · OE —"}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Title is display-only and is never used as identity.
          </Text>
          {mappingRequired ? (
            <Banner tone="warning" title={MAPPING_REQUIRED_LABEL}>
              <p>{MAPPING_REQUIRED_DETAIL}</p>
              <p>
                Mapping evidence on this product: SKU {article.sku || "—"}
                {article.vendor ? ` · Brand ${article.vendor}` : ""}
                {article.mpn ? ` · MPN ${article.mpn}` : " · MPN —"}
                {article.articleNumber ? ` · Article number ${article.articleNumber}` : ""}
                {oeReferences.length ? ` · OE ${oeReferences.join(", ")}` : ""}
              </p>
              <p>This does not create VERIFIED fitment.</p>
            </Banner>
          ) : null}
          {!count ? (
            <Banner tone="warning">No fitment assigned</Banner>
          ) : null}
        </BlockStack>
      </Card>

      {operationalError ? (
        <Banner tone="critical" title="CAR FITMENT">
          {operationalError}
        </Banner>
      ) : null}
      {status ? (
        <Banner tone="success" title="CAR FITMENT">
          {status}
        </Banner>
      ) : null}

      {view === "list" ? (
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200">
              <Button variant="primary" onClick={() => openPicker("add")}>
                + Add vehicle
              </Button>
              <Button onClick={() => openPicker("bulk")}>Bulk add</Button>
              <Button onClick={() => setView("import")}>Import fitment</Button>
              <Button onClick={() => setView("list")}>Manage</Button>
            </InlineStack>
            {fitments.map((row) => {
              const key = String(row.id || row.vehicle_id || row.vehicle_key);
              return (
                <BlockStack key={key} gap="100">
                  <Text as="p" variant="bodyMd">
                    ✓ {row.title || `${row.make_name || ""} ${row.model_name || ""}`.trim()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {row.detail ||
                      [row.engine, row.engine_code, row.year_range].filter(Boolean).join(" | ")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {row.source_label || row.source} · {row.verification_status} ·{" "}
                    {storefrontLabel(String(row.verification_status || ""), row.public_fits)}
                  </Text>
                  <InlineStack gap="200">
                    <Button
                      onClick={() => {
                        setEditing(row);
                        setSource(row.source || "manual");
                        setVerification(row.verification_status || UNVERIFIED);
                        setPosition(row.position || "");
                        setSide(row.side || "");
                        setNote(row.fitment_note || "");
                        setView("edit");
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
                </BlockStack>
              );
            })}
          </BlockStack>
        </Card>
      ) : null}

      {view === "add" || view === "bulk" ? (
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              Vehicle selection
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Search queries Ocean on the server. Browsing Make → Model
              {skipGeneration ? "" : " → Generation"} → Motorization filters available vehicles.
              Make and model never select motorisations automatically. Check a motorisation to select it.
            </Text>
            <TextField
              label="Search Ocean catalogue"
              value={search}
              placeholder="C-CLASS (W205), AMG C 43, engine code"
              helpText="Server-side Ocean search. Results are not loaded into a Shopify vehicle cache."
              autoComplete="off"
              onChange={runSearch}
            />
            {hits.length ? (
              <BlockStack gap="100">
                <Text as="p" variant="bodySm">
                  Search results — check to select
                </Text>
                {hits.map((row) => {
                  const key = oceanVehicleId(row);
                  if (!key) return null;
                  return (
                    <Checkbox
                      key={`search-${key}`}
                      label={vehicleLabel(row, key)}
                      checked={!!checked[key]}
                      onChange={(val) => toggleChecked(key, val)}
                    />
                  );
                })}
              </BlockStack>
            ) : null}
            <Text as="p" variant="bodySm" tone="subdued">
              Or browse by dropdown. Changing Make or Model only refreshes the motorisation list.
            </Text>
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
            {view === "add" ? (
              <Select
                label="Motorization"
                disabled={!modelId || (!skipGeneration && !generationId)}
                helpText="Selecting a motorization from this list is the only way this dropdown selects a vehicle."
                options={[
                  { label: "Select motorization", value: "" },
                  ...engines.map((row) => ({
                    label: `${row.detail || row.customer_label || row.engine || ""}`.trim(),
                    value: oceanVehicleId(row),
                  })).filter((row) => row.value),
                ]}
                value={engineId}
                onChange={setEngineId}
              />
            ) : (
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
                      label={vehicleLabel(row, key)}
                      checked={!!checked[key]}
                      onChange={(val) => toggleChecked(key, val)}
                    />
                  );
                })}
              </BlockStack>
            )}
            {engineId
              ? engines
                  .filter((row) => oceanVehicleId(row) === engineId)
                  .map((row) => (
                    <Banner key={oceanVehicleId(row)}>
                      {row.make_name} → {row.model_name}
                      {skipGeneration ? "" : ` → ${row.generation_name || ""}`} → {row.engine} →{" "}
                      {row.engine_code} → {row.year_range} → {oceanVehicleId(row)}
                    </Banner>
                  ))
              : null}
            {selectedEngines.length ? (
              <Banner tone="info" title="Selected vehicles">
                {selectedEngines.map((row) => (
                  <p key={oceanVehicleId(row)}>{vehicleLabel(row, oceanVehicleId(row))}</p>
                ))}
              </Banner>
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">
                No vehicles selected. Filtering Make/Model only lists motorisations.
              </Text>
            )}
            <Select
              label="Fitment source"
              options={sources.map((row) => ({ label: row.label, value: row.id }))}
              value={source}
              onChange={setSource}
            />
            <Select
              label="Verification"
              options={statuses.map((row) => ({ label: row.replace("_", " "), value: row }))}
              value={verification}
              onChange={setVerification}
            />
            <TextField label="Position" value={position} autoComplete="off" onChange={setPosition} />
            <TextField label="Side" value={side} autoComplete="off" onChange={setSide} />
            <TextField label="Fitment note" value={note} autoComplete="off" onChange={setNote} />
            <InlineStack gap="200">
              <Button
                variant="primary"
                loading={busy}
                disabled={!addIds.length || mappingRequired}
                onClick={addSelected}
              >
                {view === "bulk" ? `Add ${addIds.length} vehicles` : "Add compatibility"}
              </Button>
              <Button onClick={() => setView("list")}>Cancel</Button>
            </InlineStack>
            {mappingRequired ? (
              <Text as="p" variant="bodySm" tone="subdued">
                Save is disabled until this Shopify product is mapped to an Ocean catalogue article.
              </Text>
            ) : null}
          </BlockStack>
        </Card>
      ) : null}

      {view === "import" ? (
        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              One Ocean vehicle_id per line, or CSV with vehicle_id, position, side, source,
              verification_status. Descriptions are not stored as free text. Import defaults to UNVERIFIED.
            </Text>
            <TextField
              label="Vehicle IDs or CSV"
              value={importText}
              multiline={6}
              autoComplete="off"
              onChange={setImportText}
            />
            <Select
              label="Fitment source"
              options={sources.map((row) => ({ label: row.label, value: row.id }))}
              value={source}
              onChange={setSource}
            />
            <Select
              label="Verification"
              options={statuses.map((row) => ({ label: row.replace("_", " "), value: row }))}
              value={verification}
              onChange={setVerification}
            />
            <InlineStack gap="200">
              <Button variant="primary" loading={busy} disabled={!importText || mappingRequired} onClick={importRows}>
                Import fitment
              </Button>
              <Button onClick={() => setView("list")}>Cancel</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      ) : null}

      {view === "edit" && editing ? (
        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              ✓ {editing.title}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {editing.detail}
            </Text>
            <Select
              label="Fitment source"
              options={sources.map((row) => ({ label: row.label, value: row.id }))}
              value={source}
              onChange={setSource}
            />
            <Select
              label="Verification"
              options={statuses.map((row) => ({ label: row.replace("_", " "), value: row }))}
              value={verification}
              onChange={setVerification}
            />
            <TextField label="Position" value={position} autoComplete="off" onChange={setPosition} />
            <TextField label="Side" value={side} autoComplete="off" onChange={setSide} />
            <TextField label="Fitment note" value={note} autoComplete="off" onChange={setNote} />
            <InlineStack gap="200">
              <Button variant="primary" loading={busy} disabled={mappingRequired} onClick={saveEdit}>
                Save
              </Button>
              <Button onClick={() => setView("list")}>Cancel</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      ) : null}

      <Text as="p" variant="bodySm" tone="subdued">
        Only explicit Ocean product_fitment rows count. Final selected identity is ocean_vehicle_id
        (ovh-*). Title, raw catalogue.type.id and Shopify vehicle GIDs are never public identity.
        Generation is skipped when skip_generation=true. The Shopify vehicle index is not used here.
      </Text>
    </BlockStack>
  );
}
