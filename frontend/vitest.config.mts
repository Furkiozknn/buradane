import { defineConfig } from "vitest/config";

/**
 * Tests target the pure logic: the query engine, the opening-hours parser,
 * geo math, Turkish text normalisation and URL state. That is deliberately
 * where the bugs have actually been - every regression this project shipped
 * and then caught by hand (a verification that *lowered* a score, "KADIKÖY"
 * not matching "Kadıköy", leftover query words zeroing out the results,
 * "çocuğumla" not recognised as "çocuk") lived in this layer, not in the
 * React tree.
 *
 * `.mts` so Vite loads it as ESM natively; path aliases come from tsconfig
 * via Vite's built-in resolution, no plugin needed.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The repository reads data/places.*.json relative to cwd, exactly as
    // the route handlers do at runtime.
    root: import.meta.dirname,
  },
});
