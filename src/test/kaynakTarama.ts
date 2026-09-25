// kaynakTarama.ts — değişmez testlerinin DOSYA OKUYAN yardımcıları (2026-09-25, mikro-import-arkaplan).
//
// Neden var: aynı satır tarayıcısı 6 değişmez testinde satır içi kopyalanmıştı (tekKaynak, zaman,
// currency, pdfTheme, pano/baglanti, rapor6a); `mikroImportArkaplan.degismez.test.ts` 7. kopyayı
// yazmıştı (hakem 2026-09-25, bulgu 6 — degismez.md "YAZDIĞIN DOSYALAR" bu dosyayı istiyordu).
// Sonraki değişmez testini yazan paylaşılan yardımcıyı burada bulur, 8. kopyayı yazmaz.
//
// Tüketici BUGÜN tek: `src/server/routes/mikroImportArkaplan.degismez.test.ts`. Öteki 6 testin buraya
// taşınması AYRI commit (K-H) — gövdeleri birebir değil (tekKaynak/zaman/currency/pdfTheme satırı
// yalnız başındaki `*`/`/*`/`//` ile yorum sayar: `*`'sız blok-yorum satırını KOD sayar, `https://`
// sonrasını keser), yani taşıma o testlerin bulduğu siteleri değiştirebilir; ayrı ölçüm ister.
//
// Sınır: YALNIZ dosya okur/listeler; desen bilgisi TAŞIMAZ. Yorum süzgeci burada TANIMLANMAZ —
// `yorumsuz` `./degismezTarayici`'ten içe aktarılır (6b'nin dosyası; üçüncü kopya YASAK — kapı:3, K-L).
// Uygulama kodu bu dosyayı import ETMEZ; vitest yalnız `.test`/`.spec` topladığı için test sayılmaz.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { yorumsuz } from './degismezTarayici';

/** `src/` kökü (bu dosya `src/test/`'te). */
export const SRC_KOK = join(__dirname, '..');

/** `src/…` biçiminde göreli yol — hata mesajındaki siteyi hakem doğrudan açar. src DIŞINDAKİ dosya (kök
 *  `server.ts`) depo köküne göre yazılır: `src/../server.ts` değil `server.ts`. */
export const gorece = (yol: string): string => {
  const r = relative(SRC_KOK, yol);
  return r.startsWith('..') ? relative(join(SRC_KOK, '..'), yol) : `src/${r}`;
};

export const oku = (yol: string): string => readFileSync(yol, 'utf-8');

/** Üretim kaynakları: `.ts`/`.tsx`; test, spec ve test düzeneği (`*.testDuzenegi.ts`) HARİÇ. */
export function kaynakDosyalari(dizin: string): string[] {
  return readdirSync(dizin).flatMap(ad => {
    const yol = join(dizin, ad);
    if (statSync(yol).isDirectory()) return kaynakDosyalari(yol);
    if (!/\.tsx?$/.test(ad) || /\.(test|spec|testDuzenegi)\.tsx?$/.test(ad)) return [];
    return [yol];
  });
}

export interface KodSatiri { n: number; kod: string }

/** Yorumsuz kod satırları; 1 tabanlı satır numarası KORUNUR (blok yorum boş satıra iner). */
export const kodSatirlari = (yol: string): KodSatiri[] => yorumsuz(oku(yol)).map((kod, i) => ({ n: i + 1, kod }));

export interface Suclu { site: string; kod: string }

/** Desene uyan kod satırları `src/…:satır` + kod — sayıya indirgenmez, hakem kaçırılan siteyi görür. */
export function suclular(dosyalar: string[], desen: RegExp): Suclu[] {
  const out: Suclu[] = [];
  for (const yol of dosyalar) {
    for (const { n, kod } of kodSatirlari(yol)) if (desen.test(kod)) out.push({ site: `${gorece(yol)}:${n}`, kod });
  }
  return out;
}
