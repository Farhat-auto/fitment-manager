import assert from "node:assert/strict";
import {
  classificationFromTags,
  enrichCatalogueProducts,
  systemsFromLinkedProducts,
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
console.log("PASS storefront classification and fitment-state separation");
