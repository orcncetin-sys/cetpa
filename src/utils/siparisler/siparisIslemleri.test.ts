/** siparisIslemleri — 2026-09-25 kullanıcı bildirimleri (MF-383): teslim edilmişe sevkiyat, Mikro kaydını düzenleme/silme. */
import { describe, it, expect } from 'vitest';
import { yerelDegistirilebilir, sevkiyatEngeli, sevkiyatEngeliMetni } from './siparisIslemleri';

const native = { id: 'o1', status: 'Pending' };
const mf383 = { id: 'mikrofat__c1__-383', source: 'mikro-fatura', status: 'Delivered' };

describe('yerelDegistirilebilir', () => {
  it('Cetpa siparişi düzenlenir/silinir; Mikro kaynaklı (fatura ya da sipariş) HAYIR', () => {
    expect(yerelDegistirilebilir(native)).toBe(true);
    expect(yerelDegistirilebilir({ ...native, source: 'shopify' })).toBe(true);
    expect(yerelDegistirilebilir(mf383)).toBe(false);
    expect(yerelDegistirilebilir({ id: 'm', source: 'mikro-siparis' })).toBe(false);
  });
});

describe('sevkiyatEngeli — "teslim edilen bir şeye tekrar sevkiyat oluşturulamaz"', () => {
  it('teslim edilmiş (MF-383 dahil) ve iptal edilmiş siparişe sevkiyat açılmaz', () => {
    expect(sevkiyatEngeli(mf383, [])).toBe('teslimEdildi');
    expect(sevkiyatEngeli({ ...native, status: 'Cancelled' }, [])).toBe('iptal');
  });
  it('açık sevkiyatı olan siparişe ikinci sevkiyat açılmaz; iptal edilmiş sevkiyat engellemez', () => {
    expect(sevkiyatEngeli(native, [{ orderId: 'o1', status: 'Pending' }])).toBe('sevkiyatAcik');
    expect(sevkiyatEngeli(native, [{ orderId: 'o1', status: 'In Transit' }])).toBe('sevkiyatAcik');
    expect(sevkiyatEngeli(native, [{ orderId: 'o1', status: 'Delivered' }])).toBe('sevkiyatTeslim');   // "açık" DEĞİL
    expect(sevkiyatEngeli(native, [{ orderId: 'o1', status: 'Delivered' }, { orderId: 'o1', status: 'Pending' }])).toBe('sevkiyatAcik');
    expect(sevkiyatEngeli(native, [{ orderId: 'o1', status: 'Cancelled' }])).toBeNull();
    expect(sevkiyatEngeli(native, [{ orderId: 'baska', status: 'Pending' }])).toBeNull();
  });
  it('bekleyen / hazırlanan / kargodaki siparişe açılır', () => {
    for (const status of ['Pending', 'Processing', 'Shipped']) expect(sevkiyatEngeli({ ...native, status }, [])).toBeNull();
  });
  it('neden metni iki dilde', () => {
    expect(sevkiyatEngeliMetni('teslimEdildi', 'tr')).toMatch(/teslim edilmiş/);
    expect(sevkiyatEngeliMetni('sevkiyatAcik', 'en')).toMatch(/already has/);
    expect(sevkiyatEngeliMetni('sevkiyatTeslim', 'tr')).toMatch(/teslim edilmiş/);
  });
});
