/** opsRoutes.sirTani.test.ts — settings / auditLog sır ölçüm ucu (2026-10-02): jeton, DEĞER dönmez, yalnız sayım. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Express } from 'express';
import { opsRoutes, type OpsRouteCtx } from './opsRoutes';

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
const SIR = 'cok-gizli-anahtar-123';
const sorgu = async (sql: string) => {
  if (sql.includes("coll = 'settings'")) return { rows: [
    { id: 'luca', data: { apiKey: SIR, companyId: 'LUCA-FIRMA', baseUrl: 'https://api.luca.com.tr' } },
    { id: 'kiraciA__app', data: { companyId: 'kiraciA', companySettings: { shopify_access_token: SIR, signature: 'CETPA A.Ş.' } } },
  ] };
  if (sql.includes("data ? 'diff'")) return { rows: [
    { data: { details: 'settings/luca güncellendi', diff: { apiKey: { from: 'eski-anahtar', to: SIR } }, timestamp: '2026-09-01T10:00:00.000Z' } },
    { data: { details: 'leads/x güncellendi', diff: { name: { from: 'a', to: 'b' } }, timestamp: '2026-09-02T10:00:00.000Z' } },
  ] };
  if (sql.includes("coll = 'auditLog'")) return { rows: [{ n: 40 }] };
  if (sql.includes("coll = 'users'")) return { rows: [{ n: 1 }] };
  if (sql.includes("coll = 'orders'")) return { rows: [{ kaynak: 'mikro_import', n: 700 }, { kaynak: '(boş)', n: 12 }] };
  throw new Error(`beklenmeyen sorgu: ${sql}`);
};
const C: OpsRouteCtx = {
  getAdminDb: () => null as never, requireAuth: gecir(), requireMfaVerified: gecir(), requireSuperAdmin: gecir(),
  getPgPool: () => ({ query: sorgu }), serverTenantId: async () => 'kiraciA',
};
async function calistir(token: string | undefined, baglam: OpsRouteCtx = C) {
  const app = sahteApp(); opsRoutes(app as unknown as Express, baglam);
  const res = { kod: 200, govde: null as unknown, json(b: unknown) { res.govde = b; return res; }, status(n: number) { res.kod = n; return res; } };
  await app.handlers['/api/ops/sir-tani']({ headers: token === undefined ? {} : { 'x-ops-token': token } }, res);
  return res;
}
const yedek = process.env.OPS_SUMMARY_TOKEN;
beforeEach(() => { process.env.OPS_SUMMARY_TOKEN = 'gizli-abc'; });
afterEach(() => { if (yedek === undefined) delete process.env.OPS_SUMMARY_TOKEN; else process.env.OPS_SUMMARY_TOKEN = yedek; });

describe('GET /api/ops/sir-tani', () => {
  it('jeton yok / yanlış → 401; jeton tanımsız → 503', async () => {
    expect((await calistir(undefined)).kod).toBe(401);
    expect((await calistir('yanlis')).kod).toBe(401);
    delete process.env.OPS_SUMMARY_TOKEN;
    expect((await calistir('x')).kod).toBe(503);
  });
  it('yanıt SIR DEĞERİ ve KİRACI KİMLİĞİ taşımaz — yalnız sayar', async () => {
    const r = await calistir('gizli-abc');
    expect(r.kod).toBe(200);
    const metin = JSON.stringify(r.govde);
    for (const yasak of [SIR, 'eski-anahtar', 'kiraciA', 'LUCA-FIRMA']) expect(metin).not.toContain(yasak);
    expect(r.govde).toMatchObject({
      success: true,
      ayarlar: [
        { anahtar: '<kiracı>__app', firmaBazli: true, etiketli: true, sirAlani: 1, bozukSir: 0 },
        { anahtar: 'luca', firmaBazli: false, etiketli: true, sirAlani: 1, bozukSir: 0 },
      ],
      denetim: { toplamSatir: 40, satir: 2, farkliSatir: 2, sirliSatir: 1, sirliAlan: 1, koleksiyonlar: { 'settings': 1 } },
      kiraci: { sayi: 1, sahipCozuluyor: true },
      siparisKaynaklari: { mikro_import: 700, '(boş)': 12 },
    });
  });
  it('sahip kiracı çözülemiyorsa bunu söyler; pg havuzu yoksa 503', async () => {
    const r = await calistir('gizli-abc', { ...C, serverTenantId: async () => '' });
    expect((r.govde as { kiraci: { sahipCozuluyor: boolean } }).kiraci.sahipCozuluyor).toBe(false);
    expect((await calistir('gizli-abc', { ...C, getPgPool: () => null })).kod).toBe(503);
  });
});
