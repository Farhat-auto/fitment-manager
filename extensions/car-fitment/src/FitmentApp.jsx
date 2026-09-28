import "@shopify/ui-extensions/preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { adminGraphql, catalogueGet, cataloguePages, cataloguePost, loadMakes } from "./api.js";
import { PRODUCT_QUERY, productFromNode } from "./payload.js";
import { selectedProductIds } from "./selection.js";

function clearHostLoading(node) {
  if (node) node.loading = false;
}

function qs(params) {
  return Object.keys(params)
    .filter((key) => params[key])
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(params[key]))
    .join("&");
}

const TEMPLATE_URL = "https://fitment-manager.vercel.app/fitment-application-template.csv";

export function FitmentApp({ mode }) {
  const shop = typeof shopify === "undefined" ? {} : shopify || {};
  const close = typeof shop.close === "function" ? shop.close : null;
  let i18n = { translate: (key) => key };
  try {
    if (shop.i18n && typeof shop.i18n.translate === "function") i18n = shop.i18n;
  } catch (err) {
    i18n = { translate: (key) => key };
  }
  // Read the product selection after the window is on screen. Reading it
  // during the first paint can leave the products page on the host spinner.
  const [pickedIds, setPickedIds] = useState([]);
  const [activeId, setActiveId] = useState("");
  const selectedId = activeId || pickedIds[0] || "";
  const [product, setProduct] = useState(null);
  const [phase, setPhase] = useState("choose");
  const [products, setProducts] = useState([]);
  const [listing, setListing] = useState({ fitments: [], count: 0, sources: [], verification_statuses: [] });
  const [workspace, setWorkspace] = useState("fitment");
  const [review, setReview] = useState(null);
  const [family, setFamily] = useState(null);
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
      brand: product.vendor,
      mpn: product.mpn,
      barcode: product.barcode,
      product: {
        id: product.id,
        sku: product.sku,
        handle: product.handle,
        barcode: product.barcode,
        vendor: product.vendor,
        variant_id: product.variantId,
        mpn: product.mpn,
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
      return payload;
    },
    [product],
  );

  useEffect(() => {
    if (mode !== "action" || typeof document === "undefined") return;
    const node = document.querySelector("s-admin-action");
    if (node) node.loading = false;
  });

  useEffect(() => {
    let ids = [];
    try {
      const current = typeof shopify === "undefined" ? {} : shopify || {};
      ids = selectedProductIds(current.data || {});
    } catch (err) {
      ids = [];
    }
    setPickedIds(ids);
    if (ids[0]) setActiveId(ids[0]);
  }, []);

  useEffect(() => {
    const ids = pickedIds.length ? pickedIds : selectedId ? [selectedId] : [];
    if (!ids.length) {
      setPhase("choose");
      setProduct(null);
      setProducts([]);
      return;
    }
    let cancelled = false;
    setPhase("loading");
    resetProductScreen();
    const timer = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setPhase("error");
      setError("This product did not load. Close CAR FITMENT and open it again.");
    }, 8000);
    Promise.all(ids.map((id) => adminGraphql(PRODUCT_QUERY, { id })))
      .then((rows) => {
        if (cancelled) return;
        clearTimeout(timer);
        const mapped = rows.map((payload, index) => {
          const node = ((payload || {}).data || {}).product;
          return productFromNode(node || { id: ids[index] });
        });
        setProducts(mapped);
        const current = mapped.find((row) => row.id === selectedId) || mapped[0];
        setProduct(current || null);
        if (current && current.id !== selectedId) setActiveId(current.id);
        if (!current || !current.id) {
          setPhase("error");
          setError("This product could not be loaded.");
          return;
        }
        setPhase("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        clearTimeout(timer);
        setPhase("error");
        setError((err && err.message) || "This product could not be loaded.");
      });
    loadMakes()
      .then((rows) => {
        if (!cancelled) setMakes(rows);
      })
      .catch(() => {
        if (!cancelled) setError(i18n.translate("ladder-error"));
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pickedIds.join("|")]);

  useEffect(() => {
    if (!product) return;
    let cancelled = false;
    loadFitments(product).then((payload) => {
      if (cancelled) return payload;
      return payload;
    });
    const query = qs({
      shopify_product_id: product.numericId,
      sku: product.sku,
      handle: product.handle,
      shopify_variant_id: product.variantNumericId,
      brand: product.vendor,
      mpn: product.mpn,
      barcode: product.barcode,
    });
    catalogueGet("/oe-family?" + query, true).then((payload) => {
      if (!cancelled) setFamily(payload || { candidates: [], copied_fitment: false });
    });
    cataloguePost("/product-review", {
      action: "review",
      shopify_product_id: product.numericId,
      sku: product.sku,
      handle: product.handle,
      brand: product.vendor,
      mpn: product.mpn,
      barcode: product.barcode,
      shopify: {
        sku: product.sku,
        vendor: product.vendor,
        mpn: product.mpn,
        barcode: product.barcode,
        handle: product.handle,
        product_type: product.productType,
        legacy_fitment: product.legacyVehicles || product.customVehicles,
      },
    }).then((payload) => {
      if (!cancelled) setReview(payload);
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
    const rows = await cataloguePages(
      "/models?has_vehicles=0&make_id=" + encodeURIComponent(value),
      "models",
    );
    setModels(rows);
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
      const gens = await cataloguePages(
        "/generations?" + qs({ make_id: makeId, model_id: value, has_vehicles: "0" }),
        "generations",
      );
      setGenerations(gens);
      const engines = await cataloguePages(
        "/engines?" + qs({ make_id: makeId, model_id: value, has_vehicles: "0" }),
        ["engines", "types"],
      );
      setEngines(engines);
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
      const rows = await cataloguePages(
        "/engines?" + qs({ make_id: makeId, model_id: modelId, generation_id: value, has_vehicles: "0" }),
        ["engines", "types"],
      );
      setEngines(rows);
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
      setStatus(i18n.translate("updated"));
      return payload;
    },
    [identity, i18n],
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
  const actionProps = mode === "action" ? { loading: false, ref: clearHostLoading } : {};

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
    <Wrapper heading={wrapperHeading} {...actionProps}>
      {mode === "action" ? (
        <s-button
          slot="primary-action"
          onClick={
            phase === "choose"
              ? () => close && close()
              : view === "import"
                ? importRows
                : view === "edit"
                  ? saveEdit
                  : addSelected
          }
          disabled={phase === "choose" ? false : busy || phase === "loading"}
        >
          {phase === "choose"
            ? "Close"
            : view === "import"
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
      {mode === "action" ? (
        <s-button slot="secondary-actions" onClick={() => close && close()}>
          {i18n.translate("cancel")}
        </s-button>
      ) : null}

      <s-stack gap="base">
        {mode === "action" ? (
          <s-link href={TEMPLATE_URL} download="fitment-application-template.csv" target="_blank">
            Download import template
          </s-link>
        ) : null}
        {products.length > 1 ? (
          <s-stack gap="small">
            <s-text>Selected Shopify products</s-text>
            {products.map((row) => (
              <s-button
                variant={row.id === (product && product.id) ? "primary" : "secondary"}
                onClick={() => {
                  resetProductScreen();
                  setActiveId(row.id);
                  setProduct(row);
                  setWorkspace("fitment");
                }}
              >
                {(row.vendor || "Product") + " · " + (row.sku || row.numericId)}
              </s-button>
            ))}
          </s-stack>
        ) : null}
        {product ? (
          <s-banner>
            Identity: Shopify {product.numericId} → variant {product.variantNumericId} → SKU {product.sku || "—"} → {product.vendor || "—"} + {product.mpn || "—"}. Display title is not an identity key. Ocean article {listing.unmapped ? "unmapped" : listing.sku || product.sku}. {listing.fitment_label || "Fitment: 0 vehicles"}.
          </s-banner>
        ) : null}
        <s-stack direction="inline" gap="small">
          <s-button onClick={() => setWorkspace("fitment")}>CAR FITMENT</s-button>
          <s-button onClick={() => setWorkspace("review")}>{i18n.translate("analyse")}</s-button>
          <s-button onClick={() => setWorkspace("family")}>{i18n.translate("oe-family")}</s-button>
        </s-stack>
        {workspace === "review" && review ? (
          <s-stack gap="base">
            <s-banner tone="warning">Do not blindly overwrite existing Shopify information. Proposed values stay unapplied until review.</s-banner>
            <s-text>PRODUCT IDENTITY: Shopify {product && product.numericId} → variant {product && product.variantNumericId} → SKU {product && product.sku} → {(product && product.vendor) || "—"} + {(product && product.mpn) || "—"}</s-text>
            <s-text>SHOPIFY DATA: type {(product && product.productType) || "—"} · category {(product && product.category) || "—"} · barcode {(product && product.barcode) || "—"} · price {(product && product.price) || "—"}</s-text>
            <s-text>
              OCEAN ARTICLE: {review.unmapped ? "unmapped" : ((review.ocean_article && review.ocean_article.brand) || "") + " " + ((review.ocean_article && review.ocean_article.sku) || "")}
            </s-text>
            <s-text>OE NUMBERS: {(review.oe_numbers || []).map((row) => row.number).join(", ") || "none"}</s-text>
            <s-text>CROSS REFERENCES: {(review.cross_references || []).map((row) => (row.brand || "") + " " + row.number).join(", ") || "none"}</s-text>
            <s-text>
              TECHNICAL SPECIFICATIONS: weight {((review.ocean_article && review.ocean_article.specifications) || {}).weight || "—"} · dimensions {((review.ocean_article && review.ocean_article.specifications) || {}).dimensions || "—"}
            </s-text>
            <s-text>IMAGES: {(product && product.images && product.images.length) || 0} Shopify image(s). Ocean images are not auto-copied.</s-text>
            <s-text>CATEGORY: {(review.ocean_article && review.ocean_article.category) || "—"}</s-text>
            <s-text>SYSTEM GROUP: {(review.ocean_article && review.ocean_article.system_group) || "—"}</s-text>
            <s-text>SUBCATEGORY: {(review.ocean_article && review.ocean_article.subcategory) || "—"}</s-text>
            <s-text>VEHICLE FITMENT: {(review.vehicle_fitment && review.vehicle_fitment.fitment_label) || "Fitment: 0 vehicles"}</s-text>
            <s-text>MISSING DATA: {(review.missing || []).join(", ") || "none"}</s-text>
            <s-text>CONFLICTS: {(review.conflicts || []).join(", ") || "none"}</s-text>
            <s-text>VERIFICATION STATUS: {review.verification_status || "UNVERIFIED"}</s-text>
            {Object.keys(review.fields || {}).map((key) => {
              const row = review.fields[key];
              return (
                <s-text>
                  {key}: Shopify [{row.current || "—"}] → Ocean [{row.ocean || "—"}] → proposed [{row.proposed || "—"}] ({row.source} / {row.status})
                </s-text>
              );
            })}
            <s-banner>{i18n.translate("legacy-warning")}</s-banner>
            {product && (product.legacyVehicles || product.customVehicles) ? (
              <s-text>Legacy Shopify vehicles (reference only): {String(product.legacyVehicles || product.customVehicles).slice(0, 280)}</s-text>
            ) : null}
          </s-stack>
        ) : null}
        {workspace === "family" ? (
          <s-stack gap="base">
            <s-banner tone="warning">{i18n.translate("oe-warning")}</s-banner>
            {(family && family.oe_numbers ? family.oe_numbers : []).map((row) => (
              <s-text>OE {row.number} {row.oem_brand ? "(" + row.oem_brand + ")" : ""}</s-text>
            ))}
            {(family && family.candidates ? family.candidates : []).map((row) => (
              <s-text>
                {row.brand} {row.sku} — research only. copied_fitment={String(row.copied_fitment)}
              </s-text>
            ))}
            {!(family && family.candidates && family.candidates.length) ? <s-text>No OE-family peers.</s-text> : null}
          </s-stack>
        ) : null}

        {workspace === "fitment" ? (
        <s-stack gap="base">
        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
          <s-text>{i18n.translate("compatibility")}</s-text>
          <s-badge tone={count ? "success" : "warning"}>{listing.fitment_label || "Fitment: " + count + " vehicles"}</s-badge>
        </s-stack>
        {error ? <s-banner tone="critical">{error}</s-banner> : null}
        {status ? <s-banner tone="success">{status}</s-banner> : null}
        {phase === "choose" ? <s-banner tone="warning">{i18n.translate("select-products")}</s-banner> : null}
        {phase === "loading" ? <s-text>{i18n.translate("loading")}</s-text> : null}
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

        {phase !== "choose" && (view === "add" || view === "bulk") ? (
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
        ) : null}
      </s-stack>
    </Wrapper>
  );
}
