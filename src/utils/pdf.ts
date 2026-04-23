import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import { Order, Lead } from '../types';

// jsPDF's built-in fonts don't support Turkish chars
const normTR = (s: string) => s
  .replace(/ş/g, 's').replace(/Ş/g, 'S')
  .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
  .replace(/ç/g, 'c').replace(/Ç/g, 'C')
  .replace(/ü/g, 'u').replace(/Ü/g, 'U')
  .replace(/ö/g, 'o').replace(/Ö/g, 'O')
  .replace(/ı/g, 'i').replace(/İ/g, 'I');

export const exportOrderPDF = (order: Order | Record<string, unknown>, _t: unknown) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const BRAND: [number, number, number] = [255, 64, 0];
  const DARK:  [number, number, number] = [29, 29, 31];
  const GREY:  [number, number, number] = [134, 134, 139];
  const LIGHT: [number, number, number] = [245, 245, 247];

  // ── Header band ────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, W, 32, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('CETPA', 14, 15);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(255, 200, 180);
  doc.text('SATIS & LOJISTIK', 14, 21);

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('SIPARIS / FATURA', W - 14, 15, { align: 'right' });

  const dateStr = (order.syncedAt as { toDate?: () => Date })?.toDate
    ? (order.syncedAt as { toDate: () => Date }).toDate().toLocaleDateString('tr-TR')
    : new Date().toLocaleDateString('tr-TR');
  const orderNo = String(order.shopifyOrderId || order.id || '').substring(0, 12);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(255, 220, 210);
  doc.text(`No: ${orderNo}  |  Tarih: ${dateStr}`, W - 14, 26, { align: 'right' });

  // ── Info boxes ─────────────────────────────────────────────────────────
  const boxY = 38;
  const boxH = 32;
  const col1 = 14, col2 = W / 2 + 4;
  const colW = W / 2 - 18;

  doc.setFillColor(...LIGHT);
  doc.roundedRect(col1, boxY, colW, boxH, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...BRAND);
  doc.text('MUSTERI BILGILERI', col1 + 4, boxY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text(normTR(String(order.customerName || '-')), col1 + 4, boxY + 13);
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text(normTR(String(order.shippingAddress || '')), col1 + 4, boxY + 20, { maxWidth: colW - 8 });

  doc.setFillColor(...LIGHT);
  doc.roundedRect(col2, boxY, colW, boxH, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...BRAND);
  doc.text('SIPARIS DETAYI', col2 + 4, boxY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...DARK);
  doc.text(`Durum: ${normTR(String(order.status || '-'))}`, col2 + 4, boxY + 13);
  doc.text(`Takip No: ${normTR(String(order.trackingNumber || '-'))}`, col2 + 4, boxY + 20);

  // ── Items table ────────────────────────────────────────────────────────
  const lineItems = ((order as Record<string, unknown>).lineItems || (order as Record<string, unknown>).items || []) as any[];
  const tableData = lineItems.map((item: any, idx: number) => [
    String(idx + 1),
    normTR(String(item.title || item.name || '-')),
    item.sku || '-',
    String(item.quantity || 0),
    `${Number(item.price || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`,
    `${(Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`,
  ]);

  (doc as unknown as { autoTable: (opts: unknown) => void }).autoTable({
    startY: boxY + boxH + 6,
    head: [['#', 'Urun', 'SKU', 'Miktar', 'Birim Fiyat', 'Tutar']],
    body: tableData.length ? tableData : [['', 'Kalem eklenmedi', '', '', '', '']],
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, cellPadding: 3 },
    bodyStyles: { fontSize: 8, cellPadding: 3 },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    columnStyles: {
      0: { cellWidth: 8,  halign: 'center' },
      2: { cellWidth: 24, halign: 'center' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 28, halign: 'right' },
      5: { cellWidth: 28, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
    tableLineColor: [230, 230, 230],
    tableLineWidth: 0.1,
  });

  // ── Totals ─────────────────────────────────────────────────────────────
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const totalPrice = Number((order as Record<string, unknown>).totalPrice) || Number((order as Record<string, unknown>).totalAmount) || 0;
  const kdvOran   = Number((order as Record<string, unknown>).kdvOran) || 20;
  const subTotal  = Number((order as Record<string, unknown>).kdvHaricTutar) || totalPrice / (1 + kdvOran / 100);
  const vatTotal  = Number((order as Record<string, unknown>).kdvTutari) || (totalPrice - subTotal);

  const totalsX = W - 70;
  const totalsY = finalY + 8;

  doc.setFillColor(...LIGHT);
  doc.roundedRect(totalsX - 4, totalsY - 4, 60, 34, 2, 2, 'F');

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GREY);
  doc.text('Ara Toplam:', totalsX + 2, totalsY + 4);
  doc.text(`KDV (%${kdvOran}):`, totalsX + 2, totalsY + 12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text(`${subTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`, W - 16, totalsY + 4, { align: 'right' });
  doc.text(`${vatTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`, W - 16, totalsY + 12, { align: 'right' });

  doc.setFillColor(...BRAND);
  doc.roundedRect(totalsX - 4, totalsY + 16, 60, 10, 1.5, 1.5, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('GENEL TOPLAM', totalsX + 2, totalsY + 23);
  doc.text(`${totalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`, W - 16, totalsY + 23, { align: 'right' });

  // ── Footer band ────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND);
  doc.rect(0, H - 14, W, 14, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(255, 220, 210);
  doc.text('Bu belge elektronik olarak olusturulmustur.', 14, H - 6);
  doc.setTextColor(255, 255, 255);
  doc.text(`CETPA  •  cetpa.com  •  Sayfa 1`, W - 14, H - 6, { align: 'right' });

  doc.save(`CETPA_Siparis_${orderNo}_${dateStr.replace(/\./g, '-')}.pdf`);
};

// ── Customer Account Statement ────────────────────────────────────────────────

export const exportCustomerStatement = (
  lead: Lead,
  orders: Order[],
  lang: 'tr' | 'en' = 'tr',
) => {
  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W    = doc.internal.pageSize.getWidth();
  const H    = doc.internal.pageSize.getHeight();
  const BRAND: [number, number, number] = [26, 58, 92];   // #1a3a5c navy
  const LIGHT: [number, number, number] = [245, 245, 247];
  const DARK:  [number, number, number] = [29,  29,  31];
  const GREY:  [number, number, number] = [134, 134, 139];

  const today = new Date().toLocaleDateString('tr-TR');

  // ── Header band ──────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, W, 32, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('CETPA', 14, 15);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(200, 220, 255);
  doc.text('SATIS & LOJISTIK', 14, 22);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(
    lang === 'tr' ? 'HESAP EKSTRESI' : 'ACCOUNT STATEMENT',
    W - 14, 15, { align: 'right' },
  );
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(200, 220, 255);
  doc.text(`${lang === 'tr' ? 'Tarih' : 'Date'}: ${today}`, W - 14, 22, { align: 'right' });

  // ── Customer info box ────────────────────────────────────────────────────
  const boxY = 38;
  doc.setFillColor(...LIGHT);
  doc.roundedRect(14, boxY, W - 28, 28, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text(lang === 'tr' ? 'MUSTERI' : 'CUSTOMER', 20, boxY + 7);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(normTR(lead.name), 20, boxY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  const infoLine = [lead.company, lead.email, lead.phone].filter(Boolean).join('  •  ');
  doc.text(normTR(infoLine), 20, boxY + 20);

  if (lead.creditLimit) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...BRAND);
    doc.text(
      `${lang === 'tr' ? 'Kredi Limiti' : 'Credit Limit'}: ${lead.creditLimit.toLocaleString('tr-TR')} TRY`,
      W - 20, boxY + 14, { align: 'right' },
    );
  }

  // ── Orders table ─────────────────────────────────────────────────────────
  const tableY = boxY + 34;

  // Sort orders by date descending
  const sorted = [...orders].sort((a, b) => {
    const aTs = (a.syncedAt as { toDate?: () => Date })?.toDate?.()?.getTime() ?? 0;
    const bTs = (b.syncedAt as { toDate?: () => Date })?.toDate?.()?.getTime() ?? 0;
    return bTs - aTs;
  });

  const statusLabel: Record<string, { tr: string; en: string }> = {
    Pending:    { tr: 'Bekliyor',       en: 'Pending'    },
    Processing: { tr: 'Hazirlanıyor',   en: 'Processing' },
    Shipped:    { tr: 'Kargoda',        en: 'Shipped'    },
    Delivered:  { tr: 'Teslim Edildi',  en: 'Delivered'  },
    Cancelled:  { tr: 'Iptal',          en: 'Cancelled'  },
  };

  const head = lang === 'tr'
    ? [['Siparis No', 'Tarih', 'Durum', 'Urunler', 'Tutar (TRY)']]
    : [['Order No',   'Date',  'Status', 'Items',  'Amount (TRY)']];

  const body = sorted.map(o => {
    const dateObj = (o.syncedAt as { toDate?: () => Date })?.toDate?.() ?? new Date(o.syncedAt as string | number);
    const dateStr2 = isNaN(dateObj.getTime()) ? '—' : dateObj.toLocaleDateString('tr-TR');
    const itemNames = (o.lineItems ?? []).map(l => normTR(String(l.name ?? l.title ?? l.sku ?? ''))).slice(0, 2).join(', ');
    const status   = statusLabel[o.status]?.[lang] ?? o.status;
    return [
      normTR(o.shopifyOrderId ?? o.id.slice(0, 8)),
      dateStr2,
      status,
      normTR(itemNames || '—'),
      o.totalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 }),
    ];
  });

  autoTable(doc, {
    startY:     tableY,
    head,
    body,
    styles:       { fontSize: 8, cellPadding: 3, overflow: 'ellipsize' },
    headStyles:   { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 250, 252] },
    columnStyles: {
      0: { cellWidth: 28, fontStyle: 'bold' },
      1: { cellWidth: 22 },
      2: { cellWidth: 24 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
  });

  // ── Summary box ──────────────────────────────────────────────────────────
  const finalY: number = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? 200;

  const delivered    = sorted.filter(o => o.status === 'Delivered');
  const outstanding  = sorted.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled');
  const totalDelivered   = delivered.reduce((s, o)   => s + o.totalPrice, 0);
  const totalOutstanding = outstanding.reduce((s, o) => s + o.totalPrice, 0);
  const grandTotal       = sorted.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + o.totalPrice, 0);

  const sumY = finalY + 6;
  doc.setFillColor(...LIGHT);
  doc.roundedRect(W - 80, sumY, 66, 36, 2, 2, 'F');

  const rows = [
    [lang === 'tr' ? 'Teslim Edildi' : 'Delivered',   `${totalDelivered.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TRY`],
    [lang === 'tr' ? 'Bekleyen'     : 'Outstanding',  `${totalOutstanding.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TRY`],
    [lang === 'tr' ? 'TOPLAM'       : 'TOTAL',        `${grandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TRY`],
  ];
  rows.forEach(([label, value], i) => {
    const y = sumY + 8 + i * 9;
    doc.setFont('helvetica', i === 2 ? 'bold' : 'normal');
    doc.setFontSize(i === 2 ? 9 : 8);
    const color = i === 2 ? BRAND : GREY;
    doc.setTextColor(...color);
    doc.text(label, W - 76, y);
    doc.text(value, W - 18, y, { align: 'right' });
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND);
  doc.rect(0, H - 14, W, 14, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text(
    lang === 'tr'
      ? `Bu ekstre ${today} tarihinde CETPA tarafindan uretilmistir.`
      : `This statement was generated by CETPA on ${today}.`,
    14, H - 6,
  );
  doc.text(`CETPA  •  cetpa.com  •  ${today}`, W - 14, H - 6, { align: 'right' });

  doc.save(`CETPA_Ekstre_${normTR(lead.name).replace(/\s+/g, '_')}_${today.replace(/\./g, '-')}.pdf`);
};

// ── Purchase Order PDF ────────────────────────────────────────────────────────

interface POItem {
  id?: string;
  name: string;
  sku: string;
  quantity: number;
  purchasePrice: number;
}

interface PurchaseOrderDoc {
  id?: string;
  orderNumber: string;
  supplier: string;
  status: string;
  items: POItem[];
  totalAmount: number;
  expectedDate?: string | { toDate?: () => Date };
  createdAt?: string | number | Date | { toDate?: () => Date };
  notes?: string;
}

export const exportPurchaseOrderPDF = (po: PurchaseOrderDoc, lang: 'tr' | 'en' = 'tr') => {
  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W    = doc.internal.pageSize.getWidth();
  const H    = doc.internal.pageSize.getHeight();
  const BRAND: [number, number, number] = [255, 64, 0];
  const DARK:  [number, number, number] = [29, 29, 31];
  const GREY:  [number, number, number] = [134, 134, 139];
  const LIGHT: [number, number, number] = [245, 245, 247];

  const today = new Date().toLocaleDateString('tr-TR');

  // ── Header band ───────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, W, 32, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('CETPA', 14, 15);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(255, 200, 180);
  doc.text('SATIS & LOJISTIK', 14, 21);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(lang === 'tr' ? 'SATIN ALMA EMRI' : 'PURCHASE ORDER', W - 14, 15, { align: 'right' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(255, 220, 210);
  doc.text(`No: ${po.orderNumber}  |  ${today}`, W - 14, 26, { align: 'right' });

  // ── Info boxes ─────────────────────────────────────────────────────────────
  const boxY = 38;
  const boxH = 34;
  const col1 = 14, col2 = W / 2 + 4;
  const colW = W / 2 - 18;

  // Supplier box
  doc.setFillColor(...LIGHT);
  doc.roundedRect(col1, boxY, colW, boxH, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...BRAND);
  doc.text(lang === 'tr' ? 'TEDARIKCI' : 'SUPPLIER', col1 + 4, boxY + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text(normTR(po.supplier || '-'), col1 + 4, boxY + 16);

  // Order details box
  doc.setFillColor(...LIGHT);
  doc.roundedRect(col2, boxY, colW, boxH, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...BRAND);
  doc.text(lang === 'tr' ? 'SIPARIS DETAYI' : 'ORDER DETAILS', col2 + 4, boxY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...DARK);
  doc.text(`${lang === 'tr' ? 'Durum' : 'Status'}: ${normTR(po.status || '-')}`, col2 + 4, boxY + 14);

  let expDateStr = '-';
  if (po.expectedDate) {
    if (typeof po.expectedDate === 'string') {
      expDateStr = po.expectedDate;
    } else if (typeof po.expectedDate === 'object' && 'toDate' in po.expectedDate && typeof po.expectedDate.toDate === 'function') {
      expDateStr = po.expectedDate.toDate().toLocaleDateString('tr-TR');
    }
  }
  doc.setTextColor(...GREY);
  doc.text(`${lang === 'tr' ? 'Beklenen' : 'Expected'}: ${expDateStr}`, col2 + 4, boxY + 22);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...BRAND);
  doc.text(`${lang === 'tr' ? 'Toplam' : 'Total'}: ${(po.totalAmount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`, col2 + 4, boxY + 30);

  // ── Items table ───────────────────────────────────────────────────────────
  const tableData = (po.items || []).map((item, idx) => [
    String(idx + 1),
    normTR(item.name || '-'),
    item.sku || '-',
    String(item.quantity || 0),
    `${Number(item.purchasePrice || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`,
    `${(Number(item.purchasePrice || 0) * Number(item.quantity || 0)).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`,
  ]);

  const head = lang === 'tr'
    ? [['#', 'Urun Adi', 'SKU', 'Miktar', 'Alis Fiyati', 'Tutar']]
    : [['#', 'Product Name', 'SKU', 'Qty', 'Unit Cost', 'Amount']];

  autoTable(doc, {
    startY: boxY + boxH + 6,
    head,
    body: tableData.length ? tableData : [['', lang === 'tr' ? 'Kalem eklenmedi' : 'No items', '', '', '', '']],
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, cellPadding: 3 },
    bodyStyles: { fontSize: 8, cellPadding: 3 },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    columnStyles: {
      0: { cellWidth: 8,  halign: 'center' },
      2: { cellWidth: 24, halign: 'center' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 28, halign: 'right' },
      5: { cellWidth: 28, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
    tableLineColor: [230, 230, 230],
    tableLineWidth: 0.1,
  });

  // ── Grand total ───────────────────────────────────────────────────────────
  const finalY: number = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? 200;
  const totalsX = W - 70;
  const totalsY = finalY + 8;

  doc.setFillColor(...BRAND);
  doc.roundedRect(totalsX - 4, totalsY, 60, 11, 1.5, 1.5, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(lang === 'tr' ? 'GENEL TOPLAM' : 'GRAND TOTAL', totalsX + 2, totalsY + 7.5);
  doc.text(`${(po.totalAmount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`, W - 16, totalsY + 7.5, { align: 'right' });

  // ── Notes ─────────────────────────────────────────────────────────────────
  if (po.notes) {
    const notesY = totalsY + 20;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...BRAND);
    doc.text(lang === 'tr' ? 'NOTLAR' : 'NOTES', 14, notesY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    const noteLines = doc.splitTextToSize(normTR(po.notes), W - 28);
    doc.text(noteLines, 14, notesY + 6);
  }

  // ── Footer band ───────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND);
  doc.rect(0, H - 14, W, 14, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(255, 220, 210);
  doc.text('Bu belge elektronik olarak olusturulmustur.', 14, H - 6);
  doc.setTextColor(255, 255, 255);
  doc.text(`CETPA  •  cetpa.com  •  ${today}`, W - 14, H - 6, { align: 'right' });

  const dateSlug = today.replace(/\./g, '-');
  doc.save(`CETPA_SAS_${normTR(po.orderNumber)}_${dateSlug}.pdf`);
};

// ── Goods Receipt Note (Teslim Makbuzu) ──────────────────────────────────────

export const exportGoodsReceiptPDF = (po: PurchaseOrderDoc, lang: 'tr' | 'en' = 'tr') => {
  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W    = doc.internal.pageSize.getWidth();
  const H    = doc.internal.pageSize.getHeight();
  const GREEN: [number, number, number] = [22, 163, 74];   // green-600
  const DARK:  [number, number, number] = [29, 29, 31];
  const GREY:  [number, number, number] = [134, 134, 139];
  const LIGHT: [number, number, number] = [245, 245, 247];

  const today = new Date().toLocaleDateString('tr-TR');

  // ── Header band ───────────────────────────────────────────────────────────
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, W, 32, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('CETPA', 14, 15);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 240, 200);
  doc.text('SATIS & LOJISTIK', 14, 21);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(lang === 'tr' ? 'TESLIM MAKBUZU' : 'GOODS RECEIPT NOTE', W - 14, 15, { align: 'right' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 240, 200);
  doc.text(`SAS: ${po.orderNumber}  |  ${today}`, W - 14, 26, { align: 'right' });

  // ── Info boxes ─────────────────────────────────────────────────────────────
  const boxY = 38;
  const boxH = 28;
  const col1 = 14, col2 = W / 2 + 4;
  const colW = W / 2 - 18;

  doc.setFillColor(...LIGHT);
  doc.roundedRect(col1, boxY, colW, boxH, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...GREEN);
  doc.text(lang === 'tr' ? 'TEDARIKCI' : 'SUPPLIER', col1 + 4, boxY + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.text(normTR(po.supplier || '-'), col1 + 4, boxY + 14);

  doc.setFillColor(...LIGHT);
  doc.roundedRect(col2, boxY, colW, boxH, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...GREEN);
  doc.text(lang === 'tr' ? 'TESLIM BILGILERI' : 'RECEIPT INFO', col2 + 4, boxY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...DARK);
  doc.text(`${lang === 'tr' ? 'Tarih' : 'Date'}: ${today}`, col2 + 4, boxY + 14);
  doc.setTextColor(...GREY);
  doc.text(`SAS No: ${po.orderNumber}`, col2 + 4, boxY + 21);

  // ── Items table ───────────────────────────────────────────────────────────
  const tableData = (po.items || []).map((item, idx) => [
    String(idx + 1),
    normTR(item.name || '-'),
    item.sku || '-',
    String(item.quantity || 0),
    `${Number(item.purchasePrice || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`,
    `${(Number(item.purchasePrice || 0) * Number(item.quantity || 0)).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`,
    '☐',   // received check column
  ]);

  const head = lang === 'tr'
    ? [['#', 'Urun Adi', 'SKU', 'Beklenen', 'Birim Fiyat', 'Toplam', 'Teslim Alindi']]
    : [['#', 'Product Name', 'SKU', 'Expected', 'Unit Cost', 'Total', 'Received']];

  autoTable(doc, {
    startY: boxY + boxH + 6,
    head,
    body: tableData.length ? tableData : [['', lang === 'tr' ? 'Kalem yok' : 'No items', '', '', '', '', '']],
    headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, cellPadding: 3 },
    bodyStyles: { fontSize: 8, cellPadding: 3 },
    alternateRowStyles: { fillColor: [250, 255, 252] },
    columnStyles: {
      0: { cellWidth: 8,  halign: 'center' },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 26, halign: 'right' },
      5: { cellWidth: 26, halign: 'right' },
      6: { cellWidth: 22, halign: 'center' },
    },
    margin: { left: 14, right: 14 },
    tableLineColor: [200, 240, 210],
    tableLineWidth: 0.1,
  });

  // ── Total & signature boxes ───────────────────────────────────────────────
  const finalY: number = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? 200;
  const sigY = finalY + 10;

  // Grand total
  doc.setFillColor(...GREEN);
  doc.roundedRect(W - 74, sigY, 60, 11, 1.5, 1.5, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(lang === 'tr' ? 'GENEL TOPLAM' : 'GRAND TOTAL', W - 70, sigY + 7.5);
  doc.text(`${(po.totalAmount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`, W - 16, sigY + 7.5, { align: 'right' });

  // Signature boxes
  const sigBoxY = sigY + 20;
  const sigBoxW = (W - 28) / 3;
  [
    lang === 'tr' ? 'TESLIM EDEN'   : 'DELIVERED BY',
    lang === 'tr' ? 'TESLIM ALAN'   : 'RECEIVED BY',
    lang === 'tr' ? 'ONAYLAYAN'     : 'APPROVED BY',
  ].forEach((lbl, i) => {
    const x = 14 + i * (sigBoxW + 4);
    doc.setFillColor(...LIGHT);
    doc.roundedRect(x, sigBoxY, sigBoxW, 22, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...GREEN);
    doc.text(lbl, x + 4, sigBoxY + 6);
    doc.setDrawColor(200, 220, 200);
    doc.setLineWidth(0.3);
    doc.line(x + 4, sigBoxY + 17, x + sigBoxW - 4, sigBoxY + 17);
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  doc.setFillColor(...GREEN);
  doc.rect(0, H - 14, W, 14, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 240, 200);
  doc.text('Bu belge elektronik olarak olusturulmustur.', 14, H - 6);
  doc.setTextColor(255, 255, 255);
  doc.text(`CETPA  •  cetpa.com  •  ${today}`, W - 14, H - 6, { align: 'right' });

  const dateSlug2 = today.replace(/\./g, '-');
  doc.save(`CETPA_TMK_${normTR(po.orderNumber)}_${dateSlug2}.pdf`);
};
