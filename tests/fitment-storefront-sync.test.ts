import assert from "node:assert/strict";
import { catalogueFitmentMetafields, fitmentVehicleMetafields, verifiedVehicleKeys } from "../app/ocean/metafields.ts";

const ownerId = "gid://shopify/Product/10758340903255";
const [field] = fitmentVehicleMetafields(ownerId, [
  { vehicle_key: "ovh-e46-318i", verification_status: "VERIFIED" },
  { ocean_vehicle_id: "ovh-e46-318i", public_fits: true },
  { vehicle_key: "ovh-pending", verification_status: "UNVERIFIED" },
  { vehicle_key: "516118249815", verification_status: "VERIFIED" },
  { vehicle_key: "mercedes-benz-c-class-w205-c-200-205-042-m-274-920-135-kw-184-hp-1991-cc-petrol-saloon-12-2013-08-2018", verification_status: "VERIFIED" },
]);
assert.equal(field.ownerId, ownerId);
assert.equal(field.namespace, "ocean");
assert.equal(field.key, "verified_vehicle_keys");
assert.equal(field.type, "json");
assert.deepEqual(JSON.parse(field.value), ["ovh-e46-318i", "mercedes-benz-c-class-w205-c-200-205-042-m-274-920-135-kw-184-hp-1991-cc-petrol-saloon-12-2013-08-2018"]);
const rows = [
  { vehicle_key: "ovh-e46-318i", verification_status: "VERIFIED" },
  { vehicle_key: "ovh-pending", source: "manual", verification_status: "UNVERIFIED" },
];
assert.deepEqual(verifiedVehicleKeys(rows), ["ovh-e46-318i"]);
const fields = catalogueFitmentMetafields(ownerId, verifiedVehicleKeys(rows));
assert.deepEqual(fields.map((item) => item.namespace + "." + item.key), [
  "ocean.verified_vehicle_keys",
  "custom.fitment_keys",
  "ocean.fitment_count",
  "ocean.fitment_status",
]);
assert.equal(fields[2].value, "1");
assert.equal(fields[3].value, "verified");
assert.equal(JSON.parse(fields[0].value).length, JSON.parse(fields[1].value).length);
console.log("PASS verified fitment vehicle storefront sync");
