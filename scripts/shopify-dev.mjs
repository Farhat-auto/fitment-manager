#!/usr/bin/env node
/**
 * Runs `shopify app dev`. If SHOPIFY_CLI_DEV_STORE is set (.env / .env.local),
 * forwards `--store` so Partner dev requirements are met without hardcoding URLs in package.json.
 * Extra CLI args pass through (e.g. npm run dev:shopify -- --reset).
 */

import { spawn } from "node:child_process";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const store = String(process.env.SHOPIFY_CLI_DEV_STORE ?? "").trim();
const extra = process.argv.slice(2);

const argv = ["app", "dev"];
if (store) {
  argv.push("--store", store);
}
argv.push(...extra);

const child = spawn("shopify", argv, {
  stdio: "inherit",
  shell: true,
  cwd: process.cwd(),
});

child.on("exit", (code) => process.exit(code ?? 1));
