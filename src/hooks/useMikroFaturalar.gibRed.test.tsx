/**
 * useMikroFaturalar — hesaplara GİRMEYEN fatura burada, tek yerde düşer (tüm ekranlar bu kancadan beslenir). 2026-10-02: alıcının
 * reddettiği satış e-Faturası (`gibRed`, GİB 2002 — fatura 389) Mikro'da iptal bayrağı taşımaz; kanca onu da dışarıda bırakır.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMikroFaturalar } from './useMikroFaturalar';

let ilet: ((s: unknown) => void) | null = null;
let abone = '';
vi.mock('../lib/dbClient', () => ({
  collection: (_db: unknown, ad: string) => ({ ad }),
  onSnapshot: (q: { ad: string }, next: (s: unknown) => void) => { abone = q.ad; ilet = next; return () => {}; },
}));
vi.mock('../firebase', () => ({ db: {} }));

const satir = (id: string, o: Record<string, unknown> = {}) => ({ id, data: () => ({ cha_tip: 0, cha_evrakno_sira: Number(id), cha_meblag: 100, cha_tarihi: '2026-09-29T00:00:00', ...o }) });

describe('useMikroFaturalar — reddedilen / iptal fatura listeye girmez', () => {
  it('gibRed:true ve iptal bayraklı kayıt DÜŞER; bayraksız, gibRed:false ve yalnız gibDurum taşıyan kalır', () => {
    const { result } = renderHook(() => useMikroFaturalar(true));
    expect(abone).toBe('mikroFaturalar');
    act(() => ilet?.({ docs: [
      satir('388'),
      satir('389', { gibRed: true, gibDurum: { belgeKodu: '2002' } }),
      satir('390', { gibRed: false, gibDurum: { belgeKodu: '2001' } }),
      satir('391', { cha_iptal: 1 }),
      satir('392', { gibDurum: { belgeKodu: '2002' } }),                      // bayrak yok → okuyan TÜRETMEZ, kalır
      satir('393', { gibRed: 'true' }),                                        // metin bayrak red sayılmaz
    ] }));
    expect(result.current.map(f => f.id)).toEqual(['388', '390', '392', '393']);
  });
  it('enabled false iken abone olunmaz', () => {
    abone = '';
    renderHook(() => useMikroFaturalar(false));
    expect(abone).toBe('');
  });
});
