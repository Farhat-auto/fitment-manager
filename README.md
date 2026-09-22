# Fitment Manager (existing Shopify embedded app)

Existing Partner app, not a replacement:

- client_id `2235978ef56dbb720721a7988a9a2cde`
- `https://fitment-manager.vercel.app`
- shop `g5uxzq-gb.myshopify.com`
- Supabase `shopify_sessions` only for app infrastructure

Architecture:

```
Shopify Admin
  → Fitment Manager (Remix + CAR FITMENT block)
  → Ocean Catalogue API /ocean-catalogue-manager/shopify-admin
  → Catalogue article
  → Ocean product_fitment
  → Ocean vehicle_id
```

The Remix app is an authenticated management frontend. It is not a second
fitment engine and does not duplicate Ocean vehicle tables into Supabase.

## Embedded load (410 Gone)

The first Admin iframe document request has no session token.
`unstable_newEmbeddedAuthStrategy` throws **410** so App Bridge can retry.

`app/root.tsx` must **not** call `authenticate.admin()`. Error boundaries must
use `boundary.error` / `boundary.headers` from `@shopify/shopify-app-remix`.
`entry.server.tsx` must call `addDocumentResponseHeaders`.

A curl to `/app?shop=...` without a session token still returns 410; that is
expected. Inside Shopify Admin the 410 body must be App Bridge recovery HTML,
not a PolarIS "410 Gone" page.

Do not reinstall until that recovery path is deployed and still fails.

## CAR FITMENT

Admin product block: `extensions/car-fitment` (ported from validated PR #409).
Embedded product page: `/app/products/:id`.

Identity: Shopify product ID, variant ID, SKU, Brand+MPN. Never title.
No mapping → Fitment: 0 vehicles / unmapped.

Verification:

- UNVERIFIED / NEEDS REVIEW → Compatibility not confirmed
- VERIFIED → Fits your vehicle
- Manual/Bulk/Import default UNVERIFIED (import may be NEEDS REVIEW)
- Supplier and legacy Supabase are not automatically VERIFIED

Status metafields only: `ocean.fitment_count`, `ocean.fitment_status`,
`ocean.zero_fitment`.

Legacy Shopify vehicle system is retained read-only.

## Tests

```bash
npm run test:ocean-identity
```
