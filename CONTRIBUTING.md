# Katkı Rehberi

buradane'ye katkıda bulunmak istediğin için teşekkürler. Bu proje
**Türkiye'deki kamusal alanları** (tuvalet, park, içme suyu, cami, eczane,
acil toplanma alanı…) bulmayı kolaylaştırmayı amaçlıyor ve açık kaynak
katkılara açık.

Bu rehber, hiç katkı yapmamış birinin de ilk PR'ını açabilmesi için yazıldı.
Takıldığın yerde issue açmaktan çekinme — "bu rehber şurada anlaşılmıyor"
da geçerli bir issue'dur.

> Hangi araçla geliştirdiğin fark etmez: VS Code, Vim, JetBrains, Claude
> Code, Copilot, Cursor ya da düz metin editörü. Proje hiçbir IDE'ye veya
> yapay zekâ aracına bağımlı değildir. Tek şart, bu belgedeki kurallara ve
> otomatik kontrollere uymandır.
>
> Yapay zekâ kodlama aracı kullanıyorsan [CLAUDE.md](CLAUDE.md)'yi de
> aracına okut — proje kuralları oradadır ve araçtan bağımsız yazılmıştır.

---

## İçindekiler

- [Başlamadan önce](#başlamadan-önce)
- [Geliştirme ortamını kur](#geliştirme-ortamını-kur)
- [Katkı akışı](#katkı-akışı)
- [Dal adlandırma](#dal-adlandırma)
- [Commit kuralları](#commit-kuralları)
- [Pull request açma](#pull-request-açma)
- [Kod review ve merge](#kod-review-ve-merge)
- [Risk seviyeleri](#risk-seviyeleri--neyi-doğrudan-yapabilirsin)
- [Katkı türlerine göre rehber](#katkı-türlerine-göre-rehber)
- [Sık karşılaşılan tuzaklar](#sık-karşılaşılan-tuzaklar)

---

## Başlamadan önce

### Küçük değişiklikler

Yazım hatası, kırık bağlantı, eksik diakritik, küçük bir stil düzeltmesi —
doğrudan PR aç. Issue açmana gerek yok.

### Büyük değişiklikler

**Önce issue aç.** Şunlar için bu zorunludur:

- Yeni özellik
- Mimari değişiklik
- Yeni bağımlılık
- Veritabanı şeması değişikliği
- API sözleşmesinde değişiklik
- Kimlik doğrulama / yetkilendirme

Sebebi kırtasiyecilik değil: üzerinde tartışılmamış büyük bir PR, reddedilme
ihtimali en yüksek PR'dır ve bu senin emeğinin boşa gitmesi demektir. Issue
üzerinden 10 dakikalık bir mutabakat, iki günlük bir çalışmayı kurtarır.

### Görev almak

`good first issue` ve `help wanted` etiketli issue'lar katkıya açıktır.
Birini almak istersen issue'ya yorum yaz ("bunu alabilir miyim?") ve
maintainer'ın onayını bekle — aynı işi iki kişinin yapması kimseye fayda
sağlamaz.

---

## Geliştirme ortamını kur

Depoyu fork'la, sonra klonla:

```bash
git clone https://github.com/<kullanıcı-adın>/buradane.git
cd buradane
git remote add upstream https://github.com/Furkiozknn/buradane.git
```

### Frontend (çoğu katkı için yeterli)

**Gereken:** Node.js 20 veya üstü.

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

Demo verisi (`frontend/data/places.*.json`, 9 il / 18.974 gerçek OSM mekanı)
depoyla birlikte gelir. **Veri boru hattını çalıştırmana gerek yok**; harita
ve arayüz doğrudan çalışır.

### Backend (yalnızca backend'e katkı yapacaksan)

**Gereken:** Python 3.12+, [`uv`](https://docs.astral.sh/uv/), Docker.

```bash
cd backend
docker compose up -d db      # PostgreSQL + PostGIS
uv sync --all-extras
uv run uvicorn app.main:app --reload
```

Varsayılan ayarlar `docker compose up -d db` ile olduğu gibi çalışır; bir
değeri değiştirmen gerekmiyorsa `.env` dosyası oluşturmana da gerek yok.
Değişkenlerin tam listesi:
[docs/backend-ortam-degiskenleri.md](docs/backend-ortam-degiskenleri.md).

> Docker yoksa backend testlerinin veritabanı gerektiren kısmı **atlanır
> (skip)**, başarısız olmaz. Yerelde "geçti" görmen, o testlerin çalıştığı
> anlamına gelmez. CI'da gerçek bir PostGIS servisiyle koşarlar.

---

## Katkı akışı

```
issue → dal aç → değişikliği yap → kontrolleri çalıştır → PR aç
      → otomatik kontroller → kod review → merge
```

`main` dalına doğrudan push kapalıdır. Her değişiklik bir PR üzerinden geçer.

Çalışmaya başlamadan önce `main`'i güncelle:

```bash
git checkout main
git pull upstream main
git checkout -b <dal-adı>
```

---

## Dal adlandırma

`<tip>/<kısa-açıklama>` biçiminde, küçük harf ve tire:

| Tip | Ne zaman | Örnek |
|---|---|---|
| `feat/` | Yeni özellik | `feat/ilce-filtresi` |
| `fix/` | Hata düzeltme | `fix/harita-bos-acilma` |
| `docs/` | Dokümantasyon | `docs/katki-rehberi` |
| `test/` | Yalnızca test | `test/arama-motoru` |
| `chore/` | Yapılandırma, CI, bakım | `chore/frontend-ci` |
| `a11y/` | Erişilebilirlik | `a11y/harita-klavye` |
| `data/` | Veri / OpenStreetMap | `data/samsun-ili` |

İlgili issue varsa numarayı ekleyebilirsin: `fix/42-harita-bos-acilma`

---

## Commit kuralları

Bu depo **Conventional Commits zorunlu tutmaz**. Beklenen şey daha basit ve
daha önemli: **commit mesajı neyi neden değiştirdiğini anlatsın.**

İyi bir mesaj:

```
"Şu an açık" filtresinin haritanın %95'ini gizlemesini düzelt

11.406 mekanın yalnızca %5,5'inde opening_hours var: 514'ü açık, 17'si
kapalı, 10.875'i bilinmiyor. Filtre bilinmeyenleri de eliyordu, yani 17
kapalı mekanı ayıklamak için 10.875 kaydı gizliyordu. Tuvalette 569'un
544'ünü gizliyor ve bunların hiçbiri kapalı değildi.

Artık yalnızca kapalı olduğu bilinenleri eliyor ve çip adı da bunu söylüyor.
```

Kötü bir mesaj: `fix`, `güncelleme`, `düzeltmeler`, `wip`

Kurallar:

- **Konu satırı** ≤ 72 karakter, emir kipi, sonunda nokta yok
- **Gövde** (gerekiyorsa) *neden* değiştiğini anlatır; *ne* değiştiğini diff
  zaten gösteriyor
- Bir commit bir mantıksal değişiklik yapar
- İlgili issue'yu bağla: `Fixes #42` / `Refs #42`
- Yapay zekâ aracı kullandıysan bunu commit veya PR'da belirtmen beklenir
  ama zorunlu değildir; kodun sorumluluğu her hâlükârda sendedir

---

## Pull request açma

PR açmadan **önce** şu kontrolleri yerelde çalıştır:

### Frontend

```bash
cd frontend
npx tsc --noEmit    # 0 hata
npm run lint        # 0 hata
npm test            # tüm testler geçmeli
npm run build       # başarılı olmalı
```

### Backend

```bash
cd backend
uv run pytest tests/ -v
```

Sonra:

1. Dalını fork'una push'la: `git push origin <dal-adı>`
2. GitHub'da PR aç (şablon otomatik gelir)
3. Şablondaki her bölümü doldur — özellikle **nasıl test ettiğini**
4. Taslak (draft) PR açmak tamamen normaldir; erken geri bildirim istiyorsan
   kullan

### PR'ında olması gerekenler

- [ ] Tek bir konuya odaklı
- [ ] Yerel kontroller geçiyor
- [ ] Davranış değiştiyse test eklendi/güncellendi
- [ ] Kullanıcıya görünen metinler Türkçe ve diakritikleri doğru
- [ ] Kod yorumları İngilizce ve *neden* olduğunu anlatıyor
- [ ] İlgisiz dosya değişikliği yok (`package-lock.json` gürültüsü dahil)
- [ ] Ekran görüntüsü (görsel değişiklik varsa, açık + karanlık mod)

---

## Kod review ve merge

- Her PR en az **bir maintainer onayı** ister.
- Otomatik kontrollerin (CI) hepsi yeşil olmalıdır.
- Review yorumları koda yöneliktir, kişiye değil. Aynısını sen de yaparken
  bekleriz.
- Bir öneriye katılmıyorsan tartış — gerekçeni yaz. "Maintainer dedi" tek
  başına iyi bir gerekçe değildir; kod tabanının kendi gerekçeleri vardır ve
  onlar yazılıdır.
- Merge yöntemi: **squash merge**. Dalındaki ara commit'ler tek bir anlamlı
  commit'e iner, bu yüzden PR başlığını ve açıklamasını özenli yaz.
- Merge'den sonra dalını silebilirsin.

---

## Risk seviyeleri — neyi doğrudan yapabilirsin

### 🟢 Low risk — doğrudan PR aç

- Türkçe metin ve diakritik düzeltmeleri
- Dokümantasyon (README, bu dosya, ROADMAP, kod yorumları)
- Mevcut davranışı kilitleyen yeni testler
- `frontend/src/lib/categories.ts` içine yeni Türkçe arama kalıbı
- Erişilebilirlik düzeltmeleri (kontrast, `aria-label`, odak görünürlüğü)
- Mevcut tasarım token'larını kullanan görsel iyileştirmeler
- Yeni il verisi çekmek (fetcher'a config satırı + çekim)

### 🟡 Medium risk — issue açman iyi olur, review şart

- Yeni React bileşeni veya mevcut bileşende davranış değişikliği
- `places-repository.ts` içindeki filtre/arama mantığı
- Yeni API route'u (mevcut sözleşmeyi kırmadan)
- Yeni kategori veya özellik (amenity)
- `frontend/public/sw.js` (service worker) değişiklikleri

### 🔴 High risk — önce issue, maintainer onayı şart

- **Kimlik doğrulama ve yetkilendirme**
- **Veritabanı şeması ve Alembic migration'ları**
- **API sözleşmesinde kırıcı değişiklik** (alan kaldırma/yeniden adlandırma/
  tip değiştirme)
- **Yeni bağımlılık** (frontend veya backend)
- **Teknoloji değişikliği** (framework, harita kütüphanesi, veritabanı)
- **Production yapılandırması, deployment, secret yönetimi**
- **`frontend/data/places.*.json` içeriğini elle düzenlemek**
- **Lisans ve atıf** (OpenStreetMap ODbL atfı dahil)
- **`.github/workflows/`**

---

## Katkı türlerine göre rehber

### 🐛 Hata düzeltme

1. Hatayı yeniden üret ve issue'da nasıl ürettiğini yaz
2. **Önce hatayı yakalayan testi yaz** (kırmızı olmalı)
3. Sonra düzelt (yeşile dönmeli)
4. Testi PR'a dahil et

Bu depodaki testler `frontend/tests/` altında ve her biri *neden* var
olduğunu anlatan bir yorum içerir. Aynı üslubu tuttur.

### ✨ Yeni özellik

1. Issue aç, ne çözdüğünü anlat
2. Maintainer onayını bekle
3. Küçük parçalar hâlinde ilerle — 2000 satırlık PR review edilemez

### 🎨 UI / UX

- Renk, kenarlık, gölge **yalnızca** `frontend/src/app/globals.css`'teki
  token'lardan gelir (`var(--brand)`, `var(--surface)`, `var(--text)`…).
  **Sabit hex yazma** — karanlık modu bozar.
- İkonlar yalnızca `lucide-react`'ten. Emoji kullanma.
- Metin kontrastı **en az 4.5:1**. Sınırda geçmek yeterli değil.
- Bir kontrolü `opacity` ile soluklaştırma; vurguyu kenarlık/arka planla azalt.
- Dokunma hedefleri **≥ 44×44 px**.
- Hareket eklerken `prefersReducedMotion()` kontrol et.
- PR'a **açık ve karanlık mod** ekran görüntüsü ekle.

Bu uygulamanın kullanıcıları arasında erişilebilir tesis arayan insanlar var;
erişilebilirlik burada bir "nice to have" değil, ürünün varlık sebebi.

### 🗺️ Veri ve OpenStreetMap

**En değerli katkı türü ve çoğu zaman kod bile gerektirmiyor.**

Veri bir yerde yanlışsa, doğru yer genellikle **buradane değil
[OpenStreetMap](https://www.openstreetmap.org)**'tir. OSM'de düzelttiğin bir
kayıt bir sonraki çekimde buraya gelir ve OSM'i kullanan herkese yarar.

`frontend/data/places.*.json` dosyaları boru hattının **çıktısıdır**. Elle
düzenleme — bir sonraki çekimde kaybolur.

Yeni bir il eklemek istersen:

1. `scripts/fetch_demo_data.py` içindeki `CITIES` sözlüğüne bir satır ekle
   (il slug'ı, etiket, bbox, `cap_scale`)
2. `uv run python scripts/fetch_demo_data.py --city <slug>` çalıştır
3. Üretilen `frontend/data/places.<slug>.json` dosyasını PR'a ekle
4. PR'da kaç mekan geldiğini ve bbox'ı nasıl seçtiğini yaz

> Overpass hız sınırlıdır; il başına ~8 dakika sürer. Betik checkpoint atar,
> yarıda kalırsa kaldığı yerden devam eder.

### 📚 Dokümantasyon

README, bu dosya, `ROADMAP.md` ve kod yorumları. Kod yorumlarında kural:
**ne yapıldığını değil neden yapıldığını** anlat.

### 🧪 Test

Test katkıları her zaman hoş karşılanır. Odak `frontend/src/lib/` — bu
depodaki gerçek regresyonların tamamı orada çıktı, React ağacında değil.

---

## Sık karşılaşılan tuzaklar

Bunlar gerçekten yaşanmış ve saatlere mal olmuş durumlar:

### Harita bomboş açılıyor, konsolda hiçbir hata yok

`npm run dev` yerine doğrudan `next dev` çalıştırmışsındır. `predev` script'i
MapLibre worker dosyalarını `public/maplibre/` altına kopyalar; bu adım
atlanınca worker açılışta patlar ve harita **sessizce** boş kalır. Çözüm:
`npm run dev` kullan.

### Türkçe arama beklenen sonucu bulmuyor

JavaScript'in `toLowerCase()`'i `"I"` harfini `"i"`ye çevirir, noktasız
`"ı"`ya değil. Yani `"KADIKÖY"` asla `"Kadıköy"` ile eşleşmez. Metin
karşılaştırırken `normalizeTr` / `foldAscii` kullan
(`frontend/src/lib/administrative.ts`).

### Bir özellik "yok" görünüyor ama aslında bilinmiyor

Özellik alanları `boolean | null`. **`null` "bilinmiyor" demektir, "yok"
demek değil.** Bunları `false` gibi göstermek veya filtrede eşleştirmek, sahip
olmadığımız bilgiyi iddia etmektir. Bu projede en ciddi hata sınıfı budur.

### Değişikliğim production'da farklı davranıyor

Service worker yalnızca production build'de kaydolur. Çevrimdışı davranışı
test etmek için `npm run build && npm run start`.

### Testler yerelde geçiyor ama CI'da kalıyor

Backend testleri veritabanı yoksa **atlanır**, başarısız olmaz. `docker
compose up -d db` çalıştırmadan gördüğün "geçti", o testlerin koştuğu anlamına
gelmez.

---

## Davranış

Saygılı ol. Sorular hoş karşılanır; "bunu neden böyle yapmışsınız?" iyi bir
sorudur ve çoğu zaman cevabı kod yorumlarında yazılıdır. Bilmediğini söylemek
burada bir sorun değildir.

## Lisans

Katkın [MIT lisansı](LICENSE) altında yayımlanır. Mekan verisi
OpenStreetMap'ten gelir ve **ODbL 1.0** ile lisanslıdır; atfı kaldırma.
