import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
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
} from './formKayit';

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

describe('kdvTurevleri — oluşturma formülünün (App.tsx handleAddOrder) TEK kopyası', () => {
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
//   • yorumlar süzülür (yorumdaki örnek kod iddiayı sağlayamaz),
//   • iddialar JSX kalıbına bağlanır (`<SevkDeposuSecici`, `value={editingKdvHam}`),
//   • iddialar MODAL DİLİMİNDE koşar (import satırı dilimin dışında kalır),
//   • formun AÇILABİLİRLİĞİ ayrıca kilitlenir (`setIsEditingOrder(true)`).
/** Kaynaktan yorumları süzer: yorumdaki örnek kod bir değişmezi sağlamamalı. */
function yorumsuz(kaynak: string): string {
  return kaynak
    .replace(/\/\*[\s\S]*?\*\//g, ' ')        // blok yorum (JSX üstündeki gerekçe blokları)
    .replace(/^[ \t]*\/\/.*$/gm, '');         // satır başındaki // yorum
}

describe('DEĞİŞMEZ: sipariş düzenleme formu, e-İrsaliye ipucunun işaret ettiği alanları içerir', () => {
  const ordersPage = yorumsuz(readFileSync(join(__dirname, '..', '..', 'pages', 'OrdersPage.tsx'), 'utf-8'));

  /** Düzenleme modalının gövdesi: `{isEditingOrder && (` … `siparisDuzenlemeYamasi(` arası. */
  const modalDilimi = (() => {
    const bas = ordersPage.indexOf('{isEditingOrder && (');
    const bit = ordersPage.indexOf('siparisDuzenlemeYamasi(', bas);
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
