import express, { Request, Response } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cron from "node-cron";

dotenv.config();

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

  // Webhook Handler
  app.post("/api/shopify/webhook", (req: Request, res: Response) => {
    const topic = req.headers['x-shopify-topic'];
    console.log(`Received Shopify Webhook: ${topic}`);
    
    // Process webhook data (e.g., update Firestore)
    res.status(200).send("Webhook received");
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

    // If no credentials configured, return a mock result for UI testing
    if (!apiKey || apiKey.trim() === '') {
      console.warn('GİB API Key not configured, returning mock response.');
      return res.json({
        success: true,
        data: {
          vknTckn: vkt,
          unvan: 'ÖRNEK TİCARET LİMİTED ŞİRKETİ',
          vergiDairesi: 'Marmara Kurumlar',
          il: 'İstanbul',
          durum: 'Aktif'
        }
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

  // Luca Kontör Bakiyesi (Mock)
  app.get("/api/luca/kontor", async (req: Request, res: Response) => {
    setTimeout(() => {
      res.json({
        success: true,
        data: {
          limit: 10000,
          used: 4500,
          remaining: 5500,
          lastPurchase: "2024-01-15T10:00:00Z"
        }
      });
    }, 500);
  });

  // Luca e-Fatura Gönderimi (Mock)
  app.post("/api/luca/fatura-gonder", async (req: Request, res: Response) => {
    const { invoiceId, data } = req.body;
    console.log(`Sending invoice to Luca: ${invoiceId}`);
    setTimeout(() => {
      res.json({
        success: true,
        message: "Fatura başarıyla e-Fatura sistemine (Luca) iletildi.",
        ettn: `ETTN-${Math.random().toString(36).substring(2, 10).toUpperCase()}`
      });
    }, 1500);
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
    const { trackingNumber } = req.params;

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
