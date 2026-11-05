/**
 * RiskPanel.test.tsx: Risk paneli GERÇEKTEN çizilir (şartname «Mikro bağlantı A» A4 + A3.4, 2026-11-05).
 * Saf kural `utils/muhasebe/riskSatirlari.test.ts`'te; burada «yazıldı ama bağlanmadı» çiti: panel yardımcıyı ÇAĞIRIR, bilinmeyen
 * bakiyeli cari listede «Bakiye bilinmiyor» rozetiyle görünür, kartta «N carinin bakiyesi bilinmiyor» ve «son bakiye çekimi» damgası.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import RiskPanel from './RiskPanel';
import { koleksiyonAyarla, sifirla } from '../hooks/useArkaPlanIsi.testDuzenegi';

vi.mock('../lib/dbClient', async () => (await import('../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi);
// recharts jsdom'da boyut ölçemez; dağılım grafiği bu testin konusu değil.
vi.mock('recharts', () => {
  const Bos = ({ children }: { children?: unknown }) => <div>{children as never}</div>;
  return { BarChart: Bos, Bar: Bos, XAxis: Bos, YAxis: Bos, CartesianGrid: Bos, Tooltip: Bos, ResponsiveContainer: Bos, Cell: Bos };
});

beforeEach(() => sifirla());

describe('RiskPanel · bakiyesi bilinmeyen cari düşmez (A4) + son bakiye çekimi damgası (A3.4)', () => {
  it('belgesi olmayan ve bakiyesi sayı olmayan cari listede «Bakiye bilinmiyor»; toplam yalnız bilinen pozitif; damga basılır', async () => {
    const simdi = Date.now();
    koleksiyonAyarla('cariBalances', [
      { id: '120.04', veri: { cariKod: '120.04', bakiye: 8000, updatedAt: new Date(simdi - 3 * 3600 * 1000).toISOString() } },
      { id: '120.02', veri: { cariKod: '120.02', bakiye: 'okunamadı', updatedAt: new Date(simdi - 5 * 3600 * 1000).toISOString() } },
    ]);
    koleksiyonAyarla('leads', [
      { id: 'l1', veri: { name: 'Borçlu Yapı', mikroCariKod: '120.04', creditLimit: 10000 } },
      { id: 'l2', veri: { name: 'Sayısız Ltd', mikroCariKod: '120.02' } },
      { id: 'l3', veri: { name: 'Belgesiz İnşaat', mikroCariKod: '120.01' } },
    ]);
    render(<RiskPanel orders={[]} leads={[]} currentLanguage="tr" userRole="Admin" />);
    expect(await screen.findByText('Belgesiz İnşaat')).toBeInTheDocument();
    expect(screen.getByText('Sayısız Ltd')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-bakiye-bilinmiyor]')).toHaveLength(2);
    expect(screen.getByText('2 carinin bakiyesi bilinmiyor')).toBeInTheDocument();
    expect(screen.getByText(/^son bakiye çekimi: /)).toBeInTheDocument();
    expect(document.querySelector('[data-bakiye-damgasi]')?.getAttribute('data-bakiye-damgasi')).toBe('taze');
    // Bilinmeyen satırlar sıralamada SONDA (varsayılan skor azalan).
    const satirlar = [...document.querySelectorAll('tbody tr')].map(tr => tr.querySelector('td')?.textContent);
    expect(satirlar[0]).toBe('Borçlu Yapı');
  });

  // Canlı veri şekli `null`dır (Mikro'dan gelmemiş alan): dinleyici `Number(x.bakiye ?? 0)` olsaydı ₺0 sayılıp limitsiz cari
  // listeden düşerdi. Metin değer ('okunamadı') NaN'a dönüştüğü için o bozmayı göstermiyordu (paket mutasyonu kaçtı, 2026-11-05).
  it('bakiyesi `null` olan limitsiz cari listede «Bakiye bilinmiyor» kalır (₺0 sayılıp düşmez)', async () => {
    koleksiyonAyarla('cariBalances', [
      { id: '120.04', veri: { cariKod: '120.04', bakiye: 8000, updatedAt: new Date().toISOString() } },
      { id: '120.07', veri: { cariKod: '120.07', bakiye: null, updatedAt: new Date().toISOString() } },
    ]);
    koleksiyonAyarla('leads', [
      { id: 'l1', veri: { name: 'Borçlu Yapı', mikroCariKod: '120.04', creditLimit: 10000 } },
      { id: 'l7', veri: { name: 'Boş Bakiyeli Yapı', mikroCariKod: '120.07' } },
    ]);
    render(<RiskPanel orders={[]} leads={[]} currentLanguage="tr" userRole="Admin" />);
    expect(await screen.findByText('Boş Bakiyeli Yapı')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-bakiye-bilinmiyor]')).toHaveLength(1);
    expect(screen.getByText('1 carinin bakiyesi bilinmiyor')).toBeInTheDocument();
  });

  it('son çekim 48 saatten eski → damga sarı ve «48 saatten eski» der', async () => {
    koleksiyonAyarla('cariBalances', [
      { id: '120.04', veri: { cariKod: '120.04', bakiye: 8000, updatedAt: new Date(Date.now() - 19 * 24 * 3600 * 1000).toISOString() } },
    ]);
    koleksiyonAyarla('leads', [{ id: 'l1', veri: { name: 'Borçlu Yapı', mikroCariKod: '120.04', creditLimit: 10000 } }]);
    render(<RiskPanel orders={[]} leads={[]} currentLanguage="tr" userRole="Admin" />);
    expect(await screen.findByText(/ · 48 saatten eski$/)).toBeInTheDocument();
    expect(document.querySelector('[data-bakiye-damgasi]')?.getAttribute('data-bakiye-damgasi')).toBe('bayat');
    expect(screen.queryByText(/carinin bakiyesi bilinmiyor/)).toBeNull();
  });
});
