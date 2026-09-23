import { Outlet } from "@remix-run/react";

/**
 * Layout only. The products list lives in `app.products._index.tsx`.
 * CAR FITMENT lives in `app.products.$productId.tsx`.
 *
 * Remix nests `app.products.$productId` under this file. A list loader here
 * would re-run GetProductsForFitmentAdmin on every Manage Fitment click and
 * without <Outlet /> the product page would never render.
 */
export default function ProductsLayout() {
  return <Outlet />;
}
