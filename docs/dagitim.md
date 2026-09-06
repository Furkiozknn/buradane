# Dağıtım (Deployment) Runbook

Bu belge buradane'yi gerçek kullanıcılara açmak için gerekenleri anlatır.
Hosting sağlayıcısına bağımlı olmayan kısımlar önce; sağlayıcıya özgü notlar
sonda.

> **Kapsam.** v1'de yayına giden şey **frontend**'dir: Next.js uygulaması,
> OSM anlık görüntüsünü kendi süreç belleğinden okur ve `/api/*` route'ları
> ile cevaplar. Backend (FastAPI + PostGIS) depoda çalışır durumdadır ve
> testleri CI'da gerçek PostGIS'e karşı koşar, ama frontend henüz ona
> bağlanmaz — aradaki sözleşme farkları
> [api-sozlesme-farklari.md](api-sozlesme-farklari.md) içinde açıkça
> listelidir. Yalnız frontend'i dağıtmak bilinçli ve dürüst bir v1 kararıdır.

---

## 1. Ön koşullar

- **Node.js 20.9+** (CI 20 ve 22 ile koşar)
- Kalıcı ve **yazılabilir** bir disk yolu (aşağıya bakın — bu, atlanınca
  sessizce veri kaybettiren tek ayardır)
- Alan adı ve HTTPS (rate limit'in anlamlı olması proxy'ye bağlıdır, §4)

## 2. Zorunlu ortam değişkenleri

Tam liste: [backend-ortam-degiskenleri.md](backend-ortam-degiskenleri.md).
Dağıtımda **mutlaka** ayarlanacaklar:

| Değişken | Neden zorunlu |
|---|---|
| `BURADANE_SITE_URL` | `sitemap.xml` ve paylaşım bağlantılarının mutlak tabanı. Ayarlanmazsa bariz-sahte bir yer tutucu kullanılır ve arama motorlarına sahte alan adı gider. |
| `BURADANE_DATA_DIR` | Katkıların ve moderasyon override'larının yazıldığı dizin. Varsayılan `<cwd>/data`, yani **salt-okunur bir container'da katkı gönderimi hata verir ve kalıcı olmayan diskte moderasyon kuyruğu her dağıtımda silinir.** Kalıcı bir volume'a işaret etmelidir. |
| `BURADANE_ADMIN_TOKEN` | Yönetim panelini ve `/api/admin/*` uçlarını korur. **Ayarlanmazsa bu uçlar tamamen kapalıdır** (fail-closed) — panel bunu açık bir mesajla söyler. Uzun ve tahmin edilemez olmalı: `python -c "import secrets; print(secrets.token_urlsafe(48))"` |

`BURADANE_ADMIN_TOKEN` için `NEXT_PUBLIC_` öneki **kullanılmaz**; o önek
değeri her ziyaretçinin JavaScript'ine gömer.

## 3. Derleme ve çalıştırma

```bash
cd frontend
npm ci                 # ci, install değil: lock dosyasına birebir uyar
npm run build          # prebuild MapLibre worker'ını kopyalar, tip kontrolü yapar
npm run start          # varsayılan port 3000
```

**Ölçülmüş davranış** (üretim derlemesi, 132.475 kayıt, tek makine):

| | |
|---|---|
| Ana sayfa (soğuk) | **14 ms** |
| İl içi yarıçap sorgusu (soğuk) | **155-177 ms** |
| Aynı sorgu (sıcak) | **20 ms** |
| Sunucu RSS (birkaç il yüklendikten sonra) | **~103 MB** |

Anlık görüntü **tembel** okunur: uygulama açılışta yalnızca `data/meta.json`
(18 KB) okur, bir sorgu geldiğinde ise yalnızca o sorgunun kutusuyla kesişen
il dosyalarını yükler ve önbelleğe alır. Bu yüzden **512 MB'lık bir container
rahat yeter.** (Tüm illeri birden okuyan eski sürüm 7,4 sn açılış ve 433 MB
RSS demekti - üstelik Next.js bunu route ve RSC grafikleri için ayrı ayrı
ödüyordu.)

> Veri tazelendikten sonra `node scripts/build_dataset_meta.mjs` çalıştırmayı
> unutmayın: `meta.json` türetilmiş veridir ve bayat kalırsa uygulama bir
> sayı, harita başka bir sayı gösterir. `npm test` ve doğrulama betiği bu
> kaymayı yakalar.

## 4. Ters proxy (rate limit'in çalışması için şart)

Hız sınırlayıcılar istemciyi `x-forwarded-for` başlığının **ilk** girdisinden
tanır. Bu başlığı **ezen** bir proxy arkasında olmalısınız; başlığı sadece
ekleyen (append) bir yapılandırmada saldırganın kendi başlığı ilk sırada
kalır ve fren işlevsizleşir. nginx için:

```nginx
proxy_set_header X-Forwarded-For $remote_addr;   # add değil, set
proxy_set_header X-Real-IP       $remote_addr;
```

Hiçbir proxy yoksa (çıplak `next start`) tüm ziyaretçiler tek bir `"unknown"`
kovasını paylaşır: katkı gönderimi tüm site için 10 istek/10 dakika ile
sınırlanır. Bu bilinen ve belgelenmiş bir sınırdır
(`frontend/src/lib/rate-limit.ts` dosya başında yazılıdır).

## 5. Service worker sürümü

`frontend/public/sw.js` içindeki `VERSION` sabiti, **önbellekteki bir kaydın
artık geçerli olmayan kurallarla yazılmış olabileceği her durumda**
yükseltilir — özellikle veri kümesi veya API yanıt şekli değiştiğinde.
Yükseltilmezse geri dönen kullanıcı çevrimdışıyken eski veri kümesinin
cevaplarını görür ve "önbellekten" etiketi bunun *verinin* değiştiğini
anlatmaz.

## 6. Dağıtım sonrası doğrulama

```bash
curl -sf "$SITE/api/places?lat=41.0082&lon=28.9784&radius_m=2000&limit=5" >/dev/null && echo "arama ok"
curl -s -o /dev/null -w "%{http_code}\n" "$SITE/api/admin/auth"          # token'sız: 401 bekleniyor
curl -s -o /dev/null -w "%{http_code}\n" "$SITE/yer/node%2F123456"        # 200 ya da 404, 500 değil
curl -sI "$SITE/sitemap.xml" | head -1                                    # 200
```

Ayrıca elle: konum izni vermeden ana sayfayı aç, şehir seçiciden başka bir il
seç, sonuçların **o ile** ait olduğunu ve mesafelerin makul olduğunu gör.

## 7. Geri alma

Dağıtım durumsuzdur; önceki sürüme dönmek yeterlidir. Tek istisna
`BURADANE_DATA_DIR` altındaki katkı dosyasıdır: kalıcı volume'da durur,
sürümle birlikte geri **alınmaz** ve alınmamalıdır (kullanıcı katkıları
kaybolur). Bozuk bir katkı dosyası şüphesi varsa yedekten dönmeden önce
kopyasını alın.

## 8. Veriyi tazeleme

OSM anlık görüntüsü depoda commit'lidir; tazelemek bir kod değişikliğidir:

```bash
uv run --no-project python scripts/fetch_by_district.py --only-missing
node scripts/build_dataset_meta.mjs        # meta.json'u yeniden üret (ZORUNLU)
node scripts/validate_places_data.mjs      # şema + sınır + mükerrer + kapsam
cd frontend && npm test                    # ulusal kapsam testleri dahil
```

Doğrulama betiği kırmızıysa **commit etmeyin**. Overpass hız sınırlıdır ve
betik il bazında checkpoint atar; kesintide `--only-missing` ile kaldığı
yerden devam eder.
