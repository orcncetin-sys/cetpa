import express, { Request, Response, NextFunction } from "express";
import compression from "compression";
// vite is imported dynamically below — only in development, never in production
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cron from "node-cron";
import admin from "firebase-admin";
import { createHmac, createHash } from "crypto";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import Stripe from "stripe";
import rateLimit from "express-rate-limit";

dotenv.config();

// ── Firebase Admin SDK ──────────────────────────────────────────────────────
let adminDb: admin.firestore.Firestore | null = null;
const FIRESTORE_DB_ID = "ai-studio-d243947a-133d-4934-af2e-eff3bb6aeea7";
const PROJECT_ID = "gen-lang-client-0628151245";

try {
  let credential: admin.credential.Credential | undefined;

  // Option 1: explicit env-var credentials (VDS / any server without ADC)
  const fbEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const fbKey   = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (fbEmail && fbKey) {
    credential = admin.credential.cert({ projectId: PROJECT_ID, clientEmail: fbEmail, privateKey: fbKey });
    console.log("Firebase Admin: using FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY ✓");
  }
  // Option 2: GOOGLE_APPLICATION_CREDENTIALS file (local dev / Cloud Run ADC)
  // Falls through to ADC automatically when credential is undefined

  const adminApp = credential
    ? admin.initializeApp({ credential, projectId: PROJECT_ID })
    : admin.initializeApp({ projectId: PROJECT_ID });

  adminDb = adminApp.firestore();
  adminDb.settings({ databaseId: FIRESTORE_DB_ID });
  console.log("Firebase Admin SDK initialised ✓");
} catch (e) {
  console.warn("Firebase Admin SDK not initialised:", (e as Error).message);
}

// ── Security: Firebase Auth middleware ──────────────────────────────────────
/**
 * Middleware that verifies a Firebase ID token in the Authorization header.
 * Usage: app.post('/api/secret', requireAuth, handler)
 */
async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.replace(/^Bearer\s+/, '');
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header.' });
    return;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    (req as Request & { uid: string; userEmail?: string }).uid = decoded.uid;
    (req as Request & { uid: string; userEmail?: string }).userEmail = decoded.email;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/** Actor info extracted from an authenticated request — for audit logging. */
function reqActor(req: Request): { uid: string; email: string } {
  const r = req as Request & { uid?: string; userEmail?: string };
  return { uid: r.uid || 'system', email: r.userEmail || '' };
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
/** If value is already a 32-char hex MD5, return as-is; otherwise hash it. */
function toMd5IfPlain(value: string): string {
  if (!value) return '';
  if (/^[0-9a-f]{32}$/i.test(value)) return value.toLowerCase();
  return createHash('md5').update(value).digest('hex');
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
      sifre:         (d.sifre as string) || '',
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
// Single-flight: Mikro IDM tek oturumludur — yeni token verilince eskisi sessizce
// geçersizleşir. Eşzamanlı istekler ayrı token çekerse birbirini devirir; bu yüzden
// aynı anda yalnızca BİR token isteği yapılır, diğerleri aynı promise'i bekler.
const mikroTokenInflight = new Map<string, Promise<string>>();

async function getMikroToken(creds: MikroCreds): Promise<string> {
  const cacheKey = `${creds.idmEmail}|${creds.alias}`;
  const now      = Date.now();
  const cached   = mikroTokenCacheMap.get(cacheKey);

  if (cached && now < cached.expiresAt - 5 * 60 * 1000) {
    return cached.access_token;
  }

  const inflight = mikroTokenInflight.get(cacheKey);
  if (inflight) return inflight;

  const fetchPromise = (async () => {
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
      expiresAt:    Date.now() + (data.expires_in || 21600) * 1000,
    });
    // Token acquired — do not log alias or token details in production
    return data.access_token;
  })();

  mikroTokenInflight.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    mikroTokenInflight.delete(cacheKey);
  }
}

/** Mikro Jump API requires a daily-rotating hash: MD5("YYYY-MM-DD " + plainPassword).
 *  Tarih TÜRKİYE saatine göre hesaplanır — UTC kullanılırsa her gece 00:00–03:00 TR
 *  arasında bir önceki günün hash'i üretilir ve tüm çağrılar reddedilir.
 */
function buildMikroDailySifre(plainPassword: string): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // "YYYY-MM-DD"
  return createHash('md5').update(`${today} ${plainPassword}`).digest('hex');
}

function buildMikroContext(creds: MikroCreds): Record<string, unknown> {
  return {
    Alias:         creds.alias,
    FirmaKodu:     creds.firmaKodu,
    CalismaYili:   creds.calismaYili,
    ApiKey:        creds.apiKey,
    KullaniciKodu: creds.kullaniciKodu,
    Sifre:         buildMikroDailySifre(creds.sifre),
    FirmaNo:       creds.firmaNo,
    SubeNo:        creds.subeNo,
  };
}

/** Extract the Data payload from a Mikro API response.
 *  Response shape: { result: [{ StatusCode, Data: {...}, IsError, ErrorMessage }] }
 */
function mikroData(raw: unknown): Record<string, unknown> {
  const r = ((raw as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
  return (r?.Data ?? r?.data ?? {}) as Record<string, unknown>;
}

/** Call a Mikro Jump API endpoint — resolves creds, injects token + context. */
async function mikroPost(
  endpoint: string,
  extraBody: Record<string, unknown>,
  inMikro = false // true → ekstra alanlar Mikro objesi İÇİNE konur (V17 evrak kalıbı)
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const creds = await getMikroCreds();
  if (!creds) throw new Error('Mikro kimlik bilgileri bulunamadı. Ayarlar > Mikro ERP bölümünden girin.');

  const url = `${MIKRO_API_BASE}/${endpoint}`;

  const doCall = async (): Promise<{ ok: boolean; status: number; data: unknown }> => {
    const token = await getMikroToken(creds);
    const body = inMikro
      ? { Mikro: { ...buildMikroContext(creds), ...extraBody } }
      : { Mikro: buildMikroContext(creds), ...extraBody };
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) {
      console.warn(`Mikro ${endpoint} HTTP ${res.status}:`, text.substring(0, 300));
    }
    return { ok: res.ok, status: res.status, data };
  };

  let result = await doCall();

  // Mikro IDM tek oturumlu: başka bir yerden token alınınca cache'lenmiş token
  // sessizce geçersizleşir ve API 'result' anahtarı olmayan stub döner
  // ({"Method": "..."}). Bu durumda cache'i boşalt, taze token ile bir kez dene.
  // ANCAK: taze token da stub alırsa sorun Mikro tarafındadır (kilit/bakım) —
  // 5 dk boyunca tekrar token üretme ki kendi kendimize kilidi uzatmayalım.
  const isStub = (d: unknown) =>
    !!d && typeof d === 'object' && !('result' in (d as Record<string, unknown>));
  if (result.ok && isStub(result.data)) {
    const cacheKey = `${creds.idmEmail}|${creds.alias}`;
    const lastRefresh = mikroStubRefreshAt.get(cacheKey) ?? 0;
    if (Date.now() - lastRefresh > 5 * 60 * 1000) {
      console.warn(`Mikro ${endpoint}: stub yanıt — token yenilenip tekrar deneniyor`);
      mikroStubRefreshAt.set(cacheKey, Date.now());
      mikroTokenCacheMap.delete(cacheKey);
      result = await doCall();
    } else {
      console.warn(`Mikro ${endpoint}: stub yanıt — backoff aktif (5 dk), token YENİLENMEDİ`);
    }
  }

  return result;
}
// Stub sonrası token tazeleme zaman damgası — refresh fırtınasını önler
const mikroStubRefreshAt = new Map<string, number>();

/** Write a sync event to the syncLog Firestore collection.
 *  When `actor` is provided, ALSO writes an auditLog entry so the operation
 *  shows up in the Admin > Denetim Kaydı screen (filtered by companyId).
 */
async function writeSyncLog(
  operation: string,
  entityType: string,
  entityId:   string,
  success:    boolean,
  mikroRef:   string | null,
  error:      string | null,
  duration:   number,
  actor?:     { uid: string; email: string }
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
      ...(actor ? { userId: actor.uid, userEmail: actor.email } : {}),
    });
  } catch (e) {
    console.warn('syncLog write failed:', e);
  }
  if (actor) {
    await writeAuditLog(actor, operation, success
      ? `${entityType}/${entityId}${mikroRef ? ` → ${mikroRef}` : ''} (${duration}ms)`
      : `HATA: ${error} — ${entityType}/${entityId}`);
  }
}

/** Write an entry to the auditLog collection — same schema the client's
 *  logAuditAction uses, so server-side operations appear in the audit screen.
 */
async function writeAuditLog(
  actor:   { uid: string; email: string },
  action:  string,
  details: string
): Promise<void> {
  if (!adminDb) return;
  try {
    await adminDb.collection('auditLog').add({
      action,
      details,
      userId:    actor.uid,
      companyId: actor.uid,
      userName:  actor.email || 'Sunucu',
      userEmail: actor.email,
      source:    'server',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('auditLog write failed:', e);
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
      const stoklar = (mikroData(stokRes.data).StokListesi ?? []) as Record<string, unknown>[];
      let stokUpdated = 0;
      for (const s of stoklar) {
        const sku = s.sto_kod as string;
        if (!sku) continue;
        const snap = await adminDb.collection('inventory').where('sku', '==', sku).limit(1).get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({
            stockLevel:    Number(s.sto_mevcut_mik ?? s.toplam_miktar ?? 0),
            mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          stokUpdated++;
        }
      }

      // Pull cari
      const cariRes = await mikroPost('CariListesiV2', {
        FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl',
        WhereStr: "cari_baglanti_tipi=0 and cari_lastup_date > '2020/01/01'",
        Sort: 'cari_kod', Size: '500', Index: 0,
      });
      const cariler = (mikroData(cariRes.data).CariListesi ?? []) as Record<string, unknown>[];
      let cariUpdated = 0;
      for (const c of cariler) {
        const cariKod = c.cari_kod as string;
        if (!cariKod) continue;
        const snap = await adminDb.collection('leads').where('mikroCariKod', '==', cariKod).limit(1).get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({
            email:         (c.cari_EMail  as string) || '',
            phone:         (c.cari_CepTel as string) || '',
            mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
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

// ── Weekly email report cron ────────────────────────────────────────────────
// Every Monday at 08:00 — send summary report to REPORT_RECIPIENT_EMAIL
if (process.env.WEEKLY_REPORT_ENABLED === 'true') {
  cron.schedule('0 8 * * 1', async () => {
    if (!adminDb) return;
    const recipient = process.env.REPORT_RECIPIENT_EMAIL;
    const resendKey = process.env.RESEND_API_KEY;
    if (!recipient || !resendKey) {
      console.warn('Weekly report: REPORT_RECIPIENT_EMAIL or RESEND_API_KEY not set, skipping.');
      return;
    }

    try {
      const now  = new Date();
      const d7   = new Date(now); d7.setDate(d7.getDate() - 7);
      const d14  = new Date(now); d14.setDate(d14.getDate() - 14);

      const [ordersSnap, leadsSnap, inventorySnap] = await Promise.all([
        adminDb.collection('orders').get(),
        adminDb.collection('leads').get(),
        adminDb.collection('inventory').get(),
      ]);

      const orders    = ordersSnap.docs.map(d => d.data() as Record<string, unknown>);
      const inventory = inventorySnap.docs.map(d => d.data() as Record<string, unknown>);
      const leads     = leadsSnap.docs.map(d => d.data() as Record<string, unknown>);

      function dateOf(o: Record<string, unknown>): Date {
        const raw = o.createdAt as { toDate?: () => Date } | string | null;
        if (!raw) return new Date(0);
        if (typeof raw === 'string') return new Date(raw);
        return raw.toDate?.() ?? new Date(0);
      }

      const thisWeek = orders.filter(o => dateOf(o) >= d7);
      const prevWeek = orders.filter(o => dateOf(o) >= d14 && dateOf(o) < d7);
      const thisRev  = thisWeek.reduce((s, o) => s + ((o.totalPrice as number) || 0), 0);
      const prevRev  = prevWeek.reduce((s, o) => s + ((o.totalPrice as number) || 0), 0);
      const lowStock = inventory.filter(i => ((i.stockLevel as number) || 0) <= ((i.lowStockThreshold as number) || 5));
      const newLeads = leads.filter(l => dateOf(l) >= d7).length;

      const deltaRev = thisRev - prevRev;
      const deltaPct = prevRev > 0 ? Math.round((deltaRev / prevRev) * 100) : 0;
      const arrow    = deltaRev >= 0 ? '▲' : '▼';
      const color    = deltaRev >= 0 ? '#10b981' : '#ef4444';

      const weekStr = `${d7.toLocaleDateString('tr-TR')} – ${now.toLocaleDateString('tr-TR')}`;

      const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#f5f5f7;margin:0;padding:24px;">
  <div style="max-width:520px;margin:auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
    <div style="background:#ff4000;padding:28px 32px;">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;letter-spacing:-.5px;">CETPA Haftalık Rapor</h1>
      <p style="color:rgba(255,255,255,.75);margin:4px 0 0;font-size:13px;">${weekStr}</p>
    </div>
    <div style="padding:28px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #f0f0f0;">
            <span style="font-size:12px;color:#86868b;text-transform:uppercase;letter-spacing:.5px;">Sipariş Sayısı</span><br>
            <span style="font-size:28px;font-weight:800;color:#1d1d1f;">${thisWeek.length}</span>
            <span style="color:#86868b;font-size:12px;margin-left:8px;">(geçen hafta: ${prevWeek.length})</span>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #f0f0f0;">
            <span style="font-size:12px;color:#86868b;text-transform:uppercase;letter-spacing:.5px;">Ciro</span><br>
            <span style="font-size:28px;font-weight:800;color:#1d1d1f;">₺${thisRev.toLocaleString('tr-TR')}</span>
            <span style="color:${color};font-size:12px;font-weight:700;margin-left:8px;">${arrow} %${Math.abs(deltaPct)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #f0f0f0;">
            <span style="font-size:12px;color:#86868b;text-transform:uppercase;letter-spacing:.5px;">Yeni Müşteri Adayı</span><br>
            <span style="font-size:28px;font-weight:800;color:#1d1d1f;">${newLeads}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 0;">
            <span style="font-size:12px;color:#86868b;text-transform:uppercase;letter-spacing:.5px;">Düşük Stok Uyarısı</span><br>
            <span style="font-size:28px;font-weight:800;color:${lowStock.length > 0 ? '#ef4444' : '#10b981'};">${lowStock.length} ürün</span>
            ${lowStock.length > 0 ? `<p style="font-size:11px;color:#86868b;margin:4px 0 0;">${lowStock.slice(0, 5).map(i => i.name as string).join(', ')}${lowStock.length > 5 ? ' …' : ''}</p>` : ''}
          </td>
        </tr>
      </table>
    </div>
    <div style="background:#f5f5f7;padding:16px 32px;text-align:center;">
      <p style="font-size:11px;color:#86868b;margin:0;">Bu rapor otomatik olarak gönderilmiştir. CETPA B2B SaaS</p>
    </div>
  </div>
</body></html>`;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from:    process.env.RESEND_FROM || 'rapor@cetpa.com.tr',
          to:      [recipient],
          subject: `CETPA Haftalık Rapor — ${weekStr}`,
          html,
        }),
      });
      console.log(`Weekly report sent to ${recipient}`);
    } catch (err) {
      console.error('Weekly report cron hatası:', err);
    }
  });
  console.log('Weekly email report cron aktif (Pazartesi 08:00) ✓');
}

// ── Startup env validation ───────────────────────────────────────────────────
// Warn once at boot for missing/placeholder values — never crash, just surface.
function validateEnv() {
  const PLACEHOLDERS = ['your_gemini_api_key_here', 'your_mikro_idm_password', 'your_md5_hash_here', 'TESTAPKEY'];
  const checks: Array<{ key: string; warn: string }> = [
    { key: 'GEMINI_API_KEY',       warn: 'AI features disabled (Vertex AI fallback active if service account present)' },
    { key: 'RESEND_API_KEY',       warn: 'E-posta bildirimleri devre dışı' },
    { key: 'SHOPIFY_ACCESS_TOKEN', warn: 'Shopify sync devre dışı' },
    { key: 'MIKRO_IDM_PASSWORD',   warn: 'Mikro JumpBulut auth devre dışı' },
    { key: 'MIKRO_SIFRE',          warn: 'Mikro eski API auth devre dışı' },
    { key: 'STRIPE_SECRET_KEY',    warn: 'Stripe ödemeleri devre dışı' },
    { key: 'IYZICO_API_KEY',       warn: 'İyzico ödemeleri devre dışı' },
  ];
  const missing: string[] = [];
  for (const { key, warn } of checks) {
    const val = process.env[key] ?? '';
    if (!val || PLACEHOLDERS.includes(val)) missing.push(`  ⚠️  ${key}: ${warn}`);
  }
  if (missing.length) {
    console.warn('\n╔══ ENV WARNINGS (eksik/placeholder değerler) ══╗');
    missing.forEach(m => console.warn(m));
    console.warn('╚═══════════════════════════════════════════════╝\n');
  }
}
validateEnv();

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '5173', 10);

  // Trust the first proxy (nginx/Cloudflare) so express-rate-limit reads real IP
  app.set('trust proxy', 1);

  // Gzip compression for all responses (API + static)
  app.use(compression());

  // ── Rate Limiters ────────────────────────────────────────────────────────────
  /** General API — 300 req / 15 min per IP */
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });

  /** Auth endpoints — stricter: 20 req / 15 min per IP */
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts, please try again later.' },
  });

  /** Stripe / payment — very strict: 10 req / 10 min per IP */
  const paymentLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many payment requests, please try again later.' },
  });

  // Apply general limiter to all /api/* routes
  app.use('/api', apiLimiter);

  // Capture raw body for Shopify webhook HMAC verification (must come before express.json)
  app.use(express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => {
      req.rawBody = buf;
    },
  }));

  // ... (keep existing routes)
  
  // Manual Sync Trigger
  app.post("/api/shopify/sync", requireAuth, async (req: Request, res: Response) => {
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

      await writeAuditLog(reqActor(req), 'Shopify Senkronizasyon',
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
  app.post('/api/shopify/draft-order', requireAuth, async (req: Request, res: Response) => {
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
      await writeAuditLog(reqActor(req), 'Shopify Taslak Sipariş',
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
    // ── HMAC Verification ────────────────────────────────────────────────
    const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    const shopifyHmac   = req.headers['x-shopify-hmac-sha256'] as string | undefined;
    if (webhookSecret && shopifyHmac && req.rawBody) {
      const computed = createHmac('sha256', webhookSecret)
        .update(req.rawBody)
        .digest('base64');
      if (computed !== shopifyHmac) {
        res.status(401).send('Invalid signature');
        return;
      }
    }

    const topic = req.headers['x-shopify-topic'] as string;
    const body  = req.body;

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
  app.get("/api/gib/vkn/:vkt", requireAuth, async (req: Request, res: Response) => {
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
  app.get("/api/luca/kontor", requireAuth, async (_req: Request, res: Response) => {
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
  app.post("/api/luca/fatura-gonder", requireAuth, async (req: Request, res: Response) => {
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
      await writeAuditLog(reqActor(req), 'Luca e-Fatura Gönderim', `ETTN: ${data.ettn || data.uuid || data.id}`);
      res.json({ success: true, message: 'Fatura Luca e-Fatura sistemine iletildi.', ettn: data.ettn || data.uuid || data.id });
    } catch (err) {
      console.error('Luca fatura-gonder error:', err);
      res.status(500).json({ success: false, error: 'Luca API bağlantı hatası' });
    }
  });

  // ── Cargo Tracking Proxy Routes ──────────────────────────────────────────

  // DHL Tracking — https://developer.dhl.com/api-reference/shipment-tracking
  app.get('/api/tracking/dhl/:trackingNumber', requireAuth, async (req: Request, res: Response) => {
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
  app.get('/api/tracking/ups/:trackingNumber', requireAuth, async (req: Request, res: Response) => {
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
  app.post('/api/tracking/fedex', requireAuth, async (req: Request, res: Response) => {
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

  // ── Turkish Cargo Carrier Tracking ──────────────────────────────────────────
  // Returns a normalised TrackingResult-compatible object.
  // Falls back to realistic mock data when credentials aren't configured.
  // Credentials (optional) stored in env vars or Firestore settings/cargoApiKeys.

  function trMockEvents(carrier: string, no: string, status: string) {
    const now = Date.now();
    return {
      mock: true, carrier, trackingNumber: no,
      statusCode: 'in_transit' as const, status,
      origin: 'İstanbul', destination: 'Ankara',
      estimatedDelivery: new Date(now + 86400000).toISOString(),
      isMock: true,
      events: [
        { timestamp: new Date(now - 1800000).toISOString(), location: 'Ankara Dağıtım Merkezi', status: 'Dağıtıma Çıktı', description: `${carrier}: Dağıtıma çıktı` },
        { timestamp: new Date(now - 7200000).toISOString(), location: 'Ankara Transfer Merkezi', status: 'Transfer Merkezi', description: `${carrier}: Transfer merkezine ulaştı` },
        { timestamp: new Date(now - 86400000).toISOString(), location: 'İstanbul Çıkış Deposu', description: `${carrier}: Kargo alındı`, status: 'Alındı' },
      ],
    };
  }

  // Yurtiçi Kargo
  app.get('/api/tracking/yurtici/:no', requireAuth, async (req: Request, res: Response) => {
    const no = req.params['no'] as string;
    const apiKey = process.env.YURTICI_API_KEY;
    if (!apiKey) return res.json(trMockEvents('Yurtiçi', no, 'Dağıtımda'));
    try {
      const r = await fetch('https://ws.yurticikargo.com/GetShipmentInfo/v1', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body:    JSON.stringify({ trackingNumbers: [no] }),
        signal:  AbortSignal.timeout(8000),
      });
      if (!r.ok) return res.json(trMockEvents('Yurtiçi', no, 'Bilinmiyor'));
      const data = await r.json() as Record<string, unknown>;
      res.json(data);
    } catch {
      res.json(trMockEvents('Yurtiçi', no, 'Bilgi Alınamadı'));
    }
  });

  // MNG Kargo
  app.get('/api/tracking/mng/:no', requireAuth, async (req: Request, res: Response) => {
    const no = req.params['no'] as string;
    const apiKey = process.env.MNG_API_KEY;
    if (!apiKey) return res.json(trMockEvents('MNG', no, 'Yolda'));
    try {
      const r = await fetch(`https://service.mngkargo.com.tr/mngWS.asmx/Sorgu?TakipNo=${encodeURIComponent(no)}`, {
        headers: { 'x-api-key': apiKey },
        signal:  AbortSignal.timeout(8000),
      });
      if (!r.ok) return res.json(trMockEvents('MNG', no, 'Bilinmiyor'));
      const data = await r.json() as Record<string, unknown>;
      res.json(data);
    } catch {
      res.json(trMockEvents('MNG', no, 'Bilgi Alınamadı'));
    }
  });

  // Aras Kargo
  app.get('/api/tracking/aras/:no', requireAuth, async (req: Request, res: Response) => {
    const no = req.params['no'] as string;
    const apiKey = process.env.ARAS_API_KEY;
    if (!apiKey) return res.json(trMockEvents('Aras', no, 'Transfer Merkezinde'));
    try {
      const r = await fetch(`https://kargo.aras.com.tr/api/v1/shipment/track/${encodeURIComponent(no)}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal:  AbortSignal.timeout(8000),
      });
      if (!r.ok) return res.json(trMockEvents('Aras', no, 'Bilinmiyor'));
      const data = await r.json() as Record<string, unknown>;
      res.json(data);
    } catch {
      res.json(trMockEvents('Aras', no, 'Bilgi Alınamadı'));
    }
  });

  // PTT Kargo
  app.get('/api/tracking/ptt/:no', requireAuth, async (req: Request, res: Response) => {
    const no = req.params['no'] as string;
    try {
      // PTT has a semi-public JSON endpoint
      const r = await fetch(`https://gonderitakip.ptt.gov.tr/Track/Verify?q=${encodeURIComponent(no)}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal:  AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data = await r.json() as Record<string, unknown>;
        return res.json({ ...trMockEvents('PTT', no, 'Yolda'), ...data, mock: false, isMock: false });
      }
      return res.json(trMockEvents('PTT', no, 'Teslimatta'));
    } catch {
      res.json(trMockEvents('PTT', no, 'Teslimatta'));
    }
  });

  // POST /api/inventory/auto-reorder — scan inventory, create draft POs for low-stock items
  app.post('/api/inventory/auto-reorder', requireAuth, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin unavailable.' });
    try {
      const snap = await adminDb.collection('inventory').get();
      const lowStock: { id: string; name: string; sku: string; stockLevel: number; lowStockThreshold: number; supplier?: string }[] = [];
      snap.forEach(d => {
        const item = d.data() as Record<string, unknown>;
        const stock = Number(item.stockLevel ?? item.quantity ?? 0);
        const threshold = Number(item.lowStockThreshold ?? item.minStock ?? 5);
        if (stock < threshold) {
          lowStock.push({
            id: d.id,
            name: String(item.name ?? ''),
            sku:  String(item.sku ?? ''),
            stockLevel: stock,
            lowStockThreshold: threshold,
            supplier: item.supplier as string | undefined,
          });
        }
      });

      if (lowStock.length === 0) {
        return res.json({ success: true, created: 0, message: 'Tüm ürünler stok limitinin üzerinde.' });
      }

      const batch = adminDb.batch();
      const poRef = adminDb.collection('purchaseOrders');
      const created: string[] = [];

      for (const item of lowStock) {
        const reorderQty = Math.max(item.lowStockThreshold * 3, 10);
        const newRef = poRef.doc();
        batch.set(newRef, {
          status:      'Taslak',
          source:      'auto-reorder',
          inventoryId: item.id,
          productName: item.name,
          sku:         item.sku,
          supplier:    item.supplier ?? '',
          quantity:    reorderQty,
          currentStock: item.stockLevel,
          threshold:   item.lowStockThreshold,
          createdAt:   admin.firestore.FieldValue.serverTimestamp(),
        });
        created.push(newRef.id);
      }
      await batch.commit();

      await writeAuditLog(reqActor(req), 'Otomatik Sipariş', `${created.length} taslak SAS oluşturuldu (${lowStock.length} kritik stok)`);
      res.json({ success: true, created: created.length, lowStockCount: lowStock.length, items: lowStock.map(i => i.name) });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Mikro Jump API Routes ────────────────────────────────────────────────────

  /** GET /api/mikro/status — is Mikro configured and the FULL API context working?
   *  Makes a real StokListesiV2 call (Size=1) so wrong KullaniciKodu/Sifre/Alias
   *  surface here instead of silently failing during imports.
   */
  app.get('/api/mikro/status', async (_req: Request, res: Response) => {
    const statusCreds = await getMikroCreds();
    if (!statusCreds) {
      return res.json({ configured: false, connected: false, message: 'Mikro kimlik bilgileri yapılandırılmamış. Ayarlar > Mikro ERP bölümünden girin.' });
    }
    try {
      // NOT: Size 5'in altında Mikro 'result' anahtarı olmayan bozuk yanıt dönüyor
      const { ok, data } = await mikroPost('StokListesiV2', {
        StokKod: '', TarihTipi: 2,
        IlkTarih: '2000-01-01', SonTarih: `${new Date().getFullYear() + 1}-12-31`,
        Sort: 'sto_kod', Size: '5', Index: 0,
      });
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (ok && r0 && !r0.IsError) {
        return res.json({ configured: true, connected: true });
      }
      console.warn('Mikro status probe failed:', JSON.stringify(data)?.slice(0, 300));
      res.json({
        configured: true, connected: false,
        error: (r0?.ErrorMessage as string) || `Mikro API bağlantı hatası (HTTP ${ok ? 200 : 'err'}: ${JSON.stringify(data)?.slice(0, 120)})`,
      });
    } catch (err) {
      res.json({ configured: true, connected: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /api/mikro/stok/kaydet — push inventory item → Mikro StokKaydetV2 */
  app.post('/api/mikro/stok/kaydet', requireAuth, async (req: Request, res: Response) => {
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
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0 = envelope?.[0] as Record<string, unknown> | undefined;
      const success = ok && !r0?.IsError;
      const mikroStoKod = stok.sto_kod;
      const errorMsg = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await writeSyncLog('StokKaydetV2', 'inventory', firebaseId, success, mikroStoKod, errorMsg, duration, reqActor(req));

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
      await writeSyncLog('StokKaydetV2', 'inventory', firebaseId || 'unknown', false, null, errorMsg, duration, reqActor(req));
      console.error('Mikro StokKaydetV2 hatası:', err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  /** POST /api/mikro/stok/listesi — pull Mikro StokListesiV2 → Firebase */
  app.post('/api/mikro/stok/listesi', requireAuth, async (req: Request, res: Response) => {
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

      const stoklar = (mikroData(data).StokListesi ?? []) as Record<string, unknown>[];

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
              stockLevel:    Number(s.sto_mevcut_mik ?? s.toplam_miktar ?? 0),
              mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        }
      }

      await writeAuditLog(reqActor(req), 'Mikro Stok Listesi Çekme', `${Array.isArray(stoklar) ? stoklar.length : 0} stok kaydı çekildi`);
      res.json({ success: true, count: Array.isArray(stoklar) ? stoklar.length : 0, data: stoklar, duration: Date.now() - t0 });
    } catch (err) {
      console.error('Mikro StokListesiV2 hatası:', err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /api/mikro/cari/kaydet — push lead/customer → Mikro CariKaydetV2 */
  app.post('/api/mikro/cari/kaydet', requireAuth, async (req: Request, res: Response) => {
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
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0 = envelope?.[0] as Record<string, unknown> | undefined;
      const success = ok && !r0?.IsError;
      const errorMsg = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await writeSyncLog('CariKaydetV2', 'lead', firebaseId, success, cariKod, errorMsg, duration, reqActor(req));

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
      await writeSyncLog('CariKaydetV2', 'lead', firebaseId || 'unknown', false, null, errorMsg, duration, reqActor(req));
      console.error('Mikro CariKaydetV2 hatası:', err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  /** POST /api/mikro/cari/listesi — pull Mikro CariListesiV2 → Firebase */
  app.post('/api/mikro/cari/listesi', requireAuth, async (req: Request, res: Response) => {
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

      const cariler = (mikroData(data).CariListesi ?? []) as Record<string, unknown>[];

      if (adminDb && Array.isArray(cariler)) {
        for (const c of cariler) {
          const cariKod = c.cari_kod as string;
          if (!cariKod) continue;
          const snap = await adminDb.collection('leads').where('mikroCariKod', '==', cariKod).limit(1).get();
          if (!snap.empty) {
            await snap.docs[0].ref.update({
              email:         (c.cari_EMail  as string) || '',
              phone:         (c.cari_CepTel as string) || '',
              mikroSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        }
      }

      await writeAuditLog(reqActor(req), 'Mikro Cari Listesi Çekme', `${Array.isArray(cariler) ? cariler.length : 0} cari kaydı çekildi`);
      res.json({ success: true, count: Array.isArray(cariler) ? cariler.length : 0, data: cariler, duration: Date.now() - t0 });
    } catch (err) {
      console.error('Mikro CariListesiV2 hatası:', err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /api/mikro/siparis/kaydet — push order → Mikro SiparisKaydetV2 */
  app.post('/api/mikro/siparis/kaydet', requireAuth, async (req: Request, res: Response) => {
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
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0 = envelope?.[0] as Record<string, unknown> | undefined;
      const success = ok && !r0?.IsError;
      const md = (r0?.Data ?? r0?.data ?? {}) as Record<string, unknown>;
      const mikroEvrakNo = (md?.evrakNo || md?.EvrakNo || md?.id || null) as string | null;
      const errorMsg = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await writeSyncLog('SiparisKaydetV2', 'order', firebaseId, success, mikroEvrakNo, errorMsg, duration, reqActor(req));

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
      await writeSyncLog('SiparisKaydetV2', 'order', firebaseId || 'unknown', false, null, errorMsg, duration, reqActor(req));
      console.error('Mikro SiparisKaydetV2 hatası:', err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // ── Mikro Full Import Routes ─────────────────────────────────────────────────
  // These UPSERT — create new Firebase docs for items that don't exist yet,
  // update existing ones. Paginates automatically until all records are fetched.

  /** POST /api/mikro/import/stok — import ALL Mikro stock → Firebase inventory */
  app.post('/api/mikro/import/stok', requireAuth, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });

    // Data is scoped by companyId (= uid of the account owner) — the app's
    // inventory listener filters on it, so imports MUST set it or items are invisible.
    const companyId = (req as Request & { uid: string }).uid;

    const t0 = Date.now();
    let created = 0, updated = 0, errors = 0;
    let skippedRecords = 0;

    try {
      // Prefetch ALL inventory docs → Map<sku, ref>. Deliberately NOT filtered
      // by companyId: legacy docs imported before companyId existed must match
      // by SKU and get healed (updated with companyId) instead of duplicated.
      const existingSnap = await adminDb.collection('inventory').get();
      const existingBySku = new Map<string, FirebaseFirestore.DocumentReference>();
      for (const docSnap of existingSnap.docs) {
        const sku = (docSnap.data().sku as string)?.trim();
        if (sku && !existingBySku.has(sku)) existingBySku.set(sku, docSnap.ref);
      }

      let batch = adminDb.batch();
      let batchOps = 0;
      const commitBatch = async () => {
        if (batchOps > 0) { await batch.commit(); batch = adminDb!.batch(); batchOps = 0; }
      };

      // Mikro depo kodları (sto_yer_kod) → warehouses + wmsLocations + warehouseItems
      const depotCodes = new Map<string, number>(); // kod → ürün sayısı
      // Mikro'dan gelen gerçek kategoriler — import sonunda dummy chip'leri değiştirir
      const categorySet = new Set<string>();

      // ── Adaptif sayfalama ───────────────────────────────────────────────────
      // Mikro bazı sayfa aralıklarında düz metin "Api Server Error" döner
      // (kayıt bazlı serileştirme hatası, sunucu tarafında). Bozuk aralık
      // 100 → 20 → 5 → 1 şeklinde daraltılır; yalnızca gerçekten bozuk tekil
      // kayıtlar atlanır. Index = offset / size (Mikro Index sayfa numarasıdır).
      const fetchRange = async (offset: number, size: number): Promise<Record<string, unknown>[] | null> => {
        const { ok, data } = await mikroPost('StokListesiV2', {
          StokKod: '', TarihTipi: 2,
          IlkTarih: '2000-01-01',
          SonTarih: `${new Date().getFullYear() + 1}-12-31`,
          Sort: 'sto_kod', Size: String(size), Index: offset / size,
        });
        if (!ok || typeof data === 'string') return null; // "Api Server Error" vb.
        const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
        if (!r0 || r0.IsError) return null;
        const rows = mikroData(data).StokListesi;
        return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null;
      };

      const SUB: Record<number, number> = { 100: 20, 20: 5, 5: 1 };
      const collectRange = async (offset: number, size: number): Promise<{ rows: Record<string, unknown>[]; end: boolean }> => {
        const direct = await fetchRange(offset, size);
        if (direct !== null) return { rows: direct, end: direct.length < size };
        if (size === 1) {
          skippedRecords++;
          console.warn(`Stok import: kayıt #${offset} atlandı (Mikro Api Server Error)`);
          return { rows: [], end: false };
        }
        const sub = SUB[size];
        const out: Record<string, unknown>[] = [];
        let end = false;
        for (let o = offset; o < offset + size; o += sub) {
          const r = await collectRange(o, sub);
          out.push(...r.rows);
          end = r.end; // son alt-aralığın end durumu belirleyicidir
        }
        return { rows: out, end };
      };

      const CHUNK = 100;
      let offset = 0;
      let reachedEnd = false;
      while (!reachedEnd && offset < 50000) {
        const { rows: stoklar, end } = await collectRange(offset, CHUNK);
        reachedEnd = end;
        offset += CHUNK;
        if (stoklar.length === 0) { if (end) break; else continue; }

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
              companyId,
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
              source:           'mikro_import',
              mikroSyncedAt:    admin.firestore.FieldValue.serverTimestamp(),
            };

            // Upsert via batch: update if exists, create if not
            const existingRef = existingBySku.get(sku);
            if (existingRef) {
              batch.update(existingRef, item);
              updated++;
            } else {
              const newRef = adminDb.collection('inventory').doc();
              batch.set(newRef, { ...item, createdAt: admin.firestore.FieldValue.serverTimestamp() });
              existingBySku.set(sku, newRef); // guard against duplicate SKUs across pages
              created++;
            }
            batchOps++;

            categorySet.add(item.category);

            // Depo kaydı: Depo sekmesi warehouseItems koleksiyonundan okur
            const yerKod = String(s.sto_yer_kod ?? '').trim() || '1';
            depotCodes.set(yerKod, (depotCodes.get(yerKod) ?? 0) + 1);
            const whItemRef = adminDb.collection('warehouseItems')
              .doc(`mikro-${sku.replace(/[/\\]/g, '_')}`);
            batch.set(whItemRef, {
              companyId,
              productName: item.name,
              sku,
              quantity:    item.stockLevel,
              warehouseId: `mikro-depo-${yerKod}`,
              location:    `Depo ${yerKod}`,
              category:    item.category,
              source:      'mikro_import',
              updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            batchOps++;

            if (batchOps >= 440) await commitBatch();
          } catch (itemErr) {
            console.warn(`Stok import hatası (${sku}):`, itemErr);
            errors++;
          }
        }

        console.log(`Stok import: offset ${offset} — toplam ${created + updated} işlendi${skippedRecords ? `, ${skippedRecords} bozuk kayıt atlandı` : ''}`);
      }

      await commitBatch();

      // Depoları yaz: Depo sekmesi (warehouses) + Mobil WMS (wmsLocations)
      for (const [kod, itemCount] of depotCodes) {
        await adminDb.collection('warehouses').doc(`mikro-depo-${kod}`).set({
          companyId,
          name:      `Depo ${kod}`,
          code:      kod,
          source:    'mikro_import',
          itemCount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await adminDb.collection('wmsLocations').doc(`mikro-depo-${kod}`).set({
          code:      `DEPO-${kod}`,
          aisle:     kod, rack: '00', level: '00',
          zone:      'storage',
          active:    true,
          source:    'mikro_import',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      // Kategorileri senkronize et: Mikro kategorilerini ekle, kullanılmayan
      // (dummy seed) kategorileri kaldır. Chip listesi categories koleksiyonu +
      // envanterdeki gerçek kategorilerden türediği için bu güvenlidir.
      if (categorySet.size > 0) {
        const catSnap = await adminDb.collection('categories').get();
        const catBatch = adminDb.batch();
        const seen = new Set<string>();
        for (const catDoc of catSnap.docs) {
          const name = (catDoc.data().name as string) || '';
          if (!categorySet.has(name)) catBatch.delete(catDoc.ref); // dummy/unused
          else seen.add(name);
        }
        for (const name of categorySet) {
          if (!seen.has(name)) {
            catBatch.set(adminDb.collection('categories').doc(), {
              name, source: 'mikro_import',
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        }
        await catBatch.commit();
      }

      const duration = Date.now() - t0;
      await writeSyncLog('ImportStok', 'inventory', `${created} yeni / ${updated} güncel${skippedRecords ? ` / ${skippedRecords} bozuk atlandı` : ''}`, true, null, null, duration, reqActor(req));
      console.log(`Stok import tamamlandı — oluşturuldu: ${created}, güncellendi: ${updated}, hata: ${errors}, bozuk atlanan: ${skippedRecords}, süre: ${duration}ms`);
      res.json({ success: true, created, updated, errors, skippedRecords, duration });

    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await writeSyncLog('ImportStok', 'inventory', 'bulk', false, null, errorMsg, duration, reqActor(req));
      console.error('Stok import genel hatası:', err);
      res.status(500).json({ success: false, error: errorMsg, created, updated, errors });
    }
  });

  /** POST /api/mikro/import/cari — import ALL Mikro cari → Firebase leads */
  app.post('/api/mikro/import/cari', requireAuth, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });

    // Data is scoped by companyId — the app's leads listener filters on it.
    const companyId = (req as Request & { uid: string }).uid;

    const t0 = Date.now();
    let created = 0, updated = 0, errors = 0;
    const PAGE_SIZE = 500;
    let index = 0;
    let hasMore = true;

    try {
      // Prefetch ALL leads → Map<mikroCariKod, ref> (companyId filtresiz:
      // eski kayıtlar cari koduyla eşleşip companyId ile iyileştirilir)
      const existingSnap = await adminDb.collection('leads').get();
      const existingByKod = new Map<string, FirebaseFirestore.DocumentReference>();
      for (const docSnap of existingSnap.docs) {
        const kod = (docSnap.data().mikroCariKod as string)?.trim();
        if (kod && !existingByKod.has(kod)) existingByKod.set(kod, docSnap.ref);
      }

      let batch = adminDb.batch();
      let batchOps = 0;
      const commitBatch = async () => {
        if (batchOps > 0) { await batch.commit(); batch = adminDb!.batch(); batchOps = 0; }
      };

      while (hasMore) {
        const { ok, data } = await mikroPost('CariListesiV2', {
          FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl,cari_hareket_tipi,cari_baglanti_tipi,cari_muh_kod',
          WhereStr: "cari_baglanti_tipi=0 and cari_lastup_date > '2000/01/01'",
          Sort: 'cari_kod', Size: String(PAGE_SIZE), Index: index,
        });

        if (!ok) break;

        const cariler = (mikroData(data).CariListesi ?? []) as Record<string, unknown>[];
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
              companyId,
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
              source:         'mikro_import',
              mikroSyncedAt:  admin.firestore.FieldValue.serverTimestamp(),
            };

            // Upsert by mikroCariKod via batch
            const existingRef = existingByKod.get(cariKod);
            if (existingRef) {
              batch.update(existingRef, lead);
              updated++;
            } else {
              const newRef = adminDb.collection('leads').doc();
              batch.set(newRef, { ...lead, createdAt: admin.firestore.FieldValue.serverTimestamp() });
              existingByKod.set(cariKod, newRef);
              created++;
            }
            batchOps++;
            if (batchOps >= 450) await commitBatch();
          } catch (itemErr) {
            console.warn(`Cari import hatası (${cariKod}):`, itemErr);
            errors++;
          }
        }

        hasMore = cariler.length === PAGE_SIZE;
        index += 1; // Mikro Index = sayfa numarası
        console.log(`Cari import: sayfa ${index} tamamlandı — toplam ${created + updated} işlendi`);
      }

      await commitBatch();

      const duration = Date.now() - t0;
      await writeSyncLog('ImportCari', 'lead', `${created} yeni / ${updated} güncel`, true, null, null, duration, reqActor(req));
      console.log(`Cari import tamamlandı — oluşturuldu: ${created}, güncellendi: ${updated}, hata: ${errors}, süre: ${duration}ms`);
      res.json({ success: true, created, updated, errors, duration });

    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await writeSyncLog('ImportCari', 'lead', 'bulk', false, null, errorMsg, duration, reqActor(req));
      console.error('Cari import genel hatası:', err);
      res.status(500).json({ success: false, error: errorMsg, created, updated, errors });
    }
  });

  // ── Mikro Genel Liste Import'ları ────────────────────────────────────────────
  // Mikro list methodlarının yanıt alan adları belgelenmemiş — Data içindeki ilk
  // diziyi alır, satırları ham haliyle hedef koleksiyona yazar. Doc id: _Guid ile
  // biten ilk alan, yoksa otomatik. UI panelleri ham alanları gösterebilir.

  /** Data objesi içindeki ilk diziyi döndür (anahtar adı ne olursa olsun) */
  function firstArrayIn(d: Record<string, unknown>): Record<string, unknown>[] {
    for (const v of Object.values(d)) if (Array.isArray(v)) return v as Record<string, unknown>[];
    return [];
  }

  /** Satırda regex ile alan anahtarı bul (örnek satırdan tespit) */
  function findKey(row: Record<string, unknown>, re: RegExp): string | null {
    for (const k of Object.keys(row)) if (re.test(k)) return k;
    return null;
  }

  function makeMikroListImport(opts: {
    route:       string;
    method:      string;                          // Mikro API method adı
    collection:  string;                          // hedef Firestore koleksiyonu
    label:       string;                          // audit log etiketi
    extraBody?:  Record<string, unknown>;         // method'a özel ek parametreler
    postProcess?: (rows: Record<string, unknown>[], companyId: string) => Promise<string | null>;
  }) {
    app.post(opts.route, requireAuth, async (req: Request, res: Response) => {
      if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
      if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
      const companyId = (req as Request & { uid: string }).uid;
      const t0 = Date.now();
      const PAGE_SIZE = 500;
      let index = 0, hasMore = true, total = 0;
      const allRows: Record<string, unknown>[] = [];

      try {
        while (hasMore) {
          const { ok, data } = await mikroPost(opts.method, {
            Size: String(PAGE_SIZE), Index: index, ...(opts.extraBody ?? {}),
          });
          if (!ok) break;
          const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
          if (r0?.IsError) {
            return res.status(502).json({ success: false, error: (r0.ErrorMessage as string) || `${opts.method} hatası` });
          }
          const rows = firstArrayIn(mikroData(data));
          if (rows.length === 0) break;

          let batch = adminDb.batch();
          let ops = 0;
          for (const row of rows) {
            const guidKey = findKey(row, /_Guid$/i);
            const docId = guidKey && row[guidKey]
              ? String(row[guidKey])
              : adminDb.collection(opts.collection).doc().id;
            batch.set(adminDb.collection(opts.collection).doc(docId), {
              ...row,
              companyId,
              source:    'mikro_import',
              syncedAt:  admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            if (++ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
          }
          if (ops > 0) await batch.commit();

          allRows.push(...rows);
          total += rows.length;
          hasMore = rows.length === PAGE_SIZE;
          index += 1; // Mikro Index = sayfa numarası
        }

        let postNote: string | null = null;
        if (opts.postProcess && allRows.length > 0) {
          postNote = await opts.postProcess(allRows, companyId);
        }

        const duration = Date.now() - t0;
        await writeAuditLog(reqActor(req), opts.label, `${total} kayıt çekildi${postNote ? ` — ${postNote}` : ''}`);
        res.json({ success: true, total, note: postNote, duration });
      } catch (err) {
        res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  // 1. Siparişler → mikroSiparisler
  makeMikroListImport({
    route: '/api/mikro/import/siparis', method: 'SiparisListesiV2',
    collection: 'mikroSiparisler', label: 'Mikro Sipariş Listesi',
    extraBody: { IlkTarih: '2020-01-01', SonTarih: `${new Date().getFullYear() + 1}-12-31` },
  });

  // 2. Faturalar → mikroFaturalar
  makeMikroListImport({
    route: '/api/mikro/import/fatura-listesi', method: 'FaturaListesiV2',
    collection: 'mikroFaturalar', label: 'Mikro Fatura Listesi',
    extraBody: { IlkTarih: '2020-01-01', SonTarih: `${new Date().getFullYear() + 1}-12-31` },
  });

  // 3. Stok hareketleri → inventoryMovements (ham + tespit edilen alanlar)
  makeMikroListImport({
    route: '/api/mikro/import/stok-hareket', method: 'StokHareketListesiV2',
    collection: 'inventoryMovements', label: 'Mikro Stok Hareketleri',
    extraBody: { IlkTarih: '2020-01-01', SonTarih: `${new Date().getFullYear() + 1}-12-31` },
    postProcess: async (rows) => {
      // inventoryMovements UI'ının beklediği alanları tespit edip ekle
      const sample = rows[0];
      const skuKey = findKey(sample, /st[ho]_?stok_?kod|sto_kod|stok_kod/i);
      const qtyKey = findKey(sample, /miktar/i);
      return `alanlar: sku=${skuKey ?? '?'}, miktar=${qtyKey ?? '?'}`;
    },
  });

  // 4. Bankalar → bankAccounts (mevcut UI koleksiyonu)
  makeMikroListImport({
    route: '/api/mikro/import/banka', method: 'BankaListesiV2',
    collection: 'bankAccounts', label: 'Mikro Banka Listesi',
  });

  // 5. Kasalar → kasalar
  makeMikroListImport({
    route: '/api/mikro/import/kasa', method: 'KasaListesiV2',
    collection: 'kasalar', label: 'Mikro Kasa Listesi',
  });

  // 6. Ödeme planları → odemePlanlari
  makeMikroListImport({
    route: '/api/mikro/import/odeme-plan', method: 'OdemePlanListesiV2',
    collection: 'odemePlanlari', label: 'Mikro Ödeme Planları',
  });

  // 7. Barkodlar → barkodlar + envanter ürünlerine barcode alanı yaz
  makeMikroListImport({
    route: '/api/mikro/import/barkod', method: 'BarkodListesiV2',
    collection: 'barkodlar', label: 'Mikro Barkod Listesi',
    postProcess: async (rows, _companyId) => {
      if (!adminDb) return null;
      const sample = rows[0];
      const skuKey = findKey(sample, /sto_?kod|stok_?kod/i);
      const barKey = findKey(sample, /bar_?kod(?!u_)|barkod/i);
      if (!skuKey || !barKey) return `eşleme alanları bulunamadı (sku=${skuKey}, barkod=${barKey})`;
      const invSnap = await adminDb.collection('inventory').get();
      const bySku = new Map<string, FirebaseFirestore.DocumentReference>();
      for (const d of invSnap.docs) {
        const sku = ((d.data().sku as string) || '').trim();
        if (sku) bySku.set(sku, d.ref);
      }
      let batch = adminDb.batch(); let ops = 0; let matched = 0;
      for (const row of rows) {
        const ref = bySku.get(String(row[skuKey] ?? '').trim());
        const barcode = String(row[barKey] ?? '').trim();
        if (!ref || !barcode) continue;
        batch.update(ref, { barcode });
        matched++;
        if (++ops >= 450) { await batch.commit(); batch = adminDb!.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      return `${matched} ürüne barkod yazıldı`;
    },
  });

  // 8. Stok miktarları (depo bazlı) → stokMiktarlari + warehouseItems/inventory güncelle
  makeMikroListImport({
    route: '/api/mikro/import/stok-miktar', method: 'StokMiktarListesiV2',
    collection: 'stokMiktarlari', label: 'Mikro Stok Miktarları',
    postProcess: async (rows, _companyId) => {
      if (!adminDb) return null;
      const sample = rows[0];
      const skuKey  = findKey(sample, /sto_?kod|stok_?kod/i);
      const qtyKey  = findKey(sample, /miktar/i);
      const depoKey = findKey(sample, /depo/i);
      if (!skuKey || !qtyKey) return `eşleme alanları bulunamadı (sku=${skuKey}, miktar=${qtyKey})`;
      const invSnap = await adminDb.collection('inventory').get();
      const bySku = new Map<string, FirebaseFirestore.DocumentReference>();
      for (const d of invSnap.docs) {
        const sku = ((d.data().sku as string) || '').trim();
        if (sku) bySku.set(sku, d.ref);
      }
      // SKU başına toplam + depo bazlı miktar topla
      const totals = new Map<string, number>();
      const byDepot = new Map<string, { sku: string; depo: string; qty: number; name?: string }>();
      for (const row of rows) {
        const sku = String(row[skuKey] ?? '').trim();
        if (!sku) continue;
        const qty = Number(row[qtyKey] ?? 0) || 0;
        totals.set(sku, (totals.get(sku) ?? 0) + qty);
        const depo = depoKey ? String(row[depoKey] ?? '1') : '1';
        byDepot.set(`${sku}|${depo}`, { sku, depo, qty: (byDepot.get(`${sku}|${depo}`)?.qty ?? 0) + qty });
      }
      let batch = adminDb.batch(); let ops = 0; let updated = 0;
      for (const [sku, total] of totals) {
        const ref = bySku.get(sku);
        if (!ref) continue;
        batch.update(ref, { stockLevel: total });
        updated++;
        if (++ops >= 400) { await batch.commit(); batch = adminDb!.batch(); ops = 0; }
      }
      for (const { sku, depo, qty } of byDepot.values()) {
        batch.set(adminDb.collection('warehouseItems').doc(`mikro-${sku.replace(/[/\\]/g, '_')}-d${depo}`), {
          sku, quantity: qty,
          warehouseId: `mikro-depo-${depo}`,
          location: `Depo ${depo}`,
          source: 'mikro_import',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        if (++ops >= 400) { await batch.commit(); batch = adminDb!.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      return `${updated} ürünün stok seviyesi güncellendi, ${byDepot.size} depo kaydı`;
    },
  });

  /** POST /api/mikro/cari-hareket/kaydet — tahsilat/ödeme → Mikro (deneysel)
   *  Body: { hareket: Record<string, unknown>, firebaseId?: string }
   *  Alan adları Mikro dökümantasyonuna göre çağıran tarafça verilir.
   */
  app.post('/api/mikro/cari-hareket/kaydet', requireAuth, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { hareket } = req.body as { hareket: Record<string, unknown> };
    if (!hareket) return res.status(400).json({ success: false, error: 'hareket alanı zorunlu.' });
    const t0 = Date.now();
    try {
      const { ok, data, status } = await mikroPost('CariHareketKaydetV2', { cariHareketler: [hareket] });
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      const success = ok && !r0?.IsError;
      const errorMsg = success ? null : ((r0?.ErrorMessage as string) || `HTTP ${status}`);
      await writeSyncLog('CariHareketKaydetV2', 'payment', String(hareket.cha_kod ?? 'unknown'), success, null, errorMsg, Date.now() - t0, reqActor(req));
      res.json({ success, error: errorMsg, data });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Genel Mikro Evrak Push ────────────────────────────────────────────────
  // V17 Kaydet endpoint'leri için tek kapı. Alan eşlemesi client'taki
  // mikroEvrak.ts eşleyicilerinde yapılır; server yalnızca whitelist'i
  // doğrular, Mikro'ya iletir (payload Mikro objesi İÇİNDE) ve loglar.
  const MIKRO_PUSH_WHITELIST = new Set([
    'VerilenTeklifKaydetV2', 'AlinanTeklifKaydetV2',
    'SayimSonuclariKaydetV2', 'SayimKesinlestirmeV2',
    'DahiliStokHareketKaydetV2',
    'PersonelIzinTalepKaydetV2', 'PersonelizinKaydetV2', 'PersonelKaydetV2',
    'SatinAlmaTalepKaydetV2',
    'DepolarArasiSiparisKaydetV2',
    'BakimTalepKaydetV2', 'BakimHareketleriKaydetV2', 'BakimSarfiyatlariKaydetV2', 'BakimSozlesmeKaydetV2',
    'ServisIsEmriKaydetV2', 'ServisFormuKaydetV2', 'ServisMalzemePlanKaydetV2', 'ServisRotaPlanKaydetV2',
    'UretimTalepKaydetV2', 'UrunReceteKaydetV2', 'UrunRotaKaydetV2', 'UretimIsEmriOlusturV2', 'UretimRotaPlanKaydetV2',
    'EtiketBasimKaydetV2',
    'ZiyaretKaydetV2',
    'DekontKaydetV2',
  ]);

  app.post('/api/mikro/evrak/kaydet', requireAuth, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { method, payload, entityType, entityId } = req.body as {
      method: string; payload: Record<string, unknown>; entityType?: string; entityId?: string;
    };
    if (!method || !MIKRO_PUSH_WHITELIST.has(method)) {
      return res.status(400).json({ success: false, error: `Geçersiz veya izinsiz method: ${method}` });
    }
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ success: false, error: 'payload zorunlu.' });
    }
    const t0 = Date.now();
    try {
      const { ok, data, status } = await mikroPost(method, payload, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      const success = ok && !!r0 && !r0.IsError;
      const errorMsg = success ? null : ((r0?.ErrorMessage as string) || `HTTP ${status}`);
      await writeSyncLog(method, entityType || 'evrak', entityId || 'unknown', success, null, errorMsg, Date.now() - t0, reqActor(req));
      res.json({ success, error: errorMsg, data: r0?.Data ?? null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await writeSyncLog(method, entityType || 'evrak', entityId || 'unknown', false, null, msg, Date.now() - t0, reqActor(req));
      res.status(500).json({ success: false, error: msg });
    }
  });

  /** POST /api/mikro/yevmiye/kaydet — yevmiye fişlerini Mikro'ya aktar (MuhasebeFisKaydetV2).
   *  Body: { entries: [{id, date(YYYY-MM-DD), aciklama, debitHesap, alacakHesap, borc, alacak}] }
   *  Her kayıt çift taraflı 2 satır olur: borç satırı (+meblag) ve alacak satırı (-meblag).
   *  Yalnızca Mikro'nun kabul ettiği fişlerin id'leri syncedIds olarak döner.
   */
  app.post('/api/mikro/yevmiye/kaydet', requireAuth, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { entries } = req.body as { entries: Record<string, unknown>[] };
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, error: 'entries dizisi zorunlu.' });
    }
    const t0 = Date.now();
    const toTrDate = (iso: string) => { const [y, m, d] = String(iso).split('-'); return `${d}.${m}.${y}`; };
    const hesapKodu = (s: unknown) => String(s ?? '').trim().split(/\s|-/)[0] || '100';
    const syncedIds: string[] = [];
    const errors: { id: string; error: string }[] = [];
    try {
      for (const e of entries) {
        const meblag = Number(e.borc ?? e.alacak ?? 0) || 0;
        const satirBase = {
          fis_firmano: 0, fis_subeno: 0,
          fis_tarih: toTrDate(String(e.date ?? '')),
          fis_tur: 0,
          fis_sorumluluk_kodu: '', fis_ticari_tip: 0, fis_kurfarkifl: 0,
          fis_ticari_evraktip: 0, fis_tic_belgeno: String(e.fiş ?? e.fisNo ?? ''),
          fis_tic_belgetarihi: toTrDate(String(e.date ?? '')),
          fis_katagori: 0, fis_fmahsup_tipi: 0, user_tablo: [],
        };
        const { ok, data, status } = await mikroPost('MuhasebeFisKaydetV2', {
          evraklar: [{
            evrak_aciklamalari: [{ aciklama: String(e.aciklama ?? '') }],
            satirlar: [
              { ...satirBase, fis_hesap_kod: hesapKodu(e.debitHesap),  fis_aciklama1: String(e.aciklama ?? ''), fis_meblag0:  meblag },
              { ...satirBase, fis_hesap_kod: hesapKodu(e.alacakHesap), fis_aciklama1: String(e.aciklama ?? ''), fis_meblag0: -meblag },
            ],
          }],
        }, true);
        const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
        if (ok && r0 && !r0.IsError) syncedIds.push(String(e.id));
        else errors.push({ id: String(e.id), error: (r0?.ErrorMessage as string) || `HTTP ${status}` });
      }
      await writeAuditLog(reqActor(req), 'Mikro Yevmiye Aktarımı',
        `${syncedIds.length}/${entries.length} fiş aktarıldı${errors.length ? `, ${errors.length} hata: ${errors[0].error.slice(0, 80)}` : ''}`);
      res.json({ success: errors.length === 0, syncedIds, errors, duration: Date.now() - t0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err), syncedIds, errors });
    }
  });

  /** POST /api/mikro/tahsilat/kaydet — kasa tahsilat/tediye → Mikro (TahsilatTediyeKaydetV2).
   *  Body: { tahsilat: { cariKod, tutar, tarih(YYYY-MM-DD), aciklama?, tip: 'tahsilat'|'tediye' } }
   *  Alan eşlemesi V17 örneğinden — DENEYSEL: ilk gerçek kayıtla doğrulanmalı.
   */
  app.post('/api/mikro/tahsilat/kaydet', requireAuth, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { tahsilat } = req.body as { tahsilat: Record<string, unknown> };
    if (!tahsilat?.cariKod || !tahsilat?.tutar) {
      return res.status(400).json({ success: false, error: 'cariKod ve tutar zorunlu.' });
    }
    const t0 = Date.now();
    const toTrDate = (iso: string) => { const [y, m, d] = String(iso).split('-'); return `${d}.${m}.${y}`; };
    const tip = tahsilat.tip === 'tediye' ? 'tediye' : 'tahsilat';
    try {
      const { ok, data, status } = await mikroPost('TahsilatTediyeKaydetV2', {
        evraklar: [{
          evrak_aciklamalari: [{ aciklama: String(tahsilat.aciklama ?? '') }],
          satirlar: [{
            cha_tarihi: toTrDate(String(tahsilat.tarih ?? new Date().toISOString().slice(0, 10))),
            cha_tip: tip === 'tahsilat' ? 1 : 0,
            cha_cinsi: 19,
            cha_normal_Iade: 0,
            cha_evrak_tip: 34,
            cha_evrakno_seri: tip === 'tahsilat' ? 'KSTAH' : 'KSTED',
            cha_cari_cins: 0,
            cha_kod: String(tahsilat.cariKod),
            cha_d_cins: 0, cha_d_kur: 1, cha_d_kurtar: null,
            cha_srmrkkodu: '', cha_projekodu: '',
            cha_kasa_hizmet: 4,
            cha_meblag: Number(tahsilat.tutar),
            cha_aciklama: String(tahsilat.aciklama ?? ''),
          }],
        }],
      }, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      const success = ok && !!r0 && !r0.IsError;
      const errorMsg = success ? null : ((r0?.ErrorMessage as string) || `HTTP ${status}`);
      await writeSyncLog('TahsilatTediyeKaydetV2', 'payment', String(tahsilat.cariKod), success, null, errorMsg, Date.now() - t0, reqActor(req));
      res.json({ success, error: errorMsg, data });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /api/mikro/import/faturalar — kesilen + gelen faturaları SqlVeriOkuV2 ile çek.
   *  Mikro şeması: CARI_HESAP_HAREKETLERI, cha_evrak_tip=63 (fatura).
   *  cha_tip: 0 = borç (satış/kestiğimiz), 1 = alacak (alış/gelen).
   *  NOT: Mikro test ortamında 'MikroApiLoginForSelect' SQL kullanıcısı eksikse
   *  401 döner — Mikro destek tenant DB'de tanımlayınca çalışır.
   */
  app.post('/api/mikro/import/faturalar', requireAuth, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const companyId = (req as Request & { uid: string }).uid;
    const t0 = Date.now();
    try {
      const sql =
        "SELECT TOP 2000 cha_Guid, cha_evrakno_seri, cha_evrakno_sira, cha_tarihi, cha_tip, cha_cinsi, " +
        "cha_kod, cha_aciklama, cha_meblag, cha_aratoplam, cha_vergi, cha_ebelge_turu, cha_belge_no " +
        "FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 63 AND cha_iptal = 0 ORDER BY cha_tarihi DESC";
      const { ok, data, status } = await mikroPost('SqlVeriOkuV2', { SQLSorgu: sql });
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) {
        return res.status(502).json({ success: false, error: (r0?.ErrorMessage as string) || `HTTP ${status}` });
      }
      const rows = firstArrayIn(mikroData(data));
      let satis = 0, alis = 0;
      let batch = adminDb.batch(); let ops = 0;
      for (const row of rows) {
        const guid = String(row.cha_Guid ?? '') || adminDb.collection('mikroFaturalar').doc().id;
        const yon = Number(row.cha_tip ?? 0) === 0 ? 'satis' : 'alis';
        yon === 'satis' ? satis++ : alis++;
        batch.set(adminDb.collection('mikroFaturalar').doc(guid), {
          ...row, yon, companyId,
          source: 'mikro_import',
          syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        if (++ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      await writeAuditLog(reqActor(req), 'Mikro Fatura Çekme', `${satis} satış + ${alis} alış faturası çekildi`);
      res.json({ success: true, total: rows.length, satis, alis, duration: Date.now() - t0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** GET /api/integrations/health — tüm entegrasyonların anahtar/yapılandırma durumu.
   *  Yalnızca boolean durum döner, anahtar değerleri asla dönmez.
   */
  app.get('/api/integrations/health', requireAuth, async (_req: Request, res: Response) => {
    const has = (...keys: string[]) => keys.every(k => !!process.env[k]);
    res.json({
      integrations: [
        { id: 'mikro',       name: 'Mikro ERP (JumpBulut)', configured: has('MIKRO_IDM_EMAIL', 'MIKRO_IDM_PASSWORD', 'MIKRO_API_KEY', 'MIKRO_ALIAS'), requiredKeys: ['MIKRO_IDM_EMAIL', 'MIKRO_IDM_PASSWORD', 'MIKRO_API_KEY', 'MIKRO_ALIAS'], affects: 'Stok/cari/sipariş senkronizasyonu' },
        { id: 'shopify',     name: 'Shopify',               configured: has('SHOPIFY_ACCESS_TOKEN'),                 requiredKeys: ['SHOPIFY_ACCESS_TOKEN'],                 affects: 'Ürün/sipariş sync + SKU otomatik eşleştirme' },
        { id: 'resend',      name: 'E-posta (Resend)',      configured: has('RESEND_API_KEY'),                       requiredKeys: ['RESEND_API_KEY'],                       affects: 'Sipariş onayı, davet ve bildirim e-postaları' },
        { id: 'stripe',      name: 'Stripe',                configured: has('STRIPE_SECRET_KEY'),                    requiredKeys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'], affects: 'Abonelik ve online ödeme' },
        { id: 'iyzico',      name: 'İyzico',                configured: has('IYZICO_API_KEY', 'IYZICO_SECRET_KEY'),  requiredKeys: ['IYZICO_API_KEY', 'IYZICO_SECRET_KEY'],  affects: 'Ödeme linki oluşturma' },
        { id: 'whatsapp',    name: 'WhatsApp',              configured: has('WHATSAPP_360DIALOG_API_KEY') || has('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'), requiredKeys: ['WHATSAPP_360DIALOG_API_KEY (veya Twilio çifti)'], affects: 'Müşteri mesajları ve sipariş bildirimleri' },
        { id: 'luca',        name: 'Luca Muhasebe',         configured: has('LUCA_API_KEY'),                         requiredKeys: ['LUCA_API_KEY', 'LUCA_COMPANY_ID'],      affects: 'e-Fatura gönderim, yevmiye/stok sync' },
        { id: 'trendyol',    name: 'Trendyol',              configured: has('TRENDYOL_SUPPLIER_ID', 'TRENDYOL_API_KEY', 'TRENDYOL_API_SECRET'), requiredKeys: ['TRENDYOL_SUPPLIER_ID', 'TRENDYOL_API_KEY', 'TRENDYOL_API_SECRET'], affects: 'Pazaryeri sipariş senkronizasyonu' },
        { id: 'hepsiburada', name: 'Hepsiburada',           configured: has('HEPSIBURADA_MERCHANT_ID', 'HEPSIBURADA_USERNAME', 'HEPSIBURADA_PASSWORD'), requiredKeys: ['HEPSIBURADA_MERCHANT_ID', 'HEPSIBURADA_USERNAME', 'HEPSIBURADA_PASSWORD'], affects: 'Pazaryeri sipariş senkronizasyonu' },
        { id: 'dhl',         name: 'DHL Takip',             configured: has('DHL_API_KEY'),                          requiredKeys: ['DHL_API_KEY'],                          affects: 'DHL kargo takibi' },
        { id: 'ups',         name: 'UPS Takip',             configured: has('UPS_CLIENT_ID', 'UPS_CLIENT_SECRET'),   requiredKeys: ['UPS_CLIENT_ID', 'UPS_CLIENT_SECRET'],   affects: 'UPS kargo takibi' },
        { id: 'fedex',       name: 'FedEx Takip',           configured: has('FEDEX_CLIENT_ID', 'FEDEX_CLIENT_SECRET'), requiredKeys: ['FEDEX_CLIENT_ID', 'FEDEX_CLIENT_SECRET'], affects: 'FedEx kargo takibi' },
        { id: 'gemini',      name: 'Gemini AI',             configured: has('GEMINI_API_KEY'),                       requiredKeys: ['GEMINI_API_KEY'],                       affects: 'AI sohbet, lead skorlama, talep tahmini' },
      ],
    });
  });

  /** POST /api/mikro/token — IDM token al/yenile (env veya Firestore creds ile).
   *  Token client'a DÖNDÜRÜLMEZ — yalnızca alınabildiği bilgisi + süre döner.
   */
  app.post('/api/mikro/token', requireAuth, async (req: Request, res: Response) => {
    const creds = await getMikroCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });
    try {
      // Cache'i atla — kullanıcı bilinçli yenileme istedi
      mikroTokenCacheMap.delete(`${creds.idmEmail}|${creds.alias}`);
      const token = await getMikroToken(creds);
      await writeAuditLog(reqActor(req), 'Mikro Token Yenileme', 'IDM access token yenilendi');
      res.json({ success: true, tokenPreview: `${token.slice(0, 10)}…`, expiresInHours: 6 });
    } catch (e) {
      res.json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/admin/cleanup-dummy-inventory — kaynaksız (dummy seed) ürünleri sil.
   *  source alanı OLAN her şey korunur: mikro_import, csv, manual, shopify vb.
   *  Body: { dryRun?: boolean } — dryRun=true yalnızca sayım döner, silmez.
   */
  app.post('/api/admin/cleanup-dummy-inventory', requireAuth, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const dryRun = !!(req.body as { dryRun?: boolean })?.dryRun;
    try {
      const snap = await adminDb.collection('inventory').get();
      const dummies: { ref: FirebaseFirestore.DocumentReference; name: string }[] = [];
      const keptBySource = new Map<string, number>();
      for (const d of snap.docs) {
        const source = (d.data().source as string) || '';
        if (!source) dummies.push({ ref: d.ref, name: (d.data().name as string) || d.id });
        else keptBySource.set(source, (keptBySource.get(source) ?? 0) + 1);
      }

      if (!dryRun && dummies.length > 0) {
        let batch = adminDb.batch(); let ops = 0;
        for (const { ref } of dummies) {
          batch.delete(ref);
          if (++ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
        }
        if (ops > 0) await batch.commit();
        await writeAuditLog(reqActor(req), 'Dummy Ürün Temizliği',
          `${dummies.length} kaynaksız ürün silindi (korunan: ${[...keptBySource].map(([s, n]) => `${s}:${n}`).join(', ') || 'yok'})`);
      }

      res.json({
        success: true,
        dryRun,
        dummyCount: dummies.length,
        deleted: dryRun ? 0 : dummies.length,
        kept: Object.fromEntries(keptBySource),
        sample: dummies.slice(0, 10).map(d => d.name),
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── SKU Eşleştirme: Mikro ↔ Shopify ↔ pazaryerleri ──────────────────────────
  /** POST /api/sku-mapping/auto-match — envanter SKU'larını Shopify ürünleriyle
   *  normalize ederek eşleştirir, skuMappings koleksiyonuna yazar.
   */
  app.post('/api/sku-mapping/auto-match', requireAuth, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

    try {
      // 1. Envanterdeki Mikro SKU'ları
      const invSnap = await adminDb.collection('inventory').get();
      const invItems: { sku: string; name: string }[] = [];
      for (const d of invSnap.docs) {
        const sku = ((d.data().sku as string) || '').trim();
        if (sku) invItems.push({ sku, name: (d.data().name as string) || sku });
      }

      // 2. Shopify ürün varyantları (varsa)
      const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
      const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN || 'cetpa.myshopify.com';
      const shopifyBySku = new Map<string, { sku: string; productId: number; variantId: number; title: string }>();
      if (shopifyToken) {
        let pageUrl: string | null = `https://${shopifyDomain}/admin/api/2024-01/products.json?limit=250&fields=id,title,variants`;
        let pages = 0;
        while (pageUrl && pages < 20) {
          const r: globalThis.Response = await fetch(pageUrl, { headers: { 'X-Shopify-Access-Token': shopifyToken } });
          if (!r.ok) break;
          const pd = await r.json() as { products?: { id: number; title: string; variants?: { id: number; sku?: string }[] }[] };
          for (const prod of pd.products ?? []) {
            for (const v of prod.variants ?? []) {
              const vsku = (v.sku || '').trim();
              if (vsku) shopifyBySku.set(norm(vsku), { sku: vsku, productId: prod.id, variantId: v.id, title: prod.title });
            }
          }
          const linkHeader = r.headers.get('link') || '';
          const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          pageUrl = nextMatch ? nextMatch[1] : null;
          pages++;
        }
      }

      // 3. Eşleştir + batched yaz
      let matched = 0, unmatched = 0;
      let batch = adminDb.batch();
      let ops = 0;
      for (const item of invItems) {
        const key = norm(item.sku);
        if (!key) continue;
        const hit = shopifyBySku.get(key);
        const ref = adminDb.collection('skuMappings').doc(key);
        batch.set(ref, {
          mikroSku:    item.sku,
          productName: item.name,
          ...(hit ? {
            shopifySku:       hit.sku,
            shopifyProductId: hit.productId,
            shopifyVariantId: hit.variantId,
            status:           'matched',
            matchType:        'auto',
          } : { status: 'unmatched' }),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        hit ? matched++ : unmatched++;
        if (++ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();

      await writeAuditLog(reqActor(req), 'SKU Otomatik Eşleştirme',
        `${matched} eşleşti, ${unmatched} eşleşmedi (Shopify: ${shopifyBySku.size} varyant)`);
      res.json({ success: true, matched, unmatched, shopifyVariants: shopifyBySku.size, duration: Date.now() - t0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Mikro e-Fatura / e-Arşiv ─────────────────────────────────────────────────
  // POST /api/mikro/fatura/kaydet  — push order/invoice to Mikro as e-Fatura or e-Arşiv
  // Body: { order: Record<string, unknown>, firebaseId: string }
  //   order must have: mikroCariKod, lineItems[], totalPrice, faturaTipi ('e-fatura'|'e-arsiv'|'ihracat')
  // On success writes back: mikroFaturaNo, ettn, mikroFaturaDate to orders/{firebaseId}
  app.post('/api/mikro/fatura/kaydet', requireAuth, async (req: Request, res: Response) => {
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
      const envelope   = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0         = envelope?.[0] as Record<string, unknown> | undefined;
      const success    = ok && !r0?.IsError;
      const md         = (r0?.Data ?? r0?.data ?? {}) as Record<string, unknown>;
      const mikroFaturaNo = (md?.faturaNo || md?.FaturaNo || md?.evrakNo || md?.EvrakNo || md?.id || null) as string | null;
      const ettn          = (md?.ettn || md?.Ettn || md?.uuid || null) as string | null;
      const errorMsg   = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await writeSyncLog('FaturaKaydetV2', 'order', firebaseId || 'unknown', success, mikroFaturaNo, errorMsg, duration, reqActor(req));
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
      await writeSyncLog('FaturaKaydetV2', 'order', firebaseId || 'unknown', false, null, errorMsg, duration, reqActor(req));
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // ── Mikro e-İrsaliye ─────────────────────────────────────────────────────────
  // POST /api/mikro/irsaliye/kaydet  — push shipment as e-İrsaliye to Mikro
  // Body: { shipment: Record<string, unknown>, firebaseId: string }
  //   shipment must have: mikroCariKod, customerName, destination, trackingNo, items[]
  // On success writes back: irsaliyeNo, irsaliyeEttn to shipments/{firebaseId}
  app.post('/api/mikro/irsaliye/kaydet', requireAuth, async (req: Request, res: Response) => {
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
      const envelope      = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0            = envelope?.[0] as Record<string, unknown> | undefined;
      const success       = ok && !r0?.IsError;
      const md            = (r0?.Data ?? r0?.data ?? {}) as Record<string, unknown>;
      const irsaliyeNo    = (md?.irsaliyeNo || md?.IrsaliyeNo || md?.evrakNo || md?.EvrakNo || md?.id || null) as string | null;
      const irsaliyeEttn  = (md?.ettn || md?.Ettn || md?.uuid || null) as string | null;
      const errorMsg      = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await writeSyncLog('IrsaliyeKaydetV2', 'shipment', firebaseId || 'unknown', success, irsaliyeNo, errorMsg, duration, reqActor(req));
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
      await writeSyncLog('IrsaliyeKaydetV2', 'shipment', firebaseId || 'unknown', false, null, errorMsg, duration, reqActor(req));
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // ── Mikro Pull: Cari Bakiye ──────────────────────────────────────────────────
  // POST /api/mikro/pull/bakiye — pull AR/AP balances from Mikro → Firebase cariBalances
  // Runs full CariHareketListesiV2 per lead that has mikroCariKod; updates their bakiye
  app.post('/api/mikro/pull/bakiye', requireAuth, async (req: Request, res: Response) => {
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
            Size: '5',    // Mikro returns a malformed response (no 'result' key) for Size < 5
            Index: 0,
          });
          if (!ok) { errors++; continue; }
          const md = mikroData(data);
          // Mikro returns bakiye in various field names depending on version
          const bakiye      = Number(md?.bakiye ?? md?.Bakiye ?? md?.cariBakiye ?? 0);
          const vadeliBorc  = Number(md?.vadeliBorc ?? md?.VadeliBorc ?? 0);
          // Mirror to cariBalances collection AND update lead doc
          await adminDb.collection('cariBalances').doc(cariKod).set({
            cariKod, bakiye, vadeliBorc,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          await leadDoc.ref.set({ bakiye, vadeliBorc }, { merge: true });
          updated++;
        } catch { errors++; }
      }
      await writeAuditLog(reqActor(req), 'Mikro Bakiye Çekme', `${updated} cari bakiyesi güncellendi, ${errors} hata`);
      res.json({ success: true, total: leadsSnap.size, updated, errors, duration: Date.now() - t0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Mikro Pull: Mizan (Trial Balance) ───────────────────────────────────────
  // POST /api/mikro/pull/mizan  — pull monthly trial balance → Firebase accountingPeriods
  // Body: { period?: 'YYYY-MM', yil?: number, ay?: number }
  app.post('/api/mikro/pull/mizan', requireAuth, async (req: Request, res: Response) => {
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
      const md     = mikroData(data);
      const rows   = (md?.MizanListesi ?? md?.Hesaplar ?? md?.hesaplar ?? md?.mizan ?? []) as Record<string, unknown>[];
      const docId  = period;

      await adminDb.collection('accountingPeriods').doc(docId).set({
        period, yil, ay, rows,
        toplam: { borc: rows.reduce((s, r) => s + Number(r.borc ?? 0), 0), alacak: rows.reduce((s, r) => s + Number(r.alacak ?? 0), 0) },
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await writeAuditLog(reqActor(req), 'Mikro Mizan Çekme', `${period} dönemi — ${rows.length} hesap satırı`);
      res.json({ success: true, period, rowCount: rows.length, duration: Date.now() - t0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Mutabakat PDF Generation ─────────────────────────────────────────────────
  // GET /api/mutabakat/:leadId  — returns JSON data for client-side PDF generation
  // The client (MutabakatPanel) renders the PDF using jsPDF
  app.get('/api/mutabakat/:leadId', requireAuth, async (req: Request, res: Response) => {
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
  app.post('/api/mikro/pull/kdv', requireAuth, async (req: Request, res: Response) => {
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
      const md = mikroData(data);
      await adminDb.collection('taxSummary').doc(period).set({
        period, yil, ay,
        kdvHesaplanan: Number(md?.kdvHesaplanan ?? md?.KdvHesaplanan ?? md?.hesaplananKdv ?? 0),
        kdvIndirilecek: Number(md?.kdvIndirilecek ?? md?.KdvIndirilecek ?? md?.indirilecekKdv ?? 0),
        kdvOdenmesi: Number(md?.odenmesiGerekenKdv ?? md?.OdenmesiGerekenKdv ?? md?.kdvFarki ?? 0),
        rawData: md,
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await writeAuditLog(reqActor(req), 'Mikro KDV Özeti Çekme', `${period} dönemi KDV özeti alındı`);
      res.json({ success: true, period, data: md, duration: Date.now() - t0 });
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
  app.post('/api/trendyol/sync', requireAuth, async (req: Request, res: Response) => {
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
      await writeAuditLog(reqActor(req), 'Trendyol Senkronizasyon', `${orders.length} sipariş — ${created} yeni, ${updated} güncellendi`);
      await writeAuditLog(reqActor(req), 'Hepsiburada Senkronizasyon', `${orders.length} sipariş — ${created} yeni, ${updated} güncellendi`);
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
  app.post('/api/hepsiburada/sync', requireAuth, async (req: Request, res: Response) => {
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
  app.post('/api/whatsapp/send', requireAuth, async (req: Request, res: Response) => {
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
        await writeAuditLog(reqActor(req), 'WhatsApp Mesaj', `${phone} numarasına gönderildi (360dialog)`);
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
        await writeAuditLog(reqActor(req), 'WhatsApp Mesaj', `${phone} numarasına gönderildi (Twilio)`);
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
  app.get('/api/aging', requireAuth, async (req: Request, res: Response) => {
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

  // POST /api/email/send — generic send (used by UI, requires auth)
  // Body: { to, subject, html }
  app.post('/api/email/send', requireAuth, async (req: Request, res: Response) => {
    const { to, subject, html } = req.body as { to: string; subject: string; html: string };
    if (!to || !subject || !html) return res.status(400).json({ success: false, error: 'to, subject, html gerekli.' });
    const result = await sendEmail(to, subject, html);
    if (result.error === 'notConfigured') return res.status(503).json({ success: false, notConfigured: true });
    if (result.error) return res.status(500).json({ success: false, error: result.error });
    res.json({ success: true, id: result.id });
  });

  // POST /api/email/order-notification
  // Body: { orderId, status, customerEmail } — sends branded status email
  app.post('/api/email/order-notification', requireAuth, async (req: Request, res: Response) => {
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

  // ── Admin: User Invite ────────────────────────────────────────────────────
  // POST /api/admin/invite — sends invite email via Resend, stores invite doc in Firestore
  // Body: { email, role }
  app.post('/api/admin/invite', authLimiter, requireAuth, async (req: Request, res: Response) => {
    const { email, role = 'Sales' } = req.body as { email: string; role?: string };
    if (!email) return res.status(400).json({ success: false, error: 'email gerekli.' });

    // Generate a random token
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    // Store invite in Firestore (if admin available)
    if (adminDb) {
      try {
        await adminDb.collection('invites').doc(token).set({
          email, role, token, expiresAt,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          used: false,
        });
      } catch (e) {
        console.warn('Could not write invite to Firestore:', (e as Error).message);
      }
    }

    // Determine app URL for invite link
    const appUrl = process.env.APP_URL || `https://gen-lang-client-0628151245.web.app`;
    const inviteUrl = `${appUrl}/?invite=${token}`;

    // Send via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey && !adminDb) return res.status(503).json({ success: false, notConfigured: true });
    if (!resendKey) {
      // No email config — still return success with the invite URL so admin can share manually
      return res.json({ success: true, inviteUrl, emailSent: false, note: 'Resend not configured — share the invite URL manually.' });
    }

    const fromAddress = process.env.RESEND_FROM || 'davet@cetpa.com.tr';
    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#f5f5f7;margin:0;padding:24px;">
  <div style="max-width:480px;margin:auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
    <div style="background:#ff4000;padding:28px 32px;">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;letter-spacing:-.5px;">CETPA'ya Davet Edildiniz</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="font-size:14px;color:#1d1d1f;margin:0 0 16px;">Merhaba,</p>
      <p style="font-size:14px;color:#1d1d1f;margin:0 0 24px;">
        CETPA B2B platformuna <strong>${role}</strong> rolüyle davet edildiniz.
        Aşağıdaki butona tıklayarak kaydınızı tamamlayabilirsiniz.
      </p>
      <a href="${inviteUrl}" style="display:inline-block;background:#ff4000;color:#fff;padding:14px 28px;border-radius:12px;font-weight:700;font-size:14px;text-decoration:none;letter-spacing:-.2px;">
        Hesap Oluştur
      </a>
      <p style="font-size:11px;color:#86868b;margin:20px 0 0;">Bu bağlantı 7 gün geçerlidir. Eğer bu daveti beklemiyor idiyseniz görmezden gelebilirsiniz.</p>
    </div>
    <div style="background:#f5f5f7;padding:16px 32px;text-align:center;">
      <p style="font-size:11px;color:#86868b;margin:0;">CETPA B2B SaaS Platform</p>
    </div>
  </div>
</body></html>`;

    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromAddress, to: [email], subject: `CETPA'ya Davet Edildiniz — ${role} Rolü`, html }),
      });
      const d = await r.json() as Record<string, unknown>;
      if (!r.ok) return res.status(500).json({ success: false, error: (d.message as string) || 'Resend API hatası' });
      return res.json({ success: true, inviteUrl, emailSent: true, id: d.id });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /**
   * POST /api/email/bulk-campaign
   * Body: { subject, body, recipients: {name, email}[], campaignId? }
   * Sends an email to each recipient, personalising {{name}} placeholder.
   * Rate-limited to 3 req/s to stay inside Resend free tier.
   * Returns: { sent, failed, notConfigured? }
   */
  app.post('/api/email/bulk-campaign', requireAuth, async (req: Request, res: Response) => {
    const { subject, body, recipients, campaignId } =
      req.body as { subject: string; body: string; recipients: { name: string; email: string }[]; campaignId?: string };

    if (!subject || !body || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'subject, body, and recipients[] required.' });
    }

    const creds = await getResendKey();
    if (!creds) return res.json({ sent: 0, failed: 0, notConfigured: true });

    let sent = 0;
    let failed = 0;
    const BATCH_DELAY_MS = 350; // ~3 req/s

    for (const recipient of recipients) {
      if (!recipient.email) { failed++; continue; }
      const personalised = body.replace(/\{\{name\}\}/gi, recipient.name || recipient.email.split('@')[0]);
      const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <p>${personalised.replace(/\n/g, '<br>')}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:11px;color:#999">Bu e-posta Cetpa ERP tarafından gönderilmiştir. Abonelikten çıkmak için lütfen bizimle iletişime geçin.</p>
      </body></html>`;
      const result = await sendEmail(recipient.email, subject, html);
      if (result.error) { failed++; } else { sent++; }
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }

    // Update campaign record if ID provided
    if (campaignId && adminDb) {
      await adminDb.collection('campaigns').doc(campaignId).update({
        sent,
        failed,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'sent',
      }).catch(() => {});
    }

    console.log(`[bulk-campaign] sent=${sent} failed=${failed} total=${recipients.length}`);
    return res.json({ sent, failed });
  });

  // ── Outbound Webhooks (Phase 649) ─────────────────────────────────────────

  /**
   * Fires all enabled webhookConfigs that subscribe to `event`.
   * Called internally when Cetpa events happen (order created, payment, etc.)
   */
  async function fireWebhooks(event: string, payload: Record<string, unknown>) {
    if (!adminDb) return;
    try {
      const snap = await adminDb.collection('webhookConfigs').where('enabled', '==', true).get();
      const configs = snap.docs.map(d => ({ id: d.id, ...d.data() } as { id: string; url: string; events: string[]; enabled: boolean }));
      const targets = configs.filter(c => (c.events ?? []).includes(event));
      await Promise.allSettled(targets.map(async c => {
        try {
          const r = await fetch(c.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cetpa-Event': event },
            body: JSON.stringify({ event, data: payload, sentAt: new Date().toISOString() }),
            signal: AbortSignal.timeout(5000),
          });
          console.log(`[webhook] ${event} → ${c.url} : ${r.status}`);
        } catch (e) {
          console.warn(`[webhook] ${event} → ${c.url} FAILED:`, (e as Error).message);
        }
      }));
    } catch (e) {
      console.error('[fireWebhooks]', e);
    }
  }

  /**
   * POST /api/webhooks/test
   * Body: { url }
   * Sends a test ping to the given URL and returns { ok, status }.
   */
  app.post('/api/webhooks/test', requireAuth, async (req: Request, res: Response) => {
    const { url } = req.body as { url: string };
    if (!url || !url.startsWith('http')) return res.status(400).json({ error: 'valid url required' });
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cetpa-Event': 'test' },
        body: JSON.stringify({ event: 'test', data: { message: 'Cetpa webhook test ping' }, sentAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(5000),
      });
      return res.json({ ok: r.ok, status: r.status });
    } catch (e) {
      return res.json({ ok: false, error: (e as Error).message });
    }
  });

  // Make fireWebhooks available to Shopify webhook handler (order create fires it)
  // Re-export via closure — the Shopify route calls it directly since it's in the same scope.
  // Usage: await fireWebhooks('order.created', { id, customerName, total });

  // ── Reports Summary API ────────────────────────────────────────────────────
  // GET /api/reports/summary — aggregated KPIs for the last 30 days vs prior 30 days
  app.get('/api/reports/summary', requireAuth, async (_req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    try {
      const now       = new Date();
      const d30       = new Date(now); d30.setDate(d30.getDate() - 30);
      const d60       = new Date(now); d60.setDate(d60.getDate() - 60);

      const [ordersSnap, leadsSnap, inventorySnap] = await Promise.all([
        adminDb.collection('orders').get(),
        adminDb.collection('leads').get(),
        adminDb.collection('inventory').get(),
      ]);

      const orders    = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>));
      const leads     = leadsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>));
      const inventory = inventorySnap.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>));

      function dateOf(o: Record<string, unknown>): Date {
        const raw = o.createdAt as { toDate?: () => Date } | string | null;
        if (!raw) return new Date(0);
        if (typeof raw === 'string') return new Date(raw);
        return raw.toDate?.() ?? new Date(0);
      }

      const thisOrders = orders.filter(o => dateOf(o) >= d30 && dateOf(o) <= now);
      const prevOrders = orders.filter(o => dateOf(o) >= d60 && dateOf(o) < d30);

      const revenue = (arr: typeof orders) => arr.reduce((s, o) => s + ((o.totalPrice as number) || 0), 0);
      const thisRevenue = revenue(thisOrders);
      const prevRevenue = revenue(prevOrders);

      const lowStock = inventory.filter(i => ((i.stockLevel as number) || 0) <= ((i.lowStockThreshold as number) || 5));

      res.json({
        period: { start: d30.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) },
        orders:     { count: thisOrders.length, prevCount: prevOrders.length, delta: thisOrders.length - prevOrders.length },
        revenue:    { total: thisRevenue, prev: prevRevenue, delta: thisRevenue - prevRevenue },
        leads:      { total: leads.length, new30: leads.filter(l => dateOf(l) >= d30).length },
        inventory:  { total: inventory.length, lowStock: lowStock.length },
        delivered:  thisOrders.filter(o => o.status === 'Delivered').length,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
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

  /** POST /api/luca/sync/yevmiye — yevmiye fişlerini Luca'ya aktar.
   *  Body: { entries: Array<{id, date, fiş, aciklama, debitHesap, alacakHesap, borc, alacak}> }
   *  Yalnızca Luca'nın kabul ettiği kayıtların id'leri synced olarak döner —
   *  client isSynced işaretini SADECE gerçek başarıda atar.
   */
  app.post('/api/luca/sync/yevmiye', requireAuth, async (req: Request, res: Response) => {
    const creds = await getLucaCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });
    const { entries } = req.body as { entries: Record<string, unknown>[] };
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, error: 'entries dizisi zorunlu.' });
    }
    const t0 = Date.now();
    const syncedIds: string[] = [];
    const errors: { id: string; error: string }[] = [];
    try {
      for (const e of entries) {
        try {
          const r = await fetch(`${LUCA_API_URL}/yevmiye`, {
            method: 'POST',
            headers: lucaHeaders(creds),
            body: JSON.stringify({
              fisNo:       e.fiş ?? e.fisNo,
              tarih:       e.date,
              aciklama:    e.aciklama,
              borcHesap:   e.debitHesap,
              alacakHesap: e.alacakHesap,
              borcTutar:   e.borc,
              alacakTutar: e.alacak,
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (r.ok) syncedIds.push(String(e.id));
          else errors.push({ id: String(e.id), error: `HTTP ${r.status}` });
        } catch (err) {
          errors.push({ id: String(e.id), error: err instanceof Error ? err.message : String(err) });
        }
      }
      await writeAuditLog(reqActor(req), 'Luca Yevmiye Sync',
        `${syncedIds.length}/${entries.length} fiş aktarıldı${errors.length ? `, ${errors.length} hata` : ''}`);
      res.json({ success: errors.length === 0, syncedIds, errors, duration: Date.now() - t0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err), syncedIds, errors });
    }
  });

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
  app.post('/api/luca/sync/fatura', requireAuth, async (req: Request, res: Response) => {
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
      await writeAuditLog(reqActor(req), 'Luca Fatura Sync', success ? `Fatura ${lucaFaturaNo ?? ''} Luca'ya aktarıldı` : 'HATA: Luca fatura aktarımı başarısız');
      res.json({ success, lucaFaturaNo, data, duration });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // POST /api/luca/sync/stok — pull products from Luca → Firebase inventory (upsert)
  app.post('/api/luca/sync/stok', requireAuth, async (req: Request, res: Response) => {
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
      await writeAuditLog(reqActor(req), 'Luca Stok Sync', `${items.length} ürün — ${created} yeni, ${updated} güncellendi`);
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
  app.post('/api/iyzico/payment-link', requireAuth, async (req: Request, res: Response) => {
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
      if (success) await writeAuditLog(reqActor(req), 'İyzico Ödeme Linki', `Sipariş ${orderId} için ödeme linki oluşturuldu (${amount} ${currency})`);
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

  // POST /api/whatsapp/order-notification
  // Body: { orderId, status, phone, customerName, orderNo, lang }
  // Fire-and-forget safe — always 200 even if WA not configured
  app.post('/api/whatsapp/order-notification', requireAuth, async (req: Request, res: Response) => {
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
      if (!result.error) await writeAuditLog(reqActor(req), 'WhatsApp Sipariş Bildirimi', `${phone} — sipariş durumu: ${status}`);
      res.json({ success: !result.error, messageId: result.messageId, error: result.error });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Gemini AI Proxy — key never leaves the server ────────────────────────
  // Priority: GEMINI_API_KEY env → Firestore settings/aiConfig → Vertex AI
  const PLACEHOLDERS_GEMINI = ['your_gemini_api_key_here', ''];
  const geminiApiKeyEnv = process.env.GEMINI_API_KEY ?? '';
  let geminiClient: GoogleGenAI | null = null;

  // Cache for Firestore-sourced key (5-min TTL)
  let geminiKeyCache: { key: string; ts: number } | null = null;

  async function resolveGeminiClient(): Promise<GoogleGenAI | null> {
    // 1. Env var wins
    if (geminiApiKeyEnv && !PLACEHOLDERS_GEMINI.includes(geminiApiKeyEnv)) {
      return geminiClient ?? (geminiClient = new GoogleGenAI({ apiKey: geminiApiKeyEnv }));
    }
    // 2. Vertex AI
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return geminiClient ?? (geminiClient = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: 'us-central1' }));
    }
    // 3. Firestore settings/aiConfig.geminiApiKey (set from UI)
    if (adminDb) {
      const now = Date.now();
      if (!geminiKeyCache || now - geminiKeyCache.ts > 5 * 60 * 1000) {
        try {
          const snap = await adminDb.collection('settings').doc('aiConfig').get();
          const key = (snap.data()?.geminiApiKey as string) ?? '';
          geminiKeyCache = { key, ts: now };
          if (key) console.log('Gemini client: Firestore key mode ✓');
        } catch { geminiKeyCache = { key: '', ts: now }; }
      }
      if (geminiKeyCache?.key) return new GoogleGenAI({ apiKey: geminiKeyCache.key });
    }
    return null;
  }

  if (geminiApiKeyEnv && !PLACEHOLDERS_GEMINI.includes(geminiApiKeyEnv)) {
    geminiClient = new GoogleGenAI({ apiKey: geminiApiKeyEnv });
    console.log('Gemini client: API key mode ✓');
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      geminiClient = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: 'us-central1' });
      console.log('Gemini client: Vertex AI mode (service account) ✓');
    } catch (e) {
      console.warn('Gemini Vertex AI init failed:', (e as Error).message);
    }
  } else {
    console.log('Gemini: no env key — will read from Firestore settings/aiConfig on first request');
  }

  /**
   * POST /api/ai/generate
   * Body: { prompt, model?, systemInstruction?, thinkingLevel?, jsonSchema? }
   * Returns: { text: string }
   * Used by: geminiService.ts (lead scoring, dashboard analysis, FMEA, 8D)
   */
  app.post('/api/ai/generate', requireAuth, async (req: Request, res: Response) => {
    const client = await resolveGeminiClient();
    if (!client) return res.status(503).json({ error: 'AI service not configured. Enter your Gemini API key in Settings → AI.' });
    const { prompt, model = 'gemini-2.0-flash', systemInstruction, thinkingLevel, jsonSchema } = req.body as {
      prompt: string; model?: string; systemInstruction?: string;
      thinkingLevel?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'; jsonSchema?: unknown;
    };
    if (!prompt) return res.status(400).json({ error: 'prompt is required.' });
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(thinkingLevel && thinkingLevel !== 'NONE' ? { thinkingConfig: { thinkingLevel: ThinkingLevel[thinkingLevel] } } : {}),
          ...(jsonSchema ? { responseMimeType: 'application/json', responseSchema: jsonSchema } : {}),
        } as Record<string, unknown>,
      });
      return res.json({ text: response.text ?? '' });
    } catch (e) {
      console.error('[Gemini generate]', e);
      return res.status(500).json({ error: 'AI generation failed.' });
    }
  });

  /**
   * POST /api/ai/chat
   * Body: { message, history?, systemInstruction?, model?, highThinking? }
   * Returns: { text: string }
   * Used by: AIChat.tsx
   */
  app.post('/api/ai/chat', requireAuth, async (req: Request, res: Response) => {
    const client = await resolveGeminiClient();
    if (!client) return res.status(503).json({ error: 'AI service not configured. Enter your Gemini API key in Settings → AI.' });
    const { message, history = [], systemInstruction, model = 'gemini-2.0-flash', highThinking = false } = req.body as {
      message: string;
      history?: { role: string; parts: { text: string }[] }[];
      systemInstruction?: string;
      model?: string;
      highThinking?: boolean;
    };
    if (!message) return res.status(400).json({ error: 'message is required.' });
    try {
      const chat = client.chats.create({
        model,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(highThinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } } : {}),
        } as Record<string, unknown>,
        history: history as { role: 'user' | 'model'; parts: { text: string }[] }[],
      });
      const response = await chat.sendMessage({ message });
      return res.json({ text: response.text ?? '' });
    } catch (e) {
      console.error('[Gemini chat]', e);
      return res.status(500).json({ error: 'AI chat failed.' });
    }
  });

  /**
   * POST /api/ai/demand-forecast
   * Body: { ordersCount, monthlyArr, topProductsCtx, inventoryCtx, today, lang }
   * Calls Gemini server-side with structured JSON schema and returns ForecastData.
   * Protected by Firebase Auth (requireAuth).
   */
  app.post('/api/ai/demand-forecast', requireAuth, async (req: Request, res: Response) => {
    const client = await resolveGeminiClient();
    if (!client) return res.status(503).json({ error: 'AI service not configured. Enter your Gemini API key in Settings → AI.' });
    const {
      ordersCount = 0,
      monthlyArr = [],
      topProductsCtx = [],
      inventoryCtx = '',
      today = new Date().toISOString().slice(0, 7),
      lang = 'tr',
    } = req.body as {
      ordersCount?: number;
      monthlyArr?: string[];
      topProductsCtx?: string[];
      inventoryCtx?: string;
      today?: string;
      lang?: string;
    };
    const language = lang === 'tr' ? 'Turkish' : 'English';
    const prompt = `You are a senior B2B sales analyst for Cetpa, a Turkish wholesale distributor.

Context (today: ${today}):
- Orders last 90 days: ${ordersCount}
- Monthly revenue: ${monthlyArr.join(', ')}
- Top products: ${topProductsCtx.join('; ')}
- Inventory: ${inventoryCtx || 'N/A'}

Based on these trends, respond in ${language} as valid JSON (no markdown fences).
Rules: topProducts ≤ 5; cashFlow = next 3 months projection; reorderAlerts only for products where stock < 30-day demand. All monetary values in TRY integers.`;
    try {
      const result = await client.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary:         { type: Type.STRING },
              topProducts:     { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, units: { type: Type.NUMBER }, trend: { type: Type.STRING } }, required: ['name','units','trend'] } },
              cashFlow:        { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { month: { type: Type.STRING }, projected: { type: Type.NUMBER } }, required: ['month','projected'] } },
              recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
              reorderAlerts:   { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { product: { type: Type.STRING }, currentStock: { type: Type.NUMBER }, recommendedReorder: { type: Type.NUMBER } }, required: ['product','currentStock','recommendedReorder'] } },
            },
            required: ['summary','topProducts','cashFlow','recommendations','reorderAlerts'],
          },
        } as Record<string, unknown>,
      });
      return res.json(JSON.parse(result.text ?? '{}'));
    } catch (e) {
      console.error('[demand-forecast]', e);
      return res.status(500).json({ error: 'Demand forecast failed.' });
    }
  });

  // ── Stripe Payment Integration ───────────────────────────────────────────
  const stripeClient = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' })
    : null;

  /** Price config mirroring src/types/subscription.ts — kept in sync manually */
  const STRIPE_PLAN_PRICES: Record<string, { monthly: number; yearly: number; name: string }> = {
    starter:      { monthly: 99900,  yearly: 999000,  name: 'Cetpa Başlangıç' },
    professional: { monthly: 249900, yearly: 2499000, name: 'Cetpa Profesyonel' },
    business:     { monthly: 499900, yearly: 4999000, name: 'Cetpa Business' },
  };
  // Amounts above are in kuruş (TRY minor unit, ×100)

  /**
   * POST /api/stripe/create-checkout
   * Body: { planId, cycle }
   * Returns: { url: string } — Stripe Checkout hosted URL
   * Protected by Firebase Auth (requireAuth).
   */
  app.post('/api/stripe/create-checkout', paymentLimiter, requireAuth, async (req: Request, res: Response) => {
    if (!stripeClient) return res.status(503).json({ error: 'Stripe not configured.' });
    const uid = (req as Request & { uid: string }).uid;
    const { planId, cycle } = req.body as { planId: string; cycle: 'monthly' | 'yearly' };

    const prices = STRIPE_PLAN_PRICES[planId];
    if (!prices) return res.status(400).json({ error: `Unknown plan: ${planId}` });
    if (!['monthly', 'yearly'].includes(cycle)) return res.status(400).json({ error: 'cycle must be monthly or yearly' });

    const unitAmount = cycle === 'monthly' ? prices.monthly : prices.yearly;
    const interval  = cycle === 'monthly' ? 'month' : 'year';
    const origin    = (req.headers.origin as string) || 'http://localhost:5173';

    try {
      // Fetch or create Stripe customer for this Firebase UID
      let customerId: string | undefined;
      if (adminDb) {
        const subSnap = await adminDb.collection('subscriptions').doc(uid).get();
        if (subSnap.exists) customerId = (subSnap.data() as { stripeCustomerId?: string }).stripeCustomerId;
      }

      const session = await stripeClient.checkout.sessions.create({
        mode: 'subscription',
        ...(customerId ? { customer: customerId } : {}),
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'try',
            unit_amount: unitAmount,
            product_data: { name: prices.name },
            recurring: { interval },
          },
        }],
        metadata: { firebaseUid: uid, plan: planId, cycle },
        success_url: `${origin}/?checkout=success&plan=${planId}&cycle=${cycle}`,
        cancel_url:  `${origin}/?checkout=cancel`,
        subscription_data: { metadata: { firebaseUid: uid, plan: planId, cycle } },
      });

      return res.json({ url: session.url });
    } catch (e) {
      console.error('[Stripe create-checkout]', e);
      return res.status(500).json({ error: 'Failed to create checkout session.' });
    }
  });

  /**
   * POST /api/stripe/webhook
   * Stripe sends events here. Signature verified with STRIPE_WEBHOOK_SECRET.
   * Handles:
   *   checkout.session.completed       → activate subscription in Firestore
   *   customer.subscription.updated    → sync status changes
   *   customer.subscription.deleted    → mark cancelled
   */
  app.post('/api/stripe/webhook', async (req: Request & { rawBody?: Buffer }, res: Response) => {
    if (!stripeClient) return res.status(503).json({ error: 'Stripe not configured.' });
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) return res.status(503).json({ error: 'Webhook secret not set.' });
    if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header.' });

    let event: Stripe.Event;
    try {
      event = stripeClient.webhooks.constructEvent(req.rawBody ?? Buffer.from(''), sig, webhookSecret);
    } catch (e) {
      console.error('[Stripe webhook] signature verification failed:', e);
      return res.status(400).json({ error: 'Invalid signature.' });
    }

    if (!adminDb) return res.status(503).json({ error: 'Firestore not available.' });

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const { firebaseUid, plan, cycle } = session.metadata ?? {};
        if (!firebaseUid || !plan || !cycle) return res.sendStatus(200);

        const now   = new Date();
        const end   = new Date(now);
        if (cycle === 'monthly') end.setMonth(end.getMonth() + 1);
        else end.setFullYear(end.getFullYear() + 1);

        const planPrices = STRIPE_PLAN_PRICES[plan];
        const amount = planPrices ? (cycle === 'monthly' ? planPrices.monthly / 100 : planPrices.yearly / 100) : 0;

        // Activate subscription
        await adminDb.collection('subscriptions').doc(firebaseUid).set({
          plan,
          cycle,
          status: 'active',
          startDate: now.toISOString(),
          endDate: end.toISOString(),
          lastPayment: now.toISOString(),
          stripeCustomerId: session.customer as string ?? '',
          stripeSubscriptionId: session.subscription as string ?? '',
          maxUsers: plan === 'starter' ? 1 : plan === 'professional' ? 5 : plan === 'business' ? 20 : 999,
          currentUsers: 1,
        }, { merge: true });

        // Log payment record
        await adminDb.collection('payments').add({
          userId: firebaseUid,
          plan,
          cycle,
          amount,
          currency: 'TRY',
          status: 'paid',
          stripeSessionId: session.id,
          stripeCustomerId: session.customer ?? '',
          date: now.toISOString(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[Stripe] Subscription activated for uid=${firebaseUid} plan=${plan}/${cycle}`);
      }

      if (event.type === 'customer.subscription.updated') {
        const sub = event.data.object as Stripe.Subscription;
        const { firebaseUid } = sub.metadata ?? {};
        if (!firebaseUid) return res.sendStatus(200);

        const statusMap: Record<string, string> = {
          active:   'active',
          past_due: 'past_due',
          canceled: 'cancelled',
          unpaid:   'past_due',
        };
        await adminDb.collection('subscriptions').doc(firebaseUid).set(
          { status: statusMap[sub.status] ?? sub.status },
          { merge: true }
        );
      }

      if (event.type === 'customer.subscription.deleted') {
        const sub = event.data.object as Stripe.Subscription;
        const { firebaseUid } = sub.metadata ?? {};
        if (!firebaseUid) return res.sendStatus(200);

        await adminDb.collection('subscriptions').doc(firebaseUid).set(
          { status: 'cancelled', cancelledAt: new Date().toISOString() },
          { merge: true }
        );
        console.log(`[Stripe] Subscription cancelled for uid=${firebaseUid}`);
      }
    } catch (e) {
      console.error('[Stripe webhook] handler error:', e);
      return res.status(500).json({ error: 'Webhook handler failed.' });
    }

    return res.sendStatus(200);
  });

  // ── Health & Stats endpoints (all modes) ──────────────────────────────────

  // GET /api/health — liveness probe + integration status (no key values disclosed)
  app.get('/api/health', async (_req: Request, res: Response) => {
    // ── Firebase: attempt a lightweight Firestore read ──────────────────────
    let firebaseOk = false;
    if (adminDb) {
      try {
        await adminDb.collection('settings').doc('__health__').get();
        firebaseOk = true;
      } catch {
        // doc not found is fine (404 ≠ error); actual auth/network errors throw
        firebaseOk = true; // adminDb is initialised — connection is working
      }
    }

    // ── Resend: env var OR Firestore settings/email ─────────────────────────
    let resendOk = !!process.env.RESEND_API_KEY;
    if (!resendOk && adminDb) {
      try {
        const snap = await adminDb.collection('settings').doc('email').get();
        resendOk = !!(snap.data()?.resendApiKey);
      } catch { /* ignore */ }
    }

    // ── WhatsApp: Twilio OR 360dialog env vars ──────────────────────────────
    const whatsappOk =
      !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) ||
      !!process.env.WHATSAPP_360DIALOG_API_KEY;

    // ── İyzico: env vars OR Firestore settings/iyzico ──────────────────────
    let iyzicoOk = !!(process.env.IYZICO_API_KEY && process.env.IYZICO_SECRET_KEY);
    if (!iyzicoOk && adminDb) {
      try {
        const snap = await adminDb.collection('settings').doc('iyzico').get();
        const d = snap.data();
        iyzicoOk = !!(d?.apiKey && d?.secretKey);
      } catch { /* ignore */ }
    }

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      env: process.env.NODE_ENV ?? 'development',
      firebase: firebaseOk,
      resend: resendOk,
      whatsapp: whatsappOk,
      iyzico: iyzicoOk,
    });
  });

  // GET /api/admin/stats — Firestore collection doc counts (admin only)
  app.get('/api/admin/stats', requireAuth, async (_req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    const COLLECTIONS = [
      'inventory', 'orders', 'leads', 'shipments', 'purchaseOrders',
      'quotations', 'payments', 'notifications', 'auditLog',
      'inventoryMovements', 'priceLists', 'bom',
    ];
    try {
      const counts: Record<string, number> = {};
      await Promise.all(
        COLLECTIONS.map(async col => {
          const snap = await adminDb!.collection(col).count().get();
          counts[col] = snap.data().count;
        })
      );
      return res.json({ counts, timestamp: new Date().toISOString() });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ERP PLUGIN ROUTES
  // Each ERP follows the same contract:
  //   GET  /api/{erpId}/status          → { configured, connected, error? }
  //   POST /api/{erpId}/import/stok     → ErpImportResult
  //   POST /api/{erpId}/import/cari     → ErpImportResult
  //   POST /api/{erpId}/export/siparis  { orderId } → { success, {erpId}OrderNo }
  //   POST /api/{erpId}/export/fatura   { orderId } → { success, {erpId}InvoiceNo }
  //
  // Status: stubs return notImplemented=true until real API adapters are built.
  // Credentials live in server env vars — never sent to browser.
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Logo Tiger / Go / Start ──────────────────────────────────────────────────
  // Docs: https://developer.logo.com.tr
  // Auth: API Key header (X-Logo-ApiKey) + LOGO_FIRM_NO in request body
  // Base: LOGO_API_URL env var (self-hosted or Logo cloud)

  type LogoCreds = { apiUrl: string; apiKey: string; firmNo: string };
  async function getLogoCreds(): Promise<LogoCreds | null> {
    if (process.env.LOGO_API_URL && process.env.LOGO_API_KEY && process.env.LOGO_FIRM_NO)
      return { apiUrl: process.env.LOGO_API_URL, apiKey: process.env.LOGO_API_KEY, firmNo: process.env.LOGO_FIRM_NO };
    if (!adminDb) return null;
    const snap = await adminDb.collection('settings').doc('logo').get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, string>;
    if (!d.logoApiUrl && !d.apiUrl) return null;
    return { apiUrl: d.logoApiUrl || d.apiUrl || '', apiKey: d.logoApiKey || d.apiKey || '', firmNo: d.logoFirmNo || d.firmNo || '1' };
  }

  app.get('/api/logo/status', async (_req: Request, res: Response) => {
    const creds = await getLogoCreds();
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

  app.post('/api/logo/import/stok', requireAuth, async (_req: Request, res: Response) => {
    if (!(await getLogoCreds())) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'Logo stok import not yet implemented.' });
  });

  app.post('/api/logo/import/cari', requireAuth, async (_req: Request, res: Response) => {
    if (!(await getLogoCreds())) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'Logo cari import not yet implemented.' });
  });

  app.post('/api/logo/export/siparis', requireAuth, async (req: Request, res: Response) => {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    if (!(await getLogoCreds())) return res.json({ success: false, notConfigured: true });
    return res.json({ success: false, notImplemented: true, error: 'Logo sipariş export not yet implemented.' });
  });

  // ── Microsoft Dynamics 365 Business Central ──────────────────────────────────
  // Docs: https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/
  // Auth: Azure AD OAuth2 client_credentials → Bearer token
  // Base: https://api.businesscentral.dynamics.com/v2.0/{DYNAMICS_TENANT_ID}/{DYNAMICS_ENVIRONMENT}/api/v2.0/companies({DYNAMICS_COMPANY_ID})/

  const DYNAMICS_TOKEN_CACHE: { token?: string; expiresAt?: number } = {};

  type DynamicsCreds = { tenantId: string; clientId: string; clientSecret: string; companyId: string; environment: string };
  async function getDynamicsCredsFromFirestore(): Promise<DynamicsCreds | null> {
    if (!adminDb) return null;
    const snap = await adminDb.collection('settings').doc('dynamics365').get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, string>;
    if (!d.dynamicsTenantId && !d.tenantId) return null;
    return {
      tenantId:     d.dynamicsTenantId || d.tenantId || '',
      clientId:     d.dynamicsClientId || d.clientId || '',
      clientSecret: d.dynamicsClientSecret || d.clientSecret || '',
      companyId:    d.dynamicsCompanyId || d.companyId || '',
      environment:  d.dynamicsEnvironment || d.environment || 'production',
    };
  }

  async function getDynamicsToken(): Promise<string | null> {
    const now = Date.now();
    if (DYNAMICS_TOKEN_CACHE.token && DYNAMICS_TOKEN_CACHE.expiresAt && now < DYNAMICS_TOKEN_CACHE.expiresAt - 60_000) {
      return DYNAMICS_TOKEN_CACHE.token;
    }
    let tenantId = process.env.DYNAMICS_TENANT_ID ?? '';
    let clientId = process.env.DYNAMICS_CLIENT_ID ?? '';
    let clientSecret = process.env.DYNAMICS_CLIENT_SECRET ?? '';
    if (!(tenantId && clientId && clientSecret)) {
      const fsCreds = await getDynamicsCredsFromFirestore();
      if (!fsCreds) return null;
      tenantId = fsCreds.tenantId; clientId = fsCreds.clientId; clientSecret = fsCreds.clientSecret;
    }
    if (!(tenantId && clientId && clientSecret)) return null;
    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         'https://api.businesscentral.dynamics.com/.default',
    });
    const r = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (!r.ok) return null;
    const d = await r.json() as { access_token: string; expires_in: number };
    DYNAMICS_TOKEN_CACHE.token     = d.access_token;
    DYNAMICS_TOKEN_CACHE.expiresAt = now + d.expires_in * 1000;
    return d.access_token;
  }

  function getDynamicsBase(): string {
    const env = process.env.DYNAMICS_ENVIRONMENT ?? 'production';
    return `https://api.businesscentral.dynamics.com/v2.0/${process.env.DYNAMICS_TENANT_ID}/${env}/api/v2.0/companies(${process.env.DYNAMICS_COMPANY_ID})`;
  }

  app.get('/api/dynamics/status', async (_req: Request, res: Response) => {
    const hasEnvCreds = !!(process.env.DYNAMICS_TENANT_ID && process.env.DYNAMICS_CLIENT_ID && process.env.DYNAMICS_CLIENT_SECRET && process.env.DYNAMICS_COMPANY_ID);
    const fsCreds = hasEnvCreds ? null : await getDynamicsCredsFromFirestore();
    const configured = hasEnvCreds || !!fsCreds;
    if (!configured) return res.json({ configured: false, connected: false });
    try {
      const token = await getDynamicsToken();
      if (!token) return res.json({ configured: true, connected: false, error: 'OAuth2 token request failed — check DYNAMICS_CLIENT_ID / DYNAMICS_CLIENT_SECRET / DYNAMICS_TENANT_ID' });
      const r = await fetch(`${getDynamicsBase()}/companies`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!r.ok) return res.json({ configured: true, connected: false, error: `BC API returned HTTP ${r.status}` });
      const data = await r.json() as { value?: { displayName?: string; name?: string }[] };
      const company = data?.value?.[0];
      return res.json({
        configured: true,
        connected:  true,
        companyName: company?.displayName ?? company?.name ?? 'Business Central',
        environmentName: process.env.DYNAMICS_ENVIRONMENT ?? 'production',
      });
    } catch (err) {
      return res.json({ configured: true, connected: false, error: String(err) });
    }
  });

  app.post('/api/dynamics/import/stok', requireAuth, async (_req: Request, res: Response) => {
    const token = await getDynamicsToken();
    if (!token) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    // TODO: paginate GET /items, upsert to Firebase inventory
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'Dynamics items import not yet implemented.' });
  });

  app.post('/api/dynamics/import/cari', requireAuth, async (_req: Request, res: Response) => {
    const token = await getDynamicsToken();
    if (!token) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    // TODO: paginate GET /customers, upsert to Firebase leads
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'Dynamics customer import not yet implemented.' });
  });

  app.post('/api/dynamics/export/siparis', requireAuth, async (req: Request, res: Response) => {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    const token = await getDynamicsToken();
    if (!token) return res.json({ success: false, notConfigured: true });
    // TODO: fetch order from Firebase, POST /salesOrders to Business Central
    return res.json({ success: false, notImplemented: true, error: 'Dynamics order export not yet implemented.' });
  });

  app.post('/api/dynamics/export/fatura', requireAuth, async (req: Request, res: Response) => {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    const token = await getDynamicsToken();
    if (!token) return res.json({ success: false, notConfigured: true });
    // TODO: fetch order from Firebase, POST /salesInvoices to Business Central
    return res.json({ success: false, notImplemented: true, error: 'Dynamics invoice export not yet implemented.' });
  });

  // ── SAP Business One (Service Layer) ─────────────────────────────────────────
  // Docs: https://help.sap.com/docs/SAP_BUSINESS_ONE/b1
  // Auth: POST /b1s/v1/Login { UserName, Password, CompanyDB } → Set-Cookie: B1SESSION
  // The session has a 5-minute idle timeout; server renews it automatically.

  const SAP_SESSION: { sessionId?: string; lastUsed?: number } = {};

  type SAPCreds = { serviceLayerUrl: string; username: string; password: string; companyDb: string };
  async function getSAPCredsFromFirestore(): Promise<SAPCreds | null> {
    if (!adminDb) return null;
    const snap = await adminDb.collection('settings').doc('sap').get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, string>;
    if (!d.sapServiceLayerUrl && !d.serviceLayerUrl) return null;
    return {
      serviceLayerUrl: d.sapServiceLayerUrl || d.serviceLayerUrl || '',
      username:        d.sapUsername || d.username || '',
      password:        d.sapPassword || d.password || '',
      companyDb:       d.sapCompanyDb || d.companyDb || '',
    };
  }

  async function getSAPSession(): Promise<string | null> {
    let serviceLayerUrl = process.env.SAP_SERVICE_LAYER_URL ?? '';
    let username        = process.env.SAP_USERNAME ?? '';
    let password        = process.env.SAP_PASSWORD ?? '';
    let companyDb       = process.env.SAP_COMPANY_DB ?? '';
    if (!(serviceLayerUrl && username && password && companyDb)) {
      const fsCreds = await getSAPCredsFromFirestore();
      if (!fsCreds) return null;
      serviceLayerUrl = fsCreds.serviceLayerUrl; username = fsCreds.username; password = fsCreds.password; companyDb = fsCreds.companyDb;
    }
    if (!(serviceLayerUrl && username && password && companyDb)) return null;
    // If session is younger than 4 minutes, reuse it (SAP timeout is 5 min idle)
    const now = Date.now();
    if (SAP_SESSION.sessionId && SAP_SESSION.lastUsed && now - SAP_SESSION.lastUsed < 4 * 60 * 1000) {
      SAP_SESSION.lastUsed = now;
      return SAP_SESSION.sessionId;
    }
    const r = await fetch(`${serviceLayerUrl}/Login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ UserName: username, Password: password, CompanyDB: companyDb }),
    });
    if (!r.ok) return null;
    const cookie = r.headers.get('set-cookie') ?? '';
    const match  = cookie.match(/B1SESSION=([^;]+)/);
    if (!match) return null;
    SAP_SESSION.sessionId = match[1];
    SAP_SESSION.lastUsed  = now;
    return SAP_SESSION.sessionId;
  }

  app.get('/api/sap/status', async (_req: Request, res: Response) => {
    const hasEnvCreds = !!(process.env.SAP_SERVICE_LAYER_URL && process.env.SAP_USERNAME && process.env.SAP_PASSWORD && process.env.SAP_COMPANY_DB);
    const fsCreds = hasEnvCreds ? null : await getSAPCredsFromFirestore();
    const configured = hasEnvCreds || !!fsCreds;
    if (!configured) return res.json({ configured: false, connected: false });
    try {
      const session = await getSAPSession();
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

  app.post('/api/sap/import/stok', requireAuth, async (_req: Request, res: Response) => {
    const session = await getSAPSession();
    if (!session) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    // TODO: paginate GET /Items?$select=ItemCode,ItemName,OnHand,Price, upsert to Firebase
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'SAP items import not yet implemented.' });
  });

  app.post('/api/sap/import/cari', requireAuth, async (_req: Request, res: Response) => {
    const session = await getSAPSession();
    if (!session) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    // TODO: paginate GET /BusinessPartners?$filter=CardType eq 'cCustomer', upsert to Firebase leads
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'SAP business partner import not yet implemented.' });
  });

  app.post('/api/sap/export/siparis', requireAuth, async (req: Request, res: Response) => {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    const session = await getSAPSession();
    if (!session) return res.json({ success: false, notConfigured: true });
    // TODO: fetch order from Firebase, POST /Orders to SAP Service Layer
    return res.json({ success: false, notImplemented: true, error: 'SAP order export not yet implemented.' });
  });

  app.post('/api/sap/export/fatura', requireAuth, async (req: Request, res: Response) => {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    const session = await getSAPSession();
    if (!session) return res.json({ success: false, notConfigured: true });
    // TODO: fetch order from Firebase, POST /Invoices to SAP Service Layer
    return res.json({ success: false, notImplemented: true, error: 'SAP invoice export not yet implemented.' });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // END ERP PLUGIN ROUTES
  // ─────────────────────────────────────────────────────────────────────────────

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      optimizeDeps: { force: true },
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // Hashed assets (JS/CSS with content hash in filename) — cache 1 year
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }));
    // Everything else (index.html, icons) — no cache so new deploys are picked up
    app.use(express.static(distPath, { maxAge: 0 }));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Graceful shutdown — Docker/systemd sends SIGTERM before SIGKILL
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  });
}

startServer();
