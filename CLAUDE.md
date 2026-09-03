# CLAUDE.md — buradane

Bu dosya, bu depoda çalışan Claude Code (ve aynı kuralları okuyabilen diğer AI
kodlama araçları) için proje kurallarıdır. **İnsan katkıcılar için asıl belge
[CONTRIBUTING.md](CONTRIBUTING.md)'dir**; buradaki kurallar onunla çelişmez,
onu tamamlar.

Bu dosyadaki her teknoloji, dosya yolu ve komut depodan doğrulanmıştır.
Doğrulanmamış hiçbir şey yazılmamıştır. Bir şey burada yazılıyken depoda
yoksa, bu bir hatadır — düzeltilmesi gerekir, uydurulması değil.

---

## 1. Proje ne yapıyor

buradane, **Türkiye'deki kamusal alanları** bulmak için bir harita
uygulaması: tuvalet, park, içme suyu, dinlenme alanı, çocuk alanı, spor
alanı, otopark, duş, ücretsiz Wi-Fi, cami, eczane, acil toplanma alanı,
kütüphane, elektrikli şarj.

Ürünün cevapladığı iki soru, kodun her yerinde tekrar eden şey budur:

1. **"Yakınımda ne var?"** — mesafe, yürüme süresi, yön
2. **"Bu bilgi hâlâ doğru mu?"** — tek dokunuşla doğrulama, tazelik etiketi,
   kaynak ve güvenilirlik skoru

v1 kapsamı **yalnızca Türkiye**'dir. Mimari ülkeye göre soyutlanmıştır
(`AdminRegion.country_code`, `Place.country_code`, `settings.active_country`)
ama v1'de tek bir ülke aktiftir.

---

## 2. Teknoloji stack'i

**Değiştirme.** Bunlar bilinçli seçimler ve gerekçeleri README'nin "Mimari"
bölümünde yazılı.

### Frontend (`frontend/`)

| Ne | Sürüm | Not |
|---|---|---|
| Next.js | 16.3.4 | App Router, Turbopack |
| React | 19.2.8 | |
| TypeScript | ^5 | |
| Tailwind CSS | v4 | `@tailwindcss/postcss` |
| MapLibre GL JS | ^6.6.0 | **Kırılgan** — bkz. §9 |
| lucide-react | ^1.39.0 | Tek ikon kaynağı |
| Vitest | ^4.1.11 | `vitest.config.mts` |
| ESLint | ^9 | `eslint.config.mjs`, `eslint-config-next` |

### Backend (`backend/`)

| Ne | Sürüm | Not |
|---|---|---|
| Python | >=3.12 | Paket yöneticisi: **`uv`** (pip/venv değil) |
| FastAPI | >=0.115 | |
| SQLAlchemy | >=2.0.36 | `Mapped[...]` tipli modern stil |
| GeoAlchemy2 | >=0.15.2 | PostGIS geometri tipleri |
| psycopg | >=3.2.3 | `postgresql+psycopg://` |
| Alembic | >=1.14 | |
| Pydantic | >=2.9 | + `pydantic-settings` |

### Veritabanı

PostgreSQL 16 + PostGIS 3.4 (`backend/docker-compose.yml`,
`postgis/postgis:16-3.4`). Coğrafi indeksleme (GiST) gerçek bir gereksinim:
"yakınımdaki" ve "harita görünümündeki" sorguları Python tarafında haversine
döngüsüyle çözmek Türkiye ölçeğinde işlemez.

---

## 3. Klasör ve dosya haritası

```
buradane/
├── frontend/
│   ├── data/                       # OSM anlık görüntüleri (COMMIT'Lİ, ~15 MB)
│   │   ├── places.<il>.json        # il başına bir dosya, 9 il / 18.974 mekan
│   │   └── contributions.json      # ÇALIŞMA ZAMANI durumu, .gitignore'da
│   ├── public/
│   │   ├── sw.js                   # Service worker (çevrimdışı katman)
│   │   └── maplibre/               # node_modules'tan kopyalanır, .gitignore'da
│   ├── scripts/
│   │   └── copy-maplibre-worker.mjs  # predev/prebuild'de otomatik koşar
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx            # Sunucu bileşeni; URL durumunu SUNUCUDA ayrıştırır
│   │   │   ├── layout.tsx
│   │   │   ├── globals.css         # TÜM tasarım token'ları burada
│   │   │   ├── manifest.ts         # PWA manifest
│   │   │   ├── admin/page.tsx      # Yönetim paneli
│   │   │   └── api/                # Demo API route'ları
│   │   │       ├── places/         # Liste + detay
│   │   │       ├── contributions/  # Kullanıcı katkıları
│   │   │       └── admin/          # Moderasyon + mekan düzenleme
│   │   ├── components/             # İstemci bileşenleri
│   │   └── lib/                    # Saf mantık — TESTLERİN ODAĞI
│   ├── tests/                      # Vitest, 111 test
│   ├── vitest.config.mts
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI uygulaması
│   │   ├── core/{config,db}.py     # Ayarlar + oturum
│   │   ├── models/                 # SQLAlchemy modelleri
│   │   ├── schemas/                # Pydantic şemaları
│   │   ├── api/                    # Route'lar
│   │   ├── services/               # dedup, moderation, reliability, search
│   │   └── ingest/                 # OSM/TurkiyeAPI veri alımı
│   ├── alembic/                    # Migration altyapısı
│   ├── tests/                      # pytest
│   ├── docker-compose.yml          # Postgres + PostGIS
│   └── pyproject.toml
├── scripts/                        # Python veri boru hattı (Overpass)
├── .github/workflows/              # CI
└── README.md                       # Uzun teknik doküman (613 satır)
```

### En kritik dosyalar

| Dosya | Rolü | Dikkat |
|---|---|---|
| `frontend/src/lib/places-repository.ts` | Sorgu motoru + demo veri adaptörü | Uygulamanın kalbi. Filtreleme, arama, facet, genişletme, override birleştirme burada |
| `frontend/src/lib/types.ts` | Frontend ↔ backend sözleşmesi | Backend'in Pydantic şemalarını yansıtır. **Değişiklik sözleşme kırar** |
| `frontend/src/lib/categories.ts` | Kategori/özellik meta verisi + arama eşanlamlıları | Etiket, renk, ikon, Türkçe arama kalıpları |
| `frontend/src/lib/administrative.ts` | 81 il tablosu + ilçe çözümleyici | Türkçe harf katlama kuralları |
| `frontend/src/lib/contributions-store.ts` | Katkılar + override'lar | İş mantığı: onaylanan öneriden mekan üretme, moderasyon |
| `frontend/src/components/MapCanvas.tsx` | MapLibre sarmalayıcı | **Kırılgan** — bkz. §9 |
| `frontend/src/components/AppShell.tsx` | Ana durum orkestratörü | Büyük; değiştirmeden önce tamamını oku |
| `frontend/public/sw.js` | Çevrimdışı katman | Yanlış bir SW kalıcıdır ve siteyi bozabilir |
| `frontend/src/app/globals.css` | Tasarım token'ları | Renkler yalnızca buradan gelir |

---

## 4. Çalıştırma ve doğrulama komutları

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
npm run build
npm run start
npm test           # Vitest, tek koşu
npm run test:watch
npm run lint       # ESLint
npx tsc --noEmit   # Tip kontrolü (package.json'da script yok, doğrudan çağır)
```

`predev`/`prebuild` script'i MapLibre worker dosyalarını `public/maplibre/`
altına kopyalar. **Bu adımı atlama** — atlanırsa harita sessizce boş açılır
(bkz. §9).

### Backend

```bash
cd backend
docker compose up -d db          # Postgres + PostGIS
uv sync --all-extras
uv run alembic upgrade head      # (henüz gerçek migration yok — bkz. §7)
uv run uvicorn app.main:app --reload
uv run pytest tests/ -v
```

**Windows notu:** bu makinede sistem `python`/`python3` yok (sadece Microsoft
Store saplaması). Her zaman `uv run python ...` kullan.

### Veri boru hattı

```bash
uv run python scripts/fetch_demo_data.py                # tüm iller
uv run python scripts/fetch_demo_data.py --city bursa   # tek il
```

Overpass hız sınırlı ve yavaştır (il başına ~8 dk). Betik il+kategori bazında
diske checkpoint atar ve üstel geri çekilme uygular. **Gereksiz yere
çalıştırma.**

---

## 5. Kodlama kuralları

### 5.1 Dil

- **Kod yorumları: İngilizce.** Yorum *ne* yapıldığını değil **neden**
  yapıldığını anlatır. Bu depodaki mevcut yorumlar bu standarttadır; onları
  örnek al.
- **Kullanıcıya görünen her metin: Türkçe**, diakritikler tam ve doğru
  (ı, İ, ğ, Ğ, ü, Ü, ş, Ş, ö, Ö, ç, Ç). "fur" yerine "für" yazmak nasıl
  hataysa, "Kadikoy" yazmak da öyledir.

### 5.2 Adlandırma

| Ne | Kural | Örnek |
|---|---|---|
| React bileşeni | PascalCase, dosya adı = bileşen adı | `PlaceCard.tsx` |
| Hook | `use` öneki, kebab-case dosya | `use-favorites.ts` |
| Lib modülü | kebab-case | `places-repository.ts` |
| TS tipi/arayüz | PascalCase | `PlaceQueryResult` |
| Sabit | UPPER_SNAKE | `SEARCH_SYNONYMS` |
| Kategori slug'ı | kebab-case, Türkçe | `cocuk-alani`, `toplanma-alani` |
| Python | PEP 8, snake_case | `fetch_demo_data.py` |
| API alan adı | snake_case (backend sözleşmesi) | `price_type`, `reliability_score` |

### 5.3 Bileşen yapısı

- Varsayılan **sunucu bileşeni**. `"use client"` yalnızca gerçekten gerektiğinde
  (durum, olay, tarayıcı API'si).
- Harita `dynamic(..., { ssr: false })` ile yüklenir — WebGL + `window`
  gerektirir, tercih değil zorunluluk.
- URL durumu **sunucuda** ayrıştırılır (`app/page.tsx`), istemcide değil.
  İstemcide `window` okumak hidrasyon uyuşmazlığı (React #418) ve görünür
  düzen sıçraması üretir.

### 5.4 Durum ve veri yönetimi

- Global durum kütüphanesi **yok** ve eklenmeyecek. Durum `AppShell.tsx`'te
  `useState` ile tutulur ve aşağı aktarılır.
- Harici depolar (`matchMedia`, `localStorage`, `navigator.onLine`) için
  **`useSyncExternalStore`** kullanılır — `useState` + `useEffect` değil.
  React 19'un `react-hooks/set-state-in-effect` kuralı bunu zorunlu kılıyor.
  Mevcut örnekler: `use-media-query.ts`, `use-favorites.ts`,
  `use-online-status.ts`.
- Veri getirme `AppShell.tsx` içindeki `fetchPlaces` üzerinden; yarış
  koşulları **istek-id koruması** ile çözülür (yavaş bir eski yanıt yeni
  sonucu ezmez).

### 5.5 Stil

- Renk, kenarlık, gölge **yalnızca** `globals.css`'teki token'lardan gelir:
  `var(--brand)`, `var(--surface)`, `var(--text)`, `var(--text-secondary)`,
  `var(--border)`, `var(--surface-sunken)`, `var(--warning)`, ...
- **Sabit hex yazma.** Token'lar tema duyarlıdır; hex yazmak karanlık modu
  bozar.
- İkonlar yalnızca `lucide-react`'ten. Emoji kullanma.
- Kategori renkleri `categories.ts` içinde `pin`/`tint`/`onTint` olarak
  tanımlıdır; başka yerde tanımlama.

### 5.6 Erişilebilirlik — pazarlık konusu değil

Bu uygulamanın hedef kitlesi arasında **erişilebilir tesis arayan insanlar**
var. Erişilebilirliği bozan bir değişiklik, ürünün varlık sebebini bozar.

- Lighthouse erişilebilirlik puanı **100** ve öyle kalmalı.
- Metin kontrastı en az **4.5:1** (WCAG AA). Sınırda geçmek yeterli değil —
  bu depoda 4.51:1 ölçülüp payı artırılmış bir vaka var.
- **Bir kontrolü `opacity` ile soluklaştırma.** "Daha az önemli" demek için
  yapılan soluklaştırma, metni okunamaz hale getirir. Vurguyu kenarlık veya
  arka planla azalt.
- Dokunma hedefleri ≥ 44×44 px, aralarında yeterli boşluk.
- `maximumScale`/`user-scalable=no` **yasak** (WCAG 1.4.4). Form alanları
  ≥16px olmalı, yoksa iOS Safari odaklanınca yakınlaştırır ve geri çıkmaz.
- Hareket eklerken `prefersReducedMotion()` kontrol et.
- Görsel bir gösterge asla tek başına renk olmasın.

---

## 6. Veri dürüstlüğü kuralları — bu projenin sözleşmesi

Bu kurallar estetik değil. İhlali, kullanıcının boşuna yürümesi demektir.

1. **`null` "bilinmiyor" demektir, "yok" demek değil.** Özellik (amenity)
   alanları `boolean | null`'dır. Bir özellik filtresi asla `null`'ı
   eşleştirmez, ve UI asla `null`'ı "yok" gibi göstermez.
2. **Bilinmeyeni uydurma.** Yeni bir mekan kaydı üretirken (ör. onaylanan
   kullanıcı önerisi) söylenmemiş her alan `null` kalır.
3. **Kaynak dürüstlüğü.** OSM verisi ODbL'dir; kullanıcı katkısı değildir.
   `source.slug` her kaydın gerçekte nereden geldiğini söyler.
4. **Sessizlik kapalı demek değil.** Mekanların yalnızca %5,5'inde çalışma
   saati var. "Kapalıları gizle" filtresi yalnızca *kapalı olduğu bilinenleri*
   eler.
5. **Girilemeyen yer listelenmez.** `access=private`/`no` olan kayıtlar sonuç
   döndürmez. `customers`/`permit` döner **ama etiketlenir**.
6. **Cevabı bizde olmayan soruya emin cevap verme.** "Nöbetçi eczane" nöbet
   listesi açık veride yoktur; sorgu bunu söyler ve resmî kaynağa yönlendirir
   (`QUERY_NOTICES`, `categories.ts`).
7. **Türkçe harf katlaması.** JS'in `toLowerCase()`'i "I"yı "i"ye çevirir,
   noktasız "ı"ya değil. `normalizeTr` / `foldAscii` kullanmadan metin
   karşılaştırma yapma — "KADIKÖY" asla "Kadıköy" ile eşleşmez.
8. **Anlık görüntü değişmezdir.** Yönetici düzeltmeleri ve topluluk
   doğrulamaları `contributions.json` içinde **override** olarak durur ve
   okuma anında bindirilir. OSM anlık görüntüsü yeniden içe aktarılabilir
   kalmalıdır.

---

## 7. API ve veritabanı kuralları

### API sözleşmesi

- `frontend/src/lib/types.ts` ile `backend/app/schemas/` **aynı sözleşmeyi**
  konuşur. Birini değiştirip diğerini değiştirmemek sessiz bir kırılmadır.
- Demo API route'ları (`frontend/src/app/api/`) backend ile **aynı sorgu
  sözleşmesini** uygular. Bunun amacı, gerçek backend'e geçişin bir
  taban-URL değişikliği olmasıdır.
- **Mevcut bir alanı kaldırmak, yeniden adlandırmak veya tipini değiştirmek
  kırıcı değişikliktir** ve maintainer onayı gerektirir (§10).
- Yeni alan eklemek geriye dönük uyumludur; eklerken hem `types.ts`'i hem
  backend şemasını güncelle ve README'nin "API Sözleşmesi" bölümünü de.

### Veritabanı ve migration

- Şema değişikliği **her zaman** Alembic migration'ı ile yapılır.
  `create_all` ile üretilen şemaya güvenip migration atlama.
- **Bilinen durum:** depoda henüz gerçek bir Alembic migration'ı yok; şema
  `create_all` ile kuruluyor (README "Bilinen Sınırlamalar" bunu söylüyor).
  İlk migration'ı yazmak yüksek riskli bir iştir ve maintainer onayı ister.
- PostGIS'e özgü tipleri (geometri, GiST indeks) SQLite'a uydurmaya çalışma.
  Coğrafi indeksleme bilinçli bir mimari karardır.
- Migration'lar geri alınabilir olmalı (`downgrade` doldurulmuş).

---

## 8. Test kuralları

```bash
cd frontend && npm test          # 111 test geçmeli
cd frontend && npx tsc --noEmit  # 0 hata
cd frontend && npm run lint      # 0 hata
cd frontend && npm run build     # başarılı
cd backend  && uv run pytest tests/ -v
```

- **Frontend testleri saf mantık katmanına odaklanır** (`src/lib/`): sorgu
  motoru, çalışma saati ayrıştırıcısı, geo hesapları, Türkçe normalizasyon,
  URL durumu, idari çözümleme, katkı kuralları. Bu depodaki gerçek
  regresyonların tamamı bu katmandaydı, React ağacında değil.
- **Test yorumları *neden* var olduklarını anlatır.** Mevcut testlere bak:
  her biri kullanıcının güvendiği bir vaadi kilitler. Aynı standardı tuttur.
- **Bir hatayı düzeltirken önce o hatayı yakalayan testi yaz.**
- Testler `frontend/data/contributions.json` gibi gerçek çalışma zamanı
  dosyalarını **bozmamalı**.
- Backend testleri veritabanı yoksa `skip` olur (fail değil). Yerelde "geçti"
  görmek testin çalıştığı anlamına gelmez — `docker compose up -d db` olmadan
  DB testleri koşmaz.

---

## 9. Kırılgan alanlar — dokunmadan önce oku

### MapLibre worker (`MapCanvas.tsx` + `scripts/copy-maplibre-worker.mjs`)

MapLibre v6 ESM-only'dir ve herhangi bir bundler altında `setWorkerUrl()`
zorunludur. Turbopack worker'ı **kardeş modülü olmadan** üretir; worker
açılışta patlar ve harita **hiç hata vermeden bomboş** kalır (stil yüklenir,
sprite yüklenir, sıfır tile isteği çıkar). Çözüm: her iki dosyayı da
`public/maplibre/` altına kopyalamak. `setWorkerUrl` çağrısını veya kopyalama
script'ini kaldırma.

### Service worker (`public/sw.js`)

Hatalı bir service worker kullanıcıda kalıcıdır. Kurallar:
- Önbellek adları `VERSION` içerir; **önbelleğe yazma kuralları değişirse
  `VERSION`'ı artır** — `activate` eski önbellekleri siler, zaten
  zehirlenmiş girdinin tek çıkış yolu budur.
- Yazma istekleri (POST/PATCH/DELETE) ve `/api/admin/*` **asla**
  önbelleklenmez.
- Gezinmeler yol bazında anahtarlanır; hepsini `/` altına yazmak `/admin`
  belgesini ana sayfanın arkasına park eder.
- Worker boşta kalınca sonlandırılır: yanıttan sonra devam eden işi
  `event.waitUntil` ile sar.
- Service worker yalnızca production'da kaydolur (`ServiceWorkerRegistrar`);
  dev sunucusunun önünde HMR'ı keser.

### `AppShell.tsx`

Büyük ve çok sayıda birbirine bağlı durum tutar (konum takibi ↔ şehir
seçimi, viewport tazeliği, sheet snap noktaları, favoriler, URL senkronu).
Değişiklikten önce ilgili bölümün tamamını oku. `eslint-disable` satırları
gerekçeleriyle birlikte yazılmıştır; gerekçeyi okumadan kaldırma.

### `places-repository.ts`

Sorgu motoru. Filtre sırası, genişletme merdiveni ve facet hesabı birbirine
bağlıdır. Facet sayaçları filtrelerin gerçekte döndürdüğü sayıyla **birebir
aynı** olmak zorundadır — testler bunu kilitler.

---

## 10. Risk seviyeleri ve onay gereksinimi

### 🟢 Low risk — serbestçe katkı yapılabilir

- Türkçe metin/çeviri düzeltmeleri
- Dokümantasyon (README, CONTRIBUTING, ROADMAP, kod yorumları)
- Mevcut davranışı kilitleyen yeni testler
- `categories.ts` içindeki arama eşanlamlıları (yeni Türkçe kalıp ekleme)
- Erişilebilirlik düzeltmeleri (kontrast, etiket, odak)
- Yeni il verisi çekme (`scripts/fetch_demo_data.py` içine config satırı)
- Salt görsel iyileştirmeler — mevcut token'ları kullanmak şartıyla

### 🟡 Medium risk — review gerekir

- Yeni React bileşeni veya mevcut bileşende davranış değişikliği
- Yeni API route'u (mevcut sözleşmeyi kırmadan)
- `places-repository.ts` içindeki filtre/arama mantığı
- Yeni kategori veya özellik (amenity) eklemek
- `sw.js` değişiklikleri
- Yeni `frontend/src/lib/` modülü

### 🔴 High risk — maintainer onayı ŞART

Bunları issue açıp tartışmadan PR'a dönüştürme:

- **Kimlik doğrulama / yetkilendirme** (herhangi bir şey)
- **Veritabanı şeması ve Alembic migration'ları**
- **API sözleşmesinde kırıcı değişiklik** — alan kaldırma/yeniden
  adlandırma/tip değiştirme
- **Yeni bağımlılık** (frontend veya backend)
- **Teknoloji değişikliği** (framework, harita kütüphanesi, veritabanı)
- **Production yapılandırması, deployment, secret yönetimi**
- **`frontend/data/places.*.json` içeriğini elle düzenlemek** — bu dosyalar
  boru hattının çıktısıdır, elle düzeltme bir sonraki çekimde kaybolur
- **Lisans ve atıf** (OSM ODbL atfı dahil)
- **`.github/workflows/`** değişiklikleri

---

## 11. Claude Code'un uyacağı çalışma kuralları

1. **Önce oku, sonra yaz.** Bir dosyayı değiştirmeden önce ilgili bölümün
   tamamını oku. Bu depodaki kod yoğun şekilde yorumlanmıştır ve yorumlar
   çoğu zaman değişikliğin neden yanlış olacağını açıklar.
2. **İlgisiz dosyaya dokunma.** Görev neyse ona ait dosyaları değiştir.
   "Yolum üstündeydi, düzelttim" yapma.
3. **Gereksiz refactor yapma.** Kod kalitesi bahanesiyle çalışan kodu yeniden
   yazma. Refactor ayrı bir iştir ve ayrıca istenmelidir.
4. **Bağımlılık ekleme.** Bu depoda "en basit çözüm doğru çözümdür" kuralı
   geçerlidir. Yeni paket high-risk'tir (§10).
5. **Mevcut kalıbı takip et.** Yeni kod, çevresindeki kod gibi okunmalı:
   aynı yorum yoğunluğu, aynı adlandırma, aynı deyimler.
6. **Küçük ve odaklı değişiklik yap.** Bir PR bir şey yapar.
7. **Doğrula, varsayma.** Değişiklikten sonra `npx tsc --noEmit`,
   `npm test`, `npm run lint`, `npm run build` çalıştır. Sonucu rapor et.
   Geçmediyse geçtiğini söyleme.
8. **Ölçerek çalış.** "Muhtemelen düzeldi" yerine ölç. Bu depoda bugüne kadar
   bulunan hataların çoğu ölçümle çıktı, akıl yürütmeyle değil.
9. **Şema değişikliğinde migration yaz.** İstisnasız.
10. **API sözleşmesini izinsiz kırma.** §7 ve §10'a bak.
11. **Emin değilsen sor.** Mimari bir değişikliğin gerektiğini düşünüyorsan
    kendiliğinden uygulama; önce bildir.
12. **Yarım iş bırakma.** Bir görevin bir kısmı engellendiyse geri kalanını
    tamamla ve neyi neden yapmadığını açıkça söyle.

### Yapma

- `git reset --hard`, force push, history rewrite, dal silme
- İstenmeden commit veya push
- `frontend/data/contributions.json`'ı elle düzenlemek (çalışma zamanı durumu)
- Testleri geçirmek için testi zayıflatmak
- `eslint-disable` eklemek (gerekçesini yazmadan)
- Kullanıcıya görünen metni İngilizce yazmak

---

## 12. Git ve dal kuralları

- Ana dal: `main`. **Doğrudan push kapalı** (bkz. `docs/GITHUB_SETUP.md`).
- Dal adlandırması ve commit kuralları: [CONTRIBUTING.md](CONTRIBUTING.md).
- Commit mesajları **neyi neden** değiştirdiğini anlatır. Bu depodaki mevcut
  commit'ler bu standarttadır; `git log` ile bak.
- Claude Code'un ürettiği commit'lerin sonunda:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## 13. Bilinen sınırlamalar (uydurma değil, gerçek)

Bunlar README'de de yazılıdır ve bilinçli kabul edilmiş durumlardır:

- Demo, gerçek backend yerine yerel JSON adaptörüyle çalışır.
- `frontend/src/app/api/admin/*` route'larında **kimlik doğrulama yoktur.**
- Depoda gerçek bir Alembic migration'ı yoktur.
- Backend hiç canlı veritabanına karşı çalıştırılmamıştır (bu geliştirme
  ortamında Docker/Postgres yoktu).
- 81 ilin 9'u kapsanmaktadır.
- Fotoğraf desteği yoktur (OSM'de ölçülen kapsam %2,3 olduğu için ertelendi).
- `backend/app/core/config.py`, var olmayan bir `docs/ARCHITECTURE.md`
  dosyasına atıf yapar.

Bu listeyi güncel tut. Bir sınırlama giderildiğinde buradan ve README'den
kaldır; yenisi ortaya çıkarsa ekle. **Var olmayan bir yeteneği varmış gibi
belgelemek, eksik belgelemekten daha zararlıdır.**
