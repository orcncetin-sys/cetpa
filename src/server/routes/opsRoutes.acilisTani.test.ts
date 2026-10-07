/** opsRoutes.acilisTani.test.ts — açılış yükü / gece senkronu ölçüm ucu (2026-10-08): jeton, İŞ VERİSİ dönmez, yalnız sayım. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Express } from 'express';
import { opsRoutes, type OpsRouteCtx } from './opsRoutes';

vi.mock('../pgShim.js', () => ({ broadcastDocChange: vi.fn() }));
vi.mock('../opsWatchdog.js', () => ({ runOpsWatchdog: vi.fn(), diskNobetcisi: vi.fn() }));
const surum = vi.hoisted(() => ({ deger: 16 }));
vi.mock('../mikroClient.js', () => ({ MIKRO_API_BASE: 'x', get MIKRO_JUMP_SURUM() { return surum.deger; }, MIKRO_LOCAL_MODE: false }));

type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
function sahteApp() {
  const handlers: Record<string, Handler> = {};
  const kaydet = (yol: string, ...mw: unknown[]) => { handlers[yol] = mw[mw.length - 1] as Handler; };
  return { handlers, get: kaydet, post: kaydet, put: kaydet, patch: kaydet, delete: kaydet, use: kaydet };
}
const gecir = () => (_r: unknown, _s: unknown, next: () => void) => next();
const GIZLI = 'AHMET YILMAZ İNŞAAT';
const sorgular: string[] = [];
const SISTEM = [
  { data: { operation: 'SQL:CARI_HESAP_HAREKETLERI', entityType: 'mikroCariHareketler', entityId: '1594 kayıt', success: true, duration: 8000, userId: 'system' }, updated_at: new Date('2026-10-07T00:21:00.000Z') },
  { data: { operation: 'SQL:STOK_HAREKETLERI', entityType: 'inventoryMovements', entityId: 'Stok hareketleri', success: false, duration: 120000, userId: 'system', error: `${GIZLI} okunurken timeout` }, updated_at: new Date('2026-10-07T00:23:00.000Z') },
];
let sistemSatirlari: Array<Record<string, unknown>> = SISTEM;
let listeSatirlari: Array<Record<string, unknown>> = SISTEM;
const sorgu = async (sql: string) => {
  sorgular.push(sql);
  if (sql.includes('GROUP BY coll')) return { rows: [
    { coll: 'leads', satir: 900, bayt: '500000', son: new Date('2026-10-07T21:00:00.000Z') },
    { coll: 'inventoryMovements', satir: 5000, bayt: '9000000', son: new Date('2026-09-30T00:25:00.000Z') },
  ] };
  // Gün özeti sorgusu (yalnız sistem satırları, sınırsız) listeden AYRI — önce o ayırt edilir.
  if (sql.includes("data->>'userId' = 'system'")) return { rows: sistemSatirlari };
  if (sql.includes("coll = 'syncLog'")) return { rows: listeSatirlari };
  if (sql.includes('information_schema.tables')) return { rows: [
    { ad: 'mikro_stoklar', damgali: true }, { ad: 'mikro_tablo_eslesme', damgali: false }, { ad: 'mikro_x; DROP TABLE docs', damgali: true },
  ] };
  if (sql.includes('FROM mikro_stoklar')) return { rows: [{ satir: 2391, son: new Date('2026-10-07T21:00:05.000Z') }] };
  if (sql.includes('FROM mikro_tablo_eslesme')) return { rows: [{ satir: 16 }] };
  throw new Error(`beklenmeyen sorgu: ${sql}`);
};
const C: OpsRouteCtx = {
  getAdminDb: () => null as never, requireAuth: gecir(), requireMfaVerified: gecir(), requireSuperAdmin: gecir(),
  getPgPool: () => ({ query: sorgu }),
};
async function calistir(token: string | undefined, baglam: OpsRouteCtx = C) {
  const app = sahteApp(); opsRoutes(app as unknown as Express, baglam);
  const res = { kod: 200, govde: null as unknown, json(b: unknown) { res.govde = b; return res; }, status(n: number) { res.kod = n; return res; } };
  await app.handlers['/api/ops/acilis-tani']({ headers: token === undefined ? {} : { 'x-ops-token': token }, query: {} }, res);
  return res;
}
const yedek = process.env.OPS_SUMMARY_TOKEN;
const cronYedek = process.env.MIKRO_CRON_SYNC;
beforeEach(() => { process.env.OPS_SUMMARY_TOKEN = 'gizli-abc'; sorgular.length = 0; sistemSatirlari = SISTEM; listeSatirlari = SISTEM; surum.deger = 16; });
afterEach(() => {
  if (yedek === undefined) delete process.env.OPS_SUMMARY_TOKEN; else process.env.OPS_SUMMARY_TOKEN = yedek;
  if (cronYedek === undefined) delete process.env.MIKRO_CRON_SYNC; else process.env.MIKRO_CRON_SYNC = cronYedek;
});

describe('GET /api/ops/acilis-tani', () => {
  it('jeton yok / yanlış → 401 ve HİÇBİR sorgu koşmaz; jeton tanımsız → 503; pg havuzu yoksa 503', async () => {
    expect((await calistir(undefined)).kod).toBe(401);
    expect((await calistir('yanlis')).kod).toBe(401);
    expect(sorgular).toEqual([]);
    expect((await calistir('gizli-abc', { ...C, getPgPool: () => null })).kod).toBe(503);
    delete process.env.OPS_SUMMARY_TOKEN;
    expect((await calistir('x')).kod).toBe(503);
  });

  it('koleksiyon ölçüleri (bayta göre), ayna tabloları, zamanlanmış iş bayrakları ve günlük özeti; hata METNİ yok', async () => {
    process.env.MIKRO_CRON_SYNC = 'true';
    const r = await calistir('gizli-abc');
    expect(r.kod).toBe(200);
    expect(JSON.stringify(r.govde)).not.toContain('AHMET');
    expect(JSON.stringify(r.govde)).not.toContain('Stok hareketleri');
    expect(r.govde).toMatchObject({
      success: true,
      koleksiyonlar: [
        { ad: 'inventoryMovements', satir: 5000, bayt: 9000000, sonYazim: '2026-09-30T00:25:00.000Z' },
        { ad: 'leads', satir: 900, bayt: 500000, sonYazim: '2026-10-07T21:00:00.000Z' },
      ],
      toplam: { satir: 5900, bayt: 9500000 },
      aynalar: [
        { ad: 'mikro_stoklar', satir: 2391, sonGuncelleme: '2026-10-07T21:00:05.000Z', damga: 'herKosu' },
        { ad: 'mikro_tablo_eslesme', satir: 16, sonGuncelleme: null, damga: null },
      ],
      zamanlanmis: { mikroCronKayitli: true, mikroSurum: 16, geceStokMiktarIsiCalisir: false },
      senkron: {
        gunler: [{ gun: '2026-10-07', basarili: 1, hatali: 1, ilk: '03:21', son: '03:23' }],
        gunlerKesildi: false, kesildi: false,
        satirlar: [
          { islem: 'SQL:CARI_HESAP_HAREKETLERI', basarili: true, kayit: 1594, sistem: true, hataSinifi: null },
          { islem: 'SQL:STOK_HAREKETLERI', basarili: false, kayit: null, hataSinifi: 'zamanAsimi' },
        ],
      },
    });
  });

  it('salt okunur: yalnız SELECT koşar; katalogdan gelen ama tanımlayıcı olmayan tablo adı SQL\'e GİRMEZ; damgasız tabloda max(guncelleme) istenmez', async () => {
    await calistir('gizli-abc');
    for (const s of sorgular) expect(s.trimStart().startsWith('SELECT')).toBe(true);
    expect(sorgular.some(s => s.includes('DROP'))).toBe(false);
    expect(sorgular.find(s => s.includes('FROM mikro_tablo_eslesme'))).not.toContain('guncelleme');
    expect(sorgular.find(s => s.includes('FROM mikro_stoklar'))).toContain('max(guncelleme)');
  });

  it('liste sınırı aşılırsa SESSİZCE kesilmez: `kesildi: true`, 400 satır; gün özeti listeden DEĞİL ayrı sistem sorgusundan', async () => {
    // 401 elle işlem satırı listeyi doldurur; gece satırları listede hiç yok — özet yine de geceyi sayar.
    const elle = (i: number) => ({ data: { operation: 'StokKaydetV2', entityType: 'inventory', entityId: `id-${i}`, success: true, duration: 5, userId: 'u1' }, updated_at: new Date(Date.UTC(2026, 9, 7, 9, 0, i % 60)) });
    listeSatirlari = Array.from({ length: 401 }, (_, i) => elle(i));
    const r = await calistir('gizli-abc');
    const s = (r.govde as { senkron: { satirlar: Array<{ sistem: boolean }>; kesildi: boolean; gunlerKesildi: boolean; gunler: unknown[] } }).senkron;
    expect(s.kesildi).toBe(true);
    expect(s.satirlar).toHaveLength(400);
    expect(s.satirlar.some(x => x.sistem)).toBe(false);
    expect(s.gunler).toEqual([{ gun: '2026-10-07', basarili: 1, hatali: 1, ilk: '03:21', son: '03:23' }]);
    expect(s.gunlerKesildi).toBe(false);
    // Tam 400 satır kesilme DEĞİLDİR.
    listeSatirlari = Array.from({ length: 400 }, (_, i) => elle(i));
    expect(((await calistir('gizli-abc')).govde as { senkron: { kesildi: boolean } }).senkron.kesildi).toBe(false);
  });

  it('gün özeti sorgusu: yalnız sistem satırları, İstanbul gün başına hizalı pencere (sınır günü kısmi sayılmaz)', async () => {
    await calistir('gizli-abc');
    const q = sorgular.find(x => x.includes("data->>'userId' = 'system'")) ?? '';
    expect(q).toContain("date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul')");
    expect(q).toContain("AT TIME ZONE 'Europe/Istanbul' ORDER BY updated_at DESC LIMIT 5001");
    expect(sorgular.find(x => x.includes("interval '5 days'"))).toContain('LIMIT 401');
  });

  it('gece stok işi: cron kayıtlı DEĞİLSE sürüm 17 olsa da çalışmaz; ikisi birlikteyse çalışır; sürüm 16 ise çalışmaz', async () => {
    const z = async () => ((await calistir('gizli-abc')).govde as { zamanlanmis: unknown }).zamanlanmis;
    surum.deger = 17; process.env.MIKRO_CRON_SYNC = 'false';
    expect(await z()).toEqual({ mikroCronKayitli: false, mikroSurum: 17, geceStokMiktarIsiCalisir: false });
    process.env.MIKRO_CRON_SYNC = 'true';
    expect(await z()).toEqual({ mikroCronKayitli: true, mikroSurum: 17, geceStokMiktarIsiCalisir: true });
    surum.deger = 16;
    expect(await z()).toEqual({ mikroCronKayitli: true, mikroSurum: 16, geceStokMiktarIsiCalisir: false });
  });

  it('ayna damgasının anlamı tabloya göre: her koşuda damgalanan üç tablo "herKosu", diğer damgalı tablolar "yalnizYeniSatir"', async () => {
    const r = await calistir('gizli-abc', { ...C, getPgPool: () => ({ query: async (sql: string) => {
      if (sql.includes('information_schema.tables')) return { rows: [
        { ad: 'mikro_cari_hesaplar', damgali: true }, { ad: 'mikro_stok_hareketleri', damgali: true }, { ad: 'mikro_stok_satis_fiyat_listeleri', damgali: true },
      ] };
      if (/FROM mikro_/.test(sql)) return { rows: [{ satir: 1, son: new Date('2026-10-01T00:00:00.000Z') }] };
      return sorgu(sql);
    } }) });
    expect((r.govde as { aynalar: Array<{ ad: string; damga: string }> }).aynalar.map(a => [a.ad, a.damga])).toEqual([
      ['mikro_cari_hesaplar', 'herKosu'], ['mikro_stok_hareketleri', 'yalnizYeniSatir'], ['mikro_stok_satis_fiyat_listeleri', 'herKosu'],
    ]);
  });

  it('ortam değişkeni "true" değilse gece işleri KAYITLI DEĞİL der (değerin kendisi dönmez)', async () => {
    process.env.MIKRO_CRON_SYNC = 'evet';
    const r = await calistir('gizli-abc');
    expect((r.govde as { zamanlanmis: { mikroCronKayitli: boolean } }).zamanlanmis.mikroCronKayitli).toBe(false);
    expect(JSON.stringify(r.govde)).not.toContain('evet');
  });

  it('sorgu patlarsa 500 ve ayrıntı yanıtta YOK', async () => {
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await calistir('gizli-abc', { ...C, getPgPool: () => ({ query: async () => { throw new Error('relation "docs" does not exist'); } }) });
    expect(r.kod).toBe(500);
    expect(JSON.stringify(r.govde)).not.toContain('relation');
    hata.mockRestore();
  });
});
