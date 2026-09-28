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
  Thumbnail,
} from "@shopify/polaris";
import {
  UNVERIFIED,
  VERIFIED,
  listingBelongsTo,
  resetProductScreen,
  storefrontLabel,
} from "../ocean/identity";

type VehicleRow = {
  id?: string;
  vehicle_id?: string;
  vehicle_key?: string;
  title?: string;
  detail?: string;
  make_name?: string;
  model_name?: string;
  generation_name?: string;
  engine?: string;
  engine_code?: string;
  power_kw?: string | number;
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
  variantId: string;
  variantNumericId: string;
};

function qs(params: Record<string, string | undefined>) {
  return Object.keys(params)
    .filter((key) => params[key])
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key])))
    .join("&");
}

async function oceanGet(path: string) {
  const res = await fetch("/api/ocean" + path);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ocean GET ${res.status} ${text}`.trim());
  }
  return res.json();
}

async function oceanPost(body: Record<string, unknown>) {
  const res = await fetch("/api/ocean/product-fitment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function oceanList(path: string, keys: string[]) {
  const rows: Array<Record<string, unknown>> = [];
  let offset = 0;
  const limit = 250;
  for (let page = 0; page < 40; page += 1) {
    const joiner = path.includes("?") ? "&" : "?";
    const payload = await oceanGet(`${path}${joiner}limit=${limit}&offset=${offset}`);
    const batch = keys.map((key) => payload?.[key]).find((value) => Array.isArray(value)) || [];
    rows.push(...batch);
    if (!payload?.has_next || !batch.length) break;
    offset += batch.length;
  }
  return rows;
}

export function CarFitmentPanel({
  article,
  initialListing,
  imageUrl,
}: {
  article: Article;
  initialListing: Listing;
  imageUrl?: string;
}) {
  const [listing, setListing] = React.useState<Listing>(initialListing || { fitments: [], count: 0 });
  const [view, setView] = React.useState<"list" | "add" | "bulk" | "import" | "edit">("list");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [hits, setHits] = React.useState<VehicleRow[]>([]);
  const [makes, setMakes] = React.useState<Array<{ id: string; name: string; type_count?: number }>>([]);
  const [makesReady, setMakesReady] = React.useState(false);
  const [pickedMakes, setPickedMakes] = React.useState<string[]>([]);
  const [makeQuery, setMakeQuery] = React.useState("");
  const [modelsBusy, setModelsBusy] = React.useState(false);
  const [models, setModels] = React.useState<Array<{ id: string; name?: string; title?: string; type_count?: number; make_id?: string; make_name?: string }>>([]);
  const makesRef = React.useRef(makes);
  makesRef.current = makes;
  const modelsRef = React.useRef(models);
  modelsRef.current = models;
  const [generations, setGenerations] = React.useState<Array<{ id: string; name: string; year_range?: string }>>([]);
  const [engines, setEngines] = React.useState<VehicleRow[]>([]);
  const [pickedModels, setPickedModels] = React.useState<string[]>([]);
  const [modelQuery, setModelQuery] = React.useState("");
  const [enginesBusy, setEnginesBusy] = React.useState(false);
  const [generationId, setGenerationId] = React.useState("");
  const [engineId, setEngineId] = React.useState("");
  const [checked, setChecked] = React.useState<Record<string, boolean>>({});
  const [editing, setEditing] = React.useState<VehicleRow | null>(null);
  const [source, setSource] = React.useState("manual");
  const [verification, setVerification] = React.useState(VERIFIED);
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
    setVerification(VERIFIED);
    setPosition("");
    setSide("");
    setNote("");
    setPickedMakes([]);
    setMakeQuery("");
    setPickedModels([]);
    setModelQuery("");
    setGenerationId("");
    setEngineId("");
    setModels([]);
    setGenerations([]);
    setEngines([]);
    setView("list");
  }, [article.numericId, initialListing]);

  React.useEffect(() => {
    reset();
    setMakesReady(false);
    oceanList("/makes?has_vehicles=0", ["makes"])
      .then((rows) => {
        const next = rows.map((row) => ({
          id: String(row.id || ""),
          name: String(row.name || row.id || ""),
          type_count: Number(row.type_count || 0),
        })).filter((row) => row.id);
        next.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
        setMakes(next);
        setMakesReady(true);
      })
      .catch((err) => {
        setMakesReady(true);
        setError(String(err?.message || err));
      });
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

  React.useEffect(() => {
    let cancelled = false;
    if (!pickedMakes.length) {
      setModels([]);
      setModelsBusy(false);
      return;
    }
    setModelsBusy(true);
    const load = async () => {
      const groups: Array<Array<Record<string, unknown>>> = [];
      for (let index = 0; index < pickedMakes.length; index += 4) {
        const chunk = pickedMakes.slice(index, index + 4);
        const loaded = await Promise.all(chunk.map(async (id) => {
          const rows = await oceanList(`/models?make_id=${encodeURIComponent(id)}&has_vehicles=0`, ["models"]);
          const make = makesRef.current.find((row) => row.id === id);
          return rows.map((row) => ({
            ...row,
            id: String(row.id || ""),
            make_id: String(row.make_id || id),
            make_name: make?.name || "",
          }));
        }));
        groups.push(...loaded);
      }
      return groups.flat();
    };
    load()
      .then((rows) => {
        if (cancelled) return;
        rows.sort((left, right) => {
          const engines = Number(right.type_count || 0) - Number(left.type_count || 0);
          if (engines) return engines;
          const make = String(left.make_name || "").localeCompare(String(right.make_name || ""));
          if (make) return make;
          return String(left.name || left.title || "").localeCompare(String(right.name || right.title || ""));
        });
        const next = rows as Array<{ id: string; name?: string; title?: string; type_count?: number; make_id?: string; make_name?: string }>;
        setModels(next);
        const allowed = new Set(next.map((row) => `${row.make_id || ""}|${row.id}`));
        setPickedModels((current) => {
          const kept = current.filter((key) => allowed.has(key));
          return kept.length === current.length ? current : kept;
        });
        setModelsBusy(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setModelsBusy(false);
        setError(String(err?.message || err));
      });
    return () => {
      cancelled = true;
    };
  }, [pickedMakes]);

  const toggleMake = (id: string, on: boolean) => {
    setPickedMakes((current) => (
      on ? (current.includes(id) ? current : [...current, id]) : current.filter((item) => item !== id)
    ));
    if (!on) {
      setPickedModels((current) => current.filter((key) => !key.startsWith(`${id}|`)));
      setGenerationId("");
      setEngineId("");
      setChecked({});
    }
  };

  const toggleModel = (key: string, on: boolean) => {
    setPickedModels((current) => (
      on ? (current.includes(key) ? current : [...current, key]) : current.filter((item) => item !== key)
    ));
    setGenerationId("");
    setEngineId("");
    setChecked({});
  };

  React.useEffect(() => {
    let cancelled = false;
    if (pickedModels.length !== 1) {
      setGenerations([]);
      return;
    }
    const [make, model] = pickedModels[0].split("|");
    if (!make || !model) return;
    oceanList("/generations?" + qs({ make_id: make, model_id: model }), ["generations"])
      .then((rows) => {
        if (!cancelled) setGenerations(rows as Array<{ id: string; name: string; year_range?: string }>);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message || err));
      });
    return () => {
      cancelled = true;
    };
  }, [pickedModels]);

  React.useEffect(() => {
    let cancelled = false;
    if (!pickedModels.length) {
      setEngines([]);
      setEnginesBusy(false);
      return;
    }
    setEngines([]);
    setEnginesBusy(true);
    const generation = pickedModels.length === 1 ? generationId : "";
    const load = async () => {
      const groups: VehicleRow[][] = [];
      for (let index = 0; index < pickedModels.length; index += 4) {
        const chunk = pickedModels.slice(index, index + 4);
        const loaded = await Promise.all(chunk.map(async (key) => {
          const [make, model] = key.split("|");
          const known = modelsRef.current.find((row) => `${row.make_id || ""}|${row.id}` === key);
          const rows = await oceanList(
            "/engines?" + qs({ make_id: make, model_id: model, generation_id: generation || undefined }),
            ["engines", "types"],
          );
          return (rows as VehicleRow[]).map((row) => ({
            ...row,
            make_name: String(row.make_name || known?.make_name || ""),
            model_name: String(row.model_name || known?.name || known?.title || ""),
          }));
        }));
        groups.push(...loaded);
      }
      const seen = new Set<string>();
      const flat: VehicleRow[] = [];
      groups.flat().forEach((row) => {
        const id = String(row.vehicle_key || row.vehicle_id || row.id || "");
        if (!id || seen.has(id)) return;
        seen.add(id);
        flat.push(row);
      });
      return flat;
    };
    load()
      .then((rows) => {
        if (cancelled) return;
        setEngines(rows);
        setEnginesBusy(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setEnginesBusy(false);
        setError(String(err?.message || err));
      });
    return () => {
      cancelled = true;
    };
  }, [pickedModels, generationId]);

  const onGeneration = (value: string) => {
    setGenerationId(value);
    setEngineId("");
    setChecked({});
  };

  const runSearch = async (value: string) => {
    setSearch(value);
    if (!value || value.trim().length < 2) {
      setHits([]);
      return;
    }
    const payload = await oceanGet("/vehicle-search?q=" + encodeURIComponent(value));
    setHits(payload.results || []);
  };

  const engineKey = (row: VehicleRow) => String(row.vehicle_key || row.vehicle_id || row.id || "");

  const selectedEngines = React.useMemo(() => {
    if (view === "add" || view === "bulk") return engines.filter((row) => checked[engineKey(row)]);
    return hits.filter((row) => checked[row.vehicle_id || row.vehicle_key || row.id || ""]);
  }, [view, engines, checked, hits]);

  const addIds = selectedEngines
    .map((row) => row.vehicle_id || row.vehicle_key || row.id)
    .filter(Boolean) as string[];

  const addSelected = async () => {
    if (!addIds.length) return;
    const payload = await mutate({
      action: "add",
      vehicle_ids: addIds,
      source,
      verification_status: verification,
      position,
      side,
      fitment_note: note,
    });
    if (payload && payload.ok !== false) {
      setChecked({});
      setEngineId("");
      setStatus(`Added ${addIds.length} engine${addIds.length === 1 ? "" : "s"}. Tick more models or makes to add more.`);
    }
  };

  const importRows = async () => {
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

  const visibleMakes = makes.filter((row) => {
    const query = makeQuery.trim().toLowerCase();
    return !query || String(row.name || "").toLowerCase().includes(query);
  });
  const selectedMakeNames = pickedMakes
    .map((id) => makes.find((row) => row.id === id)?.name || id)
    .filter(Boolean);
  const visibleModels = models.filter((row) => {
    const query = modelQuery.trim().toLowerCase();
    const label = `${row.make_name || ""} ${row.name || row.title || row.id}`.toLowerCase();
    return !query || label.includes(query);
  });
  const selectedModelNames = pickedModels.map((key) => {
    const row = models.find((item) => `${item.make_id || ""}|${item.id}` === key);
    if (!row) return "";
    return `${row.make_name ? `${row.make_name} · ` : ""}${row.name || row.title || row.id}`;
  }).filter(Boolean);
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
          <InlineStack gap="300" blockAlign="center">
            <Thumbnail
              source={imageUrl || "https://cdn.shopify.com/static/images/placeholders/product-1.png"}
              alt={article.title || article.sku || "Catalogue article"}
              size="large"
            />
            <BlockStack gap="100">
              <Text as="p" variant="bodyMd">
                {article.title || "Catalogue article"}
              </Text>
              <Text as="p" variant="bodyMd">
                Brand {article.vendor || "—"} · MPN {article.mpn || "—"} · SKU {article.sku || "—"}
              </Text>
            </BlockStack>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            Shopify product {article.numericId || "unmapped"}
            {article.variantNumericId ? ` · variant ${article.variantNumericId}` : ""}
          </Text>
          {!count ? (
            <Banner tone="warning">
              Fitment: 0 vehicles. Compatibility is UNKNOWN until staff add an explicit Ocean vehicle_id.
              Title is never used as identity.
            </Banner>
          ) : null}
        </BlockStack>
      </Card>

      {error ? (
        <Banner tone="critical" title="CAR FITMENT">
          {error}
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
              <Button variant="primary" onClick={() => setView("add")}>
                + Add vehicle
              </Button>
              <Button onClick={() => setView("bulk")}>Bulk add</Button>
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
            <TextField
              label="Search vehicles"
              value={search}
              placeholder="E82 135i, N54B30A, BMW 335i 2008"
              autoComplete="off"
              onChange={runSearch}
            />
            {hits.map((row) => {
              const key = String(row.vehicle_id || row.vehicle_key || row.id);
              return (
                <Checkbox
                  key={key}
                  label={row.checkbox_label || row.title || row.customer_label || key}
                  checked={!!checked[key]}
                  onChange={(val) =>
                    setChecked((current) => {
                      const next = { ...current };
                      if (val) next[key] = true;
                      else delete next[key];
                      return next;
                    })
                  }
                />
              );
            })}
            <TextField
              label="Find a make"
              value={makeQuery}
              placeholder="Mercedes, BMW, Audi"
              autoComplete="off"
              onChange={setMakeQuery}
              helpText={`${makes.length} makes · ${pickedMakes.length} selected. Every catalogue make is listed, including makes that do not have engines yet.`}
            />
            {selectedMakeNames.length ? (
              <Text as="p" variant="bodySm">
                Selected makes: {selectedMakeNames.join(", ")}
              </Text>
            ) : null}
            <div style={{ maxHeight: 240, overflow: "auto" }}>
              <BlockStack gap="100">
                {visibleMakes.map((row) => (
                  <Checkbox
                    key={row.id}
                    label={`${row.name}${Number(row.type_count) > 0 ? ` · ${row.type_count} engines` : ""}`}
                    checked={pickedMakes.includes(row.id)}
                    onChange={(value) => toggleMake(row.id, value)}
                  />
                ))}
              </BlockStack>
            </div>
            {!makesReady ? <Text as="p" variant="bodySm">Loading makes…</Text> : null}
            {makesReady && !makes.length ? <Text as="p" variant="bodySm">No makes were returned.</Text> : null}
            {makes.length && !visibleMakes.length ? (
              <Text as="p" variant="bodySm">No make matches that name.</Text>
            ) : null}
            {modelsBusy ? <Text as="p" variant="bodySm">Loading models for the selected makes…</Text> : null}
            <TextField
              label="Find a model"
              value={modelQuery}
              placeholder="Defender, Range Rover, Discovery"
              autoComplete="off"
              disabled={!pickedMakes.length}
              onChange={setModelQuery}
              helpText={pickedMakes.length
                ? `${models.length} models · ${pickedModels.length} selected. Tick every model this article fits.`
                : "Select one or more makes first."}
            />
            {selectedModelNames.length ? (
              <Text as="p" variant="bodySm">
                Selected models: {selectedModelNames.join(", ")}
              </Text>
            ) : null}
            <div style={{ maxHeight: 240, overflow: "auto" }}>
              <BlockStack gap="100">
                {visibleModels.map((row) => {
                  const key = `${row.make_id || ""}|${row.id}`;
                  const engines = Number(row.type_count) > 0 ? ` · ${row.type_count} engines` : " · no engines";
                  return (
                    <Checkbox
                      key={key}
                      label={`${row.make_name ? `${row.make_name} · ` : ""}${row.name || row.title || row.id}${engines}`}
                      checked={pickedModels.includes(key)}
                      onChange={(value) => toggleModel(key, value)}
                    />
                  );
                })}
              </BlockStack>
            </div>
            {pickedMakes.length && !modelsBusy && !models.length ? (
              <Text as="p" variant="bodySm">No models were returned for the selected makes.</Text>
            ) : null}
            {models.length && !visibleModels.length ? (
              <Text as="p" variant="bodySm">No model matches that name.</Text>
            ) : null}
            <Select
              label="Generation"
              disabled={pickedModels.length !== 1}
              helpText={pickedModels.length > 1
                ? "Several models are selected, so every engine for those models is listed."
                : "Optional. Choose a generation when one model is selected."}
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
            {enginesBusy ? <Text as="p" variant="bodySm">Loading engines for the selected models…</Text> : null}
            <InlineStack gap="200">
              <Button
                disabled={!engines.length}
                onClick={() =>
                  setChecked((current) => {
                    const next = { ...current };
                    engines.forEach((row) => {
                      const key = engineKey(row);
                      if (key) next[key] = true;
                    });
                    return next;
                  })
                }
              >
                Select all engines
              </Button>
              <Button disabled={!engines.length} onClick={() => setChecked({})}>
                Clear engines
              </Button>
            </InlineStack>
            {engines.map((row) => {
              const key = engineKey(row);
              const prefix = [row.make_name, row.model_name].filter(Boolean).join(" · ");
              const detail = [
                row.engine_code,
                row.power_kw ? `${row.power_kw} kW` : "",
                row.year_range,
                row.detail || row.customer_label || row.engine,
              ]
                .filter(Boolean)
                .join(" · ");
              const label = [prefix, row.checkbox_label || detail].filter(Boolean).join(" · ") || key;
              return (
                <Checkbox
                  key={key}
                  label={label}
                  checked={!!checked[key]}
                  onChange={(val) =>
                    setChecked((current) => {
                      const next = { ...current };
                      if (val) next[key] = true;
                      else delete next[key];
                      return next;
                    })
                  }
                />
              );
            })}
            {engineId
              ? engines
                  .filter((row) => (row.vehicle_key || row.vehicle_id || row.id) === engineId)
                  .map((row) => (
                    <Banner key={String(row.vehicle_id || row.vehicle_key)}>
                      {row.make_name} → {row.model_name} → {row.generation_name} → {row.engine} →{" "}
                      {row.engine_code} → {row.year_range} → {row.vehicle_id || row.vehicle_key}
                    </Banner>
                  ))
              : null}
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
              <Button variant="primary" loading={busy} disabled={!addIds.length} onClick={addSelected}>
                {view === "bulk" ? `Add ${addIds.length} vehicles` : "Add compatibility"}
              </Button>
              <Button onClick={() => setView("list")}>Cancel</Button>
            </InlineStack>
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
              <Button variant="primary" loading={busy} disabled={!importText} onClick={importRows}>
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
              <Button variant="primary" loading={busy} onClick={saveEdit}>
                Save
              </Button>
              <Button onClick={() => setView("list")}>Cancel</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      ) : null}

      <Text as="p" variant="bodySm" tone="subdued">
        Only explicit Ocean product_fitment rows count. Title, tags, vendor, type, collection and
        description are never used. Stored relationship is always canonical Ocean vehicle_id.
      </Text>
    </BlockStack>
  );
}
