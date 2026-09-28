# Application CSV import

On **Import application data**, click **Download import template** before choosing a file. The template is a header row only. Keep those column names. Add one product and one exact vehicle per row. A product that fits three vehicles needs three rows. Save as UTF-8 CSV. Quoted commas and line breaks in Evidence are supported.

**Download example** is a separate file. It is marked `EXAMPLE-DO-NOT-IMPORT`. The importer refuses the whole file, so example rows cannot be imported by mistake.

## Required fields

| Column | What to enter |
| --- | --- |
| Product SKU, Brand, Manufacturer part number, OE number | Identify the product by Product SKU, or by Brand and Manufacturer part number together, or by an OE number. An OE equality match finds the article only. It is not an application and it is not verified compatibility. |
| Canonical vehicle key | The Fitment Manager key starting with `ovh-`, when you have it. A Shopify vehicle ID or a descriptive key is rejected. |
| Make, Model, Generation, Engine code, Power kW | Required together when the canonical vehicle key is empty. All five identify one exact vehicle. |
| Year from, Year to | Optional years from the source. |
| Evidence type, Evidence | Use `application` and quote the supplier or manufacturer statement. An OE number, cross-reference, MPN, or title is rejected and is not imported as verified compatibility. |
| Source status, Source reference | Leave Source status empty unless the supplier file itself says the application is verified. An empty status stays unverified. Source reference is your trace back to the statement. |

Type the supplier or manufacturer in **Source** on the page.

## One product–vehicle application per row

Each row is one product on one exact vehicle. Do not combine vehicles in one cell.

## How to identify the exact vehicle

Use the canonical `ovh-` vehicle key from Fitment Manager. When that key is not available, fill Make, Model, Generation, Engine code, and Power kW together. An ambiguous vehicle is not saved as verified compatibility.

## Upload

The page accepts one CSV of more than 5,000 rows, up to 50 MB. It checks every row locally, skips rejected rows, and sends valid rows in batches of 100. Progress stays on the page. **Download rejected rows** saves the line, the reason, and the product and vehicle fields from each rejected row. A stopped import resumes at the next unconfirmed batch.

`fitment-export.csv` is the old Shopify vehicle-link export. It is not this template. The importer refuses `product_id` and `vehicle_gid` files. Legacy vehicle IDs and OE matches are not turned into verified compatibility.
