/**
 * Builds the map pin bitmaps: a colored teardrop with the category's own
 * lucide glyph inside, so the icon on the map is literally the same icon the
 * chips and cards use. Consistency here is what separates "a real product"
 * from "a demo with colored dots".
 *
 * Why render React to markup instead of hardcoding SVG paths: lucide's icon
 * path data is package-internal (`__iconNode` is not part of the public
 * export surface, verified against lucide-react v1.39), and transcribing 9
 * icons' path strings by hand would silently rot on the next lucide update.
 * Rendering the actual component once per category, offscreen, at map init
 * is cheap (9 renders) and can never disagree with the UI.
 *
 * Pins are drawn at 2× and registered with `pixelRatio: 2` so they stay
 * crisp on high-density screens.
 */

import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createElement } from "react";

import { categoryMeta } from "./categories";
import type { CategorySlug } from "./types";

const PIN_WIDTH = 64;
const PIN_HEIGHT = 84;

/** Renders a lucide icon component to raw SVG markup using only public API. */
function iconMarkup(slug: CategorySlug): string {
  const Icon = categoryMeta(slug).icon;

  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "-9999px";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    // flushSync so the markup exists before we read it - createRoot renders
    // asynchronously by default and we'd otherwise read an empty container.
    flushSync(() => {
      root.render(
        createElement(Icon, {
          size: 24,
          color: "#FFFFFF",
          strokeWidth: 2.4,
          absoluteStrokeWidth: true,
        }),
      );
    });
    const svg = host.querySelector("svg");
    if (!svg) return "";
    // Strip the outer <svg> wrapper - we re-embed the children inside our own
    // transformed group so the glyph lands centered in the pin head.
    return svg.innerHTML;
  } finally {
    root.unmount();
    host.remove();
  }
}

function pinSvg(color: string, glyph: string): string {
  // Teardrop: a circle head with a tail that meets at the anchor point, so
  // `icon-anchor: bottom` puts the tip exactly on the coordinate.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_WIDTH}" height="${PIN_HEIGHT}" viewBox="0 0 64 84">
  <path
    d="M32 82C32 82 60 52.2 60 32C60 16.536 47.464 4 32 4C16.536 4 4 16.536 4 32C4 52.2 32 82 32 82Z"
    fill="${color}" stroke="#FFFFFF" stroke-width="5" stroke-linejoin="round"/>
  <g transform="translate(32 31) scale(1.05) translate(-12 -12)"
     fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    ${glyph}
  </g>
</svg>`;
}

const cache = new Map<string, ImageBitmap | HTMLImageElement>();

export async function buildPinImage(
  color: string,
  slug: CategorySlug,
): Promise<ImageBitmap | HTMLImageElement | null> {
  const cacheKey = `${slug}:${color}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let url: string | null = null;
  try {
    // iconMarkup renders React synchronously and can throw; it must be inside
    // the try, or a failure escapes buildPinImage entirely instead of
    // degrading to "no custom pin for this category".
    const glyph = iconMarkup(slug);
    const svg = pinSvg(color, glyph);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    url = URL.createObjectURL(blob);

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image(PIN_WIDTH, PIN_HEIGHT);
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`pin görseli yüklenemedi: ${slug}`));
      img.src = url as string;
    });

    // createImageBitmap gives MapLibre a GPU-friendly image; falling back to
    // the HTMLImageElement keeps older browsers working rather than failing
    // to draw any pins at all.
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(image);
      cache.set(cacheKey, bitmap);
      return bitmap;
    }
    cache.set(cacheKey, image);
    return image;
  } catch (error) {
    console.error("Pin görseli oluşturulamadı", slug, error);
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
