import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { odemeAlindiYamasi, odemeYontemiMi, odemeYontemiEtiketi, ODEME_YONTEMLERI, type OdemeYontemi } from './odemeYontemi';
import { oc } from '../../i18n/ortak';
import { op } from '../../i18n/orders';
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

// ── 6c inceleme 1 (2026-10-17): `odemeYontemiEtiketi` — enum kodunun EKRAN etiketi ────────────────────────────────────
// GB2 «Ödeme Yöntemi Dağılımı» ham kodu basıyordu («bank_transfer»; `capitalize` sınıfıyla «Bank_transfer»). KARAR
// (orkestratör): OrdersPage `pmLabels` rozetiyle AYNI sözlük anahtarları — yeni metin YAZILMAZ: cash → oc.nakit,
// bank_transfer → op.eft, credit_card → op.kart, check → oc.cek, other → oc.diger. Beklenen metinler sözlükten okunur.
describe('odemeYontemiEtiketi — OrdersPage rozetiyle aynı sözlük metni', () => {
  const BEKLENEN = (dil: 'tr' | 'en'): Record<OdemeYontemi, string> => ({
    cash: oc(dil).nakit, bank_transfer: op(dil).eft, credit_card: op(dil).kart, check: oc(dil).cek, other: oc(dil).diger,
  });

  it.each(['tr', 'en'] as const)('%s: beş yöntemin her biri sözlük metnini döner; hiçbiri ham anahtar DEĞİL', dil => {
    for (const y of ODEME_YONTEMLERI) {
      const etiket = odemeYontemiEtiketi(y, dil);
      expect(etiket, y).toBe(BEKLENEN(dil)[y]);
      expect(etiket, y).not.toBe(y);
      expect(etiket.trim(), y).not.toBe('');
    }
  });

  it('TR metinleri: Nakit · EFT · Kart · Çek · Diğer (EN: Cash · Transfer · Card · Check · Other)', () => {
    expect(ODEME_YONTEMLERI.map(y => odemeYontemiEtiketi(y, 'tr'))).toEqual(['Nakit', 'EFT', 'Kart', 'Çek', 'Diğer']);
    expect(ODEME_YONTEMLERI.map(y => odemeYontemiEtiketi(y, 'en'))).toEqual(['Cash', 'Transfer', 'Card', 'Check', 'Other']);
  });

  it('dil daraltması `oc()` ile AYNI: `undefined` → Türkçe, `tr` dışı her metin → İngilizce', () => {
    expect(odemeYontemiEtiketi('check', undefined)).toBe('Çek');
    expect(odemeYontemiEtiketi('check', 'de')).toBe('Check');
  });
});
