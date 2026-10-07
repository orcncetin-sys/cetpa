import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { odemeAlindiYamasi, odemeYontemiMi, ODEME_YONTEMLERI } from './odemeYontemi';
import { SRC_KOK as SRC, kodSatirlari } from '../../test/kaynakTarama';

describe('odemeAlindiYamasi — SEÇİLEN yöntem yazılır', () => {
  it('beş yöntemin her biri olduğu gibi yazılır (eskiden hepsi bank_transfer oluyordu)', () => {
    for (const y of ODEME_YONTEMLERI) expect(odemeAlindiYamasi(y, 'ZAMAN')).toEqual({ paid: true, paidAt: 'ZAMAN', paymentMethod: y });
    expect(ODEME_YONTEMLERI).toEqual(['cash', 'bank_transfer', 'credit_card', 'check', 'other']);
  });
  it('seçilmemiş / geçersiz yöntemle kayıt YOK — varsayılan uydurulmaz', () => {
    for (const k of [undefined, null, '', 'havale', 'CASH', 5, {}]) {
      expect(odemeYontemiMi(k)).toBe(false);
      expect(() => odemeAlindiYamasi(k, 'ZAMAN')).toThrow(/seçilmedi/);
    }
  });
});

describe('bağlantı (kaynak çiti): pencereden gelen yöntem işleyiciye ULAŞIR', () => {
  const say = (dosya: string, desen: RegExp) => kodSatirlari(join(SRC, dosya)).filter(({ kod }) => desen.test(kod)).length;
  it('App: işleyici yöntemi PARAMETRE olarak alır ve yamayı ondan kurar; kopya durum (p532Method) kalmadı', () => {
    expect(say('App.tsx', /const handleConfirmPayment = async \(yontem: OdemeYontemi\): Promise<boolean> => \{/)).toBe(1);
    expect(say('App.tsx', /odemeAlindiYamasi\(yontem, serverTimestamp\(\)\)/)).toBe(1);
    expect(say('App.tsx', /p532Method/)).toBe(0);
    expect(say('App.tsx', /onConfirm=\{handleConfirmPayment\}/)).toBe(1);
  });
  it('Pencere: seçim yapılmadan onay düğmesi kapalı; seçilen yöntem onConfirm\'e gider', () => {
    expect(say('components/PaymentMethodModal.tsx', /useState<OdemeYontemi \| null>\(null\)/)).toBe(1);
    expect(say('components/PaymentMethodModal.tsx', /disabled=\{method === null \|\| kaydediliyor\}/)).toBe(1);
    expect(say('components/PaymentMethodModal.tsx', /await onConfirm\(method\)/)).toBe(1);
  });
});
