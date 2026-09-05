# GitHub Depo Ayarları

Bu belge, `Furkiozknn/buradane` deposunda **maintainer'ın elle yapması
gereken** ayarları listeler. Bu ayarlar kod değil, GitHub arayüzünden
yapılan yapılandırmadır ve otomatik olarak uygulanmamıştır.

> Hiçbir depo ayarı bu oturumda değiştirilmedi. Aşağıdakiler öneridir;
> uygulama kararı ve zamanlaması sana aittir.

---

## 1. Branch protection — `main`

**Neden:** Katkı akışının tek kapısı PR olsun. Doğrudan push açıkken, bir
katkıcının (veya bir AI aracının) yanlışlıkla `main`'e yazması mümkün ve bunun
geri alınması gürültülü.

**Nereden:** `Settings → Branches → Add branch protection rule`
(veya yeni arayüzde `Settings → Rules → Rulesets`)

**Branch name pattern:** `main`

Açılacaklar:

| Ayar | Değer | Gerekçe |
|---|---|---|
| Require a pull request before merging | ✅ | `main`'e doğrudan push kapanır |
| → Require approvals | **1** | Her değişikliğe en az bir çift göz |
| → Dismiss stale approvals when new commits are pushed | ✅ | Onaydan sonra eklenen commit onaylanmamış sayılır |
| Require status checks to pass before merging | ✅ | Kırık kod merge edilemez |
| → Require branches to be up to date before merging | ✅ | "Ayrı ayrı geçiyor, birlikte kırılıyor" durumunu önler |
| Require conversation resolution before merging | ✅ | Cevaplanmamış review yorumu kalmasın |
| Require linear history | ✅ (öneri) | Squash merge ile uyumlu, geçmiş okunur kalır |
| Do not allow bypassing the above settings | ✅ | Maintainer'lar da kurala tabi olur |
| Allow force pushes | ❌ | Geçmiş yeniden yazılmasın |
| Allow deletions | ❌ | `main` silinemesin |

### Zorunlu tutulacak status check'ler

Aşağıdaki isimler workflow dosyalarındaki `jobs.<id>.name` alanlarından gelir.
**Bu isimler ancak workflow bir kez çalıştıktan sonra listede görünür** — önce
bir PR aç, sonra bu ayarı yap.

- `Node 20` — `.github/workflows/frontend.yml`
- `Node 22` — `.github/workflows/frontend.yml`
- `test` — `.github/workflows/ci.yml` (backend)

---

## 2. Merge ayarları

**Nereden:** `Settings → General → Pull Requests`

| Ayar | Değer | Gerekçe |
|---|---|---|
| Allow squash merging | ✅ | Varsayılan yöntem |
| → Default commit message | **Pull request title and description** | PR açıklaması commit gövdesi olur; bu depoda commit mesajları *neden*i anlatır |
| Allow merge commits | ❌ | Geçmiş gürültüsünü azaltır |
| Allow rebase merging | ❌ (opsiyonel) | Tek yöntemde kalmak basit |
| Automatically delete head branches | ✅ | Merge sonrası dal temizliği |
| Always suggest updating pull request branches | ✅ | |

---

## 3. GitHub Actions izinleri

**Nereden:** `Settings → Actions → General`

| Ayar | Değer | Gerekçe |
|---|---|---|
| Actions permissions | Allow all / seçili actions | Kullanılanlar: `actions/checkout`, `actions/setup-node`, `actions/setup-python`, `astral-sh/setup-uv` |
| Workflow permissions | **Read repository contents** | Workflow'lar hiçbir şey yazmıyor; yazma izni vermeye gerek yok |
| Allow GitHub Actions to create and approve pull requests | ❌ | |
| **Fork pull request workflows** → Require approval for first-time contributors | ✅ | Bilinmeyen katkıcının CI'ı maintainer onayıyla koşar |

> **Secret gerekmiyor.** Mevcut workflow'ların hiçbiri secret kullanmıyor;
> backend CI kendi PostGIS servis konteynerini ayağa kaldırıyor. Fork'lardan
> gelen PR'lar secret'a erişemez — ileride secret gerektiren bir workflow
> eklenirse (deploy gibi) bunun `pull_request_target` ile yapılmaması gerekir.

---

## 4. Güvenlik ayarları

**Nereden:** `Settings → Code security and analysis`

| Ayar | Değer | Gerekçe |
|---|---|---|
| Dependency graph | ✅ | |
| Dependabot alerts | ✅ | Bağımlılık açıkları bildirilsin |
| Dependabot security updates | ✅ | Güvenlik yamaları için otomatik PR |
| Secret scanning | ✅ | |
| Secret scanning push protection | ✅ | Sırrın commit edilmesini baştan engeller |
| Private vulnerability reporting | ✅ | Açık bulan kişi issue açmak zorunda kalmasın |

> Dependabot **sürüm** güncellemelerini (yalnızca güvenlik değil) açarsan
> haftalık ve gruplanmış yapılandırmak PR gürültüsünü azaltır.

---

## 5. Önerilen label'lar

Aşağıdaki label'lar issue şablonlarında ve `CONTRIBUTING.md`'de referans
alınıyor. **Şablonların doğru çalışması için en azından `bug`, `feature`,
`good first issue` ve `help wanted` label'ları var olmalıdır.**

`Settings → Labels` üzerinden veya `gh` ile oluşturulabilir.

### Tip

| Label | Renk | Açıklama |
|---|---|---|
| `bug` | `#d73a4a` | Beklenmeyen davranış veya hata |
| `feature` | `#0e8a16` | Yeni özellik veya iyileştirme |
| `documentation` | `#0075ca` | README, rehberler, kod yorumları |
| `question` | `#d876e3` | Soru veya açıklama talebi |

### Katkıcı yönlendirme

| Label | Renk | Açıklama |
|---|---|---|
| `good first issue` | `#7057ff` | Yeni katkıcılar için uygun |
| `help wanted` | `#008672` | Katkıya açık, sahiplenilmemiş |
| `needs discussion` | `#fbca04` | Uygulanmadan önce mutabakat gerekiyor |
| `blocked` | `#b60205` | Başka bir işi bekliyor |

### Alan

| Label | Renk | Açıklama |
|---|---|---|
| `frontend` | `#1d76db` | Next.js / React / arayüz |
| `backend` | `#5319e7` | FastAPI / Python |
| `database` | `#006b75` | Şema, migration, PostGIS |
| `data` | `#c2e0c6` | Mekan verisi, veri boru hattı |
| `openstreetmap` | `#bfd4f2` | OSM etiketleri, Overpass sorguları |
| `ui/ux` | `#f9d0c4` | Tasarım, düzen, etkileşim |
| `accessibility` | `#fef2c0` | Erişilebilirlik |
| `performance` | `#fbca04` | Hız, paket boyutu, sorgu maliyeti |
| `testing` | `#c5def5` | Test kapsamı ve altyapısı |
| `ci/cd` | `#ededed` | Workflow'lar, otomasyon |

### Risk ve etki

| Label | Renk | Açıklama |
|---|---|---|
| `security` | `#b60205` | Güvenlik etkisi var |
| `breaking change` | `#d93f0b` | API sözleşmesini veya veriyi kırıyor |
| `high risk` | `#e99695` | Maintainer onayı şart (bkz. CONTRIBUTING.md) |

### `gh` ile toplu oluşturma

```bash
# CONTRIBUTING.md ve issue şablonlarının beklediği asgari set
gh label create "good first issue" --color 7057ff --description "Yeni katkıcılar için uygun" --force
gh label create "help wanted"      --color 008672 --description "Katkıya açık, sahiplenilmemiş" --force
gh label create "feature"          --color 0e8a16 --description "Yeni özellik veya iyileştirme" --force
gh label create "documentation"    --color 0075ca --description "README, rehberler, kod yorumları" --force
gh label create "frontend"         --color 1d76db --description "Next.js / React / arayüz" --force
gh label create "backend"          --color 5319e7 --description "FastAPI / Python" --force
gh label create "database"         --color 006b75 --description "Şema, migration, PostGIS" --force
gh label create "data"             --color c2e0c6 --description "Mekan verisi, veri boru hattı" --force
gh label create "openstreetmap"    --color bfd4f2 --description "OSM etiketleri, Overpass sorguları" --force
gh label create "ui/ux"            --color f9d0c4 --description "Tasarım, düzen, etkileşim" --force
gh label create "accessibility"    --color fef2c0 --description "Erişilebilirlik" --force
gh label create "security"         --color b60205 --description "Güvenlik etkisi var" --force
gh label create "breaking change"  --color d93f0b --description "API sözleşmesini veya veriyi kırıyor" --force
gh label create "high risk"        --color e99695 --description "Maintainer onayı şart" --force
```

> `bug` ve `question` GitHub'ın varsayılan setinde zaten gelir; yukarıdaki
> listede yoklar. Varsayılan label'ları sildiysen `bug`'ı da eklemen gerekir.

---

## 6. Depo meta verisi

**Nereden:** `Settings → General` ve depo ana sayfasındaki ⚙️ (About)

- **Description:** Türkiye'deki kamusal alanları bul: tuvalet, park, içme
  suyu, cami, eczane, acil toplanma alanı ve daha fazlası.
- **Topics:** `turkey`, `turkiye`, `openstreetmap`, `maplibre`, `nextjs`,
  `fastapi`, `postgis`, `civic-tech`, `accessibility`, `pwa`
- **Discussions:** açmayı düşün — issue şablonlarındaki `config.yml` soru ve
  fikirler için Discussions'a yönlendiriyor. Açmayacaksan `config.yml`'daki
  o bağlantıyı kaldır.
- **Issues:** açık kalmalı
- **Wiki:** gerek yok; dokümantasyon depoda

---

## 7. Uygulama sırası

Bu ayarların bir sıraya ihtiyacı var; branch protection'ı çok erken açmak
kendini dışarıda bırakmana yol açabilir.

1. Bu oturumun yerel commit'lerini push et
   (`origin/main` şu an geride — `git log origin/main..HEAD` ile gör)
2. Label'ları oluştur (§5)
3. Merge ayarlarını ve Actions izinlerini yap (§2, §3)
4. Güvenlik ayarlarını aç (§4)
5. Bir test PR'ı aç ve workflow'ların koştuğunu, check adlarının göründüğünü
   doğrula
6. **Ancak bundan sonra** branch protection'ı aç ve gördüğün check adlarını
   zorunlu tut (§1)
7. Depo meta verisini doldur (§6)

---

## 8. Bu belge ile ilgili not

Depo ayarları zamanla değişir. Bir ayarı burada yazılandan farklı yaptıysan
bu belgeyi güncelle — yanlış bir doküman, dokümansızlıktan daha zararlıdır.
