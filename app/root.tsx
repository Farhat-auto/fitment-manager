import type { HeadersFunction, LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import {
  isRouteErrorResponse,
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteError,
} from "@remix-run/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { AppProvider } from "@shopify/polaris";
import { authenticate } from "./shopify.server";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: polarisStyles }];

function withShopifyFrameAncestors(existingCsp: string | null): string {
  const required = "frame-ancestors https://admin.shopify.com https://*.myshopify.com;";
  const csp = (existingCsp ?? "").trim();
  if (!csp) return required;

  // If a CSP already exists, replace any existing frame-ancestors directive.
  const withoutFrameAncestors = csp
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !p.toLowerCase().startsWith("frame-ancestors "))
    .join("; ");

  return `${withoutFrameAncestors}; ${required}`.replace(/\s+/g, " ").trim();
}

export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const headers = new Headers(loaderHeaders);

  // Embedded apps must be allowed to render in the Shopify Admin iframe.
  headers.set(
    "Content-Security-Policy",
    withShopifyFrameAncestors(headers.get("Content-Security-Policy")),
  );

  // CSP frame-ancestors is the modern control; X-Frame-Options can break embedding.
  headers.delete("X-Frame-Options");

  return headers;
};

export async function loader({ request }: LoaderFunctionArgs) {
  console.error("ROOT_LOADER_REQUEST", request.url);

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // Health checks should be public so Vercel/DNS probes and uptime monitors
  // can verify the service without needing a Shopify session cookie/token.
  // Let the index route (`/`) handle redirecting into the embedded app shell.
  // Also keep auth + health endpoints public.
  if (
    path === "/" ||
    path === "/healthz" ||
    path === "/auth" ||
    path.startsWith("/auth/")
  ) {
    return { shop: null };
  }

  // For embedded apps, ensure we have a valid session when inside admin.
  // If Shopify needs to redirect to auth, it will throw a redirect Response; rethrow it unchanged.
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
}

export default function App() {
  const { shop } = useLoaderData<typeof loader>();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider i18n={{}}>
          <Outlet />
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
        <LiveReload />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  console.error("ROOT_ERROR_BOUNDARY", error);

  if (isRouteErrorResponse(error)) {
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>
            {error.status} {error.statusText}
          </title>
        </head>
        <body>
          <h1>
            {error.status} {error.statusText}
          </h1>
          <pre>{JSON.stringify(error.data, null, 2)}</pre>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>App error</title>
      </head>
      <body>
        <h1>App error</h1>
        <pre>
          {error instanceof Error
            ? error.stack
            : JSON.stringify(error, null, 2)}
        </pre>
      </body>
    </html>
  );
}

