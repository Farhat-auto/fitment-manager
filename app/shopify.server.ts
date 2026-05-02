import {
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { SupabaseSessionStorage } from "./sessions/supabaseSessionStorage.server";

const sessionStorage = new SupabaseSessionStorage();

export const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY ?? "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET ?? "",
  appUrl: process.env.SHOPIFY_APP_URL ?? "",
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

export const authenticate = shopify.authenticate;

