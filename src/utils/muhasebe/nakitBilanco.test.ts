/**
 * nakitBilanco.test.ts — Muhasebe → "Nakit Akışı" + "Phase 547: Bilanço" hesap sözleşmesi
 * (Faz 3 1/n, 2026-09-13). ÖNCE YAZILDI.
 *
 * Sayfadaki sahte kesinlik: inflow `o.totalPrice || 0`, COGS `(li.costPrice ?? 0) * li.quantity`,
 * AR `o.totalPrice||o.totalAmount||0`, stok `(i.stockLevel||0) * itemCostTRY` (kur/maliyet yoksa 0),
 * AP `po.totalAmount||0`, KDV `o.faturali && o.kdvTutari` (bilinmeyeni sessizce atar). Kural
 * (CLAUDE.md): bilinmeyen tutar 0 DEĞİL BİLİNMİYOR — toplama girmez, `bilinmeyen` SAYILIR, ekranda '—'
 * + "N kayıt tutarsız" notu. Hakem turu (2026-09-13): toplamlar `bilinen` de taşır ki hiç bilinen
 * kayıt yokken ekran '₺0*' değil '—' bassın (kdvAylik `ekranTutari`); sipariş tutarı siparis.ts
 * `siparisTutari` (`??` — meşru 0 tutar 0 KALIR, totalAmount'a düşmez).
 */
import { describe, it, expect } from 'vitest';
import {
  sonAyAnahtarlari, nakitAkisi, dovizTopla, ticariAlacak, stokDegeri, duranVarlik, ticariBorc, kdvBorcu, bilanco,
} from './nakitBilanco';
import { ekranTutari } from '../para';

const T = (toplam: number, bilinen: number, bilinmeyen: number) => ({ toplam, bilinen, bilinmeyen });

const SIMDI = new Date(2026, 8, 13, 10, 30); // 13 Eylül 2026, yerel saat
const BILINMEYENLER: unknown[] = [undefined, null, '', NaN, 'abc', Infinity];

describe('sonAyAnahtarlari — son N ayın YYYY-MM anahtarları, eski→yeni', () => {
  it('6 ay: Nisan→Eylül 2026', () => {
    expect(sonAyAnahtarlari(6, SIMDI)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  });
  it('yıl sınırını aşar: Ocak 2026 için 3 ay → Kas 2025, Ara 2025, Oca 2026', () => {
    expect(sonAyAnahtarlari(3, new Date(2026, 0, 15))).toEqual(['2025-11', '2025-12', '2026-01']);
  });
  it('31 Mart gibi ay sonunda geriye giderken ay atlamaz (Şubat 28 gün)', () => {
    expect(sonAyAnahtarlari(3, new Date(2026, 2, 31))).toEqual(['2026-01', '2026-02', '2026-03']);
  });
  it('0 ya da negatif adet → boş', () => {
    expect(sonAyAnahtarlari(0, SIMDI)).toEqual([]);
    expect(sonAyAnahtarlari(-2, SIMDI)).toEqual([]);
  });
});

describe('nakitAkisi — aylık giriş (ödenmiş takipli sipariş) / çıkış (satır maliyeti)', () => {
  const siparisler = [
    // Ağustos: ödenmiş, iki kalemin maliyeti bilinen → giriş 12.000, çıkış 5.000 + 2.050
    { musteri: 'Şahin İnşaat', totalPrice: 12000, paid: true, status: 'Delivered', createdAt: '2026-08-05', lineItems: [{ costPrice: 100, quantity: 50 }, { costPrice: 20.5, quantity: 100 }] },
    // Ağustos: ödenmemiş → girişe girmez, maliyeti (1.000) çıkışa girer
    { musteri: 'Çelik Yapı', totalPrice: 3000, paid: false, status: 'Pending', createdAt: '2026-08-20', lineItems: [{ costPrice: 10, quantity: 100 }] },
    // Ağustos: Mikro kaynaklı — `paid:true` yazsa bile tahsilat Cetpa'da İZLENMİYOR → girişe girmez; maliyeti (4.000) çıkışa girer
    { musteri: 'Işık Ltd.', totalPrice: 8000, paid: true, status: 'Delivered', source: 'mikro-fatura', createdAt: '2026-08-11', lineItems: [{ costPrice: 40, quantity: 100 }] },
    // Eylül: iptal → ne giriş ne çıkış
    { musteri: 'Öztürk A.Ş.', totalPrice: 9999, paid: true, status: 'Cancelled', createdAt: '2026-09-01', lineItems: [{ costPrice: 999, quantity: 1 }] },
    // Eylül: ödenmiş ama tutarı bilinmiyor → girişe 0 olarak GİRMEZ, sayılır; maliyeti (50) çıkışa girer
    { musteri: 'Güneş Yapı', totalPrice: undefined, paid: true, status: 'Delivered', createdAt: '2026-09-03', lineItems: [{ costPrice: 5, quantity: 10 }] },
    // Eylül: Shopify aynası (syncedAt), sayısal string tutar, kalemsiz → giriş 1.500, çıkış 0
    { totalPrice: '1500', paid: true, status: 'Shipped', syncedAt: '2026-09-10T08:00:00Z', lineItems: [] },
    // Pencere dışı (Mart) → yok sayılır, tarihsiz de değil
    { totalPrice: 500, paid: true, status: 'Delivered', createdAt: '2026-03-01', lineItems: [{ costPrice: 1, quantity: 1 }] },
    // Tarihsiz → hiçbir aya girmez, SAYILIR (eski kod sessizce düşürüyordu)
    { totalPrice: 700, paid: true, status: 'Delivered', lineItems: [{ costPrice: 1, quantity: 1 }] },
  ];
  const r = nakitAkisi(siparisler, 6, SIMDI);

  it('6 ay üretir, eski→yeni', () => {
    expect(r.aylar.map(a => a.key)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  });
  it('Ağustos: giriş 12.000 (yalnız ödenmiş + Cetpa-takipli), çıkış 12.050 (4 bilinen kalem), net -50', () => {
    const agu = r.aylar[4];
    expect(agu).toEqual({ key: '2026-08', giris: T(12000, 1, 0), cikis: T(12050, 4, 0), net: -50 });
  });
  it("Eylül: iptal dışarıda; tutarı bilinmeyen ödenmiş sipariş 0 eklemez → giris.bilinmeyen 1; sayısal string girer; net TÜRETİLMEZ ('—')", () => {
    const eyl = r.aylar[5];
    expect(eyl).toMatchObject({ key: '2026-09', giris: T(1500, 1, 1), cikis: T(50, 1, 0) });
    expect(ekranTutari(eyl.giris)).toBe(1500);   // giriş hücresi kısmi toplam + "1 kayıt tutarsız" notu
    expect(eyl.net).toBeNaN();                   // 1500 − 50 = 1450 bir "net" değil: bir siparişin tutarı eksik (tamTutar kapısı)
  });
  it('hareketsiz ay GERÇEK sıfırdır (bilinmeyen değil) — ekranTutari 0 basar, "—" değil', () => {
    expect(r.aylar[0]).toEqual({ key: '2026-04', giris: T(0, 0, 0), cikis: T(0, 0, 0), net: 0 });
    expect(ekranTutari(r.aylar[0].giris)).toBe(0);
  });
  it('toplamlar, sayaçlar ve grafik ölçeği (enBuyuk ≥ 1)', () => {
    expect(r.toplamGiris).toEqual(T(13500, 2, 1));
    expect(r.toplamCikis).toEqual(T(12100, 5, 0));
    expect(r.toplamNet).toBeNaN();               // toplamGiris.bilinmeyen 1 → yıl neti türetilmez
    expect(ekranTutari(r.toplamGiris)).toBe(13500);
    expect(r.tarihsiz).toBe(1);
    expect(r.enBuyuk).toBe(12050);
  });
  it("TÜM giriş kayıtları bilinmeyen olan ay: giriş ekranda '—' (NaN), net de NaN — '₺0*' sahte kesinliği YOK", () => {
    const r5 = nakitAkisi([
      { totalPrice: undefined, paid: true, status: 'Delivered', createdAt: '2026-09-02', lineItems: [{ costPrice: 5, quantity: 2 }] },
    ], 1, SIMDI);
    expect(r5.aylar[0].giris).toEqual(T(0, 0, 1));
    expect(ekranTutari(r5.aylar[0].giris)).toBeNaN();
    expect(r5.aylar[0].net).toBeNaN();
    expect(r5.toplamNet).toBeNaN();
    expect(ekranTutari(r5.aylar[0].cikis)).toBe(10);   // çıkış tarafı biliniyor, tek başına basılabilir
  });
  it('satır maliyeti bilinmiyorsa (costPrice yok / quantity NaN) satır 0 sayılmaz; lineItems alanı yoksa sipariş bilinmeyen', () => {
    const r2 = nakitAkisi([
      { totalPrice: 100, paid: false, status: 'Pending', createdAt: '2026-09-02', lineItems: [{ costPrice: undefined, quantity: 3 }, { costPrice: 7, quantity: 2 }, { costPrice: 3, quantity: NaN }] },
      { totalPrice: 100, paid: false, status: 'Pending', createdAt: '2026-09-02' },
    ], 1, SIMDI);
    expect(r2.aylar).toHaveLength(1);
    expect(r2.aylar[0].cikis).toEqual(T(14, 1, 3));
    expect(ekranTutari(r2.aylar[0].cikis)).toBe(14);     // bir bilinen kalem var → çıkış hücresi kısmi basılır (+ not)
    expect(r2.aylar[0].net).toBeNaN();                    // ama 3 kalem maliyetsizken net türetilmez
    expect(r2.toplamCikis.bilinmeyen).toBe(3);
  });
  it('bilinmeyen tutar biçimlerinin hiçbiri 0 sayılmaz', () => {
    const r3 = nakitAkisi(BILINMEYENLER.map(v => ({ totalPrice: v, paid: true, status: 'Delivered', createdAt: '2026-09-02', lineItems: [] })), 1, SIMDI);
    expect(r3.toplamGiris).toEqual(T(0, 0, BILINMEYENLER.length));
    expect(ekranTutari(r3.toplamGiris)).toBeNaN();
  });
  it('boş liste: aylar sıfır, sayaçlar sıfır, enBuyuk 1 (sıfıra bölme yok)', () => {
    const r4 = nakitAkisi([], 6, SIMDI);
    expect(r4.aylar).toHaveLength(6);
    expect(r4.aylar.every(a => a.giris.toplam === 0 && a.cikis.toplam === 0 && a.net === 0)).toBe(true);
    expect(r4).toMatchObject({ toplamGiris: T(0, 0, 0), toplamCikis: T(0, 0, 0), toplamNet: 0, tarihsiz: 0, enBuyuk: 1 });
  });
});

describe('dovizTopla — döviz bakiyelerini TL toplar; kur yoksa ATLAR ve sayar, tutar bilinmiyorsa sayar', () => {
  const kurlar = { USD: 40, EUR: 45 };
  const hesaplar = [
    { bankName: 'İş Bankası', balance: 1000, currency: 'TRY' },
    { bankName: 'Garanti', balance: 100, currency: 'USD' }, // 4.000
    { bankName: 'Ziraat', balance: 10, currency: 'EUR' },   // 450
    { bankName: 'Kasa', balance: 250 },                     // birim yok → TL sayılır (sayfadaki gibi)
  ];
  interface Hesap { balance?: unknown; currency?: unknown }
  const tutar = (h: Hesap) => h.balance;
  const birim = (h: Hesap) => h.currency;

  it('bilinen kurlarla TL toplam', () => {
    expect(dovizTopla(hesaplar, tutar, birim, kurlar)).toEqual({ toplam: 5700, bilinen: 4, bilinmeyen: 0, kurYok: 0, birimler: [] });
  });
  it('kur yoksa o kayıt toplama girmez; kurYok + eksik birimler', () => {
    expect(dovizTopla(hesaplar, tutar, birim, { USD: 40 })).toEqual({ toplam: 5250, bilinen: 3, bilinmeyen: 0, kurYok: 1, birimler: ['EUR'] });
  });
  it('kur tablosu hiç yoksa (null/undefined) döviz kayıtları atlanır, TL kalır', () => {
    expect(dovizTopla(hesaplar, tutar, birim, null)).toEqual({ toplam: 1250, bilinen: 2, bilinmeyen: 0, kurYok: 2, birimler: ['EUR', 'USD'] });
    expect(dovizTopla(hesaplar, tutar, birim, undefined).toplam).toBe(1250);
  });
  it('sıfır / negatif / NaN kur uydurma DEĞİL, "kur yok"', () => {
    for (const k of [0, -1, NaN]) {
      expect(dovizTopla([{ balance: 1, currency: 'USD' }], tutar, birim, { USD: k })).toMatchObject({ toplam: 0, kurYok: 1, birimler: ['USD'] });
    }
  });
  it("tutar bilinmiyorsa (undefined/null/''/NaN) 0 sayılmaz — bilinmeyen sayılır, kurYok DEĞİL", () => {
    const r = dovizTopla([
      { balance: undefined, currency: 'TRY' }, { balance: NaN, currency: 'USD' }, { balance: '', currency: 'EUR' }, { balance: 5, currency: 'TRY' },
    ], tutar, birim, kurlar);
    expect(r).toEqual({ toplam: 5, bilinen: 1, bilinmeyen: 3, kurYok: 0, birimler: [] });
  });
  it("tutarı hiç bilinmeyen liste ekranda '—' (bilinen 0, bilinmeyen > 0)", () => {
    expect(ekranTutari(dovizTopla([{ balance: null }, { balance: '' }], tutar, birim, kurlar))).toBeNaN();
  });
  it('boş liste', () => {
    expect(dovizTopla([], tutar, birim, kurlar)).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0, kurYok: 0, birimler: [] });
  });
});

describe('ticariAlacak — ödenmemiş, iptal olmayan, Cetpa-takipli siparişler + Mikro cari alacak', () => {
  const siparisler = [
    { musteri: 'Şahin İnşaat', totalPrice: 1000, paid: false, status: 'Pending' },
    { musteri: 'Çelik Yapı', totalPrice: 2000, paid: true, status: 'Delivered' },                  // ödenmiş → alacak değil
    { musteri: 'Işık Ltd.', totalPrice: 3000, paid: false, status: 'Cancelled' },                  // iptal
    { musteri: 'Öztürk A.Ş.', totalPrice: 4000, paid: false, status: 'Pending', source: 'mikro-fatura' }, // Mikro: gerçeği cari bakiyede, burada sayılmaz
    { musteri: 'Güneş Yapı', totalPrice: undefined, totalAmount: 500, paid: false, status: 'Pending' },   // totalPrice yok → totalAmount
    { musteri: 'Ünal Tic.', totalPrice: undefined, paid: false, status: 'Pending' },               // ikisi de yok → bilinmeyen
    { musteri: 'Doğan İnş.', totalPrice: 0, totalAmount: 900, paid: false, status: 'Pending' },   // `??`: meşru 0 tutar 0 KALIR (eski `||` 900'e düşürüyordu — e-Mutabakat ile çelişiyordu)
    { musteri: 'Yıldız A.Ş.', totalPrice: 0, paid: false, status: 'Pending' },                     // tek başına 0 → GERÇEK sıfır
  ];
  it('native 1.000 + 500 + 0 + 0, Mikro alacak 7.500 eklenir (bilinen +1); 1 bilinmeyen', () => {
    expect(ticariAlacak(siparisler, 7500)).toEqual({ toplam: 9000, bilinen: 5, bilinmeyen: 1 });
  });
  it('Mikro cari toplamı null/undefined/NaN ise 0 sayılmaz → bilinmeyen +1 (sayfa şu an hep sonlu geçiyor — Açık İşler)', () => {
    for (const v of [null, undefined, NaN]) expect(ticariAlacak(siparisler, v)).toEqual({ toplam: 1500, bilinen: 4, bilinmeyen: 2 });
  });
  it('boş liste + Mikro 0 → gerçek sıfır (Mikro toplamı bilinen 1 kayıt)', () => {
    expect(ticariAlacak([], 0)).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
  });
  it("hiç bilinen sipariş yok + Mikro bilinmiyor → ekranda '—'", () => {
    expect(ekranTutari(ticariAlacak([{ totalPrice: undefined, paid: false, status: 'Pending' }], undefined))).toBeNaN();
  });
});

describe('stokDegeri — stok MALİYETLE (adet × TL maliyet); maliyet ya da adet bilinmiyorsa 0 değil', () => {
  const kalemler = [
    { name: 'Çimento 50kg', stockLevel: 100, maliyetTL: 150 },      // 15.000
    { name: 'İnşaat Demiri', stockLevel: 20, maliyetTL: null },     // kur yok / maliyet yok → bilinmeyen
    { name: 'Kum (m³)', stockLevel: undefined, maliyetTL: 10 },     // adet bilinmiyor → bilinmeyen
    { name: 'Tuğla', stockLevel: 0, maliyetTL: 3 },                 // gerçek sıfır stok
    { name: 'Şap', stockLevel: '40', maliyetTL: 2.5 },              // sayısal string adet → 100
  ];
  it('bilinenler toplanır, bilinmeyenler sayılır', () => {
    expect(stokDegeri(kalemler, k => k.maliyetTL)).toEqual({ toplam: 15100, bilinen: 3, bilinmeyen: 2 });
  });
  it('boş liste', () => {
    expect(stokDegeri([], () => 1)).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });
});

describe('duranVarlik — sabit kıymet net (maliyet − birikmiş amortisman, tabanı 0)', () => {
  const kiymetler = [
    { name: 'Forklift', cost: 500000, depreciation: 120000 },
    { name: 'Kamyon', cost: 900000, depreciation: 1000000 },   // aşırı amortisman → 0, negatif değil
    { name: 'Bilgisayar', cost: undefined, depreciation: 0 },
    { name: 'Vinç', cost: 1000, depreciation: NaN },
  ];
  it('bilinen: 380.000 + 0 (tam amorti); bilinmeyen maliyet/amortisman sayılır', () => {
    expect(duranVarlik(kiymetler)).toEqual({ toplam: 380000, bilinen: 2, bilinmeyen: 2 });
  });
  it('boş liste', () => {
    expect(duranVarlik([])).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });
});

describe('ticariBorc — açık alış siparişleri + Mikro cari borç', () => {
  const alislar = [
    { supplier: 'Akçansa', totalAmount: 10000, status: 'Onay Bekliyor' },
    { supplier: 'İçdaş', totalAmount: 5000, status: 'Teslim Alındı' },          // kapanmış → dışarıda
    { supplier: 'Kale', totalAmount: 7000, status: 'İptal Edildi' },            // iptal → dışarıda
    { supplier: 'Şişecam', totalAmount: undefined, status: 'Sipariş Verildi' }, // bilinmeyen
  ];
  it('10.000 + Mikro 2.500; 1 bilinmeyen', () => {
    expect(ticariBorc(alislar, 2500)).toEqual({ toplam: 12500, bilinen: 2, bilinmeyen: 1 });
  });
  it('Mikro borç yüklenmemişse bilinmeyen +1', () => {
    expect(ticariBorc(alislar, undefined)).toEqual({ toplam: 10000, bilinen: 1, bilinmeyen: 2 });
  });
  it('boş liste', () => {
    expect(ticariBorc([], 0)).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
  });
});

describe('kdvBorcu — faturalı siparişlerin KDV\'si + cari ayın Mikro net KDV\'si (devreden → 0)', () => {
  const siparisler = [
    { faturali: true, kdvTutari: 200 },
    { faturali: true, kdvTutari: 0 },          // gerçek sıfır (istisna)
    { faturali: true, kdvTutari: undefined },  // bilinmeyen — eski `o.faturali && o.kdvTutari` sessizce atıyordu
    { faturali: false, kdvTutari: 999 },       // faturasız → girmez
  ];
  const faturalar = [
    { tarih: '2026-09-02', yon: 'giden', kdv: 1000 },
    { tarih: '2026-09-15', yon: 'gelen', kdv: 300 },
    { tarih: '2026-08-30', yon: 'giden', kdv: 5000 },      // önceki ay → girmez
    { tarih: '2026-09-20', yon: 'giden', kdv: undefined }, // bilinmeyen
  ];
  it('Eylül: 200 + (1000 − 300); bilinmeyen 2 (1 sipariş + 1 fatura)', () => {
    expect(kdvBorcu(siparisler, faturalar, '2026-09')).toEqual({ toplam: 900, bilinen: 4, bilinmeyen: 2, mikroNet: 700 });
  });
  it('devreden KDV (gelen > giden) borç doğurmaz: Mikro payı 0, mikroNet negatif kalır', () => {
    const r = kdvBorcu(siparisler, [
      { tarih: '2026-09-02', yon: 'giden', kdv: 1000 },
      { tarih: '2026-09-15', yon: 'gelen', kdv: 3000 },
    ], '2026-09');
    expect(r).toEqual({ toplam: 200, bilinen: 4, bilinmeyen: 1, mikroNet: -2000 });
  });
  it('tarihi olmayan/boş fatura o aya girmez, sayılmaz', () => {
    expect(kdvBorcu([], [{ tarih: undefined, yon: 'giden', kdv: 100 }, { tarih: '', yon: 'giden', kdv: 100 }], '2026-09')).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0, mikroNet: 0 });
  });
  it('boş listeler', () => {
    expect(kdvBorcu([], [], '2026-09')).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0, mikroNet: 0 });
  });
});

describe('bilanco — Aktif / Pasif / Özkaynak; bilinen/bilinmeyen sayaçları toplanır', () => {
  const g = {
    kasa: T(1000, 1, 0),
    banka: T(5000, 2, 1),
    alacak: T(9000, 3, 0),
    stok: T(15000, 4, 2),
    duranVarlik: T(380000, 1, 0),
    borc: T(12500, 2, 0),
    kdv: T(900, 3, 0),
  };
  const gTam = { ...g, banka: T(5000, 2, 0), stok: T(15000, 4, 0) };   // hiç bilinmeyen kalem yok
  it("toplamlar; 3 kalem bilinmiyorken özkaynak/pasif TÜRETİLMEZ ('—' + \"3 kayıt tutarsız\"); tam veride fark kalemi, Aktif = Pasif", () => {
    const r = bilanco(g);
    expect(r).toMatchObject({ aktif: T(410000, 11, 3), borc: T(13400, 5, 0), bilinen: 16, bilinmeyen: 3 });
    expect(r.ozkaynak).toBeNaN();
    expect(r.toplamPasif).toBeNaN();
    expect(bilanco(gTam)).toEqual({
      aktif: T(410000, 11, 0), borc: T(13400, 5, 0), ozkaynak: 396600, toplamPasif: 410000, bilinen: 16, bilinmeyen: 0,
    });
  });
  it('bilinmeyen 0 ise kesin (not gösterilmez)', () => {
    expect(bilanco({ ...g, banka: T(5000, 2, 0), stok: T(15000, 4, 0) }).bilinmeyen).toBe(0);
  });
  it('borç aktifi aşarsa özkaynak negatif, ama sonlu', () => {
    const r = bilanco({ ...gTam, borc: T(999999, 1, 0) });
    expect(r.ozkaynak).toBeLessThan(0);
    expect(Number.isFinite(r.ozkaynak)).toBe(true);
    expect(r.toplamPasif).toBe(r.aktif.toplam);
  });
  it("Aktif tarafında HİÇ bilinen kayıt yokken özkaynak ve pasif NaN ('—') — '₺0' sahte kesinliği yok", () => {
    const hepsiBilinmiyor = { ...g, kasa: T(0, 0, 1), banka: T(0, 0, 1), alacak: T(0, 0, 1), stok: T(0, 0, 1), duranVarlik: T(0, 0, 1) };
    const r = bilanco(hepsiBilinmiyor);
    expect(r.aktif).toEqual(T(0, 0, 5));
    expect(r.ozkaynak).toBeNaN();
    expect(r.toplamPasif).toBeNaN();
    expect(r.bilinmeyen).toBe(5);
  });
  it('okunamayan Mikro cari bakiye dokümanı (cariBilinmeyen) yalnız tablo sayacına girer — satıra/toplama değil', () => {
    const r = bilanco({ ...gTam, cariBilinmeyen: 2 });
    expect(r.bilinmeyen).toBe(2);
    expect(r.aktif).toEqual(T(410000, 11, 0));
    expect(r.ozkaynak).toBe(396600);                       // cari sayacı özkaynak türetmesini KAPATMAZ (satıra girmez)
    expect(bilanco({ ...g, cariBilinmeyen: 0 }).bilinmeyen).toBe(3);
    expect(bilanco({ ...g, cariBilinmeyen: undefined }).bilinmeyen).toBe(3);
  });
});
