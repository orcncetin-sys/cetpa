/**
 * modulSozluk.degismez.test.ts — MODÜL sözlüğündeki ifade o modülde satır içinde TEKRAR YAZILAMAZ (Faz 3, 2026-09-14).
 *
 * ortak.degismez.test.ts ORTAK sözlüğü tüm kaynakta denetler; bu test her ÜRETİLMİŞ modül sözlüğünü
 * (src/i18n/<modul>.ts, başlığında "— <dosya> modülünün") yalnız KENDİ dosyasında denetler: kodmod
 * (scripts/modul-sozluk-kodmod.py) tekrar koşulduğunda 0 değişiklik vermeli. Yorum satırları sayılmaz —
 * kodmod da onlara dokunmaz. Yeni bir modül kapatıldığında (AccountingModule, OrdersPage…) buraya
 * ekleme gerekmez: sözlük dosyası başlığından kendini tanıtır.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const I18N = __dirname;
const KOK = join(__dirname, '..', '..');
const DESEN = /(?:(?:currentLanguage|lang|language)\s*===\s*'tr'|\b(?:tr\d*|isTR|isTr))\s*\?\s*(['"])((?:\\.|(?!\1).)*)\1\s*:\s*(['"])((?:\\.|(?!\3).)*)\3/g;
const ac = (v: string) => v.replace(/\\'/g, "'").replace(/\\\\/g, '\\');

interface Modul { sozluk: string; dosya: string; cift: Set<string> }
const moduller: Modul[] = readdirSync(I18N)
  .filter(ad => /^[a-z][a-zA-Z0-9]*\.ts$/.test(ad) && ad !== 'ortak.ts')
  .flatMap(ad => {
    const icerik = readFileSync(join(I18N, ad), 'utf-8');
    // Kapsam: başlıktaki ` * Kapsam: a.tsx, b.tsx` satırı (kodmod her koştuğu dosyayı ekler); yoksa `— <dosya> modülünün`.
    if (!/scripts\/modul-sozluk-kodmod\.py/.test(icerik)) return [];
    const kapsam = icerik.match(/^ \* Kapsam: (.*)$/m)?.[1].split(',').map(x => x.trim()).filter(Boolean)
      ?? [icerik.match(/— (\S+) modülünün/)?.[1]].filter((x): x is string => !!x);
    if (!kapsam.length) return [];
    const blok = (etiket: 'tr' | 'en') => icerik.match(new RegExp(`^  ${etiket}: \\{\\n([\\s\\S]*?)\\n  \\},`, 'm'))?.[1] ?? '';
    const oku = (b: string): Record<string, string> => Object.fromEntries([...b.matchAll(/^\s*([A-Za-z0-9_]+): '((?:\\.|[^'\\])*)',$/gm)].map(m => [m[1], ac(m[2])]));
    const tr = oku(blok('tr')), en = oku(blok('en'));
    const cift = new Set(Object.keys(tr).filter(k => k in en).map(k => `${tr[k]}\u0000${en[k]}`));
    return kapsam.map(dosya => ({ sozluk: ad, dosya, cift }));
  });

describe('DEĞİŞMEZ: modül sözlüğündeki ifade modülde satır içinde yazılmaz', () => {
  it('üretilmiş modül sözlükleri bulundu, dosyaları mevcut (Faz 3 1/n: muhasebe → MuhasebePage)', () => {
    expect(moduller.map(m => m.sozluk)).toContain('muhasebe.ts');
    for (const m of moduller) {
      expect(existsSync(join(KOK, m.dosya)), `${m.sozluk} → ${m.dosya}`).toBe(true);
      expect(m.cift.size, m.sozluk).toBeGreaterThan(0);
    }
  });
  it('sözlükle birebir eşleşen satır içi çift KALMADI (yorumlar hariç)', () => {
    const suclular: string[] = [];
    for (const m of moduller) {
      readFileSync(join(KOK, m.dosya), 'utf-8').split('\n').forEach((satir, i) => {
        if (/^\s*(\*|\/\*|\/\/)/.test(satir)) return;
        const kod = satir.replace(/\/\/.*$/, '');
        for (const e of kod.matchAll(DESEN)) {
          if (m.cift.has(`${ac(e[2])}\u0000${ac(e[4])}`)) suclular.push(`${m.dosya}:${i + 1} ${e[2]}/${e[4]}`);
        }
      });
    }
    expect(suclular).toEqual([]);
  });
});
