/**
 * mikroClient.test.ts — Mikro zarf ayrıştırma + SQL kapısı girdi doğrulama (Faz 1 4/n, 2026-09-05).
 *
 * Faz 0: `src/server/` altında Mikro istemcisinin saf yardımcıları TESTSİZDİ; oysa
 * `mikroSatirlar` bir kez yanlış yazıldığında (dizi sarmalına inmiyordu) mizan/KDV/7 liste
 * import'u aylarca SESSİZCE 0 kayıt vermişti (2026-07-30, yorum dosyada). Bu dosya:
 *  - zarfın üç gözlenen şeklini (nesne / DİZİ / liste) kilitler,
 *  - miktar ve fiyatta "0 ya da boş = BİLİNMİYOR, yazma" sözleşmesini kilitler
 *    (Mikro tanımsız kademeyi 0 döndürür; 0 yazmak elle girilen fiyatı ezer),
 *  - SqlVeriOkuV2 kapısında string birleştirilen değerlerin KATI doğrulandığını kilitler (SQLi).
 */
import { describe, it, expect } from 'vitest';
import {
  mikroStokMiktari, mikroSatisFiyatlari, mikroData, mikroSatirlar, mikroHata,
  sqlTarih, sqlTamsayi, sqlTanimlayici,
} from './mikroClient';

describe('mikroStokMiktari — kart miktarı: yoksa null, 0 gerçek sıfır', () => {
  it("sto_mevcut_mik sayısal string kabul; yoksa toplam_miktar'a düşer", () => {
    expect(mikroStokMiktari({ sto_mevcut_mik: '12.5' })).toBe(12.5);
    expect(mikroStokMiktari({ toplam_miktar: 3 })).toBe(3);
    expect(mikroStokMiktari({ sto_mevcut_mik: 0 })).toBe(0);
  });
  it("alan yok / '' / 'abc' → null (0 DEĞİL — mevcut stockLevel ezilmez)", () => {
    expect(mikroStokMiktari({})).toBeNull();
    expect(mikroStokMiktari({ sto_mevcut_mik: '' })).toBeNull();
    expect(mikroStokMiktari({ sto_mevcut_mik: 'abc' })).toBeNull();
    expect(mikroStokMiktari({ sto_mevcut_mik: null })).toBeNull();
  });
});

describe('mikroSatisFiyatlari — kademeler; 0/boş fiyat DÖNMEZ', () => {
  it('satis_fiyatlari[] listesi önce, sonra kart alanları; ilk geçerli kaynak kazanır', () => {
    const p = mikroSatisFiyatlari({
      satis_fiyatlari: [{ sfiyat_fiyati: 100 }, { sfiyat_fiyati: 0 }, {}, { sfiyat_fiyati: '80' }],
      sto_satis_fiyat1: 999, sto_satis_fiyat2: 90,
    });
    expect(p).toEqual({ Retail: 100, 'B2B Standard': 90, Dealer: 80 });   // B2B Premium hiçbir kaynakta yok → anahtar YOK
  });
  it('hiç fiyat yoksa boş nesne (çağıran prices alanına DOKUNMAZ)', () => {
    expect(mikroSatisFiyatlari({})).toEqual({});
    expect(mikroSatisFiyatlari({ sto_satis_fiyat1: 0, sto_satis_fiyat2: '', sto_satis_fiyat3: 'x' })).toEqual({});
  });
});

describe('mikroData / mikroSatirlar — yanıt zarfının üç şekli', () => {
  it('mikroData: result[0].Data (ya da .data); zarf yoksa {}', () => {
    expect(mikroData({ result: [{ Data: { StokListesi: [1] } }] })).toEqual({ StokListesi: [1] });
    expect(mikroData({ result: [{ data: { x: 1 } }] })).toEqual({ x: 1 });
    expect(mikroData(null)).toEqual({});
    expect(mikroData('Api Server Error')).toEqual({});
  });
  it('nesne sarmalı: Data = { SQLResult1: [...] }', () => {
    expect(mikroSatirlar({ result: [{ Data: { SQLResult1: [{ a: 1 }] } }] })).toEqual([{ a: 1 }]);
  });
  it('DİZİ sarmalı (SqlVeriOkuV2): Data = [ { SQLResult1: [...] } ] — eski kod burada hep [] dönüyordu', () => {
    expect(mikroSatirlar({ result: [{ Data: [{ SQLResult1: [{ cha_kod: 'C1' }] }] }] })).toEqual([{ cha_kod: 'C1' }]);
  });
  it('liste metodu: Data = { StokListesi: [...] }; boş/hatalı zarf → []', () => {
    expect(mikroSatirlar({ result: [{ Data: { StokListesi: [{ sto_kod: 'S1' }] } }] })).toEqual([{ sto_kod: 'S1' }]);
    expect(mikroSatirlar({ result: [{ Data: {} }] })).toEqual([]);
    expect(mikroSatirlar(undefined)).toEqual([]);
  });
  it('mikroHata: ErrorMessage > ham string (200 kr) > fallback', () => {
    expect(mikroHata({ result: [{ ErrorMessage: 'Metot V17\'de yok' }] })).toBe('Metot V17\'de yok');
    expect(mikroHata('x'.repeat(300))).toHaveLength(200);
    expect(mikroHata({ result: [{}] })).toBe('Mikro API yanıt vermedi.');
    expect(mikroHata(null, 'özel')).toBe('özel');
  });
});

describe('SqlVeriOkuV2 kapısı — string literal’e giren her değer KATI doğrulanır (SQLi)', () => {
  it("sqlTarih: yalnız YYYY-MM-DD; enjeksiyon denemesi varsayılana düşer", () => {
    expect(sqlTarih('2026-09-05', '2000-01-01')).toBe('2026-09-05');
    expect(sqlTarih(" 2026-09-05 ", '2000-01-01')).toBe('2026-09-05');
    expect(sqlTarih("2026-09-05' OR 1=1 --", '2000-01-01')).toBe('2000-01-01');
    expect(sqlTarih('05.09.2026', '2000-01-01')).toBe('2000-01-01');
    expect(sqlTarih(undefined, '2000-01-01')).toBe('2000-01-01');
  });
  it('sqlTamsayi: aralık dışı / sayısal olmayan → varsayılan; ondalık kırpılır', () => {
    expect(sqlTamsayi('42', 10)).toBe(42);
    expect(sqlTamsayi(3.9, 10)).toBe(3);
    expect(sqlTamsayi('abc', 10)).toBe(10);
    expect(sqlTamsayi(-1, 10)).toBe(10);
    expect(sqlTamsayi(100001, 10)).toBe(10);
    expect(sqlTamsayi(7, 10, 8, 20)).toBe(10);
  });
  it('sqlTanimlayici: tablo/kolon adı yalnız [A-Za-z_][A-Za-z0-9_]*', () => {
    expect(sqlTanimlayici('STOKLAR')).toBe('STOKLAR');
    expect(sqlTanimlayici(' sto_kod ')).toBe('sto_kod');
    expect(sqlTanimlayici('STOKLAR; DROP TABLE x')).toBeNull();
    expect(sqlTanimlayici('1abc')).toBeNull();
    expect(sqlTanimlayici('şube')).toBeNull();
    expect(sqlTanimlayici(null)).toBeNull();
  });
});
