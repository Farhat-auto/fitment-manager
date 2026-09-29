import { useEffect, useRef, useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  InlineStack,
  Link,
  Select,
  Text,
} from "@shopify/ui-extensions-react/admin";
import { useApi } from "@shopify/ui-extensions-react/admin";

const MODE_EXACT = "exact";
const MODE_MODEL = "model";
const MODE_ENGINE = "engine";
const MAX_VEHICLE_LOOKUPS = 40;

type Row = Record<string, any>;

function engineKey(row: Row | undefined) {
  return String((row && (row.vehicle_key || row.vehicle_id || row.id)) || "");
}

function compactCode(value: unknown) {
  return String(value || "").replace(/[\s.]/g, "").toUpperCase();
}

function engineCode(row: Row | undefined) {
  return compactCode(row && (row.engine_code || row.detail || row.name || row.title));
}

function optionName(row: Row | undefined) {
  return String((row && (row.name || row.title || row.detail)) || "");
}

function generationLabel(row: Row) {
  const name = optionName(row);
  const years = row && row.year_range ? String(row.year_range) : "";
  if (!years || name.indexOf(years) >= 0) return name;
  return (name + " " + years).trim();
}

function engineLabel(row: Row) {
  const code = row && row.engine_code ? String(row.engine_code) : "";
  if (code) return code;
  return String((row && (row.detail || row.name || row.title)) || "Engine");
}

function modeLabel(mode: string) {
  if (mode === MODE_ENGINE) return "All for Engine";
  if (mode === MODE_MODEL) return "All for Model";
  return "Exact Fitment";
}

function vehicleKeys(mode: string, engines: Row[], engineId: string) {
  if (mode === MODE_EXACT) return engineId ? [engineId] : [];
  if (mode === MODE_ENGINE) {
    const selected = engines.find((row) => engineKey(row) === engineId);
    const code = engineCode(selected);
    const matched = code ? engines.map((row) => (engineCode(row) === code ? engineKey(row) : "")).filter(Boolean) : [];
    if (matched.length) return matched;
    return engineId ? [engineId] : [];
  }
  return engines.map(engineKey).filter(Boolean);
}

function origins(api: any) {
  const list = ["https://fitment-manager.vercel.app"];
  const appUrl = String(api?.appUrl || "").replace(/\/+$/, "");
  if (appUrl.indexOf("http") === 0) list.unshift(appUrl);
  return Array.from(new Set(list));
}

async function catalogueGet(api: any, path: string) {
  let token = "";
  try {
    if (api?.sessionToken && typeof api.sessionToken.get === "function") {
      token = await api.sessionToken.get();
    }
  } catch (err) {
    token = "";
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  let failure: Row = {};
  for (const origin of origins(api)) {
    try {
      const res = await fetch(origin + "/api/ocean" + path, { headers });
      const data = (await res.json().catch(() => ({}))) as Row;
      if (!res.ok) {
        failure = { ...data, status: res.status };
        continue;
      }
      return data || {};
    } catch (err) {
      failure = { error: "network" };
    }
  }
  return failure;
}

async function cataloguePages(api: any, path: string, keys: string[]) {
  const rows: Row[] = [];
  const seen: Record<string, boolean> = {};
  let offset = 0;
  for (let page = 0; page < 40; page += 1) {
    const join = path.indexOf("?") === -1 ? "?" : "&";
    const payload = await catalogueGet(api, path + join + "limit=250&offset=" + offset);
    let batch: Row[] = [];
    for (const name of keys) {
      const found = payload && payload[name];
      if (Array.isArray(found) && found.length) {
        batch = found;
        break;
      }
    }
    let added = 0;
    batch.forEach((row) => {
      const id = row && (row.id || row.vehicle_key || row.vehicle_id);
      if (id == null || seen[String(id)]) return;
      seen[String(id)] = true;
      rows.push(row);
      added += 1;
    });
    const meta = (payload && payload.page_meta) || {};
    if (!batch.length || !added || meta.has_next === false) break;
    offset += Number(meta.limit) || batch.length;
  }
  return rows;
}

async function productsForVehicles(api: any, keys: string[]) {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  const limited = unique.slice(0, MAX_VEHICLE_LOOKUPS);
  const merged: Row[] = [];
  const seen: Record<string, boolean> = {};
  let failed = false;
  for (let index = 0; index < limited.length; index += 6) {
    const batch = limited.slice(index, index + 6);
    const payloads = await Promise.all(batch.map((key) => catalogueGet(api, "/products?vehicle_key=" + encodeURIComponent(key))));
    payloads.forEach((payload) => {
      const rows = payload && Array.isArray(payload.products) ? payload.products : null;
      if (!rows) {
        failed = true;
        return;
      }
      rows.forEach((row: Row) => {
        const id = String(row.sku || row.shopify_product_id || row.name || "");
        if (!id || seen[id]) return;
        seen[id] = true;
        merged.push(row);
      });
    });
  }
  return { products: merged, capped: unique.length > limited.length, failed: failed && !merged.length };
}

function adminProductHref(api: any, id: unknown) {
  const numeric = String(id || "").split("/").pop();
  if (!numeric) return "";
  const shop = String(api?.config?.shop || api?.shop || "").replace(/\.myshopify\.com$/i, "");
  if (!shop) return "";
  return "https://admin.shopify.com/store/" + encodeURIComponent(shop) + "/products/" + encodeURIComponent(numeric);
}

function selectOptions(rows: Row[], labelOf: (row: Row) => string, valueOf: (row: Row) => string) {
  return rows
    .map((row) => ({ value: valueOf(row), label: labelOf(row) }))
    .filter((row) => row.value);
}

export function VehicleBar() {
  const api = useApi() as any;
  const apiRef = useRef(api);
  apiRef.current = api;
  const [makes, setMakes] = useState<Row[]>([]);
  const [models, setModels] = useState<Row[]>([]);
  const [generations, setGenerations] = useState<Row[]>([]);
  const [engines, setEngines] = useState<Row[]>([]);
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [generationId, setGenerationId] = useState("");
  const [engineId, setEngineId] = useState("");
  const [mode, setMode] = useState(MODE_EXACT);
  const [note, setNote] = useState("Loading makes…");
  const [products, setProducts] = useState<Row[]>([]);
  const [productNote, setProductNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    cataloguePages(apiRef.current, "/makes?has_vehicles=0", ["makes"])
      .then(async (rows) => {
        if (cancelled) return;
        if (rows.length) {
          setMakes(rows);
          setNote("");
          return;
        }
        const payload = await catalogueGet(apiRef.current, "/makes?has_vehicles=0&limit=5&offset=0");
        if (cancelled) return;
        setNote(payload && payload.status ? "Makes could not be loaded (HTTP " + payload.status + ")." : "No makes were returned by the vehicle catalogue.");
      })
      .catch(() => {
        if (!cancelled) setNote("Makes could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onMake(value: string) {
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
    const rows = await cataloguePages(apiRef.current, "/models?has_vehicles=0&make_id=" + encodeURIComponent(value), ["models"]);
    setModels(rows);
    setNote(rows.length ? "" : "No models were returned for this make.");
  }

  async function onModel(value: string) {
    setModelId(value);
    setGenerationId("");
    setEngineId("");
    setGenerations([]);
    setEngines([]);
    setProducts([]);
    setProductNote("");
    if (!value || !makeId) return;
    const query = "make_id=" + encodeURIComponent(makeId) + "&model_id=" + encodeURIComponent(value) + "&has_vehicles=0";
    const gens = await cataloguePages(apiRef.current, "/generations?" + query, ["generations"]);
    const engineRows = await cataloguePages(apiRef.current, "/engines?" + query, ["engines", "types"]);
    setGenerations(gens);
    setEngines(engineRows);
  }

  async function onGeneration(value: string) {
    setGenerationId(value);
    setEngineId("");
    setProducts([]);
    setProductNote("");
    if (!makeId || !modelId) return;
    const query =
      "make_id=" +
      encodeURIComponent(makeId) +
      "&model_id=" +
      encodeURIComponent(modelId) +
      (value ? "&generation_id=" + encodeURIComponent(value) : "") +
      "&has_vehicles=0";
    const engineRows = await cataloguePages(apiRef.current, "/engines?" + query, ["engines", "types"]);
    setEngines(engineRows);
  }

  function onClear() {
    setMakeId("");
    setModelId("");
    setGenerationId("");
    setEngineId("");
    setMode(MODE_EXACT);
    setModels([]);
    setGenerations([]);
    setEngines([]);
    setProducts([]);
    setProductNote("");
    setNote("");
  }

  const engineSignature = engines.map(engineKey).join(",");

  useEffect(() => {
    const keys = vehicleKeys(mode, engines, engineId);
    if (!keys.length) {
      setProducts([]);
      if (mode === MODE_EXACT && modelId && !engineId) setProductNote("Select an engine for exact fitment.");
      else if (mode === MODE_ENGINE && modelId && !engineId) setProductNote("Select an engine to list every match for that engine.");
      else if (mode === MODE_MODEL && modelId && !engines.length) setProductNote("No engines were returned for this model.");
      else setProductNote("");
      return;
    }
    let cancelled = false;
    setProductNote("Searching linked products…");
    productsForVehicles(apiRef.current, keys)
      .then((result) => {
        if (cancelled) return;
        if (result.failed) {
          setProducts([]);
          setProductNote("Linked products could not be loaded.");
          return;
        }
        setProducts(result.products);
        setProductNote(
          result.products.length
            ? result.capped
              ? "Showing linked products for the first " + MAX_VEHICLE_LOOKUPS + " engines."
              : ""
            : "No products are linked to this vehicle.",
        );
      })
      .catch(() => {
        if (!cancelled) setProductNote("Linked products could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [mode, engineId, modelId, engineSignature]);

  const makeName = optionName(makes.find((row) => String(row.id) === makeId));
  const modelName = optionName(models.find((row) => String(row.id) === modelId));
  const generationName = generationLabel(generations.find((row) => String(row.id) === generationId) || {});
  const selectedEngine = engines.find((row) => engineKey(row) === engineId);
  const contextBits = [makeName, modelName, generationId ? generationName : "", selectedEngine ? engineLabel(selectedEngine) : ""].filter(Boolean);
  const context = contextBits.length ? contextBits.join(" - ") + " - " + modeLabel(mode) : "";
  const shown = products.slice(0, 50);

  return (
    <BlockStack gap="base">
      <InlineStack gap="base" blockAlign="center">
        <Text fontWeight="bold">VEHICLE</Text>
        <Select
          label="Make"
          placeholder="Make"
          value={makeId}
          onChange={onMake}
          options={selectOptions(makes, (row) => optionName(row), (row) => String(row.id))}
        />
        <Select
          label="Model"
          placeholder="Model"
          value={modelId}
          disabled={!makeId}
          onChange={onModel}
          options={selectOptions(models, (row) => optionName(row), (row) => String(row.id))}
        />
        {generations.length ? (
          <Select
            label="Generation"
            placeholder="Generation"
            value={generationId}
            disabled={!modelId}
            onChange={onGeneration}
            options={selectOptions(generations, generationLabel, (row) => String(row.id))}
          />
        ) : null}
        <Select
          label="Engine"
          placeholder="Engine"
          value={engineId}
          disabled={!modelId}
          onChange={setEngineId}
          options={selectOptions(engines, engineLabel, engineKey)}
        />
        <Button variant="tertiary" onPress={onClear}>
          Clear
        </Button>
      </InlineStack>
      <InlineStack gap="base">
        <Button variant={mode === MODE_EXACT ? "primary" : "secondary"} onPress={() => setMode(MODE_EXACT)}>
          Exact Fitment
        </Button>
        <Button variant={mode === MODE_MODEL ? "primary" : "secondary"} onPress={() => setMode(MODE_MODEL)}>
          All for Model
        </Button>
        <Button variant={mode === MODE_ENGINE ? "primary" : "secondary"} onPress={() => setMode(MODE_ENGINE)}>
          All for Engine
        </Button>
      </InlineStack>
      {note ? <Banner tone="warning" title={note} /> : null}
      {context ? <Banner tone="success" title={context} /> : null}
      {productNote ? <Banner tone="info" title={productNote} /> : null}
      {products.length > shown.length ? (
        <Text>
          Showing {shown.length} of {products.length} linked products
        </Text>
      ) : null}
      {shown.map((row) => {
        const href = adminProductHref(api, row.shopify_product_id);
        const fit = row.fitment || {};
        const price = row.gbp_retail_price ? "£ " + row.gbp_retail_price : "";
        return (
          <BlockStack key={String(row.sku || row.shopify_product_id || row.name)} gap="base">
            <Text fontWeight="bold">{row.name || row.sku || "Product"}</Text>
            <Text>
              {(row.brand || "—") + " · " + (row.sku || "—") + (row.mpn ? " · " + row.mpn : "") + (price ? " · " + price : "")}
            </Text>
            <Text>{fit.label || fit.state || "Linked"}</Text>
            {href ? <Link to={href}>Open product</Link> : null}
          </BlockStack>
        );
      })}
    </BlockStack>
  );
}
