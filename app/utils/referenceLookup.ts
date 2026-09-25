export type ReferenceKind = "oe" | "cross";

export function referenceKey(kind: ReferenceKind, value: unknown): string {
  let raw = String(value ?? "").trim();
  if (kind === "oe") {
    raw = raw.split(/\s+[—–]\s+/)[0].replace(/^(?:OEM?|OE)\s+/i, "");
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
  return referenceValues(value).some((entry) => referenceKey(kind, entry) === wanted);
}
