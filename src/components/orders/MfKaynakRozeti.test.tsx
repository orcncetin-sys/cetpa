/**
 * MfKaynakRozeti.test.tsx: MF rozetinin üç dalı GERÇEKTEN çizilir (şartname «Mikro bağlantı B» BH16, T-B2-5i / T-B2-7; 05.11.2026).
 * Bağlantı (OrdersPage liste + mobil bu bileşeni çağırır) `src/test/qSerisi.kaynak.test.ts` kaynak çitinde.
 *
 * Mutasyonlar (yapılıp geri alındı, raporda): kaynaksız dalı silinir → «kaynaksız» testi kırmızı; dalların sırası çevrilir (Q önce)
 * → «Q + işaretli» testi kırmızı; `mikroda_satis_faturasi_yok` metni ya da anahtarı değişir → T-B2-7 kırmızı.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import MfKaynakRozeti from './MfKaynakRozeti';
import { MF_KAYNAGI } from '../../lib/mfKaynagi';
import { ORDERS } from '../../i18n/orders';

afterEach(() => cleanup());
const mf = (ek: Record<string, unknown> = {}) => ({ id: 'mikrofat__A__-325', source: MF_KAYNAGI, faturali: true, mikroEvrak: { seri: '', sira: '325' }, ...ek });
const ciz = (order: ReturnType<typeof mf>, dil: 'tr' | 'en' = 'tr', boyut?: 'liste' | 'mobil') =>
  render(<MfKaynakRozeti order={order} currentLanguage={dil} boyut={boyut} />).container;

describe('MfKaynakRozeti · üç dal, TEK rozet', () => {
  it("kaynaksız: «Mikro'da satış faturası yok» (amber), başlıkta gece kontrolü tarihi ve «ciroya ve KDV'ye sayılmaz; sipariş silinmez»", () => {
    const c = ciz(mf({ mfKaynaksiz: true, mfKaynaksizGoruldu: '2026-11-06T00:20:00.000Z' }));
    const r = c.querySelector('[data-mf-kaynaksiz-rozet="mikrofat__A__-325"]');
    expect(r?.textContent).toBe("Mikro'da satış faturası yok");
    expect(r?.className).toContain('bg-amber-50');
    expect(r?.getAttribute('title')).toBe("Gece kontrolünde (06.11.2026) bu numarada Mikro satış faturası bulunamadı. Ciroya ve KDV'ye sayılmaz; sipariş silinmez.");
    expect(c.querySelectorAll('span')).toHaveLength(1);
  });
  it('seri Q: «FATURASIZ · MİKRO Q» (`data-faturasiz-rozet`)', () => {
    const c = ciz(mf({ mikroEvrak: { seri: 'Q', sira: '1' } }));
    expect(c.querySelector('[data-faturasiz-rozet]')?.textContent).toBe('FATURASIZ · MİKRO Q');
    expect(c.querySelector('[data-mf-kaynaksiz-rozet]')).toBeNull();
  });
  it('öteki MF: «MİKRO FATURA»; mobilde «MİKRO FTR»', () => {
    expect(ciz(mf()).textContent).toBe('MİKRO FATURA');
    expect(ciz(mf(), 'tr', 'mobil').textContent).toBe('MİKRO FTR');
  });
  it('öncelik: Q + işaretli → YALNIZ kaynaksız rozeti; başlığa seri bilgisi eklenir', () => {
    const c = ciz(mf({ mikroEvrak: { seri: 'Q', sira: '1' }, mfKaynaksiz: true }));
    expect(c.querySelector('[data-faturasiz-rozet]')).toBeNull();
    const r = c.querySelector('[data-mf-kaynaksiz-rozet]');
    expect(r?.textContent).toBe("Mikro'da satış faturası yok");
    expect(r?.getAttribute('title')).toContain('Seri Q (faturasız) Mikro satırından türedi.');
    expect(r?.getAttribute('title')).toContain('Gece kontrolünde (—)');   // tarih bilinmiyorsa uydurulmaz
  });
  it('en: «No Mikro sales invoice»', () => {
    expect(ciz(mf({ mfKaynaksiz: true }), 'en').textContent).toBe('No Mikro sales invoice');
  });
});

describe('T-B2-7 · rozet / durum / CSV metni sözlükte (anahtar ve metin kilitli)', () => {
  it('tr + en anahtarları ve metinleri', () => {
    expect(ORDERS.tr.mikroda_satis_faturasi_yok).toBe("Mikro'da satış faturası yok");
    expect(ORDERS.en.mikroda_satis_faturasi_yok).toBe('No Mikro sales invoice');
    expect(ORDERS.tr.mf_kaynaksiz_aciklama).toBe("Gece kontrolünde ({tarih}) bu numarada Mikro satış faturası bulunamadı. Ciroya ve KDV'ye sayılmaz; sipariş silinmez.");
    expect(ORDERS.en.mf_kaynaksiz_aciklama).toContain('{tarih}');
  });
});
