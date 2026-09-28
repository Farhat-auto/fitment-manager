import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { APPLICATION_LABELS, applicationBatchCsv, exampleCsv, issueReportCsv, parseApplicationCsv, templateCsv } from "../app/fitment/applicationCsv.ts";

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
  const batches = [];
  for (let i = 0; i < parsed.records.length; i += 100) batches.push(parsed.records.slice(i, i + 100));
  assert.equal(batches.length, 61);
  assert.equal(batches[60].length, 1);
  assert.equal(parseApplicationCsv(applicationBatchCsv(batches[60])).records.length, 1);
});

test("reports missing vehicle, malformed column count and unmatched quotes without guessing fitment", () => {
  const header = "sku,brand,mpn,oe_number,vehicle_key,make,model,generation,engine,power_kw,year_from,year_to,evidence_type,evidence_value,source_state,source_ref";
  const result = parseApplicationCsv([header, "SKU,,,,,,,,,,,,application,,,", "SKU,wrong", "SKU,,,,ovh-ab12,,,,,,,,application,Catalogue page 12,,"].join("\n"));
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.issues.map((v) => v.line), [2, 3]);
  assert.match(parseApplicationCsv(header + '\n"unclosed').error || "", /Unclosed/);
  assert.match(parseApplicationCsv("sku,sku\nA,B").error || "", /Duplicate/);
  assert.match(issueReportCsv([{ line: 2, error: '=SUM(1,2)' }]), /'\=SUM/);
  const report = issueReportCsv([{ line: 4, error: "Canonical vehicle key must start with ovh-", values: { sku: "=HB-1", vehicle_key: "gid://shopify/Metaobject/1" } }]);
  assert.match(report, /'=HB-1/);
  assert.match(report, /gid:\/\/shopify\/Metaobject\/1/);
});

test("template is header-only and the example file cannot be imported", () => {
  const template = templateCsv();
  assert.equal(template.split(/\r?\n/).filter(Boolean).length, 1);
  assert.equal(template.startsWith(APPLICATION_LABELS.join(",")), true);
  assert.equal(template.includes("EXAMPLE-DO-NOT-IMPORT"), false);
  const blank = parseApplicationCsv(template);
  assert.equal(blank.records.length, 0);
  assert.equal(blank.issues.length, 0);
  assert.equal(blank.error, undefined);
  const example = parseApplicationCsv(exampleCsv());
  assert.equal(example.records.length, 0);
  assert.equal(example.issues.length, 0);
  assert.match(example.error || "", /example file/);
  assert.equal(readFileSync("public/fitment-application-template.csv", "utf8"), template);
  assert.equal(readFileSync("public/fitment-application-example.csv", "utf8"), exampleCsv());
});

test("accepts readable columns and refuses the old export, legacy vehicle IDs, and OE matches", () => {
  const header = APPLICATION_LABELS.join(",");
  const good = "HB-00355,HI-BRIT,2000000185682,,,Mercedes-Benz,C-Class,W205,M 274.920,135,2014,2018,application,Supplier catalogue lists this oil cooler for this engine,,supplier-doc";
  const parsed = parseApplicationCsv([header, good].join("\n"));
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].values.sku, "HB-00355");
  assert.equal(parsed.records[0].values.engine, "M 274.920");
  assert.equal(parsed.records[0].values.evidence_value, "Supplier catalogue lists this oil cooler for this engine");
  assert.equal(parsed.records[0].values.source_state, "");

  const legacy = parseApplicationCsv("product_id,product_handle,product_sku,vehicle_gid,vehicle_key\ngid://shopify/Product/1,handle,HB-00355,gid://shopify/Metaobject/2,mercedes-w205");
  assert.equal(legacy.records.length, 0);
  assert.match(legacy.error || "", /old fitment export/);
  assert.match(legacy.error || "", /not imported as verified compatibility/);

  const gid = "HB-00355,,,,gid://shopify/Metaobject/9,,,,,,,,application,Quoted fitment,,";
  const oe = "HB-00355,,,,ovh-abc123,,,,,,,,oe,A123456789,,";
  const missingEvidence = "HB-00355,,,,ovh-abc123,,,,,,,,application,,,";
  const rows = parseApplicationCsv([header, gid, oe, missingEvidence].join("\n"));
  assert.equal(rows.records.length, 0);
  assert.equal(rows.issues.length, 3);
  assert.match(rows.issues[0].error, /ovh-/);
  assert.match(rows.issues[1].error, /not imported as verified compatibility/);
  assert.match(rows.issues[2].error, /Evidence is required/);
  assert.equal(rows.issues[0].values?.vehicle_key, "gid://shopify/Metaobject/9");
});
