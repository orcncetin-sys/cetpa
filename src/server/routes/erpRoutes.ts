/**
 * erpRoutes.ts - Mikro DISI ERP koprulerinin uclari (13 rota).
 *
 *   Parasut  (4) - bulut on muhasebe; Mikro'ya alternatif, GERCEK entegrasyon
 *   Logo     (4) - Tiger/Go; su an STUB (gercek REST spec bekliyor)
 *   SAP      (5) - Business One Service Layer; status GERCEK, digerleri stub
 *
 * NEDEN TEK DOSYA: ucu de ayni isi yapar (dis ERP'den stok/cari cek, siparis/
 * fatura gonder), ayni ara katman zincirini ve ayni baglam alanlarini
 * paylasir. Dynamics ayri dosyada cunku o gercek bir OAuth2 akisi ve kendi
 * token onbellegi var; bu ucunun boyle bir yuku yok.
 *
 * server.ts'ten AYRILDI (2026-08-26). Onceki rota gruplariyla AYNI desen:
 * bagimliliklar ACIK baglam nesnesiyle gecer, `import` DEGIL - server.ts bu
 * modulu import ettigi icin ters yonde import DONGU olurdu.
 *
 * ARA KATMAN ZINCIRI: cagri server.ts'te digerleriyle AYNI noktada
 * (express.json + apiLimiter'dan SONRA). Yukari alinirsa bu 13 rotanin TUM
 * POST'lari req.body'siz kalir - 2026-08-24'te mikroRoutes'ta tam bu oldu.
 */
import type { Express, Request, Response } from 'express';
import type { AdminDbLike, AdminDocRef, AdminQuerySnapshot } from '../adminDbTypes.js';

/** Parasut API kok adresi. Kod icinde SABIT - istemciden gelmez, dolayisiyla
 *  SSRF yuzeyi yok (2026-08-25 denetiminde bu ACIKCA dogrulandi). */
const PARASUT_BASE = 'https://api.parasut.com';

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface ErpRouteCtx {
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
  /** Parasut kimlik bilgileri - env ya da settings/parasut. */
  getParasutCreds: () => Promise<any>;
  getParasutToken: (creds: any) => Promise<string>;
  parasutGetAll: (creds: any, resource: string, params?: string) => Promise<Record<string, unknown>[]>;
  getLogoCreds: () => Promise<any>;
  getSAPSession: () => Promise<string | null>;
  getSAPCredsFromFirestore: () => Promise<any>;
}

export function erpRoutes(app: Express, C: ErpRouteCtx): void {
  // ── Parasut - bulut on muhasebe (GERCEK entegrasyon) (4 rota) 
  app.get('/api/parasut/status', C.requireAuth, async (_req: Request, res: Response) => {
    const creds = await C.getParasutCreds();
    if (!creds) return res.json({ configured: false, connected: false, message: 'Paraşüt yapılandırılmamış.' });
    try {
      await C.getParasutToken(creds);
      res.json({ configured: true, connected: true, message: 'Paraşüt bağlantısı başarılı.' });
    } catch (e) {
      res.json({ configured: true, connected: false, error: (e as Error).message });
    }
  });

  app.post('/api/parasut/import/cari', C.requireAuth, C.requireMfaVerified, C.requireAdmin, async (req: Request, res: Response) => {
    const creds = await C.getParasutCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'DB yok.' });
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await C.reqCompanyId(req);
    const t0 = Date.now();
    try {
      const contacts = await C.parasutGetAll(creds, 'contacts');
      // KİRACI SINIRI: Mikro cari import'unda bulunan sınıfın aynısı.
      const leadSnap = await C.tenantSnap('leads', companyId);
      const byParasutId = new Map<string, AdminDocRef>();
      const byVkn = new Map<string, AdminDocRef>();
      const byName = new Map<string, AdminDocRef>();
      const normalizeVknP = (v?: string) => (v || '').replace(/\D/g, '');
      for (const d of leadSnap.docs) {
        const data = d.data();
        const dc = (data.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const pid = (data.parasutId as string) || '';
        if (pid) byParasutId.set(pid, d.ref);
        const vkn = normalizeVknP((data.taxId as string) || (data.taxNo as string));
        if (vkn && !byVkn.has(vkn)) byVkn.set(vkn, d.ref);
        const nameKey = ((data.name as string) || (data.company as string) || '').trim().toLowerCase();
        if (nameKey && !byName.has(nameKey)) byName.set(nameKey, d.ref);
      }
      let created = 0, updated = 0;
      let batch = C.getAdminDb().batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = C.getAdminDb()!.batch(); ops = 0; } };
      for (const c of contacts) {
        const a = (c.attributes as Record<string, unknown>) || {};
        const pid = String(c.id);
        const fields = {
          name: (a.name as string) || pid,
          company: (a.name as string) || '',
          email: (a.email as string) || '',
          phone: (a.phone as string) || '',
          taxId: (a.tax_number as string) || '',
          taxOffice: (a.tax_office as string) || '',
          address: (a.address as string) || '',
          city: (a.city as string) || '',
          balance: Number(a.balance ?? 0),
          type: a.account_type === 'supplier' ? 'Supplier' : 'Customer',
          parasutId: pid, source: 'parasut', mikroSynced: false,
          updatedAt: C.pgServerTimestamp(),
          companyId, // güncellemede de etiketle (self-heal, Mikro ile aynı desen)
        };
        // Oncelik: parasutId -> VKN -> case-insensitive isim (ayni mikro/import/cari
        // fix'i - manuel olusturulmus leads'in parasutId'si olmaz).
        const vkn = normalizeVknP(fields.taxId);
        const nameKey = fields.name.trim().toLowerCase();
        const ref = byParasutId.get(pid)
          || (vkn ? byVkn.get(vkn) : undefined)
          || (nameKey ? byName.get(nameKey) : undefined);
        if (ref) { batch.update(ref, fields); updated++; }
        else {
          const newRef = C.getAdminDb().collection('leads').doc();
          batch.set(newRef, { ...fields, status: 'Active', createdAt: C.pgServerTimestamp() });
          byParasutId.set(pid, newRef);
          created++;
        }
        if (++ops >= 400) await flush();
      }
      await flush();
      await C.writeAuditLog(C.reqActor(req), 'Paraşüt Cari İçe Aktarma', `${created} yeni / ${updated} güncel`);
      res.json({ success: true, created, updated, total: contacts.length, duration: Date.now() - t0 });
    } catch (e) { res.status(500).json({ success: false, error: (e as Error).message }); }
  });

  app.post('/api/parasut/import/stok', C.requireAuth, C.requireMfaVerified, C.requireAdmin, async (req: Request, res: Response) => {
    const creds = await C.getParasutCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'DB yok.' });
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await C.reqCompanyId(req);
    const t0 = Date.now();
    try {
      const products = await C.parasutGetAll(creds, 'products');
      // KİRACI SINIRI: fiyat/barkod/BOM import'unda bulunan sınıfın aynısı —
      // filtre yoktu. EAN barkod gibi SKU'lar farklı kiracılar arasında DOĞAL
      // olarak çakışabilir (aynı fiziksel ürünü satan iki toptancı); bu uç ise
      // name/unit/vatRate/stockLevel/price/prices'ın HEPSİNİ güncelliyordu —
      // barkod/fiyattan daha geniş bir etki alanı.
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
      for (const p of products) {
        const a = (p.attributes as Record<string, unknown>) || {};
        const sku = ((a.code as string) || String(p.id)).trim();
        const listPrice = Number(a.list_price ?? 0);
        const fields = {
          name: (a.name as string) || sku,
          unit: (a.unit as string) || 'ADET',
          vatRate: Number(a.vat_rate ?? 20),
          stockLevel: Number(a.stock_count ?? a.inventory_level ?? 0),
          price: listPrice,
          prices: { 'Retail': listPrice, 'B2B Standard': listPrice, 'B2B Premium': listPrice, 'Dealer': listPrice },
          parasutId: String(p.id), source: 'parasut',
          updatedAt: C.pgServerTimestamp(),
          companyId, // güncellemede de etiketle (self-heal)
        };
        const ref = bySku.get(sku);
        if (ref) { batch.update(ref, fields); updated++; }
        else { batch.set(C.getAdminDb().collection('inventory').doc(), { ...fields, sku, category: 'Genel', lowStockThreshold: 5, costPrice: 0, createdAt: C.pgServerTimestamp() }); created++; }
        if (++ops >= 400) await flush();
      }
      await flush();
      await C.writeAuditLog(C.reqActor(req), 'Paraşüt Stok İçe Aktarma', `${created} yeni / ${updated} güncel (fiyat dahil)`);
      res.json({ success: true, created, updated, total: products.length, duration: Date.now() - t0 });
    } catch (e) { res.status(500).json({ success: false, error: (e as Error).message }); }
  });

  app.post('/api/parasut/fatura', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const creds = await C.getParasutCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });
    const { order } = req.body as { order: Record<string, unknown> };
    if (!order) return res.status(400).json({ success: false, error: 'order zorunlu.' });
    const t0 = Date.now();
    try {
      const token = await C.getParasutToken(creds);
      const payload = {
        data: {
          type: 'sales_invoices',
          attributes: {
            item_type: 'invoice',
            description: (order.customerName as string) || '',
            issue_date: new Date().toISOString().slice(0, 10),
            currency: 'TRL',
          },
          ...(order.parasutContactId ? { relationships: { contact: { data: { id: String(order.parasutContactId), type: 'contacts' } } } } : {}),
        },
      };
      const r = await fetch(`${PARASUT_BASE}/v4/${creds.companyId}/sales_invoices`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      const success = r.ok;
      await C.writeSyncLog('ParasutFatura', 'order', String(order.id ?? 'unknown'), success, null, success ? null : `HTTP ${r.status}`, Date.now() - t0, C.reqActor(req));
      res.json({ success, data, duration: Date.now() - t0 });
    } catch (e) { res.status(500).json({ success: false, error: (e as Error).message }); }
  });

  // ── Logo Tiger/Go - STUB (gercek REST spec bekliyor) (4 rota) 
  app.get('/api/logo/status', async (_req: Request, res: Response) => {
    const creds = await C.getLogoCreds();
    const configured = !!creds;
    if (!configured) return res.json({ configured: false, connected: false });
    try {
      // TODO: implement real Logo Tiger auth check (e.g. GET /api/v1/firms)
      // const r = await fetch(`${process.env.LOGO_API_URL}/api/v1/firms`, {
      //   headers: { 'X-Logo-ApiKey': process.env.LOGO_API_KEY },
      // });
      // const ok = r.ok;
      // return res.json({ configured: true, connected: ok, error: ok ? undefined : `HTTP ${r.status}` });
      return res.json({ configured: true, connected: false, error: 'Logo adapter not yet implemented — set LOGO_API_URL, LOGO_API_KEY, LOGO_FIRM_NO and build the adapter.' });
    } catch (err) {
      return res.json({ configured: true, connected: false, error: String(err) });
    }
  });

  app.post('/api/logo/import/stok', C.requireAuth, C.requireMfaVerified, async (_req: Request, res: Response) => {
    if (!(await C.getLogoCreds())) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    // TODO: Logo REST'ten stok çek, inventory'ye upsert.
    // ⚠️ TENANT: her yazıma companyId ekle (reqCompanyId(req), create+update). Mikro/Paraşüt deseni.
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'Logo stok import not yet implemented.' });
  });

  app.post('/api/logo/import/cari', C.requireAuth, C.requireMfaVerified, async (_req: Request, res: Response) => {
    if (!(await C.getLogoCreds())) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    // TODO: Logo REST'ten cari çek, leads'e upsert.
    // ⚠️ TENANT: her yazıma companyId ekle (reqCompanyId(req), create+update). Mikro/Paraşüt deseni.
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'Logo cari import not yet implemented.' });
  });

  app.post('/api/logo/export/siparis', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    if (!(await C.getLogoCreds())) return res.json({ success: false, notConfigured: true });
    return res.json({ success: false, notImplemented: true, error: 'Logo sipariş export not yet implemented.' });
  });

  // ── SAP Business One - status GERCEK, digerleri stub (5 rota) 
  app.get('/api/sap/status', async (_req: Request, res: Response) => {
    const hasEnvCreds = !!(process.env.SAP_SERVICE_LAYER_URL && process.env.SAP_USERNAME && process.env.SAP_PASSWORD && process.env.SAP_COMPANY_DB);
    const fsCreds = hasEnvCreds ? null : await C.getSAPCredsFromFirestore();
    const configured = hasEnvCreds || !!fsCreds;
    if (!configured) return res.json({ configured: false, connected: false });
    try {
      const session = await C.getSAPSession();
      if (!session) return res.json({ configured: true, connected: false, error: 'SAP B1 Login failed — check SAP_USERNAME, SAP_PASSWORD, SAP_COMPANY_DB' });
      // Quick version check
      const r = await fetch(`${process.env.SAP_SERVICE_LAYER_URL}/CompanyInfo`, {
        headers: { Cookie: `B1SESSION=${session}`, Accept: 'application/json' },
      });
      if (!r.ok) return res.json({ configured: true, connected: false, error: `SAP Service Layer returned HTTP ${r.status}` });
      const info = await r.json() as { CompanyName?: string; Version?: string };
      return res.json({
        configured:  true,
        connected:   true,
        companyDb:   process.env.SAP_COMPANY_DB,
        sapVersion:  info.Version,
        companyName: info.CompanyName,
      });
    } catch (err) {
      return res.json({ configured: true, connected: false, error: String(err) });
    }
  });

  app.post('/api/sap/import/stok', C.requireAuth, C.requireMfaVerified, async (_req: Request, res: Response) => {
    const session = await C.getSAPSession();
    if (!session) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    // TODO: paginate GET /Items?$select=ItemCode,ItemName,OnHand,Price, upsert to Firebase
    // ⚠️ TENANT: her yazıma companyId ekle (reqCompanyId(req), create+update). Mikro/Paraşüt deseni.
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'SAP items import not yet implemented.' });
  });

  app.post('/api/sap/import/cari', C.requireAuth, C.requireMfaVerified, async (_req: Request, res: Response) => {
    const session = await C.getSAPSession();
    if (!session) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    // TODO: paginate GET /BusinessPartners?$filter=CardType eq 'cCustomer', upsert to Firebase leads
    // ⚠️ TENANT: her yazıma companyId ekle (reqCompanyId(req), create+update). Mikro/Paraşüt deseni.
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'SAP business partner import not yet implemented.' });
  });

  app.post('/api/sap/export/siparis', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    const session = await C.getSAPSession();
    if (!session) return res.json({ success: false, notConfigured: true });
    // TODO: fetch order from Firebase, POST /Orders to SAP Service Layer
    return res.json({ success: false, notImplemented: true, error: 'SAP order export not yet implemented.' });
  });

  app.post('/api/sap/export/fatura', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    const session = await C.getSAPSession();
    if (!session) return res.json({ success: false, notConfigured: true });
    // TODO: fetch order from Firebase, POST /Invoices to SAP Service Layer
    return res.json({ success: false, notImplemented: true, error: 'SAP invoice export not yet implemented.' });
  });
}
