import { useEffect, useRef, useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  InlineStack,
  Select,
  Text,
} from "@shopify/ui-extensions-react/admin";
import { useApi } from "@shopify/ui-extensions-react/admin";
import {
  applyVehicleScope,
  enginesFrom,
  filterVehicles,
  loadCompatible,
  modelsFrom,
  parseReferenceList,
  vehiclesFromLabels,
} from "./item-vehicles.js";

const MODE_EXACT = "exact";
const MODE_MODEL = "model";
const MODE_ENGINE = "engine";

type Row = Record<string, any>;

type ItemInfo = {
  title: string;
  vendor: string;
  sku: string;
  mpn: string;
  oe: string[];
  handle: string;
};

const EMPTY_ITEM: ItemInfo = { title: "", vendor: "", sku: "", mpn: "", oe: [], handle: "" };

function engineKey(row: Row | undefined) {
  return String((row && (row.vehicle_key || row.vehicle_id || row.id)) || "");
}

function compactCode(value: unknown) {
  return String(value || "").replace(/[\s.]/g, "").toUpperCase();
}

function engineCode(row: Row | undefined) {
  return compactCode(row && (row.engine_code || row.detail || row.name || row.title));
}

function engineLabel(row: Row) {
  const code = row && row.engine_code ? String(row.engine_code) : "";
  if (code) return code;
  return String((row && (row.detail || row.name || row.title)) || "Engine");
}

function savedVehicleLabel(row: Row) {
  const direct = row && (row.checkbox_label || row.customer_label || row.title || row.detail);
  if (direct) return String(direct);
  return [row && row.make_name, row && row.model_name, row && row.generation_name, row && row.engine_code]
    .filter(Boolean)
    .join(" / ");
}

function readSignal(value: any) {
  let current = value;
  for (let i = 0; i < 4; i += 1) {
    if (!current || typeof current.peek !== "function") return current;
    try {
      current = "value" in current ? current.value : current.peek();
    } catch (err) {
      return "";
    }
  }
  return current;
}

function readSelectedProductId(api: any) {
  const data = readSignal(api?.data) || api?.data || {};
  const selected = readSignal(data.selected);
  const list = Array.isArray(selected) ? selected : selected ? [selected] : [];
  for (const row of list) {
    const id = typeof row === "string" ? row : readSignal(row?.id);
    if (id) return String(id);
  }
  const product = readSignal(data.product);
  if (typeof product === "string" && product) return product;
  const id = product && (typeof product.id === "string" ? product.id : readSignal(product.id));
  return id ? String(id) : "";
}

function withTimeout(promise: Promise<any>, ms: number) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const PRODUCT_IDENTITY_QUERY = `
query FitmentManagerProduct($id: ID!) {
  product(id: $id) {
    id
    title
    handle
    vendor
    mpn: metafield(namespace: "custom", key: "mpn") { value }
    oeRefs: metafield(namespace: "custom", key: "oe_references") { value }
    linkedVehicles: metafield(namespace: "custom", key: "linked_vehicle") { value }
    variants(first: 1) { nodes { id sku } }
  }
}
`;

async function fetchJson(url: string, headers: Record<string, string>, ms: number) {
  try {
    const res = (await withTimeout(fetch(url, { headers }), ms)) as Response;
    const data = (await res.json().catch(() => ({}))) as Row;
    if (!res.ok) return { ...data, status: res.status };
    return data || {};
  } catch (err) {
    return { error: "network", detail: String((err as Error)?.message || "network") };
  }
}

async function catalogueGet(api: any, path: string) {
  const open = await fetchJson("https://fitment-manager.vercel.app/storefront-catalogue" + path, {}, 5000);
  if (open && !open.error && !open.status) return open;
  let token = "";
  try {
    if (api?.sessionToken && typeof api.sessionToken.get === "function") {
      token = await withTimeout(api.sessionToken.get(), 4000);
    }
  } catch (err) {
    token = "";
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const authed = await fetchJson("https://fitment-manager.vercel.app/api/ocean" + path, headers, 12000);
  if (authed && !authed.error) return authed;
  return open && open.error ? open : authed;
}

function selectOptions(rows: Row[], labelOf: (row: Row) => string, valueOf: (row: Row) => string) {
  return rows
    .map((row) => ({ value: valueOf(row), label: labelOf(row) }))
    .filter((row) => row.value);
}

function itemLine(item: ItemInfo) {
  return [item.vendor, item.sku ? "SKU " + item.sku : "", item.mpn ? "MPN " + item.mpn : ""].filter(Boolean).join(" · ");
}

export function VehicleBar() {
  const api = useApi() as any;
  const apiRef = useRef(api);
  apiRef.current = api;
  const [item, setItem] = useState<ItemInfo>(EMPTY_ITEM);
  const [makes, setMakes] = useState<Row[]>([]);
  const [models, setModels] = useState<Row[]>([]);
  const [engines, setEngines] = useState<Row[]>([]);
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [engineId, setEngineId] = useState("");
  const [mode, setMode] = useState(MODE_EXACT);
  const [note, setNote] = useState("Loading compatible vehicles…");
  const [matchNote, setMatchNote] = useState("");
  const [saved, setSaved] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const run = async (gid: string) => {
      const numeric = gid.split("/").pop() || "";
      const productGid = gid.startsWith("gid://") ? gid : "gid://shopify/Product/" + numeric;
      let nextItem = { ...EMPTY_ITEM };
      let variantId = "";
      try {
        const res = (await withTimeout(
          fetch("shopify:admin/api/graphql.json", {
            method: "POST",
            body: JSON.stringify({ query: PRODUCT_IDENTITY_QUERY, variables: { id: productGid } }),
          }),
          8000,
        )) as Response;
        const payload = await res.json();
        const node = payload?.data?.product || {};
        const variant = node?.variants?.nodes?.[0] || {};
        nextItem = {
          title: String(node.title || ""),
          vendor: String(node.vendor || ""),
          sku: String(variant.sku || ""),
          mpn: String(node.mpn?.value || ""),
          oe: parseReferenceList(node.oeRefs?.value),
          handle: String(node.handle || ""),
        };
        variantId = String(variant.id || "").split("/").pop() || "";
        const listed = vehiclesFromLabels(node.linkedVehicles?.value);
        if (listed.length) nextItem = Object.assign(nextItem, { listed });
      } catch (err) {
        nextItem = { ...EMPTY_ITEM };
      }
      if (cancelled) return;
      setItem(nextItem);
      const result = await loadCompatible((path: string) => catalogueGet(apiRef.current, path), nextItem, numeric, variantId);
      if (cancelled) return;
      const catalogueRows = result.rows || [];
      const rows = catalogueRows.length ? catalogueRows : (nextItem as ItemInfo & { listed?: Row[] }).listed || [];
      const scope = applyVehicleScope(rows);
      setSaved(rows);
      setMatchNote(result.matchNote || "");
      setMakes(scope.makes);
      setModels(scope.models);
      setEngines(scope.engines);
      setMakeId(scope.makeId);
      setModelId(scope.modelId);
      setEngineId("");
      setNote(rows.length ? "" : result.errorText || "No compatible vehicles are linked to this item.");
    };

    const look = () => {
      const gid = readSelectedProductId(apiRef.current);
      if (gid) {
        run(gid);
        return;
      }
      attempts += 1;
      if (attempts < 8) timer = setTimeout(look, 400);
      else if (!cancelled) setNote("This product could not be read.");
    };
    look();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  function onMake(value: string) {
    setMakeId(value);
    setModelId("");
    setEngineId("");
    setEngines([]);
    if (!value) {
      setModels([]);
      return;
    }
    const nextModels = modelsFrom(saved, value);
    setModels(nextModels);
    if (nextModels.length === 1) {
      const nextModel = String(nextModels[0].id);
      setModelId(nextModel);
      setEngines(enginesFrom(saved, value, nextModel));
    }
  }

  function onModel(value: string) {
    setModelId(value);
    setEngineId("");
    setEngines(value ? enginesFrom(saved, makeId, value) : []);
  }

  function onClear() {
    const scope = applyVehicleScope(saved);
    setMakeId(scope.makeId);
    setModelId(scope.modelId);
    setEngines(scope.engines);
    setModels(scope.models);
    setEngineId("");
    setMode(MODE_EXACT);
  }

  const visible = filterVehicles(saved, makeId, modelId, engineId, mode, engineKey, engineCode);
  const shown = visible.slice(0, 40);
  const line = itemLine(item);

  return (
    <BlockStack gap="base">
      <BlockStack gap="base">
        <Text fontWeight="bold">{item.title || "This item"}</Text>
        {line ? <Text>{line}</Text> : null}
        {item.oe.length ? <Text>{"OE " + item.oe.join(", ")}</Text> : null}
      </BlockStack>
      <Text fontWeight="bold">
        {saved.length ? "Compatible vehicles · " + saved.length : "Compatible vehicles"}
      </Text>
      {matchNote ? <Text>{matchNote}</Text> : null}
      {note ? <Banner tone="warning" title={note} /> : null}
      {saved.length ? (
        <InlineStack gap="base" blockAlign="center">
          <Text fontWeight="bold">VEHICLE</Text>
          <Select
            label="Make"
            placeholder="Make"
            value={makeId}
            onChange={onMake}
            options={selectOptions(makes, (row) => String(row.name), (row) => String(row.id))}
          />
          <Select
            label="Model"
            placeholder="Model"
            value={modelId}
            disabled={!makeId}
            onChange={onModel}
            options={selectOptions(models, (row) => String(row.name), (row) => String(row.id))}
          />
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
      ) : null}
      {saved.length ? (
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
      ) : null}
      {shown.map((row) => (
        <Text key={String(row.fitment_id || row.vehicle_id || row.vehicle_key || savedVehicleLabel(row))}>
          {(savedVehicleLabel(row) || "Vehicle") + (row.verification_status ? " · " + row.verification_status : "")}
        </Text>
      ))}
      {visible.length > shown.length ? (
        <Text>
          Showing {shown.length} of {visible.length} compatible vehicles
        </Text>
      ) : null}
    </BlockStack>
  );
}
