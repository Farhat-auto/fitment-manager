export const APPLICATION_COLUMNS = [
  "sku", "brand", "mpn", "oe_number", "vehicle_key", "make", "model",
  "generation", "engine", "power_kw", "year_from", "year_to",
  "evidence_type", "evidence_value", "source_state", "source_ref",
] as const;

export const APPLICATION_LABELS = [
  "Product SKU",
  "Brand",
  "Manufacturer part number",
  "OE number",
  "Canonical vehicle key",
  "Make",
  "Model",
  "Generation",
  "Engine code",
  "Power kW",
  "Year from",
  "Year to",
  "Evidence type",
  "Evidence",
  "Source status",
  "Source reference",
] as const;

export const EXAMPLE_MARKER = "EXAMPLE-DO-NOT-IMPORT";

const HEADER_ALIASES: Record<string, string> = {
  sku: "sku",
  product_sku: "sku",
  brand: "brand",
  mpn: "mpn",
  manufacturer_part_number: "mpn",
  oe_number: "oe_number",
  vehicle_key: "vehicle_key",
  canonical_vehicle_key: "vehicle_key",
  make: "make",
  model: "model",
  generation: "generation",
  engine: "engine",
  engine_code: "engine",
  power_kw: "power_kw",
  year_from: "year_from",
  year_to: "year_to",
  evidence_type: "evidence_type",
  evidence: "evidence_value",
  evidence_value: "evidence_value",
  source_state: "source_state",
  source_status: "source_state",
  source_ref: "source_ref",
  source_reference: "source_ref",
};

const IDENTITY_EVIDENCE = new Set(["oe", "oe_number", "cross_reference", "cross", "xref", "mpn", "title", "title_tag", "title_tag_inference"]);

export type ApplicationRecord = { line: number; values: Record<string, string> };
export type ApplicationIssue = { line: number; error: string; values?: Record<string, string> };

export function canonicalHeader(header: string): string {
  const key = header.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return HEADER_ALIASES[key] || key;
}

export function templateCsv(): string {
  return APPLICATION_LABELS.join(",") + "\r\n";
}

export function exampleCsv(): string {
  const values: Record<string, string> = {
    sku: "EXAMPLE-SKU",
    brand: "Example Brand",
    mpn: "EXAMPLE-MPN",
    oe_number: "",
    vehicle_key: "",
    make: "Mercedes-Benz",
    model: "C-Class",
    generation: "W205",
    engine: "M 274.920",
    power_kw: "135",
    year_from: "2013",
    year_to: "2018",
    evidence_type: "application",
    evidence_value: "Example only. A supplier catalogue states this part fits this exact engine. Do not upload this file.",
    source_state: "",
    source_ref: EXAMPLE_MARKER,
  };
  return templateCsv() + APPLICATION_COLUMNS.map((column) => csvCell(values[column] || "")).join(",") + "\r\n";
}

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

  const rawHeaders = parsed[0].cells.map((value) => value.trim());
  const legacy = rawHeaders.map((value) => value.toLowerCase());
  if (legacy.includes("product_id") || legacy.includes("vehicle_gid") || legacy.includes("product_handle")) {
    return {
      records: [],
      issues: [],
      error: "This is the old fitment export, not the import template. Download the import template. Legacy vehicle IDs and OE matches are not imported as verified compatibility.",
    };
  }
  const headers = rawHeaders.map(canonicalHeader);
  const duplicates = headers.filter((value, index) => headers.indexOf(value) !== index);
  if (duplicates.length) return { records: [], issues: [], error: `Duplicate header: ${duplicates[0]}` };
  const missing = APPLICATION_COLUMNS.filter((value) => !headers.includes(value));
  if (missing.length) return { records: [], issues: [], error: `Missing columns: ${missing.join(", ")}. Download the current template.` };
  if (parsed.slice(1).some((row) => row.cells.some((cell) => cell.trim() === EXAMPLE_MARKER))) {
    return {
      records: [],
      issues: [],
      error: "This is the example file, not an import. Download the blank import template and enter your own applications. Example rows are not imported.",
    };
  }
  const records: ApplicationRecord[] = [];
  const issues: ApplicationIssue[] = [];
  for (const row of parsed.slice(1)) {
    if (row.cells.length !== headers.length) {
      issues.push({ line: row.line, error: `Expected ${headers.length} columns; found ${row.cells.length}` });
      continue;
    }
    const values = Object.fromEntries(headers.map((name, index) => [name, row.cells[index].trim()]));
    let error = "";
    const evidenceType = values.evidence_type.toLowerCase();
    if (values.vehicle_key && !/^ovh-[a-f0-9]+$/i.test(values.vehicle_key)) {
      error = "Canonical vehicle key must start with ovh-. A legacy Shopify vehicle ID is not accepted and is not verified.";
    } else if (!values.sku && !(values.brand && values.mpn) && !values.oe_number) {
      error = "Provide Product SKU, or Brand and Manufacturer part number, or an OE number";
    } else if (!values.vehicle_key && !(values.make && values.model && values.generation && values.engine && values.power_kw)) {
      error = "Identify the exact vehicle with a canonical ovh- vehicle key, or with Make, Model, Generation, Engine code and Power kW together";
    } else if (!values.evidence_type) {
      error = "Provide Evidence type. Use application for an application statement";
    } else if (IDENTITY_EVIDENCE.has(evidenceType)) {
      error = "An OE number or cross-reference is not an application. Use Evidence type application and quote the source. This row is not imported as verified compatibility.";
    } else if (evidenceType === "application" && !values.evidence_value) {
      error = "Evidence is required. Quote the supplier or manufacturer statement for this product and vehicle.";
    }
    if (error) issues.push({ line: row.line, error, values });
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
  const columns = ["line", "error", "sku", "brand", "mpn", "oe_number", "vehicle_key", "make", "model", "generation", "engine", "evidence_type"];
  const lines = issues.map((issue) => {
    const values = issue.values || {};
    return columns.map((column) => {
      const raw = column === "line" ? String(issue.line) : column === "error" ? issue.error : values[column] || "";
      const safe = /^[=+@\t\r]/.test(raw) ? `'${raw}` : raw;
      return csvCell(safe);
    }).join(",");
  });
  return [columns.join(","), ...lines].join("\r\n") + "\r\n";
}
