import { defineConfig } from "vite";
import { vitePlugin as remix } from "@remix-run/dev";
import { vercelPreset } from "@vercel/remix/vite";

export default defineConfig({
  plugins: [
    remix({
      presets: [vercelPreset()],
    }),
  ],
});

