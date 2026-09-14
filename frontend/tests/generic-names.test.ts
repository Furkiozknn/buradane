import { describe as tanimla, expect, it } from "vitest";

import { isGenericName } from "@/lib/generic-names";

/**
 * 53.599 kayit uzerinde olculdu: %75,3'unun basligi bir baskasiyla
 * birebir ayniydi ("Otopark - buradane" tek basina 8.822 kez). Bu
 * sayfalar zaten sitemap disindaydi; indeks karari da ayni kurala
 * bagli olmali, yoksa iki karar birbirinden ayrilir.
 */
tanimla("isGenericName", () => {
  it("kategori adi tasiyan kayitlari yakalar", () => {
    for (const ad of [
      "Otopark", "Spor Alanı", "Park", "Çocuk Oyun Alanı", "Cami",
      "Oturma Alanı", "Umumi Tuvalet", "İçme Suyu Çeşmesi", "Eczane",
      "Acil Toplanma Alanı", "Kütüphane", "Şarj İstasyonu", "Duş",
      "Ücretsiz Wi-Fi Noktası",
    ]) {
      expect(isGenericName(ad), `"${ad}" jenerik sayilmali`).toBe(true);
    }
  });

  it("gercek bir isim tasiyan kaydi indekste birakir", () => {
    for (const ad of [
      "Cihannuma", "Gülhane Parkı", "Beyazıt Devlet Kütüphanesi",
      "Otopark Yanı Büfe", "Merkez Eczanesi",
    ]) {
      expect(isGenericName(ad), `"${ad}" indekslenebilmeli`).toBe(false);
    }
  });

  it("bosluklu yazimi da yakalar", () => {
    expect(isGenericName("  Otopark  ")).toBe(true);
  });

  it("isimsiz kaydi jenerik sayar", () => {
    // Isim yoksa sayfanin ayirt edici hicbir seyi yok.
    expect(isGenericName(null)).toBe(true);
    expect(isGenericName("")).toBe(true);
    expect(isGenericName(undefined)).toBe(true);
  });

  it("kismi eslesmeyi jenerik SAYMAZ", () => {
    // "Park" jenerik ama "Parkorman" gercek bir yer adi.
    expect(isGenericName("Parkorman")).toBe(false);
    expect(isGenericName("Cami Sokak Çeşmesi")).toBe(false);
  });
});