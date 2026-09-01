# buradane

**"Burada ne var?"** — Türkiye'deki kamusal ve ihtiyaç alanlarını (tuvalet,
park, içme suyu, spor alanı, cami, kütüphane, otopark, toplanma alanı ve
daha fazlası) keşfetmeye yarayan, ihtiyaç-odaklı bir kamusal alan bulma
platformu.

Bu, "küçük bir Google Haritalar" değildir. Amaç genel amaçlı harita değil,
**"Şu anda neye ihtiyacım var ve bunu en yakın nerede bulabilirim?"**
sorusuna hızlı ve güvenilir cevap vermek.

## v1 Kapsamı

v1 **sadece Türkiye** içindir. Mimari ülke-agnostik tasarlandı (bkz.
`AdminRegion`, `Place.country_code`, `Settings.active_country`) ama kod
içinde hiçbir yerde "Turkey" sabiti hardcode edilmedi - ileride başka bir
ülke eklenmek istenirse bu bir mimari değişiklik değil, bir konfigürasyon +
veri yükleme işi olacak. Şu an için tek aktif ülke Türkiye.

**Pilot sıra**: İstanbul → Ankara/İzmir/Antalya/Bursa/Kocaeli/Adana/
Gaziantep/Konya → geri kalan 81 il. Altyapı (idari hiyerarşi, veri modeli)
81 ilin tamamını gün 1'den itibaren destekler; sadece veri doldurma bu
sırayla ilerler.

## Neden bu mimari?

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

## Proje Yapısı

```
buradane/
├── backend/          # FastAPI API (bu README'nin çoğu backend'i anlatıyor)
│   ├── app/
│   │   ├── models/    # SQLAlchemy ORM (Place, Category, AdminRegion, DataSource, User, ...)
│   │   ├── schemas/   # Pydantic API sözleşmesi (DB şemasından kasıtlı olarak ayrı)
│   │   ├── services/  # reliability (güvenilirlik skoru), search (coğrafi arama), dedup, moderation
│   │   ├── api/       # FastAPI router'ları
│   │   └── ingest/    # Tek seferlik/tekrarlanabilir veri yükleme script'leri
│   ├── tests/
│   ├── alembic/
│   └── docker-compose.yml
├── docs/
│   └── DATA_SOURCES.md   # Her veri kaynağının lisansı, güncelliği, güvenilirlik ağırlığı
└── frontend/          # (henüz başlanmadı - bkz. Yol Haritası)
```

## Kurulum

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

## API

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

## Veri Güvenilirliği

Her `Place`, hangi kaynak(lar)dan geldiğini (`PlaceSourceRecord` →
`DataSource`), ne zaman son doğrulandığını, kaç kez doğrulandığını ve
çözülmemiş kaç çelişen rapor olduğunu taşır. Bunlardan tek, açıklanabilir bir
`reliability_score` (0.0-1.0) hesaplanır (`app/services/reliability.py`) ve
kullanıcıya asla çıplak sayı değil, "Bugün doğrulandı" / "3 gün önce
güncellendi" / "2 ay önce doğrulandı" gibi okunabilir bir etiket olarak
gösterilir (`freshness_label`). Formül basit, test edilebilir, elle
ayarlanabilir bir fonksiyondur - v1'de bir ML modeli değil.

Kaynakların kendi lisans/güncellik/güvenilirlik detayları için
[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)'e bakın.

## Test

```bash
cd backend
uv run pytest tests/ -v
```

İki katmanlı test stratejisi:
- **Saf mantık testleri** (`test_reliability.py`, `test_dedup_math.py`) - veritabanı gerektirmez, her ortamda çalışır.
- **Veritabanı-bağımlı testler** (`test_search.py`, `test_dedup_integration.py`, `test_moderation.py`) - gerçek bir PostGIS bağlantısı gerektirir; `docker compose up -d` çalışıyorsa yerelde, yoksa CI'da (`.github/workflows/ci.yml`, `postgis/postgis` servis konteyneri ile) çalışır. Veritabanı yoksa bu testler **skip** edilir, başarısız olmaz - sahte bir "yeşil" göstermek yerine dürüst bir sinyal.

## Güvenlik

- Yazma uçları girdi doğrulaması için Pydantic şemalarını kullanır (`app/schemas/`).
- Kullanıcı katkıları (öneri/rapor) moderasyon onayı olmadan asla herkese açık aramaya düşmez.
- JWT tabanlı opsiyonel kimlik doğrulama (`python-jose`), şifreler `passlib[bcrypt]` ile hash'lenir.
- `BURADANE_JWT_SECRET` prod'da mutlaka değiştirilmeli - varsayılan değer sadece yerel geliştirme içindir.

## Yol Haritası

**v1 (şu an)**: Türkiye haritası, konum, yakındaki yerler, kategori sistemi,
temel kategoriler (tuvalet/park/su/dinlenme), yer detayı, arama/filtreleme,
yol tarifi (harici harita uygulamasına link), OSM entegrasyonu, Türk idari
bölge sistemi, kullanıcı önerisi/raporu, temel admin paneli, veri
güvenilirliği, mobil öncelikli responsive arayüz.

**v2 (planlanan, henüz başlanmadı)**: Fotoğraflar, yorumlar/değerlendirmeler,
favoriler, offline bölge indirme, erişilebilirlik/ihtiyaç profiline göre
kişiselleştirme, doğal-dilde AI destekli arama, gelişmiş öneriler, oyunlaştırma
(katkı puanı/rozet), Next.js + MapLibre GL JS frontend (PWA, iOS/Android'e
hazır API katmanı).

## Bilinen Sınırlamalar

- **Henüz gerçek bir Alembic migration'ı yok.** Bu geliştirme ortamında
  Docker/Postgres erişilebilir olmadığı için `alembic revision --autogenerate`
  çalıştırılamadı - şema `Base.metadata.create_all()` ile oluşturuluyor
  (yukarıdaki kurulum adımı). İlk gerçek migration, bir Postgres'e erişimi
  olan bir ortamda (yerel Docker veya CI) üretilmeli.
- **Frontend henüz yok.** Next.js + MapLibre GL JS planlanıyor, bkz. Yol Haritası.
- **İBB/ULAŞAV entegrasyonu henüz yazılmadı** - araştırıldı, `docs/DATA_SOURCES.md`'de not düşüldü, lisans doğrulaması entegrasyon öncesi tek tek yapılmalı.

## Lisans

Kaynak kodu [MIT](LICENSE). OpenStreetMap'ten alınan coğrafi veri ayrıca
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) altındadır - bkz.
[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).
