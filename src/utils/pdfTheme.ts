/**
 * pdfTheme.ts — TÜM PDF çıktılarının TEK stil kaynağı.
 *
 * Kullanıcı isteği (2026-08-17): "raporları tek tip olmalı renkler, fontlar —
 * kırmızı arkaplan olan iyi."
 *
 * ÖNCEKİ DURUM (2026-08-21 ölçümü): 11 ayrı yerde `new jsPDF()` çağrılıyor ve
 * her biri kendi renk sabitlerini + başlık çizim kodunu yeniden yazıyordu.
 * Sonuç gözle görülür ayrışma:
 *
 *   sipariş / teklif   → marka kırmızısı #ff4000, 32 mm bant
 *   mutabakat          → LACİVERT #1a3a5c, 28 mm bant
 *   raporlar           → LACİVERT #1a3a5c
 *
 * Aynı firmanın aynı gün ürettiği iki belge farklı kurumsal kimlik taşıyordu.
 * Buradaki yardımcılar tek kaynaktır; PDF üreten hiçbir yer kendi başlık
 * markup'ını yazmaz.
 */
import type { jsPDF } from 'jspdf';

export type RGB = [number, number, number];

/** Marka paleti — index.css'teki --color-brand (#ff4000) ile aynı. */
export const PDF_RENK = {
  brand: [255, 64, 0] as RGB,
  /** Başlık bandındaki ikincil metin (marka üstünde okunur açık ton). */
  brandSoft: [255, 200, 180] as RGB,
  brandMeta: [255, 220, 210] as RGB,
  dark: [29, 29, 31] as RGB,
  grey: [134, 134, 139] as RGB,
  light: [245, 245, 247] as RGB,
  white: [255, 255, 255] as RGB,
  /** Olumlu/tamamlanmış durumlar (ör. mal kabul). */
  green: [16, 122, 87] as RGB,
} as const;

export const PDF_BANT_YUKSEKLIK = 32;

export interface PdfBaslikOpts {
  /** Sağ üstteki belge adı, ör. 'TEKLİF' / 'SİPARİŞ / FATURA'. */
  belgeAdi: string;
  /** Sağ altta küçük satır, ör. 'No: 123 | Tarih: 01.01.2026'. */
  meta?: string;
  /** Sol üstteki alt başlık. Varsayılan kurumsal alt başlık. */
  altBaslik?: string;
}

/**
 * Marka başlık bandını çizer ve gövdenin başlayabileceği Y konumunu döndürür.
 * Font olarak Roboto bekler — çağıran taraf `registerTurkishFont(doc)`
 * çağırmış olmalı (jsPDF'in gömülü fontları ş/ğ/ı/İ taşımıyor).
 */
export function pdfBaslik(doc: jsPDF, opts: PdfBaslikOpts): number {
  const W = doc.internal.pageSize.getWidth();

  doc.setFillColor(...PDF_RENK.brand);
  doc.rect(0, 0, W, PDF_BANT_YUKSEKLIK, 'F');

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...PDF_RENK.white);
  doc.text('CETPA', 14, 15);

  doc.setFontSize(8);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(...PDF_RENK.brandSoft);
  doc.text(opts.altBaslik ?? 'SATIŞ & LOJİSTİK', 14, 21);

  doc.setFontSize(16);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(...PDF_RENK.white);
  doc.text(opts.belgeAdi, W - 14, 15, { align: 'right' });

  if (opts.meta) {
    doc.setFontSize(8);
    doc.setFont('Roboto', 'normal');
    doc.setTextColor(...PDF_RENK.brandMeta);
    doc.text(opts.meta, W - 14, 26, { align: 'right' });
  }

  return PDF_BANT_YUKSEKLIK + 6;   // gövde bu Y'den başlar
}

/**
 * Alt bilgi — TÜM sayfalara yazar ve gerçek sayfa sayısını kullanır.
 * Eskiden bazı belgeler sabit "Sayfa 1" yazıyordu; çok sayfalı bir teklifte
 * bu yanlış bilgidir.
 */
export function pdfAltBilgi(doc: jsPDF, ekNot?: string): void {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const toplam = doc.getNumberOfPages();
  for (let i = 1; i <= toplam; i++) {
    doc.setPage(i);
    doc.setFont('Roboto', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...PDF_RENK.grey);
    if (ekNot) doc.text(ekNot, 14, H - 6);
    doc.text(`CETPA  •  cetpa.com.tr  •  Sayfa ${i} / ${toplam}`, W - 14, H - 6, { align: 'right' });
  }
}

/** autoTable için ortak stil — başlık satırı marka renginde. */
export function pdfTabloStili(vurgu: RGB = PDF_RENK.brand) {
  return {
    theme: 'grid' as const,
    styles: { font: 'Roboto', fontSize: 8, cellPadding: 3, textColor: PDF_RENK.dark },
    headStyles: { fillColor: vurgu, textColor: PDF_RENK.white, fontStyle: 'bold' as const, fontSize: 8, cellPadding: 3 },
    alternateRowStyles: { fillColor: PDF_RENK.light },
  };
}
