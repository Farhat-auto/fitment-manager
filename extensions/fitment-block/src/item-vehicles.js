/** This product's compatible vehicles, from Fitment Manager item identity. */

export function parseReferenceList(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  if (raw.charAt(0) === "[") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || "").trim()).filter(Boolean);
      }
    } catch (err) {
      // A non-JSON value is split on commas below.
    }
  }
  return raw
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function vehicleMake(row) {
  return String((row && row.make_name) || "").trim() || "Compatible";
}

export function vehicleModel(row) {
  const model = String((row && row.model_name) || "").trim();
  const generation = String((row && row.generation_name) || "").trim();
  const years = String((row && row.year_range) || "").trim();
  let label = model;
  if (generation && label.indexOf(generation) < 0) {
    label = [label, generation].filter(Boolean).join(" ");
  }
  if (!label) label = generation || "Model";
  if (years && label.indexOf(years) < 0) label = (label + " " + years).trim();
  return label;
}

export function modelKey(row) {
  return vehicleMake(row) + "\t" + vehicleModel(row);
}

export function makesFrom(rows) {
  const seen = {};
  const makes = [];
  (rows || []).forEach((row) => {
    const name = vehicleMake(row);
    if (seen[name]) return;
    seen[name] = true;
    makes.push({ id: name, name: name });
  });
  return makes;
}

export function modelsFrom(rows, make) {
  const seen = {};
  const models = [];
  (rows || []).forEach((row) => {
    if (make && vehicleMake(row) !== make) return;
    const id = modelKey(row);
    if (seen[id]) return;
    seen[id] = true;
    models.push({ id: id, name: vehicleModel(row) });
  });
  return models;
}

export function enginesFrom(rows, make, model) {
  return (rows || []).filter((row) => {
    if (!row) return false;
    if (make && vehicleMake(row) !== make) return false;
    if (model && modelKey(row) !== model) return false;
    return true;
  });
}

export function filterVehicles(rows, make, model, engineId, mode, engineKey, engineCode) {
  const list = enginesFrom(rows, make, model);
  if (!engineId) return list;
  if (mode === "exact") return list.filter((row) => engineKey(row) === engineId);
  if (mode === "engine") {
    const selected = (rows || []).find((row) => engineKey(row) === engineId);
    const code = engineCode(selected);
    if (!code) return list.filter((row) => engineKey(row) === engineId);
    return list.filter((row) => engineCode(row) === code);
  }
  return list;
}

function compactBrand(value) {
  return String(value || "").replace(/[\s.]/g, "").toUpperCase();
}

export function pickCandidate(candidates, item) {
  const rows = (Array.isArray(candidates) ? candidates : []).filter((row) => row && row.sku);
  if (!rows.length) return null;
  const withFitment = rows.filter((row) => Number(row.fitment_count) > 0);
  const pool = withFitment.length ? withFitment : rows;
  const brand = compactBrand(item && item.vendor);
  if (brand) {
    const branded = pool.filter((row) => compactBrand(row.brand) === brand);
    if (branded.length) return branded[0];
  }
  return pool.find((row) => !row.discovery_only) || pool[0];
}

export function catalogueFailure(payload, emptyText) {
  if (!payload || typeof payload !== "object") return emptyText;
  if (payload.status) return emptyText + " (HTTP " + payload.status + ").";
  if (payload.error === "ocean_catalogue_url_missing") return "The vehicle catalogue is not connected.";
  if (payload.error === "network") return "Compatible vehicles could not be loaded.";
  if (payload.error) return emptyText + " (" + payload.error + ").";
  return emptyText;
}

export async function loadCompatible(get, item, numeric, variantId) {
  const params = new URLSearchParams();
  if (numeric) params.set("shopify_product_id", numeric);
  if (variantId) params.set("shopify_variant_id", variantId);
  if (item && item.sku) params.set("sku", item.sku);
  if (item && item.handle) params.set("handle", item.handle);
  if (item && item.vendor) params.set("brand", item.vendor);
  if (item && item.mpn) params.set("mpn", item.mpn);
  const direct = await get("/fitments?" + params.toString());
  const directRows = direct && Array.isArray(direct.fitments) ? direct.fitments : null;
  if (directRows && directRows.length) {
    return { rows: directRows, matchNote: "", errorText: "" };
  }
  if (direct && (direct.status || direct.error) && !directRows) {
    return {
      rows: [],
      matchNote: "",
      errorText: catalogueFailure(direct, "Compatible vehicles could not be loaded"),
    };
  }
  const numbers = [];
  const seenNumbers = {};
  ((item && item.oe) || []).forEach((number) => {
    const text = String(number || "").trim();
    const key = text.toUpperCase();
    if (!text || seenNumbers[key] || numbers.length >= 8) return;
    seenNumbers[key] = true;
    numbers.push(text);
  });
  const lookups = await Promise.all(
    numbers.map((number) => get("/oe?number=" + encodeURIComponent(number))),
  );
  const seenSku = {};
  for (let index = 0; index < lookups.length; index += 1) {
    const found = lookups[index];
    const results = found && Array.isArray(found.results) ? found.results : [];
    for (let hit = 0; hit < results.length; hit += 1) {
      const chosen = results[hit];
      const sku = chosen && chosen.sku;
      if (!sku || seenSku[sku]) continue;
      seenSku[sku] = true;
      const bySku = await get("/fitments?sku=" + encodeURIComponent(sku));
      const rows = bySku && Array.isArray(bySku.fitments) ? bySku.fitments : [];
      if (!rows.length) continue;
      const label = [chosen.brand, chosen.mpn || chosen.article_number || sku].filter(Boolean).join(" ");
      return {
        rows: rows,
        matchNote: "Compatible vehicles from " + label + " (OE " + numbers[index] + ").",
        errorText: "",
      };
    }
  }
  if (direct && direct.unmapped) {
    return {
      rows: [],
      matchNote: "",
      errorText: "This item is not linked to a catalogue article, so there are no compatible vehicles yet.",
    };
  }
  return { rows: [], matchNote: "", errorText: "No compatible vehicles are linked to this item." };
}

export function vehiclesFromLabels(value) {
  return parseReferenceList(value)
    .map((label) => {
      const parts = String(label)
        .split("/")
        .map((part) => part.trim());
      const make = parts[0] || "";
      const model = parts[1] || "";
      const generation = parts[2] || "";
      const engine = parts[3] || "";
      return {
        make_name: make,
        model_name: model,
        generation_name: generation,
        engine_code: engine,
        checkbox_label: label,
        vehicle_key: label,
      };
    })
    .filter((row) => row.make_name || row.checkbox_label);
}

export function applyVehicleScope(rows) {
  const makes = makesFrom(rows);
  let makeId = "";
  let modelId = "";
  let models = [];
  let engines = [];
  if (makes.length === 1) {
    makeId = String(makes[0].id);
    models = modelsFrom(rows, makeId);
    if (models.length === 1) {
      modelId = String(models[0].id);
      engines = enginesFrom(rows, makeId, modelId);
    }
  }
  return { makes: makes, models: models, engines: engines, makeId: makeId, modelId: modelId };
}
