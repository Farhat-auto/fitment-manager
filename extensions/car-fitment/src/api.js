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

function withTimeout(promise, ms) {
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

async function authHeaders() {
  const headers = { "content-type": "application/json" };
  try {
    if (shopify && shopify.sessionToken && typeof shopify.sessionToken.get === "function") {
      const token = await withTimeout(shopify.sessionToken.get(), 4000);
      if (token) headers.Authorization = "Bearer " + token;
    }
  } catch (err) {
    // A hung session token must not leave the product page on the spinner.
  }
  return headers;
}

function catalogueUrls(path) {
  return appOrigins().map((origin) => origin + "/api/ocean" + path);
}

export async function publicCatalogueGet(path) {
  const url = "https://fitment-manager.vercel.app/storefront-catalogue" + path;
  try {
    const res = await withTimeout(fetch(url), 5000);
    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      data = {};
    }
    if (!data || typeof data !== "object") data = {};
    if (res.ok) return data;
  } catch (err) {
    // The open catalogue can be blocked from the admin sandbox. The app route below is allowed.
  }
  return catalogueGet(path);
}

export async function catalogueGet(path) {
  try {
    const res = await withTimeout(fetch("/api/ocean" + path), 25000);
    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      data = {};
    }
    if (!data || typeof data !== "object") data = {};
    if (
      res.ok &&
      (Array.isArray(data.fitments) ||
        Array.isArray(data.makes) ||
        Array.isArray(data.models) ||
        Array.isArray(data.engines) ||
        Array.isArray(data.types) ||
        Array.isArray(data.generations) ||
        Array.isArray(data.results) ||
        data.unmapped === true ||
        data.ok === true)
    ) {
      return data;
    }
  } catch (err) {
    // The admin runtime resolves this relative path. An absolute URL is the fallback.
  }
  const headers = await authHeaders();
  const urls = catalogueUrls(path);
  let failure = {};
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const res = await withTimeout(fetch(urls[i], { headers }), 8000);
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
  try {
    const res = await fetch("/api/ocean" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      data = {};
    }
    if (res.ok && data && typeof data === "object") return data;
  } catch (err) {
    // The admin runtime authenticates a root-relative app path. An absolute URL is the fallback.
  }
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
