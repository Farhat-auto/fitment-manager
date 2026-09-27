import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalVehicleKey } from "../app/ocean/vehicleAliases.ts";
import { modelHasChassis, resolveFromCatalogue } from "../app/ocean/vehicleMatch.ts";

const e9 = "2.5-3.2 Coupe (E9) 09.1967 - 03.1976";
const e90 = "3 (E90) 02.2004 - 12.2013";
assert.equal(modelHasChassis(e9, "e90"), false);
assert.equal(modelHasChassis(e90, "e90"), true);
assert.equal(normIncludesWouldFalsePositive(), true);

const n46 = "ovh-48c4b0d506adc2facd68";
const n43_115 = "ovh-b49572832b2996c2e79c";
const n43_120 = "ovh-94faf6e164c395908b5b";
const n43_125 = "ovh-37642711931fb78da786";
const models = [
  { id: "1061", name: e9 },
  { id: "1068", name: e90 },
];
const engines = {
  "1061": [{
    vehicle_key: "ovh-e9fa15e0000000000001",
    title: "320i E90 N46 B20 B",
    engine_code: "N46 B20 B",
    power_kw: 110,
    fuel: "petrol",
    year_from: "1967",
    year_to: "1976",
  }],
  "1068": [
    { vehicle_key: n46, title: "320i E90 N46 B20 B", engine_code: "N46 B20 B/BD/C/CD", power_kw: 110, power_hp: 149, fuel: "petrol", year_from: "12.2004", year_to: "08.2007" },
    { vehicle_key: n43_115, title: "320i E90 N43 B20 A", engine_code: "N43 B20 A", power_kw: 115, power_hp: 156, fuel: "petrol", year_from: "2007", year_to: "2011" },
    { vehicle_key: n43_120, title: "320i E90 N43 B20 A", engine_code: "N43 B20 A", power_kw: 120, power_hp: 163, fuel: "petrol", year_from: "2007", year_to: "2011" },
    { vehicle_key: n43_125, title: "320i E90 N43 B20 A", engine_code: "N43 B20 A", power_kw: 125, power_hp: 169, fuel: "petrol", year_from: "2007", year_to: "2011" },
    { vehicle_key: "ovh-320ddead000000000001", title: "320d E90 N47 D20 A", engine_code: "N47 D20 A", power_kw: 110, power_hp: 150, fuel: "diesel", year_from: "2004", year_to: "2007" },
    { vehicle_key: "ovh-0dea1d1e5e1000000001", title: "320i E90 N20 B20 A", engine_code: "N20 B20 A", power_kw: 110, fuel: "diesel", year_from: "2004", year_to: "2007" },
    { vehicle_key: "ovh-0e7a0100000000000001", title: "320i E90 N20 B20 A", engine_code: "N20 B20 A", power_kw: 110, fuel: "petrol", year_from: "2004", year_to: "2007" },
  ],
};

const cases = [
  ["bmw-3-series-e90-320-i-n46-b20-b-110-kw-150-hp-cc-petrol-sedan-12-2004-08-2007", n46],
  ["bmw-3-series-e90-320-i-n43-b20-a-115-kw-156-hp-cc-petrol-sedan-02-2007-12-2011", n43_115],
  ["bmw-3-series-e90-320-i-n43-b20-a-120-kw-163-hp-cc-petrol-sedan-03-2007-12-2011", n43_120],
  ["bmw-3-series-e90-320-i-n43-b20-a-125-kw-170-hp-cc-petrol-sedan-09-2007-10-2011", n43_125],
];
for (const [slug, vehicleId] of cases) {
  assert.equal(canonicalVehicleKey(slug), slug);
  assert.equal(resolveFromCatalogue(slug, models, engines), vehicleId);
}
assert.equal(resolveFromCatalogue(
  "bmw-3-series-e90-320-i-n20-b20-a-110-kw-150-hp-cc-petrol-sedan-12-2004-08-2007",
  models,
  engines,
), "ovh-0e7a0100000000000001");
assert.equal(resolveFromCatalogue(
  "bmw-3-series-e90-320-i-n20-b20-a-110-kw-150-hp-cc-petrol-sedan-12-2004-08-2007",
  [{ id: "1068", name: e90 }],
  { "1068": [engines["1068"].find((row) => row.vehicle_key === "ovh-0dea1d1e5e1000000001")] },
), "");
assert.equal(resolveFromCatalogue(
  "bmw-3-series-e90-320-i-n46-b20-b-110-kw-150-hp-cc-petrol-sedan-12-2004-08-2007",
  [{ id: "1", name: "3 (E90)" }, { id: "2", name: "3 (E90) duplicate" }],
  {
    "1": [{ vehicle_key: n46, title: "320i E90 N46 B20 B", engine_code: "N46 B20 B", power_kw: 110, fuel: "petrol", year_from: "2004", year_to: "2007" }],
    "2": [{ vehicle_key: "ovh-07e40000000000000001", title: "320i E90 N46 B20 B", engine_code: "N46 B20 B", power_kw: 110, fuel: "petrol", year_from: "2004", year_to: "2007" }],
  },
), "");

const aliases = readFileSync(new URL("../app/ocean/vehicleAliases.ts", import.meta.url), "utf8");
assert.equal(aliases.includes("320-i"), false);
const classification = readFileSync(new URL("../app/ocean/storefrontClassification.ts", import.meta.url), "utf8");
assert.equal(classification.includes("10639645901143"), false);
assert.equal(classification.includes("10758331629911"), false);
assert.equal(classification.includes("REVIEWED_PRODUCT_TAXONOMY"), false);
console.log("PASS generic ovh vehicle match including E90 320i");

function normIncludesWouldFalsePositive() {
  const glued = e9.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return glued.includes("e90");
}
