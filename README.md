# Batuhan Veysel Hair Boss — Online Randevu

Müşteriler siteye girip **açık günlerden boş saat seçer, ad + telefon yazar**, randevu oluşur ve
telefonlarına **onay SMS'i** gider. Sen yönetim panelinden randevuları görür, çalışacağın günleri açıp kapatırsın.
iPhone (Safari/Chrome) ve Android'de **ana ekrana uygulama gibi yüklenebilir** (PWA).

## Sayfalar
| Adres | Ne işe yarar |
|---|---|
| `/` | Müşteri randevu sayfası |
| `/admin` | Yönetim paneli (şifreli) |

## Yönetim paneli
- **Randevular:** Bugün / yarın / yaklaşan / geçmiş; müşteriyi tek dokunuşla ara veya WhatsApp'tan yaz,
  "Geldi" işaretle, iptal et (istersen müşteriye iptal SMS'i gider). Telefonla alınan randevuları **+ Randevu ekle** ile gir.
- **Çalışma Günlerim:** Takvimden günlere dokun → saatleri gir (isteğe bağlı mola) → **Aç**.
  Gün adına (ör. "Cmt") dokunursan o ayın tüm cumartesileri seçilir. Açmadığın günler müşteriye görünmez.
- **Ayarlar:** Randevu süresi (varsayılan 30 dk), kaç gün ileriye randevu alınabileceği, aynı gün için minimum süre.

## SMS (Netgsm)
1. netgsm.com.tr'den hesap aç, SMS paketi al, bir **SMS başlığı** onaylat (ör. `HAIRBOSS`).
2. Sunucuda `/opt/hairboss/.env` dosyasına yaz:
   ```
   NETGSM_USERCODE=850xxxxxxx
   NETGSM_PASSWORD=api-sifren
   NETGSM_HEADER=HAIRBOSS
   OWNER_PHONE=5xxxxxxxxx      # yeni randevuda sana da SMS gelsin (isteğe bağlı)
   SALON_PHONE=0555 555 55 55  # SMS'te ve sitede görünür
   SALON_ADDRESS=...
   ```
3. `systemctl restart hairboss`. Panelde Ayarlar → SMS durumu "bağlı" görünür.

Bilgiler boşken site çalışır, sadece SMS gönderilmez.

## Sunucuya kurulum (Hetzner, Ubuntu 24.04)
```bash
ssh root@SUNUCU_IP
curl -fsSL https://raw.githubusercontent.com/ibrahimkdr23/Batuhan-veysel-hair-boss/main/deploy/setup.sh -o setup.sh
ADMIN_PASSWORD='guclu-bir-sifre' bash setup.sh
# Kendi alan adın varsa (DNS A kaydı sunucuya yönlü):  DOMAIN=randevu.ornek.com ADMIN_PASSWORD=... bash setup.sh
```
Alan adı yoksa otomatik `1-2-3-4.sslip.io` gibi ücretsiz bir adres ve HTTPS sertifikası kurulur.
Güncelleme: aynı komutu tekrar çalıştır (veriler ve `.env` korunur).
Yedek: `/opt/hairboss/data/randevu.db` dosyası.

## Geliştirme
```bash
npm install
cp .env.example .env   # ADMIN_PASSWORD'u doldur
npm start              # http://localhost:3000
npm test
```
Node.js 22.5+ gerekir (veritabanı Node'un yerleşik SQLite'ı, ekstra kurulum yok).
