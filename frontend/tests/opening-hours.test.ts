import { describe, expect, it } from "vitest";

import { humanizeOpeningHours, isOpenNow, openStateLabel } from "@/lib/opening-hours";

/** Wednesday 2026-09-02, 14:00 local. */
const WED_14 = new Date(2026, 8, 2, 14, 0);
/** Sunday 2026-09-06, 03:00 local. */
const SUN_03 = new Date(2026, 8, 6, 3, 0);

describe("isOpenNow", () => {
  it("returns unknown, never a guess, when there is no data", () => {
    // The whole point: an unmapped opening_hours must not render as "closed".
    expect(isOpenNow(null, WED_14)).toBe("unknown");
    expect(isOpenNow(undefined, WED_14)).toBe("unknown");
    expect(isOpenNow("", WED_14)).toBe("unknown");
  });

  it("handles 24/7", () => {
    expect(isOpenNow("24/7", WED_14)).toBe("open");
    expect(isOpenNow("24/7", SUN_03)).toBe("open");
  });

  it("reads a simple day-range rule", () => {
    expect(isOpenNow("Mo-Fr 09:00-18:00", WED_14)).toBe("open");
    expect(isOpenNow("Mo-Fr 09:00-12:00", WED_14)).toBe("closed");
  });

  it("respects the day, not just the clock", () => {
    expect(isOpenNow("Sa-Su 09:00-18:00", WED_14)).toBe("closed");
  });

  it("handles a wrapping day range (Sa-Su)", () => {
    const sunday13 = new Date(2026, 8, 6, 13, 0);
    expect(isOpenNow("Sa-Su 09:00-18:00", sunday13)).toBe("open");
  });

  it("handles an overnight span crossing midnight", () => {
    // 22:00-06:00 must be open at 03:00, which a naive start<=t<end misses.
    expect(isOpenNow("Su 22:00-06:00", SUN_03)).toBe("open");
  });

  it("handles multiple comma-separated spans in one rule", () => {
    const wed13 = new Date(2026, 8, 2, 13, 0);
    expect(isOpenNow("Mo-Fr 09:00-12:00,14:00-18:00", WED_14)).toBe("open");
    expect(isOpenNow("Mo-Fr 09:00-12:00,14:00-18:00", wed13)).toBe("closed");
  });

  it("handles multiple semicolon-separated rules", () => {
    const sat11 = new Date(2026, 8, 5, 11, 0);
    expect(isOpenNow("Mo-Fr 09:00-18:00; Sa 10:00-14:00", sat11)).toBe("open");
  });

  it("returns unknown for syntax it cannot parse, rather than pretending", () => {
    // Half-understanding an opening_hours rule and reporting "closed" would
    // send someone away from a place that is actually open.
    expect(isOpenNow("Mo-Fr sunrise-sunset", WED_14)).toBe("unknown");
    expect(isOpenNow("PH off; Mo-Fr 09:00-18:00", WED_14)).toBe("unknown");
    expect(isOpenNow("garbage", WED_14)).toBe("unknown");
  });

  it("treats an explicit closed marker as closed", () => {
    expect(isOpenNow("closed", WED_14)).toBe("closed");
    expect(isOpenNow("off", WED_14)).toBe("closed");
  });
});

describe("openStateLabel", () => {
  it("says 'saat bilgisi yok' for unknown, not 'kapalı'", () => {
    expect(openStateLabel("unknown")).toBe("Saat bilgisi yok");
    expect(openStateLabel("open")).toBe("Şu an açık");
    expect(openStateLabel("closed")).toBe("Şu an kapalı");
  });
});

describe("humanizeOpeningHours", () => {
  it("returns nothing when there are no hours", () => {
    expect(humanizeOpeningHours(null)).toEqual([]);
  });

  it("spells out 24/7 in Turkish", () => {
    expect(humanizeOpeningHours("24/7")).toEqual(["Her gün 24 saat açık"]);
  });

  it("translates day abbreviations to Turkish", () => {
    const lines = humanizeOpeningHours("Mo-Fr 09:00-18:00; Sa 10:00-14:00");
    expect(lines[0]).toContain("Pzt");
    expect(lines[0]).toContain("Cum");
    expect(lines[1]).toContain("Cmt");
  });
});
