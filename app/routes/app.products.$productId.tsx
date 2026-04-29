import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  useFetcher,
  useLoaderData,
  useNavigation,
  useParams,
} from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  ResourceList,
  ResourceItem,
  Text,
  Button,
  TextField,
  InlineStack,
  ContextualSaveBar,
  Divider,
  Banner,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {
  GET_PRODUCT_FITMENT,
  SEARCH_VEHICLES,
  SET_COMPATIBLE_VEHICLES,
} from "../graphql/fitment";

type VehicleNode = {
  id: string;
  handle: string;
  vehicle_key?: { value?: string | null } | null;
  display_name?: { value?: string | null } | null;
  engine_code?: { value?: string | null } | null;
  power_kw?: { value?: string | null } | null;
  power_hp?: { value?: string | null } | null;
  body_type?: { value?: string | null } | null;
  year_from?: { value?: string | null } | null;
  year_to?: { value?: string | null } | null;
  fuel_type?: { value?: string | null } | null;
};

function normalizeProductId(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    // Deep links can pass URL-encoded GIDs from extensions.
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fieldValue(x: any): string {
  const v = x?.value;
  return typeof v === "string" ? v.trim() : "";
}

function vehicleLabel(v: VehicleNode): string {
  return (
    fieldValue(v.display_name) ||
    fieldValue(v.vehicle_key) ||
    (v.handle ? String(v.handle) : "") ||
    (v.id ? String(v.id) : "")
  );
}

function normalizeLines(text: string): string[] {
  return String(text || "")
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const productId = normalizeProductId(params.productId ?? "");
  if (!productId) throw new Response("Missing productId", { status: 400 });

  const resp = await admin.graphql(GET_PRODUCT_FITMENT, {
    variables: { id: productId, refsFirst: 250 },
  });
  const data = await resp.json();
  const p = data?.data?.product;
  if (!p) throw new Response("Product not found", { status: 404 });

  const refs = p?.compatibleVehicles?.references;
  const vehicles: VehicleNode[] = Array.isArray(refs?.nodes) ? refs.nodes : [];

  return json({
    product: {
      id: String(p.id),
      title: String(p.title ?? ""),
      handle: String(p.handle ?? ""),
    },
    assignedVehicles: vehicles.map((v: any) => ({
      id: String(v.id),
      handle: String(v.handle ?? ""),
      vehicle_key: v.vehicle_key ?? null,
      display_name: v.display_name ?? null,
      engine_code: v.engine_code ?? null,
      power_kw: v.power_kw ?? null,
      power_hp: v.power_hp ?? null,
      body_type: v.body_type ?? null,
      year_from: v.year_from ?? null,
      year_to: v.year_to ?? null,
      fuel_type: v.fuel_type ?? null,
    })),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const productId = normalizeProductId(params.productId ?? "");
  if (!productId) return json({ ok: false, error: "Missing productId" }, { status: 400 });

  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "save").trim();

  if (intent === "search") {
    const q = String(fd.get("q") || "").trim();
    const after = fd.get("after") ? String(fd.get("after")) : null;
    const resp = await admin.graphql(SEARCH_VEHICLES, {
      variables: {
        first: 50,
        after,
        query: q || null,
      },
    });
    const data = await resp.json();
    const mo = data?.data?.metaobjectsByType;
    const nodes = Array.isArray(mo?.nodes) ? mo.nodes : [];
    return json({
      ok: true,
      pageInfo: mo?.pageInfo ?? { hasNextPage: false, endCursor: null },
      vehicles: nodes.map((n: any) => ({
        id: String(n.id),
        handle: String(n.handle ?? ""),
        vehicle_key: n.vehicle_key ?? null,
        display_name: n.display_name ?? null,
      })),
    });
  }

  if (intent === "resolve_bulk") {
    const raw = String(fd.get("bulk") || "");
    const keys = normalizeLines(raw).slice(0, 500);
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const k of keys) {
      const low = k.toLowerCase();
      if (seen.has(low)) continue;
      seen.add(low);
      uniq.push(k);
    }

    // Resolve by querying metaobjectsByType with the key as the query string.
    // (Shopify query syntax varies per shop; we do best-effort here.)
    const resolved: Array<{ key: string; matches: Array<{ id: string; handle: string; display_name: any; vehicle_key: any }> }> = [];
    for (const k of uniq.slice(0, 120)) {
      const resp = await admin.graphql(SEARCH_VEHICLES, {
        variables: { first: 10, after: null, query: k },
      });
      const data = await resp.json();
      const nodes = Array.isArray(data?.data?.metaobjectsByType?.nodes)
        ? data.data.metaobjectsByType.nodes
        : [];
      resolved.push({
        key: k,
        matches: nodes.map((n: any) => ({
          id: String(n.id),
          handle: String(n.handle ?? ""),
          display_name: n.display_name ?? null,
          vehicle_key: n.vehicle_key ?? null,
        })),
      });
    }

    return json({ ok: true, resolved });
  }

  // Save
  const value = String(fd.get("value") || "").trim();
  const resp = await admin.graphql(SET_COMPATIBLE_VEHICLES, {
    variables: { ownerId: productId, value },
  });
  const data = await resp.json();
  const errs = data?.data?.metafieldsSet?.userErrors ?? [];
  if (Array.isArray(errs) && errs.length) {
    return json({ ok: false, userErrors: errs }, { status: 400 });
  }
  return json({ ok: true });
}

export default function ProductFitment() {
  const { product, assignedVehicles } = useLoaderData<typeof loader>();
  const params = useParams();
  const navigation = useNavigation();

  const searchFetcher = useFetcher<typeof action>();
  const bulkFetcher = useFetcher<typeof action>();
  const saveFetcher = useFetcher<typeof action>();

  const [assigned, setAssigned] = React.useState<VehicleNode[]>(assignedVehicles as any);
  const [search, setSearch] = React.useState("");
  const [bulk, setBulk] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const isSaving = saveFetcher.state !== "idle" || navigation.state !== "idle";
  const initialIds = React.useMemo(() => (assignedVehicles as any[]).map((v) => String(v.id)).sort(), [assignedVehicles]);
  const currentIds = React.useMemo(() => assigned.map((v) => String(v.id)).sort(), [assigned]);
  const dirty = React.useMemo(() => initialIds.join("|") !== currentIds.join("|"), [initialIds, currentIds]);

  const assignedIdSet = React.useMemo(() => new Set(assigned.map((v) => String(v.id))), [assigned]);

  function removeVehicle(id: string) {
    setAssigned((prev) => prev.filter((v) => String(v.id) !== String(id)));
  }

  function addVehicle(v: any) {
    const id = String(v.id);
    if (assignedIdSet.has(id)) return;
    setAssigned((prev) => [...prev, v]);
  }

  function submitSearch(q: string) {
    const fd = new FormData();
    fd.set("_intent", "search");
    fd.set("q", q);
    searchFetcher.submit(fd, { method: "post" });
  }

  function resolveBulk() {
    const fd = new FormData();
    fd.set("_intent", "resolve_bulk");
    fd.set("bulk", bulk);
    bulkFetcher.submit(fd, { method: "post" });
  }

  function save() {
    setError(null);
    const gids = assigned.map((v) => String(v.id));
    const fd = new FormData();
    fd.set("_intent", "save");
    fd.set("value", JSON.stringify(gids));
    saveFetcher.submit(fd, { method: "post" });
  }

  React.useEffect(() => {
    const u = (saveFetcher.data as any)?.userErrors;
    if (Array.isArray(u) && u.length) {
      setError(String(u[0]?.message || "Failed to save"));
    }
  }, [saveFetcher.data]);

  const searchResults: any[] =
    (searchFetcher.data as any)?.vehicles && Array.isArray((searchFetcher.data as any).vehicles)
      ? ((searchFetcher.data as any).vehicles as any[])
      : [];

  const bulkResolved: any[] =
    (bulkFetcher.data as any)?.resolved && Array.isArray((bulkFetcher.data as any).resolved)
      ? ((bulkFetcher.data as any).resolved as any[])
      : [];

  return (
    <Page
      title={`${product.title} — Fitment Management`}
      backAction={{ content: "Products", url: "/app/products" }}
    >
      {dirty ? (
        <ContextualSaveBar
          message="Unsaved changes"
          saveAction={{ content: "Save", onAction: save, loading: isSaving, disabled: isSaving }}
          discardAction={{
            content: "Discard",
            onAction: () => setAssigned(assignedVehicles as any),
            disabled: isSaving,
          }}
        />
      ) : null}

      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Save failed">
            <p>{error}</p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Assigned Vehicles ({assigned.length})
            </Text>
            {assigned.length ? (
              <ResourceList
                items={assigned}
                renderItem={(item: any) => {
                  const id = String(item.id);
                  return (
                    <ResourceItem id={id} onClick={() => {}}>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="bodyMd">
                          {vehicleLabel(item)}
                        </Text>
                        <Button tone="critical" onClick={() => removeVehicle(id)}>
                          Remove
                        </Button>
                      </InlineStack>
                    </ResourceItem>
                  );
                }}
              />
            ) : (
              <EmptyState
                heading="No vehicles assigned"
                action={{ content: "Search vehicles below" }}
                image="https://cdn.shopify.com/static/images/admin/empty-state-illustrations/search.svg"
              >
                <p>Add vehicles to control fitment for this product.</p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Add Vehicles
            </Text>
            <TextField
              label="Search"
              value={search}
              onChange={(v) => setSearch(v)}
              autoComplete="off"
              placeholder="Search by display name or vehicle_key"
              connectedRight={
                <Button onClick={() => submitSearch(search)} loading={searchFetcher.state !== "idle"}>
                  Search
                </Button>
              }
            />
            {searchResults.length ? (
              <ResourceList
                items={searchResults.filter((x) => !assignedIdSet.has(String(x.id)))}
                renderItem={(item: any) => {
                  const id = String(item.id);
                  return (
                    <ResourceItem id={id} onClick={() => {}}>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="bodyMd">
                          {vehicleLabel(item)}
                        </Text>
                        <Button onClick={() => addVehicle(item)}>Add</Button>
                      </InlineStack>
                    </ResourceItem>
                  );
                }}
              />
            ) : (
              <Text as="p" variant="bodyMd" tone="subdued">
                Search to see vehicles.
              </Text>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Bulk Add
            </Text>
            <TextField
              label="Paste vehicle_key values (one per line)"
              value={bulk}
              onChange={(v) => setBulk(v)}
              autoComplete="off"
              multiline={6}
              placeholder="bmw-x6-e71-e72-xdrive35i-n54-n55-225-kw-306-hp-..."
            />
            <InlineStack gap="200">
              <Button onClick={resolveBulk} loading={bulkFetcher.state !== "idle"}>
                Resolve &amp; Add
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setBulk("");
                }}
              >
                Clear
              </Button>
            </InlineStack>

            {bulkResolved.length ? (
              <BlockStack gap="200">
                <Divider />
                <Text as="p" variant="bodyMd" tone="subdued">
                  Resolution results (best-effort). Click Add on the correct match.
                </Text>
                <ResourceList
                  items={bulkResolved}
                  renderItem={(row: any) => {
                    const key = String(row.key || "");
                    const matches: any[] = Array.isArray(row.matches) ? row.matches : [];
                    return (
                      <ResourceItem id={key} onClick={() => {}}>
                        <BlockStack gap="150">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {key}
                          </Text>
                          {matches.length ? (
                            <ResourceList
                              items={matches.filter((m) => !assignedIdSet.has(String(m.id)))}
                              renderItem={(m: any) => {
                                const id = String(m.id);
                                return (
                                  <ResourceItem id={id} onClick={() => {}}>
                                    <InlineStack align="space-between" blockAlign="center">
                                      <Text as="span" variant="bodyMd">
                                        {vehicleLabel(m)}
                                      </Text>
                                      <Button onClick={() => addVehicle(m)}>Add</Button>
                                    </InlineStack>
                                  </ResourceItem>
                                );
                              }}
                            />
                          ) : (
                            <Text as="p" variant="bodyMd" tone="subdued">
                              No matches found.
                            </Text>
                          )}
                        </BlockStack>
                      </ResourceItem>
                    );
                  }}
                />
              </BlockStack>
            ) : null}
          </BlockStack>
        </Card>

        {/* Hidden save form for non-JS fallback (optional) */}
        <Form method="post" style={{ display: "none" }}>
          <input type="hidden" name="_intent" value="save" />
          <input type="hidden" name="value" value={JSON.stringify(assigned.map((v) => v.id))} />
          <button type="submit">Save</button>
        </Form>
      </BlockStack>
    </Page>
  );
}

import * as React from "react";

