import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  useFetcher,
  useLoaderData,
  useNavigation,
  useParams,
} from "@remix-run/react";
import * as React from "react";
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
  Banner,
  Divider,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { GET_PRODUCT_FOR_FITMENT_EDITOR, SEARCH_VEHICLES, SET_COMPATIBLE_VEHICLES } from "../graphql/fitment";
import {
  deleteFitmentForProductVehicle,
  getFitmentByProductHandle,
  resolveShopDomain,
  upsertFitmentRows,
} from "../fitment/fitment.server";

function fieldValue(x: any): string {
  const v = x?.value;
  return typeof v === "string" ? v.trim() : "";
}

type VehicleSearchNode = {
  id: string;
  handle: string;
  vehicle_key: { value?: string | null } | null;
  display_name: { value?: string | null } | null;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const productHandle = params.productHandle;
  if (!productHandle) throw new Response("Missing productHandle", { status: 400 });

  const shop_domain =
    String((session as any)?.shop ?? "").trim() || resolveShopDomain(request) || "";
  if (!shop_domain) throw new Response("Missing shop_domain", { status: 400 });

  const resp = await admin.graphql(GET_PRODUCT_FOR_FITMENT_EDITOR, {
    variables: { handle: productHandle },
  });
  const data = await resp.json();
  const p = data?.data?.productByHandle;
  if (!p) throw new Response("Product not found", { status: 404 });

  const rows = await getFitmentByProductHandle({ shop_domain, product_handle: productHandle });

  return json({
    shop_domain,
    product: {
      id: String(p?.id ?? ""),
      title: String(p?.title ?? ""),
      handle: String(p?.handle ?? ""),
      sku: String(p?.variants?.nodes?.[0]?.sku ?? "").trim(),
      article_number: String(p?.article_number?.value ?? "").trim(),
      brand: String(p?.brand?.value ?? "").trim(),
    },
    fitmentRows: rows,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const productHandle = params.productHandle;
  if (!productHandle) return json({ ok: false, error: "Missing productHandle" }, { status: 400 });

  const shop_domain =
    String((session as any)?.shop ?? "").trim() || resolveShopDomain(request) || "";
  if (!shop_domain) return json({ ok: false, error: "Missing shop_domain" }, { status: 400 });

  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "").trim();

  if (intent === "vehicle_search") {
    const q = String(fd.get("q") || "").trim();
    const resp = await admin.graphql(SEARCH_VEHICLES, {
      variables: { first: 50, after: null, query: q || null },
    });
    const data = await resp.json();
    const nodes: any[] = Array.isArray(data?.data?.metaobjectsByType?.nodes)
      ? data.data.metaobjectsByType.nodes
      : [];
    const vehicles: VehicleSearchNode[] = nodes.map((n: any) => ({
      id: String(n.id ?? ""),
      handle: String(n.handle ?? ""),
      vehicle_key: n.vehicle_key ?? null,
      display_name: n.display_name ?? null,
    }));
    return json({ ok: true, vehicles });
  }

  if (intent === "add_vehicle") {
    const vehicle_key = String(fd.get("vehicle_key") || "").trim();
    const vehicle_handle = String(fd.get("vehicle_handle") || "").trim() || null;
    const vehicle_gid = String(fd.get("vehicle_gid") || "").trim() || null;
    const vehicle_display_name = String(fd.get("vehicle_display_name") || "").trim() || null;

    const product_gid = String(fd.get("product_gid") || "").trim() || null;
    const sku = String(fd.get("sku") || "").trim() || null;
    const article_number = String(fd.get("article_number") || "").trim() || null;
    const brand = String(fd.get("brand") || "").trim() || null;

    const category_key = String(fd.get("category_key") || "").trim() || null;
    const system_group_key = String(fd.get("system_group_key") || "").trim() || null;
    const subcategory_key = String(fd.get("subcategory_key") || "").trim() || null;

    const debug_request_id = String(fd.get("debug_request_id") || "").trim() || null;

    if (!vehicle_key) return json({ ok: false, error: "Missing vehicle_key" }, { status: 400 });

    await upsertFitmentRows([
      {
        shop_domain,
        product_gid,
        product_handle: productHandle,
        sku,
        article_number,
        brand,
        vehicle_gid,
        vehicle_handle,
        vehicle_key,
        vehicle_display_name,
        category_key,
        system_group_key,
        subcategory_key,
        source: "admin",
      },
    ]);

    return json({ ok: true, debug_request_id });
  }

  if (intent === "remove_vehicle") {
    const vehicle_key = String(fd.get("vehicle_key") || "").trim();
    if (!vehicle_key) return json({ ok: false, error: "Missing vehicle_key" }, { status: 400 });

    await deleteFitmentForProductVehicle({
      shop_domain,
      product_handle: productHandle,
      vehicle_key,
    });
    return json({ ok: true });
  }

  if (intent === "sync_shopify") {
    // Optional: write the compatible vehicle GID list into Shopify metafield.
    const product_gid = String(fd.get("product_gid") || "").trim();
    if (!product_gid) return json({ ok: false, error: "Missing product_gid" }, { status: 400 });

    const rows = await getFitmentByProductHandle({ shop_domain, product_handle: productHandle });
    const vehicleGids = Array.from(
      new Set(
        rows
          .map((r: any) => (r?.vehicle_gid ? String(r.vehicle_gid) : ""))
          .filter(Boolean),
      ),
    );
    const value = JSON.stringify(vehicleGids);
    const resp = await admin.graphql(SET_COMPATIBLE_VEHICLES, {
      variables: { ownerId: product_gid, value },
    });
    const data = await resp.json();
    const errs = data?.data?.metafieldsSet?.userErrors ?? [];
    if (Array.isArray(errs) && errs.length) {
      return json({ ok: false, userErrors: errs }, { status: 400 });
    }
    return json({ ok: true, vehicleCount: vehicleGids.length });
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
}

export default function FitmentEditor() {
  const { product, fitmentRows } = useLoaderData<typeof loader>();
  const params = useParams();
  const navigation = useNavigation();

  const vehicleFetcher = useFetcher<typeof action>();
  const mutateFetcher = useFetcher<typeof action>();
  const syncFetcher = useFetcher<typeof action>();

  const [q, setQ] = React.useState("");
  const [subcategoryKey, setSubcategoryKey] = React.useState("electric-water-pump");
  const [error, setError] = React.useState<string | null>(null);

  const [debugSelected, setDebugSelected] = React.useState<{
    vehicle_key: string;
    vehicle_handle: string;
    vehicle_gid: string;
  } | null>(null);
  const [debugLastRequestId, setDebugLastRequestId] = React.useState<string>("");
  const [debugSaved, setDebugSaved] = React.useState<boolean>(false);

  const isBusy =
    navigation.state !== "idle" ||
    vehicleFetcher.state !== "idle" ||
    mutateFetcher.state !== "idle" ||
    syncFetcher.state !== "idle";

  const assigned = React.useMemo(() => {
    return (fitmentRows as any[]).map((r) => ({
      vehicle_key: String(r.vehicle_key ?? ""),
      vehicle_handle: String(r.vehicle_handle ?? ""),
      vehicle_gid: String(r.vehicle_gid ?? ""),
      vehicle_display_name: String(r.vehicle_display_name ?? ""),
    }));
  }, [fitmentRows]);

  const assignedKeySet = React.useMemo(() => new Set(assigned.map((a) => a.vehicle_key)), [assigned]);

  function submitVehicleSearch(next: string) {
    const fd = new FormData();
    fd.set("_intent", "vehicle_search");
    fd.set("q", next);
    vehicleFetcher.submit(fd, { method: "post" });
  }

  function addVehicle(v: any) {
    const vehicle_key = fieldValue(v?.vehicle_key);
    if (!vehicle_key) {
      setError("Selected vehicle is missing vehicle_key.");
      return;
    }
    if (assignedKeySet.has(vehicle_key)) return;

    const vehicle_handle = String(v?.handle ?? "");
    const vehicle_gid = String(v?.id ?? "");
    setDebugSelected({
      vehicle_key,
      vehicle_handle,
      vehicle_gid,
    });
    const reqId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setDebugLastRequestId(reqId);
    setDebugSaved(false);

    const fd = new FormData();
    fd.set("_intent", "add_vehicle");
    fd.set("product_gid", product.id);
    fd.set("sku", product.sku || "");
    fd.set("article_number", product.article_number || "");
    fd.set("brand", product.brand || "");

    fd.set("vehicle_key", vehicle_key);
    fd.set("vehicle_handle", vehicle_handle);
    fd.set("vehicle_gid", vehicle_gid);
    fd.set("vehicle_display_name", fieldValue(v?.display_name));
    fd.set("subcategory_key", String(subcategoryKey || "").trim());
    fd.set("debug_request_id", reqId);
    mutateFetcher.submit(fd, { method: "post" });
  }

  React.useEffect(() => {
    const d: any = mutateFetcher.data;
    if (!d) return;
    if (d.ok === true && d.debug_request_id && d.debug_request_id === debugLastRequestId) {
      setDebugSaved(true);
    }
  }, [mutateFetcher.data, debugLastRequestId]);

  function removeVehicle(vehicle_key: string) {
    const fd = new FormData();
    fd.set("_intent", "remove_vehicle");
    fd.set("vehicle_key", vehicle_key);
    mutateFetcher.submit(fd, { method: "post" });
  }

  function syncToShopify() {
    const fd = new FormData();
    fd.set("_intent", "sync_shopify");
    fd.set("product_gid", product.id);
    syncFetcher.submit(fd, { method: "post" });
  }

  const vehicles = (vehicleFetcher.data as any)?.vehicles ?? [];

  return (
    <Page
      title={`Fitment: ${product.title || product.handle}`}
      subtitle={product.handle}
      backAction={{ content: "Products", url: "/app/products" }}
      secondaryActions={[
        {
          content: "Sync to Shopify (optional)",
          onAction: syncToShopify,
          disabled: isBusy,
        },
      ]}
    >
      <BlockStack gap="400">
        {error ? (
          <Banner title="Error" tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        ) : null}

        {syncFetcher.data && (syncFetcher.data as any).ok === false ? (
          <Banner title="Shopify sync failed" tone="critical">
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify((syncFetcher.data as any).userErrors ?? syncFetcher.data, null, 2)}
            </pre>
          </Banner>
        ) : null}

        {syncFetcher.data && (syncFetcher.data as any).ok === true ? (
          <Banner title="Synced to Shopify" tone="success">
            <p>
              Wrote {String((syncFetcher.data as any).vehicleCount ?? 0)} vehicle references to{" "}
              <code>custom.compatible_vehicles</code>.
            </p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <InlineStack gap="300" wrap={false}>
              <Text as="span" variant="bodyMd">
                SKU: <strong>{product.sku || "—"}</strong>
              </Text>
              <Text as="span" variant="bodyMd">
                Article #: <strong>{product.article_number || "—"}</strong>
              </Text>
              <Text as="span" variant="bodyMd">
                Brand: <strong>{product.brand || "—"}</strong>
              </Text>
              <Badge tone="info">{`Supabase rows: ${assigned.length}`}</Badge>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Assigned vehicles
            </Text>
            <Divider />
            {!assigned.length ? (
              <Text as="p" variant="bodyMd">
                No vehicles assigned yet.
              </Text>
            ) : (
              <ResourceList
                resourceName={{ singular: "vehicle", plural: "vehicles" }}
                items={assigned}
                renderItem={(item) => {
                  const label =
                    item.vehicle_display_name ||
                    item.vehicle_key ||
                    item.vehicle_handle ||
                    item.vehicle_gid;
                  return (
                    <ResourceItem id={item.vehicle_key} onClick={() => {}} accessibilityLabel={label}>
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {label}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            vehicle_key: {item.vehicle_key}
                            {item.vehicle_handle ? ` · handle: ${item.vehicle_handle}` : ""}
                          </Text>
                        </BlockStack>
                        <Button
                          variant="primary"
                          tone="critical"
                          onClick={() => removeVehicle(item.vehicle_key)}
                          disabled={isBusy}
                        >
                          Remove
                        </Button>
                      </InlineStack>
                    </ResourceItem>
                  );
                }}
              />
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Add vehicle
            </Text>
            <InlineStack gap="300" wrap={false}>
              <TextField
                label="Subcategory key (optional)"
                value={subcategoryKey}
                onChange={(v) => setSubcategoryKey(v)}
                autoComplete="off"
                helpText="Used by /api/fitment/products?vehicle_key=&subcategory_key= filtering. Example: electric-water-pump"
              />
            </InlineStack>
            <Form method="post" onSubmit={(e) => e.preventDefault()}>
              <InlineStack gap="300" blockAlign="end">
                <TextField
                  label="Search vehicles"
                  value={q}
                  onChange={(v) => setQ(v)}
                  autoComplete="off"
                  helpText="Search by vehicle_key / handle / display name."
                />
                <Button
                  variant="primary"
                  onClick={() => submitVehicleSearch(q)}
                  disabled={isBusy || !q.trim()}
                >
                  Search
                </Button>
              </InlineStack>
            </Form>
            {vehicleFetcher.data && (vehicleFetcher.data as any).ok === false ? (
              <Banner title="Search failed" tone="critical">
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(vehicleFetcher.data, null, 2)}
                </pre>
              </Banner>
            ) : null}
            {Array.isArray(vehicles) && vehicles.length ? (
              <ResourceList
                resourceName={{ singular: "vehicle", plural: "vehicles" }}
                items={vehicles}
                renderItem={(v: any) => {
                  const vk = fieldValue(v?.vehicle_key);
                  const label = fieldValue(v?.display_name) || vk || v?.handle || v?.id;
                  const already = !!(vk && assignedKeySet.has(vk));
                  return (
                    <ResourceItem id={String(v?.id ?? vk ?? "")} onClick={() => {}} accessibilityLabel={String(label)}>
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {label}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            vehicle_key: {vk || "—"} · handle: {String(v?.handle ?? "—")}
                          </Text>
                        </BlockStack>
                        <Button onClick={() => addVehicle(v)} disabled={isBusy || already}>
                          {already ? "Added" : "Add"}
                        </Button>
                      </InlineStack>
                    </ResourceItem>
                  );
                }}
              />
            ) : null}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Debug
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Product handle: <strong>{product.handle}</strong>
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Selected vehicle_key: <strong>{debugSelected?.vehicle_key || "—"}</strong>
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Selected vehicle_handle: <strong>{debugSelected?.vehicle_handle || "—"}</strong>
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Vehicle GID: <strong>{debugSelected?.vehicle_gid || "—"}</strong>
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Supabase row saved: <strong>{debugSaved ? "yes" : "no"}</strong>
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

