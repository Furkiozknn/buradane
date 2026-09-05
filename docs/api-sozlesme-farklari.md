# Frontend ↔ Backend API Sözleşme Farkları

**Durum: 2026-09-04'te alan alan karşılaştırmayla çıkarıldı; 2026-09-05'te
uç adları ve §7 güncel duruma göre düzeltildi.**

Projenin mimari vaadi, demo'nun yerel JSON adaptöründen gerçek FastAPI+PostGIS
backend'ine geçişin bir **taban-URL değişikliği** olması. Bu belge o vaadin
bugünkü gerçek durumunu kayıt altına alıyor: **şu an geçerli değil** ve
geçerli olması için aşağıdaki farkların kapanması gerekiyor.

Karşılaştırılan kaynaklar:

- Frontend sözleşmesi: `frontend/src/lib/types.ts` (+ `frontend/src/app/api/places/route.ts` sorgu parametreleri)
- Backend sözleşmesi: `backend/app/schemas/place.py` + `backend/app/api/places.py`

> Bu belge bir suçlama listesi değil: backend, frontend'in son haftalarda
> kazandığı alanlardan (access, district, facets, notices…) önce yazıldı.
> Liste, iki tarafın yeniden aynı hizaya getirilme planıdır.

---

## 1. Zarf (envelope) farkı — en temel kırılma

| | Frontend bekliyor | Backend dönüyor |
|---|---|---|
| `GET /places` | `{ places: Place[], total: number, applied: {...}, facets: {...} }` | **çıplak `PlaceListItem[]`** |

`total` olmadan sayfalama, `applied` olmadan "arama genişletildi" iletişimi,
`facets` olmadan filtre çipi sayaçları çalışamaz. **Backend'in zarf dönmesi
gerekiyor** (frontend'in zarfı sökmesi değil — zarftaki alanlar UI'nin temel
özelliklerini besliyor).

## 2. Kimlik (id) şeması farkı

| | Frontend | Backend |
|---|---|---|
| `id` | `"node/123456"` (OSM id, string) | `uuid.UUID` |

Geçişte tüm paylaşılan bağlantılar (`/yer/node%2F123`), kayıtlı yerler
(localStorage'daki favoriler) ve service worker önbelleği eski id'lerle dolu
olacak. **Karar gerekiyor:** backend `osm_ref`'i ikincil arama anahtarı olarak
sunmalı (`GET /places/by-ref/node/123`) ya da API id olarak OSM ref'i
kullanmalı. Sessiz bir id değişimi tüm derin bağlantıları kırar.

## 3. Kategori şekli farkı

| | Frontend | Backend |
|---|---|---|
| `categories` | `("tuvalet" \| "park" \| ...)[]` — slug dizisi | `CategoryOut[]` — `{id, slug, name_tr, name_en, icon}` obje dizisi |

Frontend meta veriyi (etiket, renk, ikon) kendi `categories.ts`'inden alıyor;
slug yeterli. Obje dizisi zararsız ama uyumsuz. En ucuz çözüm: backend liste
yanıtında slug dizisi dönsün, obje listesi ayrı `/categories` ucunda kalsın
(o uç zaten var).

## 4. Liste yanıtında eksik alanlar

Frontend'in **liste** görünümü şunları kullanıyor; backend `PlaceListItem`
bunları içermiyor (bir kısmı `PlaceDetail`'de var, listede yok):

| Alan | Backend durumu | Etki |
|---|---|---|
| `amenities` (12 anahtarlı obje) | Listede yalnız `wheelchair_accessible` düz alan | Kart rozetleri, özellik filtre sonuçlarının görselleştirilmesi |
| `access` | **Modelde ve şemada hiç yok** | `private` eleme + "müşterilere açık" rozeti |
| `district`, `province` | Düz alan yok (`admin_region_id` ilişkisi var) | İlçe araması, kart alt yazısı, paylaşım açıklaması |
| `opening_hours_raw`, `is_24h` | Yalnız Detail'de | "Kapalıları gizle" filtresi listede uygulanamaz |
| `price_type` | ✓ var | — |
| `verification_count`, `report_count` | Hiç yok | Güvenilirlik açıklaması, "N kişi doğruladı" |
| `last_verified_at` | Yalnız Detail'de | — |
| `source {slug, name, license, url}` | Hiç yok (DataSource modeli var, şemaya bağlanmamış) | Atıf (ODbL yükümlülüğü!) ve "Topluluk katkısı" ayrımı |

Ayrıca amenity anahtar listesi birebir aynı değil:

- Frontend'de olup backend'de olmayan: —
- Backend'de olup frontend'de olmayan: `has_elevator`, `near_public_transport`
- İkisinde de olan 12 anahtar uyumlu (`has_ramp`, `is_quiet` dahil)

## 5. Eksik sorgu parametreleri

| Parametre | Frontend kullanımı | Backend |
|---|---|---|
| `q` | Türkçe doğal dil araması (kategori/özellik çözümleme + ad eşleşmesi) | **YOK** — `search_places` yalnızca yapısal filtre alıyor |
| `open_now` | "Kapalıları gizle" | **YOK** |
| `sort` (`distance`/`reliability`) | Sıralama düğmesi | **YOK** (sabit sıralama) |
| `free_only` | ✓ | ✓ (`free_only`) |
| `category`, `amenity` (tekrarlı) | ✓ | ✓ |
| `bbox`, `lat/lon/radius_m`, `limit/offset` | ✓ | ✓ (limit tavanı farklı: FE 300, BE 200) |
| — | — | Backend'de fazladan: `min_reliability`, `admin_region_id` (zararsız) |

`q` en büyük parça: Türkçe çözümleme mantığı
(`parseQueryText`, eşanlamlı tablosu, kademeli genişletme, diakritiksiz
indeks) şu an tamamen frontend adaptöründe yaşıyor. Geçişte bu mantık ya
backend'e taşınmalı ya da (daha gerçekçi ilk adım) Next.js API route'ları
**ince bir uyarlama katmanı** olarak kalıp `q` çözümlemesini yapıp backend'e
yapısal filtre geçmeli. İkinci yol "taban-URL değişikliği" vaadini
"adaptör katmanı backend'i çağırır" biçiminde günceller — dürüst ve ulaşılabilir.

## 6. Katkı uçları farkı

| | Frontend (demo) | Backend |
|---|---|---|
| Uç | `POST /api/contributions` (tek uç, `kind` alanı) | `POST /places/suggest`, `POST /places/{id}/reports`, `POST /places/{id}/verifications` (üç ayrı uç) |
| Doğrulama şekli | `kind: "verify_present"` | `PlaceVerificationIn { field, confirmed_value }` — alan bazlı; tek bildirim yetmez, `verification_consensus` (vars. 2) farklı katılımcı ister |
| Moderasyon | `PATCH /api/admin/contributions/{id}` `{action}` (paylaşılan-sır admin token'ı) | `GET /reports?status=` + `PATCH /reports/{id}` `{"action": "accept"\|"reject"}` (JWT'li moderatör hesabı, `POST /auth/login`) |
| Kimlik modeli | `x-admin-token` başlığı (tek paylaşılan sır) | `POST /auth/login` → Bearer JWT; hesaplar yalnız bootstrap ile açılır |

Uyarlama katmanı yaklaşımı (bkz. §5) bu farkı da route içinde eritebilir.

## 7. Bilinen ve ayrıca duran işler

- `conftest.py`'nin DB erişilebilirlik denetimi düzeltildi (2 sn zaman aşımı);
  `uv run pytest` artık DB'siz ortamda asılı kalmıyor (2026-09-05: 32 geçti,
  49 skip — skip edenler DB isteyenler, CI'da koşuyorlar).
- ✅ Baseline Alembic migration'ı depoda; upgrade→downgrade→upgrade döngüsü ve
  model↔migration eşitliği CI'da test ediliyor (`tests/test_migrations.py`).
- Backend bu geliştirme makinesinde canlı veritabanına karşı koşturulamıyor
  (Docker yok); CI'daki gerçek PostGIS servisi bu boşluğu kapatıyor.

---

## Önerilen kapanış sırası

1. **Zarf** (§1) + **liste alanları** (§4) — backend şemasına `access`,
   `district`, `province`, `amenities` objesi, `source`, sayaçlar; yanıtı
   `{places, total, applied, facets}` zarfına al. Migration gerektirir
   (access + district/province sütunları) — baseline migration artık depoda,
   bu iş onun üstüne yeni bir revizyon olarak gelir.
2. **id kararı** (§2) — `osm_ref` ikincil anahtar önerilir; UUID iç kimlik
   kalır, API dışa OSM ref konuşur.
3. **Parametreler** (§5) — `open_now`, `sort` backend'e; `q` çözümlemesi
   uyarlama katmanında kalır (ilk sürüm), backend'e taşınması ayrı iş.
4. **Katkı uçları** (§6) — uyarlama katmanında eşleme.
5. Bunların hepsi **çalışan bir veritabanına karşı** doğrulanmadan
   "tamamlandı" sayılmaz. CI'daki PostGIS servisi bunun için yeterli:
   sözleşme testleri (`backend/tests/`) her maddeyle birlikte yazılmalı.

Bu sıra ROADMAP'teki "Demo ↔ backend geçişi" bölümünün açılımıdır; madde
kapandıkça iki belge birlikte güncellenmelidir.
