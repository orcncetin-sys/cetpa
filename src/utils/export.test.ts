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
import { exportOrdersCSV, exportLeadsCSV, exportInventoryCSV } from './export';
import type { Order, Lead, InventoryItem } from '../types';

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
