// @vitest-environment node
/**
 * mikroRoutes.olcumHavuzsuz.test.ts — gönderim defteri ölçüm parçası, PG HAVUZU YOKKEN (lokal Firestore yedeği): şartname
 * `.wf/SARTNAME-yeniden-deneme-sunucuda-v3.md` Ö17 kalanı / § 8.2 commit 0-B («havuz yok → kip `kapali`, kayıt 0, yanıt birebir»).
 *
 * Gerçek `server.ts` zinciri her zaman bir havuzla açılır (`DATABASE_URL` sınamada tanımlı); havuzsuz hâl ancak rota düzeyinde
 * kurulabilir — paylaşılan düzenek (`mikroRoutes.testDuzenegi.ts`) `getPgPool()`'u kilit / sorgu verilmedikçe `null` döndürür.
 * Bu süreçte kip önbelleği önceden `olcum`'a çekilmiş olsa bile havuzsuz istek `kapali` yoluna gider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost } from '../mikroClient.js';
import { MIKRO_YAZIM_SECENEGI } from '../mikro/yazimSecenegi.js';
import { gonderimKipiOku, gonderimKipiYaz } from '../mikro/gonderimDefteri.js';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS', resolveSentinels: (v: unknown) => v }));
vi.mock('../mikroMirror.js', () => ({
  CHA_COLS: {}, STH_COLS: {}, FIS_COLS: {}, SIP_COLS: {},
  mirrorMikroCariler: vi.fn(async () => {}), mirrorMikroInsert: vi.fn(async () => {}), mirrorMikroStoklar: vi.fn(async () => {}),
}));
vi.mock('../mikroClient.js', async (orig) => {
  const gercek = await orig<typeof import('../mikroClient.js')>();
  return {
    ...gercek,
    getMikroCreds: vi.fn(async () => ({ firmaKodu: 'F' })),
    mikroPost: vi.fn(),
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    vergiOraniCoz: vi.fn(() => null),
  };
});

let d: Duzenek;
beforeEach(() => {
  d = duzenekKur();
  vi.mocked(mikroPost).mockReset();
  vi.mocked(mikroPost).mockImplementation((async () => ({
    ok: true, status: 200, data: { result: [{ IsError: false, Data: { evrakNo: 'Z-1' } }] },
  })) as unknown as typeof mikroPost);
});

describe('havuz yok (lokal Firestore yedeği) → kip `kapali`, kayıt 0, yanıt bugünkü', () => {
  it('önbellek `olcum` olsa bile havuzsuz istek: Mikro\'ya 1 çağrı (aynı argümanlar), yanıt bugünkü şekil, kip okuması `kapali`', async () => {
    // Bu süreçteki kip önbelleğini `olcum`'a çek (tek oturumlu sahte havuzla geçerli bir yazım).
    const sorgular: string[] = [];
    const sahte = { query: async (sql: string) => { sorgular.push(sql); return { rows: [], rowCount: 0 }; } };
    const yazim = await gonderimKipiYaz({ ...sahte, connect: async () => ({ ...sahte, release: () => undefined }) }, { kip: 'olcum', neden: 'önbellek' });
    expect(yazim.tamam).toBe(true);
    expect(await gonderimKipiOku(sahte)).toBe('olcum');
    expect(d.C.getPgPool()).toBeNull();
    expect(await gonderimKipiOku(d.C.getPgPool())).toBe('kapali');

    const res = await d.cagir('POST', '/api/mikro/evrak/kaydet', { method: 'ZiyaretKaydetV2', payload: { a: 1 }, entityType: 'leadVisit', entityId: 'v1' });
    expect(res.kod).toBe(200);
    expect(res.govde).toEqual({ success: true, error: null, data: { evrakNo: 'Z-1' } });
    expect(mikroPost).toHaveBeenCalledTimes(1);
    expect(mikroPost).toHaveBeenCalledWith('ZiyaretKaydetV2', { a: 1 }, true, MIKRO_YAZIM_SECENEGI);
    expect(d.syncLog).toHaveBeenCalledWith('ZiyaretKaydetV2', 'leadVisit', 'v1', true, null, null, expect.any(Number), expect.anything());
    // Düzenekte havuz yok: ölçüm kaydı için hiçbir yere sorgu gitmedi (yalnız kip yazımının kendi sorguları).
    expect(sorgular.filter(s => s.includes('mikroGonderimleri'))).toEqual([]);
  });
});
