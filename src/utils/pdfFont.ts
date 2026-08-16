import type { jsPDF } from 'jspdf';
import roboto from 'roboto-base64';

/**
 * jsPDF'nin gömülü Helvetica/Times/Courier fontları WinAnsi kodlamasında —
 * ş/Ş/ğ/Ğ/ı/İ (Latin Extended-A) glif İÇERMİYOR, bu yüzden Türkçe metinler ya
 * boş kutu/mojibake ya da (bu dosyanın eski `normTR()` çözümünde olduğu gibi)
 * harf düşürülerek ("MÜŞTERİ" → "MUSTERI") çıkıyordu (2026-08-17 bildirimi).
 * Roboto (Apache-2.0, roboto-base64 paketiyle) Türkçe glifleri kapsıyor —
 * her yeni jsPDF() örneğinde bir kez çağrılmalı (font kayıtları örnek-bazlı).
 */
export function registerTurkishFont(doc: jsPDF): void {
  doc.addFileToVFS('Roboto-Regular.ttf', roboto.normal);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.addFileToVFS('Roboto-Bold.ttf', roboto.bold);
  doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
  doc.setFont('Roboto', 'normal');
}
