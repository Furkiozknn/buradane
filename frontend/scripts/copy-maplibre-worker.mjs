/**
 * Copies MapLibre GL JS v6's runtime worker into public/maplibre/.
 *
 * v6 is ESM-only and loads its tile-parsing worker from a separate file at
 * runtime. Letting the bundler emit that file does not work: the worker
 * statically imports a sibling (`./maplibre-gl-shared.mjs`) that the bundler
 * does not emit next to it, so the worker throws on boot. The failure is
 * completely silent - the style and sprites load, no error is raised, and the
 * map simply never requests a single vector tile.
 *
 * Serving both files from public/ side by side makes the sibling import
 * resolve correctly and removes the bundler from the equation entirely.
 *
 * Runs automatically before dev/build (see package.json scripts) so a
 * `npm ci` or a maplibre version bump can't silently break the map again.
 */

import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, "..");

const SOURCE_DIR = path.join(projectRoot, "node_modules", "maplibre-gl", "dist");
const TARGET_DIR = path.join(projectRoot, "public", "maplibre");

// The worker and every sibling it imports at runtime.
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

async function main() {
  if (!existsSync(SOURCE_DIR)) {
    console.error(`[maplibre] ${SOURCE_DIR} bulunamadı - önce bağımlılıklar kurulmalı.`);
    process.exit(1);
  }

  await mkdir(TARGET_DIR, { recursive: true });

  for (const file of FILES) {
    const from = path.join(SOURCE_DIR, file);
    if (!existsSync(from)) {
      // Fail loudly: a missing file here means the map will be blank at
      // runtime with no error, which is far harder to debug than this.
      console.error(`[maplibre] beklenen dosya yok: ${from}`);
      process.exit(1);
    }
    await copyFile(from, path.join(TARGET_DIR, file));
  }

  console.log(`[maplibre] worker dosyaları public/maplibre/ içine kopyalandı (${FILES.length} dosya)`);
}

main().catch((error) => {
  console.error("[maplibre] kopyalama başarısız:", error);
  process.exit(1);
});
