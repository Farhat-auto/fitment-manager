function appOrigins() {
  const origins = ["https://fitment-manager.vercel.app"];
  try {
    const cfg = (shopify && shopify.config) || {};
    const env = (shopify && shopify.env) || {};
    [cfg.appUrl, cfg.app_url, env.APP_URL, shopify.appUrl].forEach((value) => {
      const origin = String(value || "").replace(/\/+$/, "");
      if (origin && origin.indexOf("http") === 0) origins.unshift(origin);
    });
  } catch (err) {
    // Admin UI may not expose app URL.
  }
  return Array.from(new Set(origins));
}

async function authHeaders() {
  const headers = { "content-type": "application/json" };
  try {
    if (shopify && shopify.sessionToken && typeof shopify.sessionToken.get === "function") {
      const token = await shopify.sessionToken.get();
      if (token) headers.Authorization = "Bearer " + token;
    }
  } catch (err) {
    // Session token is required for the Remix BFF; retry without it fails closed.
  }
  return headers;
}

function catalogueUrls(path) {
  return appOrigins().map((origin) => origin + "/api/ocean" + path);
}

export async function catalogueGet(path) {
  const headers = await authHeaders();
  const urls = catalogueUrls(path);
  let failure = {};
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const res = await fetch(urls[i], { headers });
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
      return data;
    } catch (err) {
      failure = { error: "network" };
    }
  }
  return failure;
}

export async function cataloguePost(path, body) {
  const headers = await authHeaders();
  const urls = catalogueUrls(path);
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const res = await fetch(urls[i], {
        method: "POST",
        headers,
        body: JSON.stringify(body || {}),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && typeof data === "object") return data;
    } catch (err) {
      // Try the next Fitment Manager origin.
    }
  }
  return { ok: false, error: "catalogue_unavailable" };
}

export async function adminGraphql(query, variables) {
  const res = await fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

export async function cataloguePages(path, keys) {
  const names = Array.isArray(keys) ? keys : [keys];
  const rows = [];
  const seen = {};
  let offset = 0;
  for (let page = 0; page < 40; page += 1) {
    const join = path.indexOf("?") === -1 ? "?" : "&";
    const payload = await catalogueGet(path + join + "limit=250&offset=" + offset);
    let batch = [];
    for (let i = 0; i < names.length; i += 1) {
      const found = payload && payload[names[i]];
      if (found && found.length) {
        batch = found;
        break;
      }
    }
    let added = 0;
    batch.forEach((row) => {
      const id = row && (row.id || row.vehicle_key || row.vehicle_id);
      if (id == null || seen[id]) return;
      seen[id] = true;
      rows.push(row);
      added += 1;
    });
    const meta = (payload && payload.page_meta) || {};
    if (!batch.length || !added || meta.has_next === false) break;
    offset += Number(meta.limit) || batch.length;
  }
  return rows;
}

export function loadMakes() {
  return cataloguePages("/makes?has_vehicles=0", "makes");
}
