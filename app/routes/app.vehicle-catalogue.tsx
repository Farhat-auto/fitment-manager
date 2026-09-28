import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Badge, Banner, BlockStack, Button, Card, IndexTable, Page, Select, Text, TextField } from "@shopify/polaris";
import * as React from "react";
import { authenticate } from "../shopify.server";
import { oceanGet } from "../ocean/client.server";

type Named = { id?: string; name?: string; title?: string; handle?: string; year_range?: string; vehicle_class?: string };
type Engine = {
  vehicle_key?: string;
  vehicle_id?: string;
  title?: string;
  make_name?: string;
  model_name?: string;
  generation_name?: string;
  engine?: string;
  engine_code?: string;
  power_kw?: string;
  power_hp?: string;
  year_from?: string;
  year_to?: string;
  year_range?: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function labelOf(row: Named) {
  return text(row.name || row.title || row.handle || row.id);
}

async function ocean(path: string) {
  const res = await fetch("/api/ocean" + path);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(text(payload.error) || `Ocean ${res.status}`);
  return payload;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const payload = await oceanGet("/makes");
  const makes = Array.isArray(payload?.makes) ? payload.makes : [];
  return json({
    makes,
    error: text(payload?.error),
  });
}

export default function VehicleCatalogue() {
  const data = useLoaderData<typeof loader>();
  const [makeId, setMakeId] = React.useState("");
  const [modelId, setModelId] = React.useState("");
  const [generationId, setGenerationId] = React.useState("");
  const [models, setModels] = React.useState<Named[]>([]);
  const [generations, setGenerations] = React.useState<Named[]>([]);
  const [engines, setEngines] = React.useState<Engine[]>([]);
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<Engine[]>([]);
  const [error, setError] = React.useState(data.error);

  async function loadModels(value: string) {
    setMakeId(value);
    setModelId("");
    setGenerationId("");
    setModels([]);
    setGenerations([]);
    setEngines([]);
    if (!value) return;
    const payload = await ocean("/models?make_id=" + encodeURIComponent(value));
    setModels(Array.isArray(payload.models) ? payload.models : []);
  }

  async function loadGenerations(value: string) {
    setModelId(value);
    setGenerationId("");
    setGenerations([]);
    setEngines([]);
    if (!value) return;
    const gens = await ocean("/generations?make_id=" + encodeURIComponent(makeId) + "&model_id=" + encodeURIComponent(value));
    const enginesPayload = await ocean("/engines?make_id=" + encodeURIComponent(makeId) + "&model_id=" + encodeURIComponent(value));
    setGenerations(Array.isArray(gens.generations) ? gens.generations : []);
    setEngines(Array.isArray(enginesPayload.engines) ? enginesPayload.engines : []);
  }

  async function loadEngines(value: string) {
    setGenerationId(value);
    const payload = await ocean(
      "/engines?make_id=" + encodeURIComponent(makeId) + "&model_id=" + encodeURIComponent(modelId) + "&generation_id=" + encodeURIComponent(value),
    );
    setEngines(Array.isArray(payload.engines) ? payload.engines : []);
  }

  async function search() {
    setError("");
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    try {
      const payload = await ocean("/vehicle-search?q=" + encodeURIComponent(query.trim()));
      setHits(Array.isArray(payload.results) ? payload.results : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    }
  }

  const make = (data.makes as Named[]).find((row) => text(row.id) === makeId);
  const rows = hits.length ? hits : engines;

  return (
    <Page title="Vehicle Catalogue" subtitle="Type → Make → Model → Generation → exact vehicle">
      <BlockStack gap="400">
        <Banner tone="info">
          <p>Ocean canonical vehicles are the authority. Legacy Shopify vehicle records are not used here.</p>
        </Banner>
        {error ? <Banner tone="critical"><p>{error}</p></Banner> : null}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Browse</Text>
            <Select
              label="Make"
              options={[{ label: "Select a make", value: "" }].concat((data.makes as Named[]).map((row) => ({ label: labelOf(row), value: text(row.id) })))}
              value={makeId}
              onChange={(value) => { loadModels(value).catch((err) => setError(String(err.message || err))); }}
            />
            <Select
              label="Model"
              options={[{ label: "Select a model", value: "" }].concat(models.map((row) => ({ label: labelOf(row), value: text(row.id) })))}
              value={modelId}
              onChange={(value) => { loadGenerations(value).catch((err) => setError(String(err.message || err))); }}
              disabled={!makeId}
            />
            <Select
              label="Generation"
              options={[{ label: generations.length ? "All generations" : "No generation filter", value: "" }].concat(generations.map((row) => ({ label: [labelOf(row), row.year_range].filter(Boolean).join(" · "), value: text(row.id) })))}
              value={generationId}
              onChange={(value) => { loadEngines(value).catch((err) => setError(String(err.message || err))); }}
              disabled={!modelId}
            />
            <Text as="p" tone="subdued">
              {[make ? labelOf(make) : "", models.find((row) => text(row.id) === modelId) ? labelOf(models.find((row) => text(row.id) === modelId) as Named) : ""].filter(Boolean).join(" → ") || "Choose a make to load models from the Ocean catalogue."}
            </Text>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="300">
            <TextField label="Search exact vehicle" value={query} onChange={setQuery} autoComplete="off" placeholder="BMW E90 335i or Mercedes W205" />
            <Button onClick={() => { search().catch((err) => setError(String(err.message || err))); }}>Search</Button>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">{hits.length ? "Search results" : "Exact vehicles"}</Text>
            {rows.length ? (
              <IndexTable
                resourceName={{ singular: "vehicle", plural: "vehicles" }}
                itemCount={rows.length}
                selectable={false}
                headings={[{ title: "Vehicle" }, { title: "Engine" }, { title: "Power" }, { title: "Years" }, { title: "Canonical key" }]}
              >
                {rows.map((row, index) => {
                  const key = text(row.vehicle_key || row.vehicle_id);
                  const place = [row.make_name, row.model_name, row.generation_name, row.title].filter(Boolean).join(" · ");
                  const power = [row.power_kw ? `${row.power_kw} kW` : "", row.power_hp ? `${row.power_hp} HP` : ""].filter(Boolean).join(" / ");
                  const years = text(row.year_range) || [row.year_from, row.year_to].filter(Boolean).join("–");
                  return (
                    <IndexTable.Row id={key || String(index)} key={key || String(index)} position={index}>
                      <IndexTable.Cell>{place || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{text(row.engine_code || row.engine) || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{power || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{years || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{key ? <Badge>{key}</Badge> : "—"}</IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            ) : (
              <Text as="p">No exact vehicles loaded yet.</Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
