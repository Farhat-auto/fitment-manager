/**
 * Normalize Shopify Admin GraphQL metafield payloads (`value` + `jsonValue`) into
 * plain string lines for OE / cross-reference processing.
 *
 * Handles:
 * - `jsonValue` / `value` as JSON arrays of strings
 * - Arrays of objects with common TecDoc-style keys (`oe`, `number`, `reference`, …)
 * - `value` as a JSON string beginning with `[`
 * - Plain multi-line text or comma / semicolon / pipe separated blobs (legacy storage)
 */

function expandArrayItem(item) {
  if (item == null) return [];
  if (typeof item === "string") {
    const t = item.trim();
    return t ? [t] : [];
  }
  if (typeof item === "object") {
    const o = item;
    const keys = [
      "oe",
      "number",
      "reference",
      "code",
      "value",
      "oem",
      "oem_number",
      "part_number",
      "article",
      "article_number",
      "label",
      "text",
      "name",
    ];
    const out = [];
    for (const k of keys) {
      const v = o[k];
      if (v != null && String(v).trim()) out.push(String(v).trim());
    }
    return out;
  }
  return [];
}

function splitPlainReferenceBlob(s) {
  const trimmed = String(s ?? "").trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  return trimmed.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
}

/**
 * @param {{ value?: unknown; jsonValue?: unknown } | null | undefined} mf
 * @returns {string[]}
 */
export function parseMetafieldToLines(mf) {
  const j = mf?.jsonValue;
  if (Array.isArray(j)) {
    return j.flatMap((item) => expandArrayItem(item));
  }
  const rawVal = mf?.value;
  if (Array.isArray(rawVal)) {
    return rawVal.flatMap((item) => expandArrayItem(item));
  }
  const s = typeof rawVal === "string" ? rawVal.trim() : "";
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.flatMap((item) => expandArrayItem(item));
    } catch {
      return [];
    }
  }
  return splitPlainReferenceBlob(s);
}
