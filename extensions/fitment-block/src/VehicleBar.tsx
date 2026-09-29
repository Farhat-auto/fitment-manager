import { useEffect, useRef, useState } from "react";
import {
  BlockStack,
  Button,
  ChoiceList,
  InlineStack,
  Select,
  Text,
} from "@shopify/ui-extensions-react/admin";
import { useApi } from "@shopify/ui-extensions-react/admin";
import {
  catalogueFailure,
  engineChoiceLabel,
  fetchAppCatalogue,
  linkItemToVehicles,
  loadCatalogueRows,
  loadCompatible,
  mergeVehicles,
  parseReferenceList,
  postAppCatalogue,
  vehiclesFromLabels,
} from "./item-vehicles.js";

type Row = Record<string, any>;

type ItemInfo = {
  title: string;
  vendor: string;
  sku: string;
  mpn: string;
  oe: string[];
  handle: string;
  numeric: string;
  variantId: string;
};

const EMPTY_ITEM: ItemInfo = {
  title: "",
  vendor: "",
  sku: "",
  mpn: "",
  oe: [],
  handle: "",
  numeric: "",
  variantId: "",
};

function savedVehicleLabel(row: Row) {
  const direct = row && (row.checkbox_label || row.customer_label || row.display_name || row.title || row.detail);
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

function selectOptions(rows: Row[], labelOf: (row: Row) => string, valueOf: (row: Row) => string) {
  return rows
    .map((row) => ({ value: valueOf(row), label: labelOf(row) }))
    .filter((row) => row.value);
}

function itemLine(item: ItemInfo) {
  return [item.vendor, item.sku ? "SKU " + item.sku : "", item.mpn ? "MPN " + item.mpn : ""].filter(Boolean).join(" · ");
}

function linkStatus(result: { ok: boolean; added: number; rows: Row[]; errorText: string }) {
  if (!result.ok) return result.errorText;
  if (result.added) {
    return (
      "Saved " +
      result.added +
      (result.added === 1 ? " vehicle" : " vehicles") +
      " on this item. Linked in Fitment Manager and on the storefront."
    );
  }
  return "Saved. This vehicle is already linked in Fitment Manager and on the storefront.";
}

export function VehicleBar() {
  const api = useApi() as any;
  const apiRef = useRef(api);
  apiRef.current = api;
  const itemRef = useRef<ItemInfo>(EMPTY_ITEM);
  const requestRef = useRef(0);
  const [item, setItem] = useState<ItemInfo>(EMPTY_ITEM);
  const [makes, setMakes] = useState<Row[]>([]);
  const [models, setModels] = useState<Row[]>([]);
  const [engines, setEngines] = useState<Row[]>([]);
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [engineId, setEngineId] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [note, setNote] = useState("Loading manufacturers…");
  const [matchNote, setMatchNote] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadCatalogueRows(
      (path: string) => fetchAppCatalogue(path),
      "/makes?has_vehicles=0",
      "makes",
      (rows: Row[]) => {
        if (!cancelled) {
          setMakes(rows);
          setNote(rows.length + " manufacturers");
        }
      },
    ).then((loaded) => {
      if (cancelled) return;
      const rows = loaded.rows || [];
      setMakes(rows);
      setNote(rows.length ? rows.length + " manufacturers" : catalogueFailure(loaded.error, "Makes could not be loaded"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const run = async (gid: string) => {
      const numeric = gid.split("/").pop() || "";
      const productGid = gid.startsWith("gid://") ? gid : "gid://shopify/Product/" + numeric;
      let nextItem = { ...EMPTY_ITEM, numeric: numeric };
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
          numeric: numeric,
          variantId: String(variant.id || "").split("/").pop() || "",
        };
        const listed = vehiclesFromLabels(node.linkedVehicles?.value);
        if (listed.length) nextItem = Object.assign(nextItem, { listed });
      } catch (err) {
        nextItem = { ...EMPTY_ITEM, numeric: numeric };
      }
      if (cancelled) return;
      itemRef.current = nextItem;
      setItem(nextItem);
      const result = await loadCompatible((path: string) => fetchAppCatalogue(path), nextItem, numeric, nextItem.variantId);
      if (cancelled) return;
      const catalogueRows = result.rows || [];
      const rows = catalogueRows.length ? catalogueRows : (nextItem as ItemInfo & { listed?: Row[] }).listed || [];
      setSaved(rows);
      setMatchNote(result.matchNote || "");
      if (!rows.length && result.errorText && result.errorText.indexOf("could not be loaded") >= 0) {
        setLinkNote(result.errorText);
      }
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

  async function onMake(value: string) {
    const request = requestRef.current + 1;
    requestRef.current = request;
    setMakeId(value);
    setModelId("");
    setEngineId("");
    setChecked([]);
    setModels([]);
    setEngines([]);
    setLinkNote("");
    if (!value) return;
    const loaded = await loadCatalogueRows(
      (path: string) => fetchAppCatalogue(path),
      "/models?has_vehicles=0&make_id=" + encodeURIComponent(value),
      "models",
    );
    if (requestRef.current !== request) return;
    setModels(loaded.rows || []);
    if (!(loaded.rows || []).length) {
      setLinkNote(catalogueFailure(loaded.error, "No models were returned for this make"));
    }
  }

  async function onModel(value: string) {
    const request = requestRef.current + 1;
    requestRef.current = request;
    setModelId(value);
    setEngineId("");
    setChecked([]);
    setEngines([]);
    setLinkNote("");
    if (!value || !makeId) return;
    const loaded = await loadCatalogueRows(
      (path: string) => fetchAppCatalogue(path),
      "/engines?has_vehicles=0&make_id=" +
        encodeURIComponent(makeId) +
        "&model_id=" +
        encodeURIComponent(value),
      ["engines", "types"],
    );
    if (requestRef.current !== request) return;
    setEngines(loaded.rows || []);
    if (!(loaded.rows || []).length) {
      setLinkNote(catalogueFailure(loaded.error, "No engines were returned for this model"));
    }
  }

  function onClear() {
    requestRef.current += 1;
    setMakeId("");
    setModelId("");
    setEngineId("");
    setChecked([]);
    setModels([]);
    setEngines([]);
    setLinkNote("");
  }

  function onEngines(value: string | string[]) {
    const next = Array.isArray(value) ? value : value ? [value] : [];
    setChecked(next.map((id) => String(id)).filter(Boolean));
  }

  function selectAllEngines() {
    setChecked(
      engines
        .map((row) => String(row.vehicle_key || row.vehicle_id || row.id))
        .filter(Boolean),
    );
  }

  async function saveVehicles(ids: string[]) {
    if (!ids.length) {
      setLinkNote("Select a vehicle to link this item.");
      return;
    }
    const current = itemRef.current;
    setBusy(true);
    setLinkNote("Saving this link…");
    const result = await linkItemToVehicles(
      (path: string, body: Row) => postAppCatalogue(path, body),
      current,
      current.numeric,
      current.variantId,
      ids,
      "VERIFIED",
    );
    setBusy(false);
    if (result.ok) {
      const merged = mergeVehicles(saved, result.rows);
      setSaved(merged);
      setEngineId("");
      setChecked([]);
      const total = merged.length;
      setLinkNote(
        "Added. " + total + (total === 1 ? " vehicle" : " vehicles") + " on this product. Tick more engines, or choose another model.",
      );
      return;
    }
    setLinkNote(linkStatus(result));
  }

  function onLink() {
    if (!checked.length) {
      setLinkNote("Tick the engines, then Add.");
      return;
    }
    void saveVehicles(checked);
  }

  const line = itemLine(item);
  const canLink = checked.length > 0 && !busy;
  const shown = saved.slice(0, 40);

  return (
    <BlockStack gap="base">
      <BlockStack gap="base">
        <Text fontWeight="bold">{item.title || "This item"}</Text>
        {line ? <Text>{line}</Text> : null}
        {item.oe.length ? <Text>{"OE " + item.oe.join(", ")}</Text> : null}
      </BlockStack>
      <Text fontWeight="bold">VEHICLE</Text>
      <Text>{linkNote || note || "Tick any engines for this model, then Add. Saved vehicles stay on this product."}</Text>
      <InlineStack gap="base" blockAlign="center">
        <Select
          label="Make"
          placeholder={makes.length ? "Make" : "Loading manufacturers…"}
          value={makeId}
          onChange={onMake}
          options={selectOptions(makes, (row) => String(row.name || row.title), (row) => String(row.id))}
        />
        <Select
          label="Model"
          placeholder="Model"
          value={modelId}
          disabled={!makeId}
          onChange={onModel}
          options={selectOptions(models, (row) => String(row.name || row.title), (row) => String(row.id))}
        />
        <Button variant="primary" disabled={!canLink} onPress={onLink}>
          {busy ? "Adding…" : checked.length ? "Add " + checked.length : "Add"}
        </Button>
        <Button variant="secondary" disabled={!engines.length || busy} onPress={selectAllEngines}>
          All engines
        </Button>
        <Button variant="tertiary" onPress={onClear}>
          Clear
        </Button>
      </InlineStack>
      {modelId ? (
        <ChoiceList
          multiple
          name="engines"
          value={checked}
          onChange={onEngines}
          choices={engines.map((row) => ({
            id: String(row.vehicle_key || row.vehicle_id || row.id),
            label: engineChoiceLabel(row, engines),
          }))}
        />
      ) : null}
      {matchNote ? <Text>{matchNote}</Text> : null}
      <Text fontWeight="bold">
        {saved.length ? "Compatible vehicles · " + saved.length : "Compatible vehicles"}
      </Text>
      {!saved.length ? <Text>This item is not linked to a vehicle yet.</Text> : null}
      {shown.map((row) => (
        <Text key={String(row.fitment_id || row.vehicle_id || row.vehicle_key || savedVehicleLabel(row))}>
          {(savedVehicleLabel(row) || "Vehicle") + (row.verification_status ? " · " + row.verification_status : "")}
        </Text>
      ))}
      {saved.length > shown.length ? (
        <Text>
          Showing {shown.length} of {saved.length} compatible vehicles
        </Text>
      ) : null}
    </BlockStack>
  );
}
