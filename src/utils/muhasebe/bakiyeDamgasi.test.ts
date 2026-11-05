import { describe, it, expect } from 'vitest';
import { bakiyeDamgasi, BAYAT_BAKIYE_ESIGI_SAAT } from './bakiyeDamgasi';
import { tarihSaatYaz } from '../zaman';
import { join } from 'path';
import { SRC_KOK, kodSatirlari } from '../../test/kaynakTarama';

// Şartname «Mikro bağlantı A» A3.4 + kullanıcı kararı (05.11.2026, soru 18): bayat eşiği 48 saat.
describe('bakiyeDamgasi · «son bakiye çekimi» + 48 saat bayat uyarısı', () => {
  const SIMDI = Date.UTC(2026, 10, 5, 9, 0);
  const saatOnce = (s: number) => SIMDI - s * 3600 * 1000;

  it('zaman yoksa damga YOK (uydurma tarih basılmaz)', () => {
    expect(bakiyeDamgasi(null, SIMDI, 'tr')).toBeNull();
    expect(bakiyeDamgasi(Number.NaN, SIMDI, 'tr')).toBeNull();
  });

  it('taze (6 saat): tr / en metin, bayat değil', () => {
    const ms = saatOnce(6);
    expect(bakiyeDamgasi(ms, SIMDI, 'tr')).toEqual({ metin: `son bakiye çekimi: ${tarihSaatYaz(ms, undefined, 'tr')}`, bayat: false });
    expect(bakiyeDamgasi(ms, SIMDI, 'en')).toEqual({ metin: `last balance pull: ${tarihSaatYaz(ms, undefined, 'en')}`, bayat: false });
  });

  it('eşik 48 saat: tam 48 saat bayat DEĞİL, 48 saat + 1 dk bayat ve metne «48 saatten eski» eklenir', () => {
    expect(BAYAT_BAKIYE_ESIGI_SAAT).toBe(48);
    expect(bakiyeDamgasi(saatOnce(48), SIMDI, 'tr')?.bayat).toBe(false);
    const bayat = bakiyeDamgasi(saatOnce(48) - 60_000, SIMDI, 'tr');
    expect(bayat?.bayat).toBe(true);
    expect(bayat?.metin).toMatch(/^son bakiye çekimi: .+ · 48 saatten eski$/);
    expect(bakiyeDamgasi(saatOnce(19 * 24), SIMDI, 'en')?.metin).toMatch(/ · older than 48 hours$/);
  });
});

// «Yazıldı ama bağlanmadı» çiti: damga üç ekranda TEK yardımcıdan (RiskPanel çizim testi RiskPanel.test.tsx'te). Muhasebe ve Siparişler
// sayfaları bu testte çizilemeyecek kadar büyük: kaynak çiti (yorumlar sayılmaz).
describe('ÇİT: «son bakiye çekimi» damgası ekranlara bağlı', () => {
  const kod = (yol: string) => kodSatirlari(join(SRC_KOK, yol)).map(x => x.kod).join('\n');
  it('MuhasebePage: dinleyici `sonGuncellemeMs` ile damga zamanını tutar; Finansal Oranlar + Bilanço alacak / borç satırı', () => {
    const k = kod('pages/MuhasebePage.tsx');
    expect(k).toContain('setCariBakiyeSonMs(sonGuncellemeMs(snap.docs.map(d => d.data().updatedAt)))');
    expect(k.split('<BakiyeDamgasi sonMs={cariBakiyeSonMs}').length - 1).toBe(3);   // oranlar + Bilanço aktif / pasif satır şablonu
    expect(k.split('bakiyeDamgasi: true').length - 1).toBe(2);                         // ticari alacak + ticari borç
  });
  it('OrdersPage «Alacak Toplam»: eski «{tarih} güncel» metni yok; saf yardımcıdan', () => {
    const k = kod('pages/OrdersPage.tsx');
    expect(k).toContain('bakiyeDamgasi(mikroAlacak.guncellemeMs, Date.now(),');
    expect(k).not.toMatch(/güncel`/);
    expect(k).not.toContain('as of ${tarihYaz(mikroAlacak.guncellemeMs)}');
  });
});
