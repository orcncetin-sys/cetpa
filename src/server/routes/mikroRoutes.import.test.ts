/**
 * mikroRoutes.import.test.ts — Mikro → Cetpa import uçlarında KİRACI SINIRI + "bilinmiyorsa
 * yazma" sözleşmesi (Faz 1 4/n, 2026-09-05). ÖNCE YAZILDI.
 *
 * /api/mikro/import/stok ve /cari projenin en sık basılan iki düğmesi. 2026-08-11'de 8 uçta
 * "TÜM kiracıları tarayıp eşleşen dokümana koşulsuz yaz" açığı bulunup kapatılmıştı; bu
 * düzeltme TESTSİZDİ. Kilitlenen: yabancı kiracının aynı SKU/VKN'li kaydı haritaya girmez
 * (yeni doküman açılır, yabancıya DOKUNULMAZ); etiketsiz eski kayıt eşleşir ve damgalanır;
 * depo kodu boşsa '1' UYDURULMAZ; miktar yoksa stockLevel EZİLMEZ; fiyat yoksa prices'a
 * dokunulmaz ve Retail yoksa `price: 0` YAZILMAZ; Mikro unvanı (BÜYÜK, Türkçe İ) elle
 * açılmış lead'le Türkçe locale ile eşleşir. Ağ (`mikroPost`) ve ayna tabloları mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Express } from 'express';
import { mikroRoutes, type MikroRouteCtx } from './mikroRoutes';
import { mikroPost } from '../mikroClient.js';

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
    mikroPost: vi.fn(),
    mikroVergiOranlari: vi.fn(async () => ({})),
    vergiOraniCoz: vi.fn(() => null),
  };
});

type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
type Ref = { id: string; coll: string };
type Yazim = { op: 'set' | 'update' | 'delete'; ref: Ref; data?: Record<string, unknown> };
type SnapDoc = { id: string; data: () => Record<string, unknown>; ref: Ref };

let yazilan: Yazim[] = [];
let snap: Record<string, SnapDoc[]> = {};
let sayac = 0;
const gecir = () => (_r: unknown, _s: unknown, next: () => void) => next();
const doc = (coll: string, id?: string) => {
  const ref: Ref & { set: (d: Record<string, unknown>) => Promise<void> } = {
    id: id ?? `yeni-${++sayac}`, coll,
    set: async (d) => { yazilan.push({ op: 'set', ref: { id: ref.id, coll }, data: d }); },
  };
  return ref;
};
const adminDb = {
  batch: () => ({
    set: (ref: Ref, data: Record<string, unknown>) => { yazilan.push({ op: 'set', ref: { id: ref.id, coll: ref.coll }, data }); },
    update: (ref: Ref, data: Record<string, unknown>) => { yazilan.push({ op: 'update', ref: { id: ref.id, coll: ref.coll }, data }); },
    delete: (ref: Ref) => { yazilan.push({ op: 'delete', ref: { id: ref.id, coll: ref.coll } }); },
    commit: async () => {},
  }),
  collection: (coll: string) => ({ doc: (id?: string) => doc(coll, id) }),
};
const snapDoc = (coll: string, id: string, veri: Record<string, unknown>): SnapDoc => ({ id, data: () => veri, ref: { id, coll } });
const syncLog = vi.fn(async () => {});

function sahteApp() {
  const handlers: Record<string, Handler> = {};
  const kaydet = (yol: string, ...mw: unknown[]) => { handlers[yol] = mw[mw.length - 1] as Handler; };
  return { handlers, get: kaydet, post: kaydet, put: kaydet, patch: kaydet, delete: kaydet, use: kaydet };
}
const C: MikroRouteCtx = {
  reqActor: () => ({ uid: 'u1', email: 'a@cetpa.com.tr' }),
  writeSyncLog: syncLog,
  reqCompanyId: async () => 'A',
  writeAuditLog: vi.fn(async () => {}),
  tenantSnap: vi.fn(async (coll: string) => ({ docs: snap[coll] ?? [] })),
  mikroIdCozucu: async () => (a: string) => a,
  loadCompanyDocs: vi.fn(async () => []),
  mikroLimiter: gecir(),
  requireCollectionAccess: () => gecir(),
  requireAuth: gecir(),
  requireMfaVerified: gecir(),
  getAdminDb: () => adminDb as unknown as ReturnType<MikroRouteCtx['getAdminDb']>,
  getPgPool: () => null,
  getUserCompanyId: async () => 'A',
  mikroIdCozucuIds: () => (a: string) => a,
  validate: () => null,
  getBoss: () => null,
};

function mikroYaniti(stok: Record<string, unknown>[], cari: Record<string, unknown>[] = []) {
  vi.mocked(mikroPost).mockImplementation((async (metot: string) => {
    if (metot === 'StokListesiV2') return { ok: true, data: { result: [{ Data: { StokListesi: stok } }] } };
    if (metot === 'CariListesiV2') return { ok: true, data: { result: [{ Data: { CariListesi: cari } }] } };
    return { ok: false, data: null };
  }) as unknown as typeof mikroPost);
}
async function calistir(yol: string) {
  const app = sahteApp();
  mikroRoutes(app as unknown as Express, C);
  const res = { kod: 200, govde: null as unknown, json(b: unknown) { res.govde = b; return res; }, status(n: number) { res.kod = n; return res; } };
  await app.handlers[yol]({ params: {}, body: {} }, res);
  return res;
}
const koleksiyon = (coll: string) => yazilan.filter(y => y.ref.coll === coll);

beforeEach(() => { yazilan = []; snap = {}; sayac = 0; syncLog.mockClear(); });

describe('POST /api/mikro/import/stok', () => {
  it("yabancı kiracının aynı SKU'lu kaydına DOKUNULMAZ (yeni doküman); etiketsiz eski kayıt eşleşir ve companyId damgalanır", async () => {
    snap.inventory = [snapDoc('inventory', 'yab', { sku: 'CMT-42', companyId: 'B' }), snapDoc('inventory', 'esk', { sku: 'KUM-01' })];
    mikroYaniti([{ sto_kod: 'CMT-42', sto_isim: 'Çimento' }, { sto_kod: 'KUM-01', sto_isim: 'Kum' }]);
    const res = await calistir('/api/mikro/import/stok');
    const inv = koleksiyon('inventory');
    const cmt = inv.find(y => y.data?.sku === 'CMT-42');
    expect(cmt?.op).toBe('set');
    expect(yazilan.some(y => y.ref.id === 'yab'), 'yabancı doküman yazılmamalı').toBe(false);
    const kum = inv.find(y => y.data?.sku === 'KUM-01');
    expect(kum).toMatchObject({ op: 'update', ref: { id: 'esk' } });
    expect(kum?.data?.companyId).toBe('A');
    expect(res.govde).toMatchObject({ success: true, created: 1, updated: 1, errors: 0 });
    expect(syncLog).toHaveBeenCalledWith('ImportStok', 'inventory', expect.stringContaining('1 yeni / 1 güncel'), true, null, null, expect.any(Number), expect.anything());
  });
  it("sto_yer_kod boşsa depo UYDURULMAZ: warehouseId yok, 'Depo belirtilmemiş'; doluysa mikro-depo-<kod> + warehouses kaydı", async () => {
    mikroYaniti([{ sto_kod: 'A1' }, { sto_kod: 'A2', sto_yer_kod: '2' }]);
    await calistir('/api/mikro/import/stok');
    const wh = koleksiyon('warehouseItems');
    const a1 = wh.find(y => y.data?.sku === 'A1')?.data ?? {};
    const a2 = wh.find(y => y.data?.sku === 'A2')?.data ?? {};
    expect('warehouseId' in a1).toBe(false);
    expect(a1.location).toBe('Depo belirtilmemiş');
    expect(a2).toMatchObject({ warehouseId: 'mikro-depo-2', location: 'Depo 2' });
    expect(koleksiyon('warehouses').map(y => y.data?.code)).toEqual(['2']);
  });
  it("miktar yoksa mevcut kaydın stockLevel'i EZİLMEZ; yeni kayıt 0 ile açılır (belgeli karar), warehouseItems quantity'siz", async () => {
    snap.inventory = [snapDoc('inventory', 'esk', { sku: 'KUM-01', stockLevel: 40 })];
    mikroYaniti([{ sto_kod: 'KUM-01' }, { sto_kod: 'YENI' }, { sto_kod: 'DOLU', sto_mevcut_mik: '5' }]);
    await calistir('/api/mikro/import/stok');
    const inv = koleksiyon('inventory');
    expect('stockLevel' in (inv.find(y => y.data?.sku === 'KUM-01')?.data ?? {})).toBe(false);
    expect(inv.find(y => y.data?.sku === 'YENI')?.data?.stockLevel).toBe(0);
    expect(inv.find(y => y.data?.sku === 'DOLU')?.data?.stockLevel).toBe(5);
    expect('quantity' in (koleksiyon('warehouseItems').find(y => y.data?.sku === 'KUM-01')?.data ?? {})).toBe(false);
  });
  it("fiyat gelmediyse prices/price YAZILMAZ; Retail yoksa ama başka kademe varsa `price: 0` UYDURULMAZ", async () => {
    mikroYaniti([{ sto_kod: 'F0' }, { sto_kod: 'F1', sto_satis_fiyat2: 90 }, { sto_kod: 'F2', sto_satis_fiyat1: 120 }]);
    const res = await calistir('/api/mikro/import/stok');
    const inv = koleksiyon('inventory');
    const f0 = inv.find(y => y.data?.sku === 'F0')?.data ?? {};
    const f1 = inv.find(y => y.data?.sku === 'F1')?.data ?? {};
    const f2 = inv.find(y => y.data?.sku === 'F2')?.data ?? {};
    expect('prices' in f0 || 'price' in f0).toBe(false);
    expect(f1.prices).toEqual({ 'B2B Standard': 90 });
    expect(f1.price, "Retail bilinmiyor → price alanı YOK (0 değil)").toBeUndefined();
    expect(f2).toMatchObject({ prices: { Retail: 120 }, price: 120 });
    expect(res.govde).toMatchObject({ fiyatliUrun: 2 });
  });
});

describe('POST /api/mikro/import/cari', () => {
  it("yabancı kiracının aynı VKN'li lead'i EŞLEŞMEZ (yeni); etiketsiz aynı isimli lead Türkçe locale ile eşleşir ('ŞİRİN YAPI' ↔ 'Şirin Yapı')", async () => {
    snap.leads = [snapDoc('leads', 'yabL', { taxId: '1234567890', companyId: 'B' }), snapDoc('leads', 'eskL', { name: 'Şirin Yapı' })];
    mikroYaniti([], [
      { cari_kod: 'C1', cari_unvan1: 'Yeni Firma', cari_vdaire_no: '1234567890' },
      { cari_kod: 'C2', cari_unvan1: 'ŞİRİN YAPI' },
    ]);
    const res = await calistir('/api/mikro/import/cari');
    const leads = koleksiyon('leads');
    expect(yazilan.some(y => y.ref.id === 'yabL'), 'yabancı lead yazılmamalı').toBe(false);
    expect(leads.find(y => y.data?.mikroCariKod === 'C1')?.op).toBe('set');
    const c2 = leads.find(y => y.data?.mikroCariKod === 'C2');
    expect(c2).toMatchObject({ op: 'update', ref: { id: 'eskL' } });
    expect(c2?.data?.companyId).toBe('A');
    expect(res.govde).toMatchObject({ success: true, created: 1, updated: 1 });
  });
});
