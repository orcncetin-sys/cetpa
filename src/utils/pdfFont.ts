import type { jsPDF } from 'jspdf';
import { pdfLogoHazirla } from './pdfTheme';

/**
 * jsPDF'nin gömülü Helvetica/Times/Courier fontları WinAnsi kodlamasında —
 * ş/Ş/ğ/Ğ/ı/İ (Latin Extended-A) glif İÇERMİYOR, bu yüzden Türkçe metinler ya
 * boş kutu/mojibake ya da (bu dosyanın eski `normTR()` çözümünde olduğu gibi)
 * harf düşürülerek ("MÜŞTERİ" → "MUSTERI") çıkıyordu (2026-08-17 bildirimi).
 * Roboto (Apache-2.0, roboto-base64 paketiyle) Türkçe glifleri kapsıyor —
 * her yeni jsPDF() örneğinde bir kez çağrılmalı (font kayıtları örnek-bazlı).
 *
 * DİNAMİK IMPORT ŞART: roboto-base64 fontları base64 string olarak taşıyor ve
 * TEK BAŞINA 918 kB. Statik import edildiğinde ortak `vendor` chunk'ına girip
 * PDF hiç üretilmese bile HER kullanıcıya ilk açılışta iniyordu — 2026-08-17'de
 * "sistem çok yavaş açılıyor" şikayetinin kök nedeni buydu (aynı gün Türkçe
 * PDF düzeltmesiyle girmişti). Artık yalnız gerçekten PDF üretilirken iner.
 */
export async function registerTurkishFont(doc: jsPDF): Promise<void> {
  try {
    const { default: roboto } = await import('roboto-base64');
    doc.addFileToVFS('Roboto-Regular.ttf', roboto.normal);
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    doc.addFileToVFS('Roboto-Bold.ttf', roboto.bold);
    doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
    doc.setFont('Roboto', 'normal');
  } catch (err) {
    fontHatasi(doc, err);
  }
  // Marka logosu (başlık bandı — pdfTheme.pdfBaslik). Tüm belge üreticileri bu fonksiyonu await ettiği için logo
  // hazırlığının TEK kapısı burası (2026-09-25 "fiş te logo hatalı"). Hata fırlatmaz: logo yoksa bant yazıyla basılır.
  await pdfLogoHazirla();
}

/** Font chunk'ı inemezse (ağ hatası, ya da deploy sonrası açık sekmede eski hash'li dosyanın 404'lemesi) ESKİDEN
 *  buradan fırlayan hata her PDF düğmesini sessizce ölü tıklamaya çeviriyordu (code-review bulgusu). Artık
 *  Helvetica'ya düşüyoruz: PDF yine üretilir, yalnız ş/ğ/ı/İ glifleri bozuk çıkar — hiç PDF vermemekten iyidir,
 *  ve sebep konsola yazılır. */
function fontHatasi(doc: jsPDF, err: unknown): void {
  console.warn('[pdfFont] Roboto yüklenemedi, Helvetica ile devam ediliyor (Türkçe karakterler bozuk çıkabilir):', err);
  doc.setFont('helvetica', 'normal');
}
