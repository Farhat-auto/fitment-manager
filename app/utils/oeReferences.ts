/**
 * Normalize a single line for `custom.oe_references` (list.single_line_text_field).
 * Fixes duplicated "OE OE" prefixes and collapses whitespace.
 * Does not add an "OE" prefix — callers must not prepend OE when the line already starts with OE.
 */
export function normalizeOeReferenceLine(raw: unknown): string {
  let line = String(raw ?? "").trim();
  if (!line) return "";

  while (/^OE\s+OE\s+/i.test(line)) {
    line = line.replace(/^OE\s+OE\s+/i, "OE ");
  }

  line = line.replace(/\s+/g, " ");
  return line.trim();
}

/** Split textarea / FormData text into normalized non-empty lines for saving. */
export function normalizeOeReferenceLinesFromForm(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/\r?\n/)
    .map((line) => normalizeOeReferenceLine(line))
    .filter(Boolean);
}

const EM_DASH = "\u2014";
const EN_DASH = "\u2013";

/**
 * Normalize a raw OE / reference line to the same compact key used by the storefront
 * (`snippets/oe-search-key.liquid`).
 *
 * Rules (aligned with theme):
 * - Drop brand suffix after em dash, en dash, or ` - ` (space-hyphen-space).
 * - Strip quotes; repeatedly strip leading `OEM` then `OE` (order matters so `OEM` is not mistaken for `OE`).
 * - Keep **letters and digits only** (uppercase); drop spaces, dashes, slashes, dots, etc.
 *
 * Examples:
 * - `OE 11517632426 — BMW` → `11517632426`
 * - `OE A 274 200 01 07 — MERCEDES-BENZ` → `A2742000107`
 */
export function normalizeOeSearchKey(raw: unknown): string {
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

/** TecDoc-style cross refs: strip leading brand letters when the first digit is “late” (parity with theme `oe-crossref-normalize-one`). */
export function normalizeCrossRefSearchKey(raw: unknown): string {
  const base = normalizeOeSearchKey(raw);
  if (!base || base === "*") return "";
  if (!/\d/.test(base)) return "";
  const idx = base.search(/[0-9]/);
  if (idx < 0) return "";
  if (idx >= 5) return base.slice(idx);
  return base;
}

/** Extra index lines so Shopify search can match TecDoc-style cross refs (bare digits, dotted, concatenated brand+digits). */
function addCrossReferenceSearchIndexKeys(rawLine: unknown, keys: Set<string>): void {
  const raw = String(rawLine ?? "").trim();
  if (!raw) return;
  keys.add(raw);
  const kFull = normalizeOeSearchKey(raw);
  if (kFull && kFull !== "*") keys.add(kFull);
  const kxr = normalizeCrossRefSearchKey(raw);
  if (kxr && kxr !== "*") keys.add(kxr);
  for (const part of raw.split(/\s+/)) {
    const p = part.trim();
    if (!p) continue;
    if (/^[\d.]+$/.test(p) && /[0-9]/.test(p)) keys.add(p);
  }
}

/**
 * Build newline-separated unique keys for `custom.search_index` from OE lines, cross refs,
 * and article number — aligned with theme OE link search keys.
 */
export function buildCustomSearchIndexValue(input: {
  oeLines: string[];
  crossLines: string[];
  articleNumber: string;
}): string {
  const keys = new Set<string>();
  for (const line of input.oeLines) {
    const k = normalizeOeSearchKey(normalizeOeReferenceLine(line));
    if (k && k !== "*") keys.add(k);
    const kxr = normalizeCrossRefSearchKey(normalizeOeReferenceLine(line));
    if (kxr && kxr !== "*") keys.add(kxr);
  }
  for (const line of input.crossLines) {
    addCrossReferenceSearchIndexKeys(line, keys);
  }
  const art = String(input.articleNumber ?? "").trim();
  if (art) {
    const k = normalizeOeSearchKey(art);
    if (k && k !== "*") keys.add(k);
    const kxr = normalizeCrossRefSearchKey(art);
    if (kxr && kxr !== "*") keys.add(kxr);
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).join("\n");
}
