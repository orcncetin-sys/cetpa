/**
 * para.test.ts — para matematiği TEK KAYNAK sözleşmesi (Faz 1 4/n, 2026-09-05). ÖNCE YAZILDI.
 *
 * Faz 0: para/KDV hesabı 7 dosyada elle, PDF'te 14 `|| 0`, `kdvOran || 20` sahte oran,
 * QuotationDetail `/1.2` sabit. Kural (CLAUDE.md): bilinmeyen sayı 0 değil BİLİNMİYOR;
 * toplama girmez, sayılır; ekranda/PDF'te '—'. Bu dosya o sözleşmeyi kilitler.
 */
import { describe, it, expect } from 'vitest';
import { tutarYaz, kdvAyristir, satirTutari, toplaBilinen, tahsilatOrani, teklifToplamlari } from './para';

describe('tutarYaz — PDF/CSV için tutar metni', () => {
  it("bilinen: Türk biçimi + birim ('1.234,56 TL'); 0 gerçek sıfırdır", () => {
    expect(tutarYaz(1234.5, 'TL')).toBe('1.234,50 TL');
    expect(tutarYaz(0, 'TL')).toBe('0,00 TL');
    expect(tutarYaz(12.5, 'EUR')).toBe('12,50 EUR');
  });
  it("bilinmeyen (undefined/null/NaN/''/'abc') → '—', asla '0,00'", () => {
    for (const v of [undefined, null, NaN, '', 'abc', Infinity]) expect(tutarYaz(v, 'TL')).toBe('—');
  });
  it("sayısal string kabul (DB'den '1250.5' gelebilir)", () => {
    expect(tutarYaz('1250.5', 'TL')).toBe('1.250,50 TL');
  });
});

describe('kdvAyristir — brütten net/KDV', () => {
  it('%20: 1200 brüt → net 1000, KDV 200', () => {
    expect(kdvAyristir(1200, 20)).toEqual({ net: 1000, kdv: 200 });
  });
  it('%10 ve %1 (inşaat malzemesinde indirimli oranlar) doğru ayrışır — float toleransıyla, yuvarlama çağıranın işi', () => {
    const r10 = kdvAyristir(1100, 10); expect(r10?.net).toBeCloseTo(1000, 6); expect(r10?.kdv).toBeCloseTo(100, 6);
    const r1 = kdvAyristir(1010, 1); expect(r1?.net).toBeCloseTo(1000, 6); expect(r1?.kdv).toBeCloseTo(10, 6);
  });
  it('%0 geçerli (ihracat/istisna): net = brüt, KDV 0', () => {
    expect(kdvAyristir(500, 0)).toEqual({ net: 500, kdv: 0 });
  });
  it('ORAN BİLİNMİYORSA null — %20 VARSAYILMAZ (pdf.ts `kdvOran || 20` tuzağı)', () => {
    expect(kdvAyristir(1200, undefined)).toBeNull();
    expect(kdvAyristir(1200, NaN)).toBeNull();
    expect(kdvAyristir(1200, -5)).toBeNull();
  });
  it('brüt bilinmiyorsa null', () => {
    expect(kdvAyristir(undefined, 20)).toBeNull();
    expect(kdvAyristir(NaN, 20)).toBeNull();
  });
});

describe('satirTutari — fiyat × miktar', () => {
  it('ikisi de biliniyorsa çarpım; 0 fiyat (numune) geçerli', () => {
    expect(satirTutari(12.5, 4)).toBe(50);
    expect(satirTutari(0, 4)).toBe(0);
  });
  it('biri bilinmiyorsa NaN (null × 4 = 0 tuzağı YOK)', () => {
    expect(Number.isNaN(satirTutari(null, 4))).toBe(true);
    expect(Number.isNaN(satirTutari(12.5, undefined))).toBe(true);
    expect(Number.isNaN(satirTutari('', 4))).toBe(true);
  });
});

describe('toplaBilinen — bilinmeyen toplama girmez, SAYILIR', () => {
  it('hepsi bilinen: toplam + bilinmeyen 0', () => {
    expect(toplaBilinen([{ t: 10 }, { t: 20.5 }], o => o.t)).toEqual({ toplam: 30.5, bilinmeyen: 0, bilinen: 2 });
  });
  it('bilinmeyenler dışarıda ve sayılı; boş liste toplam 0/bilinen 0', () => {
    expect(toplaBilinen([{ t: 10 }, { t: null }, { t: undefined }, { t: NaN }], o => o.t)).toEqual({ toplam: 10, bilinmeyen: 3, bilinen: 1 });
    expect(toplaBilinen([], o => (o as { t: number }).t)).toEqual({ toplam: 0, bilinmeyen: 0, bilinen: 0 });
  });
});

describe('tahsilatOrani — yalnız ödeme takipli ve tutarı bilinen siparişler', () => {
  const s = (ek: Record<string, unknown>) => ({ status: 'Delivered', ...ek });
  it('2 ödendi (300) / 4 izlenen (600) → %50', () => {
    const r = tahsilatOrani([s({ totalPrice: 100, paid: true }), s({ totalPrice: 200, paid: true }), s({ totalPrice: 150, paid: false }), s({ totalPrice: 150, paid: false })]);
    expect(r).toEqual({ oran: 50, odenen: 300, izlenen: 600, bilinmeyen: 0 });
  });
  it("Mikro türevi (source:'mikro-fatura') hesaba GİRMEZ — paid yokluğu 'ödenmedi' değil", () => {
    const r = tahsilatOrani([s({ totalPrice: 100, paid: true }), s({ totalPrice: 900, source: 'mikro-fatura' })]);
    expect(r).toEqual({ oran: 100, odenen: 100, izlenen: 100, bilinmeyen: 0 });
  });
  it('tutarı bilinmeyen sipariş toplama girmez, sayılır', () => {
    const r = tahsilatOrani([s({ totalPrice: 100, paid: true }), s({ totalPrice: undefined, paid: false })]);
    expect(r).toEqual({ oran: 100, odenen: 100, izlenen: 100, bilinmeyen: 1 });
  });
  it('iptal edilen sipariş izlenene girmez; izlenen ciro 0 ise oran null (0 değil — "0% tahsilat" sahte kesinlik)', () => {
    expect(tahsilatOrani([s({ totalPrice: 100, paid: false, status: 'Cancelled' })])).toEqual({ oran: null, odenen: 0, izlenen: 0, bilinmeyen: 0 });
    expect(tahsilatOrani([])?.oran).toBeNull();
  });
});

describe('teklifToplamlari — kalem bazlı KDV, tek kaynak (Form + Detail + PDF)', () => {
  it('kalemlerden net / KDV / brüt: %20 ve %10 karışık', () => {
    const r = teklifToplamlari([{ price: 100, quantity: 2, vatRate: 20 }, { price: 50, quantity: 1, vatRate: 10 }]);
    expect(r.net).toBe(250); expect(r.kdv).toBeCloseTo(45, 6); expect(r.brut).toBeCloseTo(295, 6); expect(r.bilinmeyenSatir).toBe(0);
  });
  it("vatRate yoksa o kalemin KDV'si BİLİNMİYOR: net toplama girer, kdv/brüt NaN (eskiden `?? 0` ile %0 sayılıyordu)", () => {
    const r = teklifToplamlari([{ price: 100, quantity: 1, vatRate: 20 }, { price: 100, quantity: 1 }]);
    expect(r.net).toBe(200); expect(Number.isNaN(r.kdv)).toBe(true); expect(Number.isNaN(r.brut)).toBe(true); expect(r.bilinmeyenSatir).toBe(1);
  });
  it('fiyatı/miktarı bilinmeyen kalem: net de bilinmiyor → hepsi NaN, sayılır', () => {
    const r = teklifToplamlari([{ price: 100, quantity: 1, vatRate: 20 }, { quantity: 3, vatRate: 20 }]);
    expect(Number.isNaN(r.net)).toBe(true); expect(r.bilinmeyenSatir).toBe(1);
  });
  it("boş liste (kalemi olmayan eski kayıt): net/kdv/brüt NaN — QuotationDetail `total/1.2` sabitine geri DÖNÜLMEZ", () => {
    const r = teklifToplamlari([]);
    expect(Number.isNaN(r.brut)).toBe(true); expect(r.bilinmeyenSatir).toBe(0);
  });
  it('%0 KDV geçerli (ihracat): kdv 0, brüt = net', () => {
    expect(teklifToplamlari([{ price: 10, quantity: 1, vatRate: 0 }])).toEqual({ net: 10, kdv: 0, brut: 10, bilinmeyenSatir: 0 });
  });
});
