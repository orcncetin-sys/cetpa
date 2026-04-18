/**
 * export.ts — CSV / spreadsheet export helpers
 *
 * Uses PapaParse (already in the bundle) to serialise data arrays to CSV,
 * then triggers a browser download.  No extra packages required.
 */

import Papa from 'papaparse';
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
    [tr ? 'Sipariş No'         : 'Order No']:       o.shopifyOrderId ?? o.id.slice(0, 8),
    [tr ? 'Müşteri'            : 'Customer']:        o.customerName,
    [tr ? 'Durum'              : 'Status']:          o.status,
    [tr ? 'Toplam (₺)'        : 'Total (₺)']:       o.totalPrice,
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
    [tr ? 'Kredi Limiti (₺)'  : 'Credit Limit (₺)']:l.creditLimit ?? 0,
    [tr ? 'Ödeme Vadesi'       : 'Payment Terms']:   l.paymentTerms ?? '',
    [tr ? 'Atanan'             : 'Assigned To']:     l.assignedTo ?? '',
    [tr ? 'AI Skoru'           : 'AI Score']:        l.aiScore ?? '',
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
    [tr ? 'Stok'               : 'Stock']:           i.stockLevel ?? 0,
    [tr ? 'Min. Stok'          : 'Min. Stock']:      i.lowStockThreshold ?? 0,
    [tr ? 'Fiyat - Perakende (₺)': 'Retail (₺)']:   i.prices?.['Retail']       ?? i.price ?? 0,
    [tr ? 'Fiyat - B2B Std (₺)': 'B2B Std (₺)']:   i.prices?.['B2B Standard'] ?? 0,
    [tr ? 'Fiyat - B2B Prem (₺)':'B2B Prem (₺)']:  i.prices?.['B2B Premium']  ?? 0,
    [tr ? 'Fiyat - Bayi (₺)'  : 'Dealer (₺)']:      i.prices?.['Dealer']       ?? 0,
    [tr ? 'Depo'               : 'Warehouse']:       i.warehouseId ?? '',
    [tr ? 'Tedarikçi'          : 'Supplier']:        i.supplier ?? '',
  }));

  const csv = Papa.unparse(rows);
  downloadCSV(csv, `CETPA_Envanter_${ts()}.csv`);
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
    [tr ? 'Ciro (₺)'        : 'Revenue (₺)']:      r.revenue,
    [tr ? 'Yeni Müşteri'     : 'New Leads']:         r.newLeads,
    [tr ? 'Teslim Edilen'    : 'Delivered']:         r.delivered,
  }));
  const csv = Papa.unparse(mapped);
  downloadCSV(csv, `CETPA_Aylik_Ozet_${ts()}.csv`);
}
