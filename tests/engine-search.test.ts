import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const car = readFileSync("app/components/CarFitment.tsx", "utf8");

assert.match(car, /label="Search engine"/);
assert.match(car, /274\.920, M 274\.920, W205 274\.920/);
assert.match(car, /label="Find an engine"/);
assert.match(car, /placeholder="274\.920"/);
assert.match(car, /engineChoiceLabel/);
assert.match(car, /matchesEngineQuery/);
assert.match(car, /vehicle-search\?q=/);
assert.match(car, /limit=100/);
assert.doesNotMatch(car, /label="Search vehicles"/);
