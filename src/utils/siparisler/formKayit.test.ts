import { describe, it, expect } from 'vitest';
import { faturaGovdesi } from '../../server/mikro/govdeFaturaIrsaliye';
import { readFileSync } from 'fs';
import { join } from 'path';
import { yorumsuz } from '../../test/degismezTarayici';
import {
  kdvEtiketi,
  sayiGirdisi,
  miktarDogrula,
  degerDogrula,
  gorunenDeger,
  sevkiyatDegeriKaydi,
  kdvOraniDogrula,
  kdvTurevleri,
  siparisDuzenlemeYamasi,
  yerelTutar,
  yerelSayi,
  girilenMetinYamasi,
  yerelMetin,
} from './formKayit';
import { ulkeSecimiYamasi, etkinUlke, takipAdresi } from './teslimatAdresi';

// Türkçe fikstür — Cetpa inşaat malzemesi toptancısı.
const SIPARIS = {
  id: 'ord-4471',
  customerName: 'Şirin İnşaat Ltd. Şti.',
  shippingAddress: 'Organize Sanayi Bölgesi 7. Cadde No:12, Kayseri',
  status: 'Processing' as const,
  totalPrice: 18_500,
};

// Faturalı sipariş: App.tsx handleAddOrder oluştururken KDV türevlerini de yazmıştı
// (₺12.000 KDV dâhil · %20 → net 10.000 · KDV 2.000).
const FATURALI = {
  ...SIPARIS,
  totalPrice: 12_000,
  faturali: true,
  kdvOran: 20,
  kdvHaricTutar: 10_000,
  kdvTutari: 2_000,
};

describe('kdvEtiketi — bilinmeyen KDV oranı %0 UYDURULMAZ', () => {
  it('sayfa paritesi: bilinen oran birebir aynı sayı', () => {
    expect(kdvEtiketi(20)).toBe('KDV %20');
    expect(kdvEtiketi(10)).toBe('KDV %10');
    expect(kdvEtiketi(1)).toBe('KDV %1');
    expect(kdvEtiketi('20')).toBe('KDV %20'); // sayısal string (Mikro alanları string gelebiliyor)
  });

  it('GERÇEK sıfır oran (ihracat faturası KDV\'siz) "—" DEĞİL, %0 basılır', () => {
    expect(kdvEtiketi(0)).toBe('KDV %0');
  });

  it('oran bilinmiyorsa "KDV —" — mutasyon-ayırt-edici (`?? 0` "KDV %0" uydururdu)', () => {
    expect(kdvEtiketi(undefined)).toBe('KDV —');
    expect(kdvEtiketi(null)).toBe('KDV —');
    expect(kdvEtiketi('')).toBe('KDV —');
    expect(kdvEtiketi('  ')).toBe('KDV —');
    expect(kdvEtiketi('abc')).toBe('KDV —');
    expect(kdvEtiketi(NaN)).toBe('KDV —');
    expect(kdvEtiketi(Infinity)).toBe('KDV —');
  });

  it('negatif oran anlamsız → bilinmiyor sayılır', () => {
    expect(kdvEtiketi(-1)).toBe('KDV —');
  });

  it('Number(...) tuzakları: boş dizi/boolean 0 SAYILMAZ — mutasyon-ayırt-edici', () => {
    // `Number([]) === 0` ve `Number(false) === 0`: `?? 0`/`Number(x)||0` kalıbı bunları %0 yapardı.
    expect(kdvEtiketi([])).toBe('KDV —');
    expect(kdvEtiketi(false)).toBe('KDV —');
  });

  it('ondalıklı oran Türkçe ayraçla yazılır (bilinçli fark: eskiden "18.5")', () => {
    expect(kdvEtiketi(18.5)).toBe('KDV %18,5');
  });
});

describe('sayiGirdisi — <input type="number"> için gösterim değeri', () => {
  it('bilinen sayı olduğu gibi (ondalık ayracı NOKTA — input type=number aksi hâlde alanı boşaltır)', () => {
    expect(sayiGirdisi(18_500)).toBe('18500');
    expect(sayiGirdisi(12_500.5)).toBe('12500.5');
    expect(sayiGirdisi('18500')).toBe('18500');
  });

  it('bilinen 0 gerçek değerdir, gösterilir', () => {
    expect(sayiGirdisi(0)).toBe('0');
  });

  it('bilinmeyen → BOŞ kutu, "0" DEĞİL — mutasyon-ayırt-edici (`?? 0` sahte ₺0 gösteriyordu)', () => {
    expect(sayiGirdisi(undefined)).toBe('');
    expect(sayiGirdisi(null)).toBe('');
    expect(sayiGirdisi('')).toBe('');
    expect(sayiGirdisi(NaN)).toBe('');
    expect(sayiGirdisi('abc')).toBe('');
  });
});

describe('miktarDogrula — depo lokasyonu STOK SEVİYESİ kapısı (işlem miktarı DEĞİL)', () => {
  it('sayfa paritesi: bilinen miktar birebir geçer', () => {
    expect(miktarDogrula('240')).toEqual({ gecerli: true, deger: 240 }); // 240 torba ÇİMENTO 50KG
    expect(miktarDogrula(240)).toEqual({ gecerli: true, deger: 240 });
    expect(miktarDogrula(' 240 ')).toEqual({ gecerli: true, deger: 240 });
    expect(miktarDogrula('2.5')).toEqual({ gecerli: true, deger: 2.5 }); // 2,5 ton DEMİR Ø12
  });

  it('boş alan KAYDEDİLMEZ — mutasyon-ayırt-edici (`Number("") || 0` 0 adet yazıyordu)', () => {
    expect(miktarDogrula('')).toEqual({ gecerli: false, hata: 'miktar_bos' });
    expect(miktarDogrula('   ')).toEqual({ gecerli: false, hata: 'miktar_bos' });
    expect(miktarDogrula(undefined)).toEqual({ gecerli: false, hata: 'miktar_bos' });
    expect(miktarDogrula(null)).toEqual({ gecerli: false, hata: 'miktar_bos' });
    expect(miktarDogrula('abc')).toEqual({ gecerli: false, hata: 'miktar_bos' });
    expect(miktarDogrula(NaN)).toEqual({ gecerli: false, hata: 'miktar_bos' });
    expect(miktarDogrula('Infinity')).toEqual({ gecerli: false, hata: 'miktar_bos' });
  });

  it('GİRİLEN 0 geçerlidir: boş raf / sayımda sıfır gerçek bir stok seviyesidir', () => {
    // Mutasyon-ayırt-edici: `pozitifSayi` kapısı burada 0'ı reddediyordu ve boş raf adresi
    // HİÇ oluşturulamıyordu (tablo 0'ı gösterebiliyor, form üretemiyordu — 2026-09-19 delta).
    expect(miktarDogrula('0')).toEqual({ gecerli: true, deger: 0 });
    expect(miktarDogrula(0)).toEqual({ gecerli: true, deger: 0 });
  });

  it('negatif stok seviyesi KAYDEDİLMEZ (ayrı hata anahtarı: kullanıcı gerçekten yazdı)', () => {
    expect(miktarDogrula('-5')).toEqual({ gecerli: false, hata: 'miktar_negatif' });
    expect(miktarDogrula(-0.5)).toEqual({ gecerli: false, hata: 'miktar_negatif' });
  });
});

describe('degerDogrula — GİRİLEN para değeri kapısı (yinelenen sipariş şablonu tutarı)', () => {
  it('sayfa paritesi: bilinen pozitif değer birebir geçer', () => {
    expect(degerDogrula('42500.75')).toEqual({ gecerli: true, deger: 42500.75 });
    expect(degerDogrula(42_500)).toEqual({ gecerli: true, deger: 42_500 });
  });

  it('boş alan KAYDEDİLMEZ — mutasyon-ayırt-edici (`Number("") || 0` $0 sevkiyat yazıyordu)', () => {
    expect(degerDogrula('')).toEqual({ gecerli: false, hata: 'deger_bos' });
    expect(degerDogrula(undefined)).toEqual({ gecerli: false, hata: 'deger_bos' });
    expect(degerDogrula('abc')).toEqual({ gecerli: false, hata: 'deger_bos' });
  });

  it('0 / negatif değer KAYDEDİLMEZ', () => {
    expect(degerDogrula('0')).toEqual({ gecerli: false, hata: 'deger_pozitif_degil' });
    expect(degerDogrula('-1')).toEqual({ gecerli: false, hata: 'deger_pozitif_degil' });
  });

  it('hata anahtarları miktar kapısından AYRI (toast doğru alanı söyler)', () => {
    const m = miktarDogrula('');
    const d = degerDogrula('');
    expect(m.gecerli).toBe(false);
    expect(d.gecerli).toBe(false);
    if (!m.gecerli && !d.gecerli) expect(m.hata).not.toBe(d.hata);
  });
});

describe('gorunenDeger — hücre ile düzenleme ön-dolumunun ORTAK tanımı', () => {
  it('bilinen pozitif değer gösterilir', () => {
    expect(gorunenDeger(42_500)).toBe(42_500);
    expect(gorunenDeger('42500')).toBe(42_500);
  });

  it('sahte 0 ve bilinmeyen → null (hücrede "—", ön-dolumda BOŞ kutu)', () => {
    // Eski `Number(v) || 0` kaydı $0 yazmıştı; o sıfır bir değer değil, "bilinmiyor"dur.
    expect(gorunenDeger(0)).toBeNull();
    expect(gorunenDeger('0')).toBeNull();
    expect(gorunenDeger(undefined)).toBeNull();
    expect(gorunenDeger(null)).toBeNull();
    expect(gorunenDeger('')).toBeNull();
    expect(gorunenDeger('abc')).toBeNull();
    expect(gorunenDeger(-5)).toBeNull();
  });
});

describe('sevkiyatDegeriKaydi — ihracat sevkiyatı "Değer" alanı (düzenleme KİLİTLENMEZ)', () => {
  it('girilen pozitif değer yazılır (yeni kayıt ve düzenleme)', () => {
    expect(sevkiyatDegeriKaydi('42500.75', undefined, false)).toEqual({ gecerli: true, yama: { value: 42500.75 } });
    expect(sevkiyatDegeriKaydi('42500.75', 0, true)).toEqual({ gecerli: true, yama: { value: 42500.75 } });
  });

  it('YENİ kayıtta boş değer reddedilir (sahte $0 sevkiyat yazılmasın)', () => {
    expect(sevkiyatDegeriKaydi('', undefined, false)).toEqual({ gecerli: false, hata: 'deger_bos' });
  });

  it('DÜZENLEMEDE boş değer kaydı DURDURMAZ: eski sahte 0 açıkça null olur — mutasyon-ayırt-edici', () => {
    // Eski davranışta `value: 0` kaydı düzenlenemiyordu: kapı "0'dan büyük olmalı" deyip
    // updateDoc'u hiç çalıştırmıyordu, sevkiyat 'Gümrükte'ye çekilemiyordu (2026-09-19 delta).
    expect(sevkiyatDegeriKaydi('', 0, true)).toEqual({ gecerli: true, yama: { value: null } });
    expect(sevkiyatDegeriKaydi('   ', 42_500, true)).toEqual({ gecerli: true, yama: { value: null } });
  });

  it('DÜZENLEMEDE boş + önceki de bilinmiyor → alan HİÇ yazılmaz', () => {
    expect(sevkiyatDegeriKaydi('', undefined, true)).toEqual({ gecerli: true, yama: {} });
    expect(sevkiyatDegeriKaydi('', null, true)).toEqual({ gecerli: true, yama: {} });
  });

  it('GİRİLEN 0 / negatif her iki yolda da reddedilir (yazılan değer gerçekten geçersiz)', () => {
    expect(sevkiyatDegeriKaydi('0', 42_500, true)).toEqual({ gecerli: false, hata: 'deger_pozitif_degil' });
    expect(sevkiyatDegeriKaydi('-1', undefined, false)).toEqual({ gecerli: false, hata: 'deger_pozitif_degil' });
  });
});

describe('kdvOraniDogrula — sipariş düzenlemede KDV oranı (bilinmeyen 20 SAYILMAZ)', () => {
  it('bilinen oran geçer; GERÇEK 0 (KDV\'siz ihracat) da geçerlidir', () => {
    expect(kdvOraniDogrula('20')).toEqual({ gecerli: true, deger: 20 });
    expect(kdvOraniDogrula(10)).toEqual({ gecerli: true, deger: 10 });
    expect(kdvOraniDogrula('0')).toEqual({ gecerli: true, deger: 0 });
  });

  it('boş alan HATA DEĞİL, "bilinmiyor"dur (null) — `?? 20` uydurması yasak', () => {
    expect(kdvOraniDogrula('')).toEqual({ gecerli: true, deger: null });
    expect(kdvOraniDogrula(undefined)).toEqual({ gecerli: true, deger: null });
    expect(kdvOraniDogrula('abc')).toEqual({ gecerli: true, deger: null });
  });

  it('aralık dışı oran reddedilir (sunucu gövdesi 0-100 ister)', () => {
    expect(kdvOraniDogrula('-1')).toEqual({ gecerli: false, hata: 'kdv_araligi' });
    expect(kdvOraniDogrula('120')).toEqual({ gecerli: false, hata: 'kdv_araligi' });
  });
});

describe('kdvTurevleri — BAŞLIK tutarından ayrıştırma (kalemsiz / kanal siparişi ve elle değiştirilen tutar)', () => {
  it('PARİTE: faturalı siparişte net = tutar / (1 + oran/100), kdv = tutar − net', () => {
    expect(kdvTurevleri(12_000, 20, true)).toEqual({ kdvHaricTutar: 12_000 / 1.2, kdvTutari: 12_000 - 12_000 / 1.2 });
    expect(kdvTurevleri(12_000, 10, true)).toEqual({ kdvHaricTutar: 12_000 / 1.1, kdvTutari: 12_000 - 12_000 / 1.1 });
  });

  it('PARİTE: faturasızda net = tutar, KDV gerçek 0 (oran sorulmaz)', () => {
    expect(kdvTurevleri(12_000, null, false)).toEqual({ kdvHaricTutar: 12_000, kdvTutari: 0 });
    expect(kdvTurevleri(12_000, 20, false)).toEqual({ kdvHaricTutar: 12_000, kdvTutari: 0 });
  });

  it('BİLİNEN %0 oran gerçek orandır (KDV\'siz ihracat): net = tutar, kdv = 0', () => {
    expect(kdvTurevleri(12_000, 0, true)).toEqual({ kdvHaricTutar: 12_000, kdvTutari: 0 });
  });

  it('girdilerden biri bilinmiyorsa türev HESAPLANMAZ — mutasyon-ayırt-edici', () => {
    expect(kdvTurevleri(null, 20, true)).toEqual({ kdvHaricTutar: null, kdvTutari: null });
    expect(kdvTurevleri(12_000, null, true)).toEqual({ kdvHaricTutar: null, kdvTutari: null });
  });

  it('fatura durumu BİLİNMİYORSA türev yok — hangi formülün geçerli olduğu bilinmiyor', () => {
    // `faturali` alanı olmayan eski/kanal siparişi: `undefined`ı "faturasız" saymak
    // kdvTutari'ye sahte 0 yazardı (bkz. modül başlığı, bilinçli fark).
    expect(kdvTurevleri(12_000, 20, undefined)).toEqual({ kdvHaricTutar: null, kdvTutari: null });
  });
});

describe('siparisDuzenlemeYamasi — TÜRETİLEN KDV alanları bayat KALMAZ', () => {
  it('KDV oranı %20 → %10: türevler yeniden hesaplanır (₺2.000 bayat KDV yaşamaya devam etmez)', () => {
    // Regresyon kapanışı: yama yalnız `kdvOran: 10` yazıyordu; KDV panosu (utils/muhasebe/kdvAylik)
    // hâlâ ₺2.000 sayıyor, Mikro'ya ise %10 gidiyordu — aynı sipariş iki farklı KDV gösteriyordu.
    const yama = siparisDuzenlemeYamasi({ tutarHam: '12000', kdvHam: '10' }, FATURALI);
    expect(yama.kdvOran).toBe(10);
    expect(yama.kdvHaricTutar).toBe(12_000 / 1.1);
    expect(yama.kdvTutari).toBe(12_000 - 12_000 / 1.1);
  });

  it('tutar değişince de türevler yeniden hesaplanır (₺12.000 → ₺24.000, %20)', () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '24000', kdvHam: '20' }, FATURALI);
    expect(yama.totalPrice).toBe(24_000);
    expect(yama.kdvHaricTutar).toBe(24_000 / 1.2);
    expect(yama.kdvTutari).toBe(24_000 - 24_000 / 1.2);
  });

  it('oran SİLİNDİ + önceki türev biliniyor → iki türev de açıkça null (PATCH-merge sessiz no-op olmaz)', () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '12000', kdvHam: '' }, FATURALI);
    expect(yama.kdvOran).toBeNull();
    expect(yama.kdvHaricTutar).toBeNull();
    expect(yama.kdvTutari).toBeNull();
  });

  it('tutar SİLİNDİ → tutar ve iki türev de null', () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '', kdvHam: '20' }, FATURALI);
    expect(yama.totalPrice).toBeNull();
    expect(yama.kdvHaricTutar).toBeNull();
    expect(yama.kdvTutari).toBeNull();
  });

  it('önceki türev BİLİNMİYORSA alan hiç yazılmaz (sahte null yok) — mutasyon-ayırt-edici', () => {
    const yama = siparisDuzenlemeYamasi(
      { tutarHam: '12000', kdvHam: '' },
      { totalPrice: 12_000, kdvOran: 20, faturali: true },
    );
    expect(Object.keys(yama).sort()).toEqual(['kdvOran', 'totalPrice']);
  });

  it('GİRDİ DEĞİŞMEDİYSE türev alanlarına DOKUNULMAZ (yalnız adres düzeltilen kayıt bozulmaz)', () => {
    // Aksi hâlde `faturali` bilinmeyen kanal siparişinde adres düzeltmesi, bilinen
    // kdvHaricTutar/kdvTutari değerlerini null'layarak veri SİLERDİ.
    const yama = siparisDuzenlemeYamasi(
      { shippingAddress: 'OSB 9. Cadde No:3, Kayseri', tutarHam: '12000', kdvHam: '20' },
      FATURALI,
    );
    expect(Object.keys(yama).sort()).toEqual(['kdvOran', 'shippingAddress', 'totalPrice']);
  });

  it('faturasız siparişte türev: net = tutar, KDV 0 (oran alanı boş olsa da)', () => {
    const yama = siparisDuzenlemeYamasi(
      { tutarHam: '15000', kdvHam: '' },
      { ...FATURALI, faturali: false, totalPrice: 12_000, kdvHaricTutar: 12_000, kdvTutari: 0 },
    );
    expect(yama.kdvHaricTutar).toBe(15_000);
    expect(yama.kdvTutari).toBe(0);
  });

  it('fatura durumu bilinmeyen siparişte oran değişirse bayat türev null\'lanır, uydurulmaz', () => {
    const yama = siparisDuzenlemeYamasi(
      { tutarHam: '12000', kdvHam: '10' },
      { totalPrice: 12_000, kdvOran: 20, kdvHaricTutar: 10_000, kdvTutari: 2_000 },
    );
    expect(yama.kdvHaricTutar).toBeNull();
    expect(yama.kdvTutari).toBeNull();
  });

  it('KDV alanı formda YOKSA (kdvHam verilmedi) oran değişmez — tutar değişirse türev yine tazelenir', () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '24000' }, FATURALI);
    expect('kdvOran' in yama).toBe(false);
    expect(yama.kdvHaricTutar).toBe(24_000 / 1.2);
    expect(yama.kdvTutari).toBe(24_000 - 24_000 / 1.2);
  });
});

describe('siparisDuzenlemeYamasi — leadId (siparişi müşteri kaydına bağlama)', () => {
  it('seçilmediyse alan yazılmaz (mevcut bağ korunur)', () => {
    expect('leadId' in siparisDuzenlemeYamasi({ tutarHam: '18500' }, SIPARIS)).toBe(false);
  });

  it('seçildiyse yazılır — lead\'siz siparişin e-İrsaliye kilidini açan TEK yol', () => {
    expect(siparisDuzenlemeYamasi({ tutarHam: '18500', leadId: 'lead-77' }, SIPARIS))
      .toEqual({ totalPrice: 18_500, leadId: 'lead-77' });
  });
});

// NOT: iade (`salesReturns`) tutar kuralları BU MODÜLDE DEĞİL — OrdersPage 1442/2046/3345
// `siparisler/iadeTalep.ts` + `iadeTalep.test.ts`'in kapsamındadır ("iadeTalep" grubu).

describe('siparisDuzenlemeYamasi — totalPrice GİRİLEN alan (girilenAlanYamasi sözleşmesi)', () => {
  it('sayfa paritesi: bilinen tutar birebir yazılır', () => {
    const yama = siparisDuzenlemeYamasi(
      {
        customerName: 'Şirin İnşaat Ltd. Şti.',
        shippingAddress: 'OSB 7. Cadde No:12, Kayseri',
        status: 'Shipped',
        tutarHam: '21750.5',
      },
      SIPARIS,
    );
    expect(yama).toEqual({
      customerName: 'Şirin İnşaat Ltd. Şti.',
      shippingAddress: 'OSB 7. Cadde No:12, Kayseri',
      status: 'Shipped',
      totalPrice: 21750.5,
    });
  });

  it('yalnız verilen alanları yazar — id/createdAt/lineItems geri yazılmaz (bilinçli fark)', () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '18500' }, SIPARIS);
    expect(Object.keys(yama).sort()).toEqual(['totalPrice']);
  });

  it('tutar kutusu BOŞ + önceki tutar BİLİNİYOR → açıkça null (kullanıcı bilerek sildi)', () => {
    // updateDoc sunucuda PATCH-merge: alanı yamaya KOYMAMAK silmeyi sessiz no-op yapardı.
    expect(siparisDuzenlemeYamasi({ tutarHam: '' }, SIPARIS)).toEqual({ totalPrice: null });
    expect(siparisDuzenlemeYamasi({ tutarHam: '   ' }, SIPARIS)).toEqual({ totalPrice: null });
    expect(siparisDuzenlemeYamasi({ tutarHam: 'abc' }, SIPARIS)).toEqual({ totalPrice: null });
  });

  it('tutar kutusu BOŞ + önceki tutar da bilinmiyor → alan HİÇ yazılmaz — mutasyon-ayırt-edici', () => {
    // Eski kod: `(editingOrderData.totalPrice as number) ?? 0` + `Number(e.target.value)`
    // → tutarı bilinmeyen siparişte kutu "0" gösteriyor, kaydedince `totalPrice: 0` yazıyordu.
    expect(siparisDuzenlemeYamasi({ tutarHam: '' }, { totalPrice: undefined })).toEqual({});
    expect(siparisDuzenlemeYamasi({ tutarHam: '' }, { totalPrice: NaN })).toEqual({});
    expect(siparisDuzenlemeYamasi({ tutarHam: '' }, null)).toEqual({});
    expect(siparisDuzenlemeYamasi({ tutarHam: '' }, undefined)).toEqual({});
  });

  it('bilinen 0 tutar gerçek değerdir: yazılır (iptal edilmiş/bedelsiz sevk)', () => {
    expect(siparisDuzenlemeYamasi({ tutarHam: '0' }, SIPARIS)).toEqual({ totalPrice: 0 });
  });

  it('metin alanı verilmediyse yazılmaz; verilen boş metin parite gereği yazılır', () => {
    expect(siparisDuzenlemeYamasi({ customerName: undefined, tutarHam: '18500' }, SIPARIS))
      .toEqual({ totalPrice: 18_500 });
    expect(siparisDuzenlemeYamasi({ customerName: '', tutarHam: '18500' }, SIPARIS))
      .toEqual({ customerName: '', totalPrice: 18_500 });
  });

  it('sevk deposu: seçildiyse yazılır, seçilmediyse alan HİÇ yazılmaz (seçilmişe dönülemez)', () => {
    expect(siparisDuzenlemeYamasi({ tutarHam: '18500', depoNo: 2 }, SIPARIS))
      .toEqual({ totalPrice: 18_500, depoNo: 2 });
    expect(siparisDuzenlemeYamasi({ tutarHam: '18500', depoNo: undefined }, SIPARIS))
      .toEqual({ totalPrice: 18_500 });
  });

  it('KDV oranı GİRİLEN alandır: bilinen yazılır, bilinen 0 yazılır, boş+önceki biliniyor → null', () => {
    expect(siparisDuzenlemeYamasi({ tutarHam: '18500', kdvHam: '10' }, SIPARIS))
      .toEqual({ totalPrice: 18_500, kdvOran: 10 });
    expect(siparisDuzenlemeYamasi({ tutarHam: '18500', kdvHam: '0' }, SIPARIS))
      .toEqual({ totalPrice: 18_500, kdvOran: 0 });
    expect(siparisDuzenlemeYamasi({ tutarHam: '18500', kdvHam: '' }, { ...SIPARIS, kdvOran: 20 }))
      .toEqual({ totalPrice: 18_500, kdvOran: null });
    expect(siparisDuzenlemeYamasi({ tutarHam: '18500', kdvHam: '' }, SIPARIS))
      .toEqual({ totalPrice: 18_500 });
  });
});

// ── Kaynak-tarayan değişmez: "ipucu var olmayan ekranı gösteremez" ───────────
// `irsaliyeNedenMetni('depoYok'|'kdvYok')` kullanıcıyı "siparişi düzenleyip … tamamlayın"
// diye yönlendiriyor. 2026-09-19 delta bulgusu: o alanların bulunduğu TEK form
// (components/EditOrderModal) hiçbir yerden açılamıyordu — `isEditingOrder` state'ini
// `true` yapan satır yoktu — ve OrdersPage'in AÇILABİLEN düzenleme modalında depo/KDV
// alanı yoktu. Yani düğme kalıcı kilitli, yönlendirme karşılıksızdı ("yazıldı ama
// bağlanmadı" sınıfının 4. tekrarı). Bu test o eşleşmeyi kilitler.
//
// TESTİN KENDİSİNİN AÇIĞI (2026-09-19 kapanış incelemesi): ilk sürüm üç düz alt dize arıyordu
// (`toContain('SevkDeposuSecici')` vb.) ve bunları IMPORT SATIRI da sağlıyordu. Mutasyonla
// ölçüldü: JSX bloğu ve `setIsEditingOrder(true)` açıcısı silinince suite YEŞİL kalıyordu —
// yani test tam anlatmak istediği arızayı (form yazıldı ama bağlanmadı) kaçırıyordu. Artık:
//   • yorumlar süzülür (yorumdaki örnek kod iddiayı sağlayamaz) — ORTAK süzgeçle (`src/test/degismezTarayici`);
//     bu dosyadaki yerel düzenli ifade kopyası 2026-10-08'de kalktı,
//   • iddialar JSX kalıbına bağlanır (`<SevkDeposuSecici`, `value={editingKdvHam}`),
//   • iddialar MODAL DİLİMİNDE koşar (import satırı dilimin dışında kalır),
//   • formun AÇILABİLİRLİĞİ ayrıca kilitlenir (`setIsEditingOrder(true)`).
describe('DEĞİŞMEZ: sipariş düzenleme formu, e-İrsaliye ipucunun işaret ettiği alanları içerir', () => {
  const ordersPageYolu = join(__dirname, '..', '..', 'pages', 'OrdersPage.tsx');
  const ordersPage = yorumsuz(ordersPageYolu, readFileSync(ordersPageYolu, 'utf-8')).join('\n');

  /** Düzenleme modalının gövdesi: `{isEditingOrder && (` … `siparisDuzenlemeYamasi(` arası. */
  const modalDilimi = (() => {
    const bas = ordersPage.indexOf('{isEditingOrder && (');
    // Parantezsiz ara: çağrı açık tip argümanı alabilir (`siparisDuzenlemeYamasi<Order['status']>(`).
    const bit = ordersPage.indexOf('siparisDuzenlemeYamasi', bas);
    return bas >= 0 && bit > bas ? ordersPage.slice(bas, bit) : '';
  })();

  it('tarama gerçekten oldu: modal dilimi bulundu ve yamayı kuruyor', () => {
    expect(ordersPage).toContain('siparisDuzenlemeYamasi');
    expect(modalDilimi.length).toBeGreaterThan(0);
  });

  it('form AÇILABİLİR: `setIsEditingOrder(true)` diyen bir tetikleyici var (2026-09-19 arızası)', () => {
    expect(ordersPage).toMatch(/setIsEditingOrder\(true\)/);
  });

  it('düzenleme formunda Sevk Deposu seçicisi ÇİZİLİYOR (depoYok ipucunun karşılığı)', () => {
    expect(modalDilimi).toMatch(/<SevkDeposuSecici\b/);
  });

  it('düzenleme formunda KDV oranı girdisi state\'e BAĞLI (kdvYok ipucunun karşılığı)', () => {
    expect(modalDilimi).toMatch(/value=\{editingKdvHam\}/);
  });

  it('düzenleme formunda BELGE TİPİ seçicisi var (e-Fatura "belge tipi bilinmiyor — siparişi düzenleyin" yönlendirmesinin karşılığı)', () => {
    expect(modalDilimi).toMatch(/faturaTipi/);
    expect(modalDilimi).toMatch(/value="e-fatura"/);
    expect(modalDilimi).toMatch(/value="e-arsiv"/);
  });

  it('düzenleme formu DURUM yazmaz: durum yalnız handleUpdateOrderStatus yolundan değişir (stok düşümü + e-İrsaliye teklifi orada)', () => {
    expect(modalDilimi).not.toMatch(/editingOrderData\.status/);
  });

  it('düzenleme formunda müşteri (cari) seçicisi var (musteriBagliDegil ipucunun karşılığı)', () => {
    expect(modalDilimi).toMatch(/<CustomerCombobox\b/);
  });
});

describe('yerelTutar — ekrandaki sipariş nesnesinin tutarı (Order.totalPrice number)', () => {
  it('yamada yeni tutar varsa o', () => {
    expect(yerelTutar(21_750, 18_500)).toBe(21_750);
  });

  it('yamada alan yoksa önceki korunur', () => {
    expect(yerelTutar(undefined, 18_500)).toBe(18_500);
  });

  it('yamada null (silindi) → NaN, sıfır DEĞİL — mutasyon-ayırt-edici (paraYaz NaN\'ı "—" basar)', () => {
    expect(Number.isNaN(yerelTutar(null, 18_500))).toBe(true);
  });

  it('önceki de bilinmiyorsa NaN', () => {
    expect(Number.isNaN(yerelTutar(undefined, undefined))).toBe(true);
    expect(Number.isNaN(yerelTutar(undefined, 'abc'))).toBe(true);
  });
});

describe('yerelSayi — OPSİYONEL sayı alanı (kdvOran/kdvTutari/kdvHaricTutar): bilinmiyor = alan YOK', () => {
  it('yamada yeni değer varsa o; yamada alan yoksa önceki korunur', () => {
    expect(yerelSayi(10, 20)).toBe(10);
    expect(yerelSayi(undefined, 20)).toBe(20);
  });

  it('bilinen 0 gerçek değerdir (KDV\'siz ihracat)', () => {
    expect(yerelSayi(0, 20)).toBe(0);
  });

  it('BİLİNMEYEN → undefined, NaN DEĞİL — mutasyon-ayırt-edici', () => {
    // `yerelTutar`ın NaN'ı yalnız `Order.totalPrice` (tipi `number`) için doğrudur. Opsiyonel
    // alanda NaN, `JSON.stringify` sonrası `null` olur ve dış sisteme giden gövdede zod'un
    // `z.number().optional()` kapısına takılır: kullanıcı alan-bazlı "KDV oranı eksik"
    // gerekçesi yerine ham şema hatası görürdü (2026-09-19 delta regresyonu).
    expect(yerelSayi(null, 20)).toBeUndefined();
    expect(yerelSayi(undefined, undefined)).toBeUndefined();
    expect(yerelSayi(undefined, NaN)).toBeUndefined();
    expect(yerelSayi(undefined, 'abc')).toBeUndefined();
  });

  it('JSON gövdesinde anahtar HİÇ bulunmaz (null değil) — sunucu şeması opsiyoneli böyle geçer', () => {
    const govde = JSON.stringify({ kdvOran: yerelSayi(undefined, undefined) });
    expect(govde).toBe('{}');
    expect(JSON.parse(govde)).not.toHaveProperty('kdvOran');
  });
});

// 2026-09-19 (kullanıcı kararı "e-Fatura mükellefiyiz"): belge tipi bilinmeyen siparişte e-Fatura gönderimi artık
// "siparişi düzenleyip belge tipini seçin" diyor — o alanı ÜRETEN yüzey düzenleme penceresidir (üretici yüzey şartı).
describe('siparisDuzenlemeYamasi — faturaTipi (belge tipi seçimi)', () => {
  it('geçerli seçim yamaya girer; seçilmediyse (undefined / boş) alan YAZILMAZ — mevcut tip ezilmez', () => {
    expect(siparisDuzenlemeYamasi({ tutarHam: '1000', faturaTipi: 'e-arsiv' }, { totalPrice: 1000 }).faturaTipi).toBe('e-arsiv');
    expect(siparisDuzenlemeYamasi({ tutarHam: '1000', faturaTipi: 'ihracat' }, { totalPrice: 1000 }).faturaTipi).toBe('ihracat');
    expect('faturaTipi' in siparisDuzenlemeYamasi({ tutarHam: '1000' }, { totalPrice: 1000 })).toBe(false);
    expect('faturaTipi' in siparisDuzenlemeYamasi({ tutarHam: '1000', faturaTipi: '' as never }, { totalPrice: 1000 })).toBe(false);
  });
  it('tanınmayan metin yamaya GİRMEZ (DB\'ye bozuk belge tipi yazılmaz) — mutasyon-ayırt-edici', () => {
    expect('faturaTipi' in siparisDuzenlemeYamasi({ tutarHam: '1000', faturaTipi: 'E-FATURA' as never }, { totalPrice: 1000 })).toBe(false);
  });
});

describe('siparisDuzenlemeYamasi — pencereden açılmış kalemli siparişte KDV oranı değişince (2026-10-03 / 10-07)', () => {
  const KALEM = { id: 'k1', sku: 'S1', name: 'A', quantity: 12, price: 250, vatRate: 20, fiyatBirimi: 'kdvHaric', netTutar: 3000, kdv: 600 };
  const DAHIL_KALEM = { id: 'k1', sku: 'S1', name: 'A', quantity: 12, price: 208.333333, vatRate: 20, fiyatBirimi: 'kdvDahil', dahilFiyat: 250, netTutar: 2500, kdv: 500 };
  const HARIC = { totalPrice: 3600, kdvOran: 20, kdvHaricTutar: 3000, kdvTutari: 600, faturali: true, fiyatGirisi: 'kdvHaric', lineItems: [KALEM] };
  const DAHIL = { totalPrice: 3000, kdvOran: 20, kdvHaricTutar: 2500, kdvTutari: 500, faturali: true, fiyatGirisi: 'kdvDahil', lineItems: [DAHIL_KALEM] };

  it('KDV HARİÇ girilmiş: %20 → %10 — MATRAH sabit, toplam ve KDV kalemlerden (eskiden toplam sabit kalıp matrah 3.272,73 oluyordu)', () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '3600', kdvHam: '10' }, HARIC);
    expect(yama).toMatchObject({ kdvOran: 10, totalPrice: 3300, kdvHaricTutar: 3000, kdvTutari: 300 });
    expect(yama.lineItems).toEqual([{ ...KALEM, vatRate: 10, kdv: 300 }]);   // Mikro sipariş gövdesi kalem oranını önce okur
  });
  it('KDV DÂHİL girilmiş: %20 → %10 — YAZILAN TOPLAM sabit (3.000), net birim yazılan birimden yeniden türetilir', () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '3000', kdvHam: '10' }, DAHIL);
    expect(yama).toMatchObject({ kdvOran: 10, totalPrice: 3000, kdvHaricTutar: 2727.27, kdvTutari: 272.73 });
    expect(yama.lineItems).toEqual([{ ...DAHIL_KALEM, price: 227.272727, netTutar: 2727.27, kdv: 272.73, vatRate: 10 }]);
  });
  it('işaret sipariş düzeyindedir ama KURAL kalemin çapasındadır: işaret "kdvDahil", kalem KDV hariç çapalı → matrah sabit', () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '3600', kdvHam: '10' }, { ...HARIC, fiyatGirisi: 'kdvDahil' });
    expect(yama).toMatchObject({ totalPrice: 3300, kdvHaricTutar: 3000, kdvTutari: 300 });
  });
  it('oran DEĞİŞMEDİYSE kalemlere ve türevlere dokunulmaz (yalnız adres düzeltmesi)', () => {
    const yama = siparisDuzenlemeYamasi({ shippingAddress: 'Yeni adres', tutarHam: '3600', kdvHam: '20' }, HARIC);
    expect(yama).toEqual({ shippingAddress: 'Yeni adres', totalPrice: 3600, kdvOran: 20 });   // girilen alanlar aynı değerle; türev / kalem YOK
  });
  it('tutar ELLE de değiştiyse kullanıcının yazdığı TOPLAM geçerlidir (türev başlıktan); kalemler yine yeni oranla yenilenir (bayat kalmaz)', () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '3500', kdvHam: '10' }, HARIC);
    expect(yama).toMatchObject({ totalPrice: 3500, kdvOran: 10, kdvHaricTutar: 3500 / 1.1 });
    expect(yama.lineItems).toEqual([{ ...KALEM, vatRate: 10, kdv: 300 }]);       // satır KDV'si ve oranı yeni orandan; net birim aynı
  });
  it('ÖNCEKİ bir düzenlemede toplam ELLE yazılmışsa (kayıtlı toplam kalemlerin satır tutarlarını tutmuyor) yalnız-oran düzenlemesi onu EZMEZ', () => {
    // 1. düzenleme: pazarlıkla 3.600 → 3.500, oran aynı (başlık yolu; kalem oranı değişmedi → kalemlere dokunulmaz).
    const ilk = siparisDuzenlemeYamasi({ tutarHam: '3500', kdvHam: '20' }, HARIC);
    expect(ilk).toMatchObject({ totalPrice: 3500 });
    expect(ilk.lineItems).toBeUndefined();
    // 2. düzenleme: yalnız oran. Kullanıcının 3.500'ü korunur (kalem yolu 3.300 yazardı); kalemler yeni oranla yenilenir.
    const yama = siparisDuzenlemeYamasi({ tutarHam: '3500', kdvHam: '10' }, { ...HARIC, ...ilk });
    expect(yama).toMatchObject({ totalPrice: 3500, kdvOran: 10, kdvHaricTutar: 3500 / 1.1 });
    expect(yama.lineItems).toEqual([{ ...KALEM, vatRate: 10, kdv: 300 }]);
  });
  // BİLİNEN SINIR (inceleme 2026-10-08, bilinçli — formKayit.ts yorumu): "elle yazıldı" bilgisi ayrı işaret değil, "kayıtlı
  // toplam ≠ Σ kalem" eşitsizliğidir. Elle toplam bir ara oranda Σ kaleme TAM eşit düşerse sipariş kalemden türemiş sayılır.
  it('elle toplam ara oranda Σ kaleme TAM eşitlenirse (3.300 = 3.000 × 1,10) sonraki oran değişikliği toplamı KALEMLERDEN yazar (3.600) — form bunu önceden gösterir', () => {
    const bir = { ...HARIC, ...siparisDuzenlemeYamasi({ tutarHam: '3300', kdvHam: '20' }, HARIC) };          // pazarlık: 3.600 → 3.300
    expect(bir).toMatchObject({ totalPrice: 3300, lineItems: [KALEM] });
    const iki = { ...bir, ...siparisDuzenlemeYamasi({ tutarHam: '3300', kdvHam: '10' }, bir) };              // oran %10: elle toplam korunur
    expect(iki).toMatchObject({ totalPrice: 3300, kdvOran: 10, lineItems: [{ ...KALEM, vatRate: 10, kdv: 300 }] });
    const uc = siparisDuzenlemeYamasi({ tutarHam: '3300', kdvHam: '20' }, iki);                              // oran yeniden %20
    expect(uc).toMatchObject({ totalPrice: 3600, kdvHaricTutar: 3000, kdvTutari: 600 });                     // kalem yolu — yazılan 3.300 DEĞİL
    expect(uc.lineItems).toEqual([KALEM]);
    expect(uc.totalPrice).not.toBe(3300);                                                                    // → duzenlemeTutarOnizleme notu basılır
  });
  it('tesadüf yoksa (elle 3.500) aynı üç adımda elle toplam korunur', () => {
    const bir = { ...HARIC, ...siparisDuzenlemeYamasi({ tutarHam: '3500', kdvHam: '20' }, HARIC) };
    const iki = { ...bir, ...siparisDuzenlemeYamasi({ tutarHam: '3500', kdvHam: '10' }, bir) };
    const uc = siparisDuzenlemeYamasi({ tutarHam: '3500', kdvHam: '20' }, iki);
    expect(uc.totalPrice).toBe(3500);
    expect(uc.lineItems).toEqual([KALEM]);
  });
  it('1 KURUŞLUK elle düzeltme de korunur (karşılaştırma toplam üzerinden, kuruşu kuruşuna)', () => {
    const ilk = siparisDuzenlemeYamasi({ tutarHam: '3600.01', kdvHam: '20' }, HARIC);
    const yama = siparisDuzenlemeYamasi({ tutarHam: '3600.01', kdvHam: '10' }, { ...HARIC, ...ilk });
    expect(yama.totalPrice).toBe(3600.01);
    expect(yama.lineItems).toEqual([{ ...KALEM, vatRate: 10, kdv: 300 }]);
  });
  it('BAŞLIK YOLUNDAN SONRA FATURA KESİLEBİLİR: kalemdeki satır KDV\'si güncel oranla — fatura gövdesi reddetmez (eskiden kalıcı ret)', () => {
    for (const [onceki, form] of [[HARIC, { tutarHam: '3500', kdvHam: '10' }], [DAHIL, { tutarHam: '2900', kdvHam: '10' }]] as const) {
      const yama = siparisDuzenlemeYamasi(form, onceki);
      const kalemler = (yama.lineItems ?? []) as Array<{ sku: string; name: string; price: number; quantity: number; kdv: number; netTutar: number; vatRate: number }>;
      expect(kalemler.length).toBe(1);
      // İstemci satır KDV'sini gönderir; kalem oranı ≠ sipariş oranı ise isteği HİÇ göndermez (App.tsx handleMikroFatura kapısı).
      expect(kalemler[0].vatRate).toBe(yama.kdvOran);
      const satirlar = faturaGovdesi({ mikroCariKod: '120.01.001', faturaTipi: 'e-arsiv', kdvOran: yama.kdvOran, lineItems: kalemler.map(k => ({ sku: k.sku, name: k.name, price: k.price, quantity: k.quantity, kdv: k.kdv })) },
        { vergiTablosu: new Map([[3, 10], [4, 20]]), jumpSurum: 17, simdi: new Date(2026, 9, 8) }).satirlar;
      expect(satirlar.map(x => [x.sth_tutar, x.sth_vergi])).toEqual([[kalemler[0].netTutar, kalemler[0].kdv]]);
    }
  });
  it('KENDİ KENDİNİ ONARIR: kalemler başlık oranına göre bayatsa (eski kayıt) aynı değerlerle yeniden kaydetmek onları yeniler', () => {
    const bayat = { ...HARIC, kdvOran: 10, totalPrice: 3500, kdvHaricTutar: 3500 / 1.1, kdvTutari: 3500 - 3500 / 1.1 };   // kalem hâlâ %20 / kdv 600
    const yama = siparisDuzenlemeYamasi({ tutarHam: '3500', kdvHam: '10' }, bayat);
    expect(yama).toEqual({ totalPrice: 3500, kdvOran: 10, lineItems: [{ ...KALEM, vatRate: 10, kdv: 300 }] });               // başlık türevlerine dokunulmaz
    // Bayat değilse aynı değerlerle kayıt kalemlere dokunmaz.
    expect(siparisDuzenlemeYamasi({ tutarHam: '3600', kdvHam: '20' }, HARIC).lineItems).toBeUndefined();
  });
  it('oran BOŞALTILIP kaydedildikten sonra yeniden girilirse kalem yolu çalışır: toplam hâlâ kalemlerin satır tutarlarından', () => {
    const bosaltilmis = { ...DAHIL, kdvOran: null, kdvHaricTutar: null, kdvTutari: null };
    const yama = siparisDuzenlemeYamasi({ tutarHam: '3000', kdvHam: '10' }, bosaltilmis);
    expect(yama).toMatchObject({ kdvOran: 10, totalPrice: 3000, kdvHaricTutar: 2727.27, kdvTutari: 272.73 });
    expect(yama.lineItems).toEqual([{ ...DAHIL_KALEM, price: 227.272727, netTutar: 2727.27, kdv: 272.73, vatRate: 10 }]);
  });
  it('İŞARETSİZ sipariş (eski / kanal / başka yüzey — kalem anlamı garanti değil): eski yol, kalemlere dokunulmaz', () => {
    const { fiyatGirisi: _isaret, ...isaretsiz } = HARIC;
    const yama = siparisDuzenlemeYamasi({ tutarHam: '3600', kdvHam: '10' }, isaretsiz);
    expect(yama.lineItems).toBeUndefined();
    expect(yama).toMatchObject({ totalPrice: 3600, kdvOran: 10, kdvHaricTutar: 3600 / 1.1 });   // toplam sabit, matrah ondan
  });
  it('satır tutarı YAZILMAMIŞ kalem (işaretli ama eski biçim), faturasız / fatura durumu bilinmeyen sipariş, fiyatı bilinmeyen kalem: eski yol', () => {
    const { netTutar: _n, kdv: _k, ...tutarsiz } = KALEM;
    expect(siparisDuzenlemeYamasi({ tutarHam: '3600', kdvHam: '10' }, { ...HARIC, lineItems: [tutarsiz] }).lineItems).toBeUndefined();
    expect(siparisDuzenlemeYamasi({ tutarHam: '3600', kdvHam: '10' }, { ...HARIC, faturali: false }).lineItems).toBeUndefined();
    expect(siparisDuzenlemeYamasi({ tutarHam: '3600', kdvHam: '10' }, { ...HARIC, faturali: undefined }).lineItems).toBeUndefined();
    expect(siparisDuzenlemeYamasi({ tutarHam: '3600', kdvHam: '10' }, { ...HARIC, lineItems: [{ ...KALEM, price: null }] }).lineItems).toBeUndefined();
    expect(siparisDuzenlemeYamasi({ tutarHam: '3600', kdvHam: '10' }, { ...HARIC, lineItems: [] }).lineItems).toBeUndefined();
  });
  it('oran kutusu BOŞALTILIRSA (bilinmiyor) kalemlere dokunulmaz; türevler açıkça null', () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '3600', kdvHam: '' }, HARIC);
    expect(yama.lineItems).toBeUndefined();
    expect(yama).toMatchObject({ kdvOran: null, kdvHaricTutar: null, kdvTutari: null });
  });
});

// 2026-10-10 — teslimat adresinde ülke / il (kullanıcı isteği 2026-10-09: «şehir ve ülke seçtir droplist»).
describe('girilenMetinYamasi — GİRİLEN metin alanı (il / şehir, ülke): boşaltma açıkça null', () => {
  it('`undefined` (alan formda yok / kilitli) → `{}` — önceki dolu olsa da', () => {
    expect(girilenMetinYamasi('teslimatSehri', undefined, 'Antalya')).toEqual({});
    expect(girilenMetinYamasi('teslimatSehri', undefined, undefined)).toEqual({});
  });

  it('yeni değer → `{ alan: değer }`, KIRPILMIŞ', () => {
    expect(girilenMetinYamasi('teslimatSehri', 'Antalya', undefined)).toEqual({ teslimatSehri: 'Antalya' });
    expect(girilenMetinYamasi('teslimatSehri', '  Berlin ', 'Antalya')).toEqual({ teslimatSehri: 'Berlin' });
    expect(girilenMetinYamasi('teslimatSehri', 'Antalya', null)).toEqual({ teslimatSehri: 'Antalya' });
  });

  it('aynı değer → `{}` (karşılaştırma kırpılmış değerlerle; aynı değer geri yazılmaz)', () => {
    expect(girilenMetinYamasi('teslimatSehri', 'Antalya', 'Antalya')).toEqual({});
    expect(girilenMetinYamasi('teslimatSehri', ' Antalya ', 'Antalya')).toEqual({});
    expect(girilenMetinYamasi('teslimatSehri', 'Antalya', ' Antalya ')).toEqual({});
  });

  it('boş + önceki DOLU → `{ alan: null }` — mutasyon-ayırt-edici (alanı yamaya koymamak PATCH-merge\'de silmeyi no-op yapardı)', () => {
    expect(girilenMetinYamasi('teslimatSehri', '', 'Antalya')).toEqual({ teslimatSehri: null });
    expect(girilenMetinYamasi('teslimatSehri', '   ', 'Antalya')).toEqual({ teslimatSehri: null });
  });

  it('boş + önceki boş / yalnız boşluk / `null` / yok / metin değil → `{}` (sahte null yazılmaz)', () => {
    for (const onceki of ['', '   ', null, undefined, 7, {}]) {
      expect(girilenMetinYamasi('teslimatSehri', '', onceki), String(onceki)).toEqual({});
    }
  });

  it('alan adı yama anahtarıdır', () => {
    expect(Object.keys(girilenMetinYamasi('teslimatUlke', 'DE', 'TR'))).toEqual(['teslimatUlke']);
  });
});

describe('siparisDuzenlemeYamasi — teslimatUlke / teslimatSehri (yalnız DEĞİŞEN yazılır)', () => {
  it('ESKİ kayıt (`teslimatUlke` yok) açılıp yalnız not / tutar değişince yamada `teslimatUlke` YOK — sessiz \'TR\' yazılmaz', () => {
    // Seçici hiç boş olmaz: eski kayıtta 'Türkiye' GÖSTERİLİR. Form ister kayıttaki ham değeri (undefined), ister
    // görünen 'TR'yi versin, yamaya ülke girmez.
    for (const formUlke of [undefined, 'TR']) {
      const yama = siparisDuzenlemeYamasi({ shippingAddress: SIPARIS.shippingAddress, tutarHam: '19000', teslimatUlke: formUlke, teslimatSehri: '' }, SIPARIS);
      expect(yama, String(formUlke)).toEqual({ shippingAddress: SIPARIS.shippingAddress, totalPrice: 19_000 });
      expect('teslimatUlke' in yama, String(formUlke)).toBe(false);
      expect('teslimatSehri' in yama, String(formUlke)).toBe(false);
    }
  });

  it('kayıtta `teslimatUlke: null` / geçersiz kod da \'TR\' sayılır: \'TR\' seçili form değişiklik DEĞİL', () => {
    for (const kayittaki of [null, '', 'tr']) {
      const yama = siparisDuzenlemeYamasi({ tutarHam: '18500', teslimatUlke: 'TR', teslimatSehri: '' }, { ...SIPARIS, teslimatUlke: kayittaki });
      expect('teslimatUlke' in yama, String(kayittaki)).toBe(false);
    }
  });

  it("ülke TR → DE ve önceki il dolu → `teslimatUlke: 'DE'` + `teslimatSehri: null` (form ili boşaltır: `ulkeSecimiYamasi`)", () => {
    const onceki = { ...SIPARIS, teslimatUlke: 'TR', teslimatSehri: 'Kayseri' };
    const form = { teslimatUlke: onceki.teslimatUlke, teslimatSehri: onceki.teslimatSehri, ...ulkeSecimiYamasi(onceki.teslimatUlke, 'DE') };
    const yama = siparisDuzenlemeYamasi({ tutarHam: '18500', ...form }, onceki);
    expect(yama).toEqual({ totalPrice: 18_500, teslimatUlke: 'DE', teslimatSehri: null });
  });

  it("eski kayıtta (ülke alanı yok) ülke DE seçilince `teslimatUlke: 'DE'` yazılır; il zaten boşsa il anahtarı YOK", () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '18500', teslimatUlke: 'DE', teslimatSehri: '' }, SIPARIS);
    expect(yama).toEqual({ totalPrice: 18_500, teslimatUlke: 'DE' });
  });

  it("DE → TR: `teslimatUlke: 'TR'` AÇIKÇA yazılır (kayıtta 'DE' kalmasın)", () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '18500', teslimatUlke: 'TR', teslimatSehri: '' }, { ...SIPARIS, teslimatUlke: 'DE', teslimatSehri: 'Berlin' });
    expect(yama).toEqual({ totalPrice: 18_500, teslimatUlke: 'TR', teslimatSehri: null });
  });

  it("il seçimi → `teslimatSehri: 'Antalya'` + alanı olmayan kayıtta `teslimatUlke: 'TR'` AÇIKÇA (adrese dokunuldu); aynı il yeniden kaydedilince ikisi de yazılmaz", () => {
    expect(siparisDuzenlemeYamasi({ tutarHam: '18500', teslimatUlke: 'TR', teslimatSehri: 'Antalya' }, SIPARIS))
      .toEqual({ totalPrice: 18_500, teslimatSehri: 'Antalya', teslimatUlke: 'TR' });
    expect(siparisDuzenlemeYamasi({ tutarHam: '18500', teslimatUlke: 'TR', teslimatSehri: 'Antalya' }, { ...SIPARIS, teslimatUlke: 'TR', teslimatSehri: 'Antalya' }))
      .toEqual({ totalPrice: 18_500 });
  });

  it('il boşaltma (önceki dolu) → açıkça `null`; önceki `null` iken boş il yazılmaz', () => {
    expect(siparisDuzenlemeYamasi({ tutarHam: '18500', teslimatUlke: 'TR', teslimatSehri: '' }, { ...SIPARIS, teslimatUlke: 'TR', teslimatSehri: 'Antalya' }))
      .toEqual({ totalPrice: 18_500, teslimatSehri: null });
    expect(siparisDuzenlemeYamasi({ tutarHam: '18500', teslimatUlke: 'TR', teslimatSehri: '' }, { ...SIPARIS, teslimatUlke: 'TR', teslimatSehri: null }))
      .toEqual({ totalPrice: 18_500 });
  });

  it('MAĞAZA KİLİDİ (iki alan `undefined` verilir) → iki anahtar yamada BULUNMAZ; kayıttaki «ilçe / il» ve ülke ezilmez', () => {
    const magaza = { ...SIPARIS, source: 'shopify_webhook', teslimatSehri: 'Çankaya / Ankara', teslimatUlke: 'DE' };
    const yama = siparisDuzenlemeYamasi({ tutarHam: '18500', teslimatUlke: undefined, teslimatSehri: undefined }, magaza);
    expect(yama).toEqual({ totalPrice: 18_500 });
    expect('teslimatUlke' in yama).toBe(false);
    expect('teslimatSehri' in yama).toBe(false);
  });

  it('adres alanları KDV türevlerini TETİKLEMEZ: yalnız il değişen faturalı siparişte türevlere dokunulmaz', () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '12000', kdvHam: '20', teslimatUlke: 'TR', teslimatSehri: 'Kayseri' }, FATURALI);
    // İl yaması var → adrese dokunuldu: alanı olmayan kayıtta ülke de açıkça yazılır; KDV türevleri yamada YOK.
    expect(yama).toEqual({ totalPrice: 12_000, kdvOran: 20, teslimatSehri: 'Kayseri', teslimatUlke: 'TR' });
  });

  it('oran değişen yolda da (türev dalı) adres yaması korunur', () => {
    const yama = siparisDuzenlemeYamasi({ tutarHam: '12000', kdvHam: '10', teslimatUlke: 'DE', teslimatSehri: 'Berlin' }, FATURALI);
    expect(yama).toMatchObject({ kdvOran: 10, teslimatUlke: 'DE', teslimatSehri: 'Berlin' });
    expect(yama.kdvHaricTutar).toBeCloseTo(12_000 / 1.1, 6);
  });
});

// İnceleme 2026-10-10 (gizlilik — yüksek). Kimliksiz `GET /api/track/:orderId` kaydı «yapısal» sayınca adresi YALNIZ il +
// ülkeden kurar; değilse eski «son iki parça» maskesi `shippingAddress`'i okur. Ülke yalnız etkin değeri değişince
// yazılırken, alanı olmayan eski kayıtta adres yeni etikete göre («ilçe, mahalle, sokak») yeniden yazılıp il boş
// bırakılınca — ya da il sonradan boşaltılınca — kayıt yapısal olmuyor / olmaktan çıkıyor, maske de «kalan»ın sokak /
// kapı / daire düzeyini dışarı veriyordu. Burada sınanan ZİNCİRDİR: yama + `takipAdresi` + eski maske birlikte.
describe('siparisDuzenlemeYamasi + takipAdresi — adrese DOKUNULAN kayıt kalıcı yapısal olur («kalan» dışarı çıkmaz)', () => {
  /** `server.ts` `maskAddress` gövdesinin eşi (giriş dosyası içe aktarılamıyor); asıl gövde
   *  `src/server/teslimatAdresi.degismez.test.ts`'te satır satır sabit. */
  const eskiMaske = (addr: unknown): string | null => {
    if (typeof addr !== 'string' || !addr.trim()) return null;
    const parts = addr.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length <= 2) return parts.join(', ') || null;
    return parts.slice(-2).join(', ');
  };
  /** Takip ucunun yanıtındaki `shippingAddress` (server.ts: `adres.yapisal ? adres.metin : maskAddress(o.shippingAddress)`). */
  const takipYaniti = (kayit: Record<string, unknown>): string | null => {
    const adres = takipAdresi(kayit);
    return adres.yapisal ? adres.metin : eskiMaske(kayit.shippingAddress);
  };
  type Kayit = Record<string, unknown>;
  interface Form { shippingAddress?: string; teslimatUlke?: unknown; teslimatSehri: string }
  /** «Siparişi Düzenle» kaydı: OrdersPage'in yama çağrısının eşi (ülke forma `etkinUlke` ile verilir) + PATCH-merge.
   *  `tutarHam` tutar kutusunun metnidir; fikstürdeki tutarla aynı ('1000') → adres dışında değişiklik yok. */
  const kaydet = (kayit: Kayit, form: Form, tutarHam: string = '1000'): { yama: Kayit; kayit: Kayit } => {
    const yama: Kayit = { ...siparisDuzenlemeYamasi({
      shippingAddress: form.shippingAddress, teslimatUlke: etkinUlke(form.teslimatUlke), teslimatSehri: form.teslimatSehri, tutarHam,
    }, kayit) };
    return { yama, kayit: { ...kayit, ...yama } };
  };
  /** Sokak düzeyi parçalar — yanıtta HİÇBİRİ geçmemeli. */
  const SOKAK = ['Yenigün', '1063', 'No:4', 'D:7', 'Muratpaşa'];
  const sizmadi = (yanit: string | null) => { for (const parca of SOKAK) expect(String(yanit), parca).not.toContain(parca); };

  const ESKI: Kayit = { customerName: 'Şirin Yapı', totalPrice: 1000, shippingAddress: 'Yenigün Mah. 1063 Sok. No:4 D:7, Muratpaşa, Antalya' };
  const KALAN = 'Muratpaşa, Yenigün Mah. 1063 Sok. No:4 D:7';

  it('düzenek: eski kayıt (alan yok) bugün eski maskeden geçer — «ilçe, il» kuyruğu', () => {
    expect(takipYaniti(ESKI)).toBe('Muratpaşa, Antalya');
    // Düzeltmenin kapattığı delik: aynı kayıtta adres «kalan»a çevrilip yapısal alan YAZILMASAYDI maske sokağı verirdi.
    expect(takipYaniti({ ...ESKI, shippingAddress: KALAN })).toBe(KALAN);
  });

  it("alanı olmayan kayıt + adres DEĞİŞTİ + il BOŞ → yamada `teslimatUlke: 'TR'`; takip yanıtı null, kalanın hiçbir parçası yok", () => {
    const { yama, kayit } = kaydet(ESKI, { shippingAddress: KALAN, teslimatUlke: undefined, teslimatSehri: '' });
    expect(yama).toMatchObject({ shippingAddress: KALAN, teslimatUlke: 'TR' });
    expect('teslimatSehri' in yama).toBe(false);
    expect(takipAdresi(kayit)).toEqual({ yapisal: true, metin: null });
    expect(takipYaniti(kayit)).toBeNull();
    sizmadi(takipYaniti(kayit));
  });

  it('ADRESSİZ eski kayıtta adres ilk kez girildi + il boş → aynı: ülke açıkça yazılır, yanıt null', () => {
    const { yama, kayit } = kaydet({ customerName: 'Şirin Yapı', totalPrice: 1000 }, { shippingAddress: KALAN, teslimatUlke: undefined, teslimatSehri: '' });
    expect(yama.teslimatUlke).toBe('TR');
    expect(takipYaniti(kayit)).toBeNull();
  });

  it("il seçildi → yanıt yalnız il; sonra il BOŞALTILDI (doğrudan ya da ülke DE → TR ile) → yanıt null, eski maskeye GERİ DÜŞMEZ", () => {
    const b1 = kaydet(ESKI, { shippingAddress: 'Muratpaşa, Yenigün Mah., 1063 Sok. No:4 D:7', teslimatUlke: undefined, teslimatSehri: 'Antalya' });
    expect(b1.yama).toMatchObject({ teslimatSehri: 'Antalya', teslimatUlke: 'TR' });
    expect(takipYaniti(b1.kayit)).toBe('Antalya');

    // İl kutusu doğrudan boşaltıldı: ülke kayıtta artık YAZILI olduğu için yeniden yazılmaz; kayıt yapısal kalır.
    const b2 = kaydet(b1.kayit, { shippingAddress: String(b1.kayit.shippingAddress), teslimatUlke: b1.kayit.teslimatUlke, teslimatSehri: '' });
    expect(b2.yama).toMatchObject({ teslimatSehri: null });
    expect('teslimatUlke' in b2.yama).toBe(false);
    expect(takipYaniti(b2.kayit)).toBeNull();
    sizmadi(takipYaniti(b2.kayit));

    // Ülke DE seçilip TR'ye geri alındı: form ili boşaltır (`ulkeSecimiYamasi`), etkin ülke yine 'TR'.
    let form: { teslimatUlke?: unknown; teslimatSehri?: unknown } = { teslimatUlke: b1.kayit.teslimatUlke, teslimatSehri: b1.kayit.teslimatSehri };
    form = { ...form, ...ulkeSecimiYamasi(form.teslimatUlke, 'DE') };
    form = { ...form, ...ulkeSecimiYamasi(form.teslimatUlke, 'TR') };
    expect(form).toEqual({ teslimatUlke: 'TR', teslimatSehri: '' });
    const b3 = kaydet(b1.kayit, { shippingAddress: String(b1.kayit.shippingAddress), teslimatUlke: form.teslimatUlke, teslimatSehri: '' });
    expect(takipYaniti(b3.kayit)).toBeNull();
    sizmadi(takipYaniti(b3.kayit));
  });

  it("ili dolu ama ülke alanı OLMAYAN kayıtta il boşaltılınca `teslimatSehri: null` + `teslimatUlke: 'TR'` — mutasyon-ayırt-edici", () => {
    // Yalnız il `null`'lanıp ülke yazılmasaydı iki yapısal alan da boş kalır, kayıt eski maskeye düşerdi.
    const ilYalniz: Kayit = { ...ESKI, shippingAddress: 'Muratpaşa, Yenigün Mah., 1063 Sok. No:4 D:7', teslimatSehri: 'Antalya' };
    expect(takipYaniti(ilYalniz)).toBe('Antalya');
    const { yama, kayit } = kaydet(ilYalniz, { shippingAddress: String(ilYalniz.shippingAddress), teslimatUlke: undefined, teslimatSehri: '' });
    expect(yama).toMatchObject({ teslimatSehri: null, teslimatUlke: 'TR' });
    expect(takipYaniti(kayit)).toBeNull();
    sizmadi(takipYaniti(kayit));
  });

  it("kayıtta `teslimatUlke` `null` / '' / geçersiz ('tr') iken adrese dokunulunca 'TR' AÇIKÇA yazılır", () => {
    for (const kayittaki of [null, '', 'tr']) {
      const { yama } = kaydet({ ...ESKI, teslimatUlke: kayittaki }, { shippingAddress: KALAN, teslimatUlke: kayittaki, teslimatSehri: '' });
      expect(yama.teslimatUlke, String(kayittaki)).toBe('TR');
    }
  });

  it('KORUMA: adrese dokunulmadıysa (yalnız tutar / müşteri değişti) yamada ülke YOK; yanıt eski maskeyle birebir', () => {
    const { yama, kayit } = kaydet(ESKI, { shippingAddress: String(ESKI.shippingAddress), teslimatUlke: undefined, teslimatSehri: '' }, '1200');
    expect(yama).toEqual({ shippingAddress: ESKI.shippingAddress, totalPrice: 1200 });
    expect(takipYaniti(kayit)).toBe('Muratpaşa, Antalya');
    // Baş / son boşluk değişiklik DEĞİLDİR (karşılaştırma kırpılmış metinle).
    const bosluklu = kaydet(ESKI, { shippingAddress: `  ${String(ESKI.shippingAddress)} `, teslimatUlke: undefined, teslimatSehri: '   ' });
    expect('teslimatUlke' in bosluklu.yama).toBe(false);
    // Adres formda HİÇ yoksa (alan verilmedi) dokunulmuş sayılmaz.
    expect('teslimatUlke' in kaydet(ESKI, { teslimatUlke: undefined, teslimatSehri: '' }).yama).toBe(false);
  });

  it('KORUMA: ülkesi YAZILI kayıtta adres / il değişince aynı kod geri yazılmaz (PATCH-merge ezme riski)', () => {
    const almanya: Kayit = { ...ESKI, shippingAddress: 'Hauptstr. 5', teslimatSehri: 'Berlin', teslimatUlke: 'DE' };
    const adres = kaydet(almanya, { shippingAddress: 'Hauptstr. 7', teslimatUlke: 'DE', teslimatSehri: 'Berlin' });
    expect('teslimatUlke' in adres.yama).toBe(false);
    expect(takipYaniti(adres.kayit)).toBe('Berlin, Almanya');
    const sehir = kaydet(almanya, { shippingAddress: 'Hauptstr. 5', teslimatUlke: 'DE', teslimatSehri: 'Hamburg' });
    expect(sehir.yama).toMatchObject({ teslimatSehri: 'Hamburg' });
    expect('teslimatUlke' in sehir.yama).toBe(false);
  });

  it('KORUMA: mağaza kilidi (adres, ülke, il `undefined`) → dokunma sayılmaz, üç anahtar da yamada YOK', () => {
    const magaza: Kayit = { ...ESKI, source: 'shopify_webhook', teslimatSehri: 'Muratpaşa / Antalya' };
    const yama = siparisDuzenlemeYamasi({ shippingAddress: undefined, teslimatUlke: undefined, teslimatSehri: undefined, tutarHam: '1000' }, magaza);
    for (const alan of ['shippingAddress', 'teslimatUlke', 'teslimatSehri']) expect(alan in yama, alan).toBe(false);
  });
});

describe('yerelMetin — ekrandaki siparişin OPSİYONEL metin alanı (Order tipi `string`)', () => {
  it('yamada `null` (boşaltıldı) → `undefined` — mutasyon-ayırt-edici (`{ ...o, ...yama }` null\'ı Order\'a taşırdı)', () => {
    expect(yerelMetin(null, 'Antalya')).toBeUndefined();
  });

  it('yamada alan yok (`undefined`) → önceki korunur; önceki metin değilse (`null`, yok) `undefined`', () => {
    expect(yerelMetin(undefined, 'Antalya')).toBe('Antalya');
    expect(yerelMetin(undefined, undefined)).toBeUndefined();
    expect(yerelMetin(undefined, null)).toBeUndefined();
  });

  it('yamada değer → o değer', () => {
    expect(yerelMetin('Kayseri', 'Antalya')).toBe('Kayseri');
    expect(yerelMetin('DE', undefined)).toBe('DE');
  });

  it('JSON gövdesinde anahtar HİÇ bulunmaz (null değil)', () => {
    expect(JSON.stringify({ teslimatSehri: yerelMetin(null, 'Antalya') })).toBe('{}');
  });
});
