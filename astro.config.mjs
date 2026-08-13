import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: "https://developer.soyaos.ai",
  output: "server",
  // Auth uses an encrypted stateless cookie, so Astro's storage-backed session
  // runtime and its automatic Cloudflare KV binding are intentionally disabled.
  session: false,
  adapter: cloudflare({
    imageService: "compile",
  }),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
