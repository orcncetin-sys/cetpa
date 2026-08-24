/**
 * trParse.ts — Türkçe biçimli sayı/tarih/CSV ayrıştırma. TEK KAYNAK.
 *
 * NEDEN AYRI DOSYA (2026-08-22 denetim bulgusu C1): `parseTRNumber` ve
 * `parseTRDate` yalnız `BankStatementImportModal.tsx` içinde, dışa
 * aktarılmadan duruyordu. Aynı işi yapması gereken ikinci bir yol —
 * AccountingModule'ün banka CSV import'u — düz `parseFloat` kullanıyordu:
 *
 *   parseFloat('1.234,56') === 1.234   // 1000× KÜÇÜK
 *   parseFloat('5.000')    === 5       // 1000× KÜÇÜK
 *
 * Yani bir ekstre satırı 12.500,00 ₺ ise muhasebe fişine 12,5 ₺ yazılıyordu.
 * Para ayrıştırması iki yerde iki farklı şekilde yapıldığı sürece bu hata
 * geri gelir; bu yüzden ayrıştırıcı buraya taşındı ve iki çağıran da bunu
 * kullanıyor.
 */

/** "1.234,56" → 1234.56 (Türk biçimi). "5.000" → 5000 (binlik), "5,75" → 5.75. */
export function parseTRNumber(raw: string): number {
  if (!raw) return 0;
  let s = String(raw).trim().replace(/[^\d.,-]/g, '');
  if (s.includes('.') && s.includes(',')) {
    // Hem . hem , varsa: son gelen ayraç ondalıktır (Türk: 1.234,56 / EN: 1,234.56).
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.'); // sadece virgül → ondalık
  } else if (s.includes('.')) {
    // Sadece nokta: birden fazla nokta VEYA son gruptan sonra tam 3 hane ise
    // binlik ayracı (Türk: 5.000 / 1.234.567), aksi halde ondalık (5.75 / 12.5).
    const afterDot = s.slice(s.lastIndexOf('.') + 1);
    const dotCount = (s.match(/\./g) || []).length;
    if (dotCount > 1 || afterDot.length === 3) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** "DD.MM.YYYY" / "DD/MM/YYYY" / "YYYY-MM-DD" → "YYYY-MM-DD". */
export function parseTRDate(raw: string): string {
  const s = String(raw || '').trim();
  const dm = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (dm) {
    const d = dm[1].padStart(2, '0'); const m = dm[2].padStart(2, '0');
    let y = dm[3]; if (y.length === 2) y = '20' + y;
    return `${y}-${m}-${d}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return s;
}

// NOT: CSV SATIR BÖLME BURADA YOK — bilinçli.
// Alıntı-farkında bölme için projede zaten `papaparse` var
// (BankStatementImportModal onu kullanıyor). Elle yazılmış ikinci bir bölücü,
// köşe durumlarında (kaçırılmış alıntı, gömülü satır sonu, BOM, ayraç sezimi)
// Papa'nın yıllardır çözdüğü işi yeniden çözmek zorunda kalır. AccountingModule'ün
// banka CSV import'u da bu yüzden Papa'ya bağlandı (2026-08-22, C1 ile aynı blok).
