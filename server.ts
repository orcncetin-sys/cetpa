import express, { Request, Response } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cron from "node-cron";
import admin from "firebase-admin";

dotenv.config();

// ── Firebase Admin SDK ──────────────────────────────────────────────────────
// Initialise once; used by server-side routes (webhook, etc.)
// Locally: run `gcloud auth application-default login` OR set GOOGLE_APPLICATION_CREDENTIALS
// In production (Firebase Hosting / Cloud Run) ADC is automatic.
let adminDb: admin.firestore.Firestore | null = null;
const FIRESTORE_DB_ID = "ai-studio-d243947a-133d-4934-af2e-eff3bb6aeea7";
const PROJECT_ID = "gen-lang-client-0628151245";

try {
  const adminApp = admin.initializeApp({ projectId: PROJECT_ID });
  adminDb = adminApp.firestore();
  adminDb.settings({ databaseId: FIRESTORE_DB_ID });
  console.log("Firebase Admin SDK initialised ✓");
} catch (e) {
  console.warn("Firebase Admin SDK not initialised — webhook writes disabled:", (e as Error).message);
}

// ── Luca API helpers ────────────────────────────────────────────────────────
const LUCA_API_URL = process.env.LUCA_API_URL || "https://api.luca.com.tr/v1";
const LUCA_API_KEY = process.env.LUCA_API_KEY || "";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory cache for exchange rates
let cachedExchangeRates: { rates: Record<string, number>, source: string, updatedAt: string } | null = null;

/** Parse a numeric value from TCMB XML for a given currency code and tag */
function parseTCMBRate(xml: string, currencyCode: string, tag: string): number | null {
  // Match <Currency ... CurrencyCode="USD" ...>...</ForexSelling>...
  const currencyBlockRe = new RegExp(
    `<Currency[^>]*CurrencyCode="${currencyCode}"[^>]*>([\\s\\S]*?)<\\/Currency>`,
    'i'
  );
  const blockMatch = xml.match(currencyBlockRe);
  if (!blockMatch) return null;
  const block = blockMatch[1];
  const tagRe = new RegExp(`<${tag}>([\\d.,]+)<\\/${tag}>`, 'i');
  const tagMatch = block.match(tagRe);
  if (!tagMatch) return null;
  // TCMB uses comma as decimal separator in some locales, normalise
  return parseFloat(tagMatch[1].replace(',', '.'));
}

async function fetchAndCacheExchangeRates() {
  // --- Primary: exchangerate-api.com ---
  try {
    const apiKey = process.env.EXCHANGE_RATE_API_KEY;
    const url = apiKey
      ? `https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`
      : `https://api.exchangerate-api.com/v4/latest/USD`;

    const response = await fetch(url);
    const data = await response.json();
    const rawRates = apiKey ? data.conversion_rates : data.rates;

    // Convert to TRY-per-unit format (base USD → get TRY per USD, EUR per USD)
    const tryPerUsd: number = rawRates['TRY'] || 1;
    const eurPerUsd: number = rawRates['EUR'] || 1;
    const tryPerEur = tryPerUsd / eurPerUsd;

    const rates = { USD: tryPerUsd, EUR: tryPerEur };

    cachedExchangeRates = {
      rates,
      source: 'exchangerate-api',
      updatedAt: new Date().toISOString()
    };
    console.log(`Exchange rates updated from exchangerate-api: 1 USD = ${tryPerUsd} TRY`);
    return;
  } catch (error: unknown) {
    console.warn('exchangerate-api fetch failed, falling back to TCMB:', error instanceof Error ? error.message : String(error));
  }

  // --- Fallback: TCMB (Central Bank of Turkey) ---
  try {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const yyyy = today.getFullYear();
    // TCMB publishes daily XML; weekend/holiday fallback handled below
    const tcmbUrl = `https://www.tcmb.gov.tr/kurlar/${yyyy}${mm}/${dd}${mm}${yyyy}.xml`;
    const todayUrl = 'https://www.tcmb.gov.tr/kurlar/today.xml';

    let xml = '';
    // Try today's dated URL first, fall back to /today.xml
    for (const url of [tcmbUrl, todayUrl]) {
      try {
        const res = await fetch(url, { headers: { 'Accept': 'application/xml, text/xml' } });
        if (res.ok) { xml = await res.text(); break; }
      } catch { continue; }
    }

    if (xml) {
      const usdSelling = parseTCMBRate(xml, 'USD', 'ForexSelling');
      const eurSelling = parseTCMBRate(xml, 'EUR', 'ForexSelling');
      const gbpSelling = parseTCMBRate(xml, 'GBP', 'ForexSelling');

      if (usdSelling && eurSelling) {
        // Store as { USD: tryPerUsd, EUR: tryPerEur } so formatInCurrency(amountTRY / rate) works correctly
        const rates: Record<string, number> = { USD: usdSelling, EUR: eurSelling };
        if (gbpSelling) rates['GBP'] = gbpSelling;

        cachedExchangeRates = {
          rates,
          source: 'TCMB',
          updatedAt: new Date().toISOString()
        };
        console.log(`Exchange rates updated from TCMB: 1 USD = ${usdSelling} TRY, 1 EUR = ${eurSelling} TRY`);
        return;
      }
    }
  } catch (tcmbError: unknown) {
    console.error("Failed to fetch exchange rates:", tcmbError);
  }
}

// Schedule cron job
cron.schedule('*/30 * * * *', fetchAndCacheExchangeRates);
fetchAndCacheExchangeRates(); // Initial fetch

// ── Mikro Jump API — Config & Helpers ───────────────────────────────────────
// All Mikro calls MUST originate from this server (whitelisted IP requirement).
// Token: OpenID Connect via onlinekullanici.mikro.com.tr (~6h validity)
// API:   jumpbulutapigw.mikro.com.tr — bearer token + Mikro context in body

const MIKRO_AUTH_URL = 'https://onlinekullanici.mikro.com.tr/auth/realms/Mikro/protocol/openid-connect/token';
const MIKRO_API_BASE = process.env.MIKRO_API_URL || 'https://jumpbulutapigw.mikro.com.tr/ApiJB/ApiMethods';

function isMikroConfigured(): boolean {
  return !!(
    process.env.MIKRO_IDM_EMAIL &&
    process.env.MIKRO_IDM_PASSWORD &&
    process.env.MIKRO_API_KEY &&
    process.env.MIKRO_ALIAS
  );
}

/** Build the Mikro context object included in every request body */
function getMikroContext(): Record<string, unknown> {
  return {
    Alias:          process.env.MIKRO_ALIAS          || '',
    FirmaKodu:      process.env.MIKRO_FIRMA_KODU      || '01',
    CalismaYili:    process.env.MIKRO_CALISMA_YILI    || String(new Date().getFullYear()),
    ApiKey:         process.env.MIKRO_API_KEY         || '',
    KullaniciKodu:  process.env.MIKRO_KULLANICI_KODU  || 'SRV',
    Sifre:          process.env.MIKRO_SIFRE           || '',
    FirmaNo:        parseInt(process.env.MIKRO_FIRMA_NO  || '0', 10),
    SubeNo:         parseInt(process.env.MIKRO_SUBE_NO   || '0', 10),
  };
}

// In-memory token cache (refreshed 5 min before expiry)
let mikroTokenCache: { access_token: string; expiresAt: number } | null = null;

async function getMikroToken(): Promise<string> {
  const now = Date.now();
  if (mikroTokenCache && now < mikroTokenCache.expiresAt - 5 * 60 * 1000) {
    return mikroTokenCache.access_token;
  }

  const res = await fetch(MIKRO_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:  'mikro-rjf',
      username:   process.env.MIKRO_IDM_EMAIL    || '',
      password:   process.env.MIKRO_IDM_PASSWORD || '',
      grant_type: 'password',
    }).toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Mikro token alınamadı (${res.status}): ${errText.substring(0, 200)}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  mikroTokenCache = {
    access_token: data.access_token,
    expiresAt:    now + (data.expires_in || 21600) * 1000,
  };
  console.log(`Mikro token alındı ✓ (${Math.round((data.expires_in || 21600) / 60)} dk geçerli)`);
  return mikroTokenCache.access_token;
}

/** Call a Mikro Jump API endpoint.  Injects auth token + Mikro context automatically. */
async function mikroPost(
  endpoint: string,
  extraBody: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const token = await getMikroToken();
  const url   = `${MIKRO_API_BASE}/${endpoint}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ Mikro: getMikroContext(), ...extraBody }),
  });

  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    console.warn(`Mikro ${endpoint} HTTP ${res.status}:`, text.substring(0, 300));
  }

  return { ok: res.ok, status: res.status, data };
}

/** Write a sync event to the syncLog Firestore collection */
async function writeSyncLog(
  operation: string,
  entityType: string,
  entityId:   string,
  success:    boolean,
  mikroRef:   string | null,
  error:      string | null,
  duration:   number
): Promise<void> {
  if (!adminDb) return;
  try {
    await adminDb.collection('syncLog').add({
      timestamp:  admin.firestore.FieldValue.serverTimestamp(),
      operation,
      entityType,
      entityId,
      success,
      mikroRef,
      error,
      duration,
    });
  } catch (e) {
    console.warn('syncLog write failed:', e);
  }
}

// ── Mikro periodic sync (cron) ───────────────────────────────────────────────
// Every hour: pull updated cari + stok from Mikro → Firebase
if (process.env.MIKRO_CRON_SYNC === 'true') {
  cron.schedule('0 * * * *', async () => {
    if (!isMikroConfigured() || !adminDb) return;
    console.log('Mikro cron: stok + cari sync başlatıldı');
    try {
      // Pull stok
      const stokRes = await mikroPost('StokListesiV2', {
        StokKod: '', TarihTipi: 2,
        IlkTarih: '2020-01-01', SonTarih: `${new Date().getFullYear() + 1}-12-31`,
        Sort: 'sto_kod', Size: '500', Index: 0,
      });
      const stoklar = ((stokRes.data as Record<string, unknown>)?.stoklar ?? []) as Record<string, unknown>[];
      let stokUpdated = 0;
      for (const s of stoklar) {
        const sku = s.sto_kod as string;
        if (!sku) continue;
        const snap = await adminDb.collection('inventory').where('sku', '==', sku).limit(1).get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({ mikroData: s, mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp() });
          stokUpdated++;
        }
      }

      // Pull cari
      const cariRes = await mikroPost('CariListesiV2', {
        FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl',
        WhereStr: "cari_baglanti_tipi=0 and cari_lastup_date > '2020/01/01'",
        Sort: 'cari_kod', Size: '500', Index: 0,
      });
      const cariler = ((cariRes.data as Record<string, unknown>)?.cariler ?? []) as Record<string, unknown>[];
      let cariUpdated = 0;
      for (const c of cariler) {
        const cariKod = c.cari_kod as string;
        if (!cariKod) continue;
        const snap = await adminDb.collection('leads').where('mikroCariKod', '==', cariKod).limit(1).get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({ mikroData: c, mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp() });
          cariUpdated++;
        }
      }

      console.log(`Mikro cron tamamlandı — stok: ${stokUpdated}, cari: ${cariUpdated} güncellendi`);
    } catch (err) {
      console.error('Mikro cron sync hatası:', err);
    }
  });
  console.log('Mikro cron sync aktif (saatte bir çalışır) ✓');
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '5173', 10);

  app.use(express.json());

  // ... (keep existing routes)
  
  // Manual Sync Trigger
  app.post("/api/shopify/sync", async (req: Request, res: Response) => {
    const body = req.body || {};
    const accessToken = body.accessToken || process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_API_KEY || process.env.VITE_SHOPIFY_ACCESS_TOKEN;
    let storeDomain = body.storeUrl || process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE_URL || process.env.VITE_SHOPIFY_STORE_DOMAIN || "cetpa.myshopify.com";

    if (!accessToken) {
      const shopifyKeys = Object.keys(process.env).filter(k => k.includes('SHOPIFY'));
      return res.status(400).json({ 
        error: `Shopify Access Token missing. Please set SHOPIFY_ACCESS_TOKEN in secrets. Found keys: ${shopifyKeys.join(', ')}` 
      });
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
  app.post('/api/shopify/draft-order', async (req: Request, res: Response) => {
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
  app.post("/api/shopify/webhook", async (req: Request, res: Response) => {
    const topic = req.headers['x-shopify-topic'] as string;
    const body = req.body;
    console.log(`Shopify Webhook: ${topic}`);

    // Acknowledge immediately so Shopify doesn't retry
    res.status(200).send("ok");

    if (!adminDb) {
      console.warn("Webhook: Firebase Admin not available, skipping Firestore update");
      return;
    }

    try {
      if (topic === 'orders/create' || topic === 'orders/updated') {
        const shopifyOrderId = `#${body.order_number || body.id}`;
        // Try to find existing Cetpa order by shopifyOrderId
        const snap = await adminDb
          .collection('orders')
          .where('shopifyOrderId', '==', shopifyOrderId)
          .limit(1)
          .get();

        const orderData = {
          shopifyOrderId,
          customerName: body.billing_address?.name || body.customer?.first_name + ' ' + body.customer?.last_name || 'Unknown',
          totalPrice: parseFloat(body.total_price || '0'),
          status: body.financial_status === 'paid' ? 'Processing' : 'Pending',
          shippingAddress: body.shipping_address?.address1 || '',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          shopifyRaw: {
            fulfillmentStatus: body.fulfillment_status,
            financialStatus: body.financial_status,
            cancelReason: body.cancel_reason || null,
          },
        };

        if (!snap.empty) {
          await snap.docs[0].ref.update(orderData);
          console.log(`Updated Cetpa order for Shopify ${shopifyOrderId}`);
        } else if (topic === 'orders/create') {
          await adminDb.collection('orders').add({
            ...orderData,
            lineItems: (body.line_items || []).map((li: Record<string, unknown>) => ({
              title: li.title,
              quantity: li.quantity,
              price: parseFloat(String(li.price || '0')),
              sku: li.sku || '',
            })),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'shopify_webhook',
          });
          console.log(`Created Cetpa order from Shopify webhook ${shopifyOrderId}`);
        }
      }

      if (topic === 'orders/cancelled') {
        const shopifyOrderId = `#${body.order_number || body.id}`;
        const snap = await adminDb
          .collection('orders')
          .where('shopifyOrderId', '==', shopifyOrderId)
          .limit(1)
          .get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({
            status: 'Cancelled',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`Cancelled Cetpa order for Shopify ${shopifyOrderId}`);
        }
      }

      if (topic === 'orders/fulfillments_create' || topic === 'fulfillments/create') {
        const shopifyOrderId = `#${body.order_number || body.order_id}`;
        const trackingNumber = body.tracking_number || body.tracking_numbers?.[0] || null;
        const snap = await adminDb
          .collection('orders')
          .where('shopifyOrderId', '==', shopifyOrderId)
          .limit(1)
          .get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({
            status: 'Shipped',
            ...(trackingNumber && { trackingNumber }),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`Fulfilled Cetpa order ${shopifyOrderId}, tracking: ${trackingNumber}`);
        }
      }
    } catch (err) {
      console.error('Webhook Firestore write error:', err);
    }
  });

  // Get Exchange Rates
  app.get("/api/settings/exchange-rates", async (req: Request, res: Response) => {
    try {
      if (!cachedExchangeRates) {
        return res.status(404).json({ error: "Exchange rates not found" });
      }
      res.json(cachedExchangeRates);
    } catch (error) {
      console.error("Failed to fetch exchange rates:", error);
      res.status(500).json({ error: "Failed to fetch exchange rates" });
    }
  });

  // GIB VKN Sorgulama
  app.get("/api/gib/vkn/:vkt", async (req: Request, res: Response) => {
    const vkt = Array.isArray(req.params.vkt) ? req.params.vkt[0] : req.params.vkt;
    const apiKey = req.headers["x-gib-api-key"] as string;
    const integratorVkn = req.headers["x-gib-integrator-vkn"] as string;

    // If no credentials configured, return a clear error — never fake data
    if (!apiKey || apiKey.trim() === '') {
      return res.status(503).json({
        success: false,
        notConfigured: true,
        error: 'GİB API anahtarı yapılandırılmamış. Lütfen LUCA_API_KEY ortam değişkenini ayarlayın.'
      });
    }

    try {
      console.log(`Querying GİB API for VKN/TCKN: ${vkt}`);

      // GİB e-Beyanname entegratör API endpoint
      const gibUrl = `https://ebeyanapi.gib.gov.tr/mukellef/detay-list?vkt=${encodeURIComponent(vkt)}`;

      const response = await fetch(gibUrl, {
        method: 'GET',
        headers: {
          'x-gib-api-key': apiKey,
          'x-gib-integrator-vkn': integratorVkn || '',
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      const raw = await response.text();
      console.log(`GİB API response status: ${response.status}, body: ${raw.substring(0, 300)}`);

      if (!response.ok) {
        let errorMsg = `GİB API Hatası (${response.status})`;
        try {
          const errObj = JSON.parse(raw);
          errorMsg = errObj.message || errObj.error || errorMsg;
        } catch {}
        return res.status(response.status).json({ success: false, error: errorMsg });
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw);
      } catch {
        return res.status(502).json({ success: false, error: "GİB'den geçersiz yanıt alındı." });
      }

      // GİB API sometimes wraps in { data: [...] } or returns array directly
      const dataField = data.data || data;
      const mukellef = Array.isArray(dataField) ? dataField[0] : (typeof dataField === 'object' && dataField !== null ? dataField : null);

      if (!mukellef) {
        return res.status(404).json({ success: false, error: "Mükellef kaydı bulunamadı." });
      }

      res.json({
        success: true,
        data: {
          vknTckn: (mukellef as Record<string, unknown>).vkn || (mukellef as Record<string, unknown>).tckn || vkt,
          unvan: (mukellef as Record<string, unknown>).unvan || (mukellef as Record<string, unknown>).adSoyad || "Bilinmiyor",
          vergiDairesi: (mukellef as Record<string, unknown>).vergiDairesiAdi || "Bilinmiyor",
          il: (mukellef as Record<string, unknown>).ilAdi || "",
          durum: (mukellef as Record<string, unknown>).durum || "Aktif"
        }
      });
    } catch (error) {
      console.error("GIB VKN lookup error:", error);
      res.status(500).json({ success: false, error: "Sorgulama sırasında sunucu hatası oluştu." });
    }
  });

  // ── Luca Kontör Bakiyesi ─────────────────────────────────────────────────
  app.get("/api/luca/kontor", async (_req: Request, res: Response) => {
    if (!LUCA_API_KEY) {
      return res.status(503).json({
        success: false,
        notConfigured: true,
        error: 'LUCA_API_KEY ortam değişkeni ayarlanmamış. e-Fatura entegrasyonu devre dışı.'
      });
    }
    try {
      const r = await fetch(`${LUCA_API_URL}/einvoice/kontor`, {
        headers: { 'Authorization': `Bearer ${LUCA_API_KEY}`, 'Content-Type': 'application/json' }
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ success: false, error: data.message || 'Luca API hatası' });
      res.json({ success: true, data });
    } catch (err) {
      console.error('Luca kontor error:', err);
      res.status(500).json({ success: false, error: 'Luca API bağlantı hatası' });
    }
  });

  // ── Luca e-Fatura Gönderimi ──────────────────────────────────────────────
  app.post("/api/luca/fatura-gonder", async (req: Request, res: Response) => {
    const { invoiceId, invoiceData } = req.body;
    console.log(`e-Fatura gönderimi başlatıldı: ${invoiceId}`);

    if (!LUCA_API_KEY) {
      return res.status(503).json({
        success: false,
        notConfigured: true,
        error: 'LUCA_API_KEY ortam değişkeni ayarlanmamış. Fatura gönderilemedi.'
      });
    }

    try {
      const r = await fetch(`${LUCA_API_URL}/einvoice/send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${LUCA_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId, ...invoiceData })
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ success: false, error: data.message || 'Luca fatura gönderim hatası' });
      // Real Luca response should include ettn field
      res.json({ success: true, message: 'Fatura Luca e-Fatura sistemine iletildi.', ettn: data.ettn || data.uuid || data.id });
    } catch (err) {
      console.error('Luca fatura-gonder error:', err);
      res.status(500).json({ success: false, error: 'Luca API bağlantı hatası' });
    }
  });

  // ── Cargo Tracking Proxy Routes ──────────────────────────────────────────

  // DHL Tracking — https://developer.dhl.com/api-reference/shipment-tracking
  app.get('/api/tracking/dhl/:trackingNumber', async (req: Request, res: Response) => {
    const apiKey = process.env.DHL_API_KEY;
    const trackingNumber = Array.isArray(req.params.trackingNumber) ? req.params.trackingNumber[0] : req.params.trackingNumber;

    if (!apiKey) {
      return res.json({
        mock: true, carrier: 'DHL', trackingNumber,
        status: 'In Transit', statusCode: 'in_transit',
        origin: 'Frankfurt, DE', destination: 'Istanbul, TR',
        estimatedDelivery: new Date(Date.now() + 2 * 86400000).toISOString(),
        service: 'DHL Express Worldwide',
        events: [
          { timestamp: new Date().toISOString(), location: 'Frankfurt, DE', status: 'In Transit', description: 'Shipment is in transit' },
          { timestamp: new Date(Date.now() - 3600000).toISOString(), location: 'Leipzig Hub, DE', status: 'Departed', description: 'Departed from facility' },
          { timestamp: new Date(Date.now() - 7200000).toISOString(), location: 'Leipzig Hub, DE', status: 'Arrived', description: 'Arrived at DHL hub' },
          { timestamp: new Date(Date.now() - 86400000).toISOString(), location: 'Sender City, DE', status: 'Picked Up', description: 'Shipment picked up' },
        ]
      });
    }

    try {
      const r = await fetch(
        `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}`,
        { headers: { 'DHL-API-Key': apiKey, 'Accept': 'application/json' } }
      );
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.title || 'DHL API Error' });
      res.json(data);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'DHL fetch failed' });
    }
  });

  // UPS Tracking — https://developer.ups.com/api/reference/tracking
  app.get('/api/tracking/ups/:trackingNumber', async (req: Request, res: Response) => {
    const clientId = process.env.UPS_CLIENT_ID;
    const clientSecret = process.env.UPS_CLIENT_SECRET;
    const trackingNumber = Array.isArray(req.params.trackingNumber) ? req.params.trackingNumber[0] : req.params.trackingNumber;

    if (!clientId || !clientSecret) {
      return res.json({
        mock: true, carrier: 'UPS', trackingNumber,
        status: 'Out For Delivery', statusCode: 'out_for_delivery',
        origin: 'Louisville, KY, US', destination: 'Istanbul, TR',
        estimatedDelivery: new Date(Date.now() + 86400000).toISOString(),
        service: 'UPS Worldwide Express',
        events: [
          { timestamp: new Date().toISOString(), location: 'Istanbul, TR', status: 'Out For Delivery', description: 'Out for delivery' },
          { timestamp: new Date(Date.now() - 3600000).toISOString(), location: 'Istanbul Customs, TR', status: 'Cleared', description: 'Released from customs' },
          { timestamp: new Date(Date.now() - 86400000).toISOString(), location: 'Cologne Hub, DE', status: 'In Transit', description: 'Arrived at UPS facility' },
          { timestamp: new Date(Date.now() - 2 * 86400000).toISOString(), location: 'Louisville, KY, US', status: 'Departed', description: 'Departed from facility' },
        ]
      });
    }

    try {
      // OAuth token
      const tokenRes = await fetch('https://onlinetools.ups.com/security/v1/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        },
        body: 'grant_type=client_credentials'
      });
      const token = await tokenRes.json();
      if (!tokenRes.ok) return res.status(401).json({ error: 'UPS OAuth failed' });

      const r = await fetch(
        `https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(trackingNumber)}?locale=en_US&returnSignature=false`,
        { headers: { 'Authorization': `Bearer ${token.access_token}`, 'transId': Date.now().toString(), 'transactionSrc': 'cetpa' } }
      );
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: 'UPS Tracking Error' });
      res.json(data);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'UPS fetch failed' });
    }
  });

  // FedEx Tracking — https://developer.fedex.com/api/en-us/catalog/tracking
  app.post('/api/tracking/fedex', async (req: Request, res: Response) => {
    const clientId = process.env.FEDEX_CLIENT_ID;
    const clientSecret = process.env.FEDEX_CLIENT_SECRET;
    const { trackingNumber } = req.body;

    if (!clientId || !clientSecret) {
      return res.json({
        mock: true, carrier: 'FedEx', trackingNumber,
        status: 'Delivered', statusCode: 'delivered',
        origin: 'Memphis, TN, US', destination: 'Istanbul, TR',
        estimatedDelivery: new Date(Date.now() - 3600000).toISOString(),
        service: 'FedEx International Priority',
        events: [
          { timestamp: new Date(Date.now() - 3600000).toISOString(), location: 'Istanbul, TR', status: 'DL', description: 'Delivered - Package handed to recipient' },
          { timestamp: new Date(Date.now() - 7200000).toISOString(), location: 'Istanbul, TR', status: 'OD', description: 'On FedEx vehicle for delivery' },
          { timestamp: new Date(Date.now() - 86400000).toISOString(), location: 'Istanbul Ataturk, TR', status: 'AR', description: 'Arrived at FedEx location' },
          { timestamp: new Date(Date.now() - 2 * 86400000).toISOString(), location: 'Paris CDG, FR', status: 'DP', description: 'Left FedEx origin facility' },
          { timestamp: new Date(Date.now() - 3 * 86400000).toISOString(), location: 'Memphis, TN, US', status: 'PU', description: 'Picked up' },
        ]
      });
    }

    try {
      const tokenRes = await fetch('https://apis.fedex.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`
      });
      const token = await tokenRes.json();
      if (!tokenRes.ok) return res.status(401).json({ error: 'FedEx OAuth failed' });

      const r = await fetch('https://apis.fedex.com/track/v1/trackingnumbers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'Content-Type': 'application/json',
          'X-locale': 'en_US'
        },
        body: JSON.stringify({
          trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
          includeDetailedScans: true
        })
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: 'FedEx Tracking Error' });
      res.json(data);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'FedEx fetch failed' });
    }
  });

  // ── Mikro Jump API Routes ────────────────────────────────────────────────────

  /** GET /api/mikro/status — is Mikro configured and token reachable? */
  app.get('/api/mikro/status', async (_req: Request, res: Response) => {
    if (!isMikroConfigured()) {
      return res.json({ configured: false, connected: false, message: 'Mikro env vars ayarlanmamış.' });
    }
    try {
      await getMikroToken();
      res.json({ configured: true, connected: true });
    } catch (err) {
      res.json({ configured: true, connected: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /api/mikro/stok/kaydet — push inventory item → Mikro StokKaydetV2 */
  app.post('/api/mikro/stok/kaydet', async (req: Request, res: Response) => {
    if (!isMikroConfigured()) return res.status(503).json({ success: false, notConfigured: true });

    const { item, firebaseId } = req.body as { item: Record<string, unknown>; firebaseId: string };
    const t0 = Date.now();

    try {
      const prices = (item.prices as Record<string, number>) || {};
      const stok = {
        sto_kod:              (item.sku  as string) || `STK${Date.now()}`,
        sto_isim:             (item.name as string) || '',
        sto_kisa_ismi:        ((item.name as string) || '').substring(0, 24),
        sto_cins:             0,
        sto_doviz_cinsi:      0,
        sto_birim1_ad:        'ADET',
        sto_perakende_vergi:  20,
        sto_toptan_vergi:     20,
        satis_fiyatlari: [
          { sfiyat_listesirano: 1, sfiyat_deposirano: 1, sfiyat_odemeplan: 0, sfiyat_birim_pntr: 1, sfiyat_fiyati: prices['Retail']       || 0, sfiyat_doviz: 0 },
          { sfiyat_listesirano: 2, sfiyat_deposirano: 1, sfiyat_odemeplan: 0, sfiyat_birim_pntr: 1, sfiyat_fiyati: prices['B2B Standard'] || 0, sfiyat_doviz: 0 },
          { sfiyat_listesirano: 3, sfiyat_deposirano: 1, sfiyat_odemeplan: 0, sfiyat_birim_pntr: 1, sfiyat_fiyati: prices['B2B Premium']  || 0, sfiyat_doviz: 0 },
          { sfiyat_listesirano: 4, sfiyat_deposirano: 1, sfiyat_odemeplan: 0, sfiyat_birim_pntr: 1, sfiyat_fiyati: prices['Dealer']       || 0, sfiyat_doviz: 0 },
        ].filter(p => p.sfiyat_fiyati > 0),
      };

      const { ok, data, status } = await mikroPost('StokKaydetV2', { stoklar: [stok] });
      const duration = Date.now() - t0;
      const d = data as Record<string, unknown>;
      const success = ok && d?.success !== false;
      const mikroStoKod = stok.sto_kod;
      const errorMsg = success ? null : ((d?.message || d?.error || `HTTP ${status}`) as string);

      await writeSyncLog('StokKaydetV2', 'inventory', firebaseId, success, mikroStoKod, errorMsg, duration);

      if (adminDb && firebaseId && success) {
        await adminDb.collection('inventory').doc(firebaseId).update({
          mikroStoKod,
          mikroSynced:   true,
          mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      res.json({ success, mikroStoKod, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await writeSyncLog('StokKaydetV2', 'inventory', firebaseId || 'unknown', false, null, errorMsg, duration);
      console.error('Mikro StokKaydetV2 hatası:', err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  /** POST /api/mikro/stok/listesi — pull Mikro StokListesiV2 → Firebase */
  app.post('/api/mikro/stok/listesi', async (req: Request, res: Response) => {
    if (!isMikroConfigured()) return res.status(503).json({ success: false, notConfigured: true });

    const { stokKod = '', ilkTarih = '2020-01-01', size = 100, index = 0 } = req.body || {};
    const t0 = Date.now();

    try {
      const { ok, data, status } = await mikroPost('StokListesiV2', {
        StokKod:   stokKod,
        TarihTipi: 2,
        IlkTarih:  ilkTarih,
        SonTarih:  `${new Date().getFullYear() + 1}-12-31`,
        Sort:      'sto_kod',
        Size:      String(size),
        Index:     index,
      });

      if (!ok) return res.status(status).json({ success: false, error: data });

      const stoklar = ((data as Record<string, unknown>)?.stoklar ?? data) as Record<string, unknown>[];

      // Mirror matched items back to Firebase
      if (adminDb && Array.isArray(stoklar)) {
        for (const s of stoklar) {
          const sku = s.sto_kod as string;
          if (!sku) continue;
          const snap = await adminDb.collection('inventory').where('sku', '==', sku).limit(1).get();
          if (!snap.empty) {
            await snap.docs[0].ref.update({
              mikroStoKod:   sku,
              mikroSynced:   true,
              mikroData:     s,
              mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        }
      }

      res.json({ success: true, count: Array.isArray(stoklar) ? stoklar.length : 0, data: stoklar, duration: Date.now() - t0 });
    } catch (err) {
      console.error('Mikro StokListesiV2 hatası:', err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /api/mikro/cari/kaydet — push lead/customer → Mikro CariKaydetV2 */
  app.post('/api/mikro/cari/kaydet', async (req: Request, res: Response) => {
    if (!isMikroConfigured()) return res.status(503).json({ success: false, notConfigured: true });

    const { lead, firebaseId } = req.body as { lead: Record<string, unknown>; firebaseId: string };
    const t0 = Date.now();

    try {
      const cariKod = (lead.mikroCariKod as string) || `CAR${(firebaseId || Date.now().toString()).substring(0, 6).toUpperCase()}`;
      const contactName = (lead.contactName as string) || '';
      const nameParts   = contactName.split(' ');

      const cari = {
        cari_kod:                    cariKod,
        cari_unvan1:                 (lead.company  as string) || (lead.name as string) || '',
        cari_unvan2:                 '',
        cari_vdaire_no:              (lead.taxId     as string) || (lead.vkn as string) || '',
        cari_vdaire_adi:             (lead.taxOffice as string) || '',
        cari_EMail:                  (lead.email     as string) || '',
        cari_CepTel:                 (lead.phone     as string) || '',
        cari_efatura_fl:             (lead.eFaturaKayitli as boolean) ? 1 : 0,
        cari_def_efatura_cinsi:      0,
        cari_doviz_cinsi1:           0,
        cari_doviz_cinsi2:           255,
        cari_doviz_cinsi3:           255,
        cari_KurHesapSekli:          1,
        cari_sevk_adres_no:          0,
        cari_fatura_adres_no:        0,
        adres: [{
          adr_cadde:          (lead.address  as string) || '',
          adr_ilce:           (lead.district as string) || '',
          adr_il:             (lead.city     as string) || '',
          adr_ulke:           'TÜRKİYE',
          adr_tel_ulke_kodu:  '090',
          adr_tel_bolge_kodu: '',
          adr_tel_no1:        (lead.phone    as string) || '',
          adr_posta_kodu:     0,
          yetkili: contactName ? [{
            mye_isim:         nameParts[0]  || '',
            mye_soyisim:      nameParts.slice(1).join(' ') || '',
            mye_email_adres:  (lead.email as string) || '',
            mye_cep_telno:    (lead.phone as string) || '',
            mye_dahili_telno: '',
          }] : [],
        }],
      };

      const { ok, data, status } = await mikroPost('CariKaydetV2', { cariler: [cari] });
      const duration = Date.now() - t0;
      const d = data as Record<string, unknown>;
      const success = ok && d?.success !== false;
      const errorMsg = success ? null : ((d?.message || d?.error || `HTTP ${status}`) as string);

      await writeSyncLog('CariKaydetV2', 'lead', firebaseId, success, cariKod, errorMsg, duration);

      if (adminDb && firebaseId && success) {
        await adminDb.collection('leads').doc(firebaseId).update({
          mikroCariKod:  cariKod,
          mikroSynced:   true,
          mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      res.json({ success, cariKod, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await writeSyncLog('CariKaydetV2', 'lead', firebaseId || 'unknown', false, null, errorMsg, duration);
      console.error('Mikro CariKaydetV2 hatası:', err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  /** POST /api/mikro/cari/listesi — pull Mikro CariListesiV2 → Firebase */
  app.post('/api/mikro/cari/listesi', async (req: Request, res: Response) => {
    if (!isMikroConfigured()) return res.status(503).json({ success: false, notConfigured: true });

    const { whereStr = "cari_baglanti_tipi=0 and cari_lastup_date > '2020/01/01'", size = 200, index = 0 } = req.body || {};
    const t0 = Date.now();

    try {
      const { ok, data, status } = await mikroPost('CariListesiV2', {
        FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl',
        WhereStr:  whereStr,
        Sort:      'cari_kod',
        Size:      String(size),
        Index:     index,
      });

      if (!ok) return res.status(status).json({ success: false, error: data });

      const cariler = ((data as Record<string, unknown>)?.cariler ?? data) as Record<string, unknown>[];

      if (adminDb && Array.isArray(cariler)) {
        for (const c of cariler) {
          const cariKod = c.cari_kod as string;
          if (!cariKod) continue;
          const snap = await adminDb.collection('leads').where('mikroCariKod', '==', cariKod).limit(1).get();
          if (!snap.empty) {
            await snap.docs[0].ref.update({
              mikroData:     c,
              mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        }
      }

      res.json({ success: true, count: Array.isArray(cariler) ? cariler.length : 0, data: cariler, duration: Date.now() - t0 });
    } catch (err) {
      console.error('Mikro CariListesiV2 hatası:', err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /api/mikro/siparis/kaydet — push order → Mikro SiparisKaydetV2 */
  app.post('/api/mikro/siparis/kaydet', async (req: Request, res: Response) => {
    if (!isMikroConfigured()) return res.status(503).json({ success: false, notConfigured: true });

    const { order, firebaseId } = req.body as { order: Record<string, unknown>; firebaseId: string };
    const t0 = Date.now();

    try {
      const lineItems = (order.lineItems || []) as Record<string, unknown>[];
      if (lineItems.length === 0) {
        return res.status(400).json({ success: false, error: 'Sipariş satırı bulunamadı.' });
      }

      // Format date as dd.MM.yyyy for Mikro
      const rawDate   = order.createdAt ? new Date(order.createdAt as string) : new Date();
      const orderDate = `${String(rawDate.getDate()).padStart(2,'0')}.${String(rawDate.getMonth()+1).padStart(2,'0')}.${rawDate.getFullYear()}`;

      const satirlar = lineItems.map((item: Record<string, unknown>) => ({
        sip_tarih:        orderDate,
        sip_tip:          '1',
        sip_cins:         '0',
        sip_evrakno_seri: 'T',
        sip_musteri_kod:  (order.mikroCariKod as string) || '',
        sip_stok_kod:     (item.sku as string) || (item.productId as string) || '',
        sip_b_fiyat:      Number((item.unitPrice as number) || (item.price as number) || 0),
        sip_miktar:       Number((item.quantity as number)  || 1),
        sip_tutar:        Number((item.total    as number)  || ((item.unitPrice as number || 0) * (item.quantity as number || 1))),
        sip_vergi_pntr:   4,     // 20% KDV (adjust per product if needed)
        sip_depono:       1,
        sip_vergisiz_fl:  false,
      }));

      const { ok, data, status } = await mikroPost('SiparisKaydetV2', {
        evraklar: [{ satirlar }],
      });

      const duration = Date.now() - t0;
      const d = data as Record<string, unknown>;
      const success = ok && d?.success !== false;
      const mikroEvrakNo = (d?.evrakNo || d?.id || null) as string | null;
      const errorMsg = success ? null : ((d?.message || d?.error || `HTTP ${status}`) as string);

      await writeSyncLog('SiparisKaydetV2', 'order', firebaseId, success, mikroEvrakNo, errorMsg, duration);

      if (adminDb && firebaseId && success) {
        await adminDb.collection('orders').doc(firebaseId).update({
          mikroEvrakNo,
          mikroSynced:   true,
          mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      res.json({ success, mikroEvrakNo, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await writeSyncLog('SiparisKaydetV2', 'order', firebaseId || 'unknown', false, null, errorMsg, duration);
      console.error('Mikro SiparisKaydetV2 hatası:', err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      optimizeDeps: { force: true },
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
