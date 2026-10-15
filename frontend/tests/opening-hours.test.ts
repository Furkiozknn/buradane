import { describe, expect, it } from "vitest";

import { humanizeOpeningHours, isOpenNow, openStateLabel } from "@/lib/opening-hours";

/**
 * Test instants are pinned to Istanbul wall time with an explicit +03:00
 * offset, never built with the local-zone Date constructor. isOpenNow reads
 * the clock in Europe/Istanbul regardless of runtime zone - the fix for a
 * 3-hour error on UTC servers - so a test built from the runtime zone
 * asserts different wall times on different machines: green on a +03
 * laptop, red on UTC CI. That is the exact trap this file exists to close.
 */
const wall = (iso: string) => new Date(`${iso}+03:00`);

/** Wednesday 2026-09-02, 14:00 Istanbul. */
const WED_14 = wall("2026-09-02T14:00:00");
/** Sunday 2026-09-06, 03:00 Istanbul. */
const SUN_03 = wall("2026-09-06T03:00:00");

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
    const sunday13 = wall("2026-09-06T13:00:00");
    expect(isOpenNow("Sa-Su 09:00-18:00", sunday13)).toBe("open");
  });

  it("handles an overnight span crossing midnight", () => {
    // 22:00-06:00 must be open at 03:00, which a naive start<=t<end misses.
    // The 03:00 that belongs to "Su 22:00-06:00" is MONDAY 03:00: an overnight
    // span runs from the day it starts on. This test once asserted Sunday
    // 03:00, which is the tail of Saturday night - a day with no hours.
    expect(isOpenNow("Su 22:00-06:00", wall("2026-09-07T03:00:00"))).toBe("open");
    expect(isOpenNow("Su 22:00-06:00", SUN_03)).toBe("closed");
    expect(isOpenNow("Sa 22:00-06:00", SUN_03)).toBe("open");
  });

  it("handles multiple comma-separated spans in one rule", () => {
    const wed13 = wall("2026-09-02T13:00:00");
    expect(isOpenNow("Mo-Fr 09:00-12:00,14:00-18:00", WED_14)).toBe("open");
    expect(isOpenNow("Mo-Fr 09:00-12:00,14:00-18:00", wed13)).toBe("closed");
  });

  it("handles multiple semicolon-separated rules", () => {
    const sat11 = wall("2026-09-05T11:00:00");
    expect(isOpenNow("Mo-Fr 09:00-18:00; Sa 10:00-14:00", sat11)).toBe("open");
  });

  it("returns unknown for syntax it cannot parse, rather than pretending", () => {
    // Half-understanding an opening_hours rule and reporting "closed" would
    // send someone away from a place that is actually open.
    expect(isOpenNow("Mo-Fr sunrise-sunset", WED_14)).toBe("unknown");
    expect(isOpenNow("garbage", WED_14)).toBe("unknown");
    expect(isOpenNow("Mo-Fr 09:00-18:00+", WED_14)).toBe("unknown");
  });

  it("treats an explicit closed marker as closed", () => {
    expect(isOpenNow("closed", WED_14)).toBe("closed");
    expect(isOpenNow("off", WED_14)).toBe("closed");
  });
});

describe("isOpenNow - OSM rule semantics", () => {
  const FRI_11 = wall("2026-09-04T11:00:00");
  const FRI_13 = wall("2026-09-04T13:00:00");
  const SAT_01 = wall("2026-09-05T01:00:00");
  const FRI_01 = wall("2026-09-04T01:00:00");
  const SUN_12 = wall("2026-09-06T12:00:00");

  it("lets a later rule replace earlier ones for the days it names", () => {
    expect(isOpenNow("Mo-Fr 09:00-18:00; Fr 09:00-12:00", FRI_11)).toBe("open");
    expect(isOpenNow("Mo-Fr 09:00-18:00; Fr 09:00-12:00", FRI_13)).toBe("closed");
    // the replacement is per day: Wednesday still has the long hours
    expect(isOpenNow("Mo-Fr 09:00-18:00; Fr 09:00-12:00", WED_14)).toBe("open");
  });

  it("reads '<days> off' as a closing rule instead of giving up", () => {
    expect(isOpenNow("Mo-Su 08:00-22:00; Su off", SUN_12)).toBe("closed");
    expect(isOpenNow("Mo-Su 08:00-22:00; Su off", WED_14)).toBe("open");
    expect(isOpenNow("Mo-Sa 09:00-19:00; Su closed", SUN_12)).toBe("closed");
  });

  it("adds an additional rule after ', ' rather than replacing", () => {
    const sat11 = wall("2026-09-05T11:00:00");
    expect(isOpenNow("Mo-Fr 09:00-18:00, Sa 10:00-14:00", sat11)).toBe("open");
    expect(isOpenNow("Mo-Fr 09:00-18:00, Sa 10:00-14:00", WED_14)).toBe("open");
  });

  it("treats a repeated identical selector as a split day, not an override", () => {
    // Read to the letter the second rule wipes the morning; the mapper meant both.
    const wed08 = wall("2026-09-02T08:00:00");
    expect(isOpenNow("Mo-Fr 07:00-13:30; Mo-Fr 17:00-20:00", wed08)).toBe("open");
    expect(isOpenNow("Mo-Fr 07:00-13:30; Mo-Fr 17:00-20:00", WED_14)).toBe("closed");
    expect(isOpenNow("10:00-24:00; 00:00-02:00", WED_14)).toBe("open");
  });

  it("gives an overnight span to the day it starts on", () => {
    // Friday night's 22:00-02:00 is open at 01:00 Saturday...
    expect(isOpenNow("Fr 22:00-02:00", SAT_01)).toBe("open");
    // ...and NOT at 01:00 Friday (that would be Thursday night, which has no hours).
    expect(isOpenNow("Fr 22:00-02:00", FRI_01)).toBe("closed");
    // A day that is off still carries the tail of the night before.
    expect(isOpenNow("Mo-Fr 18:00-03:00; Sa off", SAT_01)).toBe("open");
  });

  it("accepts lower-case day names, as hand-typed values often have them", () => {
    expect(isOpenNow("mo-fr 09:00-18:00", WED_14)).toBe("open");
    expect(isOpenNow("mo-fr 09:00-18:00", SUN_12)).toBe("closed");
  });

  it("rejects malformed times instead of reading them loosely", () => {
    expect(isOpenNow("Mo-Fr 09:00-24:30", WED_14)).toBe("unknown");
    expect(isOpenNow("Mo-Fr 9-18", WED_14)).toBe("unknown");
    expect(isOpenNow("Mo-Fr-Sa 09:00-18:00", WED_14)).toBe("unknown");
  });
});

describe("isOpenNow - public holidays (PH)", () => {
  const SAT_11 = wall("2026-09-05T11:00:00");
  /** 29 October 2026 (Cumhuriyet Bayramı) is a Thursday. */
  const OCT29_11 = wall("2026-10-29T11:00:00");

  it("answers when the holiday and the normal-day reading agree", () => {
    // Open on weekdays whether or not today is a holiday.
    expect(isOpenNow("Mo-Fr,PH 09:00-17:00", WED_14)).toBe("open");
    // "PH off" listed first is replaced by the weekday rule on any weekday.
    expect(isOpenNow("PH off; Mo-Fr 09:00-18:00", WED_14)).toBe("open");
    // Closed on Saturday holiday or not.
    expect(isOpenNow("Mo-Fr 09:00-18:00; PH off", SAT_11)).toBe("closed");
  });

  it("says unknown when the answer depends on a holiday it cannot rule out", () => {
    // Religious holidays move every year and are not tabled, so a normal
    // Wednesday might be one: "PH off" makes the answer genuinely unknown.
    expect(isOpenNow("Mo-Fr 09:00-18:00; PH off", WED_14)).toBe("unknown");
    expect(isOpenNow("Mo-Fr,PH 09:00-17:00", SAT_11)).toBe("unknown");
  });

  it("knows Türkiye's fixed-date national holidays", () => {
    expect(isOpenNow("Mo-Fr 09:00-18:00; PH off", OCT29_11)).toBe("closed");
    expect(isOpenNow("Mo-Fr 09:00-12:00; PH 10:00-16:00", wall("2026-10-29T14:00:00"))).toBe("open");
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
