import { describe, expect, it } from "vitest";

import { bearingDegrees, bearingLabel, boundingBox, formatDistance, haversineMeters, walkingMinutes } from "@/lib/geo";

const TAKSIM = { lat: 41.0370, lon: 28.9850 };
const KADIKOY = { lat: 40.9905, lon: 29.0234 };

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    expect(haversineMeters(TAKSIM, TAKSIM)).toBe(0);
  });

  it("matches a known real-world distance", () => {
    // Taksim to Kadıköy is roughly 6-7km as the crow flies. A sanity range,
    // not an exact fixture - the coordinates are approximate landmarks.
    const distance = haversineMeters(TAKSIM, KADIKOY);
    expect(distance).toBeGreaterThan(5_500);
    expect(distance).toBeLessThan(7_500);
  });

  it("is symmetric", () => {
    expect(haversineMeters(TAKSIM, KADIKOY)).toBeCloseTo(haversineMeters(KADIKOY, TAKSIM), 6);
  });
});

describe("bearingDegrees", () => {
  it("points north for a point directly above", () => {
    expect(bearingDegrees({ lat: 41, lon: 29 }, { lat: 42, lon: 29 })).toBeCloseTo(0, 1);
  });

  it("points east for a point directly to the right", () => {
    expect(bearingDegrees({ lat: 41, lon: 29 }, { lat: 41, lon: 30 })).toBeCloseTo(90, 0);
  });

  it("points south for a point directly below", () => {
    expect(bearingDegrees({ lat: 41, lon: 29 }, { lat: 40, lon: 29 })).toBeCloseTo(180, 1);
  });

  it("always returns a value in [0, 360)", () => {
    const west = bearingDegrees({ lat: 41, lon: 29 }, { lat: 41, lon: 28 });
    expect(west).toBeGreaterThanOrEqual(0);
    expect(west).toBeLessThan(360);
    expect(west).toBeCloseTo(270, 0);
  });
});

describe("bearingLabel", () => {
  it("names the eight compass directions in Turkish", () => {
    expect(bearingLabel(0)).toBe("kuzey");
    expect(bearingLabel(45)).toBe("kuzeydoğu");
    expect(bearingLabel(90)).toBe("doğu");
    expect(bearingLabel(180)).toBe("güney");
    expect(bearingLabel(270)).toBe("batı");
  });

  it("wraps 360 back to north rather than reading past the end of the table", () => {
    expect(bearingLabel(359)).toBe("kuzey");
    expect(bearingLabel(360)).toBe("kuzey");
  });
});

describe("boundingBox", () => {
  it("contains the centre", () => {
    const box = boundingBox(TAKSIM, 1000);
    expect(TAKSIM.lat).toBeGreaterThan(box.minLat);
    expect(TAKSIM.lat).toBeLessThan(box.maxLat);
    expect(TAKSIM.lon).toBeGreaterThan(box.minLon);
    expect(TAKSIM.lon).toBeLessThan(box.maxLon);
  });

  it("never under-selects: every point inside the radius is inside the box", () => {
    // The box is a pre-filter before the haversine call, so a false negative
    // here would silently drop real results.
    const radius = 2000;
    const box = boundingBox(TAKSIM, radius);
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const rad = (bearing * Math.PI) / 180;
      // Approximate a point at exactly `radius` along this bearing.
      const dLat = (radius * Math.cos(rad)) / 111_320;
      const dLon = (radius * Math.sin(rad)) / (111_320 * Math.cos((TAKSIM.lat * Math.PI) / 180));
      const point = { lat: TAKSIM.lat + dLat, lon: TAKSIM.lon + dLon };
      expect(point.lat).toBeGreaterThanOrEqual(box.minLat);
      expect(point.lat).toBeLessThanOrEqual(box.maxLat);
      expect(point.lon).toBeGreaterThanOrEqual(box.minLon);
      expect(point.lon).toBeLessThanOrEqual(box.maxLon);
    }
  });
});

describe("formatDistance", () => {
  it("uses metres below a kilometre", () => {
    expect(formatDistance(66.4)).toBe("66 m");
    expect(formatDistance(999)).toBe("999 m");
  });

  it("switches to kilometres with one decimal", () => {
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(4237)).toBe("4.2 km");
  });

  it("drops the decimal past 10km, where it is noise", () => {
    expect(formatDistance(12_400)).toBe("12 km");
  });

  it("renders nothing for an unknown distance rather than 'null'", () => {
    expect(formatDistance(null)).toBe("");
    expect(formatDistance(undefined)).toBe("");
  });
});

describe("walkingMinutes", () => {
  it("never returns zero - 'yürüyerek 0 dk' is not a useful answer", () => {
    expect(walkingMinutes(5)).toBe(1);
  });

  it("scales roughly with distance", () => {
    expect(walkingMinutes(750)).toBe(10);
  });
});
