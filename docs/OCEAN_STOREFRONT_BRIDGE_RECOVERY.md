# Ocean Storefront Bridge Recovery

## Acceptance target
Normal browser only: Shopify vehicle picker -> canonical Ocean vehicle -> systems -> category -> products -> Shopify PDP. API-only success is not acceptance.

## Safety
- NEVER modify/publish live Meka 197195104599.
- Work only on unpublished Copy of Meka 205787332951.
- Keep Fitment Manager PR #20 draft until browser E2E passes.
- Pending/unverified fitment must never be shown as confirmed.

## One-authority architecture
Odoo Automotive Catalogue = vehicle/taxonomy master.
Fitment Manager = explicit Shopify product <-> canonical Ocean vehicle links + verification state.
Fitment Manager /storefront-catalogue = ONLY compatibility/navigation contract used by Shopify renderer.

Theme MUST NOT resolve vehicle identity independently, infer compatibility from titles/OE/tags, merge static fitment JSON into live results, or maintain another pending/verified index. Legacy vehicle keys resolve server-side.

## Display-ready API contract
Vehicle routes must return canonical vehicle_key. Product rows must include shopify_product_id, shopify_variant_id, sku, brand, handle/pdp_path, assembly_group_id, category_id, product_group_id, fitment.state, fitment.visible, shopify_fitment, pending_fitment and compatibility_indication. Normalize server-side.

## Shopify bridge files
- assets/ocp-catalogue-api-client.js
- assets/ocp-vehicle-catalogue.js
- snippets/ocp-catalogue-chrome.liquid

Target implementation:
1. OCP_catalogueApiGet calls /storefront-catalogue.
2. Vehicle /systems, /assembly-groups, /product-groups and /products return live API response directly.
3. mergeAppFitment, fitmentIndexUrl, pendingFitmentIndexUrl and static systems snapshots cannot alter compatibility results.
4. Browser resolveCatalogueVehicleKey must not run a second vehicle lookup.
5. renderProducts separates rows only with server shopify_fitment and pending_fitment.
6. Live API failure shows an explicit error, never a silent stale zero.
7. Add ?ocp_debug=1 diagnostics: request URL/status, canonical vehicle, API row count and rendered bucket counts. Never log secrets.

## Regression vehicles
E82 135i canonical ovh-d1bd300d05c7a189edd8.
E90 316d legacy bmw-3-series-e90-316-d-n47-d20-c-85-kw-116-hp-1995-cc-diesel-sedan-07-2009-12-2011 -> ovh-8a49866f9b684104bfcb.
E90 316i legacy bmw-3-series-e90-316-i-n43-b16-a-85-kw-116-hp-cc-petrol-sedan-09-2005-10-2011 -> ovh-1fd0868a80585315ddd6. N43/N45 source disagreement is a reviewed legacy exception; do not generalize unsafe engine matching.

Known pending shock products:
- HI-BRIT-HB-00319, Shopify product 10639645901143, variant 53087437914455.
- 31316796155-BEMWQ, Shopify product 10758331629911, variant 53310030348631.
Taxonomy: suspension-system / shock-absorbers / shock-absorbers-parts.
Both are UNVERIFIED and must render pending, never confirmed.

## Mandatory browser E2E
Against unpublished Copy of Meka 205787332951:
1. Open technical catalogue normally.
2. Select BMW -> 3 Series -> E90 -> exact 316i/316d.
3. Open Suspension -> Shock Absorbers / Fitment Manager links.
4. Browser network must request current preview /storefront-catalogue/products.
5. Response contains HI-BRIT + BEMWQ.
6. DOM shows both under confirmation pending.
7. Confirmed count remains 0.
8. No console exception.
9. Back/forward preserves vehicle.
Repeat E82 to prevent regression.

Capture screenshot, request URL, API row count, rendered counts and console errors. Do not merge PR #20 or publish live theme before all gates pass.

## After recovery
Persist canonical vehicle ID from selection time and remove remaining compatibility snapshots. Bulk OE/cross-reference enrichment belongs in Odoo; Fitment Manager reviews/verifies; Shopify only renders.
