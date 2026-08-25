import express, { Request, Response, NextFunction } from "express";
import { PgBoss } from "pg-boss";
import compression from "compression";
import helmet from "helmet";
import {
  initMikroMirror, initMikroTables, mirrorMikroInsert, mirrorMikroStoklar,
  mirrorMikroCariler, CHA_COLS, SIP_COLS, STH_COLS, FIS_COLS,
} from "./src/server/mikroMirror.js";
import {
  initMikroClient, MIKRO_JUMP_SURUM, MIKRO_API_BASE, MIKRO_LOCAL_MODE,
  getMikroCreds, getMikroToken, mikroStokMiktari, mikroSatisFiyatlari,
  mikroBugun, mikroData, mikroSatirlar, mikroHata, sqlTarih, sqlTanimlayici,
  mikroSql, mikroKolonlar, mikroVergiOranlari, vergiOraniCoz, kolonBul,
  detectMikroGatewayBlock, mikroPost, mikroTokenCacheMap,
} from "./src/server/mikroClient.js";
import {
  initOpsWatchdog, runOpsWatchdog, diskNobetcisi, SAKLAMA_KURALLARI,
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
import { EventEmitter } from "events";
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
import { getFirestore, FieldValue, type Firestore, type Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
// Mikro kolon eslestirme: projenin en tehlikeli mantigi, artik TESTLI tek
// kaynakta (src/lib/mikroKolon.ts, 10 test). Eskiden startServer()
// icinde, 9000 satirin ortasinda ve testsizdi.
import { findKey, kolonSec } from "./src/lib/mikroKolon.js";
import { createHmac, createHash, randomUUID, timingSafeEqual } from "crypto";
import { generateSecret as totpSecret, generateURI as totpURI, verifySync as totpVerifyRaw } from "otplib";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import Stripe from "stripe";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z, ZodError } from "zod";

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

// Fatura kaydetme şeması
const FaturaKaydetSchema = z.object({
  firebaseId: z.string().optional(),
  order: z.object({
    mikroCariKod:  z.string().min(1, 'Cari kod zorunludur.'),
    lineItems:     z.array(z.object({
      sku:      z.string().optional(),
      name:     z.string().min(1),
      price:    z.number().nonnegative(),
      quantity: z.number().int().positive(),
    })).min(1, 'En az bir satır gerekli.'),
    faturaTipi:   z.enum(['e-fatura', 'e-arsiv', 'ihracat']).optional(),
    kdvOran:      z.number().min(0).max(100).optional(),
    createdAt:    z.string().optional(),
  }),
});

// İrsaliye kaydetme şeması
const IrsaliyeKaydetSchema = z.object({
  firebaseId: z.string().optional(),
  shipment: z.object({
    mikroCariKod:   z.string().min(1, 'Cari kod zorunludur.'),
    customerName:   z.string().optional(),
    destination:    z.string().optional(),
    trackingNo:     z.string().optional(),
    cargoFirm:      z.string().optional(),
    items:          z.array(z.object({
      sku:      z.string().optional(),
      name:     z.string().min(1),
      quantity: z.number().int().positive(),
      price:    z.number().optional(),
    })).optional(),
    date:           z.string().optional(),
  }),
});

// Gelen fatura kabul/ret şeması
const GelenFaturaActionSchema = z.object({
  faturaGuid:  z.string().min(1, 'faturaGuid zorunludur.'),
  firebaseId:  z.string().optional(),
  aciklama:    z.string().optional(),
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

const dbEvents = new EventEmitter();
dbEvents.setMaxListeners(0);

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
        await adminDb.collection('orders').add({
          ...orderData,
          ...(cid ? { companyId: cid } : {}), // çok-kiracıda belirsizse etiketsiz bırak
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

/** Firestore-admin-compatible timestamp shape ({_seconds,_nanoseconds}). */
function pgNowTimestamp(): { _seconds: number; _nanoseconds: number } {
  const ms = Date.now();
  return { _seconds: Math.floor(ms / 1000), _nanoseconds: (ms % 1000) * 1e6 };
}

/** Replace {__op:'serverTimestamp'} sentinels (deep) with a concrete timestamp. */
function resolveSentinels(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(resolveSentinels);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.__op === 'serverTimestamp') return pgNowTimestamp();
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) out[k] = resolveSentinels(val);
    return out;
  }
  return v;
}

/** Shallow merge with Firestore-style dot-path keys ('a.b.c': v sets data.a.b.c). */
function mergeDocData(existing: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (!key.includes('.')) { out[key] = value; continue; }
    const parts = key.split('.');
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      const next = cursor[p];
      cursor[p] = (next && typeof next === 'object' && !Array.isArray(next)) ? { ...(next as Record<string, unknown>) } : {};
      cursor = cursor[p] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return out;
}

const DOC_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
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

function genDocId(): string {
  let s = '';
  for (let i = 0; i < 20; i++) s += DOC_ID_CHARS[Math.floor(Math.random() * DOC_ID_CHARS.length)];
  return s;
}

function broadcastDocChange(coll: string, type: 'set' | 'delete', id: string, data?: unknown): void {
  // Kiracı/kullanıcı filtreleme için companyId + userId'yi olaya iliştir.
  const d = (data ?? {}) as Record<string, unknown>;
  dbEvents.emit('change', {
    coll, type, id,
    cid: d.companyId as string | undefined,
    uid: d.userId as string | undefined,
    ...(data !== undefined ? { data } : {}),
  });
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

// ── firebase-admin Firestore compatible shim over PostgreSQL ─────────────────
// server.ts's 170+ adminDb call sites (Shopify/Mikro sync, audit log, crons)
// keep their code shape; only the backing store changes. Writes broadcast over
// SSE so connected browsers update live, exactly like client-initiated writes.

/* eslint-disable @typescript-eslint/no-explicit-any */
type PgDocData = Record<string, any>;

/** SSE init'te koleksiyon başına gönderilecek azami satır. Emniyet supabı:
 *  tek bir koleksiyonun büyümesi tarayıcıyı kilitlemesin. Çarpıldığında SESSİZCE
 *  kırpılmaz — sunucuda uyarı loglanır ve init eventine `truncated`+`total`
 *  eklenir, böylece eksik veri "tam veri" gibi görünmez. */
const STREAM_INIT_MAX_ROWS = Number(process.env.STREAM_INIT_MAX_ROWS || 20000);


/** Kodun çağırdığı ama Mikro Jump V17'de BULUNMAYAN metotlar.
 *
 *  Kaynak: apidocs.mikro.com.tr/MikroAPI.postman_collection_V17.json — 215 istek,
 *  161 tekil metot. Kodda çağrılan metotlar bu listeyle karşılaştırıldı (2026-07-30).
 *  V17'nin liste yüzeyi çok dar: yalnız Stok/Cari listesi + SqlVeriOkuV2. Kalan
 *  veriler (fatura, sipariş, stok hareketi, mizan, KDV) SqlVeriOkuV2 ile ilgili
 *  tablodan SELECT edilerek çekilmeli.
 *
 *  Bunlar sessizce başarısız olduğunda ne oluyordu: yanıt gelmiyor, çağıran kod
 *  `Number(md?.alan ?? 0)` ile devam ediyor ve SIFIR yazıyor. Cari bakiyeleri ve
 *  taxSummary/accountingPeriods tam olarak böyle sıfırlanıyordu.
 *
 *  BU LİSTEYE EKLENMEDİ (Mikro desteği 2026-06-11'de VAR olduklarını teyit etti,
 *  koleksiyonda görünmüyorlar): GelenFaturalarKabulV2, GelenFaturalarRedV2.
 */

/** Drop-in for admin.firestore.FieldValue.serverTimestamp() — resolved by resolveSentinels. */
function pgServerTimestamp(): any {
  return pgPool ? { __op: 'serverTimestamp' } : FieldValue.serverTimestamp();
}

class PgTimestampValue {
  constructor(public _seconds: number, public _nanoseconds: number) {}
  get seconds(): number { return this._seconds; }
  get nanoseconds(): number { return this._nanoseconds; }
  toDate(): Date { return new Date(this._seconds * 1000 + Math.floor(this._nanoseconds / 1e6)); }
  toMillis(): number { return this._seconds * 1000 + Math.floor(this._nanoseconds / 1e6); }
}

/** Revive stored {_seconds,_nanoseconds} JSON into objects with toDate()/toMillis(). */
function pgReviveTimestamps(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(pgReviveTimestamps);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 2 && typeof o._seconds === 'number' && typeof o._nanoseconds === 'number') {
      return new PgTimestampValue(o._seconds as number, o._nanoseconds as number);
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) out[k] = pgReviveTimestamps(val);
    return out;
  }
  return v;
}

interface PgWhereFilter { field: string; op: string; value: unknown }

function pgFieldValueOf(data: PgDocData, field: string): unknown {
  if (!field.includes('.')) return data[field];
  let v: unknown = data;
  for (const part of field.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = (v as PgDocData)[part];
  }
  return v;
}

function pgCmp(a: unknown, b: unknown): number {
  const norm = (x: unknown): number | string => {
    if (x instanceof PgTimestampValue) return x.toMillis();
    if (x && typeof x === 'object' && typeof (x as PgDocData)._seconds === 'number') {
      return (x as PgDocData)._seconds * 1000;
    }
    if (typeof x === 'number') return x;
    if (typeof x === 'boolean') return x ? 1 : 0;
    return String(x ?? '');
  };
  const na = norm(a), nb = norm(b);
  if (typeof na === 'number' && typeof nb === 'number') return na - nb;
  return String(na) < String(nb) ? -1 : String(na) > String(nb) ? 1 : 0;
}

class PgDocSnapshot {
  constructor(public id: string, private _data: PgDocData | undefined, public ref: PgDocRef) {}
  get exists(): boolean { return this._data !== undefined; }
  data(): PgDocData | undefined { return this._data; }
}

class PgDocRef {
  constructor(private pool: pg.Pool, public coll: string, public id: string) {}
  get path(): string { return `${this.coll}/${this.id}`; }
  async get(): Promise<PgDocSnapshot> {
    const { rows } = await this.pool.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [this.coll, this.id]);
    const data = rows.length ? pgReviveTimestamps(rows[0].data) as PgDocData : undefined;
    return new PgDocSnapshot(this.id, data, this);
  }
  async set(data: PgDocData, opts?: { merge?: boolean }): Promise<void> {
    const incoming = resolveSentinels(data) as PgDocData;
    let final = incoming;
    if (opts?.merge) {
      const { rows } = await this.pool.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [this.coll, this.id]);
      final = mergeDocData((rows[0]?.data as PgDocData) ?? {}, incoming);
    }
    await this.pool.query(
      `INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)
       ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [this.coll, this.id, JSON.stringify(final)],
    );
    broadcastDocChange(this.coll, 'set', this.id, final);
  }
  async update(data: PgDocData): Promise<void> {
    const patch = resolveSentinels(data) as PgDocData;
    const { rows } = await this.pool.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [this.coll, this.id]);
    const final = mergeDocData((rows[0]?.data as PgDocData) ?? {}, patch);
    await this.pool.query(
      `INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)
       ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [this.coll, this.id, JSON.stringify(final)],
    );
    broadcastDocChange(this.coll, 'set', this.id, final);
  }
  async delete(): Promise<void> {
    await this.pool.query('DELETE FROM docs WHERE coll = $1 AND id = $2', [this.coll, this.id]);
    broadcastDocChange(this.coll, 'delete', this.id);
  }
}

class PgQueryBuilder {
  constructor(
    protected pool: pg.Pool,
    public collName: string,
    protected filters: PgWhereFilter[] = [],
    protected orderField: { field: string; dir: 'asc' | 'desc' } | null = null,
    protected limitN: number | null = null,
  ) {}
  where(field: string, op: string, value: unknown): PgQueryBuilder {
    return new PgQueryBuilder(this.pool, this.collName, [...this.filters, { field, op, value }], this.orderField, this.limitN);
  }
  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): PgQueryBuilder {
    return new PgQueryBuilder(this.pool, this.collName, this.filters, { field, dir }, this.limitN);
  }
  limit(n: number): PgQueryBuilder {
    return new PgQueryBuilder(this.pool, this.collName, this.filters, this.orderField, n);
  }
  /** Aggregate count — note: ignores where() filters (no call site uses filters with count). */
  count(): { get: () => Promise<{ data: () => { count: number } }> } {
    return {
      get: async () => {
        const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM docs WHERE coll = $1', [this.collName]);
        return { data: () => ({ count: rows[0].n as number }) };
      },
    };
  }
  async get(): Promise<{ docs: PgDocSnapshot[]; empty: boolean; size: number; forEach: (cb: (d: PgDocSnapshot) => void) => void }> {
    const { rows } = await this.pool.query('SELECT id, data FROM docs WHERE coll = $1', [this.collName]);
    let items = rows.map((r: { id: string; data: unknown }) => ({ id: r.id, data: pgReviveTimestamps(r.data) as PgDocData }));
    for (const f of this.filters) {
      items = items.filter((it: { id: string; data: PgDocData }) => {
        const v = pgFieldValueOf(it.data, f.field);
        switch (f.op) {
          case '==': return v === f.value;
          case '!=': return v !== f.value;
          case '<': return pgCmp(v, f.value) < 0;
          case '<=': return pgCmp(v, f.value) <= 0;
          case '>': return pgCmp(v, f.value) > 0;
          case '>=': return pgCmp(v, f.value) >= 0;
          case 'in': return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
          case 'array-contains': return Array.isArray(v) && (v as unknown[]).includes(f.value);
          default: return true;
        }
      });
    }
    if (this.orderField) {
      const { field, dir } = this.orderField;
      items = [...items].sort((a: { data: PgDocData }, b: { data: PgDocData }) => {
        const r = pgCmp(pgFieldValueOf(a.data, field), pgFieldValueOf(b.data, field));
        return dir === 'desc' ? -r : r;
      });
    }
    if (this.limitN != null) items = items.slice(0, this.limitN);
    const docs = items.map((it: { id: string; data: PgDocData }) => new PgDocSnapshot(it.id, it.data, new PgDocRef(this.pool, this.collName, it.id)));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (cb: (d: PgDocSnapshot) => void) => docs.forEach(cb) };
  }
}

class PgCollectionRef extends PgQueryBuilder {
  doc(id?: string): PgDocRef { return new PgDocRef(this.pool, this.collName, id ?? genDocId()); }
  async add(data: PgDocData): Promise<PgDocRef> {
    const id = genDocId();
    const final = resolveSentinels(data) as PgDocData;
    await this.pool.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)', [this.collName, id, JSON.stringify(final)]);
    broadcastDocChange(this.collName, 'set', id, final);
    return new PgDocRef(this.pool, this.collName, id);
  }
}

interface PgBatchOp { kind: 'set' | 'update' | 'delete'; ref: PgDocRef; data?: PgDocData; opts?: { merge?: boolean } }

class PgFirestore {
  constructor(private pool: pg.Pool) {}
  collection(name: string): PgCollectionRef { return new PgCollectionRef(this.pool, name); }
  /** Sequential, not atomic — acceptable for this app's sync flows. */
  batch(): { set: (ref: PgDocRef, data: PgDocData, opts?: { merge?: boolean }) => void; update: (ref: PgDocRef, data: PgDocData) => void; delete: (ref: PgDocRef) => void; commit: () => Promise<void> } {
    const ops: PgBatchOp[] = [];
    return {
      set: (ref, data, opts) => { ops.push({ kind: 'set', ref, data, opts }); },
      update: (ref, data) => { ops.push({ kind: 'update', ref, data }); },
      delete: (ref) => { ops.push({ kind: 'delete', ref }); },
      commit: async () => {
        for (const op of ops) {
          if (op.kind === 'set') await op.ref.set(op.data as PgDocData, op.opts);
          else if (op.kind === 'update') await op.ref.update(op.data as PgDocData);
          else await op.ref.delete();
        }
      },
    };
  }
  settings(_opts: unknown): void { /* no-op — kept for call-site compatibility */ }
}

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

// ── Mikro periodic sync (cron) ───────────────────────────────────────────────
// Saatte bir: TÜM cari + stok kartlarını sayfalı çeker, UPSERT eder (yeni
// kayıt ekler, mevcutları günceller, tedarikçi tipini işler) ve mikro_*
// aynasına yazar. Gece 04:00: V17+ kurulumlarda stok miktar/maliyet senkronu.
if (process.env.MIKRO_CRON_SYNC === 'true') {
  /**
   * Mikro cron'un yazacağı hedef tenant. Mikro creds deployment-global olduğundan
   * tek hedef firma vardır. Öncelik: MIKRO_CRON_COMPANY_ID env. Yoksa kurulumda
   * tek tenant varsa onu kullan. Çok-tenant'ta belirsizse '' döner → cron senkronu
   * atlar (yanlış tenant'a yazmamak için). "ilk inventory dokümanı" heuristiği
   * (kırılgan/rastgele) kaldırıldı.
   */
  const cronCompanyId = async (): Promise<string> => {
    if (process.env.MIKRO_CRON_COMPANY_ID) return process.env.MIKRO_CRON_COMPANY_ID;
    if (!adminDb) return '';
    const snap = await adminDb.collection('users').get();
    const cids = new Set(snap.docs.map(d => (d.data().companyId as string) || d.id));
    if (cids.size === 1) return [...cids][0];
    console.error(`Mikro cron: ${cids.size} tenant bulundu ve MIKRO_CRON_COMPANY_ID tanımlı değil → senkron atlandı.`);
    return '';
  };

  const cronPullAll = async (
    method: string, listKey: string, body: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> => {
    const out: Record<string, unknown>[] = [];
    for (let index = 0; index < 100; index++) {
      const { ok, data } = await mikroPost(method, { ...body, Size: '500', Index: index });
      if (!ok || typeof data === 'string') break;
      const rows = (mikroData(data)[listKey] ?? []) as Record<string, unknown>[];
      if (!Array.isArray(rows) || rows.length === 0) break;
      out.push(...rows);
      if (rows.length < 500) break;
    }
    return out;
  };

  cron.schedule('0 * * * *', async () => {
    const cronCreds = await getMikroCreds();
    if (!cronCreds || !adminDb) return;
    console.log('Mikro cron: stok + cari tam senkron başlatıldı');
    try {
      const companyId = await cronCompanyId();
      if (!companyId) { console.warn('Mikro cron: hedef tenant belirsiz, senkron atlandı.'); return; }

      // ── Stok kartları: tam sayfalama + upsert ──────────────────────────────
      const stoklar = await cronPullAll('StokListesiV2', 'StokListesi', {
        StokKod: '', TarihTipi: 2,
        IlkTarih: '2000-01-01', SonTarih: `${new Date().getFullYear() + 1}-12-31`,
        Sort: 'sto_kod',
      });
      void mirrorMikroStoklar(stoklar);
      const vergiTablosu = await mikroVergiOranlari(); // döngü öncesi bir kez
      const invSnap = await tenantSnap('inventory', companyId);
      const invBySku = new Map<string, { ref: PgDocRef; stockLevel: number; name: string; prices: Record<string, number> }>();
      for (const d of invSnap.docs) {
        const data = d.data();
        const sku = (data.sku as string)?.trim();
        if (sku && !invBySku.has(sku)) {
          invBySku.set(sku, {
            ref: d.ref, stockLevel: Number(data.stockLevel) || 0, name: (data.name as string) || sku,
            // Mevcut fiyatlar: Mikro fiyatı gelmeyen kademeler KORUNSUN diye
            // (elle girilmiş fiyat senkronla silinmemeli — bkz. aşağıdaki merge).
            prices: (data.prices as Record<string, number>) || {},
          });
        }
      }
      let stokYeni = 0, stokGuncel = 0;
      let batch = adminDb.batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = adminDb!.batch(); ops = 0; } };
      const seenSku = new Set<string>();
      for (const s of stoklar) {
        const sku = (s.sto_kod as string)?.trim();
        if (!sku || seenSku.has(sku)) continue;
        seenSku.add(sku);
        const mikroQty = mikroStokMiktari(s);
        const kdvOran = vergiOraniCoz(s.sto_perakende_vergi, vergiTablosu);

        // Satış fiyatları — cron import'u bunu HİÇ yazmıyordu (yalnız manuel import
        // yazıyordu), o yüzden cron'la oluşan ürünler ekranda "0 TL" kalıyordu.
        const mikroPrices = mikroSatisFiyatlari(s);
        const fiyatVar = Object.keys(mikroPrices).length > 0;

        const fields = {
          name: (s.sto_isim as string) || sku,
          unit: (s.sto_birim1_ad as string) || 'ADET',
          // sto_perakende_vergi İNDEKStir, yüzde değil (bkz. vergiOraniCoz).
          // Çözülemezse vatRate'e DOKUNMA — uydurma %20 yazmaktansa eskisi kalsın.
          ...(kdvOran !== null ? { vatRate: kdvOran } : {}),
          // Miktar alanı YOKSA stockLevel'a DOKUNMA. Eskiden `?? 0` vardı: alan
          // gelmediğinde her senkron tüm ürünlerin stoğunu sıfırlıyor ve üstelik
          // her ürün için sahte bir sayım farkı üretiyordu. Miktarın güvenilir
          // kaynağı GenelAmacliMaliyetListesiV2 (/api/mikro/import/stok-miktar).
          ...(mikroQty !== null ? { stockLevel: mikroQty } : {}),
          mikroStoKod: sku, mikroSynced: true,
          mikroSyncedAt: pgServerTimestamp(),
          // companyId GÜNCELLEMEDE de yazilir: eski etiketsiz kayitlar her senkronda
          // kendiliginden etiketlenir (self-heal) — ayri backfill'e gerek kalmaz.
          companyId,
        };
        const existing = invBySku.get(sku);
        if (existing) {
          // Sayim farki tespiti: senkrondan hemen once bizim mevcut stockLevel'imiz
          // ile Mikro'nun gonderdigi miktar farkliysa kaydet - ozellikle numune/fire/
          // konsinye gibi yalniz bizim tarafta bilinen dususleri Mikro'nun (bunlardan
          // habersiz) eski sayisiyla sessizce ezmesine karsi gorunurluk saglar.
          if (mikroQty !== null && existing.stockLevel !== mikroQty) {
            batch.set(adminDb.collection('stockDiscrepancies').doc(), {
              productId: existing.ref.id, sku, productName: existing.name,
              ourQty: existing.stockLevel, mikroQty, diff: mikroQty - existing.stockLevel,
              resolved: false, companyId, detectedAt: pgServerTimestamp(),
            });
            ops++; // ayri bir batch islemi - ops sayacina ayrica ekle
          }
          // Fiyat MERGE: Mikro'dan gelmeyen kademe mevcut değeriyle kalır
          // (elle girilmiş fiyat senkronla silinmez).
          batch.update(existing.ref, fiyatVar
            ? { ...fields, prices: { ...existing.prices, ...mikroPrices } }
            : fields);
          stokGuncel++;
        }
        else {
          batch.set(adminDb.collection('inventory').doc(), {
            ...fields, sku, category: 'Genel',
            lowStockThreshold: 5,
            prices: mikroPrices,
            // Eski tek-fiyat alanı, Retail ile hizalı tutulur (bazı ekranlar okuyor).
            price: mikroPrices.Retail ?? 0,
            source: 'mikro_cron', createdAt: pgServerTimestamp(),
          });
          stokYeni++;
        }
        if (++ops >= 400) await flush();
      }
      await flush();

      // ── Cariler: tam sayfalama + upsert (tedarikçi tipi dahil) ─────────────
      const cariler = await cronPullAll('CariListesiV2', 'CariListesi', {
        FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl,cari_hareket_tipi,cari_baglanti_tipi',
        WhereStr: "cari_baglanti_tipi=0 and cari_lastup_date > '2000/01/01'",
        Sort: 'cari_kod',
      });
      void mirrorMikroCariler(cariler);
      const leadSnap = await tenantSnap('leads', companyId);
      const leadByKod = new Map<string, PgDocRef>();
      const leadByVkn = new Map<string, PgDocRef>();
      const leadByName = new Map<string, PgDocRef>();
      const normalizeVknCron = (v?: string) => (v || '').replace(/\D/g, '');
      for (const d of leadSnap.docs) {
        const data = d.data();
        const kod = (data.mikroCariKod as string)?.trim();
        if (kod && !leadByKod.has(kod)) leadByKod.set(kod, d.ref);
        const vkn = normalizeVknCron((data.taxId as string) || (data.taxNo as string));
        if (vkn && !leadByVkn.has(vkn)) leadByVkn.set(vkn, d.ref);
        const nameKey = ((data.name as string) || (data.company as string) || '').trim().toLowerCase();
        if (nameKey && !leadByName.has(nameKey)) leadByName.set(nameKey, d.ref);
      }
      let cariYeni = 0, cariGuncel = 0;
      for (const c of cariler) {
        const kod = (c.cari_kod as string)?.trim();
        if (!kod) continue;
        const leadType = Number(c.cari_hareket_tipi ?? 0) === 1 ? 'Supplier' : 'Customer';
        const fields = {
          name: (c.cari_unvan1 as string) || kod,
          company: (c.cari_unvan1 as string) || '',
          email: (c.cari_EMail as string) || '',
          phone: (c.cari_CepTel as string) || '',
          taxId: (c.cari_vdaire_no as string) || '',
          taxOffice: (c.cari_vdaire_adi as string) || '',
          eFaturaKayitli: Number(c.cari_efatura_fl) === 1,
          type: leadType, mikroCariKod: kod,
          mikroSynced: true, mikroSyncedAt: pgServerTimestamp(),
          companyId, // güncellemede de etiketle (self-heal)
        };
        // Oncelik: mikroCariKod -> VKN -> case-insensitive isim (bkz.
        // /api/mikro/import/cari'deki ayni fix - manuel olusturulmus leads'in
        // mikroCariKod'u olmadigi icin salt-kod eslesme onlari ikinci kez
        // olusturuyordu).
        const vkn = normalizeVknCron(fields.taxId);
        const nameKey = fields.name.trim().toLowerCase();
        const ref = leadByKod.get(kod)
          || (vkn ? leadByVkn.get(vkn) : undefined)
          || (nameKey ? leadByName.get(nameKey) : undefined);
        if (ref) { batch.update(ref, fields); cariGuncel++; }
        else {
          const newRef = adminDb.collection('leads').doc();
          batch.set(newRef, {
            ...fields, status: 'Active', source: 'mikro_cron',
            createdAt: pgServerTimestamp(),
          });
          leadByKod.set(kod, newRef);
          cariYeni++;
        }
        if (++ops >= 400) await flush();
      }
      await flush();

      console.log(`Mikro cron tamamlandı — stok: ${stokYeni} yeni/${stokGuncel} güncel, cari: ${cariYeni} yeni/${cariGuncel} güncel`);
    } catch (err) {
      console.error('Mikro cron sync hatası:', err);
    }
  });

  // ── Gece 04:00: stok miktar + maliyet senkronu (yalnız V17+) ──────────────
  cron.schedule('0 4 * * *', async () => {
    if (MIKRO_JUMP_SURUM < 17) return; // GenelAmacliMaliyetListesiV2 V16'da yok
    const cronCreds = await getMikroCreds();
    if (!cronCreds || !adminDb) return;
    console.log('Mikro cron: gece stok miktar senkronu başlatıldı (V17)');
    try {
      // Kiracı ÇÖZÜLÜYOR: bu cron eskiden tüm kiracıların envanterini okuyup
      // hepsinin stok/maliyetini cron kiracısının Mikro'suyla eziyordu.
      const companyId = await cronCompanyId();
      if (!companyId) { console.warn('Mikro gece cron: hedef tenant belirsiz, atlandı.'); return; }
      const invSnap = await tenantSnap('inventory', companyId);
      const items = invSnap.docs
        .map(d => ({ ref: d.ref, sku: ((d.data().sku as string) || '').trim() }))
        .filter(x => x.sku);
      const sonTarih = mikroBugun();
      let updated = 0;
      let batch = adminDb.batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = adminDb!.batch(); ops = 0; } };
      for (let i = 0; i < items.length; i += 8) {
        const results = await Promise.all(items.slice(i, i + 8).map(async (it) => {
          try {
            const { ok, data } = await mikroPost('GenelAmacliMaliyetListesiV2', {
              StokKod: it.sku, IlkTarih: '2000-01-01', SonTarih: sonTarih, Depolar: '1,2,3,4,5',
            });
            const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
            if (!ok || !r0 || r0.IsError) return null;
            const d = (r0.Data ?? {}) as Record<string, unknown>;
            // Alan hiç yoksa "0 stok" DEĞİL, "yanıt okunamadı" demektir — 0 yazıp
            // başarılı saymak gerçek stoğu siler. Başarısıza düşür.
            if (d.EldekiMiktar == null) return null;
            const qty = Number(d.EldekiMiktar);
            if (!Number.isFinite(qty)) return null;
            const totalCost = Number(d.MaliyetBedeli ?? 0);
            return { it, qty, cost: qty > 0 ? totalCost / qty : null };
          } catch { return null; }
        }));
        for (const r of results) {
          if (!r) continue;
          batch.update(r.it.ref, {
            stockLevel: r.qty,
            ...(r.cost !== null ? { costPrice: Math.round(r.cost * 100) / 100 } : {}),
            mikroSyncedAt: pgServerTimestamp(),
          });
          updated++;
          if (++ops >= 400) await flush();
        }
      }
      await flush();
      console.log(`Mikro gece senkronu tamamlandı — ${updated} ürün miktarı güncellendi`);
    } catch (err) {
      console.error('Mikro gece senkron hatası:', err);
    }
  });
  console.log('Mikro cron sync aktif (saatlik kart senkronu + 04:00 miktar senkronu) ✓');
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

      // Kiracı-filtreli (C10 sınıfı, 2026-08-22): haftalık özet e-postası
      // REPORT_RECIPIENT_EMAIL'e gidiyor — yani TEK kiracının sahibine. İçine
      // başka kiracıların sipariş/müşteri/stok rakamlarını katmak hem yanlış
      // rapor hem veri sızıntısı. Tenant, cron'larla aynı kuraldan çözülür.
      const companyId = await serverTenantId();
      if (!companyId) { console.warn('Weekly report: hedef tenant belirsiz, atlandı.'); return; }
      const [ordersSnap, leadsSnap, inventorySnap] = await Promise.all([
        tenantSnap('orders', companyId),
        tenantSnap('leads', companyId),
        tenantSnap('inventory', companyId),
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
        for (const r of rows) if (rowVisible(r.coll, r.data as Record<string, unknown>)) byColl[r.coll].push({ id: r.id, data: r.data });
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
        res.write(`event: change\ndata: ${JSON.stringify(ev)}\n\n`);
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
    const SECRET_FIELD_RE = /(password|sifre|secret|apikey|api_key|accesstoken|access_token|token|privatekey|private_key)/i;
    const REDACTED = '***REDACTED***';
    const redactSettings = async (req: Request, coll: string, data: Record<string, unknown> | undefined) => {
      if (coll !== 'settings' || !data) return data;
      const uid = (req as Request & { uid?: string }).uid || '';
      if (await getUserRole(uid) === 'Admin') return data;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        out[k] = (SECRET_FIELD_RE.test(k) && typeof v === 'string' && v !== '') ? REDACTED : v;
      }
      return out;
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
        const upd = await docsDb.query(
          `UPDATE docs SET data = data || $4::jsonb, updated_at = now()
           WHERE coll = $1 AND id = $2 AND data->>$3 = $5 RETURNING data`,
          [coll, id, field, JSON.stringify(set), String(expect)],
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
  app.post("/api/shopify/sync", requireAuth, async (req: Request, res: Response) => {
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
  app.post('/api/tracking/fedex', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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

  /** Operasyon bekçisi: GET son 14 günün sonuçları, POST elle çalıştır.
   *  Süper-admin panelindeki OpsWatchdogCard kullanır; cron her sabah 08:30. */
  app.get('/api/ops/watchdog', requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    if (!adminDb) return res.json({ success: true, results: [] });
    try {
      const snap = await adminDb.collection('opsChecks').get();
      const results = snap.docs
        .map(d => d.data() as Record<string, unknown>)
        .filter(r => r.date)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 14);
      res.json({ success: true, results });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
  /** GET /api/ops/summary — SALT-OKUNUR ops özeti, token korumalı (2026-07-28).
   *  Amacı: günlük bulut rutini (Claude routine) tarayıcı/oturum olmadan sistemin
   *  durumunu okuyabilsin. Sadece operasyonel metrik döner — kişisel/iş verisi YOK.
   *  OPS_SUMMARY_TOKEN env'i tanımlı değilse uç KAPALIDIR (503).
   *  Token: `X-Ops-Token` başlığı veya ?token= ile; karşılaştırma sabit-zamanlı. */
  /** POST /api/ops/disk-test — disk uyarı YOLUNU elle sına.
   *
   *  Neden gerekli: 2026-07-31 kesintisinde izleme sessiz kaldı. Uyarı
   *  mekanizmasının "yazıldı" olması onun ÇALIŞTIĞI anlamına gelmiyor; postanın
   *  gerçekten ulaştığını kanıtlamadan güvenmemek gerek. Eşiklerle oynayıp iki
   *  kez deploy etmek yerine kalıcı bir sınama yolu.
   *
   *  Eşikleri ve 6 saatlik tekrar kısıtını atlar, postayı "TEST" olarak
   *  işaretler. /api/ops/summary ile AYNI token korumasını kullanır.
   */
  app.post('/api/ops/disk-test', async (req: Request, res: Response) => {
    const expected = process.env.OPS_SUMMARY_TOKEN || '';
    if (!expected) return res.status(503).json({ error: 'kapalı — OPS_SUMMARY_TOKEN tanımlı değil' });
    const got = (req.headers['x-ops-token'] as string) || String(req.query.token ?? '');
    const a = Buffer.from(got), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
    const sonuc = await diskNobetcisi(true);
    res.json({
      success: !sonuc.hata,
      ...sonuc,
      alici: process.env.OPS_ALERT_EMAIL || process.env.REPORT_RECIPIENT_EMAIL || null,
      not: sonuc.postaDenendi
        ? 'Test postası gönderildi. Gelen kutunu (ve spam) kontrol et.'
        : 'Posta GÖNDERİLEMEDİ — hata alanına bak.',
    });
  });

  app.get('/api/ops/summary', async (req: Request, res: Response) => {
    const expected = process.env.OPS_SUMMARY_TOKEN || '';
    if (!expected) return res.status(503).json({ error: 'ops summary kapalı — OPS_SUMMARY_TOKEN tanımlı değil' });
    const got = (req.headers['x-ops-token'] as string) || String(req.query.token ?? '');
    const a = Buffer.from(got), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
    try {
      let latest: Record<string, unknown> | null = null;
      let previous: Record<string, unknown> | null = null;
      if (adminDb) {
        const snap = await adminDb.collection('opsChecks').get();
        const rows = snap.docs.map(d => d.data() as Record<string, unknown>)
          .filter(r => r.date)
          .sort((x, y) => String(y.date).localeCompare(String(x.date)));
        latest = rows[0] ?? null;
        previous = rows[1] ?? null;
      }
      const failing = ((latest?.checks as Array<{ key: string; ok: boolean; detail: string }>) || []).filter(c => !c.ok);
      res.json({
        generatedAt: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        env: process.env.NODE_ENV || 'development',
        watchdog: {
          date: latest?.date ?? null,
          ok: latest?.ok ?? null,
          failingCount: failing.length,
          failing,                       // yalnız BOZUK olanların detayı
          checks: latest?.checks ?? [],  // tam liste (11 kontrol)
          previousDate: previous?.date ?? null,
          previousOk: previous?.ok ?? null,
        },
        mikro: { apiBase: MIKRO_API_BASE, localMode: MIKRO_LOCAL_MODE, surum: MIKRO_JUMP_SURUM },
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/ops/watchdog/run', requireAuth, requireMfaVerified, requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      res.json({ success: true, result: await runOpsWatchdog() });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** GET /api/ops/module-status — modül bazlı sezgisel olgunluk göstergesi.
   *  GERÇEK dosya sinyallerinden hesaplanır (satır sayısı, App.tsx/diğer
   *  bileşenlerde kullanılıyor mu, TODO/stub/placeholder işaretleri) —
   *  "bitti/eksik" gibi kesin bir iddia ÜRETMEZ, yalnız ham sinyalleri döner;
   *  istemci bunu açıkça "sezgisel gösterge" etiketiyle sunar (bkz. CLAUDE.md
   *  "sahte kesinlik gösterme"). 2026-08-16, süper-admin panel isteği.
   */
  const MODULE_REGISTRY: { id: string; label: string; file: string; group: string }[] = [
    { id: 'crm', label: 'CRM (Satış Hunisi)', file: 'src/pages/CRMPage.tsx', group: 'Satış' },
    { id: 'orders', label: 'Sipariş & Lojistik', file: 'src/pages/OrdersPage.tsx', group: 'Satış' },
    { id: 'inventory', label: 'Envanter', file: 'src/pages/InventoryPage.tsx', group: 'Stok' },
    { id: 'muhasebe', label: 'Muhasebe (ana)', file: 'src/pages/MuhasebePage.tsx', group: 'Muhasebe' },
    { id: 'satinalma', label: 'Satın Alma', file: 'src/pages/SatinAlmaPage.tsx', group: 'Satın Alma' },
    { id: 'ik', label: 'İnsan Kaynakları', file: 'src/pages/IKPage.tsx', group: 'IK' },
    { id: 'raporlar', label: 'Raporlar', file: 'src/pages/RaporlarPage.tsx', group: 'Rapor' },
    { id: 'admin', label: 'Admin', file: 'src/pages/AdminPage.tsx', group: 'Yönetim' },
    { id: 'ayarlar', label: 'Ayarlar', file: 'src/pages/SettingsPage.tsx', group: 'Yönetim' },
    { id: 'dashboard', label: 'Dashboard', file: 'src/pages/DashboardPage.tsx', group: 'Genel' },
    { id: 'b2bportal', label: 'B2B Portal', file: 'src/components/B2BPortal.tsx', group: 'Satış' },
    { id: 'hr', label: 'HR Modülü', file: 'src/components/HRModule.tsx', group: 'IK' },
    { id: 'legal', label: 'Hukuk', file: 'src/components/LegalModule.tsx', group: 'Yönetim' },
    { id: 'quality', label: 'Kalite', file: 'src/components/QualityModule.tsx', group: 'Üretim' },
    { id: 'production', label: 'Üretim', file: 'src/components/ProductionModule.tsx', group: 'Üretim' },
    { id: 'mrp', label: 'MRP', file: 'src/components/MRPModule.tsx', group: 'Üretim' },
    { id: 'bom', label: 'Ürün Ağacı (BOM)', file: 'src/components/BOMPanel.tsx', group: 'Üretim' },
    { id: 'bakim', label: 'Bakım', file: 'src/components/BakimModule.tsx', group: 'Üretim' },
    { id: 'servis', label: 'Servis', file: 'src/components/ServisModule.tsx', group: 'Satış' },
    { id: 'lotseri', label: 'Lot/Seri Takip', file: 'src/components/LotSeriModule.tsx', group: 'Stok' },
    { id: 'sube', label: 'Şube Yönetimi', file: 'src/components/SubeModule.tsx', group: 'Yönetim' },
    { id: 'holding', label: 'Holding', file: 'src/components/HoldingModule.tsx', group: 'Yönetim' },
    { id: 'kurumsalyonetim', label: 'Kurumsal Yönetim', file: 'src/components/CorporateGovernanceModule.tsx', group: 'Yönetim' },
    { id: 'maliyetmerkezi', label: 'Maliyet Merkezi', file: 'src/components/MaliyetMerkeziModule.tsx', group: 'Muhasebe' },
    { id: 'gelirtanima', label: 'Gelir Tanıma', file: 'src/components/GelirTanimaModule.tsx', group: 'Muhasebe' },
    { id: 'muhtasar', label: 'Muhtasar', file: 'src/components/MuhtasarModule.tsx', group: 'Muhasebe' },
    { id: 'sabitkiymet', label: 'Sabit Kıymet', file: 'src/components/SabitKiymetModule.tsx', group: 'Muhasebe' },
    { id: 'kasa', label: 'Kasa', file: 'src/components/KasaModule.tsx', group: 'Muhasebe' },
    { id: 'dunning', label: 'Tahsilat Hatırlatma', file: 'src/components/DunningModule.tsx', group: 'Muhasebe' },
    { id: 'ihracat', label: 'İhracat', file: 'src/components/IhracatModule.tsx', group: 'Satış' },
    { id: 'territory', label: 'Bölge Yönetimi', file: 'src/components/TerritoryModule.tsx', group: 'Satış' },
    { id: 'performans', label: 'Performans', file: 'src/components/PerformansModule.tsx', group: 'IK' },
    { id: 'cpq', label: 'CPQ (Teklif Yapılandırma)', file: 'src/components/CPQPanel.tsx', group: 'Satış' },
    { id: 'demandforecast', label: 'Talep Tahmini', file: 'src/components/DemandForecastPanel.tsx', group: 'Stok' },
    { id: 'priceintel', label: 'Fiyat İstihbaratı', file: 'src/components/PriceIntelPanel.tsx', group: 'Satış' },
    { id: 'dealercomm', label: 'Bayi Komisyonu', file: 'src/components/DealerCommissionPanel.tsx', group: 'Satış' },
    { id: 'subscription', label: 'Abonelik Yönetimi', file: 'src/components/SubscriptionPanel.tsx', group: 'Yönetim' },
    { id: 'mobilewms', label: 'Mobil WMS', file: 'src/components/MobileWMSModule.tsx', group: 'Stok' },
    { id: 'erp_hub', label: 'ERP Hub', file: 'src/components/ERPHubPanel.tsx', group: 'Entegrasyon' },
    { id: 'marketplace', label: 'Pazaryeri', file: 'src/components/MarketplacePanel.tsx', group: 'Entegrasyon' },
    { id: 'sku_mapping', label: 'SKU Eşleştirme', file: 'src/components/SkuMappingPanel.tsx', group: 'Entegrasyon' },
    { id: 'mutabakat', label: 'Mutabakat', file: 'src/components/MutabakatPanel.tsx', group: 'Muhasebe' },
    { id: 'overdue', label: 'Vadesi Geçen', file: 'src/components/OverduePanel.tsx', group: 'Muhasebe' },
    { id: 'risk', label: 'Risk Paneli', file: 'src/components/RiskPanel.tsx', group: 'Muhasebe' },
    { id: 'finance', label: 'Finans Paneli', file: 'src/components/FinancePanel.tsx', group: 'Muhasebe' },
    { id: 'analytics', label: 'Analitik', file: 'src/components/AnalyticsPanel.tsx', group: 'Rapor' },
  ];
  const MODULE_STUB_MARKERS = ['todo', 'yakında', 'coming soon', 'henüz bağlı değil', 'placeholder veri', 'mock veri', 'dummy veri', 'not implemented', 'stub veri', 'demo veri'];
  function walkSourceFiles(dir: string, out: string[] = []): string[] {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walkSourceFiles(full, out);
      else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }
  // ── Calisma ortami bilgisi (super-admin) ──────────────────────────────────
  // NEDEN VAR: firebase-admin 14 `node >=22` istiyor; CI Node 20'de, uretim
  // sunucusu ise chocolatey 'nodejs-lts' ile kuruldu ve GERCEK surumu hicbir
  // yerden gorunmuyordu. Yukseltme plani tahmine dayanamaz — bu uc olcumu
  // saglar. /api/health'e KONMADI: orasi kimliksiz erisilebiliyor ve tam
  // calisma-zamani surumunu disariya bildirmek gereksiz bilgi sizintisidir.
  app.get('/api/ops/runtime', requireAuth, requireSuperAdmin, (_req: Request, res: Response) => {
    let firebaseAdminSurum: string | null = null;
    try {
      firebaseAdminSurum = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'node_modules', 'firebase-admin', 'package.json'), 'utf8'),
      ).version as string;
    } catch { /* paket okunamazsa null */ }

    const majör = Number(process.versions.node.split('.')[0]);
    res.json({
      node: process.version,
      nodeMajor: majör,
      platform: `${process.platform} ${process.arch}`,
      firebaseAdmin: firebaseAdminSurum,
      // firebase-admin 14 engines: { node: '>=22' }
      firebaseAdmin14Uyumlu: majör >= 22,
      uptimeSaat: Math.round((process.uptime() / 3600) * 10) / 10,
    });
  });

  app.get('/api/ops/module-status', requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      const root = process.cwd();
      const scanDirs = [path.join(root, 'src', 'pages'), path.join(root, 'src', 'components'), path.join(root, 'src', 'App.tsx')];
      const files = scanDirs.flatMap(d => (fs.existsSync(d) && fs.statSync(d).isDirectory()) ? walkSourceFiles(d) : (fs.existsSync(d) ? [d] : []));
      const contents = new Map<string, string>();
      for (const f of files) { try { contents.set(f, fs.readFileSync(f, 'utf8')); } catch { /* okunamayan dosya atlanır */ } }
      const combined = [...contents.values()].join('\n');
      const modules = MODULE_REGISTRY.map(m => {
        const full = path.join(root, m.file);
        const content = contents.get(full);
        if (content === undefined) return { ...m, exists: false, lines: 0, stubMarkers: [] as string[], wired: false, mtimeMs: null as number | null };
        const lines = content.split('\n').length;
        const lower = content.toLowerCase();
        const stubMarkers = MODULE_STUB_MARKERS.filter(s => lower.includes(s));
        const compName = path.basename(m.file, path.extname(m.file));
        const occurrences = combined.split(compName).length - 1; // kendi dosyasındaki tanım + başka yerdeki kullanım(lar)
        const wired = occurrences >= 2;
        let mtimeMs: number | null = null;
        try { mtimeMs = fs.statSync(full).mtimeMs; } catch { /* yok say */ }
        return { ...m, exists: true, lines, stubMarkers, wired, mtimeMs };
      });
      res.json({ success: true, modules, generatedAt: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
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

  // ── Mikro Jump API Routes ────────────────────────────────────────────────────

  /** GET /api/mikro/status — is Mikro configured and the FULL API context working?
   *  Makes a real StokListesiV2 call (Size=1) so wrong KullaniciKodu/Sifre/Alias
   *  surface here instead of silently failing during imports.
   */
  /** GET /api/mikro/tablolar — Mikro tablo aynası: eşleşme kayıtları + canlı satır sayıları. */
  app.get('/api/mikro/tablolar', requireAuth, async (_req: Request, res: Response) => {
    if (!pgPool) return res.status(503).json({ success: false, error: 'DATABASE_URL tanımlı değil.' });
    try {
      const { rows: eslesme } = await pgPool.query('SELECT * FROM mikro_tablo_eslesme ORDER BY mikro_tablo');
      const tablolar: Record<string, number> = {};
      for (const e of eslesme) {
        const { rows } = await pgPool.query(`SELECT count(*)::int AS n FROM ${e.pg_tablo}`);
        tablolar[e.pg_tablo] = rows[0].n;
      }
      res.json({ success: true, eslesme, satirSayilari: tablolar });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/mikro/status', async (_req: Request, res: Response) => {
    const statusCreds = await getMikroCreds();
    if (!statusCreds) {
      // Hangi alanın eksik olduğunu MODA göre söyle (secret DEĞERİ asla yazma).
      const missing = MIKRO_LOCAL_MODE
        ? ['MIKRO_SIFRE'].filter(k => !process.env[k])
        : ['MIKRO_IDM_EMAIL', 'MIKRO_IDM_PASSWORD', 'MIKRO_API_KEY', 'MIKRO_ALIAS'].filter(k => !process.env[k]);
      return res.json({
        configured: false, connected: false,
        mode: MIKRO_LOCAL_MODE ? 'local' : 'cloud',
        message: `Mikro kimlik bilgileri yapılandırılmamış (${MIKRO_LOCAL_MODE ? 'LOKAL' : 'BULUT'} mod). ` +
          (missing.length
            ? `Sunucu .env'inde eksik: ${missing.join(', ')}. `
            : 'Ayarlar > Mikro ERP bölümünden girin veya sunucu .env değerlerini kontrol edin. ') +
          (MIKRO_LOCAL_MODE ? 'Lokal modda Alias/ApiKey/IDM gerekmez; KullaniciKodu boşsa SRV varsayılır.' : ''),
      });
    }
    try {
      // Bağlantı testi için HealthCheck kullanılır — StokListesiV2 ile 5 kayıt
      // çekmek gereksiz iş ve stok tablosu boşsa yanıltıcı (2026-07-30).
      // HealthCheck yoksa/eski sürümse StokListesiV2'ye düşülür.
      let { ok, data } = await mikroPost('HealthCheck', {});
      let r0h = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0h || r0h.IsError) {
        ({ ok, data } = await mikroPost('StokListesiV2', {
          StokKod: '', TarihTipi: 2,
          IlkTarih: '2000-01-01', SonTarih: mikroBugun(),
          Sort: 'sto_kod', Size: '5', Index: 0,
        }));
      }
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (ok && r0 && !r0.IsError) {
        return res.json({
          configured: true, connected: true,
          mode: MIKRO_LOCAL_MODE ? 'local' : 'cloud', apiBase: MIKRO_API_BASE,
          // Otomatik senkron GERÇEKTEN kurulu mu? Ayarın .env'e yazılmış olması
          // çalıştığı anlamına gelmiyor — süreç yeniden başlamadıysa eski değeri
          // taşır. Bunu dışarıdan görebilmek 2026-07-31'de gerekti.
          cronSync: {
            enabled: process.env.MIKRO_CRON_SYNC === 'true',
            program: process.env.MIKRO_CRON_SYNC === 'true'
              ? ['saatlik: stok+cari kartları', '03:20 SQL listeleri (90 gün)', '04:00 stok miktar/maliyet']
              : [],
          },
        });
      }
      // Cloudflare/WAF/gateway HTML hata sayfasını anlaşılır mesaja çevir (v17 IP-block)
      const gatewayBlock = detectMikroGatewayBlock(data);
      console.warn('Mikro status probe failed:', gatewayBlock || JSON.stringify(data)?.slice(0, 300));
      res.json({
        configured: true, connected: false,
        mode: MIKRO_LOCAL_MODE ? 'local' : 'cloud', apiBase: MIKRO_API_BASE,
        gatewayBlocked: !!gatewayBlock,
        error: gatewayBlock || (r0?.ErrorMessage as string) || `Mikro API bağlantı hatası (HTTP ${ok ? 200 : 'err'}: ${JSON.stringify(data)?.slice(0, 120)})`,
      });
    } catch (err) {
      // Ağ seviyesi hata (fetch failed / ECONNREFUSED / timeout): kullanıcıya
      // ham mesaj yerine ne yapacağını söyle. Port kullanılıyorsa TCP hiç
      // açılmıyor demektir (Cloudflare bu portları proxy'lemez / IP whitelist).
      const raw = err instanceof Error ? err.message : String(err);
      const portMatch = MIKRO_API_BASE.match(/:(\d+)/)?.[1];
      const netFail = /fetch failed|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|socket hang up|network/i.test(raw);
      const hint = netFail
        ? (portMatch
            ? `Mikro API'ye TCP bağlantısı kurulamadı (port ${portMatch}). ` +
              `Bu host Cloudflare arkasında ve Cloudflare ${portMatch} portunu YAYINLAMAZ — ya Mikro'nun verdiği ` +
              `port için DOĞRU HOST adresini (ör. firma-özel origin adresi) kullanın, ya da sunucu IP'nizin ` +
              `o port için whitelist'e eklendiğini Mikro destekten teyit edin. Ham hata: ${raw}`
            : `Mikro API'ye ulaşılamadı. MIKRO_API_URL portsuz görünüyor; Mikro'nun verdiği portu (V17=8094, V16=8084) ekleyin. Ham hata: ${raw}`)
        : raw;
      console.warn('Mikro status probe error:', raw, '| base:', MIKRO_API_BASE);
      res.json({ configured: true, connected: false, mode: MIKRO_LOCAL_MODE ? 'local' : 'cloud', apiBase: MIKRO_API_BASE, networkError: netFail, error: hint });
    }
  });

  /** POST /api/mikro/stok/kaydet — push inventory item → Mikro StokKaydetV2 */
  app.post('/api/mikro/stok/kaydet', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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

      const { ok, data, status } = await mikroPost('StokKaydetV2', { stoklar: [stok] }, true); // V17: stoklar Mikro objesi İÇİNDE (inMikro)
      const duration = Date.now() - t0;
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0 = envelope?.[0] as Record<string, unknown> | undefined;
      const success = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const mikroStoKod = stok.sto_kod;
      const errorMsg = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await writeSyncLog('StokKaydetV2', 'inventory', firebaseId, success, mikroStoKod, errorMsg, duration, reqActor(req));
      if (success) void mirrorMikroStoklar([stok]);

      if (adminDb && firebaseId && success) {
        await adminDb.collection('inventory').doc(firebaseId).update({
          mikroStoKod,
          mikroSynced:   true,
          mikroSyncedAt: pgServerTimestamp(),
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
  app.post('/api/mikro/stok/listesi', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
      void mirrorMikroStoklar(stoklar);

      // Mirror matched items back to Firebase
      if (adminDb && Array.isArray(stoklar)) {
        for (const s of stoklar) {
          const sku = s.sto_kod as string;
          if (!sku) continue;
          const snap = await adminDb.collection('inventory').where('sku', '==', sku).limit(1).get();
          if (!snap.empty) {
            const qty = mikroStokMiktari(s);
            await snap.docs[0].ref.update({
              mikroStoKod:   sku,
              mikroSynced:   true,
              // Miktar alanı yoksa mevcut stockLevel'i EZME (bkz. mikroStokMiktari).
              ...(qty !== null ? { stockLevel: qty } : {}),
              mikroSyncedAt: pgServerTimestamp(),
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

  /** POST /api/mikro/cari/kaydet — push lead/customer/supplier → Mikro CariKaydetV2.
   *  `collection` (varsayilan 'leads') hangi Firebase koleksiyonuna mikroCariKod
   *  yazilacagini belirler - 'suppliers' icin de kullanilabilir (Satinalma
   *  modulundeki tedarikci-Mikro eslestirme). */
  app.post('/api/mikro/cari/kaydet', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    const { lead, firebaseId, collection: targetCollection = 'leads' } = req.body as { lead: Record<string, unknown>; firebaseId: string; collection?: 'leads' | 'suppliers' };
    const t0 = Date.now();

    try {
      const cariKod = (lead.mikroCariKod as string) || `CAR${(firebaseId || Date.now().toString()).substring(0, 6).toUpperCase()}`;
      const contactName = (lead.contactName as string) || '';
      const nameParts   = contactName.split(' ');

      const cari = {
        cari_kod:                    cariKod,
        cari_unvan1:                 (lead.company  as string) || (lead.name as string) || '',
        cari_unvan2:                 '',
        cari_vdaire_no:              (lead.taxId     as string) || (lead.taxNo as string) || (lead.vkn as string) || '',
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

      // inMikro: V17 evrak kalıbı — payload (cariler) Mikro objesi İÇİNDE gider.
      const { ok, data, status } = await mikroPost('CariKaydetV2', { cariler: [cari] }, true);
      const duration = Date.now() - t0;
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0 = envelope?.[0] as Record<string, unknown> | undefined;
      const success = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const errorMsg = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await writeSyncLog('CariKaydetV2', targetCollection === 'suppliers' ? 'supplier' : 'lead', firebaseId, success, cariKod, errorMsg, duration, reqActor(req));
      if (success) void mirrorMikroCariler([cari]);

      if (adminDb && firebaseId && success) {
        await adminDb.collection(targetCollection).doc(firebaseId).update({
          mikroCariKod:  cariKod,
          mikroSynced:   true,
          mikroSyncedAt: pgServerTimestamp(),
        });
      }

      res.json({ success, cariKod, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await writeSyncLog('CariKaydetV2', targetCollection === 'suppliers' ? 'supplier' : 'lead', firebaseId || 'unknown', false, null, errorMsg, duration, reqActor(req));
      console.error('Mikro CariKaydetV2 hatası:', err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  /** POST /api/mikro/cari/listesi — pull Mikro CariListesiV2 → Firebase.
   *  `nameSearch` (serbest kullanici girdisi, ornegin tedarikci arama kutusu)
   *  ISTEMCIDEN GELEN whereStr'i GECERSIZ KILAR ve sunucu tarafinda tek tirnak
   *  escape edilerek guvenli bir LIKE filtresine cevrilir - Mikro'nun kendi
   *  WhereStr'i serbest SQL parcasi kabul ettigi icin (SqlVeriOkuV2/ListesiV2
   *  ortak deseni) dogrudan client whereStr'i arama girdisiyle beslemek
   *  Mikro'nun sorgusuna enjeksiyon acardi. */
  app.post('/api/mikro/cari/listesi', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });

    // 2026-07-31'de YENİDEN YAZILDI. Eski hali iki yönden eksikti:
    //  1) SAYFALAMA YOKTU — tek çağrı, `index` hiç artmıyordu. Bugün Mikro'da
    //     tam 200 cari olduğu için zarar görünmüyordu (sayfa boyutu da 200),
    //     ama 201. cari eklendiği gün gerisi SESSİZCE kaybolacaktı.
    //  2) YENİ MÜŞTERİ OLUŞTURMUYORDU — yalnız mikroCariKod'u eşleşen mevcut
    //     lead'i güncelliyordu; eşleşmeyen atlanıyordu. "Oluşturuldu: 0" bundan.
    // Artık gece cron'uyla AYNI mantık: tam sayfalama + upsert, eşleme
    // önceliği mikroCariKod → VKN → isim (elle oluşturulmuş kayıtların
    // mikroCariKod'u olmadığı için salt-kod eşleşme onları ikinci kez yaratırdı).
    const body = req.body || {};
    const nameSearch = typeof body.nameSearch === 'string' ? body.nameSearch.trim().slice(0, 100) : '';
    // Mikro WhereStr serbest SQL parçası kabul eder; istemci whereStr'i ASLA
    // doğrudan geçirilmez (enjeksiyon). nameSearch escape'li LIKE'a çevrilir.
    const whereStr = nameSearch
      ? `cari_unvan1 LIKE '%${nameSearch.replace(/'/g, "''")}%'`
      : "cari_baglanti_tipi=0 and cari_lastup_date > '2000/01/01'";
    const SAYFA = 200;
    const MAKS_SAYFA = 50;   // 10.000 cari tavanı; çarparsa yanıtta bildirilir
    const t0 = Date.now();

    try {
      const cariler: Record<string, unknown>[] = [];
      let tavanaCarpti = false;
      for (let index = 0; index < MAKS_SAYFA; index++) {
        const { ok, data, status } = await mikroPost('CariListesiV2', {
          FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl,cari_hareket_tipi,cari_baglanti_tipi',
          WhereStr:  whereStr,
          Sort:      'cari_kod',
          Size:      String(SAYFA),
          Index:     index,
        });
        if (!ok) return res.status(status).json({ success: false, error: mikroHata(data) });
        const sayfa = (mikroData(data).CariListesi ?? []) as Record<string, unknown>[];
        if (!sayfa.length) break;
        cariler.push(...sayfa);
        if (sayfa.length < SAYFA) break;
        if (index === MAKS_SAYFA - 1) tavanaCarpti = true;
      }
      void mirrorMikroCariler(cariler);

      // ── Upsert: eşleşen güncellenir, eşleşmeyen OLUŞTURULUR ──
      const companyId = await reqCompanyId(req);
      // KİRACI SINIRI: VKN (vergi no) eşleşmesi özellikle riskli — iki FARKLI
      // kiracının aynı gerçek firmayla müşteri ilişkisi olması gayet olası.
      // Filtre yoksa Kiracı A'nın senkronu Kiracı B'nin cari kaydını sessizce
      // ele geçirirdi (stok import'unda bugün bulunan sınıfın aynısı).
      const leadSnap = await tenantSnap('leads', companyId);
      const leadByKod = new Map<string, PgDocRef>();
      const leadByVkn = new Map<string, PgDocRef>();
      const leadByName = new Map<string, PgDocRef>();
      const vknNorm = (v?: string) => (v || '').replace(/\D/g, '');
      for (const d of leadSnap.docs) {
        const data = d.data();
        const dc = (data.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const kod = (data.mikroCariKod as string)?.trim();
        if (kod && !leadByKod.has(kod)) leadByKod.set(kod, d.ref);
        const vkn = vknNorm((data.taxId as string) || (data.taxNo as string));
        if (vkn && !leadByVkn.has(vkn)) leadByVkn.set(vkn, d.ref);
        const nameKey = ((data.name as string) || (data.company as string) || '').trim().toLowerCase();
        if (nameKey && !leadByName.has(nameKey)) leadByName.set(nameKey, d.ref);
      }

      let yeni = 0, guncel = 0;
      let batch = adminDb.batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = adminDb!.batch(); ops = 0; } };
      for (const c of cariler) {
        const kod = (c.cari_kod as string)?.trim();
        if (!kod) continue;
        const fields = {
          name: (c.cari_unvan1 as string) || kod,
          company: (c.cari_unvan1 as string) || '',
          email: (c.cari_EMail as string) || '',
          phone: (c.cari_CepTel as string) || '',
          taxId: (c.cari_vdaire_no as string) || '',
          taxOffice: (c.cari_vdaire_adi as string) || '',
          eFaturaKayitli: Number(c.cari_efatura_fl) === 1,
          type: Number(c.cari_hareket_tipi ?? 0) === 1 ? 'Supplier' : 'Customer',
          mikroCariKod: kod,
          mikroSynced: true, mikroSyncedAt: pgServerTimestamp(),
          companyId,
        };
        const vkn = vknNorm(fields.taxId);
        const nameKey = fields.name.trim().toLowerCase();
        const ref = leadByKod.get(kod)
          || (vkn ? leadByVkn.get(vkn) : undefined)
          || (nameKey ? leadByName.get(nameKey) : undefined);
        if (ref) { batch.update(ref, fields); guncel++; }
        else {
          const newRef = adminDb.collection('leads').doc();
          batch.set(newRef, { ...fields, status: 'Active', source: 'mikro_import', createdAt: pgServerTimestamp() });
          leadByKod.set(kod, newRef);
          yeni++;
        }
        if (++ops >= 400) await flush();
      }
      await flush();

      const duration = Date.now() - t0;
      const ozet = `${cariler.length} cari çekildi — ${yeni} yeni, ${guncel} güncellendi${tavanaCarpti ? ' — SAYFA TAVANINA ÇARPTI, veri eksik' : ''}`;
      await writeSyncLog('CariListesiV2', 'lead', ozet, true, null, null, duration, reqActor(req));
      await writeAuditLog(reqActor(req), 'Mikro Cari Listesi Çekme', ozet);
      res.json({ success: true, count: cariler.length, created: yeni, updated: guncel,
                 ...(tavanaCarpti ? { truncated: true, limit: MAKS_SAYFA * SAYFA } : {}), duration });
    } catch (err) {
      console.error('Mikro CariListesiV2 hatası:', err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /api/mikro/siparis/kaydet — push order → Mikro SiparisKaydetV2 */
  app.post('/api/mikro/siparis/kaydet', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
        // sip_tip='0' → SATIŞ (2026-08-22 denetim bulgusu C14). Eskiden '1' idi
        // ('1' = ALIŞ/verilen sipariş). Bu uç bir MÜŞTERİ satış siparişini
        // Mikro'ya yazıyor; okuma tarafı satışı tip 0 sayıyor
        // (OrdersPage.tsx:209, DashboardPage.tsx:145), tip 1'i satın alma
        // (PurchasingModule.tsx:76). '1' yazınca resmi satış Mikro'da alış
        // siparişi oluyor VE Cetpa satış ekranında hiç görünmüyordu.
        sip_tip:          '0',
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

      // inMikro: V17 evrak kalıbı — payload (evraklar) Mikro objesi İÇİNDE gider.
      const { ok, data, status } = await mikroPost('SiparisKaydetV2', {
        evraklar: [{ satirlar }],
      }, true);

      const duration = Date.now() - t0;
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0 = envelope?.[0] as Record<string, unknown> | undefined;
      const success = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const md = (r0?.Data ?? r0?.data ?? {}) as Record<string, unknown>;
      const mikroEvrakNo = (md?.evrakNo || md?.EvrakNo || md?.id || null) as string | null;
      const errorMsg = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await writeSyncLog('SiparisKaydetV2', 'order', firebaseId, success, mikroEvrakNo, errorMsg, duration, reqActor(req));
      if (success) void mirrorMikroInsert('mikro_siparisler', satirlar as unknown as Record<string, unknown>[], SIP_COLS);

      if (adminDb && firebaseId && success) {
        await adminDb.collection('orders').doc(firebaseId).update({
          mikroEvrakNo,
          mikroSynced:   true,
          mikroSyncedAt: pgServerTimestamp(),
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
  app.post('/api/mikro/import/stok', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });

    // Data is scoped by companyId (= uid of the account owner) — the app's
    // inventory listener filters on it, so imports MUST set it or items are invisible.
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await reqCompanyId(req);
    // Snapshot'lar aşağıda zaten çekiliyor; çözücüler ONLARIN id'lerinden
    // kurulur — aynı koleksiyonu istek başına iki kez tam gövdeyle taramamak
    // için (2026-08-22 verimlilik bulgusu).
    const invSnapOnce  = await tenantSnap('inventory', companyId);
    const depoSnapOnce = await tenantSnap('warehouses', companyId);
    const invId  = mikroIdCozucuIds(invSnapOnce.docs.map(d => d.id), companyId);
    const depoId = mikroIdCozucuIds(depoSnapOnce.docs.map(d => d.id), companyId);
    // ÇÖZÜCÜ, YAZILAN KOLEKSİYONUN KENDİSİNDEN kurulmalı: "eski biçimli id var mı"
    // kararı o koleksiyonun id'lerine bakar. Aşağıda warehouseItems ve
    // wmsLocations'a da yazılıyor; onlar için inventory/warehouses çözücüsünü
    // kullanmak kararı YANLIŞ koleksiyona sordurur ve C11'in kapatmaya
    // çalıştığı kiracılar-arası id çakışmasını geri getirir (code-review).
    const whItemId = await mikroIdCozucu('warehouseItems', companyId);
    const wmsId    = await mikroIdCozucu('wmsLocations', companyId);

    const t0 = Date.now();
    let created = 0, updated = 0, errors = 0;
    let skippedRecords = 0;
    /** Mikro'dan en az bir satış fiyatı gelen ürün sayısı (özet raporlanır). */
    let fiyatliUrun = 0;

    try {
      // Prefetch ALL inventory docs → Map<sku, ref>. ETİKETSİZ (companyId boş)
      // eski kayıtlar bilerek dahil — SKU ile eşleşip iyileştirilir (companyId
      // yazılır), çoğaltılmaz. Ama BAŞKA kiracıya ait (companyId DOLU ve farklı)
      // kayıt haritaya HİÇ girmez: aşağıdaki `batch.update(existingRef, item)`
      // item.companyId'yi KOŞULSUZ yazıyor — filtre olmasa eşleşen yabancı doküman
      // bu kiracıya SESSİZCE devredilirdi (2026-08-11'de bulundu; en sık kullanılan
      // "Stokları İçeri Al" düğmesi). Yabancı SKU haritada yoksa YENİ doküman
      // açılır — kiracı başına ayrı kayıt, doğru multi-tenant davranışı.
      const existingSnap = invSnapOnce;   // yukarıda bir kez çekildi
      const existingBySku = new Map<string, PgDocRef>();
      for (const docSnap of existingSnap.docs) {
        const veri = docSnap.data() as Record<string, unknown>;
        const dc = (veri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const sku = (veri.sku as string)?.trim();
        if (sku && !existingBySku.has(sku)) existingBySku.set(sku, docSnap.ref);
      }

      // Vergi tablosunu bir kez çek: sto_perakende_vergi indeksini gerçek
      // yüzdeye çevirmek için gerekli (bkz. vergiOraniCoz).
      const vergiTablosu = await mikroVergiOranlari();

      // Depo adları — "Depo 2" yerine "ESKI SANAYI" gösterebilmek için.
      // Depo Tanımları import'u çalıştıysa warehouses'ta mikro-depo-<no> id'li
      // dokümanlar vardır. Yoksa harita boş kalır ve kod numarası gösterilir.
      const depoAdlari = new Map<string, string>();
      try {
        const depoSnap = depoSnapOnce;    // yukarıda bir kez çekildi
        for (const d of depoSnap.docs) {
          const x = d.data() as Record<string, unknown>;
          const no = x.depoNo;
          if (no != null && x.name) depoAdlari.set(String(no), String(x.name));
        }
      } catch { /* depo adı çözülemezse kod gösterilir */ }

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
        void mirrorMikroStoklar(stoklar);
        reachedEnd = end;
        offset += CHUNK;
        if (stoklar.length === 0) { if (end) break; else continue; }

        for (const s of stoklar) {
          const sku = (s.sto_kod as string)?.trim();
          if (!sku) continue;

          try {
            // Map Mikro fields → Cetpa InventoryItem shape.
            // Fiyat mantığı ortak yardımcıda (cron import'u ile ayrışmasın).
            const prices = mikroSatisFiyatlari(s);
            if (Object.keys(prices).length) fiyatliUrun++;

            // Miktar alanı yoksa null — mevcut kaydın stockLevel'i EZİLMEZ
            // (bkz. mikroStokMiktari). Yeni kayıtta 0 ile açılır, miktar
            // /api/mikro/import/stok-miktar koşusunda dolar.
            const qty = mikroStokMiktari(s);
            const kdvOran = vergiOraniCoz(s.sto_perakende_vergi, vergiTablosu);
            const item = {
              companyId,
              sku,
              name:             (s.sto_isim as string)     || sku,
              category:         (s.sto_grup_isim as string) || (s.sto_grup_kodu as string) || 'Genel',
              unit:             (s.sto_birim1_ad as string) || 'ADET',
              // sto_perakende_vergi İNDEKStir, yüzde değil (bkz. vergiOraniCoz).
              ...(kdvOran !== null ? { vatRate: kdvOran } : {}),
              ...(qty !== null ? { stockLevel: qty } : {}),
              lowStockThreshold: 5,
              // Fiyat gelmediyse `prices`e DOKUNMA. Eskiden koşulsuz `prices` (boş
              // olabilen nesne) yazılıyordu: Mikro fiyat döndürmediği her senkronda
              // elle girilmiş fiyatlar `{}` ile eziliyordu — stockLevel/vatRate'te
              // düzeltilen sessiz-sıfır arıza sınıfının aynısı.
              ...(Object.keys(prices).length ? { prices, price: prices['Retail'] ?? 0 } : {}),
              mikroStoKod:      sku,
              mikroSynced:      true,
              source:           'mikro_import',
              mikroSyncedAt:    pgServerTimestamp(),
            };

            // Upsert via batch: update if exists, create if not
            const existingRef = existingBySku.get(sku);
            if (existingRef) {
              batch.update(existingRef, item);
              updated++;
            } else {
              const newRef = adminDb.collection('inventory').doc();
              batch.set(newRef, { stockLevel: 0, ...item, createdAt: pgServerTimestamp() });
              existingBySku.set(sku, newRef); // guard against duplicate SKUs across pages
              created++;
            }
            batchOps++;

            categorySet.add(item.category);

            // Depo kaydı: Depo sekmesi warehouseItems koleksiyonundan okur
            // sto_yer_kod BOŞSA '1' UYDURMA (2026-08-01 düzeltmesi). Eski kod
            // `|| '1'` yapıyordu; Mikro'da bu alan doldurulmadığı için TÜM
            // ürünler "Depo 1"de görünüyordu, oysa stok fiilen 2 numarada.
            // Bilinmiyorsa bilinmiyor yazılır — yanlış depo göstermek, depo
            // göstermemekten kötüdür.
            const yerKod = String(s.sto_yer_kod ?? '').trim();
            if (yerKod) depotCodes.set(yerKod, (depotCodes.get(yerKod) ?? 0) + 1);
            const depoAdi = yerKod
              ? (depoAdlari.get(yerKod) || `Depo ${yerKod}`)
              : 'Depo belirtilmemiş';
            const whItemRef = adminDb.collection('warehouseItems')
              .doc(whItemId(sku.replace(/[/\\]/g, '_')));
            batch.set(whItemRef, {
              companyId,
              productName: item.name,
              sku,
              // Miktar bilinmiyorsa depo kaydının quantity'sini de EZME.
              ...(qty !== null ? { quantity: qty } : {}),
              ...(yerKod ? { warehouseId: `mikro-depo-${yerKod}` } : {}),
              location:    depoAdi,
              category:    item.category,
              source:      'mikro_import',
              updatedAt:   pgServerTimestamp(),
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
        await adminDb.collection('warehouses').doc(depoId(`depo-${kod}`)).set({
          companyId,
          name:      `Depo ${kod}`,
          code:      kod,
          source:    'mikro_import',
          itemCount,
          updatedAt: pgServerTimestamp(),
        }, { merge: true });
        await adminDb.collection('wmsLocations').doc(wmsId(`depo-${kod}`)).set({
          companyId: await reqCompanyId(req),
          code:      `DEPO-${kod}`,
          aisle:     kod, rack: '00', level: '00',
          zone:      'storage',
          active:    true,
          source:    'mikro_import',
          updatedAt: pgServerTimestamp(),
        }, { merge: true });
      }

      // Kategorileri senkronize et: Mikro kategorilerini ekle, kullanılmayan
      // (dummy seed) kategorileri kaldır. Chip listesi categories koleksiyonu +
      // envanterdeki gerçek kategorilerden türediği için bu güvenlidir.
      if (categorySet.size > 0) {
        // YALNIZ BU KİRACININ kategorileri (2026-08-22 denetim bulgusu C9).
        // Eskiden `collection('categories').get()` TÜM kiracıların kategorilerini
        // okuyor ve Mikro setinde olmayan HER kategoriyi siliyordu — B kiracısı
        // import çalıştırınca A kiracısının elle açtığı kategoriler gidiyordu.
        // Yeni kategoriler de companyId'siz yazılıyordu (herkese görünür).
        const mevcutKats = await loadCompanyDocs('categories', companyId);
        const catBatch = adminDb.batch();
        const seen = new Set<string>();
        for (const cat of mevcutKats) {
          const name = (cat.name as string) || '';
          // Yalnız Mikro'dan gelmiş (source:'mikro_import') olup artık Mikro'da
          // olmayanı sil — kullanıcının ELLE açtığı kategoriye dokunma. Eski
          // davranış "Mikro setinde yoksa sil" idi ve elle açılanları da yutuyordu.
          const mikroKaynakli = (cat.source as string) === 'mikro_import';
          if (!categorySet.has(name)) {
            if (mikroKaynakli) catBatch.delete(adminDb.collection('categories').doc(String(cat.id)));
          } else seen.add(name);
        }
        for (const name of categorySet) {
          if (!seen.has(name)) {
            catBatch.set(adminDb.collection('categories').doc(), {
              name, source: 'mikro_import', companyId,
              createdAt: pgServerTimestamp(),
            });
          }
        }
        await catBatch.commit();
      }

      const duration = Date.now() - t0;
      // Fiyat kapsamı GÖRÜNÜR olmalı: import "2367 güncellendi" deyip fiyatların
      // hiç gelmediğini gizliyordu (kullanıcı ekranda 0 TL görünce fark etti).
      // fiyatliUrun = 0 ise sorun Cetpa'da değil, Mikro kartlarında fiyat yok demektir.
      const fiyatNot = `${fiyatliUrun}/${created + updated} üründe satış fiyatı bulundu`;
      await writeSyncLog('ImportStok', 'inventory', `${created} yeni / ${updated} güncel — ${fiyatNot}${skippedRecords ? ` / ${skippedRecords} bozuk atlandı` : ''}`, true, null, null, duration, reqActor(req));
      console.log(`Stok import tamamlandı — oluşturuldu: ${created}, güncellendi: ${updated}, ${fiyatNot}, hata: ${errors}, bozuk atlanan: ${skippedRecords}, süre: ${duration}ms`);
      res.json({ success: true, created, updated, errors, skippedRecords, fiyatliUrun, duration });

    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await writeSyncLog('ImportStok', 'inventory', 'bulk', false, null, errorMsg, duration, reqActor(req));
      console.error('Stok import genel hatası:', err);
      res.status(500).json({ success: false, error: errorMsg, created, updated, errors });
    }
  });

  /** POST /api/mikro/import/cari — import ALL Mikro cari → Firebase leads */
  app.post('/api/mikro/import/cari', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });

    // Data is scoped by companyId — the app's leads listener filters on it.
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await reqCompanyId(req);

    const t0 = Date.now();
    let created = 0, updated = 0, errors = 0;
    const PAGE_SIZE = 500;
    let index = 0;
    let hasMore = true;

    try {
      // Prefetch ALL leads → Map<mikroCariKod, ref> + Map<VKN, ref> + Map<isim, ref>.
      // ETİKETSİZ (companyId boş) eski kayıtlar bilerek dahil — cari koduyla
      // eşleşip iyileştirilir. VKN/isim fallback'i şart: manuel oluşturulmuş
      // (CRM/Muhasebe/B2B formları) bir lead'in hiç mikroCariKod'u olmaz.
      // KİRACI SINIRI: BAŞKA kiracıya ait (companyId DOLU ve farklı) kayıt
      // haritaya girmez — VKN eşleşmesi özellikle riskli, iki farklı kiracının
      // aynı gerçek firmayla müşteri ilişkisi olması olası (2026-08-11'de bulundu).
      const normalizeVkn = (v?: string) => (v || '').replace(/\D/g, '');
      const existingSnap = await tenantSnap('leads', companyId);
      const existingByKod = new Map<string, PgDocRef>();
      const existingByVkn = new Map<string, PgDocRef>();
      const existingByName = new Map<string, PgDocRef>();
      for (const docSnap of existingSnap.docs) {
        const data = docSnap.data();
        const dc = (data.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const kod = (data.mikroCariKod as string)?.trim();
        if (kod && !existingByKod.has(kod)) existingByKod.set(kod, docSnap.ref);
        const vkn = normalizeVkn((data.taxId as string) || (data.taxNo as string));
        if (vkn && !existingByVkn.has(vkn)) existingByVkn.set(vkn, docSnap.ref);
        const nameKey = ((data.name as string) || (data.company as string) || '').trim().toLowerCase();
        if (nameKey && !existingByName.has(nameKey)) existingByName.set(nameKey, docSnap.ref);
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
        void mirrorMikroCariler(cariler);
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
              mikroSyncedAt:  pgServerTimestamp(),
            };

            // Upsert oncelik sirasi: mikroCariKod (zaten Mikro'yla eslesmis) ->
            // VKN (en guvenilir kimlik) -> case-insensitive isim.
            const vkn = normalizeVkn(lead.taxId);
            const nameKey = unvan.trim().toLowerCase();
            const existingRef = existingByKod.get(cariKod)
              || (vkn ? existingByVkn.get(vkn) : undefined)
              || (nameKey ? existingByName.get(nameKey) : undefined);

            const targetRef = existingRef ?? adminDb.collection('leads').doc();
            if (existingRef) {
              batch.update(targetRef, { ...lead, companyId }); // güncellemede de etiketle (self-heal)
              updated++;
            } else {
              batch.set(targetRef, { ...lead, companyId, createdAt: pgServerTimestamp() });
              created++;
            }
            existingByKod.set(cariKod, targetRef);
            if (vkn) existingByVkn.set(vkn, targetRef);
            if (nameKey) existingByName.set(nameKey, targetRef);
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
  /** @deprecated mikroSatirlar kullan — o, dizi-sarmalı zarfı da açar.
   *  Burada yalnız geriye uyum için duruyor; çağıranlar mikroSatirlar'a geçti. */
  function firstArrayIn(d: Record<string, unknown>): Record<string, unknown>[] {
    for (const v of Object.values(d)) if (Array.isArray(v)) return v as Record<string, unknown>[];
    return [];
  }
  void firstArrayIn;

  /** Satırda regex ile alan anahtarı bul (örnek satırdan tespit) */

  /** Kolon seç: desenleri SIRAYLA dener, ilk eşleşeni döndürür. En SPESİFİK desen
   *  başa yazılır.
   *
   *  Neden gerekli: `findKey` tek bir gevşek desenle ilk eşleşen kolonu döndürür ve
   *  bu sessizce YANLIŞ kolonu seçebilir. Gerçek örnek (2026-08-11'de yakalandı):
   *      findKey(row, /sfiyat_fiyati|fiyat/i)  ->  'sfiyat_Guid'
   *  çünkü "s·fiyat·_Guid" de "fiyat" içeriyor ve Guid ilk kolon. Sonuç:
   *  Number(guid) = NaN -> her satır elenir -> HİÇ fiyat yazılmaz ama iş "başarılı"
   *  görünür. Tam olarak bu projede tekrarlayan sessiz-sıfır arıza sınıfı.
   *
   *  Ek koruma: değer alanı ararken `*_Guid` kolonları atlanır (kimlik alanı asla
   *  tutar/ad/kod değildir). `guidDahil` ile bilinçli olarak açılabilir.
   */

  /** SqlVeriOkuV2 tabanlı liste import — V17'de karşılığı OLMAYAN liste
   *  metotlarının yerine geçer.
   *
   *  Neden: `SiparisListesiV2`, `FaturaListesiV2`, `StokHareketListesiV2`,
   *  `BankaListesiV2`, `KasaListesiV2`, `OdemePlanListesiV2`, `BarkodListesiV2`
   *  Mikro Jump V17'de YOK (Postman koleksiyonu + OpenAPI spec, ikisi de).
   *  V17'nin liste yüzeyi yalnız Stok/Cari listesi + SqlVeriOkuV2. Bu uçlar
   *  eskiden var olmayan metodu çağırıp sessizce boş dönüyordu.
   *
   *  `SELECT *` kullanılıyor: kolon adlarını önceden bilmeye gerek yok, satırlar
   *  ham haliyle saklanır ve mevcut postProcess/findKey alan tespiti aynen çalışır.
   *  Sayfalama SQL Server'ın OFFSET/FETCH'i ile (ORDER BY zorunlu).
   *
   *  GÜVENLİK: sorgu ham SQL olarak Mikro'ya gider. Tablo/sıralama adı sabit
   *  (kod içinde), tarih ve sayfa boyutu sqlTarih/sqlTamsayi ile KATI doğrulanır.
   *  İstemciden gelen hiçbir string doğrudan sorguya girmez.
   */
  /** SQL import'un ÇEKİRDEĞİ — hem HTTP route'u hem gece cron'u bunu çağırır.
   *  2026-07-31'de route handler'ından ayrıldı: cron'dan da koşabilmesi için.
   *  Ayrıntılı gerekçe makeMikroSqlImport'ta. */
  type SqlImportOpts = {
    route?:       string;
    tablo:        string;              // takma ad içerebilir: "TABLO t"
    siralama:     string;
    collection:   string;
    label:        string;
    tarihKolonu?: string;
    ekKosul?:     string;
    /** SELECT listesi (varsayılan '*'). JOIN'li sorgularda "t.*, x AS y" gibi. */
    secim?:       string;
    /** İstenen kolon adları — çalışma anında INFORMATION_SCHEMA'ya karşı süzülür;
     *  şemada OLMAYAN kolonlar düşürülür, import patlamaz. `secim` yerine kullanılır.
     *  Neden: elle yazılan tek bir yanlış kolon adı ("Invalid column name") TÜM
     *  import'u öldürüyordu — cha_vergi ve cha_ettn ile iki kez yaşandı. */
    secimKolonlari?: string[];
    /** FROM'a eklenecek JOIN ifadesi. Kod içinde SABİT — istemciden gelmez. */
    fromEk?:      string;
    /**
     * İptal bayrağı kolonu (ör. 'cha_iptal', 'sth_iptal'). Verilirse import
     * sonrası "iptal süpürgesi" koşar: aynı tarih penceresinde Mikro'da İPTAL
     * EDİLMİŞ satırların GUID'leri çekilir ve yerel kopyaları silinir.
     *
     * NEDEN GEREKLİ (2026-08-22 denetim bulgusu C17): ekKosul iptalleri dışlar,
     * yani bir kayıt önce geçerliyken inip SONRADAN Mikro'da iptal edilirse
     * import onu bir daha HİÇ görmez — `merge: true` de asla silmez. Yerel kopya
     * HAYALET olarak kalır ve ciro/KDV/stok rakamlarına sonsuza dek katılır.
     * Filtre tek başına bu sınıfı çözmez; süpürge çözer.
     */
    iptalKolonu?: string;
    postProcess?: (rows: Record<string, unknown>[], companyId: string) => Promise<string | null>;
  };

  async function mikroSqlImportCalistir(
    opts: SqlImportOpts,
    companyId: string,
    ilkTarih: string,
    sonTarih: string,
    actor: { uid: string; email: string },
  ): Promise<{ ok: boolean; total: number; note: string | null; truncated: boolean; error?: string; duration: number; guidsizSatir?: number }> {
    const t0 = Date.now();
    // Kararli kimligi (GUID) olmayan satir sayisi — mukerrer kayit riski.
    let guidsizSatir = 0;
    const SAYFA = 500;
    const MAKS_SAYFA = 40; // 20.000 satır tavanı — sessiz değil, yanıtta bildirilir
    if (!adminDb) return { ok: false, total: 0, note: null, truncated: false, error: 'Firebase Admin başlatılamadı.', duration: 0 };

    const kosullar: string[] = [];
    if (opts.ekKosul) kosullar.push(opts.ekKosul);
    if (opts.tarihKolonu) kosullar.push(`${opts.tarihKolonu} BETWEEN '${ilkTarih}' AND '${sonTarih}'`);
    const where = kosullar.length ? ` WHERE ${kosullar.join(' AND ')}` : '';

    // SELECT listesi. secimKolonlari verilmişse GERÇEK şemaya karşı süzülür:
    // Mikro sürümleri arasında kolon adları değişiyor ve elle yazılmış tek bir
    // yanlış ad ("Invalid column name 'cha_ettn'") tüm import'u öldürüyordu.
    // Artık olmayan kolon sessizce düşer — o alan eksik gelir, veri akmaya devam eder.
    let secim = opts.secim ?? '*';
    let dusenKolonlar: string[] = [];
    if (opts.secimKolonlari?.length) {
      const anaTablo = opts.tablo.trim().split(/\s+/)[0];
      const gercek = await mikroKolonlar(anaTablo);
      if (gercek.length) {
        const gercekSet = new Set(gercek.map(c => c.toLowerCase()));
        const kalan = opts.secimKolonlari.filter(c => gercekSet.has(c.toLowerCase()));
        dusenKolonlar   = opts.secimKolonlari.filter(c => !gercekSet.has(c.toLowerCase()));
        secim = kalan.length ? kalan.join(', ') : '*';
      }
      // Şema okunamadıysa '*' ile devam — daraltılmış liste uydurmaktan güvenli.
    }

    // ORDER BY kolonu da şemaya karşı doğrulanır: OFFSET/FETCH için ZORUNLU
    // olduğundan yanlış tek bir ad ("Invalid column name 'dbs_Guid'") ilk sayfayı,
    // dolayısıyla TÜM import'u öldürür — SELECT tarafında az önce kapatılan arıza
    // sınıfının aynısı (demirbas/maliyet-merkezi import'larının dbs_Guid/som_Guid
    // sıralaması hiç doğrulanmamıştı). Yalnız SADE tanımlayıcılar denetlenir;
    // "cha_tarihi DESC, cha_Guid" gibi bileşik ifadeler dokunulmadan geçer.
    let siralama = opts.siralama;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(siralama)) {
      const anaTablo2 = opts.tablo.trim().split(/\s+/)[0];
      const semaCols = await mikroKolonlar(anaTablo2);   // 10 dk önbellekli, ek maliyet yok
      if (semaCols.length && !semaCols.some(c => c.toLowerCase() === siralama.toLowerCase())) {
        const yedek = semaCols.find(c => /_Guid$/i.test(c)) ?? semaCols[0];
        console.warn(`[sqlImport ${anaTablo2}] sıralama kolonu '${siralama}' şemada yok → '${yedek}' kullanılıyor`);
        siralama = yedek;
      }
      // Şema okunamadıysa yazılan adla devam — uydurma kolon seçmekten güvenli.
    }

    const allRows: Record<string, unknown>[] = [];
    let sayfa = 0, total = 0, tavanaCarpti = false;
    try {
      while (sayfa < MAKS_SAYFA) {
        const offset = sayfa * SAYFA;
        const { rows, hata } = await mikroSql(
          `SELECT ${secim} FROM ${opts.tablo}${opts.fromEk ?? ''}${where} ` +
          `ORDER BY ${siralama} OFFSET ${offset} ROWS FETCH NEXT ${SAYFA} ROWS ONLY`,
        );
        if (hata) {
          // Başarısızsa hiçbir şey yazma — yarım/boş veri gerçek veriyi ezmesin.
          await writeSyncLog(`SQL:${opts.tablo}`, opts.collection, opts.label, false, null, hata, Date.now() - t0, actor);
          return { ok: false, total: 0, note: null, truncated: false, error: `${opts.label}: ${hata}`, duration: Date.now() - t0 };
        }
        if (!rows.length) break;

        let batch = adminDb.batch(); let ops = 0;
        for (const row of rows) {
          const guidKey = findKey(row, /_Guid$/i);
          // KARARLI KIMLIK YOKSA MUKERRER KAYIT URETILIR.
          // docId GUID'den turetilir; GUID yoksa RASTGELE id atanir ve bu
          // durumda import her calistirildiginda AYNI Mikro satiri YENI bir
          // dokuman olarak eklenir — 5 kosuda 5 kopya. Hicbir hata vermez,
          // yalnizca kayit sayisi sessizce sisip raporlari bozar. Bu yuzden
          // sayiliyor ve ozette YUKSEK SESLE bildiriliyor (2026-08-18).
          const kararliId = !!(guidKey && row[guidKey]);
          if (!kararliId) guidsizSatir++;
          const docId = kararliId
            ? String(row[guidKey as string])
            : adminDb.collection(opts.collection).doc().id;
          batch.set(adminDb.collection(opts.collection).doc(docId), {
            ...row, companyId, source: 'mikro_sql', syncedAt: pgServerTimestamp(),
          }, { merge: true });
          if (++ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
        }
        if (ops > 0) await batch.commit();

        allRows.push(...rows);
        total += rows.length;
        if (rows.length < SAYFA) break;
        sayfa++;
        if (sayfa >= MAKS_SAYFA) tavanaCarpti = true;
      }

      let postNote: string | null = null;
      if (opts.postProcess && allRows.length > 0) postNote = await opts.postProcess(allRows, companyId);

      // ── İptal süpürgesi (C17) ────────────────────────────────────────────
      // Mikro'da SONRADAN iptal edilmiş satırların yerel hayalet kopyalarını
      // sil. ekKosul onları çektiğimiz veriden çıkarır; bu adım daha önce
      // çekilmiş olanları temizler. Süpürge başarısız olursa import'u
      // düşürmüyoruz (veri zaten indi) ama özette YÜKSEK SESLE bildiriyoruz —
      // sessizce atlarsak hayalet sorunu geri gelir ve kimse görmez.
      let supurulen = 0; let supurgeHata: string | null = null;
      if (opts.iptalKolonu && opts.tarihKolonu) {
        try {
          const anaTablo  = opts.tablo.trim().split(/\s+/)[0];
          // TAKMA AD SOYULUR: fatura-listesi tanımı `tablo: 'CARI_HESAP_HAREKETLERI cha'`
          // ve `tarihKolonu: 'cha.cha_tarihi'` kullanıyor. Süpürge sorgusu takma
          // adsız FROM yazdığı için `cha.` öneki "The multi-part identifier
          // could not be bound" hatası verirdi — süpürge her koşuda sessizce
          // (aslında özette gürültülü) başarısız olurdu.
          const tarihKol  = opts.tarihKolonu.includes('.')
            ? opts.tarihKolonu.slice(opts.tarihKolonu.lastIndexOf('.') + 1)
            : opts.tarihKolonu;
          const iptalKol  = opts.iptalKolonu.includes('.')
            ? opts.iptalKolonu.slice(opts.iptalKolonu.lastIndexOf('.') + 1)
            : opts.iptalKolonu;
          const semaCols  = await mikroKolonlar(anaTablo);
          const guidKolon = semaCols.find(c => /_Guid$/i.test(c));
          const semaSet = new Set(semaCols.map(c => c.toLowerCase()));
          if (!guidKolon) {
            supurgeHata = `${anaTablo}: GUID kolonu yok, iptal süpürgesi çalışamaz`;
          } else if (semaCols.length && !semaSet.has(iptalKol.toLowerCase())) {
            // CLAUDE.md: Mikro kolon adı TAHMİN ETME — şemada yoksa yüksek sesle
            // başarısız ol, "hiç iptal yok" gibi sessiz bir sonuç üretme.
            supurgeHata = `${anaTablo}.${iptalKol} şemada yok — iptal süpürgesi atlandı`;
          } else {
            const { ok: sOk, data: sData } = await mikroPost('SqlVeriOkuV2', {
              SQLSorgu: `SELECT ${guidKolon} FROM ${anaTablo} WHERE ISNULL(${iptalKol}, 0) <> 0 `
                + `AND ${tarihKol} BETWEEN '${ilkTarih}' AND '${sonTarih}'`,
            });
            const sr0 = ((sData as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
            if (!sOk || !sr0 || sr0.IsError) {
              supurgeHata = String(sr0?.ErrorMessage || 'Mikro iptal sorgusu başarısız');
            } else {
              const iptalRows = (sr0.Data ?? sr0.data ?? []) as Record<string, unknown>[];
              // docId = GUID (yukarıdaki yazma ile AYNI türetim) — sapmaması şart.
              const ids = iptalRows.map(r => String(r[guidKolon] ?? '')).filter(Boolean);

              // SİLİNECEKLERİ TEK SORGUYLA BUL (satır başına `ref.get()` DEĞİL).
              // Bir mali yıl penceresinde binlerce iptal satırı olabiliyor;
              // her biri için ayrı SELECT, HTTP isteği içinde binlerce sıralı
              // gidiş-dönüş demekti ve tamamı ZATEN SİLİNMİŞ olsa bile her
              // import'ta tekrar koşuyordu (var-yok bilgisi ancak get() ile
              // öğreniliyordu). Tek sorgu hem var olanı hem sahipliği süzer;
              // etiketsiz (companyId'siz) eski kayıt yine eşleşir, yabancı
              // kiracınınki hiç dönmez.
              const silinecek: string[] = [];
              if (pgPool) {
                const PARCA = 1000;   // ANY($2) için makul parti boyu
                for (let i = 0; i < ids.length; i += PARCA) {
                  const { rows: bulunan } = await pgPool.query(
                    `SELECT id FROM docs WHERE coll = $1 AND id = ANY($2::text[])
                       AND (data->>'companyId' = $3 OR NOT (data ? 'companyId'))`,
                    [opts.collection, ids.slice(i, i + PARCA), companyId],
                  );
                  for (const r of bulunan) silinecek.push(String((r as { id: string }).id));
                }
              } else {
                // Firestore yedek yolu (lokal dev): toplu sorgu yok, tek tek bak.
                for (const id of ids) {
                  const mevcut = await adminDb.collection(opts.collection).doc(id).get();
                  if (!mevcut.exists) continue;
                  const dc = ((mevcut.data() as Record<string, unknown> | undefined)?.companyId as string) || '';
                  if (dc && dc !== companyId) continue;
                  silinecek.push(id);
                }
              }
              let sBatch = adminDb.batch(); let sOps = 0;
              for (const id of silinecek) {
                sBatch.delete(adminDb.collection(opts.collection).doc(id)); supurulen++;
                if (++sOps >= 450) { await sBatch.commit(); sBatch = adminDb.batch(); sOps = 0; }
              }
              if (sOps > 0) await sBatch.commit();
            }
          }
        } catch (sErr) {
          supurgeHata = sErr instanceof Error ? sErr.message : String(sErr);
        }
      }

      const duration = Date.now() - t0;
      const ozet = `${total} kayıt${tavanaCarpti ? ' — SAYFA TAVANINA ÇARPTI, veri eksik' : ''}` +
        `${dusenKolonlar.length ? ` — şemada olmayan kolonlar atlandı: ${dusenKolonlar.join(', ')}` : ''}` +
        `${siralama !== opts.siralama ? ` — sıralama kolonu '${opts.siralama}' bulunamadı, '${siralama}' kullanıldı` : ''}` +
        `${postNote ? ` — ${postNote}` : ''}` +
        `${supurulen ? ` — ${supurulen} iptal edilmiş kayıt silindi` : ''}` +
        `${supurgeHata ? ` — ⚠ iptal süpürgesi başarısız: ${supurgeHata}` : ''}` +
        (guidsizSatir
          ? ` — ⚠ ${guidsizSatir} satırda GUID yok: bu satırlar her çalıştırmada MÜKERRER kayıt oluşturur`
            + `${guidsizSatir === total ? ' (TÜM satırlar — tabloda GUID kolonu yok, import tekrarlanmamalı)' : ''}`
          : '');
      // Senkronizasyon Geçmişi bu koleksiyonu okur — import'lar 2026-07-31'e
      // kadar buraya HİÇ yazmıyordu, panel bu yüzden boş görünüyordu.
      await writeSyncLog(`SQL:${opts.tablo}`, opts.collection, ozet, true, null, null, duration, actor);
      await writeAuditLog(actor, opts.label, `${ozet} (SQL: ${opts.tablo})`);
      return { ok: true, total, note: postNote, truncated: tavanaCarpti, duration, guidsizSatir };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sqlImport ${opts.tablo}]`, msg);
      await writeSyncLog(`SQL:${opts.tablo}`, opts.collection, opts.label, false, null, msg, Date.now() - t0, actor);
      return { ok: false, total: 0, note: null, truncated: false, error: `${opts.label} başarısız.`, duration: Date.now() - t0 };
    }
  }

  /** SqlVeriOkuV2 tabanlı liste import — V17'de karşılığı OLMAYAN liste
   *  metotlarının yerine geçer.
   *
   *  Neden: `SiparisListesiV2`, `FaturaListesiV2`, `StokHareketListesiV2`,
   *  `BankaListesiV2`, `KasaListesiV2`, `OdemePlanListesiV2`, `BarkodListesiV2`
   *  Mikro Jump V17'de YOK (Postman koleksiyonu + OpenAPI spec, ikisi de).
   *
   *  `SELECT *` kullanılıyor: kolon adlarını önceden bilmeye gerek yok.
   *  Sayfalama SQL Server'ın OFFSET/FETCH'i ile (ORDER BY zorunlu).
   *
   *  GÜVENLİK: tablo/sıralama adı sabit (kod içinde), tarih sqlTarih ile KATI
   *  doğrulanır. İstemciden gelen hiçbir string doğrudan sorguya girmez.
   */
  const SQL_IMPORT_TANIMLARI: SqlImportOpts[] = [];

  function makeMikroSqlImport(opts: SqlImportOpts) {
    SQL_IMPORT_TANIMLARI.push(opts);   // cron da aynı tanımları kullanır
    if (!opts.route) return;
    app.post(opts.route, requireAuth, async (req: Request, res: Response) => {
      if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
      const sonuc = await mikroSqlImportCalistir(
        opts,
        await reqCompanyId(req),
        sqlTarih(req.body?.ilkTarih, '2020-01-01'),
        sqlTarih(req.body?.sonTarih, mikroBugun()),
        reqActor(req),
      );
      if (!sonuc.ok) return res.status(502).json({ success: false, error: sonuc.error });
      res.json({ success: true, total: sonuc.total, note: sonuc.note, tablo: opts.tablo, guidsizSatir: sonuc.guidsizSatir ?? 0,
                 ...(sonuc.truncated ? { truncated: true, limit: 40 * 500 } : {}), duration: sonuc.duration });
    });
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
      // Kullanıcının uid'i DEĞİL, ait olduğu firmanın id'si (bkz. writeAuditLog
      // aynı hatası, 2026-07-30). Çalışanın çektiği kayıtlar firmanın değil
      // çalışanın id'siyle damgalanıyordu.
      const companyId = await reqCompanyId(req);
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
          const rows = mikroSatirlar(data);
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
              syncedAt:  pgServerTimestamp(),
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

  // ── V17'de metodu OLMAYAN listeler: SqlVeriOkuV2 üzerinden ────────────────
  // Tablo adları müşterinin veritabanından INFORMATION_SCHEMA ile doğrulandı
  // (2026-07-30) — tahmin değil.

  // 1. Siparişler → mikroSiparisler   (eski: SiparisListesiV2, V17'de YOK)
  makeMikroSqlImport({
    route: '/api/mikro/import/siparis', tablo: 'SIPARISLER', siralama: 'sip_Guid',
    collection: 'mikroSiparisler', label: 'Mikro Sipariş Listesi',
    tarihKolonu: 'sip_tarih',
  });

  // 2. Faturalar → mikroFaturalar     (eski: FaturaListesiV2, V17'de YOK)
  //
  // Fatura BAŞLIĞI = CARI_HESAP_HAREKETLERI, cha_evrak_tip 63.
  // Ama başlıkta KDV ve MATRAH YOK — onlar SATIRLARDA (STOK_HAREKETLERI).
  // Bu yüzden satırlar fatura bazında toplanıp başlığa JOIN'leniyor.
  //
  // Birleştirme anahtarı canlıda DOĞRULANDI (2026-08-01):
  //   sth_evraktip = 4 (satış faturası satırı), sth_evrakno_sira = cha_evrakno_sira
  //   Fatura 321: başlık 21.600 = satır 18.000 (matrah) + 3.600 (KDV) ✓
  //   Fatura 322: başlık 13.062 = 10.885 + 2.177 ✓
  // Seri bu kurulumda boş; yine de anahtara dahil (başka kurulumda dolu olabilir).
  //
  // vergiPntr İNDEKStir, yüzde değil — vergiOraniCoz ile çevrilir (bkz. o fonksiyon).
  makeMikroSqlImport({
    route: '/api/mikro/import/fatura-listesi',
    tablo: 'CARI_HESAP_HAREKETLERI cha',
    fromEk: ' LEFT JOIN (' +
              'SELECT sth_evrakno_seri, sth_evrakno_sira, sth_evraktip, ' +
              'SUM(sth_vergi) AS kdv, SUM(sth_tutar) AS matrah, MIN(sth_vergi_pntr) AS vergiPntr, ' +
              // Karma KDV tespiti (2026-08-17, kullanıcı bildirdi): bir faturada
              // hem %10 hem %20'li ürün olabilir. Tek `vergiPntr` (MIN) o zaman
              // yanıltıcı — matrah/kdv toplamları doğru ama görünen tek oran
              // faturanın tamamını temsil etmiyor. Karma ise istemci "Karma" gösterir.
              // ISNULL(...,-1): COUNT(DISTINCT) NULL'ları görmezden gelir — bir
              // satırın gerçek orana (ör. %20) diğerinin NULL/çözülemeyen orana
              // sahip olduğu fatura, ISNULL olmadan "tek oran" gibi görünürdü.
              // CAST ONCE, ISNULL SONRA — sirasi KRITIK.
              // SQL Server'da ISNULL(kolon, deger) donus tipini KOLONDAN alir.
              // sth_vergi_pntr tinyint (0-255) oldugu icin `ISNULL(col, -1)`
              // -1'i tinyint'e cevirmeye calisiyor ve TUM SORGU
              // "Arithmetic overflow error for data type tinyint, value = -1"
              // ile oluyordu — yani fatura import'u komple calismiyordu
              // (2026-08-18 canli bildirimi; hatayi 2026-08-17'de karma-KDV
              // duzeltmesinde ben eklemistim).
              // Once INT'e cast edilince nobet degeri sorunsuz sigiyor.
              // NOT: COUNT(DISTINCT) NULL'lari saymaz; bu yuzden NULL'u ayri
              // bir deger olarak isaretlemek SART — aksi halde "bir gercek
              // oran + NULL satirlar" tek oranmis gibi gorunur ve fatura
              // yanlislikla karma-KDV sayilmaz.
              'COUNT(DISTINCT ISNULL(CAST(sth_vergi_pntr AS INT), -1)) AS oranSayisi ' +
              'FROM STOK_HAREKETLERI WHERE sth_evraktip IN (3, 4) ' +
              'GROUP BY sth_evrakno_seri, sth_evrakno_sira, sth_evraktip' +
            ') sat ON sat.sth_evrakno_seri = cha.cha_evrakno_seri ' +
            'AND sat.sth_evrakno_sira = cha.cha_evrakno_sira ' +
            // Yön eşleşmesi ŞART: satış ve alış aynı evrak numarasını
            // kullanabiliyor (seri boş). evraktip'i de anahtara katmazsak
            // bir satış faturasına alış satırının KDV'si bağlanabilir.
            'AND sat.sth_evraktip = CASE WHEN cha.cha_tip = 0 THEN 4 ELSE 3 END',
    secim: 'cha.*, ISNULL(sat.kdv, ISNULL(cha.cha_meblag - cha.cha_aratoplam, 0)) AS kdvTutari, ISNULL(sat.matrah, ISNULL(cha.cha_aratoplam, 0)) AS matrah, sat.vergiPntr, sat.oranSayisi',
    siralama: 'cha.cha_Guid',
    collection: 'mikroFaturalar', label: 'Mikro Fatura Listesi',
    tarihKolonu: 'cha.cha_tarihi',
    // ALIŞ FATURALARI 63'TE DEĞİL (2026-08-01 keşfi):
    //   SATIŞ  = cha_evrak_tip 63
    //   ALIŞ   = cha_evrak_tip 0, cha_cinsi 6
    //
    // Satır eşleşmesi doğrulandı: fatura 378 başlık 155.088 = satır 129.240
    // matrah + 25.848 KDV ✓ · fatura 380: 36.000 = 30.000 + 6.000 ✓
    //
    // ⚠️ AÇIK BULGU — cha_cinsi=6 filtresi HENÜZ CİRO OLARAK DOĞRULANMADI.
    // Kullanıcının Mikro portal raporuyla (01.01.2026–01.08.2026) tie-out:
    //   portal GELEN 220 belge 13.907.047 ₺ · GİDEN 188 belge 9.360.355 ₺
    // Benim cinsi=6 üzerinden verdiğim 269 belge / 132.737.531 ₺ belge başına
    // 493k ortalama demek; portal ortalaması 63k. 8 kat fark filtreyle de
    // açıklanamaz, tarih kapsamıyla da (bkz. aşağı).
    //
    // Hatanın kökü: bu rakamları ürettiğim keşif sorgularının HİÇBİRİNDE tarih
    // filtresi yoktu — tüm tabloyu tarıyorlardı. Giden raporda 2026 evrak sıra
    // aralığı 120→321 (202 belge) iken benim "320 satış" rakamım önceki yılları
    // da kapsıyor. Yıl bazlı doğrulama sorguları sema-kesif'e eklendi
    // (y2026_satisOzet / y2026_alisCinsDagilimi / y2026_cinsi6Ornek).
    // O çıktı portal raporuna oturmadan bu filtreden ciro rakamı SUNULMAYACAK.
    //
    // Not: import'un kendisi zaten tarih aralığıyla çalışıyor (tarihKolonu),
    // yani listelenen faturalar doğru; şüpheli olan yalnız cinsi=6 kapsamı.
    // ISNULL(cha.cha_iptal,0)=0: iptal edilmiş faturalar da geçerli fatura
    // olarak iniyordu (2026-08-22 denetim bulgusu C17) — KDV/Ba-Bs/ciro
    // rakamları iptal edilen her fatura kadar şişiyordu.
    ekKosul: '(cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6)) AND ISNULL(cha.cha_iptal, 0) = 0',
    iptalKolonu: 'cha_iptal',
    postProcess: async (rows) => {
      const kdvli = rows.filter(r => Number(r.kdvTutari ?? 0) > 0).length;
      return `${kdvli}/${rows.length} faturada KDV eşleşti`;
    },
  });

  // 2b. TÜM cari hareketler → mikroCariHareketler
  //
  // fatura-listesi YALNIZ fatura hareketlerini çeker (cha_evrak_tip 63 / cinsi 6).
  // Fatura-OLMAYAN hareketi olan cariler (7 MEHMET: sadece masraf; A BALIK) Cari
  // Ekstre'de BOŞ görünüyordu — cariBalances'ta bakiye var ama gösterilecek fatura
  // yok. Bu import evrak_tip filtresiz TÜM CARI_HESAP_HAREKETLERI'ni (fatura +
  // masraf + dekont + tahsilat + virman) çeker; Cari Ekstre bunu okur.
  //
  // Sıralama cha_tarihi DESC + cha_Guid (benzersiz tiebreak): OFFSET/FETCH sayfalama
  // deterministik kalır VE 20k tavanına çarparsa en ESKİ hareketler düşer (en az
  // ilgili olan). Bakiye = SUM(cha_tip=0 ? +meblag : -meblag) — eksi = Cetpa borçlu.
  // Yürüyen bakiye/etiket (hareketTipi) istemcide cha_evrak_tip'ten türetilir.
  makeMikroSqlImport({
    route: '/api/mikro/import/cari-hareket',
    tablo: 'CARI_HESAP_HAREKETLERI',
    // Kolon adları çalışma anında şemaya karşı süzülür (secimKolonlari) — Mikro
    // kurulumunda olmayan bir ad artık import'u öldürmez, yalnız o alan gelmez.
    // cha_ettn (e-belge GİB kimliği) bu kurulumda YOK; listede kalması zararsız,
    // başka kurulumda varsa otomatik gelir.
    secimKolonlari: ['cha_Guid', 'cha_evrakno_seri', 'cha_evrakno_sira', 'cha_tarihi',
                     'cha_tip', 'cha_cinsi', 'cha_evrak_tip', 'cha_kod', 'cha_aciklama',
                     'cha_meblag', 'cha_aratoplam', 'cha_ebelge_turu', 'cha_belge_no',
                     'cha_kasa_hizkod', 'cha_kasa_hizmet', 'cha_ettn', 'cha_uuid',
                     // Vade: Tahsilat & Vade Takibi ekranı gecikme hesabı için kullanır.
                     // Yoksa istemci fatura tarihine düşer (uydurma vade YAZILMAZ).
                     'cha_vade_tarihi'],
    siralama: 'cha_tarihi DESC, cha_Guid',
    ekKosul: 'cha_iptal = 0',
    iptalKolonu: 'cha_iptal',
    tarihKolonu: 'cha_tarihi',
    collection: 'mikroCariHareketler', label: 'Mikro Cari Hareketleri',
    postProcess: async (rows) => {
      // PG aynası (off-server yedek + raporlama). Fatura import'uyla aynı tablo.
      await mirrorMikroInsert('mikro_cari_hesap_hareketleri',
        rows.map(r => ({ ...r, __kaynak: 'cari_hareket_import' })), CHA_COLS);
      const borc = rows.filter(r => Number(r.cha_tip ?? 0) === 0).length;
      return `${borc} borç / ${rows.length - borc} alacak hareketi`;
    },
  });

  // 3. Stok hareketleri → inventoryMovements  (eski: StokHareketListesiV2, V17'de YOK)
  makeMikroSqlImport({
    route: '/api/mikro/import/stok-hareket', tablo: 'STOK_HAREKETLERI', siralama: 'sth_Guid',
    // İptal edilmiş stok hareketleri de iniyordu (C17): stok miktarı ve
    // hareket dökümü iptal edilen her irsaliye/fatura kadar sapıyordu.
    // Diğer STOK_HAREKETLERI sorguları zaten ISNULL(sth_iptal,0)=0 kullanıyor.
    ekKosul: 'ISNULL(sth_iptal, 0) = 0',
    iptalKolonu: 'sth_iptal',
    collection: 'inventoryMovements', label: 'Mikro Stok Hareketleri',
    tarihKolonu: 'sth_tarih',
    postProcess: async (rows) => {
      const sample = rows[0];
      const skuKey = findKey(sample, /st[ho]_?stok_?kod|sto_kod|stok_kod/i);
      const qtyKey = findKey(sample, /miktar/i);
      return `alanlar: sku=${skuKey ?? '?'}, miktar=${qtyKey ?? '?'}`;
    },
  });

  /** POST /api/mikro/fatura/kalemler — bir faturanın SATIRLARI (kalemleri).
   *  Body: { seri?: string, sira: number|string, yon: 'gelen'|'giden' }
   *
   *  Mikro Jump'ta fatura açılınca kalemler görülüyor; uygulamada yalnız başlık
   *  vardı (matrah/KDV/toplam). Satırlar STOK_HAREKETLERI'nde; birleştirme
   *  anahtarı fatura import'unda canlıda DOĞRULANMIŞTIR:
   *    sth_evraktip = 4 (satış satırı) / 3 (alış satırı) — yön eşleşmesi ŞART,
   *    çünkü seri boş olduğunda satış ve alış aynı evrak numarasını kullanabiliyor.
   *
   *  Kolon adları çalışma anında şemadan süzülür (mikroKolonlar) — elle yazılan
   *  yanlış bir ad tüm sorguyu öldürmesin (cha_vergi/cha_ettn arıza sınıfı).
   */
  app.post('/api/mikro/fatura/kalemler', requireAuth, mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    const sira = String(req.body?.sira ?? '').trim();
    if (!/^\d{1,12}$/.test(sira)) return res.status(400).json({ success: false, error: 'Geçerli bir evrak sıra no gerekli.' });
    // Seri harf/rakam olabilir; SQL'e girdiği için katı süz (enjeksiyon yüzeyi yok).
    const seri = String(req.body?.seri ?? '').trim();
    if (seri && !/^[A-Za-z0-9]{0,20}$/.test(seri)) return res.status(400).json({ success: false, error: 'Geçersiz evrak seri.' });
    const evrakTip = req.body?.yon === 'gelen' ? 3 : 4;

    // İstenen kolonlar — şemada olmayanlar düşürülür (ad TAHMİN EDİLMEZ).
    const istenen = ['sth_stok_kod', 'sth_miktar', 'sth_birim_pntr', 'sth_tutar',
                     'sth_vergi', 'sth_vergi_pntr', 'sth_iskonto1', 'sth_aciklama',
                     'sth_evrakno_seri', 'sth_evrakno_sira', 'sth_tarih', 'sth_satir_no'];
    const sthCols = await mikroKolonlar('STOK_HAREKETLERI');
    const sthSet  = new Set(sthCols.map(c => c.toLowerCase()));
    const secim = sthCols.length ? istenen.filter(c => sthSet.has(c.toLowerCase())) : istenen;
    if (!secim.length) return res.status(502).json({ success: false, error: 'STOK_HAREKETLERI şeması okunamadı.' });

    // Satır sırası: sth_satir_no varsa gerçek kalem sırası; yoksa sth_Guid ile
    // en azından DETERMİNİSTİK sırala (sayfa yenilendikçe sıra değişmesin).
    const siralama = sthSet.has('sth_satir_no') ? 'sth.sth_satir_no'
                   : sthSet.has('sth_guid')     ? 'sth.sth_Guid' : 'sth.sth_stok_kod';

    // Ürün adı ayrı tabloda (STOKLAR). Kolon yoksa JOIN'siz devam et — kalemler
    // ürün adı olmadan da gösterilir, sorgunun tamamı ölmesin.
    const stoCols  = await mikroKolonlar('STOKLAR');
    const stoSet   = new Set(stoCols.map(c => c.toLowerCase()));
    const adVar    = stoSet.has('sto_isim') && stoSet.has('sto_kod');

    try {
      const { rows, hata } = await mikroSql(
        `SELECT ${secim.map(c => `sth.${c}`).join(', ')}` +
        (adVar ? ', sto.sto_isim AS urunAdi' : '') + ' ' +
        'FROM STOK_HAREKETLERI sth ' +
        (adVar ? 'LEFT JOIN STOKLAR sto ON sto.sto_kod = sth.sth_stok_kod ' : '') +
        `WHERE sth.sth_evraktip = ${evrakTip} AND sth.sth_evrakno_sira = ${sira} ` +
        `AND ISNULL(sth.sth_evrakno_seri, '') = '${seri}' ` +
        `ORDER BY ${siralama}`,
      );
      if (hata) return res.status(502).json({ success: false, error: hata });
      res.json({ success: true, kalemler: rows, total: rows.length });
    } catch (err) {
      console.error('[fatura/kalemler]', err);
      res.status(500).json({ success: false, error: 'Fatura kalemleri alınamadı.' });
    }
  });

  /** GET /api/mikro/sema-kesif — Mikro şemasını keşfetmek için SABİT sorgular.
   *
   *  Neden var: bu şemayı keşfetmek için sürekli sunucuda PowerShell koşturmak
   *  gerekiyordu ve her seferinde bir şey ters gidiyordu (fonksiyon tanımsız,
   *  cd işlememiş, .env bulunamamış). Aynı bilgiyi uygulamadan almak hem hızlı
   *  hem tekrarlanabilir.
   *
   *  GÜVENLİK: sorgular KODDA SABİT, istemciden hiçbir SQL parçası alınmaz —
   *  enjeksiyon yüzeyi yok. /api/ops/summary ile aynı token korumasında.
   *  Yalnız şema/örnek veri döner; toplu iş verisi dökmez (TOP 3/5).
   */
  app.get('/api/mikro/sema-kesif', async (req: Request, res: Response) => {
    const expected = process.env.OPS_SUMMARY_TOKEN || '';
    if (!expected) return res.status(503).json({ error: 'kapalı — OPS_SUMMARY_TOKEN tanımlı değil' });
    const got = (req.headers['x-ops-token'] as string) || String(req.query.token ?? '');
    const a = Buffer.from(got), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    const sorgular: Array<{ ad: string; sql: string }> = [
      { ad: 'faturaBasliklari',
        sql: 'SELECT TOP 3 cha_evrakno_seri, cha_evrakno_sira, cha_evrak_tip, cha_meblag, cha_tarihi FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 63 ORDER BY cha_tarihi DESC' },
      { ad: 'satirEvrakTipleri',
        sql: 'SELECT sth_evraktip, COUNT(*) AS adet FROM STOK_HAREKETLERI GROUP BY sth_evraktip ORDER BY COUNT(*) DESC' },
      { ad: 'satirOrnegi',
        sql: 'SELECT TOP 5 sth_evrakno_seri, sth_evrakno_sira, sth_evraktip, sth_vergi, sth_tutar, sth_vergi_pntr, sth_stok_kod FROM STOK_HAREKETLERI ORDER BY sth_tarih DESC' },
      { ad: 'depolar',
        sql: 'SELECT dep_no, dep_adi FROM DEPOLAR ORDER BY dep_no' },
      { ad: 'stokDepoKoduDagilimi',
        sql: "SELECT sto_yer_kod, COUNT(*) AS adet FROM STOKLAR GROUP BY sto_yer_kod ORDER BY COUNT(*) DESC" },
      // code-review #7 DOGRULAMA: STOK_HAREKETLERI'nden per-depo stok (aday tek SQL).
      // Bu ciktinin stok-miktar import'unun depoBreakdown'iyla (GenelAmacliMaliyet
      // polling) ESLESMESI halinde, agir per-SKU-per-depo polling yerine tek grup-SQL'e
      // gecilir. Once sema burada dogrulanmadan import DEGISTIRILMEZ (envanter riski).
      { ad: 'sthDepoKolonOrnegi',
        sql: 'SELECT TOP 5 sth_stok_kod, sth_tip, sth_miktar, sth_giris_depo_no, sth_cikis_depo_no, sth_iptal FROM STOK_HAREKETLERI ORDER BY sth_tarih DESC' },
      // 2026-08-11 MUTABAKAT ARTIĞI: 2367 üründen 2365'i tuttu (semantik DOĞRULANDI),
      // 2'si eksik kaldı — YPR-4160 (327 vs 527) ve VITRA-800-2030 (63 vs 95). İkisi de
      // aynı yönde (dağılım < toplam) → stok var ama bir depoya yazılmamış. Hipotez:
      // depo no NULL/0 ya da sth_tip 0/1 dışında. Bu iki sorgu onu ÖLÇER (tahmin değil).
      // SABİT KIYMET + MALİYET MERKEZİ tablo KEŞFİ (2026-08-11).
      // Bu iki modül için hiç import yok; kullanıcı "ileride kullanacağım" dedi.
      // Tablo adlarını TAHMİN ETMEK yerine INFORMATION_SCHEMA'ya sordurulur —
      // yanlış tablo adı "Invalid object name" ile sorguyu öldürür (cha_vergi /
      // cha_ettn arıza sınıfının tablo sürümü). Çıktı gelince import yazılacak.
      { ad: 'sabitKiymetTabloAdaylari',
        sql: "SELECT TABLE_NAME, (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS c " +
             "WHERE c.TABLE_NAME = t.TABLE_NAME) AS kolonSayisi " +
             'FROM INFORMATION_SCHEMA.TABLES t WHERE ' +
             "t.TABLE_NAME LIKE '%DEMIRBAS%' OR t.TABLE_NAME LIKE '%SABIT%' OR " +
             "t.TABLE_NAME LIKE '%AMORTISMAN%' OR t.TABLE_NAME LIKE '%KIYMET%' " +
             'ORDER BY TABLE_NAME' },
      { ad: 'maliyetMerkeziTabloAdaylari',
        sql: "SELECT TABLE_NAME, (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS c " +
             "WHERE c.TABLE_NAME = t.TABLE_NAME) AS kolonSayisi " +
             'FROM INFORMATION_SCHEMA.TABLES t WHERE ' +
             "t.TABLE_NAME LIKE '%MASRAF%' OR t.TABLE_NAME LIKE '%MALIYET%' OR " +
             "t.TABLE_NAME LIKE '%MERKEZ%' OR t.TABLE_NAME LIKE '%PROJE%' " +
             'ORDER BY TABLE_NAME' },
      // FİYAT KAYNAĞI (2026-08-11): 2367 ürünün tamamı ekranda "0 TL" görünüyor.
      // Import iki kaynağı deniyor (satis_fiyatlari[] ve sto_satis_fiyat1..4);
      // bu kurulumda hangisi DOLU, ölçelim — tahminle fiyat yazılmaz.
      { ad: 'fiyatListesiOzet',
        sql: 'SELECT COUNT(*) AS satir, COUNT(DISTINCT sfiyat_stokkod) AS urun, ' +
             'MIN(sfiyat_listesirano) AS minListe, MAX(sfiyat_listesirano) AS maxListe ' +
             'FROM STOK_SATIS_FIYAT_LISTELERI' },
      { ad: 'fiyatListesiOrnek',
        sql: 'SELECT TOP 10 sfiyat_stokkod, sfiyat_listesirano, sfiyat_fiyati ' +
             'FROM STOK_SATIS_FIYAT_LISTELERI WHERE sfiyat_fiyati > 0 ORDER BY sfiyat_stokkod' },
      { ad: 'stokKartiFiyatDolulugu',
        sql: 'SELECT COUNT(*) AS toplamUrun, ' +
             'SUM(CASE WHEN ISNULL(sto_satis_fiyat1,0) > 0 THEN 1 ELSE 0 END) AS fiyat1Dolu, ' +
             'SUM(CASE WHEN ISNULL(sto_satis_fiyat2,0) > 0 THEN 1 ELSE 0 END) AS fiyat2Dolu, ' +
             'SUM(CASE WHEN ISNULL(sto_satis_fiyat3,0) > 0 THEN 1 ELSE 0 END) AS fiyat3Dolu, ' +
             'SUM(CASE WHEN ISNULL(sto_satis_fiyat4,0) > 0 THEN 1 ELSE 0 END) AS fiyat4Dolu ' +
             'FROM STOKLAR' },
      { ad: 'artikDepoNoDagilimi',
        sql: "SELECT sth_tip, ISNULL(CAST(sth_giris_depo_no AS VARCHAR(10)),'NULL') AS giris, " +
             "ISNULL(CAST(sth_cikis_depo_no AS VARCHAR(10)),'NULL') AS cikis, COUNT(*) AS adet, SUM(sth_miktar) AS miktar " +
             "FROM STOK_HAREKETLERI WHERE sth_stok_kod IN ('YPR-4160','VITRA-800-2030') AND ISNULL(sth_iptal,0)=0 " +
             'GROUP BY sth_tip, sth_giris_depo_no, sth_cikis_depo_no ORDER BY sth_tip' },
      { ad: 'artikTipDagilimi',
        sql: 'SELECT sth_stok_kod, sth_tip, COUNT(*) AS adet, SUM(sth_miktar) AS miktar ' +
             "FROM STOK_HAREKETLERI WHERE sth_stok_kod IN ('YPR-4160','VITRA-800-2030') AND ISNULL(sth_iptal,0)=0 " +
             'GROUP BY sth_stok_kod, sth_tip ORDER BY sth_stok_kod, sth_tip' },
      { ad: 'perDepoStokAday',
        sql: 'SELECT TOP 40 sth_stok_kod, depo, SUM(net) AS bakiye FROM (' +
             'SELECT sth_stok_kod, sth_giris_depo_no AS depo, sth_miktar AS net FROM STOK_HAREKETLERI WHERE sth_tip = 0 AND ISNULL(sth_iptal, 0) = 0 ' +
             'UNION ALL ' +
             'SELECT sth_stok_kod, sth_cikis_depo_no AS depo, -sth_miktar AS net FROM STOK_HAREKETLERI WHERE sth_tip = 1 AND ISNULL(sth_iptal, 0) = 0' +
             ') t GROUP BY sth_stok_kod, depo HAVING SUM(net) <> 0 ORDER BY sth_stok_kod' },
      // Gelen (alış) fatura doğrulaması: cha_tip 1 başlığı ile sth_evraktip 3
      // satırı aynı evrak numarasında buluşuyor mu, toplamlar tutuyor mu?
      { ad: 'alisFaturaBasliklari',
        sql: 'SELECT TOP 3 cha_evrakno_seri, cha_evrakno_sira, cha_tip, cha_meblag, cha_tarihi FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 63 AND cha_tip = 1 ORDER BY cha_tarihi DESC' },
      { ad: 'alisSatirOrnegi',
        sql: 'SELECT TOP 5 sth_evrakno_seri, sth_evrakno_sira, sth_evraktip, sth_vergi, sth_tutar, sth_vergi_pntr FROM STOK_HAREKETLERI WHERE sth_evraktip = 3 ORDER BY sth_tarih DESC' },
      // Alış faturası başlığı hangi cha_evrak_tip'te? 63 yalnız satışı tutuyor.
      { ad: 'evrakTipDagilimi',
        sql: 'SELECT cha_evrak_tip, cha_tip, COUNT(*) AS adet, SUM(cha_meblag) AS toplam FROM CARI_HESAP_HAREKETLERI GROUP BY cha_evrak_tip, cha_tip ORDER BY COUNT(*) DESC' },
      // 377/378/380 alış satırlarının başlığı hangi kayıtta? Evrak no ile ara.
      { ad: 'alisEvrakNoBasliklari',
        sql: 'SELECT cha_evrak_tip, cha_tip, cha_evrakno_sira, cha_kod, cha_meblag FROM CARI_HESAP_HAREKETLERI WHERE cha_evrakno_sira IN (377, 378, 380) ORDER BY cha_evrakno_sira' },
      // evrak_tip 0 / tip 1 içindeki 567 kaydın KAÇI gerçekten alış faturası?
      // Gerçek fatura STOK_HAREKETLERI'nde satırı olandır; tahsilat/virman gibi
      // hareketlerin stok satırı OLMAZ. Bu ayrım filtrenin doğruluğunu belirler.
      { ad: 'evrakTip0SatirEslesmesi',
        sql: 'SELECT CASE WHEN sat.sth_evrakno_sira IS NULL THEN 0 ELSE 1 END AS satiriVar, ' +
             'COUNT(*) AS adet, SUM(cha.cha_meblag) AS toplam ' +
             'FROM CARI_HESAP_HAREKETLERI cha ' +
             'LEFT JOIN (SELECT DISTINCT sth_evrakno_seri, sth_evrakno_sira FROM STOK_HAREKETLERI WHERE sth_evraktip = 3) sat ' +
             'ON sat.sth_evrakno_seri = cha.cha_evrakno_seri AND sat.sth_evrakno_sira = cha.cha_evrakno_sira ' +
             'WHERE cha.cha_evrak_tip = 0 AND cha.cha_tip = 1 ' +
             'GROUP BY CASE WHEN sat.sth_evrakno_sira IS NULL THEN 0 ELSE 1 END' },
      // evrak_tip 0 içinde başka ayırt edici alan var mı (cha_cinsi kırılımı)
      { ad: 'evrakTip0CinsDagilimi',
        sql: 'SELECT cha_cinsi, COUNT(*) AS adet, SUM(cha_meblag) AS toplam FROM CARI_HESAP_HAREKETLERI ' +
             'WHERE cha_evrak_tip = 0 AND cha_tip = 1 GROUP BY cha_cinsi ORDER BY COUNT(*) DESC' },
      { ad: 'faturaYonDagilimi',
        sql: 'SELECT cha_tip, COUNT(*) AS adet FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 63 GROUP BY cha_tip' },

      // ── 2026-08-01: TARİH FİLTRESİ OLMAYAN SORGULARIN BEDELİ ───────────────
      // Yukarıdaki kırılımlar TÜM tabloyu tarıyor. Ben bunların çıktısını
      // "2026 cirosu" diye sundum; kullanıcı Mikro'nun kendi 01.01.2026–bugün
      // raporuyla karşılaştırınca tutmadı:
      //   Mikro portal raporu (2026) → GELEN 220 belge 13.907.047 ₺
      //                                GİDEN 188 belge  9.360.355 ₺
      //   Benim (tarihsiz) rakamım   → ALIŞ  269 belge 132.737.531 ₺  ✗ 10 kat
      //                                SATIŞ 320 belge  15.630.595 ₺
      // Giden raporda 2026 evrak sıra aralığı 120→321. Yani 2026'da 202 satış
      // belgesi var; "320" bu DB'deki ÖNCEKİ yılları da kapsıyor. Aynı şey alış
      // tarafında da geçerli, üstüne cha_cinsi=6'nın belge başına ortalaması
      // (493k) portal ortalamasının (63k) 8 katı — filtre de şüpheli.
      //
      // Bu yüzden aşağıdaki sorgular YIL BAZLI. Sonuç portal raporuyla
      // karşılaştırılabilir olmadan hiçbir ciro rakamı sunulmayacak.
      { ad: 'y2026_satisOzet',
        sql: "SELECT COUNT(*) AS adet, SUM(cha_meblag) AS toplam, MIN(cha_evrakno_sira) AS ilkSira, " +
             "MAX(cha_evrakno_sira) AS sonSira FROM CARI_HESAP_HAREKETLERI " +
             "WHERE cha_evrak_tip = 63 AND cha_tarihi >= '20260101' AND cha_tarihi < '20270101'" },
      { ad: 'y2026_alisCinsDagilimi',
        sql: "SELECT cha_cinsi, COUNT(*) AS adet, SUM(cha_meblag) AS toplam FROM CARI_HESAP_HAREKETLERI " +
             "WHERE cha_evrak_tip = 0 AND cha_tip = 1 AND cha_tarihi >= '20260101' AND cha_tarihi < '20270101' " +
             "GROUP BY cha_cinsi ORDER BY COUNT(*) DESC" },
      // cha_cinsi=6 GERÇEKTEN alış faturası mı? Örnek satırlara bakmadan
      // "evet" demeyeceğim — bir önceki sefer tam burada yanıldım. En büyük 5
      // kayda bakılıyor: ortalamayı 8 kat şişiren şey buradaysa görünür.
      { ad: 'y2026_cinsi6EnBuyuk',
        sql: "SELECT TOP 5 cha_evrakno_seri, cha_evrakno_sira, cha_kod, cha_meblag, cha_tarihi, " +
             "cha_ebelge_turu, cha_aciklama " +
             "FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 0 AND cha_tip = 1 AND cha_cinsi = 6 " +
             "AND cha_tarihi >= '20260101' AND cha_tarihi < '20270101' ORDER BY cha_meblag DESC" },
      // Portal raporu YALNIZ e-faturayı kapsar (e-arşiv ve kağıt fatura orada
      // görünmez). Bu yüzden tie-out'un anahtarı cha_ebelge_turu kırılımı:
      // e-fatura satırlarının toplamı 220 belge/13,9M (alış) ve 188/9,36M
      // (satış) ile örtüşmeli; artan kısım e-arşiv+kağıt olarak açıklanmalı.
      { ad: 'y2026_ebelgeTuruDagilimi',
        sql: "SELECT cha_evrak_tip, cha_tip, cha_ebelge_turu, COUNT(*) AS adet, SUM(cha_meblag) AS toplam " +
             "FROM CARI_HESAP_HAREKETLERI " +
             "WHERE cha_tarihi >= '20260101' AND cha_tarihi < '20270101' " +
             "AND (cha_evrak_tip = 63 OR (cha_evrak_tip = 0 AND cha_cinsi = 6)) " +
             "GROUP BY cha_evrak_tip, cha_tip, cha_ebelge_turu ORDER BY COUNT(*) DESC" },
      { ad: 'tabloSatirSayilari',
        sql: "SELECT 'CARI_HESAP_HAREKETLERI' t, COUNT(*) n FROM CARI_HESAP_HAREKETLERI " +
             "UNION ALL SELECT 'STOK_HAREKETLERI', COUNT(*) FROM STOK_HAREKETLERI " +
             "UNION ALL SELECT 'CARI_HESAPLAR', COUNT(*) FROM CARI_HESAPLAR " +
             "UNION ALL SELECT 'STOKLAR', COUNT(*) FROM STOKLAR " +
             "UNION ALL SELECT 'EBELGE_EVRAK_HAREKETLERI', COUNT(*) FROM EBELGE_EVRAK_HAREKETLERI" },
    ];

    const sonuc: Record<string, unknown> = {};
    for (const q of sorgular) {
      const { rows, hata } = await mikroSql(q.sql);
      sonuc[q.ad] = hata ? { hata } : rows;
    }
    res.json({ success: true, sonuc });
  });

  /** GET /api/mikro/ebelge-tani — GelenFaturalarV2'nin HAM yanıtını döndürür.
   *
   *  E-Belge Merkezi'nde "Gelen" çekince "İstenilen aralıktaki kayıtlar
   *  getirilirken hata oluştu" dönüyor — bu Mikro'nun KENDİ hatası, kod hatası
   *  değil. Ham yanıtı görmeden kök neden bilinemez; tahminle parametre
   *  değiştirmek (geçen sefer cha_cinsi'de yanıldığım hata sınıfı) yanlış olur.
   *
   *  Bu uç 3 farklı parametre setiyle metodu dener ve ham data'yı döndürür:
   *  hangisi çalışıyor / Mikro tam olarak ne diyor görülür. sema-kesif ile
   *  aynı token koruması; toplu veri dökmez (Size 5). */
  app.get('/api/mikro/ebelge-tani', async (req: Request, res: Response) => {
    const expected = process.env.OPS_SUMMARY_TOKEN || '';
    if (!expected) return res.status(503).json({ error: 'kapalı — OPS_SUMMARY_TOKEN tanımlı değil' });
    const got = (req.headers['x-ops-token'] as string) || String(req.query.token ?? '');
    const a = Buffer.from(got), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    const yil = new Date().getFullYear();
    const bugun = mikroBugun();
    // Kullanıcı Mikro programından e-faturalara ERİŞEBİLİYOR → GİB bağlantısı var,
    // sorun büyük olasılıkla parametre. Tek denenmemiş: VKNo (firma VKN'si).
    // ?vkn=... ile geç; E/F denemeleri onu kullanır.
    const vkn = String(req.query.vkn ?? '').replace(/\D/g, '').slice(0, 11);
    const denemeler: Array<{ ad: string; p: Record<string, unknown> }> = [
      { ad: 'A_tam_parametre', p: { IlkTarih: `${yil}-07-01`, SonTarih: bugun, GIBFaturaNo: '', VKNo: '', Size: 5, Index: 0 } },
      { ad: 'B_size_index_yok', p: { IlkTarih: `${yil}-07-01`, SonTarih: bugun, GIBFaturaNo: '', VKNo: '' } },
      { ad: 'C_gibfaturano_yok', p: { IlkTarih: `${yil}-07-01`, SonTarih: bugun, VKNo: '', Size: 5, Index: 0 } },
      { ad: 'D_dar_aralik_1gun', p: { IlkTarih: bugun, SonTarih: bugun, GIBFaturaNo: '', VKNo: '', Size: 5, Index: 0 } },
      ...(vkn ? [
        { ad: 'E_vkn_ile', p: { IlkTarih: `${yil}-07-01`, SonTarih: bugun, GIBFaturaNo: '', VKNo: vkn, Size: 5, Index: 0 } },
        { ad: 'F_vkn_dar_aralik', p: { IlkTarih: bugun, SonTarih: bugun, GIBFaturaNo: '', VKNo: vkn, Size: 5, Index: 0 } },
      ] : []),
    ];
    const sonuc: Record<string, unknown> = {};
    for (const d of denemeler) {
      try {
        const { ok, status, data } = await mikroPost('GelenFaturalarV2', d.p);
        sonuc[d.ad] = { ok, status, hata: mikroHata(data), ham: data };
      } catch (e) {
        sonuc[d.ad] = { hata: (e as Error).message };
      }
    }
    res.json({ success: true, sonuc });
  });

  /** POST /api/mikro/tamir/ham-satir-temizle — UI koleksiyonlarına yanlışlıkla
   *  dökülmüş HAM Mikro satırlarını siler.
   *
   *  2026-08-01: banka/kasa import'ları ham Mikro satırlarını doğrudan
   *  `bankAccounts` ve `kasalar`a yazıyordu. O satırlarda `balance`/`bakiye`
   *  yok; ekran `acc.balance.toLocaleString()` dediği için Muhasebe modülü
   *  komple çöküyordu. Import düzeltildi ama CANLIDA yazılmış satırlar duruyor.
   *
   *  Yalnız `source: 'mikro_sql'` damgalı (yani o hatalı import'un yazdığı)
   *  dokümanları siler — elle girilmiş veya düzeltilmiş kayıtlara (source:'mikro')
   *  DOKUNMAZ.
   */
  app.post('/api/mikro/tamir/ham-satir-temizle', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const hedefler = ['bankAccounts', 'kasalar', 'warehouses'];
    const sonuc: Record<string, number> = {};
    try {
      const cid = await reqCompanyId(req);
      for (const coll of hedefler) {
        const snap = await adminDb.collection(coll).get();
        let batch = adminDb.batch(); let ops = 0, silinen = 0;
        for (const d of snap.docs) {
          const x = d.data() as Record<string, unknown>;
          if (x.source !== 'mikro_sql') continue;              // yalnız hatalı import
          if (x.companyId && x.companyId !== cid) continue;    // başka kiracıya dokunma
          batch.delete(d.ref); silinen++;
          if (++ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
        }
        if (ops > 0) await batch.commit();
        sonuc[coll] = silinen;
      }
      const ozet = Object.entries(sonuc).map(([k, v]) => `${k}: ${v}`).join(', ');
      await writeAuditLog(reqActor(req), 'Ham Satır Temizliği', ozet);
      res.json({ success: true, silinen: sonuc, not: `Silinen ham satırlar — ${ozet}. İlgili import'ları yeniden çalıştırın.` });
    } catch (err) {
      console.error('[tamir/ham-satir-temizle]', err);
      res.status(500).json({ success: false, error: 'Temizlik başarısız.' });
    }
  });

  // 4. Bankalar → mikroBankalar (ham) + bankAccounts (temiz)
  //
  // ⚠️ 2026-08-01 DÜZELTMESİ: ham ban_* satırları DOĞRUDAN `bankAccounts`a
  // yazılıyordu. O koleksiyon tipli bir UI koleksiyonu ve ekran
  // `acc.balance.toLocaleString()` diyor — ham satırda `balance` alanı YOK,
  // dolayısıyla Muhasebe modülü komple çöküyordu
  // ("Cannot read properties of undefined (reading 'toLocaleString')").
  // Aynı hatayı DEPOLAR'da fark edip ayırmıştım, banka/kasa'yı atlamışım.
  makeMikroSqlImport({
    route: '/api/mikro/import/banka', tablo: 'BANKALAR', siralama: 'ban_Guid',
    collection: 'mikroBankalar', label: 'Mikro Banka Listesi',
    postProcess: async (rows, companyId) => {
      if (!adminDb) return null;
      const bankaId = await mikroIdCozucu('bankAccounts', companyId);
      // Alan adları çalışma anında bulunur — tahmin yok, bulunamazsa bildirilir.
      const ornek = rows[0];
      const adKey  = findKey(ornek, /ban_(adi|isim|ad)$/i) ?? findKey(ornek, /ban_.*ad/i);
      const noKey  = findKey(ornek, /ban_no$/i) ?? findKey(ornek, /ban_kod/i);
      const hspKey = findKey(ornek, /hesap_?no|iban/i);
      if (!adKey) return `banka adı alanı bulunamadı — bankAccounts'a yazılmadı`;
      let batch = adminDb.batch(); let ops = 0, n = 0;
      for (const r of rows) {
        const guidKey = findKey(r, /_Guid$/i);
        const id = guidKey && r[guidKey] ? String(r[guidKey]) : null;
        if (!id) continue;
        batch.set(adminDb.collection('bankAccounts').doc(bankaId(id)), {
          companyId,
          bankName:      String(r[adKey] ?? '').trim() || `Banka ${noKey ? r[noKey] : ''}`.trim(),
          accountType:   'Vadesiz',
          accountHolder: '',
          currency:      'TRY',
          // Bakiye Mikro'nun banka TANIMINDA yok (hareketlerde). 0 yazmak
          // "bakiye sıfır" demek olur — UI'ın çökmemesi için gerekli asgari,
          // gerçek bakiye banka hareketlerinden gelir.
          balance:       0,
          ...(hspKey && r[hspKey] ? { accountNo: String(r[hspKey]) } : {}),
          source: 'mikro', syncedAt: pgServerTimestamp(),
        }, { merge: true });
        n++;
        if (++ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      return `${n} banka bankAccounts'a yazıldı (${adKey})`;
    },
  });

  // 5. Kasalar → mikroKasalar (ham) + kasalar (temiz) — bkz. banka gerekçesi
  makeMikroSqlImport({
    route: '/api/mikro/import/kasa', tablo: 'KASALAR', siralama: 'kas_Guid',
    collection: 'mikroKasalar', label: 'Mikro Kasa Listesi',
    postProcess: async (rows, companyId) => {
      if (!adminDb) return null;
      const kasaId = await mikroIdCozucu('kasalar', companyId);
      const ornek = rows[0];
      const adKey = findKey(ornek, /kas_(adi|isim|ad)$/i) ?? findKey(ornek, /kas_.*ad/i);
      const noKey = findKey(ornek, /kas_no$/i) ?? findKey(ornek, /kas_kod/i);
      if (!adKey) return `kasa adı alanı bulunamadı — kasalar'a yazılmadı`;
      let batch = adminDb.batch(); let ops = 0, n = 0;
      for (const r of rows) {
        const guidKey = findKey(r, /_Guid$/i);
        const id = guidKey && r[guidKey] ? String(r[guidKey]) : null;
        if (!id) continue;
        batch.set(adminDb.collection('kasalar').doc(kasaId(id)), {
          companyId,
          kasaAdi:  String(r[adKey] ?? '').trim() || `Kasa ${noKey ? r[noKey] : ''}`.trim(),
          currency: 'TRY',
          bakiye:   0,
          source: 'mikro', syncedAt: pgServerTimestamp(),
        }, { merge: true });
        n++;
        if (++ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      return `${n} kasa kasalar'a yazıldı (${adKey})`;
    },
  });

  // 6. Ödeme planları → odemePlanlari (eski: OdemePlanListesiV2, V17'de YOK)
  makeMikroSqlImport({
    route: '/api/mikro/import/odeme-plan', tablo: 'ODEME_PLANLARI', siralama: 'odp_Guid',
    collection: 'odemePlanlari', label: 'Mikro Ödeme Planları',
  });

  // 8. Depolar → mikroDepolar (ham) + warehouses (temiz)
  //
  // Mikro'da DEPOLAR tablosu var ama hiç çekilmiyordu; Depo Tanımları ekranı
  // yalnız elle girilmiş "Depo 1"i gösteriyordu. Müşterinin 5 deposu var:
  // 1 HAVALIMANI · 2 ESKI SANAYI · 3 "34 CGC 119" · 4 "07 AGU 291" · 5 "07 ACR 832"
  // (3-5 araç plakası — QR transfer sistemindeki araçlarla aynı numaralar).
  //
  // Ham satır `mikroDepolar`a, temiz doküman `warehouses`a yazılır: genel
  // importer ham satırı olduğu gibi döküyor ve 80 dep_* alanı tipli bir UI
  // koleksiyonunu kirletirdi.
  makeMikroSqlImport({
    route: '/api/mikro/import/depo', tablo: 'DEPOLAR', siralama: 'dep_Guid',
    collection: 'mikroDepolar', label: 'Mikro Depo Tanımları',
    postProcess: async (rows, companyId) => {
      if (!adminDb) return null;
      const depoId = await mikroIdCozucu('warehouses', companyId);
      let batch = adminDb.batch(); let ops = 0, yazilan = 0;
      for (const r of rows) {
        const depoNo = Number(r.dep_no);
        const ad     = String(r.dep_adi ?? '').trim();
        if (!Number.isFinite(depoNo)) continue;
        // Adres parçalarını yalnız DOLU olanlardan kur — boşları birleştirip
        // ", , TÜRKİYE" gibi anlamsız bir konum üretme.
        const konum = [r.dep_Ilce, r.dep_Il, r.dep_Ulke]
          .map(x => String(x ?? '').trim()).filter(Boolean).join(', ');
        const yetkili = String(r.dep_yetkili_email ?? '').trim();
        // Depo no'yu doc id yap: locationStocks ve QR transfer sistemi depo
        // kodlarını (1-5) kullanıyor, GUID değil — eşleşsinler.
        batch.set(adminDb.collection('warehouses').doc(depoId(`depo-${depoNo}`)), {
          companyId,
          name: ad || `Depo ${depoNo}`,
          depoNo,
          ...(konum   ? { location: konum } : {}),
          ...(yetkili ? { manager: yetkili } : {}),
          source: 'mikro',
          syncedAt: pgServerTimestamp(),
        }, { merge: true });
        yazilan++;
        if (++ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      return `${yazilan} depo tanımı warehouses'a yazıldı`;
    },
  });

  // 7. Barkodlar → barkodlar + envanter ürünlerine barcode alanı yaz
  makeMikroSqlImport({
    route: '/api/mikro/import/barkod', tablo: 'BARKOD_TANIMLARI', siralama: 'bar_Guid',
    collection: 'barkodlar', label: 'Mikro Barkod Listesi',
    postProcess: async (rows, companyId) => {
      if (!adminDb) return null;
      const sample = rows[0];
      const skuKey = findKey(sample, /sto_?kod|stok_?kod/i);
      const barKey = findKey(sample, /bar_?kod(?!u_)|barkod/i);
      if (!skuKey || !barKey) return `eşleme alanları bulunamadı (sku=${skuKey}, barkod=${barKey})`;
      // KİRACI SINIRI (fiyat/BOM import'unda bugün bulunan sınıfın aynısı, burada
      // da vardı): companyId filtresi YOKTU — Tenant A'nın barkod senkronu Tenant
      // B'nin aynı SKU'lu ürününün barcode alanını sessizce ezebilirdi.
      const invSnap = await tenantSnap('inventory', companyId);
      const bySku = new Map<string, PgDocRef>();
      for (const d of invSnap.docs) {
        const veri = d.data() as Record<string, unknown>;
        const dc = (veri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const sku = ((veri.sku as string) || '').trim();
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

  // 8. Satış fiyatları → inventory.prices  (DOĞRU KAYNAK, 2026-08-11)
  //
  // Ürünler ekranda "0 TL" görünüyordu. Hem cron hem manuel stok import'u fiyatı
  // stok KARTINDAN (`sto_satis_fiyat1..4`) okumaya çalışıyordu — ama sema-kesif
  // kanıtladı ki bu kurulumda o kolon HİÇ YOK:
  //     stokKartiFiyatDolulugu -> "Invalid column name 'sto_satis_fiyat1'"
  // Fiyatlar ayrı tabloda ve DOLU:
  //     fiyatListesiOzet -> 2075 satır / 2075 ürün, listesirano 1..1
  // Yani tek fiyat listesi (Retail) var; 2/3/4 kademeleri bu kurulumda tanımsız.
  //
  // Bu import fiyatı asıl kaynağından çeker ve inventory.prices'a işler.
  makeMikroSqlImport({
    route: '/api/mikro/import/fiyat',
    tablo: 'STOK_SATIS_FIYAT_LISTELERI',
    // SIRALAMA TEKİL OLMALI (2026-08-24 denetim bulgusu P6 → doğrulandı).
    //
    // Sayfalama `ORDER BY <siralama> OFFSET n ROWS FETCH NEXT 500` ile yapılıyor.
    // SQL Server'da ORDER BY tekil DEĞİLSE sayfalar arası sıra GARANTİ EDİLMEZ:
    // aynı satır iki sayfada çıkabilir, başka bir satır hiç çıkmayabilir.
    // `sfiyat_stokkod` tekil değil — bu tablonun PK'sı
    // (sfiyat_stokkod, sfiyat_listesirano) ve her SKU'nun 4 fiyat kademesi için
    // 4 satırı var. Bir SKU'nun kademeleri sayfa sınırına denk geldiğinde bazı
    // kademeler MÜKERRER inip bazıları HİÇ İNMİYORDU — yani ürün fiyatı sessizce
    // yanlış/eksik güncelleniyordu. Diğer 11 import zaten _Guid ile sıralıyor;
    // bu tablonun GUID'i (sfiyat_Guid) secimKolonlari'nda var ama sıralamada
    // kullanılmıyordu. Tam PK ile sıralamak tekilliği garanti eder.
    siralama: 'sfiyat_stokkod, sfiyat_listesirano',
    collection: 'mikroFiyatListeleri',
    label: 'Mikro Satış Fiyat Listeleri',
    // Kolon adları çalışma anında şemaya karşı süzülür (olmayan ad import'u öldürmez).
    // Her iki döviz adı adayı da istenir ('sfiyat_doviz' repo'nun geri kalanında
    // kullandığı ad — PG ayna DDL'i, StokKaydetV2 push payload'u; 'sfiyat_doviz_cinsi'
    // yedek — süzgeç olmayanı zaten düşürür).
    secimKolonlari: ['sfiyat_Guid', 'sfiyat_stokkod', 'sfiyat_listesirano', 'sfiyat_fiyati',
                     'sfiyat_doviz', 'sfiyat_doviz_cinsi', 'sfiyat_deposu', 'sfiyat_iskonto1'],
    postProcess: async (rows, companyId) => {
      if (!adminDb) return null;
      // Desenler SABİTLENMİŞ ve en spesifikten başlar. Gevşek /fiyat/i kullanılamaz:
      // 'sfiyat_Guid' ve 'sfiyat_stokkod' de "fiyat" içerir ve yanlış kolon seçilirse
      // Number(...) NaN olur, tüm satırlar elenir ve HİÇ fiyat yazılmadan iş başarılı
      // görünür (2026-08-11'de bu şekilde yakalandı).
      const cols    = Object.keys(rows[0]);
      const skuKey  = kolonSec(cols, [/^sfiyat_stokkod$/i, /stok_?kodu?$/i]);
      const listKey = kolonSec(cols, [/^sfiyat_listesirano$/i, /listesi_?rano$/i]);
      const fiyKey  = kolonSec(cols, [/^sfiyat_fiyati$/i, /_fiyati$/i, /fiyat$/i]);
      // Döviz cinsi: satır TL DIŞINDA bir birimde yazılıysa (0=TL varsayımı;
      // bkz. StokKaydetV2 push payload'u `sfiyat_doviz: 0`) fiyatı okuyup
      // doğrudan TL sanmak ~kur kadar (onlarca kat) yanlış tutar demektir. Kolon
      // çözülemezse hepsi TL sayılır — bu, tahmin değil, dosyanın kendi kabul
      // ettiği en iyi bilgi; sonuç panelde açıkça "UYARI" ile bildirilir.
      const dovKey  = kolonSec(cols, [/^sfiyat_doviz$/i, /^sfiyat_doviz_cinsi$/i, /doviz/i]);
      if (!skuKey || !fiyKey) {
        return `eşleme alanları bulunamadı (sku=${skuKey}, fiyat=${fiyKey}) — kolonlar: ${cols.join(', ')}`;
      }

      // Mikro liste no -> Cetpa kademesi. Liste no yoksa tek liste varsayılır (Retail).
      const TIER: Record<string, string> = { '1': 'Retail', '2': 'B2B Standard', '3': 'B2B Premium', '4': 'Dealer' };
      const bySku = new Map<string, Record<string, number>>();
      let atlananDoviz = 0;
      for (const r of rows) {
        const sku = String(r[skuKey] ?? '').trim();
        const fiyat = Number(r[fiyKey]);
        // 0 ve negatif "fiyat YOK" sayılır — yazılırsa ekranda yine 0 TL görünür
        // ve elle girilmiş fiyatı ezer (bugün kapatılan sessiz-sıfır sınıfı).
        if (!sku || !Number.isFinite(fiyat) || fiyat <= 0) continue;
        const dov = dovKey ? Number(r[dovKey]) : 0;
        if (dovKey && Number.isFinite(dov) && dov !== 0) { atlananDoviz++; continue; }
        const tier = TIER[String(listKey ? r[listKey] ?? '1' : '1')] ?? 'Retail';
        const cur = bySku.get(sku) ?? {};
        // Aynı kademede birden çok satır varsa (depo/döviz kırılımı) İLKİ kalır.
        if (cur[tier] == null) { cur[tier] = fiyat; bySku.set(sku, cur); }
      }

      // KİRACI SINIRI: PG shim'de .get() koleksiyonun TÜM kiracılarını döner
      // (docs tablosunda kiracı kolonu yok, ayrım yalnız data.companyId'de ve
      // aşağıda .where() YOKTU). companyId'si DOLU ve BAŞKA kiracıya ait ürüne
      // DOKUNULMAZ — yoksa A kiracısının Mikro fiyatı B kiracısının elle girdiği
      // fiyatı sessizce ezer (2026-08-11'de yakalandı). companyId'si BOŞ eski
      // kayıtlar bilerek dahil (SKU ile iyileştirme, mevcut stok import deseniyle
      // tutarlı).
      const invSnap = await tenantSnap('inventory', companyId);
      let batch = adminDb.batch(); let ops = 0; let eslesen = 0; let yabanciAtlanan = 0;
      for (const d of invSnap.docs) {
        const veri = d.data() as Record<string, unknown>;
        const dc = (veri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) { yabanciAtlanan++; continue; }
        const sku = ((veri.sku as string) || '').trim();
        const yeni = sku ? bySku.get(sku) : undefined;
        if (!yeni) continue;
        // MERGE: Mikro'dan gelmeyen kademe mevcut değeriyle kalır (elle girilmiş
        // fiyat senkronla silinmemeli).
        const mevcut = (veri.prices as Record<string, number>) || {};
        const birlesik = { ...mevcut, ...yeni };
        batch.update(d.ref, {
          prices: birlesik,
          price: birlesik['Retail'] ?? mevcut['Retail'] ?? 0,
          // Bu import yalnız TL fiyat yazar (döviz satırları atlanır) — kademe
          // ne olursa olsun para birimi işaretini TL'ye SABİTLE. Aksi halde
          // kullanıcının ProductForm'dan seçtiği eski priceCurrency (ör. USD)
          // kalır ve ekran bu TL tutarı tekrar kurla çarpar (~kur katı yanlış).
          priceCurrency: 'TRY',
          mikroFiyatSyncedAt: pgServerTimestamp(),
        });
        eslesen++;
        if (++ops >= 400) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      return `${eslesen} ürünün fiyatı güncellendi (${bySku.size} SKU'da fiyat bulundu)` +
        (atlananDoviz ? ` — ${atlananDoviz} satır TL dışı döviz olduğu için atlandı` : '') +
        (dovKey ? '' : ' — UYARI: döviz kolonu çözülemedi, tüm tutarlar TL varsayıldı') +
        (yabanciAtlanan ? ` — ${yabanciAtlanan} ürün başka kiracıya ait olduğu için atlandı` : '');
    },
  });

  // 9. Sabit kıymetler (demirbaşlar) → sabitKiymetler
  //
  // Tablo adı TAHMİN EDİLMEDİ: sema-kesif `sabitKiymetTabloAdaylari` çıktısında
  // DEMIRBASLAR (135 kolon) ana tablo olarak göründü (yanındaki *_CHOOSE_* Mikro'nun
  // iç lookup görünümleri, DEMIRBAS_GRUPLARI grup tanımı, DEMIRBAS_MALIYIL_TANIMLARI
  // mali yıl/amortisman detayı). Kolon adları da tahmin edilmez — 135 kolon içinden
  // çalışma anında `kolonBul` ile çözülür, çözülemeyen alan yazılmaz ve raporlanır.
  makeMikroSqlImport({
    route: '/api/mikro/import/demirbas',
    tablo: 'DEMIRBASLAR',
    siralama: 'dem_Guid',
    collection: 'mikroDemirbaslar',
    label: 'Mikro Demirbaş Listesi',
    postProcess: async (rows, companyId) => {
      if (!adminDb || !rows.length) return null;
      // 2026-08-11: gerçek önek 'dbs_' DEĞİL 'dem_' çıktı — bu, sema-kesif'in
      // "kod kolonu bulunamadı" güvenli hata yolunun CANLIDA doğrulanmış kanıtı
      // (dbs_ tahmini yanlıştı ama import veri BOZMADI, açık hata verdi).
      // Kesin bilinen: dem_Guid, dem_kod, dem_isim, dem_aciklama, dem_firmano,
      // dem_subeno (canlı hata mesajından). alış tarihi/bedeli/ömür/grup 135
      // kolonun görünmeyen kısmında — adları HÂLÂ bilinmiyor, tahmin edilmez;
      // bulunamazsa alan boş kalır (mikroHam'da ham veri durur, veri kaybolmaz).
      const cols  = Object.keys(rows[0]);
      const kod   = kolonSec(cols, [/^dem_kod$/i, /^dem_kodu$/i, /^dem_demirbas_kodu$/i, /^dem_.*kodu$/i]);
      const ad    = kolonSec(cols, [/^dem_isim$/i, /^dem_adi$/i, /^dem_.*(isim|adi)$/i]);
      const aciklama = kolonSec(cols, [/^dem_aciklama$/i]);
      const tarih = kolonSec(cols, [/^dem_alis_tarihi$/i, /^dem_.*alis_tarihi$/i, /^dem_.*giris_tarihi$/i]);
      const bedel = kolonSec(cols, [/^dem_alis_bedeli$/i, /^dem_.*(alis_bedeli|alis_tutari|alis_fiyati)$/i]);
      const omur  = kolonSec(cols, [/^dem_faydali_omur$/i, /^dem_.*faydali_omur$/i]);
      const grup  = kolonSec(cols, [/^dem_grup_kodu$/i, /^dem_.*grup_kodu$/i]);
      if (!kod) return `demirbaş kodu kolonu bulunamadı — mevcut: ${cols.slice(0, 30).join(', ')}`;
      // ÇAKIŞMA GUARD'I: 135 kolonun 105'i hâlâ görülmedi (yalnız hata mesajından
      // sızan ilk 30'u bilinen). `kod`'un yedek deseni (/^dem_.*kodu$/i) başka bir
      // alanı yakalayabilir. `kod` DOKÜMAN ID'sidir; çakışırsa aynı gruptaki TÜM
      // demirbaşlar AYNI docId'ye düşüp birbirini SESSİZCE ezer — import DURDURULUR.
      if ([ad, aciklama, tarih, bedel, omur, grup].includes(kod)) {
        return `demirbaş kodu kolonu ('${kod}') başka bir alanla çakışıyor — eşleme güvenilmez, veri yazılmadı. Mevcut kolonlar: ${cols.slice(0, 30).join(', ')}`;
      }

      // SabitKiymetModule.tsx sözlük araması yapıyor — fallback YOK:
      //   KATEGORI_CFG[kategori].icon (satır 262), DURUM_CFG[durum].bg (satır 272)
      // `kategori`/`durum` bu iki sabit kümenin DIŞINDA bir değerse (Mikro grup
      // kodu ham metin, örn. "MK-01") ya da hiç yazılmazsa ekran ilk satırda
      // TypeError ile çöker — tam da BOM'da `components` eksikliğinin yarattığı
      // sınıf. Mikro grup kodu bu kümelerden biriyle BİREBİR eşleşmiyor (farklı
      // sözlük), o yüzden UYDURULMAZ: geçerli değilse 'Diğer'/'Aktif'e düşer, ham
      // Mikro değeri ayrı alanda (mikroGrupKodu) saklanır — veri kaybolmaz.
      const KATEGORI_GECERLI = new Set(['Taşıt', 'Makine', 'Bilgisayar', 'Mobilya', 'Bina', 'Diğer']);

      // Mevcut kayıtları bir kez oku: (a) YENİ dokümana zorunlu alanları varsayılanla
      // yaz (ekran çökmesin), (b) VAR OLAN dokümanda kullanıcının elle girdiği
      // durum/amortYontemi/departman gibi alanları EZME.
      const mevcutSnap = await tenantSnap('sabitKiymetler', companyId);
      // Aynı koleksiyonu ikinci kez ÇEKME — yukarıdaki snapshot'ın id'leri yeter.
      const dbsId = mikroIdCozucuIds(mevcutSnap.docs.map(d => d.id), companyId);
      const mevcut = new Map(mevcutSnap.docs.map(d => [d.id, d.data() as Record<string, unknown>]));

      let batch = adminDb.batch(); let ops = 0; let yazilan = 0;
      for (const r of rows) {
        const k = String(r[kod] ?? '').trim();
        if (!k) continue;
        const docId = dbsId(k.replace(/[/\\]/g, '_'));
        const eski = mevcut.get(docId);
        const grupHam = grup ? String(r[grup] ?? '').trim() : '';
        batch.set(adminDb.collection('sabitKiymetler').doc(docId), {
          companyId,
          demirbasNo: k,
          ad:          ad    ? String(r[ad] ?? '').trim() || k : k,
          kategori:    (eski?.kategori as string) || (KATEGORI_GECERLI.has(grupHam) ? grupHam : 'Diğer'),
          mikroGrupKodu: grupHam,             // ham Mikro grup kodu — kategori eşleşmese de kaybolmasın
          alisTarihi:  tarih ? String(r[tarih] ?? '').slice(0, 10) : '',
          alisBedeli:  bedel ? Number(r[bedel]) || 0 : 0,
          faydaliOmur: omur  ? Number(r[omur]) || 0 : 0,
          // UI SÖZLÜK ANAHTARLARI — eksikse ekran çöker (KategoriBadge/DurumBadge
          // fallback'siz). Yeni kayıtta varsayılan; mevcut kayıtta kullanıcı
          // değeri korunur.
          durum:           (eski?.durum as string) ?? 'Aktif',
          amortYontemi:    (eski?.amortYontemi as string) ?? 'Doğrusal',
          paraBirimi:      (eski?.paraBirimi as string) ?? 'TRY',
          birikmisSalinma: Number(eski?.birikmisSalinma) || 0,
          departman:       (eski?.departman as string) ?? '',
          mikroHam: r,                        // eşleme eksikse veri yine de durur
          source: 'mikro_import',
          mikroSyncedAt: pgServerTimestamp(),
        }, { merge: true });
        yazilan++;
        if (++ops >= 400) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      const eksik = [!ad && 'ad', !tarih && 'alisTarihi', !bedel && 'alisBedeli', !omur && 'faydaliOmur', !grup && 'kategori']
        .filter(Boolean).join(', ');
      if (!eksik) return `${yazilan} demirbaş sabitKiymetler'e yazıldı`;

      // ÇIKMAZ SOKAK DEĞİL, KANIT ÜRET: eskiden mesaj yalnız "şu alanlar
      // çözülemedi" diyordu ve DEMIRBASLAR'ın 135 kolonundan hangilerinin
      // aday olduğu hiç görünmüyordu — desenleri düzeltmek için elde kanıt
      // yoktu (2026-08-18). Artık çözülemeyen her alan için, adı o alana
      // benzeyen GERÇEK kolonlar listeleniyor. Kolon adı hâlâ TAHMİN
      // EDİLMİYOR; yalnızca aday isimler gösteriliyor ki desen kanıta
      // dayanarak yazılabilsin.
      const adaylar = (desen: RegExp) => cols.filter(c => desen.test(c)).slice(0, 8);
      const ipucu = [
        !tarih && `alisTarihi adayları: ${adaylar(/tarih|date/i).join(', ') || '(yok)'}`,
        !bedel && `alisBedeli adayları: ${adaylar(/bedel|tutar|fiyat|maliyet|deger/i).join(', ') || '(yok)'}`,
        !omur  && `faydaliOmur adayları: ${adaylar(/omur|sure|yil|amort/i).join(', ') || '(yok)'}`,
        !grup  && `kategori adayları: ${adaylar(/grup|kategori|tip|cins|sinif/i).join(', ') || '(yok)'}`,
        !ad    && `ad adayları: ${adaylar(/isim|ad|aciklama|tanim/i).join(', ') || '(yok)'}`,
      ].filter(Boolean).join(' · ');

      return `${yazilan} demirbaş sabitKiymetler'e yazıldı — kolonu çözülemeyen alanlar: ${eksik}`
        + ` (ham veri mikroHam'da). Toplam ${cols.length} kolon. ${ipucu}`;
    },
  });

  // 10. Maliyet merkezleri → maliyetMerkezleri
  //
  // Mikro'da "maliyet merkezi" karşılığı SORUMLULUK_MERKEZLERI'dir (sema-kesif
  // `maliyetMerkeziTabloAdaylari`: 35 kolon). Aynı listede IS_MERKEZLERI (üretim iş
  // merkezi), MASRAF_HESAPLARI (masraf hesap planı) ve PROJELER de var — onlar farklı
  // kavramlar, bilerek seçilmedi.
  makeMikroSqlImport({
    route: '/api/mikro/import/maliyet-merkezi',
    tablo: 'SORUMLULUK_MERKEZLERI',
    siralama: 'som_Guid',
    collection: 'mikroMaliyetMerkezleri',
    label: 'Mikro Maliyet Merkezleri',
    postProcess: async (rows, companyId) => {
      if (!adminDb || !rows.length) return null;
      const mmId = await mikroIdCozucu('maliyetMerkezleri', companyId);
      const cols = Object.keys(rows[0]);
      const kod  = kolonSec(cols, [/^som_kodu$/i, /^som_kod$/i, /^som_.*kodu$/i, /kodu$/i]);
      const ad   = kolonSec(cols, [/^som_adi$/i, /^som_isim$/i, /^som_.*(isim|adi)$/i, /(isim|adi)$/i]);
      if (!kod) return `maliyet merkezi kodu kolonu bulunamadı — mevcut: ${cols.slice(0, 30).join(', ')}`;
      // ÇAKIŞMA GUARD'I: SORUMLULUK_MERKEZLERI'nin 35 kolonunun GERÇEK adları hiç
      // görülmedi; `kod`/`ad`'ın en geniş yedekleri (/kodu$/i, /(isim|adi)$/i) aynı
      // kolona ya da birbirine yanlışlıkla bağlanabilir. `kod` DOKÜMAN ID'sidir —
      // çakışırsa farklı maliyet merkezleri AYNI docId'ye düşüp birbirini SESSİZCE
      // ezer (demirbaş import'unda kanıtlanan sınıfın aynısı). Çakışırsa DURDURULUR.
      if (kod === ad) {
        return `maliyet merkezi kodu kolonu ('${kod}') ad alanıyla çakışıyor — eşleme güvenilmez, veri yazılmadı. Mevcut kolonlar: ${cols.slice(0, 30).join(', ')}`;
      }

      let batch = adminDb.batch(); let ops = 0; let yazilan = 0;
      for (const r of rows) {
        const k = String(r[kod] ?? '').trim();
        if (!k) continue;
        batch.set(adminDb.collection('maliyetMerkezleri').doc(mmId(k.replace(/[/\\]/g, '_'))), {
          companyId,
          kod: k,
          ad: ad ? String(r[ad] ?? '').trim() || k : k,
          aktif: true,
          mikroHam: r,
          source: 'mikro_import',
          mikroSyncedAt: pgServerTimestamp(),
        }, { merge: true });
        yazilan++;
        if (++ops >= 400) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      return `${yazilan} maliyet merkezi maliyetMerkezleri'ne yazıldı` + (ad ? '' : ' — ad kolonu çözülemedi (ham veri mikroHam\'da)');
    },
  });

  // ── Gece SQL senkronu (MIKRO_CRON_SYNC=true ise) ─────────────────────────
  // Kullanıcı her seferinde Ayarlar > ERP Hub'a girip tek tek düğmeye basmak
  // zorunda kalmasın diye (2026-07-31 talebi). Login tetiklemesi YERİNE cron:
  // login'de çalıştırmak her kullanıcı girişinde tüm veriyi yeniden çeker,
  // birkaç kişi aynı anda girince Mikro'ya kat kat yük biner ve kullanıcı
  // bekler. Mikro tek servis ve eşzamanlı yükte çöktüğü biliniyor.
  //
  // Adımlar SIRAYLA koşar (paralel değil, aynı gerekçe). Bir adım patlarsa
  // durmaz; her adım syncLog'a kendi sonucunu yazar.
  if (process.env.MIKRO_CRON_SYNC === 'true') {
    const sqlSenkronHedefTenant = async (): Promise<string> => {
      if (process.env.MIKRO_CRON_COMPANY_ID) return process.env.MIKRO_CRON_COMPANY_ID;
      if (!adminDb) return '';
      const snap = await adminDb.collection('users').get();
      const cids = new Set(snap.docs.map(d => (d.data().companyId as string) || d.id));
      if (cids.size === 1) return [...cids][0];
      console.error(`Mikro SQL senkron: ${cids.size} tenant var ve MIKRO_CRON_COMPANY_ID tanımsız → atlandı.`);
      return '';
    };

    // 03:20 — gece yedeğinden (03:30) ÖNCE bitsin diye erken.
    cron.schedule('20 3 * * *', async () => {
      const companyId = await sqlSenkronHedefTenant();
      if (!companyId) return;
      if (!(await getMikroCreds())) { console.warn('Mikro SQL senkron: kimlik yok, atlandı.'); return; }
      const actor = { uid: 'system', email: '' };
      // Son 90 gün: tam geçmişi her gece yeniden çekmek gereksiz yük.
      // İlk dolum elle (ERP Hub) yapılır; cron güncellemeyi taze tutar.
      const son = mikroBugun();
      const ilk = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
      console.log(`Mikro SQL senkron başlıyor (${ilk} → ${son}, ${SQL_IMPORT_TANIMLARI.length} adım)`);
      let ok = 0, hata = 0;
      for (const opts of SQL_IMPORT_TANIMLARI) {
        try {
          const r = await mikroSqlImportCalistir(opts, companyId, ilk, son, actor);
          if (r.ok) { ok++; console.log(`  ${opts.label}: ${r.total} kayıt`); }
          else { hata++; console.warn(`  ${opts.label}: ${r.error}`); }
        } catch (e) { hata++; console.warn(`  ${opts.label} istisna:`, e instanceof Error ? e.message : String(e)); }
      }
      console.log(`Mikro SQL senkron bitti: ${ok} başarılı, ${hata} hatalı`);
    });

    // ── Ayda bir TAM senkron (ayın 1'i, 02:00) ────────────────────────────
    // Gecelik koşu son 90 günü tazeliyor; onun dışında kalan eski kayıtlar
    // hiç güncellenmiyordu. Mikro kayıt SİLMEZ, `iptal=1` diye işaretler —
    // yani eski bir faturanın iptal edilmesi 90 günü geçtiyse bize hiç
    // yansımıyordu. Tam senkron bunu kapatır.
    //
    // 02:00: gecelik SQL senkronundan (03:20) ve yedekten (03:30) ÖNCE biter.
    // Ayda bir olduğu için yükü kabul edilebilir.
    cron.schedule('0 2 1 * *', async () => {
      const companyId = await sqlSenkronHedefTenant();
      if (!companyId) return;
      if (!(await getMikroCreds())) { console.warn('Mikro TAM senkron: kimlik yok, atlandı.'); return; }
      const actor = { uid: 'system', email: '' };
      const son = mikroBugun();
      const ilk = '2000-01-01';   // tüm geçmiş
      console.log(`Mikro TAM senkron başlıyor (${ilk} → ${son}, ${SQL_IMPORT_TANIMLARI.length} adım)`);
      let ok = 0, hata = 0;
      for (const opts of SQL_IMPORT_TANIMLARI) {
        try {
          const r = await mikroSqlImportCalistir(opts, companyId, ilk, son, actor);
          if (r.ok) { ok++; console.log(`  ${opts.label}: ${r.total} kayıt${r.truncated ? ' (TAVANA ÇARPTI)' : ''}`); }
          else { hata++; console.warn(`  ${opts.label}: ${r.error}`); }
        } catch (e) { hata++; console.warn(`  ${opts.label} istisna:`, e instanceof Error ? e.message : String(e)); }
      }
      console.log(`Mikro TAM senkron bitti: ${ok} başarılı, ${hata} hatalı`);
    });
  }


  /** POST /api/mikro/import/stok-miktar — stok miktarlarını Mikro'dan çek.
   *  StokListesiV2 miktar DÖNDÜRMEZ; tek kaynak GenelAmacliMaliyetListesiV2
   *  (SKU başına tek çağrı, EldekiMiktar + MaliyetBedeli döner).
   *  1700+ SKU = uzun iş → hemen { started: true } döner, ilerleme
   *  jobs/stokMiktarImport dokümanına canlı yazılır (panel onSnapshot ile izler).
   */
  let stokMiktarJobRunning = false;
  app.post('/api/mikro/import/stok-miktar', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    if (MIKRO_JUMP_SURUM < 17) {
      return res.status(501).json({
        success: false,
        error: 'Stok miktarı/maliyet çekimi GenelAmacliMaliyetListesiV2 gerektirir — bu method yalnız Mikro Jump V17+ kurulumlarında var. ' +
               'Mikro Jump V17 güncellemesi sonrası .env\'e MIKRO_JUMP_SURUM=17 ekleyin.',
        requiresVersion: 17, currentVersion: MIKRO_JUMP_SURUM,
      });
    }
    if (stokMiktarJobRunning) return res.json({ success: true, started: false, alreadyRunning: true });

    const actor = reqActor(req);
    const jobRef = adminDb.collection('jobs').doc('stokMiktarImport');
    stokMiktarJobRunning = true;

    // Arka plan işi — yanıt hemen döner
    (async () => {
      const t0 = Date.now();
      let processed = 0, updated = 0, failed = 0;
      // Per-depo dağılımı otoriter toplamla tutmayan SKU sayısı (bkz. mutabakat kontrolü).
      let depoUyusmazlik = 0;
      /** Dağılımı yazılan ürün sayısı — hareketi olmayan ürün hiç kontrol edilmez. */
      let depoDagilimliUrun = 0;
      /** Dağılımına `__devir` kovası eklenen ürün sayısı (açılış stoğu defterde yok). */
      let depoDevirli = 0;
      const uyusmazlikOrnek: { sku: string; toplam: number; beklenen: number }[] = [];
      try {
        const invSnap = await adminDb!.collection('inventory').where('source', '==', 'mikro_import').get();
        const items = invSnap.docs
          .map(d => ({ ref: d.ref, sku: ((d.data().sku as string) || '').trim() }))
          .filter(x => x.sku);
        const total = items.length;
        // companyId + depo listesi bir kez (döngü içinde tekrar tekrar değil).
        const companyId = await reqCompanyId(req);
        const wiId = await mikroIdCozucu('warehouseItems', companyId);
        // Depo numaraları warehouses'tan (mikro-depo-<n>). Kart sto_yer_kod GÜVENİLMEZ
        // (hepsi HAVALIMANI); gerçek stok yeri per-depo miktarla bulunur.
        const depoSnap = await adminDb!.collection('warehouses').where('companyId', '==', companyId).get();
        const fetchedDepoNos = depoSnap.docs.map(d => d.id).filter(id => id.startsWith('mikro-depo-')).map(id => id.slice('mikro-depo-'.length)).filter(Boolean);
        // AGGREGATE (stockLevel) HİÇBİR ZAMAN eski '1,2,3,4,5' kapsamından dar
        // OLMAMALI — warehouses eksik doluysa toplam stok az sayılırdı (code-review
        // bulgusu). Union: bilinen 1-5 + warehouses'taki ek depolar. Olmayan depo
        // sorgusu 0 döner (zararsız).
        const depoNos = Array.from(new Set([...fetchedDepoNos, '1', '2', '3', '4', '5']));
        
        // code-review #7: per-depo stok miktarını tek bir SQL ile toptan çek (polling engelle)
        // Her SKU için ayrı ayrı GenelAmacliMaliyetListesiV2 çağırmak O(SKU * Depo) maliyetliydi.
        const sqlPerDepo = 'SELECT sth_stok_kod, depo, SUM(net) AS bakiye FROM (' +
             'SELECT sth_stok_kod, sth_giris_depo_no AS depo, sth_miktar AS net FROM STOK_HAREKETLERI WHERE sth_tip = 0 AND ISNULL(sth_iptal, 0) = 0 ' +
             'UNION ALL ' +
             'SELECT sth_stok_kod, sth_cikis_depo_no AS depo, -sth_miktar AS net FROM STOK_HAREKETLERI WHERE sth_tip = 1 AND ISNULL(sth_iptal, 0) = 0' +
             ') t GROUP BY sth_stok_kod, depo HAVING SUM(net) <> 0';
        const { rows: perDepoRows, hata: sqlHata } = await mikroSql(sqlPerDepo);
        const depoMap = new Map<string, Record<string, number>>();
        if (!sqlHata && perDepoRows) {
            for (const row of perDepoRows) {
                const sku = String(row.sth_stok_kod ?? '').trim();
                const depoNo = String(row.depo ?? '');
                const bakiye = Number(row.bakiye ?? 0);
                if (!sku || !depoNo || bakiye === 0) continue;
                if (!depoMap.has(sku)) depoMap.set(sku, {});
                depoMap.get(sku)![depoNo] = bakiye;
            }
        }
        
        await jobRef.set({ running: true, processed: 0, updated: 0, failed: 0, total, startedAt: pgServerTimestamp(), finishedAt: null, error: null });

        const sonTarih = mikroBugun();
        const CONCURRENCY = 8;
        let batch = adminDb!.batch(); let ops = 0;
        const commitBatch = async () => { if (ops > 0) { await batch.commit(); batch = adminDb!.batch(); ops = 0; } };

        for (let i = 0; i < items.length; i += CONCURRENCY) {
          const slice = items.slice(i, i + CONCURRENCY);
          const results = await Promise.all(slice.map(async (it) => {
            const bos = { it, qty: null as number | null, cost: null as number | null, depoQtys: null as Record<string, number> | null,
                          uyusmazlik: null as { sku: string; toplam: number; beklenen: number } | null,
                          devirli: false };
            try {
              // 1) Toplam (tüm depolar) — stockLevel + maliyet. AUTHORITATIVE, değişmez.
              const { ok, data } = await mikroPost('GenelAmacliMaliyetListesiV2', {
                StokKod: it.sku, IlkTarih: '2000-01-01', SonTarih: sonTarih, Depolar: depoNos.join(','),
              });
              const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
              if (!ok || !r0 || r0.IsError) return bos;
              const d = (r0.Data ?? {}) as Record<string, unknown>;
              // Alan hiç yoksa "0 stok" DEĞİL, "yanıt okunamadı" demektir — 0 yazıp
              // başarılı saymak gerçek stoğu siler. Başarısıza düşür.
              if (d.EldekiMiktar == null) return bos;
              const qty = Number(d.EldekiMiktar);
              if (!Number.isFinite(qty)) return bos;
              const totalCost = Number(d.MaliyetBedeli ?? 0);
              const cost = qty > 0 ? totalCost / qty : null;

              // 2) Per-depo: stok GERÇEKTE nerede? code-review #7 ile tek bir SQL'de
              // STOK_HAREKETLERI'nden toplu çekildi (ağır polling yerine O(1) maliyet).
              //
              // MUTABAKAT + DEVİR KOVASI (2026-08-11)
              //
              // Semantik canlı veriyle DOĞRULANDI: hareketi olan ürünlerde dağılımın
              // toplamı otoriter toplama oturuyor. Ama kaynak EKSİK: STOK_HAREKETLERI
              // yalnız FATURA satırlarını taşıyor (1090 satır = 602 satış + 486 alış + 2),
              // açılış/devir stoğu bu tabloda YOK. Devri olan üründe hareket defterinden
              // türetilen dağılım sistematik olarak eksik kalıyor
              // (YPR-4160: 551-224=327 ama Mikro 527 → 200 devir).
              //
              // Ürünü tamamen gizlemek yerine farkı DÜRÜSTÇE ayrı kovada gösteriyoruz:
              // `__devir` = otoriter toplam - hareket defteri toplamı. Böylece dağılım
              // toplamı her zaman gerçek stoğa eşit olur ve kullanıcı stoğun nerede
              // OLMADIĞINI değil, neresinin BİLİNMEDİĞİNİ görür.
              //
              // Ters yön (defter gerçek stoktan FAZLA diyorsa) devirle açıklanamaz —
              // orada hâlâ hiç dağılım yazılmaz ve uyuşmazlık olarak raporlanır.
              let depoQtys: Record<string, number> | null = null;
              let uyusmazlik: { sku: string; toplam: number; beklenen: number } | null = null;
              let devirli = false;
              if (qty > 0) {
                const fromMap = depoMap.get(it.sku);
                if (fromMap && Object.keys(fromMap).length > 0) {
                  const toplam = Object.values(fromMap).reduce((a, b) => a + b, 0);
                  // Tolerans: kesirli miktarlarda kayan nokta + Mikro yuvarlaması.
                  const tolerans = Math.max(0.01, Math.abs(qty) * 0.001);
                  const fark = qty - toplam;
                  if (Math.abs(fark) <= tolerans) {
                    depoQtys = fromMap;                       // birebir tutuyor
                  } else if (fark > 0) {
                    depoQtys = { ...fromMap, __devir: fark }; // eksik kısım = devir
                    devirli = true;
                  } else {
                    uyusmazlik = { sku: it.sku, toplam, beklenen: qty };
                  }
                }
              }

              return { it, qty, cost, depoQtys, uyusmazlik, devirli };
            } catch { return bos; }
          }));

          for (const r of results) {
            processed++;
            if (r.uyusmazlik) {
              depoUyusmazlik++;
              // İlk birkaç örneği sakla — teşhis için (hepsini tutmak gereksiz).
              if (uyusmazlikOrnek.length < 5) uyusmazlikOrnek.push(r.uyusmazlik);
            }
            if (r.devirli) depoDevirli++;
            // Dağılımı OLAN ürün sayısı: "2365 doğrulandı" yanılgısını önler —
            // hareket kaydı olmayan ürün kontrol EDİLMEZ, atlanır (1090 hareket
            // satırı 2367 ürüne yayılıyor, çoğunun hiç hareketi yok).
            if (r.depoQtys) depoDagilimliUrun++;
            if (r.qty === null) { failed++; continue; }
            batch.update(r.it.ref, {
              stockLevel: r.qty,
              ...(r.cost !== null ? { costPrice: Math.round(r.cost * 100) / 100 } : {}),
              mikroSyncedAt: pgServerTimestamp(),
            });
            ops++;
            // Depo sekmesindeki kayıt: TEK birincil depo YOK — stoğu olan HER depo
            // depoBreakdown'da (ekran her depoyu ayrı gösterir). Eski tek-depo atamasını
            // temizle (warehouseId:null) ki bayat HAVALIMANI kaydı kalmasın; depoBreakdown
            // güvenilirse onu yaz, değilse (guard) yalnız temizle.
            batch.set(adminDb!.collection('warehouseItems').doc(wiId(r.it.sku.replace(/[/\\]/g, '_'))), {
              companyId,
              quantity: r.qty,
              warehouseId: null,
              depoBreakdown: r.depoQtys ?? null,
              updatedAt: pgServerTimestamp(),
            }, { merge: true });
            ops++;
            updated++;
            if (ops >= 400) await commitBatch();
          }
          if (processed % 48 === 0 || processed === total) {
            await commitBatch();
            await jobRef.set({ running: true, processed, updated, failed, total }, { merge: true });
          }
        }
        await commitBatch();
        const duration = Date.now() - t0;
        await jobRef.set({
          running: false, processed, updated, failed,
          // Panel bunu gösterir. depoDagilimliUrun ŞART: hareketi olmayan ürün hiç
          // kontrol edilmediği için "uyuşmazlık 0" tek başına "hepsi doğrulandı"
          // ANLAMINA GELMEZ — kapsamı da göstermeliyiz.
          depoUyusmazlik, depoDagilimliUrun, depoDevirli, uyusmazlikOrnek,
          finishedAt: pgServerTimestamp(), durationMs: duration,
        }, { merge: true });
        const depoNot =
          `, ${depoDagilimliUrun} üründe depo dağılımı yazıldı` +
          (depoDevirli > 0 ? ` (${depoDevirli}'inde devir kovası)` : '') +
          (depoUyusmazlik > 0 ? `, ${depoUyusmazlik} üründe toplam tutmadı (dağılım yazılmadı)` : '');
        const miktarOzet = `${updated} ürünün miktarı güncellendi, ${failed} hata${depoNot} (${Math.round(duration / 1000)}sn)`;
        await writeSyncLog('GenelAmacliMaliyetListesiV2', 'inventory', miktarOzet, failed === 0, null, failed ? `${failed} SKU okunamadı` : null, duration, actor);
        await writeAuditLog(actor, 'Mikro Stok Miktarları', miktarOzet);
        console.log(`Stok miktar import bitti: ${updated} güncellendi, ${failed} hata, depo uyuşmazlık ${depoUyusmazlik}, ${duration}ms`);
        if (uyusmazlikOrnek.length) console.warn('Depo dağılımı uyuşmazlık örnekleri:', uyusmazlikOrnek);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await jobRef.set({ running: false, error: msg, finishedAt: pgServerTimestamp() }, { merge: true }).catch(() => {});
        console.error('Stok miktar import hatası:', err);
      } finally {
        stokMiktarJobRunning = false;
      }
    })();

    res.json({ success: true, started: true });
  });

  /** GET /api/mikro/cari-hareket/turler — bu firmanın GERÇEKTEN kullandığı
   *  cari hareket türleri (cha_evrak_tip dağılımı) + her tür için örnek alan
   *  değerleri.
   *
   *  Neden: Mikro'da onlarca evrak tipi var ama her firma birkaçını kullanır.
   *  Dekont ekranına sabit bir tür listesi gömmek tahmin olurdu; bunun yerine
   *  kullanıcının kendi verisinden okuyoruz. Örnek alanlar da dönüyor ki
   *  DekontKaydetV2 gövdesini onların kullandığı kalıba göre dolduralım.
   */
  app.get('/api/mikro/cari-hareket/turler', requireAuth, mikroLimiter, async (_req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    try {
      const { rows, hata } = await mikroSql(
        `SELECT cha_evrak_tip, cha_cinsi, cha_tip, ` +
        `COUNT(*) AS adet, MIN(cha_evrakno_seri) AS ornekSeri, ` +
        `MIN(cha_cari_cins) AS ornekCariCins, MIN(cha_d_cins) AS ornekDovizCins ` +
        `FROM CARI_HESAP_HAREKETLERI ` +
        `GROUP BY cha_evrak_tip, cha_cinsi, cha_tip ` +
        `ORDER BY COUNT(*) DESC`,
      );
      if (hata) return res.status(502).json({ success: false, error: hata });
      res.json({ success: true, turler: rows });
    } catch (err) {
      console.error('[cari-hareket/turler]', err);
      res.status(500).json({ success: false, error: 'Hareket türleri okunamadı.' });
    }
  });

  /** GET /api/mikro/cari-hareket/:cariKod — tek carinin TÜM hesap hareketleri.
   *
   *  Neden: CariEkstrePanel.tsx eskiden onSnapshot(collection(db,'mikroCariHareketler'),
   *  where('cha_kod','==',cariKod)) kullanıyordu — dbClient shim'de where() SUNUCUDA
   *  değil İSTEMCİDE filtreleniyor (src/lib/dbClient.ts onSnapshot: stream.getDocs(coll)
   *  TÜM koleksiyonu döker, applyConstraints tarayıcıda filtreler). mikroCariHareketler
   *  şirket-geneli tüm carilerin tüm hareketlerini tuttuğundan, TEK cari ekstresi
   *  açılırken şirketin TÜM Mikro cari hareket geçmişi tarayıcıya indiriliyordu —
   *  "çok yavaş" şikayetinin sebebi (2026-08-13). Filtre burada, sunucuda, sadece
   *  bu tenant'ın verisi üstünde (loadCompanyDocs zaten companyId'ye göre daralt-
   *  ıyor) yapılıyor; tele yalnız eşleşen satırlar gidiyor. Canlılık (yeni hareket
   *  gelince otomatik güncelleme) kayboluyor — kısa süreli açılan bir detay ekranı
   *  için kabul edilebilir bir ödün, aynı /api/reports/stok-fiyat-karsilastirma/:sku/detay
   *  deseniyle tutarlı.
   */
  app.get('/api/mikro/cari-hareket/:cariKod', requireAuth, requireCollectionAccess('mikroCariHareketler', 'read'), async (req: Request, res: Response) => {
    try {
      const cariKod = String(req.params['cariKod'] || '').trim();
      if (!cariKod) return res.status(400).json({ success: false, error: 'cariKod gerekli.' });
      const cid = await getUserCompanyId((req as Request & { uid?: string }).uid || '');
      const docs = await loadCompanyDocs('mikroCariHareketler', cid);
      const satirlar = docs.filter(d => String(d.cha_kod ?? '').trim() === cariKod);
      res.json({ success: true, cariKod, satirlar, toplam: satirlar.length });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/mikro/cari-hareket/kaydet — cari hareket (dekont) → Mikro
   *  Body: { hareket: Record<string, unknown>, aciklama?: string }
   *
   *  2026-07-30: `CariHareketKaydetV2` çağırıyordu, o metot V17'de YOK.
   *  V17 karşılığı `DekontKaydetV2` — AYNI `cha_*` alanlarını alır, yalnız zarf
   *  farklı: alanlar Mikro objesi İÇİNDE `evraklar[].satirlar[]` altına girer
   *  (mikroPost'un inMikro=true kalıbı). Çağıranın gönderdiği `hareket` nesnesi
   *  olduğu gibi tek satır olarak sarmalanır — alan eşlemesi değişmedi.
   */
  app.post('/api/mikro/cari-hareket/kaydet', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { hareket, aciklama } = req.body as { hareket: Record<string, unknown>; aciklama?: string };
    if (!hareket) return res.status(400).json({ success: false, error: 'hareket alanı zorunlu.' });
    const t0 = Date.now();
    try {
      const { ok, data, status } = await mikroPost('DekontKaydetV2', {
        evraklar: [{
          satirlar: [hareket],
          ...(aciklama ? { evrak_aciklamalari: [{ aciklama }] } : {}),
        }],
      }, true); // inMikro: V17 evrak kalıbı — alanlar Mikro objesi İÇİNDE
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      const success = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const errorMsg = success ? null : ((r0?.ErrorMessage as string) || `HTTP ${status}`);
      await writeSyncLog('DekontKaydetV2', 'payment', String(hareket.cha_kod ?? 'unknown'), success, null, errorMsg, Date.now() - t0, reqActor(req));
      if (success) void mirrorMikroInsert('mikro_cari_hesap_hareketleri', [{ ...hareket, __kaynak: 'hareket_push' }], CHA_COLS);
      res.json({ success, error: errorMsg, data });
    } catch (err) {
      console.error('[cari-hareket/kaydet]', err);
      res.status(500).json({ success: false, error: 'Cari hareket kaydedilemedi.' });
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

  app.post('/api/mikro/evrak/kaydet', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
  app.post('/api/mikro/yevmiye/kaydet', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
        if (ok && r0 && !r0.IsError) {
          syncedIds.push(String(e.id));
          void mirrorMikroInsert('mikro_muhasebe_fisleri', [
            { ...satirBase, fis_hesap_kod: hesapKodu(e.debitHesap),  fis_aciklama1: String(e.aciklama ?? ''), fis_meblag0:  meblag },
            { ...satirBase, fis_hesap_kod: hesapKodu(e.alacakHesap), fis_aciklama1: String(e.aciklama ?? ''), fis_meblag0: -meblag },
          ], FIS_COLS);
        }
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
  app.post('/api/mikro/tahsilat/kaydet', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { tahsilat } = req.body as { tahsilat: Record<string, unknown> };
    if (!tahsilat?.cariKod || !tahsilat?.tutar) {
      return res.status(400).json({ success: false, error: 'cariKod ve tutar zorunlu.' });
    }
    const t0 = Date.now();
    const toTrDate = (iso: string) => { const [y, m, d] = String(iso).split('-'); return `${d}.${m}.${y}`; };
    const tip = tahsilat.tip === 'tediye' ? 'tediye' : 'tahsilat';
    try {
      const tahsilatSatiri = {
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
      };
      const { ok, data, status } = await mikroPost('TahsilatTediyeKaydetV2', {
        evraklar: [{
          evrak_aciklamalari: [{ aciklama: String(tahsilat.aciklama ?? '') }],
          satirlar: [tahsilatSatiri],
        }],
      }, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      const success = ok && !!r0 && !r0.IsError;
      const errorMsg = success ? null : ((r0?.ErrorMessage as string) || `HTTP ${status}`);
      await writeSyncLog('TahsilatTediyeKaydetV2', 'payment', String(tahsilat.cariKod), success, null, errorMsg, Date.now() - t0, reqActor(req));
      if (success) void mirrorMikroInsert('mikro_cari_hesap_hareketleri', [{ ...tahsilatSatiri, __kaynak: 'tahsilat_push' }], CHA_COLS);
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
  app.post('/api/mikro/import/faturalar', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await reqCompanyId(req);
    if (MIKRO_JUMP_SURUM < 17) {
      return res.status(501).json({
        success: false,
        error: 'SqlVeriOkuV2 yalnız Mikro Jump V17+ kurulumlarında mevcut (V16 koleksiyonunda yok). ' +
               'Fatura çekimi için Mikro Jump V17 güncellemesi gerekir; sonrasında .env\'e MIKRO_JUMP_SURUM=17 ekleyin.',
        requiresVersion: 17, currentVersion: MIKRO_JUMP_SURUM,
      });
    }
    const t0 = Date.now();
    try {
      const sql =
        "SELECT TOP 2000 cha_Guid, cha_evrakno_seri, cha_evrakno_sira, cha_tarihi, cha_tip, cha_cinsi, " +
        "cha_kod, cha_aciklama, cha_meblag, cha_aratoplam, cha_ebelge_turu, cha_belge_no, cha_kasa_hizkod, cha_kasa_hizmet " +
        "FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 63 AND cha_iptal = 0 ORDER BY cha_tarihi DESC";
      const { ok, data, status } = await mikroPost('SqlVeriOkuV2', { SQLSorgu: sql });
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) {
        return res.status(502).json({ success: false, error: (r0?.ErrorMessage as string) || `HTTP ${status}` });
      }
      const rows = mikroSatirlar(data);
      void mirrorMikroInsert('mikro_cari_hesap_hareketleri',
        rows.map(r => ({ ...r, __kaynak: 'sql_import' })), CHA_COLS);
      let satis = 0, alis = 0;
      let batch = adminDb.batch(); let ops = 0;
      for (const row of rows) {
        const guid = String(row.cha_Guid ?? '') || adminDb.collection('mikroFaturalar').doc().id;
        const yon = Number(row.cha_tip ?? 0) === 0 ? 'satis' : 'alis';
        yon === 'satis' ? satis++ : alis++;
        batch.set(adminDb.collection('mikroFaturalar').doc(guid), {
          ...row, yon, companyId,
          source: 'mikro_import',
          syncedAt: pgServerTimestamp(),
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

  // ── Mikro e-Fatura / e-Arşiv ─────────────────────────────────────────────────
  // POST /api/mikro/fatura/kaydet  — push order/invoice to Mikro as e-Fatura or e-Arşiv
  // Body: { order: Record<string, unknown>, firebaseId: string }
  //   order must have: mikroCariKod, lineItems[], totalPrice, faturaTipi ('e-fatura'|'e-arsiv'|'ihracat')
  // On success writes back: mikroFaturaNo, ettn, mikroFaturaDate to orders/{firebaseId}
  app.post('/api/mikro/fatura/kaydet', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const parsed = validate(FaturaKaydetSchema, req.body, res);
    if (!parsed) return;
    // P5-3: fatura Mikro'da olustuktan SONRAKI yerel guncelleme hatasi istegi
    // basarisiz yapmaz (yoksa kullanici tekrar dener -> cift e-Fatura).
    let localUpdateFailed = false;
    const { order, firebaseId } = parsed;
    const t0 = Date.now();
    try {
      const lineItems = order.lineItems;

      const rawDate    = order.createdAt ? new Date(order.createdAt as string) : new Date();
      const faturaDate = `${String(rawDate.getDate()).padStart(2,'0')}.${String(rawDate.getMonth()+1).padStart(2,'0')}.${rawDate.getFullYear()}`;
      // faturaTipi: 1=e-Fatura, 2=e-Arşiv, 3=İhracat
      const faturaType = order.faturaTipi === 'e-arsiv' ? 2 : order.faturaTipi === 'ihracat' ? 3 : 1;
      const kdvOran    = Number(order.kdvOran ?? 20);

      // V17 gerçek formatı (MikroAPI.postman_collection_V17.json ile doğrulandı,
      // 2026-06-12): evrak başlığı cha_* (CARI_HESAP_HAREKETLERI), satırlar
      // detay[] içinde sth_* (STOK_HAREKETLERI, sth_evraktip=4). Payload Mikro
      // zarfının İÇİNDE gönderilir (inMikro=true).
      const satirlar = lineItems.map((item: Record<string, unknown>) => {
        const tutar = Number(item.price ?? 0) * Number(item.quantity ?? 1);
        return {
          sth_tarih:           faturaDate,
          sth_tip:             1,
          sth_cins:            0,
          sth_normal_iade:     0,
          sth_evraktip:        4,   // fatura
          sth_evrakno_seri:    'F',
          sth_stok_kod:        (item.sku as string) || '',
          sth_cari_cinsi:      0,
          sth_cari_kodu:       (order.mikroCariKod as string) || '',
          sth_miktar:          Number(item.quantity ?? 1),
          sth_birim_pntr:      1,
          sth_tutar:           tutar,
          sth_vergi:           Math.round(tutar * kdvOran) / 100,
          sth_vergi_pntr:      kdvOran >= 20 ? 4 : kdvOran >= 10 ? 3 : 1,
          sth_vergisiz_fl:     false,
          sth_aciklama:        (item.name as string) || '',
          sth_cari_srm_merkezi: '', sth_stok_srm_merkezi: '',
          sth_subeno:          0,
          sth_giris_depo_no:   1,
          sth_cikis_depo_no:   1,
        };
      });
      const toplamTutar = satirlar.reduce((t, s) => t + s.sth_tutar, 0);
      const evrak = {
        cha_tip:          0,   // satış
        cha_cinsi:        7,   // V17 örnek değeri (toptan satış faturası)
        cha_normal_Iade:  0,
        cha_evrak_tip:    63,  // fatura
        cha_cari_cins:    0,
        // cha_ebelge_turu V17'de eklendi (V16 gövdesinde YOK) — yalnız V17+
        // kurulumlarda gönderilir. Kod eşlemesi ilk gerçek kayıtla doğrulanmalı.
        ...(MIKRO_JUMP_SURUM >= 17
          ? { cha_ebelge_turu: faturaType === 2 ? 8 : faturaType === 3 ? 0 : 1 }
          : {}),
        cha_d_cins:       0,
        cha_d_kur:        1,
        cha_tarihi:       faturaDate,
        cha_evrakno_seri: 'F',
        cha_kod:          (order.mikroCariKod as string) || '',
        cha_projekodu:    '',
        cha_srmrkkodu:    '',
        cha_vade:         0,
        cha_subeno:       0,
        cha_aciklama:     '',
        kdv_istisna_kodu: '',
        detay:            satirlar,
      };

      const { ok, data, status } = await mikroPost('FaturaKaydetV2', { evraklar: [evrak] }, true);
      const duration   = Date.now() - t0;
      const envelope   = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0         = envelope?.[0] as Record<string, unknown> | undefined;
      const success    = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const md         = (r0?.Data ?? r0?.data ?? {}) as Record<string, unknown>;
      const mikroFaturaNo = (md?.faturaNo || md?.FaturaNo || md?.evrakNo || md?.EvrakNo || md?.id || null) as string | null;
      const ettn          = (md?.ettn || md?.Ettn || md?.uuid || null) as string | null;
      const errorMsg   = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await writeSyncLog('FaturaKaydetV2', 'order', firebaseId || 'unknown', success, mikroFaturaNo, errorMsg, duration, reqActor(req));
      if (success) {
        if (pgPool) {
          const client = await pgPool.connect();
          try {
            await client.query('BEGIN');
            await mirrorMikroInsert('mikro_stok_hareketleri',
              (satirlar as unknown as Record<string, unknown>[]).map(s => ({ ...s, __kaynak: 'fatura_push' })), STH_COLS, client);
            await mirrorMikroInsert('mikro_cari_hesap_hareketleri',
              [{ ...evrak, detay: undefined, cha_meblag: toplamTutar, cha_belge_no: mikroFaturaNo, __kaynak: 'fatura_push' }], CHA_COLS, client);
            await client.query('COMMIT');
          } catch (dbErr) {
            await client.query('ROLLBACK');
            console.error('[FaturaKaydetV2] local db transaction failed:', dbErr);
            // Invoice is in Mikro, but local DB mirror failed. We can queue a retry if boss is available.
            if (boss) await boss.send('outbound-webhook', { event: 'fatura_mirror_failed', payload: { mikroFaturaNo } });
          } finally {
            client.release();
          }
        }
        if (adminDb && firebaseId) {
          try {
            await adminDb.collection('orders').doc(firebaseId).set({
              companyId: await reqCompanyId(req),
              mikroFaturaNo,
              ettn,
              hasInvoice:      true,
              mikroFaturaDate: faturaDate,
              mikroSynced:     true,
              mikroSyncedAt:   pgServerTimestamp(),
            }, { merge: true });
          } catch (updErr) {
            // P5-3 KRITIK: fatura Mikro'da ARTIK VAR. Burada hatayi yukari birakip
            // 500 donersek kullanici "başarısız" gorup tekrar dener ve AYNI siparis
            // icin IKINCI bir yasal e-Fatura kesilir. Bu yuzden yerel guncelleme
            // hatasi istegi basarisiz YAPMAZ: loglanir, telafi kuyruguna alinir ve
            // yanitta localUpdateFailed ile bildirilir.
            localUpdateFailed = true;
            console.error('[FaturaKaydetV2] yerel siparis guncellemesi basarisiz (FATURA MIKRO\'DA OLUSTU):', updErr);
            if (boss) {
              await boss.send('outbound-webhook',
                { event: 'fatura_order_update_failed', payload: { firebaseId, mikroFaturaNo, ettn } },
              ).catch(() => {});
            }
          }
        }
      }
      res.json({ success, mikroFaturaNo, ettn, localUpdateFailed, data, duration });
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
  app.post('/api/mikro/irsaliye/kaydet', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const parsed = validate(IrsaliyeKaydetSchema, req.body, res);
    if (!parsed) return;
    const { shipment, firebaseId } = parsed;
    const t0 = Date.now();
    try {
      const rawDate   = shipment.date ? new Date(shipment.date) : new Date();
      const irsDate   = `${String(rawDate.getDate()).padStart(2,'0')}.${String(rawDate.getMonth()+1).padStart(2,'0')}.${rawDate.getFullYear()}`;
      const items = (shipment.items || []) as Record<string, unknown>[];

      // V17 gerçek formatı (MikroAPI.postman_collection_V17.json ile doğrulandı,
      // 2026-06-12): irsaliye satırları sth_* alanlarıdır (STOK_HAREKETLERI,
      // sth_evraktip=1); kargo/araç bilgisi e_irsaliye_detaylari'nda taşınır.
      // Payload Mikro zarfının İÇİNDE gönderilir (inMikro=true).
      const irsSatir = (item: Record<string, unknown> | null) => ({
        sth_tarih:            irsDate,
        sth_tip:              1,
        sth_cins:             0,
        sth_normal_iade:      0,
        sth_evraktip:         1,   // irsaliye
        sth_evrakno_seri:     'I',
        sth_stok_kod:         item ? ((item.sku as string) || '') : '',
        sth_cari_cinsi:       0,
        sth_cari_kodu:        (shipment.mikroCariKod as string) || '',
        sth_miktar:           item ? Number(item.quantity ?? 1) : 1,
        sth_birim_pntr:       1,
        sth_tutar:            item ? Number(item.price ?? 0) * Number(item.quantity ?? 1) : 0,
        sth_vergi_pntr:       4,
        sth_vergi:            0,
        sth_vergisiz_fl:      false,
        sth_iskonto1:         0,
        sth_iskonto2:         0,
        sth_aciklama:         item ? ((item.name as string) || '') : ((shipment.customerName as string) || ''),
        sth_giris_depo_no:    1,
        sth_cikis_depo_no:    1,
        sth_subeno:           0,
        sth_malkbl_sevk_tarihi: irsDate,
      });
      const satirlar = items.length > 0
        ? items.map((item: Record<string, unknown>) => irsSatir(item))
        : [irsSatir(null)];

      const { ok, data, status } = await mikroPost('IrsaliyeKaydetV2', {
        evraklar: [{
          evrak_aciklamalari: [{ aciklama: (shipment.destination as string) || '' }],
          e_irsaliye_detaylari: {
            eir_tasiyici_firma_kodu: (shipment.cargoFirm as string) || '',
            eir_tasiyici_arac_plaka: (shipment.trackingNo as string) || '',
            eir_eirs_olrk_gonderilsin: 0,
          },
          satirlar,
        }],
      }, true);
      const duration      = Date.now() - t0;
      const envelope      = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0            = envelope?.[0] as Record<string, unknown> | undefined;
      const success       = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const md            = (r0?.Data ?? r0?.data ?? {}) as Record<string, unknown>;
      const irsaliyeNo    = (md?.irsaliyeNo || md?.IrsaliyeNo || md?.evrakNo || md?.EvrakNo || md?.id || null) as string | null;
      const irsaliyeEttn  = (md?.ettn || md?.Ettn || md?.uuid || null) as string | null;
      const errorMsg      = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await writeSyncLog('IrsaliyeKaydetV2', 'shipment', firebaseId || 'unknown', success, irsaliyeNo, errorMsg, duration, reqActor(req));
      if (success) void mirrorMikroInsert('mikro_stok_hareketleri',
        (satirlar as unknown as Record<string, unknown>[]).map(s => ({ ...s, __kaynak: 'irsaliye_push' })), STH_COLS);
      if (adminDb && firebaseId && success) {
        await adminDb.collection('shipments').doc(firebaseId).set({
          companyId: await reqCompanyId(req),
          irsaliyeNo,
          irsaliyeEttn,
          mikroSynced:     true,
          mikroSyncedAt:   pgServerTimestamp(),
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
  // POST /api/mikro/pull/bakiye — cari bakiyelerini Mikro'dan çek → cariBalances
  //
  // 2026-07-30'da BAŞTAN YAZILDI. Eski hali `CariHareketListesiV2`yi cari başına
  // bir kez çağırıyordu; o metot Mikro Jump V17'de HİÇ YOK (resmi Postman
  // koleksiyonunda 161 endpoint arasında bulunmuyor — liste yüzeyi yalnız
  // Stok/Cari listesi + SqlVeriOkuV2). Yani her çağrı boşa gidiyor, ardından
  // `Number(md?.bakiye ?? 0)` devreye girip TÜM carilerin bakiyesini 0 yazıyordu.
  // Aynı sessiz-sıfır deseni stok tarafında da vardı (bkz. mikroStokMiktari).
  //
  // Yeni yol: SqlVeriOkuV2 (SELECT-only SQL kapısı) ile TEK sorguda tüm cari
  // bakiyeleri. cha_tip 0 = borç (satış), 1 = alacak — bakiye = borç - alacak.
  // N çağrı yerine 1 çağrı; ayrıca 100'lük limit gereksiz kalıyor.
  
// KALDIRILDI (2026-08-11): /api/mikro/test-personel geçici hata ayıklama ucu.
// `requireAuth` YOKTU ve PERSONEL_TANIMLARI'nı ham dökmeye çalışıyordu — yani TC
// kimlik no, maaş, telefon, e-posta. Bugün 500 veriyordu çünkü import ettiği
// `./src/services/mikroSql` modülü hiç yok; o modül bir gün oluşturulsaydı uç
// anında KİMLİKSİZ bir PII sızıntısına dönüşecekti. Kalıcı karşılığı zaten var:
// POST /api/mikro/pull/personel (requireAuth + requireMfaVerified).

app.post('/api/mikro/pull/bakiye', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    try {
      const { ok, data } = await mikroPost('SqlVeriOkuV2', {
        SQLSorgu:
          'SELECT cha_kod, ' +
          'SUM(CASE WHEN cha_tip = 0 THEN cha_meblag ELSE -cha_meblag END) AS bakiye ' +
          // ISNULL(cha_iptal,0)=0 ZORUNLU (2026-08-22 denetim bulgusu C16):
          // iptal edilmiş cari hareketler de toplama giriyordu — cari bakiyesi
          // iptal edilen her fatura/tahsilat kadar yanlış çıkıyordu. Bu tablonun
          // diğer okumaları (import/cari-hareket ekKosul, evrak_tip 63 listesi)
          // zaten iptali dışlıyor; bu sorgu tek istisnaydı.
          'FROM CARI_HESAP_HAREKETLERI WHERE ISNULL(cha_iptal, 0) = 0 GROUP BY cha_kod',
      });
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) {
        // HİÇBİR ŞEY YAZMA. Sorgu başarısızsa bakiyeleri sıfırlamak, bilgi
        // vermemekten çok daha kötü — tahsilat kararları bu rakama bakıyor.
        const msg = (r0?.ErrorMessage as string) || 'Mikro SqlVeriOkuV2 yanıt vermedi.';
        console.warn('[pull/bakiye] SqlVeriOkuV2 başarısız:', msg);
        return res.status(502).json({
          success: false,
          error: `Bakiye sorgusu çalıştırılamadı: ${msg}. Hiçbir bakiye değiştirilmedi.`,
        });
      }

      const rows = mikroSatirlar(data);
      if (!rows.length) {
        return res.json({ success: true, total: 0, updated: 0, skipped: 0, duration: Date.now() - t0,
                          note: 'Mikro hiç cari hareketi döndürmedi — bakiye yazılmadı.' });
      }

      const bakiyeByKod = new Map<string, number>();
      let unreadable = 0;
      for (const row of rows) {
        const kod = String(row.cha_kod ?? '').trim();
        const raw = row.bakiye;
        if (!kod) continue;
        // Alan okunamıyorsa 0 yazma — atla ve say.
        if (raw == null || !Number.isFinite(Number(raw))) { unreadable++; continue; }
        bakiyeByKod.set(kod, Number(raw));
      }

      const companyId = await reqCompanyId(req);
      const leadsSnap = await adminDb.collection('leads').where('mikroCariKod', '!=', '').get();
      let updated = 0, skipped = 0;
      let batch = adminDb.batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = adminDb!.batch(); ops = 0; } };

      for (const leadDoc of leadsSnap.docs) {
        const cariKod = String((leadDoc.data() as Record<string, unknown>).mikroCariKod ?? '').trim();
        if (!cariKod) { skipped++; continue; }
        // Mikro'da hiç hareketi olmayan cari: SQL'de satırı yok. Bu GERÇEKTEN
        // sıfır bakiyedir (hareket yok = borç yok), tespit edilememiş değil —
        // sorgu başarılı döndüğü için bunu yazmak doğru.
        const bakiye = bakiyeByKod.has(cariKod) ? bakiyeByKod.get(cariKod)! : 0;
        batch.set(adminDb.collection('cariBalances').doc(cariKod), {
          companyId, cariKod, bakiye, updatedAt: pgServerTimestamp(),
        }, { merge: true });
        ops++;
        batch.set(leadDoc.ref, { bakiye }, { merge: true });
        ops++;
        updated++;
        if (ops >= 400) await flush();
      }
      await flush();

      const ozet = `${updated} cari bakiyesi güncellendi (Mikro'dan ${rows.length} satır, ${unreadable} okunamayan)`;
      await writeSyncLog('SQL:CARI_HESAP_HAREKETLERI', 'cariBalances', ozet, true, null, null, Date.now() - t0, reqActor(req));
      await writeAuditLog(reqActor(req), 'Mikro Bakiye Çekme', ozet);
      res.json({ success: true, total: leadsSnap.size, updated, skipped, unreadable,
                 mikroRows: rows.length, duration: Date.now() - t0 });
    } catch (err) {
      console.error('[pull/bakiye]', err);
      res.status(500).json({ success: false, error: 'Bakiye çekimi başarısız. Hiçbir bakiye değiştirilmedi.' });
    }
  });

  // ── Mikro Pull: Cari Adresleri ───────────────────────────────────────────
  // POST /api/mikro/pull/cari-adres
  //
  // Önceden yalnız PUSH vardı (leads.address/city/district → Mikro, bkz.
  // CariKaydetV2 push payload). PULL yoktu — Mikro'da (elle veya push ile)
  // girilmiş adresler Cetpa'ya hiç geri gelmiyordu (2026-08-17 kullanıcı
  // isteği: "müşterilerin adreslerini mikroya kaydediyoruz, otomatik al ve
  // bölgelerine koy" — Satış Bölgesi'nin otomatik atama yapabilmesi için şart).
  //
  // Kolonlar TAHMİN EDİLMİYOR — mikroKolonlar ile şemadan süzülüyor (adr_cadde/
  // adr_ilce/adr_il/adr_ulke/adr_adres_no zaten mikro_cari_hesap_adresleri
  // aynasında doğrulanmış — bkz. CREATE TABLE, ~satır 1092). Bir cari'nin
  // birden çok adresi olabilir (sevk/fatura/vb, adr_adres_no ile ayrılır);
  // en düşük adres no'yu (genelde varsayılan/ilk girilen) alıyoruz.
  //
  // SADECE BOŞ ALANLARI DOLDURUR — elle düzeltilmiş bir city/address varsa
  // ÜZERİNE YAZMAZ (EKLE, YERİNE KOYMA ilkesi; bu alan için "ekleme" = eksik
  // olanı doldurmak).
  app.post('/api/mikro/pull/cari-adres', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    try {
      const cols = await mikroKolonlar('CARI_HESAP_ADRESLERI');
      if (!cols.length) {
        return res.status(502).json({ success: false, error: 'CARI_HESAP_ADRESLERI şeması okunamadı.' });
      }
      const istenen = ['adr_cari_kod', 'adr_adres_no', 'adr_cadde', 'adr_ilce', 'adr_il', 'adr_ulke'];
      const colSet = new Set(cols.map(c => c.toLowerCase()));
      const secim = istenen.filter(c => colSet.has(c.toLowerCase()));
      if (!secim.includes('adr_cari_kod') || secim.length < 2) {
        return res.status(502).json({ success: false, error: 'CARI_HESAP_ADRESLERI beklenen kolonları taşımıyor — hiçbir adres değiştirilmedi.' });
      }

      // ORDER BY şart: adr_adres_no şemada yoksa (aşağıdaki gruplama her satırı
      // eşit "0" görür) ya da iki satır aynı adres no'yu taşıyorsa (Mikro bunu
      // garanti etmiyor), sıralamasız sonuç SQL Server'ın keyfi dönüş sırasına
      // kalır — her çalıştırmada FARKLI adres seçilebilir (code-review bulgusu).
      const siraliMi = secim.includes('adr_adres_no');
      const { rows, hata } = await mikroSql(
        `SELECT ${secim.join(', ')} FROM CARI_HESAP_ADRESLERI` +
        (siraliMi ? ' ORDER BY adr_cari_kod, adr_adres_no' : ''),
      );
      if (hata) {
        return res.status(502).json({ success: false, error: `Adres sorgusu çalıştırılamadı: ${hata}. Hiçbir adres değiştirilmedi.` });
      }

      // cari_kod başına en düşük adr_adres_no'lu satırı tut (ORDER BY ile artık
      // deterministik — eşit no'larda SQL'in döndürdüğü ilk satır tutarlı kalır).
      const byKod = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        const kod = String(row.adr_cari_kod ?? '').trim();
        if (!kod) continue;
        const mevcut = byKod.get(kod);
        const no = Number(row.adr_adres_no ?? 0);
        if (!mevcut || no < Number(mevcut.adr_adres_no ?? 0)) byKod.set(kod, row);
      }

      const companyId = await reqCompanyId(req);
      const leadsSnap = await adminDb.collection('leads').where('mikroCariKod', '!=', '').get();
      let updated = 0, skipped = 0, yabanciAtlanan = 0;
      let batch = adminDb.batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = adminDb!.batch(); ops = 0; } };

      for (const leadDoc of leadsSnap.docs) {
        const veri = leadDoc.data() as Record<string, unknown>;
        const dc = (veri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) { yabanciAtlanan++; continue; }
        const cariKod = String(veri.mikroCariKod ?? '').trim();
        const adres = cariKod ? byKod.get(cariKod) : undefined;
        if (!adres) { skipped++; continue; }

        // Boş sayılan: undefined/null/'' ve YALNIZ BOŞLUKTAN oluşan değer —
        // salt falsy kontrolü ' ' gibi anlamsız-ama-truthy değeri "zaten dolu"
        // sanıp Mikro'dan doldurmayı atlıyordu (code-review bulgusu).
        const bos = (v: unknown) => !v || (typeof v === 'string' && !v.trim());
        const guncelleme: Record<string, unknown> = {};
        if (bos(veri.address) && adres.adr_cadde) guncelleme.address = String(adres.adr_cadde);
        if (bos(veri.city) && adres.adr_il) guncelleme.city = String(adres.adr_il);
        if (bos((veri as { district?: unknown }).district) && adres.adr_ilce) guncelleme.district = String(adres.adr_ilce);
        if (bos((veri as { country?: unknown }).country) && adres.adr_ulke) guncelleme.country = String(adres.adr_ulke);
        if (!Object.keys(guncelleme).length) { skipped++; continue; }
        // Kaynak izi: "en düşük adres no = varsayılan" TAHMİNE dayalı (Mikro'da
        // doğrulanmış bir kural değil) — sahte kesinlik göstermemek için hangi
        // alanların bu sezgisel seçimden geldiği işaretleniyor (bkz. task #31,
        // Satış Bölgesi otomatik ataması bu alanı okuyacak).
        guncelleme.addressSource = 'mikro-heuristic';

        batch.set(leadDoc.ref, guncelleme, { merge: true });
        ops++; updated++;
        if (ops >= 400) await flush();
      }
      await flush();

      const ozet = `${updated} cari adresi dolduruldu (Mikro'dan ${rows.length} adres satırı, ${yabanciAtlanan} yabancı kiracı atlandı)`;
      await writeSyncLog('SQL:CARI_HESAP_ADRESLERI', 'leads', ozet, true, null, null, Date.now() - t0, reqActor(req));
      await writeAuditLog(reqActor(req), 'Mikro Cari Adres Çekme', ozet);
      res.json({ success: true, total: leadsSnap.size, updated, skipped, yabanciAtlanan,
                 mikroRows: rows.length, duration: Date.now() - t0, note: `${updated} dolduruldu, ${skipped} atlandı` });
    } catch (err) {
      console.error('[pull/cari-adres]', err);
      res.status(500).json({ success: false, error: 'Adres çekimi başarısız. Hiçbir adres değiştirilmedi.' });
    }
  });

  // ── Mikro Pull: Mizan (Trial Balance) ───────────────────────────────────────
  // POST /api/mikro/pull/mizan  — aylık mizan → accountingPeriods
  // Body: { period?: 'YYYY-MM' }
  //
  // 2026-07-30'da YENİDEN YAZILDI: eski hali `MizanV2` çağırıyordu, o metot
  // V17'de YOK. Artık SqlVeriOkuV2 ile MUHASEBE_FIS_DETAYLARI üzerinden hesap
  // bazında borç/alacak toplamı alınıyor.
  //
  // Kolon adları TAHMİN EDİLMİYOR: INFORMATION_SCHEMA'dan okunup regex ile
  // eşleştiriliyor (mikroKolonlar/kolonBul). Eşleşme bulunamazsa hangi kolonun
  // bulunamadığını söyleyip 502 döner — sessizce boş/yanlış mizan yazmaz.
  app.post('/api/mikro/pull/mizan', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    try {
      const now    = new Date();
      const period = (req.body?.period as string) || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ success: false, error: 'period YYYY-MM olmalı.' });
      const [yil, ay] = period.split('-').map(Number);
      const ilkTarih  = `${yil}-${String(ay).padStart(2,'0')}-01`;
      const lastDay   = new Date(yil, ay, 0).getDate();
      const sonTarih  = `${yil}-${String(ay).padStart(2,'0')}-${lastDay}`;

      const cols     = await mikroKolonlar('MUHASEBE_FISLERI');
      if (!cols.length) return res.status(502).json({ success: false, error: 'MUHASEBE_FISLERI tablosu okunamadı (SqlVeriOkuV2 izni?).' });
      // Mikro'da ayrı borç/alacak kolonu YOK: fis_meblag0 İŞARETLİ tutulur
      // (borç +, alacak −). MUHASEBE_FISLERI_OZET'teki mfo_Grp0_B_Meblag /
      // mfo_Grp0_A_Meblag ayrımı bu kuralı bağımsız olarak doğruluyor.
      // Grup 0 = genel muhasebe seti (1-6 mali/UFRS/enflasyon alternatifleri).
      const hesapCol  = kolonBul(cols, /hesap_kod/i);
      const meblagCol = kolonBul(cols, /meblag0$/i);
      const tarihCol  = kolonBul(cols, /tarih$/i);
      const iptalCol  = kolonBul(cols, /_iptal$/i);
      if (!hesapCol || !meblagCol) {
        return res.status(502).json({ success: false,
          error: `Mizan kolonları eşleşmedi (hesap=${hesapCol}, meblağ=${meblagCol}). Hiçbir şey yazılmadı.` });
      }
      for (const c of [hesapCol, meblagCol, tarihCol, iptalCol].filter(Boolean)) {
        if (!sqlTanimlayici(c)) return res.status(500).json({ success: false, error: 'Geçersiz kolon adı.' });
      }

      const kosul: string[] = [];
      if (tarihCol) kosul.push(`${tarihCol} BETWEEN '${ilkTarih}' AND '${sonTarih}'`);
      if (iptalCol) kosul.push(`${iptalCol} = 0`);   // iptal edilmiş fişler mizana girmez
      const where = kosul.length ? ` WHERE ${kosul.join(' AND ')}` : '';
      const { rows, hata } = await mikroSql(
        `SELECT ${hesapCol} AS hesapKodu, ` +
        `SUM(CASE WHEN ${meblagCol} > 0 THEN ${meblagCol} ELSE 0 END) AS borc, ` +
        `SUM(CASE WHEN ${meblagCol} < 0 THEN -${meblagCol} ELSE 0 END) AS alacak ` +
        `FROM MUHASEBE_FISLERI${where} GROUP BY ${hesapCol} ORDER BY ${hesapCol}`,
      );
      if (hata) return res.status(502).json({ success: false, error: `Mizan sorgusu başarısız: ${hata}. Hiçbir şey yazılmadı.` });

      const satirlar = rows.map(r => ({
        hesapKodu: String(r.hesapKodu ?? ''),
        borc:   Number(r.borc ?? 0),
        alacak: Number(r.alacak ?? 0),
        bakiye: Number(r.borc ?? 0) - Number(r.alacak ?? 0),
      })).filter(r => r.hesapKodu);

      // Hiç satır yoksa BOŞ MİZAN YAZMA. Bu "dönemde hareket yok" da olabilir,
      // "muhasebe modülü hiç kullanılmıyor / yanlış tablo" da — ikisi arasında
      // ayrım yapamadığımız için var olan mizanı boşla ezmek kabul edilemez.
      if (!satirlar.length) {
        return res.status(502).json({ success: false,
          error: `${period} döneminde MUHASEBE_FISLERI'nde hiç kayıt bulunamadı. ` +
                 `Muhasebe fişleri Mikro'ya işlenmiyor olabilir — mizan DEĞİŞTİRİLMEDİ.` });
      }

      // ÇİFT TARAFLI KAYIT DENETİMİ — mizan tanımı gereği borç toplamı alacak
      // toplamına EŞİT olmalıdır. Tutmuyorsa işaret varsayımım (meblag>0=borç)
      // ya da grup seçimi yanlış demektir; yanlış mizan yazmaktansa dur.
      const toplamBorc   = satirlar.reduce((t, r) => t + r.borc, 0);
      const toplamAlacak = satirlar.reduce((t, r) => t + r.alacak, 0);
      const fark = Math.abs(toplamBorc - toplamAlacak);
      if (satirlar.length && fark > Math.max(1, (toplamBorc + toplamAlacak) * 0.0001)) {
        return res.status(502).json({ success: false,
          error: `Mizan dengesiz: borç ${toplamBorc.toFixed(2)} ≠ alacak ${toplamAlacak.toFixed(2)} (fark ${fark.toFixed(2)}). ` +
                 `Borç/alacak işaret kuralı bu kurulumda farklı olabilir — hiçbir şey yazılmadı.` });
      }

      await adminDb.collection('accountingPeriods').doc(period).set({
        companyId: await reqCompanyId(req),
        period, yil, ay, rows: satirlar,
        toplam: { borc: toplamBorc, alacak: toplamAlacak },
        kaynak: `SQL:MUHASEBE_FISLERI (${hesapCol}/${meblagCol}, işaretli meblağ, denge doğrulandı)`,
        syncedAt: pgServerTimestamp(),
      }, { merge: true });

      const mizanOzet = `${period} dönemi — ${satirlar.length} hesap satırı`;
      await writeSyncLog('SQL:MUHASEBE_FISLERI', 'accountingPeriods', mizanOzet, true, null, null, Date.now() - t0, reqActor(req));
      await writeAuditLog(reqActor(req), 'Mikro Mizan Çekme', mizanOzet);
      res.json({ success: true, period, rowCount: satirlar.length, duration: Date.now() - t0 });
    } catch (err) {
      console.error('[pull/mizan]', err);
      res.status(500).json({ success: false, error: 'Mizan çekimi başarısız. Hiçbir şey yazılmadı.' });
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

  // ── KDV Özet Pull ─────────────────────────────────────────────────────────────
  // POST /api/mikro/pull/kdv  — aylık KDV özeti → taxSummary
  //
  // 2026-07-31'de İKİNCİ KEZ yeniden yazıldı. Önce KdvOzetV2 çağırıyordu (V17'de
  // yok, sıfır yazıyordu), sonra muhasebe hesaplarından (191/391) türetiyordu —
  // ama bu kurulumda MUHASEBE_FISLERI BOŞ (muhasebe Mikro'da tutulmuyor).
  //
  // Doğru kaynak: STOK_HAREKETLERI. Fatura satırları orada ve `sth_vergi` her
  // satırın GERÇEK KDV tutarını taşıyor. Ürün kartındaki orandan hesaplamak
  // YANLIŞ olurdu: gelen faturalarda satır satır farklı oran olabilir
  // (kullanıcı 2026-07-31'de bunu özellikle belirtti).
  //
  // sth_tip: 0 = giriş (alış → indirilecek KDV), 1 = çıkış (satış → hesaplanan).
  // sth_vergisiz_fl = 1 olan satırlar vergiye tabi değil, dışarıda bırakılır.
  //
  // ⚠️ Bu bir TÜRETME'dir. Tevkifat, iade, devreden KDV ve ÖTV/OİV beyannamede
  // ayrıca işlenir — bu özet onları KAPSAMAZ. Beyan öncesi Mikro'nun kendi KDV
  // raporuyla karşılaştırılmalıdır; yanıt ve kayıt bunu açıkça söyler.
  app.post('/api/mikro/pull/kdv', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    try {
      const now    = new Date();
      const period = (req.body?.period as string) || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ success: false, error: 'period YYYY-MM olmalı.' });
      const [yil, ay] = period.split('-').map(Number);
      const ilkTarih  = `${yil}-${String(ay).padStart(2,'0')}-01`;
      const lastDay   = new Date(yil, ay, 0).getDate();
      const sonTarih  = `${yil}-${String(ay).padStart(2,'0')}-${lastDay}`;

      const cols = await mikroKolonlar('STOK_HAREKETLERI');
      if (!cols.length) return res.status(502).json({ success: false, error: 'STOK_HAREKETLERI okunamadı (SqlVeriOkuV2 izni?).' });
      const vergiCol   = kolonBul(cols, /^sth_vergi$/i);
      const pntrCol    = kolonBul(cols, /vergi_pntr/i);
      const tutarCol   = kolonBul(cols, /^sth_tutar$/i);
      const tipCol     = kolonBul(cols, /^sth_tip$/i);
      const tarihCol   = kolonBul(cols, /^sth_tarih$/i);
      const iptalCol   = kolonBul(cols, /_iptal$/i);
      if (!vergiCol || !tipCol || !tarihCol) {
        return res.status(502).json({ success: false,
          error: `KDV kolonları eşleşmedi (vergi=${vergiCol}, tip=${tipCol}, tarih=${tarihCol}). taxSummary'ye dokunulmadı.` });
      }
      for (const c of [vergiCol, pntrCol, tutarCol, tipCol, tarihCol, iptalCol].filter(Boolean)) {
        if (!sqlTanimlayici(c)) return res.status(500).json({ success: false, error: 'Geçersiz kolon adı.' });
      }

      const kosul = [`${tarihCol} BETWEEN '${ilkTarih}' AND '${sonTarih}'`];
      if (iptalCol) kosul.push(`${iptalCol} = 0`);
      const secim = [`${tipCol} AS tip`, `SUM(${vergiCol}) AS kdv`];
      if (tutarCol) secim.push(`SUM(${tutarCol}) AS matrah`);
      const grup = [tipCol];
      if (pntrCol) { secim.unshift(`${pntrCol} AS oranPntr`); grup.push(pntrCol); }

      const { rows, hata } = await mikroSql(
        `SELECT ${secim.join(', ')} FROM STOK_HAREKETLERI WHERE ${kosul.join(' AND ')} ` +
        `GROUP BY ${grup.join(', ')} ORDER BY ${tipCol}`,
      );
      if (hata) return res.status(502).json({ success: false, error: `KDV sorgusu başarısız: ${hata}. taxSummary'ye dokunulmadı.` });

      if (!rows.length) {
        return res.status(502).json({ success: false,
          error: `${period} döneminde STOK_HAREKETLERI'nde kayıt yok — taxSummary DEĞİŞTİRİLMEDİ.` });
      }

      // Satır oranını gerçek yüzdeye çevir (pntr indekstir, yüzde değil).
      const vergiTablosu = await mikroVergiOranlari();
      let kdvHesaplanan = 0, kdvIndirilecek = 0;
      const kirilim: Array<{ yon: string; oran: number | null; kdv: number; matrah: number | null }> = [];
      for (const r of rows) {
        const kdv    = Number(r.kdv ?? 0);
        const matrah = r.matrah === undefined ? null : Number(r.matrah);
        const cikis  = Number(r.tip) === 1;          // 1 = çıkış = satış
        const oran   = pntrCol ? vergiOraniCoz(r.oranPntr, vergiTablosu) : null;
        if (!Number.isFinite(kdv)) continue;
        if (cikis) kdvHesaplanan += kdv; else kdvIndirilecek += kdv;
        kirilim.push({ yon: cikis ? 'satis' : 'alis', oran, kdv, matrah });
      }

      await adminDb.collection('taxSummary').doc(period).set({
        companyId: await reqCompanyId(req),
        period, yil, ay,
        kdvHesaplanan, kdvIndirilecek,
        kdvOdenmesi: Math.max(kdvHesaplanan - kdvIndirilecek, 0),
        devredenKdv: Math.max(kdvIndirilecek - kdvHesaplanan, 0),
        oranKirilimi: kirilim,
        kaynak: `SQL:STOK_HAREKETLERI (${vergiCol}${pntrCol ? '/' + pntrCol : ''}) — TÜRETİLMİŞTİR; tevkifat/iade/devreden KAPSAM DIŞI, beyan öncesi Mikro KDV raporuyla karşılaştırın`,
        syncedAt: pgServerTimestamp(),
      }, { merge: true });

      const kdvOzet = `${period} — hesaplanan ${kdvHesaplanan.toFixed(2)}, indirilecek ${kdvIndirilecek.toFixed(2)} (${kirilim.length} oran kırılımı)`;
      await writeSyncLog('SQL:STOK_HAREKETLERI(KDV)', 'taxSummary', kdvOzet, true, null, null, Date.now() - t0, reqActor(req));
      await writeAuditLog(reqActor(req), 'Mikro KDV Özeti Çekme', kdvOzet);
      const kdvMatrahiSatis = kirilim.filter(k => k.yon === 'satis').reduce((acc, k) => acc + (k.matrah || 0), 0);
      res.json({ success: true, period, kdvHesaplanan, kdvIndirilecek,
                 kdvOdenmesi: Math.max(kdvHesaplanan - kdvIndirilecek, 0),
                 oranKirilimi: kirilim,
                 kdvMatrahi: kdvMatrahiSatis,
                 hesaplananKdv: kdvHesaplanan,
                 uyari: 'Türetilmiş özet — tevkifat/iade/devreden kapsam dışı. Beyan öncesi Mikro KDV raporuyla karşılaştırın.',
                 duration: Date.now() - t0 });
    } catch (err) {
      console.error('[pull/kdv]', err);
      res.status(500).json({ success: false, error: 'KDV özeti çekimi başarısız. taxSummary değişmedi.' });
    }
  });

  // ── Personel ───────────────────────────────────────────────────────────
  app.post('/api/mikro/pull/personel', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    try {
      // Kolon adları TAHMİN EDİLMEZ — şemadan çözülür. Bu SELECT eskiden
      // per_kodu/per_adi/... adlarını sabit yazıyordu; Mikro'da bunlardan biri
      // farklıysa "Invalid column name" ile TÜM sorgu ölürdü (cha_vergi ve
      // cha_ettn ile iki kez yaşanan arıza sınıfı). Bulunamayan alan sessizce
      // atlanır, hangileri çözüldüğü yanıtta bildirilir.
      const perCols = await mikroKolonlar('PERSONEL_TANIMLARI');
      if (!perCols.length) {
        return res.status(502).json({ success: false, error: 'PERSONEL_TANIMLARI okunamadı veya SqlVeriOkuV2 izni yok.' });
      }
      const perAlan: Array<[string, RegExp]> = [
        ['mikroPersKod', /^per_(kodu|kod)$/i],
        ['name',         /^per_(adi|ad)$/i],
        ['surname',      /^per_soyadi$/i],
        ['email',        /^per_(eposta|email|mail)$/i],
        ['phone',        /^per_(ceptel|tel|telefon)$/i],
        ['department',   /^per_departman/i],
        ['position',     /^per_(gorevi|gorev|unvan)$/i],
        ['salary',       /^per_(maas|ucret)$/i],
        ['startDate',    /^per_isegiris/i],
        ['status',       /^per_(durumu|durum|aktif)$/i],
        ['tcId',         /^per_tc/i],
      ];
      const perSecim: string[] = [];
      const cozulen: string[] = [];
      const eksik: string[] = [];
      for (const [alias, re] of perAlan) {
        const k = kolonBul(perCols, re);
        if (k) { perSecim.push(`${k} AS ${alias}`); cozulen.push(alias); }
        else eksik.push(alias);
      }
      if (!cozulen.includes('mikroPersKod')) {
        return res.status(502).json({
          success: false,
          error: `PERSONEL_TANIMLARI'nda personel kodu kolonu bulunamadi. Mevcut kolonlar: ${perCols.slice(0, 25).join(', ')}`,
        });
      }
      const perSql = `SELECT ${perSecim.join(', ')} FROM PERSONEL_TANIMLARI`;
      // mikroSql `{ rows, hata }` döner — DİZİ DEĞİL. Eskiden dönen nesne olduğu
      // gibi `data`ya konuyordu (istemci dizi bekler) ve `hata` HİÇ kontrol
      // edilmiyordu: SQL patlasa bile `success: true` dönüyordu. Bugün kapatılan
      // sessiz-sıfır arıza sınıfının aynısı (kardeş uç pull/uretim-receteleri
      // bunu doğru yapıyordu — iki uç ayrışmıştı).
      const { rows, hata } = await mikroSql(perSql);
      if (hata) return res.status(502).json({ success: false, error: hata });

      // Veriyi KOLEKSİYONA YAZ. Eskiden yalnız istemciye döndürülüyordu ve hiçbir
      // istemci bu ucu çağırmıyordu — yani uç ölü koddu, İK ekranı (`employees`)
      // hep boş kalıyordu. doc id `mikro-<per_kodu>`: tekrar çekimde çoğaltmaz.
      if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
      const companyId = await reqCompanyId(req);
      // HRModule.tsx arama filtresi `e.position.toLowerCase()` / `e.department.toLowerCase()`
      // çağırıyor (fallback yok) — YENİ bir personel Mikro'da bu alanları boş
      // bırakmışsa alan hiç yazılmaz (yukarıdaki guard), doküman `undefined` ile
      // oluşur ve arama kutusuna yazılınca TypeError ile çöker (BOM'daki
      // `components` çökmesiyle aynı sınıf). Yalnız YENİ kayıtta '' varsayılanı
      // yaz; var olan kayda dokunma (mevcut değeri ezmeyelim).
      const mevcutEmpSnap = await tenantSnap('employees', companyId);
      // Aynı koleksiyonu ikinci kez ÇEKME — yukarıdaki snapshot'ın id'leri yeter.
      const empId = mikroIdCozucuIds(mevcutEmpSnap.docs.map(d => d.id), companyId);
      const mevcutEmpIds = new Set(mevcutEmpSnap.docs.map(d => d.id));
      let batch = adminDb.batch(); let ops = 0; let yazilan = 0;
      for (const r of rows) {
        const kod = String(r.mikroPersKod ?? '').trim();
        if (!kod) continue;
        const ad   = String(r.name ?? '').trim();
        const soy  = String(r.surname ?? '').trim();
        // Mikro durum kodu bilinmiyorsa 'Aktif' UYDURMA yerine gelen değeri
        // koru; yalnız kesin bilinen eşleşme çevrilir.
        const durum = String(r.status ?? '').trim();
        // SATIR BAZLI BOŞALTMA guard'ı: eskiden email/phone/department/... KOŞULSUZ
        // yazılıyordu. Kolon şemada bulunsa bile o PERSONELİN Mikro kaydında alan
        // boşsa (çok normal — herkes e-posta/departman girmemiş olabilir),
        // `String(undefined ?? '').trim()` boş string üretip HR'ın Cetpa'da elle
        // girdiği değeri her senkronda sessizce siliyordu. Artık Mikro'da değer
        // VARSA yazılır, yoksa alana hiç dokunulmaz (merge:true mevcut değeri korur).
        const email = String(r.email ?? '').trim();
        const phone = String(r.phone ?? '').trim();
        const dept  = String(r.department ?? '').trim();
        const pos   = String(r.position ?? '').trim();
        const sal   = Number(r.salary);
        const start = String(r.startDate ?? '').trim();
        const docId = empId(kod.replace(/[/\\]/g, '_'));
        const yeniKayit = !mevcutEmpIds.has(docId);
        batch.set(adminDb.collection('employees').doc(docId), {
          companyId,
          mikroPersKod: kod,
          name: [ad, soy].filter(Boolean).join(' ') || kod,
          tcId: String(r.tcId ?? '').trim() || null,
          ...(email ? { email } : (yeniKayit ? { email: '' } : {})),
          ...(phone ? { phone } : (yeniKayit ? { phone: '' } : {})),
          ...(dept  ? { department: dept } : (yeniKayit ? { department: '' } : {})),
          ...(pos   ? { position: pos } : (yeniKayit ? { position: '' } : {})),
          ...(Number.isFinite(sal) && sal > 0 ? { salary: sal } : (yeniKayit ? { salary: 0 } : {})),
          ...(start ? { startDate: start.slice(0, 10) } : (yeniKayit ? { startDate: '' } : {})),
          status:     durum === '0' || durum.toLowerCase() === 'aktif' ? 'Aktif' : durum || 'Aktif',
          source: 'mikro_import',
          mikroSyncedAt: pgServerTimestamp(),
        }, { merge: true });
        yazilan++;
        if (++ops >= 400) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();

      const ozet = `${yazilan} personel employees koleksiyonuna yazıldı` +
        (eksik.length ? ` — şemada bulunamayan alanlar atlandı: ${eksik.join(', ')}` : '');
      await writeSyncLog('SQL:PERSONEL_TANIMLARI', 'employees', ozet, true, null, null, 0, reqActor(req));
      await writeAuditLog(reqActor(req), 'Mikro Personel', ozet);
      res.json({ success: true, total: rows.length, note: ozet, written: yazilan, cozulenAlanlar: cozulen, eksikAlanlar: eksik });
    } catch (err) {
      console.error('[pull/personel]', err);
      res.status(500).json({ success: false, error: 'Personel çekimi başarısız.' });
    }
  });

  // ── Uretim Receteleri (BOM) ────────────────────────────────────────────────
  app.post('/api/mikro/pull/uretim-receteleri', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    
    try {
      const cols = await mikroKolonlar('STOK_URETIM_RECETELERI');
      if (!cols.length) {
        return res.status(502).json({ success: false, error: 'STOK_URETIM_RECETELERI tablosu okunamadı veya SqlVeriOkuV2 izni yok.' });
      }

      // We select all BOM definitions.
      const sql = 'SELECT * FROM STOK_URETIM_RECETELERI ORDER BY rec_create_date DESC OFFSET 0 ROWS FETCH NEXT 5000 ROWS ONLY';
      const { rows, hata } = await mikroSql(sql);
      if (hata) return res.status(502).json({ success: false, error: hata });

      // Veriyi KOLEKSİYONA YAZ. Eskiden yalnız istemciye döndürülüyordu ve hiçbir
      // istemci bu ucu çağırmıyordu → uç ölü koddu, Üretim/BOM ekranı (`bom`)
      // hep boş kalıyordu.
      //
      // rec_* kolon adları TAHMİN EDİLMEZ, şemadan (cols) çözülür. Çözülemeyen
      // alan yazılmaz; ham satır `mikroHam` altında saklanır ki veri kaybolmasın
      // ve eşleme sonradan kolon adı öğrenilince düzeltilebilsin.
      if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
      // Desenler AYRIŞIK olmalı: eski hâlde /^rec_(ana_)?stok_kod$/ ve
      // /^rec_(alt_)?stok_kod$/ İKİSİ de 'rec_stok_kod'u eşliyordu. Tabloda o kolon
      // varsa ana ve alt AYNI kolona bağlanır ve her reçete "X, X içerir" olur —
      // sessizce çöp veri. Artık ayrı desenler + eşitlik guard'ı.
      let anaKod  = kolonSec(cols, [/^rec_ana_stok_kod$/i, /^rec_ust_stok_kod$/i, /ana_stok_kod$/i]);
      let altKod  = kolonSec(cols, [/^rec_alt_stok_kod$/i, /^rec_bilesen_stok_kod$/i, /(alt|bilesen)_stok_kod$/i]);
      const miktarK = kolonSec(cols, [/^rec_miktar$/i, /_miktari?$/i, /miktar$/i]);
      const birimK  = kolonSec(cols, [/^rec_birim$/i, /_birimi?$/i, /birim$/i]);
      // Aynı kolona düştülerse eşleme GÜVENİLMEZ — ikisini de çöz(e)medik say.
      // Yanlış reçete göstermektense hiç gösterme (ham veri mikroHam'da durur).
      if (anaKod && anaKod === altKod) { anaKod = null; altKod = null; }
      const guidK   = kolonBul(cols, /_Guid$/i);

      // ŞEKİL DÜZELTME (2026-08-11, ilk sürüm hiç canlıda çalıştırılmadan yakalandı):
      // `bom` koleksiyonunun tek tüketicisi BOMPanel.tsx TEK doküman/ürün + içinde
      // `components: BOMComponent[]` dizisi bekliyor (satır 39-47). İlk sürüm her
      // (ana, bileşen) satırını AYRI düz doküman yazıyordu — `components` hiç
      // yoktu. BOMPanel `bom.components.length` okuyunca (satır 304) undefined
      // üzerinde patlardı: ekranı doldurmak için yazılan uç, ekranı çökertiyordu.
      //
      // Doğru şekil: Mikro satırları ÖNCE ana ürüne göre grupla, sonra ürün başına
      // TEK doküman yaz. docId artık guid değil `mikro-<productSku>` — guid
      // satır bazlıydı (rastgele üretimi tetikliyordu, her senkron reçeteyi
      // çoğaltırdı); productSku ürün bazlı ve KARARLI, tekrar senkron ÜZERİNE yazar.
      const gruplar = new Map<string, Array<{ sku: string; quantity: number; unit: string }>>();
      for (const r of rows) {
        const ana = anaKod ? String(r[anaKod] ?? '').trim() : '';
        const alt = altKod ? String(r[altKod] ?? '').trim() : '';
        if (!ana || !alt) continue;   // eşleme çözülemediyse reçete satırı anlamsız
        const liste = gruplar.get(ana) ?? [];
        liste.push({
          sku: alt,
          quantity: miktarK ? Number(r[miktarK]) || 0 : 0,
          unit: birimK ? String(r[birimK] ?? '').trim() : '',
        });
        gruplar.set(ana, liste);
      }

      // Bileşen adı/inventoryId için envanterden eşle (BOMComponent.name/inventoryId
      // BOMPanel'in UI'da göstermesi için ZORUNLU değil ama boşsa "—" görünür).
      // Kiracı sınırı: fiyat import'unda yakalanan sızıntının aynısı — companyId'si
      // DOLU ve BAŞKA kiracıya ait kayıt eşlemede kullanılmaz.
      const companyId = await reqCompanyId(req);
      const bomId = await mikroIdCozucu('bom', companyId);
      const invSnap = await tenantSnap('inventory', companyId);
      const invBySku = new Map<string, { id: string; name: string }>();
      for (const d of invSnap.docs) {
        const veri = d.data() as Record<string, unknown>;
        const dc = (veri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const sku = ((veri.sku as string) || '').trim();
        if (sku && !invBySku.has(sku)) invBySku.set(sku, { id: d.id, name: (veri.name as string) || sku });
      }

      let batch = adminDb.batch(); let ops = 0; let yazilan = 0;
      for (const [productSku, bilesenler] of gruplar) {
        const urun = invBySku.get(productSku);
        batch.set(adminDb.collection('bom').doc(bomId(productSku.replace(/[/\\]/g, '_'))), {
          companyId,
          productName: urun?.name || productSku,
          productSku,
          unit: '',
          description: '',
          components: bilesenler.map(b => ({
            inventoryId: invBySku.get(b.sku)?.id || '',
            name: invBySku.get(b.sku)?.name || b.sku,
            sku: b.sku,
            quantity: b.quantity,
            unit: b.unit,
          })),
          source: 'mikro_import',
          mikroSyncedAt: pgServerTimestamp(),
        }, { merge: true });
        yazilan++;
        if (++ops >= 400) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      void guidK; // artık satır bazlı guid kullanılmıyor — ürün bazlı sku id yeterli

      const cozulemeyen = [
        !anaKod  ? 'productSku'   : null,
        !altKod  ? 'componentSku' : null,
        !miktarK ? 'quantity'     : null,
        !birimK  ? 'unit'         : null,
      ].filter(Boolean);
      const ozet = `${yazilan} ürün reçetesi (${rows.length} satırdan) bom koleksiyonuna yazıldı` +
        (cozulemeyen.length ? ` — kolonu çözülemeyen alanlar: ${cozulemeyen.join(', ')} (ham veri satır düzeyinde kaybolmuş olabilir)` : '');
      await writeSyncLog('SQL:STOK_URETIM_RECETELERI', 'bom', ozet, true, null, null, 0, reqActor(req));
      await writeAuditLog(reqActor(req), 'Mikro Üretim Reçeteleri', ozet);
      res.json({ success: true, total: rows.length, note: ozet, written: yazilan, cozulemeyenAlanlar: cozulemeyen });
    } catch (err) {
      console.error('[pull/uretim-receteleri]', err);
      res.status(500).json({ success: false, error: 'Reçete çekimi başarısız.' });
    }
  });

  // ── e-Belge Merkezi: listeleme / durum / mükellef / PDF ─────────────────────
  //
  // 2026-07-30'da eklendi. Buraya kadar EBelgeMerkezi ekranı TAMAMEN ELLE
  // giriliyordu (belge no/alıcı/tutar kullanıcı yazıyordu, "gönder" yalnız
  // yerel bir alanı 'Gönderildi' yapıyordu) — Mikro/GİB ile hiç konuşmuyordu.
  //
  // V17'de yön başına farklı yol var:
  //   GELEN e-fatura  → GelenFaturalarV2 (GİB listesi, resmi metot)
  //   GİDEN e-fatura/e-arşiv → liste metodu YOK, SqlVeriOkuV2 ile
  //                            EBELGE_EVRAK_HAREKETLERI tablosundan
  //   e-irsaliye (iki yön) → EIrsaliyeListesiV2
  // Hepsi `eBelgeler` koleksiyonuna yazılır; `yon` ve `tur` alanlarıyla ayrışır.

  /** Mikro'dan gelen e-belge satırını `eBelgeler` şemasına indirger.
   *  Alan adları sürüme göre değiştiği için regex ile aranır; bulunamayan alan
   *  BOŞ bırakılır, uydurulmaz. */
  function eBelgeNormalize(
    row: Record<string, unknown>,
    tur: 'e-fatura' | 'e-arsiv' | 'e-irsaliye',
    yon: 'gelen' | 'giden',
  ): Record<string, unknown> {
    const al = (re: RegExp): unknown => {
      const k = Object.keys(row).find(x => re.test(x));
      return k ? row[k] : undefined;
    };
    const tutar = Number(al(/tutar|meblag|toplam/i) ?? 0);
    return {
      belgeNo:   String(al(/fatura_?no|belge_?no|gib_?no|evrak_?no|ettn/i) ?? ''),
      uuid:      String(al(/uuid|ettn/i) ?? ''),
      alici:     String(al(/unvan|alici|gonderen|cari_?isim/i) ?? ''),
      vergiNo:   String(al(/vkn|tckn|vergi/i) ?? ''),
      tutar:     Number.isFinite(tutar) ? tutar : 0,
      belgeDate: String(al(/tarih|date/i) ?? '').slice(0, 10),
      tur, yon,
      durum:     String(al(/durum|statu|status/i) ?? 'Bekliyor'),
      kaynak:    'mikro',
      raw:       row,
    };
  }

  /** Normalize edilmiş belgeleri eBelgeler'e yaz. UUID varsa doc id olur
   *  (idempotent — aynı belge tekrar çekilince kopyalanmaz). */
  async function eBelgeYaz(
    kayitlar: Record<string, unknown>[], companyId: string,
  ): Promise<number> {
    if (!adminDb || !kayitlar.length) return 0;
    let batch = adminDb.batch(); let ops = 0, n = 0;
    for (const k of kayitlar) {
      const uuid = String(k.uuid || '').trim();
      const belgeNo = String(k.belgeNo || '').trim();
      // UUID (GİB ETTN) küresel benzersizdir, doğrudan id olabilir. belgeNo
      // DEĞİLDİR ("EF-2026-0001" her firmada olabilir) — docs tablosunun PK'sı
      // (coll,id) olduğu için kiracı öneki olmadan iki firma birbirinin
      // belgesini ezer. Bu, recurringBilling'de bir kez yaşandı.
      const id = uuid || (belgeNo ? `${companyId}__${k.yon}-${belgeNo}` : adminDb.collection('eBelgeler').doc().id);
      batch.set(adminDb.collection('eBelgeler').doc(id.replace(/[/\\]/g, '_')), {
        ...k, companyId, syncedAt: pgServerTimestamp(),
      }, { merge: true });
      n++;
      if (++ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
    }
    if (ops > 0) await batch.commit();
    return n;
  }

  /** POST /api/mikro/ebelge/gelen — GİB'den gelen e-faturaları listele → eBelgeler
   *  Body: { ilkTarih?: 'YYYY-MM-DD', sonTarih?: 'YYYY-MM-DD', vkn?: string } */
  app.post('/api/mikro/ebelge/gelen', requireAuth, mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    const ilk = sqlTarih(req.body?.ilkTarih, `${new Date().getFullYear()}-01-01`);
    const son = sqlTarih(req.body?.sonTarih, mikroBugun());
    const vkn = String(req.body?.vkn ?? '').replace(/\D/g, '').slice(0, 11);
    try {
      const SAYFA = 100;
      const tumu: Record<string, unknown>[] = [];
      for (let index = 0; index < 50; index++) {
        const { ok, data } = await mikroPost('GelenFaturalarV2', {
          IlkTarih: ilk, SonTarih: son, GIBFaturaNo: '', VKNo: vkn,
          Size: SAYFA, Index: index,
        });
        const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
        if (!ok || !r0 || r0.IsError) {
          // Hiçbir şey yazma — yarım liste "tam liste" gibi görünmesin.
          return res.status(502).json({ success: false, error: `Gelen e-fatura listesi alınamadı: ${mikroHata(data)}` });
        }
        const rows = mikroSatirlar(data);
        if (!rows.length) break;
        tumu.push(...rows);
        if (rows.length < SAYFA) break;
      }
      const yazilan = await eBelgeYaz(tumu.map(r => eBelgeNormalize(r, 'e-fatura', 'gelen')), await reqCompanyId(req));
      await writeAuditLog(reqActor(req), 'Gelen e-Fatura Listesi', `${yazilan} belge (${ilk} → ${son})`);
      res.json({ success: true, total: yazilan, ilkTarih: ilk, sonTarih: son, duration: Date.now() - t0 });
    } catch (err) {
      console.error('[ebelge/gelen]', err);
      res.status(500).json({ success: false, error: 'Gelen e-fatura listesi alınamadı.' });
    }
  });

  /** POST /api/mikro/ebelge/giden — GİDEN e-fatura + e-arşiv → eBelgeler
   *  V17'de giden belge listesi metodu YOK; EBELGE_EVRAK_HAREKETLERI tablosundan
   *  SQL ile çekilir. Kolonlar çalışma anında keşfedilir, tahmin edilmez.
   *  Body: { ilkTarih?, sonTarih? } */
  app.post('/api/mikro/ebelge/giden', requireAuth, mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    const ilk = sqlTarih(req.body?.ilkTarih, `${new Date().getFullYear()}-01-01`);
    const son = sqlTarih(req.body?.sonTarih, mikroBugun());
    try {
      const cols = await mikroKolonlar('EBELGE_EVRAK_HAREKETLERI');
      if (!cols.length) {
        return res.status(502).json({ success: false,
          error: 'EBELGE_EVRAK_HAREKETLERI tablosu okunamadı (SqlVeriOkuV2 izni veya farklı şema).' });
      }
      const tarihCol = kolonBul(cols, /tarih/i);
      const siraCol  = kolonBul(cols, /_Guid$/i) ?? cols[0];
      if (!sqlTanimlayici(siraCol) || (tarihCol && !sqlTanimlayici(tarihCol))) {
        return res.status(500).json({ success: false, error: 'Geçersiz kolon adı.' });
      }
      const where = tarihCol ? ` WHERE ${tarihCol} BETWEEN '${ilk}' AND '${son}'` : '';
      const { rows, hata } = await mikroSql(
        `SELECT * FROM EBELGE_EVRAK_HAREKETLERI${where} ORDER BY ${siraCol} OFFSET 0 ROWS FETCH NEXT 5000 ROWS ONLY`,
      );
      if (hata) return res.status(502).json({ success: false, error: `Giden e-belge sorgusu başarısız: ${hata}` });

      // e-fatura mı e-arşiv mi: belge türü kolonundan ayır; kolon yoksa
      // hepsini 'e-fatura' saymak YANLIŞ olurdu -> tür bilinmiyorsa işaretle.
      const turCol = kolonBul(cols, /ebelge_?tur|belge_?tip|earsiv/i);
      const kayitlar = rows.map(r => {
        const ham = turCol ? String(r[turCol] ?? '') : '';
        const tur: 'e-fatura' | 'e-arsiv' = /arsiv|arşiv|1/i.test(ham) ? 'e-arsiv' : 'e-fatura';
        return { ...eBelgeNormalize(r, tur, 'giden'), turBelirsiz: !turCol };
      });
      const yazilan = await eBelgeYaz(kayitlar, await reqCompanyId(req));
      await writeAuditLog(reqActor(req), 'Giden e-Belge Listesi', `${yazilan} belge (${ilk} → ${son})`);
      res.json({ success: true, total: yazilan, ilkTarih: ilk, sonTarih: son,
                 ...(turCol ? {} : { uyari: 'Belge türü kolonu bulunamadı — hepsi e-fatura olarak işaretlendi.' }),
                 duration: Date.now() - t0 });
    } catch (err) {
      console.error('[ebelge/giden]', err);
      res.status(500).json({ success: false, error: 'Giden e-belge listesi alınamadı.' });
    }
  });

  /** POST /api/mikro/ebelge/eirsaliye — e-irsaliye listesi → eBelgeler
   *  Body: { ilkTarih?, sonTarih?, yon?: 'gelen'|'giden' }  (EIrsaliyeTipi 0=giden, 1=gelen) */
  app.post('/api/mikro/ebelge/eirsaliye', requireAuth, mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    const ilk = sqlTarih(req.body?.ilkTarih, `${new Date().getFullYear()}-01-01`);
    const son = sqlTarih(req.body?.sonTarih, mikroBugun());
    const yon: 'gelen' | 'giden' = req.body?.yon === 'gelen' ? 'gelen' : 'giden';
    try {
      const SAYFA = 100;
      const tumu: Record<string, unknown>[] = [];
      for (let index = 0; index < 50; index++) {
        const { ok, data } = await mikroPost('EIrsaliyeListesiV2', {
          IlkTarih: ilk, SonTarih: son, Size: SAYFA, Index: index,
          EIrsaliyeTipi: yon === 'gelen' ? 1 : 0,
        });
        const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
        if (!ok || !r0 || r0.IsError) {
          return res.status(502).json({ success: false, error: `e-İrsaliye listesi alınamadı: ${mikroHata(data)}` });
        }
        const rows = mikroSatirlar(data);
        if (!rows.length) break;
        tumu.push(...rows);
        if (rows.length < SAYFA) break;
      }
      const yazilan = await eBelgeYaz(tumu.map(r => eBelgeNormalize(r, 'e-irsaliye', yon)), await reqCompanyId(req));
      await writeAuditLog(reqActor(req), 'e-İrsaliye Listesi', `${yazilan} belge (${yon}, ${ilk} → ${son})`);
      res.json({ success: true, total: yazilan, yon, duration: Date.now() - t0 });
    } catch (err) {
      console.error('[ebelge/eirsaliye]', err);
      res.status(500).json({ success: false, error: 'e-İrsaliye listesi alınamadı.' });
    }
  });

  /** POST /api/mikro/ebelge/durum — GİB durum sorgusu (EBelgeDurumSorgulamaV2)
   *  Body: { uuid: string, tur?: 'e-fatura'|'e-arsiv', yon?: 'gelen'|'giden' } */
  app.post('/api/mikro/ebelge/durum', requireAuth, mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const uuid = String(req.body?.uuid ?? '').trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(uuid)) return res.status(400).json({ success: false, error: 'Geçerli bir UUID gerekli.' });
    try {
      const { ok, data } = await mikroPost('EBelgeDurumSorgulamaV2', {
        EBelge: {
          EFaturaTipi: req.body?.yon === 'gelen' ? 1 : 0,   // 0 gönderilen, 1 gelen
          EBelgeTipi:  req.body?.tur === 'e-arsiv' ? 1 : 0, // 0 e-fatura, 1 e-arşiv
          UUID: uuid,
        },
      }, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) return res.status(502).json({ success: false, error: mikroHata(data) });
      const d = (r0.Data ?? {}) as Record<string, unknown>;
      // Durumu belgeye işle (varsa) — ama alan yoksa UYDURMA.
      if (adminDb && (d.Durum ?? d.durum ?? d.DurumKodu) !== undefined) {
        // SAHİPLİK: doc id ham UUID olduğu için başka bir kiracının belgesinin
        // UUID'sini bilen biri onun kaydını değiştirebilirdi. Var olan kaydın
        // companyId'si farklıysa yerel yazmayı ATLA (Mikro yanıtı yine döner).
        const mevcut = await adminDb.collection('eBelgeler').doc(uuid).get().catch(() => null);
        const sahibi = mevcut?.exists ? (mevcut.data()?.companyId as string | undefined) : undefined;
        const cid = await reqCompanyId(req);
        if (!sahibi || sahibi === cid) {
          await adminDb.collection('eBelgeler').doc(uuid).set({
            companyId: cid,
            gibDurumu: String(d.Durum ?? d.durum ?? ''),
            gibDurumKodu: String(d.DurumKodu ?? d.durumKodu ?? ''),
            gibSorguZamani: pgServerTimestamp(),
          }, { merge: true }).catch(() => { /* yazamazsak sorgu sonucu yine döner */ });
        }
      }
      res.json({ success: true, data: d });
    } catch (err) {
      console.error('[ebelge/durum]', err);
      res.status(500).json({ success: false, error: 'Durum sorgulanamadı.' });
    }
  });

  /** GET /api/mikro/ebelge/mukellef/:vkn — VKN e-fatura mükellefi mi?
   *  Fatura kesilirken e-fatura mı e-arşiv mi seçileceğini belirler. */
  app.get('/api/mikro/ebelge/mukellef/:vkn', requireAuth, mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const vkn = String(req.params.vkn ?? '').replace(/\D/g, '');
    if (vkn.length !== 10 && vkn.length !== 11) {
      return res.status(400).json({ success: false, error: 'VKN 10, TCKN 11 haneli olmalı.' });
    }
    try {
      const { ok, data } = await mikroPost('EMukellefSorgulamaV2', { EMukellef: { VKN_TCKN: vkn } }, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) return res.status(502).json({ success: false, error: mikroHata(data) });
      res.json({ success: true, vkn, data: r0.Data ?? {} });
    } catch (err) {
      console.error('[ebelge/mukellef]', err);
      res.status(500).json({ success: false, error: 'Mükellef sorgulanamadı.' });
    }
  });

  /** Mikro e-belge yanıtından belge gövdesini (base64 PDF / UBL XML) çıkar.
   *  Alan adı Mikro sürümüne göre değiştiği için en uzun string alan aranır. */
  const ebelgeGovdesi = (data: unknown, minUzunluk: number): string | null => {
    if (typeof data === 'string') return data.length > minUzunluk ? data : null;
    if (data && typeof data === 'object') {
      for (const v of Object.values(data)) {
        if (typeof v === 'string' && v.length > minUzunluk) return v;
      }
    }
    return null;
  };

  /** Mikro "başarılı ama BOŞ" dönebiliyor: IsError=false, Data={} — istek kabul
   *  edilmiş ama belge gelmemiştir. Bunu success:true olarak geçirirsek istemci
   *  "Yanıt beklenen biçimde değil" gibi anlamsız bir hata gösteriyor. Gerçek
   *  sebebi burada, tek yerde söylüyoruz (iki uç da aynı metni kullanır). */
  const EBELGE_BOS_HATA =
    'Mikro isteği kabul etti ama belge içeriği dönmedi. En olası neden: Mikro SRV ' +
    'kullanıcısında GİB e-fatura yetkisi yok (aynı kök neden e-belge uçlarındaki ' +
    '400 hatalarını da açıklıyor). Mikro tarafında SRV kullanıcısına e-belge ' +
    'yetkisi verildikten sonra tekrar deneyin.';

  /** POST /api/mikro/ebelge/pdf — belgenin RESMİ PDF'i (base64)
   *  Body: { uuid?: string, faturaGuid?: string }
   *  uuid → GelenFaturaPdfV2 (gelen), faturaGuid → FaturaPdfV2 (giden).
   *  Not: uygulamanın jsPDF çıktısı resmi nüsha DEĞİLDİR; bu uç gerçek olanı verir. */
  app.post('/api/mikro/ebelge/pdf', requireAuth, mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const uuid = String(req.body?.uuid ?? '').trim();
    const guid = String(req.body?.faturaGuid ?? '').trim();
    const gecerli = (v: string) => /^[0-9a-fA-F-]{36}$/.test(v);
    if (!gecerli(uuid) && !gecerli(guid)) {
      return res.status(400).json({ success: false, error: 'uuid (gelen) veya faturaGuid (giden) gerekli.' });
    }
    try {
      const { ok, data } = gecerli(uuid)
        ? await mikroPost('GelenFaturaPdfV2', { UUID: uuid }, true)
        : await mikroPost('FaturaPdfV2', { Fatura_Guid: guid }, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) return res.status(502).json({ success: false, error: mikroHata(data) });
      if (!ebelgeGovdesi(r0.Data, 500)) return res.status(502).json({ success: false, error: EBELGE_BOS_HATA });
      res.json({ success: true, data: r0.Data });
    } catch (err) {
      console.error('[ebelge/pdf]', err);
      res.status(500).json({ success: false, error: 'PDF alınamadı.' });
    }
  });

  /** POST /api/mikro/ebelge/xml — belgenin resmi UBL/XML'i (EBelgeXMLV2)
   *  Body: { uuid, tur?: 'e-fatura'|'e-arsiv'|'e-irsaliye', yon?: 'gelen'|'giden' }
   *
   *  XML, e-belgenin YASAL aslıdır (PDF yalnız görüntüsüdür). Mali müşavire
   *  gönderirken veya arşivlerken istenen budur.
   *  Spec: EFaturaTipi 0=gönderilen 1=gelen · EBelgeTipi 0=EFatura 1=EArsiv 2=EIrsaliye
   */
  app.post('/api/mikro/ebelge/xml', requireAuth, mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const uuid = String(req.body?.uuid ?? '').trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(uuid)) return res.status(400).json({ success: false, error: 'Geçerli bir UUID gerekli.' });
    const belgeTipi = req.body?.tur === 'e-arsiv' ? 1 : req.body?.tur === 'e-irsaliye' ? 2 : 0;
    try {
      const { ok, data } = await mikroPost('EBelgeXMLV2', {
        EBelge: {
          EFaturaTipi: req.body?.yon === 'gelen' ? 1 : 0,
          EBelgeTipi:  belgeTipi,
          UUID: uuid,
        },
      }, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) return res.status(502).json({ success: false, error: mikroHata(data) });
      if (!ebelgeGovdesi(r0.Data, 200)) return res.status(502).json({ success: false, error: EBELGE_BOS_HATA });
      res.json({ success: true, data: r0.Data });
    } catch (err) {
      console.error('[ebelge/xml]', err);
      res.status(500).json({ success: false, error: 'XML alınamadı.' });
    }
  });

  /** POST /api/mikro/ebelge/earsiv-iptal — e-arşiv faturası iptali (EArsivIptalV2)
   *  Body: { uuid, iptalAciklamasi, iptalTarihi?, faturaSilinsin? }
   *  Yasal işlem — MFA istenir. */
  app.post('/api/mikro/ebelge/earsiv-iptal', requireAuth, requireMfaVerified, mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const uuid = String(req.body?.uuid ?? '').trim();
    const aciklama = String(req.body?.iptalAciklamasi ?? '').trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(uuid)) return res.status(400).json({ success: false, error: 'Geçerli bir UUID gerekli.' });
    if (!aciklama) return res.status(400).json({ success: false, error: 'İptal açıklaması zorunlu.' });
    try {
      const { ok, data } = await mikroPost('EArsivIptalV2', {
        EArsiv: {
          UUID: uuid,
          IptalTarihi: sqlTarih(req.body?.iptalTarihi, mikroBugun()),
          IptalAciklamasi: aciklama,
          FaturaSilinsin: req.body?.faturaSilinsin === true ? 'true' : 'false',
        },
      }, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) return res.status(502).json({ success: false, error: mikroHata(data) });
      if (adminDb) {
        // Sahiplik kontrolü — bkz. /ebelge/durum'daki aynı gerekçe.
        const mevcut = await adminDb.collection('eBelgeler').doc(uuid).get().catch(() => null);
        const sahibi = mevcut?.exists ? (mevcut.data()?.companyId as string | undefined) : undefined;
        const cid = await reqCompanyId(req);
        if (!sahibi || sahibi === cid) {
          await adminDb.collection('eBelgeler').doc(uuid).set({
            companyId: cid, durum: 'İptal', iptalAciklamasi: aciklama, iptalZamani: pgServerTimestamp(),
          }, { merge: true }).catch(() => {});
        }
      }
      await writeAuditLog(reqActor(req), 'e-Arşiv İptal', `${uuid} iptal edildi: ${aciklama}`);
      res.json({ success: true, data: r0.Data ?? {} });
    } catch (err) {
      console.error('[ebelge/earsiv-iptal]', err);
      res.status(500).json({ success: false, error: 'e-Arşiv iptali başarısız.' });
    }
  });

  // ── Mikro Gelen e-Fatura Kabul / Ret ────────────────────────────────────────
  // POST /api/mikro/gelen-fatura/kabul  — GİB üzerinden gelen e-faturayı kabul et
  // POST /api/mikro/gelen-fatura/ret    — GİB üzerinden gelen e-faturayı reddet
  // Body: { faturaGuid: string, firebaseId?: string }   (ret için: aciklama?: string)
  // Endpoint'ler Mikro destek tarafından 2026-06-11'de onaylandı.

  app.post('/api/mikro/gelen-fatura/kabul', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const parsed = validate(GelenFaturaActionSchema, req.body, res);
    if (!parsed) return;
    const { faturaGuid, firebaseId } = parsed;
    const t0 = Date.now();
    try {
      const { ok, data, status } = await mikroPost('GelenFaturalarKabulV2', { FaturaGuid: faturaGuid });
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0       = envelope?.[0] as Record<string, unknown> | undefined;
      const isOk     = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const errorMsg = isOk ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await writeSyncLog('GelenFaturalarKabulV2', 'gelenFatura', faturaGuid, isOk, faturaGuid, errorMsg, Date.now() - t0, reqActor(req));

      if (adminDb && firebaseId && isOk) {
        await adminDb.collection('mikroFaturalar').doc(firebaseId).set({
          companyId: await reqCompanyId(req),
          gibDurumu: 'kabul',
          gibKabulAt: pgServerTimestamp(),
        }, { merge: true });
      }

      res.json({ success: isOk, data: r0?.Data ?? null, duration: Date.now() - t0, error: errorMsg });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/mikro/gelen-fatura/ret', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const parsed = validate(GelenFaturaActionSchema, req.body, res);
    if (!parsed) return;
    const { faturaGuid, aciklama, firebaseId } = parsed;
    const t0 = Date.now();
    try {
      const { ok, data, status } = await mikroPost('GelenFaturalarRedV2', {
        FaturaGuid: faturaGuid,
        Aciklama:   aciklama || 'Fatura reddedildi.',
      });
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0       = envelope?.[0] as Record<string, unknown> | undefined;
      const isOk     = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const errorMsg = isOk ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await writeSyncLog('GelenFaturalarRedV2', 'gelenFatura', faturaGuid, isOk, faturaGuid, errorMsg, Date.now() - t0, reqActor(req));

      if (adminDb && firebaseId && isOk) {
        await adminDb.collection('mikroFaturalar').doc(firebaseId).set({
          companyId: await reqCompanyId(req),
          gibDurumu: 'ret',
          gibRetAciklama: aciklama || null,
          gibRetAt: pgServerTimestamp(),
        }, { merge: true });
      }

      res.json({ success: isOk, data: r0?.Data ?? null, duration: Date.now() - t0, error: errorMsg });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
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
  const planAmount = (plan: string, cycle: string): number =>
    PLAN_PRICES_TRY[plan]?.[cycle === 'yearly' ? 'yearly' : 'monthly'] ?? 0;

  /** İstek sahibinin süper-admin olup olmadığını döner (panel görünürlüğü için). */
  app.get('/api/superadmin/me', requireAuth, (req: Request, res: Response) => {
    res.json({ isSuperAdmin: isSuperAdmin(req), email: reqActor(req).email });
  });

  /** Tüm kiracı firmaları istatistikleriyle listeler. */
  // Kiracinin KENDI yedek hedefini kaydet (super-admin onboarding adimi).
  // rclone remote'un KENDISI sir degil (jeton sunucudaki rclone.conf'ta durur),
  // ama yine de super-admin disina acilmaz: hangi musterinin nereye
  // yedekledigi operasyonel bir bilgidir.
  app.post('/api/superadmin/tenants/:companyId/backup', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin unavailable.' });
    const cid = String(req.params.companyId || '').trim();
    if (!cid) return res.status(400).json({ success: false, error: 'companyId gerekli.' });
    const { rcloneRemote, enabled, retentionDays } = (req.body ?? {}) as
      { rcloneRemote?: string; enabled?: boolean; retentionDays?: number };

    const remote = String(rcloneRemote ?? '').trim();
    // "ad:yol" bicimi — iki nokta ZORUNLU. Bicimi burada dogrulamak, yedek
    // gorevinin gece yarisi sessizce patlamasindan iyidir.
    if (remote && !(remote.indexOf(':') > 0)) {
      return res.status(400).json({ success: false, error: "rclone hedefi 'ad:yol' biciminde olmali (or. gdrive:cetpa-yedek)." });
    }
    const gun = Number(retentionDays);
    try {
      await adminDb.collection('backupConfigs').doc(cid).set({
        companyId: cid,
        rcloneRemote: remote,
        enabled: enabled !== false,
        ...(Number.isFinite(gun) && gun > 0 ? { retentionDays: Math.floor(gun) } : {}),
        updatedAt: pgServerTimestamp(),
      }, { merge: true });
      void writeAuditLog(reqActor(req), 'Kiraci yedek ayari', `${cid} -> ${remote || '(temizlendi)'}`);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/superadmin/tenants', requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    try {
      const usersSnap = await adminDb.collection('users').get();
      // companyId -> { userCount, owner, users[] }
      const groups = new Map<string, { userCount: number; ownerEmail: string; ownerName: string; createdAt: unknown }>();
      usersSnap.docs.forEach(d => {
        const u = d.data() as Record<string, unknown>;
        const cid = (u.companyId as string) || d.id;
        const g = groups.get(cid) || { userCount: 0, ownerEmail: '', ownerName: '', createdAt: undefined };
        g.userCount++;
        // Sahip: uid === companyId olan ya da admin rolündeki ilk kullanıcı
        if (d.id === cid || (!g.ownerEmail && (u.role === 'admin' || u.role === 'Admin'))) {
          g.ownerEmail = (u.email as string) || g.ownerEmail;
          g.ownerName = (u.displayName as string) || (u.name as string) || g.ownerName;
        }
        if (!g.ownerEmail) g.ownerEmail = (u.email as string) || g.ownerEmail;
        if (!g.createdAt) g.createdAt = u.createdAt;
        groups.set(cid, g);
      });

      const tenants = await Promise.all(Array.from(groups.entries()).map(async ([cid, g]) => {
        let companyName = '';
        let plan = 'free'; let subStatus = 'none'; let cycle = 'monthly';
        let nextPaymentDate: unknown = null; let lastPaymentDate: unknown = null; let amount = 0;
        try {
          const profSnap = await adminDb!.collection('settings').doc(`${cid}__companyProfile`).get();
          if (profSnap.exists) { const p = profSnap.data() as Record<string, unknown>; companyName = (p.companyName as string) || (p.name as string) || (p.unvan as string) || ''; }
        } catch { /* ignore */ }
        try {
          const subSnap = await adminDb!.collection('subscriptions').doc(cid).get();
          if (subSnap.exists) {
            const s = subSnap.data() as Record<string, unknown>;
            plan = (s.plan as string) || plan;
            subStatus = (s.status as string) || subStatus;
            cycle = (s.cycle as string) || cycle;
            nextPaymentDate = s.currentPeriodEnd ?? s.nextPaymentDate ?? s.endDate ?? null;
            lastPaymentDate = s.lastPaymentDate ?? s.lastPaymentAt ?? s.lastPayment ?? null;
            amount = (s.amount as number) ?? planAmount(plan, cycle);
          }
        } catch { /* ignore */ }
        if (!amount) amount = planAmount(plan, cycle);
        const status = await getCompanyStatus(cid);
        // YEDEK DURUMU (2026-08-21): her kiraci KENDI hesabina yedeklenir.
        // Kurulum yapilmamis kiraci onboarding'i TAMAMLANMAMIS sayilir —
        // panelde gorunur olmasi sart, aksi halde "yedeklendigini sanan ama
        // yedeklenmeyen musteri" ortaya cikar.
        let backup: { yapilandirildi: boolean; enabled: boolean; lastRunAt: unknown; lastStatus: string | null; remote: string | null } =
          { yapilandirildi: false, enabled: true, lastRunAt: null, lastStatus: null, remote: null };
        try {
          const bSnap = await adminDb!.collection('backupConfigs').doc(cid).get();
          if (bSnap.exists) {
            const b = bSnap.data() as Record<string, unknown>;
            const remote = (b.rcloneRemote as string) || '';
            backup = {
              yapilandirildi: !!remote && remote.includes(':'),
              enabled: b.enabled !== false,
              lastRunAt: b.lastRunAt ?? null,
              lastStatus: (b.lastStatus as string) ?? null,
              remote: remote || null,
            };
          }
        } catch { /* ayar okunamadi — yapilandirilmamis say */ }
        return {
          backup,
          companyId: cid,
          companyName: companyName || g.ownerName || g.ownerEmail || cid,
          ownerEmail: g.ownerEmail,
          userCount: g.userCount,
          plan, subStatus, status, cycle, amount,
          nextPaymentDate: nextPaymentDate ?? null,
          lastPaymentDate: lastPaymentDate ?? null,
          createdAt: g.createdAt ?? null,
        };
      }));
      tenants.sort((a, b) => b.userCount - a.userCount);
      return res.json({ tenants, count: tenants.length, timestamp: new Date().toISOString() });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  /** Bir kiracı firmanın durumunu değiştirir (active/suspended) + plan/not. */
  app.post('/api/superadmin/tenants/:companyId/status', requireAuth, requireMfaVerified, requireSuperAdmin, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    const cid = String(req.params.companyId);
    const { status, note } = (req.body ?? {}) as { status?: string; note?: string };
    if (status !== 'active' && status !== 'suspended') {
      return res.status(400).json({ error: 'status "active" veya "suspended" olmalı.' });
    }
    try {
      const csPayload: Record<string, unknown> = { status, updatedAt: pgServerTimestamp(), updatedBy: reqActor(req).email };
      if (note !== undefined) csPayload.note = note; // not yalnız gönderildiğinde yazılır (mevcut notu silme)
      await adminDb.collection('companyStatus').doc(cid).set(csPayload, { merge: true });
      companyStatusCache.set(cid, { status, exp: Date.now() + 60_000 });
      void writeAuditLog(reqActor(req), `Kiracı firma ${status === 'suspended' ? 'askıya alındı' : 'aktifleştirildi'}`, `companyStatus/${cid}`);
      return res.json({ ok: true, companyId: cid, status });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  /** Bir kiracı firmayı düzenler — plan, durum ve not birlikte güncellenir. */
  const SA_PLANS = new Set(['starter', 'professional', 'business', 'enterprise', 'free']);
  app.post('/api/superadmin/tenants/:companyId/update', requireAuth, requireMfaVerified, requireSuperAdmin, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    const cid = String(req.params.companyId);
    const { plan, status, note, cycle, nextPaymentDate, profile } = (req.body ?? {}) as
      { plan?: string; status?: string; note?: string; cycle?: string; nextPaymentDate?: string | number | null; profile?: Record<string, unknown> };
    if (plan !== undefined && !SA_PLANS.has(plan)) return res.status(400).json({ error: 'Geçersiz plan.' });
    if (status !== undefined && status !== 'active' && status !== 'suspended') return res.status(400).json({ error: 'Geçersiz durum.' });
    if (cycle !== undefined && cycle !== 'monthly' && cycle !== 'yearly') return res.status(400).json({ error: 'Geçersiz dönem.' });
    try {
      const changes: string[] = [];
      // Firma profili (vergi no/dairesi, iletişim, IBAN, adres) — süper-admin
      // önceden yalnız faturalandırma alanlarını düzenleyebiliyordu (2026-08-17
      // kullanıcı bildirimi: "Firma Bilgileri" salt-okunurdu).
      if (profile && typeof profile === 'object') {
        const PROFILE_FIELDS = ['companyName', 'taxNo', 'taxOffice', 'address', 'email', 'phone', 'iban', 'website'] as const;
        const patch: Record<string, unknown> = {};
        for (const f of PROFILE_FIELDS) {
          if (typeof profile[f] === 'string') patch[f] = (profile[f] as string).slice(0, 500);
        }
        if (Object.keys(patch).length) {
          await adminDb.collection('settings').doc(`${cid}__companyProfile`).set(
            { ...patch, updatedAt: pgServerTimestamp(), updatedBy: reqActor(req).email }, { merge: true });
          changes.push('profil');
        }
      }
      // Abonelik alanları (plan / dönem / sonraki ödeme tarihi) tek yazımda
      const subPatch: Record<string, unknown> = {};
      if (plan !== undefined) {
        subPatch.plan = plan; changes.push(`plan=${plan}`);
        // Süper-admin manuel ücretli plan atadığında aboneliği aktif say (MRR'ye dahil).
        subPatch.status = (plan === 'free' || plan === 'enterprise') ? 'none' : 'active';
      }
      if (cycle !== undefined) { subPatch.cycle = cycle; changes.push(`dönem=${cycle}`); }
      if (nextPaymentDate !== undefined) { subPatch.currentPeriodEnd = nextPaymentDate; changes.push('sonraki ödeme'); }
      if (Object.keys(subPatch).length) {
        await adminDb.collection('subscriptions').doc(cid).set({ ...subPatch, updatedAt: pgServerTimestamp(), updatedBy: reqActor(req).email }, { merge: true });
      }
      if (status !== undefined || note !== undefined) {
        const payload: Record<string, unknown> = { updatedAt: pgServerTimestamp(), updatedBy: reqActor(req).email };
        if (status !== undefined) payload.status = status;
        if (note !== undefined) payload.note = note;
        await adminDb.collection('companyStatus').doc(cid).set(payload, { merge: true });
        if (status !== undefined) { companyStatusCache.set(cid, { status, exp: Date.now() + 60_000 }); changes.push(`durum=${status}`); }
      }
      void writeAuditLog(reqActor(req), 'Kiracı firma düzenlendi', `tenant/${cid} (${changes.join(', ') || 'not'})`);
      return res.json({ ok: true, companyId: cid, plan, status });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  /** Tek bir kiracı firmanın tam detayı — profil, kullanıcılar, faturalandırma, ödeme geçmişi. */
  app.get('/api/superadmin/tenants/:companyId', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    const cid = String(req.params.companyId);
    try {
      // Profil
      let profile: Record<string, unknown> = {};
      try {
        const ps = await adminDb.collection('settings').doc(`${cid}__companyProfile`).get();
        if (ps.exists) profile = ps.data() as Record<string, unknown>;
        else { const legacy = await adminDb.collection('settings').doc('companyProfile').get(); if (legacy.exists) profile = legacy.data() as Record<string, unknown>; }
      } catch { /* ignore */ }

      // Kullanıcılar (companyId == cid veya uid == cid)
      const usersSnap = await adminDb.collection('users').get();
      const users = usersSnap.docs
        .filter(d => ((d.data().companyId as string) || d.id) === cid)
        .map(d => { const u = d.data() as Record<string, unknown>; return {
          uid: d.id, email: (u.email as string) || '', name: (u.displayName as string) || (u.name as string) || '',
          role: (u.role as string) || 'user', lastLogin: u.lastLogin ?? null, createdAt: u.createdAt ?? null,
        }; });
      const owner = users.find(u => u.uid === cid) || users.find(u => /admin/i.test(u.role)) || users[0] || null;

      // Abonelik / faturalandırma
      let billing: Record<string, unknown> = { plan: 'free', status: 'none', cycle: 'monthly' };
      try {
        const ss = await adminDb.collection('subscriptions').doc(cid).get();
        if (ss.exists) billing = { ...billing, ...(ss.data() as Record<string, unknown>) };
      } catch { /* ignore */ }
      const plan = String(billing.plan || 'free');
      const cycle = String(billing.cycle || 'monthly');
      billing.amount = (billing.amount as number) ?? planAmount(plan, cycle);
      billing.nextPaymentDate = billing.currentPeriodEnd ?? billing.nextPaymentDate ?? billing.endDate ?? null;
      billing.lastPaymentDate = billing.lastPaymentDate ?? billing.lastPaymentAt ?? billing.lastPayment ?? null;

      // Durum + not
      const csSnap = await adminDb.collection('companyStatus').doc(cid).get();
      const cs = csSnap.exists ? (csSnap.data() as Record<string, unknown>) : {};
      const status = await getCompanyStatus(cid);

      // Ödeme geçmişi (tenantInvoices)
      let invoices: Record<string, unknown>[] = [];
      try {
        const invSnap = await adminDb.collection('tenantInvoices').where('companyId', '==', cid).get();
        invoices = invSnap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
          .sort((a, b) => Number((b as { createdMs?: number }).createdMs || 0) - Number((a as { createdMs?: number }).createdMs || 0));
      } catch { /* ignore */ }

      return res.json({
        companyId: cid,
        profile: {
          companyName: profile.companyName || profile.name || '', taxNo: profile.taxNo || '', taxOffice: profile.taxOffice || '',
          address: profile.address || '', email: profile.email || (owner?.email ?? ''), phone: profile.phone || '',
          iban: profile.iban || '', website: profile.website || '',
        },
        owner, users, billing, status, note: cs.note || '',
        invoices,
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  /** Kiracının bir kullanıcısının rolünü değiştirir. Süper-admin cross-tenant yazdığından
   *  (kendi companyId'si hedef kiracıyla eşleşmez) generic /api/db/:coll/:id yolu
   *  ownsDoc() ile bunu 403'ler — bu yüzden ayrı, dar kapsamlı, requireSuperAdmin ile
   *  korunan bir uç. Hedef kullanıcının GERÇEKTEN bu kiracıya ait olduğu doğrulanır
   *  (URL'den companyId tahmin edip başka kiracının kullanıcısını değiştirme riski).
   */
  app.post('/api/superadmin/tenants/:companyId/users/:uid/role', requireAuth, requireMfaVerified, requireSuperAdmin, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    const cid = String(req.params.companyId), uid = String(req.params.uid);
    const ROLES = ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'HR', 'Purchasing', 'B2B', 'Dealer', 'Legal', 'Corporate', 'Quality'];
    const { role } = (req.body ?? {}) as { role?: string };
    if (!role || !ROLES.includes(role)) return res.status(400).json({ error: 'Geçersiz rol.' });
    try {
      const uSnap = await adminDb.collection('users').doc(uid).get();
      if (!uSnap.exists) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      const u = uSnap.data() as Record<string, unknown>;
      if (((u.companyId as string) || uid) !== cid) return res.status(403).json({ error: 'Kullanıcı bu firmaya ait değil.' });
      await adminDb.collection('users').doc(uid).set({ role, updatedAt: pgServerTimestamp() }, { merge: true });
      void writeAuditLog(reqActor(req), 'Kiracı kullanıcı rolü değiştirildi', `tenant/${cid} user/${uid} → ${role}`);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  /** Kiracının bir kullanıcısını kaldırır (hard delete — mevcut tenant-admin
   *  self-service akışıyla aynı davranış, bkz. AdminPage.tsx deleteDoc). */
  app.post('/api/superadmin/tenants/:companyId/users/:uid/remove', requireAuth, requireMfaVerified, requireSuperAdmin, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    const cid = String(req.params.companyId), uid = String(req.params.uid);
    try {
      const uSnap = await adminDb.collection('users').doc(uid).get();
      if (!uSnap.exists) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      const u = uSnap.data() as Record<string, unknown>;
      if (((u.companyId as string) || uid) !== cid) return res.status(403).json({ error: 'Kullanıcı bu firmaya ait değil.' });
      if (uid === cid) return res.status(400).json({ error: 'Firma sahibi (owner) buradan silinemez.' });
      await adminDb.collection('users').doc(uid).delete();
      void writeAuditLog(reqActor(req), 'Kiracı kullanıcısı kaldırıldı', `tenant/${cid} user/${uid} (${u.email as string || ''})`);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  /** Kiracıya süper-admin adına yeni kullanıcı davet eder (davet e-postası + link),
   *  /api/admin/invite'ın cross-tenant karşılığı (o uç yalnız kendi firmasına davet
   *  eder — requireAdmin ile). */
  app.post('/api/superadmin/tenants/:companyId/invite', requireAuth, requireMfaVerified, requireSuperAdmin, async (req: Request, res: Response) => {
    const cid = String(req.params.companyId);
    const { email, role = 'Sales' } = (req.body ?? {}) as { email?: string; role?: string };
    if (!email || !isValidEmail(email)) return res.status(400).json({ success: false, error: 'Geçerli e-posta gerekli.' });
    if (!(APP_ROLES as readonly string[]).includes(role)) {
      return res.status(400).json({ success: false, error: `Geçersiz rol. Geçerli roller: ${APP_ROLES.join(', ')}` });
    }
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin unavailable.' });
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    try {
      await adminDb.collection('invites').doc(token).set({ companyId: cid, email, role, token, expiresAt, createdAt: pgServerTimestamp(), used: false, invitedBySuperAdmin: reqActor(req).email });
    } catch (e) { return res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) }); }
    const appUrl = process.env.APP_URL || `https://gen-lang-client-0628151245.web.app`;
    const inviteUrl = `${appUrl}/?invite=${token}`;
    void writeAuditLog(reqActor(req), 'Kiracıya kullanıcı davet edildi', `tenant/${cid} ${email} (${role})`);
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return res.json({ success: true, inviteUrl, emailSent: false, note: 'Resend yapılandırılmadı — daveti manuel paylaşın.' });
    try {
      const fromAddress = process.env.RESEND_FROM || 'davet@cetpa.com.tr';
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;background:#f5f5f7;margin:0;padding:24px;">
  <div style="max-width:480px;margin:auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
    <div style="background:#ff4000;padding:28px 32px;"><h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">CETPA'ya Davet Edildiniz</h1></div>
    <div style="padding:28px 32px;">
      <p style="font-size:14px;color:#1d1d1f;margin:0 0 24px;">CETPA platformuna <strong>${escapeHtml(role)}</strong> rolüyle davet edildiniz.</p>
      <a href="${inviteUrl}" style="display:inline-block;background:#ff4000;color:#fff;padding:14px 28px;border-radius:12px;font-weight:700;font-size:14px;text-decoration:none;">Hesap Oluştur</a>
      <p style="font-size:11px;color:#86868b;margin:20px 0 0;">Bu bağlantı 7 gün geçerlidir.</p>
    </div></div></body></html>`;
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromAddress, to: [email], subject: `CETPA'ya Davet Edildiniz — ${role} Rolü`, html }),
      });
      const d = await r.json() as Record<string, unknown>;
      if (!r.ok) return res.json({ success: true, inviteUrl, emailSent: false, note: (d.message as string) || 'Resend API hatası' });
      res.json({ success: true, inviteUrl, emailSent: true, id: d.id });
    } catch (e) {
      res.json({ success: true, inviteUrl, emailSent: false, note: e instanceof Error ? e.message : String(e) });
    }
  });

  /** Kiracıya abonelik ödeme linki oluşturur (iyzico) ve isteğe bağlı e-posta gönderir. */
  app.post('/api/superadmin/tenants/:companyId/payment-link', requireAuth, requireMfaVerified, requireSuperAdmin, async (req: Request, res: Response) => {
    if (!adminDb) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    const creds = await getIyzicoCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true, error: 'İyzico yapılandırılmamış (IYZICO_API_KEY).' });
    const cid = String(req.params.companyId);
    const body = (req.body ?? {}) as {
      amount?: number; currency?: string; plan?: string; cycle?: string;
      email?: string; sendEmail?: boolean; description?: string;
    };
    const currency = body.currency || 'TRY';
    try {
      // Plan / dönem / tutar çözümle
      const ss = await adminDb.collection('subscriptions').doc(cid).get();
      const sub = ss.exists ? (ss.data() as Record<string, unknown>) : {};
      const plan = body.plan || String(sub.plan || 'starter');
      const cycle = body.cycle || String(sub.cycle || 'monthly');
      const amount = Number(body.amount ?? planAmount(plan, cycle));
      if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Geçerli bir tutar gerekli (plan ücretsiz/özel olabilir).' });

      // Profil / e-posta / müşteri adı
      let profile: Record<string, unknown> = {};
      const ps = await adminDb.collection('settings').doc(`${cid}__companyProfile`).get();
      if (ps.exists) profile = ps.data() as Record<string, unknown>;
      let ownerEmail = body.email || (profile.email as string) || '';
      let customerName = (profile.companyName as string) || '';
      if (!ownerEmail || !customerName) {
        const us = await adminDb.collection('users').get();
        const mine = us.docs.filter(d => ((d.data().companyId as string) || d.id) === cid).map(d => d.data() as Record<string, unknown>);
        const own = mine.find(u => /admin/i.test(String(u.role))) || mine[0];
        ownerEmail = ownerEmail || (own?.email as string) || '';
        customerName = customerName || (own?.displayName as string) || (own?.name as string) || ownerEmail || cid;
      }
      if (!ownerEmail) return res.status(400).json({ success: false, error: 'Müşteri e-postası bulunamadı; e-posta parametresi gönderin.' });
      if (!isValidEmail(ownerEmail)) return res.status(400).json({ success: false, error: 'Geçersiz e-posta adresi.' });

      const invoiceId = `inv_${cid}_${randStr().slice(0, 10)}`;
      const amountStr = amount.toFixed(2);
      const nameParts = customerName.trim().split(' ');
      const callbackUrl = `${req.protocol}://${req.get('host')}/payment/result`;
      const planLabel = `Cetpa ${plan.charAt(0).toUpperCase() + plan.slice(1)} (${cycle === 'yearly' ? 'Yıllık' : 'Aylık'})`;

      const iyzBody = {
        locale: 'tr', conversationId: invoiceId, price: amountStr, paidPrice: amountStr, currency,
        basketId: invoiceId, paymentGroup: 'SUBSCRIPTION', callbackUrl,
        buyer: {
          id: cid, name: nameParts[0] || 'Müşteri', surname: nameParts.slice(1).join(' ') || 'Firma',
          email: ownerEmail, identityNumber: (profile.taxNo as string) || '11111111111',
          registrationAddress: (profile.address as string) || 'Türkiye', city: 'İstanbul', country: 'Turkey',
          ip: req.ip || '127.0.0.1', gsmNumber: (profile.phone as string) || '+905000000000',
        },
        shippingAddress: { contactName: customerName, city: 'İstanbul', country: 'Turkey', address: (profile.address as string) || 'Türkiye', zipCode: '34000' },
        billingAddress: { contactName: customerName, city: 'İstanbul', country: 'Turkey', address: (profile.address as string) || 'Türkiye', zipCode: '34000' },
        basketItems: [{ id: invoiceId, name: body.description || planLabel, category1: 'SaaS', itemType: 'VIRTUAL', price: amountStr }],
      };

      const rndStr = randStr();
      const pkiStr = toPkiString(iyzBody);
      const auth = iyzicoAuth(creds, rndStr, pkiStr);
      const r = await fetch(`${creds.baseUrl}/payment/initialize/checkout`, {
        method: 'POST',
        headers: { Authorization: auth, 'x-iyzi-rnd': rndStr, 'Content-Type': 'application/json' },
        body: JSON.stringify(iyzBody), signal: AbortSignal.timeout(15000),
      });
      const d = await r.json() as { status?: string; paymentPageUrl?: string; token?: string; errorMessage?: string };
      const success = d.status === 'success' && !!d.paymentPageUrl;
      if (!success) return res.status(502).json({ success: false, error: d.errorMessage || 'İyzico link oluşturulamadı.' });

      // Faturayı kaydet
      await adminDb.collection('tenantInvoices').doc(invoiceId).set({
        companyId: cid, plan, cycle, amount, currency,
        paymentPageUrl: d.paymentPageUrl, iyzicoToken: d.token,
        status: 'pending', email: ownerEmail, description: body.description || planLabel,
        sandbox: creds.baseUrl.includes('sandbox'),
        createdAt: pgServerTimestamp(), createdMs: Date.now(), createdBy: reqActor(req).email,
      });

      // İsteğe bağlı e-posta gönder
      let emailed = false; let emailError: string | undefined;
      if (body.sendEmail) {
        // Kiracı kaynaklı alanlar (customerName) HTML injection'a karşı escape edilir.
        const safeName = escapeHtml(customerName);
        const safePlan = escapeHtml(planLabel);
        const safeUrl = encodeURI(d.paymentPageUrl || '');
        const html = `
          <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="color:#ff4000;margin:0 0 4px">Cetpa Ödeme Bağlantısı</h2>
            <p style="color:#555;font-size:14px">Sayın ${safeName},</p>
            <p style="color:#555;font-size:14px">${safePlan} aboneliğiniz için ödeme bağlantınız hazır:</p>
            <p style="font-size:22px;font-weight:bold;color:#1d1d1f;margin:16px 0">${escapeHtml(amountStr)} ${escapeHtml(currency)}</p>
            <a href="${safeUrl}" style="display:inline-block;background:#ff4000;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-weight:bold">Ödemeyi Tamamla</a>
            <p style="color:#999;font-size:12px;margin-top:20px">Bağlantı çalışmıyorsa: <br>${escapeHtml(safeUrl)}</p>
          </div>`;
        const er = await sendEmail(ownerEmail, `Cetpa Ödeme Bağlantısı — ${amountStr} ${currency}`, html);
        emailed = !er.error;
        if (er.error) emailError = er.error === 'notConfigured' ? 'E-posta servisi yapılandırılmamış (RESEND_API_KEY).' : er.error;
      }

      void writeAuditLog(reqActor(req), 'Kiracı ödeme linki oluşturuldu', `tenant/${cid} — ${amountStr} ${currency} (${plan}/${cycle})${emailed ? ' + e-posta' : ''}`);
      return res.json({ success: true, paymentPageUrl: d.paymentPageUrl, invoiceId, amount, currency, email: ownerEmail, emailed, emailError });
    } catch (err) {
      return res.status(500).json({ success: false, error: String(err) });
    }
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

  app.get('/api/dynamics/status', async (_req: Request, res: Response) => {
    const hasEnvCreds = !!(process.env.DYNAMICS_TENANT_ID && process.env.DYNAMICS_CLIENT_ID && process.env.DYNAMICS_CLIENT_SECRET && process.env.DYNAMICS_COMPANY_ID);
    const fsCreds = hasEnvCreds ? null : await getDynamicsCredsFromFirestore();
    const configured = hasEnvCreds || !!fsCreds;
    if (!configured) return res.json({ configured: false, connected: false });
    try {
      const token = await getDynamicsToken();
      if (!token) return res.json({ configured: true, connected: false, error: 'OAuth2 token request failed — check DYNAMICS_CLIENT_ID / DYNAMICS_CLIENT_SECRET / DYNAMICS_TENANT_ID' });
      // Bağlantı probu: getDynamicsBase() ZATEN companies(ID) içerir; hafif bir
      // alt-entity sorgusu (items?$top=1) hem OAuth hem şirket erişimini doğrular.
      // (Önceki `${base}/companies` = .../companies(ID)/companies → daima 404'tü.)
      const r = await fetch(`${getDynamicsBase()}/items?$top=1`, {
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
  app.post('/api/dynamics/import/stok', requireAuth, requireMfaVerified, requireAdmin, async (req: Request, res: Response) => {
    const token = await getDynamicsToken();
    if (!token) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    if (!adminDb) return res.status(503).json({ success: false, error: 'DB yok.' });
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await reqCompanyId(req);
    const t0 = Date.now();
    try {
      const items = await dynamicsGetAll(token, 'items');
      // KİRACI SINIRI: "Mikro/Paraşüt deseni" yorumu doğru — o desendeki aynı
      // eksik filtre buraya da kopyalanmış. GTIN/barkod gibi SKU'lar kiracılar
      // arasında çakışabilir; düzeltme Paraşüt/barkod/fiyat ile aynı.
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
          updatedAt: pgServerTimestamp(),
          companyId, // create+update etiketle (self-heal)
        };
        const ref = bySku.get(sku);
        if (ref) { batch.update(ref, fields); updated++; }
        else {
          const newRef = adminDb.collection('inventory').doc();
          batch.set(newRef, { ...fields, sku, category: 'Genel', lowStockThreshold: 5, costPrice: 0, createdAt: pgServerTimestamp() });
          bySku.set(sku, newRef);
          created++;
        }
        if (++ops >= 400) await flush();
      }
      await flush();
      await writeAuditLog(reqActor(req), 'Dynamics Stok İçe Aktarma', `${created} yeni / ${updated} güncel`);
      res.json({ success: true, created, updated, errors: 0, total: items.length, duration: Date.now() - t0 });
    } catch (e) {
      res.status(500).json({ success: false, created: 0, updated: 0, errors: 1, error: (e as Error).message });
    }
  });

  // BC customer → leads upsert (dedup: dynamicsId → VKN → isim; Paraşüt/Mikro deseni).
  // NOT: canlı BC'ye karşı test EDİLMEDİ — ilk gerçek sync doğrulayacak.
  app.post('/api/dynamics/import/cari', requireAuth, requireMfaVerified, requireAdmin, async (req: Request, res: Response) => {
    const token = await getDynamicsToken();
    if (!token) return res.json({ success: false, notConfigured: true, created: 0, updated: 0, errors: 0 });
    if (!adminDb) return res.status(503).json({ success: false, error: 'DB yok.' });
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await reqCompanyId(req);
    const t0 = Date.now();
    try {
      const customers = await dynamicsGetAll(token, 'customers');
      // KİRACI SINIRI: Mikro cari import'unda bulunan sınıfın aynısı.
      const leadSnap = await tenantSnap('leads', companyId);
      const byDynId = new Map<string, PgDocRef>();
      const byVkn = new Map<string, PgDocRef>();
      const byName = new Map<string, PgDocRef>();
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
      let batch = adminDb.batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = adminDb!.batch(); ops = 0; } };
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
          updatedAt: pgServerTimestamp(),
          companyId, // create+update etiketle (self-heal)
        };
        const vkn = normVkn(fields.taxId);
        const nameKey = name.trim().toLowerCase();
        const ref = byDynId.get(did)
          || (vkn ? byVkn.get(vkn) : undefined)
          || (nameKey ? byName.get(nameKey) : undefined);
        if (ref) { batch.update(ref, fields); updated++; }
        else {
          const newRef = adminDb.collection('leads').doc();
          batch.set(newRef, { ...fields, status: 'Active', createdAt: pgServerTimestamp() });
          if (did) byDynId.set(did, newRef);
          created++;
        }
        if (++ops >= 400) await flush();
      }
      await flush();
      await writeAuditLog(reqActor(req), 'Dynamics Cari İçe Aktarma', `${created} yeni / ${updated} güncel`);
      res.json({ success: true, created, updated, errors: 0, total: customers.length, duration: Date.now() - t0 });
    } catch (e) {
      res.status(500).json({ success: false, created: 0, updated: 0, errors: 1, error: (e as Error).message });
    }
  });

  app.post('/api/dynamics/export/siparis', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    const { orderId } = req.body as { orderId?: string };
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    const token = await getDynamicsToken();
    if (!token) return res.json({ success: false, notConfigured: true });
    // TODO: fetch order from Firebase, POST /salesOrders to Business Central
    return res.json({ success: false, notImplemented: true, error: 'Dynamics order export not yet implemented.' });
  });

  app.post('/api/dynamics/export/fatura', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
