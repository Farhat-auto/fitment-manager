import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFitmentRouteData } from "../app/fitment/fitmentRouteLoad.server.ts";
import { paginateMetaobjects, paginateMetaobjectsDetailed } from "../app/utils/paginateMetaobjects.server.ts";
import { isShopifyThrottled } from "../app/utils/shopifyGraphql.server.ts";
import { getVehicleIndex } from "../app/vehicles/vehicleIndex.server.ts";
import { LIST_METAOBJECTS_BY_TYPE } from "../app/graphql/fitment.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

let failed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log("PASS", name);
    })
    .catch((error) => {
      failed += 1;
      console.error("FAIL", name, error);
    });
}

class GraphqlQueryError extends Error {
  body: Record<string, unknown>;
  constructor(message = "Throttled") {
    super(message);
    this.name = "GraphqlQueryError";
    this.body = {
      errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
      extensions: {
        cost: {
          requestedQueryCost: 1000,
          throttleStatus: { currentlyAvailable: 0, restoreRate: 100, maximumAvailable: 2000 },
        },
      },
    };
  }
}

function okResponse(data: unknown) {
  return {
    status: 200,
    headers: { get: () => null },
    json: async () => ({ data }),
  };
}

const PRODUCT = {
  id: "gid://shopify/Product/111",
  title: "Hi-Brit water pump (title is never identity)",
  handle: "hi-brit-hb-00294-electric-water-pump-m274-w205-2742000207",
  variants: { nodes: [{ id: "gid://shopify/ProductVariant/222", sku: "HB-00294" }] },
  brand: { value: "Hi-Brit" },
  mpn: { value: "HB-00294" },
  category: { value: "gid://shopify/Metaobject/1", reference: { id: "gid://shopify/Metaobject/1", displayName: "Engine" } },
  systemGroup: { value: "", label: "" },
  subcategory: { value: "", label: "" },
  fitmentVehicles: {
    references: {
      nodes: [
        {
          id: "gid://shopify/Metaobject/vehicle-1",
          handle: "w205",
          vehicle_key: { value: "mercedes-w205" },
          display_name: { value: "Mercedes W205" },
        },
      ],
    },
  },
};

await check("isShopifyThrottled detects GraphqlQueryError Throttled", () => {
  assert.equal(isShopifyThrottled(new GraphqlQueryError()), true);
  assert.equal(isShopifyThrottled({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }), true);
  assert.equal(isShopifyThrottled({ data: { product: {} } }), false);
});

await check("paginateMetaobjects does not throw on THROTTLED GraphqlQueryError", async () => {
  let calls = 0;
  const admin = {
    graphql: async () => {
      calls += 1;
      throw new GraphqlQueryError();
    },
  };
  const nodes = await paginateMetaobjects({
    admin,
    query: LIST_METAOBJECTS_BY_TYPE,
    variables: { type: "catalog_main_category" },
    pathToConnection: (d) => d?.metaobjects,
    maxRetries: 0,
    sleepFn: async () => {},
  });
  assert.equal(Array.isArray(nodes), true);
  assert.equal(nodes.length, 0);
  assert.equal(calls, 1);
});

await check("paginateMetaobjects retries are bounded, never unlimited", async () => {
  let calls = 0;
  const admin = {
    graphql: async () => {
      calls += 1;
      throw new GraphqlQueryError();
    },
  };
  const result = await paginateMetaobjectsDetailed({
    admin,
    query: LIST_METAOBJECTS_BY_TYPE,
    variables: { type: "catalog_main_category" },
    pathToConnection: (d) => d?.metaobjects,
    maxRetries: 2,
    sleepFn: async () => {},
  });
  assert.equal(result.throttled, true);
  assert.equal(result.incomplete, true);
  assert.ok(calls <= 3, `expected <= 3 attempts, got ${calls}`);
  assert.ok(calls >= 1);
});

await check("paginateMetaobjects stops at maxPages instead of walking the whole catalogue", async () => {
  let calls = 0;
  const admin = {
    graphql: async () => {
      calls += 1;
      return okResponse({
        metaobjects: {
          pageInfo: { hasNextPage: true, endCursor: `c${calls}` },
          nodes: [{ id: `gid://shopify/Metaobject/${calls}`, displayName: `Cat ${calls}` }],
        },
      });
    },
  };
  const result = await paginateMetaobjectsDetailed({
    admin,
    query: LIST_METAOBJECTS_BY_TYPE,
    variables: { type: "catalog_main_category" },
    pathToConnection: (d) => d?.metaobjects,
    pageSize: 1,
    maxPages: 3,
    maxRetries: 0,
    sleepFn: async () => {},
  });
  assert.equal(calls, 3);
  assert.equal(result.nodes.length, 3);
  assert.equal(result.incomplete, true);
  assert.equal(result.throttled, false);
});

await check("Fitment route survives ListMetaobjectsByType THROTTLED after the product loads", async () => {
  const queries: string[] = [];
  const admin = {
    graphql: async (query: string) => {
      queries.push(query);
      if (query.includes("GetProductForFitmentPage")) {
        return okResponse({ productByHandle: PRODUCT });
      }
      throw new GraphqlQueryError();
    },
  };

  const loaded = await loadFitmentRouteData({
    admin,
    shopDomain: "g5uxzq-gb.myshopify.com",
    productHandle: PRODUCT.handle,
    maxRetries: 0,
    sleepFn: async () => {},
  });

  assert.equal(loaded.notFound, false);
  if (loaded.notFound) return;
  assert.equal(loaded.payload.product.id, PRODUCT.id);
  assert.equal(loaded.payload.product.sku, "HB-00294");
  assert.equal(loaded.payload.product.variantId, "gid://shopify/ProductVariant/222");
  assert.equal(loaded.payload.shopifyThrottled, true);
  assert.equal(loaded.payload.compatibilityUnavailable, false);
  assert.deepEqual(
    loaded.payload.selectedVehicles.map((v) => v.id),
    ["gid://shopify/Metaobject/vehicle-1"],
  );
  assert.equal(loaded.payload.classificationOptions.categories.length, 0);
  assert.equal(
    queries.some((q) => q.includes("GetProductForFitmentPage")),
    true,
  );
  assert.equal(
    queries.some((q) => q.includes("ListMetaobjectLabelsByType") || q.includes("ListMetaobjectsByType")),
    true,
  );
});

await check("Fitment route THROTTLED on the product query fails closed and does not invent fitment", async () => {
  const admin = {
    graphql: async () => {
      throw new GraphqlQueryError();
    },
  };
  const loaded = await loadFitmentRouteData({
    admin,
    shopDomain: "throttle-fail-closed.myshopify.com",
    productHandle: PRODUCT.handle,
    maxRetries: 0,
    sleepFn: async () => {},
  });
  assert.equal(loaded.notFound, false);
  if (loaded.notFound) return;
  assert.equal(loaded.payload.shopifyThrottled, true);
  assert.equal(loaded.payload.compatibilityUnavailable, true);
  assert.deepEqual(loaded.payload.selectedVehicles, []);
  assert.equal(loaded.payload.product.id, "");
  assert.equal(loaded.payload.product.handle, PRODUCT.handle);
  assert.equal(loaded.payload.vehicleIndex.ready, false);
  assert.deepEqual(loaded.payload.makes, []);
  assert.deepEqual(loaded.payload.indexVehicles, []);
});

await check("Fitment route loader catch shape is HTTP 200 payload, not a thrown GraphqlQueryError", async () => {
  const isolated = source("app/fitment/fitmentRouteLoad.server.ts");
  assert.match(isolated, /loadFitmentRouteData/);
  assert.match(isolated, /emptyFitmentRoutePayload/);
  assert.match(isolated, /shopifyThrottled/);
  const route = source("app/routes/app.fitment.$productHandle.tsx");
  assert.match(route, /\/app\/products\/\$\{numericId\}/);
  assert.doesNotMatch(route, /getVehicleIndex/);
  assert.doesNotMatch(route, /paginateMetaobjects\(\{/);
  assert.doesNotMatch(route, /loadFitmentRouteData/);
});

await check("opening one product does not rebuild the Shopify vehicle catalogue", async () => {
  let graphqlCalls = 0;
  const admin = {
    graphql: async () => {
      graphqlCalls += 1;
      throw new Error("vehicle index must not hit Shopify on cache miss during GET");
    },
  };
  const idx = await getVehicleIndex({
    admin,
    shopDomain: "no-autobuild-on-get.myshopify.com",
    refresh: false,
  });
  assert.equal(idx, null);
  assert.equal(graphqlCalls, 0);

  const vi = source("app/vehicles/vehicleIndex.server.ts");
  assert.match(vi, /do not list the whole Shopify vehicle catalogue/);
});

await check("identity hierarchy is preserved and title is never used as identity", () => {
  const load = source("app/fitment/fitmentRouteLoad.server.ts");
  assert.match(load, /Shopify product ID → variant ID → SKU → Brand\+MPN/);
  assert.match(load, /Title is never identity/);
  assert.match(load, /Ocean remains the fitment authority/);
  assert.doesNotMatch(load, /productByHandle\(handle: title/);
  const identity = source("app/ocean/identity.ts");
  assert.match(identity, /Product title is never an identity key/);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll fitment throttle tests passed");
