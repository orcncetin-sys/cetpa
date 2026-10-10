// @vitest-environment jsdom
/**
 * useRouteSync × mağaza paneli onay sayfası (şartname v6 § 5.3, § 7 «girişten sonra adres parçası yerinde»).
 *
 * Onay sayfası tembel yüklenir ve `#meydan=…&tur=…` parçasını girişten SONRA, ilk çiziminde okur. Sekme durumu o arada
 * değişirse (yetkisiz sekmeden panoya dönüş, klavye kısayolu) kancanın «durum → adres» efekti `navigate('/')` çağırır ve
 * parçayı silerdi; sayfa da «bağlantı isteği bozuk» basardı. Karşı örnek aynı dosyada: korunmayan yolda adres DEĞİŞİR.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { MAGAZA_PANEL_BAGLAN_YOLU } from '../lib/magazaPanelBaglan';

const sayfaGoruntulendi = vi.hoisted(() => vi.fn());
vi.mock('../lib/trafik', () => ({ sayfaGoruntulendi }));

import { useRouteSync } from './useRouteSync';

const PARCA = `#meydan=${'M'.repeat(43)}&tur=${'T'.repeat(22)}`;
const setActiveTab = vi.fn();

function Sarmal({ sekme }: { sekme: string }) {
  useRouteSync({ activeTab: sekme, setActiveTab });
  const konum = useLocation();
  return <output data-testid="konum">{`${konum.pathname}${konum.search}${konum.hash}`}</output>;
}
const ciz = (giris: string, sekme: string) => render(<MemoryRouter initialEntries={[giris]}><Sarmal sekme={sekme} /></MemoryRouter>);
const konum = (): string => screen.getByTestId('konum').textContent ?? '';

describe('useRouteSync — `/magaza-panel-baglan` yolunda adrese DOKUNMAZ', () => {
  afterEach(() => { cleanup(); setActiveTab.mockReset(); sayfaGoruntulendi.mockReset(); });

  it('açılışta (sekme durumu yolun kendisi) yol ve parça yerinde; adresten sekme TÜRETİLMEZ', () => {
    ciz(`${MAGAZA_PANEL_BAGLAN_YOLU}${PARCA}`, 'magaza-panel-baglan');
    expect(konum()).toBe(`/magaza-panel-baglan${PARCA}`);
    expect(setActiveTab).not.toHaveBeenCalled();
    // Trafik sayacına yalnız YOL gider (parça — meydan / tur — gitmez).
    expect(sayfaGoruntulendi.mock.calls).toEqual([['/magaza-panel-baglan']]);
  });

  it('girişten sonra sekme durumu değişse de (pano, siparişler) yol ve parça YERİNDE kalır', () => {
    const { rerender } = ciz(`${MAGAZA_PANEL_BAGLAN_YOLU}${PARCA}`, 'magaza-panel-baglan');
    for (const sekme of ['dashboard', 'orders', 'dashboard']) {
      rerender(<MemoryRouter initialEntries={[`${MAGAZA_PANEL_BAGLAN_YOLU}${PARCA}`]}><Sarmal sekme={sekme} /></MemoryRouter>);
      expect(konum(), sekme).toBe(`/magaza-panel-baglan${PARCA}`);
    }
  });

  it('sekme durumu baştan «dashboard» olsa da (açılış efekti) adres değişmez', () => {
    ciz(`${MAGAZA_PANEL_BAGLAN_YOLU}${PARCA}`, 'dashboard');
    expect(konum()).toBe(`/magaza-panel-baglan${PARCA}`);
  });

  it('KARŞI ÖRNEK: korunmayan yolda aynı efekt adresi `/`a çevirir ve parçayı siler (koruma olmasa onay sayfasında da böyle olurdu)', () => {
    ciz(`/bilinmeyen-yol${PARCA}`, 'dashboard');
    expect(konum()).toBe('/');
  });

  it('koruma TAM yol eşleşmesidir: alt yol ya da benzer ad korunmaz', () => {
    ciz(`${MAGAZA_PANEL_BAGLAN_YOLU}-x${PARCA}`, 'dashboard');
    expect(konum()).toBe('/');
  });
});
