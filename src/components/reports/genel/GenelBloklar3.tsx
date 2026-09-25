/**
 * GenelBloklar3.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 1463–2029).
 * Bloklar ORİJİNAL SIRASIYLA taşındı; bloklardaki `reportsTab === 'genel'`
 * koşulları BİLEREK korundu (bkz. GenelRapor.tsx başlık notu — ebeveyn zaten
 * sekmeye göre render ediyor, koşulu silmek "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 *
 * ── 6b bağlama notu (Faz 3 "Genel I", 2026-09-24; şartname faz3-2n-specs/6n-kesif/6b/baglama-genel-bloklar3.md) ──
 * Bu dosyanın 13 paneli testli yardımcılara BAĞLANDI; satır içi para/ölçek/skor kuralı kalmadı
 * (`src/utils/para`, `pano/*`, `rapor/*`). Kullanıcı kararları (KARARLAR.md, kullanıcının cümleleri):
 *
 * K2  — kullanıcı 2026-09-19: "hayır" (iptaller ciroya girmesin). Bu dosyada iptali KATAN altı panel düzeltildi.
 * K4  — kullanıcı 2026-09-19: "kimlikle" (müşteri gruplaması). Üç `new Set(customerName)` sitesi `musteriOzeti`ye indi.
 * K14 — kullanıcı 2026-09-19: "kaldır" (aynı işi yapan çift paneller). GB3'ün ikinci CCC/DIO kartı SİLİNDİ;
 *       tek kart `genel/GenelOzet.tsx` Phase 185 (gerçek DSO + `stokDevirGunuTutar`, 90 günlük pencere).
 * K14/DSO — kullanıcı 2026-09-24: "Kaldır" (P8 'Est. DSO' kutusu). Hesabı DSO değildi (stok ÷ aylık ciro × 30);
 *       gerçek DSO `GenelOzet` `alacakDevirGunu`de. 6 kutu → 5.
 * K24 — kullanıcı 2026-09-19: "kalsın, hafızaya at sonra bakarız." 'Phase 300 Milestone Reached!' ve
 *       '300 analytics phases deployed' geliştirici metinleri BU TURDA KALIR (ERTELENDİ).
 * K28 — dönem tanımları parite + adlandırma (PLAN-v2 §2.1 / §8 sıra 24; KARARLAR.md'de kullanıcı cümlesi YOK):
 *       12 aylık sabit payda (`ORTALAMA_CIRO_AY_SAYISI`) DEĞİŞMEDİ; P3 sipariş büyüklüğü KUARTİLİ GB1'in takvim
 *       çeyreğinden ADIYLA AYRIŞTI ('Ciro Çeyreklik Analizi' → 'Sipariş Büyüklüğü Dilimleri (Kuartil)', 'Ç1…Ç4' →
 *       'Dilim 1…4'; delta bulgu 9); P13 mevsimsellik çubuk kırpması `MEVSIMSELLIK_OLCEK_TAVANI = 2` adıyla KORUNDU
 *       (delta bulgu 8 — eski `Math.min(80, s * 40)`: 1,0x = 40 px sabit referans, 2,0x'te tavan).
 * K20 — kullanıcı 2026-09-19: "ok kalsın." Gömülü eşik/kova DEĞERLERİ aynen korunur, yalnız adlandırılır (aşağıda).
 * K21 — kullanıcı 2026-09-24: "Tüm ciro" ("ilk N" paydası). P1 üst %30 ve P3 üst dilim payı TÜM toplama bölünür;
 *       P6 'toplam risk' TÜM zarar eden siparişlerden (liste 6'ya kesilir, "+N sipariş daha" notu — PLAN-v2 §2.1 K21
 *       çıpası bu siteyi AÇIKÇA sayıyor; şartname :255 kesilmiş listeden toplam alıyordu → KARARLAR kazandı; delta bulgu 5/6).
 *       DİKKAT (delta bulgu 10, AÇIK SORU): P1 paydası `sadecePozitif` ile yalnız tutarı > 0 siparişler, P3 ve sayfa
 *       KPI'sı (`raporCirosu`) negatif/₺0 dâhil TÜM iptalsizler — negatif `totalPrice` yalnız elle girişle doğar; P1
 *       rozetinin altına "pozitif tutarlı siparişlerin toplamı" dipnotu (yalnız fark varken) kondu, tek payda tanımı
 *       kullanıcı kararı bekler.
 *
 * Bilinçli farklar (bilinen girdide sayılar BİREBİR; değişenler yalnız kısmi veri / kullanıcı kararı):
 *  • Tutarı okunamayan sipariş 0 SAYILMAZ: ekran toplamı kısmi + `<KapsamNotu>`; türetilen sayı (pay, marj,
 *    skor, endeks, köprü) HESAPLANMAZ ('—'; çubuk/rozet çizilmez).
 *  • P2: adet metrikleri artık ₺ ile basılmıyor; kısmi veride skor/rozet yok (uydurma 15 puan yedeği kalktı).
 *    AOV eski gibi YUVARLANMIŞ karşılaştırılır (`Math.round`; hakem 2026-09-24 bulgu 3 — ham değerle merdiven
 *    ayrışıyordu: prev 1000,4 / curr 1100,2 → eski 1100 ≥ 1000×1,1 = 25 puan, ham 1100,2 < 1100,44 = 15 puan).
 *    Tek tutarsız sipariş varsa AOV YOK (`tamAov` kapısı, bulgu 4: `AovSonuc.deger` BİLİNENLERİN ortalamasıdır —
 *    Ciro '—' iken AOV kutusu kısmi örneklemden MoM yönü basıyordu).
 *  • P3: `undefined - undefined` sıralaması ve iptaller giderildi (K2) — çeyrek sınırları değişir.
 *  • P6/P8/P9: `itemCostTRY`nin sessiz 0'ı `kartMaliyetiTL`nin `null`una döndü; marj yüzdesi TAM SAYI
 *    (`brutMarjHesabi.marj` yuvarlanmış döner — ikinci marj kuralı YAZILMADI). P8 'Brüt Marj' kutusu ve P9
 *    'Ortalama' 0 ONDALIKLA basılır (eski `toFixed(1)` HAM yüzdeydi: ₺1.500/₺1.000 → '33.3%', şimdi '33%').
 *    Yuvarlanmış girdiye 1 ondalık eklemek her zaman ',0' basardı (sahte hassasiyet — hakem 2026-09-24 bulgu 2).
 *    Tam parite `raporMarj`a ADDITIVE ham `marjHam` alanı ister (kapalı modül, başka grup → açık soru).
 *  • P6/P8/P9 MALİYET KURALI ESKİSİYLE AYNI DEĞİL (PARİTE KAYBI — kullanıcı kararı YOK; hakem 2026-09-24 bulgu 1):
 *    eski kopyalar ÖNCE kartı arıyordu (`inventory.find(id === inventoryId || sku === sku)` → `itemCostTRY`),
 *    kart yoksa `li.costPrice`. `stokMaliyetCozucu` (5/n, raporMarj) `li.costPrice`ı ÖNCELİKLİ okur, kartı yalnız
 *    `id || name` ile bulur — `sku` EŞLEMESİ YOK. Etki (bilinen veride): kalemi `costPrice` taşıyan siparişte COGS
 *    kartın bugünkü maliyeti yerine SATIŞ ANINDAKİ maliyettir (₺1.500 sipariş, costPrice 80×10 / kart 100×10 →
 *    Brüt Marj %47 ↔ eski %33; Brüt Kâr ₺700 ↔ ₺500; P6 zarar sınıfı da değişebilir); yalnız `sku` ile eşleşen
 *    kalem artık `maliyetsiz` sayılır (Stok Devri '—'). Sayfa geneli TEK kural: `useReportsData.brutMarj` (:471,
 *    GenelOzet) AYNI çözücüyü kullanır — burada ikinci bir eşleme kuralı YAZILMADI (kopya yasağı). Hangi maliyet
 *    (satış anı `costPrice` mi, güncel kart mı) ve `sku` yedeği → AÇIK SORU (kullanıcı kararı gerekir).
 *  • P7: kur kapısında global `isFinite` → `Number.isFinite` (CLAUDE.md; `number` girdide davranış AYNI).
 *  • P10: 5 satır → 6 satır (Retained İKİYE: büyüyen / küçülen); K28 dönem asimetrisi alt başlıkta adlandırıldı.
 *  • P13: hiç ay ölçülemediğinde panel nedenini yazar. Çubuk ölçeği ESKİSİYLE AYNI (K28 parite: `MEVSIMSELLIK_OLCEK_TAVANI`;
 *    ilk bağlama "kırpma kalktı, dinamik ölçek" yapmıştı — delta bulgu 8 geri aldı); yalnız eski 4 px hayalet taban yok (K26).
 *
 * Delta turu (hakem 2026-09-24, 16 bulgu — bu dosyaya düşenler; P3/P6/P13 yukarıda K21/K28 satırlarında):
 *  • P8/P9 (bulgu 3): tarihi çözülemeyen sipariş `aylikCiro`/ay kovasına GİRMEZ ama SAYILMIYORDU — kartta 'Brüt Kâr'
 *    (tüm iptalsizler) ile 'Aylık Ortalama Ciro' (yalnız tarihi çözülenler) yan yana, not yok. Artık `tarihsiz` sayacı
 *    ikisinin notunda (P8 `ciroTarihi` — `aylikCiro`nun kuralı; P9 `ayAnahtari(createdAt)` — kovanın kuralı; iki tarih
 *    kuralı tek dosyada = açık soru A1, GB1 başlığındaki gibi). `aylikCiro` kapalı imza, DEĞİŞMEDİ.
 *  • P9 (bulgu 4): cirosu HİÇ bilinmeyen ay (ekranTutari NaN) `olculen`e girmiyor, ortalama o ay yokmuş gibi 11 aydan
 *    çıkıyordu; kısmen bilinen ay ise giriyor ve '—' yapıyordu (aynı sınıf, zıt sonuç). Artık siparişi olup cirosu
 *    bilinmeyen ay da `olculen`de → marjı null → ortalama '—' (kodun kendi vaadi: "tek ay bile '—' ise ortalama '—'").
 *  • P4/P7/P9 kapıları (bulgu 15): son 30 gün / haftanın günü / 12 ay siparişlerinin TÜMÜ tutarsızken panel sessizce
 *    kayboluyordu (not kapının ARKASINDAYDI). Artık "gövde kapısı + not" kalıbı (P6/P13 gibi): yalnız gerçekten veri
 *    yokken (bilinmeyen de 0) `return null`; tümü bilinmiyorsa panel '—' + "N siparişin tutarı okunamadı" ile görünür.
 */
import { useMemo } from 'react';
import { type ReportsCtx } from '../useReportsData';
import { type Order } from '../../../types';
import { zamanDate, zamanMs, gunAnahtari, ayAnahtari } from '../../../utils/zaman';
import { oc } from '../../../i18n/ortak';
import { toplaBilinen, ekranTutari, tamTutar, tutarBirlestir, sayiSirala, type Tutar } from '../../../utils/para';
import { siparisTutari } from '../../../utils/siparis';
import { raporSiparisi, raporCirosu, ortalamaSiparis } from '../../../utils/pano/raporVeriKatmani';
import { yuzdeOrani, ortalamaSiparisTutari, teslimatOrani, type AovSonuc } from '../../../utils/pano/finansKpi';
import { stokMaliyetCozucu, brutMarjHesabi } from '../../../utils/pano/raporMarj';
import { stokDevirGunuTutar } from '../../../utils/rapor/nakitDongusu';
import { degerToplami } from '../../../utils/pano/stokSevkiyat';
import { tutarSatiri, olcekReferansi, cubukOrani, sayacOlcegi, seriCubukOrani } from '../../../utils/pano/cubuk';
import { oranYuzde } from '../../../utils/siparisler/lojistikKpi';
import { aylikCiro, ciroTarihi } from '../../../utils/pano/ciroDonem';
import { zamanKovalari, mevsimsellikEndeksi } from '../../../utils/rapor/zamanDagilimi';
import { musteriOzeti } from '../../../utils/rapor/musteri';
import { adetSay } from '../../../utils/rapor/sayac';
import { yuzdeYaz, katYaz } from '../../../utils/rapor/bicim';
import { siraliDilimler } from '../../../utils/rapor/dagilim';
import { bilesikSkor, esikBandi, type BantTanimi } from '../../../utils/rapor/skor';
import { ciroKopru } from '../../../utils/rapor/crmMusteri';
import { kartMaliyetiTL, cevrilemeyenler, cevrilemeyenMesaji } from '../../../utils/cost';
import { paraYaz, tlYaz } from '../../../utils/currency';
import { KapsamNotu, OlcekCubugu } from '../ReportKit';
import { rc } from '../../../i18n/rapor';

/* K20 — kullanıcı 2026-09-19: "ok kalsın." Gömülü eşik/kova DEĞERLERİ aynen korunur, yalnız adlandırılır. */
/* K28 — kullanıcı: dönem tanımları PARİTE + adlandırma (takvim pencereleri değişmez). */
const DESIL_SAYISI     = 10;   // P1 · `siraliDilimler(…, DESIL_SAYISI, { bolme: 'tavan', sadecePozitif: true })` — bugünkü `Math.ceil(n/10)` bölmesi = 'tavan' (K28 parite; oran dizisi YOK, sayı + bölme kuralı)
const UST_DESIL_SAYISI = 3;    // P1 · "Üst %30" = son 3 desil — rozet YALNIZ üçü de doluyken ('tavan' n 10'un katı değilken üst desilleri boş bırakır; P1 :32-33 kapısı)
/* K28 (PLAN-v2 §2.1) — P3 sipariş büyüklüğü KUARTİLİ, GB1 P156'nın takvim çeyreği ("Q3 2026") ile AYNI sözcüğü paylaşıyordu
   ("Çeyrek"); "Ç4 (Üst %25) · toplam ₺480.000" Ekim–Aralık cirosu sanılıyordu (delta bulgu 9). Sabit adı ve ekran metni
   AYRIŞTI: 'Dilim 1…4 (Kuartil)'. Bölme kuralı ve rakamlar DEĞİŞMEDİ (parite). */
const KUARTIL_ASGARI_SIPARIS = 20;   // P3 kapısı — dilimlenen küme (`iptalsiz`) üzerinden; eski `orders.length >= 20` iptalleri de sayıyordu (inceleme 2026-09-25)
const KUARTIL_SAYISI   = 4;    // P3 · `siraliDilimler(…, KUARTIL_SAYISI, { bolme: 'taban' })` — bugünkü `Math.floor(n/4)` + kalan SON dilime = 'taban' (K28 parite; desilden FARKLI bölme, seçenekle korunur)
const KUARTIL_RENKLERI = ['#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8'] as const;   // P3 · dilim çubuk renkleri (eski :149 dizisi AYNEN)
const MOMENTUM_PENCERE_GUN = 30;                                              // P2 · son 30 gün ↔ önceki 30 gün
const MOMENTUM_AGIRLIK  = 1;                                                  // P2 · dört metrik EŞİT ağırlıklı; `bilesikSkor` ağırlık VARSAYMAZ, açıkça geçilir
const MOMENTUM_AZAMI_SKOR = 100;                                              // P2 · "skor/100" etiketi = 4 metrik × 25 puan (utils-skor tablosu) — tam veride skor 0..100, etiket ANLAMLI
/* K20 — kullanıcı 2026-09-19: "ok kalsın." P2 büyüme merdiveni puanları 25/15/5/0 AYNEN (eski GB3:83 değerleri). ×4 ölçekleme YOK — "0–100'e taşıma" DEĞER DEĞİŞTİRİRDİ (4×100 = 400 > tavan 100, "180/100" gibi anlamsız rakam). */
const MOMENTUM_PUANLARI = { guclu: 25, artis: 15, hafifDusus: 5, dusus: 0 } as const;
const MOMENTUM_TABANSIZ_PUAN = 15;                                            // P2 · `prev <= 0` iken `curr > 0` dalı (eski `: (m.curr > 0 ? 15 : 0)`) — K20 aynen
const MOMENTUM_BUYUME_CARPANI = { guclu: 1.1, artis: 1, hafifDusus: 0.9 } as const;  // P2 · curr >= prev*1.1 / >= prev / >= prev*0.9 (K20 aynen)
/** P2 · büyüme bantları — `esikBandi`ye verilen bant ÜRETECİ (MERDİVEN KOPYASI DEĞİL; puan kararı yardımcıda).
 *  Çarpan PAYDA tarafında (`prev * çarpan`); `curr / prev >= 1.1` biçimine ÇEVRİLMEZ — kayan noktada ayrışır
 *  (utils-skor PARİTE + test 12: `prev = 3`, `curr = 3.3000000000000003`). `prev * 1` bit düzeyinde `prev`dir. */
const buyumeBantlari = (prev: number): readonly BantTanimi<number>[] => [
  { altSinir: prev * MOMENTUM_BUYUME_CARPANI.guclu,      deger: MOMENTUM_PUANLARI.guclu },
  { altSinir: prev * MOMENTUM_BUYUME_CARPANI.artis,      deger: MOMENTUM_PUANLARI.artis },
  { altSinir: prev * MOMENTUM_BUYUME_CARPANI.hafifDusus, deger: MOMENTUM_PUANLARI.hafifDusus },
  { altSinir: -Infinity,                                  deger: MOMENTUM_PUANLARI.dusus },   // taban bandı AÇIKÇA (sessiz yedek YOK)
];
/** P2 · rozet + çubuk bantları — eski :87-90 eşikleri (80/50/25), etiketleri ve renk sınıfları + :101 çubuk sınıfları BİREBİR.
 *  Rozet metni, rozet rengi ve çubuk rengi TEK `esikBandi(m260.skor, MOMENTUM_BANTLARI)` çağrısından okunur;
 *  80/50/25 dosyada İKİNCİ KEZ GEÇMEZ (utils-skor hakem 3). */
interface MomentumBandi { etiketTr: string; etiketEn: string; rozetSinifi: string; cubukSinifi: string }
const MOMENTUM_BANTLARI: readonly BantTanimi<MomentumBandi>[] = [
  { altSinir: 80,        deger: { etiketTr: '🚀 Güçlü İvme', etiketEn: '🚀 Strong Momentum',   rozetSinifi: 'text-emerald-600 bg-emerald-100', cubukSinifi: 'bg-emerald-400' } },
  { altSinir: 50,        deger: { etiketTr: '📈 Orta İvme',   etiketEn: '📈 Moderate Momentum', rozetSinifi: 'text-blue-600 bg-blue-100',       cubukSinifi: 'bg-blue-400' } },
  { altSinir: 25,        deger: { etiketTr: '➡️ Stabil',      etiketEn: '➡️ Stable',            rozetSinifi: 'text-amber-600 bg-amber-100',     cubukSinifi: 'bg-amber-400' } },
  { altSinir: -Infinity, deger: { etiketTr: '📉 Düşüş',       etiketEn: '📉 Declining',         rozetSinifi: 'text-red-600 bg-red-100',         cubukSinifi: 'bg-red-400' } },
];
const YOGUNLUK_PENCERE_GUN = 90;                                              // P5 · ısı haritası
const YOGUNLUK_SUTUN       = 30;                                              // P5 · ızgara sütunu
const ZARAR_SATIR          = 6;                                               // P6 · listede en çok satır (YALNIZ liste — 'toplam risk' kesilmemiş kümeden, K21)
const COKLU_KUR_PENCERE_GUN = 30;                                             // P7
/** P2/P7 · AOV TÜRETME kapısı (hakem 2026-09-24 bulgu 4): `AovSonuc.deger` BİLİNEN tutarların ortalamasıdır (kısmi
 *  örneklem; `bilinmeyen` sayfa notu için ayrı döner). Skor, MoM oku ve "avg $…/order" bu değerden TÜRETİLİYOR →
 *  tek tutarsız sipariş varsa sayı YOK (NaN → '—'). KURAL KOPYASI DEĞİL, KAPI: ortalama yardımcıda hesaplanmaya
 *  devam eder; burada yalnız `bilinmeyen > 0` iken sonuç düşürülür. */
const tamAov = (a: AovSonuc): number => a.bilinmeyen > 0 ? NaN : a.deger;
const ORTALAMA_CIRO_AY_SAYISI = 12;                                           // P8 · "Avg Monthly Revenue" PAYDASI (K28 parite)
const MARJ_TREND_AY = 12;                                                     // P9
const GUN_YIL = 365;                                                          // P8 · stok devir kapısının penceresi
const BRUT_MARJ_IYI = 30, BRUT_MARJ_ORTA = 15;                                 // P8/P9 renk eşikleri
const MARJ_HEDEF = BRUT_MARJ_IYI;                                             // P9 · "Target: 30%" — hedef = iyi eşiği (K20 aynen)
const STOK_DEVRI_IYI = 4, STOK_DEVRI_ORTA = 2;                                // P8
const MEVSIMSELLIK_ZIRVE = 1.2, MEVSIMSELLIK_DIP = 0.8;                       // P13
/** P13 · çubuk ÖLÇEĞİ (K28 parite + adlandırma; delta bulgu 8): eski `Math.min(80, s * 40)` px → 1,0x = kabın yarısı (40/80 px),
 *  2,0x ve üstü tavana yapışır. `seriCubukOrani(s, 2)` = s/2 × 100; `OlcekCubugu` 100'de kırpar → aynı piksel. Endeks
 *  RAKAMI değil, yalnız çubuk boyu; sabit lejandda yazılır (K20 "adlandır + dipnot"). */
const MEVSIMSELLIK_OLCEK_TAVANI = 2;
/** P8 · kutu renkleri (eski :348-352 hex'leri AYNEN) + `null`/NaN için NÖTR gri — bilinmeyen değere hüküm YOK. */
const RENK_NOTR = '#9ca3af', RENK_IYI = '#10b981', RENK_ORTA = '#f59e0b', RENK_KOTU = '#ef4444';
/** P10 · köprü satır renkleri (eski :455/:459 hex'leri AYNEN). Renk KALEM TÜRÜNDEN gelir, işaretten değil. */
const KOPRU_RENGI = { taban: '#6366f1', arti: '#10b981', eksi: '#ef4444' } as const;

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'employees' | 'quotations' | 'inventoryMovements' | 'exchangeRates' | 'currentLanguage' | 'fmtAna' | 'leadCariKodu'>;

export default function GenelBloklar3({ reportsTab, orders, inventory, employees, quotations, inventoryMovements, exchangeRates, currentLanguage, fmtAna, leadCariKodu }: Props) {
  // 6b · `currentLanguage: string` → `'tr' | 'en'` (bicim.ts imzası). TEK yer; panellerde satır içi daraltma YOK.
  const dil: 'tr' | 'en' = currentLanguage === 'tr' ? 'tr' : 'en';
  // Adet sayaçlarının `toLocaleString` yereli (P2 adet metrikleri, P12 sayaç kutuları) — eski yerel AYARSIZ çağrılar.
  const yerel = dil === 'tr' ? 'tr-TR' : 'en-US';
  // Kalem → birim maliyet: kartın kuru çevrilemiyorsa `null` (0 DEĞİL). Eskiden dosyada 4 KOPYA vardı (248/324/379/472).
  // DİKKAT — kural eskisiyle AYNI DEĞİL (başlık 'bilinçli farklar', hakem bulgu 1): eski kopyalar ÖNCE kartı (`id || sku`),
  // sonra `li.costPrice`; `stokMaliyetCozucu` ÖNCE `li.costPrice`, sonra kart (`id || name`; sku YOK). Sayfa geneli tek
  // kural `useReportsData.brutMarj` ile AYNI çözücü; burada ayrı çözücü YAZILMAZ (ikinci eşleme kuralı). AÇIK SORU.
  const kalemMaliyeti = useMemo(
    () => stokMaliyetCozucu(inventory, k => kartMaliyetiTL(k, exchangeRates)),
    [inventory, exchangeRates],
  );
  const iptalsiz = useMemo(() => orders.filter(o => o.status !== 'Cancelled'), [orders]);   // K2 — tek kural
  // K4 — kullanıcı: "kimlikle". İki dönemin özeti AYNI nesneyle kurulur (utils-crm-musteri hakem 1: farklı harita köprüyü bozar).
  const musteriSecenek = useMemo(
    () => ({ tutarSec: raporSiparisi, tarihSec: (o: Order) => zamanMs(o.createdAt), leadCariKodu }),
    [leadCariKodu],
  );

  return (
    <>
      {/* ── P1 · Sipariş Büyüklüğü Desil Analizi (Phase 256) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        // Elle `> 0` süzgeci YAZILMAZ: `sadecePozitif` bilinen-ama-≤0'ı `kapsamDisi` SAYAR; tutarı bilinmeyen `bilinmeyen`de.
        const d256 = siraliDilimler(iptalsiz, siparisTutari, DESIL_SAYISI, { bolme: 'tavan', sadecePozitif: true });
        // Yardımcının DEĞİŞMEZİ: Σ adet + bilinmeyen + kapsamDisi === liste.length → kapsanan adet reduce'suz.
        const kapsanan256 = iptalsiz.length - d256.bilinmeyen - d256.kapsamDisi;
        if (kapsanan256 < DESIL_SAYISI) return null;
        // KAPI (2026-09-24): 'tavan' bölmesi n 10'un katı değilken üst desilleri BOŞ bırakır (n=11 → D7-D10 boş). Boş dilimin
        // tutarı gerçek 0 olduğundan pay %0 çıkar ve eski kod "Üst %30 → %0 ciro" YANLIŞ hükmünü basıyordu. Kapı `d.adet` ile.
        const ustDilimler256 = d256.dilimler.slice(-UST_DESIL_SAYISI);
        const ustDesillerDolu = ustDilimler256.every(d => d.adet > 0);
        // K21 — kullanıcı: "Tüm ciro" (payda). `d256.toplam` üst düzey `bilinmeyen` sayacını TAŞIR → tek tutarsız sipariş NaN → rozet yok.
        const ust30 = ustDesillerDolu
          ? yuzdeOrani(tamTutar(tutarBirlestir(...ustDilimler256.map(d => d.tutar))), tamTutar(d256.toplam))
          : null;
        const olcek256 = olcekReferansi(d256.dilimler.map(d => tutarSatiri(d.tutar)));
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{rc(currentLanguage).siparis_buyuklugu_desil_analizi}</h3>
              {ust30 !== null && (
                <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? `Üst %30 → %${ust30} ciro` : `Top 30% → ${ust30}% revenue`}</span>
              )}
            </div>
            <div className="flex items-end gap-1 h-20 mb-2">
              {d256.dilimler.map((d, i) => {
                const isTop = i >= DESIL_SAYISI - UST_DESIL_SAYISI;   // = eski `i >= 7` (D8-D10)
                return (
                  <div key={d.sira} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex items-end" style={{ height: '64px' }}>
                      <OlcekCubugu yon="dikey" oran={cubukOrani(tutarSatiri(d.tutar), olcek256)} renkSinifi={isTop ? 'bg-brand' : 'bg-blue-200'} koseSinifi="rounded-t-sm" dil={currentLanguage} />
                    </div>
                    <span className="text-[8px] text-gray-400">{`D${d.sira}`}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{rc(currentLanguage).d1_en_kucuk_siparisler_d10_en_buyuk_siparisler_k}</p>
            {!ustDesillerDolu && (
              <span className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? `${kapsanan256} sipariş ${DESIL_SAYISI} desile eşit bölünemedi; üst dilimler boş — üst %30 payı ölçülemedi` : `${kapsanan256} orders could not be split evenly into ${DESIL_SAYISI} deciles; top deciles are empty — top 30% share not measured`}</span>
            )}
            {/* Delta 2026-09-24 (hakem bulgu 10, AÇIK SORU — tek payda tanımı kullanıcı kararı): rozetin paydası `sadecePozitif`
                kümesi (tutarı > 0); P3 ve sayfa KPI'sı (`raporCirosu`) negatif/₺0 siparişi de toplar. Fark YALNIZ `kapsamDisi > 0`
                iken vardır → dipnot yalnız o zaman; tam veride sessiz (gürültü değil). */}
            {ust30 !== null && d256.kapsamDisi > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">{rc(currentLanguage).payda_tutari_pozitif_siparislerin_toplami_sifir_}</p>
            )}
            {/* İki sayaç AYRIK kümeler (bilinmeyen ≠ bilinen-ama-≤0) — çift sayım yok. */}
            <KapsamNotu sayaclar={{ tutarsiz: d256.bilinmeyen, kapsamDisi: d256.kapsamDisi }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).dagilima_dahil_degil} />
          </div>
        );
      })()}

      {/* ── P2 · Satış Momentum Skoru (Phase 260) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now260 = new Date();
        // Compare last 30 days vs prior 30 days across key metrics
        const last30 = new Date(now260); last30.setDate(last30.getDate() - MOMENTUM_PENCERE_GUN);
        const prev30Start = new Date(now260); prev30Start.setDate(prev30Start.getDate() - 2 * MOMENTUM_PENCERE_GUN);
        // K2 süzgeci `iptalsiz`ten (tek kural); `zamanDate` atmaz → eski try/catch kalktı.
        const filter260 = (start: Date, end: Date) => iptalsiz.filter(o => {
          const od = zamanDate(o.createdAt);
          if (!od) return false;
          return od >= start && od <= end;
        });
        const curr260 = filter260(last30, now260);
        const prev260 = filter260(prev30Start, last30);
        const ciroBu = toplaBilinen(curr260, raporSiparisi);
        const ciroOnce = toplaBilinen(prev260, raporSiparisi);
        // K4 — "kimlikle": adsız siparişler tek '—' müşterisine ÇÖKMEZ; `kimliksiz` NOT olur.
        const mBu = musteriOzeti(curr260, musteriSecenek);
        const mOnce = musteriOzeti(prev260, musteriSecenek);
        // Skor ve MoM buradan TÜRETİLİYOR → `tamTutar` (tek tutarsız sipariş → NaN → puan null, '—').
        // AOV İKİ değer taşır: EKRAN (boş pencerede ortalama TANIMSIZ → NaN → '—', `finansKpi.ortalamaSiparisTutari`
        // sözleşmesi; "avg ₺0" kalktı) ve SKOR girdisi (boş pencere = satış yok → 0, eski kod da 0 puanlıyordu; NaN
        // olsa tek eksik bileşen skoru '—' yapıp satışın ÇÖKTÜĞÜ ayı gizler). İnceleme + delta 2026-09-25.
        const aovEkran = (l: typeof curr260): number => Math.round(tamAov(ortalamaSiparisTutari(l)));
        const aovSkor = (l: typeof curr260): number => (l.length === 0 ? 0 : aovEkran(l));
        const metrics260: { label: string; curr: number; prev: number; skorCurr?: number; skorPrev?: number; tur: 'para' | 'adet' }[] = [
          { label: oc(currentLanguage).ciro, curr: tamTutar(ciroBu), prev: tamTutar(ciroOnce), tur: 'para' },
          { label: oc(currentLanguage).siparis_adedi, curr: curr260.length, prev: prev260.length, tur: 'adet' },
          { label: oc(currentLanguage).musteri_sayisi, curr: mBu.musteriler.length, prev: mOnce.musteriler.length, tur: 'adet' },
          // AOV: eski `Math.round(Σ/len)` YUVARLAMASI KORUNUR (PARİTE — merdiven yuvarlanmış AOV'leri karşılaştırıyordu;
          // ham 1000,4 → 1100,2 vakası 25 yerine 15 puan verirdi, hakem bulgu 3). `Math.round(NaN)` NaN kalır → kapı bozulmaz.
          // Pencerede sipariş varken tutarsız kayıt → `tamAov` NaN → ekranda da skorda da '—' (kapı AYNEN).
          { label: 'AOV', curr: aovEkran(curr260), prev: aovEkran(prev260), skorCurr: aovSkor(curr260), skorPrev: aovSkor(prev260), tur: 'para' },
        ];
        const scored = metrics260.map(m => {
          // Skor girdisi ekran değerinden ayrıysa (yalnız AOV) onu kullan; diğer bileşenlerde ikisi aynı sayıdır.
          const sc = m.skorCurr ?? m.curr;
          const sp = m.skorPrev ?? m.prev;
          return {
            ...m,
            // Taraflardan biri NaN ise `null` (kural İKİNCİ KEZ yazılmaz — `yuzdeOrani` payda ≤ 0'ı da eler). EKRAN
            // değerinden: boş pencereli AOV'de '↓ %100 MoM' basılmaz.
            growth: yuzdeOrani(m.curr - m.prev, m.prev),
            // Bilinmeyen tarafta puan YOK (uydurma 15 puan yedeği kalktı); `prev > 0` kapısı AYNEN, merdiven `esikBandi`de.
            puan: !Number.isFinite(sc) || !Number.isFinite(sp)
              ? null
              : sp > 0
                ? esikBandi(sc, buyumeBantlari(sp))
                : (sc > 0 ? MOMENTUM_TABANSIZ_PUAN : MOMENTUM_PUANLARI.dusus),
          };
        });
        const m260 = bilesikSkor(scored.map(m => ({ ad: m.label, puan: m.puan, agirlik: MOMENTUM_AGIRLIK })));
        // TEK çağrı: rozet metni, rozet rengi ve çubuk rengi buradan (ikinci merdiven kopyası YOK).
        const bant = esikBandi(m260.skor, MOMENTUM_BANTLARI);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{rc(currentLanguage).satis_momentum_skoru}</h3>
              <div className="flex items-center gap-2">
                {bant !== null && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${bant.rozetSinifi}`}>{currentLanguage === 'tr' ? bant.etiketTr : bant.etiketEn}</span>
                )}
                {/* Yuvarlama YALNIZ gösterimde; bant karşılaştırması ham `m260.skor` üzerinde. */}
                <span className={`text-2xl font-black ${bant === null ? 'text-gray-400' : bant.rozetSinifi.split(' ')[0]}`}>{m260.skor === null ? '—' : Math.round(m260.skor)}/{MOMENTUM_AZAMI_SKOR}</span>
              </div>
            </div>
            {m260.eksik.length > 0 && (
              <p className="text-[11px] text-amber-600 mb-3">{currentLanguage === 'tr' ? `${m260.kullanilan}/${m260.toplam} bileşen ölçüldü; hesaplanamayan: ${m260.eksik.join(', ')}` : `${m260.kullanilan}/${m260.toplam} components measured; not computable: ${m260.eksik.join(', ')}`}</p>
            )}
            {/* `OlcekCubugu.oran` YÜZDEDİR: skor doğrudan geçirilmez; `null` → taralı "bilinmiyor" (eski `width: "null%"`). */}
            <div className="mb-4">
              <OlcekCubugu oran={m260.skor === null ? null : oranYuzde(m260.skor, MOMENTUM_AZAMI_SKOR)} kalinlik="h-3" renkSinifi={bant?.cubukSinifi} dil={currentLanguage} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {scored.map(m => (
                <div key={m.label} className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-500 font-medium mb-1">{m.label}</p>
                  {/* PARA → `fmtAna` (kart `revenueCurrency`yi dinler); ADET → yerel sayı. Eski kod adedi ₺ ile basıyordu. */}
                  <p className="text-lg font-black text-gray-800">{m.tur === 'para' ? (m.curr > 1000 ? fmtAna(m.curr, 'K', 0) : fmtAna(m.curr)) : m.curr.toLocaleString(yerel)}</p>
                  {m.growth !== null && (
                    <p className={`text-[10px] font-bold ${m.growth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {m.growth >= 0 ? '↑' : '↓'} %{Math.abs(m.growth)} MoM
                    </p>
                  )}
                </div>
              ))}
            </div>
            {/* İki pencere AYRIK küme → sayaçların toplamı çift sayım DEĞİL. AOV'nin sayacı aynı kümeden çıkar — ayrıca basılmaz. */}
            <KapsamNotu sayaclar={{ tutarsiz: ciroBu.bilinmeyen + ciroOnce.bilinmeyen, kimliksiz: mBu.kimliksiz + mOnce.kimliksiz }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).skora_girmedi} />
          </div>
        );
      })()}

      {/* ── P3 · Sipariş Büyüklüğü Dilimleri (Kuartil) — eski başlık 'Ciro Çeyreklik Analizi' (K28 adlandırma, delta bulgu 9) ── */}
      {reportsTab === 'genel' && iptalsiz.length >= KUARTIL_ASGARI_SIPARIS && (() => {
        // K2: eski kod `orders`ı ham okuyordu (iptaller dilimlere giriyordu). `sadecePozitif` VERİLMEZ (parite: her değer girer).
        // Eski `(a,b) => a.totalPrice - b.totalPrice` karşılaştırıcısı `undefined - undefined = NaN` ile sıralamayı rastgele bırakıyordu.
        // K28 (PLAN-v2 §2.1): bu panel sipariş BÜYÜKLÜĞÜ kuartilidir, takvim çeyreği DEĞİL — GB1 P156 aynı sekmede "Q3 2026"
        // takvim çeyreği basıyor; TR'de "Çeyrek" sözcüğü iki kavram için beş metinde geçiyordu. Ekran metni 'Dilim' + alt
        // başlıkta açık ayrım; EN'de 'Q4 (Top 25%)' ↔ 'Q4 2025' çakışması da 'Quartile 4' ile kalktı. Rakamlar DEĞİŞMEDİ.
        const q = siraliDilimler(iptalsiz, siparisTutari, KUARTIL_SAYISI, { bolme: 'taban' });
        const olcekQ = olcekReferansi(q.dilimler.map(d => tutarSatiri(d.tutar)));
        // K21 — "Tüm ciro": payda `q.toplam` (bilinmeyen sayacını taşır → tutarsız kayıt varken null → cümle basılmaz).
        const ustDilimPay = yuzdeOrani(tamTutar(q.dilimler[KUARTIL_SAYISI - 1].tutar), tamTutar(q.toplam));
        const etiketler = currentLanguage === 'tr'
          ? ['Dilim 1 (Alt %25)', 'Dilim 2 (%25–50)', 'Dilim 3 (%50–75)', 'Dilim 4 (Üst %25)']
          : ['Quartile 1 (Bottom 25%)', 'Quartile 2 (25–50%)', 'Quartile 3 (50–75%)', 'Quartile 4 (Top 25%)'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{rc(currentLanguage).siparis_buyuklugu_dilimleri_kuartil}</h3>
            <p className="text-xs text-gray-500 mb-4">{rc(currentLanguage).siparisler_siparis_degerine_gore_4_esit_dilime_b}</p>
            <div className="space-y-3">
              {q.dilimler.map((d, i) => (
                <div key={d.sira}>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span className="font-medium">{etiketler[i]}</span>
                    {/* Ortalama TÜRETMEdir: boş/tutarsız dilim → NaN → '—' ("avg ₺0" kalktı). */}
                    <span>{d.adet} {oc(currentLanguage).siparis} · {oc(currentLanguage).ort} {fmtAna(ortalamaSiparis(d.tutar, d.adet), 'full', 0)} · {oc(currentLanguage).toplam_3} {fmtAna(ekranTutari(d.tutar), 'full', 0)}</span>
                  </div>
                  <OlcekCubugu oran={cubukOrani(tutarSatiri(d.tutar), olcekQ)} renk={KUARTIL_RENKLERI[i]} kalinlik="h-5" dil={currentLanguage} />
                </div>
              ))}
            </div>
            {ustDilimPay !== null && (
              <p className="text-xs text-gray-400 mt-3">{currentLanguage === 'tr' ? `Üst dilim (en büyük %25 sipariş) toplam cironun %${ustDilimPay}'ini oluşturuyor` : `Top quartile (largest 25% of orders) drives ${ustDilimPay}% of total revenue`}</p>
            )}
            {/* `q.kapsamDisi` bu panelde her zaman 0 (`sadecePozitif` verilmedi) — nota KONMAZ. */}
            <KapsamNotu sayaclar={{ tutarsiz: q.bilinmeyen }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).dilimlere_dahil_degil} />
          </div>
        );
      })()}

      {/* ── P4 · Haftanın Gününe Göre Satış Hızı ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        // Gün adları GenelOzet P147 ile AYNI dizi — sayfada iki farklı gün adlandırması kalmasın.
        const dayLabels = currentLanguage === 'tr'
          ? ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
          : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        // MEVCUT yardımcı (GenelOzet P147 ile aynı sözleşme; ikinci gün-kovası fonksiyonu YAZILMADI). K2 burada uygulanıyor.
        const z4 = zamanKovalari(iptalsiz, 7, d => d.getDay(), { tarihSec: o => o.createdAt, tutarSec: siparisTutari });
        const tutarsiz4 = z4.kovalar.reduce((n, k) => n + k.ciro.bilinmeyen, 0);   // kovalar AYRIK → Σ çift saymaz
        // KAPI (delta 2026-09-24, hakem bulgu 15 — "gövde kapısı + not" kalıbı, P6/P13 gibi): gösterilecek şey YOK = hiç
        // bilinen pozitif ciro yok VE tutarsız sipariş de yok (eski `maxRev === 0` anlamı). Siparişler varken TÜMÜ tutarsızsa
        // panel '—' çubuklar + "N siparişin tutarı okunamadı" notuyla GÖRÜNÜR; eski hâli (not kapının ARKASINDA) sessizce
        // kayboluyor, kullanıcı "satış yok" okuyordu. "En iyi gün" yalnız aday varken.
        if (z4.enCokCiro === null && tutarsiz4 === 0) return null;
        const olcek4 = olcekReferansi(z4.kovalar.map(k => tutarSatiri(k.ciro)));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{rc(currentLanguage).haftanin_gunune_gore_satis_hizi}</h3>
            <p className="text-xs text-gray-500 mb-4">{rc(currentLanguage).haftanin_gunune_gore_ciro_ve_siparis_adedi}{z4.enCokCiro !== null && (<> — {rc(currentLanguage).en_iyi_gun}<span className="font-bold text-green-600">{dayLabels[z4.enCokCiro]}</span></>)}</p>
            <div className="flex items-end gap-2 h-28">
              {dayLabels.map((label, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600">{z4.kovalar[i].adet}</span>
                  <div className="w-full" style={{ height: '80px' }}>
                    <OlcekCubugu yon="dikey" oran={cubukOrani(tutarSatiri(z4.kovalar[i].ciro), olcek4)} renk={i === z4.enCokCiro ? '#f97316' : '#6366f1'} koseSinifi="rounded-t" dil={currentLanguage} />
                  </div>
                  <span className="text-[9px] text-gray-500 font-medium">{label}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 mt-2">
              {z4.kovalar.map((k, i) => {
                const e = ekranTutari(k.ciro);   // kısmi toplam; hiç bilinen yoksa NaN → `fmtAna` '—'
                return <div key={i} className="text-center text-[8px] text-gray-400">{e >= 1000 ? fmtAna(e, 'K', 0) : fmtAna(e)}</div>;
              })}
            </div>
            {/* Kovalar AYRIK → Σ bilinmeyen çift saymaz (`tutarsiz4` kapının önünde hesaplandı). */}
            <KapsamNotu sayaclar={{ tutarsiz: tutarsiz4, tarihsiz: z4.tarihsiz }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).gun_cirosuna_dahil_degil} />
          </div>
        );
      })()}

      {/* ── P5 · Order Density — Last 90 Days (sayaç paneli; para hesabı yok) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        // Süzgeç ÖNCE (parite: pencere dışı gün asla ızgarada değil), sayım `adetSay` (PLAN-v2 §5 sayaç kararı).
        const pencere90 = orders.filter(o => {
          const d = zamanDate(o.createdAt);
          return d !== null && Math.floor((now.getTime() - d.getTime()) / 86400000) <= YOGUNLUK_PENCERE_GUN;
        });
        const gunSayimi = adetSay(pencere90, o => gunAnahtari(o.createdAt));
        const days = Array.from({ length: YOGUNLUK_PENCERE_GUN }, (_, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() - (YOGUNLUK_PENCERE_GUN - 1 - i));
          return gunAnahtari(d) ?? '';   // geçerli `Date`te null dönmez — savunmacı
        });
        // ADET ölçeği: `undefined` (siparişsiz gün) yok sayılır, `, 1` sahte tabanı YOK.
        const olcek90 = sayacOlcegi(days.map(g => gunSayimi.sayilar.get(g)));
        const totalDaysWithOrders = days.filter(g => gunSayimi.sayilar.has(g)).length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Density — Last {YOGUNLUK_PENCERE_GUN} Days</h3>
            <p className="text-xs text-gray-500 mb-4">{totalDaysWithOrders} active days out of {YOGUNLUK_PENCERE_GUN}</p>
            <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${YOGUNLUK_SUTUN}, 1fr)` }}>
              {days.map(day => {
                const adet = gunSayimi.sayilar.get(day);
                const count = adet === undefined ? 0 : adet;   // ızgara günü var, siparişi yok → GERÇEK 0, "bilinmiyor" değil
                const yogunluk = olcek90 === null ? null : count / olcek90;
                return (
                  <div
                    key={day}
                    title={`${day}: ${count} orders`}
                    className="rounded-sm cursor-default"
                    style={{ height: '12px', background: count === 0 || yogunluk === null ? '#f3f4f6' : `rgba(239,68,68,${0.2 + yogunluk * 0.8})` }}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-[9px] text-gray-400">Less</span>
              {[0.1, 0.3, 0.5, 0.7, 1.0].map((v, i) => (
                <div key={i} className="w-3 h-3 rounded-sm" style={{ background: `rgba(239,68,68,${0.2 + v * 0.8})` }} />
              ))}
              <span className="text-[9px] text-gray-400">More</span>
            </div>
            {/* Süzgeç tarihi zaten çözdü → pratikte 0; sayaç 0 iken bileşen null döner (görünür fark yok). */}
            <KapsamNotu sayaclar={{ tarihsiz: gunSayimi.anahtarsiz }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {/* ── P6 · Zarar Eden Sipariş Uyarısı ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // K2: iptal edilmiş sipariş "zarar eden sipariş" listesinde durmaz. Kalemsizler SESSİZCE değil, SAYILARAK dışarıda.
        const kalemli = iptalsiz.filter(o => o.lineItems && o.lineItems.length > 0);
        const kalemsizSiparis = iptalsiz.length - kalemli.length;
        // Sipariş başına `brutMarjHesabi`: eski `itemCostTRY` çevrilemeyene 0 dönüyordu → maliyet düşük → marj POZİTİF →
        // gerçekten zarar eden sipariş listeye HİÇ GİRMİYORDU (yanlış negatif). `kartMaliyetiTL` `null` döner → brutKar NaN.
        const hesaplanan = kalemli.map(o => ({ o, m: brutMarjHesabi([o], kalemMaliyeti) }));
        const maliyetiBilinmeyenSiparis = hesaplanan.reduce((n, x) => n + x.m.maliyetTutar.bilinmeyen, 0);   // sipariş başına 0/1
        // SESSİZ ELEME YOK (hakem bulgu 5): kalemi olan ama TUTARI okunamayan sipariş `brutKar` NaN → listeye giremez; sayılmazsa
        // hiçbir yerde görünmezdi (panel 'kalemsiz 0 / maliyetsiz 0' ile temiz dururdu). `maliyetsiz` ile KESİŞEBİLİR —
        // `<KapsamNotu>` sayaçları TOPLAMAZ, ayrı cümle basar (P8 deseni).
        const tutariBilinmeyenSiparis = hesaplanan.reduce((n, x) => n + x.m.ciroTutar.bilinmeyen, 0);       // sipariş başına 0/1
        // K21 — kullanıcı 2026-09-24: "Tüm ciro" ("ilk N" paydası). PLAN-v2 §2.1 K21 çıpası bu siteyi AÇIKÇA sayar («GB3 :252
        // slice(0,6) (negatif marj)»); şartname :255 kesilmiş listeden toplam alıyordu → KARARLAR kazandı (delta bulgu 5/6).
        // Eski kod/ilk bağlama: ÖNCE `.slice(0, 6)`, SONRA toplam → 'toplam risk' aslında "en büyük 6 zararın toplamı"ydı
        // (9 × −₺10.000 → ekran ₺60.000, gerçek ₺90.000; kalan 3 sipariş ne listede ne notta). Şimdi: toplam KESİLMEMİŞ
        // kümeden, liste ayrıca `ZARAR_SATIR`a kesilir, sığmayanlar "+N sipariş daha" cümlesiyle sayılır.
        const zararliTumu = hesaplanan
          .filter(x => Number.isFinite(x.m.brutKar) && x.m.brutKar < 0)
          .sort((a, b) => sayiSirala(a.m.brutKar, b.m.brutKar));
        const zararlilar = zararliTumu.slice(0, ZARAR_SATIR);
        const listelenmeyenZararli = zararliTumu.length - zararlilar.length;
        // Liste boş AMA dışarıda kalan varsa panel NOT ile görünür; ikisi de 0 → null (eski davranış).
        if (zararliTumu.length === 0 && maliyetiBilinmeyenSiparis === 0 && tutariBilinmeyenSiparis === 0 && kalemsizSiparis === 0) return null;
        const zarar = toplaBilinen(zararliTumu, z => Math.abs(z.m.brutKar));   // süzgeç sonrası hepsi sonlu; TÜM zararlılar (K21)
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{rc(currentLanguage).zarar_eden_siparis_uyarisi}</h3>
            <p className="text-xs text-gray-500 mb-3">{currentLanguage === 'tr' ? `Maliyeti ciroyu aşan siparişler (${zararliTumu.length}) — toplam risk: ` : `Orders where cost > revenue (${zararliTumu.length}) — total exposure: `}{fmtAna(ekranTutari(zarar), 'full', 0)}</p>
            <div className="space-y-2">
              {zararlilar.map(z => (
                <div key={z.o.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-red-50">
                  <span className="font-medium text-gray-800 truncate w-32">{z.o.customerName?.trim() ? z.o.customerName : oc(currentLanguage).bilinmiyor}</span>
                  <span className="text-gray-500">{oc(currentLanguage).ciro}: {fmtAna(z.m.ciro, 'full', 0)}</span>
                  <span className="text-red-600 font-bold">{rc(currentLanguage).zarar}: {fmtAna(Math.abs(z.m.brutKar), 'full', 0)} ({yuzdeYaz(z.m.marj, 0, dil)})</span>
                </div>
              ))}
            </div>
            {listelenmeyenZararli > 0 && (
              <p className="text-[11px] text-gray-500 mt-2">{currentLanguage === 'tr' ? `+${listelenmeyenZararli} zarar eden sipariş daha (en büyük ${ZARAR_SATIR} zarar listelendi; toplam riske dâhil)` : `+${listelenmeyenZararli} more loss-making orders (largest ${ZARAR_SATIR} losses listed; included in total exposure)`}</p>
            )}
            <KapsamNotu sayaclar={{ tutarsiz: tutariBilinmeyenSiparis, maliyetsiz: maliyetiBilinmeyenSiparis, kalemsiz: kalemsizSiparis }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).zarar_taramasina_girmedi} />
          </div>
        );
      })()}

      {/* ── P7 · Multi-Currency Revenue (Last 30 Days) ── */}
      {reportsTab === 'genel' && exchangeRates && orders.length >= 5 && (() => {
        // UYDURMA KUR YOK (2026-08-26). Eskiden `|| 32` / `|| 35` vardi: 2024'ten
        // kalma sabit kurlarla "Multi-Currency Revenue" karti YANLIS rakam
        // basiyordu ve hemen altinda "Based on LIVE exchange rates" yaziyordu —
        // yani yanlis rakami dogru diye sunuyordu. Kartin TAMAMI kura bagli
        // oldugu icin dogru davranis kartı hic gostermemek.
        const usdRate = exchangeRates['USD'];
        const eurRate = exchangeRates['EUR'];
        if (!usdRate || !eurRate || !Number.isFinite(usdRate) || !Number.isFinite(eurRate) || usdRate <= 0 || eurRate <= 0) return null;
        const now = new Date();
        // K2: `iptalsiz` üzerinden (eski kod iptalleri de 30 günlük ciroya katıyordu).
        const last30 = iptalsiz.filter(o => {
          const d = zamanDate(o.createdAt);
          if (!d) return false;
          return (now.getTime() - d.getTime()) / 86400000 <= COKLU_KUR_PENCERE_GUN;
        });
        const ciro30 = toplaBilinen(last30, raporSiparisi);
        const gosterilen = ekranTutari(ciro30);
        // KAPI (delta 2026-09-24, hakem bulgu 15): bilinen SIFIR (30 günde sipariş yok / hepsi ₺0) → gösterilecek şey yok
        // (eski `totalTRY === 0` anlamı). TÜMÜ tutarsız (NaN) → panel '—' değerler + "N siparişin tutarı okunamadı"
        // notuyla GÖRÜNÜR; ilk bağlama NaN'ı da gizliyor, not kapının ARKASINDA kaldığı için eksiklik hiçbir yerde yazmıyordu.
        // Kapanış turu (2026-09-24, bulgu 3 — bulgu 15'in YARIM kalan dalı): `ekranTutari` bilinen ≥ 1 varsa KISMİ toplamı
        // döner → "1 numune ₺0 + 5 okunamayan" veride `gosterilen === 0` yine gizliyor, not yine kapının arkasındaydı
        // (kullanıcı "30 günde satış yok" okurdu). Gizleme YALNIZ "gerçekten anlatacak şey yok": bilinen toplam 0 VE
        // bilinmeyen 0 (P4 `enCokCiro === null && tutarsiz4 === 0` kalıbı). Bilinmeyen varsa kart ₺0 + not ile görünür.
        if (gosterilen === 0 && ciro30.bilinmeyen === 0) return null;
        // Çevrim YAZILMAZ: `tlYaz` → `kurCevir` tek kaynak. AOV TÜRETME (NaN → '—'; "avg $0/order" kalktı).
        const aov30 = tamAov(ortalamaSiparisTutari(last30));   // kısmi örneklemden "avg $…/order" TÜRETİLMEZ (hakem bulgu 4)
        // `oc().siparis` EN'de ÇOĞUL ('orders') → 'avg $500/orders' basıyordu (hakem bulgu 6); eski metin '/order'. Çift ortak
        // sözlükte BİREBİR YOK (EN tekil) → satır içi. TRY kutusu ("10 sipariş / 10 orders") ÇOĞUL — `oc` doğru, kalır.
        const siparisTekil = rc(currentLanguage).siparis;
        const kartlar = [
          { currency: '₺ TRY', value: paraYaz(gosterilen, { ondalik: 0 }), sub: `${last30.length} ${oc(currentLanguage).siparis}` },
          { currency: '$ USD', value: tlYaz(gosterilen, { birim: 'USD', rates: exchangeRates, ondalik: 0 }), sub: `${oc(currentLanguage).ort} ${tlYaz(aov30, { birim: 'USD', rates: exchangeRates, ondalik: 0 })}/${siparisTekil}` },
          { currency: '€ EUR', value: tlYaz(gosterilen, { birim: 'EUR', rates: exchangeRates, ondalik: 0 }), sub: `${oc(currentLanguage).ort} ${tlYaz(aov30, { birim: 'EUR', rates: exchangeRates, ondalik: 0 })}/${siparisTekil}` },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Multi-Currency Revenue (Last {COKLU_KUR_PENCERE_GUN} Days)</h3>
            <p className="text-xs text-gray-500 mb-4">Based on live exchange rates: 1 USD = {paraYaz(usdRate, { ondalik: 2 })} · 1 EUR = {paraYaz(eurRate, { ondalik: 2 })}</p>
            <div className="grid grid-cols-3 gap-4">
              {kartlar.map((c, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-xs text-gray-400 mb-1">{c.currency}</div>
                  {/* Değer METİN olarak gelir (`paraYaz`/`tlYaz`): elle sembol + sabit 'en' ayracı kalktı. */}
                  <div className="text-xl font-black text-gray-800">{c.value}</div>
                  <div className="text-[10px] text-gray-400 mt-1">{c.sub}</div>
                </div>
              ))}
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: ciro30.bilinmeyen }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).toplama_dahil_degil} />
          </div>
        );
      })()}

      {/* ── P8 · Kapsamlı Finansal Oranlar ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        // İPTALLER DIŞARIDA (2026-08-22 denetim bulgusu C6): bu blok `orders`ı
        // ham kullanıyordu — sayfanın ana ciro KPI'sı ve bu dosyadaki diğer 10+
        // hesap iptalleri dışlarken, buradaki finansal oran kartları (brüt marj,
        // stok devri, aylık ortalama ciro) iptal edilen siparişleri de sayıyordu.
        // Aynı sayfada iki farklı ciro tanımı = güvenilmez rapor. (6b: yerel süzgeç `iptalsiz`e indi — K2 tek kural.)
        const ciro8 = toplaBilinen(iptalsiz, raporSiparisi);
        const marj8 = brutMarjHesabi(iptalsiz, kalemMaliyeti);
        // Stok değeri: maliyeti çözülemeyen kart 0 DEĞİL, `bilinmeyen` (eski `itemCostTRY` 0'ları toplamı sessizce düşürüyordu).
        const stok8 = degerToplami(inventory, i => kartMaliyetiTL(i, exchangeRates));
        // K28 PARİTE: payda SABİT 12 KALIR (adlandırıldı + dipnot). Tek tutarsız sipariş varsa NaN → '—'.
        const aylar8 = aylikCiro(orders, ORTALAMA_CIRO_AY_SAYISI, now, { iptalHaric: true }, dil);
        const aylikToplam = tutarBirlestir(...aylar8.map(a => a.tutar));
        const aylikOrtalama = tamTutar(aylikToplam) / ORTALAMA_CIRO_AY_SAYISI;
        // Delta 2026-09-24 (hakem bulgu 3): `aylikCiro` tarihi çözülemeyen siparişi HİÇBİR kovaya koymaz ve BİLDİRMEZ
        // (kapalı imza; GB1 üst düzey `tarihsizSiparis` deseni) → 'Aylık Ortalama Ciro' onlarsız, aynı karttaki 'Brüt Kâr'
        // (tüm iptalsizler) onlarla — tek kartta iki küme, not yoktu. Sayaç KOVANIN kuralıyla: `ciroTarihi` (createdAt ??
        // syncedAt). (P9/P10 yalnız `createdAt` okur — iki tarih kuralı tek dosyada, açık soru A1.)
        const tarihsiz8 = iptalsiz.filter(o => ciroTarihi(o) === null).length;
        // Stok devir KAPISI mevcut yardımcıdan (maliyet bilinmiyor / kalemsiz sipariş / maliyetli sipariş yok / stok bilinmiyor
        // merdiveni ikinci kez YAZILMAZ); bölme tanımdan. `stokKapisi` (DIO) EKRANA BASILMAZ — sayfada ikinci DIO doğmasın (K14).
        const { dio: stokKapisi } = stokDevirGunuTutar(stok8, marj8, GUN_YIL);
        const stokTam = tamTutar(stok8), cogsTam = tamTutar(marj8.maliyetTutar);
        const devir = stokKapisi === null || !(stokTam > 0) ? null : cogsTam / stokTam;
        // Bilinmeyen (`null`/NaN) → NÖTR gri, hüküm YOK (eski kod `null`u KIRMIZI boyuyordu).
        const renkSec = (deger: number | null, iyi: (v: number) => boolean, orta: (v: number) => boolean): string =>
          deger === null || !Number.isFinite(deger) ? RENK_NOTR : iyi(deger) ? RENK_IYI : orta(deger) ? RENK_ORTA : RENK_KOTU;
        const stokDegeri = ekranTutari(stok8);
        // K14/DSO kullanıcı 2026-09-24: "Kaldır" — 'Est. DSO' kutusu SİLİNDİ (hesabı `stok / aylık ciro × 30` idi, alacak yoktu).
        const kutular8 = [
          // `marj8.marj` TAM SAYI döner → 1 ondalık HER ZAMAN ',0' basardı (sahte hassasiyet, hakem bulgu 2). Eski `toFixed(1)` paritesi başlıkta belgeli.
          { label: oc(currentLanguage).brut_marj, value: yuzdeYaz(marj8.marj, 0, dil), renk: renkSec(marj8.marj, v => v >= BRUT_MARJ_IYI, v => v >= BRUT_MARJ_ORTA) },
          { label: oc(currentLanguage).stok_devir_hizi, value: katYaz(devir, 1, dil), renk: renkSec(devir, v => v >= STOK_DEVRI_IYI, v => v >= STOK_DEVRI_ORTA) },
          { label: rc(currentLanguage).aylik_ortalama_ciro, value: fmtAna(aylikOrtalama, 'K', 0), renk: renkSec(aylikOrtalama, () => true, () => true) },
          { label: oc(currentLanguage).brut_kar, value: fmtAna(marj8.brutKar, 'K', 0), renk: renkSec(marj8.brutKar, v => v > 0, v => v >= 0) },
          { label: oc(currentLanguage).stok_degeri, value: fmtAna(stokDegeri, 'K', 0), renk: renkSec(stokDegeri, () => true, () => true) },
        ];
        // Stok tarafı notu: önce kur/birim ayrıntısı (`cevrilemeyenMesaji`), o yoksa düz sayaç (GenelOzet `stokBilinmeyenMetni` emsali).
        const stokMesaji = cevrilemeyenMesaji(cevrilemeyenler(inventory, exchangeRates), dil);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">{rc(currentLanguage).kapsamli_finansal_oranlar}</h3>
            <div className="grid grid-cols-3 gap-3">
              {kutular8.map((r, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-lg font-black" style={{ color: r.renk }}>{r.value}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{r.label}</div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? `Aylık ortalama ciro: son ${ORTALAMA_CIRO_AY_SAYISI} takvim ayı (sabit payda; tarihi çözülemeyen sipariş aya girmez) · Stok devir hızı: satılan mal maliyeti ÷ stok değeri (maliyeti çözülemeyen ya da kalemsiz sipariş varsa hesaplanmaz)` : `Avg monthly revenue: last ${ORTALAMA_CIRO_AY_SAYISI} calendar months (fixed denominator; orders with an unparseable date fall in no month) · Inventory turnover: COGS ÷ stock value (not computed while any order has unresolved cost or no line items)`}</p>
            {/* Sayaçlar TOPLANMAZ: `tutarsiz` / `maliyetsiz` / `tarihsiz` aynı siparişi gösterebilir, ayrı cümle olarak basılır. */}
            <KapsamNotu sayaclar={{ tutarsiz: ciro8.bilinmeyen, tarihsiz: tarihsiz8, maliyetsiz: marj8.maliyetTutar.bilinmeyen, kalemsiz: marj8.kapsamDisi }} birim="siparis" dil={currentLanguage} />
            {stokMesaji !== null
              ? <p className="text-[11px] text-amber-600 mt-2">{stokMesaji}</p>
              : <KapsamNotu sayaclar={{ maliyetsiz: stok8.bilinmeyen }} birim="urun" dil={currentLanguage} />}
          </div>
        );
      })()}

      {/* ── P9 · Gross Margin % — 12-Month Trend ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const aylik = Array.from({ length: MARJ_TREND_AY }, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (MARJ_TREND_AY - 1 - i), 1);
          const anahtar = ayAnahtari(d);   // ay anahtarı TEK KAYNAK (`aylikCiro`nun kuralı); elle `${y}-${padStart}` yok
          const label = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
          // iptaller marj trendine girmez (C6) — K2 tek kural: `iptalsiz`. Tarihi çözülemeyen sipariş hiçbir aya girmez.
          const ayinSiparisleri = anahtar === null ? [] : iptalsiz.filter(o => ayAnahtari(o.createdAt) === anahtar);
          return { label, m: brutMarjHesabi(ayinSiparisleri, kalemMaliyeti) };
        });
        // Delta 2026-09-24 (hakem bulgu 3): tarihi çözülemeyen sipariş hiçbir aya girmez — kovanın kuralı `ayAnahtari(createdAt)`
        // ile SAYILIR (P10 `tarihsizSiparis` ile aynı tanım; P8 `ciroTarihi` — açık soru A1). Aylar ayrık → çift sayım yok.
        const tarihsiz9 = iptalsiz.filter(o => ayAnahtari(o.createdAt) === null).length;
        // "Cirosu olan ay" = bilinen pozitif ciro YA DA tutarı okunamayan siparişi olan ay (delta bulgu 4): eski
        // `ekranTutari(...) > 0` süzgeci cirosu HİÇ bilinmeyen ayı (NaN > 0 → false) boş ay gibi düşürüyor, 12 aylık
        // ortalama o ay yokmuş gibi 11 aydan ÇIKIYORDU; kısmen bilinen ay ise giriyor ve '—' yapıyordu — aynı arıza
        // sınıfı, zıt sonuç. Meşru ₺0 ay (bilinen 0, bilinmeyen 0) yine dışarıda (parite).
        const ayOlculur = (t: Tutar): boolean => t.bilinmeyen > 0 || ekranTutari(t) > 0;
        // KAPI (delta bulgu 15, "gövde kapısı + not"): hiç ay cirolu değilse (bilinen de bilinmeyen de yok) → null; tümü
        // tutarsızsa panel '—' + notla GÖRÜNÜR.
        const olculen = aylik.filter(a => ayOlculur(a.m.toplamCiroTutar));
        if (olculen.length === 0) return null;
        // Ortalamaya giren ay, marjın KENDİ kümesiyle (kalemli siparişlerin cirosu `ciroTutar`) seçilir; panel görünürlüğü
        // yukarıda tüm ciroyla. Yalnız kalemsiz (Mikro türevi) siparişi olan ay marjsızdır ve KapsamNotu onu "marj hesabına
        // girmedi" diye sayar — 12 aylık ortalamayı '—' yapmamalı; karma aydaki kalemsiz sipariş de zaten dışarıda
        // (inceleme 2026-09-25). 12 aylık ortalama TÜRETMEdir: giren tek ay bile '—' ise ortalama '—'.
        const ortalamayaGiren = aylik.filter(a => ayOlculur(a.m.ciroTutar));
        const marjToplami = toplaBilinen(ortalamayaGiren, a => a.m.marj);
        const ortalamaMarj = tamTutar(marjToplami) / ortalamayaGiren.length;
        // Girdi ayların yuvarlanmış marjı (`brutMarjHesabi.marj`) → ortalama 1 ondalıkla basılmaz (hakem bulgu 2; eski `toFixed(1)`
        // HAM yüzdeydi, üç ay %33,3 → '33.3%', şimdi '33%'). Başlık 'bilinçli farklar' + açık soru (`marjHam`).
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Gross Margin % — {MARJ_TREND_AY}-Month Trend</h3>
            <p className="text-xs text-gray-500 mb-4">{oc(currentLanguage).ortalama}: {yuzdeYaz(Number.isFinite(ortalamaMarj) ? ortalamaMarj : null, 0, dil)} · {oc(currentLanguage).hedef}: {yuzdeYaz(MARJ_HEDEF, 0, dil)}</p>
            <div className="flex items-end gap-1 h-24">
              {aylik.map((a, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  {/* Her ay etiketli: negatif ay '-12%', verisiz ay '—' (eski kod negatif ayı ETİKETSİZ bırakıyordu). */}
                  <span className="text-[9px] text-gray-600">{yuzdeYaz(a.m.marj, 0, dil)}</span>
                  <div className="w-full" style={{ height: '80px' }}>
                    {/* YÜZDE serisi ÖLÇEKSİZ sabit 100 tabanlı (`cubuk.ts` kuralı); bileşen 100'de kırpar, `null`u taralı çizer.
                        Zarar eden ay (negatif) KIRMIZI, veri olmayan ay gri — artık aynı görünmüyorlar. */}
                    <OlcekCubugu yon="dikey" oran={a.m.marj} renk={a.m.marj === null ? '#e5e7eb' : a.m.marj >= BRUT_MARJ_IYI ? '#10b981' : a.m.marj >= BRUT_MARJ_ORTA ? '#f59e0b' : '#ef4444'} koseSinifi="rounded-t" dil={currentLanguage} />
                  </div>
                  <span className="text-[8px] text-gray-400">{a.label}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>≥{BRUT_MARJ_IYI}% {rc(currentLanguage).hedef}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>{BRUT_MARJ_ORTA}-{BRUT_MARJ_IYI}%</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span>{currentLanguage === 'tr' ? `%${BRUT_MARJ_ORTA} altı` : `below ${BRUT_MARJ_ORTA}%`}</span>
            </div>
            {/* Aylar AYRIK → Σ çift saymaz; `tarihsiz` hiçbir aya girmeyenler (ayrı küme). */}
            <KapsamNotu sayaclar={{ tutarsiz: aylik.reduce((n, a) => n + a.m.ciroTutar.bilinmeyen, 0), tarihsiz: tarihsiz9, maliyetsiz: aylik.reduce((n, a) => n + a.m.maliyetTutar.bilinmeyen, 0), kalemsiz: aylik.reduce((n, a) => n + a.m.kapsamDisi, 0) }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).marj_hesabina_girmedi} />
          </div>
        );
      })()}

      {/* ── P10 · Revenue Attribution Waterfall (MoM) ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const currMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        // İptaller gelir köprüsüne girmez (C6) — ana KPI ile aynı ciro tanımı (K2 tek kural: `iptalsiz`). Pencereler AYNEN (K28).
        const prevOrders = iptalsiz.filter(o => {
          const d = zamanDate(o.createdAt);
          if (!d) return false;
          return d >= prevMonth && d < currMonth;
        });
        const currOrders = iptalsiz.filter(o => {
          const d = zamanDate(o.createdAt);
          if (!d) return false;
          return d >= currMonth;
        });
        // Tarihi çözülemeyen sipariş eskiden SESSİZCE düşüyordu → BİR KEZ sayılır (iki süzgeçte ayrı ayrı değil — çift sayım).
        const tarihsizSiparis = iptalsiz.filter(o => zamanDate(o.createdAt) === null).length;
        if (prevOrders.length === 0 && currOrders.length === 0) return null;
        // K4 — "kimlikle": adı boş siparişler tek anahtara ÇÖKMÜYOR. `bu` ÖNCE (`donemKarsilastir` sırası; ters çağrı yeni/kaybedileni yer değiştirir).
        const oncekiOzet = musteriOzeti(prevOrders, musteriSecenek);
        const buOzet = musteriOzeti(currOrders, musteriSecenek);
        const k = ciroKopru(buOzet, oncekiOzet);
        // 6 satır: Retained İKİYE ayrıldı (büyüyen +, küçülen −); işaret YARDIMCIDAN gelir, çağıran `-` KOYMAZ; renk KALEM TÜRÜNDEN.
        const satirlar: { etiket: string; tutar: number; musteri: number | null; tur: keyof typeof KOPRU_RENGI }[] = [
          { etiket: oc(currentLanguage).gecen_ay, tutar: k.oncekiTaban, musteri: null, tur: 'taban' },
          { etiket: rc(currentLanguage).yeni_musteriler, tutar: k.yeni.tutar, musteri: k.yeni.musteri, tur: 'arti' },
          { etiket: rc(currentLanguage).buyuyen_musteriler, tutar: k.buyuyen.tutar, musteri: k.buyuyen.musteri, tur: 'arti' },
          { etiket: rc(currentLanguage).kuculen_musteriler, tutar: k.kuculen.tutar, musteri: k.kuculen.musteri, tur: 'eksi' },
          { etiket: rc(currentLanguage).kaybedilen_musteriler, tutar: k.kaybedilen.tutar, musteri: k.kaybedilen.musteri, tur: 'eksi' },
          { etiket: oc(currentLanguage).bu_ay, tutar: k.buTaban, musteri: null, tur: 'taban' },
        ];
        // Köprü `number` döndürür (`Tutar` değil) → `CubukSatiri` ELLE kurulur; kalem ya tam bilinir ya NaN'dır (`tutarsizSiparis: 0` dürüst).
        // NaN `sayiSirala` ile sona düşer, ölçek bilinen en büyük mutlak değer; sahte `, 1` tavanı kalktı.
        const olcek10 = olcekReferansi(satirlar.map(s => ({ ciro: Math.abs(s.tutar), tutarsizSiparis: 0 })));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue Attribution Waterfall (MoM)</h3>
            {/* `k.net` kalemler toplamıdır — `buTaban - oncekiTaban` olarak YENİDEN hesaplanmaz. */}
            <p className="text-xs text-gray-500 mb-1">{rc(currentLanguage).net_degisim}<span className={Number.isFinite(k.net) ? (k.net >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold') : 'text-gray-400 font-bold'}>{Number.isFinite(k.net) ? `${k.net >= 0 ? '+' : ''}${fmtAna(k.net, 'full', 0)}` : '—'}</span></p>
            {/* K28 dönem asimetrisi ADLANDIRILIR — oran uydurulmaz, kırpılmaz, pencere DEĞİŞMEZ. */}
            <p className="text-[10px] text-gray-400 mb-4">{rc(currentLanguage).gecen_ayin_tamami_bu_ay_bugune_kadar}</p>
            <div className="space-y-2">
              {satirlar.map((satir, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32" title={satir.musteri === null ? undefined : `${satir.musteri} ${oc(currentLanguage).musteri}`}>{satir.etiket}</span>
                  <div className="flex-1">
                    {/* NaN → `cubukOrani` null → taralı "bilinmiyor"; gerçek 0 boş çizilir. */}
                    <OlcekCubugu oran={cubukOrani({ ciro: Math.abs(satir.tutar), tutarsizSiparis: 0 }, olcek10)} renk={KOPRU_RENGI[satir.tur]} kalinlik="h-5" dil={currentLanguage} />
                  </div>
                  <span className="text-xs font-bold w-24 text-right" style={{ color: Number.isFinite(satir.tutar) ? KOPRU_RENGI[satir.tur] : RENK_NOTR }}>
                    {Number.isFinite(satir.tutar) ? `${satir.tur === 'arti' ? '+' : ''}${fmtAna(Math.abs(satir.tutar), 'full', 0)}` : '—'}
                  </span>
                </div>
              ))}
            </div>
            {/* İki ay AYRIK → `tutarsizSiparis`/`kimliksiz` çift sayım değil; `tutarsizMusteri` müşteri başına BİR kez (yardımcıda). */}
            <KapsamNotu sayaclar={{ tutarsiz: k.tutarsizSiparis, kimliksiz: k.kimliksiz, tarihsiz: tarihsizSiparis }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).kopruye_girmedi} />
            {/* `kapsamNotu`da `musteri` birimi YOK (kapsamNotu.ts:40) → elle cümle. */}
            {k.tutarsizMusteri > 0 && (
              <p className="text-[11px] text-amber-600 mt-1">{currentLanguage === 'tr' ? `${k.tutarsizMusteri} müşteri tutarı okunamadığı için köprüye girmedi; sayfadaki toplam ciro daha yüksek olabilir` : `${k.tutarsizMusteri} customers excluded from the bridge (amount unreadable); page revenue may be higher`}</p>
            )}
          </div>
        );
      })()}

      {/* ── P11 · İşletme Sermayesi Döngüsü (DSO/DIO/DPO/CCC) — K14 ile SİLİNDİ (kullanıcı 2026-09-19: "kaldır"; K14 listesi
          «2× CCC (GenelOzet vs GB3)»). Tek kart `genel/GenelOzet.tsx` Phase 185. Silinen blok uydurma sabit DSO=30 / DPO=30
          taşıyor, kalemsiz siparişi 0 COGS sayıyor ve aynı sayfada 365 günlük İKİNCİ bir DIO üretiyordu. ── */}

      {/* ── P12 · Phase 300 Milestone (özet sayaç kartı) ── */}
      {reportsTab === 'genel' && (() => {
        const totalOrders = orders.length;   // parite: sayfanın `totalOrders` KPI'sı da iptalleri sayıyor (K2 notu `useReportsData`da)
        const ciro12 = raporCirosu(orders);  // K2 — sayfanın ana ciro KPI'sıyla AYNI rakam (iptaller hariç)
        const totalInventoryItems = inventory.length;
        const totalEmployees = employees.length;
        const totalQuotations = quotations.length;
        const totalMovements = inventoryMovements.length;
        // K4 — "kimlikle". Küme TÜM siparişler (iptaller dâhil): "kaç farklı müşteriyle çalışıldı" ciro sorusu değildir.
        const ozet12 = musteriOzeti(orders, musteriSecenek);
        // DURUM tabanlı teslim oranı; durumu okunamayan sipariş PAYDADAN çıkar (`durumsuz`). K17 (`deliveredAt`) bu panelde uygulanmaz.
        const teslim12 = teslimatOrani(orders);
        return (
          <div className="apple-card p-6 border-2 border-brand">
            {/* K24 — kullanıcı 2026-09-19: "kalsın, hafızaya at sonra bakarız." Aşağıdaki geliştirici metinleri ERTELENDİ, DOKUNULMADI. */}
            <div className="flex items-center gap-3 mb-4">
              <div className="text-3xl">🎯</div>
              <div>
                <h3 className="font-black text-gray-800 text-lg">Phase 300 Milestone Reached!</h3>
                <p className="text-xs text-gray-500">300 analytics phases deployed — your live business intelligence dashboard</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: oc(currentLanguage).toplam_siparis, value: totalOrders.toLocaleString(yerel), icon: '📦' },
                { label: oc(currentLanguage).toplam_ciro, value: fmtAna(ekranTutari(ciro12), 'K', 0), icon: '💰' },
                { label: oc(currentLanguage).musteri_sayisi, value: ozet12.musteriler.length.toLocaleString(yerel), icon: '👥' },
                { label: rc(currentLanguage).teslimat_orani, value: yuzdeYaz(teslim12.oran, 0, dil), icon: '🚚' },
                { label: rc(currentLanguage).izlenen_sku, value: totalInventoryItems.toLocaleString(yerel), icon: '📋' },
                { label: oc(currentLanguage).aktif_calisan, value: totalEmployees.toLocaleString(yerel), icon: '👤' },
                { label: rc(currentLanguage).teklifler, value: totalQuotations.toLocaleString(yerel), icon: '📝' },
                { label: rc(currentLanguage).stok_hareketleri, value: totalMovements.toLocaleString(yerel), icon: '🔄' },
              ].map((s, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-lg">{s.icon}</div>
                  <div className="text-base font-black text-gray-800">{s.value}</div>
                  <div className="text-[9px] text-gray-400 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: ciro12.bilinmeyen, kimliksiz: ozet12.kimliksiz, kapsamDisi: teslim12.durumsuz }} birim="siparis" dil={currentLanguage} className="text-[11px] text-amber-600 mb-3" />
            {/* K24 — aynı kapsam: aşağıdaki iki geliştirici cümlesi de bu turda KALIR. */}
            <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-xl p-3 text-center">
              <p className="text-xs font-bold text-brand">300 phases · 5 dashboard tabs · Full ERP analytics coverage</p>
              <p className="text-[10px] text-gray-400 mt-1">Revenue · CRM · Inventory · Logistics · HR — all connected</p>
            </div>
          </div>
        );
      })()}

      {/* ── P13 · Ciro Mevsimsellik Endeksi ── */}
      {reportsTab === 'genel' && orders.length >= 12 && (() => {
        // MEVCUT yardımcı; K2 burada uygulanıyor. Takvim ayı kovası YILLARI TOPLAR — eski davranış, K28 paritesi.
        const z13 = zamanKovalari(iptalsiz, 12, d => d.getMonth(), { tarihSec: o => o.createdAt, tutarSec: siparisTutari });
        // `ZamanKovasi[]` verilir (`Tutar[]` DEĞİL — ay ortalaması `tamTutar(k.ciro) / k.adet` için `adet` gerekir).
        // `m.zirve` yardımcıdan gelir (beraberlikte İLK); çağıranda `indexOf` ile YENİDEN HESAPLANMAZ.
        const m = mevsimsellikEndeksi(z13.kovalar);
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        // ÖLÇEK işi (zirve seçimi DEĞİL) — K28 PARİTE + adlandırma (delta 2026-09-24, hakem bulgu 8): 1,0x = kabın yarısı,
        // `MEVSIMSELLIK_OLCEK_TAVANI` (2,0x) ve üstü tavana yapışır (eski `Math.min(80, s * 40)` px; `OlcekCubugu` 100'de
        // kırpar → aynı piksel). İlk bağlamanın "en büyük endekse göre dinamik" ölçeği (`sayacOlcegi(m.endeksler)`) grafik
        // ŞEKLİNİ değiştiriyordu: [3,0 · 1,0 · 0,5] eski 80/40/20 px, dinamik 80/27/13 px; "1,0x = sabit referans" da gitmişti.
        // PLAN-v2 §8 sıra 24 "parite + adlandırma" → geri alındı, sabit adlandırıldı ve lejandda yazılır.
        const olcek13 = MEVSIMSELLIK_OLCEK_TAVANI;
        const tutarsizSiparis13 = z13.kovalar.reduce((n, k) => n + k.ciro.bilinmeyen, 0);   // kovalar ayrık → çift sayım değil
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{rc(currentLanguage).ciro_mevsimsellik_endeksi}</h3>
            {/* `m.olculenAy === 0` GÖVDE kapısıdır — panel `return null` ile GİZLENMEZ, nedenini yazar (utils kalem 5). */}
            {m.olculenAy === 0 ? (
              <p className="text-xs text-gray-500 mb-2">{rc(currentLanguage).hicbir_ay_olculemedi}</p>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-4">{rc(currentLanguage).aylik_ortalama_genel_ortalama}{m.zirve !== null && (<> · {rc(currentLanguage).zirve}: <span className="font-bold text-green-600">{monthNames[m.zirve]}</span></>)}</p>
                <div className="flex items-end gap-1 h-24">
                  {m.endeksler.map((s, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[8px] text-gray-500">{katYaz(s, 1, dil)}</span>
                      <div className="w-full" style={{ height: '80px' }}>
                        {/* `s === null` → renk UYGULANMAZ (taralı "bilinmiyor"). */}
                        <OlcekCubugu yon="dikey" oran={s === null ? null : seriCubukOrani(s, olcek13)} renk={s === null ? undefined : s >= MEVSIMSELLIK_ZIRVE ? '#10b981' : s >= MEVSIMSELLIK_DIP ? '#3b82f6' : '#f59e0b'} koseSinifi="rounded-t" dil={currentLanguage} />
                      </div>
                      <span className="text-[8px] text-gray-400">{monthNames[i].slice(0, 1)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 mt-2 text-[10px]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>{rc(currentLanguage).zirve_2} (≥{katYaz(MEVSIMSELLIK_ZIRVE, 1, dil)})</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block"></span>Normal</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>{rc(currentLanguage).dip} ({'<'}{katYaz(MEVSIMSELLIK_DIP, 1, dil)})</span>
                  {/* K20/K28 dipnot: çubuk boyu `MEVSIMSELLIK_OLCEK_TAVANI`da kırpılır — endeks rakamı değil. */}
                  <span className="text-gray-400">{currentLanguage === 'tr' ? `çubuk tavanı ${katYaz(MEVSIMSELLIK_OLCEK_TAVANI, 1, dil)}` : `bar cap ${katYaz(MEVSIMSELLIK_OLCEK_TAVANI, 1, dil)}`}</span>
                </div>
              </>
            )}
            {/* İki not, iki birim — KARIŞTIRILMAZ: (a) SİPARİŞ sayaçları `<KapsamNotu>`; (b) AY sayaçları elle cümle (`ay` birimi yok). */}
            <KapsamNotu sayaclar={{ tutarsiz: tutarsizSiparis13, tarihsiz: z13.tarihsiz }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).endekse_dahil_degil} />
            <p className="text-[11px] text-gray-500 mt-1">{currentLanguage === 'tr'
              ? `${m.olculenAy}/${z13.kovalar.length} ay ölçüldü` + (m.tutarsizAy > 0 ? `; ${m.tutarsizAy} ay tutarı okunamayan sipariş içerdiği için endekse girmedi` : '') + (m.verisizAy > 0 ? `; ${m.verisizAy} ay verisiz` : '')
              : `${m.olculenAy}/${z13.kovalar.length} months measured` + (m.tutarsizAy > 0 ? `; ${m.tutarsizAy} month(s) excluded from the index because an order amount was unreadable` : '') + (m.verisizAy > 0 ? `; ${m.verisizAy} month(s) without data` : '')}</p>
          </div>
        );
      })()}
    </>
  );
}
