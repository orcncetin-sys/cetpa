import { jsPDF } from 'jspdf';
import { gorunenSiparisNo, siparisTarih, siparisTarihMs } from './siparis';
import autoTable, { applyPlugin } from 'jspdf-autotable';

// Plugin'i BU modülün jsPDF'ine açıkça uygula (Faz 1 2/n, 2026-09-05).
// GERÇEK MEKANİZMA (ilk yorum yanlıştı, inceleme düzeltti): jspdf-autotable 5 modül
// yüklenirken plugin'i YALNIZ `window.jsPDF || window.jspdf?.jsPDF` UMD globaline uygular;
// Vite'ın kullandığı jspdf ES build hiçbir global yazmaz → tarayıcıda otomatik uygulama
// HİÇ çalışmıyordu. Fonksiyonel `autoTable(doc, …)` plugin'e bağımlı değil; plugin-yöntemi
// `doc.autoTable(…)` ise tanımsızdı. Artık tüm çağrılar fonksiyonel; bu satır savunma
// amaçlı kalıyor (`doc.lastAutoTable` sugar'ı ve olası bir plugin-yöntemi kalıntısı için).
applyPlugin(jsPDF);

import { Order, Lead } from '../types';
import { registerTurkishFont } from './pdfFont';
import { sablonGetir, sablonRengi, bankaBilgisiBasilir, belgeAltBilgisiCiz, VARSAYILAN_BASLIK, type BelgeTipi } from './belgeSablonu';

// Roboto (registerTurkishFont) Türkçe glifleri kapsıyor — artık harf
// düşürmeye gerek yok, normTR eski çağrı yerlerini bozmamak için passthrough
// olarak bırakıldı (2026-08-17, bkz. pdfFont.ts).
const normTR = (s: string) => s;

/**
 * Sipariş / teklif PDF'i.
 *
 * `belgeTipi` 2026-09-04'te eklendi: bu fonksiyonun TEK çağıranı B2BPortal ve
 * oraya bir TEKLİF nesnesi geçiyordu, ama PDF sabit "SİPARİŞ / FATURA" başlığı
 * basıyordu — müşteriye giden belge yanlış adlandırılıyordu. Ayrıca teklifte
 * bulunmayan "Durum / Takip No" alanları da basılıyordu (`Durum: approved`,
 * `Takip No: -`). Başlık artık Belge Tasarımcısı şablonundan gelir.
 */
export const exportOrderPDF = async (
  order: Order | Record<string, unknown>,
  _t: unknown,
  belgeTipi: Extract<BelgeTipi, 'siparis' | 'teklif'> = 'siparis',
) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await registerTurkishFont(doc);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const sablon = await sablonGetir(belgeTipi);
  const teklifMi = belgeTipi === 'teklif';
  // Para birimi ARTIK okunuyor. Eskiden 5 yerde sabit ' TL' yazıyordu; EUR bir
  // teklif B2B Portalı'ndan indirildiğinde tutar 'TL' olarak basılıyordu —
  // aynı teklifin QuotationDetail nüshası '€' basarken. Müşteriye giden iki
  // belgede iki farklı para birimi.
  const paraBirimi = String((order as Record<string, unknown>).currency || 'TL');
  const BRAND: [number, number, number] = sablonRengi(sablon);
  const DARK:  [number, number, number] = [29, 29, 31];
  const GREY:  [number, number, number] = [134, 134, 139];
  const LIGHT: [number, number, number] = [245, 245, 247];

  // ── Header band ────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, W, 32, 'F');

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('CETPA', 14, 15);

  doc.setFontSize(8);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(255, 200, 180);
  doc.text('SATIŞ & LOJİSTİK', 14, 21);

  doc.setFontSize(16);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(sablon?.title?.trim() || VARSAYILAN_BASLIK[belgeTipi], W - 14, 15, { align: 'right' });

  // TARIHI BILMIYORSAK BUGUNU BASMA (2026-09-04 denetimi). Eskiden `?? new Date()`
  // yedegi vardi: Mikro faturasindan turetilen siparisin PDF'inde BUGUNUN tarihi
  // cikiyordu — musteriye giden belgede yanlis tarih. utils/zaman.ts bu tuzagi
  // dosya basliginda "olumcul" diye belgeliyor.
  const dateObj0 = siparisTarih(order);
  const dateStr = dateObj0 ? dateObj0.toLocaleDateString('tr-TR') : '—';
  // Teklifte `orderNumber` yoktur; `gorunenSiparisNo` o durumda '#'+id.slice(-6)
  // uretir — hem SIPARIS numarasi bicimindedir hem de QuotationDetail'in bastigi
  // numaradan (id.substring(0,8).toUpperCase()) FARKLIDIR. Ayni teklif iki
  // yuzeyden iki farkli numarayla cikiyordu; musteri numarayla arayinca kayit
  // bulunamiyordu. Teklif yolunda QuotationDetail ile AYNI kurali kullan.
  const orderNo = teklifMi
    ? String((order as Record<string, unknown>).id ?? '').substring(0, 8).toUpperCase() || '—'
    : gorunenSiparisNo(order).substring(0, 14);

  doc.setFontSize(8);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(255, 220, 210);
  doc.text(`No: ${orderNo}  |  Tarih: ${dateStr}`, W - 14, 26, { align: 'right' });

  // ── Info boxes ─────────────────────────────────────────────────────────
  const boxY = 38;
  const boxH = 32;
  const col1 = 14, col2 = W / 2 + 4;
  const colW = W / 2 - 18;

  doc.setFillColor(...LIGHT);
  doc.roundedRect(col1, boxY, colW, boxH, 2, 2, 'F');
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...BRAND);
  doc.text('MÜŞTERİ BİLGİLERİ', col1 + 4, boxY + 6);
  doc.setFont('Roboto', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text(normTR(String(order.customerName || '-')), col1 + 4, boxY + 13);
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text(normTR(String(order.shippingAddress || '')), col1 + 4, boxY + 20, { maxWidth: colW - 8 });

  doc.setFillColor(...LIGHT);
  doc.roundedRect(col2, boxY, colW, boxH, 2, 2, 'F');
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...BRAND);
  doc.text(teklifMi ? 'TEKLİF DETAYI' : 'SİPARİŞ DETAYI', col2 + 4, boxY + 6);
  doc.setFont('Roboto', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...DARK);
  if (teklifMi) {
    // Teklifte `status` ham İngilizce ('approved') ve `trackingNumber` HİÇ YOK —
    // eskiden ikisi de basılıyordu ve müşteri "Takip No: -" görüyordu.
    const gecerli = (order as Record<string, unknown>).validUntil;
    doc.text(
      `Geçerlilik: ${gecerli ? new Date(gecerli as string | number | Date).toLocaleDateString('tr-TR') : '—'}`,
      col2 + 4, boxY + 13);
  } else {
    doc.text(`Durum: ${normTR(String(order.status || '-'))}`, col2 + 4, boxY + 13);
    doc.text(`Takip No: ${normTR(String(order.trackingNumber || '-'))}`, col2 + 4, boxY + 20);
  }

  // ── Items table ────────────────────────────────────────────────────────
  const lineItems = ((order as Record<string, unknown>).lineItems || (order as Record<string, unknown>).items || []) as any[];
  const tableData = lineItems.map((item: any, idx: number) => [
    String(idx + 1),
    normTR(String(item.title || item.name || '-')),
    item.sku || '-',
    String(item.quantity || 0),
    `${Number(item.price || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${paraBirimi}`,
    `${(Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${paraBirimi}`,
  ]);

  // FONKSİYONEL biçim, plugin-yöntemi DEĞİL (Faz 1 2/n, inceleme CONFIRMED): eskiden
  // `(doc as …).autoTable({…})` idi. jspdf-autotable 5 plugin'i yalnız `window.jsPDF` globali
  // varsa uygular; Vite'ın ESM jspdf'i global yazmaz → bu tek çağrı canlıda 2026-04-16'dan
  // beri "doc.autoTable is not a function" ile çöküyordu (B2B Portalı → teklif PDF İndir).
  // Dosyadaki diğer 3 ve repodaki 14 çağrı zaten fonksiyonel. Değişmez testi: pdf.test.ts.
  autoTable(doc, {
    startY: boxY + boxH + 6,
    head: [['#', 'Ürün', 'SKU', 'Miktar', 'Birim Fiyat', 'Tutar']],
    body: tableData.length ? tableData : [['', 'Kalem eklenmedi', '', '', '', '']],
    styles: { font: 'Roboto' },
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
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(...GREY);
  doc.text('Ara Toplam:', totalsX + 2, totalsY + 4);
  doc.text(`KDV (%${kdvOran}):`, totalsX + 2, totalsY + 12);
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text(`${subTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${paraBirimi}`, W - 16, totalsY + 4, { align: 'right' });
  doc.text(`${vatTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${paraBirimi}`, W - 16, totalsY + 12, { align: 'right' });

  doc.setFillColor(...BRAND);
  doc.roundedRect(totalsX - 4, totalsY + 16, 60, 10, 1.5, 1.5, 'F');
  doc.setFontSize(10);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('GENEL TOPLAM', totalsX + 2, totalsY + 23);
  doc.text(`${totalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${paraBirimi}`, W - 16, totalsY + 23, { align: 'right' });

  // ── Footer band ────────────────────────────────────────────────────────
  // Banka blogu ARTIK ortak cizicide: tablonun bittigi yerden asagi yerlesir ve
  // sigmiyorsa yeni sayfa acar. Eskiden `H - 20`'ye SABIT konuluyordu ve uzun
  // tabloda GENEL TOPLAM kutusunun uzerine biniyordu.
  belgeAltBilgisiCiz(doc, {
    baslangicY: totalsY + 30,
    banka: bankaBilgisiBasilir(sablon),
    genislik: W - 100,   // toplam kutusunun soluna sigsin
  });

  // Alt bant TUM sayfalara — eskiden yalniz son sayfaya ciziliyordu, cok
  // sayfali belgede 1..N-1 sayfalarinda alt bilgi/sayfa numarasi yoktu.
  // Footer tek satira kirpilir: sagdaki sayfa etiketiyle cakismasin diye.
  const footerMetni = (doc.splitTextToSize(sablon?.footer?.trim() || 'Bu belge elektronik olarak oluşturulmuştur.', W - 90) as string[])[0] ?? '';
  const toplamSayfa = doc.getNumberOfPages();
  for (let sayfa = 1; sayfa <= toplamSayfa; sayfa++) {
    doc.setPage(sayfa);
    doc.setFillColor(...BRAND);
    doc.rect(0, H - 14, W, 14, 'F');
    doc.setFontSize(7.5);
    doc.setFont('Roboto', 'normal');
    doc.setTextColor(255, 220, 210);
    doc.text(footerMetni, 14, H - 6);
    doc.setTextColor(255, 255, 255);
    doc.text(`CETPA  •  cetpa.com.tr  •  Sayfa ${sayfa} / ${toplamSayfa}`, W - 14, H - 6, { align: 'right' });
  }

  doc.save(`CETPA_${teklifMi ? 'Teklif' : 'Siparis'}_${orderNo}_${dateStr.replace(/\./g, '-')}.pdf`);
};

// ── Customer Account Statement ────────────────────────────────────────────────

export const exportCustomerStatement = async (
  lead: Lead,
  orders: Order[],
  lang: 'tr' | 'en' = 'tr',
) => {
  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await registerTurkishFont(doc);
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

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('CETPA', 14, 15);

  doc.setFontSize(8);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(200, 220, 255);
  doc.text('SATIŞ & LOJİSTİK', 14, 22);

  doc.setFontSize(14);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(
    lang === 'tr' ? 'HESAP EKSTRESİ' : 'ACCOUNT STATEMENT',
    W - 14, 15, { align: 'right' },
  );
  doc.setFontSize(8);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(200, 220, 255);
  doc.text(`${lang === 'tr' ? 'Tarih' : 'Date'}: ${today}`, W - 14, 22, { align: 'right' });

  // ── Customer info box ────────────────────────────────────────────────────
  const boxY = 38;
  doc.setFillColor(...LIGHT);
  doc.roundedRect(14, boxY, W - 28, 28, 2, 2, 'F');

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text(lang === 'tr' ? 'MÜŞTERİ' : 'CUSTOMER', 20, boxY + 7);

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(11);
  doc.text(normTR(lead.name), 20, boxY + 14);

  doc.setFont('Roboto', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  const infoLine = [lead.company, lead.email, lead.phone].filter(Boolean).join('  •  ');
  doc.text(normTR(infoLine), 20, boxY + 20);

  if (lead.creditLimit) {
    doc.setFont('Roboto', 'bold');
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
  // Siralama paylasilan `siparisTarihMs` ile: `syncedAt` yoksa (Mikro turevi)
  // eskiden 0 doner ve o kayitlar listenin sonuna yigiliyordu.
  const sorted = [...orders].sort((a, b) => siparisTarihMs(b) - siparisTarihMs(a));

  const statusLabel: Record<string, { tr: string; en: string }> = {
    Pending:    { tr: 'Bekliyor',       en: 'Pending'    },
    Processing: { tr: 'Hazırlanıyor',   en: 'Processing' },
    Shipped:    { tr: 'Kargoda',        en: 'Shipped'    },
    Delivered:  { tr: 'Teslim Edildi',  en: 'Delivered'  },
    Cancelled:  { tr: 'İptal',          en: 'Cancelled'  },
  };

  const head = lang === 'tr'
    ? [['Sipariş No', 'Tarih', 'Durum', 'Ürünler', 'Tutar (TRY)']]
    : [['Order No',   'Date',  'Status', 'Items',  'Amount (TRY)']];

  const body = sorted.map(o => {
    const dateObj = siparisTarih(o);
    const dateStr2 = dateObj ? dateObj.toLocaleDateString('tr-TR') : '—';
    const itemNames = (o.lineItems ?? []).map(l => normTR(String(l.name ?? l.title ?? l.sku ?? ''))).slice(0, 2).join(', ');
    const status   = statusLabel[o.status]?.[lang] ?? o.status;
    return [
      normTR(gorunenSiparisNo(o)),
      dateStr2,
      status,
      normTR(itemNames || '—'),
      (o.totalPrice ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 }),
    ];
  });

  autoTable(doc, {
    startY:     tableY,
    head,
    body,
    styles:       { font: 'Roboto', fontSize: 8, cellPadding: 3, overflow: 'ellipsize' },
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
    doc.setFont('Roboto', i === 2 ? 'bold' : 'normal');
    doc.setFontSize(i === 2 ? 9 : 8);
    const color = i === 2 ? BRAND : GREY;
    doc.setTextColor(...color);
    doc.text(label, W - 76, y);
    doc.text(value, W - 18, y, { align: 'right' });
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND);
  doc.rect(0, H - 14, W, 14, 'F');
  doc.setFont('Roboto', 'normal');
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

export const exportPurchaseOrderPDF = async (po: PurchaseOrderDoc, lang: 'tr' | 'en' = 'tr') => {
  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await registerTurkishFont(doc);
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

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('CETPA', 14, 15);

  doc.setFontSize(8);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(255, 200, 180);
  doc.text('SATIŞ & LOJİSTİK', 14, 21);

  doc.setFontSize(14);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(lang === 'tr' ? 'SATIN ALMA EMRİ' : 'PURCHASE ORDER', W - 14, 15, { align: 'right' });

  doc.setFontSize(8);
  doc.setFont('Roboto', 'normal');
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
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...BRAND);
  doc.text(lang === 'tr' ? 'TEDARİKÇİ' : 'SUPPLIER', col1 + 4, boxY + 6);
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text(normTR(po.supplier || '-'), col1 + 4, boxY + 16);

  // Order details box
  doc.setFillColor(...LIGHT);
  doc.roundedRect(col2, boxY, colW, boxH, 2, 2, 'F');
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...BRAND);
  doc.text(lang === 'tr' ? 'SİPARİŞ DETAYI' : 'ORDER DETAILS', col2 + 4, boxY + 6);
  doc.setFont('Roboto', 'normal');
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
  doc.setFont('Roboto', 'bold');
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
    ? [['#', 'Ürün Adı', 'SKU', 'Miktar', 'Alis Fiyati', 'Tutar']]
    : [['#', 'Product Name', 'SKU', 'Qty', 'Unit Cost', 'Amount']];

  autoTable(doc, {
    startY: boxY + boxH + 6,
    head,
    body: tableData.length ? tableData : [['', lang === 'tr' ? 'Kalem eklenmedi' : 'No items', '', '', '', '']],
    styles: { font: 'Roboto' },
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
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(lang === 'tr' ? 'GENEL TOPLAM' : 'GRAND TOTAL', totalsX + 2, totalsY + 7.5);
  doc.text(`${(po.totalAmount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`, W - 16, totalsY + 7.5, { align: 'right' });

  // ── Notes ─────────────────────────────────────────────────────────────────
  if (po.notes) {
    const notesY = totalsY + 20;
    doc.setFont('Roboto', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...BRAND);
    doc.text(lang === 'tr' ? 'NOTLAR' : 'NOTES', 14, notesY);
    doc.setFont('Roboto', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    const noteLines = doc.splitTextToSize(normTR(po.notes), W - 28);
    doc.text(noteLines, 14, notesY + 6);
  }

  // ── Footer band ───────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND);
  doc.rect(0, H - 14, W, 14, 'F');
  doc.setFontSize(7.5);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(255, 220, 210);
  doc.text('Bu belge elektronik olarak oluşturulmuştur.', 14, H - 6);
  doc.setTextColor(255, 255, 255);
  doc.text(`CETPA  •  cetpa.com  •  ${today}`, W - 14, H - 6, { align: 'right' });

  const dateSlug = today.replace(/\./g, '-');
  doc.save(`CETPA_SAS_${normTR(po.orderNumber)}_${dateSlug}.pdf`);
};

// ── Goods Receipt Note (Teslim Makbuzu) ──────────────────────────────────────

export const exportGoodsReceiptPDF = async (po: PurchaseOrderDoc, lang: 'tr' | 'en' = 'tr') => {
  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await registerTurkishFont(doc);
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

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('CETPA', 14, 15);

  doc.setFontSize(8);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(180, 240, 200);
  doc.text('SATIŞ & LOJİSTİK', 14, 21);

  doc.setFontSize(14);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(lang === 'tr' ? 'TESLİM MAKBUZU' : 'GOODS RECEIPT NOTE', W - 14, 15, { align: 'right' });

  doc.setFontSize(8);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(180, 240, 200);
  doc.text(`SAS: ${po.orderNumber}  |  ${today}`, W - 14, 26, { align: 'right' });

  // ── Info boxes ─────────────────────────────────────────────────────────────
  const boxY = 38;
  const boxH = 28;
  const col1 = 14, col2 = W / 2 + 4;
  const colW = W / 2 - 18;

  doc.setFillColor(...LIGHT);
  doc.roundedRect(col1, boxY, colW, boxH, 2, 2, 'F');
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...GREEN);
  doc.text(lang === 'tr' ? 'TEDARİKÇİ' : 'SUPPLIER', col1 + 4, boxY + 6);
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.text(normTR(po.supplier || '-'), col1 + 4, boxY + 14);

  doc.setFillColor(...LIGHT);
  doc.roundedRect(col2, boxY, colW, boxH, 2, 2, 'F');
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...GREEN);
  doc.text(lang === 'tr' ? 'TESLİM BİLGİLERİ' : 'RECEIPT INFO', col2 + 4, boxY + 6);
  doc.setFont('Roboto', 'normal');
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
    ? [['#', 'Ürün Adı', 'SKU', 'Beklenen', 'Birim Fiyat', 'Toplam', 'Teslim Alındı']]
    : [['#', 'Product Name', 'SKU', 'Expected', 'Unit Cost', 'Total', 'Received']];

  autoTable(doc, {
    startY: boxY + boxH + 6,
    head,
    body: tableData.length ? tableData : [['', lang === 'tr' ? 'Kalem yok' : 'No items', '', '', '', '', '']],
    styles: { font: 'Roboto' },
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
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(lang === 'tr' ? 'GENEL TOPLAM' : 'GRAND TOTAL', W - 70, sigY + 7.5);
  doc.text(`${(po.totalAmount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`, W - 16, sigY + 7.5, { align: 'right' });

  // Signature boxes
  const sigBoxY = sigY + 20;
  const sigBoxW = (W - 28) / 3;
  [
    lang === 'tr' ? 'TESLİM EDEN'   : 'DELIVERED BY',
    lang === 'tr' ? 'TESLİM ALAN'   : 'RECEIVED BY',
    lang === 'tr' ? 'ONAYLAYAN'     : 'APPROVED BY',
  ].forEach((lbl, i) => {
    const x = 14 + i * (sigBoxW + 4);
    doc.setFillColor(...LIGHT);
    doc.roundedRect(x, sigBoxY, sigBoxW, 22, 1.5, 1.5, 'F');
    doc.setFont('Roboto', 'bold');
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
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(180, 240, 200);
  doc.text('Bu belge elektronik olarak oluşturulmuştur.', 14, H - 6);
  doc.setTextColor(255, 255, 255);
  doc.text(`CETPA  •  cetpa.com  •  ${today}`, W - 14, H - 6, { align: 'right' });

  const dateSlug2 = today.replace(/\./g, '-');
  doc.save(`CETPA_TMK_${normTR(po.orderNumber)}_${dateSlug2}.pdf`);
};
