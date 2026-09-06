# Güvenlik Açığı Bildirimi

## Nereye bildirilir

**Güvenlik açıklarını public issue olarak açmayın.** Açık bir issue, düzeltme
yayınlanmadan önce herkese yol tarifi verir.

Bunun yerine GitHub'ın **Private Vulnerability Reporting** akışını kullanın:
deponun **Security** sekmesi → **Report a vulnerability**. Rapor yalnızca
maintainer'lara görünür.

## Bildirimde ne olsun

- Etkilenen bileşen (frontend route'u, backend ucu, veri hattı betiği)
- Yeniden üretme adımları — mümkünse tek bir `curl` komutu
- Saldırganın elde ettiği şey (veri okuma, veri değiştirme, hizmet kesintisi)
- Varsa etkilenen sürüm/commit

## Yanıt

Bildirimi 72 saat içinde yanıtlamayı hedefliyoruz. Bu hobi ölçekli, tek
maintainer'lı bir proje; düzeltme süresi ciddiyete göre değişir ve bunu
raporunuza yanıtta açıkça söyleriz.

## Kapsam

**Kapsam içi:**

- Kimlik doğrulama / yetkilendirme atlatma (`/api/admin/*`, moderasyon uçları)
- Kimliksiz bir isteğin veriyi kalıcı olarak değiştirebilmesi
- Konsensüs veya güvenilirlik skorunun tek bir aktör tarafından manipüle
  edilebilmesi
- Sunucuyu durduran ya da orantısız kaynak tüketen istekler
- Sır sızıntısı (token, JWT sırrı, ortam değişkeni)

**Kapsam dışı (bilinen ve belgelenmiş):**

- Hız sınırlayıcıların bellek-içi olması: tek süreç varsayımıyla tasarlandı,
  `frontend/src/lib/rate-limit.ts` ve `backend/app/core/ratelimit.py`
  dosyalarının başında neyi vaat etmedikleri yazılı.
- İstemci kimliğinin proxy başlıklarından türetilmesi: başlıkları ezmeyen bir
  dağıtımda `x-forwarded-for` saldırgan kontrolündedir. Aynı dosyalarda
  açıkça belirtilmiştir; dağıtım notu `docs/` altındadır.
- OpenStreetMap verisindeki hatalar (yanlış konum, eksik saat). Bunlar veri
  sorunudur; OSM'de düzeltilir ve bir sonraki çekimde gelir.
- Yönetim panelinin token'sız görünen sayısal agregaları (bekleyen katkı
  sayısı gibi). Bilinçli: içerik değil, yalnızca sayaç.

## Teşekkür

Sorumlu bildirimde bulunanları, aksini istemedikleri sürece düzeltmenin
commit mesajında anıyoruz.
