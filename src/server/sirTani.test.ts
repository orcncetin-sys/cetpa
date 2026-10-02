/** sirTani — geçmiş denetim kayıtlarında ve ayar dokümanlarında düz metin sır ÖLÇÜMÜ; değer döndürmez (2026-10-02). */
import { describe, it, expect } from 'vitest';
import { farkMaskele, auditSirSayimi, ayarOzeti } from './sirTani';
import { MASKE } from '../lib/sirMaske';

describe('farkMaskele', () => {
  it('sır adlı alanın from/to değerleri ve iç içe sırlar maskelenir; sır olmayan fark aynen', () => {
    const r = farkMaskele({ apiKey: { from: 'eski', to: 'yeni' }, status: { from: 'A', to: 'B' }, companySettings: { from: { shopify_access_token: 't', store: 'x' }, to: { store: 'y' } } });
    expect(r).toEqual({ degisti: true, sirliAlan: 2, diff: {
      apiKey: { from: MASKE, to: MASKE }, status: { from: 'A', to: 'B' },
      companySettings: { from: { shopify_access_token: MASKE, store: 'x' }, to: { store: 'y' } } } });
  });
  it('maskelenecek sır yoksa AYNI nesne döner; zaten maskeli fark yeniden sayılmaz; fark nesne değilse dokunulmaz', () => {
    const d = { status: { from: 'A', to: 'B' }, apiKey: { from: MASKE, to: MASKE }, bos: { from: undefined, to: '' } };
    const r = farkMaskele(d);
    expect(r.degisti).toBe(false);
    expect(r.diff).toBe(d);
    expect(farkMaskele('metin')).toEqual({ diff: 'metin', degisti: false, sirliAlan: 0 });
  });
});

describe('auditSirSayimi — yalnız SAYAR', () => {
  it('sırlı satır / alan sayısı, koleksiyon kırılımı ve tarih aralığı; çıktıda sır DEĞERİ yok', () => {
    const s = auditSirSayimi([
      { details: 'settings/mikro', timestamp: '2026-08-01T10:00:00Z', diff: { idmPassword: { from: 'gizli1', to: 'gizli2' }, alias: { from: 'a', to: 'b' } } },
      { details: 'settings/app', timestamp: { _seconds: 1790000000, _nanoseconds: 0 }, diff: { companySettings: { from: {}, to: { shopify_api_secret: 'gizli3' } } } },
      { details: 'orders/o1', timestamp: '2026-09-01T10:00:00Z', diff: { status: { from: 'A', to: 'B' } } },
      { details: 'leads/l1 (x)', timestamp: '2026-09-02T10:00:00Z' },
    ]);
    expect(s).toMatchObject({ satir: 4, farkliSatir: 3, sirliSatir: 2, sirliAlan: 2, koleksiyonlar: { settings: 2 }, enEski: '2026-08-01T10:00:00Z' });
    expect(JSON.stringify(s)).not.toMatch(/gizli/);
  });
});

describe('ayarOzeti', () => {
  it('kiracı kimliği gizlenir, dolu sır alanı sayılır (boş sır sayılmaz), değer dönmez', () => {
    const o = ayarOzeti([
      { id: 'trendyol', data: { supplierId: 's', apiKey: 'k', apiSecret: '' } },
      { id: 'KIRACI123__app', data: { companyId: 'KIRACI123', companySettings: { shopify_access_token: 'shpat', shopify_api_secret: 'x' } } },
    ]);
    expect(o).toEqual([
      { anahtar: '<kiracı>__app', firmaBazli: true, etiketli: true, sirAlani: 2, bozukSir: 0 },
      { anahtar: 'trendyol', firmaBazli: false, etiketli: false, sirAlani: 1, bozukSir: 0 },
    ]);
    expect(JSON.stringify(o)).not.toMatch(/KIRACI123|shpat/);
  });
  it('veritabanında DÜZ maske metni duran alan dolu sır SAYILMAZ, ayrı bildirilir (sır yok olmuş — yeniden girilmeli)', () => {
    const o = ayarOzeti([{ id: 'K__app', data: { companySettings: { shopify_access_token: '***REDACTED***', shopify_api_secret: 'gercek' } } }]);
    expect(o).toEqual([{ anahtar: '<kiracı>__app', firmaBazli: true, etiketli: false, sirAlani: 1, bozukSir: 1 }]);
  });
  it('kiracı kimliği ilk `__`\'ye kadardır — anahtarın kendisinde `__` olsa da kimlik sızmaz', () => {
    expect(ayarOzeti([{ id: 'KIRACI9__a__b', data: {} }])[0].anahtar).toBe('<kiracı>__a__b');
  });
});
