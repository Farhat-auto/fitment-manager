import {
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { SupabaseSessionStorage } from "./sessions/supabaseSessionStorage.server";

const sessionStorage = new SupabaseSessionStorage();
const previewAppUrl =
  process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY ?? "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET ?? "",
  appUrl: process.env.SHOPIFY_APP_URL || previewAppUrl,
  authPathPrefix: "/auth",
  scopes: (process.env.SCOPES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  sessionStorage,
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
});

export default shopify;
export { shopify };
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const sessionStorageExport = shopify.sessionStorage;
