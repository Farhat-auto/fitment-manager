import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appHref, canonicalizeIframePathname, inboundRemixPath, stripAdminMount } from "../app/embedded-nav.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "build" || name === "dist") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(tsx|ts|js|jsx)$/.test(name)) acc.push(full);
  }
  return acc;
}

let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log("PASS", name);
  } catch (error) {
    failed += 1;
    console.error("FAIL", name, error);
  }
}

check("canonical destinations stay under /app", () => {
  assert.equal(appHref("products"), "/app/products");
  assert.equal(appHref("/app/products"), "/app/products");
  assert.equal(appHref("/app"), "/app");
  assert.equal(appHref("/app/products", "?shop=g5uxzq-gb.myshopify.com"), "/app/products?shop=g5uxzq-gb.myshopify.com");
  assert.equal(appHref("/app/fitment/vemo-pump", "?q=1"), "/app/fitment/vemo-pump?q=1");
  assert.equal(appHref("/app/images", "productId=10746583548247"), "/app/images?productId=10746583548247");
});

check("leaked Admin mount is stripped, never doubled", () => {
  assert.equal(stripAdminMount("/apps/fitment-manager-2/app/products"), "/app/products");
  assert.equal(
    appHref("/apps/fitment-manager-2/app/products"),
    "/app/products",
  );
  assert.equal(
    appHref("/apps/fitment-manager-2/apps/fitment-manager-2/app/products"),
    "/app/products",
  );
  assert.equal(appHref("/apps/fitment-manager-2"), "/app");
  const href = appHref("/apps/fitment-manager-2/app/products");
  assert.equal(href.includes("/apps/fitment-manager-2/apps/fitment-manager-2"), false);
  assert.match(href, /^\/app(\/|$)/);
});

check("iframe canonicalize strips mount before Remix hydrates", () => {
  assert.equal(canonicalizeIframePathname("/app/products"), null);
  assert.equal(canonicalizeIframePathname("/apps/fitment-manager-2/app/products"), "/app/products");
  assert.equal(
    canonicalizeIframePathname("/apps/fitment-manager-2/apps/fitment-manager-2/app/products"),
    "/app/products",
  );
});

check("inbound leaked Admin URL canonicalizes to /app, never doubles", () => {
  assert.equal(inboundRemixPath("/"), "/app");
  assert.equal(inboundRemixPath("/apps/fitment-manager-2"), "/app");
  assert.equal(inboundRemixPath("/apps/fitment-manager-2/app/products"), "/app/products");
  assert.equal(
    inboundRemixPath("/apps/fitment-manager-2/apps/fitment-manager-2/app/products"),
    "/app/products",
  );
  const index = source("app/routes/_index.tsx");
  assert.match(index, /inboundRemixPath/);
  assert.doesNotMatch(index, /redirect\(`\/\$\{nested/);
});

check("home does not use relative ../ destinations", () => {
  const home = source("app/routes/app._index.tsx");
  assert.doesNotMatch(home, /embeddedPath/);
  assert.doesNotMatch(home, /`\.\.\//);
  assert.match(home, /const to = \(path: string\) => appHref\(path, search\)/);
  assert.match(home, /to\("\/app\/products"\)/);
  assert.match(home, /to\("\/app\/import"\)/);
  assert.match(home, /to\("\/app\/export"\)/);
  assert.match(home, /to\("\/app\/images"\)/);
  assert.match(home, /to\("\/app\/settings"\)/);
  assert.doesNotMatch(home, /\/apps\/fitment-manager-2\/app/);
});

check("outbound route navigation never prepends /apps/fitment-manager-2", () => {
  const files = walk(join(root, "app/routes")).concat(
    walk(join(root, "extensions")).filter((f) => !f.includes("/dist/")),
  );
  files.push(join(root, "app/embedded-nav.ts"));
  files.push(join(root, "app/entry.client.tsx"));
  for (const file of files) {
    const rel = file.slice(root.length + 1);
    const text = readFileSync(file, "utf8");
    if (rel === "app/routes/_index.tsx") {
      assert.match(text, /inboundRemixPath/);
      continue;
    }
    const navHits = text.match(/["'`]\/apps\/fitment-manager-2[^"'`]*/g) || [];
    assert.equal(navHits.length, 0, `${rel} outbound prefix ${navHits.join(", ")}`);
    if (rel.startsWith("app/routes/") && rel.endsWith(".tsx")) {
      assert.doesNotMatch(text, /to=\{\s*`\.\.\//);
    }
  }
});

check("App Bridge AppProvider remains the embed strategy", () => {
  const app = source("app/routes/app.tsx");
  assert.match(app, /AppProvider/);
  assert.match(app, /isEmbeddedApp/);
  assert.match(app, /ui-nav-menu/);
  assert.match(app, /to="\/app\/products"/);
  const entry = source("app/entry.client.tsx");
  assert.match(entry, /canonicalizeIframePathname/);
  assert.match(entry, /history\.replaceState/);
  const vercel = source("vercel.json");
  assert.match(vercel, /"destination": "\/:path\*"/);
  assert.doesNotMatch(vercel, /"destination": "\/apps\//);
});

if (failed) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log("\nAll embedded navigation checks passed");
