/** GET /api/ops/summary `saat` alanı — sunucunun üç saati (2026-09-28, kullanıcı: "tzutil yaptım, doğrula"). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Express } from 'express';
import { opsRoutes, type OpsRouteCtx } from './opsRoutes';
import { getMikroCreds, mikroSql } from '../mikroClient.js';

vi.mock('../pgShim.js', () => ({ broadcastDocChange: vi.fn() }));
vi.mock('../opsWatchdog.js', () => ({ runOpsWatchdog: vi.fn(), diskNobetcisi: vi.fn() }));
vi.mock('../mikroClient.js', () => ({
  MIKRO_API_BASE: 'x', MIKRO_JUMP_SURUM: 16, MIKRO_LOCAL_MODE: false,
  getMikroCreds: vi.fn(async () => ({ firmaKodu: 'F' })),
  mikroSql: vi.fn(async () => ({ rows: [{ simdi: '2026-09-28T12:00:00.0000000+03:00', yerel: '2026-09-28T12:00:00' }], hata: null })),
}));

type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
const gecir = () => (_r: unknown, _s: unknown, next: () => void) => next();
const pgSorgulari: string[] = [];
const C: OpsRouteCtx = {
  getAdminDb: () => null as never, requireAuth: gecir(), requireMfaVerified: gecir(), requireSuperAdmin: gecir(),
  getPgPool: () => ({ query: async (sql: string) => { pgSorgulari.push(sql); return { rows: [{ dilim: 'Europe/Istanbul', simdi: '2026-09-28 12:00:00+03' }] }; } }),
};
async function ozet(token?: string) {
  const handlers: Record<string, Handler> = {};
  const kaydet = (yol: string, ...mw: unknown[]) => { handlers[yol] = mw[mw.length - 1] as Handler; };
  opsRoutes({ get: kaydet, post: kaydet, put: kaydet, patch: kaydet, delete: kaydet, use: kaydet } as unknown as Express, C);
  const res = { kod: 200, govde: null as unknown, json(b: unknown) { res.govde = b; return res; }, status(n: number) { res.kod = n; return res; } };
  await handlers['/api/ops/summary']({ headers: token === undefined ? {} : { 'x-ops-token': token }, query: {} }, res);
  return res;
}
const yedek = process.env.OPS_SUMMARY_TOKEN;
beforeEach(() => { process.env.OPS_SUMMARY_TOKEN = 'gizli-abc'; pgSorgulari.length = 0; vi.mocked(mikroSql).mockClear(); });
afterEach(() => { if (yedek === undefined) delete process.env.OPS_SUMMARY_TOKEN; else process.env.OPS_SUMMARY_TOKEN = yedek; });

describe('GET /api/ops/summary — saat', () => {
  it('jeton yoksa saat sorguları HİÇ koşmaz (401)', async () => {
    expect((await ozet('yanlis')).kod).toBe(401);
    expect(pgSorgulari).toEqual([]);
    expect(mikroSql).not.toHaveBeenCalled();
  });
  it('node + pg + mikro saatleri ayrı alanlarda; mevcut alanlar (watchdog, mikro) korunur', async () => {
    const r = await ozet('gizli-abc');
    expect(r.kod).toBe(200);
    const g = r.govde as Record<string, unknown> & { saat: Record<string, unknown> };
    expect(g).toHaveProperty('watchdog');
    expect(g.mikro).toEqual({ apiBase: 'x', localMode: false, surum: 16 });
    expect(g.saat.pg).toEqual({ dilim: 'Europe/Istanbul', simdi: '2026-09-28 12:00:00+03' });
    expect(g.saat.mikro).toEqual({ simdi: '2026-09-28T12:00:00.0000000+03:00', yerel: '2026-09-28T12:00:00' });
    expect(g.saat.node).toMatchObject({ ofsetDakika: expect.any(Number), yerel: expect.any(String) });
    expect(g.saat.node).toHaveProperty('dilim');
    // Mikro isteği KENDİ zaman aşımıyla (global 30 sn yamasına kalmaz).
    expect(vi.mocked(mikroSql).mock.calls[0][1]).toEqual({ zamanAsimiMs: 8000 });
  });
  it('Mikro yapılandırılmamışsa mikro saati null (sorgu yok), özet yine 200', async () => {
    vi.mocked(getMikroCreds).mockResolvedValueOnce(null);
    const r = await ozet('gizli-abc');
    expect(r.kod).toBe(200);
    expect((r.govde as { saat: { mikro: unknown } }).saat.mikro).toBeNull();
    expect(mikroSql).not.toHaveBeenCalled();
  });
});
