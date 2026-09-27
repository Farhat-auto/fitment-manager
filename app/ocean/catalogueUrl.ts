function text(value: unknown) {
  return String(value ?? "").trim();
}

export function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Require a real http(s) origin. A non-empty hash/token must not count as configured. */
export function oceanCatalogueBase(raw: unknown) {
  const value = text(raw).replace(/\/+$/, "");
  if (!value || !isHttpUrl(value)) return "";
  return value;
}
