import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored MapLibre worker bundle - copied verbatim from node_modules by
    // scripts/copy-maplibre-worker, never hand-edited, and minified, so
    // linting it produces hundreds of meaningless warnings.
    "public/maplibre/**",
  ]),
  {
    rules: {
      // A leading underscore is this codebase's idiom for "deliberately
      // unused": rest-destructuring a field away (`{ raw_tags: _omit,
      // ...place }`) is the cheapest way to strip a key, and the binding
      // it creates is the point, not an oversight.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
