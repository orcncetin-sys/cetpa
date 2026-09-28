/**
 * /api/ops/summary ve /api/ops/disk-test — ops jetonu YALNIZ başlıkta (2026-09-28). İkisi de `?token=` kabul ediyordu;
 * artık src/server/opsJeton.ts ortak kapısı. (yayinla zaten başlık-yalnızdı: opsRoutes.yayinla.test.ts.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Express } from 'express';
import { opsRoutes, type OpsRouteCtx } from './opsRoutes';
import { diskNobetcisi } from '../opsWatchdog.js';

vi.mock('../pgShim.js', () => ({ broadcastDocChange: vi.fn() }));
vi.mock('../opsWatchdog.js', () => ({ runOpsWatchdog: vi.fn(), diskNobetcisi: vi.fn(async () => ({ postaDenendi: false })) }));
vi.mock('../mikroClient.js', () => ({
  MIKRO_API_BASE: 'x', MIKRO_JUMP_SURUM: 16, MIKRO_LOCAL_MODE: false,
  getMikroCreds: vi.fn(async () => null), mikroSql: vi.fn(),
}));

type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
const gecir = () => (_r: unknown, _s: unknown, next: () => void) => next();
const pgSorgulari: string[] = [];
const C: OpsRouteCtx = {
  getAdminDb: () => null as never, requireAuth: gecir(), requireMfaVerified: gecir(), requireSuperAdmin: gecir(),
  getPgPool: () => ({ query: async (sql: string) => { pgSorgulari.push(sql); return { rows: [] }; } }),
};
async function calistir(yol: string, headers: Record<string, string>, query: Record<string, unknown> = {}) {
  const handlers: Record<string, Handler> = {};
  const kaydet = (y: string, ...mw: unknown[]) => { handlers[y] = mw[mw.length - 1] as Handler; };
  opsRoutes({ get: kaydet, post: kaydet, put: kaydet, patch: kaydet, delete: kaydet, use: kaydet } as unknown as Express, C);
  const res = { kod: 200, govde: null as unknown, json(b: unknown) { res.govde = b; return res; }, status(n: number) { res.kod = n; return res; } };
  await handlers[yol]({ headers, query, body: {} }, res);
  return res;
}
const JETON = 'gizli-abc';
const yedek = process.env.OPS_SUMMARY_TOKEN;
beforeEach(() => { process.env.OPS_SUMMARY_TOKEN = JETON; pgSorgulari.length = 0; vi.mocked(diskNobetcisi).mockClear(); });
afterEach(() => { if (yedek === undefined) delete process.env.OPS_SUMMARY_TOKEN; else process.env.OPS_SUMMARY_TOKEN = yedek; });

describe('ops uçları — jeton yalnız başlıkta', () => {
  it('summary: sorgu dizesindeki jeton 401, hiçbir okuma yapılmaz; başlıkla 200; env yoksa kendi 503 mesajı', async () => {
    const r = await calistir('/api/ops/summary', {}, { token: JETON });
    expect(r.kod).toBe(401);
    expect(pgSorgulari).toEqual([]);
    expect((await calistir('/api/ops/summary', { 'x-ops-token': JETON })).kod).toBe(200);
    delete process.env.OPS_SUMMARY_TOKEN;
    const kapali = await calistir('/api/ops/summary', { 'x-ops-token': JETON });
    expect(kapali.kod).toBe(503);
    expect(kapali.govde).toEqual({ error: 'ops summary kapalı — OPS_SUMMARY_TOKEN tanımlı değil' });
  });

  it('disk-test: sorgu dizesindeki jeton 401, test postası TETİKLENMEZ; başlıkla çalışır', async () => {
    expect((await calistir('/api/ops/disk-test', {}, { token: JETON })).kod).toBe(401);
    expect(diskNobetcisi).not.toHaveBeenCalled();
    expect((await calistir('/api/ops/disk-test', { 'x-ops-token': JETON })).kod).toBe(200);
    expect(diskNobetcisi).toHaveBeenCalledWith(true);
  });
});
