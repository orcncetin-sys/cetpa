/**
 * UlkeSecici.test.tsx — ülke seçicisi, GERÇEKTEN çizilerek. Kullanıcı isteği 2026-10-09: «şehir ve ülke seçtir droplist
 * (otomatik liste yap)».
 *
 * Ülke listesi kancası (`useCountryList`) GERÇEKTİR; yalnız `fetch` taklit edilir. Kanca BAŞARILI indeks yanıtını modül
 * önbelleğine alır (başarısız yanıtı almaz) — bu yüzden «indeks gelmedi» senaryoları ÖNCE koşar ve her biri isteğin
 * GERÇEKTEN yapıldığını doğrular (`indeksIstendi`): önbellek dolmuş olsaydı istek hiç atılmaz, test sessizce geçersiz
 * kalmak yerine kırmızıya dönerdi. İndeksi dolduran testler dosyanın SONUNDADIR.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UlkeSecici from './UlkeSecici';

const fetchTaklidi = vi.fn<(url: string) => Promise<unknown>>();

beforeEach(() => {
  fetchTaklidi.mockReset();
  fetchTaklidi.mockRejectedValue(new Error('ağ yok'));
  vi.stubGlobal('fetch', fetchTaklidi);
});
afterEach(() => { vi.unstubAllGlobals(); });

type Ek = Partial<React.ComponentProps<typeof UlkeSecici>>;

function ciz(ek: Ek = {}, baslangic?: string) {
  const onDegis = vi.fn<(kod: string) => void>();
  function Sarmal() {
    const [deger, setDeger] = useState<string | undefined>(baslangic);
    return (
      <>
        <label htmlFor="ulke">Ülke</label>
        <UlkeSecici id="ulke" deger={deger} onDegis={kod => { onDegis(kod); setDeger(kod); }} dil="tr" {...ek} />
      </>
    );
  }
  const utils = render(<Sarmal />);
  return { ...utils, onDegis };
}

const secici = () => screen.getByLabelText('Ülke') as HTMLSelectElement;
const satirlar = () => [...secici().options].map(o => ({ kod: o.value, ad: o.textContent }));
const seciliAd = () => secici().options[secici().selectedIndex]?.textContent;
/** İndeks isteği yapıldı ve sonucu kancaya işlendi (başarısız → boş liste). */
const indeksIstendi = () => waitFor(() => expect(fetchTaklidi).toHaveBeenCalledWith('/geo/cities/_index.json'));

describe('indeks GELMEDEN / istek başarısızken', () => {
  it("'Türkiye' satırı var ve SEÇİLİ — sipariş kaydedilebilir", async () => {
    ciz();
    await indeksIstendi();
    expect(satirlar()).toEqual([{ kod: 'TR', ad: 'Türkiye' }]);
    expect(secici().value).toBe('TR');
    expect(seciliAd()).toBe('Türkiye');
  });

  it("indeks 404 dönerse de aynı: yalnız 'Türkiye'", async () => {
    fetchTaklidi.mockResolvedValue({ ok: false, json: async () => ({}) });
    ciz();
    await indeksIstendi();
    expect(satirlar()).toEqual([{ kod: 'TR', ad: 'Türkiye' }]);
  });

  it("kayıtta ülke yok / `null` / geçersiz kod → 'Türkiye' GÖSTERİLİR (seçici hiç boş olmaz); onDegis çağrılmaz", async () => {
    for (const ham of [undefined, '', 'de', 'DEU']) {
      const { onDegis, unmount } = ciz({}, ham);
      await indeksIstendi();
      expect(secici().value, String(ham)).toBe('TR');
      expect(onDegis, String(ham)).not.toHaveBeenCalled();
      unmount();
      fetchTaklidi.mockClear();
    }
  });

  it("seçili 'DE' indeks gelmeden de GÖRÜNÜR (kayıt 'DE' iken ekranda 'Türkiye' görünmez)", async () => {
    ciz({}, 'DE');
    await indeksIstendi();
    expect(secici().value).toBe('DE');
    expect(seciliAd()).toBe('Almanya');
    expect(satirlar()).toEqual([{ kod: 'TR', ad: 'Türkiye' }, { kod: 'DE', ad: 'Almanya' }]);
  });

  it('adı çözülemeyen seçili kod kodun kendisiyle gösterilir (yalnız seçicide)', async () => {
    ciz({}, 'AA');
    await indeksIstendi();
    expect(secici().value).toBe('AA');
    expect(seciliAd()).toBe('AA');
  });

  it("İngilizce arayüzde ülke adı İngilizce: 'DE' → 'Germany'", async () => {
    ciz({ dil: 'en' }, 'DE');
    await indeksIstendi();
    expect(seciliAd()).toBe('Germany');
    expect(satirlar()[0].kod).toBe('TR');
  });

  it('`className` verilmezse varsayılan girdi sınıfı; verilirse o', async () => {
    const { unmount } = ciz();
    await indeksIstendi();
    expect(secici().className).toContain('apple-input');
    unmount();
    fetchTaklidi.mockClear();
    ciz({ className: 'ozel-sinif' });
    await indeksIstendi();
    expect(secici().className).toBe('ozel-sinif');
  });
});

describe('saltOkunur — mağaza kilidi', () => {
  it("kayıtta ülke YOKSA «—» — 'Türkiye' VARSAYILMAZ; kutu `readOnly`, seçici yok, ülke listesi istenmez", () => {
    const { container, onDegis } = ciz({ saltOkunur: true });
    const kutu = screen.getByLabelText('Ülke') as HTMLInputElement;
    expect(kutu.tagName).toBe('INPUT');
    expect(kutu.readOnly).toBe(true);
    expect(kutu.value).toBe('—');
    expect(container.querySelector('select')).toBeNull();
    expect(fetchTaklidi).not.toHaveBeenCalled();
    expect(onDegis).not.toHaveBeenCalled();
  });

  it('geçersiz kod da «—»', () => {
    for (const ham of ['', 'de', 'DEU']) {
      const { unmount } = ciz({ saltOkunur: true }, ham);
      expect((screen.getByLabelText('Ülke') as HTMLInputElement).value, ham).toBe('—');
      unmount();
    }
  });

  it("geçerli kodda ülke adı: 'DE' → «Almanya», 'TR' → «Türkiye»", () => {
    const { unmount } = ciz({ saltOkunur: true }, 'DE');
    expect((screen.getByLabelText('Ülke') as HTMLInputElement).value).toBe('Almanya');
    unmount();
    ciz({ saltOkunur: true }, 'TR');
    expect((screen.getByLabelText('Ülke') as HTMLInputElement).value).toBe('Türkiye');
  });
});

// ── Buradan sonrası indeksi DOLDURUR (kanca önbelleğe alır) — «indeks gelmedi» senaryoları yukarıda kalmalı. ──
describe('indeks geldikten sonra', () => {
  const INDEKS = ['DE', 'FR', 'TR', 'US'];
  beforeEach(() => { fetchTaklidi.mockResolvedValue({ ok: true, json: async () => INDEKS }); });
  const listeGeldi = () => waitFor(() => expect(secici().options.length).toBe(INDEKS.length));

  it("TR listede BİR kez geçer ve İLK satırdır; kalanlar ada göre sıralı (Türkçe)", async () => {
    ciz();
    await listeGeldi();
    expect(satirlar()).toEqual([
      { kod: 'TR', ad: 'Türkiye' },
      { kod: 'DE', ad: 'Almanya' },
      { kod: 'US', ad: 'Amerika Birleşik Devletleri' },
      { kod: 'FR', ad: 'Fransa' },
    ]);
    expect(satirlar().filter(s => s.kod === 'TR')).toHaveLength(1);
    expect(secici().value).toBe('TR');
  });

  it("seçili 'DE' liste gelince de TEK satırdır (geçici satır yinelenmez) ve seçili kalır", async () => {
    ciz({}, 'DE');
    await listeGeldi();
    expect(satirlar().filter(s => s.kod === 'DE')).toHaveLength(1);
    expect(secici().value).toBe('DE');
    expect(seciliAd()).toBe('Almanya');
  });

  it('seçim onDegis ile ISO2 kodu olarak gelir', async () => {
    const { onDegis } = ciz();
    await listeGeldi();
    fireEvent.change(secici(), { target: { value: 'DE' } });
    expect(onDegis).toHaveBeenCalledTimes(1);
    expect(onDegis).toHaveBeenCalledWith('DE');
    expect(secici().value).toBe('DE');
    fireEvent.change(secici(), { target: { value: 'TR' } });
    expect(onDegis).toHaveBeenLastCalledWith('TR');
  });

  it('indekste OLMAYAN seçili kod için tek satır eklenir, TR satırının hemen ardına', async () => {
    ciz({}, 'JP');
    await waitFor(() => expect(secici().options.length).toBe(INDEKS.length + 1));
    expect(satirlar().slice(0, 2)).toEqual([{ kod: 'TR', ad: 'Türkiye' }, { kod: 'JP', ad: 'Japonya' }]);
    expect(secici().value).toBe('JP');
  });
});
