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
 *
 * FAZ 2 3/n (2026-09-12): "tek kaynak" iddiası ölçüldü — pdf.ts'in 4 üreticisi,
 * QuotationDetail, AccountingModule ve OrdersPage fişi HÂLÂ kendi bandını yazıyordu
 * (6 dosyada renk sabiti kopyası, 21 elle rect). Buraya `renk` (şablon rengi),
 * bant modlu `pdfAltBilgi` ve `pdfBilgiKutusu` eklendi; belgeSablonu'nun RGB tipi
 * buradan türer. Sözleşme: pdfTheme.test.ts; kaynak-tarayan değişmez: pdfTheme.degismez.test.ts.
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
  /** Olumlu/tamamlanmış durumlar (ör. mal kabul). Tailwind green-600 — mal kabul belgesinin 2026-09-12 öncesi rengi (görünüm korundu). */
  green: [22, 163, 74] as RGB,
} as const;

export const PDF_BANT_YUKSEKLIK = 32;

const ayniRenk = (a: RGB, b: RGB): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
/** Bant üstündeki ikincil yazı tonu: marka bandında sabit şeftali tonları; başka renkte (lacivert ekstre,
 *  yeşil mal kabul) BEYAZLA KARIŞTIRILMIŞ aynı renk — turuncu tonlu yazı lacivert zemine binmesin (3/n hakemi). */
export function ikincilTon(renk: RGB, oran: 0.75 | 0.85): RGB {
  if (ayniRenk(renk, PDF_RENK.brand)) return oran === 0.75 ? PDF_RENK.brandSoft : PDF_RENK.brandMeta;
  return [Math.round(renk[0] + (255 - renk[0]) * oran), Math.round(renk[1] + (255 - renk[1]) * oran), Math.round(renk[2] + (255 - renk[2]) * oran)] as RGB;
}

export interface PdfBaslikOpts {
  /** Sağ üstteki belge adı, ör. 'TEKLİF' / 'SİPARİŞ / FATURA'. */
  belgeAdi: string;
  /** Sağ altta küçük satır, ör. 'No: 123 | Tarih: 01.01.2026'. */
  meta?: string;
  /** Sol üstteki alt başlık. Varsayılan kurumsal alt başlık. */
  altBaslik?: string;
  /** Bant rengi — Belge Tasarımcısı şablonu (`sablonRengi`) ya da belge türü rengi (mal kabul yeşil). Varsayılan marka. */
  renk?: RGB;
}

/**
 * Marka başlık bandını çizer ve gövdenin başlayabileceği Y konumunu döndürür.
 * Font olarak Roboto bekler — çağıran taraf `registerTurkishFont(doc)`
 * çağırmış olmalı (jsPDF'in gömülü fontları ş/ğ/ı/İ taşımıyor).
 */
export function pdfBaslik(doc: jsPDF, opts: PdfBaslikOpts): number {
  const W = doc.internal.pageSize.getWidth();

  const renk = opts.renk ?? PDF_RENK.brand;
  doc.setFillColor(...renk);
  doc.rect(0, 0, W, PDF_BANT_YUKSEKLIK, 'F');

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...PDF_RENK.white);
  doc.text('CETPA', 14, 15);

  doc.setFontSize(8);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(...ikincilTon(renk, 0.75));
  doc.text(opts.altBaslik ?? 'SATIŞ & LOJİSTİK', 14, 21);

  doc.setFontSize(16);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(...PDF_RENK.white);
  doc.text(opts.belgeAdi, W - 14, 15, { align: 'right' });

  if (opts.meta) {
    doc.setFontSize(8);
    doc.setFont('Roboto', 'normal');
    doc.setTextColor(...ikincilTon(renk, 0.85));
    doc.text(opts.meta, W - 14, 26, { align: 'right' });
  }

  return PDF_BANT_YUKSEKLIK + 6;   // gövde bu Y'den başlar
}

/**
 * Alt bilgi — TÜM sayfalara yazar ve gerçek sayfa sayısını kullanır.
 * Eskiden bazı belgeler sabit "Sayfa 1" yazıyordu; çok sayfalı bir teklifte
 * bu yanlış bilgidir.
 */
export interface PdfAltBilgiOpts {
  /** Düz modda sol alttaki not (ör. 'Kaynak: Mikro'). */
  ekNot?: string;
  /** Verilirse MÜŞTERİYE GİDEN belge modu: her sayfanın altına 14 mm renkli bant (şablon/belge rengi). */
  bant?: RGB;
  /** Bant modunda soldaki metin (şablon footer'ı). Tek satıra kırpılır — sağdaki sayfa etiketiyle çakışmasın. */
  solMetin?: string;
}
export const PDF_ALT_BANT_YUKSEKLIK = 14;

export function pdfAltBilgi(doc: jsPDF, secenek?: string | PdfAltBilgiOpts): void {
  const o: PdfAltBilgiOpts = typeof secenek === 'string' ? { ekNot: secenek } : (secenek ?? {});
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const toplam = doc.getNumberOfPages();
  // Bant modunda sol metin TEK satır: eskiden pdf.ts/QuotationDetail ikisi de bunu kendi yazıyordu.
  const sol = o.bant && o.solMetin ? ((doc.splitTextToSize(o.solMetin, W - 90) as string[])[0] ?? '') : '';
  for (let i = 1; i <= toplam; i++) {
    doc.setPage(i);
    if (o.bant) {
      doc.setFillColor(...o.bant);
      doc.rect(0, H - PDF_ALT_BANT_YUKSEKLIK, W, PDF_ALT_BANT_YUKSEKLIK, 'F');
      doc.setFont('Roboto', 'normal');
      doc.setFontSize(7.5);
      if (sol) { doc.setTextColor(...ikincilTon(o.bant, 0.85)); doc.text(sol, 14, H - 6); }
      doc.setTextColor(...PDF_RENK.white);
    } else {
      doc.setFont('Roboto', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...PDF_RENK.grey);
      if (o.ekNot) doc.text(o.ekNot, 14, H - 6);
    }
    doc.text(`CETPA  •  cetpa.com.tr  •  Sayfa ${i} / ${toplam}`, W - 14, H - 6, { align: 'right' });
  }
}

export interface PdfBilgiSatiri {
  metin: string;
  /** Kutu üstünden mm (ör. 13, 20, 26). */
  dy: number;
  boyut: number;
  renk?: RGB;
  maxWidth?: number;
}
export interface PdfBilgiKutusuOpts {
  x: number; y: number; w: number; h: number;
  /** Küçük renkli başlık: 'MÜŞTERİ BİLGİLERİ', 'SATICI BİLGİLERİ', 'SİPARİŞ DETAYI'… */
  baslik: string;
  /** Başlık rengi (şablon/belge rengi). Varsayılan marka. */
  renk?: RGB;
  satirlar: PdfBilgiSatiri[];
}

/** Açık zeminli yuvarlak köşeli bilgi kutusu — müşteri/satıcı/belge detayı. pdf.ts ×6 ve QuotationDetail ×2 aynı kutuyu elle çiziyordu. */
export function pdfBilgiKutusu(doc: jsPDF, o: PdfBilgiKutusuOpts): void {
  doc.setFillColor(...PDF_RENK.light);
  doc.roundedRect(o.x, o.y, o.w, o.h, 2, 2, 'F');
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...(o.renk ?? PDF_RENK.brand));
  doc.text(o.baslik, o.x + 4, o.y + 6);
  doc.setFont('Roboto', 'normal');
  for (const s of o.satirlar) {
    doc.setFontSize(s.boyut);
    doc.setTextColor(...(s.renk ?? PDF_RENK.dark));
    if (s.maxWidth) doc.text(s.metin, o.x + 4, o.y + s.dy, { maxWidth: s.maxWidth }); else doc.text(s.metin, o.x + 4, o.y + s.dy);
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
