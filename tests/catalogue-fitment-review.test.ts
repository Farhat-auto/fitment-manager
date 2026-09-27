import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("catalogue fitment review safety", () => {
  const api = readFileSync("app/routes/api.catalogue-fitment-review.ts", "utf8");
  const ui = readFileSync("app/routes/app.catalogue-fitment-review.tsx", "utf8");

  it("requires canonical vehicle keys for individual decisions", () => {
    expect(api).toContain("canonical_vehicle_key_required");
    expect(api).toContain("/^ovh-[a-f0-9]+$/i");
    expect(ui).toContain("canonical_vehicle_key_required");
  });

  it("uses the authoritative-only bulk verification action", () => {
    expect(api).toContain("bulk_verify_authoritative");
    expect(ui).toContain('value="bulk_verify_authoritative"');
    expect(ui).toContain("Verify authoritative candidates only");
  });

  it("warns staff that OE and cross-reference are not fitment proof", () => {
    expect(ui).toContain("OE and cross-reference data are identity evidence only");
    expect(ui).toContain("authoritative application evidence");
  });
});
