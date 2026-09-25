/**
 * FiyatKarsilastirmaPanel.test.tsx — 2026-09-25 kullanıcı bildirimleri, paneli GERÇEKTEN çizerek:
 *  1) "evraka basınca evrak detayları gelmiyor": İşlem Detayı'nda fatura başlığı Cetpa'da YOKKEN de evrak düğmedir ve
 *     faturayı (kalemler Mikro'dan) açar.
 *  2) "bu tip fark olanları listelemem gerekli": koli/adet karışıklığı rozeti + liste; liste evrakı da açar.
 * Yalnız ağ yanıtları sahte; veri kullanıcının ekran görüntüsündeki DAYSON-DYS.029 satırlarıdır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import FiyatKarsilastirmaPanel from './FiyatKarsilastirmaPanel';

const authFetch = vi.fn();
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock('../services/ebelgeIndir', () => ({ eBelgeIndir: vi.fn() }));

const json = (govde: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(govde) });

const SKU = 'DAYSON-DYS.029';
const satir = {
  sku: SKU, ad: 'DAYSON OTO MASTİK GRİ 280ml(25)',
  alisOrtFiyat: 158.6, alisMiktar: 643, alisTutar: 137812.49, alisBrutTutar: 137812.49, alisIskonto: 0, alisAdet: 4,
  satisOrtFiyat: 154.2, satisMiktar: 340, satisTutar: 52429.17, satisBrutTutar: 52429.17, satisIskonto: 0, satisAdet: 6,
  marjTL: -4.4, marjYuzde: -27, bilinmeyenSatir: 0, alisBilinmeyen: 0, satisBilinmeyen: 0, miktarsizSatir: 0,
  kalanStok: 303, sapmaSayisi: 2,
};
const sapma = (sira: string, tarih: string, miktar: number, birimFiyat: number) => ({ belirsiz: false,
  sku: SKU, ad: satir.ad, tarih, yon: 'alis', miktar, birimFiyat, medyan: 145.83, kat: birimFiyat / 145.83,
  cariKod: '320.07', evrakNo: sira, fatura: { seri: '', sira, yon: 'gelen' },
});
const ozet = { success: true, rows: [satir], iskontoKolonlari: ['sth_iskonto1'], netKaynaklari: {}, sapmalar: [sapma('394', '2026-08-11', 8, 3229.17), sapma('410', '2026-08-19', 10, 3125)] };
const detay = {
  success: true, satirlar: [
    { tarih: '2026-08-19', yon: 'alis', miktar: 10, brutTutar: 31250, iskonto: 0, tutar: 31250, birimFiyat: 3125, kaynak: 'iskontosuz', cariKod: '320.07', evrakNo: '410', fatura: { seri: '', sira: '410', yon: 'gelen' } },
    { tarih: '2026-08-10', yon: 'alis', miktar: 5, brutTutar: 500, iskonto: 0, tutar: 500, birimFiyat: 100, kaynak: 'iskontosuz', cariKod: '320.07', evrakNo: 'I-77', fatura: null },
  ],
};

function yonlendir() {
  authFetch.mockImplementation((url: string) => {
    if (url === '/api/reports/stok-fiyat-karsilastirma') return json(ozet);
    if (url.endsWith('/detay')) return json(detay);
    if (url === '/api/mikro/fatura/kalemler') return json({ success: true, kalemler: [
      { sth_stok_kod: SKU, urunAdi: satir.ad, birim: 'ADET', sth_birim_pntr: 1, sth_miktar: 10, sth_tutar: 31250, sth_vergi: 6250, sth_vergi_pntr: 4 },
    ] });
    return json({ success: false, error: `beklenmeyen istek ${url}` });
  });
}
const cizdir = () => render(
  <FiyatKarsilastirmaPanel currentLanguage="tr" userRole="Admin" fmtKpi={v => `₺${v.toFixed(2)}`} mikroFaturalar={[]} />,
);

beforeEach(() => { authFetch.mockReset(); yonlendir(); });

describe('Fiyat Karşılaştırma — evrak düğmesi fatura başlığı YOKKEN de açar', () => {
  it('İşlem Detayı: fatura anahtarlı satır düğme, faturayı açar (kalemler Mikro\'dan); irsaliye satırı düz metin', async () => {
    cizdir();
    fireEvent.click(await screen.findByText(satir.ad));
    const dugme = await screen.findByRole('button', { name: '410' });
    expect(screen.queryByRole('button', { name: 'I-77' })).toBeNull();        // fatura değil → düğme yok
    expect(screen.getByText('I-77')).toBeTruthy();
    fireEvent.click(dugme);
    expect(await screen.findByText(/Fatura başlığı Cetpa'da yok/)).toBeTruthy();
    const kalemIstegi = authFetch.mock.calls.find(c => c[0] === '/api/mikro/fatura/kalemler');
    expect(kalemIstegi).toBeTruthy();
    expect(JSON.parse(String((kalemIstegi?.[1] as { body?: string } | undefined)?.body))).toEqual({ seri: '', sira: '410', yon: 'gelen' });
  });
});

describe('Fiyat Karşılaştırma — birim şüpheli satırlar (koli/adet)', () => {
  it('ürün satırında ⚠ rozeti; liste düğmesi iki alış faturasını gösterir ve evrakı açar', async () => {
    cizdir();
    expect(await screen.findByText('⚠ 2')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Birim şüpheli satır: 2/ }));
    const liste = (await screen.findByText(/fiyat düzeyinden en az 4 kat/)).closest('.apple-card');
    if (!(liste instanceof HTMLElement)) throw new Error('liste kartı yok');
    expect(within(liste).getByRole('button', { name: '394' })).toBeTruthy();
    fireEvent.click(within(liste).getByRole('button', { name: '410' }));
    expect(await screen.findByText(/Fatura başlığı Cetpa'da yok/)).toBeTruthy();
  });

  it('marj yüzdesi TR biçiminde: "-%27" (kullanıcı kararı "%42 şeklinde")', async () => {
    cizdir();
    expect(await screen.findByText(/\(-%27\)/)).toBeTruthy();
  });

  it('arama iki yönde de Türkçe katlar: "sika" → "SIKAFLEX" (ASCII I) bulunur', async () => {
    authFetch.mockImplementation((url: string) => url === '/api/reports/stok-fiyat-karsilastirma'
      ? json({ ...ozet, rows: [{ ...satir, sku: 'SIKA-11FC', ad: 'SIKAFLEX 11FC GRİ' }], sapmalar: [] }) : json({ success: false }));
    cizdir();
    await screen.findByText('SIKAFLEX 11FC GRİ');
    fireEvent.change(screen.getByPlaceholderText(/SKU veya ürün adı ara/), { target: { value: 'sika' } });
    expect(screen.getByText('SIKAFLEX 11FC GRİ')).toBeTruthy();
  });

  it('arama TÜRKÇE küçük harfle eşler: "mastik" hem ürünü hem şüpheli satırı bulur (İ ↔ i)', async () => {
    cizdir();
    await screen.findByText('⚠ 2');
    fireEvent.change(screen.getByPlaceholderText(/SKU veya ürün adı ara/), { target: { value: 'mastik' } });
    expect(screen.getByText(satir.ad)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Birim şüpheli satır: 2/ })).toBeTruthy();
  });

  it('değerlendirilemeyen ürün (sapmaSayisi null) rozet GÖSTERMEZ — "0 şüpheli" diye de yazmaz', async () => {
    authFetch.mockImplementation((url: string) => url === '/api/reports/stok-fiyat-karsilastirma'
      ? json({ ...ozet, rows: [{ ...satir, sapmaSayisi: null }], sapmalar: [] }) : json({ success: false }));
    cizdir();
    await screen.findByText(satir.ad);
    expect(screen.queryByText(/⚠/)).toBeNull();
  });

  it('arama listeyi de daraltır: eşleşmeyen aramada şüpheli satır düğmesi görünmez', async () => {
    cizdir();
    await screen.findByText('⚠ 2');
    fireEvent.change(screen.getByPlaceholderText(/SKU veya ürün adı ara/), { target: { value: 'çimento' } });
    expect(screen.queryByRole('button', { name: /Birim şüpheli satır/ })).toBeNull();
  });
});
