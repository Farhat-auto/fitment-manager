import { useEffect, useRef, useState } from "preact/hooks";
import { adminGraphql, catalogueGet, cataloguePages } from "./api.js";
import {
  catalogueEngineLabel,
  fetchAppCatalogue,
  linkItemToVehicles,
  loadCompatible,
  parseReferenceList,
  postAppCatalogue,
  selectedVehicleIds,
  vehiclesFromLabels,
} from "./item-vehicles.js";
import { PRODUCT_QUERY, productFromNode } from "./payload.js";
import { selectedProductIds } from "./selection.js";

const MODE_EXACT = "exact";
const MODE_MODEL = "model";
const MODE_ENGINE = "engine";
const MAX_VEHICLE_LOOKUPS = 40;

function fieldValue(event) {
  try {
    const target = (event && (event.target || event.currentTarget)) || {};
    if (target.value != null) return String(target.value);
  } catch (err) {
    // Remote select events can omit the target.
  }
  return "";
}

function engineKey(row) {
  return String((row && (row.vehicle_key || row.vehicle_id || row.id)) || "");
}

function optionName(row) {
  return (row && (row.name || row.title || row.detail)) || "";
}

function generationLabel(row) {
  const name = optionName(row);
  const years = row && row.year_range ? String(row.year_range) : "";
  if (!years || name.indexOf(years) >= 0) return name;
  return (name + " " + years).trim();
}

function engineLabel(row) {
  return catalogueEngineLabel(row);
}

function savedVehicleLabel(row) {
  const direct = row && (row.checkbox_label || row.customer_label || row.title || row.detail);
  if (direct) return String(direct);
  return [row && row.make_name, row && row.model_name, row && row.generation_name, row && row.engine_code]
    .filter(Boolean)
    .join(" / ");
}

function modeLabel(mode) {
  if (mode === MODE_ENGINE) return "All for Engine";
  if (mode === MODE_MODEL) return "All for Model";
  return "Exact Fitment";
}

function vehicleKeys(mode, engines, engineId) {
  return selectedVehicleIds(engines, engineId, mode);
}

function currentProductId() {
  try {
    let data = typeof shopify === "undefined" ? {} : (shopify && shopify.data) || {};
    if (data && typeof data.peek === "function") {
      data = "value" in data ? data.value : data.peek();
    }
    return selectedProductIds(data)[0] || "";
  } catch (err) {
    return "";
  }
}

function itemLine(item) {
  if (!item) return "";
  return [item.vendor, item.sku ? "SKU " + item.sku : "", item.mpn ? "MPN " + item.mpn : ""]
    .filter(Boolean)
    .join(" · ");
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

async function productsForVehicles(keys) {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  const limited = unique.slice(0, MAX_VEHICLE_LOOKUPS);
  const merged = [];
  const seen = new Set();
  let failed = false;
  for (let index = 0; index < limited.length; index += 6) {
    const batch = limited.slice(index, index + 6);
    const payloads = await Promise.all(
      batch.map((key) => catalogueGet("/products?vehicle_key=" + encodeURIComponent(key))),
    );
    payloads.forEach((payload) => {
      const rows = payload && Array.isArray(payload.products) ? payload.products : null;
      if (!rows) {
        failed = true;
        return;
      }
      rows.forEach((row) => {
        const id = String(row.sku || row.shopify_product_id || row.name || "");
        if (!id || seen.has(id)) return;
        seen.add(id);
        merged.push(row);
      });
    });
  }
  return { products: merged, capped: unique.length > limited.length, failed: failed && !merged.length };
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
  const [mode, setMode] = useState(MODE_EXACT);
  const [note, setNote] = useState("Loading makes…");
  const [products, setProducts] = useState([]);
  const [productNote, setProductNote] = useState("");
  const [saved, setSaved] = useState([]);
  const [savedNote, setSavedNote] = useState("");
  const [linked, setLinked] = useState(false);
  const [item, setItem] = useState(null);
  const [matchNote, setMatchNote] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [busy, setBusy] = useState(false);
  const itemRef = useRef(null);

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

  useEffect(() => {
    let cancelled = false;
    let timer;
    let tries = 0;
    const run = (productId) => {
      setLinked(true);
      adminGraphql(PRODUCT_QUERY, { id: productId })
        .then(async (payload) => {
          const node = ((payload || {}).data || {}).product || {};
          const product = productFromNode(node);
          const nextItem = {
            title: product.title,
            vendor: product.vendor,
            sku: product.sku,
            mpn: product.mpn,
            oe: parseReferenceList(product.oeRefs),
            handle: product.handle,
            numericId: product.numericId || String(productId).split("/").pop(),
            variantNumericId: product.variantNumericId,
            listed: vehiclesFromLabels(product.linkedVehicles),
          };
          const result = await loadCompatible(
            (path) => fetchAppCatalogue(path),
            nextItem,
            nextItem.numericId,
            product.variantNumericId,
          );
          return { nextItem: nextItem, result: result };
        })
        .then((loaded) => {
          if (cancelled || !loaded) return;
          const catalogueRows = loaded.result.rows || [];
          const rows = catalogueRows.length ? catalogueRows : loaded.nextItem.listed || [];
          itemRef.current = loaded.nextItem;
          setItem(loaded.nextItem);
          setSaved(rows);
          setMatchNote(loaded.result.matchNote || "");
          setSavedNote(rows.length ? "Compatible vehicles · " + rows.length : "");
          if (!rows.length && loaded.result.errorText && loaded.result.errorText.indexOf("could not be loaded") >= 0) {
            setLinkNote(loaded.result.errorText);
          }
        })
        .catch(() => {
          if (!cancelled) setLinkNote("Compatible vehicles could not be loaded.");
        });
    };
    const look = () => {
      const productId = currentProductId();
      if (productId) {
        run(productId);
        return;
      }
      tries += 1;
      if (tries < 8) timer = setTimeout(look, 300);
    };
    look();
    return () => {
      cancelled = true;
      clearTimeout(timer);
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
    setNote(rows.length ? "" : "No models were returned for this make.");
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
    if (!value || !makeId || !modelId) {
      if (makeId && modelId) {
        const query =
          "make_id=" + encodeURIComponent(makeId) + "&model_id=" + encodeURIComponent(modelId) + "&has_vehicles=0";
        const engineRows = await cataloguePages("/engines?" + query, ["engines", "types"]);
        setEngines(engineRows);
      }
      return;
    }
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

  async function onLink(chosen) {
    const current = itemRef.current;
    const ids = Array.isArray(chosen) ? chosen : selectedVehicleIds(engines, engineId, mode);
    if (!current || !ids.length) {
      setLinkNote("Select a vehicle to link this item.");
      return;
    }
    setBusy(true);
    setLinkNote("Saving this link…");
    const result = await linkItemToVehicles(
      (path, body) => postAppCatalogue(path, body),
      current,
      current.numericId,
      current.variantNumericId,
      ids,
      "VERIFIED",
    );
    setBusy(false);
    if (!result.ok) {
      setLinkNote(result.errorText);
      return;
    }
    if (result.rows.length) setSaved(result.rows);
    setSavedNote(result.rows.length ? "Compatible vehicles · " + result.rows.length : "");
    setLinkNote(
      result.added
        ? "Saved " +
            result.added +
            (result.added === 1 ? " vehicle" : " vehicles") +
            " on this item. Linked in Fitment Manager and on the storefront."
        : "Saved. This vehicle is already linked in Fitment Manager and on the storefront.",
    );
  }

  function onEngine(value) {
    setEngineId(value);
    if (!linked || !value) return;
    const ids = selectedVehicleIds(engines, value, mode);
    if (!ids.length) return;
    onLink(ids);
  }

  function onMode(next) {
    setMode(next);
    if (!linked) return;
    const ids = selectedVehicleIds(engines, engineId, next);
    if (ids.length) onLink(ids);
  }

  function onClear() {
    setEngineId("");
    setMode(MODE_EXACT);
    setProducts([]);
    setProductNote("");
    setLinkNote("");
    setMakeId("");
    setModelId("");
    setGenerationId("");
    setModels([]);
    setGenerations([]);
    setEngines([]);
    setNote("");
  }

  const engineSignature = engines.map(engineKey).join(",");

  useEffect(() => {
    if (linked) {
      setProducts([]);
      setProductNote("");
      return;
    }
    const keys = vehicleKeys(mode, engines, engineId);
    if (!keys.length) {
      setProducts([]);
      if (mode === MODE_EXACT && modelId && !engineId) {
        setProductNote("Select an engine for exact fitment.");
      } else if (mode === MODE_ENGINE && modelId && !engineId) {
        setProductNote("Select an engine to list every match for that engine.");
      } else if (mode === MODE_MODEL && modelId && !engines.length) {
        setProductNote("No engines were returned for this model.");
      } else {
        setProductNote("");
      }
      return;
    }
    let cancelled = false;
    setProductNote("Searching linked products…");
    productsForVehicles(keys)
      .then((result) => {
        if (cancelled) return;
        if (result.failed) {
          setProducts([]);
          setProductNote("Linked products could not be loaded.");
          return;
        }
        setProducts(result.products);
        if (!result.products.length) {
          setProductNote("No products are linked to this vehicle.");
          return;
        }
        setProductNote(
          result.capped ? "Showing linked products for the first " + MAX_VEHICLE_LOOKUPS + " engines." : "",
        );
      })
      .catch(() => {
        if (!cancelled) setProductNote("Linked products could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [linked, mode, engineId, modelId, engineSignature]);

  const makeName = optionName(makes.find((row) => String(row.id) === makeId));
  const modelName = optionName(models.find((row) => String(row.id) === modelId));
  const generationName = generationLabel(generations.find((row) => String(row.id) === generationId));
  const selectedEngine = engines.find((row) => engineKey(row) === engineId);
  const contextBits = [makeName, modelName, generationName, selectedEngine ? engineLabel(selectedEngine) : ""].filter(Boolean);
  const contextLabel = contextBits.length ? contextBits.join(" - ") + " - " + modeLabel(mode) : "";
  const shown = products.slice(0, 50);
  const visible = linked ? saved : [];
  const visibleShown = visible.slice(0, 40);
  const canLink = linked && selectedVehicleIds(engines, engineId, mode).length > 0 && !busy;
  const details = itemLine(item);

  return (
    <s-stack gap="base">
      {linked ? (
        <s-stack gap="small">
          <s-text type="strong">{(item && item.title) || "This item"}</s-text>
          {details ? <s-text>{details}</s-text> : null}
          {item && item.oe && item.oe.length ? <s-text>{"OE " + item.oe.join(", ")}</s-text> : null}
          <s-text>{linkNote || "Select an engine to save it on this item."}</s-text>
          <s-button variant="primary" disabled={!canLink} onClick={() => onLink()}>
            {busy ? "Saving…" : "Save link"}
          </s-button>
          {matchNote ? <s-text>{matchNote}</s-text> : null}
        </s-stack>
      ) : null}
      <s-stack direction="inline" gap="base">
        <s-text type="strong">VEHICLE</s-text>
        <s-select key={"make-" + makes.length} label="Make" value={makeId} onChange={(event) => onMake(fieldValue(event))}>
          <s-option value="">Make</s-option>
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
          <s-option value="">Model</s-option>
          {models.map((row) => (
            <s-option key={String(row.id)} value={String(row.id)}>
              {optionName(row)}
            </s-option>
          ))}
        </s-select>
        {generations.length ? (
          <s-select
            key={"generation-" + modelId + "-" + generations.length}
            label="Generation"
            value={generationId}
            disabled={!modelId}
            onChange={(event) => onGeneration(fieldValue(event))}
          >
            <s-option value="">Generation</s-option>
            {generations.map((row) => (
              <s-option key={String(row.id)} value={String(row.id)}>
                {generationLabel(row)}
              </s-option>
            ))}
          </s-select>
        ) : null}
        <s-select
          key={"engine-" + generationId + "-" + modelId + "-" + engines.length}
          label="Engine"
          value={engineId}
          disabled={!modelId}
          onChange={(event) => onEngine(fieldValue(event))}
        >
          <s-option value="">Engine</s-option>
          {engines.map((row) => (
            <s-option key={engineKey(row)} value={engineKey(row)}>
              {engineLabel(row)}
            </s-option>
          ))}
        </s-select>
        <s-button variant="tertiary" onClick={onClear}>
          Clear
        </s-button>
      </s-stack>
      <s-stack direction="inline" gap="base">
        <s-button variant={mode === MODE_EXACT ? "primary" : "secondary"} onClick={() => onMode(MODE_EXACT)}>
          Exact Fitment
        </s-button>
        <s-button variant={mode === MODE_MODEL ? "primary" : "secondary"} onClick={() => onMode(MODE_MODEL)}>
          All for Model
        </s-button>
        <s-button variant={mode === MODE_ENGINE ? "primary" : "secondary"} onClick={() => onMode(MODE_ENGINE)}>
          All for Engine
        </s-button>
      </s-stack>
      {note ? <s-banner tone="warning">{note}</s-banner> : null}
      {linkNote ? <s-banner tone={linkNote.indexOf("Saved") === 0 ? "success" : "warning"}>{linkNote}</s-banner> : null}
      {linked ? <s-text type="strong">{savedNote || "Compatible vehicles"}</s-text> : null}
      {linked && !saved.length ? <s-text>This item is not linked to a vehicle yet.</s-text> : null}
      {contextLabel ? <s-banner tone="success">{contextLabel}</s-banner> : null}
      {productNote ? <s-banner tone="info">{productNote}</s-banner> : null}
      {visibleShown.map((row) => (
        <s-text key={String(row.fitment_id || row.vehicle_id || row.vehicle_key || savedVehicleLabel(row))}>
          {(savedVehicleLabel(row) || "Vehicle") + (row.verification_status ? " · " + row.verification_status : "")}
        </s-text>
      ))}
      {visible.length > visibleShown.length ? (
        <s-text>
          Showing {visibleShown.length} of {visible.length} compatible vehicles
        </s-text>
      ) : null}
      {products.length > shown.length ? (
        <s-text>
          Showing {shown.length} of {products.length} linked products
        </s-text>
      ) : null}
      {shown.map((row) => {
        const href = adminProductHref(row.shopify_product_id);
        const fit = row.fitment || {};
        const price = row.gbp_retail_price ? "£ " + row.gbp_retail_price : "";
        return (
          <s-stack key={String(row.sku || row.shopify_product_id || row.name)} gap="small">
            <s-text type="strong">{row.name || row.sku || "Product"}</s-text>
            <s-text>
              {(row.brand || "—") +
                " · " +
                (row.sku || "—") +
                (row.mpn ? " · " + row.mpn : "") +
                (price ? " · " + price : "")}
            </s-text>
            <s-text>{fit.label || fit.state || "Linked"}</s-text>
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
