import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Badge, Banner, BlockStack, Button, Card, IndexTable, InlineStack, Page, Text, TextField } from "@shopify/polaris";
import * as React from "react";
import { authenticate } from "../shopify.server";
import { oceanGet, oceanPost } from "../ocean/client.server.ts";

type FitmentRow = {
  id?: string | number;
  vehicle?: string;
  vehicle_key?: string;
  make?: string;
  model?: string;
  generation?: string;
  engine?: string;
  engine_code?: string;
  power_kw?: string;
  power_hp?: string;
  year_from?: string;
  year_to?: string;
  evidence?: string;
  evidence_type?: string;
  evidence_reference?: string;
  trust_level?: string;
  trust_class?: string;
  source?: string;
  source_ref?: string;
  vehicle_active?: boolean;
  review_status?: string;
  conflict_reason?: string;
};

type ReviewPayload = {
  ok?: boolean;
  error?: string;
  sku?: string;
  name?: string;
  brand?: string;
  mpn?: string;
  shopify_product_id?: string;
  shopify_variant_id?: string;
  shopify_admin_path?: string;
  image_url?: string;
  candidate_fitments?: FitmentRow[];
  verified_fitments?: FitmentRow[];
  rejected_fitments?: FitmentRow[];
  conflicts?: FitmentRow[];
  oe_numbers?: Array<{ number?: string }>;
  cross_references?: Array<{ brand?: string; number?: string }>;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const sku = text(new URL(request.url).searchParams.get("sku"));
  const review = sku ? ((await oceanGet("/fitment-review", new URLSearchParams({ sku }).toString())) as ReviewPayload) : null;
  return json({ sku, review });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const actionName = text(fd.get("action"));
  const sku = text(fd.get("sku"));
  const vehicle_key = text(fd.get("vehicle_key"));
  if (!["verify", "reject", "delete", "conflict", "needs_review", "bulk_verify_authoritative"].includes(actionName)) {
    return json({ ok: false, error: "unsupported_action" }, { status: 400 });
  }
  if (["verify", "reject", "delete", "conflict", "needs_review"].includes(actionName) && !/^ovh-[a-f0-9]+$/i.test(vehicle_key)) {
    return json({ ok: false, error: "canonical_vehicle_key_required" }, { status: 400 });
  }
  const actor = text((session as { email?: string; shop?: string }).email || session.shop || "shopify-admin");
  const review = await oceanPost("/fitment-review", { action: actionName, sku, vehicle_key, actor });
  return json(review);
}

function Decision({ actionName, label, sku, vehicleKey, tone }: { actionName: string; label: string; sku: string; vehicleKey: string; tone?: "critical" }) {
  return (
    <Form method="post">
      <input type="hidden" name="action" value={actionName} />
      <input type="hidden" name="sku" value={sku} />
      <input type="hidden" name="vehicle_key" value={vehicleKey} />
      <Button submit tone={tone} variant={actionName === "verify" ? "primary" : undefined}>{label}</Button>
    </Form>
  );
}

function Rows({ rows, sku }: { rows: FitmentRow[]; sku: string }) {
  return (
    <IndexTable
      resourceName={{ singular: "fitment", plural: "fitments" }}
      itemCount={rows.length}
      selectable={false}
      headings={[
        { title: "Vehicle" },
        { title: "Canonical key" },
        { title: "Make / model / generation" },
        { title: "Engine" },
        { title: "Evidence" },
        { title: "Trust" },
        { title: "Source" },
        { title: "Action" },
      ]}
    >
      {rows.map((row, index) => {
        const key = text(row.vehicle_key);
        const place = [row.make, row.model, row.generation].filter(Boolean).join(" · ") || "—";
        const power = [row.power_kw ? `${row.power_kw} kW` : "", row.power_hp ? `${row.power_hp} HP` : ""].filter(Boolean).join(" / ");
        const engine = [row.engine || row.engine_code, power, [row.year_from, row.year_to].filter(Boolean).join("–")].filter(Boolean).join(" · ") || "—";
        const evidence = [row.evidence_type, row.evidence, row.evidence_reference || row.source_ref].map(text).filter(Boolean).join(" · ") || "—";
        const trust = [row.trust_class, row.trust_level].map(text).filter(Boolean).join(" · ") || "—";
        const canVerify = /^ovh-[a-f0-9]+$/i.test(key) && row.vehicle_active !== false;
        return (
          <IndexTable.Row id={String(row.id || key || index)} key={String(row.id || key || index)} position={index}>
            <IndexTable.Cell>{text(row.vehicle) || "—"}</IndexTable.Cell>
            <IndexTable.Cell>{key || "—"}</IndexTable.Cell>
            <IndexTable.Cell>{place}</IndexTable.Cell>
            <IndexTable.Cell>{engine}</IndexTable.Cell>
            <IndexTable.Cell>{evidence}</IndexTable.Cell>
            <IndexTable.Cell>{trust}</IndexTable.Cell>
            <IndexTable.Cell>{text(row.source) || "—"}</IndexTable.Cell>
            <IndexTable.Cell>
              <InlineStack gap="200">
                {canVerify ? <Decision actionName="verify" label="Verify" sku={sku} vehicleKey={key} /> : <Text as="span">Canonical vehicle required</Text>}
                <Decision actionName="reject" label="Reject" sku={sku} vehicleKey={key} tone="critical" />
                <Decision actionName="needs_review" label="Needs review" sku={sku} vehicleKey={key} />
                <Decision actionName="delete" label="Remove invalid candidate" sku={sku} vehicleKey={key} tone="critical" />
              </InlineStack>
            </IndexTable.Cell>
          </IndexTable.Row>
        );
      })}
    </IndexTable>
  );
}

export default function CatalogueFitmentReview() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as ReviewPayload | undefined;
  const nav = useNavigation();
  const [sku, setSku] = React.useState(data.sku || "");
  const review = (result && (result.ok || result.error || result.sku) ? result : data.review) as ReviewPayload | null;
  const candidates = Array.isArray(review?.candidate_fitments) ? review.candidate_fitments : [];
  const conflicts = Array.isArray(review?.conflicts) ? review.conflicts : [];
  const oes = (review?.oe_numbers || []).map((row) => text(row.number)).filter(Boolean);
  const refs = (review?.cross_references || []).map((row) => text(row.number)).filter(Boolean);
  return (
    <Page title="Catalogue fitment review">
      <BlockStack gap="400">
        <Card>
          <Form method="get">
            <BlockStack gap="300">
              <TextField label="Product SKU" name="sku" value={sku} onChange={setSku} autoComplete="off" />
              <Button submit variant="primary">Load review</Button>
            </BlockStack>
          </Form>
        </Card>
        {review?.error ? <Banner tone="critical"><p>{text(review.error)}</p></Banner> : null}
        {review?.ok ? (
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="200">
                {text(review.image_url) ? <img src={text(review.image_url)} alt="" width={72} height={72} /> : null}
                <Text as="h2" variant="headingMd">{text(review.name || review.sku)}</Text>
                <Text as="p">SKU {text(review.sku)} · Brand {text(review.brand) || "—"} · MPN {text(review.mpn) || "—"}</Text>
                <Text as="p">Shopify product {text(review.shopify_product_id) || "—"} · variant {text(review.shopify_variant_id) || "—"}</Text>
                {text(review.shopify_product_id) ? (
                  <Button url={text(review.shopify_admin_path) || `shopify:admin/products/${text(review.shopify_product_id)}`}>Open product in Shopify</Button>
                ) : null}
                <Text as="p">OE {oes.length ? oes.join(", ") : "none"} · Cross references {refs.length ? refs.join(", ") : "none"}</Text>
                <InlineStack gap="200">
                  <Badge>{`${candidates.length} candidates`}</Badge>
                  <Badge tone="success">{`${(review.verified_fitments || []).length} verified`}</Badge>
                  <Badge tone="critical">{`${(review.rejected_fitments || []).length} rejected`}</Badge>
                  <Badge tone="warning">{`${conflicts.length} conflicts`}</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">OE and cross-reference data are identity evidence only. Verify a vehicle only after reviewing authoritative application evidence.</Text>
                {conflicts.length ? <Banner tone="warning"><p>Conflict warnings stay in review. They are not verified by the bulk action.</p></Banner> : null}
                <Form method="post">
                  <input type="hidden" name="action" value="bulk_verify_authoritative" />
                  <input type="hidden" name="sku" value={text(review.sku || sku)} />
                  <Button submit loading={nav.state !== "idle"}>Verify authoritative candidates only</Button>
                </Form>
              </BlockStack>
            </Card>
            <Card>
              <Rows rows={candidates.concat(conflicts)} sku={text(review.sku || sku)} />
            </Card>
          </BlockStack>
        ) : null}
      </BlockStack>
    </Page>
  );
}
