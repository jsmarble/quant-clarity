import eslint from "@eslint/js";
import eslintPluginAstro from "eslint-plugin-astro";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-worker/**",
      "**/.astro/**",
      "**/coverage/**",
      "**/.wrangler/**",
      "**/worker-configuration.d.ts",
      "contracts/generated/**",
      "eslint.config.js",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...eslintPluginAstro.configs.recommended,
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["**/*.{js,mjs,cjs}", "**/*.astro"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-deprecated": "error",
    },
  },
  {
    files: ["**/*.test.ts", "tools/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["apps/web/src/lib/rate-limit.ts", "apps/web/src/worker.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./apps/web/tsconfig.worker.json"],
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["apps/web/src/**/*.test.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./apps/web/tsconfig.test.json"],
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["playwright.config.ts", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.playwright.json"],
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["tests/workers/**/*.mjs"],
    languageOptions: {
      globals: {
        Response: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["apps/web/src/env.d.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
);
