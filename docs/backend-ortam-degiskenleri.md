# Backend Ortam Değişkenleri

Backend ayarları `BURADANE_` önekiyle ortamdan veya `backend/.env`
dosyasından okunur. Kaynak: `backend/app/core/config.py`.

`backend/.env` **`.gitignore`'dadır ve asla commit edilmemelidir.**

> Depoda `.env.example` dosyası yoktur. Bu belge onun yerini tutar: aşağıdaki
> bloğu `backend/.env` olarak kaydedip değerleri düzenleyebilirsin. Yerel
> geliştirme için hiçbir değeri değiştirmen gerekmez — varsayılanlar
> `docker compose up -d db` ile çalışır.

---

## Kopyalanabilir şablon

```ini
# --- Veritabanı ------------------------------------------------------------
# docker-compose.yml içindeki PostGIS servisiyle eşleşen yerel varsayılan.
BURADANE_DATABASE_URL=postgresql+psycopg://buradane:buradane@localhost:5432/buradane

# --- Kapsam ----------------------------------------------------------------
BURADANE_ACTIVE_COUNTRY=TR

# --- Kimlik doğrulama ------------------------------------------------------
# ⚠️ ÜRETİMDE MUTLAKA DEĞİŞTİR — aşağıdaki uyarıyı oku.
BURADANE_JWT_SECRET=dev-secret-change-in-production
BURADANE_JWT_ALGORITHM=HS256
BURADANE_JWT_EXPIRE_MINUTES=20160

# --- Veri güvenilirliği ----------------------------------------------------
BURADANE_STALE_AFTER_DAYS=90

# --- CORS ------------------------------------------------------------------
BURADANE_CORS_ORIGINS=["http://localhost:3000"]
```

---

## Değişkenler

| Değişken | Varsayılan | Ne işe yarar |
|---|---|---|
| `BURADANE_DATABASE_URL` | `postgresql+psycopg://buradane:buradane@localhost:5432/buradane` | SQLAlchemy bağlantı dizesi. `psycopg` (v3) sürücüsü zorunlu. |
| `BURADANE_ACTIVE_COUNTRY` | `TR` | ISO 3166-1 alpha-2. v1 tam olarak bir ülkeyi aktif eder. Şema ülkeye sabitlenmiş değildir (`AdminRegion.country_code`, `Place.country_code`), ama v1'de yalnızca TR aktiftir. |
| `BURADANE_JWT_SECRET` | `dev-secret-change-in-production` | Token imzalama sırrı. **Aşağıdaki uyarıya bak.** |
| `BURADANE_JWT_ALGORITHM` | `HS256` | |
| `BURADANE_JWT_EXPIRE_MINUTES` | `20160` (14 gün) | Token ömrü. |
| `BURADANE_STALE_AFTER_DAYS` | `90` | Bu süreden eski bir doğrulama/bildirim hâlâ gösterilir ama güvenilirlik skorunda **düşük güvenli** olarak işaretlenir — sonsuza kadar doğru sayılmaz (`app/services/reliability.py`). |
| `BURADANE_CORS_ORIGINS` | `["http://localhost:3000"]` | JSON dizi biçiminde köken listesi. |

---

## ⚠️ JWT sırrı hakkında

`config.py` içinde **çalışan bir varsayılan** var:
`"dev-secret-change-in-production"`. Bu, geliştirmeyi kolaylaştırmak için
bilinçli bir tercih — ama değiştirilmeden dağıtılırsa, sırrı bilen herkes
geçerli token üretebilir. Değer depoda açıkça yazılı olduğu için bu "herkes"
demektir.

Üretim değeri tahmin edilemez ve uzun olmalı:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Bu, `ROADMAP.md`'de açık bir madde olarak izleniyor.

---

## Frontend ortam değişkenleri

| Değişken | Zorunlu mu | Ne işe yarar |
|---|---|---|
| `BURADANE_SITE_URL` | Hayır | Sitemap'te kullanılan mutlak taban URL (ör. `https://buradane.app`). Tanımlı değilse bariz-sahte bir yer tutucu kullanılır — dağıtımda mutlaka ayarla. |
| `BURADANE_ADMIN_TOKEN` | Yönetim paneli kullanılacaksa evet | `/api/admin/*` uçlarını koruyan paylaşılan sır. **Tanımlı değilse admin yazma uçları kapalıdır** (fail-closed) — panel bunu açık bir mesajla söyler. `NEXT_PUBLIC_` öneki YOKTUR ve olmamalıdır: o önek değeri her ziyaretçinin JavaScript'ine gömer. |

Yerel geliştirme için `frontend/.env.local` dosyasına yaz (Next.js otomatik
okur, dosya `.gitignore`'dadır):

```ini
BURADANE_ADMIN_TOKEN=uzun-ve-tahmin-edilemez-bir-deger
```

Üretim değeri için:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```
