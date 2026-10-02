/**
 * CariEkstrePanel.test.tsx — cha_evrak_tip 29 "Açılış fişi" etiketi (mikro-import-arkaplan istemci §D, K-D,
 * 2026-09-24). ÖNCE YAZILDI.
 *
 * Kaynak: Mikro'nun KENDİ cari ekstresi tip 29'u "Hesap Açılış Fişi (043400)" basıyor (kullanıcının
 * yapıştırdığı Mikro çıktısı, 2026-09-24); LUCA dekontları (572 satır) bu tiptir. Eskiden ekranda
 * "Hareket (tip 29) · Borç" görünüyordu. TR-only (8 kardeş etiket de TR-only; EN UYDURULMAZ).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

// ── Matrah aşama 2 (M4, 2026-09-29): fatura satırından açılan detayın matrahı TEK KAYNAKTAN (lib/faturaMatrahi) ────────
// Eskiden `cha_aratoplam` (BRÜT) matrah diye veriliyordu; iskontolu faturada KDV (= meblağ − matrah) iskonto kadar düşük
// görünüyordu. Artık `baslikMatrahi` = aratoplam − Σcha_ft_iskonto; ft alanı henüz gelmemiş eski dokümanda BİLİNMİYOR ('—').
describe('CariEkstrePanel — fatura detayının matrahı baslikMatrahi ile', () => {
  /** SİZGEN evrak 420 başlığı (alış): aratoplam 398.317,50 − ft iskonto 114.817,50 = 283.500; meblağ 317.236,50. */
  const SIZGEN = {
    cha_evrak_tip: 63, cha_tip: 1, cha_meblag: 317236.5, cha_aratoplam: 398317.5, cha_ft_iskonto1: 85050, cha_ft_iskonto2: 29767.5,
    cha_tarihi: '2026-08-31', cha_evrakno_seri: '', cha_evrakno_sira: 420, id: 'g420',
  };
  const K420 = {
    sth_stok_kod: 'RULO1081', urunAdi: 'RULO 1081', birim: 'ADET', sth_birim_pntr: 1, sth_evrakno_seri: '', sth_evrakno_sira: 420,
    sth_tarih: '2026-08-31', sth_miktar: 1050, sth_tutar: 398317.5, sth_iskonto1: 85050, sth_iskonto2: 29767.5, sth_vergi: 33736.5, sth_vergi_pntr: 4,
  };
  const yanitla = (satir: Record<string, unknown>, kalemler: Record<string, unknown>[]) =>
    authFetch.mockImplementation((url: string) => Promise.resolve({ ok: true, json: () => Promise.resolve(
      url === '/api/mikro/fatura/kalemler' ? { success: true, kalemler } : { success: true, satirlar: [satir] }) }));
  const matrahSatiri = async () => {
    const e = (await screen.findAllByText('Matrah')).find(x => x.tagName === 'SPAN' && x.parentElement?.tagName === 'DIV');
    if (!e?.parentElement) throw new Error('"Matrah" başlık satırı yok');
    return e.parentElement;
  };
  const kdvSatiri = () => {
    const e = screen.getAllByText('KDV').find(x => x.tagName === 'SPAN' && x.parentElement?.tagName === 'DIV');
    if (!e?.parentElement) throw new Error('"KDV" başlık satırı yok');
    return e.parentElement;
  };

  it('kalemsiz: Matrah = 283.500 (brüt 398.317,50 DEĞİL), KDV = meblağ − matrah = 33.736,50', async () => {
    yanitla(SIZGEN, []);
    render(<CariEkstrePanel cariKod="320.01" currentLanguage="tr" />);
    fireEvent.click(await screen.findByTitle('Fatura detayını görüntüle'));
    expect((await matrahSatiri()).textContent).toBe('Matrah₺283.500,00');
    expect(kdvSatiri().textContent).toBe('KDV₺33.736,50');
  });

  it("kalemli: başlık Mikro'nun NET okuması sayılır (matrahKaynagi 'baslik') → not yeni dalla KAPANIR", async () => {
    yanitla(SIZGEN, [K420]);
    render(<CariEkstrePanel cariKod="320.01" currentLanguage="tr" />);
    fireEvent.click(await screen.findByTitle('Fatura detayını görüntüle'));
    await screen.findByText('RULO 1081');
    expect((await matrahSatiri()).textContent).toBe('Matrah₺168.682,50Mikro başlığı ₺283.500,00 — ₺114.817,50 brüte bir kez daha eklenmiş');
  });

  it('aynı numaralı İKİ başlık (canlıda giden 246: 12.000 + 3.000, satırlar ortak): detay matrahı başlıktan (10.000), kalemden türetilmez', async () => {
    const B1 = { cha_evrak_tip: 63, cha_tip: 0, cha_meblag: 12000, cha_aratoplam: 10000, cha_ft_iskonto1: 0, cha_tarihi: '2026-04-30', cha_evrakno_seri: '', cha_evrakno_sira: 246, id: 'g246a' };
    const B2 = { ...B1, cha_meblag: 3000, cha_aratoplam: 2500, id: 'g246b' };
    const ORTAK = [
      { sth_stok_kod: 'YPR-4160', urunAdi: 'KÜREK', birim: 'ADET', sth_birim_pntr: 1, sth_evrakno_seri: '', sth_evrakno_sira: 246, sth_tarih: '2026-04-30', sth_miktar: 200, sth_tutar: 10000, sth_vergi: 2000, sth_vergi_pntr: 4 },
      { sth_stok_kod: 'YPR-4161', urunAdi: 'KAZMA', birim: 'ADET', sth_birim_pntr: 1, sth_evrakno_seri: '', sth_evrakno_sira: 246, sth_tarih: '2026-04-30', sth_miktar: 10, sth_tutar: 2500, sth_vergi: 500, sth_vergi_pntr: 4 },
    ];
    authFetch.mockImplementation((url: string) => Promise.resolve({ ok: true, json: () => Promise.resolve(
      url === '/api/mikro/fatura/kalemler' ? { success: true, kalemler: ORTAK } : { success: true, satirlar: [B1, B2] }) }));
    render(<CariEkstrePanel cariKod="9031119677" currentLanguage="tr" />);
    const satirlar = await screen.findAllByTitle('Fatura detayını görüntüle');
    const buyuk = satirlar.find(r => r.textContent?.includes('12.000'));
    if (!buyuk) throw new Error('12.000 satırı yok');
    fireEvent.click(buyuk);
    await screen.findByText('KÜREK');
    expect((await matrahSatiri()).textContent).toContain('₺10.000,00');
    expect((await matrahSatiri()).textContent).not.toContain('12.500');
    expect(screen.getByText(/BİRDEN ÇOK fatura başlığı var/)).toBeTruthy();
  });

  it("eski doküman (ft alanı henüz yok): Matrah ve KDV '—' — brüt aratoplam matrah diye BASILMAZ", async () => {
    const { cha_ft_iskonto1: _a, cha_ft_iskonto2: _b, ...eski } = SIZGEN;
    yanitla(eski, []);
    render(<CariEkstrePanel cariKod="320.01" currentLanguage="tr" />);
    fireEvent.click(await screen.findByTitle('Fatura detayını görüntüle'));
    expect((await matrahSatiri()).textContent).toBe('Matrah—');
    expect(kdvSatiri().textContent).toBe('KDV—');
  });
});
