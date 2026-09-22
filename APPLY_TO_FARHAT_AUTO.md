# Apply onto Farhat-auto/fitment-manager (existing Shopify app)

Existing app only:

- client_id `2235978ef56dbb720721a7988a9a2cde`
- `https://fitment-manager.vercel.app`
- base `master` `85cf68c`

cursor[bot] cannot push to `Farhat-auto/fitment-manager`. Do not create another repo or another Shopify app.

```bash
git clone https://github.com/Farhat-auto/fitment-manager.git
cd fitment-manager
git checkout 85cf68c
git checkout -b cursor/oceancarparts-fitment-manager-clean-58c0
git apply --check /path/to/0001-embed-app-bridge-and-port-ocean-car-fitment.patch
git apply /path/to/0001-embed-app-bridge-and-port-ocean-car-fitment.patch
git add -A
git commit -m "Load the embedded app with App Bridge recovery and port Ocean CAR FITMENT."
git push -u origin HEAD
```

Then deploy this branch to the **existing** Vercel project. Keep `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and Shopify config. Add:

- `OCEAN_CATALOGUE_URL`
- `OCEAN_CATALOGUE_MANAGER_TOKEN` (or approved proxy secret)

Then `shopify app deploy` for `extensions/car-fitment` under the existing Partner app. Do not reinstall unless session-token exchange still fails after the App Bridge fix.
