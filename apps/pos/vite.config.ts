import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiIndex = readFileSync(path.join(here, "../api/src/index.ts"), "utf8");
const tillVersion = apiIndex.match(/version:\s*"([^"]+)"/)?.[1] ?? "dev";

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  define: {
    __TILL_BUILD_VERSION__: JSON.stringify(tillVersion),
  },
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": "http://127.0.0.1:4000",
    },
  },
});