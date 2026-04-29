## Fitment Manager (Shopify embedded admin app)

This is a Shopify embedded admin app + Admin UI Extension for managing product fitment:

- Metafield: `custom.compatible_vehicles` (`list.metaobject_reference`)
- Metaobject type: `vehicle`

### What’s included (scaffold)

- Remix app with Polaris UI
- Placeholder route `/app/products`

### Setup

1. Copy env template:

   - Copy `.env.example` → `.env`

2. Install dependencies:

```bash
cd "C:\Users\info\Documents\New project\fitment-manager"
npm install
```

3. Run dev:

```bash
npm run dev
```

### Environment variables

- `SHOPIFY_APP_URL`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SCOPES`
- `SHOPIFY_ADMIN_API_VERSION` (default we’ll use: `2024-10`)

