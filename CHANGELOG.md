# Değişiklik Günlüğü

Bu dosya sürüm sürüm neyin değiştiğini anlatır. Biçim
[Keep a Changelog](https://keepachangelog.com/tr/1.1.0/)'a yakındır; sürüm
numaraları [Semantic Versioning](https://semver.org/lang/tr/) kurallarına
uyar.

Buradaki her sayı ölçülmüştür. Ölçülmemiş bir iddia bu dosyaya girmez.

---

## [1.0.0] — 2026-09-06

Türkiye'nin **81 ilinin tamamında gerçek coğrafi kapsam**. Bundan önceki
sürümler bir demoydu; bu, kullanılabilir bir ürün.

### Kapsam

- **81/81 il**, her biri kendi resmî OSM idari sınırından (`admin_level=4`)
  çekildi. Önceki yaklaşım il merkezine çizilmiş ~12×12 km'lik kutulardı ve
  ülkenin **yalnızca %2,2'sini** görüyordu; Alanya gibi 350 bin nüfuslu
  ilçelerde 25 km içinde tek sonuç yoktu.
- **167.829 benzersiz mekan** (önceki sürümde 47.474).
- **973 ilçe merkezinin 973'ünün 15 km'si içinde veri var (%100)**. Aynı
  ölçüm eski veride 973'te 163'tü (%16,8).
- İlçe ataması artık `addr:district` etiketine değil **gerçek ilçe
  sınırlarına** dayanıyor: her mekanın koordinatı `admin_level=6`
  poligonlarına karşı nokta-içinde-poligon testinden geçiyor. Etiketten gelen
  oran %3'tü; geometriden gelen oran pratikte tam. Hiçbir sınır poligonuna
  düşmeyen kıyı/sınır kayıtları tahmin edilmiyor, `null` kalıyor.

### Performans

Veri 3,5 katına çıkarken açılış hızlandı. Üretim derlemesinde ölçüldü:

| | Önce | Sonra |
|---|---|---|
| Ana sayfa (soğuk) | 1.065–2.484 ms | **14 ms** |
| İl içi yarıçap sorgusu (soğuk) | 1.163 ms + tam yükleme | **155–177 ms** |
| Aynı sorgu (sıcak) | — | **20 ms** |
| Sunucu RSS | 433 MB × 2 modül grafiği | **~103 MB** |
| `/api/places` yanıtı | 184 KB (sıkıştırmasız) | **13 KB** (gzip) |

Anlık görüntü artık **tembel** okunuyor: açılışta yalnızca 18 KB'lık
`meta.json`, sorgu geldiğinde yalnızca kutusuyla kesişen il dosyaları.
512 MB'lık bir container rahat yetiyor.

### Güvenlik

Bağımsız incelemelerin bulduğu ve kapatılan açıklar:

- **Konsensüs atlatma:** doğrulama hız sınırı ham URL metnine anahtarlıydı;
  aynı UUID'nin farklı yazımları (büyük harf, tiresiz, `urn:uuid:`) ayrı kova
  alıyordu. Tek adres iki istekle herhangi bir mekanın bilgisini
  değiştirebiliyordu.
- **IPv6 kimlik:** sınır /128'e anahtarlıydı; bir hane kendi /64'ünde 2^64
  adres döndürebildiği için tüm adres-başına sınırlar süsten ibaretti.
- **Kimliksiz yazma yetkiyi eziyordu:** token'sız bir "burada" bildirimi,
  token'lı bir admin kararını (`permanently_closed`) geri alıyordu.
- **Rapor taşkını:** raporlar kimlik değil satır sayıyordu; üç istekle bir
  mekanın güvenilirlik skoru dibe çekilebiliyordu.
- **Sınırsız yanıt:** `?limit=-1` tüm veri kümesini (42 MB) döndürüyordu.
- **Sınırsız gövde/alan:** halka açık yazma uçlarında gövde ve metin alanı
  üst sınırı yoktu.
- Admin fren mekanizması artık tek bir uçta değil `checkAdminAuth` içinde;
  her admin yüzeyi otomatik korunuyor, kilitliyken doğru tahmin bile 429
  alıyor.

### Dürüstlük

- **Uydurma doğrulama geçmişi kaldırıldı.** Sürüm öncesinde her kaydın
  "N kişi doğruladı · X gün önce doğrulandı" etiketi mekan id'sinin
  hash'inden üretiliyor ve yeşil onay işaretiyle gösteriliyordu. Anlık
  görüntüde zaman damgası yok; sayaçlar artık sıfırdan başlıyor ve onay
  işareti yalnızca gerçek bir doğrulama olduğunda çıkıyor.
- Sonuç kartları artık **il ve ilçeyi** gösteriyor; ulusal ölçekte 900 km
  uzaktaki bir sonucu ayırt etmenin başka yolu yoktu.
- OpenStreetMap atfı (ODbL yükümlülüğü) her durumda görünür yerde; önceden
  200 kartın altında kalıyor ve boş/hata durumlarında hiç görünmüyordu.

### Arama

- **Kelime-başı eşleşmesi.** Arama indeksi boşlukları koruyor; "Bolu" artık
  "Tirebolu"yu getirmiyor. Kısmi yazım çalışmaya devam ediyor ("kadik" →
  Kadıköy).
- Sorgu haritanın merkezine bağlandı: şehir değiştirmek sonuçları da
  değiştiriyor.
- Sorgudan düşürülen bir **il adı** varsa uygulama bunu bir eylemle söylüyor
  ("Sonuçlar İstanbul çevresinden — Sivas'a git").

### Altyapı

- `scripts/fetch_by_district.py` — il sınırından çekim + geometrik ilçe
  ataması, il bazında checkpoint, `--only-missing` ile kesintiden devam.
- `scripts/build_dataset_meta.mjs` — `meta.json` ve `place-index.json`
  üretir; ikisi de türetilmiş veridir ve bayat kalırlarsa hem `npm test` hem
  doğrulama betiği kırmızı olur.
- `scripts/validate_places_data.mjs` — şema, Türkiye sınırları, mükerrer OSM
  id, yayılım **ve ilçe kapsamı**. Kapsam ölçümünün yokluğu, "81 il"in
  ülkenin %2,2'si demek olmasına izin veren şeydi.
- CI iki iş akışı: frontend (lint, tip, 161 test, build) ve backend (85 test,
  gerçek Postgres+PostGIS). Backend işinde **herhangi bir testin skip olması
  build'i kırar** — "yeşil ama koşmadı" tuzağı bir kez gerçekten yaşandı.
- Migration zinciri artık sütun düzeyinde de doğrulanıyor (migration'ın
  kurduğu şemaya karşı autogenerate farkı).
- `docs/dagitim.md` (dağıtım runbook'u), `SECURITY.md`, `.env.*` her derinlikte
  `.gitignore`'da.

### Bilinen sınırlar

- Frontend henüz FastAPI backend'ini çağırmıyor; aradaki sözleşme farkları
  [docs/api-sozlesme-farklari.md](docs/api-sozlesme-farklari.md) içinde açıkça
  listeli.
- Mekanların yalnızca **%1,81**'inde çalışma saati var. "Kapalıları gizle"
  filtresi bu yüzden yalnızca *kapalı olduğu bilinenleri* eler.
- Fotoğraf kapsamı **%0,34**; OSM fotoğrafları yerine topluluk yüklemesi
  planlanıyor.
- Hız sınırlayıcılar bellek içi ve istemciyi proxy başlığından tanır; başlığı
  ezen bir ters proxy arkasında olmak şart (bkz. `docs/dagitim.md`).
