/**
 * KasaModule.baslik.test.tsx: başlık «Toplam Kasa Bakiyesi» ve «Toplam Bakiye» KPI'sı, ₺ kasalardan birinin bakiyesi bilinmiyorken
 * ₺0 BASMAZ (inceleme MBA2 #1, 2026-11-05; yarım düzeltme: kartlar «Bakiye bilinmiyor» derken başlık aynı kasayı sessizce ₺0
 * sayıyordu). Toplayıcı değişmez (şartname A5.4); yalnız gösterim «—» + not. USD / EUR kasa ₺ toplamına girmediği için sayılmaz.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import KasaModule from './KasaModule';
import { koleksiyonAyarla, sifirla } from '../hooks/useArkaPlanIsi.testDuzenegi';

vi.mock('../lib/dbClient', async () => (await import('../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi);
beforeEach(() => sifirla());

const baslikKutusu = async () => (await screen.findByText('Toplam Kasa Bakiyesi')).parentElement!;
const notMetni = () => document.querySelector('[data-kasa-toplam-bilinmiyor]')?.textContent;

describe('KasaModule · başlık ₺ toplamı bilinmeyen kasada ₺0 basmaz (MBA2 #1)', () => {
  it('yalnız Mikro ₺ kasası + 0 hareket: başlık ve «Toplam Bakiye» KPI «—», ₺0,00 yok; not «1 kasanın … toplam hesaplanamıyor»', async () => {
    koleksiyonAyarla('kasalar', [{ id: 'mikro-k1', veri: { companyId: 'A', kasaAdi: 'MERKEZ KASA', currency: 'TRY', source: 'mikro' } }]);
    render(<KasaModule currentLanguage="tr" isAuthenticated />);
    const baslik = await baslikKutusu();
    await waitFor(() => expect(baslik.textContent).toContain('—'), { timeout: 1500 });
    expect(baslik.textContent).not.toContain('₺0,00');
    expect(notMetni()).toBe('1 kasanın bakiyesi bilinmiyor · toplam hesaplanamıyor');
    const kpi = screen.getByText('Toplam Bakiye').parentElement!;
    expect(kpi.textContent).toContain('—');
    expect(kpi.textContent).not.toContain('₺0,00');
  });

  it('İngilizce: aynı durumda not «1 cash box(es) with unknown balance · total unavailable»', async () => {
    koleksiyonAyarla('kasalar', [{ id: 'mikro-k1', veri: { companyId: 'A', kasaAdi: 'MERKEZ KASA', currency: 'TRY', source: 'mikro' } }]);
    render(<KasaModule currentLanguage="en" isAuthenticated />);
    const baslik = await baslikKutusu();
    await waitFor(() => expect(notMetni()).toBe('1 cash box(es) with unknown balance · total unavailable'), { timeout: 1500 });
    expect(baslik.textContent).toContain('—');
  });

  it('Cetpa kasası + 1.500 ₺ giriş: başlık bilinen toplamı basar, «—» ve not yok', async () => {
    koleksiyonAyarla('kasalar', [{ id: 'c1', veri: { ad: 'Şube Kasası', doviz: 'TRY', durum: 'Aktif' } }]);
    koleksiyonAyarla('kasaHareketleri', [{ id: 'h1', veri: { kasaId: 'c1', tur: 'Giriş', tutar: 1500, tarih: '2026-01-02', aciklama: 'x' } }]);
    render(<KasaModule currentLanguage="tr" isAuthenticated />);
    const baslik = await baslikKutusu();
    await waitFor(() => expect(baslik.textContent).toContain('1.500'), { timeout: 1500 });
    expect(baslik.textContent).not.toContain('—');
    expect(notMetni()).toBeUndefined();
    expect(screen.getByText('Toplam Bakiye').parentElement!.textContent).toContain('1.500');
  });

  it('bilinmeyen kasa USD ise ₺ toplamı bilinir: başlık 1.500 ₺, «—» ve not yok (`tryKasaIds` süzgeci)', async () => {
    koleksiyonAyarla('kasalar', [
      { id: 'mikro-usd', veri: { companyId: 'A', kasaAdi: 'DÖVİZ KASA', currency: 'USD', source: 'mikro' } },
      { id: 'c1', veri: { ad: 'Şube Kasası', doviz: 'TRY', durum: 'Aktif' } },
    ]);
    koleksiyonAyarla('kasaHareketleri', [{ id: 'h1', veri: { kasaId: 'c1', tur: 'Giriş', tutar: 1500, tarih: '2026-01-02', aciklama: 'x' } }]);
    render(<KasaModule currentLanguage="tr" isAuthenticated />);
    const baslik = await baslikKutusu();
    await waitFor(() => expect(baslik.textContent).toContain('1.500'), { timeout: 1500 });
    expect(baslik.textContent).not.toContain('—');
    expect(notMetni()).toBeUndefined();
  });
});
