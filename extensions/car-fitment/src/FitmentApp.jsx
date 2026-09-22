import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { adminGraphql, catalogueGet, cataloguePost } from "./api";
import { METAFIELDS_SET, PRODUCT_QUERY, countMetafields, productFromNode } from "./payload";

function qs(params) {
  return Object.keys(params)
    .filter((key) => params[key])
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(params[key]))
    .join("&");
}

export function FitmentApp({ mode }) {
  const { close, data, i18n } = shopify;
  const selectedId = ((((data || {}).selected) || [])[0] || {}).id || "";
  const [product, setProduct] = useState(null);
  const [listing, setListing] = useState({ fitments: [], count: 0, sources: [], verification_statuses: [] });
  const [view, setView] = useState(mode === "action" ? "add" : "list");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState([]);
  const [makes, setMakes] = useState([]);
  const [models, setModels] = useState([]);
  const [generations, setGenerations] = useState([]);
  const [engines, setEngines] = useState([]);
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [generationId, setGenerationId] = useState("");
  const [engineId, setEngineId] = useState("");
  const [checked, setChecked] = useState({});
  const [editing, setEditing] = useState(null);
  const [source, setSource] = useState("manual");
  const [verification, setVerification] = useState("UNVERIFIED");
  const [position, setPosition] = useState("");
  const [side, setSide] = useState("");
  const [note, setNote] = useState("");
  const [importText, setImportText] = useState("");

  const identity = useMemo(() => {
    if (!product) return {};
    return {
      shopify_product_id: product.numericId,
      shopify_variant_id: product.variantNumericId,
      sku: product.sku,
      handle: product.handle,
      product: {
        id: product.id,
        sku: product.sku,
        handle: product.handle,
        barcode: product.barcode,
        vendor: product.vendor,
        variant_id: product.variantId,
      },
    };
  }, [product]);

  const resetProductScreen = useCallback(() => {
    setListing({ fitments: [], count: 0, sku: "", sources: [], verification_statuses: [] });
    setChecked({});
    setHits([]);
    setSearch("");
    setEditing(null);
    setError("");
    setStatus("");
    setImportText("");
    setSource("manual");
    setVerification("UNVERIFIED");
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
    setView(mode === "action" ? "add" : "list");
  }, [mode]);

  const syncCount = useCallback(
    async (count) => {
      if (!product || !product.id) return;
      await adminGraphql(METAFIELDS_SET, { metafields: countMetafields(product.id, count) });
    },
    [product],
  );

  const loadFitments = useCallback(
    async (row) => {
      const target = row || product;
      if (!target) return null;
      const query = qs({
        shopify_product_id: target.numericId,
        sku: target.sku,
        handle: target.handle,
        shopify_variant_id: target.variantNumericId,
      });
      const payload = await catalogueGet("/product-fitment?" + query, true);
      const sameSku = !payload || !payload.sku || payload.sku === target.sku;
      const sameProduct =
        !payload ||
        !payload.shopify_product_id ||
        String(payload.shopify_product_id) === String(target.numericId || "");
      if (!sameSku || !sameProduct) return payload;
      setListing(payload || { fitments: [], count: 0, sku: target.sku });
      if (payload && typeof payload.count === "number") {
        await syncCount(payload.count);
      }
      return payload;
    },
    [product, syncCount],
  );

  useEffect(() => {
    if (!selectedId) return;
    resetProductScreen();
    adminGraphql(PRODUCT_QUERY, { id: selectedId }).then((payload) => {
      const node = ((payload || {}).data || {}).product;
      const row = productFromNode(node || { id: selectedId });
      setProduct(row);
    });
    catalogueGet("/makes").then((payload) => setMakes(payload.makes || []));
  }, [selectedId]);

  useEffect(() => {
    if (!product) return;
    let cancelled = false;
    loadFitments(product).then((payload) => {
      if (cancelled) return payload;
      return payload;
    });
    return () => {
      cancelled = true;
    };
  }, [product && product.id]);

  const onMake = useCallback(async (event) => {
    const value = event.currentTarget.value;
    setMakeId(value);
    setModelId("");
    setGenerationId("");
    setEngineId("");
    setModels([]);
    setGenerations([]);
    setEngines([]);
    setChecked({});
    if (!value) return;
    const payload = await catalogueGet("/models?make_id=" + encodeURIComponent(value));
    setModels(payload.models || []);
  }, []);

  const onModel = useCallback(
    async (event) => {
      const value = event.currentTarget.value;
      setModelId(value);
      setGenerationId("");
      setEngineId("");
      setGenerations([]);
      setEngines([]);
      setChecked({});
      if (!value || !makeId) return;
      const gens = await catalogueGet(
        "/generations?" + qs({ make_id: makeId, model_id: value }),
        true,
      );
      setGenerations(gens.generations || []);
      const payload = await catalogueGet(
        "/engines?" + qs({ make_id: makeId, model_id: value }),
      );
      setEngines(payload.engines || payload.types || []);
    },
    [makeId],
  );

  const onGeneration = useCallback(
    async (event) => {
      const value = event.currentTarget.value;
      setGenerationId(value);
      setEngineId("");
      setChecked({});
      if (!value || !makeId || !modelId) return;
      const payload = await catalogueGet(
        "/engines?" + qs({ make_id: makeId, model_id: modelId, generation_id: value }),
      );
      setEngines(payload.engines || payload.types || []);
    },
    [makeId, modelId],
  );

  const runSearch = useCallback(async (value) => {
    setSearch(value);
    if (!value || value.trim().length < 2) {
      setHits([]);
      return;
    }
    const payload = await catalogueGet("/vehicle-search?q=" + encodeURIComponent(value), true);
    const fallback = payload.results
      ? payload
      : await catalogueGet("/vehicles?q=" + encodeURIComponent(value), true);
    setHits((fallback && fallback.results) || []);
  }, []);

  const selectedEngines = useMemo(() => {
    if (view === "bulk") {
      return engines.filter((row) => checked[row.vehicle_key || row.vehicle_id || row.id]);
    }
    if (engineId) {
      return engines.filter((row) => (row.vehicle_key || row.vehicle_id || row.id) === engineId);
    }
    return hits.filter((row) => checked[row.vehicle_id || row.vehicle_key || row.id]);
  }, [view, engines, checked, engineId, hits]);

  const addIds = useMemo(
    () => selectedEngines.map((row) => row.vehicle_id || row.vehicle_key || row.id).filter(Boolean),
    [selectedEngines],
  );

  const mutate = useCallback(
    async (body) => {
      setBusy(true);
      setError("");
      setStatus("");
      const payload = await cataloguePost("/product-fitment", Object.assign({}, identity, body));
      setBusy(false);
      if (!payload || payload.ok === false) {
        setError((payload && payload.error) || i18n.translate("error"));
        return payload;
      }
      if (identity.sku && payload.sku && payload.sku !== identity.sku) {
        setError("stale product payload ignored");
        return payload;
      }
      if (
        identity.shopify_product_id &&
        payload.shopify_product_id &&
        String(payload.shopify_product_id) !== String(identity.shopify_product_id)
      ) {
        setError("stale product payload ignored");
        return payload;
      }
      setListing(payload);
      await syncCount(payload.count);
      setStatus(i18n.translate("updated"));
      return payload;
    },
    [identity, i18n, syncCount],
  );

  const addSelected = useCallback(async () => {
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
      setView("list");
      setChecked({});
      setEngineId("");
      if (mode === "action" && close) close();
    }
  }, [addIds, mutate, source, verification, position, side, note, mode, close]);

  const saveEdit = useCallback(async () => {
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
  }, [editing, mutate, source, verification, position, side, note]);

  const removeRow = useCallback(
    async (row) => {
      await mutate({ action: "remove", fitment_id: row.id, vehicle_id: row.vehicle_id });
    },
    [mutate],
  );

  const importRows = useCallback(async () => {
    const payload = await mutate({
      action: "import",
      content: importText,
      source: source || "catalogue_import",
      verification_status: verification,
    });
    if (payload && payload.ok !== false) {
      setView("list");
      setImportText("");
      if (mode === "action" && close) close();
    }
  }, [mutate, importText, source, verification, mode, close]);

  const openEdit = useCallback((row) => {
    setEditing(row);
    setSource(row.source || "manual");
    setVerification(row.verification_status || "UNVERIFIED");
    setPosition(row.position || "");
    setSide(row.side || "");
    setNote(row.fitment_note || "");
    setView("edit");
  }, []);

  const toggle = useCallback((key) => {
    setChecked((current) => {
      const next = Object.assign({}, current);
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  }, []);

  const sources = listing.sources || [
    { id: "manual", label: "Manual" },
    { id: "supplier", label: "Supplier" },
    { id: "manufacturer", label: "Manufacturer" },
    { id: "oe_cross_reference", label: "OE cross-reference" },
    { id: "catalogue_import", label: "Catalogue import" },
    { id: "tecdoc_authorised", label: "TecDoc-authorised source" },
    { id: "other_verified", label: "Other verified source" },
  ];
  const statuses = listing.verification_statuses || ["VERIFIED", "UNVERIFIED", "NEEDS_REVIEW"];
  const fitments = listing.fitments || [];
  const count = listing.count || fitments.length;
  const Wrapper = mode === "action" ? "s-admin-action" : "s-admin-block";
  const wrapperHeading = i18n.translate("heading");

  const provenance = (
    <s-stack gap="base">
      <s-select label={i18n.translate("source-label")} value={source} onChange={(event) => setSource(event.currentTarget.value)}>
        {sources.map((row) => (
          <s-option value={row.id}>{row.label}</s-option>
        ))}
      </s-select>
      <s-select
        label={i18n.translate("status-label")}
        value={verification}
        onChange={(event) => setVerification(event.currentTarget.value)}
      >
        {statuses.map((row) => (
          <s-option value={row}>{row.replace("_", " ")}</s-option>
        ))}
      </s-select>
      <s-text-field label={i18n.translate("position-label")} value={position} onChange={(event) => setPosition(event.currentTarget.value)} />
      <s-text-field label={i18n.translate("side-label")} value={side} onChange={(event) => setSide(event.currentTarget.value)} />
      <s-text-field label={i18n.translate("note-label")} value={note} onChange={(event) => setNote(event.currentTarget.value)} />
    </s-stack>
  );

  const ladder = (
    <s-stack gap="base">
      <s-select label={i18n.translate("make-label")} value={makeId} onChange={onMake}>
        <s-option value="">{i18n.translate("select-make")}</s-option>
        {makes.map((row) => (
          <s-option value={row.id}>{row.name}</s-option>
        ))}
      </s-select>
      <s-select label={i18n.translate("model-label")} value={modelId} onChange={onModel} disabled={!makeId}>
        <s-option value="">{i18n.translate("select-model")}</s-option>
        {models.map((row) => (
          <s-option value={row.id}>{row.name || row.title}</s-option>
        ))}
      </s-select>
      <s-select
        label={i18n.translate("generation-label")}
        value={generationId}
        onChange={onGeneration}
        disabled={!modelId}
      >
        <s-option value="">{i18n.translate("select-generation")}</s-option>
        {generations.map((row) => (
          <s-option value={row.id}>
            {row.name}
            {row.year_range ? " " + row.year_range : ""}
          </s-option>
        ))}
      </s-select>
      {view === "add" ? (
        <s-select
          label={i18n.translate("engine-label")}
          value={engineId}
          onChange={(event) => setEngineId(event.currentTarget.value)}
          disabled={!modelId}
        >
          <s-option value="">{i18n.translate("select-engine")}</s-option>
          {engines.map((row) => (
            <s-option value={row.vehicle_key || row.vehicle_id || row.id}>
              {(row.detail || row.customer_label || row.name) + (row.year_range ? " · " + row.year_range : "")}
            </s-option>
          ))}
        </s-select>
      ) : null}
    </s-stack>
  );

  return (
    <Wrapper heading={wrapperHeading}>
      {mode === "action" ? (
        <s-button slot="primary-action" onClick={view === "import" ? importRows : view === "edit" ? saveEdit : addSelected} disabled={busy}>
          {view === "import"
            ? i18n.translate("import-fitment")
            : view === "bulk"
              ? "Add " + addIds.length + " vehicles"
              : view === "edit"
                ? i18n.translate("save")
                : i18n.translate("add-compatibility")}
        </s-button>
      ) : (
        <s-button slot="primary-action" onClick={() => setView("add")}>
          {i18n.translate("add-vehicle")}
        </s-button>
      )}
      {mode === "action" && close ? (
        <s-button slot="secondary-actions" onClick={close}>
          {i18n.translate("cancel")}
        </s-button>
      ) : null}

      <s-stack gap="base">
        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
          <s-text>{i18n.translate("compatibility")}</s-text>
          <s-badge tone={count ? "success" : "warning"}>{listing.fitment_label || "Fitment: " + count + " vehicles"}</s-badge>
        </s-stack>
        {error ? <s-banner tone="critical">{error}</s-banner> : null}
        {status ? <s-banner tone="success">{status}</s-banner> : null}
        {!product ? <s-text>{i18n.translate("loading")}</s-text> : null}
        {!count && view === "list" ? <s-banner tone="warning">{i18n.translate("zero")}</s-banner> : null}

        {view === "list"
          ? fitments.map((row) => (
              <s-stack gap="small">
                <s-text>
                  ✓ {row.title || row.make + " " + row.model}
                </s-text>
                <s-text>
                  {row.detail || [row.engine, row.engine_code, row.year_range, row.power_label].filter(Boolean).join(" | ")}
                </s-text>
                <s-text>
                  {row.source_label} · {row.verification_status}
                </s-text>
                <s-stack direction="inline" gap="small">
                  <s-button onClick={() => openEdit(row)}>{i18n.translate("edit")}</s-button>
                  <s-button tone="critical" onClick={() => removeRow(row)} disabled={busy}>
                    {i18n.translate("remove")}
                  </s-button>
                </s-stack>
              </s-stack>
            ))
          : null}

        {view === "list" ? (
          <s-stack direction="inline" gap="small">
            <s-button onClick={() => setView("add")}>{i18n.translate("add-vehicle")}</s-button>
            <s-button onClick={() => setView("bulk")}>{i18n.translate("bulk-add")}</s-button>
            <s-button onClick={() => setView("import")}>{i18n.translate("import-fitment")}</s-button>
          </s-stack>
        ) : null}

        {view === "add" || view === "bulk" ? (
          <s-stack gap="base">
            <s-text-field
              label={i18n.translate("search-label")}
              value={search}
              placeholder={i18n.translate("search-placeholder")}
              onChange={(event) => runSearch(event.currentTarget.value)}
            />
            {hits.map((row) => {
              const key = row.vehicle_id || row.vehicle_key || row.id;
              const on = !!checked[key];
              return (
                <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                  <s-text>
                    {on ? "☑ " : "☐ "}
                    {row.checkbox_label || row.title || row.customer_label}
                  </s-text>
                  <s-button onClick={() => toggle(key)}>{on ? "Selected" : "Select"}</s-button>
                </s-stack>
              );
            })}
            {ladder}
            {view === "bulk"
              ? engines.map((row) => {
                  const key = row.vehicle_key || row.vehicle_id || row.id;
                  const on = !!checked[key];
                  return (
                    <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                      <s-text>
                        {on ? "☑ " : "☐ "}
                        {row.checkbox_label || row.detail || row.customer_label}
                      </s-text>
                      <s-button onClick={() => toggle(key)}>{on ? "Selected" : "Select"}</s-button>
                    </s-stack>
                  );
                })
              : null}
            {engineId && view === "add"
              ? engines
                  .filter((row) => (row.vehicle_key || row.vehicle_id || row.id) === engineId)
                  .map((row) => (
                    <s-banner>
                      {row.make_name} → {row.model_name} → {row.generation_name} → {row.engine} → {row.engine_code} → {row.year_range}
                    </s-banner>
                  ))
              : null}
            {provenance}
            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                onClick={addSelected}
                disabled={busy || !addIds.length}
              >
                {view === "bulk" ? "Add " + addIds.length + " vehicles" : i18n.translate("add-compatibility")}
              </s-button>
              <s-button onClick={() => setView("list")}>{i18n.translate("cancel")}</s-button>
            </s-stack>
          </s-stack>
        ) : null}

        {view === "import" ? (
          <s-stack gap="base">
            <s-text>{i18n.translate("import-help")}</s-text>
            <s-text-field
              label={i18n.translate("import-label")}
              value={importText}
              multiline
              onChange={(event) => setImportText(event.currentTarget.value)}
            />
            {provenance}
            <s-stack direction="inline" gap="small">
              <s-button variant="primary" onClick={importRows} disabled={busy || !importText}>
                {i18n.translate("import-fitment")}
              </s-button>
              <s-button onClick={() => setView("list")}>{i18n.translate("cancel")}</s-button>
            </s-stack>
          </s-stack>
        ) : null}

        {view === "edit" && editing ? (
          <s-stack gap="base">
            <s-text>
              ✓ {editing.title}
            </s-text>
            <s-text>{editing.detail}</s-text>
            {provenance}
            <s-stack direction="inline" gap="small">
              <s-button variant="primary" onClick={saveEdit} disabled={busy}>
                {i18n.translate("save")}
              </s-button>
              <s-button onClick={() => setView("list")}>{i18n.translate("cancel")}</s-button>
            </s-stack>
          </s-stack>
        ) : null}

        <s-text>{i18n.translate("fail-closed")}</s-text>
      </s-stack>
    </Wrapper>
  );
}
