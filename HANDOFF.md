# Cetpa — Oturum Devam Notu (2026-08-05)

> Bu dosya cold-start içindir: yeni bir Claude oturumu bu dosyayı okuyarak
> devam edebilir, önceki konuşmayı tekrar türetmesi gerekmez. Token tasarrufu
> için hazırlandı — uzun bir oturumun tamamını context'e taşımak yerine bu
> özeti oku, gerekirse `git log`/`git show <hash>` ile detaya in.

## Proje
- **Cetpa = inşaat malzemesi toptancısı.** Mikro/Logo'ya **ALTERNATİF** ERP yazılıyor (kalıcı Mikro istemcisi değil).
- Path: `/Users/orcun/Desktop/Cetpa B2B SaaS/cetpa-sales-&-logistics/`
- Stack: React 19 + TS + Tailwind v4 + Vite + Firebase Auth/Storage + **PostgreSQL** (Firestore değil, `dbClient` shim Firestore API'sini taklit ediyor).
- **Deploy = production:** `git push origin main` → GitHub Actions → Windows VDS → app.cetpa.com.tr. Kurallar `CLAUDE.md`'de (push öncesi `scripts/verify-deploy.sh pre`, sonrası `post`; para/tenant diff'lerinde `/code-review high`).
- Mikro: local Jump **V17**, `mikroPost(endpoint, params, inMikro)`. `inMikro=true` → payload Mikro zarfının İÇİNDE (V17 evrak kalıbı, TÜM Kaydet metotları böyle — Postman koleksiyonuyla doğrulandı).

## Bu oturumda yapılanlar (26 commit, `82811fe..dd398d9`, hepsi canlıda doğrulandı)

**FAZ 1 — V17 doğrulama:**
- `003b922` — StokKaydetV2/CariKaydetV2/SiparisKaydetV2'de `inMikro=true` eksikti (V16 kalıntısı, payload Mikro zarfı DIŞINA gidiyordu → Mikro'ya yazamıyordu). e-belge 9 metodu (GelenFaturalar/EBelge*) Postman'de yok ama Mikro API dokümanında var → imza doğru, 400 = **SRV GİB yetkisi** (kullanıcı tarafı, kod değil).

**FAZ 2 — yeni import'lar:**
- `9aa0d64` — Cari Ekstre'de "7 Mehmet" gibi faturasız (masraf/dekont) cariler boş görünüyordu; `mikroFaturalar` yalnız fatura çekiyordu. Yeni import `/api/mikro/import/cari-hareket` → `mikroCariHareketler` (evrak_tip filtresiz TÜM CARI_HESAP_HAREKETLERI). CariEkstrePanel bunu okur.
- `0481142` — Depo ataması: stok kartı `sto_yer_kod` hep HAVALIMANI'ydı (varsayılan alan, gerçek konum değil). Per-depo `GenelAmacliMaliyetListesiV2` sorgusu eklendi.
- `a746976` — Kullanıcı isteği: ürün TEK depoya toplanmasın, stoğu olan HER depoda kendi miktarıyla görünsün (`depoBreakdown`).

**FAZ 3 — panel bağlama (orders/journalEntries [boş] → Mikro):**
- `62748ce`/`681f2f7` — KDV Mutabakat, Ba/Bs, Finansal Oranlar, e-Fatura Takip → `mikroFaturalar`'a bağlandı.
- `fbbdb50` — e-fatura/e-arşiv filtresi `cha_ebelge_turu`'na uygulandı.
- `223ab05` — Beyanname PDF (gerçek jsPDF, eskiden .txt) + Excel/CSV çıktı.

**Code-review (high effort, 8 bulgu) + düzeltmeler:**
- `4d09753` — 6 düzeltme: per-depo atama guard'ı (Depolar parametresi yok sayılırsa yanlış atama yapmasın), stockLevel union (warehouses eksikse düşük sayılmasın), per-depo paralel sorgu, cari ekstre yaşlandırma yalnız BORÇ hareketlerini kovalar, risk sıralama 0-değer fix, `useMikroFaturalar` ortak hook (3 kopya → 1).
- `d1a5aef` — e-belge filtresi: `ebelgeTuru=-1` (bilinmiyor) artık gizlenmiyor.

**Kullanıcının kendi düzeltmeleri (önemli, mimariyi etkiliyor):**
- `7b2f634` — **KRİTİK FIX:** `cha_vergi` CARI_HESAP_HAREKETLERI'nde geçersiz kolonmuş → cari-hareket import'u sessizce patlıyordu → `mikroCariHareketler` boştu → "7 Mehmet gider detayları yok" sorununun kök nedeni buydu.
- `64d7b43` — KDV/matrah: STOK_HAREKETLERI JOIN null dönerse (masraf/hizmet faturası, stok satırı yok) başlıktan türetiliyor (`cha_meblag - cha_aratoplam` = KDV).
- `1d43249` — HR/BOM/Talep Tahmini Mikro entegrasyonu (kullanıcının kendi işi).
- `db2926d`/`54ad357`/`047c408` — deploy.ps1: GH runner'ı öldüren Stop-Process kaldırıldı, log-cleanup eklendi + try/catch ile sertleştirildi (disk-dolu → deploy fail → rerun ile doğrulandı, artık kalıcı).

**Bu turda (henüz push kontrolü senin elinde, `dd398d9` deploy'da):**
- `b2759bb` — CRM lead detayında Cari Ekstre hep `leadId` (orders=boş) modundaydı → artık `mikroCariKod` varsa Mikro modu. Ürün detay "Son Hareketler" global `limit(200)`'e takılıydı → artık ürüne özel sorgu.
- `2b29f2b` — Cariler listesinde müşteri/tedarikçi olmayan ama bakiyesi olan cariler (7 Mehmet gibi) "Diğer" rozetiyle işaretleniyor. code-review #7 (per-depo tek-SQL) için `sema-kesif`'e read-only doğrulama sorguları eklendi (working polling'e dokunulmadı).
- `dd398d9` — Şube P&L'e Mikro satış geliri (cha_subeno↔subeKodu) eklendi. Talep Tahmini ürün-bazlı talebe Mikro stok çıkışları (satış) eklendi.

## 2026-08-11 oturumu (`8172145..cf3b3b3`, ikisi de canlıda doğrulandı)

**`416a64c` — Mikro bağlantıları + kopya temizliği**
- **Kolon adı tahmin etme sınıfı KAPATILDI:** `makeMikroSqlImport`'a `secimKolonlari?: string[]`
  eklendi → SELECT listesi çalışma anında `mikroKolonlar()` ile şemaya karşı süzülür, olmayan
  ad import'u öldürmez, düşenler özete yazılır. (`cha_ettn` bu arızanın 3.'südü; `cha_vergi`
  ve `sth_satir_no`/`sto_isim` aynı sınıf.) Fatura import'u `cha.*` kullandığı için hiç
  etkilenmemişti — o yüzden 600 fatura gelirken cari-hareket sıfır çekiyordu.
- **e-belge PDF/XML:** Mikro `IsError=false` + boş `Data` dönebiliyor; sunucu artık yakalayıp
  gerçek sebebi söylüyor (SRV kullanıcısında GİB e-fatura yetkisi yok). Eskiden istemci
  "Yanıt beklenen biçimde değil" diyordu.
- **Satışlar sekmesi ₺0,00 sorunu:** sekme, FATURALAR sekmesinin `faturaYon`/`faturaYil`/
  `invoiceTypeFilter` durumunu sessizce miras alıyordu → kapsam dışında her şey sıfır.
  Kendi bağımsız zinciri + GÖRÜNÜR `satisYil` seçicisi verildi.
- **Tahsilat & Vade Mikro'ya bağlandı:** `useMikroTahsilat` — `mikroCariHareketler`'den FIFO
  mahsuplaşma ile açık alacak. Mikro satırları SALT OKUNUR (MİKRO rozeti).
- **Fatura kalemleri:** `POST /api/mikro/fatura/kalemler` — satırlar `STOK_HAREKETLERI`'nden,
  evrak seri+sıra + yön (satış=4 / alış=3) ile. Kolon adları yine şemadan süzülür.
- Kopyalar: e-belge indirme 2 kopya → `src/services/ebelgeIndir.ts`; "Stok Miktarları (Depo)"
  kartı `Stok Miktarlarını Çek` ile AYNI uçtu (üstelik arka plan işini "bitti" sanıyordu) →
  kaldırıldı; Muhasebe nav şeridi App.tsx'te 2 kopya → `MuhasebeGroupNav.tsx`.

**`cf3b3b3` — RBAC Zero-Trust boşluğu (SİSTEMİK)**
- `isAllowed()` yedeği: `COLLECTION_PERMISSIONS`'ta tanımsız koleksiyonda personel rolleri
  yalnız `read` alır. `Admin` en başta `true` döndüğü için **Admin'de görünmez** — kusur
  Lojistik/Sales/HR rollerinde "düğme çalışmıyor" olarak ortaya çıkar.
- Tarama: 162 TENANT koleksiyonun 28'inde yazma kuralı yoktu; **22'sinde ekranda çalışan
  istemci yazma akışı vardı** (vehicles, salesReturns, helpdeskTickets, payrollRuns,
  stockCountSessions, …). Hepsi sahibi olan role göre tanımlandı → boşluk 28'den 5'e indi.
- Kalan 5 (`cariBalances`, `syncJobs`, `mikroDepolar/Bankalar/Kasalar`) BİLEREK salt-okunur:
  sunucu Mikro import'larıyla `adminDb` üzerinden yazar (adminDb RBAC'ı baypas eder).
- Araç Ekle'nin 2. nedeni: Kaydet, plaka boşken **sessizce return** ediyordu (mesaj yok).
- **KURAL:** yeni koleksiyon = 3 yer birden → `TENANT_COLLECTIONS` + `COLLECTION_PERMISSIONS`
  + `useDataSync`/`dataStore` listener'ı.

**`bf641f3` — SSE ilk yükleme kaybı + 2 konsol hatası**
- `connect()` yeni bağlantı açarken mevcut `EventSource`'u kapatıyordu. Init 3,5 MB /
  ~27 sn'ye çıkınca ölümcül oldu: indirme sürerken tembel yüklenen sayfa yeni koleksiyona
  abone olunca inen HER ŞEY çöpe gidip baştan başlıyordu (kullanıcının Network sekmesi:
  3 bağlantı, sonuncusu 3.591 kB). Artık init uçuştayken yeniden bağlanma ERTELENİYOR
  (`initPending` + 60 sn guard + `retryLater`/`reset` temizliği).
- `/api/reports/summary` 401: `useEffect` bağımlılığı `[]` idi → token hazır olmadan
  istek, girişten sonra bir daha denenmiyor, hata yutuluyordu. `[user]` yapıldı.
- Uydurma giriş konumu: CSP `ipapi.co`'yu engelliyor, `catch` sabit `'Antalya, TR'`
  yazıyordu → giriş kayıtlarında ÖLÇÜLMEMİŞ konum. Çağrı kaldırıldı, `'Bilinmiyor'`.

**`7e791a9` — Fiyat 0 TL (iki ayrı kusur)**
- Cron stok import'u fiyatı HİÇ yazmıyordu (eşleme belgeliydi, kablolanmamıştı).
- Manuel import boş `prices` ile mevcut fiyatı EZİYORDU (sessiz-sıfır sınıfı).
- Mantık `mikroSatisFiyatlari()` yardımcısında toplandı; 0/boş "fiyat YOK" sayılır.
- Ölçüm: import özeti + panel "N/2367 üründe satış fiyatı bulundu" gösteriyor.
  sema-kesif'e `fiyatListesiOzet` / `fiyatListesiOrnek` / `stokKartiFiyatDolulugu` eklendi.

**`f98b63b` — Devir kovası + kontrolün GERÇEK kapsamı**
- Kullanıcının sema-kesif çıktısı: semantik DOĞRU (551-224=327 birebir), ama KAYNAK eksik.
  `satirEvrakTipleri` = 602 satış + 486 alış + 2 = 1090 → STOK_HAREKETLERI yalnız FATURA
  satırlarını taşıyor, açılış/devir stoğu YOK. Farklar tam devir tutarı (200 ve 32).
- `__devir` kovası eklendi: otoriter toplam − defter toplamı. Dağılım toplamı artık
  gerçek stoğa eşit; "Devir (depo bilinmiyor): 200" diye görünür.
- **Önceki raporlamam YANILTICIYDI:** "2365/2367 tuttu" demiştim; doğrusu 2365 ürün HİÇ
  KONTROL EDİLMEDİ (hareketi olmayan ürün atlanıyor). Panel artık önce KAPSAM yazıyor.

**`0e80788` — Kurulum rehberi / AI düğmesi çakışması**
- İkisi de `bottom-6 right-6`; OnboardingChecklist z-[250] AIChat z-50'yi örtüp düğmeyi
  TIKLANAMAZ yapıyordu. Köşe şeritlere ayrıldı: `right-6` AI, `right-24` rehber.

**`b3262b4` — Envanter: uydurma "Ana Depo" + stok biçimi**
- DEPO sütunu `item.location || 'Ana Depo'` yazıyordu; sema-kesif kanıtladı ki 2367 ürünün
  TAMAMINDA `sto_yer_kod` boş → tüm katalog uydurma depo gösteriyordu. Artık gerçek kaynak
  (`warehouseItems.depoBreakdown`) okunuyor, bilinmiyorsa `—` yazılıyor.
- Stok "15826" → "15.826" (tr-TR) + birim rozeti (`inventory.unit`, zaten vardı ama
  hiç gösterilmiyordu).

## sema-kesif ile DOĞRULANANLAR (2026-08-11, artık tahmin değil)
- **`cha_ebelge_turu` DOLU ve tutarlı:** satış 200×tür0 / 5×tür1, alış 91×tür0 / 58×tür1.
  0=e-Fatura, 1=e-Arşiv varsayımıyla uyumlu. (Bekleyen kullanıcı görevi kapandı.)
- **`sto_yer_kod` 2367 ürünün TAMAMINDA boş** — "güvenilmez" notu kanıtlandı.
- **Depolar:** 1 HAVALIMANI, 2 ESKI SANAYI, 3 `34 CGC 119`, 4 `07 AGU 291`, 5 `07 ACR 832`
  → üçü ARAÇ PLAKASI. Araç filosunu Mikro depolarından türetmek mümkün.
- **STOK_HAREKETLERI yalnız fatura satırı** (1090 = 602+486+2) — devir/sayım/üretim YOK.
- **Kritik stok kusur DEĞİL:** eşik 5, ürünlerin çoğunun stoğu gerçekten ≤5 (kullanıcı teyit etti).

## Açık kalanlar
- **Ölçüm bekleyen:** (a) "Miktarları Çek" → devir kovası sonucu + depo sütunu,
  (b) sema-kesif `fiyatListesiOzet`/`stokKartiFiyatDolulugu` → Mikro fiyat gönderiyor mu?
  Fiyat kablolaması yapıldı ama Mikro fiyat vermiyorsa boşa çalışır.
- Tahsilat'ta ÇİFT SAYIM riski: elle girilen `tahsilatKayitlari` ile Mikro kalemi aynı
  faturaysa ikisi de sayılır (ayırt edecek anahtar yok). Kullanıcıya soruldu, yanıt yok.
- **Deploy kesintisi:** `deploy.ps1` build'i servis DURDUKTAN sonra yapıyor → her deploy
  ~1-2 dk 502. Kullanıcı bugün buna birkaç kez denk geldi ("Failed to fetch", takılı
  "Aktarılıyor...", 502). Kalıcı çözüm blue-green ya da build-önce-restart-sonra; deploy
  zinciri riskli, ayrı iş olarak ele alınmalı.
- Birkaç modülün toast'ı `bottom-6 right-6` (z-100..300) → göründüğü sürece AI düğmesini
  örtüyor. Geçici, dokunulmadı.

## Mimari notlar (tekrar keşfetme, buradan oku)
- **`useMikroFaturalar(enabled)`** (`src/hooks/useMikroFaturalar.ts`) — `mikroFaturalar` koleksiyonunun TEK normalize kaynağı. `useCariAdMap(leads)` da burada. AccountingModule/MuhasebePage/RaporlarPage/SubeModule hepsi bunu kullanıyor.
- **Koleksiyonlar:** `mikroFaturalar` (yalnız fatura, cha_evrak_tip=63/cinsi=6), `mikroCariHareketler` (TÜM cari hareket, evrak_tip filtresiz), `cariBalances` (doc id=cariKod, `/api/mikro/pull/bakiye` doldurur), `warehouseItems.depoBreakdown` (per-depo dağıtık stok).
- **Bakiye işareti:** eksi = Cetpa borçlu. `SUM(cha_tip=0 ? +meblag : -meblag)`.
- **Yıl kapsamı:** `mikroFaturalar` 2020+ tüm yılları tutar; KPI'larda CARİ YIL filtresi şart (yoksa "132M hatalı" gibi all-time balon görünür — kullanıcı bunu bir kez yaşadı).
- **Ciro tie-out DOĞRULANMIŞ:** 2026 satış (giden) 9,75M ≈ portal 9,36M. **ALIŞ/cinsi=6 ciro olarak DOĞRULANMADI** — bilerek dışarıda tutulan yerler var (Raporlar orders merge'i, Şube P&L).
- **e-belge:** `cha_ebelge_turu` semantiği (0=e-Fatura/1=e-Arşiv varsayımı) **canlıda doğrulanmadı** — kod dışı iş.

## Kalan işler
**Senin tarafın (kod değil):**
1. ~~Import'ları çalıştır~~ ✅ 2026-08-11'de çalıştırıldı (Cari Hareketler 905, stok 2367,
   cari 203, fatura 600, stok hareket 1090, barkod 946, depo 5). Siparişler/Ödeme Planları
   0 — Mikro'da veri yok, kod doğru.
2. Mikro'da SRV kullanıcısına GİB e-fatura yetkisi ver (e-belge 400 hatalarının nedeni).
3. ~~`cha_ebelge_turu` doğrula~~ ✅ sema-kesif ile doğrulandı (aşağıya bak).
4. Token rotasyonu: `OPS_SUMMARY_TOKEN` + Mikro `ApiKey` (sohbete düşmüştü).

**Kod tarafı:**
- ~~code-review #7: doğrulama sonrası tek-SQL'e geçiş.~~ ✅ TAMAMLANDI (`8172145`, 2026-08-11, Antigravity + kullanıcı doğrulaması) — per-depo stok artık `STOK_HAREKETLERI`'nden tek toplu SQL ile (`sth_tip=0/1` giriş/çıkış SUM), ağır per-SKU-per-depo `GenelAmacliMaliyetListesiV2` polling'i yerine geçti. Kullanıcı canlıda depo dağılımını kontrol edip doğru olduğunu teyit etti (depo transferi tek-satır/çift-satır varsayımı sağlam çıktı).
- Mizan/Yevmiye/Siparişler/Ödeme Planları: kod doğru, Mikro'ya veri girildikçe dolacak.

## Ajan envanteri (bu ortamda kullanılabilir alt-ajanlar)
| Ajan | Ne işe yarar |
|---|---|
| Explore | Salt-okunur geniş kod arama (dosya değiştirmez) |
| general-purpose | Çok adımlı araştırma/uygulama |
| Plan | Uygulama öncesi mimari plan çıkarır |
| claude | Genel amaçlı varsayılan |
| claude-code-guide | Claude Code/SDK/API soruları |
| statusline-setup | Terminal status line yapılandırma |
| brand-voice:* (5 ajan) | Pazarlama eklentisinden, Cetpa işiyle ilgisiz |

Ajanlar yalnız açıkça istenince çalıştırılır (soğuk başlarlar, pahalı).

## Token kullanımı — neden yüksek, ne yapıldı
POST/Mikro API çağrıları Claude token'ı YEMEZ (ayrı sistem). Asıl kaynaklar: çok uzun tek oturum (her turda tüm konuşma geçmişi + CLAUDE.md + MEMORY.md + görev listesi yeniden işleniyor), büyük dosyaların (server.ts ~7.5k satır) tekrar tekrar okunması, ekran görüntüleri, uzun grep/diff çıktıları. Bu dosya + `/compact` veya yeni oturum önerilir. Bundan sonra dosya okumaları satır-aralıklı (cerrahi) yapılacak, tekrar okuma yapılmayacak.
