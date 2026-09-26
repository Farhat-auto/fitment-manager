import { oceanGet } from "./client.server";
import { canonicalVehicleKey } from "./vehicleAliases";
import { modelHasChassis, resolveFromCatalogue, selectMake, slugFacts } from "./vehicleMatch";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function rows(payload: any, keys: string[]) {
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

export async function resolveVehicleKey(raw: string): Promise<string> {
  const reviewed = canonicalVehicleKey(raw);
  if (!reviewed || reviewed.startsWith("ovh-") || reviewed !== raw) return reviewed;
  const facts = slugFacts(reviewed);
  if (!facts.chassis || !facts.powerKw) return reviewed;

  const makesPayload = await oceanGet("/makes", "limit=250");
  const makes = rows(makesPayload, ["makes", "manufacturers"]);
  const make = selectMake(makes, reviewed);
  if (!make?.id) return reviewed;

  const modelsPayload = await oceanGet("/models", new URLSearchParams({ make_id: text(make.id), limit: "250" }).toString());
  const models = rows(modelsPayload, ["models"]);
  const matched = models.filter((model: any) => model?.id && modelHasChassis(model?.name || model?.title, facts.chassis));
  if (!matched.length) return reviewed;

  const enginesByModel: Record<string, any[]> = {};
  for (const model of matched) {
    const vehicleQuery = new URLSearchParams({
      make_id: text(make.id), model_id: text(model.id), limit: "250",
    }).toString();
    let typesPayload = await oceanGet("/engines", vehicleQuery);
    let vehicleRows = rows(typesPayload, ["engines", "types"]);
    if (!vehicleRows.length) {
      typesPayload = await oceanGet("/types", vehicleQuery);
      vehicleRows = rows(typesPayload, ["types", "engines"]);
    }
    enginesByModel[text(model.id)] = vehicleRows;
  }
  return resolveFromCatalogue(reviewed, matched, enginesByModel) || reviewed;
}
