"use client";

import { bearingLabel } from "@/lib/geo";

/**
 * The "which way?" indicator: a north-referenced arrow plus the direction
 * spelled out for assistive tech.
 *
 * Deliberately NOT a device-compass needle. A magnetometer reading is
 * unreliable indoors and uncalibrated on most phones, and rotating with the
 * user's heading would make every arrow on screen spin at once. A
 * north-referenced arrow is stable, needs no sensor or permission, and can
 * sit next to every result in a list simultaneously.
 */
export function DirectionArrow({
  degrees,
  size = 14,
  className,
}: {
  degrees: number;
  size?: number;
  className?: string;
}) {
  const label = bearingLabel(degrees);
  return (
    <span
      className={className}
      // The rotation is decorative; the direction is announced as text by the
      // caller (or by this title for pointer users).
      title={`${label} yönünde`}
      aria-hidden="true"
      style={{ display: "inline-flex", transform: `rotate(${degrees}deg)`, lineHeight: 0 }}
    >
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path
          d="M8 2.2 L12.4 12.6 L8 10.1 L3.6 12.6 Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
