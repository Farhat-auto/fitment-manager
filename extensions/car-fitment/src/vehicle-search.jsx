import { useEffect, useState } from "preact/hooks";
import { catalogueGet, cataloguePages } from "./api.js";

function fieldValue(event) {
  try {
    const target = (event && (event.target || event.currentTarget)) || {};
    if (target.value != null) return String(target.value);
  } catch (err) {
    // Remote select events can omit the target.
  }
  return "";
}

function labelOf(row) {
  return (
    (row && (row.detail || row.customer_label || row.name || row.title || row.display_name)) ||
    "Vehicle"
  );
}

function adminProductHref(id) {
  const numeric = String(id || "").split("/").pop();
  if (!numeric) return "";
  let shop = "";
  try {
    const cfg = (typeof shopify === "undefined" ? {} : shopify && shopify.config) || {};
    shop = cfg.shop || cfg.shopDomain || "";
  } catch (err) {
    shop = "";
  }
  const handle = String(shop).replace(/\.myshopify\.com$/i, "");
  if (!handle) return "";
  return (
    "https://admin.shopify.com/store/" +
    encodeURIComponent(handle) +
    "/products/" +
    encodeURIComponent(numeric)
  );
}

export function VehicleSearch() {
  const [makes, setMakes] = useState([]);
  const [models, setModels] = useState([]);
  const [generations, setGenerations] = useState([]);
  const [engines, setEngines] = useState([]);
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [generationId, setGenerationId] = useState("");
  const [engineId, setEngineId] = useState("");
  const [note, setNote] = useState("Loading makes…");
  const [products, setProducts] = useState([]);
  const [productNote, setProductNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    cataloguePages("/makes?has_vehicles=0", "makes")
      .then(async (rows) => {
        if (cancelled) return;
        if (rows.length) {
          setMakes(rows);
          setNote("");
          return;
        }
        const payload = await catalogueGet("/makes?has_vehicles=0&limit=5&offset=0");
        if (cancelled) return;
        const status = payload && payload.status;
        setNote(
          status
            ? "Makes could not be loaded (HTTP " + status + ")."
            : "No makes were returned by the vehicle catalogue.",
        );
      })
      .catch(() => {
        if (!cancelled) setNote("Makes could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onMake(value) {
    setMakeId(value);
    setModelId("");
    setGenerationId("");
    setEngineId("");
    setModels([]);
    setGenerations([]);
    setEngines([]);
    setProducts([]);
    setProductNote("");
    if (!value) return;
    const rows = await cataloguePages(
      "/models?has_vehicles=0&make_id=" + encodeURIComponent(value),
      "models",
    );
    setModels(rows);
    if (!rows.length) setNote("No models were returned for this make.");
    else setNote("");
  }

  async function onModel(value) {
    setModelId(value);
    setGenerationId("");
    setEngineId("");
    setGenerations([]);
    setEngines([]);
    setProducts([]);
    setProductNote("");
    if (!value || !makeId) return;
    const query =
      "make_id=" + encodeURIComponent(makeId) + "&model_id=" + encodeURIComponent(value) + "&has_vehicles=0";
    const gens = await cataloguePages("/generations?" + query, "generations");
    const engineRows = await cataloguePages("/engines?" + query, ["engines", "types"]);
    setGenerations(gens);
    setEngines(engineRows);
  }

  async function onGeneration(value) {
    setGenerationId(value);
    setEngineId("");
    setProducts([]);
    setProductNote("");
    if (!value || !makeId || !modelId) return;
    const query =
      "make_id=" +
      encodeURIComponent(makeId) +
      "&model_id=" +
      encodeURIComponent(modelId) +
      "&generation_id=" +
      encodeURIComponent(value) +
      "&has_vehicles=0";
    const engineRows = await cataloguePages("/engines?" + query, ["engines", "types"]);
    setEngines(engineRows);
  }

  useEffect(() => {
    if (!engineId) {
      setProducts([]);
      setProductNote("");
      return;
    }
    let cancelled = false;
    setProductNote("Searching linked products…");
    catalogueGet("/products?vehicle_key=" + encodeURIComponent(engineId))
      .then((payload) => {
        if (cancelled) return;
        const rows = payload && Array.isArray(payload.products) ? payload.products : null;
        if (!rows) {
          const status = payload && payload.status ? " (HTTP " + payload.status + ")" : "";
          setProducts([]);
          setProductNote("Linked products could not be loaded" + status + ".");
          return;
        }
        setProducts(rows);
        setProductNote(rows.length ? "" : "No products are linked to this vehicle.");
      })
      .catch(() => {
        if (!cancelled) setProductNote("Linked products could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [engineId]);

  const shown = products.slice(0, 50);

  return (
    <s-stack gap="base">
      <s-text>Search products linked to a vehicle</s-text>
      {note ? <s-banner tone="warning">{note}</s-banner> : null}
      <s-select key={"make-" + makes.length} label="Make" value={makeId} onChange={(event) => onMake(fieldValue(event))}>
        <s-option value="">Select make</s-option>
        {makes.map((row) => (
          <s-option key={String(row.id)} value={String(row.id)}>
            {row.name}
          </s-option>
        ))}
      </s-select>
      <s-select
        key={"model-" + makeId + "-" + models.length}
        label="Model"
        value={modelId}
        disabled={!makeId}
        onChange={(event) => onModel(fieldValue(event))}
      >
        <s-option value="">Select model</s-option>
        {models.map((row) => (
          <s-option key={String(row.id)} value={String(row.id)}>
            {row.name || row.title}
          </s-option>
        ))}
      </s-select>
      <s-select
        key={"generation-" + modelId + "-" + generations.length}
        label="Generation"
        value={generationId}
        disabled={!modelId}
        onChange={(event) => onGeneration(fieldValue(event))}
      >
        <s-option value="">Select generation</s-option>
        {generations.map((row) => (
          <s-option key={String(row.id)} value={String(row.id)}>
            {row.name}
            {row.year_range ? " " + row.year_range : ""}
          </s-option>
        ))}
      </s-select>
      <s-select
        key={"engine-" + generationId + "-" + engines.length}
        label="Engine"
        value={engineId}
        disabled={!modelId}
        onChange={(event) => setEngineId(fieldValue(event))}
      >
        <s-option value="">Select engine</s-option>
        {engines.map((row) => (
          <s-option key={String(row.vehicle_key || row.id)} value={String(row.vehicle_key || row.vehicle_id || row.id)}>
            {labelOf(row)}
            {row.year_range ? " · " + row.year_range : ""}
          </s-option>
        ))}
      </s-select>
      {productNote ? <s-banner tone="warning">{productNote}</s-banner> : null}
      {products.length > shown.length ? (
        <s-text>
          Showing {shown.length} of {products.length} linked products
        </s-text>
      ) : null}
      {shown.map((row) => {
        const href = adminProductHref(row.shopify_product_id);
        const fit = row.fitment || {};
        return (
          <s-stack key={String(row.sku || row.shopify_product_id)} gap="small">
            <s-text>
              {(row.brand || "—") + " · " + (row.sku || "—") + (row.mpn ? " · " + row.mpn : "")}
            </s-text>
            {row.name ? <s-text>{row.name}</s-text> : null}
            <s-text>
              {(fit.label || fit.state || "Linked") +
                (row.shopify_product_id ? " · Shopify " + row.shopify_product_id : "")}
            </s-text>
            {href ? (
              <s-link href={href} target="_blank">
                Open product
              </s-link>
            ) : null}
          </s-stack>
        );
      })}
    </s-stack>
  );
}
