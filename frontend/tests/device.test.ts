/**
 * The server's device guess decides the FIRST PAINT layout. Getting it wrong
 * for a desktop visitor was a measured layout shift of 0.245 (Lighthouse), so
 * the rules are pinned here.
 */

import { describe, expect, it } from "vitest";

import { looksLikeDesktop } from "@/lib/device";

const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });

describe("looksLikeDesktop", () => {
  it("trusts the Chromium mobile client hint over the user agent", () => {
    expect(looksLikeDesktop(headers({ "sec-ch-ua-mobile": "?1", "user-agent": "Mozilla/5.0 (Windows NT 10.0)" }))).toBe(false);
    expect(looksLikeDesktop(headers({ "sec-ch-ua-mobile": "?0", "user-agent": "Mozilla/5.0 Android Mobile" }))).toBe(true);
  });

  it("falls back to the user agent when there is no hint", () => {
    expect(looksLikeDesktop(headers({ "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140" }))).toBe(true);
    expect(looksLikeDesktop(headers({ "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605" }))).toBe(true);
    expect(looksLikeDesktop(headers({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile/15E148" }))).toBe(false);
    expect(looksLikeDesktop(headers({ "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari" }))).toBe(false);
    expect(looksLikeDesktop(headers({ "user-agent": "Mozilla/5.0 (iPad; CPU OS 18_0) Mobile/15E148" }))).toBe(false);
  });

  it("keeps the phone layout when there is no evidence at all", () => {
    expect(looksLikeDesktop(headers({}))).toBe(false);
  });
});
