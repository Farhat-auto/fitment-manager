/** Explicit catalogue origin. Preview must not inherit or invent the production host. */

export function catalogueOrigin() {
  return String(process.env.OCEAN_CATALOGUE_URL || "").trim().replace(/\/+$/, "");
}

export function catalogueOriginProblem() {
  const env = String(process.env.VERCEL_ENV || "");
  if (env !== "production" && env !== "preview") return "";
  if (!catalogueOrigin()) {
    return `OCEAN_CATALOGUE_URL is required in ${env}. Refusing to start without an explicit catalogue origin.`;
  }
  return "";
}
