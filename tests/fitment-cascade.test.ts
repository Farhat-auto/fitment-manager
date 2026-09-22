import assert from "node:assert/strict";
import {
  catalogParentRefFromField,
  catalogSystemGroupIdFromSubcategoryNode,
  metaobjectIdMatch,
  parentCatalogCategoryIdFromSystemGroupNode,
  parentCatalogCategoryRefFromSystemGroupNode,
  resolveCatalogIdentity,
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

check("Admin GraphQL reference.id is the theme parent_category contract", () => {
  const node = {
    id: WATER_PUMPS,
    parent_category: {
      type: "metaobject_reference",
      value: COOLING,
      reference: { id: COOLING, type: "catalog_main_category", handle: "cooling-system", displayName: "Cooling System" },
    },
  };
  const ref = parentCatalogCategoryRefFromSystemGroupNode(node);
  assert.equal(ref?.representation, "reference.id");
  assert.equal(ref?.id, COOLING);
  assert.equal(ref?.handle, "cooling-system");
  assert.equal(ref?.label, "Cooling System");
});

check("value.gid is used when reference is null", () => {
  const node = {
    id: WATER_PUMPS,
    parent_category: { value: COOLING, reference: null },
  };
  const ref = parentCatalogCategoryRefFromSystemGroupNode(node);
  assert.equal(ref?.representation, "value.gid");
  assert.equal(ref?.id, COOLING);
});

check("JSON-encoded GID array is parsed", () => {
  const ref = catalogParentRefFromField(
    { value: JSON.stringify([COOLING]), reference: null },
    "parent_category",
  );
  assert.equal(ref?.representation, "value.json_gid_array");
  assert.equal(ref?.id, COOLING);
});

check("handle-or-label parent matches Cooling System via catalog identity", () => {
  const node = {
    id: WATER_PUMPS,
    parent_category: { value: "cooling-system", reference: null },
  };
  const ref = parentCatalogCategoryRefFromSystemGroupNode(node);
  assert.equal(ref?.representation, "value.handle_or_label");
  assert.equal(ref?.handle, "cooling-system");
  const categories = [{ value: COOLING, handle: "cooling-system", label: "Cooling System" }];
  const ident = resolveCatalogIdentity(categories, { id: COOLING });
  assert.equal(ident.handle, "cooling-system");
  assert.equal(ident.label, "Cooling System");
  const rows = [
    {
      value: WATER_PUMPS,
      label: "Water Pumps",
      parentCategoryHandle: ref?.handle,
      parentCategoryLabel: "Cooling System",
    },
  ];
  assert.equal(systemGroupsForCategory(rows, ident).length, 1);
  assert.equal(systemGroupsForCategory(rows, { id: COOLING, label: "Cooling System" }).length, 1);
});

check("list.metaobject_reference uses references.nodes.id", () => {
  const ref = catalogParentRefFromField(
    {
      value: JSON.stringify([COOLING]),
      reference: null,
      references: { nodes: [{ id: COOLING, type: "catalog_main_category", handle: "cooling-system" }] },
    },
    "parent_category",
  );
  assert.equal(ref?.representation, "references.nodes.id");
  assert.equal(ref?.id, COOLING);
});

check("Liquid-style parent.system.id JSON is parsed", () => {
  const ref = catalogParentRefFromField(
    { value: JSON.stringify({ system: { id: COOLING } }), reference: null },
    "parent_category",
  );
  assert.equal(ref?.id, COOLING);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll classification cascade tests passed");
