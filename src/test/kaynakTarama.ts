// kaynakTarama.ts — değişmez testlerinin DOSYA OKUYAN yardımcıları (2026-09-25, mikro-import-arkaplan).
//
// Neden var: aynı satır tarayıcısı değişmez testlerinde satır içi kopyalanmıştı; sonraki değişmez testini
// yazan paylaşılan yardımcıyı burada bulur, yeni kopya yazmaz.
//
// 2026-10-08: satır önekiyle yorum sayan 12 yerel tarayıcı (tekKaynak, zaman, currency, pdfTheme, pano/baglanti,
// modulSozluk, ortak, isimAnahtari, onayDegismez, pdf.test, zamanla, trackingRoutes.test) buradaki `kodSatirlari`'na
// bağlandı. Eski yerel süzgeçler dize / şablon / düzenli ifade içindeki çift eğik çizgiden sonraki KODU kesiyor
// (o gün 94 kod satırı görünmüyordu), ters yönde blok yorumun yıldızsız satırlarını kod sayıyordu.
//
// Sınır: YALNIZ dosya okur / listeler; desen bilgisi TAŞIMAZ. Yorum süzgeci burada TANIMLANMAZ —
// `yorumsuz` `./degismezTarayici`'ten içe aktarılır (TEK kaynak; yeni kopya YASAK). `kodSatirlari(yol)` dosya
// adını süzgece kendisi geçirir (ad ayrıştırma türünü seçer) ve KATI girişi kullanır: ayrıştırılamayan dosya fırlatır.
// Uygulama kodu bu dosyayı import ETMEZ; vitest yalnız `.test` / `.spec` topladığı için test sayılmaz.
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
export const kodSatirlari = (yol: string): KodSatiri[] => yorumsuz(yol, oku(yol)).map((kod, i) => ({ n: i + 1, kod }));

export interface Suclu { site: string; kod: string }

/** Desene uyan kod satırları `src/…:satır` + kod — sayıya indirgenmez, hakem kaçırılan siteyi görür. */
export function suclular(dosyalar: string[], desen: RegExp): Suclu[] {
  const out: Suclu[] = [];
  for (const yol of dosyalar) {
    for (const { n, kod } of kodSatirlari(yol)) if (desen.test(kod)) out.push({ site: `${gorece(yol)}:${n}`, kod });
  }
  return out;
}
