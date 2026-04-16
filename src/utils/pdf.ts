import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

import { Order } from '../types';

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
