# buradane

**"Burada ne var?"** — Türkiye'deki kamusal ve ihtiyaç alanlarını (tuvalet,
park, içme suyu, spor alanı, cami, kütüphane, otopark, toplanma alanı ve
daha fazlası) keşfetmeye yarayan, ihtiyaç-odaklı bir kamusal alan bulma
platformu.

Bu, "küçük bir Google Haritalar" değildir. Amaç genel amaçlı harita değil,
**"Şu anda neye ihtiyacım var ve bunu en yakın nerede bulabilirim?"**
sorusuna hızlı ve güvenilir cevap vermek.

İki parçadan oluşuyor: prod hedefi olan bir **FastAPI + PostGIS backend'i**
ve bugün gerçek OpenStreetMap verisiyle uçtan uca çalışan, bağımsız bir
**Next.js + MapLibre GL JS demo arayüzü**. İkisi kasıtlı olarak aynı sorgu
sözleşmesini konuşuyor (bkz. "Mimari") - demo, backend hazır olduğunda ona
bağlanacak şekilde tasarlandı.

Ürünün cevaplamaya çalıştığı iki soru var ve arayüz ikisine göre kuruldu:
**"hangi yöne gideyim?"** (her sonuçta kuzeye göre yön oku + mesafe + yürüme
süresi) ve **"bu bilgi hâlâ doğru mu?"** (tek dokunuşla "Evet, burada"
doğrulaması, tazelik etiketi, kaynak ve güvenilirlik skoru).

> **Demo ekran görüntüsü:** Henüz eklenmedi. Aşağıdaki "Hızlı Başlangıç →
> Frontend" adımlarıyla demoyu yerelde çalıştırıp **18.974 gerçek
> OpenStreetMap mekanı** (İstanbul 6.481, Ankara 2.654, İzmir 2.271,
> Antalya 1.668, Bursa 1.416, Adana 1.310, Konya 1.293, Gaziantep 983,
> Trabzon 898) üzerinde harita ve liste arayüzünü görebilirsiniz.

## v1 Kapsamı

v1 **sadece Türkiye** içindir. Mimari ülke-agnostik tasarlandı (bkz.
`AdminRegion`, `Place.country_code`, `Settings.active_country`) ama kod
içinde hiçbir yerde "Turkey" sabiti hardcode edilmedi - ileride başka bir
ülke eklenmek istenirse bu bir mimari değişiklik değil, bir konfigürasyon +
veri yükleme işi olacak. Şu an için tek aktif ülke Türkiye.

**Pilot sıra**: İstanbul → Ankara/İzmir → Antalya/Bursa/Kocaeli/Adana/
Gaziantep/Konya → geri kalan 81 il. Altyapı (idari hiyerarşi, veri modeli)
81 ilin tamamını gün 1'den itibaren destekler; sadece veri doldurma bu
sırayla ilerler.

Demo şu an **üç şehrin** çekirdek alanını kapsıyor (İstanbul, Ankara,
İzmir). Her şehir kendi `places.<şehir>.json` dosyasında; okuma tarafı
klasörü tarayarak hepsini yüklüyor, yani **dördüncü şehri eklemek bir
konfigürasyon satırı + bir çekim koşusu** (bkz. "Veri Pipeline"), kod
değişikliği değil.

## Hızlı Başlangıç

### Backend

Gereksinimler: [uv](https://docs.astral.sh/uv/), Docker (yerel Postgres+PostGIS için).

```bash
cd backend
uv sync

# Yerel veritabanını başlat (Postgres + PostGIS)
docker compose up -d

# Şemayı oluştur (henüz gerçek bir Alembic migration'ı yok - bkz. "Bilinen Sınırlamalar")
uv run python -c "from app.core.db import Base, engine; import app.models; Base.metadata.create_all(engine)"

# Başlangıç kategorilerini yükle (~55 kategori, 10 grup altında)
uv run python -m app.ingest.seed_categories

# Türkiye idari hiyerarşisini yükle (81 il + ilçeler - TurkiyeAPI'den)
uv run python -m app.ingest.turkiye_api

# (İsteğe bağlı) İstanbul pilot verisini OpenStreetMap'ten çek
uv run python -m app.ingest.osm_overpass

# API'yi çalıştır
uv run uvicorn app.main:app --reload
```

Ortam değişkenleri `BURADANE_` önekiyle okunur (`.env` dosyası veya gerçek
ortam değişkeni olarak) - bkz. `app/core/config.py`:

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `BURADANE_DATABASE_URL` | `postgresql+psycopg://buradane:buradane@localhost:5432/buradane` | `docker-compose.yml`'deki varsayılanlarla eşleşir |
| `BURADANE_ACTIVE_COUNTRY` | `TR` | Aktif ülke (ISO 3166-1 alpha-2) |
| `BURADANE_JWT_SECRET` | `dev-secret-change-in-production` | **Prod'da mutlaka değiştirilmeli** |
| `BURADANE_STALE_AFTER_DAYS` | `90` | Bir doğrulama/rapor kaç gün sonra "bayat" sayılır (güvenilirlik skoruna girer) |
| `BURADANE_CORS_ORIGINS` | `["http://localhost:3000"]` | Frontend origin'i |

### Frontend (demo)

Gereksinimler: Node.js + npm.

```bash
cd frontend
npm install

# Geliştirme sunucusu - predev script'i MapLibre worker dosyalarını
# otomatik olarak public/maplibre/ altına kopyalar (bkz. "Bilinen Tuhaflıklar")
npm run dev
```

`http://localhost:3000` adresinde açılır. Demo verisi
(`frontend/data/places.*.json`, dokuz il / 18.974 gerçek OSM mekanı, ~15 MB)
repoyla birlikte gelir - sadece demoyu denemek için "Veri Pipeline"
adımlarını tekrar koşmanız gerekmez, onlar yalnızca anlık görüntüyü
yenilemek ya da yeni bir şehir eklemek istediğinizde gerekli.

Production derlemesi:

```bash
npm run build
npm run start
```

Testler:

```bash
npm test          # Vitest, tek koşu
npm run test:watch
npm run lint      # ESLint
```

Test kapsamı bilinçli olarak **saf mantık katmanına** odaklı: sorgu motoru,
çalışma saati ayrıştırıcısı, geo hesapları, Türkçe metin normalizasyonu ve URL
durumu. Bu projede şimdiye kadar çıkan gerçek regresyonların tamamı bu
katmandaydı (bir doğrulamanın güvenilirlik puanını *düşürmesi*, "KADIKÖY"
ile "Kadıköy"ün eşleşmemesi, artakalan sorgu kelimelerinin sonucu sıfırlaması,
"çocuğumla" kelimesinin "çocuk" olarak tanınmaması), React ağacında değil.

## Mimari

### Neden bu mimari? (backend)

| Karar | Neden |
|---|---|
| **FastAPI + SQLAlchemy 2.0 + PostgreSQL/PostGIS (GeoAlchemy2 + psycopg3)** | Yakındaki-yer ve harita-görünümü sorguları gerçek coğrafi indeksleme gerektirir; Python tarafında haversine döngüsüyle bu Türkiye ölçeğinde ölçeklenmez. |
| `Geography` tipi (`Geometry` değil) | `ST_Distance`/`ST_DWithin` gerçek metre cinsinden, manuel SRID dönüşümü olmadan doğru sonuç verir. |
| GiST indeks (`ix_places_location`) | Yarıçap ve bbox (harita görünümü) sorgularını tam-tablo taramasından kurtarır. |
| **Kategori (many-to-many) + amenity (ilk sınıf nullable-bool sütun) ayrımı** | Bir yer aynı anda birden fazla kategoriye ait olabilmeli (park + oyun parkı + tuvalet); "engelli erişimli tuvalet" gibi her özelliği ayrı kategori yapmak kombinatoryal patlamaya yol açar. Bkz. `app/models/place.py` ve `app/models/category.py` docstring'leri. |
| `bool \| None` (asla düz `bool` değil) her amenity alanında | "Bilinmiyor" hiçbir zaman "hayır" olarak gösterilemez. |
| Kendine-referanslı `AdminRegion` tablosu | İl→ilçe→mahalle/köy derinliği şemaya değil veriye bağlı - sınır/isim değişikliklerinde migration gerekmez, yeniden seed edilir. |
| `DataSource` + `PlaceSourceRecord` + dedup servisi | Aynı gerçek yer birden fazla kaynaktan (OSM + belediye + kullanıcı) geldiğinde tek bir kanonik `Place`'e birleşir, asla mükerrer gösterilmez. |
| Moderasyon kapılı yazma yolları | Kullanıcı önerisi `pending_review`, rapor `pending` durumunda başlar - hiçbir kullanıcı girdisi doğrudan yayına düşmez. |
| Hesap zorunlu değil (`user_id` her yerde nullable) | Gizlilik-öncelikli: keşif de, katkı da hesapsız yapılabilir. |

### Neden bir demo veri adaptörü var? (frontend)

Frontend'in bir Postgres/Docker kurulumu olmadan, tek komutla ayağa
kalkabilmesi gerekiyordu - hem hızlı iterasyon hem de demoyu paylaşmak
için. `frontend/src/lib/places-repository.ts`, `scripts/fetch_demo_data.py`
çıktısı olan gerçek OSM anlık görüntülerini (`frontend/data/places.*.json`,
her şehir için bir dosya) okuyup backend'in `GET /places`
ucuyla **birebir aynı sorgu sözleşmesini** (yarıçap/bbox arama, çoklu
kategori/amenity filtresi, serbest metin arama, sayfalama, aynı yanıt
şekli) uygular. Next.js API route'ları (`frontend/src/app/api/places/
route.ts` vb.) bu modülü çağırır; üstündeki hiçbir kod (`MapCanvas`,
`AppShell`, ...) bu adaptörün varlığından haberdar değildir, sadece
`/api/places`'i bilir. Bu yüzden demoyu gerçek backend'e bağlamak, route
handler'ların içindeki tek bir modülü değiştirmek - yani bir taban-URL
değişikliği - kadar küçük bir iş olacak şekilde tasarlandı.

Demonun gerçek bir topluluk geçmişi yok (henüz kimse ölçekte bir yeri
doğrulamadı/raporlamadı), o yüzden `reliability_score` /
`verification_count` / `freshness_label` alanları rastgele değil, **her OSM
kaydının ne kadar eksiksiz olduğundan** (isim, çalışma saati, adres,
tekerlekli sandalye etiketi, operatör, iletişim bilgisi) türetilen
deterministik bir fonksiyonla (`deriveCommunitySignals`,
`places-repository.ts`) üretiliyor - aynı girdi her zaman aynı sonucu
verir, sayfa yenilendikçe numaralar oynamaz. Bu, gerçek kullanıcı
aktivitesiyle karıştırılmaması gereken, açıkça bayraklanmış üretilmiş
veridir - bkz. "Bilinen Sınırlamalar".

### Harita render yaklaşımı (frontend)

Harita, binlerce noktayı DOM marker'ları yerine tek bir GeoJSON kaynağı +
sembol katmanıyla (`icon-image`) render eder - her kategori için önceden
çizilip `map.addImage` ile kaydedilen bir pin görseli kullanılır, bu da ana
thread'i bloklamadan ölçeklenir. Yakın noktalar `clusterRadius: 52` ile
kümelenir; bir kümeye tıklamak `getClusterExpansionZoom` ile o kümenin
içine yakınlaştırır. Düşük güvenilirlikli kayıtlar (`reliability_score <
0.5`) haritada gizlenmez, sadece soluk (`icon-opacity: 0.62`) gösterilir -
kullanıcı hâlâ görür, kart neden "zayıf" göründüğünü açıklar. Kullanıcının
kendi konumu, nabız animasyonlu tek bir DOM marker'ı ile ayrıca gösterilir
(bir sembol katmanının ifade edemeyeceği tek özel durum). Alt sayfa (bottom
sheet, `vaul` tabanlı) açıkken harita `setPadding` ile görünür alanı
sayfanın üstünde ortalar. Taban harita OpenFreeMap'in ücretsiz, API
anahtarı gerektirmeyen "positron" stili - bilinçli olarak sade/gri:
haritadaki her renk 14 kategori pin'ine ait, canlı bir taban harita yoğun
bir sonuç kümesini okunmaz hale getirirdi.

### Proje Yapısı

```
buradane/
├── backend/                 # FastAPI API (prod hedefi)
│   ├── app/
│   │   ├── models/           # SQLAlchemy ORM (Place, Category, AdminRegion, DataSource, User, ...)
│   │   ├── schemas/          # Pydantic API sözleşmesi (DB şemasından kasıtlı olarak ayrı)
│   │   ├── services/         # reliability (güvenilirlik skoru), search, dedup, moderation
│   │   ├── api/               # FastAPI router'ları
│   │   └── ingest/            # PostGIS'e yazan üretim veri yükleyicileri
│   ├── docs/
│   │   └── DATA_SOURCES.md   # Her veri kaynağının lisansı, güncelliği, güvenilirlik ağırlığı
│   ├── tests/
│   ├── alembic/
│   └── docker-compose.yml
├── frontend/                 # Next.js demo (gerçek İstanbul OSM verisiyle çalışır)
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── places/route.ts                     # GET /api/places
│   │   │   │   ├── places/[id]/route.ts                # GET /api/places/:id
│   │   │   │   ├── contributions/route.ts               # GET/POST /api/contributions
│   │   │   │   ├── admin/contributions/[id]/route.ts    # PATCH (onayla/reddet)
│   │   │   │   └── admin/places/[id]/route.ts           # PATCH (düzenle) / DELETE (geri al)
│   │   │   ├── admin/page.tsx                # Moderasyon + mekan düzenleme paneli
│   │   │   ├── manifest.ts                    # PWA manifest
│   │   │   └── page.tsx                       # Ana sayfa (URL state'i sunucuda ayrıştırır)
│   │   ├── components/                        # MapCanvas, AppShell, PlaceCard, PlaceDetail, FilterSheet, CategoryPicker, CityPicker, DirectionArrow, AdminPlaceEditor, ...
│   │   └── lib/                                # types, places-repository (demo adaptörü), categories, contributions-store, geo, opening-hours, directions, url-state, use-favorites, use-media-query
│   ├── data/
│   │   ├── places.istanbul.json               # 6.481 gerçek OSM mekanı
│   │   ├── places.ankara.json                 # 2.654
│   │   ├── places.izmir.json                  # 2.271
│   │   └── contributions.json                 # Kullanıcı katkıları + admin override'ları (git'te değil)
│   ├── public/maplibre/                        # MapLibre worker dosyaları (bkz. "Bilinen Tuhaflıklar")
│   └── scripts/copy-maplibre-worker.mjs        # predev/prebuild'de otomatik çalışır
├── scripts/                  # Demo veri pipeline'ı (bkz. "Veri Pipeline") - backend/app/ingest'ten ayrı, PostGIS'e değil düz JSON'a yazar
│   ├── fetch_demo_data.py
│   ├── enrich_demo_data.py
│   └── repair_demo_data.py
└── LICENSE
```

## Veri Pipeline

Demo verisi üç script'in sırayla çalıştırılmasıyla üretildi. Her biri
`frontend/data/places.*.json` dosyalarının **tamamını** okuyup yazıyor,
tekrar çalıştırılabilir (idempotent) şekilde yazıldı. Veri zaten repoda
mevcut olduğu için bunları koşmak sadece anlık görüntüyü yenilemek ya da
yeni bir şehir eklemek istediğinizde gerekli:

```bash
# Tüm şehirler
uv run --no-project python scripts/fetch_demo_data.py
# ya da tek şehir
uv run --no-project python scripts/fetch_demo_data.py --city ankara

uv run --no-project python scripts/enrich_demo_data.py
uv run --no-project python scripts/repair_demo_data.py
```

**Yeni şehir eklemek:** `fetch_demo_data.py`'deki `CITIES` sözlüğüne bir
satır (slug, etiket, bbox, cap ölçeği) ekleyip script'i o şehir için
koşmak yeterli. Okuma tarafı `data/` klasörünü tarayarak yeni dosyayı
kendiliğinden alır; `AppShell`'deki `CITY_CENTERS`'a şehrin merkezi
eklenince şehir seçicide de görünür. Uygulama kodunda başka değişiklik
gerekmez.

1. **`fetch_demo_data.py`** - `CITIES`'te tanımlı her şehrin çekirdek alanı
   için Overpass API'den 14 kategorinin OSM verisini çeker.
   `backend/app/ingest/osm_overpass.py`'den kasıtlı olarak ayrı: o script
   PostGIS'e yazar (prod yolu), bu script hiç Postgres/Docker
   gerektirmeden düz bir JSON dosyasına yazar. Overpass'ın ücretsiz uçları
   hız sınırlıyor (HTTP 429) ve arada 502 veriyor - script bu yüzden birden
   fazla endpoint üzerinde, üstel geri çekilmeli (exponential backoff)
   birkaç tur deniyor, ve her kategoriyi `.overpass-cache/` altında ayrı
   ayrı önbelleğe alıp kaldığı yerden devam edebiliyor. Aynı gerçek yer
   birden fazla kategori sorgusuna denk gelebildiği için (bir spor
   tesisinin içindeki oyun parkı gibi) sonuçlar OSM id'sine göre
   birleştirilir - asla mükerrer yer üretilmez.
2. **`enrich_demo_data.py`** - Konumsal zenginleştirme geçişi. OSM bir
   parkı ve içindeki çeşmeyi iki ayrı nesne olarak modeller; bu doğru ve
   ikisi de ayrı yer olarak kalmalı, ama ürünün temel vaadi ("bu park +
   çocuk alanı + tuvalet + su sunuyor") bir yerin *sunduklarıyla* ilgili.
   Bu yüzden konteyner kategoriler (`park`, `spor`) 120 metre yarıçapındaki
   tesislerden amenity bayrağı devralır - **kategoriler asla
   birleştirilmez** (çeşme parka dönüşmez) ve OSM'in açıkça belirttiği bir
   değer asla üzerine yazılmaz. İlk üç şehirlik anlık görüntüde 815
   konteyner mekan zenginleştirildi, 871 amenity bayrağı eklendi; güncel
   sayılar için her şehir dosyasının kendi `enrichment` alanına bakın.
3. **`repair_demo_data.py`** - Overpass'a tekrar gitmeden, zaten çekilmiş
   anlık görüntüdeki veri kusurlarını onarır: erken bir sürümün eksik ev
   numarasını koşulsuz araya sıkıştırmasından kalma "Yerebatan Caddesi
   None" gibi adres satırlarını düzeltir, ve bir çeşme gibi yerlerde
   neredeyse her zaman bir etiketleme hatası olan `opening_hours: closed`
   değerlerini `null`'a (bilinmiyor) çevirir.

## API Sözleşmesi

### Backend (FastAPI)

FastAPI otomatik dokümantasyonu çalışırken `/docs` (Swagger) ve `/redoc`
üzerinden erişilebilir. Ana uçlar:

| Metod & Yol | Açıklama |
|---|---|
| `GET /places` | Arama: `lat`/`lon`+`radius_m` (yakınımda) **veya** `bbox` (harita görünümü), `category`, `amenity`, `free_only`, `min_reliability`, `admin_region_id` filtreleriyle |
| `GET /places/{id}` | Yer detayı (tüm amenity'ler, kaynak/güncellik bilgisi) |
| `POST /places/suggest` | Yeni yer öner (→ `pending_review`, moderasyon bekler) |
| `POST /places/{id}/reports` | Bir yer hakkında sorun bildir (kapalı, bakımda, bilgi yanlış, ...) |
| `POST /places/{id}/verifications` | Bir alanı doğrula (ör. "evet, tekerlekli sandalye erişimi var") - anında uygulanır, güvenilirlik skorunu yeniden hesaplar |
| `GET /categories` | Aktif kategori listesi |
| `GET /admin-regions?level=&parent_id=` | İdari hiyerarşi gezinme (il → ilçe → mahalle) |
| `GET /health` | Sağlık kontrolü |

Tüm yazma uçları hesapsız kullanılabilir (`user_id` opsiyonel) - gizlilik-
öncelikli tasarım gereği.

### Demo (Next.js route handler'ları)

| Metod & Yol | Açıklama |
|---|---|
| `GET /api/places` | `GET /places` ile **birebir aynı sorgu sözleşmesi**: `lat`/`lon`+`radius_m`, `bbox`, tekrarlanan `category`/`amenity`, `free_only`, `open_now`, `q` (serbest metin), `limit`, `offset`. Yanıttaki `applied` alanı hangi filtrelerin gerçekten uygulandığını - ve `relaxed: true` ile aramanın genişletilip genişletilmediğini - geri bildirir. |
| `GET /api/places/:id` | Yer detayı; backend'deki `GET /places/{id}` ile aynı amaç. OSM id'leri `/` içerdiği için (`node/123`) URL-encoded alınır. Onaylanmış bir moderasyon kaydı varsa (`frontend/data/contributions.json`'daki `overrides`), sonucun üzerine okuma anında bindirilir - kaynak OSM anlık görüntüsü asla değiştirilmez. |
| `GET /api/contributions` | Moderasyon kuyruğu - admin panelinin okuduğu uç. |
| `POST /api/contributions` | "Mekan öner" / "yanlış bilgi bildir" / "kapalı bildir" - `kind` alanıyla ayrışan tek bir koleksiyon ucu (backend'de bunlar iki ayrı REST ucu: `POST /places/suggest` ve `POST /places/{id}/reports`; demo aynı `pending`-öncelikli moderasyon semantiğini tek bir uçta uyguluyor). Her zaman `pending` olarak başlar, herkese açık aramaya asla doğrudan düşmez. |
| `PATCH /api/admin/places/:id` | Mekan düzenleme: ad, durum, ücret tipi, amenity'ler. `null` birinci sınıf bir değer - "bilinmiyor" ifade edilebilir kalır, yoksa moderatör yalnızca var/yok diyebilirdi. Düzenleme, OSM anlık görüntüsüne **katman** olarak yazılır: kaynak kayıt değişmez (yeniden içe aktarılabilir, lisanslı ve upstream id'si var), yani bir yazım düzeltmesi sonraki içe aktarımda sessizce kaybolmaz. |
| `DELETE /api/admin/places/:id` | O mekandaki tüm düzeltmeleri geri alır, ham OSM kaydına döner. **Kalıcı silme yok**: artık var olmayan bir yer `permanently_closed` olur - aramadan kalkar ama kayıt (ve nedeni) denetim için durur. |
| `PATCH /api/admin/contributions/:id` | `{ "action": "approve" \| "reject" }` - moderasyon onayı. Yalnızca `approve`, ve yalnızca rapor türü katkılar için bir override üretir (`report_closed` → `status: temporarily_closed`, `report_incorrect` → düşük güvenilirlik skoru). **Bu uçta kimlik doğrulama yok** - bilinçli, dokümante edilmiş bir demo sınırlaması (bkz. "Bilinen Sınırlamalar"); prod backend'de eşdeğer uçlar JWT arkasında olurdu. |

## Kategoriler ve Filtreler

Demo, backend'in aktif kategori kümesinden 14 kategoriyle çalışıyor
(`frontend/src/lib/categories.ts`):

| Slug | Etiket | Not |
|---|---|---|
| `tuvalet` | Tuvalet | |
| `park` | Park | |
| `su` | İçme Suyu | |
| `dinlenme` | Dinlenme Alanı | |
| `cocuk-alani` | Çocuk Alanı | |
| `spor` | Spor Alanı | |
| `otopark` | Otopark | |
| `dus` | Duş | |
| `wifi` | Ücretsiz Wi-Fi | |
| `cami` | Cami | Türkiye'de en yaygın kamusal tesis; tanımadığın bir mahallede tuvalet ve akan suya erişmenin en güvenilir yolu |
| `eczane` | Eczane | |
| `toplanma-alani` | Acil Toplanma Alanı | Deprem hazırlık altyapısı - genel amaçlı hiçbir harita bunu birinci sınıf kategori olarak sunmuyor |
| `kutuphane` | Kütüphane | |
| `sarj` | Elektrikli Şarj | |

Son beş kategori, genel amaçlı bir "tuvalet bulucu" ile Türkiye'ye özgü bir
kamusal alan aracı arasındaki farkın olduğu yer. Cami, toplanma alanı ve
kütüphane, OSM'de ücret etiketi yoksa "bilinmiyor" değil **ücretsiz**
sayılır - Türkiye'de giriş ücreti almazlar ve "bilinmiyor" bırakmak
"Ücretsiz" filtresini tam da insanların sığındığı yerler için işe yaramaz
hale getiriyordu.

Filtre çubuğunda kategorilere ek olarak 7 amenity üst-seviye filtre olarak
sunuluyor: engelli erişimi, bebek bakım, çocuk dostu, evcil hayvan dostu,
içme suyu, Wi-Fi, gölgelik. (Diğer 5 amenity - rampa, duş, oturma alanı,
otopark, sessizlik - yalnızca yer detay sayfasında satır olarak gösterilir,
üst-seviye filtre değildir.) Ayrıca "şu an açık" ve "ücretsiz" filtreleri
var.

Arama kutusu serbest Türkçe metni (`"çocuğumla gidebileceğim bir park"`
gibi) `SEARCH_SYNONYMS` eşanlamlı-sözlüğü üzerinden yapılandırılmış
filtrelere çevirir - bir LLM çağrısı değil, kasıtlı olarak bir lookup
tablosu, çünkü demo anında ve çevrimdışı cevap vermeli. Mimari, üstüne bir
semantik katman eklenebilecek şekilde açık bırakıldı (bkz. "Yol
Haritası"). Bu ayrıştırmanın bir hatası ve düzeltmesi için bkz. "Bilinen
Tuhaflıklar".

## Veri Güvenilirliği

Her `Place`, hangi kaynak(lar)dan geldiğini (`PlaceSourceRecord` →
`DataSource`), ne zaman son doğrulandığını, kaç kez doğrulandığını ve
çözülmemiş kaç çelişen rapor olduğunu taşır. Bunlardan tek, açıklanabilir bir
`reliability_score` (0.0-1.0) hesaplanır (`app/services/reliability.py`) ve
kullanıcıya asla çıplak sayı değil, "Bugün doğrulandı" / "3 gün önce
güncellendi" / "2 ay önce doğrulandı" gibi okunabilir bir etiket olarak
gösterilir (`freshness_label`). Formül basit, test edilebilir, elle
ayarlanabilir bir fonksiyondur - v1'de bir ML modeli değil.

**Demo'da bu alanlar farklı üretiliyor** - gerçek bir topluluk geçmişi
olmadığı için `reliability_score`/`verification_count`/`freshness_label`,
her OSM kaydının alan doluluğundan deterministik olarak türetiliyor (bkz.
Mimari → "Neden bir demo veri adaptörü var?"). Backend'deki gerçek
formülün yerini tutmaz, sadece şeklini taklit eder.

Kaynakların kendi lisans/güncellik/güvenilirlik detayları için
[backend/docs/DATA_SOURCES.md](backend/docs/DATA_SOURCES.md)'e bakın.

## Test

```bash
cd backend
uv run pytest tests/ -v
```

İki katmanlı test stratejisi:
- **Saf mantık testleri** (`test_reliability.py`, `test_dedup_math.py`) - veritabanı gerektirmez, her ortamda çalışır.
- **Veritabanı-bağımlı testler** (`test_search.py`, `test_dedup_integration.py`, `test_moderation.py`) - gerçek bir PostGIS bağlantısı gerektirir; `docker compose up -d` çalışıyorsa yerelde, yoksa CI'da (`.github/workflows/ci.yml`, `postgis/postgis` servis konteyneri ile) çalışır. Veritabanı yoksa bu testler **skip** edilir, başarısız olmaz - sahte bir "yeşil" göstermek yerine dürüst bir sinyal.

Frontend'de şu an otomatik bir test suite'i yok - sadece `npm run lint`
(ESLint) var.

## Güvenlik

- Yazma uçları girdi doğrulaması için Pydantic şemalarını kullanır (`app/schemas/`).
- Kullanıcı katkıları (öneri/rapor) moderasyon onayı olmadan asla herkese açık aramaya düşmez.
- JWT tabanlı opsiyonel kimlik doğrulama (`python-jose`), şifreler `passlib[bcrypt]` ile hash'lenir.
- `BURADANE_JWT_SECRET` prod'da mutlaka değiştirilmeli - varsayılan değer sadece yerel geliştirme içindir.
- Demo'nun moderasyon onay ucunda (`PATCH /api/admin/contributions/:id`) kimlik doğrulama yok - bilinçli, dokümante edilmiş bir demo sınırlaması, bkz. "Bilinen Sınırlamalar".

## Bilinen Tuhaflıklar

Frontend'i kurarken bulunup düzeltilen, tekrar keşfedilmemesi gereken iki
gerçek hata:

### 1. MapLibre GL JS v6, herhangi bir bundler altında `setWorkerUrl()` gerektiriyor

MapLibre GL JS v6 tamamen ESM ve tile-parsing worker'ını çalışma anında
ayrı bir dosyadan yüklüyor. Dokümante edilen `new URL(...,
import.meta.url)` deseni, bundler'ın bu worker dosyasını yayması varsayımına
dayanıyor; ama worker kendi içinde bir kardeş modülü (`maplibre-gl-
shared.mjs`) statik olarak import ediyor, ve Turbopack worker'ı yayarken bu
kardeş dosyayı yanına yaymıyor - worker açılışta hemen patlıyor.

Hata **tamamen sessiz**: stil ve sprite'lar sorunsuz yükleniyor, `map.on
("error", ...)` hiç tetiklenmiyor, ve harita tek bir vektör tile isteği bile
atmıyor. Dışarıdan bakınca "harita nedense boş" gibi görünüyor - sebep
network sekmesinde bile görünmüyor.

Çözüm: `MapCanvas.tsx`'te modül kapsamında çağrılan
`setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")`, MapLibre'yi
`public/maplibre/` altından statik olarak servis edilen worker'a VE onun
kardeş modülüne yönlendiriyor, bundler'ı tamamen devre dışı bırakıyor.
`scripts/copy-maplibre-worker.mjs`, `node_modules/maplibre-gl/dist/`'ten
hem `maplibre-gl-worker.mjs` hem `maplibre-gl-shared.mjs`'i
`public/maplibre/`'a kopyalıyor ve kopyalama anında dosyalardan biri
eksikse yüksek sesle (non-zero exit) başarısız oluyor. `package.json`'daki
`predev`/`prebuild` script'lerine bağlandı, böylece bir `npm ci` ya da bir
maplibre-gl sürüm yükseltmesi haritayı bir daha sessizce bozamaz.

### 2. Doğal-dil arama, artık sözcükler yüzünden 0 sonuç döndürüyordu

Arama kutusundaki serbest metin, `SEARCH_SYNONYMS` (`categories.ts`)
üzerinden yapılandırılmış filtrelere ayrıştırılıyor. Başlangıçta,
eşanlamlı-sözlük eşleşmesinden sonra kalan her sözcük ("gidebileceğim",
"bir" gibi) yer adı/adresine karşı sert bir metin filtresi olarak
uygulanıyordu. OSM'deki çoğu Türkiye POI'si (bank, çeşme, tuvalet) hiç
`name` etiketi taşımadığı için bu artık metin neredeyse hiçbir zaman
eşleşmiyor, ve yapısal olarak doğru anlaşılmış bir sorgu bile boş sonuç
döndürüyordu.

İki parçalı düzeltme: (1) bir Türkçe stopword listesi (`STOPWORDS`,
`places-repository.ts`) bağlaç/dolgu sözcüklerini bir isim filtresi
olarak değerlendirilmeden önce eliyor - `normalizeTr` Türkçe'ye özgü
noktasız-ı/noktalı-İ büyük/küçük harf dönüşümünü doğru yapıyor (backend'in
dedup normalizer'ında zaten düzeltilmiş olan aynı hata sınıfı); (2) zarif
gevşetme (graceful relaxation) - eğer artık metin, gerçek kategori/amenity/
ücretsiz filtreleri çıkarılmış anlaşılır bir sorguyu boşaltıyorsa, metin
düşürülüp sonuçlar onsuz yeniden hesaplanıyor, ve yanıttaki `applied.
relaxed: true` alanı arayüzün "arama genişletildi" demesini sağlıyor -
sorgunun anlamını sessizce değiştirmek yerine.

## Bilinen Sınırlamalar

- Demo'nun admin uçlarında (`/api/admin/contributions/:id`,
  `/api/admin/places/:id`) kimlik doğrulama yok - bilinçli, dokümante
  edilmiş bir demo sınırlaması; prod backend'de eşdeğer uçlar JWT
  arkasındadır.
- Demo'daki güvenilirlik skoru / doğrulama sayısı / tazelik etiketleri
  gerçek bir topluluk geçmişinden değil, OSM kaydının doluluğundan
  **deterministik olarak üretiliyor** (demo'nun hiç topluluk geçmişi yok).
  Bu, açıkça bayraklanmış, üretilmiş veridir - gerçek formül
  `backend/app/services/reliability.py`'de yaşıyor.
- Demo, backend/PostGIS'e değil statik bir JSON anlık görüntüsüne bağlı -
  iki taraf aynı sorgu sözleşmesini konuşuyor ama henüz birbirine
  bağlanmadı; bkz. "Yol Haritası".
- **Henüz gerçek bir Alembic migration'ı yok.** Bu geliştirme ortamında
  Docker/Postgres erişilebilir olmadığı için `alembic revision --autogenerate`
  çalıştırılamadı - şema `Base.metadata.create_all()` ile oluşturuluyor
  (yukarıdaki kurulum adımı). İlk gerçek migration, bir Postgres'e erişimi
  olan bir ortamda (yerel Docker veya CI) üretilmeli.
- Fotoğraflar ve yorumlar backend'de modellendi (`PlacePhoto`/
  `PlaceReview`) ama ne backend API'sinde ne demo'da bir arayüzü var.
  Fotoğraflar için OSM etiketleri ölçüldü ve **bilinçli olarak
  ertelendi**: mekanların yalnızca %2,3'ünde (6.481'de 147) `image` ya da
  `wikimedia_commons` etiketi var, yani özellik eklense detay
  sayfalarının büyük çoğunluğu yine yer tutucuda kalır ve bugünkü tutarlı
  görünümden daha kötü durur. Gerçek fotoğraf kaynağı, kullanıcı
  yüklemeleri ya da belediye açık verisi olacak.
- Kayıtlı yerler (favoriler) cihaza özel `localStorage`'da tutuluyor;
  cihazlar arası senkron yok. Bu, hesapsız/gizlilik-öncelikli tasarımın
  bilinçli bedeli - birinin düzenli kullandığı tuvalet ve duşların listesi
  bir kimliğe bağlı sunucuda durmamalı.
- **İBB/ULAŞAV entegrasyonu henüz yazılmadı** - araştırıldı,
  `backend/docs/DATA_SOURCES.md`'de not düşüldü, lisans doğrulaması
  entegrasyon öncesi tek tek yapılmalı.

### Katkı döngüsü

"Mekan öner → moderatör onaylar → haritada görünür" zincirinin tamamı çalışıyor.
Onaylanan öneri, OSM anlık görüntüsüne **yazılmaz** — tıpkı override'lar gibi
yanında duran bir topluluk katmanına eklenir; böylece anlık görüntü yeniden
içe aktarılabilir kalır ve Overpass'tan yeni bir çekim insanların katkısını
sessizce silmez.

Kurallar:

- **Kaynak dürüstlüğü**: kaynağı "Topluluk katkısı", OSM değil. Anlık görüntü
  ODbL; kullanıcı gönderisini OSM verisi diye etiketlemek her iki yöne de yanlış
  atf olurdu.
- **Uydurma yok**: gönderenin söylemediği her özellik `null` kalır. `false`
  varsaymak, sorulmamış bir mekan için "engelli erişimi yok" iddiası demek olurdu.
- **Başlangıç güveni 0.5**: bir moderatör onayı var, bağımsız doğrulama yok. Sıfır,
  birinin önünde durduğu bir mekanı gömer; iyi etiketlenmiş bir OSM node'uyla
  eşitlemek ise abartı olur. Normal yoldan, doğrulamalarla yükselir.
- **Onaylanamayan öneri onaylanmış görünmez**: adı, kategorisi ya da Türkiye
  içinde geçerli konumu olmayan bir öneri 422 döner ve `pending` kalır. "Onaylandı"
  yazıp hiçbir şey yaratmamak, bu değişikliğin ortadan kaldırdığı hatanın ta kendisi.
- **Reddetmek gerçekten geri alır**: onayladıktan sonra reddedilen bir önerinin
  mekanı haritadan kalkar. İki kez onaylamak kopya üretmez.

### Veriye karşı dürüstlük

Açık coğrafi veri eşit dağılmıyor ve bir şeyin *bilinmemesi* ile *olmaması*
arasındaki fark, bu uygulamada doğrudan birinin boşuna yürümesi demek. Ölçüp
düzelttiğimiz üç nokta:

| Bulgu | Veri | Karar |
|---|---|---|
| `access=private/no` | 146 mekan (17'si tuvalet) | Sonuçlara **hiç girmez**. Özel mülk içindeki bir tuvaleti umumi diye göstermek, acelesi olan birini açılmayacak bir kapıya göndermektir. |
| `access=customers` / `permit` | 9 tuvalet + diğerleri | **Kalır ama etiketlenir.** "Bir çay al, tuvaleti kullan" İstanbul'da gerçekten işleyen bir çözüm; gizlemek gerçek bir cevabı çöpe atmak olurdu. |
| `opening_hours` | 18.974 mekanın **%4,1**'inde var. Üç şehirlik anlık görüntüde ölçülen dağılım: 514 açık, **17 kapalı**, 10.875 bilinmiyor | Filtre yalnızca **kapalı olduğu bilinenleri** eler; çipin adı da bu ("Kapalıları gizle"). 17 kapalıyı ayıklamak için 10.875 kaydı gizlemek, filtreyi işe yaramaz değil zararlı yapardı. |
| `wheelchair=designated` | 3 mekan | Artık `true`. OSM'nin en güçlü erişilebilirlik iddiasıydı ve "bilinmiyor" sayılıyordu. |
| `wheelchair=limited` | 70 mekan | Boolean'a **düşürülmüyor** (ne evet ne hayır), detay sayfasında olduğu gibi yazılıyor. |

**Cevabı bizde olmayan sorular.** Bazı aramaların doğru cevabı açık
haritalama verisinde yapısal olarak yok. En net örnek "nöbetçi eczane":
nöbet listesi her gün değişir, il eczacı odalarınca belirlenir ve hiçbir OSM
etiketinde geçmez. Kelimeyi eşleştirip şehirdeki 594 eczaneyi döndürmek eksik
bir cevap değil, **yanlış** bir cevaptır. Bu yüzden sorgu bunu söylüyor ve
gerçek kaynağa — TİTCK'nın e-Devlet üzerindeki resmî sorgusuna — yönlendiriyor
(`QUERY_NOTICES`, `categories.ts`). UI'da özel bir durum olarak değil, tablo
olarak duruyor; aynı şekle sahip ikinci soru geldiğinde hazır.

Aynı ilke özellik (amenity) alanlarında da geçerli: `null` "bilinmiyor"
demek, "yok" demek değil, ve bir özellik filtresi asla `null`'ı eşleştirmez.
Filtre çiplerindeki sayılar bu yüzden önemli — `Gölgelik 1` yazan bir çip,
takılmış bir filtre gibi değil, henüz kimsenin haritalamadığı bir boşluk gibi
okunuyor.

### Çevrimdışı çalışma

Bu uygulama tam olarak ağın en kötü olduğu koşullarda kullanılıyor: dışarıda,
yürürken, acelesi olan biri tarafından, bazen yabancı bir SIM ile. Sinyal
kesilince bembeyaz olan bir uygulama, tam da önemli olduğu anda işe yaramaz
hale gelir. `frontend/public/sw.js` bunu çözüyor:

| İstek türü | Strateji | Neden |
|---|---|---|
| `/_next/static/*`, `/maplibre/*` | cache-first, süresiz | İçerik-hash'li dosya adları; bayat isabet yapısal olarak imkânsız |
| Harita karoları (OpenFreeMap) | cache-first + LRU (1200 kayıt) | Bir aylık Kadıköy karosu hâlâ doğru bir Kadıköy haritası; kötü bağlantıda en pahalı iş bu |
| `/api/places`, `/api/places/*` | network-first (2.5 sn zaman aşımı) + cache fallback | Bağlantı varken tazelik kazanır; yokken önbellekten servis edilir **ve etiketlenir** |
| Sayfa gezinmesi | network-first + kabuk fallback | Çevrimdışı soğuk açılışta bile uygulama açılır |
| POST/PATCH/DELETE, `/api/admin/*` | hiç önbelleklenmez | Bayat bir moderasyon kuyruğu üzerinden işlem yapmak kaydı bozar; bildirimin gönderildiğini yanlış söylemek sessiz kalmaktan kötüdür |

**Neden stale-while-revalidate değil?** SWR önbellek kopyasını verip arkada
sessizce tamir eder; sayfa canlı yanıtı bir haftalık yanıttan ayırt edemez.
Bir tuvalet haritasında bu, "tadilat nedeniyle kapalı" bilgisinin haber olması
ile hiç görünmemesi arasındaki fark demek. Artık her yanıt nereden geldiğini
`x-buradane-offline` başlığıyla söylüyor; çevrimdışı uyarısı bir tahmin değil,
bir olgu bildirimi.

**İki tuzak** (ikisi de ölçülerek bulundu, ikisi de sessizdi):

1. `navigator.onLine` güvenilmez — captive portal'da veya upstream'i olmayan
   bir router arkasında "online" der, devtools ağ emülasyonunda hiç değişmez.
   Gerçek sinyal, isteğin başına ne geldiği. (İlk çözüm service worker'ın
   postMessage ile durum yayınlamasıydı; terk edildi — worker boşta kalınca
   sonlandırılıyor, durum değişkeni tam da lazım olduğu anda kaybolmuş
   oluyordu.)
2. `/api/places` `Cache-Control: public, max-age=60` gönderiyor. Worker'ın
   `fetch`'i tarayıcının HTTP önbelleğinden yanıt alıp **başarılı** sayıyordu —
   sunucu erişilemezken bile. Dahası zamana bağlıydı: kayıt bir dakikayı
   geçene kadar çalışıyordu, ki bu tamamen bozuk olmaktan kötü. Çözüm:
   `fetch(request, { cache: "no-store" })` — tek önbellek katmanı var, o da bu.

Service worker yalnızca production'da kayıt olur (`ServiceWorkerRegistrar`);
dev sunucusunun önünde HMR'ı keser. Test etmek için: `npm run build && npm run start`.

## Yol Haritası

**v1 (şu an, çalışıyor)**: Dokuz ilde (İstanbul, Ankara, İzmir, Antalya,
Bursa, Adana, Konya, Gaziantep, Trabzon) 18.974 gerçek
OSM mekanı üzerinde harita, konum, yakındakiler, 14 kategori, yer detayı,
Türkçe doğal-dil araması, dinamik filtreler, sıralama (en yakın / en
güvenilir), yön göstergesi, yol tarifi, tek dokunuşla yerinde doğrulama,
kullanıcı önerisi ve sorun bildirimi, moderasyon + mekan düzenleme paneli,
şehir seçici, paylaşılabilir derin bağlantılar, kayıtlı yerler, **çevrimdışı
çalışma** (PWA + service worker), mobil sheet + masaüstü sidebar düzeni.
Erişilebilirlik: Lighthouse 100.

**Sıradaki adım (demo → prod)**: Demo'nun kendi Next.js API route'larını,
statik JSON anlık görüntüsü yerine gerçek FastAPI+PostGIS backend'ine
yönlendirmek (bkz. "Neden bir demo veri adaptörü var?") - sorgu sözleşmesi
zaten aynı olduğu için bu bir taban-URL değişikliği olarak tasarlandı.

**v2 (planlanan, henüz başlanmadı)**: Fotoğraflar (gerçek bir kaynak
bulununca - bkz. "Bilinen Sınırlamalar"), yorumlar/değerlendirmeler,
offline bölge indirme (service worker), erişilebilirlik/ihtiyaç profiline
göre kişiselleştirme, gerçek bir semantik/AI destekli arama katmanı
(demo'daki lookup-tablosu tabanlı ayrıştırmanın ötesinde), gelişmiş
öneriler, oyunlaştırma (katkı puanı/rozet), belediye açık verisi
(İBB/ULAŞAV) entegrasyonu, kalan 72 il.

## Katkı

Katkılara açığız. Nereden başlayacağını bilmiyorsan `good first issue`
etiketli issue'lara bak; kendi ilinin verisini eklemek de en kolay ve en
görünür katkılardan biri.

| Belge | Ne için |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Ortam kurulumu, dal/commit kuralları, PR süreci, risk seviyeleri, sık karşılaşılan tuzaklar |
| [ROADMAP.md](ROADMAP.md) | Ne tamamlandı, ne planlandı, hangi konular hâlâ tartışmaya açık |
| [CLAUDE.md](CLAUDE.md) | Proje kuralları — Claude Code ve diğer AI kodlama araçları için, ama insan katkıcı için de okunur bir mimari özeti |
| [docs/GITHUB_SETUP.md](docs/GITHUB_SETUP.md) | Maintainer'a: branch protection, label'lar, Actions izinleri |
| [docs/backend-ortam-degiskenleri.md](docs/backend-ortam-degiskenleri.md) | Backend ortam değişkenleri |

Akış: **issue → dal → PR → otomatik kontroller → review → merge**.
`main` dalına doğrudan push kapalıdır.

## Lisans

Kaynak kodu [MIT](LICENSE). OpenStreetMap'ten alınan coğrafi veri ayrıca
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) altındadır - bkz.
[backend/docs/DATA_SOURCES.md](backend/docs/DATA_SOURCES.md).
