/**
 * README icin gercek kullanimdan kare yakalar.
 *
 * Neden bir betik: elle cekilmis bir ekran goruntusu, arayuz degistigi anda
 * sessizce eskir ve "bu gercekten uygulama mi" sorusunun cevabi kaybolur.
 * Bu betik calisan uygulamayi acar, gercekten kullanir ve kareleri diske
 * yazar. ffmpeg'e devri cagiran taraf yapar (bkz. README).
 *
 * Onkosullar:
 *   - `npm run dev` ayakta (harita kiremitleri OpenFreeMap'ten geldigi icin
 *     ag da gerekli)
 *   - Playwright erisilebilir. Bu proje vitest kullaniyor ve Playwright'i
 *     BAGIMLILIK OLARAK TASIMIYOR: tek bir README gorseli icin ~100 MB'lik
 *     bir tarayici bagimliligini herkesin `npm ci`'sine yuklemek dogru
 *     takas degil. O yuzden modul calisma aninda araniyor ve yoksa ne
 *     yapilacagi soyleniyor.
 *
 *   node scripts/demo-kaydet.mjs [cikti-dizini]
 *   PLAYWRIGHT_PATH=/baska/yer/node_modules/@playwright/test node scripts/demo-kaydet.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

async function playwrightYukle() {
  const adaylar = [
    "@playwright/test",
    process.env.PLAYWRIGHT_PATH,
  ].filter(Boolean);
  for (const a of adaylar) {
    try {
      const belirtec = a.startsWith("@") ? a : pathToFileURL(a).href;
      return await import(belirtec);
    } catch { /* sonrakini dene */ }
  }
  console.error(
    "Playwright bulunamadi. Ya gecici olarak kur:\n" +
    "    npm i -D @playwright/test && npx playwright install chromium\n" +
    "ya da baska bir yerdeki kopyayi goster:\n" +
    "    PLAYWRIGHT_PATH=.../node_modules/@playwright/test node scripts/demo-kaydet.mjs"
  );
  process.exit(2);
}

const { chromium } = await playwrightYukle();

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(BURASI, "..", ".demo");
const ADRES = process.env.DEMO_URL || "http://localhost:3000";

let n = 0;
async function kare(page, adet = 1, bekle = 90) {
  for (let i = 0; i < adet; i++) {
    await page.screenshot({ path: path.join(OUT, `k${String(n).padStart(3, "0")}.png`) });
    n++;
    await page.waitForTimeout(bekle);
  }
}

/** Metnine gore kategori cipi. Cipler id tasimiyor, metin tasiyor. */
function cip(page, ad) {
  return page.locator("button").filter({ hasText: new RegExp(`^${ad}\\d+$`) }).first();
}

const kayit = [];

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  const hatalar = [];
  page.on("console", (m) => m.type() === "error" && hatalar.push(m.text()));

  await page.goto(ADRES, { waitUntil: "networkidle" });
  // Harita kiremitleri agdan geliyor; canvas boyanmadan kare almak
  // README'ye bos beyaz bir dikdortgen koyar.
  await page.waitForSelector("canvas", { timeout: 30_000 });
  await page.waitForTimeout(6000);

  await kare(page, 8, 120);                       // acilis: kategoriler + harita

  for (const ad of ["Park", "Cami", "Tuvalet"]) {
    const c = cip(page, ad);
    if (!(await c.count())) {
      kayit.push(`cip bulunamadi: ${ad}`);
      continue;
    }
    await c.click();
    await page.waitForTimeout(1400);              // sonuc listesi ve harita otursun
    await kare(page, 9, 110);
    const ozet = (await page.locator("text=/\\d+ sonuç/").first().textContent().catch(() => "")) || "";
    kayit.push(`${ad}: ${ozet.trim().replace(/\s+/g, " ")}`);
    await c.click();                              // secimi kaldir, sonraki kategoriye temiz gec
    await page.waitForTimeout(700);
  }

  // Serbest metin arama - uygulamanin asil vaadi bu ("ne lazim?")
  const kutu = page.getByPlaceholder(/Ne arıyorsun/i);
  if (await kutu.count()) {
    await kutu.click();
    for (const harf of "ücretsiz tuvalet") {
      await kutu.type(harf, { delay: 0 });
      if (n % 2 === 0) await kare(page, 1, 55);
    }
    await page.waitForTimeout(1500);
    await kare(page, 10, 110);
    const ozet = (await page.locator("text=/\\d+ sonuç/").first().textContent().catch(() => "")) || "";
    kayit.push(`arama "ücretsiz tuvalet": ${ozet.trim().replace(/\s+/g, " ")}`);
  }

  await browser.close();

  if (hatalar.length) {
    console.error("KONSOL HATASI:");
    for (const h of hatalar.slice(0, 5)) console.error("  " + h);
  }
  for (const s of kayit) console.log("  " + s);
  console.log(`${n} kare -> ${OUT}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
