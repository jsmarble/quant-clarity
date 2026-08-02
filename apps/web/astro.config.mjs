import cloudflare from "@astrojs/cloudflare";
import { env as processEnv } from "node:process";
import { defineConfig } from "astro/config";

import { configuredSiteOrigin } from "./src/lib/site-origin.ts";

const site = configuredSiteOrigin(processEnv);

export default defineConfig({
  ...(site ? { site } : {}),
  adapter: cloudflare({
    imageService: "compile",
    prerenderEnvironment: "node",
  }),
  output: "server",
  session: {
    driver: {
      entrypoint: new globalThis.URL(
        "./src/lib/disabled-session-driver.ts",
        import.meta.url,
      ),
    },
  },
});
