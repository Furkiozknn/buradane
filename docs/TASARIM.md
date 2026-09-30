# Tasarım: buradane arayüz yenilemesi (29 Eylül 2026)

## Hedef

Videodan ya da profilden gelen biri sayfayı açtığında **ilk 30 saniyede** şunu anlamalı ve yapabilmeli: "yakınımdaki tuvalet, su, park, eczane nerede — hangi yönde, ne kadar uzakta, bilgi hâlâ doğru mu?" ve **tek büyük düğmeyle** başlamalı ("Yakınımdakileri bul"). Sonrası ürünün zaten iyi olan kısmı: kategori, sonuç listesi, yön oku, "Evet, burada" doğrulaması, serbest metin araması.

Kimlik korunur: derin yeşil-turkuaz marka rengi, sıcak taş yüzeyler, Inter, harita önde. FRK-OS'in siyah-krem-sarı dili yalnızca altbilgideki küçük `buradane · FRK-OS` satırında (mono, listenin sonunda) ve README görsellerinde.

Sözleşmeye dokunulmadı: sorgu sözleşmesi (`/api/places`, `types.ts`), sıralama, güven skoru, Türkçe arama motoru (`places-repository.ts`, `categories.ts` `SEARCH_SYNONYMS`) aynı. Depolama: yeni anahtarlar eklendi (`buradane:dil`, `buradane:dogrulananlar:v1`); mevcut anahtarlar (`buradane:favorites:v1`) değişmedi, taşıma kodu gerekmedi.

## Önce / sonra

| Konu | Önce | Sonra |
|---|---|---|
| İlk ekran (telefon) | 190 px'lik şerit: yalnızca kategori çipleri; ne olduğunu söyleyen cümle yok | Panel yarım açık başlar (ilk ziyarette): tek cümlelik değer önermesi, tek büyük "Yakınımdakileri bul" düğmesi, güven satırı ("Hesap gerekmez · konum yalnızca yakındakileri bulmak için"), altında kategoriler |
| İlk ekran (masaüstü) | Kategori ızgarası; ne olduğunu söyleyen cümle yok | Aynı cümle + düğme, ızgara hemen altında |
| Konum reddedilince | Düğme yok; küçük "değiştir" bağlantısı | Büyük düğme "Şehir seç"e dönüşür ve şehir seçiciyi açar |
| Dil | Yalnızca Türkçe | TR + EN, varsayılan tarayıcı dili (`tr*` Türkçe), sunucu `Accept-Language` ile ilk boyamayı doğru dilde yapar, tercih `localStorage` `buradane:dil` |
| "Evet, burada" | Düğme dokunuşta kayboluyor; "kaydettik" satırı; ertesi açılışta düğme geri geliyor; klavyede odak `<body>`'ye düşüyor | Sonuç `role="status"` ile duyuruluyor, odak sonuca taşınıyor, güncel doğrulama sayısı gösteriliyor, aynı gün aynı yer yeniden açılınca "bugün senin tarafından doğrulandı" (`buradane:dogrulananlar:v1`) |
| Sonuç sayacı | "200'i" (200'ü olmalı: sayıya ek getirilemez), tek renk | "721 sonuçtan 200 tanesi" / "200 of 721 results"; değişince renk akışı (aşağıda) |
| Kategori değişimi | Liste bir anda yer değiştirir, kaydırma yerinde kalır | Liste başa döner ve 260 ms'lik yumuşak itme/oturma ile gelir |
| Arama yazılınca (masaüstü) | Kategori ızgarası açık kalır, ilk sonuç ekranın altına iner | Izgara yerini çip satırına bırakır, sonuç hemen görünür |
| Harita | Açılışta ve panel değişiminde "Bu alanda ara" hayalet düğmesi | Yalnızca kullanıcı haritayı oynatınca çıkar (`originalEvent`) |
| Detaydan dönünce (telefon) | Seçili yerin yüzen kartı arama kutusu ve filtre düğmesinin üstüne biniyor; filtre dokunulmaz | Panel tam açıkken yüzen kart gösterilmez |
| Masaüstü ilk boyama | Sayfa önce telefon yerleşimiyle gelip kenar çubuğuna sıçrıyor (Lighthouse CLS 0,245) | Sunucu cihaz sınıfını tahmin eder (`sec-ch-ua-mobile`/UA), ilk boyama doğru yerleşimde (CLS 0,007) |
| Masaüstü sağ alt | Konum düğmesi harita atıf düğmesiyle çakışıyor (Lighthouse `target-size`, erişilebilirlik 96) | Düğme yukarı alındı (erişilebilirlik 100) |
| Soluk metin | `--text-muted` açık temada `--surface-sunken` üstünde 4,40:1 | `#736c67`: 4,73:1 |
| Atlama bağlantısı | Kök düzende; hedefi (`#sonuclar`) yalnızca harita ekranında var, diğer sayfalarda boşa gidiyordu | Harita ekranının içinde, seçilen dilde |

Ekran görüntüleri: `kanit/buradane/once/`, `sonra/` (TR), `sonra-en/` (EN); mobil 390x844 ve masaüstü 1280x800: açılış, kategori, detay, doğrulama öncesi/sonrası, filtre, şehir seçici.

## Ekranlar

1. **Açılış (soğuk başlangıç)**: değer önermesi, büyük düğme, güven satırı, kategoriler. Kullanıcı bir şey yapınca (konum, şehir, kategori, arama) kapanır; paylaşılan bağlantı ya da yenileme bu ekranı hiç göstermez.
2. **Sonuçlar**: sayaç, sıralama, kartlar (mesafe + yön oku + açık/kapalı + güven), harita.
3. **Detay**: yol tarifi, kaydet, paylaş, sorun bildir, "Bu yer hâlâ burada mı?".

## Video sisteminden alınanlar

Kaynak: `sosyal/uret/tema.mjs` ve `sosyal/uret/sahne.js`.

| Ne | Nereden | Nerede kullanıldı |
|---|---|---|
| "Harita / plan" temasının renk akışı (turuncu `#ff8c42`, kum `#ffd166`, camgöbeği `#62d6ff`, nane `#7bf1a8`) | `tema.mjs` `harita.akis` | Sonuç sayacı renk akışı (`.count-flow`, 900 ms): iki durak (`--flow-a` → `--flow-b`) sonra normal metin rengine. Video zeminleri koyu olduğu için tonlar şemaya göre yeniden ayarlandı: koyu temada kum + camgöbeği (`#ffd166`, `#62d6ff`), açık temada `#b45309` + marka yeşili `#0b6e5f` |
| `itme` (kısa yatay/dikey itme) ve `zoom` (yüzde 1,5'lik oturma) geçiş aileleri | `sahne.js` geçişleri | Kategori değişiminde liste geçişi (`.list-swap`: 10 px yukarı itme + `scale(.985)` → 1, 260 ms, `cubic-bezier(.16,1,.3,1)`) |

Bilerek alınmayanlar: glitch, blok, flaş, kararma ve iris. Yürürken tek elle kullanılan bir haritada sert efektin yeri yok; iris masalın "son" kartı için uygundu, burada açıklaması yok. Video temalarının neon/koyu zemin paletleri ürünün kimliğine (yeşil-taş) uymadığı için alınmadı; yalnızca sayaç akışı.

Tüm hareket `prefers-reduced-motion: no-preference` içinde. Azaltılmış harekette animasyon hiç tanımlı değil ve genel kural süreleri zaten sıfıra indiriyor.

### Kontrast (hesaplanan)

`tests/contrast.test.ts`, `globals.css`'teki gerçek token'ları okuyup WCAG göreli parlaklığıyla ölçer; açık ve koyu şema, 12 çift, hepsi >= 4,5:1. Yeni akış renkleri:

| Çift | Açık | Koyu |
|---|---|---|
| `--flow-a` / `--surface` | 5,02:1 (`#b45309` / `#ffffff`) | 12,13:1 (`#ffd166` / `#1c1917`) |
| `--flow-b` / `--surface` | 6,16:1 (`#0b6e5f` / `#ffffff`) | 10,48:1 (`#62d6ff` / `#1c1917`) |

Değerler `contrast()` ile ölçüldü; test eşiği 4,5:1 (payı erimeden yakalamak için bir düzeltme de yapıldı: `--text-muted` açık temada 5,16:1 beyaz, 4,73:1 `--surface-sunken` üstünde).

## Yazı tipi

Değişmedi: Inter (yerel paket `@fontsource-variable/inter`), indirme ve Google Fonts yok. FRK-OS satırı sistem mono yazı tipinde (`font-mono`); League Gothic yerel dosya gerektireceği ve ürün yazı diline uymadığı için kullanılmadı.

## Arayüz dili (TR + EN)

- Türkçe cümle **anahtardır**: `t("Filtreler")` İngilizcede "Filters" verir. Türkçe metin tek kaynak; paralel bir Türkçe tablo yok. `lib/i18n.ts` (saf işlevler), `lib/i18n-en.ts` (katalog), `lib/use-locale.tsx` (`useSyncExternalStore`, `LocaleProvider`).
- `tests/i18n.test.ts`: kaynaktaki her `t("...")` (ve tablolardan gelen kategori, özellik, uyarı, rapor seçeneği, veri etiketi cümleleri) için İngilizce karşılık var; kullanılmayan çeviri yok; yer tutucular tutarlı; İngilizce değerde sızmış Türkçe harf yok.
- **Çevrilmeyenler**: mekân adları, adresler ve OSM'den gelen her metin; sayfa `/yer/[id]` (paylaşım sayfası) ve yönetim paneli (yalnızca moderatör, Türkçe). Arama sözcükleri Türkçe kalır: İngilizce arayüzde arama kutusu bunu söyler ("e.g. ücretsiz tuvalet (Turkish)"); İngilizce eşanlamlı uydurulmadı (`SEARCH_SYNONYMS` değişmedi).
- Kategori ve özellik adları arayüzün sabit sözlüğü olduğu için (14 kategori, 12 özellik) İngilizcesi katalogda; veri değil.
- Sayı biçimi dile uyar (12.345 / 12,345). Yön sözcükleri (kuzey / north) ve çalışma saati satırları (İngilizcede OSM'nin kendi gün kısaltmaları) dile uyar.

## Kararlar ve sınırlar

- Yeni bağımlılık yok (CLAUDE.md §10). Tarayıcı akış betiği (`scripts/akis-dogrula.mjs`) `demo-kaydet.mjs` gibi Playwright'ı çalışma anında arar.
- Servis işçisi (`public/sw.js`) değişmedi; kabuk "önce ağ" olduğu için yeni sürüm ilk yenilemede gelir. `VERSION` artırılmadı (önbelleğe yazma kuralı değişmedi).
- Koyu tema zaten vardı (`prefers-color-scheme`); yeni öğeler token kullanıyor, sabit hex yok.
- Yerel doğrulama kaydı günün tarihine bağlı ve cihazda: sunucudaki sayı herkes için, "bugün sen doğruladın" yalnızca bu cihaz için.
- Mobil ana iş parçacığı bloklama süresi (Lighthouse TBT) bu çalışmada iyileşmedi (bkz. DENETIM.md); harita başlatma (MapLibre) baskın.

## Test

Frontend: 228 -> 276 (dil kabuğu, katalog kapsamı, kontrast, cihaz tahmini, doğrulama hafızası). Tarayıcı akışı `scripts/akis-dogrula.mjs` (21 kontrol) ve README kaydı `scripts/demo-kaydet.mjs`.
