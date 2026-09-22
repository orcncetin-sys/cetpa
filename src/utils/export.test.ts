/**
 * export.test.ts — CSV dışa aktarım SAHTE KESİNLİK kapısı (Faz 1 3/n, 2026-09-05).
 *
 * Excel'e giden hücre ekran kadar "müşteriye giden" bir yüzeydir. Kilitlenen:
 *  - bilinmeyen sayı 0 DEĞİL boş hücre (kdvOran, creditLimit — 94. satırdaki 2026-09-04
 *    düzeltmesi bu iki alanda yarım kalmıştı),
 *  - Mikro faturasından türetilen siparişte ödeme durumu 'Bekliyor' DEĞİL 'Bilinmiyor'
 *    (₺17,6M sahte alacak arızasının dışa aktarım yüzeyi),
 *  - tarih bilinmiyorsa boş (bugün değil), Türkçe başlıklar; Excel için UTF-8 BOM (Blob'un ilk parçası).
 * Satır nesneleri `Papa.unparse` üzerinden yakalanır; Blob sarılır, indirme jsdom'da stub'lanır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Papa from 'papaparse';
import { exportOrdersCSV, exportLeadsCSV, exportInventoryCSV, exportMonthlySummaryCSV, monthlySummaryRows } from './export';
import type { Order, Lead, InventoryItem } from '../types';
import type { MonthlySummaryRow } from './export';

let satirlar: Record<string, unknown>[] = [];
let dosyaAdi = '';
let blobParcalari: unknown[] = [];
const GercekBlob = globalThis.Blob;
const spyler: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  satirlar = []; dosyaAdi = ''; blobParcalari = [];
  spyler.push(vi.spyOn(Papa, 'unparse').mockImplementation((r: unknown) => { satirlar = r as Record<string, unknown>[]; return 'csv'; }));
  Object.defineProperty(globalThis.URL, 'createObjectURL', { value: vi.fn(() => 'blob:x'), configurable: true });
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  spyler.push(vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { dosyaAdi = this.download; }));
  // Blob sarılır: BOM'un GERÇEKTEN ilk parça olduğu ölçülsün (docstring iddiası, inceleme).
  globalThis.Blob = class extends GercekBlob { constructor(parcalar?: BlobPart[], secenek?: BlobPropertyBag) { super(parcalar, secenek); blobParcalari = parcalar ?? []; } } as typeof Blob;
});
afterEach(() => {
  // YALNIZ kendi spy'larımız — `vi.restoreAllMocks()` setup.ts'teki global console.warn
  // susturucusunu da geri alıyordu (inceleme), sonraki testler gürültüye boğuluyordu.
  spyler.splice(0).forEach(sp => sp.mockRestore());
  globalThis.Blob = GercekBlob;
  const u = globalThis.URL as unknown as Record<string, unknown>;
  delete u.createObjectURL; delete u.revokeObjectURL;
});

const siparis = (ek: Partial<Order>): Order => ({
  id: 'ord1', customerName: 'Akdeniz İnşaat', status: 'Delivered', totalPrice: 1200, lineItems: [], ...ek,
} as unknown as Order);

describe('exportOrdersCSV', () => {
  it("KDV oranı bilinmiyorsa hücre BOŞ, 0 değil; biliniyorsa sayı", () => {
    exportOrdersCSV([siparis({ kdvOran: undefined }), siparis({ id: 'ord2', kdvOran: 10 })], 'tr');
    expect(satirlar[0]['KDV %']).toBe('');
    expect(satirlar[1]['KDV %']).toBe(10);
    expect(dosyaAdi).toMatch(/^CETPA_Siparisler_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(String(blobParcalari[0]).startsWith('\uFEFF'), 'Excel Türkçe için UTF-8 BOM ilk parça olmalı').toBe(true);
  });
  it("Mikro türevi (source:'mikro-fatura', paid yok) → 'Bilinmiyor (Mikro)'; native paid:false → 'Bekliyor'; paid:true → 'Ödendi'", () => {
    exportOrdersCSV([
      siparis({ source: 'mikro-fatura' } as Partial<Order>),
      siparis({ id: 'o2', paid: false }),
      siparis({ id: 'o3', paid: true }),
      siparis({ id: 'o4', source: 'mikro-siparis' } as Partial<Order>),   // Siparişler → Mikro sekmesi eşlemesi
    ], 'tr');
    expect(satirlar.map(r => r['Ödeme Durumu'])).toEqual(['Bilinmiyor (Mikro)', 'Bekliyor', 'Ödendi', 'Bilinmiyor (Mikro)']);
  });
  it('EN başlıklar ve karşılıklar', () => {
    exportOrdersCSV([siparis({ source: 'mikro-fatura' } as Partial<Order>)], 'en');
    expect(satirlar[0]['Payment Status']).toBe('Unknown (Mikro)');
    expect(satirlar[0]).toHaveProperty('Invoice Type');
  });
  it('tarih bilinmiyorsa boş (bugün yazılmaz); Firestore Timestamp çözülür; sipariş no üreticiden bağımsız', () => {
    exportOrdersCSV([
      siparis({ createdAt: undefined, orderNumber: 'MF-İST0001' } as Partial<Order>),
      // Order.shopifyOrderId: string
      siparis({ id: 'o2', createdAt: { toDate: () => new Date('2026-08-15T00:00:00Z') } as unknown as Order['createdAt'], shopifyOrderId: '777' } as Partial<Order>),
    ], 'tr');
    expect(satirlar[0]['Oluşturulma']).toBe('');
    expect(satirlar[0]['Sipariş No']).toBe('MF-İST0001');
    expect(satirlar[1]['Oluşturulma']).toBe('2026-08-15');
    expect(satirlar[1]['Sipariş No']).toBe('777');
  });
});

describe('exportLeadsCSV', () => {
  it("kredi limiti girilmemişse BOŞ, 0 değil (limit 0 ile 'limit yok' aynı şey değildir)", () => {
    const lead = (ek: Partial<Lead>): Lead => ({ id: 'l1', name: 'Şirin Yapı', company: 'Şirin Yapı A.Ş.', status: 'New', ...ek } as unknown as Lead);
    exportLeadsCSV([lead({ creditLimit: undefined }), lead({ id: 'l2', creditLimit: 0 }), lead({ id: 'l3', creditLimit: 250000 })], 'tr');
    expect(satirlar.map(r => r['Kredi Limiti (₺)'])).toEqual(['', 0, 250000]);
  });
});

describe('exportInventoryCSV — 2026-09-04 düzeltmesi korunuyor', () => {
  it('stok/min stok/fiyat bilinmiyorsa boş hücre', () => {
    const urun = { id: 'i1', name: 'Çimento', sku: 'CMT', stockLevel: undefined, lowStockThreshold: undefined, prices: undefined, price: undefined } as unknown as InventoryItem;
    exportInventoryCSV([urun], 'tr');
    expect(satirlar[0]['Stok']).toBe('');
    expect(satirlar[0]['Fiyat - Perakende (₺)']).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Aylık Özet (Faz 3 6a, 2026-09-19) — `exportMonthlySummaryCSV` bugüne kadar TESTSİZDİ.
// Saf çekirdek `monthlySummaryRows` doğrudan çağrılır (DOM/indirme yok); indirme
// sarmalayıcısı için AYRI bir parite testi var (dosya adı + BOM + aynı satırlar).
// Fikstür: Şirin İnşaat'ın ÇİMENTO 50KG siparişleri, TL.
// ─────────────────────────────────────────────────────────────────────────────

const BASLIKLAR_TR = [
  'Ay', 'Sipariş Sayısı', 'İptal Edilen Sipariş', 'Ciro (₺)',
  'Tutarı Okunamayan Sipariş', 'Yeni Müşteri', 'Teslim Edilen',
];

const ay = (ek: Partial<MonthlySummaryRow>): MonthlySummaryRow =>
  ({ month: '2026-03', orderCount: 0, revenue: 0, newLeads: 0, delivered: 0, ...ek });

describe('monthlySummaryRows — sütun şeması ve parite', () => {
  it('1 · PARİTE: yeni alanlar verilmeyen satırda eski beş sütun AYNI; sütun SIRASI kilitli', () => {
    // Şirin İnşaat'ın 2026-03 ayı: 12 sipariş, ₺48.500 ciro, 3 yeni müşteri, 9 teslim.
    const [satir] = monthlySummaryRows([ay({ orderCount: 12, revenue: 48500, newLeads: 3, delivered: 9 })], 'tr');
    expect(Object.keys(satir)).toEqual(BASLIKLAR_TR);
    expect(satir['Ay']).toBe('2026-03');
    expect(satir['Sipariş Sayısı']).toBe(12);
    expect(satir['Ciro (₺)']).toBe(48500);
    expect(satir['Yeni Müşteri']).toBe(3);
    expect(satir['Teslim Edilen']).toBe(9);
    // Yeni sütunlar: sayaç 0 (geriye uyum), iptal BOŞ (çağıran ayırmadı → "0 iptal" UYDURULMAZ).
    expect(satir['Tutarı Okunamayan Sipariş']).toBe(0);
    expect(satir['İptal Edilen Sipariş']).toBe('');
  });

  it('2 · sayaç yazılır: 40 siparişin 3ü okunamadı → ciro KISMİ ama sayaç söylüyor', () => {
    const [satir] = monthlySummaryRows([ay({ orderCount: 40, revenue: 1000, revenueUnknown: 3 })], 'tr');
    expect(satir['Tutarı Okunamayan Sipariş']).toBe(3);
    expect(satir['Ciro (₺)']).toBe(1000);
  });

  it('3 · MUTASYON: ayın HİÇ bilinen tutarı yoksa ciro hücresi BOŞ, ₺0 DEĞİL', () => {
    const [satir] = monthlySummaryRows([ay({ orderCount: 2, revenue: 0, revenueUnknown: 2 })], 'tr');
    expect(satir['Ciro (₺)'], '2 siparişin 2si de okunamadı → "₺0 ciro" sahte kesinliktir').toBe('');
    expect(satir['Tutarı Okunamayan Sipariş']).toBe(2);
  });

  it('4 · MUTASYON: gerçek ₺0 ay KORUNUR (bedelsiz sipariş bilinmeyen DEĞİL)', () => {
    const [satir] = monthlySummaryRows([ay({ orderCount: 1, revenue: 0, revenueUnknown: 0 })], 'tr');
    expect(satir['Ciro (₺)']).toBe(0);
  });

  it('5 · kayan nokta artığı korunur (2026-08-22): 1174042.1400000001 → 1174042.14', () => {
    const [satir] = monthlySummaryRows([ay({ orderCount: 7, revenue: 1174042.1400000001 })], 'tr');
    expect(satir['Ciro (₺)']).toBe(1174042.14);
  });

  it('6 · dil: EN başlıklar; varsayılan tr', () => {
    const [en] = monthlySummaryRows([ay({ orderCount: 4, revenue: 100, cancelledCount: 1, revenueUnknown: 2 })], 'en');
    expect(Object.keys(en)).toEqual([
      'Month', 'Order Count', 'Cancelled Orders', 'Revenue (₺)',
      'Orders w/ Unreadable Amount', 'New Leads', 'Delivered',
    ]);
    expect(en['Cancelled Orders']).toBe(1);
    expect(en['Orders w/ Unreadable Amount']).toBe(2);
    const [vars] = monthlySummaryRows([ay({})]);
    expect(Object.keys(vars)).toEqual(BASLIKLAR_TR);
  });

  it('7 · siparişsiz ay (yalnız yeni müşteri): ciro 0, sayaç 0 — boş hücre DEĞİL', () => {
    const [satir] = monthlySummaryRows([ay({ orderCount: 0, newLeads: 5 })], 'tr');
    expect(satir['Ciro (₺)'], 'o ay gerçekten cirosuz — bilinmeyen değil').toBe(0);
    expect(satir['Tutarı Okunamayan Sipariş']).toBe(0);
  });

  it('8 · `month` SERBEST metin: "(tarihsiz)" satırı aynen geçer, satır SIRASI korunur', () => {
    const satirlarSonuc = monthlySummaryRows([
      ay({ month: '2026-02', orderCount: 1, revenue: 10 }),
      ay({ month: '(tarihsiz)', orderCount: 4, revenue: 0, revenueUnknown: 4 }),
    ], 'tr');
    expect(satirlarSonuc.map(s => s['Ay'])).toEqual(['2026-02', '(tarihsiz)']);
    expect(satirlarSonuc[1]['Ciro (₺)']).toBe('');
  });
});

describe('monthlySummaryRows — K2 (kullanıcı: "İptaller ciroya girsin mi → hayır")', () => {
  it('9 · MUTASYON: iptal AYRI sütunda sayılır, "Sipariş Sayısı"na EKLENMEZ', () => {
    const [satir] = monthlySummaryRows([ay({ orderCount: 38, cancelledCount: 2, revenue: 1000 })], 'tr');
    expect(satir['Sipariş Sayısı'], 'orderCount iptal HARİÇ gelir; 38 + 2 = 40 YAZILMAZ').toBe(38);
    expect(satir['İptal Edilen Sipariş']).toBe(2);
  });

  it('10 · MUTASYON: yalnız iptalli ay → ciro 0 (BOŞ değil), okunamayan 0, iptal 3', () => {
    const [satir] = monthlySummaryRows([ay({ orderCount: 0, cancelledCount: 3, revenue: 0, revenueUnknown: 0 })], 'tr');
    expect(satir['Ciro (₺)'], 'boş-hücre koşulu `orderCount > 0` kapısını yitirirse 0 === 0 → yanlışlıkla BOŞ').toBe(0);
    expect(satir['Tutarı Okunamayan Sipariş']).toBe(0);
    expect(satir['İptal Edilen Sipariş']).toBe(3);
  });

  it('11 · MUTASYON: `cancelledCount` verilmedi → BOŞ; verilen 0 → 0 (meşru sıfır)', () => {
    const satirlarSonuc = monthlySummaryRows([
      ay({ orderCount: 5, revenue: 100 }),
      ay({ orderCount: 5, revenue: 100, cancelledCount: 0 }),
    ], 'tr');
    expect(satirlarSonuc[0]['İptal Edilen Sipariş'], '`?? 0` yazılırsa ayrılmamış satıra sahte "0 iptal" düşer').toBe('');
    expect(satirlarSonuc[1]['İptal Edilen Sipariş']).toBe(0);
  });
});

describe('monthlySummaryRows — bilinmeyen sayı savunması (şartnameden SAPMA, bkz. modül başlığı)', () => {
  it('ciro hiç okunamıyorsa (NaN) hücre BOŞ — CSV`ye "NaN" metni yazılmaz', () => {
    const [satir] = monthlySummaryRows([ay({ orderCount: 3, revenue: Number.NaN, revenueUnknown: 1 })], 'tr');
    expect(satir['Ciro (₺)']).toBe('');
  });
  it('`revenueUnknown` bozuk (NaN) → geriye uyum 0 sayılır, ciro hücresi BOŞALMAZ', () => {
    const [satir] = monthlySummaryRows([ay({ orderCount: 3, revenue: 250, revenueUnknown: Number.NaN })], 'tr');
    expect(satir['Tutarı Okunamayan Sipariş']).toBe(0);
    expect(satir['Ciro (₺)']).toBe(250);
  });
});

describe('exportMonthlySummaryCSV — indirme sarmalayıcısı AYNEN (dosya adı, BOM, satırlar)', () => {
  it('saf çekirdeğin ÜRETTİĞİ satırları Papa.unparse`a verir; dosya adı ve BOM değişmedi', () => {
    const girdi = [ay({ orderCount: 38, cancelledCount: 2, revenue: 48500.129, revenueUnknown: 1, newLeads: 3, delivered: 30 })];
    exportMonthlySummaryCSV(girdi, 'tr');
    expect(satirlar).toEqual(monthlySummaryRows(girdi, 'tr'));
    expect(dosyaAdi).toMatch(/^CETPA_Aylik_Ozet_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(String(blobParcalari[0]).startsWith('﻿'), 'Excel Türkçe için UTF-8 BOM ilk parça olmalı').toBe(true);
  });

  /**
   * Faz 3 6a düzeltme turu (2026-09-22). ARIZA: sipariş listesi boş kiracıda
   * `Papa.unparse([])` BOŞ METİN döndüğü için dosyada tek bir sütun başlığı bile yoktu
   * (içerik yalnız BOM). Kullanıcı Excel'de bomboş dosya görüp "dışa aktarım bozuk"
   * sanıyordu. Modülün kendi sözleşmesi "sütunlar HER ZAMAN yazılır" diyor — şema satır
   * SAYISINA bağlı olamaz.
   */
  it('MUTASYON: satır YOKKEN de sütun başlıkları yazılır (boş dizi → başlık satırı)', () => {
    exportMonthlySummaryCSV([], 'tr');
    expect(satirlar).toEqual({
      fields: Object.keys(monthlySummaryRows([ay({})], 'tr')[0]),
      data: [],
    });
    expect(dosyaAdi).toMatch(/^CETPA_Aylik_Ozet_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('boş dışa aktarımda başlıklar DİLE uyar (EN sütun adları)', () => {
    exportMonthlySummaryCSV([], 'en');
    expect((satirlar as unknown as { fields: string[] }).fields)
      .toEqual(Object.keys(monthlySummaryRows([ay({})], 'en')[0]));
    expect((satirlar as unknown as { fields: string[] }).fields).toContain('Cancelled Orders');
  });
});
