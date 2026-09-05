/**
 * export.ts — CSV / spreadsheet export helpers
 *
 * Uses PapaParse (already in the bundle) to serialise data arrays to CSV,
 * then triggers a browser download.  No extra packages required.
 */

import Papa from 'papaparse';
import { gorunenSiparisNo, odemeTakipli } from './siparis';
import type { Order, Lead, InventoryItem } from '../types';

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

function ts(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── Orders ────────────────────────────────────────────────────────────────────

export function exportOrdersCSV(orders: Order[], lang: string = 'tr'): void {
  const tr = lang === 'tr';
  const rows = orders.map(o => ({
    [tr ? 'Sipariş No'         : 'Order No']:        gorunenSiparisNo(o),
    [tr ? 'Müşteri'            : 'Customer']:         o.customerName,
    [tr ? 'Müşteri Tipi'       : 'Customer Type']:   o.customerType ?? '',
    [tr ? 'Durum'              : 'Status']:           o.status,
    // Mikro faturasından türetilen siparişte `paid` yokluğu 'ödenmedi' DEĞİL 'bilinmiyor'
    // (siparis.ts odemeTakipli). CSV eskiden hepsini 'Bekliyor' yazıyordu — ₺17,6M sahte
    // alacak arızasının dışa aktarım yüzeyi.
    [tr ? 'Ödeme Durumu'       : 'Payment Status']:  !odemeTakipli(o) ? (tr ? 'Bilinmiyor (Mikro)' : 'Unknown (Mikro)') : o.paid ? (tr ? 'Ödendi' : 'Paid') : (tr ? 'Bekliyor' : 'Unpaid'),
    [tr ? 'Toplam (₺)'         : 'Total (₺)']:       o.totalPrice,
    [tr ? 'Fatura Tipi'        : 'Invoice Type']:    o.faturaTipi ?? (o.faturali ? 'e-fatura' : ''),
    [tr ? 'KDV %'              : 'VAT %']:           o.kdvOran ?? '',   // bilinmiyorsa BOŞ hücre, 0 değil (satır 94 dersi — yarım kalmıştı)
    [tr ? 'Kargo No'           : 'Tracking No']:     o.trackingNumber ?? '',
    [tr ? 'Kargo Firması'      : 'Carrier']:         o.cargoCompany ?? '',
    [tr ? 'Teslimat Adresi'    : 'Shipping Address']:o.shippingAddress ?? '',
    [tr ? 'Oluşturulma'        : 'Created']:
      o.createdAt
        ? (typeof o.createdAt === 'string'
            ? o.createdAt.slice(0, 10)
            : (o.createdAt as { toDate?: () => Date }).toDate?.().toISOString().slice(0, 10) ?? '')
        : '',
    [tr ? 'Notlar'             : 'Notes']:           o.notes ?? '',
  }));

  const csv = Papa.unparse(rows);
  downloadCSV(csv, `CETPA_Siparisler_${ts()}.csv`);
}

// ── Leads (CRM) ───────────────────────────────────────────────────────────────

export function exportLeadsCSV(leads: Lead[], lang: string = 'tr'): void {
  const tr = lang === 'tr';
  const rows = leads.map(l => ({
    [tr ? 'Ad Soyad'           : 'Name']:            l.name,
    [tr ? 'Şirket'             : 'Company']:         l.company,
    [tr ? 'Durum'              : 'Status']:          l.status,
    [tr ? 'E-posta'            : 'Email']:           l.email ?? '',
    [tr ? 'Telefon'            : 'Phone']:           l.phone ?? '',
    [tr ? 'Kredi Limiti (₺)'  : 'Credit Limit (₺)']:l.creditLimit ?? '',   // limit girilmemiş ≠ limit 0
    [tr ? 'Ödeme Vadesi'       : 'Payment Terms']:   l.paymentTerms ?? '',
    [tr ? 'Atanan'             : 'Assigned To']:     l.assignedTo ?? '',
    [tr ? 'AI Skoru'           : 'AI Score']:        l.score ?? '',
    [tr ? 'Oluşturulma'        : 'Created']:
      l.createdAt
        ? (typeof l.createdAt === 'string'
            ? l.createdAt.slice(0, 10)
            : (l.createdAt as { toDate?: () => Date }).toDate?.().toISOString().slice(0, 10) ?? '')
        : '',
  }));

  const csv = Papa.unparse(rows);
  downloadCSV(csv, `CETPA_Musteriler_${ts()}.csv`);
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export function exportInventoryCSV(inventory: InventoryItem[], lang: string = 'tr'): void {
  const tr = lang === 'tr';
  const rows = inventory.map(i => ({
    [tr ? 'Ürün Adı'           : 'Product Name']:    i.name,
    [tr ? 'SKU'                : 'SKU']:             i.sku,
    [tr ? 'Kategori'           : 'Category']:        i.category ?? '',
    // BOS ALAN 0 DEGIL, BOS HUCRE (2026-09-04 denetimi): `?? 0` yuzunden
    // "fiyat tanimli degil" ile "fiyati 0 TL" Excel'de ayirt edilemiyordu —
    // dis sisteme/musteriye giden dosyada bedava urun gibi gorunuyordu.
    // Bos hucre, hesap tablosunda toplama da girmez.
    [tr ? 'Stok'               : 'Stock']:           i.stockLevel ?? '',
    [tr ? 'Min. Stok'          : 'Min. Stock']:      i.lowStockThreshold ?? '',
    [tr ? 'Fiyat - Perakende (₺)': 'Retail (₺)']:   i.prices?.['Retail']       ?? i.price ?? '',
    [tr ? 'Fiyat - B2B Std (₺)': 'B2B Std (₺)']:   i.prices?.['B2B Standard'] ?? '',
    [tr ? 'Fiyat - B2B Prem (₺)':'B2B Prem (₺)']:  i.prices?.['B2B Premium']  ?? '',
    [tr ? 'Fiyat - Bayi (₺)'  : 'Dealer (₺)']:      i.prices?.['Dealer']       ?? '',
    [tr ? 'Depo'               : 'Warehouse']:       i.warehouseId ?? '',
    [tr ? 'Tedarikçi'          : 'Supplier']:        i.supplier ?? '',
  }));

  const csv = Papa.unparse(rows);
  downloadCSV(csv, `CETPA_Envanter_${ts()}.csv`);
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
    let tsStr = '';
    if (m.timestamp) {
      if (typeof m.timestamp === 'string') {
        tsStr = m.timestamp.slice(0, 10);
      } else {
        tsStr = (m.timestamp as { toDate?: () => Date }).toDate?.().toISOString().slice(0, 10) ?? '';
      }
    }
    return {
      [tr ? 'Ürün'         : 'Product']:    m.productName,
      [tr ? 'Tür'          : 'Type']:       m.type === 'in' ? (tr ? 'Giriş' : 'In') : m.type === 'out' ? (tr ? 'Çıkış' : 'Out') : (tr ? 'Düzeltme' : 'Adjustment'),
      [tr ? 'Miktar'       : 'Quantity']:   m.quantity,
      [tr ? 'Sebep'        : 'Reason']:     m.reason ?? '',
      [tr ? 'Notlar'       : 'Notes']:      m.notes ?? '',
      [tr ? 'Tarih'        : 'Date']:       tsStr,
    };
  });
  const csv = Papa.unparse(rows);
  downloadCSV(csv, `CETPA_Stok_Hareketleri_${ts()}.csv`);
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
  month: string;       // YYYY-MM
  orderCount: number;
  revenue: number;
  newLeads: number;
  delivered: number;
}

export function exportMonthlySummaryCSV(rows: MonthlySummaryRow[], lang: string = 'tr'): void {
  const tr = lang === 'tr';
  const mapped = rows.map(r => ({
    [tr ? 'Ay'               : 'Month']:            r.month,
    [tr ? 'Sipariş Sayısı'   : 'Order Count']:      r.orderCount,
    // 2 ONDALIK ZORUNLU: ham sayi yazilinca hem gereksiz basamak hem de
    // KAYAN NOKTA HATASI CSV'ye siziyordu — canli ciktida "1174042.1400000001"
    // gorundu (2026-08-22). Para her zaman 2 hane.
    [tr ? 'Ciro (₺)'        : 'Revenue (₺)']:      Number(r.revenue.toFixed(2)),
    [tr ? 'Yeni Müşteri'     : 'New Leads']:         r.newLeads,
    [tr ? 'Teslim Edilen'    : 'Delivered']:         r.delivered,
  }));
  const csv = Papa.unparse(mapped);
  downloadCSV(csv, `CETPA_Aylik_Ozet_${ts()}.csv`);
}
