/**
 * para.test.ts — para matematiği TEK KAYNAK sözleşmesi (Faz 1 4/n, 2026-09-05). ÖNCE YAZILDI.
 *
 * Faz 0: para/KDV hesabı 7 dosyada elle, PDF'te 14 `|| 0`, `kdvOran || 20` sahte oran,
 * QuotationDetail `/1.2` sabit. Kural (CLAUDE.md): bilinmeyen sayı 0 değil BİLİNMİYOR;
 * toplama girmez, sayılır; ekranda/PDF'te '—'. Bu dosya o sözleşmeyi kilitler.
 */
import { describe, it, expect } from 'vitest';
import { tutarYaz, kdvAyristir, satirTutari, toplaBilinen, siparisMaliyeti, tahsilatOrani, teklifToplamlari, ekranTutari, tamTutar, tutarBirlestir, sayiSirala, donemKarsilastir } from './para';

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

describe('siparisMaliyeti — sipariş satır maliyeti (COGS tek kaynağı: Phase 132 + 143)', () => {
  it('bilinen satırlar toplanır; sayısal string miktar kabul; 0 maliyet (numune) geçerli', () => {
    expect(siparisMaliyeti({ lineItems: [{ costPrice: 400, quantity: 2 }, { costPrice: 50, quantity: '4' }] })).toBe(1000);
    expect(siparisMaliyeti({ lineItems: [{ costPrice: 0, quantity: 3 }] })).toBe(0);
  });
  it("tek satırın costPrice/quantity'si bilinmiyorsa sipariş maliyeti NaN — kısmi toplam sahte kesinliktir", () => {
    for (const v of [undefined, null, '', NaN, 'abc', Infinity]) {
      expect(siparisMaliyeti({ lineItems: [{ costPrice: 5, quantity: 1 }, { costPrice: v, quantity: 2 }] })).toBeNaN();
      expect(siparisMaliyeti({ lineItems: [{ costPrice: 5, quantity: v }] })).toBeNaN();
    }
  });
  it('satırı olmayan (boş / yok / null) siparişin maliyeti BİLİNMİYOR — 0 değil (Mikro türetmesi %100 brüt marj basıyordu)', () => {
    expect(siparisMaliyeti({ lineItems: [] })).toBeNaN();
    expect(siparisMaliyeti({})).toBeNaN();
    expect(siparisMaliyeti({ lineItems: null })).toBeNaN();
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

describe("ekranTutari — ekran köprüsü TEK sözleşme: hiç bilinen yokken '—', kısmi bilinmeyen kısmi toplam + not", () => {
  it('bilinen > 0 ve bilinmeyen > 0 → kısmi toplam (sayfa "N kayıt tutarsız" notu koyar)', () => {
    expect(ekranTutari({ toplam: 500, bilinen: 2, bilinmeyen: 1 })).toBe(500);
    expect(ekranTutari(toplaBilinen([100, null, 400, 'abc'], x => x))).toBe(500);
  });
  it("bilinen = 0 ve bilinmeyen > 0 → NaN (paraYaz/tlYaz '—'; '₺0' sahte kesinlik)", () => {
    expect(ekranTutari({ toplam: 0, bilinen: 0, bilinmeyen: 2 })).toBeNaN();
    expect(ekranTutari(toplaBilinen([null, undefined, ''], x => x))).toBeNaN();
  });
  it('boş liste gerçek 0 (kayıt yok ≠ bilinmiyor); meşru 0 toplam 0 kalır', () => {
    expect(ekranTutari({ toplam: 0, bilinen: 0, bilinmeyen: 0 })).toBe(0);
    expect(ekranTutari(toplaBilinen([], x => x))).toBe(0);
    expect(ekranTutari({ toplam: 0, bilinen: 3, bilinmeyen: 0 })).toBe(0);
  });
});

describe("tamTutar — TÜRETME kapısı: bir kayıt bile bilinmiyorsa NaN (ekranTutari'den farklı: kısmi toplam türetmeye GİRMEZ)", () => {
  it('bilinmeyen 0 → toplam (boş liste gerçek 0); bilinmeyen > 0 → NaN, bilinen olsa da', () => {
    expect(tamTutar({ toplam: 250, bilinen: 3, bilinmeyen: 0 })).toBe(250);
    expect(tamTutar({ toplam: 0, bilinen: 0, bilinmeyen: 0 })).toBe(0);
    expect(tamTutar({ toplam: 250, bilinen: 3, bilinmeyen: 1 })).toBeNaN();
    expect(ekranTutari({ toplam: 250, bilinen: 3, bilinmeyen: 1 })).toBe(250);   // ekran: kısmi + not
  });
  it('net = tamTutar(a) − tamTutar(b): bir taraf kısmiyken NaN → paraYaz "—" (kısmi giriş − tam çıkış "net" değildir)', () => {
    const giris = { toplam: 1500, bilinen: 1, bilinmeyen: 1 }, cikis = { toplam: 50, bilinen: 1, bilinmeyen: 0 };
    expect(tamTutar(giris) - tamTutar(cikis)).toBeNaN();
    expect(tamTutar({ ...giris, bilinmeyen: 0 }) - tamTutar(cikis)).toBe(1450);
  });
});

describe('tutarBirlestir — toplam satırı: toplamlar ve iki sayaç toplanır', () => {
  it('sayaçlar birleşir; boş → sıfır; tek eleman aynen', () => {
    expect(tutarBirlestir({ toplam: 100, bilinen: 1, bilinmeyen: 0 }, { toplam: 50.5, bilinen: 2, bilinmeyen: 3 })).toEqual({ toplam: 150.5, bilinen: 3, bilinmeyen: 3 });
    expect(tutarBirlestir()).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(tutarBirlestir({ toplam: 7, bilinen: 1, bilinmeyen: 0 })).toEqual({ toplam: 7, bilinen: 1, bilinmeyen: 0 });
  });
});

describe('sayiSirala — sıralamada bilinmeyen 0 sayılmaz, sona gider', () => {
  it('bilinenler sayısal artan; bilinmeyen (null/undefined/NaN/"abc") hep sonda; azalan için çevrilir', () => {
    const liste = [{ b: 500 }, { b: null }, { b: -20 }, { b: 'abc' }, { b: '30' }, { b: undefined }, { b: 0 }];
    expect([...liste].sort((x, y) => sayiSirala(x.b, y.b)).map(o => o.b)).toEqual([-20, 0, '30', 500, null, 'abc', undefined]);
    expect([...liste].sort((x, y) => sayiSirala(x.b, y.b, true)).map(o => o.b)).toEqual([500, '30', 0, -20, null, 'abc', undefined]);   // azalan: bilinmeyen YİNE sonda
  });
  it('eski kalıp `(a||0)-(b||0)` bilinmeyeni 0 gibi ortaya diziyordu — burada 0 ile bilinmeyen ayrışır', () => {
    expect(sayiSirala(0, null)).toBe(-1);
    expect(sayiSirala(null, 0)).toBe(1);
    expect(sayiSirala(null, undefined)).toBe(0);
  });
});

describe('donemKarsilastir — iki dönemin cirosu: ekran ≠ türetme (haftalık rapor e-postası)', () => {
  const t = (toplam: number, bilinen: number, bilinmeyen: number) => ({ toplam, bilinen, bilinmeyen });
  it('iki dönem de tam biliniyorsa yüzde ve yön hesaplanır', () => {
    expect(donemKarsilastir(t(120000, 8, 0), t(100000, 7, 0))).toEqual({ ekran: 120000, yuzde: 20, yon: 'artis' });
    expect(donemKarsilastir(t(70000, 5, 0), t(100000, 7, 0))).toEqual({ ekran: 70000, yuzde: -30, yon: 'azalis' });
  });
  it('bir dönemde tek kayıt bile bilinmiyorsa SAPMA ÜRETİLMEZ — kısmi toplamdan "▼ %30" basılıyordu (mutasyon-ayırt-edici)', () => {
    expect(donemKarsilastir(t(70000, 7, 3), t(100000, 7, 0))).toEqual({ ekran: 70000, yuzde: null, yon: null });
    expect(donemKarsilastir(t(100000, 7, 0), t(60000, 4, 3))).toEqual({ ekran: 100000, yuzde: null, yon: null });
  });
  it('bu dönemin TÜM kayıtları bilinmiyorsa ekran NaN ("—") — "₺0 ▼ %100" basılmaz', () => {
    const r = donemKarsilastir(t(0, 0, 4), t(100000, 7, 0));
    expect(r.ekran).toBeNaN();
    expect(r.yuzde).toBeNull();
  });
  it('önceki dönem 0 / boşsa yüzde yok (0\'a bölme); kayıtsız dönem gerçek 0', () => {
    expect(donemKarsilastir(t(5000, 1, 0), t(0, 0, 0))).toEqual({ ekran: 5000, yuzde: null, yon: null });
    expect(donemKarsilastir(t(0, 0, 0), t(0, 0, 0)).ekran).toBe(0);
  });
});

