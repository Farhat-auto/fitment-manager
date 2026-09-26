export type SlugFacts = {
  chassis: string;
  powerKw: number;
  engineCode: string;
  derivative: string;
  years: number[];
  fuel: string;
};

export type EngineRow = {
  id?: unknown;
  vehicle_key?: unknown;
  vehicle_id?: unknown;
  ocean_vehicle_id?: unknown;
  title?: unknown;
  detail?: unknown;
  engine?: unknown;
  display_name?: unknown;
  engine_code?: unknown;
  power_kw?: unknown;
  fuel?: unknown;
  fuel_type?: unknown;
  year_from?: unknown;
  year_to?: unknown;
};

const CHASSIS = /^[efgux][0-9]{2,3}$/;
const ENGINE = /^[nmspb][0-9]{2}$/;
const YEAR = /^(19|20)\d{2}$/;
const PUBLIC_ID = /^ovh-[a-f0-9]+$/i;

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function norm(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function slugFacts(key: string): SlugFacts {
  const tokens = text(key).toLowerCase().split("-").filter(Boolean);
  const chassis = tokens.find((token) => CHASSIS.test(token)) || "";
  const kwAt = tokens.indexOf("kw");
  const powerKw = kwAt > 0 && /^\d+$/.test(tokens[kwAt - 1]) ? Number(tokens[kwAt - 1]) : 0;
  const engineAt = tokens.findIndex((token) => ENGINE.test(token));
  const engineCode = engineAt >= 0 ? tokens.slice(engineAt, engineAt + 3).join("") : "";
  const derivativeStart = chassis ? tokens.indexOf(chassis) + 1 : -1;
  const derivativeEnd = engineAt >= 0 ? engineAt : kwAt > 0 ? Math.max(derivativeStart, kwAt - 1) : undefined;
  const derivative = derivativeStart > 0 ? tokens.slice(derivativeStart, derivativeEnd).join("") : "";
  const years = tokens.filter((token) => YEAR.test(token)).map(Number);
  const fuel = tokens.includes("diesel") ? "diesel" : tokens.includes("petrol") || tokens.includes("gasoline") ? "petrol" : "";
  return { chassis, powerKw, engineCode, derivative, years, fuel };
}

/** Chassis codes compare as whole tokens. "E9" plus "09.1967" is not "E90". */
export function modelHasChassis(name: unknown, chassis: string) {
  const want = text(chassis).toLowerCase();
  if (!want) return false;
  return text(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).includes(want);
}

export function selectMake<T extends { name?: unknown; handle?: unknown }>(makes: T[], slug: string) {
  const slugNorm = norm(slug);
  return makes.find((make) => {
    const name = norm(make?.name || make?.handle);
    return Boolean(name) && slugNorm.startsWith(name);
  });
}

function fuelOf(value: unknown) {
  const token = norm(value);
  if (token.includes("diesel")) return "diesel";
  if (token.includes("petrol") || token.includes("gasoline")) return "petrol";
  return "";
}

function yearOf(value: unknown) {
  const found = text(value).match(/(19|20)\d{2}/g);
  return found ? Number(found[found.length - 1]) : 0;
}

export function enginePublicId(row: EngineRow) {
  const id = text(row?.vehicle_key || row?.vehicle_id || row?.ocean_vehicle_id || row?.id);
  return PUBLIC_ID.test(id) ? id : "";
}

export function scoreEngine(facts: SlugFacts, row: EngineRow) {
  let score = 0;
  const title = norm(row?.title || row?.detail || row?.engine || row?.display_name);
  const engine = norm(row?.engine_code);
  if (facts.engineCode && engine && (engine.includes(facts.engineCode) || facts.engineCode.includes(engine))) score += 8;
  const power = Number(row?.power_kw || 0);
  if (facts.powerKw && power === facts.powerKw) score += 8;
  if (facts.derivative && title.includes(facts.derivative)) score += 5;
  if (facts.chassis && title.includes(facts.chassis)) score += 3;
  if (facts.years.length) {
    const from = yearOf(row?.year_from);
    const to = yearOf(row?.year_to) || 9999;
    if (facts.years.some((year) => year >= from && year <= to)) score += 2;
  }
  const rowFuel = fuelOf(row?.fuel || row?.fuel_type);
  if (facts.fuel && rowFuel && facts.fuel !== rowFuel) score -= 20;
  return score;
}

export function pickEngine(facts: SlugFacts, engines: EngineRow[]) {
  const scored = engines.map((row) => ({ row, score: scoreEngine(facts, row), id: enginePublicId(row) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < 16 || !best.id) return "";
  if (second && second.score === best.score) return "";
  return best.id;
}

export function resolveFromCatalogue(
  slug: string,
  models: Array<{ id?: unknown; name?: unknown; title?: unknown }>,
  enginesByModel: Record<string, EngineRow[]>,
) {
  const facts = slugFacts(slug);
  if (!facts.chassis || !facts.powerKw) return "";
  const matched = models.filter((model) => modelHasChassis(model?.name || model?.title, facts.chassis));
  const winners = new Set<string>();
  for (const model of matched) {
    const picked = pickEngine(facts, enginesByModel[text(model?.id)] || []);
    if (picked) winners.add(picked);
  }
  return winners.size === 1 ? [...winners][0] : "";
}
