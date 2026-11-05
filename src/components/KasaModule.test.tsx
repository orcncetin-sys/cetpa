/**
 * KasaModule.test.tsx: Kasa ekranı GERÇEKTEN çizilir (şartname «Mikro bağlantı A» A5.4, 2026-11-05). Saf kural
 * `utils/muhasebe/kasaBakiye.test.ts`'te; burada «yazıldı ama bağlanmadı» çiti: Mikro kasası adıyla görünür, kartı yeşil ₺0 değil
 * «Bakiye bilinmiyor», listenin üstünde «N kasanın bakiyesi bilinmiyor»; hareketsiz Cetpa kasası gerçek ₺0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import KasaModule from './KasaModule';
import { koleksiyonAyarla, sifirla } from '../hooks/useArkaPlanIsi.testDuzenegi';

vi.mock('../lib/dbClient', async () => (await import('../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi);

beforeEach(() => sifirla());

describe('KasaModule · Mikro kasası bakiyesi bilinmiyor (A5.4)', () => {
  it('Mikro kasası (`kasaAdi`) adıyla; kartı «Bakiye bilinmiyor»; not 1; Cetpa kasası ₺0,00', async () => {
    koleksiyonAyarla('kasalar', [
      { id: 'mikro-k1', veri: { companyId: 'A', kasaAdi: 'MERKEZ KASA', currency: 'TRY', bakiye: 0, source: 'mikro' } },
      { id: 'c1', veri: { ad: 'Şube Kasası', doviz: 'TRY', durum: 'Aktif', sorumlu: 'Ayşe Çelik' } },
    ]);
    render(<KasaModule currentLanguage="tr" isAuthenticated />);
    fireEvent.click(await screen.findByRole('button', { name: 'Kasalar' }));
    expect(await screen.findByText('MERKEZ KASA')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-kasa-bakiye-bilinmiyor]')).toHaveLength(1);
    expect(screen.getByText('Bakiye bilinmiyor · Mikro kasa hareketleri aktarılmıyor')).toBeInTheDocument();
    expect(screen.getByText('1 kasanın bakiyesi bilinmiyor · Mikro kasa hareketleri aktarılmıyor')).toBeInTheDocument();
    expect(screen.getByText('Şube Kasası').closest('.apple-card')?.textContent).toContain('₺0,00');
  });
});
