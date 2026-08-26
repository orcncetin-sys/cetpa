/**
 * kanalRoutes.ts - DIS SATIS KANALLARI (9 rota).

 *   Shopify     (3) - webhook (HMAC imzali) + elle senkron
 *   Trendyol    (2) - siparis/urun cekme
 *   Hepsiburada (2) - siparis/urun cekme
 *   Marketplace (2) - rakip fiyat arama (Trendyol tedarikci + Amazon SP-API)
 *
 * NEDEN TEK DOSYA: dorduncusu de ayni isi yapar (dis kanaldan siparis/urun
 * cek, kimlik bilgisi settings'ten gelir) ve ayni baglam alanlarini paylasir.
 *
 * ⚠ WEBHOOK IMZASI: `/api/shopify/webhook` HMAC dogrulamasi icin `req.rawBody`
 * kullanir. rawBody, `app.use(express.json({ verify }))` tarafindan yakalanir
 * (server.ts) ve bu cagri o ara katmandan SONRA kayitli — yani imza calisir.
 * Cagri yukari alinirsa rawBody undefined olur ve TUM webhook'lar 401 doner.
 *
 * server.ts'ten AYRILDI (2026-08-26). Onceki rota gruplariyla AYNI desen:
 * bagimliliklar ACIK baglam nesnesiyle gecer, `import` DEGIL - server.ts bu
 * modulu import ettigi icin ters yonde import DONGU olurdu.
 */
import type { Express, Request, Response } from 'express';
import type { AdminDbLike } from '../adminDbTypes.js';
// Node yerlesigi — server.ts'e bagimlilik degil (dongu yok).
import { createHmac, timingSafeEqual } from 'crypto';

/** Amazon SP-API kimlik bilgileri (rakip fiyat aramasi icin). */
type AmazonCreds = { clientId: string; clientSecret: string; refreshToken: string; marketplaceId: string; region: string };

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface KanalRouteCtx {
  getAdminDb: () => AdminDbLike;
  /** pg-boss kuyrugu - server.ts'te SONRADAN atanir, o yuzden GETTER. */
  getBoss: () => any;
  requireAuth: any;
  requireMfaVerified: any;
  reqActor: (req: Request) => { uid: string; email: string };
  reqCompanyId: (req: Request) => Promise<string>;
  writeAuditLog: (...a: any[]) => Promise<unknown>;
  pgServerTimestamp: () => any;
  processShopifyWebhook: (topic: string, body: any) => Promise<void>;
  getTrendyolCreds: () => Promise<any>;
  getHepsiburadaCreds: () => Promise<any>;
  getAmazonCreds: () => Promise<any>;
}

export function kanalRoutes(app: Express, C: KanalRouteCtx): void {
  // ── shopify (3 rota) ─────────────────────────────────────────────────
  // Manual Sync Trigger
  app.post("/api/shopify/sync", C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const body = req.body || {};
    const accessToken = body.accessToken || process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_API_KEY || process.env.VITE_SHOPIFY_ACCESS_TOKEN;
    let storeDomain = body.storeUrl || process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE_URL || process.env.VITE_SHOPIFY_STORE_DOMAIN || "cetpa.myshopify.com";

    if (!accessToken) {
      // Env anahtar adlarını client'a sızdırma (yalnız sunucu logunda).
      console.warn('[shopify/sync] SHOPIFY_ACCESS_TOKEN tanımlı değil.');
      return res.status(400).json({ error: 'Shopify Access Token eksik. Ayarlardan SHOPIFY_ACCESS_TOKEN girin.' });
    }

    // Clean up domain if it has https://
    storeDomain = storeDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    // If the user accidentally pasted an email or service account into the domain secret
    if (storeDomain.includes('@')) {
      storeDomain = 'cetpa.myshopify.com';
    }

    // Ensure the domain is properly formatted
    if (storeDomain.includes('cetpa.com.tr')) {
      storeDomain = 'cetpa.myshopify.com';
    } else if (!storeDomain.includes('myshopify.com')) {
      storeDomain = `${storeDomain}.myshopify.com`;
    }

    // SSRF / token sızıntısı engeli: accessToken yalnız geçerli <shop>.myshopify.com
    // host'una gönderilebilir (önce `includes('myshopify.com')` bypass'lanabiliyordu).
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(storeDomain)) {
      return res.status(400).json({ error: 'Geçersiz Shopify mağaza alan adı (yalnız *.myshopify.com).' });
    }

    try {
      console.log(`Syncing with Shopify: ${storeDomain}`);
      
      const headers = {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      };

      // Fetch Products (Inventory)
      const productsResponse = await fetch(`https://${storeDomain}/admin/api/2024-01/products.json?limit=50`, { headers });
      if (!productsResponse.ok) {
        if (productsResponse.status === 401) {
          throw new Error(`Unauthorized (401). Please check that your SHOPIFY_ACCESS_TOKEN is an "Admin API access token" (it should start with "shpat_"). Also ensure your store domain is correct (e.g., your-store.myshopify.com instead of a custom domain). Current domain being tried: ${storeDomain}`);
        } else if (productsResponse.status === 404) {
          throw new Error(`Not Found (404). The store domain "${storeDomain}" might be incorrect. API calls usually require the .myshopify.com domain, not your custom domain.`);
        }
        throw new Error(`Failed to fetch products: ${productsResponse.statusText} (${productsResponse.status})`);
      }
      const productsData = await productsResponse.json();

      // Fetch Orders
      const ordersResponse = await fetch(`https://${storeDomain}/admin/api/2024-01/orders.json?status=any&limit=50`, { headers });
      if (!ordersResponse.ok) {
        throw new Error(`Failed to fetch orders: ${ordersResponse.statusText}`);
      }
      const ordersData = await ordersResponse.json();

      await C.writeAuditLog(C.reqActor(req), 'Shopify Senkronizasyon',
        `${(productsData.products || []).length} ürün, ${(ordersData.orders || []).length} sipariş çekildi`);
      res.json({ 
        message: "Shopify sync completed successfully", 
        products: productsData.products || [],
        orders: ordersData.orders || []
      });
    } catch (error: unknown) {
      console.error("Shopify sync error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Sync failed" });
    }
  });

  // Create Draft Order
  app.post('/api/shopify/draft-order', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    const storeDomain = (() => {
      const raw = process.env.SHOPIFY_STORE_DOMAIN || 'cetpa.myshopify.com';
      if (raw.includes('@')) return 'cetpa.myshopify.com';
      if (raw.includes('myshopify.com')) return raw;
      return `${raw.replace(/^www\./, '').replace(/\.com.*/, '')}.myshopify.com`;
    })();

    if (!accessToken) {
      return res.status(400).json({ error: 'Shopify credentials missing.' });
    }

    try {
      const { customerName, email, shippingAddress, lineItems, note } = req.body;

      const shopifyPayload: Record<string, unknown> = {
        draft_order: {
          note: note || '',
          line_items: lineItems.map((item: Record<string, unknown>) => ({
            title: item.title,
            price: Number(item.price).toFixed(2),
            quantity: item.quantity,
            ...(item.sku ? { sku: item.sku } : {}),
            ...(item.variantId ? { variant_id: item.variantId } : {})
          })),
          customer: email
            ? { email }
            : {
                first_name: customerName.split(' ')[0] || customerName,
                last_name: customerName.split(' ').slice(1).join(' ') || ''
              }
        }
      };

      if (shippingAddress) {
        (shopifyPayload.draft_order as Record<string, unknown>).shipping_address = {
          address1: shippingAddress,
          first_name: customerName.split(' ')[0] || customerName,
          last_name: customerName.split(' ').slice(1).join(' ') || ''
        };
      }

      const shopifyRes = await fetch(
        `https://${storeDomain}/admin/api/2024-01/draft_orders.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(shopifyPayload)
        }
      );

      if (!shopifyRes.ok) {
        const err = await shopifyRes.json().catch(() => ({}));
        throw new Error(JSON.stringify(err));
      }

      const data = await shopifyRes.json();
      await C.writeAuditLog(C.reqActor(req), 'Shopify Taslak Sipariş',
        `#${data.draft_order.order_number || data.draft_order.id} oluşturuldu`);
      res.json({
        shopifyDraftOrderId: `#${data.draft_order.order_number || data.draft_order.id}`,
        shopifyAdminUrl: data.draft_order.admin_graphql_api_id,
        invoiceUrl: data.draft_order.invoice_url,
        raw: data.draft_order
      });
    } catch (err: unknown) {
      console.error('Draft order error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Shopify Webhook Handler ──────────────────────────────────────────────
  app.post("/api/shopify/webhook", async (req: Request & { rawBody?: Buffer }, res: Response) => {
    // ── HMAC doğrulaması (fail-closed) ───────────────────────────────────
    // Secret tanımsızsa webhook doğrulanamaz → işlenmez (önce atlanıp sahte
    // sipariş enjekte edilebiliyordu).
    const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    const shopifyHmac   = req.headers['x-shopify-hmac-sha256'] as string | undefined;
    if (!webhookSecret) { res.status(503).send('Webhook not configured'); return; }
    if (!shopifyHmac || !req.rawBody) { res.status(401).send('Missing signature'); return; }
    {
      // P1-2: imza karşılaştırması sabit-zamanlı olmalı (timing yan-kanalı).
      const computed = createHmac('sha256', webhookSecret).update(req.rawBody).digest('base64');
      const a = Buffer.from(computed, 'utf8');
      const b = Buffer.from(shopifyHmac, 'utf8');
      if (a.length !== b.length || !timingSafeEqual(a, b)) { res.status(401).send('Invalid signature'); return; }
    }

    const topic = req.headers['x-shopify-topic'] as string;
    const body  = req.body;

    res.status(200).send("ok");

    if (C.getBoss()) {
      // P6: aynı sipariş+topic için tekilleştirme anahtarı — Shopify aynı webhook'u
      // yeniden teslim ederse (retry) eşzamanlı iki iş oluşmaz, tek sipariş yazılır.
      const orderKey = `${topic}:${body?.order_number || body?.id || 'x'}`.slice(0, 200);
      await C.getBoss().send('shopify-webhook', { topic, body }, { singletonKey: orderKey });
    } else {
      await C.processShopifyWebhook(topic, body).catch(() => {});
    }
  });

  // ── trendyol (2 rota) ────────────────────────────────────────────────
  /** GET /api/trendyol/status */
  app.get('/api/trendyol/status', async (_req: Request, res: Response) => {
    const creds = await C.getTrendyolCreds();
    if (!creds) return res.json({ configured: false, connected: false, message: 'Trendyol kimlik bilgileri eksik.' });
    try {
      const token = Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString('base64');
      const r = await fetch(
        `https://api.trendyol.com/sapigw/suppliers/${creds.supplierId}/orders?status=Created&size=1`,
        { headers: { Authorization: `Basic ${token}`, 'User-Agent': `${creds.supplierId} - SelfIntegration` } }
      );
      if (r.ok) return res.json({ configured: true, connected: true });
      const txt = await r.text();
      return res.json({ configured: true, connected: false, error: `HTTP ${r.status}: ${txt.substring(0, 200)}` });
    } catch (e) {
      return res.json({ configured: true, connected: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/trendyol/sync — pull recent orders → Firebase */
  app.post('/api/trendyol/sync', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const creds = await C.getTrendyolCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });
    const t0 = Date.now();
    try {
      const token = Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString('base64');
      const daysBack = Number(req.body?.daysBack ?? 7);
      const startMs  = Date.now() - daysBack * 24 * 60 * 60 * 1000;
      const url = `https://api.trendyol.com/sapigw/suppliers/${creds.supplierId}/orders?startDate=${startMs}&size=200&page=0`;
      const r   = await fetch(url, {
        headers: { Authorization: `Basic ${token}`, 'User-Agent': `${creds.supplierId} - SelfIntegration` }
      });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ success: false, error: `Trendyol API ${r.status}: ${txt.substring(0, 200)}` });
      }
      const data = await r.json() as { content?: Record<string, unknown>[] };
      const orders = data.content ?? [];
      let created = 0, updated = 0;
      if (C.getAdminDb()) {
        for (const o of orders) {
          const tyOrderNo = String(o.orderNumber ?? o.id ?? '');
          if (!tyOrderNo) continue;
          const existing = await C.getAdminDb().collection('orders').where('trendyolOrderNo', '==', tyOrderNo).limit(1).get();
          const payload = {
            trendyolOrderNo: tyOrderNo,
            customerName:    (o.shipmentAddress as Record<string, unknown>)?.fullName as string ?? 'Trendyol',
            totalPrice:      Number(o.totalPrice ?? 0),
            status:          'Pending' as const,
            customerType:    'Retail' as const,
            source:          'Trendyol',
            rawData:         o,
            updatedAt:       C.pgServerTimestamp(),
          };
          if (existing.empty) {
            await C.getAdminDb().collection('orders').add({ companyId: await C.reqCompanyId(req), ...payload, createdAt: C.pgServerTimestamp() });
            created++;
          } else {
            await existing.docs[0].ref.set(payload, { merge: true });
            updated++;
          }
        }
      }
      await C.writeAuditLog(C.reqActor(req), 'Trendyol Senkronizasyon', `${orders.length} sipariş — ${created} yeni, ${updated} güncellendi`);
      await C.writeAuditLog(C.reqActor(req), 'Hepsiburada Senkronizasyon', `${orders.length} sipariş — ${created} yeni, ${updated} güncellendi`);
      res.json({ success: true, total: orders.length, created, updated, duration: Date.now() - t0 });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── hepsiburada (2 rota) ─────────────────────────────────────────────
  /** GET /api/hepsiburada/status */
  app.get('/api/hepsiburada/status', async (_req: Request, res: Response) => {
    const creds = await C.getHepsiburadaCreds();
    if (!creds) return res.json({ configured: false, connected: false, message: 'Hepsiburada kimlik bilgileri eksik.' });
    try {
      const token = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
      const r = await fetch(
        `https://mpop.hepsiburada.com/product-service/api/products/merchants/${creds.merchantId}/products?limit=1&offset=0`,
        { headers: { Authorization: `Basic ${token}`, Accept: 'application/json' } }
      );
      if (r.ok) return res.json({ configured: true, connected: true });
      return res.json({ configured: true, connected: false, error: `HTTP ${r.status}` });
    } catch (e) {
      return res.json({ configured: true, connected: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/hepsiburada/sync — pull recent orders → Firebase */
  app.post('/api/hepsiburada/sync', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const creds = await C.getHepsiburadaCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });
    const t0 = Date.now();
    try {
      const token = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
      const daysBack  = Number(req.body?.daysBack ?? 7);
      const beginDate = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];
      const url = `https://mpop.hepsiburada.com/order-service-module/api/orders/merchantid/${creds.merchantId}?beginDate=${beginDate}&pageSize=100&pageNumber=0`;
      const r   = await fetch(url, { headers: { Authorization: `Basic ${token}`, Accept: 'application/json' } });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ success: false, error: `Hepsiburada API ${r.status}: ${txt.substring(0, 200)}` });
      }
      const data = await r.json() as { data?: Record<string, unknown>[] };
      const orders = data.data ?? [];
      let created = 0, updated = 0;
      if (C.getAdminDb()) {
        for (const o of orders) {
          const hbOrderId = String(o.id ?? o.orderNumber ?? '');
          if (!hbOrderId) continue;
          const existing = await C.getAdminDb().collection('orders').where('hepsiburadaOrderId', '==', hbOrderId).limit(1).get();
          const payload = {
            hepsiburadaOrderId: hbOrderId,
            customerName:       String(o.customerFirstName ?? '') + ' ' + String(o.customerLastName ?? ''),
            totalPrice:         Number(o.totalPrice ?? o.orderAmount ?? 0),
            status:             'Pending' as const,
            customerType:       'Retail' as const,
            source:             'Hepsiburada',
            rawData:            o,
            updatedAt:          C.pgServerTimestamp(),
          };
          if (existing.empty) {
            await C.getAdminDb().collection('orders').add({ companyId: await C.reqCompanyId(req), ...payload, createdAt: C.pgServerTimestamp() });
            created++;
          } else {
            await existing.docs[0].ref.set(payload, { merge: true });
            updated++;
          }
        }
      }
      res.json({ success: true, total: orders.length, created, updated, duration: Date.now() - t0 });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── marketplace (2 rota) ─────────────────────────────────────────────
  app.get('/api/marketplace/status', C.requireAuth, async (_req: Request, res: Response) => {
    res.json({
      trendyol: { configured: !!(await C.getTrendyolCreds()) },
      amazon: { configured: !!(await C.getAmazonCreds()) },
    });
  });

  // Amazon SP-API LWA access token (refresh_token → access_token)
  async function amazonAccessToken(c: AmazonCreds): Promise<string | null> {
    try {
      const r = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret }),
        signal: AbortSignal.timeout(12000),
      });
      const d = await r.json() as { access_token?: string };
      return d.access_token || null;
    } catch { return null; }
  }

  // POST /api/marketplace/search { query?, barcode?, sku? } → rakip fiyatları
  app.post('/api/marketplace/search', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const { query, barcode, sku } = (req.body ?? {}) as { query?: string; barcode?: string; sku?: string };
    const term = (barcode || sku || query || '').toString().trim();
    if (!term) return res.status(400).json({ error: 'query, barcode veya sku gerekli.' });
    const results: Array<{ source: string; title: string; price: number; currency: string; url?: string }> = [];
    const providers: string[] = [];
    const trendyol = await C.getTrendyolCreds();
    const amazon = await C.getAmazonCreds();
    if (!trendyol && !amazon) return res.json({ configured: false, results: [], providers: [] });

    // ── Trendyol: tedarikçi ürün/fiyat API ──
    if (trendyol) {
      providers.push('trendyol');
      try {
        const auth = Buffer.from(`${trendyol.apiKey}:${trendyol.apiSecret}`).toString('base64');
        const url = `https://api.trendyol.com/sapigw/suppliers/${trendyol.supplierId}/products?barcode=${encodeURIComponent(barcode || sku || '')}&size=20`;
        const r = await fetch(url, { headers: { Authorization: `Basic ${auth}`, 'User-Agent': `${trendyol.supplierId} - SelfIntegration` }, signal: AbortSignal.timeout(12000) });
        if (r.ok) {
          const d = await r.json() as { content?: Array<{ title?: string; salePrice?: number; listPrice?: number; productUrl?: string }> };
          (d.content || []).forEach(p => results.push({ source: 'Trendyol', title: p.title || term, price: Number(p.salePrice ?? p.listPrice) || 0, currency: 'TRY', url: p.productUrl }));
        }
      } catch (e) { console.warn('trendyol search:', (e as Error).message); }
    }

    // ── Amazon SP-API: competitivePrice (rakip teklif fiyatları) ──
    if (amazon) {
      providers.push('amazon');
      const token = await amazonAccessToken(amazon);
      if (token) {
        try {
          const host = amazon.region === 'na' ? 'sellingpartnerapi-na.amazon.com' : amazon.region === 'fe' ? 'sellingpartnerapi-fe.amazon.com' : 'sellingpartnerapi-eu.amazon.com';
          const url = `https://${host}/products/pricing/v0/competitivePrice?MarketplaceId=${amazon.marketplaceId}&Skus=${encodeURIComponent(sku || barcode || '')}&ItemType=Sku`;
          const r = await fetch(url, { headers: { 'x-amz-access-token': token }, signal: AbortSignal.timeout(12000) });
          if (r.ok) {
            const d = await r.json() as { payload?: Array<{ Product?: { CompetitivePricing?: { CompetitivePrices?: Array<{ Price?: { ListingPrice?: { Amount?: number; CurrencyCode?: string } } }> } } }> };
            (d.payload || []).forEach(p => (p.Product?.CompetitivePricing?.CompetitivePrices || []).forEach(cp => {
              const amt = cp.Price?.ListingPrice?.Amount;
              if (amt) results.push({ source: 'Amazon', title: term, price: amt, currency: cp.Price?.ListingPrice?.CurrencyCode || 'TRY' });
            }));
          }
        } catch (e) { console.warn('amazon search:', (e as Error).message); }
      }
    }

    res.json({ configured: true, providers, results });
  });
}
