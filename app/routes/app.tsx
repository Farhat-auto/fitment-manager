import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { authenticate } from "../shopify.server";

export const headers: HeadersFunction = (headersArgs) => {
  return headersArgs.loaderHeaders;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  return json({
    apiKey: process.env.SHOPIFY_API_KEY ?? "",
    shop: session.shop,
  });
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <AppProvider
      apiKey={apiKey}
      isEmbeddedApp
    >
      <Outlet />
    </AppProvider>
  );
}

