import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rowsForParent, sameMetaobjectId, withCurrentRow } from "../app/ocean/itemClassification.ts";

const car = readFileSync("app/components/CarFitment.tsx", "utf8");
const product = readFileSync("app/routes/app.products.$productId.tsx", "utf8");
const identity = readFileSync("app/ocean/metafields.ts", "utf8");
const save = readFileSync("app/ocean/itemClassification.server.ts", "utf8");

assert.match(car, /\/makes\?has_vehicles=0/);
assert.match(car, /has_next/);
assert.match(car, /pickedMakes/);
assert.match(car, /Find a make/);
assert.doesNotMatch(car, /oceanGet\("\/makes"\)/);
assert.match(car, /Selected makes/);
assert.match(car, /pickedModels/);
assert.match(car, /Find a model/);
assert.match(car, /Selected models/);
assert.doesNotMatch(car, /label="Model"/);

assert.match(product, /ItemClassification/);
assert.match(product, /classification_options/);
assert.match(product, /classification_save/);
assert.match(product, /Save item category|ItemClassification/);
assert.match(identity, /catalog_subcategory/);
assert.match(save, /metafieldsSet/);
assert.match(save, /Shopify did not accept the category write/);
assert.match(save, /saved: true/);
assert.doesNotMatch(save, /verification_status/);

const cooling = "gid://shopify/Metaobject/1";
const pumps = "gid://shopify/Metaobject/2";
const electric = "gid://shopify/Metaobject/3";
const itemCategories = [
  { value: pumps, label: "Water Pumps", parentId: cooling },
  { value: "gid://shopify/Metaobject/9", label: "Radiators", parentId: "gid://shopify/Metaobject/8" },
];
const scoped = rowsForParent(itemCategories, cooling);
assert.equal(scoped.unlinked, false);
assert.deepEqual(scoped.rows.map((row) => row.label), ["Water Pumps"]);
assert.equal(rowsForParent(itemCategories, "").rows.length, 0);

const unlinked = rowsForParent(
  [{ value: electric, label: "Electric Water Pump" }],
  pumps,
);
assert.equal(unlinked.unlinked, true);
assert.equal(unlinked.rows.length, 1);
assert.equal(sameMetaobjectId(pumps, "2"), true);

const kept = withCurrentRow([], electric, "Electric Water Pump");
assert.equal(kept[0].label, "Electric Water Pump");
assert.equal(withCurrentRow(kept, electric, "Electric Water Pump").length, 1);

console.log("PASS item category and multi-make");
