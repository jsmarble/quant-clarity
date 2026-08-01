import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.worker.test.ts"],
    include: [
      "apps/**/*.test.ts",
      "packages/**/*.test.ts",
      "tools/**/*.test.ts",
    ],
  },
});
