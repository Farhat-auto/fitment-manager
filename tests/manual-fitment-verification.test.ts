import assert from "node:assert/strict";
import { defaultVerification } from "../app/ocean/identity.ts";
assert.equal(defaultVerification("add", "", "manual"), "VERIFIED");
assert.equal(defaultVerification("bulk", "", "manual"), "VERIFIED");
assert.equal(defaultVerification("add", "", "catalogue_import"), "UNVERIFIED");
assert.equal(defaultVerification("import", "VERIFIED", "catalogue_import"), "UNVERIFIED");
console.log("PASS manual fitment verification policy");
