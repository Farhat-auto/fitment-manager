export const APPLICATION_COLUMNS = [
  "sku", "brand", "mpn", "oe_number", "vehicle_key", "make", "model",
  "generation", "engine", "power_kw", "year_from", "year_to",
  "evidence_type", "evidence_value", "source_state", "source_ref",
] as const;

export type ApplicationRecord = { line: number; values: Record<string, string> };
export type ApplicationIssue = { line: number; error: string };

export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function parseApplicationCsv(input: string): {
  records: ApplicationRecord[];
  issues: ApplicationIssue[];
  error?: string;
} {
  const text = input.replace(/^\uFEFF/, "");
  const parsed: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else { cell += c; if (c === "\n") line++; }
      continue;
    }
    if (c === '"') {
      if (cell || closed) return { records: [], issues: [], error: `Unexpected quote on line ${line}` };
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      cells.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        if (cells.some((v) => v.trim())) parsed.push({ line: start, cells });
        cells = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
        line++;
        start = line;
      }
    } else {
      if (closed) return { records: [], issues: [], error: `Unexpected text after quote on line ${line}` };
      cell += c;
    }
  }
  if (quoted) return { records: [], issues: [], error: `Unclosed quoted field on line ${start}` };
  if (cell || cells.length) {
    cells.push(cell);
    if (cells.some((v) => v.trim())) parsed.push({ line: start, cells });
  }
  if (!parsed.length) return { records: [], issues: [], error: "The CSV is empty" };

  const headers = parsed[0].cells.map((v) => v.trim().toLowerCase());
  const duplicates = headers.filter((v, i) => headers.indexOf(v) !== i);
  if (duplicates.length) return { records: [], issues: [], error: `Duplicate header: ${duplicates[0]}` };
  const missing = APPLICATION_COLUMNS.filter((v) => !headers.includes(v));
  if (missing.length) return { records: [], issues: [], error: `Missing columns: ${missing.join(", ")}. Download the current template.` };
  const records: ApplicationRecord[] = [];
  const issues: ApplicationIssue[] = [];
  for (const row of parsed.slice(1)) {
    if (row.cells.length !== headers.length) {
      issues.push({ line: row.line, error: `Expected ${headers.length} columns; found ${row.cells.length}` });
      continue;
    }
    const values = Object.fromEntries(headers.map((name, i) => [name, row.cells[i].trim()]));
    let error = "";
    if (!values.sku && !(values.brand && values.mpn) && !values.oe_number) {
      error = "Provide SKU, brand and MPN, or a unique OE number";
    } else if (!/^ovh-[a-f0-9]+$/i.test(values.vehicle_key) &&
      !(values.make && values.model && values.generation && values.engine && values.power_kw)) {
      error = "Provide a canonical ovh- vehicle_key, or make, model, generation, engine and power_kw";
    } else if (!values.evidence_type) {
      error = "Provide evidence_type (application for an application statement)";
    }
    if (error) issues.push({ line: row.line, error });
    else records.push({ line: row.line, values });
  }
  return { records, issues };
}

export function applicationBatchCsv(rows: ApplicationRecord[]): string {
  return [APPLICATION_COLUMNS.join(","), ...rows.map(({ values }) =>
    APPLICATION_COLUMNS.map((column) => csvCell(values[column] ?? "")).join(","),
  )].join("\r\n") + "\r\n";
}

export function issueReportCsv(issues: ApplicationIssue[]): string {
  return ["line,error", ...issues.map(({ line, error }) =>
    `${line},${csvCell(/^[=+@\t\r]/.test(error) ? `'${error}` : error)}`,
  )].join("\r\n") + "\r\n";
}
