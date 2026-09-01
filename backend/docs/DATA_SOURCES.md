# Veri Kaynakları

buradane'e giren her veri, kullanım şartları kontrol edilmeden sisteme alınmaz.
Bu doküman, entegre edilen (veya entegrasyonu planlanan) her kaynağın lisansını,
güncellik durumunu ve güvenilirlik ağırlığını kayıt altına tutar - kaynak
kodundaki `DataSource` tablosunun insan-okunur karşılığıdır.

## Aktif Kaynaklar (v1)

| Kaynak | Tür | Lisans | Format | API | Coğrafi Veri | Güvenilirlik Ağırlığı | Güncelleme Sıklığı |
|---|---|---|---|---|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org) (Overpass API) | `openstreetmap` | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | JSON (Overpass QL sorgu sonucu) | Evet (Overpass API, ücretsiz, hız sınırlı) | Evet (node/way/relation) | 0.75 | Topluluk katkısına bağlı, sürekli |
| [TurkiyeAPI](https://turkiyeapi.dev) ([github.com/ubeydeozdmr/turkiye-api](https://github.com/ubeydeozdmr/turkiye-api)) | `government_other` (idari sınır referans verisi) | MIT | JSON (REST + statik dataset) | Evet | İl/ilçe/mahalle/köy sınırları ve nüfus | — (idari hiyerarşi kaynağı, Place güvenilirliğine girmez) | Yıllık (2025 dataset sürümü) |
| Kullanıcı katkıları (öneri/rapor/doğrulama) | `user_submission` | N/A (kullanıcı üretimi) | — | — | Evet (kullanıcı GPS/konum girişi) | 0.4 (varsayılan, moderasyon sonrası) | Anlık, moderasyon kuyruğuyla |

## Planlanan Kaynaklar (henüz entegre edilmedi)

Bu kaynaklar araştırıldı ancak **henüz koda bağlanmadı** - buraya, ileride
entegre edilirken lisans kontrolünün atlanmaması için not düşülüyor.

| Kaynak | Tür | Lisans Durumu | Not |
|---|---|---|---|
| [İBB Açık Veri Portalı](https://data.ibb.gov.tr) | `municipality_ckan` | Portal bazında kontrol edilmeli (CKAN, çoğu veri seti CC-BY/CC0 görünüyor - **her veri setinin kendi lisans alanı entegrasyon öncesi tek tek doğrulanmalı**) | 41+ CKAN endpoint'i mevcut; İstanbul pilot genişlemesinde öncelikli |
| [ULAŞAV - Ulusal Akıllı Şehir Açık Veri Platformu](https://ulasav.csb.gov.tr) | `municipality_ckan` | Portal bazında kontrol edilmeli (CKAN, `/api/3`) | İBB ile aynı CKAN mimarisi - tek bir "CKAN harvester" adaptörüyle ikisi de servis edilebilir (henüz yazılmadı) |
| Diğer büyükşehir belediyeleri (Ankara, İzmir, Antalya, Bursa, Kocaeli, Adana, Gaziantep, Konya) açık veri portalları | `municipality_ckan` | Her biri ayrı ayrı doğrulanmalı | Rollout sırasına göre (bkz. README "Yol Haritası") |

## ODbL Yükümlülükleri (OpenStreetMap)

- **Attribution**: Uygulama içinde ve API dokümantasyonunda "© OpenStreetMap
  katkıda bulunanları" ibaresi gösterilir.
- **Share-Alike**: OSM'den türetilen coğrafi veritabanı (buradane'in kendi
  `places` tablosu, OSM kaynaklı kayıtlar için) ODbL kapsamındadır; bu veriler
  ham dosya olarak yeniden dağıtılmaz, yalnızca buradane API'si üzerinden
  atıfla birlikte sunulur.
- Ham OSM verisi bu repoda **saklanmaz** - `app/ingest/osm_overpass.py` her
  çalıştığında canlı Overpass API'sinden çeker.

## Güvenilirlik Ağırlığı Nedir?

`DataSource.reliability_weight` (0.0-1.0), `app/services/reliability.py`'nin
bir Place'in güvenilirlik skorunu hesaplarken kullandığı taban değerdir -
bkz. o dosyanın modül docstring'i. Sabit bir kural değildir; bir kaynağın
gerçek güncellik/doğruluk geçmişi zamanla değiştikçe elle ayarlanabilir.
