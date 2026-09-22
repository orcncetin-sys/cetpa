/**
 * useReportsData.ts — ReportsDashboard'ın paylaşılan hesaplama katmanı.
 *
 * 16.101 satırlık ReportsDashboard.tsx'ten çıkarıldı (2026-07-30). O dosya kod
 * tabanının en büyüğüydü; altı sekmenin 332 render bloğu dosya boyunca iç içe
 * dağılmıştı ama hepsi bu tek kapsamı kullanıyordu.
 *
 * Tüm state/memo/effect burada; sekme bileşenleri sonucu tek `ctx` nesnesi
 * olarak alır. ReportsCtx tipi ReturnType ile OTOMATİK türetilir — 47 alanı
 * elle yazıp senkron tutma yükü yok.
 */
// `itemPriceTRY` YEREL bağlamadan DÜŞTÜ (6a): gövdedeki iki kullanımı (:233, :239)
// `kartSatisTL`e geçti — `itemPriceTRY` çevrilemeyen/kursuz karta 0 döndüğü için kalem
// toplamdan SESSİZCE düşüyordu. `itemCostTRY` KALIR: aşağıda `brutMarj` imzasında
// `Parameters<typeof itemCostTRY>` olarak KULLANILIYOR (284'teki yeniden dışa aktarım
// yerel bağlama oluşturmaz; bu satırdan silinirse tsc orada kırılır).
import { itemCostTRY, kartMaliyetiTL, kartSatisTL } from '../../utils/cost';
import { brutMarjHesabi, stokMaliyetCozucu, type BrutMarjSonucu } from '../../utils/pano/raporMarj';
import { siparisTarih } from '../../utils/siparis';
import { useState, useEffect, useMemo } from 'react';
import { zamanMs } from '../../utils/zaman';
import { pdfBaslik, pdfAltBilgi, pdfTabloStili } from '../../utils/pdfTheme';
import { format } from 'date-fns';
import { tr, enUS } from 'date-fns/locale';
// jspdf + Türkçe font TIKLAMA ANINDA dinamik yüklenir (2026-08-31 performans):
// statik import, Raporlar sekmesi açılır açılmaz 1.5 MB indiriyordu.
import {
  collection, onSnapshot, query, where,
} from '../../lib/dbClient';
import { db, auth } from '../../firebase';
import { logFirestoreError as importedLogFirestoreError, OperationType } from '../../utils/firebase';
import { sortByCreatedAt } from '../../utils/fsSort';
import { formatInCurrency, kisaTutar } from '../../utils/currency';
// `sayiSirala` bu dosyadan DÜŞTÜ (6a): tek kullanımı `topCustomers` sıralamasıydı, o da artık
// `rapor/musteri.ciroSirali` içinde — AYNI kural (bilinmeyen her yönde sonda), kopya sıralama yok.
import { tutarYaz, ekranTutari, type Tutar } from '../../utils/para';
import { raporSiparisi, raporCirosu, ortalamaSiparis, BOS_TUTAR, kovayaEkle, grafikDegeri, type RaporSiparisi } from '../../utils/pano/raporVeriKatmani';
// Faz 3 6a — saf rapor yardımcıları (hepsi testli; bu dosya yalnız BAĞLAR, hesap YAZMAZ).
import { adetSay, sayimSatirlari } from '../../utils/rapor/sayac';
import { odenenBordro, bordroTrendi, departmanAnahtari, type BordroTrendSatiri } from '../../utils/rapor/ikBordro';
import { grupStokDegeri, type StokGrubu } from '../../utils/rapor/stokDeger';
import { musteriOzeti, ciroSirali, type KimlikliSiparis } from '../../utils/rapor/musteri';
import { stokDurumu } from '../../utils/pano/finansKpi';
import { oc } from '../../i18n/ortak';
import {
  type Order,
  type Employee,
  type Quotation,
  type InventoryItem,
  type InventoryMovement,
} from '../../types';

// ── Module-level helpers ───────────────────────────────────────────────────────

// itemCostTRY / itemPriceTRY BURADAN KALDIRILDI (2026-08-26).
// Uc ayri kopyasi vardi (burasi, src/utils/cost.ts, src/pages/OrdersPage.tsx)
// ve UCU DE ayni hatayi tasiyordu: kur yoksa `?? 1` ile $100 maliyet ₺100
// sayiliyordu (~40 kat dusuk maliyet -> siskin marj). Tek kaynak artik
// src/utils/cost.ts; oradaki surum cevrilemeyeni 0 sayar ve
// `cevrilemeyenler()` ile kac kalemin disarida kaldigini bildirir.
// Yeniden disa aktarim korundu: 6 rapor dosyasi bunlari buradan import ediyor.

/**
 * `Order.syncedAt` / `Order.createdAt` types.ts'te `unknown` tipli (kaynaga gore
 * Timestamp | ISO string | epoch ms | Date gelebiliyor); `zamanMs` ise disa
 * aktarilmayan bir "zaman benzeri" birlesim bekliyor. Bu sarmalayici YALNIZ tipi
 * daraltir, DAVRANISI DEGISTIRMEZ: taninmayan deger `zamanMs`'in kendisi gibi
 * `null` doner — asla "simdi"ye dusmez.
 */
const zamanMsBilinmeyen = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number' || v instanceof Date) return zamanMs(v);
  if (typeof v !== 'object') return null; // boolean/function/symbol: zamanMs de null dondururdu
  const zamanBenzeri = v as { toMillis?: () => number; toDate?: () => Date };
  return zamanMs(zamanBenzeri);
};

// ── CRM "En Çok Sipariş Veren Müşteriler" — SAF çekirdek (hook DIŞINDA, testli) ─────────────
//
// NEDEN HOOK GÖVDESİNDE DEĞİL (2026-09-20 hakem turu): K2 süzgeci ile K4 gruplaması burada
// ÇAĞIRANIN sorumluluğundadır (`musteriOzeti` sipariş durumu OKUMAZ) ve hook gövdesinde
// dururken hiçbir test onu sabitlemiyordu — süzgeci silen mutasyon (`musteriOzeti(orders, …)`)
// tüm paketi YEŞİL bırakıyordu (Şirin İnşaat'ın 100.000 TL 'Delivered' + 80.000 TL 'Cancelled'
// siparişi 180.000 TL / 2 sipariş olarak basılırdı). `rapor6a.degismez.test.ts` §4'ün
// "K2 … `raporCirosu`'nun birim testinde korunur" cümlesi KPI cirosu için doğru, bu panel için
// YANLIŞTI: `topCustomers` `raporCirosu`'ndan GEÇMİYOR. Ölçüsü: `useReportsData.test.ts`.
//
// K2 — kullanıcı: "İptaller ciroya girsin mi → hayır." Rapor ekranlarında ciro = iptaller
//      HARİÇ, tek kural (`raporVeriKatmani.raporCirosu` ile AYNI süzgeç: `status !== 'Cancelled'`).
//      Süzgeç ÇAĞIRANDA durur: `musteriOzeti` sipariş durumu OKUMAZ ve iptali `tutarSec` içinde
//      NaN'a çevirmek YASAK — o, `ciro.bilinmeyen`'i şişirip "N kayıt tutarsız" notunu yalancı yapar.
//      `count` de iptaller HARİÇ; yalnız iptal siparişi olan müşteri listeden DÜŞER (beklenen).
// K4 — kullanıcı: "Müşteriyi adla mı kimlikle mi gruplayacağız → kimlikle." Kimlik = müşteri
//      kaydı (leadId) ya da Mikro cari kodu; AD yalnız kimliği olmayan siparişte yedek; ikisi de
//      yoksa "kimliksiz N sipariş" NOTU (satır değil). "Aynı müşterinin Cetpa kaydı ile Mikro
//      carisi mikroCariKod bağıyla TEK müşteri sayılır." → bağ = `leadCariKodu` parametresi
//      (haritayı RaporlarPage kurar). KARARLAR metnindeki `customerId` siparişe hiçbir yazıcı
//      tarafından YAZILMIYOR → zincire alınmadı (var olmayan alanı okumak sahte güvendir).

/** Girdi YAPISAL: kanonik `Order`, faturadan türetilen sipariş ve sentetik Mikro kaydı uyar. */
export interface MusteriListesiSiparisi extends KimlikliSiparis, RaporSiparisi {
  /** `zamanMs` ile çözülür ve YALNIZ görünen ad seçimini besler — tutar/adet/sıra tarihten BAĞIMSIZDIR. */
  createdAt?: unknown;
}

/** `topCustomers` satırı. `name`/`total`/`count`/`bilinmeyen` CrmOzetBolumu sözleşmesi; `anahtar` ADDITIVE (React key — ekrana BASILMAZ). */
export interface TopMusteriSatiri {
  name: string;
  anahtar: string;
  total: number;
  count: number;
  bilinmeyen: number;
}

export interface MusteriListesiSonucu {
  /** Ciroya göre azalan EN ÇOK 8 satır (tutarı bilinmeyen müşteri SONDA — `ciroSirali`). */
  satirlar: TopMusteriSatiri[];
  /** K4 notu (SATIR DEĞİL): kimliği de adı da olmayan sipariş ADEDİ. */
  kimliksiz: number;
}

/** Kaç satır gösterilir (ekran kabı `max-h-[280px]`; PARİTE — eski `.slice(0, 8)`). */
const TOP_MUSTERI_SATIRI = 8;

export function musteriListesi(
  siparisler: readonly MusteriListesiSiparisi[],
  leadCariKodu?: ReadonlyMap<string, string>,
): MusteriListesiSonucu {
  const ozet = musteriOzeti(
    siparisler.filter(o => o.status !== 'Cancelled'),        // K2 — `raporCirosu`'nunkiyle BİREBİR ifade
    { tutarSec: raporSiparisi, tarihSec: o => zamanMs(o.createdAt), leadCariKodu },
  );
  // Sıra `rapor/musteri.ciroSirali`'de: `sayiSirala(..., true)` — tutarı bilinmeyen müşteri AZALANDA DA
  // sonda (eski `b.total - a.total` NaN üretip sıralamayı bozuyordu). Yönü `-cmp` ile ÇEVİRME.
  return {
    satirlar: ciroSirali(ozet.musteriler).slice(0, TOP_MUSTERI_SATIRI).map(m => ({
      name: m.ad ?? (m.tur === 'cari' ? m.kimlik : '—'),     // GÖRÜNEN AD (`m.ad` string | null). Adsız `cari`
                                                             // satırı bugünkü gibi KODU gösterir; adsız `kayit`
                                                             // satırında lead id'si BASILMAZ → '—'.
      anahtar: m.anahtar,
      total: ekranTutari(m.ciro), count: m.adet, bilinmeyen: m.ciro.bilinmeyen,
    })),
    kimliksiz: ozet.kimliksiz,
  };
}

export type ReportsProps = {orders: Order[], inventory: InventoryItem[], exchangeRates: Record<string, number> | null, currentT: Record<string, string>, currentLanguage: string, userRole?: string | null, onNavigate?: (tab: string) => void, /** Rapor kartından CRM→Müşteriler'e in (ad ile filtreli) — 2026-08-31 kullanıcı isteği. */ onMusteriAc?: (ad: string) => void,
  /**
   * K4 bağı: lead.id → lead.mikroCariKod (`rapor/musteri.leadCariKoduHaritasi(leads)` çıktısı).
   * VERİLMEZSE Cetpa kaydı ile Mikro carisi BİRLEŞTİRİLMEZ (uydurma bağ yok). Haritayı KURAN bu
   * dosya değil: `leads`'e sahip olan `RaporlarPage` kurar ve `<ReportsDashboard>`'a geçirir.
   * Tip `MusteriCozumSecenegi.leadCariKodu` ile AYNI ad/şekil.
   */
  leadCariKodu?: ReadonlyMap<string, string>, employees: Employee[], quotations?: Quotation[], inventoryMovements?: InventoryMovement[], recurringOrders?: Array<{ id: string; templateName: string; customerName: string; totalPrice: number; frequency: 'weekly' | 'monthly' | 'quarterly'; nextDue: string; active: boolean }>, externalTab?: 'genel'|'crm'|'envanter'|'lojistik'|'ik'|'urunler'|'analitik', setExternalTab?: (t: 'genel'|'crm'|'envanter'|'lojistik'|'ik'|'urunler'|'analitik') => void};

// `leadCariKodu` yıkımında VARSAYILAN YOK: `= new Map()` yazılsaydı her render'da yeni nesne
// üretilip aşağıdaki `useMemo` bağımlılığını boşa düşürürdü; `undefined` zaten "bağ yok"tur.
export function useReportsData({ orders, inventory, exchangeRates, currentT, currentLanguage, userRole, onNavigate, onMusteriAc, leadCariKodu, employees, quotations = [], inventoryMovements = [], recurringOrders = [], externalTab, setExternalTab }: ReportsProps) {
  const [timeRange, setTimeRange] = useState('30');
  const [revenueCurrency, setRevenueCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const [_localReportsTab, _setLocalReportsTab] = useState<'genel'|'crm'|'envanter'|'lojistik'|'ik'|'urunler'|'analitik'>('genel');
  const reportsTab = externalTab ?? _localReportsTab;
  const setReportsTab = (t: 'genel'|'crm'|'envanter'|'lojistik'|'ik'|'urunler'|'analitik') => { _setLocalReportsTab(t); setExternalTab?.(t); };
  const [invSummarySort, setInvSummarySort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'name', dir: 'asc'});
  const [logisticsSummarySort, setLogisticsSummarySort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'customerName', dir: 'asc'});
  // fmtAna uses revenueCurrency (same as the per-card toggle — no separate global state needed)
  //
  // İMZA KORUNDU, GÖVDE TEK KAYNAĞA DEVREDİLDİ (2026-09-05, Faz 2 para biçimi):
  // eskiden burada sembol/locale seçimi + toLocaleString/toFixed kopyası vardı;
  // artık `kisaTutar` (src/utils/currency.ts) yazıyor. Davranış: TL girdisi
  // seçili birime `kurCevir` ile çevrilir, kur yoksa '—' (sahte kur SABİTİ YOK —
  // `?? 38`/`?? 41` 2026-08-26'da kaldırılmıştı), 'K' → '₺12,5K' (yerel ondalık
  // ayracı; eski `toFixed` nokta basıyordu), 'full' → tam sayı gruplaması.
  //
  // '—' GÜVENLİ (2026-08-26 ölçüldü): fmtAna'nın 211 çağırma yerinin tamamı JSX
  // içinde salt gösterim. Hiçbir CSV/PDF hücresine ya da hesaba akmıyor —
  // aşağıdaki exportPDF ham TL tutarı kendi yazıyor.
  const fmtAna = (v: number, fmt: 'full' | 'K' = 'full', decimals = 0): string =>
    kisaTutar(v, { fmt, ondalik: decimals, birim: revenueCurrency, rates: exchangeRates });

  // HR Data for Reports
  const [hrStats, setHrStats] = useState({
    activeEmployees: 0,
    // `totalPayroll` BAŞLANGIÇTA NaN: dinleyici henüz veri getirmedi — "₺0 maaş ödendi"
    // DEĞİL, "bilinmiyor". Ekran NaN'ı '—' basar (formatInCurrency); gerçek veri gelince
    // `ekranTutari(od.tutar)` ile kısmi toplama döner.
    totalPayroll: NaN,
    pendingLeave: 0,
    departmentDistribution: [] as { name: string, value: number }[],
    // recharts `value: null` noktayı ATLAR (0 çizmez); `bilinmeyen` kaç bordronun
    // tutarının okunamadığını söyler (ekran notu 6l'de basılır).
    payrollTrend: [] as { name: string, value: number | null, bilinmeyen: number }[]
  });
  /** İK kadro sayaçları — departmanı girilmemiş çalışan adedi (dilim değil, NOT olur; 6l). */
  const [kadro, setKadro] = useState<{ departmansiz: number }>({ departmansiz: 0 });
  /**
   * Bordro okuma katmanı (`rapor/ikBordro`). `odenen: null` = `payrolls` dinleyicisi henüz
   * veri getirmedi — YÜKLENMEDİ ≠ ₺0. `trendDovizli` / `donemsiz`: trend çubuklarına
   * girmeyen kayıt adetleri (ekran notu 6l'de).
   */
  const [bordro, setBordro] = useState<{
    odenen: { tutar: Tutar; dovizli: number } | null;
    trend: BordroTrendSatiri[];
    donemsiz: number;
    trendDovizli: number;
  }>({ odenen: null, trend: [], donemsiz: 0, trendDovizli: 0 });

  useEffect(() => {
    if (!employees) return;
    const active = employees.filter(e => e.status === 'Aktif').length;
    // P1 · departman pastası — sayım TEK KAYNAKTAN (`rapor/sayac.adetSay`).
    // Eski `acc[e.department] = (acc[e.department] || 0) + 1` departmanı boş çalışanı
    // 'undefined' ADLI bir dilim yapıyordu; artık hiçbir kovaya girmez ama SAYILIR ve
    // dürüst bir 'Belirtilmemiş' dilimi olarak basılır. 'Satış ' ile 'Satış' tek dilim (trim).
    const departmanSayimi = adetSay(employees, departmanAnahtari);
    setKadro({ departmansiz: departmanSayimi.anahtarsiz });
    setHrStats(prev => ({
      ...prev,
      activeEmployees: active,
      // Etiket ORTAK sözlükten (ortak.ts:552 'Belirtilmemiş' / :1173 'Not specified') —
      // satır içi tr/en çifti YAZILMAZ, `ortak.degismez.test.ts` onu kırar.
      departmentDistribution: sayimSatirlari(departmanSayimi, { anahtarsizEtiketi: oc(currentLanguage).belirtilmemis })
    }));
    // `currentLanguage` bağımlılıkta ŞART: anahtarsız dilimin etiketi artık DİLE bağlı;
    // dizi genişlemezse dil değişince pasta dilimi eski dilde kalır (effect yeniden koşmaz).
  }, [employees, currentLanguage]);

  useEffect(() => {
    if (reportsTab !== 'ik' || !userRole) return;

    const unsubLeave = onSnapshot(query(collection(db, 'leaveRequests'), where('status', '==', 'Bekliyor')), (snap) => {
      setHrStats(prev => ({ ...prev, pendingLeave: snap.size }));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'leaveRequests', auth.currentUser?.uid));

    const unsubPayroll = onSnapshot(collection(db, 'payrolls'), (snap) => {
      // `sortByCreatedAt` KALIR (zararsız): trend sırası artık ona bağlı değil, `bordroTrendi`
      // çubukları dönem anahtarına göre KRONOLOJİK veriyor.
      const pays = sortByCreatedAt(snap.docs.map(d => d.data()));
      // P2 · `rapor/ikBordro`: `netSalary` okunamayan bordro ₺0 SAYILMAZ, sayılır; ay/yıl'ı
      // çözülemeyen kayıt 'undefined/undefined' çubuğu üretmez, `donemsiz`e düşer.
      const od = odenenBordro(pays);
      const bordroTrend = bordroTrendi(pays);
      setBordro({ odenen: od, trend: bordroTrend.satirlar, donemsiz: bordroTrend.donemsiz, trendDovizli: bordroTrend.dovizli });

      setHrStats(prev => ({
        ...prev,
        totalPayroll: ekranTutari(od.tutar),
        // Etiket `M/YYYY` AYNEN (parite); değişen tek şey SIRA (artık kronolojik).
        payrollTrend: bordroTrend.satirlar.map(s => ({ name: `${s.ay}/${s.yil}`, value: grafikDegeri(s.tutar), bilinmeyen: s.tutar.bilinmeyen }))
      }));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'payrolls', auth.currentUser?.uid));

    return () => {
      unsubLeave();
      unsubPayroll();
    };
  }, [reportsTab, userRole]);

  // KPI Calculations
  // Ciro artık `Tutar`: EKRAN kısmi toplamı gösterebilir (+ "N kayıt tutarsız" notu),
  // TÜRETME (ortalama sipariş) gösteremez. İptal süzgeci `raporCirosu` içinde.
  // Eski `Number(o.totalPrice) || 0`, Mikro pseudo-siparişinden gelen NaN'ı
  // "₺0 biliniyor"a çevirip ciroyu sessizce EKSİK gösteriyordu.
  const ciroTutar = useMemo(() => raporCirosu(orders), [orders]);
  const totalRevenueTRY = ekranTutari(ciroTutar);
  const revenueSymbol = revenueCurrency === 'USD' ? '$' : revenueCurrency === 'EUR' ? '€' : '₺';
  // `exchangeRates` prop'u kur YOKKEN null; formatInCurrency imzasi `?: ExchangeRates`.
  // `?? undefined` yalniz TIP koprusu: iki degerde de `exchangeRates?.[currency]`
  // undefined verip fonksiyon '—' donuyor (kur uydurulmuyor).
  const fxKurlari = exchangeRates ?? undefined;
  const revenueFormatted = formatInCurrency(totalRevenueTRY, revenueCurrency, fxKurlari);
  const totalOrders = orders.length;
  // TÜRETME (`tamTutar`): tek sipariş bile tutarsızsa ortalama HESAPLANMAZ ('—').
  // Bölen PARİTE için değiştirilmedi (`totalOrders` iptalleri de sayıyor; pay saymıyor).
  const avgOrderValueTRY = ortalamaSiparis(ciroTutar, totalOrders);
  const avgOrderFormatted = formatInCurrency(avgOrderValueTRY, revenueCurrency, fxKurlari);
  // P3 · Düşük stok — TEK TANIM (`pano/finansKpi.stokDurumu`, testli). Eski satır
  // `i.stockLevel <= i.lowStockThreshold` idi: seviyesi ya da eşiği OKUNAMAYAN kartta
  // karşılaştırma sessizce `false` verip kartı "sorunsuz" sayıyordu. Yeni hesap eşik
  // zincirini (`lowStockThreshold → minStock`) ve seviye zincirini (`stockLevel → stock`)
  // kullanır, çözülemeyenleri `seviyesiBilinmeyen`/`esigiBilinmeyen` sayaçlarında bildirir
  // → SAYI DEĞİŞEBİLİR; notu basan ekranlar `stokDurum`u ctx'ten alır.
  const stokDurum = useMemo(() => stokDurumu(inventory), [inventory]);
  const lowStockItems = stokDurum.esikAltinda.length;

  // Sales Trend Data
  const salesByDate = useMemo(() => orders.reduce((acc: Record<string, { label: string; tutar: Tutar }>, o) => {
    let dateKey = 'unknown';
    let label = currentT.unknown;
    // syncedAt YOKSA createdAt'e dus (2026-08-24 tarih denetimi): pazaryeri
    // siparisleri (Shopify/Trendyol/Hepsiburada) sunucuda `syncedAt` alani
    // OLMADAN yaziliyor. Eskiden yalniz syncedAt'e bakildigi icin bu siparislerin
    // TAMAMI — gecerli bir createdAt'leri oldugu halde — tek bir 'unknown'
    // kovasina dokuluyordu: gunluk ciro trendinde kalici, sisirilmis bir
    // "bilinmeyen" cubugu, gercek gunler ise eksik gorunuyordu.
    const ms = zamanMsBilinmeyen(o.syncedAt) ?? zamanMsBilinmeyen(o.createdAt);
    if (ms !== null) {
      try {
        const d = new Date(ms);
        dateKey = format(d, 'yyyy-MM-dd');
        label = format(d, 'dd MMM', { locale: currentLanguage === 'tr' ? tr : enUS });
      } catch (e) {
        console.error("Error formatting date:", e);
      }
    }
    // Kova: bilinenler toplanır, tutarı okunamayan sipariş ₺0 sayılmaz — SAYILIR.
    // `BOS_TUTAR` donuk; `kovayaEkle` her zaman YENİ nesne döndürür (kovalar kirlenmez).
    if (!acc[dateKey]) acc[dateKey] = { label, tutar: BOS_TUTAR };
    acc[dateKey].tutar = kovayaEkle(acc[dateKey].tutar, raporSiparisi(o));
    return acc;
  }, {}), [orders, currentT, currentLanguage]);

  const trendData = useMemo(() => Object.entries(salesByDate)
    .sort(([keyA], [keyB]) => {
      if (keyA === 'unknown') return 1;
      if (keyB === 'unknown') return -1;
      return keyA.localeCompare(keyB);
    })
    // recharts: hiç bilinen tutarı olmayan gün `null` — 0 DEĞİL. 0, çizgiyi sıfıra
    // çakıp "o gün satış yok" diye YANLIŞ bilgi verirdi; `null` noktayı atlatır.
    .map(([, val]) => ({ name: val.label, value: grafikDegeri(val.tutar), bilinmeyen: val.tutar.bilinmeyen }))
    .slice(-30), [salesByDate]);

  // Category Data — P5 (kategori ADEDİ) + P7 (kategori/toplam DEĞERİ) TEK çağrıda.
  //
  // Eskiden aynı envanter ÜÇ kez, üç ayrı kuralla taranıyordu ve üçü de "bilinmeyen = 0"
  // sayıyordu: korumasız `acc[cat] += item.stockLevel` stoğu okunamayan TEK kart yüzünden
  // tüm kategoriyi NaN yapıyor, `itemPriceTRY` ise kuru çevrilemeyen kaleme 0 döndüğü için
  // onu toplamdan SESSİZCE düşürüyordu (2026-08-22 denetim bulgusu C3: `prices['Retail']`
  // ham okunup `priceCurrency` yok sayılıyor, $100 → ₺100 sayılıyordu; kur çeviren sürüm
  // `kartSatisTL` — çevrilemeyene `null` döner, `itemPriceTRY` 0 dönüyordu).
  //
  // K8 ARA DURUM — KARAR VERİLDİ, 6h'de uygulanacak. Kullanıcı: "alış günü maliyetinin dolar
  // kurundan çek, bugünün dolar kuru ile ver - ikisini de tabloda göster." 6a'da taban
  // DEĞİŞMEZ (PARİTE): birim değer = PERAKENDE ('Retail') SATIŞ fiyatının TL karşılığı —
  // MALİYET DEĞİL. `totalInventoryValueTRY` "stok maliyeti" diye OKUNMAMALI.
  //
  // ETİKET GRUPLAMADAN ÖNCE uygulanır: gerçek 'Diğer' kategorisi ile boş kategori bugün TEK
  // kovada birleşiyor (`item.category || currentT.other`). Etiket gruplamadan SONRA basılsaydı
  // ikisi aynı ada ÇARPIŞIR, `Object.fromEntries` birini SESSİZCE ezer ve pastada iki 'Diğer'
  // dilimi çıkardı.
  const stokOzet = useMemo(() => {
    const kategoriEtiketi = (i: InventoryItem): string => {
      const k = typeof i.category === 'string' ? i.category.trim() : '';
      return k !== '' ? k : currentT.other;                                   // translations.ts:219 'Diğer' / :536 'Other'
    };
    return grupStokDegeri(inventory, kategoriEtiketi, i => kartSatisTL(i, 'Retail', exchangeRates));
  }, [inventory, exchangeRates, currentT.other]);
  // Bu çağrıda `anahtar: null` grubu OLUŞMAZ (etiket yukarıda uygulandı); `??` yalnız TİP
  // köprüsü (`string | null` → `string`), sayısal bir varsayılan DEĞİL.
  const katAd = (g: StokGrubu): string => g.anahtar ?? currentT.other;
  const categoryChartData = stokOzet.gruplar.map(g => ({ name: katAd(g), value: grafikDegeri(g.adet), bilinmeyen: g.adet.bilinmeyen }));
  const categoryData = Object.fromEntries(stokOzet.gruplar.map(g => [katAd(g), ekranTutari(g.adet)]));

  // --- CRM sub-data ---
  const durumSayim = useMemo(() => adetSay(orders, o => o.status), [orders]);
  const ordersByStatus = Object.fromEntries(durumSayim.sayilar);
  // Etiket VERİLİR (delta 2026-09-22): etiketsiz çağrıda durumu okunamayan sipariş HİÇBİR dilime
  // girmiyordu ve `durumSayim.anahtarsiz` de hiçbir nota bağlı değildi — pastanın dilim toplamı
  // sipariş sayısından SESSİZCE düşüyordu (eski `acc[o.status]` en azından görünür bir 'undefined'
  // dilimi çiziyordu). `Order.status` TS'te zorunlu ama PG satırı bunu garanti etmez (CLAUDE.md).
  // Modülün sözleşmesi: "ya dürüst bir Belirtilmemiş dilimi çiz ya da kapsam notu bas" — dilim
  // seçildi, çünkü aynı diziyi İKİ ekran (CrmOzetBolumu:103, LojistikRapor:80) okuyor ve not
  // yalnız birinde vardı (yarım düzeltme sınıfı). Etiket ORTAK sözlükten; `currentLanguage`
  // değişince satır içi tr/en çifti yazılmaz (`ortak.degismez.test.ts` onu kırar).
  const statusChartData = sayimSatirlari(durumSayim, { anahtarsizEtiketi: oc(currentLanguage).belirtilmemis });
  // K2 + K4 hesabı `musteriListesi`'nde (bu dosyanın başı, hook DIŞINDA — testi `useReportsData.test.ts`):
  // süzgeç hook gövdesinde dururken hiçbir test onu sabitlemiyordu. `name`/`total`/`count` KORUNDU
  // (CrmOzetBolumu bunları okuyor; `total` → formatInCurrency → NaN'da '—'); `bilinmeyen` + `anahtar` ADDITIVE.
  // `leadCariKodu` bağımlılıkta: lead'e cari kodu bağlanınca liste yeniden kurulmalı.
  const musteriListe = useMemo(() => musteriListesi(orders, leadCariKodu), [orders, leadCariKodu]);
  const topCustomers = musteriListe.satirlar;
  // K4 notu (SATIR DEĞİL): kimliği de adı da olmayan sipariş ADEDİ. Düz sayı → useMemo gerekmez.
  const musteriKimliksiz = musteriListe.kimliksiz;

  // --- Inventory sub-data --- (kaynak: yukarıdaki TEK `stokOzet` çağrısı)
  // EKRAN toplamı: `ekranTutari` — hiç bilinen kalem yoksa NaN → '—'; bilinen varsa KISMİ
  // toplam + `stokOzet.toplamDeger.bilinmeyen` sayacı (notu basan KPI ipucu 6h'de).
  const totalInventoryValueTRY = ekranTutari(stokOzet.toplamDeger);
  // Grafik dizisi DOĞRUDAN gruplardan üretilir: `fromEntries` → `Object.values` gidiş-dönüşü
  // bir ad çarpışmasında satır kaybettirirdi. Boş kategori etiketi artık iki grafikte de AYNI
  // (`currentT.other`); eskiden adet tablosunda 'Other', değer tablosunda sabit 'Diğer'di.
  const categoryValueChartData = stokOzet.gruplar.map(g => ({ name: katAd(g), count: grafikDegeri(g.adet), value: grafikDegeri(g.deger) }));
  const categoryValueData = Object.fromEntries(categoryValueChartData.map(s => [s.name, s]));

  const COLORS = ['#ff4000', '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#00C7BE', '#FF2D55'];

  const exportPDF = async () => {
    const [{ jsPDF }, { default: autoTable }, { registerTurkishFont }] = await Promise.all([
      import('jspdf'), import('jspdf-autotable'), import('../../utils/pdfFont'),
    ]);
    const doc = new jsPDF();
    await registerTurkishFont(doc);
    // Marka basligi + tablo stili ORTAK temadan (src/utils/pdfTheme.ts).
    // Bu belge 2026-08-22'ye kadar duz metin baslik ve autoTable'in VARSAYILAN
    // MAVI tablo basligiyla cikiyordu — teklif/siparis kirmizi kurumsal
    // kimlikteyken bu rapor bambaska gorunuyordu.
    const govdeY = pdfBaslik(doc, {
      belgeAdi: currentT.report_title || 'SATIŞ RAPORU',
      meta: format(new Date(), 'dd.MM.yyyy'),
    });
    autoTable(doc, {
      ...pdfTabloStili(),
      head: [[currentT.customer, currentT.amount, currentT.status, currentT.date]],
      body: orders.map(o => [
        o.customerName,
        // PDF 'TL' soneki TEK KAYNAK: utils/para.tutarYaz (pdf.ts ile ayni). Bicim
        // degismedi ('80.000,02 TL'); bilinmeyen tutar '—' (eskiden `|| 0` → '0,00 TL').
        tutarYaz(o.totalPrice, 'TL'),
        currentT[o.status.toLowerCase()] || o.status,
        (() => { const d = siparisTarih(o); return d ? format(d, 'dd.MM.yyyy') : '—'; })(),   // syncedAt yoksa createdAt/orderDate (2026-09-04)
      ]),
      startY: govdeY,
    });
    pdfAltBilgi(doc);
    doc.save(`cetpa-rapor-${format(new Date(), 'dd-MM-yyyy')}.pdf`);
  };


  // ctx sözleşmesi (6/n): eski alanlar SİLİNMEZ/yeniden adlandırılmaz — yeni `Tutar` alanlarından
  // TÜRETİLİR, böylece henüz dokunulmamış sekme dosyaları derlenmeye ve çalışmaya devam eder.
  // 6a'da EKLENENLER: bordro, kadro, stokOzet, stokDurum, musteriKimliksiz.
  return { orders, inventory, exchangeRates, currentT, currentLanguage, userRole, onNavigate, onMusteriAc, leadCariKodu, employees, quotations, inventoryMovements, recurringOrders, externalTab, setExternalTab, timeRange, setTimeRange, revenueCurrency, setRevenueCurrency, _localReportsTab, _setLocalReportsTab, reportsTab, setReportsTab, invSummarySort, setInvSummarySort, logisticsSummarySort, setLogisticsSummarySort, fmtAna, hrStats, setHrStats, kadro, bordro, ciroTutar, totalRevenueTRY, revenueSymbol, revenueFormatted, totalOrders, avgOrderValueTRY, avgOrderFormatted, lowStockItems, stokDurum, salesByDate, trendData, stokOzet, categoryData, categoryChartData, ordersByStatus, statusChartData, topCustomers, musteriKimliksiz, totalInventoryValueTRY, categoryValueData, categoryValueChartData, COLORS, exportPDF };
}

/** Sekme bileşenlerinin aldığı bağlam — hook'un dönüşünden otomatik türer. */
export type ReportsCtx = ReturnType<typeof useReportsData>;

export { itemCostTRY, itemPriceTRY, cevrilemeyenler, cevrilemeyenMesaji } from '../../utils/cost';

/**
 * brutMarj — TEK KAYNAK brüt marj hesabı (2026-09-04 denetimi).
 *
 * NEDEN VAR: marj kartları maliyeti `lineItems`ten topluyordu. Mikro
 * faturasından türetilen ve RaporlarPage'in sentetik olarak ürettiği
 * siparişlerde `lineItems` HİÇ YOKTUR — boş dizide `reduce` 0 döndüğü için
 * maliyet 0 sayılıyor ve marj **%100'e** şişiyordu. İnşaat malzemesi
 * toptancısında gerçek brüt marj %15-25'tir; kart "Ø %90+" diye zümrüt-yeşil
 * "sağlıklı" görünüyordu.
 *
 * KURAL (CLAUDE.md "sahte kesinlik gösterme"): kalem verisi olmayan sipariş
 * marj hesabına GİRMEZ ve `kapsamDisi` sayacıyla raporlanır — çağıran bunu
 * kullanıcıya söylemek zorundadır. Hiç kapsamlı sipariş yoksa `marj` null
 * döner ('—' göster, 0 veya 100 DEĞİL).
 *
 * Bu hesap dört ayrı kartta kopyalanmıştı (GenelBloklar1/2, IKRapor,
 * EnvanterRapor); her birine ayrı süzgeç eklemek "yarım düzeltme" üretirdi.
 *
 * ## 2026-09-19 düzeltici turu — hesap `src/utils/pano/raporMarj.ts`e TAŞINDI
 *
 * Buradaki gövde testsizdi ve üç sahte kesinlik taşıyordu; üçü de orada (testli) kapatıldı:
 *   • **Ciro/maliyet asimetrisi** — ciro `ekranTutari` ile tutarsız siparişi dışlarken maliyet
 *     aynı siparişi topluyordu; `ciro − maliyet` yazan tüketiciler kısmi cirodan TAM maliyeti
 *     çıkarıyordu. Artık `brutKar` alanı var ve İKİ taraf da tam bilinmiyorsa NaN döner —
 *     tüketiciler farkı ELLE HESAPLAMAMALI.
 *   • **`li.price * 0.6`** — katalogda eşleşmeyen kaleme uydurma %60 maliyet oranı.
 *   • **`itemCostTRY` 0 döner** — kuru çevrilemeyen / kartında maliyet olmayan kalem sessizce
 *     "bedelsiz" sayılıyordu. Artık `kartMaliyetiTL` (null = bilinmiyor) kullanılıyor.
 * Son ikisi Pano'nun Phase 124 panelinde zaten kaldırılmıştı: aynı sipariş Pano'da '— marj',
 * burada "%40" gösteriyordu. Yeni `maliyetTutar.bilinmeyen` sayacı kaç siparişin maliyetinin
 * çözülemediğini söyler; ekranlar bunu kullanıcıya YAZAR.
 */
export function brutMarj(
  list: Array<{ totalPrice?: number; lineItems?: Array<{ inventoryId?: string; name?: string; price: number; quantity: number; costPrice?: number }> }>,
  inventory: Parameters<typeof itemCostTRY>[0][],
  exchangeRates: Parameters<typeof itemCostTRY>[1],
): BrutMarjSonucu {
  // Hesap `src/utils/pano/raporMarj.ts`te (saf + testli). Burada yalnız kur çevrimi bağlanır:
  // `kartMaliyetiTL` bilinmeyen maliyete null döner — `itemCostTRY` 0 döndüğü için DOĞRUDAN
  // geçilemez (o 0 kalemi "bedelsiz" yapıp marjı şişiriyordu, cost.ts'te belgeli).
  return brutMarjHesabi(list, stokMaliyetCozucu(inventory, i => kartMaliyetiTL(i, exchangeRates)));
}
