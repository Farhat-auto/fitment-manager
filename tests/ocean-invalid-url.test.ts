import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isHttpUrl, oceanCatalogueBase } from "../app/ocean/catalogueUrl.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Exact Preview runtime input from Vercel dpl_G1idXoTD5CirX3yd7WeHLymWdSHE
 * GET /app/products/10639645671767 → TypeError ERR_INVALID_URL.
 * OCEAN_CATALOGUE_URL was a SHA-256 hex, not an http(s) origin.
 */
const PREVIEW_INVALID_OCEAN_URL =
  "d90800529728b593cad37811492e1a94ed1b1efefed77c48c8e531b9462f41c9";
const PRODUCT_FITMENT_HREF =
  "d90800529728b593cad37811492e1a94ed1b1efefed77c48c8e531b9462f41c9/ocean-catalogue-manager/shopify-admin/product-fitment?shopify_product_id=10639645671767&shopify_variant_id=53087436898647&sku=HI-BRIT-HB-00294&handle=hi-brit-hb-00294-electric-water-pump-m274-w205-2742000207&brand=HI-BRIT";

let failed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log("PASS", name))
    .catch((error) => {
      failed += 1;
      console.error("FAIL", name, error);
    });
}

await check("runtime TypeError ERR_INVALID_URL is reproduced by the Preview fetch input", () => {
  assert.throws(
    () => new URL(PRODUCT_FITMENT_HREF),
    (error: unknown) => {
      assert.equal(error instanceof TypeError, true);
      assert.equal((error as NodeJS.ErrnoException).code, "ERR_INVALID_URL");
      assert.equal((error as NodeJS.ErrnoException).input, PRODUCT_FITMENT_HREF);
      return true;
    },
  );
});

await check("oceanCatalogueBase rejects the Preview hash so fetch is never called", () => {
  assert.equal(oceanCatalogueBase(PREVIEW_INVALID_OCEAN_URL), "");
  assert.equal(isHttpUrl(PREVIEW_INVALID_OCEAN_URL), false);
  assert.equal(isHttpUrl(PRODUCT_FITMENT_HREF), false);
  assert.equal(oceanCatalogueBase(""), "");
  assert.equal(oceanCatalogueBase("not-a-url"), "");
  assert.equal(
    oceanCatalogueBase("https://farhat-auto-parts-staging-38316647.dev.odoo.com/"),
    "https://farhat-auto-parts-staging-38316647.dev.odoo.com",
  );
});

await check("canonical product loader fail-softs Ocean listing like classification", () => {
  const productPage = readFileSync(join(root, "app/routes/app.products.$productId.tsx"), "utf8");
  const client = readFileSync(join(root, "app/ocean/client.server.ts"), "utf8");
  assert.match(productPage, /OCEAN_PRODUCT_FITMENT_FAILED/);
  assert.match(productPage, /try \{\s*listing = await oceanProductFitmentGet/);
  assert.match(productPage, /CLASSIFICATION_CATEGORIES_FAILED/);
  assert.match(client, /ocean_catalogue_url_invalid/);
  assert.match(client, /ERR_INVALID_URL/);
  assert.match(client, /oceanCatalogueBase/);
  assert.match(client, /OCEAN_REQUEST_FAILED/);
  assert.doesNotMatch(client, /return `\$\{base\}\$\{MANAGER_PREFIX\}/);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll Ocean invalid-URL regression tests passed");
