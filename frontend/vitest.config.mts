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
    // Vitest's default is 5000 ms and the dataset is 167.829 records across
    // 81 files. Most tests read one or two provinces (the reader is lazy),
    // but the ones that assert a property of the WHOLE dataset genuinely
    // pay a full national load - ~15-20 s on an idle machine and more on a
    // shared two-core CI runner. Timing those out is a FALSE RED, which is
    // the failure mode that erodes trust in a suite and gets people
    // reaching for --retry.
    //
    // 60 s is the ceiling for "something is wrong", not a budget anyone is
    // expected to use: the whole suite runs in about a minute. The two
    // tests that walk all 81 provinces one at a time carry their own
    // larger budget inline, where the reason is visible next to the work.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
