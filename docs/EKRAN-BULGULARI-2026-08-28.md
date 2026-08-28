# Ekran görüntüsü bulguları — 2026-08-28

Kullanıcının ekran görüntüleriyle bildirdiği maddeler. **Kaynak: kullanıcı,
canlı sistem.** Durum sütunu her madde bitince güncellenir.

| # | Madde | Ekranda görülen | Durum |
|---|---|---|---|
| 1 | **Depo seçimi yok, ekle** | "Ürünü Düzenle" modalı → DEPO açılır listesinde yalnız "Depo Seçin", hiç depo yok | ✅ **Çözüldü** — `ProductForm.warehouses` opsiyoneldi ve `ProductDetail` çağrısında hiç geçilmiyordu. Prop zorunlu yapıldı (commit `24a950d`) |
| 2 | **SKU seçimi yok, ekle** | Lojistik & Depo → Bin/Lokasyon Yönetimi → "Yeni Lokasyon": SKU **serbest metin** (placeholder `SKU-001`). Sayaçlar: Toplam Bin 0, Depolar 0, Toplam SKU 0 | 🔄 Teşhiste |
| 3 | **Mobil WMS'i Mikro/Cetpa yap** | "Mobil Depo Yönetimi" → Konumlar: tek satır `DEPO-1`, **Depo sütunu boş (—)**, Bölge `storage`, sağda `Mikro` rozeti. Receive/Pick/Ship/Return hepsi 0 | 🔄 Teşhiste |
| 4 | **Search bar düzelt** | Muhasebe & Finans → Faturalar (161 fatura), arama kutusuna `ahmet` yazılmış | 🔄 Teşhiste |
| 5 | **Barkod yanında QR da tarat** | Envanter → "Barkod Tara" düğmesi; QR okumuyor | 🔄 Teşhiste |
| 6 | **Personel / araç takibi ekranı** | Referans: Getir canlı sipariş takibi — canlı harita + kurye ikonu + yatay durum çubuğu (Hazırlanıyor → Yola Çıktı → Adreste → Teslim Edildi) + kurye kartı (Ara / Mesaj) | 🔄 Teşhiste |
| 7 | **İhracat/ithalat gemi takibi** | Referans: `marinetraffic.com/en/ais/home/centerx:-12.0/centery:25.0/zoom:4` | 🔄 Teşhiste — ⚠️ MarineTraffic API **ücretli**; kullanıcı kart harcaması istemiyor, ücretsiz alternatif aranıyor |
| 8 | **"Stok Miktarlarını Çek" çelişkili UI** | Aynı ekranda hem kırmızı **"Miktar çekme başlatılamadı"** (V17/`GenelAmacliMaliyetListesiV2` hatası) hem yeşil **"2375/2375 işlendi · tamamlandı"**. Ayrıca "Depo dağılımı yazılan ürün: **175/2375**" ve 2 üründe "Devir (depo bilinmiyor)" | 🔄 Teşhiste |

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
