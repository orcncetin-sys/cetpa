/** opsRoutes.yayinla.test.ts — bakım scriptinin SSE yayın ucu (2026-09-11): token, doğrulama, broadcast. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Express } from 'express';
import { opsRoutes, type OpsRouteCtx } from './opsRoutes';
import { broadcastDocChange } from '../pgShim.js';

vi.mock('../pgShim.js', () => ({ broadcastDocChange: vi.fn() }));
vi.mock('../opsWatchdog.js', () => ({ runOpsWatchdog: vi.fn(), diskNobetcisi: vi.fn() }));
vi.mock('../mikroClient.js', () => ({ MIKRO_API_BASE: 'x', MIKRO_JUMP_SURUM: 16, MIKRO_LOCAL_MODE: false }));

type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
function sahteApp() {
  const handlers: Record<string, Handler> = {};
  const kaydet = (yol: string, ...mw: unknown[]) => { handlers[yol] = mw[mw.length - 1] as Handler; };
  return { handlers, get: kaydet, post: kaydet, put: kaydet, patch: kaydet, delete: kaydet, use: kaydet };
}
const gecir = () => (_r: unknown, _s: unknown, next: () => void) => next();
const docs: Record<string, Record<string, unknown>> = { 'leads/a': { name: 'Şirin Yapı' } };
const C: OpsRouteCtx = {
  getAdminDb: () => null as never, requireAuth: gecir(), requireMfaVerified: gecir(), requireSuperAdmin: gecir(),
  getPgPool: () => ({ query: async (_sql: string, params?: unknown[]) => ({ rows: (params?.[1] as string[]).filter(id => docs[`${params?.[0]}/${id}`]).map(id => ({ id, data: docs[`${params?.[0]}/${id}`] })) }) }),
};
async function calistir(body: unknown, token: string | undefined) {
  const app = sahteApp(); opsRoutes(app as unknown as Express, C);
  const res = { kod: 200, govde: null as unknown, json(b: unknown) { res.govde = b; return res; }, status(n: number) { res.kod = n; return res; } };
  await app.handlers['/api/ops/yayinla']({ headers: token === undefined ? {} : { 'x-ops-token': token }, body }, res);
  return res;
}
const yedek = process.env.OPS_SUMMARY_TOKEN;
beforeEach(() => { process.env.OPS_SUMMARY_TOKEN = 'gizli-abc'; vi.mocked(broadcastDocChange).mockClear(); });
afterEach(() => { if (yedek === undefined) delete process.env.OPS_SUMMARY_TOKEN; else process.env.OPS_SUMMARY_TOKEN = yedek; });

describe('POST /api/ops/yayinla', () => {
  it('token yanlış/yok → 401, yayın yok', async () => {
    expect((await calistir({ coll: 'leads', ids: ['a'] }, 'yanlis')).kod).toBe(401);
    expect((await calistir({ coll: 'leads', ids: ['a'] }, undefined)).kod).toBe(401);
    expect(broadcastDocChange).not.toHaveBeenCalled();
  });
  it("coll geçersiz → 400 (SQL'e girmez)", async () => {
    expect((await calistir({ coll: "docs; DROP", ids: ['a'] }, 'gizli-abc')).kod).toBe(400);
  });
  it("var olan id'ler 'set' (taze veriyle), silinenler 'delete' olarak yayınlanır; olmayan id atlanır", async () => {
    const r = await calistir({ coll: 'leads', ids: ['a', 'yok'], silinen: ['b'] }, 'gizli-abc');
    expect(r.govde).toEqual({ success: true, yayin: 2 });
    expect(broadcastDocChange).toHaveBeenCalledWith('leads', 'set', 'a', { name: 'Şirin Yapı' });
    expect(broadcastDocChange).toHaveBeenCalledWith('leads', 'delete', 'b');
  });
  it('token tanımsızsa 503', async () => {
    delete process.env.OPS_SUMMARY_TOKEN;
    expect((await calistir({ coll: 'leads', ids: ['a'] }, 'x')).kod).toBe(503);
  });
});
