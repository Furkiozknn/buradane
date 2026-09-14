import { afterEach, describe, expect, it } from "vitest";

import {
  CONTRIBUTIONS_OFF_MESSAGE,
  contributionsEnabled,
} from "@/lib/contributions-enabled";

/**
 * The flag exists to stop a deployment from accepting data it cannot keep.
 * A serverless host writes the JSON store successfully and loses it with the
 * container - 201 to the user, nothing on disk, nothing in any log. These
 * tests pin the one behaviour that prevents that: OFF has to mean off, and
 * everything else has to mean on, so no deployment ends up silently
 * discarding contributions because a variable was spelled oddly.
 */
describe("contributionsEnabled", () => {
  const onceki = process.env.BURADANE_CONTRIBUTIONS;

  afterEach(() => {
    if (onceki === undefined) delete process.env.BURADANE_CONTRIBUTIONS;
    else process.env.BURADANE_CONTRIBUTIONS = onceki;
  });

  it("defaults to enabled when the variable is unset", () => {
    delete process.env.BURADANE_CONTRIBUTIONS;
    expect(contributionsEnabled()).toBe(true);
  });

  it("is disabled only by the exact opt-out value", () => {
    for (const deger of ["off", "OFF", " Off ", "oFf"]) {
      process.env.BURADANE_CONTRIBUTIONS = deger;
      expect(contributionsEnabled(), `"${deger}" kapatmali`).toBe(false);
    }
  });

  it("stays enabled for anything that is not the opt-out", () => {
    // A typo must fail SAFE: writes keep working rather than silently
    // stopping. The dangerous direction is accepting data we cannot keep,
    // and that only happens when the flag is deliberately set to off.
    for (const deger of ["on", "1", "true", "", "disabled", "kapali"]) {
      process.env.BURADANE_CONTRIBUTIONS = deger;
      expect(contributionsEnabled(), `"${deger}" acik kalmali`).toBe(true);
    }
  });

  it("carries a message that explains why, not just that", () => {
    // A bare "kapalÄ±" tells the user nothing about whether to try later or
    // somewhere else. The reason is the useful part.
    expect(CONTRIBUTIONS_OFF_MESSAGE).toMatch(/kalÄ±cÄ± depolama/i);
    expect(CONTRIBUTIONS_OFF_MESSAGE.length).toBeGreaterThan(40);
  });
});