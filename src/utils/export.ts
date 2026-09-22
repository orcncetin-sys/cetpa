/**
 * export.ts — CSV / spreadsheet export helpers
 *
 * Uses PapaParse (already in the bundle) to serialise data arrays to CSV,
 * then triggers a browser download.  No extra packages required.
 */

import Papa from 'papaparse';
import { gorunenSiparisNo, odemeTakipli } from './siparis';
import { gunAnahtari, bugunAnahtari } from './zaman';
import type { Order, Lead, InventoryItem } from '../types';
import { oc } from '../i18n/ortak';

// ── Generic download helper ───────────────────────────────────────────────────

function downloadCSV(csv: string, filename: string): void {
  const bom  = '\uFEFF'; // UTF-8 BOM — needed for Excel Turkish chars
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Orders ────────────────────────────────────────────────────────────────────

export function exportOrdersCSV(orders: Order[], lang: string = 'tr'): void {
  const tr = lang === 'tr';
  const rows = orders.map(o => ({
    [oc(tr).siparis_no]:        gorunenSiparisNo(o),
    [oc(tr).musteri]:         o.customerName,
    [oc(tr).musteri_tipi]:   o.customerType ?? '',
    [oc(tr).durum]:           o.status,
    // Mikro faturasından türetilen siparişte `paid` yokluğu 'ödenmedi' DEĞİL 'bilinmiyor'
    // (siparis.ts odemeTakipli). CSV eskiden hepsini 'Bekliyor' yazıyordu — ₺17,6M sahte
    // alacak arızasının dışa aktarım yüzeyi.
    [tr ? 'Ödeme Durumu'       : 'Payment Status']:  !odemeTakipli(o) ? (tr ? 'Bilinmiyor (Mikro)' : 'Unknown (Mikro)') : o.paid ? (oc(tr).odendi) : (tr ? 'Bekliyor' : 'Unpaid'),
    [tr ? 'Toplam (₺)'         : 'Total (₺)']:       o.totalPrice,
    [oc(tr).fatura_tipi]:    o.faturaTipi ?? (o.faturali ? 'e-fatura' : ''),
    [tr ? 'KDV %'              : 'VAT %']:           o.kdvOran ?? '',   // bilinmiyorsa BOŞ hücre, 0 değil (satır 94 dersi — yarım kalmıştı)
    [tr ? 'Kargo No'           : 'Tracking No']:     o.trackingNumber ?? '',
    [tr ? 'Kargo Firması'      : 'Carrier']:         o.cargoCompany ?? '',
    [oc(tr).teslimat_adresi]:o.shippingAddress ?? '',
    [oc(tr).olusturulma]:
      gunAnahtari(o.createdAt) ?? '',   // yerel gün; bilinmiyorsa BOŞ hücre (bugün DEĞİL)
    [oc(tr).notlar]:           o.notes ?? '',
  }));

  const csv = Papa.unparse(rows);
  downloadCSV(csv, `CETPA_Siparisler_${bugunAnahtari()}.csv`);
}

// ── Leads (CRM) ───────────────────────────────────────────────────────────────

export function exportLeadsCSV(leads: Lead[], lang: string = 'tr'): void {
  const tr = lang === 'tr';
  const rows = leads.map(l => ({
    [tr ? 'Ad Soyad'           : 'Name']:            l.name,
    [oc(tr).sirket]:         l.company,
    [oc(tr).durum]:          l.status,
    [oc(tr).e_posta]:           l.email ?? '',
    [oc(tr).telefon]:           l.phone ?? '',
    [oc(tr).kredi_limiti]:l.creditLimit ?? '',   // limit girilmemiş ≠ limit 0
    [tr ? 'Ödeme Vadesi'       : 'Payment Terms']:   l.paymentTerms ?? '',
    [tr ? 'Atanan'             : 'Assigned To']:     l.assignedTo ?? '',
    [tr ? 'AI Skoru'           : 'AI Score']:        l.score ?? '',
    [oc(tr).olusturulma]:
      gunAnahtari(l.createdAt) ?? '',   // yerel gün; bilinmiyorsa BOŞ hücre (bugün DEĞİL)
  }));

  const csv = Papa.unparse(rows);
  downloadCSV(csv, `CETPA_Musteriler_${bugunAnahtari()}.csv`);
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export function exportInventoryCSV(inventory: InventoryItem[], lang: string = 'tr'): void {
  const tr = lang === 'tr';
  const rows = inventory.map(i => ({
    [oc(tr).urun_adi]:    i.name,
    [tr ? 'SKU'                : 'SKU']:             i.sku,
    [oc(tr).kategori]:        i.category ?? '',
    // BOS ALAN 0 DEGIL, BOS HUCRE (2026-09-04 denetimi): `?? 0` yuzunden
    // "fiyat tanimli degil" ile "fiyati 0 TL" Excel'de ayirt edilemiyordu —
    // dis sisteme/musteriye giden dosyada bedava urun gibi gorunuyordu.
    // Bos hucre, hesap tablosunda toplama da girmez.
    [oc(tr).stok]:           i.stockLevel ?? '',
    [tr ? 'Min. Stok'          : 'Min. Stock']:      i.lowStockThreshold ?? '',
    [tr ? 'Fiyat - Perakende (₺)': 'Retail (₺)']:   i.prices?.['Retail']       ?? i.price ?? '',
    [tr ? 'Fiyat - B2B Std (₺)': 'B2B Std (₺)']:   i.prices?.['B2B Standard'] ?? '',
    [tr ? 'Fiyat - B2B Prem (₺)':'B2B Prem (₺)']:  i.prices?.['B2B Premium']  ?? '',
    [tr ? 'Fiyat - Bayi (₺)'  : 'Dealer (₺)']:      i.prices?.['Dealer']       ?? '',
    [oc(tr).depo]:       i.warehouseId ?? '',
    [oc(tr).tedarikci]:        i.supplier ?? '',
  }));

  const csv = Papa.unparse(rows);
  downloadCSV(csv, `CETPA_Envanter_${bugunAnahtari()}.csv`);
}

// ── Stock Movements ───────────────────────────────────────────────────────────

export interface StockMovementRow {
  id: string;
  productName: string;
  productId: string;
  type: 'in' | 'out' | 'adjustment';
  quantity: number;
  reason?: string;
  notes?: string;
  timestamp: string | { toDate?: () => Date };
}

export function exportStockMovementsCSV(movements: StockMovementRow[], lang: string = 'tr'): void {
  const tr = lang === 'tr';
  const rows = movements.map(m => {
    const tsStr = gunAnahtari(m.timestamp) ?? '';   // yerel gün; bilinmiyorsa BOŞ hücre
    return {
      [oc(tr).urun]:    m.productName,
      [oc(tr).tur]:       m.type === 'in' ? (oc(tr).giris) : m.type === 'out' ? (oc(tr).cikis) : (tr ? 'Düzeltme' : 'Adjustment'),
      [tr ? 'Miktar'       : 'Quantity']:   m.quantity,
      [oc(tr).sebep]:     m.reason ?? '',
      [oc(tr).notlar]:      m.notes ?? '',
      [oc(tr).tarih]:       tsStr,
    };
  });
  const csv = Papa.unparse(rows);
  downloadCSV(csv, `CETPA_Stok_Hareketleri_${bugunAnahtari()}.csv`);
}

// ── Inventory CSV Import Template ─────────────────────────────────────────────

export function downloadInventoryImportTemplate(): void {
  const headers = [
    'name', 'sku', 'category', 'stockLevel', 'lowStockThreshold',
    'price_Retail', 'price_B2B Standard', 'price_B2B Premium', 'price_Dealer',
    'supplier', 'warehouseId',
  ];
  const example = [
    'Örnek Ürün', 'SKU-001', 'Elektronik', '100', '10',
    '299.90', '249.90', '229.90', '199.90',
    'Tedarikçi A', 'depo-1',
  ];
  const csv = Papa.unparse([headers, example], { header: false });
  downloadCSV(csv, 'CETPA_Envanter_Sablon.csv');
}

// ── Monthly Summary ───────────────────────────────────────────────────────────

export interface MonthlySummaryRow {
  month: string;       // YYYY-MM — ya da SERBEST metin (çağıran '(tarihsiz)' satırı da yazabilir)
  /** K2: iptaller HARİÇ sipariş sayısı (süzgeç ÇAĞIRANDA — `raporCirosu` ile aynı kural). */
  orderCount: number;
  /** K2: o ay İPTAL edilen sipariş sayısı — `orderCount` / `revenue` / `revenueUnknown`'a GİRMEZ.
   *  Verilmediyse hücre BOŞ yazılır (çağıran ayırmadı — `0` UYDURULMAZ). */
  cancelledCount?: number;
  /** K2: iptaller HARİÇ ciro. */
  revenue: number;
  /** O ay İPTAL OLMAYAN siparişlerden tutarı okunamayanların sayısı — `revenue`'ya GİRMEDİ.
   *  (Tutarı okunamayan İPTAL burada SAYILMAZ; yalnız `cancelledCount`'ta — çift sayım yok.)
   *  Eksikse 0 sayılır (geriye uyum — aşağıdaki başlık notu). */
  revenueUnknown?: number;
  newLeads: number;
  delivered: number;
}

/**
 * monthlySummaryRows — Aylık Özet CSV'sinin SAF çekirdeği (Faz 3 6a, 2026-09-19).
 *
 * NEDEN VAR
 *  - `RaporlarPage.tsx` satır üreticisi tutarı okunamayan siparişi ciroya ₺0 olarak KATMIYOR
 *    (doğru) ama bunu yalnız `console.warn` ile söylüyordu: CSV'yi açan muhasebeci
 *    "Sipariş Sayısı 40 / Ciro ₺X" satırında cironun KISMİ olduğunu göremiyordu.
 *    EKRAN sözleşmesi (kısmi toplam + sayaç) dosya çıktısı için de geçerli → `revenueUnknown` sütunu.
 *  - KULLANICI KARARI K2 (2026-09-19) — «İptaller ciroya girsin mi → "hayır".» Aynı sayfadaki
 *    P603/P620 panelleri iptali zaten HARİÇ tutuyordu; bu CSV katıyordu → tek ekranda iki ciro
 *    tanımı vardı. Artık "Sipariş Sayısı" ve "Ciro" iptaller HARİÇ (süzgeç ÇAĞIRANDA), iptaller
 *    kaybolmasın diye AYRI `cancelledCount` sütununda SAYILIR.
 *  - Çekirdek saf/test edilebilir olsun diye ayrıldı: DOM ve indirme yok. `exportMonthlySummaryCSV`
 *    yalnız `Papa.unparse(monthlySummaryRows(...))` + eski indirme adımı — imzası, dosya adı,
 *    BOM ve ayracı AYNEN.
 *
 * PARİTE — iptal/okunamayan alanları VERİLMEYEN satırda eski beş sütun BİREBİR aynı değerlerle
 * ve eski sırada (Ay · Sipariş Sayısı · Ciro · Yeni Müşteri · Teslim Edilen); iki yeni sütun
 * aralarına girer. Mevcut beş başlığın METNİ değişmez — anlam değişikliğini yanındaki iptal
 * sütunu söyler. İki yeni sütun HER ZAMAN yazılır (hepsi 0/boş olsa da): koşullu sütun, dosyayı
 * işleyen Excel makrolarını ay ay kırar.
 *
 * BİLİNÇLİ FARKLAR
 *  - `cancelledCount` yok → hücre BOŞ; `revenueUnknown` yok → hücre 0. Asimetri KASITLI:
 *    eski sözleşmede `orderCount` iptalleri İÇERİYORDU, yani ayrılmamış bir satıra "0 iptal"
 *    yazmak sahte kesinlik olurdu. Okunamayan sayacında ise yokluk "sayılmadı" değil
 *    "eski çağıranın tutarsız kaydı yok" demektir (alan bugün eklendi, tek çağıran her zaman
 *    dolduruyor) ve 0 yazmak ciro hücresini yanlışlıkla BOŞALTMAZ.
 *  - ŞARTNAMEDEN SAPMA (6a): `revenue` sayı DEĞİLSE (NaN) hücre BOŞ yazılır. Şartname burada
 *    "bugünkü `Number(r.revenue.toFixed(2))` AYNEN" diyordu; o kod NaN'ı CSV'ye "NaN" METNİ
 *    olarak sızdırırdı. Modülün yasası "bilinmeyen sayı 0 değil, BİLİNMİYOR" ve bu modülde
 *    bilinmeyenin gösterimi boş hücredir. Şartnamedeki hiçbir vektör etkilenmez (tek çağıran
 *    yalnız `Number.isFinite` geçen tutarları topluyor) — davranış yalnız çağıran hatasında değişir.
 */
export function monthlySummaryRows(
  rows: readonly MonthlySummaryRow[],
  lang: string = 'tr',
): Record<string, string | number>[] {
  const tr = lang === 'tr';
  return rows.map(r => {
    const hamOkunamayan = r.revenueUnknown;
    // Geriye uyum (yukarıdaki "BİLİNÇLİ FARKLAR"): alan yoksa/bozuksa 0 — sayaç sütunu 0 yazar,
    // ciro hücresi bu yüzden boşalmaz. `Number.isFinite`, global `isFinite` DEĞİL (null'u 0'a zorlar).
    const okunamayan = typeof hamOkunamayan === 'number' && Number.isFinite(hamOkunamayan) ? hamOkunamayan : 0;

    const hamIptal = r.cancelledCount;
    const iptal = typeof hamIptal === 'number' && Number.isFinite(hamIptal) ? hamIptal : '';

    // Ayın HİÇ bilinen tutarı yoksa "₺0 ciro" sahte kesinliktir → BOŞ hücre; nedenini yandaki
    // sayaç sütunu söyler. `orderCount > 0` kapısı ŞART: K2 ile yalnız iptalden oluşan ay
    // (orderCount 0, cancelledCount 3) 0 === 0 ile yanlışlıkla boşalırdı — o ay gerçekten cirosuz.
    const hicBilinenYok = r.orderCount > 0 && okunamayan === r.orderCount;

    return {
      [oc(tr).ay]:            r.month,
      [tr ? 'Sipariş Sayısı'   : 'Order Count']:      r.orderCount,
      [tr ? 'İptal Edilen Sipariş' : 'Cancelled Orders']: iptal,
      // 2 ONDALIK ZORUNLU: ham sayi yazilinca hem gereksiz basamak hem de
      // KAYAN NOKTA HATASI CSV'ye siziyordu — canli ciktida "1174042.1400000001"
      // gorundu (2026-08-22). Para her zaman 2 hane.
      [tr ? 'Ciro (₺)'        : 'Revenue (₺)']:
        hicBilinenYok || !Number.isFinite(r.revenue) ? '' : Number(r.revenue.toFixed(2)),
      [tr ? 'Tutarı Okunamayan Sipariş' : 'Orders w/ Unreadable Amount']: okunamayan,
      [tr ? 'Yeni Müşteri'     : 'New Leads']:         r.newLeads,
      [oc(tr).teslim_edilen]:         r.delivered,
    };
  });
}

/**
 * Sıfır satırlı dışa aktarımın BAŞLIK satırı — `Papa.unparse([])` BOŞ METİN döndürür, yani
 * dosyada tek bir sütun başlığı bile olmaz (içerik yalnız BOM'dan ibaret kalır). Sipariş
 * listesi boş kiracı "Aylık Özet"e basınca Excel'de bomboş bir dosya görüyor ve dışa
 * aktarımın bozuk olduğunu sanıyordu; bunu söyleyen hiçbir uyarı da yoktu.
 *
 * KURAL: şema SATIR SAYISINA bağlı olamaz. `monthlySummaryRows` başlığındaki sözleşme —
 * "iki yeni sütun HER ZAMAN yazılır (hepsi 0/boş olsa da): koşullu sütun, dosyayı işleyen
 * Excel makrolarını ay ay kırar" — sıfır satırlı dosya için de geçerlidir.
 *
 * Başlık listesi ELLE YAZILMAZ: satır üreticisinin KENDİ çıktısından okunur (kopya bir başlık
 * listesi, sütun eklendiğinde sessizce bayatlar ve iki yüzey ayrışırdı).
 *
 * KAPSAM (yarım düzeltme uyarısı): aynı açık `exportOrdersCSV` / `exportLeadsCSV` /
 * `exportInventoryCSV` / `exportStockMovementsCSV` içinde DE VAR. Onların satır üreticisi
 * henüz saf bir fonksiyon değil (map gövdesi çağrının içinde) ve başlık şemasını fikstürsüz
 * üretmek için önce o ayrıştırma gerekiyor — ayrı bir alt fazın işi. Kapı burada TEK yerde
 * dursun diye `csvMetni` yazıldı: o üreticiler ayrıldığında aynı fonksiyona bağlanırlar.
 */
function csvMetni(
  satirlar: Record<string, string | number>[],
  basliklar: () => string[],
): string {
  return satirlar.length > 0 ? Papa.unparse(satirlar) : Papa.unparse({ fields: basliklar(), data: [] });
}

/** Başlık şemasını üretmek için kullanılan boş satır — değerleri değil, YALNIZ anahtarları okunur. */
const BOS_AY_SATIRI: MonthlySummaryRow = {
  month: '', orderCount: 0, cancelledCount: 0, revenue: 0, revenueUnknown: 0, newLeads: 0, delivered: 0,
};

export function exportMonthlySummaryCSV(rows: MonthlySummaryRow[], lang: string = 'tr'): void {
  const csv = csvMetni(
    monthlySummaryRows(rows, lang),
    () => Object.keys(monthlySummaryRows([BOS_AY_SATIRI], lang)[0]),
  );
  downloadCSV(csv, `CETPA_Aylik_Ozet_${bugunAnahtari()}.csv`);
}
