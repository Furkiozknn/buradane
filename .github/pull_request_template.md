<!--
Teşekkürler! Bu şablonu doldurmak review süresini kısaltır ve PR'ının
kabul edilme ihtimalini artırır.

Uygulanmayan bölümleri "-" ile geç, silme.
-->

## Ne değişti?

<!-- Bir iki cümle. Diff'i tekrar etme, özetle. -->


## Neden?

<!--
Hangi problemi çözüyor? Bu bölüm *ne* yaptığından daha önemli:
diff neyi değiştirdiğini zaten gösteriyor, nedenini göstermiyor.
-->


## İlgili issue

<!-- Fixes #123 / Refs #123 / Yok (küçük düzeltme) -->


## Nasıl test ettin?

<!--
Somut ol. "Test ettim" yeterli değil.
Örnek: "İstanbul'da filtre panelini açıp 'Bebek bakım' seçtim; çipteki 2
sayısıyla listedeki sonuç sayısı eşleşiyor. Karanlık modda da baktım."
-->


## Etkilenen alanlar

- [ ] Frontend / arayüz
- [ ] Harita (`MapCanvas.tsx`)
- [ ] Arama / filtreler (`places-repository.ts`)
- [ ] Veri modeli (`types.ts`)
- [ ] Katkı ve moderasyon (`contributions-store.ts`)
- [ ] Service worker (`public/sw.js`)
- [ ] Backend / API
- [ ] Veritabanı şeması veya migration
- [ ] Veri dosyaları (`frontend/data/`)
- [ ] Dokümantasyon
- [ ] CI / yapılandırma

## Risk seviyesi

<!-- CONTRIBUTING.md'deki tanımlara göre -->

- [ ] 🟢 Low — mevcut yapıyı değiştirmiyor
- [ ] 🟡 Medium — mevcut bileşen/mantık değişiyor
- [ ] 🔴 High — kimlik doğrulama, şema, API sözleşmesi veya yeni bağımlılık
      (**maintainer onayı alındı mı?** issue bağla)

## Kırıcı değişiklik var mı?

- [ ] Hayır
- [ ] Evet — aşağıda açıkla

<!--
Kırıcı değişiklik = API alanı kaldırma/yeniden adlandırma/tip değiştirme,
veritabanı şeması değişikliği, mevcut URL'lerin kırılması, kaydedilmiş
kullanıcı verisinin geçersiz hâle gelmesi.
-->


## Kontroller

<!-- Çalıştırdıklarını işaretle. Çalıştırmadığını işaretleme. -->

**Frontend** (`cd frontend`)
- [ ] `npx tsc --noEmit` — 0 hata
- [ ] `npm run lint` — 0 hata
- [ ] `npm test` — tüm testler geçiyor
- [ ] `npm run build` — başarılı

**Backend** (`cd backend`) — backend'e dokunduysan
- [ ] `uv run pytest tests/ -v`
- [ ] Şema değiştiyse Alembic migration'ı eklendi (`upgrade` **ve** `downgrade`)

## Gözden geçirme listesi

- [ ] Tek bir konuya odaklı
- [ ] Davranış değiştiyse test eklendi/güncellendi
- [ ] Kullanıcıya görünen metinler Türkçe, diakritikleri doğru (ı İ ğ ü ş ö ç)
- [ ] Kod yorumları İngilizce ve *neden* olduğunu anlatıyor
- [ ] Renkler `globals.css` token'larından geliyor, sabit hex yok
- [ ] Yeni bağımlılık eklemedim (eklediysem 🔴 işaretledim ve gerekçeledim)
- [ ] İlgisiz dosya değişikliği yok
- [ ] Bilinmeyen veriyi (`null`) "yok" gibi göstermiyorum

## Ekran görüntüsü

<!--
Görsel değişiklik varsa **açık ve karanlık mod** ekran görüntüsü ekle.
Mobil düzeni etkiliyorsa dar ekran görüntüsü de ekle.
-->
