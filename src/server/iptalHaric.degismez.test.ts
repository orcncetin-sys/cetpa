/**
 * K2 "iptal hariç" + 2026-09-25 kullanıcı isteği ("iptal faturaları … başka bir hesaplamaya dahil olmasın"): Mikro'da
 * faturası iptal edilen MF siparişi 'Cancelled' olur. Bu yüzeylerin davranış testi YOK — kaynak çiti:
 *   • /api/reports/summary ve haftalık rapor e-postası sayım/ciroyu `siparisIptalMi` süzgecinden SONRA kurar;
 *   • pano ciro grafikleri (günlük, MTD, aylık) `iptalHaric: false` PARİTESİNE geri dönmez.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { SRC_KOK as SRC, kodSatirlari } from '../test/kaynakTarama';

const say = (yol: string, desen: RegExp) => kodSatirlari(yol).filter(x => desen.test(x.kod)).length;

describe('DEĞİŞMEZ: iptal edilen sipariş ciro/adet toplamlarına girmez', () => {
  it('rapor özeti: sipariş listesi siparisIptalMi ile süzülür ve dönem listeleri süzülmüş listeden kurulur', () => {
    const yol = join(SRC, 'server', 'routes', 'reportsRoutes.ts');
    expect(say(yol, /const iptalsiz = orders\.filter\(o => !siparisIptalMi\(o\)\)/)).toBe(1);
    expect(say(yol, /const thisOrders = iptalsiz\.filter\(/)).toBe(1);
    expect(say(yol, /const prevOrders = iptalsiz\.filter\(/)).toBe(1);
  });
  it('haftalık e-posta: hafta listeleri siparisIptalMi süzgecinden geçmiş listeden kurulur', () => {
    const yol = join(SRC, 'server', 'crons.ts');
    expect(say(yol, /const gecerli = orders\.filter\(o => !siparisIptalMi\(o\)\)/)).toBe(1);
    expect(say(yol, /const thisWeek = gecerli\.filter\(/)).toBe(1);
    expect(say(yol, /const prevWeek = gecerli\.filter\(/)).toBe(1);
  });
  it('pano: `iptalHaric: false` kalmadı; günlük/MTD/aylık ciro iptal hariç', () => {
    const yol = join(SRC, 'pages', 'DashboardPage.tsx');
    expect(say(yol, /iptalHaric:\s*false/)).toBe(0);
    expect(say(yol, /(gunlukCiro|mtdKarsilastir|aylikCiro)\(.*iptalHaric:\s*true/)).toBe(4);   // günlük + MTD + iki aylık grafik
    // KPI 'Toplam Ciro', 'Toplam Sipariş' ve '7 Günlük Ciro' da iptal hariç küme (delta hakem 2026-09-25).
    expect(say(yol, /const iptalsizSiparisler = filteredOrders\.filter\(o => !siparisIptalMi\(o\)\)/)).toBe(1);
    expect(say(yol, /panoCirosu\(iptalsizSiparisler,/)).toBe(1);
    expect(say(yol, /value: iptalsizSiparisler\.length/)).toBe(1);
    expect(say(yol, /sonNGunToplami\(orders\.filter\(o => !siparisIptalMi\(o\)\)/)).toBe(1);
    // Ortalama sipariş tutarı ve segment payları da (son hakem 2026-09-25): iptal içeren listeyle çağrı KALMADI.
    expect(say(yol, /filtreliSiparisler:\s*iptalsizSiparisler/)).toBe(1);
    expect(say(yol, /segmentCirosu\((filteredOrders|orders),/)).toBe(0);
    expect(say(yol, /segmentCirosu\((iptalsizSiparisler|orders\.filter\(o => !siparisIptalMi\(o\)\)),/)).toBe(2);
  });
});
