/**
 * Shopify embedded navigation.
 *
 * Shopify Admin already mounts the iframe at /apps/<handle>.
 * App Bridge prepends that mount to Remix paths. Destinations MUST be
 * canonical application routes (/app, /app/products, …).
 *
 * Never generate /apps/fitment-manager-2 in outbound navigation.
 */

export const APP_ROOT = "/app";

export function stripAdminMount(pathname: string): string {
  let path = String(pathname || "").trim() || APP_ROOT;
  path = path.split("?")[0] || APP_ROOT;
  path = path.replace(/^\/apps\/[^/]+/g, "");
  while (/^\/apps\/[^/]+/.test(path)) {
    path = path.replace(/^\/apps\/[^/]+/, "");
  }
  if (!path.startsWith("/")) path = `/${path}`;
  if (path === "/" || path === "") return APP_ROOT;
  return path.replace(/\/{2,}/g, "/");
}

export function appHref(path: string, search?: string): string {
  let pathname = stripAdminMount(String(path || "").trim() || APP_ROOT);
  if (!pathname.startsWith(APP_ROOT + "/") && pathname !== APP_ROOT) {
    pathname = `${APP_ROOT}/${pathname.replace(/^\/+/, "")}`;
  }
  pathname = pathname.replace(/\/{2,}/g, "/");
  if (pathname.includes("/apps/")) {
    pathname = stripAdminMount(pathname);
    if (!pathname.startsWith(APP_ROOT)) pathname = `${APP_ROOT}${pathname === "/" ? "" : pathname}`;
  }
  const suffix = !search
    ? ""
    : search === "?"
      ? ""
      : search.startsWith("?")
        ? search
        : `?${search}`;
  return `${pathname}${suffix}`;
}

export function canonicalizeIframePathname(pathname: string): string | null {
  const stripped = stripAdminMount(pathname);
  if (stripped === pathname) return null;
  if (
    stripped.startsWith(APP_ROOT) ||
    stripped.startsWith("/auth") ||
    stripped.startsWith("/api") ||
    stripped.startsWith("/healthz")
  ) {
    return stripped;
  }
  return `${APP_ROOT}${stripped === "/" ? "" : stripped}`;
}

/** Inbound-only: map a leaked Admin iframe path onto a Remix route. */
export function inboundRemixPath(pathname: string): string {
  return canonicalizeIframePathname(pathname) || appHref(pathname);
}
