/**
 * Reviewed aliases for public vehicle keys emitted by the older theme export.
 * These identify a vehicle only. They never verify any product fitment.
 *
 * BMW E82 135 i: N54 B30 A / N55 B30 A, 225 kW, 2007-10 to 2013-10.
 * Odoo staging catalogue.type 218 mints the destination ID. The theme's
 * older display says 306 HP; Odoo says 305 HP, but the identity is supported
 * by the exact chassis, derivative, engine codes, power in kW, and dates.
 */
const REVIEWED_ALIASES: Readonly<Record<string, string>> = {
  "ovh-4d59a21176f5ea9c97da": "ovh-d1bd300d05c7a189edd8",
  "bmw-1-series-coupe-e82-135-i-n54-b30-a-n55-b30-a-225-kw-306-hp-3000-cc-petrol-coupe-10-2007-10-2013":
    "ovh-d1bd300d05c7a189edd8",
};

export function canonicalVehicleKey(value: string): string {
  const key = String(value || "").trim();
  return REVIEWED_ALIASES[key] || key;
}
