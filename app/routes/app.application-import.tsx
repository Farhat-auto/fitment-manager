import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { Banner, BlockStack, Button, Card, DropZone, IndexTable, InlineStack, Page, ProgressBar, Text, TextField } from "@shopify/polaris";
import * as React from "react";
import { authenticate } from "../shopify.server";
import { oceanPost } from "../ocean/client.server";
import { applicationBatchCsv, exampleCsv, issueReportCsv, parseApplicationCsv, templateCsv, type ApplicationIssue, type ApplicationRecord } from "../fitment/applicationCsv";

const BATCH_SIZE = 100;
const MAX_BATCH_BYTES = 512_000;
const MAX_FILE_BYTES = 50_000_000;

function text(value: unknown) { return String(value ?? "").trim(); }

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
  const batchToken = text(fd.get("batch_token"));
  if (!csv || !source || !sourceFile) return json({ ok: false, error: "CSV, source and source file are required", batch_token: batchToken }, { status: 400 });
  if (csv.length > MAX_BATCH_BYTES) return json({ ok: false, error: "Batch exceeds 512 KB", batch_token: batchToken }, { status: 413 });
  const parsed = parseApplicationCsv(csv);
  if (parsed.error || parsed.issues.length || parsed.records.length < 1 || parsed.records.length > BATCH_SIZE) {
    return json({ ok: false, error: parsed.error || parsed.issues[0]?.error || `Use 1–${BATCH_SIZE} rows per batch`, batch_token: batchToken }, { status: 400 });
  }
  const actor = text((session as { email?: string; shop?: string }).email || session.shop || "shopify-admin");
  try {
    const result = await oceanPost("/fitment-review", {
      action: "import_applications", csv, source, source_file: sourceFile, actor,
    });
    const payload = result as { ok?: boolean; error?: string; imported?: number; verified_count?: number; results?: Array<Record<string, unknown>> };
    return json({ ...payload, batch_token: batchToken }, { status: payload?.error || payload?.ok === false ? 400 : 200 });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Import service unavailable", batch_token: batchToken }, { status: 502 });
  }
}

function downloadCsv(filename: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Result = { ok?: boolean; error?: string; detail?: string; batch_token?: string; imported?: number; verified_count?: number; results?: Array<Record<string, unknown>> };

export default function ApplicationImport() {
  const fetcher = useFetcher<typeof action>();
  const [source, setSource] = React.useState("");
  const [sourceFile, setSourceFile] = React.useState("");
  const [records, setRecords] = React.useState<ApplicationRecord[]>([]);
  const [issues, setIssues] = React.useState<ApplicationIssue[]>([]);
  const [fileError, setFileError] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [processed, setProcessed] = React.useState(0);
  const [imported, setImported] = React.useState(0);
  const [verified, setVerified] = React.useState(0);
  const [serverIssues, setServerIssues] = React.useState<ApplicationIssue[]>([]);
  const [batchError, setBatchError] = React.useState("");
  const position = React.useRef(0);
  const current = React.useRef<{ token: string; rows: ApplicationRecord[] } | null>(null);
  const runningRef = React.useRef(false);
  const recordsRef = React.useRef<ApplicationRecord[]>([]);
  const sourceRef = React.useRef("");
  const fileRef = React.useRef("");

  function sendBatch() {
    if (!runningRef.current || current.current) return;
    const rows = recordsRef.current.slice(position.current, position.current + BATCH_SIZE);
    if (!rows.length) { runningRef.current = false; setRunning(false); return; }
    const csv = applicationBatchCsv(rows);
    if (csv.length > MAX_BATCH_BYTES) {
      setBatchError(`Row ${rows[0].line} is too large for one batch. Remove large fields and retry.`);
      runningRef.current = false; setRunning(false); return;
    }
    const token = `${Date.now()}-${position.current}-${Math.random()}`;
    current.current = { token, rows };
    const fd = new FormData();
    fd.set("csv", csv); fd.set("source", sourceRef.current); fd.set("source_file", fileRef.current); fd.set("batch_token", token);
    fetcher.submit(fd, { method: "post" });
  }

  React.useEffect(() => {
    const result = fetcher.data as Result | undefined;
    const active = current.current;
    if (!active || fetcher.state !== "idle" || result?.batch_token !== active.token) return;
    current.current = null;
    if (result.ok === false || result.error) {
      const reason = [text(result.error), text(result.detail)].filter(Boolean).join(": ") || "Import failed";
      setBatchError(`Stopped at CSV row ${active.rows[0].line}: ${reason}. Resume retries this batch.`);
      runningRef.current = false; setRunning(false);
      return;
    }
    const count = Number(result.imported);
    if (!Number.isInteger(count) || count < 0 || count > active.rows.length) {
      setBatchError(`The service did not confirm how many rows it saved in the batch starting at line ${active.rows[0].line}. Check the catalogue before retrying.`);
      runningRef.current = false; setRunning(false);
      return;
    }
    const failures: ApplicationIssue[] = (Array.isArray(result.results) ? result.results : []).flatMap((row, index) => {
      if (row.ok !== false && !row.error && !row.block_reason) return [];
      return [{
        line: active.rows[index]?.line ?? active.rows[0].line,
        error: text(row.error || row.block_reason) || "Rejected by catalogue",
        values: active.rows[index]?.values,
      }];
    });
    if (failures.length) setServerIssues((prev) => [...prev, ...failures]);
    if (count < active.rows.length && failures.length < active.rows.length - count) {
      setBatchError(`Only ${count} of ${active.rows.length} rows were confirmed in the batch starting at line ${active.rows[0].line}. Review the service results before continuing.`);
      runningRef.current = false; setRunning(false);
      return;
    }
    setImported((prev) => prev + count);
    setVerified((prev) => prev + (Number(result.verified_count) || 0));
    position.current += active.rows.length;
    setProcessed(position.current);
    if (position.current >= recordsRef.current.length) { runningRef.current = false; setRunning(false); }
    else window.setTimeout(sendBatch, 0);
  }, [fetcher.data, fetcher.state]);

  async function loadFile(file: File) {
    if (runningRef.current) return;
    setFileError(""); setBatchError(""); setRecords([]); setIssues([]); setServerIssues([]);
    setProcessed(0); setImported(0); setVerified(0); position.current = 0; current.current = null;
    if (file.size > MAX_FILE_BYTES) { setFileError("File exceeds 50 MB. Split it into smaller files."); return; }
    try {
      const parsed = parseApplicationCsv(await file.text());
      if (parsed.error) { setFileError(parsed.error); return; }
      setRecords(parsed.records); recordsRef.current = parsed.records;
      setIssues(parsed.issues);
      setSourceFile(file.name);
    } catch { setFileError("Could not read the CSV file."); }
  }

  function start() {
    if (runningRef.current || !records.length || !source.trim() || !sourceFile.trim()) {
      setBatchError("Choose a CSV and provide its source and source file name."); return;
    }
    setBatchError(""); sourceRef.current = source.trim(); fileRef.current = sourceFile.trim();
    runningRef.current = true; setRunning(true); sendBatch();
  }

  const allIssues = [...issues, ...serverIssues];
  return (
    <Page title="Import application data" primaryAction={{ content: processed ? "Resume import" : "Import valid rows", onAction: start, disabled: running || !records.length || !source.trim() || !sourceFile.trim(), loading: running }}>
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Download import template</Text>
            <InlineStack gap="200">
              <Button onClick={() => downloadCsv("fitment-application-template.csv", templateCsv())}>Download import template</Button>
              <Button onClick={() => downloadCsv("fitment-application-example.csv", exampleCsv())}>Download example</Button>
            </InlineStack>
            <Text as="h3" variant="headingSm">Required fields</Text>
            <Text as="p">Each row needs one product, one exact vehicle, and an application statement. Identify the product with Product SKU, or with Brand and Manufacturer part number together, or with an OE number. An OE equality match only finds the article. It is not an application and it is not imported as verified compatibility. Set Evidence type to application and quote the supplier or manufacturer statement in Evidence. Type the supplier or manufacturer name in Source before you upload.</Text>
            <Text as="h3" variant="headingSm">One product–vehicle application per row</Text>
            <Text as="p">One row is one product on one exact vehicle. A product that fits three vehicles needs three rows. Do not put several vehicles in one cell.</Text>
            <Text as="h3" variant="headingSm">How to identify the exact vehicle</Text>
            <Text as="p">Use the canonical vehicle key from Fitment Manager. It starts with ovh-. When you do not have that key, fill Make, Model, Generation, Engine code, and Power kW together. Year from and Year to are optional. Leave Source status empty unless the supplier file itself says the application is verified. An empty status stays unverified.</Text>
            <Banner tone="warning" title="The old fitment export is not this template">
              <p>fitment-export.csv uses Shopify product IDs and legacy vehicle IDs. Those files are refused. Legacy vehicle IDs and OE matches are not turned into verified compatibility. The example file is separate and is marked EXAMPLE-DO-NOT-IMPORT, so example rows cannot be imported by mistake. Download the blank template and enter your own applications.</p>
            </Banner>
          </BlockStack>
        </Card>
        <Card><BlockStack gap="300">
          <Text as="h2" variant="headingMd">1. Upload one file</Text>
          <Text as="p">Upload one CSV, including a file with more than 5,000 rows. Valid rows are sent 100 at a time, with progress. Rejected rows stay out of the catalogue and can be downloaded.</Text>
          <TextField label="Source (supplier or manufacturer)" value={source} onChange={setSource} autoComplete="off" disabled={running} />
          <TextField label="Source file" value={sourceFile} onChange={setSourceFile} autoComplete="off" disabled={running} helpText="Filled from the uploaded filename; edit if the supplier file has a different name." />
          <DropZone accept=".csv,text/csv" type="file" allowMultiple={false} disabled={running} onDrop={(_files, accepted) => { if (accepted[0]) void loadFile(accepted[0]); }}><DropZone.FileUpload /></DropZone>
          {fileError ? <Banner tone="critical"><p>{fileError}</p></Banner> : null}
        </BlockStack></Card>
        <Card><BlockStack gap="300">
          <Text as="h2" variant="headingMd">2. Review and import</Text>
          <Text as="p">{sourceFile || "No file selected"} · {records.length} valid rows · {issues.length} rows to fix</Text>
          {issues.length ? <Text as="p" tone="critical">Invalid rows will not be sent. Download the report to correct them and upload the file again.</Text> : null}
          {batchError ? <Banner tone="critical"><p>{batchError}</p></Banner> : null}
          {(running || processed > 0) ? <><ProgressBar progress={records.length ? Math.round(processed / records.length * 100) : 0} /><Text as="p">{processed} / {records.length} processed · {imported} imported · {verified} already verified in the catalogue</Text></> : null}
          <InlineStack gap="200"><Button onClick={start} variant="primary" disabled={running || !records.length || !source.trim() || !sourceFile.trim()} loading={running}>{processed ? "Resume import" : "Import valid rows"}</Button>{allIssues.length ? <Button onClick={() => downloadCsv("fitment-import-rejected.csv", issueReportCsv(allIssues))}>Download rejected rows ({allIssues.length})</Button> : null}</InlineStack>
          {records.length > 0 ? <><Text as="h3" variant="headingSm">First 20 valid rows</Text><IndexTable resourceName={{ singular: "row", plural: "rows" }} itemCount={Math.min(records.length, 20)} selectable={false} headings={[{ title: "CSV line" }, { title: "Article" }, { title: "Vehicle" }, { title: "Evidence" }]}>{records.slice(0, 20).map((row, i) => <IndexTable.Row id={String(row.line)} key={row.line} position={i}><IndexTable.Cell>{row.line}</IndexTable.Cell><IndexTable.Cell>{row.values.sku || [row.values.brand, row.values.mpn].filter(Boolean).join(" ") || row.values.oe_number}</IndexTable.Cell><IndexTable.Cell>{row.values.vehicle_key || `${row.values.make} ${row.values.model} ${row.values.engine}`}</IndexTable.Cell><IndexTable.Cell>{row.values.evidence_type}</IndexTable.Cell></IndexTable.Row>)}</IndexTable></> : null}
        </BlockStack></Card>
      </BlockStack>
    </Page>
  );
}
