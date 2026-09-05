/**
 * superadminRoutes.test.ts — plan ücreti SAHTE KESİNLİK kapısı (Faz 1, 2026-09-04).
 *
 * `planTutari` eskiden `?? 0` yapıyordu: fiyat tablosunda olmayan plan adı
 * (yazım hatası, kaldırılmış plan, özel anlaşma) abonelik özetine "0 TL"
 * olarak düşüyordu. Bilinmeyen plan bedava değil, BİLİNMİYORDUR.
 */
import { describe, it, expect } from 'vitest';
import { planTutari } from './superadminRoutes';

const FIYATLAR = { starter: { monthly: 990, yearly: 9900 }, pro: { monthly: 2490, yearly: 24900 } };

describe('planTutari — bilinmeyen plan null, 0 değil', () => {
  it('tanımlı plan + döngü → tutar', () => {
    expect(planTutari(FIYATLAR, 'starter', 'monthly')).toBe(990);
    expect(planTutari(FIYATLAR, 'pro', 'yearly')).toBe(24900);
  });
  it("döngü 'yearly' dışında her şey aylık sayılır (mevcut davranış korunur)", () => {
    expect(planTutari(FIYATLAR, 'pro', 'monthly')).toBe(2490);
    expect(planTutari(FIYATLAR, 'pro', 'saçma')).toBe(2490);
  });
  it('TANIMSIZ plan → null (eskiden 0 TL basılıyordu)', () => {
    expect(planTutari(FIYATLAR, 'enterprise', 'monthly')).toBeNull();
    expect(planTutari(FIYATLAR, 'Starter', 'monthly')).toBeNull();   // büyük/küçük harf — tahmin yok
    expect(planTutari({}, 'starter', 'monthly')).toBeNull();
  });
  it('tabloda NaN/undefined duran tutar da null — bozuk konfig 0 TL olmaz', () => {
    expect(planTutari({ x: { monthly: NaN, yearly: 1 } }, 'x', 'monthly')).toBeNull();
  });
  it('GERÇEK sıfır fiyatlı plan (ücretsiz) 0 döner — sıfır bilinmeyen değildir', () => {
    expect(planTutari({ free: { monthly: 0, yearly: 0 } }, 'free', 'monthly')).toBe(0);
  });
});
