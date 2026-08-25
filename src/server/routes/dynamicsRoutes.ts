/**
 * dynamicsRoutes.ts - Microsoft Dynamics 365 Business Central entegrasyon uclari (5 rota).
 * Mikro'ya ALTERNATIF bir ERP koprusu; Mikro uclarindan bagimsiz.
 *
 * server.ts'ten AYRILDI (2026-08-25) - D4 adim 10. Onceki rota gruplariyla
 * AYNI desen: bagimliliklar ACIK baglam nesnesiyle gecer, `import` DEGIL -
 * server.ts bu modulu import ettigi icin ters yonde import DONGU olurdu.
 */
import type { Express, Request, Response } from 'express';
import type { AdminDbLike, AdminDocRef, AdminQuerySnapshot } from '../adminDbTypes.js';

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface DynamicsRouteCtx {
  getAdminDb: () => AdminDbLike;
  requireAuth: any;
  requireMfaVerified: any;
  requireAdmin: any;
  reqActor: (req: Request) => { uid: string; email: string };
  reqCompanyId: (req: Request) => Promise<string>;
  writeAuditLog: (...a: any[]) => Promise<unknown>;
  writeSyncLog: (...a: any[]) => Promise<unknown>;
  pgServerTimestamp: () => any;
  tenantSnap: (coll: string, cid: string, daralt?: any) => Promise<AdminQuerySnapshot>;
  getDynamicsToken: () => Promise<string | null>;
  dynamicsGetAll: (token: string, yol: string) => Promise<any[]>;
  getDynamicsBase: () => string;
  getDynamicsCredsFromFirestore: () => Promise<any>;
}

export function dynamicsRoutes(app: Express, C: DynamicsRouteCtx): void {
  app.get('/api/dynamics/status', async (_req: Request, res: Response) => {
    const hasEnvCreds = !!(process.env.DYNAMICS_TENANT_ID && process.env.DYNAMICS_CLIENT_ID && process.env.DYNAMICS_CLIENT_SECRET && process.env.DYNAMICS_COMPANY_ID);
    const fsCreds = hasEnvCreds ? null : await C.getDynamicsCredsFromFirestore();
    const configured = hasEnvCreds || !!fsCreds;
    if (!configured) return res.json({ configured: false, connected: false });
    try {
      const token = await C.getDynamicsToken();
      if (!token) return res.json({ configured: true, connected: false, error: 'OAuth2 token request failed — check DYNAMICS_CLIENT_ID / DYNAMICS_CLIENT_SECRET / DYNAMICS_TENANT_ID' });
      // Bağlantı probu: getDynamicsBase() ZATEN companies(ID) içerir; hafif bir
      // alt-entity sorgusu (items?$top=1) hem OAuth hem şirket erişimini doğrular.
      // (Önceki `${base}/companies` = .../companies(ID)/companies → daima 404'tü.)
      const r = await fetch(`${C.getDynamicsBase()}/items?$top=1`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!r.ok) return res.json({ configured: true, connected: false, error: `BC API returned HTTP ${r.status}` });
      return res.json({
        configured: true,
        connected:  true,
        companyName: 'Business Central',
        environmentName: process.env.DYNAMICS_ENVIRONMENT ?? 'production',
      });
    } catch (err) {
      return res.json({ configured: true, connected: false, error: String(err) });
    }
  });

  // BC item → inventory upsert (Mikro/Paraşüt deseni; sku=item.number, dedup sku ile).
  // NOT: canlı BC'ye karşı test EDİLMEDİ — ilk gerçek sync doğrulayacak.
  app.post('/api/dynamics/import/stok', C.requireAuth, C.requireMfaVerified, C.requireAdmin, async (req: Request, res: Response) => {
    const token = await C.getDynamicsToken();
    if (!token) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'DB yok.' });
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await C.reqCompanyId(req);
    const t0 = Date.now();
    try {
      const items = await C.dynamicsGetAll(token, 'items');
      // KİRACI SINIRI: "Mikro/Paraşüt deseni" yorumu doğru — o desendeki aynı
      // eksik filtre buraya da kopyalanmış. GTIN/barkod gibi SKU'lar kiracılar
      // arasında çakışabilir; düzeltme Paraşüt/barkod/fiyat ile aynı.
      const invSnap = await C.tenantSnap('inventory', companyId);
      const bySku = new Map<string, AdminDocRef>();
      for (const d of invSnap.docs) {
        const veri = d.data() as Record<string, unknown>;
        const dc = (veri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const sku = ((veri.sku as string) || '').trim();
        if (sku && !bySku.has(sku)) bySku.set(sku, d.ref);
      }
      let created = 0, updated = 0;
      let batch = C.getAdminDb().batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = C.getAdminDb()!.batch(); ops = 0; } };
      for (const it of items) {
        const sku = ((it.number as string) || '').trim();
        if (!sku) continue;
        if ((it.blocked as boolean) === true) continue; // bloke kalemleri atla
        const price = Number(it.unitPrice) || 0;
        const fields = {
          name: (it.displayName as string) || sku,
          unit: (it.baseUnitOfMeasureCode as string) || 'ADET',
          stockLevel: Number(it.inventory) || 0,
          price,
          prices: { 'Retail': price, 'B2B Standard': price, 'B2B Premium': price, 'Dealer': price },
          barcode: (it.gtin as string) || '',
          dynamicsId: String(it.id ?? ''), source: 'dynamics',
          updatedAt: C.pgServerTimestamp(),
          companyId, // create+update etiketle (self-heal)
        };
        const ref = bySku.get(sku);
        if (ref) { batch.update(ref, fields); updated++; }
        else {
          const newRef = C.getAdminDb().collection('inventory').doc();
          batch.set(newRef, { ...fields, sku, category: 'Genel', lowStockThreshold: 5, costPrice: 0, createdAt: C.pgServerTimestamp() });
          bySku.set(sku, newRef);
          created++;
        }
        if (++ops >= 400) await flush();
      }
      await flush();
      await C.writeAuditLog(C.reqActor(req), 'Dynamics Stok İçe Aktarma', `${created} yeni / ${updated} güncel`);
      res.json({ success: true, created, updated, errors: 0, total: items.length, duration: Date.now() - t0 });
    } catch (e) {
      res.status(500).json({ success: false, created: 0, updated: 0, errors: 1, error: (e as Error).message });
    }
  });

  // BC customer → leads upsert (dedup: dynamicsId → VKN → isim; Paraşüt/Mikro deseni).
  // NOT: canlı BC'ye karşı test EDİLMEDİ — ilk gerçek sync doğrulayacak.
  app.post('/api/dynamics/import/cari', C.requireAuth, C.requireMfaVerified, C.requireAdmin, async (req: Request, res: Response) => {
    const token = await C.getDynamicsToken();
    if (!token) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'DB yok.' });
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await C.reqCompanyId(req);
    const t0 = Date.now();
    try {
      const customers = await C.dynamicsGetAll(token, 'customers');
      // KİRACI SINIRI: Mikro cari import'unda bulunan sınıfın aynısı.
      const leadSnap = await C.tenantSnap('leads', companyId);
      const byDynId = new Map<string, AdminDocRef>();
      const byVkn = new Map<string, AdminDocRef>();
      const byName = new Map<string, AdminDocRef>();
      const normVkn = (v?: string) => (v || '').replace(/\D/g, '');
      for (const d of leadSnap.docs) {
        const data = d.data();
        const dc = (data.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const did = (data.dynamicsId as string) || '';
        if (did) byDynId.set(did, d.ref);
        const vkn = normVkn((data.taxId as string) || (data.taxNo as string));
        if (vkn && !byVkn.has(vkn)) byVkn.set(vkn, d.ref);
        const nameKey = ((data.name as string) || (data.company as string) || '').trim().toLowerCase();
        if (nameKey && !byName.has(nameKey)) byName.set(nameKey, d.ref);
      }
      let created = 0, updated = 0;
      let batch = C.getAdminDb().batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = C.getAdminDb()!.batch(); ops = 0; } };
      for (const c of customers) {
        const did = String(c.id ?? '');
        const name = (c.displayName as string) || (c.number as string) || did;
        const addr = [c.addressLine1, c.addressLine2].filter(Boolean).join(' ');
        const fields = {
          name,
          company: name,
          email: (c.email as string) || '',
          phone: (c.phoneNumber as string) || '',
          taxId: (c.taxRegistrationNumber as string) || '',
          address: addr,
          city: (c.city as string) || '',
          balance: Number(c.balanceDue ?? 0),
          type: 'Customer', // BC customer entity = müşteri (tedarikçi ayrı 'vendors' entity'si)
          dynamicsId: did, source: 'dynamics', mikroSynced: false,
          updatedAt: C.pgServerTimestamp(),
          companyId, // create+update etiketle (self-heal)
        };
        const vkn = normVkn(fields.taxId);
        const nameKey = name.trim().toLowerCase();
        const ref = byDynId.get(did)
          || (vkn ? byVkn.get(vkn) : undefined)
          || (nameKey ? byName.get(nameKey) : undefined);
        if (ref) { batch.update(ref, fields); updated++; }
        else {
          const newRef = C.getAdminDb().collection('leads').doc();
          batch.set(newRef, { ...fields, status: 'Active', createdAt: C.pgServerTimestamp() });
          if (did) byDynId.set(did, newRef);
          created++;
        }
        if (++ops >= 400) await flush();
      }
      await flush();
      await C.writeAuditLog(C.reqActor(req), 'Dynamics Cari İçe Aktarma', `${created} yeni / ${updated} güncel`);
      res.json({ success: true, created, updated, errors: 0, total: customers.length, duration: Date.now() - t0 });
    } catch (e) {
      res.status(500).json({ success: false, created: 0, updated: 0, errors: 1, error: (e as Error).message });
    }
  });

  app.post('/api/dynamics/export/siparis', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    const token = await C.getDynamicsToken();
    if (!token) return res.json({ success: false, notConfigured: true });
    // TODO: fetch order from Firebase, POST /salesOrders to Business Central
    return res.json({ success: false, notImplemented: true, error: 'Dynamics order export not yet implemented.' });
  });

  app.post('/api/dynamics/export/fatura', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    const token = await C.getDynamicsToken();
    if (!token) return res.json({ success: false, notConfigured: true });
    // TODO: fetch order from Firebase, POST /salesInvoices to Business Central
    return res.json({ success: false, notImplemented: true, error: 'Dynamics invoice export not yet implemented.' });
  });
}
