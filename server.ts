import express, { Request, Response } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cron from "node-cron";
import admin from "firebase-admin";
import { createHmac } from "crypto";

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

interface MikroCreds {
  idmEmail: string;
  idmPassword: string;
  alias: string;
  firmaKodu: string;
  calismaYili: string;
  apiKey: string;
  kullaniciKodu: string;
  sifre: string;
  firmaNo: number;
  subeNo: number;
}

/**
 * Get Mikro credentials — env vars take priority, Firestore settings/mikro as fallback.
 * This allows the admin to configure Mikro from the Settings UI without needing env vars.
 */
async function getMikroCreds(): Promise<MikroCreds | null> {
  // 1. Try env vars first (server deployment)
  if (
    process.env.MIKRO_IDM_EMAIL &&
    process.env.MIKRO_IDM_PASSWORD &&
    process.env.MIKRO_API_KEY &&
    process.env.MIKRO_ALIAS
  ) {
    return {
      idmEmail:      process.env.MIKRO_IDM_EMAIL,
      idmPassword:   process.env.MIKRO_IDM_PASSWORD,
      alias:         process.env.MIKRO_ALIAS,
      firmaKodu:     process.env.MIKRO_FIRMA_KODU     || '01',
      calismaYili:   process.env.MIKRO_CALISMA_YILI   || String(new Date().getFullYear()),
      apiKey:        process.env.MIKRO_API_KEY,
      kullaniciKodu: process.env.MIKRO_KULLANICI_KODU || 'SRV',
      sifre:         process.env.MIKRO_SIFRE          || '',
      firmaNo:       parseInt(process.env.MIKRO_FIRMA_NO || '0', 10),
      subeNo:        parseInt(process.env.MIKRO_SUBE_NO  || '0', 10),
    };
  }

  // 2. Fallback: read from Firestore settings/mikro (entered from Settings UI)
  if (!adminDb) return null;
  try {
    const snap = await adminDb.collection('settings').doc('mikro').get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, unknown>;
    // Support both new field names and legacy "accessToken" → idmPassword mapping
    const idmEmail    = (d.idmEmail    || d.email)         as string | undefined;
    const idmPassword = (d.idmPassword || d.accessToken || d.access_token) as string | undefined;
    const alias       = d.alias        as string | undefined;
    const apiKey      = d.apiKey       as string | undefined;

    if (!idmPassword || !alias) return null; // minimum required

    return {
      idmEmail:      idmEmail      || '',
      idmPassword,
      alias,
      firmaKodu:     (d.firmaKodu     as string) || '01',
      calismaYili:   (d.calismaYili   as string) || String(new Date().getFullYear()),
      apiKey:        apiKey  || '',
      kullaniciKodu: (d.kullaniciKodu as string) || 'SRV',
      sifre:         (d.sifre         as string) || '',
      firmaNo:       Number(d.firmaNo  ?? 0),
      subeNo:        Number(d.subeNo   ?? 0),
    };
  } catch (e) {
    console.warn('getMikroCreds: Firestore read failed:', e);
    return null;
  }
}

// In-memory token cache keyed by IDM email (invalidates if user changes creds)
const mikroTokenCacheMap = new Map<string, { access_token: string; expiresAt: number }>();

async function getMikroToken(creds: MikroCreds): Promise<string> {
  const cacheKey = `${creds.idmEmail}|${creds.alias}`;
  const now      = Date.now();
  const cached   = mikroTokenCacheMap.get(cacheKey);

  if (cached && now < cached.expiresAt - 5 * 60 * 1000) {
    return cached.access_token;
  }

  const res = await fetch(MIKRO_AUTH_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:  'mikro-rjf',
      username:   creds.idmEmail,
      password:   creds.idmPassword,
      grant_type: 'password',
    }).toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Mikro token alınamadı (${res.status}): ${errText.substring(0, 300)}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  mikroTokenCacheMap.set(cacheKey, {
    access_token: data.access_token,
    expiresAt:    now + (data.expires_in || 21600) * 1000,
  });
  console.log(`Mikro token alındı ✓ alias=${creds.alias} (${Math.round((data.expires_in || 21600) / 60)} dk geçerli)`);
  return data.access_token;
}

function buildMikroContext(creds: MikroCreds): Record<string, unknown> {
  return {
    Alias:         creds.alias,
    FirmaKodu:     creds.firmaKodu,
    CalismaYili:   creds.calismaYili,
    ApiKey:        creds.apiKey,
    KullaniciKodu: creds.kullaniciKodu,
    Sifre:         creds.sifre,
    FirmaNo:       creds.firmaNo,
    SubeNo:        creds.subeNo,
  };
}

/** Call a Mikro Jump API endpoint — resolves creds, injects token + context. */
async function mikroPost(
  endpoint: string,
  extraBody: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const creds = await getMikroCreds();
  if (!creds) throw new Error('Mikro kimlik bilgileri bulunamadı. Ayarlar > Mikro ERP bölümünden girin.');

  const token = await getMikroToken(creds);
  const url   = `${MIKRO_API_BASE}/${endpoint}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ Mikro: buildMikroContext(creds), ...extraBody }),
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
    const cronCreds = await getMikroCreds();
    if (!cronCreds || !adminDb) return;
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
    const statusCreds = await getMikroCreds();
    if (!statusCreds) {
      return res.json({ configured: false, connected: false, message: 'Mikro kimlik bilgileri yapılandırılmamış. Ayarlar > Mikro ERP bölümünden girin.' });
    }
    try {
      await getMikroToken(statusCreds);
      res.json({ configured: true, connected: true });
    } catch (err) {
      res.json({ configured: true, connected: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /api/mikro/stok/kaydet — push inventory item → Mikro StokKaydetV2 */
  app.post('/api/mikro/stok/kaydet', async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

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
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

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
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

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
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

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
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

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

  // ── Mikro Full Import Routes ─────────────────────────────────────────────────
  // These UPSERT — create new Firebase docs for items that don't exist yet,
  // update existing ones. Paginates automatically until all records are fetched.

  /** POST /api/mikro/import/stok — import ALL Mikro stock → Firebase inventory */
  app.post('/api/mikro/import/stok', async (_req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });

    const t0 = Date.now();
    let created = 0, updated = 0, errors = 0;
    const PAGE_SIZE = 100;
    let index = 0;
    let hasMore = true;

    try {
      while (hasMore) {
        const { ok, data } = await mikroPost('StokListesiV2', {
          StokKod: '', TarihTipi: 2,
          IlkTarih: '2000-01-01',
          SonTarih: `${new Date().getFullYear() + 1}-12-31`,
          Sort: 'sto_kod', Size: String(PAGE_SIZE), Index: index,
        });

        if (!ok) break;

        const stoklar = ((data as Record<string, unknown>)?.stoklar ?? []) as Record<string, unknown>[];
        if (!Array.isArray(stoklar) || stoklar.length === 0) break;

        for (const s of stoklar) {
          const sku = (s.sto_kod as string)?.trim();
          if (!sku) continue;

          try {
            // Map Mikro fields → Cetpa InventoryItem shape
            const prices: Record<string, number> = {};
            const fiyatlar = (s.satis_fiyatlari as Record<string, unknown>[]) || [];
            if (fiyatlar[0]) prices['Retail']       = Number(fiyatlar[0].sfiyat_fiyati) || 0;
            if (fiyatlar[1]) prices['B2B Standard'] = Number(fiyatlar[1].sfiyat_fiyati) || 0;
            if (fiyatlar[2]) prices['B2B Premium']  = Number(fiyatlar[2].sfiyat_fiyati) || 0;
            if (fiyatlar[3]) prices['Dealer']        = Number(fiyatlar[3].sfiyat_fiyati) || 0;
            // Fallback: some responses use flat price fields
            if (!prices['Retail'] && s.sto_satis_fiyat1)       prices['Retail']       = Number(s.sto_satis_fiyat1);
            if (!prices['B2B Standard'] && s.sto_satis_fiyat2)  prices['B2B Standard'] = Number(s.sto_satis_fiyat2);
            if (!prices['B2B Premium'] && s.sto_satis_fiyat3)   prices['B2B Premium']  = Number(s.sto_satis_fiyat3);
            if (!prices['Dealer'] && s.sto_satis_fiyat4)        prices['Dealer']       = Number(s.sto_satis_fiyat4);

            const item = {
              sku,
              name:             (s.sto_isim as string)     || sku,
              category:         (s.sto_grup_isim as string) || (s.sto_grup_kodu as string) || 'Genel',
              unit:             (s.sto_birim1_ad as string) || 'ADET',
              vatRate:          Number(s.sto_perakende_vergi) || 20,
              stockLevel:       Number(s.sto_mevcut_mik ?? s.toplam_miktar ?? 0),
              lowStockThreshold: 5,
              prices,
              price:            prices['Retail'] || 0,
              mikroStoKod:      sku,
              mikroSynced:      true,
              mikroData:        s,
              source:           'mikro_import',
            };

            // Upsert: update if exists, create if not
            const snap = await adminDb.collection('inventory').where('sku', '==', sku).limit(1).get();
            if (!snap.empty) {
              await snap.docs[0].ref.update({
                ...item,
                mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              updated++;
            } else {
              await adminDb.collection('inventory').add({
                ...item,
                createdAt:     admin.firestore.FieldValue.serverTimestamp(),
                mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              created++;
            }
          } catch (itemErr) {
            console.warn(`Stok import hatası (${sku}):`, itemErr);
            errors++;
          }
        }

        hasMore = stoklar.length === PAGE_SIZE;
        index += PAGE_SIZE;
        console.log(`Stok import: sayfa ${index / PAGE_SIZE} tamamlandı — toplam ${created + updated} işlendi`);
      }

      const duration = Date.now() - t0;
      await writeSyncLog('ImportStok', 'inventory', 'bulk', true, null, null, duration);
      console.log(`Stok import tamamlandı — oluşturuldu: ${created}, güncellendi: ${updated}, hata: ${errors}, süre: ${duration}ms`);
      res.json({ success: true, created, updated, errors, duration });

    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await writeSyncLog('ImportStok', 'inventory', 'bulk', false, null, errorMsg, duration);
      console.error('Stok import genel hatası:', err);
      res.status(500).json({ success: false, error: errorMsg, created, updated, errors });
    }
  });

  /** POST /api/mikro/import/cari — import ALL Mikro cari → Firebase leads */
  app.post('/api/mikro/import/cari', async (_req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });

    const t0 = Date.now();
    let created = 0, updated = 0, errors = 0;
    const PAGE_SIZE = 100;
    let index = 0;
    let hasMore = true;

    try {
      while (hasMore) {
        const { ok, data } = await mikroPost('CariListesiV2', {
          FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl,cari_hareket_tipi,cari_baglanti_tipi,cari_muh_kod',
          WhereStr: "cari_baglanti_tipi=0 and cari_lastup_date > '2000/01/01'",
          Sort: 'cari_kod', Size: String(PAGE_SIZE), Index: index,
        });

        if (!ok) break;

        const cariler = ((data as Record<string, unknown>)?.cariler ?? []) as Record<string, unknown>[];
        if (!Array.isArray(cariler) || cariler.length === 0) break;

        for (const c of cariler) {
          const cariKod = (c.cari_kod as string)?.trim();
          if (!cariKod) continue;

          try {
            const unvan = (c.cari_unvan1 as string) || cariKod;
            // Determine if customer (0) or supplier (1) from hareket_tipi
            const hareketTipi = Number(c.cari_hareket_tipi ?? 0);
            const leadType = hareketTipi === 1 ? 'Supplier' : 'Customer';

            const lead = {
              mikroCariKod:   cariKod,
              company:        unvan,
              name:           unvan,
              email:          (c.cari_EMail   as string) || '',
              phone:          (c.cari_CepTel  as string) || '',
              taxId:          (c.cari_vdaire_no  as string) || '',
              taxOffice:      (c.cari_vdaire_adi as string) || '',
              eFaturaKayitli: Number(c.cari_efatura_fl) === 1,
              type:           leadType,
              status:         'Active',
              mikroSynced:    true,
              mikroData:      c,
              source:         'mikro_import',
            };

            // Upsert by mikroCariKod
            const snap = await adminDb.collection('leads').where('mikroCariKod', '==', cariKod).limit(1).get();
            if (!snap.empty) {
              await snap.docs[0].ref.update({
                ...lead,
                mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              updated++;
            } else {
              await adminDb.collection('leads').add({
                ...lead,
                createdAt:     admin.firestore.FieldValue.serverTimestamp(),
                mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              created++;
            }
          } catch (itemErr) {
            console.warn(`Cari import hatası (${cariKod}):`, itemErr);
            errors++;
          }
        }

        hasMore = cariler.length === PAGE_SIZE;
        index += PAGE_SIZE;
        console.log(`Cari import: sayfa ${index / PAGE_SIZE} tamamlandı — toplam ${created + updated} işlendi`);
      }

      const duration = Date.now() - t0;
      await writeSyncLog('ImportCari', 'lead', 'bulk', true, null, null, duration);
      console.log(`Cari import tamamlandı — oluşturuldu: ${created}, güncellendi: ${updated}, hata: ${errors}, süre: ${duration}ms`);
      res.json({ success: true, created, updated, errors, duration });

    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await writeSyncLog('ImportCari', 'lead', 'bulk', false, null, errorMsg, duration);
      console.error('Cari import genel hatası:', err);
      res.status(500).json({ success: false, error: errorMsg, created, updated, errors });
    }
  });

  // ── Mikro e-Fatura / e-Arşiv ─────────────────────────────────────────────────
  // POST /api/mikro/fatura/kaydet  — push order/invoice to Mikro as e-Fatura or e-Arşiv
  // Body: { order: Record<string, unknown>, firebaseId: string }
  //   order must have: mikroCariKod, lineItems[], totalPrice, faturaTipi ('e-fatura'|'e-arsiv'|'ihracat')
  // On success writes back: mikroFaturaNo, ettn, mikroFaturaDate to orders/{firebaseId}
  app.post('/api/mikro/fatura/kaydet', async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { order, firebaseId } = req.body as { order: Record<string, unknown>; firebaseId: string };
    const t0 = Date.now();
    try {
      const lineItems = (order.lineItems || []) as Record<string, unknown>[];
      if (lineItems.length === 0) return res.status(400).json({ success: false, error: 'Fatura satırı bulunamadı.' });

      const rawDate    = order.createdAt ? new Date(order.createdAt as string) : new Date();
      const faturaDate = `${String(rawDate.getDate()).padStart(2,'0')}.${String(rawDate.getMonth()+1).padStart(2,'0')}.${rawDate.getFullYear()}`;
      // faturaTipi: 1=e-Fatura, 2=e-Arşiv, 3=İhracat
      const faturaType = order.faturaTipi === 'e-arsiv' ? 2 : order.faturaTipi === 'ihracat' ? 3 : 1;
      const kdvOran    = Number(order.kdvOran ?? 20);

      const satirlar = lineItems.map((item: Record<string, unknown>) => ({
        fat_tarih:        faturaDate,
        fat_tip:          faturaType,
        fat_cins:         1,   // Satış faturası
        fat_evrakno_seri: 'F',
        fat_musteri_kod:  (order.mikroCariKod as string) || '',
        fat_stok_kod:     (item.sku  as string) || '',
        fat_isim:         (item.name as string) || '',
        fat_birim_fiyat:  Number(item.price    ?? 0),
        fat_miktar:       Number(item.quantity ?? 1),
        fat_tutar:        Number(item.price ?? 0) * Number(item.quantity ?? 1),
        fat_vergi_pntr:   kdvOran >= 20 ? 4 : kdvOran >= 10 ? 3 : 1,
        fat_vergisiz_fl:  false,
      }));

      const { ok, data, status } = await mikroPost('FaturaKaydetV2', { evraklar: [{ satirlar }] });
      const duration   = Date.now() - t0;
      const d          = data as Record<string, unknown>;
      const success    = ok && d?.success !== false;
      const mikroFaturaNo = (d?.faturaNo || d?.evrakNo || d?.id || null) as string | null;
      const ettn          = (d?.ettn || d?.uuid || null) as string | null;
      const errorMsg   = success ? null : ((d?.message || d?.error || `HTTP ${status}`) as string);

      await writeSyncLog('FaturaKaydetV2', 'order', firebaseId || 'unknown', success, mikroFaturaNo, errorMsg, duration);
      if (adminDb && firebaseId && success) {
        await adminDb.collection('orders').doc(firebaseId).set({
          mikroFaturaNo,
          ettn,
          hasInvoice:      true,
          mikroFaturaDate: faturaDate,
          mikroSynced:     true,
          mikroSyncedAt:   admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      res.json({ success, mikroFaturaNo, ettn, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await writeSyncLog('FaturaKaydetV2', 'order', firebaseId || 'unknown', false, null, errorMsg, duration);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // ── Mikro e-İrsaliye ─────────────────────────────────────────────────────────
  // POST /api/mikro/irsaliye/kaydet  — push shipment as e-İrsaliye to Mikro
  // Body: { shipment: Record<string, unknown>, firebaseId: string }
  //   shipment must have: mikroCariKod, customerName, destination, trackingNo, items[]
  // On success writes back: irsaliyeNo, irsaliyeEttn to shipments/{firebaseId}
  app.post('/api/mikro/irsaliye/kaydet', async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { shipment, firebaseId } = req.body as { shipment: Record<string, unknown>; firebaseId: string };
    const t0 = Date.now();
    try {
      const rawDate   = shipment.date ? new Date(shipment.date as string) : new Date();
      const irsDate   = `${String(rawDate.getDate()).padStart(2,'0')}.${String(rawDate.getMonth()+1).padStart(2,'0')}.${rawDate.getFullYear()}`;
      const items = (shipment.items || []) as Record<string, unknown>[];

      // If no line items, create a placeholder row for the delivery note
      const satirlar = items.length > 0 ? items.map((item: Record<string, unknown>) => ({
        irs_tarih:        irsDate,
        irs_tip:          7,   // Satış irsaliyesi
        irs_cins:         1,
        irs_evrakno_seri: 'I',
        irs_musteri_kod:  (shipment.mikroCariKod as string) || '',
        irs_stok_kod:     (item.sku  as string) || '',
        irs_isim:         (item.name as string) || (shipment.customerName as string) || '',
        irs_miktar:       Number(item.quantity ?? 1),
        irs_birim_fiyat:  Number(item.price    ?? 0),
        irs_tutar:        Number(item.price ?? 0) * Number(item.quantity ?? 1),
        irs_kargo_firma:  (shipment.cargoFirm as string) || '',
        irs_plaka:        (shipment.trackingNo as string) || '',
      })) : [{
        irs_tarih:        irsDate,
        irs_tip:          7,
        irs_cins:         1,
        irs_evrakno_seri: 'I',
        irs_musteri_kod:  (shipment.mikroCariKod as string) || '',
        irs_isim:         (shipment.customerName as string) || '',
        irs_miktar:       1,
        irs_birim_fiyat:  0,
        irs_tutar:        0,
        irs_kargo_firma:  (shipment.cargoFirm as string) || '',
        irs_plaka:        (shipment.trackingNo as string) || '',
      }];

      const { ok, data, status } = await mikroPost('IrsaliyeKaydetV2', { evraklar: [{ satirlar }] });
      const duration      = Date.now() - t0;
      const d             = data as Record<string, unknown>;
      const success       = ok && d?.success !== false;
      const irsaliyeNo    = (d?.irsaliyeNo || d?.evrakNo || d?.id || null) as string | null;
      const irsaliyeEttn  = (d?.ettn || d?.uuid || null) as string | null;
      const errorMsg      = success ? null : ((d?.message || d?.error || `HTTP ${status}`) as string);

      await writeSyncLog('IrsaliyeKaydetV2', 'shipment', firebaseId || 'unknown', success, irsaliyeNo, errorMsg, duration);
      if (adminDb && firebaseId && success) {
        await adminDb.collection('shipments').doc(firebaseId).set({
          irsaliyeNo,
          irsaliyeEttn,
          mikroSynced:     true,
          mikroSyncedAt:   admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      res.json({ success, irsaliyeNo, irsaliyeEttn, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await writeSyncLog('IrsaliyeKaydetV2', 'shipment', firebaseId || 'unknown', false, null, errorMsg, duration);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // ── Mikro Pull: Cari Bakiye ──────────────────────────────────────────────────
  // POST /api/mikro/pull/bakiye — pull AR/AP balances from Mikro → Firebase cariBalances
  // Runs full CariHareketListesiV2 per lead that has mikroCariKod; updates their bakiye
  app.post('/api/mikro/pull/bakiye', async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    try {
      // 1. Fetch all leads that have a mikroCariKod
      const leadsSnap = await adminDb.collection('leads')
        .where('mikroCariKod', '!=', '')
        .limit(Number(req.body?.limit ?? 100))
        .get();

      let updated = 0, errors = 0;
      for (const leadDoc of leadsSnap.docs) {
        const cariKod = (leadDoc.data() as Record<string, unknown>).mikroCariKod as string;
        try {
          const { ok, data } = await mikroPost('CariHareketListesiV2', {
            CariKod: cariKod,
            Size: '1',    // We only need the running balance; some versions return it in the header
            Index: 0,
          });
          if (!ok) { errors++; continue; }
          const d = data as Record<string, unknown>;
          // Mikro returns bakiye in various field names depending on version
          const bakiye      = Number(d?.bakiye ?? d?.Bakiye ?? d?.cariBakiye ?? 0);
          const vadeliBorc  = Number(d?.vadeliBorc ?? d?.VadeliBorc ?? 0);
          // Mirror to cariBalances collection AND update lead doc
          await adminDb.collection('cariBalances').doc(cariKod).set({
            cariKod, bakiye, vadeliBorc,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          await leadDoc.ref.set({ bakiye, vadeliBorc }, { merge: true });
          updated++;
        } catch { errors++; }
      }
      res.json({ success: true, total: leadsSnap.size, updated, errors, duration: Date.now() - t0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Mikro Pull: Mizan (Trial Balance) ───────────────────────────────────────
  // POST /api/mikro/pull/mizan  — pull monthly trial balance → Firebase accountingPeriods
  // Body: { period?: 'YYYY-MM', yil?: number, ay?: number }
  app.post('/api/mikro/pull/mizan', async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    try {
      const now    = new Date();
      const period = (req.body?.period as string) || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      const [yil, ay] = period.split('-').map(Number);
      const ilkTarih  = `${yil}-${String(ay).padStart(2,'0')}-01`;
      const lastDay   = new Date(yil, ay, 0).getDate();
      const sonTarih  = `${yil}-${String(ay).padStart(2,'0')}-${lastDay}`;

      const { ok, data, status } = await mikroPost('MizanV2', {
        IlkTarih: ilkTarih,
        SonTarih: sonTarih,
        Tip: 1,   // 1=Yardımcı hesap düzeyi
        Size: '500',
        Index: 0,
      });

      if (!ok) return res.status(status).json({ success: false, error: `Mikro API ${status}` });
      const d      = data as Record<string, unknown>;
      const rows   = (d?.hesaplar ?? d?.mizan ?? []) as Record<string, unknown>[];
      const docId  = period;

      await adminDb.collection('accountingPeriods').doc(docId).set({
        period, yil, ay, rows,
        toplam: { borc: rows.reduce((s, r) => s + Number(r.borc ?? 0), 0), alacak: rows.reduce((s, r) => s + Number(r.alacak ?? 0), 0) },
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      res.json({ success: true, period, rowCount: rows.length, duration: Date.now() - t0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Mutabakat PDF Generation ─────────────────────────────────────────────────
  // GET /api/mutabakat/:leadId  — returns JSON data for client-side PDF generation
  // The client (MutabakatPanel) renders the PDF using jsPDF
  app.get('/api/mutabakat/:leadId', async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin başlatılamadı.' });
    try {
      const leadId = req.params.leadId as string;
      const period     = (req.query.period as string) || new Date().getFullYear().toString();

      // Fetch lead
      const leadSnap = await adminDb.collection('leads').doc(leadId).get();
      if (!leadSnap.exists) return res.status(404).json({ error: 'Müşteri bulunamadı.' });
      const lead = leadSnap.data() as Record<string, unknown>;

      // Fetch open orders
      const ordersSnap = await adminDb.collection('orders')
        .where('leadId', '==', leadId)
        .where('status', 'in', ['Pending', 'Processing', 'Shipped'])
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      const orders = ordersSnap.docs.map(d => {
        const o = d.data() as Record<string, unknown>;
        const ts = (o.createdAt as admin.firestore.Timestamp);
        return {
          id:           d.id,
          orderNo:      (o.shopifyOrderId || o.trendyolOrderNo || o.mikroEvrakNo || d.id.substring(0,8)) as string,
          date:         ts?.toDate?.()?.toISOString().split('T')[0] ?? '',
          amount:       Number(o.totalPrice ?? o.totalAmount ?? 0),
          status:       o.status as string,
          faturaNo:     (o.mikroFaturaNo ?? '') as string,
        };
      });

      const totalAmount = orders.reduce((s, o) => s + o.amount, 0);
      const bakiye      = Number((lead.bakiye as number) ?? 0);

      res.json({
        success: true,
        lead: {
          id:       leadId,
          name:     lead.name as string,
          company:  lead.company as string,
          email:    lead.email as string,
          phone:    lead.phone as string,
          taxId:    lead.taxId as string,
          cariKod:  lead.mikroCariKod as string,
          bakiye,
        },
        orders,
        totalAmount,
        period,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── KDV Özet Pull ─────────────────────────────────────────────────────────────
  // POST /api/mikro/pull/kdv  — pull monthly KDV summary → Firebase taxSummary
  app.post('/api/mikro/pull/kdv', async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    try {
      const now    = new Date();
      const period = (req.body?.period as string) || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      const [yil, ay] = period.split('-').map(Number);
      const ilkTarih  = `${yil}-${String(ay).padStart(2,'0')}-01`;
      const lastDay   = new Date(yil, ay, 0).getDate();
      const sonTarih  = `${yil}-${String(ay).padStart(2,'0')}-${lastDay}`;

      const { ok, data, status } = await mikroPost('KdvOzetV2', {
        IlkTarih: ilkTarih, SonTarih: sonTarih,
      });
      if (!ok) return res.status(status).json({ success: false, error: `Mikro API ${status}` });
      const d = data as Record<string, unknown>;
      await adminDb.collection('taxSummary').doc(period).set({
        period, yil, ay,
        kdvHesaplanan: Number(d?.kdvHesaplanan ?? d?.hesaplananKdv ?? 0),
        kdvIndirilecek: Number(d?.kdvIndirilecek ?? d?.indirilecekKdv ?? 0),
        kdvOdenmesi: Number(d?.odenmesiGerekenKdv ?? d?.kdvFarki ?? 0),
        rawData: d,
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      res.json({ success: true, period, data: d, duration: Date.now() - t0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Trendyol Seller API ─────────────────────────────────────────────────────
  // Credentials: TRENDYOL_SUPPLIER_ID, TRENDYOL_API_KEY, TRENDYOL_API_SECRET
  // Or stored in Firestore settings/trendyol: { supplierId, apiKey, apiSecret }

  async function getTrendyolCreds(): Promise<{ supplierId: string; apiKey: string; apiSecret: string } | null> {
    if (process.env.TRENDYOL_SUPPLIER_ID && process.env.TRENDYOL_API_KEY && process.env.TRENDYOL_API_SECRET) {
      return { supplierId: process.env.TRENDYOL_SUPPLIER_ID, apiKey: process.env.TRENDYOL_API_KEY, apiSecret: process.env.TRENDYOL_API_SECRET };
    }
    if (!adminDb) return null;
    try {
      const snap = await adminDb.collection('settings').doc('trendyol').get();
      if (!snap.exists) return null;
      const d = snap.data() as Record<string, unknown>;
      const supplierId = d.supplierId as string | undefined;
      const apiKey     = d.apiKey     as string | undefined;
      const apiSecret  = d.apiSecret  as string | undefined;
      if (!supplierId || !apiKey || !apiSecret) return null;
      return { supplierId, apiKey, apiSecret };
    } catch { return null; }
  }

  /** GET /api/trendyol/status */
  app.get('/api/trendyol/status', async (_req: Request, res: Response) => {
    const creds = await getTrendyolCreds();
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
  app.post('/api/trendyol/sync', async (req: Request, res: Response) => {
    const creds = await getTrendyolCreds();
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
      if (adminDb) {
        for (const o of orders) {
          const tyOrderNo = String(o.orderNumber ?? o.id ?? '');
          if (!tyOrderNo) continue;
          const existing = await adminDb.collection('orders').where('trendyolOrderNo', '==', tyOrderNo).limit(1).get();
          const payload = {
            trendyolOrderNo: tyOrderNo,
            customerName:    (o.shipmentAddress as Record<string, unknown>)?.fullName as string ?? 'Trendyol',
            totalPrice:      Number(o.totalPrice ?? 0),
            status:          'Pending' as const,
            customerType:    'Retail' as const,
            source:          'Trendyol',
            rawData:         o,
            updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
          };
          if (existing.empty) {
            await adminDb.collection('orders').add({ ...payload, createdAt: admin.firestore.FieldValue.serverTimestamp() });
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

  // ── Hepsiburada Merchant API ────────────────────────────────────────────────
  // Credentials: HEPSIBURADA_MERCHANT_ID, HEPSIBURADA_USERNAME, HEPSIBURADA_PASSWORD

  async function getHepsiburadaCreds(): Promise<{ merchantId: string; username: string; password: string } | null> {
    if (process.env.HEPSIBURADA_MERCHANT_ID && process.env.HEPSIBURADA_USERNAME && process.env.HEPSIBURADA_PASSWORD) {
      return { merchantId: process.env.HEPSIBURADA_MERCHANT_ID, username: process.env.HEPSIBURADA_USERNAME, password: process.env.HEPSIBURADA_PASSWORD };
    }
    if (!adminDb) return null;
    try {
      const snap = await adminDb.collection('settings').doc('hepsiburada').get();
      if (!snap.exists) return null;
      const d = snap.data() as Record<string, unknown>;
      const merchantId = d.merchantId as string | undefined;
      const username   = d.username   as string | undefined;
      const password   = d.password   as string | undefined;
      if (!merchantId || !username || !password) return null;
      return { merchantId, username, password };
    } catch { return null; }
  }

  /** GET /api/hepsiburada/status */
  app.get('/api/hepsiburada/status', async (_req: Request, res: Response) => {
    const creds = await getHepsiburadaCreds();
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
  app.post('/api/hepsiburada/sync', async (req: Request, res: Response) => {
    const creds = await getHepsiburadaCreds();
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
      if (adminDb) {
        for (const o of orders) {
          const hbOrderId = String(o.id ?? o.orderNumber ?? '');
          if (!hbOrderId) continue;
          const existing = await adminDb.collection('orders').where('hepsiburadaOrderId', '==', hbOrderId).limit(1).get();
          const payload = {
            hepsiburadaOrderId: hbOrderId,
            customerName:       String(o.customerFirstName ?? '') + ' ' + String(o.customerLastName ?? ''),
            totalPrice:         Number(o.totalPrice ?? o.orderAmount ?? 0),
            status:             'Pending' as const,
            customerType:       'Retail' as const,
            source:             'Hepsiburada',
            rawData:            o,
            updatedAt:          admin.firestore.FieldValue.serverTimestamp(),
          };
          if (existing.empty) {
            await adminDb.collection('orders').add({ ...payload, createdAt: admin.firestore.FieldValue.serverTimestamp() });
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

  // ── WhatsApp Business API ───────────────────────────────────────────────────
  // Supports 360dialog (primary) and Twilio (fallback)
  // Credentials: WHATSAPP_API_KEY (360dialog) or TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWATSAPP_FROM

  /** POST /api/whatsapp/send — send a text or template message */
  app.post('/api/whatsapp/send', async (req: Request, res: Response) => {
    const { to, message, templateName, templateParams } = req.body as {
      to: string; message?: string; templateName?: string; templateParams?: string[];
    };
    if (!to) return res.status(400).json({ success: false, error: 'to phone number required' });

    // Normalise phone: ensure + prefix, digits only
    const phone = to.startsWith('+') ? to.replace(/[^+\d]/g, '') : `+${to.replace(/\D/g, '')}`;

    // --- 360dialog ---
    const dialogApiKey = process.env.WHATSAPP_360DIALOG_API_KEY;
    if (dialogApiKey) {
      try {
        const body: Record<string, unknown> = { messaging_product: 'whatsapp', to: phone };
        if (templateName) {
          body.type = 'template';
          body.template = {
            name: templateName, language: { code: 'tr' },
            components: templateParams ? [{ type: 'body', parameters: templateParams.map(p => ({ type: 'text', text: p })) }] : [],
          };
        } else {
          body.type = 'text';
          body.text = { body: message ?? '' };
        }
        const r = await fetch('https://waba.360dialog.io/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'D360-API-KEY': dialogApiKey },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ success: false, error: JSON.stringify(data).substring(0, 200) });
        // Log to Firebase
        if (adminDb) {
          await adminDb.collection('whatsappMessages').add({
            to: phone, message: message ?? templateName ?? '', status: 'sent',
            provider: '360dialog', messageId: (data as Record<string, unknown>).messages,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        return res.json({ success: true, provider: '360dialog', data });
      } catch (e) {
        return res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // --- Twilio WhatsApp fallback ---
    const twilioSid    = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken  = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom   = process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886';
    if (twilioSid && twilioToken) {
      try {
        const token = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
        const form  = new URLSearchParams({ From: twilioFrom, To: `whatsapp:${phone}`, Body: message ?? templateName ?? '' });
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
          method: 'POST', headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ success: false, error: (data as Record<string,unknown>).message });
        if (adminDb) {
          await adminDb.collection('whatsappMessages').add({
            to: phone, message: message ?? '', status: 'sent',
            provider: 'twilio', messageId: (data as Record<string, unknown>).sid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        return res.json({ success: true, provider: 'twilio', data });
      } catch (e) {
        return res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // No provider configured
    return res.status(503).json({ success: false, notConfigured: true,
      error: 'WhatsApp sağlayıcısı yapılandırılmamış. WHATSAPP_360DIALOG_API_KEY veya TWILIO_* env değişkenlerini ayarlayın.' });
  });

  // ── AR Aging API ─────────────────────────────────────────────────────────────
  // Pure Firebase aggregation — no Mikro needed

  /** GET /api/aging — AR aging buckets for all customers (or ?customerId=X for one) */
  app.get('/api/aging', async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin not initialised' });
    try {
      const customerId = req.query.customerId as string | undefined;
      let q = adminDb.collection('orders')
        .where('status', 'in', ['Pending', 'Processing', 'Shipped'])
        .orderBy('createdAt', 'desc');
      if (customerId) q = q.where('leadId', '==', customerId) as typeof q;
      const snap = await q.limit(500).get();
      const now = Date.now();
      const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
      const rows: Record<string, unknown>[] = [];
      for (const doc of snap.docs) {
        const o = doc.data() as Record<string, unknown>;
        const createdMs = (o.createdAt as admin.firestore.Timestamp)?.toMillis?.() ?? now;
        const ageD = Math.floor((now - createdMs) / 86400000);
        const amount = Number(o.totalPrice ?? o.totalAmount ?? 0);
        if (ageD <= 30)      buckets.current += amount;
        else if (ageD <= 60) buckets.d30     += amount;
        else if (ageD <= 90) buckets.d60     += amount;
        else if (ageD <= 120) buckets.d90    += amount;
        else                  buckets.over90 += amount;
        rows.push({ id: doc.id, customerName: o.customerName, amount, ageD, status: o.status, createdAt: (o.createdAt as admin.firestore.Timestamp)?.toDate?.()?.toISOString() });
      }
      res.json({ success: true, buckets, rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Email (Resend) ────────────────────────────────────────────────────────────
  // Credentials: RESEND_API_KEY env var or Firestore settings/email.resendApiKey
  // From address: RESEND_FROM env var or settings/email.fromAddress

  async function getResendKey(): Promise<{ apiKey: string; from: string } | null> {
    const apiKey = process.env.RESEND_API_KEY;
    const from   = process.env.RESEND_FROM || 'Cetpa <onboarding@resend.dev>';
    if (apiKey) return { apiKey, from };
    if (!adminDb) return null;
    const snap = await adminDb.collection('settings').doc('email').get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, string>;
    if (!d.resendApiKey) return null;
    return { apiKey: d.resendApiKey, from: d.fromAddress || from };
  }

  async function sendEmail(to: string, subject: string, html: string): Promise<{ id?: string; error?: string }> {
    const creds = await getResendKey();
    if (!creds) return { error: 'notConfigured' };
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: creds.from, to: [to], subject, html }),
      signal: AbortSignal.timeout(12000),
    });
    const d = await r.json() as { id?: string; name?: string; message?: string };
    if (!r.ok) return { error: d.message ?? d.name ?? `HTTP ${r.status}` };
    return { id: d.id };
  }

  // GET /api/email/status
  app.get('/api/email/status', async (_req: Request, res: Response) => {
    const creds = await getResendKey();
    res.json({ configured: !!creds });
  });

  // POST /api/email/send — generic send (used by UI)
  // Body: { to, subject, html }
  app.post('/api/email/send', async (req: Request, res: Response) => {
    const { to, subject, html } = req.body as { to: string; subject: string; html: string };
    if (!to || !subject || !html) return res.status(400).json({ success: false, error: 'to, subject, html gerekli.' });
    const result = await sendEmail(to, subject, html);
    if (result.error === 'notConfigured') return res.status(503).json({ success: false, notConfigured: true });
    if (result.error) return res.status(500).json({ success: false, error: result.error });
    res.json({ success: true, id: result.id });
  });

  // POST /api/email/order-notification
  // Body: { orderId, status, customerEmail } — sends branded status email
  app.post('/api/email/order-notification', async (req: Request, res: Response) => {
    const { orderId, status, customerEmail, customerName, orderNo, lang = 'tr' } =
      req.body as { orderId: string; status: string; customerEmail: string; customerName: string; orderNo?: string; lang?: string };
    if (!customerEmail) return res.status(400).json({ success: false, error: 'customerEmail gerekli.' });

    const trackUrl = `${req.protocol}://${req.get('host')}/?track=${orderId}`;
    const tr = lang === 'tr';

    const statusLabel: Record<string, { tr: string; en: string; color: string }> = {
      Pending:    { tr: 'Sipariş Alındı',   en: 'Order Received',  color: '#f59e0b' },
      Processing: { tr: 'Hazırlanıyor',     en: 'Processing',      color: '#8b5cf6' },
      Shipped:    { tr: 'Kargoya Verildi',  en: 'Shipped',         color: '#3b82f6' },
      Delivered:  { tr: 'Teslim Edildi',    en: 'Delivered',       color: '#10b981' },
      Cancelled:  { tr: 'İptal Edildi',     en: 'Cancelled',       color: '#ef4444' },
    };
    const lbl = statusLabel[status] ?? { tr: status, en: status, color: '#6b7280' };
    const subjectText = tr
      ? `Siparişiniz güncellendi: ${lbl.tr} — #${orderNo ?? orderId.slice(0, 8)}`
      : `Order update: ${lbl.en} — #${orderNo ?? orderId.slice(0, 8)}`;

    const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <!-- Header -->
  <div style="background:#1a3a5c;padding:24px 32px;">
    <p style="margin:0;color:#fff;font-size:22px;font-weight:800;">CETPA</p>
    <p style="margin:4px 0 0;color:rgba(255,255,255,.7);font-size:12px;">${tr ? 'Sipariş Bilgilendirme' : 'Order Notification'}</p>
  </div>
  <!-- Body -->
  <div style="padding:32px;">
    <p style="margin:0 0 8px;font-size:14px;color:#374151;">${tr ? `Sayın ${customerName},` : `Dear ${customerName},`}</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">${tr ? 'Siparişinizin durumu güncellendi.' : 'Your order status has been updated.'}</p>
    <!-- Status badge -->
    <div style="text-align:center;margin:0 0 24px;">
      <span style="display:inline-block;background:${lbl.color}1a;color:${lbl.color};font-size:15px;font-weight:700;padding:10px 28px;border-radius:999px;border:2px solid ${lbl.color}44;">
        ${tr ? lbl.tr : lbl.en}
      </span>
    </div>
    <!-- Order no -->
    <div style="background:#f9fafb;border-radius:12px;padding:16px;margin-bottom:24px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#9ca3af;font-weight:700;letter-spacing:.08em;">${tr ? 'SİPARİŞ NO' : 'ORDER NO'}</p>
      <p style="margin:4px 0 0;font-size:20px;font-weight:800;color:#1a3a5c;font-family:monospace;">#${orderNo ?? orderId.slice(0, 8).toUpperCase()}</p>
    </div>
    <!-- CTA -->
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${trackUrl}" style="display:inline-block;background:#1a3a5c;color:#fff;font-size:13px;font-weight:700;padding:12px 28px;border-radius:999px;text-decoration:none;">
        ${tr ? '📦 Siparişimi Takip Et' : '📦 Track My Order'}
      </a>
    </div>
    <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">${tr ? 'Sorularınız için bize ulaşabilirsiniz.' : 'Feel free to contact us with any questions.'}</p>
  </div>
  <div style="background:#f9fafb;padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#d1d5db;">© ${new Date().getFullYear()} Cetpa Yazılım A.Ş.</p>
  </div>
</div></body></html>`;

    const result = await sendEmail(customerEmail, subjectText, html);
    if (result.error === 'notConfigured') return res.status(503).json({ success: false, notConfigured: true });
    if (result.error) return res.status(500).json({ success: false, error: result.error });

    // Log to Firestore
    if (adminDb) {
      await adminDb.collection('emailLog').add({
        orderId, to: customerEmail, subject: subjectText, status, sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    res.json({ success: true, id: result.id });
  });

  // ── Public Order Tracking ──────────────────────────────────────────────────
  // GET /api/track/:orderId — no auth required
  // Returns sanitised order data safe to expose to customers

  app.get('/api/track/:orderId', async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin unavailable.' });
    const orderId = req.params['orderId'] as string;
    try {
      const snap = await adminDb.collection('orders').doc(orderId).get();
      if (!snap.exists) return res.status(404).json({ success: false, error: 'Sipariş bulunamadı.' });
      const o = snap.data() as Record<string, unknown>;
      // Return only safe fields — no email, payment info, or internal refs
      res.json({
        success: true,
        order: {
          id:                orderId,
          orderNo:           (o.shopifyOrderId as string | undefined) ?? orderId.slice(0, 8).toUpperCase(),
          customerName:      o.customerName,
          status:            o.status,
          trackingNumber:    o.trackingNumber ?? null,
          shippingAddress:   o.shippingAddress ?? null,
          estimatedDelivery: o.estimatedDelivery ?? null,
          lineItems:         (o.lineItems as unknown[] | undefined)?.map((l: unknown) => {
            const li = l as Record<string, unknown>;
            return { name: li.name ?? li.title ?? li.sku, quantity: li.quantity ?? 1, price: li.price ?? 0 };
          }) ?? [],
          updatedAt: (o.syncedAt as { toDate?: () => Date } | null)?.toDate?.()?.toISOString() ?? null,
          createdAt: (o.createdAt as { toDate?: () => Date } | null)?.toDate?.()?.toISOString() ?? null,
        },
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Luca Muhasebe API ────────────────────────────────────────────────────────
  // Credentials from env (LUCA_API_KEY, LUCA_COMPANY_ID, LUCA_BASE_URL)
  // or Firestore settings/luca.

  type LucaCreds = { apiKey: string; companyId: string; baseUrl: string };

  async function getLucaCreds(): Promise<LucaCreds | null> {
    const apiKey    = process.env.LUCA_API_KEY;
    const companyId = process.env.LUCA_COMPANY_ID;
    const baseUrl   = process.env.LUCA_BASE_URL || 'https://api.luca.com.tr';
    if (apiKey && companyId) return { apiKey, companyId, baseUrl };
    if (!adminDb) return null;
    const snap = await adminDb.collection('settings').doc('luca').get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, string>;
    if (!d.apiKey || !d.companyId) return null;
    return { apiKey: d.apiKey, companyId: d.companyId, baseUrl: d.baseUrl || 'https://api.luca.com.tr' };
  }

  function lucaHeaders(creds: LucaCreds): Record<string, string> {
    return {
      Authorization: `Bearer ${creds.apiKey}`,
      'X-Company-Id': creds.companyId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  // GET /api/luca/status — test connection
  app.get('/api/luca/status', async (_req: Request, res: Response) => {
    const creds = await getLucaCreds();
    if (!creds) return res.json({ configured: false, connected: false });
    try {
      const r = await fetch(`${creds.baseUrl}/v1/company`, {
        headers: lucaHeaders(creds),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const d = await r.json() as Record<string, unknown>;
        res.json({ configured: true, connected: true, companyName: d.name ?? d.companyName ?? d.unvan ?? 'OK' });
      } else {
        res.json({ configured: true, connected: false, error: `HTTP ${r.status}` });
      }
    } catch (e) {
      res.json({ configured: true, connected: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // POST /api/luca/sync/fatura
  // Body: { orderId } — reads order from Firestore, pushes to Luca as sales invoice
  app.post('/api/luca/sync/fatura', async (req: Request, res: Response) => {
    const creds = await getLucaCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin unavailable.' });

    const { orderId } = req.body as { orderId: string };
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId gerekli.' });

    const orderDoc = await adminDb.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) return res.status(404).json({ success: false, error: 'Sipariş bulunamadı.' });
    const order = orderDoc.data() as Record<string, unknown>;

    const lines = ((order.lineItems as Record<string, unknown>[] | undefined) ?? []).map((l, i) => ({
      siraNo:       i + 1,
      malHizmetAdi: l.title ?? l.name ?? l.sku ?? 'Ürün',
      miktar:       l.quantity ?? 1,
      birim:        'Adet',
      birimFiyat:   l.price ?? 0,
      kdvOrani:     order.kdvOran ?? 20,
    }));

    const payload = {
      faturaTipi:   order.faturaTipi ?? 'SATIS',
      seriNo:       order.shopifyOrderId ?? orderId.slice(0, 8),
      faturaTarihi: new Date().toISOString().split('T')[0],
      vadeGunu:     30,
      musteri: {
        ad:         order.customerName,
        vergiNo:    (order.taxId as string | undefined) ?? '11111111111',
        adres:      order.shippingAddress ?? '',
      },
      satirlar: lines,
      kdvDahil: true,
    };

    try {
      const t0 = Date.now();
      const r = await fetch(`${creds.baseUrl}/v1/faturalar`, {
        method: 'POST',
        headers: lucaHeaders(creds),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const data = await r.json() as Record<string, unknown>;
      const success = r.ok && data.success !== false;
      const lucaFaturaNo = (data.faturaNo ?? data.id ?? null) as string | null;
      const duration = Date.now() - t0;

      if (success) {
        await adminDb.collection('orders').doc(orderId).set({
          lucaFaturaNo,
          lucaSynced:   true,
          lucaSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
          hasInvoice:   true,
        }, { merge: true });
      }
      res.json({ success, lucaFaturaNo, data, duration });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // POST /api/luca/sync/stok — pull products from Luca → Firebase inventory (upsert)
  app.post('/api/luca/sync/stok', async (_req: Request, res: Response) => {
    const creds = await getLucaCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin unavailable.' });

    try {
      const t0 = Date.now();
      const r = await fetch(`${creds.baseUrl}/v1/stoklar?limit=500`, {
        headers: lucaHeaders(creds),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) return res.json({ success: false, error: `Luca HTTP ${r.status}` });

      const data = await r.json() as { items?: Record<string, unknown>[] };
      const items = data.items ?? (Array.isArray(data) ? data as Record<string, unknown>[] : []);

      let created = 0; let updated = 0;
      const batch = adminDb.batch();
      for (const item of items) {
        const sku  = (item.stokKodu ?? item.kod ?? item.code) as string | undefined;
        if (!sku) continue;
        const ref = adminDb.collection('inventory').doc(`luca-${sku}`);
        const snap = await ref.get();
        const data2 = {
          name:       item.stokAdi ?? item.ad ?? item.name ?? sku,
          sku,
          quantity:   Number(item.miktar ?? item.stock ?? 0),
          source:     'luca',
          lucaSynced: true,
          updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
        };
        if (snap.exists) { batch.update(ref, data2); updated++; }
        else             { batch.set(ref, { ...data2, createdAt: admin.firestore.FieldValue.serverTimestamp() }); created++; }
      }
      await batch.commit();
      res.json({ success: true, total: items.length, created, updated, duration: Date.now() - t0 });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── iyzico Payment Gateway ───────────────────────────────────────────────────
  // Reads credentials from env (IYZICO_API_KEY, IYZICO_SECRET_KEY, IYZICO_BASE_URL)
  // or Firestore settings/iyzico (apiKey, secretKey, baseUrl).

  type IyzicoCreds = { apiKey: string; secretKey: string; baseUrl: string };

  async function getIyzicoCreds(): Promise<IyzicoCreds | null> {
    const apiKey    = process.env.IYZICO_API_KEY;
    const secretKey = process.env.IYZICO_SECRET_KEY;
    const baseUrl   = process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com';
    if (apiKey && secretKey) return { apiKey, secretKey, baseUrl };
    if (!adminDb) return null;
    const snap = await adminDb.collection('settings').doc('iyzico').get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, string>;
    if (!d.apiKey || !d.secretKey) return null;
    return { apiKey: d.apiKey, secretKey: d.secretKey, baseUrl: d.baseUrl || 'https://sandbox-api.iyzipay.com' };
  }

  // HMAC-SHA256 Authorization header for iyzico v2
  function iyzicoAuth(creds: IyzicoCreds, randomStr: string, pkiStr: string): string {
    const msgToHash = creds.apiKey + randomStr + creds.secretKey + pkiStr;
    const hash = createHmac('sha256', creds.secretKey).update(msgToHash).digest('base64');
    return `IYZWS apiKey:${creds.apiKey}&hash:${hash}`;
  }

  // Serialize a JS object into iyzico's PKI string format
  function toPkiString(obj: Record<string, unknown>): string {
    return Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => {
        if (Array.isArray(v)) {
          const inner = v.map(item =>
            typeof item === 'object' && item !== null
              ? `[${toPkiString(item as Record<string, unknown>)}]`
              : String(item)
          ).join(',');
          return `${k}=[${inner}]`;
        }
        if (typeof v === 'object') return `${k}=[${toPkiString(v as Record<string, unknown>)}]`;
        return `${k}=${v}`;
      })
      .join(',');
  }

  function randStr(len = 12): string {
    return Math.random().toString(36).slice(2, 2 + len).padEnd(len, '0');
  }

  // GET /api/iyzico/status
  app.get('/api/iyzico/status', async (_req: Request, res: Response) => {
    const creds = await getIyzicoCreds();
    if (!creds) return res.json({ configured: false, connected: false });
    try {
      // Lightweight check: retrieve installment info for 1 TRY
      const body   = { locale: 'tr', conversationId: 'status-check', binNumber: '554960' };
      const rndStr = randStr();
      const auth   = iyzicoAuth(creds, rndStr, toPkiString(body));
      const r = await fetch(`${creds.baseUrl}/payment/iyzipos/installment/detail`, {
        method: 'POST',
        headers: { Authorization: auth, 'x-iyzi-rnd': rndStr, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const d = await r.json() as { status?: string };
      res.json({ configured: true, connected: d.status === 'success' || r.ok, sandbox: creds.baseUrl.includes('sandbox') });
    } catch (e) {
      res.json({ configured: true, connected: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // POST /api/iyzico/payment-link
  // Body: { orderId, amount, currency?, customerName, customerEmail, customerPhone?,
  //         shippingAddress?, taxId?, lineItems?, callbackUrl? }
  // On success: stores paymentPageUrl + iyzicoToken on orders/{orderId}
  app.post('/api/iyzico/payment-link', async (req: Request, res: Response) => {
    const creds = await getIyzicoCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });

    const {
      orderId, amount, currency = 'TRY',
      customerName, customerEmail, customerPhone = '+905000000000',
      shippingAddress = 'Türkiye', taxId = '11111111111',
      lineItems = [], callbackUrl = `${req.protocol}://${req.get('host')}/payment/result`,
    } = req.body as {
      orderId: string; amount: number; currency?: string;
      customerName: string; customerEmail: string; customerPhone?: string;
      shippingAddress?: string; taxId?: string;
      lineItems?: { name: string; price: number; qty?: number }[];
      callbackUrl?: string;
    };

    if (!orderId || !amount || !customerName || !customerEmail) {
      return res.status(400).json({ success: false, error: 'orderId, amount, customerName, customerEmail gerekli.' });
    }

    const amountStr = amount.toFixed(2);
    const nameParts = customerName.trim().split(' ');
    const firstName = nameParts[0];
    const lastName  = nameParts.slice(1).join(' ') || 'Müşteri';

    // Build basket items
    const basket = lineItems.length > 0
      ? lineItems.map((l, i) => ({
          id: `item-${i}`,
          name: l.name,
          category1: 'B2B',
          itemType: 'PHYSICAL',
          price: (l.price * (l.qty ?? 1)).toFixed(2),
        }))
      : [{ id: orderId, name: 'Sipariş', category1: 'B2B', itemType: 'PHYSICAL', price: amountStr }];

    const body = {
      locale: 'tr',
      conversationId: orderId,
      price: amountStr,
      paidPrice: amountStr,
      currency,
      basketId: orderId,
      paymentGroup: 'PRODUCT',
      callbackUrl,
      buyer: {
        id: orderId,
        name: firstName,
        surname: lastName,
        email: customerEmail,
        identityNumber: taxId,
        registrationAddress: shippingAddress,
        city: 'İstanbul',
        country: 'Turkey',
        ip: req.ip || '127.0.0.1',
        gsmNumber: customerPhone,
      },
      shippingAddress: {
        contactName: customerName,
        city: 'İstanbul',
        country: 'Turkey',
        address: shippingAddress,
        zipCode: '34000',
      },
      billingAddress: {
        contactName: customerName,
        city: 'İstanbul',
        country: 'Turkey',
        address: shippingAddress,
        zipCode: '34000',
      },
      basketItems: basket,
    };

    const rndStr = randStr();
    const pkiStr = toPkiString(body);
    const auth   = iyzicoAuth(creds, rndStr, pkiStr);

    try {
      const r = await fetch(`${creds.baseUrl}/payment/initialize/checkout`, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'x-iyzi-rnd': rndStr,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const d = await r.json() as { status?: string; paymentPageUrl?: string; token?: string; errorMessage?: string };

      const success = d.status === 'success' && !!d.paymentPageUrl;
      if (success && adminDb) {
        await adminDb.collection('orders').doc(orderId).set({
          iyzicoPaymentUrl:   d.paymentPageUrl,
          iyzicoToken:        d.token,
          iyzicoCreatedAt:    admin.firestore.FieldValue.serverTimestamp(),
          iyzicoSandbox:      creds.baseUrl.includes('sandbox'),
        }, { merge: true });
      }
      res.json({ success, paymentPageUrl: d.paymentPageUrl, token: d.token, error: d.errorMessage });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // ── WhatsApp Business Cloud API ─────────────────────────────────────────────
  // Reads credentials from env vars or Firestore settings/whatsapp:
  //   phoneNumberId  — from Meta Developer Console
  //   accessToken    — System User Permanent Token
  //   templateName   — pre-approved message template (default: "order_status_update")
  //   templateLang   — BCP-47 code (default: "tr")

  type WACreds = { phoneNumberId: string; accessToken: string; templateName: string; templateLang: string };

  async function getWACreds(): Promise<WACreds | null> {
    const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
    const accessToken   = process.env.WA_ACCESS_TOKEN;
    if (phoneNumberId && accessToken) {
      return {
        phoneNumberId,
        accessToken,
        templateName: process.env.WA_TEMPLATE_NAME || 'order_status_update',
        templateLang: process.env.WA_TEMPLATE_LANG || 'tr',
      };
    }
    if (!adminDb) return null;
    const snap = await adminDb.collection('settings').doc('whatsapp').get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, string>;
    if (!d.phoneNumberId || !d.accessToken) return null;
    return {
      phoneNumberId: d.phoneNumberId,
      accessToken:   d.accessToken,
      templateName:  d.templateName || 'order_status_update',
      templateLang:  d.templateLang || 'tr',
    };
  }

  // Send a WhatsApp template message
  async function sendWhatsApp(creds: WACreds, to: string, components: object[]): Promise<{ messageId?: string; error?: string }> {
    // Normalize phone: strip non-digits, ensure leading country code
    const phone = to.replace(/\D/g, '').replace(/^0/, '90');
    if (phone.length < 10) return { error: 'Geçersiz telefon numarası.' };

    const body = {
      messaging_product: 'whatsapp',
      to:                phone,
      type:              'template',
      template: {
        name:     creds.templateName,
        language: { code: creds.templateLang },
        components,
      },
    };

    const r = await fetch(`https://graph.facebook.com/v19.0/${creds.phoneNumberId}/messages`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${creds.accessToken}`,
        'Content-Type':  'application/json',
      },
      body:   JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json() as Record<string, unknown>;
    if (!r.ok) return { error: JSON.stringify(data) };
    const msgs = data.messages as Array<{ id?: string }> | undefined;
    return { messageId: msgs?.[0]?.id };
  }

  // GET /api/whatsapp/status
  app.get('/api/whatsapp/status', async (_req: Request, res: Response) => {
    const creds = await getWACreds();
    if (!creds) return res.json({ configured: false });
    // Verify the token by hitting the phone number endpoint
    try {
      const r = await fetch(`https://graph.facebook.com/v19.0/${creds.phoneNumberId}`, {
        headers: { 'Authorization': `Bearer ${creds.accessToken}` },
        signal:  AbortSignal.timeout(6000),
      });
      const d = await r.json() as Record<string, unknown>;
      res.json({ configured: true, connected: r.ok, displayPhoneNumber: d.display_phone_number, error: r.ok ? undefined : d.error });
    } catch (e) {
      res.json({ configured: true, connected: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // POST /api/whatsapp/send
  // Body: { to, orderNo, status, customerName, lang? }
  app.post('/api/whatsapp/send', async (req: Request, res: Response) => {
    const creds = await getWACreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });

    const { to, orderNo, status, customerName, lang = 'tr' } = req.body as {
      to: string; orderNo: string; status: string; customerName?: string; lang?: string;
    };
    if (!to || !orderNo || !status) {
      return res.status(400).json({ success: false, error: 'to, orderNo ve status zorunludur.' });
    }

    // Status label in Turkish or English
    const statusLabels: Record<string, { tr: string; en: string }> = {
      Pending:    { tr: 'Sipariş Alındı',    en: 'Order Received'  },
      Processing: { tr: 'Hazırlanıyor',       en: 'Processing'      },
      Shipped:    { tr: 'Kargoya Verildi',    en: 'Shipped'         },
      Delivered:  { tr: 'Teslim Edildi',      en: 'Delivered'       },
      Cancelled:  { tr: 'İptal Edildi',       en: 'Cancelled'       },
    };
    const statusLabel = (statusLabels[status]?.[lang as 'tr' | 'en']) ?? status;

    // Template body components: {{1}} = orderNo, {{2}} = statusLabel, {{3}} = customerName
    const components = [{
      type:       'body',
      parameters: [
        { type: 'text', text: orderNo },
        { type: 'text', text: statusLabel },
        { type: 'text', text: customerName ?? '' },
      ],
    }];

    try {
      const result = await sendWhatsApp(creds, to, components);
      if (result.error) return res.json({ success: false, error: result.error });

      // Log to Firestore
      if (adminDb) {
        await adminDb.collection('waMessageLog').add({
          to, orderNo, status,
          messageId:  result.messageId ?? null,
          sentAt:     admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      res.json({ success: true, messageId: result.messageId });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // POST /api/whatsapp/order-notification
  // Body: { orderId, status, phone, customerName, orderNo, lang }
  // Fire-and-forget safe — always 200 even if WA not configured
  app.post('/api/whatsapp/order-notification', async (req: Request, res: Response) => {
    const creds = await getWACreds();
    if (!creds) return res.json({ success: false, notConfigured: true });

    const { orderId, status, phone, customerName, orderNo, lang = 'tr' } = req.body as {
      orderId?: string; status: string; phone: string; customerName?: string; orderNo?: string; lang?: string;
    };
    if (!phone || !status) return res.json({ success: false, error: 'phone ve status zorunludur.' });

    const statusLabels: Record<string, { tr: string; en: string }> = {
      Pending:    { tr: 'Sipariş Alındı',    en: 'Order Received'  },
      Processing: { tr: 'Hazırlanıyor',       en: 'Processing'      },
      Shipped:    { tr: 'Kargoya Verildi',    en: 'Shipped'         },
      Delivered:  { tr: 'Teslim Edildi',      en: 'Delivered'       },
      Cancelled:  { tr: 'İptal Edildi',       en: 'Cancelled'       },
    };
    const statusLabel = (statusLabels[status]?.[lang as 'tr' | 'en']) ?? status;
    const no = orderNo ?? orderId?.slice(0, 8).toUpperCase() ?? '—';

    const components = [{
      type:       'body',
      parameters: [
        { type: 'text', text: no },
        { type: 'text', text: statusLabel },
        { type: 'text', text: customerName ?? '' },
      ],
    }];

    try {
      const result = await sendWhatsApp(creds, phone, components);
      if (adminDb) {
        await adminDb.collection('waMessageLog').add({
          to: phone, orderId: orderId ?? null, orderNo: no, status,
          messageId:  result.messageId ?? null,
          error:      result.error ?? null,
          sentAt:     admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      res.json({ success: !result.error, messageId: result.messageId, error: result.error });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
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
