# Ekran görüntüsü bulguları — 2026-08-28

Kullanıcının ekran görüntüleriyle bildirdiği maddeler. **Kaynak: kullanıcı,
canlı sistem.** Durum sütunu her madde bitince güncellenir.

| # | Madde | Ekranda görülen | Durum |
|---|---|---|---|
| 1 | **Depo seçimi yok, ekle** | "Ürünü Düzenle" modalı → DEPO açılır listesinde yalnız "Depo Seçin", hiç depo yok | ✅ **Çözüldü** — `ProductForm.warehouses` opsiyoneldi ve `ProductDetail` çağrısında hiç geçilmiyordu. Prop zorunlu yapıldı (commit `24a950d`) |
| 2 | ✅ **SKU seçimi yok, ekle** | Lojistik & Depo → Bin/Lokasyon Yönetimi → "Yeni Lokasyon": SKU **serbest metin** (placeholder `SKU-001`). Sayaçlar: Toplam Bin 0, Depolar 0, Toplam SKU 0 | ✅ Çözüldü (`604282b`, `4bc99c9`) |
| 3 | ✅ **Mobil WMS'i Mikro/Cetpa yap** | "Mobil Depo Yönetimi" → Konumlar: tek satır `DEPO-1`, **Depo sütunu boş (—)**, Bölge `storage`, sağda `Mikro` rozeti. Receive/Pick/Ship/Return hepsi 0 | ✅ Çözüldü (`604282b`, `4bc99c9`) |
| 4 | ✅ **Search bar düzelt** | Muhasebe & Finans → Faturalar (161 fatura), arama kutusuna `ahmet` yazılmış | ✅ Çözüldü (`604282b`, `4bc99c9`) |
| 5 | ✅ **Barkod yanında QR da tarat** | Envanter → "Barkod Tara" düğmesi; QR okumuyor | ✅ Çözüldü (`604282b`, `4bc99c9`) |
| 6 | ✅ **Personel / araç takibi ekranı** | Referans: Getir canlı sipariş takibi — canlı harita + kurye ikonu + yatay durum çubuğu (Hazırlanıyor → Yola Çıktı → Adreste → Teslim Edildi) + kurye kartı (Ara / Mesaj) | ✅ Çözüldü (`604282b`, `4bc99c9`) |
| 7 | ✅ **İhracat/ithalat gemi takibi** | Referans: `marinetraffic.com/en/ais/home/centerx:-12.0/centery:25.0/zoom:4` | ✅ Çözüldü (`f5c3f33`) — MarineTraffic/iframe ELENDİ (ölçüldü: 403 + X-Frame-Options), yerine doğrulanmış VesselFinder bağlantısı; ücretsiz, hesapsız |
| 8 | ✅ **"Stok Miktarlarını Çek" çelişkili UI** | Aynı ekranda hem kırmızı **"Miktar çekme başlatılamadı"** (V17/`GenelAmacliMaliyetListesiV2` hatası) hem yeşil **"2375/2375 işlendi · tamamlandı"**. Ayrıca "Depo dağılımı yazılan ürün: **175/2375**" ve 2 üründe "Devir (depo bilinmiyor)" | ✅ Çözüldü (`604282b`, `4bc99c9`) |

## Madde 8 için ek not

Bu ekran kullanıcıya **birbiriyle çelişen iki şey** söylüyor: iş hem
"başlatılamadı" hem "tamamlandı". Hangisinin doğru olduğu belli değil ve
"2375 güncellendi" ifadesinin gerçekten **miktar** yazdığı doğrulanmadı —
V17 hatası doğruysa miktarlar hiç gelmemiş olabilir. Bu, projenin
**"sahte kesinlik gösterme"** kuralının doğrudan ihlali sınıfında.

## Madde 7 için maliyet uyarısı

MarineTraffic'in ücretsiz API'si yok. Kullanıcı kararı kayıtlı:
**kart harcaması yapılmadan önce sorulacak** (bkz. hafıza:
`gunluk-kontrol-rutini`). Bu yüzden önce ücretsiz/gömülebilir alternatifler
araştırılıyor; ücretli bir yol gerekiyorsa uygulanmadan önce sorulacak.


---

## Durum: 8/8 çözüldü (2026-08-28)

Teşhis 14 ajanla yapıldı. Beklenmedik bulgular:

- **Bildirilmeyen ikinci ölü ekran:** `p554Bins` gibi `p549Iadeler` de
  `<CRMPage>`e hiç geçirilmiyordu → **CRM → İade & Değişim (RMA)** ekranı da
  sayaçları 0 gösteriyor ve eklenen iade listede görünmüyordu.
- **QR zaten çalışıyormuş:** ZXing hint'siz kurulduğu için QR çözücü aktifti;
  eksik olan yalnızca arayüz etiketiydi.
- **Türkçe arama hatası:** `'IŞIK'.toLowerCase()` → `'işık'`. Kullanıcı "ışık"
  arar, kayıt "IŞIK"tır, eşleşmez. `src/utils/arama.ts` ile çözüldü.
- **Operatör önceliği:** `a || b || tr ? 'Depo' : 'Warehouse'` → depo adı
  Bin/Lokasyon grup başlığında hiç kullanılmıyordu.
- **Kancanın kendi iddiası yanlıştı:** `useSekmeVerileri` başlığı "yazdım ama
  bağlamadım imkânsız" diyordu; kanca değişkenin App.tsx'te VAR OLMASINI
  garanti eder, alt bileşene GEÇİRİLMESİNİ etmez. Boşluk artık
  `useSekmeVerileri.test.ts` ile kapatıldı (dönen her değer App.tsx'te ≥2 kez
  geçmeli). Test, prop geri çekilerek kırmızıya döndüğü doğrulanarak eklendi.

### Madde 6 ve 7 — kullanıcı kararlarıyla tamamlandı

**6 · Personel/araç takibi (büyük).** Kod tabanında **hiç canlı konum katmanı
yok** (`navigator.geolocation` → 0 isabet). Ama Getir ekranının alt yarısı
(durum çubuğu, sürücü kartı) **GPS olmadan** gerçek veriyle doldurulabilir —
`Shipment.driver` zaten yazılıyor, `OrderTrackingView` durum çubuğu ve
`LogisticsMap` mevcut. Karar gereken: konum kaynağı (şoför telefonu GPS /
telematik cihaz / hiç konum yok).

**7 · Gemi takibi (orta).** Veri modelinde IMO/MMSI/konteyner/konşimento alanı
**hiç yok**; bağlanacak veri de yok. Ayrıca `IhracatModule`'de gerçek hatalar
var (düzenleme yolu yok, `isAuthenticated` alınıp kullanılmıyor, kayıt
fonksiyonlarında hata yakalama yok) — bunlar gemi işinden bağımsız,
düzeltilecek.


---

## Madde 6 · Canlı Sevkiyat — bilinen sınırlar (gizlenmiyor)

Kullanıcı kararı: konum kaynağı **şoför telefonunun GPS'i**.

| Sınır | Ekran ne yapıyor |
|---|---|
| Tarayıcı GPS'i yalnız sayfa ön plandayken çalışır; iOS'ta ekran kilitlenince durur | Konumun **yaşına** bakar; 3 dk'dan eskiyse "konum bayat (N dk)" der, canlıymış gibi göstermez |
| Hedef koordinatı hiçbir yerde tutulmuyor (geocode yok) | Tahmini varış **daima '—'**; uydurma dakika üretilmez |
| `navigator.geolocation` HTTPS ister | Buton çalışmadan önce "yalnız güvenli bağlantıda çalışır" uyarısı verir |
| **Araç–kullanıcı bağı YOK** — yetkili herhangi biri herhangi bir aracı seçebilir | `sharedByUid` kaydediliyor (kim paylaştı izlenebilir). Gerçek çözüm dar bir **"Sürücü" rolü** + araç ataması — bu bir yetki kararı, sorulmadan yapılmadı |

**Açık iş:** app.cetpa.com.tr sertifika sorunu (Plesk varsayılan `*.plesk.page`)
çözülmeden şoför telefonunda konum paylaşımı çalışmayabilir.

## Madde 7 · Gemi takibi — neden gömme yok

Ölçüldü (tahmin değil): `marinetraffic.com` → HTTP **403** + `X-Frame-Options:
SAMEORIGIN`; `vesselfinder.com` → `frame-ancestors 'self'`. Yani iframe
güvenilir çalışmaz, ayrıca üçüncü taraf çerezi (`ROUTEID`) bırakıp KVKK
aydınlatması gerektirirdi.

Doğrulanan çözüm: `vesselfinder.com/vessels/details/<IMO>` bağlantısı —
geçerli IMO gerçek gemi sayfasını açıyor, uydurma IMO düzgün 404 veriyor
(yumuşak-404 yok). Ücretsiz, hesapsız, kartsız.

Konteyner/konşimento için **armatör derin-bağlantısı eklenmedi**: hangi
armatörle çalışıldığı bilinmeden URL şablonu uydurulmaz. Armatör söylenirse
eklenir.
