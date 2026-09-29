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
  if (payload.error === "network") {
    const detail = String(payload.detail || "").trim();
    return detail ? emptyText + " (" + detail + ")." : emptyText + ".";
  }
  if (payload.error) return emptyText + " (" + payload.error + ").";
  return emptyText;
}

function catalogueTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve(promise).then(
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

/** Admin blocks resolve a relative app path and attach the session token. */
export async function fetchAppCatalogue(path) {
  const urls = ["api/ocean" + path, "https://fitment-manager.vercel.app/api/ocean" + path];
  let failure = { error: "network" };
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const res = await catalogueTimeout(fetch(urls[i]), 25000);
      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        data = {};
      }
      if (!data || typeof data !== "object") data = {};
      if (!res.ok) {
        failure = Object.assign({ status: res.status }, data);
        continue;
      }
      if (
        Array.isArray(data.fitments) ||
        Array.isArray(data.results) ||
        Array.isArray(data.makes) ||
        Array.isArray(data.models) ||
        Array.isArray(data.engines) ||
        Array.isArray(data.types) ||
        Array.isArray(data.generations) ||
        data.unmapped === true ||
        data.ok === true
      ) {
        return data;
      }
      failure = data.error ? data : failure;
    } catch (err) {
      failure = { error: "network", detail: String((err && err.message) || "network") };
    }
  }
  return failure;
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

/** Storefront ENGINE / VARIANT text is the catalogue display name. */
export function catalogueEngineLabel(row) {
  const display = row && (row.display_name || row.title || row.detail);
  if (display) return String(display);
  if (row && row.engine_code) return String(row.engine_code);
  if (row && row.name) return String(row.name);
  return "Engine";
}

export function selectedVehicleIds(engines, engineId, mode) {
  const rows = Array.isArray(engines) ? engines : [];
  const keyOf = (row) => String((row && (row.vehicle_key || row.vehicle_id || row.id)) || "");
  const codeOf = (row) => String((row && row.engine_code) || "").replace(/[\s.]/g, "").toUpperCase();
  if (mode === "exact") return engineId ? [String(engineId)] : [];
  if (mode === "engine") {
    const selected = rows.find((row) => keyOf(row) === String(engineId));
    const code = codeOf(selected);
    const matched = code ? rows.map((row) => (codeOf(row) === code ? keyOf(row) : "")).filter(Boolean) : [];
    if (matched.length) return matched;
    return engineId ? [String(engineId)] : [];
  }
  return rows.map(keyOf).filter(Boolean);
}

export async function loadCatalogueRows(get, path, keys) {
  const names = Array.isArray(keys) ? keys : [keys];
  const rows = [];
  const seen = {};
  let offset = 0;
  let failure = null;
  for (let page = 0; page < 8; page += 1) {
    const join = path.indexOf("?") === -1 ? "?" : "&";
    const payload = await get(path + join + "limit=250&offset=" + offset);
    let batch = null;
    for (let i = 0; i < names.length; i += 1) {
      const found = payload && payload[names[i]];
      if (Array.isArray(found)) {
        batch = found;
        break;
      }
    }
    if (!batch) {
      failure = payload;
      break;
    }
    batch.forEach((row) => {
      const id = row && (row.vehicle_key || row.vehicle_id || row.id);
      if (id == null || seen[id]) return;
      seen[id] = true;
      rows.push(row);
    });
    if (!batch.length || (payload && payload.has_next === false)) break;
    const limit = Number(payload && payload.limit) || batch.length;
    offset += limit;
    if (payload && payload.total != null && rows.length >= Number(payload.total)) break;
  }
  return { rows: rows, error: rows.length ? null : failure };
}

export async function postAppCatalogue(path, body) {
  const urls = ["api/ocean" + path, "https://fitment-manager.vercel.app/api/ocean" + path];
  let failure = { ok: false, error: "network" };
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const res = await catalogueTimeout(
        fetch(urls[i], {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body || {}),
        }),
        25000,
      );
      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        data = {};
      }
      if (!data || typeof data !== "object") data = {};
      if (!res.ok) {
        failure = Object.assign({ ok: false, status: res.status }, data);
        continue;
      }
      return data;
    } catch (err) {
      failure = { ok: false, error: "network", detail: String((err && err.message) || "network") };
    }
  }
  return failure;
}

function linkIdentity(item, numeric, variantId) {
  return {
    shopify_product_id: numeric || "",
    shopify_variant_id: variantId || "",
    sku: (item && item.sku) || "",
    brand: (item && item.vendor) || "",
    mpn: (item && item.mpn) || "",
    handle: (item && item.handle) || "",
    oe_references: (item && item.oe) || [],
  };
}

function linkFailure(payload) {
  if (!payload || typeof payload !== "object") return "This item could not be linked.";
  if (payload.error === "unmapped") {
    return "This item is not linked to a catalogue article, so the vehicle was not saved.";
  }
  if (payload.error === "article_exists") {
    return "A catalogue article already exists for this SKU. Map that article, then link the vehicle.";
  }
  if (payload.error === "network" || payload.status) {
    return catalogueFailure(payload, "This item could not be linked");
  }
  if (payload.error) return "This item could not be linked (" + payload.error + ").";
  return "This item could not be linked.";
}

export async function linkItemToVehicles(post, item, numeric, variantId, vehicleIds) {
  const ids = (vehicleIds || []).map((id) => String(id || "")).filter(Boolean);
  if (!ids.length) {
    return { ok: false, rows: [], added: 0, errorText: "Select a vehicle to link this item." };
  }
  const identity = linkIdentity(item, numeric, variantId);
  const addBody = Object.assign({}, identity, {
    action: "add",
    vehicle_ids: ids,
    source: "manual",
    verification_status: "UNVERIFIED",
  });
  let payload = await post("/product-fitment", addBody);
  const unmapped = payload && payload.ok === false && (payload.error === "unmapped" || payload.unmapped === true);
  if (unmapped) {
    const created = await post(
      "/article-create",
      Object.assign({}, identity, {
        action: "create",
        confirm: true,
        mapped_by: "fitment-manager-staff",
      }),
    );
    let ready = created && created.ok !== false && created.applied === true;
    if (!ready && created && created.error === "article_exists" && created.ocean_article_id) {
      const mapped = await post(
        "/article-map",
        Object.assign({}, identity, {
          action: "map",
          confirm: true,
          ocean_article_id: created.ocean_article_id,
          mapped_by: "fitment-manager-staff",
        }),
      );
      ready = mapped && mapped.ok !== false && mapped.applied === true;
      if (!ready) return { ok: false, rows: [], added: 0, errorText: linkFailure(mapped) };
    } else if (!ready) {
      return { ok: false, rows: [], added: 0, errorText: linkFailure(created) };
    }
    payload = await post("/product-fitment", addBody);
  }
  if (!payload || payload.ok === false) {
    return { ok: false, rows: [], added: 0, errorText: linkFailure(payload) };
  }
  const rows = Array.isArray(payload.fitments) ? payload.fitments : [];
  const added = Number(payload.added_count);
  const addedCount = Number.isFinite(added) ? added : 0;
  const savedIds = {};
  rows.forEach((row) => {
    const key = String((row && (row.vehicle_key || row.vehicle_id || row.id)) || "");
    if (key) savedIds[key] = true;
  });
  const missing = ids.filter((id) => !savedIds[id]);
  if (missing.length && !addedCount) {
    return { ok: false, rows: rows, added: 0, errorText: "The selected vehicle was not saved on this item." };
  }
  return { ok: true, rows: rows, added: addedCount, errorText: "" };
}
