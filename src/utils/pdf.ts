import { jsPDF } from 'jspdf';
import { gorunenSiparisNo, siparisTarih, siparisTarihMs } from './siparis';
import { tarihYaz } from './zaman';
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
import { tutarYaz, kdvAyristir, satirTutari, bilinenSayi, teklifToplamlari } from './para';
// Başlık bandı / alt bant / bilgi kutusu / palet TEK KAYNAK (Faz 2 3/n, 2026-09-12): bu dosyadaki
// 4 üretici eskiden her biri kendi bandını ve palet kopyasını yazıyordu (pdfTheme.degismez.test.ts kilitler).
import { pdfBaslik, pdfAltBilgi, pdfBilgiKutusu, PDF_RENK, type RGB } from './pdfTheme';

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
  const sablon = await sablonGetir(belgeTipi);
  const teklifMi = belgeTipi === 'teklif';
  // Para birimi ARTIK okunuyor. Eskiden 5 yerde sabit ' TL' yazıyordu; EUR bir
  // teklif B2B Portalı'ndan indirildiğinde tutar 'TL' olarak basılıyordu —
  // aynı teklifin QuotationDetail nüshası '€' basarken. Müşteriye giden iki
  // belgede iki farklı para birimi.
  const paraBirimi = String((order as Record<string, unknown>).currency || 'TL');
  // Şablon rengi (Belge Tasarımcısı) — palet geri kalanı PDF_RENK'ten.
  const BRAND: RGB = sablonRengi(sablon);

  // TARIHI BILMIYORSAK BUGUNU BASMA (2026-09-04 denetimi). Eskiden `?? new Date()`
  // yedegi vardi: Mikro faturasindan turetilen siparisin PDF'inde BUGUNUN tarihi
  // cikiyordu — musteriye giden belgede yanlis tarih. utils/zaman.ts bu tuzagi
  // dosya basliginda "olumcul" diye belgeliyor.
  const dateStr = tarihYaz(siparisTarih(order));
  // Teklifte `orderNumber` yoktur; `gorunenSiparisNo` o durumda '#'+id.slice(-6)
  // uretir — hem SIPARIS numarasi bicimindedir hem de QuotationDetail'in bastigi
  // numaradan (id.substring(0,8).toUpperCase()) FARKLIDIR. Ayni teklif iki
  // yuzeyden iki farkli numarayla cikiyordu; musteri numarayla arayinca kayit
  // bulunamiyordu. Teklif yolunda QuotationDetail ile AYNI kurali kullan.
  const orderNo = teklifMi
    ? String((order as Record<string, unknown>).id ?? '').substring(0, 8).toUpperCase() || '—'
    : gorunenSiparisNo(order).substring(0, 14);

  // ── Header band (tek kaynak: pdfBaslik — gövde döndürdüğü Y'den başlar) ──
  const boxY = pdfBaslik(doc, {
    belgeAdi: sablon?.title?.trim() || VARSAYILAN_BASLIK[belgeTipi],
    meta: `No: ${orderNo}  |  Tarih: ${dateStr}`,
    renk: BRAND,
  });

  // ── Info boxes ─────────────────────────────────────────────────────────
  const boxH = 32;
  const col1 = 14, col2 = W / 2 + 4;
  const colW = W / 2 - 18;

  pdfBilgiKutusu(doc, {
    x: col1, y: boxY, w: colW, h: boxH, baslik: 'MÜŞTERİ BİLGİLERİ', renk: BRAND,
    satirlar: [
      { metin: normTR(String(order.customerName || '-')), dy: 13, boyut: 9 },
      { metin: normTR(String(order.shippingAddress || '')), dy: 20, boyut: 8, renk: PDF_RENK.grey, maxWidth: colW - 8 },
    ],
  });

  // Teklifte `status` ham İngilizce ('approved') ve `trackingNumber` HİÇ YOK —
  // eskiden ikisi de basılıyordu ve müşteri "Takip No: -" görüyordu.
  const detaySatirlari = teklifMi
    ? [{ metin: `Geçerlilik: ${tarihYaz((order as Record<string, unknown>).validUntil)}`, dy: 13, boyut: 8.5 }]
    : [
        { metin: `Durum: ${normTR(String(order.status || '-'))}`, dy: 13, boyut: 8.5 },
        { metin: `Takip No: ${normTR(String(order.trackingNumber || '-'))}`, dy: 20, boyut: 8.5 },
      ];
  pdfBilgiKutusu(doc, {
    x: col2, y: boxY, w: colW, h: boxH, baslik: teklifMi ? 'TEKLİF DETAYI' : 'SİPARİŞ DETAYI', renk: BRAND,
    satirlar: detaySatirlari,
  });

  // ── Items table ────────────────────────────────────────────────────────
  const lineItems = ((order as Record<string, unknown>).lineItems || (order as Record<string, unknown>).items || []) as any[];
  const tableData = lineItems.map((item: any, idx: number) => [
    String(idx + 1),
    normTR(String(item.title || item.name || '-')),
    item.sku || '-',
    bilinenSayi(item.quantity) ? String(item.quantity) : '—',
    tutarYaz(item.price, paraBirimi),                                  // bilinmeyen '—' (eskiden `|| 0` → 0,00)
    tutarYaz(satirTutari(item.price, item.quantity), paraBirimi),
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
    headStyles: { fillColor: BRAND, textColor: PDF_RENK.white, fontStyle: 'bold', fontSize: 8, cellPadding: 3 },
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
  // Toplamlar (Faz 1 4/n): eskiden `totalPrice || … || 0` ve `kdvOran || 20` — tutarı bilinmeyen
  // sipariş 0,00, KDV oranı bilinmeyen sipariş %20 varsayımıyla basılıyordu (müşteriye giden belge).
  // Artık: brüt bilinmiyorsa '—'; oran bilinmiyorsa Ara Toplam/KDV '—', Genel Toplam yine basılır.
  const o = order as Record<string, unknown>;
  // KALEM BAZLI KDV ÖNCE (4/n incelemesi): teklif kayıtlarında (B2BPortal → 'teklif') kdvOran YOK,
  // ama her kalemde vatRate VAR — Form/Detail ile aynı `teklifToplamlari`. Aksi halde bilinen KDV
  // kırılımı müşteriye '—' diye gidiyordu. Sıra: açık kdvHaric/kdvTutari → kalemler → kdvOran ile ayrıştır.
  // Tablo satırlarıyla aynı kaynak (`lineItems || items`) — yeniden inceleme: iki şekil ayrışmasın.
  const hamKalemler = Array.isArray(o.lineItems) ? o.lineItems : Array.isArray(o.items) ? o.items : [];
  const kalemler = hamKalemler as Parameters<typeof teklifToplamlari>[0];
  const kalemToplam = kalemler.length ? teklifToplamlari(kalemler) : null;
  const kalemdenBilinir = kalemToplam !== null && kalemToplam.bilinmeyenSatir === 0 && Number.isFinite(kalemToplam.kdv);
  const totalPrice = bilinenSayi(o.totalPrice) ? Number(o.totalPrice)
    : bilinenSayi(o.totalAmount) ? Number(o.totalAmount)
    : kalemdenBilinir && kalemToplam ? kalemToplam.brut : NaN;
  const kdvOran   = bilinenSayi(o.kdvOran) ? Number(o.kdvOran) : NaN;
  const ayrisim   = bilinenSayi(o.kdvHaricTutar) && bilinenSayi(o.kdvTutari)
    ? { net: Number(o.kdvHaricTutar), kdv: Number(o.kdvTutari) }
    : kalemdenBilinir && kalemToplam ? { net: kalemToplam.net, kdv: kalemToplam.kdv }
    : kdvAyristir(totalPrice, kdvOran);
  const subTotal  = ayrisim ? ayrisim.net : NaN;
  const vatTotal  = ayrisim ? ayrisim.kdv : NaN;
  // Etiketteki oran: açık kdvOran; yoksa kalemlerin ORTAK oranı; oranlar karışıksa oransız 'KDV:'; bilinmiyorsa '%—'.
  const kalemOranlari = new Set(kalemler.map(k => Number((k as { vatRate?: unknown }).vatRate)).filter(Number.isFinite));
  const etiketOran = Number.isFinite(kdvOran) ? kdvOran : (kalemdenBilinir && kalemOranlari.size === 1 ? [...kalemOranlari][0] : null);
  const kdvEtiketi = etiketOran != null ? `KDV (%${etiketOran}):` : ayrisim ? 'KDV:' : 'KDV (%—):';

  const totalsX = W - 70;
  const totalsY = finalY + 8;

  doc.setFillColor(...PDF_RENK.light);
  doc.roundedRect(totalsX - 4, totalsY - 4, 60, 34, 2, 2, 'F');

  doc.setFontSize(8.5);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(...PDF_RENK.grey);
  doc.text('Ara Toplam:', totalsX + 2, totalsY + 4);
  doc.text(kdvEtiketi, totalsX + 2, totalsY + 12);
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_RENK.dark);
  doc.text(tutarYaz(subTotal, paraBirimi), W - 16, totalsY + 4, { align: 'right' });
  doc.text(tutarYaz(vatTotal, paraBirimi), W - 16, totalsY + 12, { align: 'right' });

  doc.setFillColor(...BRAND);
  doc.roundedRect(totalsX - 4, totalsY + 16, 60, 10, 1.5, 1.5, 'F');
  doc.setFontSize(10);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(...PDF_RENK.white);
  doc.text('GENEL TOPLAM', totalsX + 2, totalsY + 23);
  doc.text(tutarYaz(totalPrice, paraBirimi), W - 16, totalsY + 23, { align: 'right' });

  // ── Footer band ────────────────────────────────────────────────────────
  // Banka blogu ARTIK ortak cizicide: tablonun bittigi yerden asagi yerlesir ve
  // sigmiyorsa yeni sayfa acar. Eskiden `H - 20`'ye SABIT konuluyordu ve uzun
  // tabloda GENEL TOPLAM kutusunun uzerine biniyordu.
  belgeAltBilgisiCiz(doc, {
    baslangicY: totalsY + 30,
    banka: bankaBilgisiBasilir(sablon),
    genislik: W - 100,   // toplam kutusunun soluna sigsin
  });

  // Alt bant TUM sayfalara — tek kaynak pdfAltBilgi (bant modu): sablon footer'i tek
  // satira kirpilir (sagdaki sayfa etiketiyle cakismasin), sag tarafta GERCEK sayfa
  // numarasi. Eskiden burada elle `for sayfa…` dongusu vardi; daha da eskiden yalniz son
  // sayfaya ciziliyordu ve 1..N-1 sayfalarinda alt bilgi/sayfa numarasi yoktu.
  pdfAltBilgi(doc, { bant: BRAND, solMetin: sablon?.footer?.trim() || 'Bu belge elektronik olarak oluşturulmuştur.' });

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
  // Hesap ekstresi BELGE TÜRÜ rengi: lacivert #1a3a5c — marka değil, bilinçli (Faz 2 3/n'de korundu).
  // Palet geri kalanı (açık zemin, koyu/gri metin, beyaz) PDF_RENK'ten.
  const BRAND: RGB = [26, 58, 92];

  const today = tarihYaz(new Date());   // üretim tarihi = gerçek şimdi; gösterim tek kaynak

  // ── Header band (tek kaynak: pdfBaslik) ──────────────────────────────────
  const boxY = pdfBaslik(doc, {
    belgeAdi: lang === 'tr' ? 'HESAP EKSTRESİ' : 'ACCOUNT STATEMENT',
    meta: `${lang === 'tr' ? 'Tarih' : 'Date'}: ${today}`,
    renk: BRAND,
  });

  // ── Customer info box ────────────────────────────────────────────────────
  // pdfBilgiKutusu'na ÇEVRİLMEDİ: bu kutu standart yerleşimde değil (başlık koyu 9pt x+6/y+7,
  // müşteri adı KALIN 11pt, kredi limiti sağa dayalı). Geometri korunuyor, yalnız palet tek kaynaktan.
  doc.setFillColor(...PDF_RENK.light);
  doc.roundedRect(14, boxY, W - 28, 28, 2, 2, 'F');

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_RENK.dark);
  doc.text(lang === 'tr' ? 'MÜŞTERİ' : 'CUSTOMER', 20, boxY + 7);

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(11);
  doc.text(normTR(lead.name), 20, boxY + 14);

  doc.setFont('Roboto', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...PDF_RENK.grey);
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
    const dateStr2 = tarihYaz(siparisTarih(o));
    const itemNames = (o.lineItems ?? []).map(l => normTR(String(l.name ?? l.title ?? l.sku ?? ''))).slice(0, 2).join(', ');
    const status   = statusLabel[o.status]?.[lang] ?? o.status;
    return [
      normTR(gorunenSiparisNo(o)),
      dateStr2,
      status,
      normTR(itemNames || '—'),
      tutarYaz(o.totalPrice, '').trim(),   // bilinmeyen '—'
    ];
  });

  autoTable(doc, {
    startY:     tableY,
    head,
    body,
    styles:       { font: 'Roboto', fontSize: 8, cellPadding: 3, overflow: 'ellipsize' },
    headStyles:   { fillColor: BRAND, textColor: PDF_RENK.white, fontStyle: 'bold', fontSize: 8 },
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
  doc.setFillColor(...PDF_RENK.light);
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
    const color = i === 2 ? BRAND : PDF_RENK.grey;
    doc.setTextColor(...color);
    doc.text(label, W - 76, y);
    doc.text(value, W - 18, y, { align: 'right' });
  });

  // ── Footer (tek kaynak: pdfAltBilgi bant modu — HER sayfaya, gerçek sayfa no) ──
  // Eskiden yalnız son sayfaya çiziliyordu ve sağda `cetpa.com • tarih` yazıyordu.
  pdfAltBilgi(doc, {
    bant: BRAND,
    solMetin: lang === 'tr'
      ? `Bu ekstre ${today} tarihinde CETPA tarafindan uretilmistir.`
      : `This statement was generated by CETPA on ${today}.`,
  });

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

  const today = tarihYaz(new Date());   // üretim tarihi = gerçek şimdi; gösterim tek kaynak

  // ── Header band (tek kaynak: pdfBaslik, marka rengi) ─────────────────────
  const boxY = pdfBaslik(doc, {
    belgeAdi: lang === 'tr' ? 'SATIN ALMA EMRİ' : 'PURCHASE ORDER',
    meta: `No: ${po.orderNumber}  |  ${today}`,
  });

  // ── Info boxes ─────────────────────────────────────────────────────────────
  const boxH = 34;
  const col1 = 14, col2 = W / 2 + 4;
  const colW = W / 2 - 18;

  // Supplier box — kutu + başlık tek kaynaktan; tedarikçi adı KALIN 11pt (standart satır
  // normal fonttur), o yüzden aynı konuma elle basılır.
  pdfBilgiKutusu(doc, { x: col1, y: boxY, w: colW, h: boxH, baslik: lang === 'tr' ? 'TEDARİKÇİ' : 'SUPPLIER', satirlar: [] });
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...PDF_RENK.dark);
  doc.text(normTR(po.supplier || '-'), col1 + 4, boxY + 16);

  // Order details box
  const expDateStr = tarihYaz(po.expectedDate);   // string/Timestamp fark etmez; bilinmiyorsa '—'
  pdfBilgiKutusu(doc, {
    x: col2, y: boxY, w: colW, h: boxH, baslik: lang === 'tr' ? 'SİPARİŞ DETAYI' : 'ORDER DETAILS',
    satirlar: [
      { metin: `${lang === 'tr' ? 'Durum' : 'Status'}: ${normTR(po.status || '-')}`, dy: 14, boyut: 8.5 },
      { metin: `${lang === 'tr' ? 'Beklenen' : 'Expected'}: ${expDateStr}`, dy: 22, boyut: 8.5, renk: PDF_RENK.grey },
    ],
  });
  // Toplam satırı KALIN + marka renkli — standart satır normal fonttur; aynı konuma elle.
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PDF_RENK.brand);
  doc.text(`${lang === 'tr' ? 'Toplam' : 'Total'}: ${tutarYaz(po.totalAmount, 'TL')}`, col2 + 4, boxY + 30);

  // ── Items table ───────────────────────────────────────────────────────────
  const tableData = (po.items || []).map((item, idx) => [
    String(idx + 1),
    normTR(item.name || '-'),
    item.sku || '-',
    bilinenSayi(item.quantity) ? String(item.quantity) : '—',
    tutarYaz(item.purchasePrice, 'TL'),
    tutarYaz(satirTutari(item.purchasePrice, item.quantity), 'TL'),
  ]);

  const head = lang === 'tr'
    ? [['#', 'Ürün Adı', 'SKU', 'Miktar', 'Alis Fiyati', 'Tutar']]
    : [['#', 'Product Name', 'SKU', 'Qty', 'Unit Cost', 'Amount']];

  autoTable(doc, {
    startY: boxY + boxH + 6,
    head,
    body: tableData.length ? tableData : [['', lang === 'tr' ? 'Kalem eklenmedi' : 'No items', '', '', '', '']],
    styles: { font: 'Roboto' },
    headStyles: { fillColor: PDF_RENK.brand, textColor: PDF_RENK.white, fontStyle: 'bold', fontSize: 8, cellPadding: 3 },
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

  doc.setFillColor(...PDF_RENK.brand);
  doc.roundedRect(totalsX - 4, totalsY, 60, 11, 1.5, 1.5, 'F');
  doc.setFontSize(10);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(...PDF_RENK.white);
  doc.text(lang === 'tr' ? 'GENEL TOPLAM' : 'GRAND TOTAL', totalsX + 2, totalsY + 7.5);
  doc.text(`${tutarYaz(po.totalAmount, 'TL')}`, W - 16, totalsY + 7.5, { align: 'right' });

  // ── Notes ─────────────────────────────────────────────────────────────────
  if (po.notes) {
    const notesY = totalsY + 20;
    doc.setFont('Roboto', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...PDF_RENK.brand);
    doc.text(lang === 'tr' ? 'NOTLAR' : 'NOTES', 14, notesY);
    doc.setFont('Roboto', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_RENK.dark);
    const noteLines = doc.splitTextToSize(normTR(po.notes), W - 28);
    doc.text(noteLines, 14, notesY + 6);
  }

  // ── Footer band (tek kaynak: pdfAltBilgi bant modu — HER sayfaya) ─────────
  pdfAltBilgi(doc, { bant: PDF_RENK.brand, solMetin: 'Bu belge elektronik olarak oluşturulmuştur.' });

  const dateSlug = today.replace(/\./g, '-');
  doc.save(`CETPA_SAS_${normTR(po.orderNumber)}_${dateSlug}.pdf`);
};

// ── Goods Receipt Note (Teslim Makbuzu) ──────────────────────────────────────

export const exportGoodsReceiptPDF = async (po: PurchaseOrderDoc, lang: 'tr' | 'en' = 'tr') => {
  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await registerTurkishFont(doc);
  const W    = doc.internal.pageSize.getWidth();
  // Mal kabul BELGE TÜRÜ rengi: yeşil — tek kaynaktan (eskiden yerel [22,163,74] kopyasıydı).
  const GREEN = PDF_RENK.green;

  const today = tarihYaz(new Date());   // üretim tarihi = gerçek şimdi; gösterim tek kaynak

  // ── Header band (tek kaynak: pdfBaslik) ───────────────────────────────────
  const boxY = pdfBaslik(doc, {
    belgeAdi: lang === 'tr' ? 'TESLİM MAKBUZU' : 'GOODS RECEIPT NOTE',
    meta: `SAS: ${po.orderNumber}  |  ${today}`,
    renk: GREEN,
  });

  // ── Info boxes ─────────────────────────────────────────────────────────────
  const boxH = 28;
  const col1 = 14, col2 = W / 2 + 4;
  const colW = W / 2 - 18;

  // Tedarikçi adı KALIN 10pt (standart satır normal fonttur) → kutu + başlık tek kaynaktan, ad aynı konuma elle.
  pdfBilgiKutusu(doc, { x: col1, y: boxY, w: colW, h: boxH, baslik: lang === 'tr' ? 'TEDARİKÇİ' : 'SUPPLIER', renk: GREEN, satirlar: [] });
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...PDF_RENK.dark);
  doc.text(normTR(po.supplier || '-'), col1 + 4, boxY + 14);

  pdfBilgiKutusu(doc, {
    x: col2, y: boxY, w: colW, h: boxH, baslik: lang === 'tr' ? 'TESLİM BİLGİLERİ' : 'RECEIPT INFO', renk: GREEN,
    satirlar: [
      { metin: `${lang === 'tr' ? 'Tarih' : 'Date'}: ${today}`, dy: 14, boyut: 8.5 },
      { metin: `SAS No: ${po.orderNumber}`, dy: 21, boyut: 8.5, renk: PDF_RENK.grey },
    ],
  });

  // ── Items table ───────────────────────────────────────────────────────────
  const tableData = (po.items || []).map((item, idx) => [
    String(idx + 1),
    normTR(item.name || '-'),
    item.sku || '-',
    bilinenSayi(item.quantity) ? String(item.quantity) : '—',
    tutarYaz(item.purchasePrice, 'TL'),
    tutarYaz(satirTutari(item.purchasePrice, item.quantity), 'TL'),
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
    headStyles: { fillColor: GREEN, textColor: PDF_RENK.white, fontStyle: 'bold', fontSize: 8, cellPadding: 3 },
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
  doc.setTextColor(...PDF_RENK.white);
  doc.text(lang === 'tr' ? 'GENEL TOPLAM' : 'GRAND TOTAL', W - 70, sigY + 7.5);
  doc.text(`${tutarYaz(po.totalAmount, 'TL')}`, W - 16, sigY + 7.5, { align: 'right' });

  // Signature boxes
  const sigBoxY = sigY + 20;
  const sigBoxW = (W - 28) / 3;
  [
    lang === 'tr' ? 'TESLİM EDEN'   : 'DELIVERED BY',
    lang === 'tr' ? 'TESLİM ALAN'   : 'RECEIVED BY',
    lang === 'tr' ? 'ONAYLAYAN'     : 'APPROVED BY',
  ].forEach((lbl, i) => {
    const x = 14 + i * (sigBoxW + 4);
    doc.setFillColor(...PDF_RENK.light);
    doc.roundedRect(x, sigBoxY, sigBoxW, 22, 1.5, 1.5, 'F');
    doc.setFont('Roboto', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...GREEN);
    doc.text(lbl, x + 4, sigBoxY + 6);
    doc.setDrawColor(200, 220, 200);
    doc.setLineWidth(0.3);
    doc.line(x + 4, sigBoxY + 17, x + sigBoxW - 4, sigBoxY + 17);
  });

  // ── Footer (tek kaynak: pdfAltBilgi bant modu — HER sayfaya) ──────────────
  pdfAltBilgi(doc, { bant: GREEN, solMetin: 'Bu belge elektronik olarak oluşturulmuştur.' });

  const dateSlug2 = today.replace(/\./g, '-');
  doc.save(`CETPA_TMK_${normTR(po.orderNumber)}_${dateSlug2}.pdf`);
};
