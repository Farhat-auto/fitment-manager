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
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const res = await fetch(urls[i], { headers });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && typeof data === "object" && !data.error) return data;
      if (data && data.fitments) return data;
    } catch (err) {
      // Try the next Fitment Manager origin.
    }
  }
  return {};
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
