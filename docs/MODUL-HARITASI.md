# Cetpa Modül Haritası — Faz 0

> **Üretim:** `python3 scripts/modul-haritasi.py` · deterministik ölçüm (her koşuda yenilenir) + 293/293 dosya için ajan işlev özeti (`docs/modul-haritasi-ajan.json`) + grep ile doğrulanmış düzeltmeler.
> **Amaç:** Sertleştirme serisinin (Faz 0-4) tek keşif kaynağı. **Sonraki fazlar bu dosyaya bakar, yeniden keşif yapmaz.**
> **Plan:** Obsidian → `Açık İşler/Modul-modul sertlestirme serisi (Faz 0-4).md`

## 0. Nasıl okunur

| Sütun | Anlam |
|---|---|
| **durum** | ✅ sağlam · ⚠️ şüpheli (bir arıza sınıfı ölçüldü) · 💀 ölü (kimse import etmiyor) · 👻 hayalet (import ediliyor ama işlevi kimseye ulaşmıyor) · ❔ bilinmiyor |
| **risk** | para · tenant · mikro · pdf · belge · ui · altyapi · guvenlik — Faz 3 sırasını belirler |
| **`\|\|0`** | sayısal `\|\| 0` / `?? 0` — CLAUDE.md "sahte kesinlik" yasağının ihlal adayı |
| **imp** | kaç dosya import ediyor (0 = ölü aday; giriş noktaları ve `scripts/` tüketicileri sayılır) |

## A. Sayılarla durum (deterministik)

| Ölçüm | Değer |
|---|---|
| Dosya / satır | 293 / 128,252 |
| Testi olan dosya | 20 (0 tanesi ekran) |
| Hiçbir yerden import edilmeyen | 1 |
| Mikro'ya dokunan | 56 — testsiz: 55 |
| Para matematiği yoğun (≥10) | 35 — testsiz: 35 |
| `\|\| 0` / `?? 0` | **1,498** yer |
| Elle para formatı | 332 yer |
| Elle tarih parse | 99 yer |
| Inline çeviri | 3,722 yer |
| `new jsPDF` | 12 yer |

## B. Faz 1 sırası — TESTSİZ + PARA YOĞUN

| Dosya | Satır | Para eşl. | `\|\|0` | Mikro | Koleksiyonlar |
|---|---|---|---|---|---|
| `src/pages/MuhasebePage.tsx` | 3,950 | 156 | 73 | ✓ | autoInvoiceSchedules, bankMatchRuns, cariBalances, intercompanyTxns, letterOfCredit… |
| `src/components/AccountingModule.tsx` | 2,873 | 93 | 48 | ✓ | bankAccounts, bankTransactions, budgets, cariBalances, checks… |
| `src/server/routes/mikroRoutes.ts` | 4,456 | 60 | 40 | ✓ | mikroCariHareketler |
| `src/pages/OrdersPage.tsx` | 3,619 | 50 | 30 | ✓ | demandRequests, exportShipments, helpdeskTickets, inventoryMovements, notifications… |
| `src/pages/DashboardPage.tsx` | 2,397 | 39 | 51 | ✓ | userPrefs, workflowTasks |
| `src/components/CariEkstrePanel.tsx` | 547 | 36 | 13 |  | orders |
| `src/components/reports/genel/GenelBloklar3.tsx` | 588 | 29 | 16 |  |  |
| `src/components/IhracatModule.tsx` | 700 | 27 | 1 |  | akreditifler, gumrukBeyannameleri, ihracatlar, ithalatlar |
| `src/components/accounting/SatislarTab.tsx` | 276 | 27 | 25 | ✓ |  |
| `src/App.tsx` | 6,243 | 26 | 20 | ✓ | aiConsents, auditLog, commissionRules, companies, consignments… |
| `src/components/MaliyetMerkeziModule.tsx` | 1,112 | 25 | 2 |  | maliyetKalemleri, maliyetMerkezleri |
| `src/components/BankStatementImportModal.tsx` | 268 | 24 | 0 |  | bankTransactions, maliyetMerkezleri |
| `src/components/DunningModule.tsx` | 615 | 23 | 4 |  | dunningInvoices, dunningPolicies |
| `src/components/TahsilatModule.tsx` | 1,330 | 20 | 6 | ✓ | leads, tahsilatKayitlari, tahsilatOdemeleri |
| `src/components/reports/LojistikRapor.tsx` | 2,228 | 20 | 44 |  |  |
| `src/pages/CRMPage.tsx` | 3,874 | 20 | 63 | ✓ | campaignMetrics, campaigns, contracts, leads, notifications… |
| `server.ts` | 4,323 | 19 | 12 | ✓ |  |
| `src/components/KasaModule.tsx` | 772 | 19 | 5 |  | kasaHareketleri, kasaKapanislar, kasalar |
| `src/components/accounting/CeklerTab.tsx` | 183 | 19 | 0 |  |  |
| `src/server/routes/superadminRoutes.ts` | 529 | 18 | 6 | ✓ |  |

## C. Faz 2 sırası — KOPYA KOD en yoğun 15

| Dosya | para | tarih | çeviri | `\|\|0` | toplam |
|---|---|---|---|---|---|
| `src/components/reports/EnvanterRapor.tsx` | 7 | 5 | 183 | 150 | 162 |
| `src/pages/MuhasebePage.tsx` | 61 | 12 | 131 | 73 | 146 |
| `src/pages/CRMPage.tsx` | 19 | 8 | 268 | 63 | 90 |
| `src/pages/DashboardPage.tsx` | 6 | 17 | 169 | 51 | 74 |
| `src/components/reports/IKRapor.tsx` | 1 | 2 | 114 | 63 | 66 |
| `src/pages/OrdersPage.tsx` | 24 | 9 | 238 | 30 | 63 |
| `src/pages/InventoryPage.tsx` | 4 | 1 | 32 | 48 | 53 |
| `src/components/reports/LojistikRapor.tsx` | 1 | 6 | 109 | 44 | 51 |
| `src/components/AccountingModule.tsx` | 2 | 0 | 43 | 48 | 50 |
| `src/components/InventoryView.tsx` | 4 | 2 | 97 | 39 | 45 |
| `src/server/routes/mikroRoutes.ts` | 0 | 0 | 0 | 40 | 40 |
| `src/pages/IKPage.tsx` | 26 | 0 | 65 | 9 | 35 |
| `src/utils/pdf.ts` | 17 | 1 | 0 | 17 | 35 |
| `src/components/reports/crm/CrmBloklar10.tsx` | 0 | 0 | 14 | 34 | 34 |
| `src/components/reports/genel/GenelBloklar5.tsx` | 0 | 2 | 9 | 31 | 33 |

## D. Faz 4 adayları — import edilmeyen (giriş noktaları ve scripts/ tüketicileri hariç)

- `src/components/UpgradeModal.tsx` — 147 satır, test: yok

## E. Koleksiyon → dosya

170 koleksiyona kod dokunuyor; **104 koleksiyona yalnız TEK dosya** (kapalı-devre adayı — tek dosyanın hem yazıp hem okuması normaldir; Faz 4 tek tek ayırır):

- `aiConsents` → `App.tsx`
- `akreditifler` → `IhracatModule.tsx`
- `amortismanKayitlari` → `SabitKiymetModule.tsx`
- `arizalar` → `BakimModule.tsx`
- `assemblyMeetings` → `CorporateGovernanceModule.tsx`
- `auditItems` → `QualityModule.tsx`
- `bankReportPresets` → `BankBalanceReport.tsx`
- `boardMeetings` → `CorporateGovernanceModule.tsx`
- `budgets` → `AccountingModule.tsx`
- `campaignMetrics` → `CRMPage.tsx`
- `campaigns` → `CRMPage.tsx`
- `capacityLines` → `UretimPage.tsx`
- `cargoTracking` → `CargoTrackingTab.tsx`
- `categories` → `ProductForm.tsx`
- `checks` → `AccountingModule.tsx`
- `coll` → `dbClient.ts`
- `companies` → `App.tsx`
- `complaints` → `QualityModule.tsx`
- `complianceItems` → `LegalModule.tsx`
- `cpqQuotes` → `CPQPanel.tsx`
- `cpqTemplates` → `CPQPanel.tsx`
- `ctpatRecords` → `QualityModule.tsx`
- `dataRequests` → `LegalModule.tsx`
- `demandRequests` → `OrdersPage.tsx`
- `demoRequests` → `App.tsx`
- `dunningInvoices` → `DunningModule.tsx`
- `dunningPolicies` → `DunningModule.tsx`
- `eBelgeler` → `EBelgeMerkezi.tsx`
- `eightDRecords` → `QualityModule.tsx`
- `ekipmanlar` → `BakimModule.tsx`
- `exportShipments` → `OrdersPage.tsx`
- `fiveSRecords` → `QualityModule.tsx`
- `fmeaRecords` → `QualityModule.tsx`
- `garantiler` → `ServisModule.tsx`
- `gumrukBeyannameleri` → `IhracatModule.tsx`
- `helpdeskTickets` → `OrdersPage.tsx`
- `holdingAccounts` → `HoldingModule.tsx`
- `holdingEntities` → `HoldingModule.tsx`
- `holdingIntercompany` → `HoldingModule.tsx`
- `ihracatlar` → `IhracatModule.tsx`
- `intercompanyTxns` → `MuhasebePage.tsx`
- `isEmirleri` → `BakimModule.tsx`
- `ithalatlar` → `IhracatModule.tsx`
- `jobs` → `MikroSyncPanel.tsx`
- `kaizenRecords` → `QualityModule.tsx`
- `kasaHareketleri` → `KasaModule.tsx`
- `kasaKapanislar` → `KasaModule.tsx`
- `kasalar` → `KasaModule.tsx`
- `legalCases` → `LegalModule.tsx`
- `legalDocs` → `LegalModule.tsx`
- `letterOfCredit` → `MuhasebePage.tsx`
- `locationStocks` → `App.tsx`
- `lotHareketleri` → `LotSeriModule.tsx`
- `lotKayitlari` → `LotSeriModule.tsx`
- `lucaSyncLog` → `LucaSyncPanel.tsx`
- `machines` → `ProductionModule.tsx`
- `maliyetKalemleri` → `MaliyetMerkeziModule.tsx`
- `mikroSiparisler` → `useMikroSiparisler.ts`
- `partnerApplications` → `LandingPage.tsx`
- `payments` → `App.tsx`
- `payrollEntries` → `MuhtasarModule.tsx`
- `pfmeaRecords` → `QualityModule.tsx`
- `projectCosts` → `ProjePage.tsx`
- `projectTimelines` → `ProjePage.tsx`
- `projects` → `ProjectModule.tsx`
- `qcRecords` → `QualityModule.tsx`
- `recurringBilling` → `MuhasebePage.tsx`
- `reportTargets` → `App.tsx`
- `resources` → `ProjectModule.tsx`
- `returns` → `ReturnModal.tsx`
- `revenueSchedules` → `GelirTanimaModule.tsx`
- `routingTemplates` → `MRPModule.tsx`
- `sabitKiymetBakim` → `SabitKiymetModule.tsx`
- `sabitKiymetSigorta` → `SabitKiymetModule.tsx`
- `salesReturns` → `OrdersPage.tsx`
- `seriNolar` → `LotSeriModule.tsx`
- `serviceRequests` → `OrdersPage.tsx`
- `services` → `AccountingModule.tsx`
- `servisTalepleri` → `ServisModule.tsx`
- `shareholders` → `CorporateGovernanceModule.tsx`
- `skuMappings` → `SkuMappingPanel.tsx`
- `subeTransferler` → `SubeModule.tsx`
- `subeler` → `SubeModule.tsx`
- `subscriptions` → `App.tsx`
- `supplierRatings` → `App.tsx`
- `tahsilatKayitlari` → `TahsilatModule.tsx`
- `tahsilatOdemeleri` → `TahsilatModule.tsx`
- `tasks` → `ProjectModule.tsx`
- `taxDeclarations` → `MuhtasarModule.tsx`
- `teknisyenler` → `ServisModule.tsx`
- `territories` → `TerritoryModule.tsx`
- `testimonials` → `LandingPage.tsx`
- `trainings` → `HRModule.tsx`
- `transfers` → `AccountingModule.tsx`
- `travelRequests` → `HRModule.tsx`
- `urunAgaclari` → `UrunAgaciModule.tsx`
- `userOnboarding` → `OnboardingChecklist.tsx`
- `warranties` → `InventoryPage.tsx`
- `waybills` → `AccountingModule.tsx`
- `wmsCycleCounts` → `MobileWMSModule.tsx`
- `wmsLocations` → `MobileWMSModule.tsx`
- `wmsTasks` → `MobileWMSModule.tsx`
- `workCenters` → `MRPModule.tsx`
- `workflowTasks` → `DashboardPage.tsx`

## F. Dosya dosya harita


### `./` — 1 dosya, 4,323 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `server.ts` | 4,323 |  | 0 | 12 | ⚠️ supheli | para, tenant, mikro, altyapi, guvenlik | Express 5 giriş dosyası: PG shim, auth/MFA/RBAC, /api/db CRUD, Shopify webhook, abonelik ödemesi, B2B portal özeti, alacak yaşlandırma, lojistik transfer, Mikro token ve tüm rota modüllerini (mikro/superadmin/ops/tracking vb.) bağlayıp sunucuyu başlatır. | importEden=0 ÖLÜ DEĞİL: package.json 'dev'/'start' = 'tsx server.ts' (süreç giriş noktası, kimse import etmez). Süphe gerekçesi (sahte kesinlik + Mikro test yok): (1) satır 2957 `const bakiye = Number((lead.bakiye as number) ?? 0)` → Mikro'dan bakiye henüz senkronlanmamış cari B2B portalda '0 borç'  |

### `src/` — 5 dosya, 7,541 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `App.tsx` | 6,243 |  | 0 | 20 | ⚠️ supheli | para, tenant, mikro, ui, altyapi, guvenlik | Uygulamanın kök bileşeni: Firebase auth/MFA girişi, 38 koleksiyonun canlı dinleyicileri, sekme yönlendirmesi (lazy sayfalar), Mikro senkron tetikleyicileri, stok sayımı/uyarı/kur işleri ve AIChat yerleşimini tek dosyada barındırır. | importEden=0 ölçüm artefaktı — src/main.tsx:4 `import App from './App.tsx'` ve :14 `<App />` ile giriş noktası, ÖLÜ DEĞİL. Şüphe gerekçeleri: (1) sahte kesinlik: sifir=20 + paraMatematigi=26 (örn. satır 1459 `createdAt?.toMillis?.() ?? 0`, 1739-1756 `variance || 0` stok sayımı farkı 0 yazılıyor, 259 |
| `firebase.ts` | 16 |  | 96 |  | ✅ saglam | altyapi | Firebase Auth/Storage'ı başlatır; `db` Firestore yerine PostgreSQL shim'i için boş yer tutucudur. |  |
| `main.tsx` | 18 |  | 0 |  | ✅ saglam | altyapi | Uygulama giriş noktası: errorLogger'ı başlatıp App'i BrowserRouter+StrictMode içinde DOM'a bağlar. | importEden=0 ama index.html:45 `<script type=module src=/src/main.tsx>` ile yükleniyor — ölü DEĞİL, giriş dosyası. |
| `translations.ts` | 645 |  | 9 |  | ✅ saglam | ui | TR/EN arayüz metinlerinin modül-seviyesi sabit sözlüğü ve Language/TranslationMap tipleri (9 dosya import ediyor). |  |
| `types.ts` | 619 |  | 85 |  | ✅ saglam | altyapi | Tüm uygulamanın paylaşılan alan tipleri (UserRole, PriceTier, Shipment, InventoryItem, Order, Lead vb.) — 85 dosyanın ortak sözleşmesi. |  |

### `src/components/` — 122 dosya, 54,088 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `AIChat.tsx` | 208 |  | 1 |  | ✅ saglam | ui, altyapi | Sağ alt köşedeki yüzen Gemini sohbet paneli: App'ten gelen canlı iş özetini bağlam olarak sunucu AI ucuna auth token'ıyla gönderir ve TR/EN yanıtları listeler. |  |
| `AIInlineNudge.tsx` | 102 |  | 3 | 4 | ✅ saglam | ui | Stok/Sipariş/CRM/Muhasebe sayfalarının üstünde düşük stok, bekleyen sipariş, geciken lead veya bayat fatura sayısına göre tıklanabilir öneri çipleri gösteren küçük bildirim bileşeni. | sifir=4 ama satır 43/51/59/67'deki `?? 0` para değil, opsiyonel sayaç prop'u; undefined → çip gösterme anlamına geliyor, sahte kesinlik değil. InventoryPage:121, CRMPage:484, OrdersPage:453'te gerçekten render ediliyor (hayalet değil). |
| `AccountingModule.tsx` | 2,873 |  | 5 | 48 | ⚠️ supheli | para, mikro, pdf, belge, tenant, ui | Muhasebe modülünün kabuk bileşeni: 29 alt sekmeyi (çek, çalışan, bütçe, yevmiye, mizan, KDV, banka, irsaliye, fatura, depo, transfer) barındırır, Mikro cari/fatura verisini çekip CSV/PDF dışa aktarır ve formatTRY/formatCurrency/exportCSV/SortHeader yardımcılarını başka dosyalara export eder. | Sahte kesinlik: sifir=48 + paraMatematigi=93 — 867/889 `balance: Number(x.bakiye ?? x.balance ?? 0)`, 888 `creditLimit: Number(x.creditLimit ?? 0)`, 1121-1123 `amount: Number(r.Tutar ?? r.amount ?? 0)` (Mikro/CSV'den gelmeyen bakiye/tutar 0 olarak basılıyor). Yarım düzeltme kaynağı: ceviri=43 inline |
| `AddOrderModal.tsx` | 529 |  | 1 | 9 | ⚠️ supheli | para, ui | Sipariş oluşturma modalı: müşteri seçimi, barkod/arama ile ürün ekleme, satır fiyat-adet düzenleme ve KDV'li toplamı hesaplayıp onSubmit'e verir. | Sahte kesinlik: 90 ve 281 `item.prices.Retail || 0` — fiyatı tanımsız ürün sepete 0 TL ile giriyor; 281 fiyatı `$` ile, 472/476 toplamı `₺` ile gösteriyor (aynı ekranda iki para birimi simgesi). Yarım düzeltme kaynağı: ceviri=24 inline, para=3 elle toLocaleString. paraMatematigi=0 ölçülse de compute |
| `AddShipmentModal.tsx` | 173 |  | 1 |  | ✅ saglam | ui | Sevkiyat oluşturma/düzenleme modalı: müşteri ve araç atar, durum seçer, formu onSubmit'e verir. |  |
| `AnalyticsPanel.tsx` | 314 |  | 2 | 9 | ⚠️ supheli | para, ui | Raporlar sayfasında sipariş/lead/stok verisinden aylık ciro, durum dağılımı ve en çok satan ürün grafiklerini (recharts) çizer. | Sahte kesinlik: sifir=9 — 64/79/82/114 `Number(o.totalPrice) || 0` (totalPrice'ı olmayan sipariş ciroya 0 olarak girer, toplam sessizce düşük çıkar); 147 `Number(item.qty) || 1` adet bilinmiyorsa 1 varsayıyor. Ayrıca App.tsx:229 ve RaporlarPage.tsx:10'da iki ayrı React.lazy tanımı var (çift bağlama) |
| `ApiPage.tsx` | 246 |  | 1 |  | ✅ saglam | ui | Genel (public) 'API ve Entegrasyonlar' tanıtım sayfası; App.tsx:176'da DevelopersPage adıyla lazy yüklenir ve sekme başlığını ayarlar. |  |
| `ApprovalQueue.tsx` | 495 |  | 2 |  | ⚠️ supheli | para, ui | Çalışan onay kuyruğu: submitApprovalRequest ile approvalRequests'e istek yazar, yöneticiye onay/red ekranı ve usePendingApprovalCount ile bekleyen sayacı sunar (PurchasingModule satın alma taleplerini buraya gönderir). | TENANT ŞÜPHESİ ÇÜRÜDÜ: koleksiyon collections.ts TENANT listesinde ve rbac.ts'te var (grep 2026-09-04). Tenant izolasyonu adayı: 489 `query(collection(db,'approvalRequests'), where('status','==','pending'))` companyId'siz; 'approvalRequests' dizgesi server.ts ve src/server/*.ts içinde HİÇ geçmiyor — |
| `B2BPortal.tsx` | 615 |  | 2 | 18 | ⚠️ supheli | para, pdf, tenant, ui | Bayi/B2B portalı: teklifler, bayi listesi ve kredi limiti/kullanımı, fiyat listeleri; Shopify senkronu ve teklif PDF çıkışı sağlar. | Sahte kesinlik: 130 `creditLimit || 500000` — kredi limiti tanımsız bayiye 500.000 TL uydurma limit gösteriliyor; 366/399/438 `creditLimit || 0`, 401 `o.totalPrice || 0` kredi kullanım hesabına 0 giriyor; 389 `Number(q.totalAmount) || satır toplamı` iki farklı toplam kaynağı. Yarım düzeltme kaynağı: |
| `BOMPanel.tsx` | 550 |  | 2 |  | ⚠️ supheli | mikro, altyapi | Ürün reçetesi (BOM) editörü: bom koleksiyonunda bileşen listesi tanımlar, inventory'den ad/SKU tamamlar, Mikro üretim reçetelerini çeker ve MikroPushButton ile iter. | TENANT ŞÜPHESİ ÇÜRÜDÜ: koleksiyon collections.ts TENANT listesinde ve rbac.ts'te var (grep 2026-09-04). Mikro kolon tahmini: mikro=true, test=false — recetePayload/useMikroUretimReceteleri alan eşlemesi testsiz. 116 `query(collection(db,'bom'))` companyId'siz (sunucu şimine bağımlı; 'bom' server.ts' |
| `BakimModule.tsx` | 617 |  | 1 |  | ⚠️ supheli | mikro, ui | Bakım/arıza modülü: ekipman, iş emri ve arıza kayıtlarını CRUD eder, bakım talebini bakimTalepPayload ile Mikro'ya iter. | TENANT ŞÜPHESİ ÇÜRÜDÜ: koleksiyon collections.ts TENANT listesinde ve rbac.ts'te var (grep 2026-09-04). Mikro kolon tahmini: mikro=true, test=false (bakimTalepPayload eşlemesi testsiz). Tenant adayı: 147/149/151 `ekipmanlar`/`isEmirleri`/`arizalar` üç koleksiyon companyId'siz onSnapshot + 162/187/20 |
| `BankBalanceReport.tsx` | 261 |  | 1 | 4 | ✅ saglam | para, tenant | Banka bakiye durum raporu: hesap başına açılış bakiyesi + seçili tarihe kadar hareket toplamı, TCMB kuruyla TRY değerleme (kur yoksa '—' ve toplam dışı), maliyet merkezi filtresi ve kayıtlı rapor şablonları. |  |
| `BankStatementImportModal.tsx` | 268 |  | 1 |  | ✅ saglam | para, belge, tenant | Türk bankası CSV ekstresi içe aktarma: hesap seç, kolon otomatik eşleştir, TR sayı/tarih parse et (parseTRNumber/parseTRDate — testli), tarih+tutar+açıklama dedup yapıp bankTransactions'a source:'import' ile yazar. |  |
| `BarcodeScanner.tsx` | 142 |  | 3 |  | ✅ saglam | ui | Stok, sipariş ve QR transfer ekranlarında ürün tanımlamak için kamera (lazy ZXing) veya elle giriş modlu barkod okuma modalı açar. |  |
| `BarcodeScannerCamera.tsx` | 93 |  | 1 |  | ✅ saglam | ui, altyapi | @zxing/library ESM ile tarayıcı kamerasından sürekli barkod okur ve ilk okumada onScan'i tetikler (react-webcam CJS bağımlılığını kaldırmak için yazılmış). |  |
| `BlogPage.tsx` | 167 |  | 1 |  | ✅ saglam | ui | Genel (girişsiz) blog sayfası — sabit TR/EN yazı kartları ve sekme başlığı; App.tsx 'blog' rotasında lazy yükleniyor. |  |
| `CPQPanel.tsx` | 621 |  | 1 | 4 | ✅ saglam | para, ui | Configure-Price-Quote: ürün şablonu + seçenek/fiyat farkı kurallarıyla yapılandırılmış teklif üretir, cpqTemplates/cpqQuotes koleksiyonlarına yazar ve teklif durumunu (Gönderildi/Onaylandı) günceller. |  |
| `CanliSevkiyatPanel.tsx` | 395 |  | 1 |  | ✅ saglam | ui, altyapi | Sevkiyatın canlı durumunu Getir düzeninde gösterir (müşteri/adres/tahmini varış, aracın son konumu haritası, sürücü Ara/Mesaj) — sürücü tarayıcı GPS'i vehiclePositions/<vehicleId>'yi ezer. |  |
| `CareerPage.tsx` | 194 |  | 1 |  | ✅ saglam | ui | Genel (girişsiz) kariyer sayfası — sabit TR/EN değerler ve açık pozisyon kartları; App.tsx 'careers' rotasında lazy yükleniyor. |  |
| `CargoTrackingTab.tsx` | 350 |  | 1 |  | ⚠️ supheli | ui, altyapi | Lojistik sekmesinde kargo takip numarası girip taşıyıcı (DHL/UPS/FedEx/Yurtiçi/MNG/Aras/PTT) durumunu trackingService ile sorgular ve cargoTracking koleksiyonuna kaydeder. | Satır 102-103 UI metni: 'Türk kargo firmaları demo modunda çalışır' — Cetpa'nın gerçek taşıyıcıları (Yurtiçi/MNG/Aras/PTT) için trackShipment gerçek API'ye bağlı değil; kullanıcı takip no girince uydurma durum görür. Uluslararası taşıyıcılar da API anahtarı gerektiriyor. Ayrıca ceviri=16 inline tr/e |
| `CariEkstrePanel.tsx` | 547 |  | 6 | 13 | ⚠️ supheli | para, mikro | Müşteri/tedarikçi cari ekstresi ve vade analizi (0/30/60/90/120+ gün yaşlandırma) — Mikro modunda GET /api/mikro/cari-hareket ile cha_* satırlarından bakiye hesaplar, aksi halde orders koleksiyonundan. | Sahte kesinlik: satır 221/230/490 `Number(x.cha_meblag ?? 0)` — Mikro satırında cha_meblag yoksa bakiyeye sessizce 0 eklenir; satır 299 `Number(o.totalPrice ?? o.totalAmount ?? 0)` — tutarsız sipariş yaşlandırma kovasına 0 olarak düşer (alacak eksik raporlanır); satır 391 `computedBalance ?? balance |
| `ConfirmModal.tsx` | 98 |  | 1 |  | ✅ saglam | ui | GlobalConfirm üzerinden kullanılan, danger/warning/info varyantlı genel onay diyaloğu (Sil/Vazgeç). |  |
| `CorporateGovernanceModule.tsx` | 910 |  | 1 | 3 | ⚠️ supheli | ui, belge | Kurumsal yönetim: yönetim kurulu toplantıları, genel kurul toplantıları, ortaklar (pay yüzdesi toplamı denetimli) ve sözleşmeler için CRUD ekranı (KurumsalPage'den). | Yarım düzeltme kaynağı: kopya.ceviri=129 — inline `currentLanguage==='tr'?` 129 kez elle yazılmış, tek dosyada ölçülen en yüksek değer; bir metin/etiket değişikliği 129 ayrı yerde tutarlı tutulmalı. 910 satır, test=yok. |
| `CustomerCombobox.tsx` | 88 |  | 5 |  | ✅ saglam | ui | Lead listesinden arama yaparak müşteri seçtiren yeniden kullanılabilir combobox (sipariş, sevkiyat, e-belge, lot/seri ekranlarında 5 yerden kullanılıyor). |  |
| `CustomerStatementModal.tsx` | 136 |  | 1 | 3 | ⚠️ supheli | para, ui | Seçili müşterinin siparişlerinden toplam/ödenen/açık ciro hesaplayıp cari ekstre modalı olarak gösterir. | Sahte kesinlik + yarım düzeltme kaynağı: satır 24-25 ve 100'de `(o.totalPrice || 0)` ile toplam/ödenen ciro toplanıyor (totalPrice'ı olmayan sipariş 0 TL sayılır, ekstre eksik çıkar); 15 inline `currentLanguage==='tr'?` ve 3 elle tarih parse. Ayrıca satır 23 `o.customerName === stmtLead?.name` eşleş |
| `DashboardAnalysis.tsx` | 118 |  | 1 |  | ✅ saglam | ui | Dashboard verisini Gemini'ye gönderip Markdown analiz sonucunu modal içinde gösterir. |  |
| `DataImportWizard.tsx` | 808 |  | 1 | 2 | ⚠️ supheli | para, ui | CSV'den ürün (inventory) ve müşteri (leads) toplu içe aktarma sihirbazı; kolon eşleştirme, VKN/ad ile mevcut cariye merge, batch yazma. | Sahte kesinlik KALICILAŞIYOR: satır 323-324 `stockLevel: Number(mapped.stockLevel) || 0`, `costPrice: Number(mapped.costPrice) || 0` ve satır 327-332 tüm `prices` katmanları sabit 0 — CSV'de maliyet/stok kolonu eşlenmemişse ürün DB'ye 0 maliyet/0 stok/0 fiyatla yazılır, sonra kârlılık raporları %100 |
| `DateRangePicker.tsx` | 34 |  | 2 |  | ✅ saglam | ui | Başlangıç/bitiş tarihi seçen iki date input'lu küçük kontrol bileşeni. |  |
| `DealerCommissionPanel.tsx` | 716 |  | 1 | 2 | ⚠️ supheli | para, ui | Bayi komisyon kurallarını (commissionRules) tanımlar ve bayi siparişlerinden hedef/komisyon/bonus hesabını grafikle gösterir. | Yarım düzeltme kaynağı: 62 inline `currentLanguage==='tr'?` çevirisi (tek dosyada en yüksek). Sahte kesinlik: satır 222 `actualSales = dealerOrders.reduce((s,o)=> s+(o.totalPrice||0))` — tutarı bilinmeyen sipariş 0 sayılıp komisyon hedefi eksik hesaplanır; satır 227 `rule?.bonusRate || 0`. test yok. |
| `DekontModal.tsx` | 208 |  | 1 |  | ⚠️ supheli | mikro, para | Cari için tutar/tarih/tür girilerek Mikro'ya DekontKaydetV2 ile dekont/masraf kaydı gönderen onaylı giriş ekranı. | mikro=true + test=false: `/api/mikro/cari-hareket/turler` (satır 59) ve `pushMikroEvrak('DekontKaydetV2', dekontPayload(...))` (satır 86) ile Mikro'ya muhasebe belgesi yazıyor, 11 para-matematiği eşleşmesi, hiçbir test yok. Bakiye işareti (eksi = Cetpa borçlu) ve evrak türü eşlemesi testle korunmuyo |
| `DeliveryNoteModal.tsx` | 71 |  | 1 |  | ✅ saglam | belge, ui | Sipariş teslimatını onaylarken teslimat notu girilen küçük onay modalı. |  |
| `DemandForecastPanel.tsx` | 396 |  | 1 | 8 | ⚠️ supheli | para, mikro, ui | Son 90 gün orders + mikroFaturalar + mikro stok hareketleri + inventory'yi toplayıp Gemini'ye gönderir; talep trendi, 3 aylık nakit akışı ve yeniden sipariş uyarıları çizer. | Ölçüm mikro=false diyor ama istemci tarafında Mikro kolon adlarını doğrudan okuyor (satır 136-161: cha_tip, cha_iptal, cha_meblag, cha_tarihi, sth_stok_kod, sth_tarih, sth_miktar). Sahte kesinlik: satır 136 `Number(f.cha_iptal ?? 0) === 0` — mirror'da cha_iptal taşınmıyorsa iptal faturalar ciroya gi |
| `DocumentDesigner.tsx` | 706 |  | 2 |  | ✅ saglam | belge, pdf, ui | Fatura/teklif/irsaliye/sipariş/makbuz belge şablonlarını (documentTemplates) tasarlayıp önizler ve kaydeder. |  |
| `DunningModule.tsx` | 615 |  | 1 | 4 | ⚠️ supheli | para, ui | Vadesi geçmiş siparişleri dunningInvoices'a aktarıp politika (dunningPolicies) tabanlı hatırlatma kademeleri, aktivite logu ve DSO KPI'sı yönetir. | Sahte kesinlik: satır 216 `(o.totalPrice ?? 0) > 0` — tutarı bilinmeyen vadesi geçmiş sipariş sessizce içe aktarılmaz (takipten düşer); satır 228 `amount: o.totalPrice ?? 0` DB'ye 0 borç yazar; satır 209 dueDate yoksa varsayılan +30 gün vade uydurulur. paraMatematigi 23, test yok; dunningInvoices il |
| `EBelgeMerkezi.tsx` | 992 |  | 1 | 7 | ⚠️ supheli | belge, mikro, para | e-Fatura/e-Arşiv/e-İrsaliye/e-SMM belgelerini Mikro/GİB'den çeker, listeler, PDF indirir, elle belge girişi ve native invoices'tan e-Fatura gönderimi yapar; Luca kontör ve VKN sorgusu gösterir. | mikro=true + test=false (992 satır, 3 koleksiyon: eBelgeler/invoices/settings). Sahte kesinlik: satır 544-547 `lucaKontor.remaining ?? 0` / `limit ?? 0` — API cevap vermezse ekran 'Kalan Kontör 0' der (kullanıcı kontör bitti sanır); satır 584 `formatCurrency(inv.totalPrice ?? 0)` tutarsız fatura 0,0 |
| `ERPHubPanel.tsx` | 521 |  | 1 |  | ✅ saglam | altyapi, guvenlik | Ayarlar sayfasında desteklenen ERP'leri (Mikro/Paraşüt/Luca/Logo/Dynamics/SAP) kart olarak gösterir, tek aktif ERP seçtirir ve seçimi settings/erpHub + settings/mikro|parasut|luca dokümanlarına aynalayıp ERP kimlik bilgilerini settings/<erp>'e kaydeder. |  |
| `EditLeadModal.tsx` | 95 |  | 1 |  | ✅ saglam | ui | Mevcut müşteri adayının (Lead) alanlarını düzenleyip onSubmit ile üst bileşene teslim eden modal form (App.tsx:6007'de bağlı). |  |
| `EditOrderModal.tsx` | 106 |  | 1 |  | ✅ saglam | ui, para | Mevcut siparişin (Order) alanlarını — totalPrice dahil — düzenleyip onSubmit ile üst bileşene teslim eden modal form (App.tsx:6016'da bağlı). |  |
| `EmailComposeModal.tsx` | 142 |  | 1 |  | ✅ saglam | ui | Müşteri adayına sunucu üzerinden (authedFetch) e-posta yazıp gönderen ve gönderim sonrası leads dokümanını güncelleyen modal (App.tsx:6143'te bağlı). |  |
| `FinancePanel.tsx` | 514 |  | 1 | 10 | ⚠️ supheli | para, mikro, ui | Sipariş + Mikro-fatura türevi kayıtlardan toplam ciro/maliyet/net kâr KPI'ları, tahsilat oranı, vade kovaları ve finansal sağlık skorunu hesaplayıp gösterir (App.tsx:5348). | Sahte kesinlik: satır 78-79 `(o.totalPrice || 0)` ve `(o.cost || 0)` ile toplanıyor; hiçbir siparişte cost alanı yoksa Toplam Maliyet=0 → Net Kâr=Ciro ve marginPct=100 gösterilir (satır 150), ‘bilinmiyor’ değil. totalPrice eksik kayıt ciroya 0 olarak girer. 10 adet `|| 0` + 13 para-matematiği eşleşm |
| `FiyatKarsilastirmaPanel.tsx` | 277 |  | 1 |  | ⚠️ supheli | para, mikro, ui | Satın Alma sekmesinde SKU bazında ortalama alış vs satış fiyatı ve marjı sunucu ucundan (/api/reports/stok-fiyat-karsilastirma) çekip listeler; satıra tıklanınca Mikro fatura detayını faturaEsle ile eşleştirip açar (SatinAlmaPage:1188). | mikro=true + test=false: satır 250 `faturaEsle(mikroFaturalar, …)` eşlemesi ve MikroFaturaDetay verisi testsiz (kolon adı tahmin yasağı doğrulanmamış). Para biçimleme 4 kez elle `toLocaleString('tr-TR')` kopyalanmış (yarım düzeltme kaynağı). Fiyat alanları `number | null` tipli — sahte sıfır YOK, bu |
| `GecmisSayimlar.tsx` | 122 |  | 1 | 7 | ✅ saglam | ui | Tamamlanmış fiziksel sayım arşivini (stockCounts) salt-okunur listeler; fark çıkan kalemleri, toplam sayılan kalem ve sayan kişiyi gösterir (InventoryPage:969; yazan taraf App.tsx:1755). |  |
| `GelirTanimaModule.tsx` | 644 |  | 1 | 1 | ✅ saglam | para, tenant | IFRS 15 5-adım gelir tanıma: sözleşme + edim yükümlülüğü dağılımı (standalonePrice/allocationPercent) ve tanıma takvimini revenueContracts/revenueSchedules koleksiyonlarına yazıp listeler (App.tsx:5385). |  |
| `GlobalConfirm.tsx` | 29 |  | 1 |  | ✅ saglam | ui | App kökünde bir kez mount edilir; lib/confirm.ts'teki imperative confirmAction/confirmDelete çağrılarını dinleyip ConfirmModal olarak render eder (App.tsx:598). |  |
| `GlobalSearch.tsx` | 345 |  | 1 | 2 | ✅ saglam | ui | Cmd/Ctrl+K komut paleti: bellek-içi sipariş/müşteri adayı/ürün listelerinde skorlu arama yapar, klavye gezinmesiyle seçimi üst bileşene iletir (App.tsx:6025). |  |
| `HRModule.tsx` | 1,454 |  | 2 | 17 | ⚠️ supheli | para, mikro, ui | İK modülü: personel, izin talebi, bordro, performans, eğitim ve seyahat/avans kayıtlarını yönetir; Mikro personel listesini employees'e senkronlar ve izin talebini MikroPushButton ile Mikro'ya gönderir (IKPage:805). | Sahte kesinlik dış veride: satır 221 `salary: mPer.salary || 0` — Mikro'dan maaşı gelmeyen personel employees'e maaş=0 ile yazılır; satır 1302 bordro formu `baseSalary: emp?.salary || 0` ile 0 maaşlı bordro hazırlar, satır 664 toplam maaş düşük çıkar. Satır 863 `MIKRO_IZIN_TIPI[req.type] ?? 0` — eşl |
| `HoldingModule.tsx` | 726 |  | 1 | 1 | ✅ saglam | para, tenant | Holding altındaki bağlı şirketleri, hesap planlarını ve şirketler-arası işlemleri yönetip kurla TL'ye çevrilmiş konsolide bilanço/gelir tablosu gösterir (App.tsx:5379'da render). |  |
| `IhracatModule.tsx` | 700 |  | 1 | 1 | ✅ saglam | para, tenant | İhracat, ithalat, akreditif ve gümrük beyannamesi kayıtlarını tutup döviz tutarlarını kur varsa TL KPI'ya çevirir, kur yoksa null/— gösterir (App.tsx:5607'de render). |  |
| `IntegrationHealthPanel.tsx` | 110 |  | 1 |  | ✅ saglam | altyapi, guvenlik | /api/integrations/health'ten entegrasyon anahtarlarının yapılandırılmış/eksik durumunu (değerleri değil) Ayarlar sayfasında listeler (SettingsPage.tsx:113). |  |
| `InventoryView.tsx` | 1,703 |  | 2 | 39 | ⚠️ supheli | para, mikro, tenant, ui | Envanter ana ekranı: ürün listesi, stok hareketleri (Cetpa + Mikro ham sth_* satırlarını normalize eder), CSV içe/dışa aktarma, konsinye, sayım farkı ve Mikro'ya stok hareketi push'u. | (1) Sahte kesinlik + veri ezme: CSV import satır 522-528 `prices: {'Retail': Number(row['price_Retail']) || 0, ... 'Dealer': ... || 0}` ve satır 535 mevcut ürüne updateDoc — CSV'de price_Dealer kolonu yoksa mevcut Dealer fiyatı 0'a EZİLİR. (2) Mikro kolon adı testsiz: satır 187-200 `raw.sth_stok_kod |
| `KasaModule.tsx` | 772 |  | 3 | 5 | ⚠️ supheli | para, tenant | Nakit kasaları (TRY/USD/EUR), giriş/çıkış hareketlerini ve gün sonu kasa kapanışlarını yönetip kasa bakiyesi ve günlük özet gösterir. | Sahte kesinlik: satır 423 `'Açılış Bakiyesi', value: kapanislar[0]?.kapanisBakiye ?? 0` ve satır 428 `(kapanislar[0]?.kapanisBakiye ?? 0) + bugunGiris - bugunCikis` — hiç kapanış yoksa ya da son kapanış dünden eskiyse açılış 0/bayat kapanış olarak kesin gösterilir; satır 176 `parseFloat(hForm.tutar) |
| `KpiCurrencyToggle.tsx` | 15 |  | 5 |  | ✅ saglam | ui | KPI kartları için ₺/$/€ para birimi seçici düğme grubu (5 sayfada paylaşılıyor). |  |
| `KurUyarisi.tsx` | 71 |  | 2 |  | ✅ saglam | para, ui | USD/EUR maliyetli kalemlerin kuru yoksa 'toplam eksik' uyarısını gösterir, kur gelince kendiliğinden kaybolur (sahte kesinlik önleyici). |  |
| `LabelSheetModal.tsx` | 262 |  | 3 | 1 | ✅ saglam | belge, mikro, ui | Ürün etiketlerini A4 3×3 sayfada QR ile önizleyip gizli iframe üzerinden yazdırır; aynı adetleri Mikro Etiket Kuyruğu'na (etiketPayload) gönderir. |  |
| `LandingPage.tsx` | 2,213 |  | 1 |  | ✅ saglam | ui | Giriş öncesi halka açık pazarlama sayfası: modül tanıtımı, fiyatlandırma, testimonials/settings okur, partnerApplications'a başvuru yazar (App.tsx:3536). |  |
| `LegalModule.tsx` | 1,362 |  | 1 | 2 | ⚠️ supheli | belge, para, guvenlik, tenant, ui | Sözleşmeler, davalar, KVKK uyum maddeleri, veri talepleri, hukuki belgeler (Firebase Storage yükleme) ve onay istekleri yönetimi (HukukPage.tsx:73'te render). | Yarım düzeltme kaynağı: ceviri=169 inline `currentLanguage==='tr'?` (grubun en yükseği), para=4 elle toLocaleString. Sahte kesinlik: satır 356-357 `activeContractsValue = ...reduce((sum,c)=> sum + (Number(c.value)||0),0)` / `totalCasesValue ... (Number(c.amount)||0)` — tutarı girilmemiş sözleşme/dav |
| `LocationQRModal.tsx` | 79 |  | 1 |  | ✅ saglam | belge, ui | Depo veya araç için CETPA-LOC:<type>:<id> biçiminde QR etiketi gösterip window.print ile yazdırır (OrdersPage.tsx:3606). |  |
| `LocationStockReport.tsx` | 66 |  | 1 | 4 | ✅ saglam | ui | locationStocks kayıtlarını depo/araç bazında gruplayıp her lokasyondaki ürün miktarını listeler (QR transfer sisteminin Faz4 raporu). |  |
| `LogisticsMap.tsx` | 74 |  | 1 |  | ✅ saglam | ui | Leaflet haritasında sipariş konumlarını, rota duraklarını ve depoyu işaretleyip rota çizgisini çizer (OrdersPage'de lazy yüklenir). |  |
| `LotSeriModule.tsx` | 561 |  | 1 |  | ✅ saglam | ui, tenant | Lot/parti ve seri numarası kayıtlarını, lot hareketlerini ve kalan miktarı takip eder (lotKayitlari/seriNolar/lotHareketleri; App.tsx:5764'te render). |  |
| `LucaSyncPanel.tsx` | 372 |  | 1 | 1 | ✅ saglam | belge, altyapi, para | Luca muhasebe bağlantısını test eder, sipariş faturası gönderir, Luca stoğunu çeker ve lucaSyncLog'u listeler (ERPHubPanel içinde). | Ajan "sync/fatura ve sync/stok rotası yok" demişti — server.ts:3463 ve :3528'de VAR. Düzeltildi. |
| `MRPModule.tsx` | 748 |  | 1 | 6 | ⚠️ supheli | mikro, ui | İş merkezleri, rota şablonları ve kapasite yükü tanımlayıp BOM'u patlatarak üretim/satın alma önerileri üretir ve öneriyi MikroPushButton ile Mikro'ya talep evrakı olarak gönderir. | Satır 731: `const sku = (s as unknown as { sku?: string }).sku ?? s.itemName;` — Suggestion tipinde (satır 77) sku alanı YOK, push'larda (221/243) yalnız itemName set ediliyor → cast her zaman undefined, ürün ADI stok kodu olarak SatinAlmaTalepKaydetV2/UretimTalepKaydetV2'ye gider (Mikro'da stok kod |
| `MaliyetMerkeziModule.tsx` | 1,112 |  | 3 | 2 | ⚠️ supheli | para, ui | Maliyet merkezlerini ve masraf kalemlerini tanımlar, bütçe/gerçekleşen karşılaştırması ile grafik rapor sunar (AccountingModule:2808 ve MuhasebePage:1102'de iki ayrı yüzeyde render). | kopya.ceviri=12 inline `currentLanguage==='tr'?` + paraMatematigi=25: aynı çeviri/para işi elle 12 kez yazılmış (yarım düzeltme kaynağı). Satır 338/401: `parseFloat(merkezForm.butce) || 0` / `parseFloat(kalemForm.tutar) || 0` — boş bırakılan bütçe/tutar 0 olarak kaydedilir, 'bütçe belirlenmedi' ile  |
| `MarketplacePanel.tsx` | 347 |  | 1 | 3 | ✅ saglam | altyapi, tenant, guvenlik | Trendyol ve Hepsiburada API kimliklerini settings/trendyol ve settings/hepsiburada belgelerine kaydeder, bağlantıyı test eder ve siparişleri orders koleksiyonuna çeker (SettingsPage'de; rotalar kanalRoutes.ts'te mevcut). |  |
| `MfaSettings.tsx` | 187 |  | 1 |  | ✅ saglam | guvenlik | Kullanıcının kendi sunucu-TOTP 2FA'sını kurup kaldırmasını (MfaSettings) ve girişte kod doğrulamasını (MfaChallengeModal) sağlar; App.tsx:4670/4712'de render. |  |
| `MikroFaturaDetay.tsx` | 282 |  | 6 | 10 | ⚠️ supheli | mikro, para, belge | Mikro faturasının kalem satırlarını (/api/mikro/fatura/kalemler) matrah/KDV kırılımıyla gösterir ve e-belge XML/PDF'ini Mikro'dan indirir (6 yüzeyden açılır). | Satır 105-106 ve 217-219: `Number(k.sth_vergi ?? 0) || 0`, `Number(k.sth_tutar ?? 0) || 0` — sunucu tarafı mikroMirror.ts:425 sth_vergi'yi `numOrNull` ile NULL bırakabiliyor; istemci NULL'ı 0'a çevirip KDV ₺0 ve yanlış oran gösteriyor (sahte kesinlik, sunucuyla çelişen yarım düzeltme). sifir=10, par |
| `MikroPushButton.tsx` | 72 |  | 11 |  | ✅ saglam | mikro, ui | Herhangi bir modülden tek tıkla Mikro'ya evrak gönderen (pushMikroEvrak) ince buton sarmalayıcısı; sonucu yanında gösterir, 11 modül kullanıyor. |  |
| `MikroSyncPanel.tsx` | 1,217 |  | 1 | 14 | ⚠️ supheli | mikro, para, altyapi | Mikro bağlantı durumunu gösterir; stok/cari/bakiye/mizan/KDV çekimlerini ve dummy temizliğini tetikler; stokMiktarImport iş ilerlemesini, mikroFaturalar ve syncLog'u listeler, retry kuyruğunu yönetir (ERPHubPanel içinde). | Satır 173: `query(collection(db, 'mikroFaturalar'), limit(50))` — orderBy yok, 'son 50 fatura' değil şimin döndürdüğü rastgele 50 satır listelenir; yeni gelen faturalar panelde görünmeyebilir. Satır 314: `(d.kdvMatrahi ?? 0).toLocaleString(...)` para alanına `?? 0` (sunucu mikroRoutes:3091 şimdilik  |
| `MobileWMSModule.tsx` | 918 |  | 1 | 8 | ⚠️ supheli | mikro, altyapi, tenant | Mobil depo operasyonları ekranı: barkod tarama, mal kabul/sevk görevleri (wmsTasks), depo konumları (wmsLocations) ve sayım sonuçlarını inventory.stockLevel'a yazıp Mikro'ya SayimSonuclariKaydetV2 ile gönderir. | (1) Yarım düzeltme: yazma tarafı kanonik 'stockLevel'a taşınmış (satır 338-342 yorumu bunu söylüyor) ama sayım sistem miktarı hâlâ `systemQty: i.quantity || i.stock || 0` (satır 311) ve tarama kartı `item.quantity ?? item.stock ?? 0` (414) okuyor → stockLevel=50/quantity boş ürün sayımda 0 görünür,  |
| `ModuleHeader.tsx` | 49 |  | 33 |  | ✅ saglam | ui | 33 modülün paylaştığı başlık şeridi: ikon + başlık + alt başlık + sağda aksiyon düğmesi. |  |
| `ModuleStatusBoard.tsx` | 213 |  | 1 |  | ✅ saglam | altyapi, ui | Süper-admin panelinde 10+ API uç noktasına canlı istek atıp gerçek HTTP durum/gecikme gösterir ve GET /api/ops/module-status (opsRoutes.ts:238, requireSuperAdmin) verisinden modül olgunluk sezgisi çizer. |  |
| `MuhasebeGroupNav.tsx` | 49 |  | 1 |  | ✅ saglam | ui | Muhasebe / E-Belge Merkezi / Vergi Takvimi üçlüsünün üst gezinme şeridi; App.tsx'te 2 yerde render edilen tek kaynak. |  |
| `MuhasebeMenuBar.tsx` | 49 |  | 1 |  | ✅ saglam | ui | lib/muhasebeMenu'deki MUHASEBE_MENU'den beslenen yatay muhasebe menüsü; alt sayfalara geçince barın kaybolmaması için ortak bileşen. |  |
| `MuhtasarModule.tsx` | 637 |  | 1 |  | ⚠️ supheli | para, belge, tenant | employees'dan bordro hesaplar (sabit gelir vergisi dilimleri, SGK %14/%20,5, damga %0,759), payrollEntries'e yazar ve Muhtasar/SGK XML beyannamesi üretip taxDeclarations'a kaydeder. | (1) Sahte kesinlik — belge: `generateMuhtasarXML(activeEntries, selectedPeriod)` (satır 249-250) üçüncü parametreyi hiç geçmiyor → her beyannamede `<VergiKimlikNo>0000000000</VergiKimlikNo>` (127) ve `<IsyeriKodu>0000000000</IsyeriKodu>` (164); şirket vergi no hiçbir yerden bağlanmamış (taxId/vergiN |
| `MutabakatPanel.tsx` | 378 |  | 1 |  | ⚠️ supheli | para, pdf, belge | GET /api/mutabakat/:leadId'den (server.ts:2922, requireAuth+leads read) cari bakiye ve açık siparişleri çekip jsPDF ile mutabakat mektubu üretir, WhatsApp/e-posta ile paylaşır. | Yarım düzeltme kaynağı: para biçimlendirme 8 yerde elle `toLocaleString('tr-TR', {minimumFractionDigits:2})` + sabit `₺` (satır 118,124,142,230,231,321,332) — ortak formatlayıcı yok; para formatı/para birimi düzeltmesi başka yüzeyde yapılırsa bu yasal belgeye ulaşmaz, döviz cari için bakiye ₺ olarak |
| `NewLeadModal.tsx` | 146 |  | 1 |  | ✅ saglam | ui | Zod doğrulamalı yeni müşteri adayı formu modalı (ad, firma, e-posta, 10/11 haneli vergi no, sektör); veriyi kaydetmez, üst bileşene döndürür. |  |
| `OnboardingChecklist.tsx` | 239 |  | 1 |  | ✅ saglam | ui | Yeni kullanıcı için 7 adımlık kurulum rehberi kartı; tamamlanan/kapatılan durumu userOnboarding/{uid}'de tutar (server.ts:1224 listesinde), adıma tıklayınca ilgili sayfa/alt-sekmeye yönlendirir. |  |
| `OnboardingFlow.tsx` | 578 |  | 1 |  | ⚠️ supheli | altyapi, guvenlik | İlk kayıt sihirbazı: firma bilgisi/sektör/plan seçimiyle deneme aboneliği başlatır, ERP (mikro/paraşüt) ve SaaS/self-hosted seçimini settings/companyProfile, settings/erpHub, settings/<erp>'e yazar, self-hosted için .env/docker/README paketi üretir. | Self-hosted paketinde DB parolası iki ayrı yerde bağımsız üretiliyor: satır 45 `vps.dbPassword || 'CHANGE_ME_' + Math.random()...` ve satır 86 `vps.dbPassword || 'cetpa_' + Math.random()...` → kullanıcı parola alanını boş bırakırsa üretilen iki dosya FARKLI rastgele parola taşır, kurulan uygulama Po |
| `OpsWatchdogCard.tsx` | 145 |  | 1 |  | ✅ saglam | altyapi, ui | Süper-admin panelinde Operasyon Bekçisi'nin günlük kontrol sonuçlarını (yedek, Mikro sync, stok oranı, retry kuyruğu, kur) ve Node/firebase-admin runtime bilgisini gösterir; GET/POST /api/ops/watchdog ile elle tetikler. |  |
| `OrderTrackingView.tsx` | 263 |  | 1 |  | ✅ saglam | ui | ?track=<orderId> ile açılan kimlik doğrulamasız genel sipariş takip sayfası; GET /api/track/:orderId'den durumu çekip müşteriye markalı zaman çizelgesi gösterir. |  |
| `OverduePanel.tsx` | 133 |  | 1 | 2 | ⚠️ supheli | para, ui | Vadesi geçmiş ödemeli siparişleri yaşına göre listeleyen, toplam alacağı gösteren ve 'ödendi' işaretlemeye izin veren yan panel. | Sahte kesinlik: satır 43 ve 90 `o.totalPrice ?? (o as any).totalAmount ?? 0` — tutarı olmayan (Mikro faturasından türetilmiş) sipariş toplam alacağa 0 ₺ olarak girer, başlıktaki '₺… toplam' eksik gösterilir. Yarım düzeltme kaynağı: 7 inline `currentLanguage === 'tr' ?` çevirisi + 3 elle toLocaleStri |
| `PaymentMethodModal.tsx` | 104 |  | 1 | 1 | ⚠️ supheli | para, ui | Sipariş için ödeme yöntemi (nakit/kart/havale) seçtiren onay modalı; sipariş tutarını gösterir ve seçimi onConfirm ile döner. | Satır 45 `(order.totalPrice ?? totalAmount ?? 0).toLocaleString` — tutarı bilinmeyen siparişte modal '₺0,00' gösterir (sahte kesinlik). Satır 7'de `src/lib/utils` içindeki `cn` yardımcısının ikinci kopyası export ediliyor; 9 inline çeviri (yarım düzeltme kaynağı). |
| `PerformansModule.tsx` | 472 |  | 2 | 1 | ✅ saglam | ui | İK performans değerlendirme modülü: dönem (yıllık/yarıyıl/çeyrek), çalışan başına ağırlıklı OKR ve yetkinlik puanlama, durum akışı ve ekip özeti; performanceReviews koleksiyonunu okur/yazar. |  |
| `PriceIntelPanel.tsx` | 230 |  | 1 | 4 | ⚠️ supheli | para, ui | Fiyat istihbarat paneli: ürün seçip Trendyol/Amazon rakip fiyatlarını çeker (veya elle girer), pricingEngine ile satış fiyatı önerisi ve azami toptan alış fiyatı üretir. | Sahte kesinlik: satır 55 `cost = Number(selected?.costPrice ?? selected?.cost ?? 0) || 0` ve satır 56 aynı desen satış fiyatı için — maliyeti girilmemiş ürün için pricingEngine 0 maliyetle marj/öneri/maxBuyPrice hesaplar; 'maliyet bilinmiyor' yerine uydurma öneri ekrana çıkar. |
| `PriceListForm.tsx` | 372 |  | 1 | 2 | ⚠️ supheli | para, ui | Fiyat listesi oluştur/düzenle modalı: envanterden ürün seçip taban fiyata karşı özel fiyat girer, priceLists koleksiyonuna kaydeder. | Satır 78 ve 244 `product.prices?.['Retail'] ?? product.price ?? 0` — perakende fiyatı tanımsız ürün listeye basePrice=0 ile eklenir ve priceLists'e 0 ₺ olarak yazılır; B2BPortal (tek import eden) bu fiyatı müşteriye gösterir. |
| `PricingPage.tsx` | 361 |  | 1 |  | ✅ saglam | ui | SaaS abonelik plan seçim sayfası: aylık/yıllık döngü, plan karşılaştırma tablosu, SSS ve deneme başlatma; App.tsx showPricingPage ile render edilir. |  |
| `PrivacyPage.tsx` | 139 |  | 1 |  | ✅ saglam | ui | KVKK gizlilik politikası genel sayfası (TR/EN, karanlık mod, sekme başlığı); App.tsx'te `privacy:` rotasına lazy bağlı. |  |
| `ProductDetail.tsx` | 326 |  | 1 | 13 | ⚠️ supheli | para, mikro, ui | Ürün detay modalı: fiyat kademeleri, maliyet, stok, Cetpa+Mikro hareket geçmişi, son/ortalama satış fiyatı ve Mikro fatura detayına geçiş. | Sahte kesinlik (13 '?? 0'/'|| 0'): satır 91 `vatRate ?? 0` → KDV oranı olmayan üründe KDV dahil fiyat KDV hariçle aynı gösterilir; satır 133 `Number(product.costPrice) || 0` → maliyet girilmemişse kart 'Maliyet ₺0' der. Mikro'ya dokunuyor (useMikroFaturalar, sth_cari_kodu) ama test yok. Hareket tipi |
| `ProductForm.tsx` | 458 |  | 2 | 3 | ✅ saglam | para, ui | Ürün ekle/düzenle modalı: kategori, depo, kademeli fiyatlar, barkod ve stok; inventory'ye yazar, stok farkını inventoryMovements'a loglar, audit kaydı düşer. |  |
| `ProductionModule.tsx` | 1,591 |  | 2 | 6 | ⚠️ supheli | mikro, ui | Üretim modülü: üretim emirleri, BOM ve makine yönetimi, tamamlamada runTransaction ile hammadde düşüp mamul ekleme (ters kayıt), MikroPushButton ile iş emri/talep gönderme, grafikler. | Şema uyuşmazlığı: satır 565/582 `invItem?.quantity ?? 0` okur, satır 620-621 `mevcutVeri.quantity` okuyup `{ quantity: … }` yazar; oysa InventoryItem'ın kanonik stok alanı `stockLevel` (src/types.ts:39, `quantity` yalnız opsiyonel). stockLevel=500 ama quantity alanı olmayan hammadde → currentStock=0 |
| `ProjectModule.tsx` | 943 |  | 2 | 4 | ⚠️ supheli | ui | Proje yönetimi modülü — projeler, Kanban sürükle-bırak görevler ve kaynak planlamasını Gantt/takvim görünümüyle sunar (projects/resources/tasks). | kopya.ceviri=108: inline `currentLanguage==='tr' ?` ile çeviri 108 kez elle yazılmış (yarım düzeltme kaynağı). Ayrıca importEden=2 — hem src/App.tsx hem src/pages/ProjePage.tsx import ediyor; 2026-09-01 ProjePage çıkarmasından sonra App.tsx importu kalıntı olabilir, Faz 4 ölçsün. |
| `PurchasingModule.tsx` | 1,215 |  | 2 | 9 | ⚠️ supheli | para, mikro, pdf, belge | Satın alma modülü — tedarikçi kartı (Mikro cari arama/oluşturma), satın alma siparişi ve onayı, mal kabul ile stok hareketi, PO/irsaliye PDF'i ve Mikro'ya talep gönderimi. | mikro=true + test=false: pullCariFromMikro/syncSupplierToMikro/satinAlmaTalepPayload/useMikroSiparisler (satır 6-19, 84-97, 161) testsiz — kolon adı tahmin yasağı doğrulanmıyor. kopya.ceviri=74, tarih=7 (elle tarih parse), sifir=9, paraMatematigi=3. Satır 138 yorumu 2026-08-30 canlı çökmesini anıyor |
| `QualityModule.tsx` | 1,796 |  | 2 | 3 | ⚠️ supheli | ui | Kalite yönetimi modülü — QC kayıtları, şikayet, 8D, FMEA/PFMEA, 5S, Kaizen, C-TPAT ve denetim maddelerini Gemini önerileriyle yönetir (9 koleksiyon). | kopya.ceviri=184 — grubun en yükseği; 1796 satır, 9 koleksiyona yazıyor, test yok. importEden=2: App.tsx VE src/pages/KalitePage.tsx ikisi de import ediyor; 2026-09-01 çıkarma sonrası App.tsx importu kalıntı olabilir. |
| `QuickShipmentModal.tsx` | 97 |  | 1 |  | ✅ saglam | ui | Siparişten tek tıkla shipments koleksiyonuna sevkiyat kaydı oluşturan hızlı sevkiyat modalı. |  |
| `QuotationDetail.tsx` | 445 |  | 1 | 6 | ⚠️ supheli | para, pdf, mikro, belge | Teklif detay görünümü — teklifi Türkçe fontlu jsPDF ile PDF'e döker, siparişe çevirir ve Mikro'ya teklif evrakı gönderir. | Yarım düzeltme + sahte kesinlik: satır 35 yorumu 'totalAmount BİLİNMİYOR olabilir; 0 varsaymak yerine UI'da — gösteriyoruz' derken PDF yolunda satır 201 `const total = quotation.totalAmount || 0` ve satır 166-169 `item.quantity || 0`, `item.price || 0`, `item.vatRate ?? 0` — totalAmount'suz teklif e |
| `QuotationForm.tsx` | 378 |  | 1 | 2 | ✅ saglam | para, belge | Teklif oluşturma/düzenleme formu — müşteri seçimi, ürün arama ile kalem ekleme, para birimi ve quotations koleksiyonuna kayıt + audit log. |  |
| `ReadOnlyBanner.tsx` | 13 |  | 10 |  | ✅ saglam | ui | Salt-okunur bölümlerde 'Yalnızca Görüntüleme — düzenleyemezsiniz' uyarı şeridi gösterir (10 yerden kullanılıyor). |  |
| `ReportsDashboard.tsx` | 102 |  | 1 |  | ✅ saglam | ui | Raporlar ekranının kabuğu — başlık ve sekme çubuğu; altı rapor sekmesini React.lazy ile yükler, veritabanına yazmaz. |  |
| `ReturnModal.tsx` | 146 |  | 1 | 2 | ⚠️ supheli | para | Sipariş iade modalı — iade sebebi/kalem/tutar alıp returns koleksiyonuna yazar ve siparişi günceller. | Sahte kesinlik: satır 108 `const maxRet = Number(order.totalPrice) || 0` ve satır 96 `₺{(order.totalPrice || 0).toLocaleString('tr-TR')}` — totalPrice'ı olmayan sipariş (dış kaynaktan tutarsız gelen) için azami iade 0 gösterilir ve maxRet 0'a düşer; kopya.para=2 elle tr-TR biçimleme. |
| `RiskPanel.tsx` | 493 |  | 1 | 12 | ⚠️ supheli | para | Müşteri kredi riski paneli — cariBalances (Mikro aynası) ve lead kredi limitinden risk skoru/toplam maruziyet hesaplar, vadesi geçen siparişleri listeler. | Sahte kesinlik: satır 118 `Number(x.bakiye ?? 0)`, 148 `cariBalances.get(l.cariKod) ?? 0`, 149 `creditLimit || 0`, 391-393 `Number(c.currentBalance || 0)` — bakiye kaydı olmayan cari 0 bakiye = risksiz sayılır; satır 159/213 toplam maruziyet bu sıfırlar üstünden toplanır; 453 `order.totalPrice || 0` |
| `SabitKiymetModule.tsx` | 1,367 |  | 3 | 8 | ✅ saglam | para | Sabit kıymet (demirbaş) modülü — varlık kartı, doğrusal/azalan bakiye amortisman hesabı, bakım ve sigorta takibi (4 koleksiyon). |  |
| `SatinAlmaAjaniPanel.tsx` | 110 |  | 1 |  | ✅ saglam | ui | Kritik stokları sunucudaki /api/ai/satinalma-ajani ucuna gönderip tedarikçi bazlı gruplanmış satın alma siparişi önerisi (gerekçe+miktar) gösteren AI paneli. |  |
| `SatisAjaniPanel.tsx` | 131 |  | 1 |  | ✅ saglam | ui, para | Seçilen cari için /api/ai/satis-ajani'dan alım geçmişine dayalı yeniden-sipariş ve çapraz satış önerilerini (fiyat/stok sunucudan) listeleyen AI paneli. |  |
| `ServisModule.tsx` | 666 |  | 1 | 1 | ⚠️ supheli | mikro, tenant, belge | Servis talepleri, garantiler ve teknisyenleri (servisTalepleri/garantiler/teknisyenler) CRUD eden ve talebi MikroPushButton ile Mikro iş emri olarak iten satış-sonrası servis modülü. | mikro=true + test=false. Satır 296: `cariKod: (t as unknown as { mikroCariKod?: string }).mikroCariKod ?? ''` — ServisTalebi arayüzünde mikroCariKod alanı YOK, form da yazmıyor; her Mikro iş emri push'u cariKod='' ile gider (boş cari ile evrak). Ayrıca satır 217 memnuniyetPuani ?? 0 (puansız talep 0 |
| `ShortcutModal.tsx` | 106 |  | 1 |  | ⚠️ supheli | ui | Klavye kısayolları yardım penceresini (motion animasyonlu) gösterir. | kopya.ceviri=17 — 106 satırlık dosyada 17 inline currentLanguage==='tr' ternary; tek metin değişikliği/üçüncü dil 17 yeri elle düzeltmeyi gerektirir (yarım düzeltme kaynağı). Çalışma zamanı arızası yok, yalnız bakım riski. |
| `SkuMappingPanel.tsx` | 271 |  | 1 |  | ✅ saglam | mikro, altyapi | Mikro stok kodu ile Shopify/Trendyol/Hepsiburada SKU'larını skuMappings koleksiyonunda eşleştiren (otomatik eşleştirme POST /api/sku-mapping/auto-match + elle düzenleme) ayar ekranı. |  |
| `SonSenkronRozeti.tsx` | 108 |  | 1 |  | ✅ saglam | altyapi, ui | syncLog'un en yeni kaydından Mikro verisinin tazeliğini (<6sa yeşil / <36sa gri / üstü kehribar) dashboard rozeti olarak gösterir. |  |
| `SortHeader.tsx` | 38 |  | 2 |  | ✅ saglam | ui | Tablolarda tıklanınca sıralama yönünü değiştiren başlık hücresi (th) bileşeni; InventoryView ve B2BPortal kullanıyor. |  |
| `StockCountModal.tsx` | 162 |  | 1 | 1 | ⚠️ supheli | ui, altyapi | Fiziksel sayım sonucunu ürün bazında girip inventory.stockLevel'ı doğrudan updateDoc ile güncelleyen sayım penceresi. | Satır 80: `const current = item.stockLevel ?? 0` — stockLevel alanı olmayan (henüz senkronlanmamış) ürünün mevcut stoğu 0 sayılıp sayım farkı +N olarak hesaplanır; 'bilinmiyor' yerine sahte fark. Ayrıca kopya.ceviri=10 (inline çeviri tekrarı). |
| `SubeModule.tsx` | 554 |  | 1 | 5 | ⚠️ supheli | para, mikro, tenant | Şubeleri (subeler) ve şubeler arası stok transferlerini (subeTransferler) yönetir; orders + Mikro giden faturalarından şube bazlı aylık gelir/maliyet P&L hesaplar. | Satır 187-188: `o.costTotal ?? (o.totalPrice ?? 0) * 0.65` — costTotal olmayan siparişe UYDURMA %65 maliyet yazılır, şube P&L'inde sahte %35 marj görünür. Satır 183-186: Mikro faturası gelire eklenir ama maliyete eklenmez → Mikro ağırlıklı şubede marj şişer (yorumda kabul edilmiş). sifir=5, paraMate |
| `SubscriptionPanel.tsx` | 358 |  | 1 | 3 | ⚠️ supheli | para, ui | Kullanıcının abonelik planını, kalan deneme/dönem gününü, kullanım limitlerini ve ödeme geçmişini gösteren; plan değiştirme/iptal tetikleyen ayar paneli. | Satır 58: `amount: Number(p.amount) || 0` — amount alanı eksik/geçersiz ödeme kaydı geçmişte '0 TL ödendi' olarak listelenir. Satır 162: `plan?.monthlyPrice || 0` — plan konfigürasyonu bulunamazsa aylık ücret 0 gösterilir. sifir=3, paraMatematigi=6. |
| `SuperAdminPanel.tsx` | 716 |  | 1 | 2 | ⚠️ supheli | para, guvenlik, altyapi | Süper-admin için kiracı listesi (askıya alma, kullanıcı ekleme/çıkarma, abonelik/yedek durumu), MRR özeti ve OpsWatchdog/Trafik/Modül durum kartlarını gösteren yönetim paneli. | Satır 356: MRR hesabında `(t.amount || 0)` — abonelik tutarı bilinmeyen aktif kiracı MRR'a 0 katkı verir, toplam sessizce düşük raporlanır; 'N tenant tutarsız' yerine kesin rakam gösterilir. sifir=2, paraMatematigi=9, test=false. |
| `TahsilatModule.tsx` | 1,330 |  | 3 | 6 | ⚠️ supheli | para, mikro, belge | Alacak/tahsilat takibi: yerel tahsilat kayıtları ile Mikro açık alacaklarını (useMikroTahsilat) birleştirip yaşlandırma, ödeme girişi ve makbuz fotoğrafı yüklemesi sunar. | Satır 637: `(Number(paymentKaydi.toplamTutar) || 0) - (Number(paymentKaydi.tahsilEdilen) || 0)` — Mikro'dan türetilen `mikro-*` kayıtlar da bu listede; toplamTutar gelmezse açık bakiye 0 sayılır ve satır 638 her ödemeyi 'açık bakiyeyi (0.00) aşamaz' diye reddeder (sahte kesinlik). paraMatematigi=20, |
| `TermsPage.tsx` | 85 |  | 1 |  | ✅ saglam | ui | Genel Kullanım Koşulları sayfasını (TR/EN statik metin) gösterir, sekme başlığını ayarlar. |  |
| `TerritoryModule.tsx` | 471 |  | 1 | 2 | ✅ saglam | ui, para | Satış bölgesi CRUD'u, şehir bazlı otomatik müşteri atama ve temsilci kota/gerçekleşen karşılaştırması (orders'tan) yapar. |  |
| `Toast.tsx` | 60 |  | 6 |  | ✅ saglam | ui, altyapi | Uygulama geneli bildirim sağlayıcısı (ToastProvider + useToast); eski no-op stub'ın yerine gerçek toast kuyruğu. |  |
| `TrafikKarti.tsx` | 127 |  | 1 | 5 | ✅ saglam | ui, altyapi | Süper-admin panelinde çerezsiz 30 günlük trafik sayacını (/api/trafik/ozet) mini bar grafikle özetler. |  |
| `TransferScanPanel.tsx` | 193 |  | 1 | 1 | ✅ saglam | altyapi, ui | QR ile kaynak konum → ürün barkodu → miktar → hedef konum okutup POST /api/logistics/transfer ile atomik stok transferi yapar. |  |
| `UnauthorizedView.tsx` | 27 |  | 10 |  | ✅ saglam | ui, guvenlik | RBAC yetkisi olmayan sekmede 'Erişim Kısıtlı' ekranını gösterir. |  |
| `UpgradeModal.tsx` | 147 |  | 0 |  | 💀 olu | ui, para | Engellenen modül için abonelik planı yükseltme önerisi modalı (PLANS'tan modülü içeren ilk planı önerir). | `grep -rn UpgradeModal src` → kendi dosyası dışında 0 referans; importEden=0. Plan/modül kapısı hiçbir yerde bu modalı açmıyor. |
| `UrunAgaciModule.tsx` | 359 |  | 1 | 1 | ✅ saglam | altyapi, ui | Ürün ağacı (BOM) tanımlama ekranı; MRPModule'ün beklediği şekilde `urunAgaclari` koleksiyonuna mamul+bileşen listesi yazar (SKU ile envanterden seçim). |  |
| `VergiTakvimi.tsx` | 268 |  | 1 | 4 | ⚠️ supheli | para | Aylık vergi beyanname son tarihlerini şablondan üretip `vergiTakvimi`'nde takip eder; KDV dönemi için siparişlerden tahmini tutar önerir. | Satır 71-72: `(o.kdvOran ?? 20) / 100` ve `Number(o.totalPrice) || 0` — KDV oranı bilinmeyen sipariş %20 varsayılıyor, tutarı olmayan sipariş 0 katkı veriyor → dönem KDV tahmini sessizce yanlış. Satır 150: opsiyonel `tahminiTutar || 0` toplanıp 'Toplam Tutar' KPI'sı olarak sunuluyor (sahte kesinlik) |

### `src/components/accounting/` — 22 dosya, 4,470 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `BankaHareketleriTab.tsx` | 192 |  | 1 |  | ⚠️ supheli | mikro, para, ui | Muhasebe→Banka Hareketleri sekmesi: Mikro/Luca ERP bağlantı ayar formu ve Mikro'dan çekilen banka hareketleri listesi. | Satır 31 `mikroBankMovements: any[]` — Mikro banka hareketi alanları tipsiz, satır 159 map'inde kolon adları şema doğrulaması olmadan erişiliyor (Mikro kolon tahmini, test=yok). kopya.ceviri=22: aynı dosyada 22 inline `currentLanguage==='tr'?` dalı (yarım düzeltme kaynağı). |
| `BankaTab.tsx` | 406 |  | 1 | 11 | ⚠️ supheli | para, ui, mikro | Muhasebe→Banka sekmesi: TRY/USD/EUR banka hesaplarını ve hareketlerini listeler, döviz bazlı bakiye KPI drilldown'ı, CSV ekstre import ve Mikro banka hareketi çekme düğmelerini sunar. | kopya.para=12 ve 3'lü döviz ternary'si (₺/$/€ + toLocaleString) satır 75/79/83/184-185/339/342'de elle tekrarlanmış — biçim değişirse yarım düzeltme kaynağı. Satır 342 `(tx.balance ?? 0)`: ekstre satırında yürüyen bakiye yoksa 'Bakiye ₺0,00' basılır (sahte kesinlik); ceviri=36 inline. |
| `ButceTab.tsx` | 176 |  | 1 | 2 | ✅ saglam | para, ui | Bütçe kalemlerini (kategori/tutar/dönem) tanımlar ve yevmiye borç toplamıyla gerçekleşme oranını gösterir. |  |
| `CalisanlarTab.tsx` | 155 |  | 1 | 2 | ✅ saglam | ui | Çalışan listesi (ad, TC, pozisyon, maaş, işe giriş) arama/sıralama ve ekle/düzenle/sil modalı. |  |
| `CeklerTab.tsx` | 183 |  | 1 |  | ✅ saglam | para, ui | Çek/senet portföyünü listeler, sıralar, CSV'ye aktarır ve ekle/düzenle/sil modalını sunar. |  |
| `DepoTab.tsx` | 166 |  | 1 |  | ✅ saglam | ui | Depo bazlı stok kalemlerini (WarehouseItem) listeler, depo dağılım etiketi gösterir, ekle/düzenle/sil modalı sunar. |  |
| `FaturalarTab.tsx` | 381 |  | 1 | 7 | ⚠️ supheli | para, mikro, belge, ui | Cetpa faturaları ile Mikro fatura satırlarını kaynak filtresiyle (cetpa/mikro/hepsi) birleşik listeler, adet/satış/alış KPI'larını hesaplar, arama-sıralama-silme ve yeni fatura modalını sunar. | mikro=true + test=false (kolon adı tahmin yasağı test edilmemiş; satır 148 yorumu 'Alış toplamı cha_cinsi=6 filtresine dayanıyor'). Satır 153 `(i.totalPrice as number) || 0`: totalPrice'ı olmayan fatura KPI satış toplamına 0 olarak girer, toplam sessizce eksik çıkar. ceviri=53 (gruptaki en yüksek) i |
| `GelenIrsaliyeTab.tsx` | 117 |  | 1 | 2 | ✅ saglam | belge, ui | Gelen (alış) irsaliyelerini listeler, arar, sıralar ve düzenleme formunu doldurup modalı açar. |  |
| `GelirGiderTab.tsx` | 218 |  | 1 | 1 | ✅ saglam | para, ui | Seçili ay/yıl için gelir-gider özeti ve aylık grafik verisi gösterir; kur etiketi kur yoksa rakam yerine 'Kur bekleniyor' basar. |  |
| `GelirTablosuTab.tsx` | 247 |  | 1 | 2 | ⚠️ supheli | para, ui | Dönemsel gelir tablosu: seçili ay/yıl siparişlerinden gelir, çalışan maaşlarından gider hesaplar ve kurCevir ile TRY/USD/EUR seçimine göre gösterir. | Satır 31-33 elle tarih parse (toDate varsa çağır, yoksa `new Date(raw as string)`): createdAt eksik/ISO dışı sipariş Invalid Date olur ve dönem filtresinden sessizce düşer → dönem geliri eksik görünür. ceviri=28 inline (yarım düzeltme kaynağı), tarih=1. |
| `GidenIrsaliyeTab.tsx` | 117 |  | 1 | 2 | ✅ saglam | belge, ui | Giden (satış) irsaliyelerini listeler, arar, sıralar ve düzenleme formunu doldurup modalı açar (GelenIrsaliyeTab'ın birebir aynası). |  |
| `IsletmeSermayesiTab.tsx` | 88 |  | 1 | 1 | ⚠️ supheli | para, ui | İşletme sermayesi hesaplayıcısı: dönen varlık − kısa vadeli yükümlülük, cari oran ve İdeal/Yeterli/Riskli etiketi; defterden ön-doldurma düğmesi. | Satır 21 `cariOran = kvYukumluluk > 0 ? donenVarliklar / kvYukumluluk : 0`: yükümlülük 0 (ya da form hiç doldurulmamış) iken oran 0 sayılır ve satır 23-25 'Riskli' etiketi basılır — tanımsız oran 0'a çevrilmiş (sahte kesinlik), gerçekte borçsuz durum en iyi durumdur. |
| `KdvTab.tsx` | 189 |  | 1 | 2 | ✅ saglam | para, belge | Muhasebe→KDV sekmesi: ay/yıl seçimiyle hesaplanan/indirilecek/ödenecek KDV kartları, oran kırılımı (karma dahil) ve KDV beyannamesi PDF/CSV indirme butonları. |  |
| `MizanTab.tsx` | 196 |  | 1 |  | ✅ saglam | para, ui | Muhasebe→Mizan sekmesi: hesap bazlı borç/alacak/bakiye tablosu, denge kontrolü rozeti, TRY/USD/EUR KPI para birimi seçici ve CSV dışa aktarma. |  |
| `MusterilerTab.tsx` | 272 |  | 1 | 7 | ⚠️ supheli | para, ui | Muhasebe→Müşteriler sekmesi: cari listesi (bakiye/risk grubu), müşteri ekle/düzenle/sil modalı, dekont hedefi seçimi ve CariEkstrePanel ile cari ekstre görüntüleme. | Sahte kesinlik: ölçüm sifir=7, paraMatematigi=5. Satır 130-131 `(c.balance || 0)` ile bakiyesi bilinmeyen cari ₺0 ve gri (nötr) gösteriliyor; satır 157 dekont hedefine `bakiye: c.balance || 0`, satır 197 CariEkstrePanel'e `balance={ekstreMusteri.balance || 0}` geçiyor — bakiye alanı yoksa kullanıcı  |
| `SatislarTab.tsx` | 276 |  | 1 | 25 | ⚠️ supheli | para, mikro, ui | Muhasebe→Satışlar sekmesi: Cetpa siparişleri + opt-in Mikro satış faturalarını birleştirip ciro/faturalı/KDV KPI kartları, drill-down listeleri ve yıl/kaynak filtreli satış tablosu gösterir. | Sahte kesinlik + tutarsız toplam: ölçüm sifir=25, paraMatematigi=27, mikro=true, test=yok. Satır 247 `%{o.kdvOran ?? 0}` — KDV oranı bilinmeyen sipariş '%0 KDV' basılıyor; satır 61/80/84/116 `totalPrice || 0` ile tutarı eksik sipariş cirodan sessizce düşüyor. Ayrıca KPI kartı (satır 80, 116, 127) `o |
| `TedarikcilerTab.tsx` | 243 |  | 1 | 4 | ⚠️ supheli | para, ui | Muhasebe→Tedarikçiler sekmesi: tedarikçi listesi (bakiye/risk), ekle/düzenle/sil modalı, CSV dışa aktarma ve CariEkstrePanel ile tedarikçi ekstresi. | Sahte kesinlik: ölçüm sifir=4, para=1; MusterilerTab ile aynı kalıp (Supplier.balance → CariEkstrePanel balance prop'u). Bakiyesi bilinmeyen tedarikçi ₺0 gösterilir — satırlar bu turda tek tek açılmadı, ölçüme dayalı işaret. |
| `TransferTab.tsx` | 219 |  | 1 |  | ⚠️ supheli | mikro, altyapi | Muhasebe→Depo Transfer sekmesi: depolar arası transfer kayıt listesi, ekle/düzenle/sil modalı ve her satırda Mikro DepolarArasiSiparisKaydetV2 push butonu. | Mikro alan tahmini: ölçüm mikro=true, test=yok. Satır 114 `depoNo = parseInt((s.match(/\d+/) ?? ['1'])[0])` — Mikro depo numarası depo ADINDAN regex ile çıkarılıyor; 'Merkez Depo'→'Ankara Depo' transferi Mikro'ya fromDepo=1,toDepo=1 gider. Satır 115 `(tr as unknown as { sku?: string }).sku` — Transf |
| `UrunlerTab.tsx` | 159 |  | 1 |  | ✅ saglam | para, ui | Muhasebe→Ürün/Hizmet sekmesi: hizmet kartı listesi (kod, birim fiyat, KDV oranı), ekle/düzenle/sil modalı ve CSV dışa aktarma. |  |
| `WarehousesTab.tsx` | 171 |  | 1 | 7 | ⚠️ supheli | para, ui | Muhasebe→Depolar sekmesi: depo tanımları (ad/konum/sorumlu) CRUD ve depo detay modalında kalem listesi, toplam adet ve toplam değer. | Sahte kesinlik: ölçüm sifir=7, para=3. Satır 78 `Number((wi as unknown as { costPrice?: number }).costPrice) || 0` — WarehouseItem tipinde costPrice yok (cast gerekmiş); alan gelmediğinde 'Toplam Değer' stoklu depo için ₺0 basılır, 'değer bilinmiyor' denmez. |
| `YevmiyeTab.tsx` | 294 |  | 1 | 3 | ✅ saglam | para, belge | Muhasebe→Yevmiye sekmesi: yevmiye fişi listesi, borç/alacak/KDV alanlı fiş ekle/düzenle/sil modalı, hesap planı seçimi, kur etiketi (kur yoksa 'Kur bekleniyor') ve CSV dışa aktarma. |  |
| `shared.ts` | 5 |  | 21 |  | ⚠️ supheli | altyapi | Muhasebe sekme dosyalarının ortak yardımcılarını (SortHeader, formatTRY, formatCurrency, exportCSV, HESAP_PLANI, AT, AccountingT) AccountingModule'den yeniden dışa aktaran 5 satırlık barrel. | Döngüsel import: satır 3 `export ... from '../AccountingModule'` — AccountingModule 9 sekmeyi import ediyor, sekmeler shared'ı, shared tekrar AccountingModule'ü. Gerçek tek-kaynak bu dosya değil AccountingModule; bir sekme HESAP_PLANI/AT'yi modül kapsamında (render dışı) kullanırsa TDZ hatası ('Cann |

### `src/components/erp/` — 5 dosya, 713 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `DynamicsSyncPanel.tsx` | 70 |  | 1 |  | ✅ saglam | altyapi | Microsoft Dynamics 365 BC entegrasyon paneli: ortak ErpSyncPanel gövdesine Dynamics'e özgü yapılandırmayı (env değişkenleri, log koleksiyonu, sipariş/fatura export uçları) geçirir. |  |
| `ErpSyncPanel.tsx` | 419 |  | 3 |  | ✅ saglam | altyapi, ui | SAP/Logo/Dynamics panellerinin ortak gövdesi: config nesnesine göre ERP durumu, stok/cari import ve sipariş/fatura export butonlarını ve sync log listesini çizer. |  |
| `LogoSyncPanel.tsx` | 42 |  | 1 |  | 👻 hayalet | altyapi, ui | Logo Tiger/Go/Start için ErpSyncPanel'e verilen config (endpoint öneki, env değişkenleri, export tanımı). | ERPHubPanel'de lazy import ediliyor ama sunucu tarafı yok: src/server/routes/erpRoutes.ts:229-266 /api/logo/status 'Logo adapter not yet implemented' döner, import/export rotaları stub. Kullanıcı butona basınca hiçbir veri akmaz. |
| `ParasutSyncPanel.tsx` | 114 |  | 1 |  | ✅ saglam | altyapi, para | Paraşüt entegrasyon paneli: bağlantı durumu, cari ve stok (fiyat dahil) import butonları ve sonuç sayaçları. |  |
| `SAPSyncPanel.tsx` | 68 |  | 1 |  | 👻 hayalet | altyapi, ui | SAP Business One (Service Layer) için ErpSyncPanel config'i; DocEntry+DocNum referansını gösterir. | ERPHubPanel'den import ediliyor; erpRoutes.ts:268 /api/sap/status GERÇEK ama satır 294-318 import/stok, import/cari, export/siparis, export/fatura rotaları stub (kaynak yorumu: 'status GERCEK, digerleri stub (5 rota)'). Panel canlı görünür, aksiyonlar sonuç üretmez. |

### `src/components/reports/` — 8 dosya, 8,585 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `CrmRapor.tsx` | 110 |  | 1 |  | ✅ saglam | para, ui | Raporlar > CRM & Satış sekmesi dispatcher'ı: ctx'i crm/ alt bileşenlerine (özet, churn, kâr, iskonto, pipeline, CrmBloklar1-10) dağıtır. |  |
| `EnvanterRapor.tsx` | 3,685 |  | 1 | 150 | ⚠️ supheli | para, pdf, ui | Raporlar > Envanter sekmesi: stok değeri, kategori/tier analizi, COGS ve stok yaşlandırma grafiklerini ve PDF dışa aktarımı üretir (3685 satır, tek dosya). | Sahte kesinlik: sifir=150, örn. satır 133 'a.stockLevel * (a.prices?.[Retail] || 0)', 175 '((li.costPrice ?? 0) || 0) * li.quantity', 450 'o.totalPrice || 0' — fiyatı/maliyeti bilinmeyen kalem stok değerini ve COGS'u sessizce 0'a çeker. Yarım düzeltme kaynağı: ceviri=183 inline currentLanguage koşul |
| `GenelRapor.tsx` | 108 |  | 1 |  | ✅ saglam | ui | Raporlar > Genel Bakış sekmesi dispatcher'ı: ctx'i genel/ alt bileşenlerine (GenelOzet, GenelBloklar1-6) props olarak dağıtır. |  |
| `IKRapor.tsx` | 1,716 |  | 1 | 63 | ⚠️ supheli | para, ui | Raporlar > İnsan Kaynakları sekmesi: bordro/ciro oranı, departman maaş dağılımı, çalışan başına gelir gibi 38 İK bloğunu çizer. | Sahte kesinlik: sifir=63 + paraMatematigi=13, örn. satır 109 'e.salary || 0' ile toplam bordro, 168 ortalama maaş, 241 departman maaşı — maaşı girilmemiş çalışan 0 TL sayılıp ortalamayı ve bordro/ciro oranını düşürür. ceviri=114 inline dil koşulu. |
| `LojistikRapor.tsx` | 2,228 |  | 1 | 44 | ⚠️ supheli | para, ui | Raporlar > Lojistik sekmesi: kargo firması/bölge gelir dağılımı, sevkiyat maliyeti, iptal kaybı ve gün-bazlı teslimat analizlerini çizer. | Sahte kesinlik: sifir=44 + paraMatematigi=20, örn. satır 471 '((m.shippingCost as number) || 0) + ((m.deliveryCost as number) || 0)' — kargo maliyeti hiç girilmemiş sevkiyat 0 maliyetli görünüp kârlılığı şişirir; 142/422/464/1039 'o.totalPrice || 0'. ceviri=109, tarih=6 elle parse. |
| `ReportKit.tsx` | 221 |  | 6 |  | ✅ saglam | ui | Rapor ekranlarının ortak yapı taşları (bölüm kartı, KPI kartı) — tek stil kaynağı. |  |
| `UrunlerRapor.tsx` | 190 |  | 1 | 2 | ⚠️ supheli | para, ui | Raporlar > Ürün Performansı sekmesi: sipariş satırlarından ürün bazlı satış adedi/gelir tablosunu üretir. | Satır 63 'Number(liR.unitPrice ?? liR.price ?? liR.variant_price ?? 0) || 0' — üç farklı alan adı tahmin edilip hiçbiri yoksa birim fiyat 0 kabul ediliyor; bu satırlar ürün gelirini sessizce düşürür. ceviri=15, para=3 elle format. |
| `useReportsData.ts` | 327 |  | 32 | 12 | ⚠️ supheli | para, pdf, ui, altyapi | Raporlar modülünün paylaşılan hesaplama katmanı: sipariş/stok/personel/bordro verisinden KPI, trend, kategori memo'larını üretir ve ReportsCtx tipini sağlar; PDF dışa aktarma da burada. | 32 dosya import ediyor (hub). `Number(o.totalPrice) || 0` satır 162/195/223 KPI'larda ve satır 270 PDF'te: totalPrice eksik/NaN olan sipariş ciroya 0 girer, PDF'e '0,00 TL' basılır (belgede sahte kesinlik). Bordro `p.netSalary || 0` (138/142) aynı sınıf. Ölçüm: sifir=12, paraMatematigi=9, test yok.  |

### `src/components/reports/crm/` — 18 dosya, 4,410 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `CrmBloklar1.tsx` | 130 |  | 1 | 1 | ✅ saglam | ui | CRM raporunda müşterinin ilk sipariş tarihinden bu ay kazanılan yeni müşteri sayısını ve listesini gösterir. |  |
| `CrmBloklar10.tsx` | 604 |  | 1 | 34 | ⚠️ supheli | para, ui | CRM raporunda bu ay yeni/geri dönen müşteri oranı, aylık sipariş-teklif hacmi ve pipeline değeri dahil 16 blok çizer. | Sahte kesinlik: sifir=34 — grubun en yükseği. Satır 200 `(qR.totalAmount ?? qR.total ?? 0)` — `totalAmount` Quotation'da opsiyonel (types.ts:82), `total` tipte yok; tutarı girilmemiş teklif pipeline değerine 0 TL olarak katılır, toplam eksik gösterilir. |
| `CrmBloklar2.tsx` | 225 |  | 1 | 7 | ⚠️ supheli | para, ui | CRM raporunda sipariş satırlarını envanter perakende fiyatıyla karşılaştırıp müşteri bazlı iskonto oranı ve 3 komşu blok daha çizer. | Sahte kesinlik: satır 33 `(inv?.prices?.['Retail'] ?? inv?.price ?? li.price) * li.quantity` — envanterde eşleşme yoksa liste fiyatı = satılan fiyat alınır, satır 35 `totalList || o.totalPrice || 0` ile iskonto kesin %0 gösterilir; liste fiyatı BİLİNMİYOR demesi gerekirdi. kopya.ceviri=22 (yarım düz |
| `CrmBloklar3.tsx` | 85 |  | 1 | 1 | ✅ saglam | ui | CRM raporunda müşterileri son sipariş günü / sıklık / ciro üzerinden RFM skoruyla segmentler. |  |
| `CrmBloklar4.tsx` | 343 |  | 1 | 7 | ⚠️ supheli | para, ui | CRM raporunda satış temsilcisi bazlı aylık ciro/sipariş performansı ve 5 komşu blok daha çizer. | kopya.ceviri=22, paraMatematigi=6, sifir=7. Satır 26 `o.assignedTo || (o as Record).salesRep` — `salesRep` Order tipinde YOK (types.ts:104-140), ölü alan tahmini; temsilci atanmamış siparişler sessizce raporun dışında kalır (satır 27 `continue`), toplam ciroyla uyuşmaz. |
| `CrmBloklar5.tsx` | 83 |  | 1 |  | ⚠️ supheli | ui | CRM raporunda teklifin siparişe dönüşme süresini (gün) histogram olarak gösterir. | Sahte kesinlik: satır 28-30 `m.convertedAt ? ... : new Date()` — `convertedAt` Quotation tipinde HİÇ YOK (types.ts:76-100 grep boş), yani her dönüşmüş teklif için dönüşüm tarihi = ŞİMDİ alınır; 3 ay önce dönüşmüş teklif '90 gün sürdü' diye gösterilir, ölçülen şey dönüşüm süresi değil teklifin yaşıdı |
| `CrmBloklar6.tsx` | 405 |  | 1 | 11 | ⚠️ supheli | para, ui | CRM raporunda önceki 3 ay / son 3 ay ciro karşılaştırmasıyla müşteri kaybı (churn) ve 6 komşu analiz bloğu çizer. | kopya.ceviri=35 — grubun en yüksek inline `currentLanguage==='tr'?` sayısı (yarım düzeltme kaynağı); sifir=11, `(o.totalPrice || 0)` ile bilinmeyen ciro 0 sayılıp churn listesine 'kayıp müşteri' olarak düşebilir. |
| `CrmBloklar7.tsx` | 588 |  | 1 | 5 | ✅ saglam | para, ui | CRM raporunda bu ayın müşteri ciro sıralaması ve kur (itemCostTRY/exchangeRates) üzerinden müşteri kârlılığı dahil 13 blok çizer. |  |
| `CrmBloklar8.tsx` | 616 |  | 1 | 16 | ⚠️ supheli | para, ui | CRM raporunda müşteri ciro dilimleri (₺0-10k…₺200k+), temsilci-ay ısı haritası ve LTV dahil 15 blok çizer. | Yarım düzeltme kaynağı: kopya.para=1 — grupta ELLE para biçimleyen TEK dosya; satır 149 `₺${v.toLocaleString('tr-TR',...)}` ve satır 22-25 sabit '₺0–10k' dilim etiketleri, diğer 10 dosyanın kullandığı `fmtAna`/para birimi seçicisini atlar (USD seçilse de ₺ yazar). sifir=16, tarih=3 (elle toDate pars |
| `CrmBloklar9.tsx` | 580 |  | 1 | 23 | ⚠️ supheli | para, ui | CRM raporunda müşteri tipi/kaynak bazlı ciro dağılımı, harcama kademeleri ve aylık teklif→sipariş dönüşüm oranı dahil 15 blok çizer. | Sahte kesinlik: sifir=23 (grupta 2.). Satır 127 `(lr.quantity ?? 0) * (lr.unitPrice ?? lr.price ?? 0)` — totalPrice olmayan siparişte satır fiyatı bilinmiyorsa müşteri harcaması 0 yazılıp '₺0 kademesi'ne düşer. Satır 23 `customerSegment || segment || customerType` — ilk ikisi Order tipinde yok, yaln |
| `CrmOzetBolumu.tsx` | 191 |  | 1 | 3 | ✅ saglam | para, ui | CRM raporunun üst özet bölümü: müşteri bazlı KPI kartları (aktif/yeni/tekrar eden müşteri), durum pastası, en iyi müşteriler ve ciro trendi; para birimi seçicisiyle formatInCurrency kullanır. |  |
| `IlkYenidenSiparisSuresi.tsx` | 80 |  | 1 |  | ✅ saglam | ui | CRM raporunda müşterilerin ilk ve ikinci siparişi arasındaki gün farkından ortalama/medyan yeniden-sipariş süresi kartını çizer. |  |
| `IskontoSizintiAnalizi.tsx` | 77 |  | 1 | 1 | ✅ saglam | para, ui | CRM raporunda sipariş tutarı ile kalemlerin Retail liste fiyatı toplamı arasındaki farkı müşteri bazında iskonto sızıntısı olarak gösterir. |  |
| `MusteriChurnAnalizi.tsx` | 77 |  | 1 | 4 | ✅ saglam | para, ui | CRM raporunda geçen ay sipariş verip bu ay vermeyen müşterileri (churn) ve kaybedilen ciroyu listeler. |  |
| `MusteriKademeTrendi.tsx` | 80 |  | 1 | 4 | ✅ saglam | para, ui | CRM raporunda müşterileri LTV'ye göre Platinum/Gold/Silver kademeye ayırıp kademe bazlı aylık ciro trendini gösterir. |  |
| `MusteriKarAnalizi.tsx` | 75 |  | 1 | 6 | ⚠️ supheli | para, mikro, ui | CRM raporunda Mikro stok hareketlerinden (sth_tip=0 alış) SKU bazlı ağırlıklı ortalama alış fiyatı türetip müşteri başına ciro/maliyet/kâr marjı gösterir. | Mikro kolon tahmini + test=false: satır 22-26 inventoryMovements kayıtlarından sth_stok_kod/sth_tip/sth_iptal/sth_miktar/sth_tutar okuyor (ölçüm mikro=false demiş ama kod Mikro STOK_HAREKETLERI kolonlarına bağımlı, hafızada inventoryMovements 'productId' alanlı Cetpa-native koleksiyon). Senaryo: kol |
| `PipelineAsamaHizi.tsx` | 91 |  | 1 | 1 | ✅ saglam | ui | CRM raporunda tekliflerin taslak/gönderildi/müzakere/beklemede aşamalarında ortalama kaç gün beklediğini gösterir. |  |
| `TeklifSiparisDonusumu.tsx` | 80 |  | 1 | 2 | ✅ saglam | para, ui | CRM raporunda teklif→sipariş dönüşüm oranını, son 6 ayın aylık dönüşümünü ve dönüşen teklif tutarını gösterir. |  |

### `src/components/reports/genel/` — 7 dosya, 3,815 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `GenelBloklar1.tsx` | 558 |  | 1 | 12 | ⚠️ supheli | para, ui | Genel raporun 1. blok grubu: aylık brüt marj trendi (brutMarj ortak yardımcısıyla) ve devamındaki ciro/stok kartlarını çizer. | Yarım düzeltme kaynağı: 42 inline currentLanguage==='tr' çevirisi + 12 '|| 0/?? 0' + 10 para-matematiği eşleşmesi tek dosyada; aynı iş GenelBloklar2/3/4'te de elle tekrarlanıyor. Bir etiket/formül düzeltmesi 4 dosyaya ayrı ayrı uygulanmazsa ekranlar birbirinden farklı sonuç gösterir (marj hesabı 202 |
| `GenelBloklar2.tsx` | 559 |  | 1 | 18 | ⚠️ supheli | para, ui | Genel raporun 2. blok grubu: müşteri yoğunlaşması (HHI), müşteri başına ciro ve çalışan/ürün dağılım kartlarını çizer. | Yarım düzeltme kaynağı: gruptaki en yüksek kopya sayısı — 59 inline currentLanguage==='tr' çevirisi, 18 '|| 0/?? 0', 14 para-matematiği eşleşmesi. Senaryo: totalPrice alanı olmayan (Mikro türevi/sentetik) sipariş '|| 0' ile 0 ciro sayılır → HHI ve müşteri payı yanlış dağıtılır; aynı kalıp 4 dosyada  |
| `GenelBloklar3.tsx` | 588 |  | 1 | 16 | ⚠️ supheli | para, ui | Genel raporun 3. blok grubu: sipariş desil dağılımı, dönem karşılaştırması (ciro/AOV), günlük sipariş ısı haritası ve mevsimsellik kartlarını çizer. | Sahte kesinlik: 29 para-matematiği eşleşmesi + 16 sıfır-fallback. Satır 241 `(inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice || 0)) * li.quantity` — envanterde bulunmayan kalemin maliyeti 0 sayılır → o siparişin marjı %100 görünür (GenelBloklar1'de 2026-09-04'te brutMarj ile düzeltilen arızan |
| `GenelBloklar4.tsx` | 594 |  | 1 | 19 | ⚠️ supheli | para, ui | Genel raporun 4. blok grubu: bu ayın P&L özeti (ciro/COGS/maaş/EBITDA), 7 günlük hareketli ciro, şehir/ödeme yöntemi kırılımı, aylık brüt marj ve haftalık ciro ızgarasını çizer. | Sahte kesinlik (gruptaki en yüksek: 19 sıfır-fallback, 16 para-matematiği, 2 elle toLocaleString, 3 elle toDate parse). Satır 317 `monthGM[key].cost += lineCost || (o.totalPrice || 0) * 0.6` — kalem maliyeti yoksa maliyet uydurma %60 varsayımıyla yazılır, kullanıcıya gerçek marjmış gibi gösterilir.  |
| `GenelBloklar5.tsx` | 592 |  | 1 | 31 | ⚠️ supheli | para, ui | Genel rapor sekmesinin 5. dilimi: son 90 gün siparişlerinden ciro tahmini, günlük/yıllık ciro dağılımı ve müşteri bazlı özet kartları çizer. | Aynı dosyada iki ciro tabanı: tahmin bloğu `o.totalPrice || 0` (satır 31-33, 81) kullanırken diğer bloklar `oR.total ?? lineItems(quantity??0 * unitPrice??price??0)` (satır 110-116, 159-164) hesaplıyor — totalPrice ile total farklıysa aynı sekmede aynı siparişin cirosu iki ayrı rakam gösterir. Ölçüm |
| `GenelBloklar6.tsx` | 539 |  | 1 | 31 | ⚠️ supheli | para, ui | Genel rapor sekmesinin 6. dilimi: en iyi müşteri / en iyi gün / en büyük sipariş gibi özet kartları ve personel-teklif bazlı karşılaştırma bloklarını çizer. | Ciro `oR.total` yoksa `lineItems.reduce(quantity??0 * (unitPrice??price??0))` ile üretiliyor (satır 28-30): unitPrice ve price ikisi de yoksa satır 0 TL sayılır, 'en büyük sipariş / en iyi gün' yanlış müşteriye gider. Ölçüm: oR.total=9, totalPrice=0 (GenelBloklar5 ile farklı taban), toDate elle pars |
| `GenelOzet.tsx` | 385 |  | 1 | 7 | ⚠️ supheli | para, ui | Genel rapor sekmesinin üst özeti: ciro/sipariş/ortalama sepet/düşük stok KPI kartları, trend alan grafiği, kategori pastası ve brüt marj kartını çizer. | Ölçüm: ceviri=29 — inline `currentLanguage==='tr'?` 29 kez elle yazılmış; bir etiket düzeltmesi 29 yerde ayrı ayrı yapılmalı (yarım düzeltme kaynağı). paraMatematigi=11 ile sifir=7 birlikte. Paylaşılan siparisTarih/brutMarj/KpiCard kullanıyor (o kısım sağlam). |

### `src/hooks/` — 11 dosya, 1,188 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `useKonumYayini.ts` | 95 |  | 2 |  | ✅ saglam | tenant, altyapi | Uygulama açıkken sürücünün araç konumunu 25 sn aralıkla `vehiclePositions` koleksiyonuna yazar (localStorage'daki araç kimliğine göre). |  |
| `useMikroFaturalar.ts` | 86 |  | 15 | 10 | ⚠️ supheli | para, mikro | `mikroFaturalar` koleksiyonunu dinleyip ham cha_* alanlarını tek yerde normalize edilmiş MikroFatura (tutar/kdv/matrah/oran/yön) listesine çevirir; cari kod→ad haritası da sağlar. | Satır 37-38 `kdv: Number(x.kdvTutari ?? 0) || 0`, `matrah: Number(x.matrah ?? 0) || 0`: sunucu zaten ISNULL(...,0) ile sıfırlıyor (mikroRoutes.ts:1441), istemci ikinci kez sıfırlıyor — kdvTutari kolonu eklenmeden önce import edilmiş kayıtlarda fatura KDV'siz görünür, `oran` null-aware iken kdv değil |
| `useMikroPersonel.ts` | 45 |  | 1 |  | ⚠️ supheli | mikro, ui | `/api/mikro/pull/personel` uç noktasından Mikro personel listesini çekip HRModule'a verir (yükleniyor durumu + yeniden çekme). | catch bloğu hatayı yalnız console.error'a yazıyor, hata state'i dönmüyor (satır 32-33, dönüş `{data, loading, refetch}`); HRModule:187 `mikroPersoneller.length === 0` ile 'Mikro'da personel yok' ve 'çekim başarısız' aynı ekranı gösterir — Mikro kapalıyken kullanıcı boş liste görür. mikro=true, test  |
| `useMikroSiparisler.ts` | 50 |  | 3 | 2 | ⚠️ supheli | para, mikro | `mikroSiparisler` aynasından son 2000 siparişi tarih sırasıyla dinleyip tarih/evrakNo/cariKod/tutar/tip alanlarına eşler (Dashboard ve Sipariş sayfası kullanır). | Satır 36 `tip: Number(d.sip_tip || 0)`: mikroMirror sip_tip'i `strOrNull` ile null yazabiliyor (mikroMirror.ts:392) → null tip 0='Alınan (Satış)' sayılır, alış siparişi satış listesine düşer. Satır 35 `Number(d.sip_tutar || 0)` aynı sınıf. Kolon adları mikroMirror şemasında tanımlı (112-114), tahmin |
| `useMikroTahsilat.ts` | 153 |  | 1 | 4 | ⚠️ supheli | para, mikro | `mikroCariHareketler`den FIFO mahsuplaşmayla tüm cariler için açık alacak listesi ve gecikme gününü türetir (Tahsilat ekranı KPI/yaşlandırma). | Satır 143 `gecikmeGun: gunFarki(bugun, b.h.vade) ?? 0`: gunFarki vade parse edilemeyince null döner (zaman.ts:141-143), burada 0'a çevriliyor → bozuk vadeli açık alacak 'vadesi bugün' görünür, yaşlandırma kovası ve gecikme sıralaması (satır 147) yanlış. Satır 85 `Number(x.cha_meblag ?? 0) || 0`. Tek |
| `useMikroTedarikciler.ts` | 99 |  | 1 |  | ✅ saglam | mikro | Normalize MikroFatura ve leads listesinden, elle girilmemiş tedarikçileri (alış faturası olan cariler) Supplier nesnesi olarak türetir ve mevcut kayıtlarla dedup eder. |  |
| `useMikroUretimReceteleri.ts` | 61 |  | 1 |  | ⚠️ supheli | mikro | Mikro ERP'deki üretim reçetelerini (BOM) POST /api/mikro/pull/uretim-receteleri ucundan çekip BOMPanel'e liste olarak verir. | mikro=true + test=false. Arayüz `rec_kod/rec_isim/rec_ana_stok_kod/rec_cinsi/rec_create_date` alanlarını sabit yazıyor (satır 4-11) ama sunucu tarafı (mikroRoutes.ts:3225-3248) kolonları şemadan `kolonSec` ile çözüp `bom` koleksiyonuna yazıyor; hook'un beklediği sabit alan adları şema keşfiyle doğru |
| `useModalErisilebilirlik.ts` | 89 |  | 3 |  | ✅ saglam | ui | Modal diyaloglara ESC ile kapatma, fokus tuzağı ve kapanışta fokus iadesi ekleyen erişilebilirlik hook'u. |  |
| `useRouteSync.ts` | 80 |  | 1 |  | ✅ saglam | ui | App.tsx'teki activeTab state'i ile tarayıcı URL'sini çift yönlü eşitleyerek geri/ileri ve derin bağlantıyı çalıştırır. |  |
| `useSekmeVerileri.ts` | 350 | ✓ | 3 | 3 | ⚠️ supheli | para, altyapi | Yalnız ilgili sekme açıkken 18 koleksiyona onSnapshot abonesi olup (bankAccounts, sabitKiymetler, payrollRuns vb.) state'i App'e döndürür. | Sahte kesinlik: bilanço sekmesinde `balance: Number(d.data().balance) || 0` (satır 134), `cost: ... || 0` (141), `depreciation: ... || 0` (142) — banka bakiyesi/sabit kıymet maliyeti kayıtta yoksa bilançoya 0 olarak girer, MuhasebePage p547BankAccounts bunu kesin sayı diye tüketir. sifir=3, paraMate |
| `useWorldGeo.ts` | 80 |  | 1 |  | ✅ saglam | ui | Satış Bölgesi ekranı için ülke listesini Intl.DisplayNames ile adlandırır ve seçilen ülkenin şehirlerini public/geo altından lazy-fetch eder. |  |

### `src/lib/` — 19 dosya, 2,306 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `collections.ts` | 172 | ✓ | 3 |  | ✅ saglam | tenant, guvenlik | TENANT / USER_SCOPED / SERVER_ONLY / DELIBERATELY_UNSCOPED koleksiyon sınıflandırmasının tek kaynağı; server.ts ve backfill scripti buradan okur. |  |
| `confirm.ts` | 96 |  | 32 |  | ✅ saglam | ui | Herhangi bir modülden `await confirmAction/confirmDelete` ile GlobalConfirm host'u üzerinden dil duyarlı onay diyaloğu açar; host yoksa güvenli taraf olarak false döner. |  |
| `dbClient.ts` | 712 | ✓ | 95 | 2 | ✅ saglam | altyapi, tenant | Firestore istemci API yüzeyini (collection/onSnapshot/addDoc/query...) Express+PostgreSQL ve tek SSE akışı üzerinden taklit eden shim; 95 dosyanın veri erişim katmanı. |  |
| `errorSink.ts` | 50 | ✓ | 2 |  | ✅ saglam | altyapi | dbClient'ın sessizce yuttuğu hataları döngüsel import olmadan errorLogger'a (clientErrors → Bekçi) ileten nötr ara katman. |  |
| `huni.ts` | 66 | ✓ | 1 |  | ✅ saglam | ui | CRM satış hunisi aşamasını adayın yaşından (30/60/90 gün eşikleri) türetir, elle atanmış status her zaman kazanır. |  |
| `invite.ts` | 83 |  | 1 |  | ✅ saglam | guvenlik, tenant | URL'deki ?invite= token'ını sessionStorage'a alıp adres çubuğundan siler; giriş sonrası App.tsx bunu redeem ederek davetteki rol ve companyId'yi uygular. |  |
| `lazyCollections.ts` | 57 |  | 1 |  | ✅ saglam | ui, altyapi | Hangi DB koleksiyonunun açılışta değil, ilgili üst sekme (proje/production/muhasebe/inventory) ilk açıldığında dinlenmeye başlayacağını belirleyen yapışkan kapı haritası ve koleksiyonAktif/resetLazyCollections fonksiyonları. |  |
| `locationQr.ts` | 39 |  | 2 |  | ✅ saglam | altyapi | Depo/araç QR etiketinin CETPA-LOC:<type>:<id> biçimini üretir ve TransferScanPanel'de okunan değeri lokasyona çözer (ürün barkoduyla karışmasın diye önekli). |  |
| `mfa.ts` | 64 |  | 2 |  | ⚠️ supheli | guvenlik | Kendi Express+PG altyapısı üzerinden TOTP 2FA istemci sarmalayıcısı: durum sorgusu, kayıt başlat/bitir, giriş doğrula, kapat (App.tsx giriş akışı + MfaSettings). | getMfaStatus fail-open: satır 28-35 yorumu 'Kalıcı hatada enabled:false döner' — /api/mfa/status iki denemede de 500/ağ hatası verirse MFA'sı AÇIK kullanıcı challenge görmeden geçer; istemci gate'i (mfaChallenge) bu durumda kapalı kalır. Sunucu /api/db'de __cetpa_mfa çerezini bağımsız zorluyorsa zar |
| `mikroKolon.ts` | 44 | ✓ | 1 |  | ✅ saglam | mikro, para | Mikro satır/kolon listesinde desene uyan kolonu seçen saf fonksiyonlar (findKey, kolonSec); _Guid kolonlarını varsayılan dışlayarak 'tüm fiyatlar sıfırlandı' vakasını yapısal olarak engeller. | Ölçüm düzeltmesi: mikro=false ve importEden=1 ölçülmüş ama dosya projenin Mikro kolon eşleme çekirdeği ve server.ts + src/server/routes/mikroRoutes.ts (findKey satır 1128/1348/1531) tarafından import ediliyor; testi var (mikroKolon.test). |
| `muhasebeMenu.tsx` | 121 |  | 4 |  | ✅ saglam | ui | Muhasebe & Finans dikey sidebar alt menüsü ile MuhasebeMenuBar yatay sekme barının ortak render edildiği tek-kaynak menü dizisi (MUHASEBE_MENU) ve hedef türü (accounting/muhasebe/app). | paraMatematigi=7 yalnız menü etiketlerinden (KDV/Tahsilat/Kasa) geliyor, hesap yok. Küçük hayalet export: MUHASEBE_ACCOUNTING_TABS (satır 118, 'bar aktif-highlight için') hiçbir dosyada kullanılmıyor; AccountingModule yalnız tipleri import ediyor — Faz 4 adayı, dosya değil export. |
| `pricingEngine.ts` | 117 | ✓ | 1 | 1 | ⚠️ supheli | para | Maliyet + hedef marj + rakip fiyatlardan satış fiyatı önerisi ve maksimum toptan alış fiyatı üreten saf fiyatlandırma motoru (PriceIntelPanel kullanır). | Sahte kesinlik: satır 73 `const c = Math.max(0, Number(cost) || 0);` — maliyet boş/NaN girildiğinde 0 kabul edilir, sellFromMargin(0, m)=0 ve maxBuyPrice hesapları 0,00 TL olarak 'geçerli' öneri gibi döner; 'maliyet bilinmiyor' yerine sıfır fiyat üretir. Testi var ama bu dalı kilitleyip kilitlemediğ |
| `publicPaths.ts` | 56 | ✓ | 5 |  | ✅ saglam | ui | Kimlik gerektirmeyen tanıtım/yasal sayfaların (developers/blog/careers/privacy/terms) yol dizelerinin tek kaynağı; App.tsx sayfa haritası bu tipten türediği için yol eklenip sayfa bağlanmazsa derleme kırılır. |  |
| `rbac.ts` | 397 | ✓ | 4 |  | ✅ saglam | guvenlik, tenant | Sunucu tarafı rol bazlı erişim politikası: rol listeleri, admin-only/append-only/public-write koleksiyon kümeleri, isAllowed/isSelfDocAccess/blocksRoleEscalation saf fonksiyonları (server.ts, epostaRoutes, dbClient, App.tsx kullanır). |  |
| `storageBucket.ts` | 52 | ✓ | 1 |  | ✅ saglam | altyapi | Firebase Storage bucket adını (.firebasestorage.app / .appspot.com / env) çalışma anında sırayla sınayıp var olanı çözer; off-site yedeğin 'bucket does not exist' ile sessizce ölmesini engeller. | ÖLÜ DEĞİL — ölçüm importEden=0 dedi çünkü tarama src/ ile sınırlı; gerçek tüketici scripts/backup-db-offsite.mjs:114-115 (bucketAdaylari + bucketCoz). Faz 4'te SİLME. |
| `tenantBackup.ts` | 89 | ✓ | 1 |  | ✅ saglam | tenant, altyapi | Kiracı-bazlı yedek planının saf karar mantığı: rclone remote geçerliliği, saklama günü, güvenli dosya adı, atlama sebebi ve kiracı export SQL sorguları (I/O yok). | ÖLÜ DEĞİL — ölçüm importEden=0 dedi çünkü tarama src/ ile sınırlı; gerçek tüketici scripts/backup-tenants.mjs:33/82/117 (yedekPlani, KIRACI_SORGUSU, ETIKETSIZ_SAYIM_SORGUSU). Faz 4'te SİLME. |
| `topLevelTabs.ts` | 36 | ✓ | 4 |  | ✅ saglam | ui | Üst düzey activeTab id'leri ile URL yol segmentlerinin 1-1 eşlemesinin tek kaynağı (TOP_LEVEL_TABS); hem useRouteSync/App.tsx hem sunucu trafik sayacı (trafikRoutes) bu kümeyi kullanır. |  |
| `trafik.ts` | 48 |  | 1 |  | ✅ saglam | altyapi | Her yol değişiminde kimliksiz/çerezsiz sayfa görüntüleme ping'ini POST /api/hit'e sendBeacon ile gönderir. |  |
| `utils.ts` | 7 |  | 28 |  | ✅ saglam | ui | Tailwind sınıflarını birleştiren cn() yardımcısını (clsx + twMerge) sağlar. |  |

### `src/pages/` — 17 dosya, 20,873 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `AdminPage.tsx` | 1,099 |  | 1 | 6 | ✅ saglam | guvenlik, tenant, ui | Yönetim paneli: kullanıcı/rol yönetimi, erişim matrisi, denetim logu, sistem sağlığı, şirket ayarları, evrak tasarımcısı ve süper-admin kiracı sekmeleri. |  |
| `CRMPage.tsx` | 3,874 |  | 1 | 63 | ⚠️ supheli | para, mikro, tenant, ui | CRM modülü: müşteri adayları, huni/kanban, kampanyalar, sözleşmeler, destek talepleri, iade, fiyat istisnaları, Mikro cari eşleme ve ziyaret evrakı gönderimi. | sahte kesinlik: sifir=63, paraMatematigi=20 — örn. satır 1487/1492/2219/2435 `o.totalPrice || 0` ile ciro ve temsilci hedef toplamları hesaplanıyor; totalPrice alanı olmayan (Mikro'dan çekilmiş) sipariş 0 ₺ sayılıp ciroyu sessizce düşürür. Ayrıca mikro=true (pushMikroEvrak/pullCariFromMikro) + test= |
| `DashboardPage.tsx` | 2,397 |  | 1 | 51 | ⚠️ supheli | para, mikro, ui | Ana gösterge paneli: Mikro fatura/sipariş + native sipariş verisinden ciro, tahsilat, stok ve sevkiyat KPI'larını tarih aralığı ve para birimi seçimiyle gösterir. | sahte kesinlik: satır 169/434/498 `f.tutar || 0` — Mikro faturasında tutar gelmezse (kolon eksik/null) ciro 0 sayılır, panel 'düşük ciro' gösterir; satır 175 `o.totalPrice || o.totalAmount || 0` iki alan adı tahmini. sifir=51, paraMatematigi=39, mikro=true, test=yok. tarih=17 elle tarih parse kopyas |
| `HukukPage.tsx` | 79 |  | 1 |  | ✅ saglam | belge, ui | Hukuk & Uyum sekmesi: p597Contracts üzerinden sözleşme yenileme/süre dolum uyarıları ve LegalModule (sözleşme, dava, KVKK) sarmalayıcısı. |  |
| `IKPage.tsx` | 980 |  | 1 | 9 | ⚠️ supheli | mikro, para, ui | İK modülü: izin talepleri (onayda Mikro PersonelIzinTalepKaydetV2 gönderimi), devam kayıtları, bordro hesaplama/özet ve HRModule sarmalayıcısı. | Mikro kolon/kod tahmini: satır 382 `mikroPersKod ?? lr.employeeName` — personelin Mikro kodu yoksa ADI 15 karaktere kırpılıp pers_kod olarak Mikro'ya gönderiliyor; Mikro tarafında eşleşmeyen kod sessizce reddedilir/yanlış personele yazılır, catch(()=>{}) hatayı yutar. test=yok. sahte kesinlik: satır |
| `InventoryPage.tsx` | 1,254 |  | 1 | 48 | ⚠️ supheli | para, ui | Envanter sekmesinin ana sayfası: stok KPI/değerleme grafikleri, parti-lot (stockBatches), sayım oturumları (stockCountSessions), tedarikçi konsinye (supplierConsignments) ve garanti (warranties) CRUD'u ile lazy InventoryView listesini sarar. | Sahte kesinlik: kopya.sifir=48 ve stok değerleme KPI'ları fiyatı/stoku bilinmeyen ürünü 0 sayıyor — satır 151 `(i.prices?.['Retail'] ?? i.price ?? 0) * (i.stockLevel ?? 0)` (stockVal), 152 costVal, 199/201/206 aynı desen; fiyatı girilmemiş ürün toplam stok değerinde sessizce 0 katkı verir, kullanıcı |
| `KalitePage.tsx` | 186 |  | 1 | 2 | ✅ saglam | ui | Kalite Yönetimi sekmesi: RBAC sarmalayıcı + kalite kontrol listesi (qualityChecklist) ve üretim hata/rework metrikleri (productionMetrics) CRUD'u, QualityModule'ü gösterir. |  |
| `KurumsalPage.tsx` | 40 |  | 1 |  | ✅ saglam | ui | Kurumsal Yönetim sekmesi için yalnız RBAC sarmalayıcı (UnauthorizedView/ReadOnlyBanner) olup içeriği CorporateGovernanceModule'e devreder. |  |
| `MesaiPage.tsx` | 140 |  | 1 | 1 | ⚠️ supheli | ui | Mesai & Devam Takibi sekmesi: personel giriş/çıkış kaydı formu ile timeAttendance koleksiyonuna kayıt ekler ve listeler. | Tek-kaynak ihlali (yarım düzeltme kaynağı): satır 15-16 `AttendanceRecord` tipi IKPage.tsx'teki tanımın kopyası, dosya yorumu bunu itiraf ediyor («IKPage.tsx'teki AttendanceRecord ile birebir aynı tanım»). IKPage'de status enum'una/alanına ekleme yapılırsa MesaiPage eski şekille yazmaya devam eder,  |
| `MuhasebePage.tsx` | 3,950 |  | 1 | 73 | ⚠️ supheli | para, mikro, belge, ui | Muhasebe ana sayfası (29 alt-sekme): KDV mutabakat, e-Fatura takip, Ba-Bs, finansal oranlar, nakit akışı, bütçe, tekrarlayan faturalama, akreditif, şirketler-arası işlem, fiyatlama kuralları ve banka/tahsilat/kasa modüllerini Mikro faturaları + cariBalances ile birleştirerek gösterir. | (1) Sahte kesinlik: paraMatematigi=156 ile kopya.sifir=73 — satır 308 `Number(bakiye ?? 0)` (Mikro cari bakiyesi yoksa AR/AP oranına 0 girer), 389-390 `kdvTutari || 0` / `kdvHaricTutar || o.totalPrice || 0`, 687/835/1134/1271/1280 `o.totalPrice || 0`, 1282 `po.totalAmount || 0`, 1393 `f.tutar || 0`; |
| `OrdersPage.tsx` | 3,619 |  | 1 | 30 | ⚠️ supheli | para, pdf, belge, ui, mikro, tenant | Sipariş yönetimi ana sayfası: sipariş liste/detay, sevkiyat ve araç takibi, iade, tekrarlayan sipariş, talep/servis kayıtları, PDF/CSV dışa aktarım ve Mikro fatura bilgisiyle sipariş görünümü. | Sahte kesinlik: satır 1199 `KDV%{order.kdvOran ?? 0}` — satır 1190 yorumuna göre faturasız dal kdvOran YAZMIYOR, o siparişler ekranda 'KDV%0' görünür; satır 538/1842/1848/1977/2052 `o.totalPrice || 0` tutarsız siparişi 0 ciro sayar (sifir=30, paraMatematigi=50). Yarım düzeltme kaynağı: para biçimi 2 |
| `ProjePage.tsx` | 204 |  | 1 | 3 | ✅ saglam | ui | Proje Yönetimi sekmesi: proje bütçe/harcama kartları (projectCosts) ve zaman çizelgesi (projectTimelines) için ekle/düzenle/sil formları. |  |
| `RaporlarPage.tsx` | 663 |  | 1 | 19 | ⚠️ supheli | para, pdf, ui, mikro | Raporlar sekmesi: satış/stok/müşteri KPI panoları, aylık hedef takibi, gelir trend tahmini, Mikro faturalarından cari raporu ve PDF/CSV dışa aktarım. | Sahte kesinlik: satır 158/174/308/368/458 `(o.totalPrice || 0)` — totalPrice olmayan sipariş toplam ciroya ve müşteri sıralamasına 0 olarak girer, rapor sessizce düşük çıkar; satır 465 `slope = (...) / (n*sumXX - sumX*sumX) || 0` — tek aylık veride payda 0, NaN yerine 0 eğim → 'trend düz' uydurma so |
| `SatinAlmaPage.tsx` | 1,275 |  | 1 | 18 | ⚠️ supheli | para, ui, mikro, tenant | Satın Alma sekmesi: satın alma siparişleri, tedarikçi kartları ve puan kartı, ödeme takvimi, satın alma bütçesi, tedarikçi riski ve fiyat karşılaştırma; Mikro tedarikçi/fatura hook'larını ve cari ekstreyi okur. | Sahte kesinlik: satır 288/648/675/819 `po.totalAmount || 0` — tutarı girilmemiş PO ödeme takviminde ve tedarikçi toplamında 0 sayılır; satır 206 `(li.costPrice ?? 0) * li.quantity` — maliyeti bilinmeyen kalem bütçe harcamasını 0 gösterir (bütçe 'aşılmadı' yanılgısı); satır 751 puan kartı ağırlığı `| |
| `SelfservisPage.tsx` | 123 |  | 1 | 5 | ⚠️ supheli | para, ui | Çalışan Self-Servis portalı: giriş yapan kullanıcının e-postasıyla eşleşen çalışan kartı, bordro geçmişi tablosu ve son 30 günlük mesai özeti. | Sahte kesinlik (küçük ama somut): satır 82-84 `(p.baseSalary||0)+(p.bonus||0)`, `(p.deductions||0)`, `(p.netSalary||0)` — netSalary yazılmamış bordro çalışana '₺0' net maaş olarak gösterilir; satır 100 `r.totalHours||0`. Para biçimi 3 kez elle tr-TR. |
| `SettingsPage.tsx` | 711 |  | 1 | 2 | ⚠️ supheli | ui, altyapi, guvenlik, tenant | Ayarlar sekmesi: abonelik planı ve ödeme geçmişi, ERP hub, entegrasyon sağlığı, SKU eşleme, pazaryeri bağlantıları, webhook yapılandırması ve genel tercihler (settings/webhookConfigs). | Yarım düzeltme kaynağı: inline `currentLanguage === 'tr' ?` 89 kez (711 satırda) — bir metin düzeltmesi tek yüzeyde kalır. Sıfır kullanımı zararsız: satır 169 yalnız dizi uzunluğu (`d.products?.length ?? 0`), para alanında değil. |
| `UretimPage.tsx` | 279 |  | 1 | 4 | ✅ saglam | ui | Üretim Yönetimi sekmesi: üretim emirleri (productionOrders), kapasite planlama hatları (capacityLines) ve BOM paneli için CRUD formları. |  |

### `src/server/` — 9 dosya, 2,927 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `adminDbTypes.ts` | 124 |  | 14 |  | ✅ saglam | altyapi | Ayrılmış sunucu modüllerinin adminDb'den kullandığı yüzeyi (collection/doc/get/set/where/add/batch) `any` yerine yapısal tiplerle tanımlar; 14 modül import ediyor. |  |
| `crons.ts` | 454 |  | 1 | 8 | ⚠️ supheli | mikro, para, altyapi, tenant | Üç zamanlanmış iş: saatlik Mikro stok+cari senkronu, 04:00 gece stok miktar senkronu ve pazartesi 08:00 haftalık özet e-postası (initCrons, server.ts:647'de çağrılıyor). | Mikro kolon tahmini + sahte kesinlik: satır 312 `Number(d.MaliyetBedeli ?? 0)` — Mikro yanıtında alan yoksa maliyet 0 yazılır; satır 236 `Number(c.cari_hareket_tipi ?? 0) === 1 ? 'Supplier' : 'Customer'` — alan gelmezse cari sessizce 'Customer' olur; satır 132 `Number(data.stockLevel) || 0`; satır 3 |
| `eposta.ts` | 150 |  | 5 |  | ✅ saglam | altyapi, guvenlik | Giden e-postanın tek kaynağı: Resend gönderici adresi/alan adı, Resend sağlık kontrolü (önbellekli), escapeHtml ve e-posta doğrulama; server.ts, crons ve opsWatchdog kullanıyor. |  |
| `geminiDayanikli.ts` | 57 |  | 2 |  | ✅ saglam | altyapi | Gemini çağrılarında geçici hatada (503/overloaded) artan beklemeyle 3 deneme ve SDK hatasını Türkçe kullanıcı mesajı + HTTP koduna çeviren tek kaynak; aiRoutes ve ticaretAjaniRoutes kullanıyor. |  |
| `mikroClient.ts` | 589 |  | 4 | 6 | ⚠️ supheli | mikro, altyapi, guvenlik | Mikro (Jump) API ile konuşmanın çekirdeği: settings/mikro'dan kimlik bilgisi okur, günlük MD5 şifreli token üretip önbellekler, yanıt zarfını çözer (mikroData/mikroSatirlar/mikroHata), stok miktarı ve satış fiyatlarını güvenli parse eder, SQL parametrelerini süzer. | mikro=true + test=false: kolon-adı yasağı (mikroStokMiktari'nın sto_mevcut_mik/toplam_miktar için null döndürmesi, V17 yöntem keşfi) testle korunmuyor. sifir=6 ancak para dışı (satır 175-176 firmaNo/subeNo `?? 0`, 569 cache zaman damgası); asıl para yolu null'a düşürülmüş (satır 273-277 yorumu). Bağ |
| `mikroMirror.ts` | 442 |  | 3 |  | ⚠️ supheli | mikro, altyapi, para | Mikro'dan çekilen ham satırları otantik kolon adlarıyla mikro_* PostgreSQL tablolarına aynalar (initMikroTables şema oluşturma + mirrorMikroStoklar/Cariler + CHA/SIP/STH/FIS kolon haritaları), ana akışı bozmadan yedek ve raporlama için. | mikro=true + test=false: CHA_COLS/SIP_COLS/STH_COLS/FIS_COLS (satır 371-432) doğrudan Mikro kolon adı eşlemesi ve hiç testi yok — 'Mikro kolon adı tahmini' arıza sınıfının tam kaynağı. Bağlanma DOĞRULANDI: server.ts:590 initMikroTables, 644 initMikroMirror. |
| `opsWatchdog.ts` | 692 |  | 2 | 8 | ✅ saglam | altyapi | Operasyon Bekçisi: her sabah yedek tazeliği, Mikro sync, stok oranı, kuyruk, kur, disk, SSL vb. kontrolleri koşup opsChecks'e yazar ve Resend ile uyarı postası atar; ayrıca saatlik bağımsız disk nöbetçisi ve KVKK saklama kuralları (SAKLAMA_KURALLARI) burada. |  |
| `pgShim.ts` | 339 |  | 2 | 1 | ✅ saglam | altyapi, tenant | Firestore şeklindeki adminDb çağrılarını (collection/doc/where/get/set) PostgreSQL JSONB tablolarına çeviren veri katmanı çekirdeği; yazmaları dbEvents üzerinden SSE ile tarayıcılara yayınlar, sentinel/timestamp çözümü yapar. |  |
| `schemas.ts` | 80 |  | 3 |  | ✅ saglam | belge, mikro | server.ts ve mikroRoutes'un ortak kullandığı zod şemalarını (FaturaKaydet, IrsaliyeKaydet, GelenFaturaAction, AiChat, EmailSend) tek kaynakta tutar; 3 dosya import ediyor. |  |

### `src/server/routes/` — 13 dosya, 7,985 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `aiRoutes.ts` | 209 | ✓ | 1 |  | ✅ saglam | altyapi | Gemini destekli 5 uç: lead skorlama, talep tahmini, nakit akışı projeksiyonu, doğal dil sohbeti ve Bekçi'nin okuduğu ai_gemini sağlık sondası (setAiHealthProbe ile server.ts'e geri yazar). |  |
| `dynamicsRoutes.ts` | 205 |  | 1 | 3 | ⚠️ supheli | para, tenant, altyapi | Microsoft Dynamics 365 Business Central köprüsü (5 rota): bağlantı durumu, ürün/cari çekme ve sipariş/fatura gönderme; Mikro'ya alternatif OAuth2 tabanlı ERP entegrasyonu. | Sahte kesinlik: satır 86 `price = Number(it.unitPrice) || 0`, 90 `stockLevel: Number(it.inventory) || 0`, 159 `balance: Number(c.balanceDue ?? 0)` — Dynamics alanı eksikse fiyat/stok/bakiye 0 olarak inventory ve leads'e yazılır. test=false. |
| `epostaRoutes.ts` | 400 |  | 1 |  | ✅ saglam | guvenlik, tenant | E-posta ve davet uçları (6 rota): Resend durumu, tekil/sipariş bildirimi/toplu kampanya gönderimi, admin daveti oluşturup posta atma ve davet jetonunu kabul etme (/api/invites/redeem). |  |
| `erpRoutes.ts` | 328 |  | 1 | 3 | ⚠️ supheli | para, tenant | Mikro dışı ERP köprüleri (13 rota): Paraşüt (gerçek, stok/cari çek + fatura gönder), Logo ve SAP B1 (büyük ölçüde stub) için durum/çekme/gönderme uçları. | Sahte kesinlik: satır 103 `balance: Number(a.balance ?? 0)` — Paraşüt cari yanıtında bakiye yoksa 0 yazılır (161-164'te aynı dosyada bu desen 'YASAK' diye düzeltilmiş, yani yarım düzeltme). mikro=true olarak ölçülmüş ama Mikro'ya doğrudan dokunmuyor; test=false. |
| `kanalRoutes.ts` | 435 |  | 1 | 3 | ⚠️ supheli | para, guvenlik, tenant | Dış satış kanalları (9 rota): Shopify HMAC imzalı webhook + elle senkron, Trendyol ve Hepsiburada sipariş/ürün çekme, Trendyol/Amazon SP-API rakip fiyat arama; siparişleri orders koleksiyonuna aktarır. | Sahte kesinlik para alanında: satır 276 `totalPrice: Number(o.totalPrice ?? 0)` (Trendyol), 344 `Number(o.totalPrice ?? o.orderAmount ?? 0)` (Hepsiburada), 407 rakip fiyat `Number(p.salePrice ?? p.listPrice) || 0` — kanal yanıtında alan eksikse sipariş toplamı 0 TL olarak kaydedilir. paraMatematigi= |
| `mikroRoutes.ts` | 4,456 |  | 1 | 40 | ⚠️ supheli | mikro, para, tenant, belge, guvenlik | Mikro (Jump) HTTP uçlarının tamamı (21 rota + SQL import motoru): stok/cari/sipariş senkronu, fatura/irsaliye kaydetme, gelen fatura kabul/red, cari hareket/ekstre, KDV/Ba-Bs/maliyet raporları ve mikroCariHareketler gibi yerel aynaları dolduran import tanımları. | sifir=40 + paraMatematigi=60 + mikro=true + test=false: satır 3448 `totalPrice: Number(x.cha_meblag ?? 0) || 0`, 2546 `bakiye = Number(row.bakiye ?? 0)`, 2848 `meblag = Number(e.borc ?? e.alacak ?? 0) || 0`, 3921/4093 `Number(item.price ?? 0) * Number(item.quantity ?? 1)`, 192-195 fiyat listesi `||  |
| `opsRoutes.ts` | 266 |  | 1 |  | ✅ saglam | altyapi, guvenlik | Operasyon bekçisi uçları (6 rota): son 14 günün opsChecks sonuçları, elle tetikleme, disk sondası, X-Ops-Token ile dış nöbetçi erişimi ve modül/çalışma-zamanı durumu (Mikro sabitlerini yalnız gösterim için okur). |  |
| `paymentRoutes.ts` | 267 |  | 1 |  | ✅ saglam | para, guvenlik, altyapi | Stripe abonelik checkout + imza doğrulamalı webhook ve iyzico durum/ödeme-bağlantısı olmak üzere 4 ödeme ucunu sunar (server.ts:4008'de bağlı). |  |
| `reportsRoutes.ts` | 166 |  | 1 | 9 | ⚠️ supheli | para, mikro, tenant | Son 30 gün KPI özeti (orders/leads/inventory) ve inventoryMovements üstünden stok/fiyat karşılaştırması veren 3 rapor ucunu sunar; kiracı filtresi loadCompanyDocs(cid) ile SQL'de. | Sahte kesinlik: satır 52 `(o.totalPrice as number) || 0` — totalPrice'ı olmayan sipariş ciroya 0 olarak girer, KPI 'bilinmiyor' yerine düşük ciro gösterir; satır 108-109/148-149 `Number(m.sth_miktar) || 0`, `Number(m.sth_tutar) || 0` ve satır 106/146 `sth_iptal` — Mikro kolon adlarıyla (sth_*) çalış |
| `superadminRoutes.ts` | 529 |  | 1 | 6 | ⚠️ supheli | para, tenant, guvenlik, mikro | SaaS operatörü paneli için 10 süper-admin ucunu (kiracı askıya alma, rol değiştirme, kullanıcı çıkarma, yedek tetikleme, iyzico ödeme bağlantısı üretme, Taslak SAS temizliği) sunar; koruma bağlamdan gelen requireSuperAdmin. | Sahte kesinlik para alanında: satır 54-55 `planAmount = PLAN_PRICES_TRY[plan]?.[cycle] ?? 0` — bilinmeyen plan adı 0 TL döner; satır 441 `Number(body.amount ?? planAmount(plan, cycle))` ve 160/163/308 bu değeri ödeme bağlantısına/billing.amount'a yazar → yanlış plan kodu 0 TL'lik ödeme bağlantısı ür |
| `ticaretAjaniRoutes.ts` | 327 |  | 1 | 3 | ⚠️ supheli | mikro, para, tenant | Claude/Gemini tabanlı Satış Ajanı (carinin Mikro satış geçmişinden yeniden-sipariş/çapraz satış) ve Satın Alma Ajanı (kritik stokları son alış tedarikçisine göre SAS önerisi) olmak üzere 2 AI ucunu sunar; fiyat/stok rakamları modelden değil katalogdan. | Ölçüm mikro=false demiş ama dosya satır 190-195 ve 268-276'da doğrudan mikro_stok_hareketleri / mikro_cari_hesaplar sorguluyor (sth_evraktip=4, veri->>'sth_tip', veri->>'sth_iptal', cari_unvan1) ve test=yok → Mikro kolon adı sınıfı test edilmemiş; ayrıca bu SQL'lerde companyId filtresi yok (cid yaln |
| `trackingRoutes.ts` | 251 |  | 1 |  | ⚠️ supheli | ui, altyapi | DHL/UPS/FedEx/Yurtiçi/MNG/Aras/PTT için 7 kargo takip proxy ucunu sunar; ilgili API anahtarı yoksa mock:true işaretli sabit sonuç döner. | Sahte kesinlik: satır 27-35 anahtar yoksa HER takip numarasına 'In Transit, Frankfurt→Istanbul, 2 gün sonra teslim' uydurma yanıt; istemci src/services/trackingService.ts:29/69/103 `if (data.mock) return data as TrackingResult` ile bunu gerçek sonuçla aynı tipte geçiriyor — UI mock bayrağını gösterm |
| `trafikRoutes.ts` | 146 |  | 1 | 3 | ✅ saglam | guvenlik, altyapi | Çerezsiz/kimliksiz site trafiği sayacı: POST ile günlük sayfa+referrer kovalarını trafikGunluk'a artırır, GET özetini süper-admine sunar (bilinen yol listesi dışı 'diger'e düşer, IP diske yazılmaz). |  |

### `src/services/` — 11 dosya, 1,562 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `auditLog.ts` | 27 |  | 4 |  | ✅ saglam | tenant, guvenlik | İstemci tarafı denetim kaydı yardımcısı: kullanıcı eylemini fire-and-forget olarak auditLog koleksiyonuna yazar (4 importer); companyId'yi user.uid yazsa da sunucu perCompany yazımda kendi cid'siyle eziyor (server.ts:2019/2057). |  |
| `authFetch.ts` | 51 |  | 32 |  | ✅ saglam | altyapi, guvenlik | Firebase ID token'ını Authorization başlığına ekleyen ve IIS 411 için gövdesiz POST/PUT/PATCH'e boş gövde koyan fetch sarmalayıcısı; 32 dosya import ediyor. |  |
| `ebelgeIndir.ts` | 102 |  | 2 |  | ✅ saglam | belge, mikro, pdf | Mikro e-belge (XML/PDF) indirmenin tek uygulaması: base64 alanını sürümden bağımsız bulur, blob olarak indirir; MikroFaturaDetay ve EBelgeMerkezi'ndeki kopyaların yerini aldı. |  |
| `errorLogger.ts` | 62 |  | 1 | 2 | ✅ saglam | altyapi | Yakalanmamış istemci hatalarını 5 dk dedup ile clientErrors koleksiyonuna yazar (sorgu dizesi bilerek atılır); main.tsx:8'de initErrorLogger() ile bağlı. |  |
| `geminiService.ts` | 90 |  | 4 |  | ✅ saglam | altyapi | Gemini AI çağrılarını (lead puanlama, panel analizi, FMEA/8D önerisi) anahtar tarayıcıya sızmadan sunucu proxy'si /api/ai/generate üzerinden yapar. |  |
| `logisticsService.ts` | 62 |  | 1 | 1 | ✅ saglam | altyapi, tenant | QR depo/araç stok transferini idempotency anahtarıyla POST /api/logistics/transfer'a gönderen ince istemci sarmalayıcı + locationStocks doc-id/miktar okuma yardımcıları. |  |
| `mikroEvrak.ts` | 422 |  | 19 | 2 | ⚠️ supheli | mikro, para | Cetpa varlıklarını (teklif, sayım, stok hareketi, izin, satınalma, bakım, servis, üretim, reçete, etiket, ziyaret, dekont) Mikro V17 evrak payload'ına eşler ve retry kuyruğuyla /api/mikro/evrak/kaydet'e push eder. | mikro=true + test=yok, 19 dosya import ediyor. Satır 93 `tkl_Alisfiyati: l.price ?? 0` — fiyatı olmayan teklif satırı Mikro'ya 0 TL fiyatla gider (sahte kesinlik, dış sisteme yazılıyor). Satır 161 `pit_izin_tipi: l.type ?? 0`. Dosya başlığı kolon adlarını 'apidocs örnek gövdelerinden' aldığını ve 'd |
| `mikroService.ts` | 291 | ✓ | 6 |  | ✅ saglam | mikro | Mikro Jump API'ye sunucu tarafı /api/mikro/* uçları üzerinden stok/cari/sipariş/banka senkron ve import çağrıları yapan ince istemci. |  |
| `shopifyService.ts` | 31 |  | 2 |  | ✅ saglam | altyapi, para | Shopify ürün/sipariş senkronu ve taslak sipariş oluşturmayı /api/shopify/* uçlarına ileten istemci. |  |
| `syncRetryService.ts` | 220 |  | 2 |  | ✅ saglam | mikro, altyapi | Başarısız Mikro/Luca/Shopify senkron işlerini syncJobs kuyruğuna alır, üstel geri çekilmeyle yeniden dener, ölü işleri temizler (App.tsx tick + MikroSyncPanel'den tetiklenir). |  |
| `trackingService.ts` | 204 |  | 1 |  | ✅ saglam | ui, altyapi | DHL/UPS/FedEx/Yurtiçi/MNG/Aras/PTT kargo takip yanıtlarını tek TrackingResult biçimine normalize eden istemci (CargoTrackingTab kullanır). |  |

### `src/store/` — 2 dosya, 359 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `appStore.ts` | 61 | ✓ | 1 |  | ⚠️ supheli | altyapi, tenant | Dil, döviz kurları ve auth (user/rol/companyId) için global Zustand deposu — prop-drilling'i kaldırma amacıyla yazılmış. | Tek canlı import App.tsx (satır 267 import, 624 okuma) + kendi testi; hiçbir bileşen/sayfa useAppStore kullanmıyor. Dosya başlığı 'any component can read without prop drilling' diyor ama bu gerçekleşmemiş: App.tsx hem yazıyor hem okuyor, aynı state (language/exchangeRates/user/companyId) App.tsx'te  |
| `dataStore.ts` | 298 |  | 2 |  | ✅ saglam | para, altyapi | Sipariş, lead, stok, sevkiyat, araç, konum stoku, döviz pozisyonu (fxPos), şirket/Mikro ayarları gibi paylaşılan veri koleksiyonlarını tutan Zustand deposu (App.tsx useShallow ile, EBelgeMerkezi mikroSettings okur). |  |

### `src/test/` — 1 dosya, 39 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `setup.ts` | 39 |  | 0 |  | ✅ saglam | altyapi | Vitest global kurulumu — jest-dom matcher'ları ve firebase/firestore/auth mock'larını tanımlar (vitest.config.ts:10 setupFiles ile bağlı; importEden=0 yanlış pozitif). |  |

### `src/types/` — 2 dosya, 484 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `erp.ts` | 223 |  | 3 |  | ✅ saglam | altyapi, mikro | ERP eklenti kayıt defteri: ErpId/ErpFeature birlikleri, SUPPORTED_ERPS statik listesi ve Logo/Dynamics365/SAP yapılandırma + sonuç tipleri. |  |
| `subscription.ts` | 261 |  | 6 |  | ⚠️ supheli | para, guvenlik, ui | Abonelik planı modeli (PLANS, ALL_MODULES), modül erişim kapısı (canAccessModule), deneme süresi ve fiyat biçimlendirme yardımcıları. | Satır 234 `formatPrice` kendi `₺${amount.toLocaleString('tr-TR')}` kopyasını taşıyor (kopya.para=1) — currency.ts `formatCurrency` varken ikinci para biçimlendirici; tek-kaynak fazında birleştirilmeli. Satır 200 `getPlanConfig` bilinmeyen plan id'sinde sessizce `PLANS[0]` (starter) döner: tenant kay |

### `src/utils/` — 20 dosya, 2,584 satır

| Dosya | Satır | Test | imp | `\|\|0` | Durum | Risk | İşlev | Not |
|---|---|---|---|---|---|---|---|---|
| `arama.ts` | 50 | ✓ | 6 |  | ✅ saglam | ui | Türkçe-doğru küçük harf + ASCII indirgeme ile alt-dize arama (katla/eslesir); 'ışık'/'IŞIK' eşleşmezliğini çözer. |  |
| `belgeSablonu.ts` | 242 |  | 4 |  | ✅ saglam | pdf, belge | Belge Tasarımcısı şablonlarının (documentTemplates) tek kaynağı: varsayılan başlık/renk/banka bilgisi, zaman aşımlı sablonGetir ve PDF alt bilgi/renk yardımcıları. | TENANT ŞÜPHESİ ÇÜRÜDÜ: koleksiyon collections.ts TENANT listesinde ve rbac.ts'te var (grep 2026-09-04). Satır 101 `getDoc(doc(db,'documentTemplates', docType))` — belge kimliği yalnız docType ('teklif','siparis'), companyId yok; `documentTemplates` server.ts ve src/server/*.ts'te hiç geçmiyor (TENAN |
| `buyukHarf.ts` | 44 |  | 3 |  | ✅ saglam | ui | Ekrana basılan metin için Türkçe locale-duyarlı büyütme/küçültme/baş harf (i→İ); karşılaştırma için değil. |  |
| `cost.ts` | 224 | ✓ | 7 | 2 | ✅ saglam | para | Stok kalemi maliyet/fiyatının TL karşılığını kur arşivinden hesaplar; kur yoksa uydurmaz, çevrilemeyen kalemleri sayıp mesajlar (maliyetDurumu, itemCostTRY, cevrilemeyenler). |  |
| `currency.ts` | 127 | ✓ | 25 |  | ⚠️ supheli | para, ui | Para biçimlendirme (formatCurrency/formatAmount/formatInCurrency) ve kur yoksa null dönen TL→döviz çevirici (kurCevir); 25 dosyanın ortak para yüzeyi. | Satır 22 `if (!isFinite(amount)) return '₺0,00'` ve satır 66 `return \`0 ${currency}\``: undefined/NaN tutar (Mikro'dan gelmeyen bakiye, henüz yüklenmemiş toplam) ekranda 'sıfır' olarak basılır — kullanıcı 'borç yok/tutar 0' okur, oysa veri yok. kurCevir/formatInCurrency aynı dosyada '—'/null ile do |
| `durumEtiketi.ts` | 100 |  | 8 |  | ✅ saglam | ui | Sipariş/sevkiyat durumu, fatura tipi ve öncelik değerlerinin TR/EN ekran etiketi — Record<Birlik> ile derleme zamanı eksik-çeviri kapısı. |  |
| `export.ts` | 191 |  | 4 | 3 | ⚠️ supheli | para, belge | Sipariş/müşteri/envanter/stok hareketi/aylık özet listelerini PapaParse ile BOM'lu CSV'ye çevirip indirir. | Yarım düzeltme: satır 94 yorumu envanter export'unda `?? 0`'ı `?? ''`'e çevirdiğini söylüyor (2026-09-04 denetimi) ama aynı dosyada satır 43 `o.kdvOran ?? 0` ve satır 70 `l.creditLimit ?? 0` duruyor. KDV oranı girilmemiş sipariş CSV'de 'KDV %0' (istisnalı gibi), kredi limiti tanımsız müşteri '0 ₺ li |
| `faturaEsle.ts` | 56 |  | 3 |  | ✅ saglam | mikro, belge | Stok hareketi/evrak sıra no + cari kod + tarih ölçütlerini VE bağlacıyla mikroFaturalar listesinde arar, tek eşleşme yoksa null döner (yanlış fatura açmaz). |  |
| `filo.ts` | 48 |  | 2 |  | ✅ saglam | mikro, ui | Mikro depo kayıtlarından plaka-adlı olanları araç olarak türetip elle eklenen `vehicles` listesiyle plaka bazında tekilleştirerek birleştirir (Canlı Sevkiyat araç listesi). |  |
| `firebase.ts` | 18 |  | 25 |  | ✅ saglam | altyapi | Veri katmanı dinleyici hatalarını işlem tipi/yol/kullanıcı bilgisiyle konsola yazan `logFirestoreError` + `OperationType` enum'u (26 dosya kullanıyor; adı Firestore döneminden kalma, PG shim'le de çalışıyor). |  |
| `fsSort.ts` | 69 |  | 27 |  | ✅ saglam | ui, altyapi | Sunucu tarafı orderBy yerine istemcide `createdAt` (Timestamp/ISO/ms) veya keyfi alana göre sıralama yardımcıları; alanı olmayan kayıtları sona atar. |  |
| `kurArsivi.ts` | 118 |  | 2 |  | ✅ saglam | para | Fatura tarihine göre TCMB kurunu toplu yükleyip (`kurlariYukle`) render sırasında senkron önbellekten okutan (`kurAl`, bulunamazsa null) tarih-bazlı kur arşivi; cost.ts ve KurUyarisi tüketiyor. |  |
| `logistics.ts` | 77 |  | 1 |  | ✅ saglam | ui | Haversine mesafe ve en-yakın-komşu TSP sezgiseliyle sevkiyat duraklarını sıralayıp tahmini dakika atayan rota optimizasyonu (App.tsx:2908 `optimizeRoute` çağırıyor). |  |
| `pdf.ts` | 715 |  | 4 | 17 | ⚠️ supheli | para, pdf, belge | Sipariş/teklif, cari ekstre, satın alma siparişi ve mal kabul PDF'lerini jsPDF+autoTable ile üretir. | Sahte kesinlik: 17 adet `|| 0` para/miktar alanında — satır 130-132 `item.price || 0`, `item.quantity || 0`; satır 157 `Number(totalPrice) || Number(totalAmount) || 0` (eksik tutar PDF'de 0,00 basılır). Yarım düzeltme: exportOrderPDF satır 38 `currency` okuyor ama exportPurchaseOrderPDF/exportGoodsR |
| `pdfFont.ts` | 35 |  | 7 |  | ✅ saglam | pdf | jsPDF örneğine Türkçe glifli Roboto fontunu dinamik import ile kaydeder; yüklenemezse Helvetica'ya düşüp uyarı yazar. |  |
| `pdfTheme.ts` | 112 |  | 4 |  | ⚠️ supheli | pdf, belge | Rapor PDF'leri için marka paleti, başlık bandı, alt bilgi ve tablo stili tek kaynağı (MutabakatPanel, useReportsData, OrdersPage, RaporlarPage kullanıyor). | Başlık yorumu 'TÜM PDF çıktılarının TEK stil kaynağı, hiçbir yer kendi başlık markup'ını yazmaz' diyor; ama 4 PDF üreticisini barındıran src/utils/pdf.ts (715 satır) pdfTheme'den HİÇBİR sembol import etmiyor (grep: pdfTheme|PDF_RENK|pdfBaslik → 0 eşleşme), belgeSablonu.ts ile ayrı bir stil hattı sür |
| `recharts.ts` | 57 |  | 5 |  | ✅ saglam | ui | Recharts Tooltip formatter'ı için değeri güvenle sayıya çevirip çağırana veren, çevrilemezse ham değeri aynen döndüren tip köprüsü (`sayiBicimleyici`). |  |
| `siparis.ts` | 78 |  | 16 |  | ✅ saglam | para, ui | Shopify/Cetpa/Mikro-fatura kaynaklı siparişlerde sipariş no, tarih ve 'tahsilat takip edilebilir mi' (`odemeTakipli`) alanlarını kaynak-bağımsız okuyan tek kaynak (16 dosya kullanıyor). |  |
| `trParse.ts` | 59 | ✓ | 2 |  | ✅ saglam | para | Türkçe biçimli sayı ('1.234,56'), tarih (DD.MM.YYYY) ve CSV ayrıştırma tek kaynağı; banka ekstresi importunda iki çağıran paylaşıyor, testi var. |  |
| `zaman.ts` | 164 | ✓ | 12 |  | ✅ saglam | altyapi | Timestamp/ISO string/epoch/Date biçimlerindeki tarih alanlarını tek kuralla ms/Date/gün-başı/ay-anahtarına çevirir; çözülemeyen değerde bugüne düşmek yerine null döner (RaporlarPage KPI, bayi komisyonu, vade gecikmesi hesaplarının tarih temeli). |  |

## G. Ajan yanlış-pozitifleri — grep ile çürütüldü

- `LucaSyncPanel.tsx` "rota yok" → `server.ts:3463`, `:3528`'de VAR
- `ApprovalQueue`/`BakimModule`/`BOMPanel`/`belgeSablonu` "TENANT listesinde olmayabilir" → hepsi `collections.ts` + `rbac.ts`'te VAR
- `server.ts`, `App.tsx` importEden=0 → giriş noktaları; `tenantBackup`/`storageBucket` → `scripts/*.mjs` tüketiyor (artık ölçüme dahil)

**Ders:** "importEden=0" tek başına ölü demek değil; ajan "doğrulayamadım" dediğinde bu bulgu değil sorudur — grep 10 saniye.