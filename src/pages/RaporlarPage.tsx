import React, { useState, useMemo } from 'react';
import { zamanMs, zamanDate, ayAnahtari, bugunAnahtari, tarihYaz } from '../utils/zaman';
import { paraYaz, kisaTutar } from '../utils/currency';
import { pdfBaslik, pdfTabloStili } from '../utils/pdfTheme';
import { registerTurkishFont } from '../utils/pdfFont';
import { useMikroFaturalar, useCariAdMap } from '../hooks/useMikroFaturalar';
import { Download, FileText } from 'lucide-react';
import UnauthorizedView from '../components/UnauthorizedView';
import ReadOnlyBanner from '../components/ReadOnlyBanner';
import ReportsDashboard from '../components/ReportsDashboard';
const AnalyticsPanel = React.lazy(() => import('../components/AnalyticsPanel'));
import DemandForecastPanel from '../components/DemandForecastPanel';
import {
  exportOrdersCSV,
  exportLeadsCSV,
  exportInventoryCSV,
  exportMonthlySummaryCSV,
  type MonthlySummaryRow,
} from '../utils/export';
import type { Order, Lead, InventoryItem, Employee, Quotation, InventoryMovement } from '../types';
import { oc } from '../i18n/ortak';
import { ekranTutari, tamTutar, sayiSirala } from '../utils/para';
import { siparisTutari } from '../utils/siparis';
import { trendOzeti, hedefOrani } from '../utils/muhasebe/kpiTrend';
// ── Faz 3 6a: rapor veri katmanı (saf, testli yardımcılar) ───────────────────
import { yuzdeYaz } from '../utils/rapor/bicim';
import { kapsamNotu } from '../utils/rapor/kapsamNotu';
import { musteriOzeti, ciroSirali, leadCariKoduHaritasi } from '../utils/rapor/musteri';
import { talepKartCozucu, urunTalebi, tukenmeSatirlari, oneriAdedi } from '../utils/rapor/stokTalep';
import { sayacOlcegi, seriCubukOrani } from '../utils/pano/cubuk';
import { ayKpisi } from '../utils/rapor/ayKpisi';
import { satisTahmini, TAHMIN_GECMIS_AY } from '../utils/muhasebe/faturaTakipTahmin';
import { raporCirosu } from '../utils/pano/raporVeriKatmani';
import { aylikCiro, olcekTavani } from '../utils/pano/ciroDonem';
import { durumDagilimi, PANO_DURUMLARI } from '../utils/pano/stokSevkiyat';
import { adetYaz } from '../utils/muhasebe/depoDeger';
import { yuzdeOrani, stokDurumu, stokSeviyesi, stokEsigi, adayDonusumOrani } from '../utils/pano/finansKpi';
import { oranYuzde } from '../utils/siparisler/lojistikKpi';
import { hedefGirdisi, hedefOnDoldur } from '../utils/pano/hedefButce';
import { KapsamNotu, OlcekCubugu } from '../components/reports/ReportKit';
import { useToast } from '../components/Toast';

/**
 * K20 — kullanıcı: "ok kalsın". Koda gömülü sabitler ADLANDIRILIR, DEĞERLERİ DEĞİŞMEZ.
 * (Phase 619 önerisi: kapsama × 2 adet önerilir, ≤ 7 gün kalan kırmızı, en fazla 8 satır;
 * Phase 63 PDF'i en fazla 10 kritik stok satırı basar.)
 */
const ONERI_KAPSAMA_KATSAYISI = 2;
const ONERI_ACIL_GUN = 7;
const ONERI_SATIR_SAYISI = 8;
const PDF_KRITIK_STOK_SATIR = 10;

// `seriCubukOrani` (BİLİNEN sıfır ↔ BİLİNMİYOR ayrımı) BU DOSYADAN `utils/pano/cubuk.ts`e
// TAŞINDI (2026-09-22 düzeltme turu). Sayfa-içi `const` olduğu ve dışa açılmadığı için hiçbir
// test onu göremiyordu: `if (olcek === null) return 0;` satırını `return null;` yapan mutasyon
// tek bir testi bile kırmadan hayatta kalıyordu. Kural artık ölçek ailesinin evinde ve testli;
// gerekçesi oradaki JSDoc'ta (kodla BİRLİKTE taşındı).

type RecurringOrder = {
  id: string; templateName: string; customerName: string; totalPrice: number;
  frequency: 'weekly' | 'monthly' | 'quarterly'; nextDue: string; active: boolean;
};

/**
 * KPI hedefleri. Alanlar `number | null`: boş kutu hedefi 0 YAPMAZ, SİLER — 0 "hedef sıfır"
 * demektir ve gerçekleşme oranını %∞ gösterirdi. `null` = hedef girilmemiş → rozet/çubuk '—'.
 * Tip `export`: `App.tsx` state'i bu tiple kurar (yoksa `setP570Targets` prop'u
 * `strictFunctionTypes` altında derlenmez).
 */
export type P570Targets = { revenue: number | null; orders: number | null; avgOrderVal: number | null; leadConv: number | null };

interface Props {
  canAccess: (tab: string) => boolean;
  hasFullAccess: (tab: string) => boolean;
  currentLanguage: 'tr' | 'en';
  currentT: Record<string, string>;
  orders: Order[];
  leads: Lead[];
  inventory: InventoryItem[];
  exchangeRates: Record<string, number> | null;
  userRole: string;
  employees: Employee[];
  appQuotations: Quotation[];
  inventoryMovements: InventoryMovement[];
  recurringOrders: RecurringOrder[];
  appReportsTab: 'genel' | 'crm' | 'envanter' | 'lojistik' | 'ik' | 'urunler' | 'analitik';
  setAppReportsTab: (tab: 'genel' | 'crm' | 'envanter' | 'lojistik' | 'ik' | 'urunler' | 'analitik') => void;
  onNavigate: (tab: string) => void;
  /** Rapor kartından CRM→Müşteriler'e in (ada filtreli) — 2026-08-31. */
  onMusteriAc: (ad: string) => void;
  p570Targets: P570Targets;
  setP570Targets: React.Dispatch<React.SetStateAction<P570Targets>>;
  fmtKpi: (v: number, fmt?: 'full' | 'K', decimals?: number) => string;
}

export default function RaporlarPage({
  canAccess = () => true, hasFullAccess = () => false, currentLanguage, currentT,
  orders: ordersProp = [], leads = [], inventory = [], userRole, employees = [],
  appQuotations = [], inventoryMovements = [], recurringOrders = [], exchangeRates,
  appReportsTab, setAppReportsTab, onNavigate, onMusteriAc,
  p570Targets, setP570Targets, fmtKpi,
}: Props) {
  // 'inventory' birlik tipinden ÇIKTI: düğmesi hiç yoktu (ölü dal, görünür etki 0).
  const [p603TrendMetric, setP603TrendMetric] = useState<'revenue' | 'orders' | 'leads'>('revenue');
  const [p603TrendPeriod, setP603TrendPeriod] = useState<'3m' | '6m' | '12m'>('6m');
  // Kutu boşaltılınca kapsama günü SİLİNİR (null) — 0 gün "sıfır günlük talep" demek olurdu.
  const [p619MinCoverage, setP619MinCoverage] = useState<number | null>(30);
  // Hedef/kapsama kutularının TASLAK metni (Pano deseni, DashboardPage.tsx:881-912): anahtar
  // VARSA o kutu düzenleniyor demektir; `onChange` sayısal state'e YAZMAZ, kaydet kapısı yazar.
  const [p570Taslak, setP570Taslak] = useState<Partial<Record<keyof P570Targets, string>>>({});
  const [p619Taslak, setP619Taslak] = useState<string | null>(null);
  // Sayfa `toast` prop'u ALMIYOR (Props 36-58) → sağlayıcı hook'u. `ToastProvider` App.tsx:600'de
  // `<AppContent/>`'i sarıyor, RaporlarPage onun altında render ediliyor (App.tsx:5113) — ölçüldü.
  const toast = useToast();
  const [p620Horizon, setP620Horizon] = useState<'1m' | '3m' | '6m'>('3m');
  const [p631View, setP631View] = useState<'pipeline' | 'cycle-time' | 'bottleneck'>('pipeline');

  // ── Mikro satış faturaları → pseudo-sipariş ─────────────────────────────────
  // Cetpa orders BOŞ (satışlar Mikro'da fatura olarak) → tüm Raporlar sekmeleri
  // ₺0/0 gösteriyordu. Mikro GİDEN faturaları (satış) pseudo-sipariş olarak
  // eklenir; useReportsData'ya `orders` merged geçtiği için 6 sekme de canlanır.
  //
  // Yalnız GİDEN (satış — tie-out DOĞRULANMIŞ: 2026 satış 9,75M ≈ portal 9,36M).
  // ALIŞ/cinsi=6 CİRO OLARAK DOĞRULANMADI → bilerek dışarıda.
  // CARİ YIL filtresi: mikroFaturalar 2020+ tüm yılları tutar; hepsini toplamak
  // all-time ciro balonu yaratır (kullanıcı "132M hatalı" travması). Cari yıl
  // tied-out ve beklenen değer. (Not: Raporlar'ın timeRange seçicisi bu KPI'ları
  // zaten scope'lamıyor — mevcut hook davranışı; ayrı iş.)
  // Eşleme ortak hook'ta (useMikroFaturalar) — AccountingModule/MuhasebePage ile tek kaynak.
  const mikroFaturalar = useMikroFaturalar(!!userRole);
  const cariAdMap = useCariAdMap(leads as unknown as Array<Record<string, unknown>>);
  // K4 — kullanıcı: "Aynı müşterinin Cetpa kaydı ile Mikro carisi `mikroCariKod` bağıyla TEK
  // müşteri sayılır." → bağ = lead.id → lead.mikroCariKod. `useCariAdMap`in TERS yönlü kardeşi
  // (o: kod→ad). Harita TEK yerde üretilir (`rapor/musteri`); PDF, Aylık Özet CSV ve
  // `ReportsDashboard` AYNI haritayı alır — yoksa aynı firma iki ayrı satır olur (gerileme).
  const leadCariKodu = useMemo(() => leadCariKoduHaritasi(leads), [leads]);

  /**
   * Bu sayfanın müşteri gruplaması — seçenek nesnesi TEK yerde kurulur (2026-09-20 hakem turu).
   * "Yarım düzeltme sınıfı": PDF (Phase 63) ve Aylık Özet CSV seçenekleri ayrı ayrı yazıyordu;
   * birinden `leadCariKodu` düşerse K4 bağı YALNIZ ORADA kopar ve aynı firma Cetpa'da bir ay,
   * Mikro'da başka ay "Yeni Müşteri" +1 alır — diğer yüzey doğru göründüğü için fark edilmez.
   * Artık bağ noktası bir tane: kopması TEK yerde olur, iki çağıran da aynı kümeyi görür.
   * Süzgeç (iptal dahil/hariç) ÇAĞIRANDA kalır — `musteriOzeti` sipariş durumu OKUMAZ ve
   * iptali `tutarSec` içinde NaN'a çevirmek YASAKTIR (bilinmeyen tutar sayacını yalancı yapar).
   */
  const raporMusteriOzeti = (liste: readonly Order[]) => musteriOzeti(
    liste,
    { tutarSec: siparisTutari, tarihSec: o => zamanMs(o.createdAt), leadCariKodu },
  );

  // Cetpa siparişi + Mikro satış. GİDEN (satış) + cari yıl; mükerrer eleme: Cetpa
  // siparişi Mikro'ya gönderilince evrak no `mikroEvrakNo`ya yazılır, tekrar sayma.
  const orders = useMemo<Order[]>(() => {
    const cariYil = String(new Date().getFullYear());
    const cetpaEvrak = new Set(
      ordersProp.map(o => String((o as unknown as { mikroEvrakNo?: string }).mikroEvrakNo ?? '').trim()).filter(Boolean),
    );
    // Faturadan TÜRETİLEN siparişler (source:'mikro-fatura', 2026-09-01) aynı
    // faturanın kendisidir — sentetik mikroOrders kopyası eklenmesin diye
    // evrak anahtarları (faturaNo = seri-sira) eleme setine girer. Türetilmiş
    // sipariş kalemli/tarihli olduğundan sentetiğe tercih edilir.
    for (const o of ordersProp) {
      const ev = (o as unknown as { source?: string; mikroEvrak?: { seri?: string; sira?: string } });
      if (ev.source === 'mikro-fatura' && ev.mikroEvrak) {
        const k = [String(ev.mikroEvrak.seri ?? '').trim(), String(ev.mikroEvrak.sira ?? '').trim()]
          .filter(v => v !== '').join('-');
        if (k) cetpaEvrak.add(k);
      }
    }
    const mikroOrders = mikroFaturalar
      .filter(f => f.yon === 'giden' && f.tarih.startsWith(cariYil) && !cetpaEvrak.has(f.faturaNo))
      .map(f => ({
        id: `mikro-${f.id}`,
        customerName: cariAdMap.get(f.cariKod) || f.cariKod || '—',
        // K4 → "kimlikle": kimlik = müşteri kaydı ya da Mikro cari kodu; ad yalnız kimliği
        // olmayan siparişte yedek. Kod bugüne kadar YALNIZ adın içinde eriyordu; artık kimlik
        // alanı olarak da taşınır ki gruplama anahtarı `cari:<kod>` olsun (ad DEĞİL).
        // Boş kod alan olarak YAZILMAZ — '' kimlik değildir. (`f.cariKod` kaynakta zaten
        // trim'li string: useMikroFaturalar.ts:67.)
        ...(f.cariKod ? { mikroCariKod: f.cariKod } : {}),
        status: 'Delivered',
        totalPrice: f.tutar,
        totalAmount: f.tutar,
        createdAt: f.tarih,
        syncedAt: f.tarih,
        // KAYNAK ETIKETI ZORUNLU (2026-09-04 denetimi): bu sentetik kayitlarda
        // `paid` ve `lineItems` YOKTUR. Etiket olmadan `odemeTakipli()` testinden
        // geciyorlar ve tahsilat yuzeylerinde "odenmemis alacak", marj kartlarinda
        // "maliyeti 0" sayiliyorlardi. Etiket, tuketicilerin bu kaydin neyi
        // BILMEDIGINI anlamasini saglar.
        source: 'mikro-fatura',
      })) as unknown as Order[];
    return [...ordersProp, ...mikroOrders];
  }, [ordersProp, mikroFaturalar, cariAdMap]);

  // P619 talep eşlemesi: kalem → stok kartı (kimlik/sku, sonra kimlik/ad). Hook ÜST düzeyde ve
  // aşağıdaki erken dönüşten ÖNCE (IIFE içinde hook çağrılamaz).
  const kartSec619 = useMemo(() => talepKartCozucu(inventory), [inventory]);

  if (!canAccess('reports')) {
    return <UnauthorizedView currentLanguage={currentLanguage} tab={oc(currentLanguage).raporlar} />;
  }

  return (
    <>
      {!hasFullAccess('reports') && <ReadOnlyBanner currentLanguage={currentLanguage} />}

      {/* ── Export toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Dışa Aktar:' : 'Export:'}</span>
        <button onClick={() => exportOrdersCSV(orders, currentLanguage)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold transition-colors">
          <Download className="w-3.5 h-3.5" /> {oc(currentLanguage).siparisler}
        </button>
        <button onClick={() => exportLeadsCSV(leads, currentLanguage)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold transition-colors">
          <Download className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Müşteriler' : 'Leads'}
        </button>
        <button onClick={() => exportInventoryCSV(inventory, currentLanguage)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold transition-colors">
          <Download className="w-3.5 h-3.5" /> {oc(currentLanguage).envanter}
        </button>
        {/* Phase 63: Full Report PDF */}
        <button
          onClick={() => {
            import('jspdf').then(({ jsPDF }) => {
              import('jspdf-autotable').then(async ({ default: autoTable }) => {
                const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                await registerTurkishFont(pdf);
                const tr63 = currentLanguage === 'tr';
                const today63 = tarihYaz(new Date(), undefined, tr63 ? 'tr' : 'en');
                // Kapak — ORTAK tema (src/utils/pdfTheme.ts). 2026-08-21'e kadar
                // LACİVERT (#1a3a5c) idi; teklif/sipariş marka kırmızısıydı.
                pdfBaslik(pdf, {
                  belgeAdi: tr63 ? 'YÖNETİM RAPORU' : 'MANAGEMENT REPORT',
                  meta: today63,
                });
                pdf.setTextColor(0, 0, 0);
                // Section 1: Orders
                pdf.setFontSize(12); pdf.setFont('Roboto', 'bold');
                pdf.text(tr63 ? 'Sipariş Özeti' : 'Order Summary', 14, 52);
                // Tutarı okunamayan sipariş/fatura 0 SAYILMAZ, SAYILIR — yönetim raporunda
                // sahte ₺0 hem ciroyu hem müşteri paylarını sessizce kaydırıyordu.
                // K2 → "hayır": iptaller ciroya GİRMEZ — tek kural `raporVeriKatmani.raporCirosu`.
                const ciro63 = raporCirosu(orders);
                const totalRev = ekranTutari(ciro63);
                const payPaydasi = tamTutar(ciro63);   // pay/oran TÜRETİLEN sayıdır: bir kayıt eksikse '—'
                // Durum tablosu ADET dağılımıdır, ciro DEĞİL → `Cancelled` satırı ve `orders.length`
                // paydası KALIR (K2 kapsamı dışı). Liste `stokSevkiyat.PANO_DURUMLARI` — kopya sabit yok.
                autoTable(pdf, {
                  ...pdfTabloStili(),
                  startY: 56,
                  head: [[oc(tr63).durum, tr63 ? 'Adet' : 'Count', tr63 ? 'Oran' : 'Share']],
                  body: PANO_DURUMLARI.map(s => [
                    s, orders.filter(o => o.status === s).length,
                    // Sipariş yokken '0%' sahte kesinliktir → '—' (yuzdeOrani payda 0'da null döner).
                    yuzdeYaz(yuzdeOrani(orders.filter(o => o.status === s).length, orders.length), 0, tr63 ? 'tr' : 'en'),
                  ]),
                  styles: { font: 'Roboto', fontSize: 9 },
                });
                // Section 2: Top Customers
                const finalY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
                pdf.setFontSize(12); pdf.setFont('Roboto', 'bold');
                pdf.text(oc(tr63).en_yuksek_cirolu_musteriler, 14, finalY);
                // K4 → "kimlikle": kimlik = müşteri kaydı (leadId, + `leadCariKodu` bağı) ya da Mikro
                // cari kodu; AD yalnız kimliği olmayan siparişte yedek; ikisi de yoksa "kimliksiz N
                // sipariş" NOTU (satır değil). K2 → "hayır": girdi iptal OLMAYAN siparişler — pay ile
                // payda AYNI kümeden (süzgeç `raporCirosu`'nunkiyle birebir). Süzgeç ÇAĞIRANDA durur:
                // `musteriOzeti` durum okumaz, iptali `tutarSec` içinde NaN'a çevirmek YASAK.
                const ozet63 = raporMusteriOzeti(orders.filter(o => o.status !== 'Cancelled'));
                const kimliksiz63 = ozet63.kimliksiz;
                // Sıralamada bilinmeyen SONA (para.sayiSirala) — `b - a` bilinmeyeni ₺0 gibi ortaya
                // diziyordu. Kural `rapor/musteri.ciroSirali`'de TEK yerde (kopya sıralama yazılmaz).
                const top5 = ciroSirali(ozet63.musteriler).slice(0, 5);
                autoTable(pdf, {
                  ...pdfTabloStili(),
                  startY: finalY + 4,
                  head: [[oc(tr63).musteri, oc(tr63).ciro, oc(tr63).pay]],
                  body: top5.map(m => {
                    const t = m.ciro;
                    // Görünen etiket, `useReportsData.topCustomers` ile TEK kural: adsız `cari` satırı
                    // KODU gösterir, adsız `kayit` satırında lead id'si BASILMAZ → '—'.
                    const ad = m.ad ?? (m.tur === 'cari' ? m.kimlik : '—');
                    return [
                      ad + (t.bilinmeyen > 0 ? (tr63 ? ` (${t.bilinmeyen} tutarsız)` : ` (${t.bilinmeyen} unpriced)`) : ''),
                      paraYaz(ekranTutari(t), { ondalik: 0 }),
                      // Pay: payda ya da payın kendisi bilinmiyorsa '—' — "%0 pay" basılmaz.
                      Number.isFinite(payPaydasi) && payPaydasi > 0 && t.bilinmeyen === 0
                        ? `${Math.round((t.toplam / payPaydasi) * 100)}%`
                        : '—',
                    ];
                  }),
                  styles: { font: 'Roboto', fontSize: 9 },
                });
                // İKİ NOT AYNI SATIRA BASILIYORDU (2026-09-20 hakem turu): `pdf.text` autoTable'ın
                // `lastAutoTable`ını İLERLETMEZ, yani her iki not da aynı tablonun `finalY + 4`'ünü
                // okuyordu — kimliksiz sipariş VE tutarı okunamayan kayıt birlikte varken iki satır
                // üst üste binip İKİSİ DE okunmaz oluyordu. Oysa bu notlar dürüstlük sözleşmesinin
                // ta kendisi ("N kayıt tutarsız / N sipariş kimliksiz"). Artık Y koşuyor; bölüm
                // başlığı da notların ALTINDAN başlar (`Math.max`), yoksa ikinci not başlığa girerdi.
                const notSatirAraligi = 4;
                let notY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + notSatirAraligi;
                const notYaz = (metin: string) => {
                  pdf.setFontSize(8); pdf.setFont('Roboto', 'normal');
                  pdf.text(metin, 14, notY);
                  notY += notSatirAraligi;
                };
                if (kimliksiz63 > 0) {
                  notYaz(
                    tr63 ? `Not: ${kimliksiz63} siparişin müşteri kimliği yok — müşteri tablosuna girmedi (toplam ciroya dahil).`
                         : `Note: ${kimliksiz63} order(s) have no customer identity — left out of the customer table (included in total revenue).`,
                  );
                }
                if (ciro63.bilinmeyen > 0) {
                  notYaz(
                    tr63 ? `Not: ${ciro63.bilinmeyen} kaydın tutarı okunamadı — ciro kısmi, paylar hesaplanamadı.`
                         : `Note: ${ciro63.bilinmeyen} record(s) have an unreadable amount — revenue is partial and shares could not be computed.`,
                  );
                }
                // Section 3: Inventory highlights
                const finalY2 = Math.max(
                  (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8,
                  notY + notSatirAraligi,
                );
                pdf.setFontSize(12); pdf.setFont('Roboto', 'bold');
                pdf.text(tr63 ? 'Kritik Stok Uyarıları' : 'Critical Stock Alerts', 14, finalY2);
                // KPI kartıyla AYNI tanım (`finansKpi.stokDurumu`): stoğu ya da eşiği BİLİNMEYEN
                // ürün listeye girmez — '0 / 5' uydurması ("stok yok, eşik 5") biterdi. Sayısı
                // tablonun altına not olarak yazılır, sessizce düşmez.
                const sd63 = stokDurumu(inventory);
                const lowStock = sd63.esikAltinda.slice(0, PDF_KRITIK_STOK_SATIR);
                autoTable(pdf, {
                  ...pdfTabloStili(),
                  startY: finalY2 + 4,
                  head: [['SKU', oc(tr63).urun, oc(tr63).stok, tr63 ? 'Min' : 'Min']],
                  // `adetYaz`ın yereli DİLDEN gelir (delta 2026-09-22): EN PDF'inde '1.500' nokta
                  // ondalık ayracı olarak okunur, yani stok bin kat küçük görünürdü.
                  body: lowStock.map(i => [i.sku, i.name, adetYaz(stokSeviyesi(i), tr63 ? 'tr' : 'en'), adetYaz(stokEsigi(i), tr63 ? 'tr' : 'en')]),
                  styles: { font: 'Roboto', fontSize: 9 },
                });
                const stokNotu63 = kapsamNotu(
                  { miktarsiz: sd63.seviyesiBilinmeyen, esiksiz: sd63.esigiBilinmeyen },
                  { dil: tr63 ? 'tr' : 'en', sonuc: tr63 ? 'listeye alınmadı' : 'left out of the list' },
                );
                if (stokNotu63 !== null) {
                  const stokY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
                  pdf.setFontSize(8); pdf.setFont('Roboto', 'normal');
                  pdf.text(stokNotu63, 14, stokY);
                }
                pdf.save(`cetpa-rapor-${bugunAnahtari()}.pdf`);
              });
            });
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-300 bg-[#1a3a5c] hover:bg-[#243f60] text-white text-xs font-semibold transition-colors"
        >
          <FileText className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'PDF Rapor' : 'PDF Report'}
        </button>
        <button
          onClick={() => {
            // Tarih çözümü `ayAnahtari` (tek kaynak, src/utils/zaman.ts) — çözülemeyen kayıt
            // HİÇBİR AYA yazılmaz. Eskiden `?? new Date()` vardı: tarihi olmayan her kayıt
            // sessizce İÇİNDE BULUNULAN AYA yazılıyor ve o ayı şişiriyordu. Artık o kayıtlar da
            // kaybolmuyor: aşağıdaki `(tarihsiz)` satırında toplanıp dosyanın sonuna yazılıyor.
            // Sayaçlar ay BAŞINA tutulur (eskiden tek global sayaçtı ve yalnız console'a yazılıyordu).
            type AySatiri = MonthlySummaryRow & { cancelledCount: number; revenueUnknown: number };
            const bosSatir = (month: string): AySatiri =>
              ({ month, orderCount: 0, revenue: 0, newLeads: 0, delivered: 0, cancelledCount: 0, revenueUnknown: 0 });

            const monthMap = new Map<string, AySatiri>();
            // Tarihi çözülemeyen sipariş artık SESSİZCE DÜŞMEZ: kendi satırında toplanır ve
            // dosyanın SON satırı olur.
            const tarihsizSatir = bosSatir(currentLanguage === 'tr' ? '(tarihsiz)' : '(undated)');
            let tarihsiz = 0;
            for (const o of orders) {
              const month = ayAnahtari(o.createdAt);
              let row: AySatiri;
              if (!month) { tarihsiz++; row = tarihsizSatir; }
              else { row = monthMap.get(month) ?? bosSatir(month); monthMap.set(month, row); }

              // K2 → "hayır": iptaller ciroya GİRMEZ — CSV'de ayrı "İptal Edilen" sütununda SAYILIR.
              // Tutarı okunamayan bir iptal YALNIZ `cancelledCount`'ta durur (çift sayım yok).
              if (o.status === 'Cancelled') { row.cancelledCount++; continue; }

              row.orderCount++;
              // Tutarı okunamayan sipariş ciroya ₺0 OLARAK GİRMEZ, ayrıca sayılır: `Number(x) || 0`
              // hem eksik alanı hem de meşru 0'ı aynı şeye çeviriyordu (sipariş sayısı ile ciro
              // uyuşmuyor ama CSV bunu söylemiyordu).
              const tutar = siparisTutari(o);
              if (Number.isFinite(tutar)) row.revenue += tutar; else row.revenueUnknown++;
              if (o.status === 'Delivered') row.delivered++;
            }

            // "Yeni Müşteri" = o ay İLK SİPARİŞİNİ veren müşteri.
            //
            // Eskiden lead kaydının `createdAt`'i sayılıyordu ve bu bir İŞ
            // GERÇEĞİ DEĞİL, IMPORT ARTEFAKTIYDI: Mikro cari aktarımı 2026-06'da
            // koştuğu için o ay 188 "yeni müşteri" görünüyor, ondan önceki beş
            // ay 23-38 sipariş almasına rağmen 0 gösteriyordu. Müşterinin ilk
            // siparişi, gerçekten ne zaman kazanıldığının ölçüsüdür.
            //
            // K4 → "kimlikle": müşteri kümesi AD ile değil KİMLİK ile kurulur; `leadCariKodu` bağı
            // olmadan aynı firma Cetpa'da bir ay, Mikro'da başka ay "yeni müşteri" sayılıp İKİ KEZ
            // +1 alırdı. Kimliği de adı da olmayan sipariş bu hesaba GİRMEZ: bugüne kadar adsız
            // siparişlerin HEPSİ tek '—' müşterisi sayılıp bir aya +1 yazıyordu (uydurma müşteri).
            // Girdi iptal DAHİL tüm `orders` — müşterinin ilk siparişi iptal olsa da "kazanılma"
            // anıdır (parite; K2 yalnız CİRO kuralıdır).
            const ozetC = raporMusteriOzeti(orders);
            for (const m of ozetC.musteriler) {
              if (!m.ilk) continue;                       // hiç tarihli siparişi yok → hiçbir aya yazılmaz
              const month = ayAnahtari(m.ilk.createdAt);  // ms→ay çevirisi YOK (saat dilimi kayması)
              if (!month) continue;
              const row = monthMap.get(month) ?? bosSatir(month);
              row.newLeads++;
              monthMap.set(month, row);
            }
            const satirlar = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));
            // Tarihsiz satır sıralamadan SONRA eklenir (ay anahtarı değil, etiket taşıyor).
            if (tarihsiz > 0) satirlar.push(tarihsizSatir);
            exportMonthlySummaryCSV(satirlar, currentLanguage);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-brand/30 bg-brand/5 hover:bg-brand/10 text-brand text-xs font-semibold transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Aylık Özet' : 'Monthly Summary'}
        </button>
      </div>

      <ReportsDashboard
        orders={orders} inventory={inventory} exchangeRates={exchangeRates}
        currentT={currentT} currentLanguage={currentLanguage} userRole={userRole}
        onNavigate={onNavigate} onMusteriAc={onMusteriAc} leadCariKodu={leadCariKodu}
        employees={employees} quotations={appQuotations}
        inventoryMovements={inventoryMovements} recurringOrders={recurringOrders}
        externalTab={appReportsTab} setExternalTab={setAppReportsTab}
      />

      {/* ANALITIK (2026-09-04): ayri "Analitik" ust sekmesi kaldirilip Raporlar'in
          alt sekmesi yapildi — iki ayri ust sekme ayni soruyu iki yerde cevapliyordu
          (kullanici: "Analitik ile raporlari birlestir, raporlar kalsin"). */}
      {appReportsTab === 'analitik' && (
        <React.Suspense fallback={<div className="apple-card p-8 text-center text-gray-400">Yükleniyor…</div>}>
          <AnalyticsPanel
            orders={orders}
            leads={leads}
            inventory={inventory}
            currentLanguage={currentLanguage as 'tr' | 'en'}
          />
        </React.Suspense>
      )}

      {/* ── Phase 570: KPI Hedef Takibi ─────────────────────────────────────── */}
      {appReportsTab === 'genel' && (() => {
        const tr570 = currentLanguage === 'tr';
        const now570 = new Date();
        const monthStart570 = new Date(now570.getFullYear(), now570.getMonth(), 1);
        // Ay penceresi + ciro/adet/ortalama TEK yerde ve TESTLİ: `rapor/ayKpisi`
        // (2026-09-20 hakem turu — hesap burada inline dururken `adet`i `monthOrders570.length`
        // yapan mutasyon TEK bir testi bile kırmıyordu; K2 yarım uygulanınca Sipariş Adedi
        // iptalleri sayar, Ort. Sipariş Değeri'nin paydası payıyla ayrışır). Tarih çözümü,
        // "bilinmeyen tutar 0 sayılmaz" ve iptal süzgeci sözleşmeleri modülün başlığındadır.
        const kpi570 = ayKpisi(orders, monthStart570);
        const ciro570 = kpi570.ciro;
        const actRevenue570 = kpi570.ekranCiro;            // EKRAN: kısmi toplam (+ altta sayaç notu)
        const actOrders570 = kpi570.adet;                  // cironun toplandığı kümenin TA KENDİSİ
        const tamCiro570 = kpi570.tamCiro;                 // TÜRETME kapısı (hedef gerçekleşmesi)
        const actAvgOrder570 = kpi570.ortalama;
        // Dönüşüm oranı tek kaynakta (`finansKpi.adayDonusumOrani`): 'Closed'/'Closed Won' kazanılmış.
        // Ham oran (`lojistikKpi.oranYuzde`) — yuvarlama aşağıdaki `fmt`'te, eski davranışla birebir.
        // BELGELİ FARK: durumu okunamayan aday artık PAYDAYA girmez (eskiden `leads.length` hepsini
        // sayıyordu) — durumsuz kayıt "kazanılmamış" değil, BİLİNMEYENdir.
        const d570 = adayDonusumOrani(leads);
        const actLeadConv570 = oranYuzde(d570.pay, d570.payda) ?? NaN;
        // `oranGirdisi` AYRI bir alandır (2026-09-18 hakem turu): `actual` EKRANA basılan sayı
        // (ciroda kısmi toplam olabilir), gerçekleşme yüzdesi ise TÜRETİLEN sayıdır — kısmi
        // cirodan "%50 gerçekleşme" basmak, eksik faturanın büyüklüğü kadar yanlıştır.
        // Ciroda kapı `tamTutar`; adet/dönüşüm zaten sayımdır (tutardan bağımsız), ortalama
        // sipariş değeri de yukarıda `tamTutar` ile kapılı geliyor.
        // `fmt`'ler hedefi de basar; hedef SİLİNEBİLDİĞİ için (null → NaN) dördü de bilinmeyende '—'
        // vermeli. ÖLÇÜLDÜ: `fmtKpi` → `kisaTutar` (currency.ts:215 `bilinenSayi` kapısı) '—';
        // `adetYaz` (depoDeger.ts) '—'; `yuzdeYaz` (rapor/bicim.ts:47) '—'. `String(NaN)` ise
        // "Hedef: NaN" basardı — bu yüzden Sipariş Adedi `adetYaz`'a bağlandı.
        // `adetYaz`a DİL geçilir (delta 2026-09-22): yerel sabit 'tr-TR' iken EN arayüzde hem
        // gerçekleşen hem HEDEF '1.500' basılıyordu; Intl'de nokta ondalık ayracı olduğu için
        // İngilizce okuyan kullanıcı hedefi bin kat küçük görüyordu. Kardeş satır `yuzdeYaz`
        // dili zaten geçiriyordu — aynı daraltma.
        const kpis570 = [
          { label: oc(tr570).aylik_ciro, actual: actRevenue570, oranGirdisi: tamCiro570, target: p570Targets.revenue, fmt: (v: number) => fmtKpi(v, 'K', 1), key: 'revenue' as const, color: 'blue' },
          { label: oc(tr570).siparis_adedi, actual: actOrders570, oranGirdisi: actOrders570, target: p570Targets.orders, fmt: (v: number) => adetYaz(v, currentLanguage), key: 'orders' as const, color: 'green' },
          { label: tr570 ? 'Ort. Sipariş Değeri' : 'Avg Order Value', actual: actAvgOrder570, oranGirdisi: actAvgOrder570, target: p570Targets.avgOrderVal, fmt: (v: number) => fmtKpi(v, 'full', 0), key: 'avgOrderVal' as const, color: 'purple' },
          { label: tr570 ? 'Lead Dönüşüm %' : 'Lead Conv. %', actual: actLeadConv570, oranGirdisi: actLeadConv570, target: p570Targets.leadConv, fmt: (v: number) => yuzdeYaz(v, 1, currentLanguage), key: 'leadConv' as const, color: 'orange' },
        ];
        /**
         * Hedef kutusu kaydı — Pano deseni BİREBİR (`DashboardPage.tsx:881-912`).
         * Düz fonksiyon (bileşen DEĞİL): render içinde bileşen tanımlanırsa her render'da yeniden bağlanır.
         *   'gecerli'  → sayısal state'e yaz, taslağı sil
         *   'temizle'  → hedefi KALDIR (`null`) — 0 DEĞİL; 0 "hedef sıfır" demek olurdu
         *   'gecersiz' → toast + kutu AÇIK kalır (taslak SİLİNMEZ, sayısal state'e YAZILMAZ)
         */
        const hedefKaydet570 = (key: keyof P570Targets, ham: string) => {
          const g = hedefGirdisi(ham);
          if (g.durum === 'gecersiz') {
            toast(tr570
              ? 'Hedefi yalnız rakamla yazın (ör. 100) — sıfırdan büyük olmalı'
              : 'Enter the target using digits only (e.g. 100) — must be greater than zero', 'error');
            return;
          }
          setP570Targets(prev => ({ ...prev, [key]: g.durum === 'temizle' ? null : g.deger }));
          setP570Taslak(t => { const y = { ...t }; delete y[key]; return y; });
        };
        const taslakSil570 = (key: keyof P570Targets) =>
          setP570Taslak(t => { const y = { ...t }; delete y[key]; return y; });
        const colorMap570: Record<string, string> = { blue: 'bg-blue-500', green: 'bg-green-500', purple: 'bg-purple-500', orange: 'bg-orange-500' };
        const colorText570: Record<string, string> = { blue: 'text-blue-600', green: 'text-green-600', purple: 'text-purple-600', orange: 'text-orange-600' };
        return (
          <div className="apple-card p-5">
            <h3 className="text-base font-bold text-gray-900 mb-4">{tr570 ? '🎯 KPI Hedef Takibi (Bu Ay)' : '🎯 KPI Target Tracking (This Month)'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {kpis570.map(kpi => {
                // Gerçekleşme oranı TÜRETİLEN sayıdır: gerçekleşen değer bilinmiyorsa (kısmi ciro,
                // hesaplanamayan ortalama) "%0 gerçekleşme" basmak sahte kesinliktir → '—' + gri çubuk.
                // Hesap tek kaynakta (utils/muhasebe/kpiTrend.hedefOrani); girdi `oranGirdisi`,
                // ekrana basılan `actual` DEĞİL (kısmi ciro kapıyı açıyordu).
                // Hedef SİLİNEBİLİR (`null`): türetilen sayı için bilinmeyen NaN'dır, 0 DEĞİL —
                // 0 hedef `hedefOrani`'nda "%∞ gerçekleşme" ya da sahte "%0" üretirdi.
                const pct = hedefOrani(kpi.oranGirdisi, kpi.target ?? NaN);
                const isGood = pct !== null && pct >= 80;
                return (
                  <div key={kpi.key} className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{kpi.label}</p>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${pct === null ? 'bg-gray-100 text-gray-500' : isGood ? 'bg-green-100 text-green-700' : pct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{pct === null ? '—' : `${pct.toFixed(0)}%`}</span>
                    </div>
                    <div>
                      <p className={`text-xl font-bold ${colorText570[kpi.color]}`}>{kpi.fmt(kpi.actual)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{tr570 ? 'Hedef:' : 'Target:'} {kpi.fmt(kpi.target ?? NaN)}</p>
                    </div>
                    {/* Oran bilinmiyorken boş çubuk "hedefin %0'ı" demekti → gri taralı. */}
                    <OlcekCubugu oran={pct} yon="yatay" kalinlik="h-1.5" renkSinifi={colorMap570[kpi.color]} dil={currentLanguage} />
                    {/* `type="number"` DEĞİL: tarayıcı çözemediği metni '' yapar, '' ise "hedefi sil"dir
                        (bkz. hedefGirdisi). Ham metin kapıya ulaşsın diye düz metin + sayısal klavye. */}
                    <input
                      type="text"
                      inputMode="numeric"
                      value={p570Taslak[kpi.key] ?? hedefOnDoldur(p570Targets[kpi.key])}
                      onChange={e => setP570Taslak(t => ({ ...t, [kpi.key]: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') hedefKaydet570(kpi.key, e.currentTarget.value);
                        if (e.key === 'Escape') taslakSil570(kpi.key);   // kayıtlı değer geri görünür
                      }}
                      // Kaydetme YALNIZ taslak varsa, yani kullanıcı GERÇEKTEN yazdıysa: kutuya
                      // girip çıkmak hedefi yeniden yazdırıp gereksiz DB yazması tetiklemesin.
                      onBlur={() => { const d = p570Taslak[kpi.key]; if (d !== undefined) hedefKaydet570(kpi.key, d); }}
                      className="w-full text-xs apple-input py-1 px-2" placeholder={tr570 ? 'Hedef girin...' : 'Set target...'} />
                  </div>
                );
              })}
            </div>
            {ciro570.bilinmeyen > 0 && (
              <p className="text-[11px] text-amber-600 mt-3">
                {tr570
                  ? `${ciro570.bilinmeyen} siparişin tutarı okunamadı — Aylık Ciro kısmi toplamdır; hedef gerçekleşme oranı ve Ort. Sipariş Değeri hesaplanamıyor.`
                  : `${ciro570.bilinmeyen} order(s) have an unreadable amount — Monthly Revenue is a partial total; its target progress and Avg Order Value cannot be computed.`}
              </p>
            )}
            {/* K2 — kullanıcı: "İptaller ciroya girsin mi → hayır." Karar uygulandıktan sonra bu
                kart 34, hemen altındaki P603 trend grafiği 'orders' metriğinde (PARİTE gereği
                iptali dışlamayan seri) 39 basıyor ve farkı açıklayan TEK satır yoktu. Kullanıcı
                aynı ekranda iki sayı görüp hangisine güveneceğini bilemiyordu; grafiğin süzgeci
                DEĞİŞTİRİLMEDİ (parite), fark SÖYLENİYOR. Sayaç `ayKpisi.iptalAdedi`: pencere
                çözülemezse NaN olduğu için `> 0` kapısından da geçmez (uydurma "0 iptal" yok). */}
            {kpi570.iptalAdedi > 0 && (
              <p className="text-[11px] text-gray-500 mt-2">
                {tr570
                  ? `${kpi570.iptalAdedi} sipariş iptal edildi — Sipariş Adedi ve Aylık Ciro iptaller HARİÇ; aşağıdaki trend grafiğinin "Sipariş" serisi iptalleri içerir.`
                  : `${kpi570.iptalAdedi} order(s) were cancelled — Order Count and Monthly Revenue exclude cancellations; the "Orders" series in the trend chart below includes them.`}
              </p>
            )}
          </div>
        );
      })()}

      {/* ── Phase 603: İş Zekası Trend Analizi ─────────────────────── */}
      {appReportsTab === 'genel' && (() => {
        const tr603 = currentLanguage === 'tr';
        const monthsBack = p603TrendPeriod === '3m' ? 3 : p603TrendPeriod === '6m' ? 6 : 12;
        const now603 = new Date();
        // Ay etiketi `aylikCiro` içinde YILSIZ üretiliyor ('Eyl') — sayfa yıllı istiyor, o yüzden
        // burada üretilir (parite: eski `toLocaleString`, yalnız tarih alanlarıyla aynı çıktı).
        const etiket603 = (d: Date) => tarihYaz(d, { month: 'short', year: '2-digit' }, currentLanguage);
        const months603 = Array.from({ length: monthsBack }, (_, i) => {
          const d = new Date(now603.getFullYear(), now603.getMonth() - monthsBack + 1 + i, 1);
          return { date: d, label: etiket603(d) };
        });
        // Ciro/adet serisi TEK kuralda (`pano/ciroDonem.aylikCiro`): tutarı okunamayan sipariş 0
        // SAYILMAZ, SAYILIR; bilinmeyen ay grafik değeri olarak NaN ('—') kalır.
        // İptal süzgeci PARİTE gereği metrik başına AÇIK: ciro iptali dışlıyordu, sipariş adedi dışlamıyordu.
        // BELGELİ FARK: `aylikCiro` tarihi `createdAt → syncedAt` çözer, bugünkü kod yalnız
        // `createdAt` okuyordu — `createdAt`'i olan kayıtlar için BİREBİR.
        const seri603 = p603TrendMetric === 'leads'
          ? null
          : aylikCiro(orders, monthsBack, now603, { iptalHaric: p603TrendMetric === 'revenue' }, currentLanguage);
        // Ay başına kaç kaydın tutarı okunamadı — grafiğin altındaki not bunu söyler.
        const tutarsiz603 = p603TrendMetric === 'revenue' && seri603 !== null
          ? seri603.reduce((s, a) => s + a.tutar.bilinmeyen, 0)
          : 0;
        const data603 = seri603 !== null
          ? seri603.map(a => ({ label: etiket603(a.tarih), value: p603TrendMetric === 'revenue' ? a.ekran : a.adet }))
          : months603.map(m => {
              const start = m.date;
              const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59);
              return {
                label: m.label,
                value: leads.filter(l => {
                  if (!l.createdAt) return false;
                  const d = zamanDate(l.createdAt); return d !== null && d >= start && d <= end;
                }).length,
              };
            });
        // Bilinmeyen ay ('—') ölçeğe girmez. Ciroda `olcekTavani` (sıfıra-bölme tabanı 1, para
        // iddiası değil); sayım serilerinde `sayacOlcegi` — uydurma taban YOK, hepsi 0 ise null
        // döner. Ölçeğin `null`unu `seriCubukOrani` yorumlar: değerler BİLİNEN 0 olduğu için
        // çubuk çizilmez ("veri yok" ≠ "sıfıra yakın değer"), taralı çubuk YALNIZ değerin
        // kendisi okunamadığında çıkar.
        const olcek603 = p603TrendMetric === 'revenue' && seri603 !== null
          ? olcekTavani(seri603)
          : sayacOlcegi(data603.map(d => d.value));
        // Dönem toplamı EKRAN sözleşmesi (kısmi + alttaki not); Aylık Ortalama ve Aylık Değişim
        // TÜRETİLEN sayılardır. KAPI, AY TOPLAMINDAN DEĞİL TUTARSIZ KAYIT SAYACINDAN geçer
        // (2026-09-18 hakem turu): `ekranTutari` kısmi bir ayı SONLU döndürdüğü için ay-içi
        // bilinmeyen sayacı bir üst katta kayboluyor, `tamTutar(toplam603)` kapısı açılıyor ve
        // ekran kendi notuyla çelişiyordu ("+100,0%" ile "hesaplanamıyor" yan yana). Satış
        // Tahmini (620) bloğunun `tahminYapilabilir` kapısıyla aynı desen.
        // Hesap tek kaynakta (utils/muhasebe/kpiTrend.trendOzeti).
        const ozet603 = trendOzeti(data603.map(d => ({ deger: d.value })), tutarsiz603);
        const totalVal = ozet603.toplam;
        const avgVal = ozet603.ortalama;
        const trend = ozet603.degisim;
        const fmt603 = (v: number) => p603TrendMetric === 'revenue' ? paraYaz(v, { ondalik: 0 }) : String(v);
        return (
          <div className="apple-card p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="font-bold text-gray-900 text-sm">{tr603 ? '📈 İş Zekası Trend Analizi' : '📈 Business Intelligence Trends'}</h3>
              <div className="flex gap-2 flex-wrap">
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                  {([['revenue', oc(tr603).gelir], ['orders', oc(tr603).siparis_2], ['leads', 'Leads']] as const).map(([id, lbl]) => (
                    <button key={id} onClick={() => setP603TrendMetric(id)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${p603TrendMetric === id ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{lbl}</button>
                  ))}
                </div>
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                  {(['3m', '6m', '12m'] as const).map(p => (
                    <button key={p} onClick={() => setP603TrendPeriod(p)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${p603TrendPeriod === p ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{p}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: tr603 ? 'Dönem Toplamı' : 'Period Total', val: fmt603(totalVal), color: 'text-gray-800' },
                { label: tr603 ? 'Aylık Ortalama' : 'Monthly Avg', val: Number.isFinite(avgVal) ? fmt603(Math.round(avgVal)) : '—', color: 'text-blue-600' },
                // Değişim hesaplanamıyorsa '—': "%0 değişim" ile "bilinmiyor" aynı şey değildir.
                { label: tr603 ? 'Aylık Değişim' : 'MoM Change', val: trend === null ? '—' : `${trend >= 0 ? '+' : ''}${trend.toFixed(1)}%`, color: trend === null ? 'text-gray-400' : trend >= 0 ? 'text-emerald-600' : 'text-red-500' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 uppercase font-semibold">{k.label}</p>
                  <p className={`text-base font-bold mt-0.5 ${k.color}`}>{k.val}</p>
                </div>
              ))}
            </div>
            {/* Sparkline bars */}
            <div className="flex items-end gap-1 h-20">
              {data603.map((m, i) => {
                const bilinir = Number.isFinite(m.value);
                const isLast = i === data603.length - 1;
                return (
                  <div key={m.label} className="flex-1 flex flex-col items-center gap-1 h-full" title={`${m.label}: ${bilinir ? fmt603(m.value) : '—'}`}>
                    {/* Bilinmeyen ay gri TARALI (eski 2 px hayalet çubuk "az da olsa hareket var"
                        diyordu); gerçek ₺0 ise hiç çizilmez. */}
                    <div className="w-full flex-1 min-h-0">
                      <OlcekCubugu oran={seriCubukOrani(m.value, olcek603)} yon="dikey" renk={isLast ? '#ff4000' : '#e5e7eb'} dil={currentLanguage} />
                    </div>
                    <span className="text-[9px] text-gray-400 rotate-0">{m.label}</span>
                  </div>
                );
              })}
            </div>
            {p603TrendMetric === 'revenue' && tutarsiz603 > 0 && (
              <p className="text-[11px] text-amber-600 mt-3">
                {tr603
                  ? `${tutarsiz603} siparişin tutarı okunamadı — aylık çubuklar ve dönem toplamı kısmi; ortalama ve aylık değişim hesaplanamıyor.`
                  : `${tutarsiz603} order(s) have an unreadable amount — monthly bars and the period total are partial; the average and MoM change cannot be computed.`}
              </p>
            )}
          </div>
        );
      })()}

      {/* ── AI Demand Forecast ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <DemandForecastPanel currentLanguage={currentLanguage} />
      </div>

      {/* ── Phase 620: Satış Tahmini (Forecast) ────────────────────── */}
      {appReportsTab === 'genel' && orders.length >= 2 && (() => {
        const tr620 = currentLanguage === 'tr';
        const horizonMonths = p620Horizon === '1m' ? 1 : p620Horizon === '3m' ? 3 : 6;
        const now620 = new Date();
        const histMonths = TAHMIN_GECMIS_AY;
        // Tek tahmin kuralı (`muhasebe/faturaTakipTahmin.satisTahmini`): ağırlıklı hareketli
        // ortalama + en küçük kareler eğimi. Buradaki satır içi kopya tahmin ayını
        // `ȳ + eğim·(geçmişAy + i)` ile basıyordu — ilk ay için 6·eğim, doğrusu `wma + eğim·1`
        // (K14 — kullanıcı: "kaldır"; her çiftten TEK panel/hesap kalır, testli olan).
        // `tutarSec` Raporlar'ın tutarı (`totalPrice ?? totalAmount`); modülün varsayılanı DEĞİŞMEZ.
        const t620 = satisTahmini(orders, now620, { ufuk: horizonMonths, tutarSec: siparisTutari });
        const history = t620.gecmis.map(a => ({
          label: tarihYaz(a.ay, { month: 'short', year: '2-digit' }),
          rev: ekranTutari(a),
        }));
        const tutarsiz620 = t620.bilinmeyen;
        // TAHMİN, tanımı gereği TÜRETİLEN sayıdır: girdi aylarından biri bile eksikse regresyon
        // eğimi ve ortalaması yanlış olur ve o yanlış geleceğe uzatılır. Bir kayıt bile
        // okunamıyorsa tahmin ÜRETİLMEZ — geçmiş çubukları kısmi olarak gösterilir, sebebi yazılır.
        const tahminYapilabilir = tutarsiz620 === 0;
        const forecast = tahminYapilabilir
          ? t620.tahmin.map(f => ({ label: tarihYaz(f.ay, { month: 'short', year: '2-digit' }), val: f.deger }))
          : [];
        // Trend düşüşteyken tahmin `Math.max(0, …)` ile ₺0'a kırpılır — kırpıldığını SÖYLE
        // (rakam "sıfır ciro öngörüsü" değil, modelin alt sınırıdır).
        const kirpildi620 = t620.egim < 0 && forecast.some(f => f.val === 0);
        const fmtF = (v: number) => kisaTutar(v, { fmt: v >= 1_000_000 ? 'M' : v >= 1000 ? 'K' : 'full', ondalik: v >= 1_000_000 ? 1 : 0 });
        return (
          <div className="apple-card p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-bold text-gray-900 text-sm">🔮 {tr620 ? 'Satış Tahmini' : 'Sales Forecast'}</h3>
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                {([{ k: '1m', l: '1M' }, { k: '3m', l: '3M' }, { k: '6m', l: '6M' }] as { k: '1m' | '3m' | '6m'; l: string }[]).map(t => (
                  <button key={t.k} onClick={() => setP620Horizon(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p620Horizon === t.k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                ))}
              </div>
            </div>
            {/* Ölçek map DIŞINDA bir kez (eskiden her çubukta yeniden hesaplanıyordu) ve uydurma
                `, 1` tabanı YOK. Ölçek `null` iki AYRI durumdan gelebilir, `seriCubukOrani`
                ikisini ayırır: ayların TUTARI okunamadıysa çubuk taralı ("bilinmiyor"), ciro
                gerçekten ₺0 ise çubuk hiç çizilmez (altındaki tahmin kartları da ₺0 der). */}
            {(() => {
              const olcek620 = sayacOlcegi([...history.map(h => h.rev), ...forecast.map(f => f.val)]);
              return (
                <div className="flex items-end gap-1 h-24">
                  {[...history.map(h => ({ label: h.label, deger: h.rev, forecast: false })),
                    ...forecast.map(f => ({ label: f.label, deger: f.val, forecast: true }))].map((m, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5 h-full" title={Number.isFinite(m.deger) ? fmtF(m.deger) : '—'}>
                      <div className="w-full flex-1 min-h-0">
                        <OlcekCubugu oran={seriCubukOrani(m.deger, olcek620)} yon="dikey" renk={m.forecast ? 'rgba(255,64,0,0.3)' : '#e5e7eb'} dil={currentLanguage} />
                      </div>
                      <span className="text-[8px] text-gray-400">{m.label}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            {tahminYapilabilir ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {forecast.map(f => (
                  <div key={f.label} className="bg-orange-50 border border-orange-100 rounded-xl p-3">
                    <p className="text-[10px] font-bold text-orange-400 uppercase">{f.label} {tr620 ? '(Tahmin)' : '(Forecast)'}</p>
                    <p className="text-lg font-black text-orange-700">{fmtF(f.val)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[11px] text-amber-800">
                {tr620
                  ? `Tahmin üretilemedi: son ${histMonths} ayda ${tutarsiz620} kaydın tutarı okunamadı. Eksik girdiyle kurulan trend geleceğe de yanlış uzatılır — geçmiş çubukları kısmi toplamdır.`
                  : `Forecast unavailable: ${tutarsiz620} record(s) in the last ${histMonths} months have an unreadable amount. A trend built on missing input would be projected forward as well — the history bars are partial totals.`}
              </div>
            )}
            {kirpildi620 && (
              <p className="text-[11px] text-amber-600">
                {tr620
                  ? 'Trend düşüşte — tahmin ₺0’a kırpıldı; bu bir "sıfır ciro" öngörüsü değil, modelin alt sınırıdır.'
                  : 'The trend is negative — the forecast was clamped to ₺0; this is the model’s floor, not a prediction of zero revenue.'}
              </p>
            )}
            <KapsamNotu
              sayaclar={{ tarihsiz: t620.tarihsiz }}
              dil={currentLanguage}
              sonuc={tr620 ? 'tahmine girmedi' : 'not included in the forecast'}
              className="text-[11px] text-amber-600"
            />
            {/* Model DEĞİŞTİ (satır içi doğrusal regresyon → ağırlıklı ortalama + eğim); yanlış
                etiket bırakılmaz. */}
            <p className="text-[10px] text-gray-400">* {tr620 ? 'Ağırlıklı ortalama + doğrusal eğim. Gerçek sonuçlar farklılık gösterebilir.' : 'Weighted moving average + linear slope. Actual results may vary.'}</p>
          </div>
        );
      })()}

      {/* ── Phase 631: İş Süreci Analizi (Bottleneck) ──────────────── */}
      {appReportsTab === 'genel' && orders.length > 0 && (() => {
        const tr631 = currentLanguage === 'tr';
        // Durum sayımı tek kuralda (`stokSevkiyat.durumDagilimi` + `PANO_DURUMLARI`): durumu eksik
        // ya da listede olmayan sipariş artık sessizce düşmüyor, `dd.diger`de sayılıyor.
        const dd = durumDagilimi(orders, PANO_DURUMLARI);
        const stageMap = dd.sayilar;
        const pipeline631 = [
          { stage: 'Pending',    label: oc(tr631).bekliyor,    color: 'bg-amber-400',  count: stageMap['Pending']    },
          { stage: 'Processing', label: tr631 ? 'İşlemde'  : 'Processing', color: 'bg-blue-500',   count: stageMap['Processing'] },
          { stage: 'Shipped',    label: tr631 ? 'Yolda'     : 'Shipped',    color: 'bg-indigo-500', count: stageMap['Shipped']    },
          { stage: 'Delivered',  label: oc(tr631).teslim,  color: 'bg-green-500',  count: stageMap['Delivered']  },
        ].filter(s => s.count > 0 || s.stage === 'Processing');
        // Uydurma payda YOK (`|| 1`): aktif sipariş yokken oranlar "%0" değil '—' olmalı.
        const total631 = pipeline631.reduce((s, p) => s + p.count, 0);
        const bottleneck631 = total631 > 0 ? [...pipeline631].sort((a, b) => b.count - a.count)[0] ?? null : null;
        // Tarih çözümü `zamanMs` (tek kaynak). İki tarihten biri çözülemeyen
        // sipariş hem paydan hem paydadan DÜŞER (eskiden Invalid Date → NaN
        // toplamı ortalamayı komple bozuyordu). Fark ms tabanlı kesirli gün
        // (toFixed(1) ile basılıyor); `gunFarki` tam güne yuvarladığından
        // BİLEREK kullanılmadı — hesap tanımı değişmesin.
        const cycleDays = orders
          .filter(o => o.status === 'Delivered')
          .map(o => {
            const created = zamanMs(o.createdAt), delivered = zamanMs(o.estimatedDelivery);
            return created === null || delivered === null ? null : (delivered - created) / 86400000;
          })
          .filter((gun): gun is number => gun !== null);
        const avgCycle = cycleDays.length > 0 ? cycleDays.reduce((s, gun) => s + gun, 0) / cycleDays.length : null;
        return (
          <div className="apple-card p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-bold text-gray-900 text-sm">🔄 {tr631 ? 'İş Süreci Analizi' : 'Process Bottleneck Analysis'}</h3>
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                {(['pipeline', 'cycle-time', 'bottleneck'] as const).map(v => (
                  <button key={v} onClick={() => setP631View(v)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${p631View === v ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                    {v === 'pipeline' ? (tr631 ? 'Boru Hattı' : 'Pipeline') : v === 'cycle-time' ? (tr631 ? 'Döngü Süresi' : 'Cycle Time') : (tr631 ? 'Darboğaz' : 'Bottleneck')}
                  </button>
                ))}
              </div>
            </div>
            {p631View === 'pipeline' && (
              <div className="space-y-3">
                {pipeline631.map(p => (
                  <div key={p.stage} className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-600">
                      <span className="font-medium">{p.label}</span>
                      <span className="font-bold">{p.count} {oc(tr631).siparis} ({yuzdeYaz(yuzdeOrani(p.count, total631), 0, currentLanguage)})</span>
                    </div>
                    <OlcekCubugu oran={oranYuzde(p.count, total631)} yon="yatay" kalinlik="h-3" renkSinifi={p.color} dil={currentLanguage} />
                  </div>
                ))}
                <p className="text-[11px] text-gray-400 pt-1">{tr631 ? 'Toplam aktif sipariş:' : 'Total active orders:'} <span className="font-semibold text-gray-600">{orders.filter(o => o.status !== 'Cancelled').length}</span></p>
                <KapsamNotu
                  sayaclar={{ kapsamDisi: dd.diger }}
                  dil={currentLanguage}
                  sonuc={tr631 ? 'boru hattında gösterilmiyor' : 'not shown in the pipeline'}
                />

              </div>
            )}
            {p631View === 'cycle-time' && (
              <div className="space-y-3">
                {avgCycle !== null ? (
                  <div className="text-center py-4 space-y-2">
                    <p className="text-4xl font-bold text-[#ff4000]">{avgCycle.toFixed(1)}<span className="text-base font-normal text-gray-500 ml-1">{tr631 ? 'gün' : 'days'}</span></p>
                    {/* Hesap `estimatedDelivery` (TAHMİNİ teslim tarihi) okuyor — etiket bunu
                        söylemiyordu. Gerçekleşen teslim (`deliveredAt`, K17) 6k işi. */}
                    <p className="text-sm text-gray-500">{tr631 ? 'Ortalama sipariş teslim süresi (tahmini teslim tarihine göre)' : 'Avg. order fulfillment cycle (based on the estimated delivery date)'}</p>
                    <p className="text-xs text-gray-400">{cycleDays.length} {tr631 ? 'teslim edilen siparişten' : 'delivered orders analyzed'}</p>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <p className="text-sm text-gray-400">{tr631 ? 'Henüz yeterli teslim verisi yok' : 'Not enough delivery data yet'}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: oc(tr631).bekleyen,    val: stageMap['Pending'],    col: 'text-amber-600'  },
                    { label: tr631 ? 'İşlemde'  : 'Processing', val: stageMap['Processing'], col: 'text-blue-600'   },
                    { label: tr631 ? 'Yolda'    : 'Shipped',    val: stageMap['Shipped'],    col: 'text-indigo-600' },
                    { label: oc(tr631).teslim,  val: stageMap['Delivered'],  col: 'text-green-600'  },
                  ].map(s => (
                    <div key={s.label} className="apple-card bg-gray-50 p-3 text-center">
                      <p className={`text-xl font-bold ${s.col}`}>{s.val}</p>
                      <p className="text-[11px] text-gray-500">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {p631View === 'bottleneck' && (
              <div className="space-y-3">
                {/* Darboğaz yoksa boş isimle ("Tespit Edilen Darboğaz: ") ve "%0" ile kart
                    BASILMAZ — aktif sipariş yokken hesaplanacak bir darboğaz yoktur. */}
                {bottleneck631 === null ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-500">
                    {tr631 ? 'Darboğaz hesaplanamadı — aktif sipariş yok.' : 'Bottleneck could not be computed — there are no active orders.'}
                  </div>
                ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                  <span className="text-2xl">⚠️</span>
                  <div>
                    <p className="font-bold text-amber-800 text-sm">{tr631 ? 'Tespit Edilen Darboğaz:' : 'Detected Bottleneck:'} {bottleneck631.label}</p>
                    <p className="text-xs text-amber-700 mt-1">{bottleneck631.count} {tr631 ? 'sipariş bu aşamada bekliyor, toplam siparişlerin' : 'orders stuck here —'} {yuzdeYaz(yuzdeOrani(bottleneck631.count, total631), 0, currentLanguage)} {tr631 ? 'u.' : 'of total.'}</p>
                  </div>
                </div>
                )}
                <div className="space-y-2">
                  {pipeline631.map(p => (
                    <div key={p.stage} className={`flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm ${p.stage === bottleneck631?.stage ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-200'}`}>
                      <span className="font-medium text-gray-700">{p.label}</span>
                      <span className={`font-bold ${p.stage === bottleneck631?.stage ? 'text-amber-700' : 'text-gray-600'}`}>{p.count} {oc(tr631).siparis}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400">{tr631 ? 'Öneri: En yüksek birikimli aşamada kapasite veya süreç iyileştirmesi yapın.' : 'Tip: Improve capacity or process at the highest-backlog stage.'}</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Phase 619: Akıllı Sipariş Önerisi ─────────────────────── */}
      {appReportsTab === 'genel' && inventory.length > 0 && (() => {
        const tr619 = currentLanguage === 'tr';
        // Talep tek kuralda (`rapor/stokTalep`): eşleme `sku` → `kimlik/sku/ad`, miktarı okunamayan
        // kalem 0 SAYILMAZ, kalemi olmayan Mikro sözde-siparişi talebi BESLEMEZ, tarihi çözülemeyen
        // sipariş pencereye girmez ama sayılır. Kutu boşsa (`null`) hesap YAPILMAZ.
        const kapsama619 = p619MinCoverage;
        const t619 = kapsama619 === null
          ? null
          : urunTalebi(orders, { pencereGun: kapsama619, simdi: new Date(), kartSec: kartSec619 });
        const satirlar619 = t619 !== null && kapsama619 !== null ? tukenmeSatirlari(t619, kapsama619) : [];
        // Öneri satırı: kalan gün BİLİNİYOR ve kapsamanın altında. `Math.floor` P619 paritesi.
        // `gunluk`/`adet` burada daraltılır — öneri satırında ikisi de KESİN sayıdır ('!' yok).
        const oneriler619 = satirlar619
          .flatMap(s => {
            if (kapsama619 === null || s.kalan === null || s.gunluk === null) return [];
            if (Math.floor(s.kalan) >= kapsama619) return [];
            const adet = oneriAdedi(s.gunluk, kapsama619, ONERI_KAPSAMA_KATSAYISI);
            if (adet === null) return [];   // `gunluk > 0` olduğu için pratikte olmaz; sayı UYDURULMAZ
            return [{ kart: s.kart, stok: s.stok, kalan: s.kalan, gun: Math.floor(s.kalan), gunluk: s.gunluk, adet }];
          })
          // Bilinmeyen HER yönde sonda (para.sayiSirala) — eski `?? 999` nöbet değeri bilinmeyeni
          // "999 gün var" gibi en sona, ama SAYI olarak diziyordu.
          .sort((a, b) => sayiSirala(a.kalan, b.kalan))
          .slice(0, ONERI_SATIR_SAYISI);
        // Stoğu bilinmeyen ürün artık KIRMIZI '0g kaldı' kartı ÜRETMEZ — ayrı satırda ad ad sayılır.
        const stogu619 = satirlar619.filter(s => s.neden === 'stok-bilinmiyor');
        const talebi619 = satirlar619.filter(s => s.neden === 'talep-bilinmiyor').length;
        // KARIŞIK birimler TEK çağrıyla geçilmez ('N kalemin tarihi çözülemedi' yanlış cümle olurdu):
        // ürün / kalem / sipariş için AYRI çağrı, sonuçlar ' · ' ile birleşir.
        const notlar619 = [
          kapsamNotu({ miktarsiz: talebi619 }, { dil: currentLanguage }),
          t619 === null ? null : kapsamNotu({ eslesmeyen: t619.eslesmeyenKalem }, { dil: currentLanguage }),
          t619 === null ? null : kapsamNotu({ kalemsiz: t619.kalemsizSiparis, tarihsiz: t619.tarihsiz }, { dil: currentLanguage }),
        ].filter((x): x is string => x !== null);
        // Panel yalnız SÖYLEYECEK HİÇBİR ŞEY yokken gizlenir; öneri 0 ama bilinmeyen varsa notu basar.
        if (t619 !== null && oneriler619.length === 0 && stogu619.length === 0 && notlar619.length === 0) return null;

        /** Kapsama kutusu — D panelindeki TASLAK deseniyle aynı (boş = kaldır, geçersiz = toast). */
        const kapsamaKaydet619 = (ham: string) => {
          const g = hedefGirdisi(ham);
          if (g.durum === 'gecersiz') {
            toast(tr619
              ? 'Kapsama gününü yalnız rakamla yazın (ör. 30) — sıfırdan büyük olmalı'
              : 'Enter the coverage days using digits only (e.g. 30) — must be greater than zero', 'error');
            return;
          }
          setP619MinCoverage(g.durum === 'temizle' ? null : g.deger);
          setP619Taslak(null);
        };
        return (
          <div className="apple-card p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-bold text-gray-900 text-sm">🛒 {tr619 ? 'Akıllı Sipariş Önerisi' : 'Smart Order Suggestion'}</h3>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {tr619 ? 'Kapsama Günü:' : 'Coverage Days:'}
                {/* `type="number"` DEĞİL: tarayıcı çözemediği metni '' yapar (bkz. hedefGirdisi). */}
                <input
                  type="text"
                  inputMode="numeric"
                  value={p619Taslak ?? hedefOnDoldur(p619MinCoverage)}
                  onChange={e => setP619Taslak(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') kapsamaKaydet619(e.currentTarget.value);
                    if (e.key === 'Escape') setP619Taslak(null);
                  }}
                  // Yalnız taslak varken kaydet (kutuya girip çıkmak değeri yeniden yazmasın).
                  onBlur={() => { if (p619Taslak !== null) kapsamaKaydet619(p619Taslak); }}
                  className="apple-input px-2 py-0.5 text-xs w-14 text-center" />
              </div>
            </div>
            {t619 === null ? (
              // Kutu boşaltıldı: panel KAYBOLMAZ (kutu da gitmiş olurdu), hesap yapılmaz.
              <p className="text-xs text-gray-400">{tr619 ? 'Kapsama günü girin — talep penceresi olmadan öneri üretilemez.' : 'Enter the coverage days — no suggestion can be produced without a demand window.'}</p>
            ) : (
              <div className="space-y-2">
                {oneriler619.map(s => (
                  <div key={s.kart.id} className={`flex items-center gap-3 border rounded-xl px-4 py-2.5 ${s.gun <= ONERI_ACIL_GUN ? 'border-red-200 bg-red-50/20' : 'border-amber-200 bg-amber-50/20'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{s.kart.name} <span className="text-gray-400 font-normal">({s.kart.sku})</span></p>
                      <p className="text-[10px] text-gray-400">{tr619 ? 'Günlük satış:' : 'Daily sales:'} {s.gunluk.toFixed(1)} · {s.gun}g {tr619 ? 'kaldı' : 'left'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-[#ff4000]">{s.adet} {tr619 ? 'adet sipariş önerisi' : 'units suggested'}</p>
                      <p className="text-[10px] text-gray-400">{tr619 ? 'Mevcut:' : 'Stock:'} {adetYaz(s.stok, tr619 ? 'tr' : 'en')}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {stogu619.length > 0 && (
              <p className="text-[11px] text-amber-600">
                {tr619
                  ? `${stogu619.length} ürünün stoğu bilinmiyor — öneri üretilmedi: `
                  : `${stogu619.length} product(s) have an unknown stock level — no suggestion produced: `}
                {stogu619.slice(0, 5).map(s => s.kart.name).join(', ')}{stogu619.length > 5 ? '…' : ''}
              </p>
            )}
            {notlar619.length > 0 && <p className="text-[11px] text-amber-600">{notlar619.join(' · ')}</p>}
          </div>
        );
      })()}
    </>
  );
}
