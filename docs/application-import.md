# Application CSV import

Download `public/fitment-application-template.csv` from the app's **Import application data** page. Keep the first row unchanged; add one article and one exact vehicle per row. A product that fits three vehicles needs three rows. Save as UTF-8 CSV. Quoted commas and line breaks in evidence are supported.

| Columns | What to enter |
| --- | --- |
| `sku`, `brand`, `mpn`, `oe_number` | Identify the article by SKU, brand and MPN, or a unique OE number. An OE match alone is not evidence of fitment. |
| `vehicle_key` | Canonical `ovh-` vehicle key, when known. Legacy Shopify vehicle GIDs and descriptive vehicle keys are not accepted. |
| `make`, `model`, `generation`, `engine`, `power_kw` | Required together when a canonical vehicle key is not supplied. An ambiguous match remains unverified. |
| `year_from`, `year_to` | Optional year boundaries from the source. |
| `evidence_type`, `evidence_value` | Use `application` for a supplier application statement and cite the exact evidence. Do not label an OE cross-reference as an application. |
| `source_state`, `source_ref` | The source's stated status and a traceable reference, if provided. Leave source_state empty for unverified claims. |

Enter a supplier or manufacturer in the **Source** field. The importer validates rows locally, skips rows missing identifiers or evidence type, and sends valid rows in batches of 100. Files with more than 5,000 rows are accepted up to 50 MB. Progress and a downloadable error report are shown. A paused import can resume at its next unconfirmed batch; if a request failed after reaching the server, check the catalogue before retrying that batch.

The old `fitment-export.csv` describes Shopify product and vehicle metaobjects. It cannot safely be imported into the canonical application service unchanged. Match those vehicle descriptions to exact canonical vehicles and obtain application evidence before preparing the new file. Rows without vehicle information describe products only and are not application records.
