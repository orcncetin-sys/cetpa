/**
 * sema-kesif ve ebelge-tani — ops jetonu YALNIZ başlıkta (2026-09-28). İkisi de `?token=` kabul ediyordu; sorgu dizesindeki
 * jeton IIS/nginx erişim günlüklerine düşer. Artık src/server/opsJeton.ts ortak kapısı.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost, mikroSql, v17MetoduKullanilabilir } from '../mikroClient.js';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS' }));
vi.mock('../mikroMirror.js', () => ({
  CHA_COLS: {}, STH_COLS: {}, FIS_COLS: {}, SIP_COLS: {},
  mirrorMikroCariler: vi.fn(async () => {}), mirrorMikroInsert: vi.fn(async () => {}), mirrorMikroStoklar: vi.fn(async () => {}),
}));
vi.mock('../mikroClient.js', async (orig) => {
  const gercek = await orig<typeof import('../mikroClient.js')>();
  return {
    ...gercek,
    getMikroCreds: vi.fn(async () => ({ firmaKodu: 'F' })),
    mikroPost: vi.fn(async () => ({ ok: true, status: 200, data: { result: [{ IsError: false, Data: {} }] } })),
    mikroVergiOranlari: vi.fn(async () => ({})),
    vergiOraniCoz: vi.fn(() => null),
    v17MetoduKullanilabilir: vi.fn(async () => true),
    mikroSql: vi.fn(async () => ({ rows: [] as Record<string, unknown>[], hata: null })),
    mikroKolonlar: vi.fn(async () => [] as string[]),
  };
});

const JETON = 'test-jetonu-abc';
const yedek = process.env.OPS_SUMMARY_TOKEN;
let d: Duzenek;
beforeEach(() => {
  process.env.OPS_SUMMARY_TOKEN = JETON;
  d = duzenekKur();
  vi.mocked(v17MetoduKullanilabilir).mockResolvedValue(true);
  vi.mocked(mikroSql).mockClear();
  vi.mocked(mikroPost).mockClear();
});
afterEach(() => { if (yedek === undefined) delete process.env.OPS_SUMMARY_TOKEN; else process.env.OPS_SUMMARY_TOKEN = yedek; });

describe.each(['/api/mikro/sema-kesif', '/api/mikro/ebelge-tani'])('%s — jeton yalnız başlıkta', (yol) => {
  const cagir = (headers: Record<string, string>, query: Record<string, unknown> = {}) => d.cagir('GET', yol, undefined, undefined, { headers, query });

  it('sorgu dizesindeki jeton 401 — Mikro\'ya hiç gidilmez', async () => {
    expect((await cagir({}, { token: JETON })).kod).toBe(401);
    expect(mikroSql).not.toHaveBeenCalled();
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('yanlış başlık 401; env tanımsız 503', async () => {
    expect((await cagir({ 'x-ops-token': 'yanlis' })).kod).toBe(401);
    delete process.env.OPS_SUMMARY_TOKEN;
    expect((await cagir({ 'x-ops-token': JETON })).kod).toBe(503);
    expect(mikroSql).not.toHaveBeenCalled();
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('doğru başlık → uç çalışır (200)', async () => {
    const r = await cagir({ 'x-ops-token': JETON });
    expect(r.kod).toBe(200);
    expect(vi.mocked(mikroSql).mock.calls.length + vi.mocked(mikroPost).mock.calls.length).toBeGreaterThan(0);
  });
});
