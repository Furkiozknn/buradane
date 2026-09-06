import { describe, expect, it } from "vitest";

import { foldWords, stripCaseSuffixes } from "@/lib/administrative";
import { queryPlaces } from "@/lib/places-repository";

/**
 * Turkish marks "in X" and "from X" with a suffix glued onto the noun, so
 * people type the place they mean as one word: "Kadıköy'deki tuvalet". The
 * search needle is matched word-prefix-wise, and a needle LONGER than the
 * word it should match cannot be a prefix of it - so the district silently
 * fell out of the query and the answer quietly got bigger.
 */
describe("stripCaseSuffixes", () => {
  it("removes locative and ablative endings", () => {
    expect(stripCaseSuffixes("kadikoydeki")).toBe("kadikoy");
    expect(stripCaseSuffixes("kadikoyde")).toBe("kadikoy");
    expect(stripCaseSuffixes("besiktasta")).toBe("besiktas");
    expect(stripCaseSuffixes("besiktastaki")).toBe("besiktas");
    expect(stripCaseSuffixes("ankaradan")).toBe("ankara");
    expect(stripCaseSuffixes("izmirden")).toBe("izmir");
  });

  it("strips the longest ending first", () => {
    // "daki" before "da". The other order leaves "kadikoyki", which matches
    // nothing and looks exactly like the bug it was supposed to fix.
    expect(stripCaseSuffixes("kadikoydeki")).not.toBe("kadikoyki");
  });

  it("leaves a word alone when the stem would be too short", () => {
    // Below three characters the "suffix" is most of the word.
    expect(stripCaseSuffixes("ada")).toBe("ada");
    expect(stripCaseSuffixes("dede")).toBe("dede");
  });

  it("reports no change when there is nothing to strip", () => {
    // The caller uses identity to decide whether a second lookup is worth
    // doing at all, so this has to be exact.
    const needle = "kadikoy tuvalet";
    expect(stripCaseSuffixes(needle)).toBe(needle);
  });

  it("folds the apostrophe form to the same thing", () => {
    // Turkish writes a proper noun's suffix after an apostrophe. foldAscii
    // removes it, so both spellings reach the stripper identically.
    expect(stripCaseSuffixes(foldWords("Kadıköy'deki"))).toBe(
      stripCaseSuffixes(foldWords("kadıköydeki")),
    );
  });
});

describe("search with a case ending", () => {
  // Scoped to a point, not left open: without lat/lon the repository has no
  // province to narrow to and loads all 81, which turns a search assertion
  // into a several-minute national walk.
  const scope = { lat: 40.99, lon: 29.03, radius_m: 15_000, limit: 20_000 };

  it("answers the same question with and without the suffix", () => {
    const plain = queryPlaces({ ...scope, q: "kadıköy tuvalet" });
    const suffixed = queryPlaces({ ...scope, q: "kadıköydeki tuvalet" });
    const apostrophe = queryPlaces({ ...scope, q: "kadıköy'deki tuvalet" });

    // The measured regression: 26 versus 278. Whatever the snapshot holds,
    // the three phrasings must agree, and must not be the unfiltered total.
    expect(plain.total).toBeGreaterThan(0);
    expect(suffixed.total).toBe(plain.total);
    expect(apostrophe.total).toBe(plain.total);
  });

  it("does not report the query as relaxed - it was understood, not widened", () => {
    // A "we broadened your search" notice here would be a false confession:
    // nothing was given up, a case ending was read.
    const suffixed = queryPlaces({ ...scope, q: "kadıköydeki tuvalet" });
    expect(suffixed.applied.relaxed).toBe(false);
  });

  it("still answers an honest empty state for a name that is not there", () => {
    // Suffix stripping must not become a second way to widen. A needle that
    // means nothing anywhere should still come back empty (or relaxed by the
    // ladder), never silently full.
    const nonsense = queryPlaces({ ...scope, q: "zzzqqqwww tuvalet" });
    expect(nonsense.applied.relaxed || nonsense.total === 0).toBe(true);
  });

  it("leaves a place name that genuinely ends in a case-like syllable alone", () => {
    // "Vişnezade" is a real İstanbul neighbourhood ending in "de", and the
    // stripper never sees it: the literal needle matches first. This is the
    // whole reason stripping happens after a failed lookup rather than
    // before every one.
    const literal = queryPlaces({ ...scope, q: "vişnezade" });
    if (literal.total > 0) expect(literal.applied.relaxed).toBe(false);
  });
});
