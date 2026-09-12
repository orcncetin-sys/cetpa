/**
 * ortak.degismez.test.ts — ORTAK sözlükteki ifade satır içinde TEKRAR YAZILAMAZ (Faz 2 4/n, 2026-09-13).
 *
 * Kaynak-tarayan test: `currentLanguage === 'tr' ? 'İptal' : 'Cancel'` gibi, iki dili de sözlükle birebir
 * eşleşen satır içi çift ekran kodunda kalmamalı — `oc(currentLanguage).iptal` kullanılır. Yalnız sözlükte
 * OLAN çiftler denetlenir; tek geçen ifadeler serbesttir. Yorumlar sayılmaz.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { ORTAK } from './ortak';

const KOK = join(__dirname, '..');
const dosyalar: string[] = [];
const tara = (d: string) => {
  for (const ad of readdirSync(d)) {
    const p = join(d, ad);
    if (statSync(p).isDirectory()) { if (!/\/(server|i18n)$/.test(p)) tara(p); }
    else if (/\.(ts|tsx)$/.test(ad) && !/\.test\.tsx?$/.test(ad)) dosyalar.push(p);
  }
};
tara(KOK);
const cift = new Set(Object.keys(ORTAK.tr).map(k => `${ORTAK.tr[k as keyof typeof ORTAK.tr]} ${ORTAK.en[k as keyof typeof ORTAK.en]}`));
const DESEN = /(?:(?:currentLanguage|lang|language)\s*===\s*'tr'|\b(?:tr\d*|isTR|isTr))\s*\?\s*(['"])((?:\\.|(?!\1).)*)\1\s*:\s*(['"])((?:\\.|(?!\3).)*)\3/g;

describe('DEĞİŞMEZ: ortak sözlükteki ifade satır içinde yazılmaz', () => {
  it('tarama gerçekten oldu', () => { expect(dosyalar.length).toBeGreaterThan(100); });
  it('sözlükle birebir eşleşen satır içi çift KALMADI', () => {
    const suclular: string[] = [];
    for (const p of dosyalar) {
      readFileSync(p, 'utf-8').split('\n').forEach((satir, i) => {
        if (/^\s*(\*|\/\*|\/\/)/.test(satir)) return;
        const kod = satir.replace(/\/\/.*$/, '');
        for (const m of kod.matchAll(DESEN)) {
          if (cift.has(`${m[2].replace(/\\'/g, "'")} ${m[4].replace(/\\'/g, "'")}`)) suclular.push(`${p.split('/src/')[1]}:${i + 1} ${m[2]}/${m[4]}`);
        }
      });
    }
    expect(suclular).toEqual([]);
  });
});
