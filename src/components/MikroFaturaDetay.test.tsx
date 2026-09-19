/**
 * MikroFaturaDetay.test.tsx — fatura detay penceresinin KALEM TABLOSU (2026-09-19: "Net Birim" sütunu).
 *
 * Pencere giriş + canlı Mikro verisi gerektirdiği için lokal tarayıcıda açılamıyor; bu test bileşeni GERÇEKTEN çizer
 * (yalnız `/api/mikro/fatura/kalemler` yanıtı sahte). Veri, kullanıcının ekran görüntüsündeki 359 no'lu faturadır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import MikroFaturaDetay, { type MikroFaturaDetayVerisi } from './MikroFaturaDetay';

const authFetch = vi.fn();
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock('../services/ebelgeIndir', () => ({ eBelgeIndir: vi.fn() }));

const fatura: MikroFaturaDetayVerisi = {
  id: 'f1', faturaNo: '359', musteri: 'ACCADO KİLİT SİSTEMLERİ', cariKod: '0040488682', tarih: '2026-09-03',
  tutar: 4270.01, kdv: 711.67, matrah: 3558.34, oran: 20, yon: 'giden',
};

const yanit = (kalemler: Record<string, unknown>[]) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, kalemler }) });

/** Ürün adının durduğu tablo satırı — bulunamazsa test AÇIK bir hatayla düşer (`!` yok). */
async function satirOf(urunAdi: string): Promise<HTMLElement> {
  const tr = (await screen.findByText(urunAdi)).closest('tr');
  if (!tr) throw new Error(`"${urunAdi}" bir <tr> içinde değil`);
  return tr;
}
const hucreler = (satir: HTMLElement) => within(satir).getAllByRole('cell').map(c => c.textContent);

beforeEach(() => authFetch.mockReset());

describe('MikroFaturaDetay — Net Birim sütunu', () => {
  it('net ÷ miktar basılır; 2 ondalık neti tutmuyorsa tutan en az ondalık', async () => {
    authFetch.mockReturnValue(yanit([
      { sth_stok_kod: 'AKCALI-AKÇ.00326', urunAdi: 'AKÇALI SPREY SİYAH 400 ML', birim: 'ADET', sth_birim_pntr: 1, sth_miktar: 18, sth_tutar: 3375, sth_vergi: 675, sth_vergi_pntr: 4 },
      { sth_stok_kod: 'M311.VT874000', urunAdi: 'VIP-TEC MAKET BIÇAĞI', birim: 'ADET', sth_birim_pntr: 1, sth_miktar: 20, sth_tutar: 183.34, sth_vergi: 36.67, sth_vergi_pntr: 4 },
    ]));
    render(<MikroFaturaDetay fatura={fatura} currentLanguage="tr" onClose={() => {}} />);

    const satir1 = await satirOf('AKÇALI SPREY SİYAH 400 ML');
    const satir2 = await satirOf('VIP-TEC MAKET BIÇAĞI');
    expect(hucreler(satir1)[6]).toBe('₺187,50');      // 3.375,00 / 18 — 2 ondalık neti geri üretir
    expect(hucreler(satir2)[6]).toBe('₺9,167');       // 183,34 / 20 — "₺9,17" × 20 = 183,40 ≠ 183,34
    // Sütun sırası: … Net, Net Birim, KDV
    const basliklar = screen.getAllByRole('columnheader').map(h => h.textContent);
    expect(basliklar.slice(-3)).toEqual(['Net', 'Net Birim', 'KDV']);
    expect(screen.queryByText(/ana birim dışında/)).toBeNull();   // ana birimde uyarı YOK
  });

  it("miktarı 0 olan satırda (fiyat farkı) birim fiyat '—' — sıfıra bölünmez, ₺0 basılmaz", async () => {
    authFetch.mockReturnValue(yanit([
      { sth_stok_kod: 'FF-1', urunAdi: 'FİYAT FARKI', birim: 'ADET', sth_birim_pntr: 1, sth_miktar: 0, sth_tutar: 100, sth_vergi: 20, sth_vergi_pntr: 4 },
    ]));
    render(<MikroFaturaDetay fatura={{ ...fatura, tutar: 120 }} currentLanguage="tr" onClose={() => {}} />);
    const h = hucreler(await satirOf('FİYAT FARKI'));
    expect(h[5]).toBe('₺100,00');   // Net
    expect(h[6]).toBe('—');         // Net Birim
  });

  it('[İNCELEME] ANA BİRİM DIŞI satır (sth_birim_pntr = 2) işaretlenir: "80 · PALET · ₺200" torba fiyatı olabilir', async () => {
    authFetch.mockReturnValue(yanit([
      { sth_stok_kod: 'CIM-50', urunAdi: 'ÇİMENTO 50 KG', birim: 'PALET', sth_birim_pntr: 2, sth_miktar: 80, sth_tutar: 16000, sth_vergi: 3200, sth_vergi_pntr: 4 },
    ]));
    render(<MikroFaturaDetay fatura={{ ...fatura, tutar: 19200 }} currentLanguage="tr" onClose={() => {}} />);
    const h = hucreler(await satirOf('ÇİMENTO 50 KG'));
    expect(h[6]).toBe('₺200,00 *');                                  // sayı gizlenmez, İŞARETLENİR
    expect(screen.getByText(/ana birim dışında girilmiş/)).toBeTruthy();   // dipnot nedeni söyler
  });
});
