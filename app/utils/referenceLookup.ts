export type ReferenceKind = "oe" | "cross";

export function referenceKey(kind: ReferenceKind, value: unknown): string {
  let raw = String(value ?? "").trim();
  if (kind === "oe") {
    raw = raw.split(/\s+[—–]\s+/)[0].replace(/^(?:OEM?|OE)\s+/i, "");
  } else {
    // Shopify displays some references as "article — brand" but stores others as
    // "brand article". Preserve both parts so a brand-qualified lookup stays exact.
    const display = raw.match(/^(.+?)\s+[—–]\s+(.+)$/);
    if (display) raw = `${display[2]} ${display[1]}`;
  }
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function referenceValues(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export function hasReference(kind: ReferenceKind, value: unknown, wanted: string): boolean {
  return referenceValues(value).some((entry) => matchesReference(kind, entry, wanted));
}

export function matchesReference(kind: ReferenceKind, recorded: string, rawWanted: string): boolean {
  const wanted = referenceKey(kind, rawWanted);
  if (wanted.length < 3) return false;
  const entries = kind === "cross" ? recorded.split(/\s*,\s*/) : [recorded];
  return entries.some((entry) => {
    const key = referenceKey(kind, entry);
    if (key === wanted) return true;
    if (kind === "oe") {
      const mercedes = (value: string) => value.replace(/^A(?=\d{10}$)/, "");
      return mercedes(key) === mercedes(wanted);
    }
    return wanted.length >= 5 && key.endsWith(wanted);
  });
}
