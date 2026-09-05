# Yol Haritası

Bu belge katkıcıların **projenin nerede olduğunu ve nereye gittiğini**
görmesi için var.

Kural: buradaki her "tamamlandı" maddesi depoda çalışan koda dayanır.
Doğrulanmamış hiçbir şey tamamlanmış gibi yazılmamıştır. Bir madde
belirsizse, belirsiz olduğu açıkça yazılıdır.

**Son güncelleme:** 2026-09-04

---

## Durum göstergeleri

| İşaret | Anlamı |
|---|---|
| ✅ | Tamamlandı ve çalışıyor |
| 🚧 | Kısmen var, tamamlanmadı |
| 📋 | Planlandı, başlanmadı |
| ❓ | Karar verilmedi — tartışmaya açık |

---

## ✅ Tamamlanan — v1 demo

### Harita ve keşif
- ✅ Harita birincil çalışma yüzeyi (MapLibre GL JS + OpenFreeMap positron)
- ✅ Kümeleme (cluster) ve tekil işaretçiler
- ✅ Cihaz konumu, "yakınımdakiler", mesafe + yürüme süresi + yön göstergesi
- ✅ "Bu alanda ara" — harita hareketinde otomatik sorgu yok
- ✅ Kategori çipleri ve ızgarası, sonuç sayaçlarıyla
- ✅ Mobil bottom sheet (snap noktalı) + masaüstü sidebar düzeni
- ✅ Paylaşılabilir derin bağlantılar (URL durumu sunucuda ayrıştırılıyor)
- ✅ Kayıtlı yerler (cihazda kalır, sunucuya gitmez)

### Veri modeli
- ✅ Çok kategorili mekan (bir park aynı anda park + çocuk alanı + su olabilir)
- ✅ 14 kategori; 5'i Türkiye'ye özgü (cami, eczane, acil toplanma alanı,
  kütüphane, elektrikli şarj)
- ✅ Özellikler `boolean | null` — `null` "bilinmiyor", "yok" değil
- ✅ Erişim kısıtı modeli (`public` / `customers` / `permit` / `private`)
- ✅ Güvenilirlik skoru, tazelik etiketi, kaynak atfı

### Arama
- ✅ Türkçe doğal dil araması (yapılandırılmış filtrelere çözümleme)
- ✅ Sondan eklemeli dil desteği (son ek kalıplarıyla, kelime listesiyle değil)
- ✅ Ünsüz yumuşaması (çocuk → çocuğ-, köpek → köpeğ-)
- ✅ Zayıf/güçlü kural önceliği ("elektrikli araç şarj" otopark getirmiyor)
- ✅ Kademeli genişletme — sonuçsuz kalmak yerine en kısıtlayıcı filtreyi
  bırakıp bunu söylüyor
- ✅ Diakritiğe duyarsız arama ("kadikoy" = "Kadıköy")
- ✅ İlçe/il farkındalıklı arama, kanonik yazım çözümlemesiyle
- ✅ Cevaplanamayan sorularda dürüstlük ("nöbetçi eczane" → resmî kaynağa
  yönlendirme)

### Filtreler
- ✅ Özellik filtreleri (`null` asla eşleşmez)
- ✅ "Kapalıları gizle" — yalnızca kapalı olduğu bilinenleri eler
- ✅ "Ücretsiz"
- ✅ Facet sayaçları — her filtrenin kaç sonuç bırakacağı çipte yazıyor
- ✅ Sıralama: en yakın / en güvenilir

### Katkı ve moderasyon
- ✅ Mekan öner
- ✅ Yanlış bilgi bildir / kapanmış bildir
- ✅ Tek dokunuşla yerinde doğrulama ("Evet, burada")
- ✅ Yönetim paneli: mekan arama, düzenleme, durum değiştirme, kaynağa geri alma
- ✅ Moderasyon kuyruğu: onayla / reddet
- ✅ **Uçtan uca döngü**: öneri → onay → haritada görünür
- ✅ Kalıcı silme yok — `permanently_closed` durumu

### İdari yapı
- ✅ 81 il referans tablosu (plaka kodu + büyükşehir işareti)
- ✅ İlçe adı çözümleyici (Türkçe katlama, yeniden adlandırmalar, ilçe sanılan
  mahalleler)
- ✅ Birleşik "İlçe/İl" etiketlerinin ayrıştırılması
- ✅ Kapsam göstergesi ("81 ilin 9 tanesi")

### Veri
- ✅ 9 il / **18.974** gerçek OpenStreetMap mekanı
  (İstanbul, Ankara, İzmir, Antalya, Bursa, Adana, Konya, Gaziantep, Trabzon)
- ✅ Overpass veri boru hattı: il+kategori bazında checkpoint, üstel geri
  çekilme, çok aynalı
- ✅ İl başına ayrı anlık görüntü dosyası — il eklemek bir config satırı
- ✅ Harita merkezleri verinin kendisinden türetiliyor (elle tablo yok)

### Çevrimdışı ve performans
- ✅ Service worker: uygulama kabuğu, harita karoları ve son sonuçlar
  çevrimdışı çalışıyor
- ✅ Çevrimdışı yanıtlar **etiketleniyor** — kullanıcı verinin eski
  olabileceğini görüyor
- ✅ PWA manifest (ana ekrana eklenebilir)
- ✅ Ölçülen: LCP 168 ms · CLS 0,00 · API 15–36 ms

### Kalite
- ✅ Lighthouse: erişilebilirlik 100, best practices 100, SEO 100
- ✅ 123 frontend testi (Vitest)
- ✅ 0 TypeScript hatası, 0 ESLint hatası

---

## 🚧 Kısmen tamamlanan

### Backend (FastAPI + PostgreSQL/PostGIS)
- ✅ Modeller, Pydantic şemaları, API route'ları, servisler (dedup,
  moderation, reliability, search), veri alım modülleri **yazıldı**
- ✅ `docker-compose.yml` ile PostGIS servisi tanımlı
- ✅ pytest test dosyaları mevcut; CI'da gerçek PostGIS servisiyle koşuyor
- 🚧 **Backend hiç canlı veritabanına karşı çalıştırılmadı.** Geliştirme
  ortamında Docker/Postgres yoktu. Kod doğru API'lere karşı yazıldı ama
  yerelde koşturulmadı.
- 🚧 **Gerçek Alembic migration'ı yok** — şema `create_all` ile kuruluyor
- 🚧 Frontend'in son eklediği alanların (`access`, `district`, `province`,
  `facets`, `applied.notices`) backend şemasındaki karşılığı **doğrulanmadı**

### Demo ↔ backend geçişi
- ✅ Demo API route'ları backend'le aynı sorgu sözleşmesini uyguluyor
- 🚧 "Taban-URL değişikliğiyle geçiş" tasarımı **test edilmedi**

### Türkiye kapsamı
- ✅ 9 il
- 📋 Kalan 72 il — boru hattı hazır, yalnızca çekim süresi gerekiyor

---

## 📋 Planlanan — öncelik sırasıyla

### Yüksek öncelik: güvenlik

- ✅ **`/api/admin/*` route'larına kimlik doğrulama** — paylaşılan-sır
  token (`BURADANE_ADMIN_TOKEN`), sabit zamanlı karşılaştırma, fail-closed.
  Panel token'ı sekme ömrü boyunca `sessionStorage`'da tutar.
- ✅ **Katkı gönderiminde hız sınırı** — IP başına kayan pencere
  (10 istek / 10 dk), 429 + `Retry-After`.
- 🚧 Yönetim panelinin **görüntülenmesi** hâlâ açık (kuyruk sunucuda render
  ediliyor); okuma tarafını da kapatmak çerez tabanlı oturum ister.
- 📋 **Backend'de varsayılan JWT sırrının kaldırılması.**
  `backend/app/core/config.py` içinde çalışan bir varsayılan var
  (`dev-secret-change-in-production`).

### Yüksek öncelik: dayanıklılık

- ✅ **React error boundary'leri** — `error.tsx` (digest kodlu, tekrar dene +
  haritaya dön), `global-error.tsx` (kök layout çöktüğünde token'sız çalışır),
  `not-found.tsx`.
- ✅ **`contributions.json` yazım güvenliği** — tüm oku-değiştir-yaz
  işlemleri tek kuyruğta serileşiyor; yazım atomik (geçici dosya + rename).
  Testler yazarken paylaşılan-mutable-varsayılan kaynaklı gerçek bir durum
  sızıntısı da bulundu ve kapatıldı.

### Yüksek öncelik: erişilebilirlik

- ✅ **Haritada klavye ve ekran okuyucu erişimi** — canvas'tan sonra tek bir
  durak (skip-link deseni): ok tuşları görünür işaretçilerde dolaşır, Enter
  seçer, `aria-live` duyurur, harita her adımda işaretçiye kayar. MapLibre'nin
  kendi canvas kısayollarına (ok = kaydır, +/- = yakınlaştır) dokunulmadı.

### Orta öncelik

- ✅ **Sunucuda render edilen mekan sayfaları** (`/yer/[id]`) — gerçek
  başlık/açıklama, mekana özel OG görseli (kategori renginde, tipografik),
  `robots.ts` ve adlı mekanlarla sınırlı `sitemap.ts` (~9.800 kayıt; isimsiz
  binlerce "Umumi Tuvalet" sayfası bilinçli olarak listelenmiyor).
- 📋 **Frontend CI** — lint, tip kontrolü, test ve build'in PR'da otomatik
  koşması *(bu yol haritası yazılırken eklendi, bkz. `.github/workflows/`)*
- ✅ **Mükerrer öneri tespiti** — öneri gönderilmeden önce 150 m içinde aynı
  türden kayıtlar aranır ve gösterilir; "Bu o" mevcut kaydı **doğrulamaya**
  çevirir (tazelik sinyali), "Hayır, yeni yer" öneriyi yine de gönderir.
  Kontrol bir kapı değil: başarısız olursa öneri normal yoldan geçer.
- 📋 **Kalan 72 il** için veri çekimi
- 📋 **Gerçek ilk Alembic migration'ı**

### Düşük öncelik / ileride

- 📋 Topluluk fotoğraf yüklemesi *(OSM'de fotoğraf kapsamı ölçüldü: %2,3 —
  bu yüzden OSM fotoğrafları yerine topluluk yüklemesi düşünülüyor)*
- 📋 Telemetri / analitik — şu an ne arandığı bilinmiyor
- 📋 Production dağıtımı (hosting kararı verilmedi)

---

## ❓ Karar verilmemiş — tartışmaya açık

Bunlar **plan değil, açık sorulardır.** Fikrin varsa issue aç.

- ❓ **Çok dillilik.** v1 kapsamı Türkiye ve Türkçe. Turist kullanımı gerçek
  bir ihtiyaç ama kapsam kararı verilmedi.
- ❓ **Uygulama içi rota çizimi.** Şu an harici yol tarifi bağlantısı
  kullanılıyor. Gerçek rota motoru büyük bir bağımlılık getirir.
- ❓ **`has_ramp` ve `is_quiet` alanlarının geleceği.** Modelde varlar ama
  OSM'de veri kaynağı yok (`ramp` etiketi mevcut anlık görüntüde hiç geçmiyor).
  Topluluk katkısıyla dolar mı, kaldırılmalı mı?
- ❓ **`frontend/data/*.json` dosyalarının depoda tutulması.** ~15 MB ve 81
  ile büyüyecek. Depoda tutmak katkıcı için kolaylık, klon boyutu için yük.
- ❓ **Mobil uygulama.** PWA yeterli mi, native gerekir mi?

---

## Katkı yapmak istiyorum, nereden başlayayım?

- `good first issue` etiketli issue'lara bak
- Yukarıdaki 📋 maddelerinden biri ilgini çekiyorsa issue aç ve söyle
- Kendi ilinin verisini eklemek en kolay ve en görünür katkıdır
  ([CONTRIBUTING.md](CONTRIBUTING.md#️-veri-ve-openstreetmap))
- Bir hata bulduysan, düzeltmesen bile bildirmen değerlidir

Süreç: [CONTRIBUTING.md](CONTRIBUTING.md) ·
Proje kuralları: [CLAUDE.md](CLAUDE.md)
