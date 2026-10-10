// @vitest-environment node
/**
 * magazaTalepAramasi.test.ts — ERP arama kutusunun saf süzgeci (V23, § 5.2 / § 7).
 * Türkçe küçültme `tr-TR` iledir: `toLowerCase` ile «ŞİRİN YAPI» «i» + birleşik nokta (U+0307) ve «yapi» olur, hiçbir aramayla eşleşmezdi (çit).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kodSatirlari, SRC_KOK } from '../test/kaynakTarama';
import { magazaTalepAramasi } from './magazaTalepAramasi';

const satir = (talepNo: string, telefonSon10: string, ad: string, firma = '', ek: Record<string, string> = {}) =>
  ({ talepNo, telefonSon10, musteri: { ad, firma, eposta: 'gizli@example.com', il: 'Antalya' }, not: 'kalem notu', ...ek });

const A = satir('T261008-CZZF', '5321111234', 'ŞİRİN YAPI', 'Şirin İnşaat Ltd');
const B = satir('T261009-ABCD', '5329991234', 'Işık Boya', 'ISIK TİCARET');
const C = satir('T261009-ZZF1', '5551234567', 'Mehmet Yılmaz', '');
const LISTE = [A, B, C];
const nolar = (l: typeof LISTE) => l.map(t => t.talepNo);

describe('magazaTalepAramasi', () => {
  it('boş / yalnız boşluk metin → girdi AYNEN (aynı dizi)', () => {
    expect(magazaTalepAramasi(LISTE, '')).toBe(LISTE);
    expect(magazaTalepAramasi(LISTE, '   ')).toBe(LISTE);
  });
  it('talep no: tam, sonek, küçük harf — `CZZF`, `czzf`, `8-CZZF`, `T261008-CZZF`; `ZZF` iki satırı (sonek), `T2610` hiçbirini (önek)', () => {
    for (const m of ['CZZF', 'czzf', '8-CZZF', 'T261008-CZZF', ' CZZF ']) expect(nolar(magazaTalepAramasi(LISTE, m)), m).toEqual(['T261008-CZZF']);
    expect(nolar(magazaTalepAramasi(LISTE, 'ZZF'))).toEqual(['T261008-CZZF']);
    expect(nolar(magazaTalepAramasi(LISTE, 'ZZF1'))).toEqual(['T261009-ZZF1']);
    expect(nolar(magazaTalepAramasi(LISTE, 'T2610'))).toEqual([]);
  });
  it('yalnız rakam: `telefonSon10` metinle BİTER (son 4 hane; 10 haneye kadar); rakam + harf karışık telefonla eşleşmez', () => {
    expect(nolar(magazaTalepAramasi(LISTE, '1234'))).toEqual(['T261008-CZZF', 'T261009-ABCD']);
    expect(nolar(magazaTalepAramasi(LISTE, '91234'))).toEqual(['T261009-ABCD']);
    expect(nolar(magazaTalepAramasi(LISTE, '5551234567'))).toEqual(['T261009-ZZF1']);
    expect(nolar(magazaTalepAramasi(LISTE, '05551234567'))).toEqual([]);
    expect(nolar(magazaTalepAramasi(LISTE, '1234a'))).toEqual([]);
  });
  it('müşteri adı / firma: `tr-TR` küçültme — `şirin` «ŞİRİN YAPI» ile EŞLEŞİR; `IŞIK` ↔ «Işık», `ISIK` ↔ «ISIK TİCARET» eşleşir; `isik` ↔ «Işık» eşleşmez', () => {
    expect(nolar(magazaTalepAramasi(LISTE, 'şirin'))).toEqual(['T261008-CZZF']);
    expect(nolar(magazaTalepAramasi(LISTE, 'ŞİRİN'))).toEqual(['T261008-CZZF']);
    expect(nolar(magazaTalepAramasi(LISTE, 'IŞIK'))).toEqual(['T261009-ABCD']);
    expect(nolar(magazaTalepAramasi(LISTE, 'ISIK'))).toEqual(['T261009-ABCD']);   // firma «ISIK TİCARET» (I → ı)
    expect(nolar(magazaTalepAramasi(LISTE, 'isik'))).toEqual([]);                 // i → i; «ışık» / «ısık» ile eşleşmez
    expect(nolar(magazaTalepAramasi(LISTE, 'yılmaz'))).toEqual(['T261009-ZZF1']);
    expect(nolar(magazaTalepAramasi(LISTE, 'inşaat'))).toEqual(['T261008-CZZF']); // firma
  });
  it('e-posta / il / not / kalem adı aranmaz; sıra korunur; iki ölçütten eşleşen satır bir kez döner', () => {
    for (const m of ['gizli', 'example', 'Antalya', 'kalem notu']) expect(nolar(magazaTalepAramasi(LISTE, m)), m).toEqual([]);
    expect(nolar(magazaTalepAramasi([C, B, A], 'T2610'))).toEqual([]);
    expect(nolar(magazaTalepAramasi([C, B, A], '1234'))).toEqual(['T261009-ABCD', 'T261008-CZZF']);
    const ikiOlcut = satir('T261010-1234', '5551231234', 'Ali 1234');
    expect(nolar(magazaTalepAramasi([ikiOlcut, A], '1234'))).toEqual(['T261010-1234', 'T261008-CZZF']);
  });
  it('kaynak çiti: `toLowerCase(` / `toLocaleLowerCase()` (dilsiz) YOK; `toUpperCase` yalnız talep no satırında', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'lib', 'magazaTalepAramasi.ts')).map(s => s.kod);
    expect(kod.join('\n')).not.toMatch(/\.toLowerCase\(|toLocaleLowerCase\(\)|toLocaleUpperCase/);
    expect(kod.filter(s => s.includes('toUpperCase'))).toHaveLength(2);
    // ekran metni üretmez: dizge sabiti yok
    expect(readFileSync(join(SRC_KOK, 'lib', 'magazaTalepAramasi.ts'), 'utf8')).not.toMatch(/from '\.\.\/hooks|from '\.\.\/components/);
  });
});
