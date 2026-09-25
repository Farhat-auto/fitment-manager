import assert from "node:assert/strict";
import { matchesReference, referenceKey, referenceValues } from "../app/utils/referenceLookup.ts";

const oe = referenceValues(JSON.stringify([
  "11517632426 — BMW", "11 51 9 455 978 — BMW", "11515A05704 — BMW",
]));
assert.ok(oe.some((value) => matchesReference("oe", value, "OE 11 51 7 632 426")));
assert.ok(oe.some((value) => matchesReference("oe", value, "11519455978")));
assert.ok(oe.some((value) => matchesReference("oe", value, "11515A05704")));
assert.equal(oe.some((value) => matchesReference("oe", value, "11517632427")), false);
assert.ok(matchesReference("oe", "A 274 200 02 07 — MERCEDES-BENZ", "2742000207"));

assert.equal(referenceKey("cross", "7.05171.65.0 — PIERBURG"), referenceKey("cross", "PIERBURG 7.05171.65.0"));
assert.ok(matchesReference("cross", "GATES 7705-11504,GATES 770511504", "7705-11504"));
assert.ok(matchesReference("cross", "VEMO V30-16-0014", "V30-16-0014 — VEMO"));
assert.ok(matchesReference("cross", "febi bilstein 185632", "185632 — febi bilstein"));
assert.equal(matchesReference("cross", "VEMO V30-16-0014", "PIERBURG V30-16-0014"), false);
console.log("PASS recorded OE and branded cross-reference formats");
