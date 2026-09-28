import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { Banner, BlockStack, Button, Card, IndexTable, Page, Text, TextField } from "@shopify/polaris";
import * as React from "react";
import { authenticate } from "../shopify.server";
import { oceanPost } from "../ocean/client.server";

function text(value: unknown) {
  return String(value ?? "").trim();
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({ ok: true });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const csv = text(fd.get("csv"));
  const source = text(fd.get("source"));
  const sourceFile = text(fd.get("source_file"));
  if (!csv) return json({ ok: false, error: "csv_required" }, { status: 400 });
  if (!source) return json({ ok: false, error: "source_required" }, { status: 400 });
  const actor = text((session as { email?: string; shop?: string }).email || session.shop || "shopify-admin");
  const result = await oceanPost("/fitment-review", {
    action: "import_applications",
    csv,
    source,
    source_file: sourceFile,
    actor,
  });
  return json(result);
}

export default function ApplicationImport() {
  const result = useActionData<typeof action>() as {
    ok?: boolean;
    error?: string;
    imported?: number;
    verified_count?: number;
    results?: Array<Record<string, unknown>>;
  } | undefined;
  const nav = useNavigation();
  const [csv, setCsv] = React.useState("");
  const [source, setSource] = React.useState("");
  const [sourceFile, setSourceFile] = React.useState("");
  const rows = Array.isArray(result?.results) ? result.results.slice(0, 50) : [];
  return (
    <Page title="Import application data">
      <BlockStack gap="400">
        <Banner tone="info" title="Application statements only">
          <p>
            Identify the article by SKU, brand plus MPN, or a unique OE number. Identify the vehicle
            by an ovh-* key or by make, chassis, engine, and power. A row is verified only when it is
            an application statement, the source marks it verified, and exactly one active canonical
            vehicle matches. OE equality, a title, or marketing text stays unverified.
          </p>
        </Banner>
        <Card>
          <Form method="post">
            <BlockStack gap="300">
              <TextField label="Source" name="source" value={source} onChange={setSource} autoComplete="off" helpText="Manufacturer or supplier name recorded as provenance." />
              <TextField label="Source file" name="source_file" value={sourceFile} onChange={setSourceFile} autoComplete="off" />
              <TextField
                label="Application CSV"
                name="csv"
                value={csv}
                onChange={setCsv}
                multiline={8}
                autoComplete="off"
                helpText="Columns: sku, brand, mpn, oe_number, vehicle_key, make, model, generation, engine, power_kw, year_from, year_to, evidence_type, evidence_value, source_state, source_ref"
              />
              <Button submit variant="primary" loading={nav.state !== "idle"}>Import</Button>
            </BlockStack>
          </Form>
        </Card>
        {result?.error ? <Banner tone="critical"><p>{text(result.error)}</p></Banner> : null}
        {result?.ok ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Result</Text>
              <Text as="p">Imported {result.imported || 0}. Verified {result.verified_count || 0}.</Text>
              {rows.length ? (
                <IndexTable resourceName={{ singular: "row", plural: "rows" }} itemCount={rows.length} selectable={false} headings={[{ title: "SKU" }, { title: "Vehicle" }, { title: "Status" }, { title: "Trust" }, { title: "Error" }]}>
                  {rows.map((row, index) => (
                    <IndexTable.Row id={String(index)} key={String(index)} position={index}>
                      <IndexTable.Cell>{text(row.sku) || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{text(row.vehicle_key) || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{text(row.review_status) || (row.ok ? "stored" : "rejected")}</IndexTable.Cell>
                      <IndexTable.Cell>{text(row.trust_level) || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{text(row.error || row.block_reason) || "—"}</IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              ) : null}
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </Page>
  );
}
