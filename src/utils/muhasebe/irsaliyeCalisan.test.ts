import { describe, it, expect } from 'vitest';
import { irsaliyeToplami, adediBilinmeyenKalem, depodakiAdet, formSayisi, girilenAlanYamasi, irsaliyeToplamYamasi, gorunenTutar, pozitifSayi } from './irsaliyeCalisan';

const kalem = (quantity: unknown, unitPrice: unknown, taxRate: unknown) => ({ quantity, unitPrice, taxRate });

describe('irsaliyeToplami — KDV dâhil toplam kalemlerden TÜRETİLİR', () => {
  it('sayfa paritesi: Σ miktar × birim fiyat × (1 + KDV/100)', () => {
    // ÇİMENTO 50KG 100 torba × ₺180 (%20) + DEMİR Ø12 2 ton × ₺25.000 (%20)
    expect(irsaliyeToplami([kalem(100, 180, 20), kalem(2, 25000, 20)])).toBeCloseTo(100 * 180 * 1.2 + 2 * 25000 * 1.2, 6);
  });

  it('KDV oranı bilinen 0 → KDV\'siz toplam (tutarsız değil)', () => {
    expect(irsaliyeToplami([kalem(10, 50, 0)])).toBe(500);
  });

  it('kalemsiz irsaliye: toplam BİLİNMİYOR (eski kod ₺0 kaydediyordu) — mutasyon-ayırt-edici', () => {
    expect(irsaliyeToplami([])).toBeNull();
  });

  it('bir kalemin fiyatı bilinmiyorsa toplam türetilemez (kısmi toplam KAYDEDİLMEZ)', () => {
    expect(irsaliyeToplami([kalem(100, 180, 20), kalem(5, null, 20)])).toBeNull();
    expect(irsaliyeToplami([kalem(100, 180, 20), kalem(5, NaN, 20)])).toBeNull();
    expect(irsaliyeToplami([kalem(100, 180, 20), kalem(5, '', 20)])).toBeNull();
  });

  it('miktarı ya da KDV oranı bilinmeyen kalem de toplamı düşürür', () => {
    expect(irsaliyeToplami([kalem(undefined, 180, 20)])).toBeNull();
    expect(irsaliyeToplami([kalem(3, 180, NaN)])).toBeNull();
  });

  it('null * miktar === 0 tuzağı: fiyat null iken toplam 0 DEĞİL null', () => {
    expect(irsaliyeToplami([kalem(4, null, 20)])).not.toBe(0);
  });
});

describe('adediBilinmeyenKalem — stok entegrasyonuna NaN gitmesin', () => {
  it('miktarı okunamayan kalemleri sayar (boşaltılmış sayı alanı NaN üretir)', () => {
    expect(adediBilinmeyenKalem([kalem(1, 1, 20), kalem(NaN, 1, 20), kalem(null, 1, 20), kalem('', 1, 20)])).toBe(3);
  });
  it('hepsi biliniyorsa 0; bilinen 0 adet bilinmeyen DEĞİL', () => {
    expect(adediBilinmeyenKalem([kalem(0, 1, 20), kalem('12', 1, 20)])).toBe(0);
  });
});

describe('depodakiAdet — Mikro ürününün o depodaki miktarı (depoBreakdown)', () => {
  it('anahtar yoksa ürün o depoda YOK: gerçek 0', () => {
    expect(depodakiAdet({ '2': 40 }, '1')).toBe(0);
    expect(depodakiAdet(null, '1')).toBe(0);
    expect(depodakiAdet(undefined, '1')).toBe(0);
    expect(depodakiAdet({ '1': 5 }, null)).toBe(0);
  });
  it('bilinen miktar aynen döner (sayısal string kabul)', () => {
    expect(depodakiAdet({ '2': 40 }, '2')).toBe(40);
    expect(depodakiAdet({ '2': '12.5' }, '2')).toBe(12.5);
  });
  it('anahtar VAR ama sayı okunamıyor → NaN (eski kod 0 sayıp kalemi depodan SESSİZCE düşürüyordu) — mutasyon-ayırt-edici', () => {
    expect(depodakiAdet({ '2': 'abc' }, '2')).toBeNaN();
    expect(depodakiAdet({ '2': null }, '2')).toBeNaN();
  });
});

describe('formSayisi — sayı alanı: boş = bilinmiyor', () => {
  it('boş / boşluk / sayı olmayan → null (eski `Number(\'\')` === 0 kaydediyordu)', () => {
    expect(formSayisi('')).toBeNull();
    expect(formSayisi('   ')).toBeNull();
    expect(formSayisi('abc')).toBeNull();
    expect(formSayisi(undefined)).toBeNull();
    expect(formSayisi(null)).toBeNull();
    expect(formSayisi(NaN)).toBeNull();
  });
  it('bilinen sayı (0 dâhil) aynen', () => {
    expect(formSayisi('0')).toBe(0);
    expect(formSayisi('45000')).toBe(45000);
    expect(formSayisi(32500.5)).toBe(32500.5);
  });
});

describe('girilenAlanYamasi — kullanıcının GİRDİĞİ sayı alanı (maaş, kredi limiti, bakiye)', () => {
  it('bilinen değer aynen yazılır (0 dâhil)', () => {
    expect(girilenAlanYamasi('salary', 45000, undefined)).toEqual({ salary: 45000 });
    expect(girilenAlanYamasi('salary', 0, 45000)).toEqual({ salary: 0 });
  });
  it('yeni kayıtta / önceden de bilinmeyen alanda boş değer HİÇ yazılmaz (sahte ₺0 da, gereksiz null da yok)', () => {
    expect(girilenAlanYamasi('salary', null, undefined)).toEqual({});
    expect(girilenAlanYamasi('salary', null, null)).toEqual({});
    expect(girilenAlanYamasi('salary', null, NaN)).toEqual({});
  });
  it('önceden BİLİNEN değeri kullanıcı boşalttıysa açıkça null yazılır — yoksa PATCH-merge eski maaşı korur, silme sessiz no-op olur (mutasyon-ayırt-edici)', () => {
    expect(girilenAlanYamasi('salary', null, 50000)).toEqual({ salary: null });
    expect(girilenAlanYamasi('creditLimit', null, 0)).toEqual({ creditLimit: null }); // eski sahte-sıfır kaydı da temizlenebilir
    expect(girilenAlanYamasi('balance', null, '1200')).toEqual({ balance: null });
  });
});

describe('irsaliyeToplamYamasi — TÜRETİLEN alan: girdiler değişince eski türev yanlış olur', () => {
  const k = (quantity: unknown, unitPrice: unknown, taxRate: unknown) => ({ quantity, unitPrice, taxRate });
  it('türetilebiliyorsa her iki yolda da yazılır', () => {
    expect(irsaliyeToplamYamasi([k(10, 100, 20)], false)).toEqual({ total: 1200 });
    expect(irsaliyeToplamYamasi([k(10, 100, 20)], true)).toEqual({ total: 1200 });
  });
  it('yeni kayıtta türetilemeyen toplam yazılmaz', () => {
    expect(irsaliyeToplamYamasi([], false)).toEqual({});
  });
  it('DÜZENLEMEDE türetilemeyen toplam açıkça null yazılır — kalemleri silinen / KDV kutusu boşaltılan irsaliyede bayat ₺1.200 kalmasın (mutasyon-ayırt-edici)', () => {
    expect(irsaliyeToplamYamasi([], true)).toEqual({ total: null });
    expect(irsaliyeToplamYamasi([k(10, 100, NaN)], true)).toEqual({ total: null });
  });
});

describe('gorunenTutar — liste hücresi ile sıralayıcının ORTAK "gösterilebilir tutar" tanımı', () => {
  it('bilinen ve sıfırdan farklı sayı aynen', () => {
    expect(gorunenTutar(1200)).toBe(1200);
    expect(gorunenTutar('45000')).toBe(45000);
    expect(gorunenTutar(-50)).toBe(-50);
  });
  it('0 ve bilinmeyen → null: hücre ikisini de "—" basıyor, sıralayıcı da ikisini aynı saymalı (eski `total: 0` / `salary: 0` kayıtları)', () => {
    expect(gorunenTutar(0)).toBeNull();
    expect(gorunenTutar(null)).toBeNull();
    expect(gorunenTutar(undefined)).toBeNull();
    expect(gorunenTutar(NaN)).toBeNull();
    expect(gorunenTutar('')).toBeNull();
  });
});

describe('pozitifSayi — kayıt kapısı: bütçe tutarı, çek tutarı, transfer miktarı', () => {
  it('sıfırdan büyük bilinen sayı geçer (sayısal string dâhil)', () => {
    expect(pozitifSayi(1)).toBe(true);
    expect(pozitifSayi('250000')).toBe(true);
    expect(pozitifSayi(0.5)).toBe(true);
  });
  it('0, eksi ve bilinmeyen GEÇMEZ — boşaltılan sayı alanı `Number(\'\') === 0` üretir ve ₺0 bütçe / 0 adet transfer kaydediliyordu (mutasyon-ayırt-edici)', () => {
    expect(pozitifSayi(0)).toBe(false);
    expect(pozitifSayi(-5)).toBe(false);
    expect(pozitifSayi('')).toBe(false);
    expect(pozitifSayi(null)).toBe(false);
    expect(pozitifSayi(undefined)).toBe(false);
    expect(pozitifSayi(NaN)).toBe(false);
    expect(pozitifSayi(Infinity)).toBe(false);
  });
});
