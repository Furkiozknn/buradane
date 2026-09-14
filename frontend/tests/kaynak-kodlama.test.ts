import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guards the repository against mojibake.
 *
 * Windows PowerShell 5.1 reads a BOM-less `.ps1` as the ANSI code page, so a
 * script that contains UTF-8 Turkish and writes a source file turns "ü" into
 * "Ã¼" on the way through. It happened here: seven files shipped with
 * corrupted labels, including a user-facing error message and the amenity
 * names published to search engines as structured data.
 *
 * The reason it went unnoticed is the important part. **The tests passed.**
 * The test file had been written by the same broken pipeline, so it compared
 * mojibake against mojibake and agreed with itself. An assertion is only as
 * good as the encoding of the file it lives in.
 *
 * So this check does not compare strings at all - it reads bytes and looks
 * for the byte sequences that only appear when UTF-8 has been round-tripped
 * through a single-byte code page. That is independent of what any other
 * test believes.
 */

const KOK = path.join(__dirname, "..", "src");
const TESTLER = __dirname;

/**
 * UTF-8 bytes re-encoded after being read as cp1252/cp1254.
 * "ü" (C3 BC) becomes "Ã¼" = C3 83 C2 BC, and so on for every Turkish letter.
 */
const MOJIBAKE =
  /\u00C3[\u0080-\u00BF]|\u00C4[\u0080-\u00BF]|\u00C5[\u0080-\u00BF]|\u00E2\u0080|\u00C2[\u00A0-\u00BF]/;

function kaynakDosyalari(dizin: string): string[] {
  const cikti: string[] = [];
  for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
    const tam = path.join(dizin, girdi.name);
    if (girdi.isDirectory()) {
      if (girdi.name === "node_modules" || girdi.name === ".next") continue;
      cikti.push(...kaynakDosyalari(tam));
    } else if (/\.(ts|tsx|json|md)$/.test(girdi.name)) {
      cikti.push(tam);
    }
  }
  return cikti;
}

describe("kaynak kodlamasi", () => {
  it("hicbir kaynak dosyasinda bozuk Turkce karakter yok", () => {
    const bozuk: string[] = [];
    for (const dosya of [...kaynakDosyalari(KOK), ...kaynakDosyalari(TESTLER)]) {
      // Bu dosya kendi fikstürlerinde bilerek bozuk örnekler taşıyor.
      if (path.resolve(dosya) === path.resolve(__filename)) continue;
      const metin = fs.readFileSync(dosya, "utf8");
      if (!MOJIBAKE.test(metin)) continue;
      const satir = metin
        .split("\n")
        .find((s) => MOJIBAKE.test(s))
        ?.trim()
        .slice(0, 90);
      bozuk.push(`${path.relative(process.cwd(), dosya)}: ${satir}`);
    }
    expect(bozuk, `Bozuk kodlama:\n${bozuk.join("\n")}`).toEqual([]);
  });

  it("gercek Turkce harfleri bozuk saymaz", () => {
    // Denetimin kendisi dogru metni reddetmemeli, yoksa kimse kullanmaz.
    expect(MOJIBAKE.test("İçme Suyu Çeşmesi · Şarj İstasyonu · ğüöçı")).toBe(false);
  });

  it("bozulmus metni gercekten yakalar", () => {
    // Gercekte olan bozulma: "İçme" -> "Ä°Ã§me"
    expect(MOJIBAKE.test("Ä°Ã§me Suyu Ã‡eÅŸmesi")).toBe(true);
  });
});
