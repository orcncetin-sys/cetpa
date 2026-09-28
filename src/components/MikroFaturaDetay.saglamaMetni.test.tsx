/**
 * MikroFaturaDetay.saglamaMetni.test.tsx — "toplamTutuyor" kutusunun SON seçeneği (tur 3, 2026-09-28).
 *
 * Bu seçeneğe yalnız mikroFazlasi > 0 iken ulaşılır (kdvUyumsuz = ciftBelirsiz = 0 ve tutuyor → aksi hâlde yeşil). Eskiden
 * "satır KDV'si doğrulanamadı" yazıyordu: o durumda satırın KDV'si ZATEN doğrulanmıştır (tutarsızlık KDV sayesinde bulundu),
 * asıl bulgu (Mikro'nun fazlası) hiç anılmıyordu. Tur 3'te başlık hakemi sağlamanın payıyla hizalandığı için lib yolundan bu
 * duruma artık ulaşılmıyor (etiket ⇔ sağlamanın "Mikro kaydı tutarsız" hükmü) — metin yine de doğru olmalı; sağlama burada
 * sahte (kalemSaglamasi yerine sabit nesne) çünkü durum lib'den üretilemiyor.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MikroFaturaDetay, { type MikroFaturaDetayVerisi } from './MikroFaturaDetay';
import type { KalemSaglamasi } from '../lib/stokFiyat';

const authFetch = vi.fn();
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock('../services/ebelgeIndir', () => ({ eBelgeIndir: vi.fn() }));

const sahte: KalemSaglamasi = { net: 99900, kdv: 19980, masraf: 0, iskonto: 100, kalemToplami: 119880, fark: -40, tutuyor: true, eksik: 0,
  mikroFazlasi: 100, mikroKaydiTutarsiz: false, kdvUyumsuz: 0, ciftBelirsiz: 0 };
vi.mock('../lib/stokFiyat', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../lib/stokFiyat')>();
  return { ...gercek, kalemSaglamasi: () => sahte };
});

const fatura: MikroFaturaDetayVerisi = { id: 'f9', faturaNo: '944', musteri: 'TEDARİKÇİ', cariKod: '320', tarih: '2026-08-31',
  tutar: 119920, kdv: 19980, matrah: 100000, oran: 20, yon: 'gelen' };

// Delta 2 (M19): '(fark …)' rakamı başlık farkıdır (|fark| = 40), Mikro fazlası (100) DEĞİL — o da kilitlenir.
describe('toplamTutuyor + mikroFazlasi > 0: gerekçe asıl bulguyu adıyla söyler', () => {
  it.each([['tr', /100,00.*brüte bir kez daha eklenmiş.*\(fark ₺40,00\)/], ['en', /100[.,]00.*added to the gross once more.*\(diff ₺40[.,]00\)/]] as const)('%s', async (dil, beklenen) => {
    authFetch.mockReturnValue(Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, kalemler: [
      { sth_stok_kod: 'X1', urunAdi: 'ÜRÜN X', birim: 'ADET', sth_miktar: 10, sth_tutar: 100100, sth_iskonto1: 100, sth_vergi: 19980, sth_vergi_pntr: 4, sth_tarih: '2026-08-31' },
    ] }) }));
    render(<MikroFaturaDetay fatura={fatura} currentLanguage={dil} onClose={() => {}} />);
    const kutu = await screen.findByText(dil === 'tr' ? /^Toplam tutuyor/ : /^Total matches/);
    expect(kutu.textContent).toMatch(beklenen);
    expect(kutu.textContent).not.toMatch(/doğrulanamadı|could not be verified/);
  });
});
