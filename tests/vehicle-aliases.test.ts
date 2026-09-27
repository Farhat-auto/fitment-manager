import assert from "node:assert/strict";
import { canonicalVehicleKey } from "../app/ocean/vehicleAliases.ts";

const canonical = "ovh-d1bd300d05c7a189edd8";
assert.equal(canonicalVehicleKey("ovh-4d59a21176f5ea9c97da"), canonical);
assert.equal(canonicalVehicleKey(
  "bmw-1-series-coupe-e82-135-i-n54-b30-a-n55-b30-a-225-kw-306-hp-3000-cc-petrol-coupe-10-2007-10-2013",
), canonical);
assert.equal(canonicalVehicleKey(canonical), canonical);
assert.equal(canonicalVehicleKey(
  "bmw-3-series-e90-316-d-n47-d20-c-85-kw-116-hp-1995-cc-diesel-sedan-07-2009-12-2011",
), "ovh-8a49866f9b684104bfcb");
assert.equal(canonicalVehicleKey(
  "bmw-3-series-e90-316-i-n43-b16-a-85-kw-116-hp-cc-petrol-sedan-09-2005-10-2011",
), "ovh-1fd0868a80585315ddd6");
assert.equal(canonicalVehicleKey("ovh-unknown"), "ovh-unknown");
assert.equal(canonicalVehicleKey("bmw-1-series-coupe-e82-135-i-other-engine"),
  "bmw-1-series-coupe-e82-135-i-other-engine");
console.log("Reviewed vehicle alias checks passed");
