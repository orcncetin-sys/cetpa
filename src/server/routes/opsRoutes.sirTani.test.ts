/**
 * opsRoutes.sirTani.test.ts — settings / auditLog sır ölçüm ucu (2026-10-02): jeton, DEĞER dönmez, yalnız sayım.
 * + `kullanici` bloğu (2026-10-11, şartname «dış rol kapanışı» D6 / T5): rolsüz ve dış rol hesap SAYISI; kişi verisi dönmez.
 */
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
const kullaniciSorgulari: string[] = [];
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
  // `kullanici` sorgusu: uç YALNIZ `role` ve `lastLogin` seçer. Sahte havuz bilerek FAZLASINI döndürür (kimlik, e-posta, ad) —
  // sorgu bir gün genişletilse bile yanıtın kişi verisi taşımadığı aşağıda sınanır.
  if (sql.includes("coll = 'users'") && sql.includes("data->'role'")) {
    kullaniciSorgulari.push(sql);
    return { rows: [
      { rol: 'Admin', giris: { _seconds: 1_760_000_000, _nanoseconds: 0 }, id: 'uid-sahip-1', email: 'sahip@example.test', name: 'Sahip Kişi' },
      { rol: 'Dealer', giris: '2026-03-01T10:00:00.000Z', id: 'uid-bayi-1', email: 'bayi@example.test', name: 'Şirin Yapı' },
      { rol: 'Dealer', giris: { _seconds: 1_700_000_000, _nanoseconds: 0 }, id: 'uid-bayi-2', email: 'bayi2@example.test', name: 'İkinci Bayi' },
      { rol: 'B2B', giris: null, id: 'uid-b2b-1', email: 'b2b@example.test', name: 'Kurumsal Müşteri' },
      { rol: null, giris: '2026-10-11T09:00:00.000Z', id: 'uid-yabanci-1', email: 'yabanci@example.test', name: 'Yabancı' },
      { rol: 1, giris: null, id: 'uid-yabanci-2', email: 'cop@example.test', name: 'Geçersiz Rol' },
    ] };
  }
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
  it('`kullanici`: toplam, rolsüz, dış rol başına sayı ve en yeni dış rol girişi — yalnız sayı ve zaman', async () => {
    const r = await calistir('gizli-abc');
    expect(r.kod).toBe(200);
    expect((r.govde as { kullanici: unknown }).kullanici).toEqual({
      toplam: 6, rolsuz: 2, disRol: { B2B: 1, Dealer: 2 }, disRolSonGiris: '2026-03-01T10:00:00.000Z',
    });
  });
  it('`kullanici`: yanıtta e-posta / ad / kimlik deseni YOK (havuz fazladan alan döndürse de)', async () => {
    const r = await calistir('gizli-abc');
    const metin = JSON.stringify((r.govde as { kullanici: unknown }).kullanici);
    expect(metin).not.toMatch(/@/);
    expect(metin).not.toMatch(/[^\s@"]+@[^\s@"]+\.[^\s@"]+/);
    for (const yasak of ['example', 'uid-', 'Sahip', 'Şirin', 'Bayi', 'Kurumsal', 'Yabancı', 'Geçersiz']) expect(metin).not.toContain(yasak);
    // Bütün yanıtta da e-posta deseni yok (öbür bloklar zaten değer taşımıyor).
    expect(JSON.stringify(r.govde)).not.toMatch(/[^\s@"]+@[^\s@"]+\.[^\s@"]+/);
  });
  it('`kullanici` sorgusu YALNIZ `role` ve `lastLogin` alanlarını seçer (kişi verisi veritabanından hiç çıkmaz)', async () => {
    kullaniciSorgulari.length = 0;
    await calistir('gizli-abc');
    expect(kullaniciSorgulari).toEqual(["SELECT data->'role' AS rol, data->'lastLogin' AS giris FROM docs WHERE coll = 'users'"]);
  });
  it('`kullanici`: jetonsuz / yanlış jetonla 401 — blok da gövde de dönmez; sorgu KOŞMAZ', async () => {
    kullaniciSorgulari.length = 0;
    for (const jeton of [undefined, 'yanlis', '']) {
      const r = await calistir(jeton);
      expect([jeton, r.kod]).toEqual([jeton, 401]);
      expect(JSON.stringify(r.govde)).not.toContain('kullanici');
    }
    expect(kullaniciSorgulari).toEqual([]);
  });
  it('sahip kiracı çözülemiyorsa bunu söyler; pg havuzu yoksa 503', async () => {
    const r = await calistir('gizli-abc', { ...C, serverTenantId: async () => '' });
    expect((r.govde as { kiraci: { sahipCozuluyor: boolean } }).kiraci.sahipCozuluyor).toBe(false);
    expect((await calistir('gizli-abc', { ...C, getPgPool: () => null })).kod).toBe(503);
  });
});
