/**
 * trackingRoutes.test.ts — UYDURMA KARGO VERİSİ YOK (Faz 1, 2026-09-04).
 *
 * Eskiden API anahtarı tanımlı değilken her takip numarasına sahte olaylar
 * dönüyordu ("Frankfurt→İstanbul, 2 gün sonra teslim"; "Ankara Dağıtım
 * Merkezi: Dağıtıma çıktı") ve ekran bunu gerçek gibi basıyordu. Bu test,
 * anahtarsız yolun BOŞ olay listesi + açık `error` döndürdüğünü kilitler.
 * Kalıp: aiRoutes.test.ts (sahte Express, handler yakalama).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { trackingRoutes } from './trackingRoutes';

type Handler = (req: unknown, res: { json: (b: unknown) => void; status: (n: number) => { json: (b: unknown) => void } }) => Promise<void> | void;

/** Rota kaydını yutan sahte Express — SON argüman handler'dır. */
function sahteApp() {
  const handlers: Record<string, Handler> = {};
  const kaydet = (yol: string, ...mw: unknown[]) => { handlers[yol] = mw[mw.length - 1] as Handler; };
  return { handlers, get: kaydet, post: kaydet, put: kaydet, patch: kaydet, delete: kaydet };
}
const gecir = () => (_r: unknown, _s: unknown, next: () => void) => next();

async function calistir(yol: string, params: Record<string, string>, body: Record<string, unknown> = {}) {
  const app = sahteApp();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trackingRoutes(app as any, { requireAuth: gecir(), requireMfaVerified: gecir() });
  let govde: unknown = null; let kod = 200;
  const res = { json: (b: unknown) => { govde = b; }, status: (n: number) => { kod = n; return { json: (b: unknown) => { govde = b; } }; } };
  await app.handlers[yol]({ params, body }, res);
  return { govde: govde as Record<string, unknown>, kod };
}

const ANAHTARLAR = ['DHL_API_KEY', 'UPS_CLIENT_ID', 'UPS_CLIENT_SECRET', 'FEDEX_CLIENT_ID', 'FEDEX_CLIENT_SECRET', 'YURTICI_API_KEY', 'MNG_API_KEY', 'ARAS_API_KEY'];
const yedek: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of ANAHTARLAR) { yedek[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ANAHTARLAR) { if (yedek[k] === undefined) delete process.env[k]; else process.env[k] = yedek[k]; } });

const uydurmaDegil = (g: Record<string, unknown>, carrier: string) => {
  expect(g.configured, 'configured:false gelmeli').toBe(false);
  expect(g.carrier).toBe(carrier);
  expect(g.events, 'UYDURMA OLAY GİTMEMELİ — events boş').toEqual([]);
  expect(String(g.error), 'sebep açık yazılmalı').toMatch(/tanımlı değil/);
  expect(String(g.status)).toMatch(/yapılandırılmamış/i);
  expect(g.mock).toBe(false);
  expect(JSON.stringify(g), 'sahte şehir/olay kalıntısı').not.toMatch(/Frankfurt|Leipzig|Ankara Dağıtım|Louisville|Memphis/);
};

describe('trackingRoutes — anahtar yokken uydurma veri YOK', () => {
  it('DHL', async () => {
    const { govde } = await calistir('/api/tracking/dhl/:trackingNumber', { trackingNumber: 'X1' });
    uydurmaDegil(govde, 'DHL'); expect(govde.trackingNumber).toBe('X1');
  });
  it('UPS', async () => {
    const { govde } = await calistir('/api/tracking/ups/:trackingNumber', { trackingNumber: '1Z9' });
    uydurmaDegil(govde, 'UPS');
  });
  it('FedEx (POST, gövdeden takip no)', async () => {
    const { govde } = await calistir('/api/tracking/fedex', {}, { trackingNumber: 'FX7' });
    uydurmaDegil(govde, 'FedEx'); expect(govde.trackingNumber).toBe('FX7');
  });
  it.each([['yurtici', 'Yurtiçi'], ['mng', 'MNG'], ['aras', 'Aras']])('%s', async (yol, carrier) => {
    const { govde } = await calistir(`/api/tracking/${yol}/:no`, { no: 'TR1' });
    uydurmaDegil(govde, carrier);
  });
  it('istemci sözleşmesi: `error` dolu → trackingService bunu throw eder, ekran gösterir', async () => {
    const { govde } = await calistir('/api/tracking/dhl/:trackingNumber', { trackingNumber: 'X' });
    expect(typeof govde.error).toBe('string'); expect((govde.error as string).length).toBeGreaterThan(5);
  });
});

/**
 * DEĞİŞMEZ TESTİ (tdd-workflow kural 3 — kaynak-tarayan kilit).
 * Davranış testleri anahtarsız yolu kilitler; bu test ise KAYNAĞIN kendisini
 * tarar: biri ileride "demo için" yeniden sahte olay üreticisi eklerse, davranış
 * testleri yeni fonksiyonu görmeyebilir — bu görür.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
describe('trackingRoutes kaynağı — uydurma veri üreticisi geri gelemez', () => {
  const kaynak = readFileSync(resolve(__dirname, 'trackingRoutes.ts'), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');   // yorumlar hariç
  it("kodda `mock: true` yok", () => expect(kaynak).not.toMatch(/mock:\s*true/));
  it('kodda sahte şehir/hub sabiti yok', () =>
    expect(kaynak).not.toMatch(/Frankfurt|Leipzig Hub|Louisville|Memphis|Ankara Dağıtım Merkezi|Sender City/));
  it('her anahtarsız dal `yapilandirilmamis` ya da `alinamadi` üzerinden döner', () => {
    const resJsonObje = kaynak.match(/res\.json\(\{\s*\n/g) ?? [];   // çok satırlı elle kurulmuş nesne = şüpheli
    expect(resJsonObje.length, 'çok satırlı elle kurulmuş res.json({...}) bloğu — uydurma veri adayı').toBe(0);
  });
});
