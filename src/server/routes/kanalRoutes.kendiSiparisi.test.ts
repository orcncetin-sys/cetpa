/**
 * kanalRoutes — pazar yeri sipariş eşleştirmesi YALNIZ çağıranın kiracısında (2026-10-02).
 * Eskiden `where(<pazarYeriNo>).limit(1)` kiracı süzgeçsizdi: aynı numara başka kiracıda varsa O kiracının siparişi
 * güncelleniyordu. Süzgeç saf (`kendiSiparisi`); rota bağlantısı kaynak çitiyle korunur.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { kendiSiparisi } from './kanalRoutes';
import { SRC_KOK as SRC, kodSatirlari } from '../../test/kaynakTarama';

const belge = (companyId?: string) => ({ data: () => (companyId === undefined ? { ad: 'x' } : { companyId, ad: 'x' }), ref: { set: async () => undefined } });

describe('kendiSiparisi', () => {
  it('yabancı kiracının siparişi eşleşmez — sonuç boş, yeni kayıt açılır', () => {
    expect(kendiSiparisi({ docs: [belge('B')] }, 'A')).toEqual({ empty: true, docs: [] });
  });
  it('kendi siparişi ve etiketsiz (eski) kayıt eşleşir; yabancı araya girse de KENDİ kaydı seçilir', () => {
    const kendi = belge('A'), etiketsiz = belge(), bosEtiket = belge('');
    expect(kendiSiparisi({ docs: [belge('B'), kendi] }, 'A').docs).toEqual([kendi]);
    expect(kendiSiparisi({ docs: [etiketsiz] }, 'A')).toEqual({ empty: false, docs: [etiketsiz] });
    expect(kendiSiparisi({ docs: [bosEtiket] }, 'A').empty).toBe(false);
  });
  it('boş sonuç boş kalır', () => {
    expect(kendiSiparisi({ docs: [] }, 'A')).toEqual({ empty: true, docs: [] });
  });
});

describe('senkron rotaları süzgeci KULLANIR (yazıldı ama bağlanmadı çiti)', () => {
  const KANAL = join(SRC, 'server', 'routes', 'kanalRoutes.ts');
  const say = (desen: RegExp) => kodSatirlari(KANAL).filter(({ kod }) => desen.test(kod)).length;
  it('Trendyol ve Hepsiburada araması `kendiSiparisi` içinden geçer; kiracısız `.limit(1)` araması kalmadı', () => {
    expect(say(/const existing = kendiSiparisi\(await C\.getAdminDb\(\)\.collection\('orders'\)\.where\('(trendyolOrderNo|hepsiburadaOrderId)', '==', \w+\)\.get\(\), companyId\);/)).toBe(2);
    expect(say(/where\('(trendyolOrderNo|hepsiburadaOrderId)'.*\.limit\(1\)/)).toBe(0);
  });
  it('yeni kayıt ve güncelleme çağıranın kiracısıyla damgalanır', () => {
    expect(say(/\.add\(\{ companyId, \.\.\.payload, createdAt: C\.pgServerTimestamp\(\) \}\);/)).toBe(2);
    expect(say(/existing\.docs\[0\]\.ref\.set\(\{ companyId, \.\.\.payload \}, \{ merge: true \}\);/)).toBe(2);
  });
});
