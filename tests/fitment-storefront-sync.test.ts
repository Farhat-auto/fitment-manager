import assert from "node:assert/strict";
import { fitmentVehicleMetafields } from "../app/ocean/metafields.ts";

const ownerId = "gid://shopify/Product/10758340903255";
const [field] = fitmentVehicleMetafields(ownerId, [
  { vehicle_key: "ovh-e46-318i", verification_status: "VERIFIED" },
  { ocean_vehicle_id: "ovh-e46-318i", public_fits: true },
  { vehicle_key: "ovh-pending", verification_status: "UNVERIFIED" },
  { vehicle_key: "516118249815", verification_status: "VERIFIED" },
]);
assert.equal(field.ownerId, ownerId);
assert.equal(field.namespace, "ocean");
assert.equal(field.key, "verified_vehicle_keys");
assert.equal(field.type, "json");
assert.deepEqual(JSON.parse(field.value), ["ovh-e46-318i"]);
console.log("PASS verified fitment vehicle storefront sync");
