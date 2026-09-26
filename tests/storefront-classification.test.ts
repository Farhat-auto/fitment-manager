import assert from "node:assert/strict";
import {
  classificationFromTags,
  enrichCatalogueProducts,
  filterLinkedProducts,
  normalizeStorefrontProduct,
  productGroupsFromLinkedProducts,
  systemsFromLinkedProducts,
  taxonomyIdsMatch,
} from "../app/ocean/storefrontClassification.ts";

const product = {
  shopify_product_id: "10758331629911",
  name: "BEMWQ 3131 6796 155",
  assembly_group_id: null,
  category_id: null,
  fitment: { state: "unverified", visible: false },
};
const tags = ["CAT:suspension-system", "GROUP:shock-absorbers", "SUBCAT:shock-absorbers-parts"];
const classification = classificationFromTags(tags);
assert.deepEqual(classification, {
  system: "suspension-system",
  group: "shock-absorbers",
  subcategory: "shock-absorbers-parts",
});
const [linked] = enrichCatalogueProducts([product], new Map([[product.shopify_product_id, classification]]));
assert.equal(linked.assembly_group_id, "suspension-system");
assert.equal(linked.category_id, "shock-absorbers");
assert.deepEqual(filterLinkedProducts([linked], new URLSearchParams("system_id=suspension-system")), [linked]);
assert.deepEqual(filterLinkedProducts([linked], new URLSearchParams("assembly_group_id=suspension-system&product_group_id=shock-absorbers")), [linked]);
assert.deepEqual(filterLinkedProducts([linked], new URLSearchParams("system_id=cooling-system")), []);
assert.deepEqual(filterLinkedProducts([linked], new URLSearchParams("category_id=water-pumps")), []);
assert.deepEqual(productGroupsFromLinkedProducts([linked], "suspension-system"), [{
  id: "shock-absorbers", name: "Shock Absorbers", group_id: "suspension-system",
  article_count: 0, pending_fitment_count: 1,
}]);
assert.deepEqual(productGroupsFromLinkedProducts([linked], "cooling-system"), []);
assert.deepEqual(systemsFromLinkedProducts([linked]), [{
  id: "suspension-system",
  name: "Suspension System",
  article_count: 0,
  pending_fitment_count: 1,
}]);
assert.equal(linked.fitment.state, "unverified");
assert.deepEqual(systemsFromLinkedProducts([{ ...linked, fitment: { state: "verified", visible: false } }]), []);
assert.equal(systemsFromLinkedProducts([{ ...linked, fitment: { state: "verified", visible: true } }])[0].article_count, 1);
assert.equal(enrichCatalogueProducts([{ ...linked, category_id: "manual-group" }], new Map([[product.shopify_product_id, classification]]))[0].category_id, "manual-group");
assert.deepEqual(classificationFromTags(["CAT:../unsafe"]), { system: "", group: "", subcategory: "" });
assert.equal(taxonomyIdsMatch("suspension", "suspension-system"), true);
assert.equal(taxonomyIdsMatch("cooling-system", "engine"), false);
assert.deepEqual(filterLinkedProducts([linked], new URLSearchParams("system_id=suspension")), [linked]);
const display = normalizeStorefrontProduct({
  ...linked,
  shopify_variant_id: "53310030348631",
  sku: "31316796155-BEMWQ",
  brand: "BEMWQ",
  handle: "shock-absorber-bemwq-31316796155",
}, "ovh-8a49866f9b684104bfcb");
assert.equal(display.shopify_fitment, false);
assert.equal(display.pending_fitment, true);
assert.equal(display.pdp_path, "/products/shock-absorber-bemwq-31316796155");
assert.equal(display.compatibility_indication, "Confirmation pending");
assert.equal(display.vehicle_key, "ovh-8a49866f9b684104bfcb");
assert.equal(normalizeStorefrontProduct({
  ...linked,
  fitment: { state: "verified", visible: true },
}).shopify_fitment, true);
assert.equal(productGroupsFromLinkedProducts([linked], "suspension").length, 1);
console.log("PASS storefront classification and fitment-state separation");
