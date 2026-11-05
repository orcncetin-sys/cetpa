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

// Şartname «Mikro bağlantı A» A7 / AH16 (2026-11-05): `SIPARISLER` satır sayısı AYRI sorguda; tablo okunamazsa yalnız o satır hata.
describe('GET /api/mikro/sema-kesif · SIPARISLER sayımı ayrı sorguda', () => {
  const TABLOLAR = ['CARI_HESAP_HAREKETLERI', 'STOK_HAREKETLERI', 'CARI_HESAPLAR', 'STOKLAR', 'EBELGE_EVRAK_HAREKETLERI'];
  const cagir = () => d.cagir('GET', '/api/mikro/sema-kesif', undefined, undefined, { headers: { 'x-ops-token': JETON } });

  it('sorgu listesinde `siparisSatirSayisi` = yalnız COUNT; `tabloSatirSayilari` UNION\'ı aynı beş tablo, SIPARISLER YOK', async () => {
    const r = await cagir();
    expect(r.kod).toBe(200);
    const sorgular = vi.mocked(mikroSql).mock.calls.map(c => String(c[0]));
    expect(sorgular).toContain("SELECT 'SIPARISLER' t, COUNT(*) n FROM SIPARISLER");
    const union = sorgular.find(q => q.includes('UNION ALL') && q.includes("'CARI_HESAP_HAREKETLERI' t"));
    expect(union, 'tabloSatirSayilari sorgusu').toBeDefined();
    expect([...String(union).matchAll(/FROM (\w+)/g)].map(m => m[1])).toEqual(TABLOLAR);
    expect(union).not.toContain('SIPARISLER');
  });

  it('SIPARISLER okunamazsa YALNIZ o satır `{ hata }`; öteki sayımlar döner', async () => {
    vi.mocked(mikroSql).mockImplementation((async (sql: string) => (sql.includes('FROM SIPARISLER')
      ? { rows: [], hata: "Invalid object name 'SIPARISLER'" }
      : { rows: [{ t: 'X', n: 3 }], hata: null })) as unknown as typeof mikroSql);
    const r = await cagir();
    const sonuc = (r.govde as { sonuc: Record<string, unknown> }).sonuc;
    expect(sonuc.siparisSatirSayisi).toEqual({ hata: "Invalid object name 'SIPARISLER'" });
    expect(sonuc.tabloSatirSayilari).toEqual([{ t: 'X', n: 3 }]);
    vi.mocked(mikroSql).mockImplementation((async () => ({ rows: [] as Record<string, unknown>[], hata: null })) as unknown as typeof mikroSql);
  });
});
