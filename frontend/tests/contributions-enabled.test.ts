import { afterEach, describe, expect, it } from "vitest";

import {
  CONTRIBUTIONS_OFF_MESSAGE,
  contributionsEnabled,
} from "@/lib/contributions-enabled";
import { SITE_URL_FALLBACK, siteUrl } from "@/lib/site-url";

/**
 * These two resolvers decide whether a deployment quietly loses user data
 * and whether every share card and sitemap URL points somewhere real. Both
 * fail invisibly when wrong, so both are pinned here.
 */

const ANAHTARLAR = [
  "BURADANE_CONTRIBUTIONS",
  "BURADANE_SITE_URL",
  "VERCEL",
  "NETLIFY",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

const oncekiler = new Map<string, string | undefined>();

function ayarla(k: string, v: string | undefined) {
  if (!oncekiler.has(k)) oncekiler.set(k, process.env[k]);
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

afterEach(() => {
  for (const k of ANAHTARLAR) {
    const v = oncekiler.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  oncekiler.clear();
});

describe("contributionsEnabled", () => {
  it("defaults to enabled off a serverless host", () => {
    for (const k of ANAHTARLAR) ayarla(k, undefined);
    expect(contributionsEnabled()).toBe(true);
  });

  it("defaults to DISABLED on Vercel, with no configuration", () => {
    // The whole point: the safe state is the one you get by doing nothing.
    for (const k of ANAHTARLAR) ayarla(k, undefined);
    ayarla("VERCEL", "1");
    expect(contributionsEnabled()).toBe(false);
  });

  it("defaults to disabled on Netlify too", () => {
    for (const k of ANAHTARLAR) ayarla(k, undefined);
    ayarla("NETLIFY", "true");
    expect(contributionsEnabled()).toBe(false);
  });

  it("lets an explicit flag override the host detection both ways", () => {
    for (const k of ANAHTARLAR) ayarla(k, undefined);
    ayarla("VERCEL", "1");
    ayarla("BURADANE_CONTRIBUTIONS", "on");
    expect(contributionsEnabled(), "acik zorlanabilmeli").toBe(true);

    ayarla("VERCEL", undefined);
    ayarla("BURADANE_CONTRIBUTIONS", "OFF");
    expect(contributionsEnabled(), "kapali zorlanabilmeli").toBe(false);
  });

  it("treats an unrecognised value as absent, not as off", () => {
    // A typo must not silently stop writes on a host that can keep them.
    for (const k of ANAHTARLAR) ayarla(k, undefined);
    ayarla("BURADANE_CONTRIBUTIONS", "kapali");
    expect(contributionsEnabled()).toBe(true);
  });

  it("explains why, not just that", () => {
    expect(CONTRIBUTIONS_OFF_MESSAGE).toMatch(/kalıcı depolama/i);
  });
});

describe("siteUrl", () => {
  it("prefers the explicit variable and strips trailing slashes", () => {
    for (const k of ANAHTARLAR) ayarla(k, undefined);
    ayarla("BURADANE_SITE_URL", "https://buradane.com//");
    expect(siteUrl()).toBe("https://buradane.com");
  });

  it("falls back to Vercel's stable production hostname", () => {
    for (const k of ANAHTARLAR) ayarla(k, undefined);
    ayarla("VERCEL_PROJECT_PRODUCTION_URL", "buradane.vercel.app");
    expect(siteUrl()).toBe("https://buradane.vercel.app");
  });

  it("lets the explicit variable win over Vercel's", () => {
    for (const k of ANAHTARLAR) ayarla(k, undefined);
    ayarla("VERCEL_PROJECT_PRODUCTION_URL", "buradane.vercel.app");
    ayarla("BURADANE_SITE_URL", "https://buradane.com");
    expect(siteUrl()).toBe("https://buradane.com");
  });

  it("uses an obviously fake domain when nothing is set", () => {
    // Visible misconfiguration beats a silent link to someone else's site.
    for (const k of ANAHTARLAR) ayarla(k, undefined);
    expect(siteUrl()).toBe(SITE_URL_FALLBACK);
    expect(siteUrl()).toContain(".example");
  });
});