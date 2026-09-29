/**
 * Ana akisi gercek tarayicida dogrular: dil kabugu, tek buyuk eylem, konum,
 * kategori, yon/mesafe, "burada" dogrulamasinin geri bildirimi ve serbest
 * metin aramasi.
 *
 * Neden vitest degil: bu akislarin hepsi tarayici ve harita ister; depoda DOM
 * ortami yok ve Playwright bagimlilik olarak tasinmiyor (bkz.
 * demo-kaydet.mjs). Bu betik ayni yuklemeyi kullanir.
 *
 * Onkosul: `npm run dev` (ya da `npm run build && npm start`) ayakta.
 * UYARI: dogrulama adimi gercek bir katki yazar (data/contributions.json,
 * .gitignore'da). Betigi resmi/paylasilan bir veriyle kosturma.
 *
 *   node scripts/akis-dogrula.mjs [url]
 *   PLAYWRIGHT_PATH=/yer/node_modules/playwright/index.mjs node scripts/akis-dogrula.mjs
 */
import { pathToFileURL } from "node:url";

async function playwrightYukle() {
  const adaylar = ["@playwright/test", "playwright", process.env.PLAYWRIGHT_PATH].filter(Boolean);
  for (const a of adaylar) {
    try {
      const belirtec = a.startsWith("@") || a === "playwright" ? a : pathToFileURL(a).href;
      return await import(belirtec);
    } catch { /* sonrakini dene */ }
  }
  console.error(
    "Playwright bulunamadi. Gecici kur:  npm i -D @playwright/test && npx playwright install chromium\n" +
    "ya da:  PLAYWRIGHT_PATH=.../node_modules/playwright/index.mjs node scripts/akis-dogrula.mjs",
  );
  process.exit(2);
}

const pw = await playwrightYukle();
const chromium = pw.chromium ?? pw.default.chromium;
const ADRES = process.argv[2] ?? process.env.DEMO_URL ?? "http://localhost:3000";

const browser = await chromium.launch();
const hatalar = [];
let basarisiz = 0;
const ok = (kosul, ad) => {
  console.log(kosul ? "GECTI " : "KALDI ", ad);
  if (!kosul) basarisiz++;
};

async function yeni(locale, geo = true, genislik = 390, yukseklik = 844) {
  const ctx = await browser.newContext({
    viewport: { width: genislik, height: yukseklik },
    locale,
    isMobile: genislik < 768,
    hasTouch: genislik < 768,
    geolocation: geo ? { latitude: 41.0054, longitude: 28.9768 } : undefined,
    permissions: geo ? ["geolocation"] : [],
  });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && hatalar.push(m.text()));
  page.on("pageerror", (e) => hatalar.push("pageerror " + e.message));
  return { ctx, page };
}

// 1) Ingilizce tarayici: EN acilir; konum -> kategori -> yon -> dogrulama
{
  const { ctx, page } = await yeni("en-US");
  await page.goto(ADRES, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  ok((await page.evaluate(() => document.documentElement.lang)) === "en", "en-US tarayici: html lang=en");
  ok(await page.getByText("Find the nearest toilet, water, park or pharmacy").isVisible(), "EN: deger onermesi gorunur");
  const buyuk = page.getByRole("button", { name: "Find places near me" });
  ok(await buyuk.isVisible(), "EN: tek buyuk eylem gorunur");
  ok(
    (await page.getByText("Bu alanda ara").count()) === 0 && (await page.getByText("Search this area").count()) === 0,
    "acilista 'Bu alanda ara' dugmesi yok (kullanici haritayi oynatmadi)",
  );
  await buyuk.click();
  await page.waitForSelector("text=You are here", { timeout: 15000 });
  ok(true, "EN: konum verilince 'You are here'");
  ok((await page.getByText("Find places near me").count()) === 0, "konum verilince karsilama kapanir");
  await page.waitForTimeout(1500);
  const sayac = await page.locator("p[aria-live=polite]").first().innerText();
  ok(/results/.test(sayac) && /nearest/.test(sayac), "EN: sonuc sayaci Ingilizce: " + sayac);

  await page.locator("button").filter({ hasText: /^Toilet\d*$/ }).first().click();
  await page.waitForTimeout(1500);
  const kart = page.locator("article button").first();
  const etiket = await kart.getAttribute("aria-label");
  ok(/away, to the/.test(etiket ?? ""), "EN: kart etiketi mesafe ve yonu soyler: " + etiket);
  await kart.click();
  await page.waitForSelector("text=Is this place still here?");
  await page.getByRole("button", { name: "Yes, it's here" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Thank you, your confirmation is saved" })
    .waitFor({ timeout: 10000 });
  ok(true, "EN: dogrulama sonrasi geri bildirim (role=status)");
  const odak = await page.evaluate(() => document.activeElement?.textContent ?? "");
  ok(/confirmation is saved/.test(odak), "odak dogrulama sonucuna tasindi");

  await page.getByRole("button", { name: "Back to list" }).click();
  // Detaydan donunce filtre dugmesi telefonda dokunulabilir olmali (secili
  // yerin yuzen karti ust cubugun ustune biniyordu).
  await page.getByRole("button", { name: "Filters" }).click({ timeout: 5000 });
  ok(await page.getByRole("dialog").isVisible(), "detaydan donunce filtre dugmesi dokunulabilir");
  await page.keyboard.press("Escape");
  await page.locator("article button").first().click();
  await page.waitForSelector("text=You confirmed this place today");
  ok(true, "ayni yer yeniden acilinca dogrulama hatirlaniyor");

  await page.getByRole("button", { name: "Back to list" }).click();
  await page.getByRole("button", { name: "Türkçe" }).click();
  ok((await page.evaluate(() => document.documentElement.lang)) === "tr", "TR secilince html lang=tr");
  await page.reload({ waitUntil: "networkidle" });
  ok((await page.evaluate(() => localStorage.getItem("buradane:dil"))) === "tr", "tercih localStorage'da (buradane:dil)");
  ok((await page.evaluate(() => document.documentElement.lang)) === "tr", "yenilemede tercih korunur");
  await ctx.close();
}

// 2) Turkce tarayici, konum reddedilmis: sehir secici + Turkce arama
{
  const { ctx, page } = await yeni("tr-TR", false);
  await page.goto(ADRES, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  ok(await page.getByText("Yakınındaki tuvalet, su, park ve eczaneyi bul").isVisible(), "TR: deger onermesi");
  await page.getByRole("button", { name: "Yakınımdakileri bul" }).click();
  await page.getByRole("button", { name: "Şehir seç" }).waitFor({ timeout: 10000 });
  ok(true, "konum reddedilince buyuk eylem 'Şehir seç'e doner");
  await page.getByRole("button", { name: "Şehir seç" }).first().click();
  ok(await page.getByRole("dialog").isVisible(), "sehir secici acilir");
  await page.keyboard.press("Escape");
  await page.getByLabel("Mekan ara").first().fill("ÜCRETSİZ TUVALET");
  await page.waitForTimeout(2200);
  const s = await page.locator("p[aria-live=polite]").first().innerText();
  ok(/sonuç/.test(s) && !/^0 sonuç/.test(s), "Turkce arama (buyuk harf, ek) calisir: " + s);
  await ctx.close();
}

// 3) Masaustu: haritayi surukleyince "Bu alanda ara" cikar
{
  const { ctx, page } = await yeni("tr-TR", true, 1280, 800);
  await page.goto(ADRES, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(2000);
  ok((await page.getByText("Bu alanda ara").count()) === 0, "acilista pill yok");
  await page.mouse.move(900, 400);
  await page.mouse.down();
  await page.mouse.move(700, 300, { steps: 8 });
  await page.mouse.up();
  await page.getByText("Bu alanda ara").first().waitFor({ timeout: 5000 });
  ok(true, "kullanici haritayi surukleyince 'Bu alanda ara' cikar");
  await ctx.close();
}

await browser.close();
console.log("konsol hatalari:", hatalar.length ? hatalar.join(" | ") : "yok");
console.log(basarisiz ? `${basarisiz} KALDI` : "hepsi gecti");
process.exit(basarisiz ? 1 : 0);
