import { RemixBrowser } from "@remix-run/react";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { canonicalizeIframePathname } from "./embedded-nav";

const leaked = canonicalizeIframePathname(window.location.pathname);
if (leaked) {
  window.history.replaceState(window.history.state, "", leaked + window.location.search + window.location.hash);
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>,
  );
});
