# Clean Fitment Manager changeset

**DO NOT MERGE this into Farhat-Auto-Parts staging or main.**
**DO NOT MERGE PR #412.**

Real destination: `Farhat-auto/fitment-manager` **master `85cf68c`**.
cursor[bot] GitHub permission on that repo: pull=false, push=false. Apply this patch; do not create another Shopify app or another GitHub repository.

## Base

- repo: `Farhat-auto/fitment-manager`
- branch: `master`
- commit: `85cf68c`

## Commits

**1** commit on top of `85cf68c`.

## Diff vs `85cf68c`

**32 files changed, 2460 insertions(+), 454 deletions(-)**

```
M  .env.example
A  APPLY_TO_FARHAT_AUTO.md
A  CHANGESET.md
M  README.md
A  app/components/CarFitment.tsx
M  app/entry.server.tsx
A  app/ocean/client.server.ts
A  app/ocean/identity.ts
A  app/ocean/legacy.ts
A  app/ocean/metafields.ts
M  app/root.tsx
M  app/routes/api.fitment.remove.ts
A  app/routes/api.ocean.$.ts
M  app/routes/app._index.tsx
M  app/routes/app.fitment.$productHandle.tsx
M  app/routes/app.import.tsx
M  app/routes/app.products.$productId.tsx
M  app/routes/app.settings.tsx
M  app/routes/app.tsx
M  app/shopify.server.ts
A  extensions/car-fitment/locales/en.default.json
A  extensions/car-fitment/shopify.extension.toml
A  extensions/car-fitment/src/Action.jsx
A  extensions/car-fitment/src/Block.jsx
A  extensions/car-fitment/src/FitmentApp.jsx
A  extensions/car-fitment/src/ShouldRender.js
A  extensions/car-fitment/src/api.js
A  extensions/car-fitment/src/payload.js
M  extensions/fitment-block/src/FitmentBlock.tsx
M  package.json
M  shopify.app.toml
A  tests/identity-isolation.test.ts
```

## Apply on Farhat-auto/fitment-manager

```bash
git checkout 85cf68c
git checkout -b cursor/oceancarparts-fitment-manager-clean-58c0
git apply --check patches/0001-embed-app-bridge-and-port-ocean-car-fitment.patch
git apply patches/0001-embed-app-bridge-and-port-ocean-car-fitment.patch
git add -A
git commit -m "Load the embedded app with App Bridge recovery and port Ocean CAR FITMENT."
```

Verified: `git apply --check` succeeds on a virgin `85cf68c` tree.

## Tests on this tree

- `npm run typecheck` PASS
- `npm run test:ocean-identity` PASS (A→B→C→A isolation PASS)
- `npm run build` PASS

## Secrets

None committed. Placeholders only in `.env.example`. Existing Vercel `SUPABASE_*` and Shopify config stay. Add `OCEAN_CATALOGUE_URL` and `OCEAN_CATALOGUE_MANAGER_TOKEN` on the existing Vercel project after this patch is applied — not in git.
