/**
 * sayiMetni.ts — ekran SAYAÇ biçimleyicisi, TEK tanım (mikro-import-arkaplan K-K, 2026-09-24).
 *
 * `jobs/<isAdi>` dokümanındaki sayaçlar (processed/total/created/bozukKayit…) sunucu tarafından YALNIZ
 * bilindiğinde yazılır; koşarken `total` çoğu işte yoktur. Eski panel `?? 0` / `?? '?'` ile boşluğu
 * dolduruyordu — "0/? işlendi" sahte kesinlikti. Kural (CLAUDE.md): bilinmeyen sayı 0 DEĞİL '—'dir.
 *
 * Ad `sayiMetni`: sunucuda 4 ayrı `sayi()` AYRIŞTIRICISI var (unknown → number|null: eslemeStok,
 * govdeSiparis, raporKdvMizan, amortisman); bu dosya BİÇİMLEYİCİDİR (number → string), adı çakışmasın.
 * `utils/para.ts` `bilinenSayi` sayısal STRING'i de kabul eder — burada kabul edilmez: jobs sayaçlarını
 * kendi sunucumuz number yazar, string gelmesi sözleşme ihlalidir ve '—' olarak görünmelidir.
 */

/** Yalnız GERÇEK sonlu sayı; string/boolean/NaN/Infinity → null (0 uydurulmaz). */
export function sonluSayi(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** number → metin; bilinmiyorsa '—'. `sayiMetni(0) === '0'` (gerçek sıfır bilgidir, gizlenmez). */
export function sayiMetni(v: unknown): string {
  const n = sonluSayi(v);
  return n === null ? '—' : String(n);
}
