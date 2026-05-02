/**
 * Vectors for storefront / backfill OE key normalization (same rules as
 * `app/utils/oeReferences.ts` + `snippets/oe-search-key.liquid`).
 *
 * Comparison style: every input is normalized to uppercase letters+digits only after stripping
 * OEM/OE prefixes and brand suffixes — so catalog matching uses one key per physical number.
 *
 * Group A (same article, different typing): `705171650`, `OE:705171650`, `7.05171.65.0` → `705171650`
 * Group B (Mercedes-style alphanumeric): `A2742000107` / full TecDoc line → `A2742000107`
 *
 * Run: npm run test:oe-normalize
 */
import assert from "node:assert/strict";

const EM_DASH = "\u2014";
const EN_DASH = "\u2013";

function normalizeOeSearchKey(raw) {
  const rawStr = String(raw ?? "").trim();
  if (!rawStr) return "";
  if (rawStr === "*") return "*";

  let seg = rawStr.split(EM_DASH)[0] ?? "";
  seg = (seg.split(EN_DASH)[0] ?? "").trim();
  seg = (seg.split(" - ")[0] ?? "").trim();

  let t = seg.replace(/["'\u201c\u201d\u2018\u2019]/g, "").trim();

  for (let i = 0; i < 12; i++) {
    const u = t.toUpperCase();
    if (u.startsWith("OEM")) {
      t = t.slice(3).trim();
      continue;
    }
    if (u.startsWith("OE")) {
      t = t.slice(2).trim();
      continue;
    }
    break;
  }

  return t.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeCrossRefSearchKey(raw) {
  const base = normalizeOeSearchKey(raw);
  if (!base || base === "*") return "";
  if (!/\d/.test(base)) return "";
  const idx = base.search(/[0-9]/);
  if (idx < 0) return "";
  if (idx >= 5) return base.slice(idx);
  return base;
}

const cases = [
  ["705171650", "705171650"],
  ["OE:705171650", "705171650"],
  ["7.05171.65.0", "705171650"],
  ["A2742000107", "A2742000107"],
  ["OE A 274 200 01 07 — MERCEDES-BENZ", "A2742000107"],
];

const crossRefCases = [
  ["PIERBURG 7.05171.65.0", "705171650"],
  ["PIERBURG705171650", "705171650"],
  ["BOSCH 0 986 494 596", "0986494596"],
];

for (const [input, expected] of cases) {
  const got = normalizeOeSearchKey(input);
  assert.equal(got, expected, `normalizeOeSearchKey(${JSON.stringify(input)}) => ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}

for (const [input, expected] of crossRefCases) {
  const got = normalizeCrossRefSearchKey(input);
  assert.equal(got, expected, `normalizeCrossRefSearchKey(${JSON.stringify(input)}) => ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}

console.log("[test-oe-search-normalize] OK", cases.length + crossRefCases.length, "cases");
