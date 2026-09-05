import React from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X, Download, Printer, Edit2, CheckCircle2, Clock, AlertTriangle, FileText, User, Calendar, ShoppingCart } from 'lucide-react';
import { jsPDF } from 'jspdf';
import MikroPushButton from './MikroPushButton';
import { teklifPayload } from '../services/mikroEvrak';
import autoTable from 'jspdf-autotable';
import { registerTurkishFont } from '../utils/pdfFont';
import { formatAmount } from '../utils/currency';
import { type Quotation, type QuotationItem } from '../types';
import { format } from 'date-fns';
import { sablonGetir, sablonRengi, bankaBilgisiBasilir, belgeAltBilgisiCiz, VARSAYILAN_BASLIK } from '../utils/belgeSablonu';
import { tr } from 'date-fns/locale';
import { cn } from '../lib/utils';

interface QuotationDetailProps {
  isOpen: boolean;
  quotation: Quotation | null;
  onClose: () => void;
  onEdit: (q: Quotation) => void;
  onConvertToOrder?: (q: Quotation) => Promise<void>;
  t: Record<string, string>;
}

export default function QuotationDetail({ isOpen, quotation, onClose, onEdit, onConvertToOrder, t }: QuotationDetailProps) {
  const [isConverting, setIsConverting] = React.useState(false);
  const [pdfError, setPdfError] = React.useState<string | null>(null);

  if (!isOpen || !quotation) return null;

  // Kayitta para birimi yoksa TRY: uygulamanin kendi varsayimi
  // (QuotationForm.tsx teklifi duzenlemeye acarken `initialData.currency || 'TRY'` yapiyor).
  const paraBirimi = quotation.currency || 'TRY';
  // totalAmount BILINMIYOR olabilir; 0 varsaymak yerine UI'da '—' gosteriyoruz.
  // null da bilinmiyordur: `null === undefined` false → `null / 1.2 === 0` → ₺0,00 basılırdı (inceleme).
  const toplam = Number.isFinite(quotation.totalAmount) ? Number(quotation.totalAmount) : undefined;
  const araToplam = toplam === undefined ? undefined : toplam / 1.2;
  const kdvToplam = toplam === undefined ? undefined : toplam - toplam / 1.2;
  const tutarYaz = (v: number | undefined) => (v === undefined ? '—' : formatAmount(v, paraBirimi));

  const handleConvertToOrder = async () => {
    if (!onConvertToOrder) return;
    setIsConverting(true);
    try {
      await onConvertToOrder(quotation);
    } finally {
      setIsConverting(false);
    }
  };

  const exportToPDF = async () => {
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerTurkishFont(doc);
      const W = doc.internal.pageSize.getWidth();   // 210
      const H = doc.internal.pageSize.getHeight();  // 297

      // Belge Tasarimcisi sablonu (Ayarlar → Belge Tasarimcisi → Teklif).
      // Okunamazsa `null` doner ve asagidaki varsayilanlar gecerli kalir —
      // sablon yuzunden PDF uretimi ASLA cokmez (sablonGetir hatayi yutar).
      const sablon = await sablonGetir('teklif');
      const BRAND: [number, number, number] = sablonRengi(sablon);
      const DARK: [number, number, number]  = [29, 29, 31];
      const GREY: [number, number, number]  = [134, 134, 139];
      const LIGHT: [number, number, number] = [245, 245, 247];

      // registerTurkishFont (Roboto) artık Türkçe glifleri kapsıyor — harf
      // düşürmeye gerek yok (2026-08-17). Passthrough, çağrı yerlerini bozmamak için.
      const tr = (s: string) => s;

      // ── Header band ──────────────────────────────────────────────────────
      doc.setFillColor(...BRAND);
      doc.rect(0, 0, W, 32, 'F');

      // Brand name
      doc.setFont('Roboto', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(255, 255, 255);
      doc.text('CETPA', 14, 15);

      doc.setFontSize(8);
      doc.setFont('Roboto', 'normal');
      doc.setTextColor(255, 200, 180);
      doc.text('SATIŞ & LOJİSTİK', 14, 21);

      // Document type — right aligned
      doc.setFontSize(16);
      doc.setFont('Roboto', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(sablon?.title?.trim() || VARSAYILAN_BASLIK.teklif, W - 14, 15, { align: 'right' });

      // Parse date
      let dateObj = new Date();
      if (quotation.createdAt) {
        const ca = quotation.createdAt;
        dateObj = (typeof ca === 'object' && ca !== null && 'toDate' in ca && typeof (ca as { toDate: () => Date }).toDate === 'function')
          ? (ca as { toDate: () => Date }).toDate()
          : new Date(ca as string | number | Date);
      }
      const docNo = quotation.id.substring(0, 8).toUpperCase();
      const dateStr = format(dateObj, 'dd.MM.yyyy');
      const validStr = quotation.validUntil ? format(new Date(quotation.validUntil as string | number | Date), 'dd.MM.yyyy') : '-';

      doc.setFontSize(8);
      doc.setFont('Roboto', 'normal');
      doc.setTextColor(255, 220, 210);
      doc.text(`No: ${docNo}  |  Tarih: ${dateStr}  |  Geçerlilik: ${validStr}`, W - 14, 26, { align: 'right' });

      // ── Info boxes (customer | company) ─────────────────────────────────
      const boxY = 38;
      const boxH = 36;
      const col1 = 14, col2 = W / 2 + 4;
      const colW = W / 2 - 18;

      // Customer box
      doc.setFillColor(...LIGHT);
      doc.roundedRect(col1, boxY, colW, boxH, 2, 2, 'F');
      doc.setFont('Roboto', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...BRAND);
      doc.text('MÜŞTERİ BİLGİLERİ', col1 + 4, boxY + 6);
      doc.setFont('Roboto', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...DARK);
      doc.text(tr(quotation.customerName || '-'), col1 + 4, boxY + 13);
      doc.setFontSize(8);
      doc.setTextColor(...GREY);
      doc.text(quotation.customerEmail || '', col1 + 4, boxY + 19);
      doc.text(tr(String(quotation.customerType || '')), col1 + 4, boxY + 25);

      // Company box
      doc.setFillColor(...LIGHT);
      doc.roundedRect(col2, boxY, colW, boxH, 2, 2, 'F');
      doc.setFont('Roboto', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...BRAND);
      doc.text('SATICI BİLGİLERİ', col2 + 4, boxY + 6);
      doc.setFont('Roboto', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...DARK);
      doc.text('CETPA Satış & Lojistik', col2 + 4, boxY + 13);
      doc.setFontSize(8);
      doc.setTextColor(...GREY);
      doc.text('info@cetpa.com', col2 + 4, boxY + 19);
      doc.text('www.cetpa.com', col2 + 4, boxY + 25);

      // Status badge
      const statusColors: Record<string, [number, number, number]> = {
        'Accepted': [16, 185, 129],
        'Rejected': [239, 68, 68],
        'Sent':     [59, 130, 246],
      };
      const sColor = statusColors[quotation.status] ?? GREY;
      doc.setFillColor(...sColor);
      doc.roundedRect(col2 + colW - 28, boxY + 26, 28, 7, 1, 1, 'F');
      doc.setFontSize(7);
      doc.setFont('Roboto', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(tr(quotation.status || 'Taslak'), col2 + colW - 14, boxY + 31, { align: 'center' });

      // ── Items table ─────────────────────────────────────────────────────
      const tableData = (quotation.lineItems || []).map((item: QuotationItem, i: number) => [
        String(i + 1),
        tr(item.name || ''),
        item.sku || '',
        Number.isFinite(item.quantity) ? String(item.quantity) : '—',
        formatAmount(item.price, paraBirimi),   // bilinmeyen → '—' (eskiden ₺0,00 basılıyordu)
        `%${item.vatRate ?? 0}`,
        formatAmount(Number.isFinite(item.price) && Number.isFinite(item.quantity) ? item.price * item.quantity : NaN, paraBirimi),   // null*qty=0 tuzağı — bilinmeyen '—'
      ]);

      autoTable(doc, {
        startY: boxY + boxH + 6,
        head: [['#', 'Ürün / Açıklama', 'SKU', 'Miktar', 'Birim Fiyat', 'KDV', 'Tutar']],
        body: tableData.length ? tableData : [['', 'Ürün eklenmedi', '', '', '', '', '']],
        styles: { font: 'Roboto' },
        headStyles: {
          fillColor: BRAND,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
          cellPadding: 3,
        },
        bodyStyles: { fontSize: 8, cellPadding: 3 },
        alternateRowStyles: { fillColor: [252, 252, 252] },
        columnStyles: {
          0: { cellWidth: 8,  halign: 'center' },
          2: { cellWidth: 22, halign: 'center' },
          3: { cellWidth: 16, halign: 'center' },
          4: { cellWidth: 26, halign: 'right' },
          5: { cellWidth: 14, halign: 'center' },
          6: { cellWidth: 26, halign: 'right' },
        },
        margin: { left: 14, right: 14 },
        tableLineColor: [230, 230, 230],
        tableLineWidth: 0.1,
      });

      // ── Totals ───────────────────────────────────────────────────────────
      const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
      // Bilinmeyen toplam PDF'e ₺0,00 olarak GİTMEZ (Faz 1): ekran zaten '—' gösteriyordu,
      // PDF `|| 0` ile sıfırlık teklif basıyordu — müşteri yüzeyinde yarım düzeltme.
      const total    = Number.isFinite(quotation.totalAmount) ? Number(quotation.totalAmount) : NaN;
      const subTotal = total / 1.2;
      const vatTotal = total - subTotal;

      const totalsX = W - 70;
      const totalsY = finalY + 8;

      doc.setFillColor(...LIGHT);
      doc.roundedRect(totalsX - 4, totalsY - 4, 60, 34, 2, 2, 'F');

      doc.setFontSize(8.5);
      doc.setFont('Roboto', 'normal');
      doc.setTextColor(...GREY);
      doc.text('Ara Toplam:', totalsX + 2, totalsY + 4);
      doc.text('KDV Toplamı:', totalsX + 2, totalsY + 12);
      doc.setFont('Roboto', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...DARK);
      doc.text(formatAmount(subTotal, paraBirimi), W - 16, totalsY + 4, { align: 'right' });
      doc.text(formatAmount(vatTotal, paraBirimi), W - 16, totalsY + 12, { align: 'right' });

      // Grand total row
      doc.setFillColor(...BRAND);
      doc.roundedRect(totalsX - 4, totalsY + 16, 60, 10, 1.5, 1.5, 'F');
      doc.setFontSize(10);
      doc.setFont('Roboto', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text('GENEL TOPLAM', totalsX + 2, totalsY + 23);
      doc.text(formatAmount(total, paraBirimi), W - 16, totalsY + 23, { align: 'right' });

      // ── Notes ────────────────────────────────────────────────────────────
      // Icerigin bittigi Y — banka/alt bilgi blogu bunun ALTINA yerlesir.
      let icerikSonY = totalsY + 30;   // toplam kutusunun alti
      if (quotation.notes) {
        const notesY = totalsY + 36;
        doc.setFontSize(8);
        doc.setFont('Roboto', 'bold');
        doc.setTextColor(...GREY);
        doc.text('NOTLAR', 14, notesY);
        doc.setFont('Roboto', 'normal');
        doc.setTextColor(...DARK);
        doc.setFontSize(8.5);
        const noteLines = doc.splitTextToSize(tr(quotation.notes), totalsX - 22) as string[];
        doc.text(noteLines, 14, notesY + 6);
        icerikSonY = notesY + 6 + noteLines.length * 4;
      }

      // ── Footer band ───────────────────────────────────────────────────────
      // Banka bilgisi — YALNIZ kullanici gercek bir deger girdiyse basilir.
      // `bankaBilgisiBasilir` bos metni de eler: varsayilan sahte IBAN'in
      // musteriye giden teklife basilmasi bu yuzden mumkun degil.
      // Banka blogu ortak cizicide: not blogunun bittigi yerden asagi yerlesir,
      // sigmiyorsa yeni sayfa acar. Eskiden `H - 20`'ye SABIT konuluyordu ve
      // 18+ kalemli teklifte GENEL TOPLAM kutusu + notlarin UZERINE biniyordu.
      belgeAltBilgisiCiz(doc, {
        baslangicY: icerikSonY,
        banka: bankaBilgisiBasilir(sablon),
        genislik: W - 100,
      });

      // Alt bant TUM sayfalara — eskiden yalniz son sayfaya ciziliyordu, cok
      // sayfali belgede 1..N-1 sayfalarinda alt bilgi/sayfa numarasi yoktu.
      // Footer tek satira kirpilir: sagdaki sayfa etiketiyle cakismasin diye.
      const footerMetni = (doc.splitTextToSize(sablon?.footer?.trim() || 'Bu teklif elektronik olarak oluşturulmuştur. İmza gerektirmez.', W - 90) as string[])[0] ?? '';
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

      doc.save(`CETPA_Teklif_${docNo}_${dateStr.replace(/\./g, '-')}.pdf`);
      setPdfError(null);
    } catch (error) {
      console.error('Error generating PDF:', error);
      setPdfError('PDF oluşturulurken bir hata oluştu.');
      setTimeout(() => setPdfError(null), 4000);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Accepted': return <span className="px-3 py-1 bg-green-100 text-green-600 rounded-full text-xs font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {t.accepted || 'Kabul Edildi'}</span>;
      case 'Rejected': return <span className="px-3 py-1 bg-red-100 text-red-600 rounded-full text-xs font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {t.rejected || 'Reddedildi'}</span>;
      case 'Sent': return <span className="px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-xs font-bold flex items-center gap-1"><Clock className="w-3 h-3" /> {t.sent || 'Gönderildi'}</span>;
      default: return <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-bold flex items-center gap-1"><FileText className="w-3 h-3" /> {t.draft || 'Taslak'}</span>;
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      {pdfError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[10000] flex items-center gap-2 bg-red-600 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {pdfError}
        </div>
      )}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand/10 rounded-2xl">
              <FileText className="w-6 h-6 text-brand" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{t.quotation_detail || 'Teklif Detayı'}</h2>
              <p className="text-sm text-gray-500">#{quotation.id.substring(0, 8).toUpperCase()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <MikroPushButton
              method="VerilenTeklifKaydetV2"
              label="Mikro'ya Gönder"
              entityType="quotation"
              entityId={quotation.id}
              buildPayload={() => {
                const items = quotation.lineItems ?? quotation.items ?? [];
                const cariKod = (quotation as Record<string, unknown>).mikroCariKod as string | undefined;
                if (!cariKod || items.length === 0) return null; // cari kodu olmayan teklif Mikro'ya gidemez
                return teklifPayload({
                  cariKod,
                  notes: quotation.notes,
                  belgeNo: quotation.id.slice(0, 8).toUpperCase(),
                  lineItems: items.map(i => ({ sku: i.sku, quantity: i.quantity, price: i.price, title: i.name })),
                });
              }}
            />
            <button onClick={exportToPDF} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-600" title="PDF İndir">
              <Download className="w-5 h-5" />
            </button>
            <button onClick={() => window.print()} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-600" title="Yazdır">
              <Printer className="w-5 h-5" />
            </button>
            <button onClick={() => onEdit(quotation)} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-600" title="Düzenle">
              <Edit2 className="w-5 h-5" />
            </button>
            {quotation.status !== 'Converted to Order' && onConvertToOrder && (
              <button
                onClick={handleConvertToOrder}
                disabled={isConverting}
                className="p-2 hover:bg-green-100 rounded-full transition-colors text-green-600 disabled:opacity-50"
                title={t.convert_to_order || 'Siparişe Dönüştür'}
              >
                <ShoppingCart className={cn("w-5 h-5", isConverting && "animate-pulse")} />
              </button>
            )}
            <div className="w-px h-6 bg-gray-200 mx-2" />
            <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t.customer_info || 'Müşteri Bilgileri'}</h4>
              <div className="space-y-2">
                <p className="text-sm font-bold text-gray-900 flex items-center gap-2"><User className="w-4 h-4 text-gray-400" /> {quotation.customerName}</p>
                <p className="text-sm text-gray-500 flex items-center gap-2"><X className="w-4 h-4 text-transparent" /> {quotation.customerEmail}</p>
              </div>
            </div>
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t.quotation_info || 'Teklif Bilgileri'}</h4>
              <div className="space-y-2">
                <p className="text-sm text-gray-500 flex items-center gap-2"><Calendar className="w-4 h-4 text-gray-400" /> {t.date || 'Tarih'}: {format((quotation.createdAt as { toDate?: () => Date })?.toDate?.() || new Date(), 'dd MMM yyyy', { locale: tr })}</p>
                <p className="text-sm text-gray-500 flex items-center gap-2"><Clock className="w-4 h-4 text-gray-400" /> {t.valid_until || 'Geçerlilik'}: {quotation.validUntil ? format(new Date(quotation.validUntil as string | number | Date), 'dd MMM yyyy', { locale: tr }) : '-'}</p>
              </div>
            </div>
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t.status || 'Durum'}</h4>
              <div>{getStatusBadge(quotation.status)}</div>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t.products || 'Ürünler'}</h4>
            <div className="border border-gray-100 rounded-2xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t.product || 'Ürün'}</th>
                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">{t.quantity || 'Miktar'}</th>
                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">{t.unit_price || 'Birim Fiyat'}</th>
                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">{t.vat || 'KDV'}</th>
                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">{t.total || 'Toplam'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(quotation.lineItems ?? []).map((item: QuotationItem, i: number) => (
                    <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-4">
                        <p className="text-sm font-bold text-gray-900">{item.name}</p>
                        <p className="text-xs text-gray-500">{item.sku}</p>
                      </td>
                      <td className="p-4 text-center text-sm font-medium text-gray-900">{item.quantity}</td>
                      <td className="p-4 text-right text-sm font-medium text-gray-900">{formatAmount(item.price, paraBirimi)}</td>
                      <td className="p-4 text-center text-sm font-medium text-gray-500">%{item.vatRate}</td>
                      <td className="p-4 text-right text-sm font-bold text-gray-900">{formatAmount(Number.isFinite(item.price) && Number.isFinite(item.quantity) ? item.price * item.quantity * (1 + (item.vatRate ?? 0) / 100) : NaN, paraBirimi)   /* null*qty=0 tuzağı (2. inceleme) */}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between gap-8 pt-8 border-t border-gray-100">
            <div className="flex-1 space-y-4">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t.notes || 'Notlar'}</h4>
              <p className="text-sm text-gray-600 leading-relaxed bg-gray-50 p-4 rounded-2xl border border-gray-100">
                {quotation.notes || t.no_notes || 'Not bulunmamaktadır.'}
              </p>
            </div>
            <div className="w-full md:w-64 space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">{t.subtotal || 'Ara Toplam'}</span>
                <span className="font-bold text-gray-900">{tutarYaz(araToplam)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">{t.vat_total || 'KDV Toplam'}</span>
                <span className="font-bold text-gray-900">{tutarYaz(kdvToplam)}</span>
              </div>
              <div className="pt-3 border-t border-gray-100 flex justify-between items-center">
                <span className="text-sm font-bold text-gray-900">{t.grand_total || 'Genel Toplam'}</span>
                <span className="text-xl font-black text-brand">{tutarYaz(toplam)}</span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

