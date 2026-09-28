import assert from "node:assert/strict";
import test from "node:test";
import { applicationBatchCsv, issueReportCsv, parseApplicationCsv } from "../app/fitment/applicationCsv.ts";

test("parses a large file and preserves quoted newlines and CSV source lines", () => {
  const header = "sku,brand,mpn,oe_number,vehicle_key,make,model,generation,engine,power_kw,year_from,year_to,evidence_type,evidence_value,source_state,source_ref";
  const row = 'ABC,,,,ovh-abc123,,,,,,,,application,"Supplier, page\n42",unverified,doc-1';
  const parsed = parseApplicationCsv([header, ...Array(6001).fill(row)].join("\r\n"));
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.records.length, 6001);
  assert.equal(parsed.records[1].line, 4);
  assert.equal(parsed.records[6000].line, 12002);
  assert.equal(parsed.records[0].values.evidence_value, "Supplier, page\n42");
  assert.equal(parseApplicationCsv(applicationBatchCsv(parsed.records.slice(0, 100))).records.length, 100);
});

test("reports missing vehicle, malformed column count and unmatched quotes without guessing fitment", () => {
  const header = "sku,brand,mpn,oe_number,vehicle_key,make,model,generation,engine,power_kw,year_from,year_to,evidence_type,evidence_value,source_state,source_ref";
  const result = parseApplicationCsv([header, "SKU,,,,,,,,,,,,application,,,", "SKU,wrong", "SKU,,,,ovh-ab12,,,,,,,,application,,,"].join("\n"));
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.issues.map((v) => v.line), [2, 3]);
  assert.match(parseApplicationCsv(header + '\n"unclosed').error || "", /Unclosed/);
  assert.match(parseApplicationCsv("sku,sku\nA,B").error || "", /Duplicate/);
  assert.match(issueReportCsv([{ line: 2, error: '=SUM(1,2)' }]), /'\=SUM/);
});
