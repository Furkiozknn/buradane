# Denetim: buradane (29 Eylül 2026)

Yenilemeden önce `main`'in (`118c221`) taze bir kopyasında, yerelde ve gerçek tarayıcıda ölçüldü. Ölçülemeyen şey "ölçülmedi" diye yazıldı; ölçülmeyen hiçbir sayı yazılmadı. Ortam: Windows 11, Node 24.19, 8 GB RAM, GPU ve Docker yok.

## README komutları

| Komut | Sonuç |
|---|---|
| `cd frontend && npm install` | 43 sn, 0 açık. `unrs-resolver` için "allow-scripts" uyarısı çıkıyor (zararsız, kurulum tamam) |
| `npm run dev` | 5,5 sn'de hazır; ilk istek 17 sn (Turbopack derlemesi + İstanbul dosyasının soğuk yüklemesi) |
| `npm test` | 228 test geçti (yenileme sonrası 276). Süre ~5 dk: sorgu motoru testleri gerçek il dosyalarını yüklüyor |
| `npm run lint` | temiz |
| `npx tsc --noEmit` | 0 hata |
| `npm run build` / `npm start` | 53 sn, başarılı; 200 dönüyor |
| `node scripts/demo-kaydet.mjs` | çalışıyor (Playwright depoda yok; betik açıklayıcı bir hata veriyor, `PLAYWRIGHT_PATH` ile çalıştırıldı). 45 kare üretti, sayılar README'dekilerle eski sürümde birebir tuttu (Park 248, Cami 454, Tuvalet 121, arama 19) |
| `cd backend && uv sync` | 12 sn |
| `uv run pytest tests/ -v` | **66 geçti, 53 atlandı** (119 test; atlananlar PostGIS ister, Docker yok, README'de yazdığı gibi "skip", "fail" değil) |
| `uv run uvicorn app.main:app` | ayağa kalkıyor, `/docs` 200, varsayılan JWT sırrı uyarısı basıyor (beklenen) |
| `docker compose up -d --wait`, `alembic upgrade head`, `seed_categories`, `turkiye_api`, `osm_overpass`, DB'li uçlar (`/health`, `/places`) | **ölçülmedi**: Docker/PostGIS yok. DB'siz `/health` 60 sn içinde yanıt vermedi (DB bağlantısı bekliyor); bu bir hata olarak değil, ortam sınırı olarak yazıldı |

## Ana akış (gerçek tarayıcı, Chromium/Playwright)

Konum izni ve coğrafi konum emüle edildi (Sultanahmet). 390x844 (telefon) ve 1280x800 (masaüstü):

| Adım | Yenileme öncesi | Sonrası |
|---|---|---|
| Açılış | Harita + çip satırı; ne olduğunu söyleyen cümle yok | Tek cümle + tek büyük düğme |
| Konum ver | Sağ alttaki yuvarlak düğme (etiketsiz simge) | Büyük "Yakınımdakileri bul"; sonuç "Konumundasın" |
| Kategori seç → yakın sonuçlar | Çalışıyor | Çalışıyor (+ yumuşak liste geçişi) |
| Yön oku / mesafe | Çalışıyor; kart etiketi "59 m uzaklıkta, güney yönünde" | Aynı (+ İngilizce: "59 m away, to the south") |
| "Evet, burada" | Düğme kayboluyor, "kaydettik" satırı; odak `<body>`'ye düşüyor; aynı yer ertesi açılışta yeniden isteniyor | `role=status` duyurusu, odak sonuca, güncel sayı, aynı gün hatırlanıyor |
| Serbest metin ("ÜCRETSİZ TUVALET") | Çalışıyor (büyük harf ve ek) | Çalışıyor, davranış aynı (71 sonuç · en yakın 54 m) |
| Konum reddedilince | Küçük "değiştir" bağlantısı | Büyük düğme "Şehir seç" olur |

Konsol hataları: hiçbir akışta yok (Playwright `console.error`/`pageerror` + Lighthouse `errors-in-console` 0). Yeni tarayıcı betiği `frontend/scripts/akis-dogrula.mjs`: 21 kontrol, hepsi geçti.

## Bulunan sorunlar ve durum

Yenilemeden önce ölçüldü; hepsi bu değişiklikte düzeltildi (aksi belirtilmedikçe).

1. **Yanlış sabit sayı.** Filtre penceresi "açık kaynak verinin %94'ünde çalışma saati yok" diyordu. Anlık görüntüde 167.835 kayıttan 3.039'unda saat var: **%98,2'sinde yok** (CLAUDE.md §6.4'ün %1,81'iyle uyumlu). Metin ve `categories.ts` yorumu düzeltildi.
2. **Sayıya yanlış ek.** "721 sonuçtan 200'i": 200 için doğrusu "200'ü"; sayıya ek getiren kalıp yanlış kalıyordu (aynı sınıf bir yorumla zaten belgelenmişti). Kalıp "…sonuçtan 200 tanesi" oldu, ek gereken yer kalmadı.
3. **Masaüstü yerleşim sıçraması (CLS 0,245).** Sunucu herkese telefon yerleşimini çizip istemci ölçünce kenar çubuğuna sıçratıyordu. Sunucu artık istek başlıklarından cihaz sınıfını tahmin ediyor; yanlışsa istemci ölçümü yine son sözü söyler. CLS 0,245 → 0,007.
4. **Masaüstü erişilebilirlik 96.** Lighthouse `target-size`: sağ alttaki konum düğmesi haritanın atıf düğmesiyle çakışıyordu. Yukarı alındı; 100.
5. **Telefonda filtre dokunulmaz oluyordu.** Bir yerin detayından listeye dönünce yer "seçili" kalıyor ve yüzen kartı (panel tam açıkken) ekranın en üstüne, arama kutusu ve filtre düğmesinin üzerine biniyordu. Playwright `click` "başka bir öğe dokunmayı yakalıyor" diye zaman aşımına uğradı. Panel tam açıkken kart gösterilmiyor.
6. **"Bu alanda ara" hayalet düğmesi.** Uygulamanın kendi yaptığı hareketler (ilk sığdırma, panel dolgusu) de "harita kaydırıldı" sayılıyordu; taze açılmış haritada nedensiz siyah bir düğme duruyordu. Artık yalnızca kullanıcı hareketinde (`originalEvent`) çıkıyor.
7. **Kontrast.** `--text-muted` açık temada `--surface-sunken` üstünde 4,40:1 (eşik 4,5). Ölçen test eklenince ortaya çıktı; `#736c67` ile 4,73:1.
8. **Atlama bağlantısı boşa gidiyordu.** Kök düzendeki "Sonuç listesine geç" bağlantısının hedefi (`#sonuclar`) yalnızca harita ekranında var; `/yer/[id]` ve `/admin`'de hiçbir yere gitmiyordu. Harita ekranına taşındı, dile uyuyor.
9. **README kaydı telefon yerleşimini gösteriyordu.** `demo-kaydet.mjs` 1000 px genişlikte çalışıyor; masaüstü eşiği 1024 olduğu için "yan panel" görseli alt sayfa yerleşimiyle çekiliyordu. 1152x738'e alındı.
10. **Arama yazılınca kategori ızgarası açık kalıyordu** (masaüstü); ilk sonuç ekranın altına iniyordu. Arama varken ızgara çip satırına dönüyor.
11. **Yayımlanan test sayısı bayattı**: `project-meta.json` özeti "324 tests", sayı alanı 347 diyordu. İkisi de gerçek koşudan yazıldı (aşağıdaki test bölümü).

Düzeltilmeyen, not düşülen:

- `.github/workflows/frontend.yml` başlık yorumu hâlâ "111 test" diyor (yorum bayat). Yüksek riskli dosya (§10); değiştirilmedi.
- Mobil ana iş parçacığı (TBT ~3 sn, Lighthouse simüle 4x yavaşlatma): baskın maliyet MapLibre + Next çalışma zamanı betik değerlendirmesi (~1,8 sn, iki büyük parça). Bu çalışmada iyileştirilmedi.

## Erişilebilirlik

| Kontrol | Sonuç |
|---|---|
| Lighthouse erişilebilirlik | mobil 100 → 100; masaüstü 96 → 100 |
| Kontrast (WCAG 2.x, hesaplandı, açık + koyu, 12 çift) | hepsi >= 4,5:1 (`tests/contrast.test.ts`); tek ihlal (madde 7) düzeltildi |
| Dokunma hedefi | >= 44 px korunuyor; aramayı-temizle düğmesi yalnızca 16 px'lik simge kadardı, 36x44 hedefe çıkarıldı; dil düğmeleri 44 px |
| Klavye | Doğrulama sonrası odak sonuca taşınıyor (Playwright `activeElement` ölçümü); Escape/Tab tuzağı `use-modal-dialog.ts` ile zaten vardı (değişmedi) |
| Harita dışı alternatif | Sonuç listesi harita olmadan tam işlevli (ok tuşları, Enter, Escape) ve haritada klavye ile işaretçi gezinmesi var; ikisi de aynen duruyor, ekran okuyucu metinleri İngilizceye de çevrildi |
| Etiketler | Kartlar "kategori. ad. mesafe, yön. Detayları aç." okuyor; harita tuvali `aria-label` dile uyuyor; sayfada her zaman bir `h1` (görünmez) |
| Ekran okuyucu ile gerçek dinleme | **ölçülmedi** (yalnızca otomatik denetim ve `role`/`aria` incelemesi) |

## Lighthouse 13.4 (Chrome headless, yerelde `next start`; mobil: simüle yavaş 4G + 4x CPU; 5 koşunun medyanı)

| | Perf | Erişilebilirlik | Best practices | SEO | FCP | LCP | TBT | CLS | Boyut |
|---|---|---|---|---|---|---|---|---|---|
| Önce, mobil | 53 | 100 | 100 | 100 | 1,33 s | 4,68 s | 2916 ms | 0,002 | 466 KiB |
| Sonra, mobil | 52 | 100 | 100 | 100 | 1,34 s | 4,90 s | 3126 ms | 0,002 | 474 KiB |
| Önce, masaüstü | 63 | 96 | 100 | 100 | 0,36 s | 1,03 s | 521 ms | 0,245 | 466 KiB |
| Sonra, masaüstü | 76 | 100 | 100 | 100 | 0,36 s | 1,07 s | 478 ms | 0,007 | 475 KiB |

Mobil performans **değişmedi**: koşular arası dağılım (önce 48-54, sonra 51-53) medyan farkından büyük. Masaüstü gerçekten iyileşti (CLS'in düzeltilmesi). Sayfa ağırlığı +8 KiB (dil kabuğu ve katalog). `mcp__lighthouse__*` aracı Windows'ta geçici profil silerken `EPERM` veriyor (rapor yazıldıktan sonra); rapor dosyası esas alınarak elle koşuldu. Harita FPS'i ve etkileşim gecikmesi ayrıca **ölçülmedi** (yalnızca Lighthouse'un TBT/CLS'i ve akış betiğinin doğrulamaları).

## Test

| | Önce | Sonra |
|---|---|---|
| Frontend (`vitest`) | 228 | 276 |
| Backend (`pytest`, yerelde) | 66 geçti / 53 atlandı | aynı (backend'e dokunulmadı; CI'da PostGIS ile 119 geçiyor) |

Yeni: `i18n.test.ts` (14: dil seçimi, katalog kapsamı, yer tutucular, İngilizce sızıntı), `contrast.test.ts` (25), `verified-store.test.ts` (6), `device.test.ts` (3). Tarayıcı akışı: `scripts/akis-dogrula.mjs` (21 kontrol).

## Günlük "Ekosistem denetimi" (#19, Furkiozknn)

Konu ve yorumlarında `buradane` geçen hiçbir bulgu yok; kapatılacak bir şey bulunmadı. (Konudaki diğer depo bulguları bu çalışmanın kapsamı dışında bırakıldı.)

## Kanıt

- Ekran görüntüleri: `D:\Claude Projeleri\proje-yenileme\kanit\buradane\{once,sonra,sonra-en}\` (390x844 ve 1280x800: açılış, kategori, detay, doğrulama öncesi/sonrası, filtre, şehir seçici).
- Lighthouse ham raporları: `...\kanit\buradane\lighthouse\`.
- README görselleri (`assets/demo.gif`, `harita-ekran-goruntusu*.png`): `demo-kaydet.mjs` ve akış ekran görüntüleriyle yeniden üretildi.
- Günlük video hattı: `D:\Claude Projeleri\sosyal\medya\projeler\buradane\ekran.mp4` (1080x1920, H.264 yuv420p, +faststart, ses yok, 18,7 sn, gerçek kullanım; dokunma halkası yalnızca kayıt betiğinde çiziliyor) ve `komutlar.txt` (gerçek komut çıktıları).
