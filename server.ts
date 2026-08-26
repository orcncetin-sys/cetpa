import express, { Request, Response, NextFunction } from "express";
import { PgBoss } from "pg-boss";
import compression from "compression";
import helmet from "helmet";
import {
  initPgShim, dbEvents, genDocId, broadcastDocChange, pgServerTimestamp,
  STREAM_INIT_MAX_ROWS, PgDocRef, PgFirestore,
  resolveSentinels, mergeDocData,
} from "./src/server/pgShim.js";
import { trackingRoutes } from "./src/server/routes/trackingRoutes.js";
import { opsRoutes } from "./src/server/routes/opsRoutes.js";
import { dynamicsRoutes } from "./src/server/routes/dynamicsRoutes.js";
import { superadminRoutes } from "./src/server/routes/superadminRoutes.js";
import { mikroRoutes } from "./src/server/routes/mikroRoutes.js";
import { initCrons } from "./src/server/crons.js";
import {
  initMikroMirror, initMikroTables,
} from "./src/server/mikroMirror.js";
import {
  initMikroClient,
  getMikroCreds, getMikroToken, mikroTokenCacheMap,
} from "./src/server/mikroClient.js";
import {
  initOpsWatchdog, SAKLAMA_KURALLARI,
} from "./src/server/opsWatchdog.js";
import {
  type AppRole, type DbOp, ADMIN_ROLES, STAFF_ROLES, APPEND_ONLY_COLLECTIONS, PUBLIC_WRITE_COLLECTIONS,
  isAllowed, isSelfDocAccess, blocksRoleEscalation,
} from "./src/lib/rbac.js";
import {
  TENANT_COLLECTIONS as TENANT_COLLECTION_LIST,
  USER_SCOPED_COLLECTIONS as USER_SCOPED_COLLECTION_LIST,
  SERVER_ONLY_COLLECTIONS as SERVER_ONLY_COLLECTION_LIST,
} from "./src/lib/collections.js";
import pg from "pg";
// vite is imported dynamically below — only in development, never in production
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cron from "node-cron";
// firebase-admin 14 NAMESPACE API'sini KALDIRDI (admin.auth(), admin.firestore(),
// admin.storage(), admin.credential artik yok) — moduler alt-yol importlari sart.
import { initializeApp, cert, type Credential, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore, type Timestamp } from "firebase-admin/firestore";
// Mikro kolon eslestirme: projenin en tehlikeli mantigi, artik TESTLI tek
// kaynakta (src/lib/mikroKolon.ts, 10 test). Eskiden startServer()
// icinde, 9000 satirin ortasinda ve testsizdi.
import { createHmac, createHash, randomUUID, timingSafeEqual } from "crypto";
import { generateSecret as totpSecret, generateURI as totpURI, verifySync as totpVerifyRaw } from "otplib";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import Stripe from "stripe";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";

dotenv.config();

// ── Global fetch varsayılan timeout (P11) ───────────────────────────────────
// Node fetch varsayılanı SÜRESİZ bekler; asılı bir upstream (Mikro/Shopify/
// Paraşüt/Luca/GIB/kargo...) o isteği/cron'u sonsuza kadar bloke edebilir.
// Açık `signal` verilmemiş her çağrıya 30 sn'lik bir timeout ekliyoruz; kendi
// signal'ını verenlere (ör. TCMB 8 sn) dokunmuyoruz.
const _rawFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (init && init.signal) return _rawFetch(input, init);
  return _rawFetch(input, { ...init, signal: AbortSignal.timeout(30000) });
}) as typeof fetch;

// ── Zorunlu prod yapılandırması: hızlı-başarısız (P14) ──────────────────────
// Eksik kritik config'le SESSİZCE bozuk çalışmak yerine açılışta dur. Sadece
// gerçekten zorunlu olanları kontrol ederiz (sağlıklı prod bunları zaten taşır).
if (process.env.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL (uygulama /api/db olmadan calisamaz)');
  // Oturum/MFA HMAC secret'i her ikisi de yoksa SABİT kamuya-acik sabite duser
  // (createHash(... 'cetpa-mfa-fallback')) -> token'lar forge edilebilir (P2).
  if (!process.env.SESSION_TOKEN_SECRET && !process.env.FIREBASE_PRIVATE_KEY) {
    problems.push('SESSION_TOKEN_SECRET veya FIREBASE_PRIVATE_KEY (yoksa oturum/MFA imzasi sabit sabite duser)');
  }
  if (problems.length) {
    console.error('KRITIK: zorunlu prod yapilandirmasi eksik, cikiliyor:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
}

// ── Zod validation schemas & helper ────────────────────────────────────────
function validate<T>(schema: z.ZodSchema<T>, data: unknown, res: Response): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    res.status(400).json({ success: false, error: 'Geçersiz istek gövdesi.', details: result.error.flatten() });
    return null;
  }
  return result.data;
}

// E-posta gönderim şeması
const EmailSendSchema = z.object({
  to:      z.string().email('Geçerli bir e-posta adresi girin.'),
  subject: z.string().min(1, 'Konu boş olamaz.').max(200),
  html:    z.string().min(1, 'İçerik boş olamaz.'),
  from:    z.string().email().optional(),
  replyTo: z.string().email().optional(),
});




// AI chat şeması
const AiChatSchema = z.object({
  message:    z.string().min(1).max(4000),
  context:    z.string().max(8000).optional(),
  language:   z.enum(['tr', 'en']).optional(),
});

// ── Firebase Admin SDK ──────────────────────────────────────────────────────
// adminDb is assigned after the PgFirestore class definition below: PostgreSQL
// shim when DATABASE_URL is set, real Firestore otherwise (local-dev fallback).
let adminDb: PgFirestore | null = null;
let adminFirestoreFallback: Firestore | null = null;
// Gemini anahtar önbelleği (settings/aiConfig kaynaklı) — modül düzeyinde ki
// hem çözümleyici (resolveGeminiClient) hem de /api/db settings yazma yolu
// erişebilsin. UI'dan yeni anahtar kaydedilince invalidateGeminiKeyCache()
// çağrılır → 5 dk TTL beklenmeden anında etkir.
let geminiKeyCache: { key: string; model: string; ts: number } | null = null;
const invalidateGeminiKeyCache = () => { geminiKeyCache = null; };
// Watchdog'un günlük AI sağlık kontrolü — startServer içindeki resolver'lara
// erişim gerektirdiği için orada kurulur, modül-düzeyi watchdog buradan çağırır.
let aiHealthProbe: (() => Promise<{ ok: boolean; detail: string }>) | null = null;
const FIRESTORE_DB_ID = "ai-studio-d243947a-133d-4934-af2e-eff3bb6aeea7";
const PROJECT_ID = "gen-lang-client-0628151245";

try {
  let credential: Credential | undefined;

  // Option 1: explicit env-var credentials (VDS / any server without ADC)
  const fbEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const fbKey   = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (fbEmail && fbKey) {
    credential = cert({ projectId: PROJECT_ID, clientEmail: fbEmail, privateKey: fbKey });
    console.log("Firebase Admin: using FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY ✓");
  }
  // Option 2: GOOGLE_APPLICATION_CREDENTIALS file (local dev / Cloud Run ADC)
  // Falls through to ADC automatically when credential is undefined

  const adminApp: App = credential
    ? initializeApp({ credential, projectId: PROJECT_ID })
    : initializeApp({ projectId: PROJECT_ID });

  // v13'te adminApp.firestore() vardi; v14'te App uzerinde boyle bir metod yok.
  //
  // databaseId ARTIK ACIK IMZAYLA veriliyor: eskiden `.settings({ databaseId })`
  // ile gecirilliyordu ki bu hicbir zaman belgelenmis bir Firestore ayari
  // degildi. v14 `getFirestore(app, databaseId)` asiri yuklemesini sunuyor —
  // sessizce VARSAYILAN veritabanina baglanma ihtimalini tamamen kaldirir.
  // Yanlis veritabani, hicbir hata vermeden bos/yanlis veri okumak demekti.
  adminFirestoreFallback = getFirestore(adminApp, FIRESTORE_DB_ID);
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
    // Halka açık formlara kimlik doğrulaması olmadan POST atılabilir (ör: demoRequests)
    if (req.method === 'POST' && req.path.startsWith('/api/db/')) {
      const coll = req.path.split('/')[3];
      if (coll && PUBLIC_WRITE_COLLECTIONS.has(coll)) {
        return next();
      }
    }
    res.status(401).json({ error: 'Missing Authorization header.' });
    return;
  }
  try {
    const decoded = await getAuth().verifyIdToken(token);
    (req as Request & { uid: string; userEmail?: string; emailVerified?: boolean }).uid = decoded.uid;
    (req as Request & { uid: string; userEmail?: string; emailVerified?: boolean }).userEmail = decoded.email;
    (req as Request & { uid: string; userEmail?: string; emailVerified?: boolean }).emailVerified = decoded.email_verified === true;
    // Askıya alınmış kiracı firmanın kullanıcıları engellenir (süper-admin hariç).
    if (!isSuperAdmin(req)) {
      const cid = await getUserCompanyId(decoded.uid);
      if (await getCompanyStatus(cid) === 'suspended') {
        res.status(403).json({ error: 'Firma hesabınız askıya alınmıştır. Lütfen yönetici ile iletişime geçin.', code: 'COMPANY_SUSPENDED' });
        return;
      }
    }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/** Actor info extracted from an authenticated request — for audit logging. */
/**
 * Uygulamanin GECERLI rol listesi — TEK KAYNAK.
 *
 * Bu liste src/types.ts'teki UserRole enum'u ve src/lib/rbac.ts'teki AppRole
 * tipiyle birebir ayni olmak ZORUNDA. Daha once /api/admin/invite kendi
 * listesini elle tasiyordu ve uc uydurma rol iceriyordu (Accountant, Warehouse,
 * Viewer) — bunlarla davet edilen kullanici giris yapabiliyor ama RBAC onu
 * tanimadigi icin her yerde sessiz 403 aliyordu. Ayrica 7 gercek rol
 * (Logistics, Accounting, HR, Purchasing, Legal, Corporate, Quality) hic davet
 * edilemiyordu. Yeni rol eklenirken UC yer birlikte guncellenmeli:
 * types.ts UserRole, rbac.ts AppRole ve burasi.
 */
const APP_ROLES = [
  'Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'HR',
  'Purchasing', 'B2B', 'Dealer', 'Legal', 'Corporate', 'Quality',
] as const;

function reqActor(req: Request): { uid: string; email: string } {
  const r = req as Request & { uid?: string; userEmail?: string };
  return { uid: r.uid || 'system', email: r.userEmail || '' };
}

/** Giden e-posta HTML'ine gömülen kiracı kaynaklı metni güvenli hale getirir. */
function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/** Basit e-posta format kontrolü. */
function isValidEmail(e: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}

/** SSRF guard — yalnız public http(s) host'lara izin verir (iç ağ/metadata engeli). */
function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '169.254.169.254') return false;
  if (h.endsWith('.internal') || h.endsWith('.local')) return false;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('fc')) return false;
  return true;
}

// users/{uid} self-write'ta sunucu-kontrollü kimlik alanlarını koru.
// Cross-tenant escalation engeli: bir kullanıcı kendi users dokümanına
// {companyId:'kurban'} yazıp o firmanın verisine erişemesin. Admin değilse
// companyId/role/status client'tan gelse bile mevcut değere sabitlenir
// (yoksa tamamen düşürülür). Login profil senkronu bu alanları göndermez,
// dolayısıyla normal akış etkilenmez.
const PROTECTED_USER_FIELDS = ['companyId', 'role', 'status'] as const;
async function pinProtectedUserFields(
  uid: string, data: Record<string, unknown>, before: Record<string, unknown> | undefined,
  superAdmin = false,
): Promise<Record<string, unknown>> {
  if (superAdmin) return data; // SaaS operatörü: kiracılar arası taşıma dahil her şey
  const role = await getUserRole(uid);
  const out = { ...data };
  const sabitle = (f: string) => { if (before && f in before) out[f] = before[f]; else delete out[f]; };
  if (role !== 'Admin') {
    for (const f of PROTECTED_USER_FIELDS) sabitle(f);
    return out;
  }
  // KİRACI ADMİN'İ (2026-08-22 denetim bulgusu C7/C19):
  // Eskiden `if (role === 'Admin') return data;` — Admin HER alanı yazabiliyordu,
  // companyId dahil. Bir kiracının Admin'i kendi users/{uid} dokümanına
  // companyId: '<baska-kiraci>' yazıp o kiracının TÜM verisine geçebiliyordu
  // (getUserCompanyId bu alanı okuyor). role/status kendi kiracısı içinde
  // yönetilebilir; companyId ise yalnız süper-admin tarafından değiştirilir.
  sabitle('companyId');
  return out;
}

// ── Sunucu tarafı RBAC (rol bazlı erişim kontrolü) ───────────────────────────
// PostgreSQL göçüyle Firestore güvenlik kuralları kalktı; yetki artık burada
// uygulanır. Politika src/lib/rbac.ts'te (saf, test edilir); rol users/{uid}
// dokümanından okunur (60 sn önbellek).

const roleCache = new Map<string, { role: AppRole; exp: number }>();
async function getUserRole(uid: string): Promise<AppRole | null> {
  const cached = roleCache.get(uid);
  if (cached && cached.exp > Date.now()) return cached.role;
  if (!adminDb) return null;
  try {
    const snap = await adminDb.collection('users').doc(uid).get();
    const role = (snap.exists ? (snap.data()?.role as AppRole) : null) || null;
    if (role) roleCache.set(uid, { role, exp: Date.now() + 60_000 });
    return role;
  } catch { return null; }
}

/** Admin/Manager zorunlu middleware — /api/admin/* için. */
async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = (req as Request & { uid?: string }).uid;
  const role = uid ? await getUserRole(uid) : null;
  if (role && ADMIN_ROLES.includes(role)) { next(); return; }
  res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekir.' });
}

/**
 * Rol-bazlı uç koruması (2026-08-22 denetim bulgusu C20/C21/C22).
 *
 * requireAuth yalnız "giriş yapmış" demektir — B2B/Dealer (dış) roller dahil.
 * Bazı uçlar YALNIZ requireAuth ile korunuyordu ve RBAC'ta dar yetkili veriyi
 * (cari hareket, yaşlandırma, e-posta gönderimi) her role açıyordu.
 * Bu fabrika, bir koleksiyon için isAllowed(rol, coll, op) kuralını uca
 * uygular — böylece REST /api/db yolu ile özel uçlar AYNI politikayı paylaşır,
 * kopya bir yetki listesi oluşmaz.
 */
function requireCollectionAccess(coll: string, op: DbOp) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const uid = (req as Request & { uid?: string }).uid || '';
    if (isSuperAdmin(req) || await canAccessCollection(uid, coll, op)) { next(); return; }
    res.status(403).json({ error: 'Bu veri için yetkiniz yok.' });
  };
}
/** Yalnız iç personel (STAFF_ROLES) — dış roller (B2B/Dealer) giremez. */
async function requireStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = (req as Request & { uid?: string }).uid;
  const role = uid ? await getUserRole(uid) : null;
  if (isSuperAdmin(req) || (role && STAFF_ROLES.includes(role))) { next(); return; }
  res.status(403).json({ error: 'Bu işlem için personel yetkisi gerekir.' });
}

/** Koleksiyon+operasyon için kullanıcının yetkili olup olmadığını döner. */
async function canAccessCollection(uid: string, coll: string, op: DbOp): Promise<boolean> {
  return isAllowed(await getUserRole(uid), coll, op);
}

// ── Süper-admin (SaaS operatörü) — tüm kiracı firmaları yönetir ──────────────
// E-posta tabanlı, env ile yapılandırılır. Varsayılan: kurulum sahibi.
const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS || 'orcncetin@gmail.com')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
);
function isSuperAdmin(req: Request): boolean {
  // Yalnız doğrulanmış e-posta güvenilir: e-posta/şifre ile doğrulanmamış bir hesap
  // (örn. SUPER_ADMIN_EMAILS'teki bir adresi ön-kayıtla ele geçirme) yetki kazanamaz.
  const r = req as Request & { userEmail?: string; emailVerified?: boolean };
  if (r.emailVerified !== true) return false;
  return SUPER_ADMIN_EMAILS.has((r.userEmail || '').toLowerCase());
}
async function requireSuperAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (isSuperAdmin(req)) { next(); return; }
  res.status(403).json({ error: 'Bu işlem için süper-admin yetkisi gerekir.' });
}

// Kiracı firma durumu (active/suspended) — 60 sn önbellekli.
const companyStatusCache = new Map<string, { status: string; exp: number }>();
async function getCompanyStatus(cid: string): Promise<string> {
  const c = companyStatusCache.get(cid);
  if (c && c.exp > Date.now()) return c.status;
  let status = 'active';
  if (adminDb) {
    try {
      const snap = await adminDb.collection('companyStatus').doc(cid).get();
      if (snap.exists) status = (snap.data()?.status as string) || 'active';
    } catch { /* varsayılan: active */ }
  }
  companyStatusCache.set(cid, { status, exp: Date.now() + 60_000 });
  return status;
}

// ── PostgreSQL document store (Firestore replacement) ───────────────────────
// One generic `docs` table: (coll, id, data jsonb). The React client talks to
// /api/db/* through src/lib/dbClient.ts, which mimics the Firestore API.
// Realtime fan-out is in-process (single server) via an EventEmitter feeding
// the /api/db/stream SSE endpoint.

const pgPool: pg.Pool | null = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
  : null;

export let boss: PgBoss | null = null;


// ── Webhook Processors ───────────────────────────────────────────────────

async function processShopifyWebhook(topic: string, body: any) {
  if (!adminDb) return;
  try {
    if (topic === 'orders/create' || topic === 'orders/updated') {
      const shopifyOrderId = `#${body.order_number || body.id}`;
      const snap = await adminDb.collection('orders').where('shopifyOrderId', '==', shopifyOrderId).limit(1).get();
      const orderData = {
        shopifyOrderId,
        customerName: body.billing_address?.name || body.customer?.first_name + ' ' + body.customer?.last_name || 'Unknown',
        totalPrice: parseFloat(body.total_price || '0'),
        status: body.financial_status === 'paid' ? 'Processing' : 'Pending',
        shippingAddress: body.shipping_address?.address1 || '',
        updatedAt: pgServerTimestamp(),
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
        const cid = await serverTenantId(); // webhook: kullanıcı yok → sunucu-tarafı çözümleyici
        // FAIL-CLOSED (2026-08-25 denetimi): eskiden belirsizse ETİKETSİZ
        // yazılıyordu. Sunucunun her yerindeki kural "lenient"tir — etiketsiz
        // doküman HER kiracıya görünür (tenantWhere `OR NOT (data ? 'companyId')`,
        // rowVisible `return !dc || dc === streamCid`). Yani çok-kiracıda
        // Shopify'dan gelen her sipariş TÜM firmaların ekranında belirirdi.
        // Yanlış kiracıya yazmak da, herkese yazmak da kabul edilemez → hiç
        // yazma, GÜRÜLTÜLÜ başarısız ol.
        //
        // Burası bir pg-boss İŞ işleyicisidir (HTTP yanıtı yok, istek çoktan
        // ack'lendi) → doğru sinyal `throw`: iş başarısız olarak işaretlenir ve
        // pg-boss yeniden dener. Operatör env'i düzeltince sipariş KAYBOLMADAN
        // akar; kuyruk bu arada olayı tutar.
        // Tek-kiracıda serverTenantId() zaten o kiracıyı bulur (cids.size === 1),
        // yani bu dal ancak 2. müşteri eklenip env unutulduğunda çalışır.
        if (!cid) {
          throw new Error('[shopify/webhook] kiracı belirlenemedi — sipariş YAZILMADI. ' +
            "Çok-kiracılı kurulumda SERVER_TENANT_COMPANY_ID (veya MIKRO_CRON_COMPANY_ID) .env'e yazılmalı.");
        }
        await adminDb.collection('orders').add({
          ...orderData,
          companyId: cid,
          lineItems: (body.line_items || []).map((li: any) => ({
            title: li.title,
            quantity: li.quantity,
            price: parseFloat(String(li.price || '0')),
            sku: li.sku || '',
          })),
          createdAt: pgServerTimestamp(),
          source: 'shopify_webhook',
        });
        console.log(`Created Cetpa order from Shopify webhook ${shopifyOrderId}`);
      }
    }
    if (topic === 'orders/cancelled') {
      const shopifyOrderId = `#${body.order_number || body.id}`;
      const snap = await adminDb.collection('orders').where('shopifyOrderId', '==', shopifyOrderId).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({ status: 'Cancelled', updatedAt: pgServerTimestamp() });
        console.log(`Cancelled Cetpa order for Shopify ${shopifyOrderId}`);
      }
    }
    if (topic === 'orders/fulfillments_create' || topic === 'fulfillments/create') {
      const shopifyOrderId = `#${body.order_number || body.order_id}`;
      const trackingNumber = body.tracking_number || body.tracking_numbers?.[0] || null;
      const snap = await adminDb.collection('orders').where('shopifyOrderId', '==', shopifyOrderId).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({ status: 'Shipped', ...(trackingNumber && { trackingNumber }), updatedAt: pgServerTimestamp() });
        console.log(`Fulfilled Cetpa order ${shopifyOrderId}, tracking: ${trackingNumber}`);
      }
    }
  } catch (err) {
    console.error('Webhook Firestore write error:', err);
    throw err;
  }
}

/** Price config mirroring src/types/subscription.ts — kept in sync manually */
const STRIPE_PLAN_PRICES: Record<string, { monthly: number; yearly: number; name: string }> = {
  starter:      { monthly: 99900,  yearly: 999000,  name: 'Cetpa Başlangıç' },
  professional: { monthly: 249900, yearly: 2499000, name: 'Cetpa Profesyonel' },
  business:     { monthly: 499900, yearly: 4999000, name: 'Cetpa Business' },
};
// Amounts above are in kuruş (TRY minor unit, ×100)

async function processStripeWebhook(event: any) {
  if (!adminDb) return;
  // P5-1: "islendi" isareti handler'dan SONRA yazilir. Onceden ONCE yaziliyordu:
  // handler patlayinca throw -> pg-boss retry -> retry dedup'a takilip sessizce
  // donuyordu, yani odemesi alinan abonelik HIC aktiflesmiyordu ve hicbir yeniden
  // deneme bunu kurtaramiyordu. Eszamanli cift teslimat send() singletonKey'i ile
  // serialize edilir (asagida), bu yuzden isareti sona almak yaris acmaz.
  const evRef = adminDb.collection('stripeEvents').doc(event.id);
  try {
    if ((await evRef.get()).exists) return; // zaten BASARIYLA islenmis
  } catch (e) { console.warn('[Stripe webhook] idempotency okuma hatasi:', (e as Error).message); }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const { firebaseUid, plan, cycle } = session.metadata ?? {};
      if (!firebaseUid || !plan || !cycle) return;

      const now   = new Date();
      const end   = new Date(now);
      if (cycle === 'monthly') end.setMonth(end.getMonth() + 1);
      else end.setFullYear(end.getFullYear() + 1);

      const planPrices: any = STRIPE_PLAN_PRICES[plan];
      const amount = planPrices ? (cycle === 'monthly' ? planPrices.monthly / 100 : planPrices.yearly / 100) : 0;

      await adminDb.collection('subscriptions').doc(firebaseUid).set({
        plan, cycle, status: 'active', startDate: now.toISOString(), endDate: end.toISOString(),
        lastPayment: now.toISOString(), stripeCustomerId: session.customer as string ?? '',
        stripeSubscriptionId: session.subscription as string ?? '',
        maxUsers: plan === 'starter' ? 1 : plan === 'professional' ? 5 : plan === 'business' ? 20 : 999,
        currentUsers: 1,
      }, { merge: true });

      await adminDb.collection('payments').add({
        userId: firebaseUid, plan, cycle, amount, currency: 'TRY', status: 'paid',
        stripeSessionId: session.id, stripeCustomerId: session.customer ?? '', date: now.toISOString(),
        createdAt: pgServerTimestamp(),
      });
      console.log(`[Stripe] Subscription activated for uid=${firebaseUid} plan=${plan}/${cycle}`);
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object as any;
      const { firebaseUid } = sub.metadata ?? {};
      if (!firebaseUid) return;

      const statusMap: Record<string, string> = { active: 'active', past_due: 'past_due', canceled: 'cancelled', unpaid: 'past_due' };
      await adminDb.collection('subscriptions').doc(firebaseUid).set({ status: statusMap[sub.status] ?? sub.status }, { merge: true });
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as any;
      const { firebaseUid } = sub.metadata ?? {};
      if (!firebaseUid) return;

      await adminDb.collection('subscriptions').doc(firebaseUid).set({ status: 'cancelled', cancelledAt: new Date().toISOString() }, { merge: true });
      console.log(`[Stripe] Subscription cancelled for uid=${firebaseUid}`);
    }
  } catch (e) {
    console.error('[Stripe webhook] handler error:', e);
    throw e; // isaret YAZILMADI -> pg-boss retry'i gercekten yeniden calisir
  }
  // Buraya yalnizca handler BASARIYLA bittiyse gelinir -> simdi isaretle.
  try { await evRef.set({ type: event.type, processedAt: pgServerTimestamp() }); }
  catch (e) { console.warn('[Stripe webhook] islendi isareti yazilamadi:', (e as Error).message); }
}

async function processOutboundWebhook(data: any) {
  const { url, secret, event, payload } = data;
  // SSRF KAPISI (2026-08-25): `/api/webhooks/test` ucu isSafePublicUrl'den
  // geçiyordu ama GERÇEK gönderim geçmiyordu — yani kapı test yolunda kilitli,
  // asıl yolda açıktı. Admin/Manager `webhookConfigs`'e http://127.0.0.1:.../
  // ya da 169.254.169.254 (bulut metadata) yazıp sunucuya kendi iç ağına
  // istek attırabilirdi. Kuyruğa düşmüş eski kayıtlar da buradan geçer.
  if (!isSafePublicUrl(String(url ?? ''))) {
    console.warn(`[webhook] ${event} → ${url} ENGELLENDİ: public olmayan/geçersiz URL`);
    return; // throw ETME: pg-boss sonsuz retry'a girmesin, kalıcı bir hata bu
  }
  try {
    const bodyStr = JSON.stringify({ event, data: payload, sentAt: new Date().toISOString() });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['x-webhook-signature'] = createHmac('sha256', secret).update(bodyStr).digest('hex');
    const r = await fetch(url, { method: 'POST', headers, body: bodyStr });
    if (r.ok) console.log(`[webhook] ${event} → ${url} : ${r.status}`);
    else console.warn(`[webhook] ${event} → ${url} FAILED:`, r.statusText);
  } catch (e) {
    console.warn(`[webhook] ${event} → ${url} FAILED:`, (e as Error).message);
    throw e;
  }
}

async function initDocsTable(): Promise<void> {
  if (!pgPool) { console.warn('DATABASE_URL not set — /api/db routes disabled.'); return; }
  await pgPool.query(`CREATE TABLE IF NOT EXISTS docs (
    coll text NOT NULL,
    id   text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (coll, id)
  )`);
  // Kiracı filtresi indeksleri. PK (coll,id) yalnız koleksiyon önekini kapsar;
  // tenantWhere'in `data->>'companyId' = $2 OR NOT (data ? 'companyId')`
  // yüklemi indekssiz kalınca koleksiyonun TÜM satırları taranır. İki indeks
  // gerekli çünkü OR'un iki kolu farklı: eşitlik kolu ifade indeksinden,
  // "etiketsiz" kolu kısmi indeksten gelir (BitmapOr). Kısmi indeks backfill
  // sonrası neredeyse boş kalır — maliyeti yok denecek kadar az.
  // Hata boot'u DÜŞÜRMEZ: indeks bir optimizasyon, doğruluk koşulu değil.
  for (const ddl of [
    `CREATE INDEX IF NOT EXISTS idx_docs_coll_company ON docs (coll, (data->>'companyId'))`,
    `CREATE INDEX IF NOT EXISTS idx_docs_coll_untagged ON docs (coll) WHERE NOT (data ? 'companyId')`,
    `CREATE INDEX IF NOT EXISTS idx_docs_coll_user ON docs (coll, (data->>'userId'))`,
  ]) {
    try { await pgPool.query(ddl); }
    catch (e) { console.warn('docs indeks oluşturulamadı (devam ediliyor):', (e as Error).message); }
  }
  console.log('PostgreSQL docs table ready ✓');
  await initMikroTables();
  await initMfaTable();
  if (process.env.DATABASE_URL && !boss) {
    boss = new PgBoss(process.env.DATABASE_URL);

    // Hata logunu BOĞMA. pg-boss 12'de kuyruk yoksa her yoklama hata üretir;
    // ham console.error 2026-07'de service-err.log'u 1.6 GB'a çıkardı (15.044
    // aynı hata bloğu, 1 Temmuz'dan beri kesintisiz) ve her yoklama ayrıca
    // PostgreSQL'e başarısız bir sorgu attı. Aynı mesajı 5 dakikada bir kez
    // logla, tekrar sayısını da yaz.
    const bossHataSon = new Map<string, { t: number; n: number }>();
    boss.on('error', (error: unknown) => {
      const anahtar = (error as { message?: string })?.message ?? String(error);
      const simdi = Date.now();
      const onceki = bossHataSon.get(anahtar);
      if (onceki && simdi - onceki.t < 5 * 60_000) { onceki.n++; return; }
      const tekrar = onceki?.n ? ` (son 5 dk'da ${onceki.n} kez daha)` : '';
      bossHataSon.set(anahtar, { t: simdi, n: 0 });
      console.error('pg-boss error:', anahtar + tekrar);
    });

    await boss.start();

    // KUYRUKLARI ÖNCE OLUŞTUR. pg-boss 12'de work() kuyruğu kendiliğinden
    // yaratmaz; olmayan kuyruğa işçi bağlamak sonsuz "Queue does not exist"
    // hata döngüsü üretir. Bu üç işçi 2026-07 boyunca tam olarak bunu yaptı.
    // createQueue idempotent — zaten varsa sorun çıkarmaz.
    const kuyruklar = ['shopify-webhook', 'stripe-webhook', 'outbound-webhook'] as const;
    for (const q of kuyruklar) {
      try { await boss.createQueue(q); }
      catch (e) { console.warn(`pg-boss kuyruk oluşturulamadı (${q}):`, (e as Error).message); }
    }

    await boss.work('shopify-webhook', async (jobs: any) => {
      for (const job of jobs) await processShopifyWebhook(job.data.topic, job.data.body);
    });
    await boss.work('stripe-webhook', async (jobs: any) => {
      for (const job of jobs) await processStripeWebhook(job.data.event);
    });
    await boss.work('outbound-webhook', async (jobs: any) => {
      for (const job of jobs) await processOutboundWebhook(job.data);
    });
    console.log('pg-boss ready ✓ (kuyruklar: ' + kuyruklar.join(', ') + ')');
  }
}
// AYNA BAGIMLILIGI MODUL DUZEYINDE BAGLANIR - startServer'da DEGIL.
//
// `initDocsTable()` asagida MODUL YUKLENIRKEN cagriliyor (startServer'dan
// once) ve icinden `initMikroTables()` kosuyor. Init'i startServer'a koyunca
// o cagri `deps()` korumasina carpip hata firlatiyordu; asagidaki `.catch`
// da onu SESSIZ bir uyariya cevirip Mikro ayna tablolarinin HIC olusmamasina
// yol aciyordu. Lokalde DATABASE_URL olmadigi icin initDocsTable erken
// donuyor ve boot testi bunu GIZLIYORDU - hata yalniz canlida gorunurdu.
// Getter kullanildigi icin pgPool o an null olsa bile sorun yok.
initMikroMirror({ getPgPool: () => pgPool });
// Cron'lar: eskiden bu noktada modul duzeyinde kayitliydi, oyle kaldi
// (kayit sirasi ve zamanlama davranisi birebir korunsun diye).
initCrons({ getAdminDb: () => adminDb, tenantSnap, serverTenantId, pgServerTimestamp });

initDocsTable().catch(e => console.warn('PostgreSQL init failed:', (e as Error).message));

// ── Kendi TOTP 2FA katmanımız (Firebase MFA Blaze gerektirdiği için) ─────────
// Secret'lar yalnız bu server-only tabloda; /api/db hiçbir zaman expose etmez.
async function initMfaTable(): Promise<void> {
  if (!pgPool) return;
  await pgPool.query(`CREATE TABLE IF NOT EXISTS mfa_secrets (
    uid text PRIMARY KEY,
    secret text NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  console.log('MFA (TOTP) tablosu hazır ✓');
}

// MFA doğrulama çerezi için imzalama anahtarı (restart'larda stabil olmalı).
const MFA_COOKIE_SECRET = process.env.MFA_COOKIE_SECRET
  || createHash('sha256').update(process.env.FIREBASE_PRIVATE_KEY || 'cetpa-mfa-fallback').digest('hex');
const MFA_COOKIE = '__cetpa_mfa';
const MFA_COOKIE_MAX_AGE = 5 * 24 * 60 * 60 * 1000; // 5 gün (session ile aynı)

/** uid + exp için HMAC-imzalı token üretir. */
function signMfaToken(uid: string): string {
  const exp = Date.now() + MFA_COOKIE_MAX_AGE;
  const payload = Buffer.from(`${uid}|${exp}`).toString('base64url');
  const sig = createHmac('sha256', MFA_COOKIE_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
/** Token geçerli + uid eşleşiyor + süresi dolmamış mı? */
function verifyMfaToken(token: string | null, uid: string): boolean {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = createHmac('sha256', MFA_COOKIE_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return false;
  try {
    const [tUid, tExp] = Buffer.from(payload, 'base64url').toString().split('|');
    return tUid === uid && Number(tExp) > Date.now();
  } catch { return false; }
}

// ── Kendi HMAC oturum token'ımız (Firebase session cookie yerine) ───────────
// requireAuth uid'yi zaten lokal verifyIdToken ile doğruladığından, oturumu
// kendi imzalı token'ımızla taşırız: SSE doğrulaması TAMAMEN LOKAL olur,
// Firebase'e çalışma-zamanı ağ çağrısı kalmaz (createSessionCookie/
// verifySessionCookie gitti). MFA'dan ayrı anahtar.
const SESSION_TOKEN_SECRET = process.env.SESSION_TOKEN_SECRET
  || createHash('sha256').update((process.env.FIREBASE_PRIVATE_KEY || 'cetpa-session-fallback') + ':session').digest('hex');
const SESSION_TOKEN_MAX_AGE = 5 * 24 * 60 * 60 * 1000; // 5 gün

function signSessionToken(uid: string): string {
  const exp = Date.now() + SESSION_TOKEN_MAX_AGE;
  const payload = Buffer.from(`${uid}|${exp}`).toString('base64url');
  const sig = createHmac('sha256', SESSION_TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
/** Token geçerli + süresi dolmamışsa uid döner, yoksa null. */
function verifySessionTokenUid(token: string | null): string | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', SESSION_TOKEN_SECRET).update(payload).digest('base64url');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const [tUid, tExp] = Buffer.from(payload, 'base64url').toString().split('|');
    return Number(tExp) > Date.now() ? tUid : null;
  } catch { return null; }
}

// Kullanıcının MFA durumu (60sn önbellek).
const mfaStatusCache = new Map<string, { enabled: boolean; exp: number }>();
async function userHasMfa(uid: string): Promise<boolean> {
  const c = mfaStatusCache.get(uid);
  if (c && c.exp > Date.now()) return c.enabled;
  if (!pgPool) return false;
  try {
    const { rows } = await pgPool.query('SELECT enabled FROM mfa_secrets WHERE uid = $1', [uid]);
    const enabled = !!rows[0]?.enabled;
    mfaStatusCache.set(uid, { enabled, exp: Date.now() + 60_000 });
    return enabled;
  } catch { return false; }
}

/** Çerez başlığından ada göre değer okur (modül düzeyi — startServer dışındaki
 *  middleware'ler de kullanabilsin). */
function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** MFA açık kullanıcı için doğrulanmış oturum çerezi ister; MFA kapalıysa geçer.
 *  Modül düzeyinde — hem /api/db hem de bağımsız mutasyon rotaları kullanabilsin.
 *  (Önceden yalnız /api/db bloğu içinde tanımlıydı; para/stok yazan Mikro/lojistik/
 *  upload rotaları MFA'sız kalıyordu.) */
async function requireMfaVerified(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = (req as Request & { uid?: string }).uid || '';
  if (!(await userHasMfa(uid))) { next(); return; }
  if (verifyMfaToken(parseCookie(req.headers.cookie, MFA_COOKIE), uid)) { next(); return; }
  res.status(403).json({ error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true });
}


/** "Orçun Çetin" → "Orçun Ç." — kimliksiz takip sayfasında müşterinin kendi
 *  siparişi olduğunu teyit etmesine yeter, tam adı ifşa etmez. */
function maskName(name?: string): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(' ')} ${parts[parts.length - 1][0]}.`;
}

/** Tam adresi kimliksiz uca vermeyip yalnız son iki bileşeni (ilçe, il) döner.
 *  Müşteri doğru şehre gittiğini görür; sokak/kapı/daire bilgisi dışarı çıkmaz. */
function maskAddress(addr: unknown): string | null {
  if (typeof addr !== 'string' || !addr.trim()) return null;
  const parts = addr.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 2) return parts.join(', ') || null;
  return parts.slice(-2).join(', ');
}



// ── Çoklu kiracı izolasyonu (companyId / userId kapsamı) ─────────────────────
// İş verisi koleksiyonları companyId ile, kullanıcı verisi userId ile izole
// edilir. Diğerleri (settings global, users RBAC, append-only loglar) filtresiz.
// Sınıflandırma src/lib/collections.ts'te — server.ts ve backfill scripti aynı
// kaynaktan okur (liste iki yerde elle kopyalanınca 2026-07'de kaydı, bkz. dosya
// başlığı). Yeni koleksiyon eklerken YALNIZ o dosyayı düzenle.
const TENANT_COLLECTIONS = new Set(TENANT_COLLECTION_LIST);
const USER_SCOPED_COLLECTIONS = new Set(USER_SCOPED_COLLECTION_LIST);
const SERVER_ONLY_COLLECTIONS = new Set(SERVER_ONLY_COLLECTION_LIST);
// Firma-bazlı izole edilen ayar anahtarları (settings/{key}). Yalnız UI/config —
// ERP/email/iyzico gibi deployment-seviyesi creds GLOBAL kalır (server cron/API okur).
// docs tablosu PK (coll,id) olduğu için id companyId ile namespace'lenir: `${cid}__{key}`.
const PER_COMPANY_SETTINGS = new Set(['app', 'erpHub', 'workingCapital', 'companyProfile', 'gib']);

// Kullanıcının firma kimliği: users/{uid}.companyId, yoksa uid (sahip = kendi firması).
const companyIdCache = new Map<string, { cid: string; exp: number }>();
async function getUserCompanyId(uid: string): Promise<string> {
  const c = companyIdCache.get(uid);
  if (c && c.exp > Date.now()) return c.cid;
  let cid = uid;
  if (adminDb) {
    try {
      const snap = await adminDb.collection('users').doc(uid).get();
      cid = (snap.exists ? (snap.data()?.companyId as string) : '') || uid;
    } catch { /* uid fallback */ }
  }
  companyIdCache.set(uid, { cid, exp: Date.now() + 60_000 });
  return cid;
}

// İstek bağlamında çağıranın firması (sunucu-tarafı doğrudan yazımlara companyId
// enjekte etmek için — /api/db dışı adminDb.collection().add/set çağrıları
// injectTenant'ı atlar; bunlar bu helper ile etiketlenir). getUserCompanyId 60sn
// cache'li, döngü içinde çağrılsa da ucuz.
/**
 * Kiracı-filtreli "snapshot" — `adminDb.collection(coll).get()` ile AYNI
 * şekilde (docs[].id / data() / ref) döner ama YALNIZ verilen kiracının
 * (+ etiketsiz legacy) kayıtlarını içerir.
 *
 * NEDEN (2026-08-22 denetim bulgusu C10): on iki ayrı yerde
 * `adminDb.collection('inventory'|'leads').get()` TÜM kiracıları okuyup
 * SKU/VKN/isim eşleşmesiyle yazıyordu. Saatlik Mikro cron'u, A kiracısıyla
 * aynı SKU'ya sahip B kiracısının ürününü bulup ÜSTÜNE companyId=A yazıyor
 * (ele geçirme) ve stok/maliyetini eziyordu. Import uçları da aynı.
 * Bu yardımcı, mevcut `for (const d of snap.docs)` döngülerine dokunmadan
 * okumayı kiracıya indirger.
 */
async function tenantSnap(coll: string, cid: string, daralt?: DocDaralt): Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown>; ref: PgDocRef }> }> {
  if (!adminDb) return { docs: [] };
  const rows = await loadCompanyDocs(coll, cid, daralt);
  return {
    docs: rows.map(r => {
      const { id, ...data } = r as Record<string, unknown> & { id: string };
      return { id: String(id), data: () => data, ref: adminDb!.collection(coll).doc(String(id)) };
    }),
  };
}

/**
 * Kiracı-farkında deterministik Mikro doc id'si (2026-08-22 denetim bulgusu C11).
 *
 * Import'lar dokümanı Mikro kodundan türetilmiş SABİT id ile yazıyordu:
 * `mikro-<sku>`, `mikro-depo-<no>`, `mikro-<kod>`. docs tablosunun PK'sı
 * (coll, id) — kiracı kolonu YOK. İki kiracı da kendi Mikro'sundan "depo 1"i
 * import edince ikisi de `warehouses/mikro-depo-1`e yazıyor; ikincinin
 * merge:true yazımı birincinin dokümanını (companyId dahil) ELE GEÇİRİYOR.
 *
 * Çözüm: id'ye kısa bir kiracı etiketi gir — `mikro-<tag8>-<kod>`. Ama MEVCUT
 * kiracının verisi çiftlenmesin: bu kiracıya ait (ya da etiketsiz legacy) eski
 * biçimli `mikro-<kod>` dokümanı zaten varsa ONU kullanmaya devam et. Bu
 * karar import başına TEK sorguyla (loadCompanyDocs) alınır; satır başına
 * ek okuma yok.
 */
function tenantTag(cid: string): string {
  return createHash('sha1').update(cid).digest('hex').slice(0, 8);
}
/**
 * Elde ZATEN bulunan doküman id'lerinden çözücü kurar — ek sorgu YOK.
 *
 * Çağıranların çoğu aynı koleksiyonu birkaç satır sonra `tenantSnap` ile
 * tekrar çekiyordu; iki tam gövde taraması (SELECT id, data) tek istekte
 * yapılıyordu. Zaten okunmuş id'ler varsa bunu kullan.
 */
function mikroIdCozucuIds(ids: Iterable<string>, cid: string): (anahtar: string) => string {
  const eskiBicim = new Set<string>();
  for (const raw of ids) {
    const id = String(raw);
    if (id.startsWith('mikro-')) eskiBicim.add(id);
  }
  const onek = `mikro-${tenantTag(cid)}-`;
  return (anahtar: string) => {
    const eski = `mikro-${anahtar}`;
    return eskiBicim.has(eski) ? eski : onek + anahtar;
  };
}

async function mikroIdCozucu(coll: string, cid: string): Promise<(anahtar: string) => string> {
  try {
    // Yalnız id gerekiyor — gövdeler okunmuyor.
    return mikroIdCozucuIds((await loadCompanyDocs(coll, cid)).map(r => String((r as { id: string }).id)), cid);
  } catch {
    /* okunamazsa yeni biçime düş — veri ezmekten güvenli */
    return mikroIdCozucuIds([], cid);
  }
}

/**
 * URL'den gelen bir doküman id'sini SAHİPLİK denetiminden geçirerek okur.
 *
 * `/api/db/*` yolunda sahiplik `ownsDoc` ile zorlanıyor, ama özel uçlar
 * (mutabakat, cari-hareket, makbuz…) id'yi doğrudan URL'den alıp kendi
 * kontrolünü elle yazıyordu — her biri "etiketsiz legacy kaydı kim görebilir"
 * kuralını yeniden ve biraz farklı karara bağlıyordu (2026-08-22 denetim
 * bulgusu). Tek yardımcı: yabancı kiracıda `null` döner; çağıran 404 verir,
 * böylece kaydın VARLIĞI bile sızmaz.
 */
async function sahipliDoc(
  req: Request, coll: string, id: string,
): Promise<Record<string, unknown> | null> {
  if (!adminDb) return null;
  const snap = await adminDb.collection(coll).doc(id).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  const dc = (d.companyId as string) || '';
  // Etiketsiz (companyId'siz) eski kayıt: /api/db'deki ownsDoc ile AYNI
  // hoşgörü — göç öncesi veriyi erişilemez kılmamak için.
  if (dc && dc !== await reqCompanyId(req)) return null;
  return d;
}

/**
 * İsteği yapan kullanıcının KİRACI kimliği. Import/yazma yollarında damga
 * olarak HER ZAMAN bu kullanılır — ham `uid` DEĞİL.
 *
 * NEDEN (2026-08-22 denetim bulgusu C12/C18/C23): 7 import ucunda
 * `companyId = uid` yazılıyordu. Firmanın kurucusu için ikisi aynı olduğundan
 * hata yıllarca görünmedi; ama DAVETLE katılmış bir Admin/Accounting için
 * uid ≠ companyId'dir. Onun çalıştırdığı import firmanın mevcut kayıtlarını
 * "yabancı" sayıp tüm stok/cariyi GÖRÜNMEZ bir hayalet kiracıya yeniden
 * yazıyordu — kullanıcı "import çalıştı" görüyor, ekranlar boş kalıyordu.
 */
const reqCompanyId = (req: Request): Promise<string> =>
  getUserCompanyId((req as Request & { uid?: string }).uid || '');

// Kullanıcı oturumu OLMAYAN sunucu bağlamı (webhook) için kiracı çözümleyici:
// açık env → tek tenant → '' (çok-kiracıda belirsiz; etiketsiz bırakılır, uyarılır).
async function serverTenantId(): Promise<string> {
  const env = process.env.SERVER_TENANT_COMPANY_ID || process.env.MIKRO_CRON_COMPANY_ID;
  if (env) return env;
  if (!adminDb) return '';
  try {
    const snap = await adminDb.collection('users').get();
    const cids = new Set(snap.docs.map(d => (d.data().companyId as string) || d.id));
    if (cids.size === 1) return [...cids][0];
  } catch { /* düş */ }
  return '';
}

// Bir koleksiyonun YALNIZ çağıranın firmasına (veya etiketsiz legacy'ye) ait
// dokümanlarını getirir — filtreyi PG'ye iter (P8/P9). Tüm koleksiyonu belleğe
// çekip JS'te elemenin yerine geçer; "lenient" anlam (companyId eşleşir VEYA
// companyId yok) korunur, rapor sayıları değişmez. pgPool yoksa shim'e düşer.
/**
 * `daralt` — SQL tarafında ek süzme/sıralama/tavan (yalnız pgPool yolunda).
 *
 * Varsayılan davranış (verilmezse) DEĞİŞMEZ: koleksiyonun tamamı. Ama bir
 * rapor ucu "yalnız açık siparişlerin en yenisi 500 tanesi" istiyorsa, bunu
 * tüm koleksiyonu Node'a çekip JS'te süzerek yapmak zorunda kalmasın
 * (code-review: /api/aging kiracı düzeltmesiyle birlikte LIMIT'i kaybetmişti).
 * `alanDurum`/`siralaAlan` KOD İÇİNDE sabit verilir — istemciden gelmez.
 */
type DocDaralt = {
  /** data->>'status' bu kümede olsun. */
  durumlar?: string[];
  /** data->>'<alan>' DESC sırala (metinsel; ISO tarih ve epoch için doğru sıra). */
  siralaAlanDesc?: string;
  tavan?: number;
};

async function loadCompanyDocs(
  coll: string, cid: string, daralt?: DocDaralt,
): Promise<Array<Record<string, unknown>>> {
  if (pgPool) {
    const params: unknown[] = [coll, cid];
    let sql = "SELECT id, data FROM docs WHERE coll = $1 AND (data->>'companyId' = $2 OR NOT (data ? 'companyId'))";
    if (daralt?.durumlar?.length) {
      params.push(daralt.durumlar);
      sql += ` AND data->>'status' = ANY($${params.length}::text[])`;
    }
    if (daralt?.siralaAlanDesc) {
      params.push(daralt.siralaAlanDesc);
      sql += ` ORDER BY data->>$${params.length} DESC`;
    }
    if (daralt?.tavan) {
      params.push(daralt.tavan);
      sql += ` LIMIT $${params.length}`;
    }
    const { rows } = await pgPool.query(sql, params);
    return rows.map(r => ({ id: r.id, ...(r.data as Record<string, unknown>) }));
  }
  if (!adminDb) return [];
  const snap = await adminDb.collection(coll).get();
  let out = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>))
    .filter(x => { const dc = x.companyId as string | undefined; return !dc || dc === cid; });
  // Firestore yedek yolunda aynı daraltma JS'te (lokal dev; veri kümesi küçük).
  if (daralt?.durumlar?.length) {
    const set = new Set(daralt.durumlar);
    out = out.filter(x => set.has(String(x.status ?? '')));
  }
  if (daralt?.siralaAlanDesc) {
    const k = daralt.siralaAlanDesc;
    out = out.sort((a, b) => String(b[k] ?? '').localeCompare(String(a[k] ?? '')));
  }
  if (daralt?.tavan) out = out.slice(0, daralt.tavan);
  return out;
}

// adminDb'nin ORNEKLENDIGI yer. Shim'in kendisi ve NEDEN oyle oldugu
// src/server/pgShim.ts'te — aciklamayi TEK yerde tut, yoksa biri degisince
// digeri bayatlar (2026-08-24 code-review bulgusu).
//
// eslint-disable KALDIRILDI: `no-explicit-any` muafiyeti shim SINIFLARI icindi,
// onlar pgShim.ts'e tasindi. Dosya-ici bir disable o noktadan SONUNA kadar
// gecerlidir; birakilsaydi server.ts'in kalan ~9.600 satirinda (yani cogu yeni
// duzenlemenin indigi rota tanimlarinda) her yeni `any` sessizce serbest
// kalirdi. Olculdu: 1011'den sonra hic any-uyarisi yoktu, yani hicbir seyi
// bastirmiyordu ama kapsami tum dosyaya yayilmisti.
initPgShim({ getPgPool: () => pgPool });

adminDb = pgPool
  ? new PgFirestore(pgPool)
  : (adminFirestoreFallback as unknown as PgFirestore | null);
console.log(pgPool ? 'adminDb → PostgreSQL shim ✓' : 'adminDb → Firestore fallback (DATABASE_URL yok)');

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

// Belirli bir tarih için kuru DOĞRUDAN TCMB'nin tarihsel arşivinden çeker
// (kendi arşivimizi tutmak yerine — TCMB arşivi 1996'ya kadar geri gider, bizim
// arşiv ise yalnız bugünden ileri birikebilirdi). Hafta sonu/tatilde o günün
// XML'i yayınlanmadığından en yakın önceki iş gününe (7 güne kadar) kayar.
// Sonuç bellekte cache'lenir — tarihsel kur asla değişmez, sonsuz cache güvenli.
const tcmbHistoricalCache = new Map<string, { USD: number; EUR: number }>();
async function fetchTCMBRateForDate(dateStr: string): Promise<{ USD: number; EUR: number; date: string } | null> {
  const d = new Date(`${dateStr}T12:00:00Z`);
  for (let i = 0; i < 7; i++) {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const key = `${yyyy}-${mm}-${dd}`;
    const cached = tcmbHistoricalCache.get(key);
    if (cached) return { ...cached, date: key };
    const url = `https://www.tcmb.gov.tr/kurlar/${yyyy}${mm}/${dd}${mm}${yyyy}.xml`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/xml, text/xml' }, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const xml = await res.text();
        const usd = parseTCMBRate(xml, 'USD', 'ForexSelling');
        const eur = parseTCMBRate(xml, 'EUR', 'ForexSelling');
        if (usd && eur) {
          const rates = { USD: usd, EUR: eur };
          tcmbHistoricalCache.set(key, rates);
          return { ...rates, date: key };
        }
      }
    } catch { /* sonraki (önceki) güne dene */ }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return null;
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
//
// ⚠️ İKİ FARKLI DAĞITIM MODELİ (2026-07-27, resmi Postman koleksiyonundan doğrulandı):
//
//  1) LOKAL Jump (V16/V17 sunucuya kurulu — BİZİM DURUMUMUZ):
//     Base: http://localhost:8094/Api/APIMethods   (V16 => 8084)
//     Kimlik: Authorization header YOK (215/215 istekte yok). Kimlik yalnız
//     gövdedeki {Mikro:{FirmaKodu,CalismaYili,KullaniciKodu,Sifre}} ile taşınır.
//     Alias/ApiKey bu modda kullanılmaz (APILogin dışında).
//
//  2) JumpBulut (bulut gateway): https://jumpbulutapigw.mikro.com.tr/ApiJB/ApiMethods
//     Kimlik: onlinekullanici.mikro.com.tr'den OIDC bearer token + Alias.
//     NOT: bu host Cloudflare arkasında; 8084/8094 portlarını PROXY'LEMEZ.
//
// Mod, MIKRO_API_URL'in host'undan otomatik seçilir (localhost/127.0.0.1/özel IP
// => lokal mod: token alma adımı ATLANIR). Gerekirse MIKRO_LOCAL=0/1 ile ezilir.
async function saklamaSuresiUygula(): Promise<Array<{ coll: string; silinen: number }>> {
  const sonuc: Array<{ coll: string; silinen: number }> = [];
  if (!pgPool) return sonuc;
  for (const { coll, gun } of SAKLAMA_KURALLARI) {
    try {
      // updated_at kolonu uzerinden: dokuman icindeki timestamp bicimleri
      // (Firestore Timestamp / ISO string / epoch) tutarsiz olabiliyor,
      // updated_at ise her yazimda sunucu tarafindan set ediliyor.
      const { rowCount } = await pgPool.query(
        `DELETE FROM docs WHERE coll = $1 AND updated_at < now() - ($2 || ' days')::interval`,
        [coll, String(gun)],
      );
      if (rowCount) console.log(`[saklama] ${coll}: ${rowCount} kayit silindi (>${gun} gun)`);
      sonuc.push({ coll, silinen: rowCount ?? 0 });
    } catch (e) {
      console.error(`[saklama] ${coll} temizlenemedi:`, (e as Error).message);
      sonuc.push({ coll, silinen: -1 });   // -1 = hata, bekci bunu gorur
    }
  }
  return sonuc;
}

// Gunde bir, bekciden once (bekci sonucu raporlayabilsin).
cron.schedule('15 8 * * *', () => { void saklamaSuresiUygula(); });
// Açılışta bir kez: sunucu dolu diskle ayağa kalkmışsa hemen haber ver.

/** Bekçiyi koştur, BOZUK kontrol varsa e-posta at (2026-07-28).
 *  Tamamen kod — AI/token maliyeti YOK. Sessizlik = iyi haber:
 *  her şey yolundaysa posta GÖNDERİLMEZ (gürültü olmasın).
 *  Gerekli env: RESEND_API_KEY + OPS_ALERT_EMAIL (yoksa REPORT_RECIPIENT_EMAIL).
 *  OPS_ALERT_ALWAYS=true dersen her gün özet gelir (bozuk olmasa da). */
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
      timestamp:  pgServerTimestamp(),
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
// Değişiklik denetimi yapılacak hassas koleksiyonlar (before/after diff).
const AUDITED_COLLECTIONS = new Set(['orders', 'leads', 'inventory', 'users', 'settings', 'priceLists', 'quotations']);
// Silme (DELETE) ve düzenleme her zaman loglanır; sadece gürültülü/efemeral
// koleksiyonlar audit dışı tutulur (presence, bildirim, kuyruk vb.).
const AUDIT_DENYLIST = new Set([
  'auditLog', 'notifications', 'presence', 'workflowTasks', 'userOnboarding',
  'mikroSyncQueue', 'syncRetry', 'chatMessages', 'sessions', 'exchangeRates',
]);
const shouldAudit = (coll: string) => !AUDIT_DENYLIST.has(coll);
// Gürültü/PII azaltmak için diff dışı tutulan alanlar.
const DIFF_IGNORE = new Set(['updatedAt', 'mikroSyncedAt', 'lastLogin', 'createdAt', 'timestamp', 'device', 'photoURL']);

type FieldDiff = Record<string, { from: unknown; to: unknown }>;
/** İki dokümanın üst-seviye alan farkını döner (en çok 20 alan). */
function computeFieldDiff(before: Record<string, unknown>, after: Record<string, unknown>): FieldDiff {
  const diff: FieldDiff = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  let n = 0;
  for (const k of keys) {
    if (DIFF_IGNORE.has(k) || n >= 20) continue;
    const a = before?.[k], b = after?.[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      // Uzun değerleri kırp; hassas alanları maskele
      const clip = (v: unknown) => {
        if (typeof v === 'string' && v.length > 120) return v.slice(0, 120) + '…';
        return v;
      };
      diff[k] = { from: clip(a), to: clip(b) };
      n++;
    }
  }
  return diff;
}

async function writeAuditLog(
  actor:   { uid: string; email: string },
  action:  string,
  details: string,
  diff?:   FieldDiff
): Promise<void> {
  if (!adminDb) return;
  try {
    await adminDb.collection('auditLog').add({
      action,
      details,
      ...(diff && Object.keys(diff).length ? { diff } : {}),
      userId:    actor.uid,
      // Kullanıcının uid'i DEĞİL, ait olduğu firmanın id'si. Tek-kullanıcılı
      // hesapta ikisi aynıdır; bir firmaya bağlı çalışanda FARKLIDIR ve uid
      // yazmak satırı firmanın denetim görünümünden düşürür (2026-07-30).
      companyId: await getUserCompanyId(actor.uid),
      userName:  actor.email || 'Sunucu',
      userEmail: actor.email,
      source:    'server',
      timestamp: pgServerTimestamp(),
    });
  } catch (e) {
    console.warn('auditLog write failed:', e);
  }
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
  // Bekciyi burada baslat: `pgPool`/`adminDb` bu noktada atanmis oluyor.
  // Modul yuklenirken degil BURADA cagriliyor - cron'lar erken kurulup
  // veritabani hazir olmadan kosmasin.
  // Mikro istemcisi de burada baglanir (bkz. initOpsWatchdog gerekcesi):
  // `adminDb` bu noktada atanmis oluyor.
  // INIT YERI KURALI (2026-08-24, D4 refactor):
  // Bir modulun init'i, TUKETICILERINDEN HERHANGI BIRI modul yuklenirken
  // kosabiliyorsa MODUL DUZEYINDE cagrilmali; aksi halde startServer icinde.
  // mikroMirror bu yuzden asagida, modul duzeyinde baglaniyor: `initDocsTable()`
  // modul yuklenirken kosuyor ve icinden `initMikroTables()` cagiriyor.
  // opsWatchdog ve mikroClient icin startServer yeterli - onlarin tuketicileri
  // yalniz cron'lar ve rotalar (ikisi de olay dongusu bosaldiktan sonra).
  // Yanlis yer SESSIZ kirilma uretir: deps() hatasi bir .catch'e dusup
  // console.warn olur ve lokal boot testi bunu goremez (lokalde DATABASE_URL yok).
  initMikroClient({ getAdminDb: () => adminDb });

  initOpsWatchdog({
    getPgPool: () => pgPool as never,
    getAdminDb: () => adminDb,
    pgServerTimestamp,
    getMikroCreds,
    getCachedExchangeRates: () => cachedExchangeRates,
    getAiHealthProbe: () => aiHealthProbe,
  });

  const app = express();
  const PORT = parseInt(process.env.PORT || '5173', 10);
  const isProd = process.env.NODE_ENV === 'production';

  // Trust the first proxy (nginx/Cloudflare/IIS ARR) so express-rate-limit reads real IP
  app.set('trust proxy', 1);

  // ── HTTP metod tünelleme (IIS WebDAV geçici çözümü) ─────────────────────────
  // Öndeki IIS reverse-proxy'nin WebDAV modülü PUT/PATCH/DELETE fiillerini
  // uygulamaya ulaşmadan 403 ile kesiyor (POST/GET geçiyor). İstemci
  // (src/lib/dbClient.ts) bu metotları POST + X-HTTP-Method-Override başlığıyla
  // tünelliyor; burada gerçek metoda geri yazıyoruz (yönlendirmeden ÖNCE).
  // Kalıcı çözüm: deploy/windows/web.config'de WebDAV modülünü kaldırmak.
  // ÖZEL başlık adı (X-Cetpa-Method) kullanılıyor: IIS, bilinen
  // "X-HTTP-Method-Override" başlığını KENDİSİ tanıyıp isteği o metoda göre
  // WebDAV filtresiyle 403'lüyor. Özel/bilinmeyen başlığı IIS es geçer, POST
  // olarak Node'a iletir; gerçek metoda yalnız burada geri yazılır.
  app.use((req, _res, next) => {
    const override = req.headers['x-cetpa-method'];
    if (req.method === 'POST' && typeof override === 'string') {
      const m = override.toUpperCase();
      if (m === 'PATCH' || m === 'PUT' || m === 'DELETE') req.method = m;
    }
    next();
  });

  // ── İstek kimliği (P16: correlation ID) ─────────────────────────────────────
  // Her isteğe kısa bir id ver; hata loglarında ve X-Request-Id yanıt başlığında
  // taşınır, böylece bir hata canlıda log ↔ istemci ↔ upstream izi ile eşlenir.
  app.use((req, res, next) => {
    const rid = (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) || randomUUID().slice(0, 8);
    (req as Request & { rid?: string }).rid = rid;
    res.setHeader('X-Request-Id', rid);
    next();
  });

  // Kimliği doğrulanmış istekte kullanıcı (uid) bazlı, değilse IP bazlı anahtar.
  // NAT arkasındaki çok kullanıcılı ofislerde IP-başına limitin tek kullanıcıyı
  // boğmasını önler; saldırgan token başına da sınırlanır. Tüm rate limiter'lar
  // bunu kullanmalı — ham req.ip (varsayılan anahtar üretici) IIS ARR reverse
  // proxy arkasında "IP:port" birleşik string döndürüyor ve express-rate-limit
  // v7 bunu ERR_ERL_INVALID_IP_ADDRESS ile reddediyor; ipKeyGenerator bunu
  // güvenle normalize eder.
  const userOrIpKey = (req: Request): string => {
    const uid = (req as Request & { uid?: string }).uid;
    return uid ? `u:${uid}` : ipKeyGenerator(req.ip ?? '');
  };

  // ── Güvenlik başlıkları (helmet) ──────────────────────────────────────────
  // CSP: React + inline runtime + Firebase Auth/Storage + SSE (self) + harici
  // CDN'lere (gstatic, googleapis) izin verir. Geliştirmede Vite HMR için gevşek.
  app.use(helmet({
    contentSecurityPolicy: isProd ? {
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-inline' kaldırıldı (inline SW script harici dosyaya alındı /sw-register.js).
        // style-src'de korunur — Tailwind/motion runtime inline stil enjekte ediyor.
        scriptSrc: ["'self'", 'https://apis.google.com', 'https://www.gstatic.com', 'https://accounts.google.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        connectSrc: ["'self'", 'https://*.googleapis.com', 'https://*.firebaseio.com',
          'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com',
          'wss://*.firebaseio.com', 'https://api.tcmb.gov.tr', 'https://accounts.google.com',
          // apis.google.com != *.googleapis.com (different domain) - GAPI's own script
          // (loaded for Google Sign-In) makes its own fetch/XHR calls here.
          'https://apis.google.com', 'https://www.gstatic.com'],
        // Google Sign-In (popup/iframe): firebaseapp.com auth handler + Google OAuth
        frameSrc: ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com', 'https://apis.google.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", 'https://accounts.google.com', 'https://*.firebaseapp.com'],
      },
    } : false, // dev'de CSP kapalı (Vite HMR/eval)
    crossOriginEmbedderPolicy: false, // harici görseller/Firebase için
    // Google ile giriş (signInWithPopup): popup, accounts.google.com → firebaseapp.com
    // auth handler üzerinden ana pencereye window.opener.postMessage ile döner.
    // Varsayılan COOP "same-origin" bu opener referansını koparır → login takılır.
    // "same-origin-allow-popups" güvenliği korur ama popup'ın haberleşmesine izin verir.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  }));

  // Gzip compression for all responses (API + static)
  app.use(compression());

  // ── Rate Limiters ────────────────────────────────────────────────────────────
  /** General API — 300 req / 15 min per IP */
  // ── /api/db — PostgreSQL-backed document store ────────────────────────────
  // Registered BEFORE the global apiLimiter: every UI interaction hits these
  // routes, so they get their own (much higher) limit.
  if (pgPool) {
    const docsDb = pgPool;
    const dbLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 2000,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: userOrIpKey,
      message: { error: 'Too many database requests.' },
    });
    const publicWriteLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // Max 10 submissions per IP
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: userOrIpKey,
      message: { error: 'Çok fazla form gönderdiniz. Lütfen daha sonra tekrar deneyin.' },
    });
    const conditionalPublicLimiter = (req: Request, res: Response, next: NextFunction) => {
      const coll = String(req.params.coll);
      if (PUBLIC_WRITE_COLLECTIONS.has(coll)) {
        return publicWriteLimiter(req, res, next);
      }
      return next();
    };
    const dbJson = express.json({ limit: '10mb' });
    const COLL_RE = /^[A-Za-z0-9_-]{1,64}$/;
    const validColl = (c: string, res: Response): boolean => {
      if (COLL_RE.test(c)) return true;
      res.status(400).json({ error: 'Invalid collection name.' });
      return false;
    };

    // SSE stream — EventSource cannot set headers, so the ID token arrives as
    // a query param. Verified the same way requireAuth does.
    // httpOnly session cookie — SSE token'ını URL'den çıkarır (güvenlik #8).
    // POST /api/db/session {idToken} → Firebase session cookie (httpOnly+Secure+
    // SameSite) set eder; SSE bunu okur, token query'de taşınmaz.
    const SESSION_COOKIE = '__cetpa_session';
    const SESSION_MAX_AGE = 5 * 24 * 60 * 60 * 1000; // 5 gün — parseCookie modül düzeyinde
    app.post('/api/db/session', dbLimiter, requireAuth, dbJson, (req: Request, res: Response) => {
      // requireAuth uid'yi zaten lokal verifyIdToken ile doğruladı — Firebase'e
      // ek çağrı (createSessionCookie) YOK. Kendi imzalı token'ımızı veririz.
      const uid = (req as Request & { uid: string }).uid;
      res.cookie(SESSION_COOKIE, signSessionToken(uid), {
        httpOnly: true, secure: isProd, sameSite: 'strict',
        maxAge: SESSION_MAX_AGE, path: '/api/db',
      });
      res.json({ ok: true });
    });
    app.post('/api/db/session/logout', dbLimiter, async (req: Request, res: Response) => {
      res.clearCookie(SESSION_COOKIE, { path: '/api/db' });
      res.clearCookie(MFA_COOKIE, { path: '/' });
      // P2-2: çerezi silmek yetmiyordu — elde kalan Firebase ID token'ı süresi
      // (≤1sa) dolana dek geçerli kalıyordu. Refresh token'ları iptal et ki
      // çalınan/eski oturum YENİ token üretemesin. Best-effort: uid yalnız
      // geçerli bir oturum token'ı varsa okunur; çıkışı asla başarısız yapma.
      try {
        const uid = verifySessionTokenUid(parseCookie(req.headers.cookie, SESSION_COOKIE));
        if (uid) await getAuth().revokeRefreshTokens(uid);
      } catch (e) { console.warn('[logout] revokeRefreshTokens başarısız:', (e as Error).message); }
      res.json({ ok: true });
    });

    // ── TOTP 2FA endpoint'leri (kendi sunucumuz, Spark-uyumlu) ──────────────
    // otplib v13: verifySync {valid} döner; window:1 = ±30sn saat kayması toleransı.
    const totpCheck = (token: string, secret: string): boolean =>
      (totpVerifyRaw({ secret, token, window: 1 } as Parameters<typeof totpVerifyRaw>[0]).valid === true);

    // MFA brute-force kilidi — uid başına ardışık başarısız deneme; 5 hatadan sonra
    // 15 dk kilit (gevşek dbLimiter'a güvenmeyiz). Başarıda sayaç sıfırlanır.
    const mfaFailures = new Map<string, { count: number; until: number }>();
    const MFA_MAX_FAIL = 5, MFA_LOCK_MS = 15 * 60 * 1000;
    const mfaLocked = (uid: string): boolean => { const f = mfaFailures.get(uid); return !!f && f.until > Date.now(); };
    const mfaFail = (uid: string): void => {
      const f = mfaFailures.get(uid) || { count: 0, until: 0 };
      f.count++;
      if (f.count >= MFA_MAX_FAIL) { f.until = Date.now() + MFA_LOCK_MS; f.count = 0; }
      mfaFailures.set(uid, f);
    };
    const mfaLockMsg = { error: 'Çok fazla hatalı kod denemesi. 15 dakika sonra tekrar deneyin.' };

    // Durum: kullanıcının MFA'sı açık mı + bu oturum doğrulanmış mı?
    app.get('/api/mfa/status', dbLimiter, requireAuth, async (req: Request, res: Response) => {
      const uid = (req as Request & { uid: string }).uid;
      const enabled = await userHasMfa(uid);
      const verified = enabled ? verifyMfaToken(parseCookie(req.headers.cookie, MFA_COOKIE), uid) : true;
      res.json({ enabled, verified });
    });

    // Kayıt 1. adım: secret üret (pending), otpauth URL döner.
    app.post('/api/mfa/enroll/start', dbLimiter, requireAuth, async (req: Request, res: Response) => {
      const r = req as Request & { uid: string; userEmail?: string };
      try {
        const secret = totpSecret();
        await pgPool!.query(
          `INSERT INTO mfa_secrets (uid, secret, enabled) VALUES ($1, $2, false)
           ON CONFLICT (uid) DO UPDATE SET secret = $2, enabled = false, updated_at = now()`,
          [r.uid, secret],
        );
        mfaStatusCache.delete(r.uid);
        const otpauth = totpURI({ strategy: 'totp', issuer: 'CETPA', label: r.userEmail || r.uid, secret });
        res.json({ otpauth, secretKey: secret });
      } catch (e) { console.error('[mfa/enroll/start]', (e as Error).message); res.status(500).json({ error: 'MFA kaydı başlatılamadı.' }); }
    });

    // Kayıt 2. adım: kodu doğrula → enabled=true + bu oturumu doğrula.
    app.post('/api/mfa/enroll/verify', dbLimiter, requireAuth, dbJson, async (req: Request, res: Response) => {
      const uid = (req as Request & { uid: string }).uid;
      const code = String(req.body?.code || '').trim();
      if (mfaLocked(uid)) return res.status(429).json(mfaLockMsg);
      try {
        const { rows } = await pgPool!.query('SELECT secret FROM mfa_secrets WHERE uid = $1', [uid]);
        if (!rows[0]?.secret || !totpCheck(code, rows[0].secret)) {
          mfaFail(uid);
          return res.status(400).json({ error: 'Kod hatalı veya süresi doldu.' });
        }
        mfaFailures.delete(uid);
        await pgPool!.query('UPDATE mfa_secrets SET enabled = true, updated_at = now() WHERE uid = $1', [uid]);
        mfaStatusCache.delete(uid);
        res.cookie(MFA_COOKIE, signMfaToken(uid), { httpOnly: true, secure: isProd, sameSite: 'strict', maxAge: MFA_COOKIE_MAX_AGE, path: '/' });
        res.json({ ok: true });
      } catch (e) { console.error('[mfa/enroll/verify]', (e as Error).message); res.status(500).json({ error: 'Doğrulama başarısız.' }); }
    });

    // Girişte 2FA challenge: kodu doğrula → bu oturumu doğrula (cookie).
    app.post('/api/mfa/verify', dbLimiter, requireAuth, dbJson, async (req: Request, res: Response) => {
      const uid = (req as Request & { uid: string }).uid;
      const code = String(req.body?.code || '').trim();
      if (mfaLocked(uid)) return res.status(429).json(mfaLockMsg);
      try {
        const { rows } = await pgPool!.query('SELECT secret, enabled FROM mfa_secrets WHERE uid = $1', [uid]);
        if (!rows[0]?.enabled || !totpCheck(code, rows[0].secret)) {
          mfaFail(uid);
          return res.status(400).json({ error: 'Kod hatalı veya süresi doldu.' });
        }
        mfaFailures.delete(uid);
        res.cookie(MFA_COOKIE, signMfaToken(uid), { httpOnly: true, secure: isProd, sameSite: 'strict', maxAge: MFA_COOKIE_MAX_AGE, path: '/' });
        res.json({ ok: true });
      } catch (e) { console.error('[mfa/verify]', (e as Error).message); res.status(500).json({ error: 'Doğrulama başarısız.' }); }
    });

    // MFA'yı kapat (mevcut koddoğrulamasıyla).
    app.post('/api/mfa/disable', dbLimiter, requireAuth, dbJson, async (req: Request, res: Response) => {
      const uid = (req as Request & { uid: string }).uid;
      const code = String(req.body?.code || '').trim();
      if (mfaLocked(uid)) return res.status(429).json(mfaLockMsg);
      try {
        const { rows } = await pgPool!.query('SELECT secret, enabled FROM mfa_secrets WHERE uid = $1', [uid]);
        if (!rows[0]?.enabled || !totpCheck(code, rows[0].secret)) {
          mfaFail(uid);
          return res.status(400).json({ error: 'Kod hatalı.' });
        }
        mfaFailures.delete(uid);
        await pgPool!.query('DELETE FROM mfa_secrets WHERE uid = $1', [uid]);
        mfaStatusCache.delete(uid);
        res.clearCookie(MFA_COOKIE, { path: '/' });
        res.json({ ok: true });
      } catch (e) { console.error('[mfa/disable]', (e as Error).message); res.status(500).json({ error: 'İşlem başarısız.' }); }
    });

    // requireMfaVerified artık modül düzeyinde tanımlı (userHasMfa yanında).

    // ── settings sır maskeleme — TEK KAYNAK (2026-08-25) ────────────────────
    // Eskiden yalnız REST yolunda (`redactSettings`, aşağıda) vardı. SSE hem
    // init'te ham `r.data`yı hem `broadcastDocChange`in olaya iliştirdiği
    // `data`yı olduğu gibi yayınlıyordu — yani Manager rolü, REST'te
    // ***REDACTED*** gördüğü canlı Mikro/Luca/iyzico kimlik bilgilerini
    // SSE'den DÜZ METİN alıyordu. REST'i maskeleyip akışı açık bırakmak
    // maskelemeyi tamamen anlamsız kılar.
    //
    // Rol akış başında BİR KEZ okunur (`streamRole`), satır başına DB'ye
    // gidilmez — bu yüzden çekirdek SENKRON.
    const SECRET_FIELD_RE = /(password|sifre|secret|apikey|api_key|accesstoken|access_token|token|privatekey|private_key)/i;
    const REDACTED = '***REDACTED***';
    /** Derinlemesine maskeler. Eski sürüm yalnız üst düzey string alanlara
     *  bakıyordu; settings/mikro gibi İÇ İÇE nesne tutan dokümanlarda
     *  (`{ mikro: { idmPassword } }`) sır maskesiz geçiyordu. */
    const maskSecrets = (v: unknown, anahtar?: string): unknown => {
      if (typeof v === 'string') return (anahtar && SECRET_FIELD_RE.test(anahtar) && v !== '') ? REDACTED : v;
      if (Array.isArray(v)) return v.map(x => maskSecrets(x));
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = maskSecrets(val, k);
        return out;
      }
      return v;
    };
    const redactForRole = (role: AppRole | null, coll: string, data: unknown): unknown =>
      (coll !== 'settings' || data == null || role === 'Admin') ? data : maskSecrets(data);

    app.get('/api/db/stream', dbLimiter, async (req: Request, res: Response) => {
      // Önce httpOnly session cookie (tercih edilen), sonra geriye-uyumluluk
      // için query token. İkincisi rollout sonrası kaldırılabilir.
      // Kendi HMAC oturum token'ımızı LOKAL doğrula (Firebase ağ çağrısı yok).
      // Geriye-uyumluluk: çerez yoksa query idToken (yine lokal verifyIdToken).
      let streamUid = verifySessionTokenUid(parseCookie(req.headers.cookie, SESSION_COOKIE));
      if (!streamUid) {
        try { const d = await getAuth().verifyIdToken(String(req.query.token || '')); streamUid = d.uid; } catch { /* düş */ }
      }
      if (!streamUid) { res.status(401).json({ error: 'Invalid or expired session.' }); return; }
      // MFA açıksa stream de doğrulanmış oturum ister.
      if (await userHasMfa(streamUid) && !verifyMfaToken(parseCookie(req.headers.cookie, MFA_COOKIE), streamUid)) {
        res.status(403).json({ error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true }); return;
      }
      const requestedColls = String(req.query.colls || '').split(',').filter(c => COLL_RE.test(c));
      if (!requestedColls.length) { res.status(400).json({ error: 'colls query param required.' }); return; }
      // Rol-RBAC: stream, REST /api/db/:coll ile aynı okuma yetkisine uymalı.
      // Aksi halde düşük yetkili bir rol, rolü yasaklasa bile kendi firmasının
      // payrolls/bankAccounts gibi hassas koleksiyonlarını canlı dinleyebilirdi.
      const collChecks = await Promise.all(requestedColls.map(c => canAccessCollection(streamUid!, c, 'read')));
      const colls = requestedColls.filter((_, i) => collChecks[i]);
      if (!colls.length) { res.status(403).json({ error: 'Bu koleksiyonlar üzerinde okuma yetkiniz yok.' }); return; }
      // Artımlı init: istemci zaten önbelleğinde olan koleksiyonları tekrar
      // istemez. `init` parametresi verilmezse hepsi gönderilir (geriye uyum).
      //
      // Neden gerekli: StreamManager abone kümesi HER değiştiğinde yeniden
      // bağlanıyor. Bir sekmeye geçip tek bir koleksiyon eklemek, o ana kadar
      // yüklenmiş TÜM koleksiyonların baştan indirilmesine yol açıyordu —
      // sekme gezinmesi boyunca aynı veri defalarca akıyordu.
      // DİKKAT: "parametre yok" ile "parametre boş" AYRI. Boş `init=` meşru bir
      // istektir (istemcinin her şeyi önbellekte var, sadece canlı değişiklik
      // dinleyecek) — bunu "hepsini gönder"e çevirmek hatayı geri getirir.
      // '*' = hepsi (istemci ilk bağlantıda bunu gönderir; koleksiyon listesini
      // sorgu dizesinde İKİ KEZ taşımamak için — IIS maxQueryString sınırı).
      const initColls = req.query.init === undefined || req.query.init === '*'
        ? colls
        : colls.filter(c => String(req.query.init).split(',').includes(c));
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      // Kiracı/kullanıcı görünürlüğü (lenient — etiketsiz legacy görünür).
      const streamCid = await getUserCompanyId(streamUid);
      // ROL KONTROLU (2026-08-19). Bu akis eskiden YALNIZ companyId/userId
      // filtreliyordu; REST yolu ise ayni veride `denied()` -> isAllowed() ile
      // rol kontrolu yapiyordu. Sonuc: `GET /api/db/payrolls` bir Sales
      // kullanicisina 403 donerken, AYNI kullanici SSE'ye abone olarak butun
      // bordroyu alabiliyordu. Abonelik listesi ISTEMCIDEN geldigi icin bu
      // teorik degil: devtools'tan `?init=payrolls,bankAccounts` demek yetiyordu.
      // Ayni fonksiyon (isAllowed) kullaniliyor ki iki yol asla ayrisamasin.
      const streamRole = await getUserRole(streamUid);
      const rowVisible = (coll: string, data: Record<string, unknown> | undefined): boolean => {
        if (SERVER_ONLY_COLLECTIONS.has(coll)) return false; // sunucuya özel — stream'e asla çıkmaz
        if (!isAllowed(streamRole, coll, 'read')) return false; // rol yetmiyorsa hiç gösterme
        if (!data) return true;
        if (TENANT_COLLECTIONS.has(coll)) { const dc = data.companyId as string | undefined; return !dc || dc === streamCid; }
        if (USER_SCOPED_COLLECTIONS.has(coll)) { const du = data.userId as string | undefined; return !du || du === streamUid; }
        if (coll === 'settings') { const dc = data.companyId as string | undefined; return !dc || dc === streamCid; } // firma-bazlı ayar init izolasyonu
        return true;
      };
      try {
        // Kiracı filtresini SQL'e it. Eskiden bu sorgu koleksiyonların TÜM
        // satırlarını (her kiracınınkini) çekip JS'te eliyordu — her istemci
        // bağlantısında tüm veritabanı belleğe okunuyordu. Filtre artık
        // WHERE'de ve idx_docs_coll_company/untagged/user indekslerini kullanır.
        // rowVisible ikinci kapı olarak KALIR (derinlemesine savunma + settings
        // gibi SQL'e taşınmayan özel kurallar orada).
        // Yalnız istemcinin önbelleğinde OLMAYAN koleksiyonlar sorgulanır.
        // Rolun okuyamadigi koleksiyonlar diske hic gitmesin. rowVisible ikinci
        // kapi olarak kalir (derinlemesine savunma) ama bos init eventi yine
        // gonderilir ki istemci o koleksiyon icin sonsuza kadar beklemede
        // kalmasin — yetkisizlik "veri yok" gibi gorunur, sizinti olmaz.
        const izinliColls = initColls.filter(c => isAllowed(streamRole, c, 'read'));
        const tenantColls = izinliColls.filter(c => TENANT_COLLECTIONS.has(c));
        const userColls   = izinliColls.filter(c => USER_SCOPED_COLLECTIONS.has(c));
        // SERVER_ONLY hiç sorgulanmaz (rowVisible zaten eliyordu; artık diske de
        // gitmiyor). initColls'ta KALIR ki istemci o koleksiyon için boş bir init
        // eventi alsın ve beklemede kalmasın.
        const otherColls  = izinliColls.filter(c => !TENANT_COLLECTIONS.has(c) && !USER_SCOPED_COLLECTIONS.has(c) && !SERVER_ONLY_COLLECTIONS.has(c));
        const { rows } = izinliColls.length
          ? await docsDb.query(
              `SELECT coll, id, data FROM docs WHERE
                 (coll = ANY($1) AND (data->>'companyId' = $4 OR NOT (data ? 'companyId')))
              OR (coll = ANY($2) AND (data->>'userId'    = $5 OR NOT (data ? 'userId')))
              OR (coll = ANY($3))`,
              [tenantColls, userColls, otherColls, streamCid, streamUid],
            )
          : { rows: [] as Array<{ coll: string; id: string; data: unknown }> };
        const byColl: Record<string, Array<{ id: string; data: unknown }>> = {};
        for (const c of initColls) byColl[c] = [];
        for (const r of rows) if (rowVisible(r.coll, r.data as Record<string, unknown>)) byColl[r.coll].push({ id: r.id, data: redactForRole(streamRole, r.coll, r.data) });
        for (const c of initColls) {
          const docs = byColl[c];
          // Sessiz kırpma YOK: tavana çarpınca logla ve istemciye bildir.
          const truncated = docs.length > STREAM_INIT_MAX_ROWS;
          if (truncated) {
            console.warn(`[/api/db/stream] ${c}: ${docs.length} satır -> ${STREAM_INIT_MAX_ROWS} ile sınırlandı (uid=${streamUid})`);
          }
          res.write(`event: init\ndata: ${JSON.stringify({
            coll: c,
            docs: truncated ? docs.slice(0, STREAM_INIT_MAX_ROWS) : docs,
            ...(truncated ? { truncated: true, total: docs.length } : {}),
          })}\n\n`);
        }
      } catch (e) {
        res.write(`event: err\ndata: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
      }
      const onChange = (ev: { coll: string; cid?: string; uid?: string }) => {
        if (!colls.includes(ev.coll)) return;
        if (SERVER_ONLY_COLLECTIONS.has(ev.coll)) return; // sunucuya özel — yayınlanmaz
        // Başka kiracının/kullanıcının değişimini bu bağlantıya gönderme.
        if (TENANT_COLLECTIONS.has(ev.coll) && ev.cid && ev.cid !== streamCid) return;
        if (USER_SCOPED_COLLECTIONS.has(ev.coll) && ev.uid && ev.uid !== streamUid) return;
        if (ev.coll === 'settings' && ev.cid && ev.cid !== streamCid) return; // firma-bazlı ayar yayını izolasyonu
        // `broadcastDocChange` olaya dokümanın TAMAMINI iliştirir (pgShim.ts:97),
        // yani maskelenmezse sır buradan da akar.
        const gonder = 'data' in ev ? { ...ev, data: redactForRole(streamRole, ev.coll, (ev as { data?: unknown }).data) } : ev;
        res.write(`event: change\ndata: ${JSON.stringify(gonder)}\n\n`);
      };
      dbEvents.on('change', onChange);
      const heartbeat = setInterval(() => res.write(': hb\n\n'), 25000);
      req.on('close', () => { clearInterval(heartbeat); dbEvents.off('change', onChange); });
    });

    // Ham hata mesajlarını sunucu loglarında tut, istemciye generic döndür.
    // Request id ile logla (P16) + istemciye de ver ki destek talebinde eşlensin.
    const dbErr = (e: unknown, res: Response, op: string, coll: string, req?: Request) => {
      const rid = req ? (req as Request & { rid?: string }).rid : undefined;
      console.error(`[/api/db ${op} ${coll}]${rid ? ` rid=${rid}` : ''}`, (e as Error).message);
      res.status(500).json({ error: 'Veritabanı işlemi başarısız.', ...(rid ? { requestId: rid } : {}) });
    };
    // Yetki kapısı — yetkisizse 403 döner ve true verir (çağıran return etmeli).
    // docId verilirse 'kendi kaydı' istisnası uygulanır (users/{uid}).
    const denied = async (
      req: Request, res: Response, coll: string, op: 'read' | 'write' | 'delete', docId?: string,
    ): Promise<boolean> => {
      // Sunucuya özel koleksiyonlar hiçbir /api/db operasyonuna açık değil —
      // rbac'ın "tanımsız koleksiyonu staff okur / kiracı Admin'i yazar"
      // fallback'i bunlara uygulanmamalı (kiracılar-arası sızıntı olur).
      if (SERVER_ONLY_COLLECTIONS.has(coll)) {
        res.status(403).json({ error: 'Bu koleksiyon sunucuya özeldir.' });
        return true;
      }
      const uid = (req as Request & { uid?: string }).uid || '';
      // Kendi kullanıcı dokümanı istisnası (login profil senkronu) — 'role'
      // alanı guardRoleEscalation ile ayrıca korunur.
      if (isSelfDocAccess(coll, docId, uid, op)) return false;
      if (await canAccessCollection(uid, coll, op)) return false;
      res.status(403).json({ error: `Bu koleksiyon üzerinde '${op}' yetkiniz yok.` });
      return true;
    };
    // Yetki yükseltme engeli: kendi users dokümanına 'role' yazılmasını,
    // yazan kişi Admin değilse reddet.
    const guardRoleEscalation = async (req: Request, res: Response, coll: string, _docId: string, body: Record<string, unknown>): Promise<boolean> => {
      const uid = (req as Request & { uid?: string }).uid || '';
      const role = await getUserRole(uid);
      if (!blocksRoleEscalation(coll, role, body)) return false;
      res.status(403).json({ error: 'Rol değişikliği için yönetici yetkisi gerekir.' });
      return true;
    };

    // ── settings gizli alan maskeleme (P4-2) ────────────────────────────────
    // settings/{mikro,luca,iyzico,email,trendyol...} entegrasyon parolalarını/
    // apiKey'lerini DÜZ METİN tutuyor. RBAC settings okumasını Admin+Manager'a
    // açtığından, Manager canlı ERP kimlik bilgilerini okuyabiliyordu.
    // Admin gerçek değeri görür (config ekranları çalışmaya devam eder);
    // Admin olmayan maskeli görür. Yazarken maske ASLA geri yazılmaz — aksi
    // halde maskeli formu kaydeden biri gerçek secret'i '***' ile ezerdi.
    // REST yolu: rolü isteğe göre okur, maskeleme çekirdeği yukarıdaki
    // `redactForRole` ile ORTAK — iki ayrı kopya kaçınılmaz olarak sapardı.
    const redactSettings = async (req: Request, coll: string, data: Record<string, unknown> | undefined) => {
      if (coll !== 'settings' || !data) return data;
      const uid = (req as Request & { uid?: string }).uid || '';
      return redactForRole(await getUserRole(uid), coll, data) as Record<string, unknown>;
    };
    const stripRedacted = (coll: string, data: Record<string, unknown>): Record<string, unknown> => {
      if (coll !== 'settings' || !data) return data;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) if (v !== REDACTED) out[k] = v;
      return out;
    };

    // Kiracı/kullanıcı kapsam WHERE eki — lenient (etiketsiz legacy docs sahibe görünür).
    // Dönen params $2'den başlar.
    const tenantWhere = async (req: Request, coll: string): Promise<{ sql: string; params: unknown[] }> => {
      const uid = (req as Request & { uid?: string }).uid || '';
      if (TENANT_COLLECTIONS.has(coll)) {
        return { sql: " AND (data->>'companyId' = $2 OR NOT (data ? 'companyId'))", params: [await getUserCompanyId(uid)] };
      }
      if (USER_SCOPED_COLLECTIONS.has(coll)) {
        return { sql: " AND (data->>'userId' = $2 OR NOT (data ? 'userId'))", params: [uid] };
      }
      // `users` İKİ SETTE DE YOK, dolayısıyla buraya kadar düşüyordu ve
      // boş filtre dönüyordu: GET /api/db/users HER kiracının kullanıcı
      // kayıtlarını (ad, e-posta, rol, companyId) döküyordu — kiracılar arası
      // PII sızıntısı (2026-08-22 denetim bulgusu; C7/C19'un listeleme yarısı).
      // Süper-admin ayrıcalığı burada YOK: onun için ayrı /api/superadmin/*
      // uçları var ve onlar bilerek global.
      if (coll === 'users') {
        // Kendi kaydı her koşulda görünür (companyId'si henüz damgalanmamış
        // yeni davet edilen kullanıcı kendini okuyabilsin diye).
        return {
          sql: " AND (data->>'companyId' = $2 OR id = $3)",
          params: [await getUserCompanyId(uid), uid],
        };
      }
      return { sql: '', params: [] };
    };
    // Yazmada companyId/userId enjekte et (client değerini geçersiz kıl).
    const injectTenant = async (req: Request, coll: string, data: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const uid = (req as Request & { uid?: string }).uid || '';
      if (TENANT_COLLECTIONS.has(coll)) return { ...data, companyId: await getUserCompanyId(uid) };
      // KOŞULSUZ damgala (2026-08-22, P3 ile birlikte): eskiden `!('userId' in
      // data)` şartı vardı — istemci userId'yi KENDİSİ gönderirse ona
      // GÜVENİLİYORDU, yani bir kullanıcı başka birinin bildirim/tercih
      // kaydını yazabilirdi. TENANT damgası (üstte) nasıl istemci companyId'sini
      // her zaman eziyorsa, userId de öyle ezilir. Kod tabanındaki tüm meşru
      // yazmalar zaten kendi uid'sini gönderiyor (App.tsx createNotification vb.).
      if (USER_SCOPED_COLLECTIONS.has(coll)) return { ...data, userId: uid };
      return data;
    };
    // Mevcut doc sahibin mi? (etiketsiz legacy → erişilebilir)
    /**
     * Bir koleksiyonun SAHİPLİK denetimine tabi olup olmadığı — `ownsDoc` bu
     * yüklem doğruyken çağrılır.
     *
     * NEDEN AYRI (2026-08-22 denetim bulgusu): koşul dört ayrı yerde
     * (SET/DELETE/increment/update) elle `TENANT_COLLECTIONS.has(coll) ||
     * USER_SCOPED_COLLECTIONS.has(coll)` diye yazılıydı. `users` ise İKİ SETTE
     * DE YOK — bu yüzden C7/C19 için `ownsDoc` içine eklenen "users" dalı bu
     * dört yolda HİÇ çağrılmıyordu: kiracı A'nın Admin'i
     * DELETE /api/db/users/<B-uid> ile BAŞKA firmanın kullanıcısını
     * silebiliyordu (aynı şekilde listeleme de filtresizdi). Yüklem tek yere
     * alındı ve `users` açıkça dahil edildi.
     */
    const sahiplikDenetimli = (coll: string): boolean =>
      TENANT_COLLECTIONS.has(coll) || USER_SCOPED_COLLECTIONS.has(coll) || coll === 'users';

    const ownsDoc = async (req: Request, coll: string, docData: Record<string, unknown> | undefined, docId?: string): Promise<boolean> => {
      const uid = (req as Request & { uid?: string }).uid || '';
      if (!docData) return true; // yeni kayıt
      // users KİRACI-KAPSAMLI DEĞİL (TENANT_COLLECTIONS dışında) — bu yüzden
      // eskiden buradan hep `true` dönüyor ve A kiracısının Admin'i B kiracısının
      // kullanıcılarının rolünü/durumunu değiştirebiliyordu (denied() Admin'e
      // users yazmayı veriyor, sahiplik kontrolü yoktu). Kural (2026-08-22):
      //   kendi dokümanın → serbest; süper-admin → serbest;
      //   aksi halde hedef dokümanın companyId'si SENİN kiracın olmalı.
      // Etiketsiz (companyId'siz) bir users dokümanı BAŞKA bir kiracının
      // sahibidir (companyId = kendi uid'i) — ona da dokunulamaz; bu yüzden
      // burada TENANT koleksiyonlarındaki "etiketsiz → görünür" esnekliği YOK.
      if (coll === 'users') {
        if (docId && docId === uid) return true;
        if (isSuperAdmin(req)) return true;
        const hedefCid = (docData.companyId as string) || null;
        return !!hedefCid && hedefCid === await getUserCompanyId(uid);
      }
      if (TENANT_COLLECTIONS.has(coll)) {
        const dc = (docData.companyId as string) || null;
        return dc === null || dc === await getUserCompanyId(uid);
      }
      if (USER_SCOPED_COLLECTIONS.has(coll)) {
        const du = (docData.userId as string) || null;
        return du === null || du === uid;
      }
      return true;
    };
    // settings/{key} → firma-bazlı gerçek id. perCompany ise GET'te legacy global'e fallback edilir.
    const settingsRealId = async (req: Request, coll: string, id: string): Promise<{ realId: string; perCompany: boolean; cid: string }> => {
      if (coll === 'settings' && PER_COMPANY_SETTINGS.has(id)) {
        const uid = (req as Request & { uid?: string }).uid || '';
        const cid = await getUserCompanyId(uid);
        return { realId: `${cid}__${id}`, perCompany: true, cid };
      }
      return { realId: id, perCompany: false, cid: '' };
    };
    // Doğrudan namespaced ayar erişimini engelle (client yalnız 'app','mikro' gibi düz anahtar ister).
    const rejectNamespacedSettings = (coll: string, id: string, res: Response): boolean => {
      if (coll === 'settings' && id.includes('__')) { res.status(400).json({ error: 'Geçersiz ayar anahtarı.' }); return true; }
      return false;
    };

    app.get('/api/db/:coll', dbLimiter, requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
      const coll = String(req.params.coll);
      if (!validColl(coll, res)) return;
      if (await denied(req, res, coll, 'read')) return;
      try {
        const t = await tenantWhere(req, coll);
        const { rows } = await docsDb.query(`SELECT id, data FROM docs WHERE coll = $1${t.sql}`, [coll, ...t.params]);
        // P4-2: settings gizli alanları Admin olmayana maskeli döner.
        if (coll === 'settings') {
          for (const r of rows) r.data = await redactSettings(req, coll, r.data as Record<string, unknown>);
        }
        res.json({ docs: rows });
      } catch (e) { dbErr(e, res, 'GET', coll); }
    });

    app.get('/api/db/:coll/:id', dbLimiter, requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
      const coll = String(req.params.coll), id = String(req.params.id);
      if (!validColl(coll, res)) return;
      if (rejectNamespacedSettings(coll, id, res)) return;
      if (await denied(req, res, coll, 'read', id)) return;
      try {
        const { realId, perCompany } = await settingsRealId(req, coll, id);
        let { rows } = await docsDb.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, realId]);
        // Firma-bazlı ayar henüz oluşmamışsa legacy global ayara düş (mevcut firma kaybetmesin).
        if (!rows.length && perCompany) {
          ({ rows } = await docsDb.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id]));
        }
        if (!rows.length || !(await ownsDoc(req, coll, rows[0].data as Record<string, unknown>, id))) { res.status(404).json({ error: 'Not found.' }); return; }
        res.json({ data: await redactSettings(req, coll, rows[0].data as Record<string, unknown>) }); // P4-2
      } catch (e) { dbErr(e, res, 'GET', coll); }
    });

    // ── Data Integrity (Zod Schemas for DB Writes) ──────────────────────────────
    const dbSchemas: Record<string, z.ZodSchema> = {
      users: z.object({
        name: z.string().max(100).optional(),
        email: z.string().email().optional(),
        role: z.enum(['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'HR', 'Purchasing', 'B2B', 'Dealer', 'Legal', 'Corporate', 'Quality']).optional(),
        suspended: z.boolean().optional(),
      }).passthrough(),
      projects: z.object({
        name: z.string().max(200).optional(),
        client: z.string().max(100).optional(),
        manager: z.string().max(100).optional(),
        status: z.enum(['Active', 'Completed', 'On-Hold', 'Planning']).optional(),
        priority: z.enum(['High', 'Medium', 'Low']).optional(),
      }).passthrough(),
      tasks: z.object({
        projectId: z.string().optional(),
        title: z.string().max(200).optional(),
        assignee: z.string().max(100).optional(),
        status: z.enum(['Todo', 'In-Progress', 'Review', 'Done']).optional(),
        priority: z.enum(['High', 'Medium', 'Low']).optional(),
      }).passthrough(),
    };

    function validateCollectionWrite(coll: string, data: unknown, res: Response): boolean {
      if (coll in dbSchemas) {
        const result = dbSchemas[coll].safeParse(data);
        if (!result.success) {
          res.status(400).json({ error: `Geçersiz veri: ${coll}`, details: result.error.flatten() });
          return false;
        }
      }
      return true;
    }

    app.post('/api/db/:coll', dbLimiter, conditionalPublicLimiter, requireAuth, requireMfaVerified, dbJson, async (req: Request, res: Response) => {
      const coll = String(req.params.coll);
      if (!validColl(coll, res)) return;
      if (!validateCollectionWrite(coll, req.body, res)) return;
      if (await denied(req, res, coll, 'write')) return;
      try {
        const id = genDocId();
        let data = await injectTenant(req, coll, resolveSentinels(req.body ?? {}) as Record<string, unknown>);
        if (coll === 'users') data = await pinProtectedUserFields((req as Request & { uid?: string }).uid || '', data, undefined, isSuperAdmin(req)); // companyId/role/status escalation engeli
        if (coll === 'auditLog') {
          // Sahtecilik engeli: actor alanları sunucu-doğrulanmış kimlikle override (client "kim" diye yalan söyleyemez).
          const actor = reqActor(req);
          data = { ...data, userId: actor.uid, userEmail: actor.email, userName: data.userName || actor.email, source: 'client', timestamp: pgServerTimestamp() };
        }
        await docsDb.query(
          'INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)',
          [coll, id, JSON.stringify(data)],
        );
        broadcastDocChange(coll, 'set', id, data);
        res.json({ id, data });
      } catch (e) { dbErr(e, res, 'POST', coll); }
    });

    // setDoc — full replace, or deep-ish merge with ?merge=1
    app.put('/api/db/:coll/:id', dbLimiter, requireAuth, requireMfaVerified, dbJson, async (req: Request, res: Response) => {
      const coll = String(req.params.coll), id = String(req.params.id);
      if (!validColl(coll, res)) return;
      if (!validateCollectionWrite(coll, req.body, res)) return;
      // Append-only koleksiyonlarda mevcut kaydın üzerine yazma yok
      if (APPEND_ONLY_COLLECTIONS.has(coll)) { res.status(403).json({ error: 'Bu koleksiyon değiştirilemez (append-only).' }); return; }
      if (rejectNamespacedSettings(coll, id, res)) return;
      if (await denied(req, res, coll, 'write', id)) return;
      if (await guardRoleEscalation(req, res, coll, id, (req.body ?? {}) as Record<string, unknown>)) return;
      try {
        const { realId, perCompany, cid } = await settingsRealId(req, coll, id);
        // P4-2: maskeli (***REDACTED***) gelen gizli alanları YOK SAY — maskeli
        // formu kaydeden biri gerçek secret'i ezmesin.
        const incoming = stripRedacted(coll, resolveSentinels(req.body ?? {}) as Record<string, unknown>);
        let data = incoming;
        let before: Record<string, unknown> = {};
        const audited = AUDITED_COLLECTIONS.has(coll);
        const scoped = sahiplikDenetimli(coll);
        // Sahiplik: kapsamlı/audit/merge için mevcut kaydı çek
        if (req.query.merge === '1' || audited || scoped) {
          let { rows } = await docsDb.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, realId]);
          if (!rows.length && perCompany) ({ rows } = await docsDb.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id])); // merge tabanı: legacy global
          before = (rows[0]?.data as Record<string, unknown>) ?? {};
          if (rows.length && !(await ownsDoc(req, coll, before, realId))) { res.status(403).json({ error: 'Bu kayıt başka bir firmaya ait.' }); return; }
          if (req.query.merge === '1') data = mergeDocData(before, incoming);
        }
        data = await injectTenant(req, coll, data); // companyId/userId enjekte
        if (perCompany) data = { ...data, companyId: cid }; // SSE firma filtresi için
        if (coll === 'users') data = await pinProtectedUserFields((req as Request & { uid?: string }).uid || '', data, before, isSuperAdmin(req)); // companyId/role/status escalation engeli
        await docsDb.query(
          `INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)
           ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [coll, realId, JSON.stringify(data)],
        );
        if (coll === 'settings' && realId === 'aiConfig') invalidateGeminiKeyCache(); // yeni anahtar anında etkir
        broadcastDocChange(coll, 'set', id, data); // orijinal id ile yayınla (client settings/{id} dinler)
        // before yalnızca audited/scoped/merge'de çekildiği için logu bununla sınırla
        // (aksi halde diff tüm alanları "yeni" gösterir = gürültü).
        if (shouldAudit(coll) && (audited || scoped || req.query.merge === '1')) {
          const fd = computeFieldDiff(before, data);
          if (Object.keys(fd).length) void writeAuditLog(reqActor(req), `${coll} kaydedildi`, `${coll}/${id}`, fd);
        }
        res.json({ id, data });
      } catch (e) { dbErr(e, res, 'PUT', coll); }
    });

    // updateDoc — shallow merge with dot-path support (lenient upsert)
    app.patch('/api/db/:coll/:id', dbLimiter, requireAuth, requireMfaVerified, dbJson, async (req: Request, res: Response) => {
      const coll = String(req.params.coll), id = String(req.params.id);
      if (!validColl(coll, res)) return;
      if (!validateCollectionWrite(coll, req.body, res)) return;
      if (APPEND_ONLY_COLLECTIONS.has(coll)) { res.status(403).json({ error: 'Bu koleksiyon değiştirilemez (append-only).' }); return; }
      if (rejectNamespacedSettings(coll, id, res)) return;
      if (await denied(req, res, coll, 'write', id)) return;
      if (await guardRoleEscalation(req, res, coll, id, (req.body ?? {}) as Record<string, unknown>)) return;
      try {
        const { realId, perCompany, cid } = await settingsRealId(req, coll, id);
        // P4-2: maskeli gelen gizli alanlar gerçek secret'i ezmesin.
        const patch = stripRedacted(coll, resolveSentinels(req.body ?? {}) as Record<string, unknown>);
        let { rows } = await docsDb.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, realId]);
        if (!rows.length && perCompany) ({ rows } = await docsDb.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id])); // merge tabanı: legacy global
        const before = (rows[0]?.data as Record<string, unknown>) ?? {};
        if (rows.length && !(await ownsDoc(req, coll, before, realId))) { res.status(403).json({ error: 'Bu kayıt başka bir firmaya ait.' }); return; }
        let data = mergeDocData(before, patch);
        data = await injectTenant(req, coll, data); // companyId/userId enjekte
        if (perCompany) data = { ...data, companyId: cid }; // SSE firma filtresi için
        if (coll === 'users') data = await pinProtectedUserFields((req as Request & { uid?: string }).uid || '', data, before, isSuperAdmin(req)); // companyId/role/status escalation engeli
        await docsDb.query(
          `INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)
           ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [coll, realId, JSON.stringify(data)],
        );
        if (coll === 'settings' && realId === 'aiConfig') invalidateGeminiKeyCache(); // yeni anahtar anında etkir
        broadcastDocChange(coll, 'set', id, data); // orijinal id ile yayınla
        // 'kim neyi değiştirdi' diff'i kaydet (bloklamadan); before her zaman çekildi.
        if (shouldAudit(coll)) {
          const fd = computeFieldDiff(before, data);
          if (Object.keys(fd).length) void writeAuditLog(reqActor(req), `${coll} güncellendi`, `${coll}/${id}`, fd);
        }
        res.json({ id, data });
      } catch (e) { dbErr(e, res, 'PATCH', coll); }
    });

    app.delete('/api/db/:coll/:id', dbLimiter, requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
      const coll = String(req.params.coll), id = String(req.params.id);
      if (!validColl(coll, res)) return;
      if (APPEND_ONLY_COLLECTIONS.has(coll)) { res.status(403).json({ error: 'Bu koleksiyon silinemez (append-only).' }); return; }
      if (rejectNamespacedSettings(coll, id, res)) return;
      if (await denied(req, res, coll, 'delete')) return;
      try {
        const { realId } = await settingsRealId(req, coll, id);
        // Silinecek kaydın bir kopyasını al (audit ve sahiplik kontrolü için).
        const { rows: existing } = await docsDb.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, realId]);
        const prevData = (existing[0]?.data as Record<string, unknown>) || {};
        // Sahiplik: başka firmanın kaydı silinemez
        if (sahiplikDenetimli(coll)) {
          if (existing.length && !(await ownsDoc(req, coll, prevData, realId))) { res.status(403).json({ error: 'Bu kayıt başka bir firmaya ait.' }); return; }
        }
        await docsDb.query('DELETE FROM docs WHERE coll = $1 AND id = $2', [coll, realId]);
        broadcastDocChange(coll, 'delete', id);
        // Silme işlemini her zaman logla (efemeral koleksiyonlar hariç).
        if (shouldAudit(coll)) {
          const label = (prevData.name || prevData.title || prevData.adi || prevData.musteriAdi || id) as string;
          void writeAuditLog(reqActor(req), `${coll} silindi`, `${coll}/${id} (${label})`);
        }
        res.json({ ok: true });
      } catch (e) { dbErr(e, res, 'DELETE', coll); }
    });

    // Atomik sayısal artırma (stok hareketleri için yarış koşulu yok).
    // Body: { field, delta, min? } → data[field] = max(min ?? -∞, (data[field] ?? 0) + delta)
    // Tek SQL UPDATE; oku-değiştir-yaz yok.
    app.patch('/api/db/:coll/:id/increment', dbLimiter, requireAuth, requireMfaVerified, dbJson, async (req: Request, res: Response) => {
      const coll = String(req.params.coll), id = String(req.params.id);
      if (!validColl(coll, res)) return;
      if (APPEND_ONLY_COLLECTIONS.has(coll)) { res.status(403).json({ error: 'Bu koleksiyon değiştirilemez (append-only).' }); return; }
      const { field, delta, min } = (req.body ?? {}) as { field?: string; delta?: number; min?: number };
      if (typeof field !== 'string' || !/^[A-Za-z0-9_]{1,40}$/.test(field) || typeof delta !== 'number' || !Number.isFinite(delta)) {
        return res.status(400).json({ error: 'field (alfasayısal) ve delta (sayı) gerekli.' });
      }
      if (await denied(req, res, coll, 'write', id)) return;
      try {
        // Sahiplik kontrolü
        const { rows } = await docsDb.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id]);
        if (!rows.length) return res.status(404).json({ error: 'Not found.' });
        if (sahiplikDenetimli(coll) && !(await ownsDoc(req, coll, rows[0].data as Record<string, unknown>, id))) {
          return res.status(403).json({ error: 'Bu kayıt başka bir firmaya ait.' });
        }
        const floor = typeof min === 'number' && Number.isFinite(min) ? min : -1e18;
        const upd = await docsDb.query(
          `UPDATE docs SET data = jsonb_set(data, ARRAY[$3],
             to_jsonb( GREATEST($5::numeric, COALESCE((data->>$3)::numeric, 0) + $4::numeric) )),
             updated_at = now()
           WHERE coll = $1 AND id = $2 RETURNING data`,
          [coll, id, field, delta, floor],
        );
        const data = upd.rows[0]?.data;
        broadcastDocChange(coll, 'set', id, data as Record<string, unknown>);
        res.json({ id, data });
      } catch (e) { dbErr(e, res, 'INCREMENT', coll); }
    });

    // Atomik compare-and-set (CAS) — yarış koşulsuz "claim" için.
    // Body: { field, expect, set } → set uygulanır YALNIZCA data[field] === expect ise.
    // claimed=true (güncellendi) / false (koşul tutmadı, başkası aldı). Tek SQL UPDATE.
    app.patch('/api/db/:coll/:id/cas', dbLimiter, requireAuth, requireMfaVerified, dbJson, async (req: Request, res: Response) => {
      const coll = String(req.params.coll), id = String(req.params.id);
      if (!validColl(coll, res)) return;
      if (APPEND_ONLY_COLLECTIONS.has(coll)) { res.status(403).json({ error: 'Bu koleksiyon değiştirilemez (append-only).' }); return; }
      const { field, expect, set } = (req.body ?? {}) as { field?: string; expect?: unknown; set?: Record<string, unknown> };
      if (typeof field !== 'string' || !/^[A-Za-z0-9_]{1,40}$/.test(field) || typeof set !== 'object' || set === null) {
        return res.status(400).json({ error: 'field (alfasayısal) ve set (nesne) gerekli.' });
      }
      if (await denied(req, res, coll, 'write', id)) return;
      // CAS `set` gövdesi PUT/PATCH gibi keyfi alan yazar — aynı yetki-yükseltme
      // kapısından geçmeli, yoksa kullanıcı kendi users/{uid} dokümanına
      // set:{role:'Admin'} yazıp Admin'e yükselebilir (self-doc yazma izinli).
      if (await guardRoleEscalation(req, res, coll, id, set as Record<string, unknown>)) return;
      try {
        const { rows } = await docsDb.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id]);
        if (!rows.length) return res.status(404).json({ error: 'Not found.' });
        if (sahiplikDenetimli(coll) && !(await ownsDoc(req, coll, rows[0].data as Record<string, unknown>, id))) {
          return res.status(403).json({ error: 'Bu kayıt başka bir firmaya ait.' });
        }
        // KİRACI SINIRI (2026-08-25 denetimi): CAS'in `set` gövdesi POST/PUT/PATCH
        // gibi keyfi alan yazar, ama o üçünün aksine `pinProtectedUserFields`ten
        // GEÇMİYORDU. Üstteki `guardRoleEscalation` yalnız 'role' alanına bakar
        // (rbac.ts:321-325) — 'companyId' ve 'status' süzgeçsiz geçiyordu.
        // Sonuç: self-doc yazma izni olan herhangi bir kullanıcı
        //   PATCH /api/db/users/<kendi-uid>/cas  { field:'x', expect:.., set:{companyId:'<kurban>'} }
        // ile kendini başka kiracıya taşıyabiliyordu (getUserCompanyId bu alanı
        // okur). Diğer üç yazma yolundaki kapının aynısı buraya da kondu.
        const setYazilacak = coll === 'users'
          ? await pinProtectedUserFields(
              (req as Request & { uid?: string }).uid || '',
              set as Record<string, unknown>,
              rows[0].data as Record<string, unknown>,
              isSuperAdmin(req),
            )
          : (set as Record<string, unknown>);
        const upd = await docsDb.query(
          `UPDATE docs SET data = data || $4::jsonb, updated_at = now()
           WHERE coll = $1 AND id = $2 AND data->>$3 = $5 RETURNING data`,
          [coll, id, field, JSON.stringify(setYazilacak), String(expect)],
        );
        const claimed = upd.rows.length > 0;
        if (claimed) broadcastDocChange(coll, 'set', id, upd.rows[0].data as Record<string, unknown>);
        res.json({ claimed, data: claimed ? upd.rows[0].data : null });
      } catch (e) { dbErr(e, res, 'CAS', coll); }
    });
  }

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    message: { error: 'Too many requests, please try again later.' },
  });

  /** Auth endpoints — stricter: 20 req / 15 min per IP */
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    message: { error: 'Too many authentication attempts, please try again later.' },
  });

  /** Stripe / payment — very strict: 10 req / 10 min per kullanıcı (veya IP) */
  const paymentLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    message: { error: 'Too many payment requests, please try again later.' },
  });

  /** Mikro ERP senkron işlemleri — 30 req / 5 dk per kullanıcı (ağır API çağrıları) */
  const mikroLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    message: { error: 'Çok fazla Mikro senkron isteği, lütfen biraz bekleyin.' },
  });



  /** Kimliksiz sipariş takibi — 40 req / 15 dk per IP. Sipariş id'si zaten
   *  ~119 bitlik rastgele bir sır, yani sayım riski yok; bu limit sızmış bir
   *  id listesinin toplu kazınmasını yavaşlatmak ve ucu ucuz bir DoS yüzeyi
   *  olmaktan çıkarmak için. Genel apiLimiter (300/15dk) bunun için gevşek. */
  const trackLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    message: { success: false, error: 'Çok fazla takip sorgusu, lütfen biraz bekleyin.' },
  });

  // Apply general limiter to all /api/* routes
  app.use('/api', apiLimiter);
  // Mikro yazma/senkron uçlarına ek kullanıcı-bazlı limit (import/kaydet/pull)
  app.use(['/api/mikro/import', '/api/mikro/stok', '/api/mikro/cari', '/api/mikro/fatura',
    '/api/mikro/irsaliye', '/api/mikro/siparis', '/api/mikro/yevmiye', '/api/mikro/tahsilat',
    '/api/mikro/pull', '/api/mikro/cari-hareket', '/api/mikro/evrak'], mikroLimiter);

  // Capture raw body for Shopify webhook HMAC verification (must come before express.json)
  app.use(express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => {
      req.rawBody = buf;
    },
  }));

  // ... (keep existing routes)
  
  // Manual Sync Trigger
  app.post("/api/shopify/sync", requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
  app.post('/api/shopify/draft-order', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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

    if (boss) {
      // P6: aynı sipariş+topic için tekilleştirme anahtarı — Shopify aynı webhook'u
      // yeniden teslim ederse (retry) eşzamanlı iki iş oluşmaz, tek sipariş yazılır.
      const orderKey = `${topic}:${body?.order_number || body?.id || 'x'}`.slice(0, 200);
      await boss.send('shopify-webhook', { topic, body }, { singletonKey: orderKey });
    } else {
      await processShopifyWebhook(topic, body).catch(() => {});
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
  app.post("/api/luca/fatura-gonder", requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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

  // POST /api/inventory/auto-reorder — scan inventory, create draft POs for low-stock items
  /** GET /api/exchange-rates/at?date=YYYY-MM-DD — o tarihin TCMB kuru.
   *  Doğrudan TCMB tarihsel arşivinden çeker (kendi arşivimizi tutmayız). Hafta
   *  sonu/tatilde en yakın önceki iş gününe kayar. Bugün/gelecek tarih istenirse
   *  bellekteki güncel kuru döner (TCMB o günü henüz yayınlamamış olabilir). */
  app.get('/api/exchange-rates/at', requireAuth, async (req: Request, res: Response) => {
    const date = String(req.query.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: 'date=YYYY-MM-DD gerekli.' });
    const today = new Date().toISOString().slice(0, 10);
    if (date >= today && cachedExchangeRates) {
      return res.json({ success: true, date: today, rates: cachedExchangeRates.rates, source: 'current' });
    }
    try {
      const r = await fetchTCMBRateForDate(date);
      if (r) return res.json({ success: true, date: r.date, rates: { USD: r.USD, EUR: r.EUR }, source: 'tcmb-historical' });
    } catch { /* aşağıdaki fallback'e düş */ }
    res.json({ success: true, date, rates: cachedExchangeRates?.rates || {}, source: 'fallback' });
  });


  /** POST /api/logistics/transfer — konum-bazlı stok transferi (atomik).
   *  Body: { productId, sku?, productName?, quantity, from?, to?, note? }
   *    from/to: { type:'warehouse'|'vehicle', id, name? } | null
   *    - from+to dolu  → gerçek transfer (depo↔depo, araç↔depo, depo↔araç)
   *    - from null     → lokasyona giriş (başlangıç stok atama / mal kabul)
   *    - to null       → lokasyondan çıkış (sevkiyat/fire)
   *  locationStocks doc id biçimi: `<type>__<locationId>__<productId>`.
   *  Global inventory.stockLevel'a DOKUNMAZ — transfer toplam stoğu değiştirmez,
   *  yalnız lokasyon dağılımını günceller (bkz. Faz 2 kararı). Tek PG
   *  transaction'da: kaynak azalt (yetersizse rollback) + hedef artır/oluştur +
   *  inventoryMovements kaydı. */
  // ── Tahsilat makbuz fotoğrafı — SUNUCU DİSKİ upload (kullanıcı tercihi) ──────
  // Dosyalar C:\cetpa\uploads\tahsilat\<companyId>\ altına yazılır. Erişim
  // requireAuth + companyId sahiplik kontrolü ile korunur (public static DEĞİL).
  // NOT: bu klasör off-server yedeklemeye (pg_dump → Firebase Storage) DAHİL
  // DEĞİL; sunucu diski ODEA'da askıya alınırsa erişilemez (kullanıcıya bildirildi).
  const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  const TAHSILAT_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'tahsilat');
  try { fs.mkdirSync(TAHSILAT_UPLOAD_DIR, { recursive: true }); } catch { /* zaten var */ }

  const makbuzUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const uid = (req as Request & { uid?: string }).uid || 'unknown';
        const dir = path.join(TAHSILAT_UPLOAD_DIR, uid.replace(/[^A-Za-z0-9_-]/g, ''));
        fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
      },
      filename: (_req, file, cb) => {
        const ext = (path.extname(file.originalname || '').toLowerCase().match(/^\.(jpe?g|png|webp|heic|pdf)$/) || ['.jpg'])[0];
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
      const ok = /^(image\/(jpe?g|png|webp|heic)|application\/pdf)$/.test(file.mimetype);
      if (ok) cb(null, true);
      else cb(new Error('Yalnız görsel (jpg/png/webp/heic) veya PDF yüklenebilir.'));
    },
  });

  app.post('/api/upload/tahsilat', requireAuth, requireMfaVerified, (req: Request, res: Response) => {
    makbuzUpload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
      const f = (req as Request & { file?: { filename: string } }).file;
      if (!f) return res.status(400).json({ success: false, error: 'Dosya bulunamadı.' });
      const uid = (req as Request & { uid: string }).uid;
      const safeUid = uid.replace(/[^A-Za-z0-9_-]/g, '');
      // Dönen URL korumalı serve endpoint'ine işaret eder (public path değil).
      res.json({ success: true, url: `/api/uploads/tahsilat/${safeUid}/${f.filename}`, filename: f.filename });
    });
  });

  // Korumalı makbuz servis — sadece kendi firmasının dosyalarına erişim.
  app.get('/api/uploads/tahsilat/:uid/:file', requireAuth, async (req: Request, res: Response) => {
    const reqUid = (req as Request & { uid: string }).uid.replace(/[^A-Za-z0-9_-]/g, '');
    const uid = String(req.params.uid).replace(/[^A-Za-z0-9_-]/g, '');
    const file = String(req.params.file).replace(/[^A-Za-z0-9_.-]/g, '');
    // SAHİPLİK FİRMA BAZINDA (2026-08-22 denetim bulgusu C24). Eskiden
    // `uid !== reqUid → 403` idi: makbuzu yükleyen kişi dışında aynı firmadaki
    // muhasebeci bile açamıyordu — oysa yukarıdaki yorum "kendi firmasının
    // dosyaları" diyordu. Klasör uid'ye göre (yükleyen), yetki ise yükleyenin
    // firması == isteyenin firması.
    if (uid !== reqUid) {
      const [sahipCid, isteyenCid] = await Promise.all([getUserCompanyId(uid), getUserCompanyId(reqUid)]);
      if (!sahipCid || sahipCid !== isteyenCid) return res.status(403).json({ error: 'Bu dosyaya erişim yetkiniz yok.' });
    }
    const filePath = path.join(TAHSILAT_UPLOAD_DIR, uid, file);
    // Path traversal koruması: çözülen yol klasörün içinde mi?
    if (!filePath.startsWith(path.join(TAHSILAT_UPLOAD_DIR, uid) + path.sep)) return res.status(400).json({ error: 'Geçersiz yol.' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Dosya bulunamadı.' });
    res.sendFile(filePath);
  });

  app.post('/api/logistics/transfer', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!pgPool) return res.status(503).json({ success: false, error: 'Veritabanı yok.' });
    const uid = (req as Request & { uid: string }).uid;
    // P3-6: rol kontrolü — bu rota requireAuth+MFA dışında RBAC uygulamıyordu,
    // yani B2B/Dealer dahil HERHANGİ bir oturum stok hareketi yazabiliyordu.
    if (!(await canAccessCollection(uid, 'inventory', 'write'))) {
      return res.status(403).json({ success: false, error: 'Stok hareketi için yetkiniz yok.' });
    }
    const companyId = await getUserCompanyId(uid);
    const b = (req.body ?? {}) as {
      productId?: string; sku?: string; productName?: string; quantity?: number; note?: string;
      transferId?: string;
      from?: { type: 'warehouse' | 'vehicle'; id: string; name?: string } | null;
      to?:   { type: 'warehouse' | 'vehicle'; id: string; name?: string } | null;
    };
    const qty = Number(b.quantity);
    if (!b.productId || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ success: false, error: 'productId ve pozitif quantity gerekli.' });
    }
    if (!b.from && !b.to) {
      return res.status(400).json({ success: false, error: 'En az bir taraf (from veya to) gerekli.' });
    }
    const locId = (loc: { type: string; id: string }) => `${loc.type}__${loc.id}__${b.productId}`;
    // P12: istemci transferId gönderirse aynı transfer iki kez uygulanmaz (retry/çift-tık/replay).
    const idemKey = (typeof b.transferId === 'string' && b.transferId) ? `${companyId}:${b.transferId}`.slice(0, 200) : null;
    // P13: SSE yayınları COMMIT başarılı olmadan ateşlenmez — yoksa ROLLBACK'te
    // istemciler geri alınan stok değişimini görür.
    const pending: Array<() => void> = [];

    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');

      // P12: aynı anahtarlı eşzamanlı istekleri serialize et + zaten uygulanmışsa dön.
      if (idemKey) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [idemKey]);
        const dup = await client.query(
          "SELECT id FROM docs WHERE coll = 'inventoryMovements' AND data->>'idempotencyKey' = $1 LIMIT 1",
          [idemKey],
        );
        if (dup.rows.length) {
          await client.query('COMMIT'); // yalnız advisory lock'u bırak; veri değişmedi
          return res.json({ success: true, movementId: dup.rows[0].id, idempotent: true });
        }
      }

      // Kaynak: yeterli stok kontrolü + azalt (locationStock yoksa 0 kabul → hata)
      if (b.from) {
        const fromDocId = locId(b.from);
        const r = await client.query('SELECT data FROM docs WHERE coll = $1 AND id = $2 FOR UPDATE', ['locationStocks', fromDocId]);
        const cur = r.rows.length ? Number((r.rows[0].data as Record<string, unknown>).quantity) || 0 : 0;
        if (cur < qty) {
          await client.query('ROLLBACK');
          return res.status(409).json({ success: false, error: `Kaynak lokasyonda yeterli stok yok (mevcut: ${cur}, istenen: ${qty}).`, available: cur });
        }
        const fromData = {
          id: fromDocId, locationType: b.from.type, locationId: b.from.id, locationName: b.from.name ?? '',
          productId: b.productId, sku: b.sku ?? '', productName: b.productName ?? '',
          quantity: cur - qty, companyId, updatedAt: new Date().toISOString(),
        };
        await client.query(
          `INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)
           ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          ['locationStocks', fromDocId, JSON.stringify(fromData)],
        );
        pending.push(() => broadcastDocChange('locationStocks', 'set', fromDocId, fromData));
      }

      // Hedef: artır (yoksa oluştur)
      if (b.to) {
        const toDocId = locId(b.to);
        const r = await client.query('SELECT data FROM docs WHERE coll = $1 AND id = $2 FOR UPDATE', ['locationStocks', toDocId]);
        const cur = r.rows.length ? Number((r.rows[0].data as Record<string, unknown>).quantity) || 0 : 0;
        const toData = {
          id: toDocId, locationType: b.to.type, locationId: b.to.id, locationName: b.to.name ?? '',
          productId: b.productId, sku: b.sku ?? '', productName: b.productName ?? '',
          quantity: cur + qty, companyId, updatedAt: new Date().toISOString(),
        };
        await client.query(
          `INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)
           ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          ['locationStocks', toDocId, JSON.stringify(toData)],
        );
        pending.push(() => broadcastDocChange('locationStocks', 'set', toDocId, toData));
      }

      // Hareket kaydı (kategori: her iki taraf da lokasyonsa transfer; biri araçsa arac_transfer)
      const involvesVehicle = b.from?.type === 'vehicle' || b.to?.type === 'vehicle';
      const category = !b.from ? 'lokasyon_atama' : involvesVehicle ? 'arac_transfer' : 'depo_transfer';
      const fromLabel = b.from ? (b.from.name || b.from.id) : 'Dış';
      const toLabel = b.to ? (b.to.name || b.to.id) : 'Dış';
      const movId = randomUUID();
      const movData = {
        id: movId, type: b.to ? 'in' : 'out', productId: b.productId, sku: b.sku ?? '',
        productName: b.productName ?? '', quantity: qty, category,
        reason: `Transfer: ${fromLabel} → ${toLabel}`, note: b.note ?? '',
        fromLocation: b.from ?? null, toLocation: b.to ?? null,
        companyId, timestamp: new Date().toISOString(),
        ...(idemKey ? { idempotencyKey: idemKey } : {}),
      };
      await client.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)', ['inventoryMovements', movId, JSON.stringify(movData)]);
      pending.push(() => broadcastDocChange('inventoryMovements', 'set', movId, movData));

      await client.query('COMMIT');
      pending.forEach(fn => fn()); // P13: yalnız COMMIT başarıldıysa yayınla
      res.json({ success: true, movementId: movId, category });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[logistics/transfer]', err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });

  app.post('/api/inventory/auto-reorder', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin unavailable.' });
    try {
      // Kiracı izolasyonu: yalnız çağıranın firmasının (veya etiketsiz legacy)
      // envanterini tara ve SAS'ları o firmaya etiketle — aksi halde tüm
      // kiracıların stoğu okunur ve başka firmaya taslak sipariş yazılırdı.
      const cid = await getUserCompanyId((req as Request & { uid?: string }).uid || '');
      const lowStock: { id: string; name: string; sku: string; stockLevel: number; lowStockThreshold: number; supplier?: string }[] = [];
      for (const item of await loadCompanyDocs('inventory', cid)) { // P8/P9: filtre PG'de
        const stock = Number(item.stockLevel ?? item.quantity ?? 0);
        const threshold = Number(item.lowStockThreshold ?? item.minStock ?? 5);
        if (stock < threshold) {
          lowStock.push({
            id: String(item.id),
            name: String(item.name ?? ''),
            sku:  String(item.sku ?? ''),
            stockLevel: stock,
            lowStockThreshold: threshold,
            supplier: item.supplier as string | undefined,
          });
        }
      }

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
          companyId:   cid, // sunucu-tarafı yazım /api/db injectTenant'ı atlar; elle etiketle
          inventoryId: item.id,
          productName: item.name,
          sku:         item.sku,
          supplier:    item.supplier ?? '',
          quantity:    reorderQty,
          currentStock: item.stockLevel,
          threshold:   item.lowStockThreshold,
          createdAt:   pgServerTimestamp(),
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


  // Mikro rota grubu (36 uc) src/server/routes/mikroRoutes.ts'te.
  //
  // KONUM KRITIK: bu cagri, Mikro ara katmanlarindan SONRA olmali.
  // Ilk denemede mikroLimiter TANIMININ hemen ardina konmustu (degisken
  // hazir olsun diye) - ama `app.use(['/api/mikro/...'], mikroLimiter)` ve
  // `app.use(express.json(...))` DAHA SONRA kayitli. Express'te app.use
  // yalniz KENDINDEN SONRA kaydedilen rotalara uygulanir; yani 36 rotanin
  // hicbirinde hiz sinirlamasi VE GOVDE AYRISTIRMA calismiyordu (req.body
  // undefined). Testlerde 401 gorunuyordu cunku requireAuth govdeye
  // bakmadan reddediyor - hata gizleniyordu.
  //
  // Bagimliliklar ACIK baglam nesnesiyle geciyor - `import` edilseydi
  // server.ts <-> mikroRoutes DONGUSU olusurdu (bkz. modulun basligi).
  mikroRoutes(app, {
    reqActor, writeSyncLog, reqCompanyId, writeAuditLog, tenantSnap,
    mikroIdCozucu, loadCompanyDocs, mikroLimiter, requireCollectionAccess,
    requireAuth, requireMfaVerified,
    // Sonradan atanan baglantilar GETTER ile (bkz. diger modullerdeki gerekce).
    getAdminDb: () => adminDb, getPgPool: () => pgPool,
    getUserCompanyId, mikroIdCozucuIds, validate, getBoss: () => boss,
  });



  /** GET /api/integrations/health — tüm entegrasyonların anahtar/yapılandırma durumu.
   *  Yalnızca boolean durum döner, anahtar değerleri asla dönmez.
   */
  app.get('/api/integrations/health', requireAuth, async (_req: Request, res: Response) => {
    const has = (...keys: string[]) => keys.every(k => !!process.env[k]);
    res.json({
      integrations: [
        { id: 'mikro',       name: 'Mikro ERP (JumpBulut)', configured: has('MIKRO_IDM_EMAIL', 'MIKRO_IDM_PASSWORD', 'MIKRO_API_KEY', 'MIKRO_ALIAS'), requiredKeys: ['MIKRO_IDM_EMAIL', 'MIKRO_IDM_PASSWORD', 'MIKRO_API_KEY', 'MIKRO_ALIAS'], affects: 'Stok/cari/sipariş senkronizasyonu' },
        { id: 'parasut',     name: 'Paraşüt', configured: has('PARASUT_CLIENT_ID', 'PARASUT_CLIENT_SECRET', 'PARASUT_USERNAME', 'PARASUT_PASSWORD', 'PARASUT_COMPANY_ID'), requiredKeys: ['PARASUT_CLIENT_ID', 'PARASUT_CLIENT_SECRET', 'PARASUT_USERNAME', 'PARASUT_PASSWORD', 'PARASUT_COMPANY_ID'], affects: 'Cari/ürün (fiyat dahil)/fatura senkronizasyonu' },
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
  app.post('/api/mikro/token', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
  app.post('/api/admin/cleanup-dummy-inventory', requireAuth, requireMfaVerified, requireAdmin, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const dryRun = !!(req.body as { dryRun?: boolean })?.dryRun;
    try {
      // YALNIZ ÇAĞIRANIN KİRACISI (2026-08-22 denetim bulgusu C8).
      // Eskiden `adminDb.collection('inventory').get()` — TÜM kiracıların
      // envanteri okunuyor ve `source` alanı olmayan HER ürün siliniyordu.
      // Bu uç requireAdmin'li, yani herhangi bir kiracının Admin'i basabilir;
      // basınca başka kiracıların elle girilmiş (source'suz) ürünleri de
      // gidiyordu. Filtre artık SQL'de (loadCompanyDocs). Etiketsiz eski
      // kayıtlar çağıranın kiracısına sayılır (legacy uyumu), ama yabancı
      // kiracının etiketli verisi hiç okunmaz.
      const cid = await reqCompanyId(req);
      const docs = await loadCompanyDocs('inventory', cid);
      const dummies: { ref: PgDocRef; name: string }[] = [];
      const keptBySource = new Map<string, number>();
      for (const d of docs) {
        const source = (d.source as string) || '';
        if (!source) dummies.push({ ref: adminDb.collection('inventory').doc(String(d.id)), name: (d.name as string) || String(d.id) });
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
  app.post('/api/sku-mapping/auto-match', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

    try {
      // 1. Envanterdeki Mikro SKU'ları — P3-5: yalnız çağıranın firması.
      //    Önceden TÜM kiracıların envanteri okunup skuMappings ETİKETSİZ
      //    yazılıyordu (başka firmanın SKU'ları eşleştirilip görünür oluyordu).
      const cid = await getUserCompanyId((req as Request & { uid?: string }).uid || '');
      const invItems: { sku: string; name: string }[] = [];
      for (const item of await loadCompanyDocs('inventory', cid)) {
        const sku = ((item.sku as string) || '').trim();
        if (sku) invItems.push({ sku, name: (item.name as string) || sku });
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
          companyId:   cid, // P3-5: sunucu-taraflı batch write companyId enjekte ETMEZ, elle etiketle
          ...(hit ? {
            shopifySku:       hit.sku,
            shopifyProductId: hit.productId,
            shopifyVariantId: hit.variantId,
            status:           'matched',
            matchType:        'auto',
          } : { status: 'unmatched' }),
          updatedAt: pgServerTimestamp(),
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


  // ── Mutabakat PDF Generation ─────────────────────────────────────────────────
  // GET /api/mutabakat/:leadId  — returns JSON data for client-side PDF generation
  // The client (MutabakatPanel) renders the PDF using jsPDF
  app.get('/api/mutabakat/:leadId', requireAuth, requireCollectionAccess('leads', 'read'), async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin başlatılamadı.' });
    try {
      const leadId = req.params.leadId as string;
      const period     = (req.query.period as string) || new Date().getFullYear().toString();

      // Fetch lead
      // KİRACI SAHİPLİĞİ (C21): leadId URL'den geliyor — başka firmanın müşteri
      // id'siyle onun PII'si, bakiyesi ve sipariş geçmişi okunabiliyordu (IDOR).
      // Yok VEYA yabancı → aynı 404, ki kaydın varlığı bile sızmasın.
      const lead = await sahipliDoc(req, 'leads', leadId);
      if (!lead) return res.status(404).json({ error: 'Müşteri bulunamadı.' });

      // Fetch open orders
      const ordersSnap = await adminDb.collection('orders')
        .where('leadId', '==', leadId)
        .where('status', 'in', ['Pending', 'Processing', 'Shipped'])
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      const orders = ordersSnap.docs.map(d => {
        const o = d.data() as Record<string, unknown>;
        const ts = (o.createdAt as Timestamp);
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


  // ══ Paraşüt entegrasyonu (Mikro alternatifi, OAuth2 v4 API) ════════════════
  // ERPHubPanel'de activeErp tekil olduğu için Mikro ile karşılıklı dışlamalı.
  // Mikro V16'nın aksine ürün fiyatını + cari bakiyeyi API'den verir.
  interface ParasutCreds { clientId: string; clientSecret: string; username: string; password: string; companyId: string; }
  async function getParasutCreds(): Promise<ParasutCreds | null> {
    if (process.env.PARASUT_CLIENT_ID && process.env.PARASUT_CLIENT_SECRET
        && process.env.PARASUT_USERNAME && process.env.PARASUT_PASSWORD && process.env.PARASUT_COMPANY_ID) {
      return {
        clientId: process.env.PARASUT_CLIENT_ID, clientSecret: process.env.PARASUT_CLIENT_SECRET,
        username: process.env.PARASUT_USERNAME, password: process.env.PARASUT_PASSWORD,
        companyId: process.env.PARASUT_COMPANY_ID,
      };
    }
    if (!adminDb) return null;
    try {
      const snap = await adminDb.collection('settings').doc('parasut').get();
      if (!snap.exists) return null;
      const d = snap.data() as Record<string, unknown>;
      const c = {
        clientId: d.clientId as string, clientSecret: d.clientSecret as string,
        username: d.username as string, password: d.password as string, companyId: d.companyId as string,
      };
      return c.clientId && c.clientSecret && c.username && c.password && c.companyId ? c : null;
    } catch { return null; }
  }

  let parasutToken: { access: string; refresh: string; exp: number } | null = null;
  const PARASUT_BASE = 'https://api.parasut.com';
  async function getParasutToken(creds: ParasutCreds): Promise<string> {
    if (parasutToken && parasutToken.exp > Date.now() + 60_000) return parasutToken.access;
    const body = parasutToken?.refresh
      ? { grant_type: 'refresh_token', client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: parasutToken.refresh }
      : { grant_type: 'password', client_id: creds.clientId, client_secret: creds.clientSecret, username: creds.username, password: creds.password, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob' };
    let res = await fetch(`${PARASUT_BASE}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok && parasutToken?.refresh) {
      parasutToken = null;
      res = await fetch(`${PARASUT_BASE}/oauth/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'password', client_id: creds.clientId, client_secret: creds.clientSecret, username: creds.username, password: creds.password, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob' }),
      });
    }
    if (!res.ok) throw new Error(`Paraşüt token alınamadı: HTTP ${res.status}`);
    const j = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    parasutToken = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in * 1000) };
    return parasutToken.access;
  }

  async function parasutGetAll(creds: ParasutCreds, resource: string, params = ''): Promise<Record<string, unknown>[]> {
    const token = await getParasutToken(creds);
    const out: Record<string, unknown>[] = [];
    for (let page = 1; page <= 200; page++) {
      const url = `${PARASUT_BASE}/v4/${creds.companyId}/${resource}?page[number]=${page}&page[size]=25${params}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!res.ok) break;
      const j = await res.json() as { data?: Record<string, unknown>[] };
      const rows = j.data ?? [];
      if (!rows.length) break;
      out.push(...rows);
      if (rows.length < 25) break;
    }
    return out;
  }

  app.get('/api/parasut/status', requireAuth, async (_req: Request, res: Response) => {
    const creds = await getParasutCreds();
    if (!creds) return res.json({ configured: false, connected: false, message: 'Paraşüt yapılandırılmamış.' });
    try {
      await getParasutToken(creds);
      res.json({ configured: true, connected: true, message: 'Paraşüt bağlantısı başarılı.' });
    } catch (e) {
      res.json({ configured: true, connected: false, error: (e as Error).message });
    }
  });

  app.post('/api/parasut/import/cari', requireAuth, requireMfaVerified, requireAdmin, async (req: Request, res: Response) => {
    const creds = await getParasutCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'DB yok.' });
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await reqCompanyId(req);
    const t0 = Date.now();
    try {
      const contacts = await parasutGetAll(creds, 'contacts');
      // KİRACI SINIRI: Mikro cari import'unda bulunan sınıfın aynısı.
      const leadSnap = await tenantSnap('leads', companyId);
      const byParasutId = new Map<string, PgDocRef>();
      const byVkn = new Map<string, PgDocRef>();
      const byName = new Map<string, PgDocRef>();
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
      let batch = adminDb.batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = adminDb!.batch(); ops = 0; } };
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
          updatedAt: pgServerTimestamp(),
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
          const newRef = adminDb.collection('leads').doc();
          batch.set(newRef, { ...fields, status: 'Active', createdAt: pgServerTimestamp() });
          byParasutId.set(pid, newRef);
          created++;
        }
        if (++ops >= 400) await flush();
      }
      await flush();
      await writeAuditLog(reqActor(req), 'Paraşüt Cari İçe Aktarma', `${created} yeni / ${updated} güncel`);
      res.json({ success: true, created, updated, total: contacts.length, duration: Date.now() - t0 });
    } catch (e) { res.status(500).json({ success: false, error: (e as Error).message }); }
  });

  app.post('/api/parasut/import/stok', requireAuth, requireMfaVerified, requireAdmin, async (req: Request, res: Response) => {
    const creds = await getParasutCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'DB yok.' });
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await reqCompanyId(req);
    const t0 = Date.now();
    try {
      const products = await parasutGetAll(creds, 'products');
      // KİRACI SINIRI: fiyat/barkod/BOM import'unda bulunan sınıfın aynısı —
      // filtre yoktu. EAN barkod gibi SKU'lar farklı kiracılar arasında DOĞAL
      // olarak çakışabilir (aynı fiziksel ürünü satan iki toptancı); bu uç ise
      // name/unit/vatRate/stockLevel/price/prices'ın HEPSİNİ güncelliyordu —
      // barkod/fiyattan daha geniş bir etki alanı.
      const invSnap = await tenantSnap('inventory', companyId);
      const bySku = new Map<string, PgDocRef>();
      for (const d of invSnap.docs) {
        const veri = d.data() as Record<string, unknown>;
        const dc = (veri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const sku = ((veri.sku as string) || '').trim();
        if (sku && !bySku.has(sku)) bySku.set(sku, d.ref);
      }
      let created = 0, updated = 0;
      let batch = adminDb.batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = adminDb!.batch(); ops = 0; } };
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
          updatedAt: pgServerTimestamp(),
          companyId, // güncellemede de etiketle (self-heal)
        };
        const ref = bySku.get(sku);
        if (ref) { batch.update(ref, fields); updated++; }
        else { batch.set(adminDb.collection('inventory').doc(), { ...fields, sku, category: 'Genel', lowStockThreshold: 5, costPrice: 0, createdAt: pgServerTimestamp() }); created++; }
        if (++ops >= 400) await flush();
      }
      await flush();
      await writeAuditLog(reqActor(req), 'Paraşüt Stok İçe Aktarma', `${created} yeni / ${updated} güncel (fiyat dahil)`);
      res.json({ success: true, created, updated, total: products.length, duration: Date.now() - t0 });
    } catch (e) { res.status(500).json({ success: false, error: (e as Error).message }); }
  });

  app.post('/api/parasut/fatura', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    const creds = await getParasutCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });
    const { order } = req.body as { order: Record<string, unknown> };
    if (!order) return res.status(400).json({ success: false, error: 'order zorunlu.' });
    const t0 = Date.now();
    try {
      const token = await getParasutToken(creds);
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
      await writeSyncLog('ParasutFatura', 'order', String(order.id ?? 'unknown'), success, null, success ? null : `HTTP ${r.status}`, Date.now() - t0, reqActor(req));
      res.json({ success, data, duration: Date.now() - t0 });
    } catch (e) { res.status(500).json({ success: false, error: (e as Error).message }); }
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
  app.post('/api/trendyol/sync', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
            updatedAt:       pgServerTimestamp(),
          };
          if (existing.empty) {
            await adminDb.collection('orders').add({ companyId: await reqCompanyId(req), ...payload, createdAt: pgServerTimestamp() });
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
  app.post('/api/hepsiburada/sync', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
            updatedAt:          pgServerTimestamp(),
          };
          if (existing.empty) {
            await adminDb.collection('orders').add({ companyId: await reqCompanyId(req), ...payload, createdAt: pgServerTimestamp() });
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
  app.post('/api/whatsapp/send', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
            companyId: await reqCompanyId(req),
            to: phone, message: message ?? templateName ?? '', status: 'sent',
            provider: '360dialog', messageId: (data as Record<string, unknown>).messages,
            createdAt: pgServerTimestamp(),
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
            companyId: await reqCompanyId(req),
            to: phone, message: message ?? '', status: 'sent',
            provider: 'twilio', messageId: (data as Record<string, unknown>).sid,
            createdAt: pgServerTimestamp(),
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
  app.get('/api/aging', requireAuth, requireCollectionAccess('orders', 'read'), async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin not initialised' });
    try {
      const customerId = req.query.customerId as string | undefined;
      // KİRACI FİLTRESİ SORGUDA, DÖNGÜDE DEĞİL (2026-08-22 denetim bulgusu C21).
      //
      // Bu uç eskiden TÜM firmaların açık siparişlerini (müşteri adı, tutar)
      // döndürüyordu. İlk düzeltme filtreyi döngüye koymuştu — ama `.limit(500)`
      // filtreden ÖNCE çalıştığı için 500'lük pencere bütün kiracılar arasında
      // paylaşılıyordu: ikinci kiracının hacmi arttığında A'nın ESKİ açık
      // alacakları pencereden düşüyor ve A'nın yaşlandırma raporu sessizce
      // eksik çıkıyordu (gecikmiş alacak olduğundan az görünür). tenantSnap
      // kiracıyı SQL'de süzer; 500 tavanı artık yalnız çağıranın kendi
      // siparişlerine uygulanır.
      const cidAging = await reqCompanyId(req);
      const ACIK_DURUMLAR = ['Pending', 'Processing', 'Shipped'];
      // Durum + tavan SQL'DE: kiracı düzeltmesi yapılırken eski sorgunun
      // `status IN (...) ORDER BY createdAt DESC LIMIT 500` kısmı düşmüştü ve
      // uç, kiracının TÜM sipariş geçmişini (her satırın lineItems gövdesiyle)
      // Node'a çekip JS'te süzüyordu (code-review bulgusu). Tavan yine 500 ama
      // artık kiracı-içi ve DB tarafında.
      const tumu = await tenantSnap('orders', cidAging, {
        durumlar: ACIK_DURUMLAR, siralaAlanDesc: 'createdAt', tavan: 500,
      });
      const now = Date.now();
      const zaman = (v: unknown): number => {
        const t = (v as Timestamp)?.toMillis?.();
        if (typeof t === 'number') return t;
        if (typeof v === 'number') return v;
        const ms = Date.parse(String(v ?? ''));
        return Number.isFinite(ms) ? ms : now;
      };
      // Durum/tavan yukarıda SQL'de uygulandı; burada yalnız isteğe bağlı
      // müşteri süzgeci ve createdAt'in üç biçimini (Timestamp/ISO/epoch)
      // doğru karşılaştıran kesin sıralama kalıyor.
      const secili = tumu.docs
        .filter(d => !customerId || d.data().leadId === customerId)
        .sort((a, b) => zaman(b.data().createdAt) - zaman(a.data().createdAt));
      const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
      const rows: Record<string, unknown>[] = [];
      for (const doc of secili) {
        const o = doc.data() as Record<string, unknown>;
        const createdMs = zaman(o.createdAt);
        const ageD = Math.floor((now - createdMs) / 86400000);
        const amount = Number(o.totalPrice ?? o.totalAmount ?? 0);
        if (ageD <= 30)      buckets.current += amount;
        else if (ageD <= 60) buckets.d30     += amount;
        else if (ageD <= 90) buckets.d60     += amount;
        else if (ageD <= 120) buckets.d90    += amount;
        else                  buckets.over90 += amount;
        rows.push({ id: doc.id, customerName: o.customerName, amount, ageD, status: o.status, createdAt: (o.createdAt as Timestamp)?.toDate?.()?.toISOString() });
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

  async function sendEmail(to: string, subject: string, html: string, fromOverride?: string, replyTo?: string): Promise<{ id?: string; error?: string }> {
    const creds = await getResendKey();
    if (!creds) return { error: 'notConfigured' };
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:     fromOverride ?? creds.from,
        to:       [to],
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
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
  app.post('/api/email/send', requireAuth, requireMfaVerified, requireStaff, async (req: Request, res: Response) => {
    const body = validate(EmailSendSchema, req.body, res);
    if (!body) return;
    const result = await sendEmail(body.to, body.subject, body.html, body.from, body.replyTo);
    if (result.error === 'notConfigured') return res.status(503).json({ success: false, notConfigured: true });
    if (result.error) return res.status(500).json({ success: false, error: result.error });
    res.json({ success: true, id: result.id });
  });

  // POST /api/email/order-notification
  // Body: { orderId, status, customerEmail } — sends branded status email
  app.post('/api/email/order-notification', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    const { orderId, status, customerEmail, customerName, orderNo, lang = 'tr' } =
      req.body as { orderId: string; status: string; customerEmail: string; customerName: string; orderNo?: string; lang?: string };
    if (!customerEmail) return res.status(400).json({ success: false, error: 'customerEmail gerekli.' });

    const trackUrl = `${req.protocol}://${req.get('host')}/?track=${encodeURIComponent(orderId)}`;
    const tr = lang === 'tr';
    const eName = escapeHtml(customerName); // HTML injection engeli
    const eOrderNo = escapeHtml(orderNo ?? orderId.slice(0, 8).toUpperCase());

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
    <p style="margin:0 0 8px;font-size:14px;color:#374151;">${tr ? `Sayın ${eName},` : `Dear ${eName},`}</p>
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
      <p style="margin:4px 0 0;font-size:20px;font-weight:800;color:#1a3a5c;font-family:monospace;">#${eOrderNo}</p>
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
        companyId: await reqCompanyId(req),
        orderId, to: customerEmail, subject: subjectText, status, sentAt: pgServerTimestamp(),
      });
    }
    res.json({ success: true, id: result.id });
  });

  // ── Davet Kullanimi (redeem) ──────────────────────────────────────────────
  // POST /api/invites/redeem  Body: { token }
  //
  // Bu uc EKSIKTI: /api/admin/invite ve super-admin daveti `invites/{token}`
  // dokumanini YAZIYOR ama hicbir yer OKUMUYORDU. Sonuc: davetteki rol ve
  // companyId hicbir zaman uygulanmiyor, davetle gelen herkes App.tsx'teki
  // varsayilan dala dusup 'Sales' + kendi uid'i ile aciliyordu (rolsuz hesap
  // kapisi eklendikten sonra ise dogrudan "rol atanmamis" ekranina).
  //
  // requireAdmin YOK — daveti kullanan kisi hentiz rolsuz normal bir
  // kullanicidir; yetki kontrolu davetin KENDISIDIR (token + e-posta esmesi).
  app.post('/api/invites/redeem', authLimiter, requireAuth, async (req: Request, res: Response) => {
    const { token } = (req.body ?? {}) as { token?: string };
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, error: 'Davet kodu gerekli.' });
    }
    if (!adminDb) return res.status(503).json({ success: false, error: 'Veritabanı kullanılamıyor.' });

    const { uid, email } = reqActor(req);
    try {
      const snap = await adminDb.collection('invites').doc(token).get();
      if (!snap.exists) return res.status(404).json({ success: false, error: 'Davet bulunamadı.' });
      const inv = snap.data() as { email?: string; role?: string; companyId?: string; expiresAt?: string; used?: boolean };

      if (inv.used) return res.status(409).json({ success: false, error: 'Bu davet daha önce kullanılmış.' });
      if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) {
        return res.status(410).json({ success: false, error: 'Davetin süresi dolmuş.' });
      }
      // E-POSTA ESLESMESI ZORUNLU: davet baglantisi ele gecirilse bile baskasi
      // kullanamaz. Kucuk/buyuk harf duyarsiz karsilastirma.
      const davetEposta = (inv.email || '').trim().toLowerCase();
      const girenEposta = (email || '').trim().toLowerCase();
      if (!davetEposta || !girenEposta || davetEposta !== girenEposta) {
        return res.status(403).json({ success: false, error: 'Bu davet başka bir e-posta adresi için oluşturulmuş.' });
      }
      // Rol, davet yazilirken dogrulanmisti; yine de burada TEKRAR dogrula —
      // eski/bozuk bir davet dokumani uydurma rol tasiyor olabilir (Accountant,
      // Warehouse, Viewer gibi; bkz. APP_ROLES yorumu).
      if (!inv.role || !(APP_ROLES as readonly string[]).includes(inv.role)) {
        return res.status(422).json({ success: false, error: 'Davetteki rol artık geçerli değil. Yöneticinizden yeni davet isteyin.' });
      }

      const guncelleme: Record<string, unknown> = { role: inv.role };
      // companyId davet dokumanindan gelir — istemciden ASLA alinmaz, aksi
      // halde kullanici istedigi kiraciya katilabilirdi.
      if (inv.companyId) guncelleme.companyId = inv.companyId;

      await adminDb.collection('users').doc(uid).set(guncelleme, { merge: true });
      await adminDb.collection('invites').doc(token).set(
        { used: true, usedAt: pgServerTimestamp(), usedBy: uid },
        { merge: true },
      );

      void writeAuditLog({ uid, email }, 'Davet kullanıldı', `${email} → ${inv.role}${inv.companyId ? ` (firma: ${inv.companyId})` : ''}`);
      return res.json({ success: true, role: inv.role, companyId: inv.companyId ?? null });
    } catch (e) {
      console.error('Davet kullanım hatası:', (e as Error).message);
      return res.status(500).json({ success: false, error: 'Davet işlenemedi.' });
    }
  });

  // ── Admin: User Invite ────────────────────────────────────────────────────
  // POST /api/admin/invite — sends invite email via Resend, stores invite doc in Firestore
  // Body: { email, role }
  app.post('/api/admin/invite', authLimiter, requireAuth, requireMfaVerified, requireAdmin, async (req: Request, res: Response) => {
    const { email, role = 'Sales' } = req.body as { email: string; role?: string };
    if (!email || !isValidEmail(email)) return res.status(400).json({ success: false, error: 'Geçerli e-posta gerekli.' });
    if (!(APP_ROLES as readonly string[]).includes(role)) {
      return res.status(400).json({ success: false, error: `Geçersiz rol. Geçerli roller: ${APP_ROLES.join(', ')}` });
    }

    // Generate a random token
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    // Store invite in Firestore (if admin available)
    if (adminDb) {
      try {
        await adminDb.collection('invites').doc(token).set({
          companyId: await reqCompanyId(req),
          email, role, token, expiresAt,
          createdAt: pgServerTimestamp(),
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
        CETPA B2B platformuna <strong>${escapeHtml(role)}</strong> rolüyle davet edildiniz.
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
  app.post('/api/email/bulk-campaign', requireAuth, requireMfaVerified, requireStaff, async (req: Request, res: Response) => {
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
        completedAt: pgServerTimestamp(),
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
      const configs = snap.docs.map(d => ({ id: d.id, ...d.data() } as { id: string; url: string; events: string[]; enabled: boolean; secret?: string }));
      const targets = configs.filter(c => (c.events ?? []).includes(event));
      await Promise.allSettled(targets.map(async c => {
        if (boss) {
          await boss.send('outbound-webhook', { url: c.url, secret: c.secret, event, payload });
        } else {
          await processOutboundWebhook({ url: c.url, secret: c.secret, event, payload }).catch(() => {});
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
  app.post('/api/webhooks/test', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    const { url } = req.body as { url: string };
    if (!url || !isSafePublicUrl(url)) return res.status(400).json({ error: 'Geçerli bir public http(s) URL gerekli (iç ağ adresleri engellidir).' });
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
  app.get('/api/reports/summary', requireAuth, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    try {
      const now       = new Date();
      const d30       = new Date(now); d30.setDate(d30.getDate() - 30);
      const d60       = new Date(now); d60.setDate(d60.getDate() - 60);

      // Kiracı izolasyonu + P8/P9: filtre PG'de, tüm koleksiyon belleğe çekilmez.
      const cid = await getUserCompanyId((req as Request & { uid?: string }).uid || '');
      const [orders, leads, inventory] = await Promise.all([
        loadCompanyDocs('orders', cid),
        loadCompanyDocs('leads', cid),
        loadCompanyDocs('inventory', cid),
      ]);

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

  // ── Stok Fiyat Karşılaştırma (alım vs satım ortalama fiyat) ────────────────
  // Mikro'da hazır bir rapor değil — STOK_HAREKETLERI satır bazlı hareketleri
  // (sth_stok_kod/sth_miktar/sth_tutar/sth_tip) zaten inventoryMovements'a
  // çekiliyor (/api/mikro/import/stok-hareket). Burada SKU+yön bazında
  // ağırlıklı ortalama fiyat (SUM(tutar)/SUM(miktar)) hesaplanır — InventoryView.tsx'in
  // kanıtlı normalize deseniyle aynı formül (birimFiyat = tutar/miktar, KDV hariç,
  // sth_tip 0=giriş/alış 1=çıkış/satış). Native (Cetpa) hareketlerde fiyat alanı
  // hiç yok (InventoryMovement tipi) — yalnız Mikro satırları (sth_stok_kod dolu
  // olanlar) hesaba katılır, bu bir eksiklik değil.
  app.get('/api/reports/stok-fiyat-karsilastirma', requireAuth, async (req: Request, res: Response) => {
    try {
      const cid = await getUserCompanyId((req as Request & { uid?: string }).uid || '');
      const [movements, inventory] = await Promise.all([
        loadCompanyDocs('inventoryMovements', cid),
        loadCompanyDocs('inventory', cid),
      ]);
      const adMap = new Map<string, string>();
      const stokMap = new Map<string, number>();
      for (const it of inventory) {
        const rec = it as Record<string, unknown>;
        const sku = String(rec.sku ?? '').trim();
        if (!sku) continue;
        adMap.set(sku, String(rec.name ?? sku));
        // Kalan stok — hareket bazlı alış-satış netine DEĞİL, inventory.stockLevel'a
        // (gerçek/güncel stok) dayanır: hareket penceresi tüm geçmişi kapsamayabilir
        // (açılış bakiyesi, transfer, sayım farkı gibi alış/satış dışı hareketler),
        // stockLevel Mikro gece senkronundan gelen otoriter değer (2026-08-13).
        stokMap.set(sku, Number(rec.stockLevel ?? 0));
      }

      type Grup = { alisTutar: number; alisMiktar: number; alisAdet: number; satisTutar: number; satisMiktar: number; satisAdet: number };
      const gruplar = new Map<string, Grup>();
      for (const m of movements) {
        const sku = String(m.sth_stok_kod ?? '').trim();
        if (!sku) continue; // native (Cetpa) hareketi — fiyat alanı yok, atla
        const iptal = m.sth_iptal === true || Number(m.sth_iptal ?? 0) === 1;
        if (iptal) continue;
        const miktar = Math.abs(Number(m.sth_miktar) || 0);
        const tutar = Math.abs(Number(m.sth_tutar) || 0);
        if (miktar <= 0) continue;
        const g = gruplar.get(sku) ?? { alisTutar: 0, alisMiktar: 0, alisAdet: 0, satisTutar: 0, satisMiktar: 0, satisAdet: 0 };
        if (Number(m.sth_tip) === 0) { g.alisTutar += tutar; g.alisMiktar += miktar; g.alisAdet++; }
        else                         { g.satisTutar += tutar; g.satisMiktar += miktar; g.satisAdet++; }
        gruplar.set(sku, g);
      }

      const rows = [...gruplar.entries()].map(([sku, g]) => {
        const alisOrt  = g.alisMiktar  > 0 ? g.alisTutar  / g.alisMiktar  : null;
        const satisOrt = g.satisMiktar > 0 ? g.satisTutar / g.satisMiktar : null;
        const marj = alisOrt != null && satisOrt != null ? satisOrt - alisOrt : null;
        const marjYuzde = marj != null && alisOrt ? (marj / alisOrt) * 100 : null;
        return {
          sku, ad: adMap.get(sku) ?? sku,
          alisOrtFiyat: alisOrt, alisMiktar: g.alisMiktar, alisTutar: g.alisTutar, alisAdet: g.alisAdet,
          satisOrtFiyat: satisOrt, satisMiktar: g.satisMiktar, satisTutar: g.satisTutar, satisAdet: g.satisAdet,
          marjTL: marj, marjYuzde,
          kalanStok: stokMap.has(sku) ? stokMap.get(sku)! : null,
        };
      }).sort((a, b) => (b.alisTutar + b.satisTutar) - (a.alisTutar + a.satisTutar));

      res.json({ success: true, rows, toplamSku: rows.length });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // GET /api/reports/stok-fiyat-karsilastirma/:sku/detay — bir SKU'nun tüm alım/satım satırları
  app.get('/api/reports/stok-fiyat-karsilastirma/:sku/detay', requireAuth, async (req: Request, res: Response) => {
    try {
      const sku = String(req.params['sku'] || '').trim();
      if (!sku) return res.status(400).json({ success: false, error: 'sku gerekli.' });
      const cid = await getUserCompanyId((req as Request & { uid?: string }).uid || '');
      const movements = await loadCompanyDocs('inventoryMovements', cid);
      const satirlar = movements
        .filter(m => String(m.sth_stok_kod ?? '').trim() === sku)
        .filter(m => !(m.sth_iptal === true || Number(m.sth_iptal ?? 0) === 1))
        .map(m => {
          const miktar = Math.abs(Number(m.sth_miktar) || 0);
          const tutar = Math.abs(Number(m.sth_tutar) || 0);
          return {
            tarih: m.sth_tarih ?? null,
            yon: Number(m.sth_tip) === 0 ? 'alis' as const : 'satis' as const,
            miktar, tutar,
            birimFiyat: miktar > 0 ? tutar / miktar : 0,
            cariKod: m.sth_cari_kodu ?? m.sth_cari_kod ?? null,
            evrakNo: [m.sth_evrakno_seri, m.sth_evrakno_sira].filter(v => v !== '' && v != null).join('-') || null,
          };
        })
        .sort((a, b) => String(b.tarih ?? '').localeCompare(String(a.tarih ?? '')));
      res.json({ success: true, sku, satirlar, toplam: satirlar.length });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Public Order Tracking ──────────────────────────────────────────────────
  // GET /api/track/:orderId — no auth required
  // Returns sanitised order data safe to expose to customers

  app.get('/api/track/:orderId', trackLimiter, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin unavailable.' });
    const orderId = req.params['orderId'] as string;
    try {
      const snap = await adminDb.collection('orders').doc(orderId).get();
      if (!snap.exists) return res.status(404).json({ success: false, error: 'Sipariş bulunamadı.' });
      const o = snap.data() as Record<string, unknown>;
      // Return only safe fields — no email, payment info, or internal refs.
      // Kimlik doğrulaması YOK: tek sır sipariş id'sinin kendisi (genDocId, 20
      // karakter × 62'lik alfabe ≈ 119 bit — sayımla bulunamaz). Ama bağlantı
      // paylaşılabilir/iletilebilir olduğu için PII asgariye indirilir: ad
      // kısaltılır, adresin yalnız ilçe/il kuyruğu gösterilir. Tam adres ve
      // e-posta oturum açmış personelde kalır.
      res.json({
        success: true,
        order: {
          id:                orderId,
          orderNo:           (o.shopifyOrderId as string | undefined) ?? orderId.slice(0, 8).toUpperCase(),
          customerName:      maskName(o.customerName as string | undefined),
          status:            o.status,
          trackingNumber:    o.trackingNumber ?? null,
          shippingAddress:   maskAddress(o.shippingAddress),
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
      // Kimliksiz uç — ham hata metni (SQL/şema ipuçları) dışarı verilmez.
      console.error('[/api/track]', e instanceof Error ? e.message : String(e));
      res.status(500).json({ success: false, error: 'Sipariş bilgisi alınamadı.' });
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
  app.post('/api/luca/sync/yevmiye', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
  app.post('/api/luca/sync/fatura', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
          companyId: await reqCompanyId(req),
          lucaFaturaNo,
          lucaSynced:   true,
          lucaSyncedAt: pgServerTimestamp(),
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
  app.post('/api/luca/sync/stok', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
          updatedAt:  pgServerTimestamp(),
          companyId:  await reqCompanyId(req), // tenant etiketi (create+update, self-heal)
        };
        if (snap.exists) { batch.update(ref, data2); updated++; }
        else             { batch.set(ref, { ...data2, createdAt: pgServerTimestamp() }); created++; }
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
  app.post('/api/iyzico/payment-link', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
          companyId: await reqCompanyId(req),
          iyzicoPaymentUrl:   d.paymentPageUrl,
          iyzicoToken:        d.token,
          iyzicoCreatedAt:    pgServerTimestamp(),
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
  app.post('/api/whatsapp/order-notification', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
          companyId: await reqCompanyId(req),
          to: phone, orderId: orderId ?? null, orderNo: no, status,
          messageId:  result.messageId ?? null,
          error:      result.error ?? null,
          sentAt:     pgServerTimestamp(),
        });
      }
      if (!result.error) await writeAuditLog(reqActor(req), 'WhatsApp Sipariş Bildirimi', `${phone} — sipariş durumu: ${status}`);
      res.json({ success: !result.error, messageId: result.messageId, error: result.error });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Gemini AI Proxy — key never leaves the server ────────────────────────
  // Öncelik (2026-07-20'de TERS ÇEVRİLDİ): Firestore settings/aiConfig (UI) →
  // GEMINI_API_KEY env → Vertex AI. Neden: env anahtarının projesi bayatlayınca
  // (free-tier kotası 0'a çekildi) kullanıcı UI'dan yeni anahtar girip RDP'siz
  // düzeltemiyordu — env, UI anahtarını gölgeliyordu. Artık UI kazanır.
  const PLACEHOLDERS_GEMINI = ['your_gemini_api_key_here', ''];
  const geminiApiKeyEnv = process.env.GEMINI_API_KEY ?? '';
  let geminiClient: GoogleGenAI | null = null;

  // Varsayılan model: 'latest' alias'ı — Google eski modelleri emekliye ayırınca
  // (2026-07: gemini-2.0-flash free-tier kotası 0'a çekildi → tüm AI çağrıları
  // 429) alias otomatik güncel modele kayar. Override: env GEMINI_MODEL veya
  // settings/aiConfig.geminiModel.
  const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  // Emekli model adları (1.x, 2.0): eski istemci bundle'ından gelirse varsayılana çevir.
  const LEGACY_GEMINI_MODEL_RE = /^gemini-(1\.|2\.0)/;
  const resolveGeminiModel = (requested?: string): string => {
    if (requested && !LEGACY_GEMINI_MODEL_RE.test(requested)) return requested;
    return geminiKeyCache?.model || DEFAULT_GEMINI_MODEL;
  };

  // Sunucunun anahtarı hangi kaynaktan aldığını (firestore/env/vertex) raporlar.
  const geminiKeySource = (): 'env' | 'vertex' | 'firestore' | 'none' => {
    if (geminiKeyCache?.key) return 'firestore';
    if (geminiApiKeyEnv && !PLACEHOLDERS_GEMINI.includes(geminiApiKeyEnv)) return 'env';
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return 'vertex';
    return 'none';
  };

  async function resolveGeminiClient(): Promise<GoogleGenAI | null> {
    // 1. UI'dan kaydedilen anahtar ÖNCELİKLİ (settings/aiConfig; 5 dk cache,
    //    kayıt anında invalidateGeminiKeyCache ile tazelenir).
    if (adminDb) {
      const now = Date.now();
      if (!geminiKeyCache || now - geminiKeyCache.ts > 5 * 60 * 1000) {
        try {
          const snap = await adminDb.collection('settings').doc('aiConfig').get();
          geminiKeyCache = {
            key: (snap.data()?.geminiApiKey as string) ?? '',
            model: (snap.data()?.geminiModel as string) ?? '',
            ts: now,
          };
          if (geminiKeyCache.key) console.log('Gemini client: Firestore key mode ✓');
        } catch { geminiKeyCache = { key: '', model: '', ts: now }; }
      }
      if (geminiKeyCache?.key) return new GoogleGenAI({ apiKey: geminiKeyCache.key });
    }
    // 2. Env
    if (geminiApiKeyEnv && !PLACEHOLDERS_GEMINI.includes(geminiApiKeyEnv)) {
      return geminiClient ?? (geminiClient = new GoogleGenAI({ apiKey: geminiApiKeyEnv }));
    }
    // 3. Vertex AI
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return geminiClient ?? (geminiClient = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: 'us-central1' }));
    }
    return null;
  }

  if (geminiApiKeyEnv && !PLACEHOLDERS_GEMINI.includes(geminiApiKeyEnv)) {
    geminiClient = new GoogleGenAI({ apiKey: geminiApiKeyEnv });
    console.log('Gemini client: env anahtarı mevcut (yedek — UI/settings anahtarı önceliklidir) ✓');
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
   * GET /api/ai/status — hangi kaynaktan anahtar kullanılıyor (env/vertex/firestore/none).
   * Canlı API çağrısı YOK (bedelsiz). UI'da "hangi anahtar geçerli" göstermek için.
   * Önemli: env veya vertex varsa, UI'dan (settings/aiConfig) kaydedilen anahtar
   * GÖLGELENİR (kullanılmaz) — bu uç bunu açığa çıkarır.
   */
  // Hata mesajından anahtar-benzeri materyali temizle (Google GenAI hataları bazen
  // ?key=AIza... içerir). requireAdmin ile birlikte savunma-derinliği.
  const safeAiError = (msg: string) => msg
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza***')
    .replace(/key=[^&\s"']+/gi, 'key=***');

  app.get('/api/ai/status', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    const client = await resolveGeminiClient(); // firestore önbelleğini doldurur
    res.json({ configured: !!client, source: client ? geminiKeySource() : 'none' });
  });

  /**
   * POST /api/ai/test — kaydedilen anahtarı UÇTAN UCA doğrular: gerçek (küçük) bir
   * generateContent çağrısı yapar, başarı/hata + kullanılan kaynağı döner.
   * Hata durumunda da 200 döner (ok:false) ki istemci gerçek hata mesajını görsün.
   * requireAdmin: hata mesajı env anahtarını sızdırabilir → yalnız yöneticiye.
   */
  app.post('/api/ai/test', requireAuth, requireMfaVerified, requireAdmin, async (_req: Request, res: Response) => {
    const client = await resolveGeminiClient();
    if (!client) return res.status(200).json({ ok: false, source: 'none', error: 'AI yapılandırılmamış — Ayarlar → AI bölümünden Gemini API anahtarını girin.' });
    const source = geminiKeySource();
    const model = resolveGeminiModel();
    try {
      const r = await client.models.generateContent({ model, contents: 'ping' });
      return res.json({ ok: true, source, model, sample: (r.text ?? '').slice(0, 40) });
    } catch (e) {
      return res.status(200).json({ ok: false, source, model, error: safeAiError(e instanceof Error ? e.message : String(e)) });
    }
  });

  // Watchdog'un günlük AI sağlık kontrolü (runOpsWatchdog check 7 buradan çağırır).
  aiHealthProbe = async () => {
    const client = await resolveGeminiClient();
    if (!client) return { ok: true, detail: 'AI yapılandırılmamış, atlandı' };
    const model = resolveGeminiModel();
    try {
      await client.models.generateContent({ model, contents: 'ping' });
      return { ok: true, detail: `${model} yanıt veriyor (kaynak: ${geminiKeySource()})` };
    } catch (e) {
      return { ok: false, detail: `${model}: ` + safeAiError(e instanceof Error ? e.message : String(e)) };
    }
  };

  /**
   * POST /api/ai/generate
   * Body: { prompt, model?, systemInstruction?, thinkingLevel?, jsonSchema? }
   * Returns: { text: string }
   * Used by: geminiService.ts (lead scoring, dashboard analysis, FMEA, 8D)
   */
  app.post('/api/ai/generate', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    const client = await resolveGeminiClient();
    if (!client) return res.status(503).json({ error: 'AI service not configured. Enter your Gemini API key in Settings → AI.' });
    const { prompt, model, systemInstruction, thinkingLevel, jsonSchema } = req.body as {
      prompt: string; model?: string; systemInstruction?: string;
      thinkingLevel?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'; jsonSchema?: unknown;
    };
    if (!prompt) return res.status(400).json({ error: 'prompt is required.' });
    try {
      const response = await client.models.generateContent({
        model: resolveGeminiModel(model),
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
  app.post('/api/ai/chat', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    const client = await resolveGeminiClient();
    if (!client) return res.status(503).json({ error: 'AI service not configured. Enter your Gemini API key in Settings → AI.' });
    const chatValidated = validate(AiChatSchema, { message: req.body?.message, context: req.body?.systemInstruction, language: req.body?.language }, res);
    if (!chatValidated) return;
    const { message, history = [], systemInstruction, model, highThinking = false } = req.body as {
      message: string;
      history?: { role: string; parts: { text: string }[] }[];
      systemInstruction?: string;
      model?: string;
      highThinking?: boolean;
    };
    if (!message) return res.status(400).json({ error: 'message is required.' });
    try {
      const chat = client.chats.create({
        model: resolveGeminiModel(model),
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
  app.post('/api/ai/demand-forecast', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
        model: resolveGeminiModel(),
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

  /**
   * POST /api/stripe/create-checkout
   * Body: { planId, cycle }
   * Returns: { url: string } — Stripe Checkout hosted URL
   * Protected by Firebase Auth (requireAuth).
   */
  app.post('/api/stripe/create-checkout', paymentLimiter, requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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

    res.sendStatus(200);
    if (boss) {
      // P5-1: event.id başına tekilleştir — aynı olayın eşzamanlı iki teslimatı
      // handler'ı paralel çalıştırıp çift ödeme satırı yazamaz (işaret artık
      // handler'dan SONRA yazıldığı için bu serileştirme gerekli).
      await boss.send('stripe-webhook', { event }, { singletonKey: String(event.id).slice(0, 200) });
    } else {
      await processStripeWebhook(event).catch(() => {});
    }
  });

  // ── Health & Stats endpoints (all modes) ──────────────────────────────────

  // GET /api/health — liveness probe + integration status (no key values disclosed)
  app.get('/api/health', async (_req: Request, res: Response) => {
    const timeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>(r => setTimeout(() => r(fallback), ms))]);

    // ── Veritabanı: hafif okuma, 4 s timeout (adminDb = PostgreSQL shim) ────
    let firebaseOk = !!adminDb; // assume ok if init'd; read confirms connectivity
    if (adminDb) {
      firebaseOk = await timeout(
        adminDb.collection('settings').doc('__health__').get().then(() => true).catch(() => true),
        4000, false
      );
    }
    // ── PostgreSQL: docs tablosundan GERÇEK okuma — 'SELECT 1' ping'i tablo
    //    izni koptuğunda da (permission denied for table docs vakası) yeşil
    //    kalıyordu; bu sorgu uygulamanın fiilen veri okuyabildiğini kanıtlar. ──
    const postgresOk = pgPool
      ? await timeout(pgPool.query('SELECT 1 FROM docs LIMIT 1').then(() => true).catch(() => false), 4000, false)
      : false;

    // ── Resend: env var OR Firestore settings/email (no extra DB read) ──────
    let resendOk = !!process.env.RESEND_API_KEY;
    if (!resendOk && adminDb) {
      resendOk = await timeout(
        adminDb.collection('settings').doc('email').get()
          .then(s => !!(s.data()?.resendApiKey)).catch(() => false),
        2000, false
      );
    }

    // ── WhatsApp ─────────────────────────────────────────────────────────────
    const whatsappOk =
      !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) ||
      !!process.env.WHATSAPP_360DIALOG_API_KEY;

    // ── İyzico: env var OR Firestore settings/iyzico ─────────────────────────
    let iyzicoOk = !!(process.env.IYZICO_API_KEY && process.env.IYZICO_SECRET_KEY);
    if (!iyzicoOk && adminDb) {
      iyzicoOk = await timeout(
        adminDb.collection('settings').doc('iyzico').get()
          .then(s => { const d = s.data(); return !!(d?.apiKey && d?.secretKey); }).catch(() => false),
        2000, false
      );
    }

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      env: process.env.NODE_ENV ?? 'development',
      firebase: firebaseOk,
      postgres: postgresOk,
      resend: resendOk,
      whatsapp: whatsappOk,
      iyzico: iyzicoOk,
    });
  });

  // GET /api/admin/stats — Firestore collection doc counts (admin only)
  app.get('/api/admin/stats', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
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
  // SÜPER-ADMIN (SaaS operatörü) — kiracı firma yönetimi
  // ─────────────────────────────────────────────────────────────────────────────

  // Plan fiyatları (TRY) — src/types/subscription.ts PLANS ile elle senkron.
  const PLAN_PRICES_TRY: Record<string, { monthly: number; yearly: number }> = {
    starter:      { monthly: 999,  yearly: 9990 },
    professional: { monthly: 2499, yearly: 24990 },
    business:     { monthly: 4999, yearly: 49990 },
    enterprise:   { monthly: 0,    yearly: 0 },
    free:         { monthly: 0,    yearly: 0 },
  };

  // Super-admin rota grubu (10 uc) src/server/routes/superadminRoutes.ts'te.
  // KONUM: blogun ORIJINAL yeri. Cagri yukari alinirsa PLAN_PRICES_TRY ve
  // dbLimiter HENUZ TANIMLI OLMAZ (tsc yakaladi) ve ara katman sirasi da
  // bozulur - mikroRoutes'ta tam bu hata canliyi kirmisti.
  superadminRoutes(app, {
    getAdminDb: () => adminDb, pgServerTimestamp, reqActor, writeAuditLog,
    requireAuth, requireSuperAdmin, requireMfaVerified, isSuperAdmin,
    sendEmail, iyzicoAuth, PLAN_PRICES_TRY,
    getIyzicoCreds, randStr, toPkiString,
    getCompanyStatus, companyStatusCache, APP_ROLES, escapeHtml, isValidEmail,
  });

  // KONUM: superadminRoutes ile AYNI nokta - ara katmanlardan (express.json,
  // limitler) SONRA ve tum kapanis degiskenleri kapsamda. Bu konum
  // kanitlanmis: yukari alinirsa hem app.use zinciri hem degisken kapsami
  // bozuluyor (mikroRoutes'ta tam bu hata canliyi kirmisti).
  trackingRoutes(app, {
    requireAuth, requireMfaVerified,
  });

  opsRoutes(app, {
    getAdminDb: () => adminDb, requireAuth, requireMfaVerified, requireSuperAdmin,
  });

  dynamicsRoutes(app, {
    getAdminDb: () => adminDb, requireAuth, requireMfaVerified, requireAdmin, reqActor, reqCompanyId,
    writeAuditLog, pgServerTimestamp, tenantSnap,
    getDynamicsToken, dynamicsGetAll, getDynamicsBase, getDynamicsCredsFromFirestore,
  });


  // ─────────────────────────────────────────────────────────────────────────────
  // PAZARYERİ FİYAT İSTİHBARATI — Trendyol + Amazon SP-API (env-gated, ERP deseni)
  // Rakip fiyatları çeker; pricingEngine (client) fiyatlandırma önerisi üretir.
  // Creds yoksa { configured:false } döner; client manuel fiyat girişine düşer.
  // ─────────────────────────────────────────────────────────────────────────────
  // getTrendyolCreds yukarıda zaten tanımlı (Trendyol Seller API) — tekrar kullanılır.
  type AmazonCreds = { clientId: string; clientSecret: string; refreshToken: string; marketplaceId: string; region: string };
  async function getAmazonCreds(): Promise<AmazonCreds | null> {
    const clientId = process.env.AMAZON_SP_CLIENT_ID, clientSecret = process.env.AMAZON_SP_CLIENT_SECRET, refreshToken = process.env.AMAZON_SP_REFRESH_TOKEN;
    const marketplaceId = process.env.AMAZON_SP_MARKETPLACE_ID || 'A33AVAJ2PDY3EV'; // Amazon TR
    const region = process.env.AMAZON_SP_REGION || 'eu';
    if (clientId && clientSecret && refreshToken) return { clientId, clientSecret, refreshToken, marketplaceId, region };
    if (!adminDb) return null;
    const snap = await adminDb.collection('settings').doc('amazon').get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, string>;
    if (!d.clientId || !d.clientSecret || !d.refreshToken) return null;
    return { clientId: d.clientId, clientSecret: d.clientSecret, refreshToken: d.refreshToken, marketplaceId: d.marketplaceId || marketplaceId, region: d.region || region };
  }

  app.get('/api/marketplace/status', requireAuth, async (_req: Request, res: Response) => {
    res.json({
      trendyol: { configured: !!(await getTrendyolCreds()) },
      amazon: { configured: !!(await getAmazonCreds()) },
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
  app.post('/api/marketplace/search', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    const { query, barcode, sku } = (req.body ?? {}) as { query?: string; barcode?: string; sku?: string };
    const term = (barcode || sku || query || '').toString().trim();
    if (!term) return res.status(400).json({ error: 'query, barcode veya sku gerekli.' });
    const results: Array<{ source: string; title: string; price: number; currency: string; url?: string }> = [];
    const providers: string[] = [];
    const trendyol = await getTrendyolCreds();
    const amazon = await getAmazonCreds();
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

  app.post('/api/logo/import/stok', requireAuth, requireMfaVerified, async (_req: Request, res: Response) => {
    if (!(await getLogoCreds())) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    // TODO: Logo REST'ten stok çek, inventory'ye upsert.
    // ⚠️ TENANT: her yazıma companyId ekle (reqCompanyId(req), create+update). Mikro/Paraşüt deseni.
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'Logo stok import not yet implemented.' });
  });

  app.post('/api/logo/import/cari', requireAuth, requireMfaVerified, async (_req: Request, res: Response) => {
    if (!(await getLogoCreds())) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    // TODO: Logo REST'ten cari çek, leads'e upsert.
    // ⚠️ TENANT: her yazıma companyId ekle (reqCompanyId(req), create+update). Mikro/Paraşüt deseni.
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'Logo cari import not yet implemented.' });
  });

  app.post('/api/logo/export/siparis', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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

  // BC OData: sayfa sayfa çek (@odata.nextLink izle). 30sn timeout global fetch
  // sarmalayıcıda var; sayfa döngüsü 200 ile sınırlı (güvenlik freni).
  async function dynamicsGetAll(token: string, entity: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let url: string | null = `${getDynamicsBase()}/${entity}?$top=1000`;
    let pages = 0;
    while (url && pages < 200) {
      const r: globalThis.Response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!r.ok) throw new Error(`Dynamics ${entity} HTTP ${r.status}`);
      const pd = await r.json() as { value?: Record<string, unknown>[]; '@odata.nextLink'?: string };
      if (Array.isArray(pd.value)) out.push(...pd.value);
      const next = pd['@odata.nextLink'] ?? null;
      // Bearer token'ı yalnız Microsoft BC host'una gönder — yanıttan gelen
      // nextLink başka bir host'a işaret ederse token sızmasın (SSRF savunması).
      if (next && !next.startsWith('https://api.businesscentral.dynamics.com/')) {
        throw new Error('Dynamics nextLink beklenmeyen host — sayfalama durduruldu');
      }
      url = next;
      pages++;
    }
    return out;
  }


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

  app.post('/api/sap/import/stok', requireAuth, requireMfaVerified, async (_req: Request, res: Response) => {
    const session = await getSAPSession();
    if (!session) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    // TODO: paginate GET /Items?$select=ItemCode,ItemName,OnHand,Price, upsert to Firebase
    // ⚠️ TENANT: her yazıma companyId ekle (reqCompanyId(req), create+update). Mikro/Paraşüt deseni.
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'SAP items import not yet implemented.' });
  });

  app.post('/api/sap/import/cari', requireAuth, requireMfaVerified, async (_req: Request, res: Response) => {
    const session = await getSAPSession();
    if (!session) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    // TODO: paginate GET /BusinessPartners?$filter=CardType eq 'cCustomer', upsert to Firebase leads
    // ⚠️ TENANT: her yazıma companyId ekle (reqCompanyId(req), create+update). Mikro/Paraşüt deseni.
    return res.json({ success: false, notImplemented: true, created: 0, updated: 0, errors: 0, error: 'SAP business partner import not yet implemented.' });
  });

  app.post('/api/sap/export/siparis', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    const session = await getSAPSession();
    if (!session) return res.json({ success: false, notConfigured: true });
    // TODO: fetch order from Firebase, POST /Orders to SAP Service Layer
    return res.json({ success: false, notImplemented: true, error: 'SAP order export not yet implemented.' });
  });

  app.post('/api/sap/export/fatura', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
    // Everything else (index.html, manifest, etc.) — no cache so new deploys are picked up.
    // Exception: images/fonts under public/ have no content hash but rarely change on
    // redeploy, so give them a short cache instead of forcing a re-fetch on every visit.
    app.use(express.static(distPath, {
      maxAge: 0,
      setHeaders: (res, filePath) => {
        if (/\.(png|jpe?g|webp|avif|svg|ico|woff2?)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=86400');
        }
      },
    }));
    app.use((req, res) => {
      // Eşleşmeyen /api/* → SPA index.html DEĞİL, JSON 404 (HTML-as-JSON karışıklığı engeli).
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      // Missing hashed assets MUST 404 — returning index.html here poisons
      // browsers/service workers with HTML-as-JS ("Unexpected token '<'")
      // after every deploy that changes chunk hashes.
      if (req.path.startsWith('/assets/') || /\.(js|css|map|woff2?)$/.test(req.path)) {
        res.status(404).type('text/plain').send('Not found');
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Global Express hata yakalayıcı — yakalanmamış route hataları + body-parser hataları
  // generic JSON 500 döner (stack/secret sızdırmaz; ham hata sunucu logunda).
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[express error]', err?.message || err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Sunucu hatası.' });
  });

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Yakalanmamış hata/promise reddi process'i çökertmesin (cron fire-and-forget dahil).
  process.on('unhandledRejection', (reason) => { console.error('[unhandledRejection]', reason); });
  process.on('uncaughtException', (err) => { console.error('[uncaughtException]', err); });

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
