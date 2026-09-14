/**
 * Names that describe a category rather than identify a place.
 *
 * Most OSM records are unnamed nodes that the importer labels with their
 * category: 8.822 "Otopark", 8.206 "Spor Alanı", 5.869 "Park" in Istanbul,
 * Ankara, Izmir and Konya alone. Their `/yer` pages are near-duplicates of
 * each other - same title, same two-word description, different coordinates.
 *
 * `sitemap.ts` already kept them out of the sitemap for exactly this reason.
 * But a sitemap is a recommendation, not a gate: nothing stopped a crawler
 * reaching them through the map and indexing 40k thin pages, which is how a
 * small site spends its crawl budget on nothing and drags its own quality
 * signal down. The two decisions have to agree, so the rule lives here once
 * and both callers read it.
 *
 * These pages stay fully reachable for people - linked, shareable, working.
 * They are only asked not to compete in the index. `follow` stays on so the
 * links out of them still count.
 */
export const GENERIC_NAMES =
  /^(Umumi Tuvalet|Park|İçme Suyu Çeşmesi|Oturma Alanı|Çocuk Oyun Alanı|Spor Alanı|Otopark|Duş|Ücretsiz Wi-Fi Noktası|Cami|Eczane|Acil Toplanma Alanı|Kütüphane|Şarj İstasyonu)$/;

export function isGenericName(name: string | null | undefined): boolean {
  if (!name) return true;
  return GENERIC_NAMES.test(name.trim());
}