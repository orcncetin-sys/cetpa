// @vitest-environment node
/**
 * mfKaynaksizIsareti.test.ts: kaynaksız MF işaretinin doğrudan SQL yazıcısı / silicisi (şartname «Mikro bağlantı B» B2 § 4.2, BH12;
 * T-B2-2, T-B2-4). GERÇEK SQL (PGlite; `docs` canlıyla aynı DDL). Mikro'ya istek YOK.
 *
 * Mutasyonlar (yapılıp geri alındı, raporda): eşik kapısı silinir → T-B2-2 kırmızı; YAZ SQL'inden kiracı ya da kaynak koşulu
 * silinir → T-B2-4 «yabancı / MF dışı» kırmızı; KALDIR SQL'inden aynı koşullar silinir → T-B2-4 kaldırma kırmızı.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { pgliteDocs, type PgliteDocs } from '../routes/mikroRoutes.testDuzenegi';
import { MF_KAYNAKSIZ_ESIGI, MF_KAYNAKSIZ_KALDIR_SQL, MF_KAYNAKSIZ_YAZ_SQL, mfKaynaksizIsaretle } from './mfKaynaksizIsareti';
import { MF_KAYNAGI } from '../../lib/mfKaynagi';

let h: PgliteDocs;
beforeAll(async () => { h = await pgliteDocs(); }, 60_000);
beforeEach(async () => { await h.temizle(); });

const MF = (ek: Record<string, unknown> = {}) => ({ companyId: 'A', source: MF_KAYNAGI, status: 'Delivered', totalPrice: 1200, ...ek });
const kos = async (g: { adaylar?: string[]; kaldirilacak?: string[] }, cid = 'A') => {
  const yayinlar: Array<[string, unknown]> = [];
  const s = await mfKaynaksizIsaretle({ query: h.sorgu }, cid,
    { adaylar: g.adaylar ?? [], kaldirilacak: g.kaldirilacak ?? [], simdiIso: '2026-11-06T00:20:00.000Z' }, (id, d) => yayinlar.push([id, d]));
  return { s, yayinlar };
};

describe('yaz · idempotent, ilk görülme zamanı, durum değişmez', () => {
  it('aday işaretlenir (`mfKaynaksiz: true`, `mfKaynaksizGoruldu`); status / totalPrice aynı; ikinci koşu 0 yazım, zaman ilk koşununki', async () => {
    await h.belgeKoy('orders', 'mf-325', MF());
    const ilk = await kos({ adaylar: ['mf-325'] });
    expect(ilk.s).toEqual({ isaretlenen: 1, kaldirilan: 0, esikAsildi: null });
    expect(await h.belgeOku('orders', 'mf-325')).toEqual({ ...MF(), mfKaynaksiz: true, mfKaynaksizGoruldu: '2026-11-06T00:20:00.000Z' });
    expect(ilk.yayinlar.map(y => y[0])).toEqual(['mf-325']);
    expect(ilk.yayinlar[0][1]).toMatchObject({ mfKaynaksiz: true });
    const ikinci = await mfKaynaksizIsaretle({ query: h.sorgu }, 'A', { adaylar: ['mf-325'], kaldirilacak: [], simdiIso: '2026-11-07T00:20:00.000Z' }, () => {});
    expect(ikinci).toEqual({ isaretlenen: 0, kaldirilan: 0, esikAsildi: null });
    expect((await h.belgeOku('orders', 'mf-325'))?.mfKaynaksizGoruldu).toBe('2026-11-06T00:20:00.000Z');
  });
  it('havuz yoksa / kiracı boşsa hiçbir şey yapılmaz (`null`)', async () => {
    expect(await mfKaynaksizIsaretle(null, 'A', { adaylar: ['x'], kaldirilacak: [], simdiIso: '' }, () => {})).toBeNull();
    expect(await mfKaynaksizIsaretle({ query: h.sorgu }, '', { adaylar: ['x'], kaldirilacak: [], simdiIso: '' }, () => {})).toBeNull();
  });
});

describe('T-B2-2 · olağandışılık eşiği', () => {
  it(`${MF_KAYNAKSIZ_ESIGI + 1} aday → 0 yazım, \`esikAsildi\` = ${MF_KAYNAKSIZ_ESIGI + 1}; kaldırma yine yapılır`, async () => {
    const adaylar = Array.from({ length: MF_KAYNAKSIZ_ESIGI + 1 }, (_, i) => `mf-${i}`);
    for (const id of adaylar) await h.belgeKoy('orders', id, MF());
    await h.belgeKoy('orders', 'mf-geri', MF({ mfKaynaksiz: true, mfKaynaksizGoruldu: '2026-11-01T00:00:00.000Z' }));
    const { s } = await kos({ adaylar, kaldirilacak: ['mf-geri'] });
    expect(s).toEqual({ isaretlenen: 0, kaldirilan: 1, esikAsildi: MF_KAYNAKSIZ_ESIGI + 1 });
    for (const id of adaylar) expect(await h.belgeOku('orders', id)).not.toHaveProperty('mfKaynaksiz');
    expect(await h.belgeOku('orders', 'mf-geri')).toEqual(MF());
  });
  it(`tam ${MF_KAYNAKSIZ_ESIGI} aday eşiği AŞMAZ → yazılır`, async () => {
    const adaylar = Array.from({ length: MF_KAYNAKSIZ_ESIGI }, (_, i) => `mf-${i}`);
    for (const id of adaylar) await h.belgeKoy('orders', id, MF());
    expect((await kos({ adaylar })).s).toEqual({ isaretlenen: MF_KAYNAKSIZ_ESIGI, kaldirilan: 0, esikAsildi: null });
  });
});

describe('T-B2-4 · doğrudan SQL yazıcısı kiracı ve kaynak koşulunu taşır (yaz VE kaldır, BH12)', () => {
  it('MF dışı siparişe ve başka kiracının MF siparişine işaret YAZILMAZ; kendi MF siparişine yazılır', async () => {
    await h.belgeKoy('orders', 'cetpa-1', { companyId: 'A', source: 'manual', status: 'Delivered' });
    await h.belgeKoy('orders', 'mf-yabanci', MF({ companyId: 'B' }));
    await h.belgeKoy('orders', 'mf-etiketsiz', { source: MF_KAYNAGI, status: 'Delivered' });
    await h.belgeKoy('orders', 'mf-ok', MF());
    const { s, yayinlar } = await kos({ adaylar: ['cetpa-1', 'mf-yabanci', 'mf-etiketsiz', 'mf-ok'] });
    expect(s?.isaretlenen).toBe(1);
    expect(yayinlar.map(y => y[0])).toEqual(['mf-ok']);
    for (const id of ['cetpa-1', 'mf-yabanci', 'mf-etiketsiz']) expect(await h.belgeOku('orders', id), id).not.toHaveProperty('mfKaynaksiz');
  });
  it('kaldırma da yalnız kendi kiracısının MF siparişinde; işaretsiz satıra yazım (yayın) yok', async () => {
    const isaretli = { mfKaynaksiz: true, mfKaynaksizGoruldu: '2026-11-01T00:00:00.000Z' };
    await h.belgeKoy('orders', 'mf-yabanci', MF({ companyId: 'B', ...isaretli }));
    await h.belgeKoy('orders', 'cetpa-isaretli', { companyId: 'A', source: 'manual', ...isaretli });
    await h.belgeKoy('orders', 'mf-isaretsiz', MF());
    await h.belgeKoy('orders', 'mf-ok', MF(isaretli));
    const { s, yayinlar } = await kos({ kaldirilacak: ['mf-yabanci', 'cetpa-isaretli', 'mf-isaretsiz', 'mf-ok'] });
    expect(s).toEqual({ isaretlenen: 0, kaldirilan: 1, esikAsildi: null });
    expect(yayinlar.map(y => y[0])).toEqual(['mf-ok']);
    expect(await h.belgeOku('orders', 'mf-ok')).toEqual(MF());
    expect(await h.belgeOku('orders', 'mf-yabanci')).toMatchObject({ mfKaynaksiz: true });
    expect(await h.belgeOku('orders', 'cetpa-isaretli')).toMatchObject({ mfKaynaksiz: true });
  });
  it('SQL metinleri: iki deyim de kiracı + MF kaynağı + RETURNING taşır', () => {
    for (const sql of [MF_KAYNAKSIZ_YAZ_SQL, MF_KAYNAKSIZ_KALDIR_SQL]) {
      expect(sql).toContain("data->>'companyId' = $2");
      expect(sql).toContain(`data->>'source' = '${MF_KAYNAGI}'`);
      expect(sql).toContain("coll = 'orders'");
      expect(sql).toContain('RETURNING id, data');
    }
  });
});
