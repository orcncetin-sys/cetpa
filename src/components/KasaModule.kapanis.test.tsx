/**
 * KasaModule.kapanis.test.tsx: «Günlük Kapanış» sekmesi, ₺ kasalardan birinin bakiyesi bilinmiyorken (Mikro kasası, hareket yok)
 * Açılış / Kapanış ₺0 BASMAZ ve «Günü Kapat» kayıt YAZMAZ (inceleme MBS #3, 2026-11-05). Başlık ve «Toplam Bakiye» KPI'sı bu durumda
 * zaten «—» basıyordu (MBA2 #1); kapanış sekmesi aynı toplamı ₺0,00 diye gösteriyor ve `kasaKapanislar`'a `kapanisBakiye: 0` yazıyordu:
 * Geçmiş Kapanışlar'da ölçülmüş değer gibi durur, ertesi günün açılışı olurdu. Bilinen toplamda davranış değişmez.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import KasaModule from './KasaModule';
import { koleksiyonAyarla, sifirla } from '../hooks/useArkaPlanIsi.testDuzenegi';
import { bugunAnahtari } from '../utils/zaman';

const yazim = vi.hoisted(() => ({ addDoc: vi.fn(async (..._a: unknown[]) => ({ id: 'yeni' })) }));
vi.mock('../lib/dbClient', async () => ({
  ...(await import('../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi,
  addDoc: yazim.addDoc,
  serverTimestamp: () => 'TS',
}));
beforeEach(() => { sifirla(); yazim.addDoc.mockClear(); });

const MIKRO_KASA = { id: 'mikro-k1', veri: { companyId: 'A', kasaAdi: 'MERKEZ KASA', currency: 'TRY', source: 'mikro' } };
const METIN = 'Mikro kasalarının bakiyesi bilinmiyor · kapanış bakiyesi hesaplanamıyor.';

/** Kapanış sekmesini açar; kasa aboneliği gelene kadar (başlık «—» ya da tutar) bekler. */
async function kapanisAc(): Promise<void> {
  render(<KasaModule currentLanguage="tr" isAuthenticated />);
  fireEvent.click(await screen.findByRole('button', { name: 'Günlük Kapanış' }));
}
const kutu = (etiket: string): string => String(screen.getByText(etiket).parentElement?.textContent);
const kapatDugmesi = (): HTMLElement => screen.getByRole('button', { name: /Günü Kapat/ });

describe('KasaModule · Günlük Kapanış: ₺ toplamı bilinmiyorken ₺0 basılmaz, kapanış yazılmaz (MBS #3)', () => {
  it('yalnız Mikro ₺ kasası, önceki kapanış YOK: Açılış ve Kapanış «—» (0 uydurulmaz), nötr renk; düğme pasif; tıklama kayıt YAZMAZ, nedeni söyler', async () => {
    koleksiyonAyarla('kasalar', [MIKRO_KASA]);
    await kapanisAc();
    await waitFor(() => expect(kutu('Açılış Bakiyesi')).toContain('—'), { timeout: 1500 });
    for (const etiket of ['Açılış Bakiyesi', 'Kapanış Bakiyesi']) {
      expect(kutu(etiket)).toBe(`${etiket}—`);
      expect(screen.getByText(etiket).nextElementSibling?.className).toContain('text-gray-400');
    }
    // Toplam Giriş / Çıkış Cetpa hareketlerinden: bilinen değer, «—» değil.
    expect(kutu('Toplam Giriş')).toContain('₺0,00');
    const dugme = kapatDugmesi();
    expect(dugme.getAttribute('aria-disabled')).toBe('true');
    expect(dugme.getAttribute('title')).toBe(METIN);
    fireEvent.click(dugme);
    expect(await screen.findByText(METIN)).toBeInTheDocument();
    expect(yazim.addDoc).not.toHaveBeenCalled();
  });

  it('önceki kapanış VAR (500 ₺) ama Mikro ₺ kasası bilinmiyor: Açılış da «—» (bugünkü toplam bilinmiyor); kayıt yazılmaz', async () => {
    koleksiyonAyarla('kasalar', [MIKRO_KASA]);
    koleksiyonAyarla('kasaKapanislar', [{ id: 'kp1', veri: { tarih: '2026-01-01', acilisBakiye: 0, toplamGiris: 500, toplamCikis: 0, kapanisBakiye: 500, kapatan: 'Admin' } }]);
    await kapanisAc();
    await waitFor(() => expect(kutu('Açılış Bakiyesi')).toBe('Açılış Bakiyesi—'), { timeout: 1500 });
    expect(kutu('Kapanış Bakiyesi')).toBe('Kapanış Bakiyesi—');
    fireEvent.click(kapatDugmesi());
    expect(await screen.findByText(METIN)).toBeInTheDocument();
    expect(yazim.addDoc).not.toHaveBeenCalled();
  });

  it('Cetpa kasası + bugün 1.500 ₺ giriş (toplam BİLİNİYOR): davranış aynı · Açılış ₺0,00, Kapanış ₺1.500,00; düğme etkin; kapanış 1.500 ile yazılır', async () => {
    koleksiyonAyarla('kasalar', [{ id: 'c1', veri: { ad: 'Şube Kasası', doviz: 'TRY', durum: 'Aktif' } }]);
    koleksiyonAyarla('kasaHareketleri', [{ id: 'h1', veri: { kasaId: 'c1', tur: 'Giriş', tutar: 1500, tarih: bugunAnahtari(), aciklama: 'x' } }]);
    await kapanisAc();
    await waitFor(() => expect(kutu('Kapanış Bakiyesi')).toContain('1.500'), { timeout: 1500 });
    expect(kutu('Açılış Bakiyesi')).toContain('₺0,00');
    expect(kutu('Açılış Bakiyesi')).not.toContain('—');
    const dugme = kapatDugmesi();
    expect(dugme.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(dugme);
    await waitFor(() => expect(yazim.addDoc).toHaveBeenCalledTimes(1));
    expect(yazim.addDoc.mock.calls[0][1]).toMatchObject({ acilisBakiye: 0, toplamGiris: 1500, toplamCikis: 0, kapanisBakiye: 1500 });
    expect(screen.queryByText(METIN)).toBeNull();
  });
});
