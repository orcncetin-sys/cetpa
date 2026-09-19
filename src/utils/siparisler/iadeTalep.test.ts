import { describe, it, expect } from 'vitest';
import { iadeTutariDogrula, iadeOnTutar, iadeTutarYamasi, iadeGorunenTutar } from './iadeTalep';

// Fikstür: Şirin İnşaat'ın ÇİMENTO 50KG siparişi — ₺12.500 (eski kodun `maxRet`i).
const SIPARIS = 12500;

describe('iadeTutariDogrula — SAYFA PARİTESİ (OrdersPage 3345-3349)', () => {
  it('0 < tutar ≤ sipariş toplamı → geçerli, kayda giden sayı girdiyle aynı', () => {
    const s = iadeTutariDogrula(5000, SIPARIS);
    expect(s.gecerli).toBe(true);
    expect(s.hata).toBeUndefined();
    expect(s.tutar).toBe(5000);
    expect(s.ustSinir).toBe(SIPARIS);
  });

  it('sipariş toplamına EŞİT iade geçerli (eski: `returnAmount > maxRet + 0.01` yanlış değil)', () => {
    expect(iadeTutariDogrula(SIPARIS, SIPARIS).gecerli).toBe(true);
    expect(iadeTutariDogrula(SIPARIS, SIPARIS).tutar).toBe(SIPARIS);
  });

  it('kuruş toleransı korunur: +0,005 geçer, +1 ₺ geçmez (eski `+ 0.01`)', () => {
    expect(iadeTutariDogrula(SIPARIS + 0.005, SIPARIS).gecerli).toBe(true);
    const asan = iadeTutariDogrula(SIPARIS + 1, SIPARIS);
    expect(asan.gecerli).toBe(false);
    expect(asan.hata).toBe('siparisiAsiyor');
    expect(asan.ustSinir).toBe(SIPARIS);
    expect(asan.tutar).toBeNull();
  });

  it('negatif iade reddedilir (eski `returnAmount <= 0`)', () => {
    const s = iadeTutariDogrula(-5000, SIPARIS);
    expect(s.gecerli).toBe(false);
    expect(s.hata).toBe('pozitifDegil');
    expect(s.tutar).toBeNull();
  });

  it('sıfır iade reddedilir — ama "boş" ile aynı hata DEĞİL', () => {
    const s = iadeTutariDogrula(0, SIPARIS);
    expect(s.gecerli).toBe(false);
    expect(s.hata).toBe('pozitifDegil');
  });

  it('sayısal string (input.value her zaman string) bilinen sayıdır', () => {
    expect(iadeTutariDogrula('5000', SIPARIS).tutar).toBe(5000);
    expect(iadeTutariDogrula('12500,5', SIPARIS).hata).toBe('bos'); // virgüllü metin çözülemez → bilinmiyor
  });
});

describe('iadeTutariDogrula — sipariş tutarı BİLİNMİYORSA üst sınır yok (mutasyon-ayırt-edici)', () => {
  // Eski kod: `const maxRet = Number(o.totalPrice) || 0` → bilinmeyen toplam ₺0 üst sınıra dönüşüyor,
  // HER iade "İade tutarı 0 ile 0 arasında olmalı." ile reddediliyordu (Mikro türevi siparişlerde iade imkânsız).
  it.each([undefined, null, NaN, '', 'abc', Infinity])('toplam %p → üst sınır YOK, meşru iade geçer', (ham) => {
    const s = iadeTutariDogrula(5000, ham);
    expect(s.gecerli).toBe(true);
    expect(s.ustSinir).toBeNull(); // ekranda "sipariş tutarı bilinmiyor" uyarısı: `ustSinir === null`
    expect(s.tutar).toBe(5000);
  });

  it('üst sınır bilinmese de pozitiflik kapısı açık kalmaz', () => {
    expect(iadeTutariDogrula(0, undefined).hata).toBe('pozitifDegil');
    expect(iadeTutariDogrula(-1, undefined).hata).toBe('pozitifDegil');
  });

  it('sipariş toplamı BİLİNEN 0 ise sınır 0 kalır (meşru sıfır sıfırdır)', () => {
    const s = iadeTutariDogrula(100, 0);
    expect(s.hata).toBe('siparisiAsiyor');
    expect(s.ustSinir).toBe(0);
  });
});

describe('iadeTutariDogrula — boş girdi 0 SAYILMAZ (mutasyon-ayırt-edici)', () => {
  // `Number('') === 0` tuzağı: eski modal boş alanı `<= 0` dalına düşürüp
  // "0 ile 12.500 arasında olmalı" diyordu; p575 formu ise `Number('')||0` ile ₺0 KAYDEDİYORDU.
  it.each([['', 'boş metin'], [null, 'null'], [undefined, 'undefined'], [NaN, 'NaN'], ['abc', 'metin'], ['   ', 'boşluk']] as const)(
    '%s (%s) → hata "bos", tutar null',
    (ham, _etiket) => {
      const s = iadeTutariDogrula(ham, SIPARIS);
      expect(s.gecerli).toBe(false);
      expect(s.hata).toBe('bos');
      expect(s.tutar).toBeNull();
    },
  );

  it('boş girdi üst sınırı yine de bildirir (mesaj metni için)', () => {
    expect(iadeTutariDogrula('', SIPARIS).ustSinir).toBe(SIPARIS);
  });
});

describe('iadeOnTutar — form ön-dolumu (OrdersPage 2046)', () => {
  it('sayfa paritesi: bilinen sipariş toplamı aynen ön-dolar', () => {
    expect(iadeOnTutar({ totalPrice: SIPARIS })).toBe(SIPARIS);
    expect(iadeOnTutar({ totalPrice: '7500' })).toBe(7500);
  });

  it.each([undefined, null, NaN, '', 'abc'])('toplam %p → null (BOŞ form) — eski `|| 0` ₺0 ön-doluyordu — mutasyon-ayırt-edici', (ham) => {
    expect(iadeOnTutar({ totalPrice: ham })).toBeNull();
  });

  it('sipariş yoksa null', () => {
    expect(iadeOnTutar(null)).toBeNull();
    expect(iadeOnTutar(undefined)).toBeNull();
  });

  it('BİLİNÇLİ FARK: totalPrice yoksa totalAmount okunur (siparisTutari tek kaynağı)', () => {
    expect(iadeOnTutar({ totalAmount: 9000 })).toBe(9000);
    expect(iadeOnTutar({ totalPrice: null, totalAmount: 9000 })).toBe(9000);
  });

  it('BİLİNEN 0 toplam 0 kalır (bilinmiyor değil) — doğrulama "pozitifDegil" der', () => {
    expect(iadeOnTutar({ totalPrice: 0 })).toBe(0);
  });
});

describe('iadeTutarYamasi — GİRİLEN alanın kayıt yaması (OrdersPage 1442)', () => {
  it('bilinen tutar yazılır', () => {
    expect(iadeTutarYamasi(iadeTutariDogrula('750', null), undefined)).toEqual({ amount: 750 });
  });

  it('yeni kayıtta boş tutar → alan HİÇ yazılmaz (eski kod ₺0 kaydediyordu) — mutasyon-ayırt-edici', () => {
    const yama = iadeTutarYamasi(iadeTutariDogrula('', null), undefined);
    expect(yama).toEqual({});
    expect('amount' in yama).toBe(false);
  });

  it('düzenlemede boşaltılan tutar → açıkça null (PATCH-merge silmeyi sessiz no-op yapmasın)', () => {
    expect(iadeTutarYamasi(iadeTutariDogrula('', null), 500)).toEqual({ amount: null });
  });

  it('düzenlemede önceki de bilinmiyorsa alan yazılmaz', () => {
    expect(iadeTutarYamasi(iadeTutariDogrula('', null), null)).toEqual({});
    expect(iadeTutarYamasi(iadeTutariDogrula('', null), NaN)).toEqual({});
  });

  it('reddedilen tutar (0/negatif) kayda GİRMEZ — çağıran zaten toast ile durur', () => {
    expect(iadeTutarYamasi(iadeTutariDogrula('0', null), undefined)).toEqual({});
    expect(iadeTutarYamasi(iadeTutariDogrula('-5', null), 500)).toEqual({ amount: null });
  });
});

/**
 * `iadeGorunenTutar` — liste hücresi ile DÜZENLEME ön-dolumunun ORTAK tanımı.
 *
 * Hakem bulgusu (2026-09-19, OrdersPage 1533/1541): hücre `r.amount > 0` kapısıyla '—' basarken
 * düzenle düğmesi `r.amount == null ? '' : String(r.amount)` ile formu '0' açıyordu. Eski kod
 * (`Number(draft.amount) || 0`) tutarı boş bırakılan her iadeyi ₺0 kaydettiği için bu kayıtlar
 * YAYGIN: kullanıcı yalnız nedeni değiştirip Kaydet'e bastığında `iadeTutariDogrula('0')`
 * 'pozitifDegil' diyor, toast çıkıyor ve kayıt DURUYORDU — hem de listede tutar '—' görünürken.
 */
describe('iadeGorunenTutar — hücre ile düzenleme formunun TEK tanımı', () => {
  it('bilinen pozitif tutar gösterilir', () => {
    expect(iadeGorunenTutar(750)).toBe(750);
    expect(iadeGorunenTutar('750')).toBe(750);
  });

  it('eski `Number(draft.amount) || 0` kayıtlarındaki sahte ₺0 gösterilmez', () => {
    expect(iadeGorunenTutar(0)).toBeNull();
  });

  it('negatif tutar da gösterilmez (doğrulayıcı zaten pozitifDegil der)', () => {
    expect(iadeGorunenTutar(-5)).toBeNull();
  });

  it('bilinmeyen (null/undefined/NaN/metin) → null', () => {
    expect(iadeGorunenTutar(null)).toBeNull();
    expect(iadeGorunenTutar(undefined)).toBeNull();
    expect(iadeGorunenTutar(NaN)).toBeNull();
    expect(iadeGorunenTutar('')).toBeNull();
    expect(iadeGorunenTutar('abc')).toBeNull();
  });

  it('REGRESYON: sahte ₺0 kaydı düzenlenince form BOŞ açılır, kayıt durmaz ve 0 temizlenir', () => {
    const onceki = 0;                                              // eski kayıt
    const gorunen = iadeGorunenTutar(onceki);
    expect(gorunen).toBeNull();                                    // hücre '—' basıyor
    const formDegeri = gorunen === null ? '' : String(gorunen);
    expect(formDegeri).toBe('');                                   // eski ön-dolum '0' açıyordu

    const s = iadeTutariDogrula(formDegeri, null);
    expect(s.hata).toBe('bos');                                    // 'pozitifDegil' DEĞİL → çağıran durmaz
    expect(iadeTutarYamasi(s, onceki)).toEqual({ amount: null });   // sahte 0 kendiliğinden temizlenir
  });

  it('MUTASYON-AYIRT EDİCİ: eski ön-dolum kuralı kaydı kilitliyordu', () => {
    // eski satır: `r.amount==null?'':String(r.amount)` — kayıtlı sahte 0 için sonucu 'String(0)'dır (sabit koşul lint'e takılmasın diye açık yazıldı)
    const eskiFormDegeri = String(0);
    expect(eskiFormDegeri).toBe('0');
    expect(iadeTutariDogrula(eskiFormDegeri, null).hata).toBe('pozitifDegil');   // toast → kayıt DURUR
  });
});
