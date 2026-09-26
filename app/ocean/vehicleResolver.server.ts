import { oceanGet } from "./client.server";
import { canonicalVehicleKey } from "./vehicleAliases";

function text(v: unknown) { return String(v ?? "").trim(); }
function norm(v: unknown) { return text(v).toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function tokens(v: string) { return v.toLowerCase().split("-").filter(Boolean); }

function slugFacts(key: string) {
  const t = tokens(key);
  const chassis = t.find((x) => /^[efgux][0-9]{2,3}$/.test(x)) || "";
  const kwAt = t.findIndex((x) => x === "kw");
  const powerKw = kwAt > 0 && /^\d+$/.test(t[kwAt - 1]) ? Number(t[kwAt - 1]) : 0;
  const engineAt = t.findIndex((x) => /^[nmspb][0-9]{2}$/.test(x));
  const engineCode = engineAt >= 0 ? t.slice(engineAt, engineAt + 3).join("") : "";
  const derivativeStart = chassis ? t.indexOf(chassis) + 1 : -1;
  const derivativeEnd = engineAt >= 0 ? engineAt : kwAt > 0 ? Math.max(derivativeStart, kwAt - 1) : undefined;
  const derivative = derivativeStart > 0 ? t.slice(derivativeStart, derivativeEnd).join("") : "";
  const years = t.filter((x) => /^(19|20)\d{2}$/.test(x)).map(Number);
  return { t, chassis, powerKw, engineCode, derivative, years };
}

function rows(payload: any, keys: string[]) {
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

export async function resolveVehicleKey(raw: string): Promise<string> {
  const reviewed = canonicalVehicleKey(raw);
  if (!reviewed || reviewed.startsWith("ovh-") || reviewed !== raw) return reviewed;
  const f = slugFacts(reviewed);
  if (!f.chassis || !f.powerKw) return reviewed;

  const makesPayload = await oceanGet("/makes", "limit=250");
  const makes = rows(makesPayload, ["makes", "manufacturers"]);
  const make = makes.find((m: any) => {
    const n = norm(m?.name || m?.handle);
    return n && norm(reviewed).startsWith(n);
  });
  if (!make?.id) return reviewed;

  const modelsPayload = await oceanGet("/models", new URLSearchParams({ make_id: text(make.id), limit: "250" }).toString());
  const models = rows(modelsPayload, ["models"]);
  const modelMatches = models.filter((m: any) => norm(m?.name || m?.title).includes(norm(f.chassis)));
  if (modelMatches.length !== 1) return reviewed;
  const model = modelMatches[0];

  const typesPayload = await oceanGet("/types", new URLSearchParams({
    make_id: text(make.id), model_id: text(model.id), limit: "250",
  }).toString());
  const candidates = rows(typesPayload, ["types", "engines"]).map((row: any) => {
    let score = 0;
    const title = norm(row?.title || row?.detail || row?.engine);
    const engine = norm(row?.engine_code);
    if (f.engineCode && (engine.includes(norm(f.engineCode)) || norm(f.engineCode).includes(engine))) score += 8;
    if (f.powerKw && Number(row?.power_kw || 0) === f.powerKw) score += 8;
    if (f.derivative && title.includes(norm(f.derivative))) score += 5;
    if (f.chassis && title.includes(norm(f.chassis))) score += 3;
    if (f.years.length) {
      const from = Number(text(row?.year_from).slice(0, 4) || 0);
      const to = Number(text(row?.year_to).slice(0, 4) || 9999);
      if (f.years.some((y) => y >= from && y <= to)) score += 2;
    }
    return { row, score };
  }).sort((a: any, b: any) => b.score - a.score);

  const best = candidates[0];
  const second = candidates[1];
  if (!best || best.score < 16 || (second && second.score === best.score)) return reviewed;
  const id = text(best.row?.vehicle_key || best.row?.vehicle_id || best.row?.ocean_vehicle_id || best.row?.id);
  return /^ovh-[a-f0-9]+$/i.test(id) ? id : reviewed;
}
