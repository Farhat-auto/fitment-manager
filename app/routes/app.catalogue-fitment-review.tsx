import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Text, TextField, Button, Badge, Banner, IndexTable } from "@shopify/polaris";
import * as React from "react";
import { authenticate } from "../shopify.server";

function origin() { return String(process.env.OCEAN_CATALOGUE_URL || "").trim().replace(/\/$/, ""); }
async function requestReview(sku: string, init?: RequestInit) {
  const base = origin();
  if (!base) return { ok: false, error: "ocean_catalogue_url_missing" };
  const u = new URL(base + "/ocean-catalogue-manager/shopify-admin/fitment-review");
  if (!init) u.searchParams.set("sku", sku);
  const r = await fetch(u.toString(), init);
  return r.json();
}
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const sku = String(new URL(request.url).searchParams.get("sku") || "").trim();
  return json({ sku, review: sku ? await requestReview(sku) : null });
}
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const action = String(fd.get("action") || "");
  const sku = String(fd.get("sku") || "").trim();
  const vehicle_key = String(fd.get("vehicle_key") || "").trim();
  if (!["verify","reject","bulk_verify_authoritative"].includes(action)) return json({ ok:false,error:"unsupported_action" },{status:400});
  if (["verify","reject"].includes(action) && !/^ovh-[a-f0-9]+$/i.test(vehicle_key)) return json({ok:false,error:"canonical_vehicle_key_required"},{status:400});
  const actor = String((session as any)?.email || (session as any)?.shop || "shopify-admin");
  const review = await requestReview(sku,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,sku,vehicle_key,actor})});
  return json(review);
}
function Rows({ rows, sku }: { rows:any[]; sku:string }) {
  return <IndexTable resourceName={{singular:"fitment",plural:"fitments"}} itemCount={rows.length} selectable={false}
    headings={[{title:"Vehicle"},{title:"Key"},{title:"Evidence"},{title:"Trust"},{title:"Source"},{title:"Action"}]}>
    {rows.map((r:any,i:number)=><IndexTable.Row id={String(r.id||i)} key={String(r.id||i)} position={i}>
      <IndexTable.Cell>{String(r.vehicle||"—")}</IndexTable.Cell><IndexTable.Cell>{String(r.vehicle_key||"—")}</IndexTable.Cell>
      <IndexTable.Cell>{String(r.evidence||r.evidence_type||"—")}</IndexTable.Cell><IndexTable.Cell>{String(r.trust_level||"—")}</IndexTable.Cell>
      <IndexTable.Cell>{String(r.source||"—")}</IndexTable.Cell><IndexTable.Cell><InlineStack gap="200">
        <Form method="post"><input type="hidden" name="action" value="verify"/><input type="hidden" name="sku" value={sku}/><input type="hidden" name="vehicle_key" value={String(r.vehicle_key||"")}/><Button submit variant="primary">Verify</Button></Form>
        <Form method="post"><input type="hidden" name="action" value="reject"/><input type="hidden" name="sku" value={sku}/><input type="hidden" name="vehicle_key" value={String(r.vehicle_key||"")}/><Button submit tone="critical">Reject</Button></Form>
      </InlineStack></IndexTable.Cell></IndexTable.Row>)}
  </IndexTable>;
}
export default function CatalogueFitmentReview(){
 const data:any=useLoaderData<typeof loader>(); const result:any=useActionData<typeof action>(); const nav=useNavigation();
 const [sku,setSku]=React.useState(data.sku||""); const review:any=result?.ok ? result : data.review;
 const candidates=Array.isArray(review?.candidate_fitments)?review.candidate_fitments:[];
 return <Page title="Catalogue fitment review"><BlockStack gap="400">
  <Card><Form method="get"><BlockStack gap="300"><TextField label="Product SKU" name="sku" value={sku} onChange={setSku} autoComplete="off"/><Button submit variant="primary">Load review</Button></BlockStack></Form></Card>
  {review?.error?<Banner tone="critical"><p>{String(review.error)}</p></Banner>:null}
  {review?.ok?<><Card><BlockStack gap="200"><Text as="h2" variant="headingMd">{String(review.name||review.sku)}</Text><InlineStack gap="200"><Badge>{String(candidates.length)} candidates</Badge><Badge tone="success">{String((review.verified_fitments||[]).length)} verified</Badge><Badge tone="critical">{String((review.rejected_fitments||[]).length)} rejected</Badge></InlineStack><Text as="p" tone="subdued">OE and cross-reference data are identity evidence only. Verify a vehicle only after reviewing authoritative application evidence.</Text><Form method="post"><input type="hidden" name="action" value="bulk_verify_authoritative"/><input type="hidden" name="sku" value={String(review.sku||sku)}/><Button submit loading={nav.state!=="idle"}>Verify authoritative candidates only</Button></Form></BlockStack></Card>
  <Card><Rows rows={candidates} sku={String(review.sku||sku)}/></Card></>:null}
 </BlockStack></Page>;
}
