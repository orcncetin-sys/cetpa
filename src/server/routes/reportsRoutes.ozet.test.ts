// @vitest-environment node
/**
 * reportsRoutes.ozet.test.ts — `GET /api/reports/summary` cirosu kaynaksız MF'yi (Mikro'da satış faturası olmayan, sunucunun
 * işaretlediği MF siparişi) DIŞLAR; sipariş SAYISI ham kalır (şartname «Mikro bağlantı B» B2; MB1 okuyucu sayımı (4) #23,
 * 05.11.2026). Kalıp: reportsRoutes.stokFiyat.test.ts (sahte Express, handler yakalama). Ağ / DB YOK.
 * Mutasyon (yapılıp geri alındı, raporda): `revenue` içindeki `.filter(o => !mfKaynaksizMi(o))` silinir → kırmızı.
 */
import { describe, it, expect } from 'vitest';
import { reportsRoutes, type ReportsRouteCtx } from './reportsRoutes';
import { MF_KAYNAGI } from '../../lib/mfKaynagi.js';

type Handler = (req: unknown, res: unknown) => Promise<void> | void;
function sahteApp() {
  const handlers: Record<string, Handler> = {};
  const kaydet = (yol: string, ...mw: unknown[]) => { handlers[yol] = mw[mw.length - 1] as Handler; };
  return { handlers, get: kaydet, post: kaydet, put: kaydet, patch: kaydet, delete: kaydet };
}
const gecir = (_r: unknown, _s: unknown, next: () => void) => next();

const DUN = new Date(Date.now() - 86400000).toISOString();
const SIPARISLER = [
  { id: 'mikrofat__A__-325', source: MF_KAYNAGI, mfKaynaksiz: true, status: 'Delivered', totalPrice: 1000, createdAt: DUN },
  { id: 'mikrofat__A__-400', source: MF_KAYNAGI, status: 'Delivered', totalPrice: 300, createdAt: DUN },
  { id: 'ord-1', status: 'Delivered', totalPrice: 600, createdAt: DUN },
];

async function ozet(siparisler: Array<Record<string, unknown>>) {
  const app = sahteApp();
  const C: ReportsRouteCtx = {
    getAdminDb: () => ({}) as ReturnType<ReportsRouteCtx['getAdminDb']>,
    requireAuth: gecir, requireStaff: gecir,
    getUserCompanyId: async () => 'cid-1',
    loadCompanyDocs: async (coll: string) => (coll === 'orders' ? siparisler : []),
    requireCollectionAccess: () => gecir,
  };
  reportsRoutes(app as unknown as Parameters<typeof reportsRoutes>[0], C);
  let govde: Record<string, unknown> = {}; let kod = 200;
  const res = { json: (b: Record<string, unknown>) => { govde = b; return res; }, status: (n: number) => { kod = n; return res; } };
  await app.handlers['/api/reports/summary']({ uid: 'u1' }, res);
  return { govde, kod };
}

describe('GET /api/reports/summary — kaynaksız MF ciro dışı (B2)', () => {
  it('ciro yalnız işaretsiz MF + yerel; sipariş sayısı 3; `revenue.kaynaksizDisi` 1', async () => {
    const { govde, kod } = await ozet(SIPARISLER);
    expect(kod).toBe(200);
    expect(govde.orders).toMatchObject({ count: 3 });
    expect(govde.revenue).toMatchObject({ total: 900, prev: 0, delta: 900 });
    expect((govde.revenue as { kaynaksizDisi: unknown }).kaynaksizDisi).toEqual({ adet: 1, tutar: { toplam: 1000, bilinen: 1, bilinmeyen: 0 } });
  });
  it('işaretli MF yoksa sayaç 0 ve ciro bugünkü gibi', async () => {
    const { govde } = await ozet(SIPARISLER.slice(1));
    expect(govde.revenue).toMatchObject({ total: 900, kaynaksizDisi: { adet: 0 } });
  });
});
