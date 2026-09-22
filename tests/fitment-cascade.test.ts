import assert from "node:assert/strict";
import {
  catalogSystemGroupIdFromSubcategoryNode,
  metaobjectIdMatch,
  parentCatalogCategoryIdFromSystemGroupNode,
  subcategoriesForSystemGroup,
  systemGroupsForCategory,
} from "../app/utils/catalogMetaobjectParents.server.ts";

const COOLING = "gid://shopify/Metaobject/cooling-system";
const WATER_PUMPS = "gid://shopify/Metaobject/water-pumps";
const ELECTRIC = "gid://shopify/Metaobject/electric-water-pump";

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

check("theme contract: parent_category aliased field links Cooling System", () => {
  const node = {
    id: WATER_PUMPS,
    displayName: "Water Pumps",
    parent_category: {
      value: COOLING,
      reference: { id: COOLING, type: "catalog_main_category", handle: "cooling-system" },
    },
  };
  assert.equal(parentCatalogCategoryIdFromSystemGroupNode(node), COOLING);
  const rows = [
    { value: WATER_PUMPS, label: "Water Pumps", parentCategoryId: parentCatalogCategoryIdFromSystemGroupNode(node) },
    { value: "gid://shopify/Metaobject/brakes", label: "Brakes", parentCategoryId: "gid://shopify/Metaobject/braking" },
  ];
  const scoped = systemGroupsForCategory(rows, COOLING);
  assert.deepEqual(
    scoped.map((r) => r.label),
    ["Water Pumps"],
  );
});

check("parent_category value JSON array is read when reference is null", () => {
  const node = {
    id: WATER_PUMPS,
    parent_category: {
      value: JSON.stringify([COOLING]),
      reference: null,
    },
  };
  assert.equal(parentCatalogCategoryIdFromSystemGroupNode(node), COOLING);
});

check("category GID suffix matches numeric product metafield values", () => {
  assert.equal(metaobjectIdMatch(COOLING, "cooling-system"), true);
  assert.equal(metaobjectIdMatch("gid://shopify/Metaobject/12345", "12345"), true);
  const rows = [{ value: WATER_PUMPS, label: "Water Pumps", parentCategoryId: COOLING }];
  const scoped = systemGroupsForCategory(rows, "cooling-system");
  assert.equal(scoped.length, 1);
});

check("cheap fields[] listing still resolves parent_category", () => {
  const node = {
    id: WATER_PUMPS,
    fields: [
      {
        key: "parent_category",
        value: COOLING,
        reference: { id: COOLING, type: "catalog_main_category" },
      },
    ],
  };
  assert.equal(parentCatalogCategoryIdFromSystemGroupNode(node), COOLING);
});

check("theme contract: subcategory parent_group links Water Pumps", () => {
  const node = {
    id: ELECTRIC,
    displayName: "Electric Water Pump",
    parent_group: {
      value: WATER_PUMPS,
      reference: { id: WATER_PUMPS, type: "catalog_system_group" },
    },
  };
  assert.equal(catalogSystemGroupIdFromSubcategoryNode(node), WATER_PUMPS);
  const rows = [
    {
      value: ELECTRIC,
      label: "Electric Water Pump",
      systemGroupId: catalogSystemGroupIdFromSubcategoryNode(node),
    },
  ];
  assert.equal(subcategoriesForSystemGroup(rows, WATER_PUMPS).length, 1);
  assert.equal(subcategoriesForSystemGroup(rows, COOLING).length, 0);
});

check("missing parent links fail closed — no invented system groups", () => {
  const rows = [
    { value: WATER_PUMPS, label: "Water Pumps", parentCategoryId: "" },
    { value: "gid://shopify/Metaobject/other", label: "Other", parentCategoryId: "" },
  ];
  assert.deepEqual(systemGroupsForCategory(rows, COOLING), []);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll classification cascade tests passed");
