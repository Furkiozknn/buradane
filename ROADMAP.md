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
- ✅ Kapsam göstergesi ("81 ilin N tanesi" — sayı veriden hesaplanır)
- ✅ **973 ilçelik resmî referans listesi** OSM `admin_level=6` sınırlarından
  indi (`frontend/data/admin-divisions.json`, 81/973 tam); testler sayıyı ve
  adları plaka tablosuyla çapraz doğruluyor. Sunucu tarafında
  `admin-divisions.ts` ilçe adlarını kanonikleştiriyor.

### Veri
- ✅ 44 il / **36.637** gerçek OpenStreetMap mekanı (2026-09-05 tabanı);
  kalan iller arka planda il il iniyor - bkz. aşağıdaki 🚧
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
- ✅ 143 frontend testi (Vitest) + 81 backend testi (pytest, DB'li kısmı CI'da)
- ✅ 0 TypeScript hatası, 0 ESLint hatası

---

## 🚧 Kısmen tamamlanan

### Backend (FastAPI + PostgreSQL/PostGIS)
- ✅ Modeller, Pydantic şemaları, API route'ları, servisler (dedup,
  moderation, reliability, search), veri alım modülleri **yazıldı**
- ✅ `docker-compose.yml` ile PostGIS servisi tanımlı
- ✅ pytest test dosyaları mevcut; CI'da gerçek PostGIS servisiyle koşuyor
- ✅ **Backend CI'da gerçek Postgres+PostGIS'e karşı koşuyor** — migration
  döngüsü (upgrade → downgrade → upgrade), yarış testleri ve model/migration
  eşitlik kontrolü dahil. Geliştirme makinesinde Docker olmadığı için
  yerelde bu testler skip eder; "yerelde geçti" DB testlerinin koştuğu
  anlamına gelmez.
- ✅ **Baseline Alembic migration'ı depoda**
  (`backend/alembic/versions/a237a92362fc_baseline_full_v1_schema.py`);
  şema artık `create_all`'a değil migration zincirine dayanıyor
- ✅ Frontend ↔ backend sözleşmesi **alan alan karşılaştırıldı** — sonuç:
  [docs/api-sozlesme-farklari.md](docs/api-sozlesme-farklari.md). Zarf farkı
  (çıplak liste vs `{places,total,applied,facets}`), id şeması farkı
  (UUID vs OSM ref), listede eksik alanlar (`access`, `district`,
  `amenities`, `source`...), eksik parametreler (`q`, `open_now`, `sort`)
  ve kapanış sırası orada.

### Demo ↔ backend geçişi
- 🚧 "Taban-URL değişikliğiyle geçiş" vaadi **bugün geçerli değil** — farklar
  ve önerilen kapanış sırası: [docs/api-sozlesme-farklari.md](docs/api-sozlesme-farklari.md).
  Gerçekçi ilk hedef: Next.js API route'larının backend'i çağıran ince bir
  uyarlama katmanına dönüşmesi.

### Türkiye kapsamı
- ✅ 44 il indi ve doğrulandı (2026-09-05 tabanı; güncel liste şehir
  seçicisinde)
- 🚧 Kalan iller — bbox'lar OSM'in kendi il-merkezi çapalarından üretiliyor
  (`scripts/fetch_admin_divisions.py` + sentezlenmiş yapılandırma), ulusal
  çekim `--only-missing` ile il il sürüyor
- ✅ 973 ilçelik resmî liste indi ve testlerle doğrulandı (81 il / 973 ilçe
  tam; ad çapraz kontrolü dahil)

---

## 📋 Planlanan — öncelik sırasıyla

### Yüksek öncelik: güvenlik

- ✅ **`/api/admin/*` route'larına kimlik doğrulama** — paylaşılan-sır
  token (`BURADANE_ADMIN_TOKEN`), sabit zamanlı karşılaştırma, fail-closed.
  Panel token'ı sekme ömrü boyunca `sessionStorage`'da tutar.
- ✅ **Katkı gönderiminde hız sınırı** — IP başına kayan pencere
  (10 istek / 10 dk), 429 + `Retry-After`.
- ✅ **Moderasyon kuyruğunun okunması da token'lı** — kuyruk artık sunucuda
  render edilmiyor; panel token doğrulandıktan sonra `GET /api/contributions`
  üzerinden çeker ve o uç da admin token'ı ister. `/admin` sayfası token
  girilmeden yalnızca giriş kapısını (`AdminTokenGate`) gösterir; katkı
  içerikleri (notlar, adlar) sunucu yanıtında yer almaz — yalnızca sayısal
  agregalar (bekleyen/toplam sayısı) token'sız görünür kalır, bilinçli.
- ✅ **Başarısız admin yetkilendirmelerine paylaşılan fren** — fren tek tek
  route'larda değil `checkAdminAuth`'un içinde yaşar: HERHANGİ bir admin
  yüzeyine (probe, kuyruk okuma, mutasyonlar) dakikada 10'dan fazla
  başarısız deneme yapan adres 429 + `Retry-After` alır; kilitliyken doğru
  tahmin bile 429 döner (kilit, isabet onayına dönüşemez). Geçerli token'lı
  trafik bütçe harcamaz. Dürüst sınır: istemci anahtarı proxy
  başlıklarından gelir (`x-forwarded-for`), yani bu fren ancak başlıkları
  ezen bir proxy'nin arkasında gerçek kimliğe dayanır; çıplak `next start`
  önünde "ucuz taramayı pahalılaştırır", kriptografik güvence vermez
  (`rate-limit.ts` bunu açıkça söyler).
- 🚧 **Backend'de varsayılan JWT sırrı** — iki katman: bootstrap admin
  varsayılan sır altında **oluşturulmayı reddediyor** (`services/bootstrap.py`,
  asıl kontrol) ve her başlangıçta uyarı basılıyor (`app/main.py`, mevcut-admin
  + varsayılan-sır sessiz vakası için sinyal; bir merge'de bir kez kayboldu,
  artık regresyon testi kilitli). Tam kaldırma (üretimde başlatmayı reddetme)
  bir "ortam" kavramı gerektiriyor ve dağıtım kararıyla birlikte verilecek.

### Yüksek öncelik: dayanıklılık

- ✅ **React error boundary'leri** — `error.tsx` (digest kodlu, tekrar dene +
  haritaya dön), `global-error.tsx` (kök layout çöktüğünde token'sız çalışır),
  `not-found.tsx`.
- ✅ **`contributions.json` yazım güvenliği** — tüm oku-değiştir-yaz
  işlemleri tek kuyruğta serileşiyor; yazım atomik (geçici dosya + rename).
  Testler yazarken paylaşılan-mutable-varsayılan kaynaklı gerçek bir durum
  sızıntısı da bulundu ve kapatıldı.
- ✅ **Rapor kararında yarış koşulu kapalı** — `PATCH /reports/{id}` rapor ve
  mekan satırlarını kilitleyerek (`SELECT ... FOR UPDATE`) çalışır; aynı
  rapora eşzamanlı iki karar artık çift etki üretemez, ikincisi 409 alır
  (iki gerçek bağlantıyla kanıtlayan test: `test_report_resolution_race.py`).
- ✅ **Doğrulama konsensüsü token rotasyonuna dayanıklı** — cihaz token'ı
  istemci ürettiği için "farklı katılımcı" kanıtı değildir; IP+mekan başına
  doğrulama bütçesi konsensüs eşiğinin altında tutulur (`consensus-1`) ve
  kovanın dolum penceresi konsensüsün kendi penceresine
  (`stale_after_days`) eşitlenmiştir — saatte bir token değiştiren sabırlı
  rotasyon da eşiğe ulaşamaz (bunu ilk sürüm kaçırmıştı; adversarial
  inceleme yakaladı, test artık saatlik sabrı da deniyor). Bilinçli bedel:
  aynı CGNAT adresi arkasındaki iki gerçek hane aynı mekanı aynı pencerede
  doğrulayamaz — konsensüs farklı ağdan gelmek zorunda.
- 📋 **Konsensüste kimliği IP'ye de bağlamak** — doğrulama kayıtlarına
  sunucu-türevi bir adres hash'i ekleyip (migration gerektirir) distinct
  sayımı ona da bakar yapmak, yukarıdaki CGNAT bedelini kaldırmanın doğru
  yolu; hız sınırı o zaman gevşeyebilir.

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
- ✅ **CI iki iş akışıyla koşuyor** — Frontend (lint, tip kontrolü, 145
  test, build) ve CI (backend, gerçek Postgres+PostGIS servisiyle 82 test);
  backend işinde herhangi bir testin skip olması artık build'i kırar —
  "yeşil ama koşmadı" tuzağı bir kez gerçekten yaşandı ve kapatıldı.
- ✅ **Mükerrer öneri tespiti** — öneri gönderilmeden önce 150 m içinde aynı
  türden kayıtlar aranır ve gösterilir; "Bu o" mevcut kaydı **doğrulamaya**
  çevirir (tazelik sinyali), "Hayır, yeni yer" öneriyi yine de gönderir.
  Kontrol bir kapı değil: başarısız olursa öneri normal yoldan geçer.
- 🚧 **Kalan iller** için veri çekimi (ulusal çekim sürüyor — bkz. "Türkiye
  kapsamı")

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
