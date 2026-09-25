/**
 * CariEkstrePanel.test.tsx — cha_evrak_tip 29 "Açılış fişi" etiketi (mikro-import-arkaplan istemci §D, K-D,
 * 2026-09-24). ÖNCE YAZILDI.
 *
 * Kaynak: Mikro'nun KENDİ cari ekstresi tip 29'u "Hesap Açılış Fişi (043400)" basıyor (kullanıcının
 * yapıştırdığı Mikro çıktısı, 2026-09-24); LUCA dekontları (572 satır) bu tiptir. Eskiden ekranda
 * "Hareket (tip 29) · Borç" görünüyordu. TR-only (8 kardeş etiket de TR-only; EN UYDURULMAZ).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CariEkstrePanel, { hareketTipiEtiket } from './CariEkstrePanel';

const authFetch = vi.fn();
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock('../services/ebelgeIndir', () => ({ eBelgeIndir: vi.fn() }));
vi.mock('../lib/dbClient', async () => (await import('../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi);

beforeEach(() => authFetch.mockReset());

describe('hareketTipiEtiket — birim', () => {
  it("29 → 'Açılış fişi' (sayı ve string)", () => {
    expect(hareketTipiEtiket(29)).toBe('Açılış fişi');
    expect(hareketTipiEtiket('29')).toBe('Açılış fişi');
  });
  it('kardeş etiketler ve default AYNEN: 63 Fatura, 999 "Hareket (tip 999)", undefined "Hareket"', () => {
    expect(hareketTipiEtiket(63)).toBe('Fatura');
    expect(hareketTipiEtiket(999)).toBe('Hareket (tip 999)');
    expect(hareketTipiEtiket(undefined)).toBe('Hareket');
  });
});

describe('CariEkstrePanel — Mikro modu satırı', () => {
  it("tip 29 borç satırı hücrede 'Açılış fişi · Borç' görünür", async () => {
    authFetch.mockReturnValue(Promise.resolve({ ok: true, json: () => Promise.resolve({
      success: true,
      satirlar: [{ cha_evrak_tip: 29, cha_tip: 0, cha_meblag: 100, cha_tarihi: '2025-04-23', cha_evrakno_seri: 'LUCA', cha_evrakno_sira: '1' }],
    }) }));
    render(<CariEkstrePanel cariKod="LUCA-1" currentLanguage="tr" />);
    expect(await screen.findByText('Açılış fişi · Borç')).toBeInTheDocument();
    expect(authFetch).toHaveBeenCalledWith('/api/mikro/cari-hareket/LUCA-1');
  });
});
