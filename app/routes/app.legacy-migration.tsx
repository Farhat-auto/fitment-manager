import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { Banner, BlockStack, Button, Card, Checkbox, IndexTable, Page, Text } from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { oceanGet, oceanPost } from "../ocean/client.server";

function text(value: unknown) {
  return String(value ?? "").trim();
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const queue = await oceanGet("/legacy-migration", "limit=200");
  return json({
    error: text(queue?.error),
    total: Number(queue?.total || 0),
    counts: (queue?.counts || {}) as Record<string, number>,
    items: Array.isArray(queue?.items) ? queue.items : [],
    rewritten: queue?.rewritten === true,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (text(form.get("action")) !== "migrate_unique") {
    return json({ ok: false, error: "unknown_action", rewritten: false });
  }
  const raw = text(form.get("pairs"));
  let pairs: Array<{ product_sku: string; legacy_vehicle: string }> = [];
  try {
    const parsed = JSON.parse(raw || "[]");
    if (Array.isArray(parsed)) pairs = parsed;
  } catch {
    pairs = [];
  }
  const actor = text((session as { email?: string; shop?: string }).email || session.shop || "shopify-admin");
  return json(await oceanPost("/legacy-migration", { action: "migrate_unique", pairs, actor }));
}

export default function LegacyMigration() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as Record<string, any> | undefined;
  const items = data.items as Array<Record<string, any>>;
  const unique = items.filter((item) => item.classification === "UNIQUE MATCH" && !item.already_migrated);
  const [selected, setSelected] = useState<string[]>(unique.map((item) => `${item.product_sku}|${item.legacy_vehicle}`));
  const pairs = unique
    .filter((item) => selected.includes(`${item.product_sku}|${item.legacy_vehicle}`))
    .map((item) => ({ product_sku: text(item.product_sku), legacy_vehicle: text(item.legacy_vehicle) }));

  return (
    <Page title="Legacy migration">
      <BlockStack gap="400">
        <Banner tone="warning" title="Historical relationships stay">
          <p>Legacy keys are not deleted. A unique match copies an unverified candidate onto the canonical ovh vehicle and leaves the stored evidence on the legacy row unchanged.</p>
        </Banner>
        {data.error ? <Banner tone="critical"><p>{data.error}</p></Banner> : null}
        {data.rewritten ? <Banner tone="critical"><p>Unexpected rewrite flag.</p></Banner> : null}
        <Text as="p">Total {data.total}. Unique {data.counts["UNIQUE MATCH"] || 0}. Ambiguous {data.counts.AMBIGUOUS || 0}. No match {data.counts["NO MATCH"] || 0}. Invalid {data.counts.INVALID || 0}.</Text>
        {result ? (
          <Banner tone="info" title="Migration result">
            <p>Migrated {result.migrated_count || 0}. Blocked {result.blocked_count || 0}. Verified {result.verified_count || 0}. Deleted {String(result.deleted === true)}.</p>
          </Banner>
        ) : null}
        <form method="post">
          <input type="hidden" name="action" value="migrate_unique" />
          <input type="hidden" name="pairs" value={JSON.stringify(pairs)} />
          <Button submit variant="primary" disabled={!pairs.length}>Migrate unique matches</Button>
        </form>
        <Card>
          <IndexTable
            resourceName={{ singular: "relationship", plural: "relationships" }}
            itemCount={items.length}
            selectable={false}
            headings={[{ title: "Use" }, { title: "SKU" }, { title: "Class" }, { title: "Before" }, { title: "After" }, { title: "Reason" }]}
          >
            {items.map((item, index) => {
              const id = `${item.product_sku}|${item.legacy_vehicle}`;
              const canSelect = item.classification === "UNIQUE MATCH" && !item.already_migrated;
              return (
                <IndexTable.Row id={id || String(index)} key={id || index} position={index}>
                  <IndexTable.Cell>
                    {canSelect ? <Checkbox label="" checked={selected.includes(id)} onChange={(on) => setSelected((current) => on ? current.concat(id) : current.filter((value) => value !== id))} /> : "—"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{text(item.product_sku)}</IndexTable.Cell>
                  <IndexTable.Cell>{text(item.classification)}</IndexTable.Cell>
                  <IndexTable.Cell>{text(item.legacy_vehicle)}</IndexTable.Cell>
                  <IndexTable.Cell>{text(item.after || item.canonical_vehicle) || "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{text(item.reason) || "—"}</IndexTable.Cell>
                </IndexTable.Row>
              );
            })}
          </IndexTable>
        </Card>
      </BlockStack>
    </Page>
  );
}
