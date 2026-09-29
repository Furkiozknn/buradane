/**
 * Text contrast, measured from the real tokens in globals.css (WCAG 2.x
 * relative luminance), in both colour schemes.
 *
 * The project rule is 4.5:1 for text, with margin. The colour flow on the
 * result count borrows accent tones from the daily-video theme; those tones
 * were made for dark video grounds, so this test is what proves the re-tuned
 * per-scheme versions still read as text on the card surface.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "src", "app", "globals.css"), "utf8");

/** Variables declared in the block that starts at `marker` (up to its closing brace). */
function tokens(marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  expect(start, `${marker} bulunamadı`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  // Both blocks (:root, and the dark @media that wraps a nested :root) end at
  // the first closing brace in column 0.
  const close = css.indexOf("\n}", open);
  const out: Record<string, string> = {};
  for (const match of css.slice(open, close).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    out[match[1]] = match[2];
  }
  return out;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const light = tokens(":root {");
const dark = { ...light, ...tokens("@media (prefers-color-scheme: dark)") };

// [foreground token, background token]: every pairing the interface prints text with.
const TEXT_PAIRS: [string, string][] = [
  ["text", "surface"],
  ["text-secondary", "surface"],
  ["text-muted", "surface"],
  ["text-muted", "surface-sunken"],
  ["brand", "surface"],
  ["brand-contrast", "brand"],
  ["success", "success-soft"],
  ["warning", "warning-soft"],
  ["danger", "danger-soft"],
  ["text", "warning-soft"],
  // the count's colour flow, at each keyframe
  ["flow-a", "surface"],
  ["flow-b", "surface"],
];

describe("text contrast of the design tokens", () => {
  for (const [scheme, palette] of [["light", light], ["dark", dark]] as const) {
    for (const [fg, bg] of TEXT_PAIRS) {
      it(`${scheme}: --${fg} on --${bg} is at least 4.5:1`, () => {
        expect(palette[fg], `--${fg} tanımlı değil`).toBeDefined();
        expect(palette[bg], `--${bg} tanımlı değil`).toBeDefined();
        expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("measures known values correctly (black on white is 21:1)", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });
});
