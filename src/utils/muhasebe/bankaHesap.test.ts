/**
 * bankaHesap.test.ts — Muhasebe → Banka & Kasa sekmesi (AccountingModule) hesap sözleşmesi
 * (Faz 3 2/n, grup "bankaHesap", 2026-09-14). ÖNCE YAZILDI.
 *
 * Sahte kesinlik siteleri (AccountingModule.tsx):
 *   1611-1613  tryBalance/usdBalance/eurBalance = filter(currency).reduce(s + a.balance, 0)
 *              → DB'den `balance: null` gelen hesap toplamı NaN'a çeviriyor ("₺NaN"), sayısal
 *                string ise dize yapıştırıyordu ("02500"); KPI kartı hiç açıklama vermiyordu
 *   1108-1110  amount: Math.abs(Number(r.Tutar ?? r.amount ?? 0))  /  type: Number(...) >= 0 ? 'credit'
 *              balance: Number(r.BakiyeSonrasi ?? r.balance ?? 0)
 *              → tutarı bilinmeyen Mikro satırı "₺0 alacak" olarak DB'ye YAZILIYOR, bakiyesi
 *                bilinmeyen satır "bakiye ₺0" ile yazılıyordu; toast "N yeni hareket" diyordu
 * Kural (CLAUDE.md + Faz 1): bilinmeyen tutar 0 değil BİLİNMİYOR — toplama girmez, SAYILIR;
 * tutarı bilinmeyen satır yazılmaz, atlanır ve sayılır; bakiyesi bilinmeyen satır bakiyesiz yazılır.
 */
import { describe, it, expect } from 'vitest';
import { ekranTutari, tamTutar } from '../para';
import { paraYaz } from '../currency';
import type { BankTransaction } from '../../types';
import {
  dovizBakiyeleri, mikroBankaHareketiOku, hareketNedenleOku, hareketleriAyikla,
  type BakiyeliHesap, type MikroBankaHareketi,
} from './bankaHesap';

// ── dovizBakiyeleri: KPI kartları (TRY / USD / EUR bakiye) ──────────────────────────────────

/** Sayfanın BankAccount'u daha geniş; hesap yalnız currency/balance okur (yapısal girdi). */
type Hesap = BakiyeliHesap & { bankName?: string; accountHolder?: string };
const hesaplar: Hesap[] = [
  { bankName: 'İş Bankası',  accountHolder: 'Şirin İnşaat', currency: 'TRY', balance: 12500.75 },
  { bankName: 'Garanti BBVA', accountHolder: 'Şirin İnşaat', currency: 'TRY', balance: 3000 },
  { bankName: 'Ziraat',       accountHolder: 'Çelik Yapı',   currency: 'USD', balance: 1200 },
  { bankName: 'Akbank',       accountHolder: 'Çelik Yapı',   currency: 'EUR', balance: 800 },
];

describe('dovizBakiyeleri — birim bazlı bakiye toplamı', () => {
  it('sayfa paritesi: hepsi bilinen → eski reduce ile aynı sayılar', () => {
    const b = dovizBakiyeleri(hesaplar);
    expect(b.TRY).toEqual({ toplam: 15500.75, bilinen: 2, bilinmeyen: 0 });
    expect(b.USD).toEqual({ toplam: 1200,     bilinen: 1, bilinmeyen: 0 });
    expect(b.EUR).toEqual({ toplam: 800,      bilinen: 1, bilinmeyen: 0 });
    // eski satır 1611: filter(currency==='TRY').reduce((s,a)=>s+a.balance,0)
    const eskiTry = hesaplar.filter(a => a.currency === 'TRY').reduce((s, a) => s + Number(a.balance), 0);
    expect(ekranTutari(b.TRY)).toBe(eskiTry);
  });

  it('bakiyesi bilinmeyen (null/undefined) hesap toplama GİRMEZ, SAYILIR — kısmi toplam + not', () => {
    const eksik: Hesap[] = [
      { bankName: 'Halkbank',   currency: 'TRY', balance: null },      // DB'de null
      { bankName: 'Yapı Kredi', currency: 'USD' },                     // alan hiç yok
    ];
    const b = dovizBakiyeleri([...hesaplar, ...eksik]);
    expect(b.TRY).toEqual({ toplam: 15500.75, bilinen: 2, bilinmeyen: 1 }); // `|| 0` geri gelse bilinmeyen 0 olur → kırılır
    expect(b.USD).toEqual({ toplam: 1200,     bilinen: 1, bilinmeyen: 1 });
    expect(ekranTutari(b.TRY)).toBe(15500.75); // ekran: kısmi toplam, sayfa "1 kayıt tutarsız" der
    expect(Number.isNaN(tamTutar(b.TRY))).toBe(true); // türetmeye girmez
  });

  it('birimde HİÇ bilinen yokken ekran "—" (eski: ₺0,00 / ₺NaN)', () => {
    const tek: Hesap[] = [{ bankName: 'Halkbank', currency: 'TRY', balance: null }];
    const b = dovizBakiyeleri(tek);
    expect(b.TRY).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(Number.isNaN(ekranTutari(b.TRY))).toBe(true);
    expect(paraYaz(ekranTutari(b.TRY))).toBe('—');
  });

  it('boş liste GERÇEK 0 (hareketsiz), bilinmeyen değil', () => {
    const b = dovizBakiyeleri([]);
    for (const k of ['TRY', 'USD', 'EUR'] as const) {
      expect(b[k]).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
      expect(ekranTutari(b[k])).toBe(0);
      expect(tamTutar(b[k])).toBe(0);
    }
  });

  it('tanınmayan / farklı yazımlı birim hiçbir kovaya girmez (sayfadaki `=== "TRY"` süzgeci korunur)', () => {
    const b = dovizBakiyeleri([
      { currency: 'GBP', balance: 999 },
      { currency: 'try', balance: 999 },
      { currency: null,  balance: 999 },
      { balance: 999 },
    ]);
    expect(b.TRY).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(b.USD).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(b.EUR).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });

  it("sayısal string bakiye bilinen sayılır (eski `s + a.balance` '02500' dizesi yapıştırıyordu); NaN/Infinity/'abc' bilinmeyen", () => {
    const b = dovizBakiyeleri([
      { currency: 'TRY', balance: '2500' },
      { currency: 'TRY', balance: NaN },
      { currency: 'TRY', balance: Infinity },
      { currency: 'TRY', balance: 'abc' },
    ]);
    expect(b.TRY).toEqual({ toplam: 2500, bilinen: 1, bilinmeyen: 3 });
  });
});

// ── mikroBankaHareketiOku: Mikro satırı → BankTransaction ──────────────────────────────────

const BUGUN = '2026-09-14';
const satir = {
  HesapId: 'TR330006100519786457841326', BankaAdi: 'İş Bankası — Şirin İnşaat', Tarih: '2026-09-12',
  Aciklama: 'Çelik Yapı hakediş ödemesi', Tutar: 1500, BakiyeSonrasi: 20000, DovizKodu: 'TRY', BelgeNo: 'HVL-2026-0912',
};

describe('mikroBankaHareketiOku — tek satır', () => {
  it('sayfa paritesi: tam satır → aynı alanlar; pozitif tutar alacak (credit)', () => {
    const r = mikroBankaHareketiOku(satir, { bugun: BUGUN });
    expect(r).toEqual({
      accountId: 'TR330006100519786457841326', accountName: 'İş Bankası — Şirin İnşaat', date: '2026-09-12',
      description: 'Çelik Yapı hakediş ödemesi', amount: 1500, type: 'credit', balance: 20000,
      currency: 'TRY', reference: 'HVL-2026-0912', source: 'mikro',
    });
  });

  it('negatif tutar → borç (debit), amount mutlak değer', () => {
    const r = mikroBankaHareketiOku({ ...satir, Tutar: -250.5, BakiyeSonrasi: 19749.5 }, { bugun: BUGUN });
    expect(r).toMatchObject({ amount: 250.5, type: 'debit', balance: 19749.5 });
  });

  it('İngilizce anahtar yedekleri (accountId/bankName/date/description/amount/balance/currency/reference)', () => {
    const r = mikroBankaHareketiOku({
      accountId: 'H-2', bankName: 'Garanti BBVA', date: '2026-09-01', description: 'Kira', amount: -4000,
      balance: 16000, currency: 'USD', reference: 'KR-09',
    }, { bugun: BUGUN });
    expect(r).toEqual({
      accountId: 'H-2', accountName: 'Garanti BBVA', date: '2026-09-01', description: 'Kira', amount: 4000,
      type: 'debit', balance: 16000, currency: 'USD', reference: 'KR-09', source: 'mikro',
    });
  });

  it("Tutar bilinmiyor (null / yok / '' / 'abc') → null: satır YAZILMAZ (eski: amount 0, credit yazılıyordu)", () => {
    expect(mikroBankaHareketiOku({ ...satir, Tutar: null }, { bugun: BUGUN })).toBeNull();
    const { Tutar: _t, ...tutarsiz } = satir; void _t;
    expect(mikroBankaHareketiOku(tutarsiz, { bugun: BUGUN })).toBeNull();
    expect(mikroBankaHareketiOku({ ...satir, Tutar: '' }, { bugun: BUGUN })).toBeNull();
    expect(mikroBankaHareketiOku({ ...satir, Tutar: 'abc' }, { bugun: BUGUN })).toBeNull();
  });

  it('Tutar 0 GERÇEK sıfır → yazılır (alacak, sayfadaki `>= 0` korunur)', () => {
    expect(mikroBankaHareketiOku({ ...satir, Tutar: 0 }, { bugun: BUGUN })).toMatchObject({ amount: 0, type: 'credit' });
  });

  it("Tutar sayısal string '1500' → 1500; Türk biçimi '1.500,00' Number ile çözülmez → null (parse UYDURULMAZ)", () => {
    expect(mikroBankaHareketiOku({ ...satir, Tutar: '1500' }, { bugun: BUGUN })).toMatchObject({ amount: 1500, type: 'credit' });
    expect(mikroBankaHareketiOku({ ...satir, Tutar: '1.500,00' }, { bugun: BUGUN })).toBeNull();
  });

  it('BakiyeSonrasi bilinmiyor → satır yazılır, `balance` anahtarı HİÇ yok (eski: balance 0)', () => {
    const r = mikroBankaHareketiOku({ ...satir, BakiyeSonrasi: null }, { bugun: BUGUN });
    expect(r).not.toBeNull();
    expect(r && 'balance' in r).toBe(false); // `?? 0` geri gelse balance: 0 olur → kırılır
    expect(r).toMatchObject({ amount: 1500, type: 'credit' });
    const { BakiyeSonrasi: _b, ...bakiyesiz } = satir; void _b;
    expect(mikroBankaHareketiOku(bakiyesiz, { bugun: BUGUN })).not.toHaveProperty('balance');
    expect(mikroBankaHareketiOku({ ...satir, BakiyeSonrasi: 'abc' }, { bugun: BUGUN })).not.toHaveProperty('balance');
  });

  it('Tarih yoksa `bugun` (sayfa paritesi — çağıran bugunAnahtari() verir)', () => {
    const { Tarih: _t, ...tarihsiz } = satir; void _t;
    expect(mikroBankaHareketiOku(tarihsiz, { bugun: BUGUN })).toMatchObject({ date: BUGUN });
  });

  it("DovizKodu yoksa 'TRY' (sayfa paritesi); tanınmayan kod (GBP) → null, tip yalanı yok (eski: `as` ile GBP yazılıyordu)", () => {
    const { DovizKodu: _d, ...birimsiz } = satir; void _d;
    expect(mikroBankaHareketiOku(birimsiz, { bugun: BUGUN })).toMatchObject({ currency: 'TRY' });
    expect(mikroBankaHareketiOku({ ...satir, DovizKodu: 'EUR' }, { bugun: BUGUN })).toMatchObject({ currency: 'EUR' });
    expect(mikroBankaHareketiOku({ ...satir, DovizKodu: 'GBP' }, { bugun: BUGUN })).toBeNull();
    expect(mikroBankaHareketiOku({ ...satir, DovizKodu: 12 }, { bugun: BUGUN })).toBeNull();
  });

  it('Aciklama yoksa BelgeNo açıklama olur; HesapAdi ikinci yedek; eksik metinler boş dize', () => {
    const r = mikroBankaHareketiOku({ HesapAdi: 'Kasa', Tutar: 10, BelgeNo: 'B-1' }, { bugun: BUGUN });
    expect(r).toMatchObject({ accountId: '', accountName: 'Kasa', description: 'B-1', reference: 'B-1' });
  });

  it('satır nesne değilse (null / dize / sayı) → null', () => {
    expect(mikroBankaHareketiOku(null, { bugun: BUGUN })).toBeNull();
    expect(mikroBankaHareketiOku('x', { bugun: BUGUN })).toBeNull();
    expect(mikroBankaHareketiOku(42, { bugun: BUGUN })).toBeNull();
  });

  it('dönüş tipi BankTransaction (id hariç) ile uyumlu — çağıran doğrudan addDoc edebilir', () => {
    const r = mikroBankaHareketiOku(satir, { bugun: BUGUN });
    if (r === null) throw new Error('beklenmedik null');
    const k: Omit<BankTransaction, 'id'> = r; // derleme zamanı kanıtı (balance opsiyonel)
    expect(k.source).toBe('mikro');
  });
});

// ── hareketleriAyikla: liste + atlama sayaçları (toast metni için) ─────────────────────────

describe('hareketleriAyikla — liste', () => {
  const satirlar: unknown[] = [
    satir,                                                       // tam
    { ...satir, Tutar: -250.5, BakiyeSonrasi: null },             // bakiyesiz ama yazılır
    { ...satir, Tutar: null },                                   // tutarsız → atlanır
    { ...satir, DovizKodu: 'GBP' },                              // birim tanınmadı → atlanır
    'bozuk',                                                     // nesne değil → atlanır (tutar okunamaz)
    { ...satir, Tutar: 0 },                                      // gerçek 0 → yazılır
  ];

  it('yazılabilenler sırayla; atlanan = tutarsız + birimsiz; bakiyesiz yazılanlar ayrıca sayılır', () => {
    const s = hareketleriAyikla(satirlar, { bugun: BUGUN });
    expect(s.kayitlar.map(k => k.amount)).toEqual([1500, 250.5, 0]); // `?? 0` geri gelse [1500,250.5,0,0,1500,0] olur → kırılır
    expect(s.kayitlar[1]).not.toHaveProperty('balance');
    expect(s).toMatchObject({ atlanan: 3, tutarsiz: 2, birimsiz: 1, bakiyesiz: 1 });
  });

  it('boş liste → boş sonuç, hiçbir sayaç dolmaz', () => {
    expect(hareketleriAyikla([], { bugun: BUGUN })).toEqual({ kayitlar: [], atlanan: 0, tutarsiz: 0, birimsiz: 0, bakiyesiz: 0 });
  });

  it('hareketNedenleOku nedeni söyler: tutar / birim', () => {
    expect(hareketNedenleOku({ ...satir, Tutar: null }, { bugun: BUGUN })).toEqual({ neden: 'tutar' });
    expect(hareketNedenleOku({ ...satir, DovizKodu: 'CHF' }, { bugun: BUGUN })).toEqual({ neden: 'birim' });
    const ok = hareketNedenleOku(satir, { bugun: BUGUN });
    if (!('kayit' in ok)) throw new Error('beklenmedik atlama');
    const kayit: MikroBankaHareketi = ok.kayit;
    expect(kayit.amount).toBe(1500);
  });
});
