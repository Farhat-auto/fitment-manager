import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listingBelongsTo } from "../app/ocean/identity.ts";
import { odooUrl, shopifyAdminUrl, storefrontUrl } from "../app/ocean/product-link.ts";

function source(rel: string) {
  return readFileSync(rel, "utf8");
}

assert.equal(
  listingBelongsTo(
    { shopify_product_id: "10639645901143", sku: "HI-BRIT-HB-00319" },
    { shopify_product_id: "gid://shopify/Product/10639645901143", sku: "HB-00319" },
  ),
  true,
);
assert.equal(
  listingBelongsTo(
    { shopify_product_id: "10639645901143", sku: "HI-BRIT-HB-00319" },
    { shopify_product_id: "999", sku: "HI-BRIT-HB-00319" },
  ),
  false,
);

const admin = shopifyAdminUrl("g5uxzq-gb.myshopify.com", "gid://shopify/Product/10639645901143");
assert.equal(admin.error, "");
assert.match(admin.url, /\/store\/g5uxzq-gb\/products\/10639645901143$/);
assert.match(shopifyAdminUrl("", "1").error, /shop domain is missing/);
assert.match(shopifyAdminUrl("g5uxzq-gb.myshopify.com", "").error, /product ID is missing/);

const storefront = storefrontUrl("g5uxzq-gb.myshopify.com", "shock-absorber");
assert.equal(storefront.error, "");
assert.equal(storefront.url, "https://g5uxzq-gb.myshopify.com/products/shock-absorber");
assert.match(storefrontUrl("g5uxzq-gb.myshopify.com", "").error, /handle is missing/);

assert.match(odooUrl("", "57545", "").error, /Odoo host is not configured/);
assert.equal(odooUrl("https://odoo.example", "", "").error, "ODOO LINK MISSING");
assert.match(odooUrl("https://odoo.example", "57545", "1").url, /model=product\.template/);

const product = source("app/routes/app.products.$productId.tsx");
assert.match(product, /Open Shopify Admin/);
assert.match(product, /Open Storefront/);
assert.match(product, /Open Odoo/);
assert.match(product, /Open Catalogue Record/);
assert.match(product, /Open Fitment Review/);
assert.match(product, /oceanGet\("\/product-link"/);
assert.match(product, /CATALOGUE LINK MISSING/);

const linker = source("app/routes/app.product-linker.tsx");
const filters = source("app/ocean/product-link.ts");
assert.match(linker, /Auto Link Safe Matches/);
assert.match(linker, /auto_link_safe/);
assert.match(filters, /missing_odoo/);
assert.match(filters, /missing_catalogue/);
assert.match(filters, /sync_failed/);
assert.match(linker, /title_used: false/);
assert.doesNotMatch(linker, /identities\.push\(\{[^}]*title/s);

const home = source("app/routes/app._index.tsx");
assert.match(home, /bucket=authoritative/);
assert.match(home, /bucket=legacy/);
assert.match(home, /status=pending/);
assert.match(home, /status=failed/);
assert.match(home, /Product Linker/);

const quality = source("app/routes/app.catalogue-quality.tsx");
assert.match(quality, /bucket/);
assert.match(quality, /No authoritative candidates/);
assert.match(quality, /Legacy vehicle keys/);

const products = source("app/routes/app.products.tsx");
assert.match(products, /Open product failed: Shopify product ID is missing/);
assert.match(products, /Product Linker/);

console.log("PASS product link");
