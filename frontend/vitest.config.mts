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
    // Vitest's default is 5000 ms, and several suites load the whole
    // national snapshot: measured at 3,5 s each on an idle developer
    // machine, which left ~1,4 s of headroom on a shared two-core CI
    // runner. Under load that produced timeouts - a FALSE RED, which is the
    // failure mode that erodes trust in a suite and gets people reaching for
    // --retry. The work is real and bounded; the limit just has to admit it.
    testTimeout: 20_000,
  },
});
