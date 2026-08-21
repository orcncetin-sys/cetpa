/**
 * mikroKolon.ts — Mikro kolon adı eşleştirme (saf fonksiyonlar).
 *
 * BU, PROJENİN EN TEHLİKELİ MANTIĞI. CLAUDE.md'nin en sert kuralı burayı
 * işaret ediyor: "Mikro kolon/tablo adı TAHMİN ETME — bu, projenin en pahalı
 * tekrarlanan hatası." Somut vakalar:
 *
 *   • `cha_vergi` / `cha_ettn` importu ÜÇ KEZ sessizce öldü
 *   • demirbaş kolonlarında beklenen `dbs_` öneki gerçekte `dem_` çıktı
 *   • `sfiyat_fiyati|fiyat` gevşek deseni `sfiyat_Guid` kolonunu eşleştirdi ve
 *     TÜM FİYATLARI SESSİZCE SIFIRLADI
 *
 * Buna rağmen bu iki fonksiyonun HİÇ TESTİ YOKTU ve server.ts'in içinde,
 * 9.088 satırlık `startServer()` fonksiyonunun ortasında duruyorlardı —
 * yani ne görünür ne de doğrulanabilirlerdi (2026-08-21 ölçümü).
 *
 * Buraya taşındılar ve davranışları testle kilitlendi. Davranış AYNEN
 * korundu; bu bir refactor, düzeltme değil.
 */

/** Satırın anahtarları içinde desene uyan İLK kolonu döndürür. */
export function findKey(row: Record<string, unknown>, re: RegExp): string | null {
  for (const k of Object.keys(row)) if (re.test(k)) return k;
  return null;
}

/**
 * Kolon seç: desenleri SIRAYLA dener, ilk eşleşeni döndürür. En SPESİFİK
 * desen başa yazılır.
 *
 * `_Guid` kolonları VARSAYILAN OLARAK DIŞLANIR — bu, yukarıdaki "tüm fiyatlar
 * sıfırlandı" vakasının doğrudan çözümü: `fiyat` gibi gevşek bir desen
 * `sfiyat_Guid` ile eşleşip değer kolonu sanılıyordu. GUID'in kendisi
 * aranıyorsa `guidDahil = true` verilir.
 */
export function kolonSec(cols: string[], desenler: RegExp[], guidDahil = false): string | null {
  const aday = guidDahil ? cols : cols.filter(c => !/_guid$/i.test(c));
  for (const re of desenler) {
    const k = aday.find(c => re.test(c));
    if (k) return k;
  }
  return null;
}
