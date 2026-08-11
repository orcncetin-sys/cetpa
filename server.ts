import express, { Request, Response, NextFunction } from "express";
import { PgBoss } from "pg-boss";
import compression from "compression";
import helmet from "helmet";
import {
  type AppRole, type DbOp, ADMIN_ROLES, APPEND_ONLY_COLLECTIONS, PUBLIC_WRITE_COLLECTIONS,
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
import tls from "tls";
import multer from "multer";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cron from "node-cron";
import admin from "firebase-admin";
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
let adminFirestoreFallback: admin.firestore.Firestore | null = null;
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

  adminFirestoreFallback = adminApp.firestore();
  adminFirestoreFallback.settings({ databaseId: FIRESTORE_DB_ID });
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
    const decoded = await admin.auth().verifyIdToken(token);
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
): Promise<Record<string, unknown>> {
  const role = await getUserRole(uid);
  if (role === 'Admin') return data; // Admin kullanıcı yönetimi yapabilir
  const out = { ...data };
  for (const f of PROTECTED_USER_FIELDS) {
    if (before && f in before) out[f] = before[f];
    else delete out[f];
  }
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
async function loadCompanyDocs(coll: string, cid: string): Promise<Array<Record<string, unknown>>> {
  if (pgPool) {
    const { rows } = await pgPool.query(
      "SELECT id, data FROM docs WHERE coll = $1 AND (data->>'companyId' = $2 OR NOT (data ? 'companyId'))",
      [coll, cid],
    );
    return rows.map(r => ({ id: r.id, ...(r.data as Record<string, unknown>) }));
  }
  if (!adminDb) return [];
  const snap = await adminDb.collection(coll).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>))
    .filter(x => { const dc = x.companyId as string | undefined; return !dc || dc === cid; });
}

// ── firebase-admin Firestore compatible shim over PostgreSQL ─────────────────
// server.ts's 170+ adminDb call sites (Shopify/Mikro sync, audit log, crons)
// keep their code shape; only the backing store changes. Writes broadcast over
// SSE so connected browsers update live, exactly like client-initiated writes.

/* eslint-disable @typescript-eslint/no-explicit-any */
type PgDocData = Record<string, any>;

/** Mikro Jump kurulum sürümü — V16'da SqlVeriOkuV2 ve cha_ebelge_turu YOK.
 *  (V16/V17 Postman koleksiyonları diff'i, 2026-06-12). Müşteri V17'ye
 *  geçtiğinde .env.production'a MIKRO_JUMP_SURUM=17 eklemek yeterli. */
/** SSE init'te koleksiyon başına gönderilecek azami satır. Emniyet supabı:
 *  tek bir koleksiyonun büyümesi tarayıcıyı kilitlemesin. Çarpıldığında SESSİZCE
 *  kırpılmaz — sunucuda uyarı loglanır ve init eventine `truncated`+`total`
 *  eklenir, böylece eksik veri "tam veri" gibi görünmez. */
const STREAM_INIT_MAX_ROWS = Number(process.env.STREAM_INIT_MAX_ROWS || 20000);

const MIKRO_JUMP_SURUM = Number(process.env.MIKRO_JUMP_SURUM || 16);

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
const MIKRO_V17_YOK = new Set([
  'BankaListesiV2', 'BarkodListesiV2', 'CariHareketKaydetV2', 'FaturaListesiV2',
  'KasaListesiV2', 'KdvOzetV2', 'MizanV2', 'OdemePlanListesiV2',
  'SiparisListesiV2', 'StokHareketListesiV2',
]);

/** Drop-in for admin.firestore.FieldValue.serverTimestamp() — resolved by resolveSentinels. */
function pgServerTimestamp(): any {
  return pgPool ? { __op: 'serverTimestamp' } : admin.firestore.FieldValue.serverTimestamp();
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

// ── Mikro ERP tablo aynası (PostgreSQL) ──────────────────────────────────────
// Mikro'nun gerçek veritabanı tabloları (STOKLAR, CARI_HESAPLAR,
// CARI_HESAP_HAREKETLERI, STOK_HAREKETLERI, SIPARISLER, DEPOLAR, BANKALAR,
// KASALAR, MUHASEBE_FISLERI, ODEME_PLANLARI, ODEME_EMIRLERI,
// CARI_HESAP_ADRESLERI, CARI_PERSONEL_TANIMLARI, STOK_SATIS_FIYAT_LISTELERI)
// otantik kolon adlarıyla cetpa_db'de aynalanır. Alan adları
// apidocs.mikro.com.tr/tablo-alan-adlari/<tablo> ile uyumludur.
// Her tabloda `veri jsonb` ham Mikro kaydının tamamını saklar; tipli kolonlar
// sık sorgulanan alanlardır. Tüm Mikro sync endpoint'leri yazma/okuma sırasında
// bu tablolara da yazar (mirrorMikro* fonksiyonları — ana akışı asla bozmaz).

async function initMikroTables(): Promise<void> {
  if (!pgPool) return;
  const ddl = `
  CREATE TABLE IF NOT EXISTS mikro_stoklar (
    sto_kod text PRIMARY KEY,
    sto_isim text, sto_kisa_ismi text, sto_birim1_ad text,
    sto_grup_kodu text, sto_grup_isim text, sto_yer_kod text,
    sto_perakende_vergi numeric, sto_toptan_vergi numeric,
    sto_satis_fiyat1 numeric, sto_satis_fiyat2 numeric,
    sto_satis_fiyat3 numeric, sto_satis_fiyat4 numeric,
    sto_mevcut_mik numeric,
    veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_stok_satis_fiyat_listeleri (
    sfiyat_stokkod text NOT NULL,
    sfiyat_listesirano int NOT NULL,
    sfiyat_fiyati numeric, sfiyat_doviz int, sfiyat_birim_pntr int,
    veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sfiyat_stokkod, sfiyat_listesirano)
  );
  CREATE TABLE IF NOT EXISTS mikro_cari_hesaplar (
    cari_kod text PRIMARY KEY,
    cari_unvan1 text, cari_unvan2 text,
    cari_vdaire_no text, cari_vdaire_adi text,
    cari_email text, cari_ceptel text, cari_efatura_fl int,
    cari_baglanti_tipi int, cari_hareket_tipi int,
    veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_cari_hesap_adresleri (
    id bigserial PRIMARY KEY,
    adr_cari_kod text, adr_adres_no int,
    adr_cadde text, adr_ilce text, adr_il text, adr_ulke text,
    adr_tel_no1 text, adr_posta_kodu text,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_cari_personel_tanimlari (
    id bigserial PRIMARY KEY,
    mye_cari_kod text, mye_isim text, mye_soyisim text,
    mye_email_adres text, mye_cep_telno text,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_cari_hesap_hareketleri (
    id bigserial PRIMARY KEY,
    cha_guid text, cha_kod text, cha_evrak_tip int, cha_tip int, cha_cinsi int,
    cha_tarihi text, cha_meblag numeric, cha_aratoplam numeric, cha_vergi numeric,
    cha_aciklama text, cha_evrakno_seri text, cha_evrakno_sira text,
    cha_belge_no text, cha_ebelge_turu int,
    kaynak text,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE mikro_cari_hesap_hareketleri ADD COLUMN IF NOT EXISTS cha_kasa_hizkod text;
  ALTER TABLE mikro_cari_hesap_hareketleri ADD COLUMN IF NOT EXISTS cha_kasa_hizmet int;
  CREATE INDEX IF NOT EXISTS idx_mikro_cha_kod ON mikro_cari_hesap_hareketleri (cha_kod);
  CREATE TABLE IF NOT EXISTS mikro_stok_hareketleri (
    id bigserial PRIMARY KEY,
    sth_stok_kod text, sth_cari_kodu text, sth_tarih text,
    sth_miktar numeric, sth_tutar numeric, sth_vergi numeric,
    sth_evraktip int, sth_evrakno_seri text, sth_evrakno_sira text,
    kaynak text,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_mikro_sth_stok ON mikro_stok_hareketleri (sth_stok_kod);
  CREATE TABLE IF NOT EXISTS mikro_siparisler (
    id bigserial PRIMARY KEY,
    sip_tarih text, sip_tip text, sip_cins text, sip_evrakno_seri text,
    sip_musteri_kod text, sip_stok_kod text,
    sip_miktar numeric, sip_b_fiyat numeric, sip_tutar numeric,
    sip_vergi_pntr int, sip_depono int,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_irsaliyeler (
    id bigserial PRIMARY KEY,
    irs_tarih text, irs_tip int, irs_cins int, irs_evrakno_seri text,
    irs_musteri_kod text, irs_stok_kod text, irs_isim text,
    irs_miktar numeric, irs_birim_fiyat numeric, irs_tutar numeric,
    irs_kargo_firma text, irs_plaka text,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_muhasebe_fisleri (
    id bigserial PRIMARY KEY,
    fis_tarih text, fis_hesap_kod text, fis_aciklama1 text,
    fis_meblag0 numeric, fis_tic_belgeno text,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_depolar (
    dep_no text PRIMARY KEY,
    dep_adi text, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_bankalar (
    ban_kod text PRIMARY KEY,
    ban_ismi text, ban_hesap_no text,
    veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_kasalar (
    kas_kod text PRIMARY KEY,
    kas_isim text,
    veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_odeme_planlari (
    odp_no text PRIMARY KEY,
    odp_adi text,
    veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_odeme_emirleri (
    id bigserial PRIMARY KEY,
    sck_no text, sck_vade text, sck_tutar numeric, sck_borclu text,
    sck_banka_adi text, sck_tip int,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_tablo_eslesme (
    mikro_tablo text PRIMARY KEY,
    pg_tablo text NOT NULL,
    app_karsiligi text NOT NULL,
    alan_eslesme jsonb NOT NULL,
    aciklama text
  );`;
  await pgPool.query(ddl);

  const eslesmeler: Array<[string, string, string, Record<string, string>, string]> = [
    ['STOKLAR', 'mikro_stoklar', 'inventory (docs)', {
      sto_kod: 'sku / mikroStoKod', sto_isim: 'name', sto_birim1_ad: 'unit',
      sto_grup_isim: 'category', sto_perakende_vergi: 'vatRate',
      sto_mevcut_mik: 'stockLevel', sto_satis_fiyat1: "prices['Retail']",
      sto_satis_fiyat2: "prices['B2B Standard']", sto_satis_fiyat3: "prices['B2B Premium']",
      sto_satis_fiyat4: "prices['Dealer']", sto_yer_kod: 'warehouses (mikro-depo-<kod>)',
    }, 'StokListesiV2 import + StokKaydetV2 push + saatlik cron'],
    ['STOK_SATIS_FIYAT_LISTELERI', 'mikro_stok_satis_fiyat_listeleri', 'inventory.prices', {
      sfiyat_stokkod: 'sku', sfiyat_listesirano: '1=Retail 2=B2B Standard 3=B2B Premium 4=Dealer', sfiyat_fiyati: 'prices[tier]',
    }, 'Stok kartı satis_fiyatlari dizisinden'],
    ['CARI_HESAPLAR', 'mikro_cari_hesaplar', 'leads (docs)', {
      cari_kod: 'mikroCariKod', cari_unvan1: 'company/name', cari_vdaire_no: 'taxId',
      cari_vdaire_adi: 'taxOffice', cari_EMail: 'email', cari_CepTel: 'phone',
      cari_efatura_fl: 'eFaturaKayitli', cari_hareket_tipi: 'type (1=Supplier)',
    }, 'CariListesiV2 import + CariKaydetV2 push + saatlik cron'],
    ['CARI_HESAP_ADRESLERI', 'mikro_cari_hesap_adresleri', 'leads.address/city/district', {
      adr_cari_kod: 'mikroCariKod', adr_cadde: 'address', adr_il: 'city', adr_ilce: 'district',
    }, 'CariKaydetV2 push payload adresler[]'],
    ['CARI_PERSONEL_TANIMLARI', 'mikro_cari_personel_tanimlari', 'leads.contactName/email/phone', {
      mye_isim: 'contactName (ad)', mye_soyisim: 'contactName (soyad)', mye_email_adres: 'email', mye_cep_telno: 'phone',
    }, 'CariKaydetV2 push payload yetkili[]'],
    ['CARI_HESAP_HAREKETLERI', 'mikro_cari_hesap_hareketleri', 'mikroFaturalar (docs) + payments', {
      cha_Guid: 'mikroFaturalar doc id', cha_evrak_tip: '63=fatura 34=tahsilat/tediye',
      cha_tip: '0=satış/borç 1=alış/alacak', cha_meblag: 'amount', cha_kod: 'mikroCariKod',
    }, 'SqlVeriOkuV2 fatura çekimi + TahsilatTediyeKaydetV2 + CariHareketKaydetV2 + FaturaKaydetV2'],
    ['STOK_HAREKETLERI', 'mikro_stok_hareketleri', 'inventoryMovements / orders.lineItems', {
      sth_stok_kod: 'sku', sth_miktar: 'quantity', sth_tutar: 'total', sth_cari_kodu: 'mikroCariKod',
    }, 'FaturaKaydetV2 satırları (kaynak=fatura)'],
    ['SIPARISLER', 'mikro_siparisler', 'orders.lineItems', {
      sip_stok_kod: 'sku', sip_miktar: 'quantity', sip_b_fiyat: 'unitPrice',
      sip_tutar: 'total', sip_musteri_kod: 'order.mikroCariKod', sip_tarih: 'order.createdAt',
    }, 'SiparisKaydetV2 push'],
    ['IRSALIYELER (API)', 'mikro_stok_hareketleri', 'shipments', {
      sth_cari_kodu: 'shipment.mikroCariKod', sth_stok_kod: 'items[].sku',
      sth_miktar: 'items[].quantity', sth_evraktip: '1=irsaliye (kaynak=irsaliye_push)',
      eir_tasiyici_firma_kodu: 'cargoFirm', eir_tasiyici_arac_plaka: 'trackingNo',
    }, 'IrsaliyeKaydetV2 push — V17 doğrulandı: satırlar sth_*, STOK_HAREKETLERI (mikro_irsaliyeler tablosu kullanım dışı)'],
    ['MUHASEBE_FISLERI', 'mikro_muhasebe_fisleri', 'journalEntries (docs)', {
      fis_hesap_kod: 'debitHesap/alacakHesap', fis_meblag0: '+borc / -alacak',
      fis_tarih: 'date', fis_aciklama1: 'aciklama', fis_tic_belgeno: 'fisNo',
    }, 'MuhasebeFisKaydetV2 yevmiye push (çift satır)'],
    ['DEPOLAR', 'mikro_depolar', 'warehouses (docs, mikro-depo-<kod>)', {
      dep_no: 'sto_yer_kod', dep_adi: 'warehouse.name',
    }, 'Mikro depo listesi endpointi yok — sto_yer_kod alanından türetilir'],
    ['BANKALAR', 'mikro_bankalar', 'bankAccounts (docs)', {
      ban_kod: 'bankAccount.id', ban_ismi: 'bankName', ban_hesap_no: 'accountNo',
    }, 'Liste endpointi yok — SqlVeriOkuV2 açılınca doldurulur'],
    ['KASALAR', 'mikro_kasalar', 'kasalar (docs)', {
      kas_kod: 'kasa.id', kas_isim: 'kasa.name',
    }, 'Liste endpointi yok — SqlVeriOkuV2 açılınca doldurulur'],
    ['ODEME_PLANLARI', 'mikro_odeme_planlari', 'leads.paymentTerms', {
      odp_no: 'paymentTerms kodu', odp_adi: 'paymentTerms adı',
    }, 'Liste endpointi yok — SqlVeriOkuV2 açılınca doldurulur'],
    ['ODEME_EMIRLERI', 'mikro_odeme_emirleri', 'checks (docs, çek/senet)', {
      sck_no: 'checkNo', sck_vade: 'dueDate', sck_tutar: 'amount', sck_borclu: 'drawer', sck_banka_adi: 'bankName',
    }, 'Liste endpointi yok — SqlVeriOkuV2 açılınca doldurulur'],
  ];
  for (const [mikro, pgt, app, alanlar, aciklama] of eslesmeler) {
    await pgPool.query(
      `INSERT INTO mikro_tablo_eslesme (mikro_tablo, pg_tablo, app_karsiligi, alan_eslesme, aciklama)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (mikro_tablo) DO UPDATE SET pg_tablo = $2, app_karsiligi = $3, alan_eslesme = $4, aciklama = $5`,
      [mikro, pgt, app, JSON.stringify(alanlar), aciklama],
    );
  }
  console.log('Mikro tablo aynası hazır ✓ (15 tablo + eşleşme kaydı)');
}

const numOrNull = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number(v));
const strOrNull = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));

/** Hash-dedupe'lu genel ekleme — aynı ham kayıt iki kez yazılmaz (idempotent). */
async function mirrorMikroInsert(
  table: string,
  rows: Record<string, unknown>[],
  cols: Record<string, (r: Record<string, unknown>) => unknown>,
  client?: import('pg').PoolClient
): Promise<void> {
  if (!pgPool || !rows?.length) return;
  const dbClient = client || pgPool;
  try {
    for (const r of rows) {
      const veri = JSON.stringify(r);
      const hash = createHash('md5').update(table + veri).digest('hex');
      const names = Object.keys(cols);
      const vals = names.map(n => cols[n](r));
      await dbClient.query(
        `INSERT INTO ${table} (${names.join(', ')}, veri, veri_hash)
         VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}, $${names.length + 1}, $${names.length + 2})
         ON CONFLICT (veri_hash) DO NOTHING`,
        [...vals, veri, hash],
      );
    }
  } catch (e) {
    console.warn(`[mikroMirror:${table}]`, (e as Error).message);
    if (client) throw e; // Reraise in transactions
  }
}

/** STOKLAR + STOK_SATIS_FIYAT_LISTELERI + DEPOLAR aynası (sto_kod upsert). */
async function mirrorMikroStoklar(rows: Record<string, unknown>[]): Promise<void> {
  if (!pgPool || !rows?.length) return;
  try {
    for (const s of rows) {
      const kod = strOrNull(s.sto_kod)?.trim();
      if (!kod) continue;
      await pgPool.query(
        `INSERT INTO mikro_stoklar (sto_kod, sto_isim, sto_kisa_ismi, sto_birim1_ad, sto_grup_kodu, sto_grup_isim,
           sto_yer_kod, sto_perakende_vergi, sto_toptan_vergi, sto_satis_fiyat1, sto_satis_fiyat2, sto_satis_fiyat3,
           sto_satis_fiyat4, sto_mevcut_mik, veri)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (sto_kod) DO UPDATE SET
           sto_isim = EXCLUDED.sto_isim, sto_kisa_ismi = EXCLUDED.sto_kisa_ismi,
           sto_birim1_ad = EXCLUDED.sto_birim1_ad, sto_grup_kodu = EXCLUDED.sto_grup_kodu,
           sto_grup_isim = EXCLUDED.sto_grup_isim, sto_yer_kod = EXCLUDED.sto_yer_kod,
           sto_perakende_vergi = EXCLUDED.sto_perakende_vergi, sto_toptan_vergi = EXCLUDED.sto_toptan_vergi,
           sto_satis_fiyat1 = COALESCE(EXCLUDED.sto_satis_fiyat1, mikro_stoklar.sto_satis_fiyat1),
           sto_satis_fiyat2 = COALESCE(EXCLUDED.sto_satis_fiyat2, mikro_stoklar.sto_satis_fiyat2),
           sto_satis_fiyat3 = COALESCE(EXCLUDED.sto_satis_fiyat3, mikro_stoklar.sto_satis_fiyat3),
           sto_satis_fiyat4 = COALESCE(EXCLUDED.sto_satis_fiyat4, mikro_stoklar.sto_satis_fiyat4),
           sto_mevcut_mik = COALESCE(EXCLUDED.sto_mevcut_mik, mikro_stoklar.sto_mevcut_mik),
           veri = EXCLUDED.veri, guncelleme = now()`,
        [kod, strOrNull(s.sto_isim), strOrNull(s.sto_kisa_ismi), strOrNull(s.sto_birim1_ad),
         strOrNull(s.sto_grup_kodu), strOrNull(s.sto_grup_isim), strOrNull(s.sto_yer_kod),
         numOrNull(s.sto_perakende_vergi), numOrNull(s.sto_toptan_vergi),
         numOrNull(s.sto_satis_fiyat1), numOrNull(s.sto_satis_fiyat2),
         numOrNull(s.sto_satis_fiyat3), numOrNull(s.sto_satis_fiyat4),
         numOrNull(s.sto_mevcut_mik ?? s.toplam_miktar), JSON.stringify(s)],
      );
      const fiyatlar = (s.satis_fiyatlari as Record<string, unknown>[]) || [];
      for (const f of fiyatlar) {
        const sira = numOrNull(f.sfiyat_listesirano);
        if (sira === null) continue;
        await pgPool.query(
          `INSERT INTO mikro_stok_satis_fiyat_listeleri (sfiyat_stokkod, sfiyat_listesirano, sfiyat_fiyati, sfiyat_doviz, sfiyat_birim_pntr, veri)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (sfiyat_stokkod, sfiyat_listesirano) DO UPDATE SET
             sfiyat_fiyati = EXCLUDED.sfiyat_fiyati, sfiyat_doviz = EXCLUDED.sfiyat_doviz,
             sfiyat_birim_pntr = EXCLUDED.sfiyat_birim_pntr, veri = EXCLUDED.veri, guncelleme = now()`,
          [kod, sira, numOrNull(f.sfiyat_fiyati), numOrNull(f.sfiyat_doviz), numOrNull(f.sfiyat_birim_pntr), JSON.stringify(f)],
        );
      }
      const yerKod = strOrNull(s.sto_yer_kod)?.trim();
      if (yerKod) {
        await pgPool.query(
          `INSERT INTO mikro_depolar (dep_no, dep_adi) VALUES ($1, $2) ON CONFLICT (dep_no) DO NOTHING`,
          [yerKod, `Depo ${yerKod}`],
        );
      }
    }
  } catch (e) { console.warn('[mikroMirror:stoklar]', (e as Error).message); }
}

/** CARI_HESAPLAR (+adresler, +yetkili) aynası (cari_kod upsert). */
async function mirrorMikroCariler(rows: Record<string, unknown>[]): Promise<void> {
  if (!pgPool || !rows?.length) return;
  try {
    for (const c of rows) {
      const kod = strOrNull(c.cari_kod)?.trim();
      if (!kod) continue;
      await pgPool.query(
        `INSERT INTO mikro_cari_hesaplar (cari_kod, cari_unvan1, cari_unvan2, cari_vdaire_no, cari_vdaire_adi,
           cari_email, cari_ceptel, cari_efatura_fl, cari_baglanti_tipi, cari_hareket_tipi, veri)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (cari_kod) DO UPDATE SET
           cari_unvan1 = EXCLUDED.cari_unvan1, cari_unvan2 = EXCLUDED.cari_unvan2,
           cari_vdaire_no = EXCLUDED.cari_vdaire_no, cari_vdaire_adi = EXCLUDED.cari_vdaire_adi,
           cari_email = COALESCE(NULLIF(EXCLUDED.cari_email, ''), mikro_cari_hesaplar.cari_email),
           cari_ceptel = COALESCE(NULLIF(EXCLUDED.cari_ceptel, ''), mikro_cari_hesaplar.cari_ceptel),
           cari_efatura_fl = EXCLUDED.cari_efatura_fl,
           cari_baglanti_tipi = COALESCE(EXCLUDED.cari_baglanti_tipi, mikro_cari_hesaplar.cari_baglanti_tipi),
           cari_hareket_tipi = COALESCE(EXCLUDED.cari_hareket_tipi, mikro_cari_hesaplar.cari_hareket_tipi),
           veri = EXCLUDED.veri, guncelleme = now()`,
        [kod, strOrNull(c.cari_unvan1), strOrNull(c.cari_unvan2), strOrNull(c.cari_vdaire_no),
         strOrNull(c.cari_vdaire_adi), strOrNull(c.cari_EMail ?? c.cari_email),
         strOrNull(c.cari_CepTel ?? c.cari_ceptel), numOrNull(c.cari_efatura_fl),
         numOrNull(c.cari_baglanti_tipi), numOrNull(c.cari_hareket_tipi), JSON.stringify(c)],
      );
      const adresler = (c.adresler as Record<string, unknown>[]) || [];
      await mirrorMikroInsert('mikro_cari_hesap_adresleri', adresler.map(a => ({ ...a, adr_cari_kod: kod })), {
        adr_cari_kod: r => r.adr_cari_kod,
        adr_adres_no: r => numOrNull(r.adr_adres_no),
        adr_cadde: r => strOrNull(r.adr_cadde),
        adr_ilce: r => strOrNull(r.adr_ilce),
        adr_il: r => strOrNull(r.adr_il),
        adr_ulke: r => strOrNull(r.adr_ulke),
        adr_tel_no1: r => strOrNull(r.adr_tel_no1),
        adr_posta_kodu: r => strOrNull(r.adr_posta_kodu),
      });
      const yetkili = (c.yetkili as Record<string, unknown>[]) || [];
      await mirrorMikroInsert('mikro_cari_personel_tanimlari', yetkili.map(y => ({ ...y, mye_cari_kod: kod })), {
        mye_cari_kod: r => r.mye_cari_kod,
        mye_isim: r => strOrNull(r.mye_isim),
        mye_soyisim: r => strOrNull(r.mye_soyisim),
        mye_email_adres: r => strOrNull(r.mye_email_adres),
        mye_cep_telno: r => strOrNull(r.mye_cep_telno),
      });
    }
  } catch (e) { console.warn('[mikroMirror:cariler]', (e as Error).message); }
}

const CHA_COLS: Record<string, (r: Record<string, unknown>) => unknown> = {
  cha_guid: r => strOrNull(r.cha_Guid ?? r.cha_guid),
  cha_kod: r => strOrNull(r.cha_kod),
  cha_evrak_tip: r => numOrNull(r.cha_evrak_tip),
  cha_tip: r => numOrNull(r.cha_tip),
  cha_cinsi: r => numOrNull(r.cha_cinsi),
  cha_tarihi: r => strOrNull(r.cha_tarihi),
  cha_meblag: r => numOrNull(r.cha_meblag),
  cha_aratoplam: r => numOrNull(r.cha_aratoplam),
  cha_aciklama: r => strOrNull(r.cha_aciklama),
  cha_evrakno_seri: r => strOrNull(r.cha_evrakno_seri),
  cha_evrakno_sira: r => strOrNull(r.cha_evrakno_sira),
  cha_belge_no: r => strOrNull(r.cha_belge_no),
  cha_ebelge_turu: r => numOrNull(r.cha_ebelge_turu),
  cha_kasa_hizkod: r => strOrNull(r.cha_kasa_hizkod),
  cha_kasa_hizmet: r => numOrNull(r.cha_kasa_hizmet),
  kaynak: r => strOrNull(r.__kaynak ?? 'mikro'),
};

const SIP_COLS: Record<string, (r: Record<string, unknown>) => unknown> = {
  sip_tarih: r => strOrNull(r.sip_tarih),
  sip_tip: r => strOrNull(r.sip_tip),
  sip_cins: r => strOrNull(r.sip_cins),
  sip_evrakno_seri: r => strOrNull(r.sip_evrakno_seri),
  sip_musteri_kod: r => strOrNull(r.sip_musteri_kod),
  sip_stok_kod: r => strOrNull(r.sip_stok_kod),
  sip_miktar: r => numOrNull(r.sip_miktar),
  sip_b_fiyat: r => numOrNull(r.sip_b_fiyat),
  sip_tutar: r => numOrNull(r.sip_tutar),
  sip_vergi_pntr: r => numOrNull(r.sip_vergi_pntr),
  sip_depono: r => numOrNull(r.sip_depono),
};

const IRS_COLS: Record<string, (r: Record<string, unknown>) => unknown> = {
  irs_tarih: r => strOrNull(r.irs_tarih),
  irs_tip: r => numOrNull(r.irs_tip),
  irs_cins: r => numOrNull(r.irs_cins),
  irs_evrakno_seri: r => strOrNull(r.irs_evrakno_seri),
  irs_musteri_kod: r => strOrNull(r.irs_musteri_kod),
  irs_stok_kod: r => strOrNull(r.irs_stok_kod),
  irs_isim: r => strOrNull(r.irs_isim),
  irs_miktar: r => numOrNull(r.irs_miktar),
  irs_birim_fiyat: r => numOrNull(r.irs_birim_fiyat),
  irs_tutar: r => numOrNull(r.irs_tutar),
  irs_kargo_firma: r => strOrNull(r.irs_kargo_firma),
  irs_plaka: r => strOrNull(r.irs_plaka),
};

const STH_COLS: Record<string, (r: Record<string, unknown>) => unknown> = {
  sth_stok_kod: r => strOrNull(r.sth_stok_kod ?? r.fat_stok_kod),
  sth_cari_kodu: r => strOrNull(r.sth_cari_kodu ?? r.fat_musteri_kod),
  sth_tarih: r => strOrNull(r.sth_tarih ?? r.fat_tarih),
  sth_miktar: r => numOrNull(r.sth_miktar ?? r.fat_miktar),
  sth_tutar: r => numOrNull(r.sth_tutar ?? r.fat_tutar),
  sth_vergi: r => numOrNull(r.sth_vergi),
  sth_evraktip: r => numOrNull(r.sth_evraktip),
  sth_evrakno_seri: r => strOrNull(r.sth_evrakno_seri ?? r.fat_evrakno_seri),
  sth_evrakno_sira: r => strOrNull(r.sth_evrakno_sira),
  kaynak: r => strOrNull(r.__kaynak ?? 'mikro'),
};

const FIS_COLS: Record<string, (r: Record<string, unknown>) => unknown> = {
  fis_tarih: r => strOrNull(r.fis_tarih),
  fis_hesap_kod: r => strOrNull(r.fis_hesap_kod),
  fis_aciklama1: r => strOrNull(r.fis_aciklama1),
  fis_meblag0: r => numOrNull(r.fis_meblag0),
  fis_tic_belgeno: r => strOrNull(r.fis_tic_belgeno),
};


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
const MIKRO_AUTH_URL = 'https://onlinekullanici.mikro.com.tr/auth/realms/Mikro/protocol/openid-connect/token';
const MIKRO_API_BASE = process.env.MIKRO_API_URL || 'http://localhost:8094/Api/APIMethods';
const MIKRO_LOCAL_MODE = process.env.MIKRO_LOCAL != null
  ? process.env.MIKRO_LOCAL === '1'
  : /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(MIKRO_API_BASE);
console.log(`Mikro API: ${MIKRO_API_BASE} (${MIKRO_LOCAL_MODE ? 'LOKAL mod — token yok' : 'BULUT mod — OIDC token'})`);
if (!MIKRO_LOCAL_MODE && !/:\d+/.test(MIKRO_API_BASE)) {
  console.warn('⚠️  MIKRO_API_URL portsuz ve bulut host — Cloudflare önyüzü 403 döndürebilir.');
}

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
  //    LOKAL modda IDM e-posta/şifre, ApiKey ve Alias GEREKMEZ (API bunları
  //    kullanmıyor) — yalnız KullaniciKodu + Sifre yeterli. Bulut modunda
  //    eski (tam) koşul aynen geçerli.
  //    LOKAL modda ZORUNLU ALAN YOK: KullaniciKodu 'SRV', FirmaKodu '01',
  //    CalismaYili içinde bulunulan yıl varsayılır ve **Mikro API kullanıcısının
  //    şifresi BOŞ olabilir** (SRV'de şifre tanımsız — sadece giriş). Boş şifre
  //    geçerli bir günlük hash üretir: MD5("YYYY-AA-GG " + ""). Bu yüzden lokal
  //    modda MIKRO_API_URL'in lokali göstermesi "yapılandırılmış" saymak için yeterli.
  const envReady = MIKRO_LOCAL_MODE
    ? true
    : !!(process.env.MIKRO_IDM_EMAIL && process.env.MIKRO_IDM_PASSWORD &&
         process.env.MIKRO_API_KEY && process.env.MIKRO_ALIAS);
  if (envReady) {
    return {
      idmEmail:      process.env.MIKRO_IDM_EMAIL      || '',
      idmPassword:   process.env.MIKRO_IDM_PASSWORD   || '',
      alias:         process.env.MIKRO_ALIAS          || '',
      firmaKodu:     process.env.MIKRO_FIRMA_KODU     || '01',
      calismaYili:   process.env.MIKRO_CALISMA_YILI   || String(new Date().getFullYear()),
      apiKey:        process.env.MIKRO_API_KEY       || '',
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

    // Minimum zorunlu alanlar moda göre: lokalde Sifre yeterli (Alias/IDM
    // kullanılmıyor), bulutta idmPassword + alias şart.
    if (MIKRO_LOCAL_MODE ? !d.sifre : (!idmPassword || !alias)) return null;

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

// ═══ Operasyon Bekçisi: günlük cron — gece yedeği ve cron çıktılarını denetler ═══
// Amaç: sessiz arızayı (yedek görevinin hiç koşmaması, Mikro sync'in stockLevel
// yazmadan dönmesi gibi) restore/rapor gününde değil ertesi sabah yakalamak.
// Sonuç opsChecks/<YYYY-MM-DD> dokümanına yazılır (global, tenant-dışı) ve
// süper-admin panelindeki karttan + GET /api/ops/watchdog'dan okunur.
const OPS_STORAGE_BUCKET = 'gen-lang-client-0628151245.firebasestorage.app';
interface OpsCheckResult { key: string; ok: boolean; detail: string }

function opsToMs(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : 0; }
  if (typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) return Number((v as Record<string, unknown>).seconds) * 1000;
  return 0;
}

async function runOpsWatchdog(): Promise<{ date: string; ok: boolean; checks: OpsCheckResult[]; stockRatio: number | null }> {
  const checks: OpsCheckResult[] = [];
  const add = (key: string, ok: boolean, detail: string) => { checks.push({ key, ok, detail }); };
  const hoursAgo = (t: number) => (Date.now() - t) / 3_600_000;

  // 1) Offsite yedek tazeliği — dün geceki yedek Firebase Storage'a düşmüş mü?
  for (const [key, prefix, minBytes] of [
    ['backup_db', 'db-backups/', 10_000],
    ['backup_uploads', 'uploads-backups/', 200],
  ] as const) {
    try {
      const [files] = await admin.storage().bucket(OPS_STORAGE_BUCKET).getFiles({ prefix });
      let newest: { name: string; updated: number; size: number } | null = null;
      for (const f of files) {
        const updated = opsToMs(f.metadata.updated || f.metadata.timeCreated);
        if (!newest || updated > newest.updated) newest = { name: f.name, updated, size: Number(f.metadata.size) || 0 };
      }
      if (!newest) { add(key, false, `${prefix} altında hiç dosya yok — yedek görevi hiç koşmamış olabilir`); continue; }
      const age = hoursAgo(newest.updated);
      add(key, age < 26 && newest.size >= minBytes,
        `${newest.name} — ${age.toFixed(1)} saat önce, ${(newest.size / 1024).toFixed(0)} KB`);
    } catch (e) {
      add(key, false, 'Storage listelenemedi: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  // 2) Mikro ayna tazeliği — saatlik sync mikro_stoklar.guncelleme'yi ilerletiyor mu?
  //    (Yaşanan arıza sınıfı: cron haftalarca "başarıyla" koşup veri yazmamıştı.)
  try {
    const creds = await getMikroCreds();
    if (!creds) add('mikro_sync', true, 'Mikro yapılandırılmamış, atlandı');
    else if (!pgPool) add('mikro_sync', false, 'pgPool yok');
    else {
      const { rows } = await pgPool.query('SELECT max(guncelleme) AS g, count(*)::int AS n FROM mikro_stoklar');
      const g = rows[0]?.g ? new Date(rows[0].g).getTime() : 0;
      if (!g) add('mikro_sync', false, 'mikro_stoklar boş — sync hiç yazmamış');
      else add('mikro_sync', hoursAgo(g) < 26, `${rows[0].n} kayıt, son güncelleme ${hoursAgo(g).toFixed(1)} saat önce`);
    }
  } catch (e) { add('mikro_sync', false, e instanceof Error ? e.message : String(e)); }

  // 3) Stok oranı çöküşü — stoklu ürün oranı bir gecede >30 puan düşerse alarm
  //    (2.347 ürünün "kritik stok" göründüğü stockLevel arızasının imzası).
  let stockRatio: number | null = null;
  try {
    if (!adminDb) add('stock_ratio', false, 'adminDb yok');
    else {
      const snap = await adminDb.collection('inventory').get();
      const total = snap.docs.length;
      if (total === 0) add('stock_ratio', true, 'envanter boş, atlandı');
      else {
        const withStock = snap.docs.filter(d => Number((d.data() as Record<string, unknown>).stockLevel) > 0).length;
        stockRatio = withStock / total;
        const yd = new Date(Date.now() - 86_400_000);
        const ydStr = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, '0')}-${String(yd.getDate()).padStart(2, '0')}`;
        const prev = await adminDb.collection('opsChecks').doc(ydStr).get();
        const prevRatio = prev.exists ? Number((prev.data() as Record<string, unknown>).stockRatio) : NaN;
        const drop = Number.isFinite(prevRatio) ? prevRatio - stockRatio : 0;
        add('stock_ratio', drop <= 0.3,
          `stoklu ürün %${(stockRatio * 100).toFixed(0)} (${withStock}/${total})` +
          (Number.isFinite(prevRatio) ? `, dün %${(prevRatio * 100).toFixed(0)}` : ', dünkü veri yok'));
      }
    }
  } catch (e) { add('stock_ratio', false, e instanceof Error ? e.message : String(e)); }

  // 4) Mikro retry kuyruğu — işlemci yalnız bir kullanıcı login'ken çalışır;
  //    24 saatten eski queued iş = kuyruk tıkalı, ölü iş birikimi = temizlik gerek.
  try {
    if (!adminDb) add('retry_queue', false, 'adminDb yok');
    else {
      const snap = await adminDb.collection('syncJobs').get();
      let queued = 0, dead = 0, stuck = 0;
      for (const d of snap.docs) {
        const j = d.data() as Record<string, unknown>;
        if (j.status === 'dead') dead++;
        else if (j.status === 'queued' || j.status === 'in-progress') {
          queued++;
          const created = opsToMs(j.createdAt);
          if (created && hoursAgo(created) > 24) stuck++;
        }
      }
      add('retry_queue', stuck === 0 && dead <= 10, `bekleyen ${queued} (24s+ takılı ${stuck}), ölü ${dead}`);
    }
  } catch (e) { add('retry_queue', false, e instanceof Error ? e.message : String(e)); }

  // 5) Kur tazeliği — 30 dakikalık kur cron'u bellek önbelleğini ilerletiyor mu?
  if (!cachedExchangeRates) add('exchange_rates', false, 'bellekte kur yok');
  else {
    const age = hoursAgo(opsToMs(cachedExchangeRates.updatedAt));
    add('exchange_rates', age < 2, `USD ${cachedExchangeRates.rates.USD ?? '?'} (${cachedExchangeRates.source}, ${age.toFixed(1)} saat önce)`);
  }

  // 6) Bant genişliği self-testi — 2026-07-20 arızası: sunucunun TÜM ağ hattı
  //    ~40 KB/sn'ye düştü (sağlayıcı tarafı), uygulama bundle indiremediği için
  //    boot edemedi; küçük /api/health yanıtları ise "sağlıklı" göründü. Bu test
  //    gerçek veri akıtarak ölçer: Cloudflare'den 5 MB indir (8 sn bütçe) +
  //    1 MB yükle. Kendi signal'ımızı verdiğimiz için 30 sn'lik global fetch
  //    timeout'una takılmayız.
  try {
    const dlKBs = await (async () => {
      const ctrl = new AbortController();
      const t0 = Date.now();
      let bytes = 0;
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch('https://speed.cloudflare.com/__down?bytes=5000000', { signal: ctrl.signal });
        const reader = res.body?.getReader();
        if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value?.length ?? 0; }
      } catch { /* abort = 8 sn'lik ölçüm penceresi doldu; sayılan bayt yeterli */ }
      clearTimeout(timer);
      return bytes / Math.max(0.3, (Date.now() - t0) / 1000) / 1024;
    })();
    const upKBs = await (async () => {
      const t0 = Date.now();
      try {
        const res = await fetch('https://speed.cloudflare.com/__up', { method: 'POST', body: new Uint8Array(1_000_000), signal: AbortSignal.timeout(15000) });
        if (!res.ok) return -1; // uç arızası (4xx/5xx) — ağ sinyali değil, ölçümü atla
        void res.arrayBuffer().catch(() => {});
        return 1_000_000 / Math.max(0.2, (Date.now() - t0) / 1000) / 1024;
      } catch { return 0; } // timeout/bağlantı hatası = gerçek yavaşlık sinyali
    })();
    const fmt = (k: number) => k >= 1024 ? `${(k / 1024).toFixed(1)} MB/sn` : `${k.toFixed(0)} KB/sn`;
    add('bandwidth', dlKBs >= 512 && (upKBs === -1 || upKBs >= 256),
      `indirme ${fmt(dlKBs)}, ` + (upKBs === -1 ? 'yükleme ölçülemedi (uç hatası)' : `yükleme ${fmt(upKBs)}`) +
      ' — eşik ↓512/↑256 KB/sn; düşükse sağlayıcı (ODEA) hat sorunu olabilir');
  } catch (e) { add('bandwidth', false, e instanceof Error ? e.message : String(e)); }

  // 7) Gemini AI sağlığı — 2026-07-20 arızası: Google eski modellerin free-tier
  //    kotasını sıfırladı, her AI çağrısı 429 dönüyordu ama kimse fark etmedi
  //    ("Üzgünüm, şu an yanıt veremiyorum"). Günde 1 mini çağrıyla anahtar +
  //    model + kota üçünü birden doğrula. (Probe startServer'da kurulur.)
  try {
    if (!aiHealthProbe) add('ai_gemini', true, 'AI probe hazır değil, atlandı');
    else { const r = await aiHealthProbe(); add('ai_gemini', r.ok, r.detail); }
  } catch (e) { add('ai_gemini', false, e instanceof Error ? e.message : String(e)); }

  // 8) SSL sertifika — kamuya SUNULAN sertifikanın kalan ömrü + host eşleşmesi.
  //    (Geçmiş arıza: Plesk default *.plesk.page sertifikası sunarken yeşil CI
  //    bunu haftalarca maskeledi.) rejectUnauthorized:false bilinçli — bozuk/
  //    uymayan sertifikayı hata yerine BULGU olarak raporlamak istiyoruz.
  try {
    const host = 'app.cetpa.com.tr';
    const cert = await new Promise<{ valid_to?: string; subject?: { CN?: string }; subjectaltname?: string }>((resolve, reject) => {
      const sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 8000 }, () => {
        const c = sock.getPeerCertificate();
        sock.end();
        resolve(c as never);
      });
      sock.on('error', reject);
      sock.on('timeout', () => { sock.destroy(); reject(new Error('TLS bağlantı zaman aşımı')); });
    });
    const days = cert.valid_to ? (new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000 : 0;
    const cn = cert.subject?.CN ?? '';
    const san = cert.subjectaltname ?? '';
    const hostMatch = san.includes(host) || cn === host || san.includes('*.cetpa.com.tr') || cn === '*.cetpa.com.tr';
    add('ssl_cert', days > 14 && hostMatch,
      `${cn || 'CN?'} — ${days.toFixed(0)} gün kaldı` +
      (hostMatch ? '' : ` — SERTİFİKA ${host} İLE UYUŞMUYOR (Plesk default cert olabilir)`));
  } catch (e) { add('ssl_cert', false, 'TLS bağlantısı kurulamadı: ' + (e instanceof Error ? e.message : String(e))); }

  // 9) Disk doluluğu — yedekler (C:\cetpa\backups) + WAL + loglar birikirse
  //    PG yazamaz hale gelir; %8 veya 10 GB altı = müdahale zamanı.
  try {
    const st = await fs.promises.statfs(process.cwd());
    const totalGB = (Number(st.blocks) * Number(st.bsize)) / 1024 ** 3;
    const freeGB = (Number(st.bavail) * Number(st.bsize)) / 1024 ** 3;
    const freePct = totalGB > 0 ? (freeGB / totalGB) * 100 : 0;
    add('disk_space', freeGB > 10 && freePct > 8,
      `boş ${freeGB.toFixed(1)} GB / ${totalGB.toFixed(0)} GB (%${freePct.toFixed(0)}) — eşik: >10 GB ve >%8`);
  } catch (e) { add('disk_space', false, 'statfs başarısız: ' + (e instanceof Error ? e.message : String(e))); }

  // 10) Client hata birikimi — son 24 saatte anormal frontend hatası =
  //     kullanıcıların yaşadığı ama bildirmediği kırıklık sinyali.
  try {
    if (!pgPool) add('client_errors', true, 'pgPool yok, atlandı');
    else {
      const { rows } = await pgPool.query(
        "SELECT count(*)::int AS n FROM docs WHERE coll = 'clientErrors' AND updated_at > now() - interval '24 hours'");
      const n = rows[0]?.n ?? 0;
      add('client_errors', n <= 50, `son 24 saatte ${n} client hatası (eşik ≤50)`);
    }
  } catch (e) { add('client_errors', false, e instanceof Error ? e.message : String(e)); }

  // 11) Veritabanı büyüme anomalisi — docs satır sayısı bir günde 2×+ VE
  //     10k+ artarsa kaçak yazan döngü/sync var demektir (dünkü değer
  //     opsChecks'ten; stock_ratio ile aynı desen).
  let docsCount: number | null = null;
  try {
    if (!pgPool) add('pg_growth', true, 'pgPool yok, atlandı');
    else {
      const { rows } = await pgPool.query("SELECT count(*)::int AS n, pg_total_relation_size('docs') AS b FROM docs");
      docsCount = rows[0]?.n ?? 0;
      const mb = Number(rows[0]?.b ?? 0) / 1024 ** 2;
      const yd2 = new Date(Date.now() - 86_400_000);
      const yd2Str = `${yd2.getFullYear()}-${String(yd2.getMonth() + 1).padStart(2, '0')}-${String(yd2.getDate()).padStart(2, '0')}`;
      const prev = adminDb ? await adminDb.collection('opsChecks').doc(yd2Str).get() : null;
      const prevCount = prev?.exists ? Number((prev.data() as Record<string, unknown>).docsCount) : NaN;
      const anomaly = Number.isFinite(prevCount) && prevCount > 0 && (docsCount ?? 0) > prevCount * 2 && (docsCount ?? 0) - prevCount > 10_000;
      add('pg_growth', !anomaly,
        `${docsCount} satır, ${mb.toFixed(0)} MB` +
        (Number.isFinite(prevCount) ? `, dün ${prevCount} satır` : ', dünkü veri yok (yarından itibaren kıyaslanır)'));
    }
  } catch (e) { add('pg_growth', false, e instanceof Error ? e.message : String(e)); }

  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ok = checks.every(c => c.ok);
  try {
    if (adminDb) await adminDb.collection('opsChecks').doc(date).set({ date, ok, checks, stockRatio, docsCount, ranAt: pgServerTimestamp() });
  } catch (e) { console.warn('opsChecks yazılamadı:', e instanceof Error ? e.message : String(e)); }
  console.log(`Ops watchdog: ${ok ? 'PASS' : 'FAIL'} — ${checks.map(c => `${c.ok ? '+' : '!'}${c.key}`).join(' ')}`);
  return { date, ok, checks, stockRatio };
}
// Her sabah 08:30 (sunucu saati) — gece yedeği ve gece cron'ları bittikten sonra.
cron.schedule('30 8 * * *', () => { void runOpsWatchdogAndAlert(); });

/** ── Disk nöbetçisi: SAATLİK, PostgreSQL'e BAĞIMSIZ ──────────────────────────
 *
 *  Neden ayrı: 2026-07-31'de disk %100 doldu (sistem-yönetimli sayfa dosyası
 *  şişti) ve uygulama tamamen yanıt veremez oldu. Bekçi'nin `disk_space`
 *  kontrolü doğru yazılmıştı ama HABER VEREMEDİ:
 *    - günde bir kez (08:30) koşuyor — saatler içinde dolan diski kaçırır
 *    - sonucu opsChecks'e PostgreSQL üzerinden yazıyor; disk dolunca PG de
 *      yanıt vermiyordu, yani izleme tam da izlediği şey bozulunca bozuluyordu
 *
 *  Bu nöbetçi hiçbir şey yazmaz, sadece doğrudan e-posta atar. İki eşik:
 *  uyarı (<%15) ve kritik (<%8). Aynı seviye için 6 saatte bir kez postalar —
 *  disk dolu kaldığı sürece dakikada bir posta atmasın.
 */
let diskUyariSon: { seviye: string; t: number } | null = null;

async function diskNobetcisi(zorla = false): Promise<{ freeGB: number; totalGB: number; freePct: number; seviye: string; postaDenendi: boolean; hata?: string }> {
  const bos = { freeGB: 0, totalGB: 0, freePct: 0, seviye: 'BILINMIYOR', postaDenendi: false };
  try {
    const st = await fs.promises.statfs(process.platform === 'win32' ? 'C:\\' : '/');
    const totalGB = (st.blocks * st.bsize) / 1e9;
    const freeGB  = (st.bavail * st.bsize) / 1e9;
    const freePct = totalGB > 0 ? (freeGB / totalGB) * 100 : 0;

    const gercekSeviye = freePct < 8 ? 'KRITIK' : freePct < 15 ? 'UYARI' : 'OK';
    const seviye = zorla ? 'TEST' : gercekSeviye;
    if (!zorla && gercekSeviye === 'OK') { diskUyariSon = null; return { freeGB, totalGB, freePct, seviye: gercekSeviye, postaDenendi: false }; }

    // Aynı seviyeyi 6 saatte bir kez bildir. (zorla=true bunu atlar — test yolu)
    const simdi = Date.now();
    if (!zorla && diskUyariSon && diskUyariSon.seviye === seviye && simdi - diskUyariSon.t < 6 * 3600_000) {
      return { freeGB, totalGB, freePct, seviye, postaDenendi: false };
    }
    if (!zorla) diskUyariSon = { seviye, t: simdi };

    const mesaj = `Disk ${seviye}: boş ${freeGB.toFixed(1)} GB / ${totalGB.toFixed(0)} GB (%${freePct.toFixed(1)})`;
    console.error('[disk-nobetcisi]', mesaj);

    const resendKey = process.env.RESEND_API_KEY;
    const recipient = process.env.OPS_ALERT_EMAIL || process.env.REPORT_RECIPIENT_EMAIL;
    if (!resendKey || !recipient) {
      return { freeGB, totalGB, freePct, seviye, postaDenendi: false,
               hata: `posta yolu yok (RESEND_API_KEY=${resendKey ? 'var' : 'YOK'}, alıcı=${recipient ? 'var' : 'YOK'})` };
    }

    const postaRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'rapor@cetpa.com.tr',
        to: [recipient],
        subject: zorla
          ? '✅ CETPA disk uyarı TESTİ — bu posta geldiyse uyarı yolu çalışıyor'
          : `${seviye === 'KRITIK' ? '🔴' : '⚠️'} CETPA sunucu diski: %${freePct.toFixed(0)} boş`,
        html: `<div style="font-family:-apple-system,Segoe UI,sans-serif">
          ${zorla ? '<p style="background:#e8f5e9;padding:8px 12px;border-radius:8px;color:#1b5e20"><b>Bu bir TESTTİR.</b> Elle tetiklendi; disk durumu normal olabilir. Bu postayı aldıysanız uyarı yolu çalışıyor demektir.</p>' : ''}
          <h2 style="margin:0 0 8px">Sunucu disk durumu</h2>
          <p style="font-size:15px"><b>${mesaj}</b></p>
          <p style="color:#555;font-size:13px">Disk dolduğunda PostgreSQL yazamaz ve uygulama tamamen durur
          (2026-07-31'de yaşandı). Bakılacaklar: <code>C:\\cetpa\\logs</code> boyutu,
          <code>pagefile.sys</code>, yedek klasörleri.</p>
          <p style="font-size:11px;color:#888">Saatlik otomatik kontrol. AI kullanılmaz.</p>
        </div>`,
      }),
    });
    // Resend YANITINI OKU. Sadece fetch'in patlamamasına bakmak, gönderilmemiş
    // postayı "gönderildi" saymaktır — doğrulanmamış alan adında Resend 403
    // döner ve eskiden bunu göremiyorduk (2026-07-31 testinde yakalandı).
    if (!postaRes.ok) {
      const govde = await postaRes.text().catch(() => '');
      const hata = `Resend HTTP ${postaRes.status}: ${govde.slice(0, 300)}`;
      console.error('[disk-nobetcisi] posta REDDEDİLDİ —', hata);
      return { freeGB, totalGB, freePct, seviye, postaDenendi: false, hata };
    }
    return { freeGB, totalGB, freePct, seviye, postaDenendi: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[disk-nobetcisi] çalışamadı:', msg);
    return { ...bos, postaDenendi: false, hata: msg };
  }
}

// Saatte bir — Bekçi'den bağımsız, PostgreSQL gerektirmez.
cron.schedule('7 * * * *', () => { void diskNobetcisi(); });
// Açılışta bir kez: sunucu dolu diskle ayağa kalkmışsa hemen haber ver.
setTimeout(() => { void diskNobetcisi(); }, 30_000);

/** Bekçiyi koştur, BOZUK kontrol varsa e-posta at (2026-07-28).
 *  Tamamen kod — AI/token maliyeti YOK. Sessizlik = iyi haber:
 *  her şey yolundaysa posta GÖNDERİLMEZ (gürültü olmasın).
 *  Gerekli env: RESEND_API_KEY + OPS_ALERT_EMAIL (yoksa REPORT_RECIPIENT_EMAIL).
 *  OPS_ALERT_ALWAYS=true dersen her gün özet gelir (bozuk olmasa da). */
async function runOpsWatchdogAndAlert(): Promise<void> {
  let result: Awaited<ReturnType<typeof runOpsWatchdog>>;
  try { result = await runOpsWatchdog(); } catch (e) { console.error('Ops watchdog hatası:', e); return; }

  const failing = result.checks.filter(c => !c.ok);
  const always = process.env.OPS_ALERT_ALWAYS === 'true';
  if (!failing.length && !always) return; // sessizlik = iyi haber

  const resendKey = process.env.RESEND_API_KEY;
  const recipient = process.env.OPS_ALERT_EMAIL || process.env.REPORT_RECIPIENT_EMAIL;
  if (!resendKey || !recipient) {
    console.warn(`Ops uyarısı gönderilemedi (RESEND_API_KEY/OPS_ALERT_EMAIL eksik). Bozuk: ${failing.map(c => c.key).join(', ') || 'yok'}`);
    return;
  }
  const esc = (s: string) => String(s).replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] as string));
  const row = (c: { key: string; ok: boolean; detail: string }) =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${c.ok ? '✅' : '❌'} <b>${esc(c.key)}</b></td>` +
    `<td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555;">${esc(c.detail)}</td></tr>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px">
    <h2 style="margin:0 0 4px">CETPA Operasyon Bekçisi — ${esc(result.date)}</h2>
    <p style="color:#666;margin:0 0 14px">${failing.length ? `<b style="color:#c00">${failing.length} kontrol başarısız</b>` : 'Tüm kontroller başarılı'}</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      ${failing.map(row).join('')}${failing.length && always ? '<tr><td colspan="2" style="height:10px"></td></tr>' : ''}
      ${always ? result.checks.filter(c => c.ok).map(row).join('') : ''}
    </table>
    <p style="font-size:11px;color:#888;margin-top:14px">Detay: Yönetim → süper-admin panelindeki Operasyon Bekçisi kartı. Bu e-posta sunucudan otomatik gönderildi (AI kullanılmaz).</p>
  </div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'rapor@cetpa.com.tr',
        to: [recipient],
        subject: failing.length
          ? `⚠️ CETPA: ${failing.length} kontrol başarısız (${failing.map(c => c.key).join(', ')})`
          : `✅ CETPA: tüm kontroller başarılı — ${result.date}`,
        html,
      }),
    });
    // Resend yanıtını oku — reddedilen postayı "gönderildi" saymak, izlemenin
    // sessiz kalmasının ta kendisidir (2026-07-31 dersi).
    if (!r.ok) {
      const govde = await r.text().catch(() => '');
      console.error(`Ops uyarısı REDDEDİLDİ — Resend HTTP ${r.status}: ${govde.slice(0, 300)}`);
      return;
    }
    console.log(`Ops uyarısı gönderildi → ${recipient} (bozuk: ${failing.length})`);
  } catch (err) {
    console.error('Ops uyarı e-postası gönderilemedi:', err);
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
  // LOKAL modda MikroAPI AYNI makinede çalışır ve hash'i MAKİNENİN yerel
  // tarihine göre doğrular — Istanbul'a sabitlemek, sunucu saat dilimi farklıysa
  // gece yarısı bandında "Şifre Hatalı" üretir (2026-07-28'de canlıda yaşandı:
  // PowerShell'in yerel-tarih hash'i geçti, bizim Istanbul hash'imiz reddedildi).
  // BULUT modunda eski davranış (TR saati) korunur.
  const today = new Intl.DateTimeFormat('en-CA', {
    ...(MIKRO_LOCAL_MODE ? {} : { timeZone: 'Europe/Istanbul' }),
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // "YYYY-MM-DD"
  return createHash('md5').update(`${today} ${plainPassword}`).digest('hex');
}

/** "Şu ana kadarki" stok/maliyet sorgularının bitiş tarihi = BUGÜN.
 *  GenelAmacliMaliyetListesiV2 GELECEK tarihli SonTarih aldığında hata vermeden
 *  EldekiMiktar=0, MaliyetBedeli=0 döner (2026-07-30'da canlıda kanıtlandı:
 *  SonTarih=2027-12-31 -> 0 ; SonTarih=bugün -> 1044 birim, aynı SKU).
 *  Tarih, günlük şifre hash'iyle aynı takvimden okunur (lokalde makine saati).
 */
/** StokListesiV2 satırından mevcut miktar — alan YOKSA `null` (0 DEĞİL).
 *
 *  Neden kritik: bu fonksiyondan önce kod `Number(s.sto_mevcut_mik ?? s.toplam_miktar ?? 0)`
 *  yazıyordu. Mikro'nun liste uçları ham tablo kolonlarını döndürüyor
 *  (CariListesiV2'nin `cari_*` dökümünde görüldüğü gibi) ve STOKLAR tablosunda
 *  anlık miktar kolonu yok — miktar hareketlerden türetilir. Yani alan hiç
 *  gelmiyorsa `?? 0` her senkronda TÜM ürünlerin stoğunu sıfırlar ve üstüne
 *  her ürün için sahte bir sayım farkı üretir. `null` dönüp çağıranın
 *  stockLevel'a hiç dokunmamasını sağlıyoruz.
 *
 *  Miktarın güvenilir kaynağı GenelAmacliMaliyetListesiV2'dir
 *  (/api/mikro/import/stok-miktar) — liste uçları yalnız kart verisi taşır.
 */
function mikroStokMiktari(s: Record<string, unknown>): number | null {
  const raw = s.sto_mevcut_mik ?? s.toplam_miktar;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** StokListesiV2 satırından satış fiyatları → `inventory.prices` kademeleri.
 *
 *  İki olası kaynak (kurulumdan kurulmuşa değişiyor):
 *    1. `satis_fiyatlari[]` — STOK_SATIS_FIYAT_LISTELERI satırları
 *       (sfiyat_listesirano 1=Retail 2=B2B Standard 3=B2B Premium 4=Dealer)
 *    2. Kart üzerindeki düz alanlar `sto_satis_fiyat1..4`
 *
 *  0 ve boş "fiyat YOK" sayılır ve DÖNMEZ: Mikro tanımsız kademeyi 0 döndürüyor,
 *  0 yazmak ekranda yine "0 TL" gösterir ve elle girilmiş fiyatı ezerdi. Çağıran
 *  boş nesne görürse `prices`e HİÇ DOKUNMAMALIDIR (bkz. stockLevel/vatRate deseni).
 *
 *  2026-08-11: cron import'u fiyatı hiç yazmıyordu (yalnız manuel import yazıyordu);
 *  iki yol ayrışmasın diye mantık burada TEK yerde toplandı.
 */
function mikroSatisFiyatlari(s: Record<string, unknown>): Record<string, number> {
  const TIERS = ['Retail', 'B2B Standard', 'B2B Premium', 'Dealer'] as const;
  const prices: Record<string, number> = {};
  const ekle = (tier: string, ham: unknown) => {
    if (prices[tier]) return;              // ilk geçerli kaynak kazanır
    const n = Number(ham);
    if (ham != null && ham !== '' && Number.isFinite(n) && n > 0) prices[tier] = n;
  };
  const liste = (s.satis_fiyatlari as Record<string, unknown>[]) || [];
  TIERS.forEach((tier, i) => ekle(tier, liste[i]?.sfiyat_fiyati));
  TIERS.forEach((tier, i) => ekle(tier, s[`sto_satis_fiyat${i + 1}`]));
  return prices;
}

function mikroBugun(): string {
  return new Intl.DateTimeFormat('en-CA', {
    ...(MIKRO_LOCAL_MODE ? {} : { timeZone: 'Europe/Istanbul' }),
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function buildMikroContext(creds: MikroCreds): Record<string, unknown> {
  // Lokal Jump API'sinde bağlam yalnız FirmaKodu/CalismaYili/KullaniciKodu/Sifre
  // (+FirmaNo/SubeNo) içerir; Alias & ApiKey yalnız bulut/APILogin tarafında var.
  // Boş değer GÖNDERME — bazı sürümler boş alanı geçersiz sayabiliyor.
  return {
    ...(creds.alias  ? { Alias:  creds.alias }  : {}),
    FirmaKodu:     creds.firmaKodu,
    CalismaYili:   creds.calismaYili,
    ...(creds.apiKey ? { ApiKey: creds.apiKey } : {}),
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

/** Mikro yanıt zarfından SATIR DİZİSİNİ çıkarır — zarf iki farklı şekilde gelir.
 *
 *  Gözlenen şekiller (2026-07-30, canlı):
 *    Data = { SQLResult1: [ {...}, ... ] }        // nesne sarmalı
 *    Data = [ { SQLResult1: [ {...}, ... ] } ]    // DİZİ sarmalı  ← SqlVeriOkuV2
 *    Data = { StokListesi: [...] }                // liste metotları
 *
 *  Eski kod yalnız `Object.values(Data).find(Array.isArray)` yapıyordu; dizi
 *  sarmalında dizinin İÇİNDEKİ nesneye inmediği için her zaman boş dönüyordu.
 *  Sonuç: SqlVeriOkuV2'ye dayanan HER ŞEY sessizce 0 kayıt veriyordu (mizan,
 *  KDV, yedi liste import'u, cari bakiye).
 *
 *  Neden fark etmedik: PowerShell tek elemanlı dizileri otomatik açtığı için
 *  doğrulama probe'larında zarf doğru görünüyordu. DERS: dış API zarfını
 *  kabuktan değil, uygulamanın kendi ayrıştırıcısından doğrula.
 */
function mikroSatirlar(raw: unknown): Record<string, unknown>[] {
  const d = mikroData(raw) as unknown;
  const adaylar: unknown[] = Array.isArray(d) ? d : [d];
  for (const a of adaylar) {
    if (Array.isArray(a)) return a as Record<string, unknown>[];
    if (a && typeof a === 'object') {
      const dizi = Object.values(a as Record<string, unknown>).find(Array.isArray);
      if (dizi) return dizi as Record<string, unknown>[];
    }
  }
  return [];
}

/** Mikro yanıt zarfındaki hata metni. `Mikro API 501` gibi anlamsız durum
 *  kodları yerine gerçek sebebi (ör. "metot V17'de bulunmuyor") gösterir. */
function mikroHata(raw: unknown, fallback = 'Mikro API yanıt vermedi.'): string {
  const r = ((raw as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
  return (r?.ErrorMessage as string) || (typeof raw === 'string' ? raw.slice(0, 200) : '') || fallback;
}

// ── SqlVeriOkuV2: Mikro'nun SELECT-only SQL kapısı ───────────────────────────
// V17'nin liste yüzeyi çok dar (yalnız Stok/Cari listesi). Fatura, sipariş, stok
// hareketi, banka, kasa, mizan gibi her şey bu kapıdan SELECT ile çekilir.
// Yanıt zarfı: Data.SQLResult1 dizisi (canlıda doğrulandı 2026-07-30).

/** SQL literal'e gömülecek değerleri KATI doğrula. Bu kapı ham SQL çalıştırır;
 *  kullanıcı girdisini string olarak birleştirmek doğrudan SQLi'dir. */
function sqlTarih(v: unknown, varsayilan: string): string {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : varsayilan;
}
function sqlTamsayi(v: unknown, varsayilan: number, min = 0, max = 100000): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : varsayilan;
}
/** Tablo/kolon adı — yalnız harf, rakam, alt çizgi. Beyaz listeyle birlikte kullan. */
function sqlTanimlayici(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : null;
}

/** SqlVeriOkuV2 çalıştır, satırları döndür. Hata varsa `hata` dolu gelir. */
async function mikroSql(sorgu: string): Promise<{ rows: Record<string, unknown>[]; hata: string | null }> {
  const { ok, data } = await mikroPost('SqlVeriOkuV2', { SQLSorgu: sorgu });
  const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
  if (!ok || !r0 || r0.IsError) return { rows: [], hata: mikroHata(data, 'SqlVeriOkuV2 yanıt vermedi.') };
  return { rows: mikroSatirlar(data), hata: null };
}

/** Bir tablonun kolon adları — INFORMATION_SCHEMA'dan, 10 dk önbellekli.
 *  Kolon adlarını TAHMİN ETMEK yerine çalışma anında öğreniyoruz; Mikro'nun
 *  tablo şeması sürümden sürüme değişebiliyor ve yanlış kolon adı sessiz
 *  boş sonuç üretir (bkz. sessiz-sıfır arıza sınıfı). */
const mikroKolonCache = new Map<string, { cols: string[]; exp: number }>();
async function mikroKolonlar(tablo: string): Promise<string[]> {
  const t = sqlTanimlayici(tablo);
  if (!t) return [];
  const c = mikroKolonCache.get(t);
  if (c && c.exp > Date.now()) return c.cols;
  // ORDER BY ORDINAL_POSITION şart: kolonBul ilk EŞLEŞENİ döndürür, dolayısıyla
  // sıra anlamlıdır. SQL Server genelde ordinal sırayla döner ama garanti etmez.
  const { rows } = await mikroSql(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${t}' ORDER BY ORDINAL_POSITION`,
  );
  const cols = rows.map(r => String(r.COLUMN_NAME ?? '')).filter(Boolean);
  if (cols.length) mikroKolonCache.set(t, { cols, exp: Date.now() + 10 * 60_000 });
  return cols;
}

/** ── Mikro vergi oranları: sto_perakende_vergi bir YÜZDE DEĞİL, İNDEKStir ──
 *
 *  2026-07-31'de bulundu: kod `vatRate: Number(s.sto_perakende_vergi) || 20`
 *  yazıyordu. Ama o alan VergiListesiV2'deki `vergiSiraNo`ya işaret eder:
 *    sıra 1 "YOK" %0 · sıra 2 "KDV %1" · sıra 3 "KDV %10" · sıra 4 "KDV %20"
 *  Müşterinin 2.351 ürünü sıra 4 (=%20), 12 ürünü sıra 3 (=%10) kullanıyor;
 *  envantere `vatRate: 4` ve `3` yazılmıştı. Teklif ekranı bunu yüzde sanıp
 *  `fiyat × (1 + vatRate/100)` hesapladığı için %20 yerine %4 KDV uyguluyordu.
 *
 *  Tablo saatlik önbelleklenir. Boş isimli/çöp satırlar (Mikro'nun
 *  ilklendirilmemiş dizi hücreleri: vergiOrani 4.6e-322 gibi) ELENİR.
 */
const vergiOranCache = { map: null as Map<number, number> | null, exp: 0 };

async function mikroVergiOranlari(): Promise<Map<number, number>> {
  if (vergiOranCache.map && vergiOranCache.exp > Date.now()) return vergiOranCache.map;
  const map = new Map<number, number>();
  try {
    const { ok, data } = await mikroPost('VergiListesiV2', {});
    const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
    if (ok && r0 && !r0.IsError) {
      for (const v of mikroSatirlar(data)) {
        const sira = Number(v.vergiSiraNo);
        const oran = Number(v.vergiOrani);
        const ad   = String(v.vergiAdi ?? '').trim();
        // Adı boş olan satırlar Mikro'nun ayrılmış ama kullanılmayan hücreleri.
        // Oran 0..100 dışındaysa (çöp float) güvenme.
        if (!Number.isFinite(sira) || !ad) continue;
        if (!Number.isFinite(oran) || oran < 0 || oran > 100) continue;
        map.set(sira, oran);
      }
    }
  } catch { /* ağ hatası — boş map döner, çağıran vatRate'e dokunmaz */ }
  if (map.size) { vergiOranCache.map = map; vergiOranCache.exp = Date.now() + 3600_000; }
  return map;
}

/** Stok kartındaki vergi işaretçisini GERÇEK yüzdeye çevir.
 *  Çözülemezse `null` — çağıran vatRate'e DOKUNMAMALI (uydurma %20 yazmaktansa
 *  eski değeri koru; bkz. sessiz-sıfır arıza sınıfı). */
function vergiOraniCoz(isaretci: unknown, tablo: Map<number, number>): number | null {
  const p = Number(isaretci);
  if (!Number.isFinite(p)) return null;
  const oran = tablo.get(p);
  return oran === undefined ? null : oran;
}

/** Kolon listesinde regex'e uyan İLK kolonu bul (şema keşfi için). */
function kolonBul(cols: string[], re: RegExp): string | null {
  return cols.find(c => re.test(c)) ?? null;
}

/** Mikro API yanıtı JSON değil de HTML (Cloudflare/WAF/gateway hata sayfası) ise
 *  bunu tanı ve kullanıcıya anlaşılır, EYLEME DÖNÜK bir mesaj üret. v17 göçünden
 *  sonra sunucu IP'si Mikro gateway'inin Cloudflare'inde engellenirse StokListesiV2
 *  gibi çağrılar 403 + HTML döner ve API anahtarı HİÇ denetlenmez. */
function detectMikroGatewayBlock(data: unknown, status?: number): string | null {
  if (typeof data !== 'string') return null;
  const s = data.slice(0, 2000);
  if (!/<html|<!doctype/i.test(s)) return null; // HTML değilse gateway-block değil
  const isCloudflare = /cloudflare|attention required|cf-ray|__cf/i.test(s);
  const ip = process.env.MIKRO_WHITELIST_IP || process.env.SERVER_PUBLIC_IP || 'sunucu IP\'niz';
  if (isCloudflare) {
    const portsuz = !/:\d+/.test(MIKRO_API_BASE);
    return `Mikro gateway (Cloudflare) sunucu isteğini ${status ?? 403} ile ENGELLEDİ — API anahtarı denetlenmedi. ` +
      (portsuz
        ? `KÖK NEDEN: MIKRO_API_URL PORTSUZ (443) → Cloudflare önyüzüne düşüyor. Gerçek Jump API portludur (V17=8094, V16=8084). ` +
          `MIKRO_API_URL'i "https://jumpbulutapigw.mikro.com.tr:8094/ApiJB/ApiMethods" yapıp uygulamayı yeniden başlatın.`
        : `Muhtemel neden: sunucu IP'si (${ip}) Mikro tarafında ${MIKRO_API_BASE.match(/:\d+/)?.[0]} portu için whitelist'te değil — Mikro destekten ekletin.`);
  }
  return `Mikro gateway JSON yerine HTML hata sayfası döndü (HTTP ${status ?? '?'}) — API'ye ulaşılamıyor. ` +
    `Endpoint/gateway adresi v17'de değişmiş veya sunucu IP'si engellenmiş olabilir. Mikro destekle doğrulayın.`;
}

/** Call a Mikro Jump API endpoint — resolves creds, injects token + context. */
async function mikroPost(
  endpoint: string,
  extraBody: Record<string, unknown>,
  inMikro = false // true → ekstra alanlar Mikro objesi İÇİNE konur (V17 evrak kalıbı)
): Promise<{ ok: boolean; status: number; data: unknown }> {
  // V17'de OLMAYAN metotları ağa hiç çıkarmadan, anlaşılır hatayla kes.
  // Çağıran kodun "yanıt geldi ama alan yok" durumuna düşüp `?? 0` ile sıfır
  // yazmasını engeller — cari bakiyeleri ve KDV özetini tam olarak bu kırıyordu.
  if (MIKRO_JUMP_SURUM >= 17 && MIKRO_V17_YOK.has(endpoint)) {
    const msg = `${endpoint} Mikro Jump V17'de bulunmuyor. Bu veri için farklı bir yol gerekir (çoğu liste için SqlVeriOkuV2).`;
    console.warn('[mikroPost] atlandı:', msg);
    return { ok: false, status: 501, data: { result: [{ IsError: true, ErrorMessage: msg }] } };
  }

  const creds = await getMikroCreds();
  if (!creds) throw new Error('Mikro kimlik bilgileri bulunamadı. Ayarlar > Mikro ERP bölümünden girin.');

  const url = `${MIKRO_API_BASE}/${endpoint}`;

  const doCall = async (): Promise<{ ok: boolean; status: number; data: unknown }> => {
    // LOKAL modda OIDC token YOK — kimlik yalnız gövdedeki Mikro bağlamıyla taşınır.
    // (Token adımı burada zorunlu tutulursa, IDM erişilemezse API'ye hiç gidilemez.)
    const token = MIKRO_LOCAL_MODE ? null : await getMikroToken(creds);
    const body = inMikro
      ? { Mikro: { ...buildMikroContext(creds), ...extraBody } }
      : { Mikro: buildMikroContext(creds), ...extraBody };
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        // Cloudflare bot-yönetimi bazı istekleri UA yokluğu/şüpheli UA ile
        // engelliyor. Sıradan bir tarayıcı UA'sı gönder (bulut gateway CF arkasında).
        'User-Agent':     'Cetpa-ERP/1.0 (+https://app.cetpa.com.tr)',
        'Accept':         'application/json',
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
  // Lokal modda token yok → yenilemenin anlamı yok (stub başka sebepten gelir).
  if (result.ok && isStub(result.data) && !MIKRO_LOCAL_MODE) {
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
      const invSnap = await adminDb.collection('inventory').get();
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
      const leadSnap = await adminDb.collection('leads').get();
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
      const invSnap = await adminDb.collection('inventory').get();
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
        if (uid) await admin.auth().revokeRefreshTokens(uid);
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
        try { const d = await admin.auth().verifyIdToken(String(req.query.token || '')); streamUid = d.uid; } catch { /* düş */ }
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
      const rowVisible = (coll: string, data: Record<string, unknown> | undefined): boolean => {
        if (SERVER_ONLY_COLLECTIONS.has(coll)) return false; // sunucuya özel — stream'e asla çıkmaz
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
        const tenantColls = initColls.filter(c => TENANT_COLLECTIONS.has(c));
        const userColls   = initColls.filter(c => USER_SCOPED_COLLECTIONS.has(c));
        // SERVER_ONLY hiç sorgulanmaz (rowVisible zaten eliyordu; artık diske de
        // gitmiyor). initColls'ta KALIR ki istemci o koleksiyon için boş bir init
        // eventi alsın ve beklemede kalmasın.
        const otherColls  = initColls.filter(c => !TENANT_COLLECTIONS.has(c) && !USER_SCOPED_COLLECTIONS.has(c) && !SERVER_ONLY_COLLECTIONS.has(c));
        const { rows } = initColls.length
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
      return { sql: '', params: [] };
    };
    // Yazmada companyId/userId enjekte et (client değerini geçersiz kıl).
    const injectTenant = async (req: Request, coll: string, data: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const uid = (req as Request & { uid?: string }).uid || '';
      if (TENANT_COLLECTIONS.has(coll)) return { ...data, companyId: await getUserCompanyId(uid) };
      if (USER_SCOPED_COLLECTIONS.has(coll) && !('userId' in data)) return { ...data, userId: uid };
      return data;
    };
    // Mevcut doc sahibin mi? (etiketsiz legacy → erişilebilir)
    const ownsDoc = async (req: Request, coll: string, docData: Record<string, unknown> | undefined): Promise<boolean> => {
      const uid = (req as Request & { uid?: string }).uid || '';
      if (!docData) return true; // yeni kayıt
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
        if (!rows.length || !(await ownsDoc(req, coll, rows[0].data as Record<string, unknown>))) { res.status(404).json({ error: 'Not found.' }); return; }
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
        if (coll === 'users') data = await pinProtectedUserFields((req as Request & { uid?: string }).uid || '', data, undefined); // companyId/role/status escalation engeli
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
        const scoped = TENANT_COLLECTIONS.has(coll) || USER_SCOPED_COLLECTIONS.has(coll);
        // Sahiplik: kapsamlı/audit/merge için mevcut kaydı çek
        if (req.query.merge === '1' || audited || scoped) {
          let { rows } = await docsDb.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, realId]);
          if (!rows.length && perCompany) ({ rows } = await docsDb.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id])); // merge tabanı: legacy global
          before = (rows[0]?.data as Record<string, unknown>) ?? {};
          if (rows.length && !(await ownsDoc(req, coll, before))) { res.status(403).json({ error: 'Bu kayıt başka bir firmaya ait.' }); return; }
          if (req.query.merge === '1') data = mergeDocData(before, incoming);
        }
        data = await injectTenant(req, coll, data); // companyId/userId enjekte
        if (perCompany) data = { ...data, companyId: cid }; // SSE firma filtresi için
        if (coll === 'users') data = await pinProtectedUserFields((req as Request & { uid?: string }).uid || '', data, before); // companyId/role/status escalation engeli
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
        if (rows.length && !(await ownsDoc(req, coll, before))) { res.status(403).json({ error: 'Bu kayıt başka bir firmaya ait.' }); return; }
        let data = mergeDocData(before, patch);
        data = await injectTenant(req, coll, data); // companyId/userId enjekte
        if (perCompany) data = { ...data, companyId: cid }; // SSE firma filtresi için
        if (coll === 'users') data = await pinProtectedUserFields((req as Request & { uid?: string }).uid || '', data, before); // companyId/role/status escalation engeli
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
        if (TENANT_COLLECTIONS.has(coll) || USER_SCOPED_COLLECTIONS.has(coll)) {
          if (existing.length && !(await ownsDoc(req, coll, prevData))) { res.status(403).json({ error: 'Bu kayıt başka bir firmaya ait.' }); return; }
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
        if ((TENANT_COLLECTIONS.has(coll) || USER_SCOPED_COLLECTIONS.has(coll)) && !(await ownsDoc(req, coll, rows[0].data as Record<string, unknown>))) {
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
        if ((TENANT_COLLECTIONS.has(coll) || USER_SCOPED_COLLECTIONS.has(coll)) && !(await ownsDoc(req, coll, rows[0].data as Record<string, unknown>))) {
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
  app.get('/api/uploads/tahsilat/:uid/:file', requireAuth, (req: Request, res: Response) => {
    const reqUid = (req as Request & { uid: string }).uid.replace(/[^A-Za-z0-9_-]/g, '');
    const uid = String(req.params.uid).replace(/[^A-Za-z0-9_-]/g, '');
    const file = String(req.params.file).replace(/[^A-Za-z0-9_.-]/g, '');
    if (uid !== reqUid) return res.status(403).json({ error: 'Bu dosyaya erişim yetkiniz yok.' });
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
      const success = ok && !r0?.IsError;
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
      const success = ok && !r0?.IsError;
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
      const leadSnap = await adminDb.collection('leads').get();
      const leadByKod = new Map<string, PgDocRef>();
      const leadByVkn = new Map<string, PgDocRef>();
      const leadByName = new Map<string, PgDocRef>();
      const vknNorm = (v?: string) => (v || '').replace(/\D/g, '');
      for (const d of leadSnap.docs) {
        const data = d.data();
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

      // inMikro: V17 evrak kalıbı — payload (evraklar) Mikro objesi İÇİNDE gider.
      const { ok, data, status } = await mikroPost('SiparisKaydetV2', {
        evraklar: [{ satirlar }],
      }, true);

      const duration = Date.now() - t0;
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0 = envelope?.[0] as Record<string, unknown> | undefined;
      const success = ok && !r0?.IsError;
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
    const companyId = (req as Request & { uid: string }).uid;

    const t0 = Date.now();
    let created = 0, updated = 0, errors = 0;
    let skippedRecords = 0;
    /** Mikro'dan en az bir satış fiyatı gelen ürün sayısı (özet raporlanır). */
    let fiyatliUrun = 0;

    try {
      // Prefetch ALL inventory docs → Map<sku, ref>. Deliberately NOT filtered
      // by companyId: legacy docs imported before companyId existed must match
      // by SKU and get healed (updated with companyId) instead of duplicated.
      const existingSnap = await adminDb.collection('inventory').get();
      const existingBySku = new Map<string, PgDocRef>();
      for (const docSnap of existingSnap.docs) {
        const sku = (docSnap.data().sku as string)?.trim();
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
        const depoSnap = await adminDb.collection('warehouses').get();
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
              .doc(`mikro-${sku.replace(/[/\\]/g, '_')}`);
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
        await adminDb.collection('warehouses').doc(`mikro-depo-${kod}`).set({
          companyId,
          name:      `Depo ${kod}`,
          code:      kod,
          source:    'mikro_import',
          itemCount,
          updatedAt: pgServerTimestamp(),
        }, { merge: true });
        await adminDb.collection('wmsLocations').doc(`mikro-depo-${kod}`).set({
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
    const companyId = (req as Request & { uid: string }).uid;

    const t0 = Date.now();
    let created = 0, updated = 0, errors = 0;
    const PAGE_SIZE = 500;
    let index = 0;
    let hasMore = true;

    try {
      // Prefetch ALL leads → Map<mikroCariKod, ref> + Map<VKN, ref> + Map<isim, ref>
      // (companyId filtresiz: eski kayıtlar cari koduyla eşleşip companyId ile
      // iyileştirilir). VKN/isim fallback'i sart: manuel olusturulmus (CRM/
      // Muhasebe/B2B formlari) bir lead'in hic mikroCariKod'u olmaz - sadece
      // kod'a bakan eski mantik bu importta onu ikinci kez olusturuyordu.
      const normalizeVkn = (v?: string) => (v || '').replace(/\D/g, '');
      const existingSnap = await adminDb.collection('leads').get();
      const existingByKod = new Map<string, PgDocRef>();
      const existingByVkn = new Map<string, PgDocRef>();
      const existingByName = new Map<string, PgDocRef>();
      for (const docSnap of existingSnap.docs) {
        const data = docSnap.data();
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
  function findKey(row: Record<string, unknown>, re: RegExp): string | null {
    for (const k of Object.keys(row)) if (re.test(k)) return k;
    return null;
  }

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
    postProcess?: (rows: Record<string, unknown>[], companyId: string) => Promise<string | null>;
  };

  async function mikroSqlImportCalistir(
    opts: SqlImportOpts,
    companyId: string,
    ilkTarih: string,
    sonTarih: string,
    actor: { uid: string; email: string },
  ): Promise<{ ok: boolean; total: number; note: string | null; truncated: boolean; error?: string; duration: number }> {
    const t0 = Date.now();
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

    const allRows: Record<string, unknown>[] = [];
    let sayfa = 0, total = 0, tavanaCarpti = false;
    try {
      while (sayfa < MAKS_SAYFA) {
        const offset = sayfa * SAYFA;
        const { rows, hata } = await mikroSql(
          `SELECT ${secim} FROM ${opts.tablo}${opts.fromEk ?? ''}${where} ` +
          `ORDER BY ${opts.siralama} OFFSET ${offset} ROWS FETCH NEXT ${SAYFA} ROWS ONLY`,
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
          const docId = guidKey && row[guidKey]
            ? String(row[guidKey])
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

      const duration = Date.now() - t0;
      const ozet = `${total} kayıt${tavanaCarpti ? ' — SAYFA TAVANINA ÇARPTI, veri eksik' : ''}` +
        `${dusenKolonlar.length ? ` — şemada olmayan kolonlar atlandı: ${dusenKolonlar.join(', ')}` : ''}` +
        `${postNote ? ` — ${postNote}` : ''}`;
      // Senkronizasyon Geçmişi bu koleksiyonu okur — import'lar 2026-07-31'e
      // kadar buraya HİÇ yazmıyordu, panel bu yüzden boş görünüyordu.
      await writeSyncLog(`SQL:${opts.tablo}`, opts.collection, ozet, true, null, null, duration, actor);
      await writeAuditLog(actor, opts.label, `${ozet} (SQL: ${opts.tablo})`);
      return { ok: true, total, note: postNote, truncated: tavanaCarpti, duration };
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
      res.json({ success: true, total: sonuc.total, note: sonuc.note, tablo: opts.tablo,
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
              'SUM(sth_vergi) AS kdv, SUM(sth_tutar) AS matrah, MIN(sth_vergi_pntr) AS vergiPntr ' +
              'FROM STOK_HAREKETLERI WHERE sth_evraktip IN (3, 4) ' +
              'GROUP BY sth_evrakno_seri, sth_evrakno_sira, sth_evraktip' +
            ') sat ON sat.sth_evrakno_seri = cha.cha_evrakno_seri ' +
            'AND sat.sth_evrakno_sira = cha.cha_evrakno_sira ' +
            // Yön eşleşmesi ŞART: satış ve alış aynı evrak numarasını
            // kullanabiliyor (seri boş). evraktip'i de anahtara katmazsak
            // bir satış faturasına alış satırının KDV'si bağlanabilir.
            'AND sat.sth_evraktip = CASE WHEN cha.cha_tip = 0 THEN 4 ELSE 3 END',
    secim: 'cha.*, ISNULL(sat.kdv, ISNULL(cha.cha_meblag - cha.cha_aratoplam, 0)) AS kdvTutari, ISNULL(sat.matrah, ISNULL(cha.cha_aratoplam, 0)) AS matrah, sat.vergiPntr',
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
    ekKosul: '(cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6))',
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
        batch.set(adminDb.collection('bankAccounts').doc(`mikro-${id}`), {
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
      const ornek = rows[0];
      const adKey = findKey(ornek, /kas_(adi|isim|ad)$/i) ?? findKey(ornek, /kas_.*ad/i);
      const noKey = findKey(ornek, /kas_no$/i) ?? findKey(ornek, /kas_kod/i);
      if (!adKey) return `kasa adı alanı bulunamadı — kasalar'a yazılmadı`;
      let batch = adminDb.batch(); let ops = 0, n = 0;
      for (const r of rows) {
        const guidKey = findKey(r, /_Guid$/i);
        const id = guidKey && r[guidKey] ? String(r[guidKey]) : null;
        if (!id) continue;
        batch.set(adminDb.collection('kasalar').doc(`mikro-${id}`), {
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
        batch.set(adminDb.collection('warehouses').doc(`mikro-depo-${depoNo}`), {
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
    postProcess: async (rows, _companyId) => {
      if (!adminDb) return null;
      const sample = rows[0];
      const skuKey = findKey(sample, /sto_?kod|stok_?kod/i);
      const barKey = findKey(sample, /bar_?kod(?!u_)|barkod/i);
      if (!skuKey || !barKey) return `eşleme alanları bulunamadı (sku=${skuKey}, barkod=${barKey})`;
      const invSnap = await adminDb.collection('inventory').get();
      const bySku = new Map<string, PgDocRef>();
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
      const uyusmazlikOrnek: { sku: string; toplam: number; beklenen: number }[] = [];
      try {
        const invSnap = await adminDb!.collection('inventory').where('source', '==', 'mikro_import').get();
        const items = invSnap.docs
          .map(d => ({ ref: d.ref, sku: ((d.data().sku as string) || '').trim() }))
          .filter(x => x.sku);
        const total = items.length;
        // companyId + depo listesi bir kez (döngü içinde tekrar tekrar değil).
        const companyId = await reqCompanyId(req);
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
                          uyusmazlik: null as { sku: string; toplam: number; beklenen: number } | null };
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
              // MUTABAKAT KONTROLÜ (2026-08-11): bu SQL'in semantiği (sth_tip 0=giriş /
              // 1=çıkış, transferin İKİ ayrı satır olması) canlı veriyle hiç doğrulanmadı.
              // Yanlışsa dağılım sessizce hatalı yazılırdı. Artık kendini denetliyor:
              // dağılımın TOPLAMI, otoriter toplam (EldekiMiktar) ile tutmalı. Tutmuyorsa
              // o SKU'nun dağılımı YAZILMAZ (yanlış dağılım göstermektense hiç gösterme)
              // ve sayılır — iş özetinde raporlanır. 0 uyuşmazlık = semantik doğrulandı.
              let depoQtys: Record<string, number> | null = null;
              let uyusmazlik: { sku: string; toplam: number; beklenen: number } | null = null;
              if (qty > 0) {
                const fromMap = depoMap.get(it.sku);
                if (fromMap && Object.keys(fromMap).length > 0) {
                  const toplam = Object.values(fromMap).reduce((a, b) => a + b, 0);
                  // Tolerans: kesirli miktarlarda kayan nokta + Mikro yuvarlaması.
                  if (Math.abs(toplam - qty) <= Math.max(0.01, Math.abs(qty) * 0.001)) {
                    depoQtys = fromMap;
                  } else {
                    uyusmazlik = { sku: it.sku, toplam, beklenen: qty };
                  }
                }
              }

              return { it, qty, cost, depoQtys, uyusmazlik };
            } catch { return bos; }
          }));

          for (const r of results) {
            processed++;
            if (r.uyusmazlik) {
              depoUyusmazlik++;
              // İlk birkaç örneği sakla — teşhis için (hepsini tutmak gereksiz).
              if (uyusmazlikOrnek.length < 5) uyusmazlikOrnek.push(r.uyusmazlik);
            }
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
            batch.set(adminDb!.collection('warehouseItems').doc(`mikro-${r.it.sku.replace(/[/\\]/g, '_')}`), {
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
          // Panel bunu gösterir: 0 = per-depo SQL semantiği tüm katalogda doğrulandı.
          depoUyusmazlik, uyusmazlikOrnek,
          finishedAt: pgServerTimestamp(), durationMs: duration,
        }, { merge: true });
        const depoNot = depoUyusmazlik > 0
          ? `, ${depoUyusmazlik} üründe depo dağılımı toplamı tutmadı (dağılım yazılmadı)`
          : '';
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
      const success = ok && !r0?.IsError;
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
    const companyId = (req as Request & { uid: string }).uid;
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
      const snap = await adminDb.collection('inventory').get();
      const dummies: { ref: PgDocRef; name: string }[] = [];
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
      const success    = ok && !r0?.IsError;
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
      const success       = ok && !r0?.IsError;
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
  
// --- TEMPORARY ENDPOINT FOR PERSONEL ---
app.post('/api/mikro/test-personel', async (req, res) => {
  try {
    const { mikroSql } = require('./src/services/mikroSql');
    const result = await mikroSql("SELECT TOP 5 * FROM PERSONEL_TANIMLARI");
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
// --- END TEMPORARY ---

app.post('/api/mikro/pull/bakiye', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    try {
      const { ok, data } = await mikroPost('SqlVeriOkuV2', {
        SQLSorgu:
          'SELECT cha_kod, ' +
          'SUM(CASE WHEN cha_tip = 0 THEN cha_meblag ELSE -cha_meblag END) AS bakiye ' +
          'FROM CARI_HESAP_HAREKETLERI GROUP BY cha_kod',
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
      const perSql = `
        SELECT
          per_kodu as mikroPersKod,
          per_adi as name,
          per_soyadi as surname,
          per_eposta as email,
          per_ceptel as phone,
          per_departmani as department,
          per_gorevi as position,
          per_maas as salary,
          per_isegiristarihi as startDate,
          per_durumu as status,
          per_tckimlikno as tcId
        FROM PERSONEL_TANIMLARI
      `;
      const personeller = await mikroSql(perSql);
      res.json({ success: true, data: personeller });
    } catch (err: any) {
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

      res.json({ success: true, data: rows });
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
      const isOk     = ok && !r0?.IsError;
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
      const isOk     = ok && !r0?.IsError;
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
    const companyId = (req as Request & { uid: string }).uid;
    const t0 = Date.now();
    try {
      const contacts = await parasutGetAll(creds, 'contacts');
      const leadSnap = await adminDb.collection('leads').get();
      const byParasutId = new Map<string, PgDocRef>();
      const byVkn = new Map<string, PgDocRef>();
      const byName = new Map<string, PgDocRef>();
      const normalizeVknP = (v?: string) => (v || '').replace(/\D/g, '');
      for (const d of leadSnap.docs) {
        const data = d.data();
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
    const companyId = (req as Request & { uid: string }).uid;
    const t0 = Date.now();
    try {
      const products = await parasutGetAll(creds, 'products');
      const invSnap = await adminDb.collection('inventory').get();
      const bySku = new Map<string, PgDocRef>();
      for (const d of invSnap.docs) {
        const sku = ((d.data().sku as string) || '').trim();
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
  app.post('/api/email/send', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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

  // ── Admin: User Invite ────────────────────────────────────────────────────
  // POST /api/admin/invite — sends invite email via Resend, stores invite doc in Firestore
  // Body: { email, role }
  app.post('/api/admin/invite', authLimiter, requireAuth, requireMfaVerified, requireAdmin, async (req: Request, res: Response) => {
    const { email, role = 'Sales' } = req.body as { email: string; role?: string };
    if (!email || !isValidEmail(email)) return res.status(400).json({ success: false, error: 'Geçerli e-posta gerekli.' });
    const ALLOWED_INVITE_ROLES = ['Admin', 'Manager', 'Sales', 'Accountant', 'Warehouse', 'Dealer', 'B2B', 'Viewer'];
    if (!ALLOWED_INVITE_ROLES.includes(role)) return res.status(400).json({ success: false, error: 'Geçersiz rol.' });

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
  app.post('/api/email/bulk-campaign', requireAuth, requireMfaVerified, async (req: Request, res: Response) => {
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
        return {
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
    const { plan, status, note, cycle, nextPaymentDate } = (req.body ?? {}) as
      { plan?: string; status?: string; note?: string; cycle?: string; nextPaymentDate?: string | number | null };
    if (plan !== undefined && !SA_PLANS.has(plan)) return res.status(400).json({ error: 'Geçersiz plan.' });
    if (status !== undefined && status !== 'active' && status !== 'suspended') return res.status(400).json({ error: 'Geçersiz durum.' });
    if (cycle !== undefined && cycle !== 'monthly' && cycle !== 'yearly') return res.status(400).json({ error: 'Geçersiz dönem.' });
    try {
      const changes: string[] = [];
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

  /** Kiracı firmaya abonelik ödeme linki oluşturur (iyzico) ve isteğe bağlı e-posta gönderir. */
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
    const companyId = (req as Request & { uid: string }).uid;
    const t0 = Date.now();
    try {
      const items = await dynamicsGetAll(token, 'items');
      const invSnap = await adminDb.collection('inventory').get();
      const bySku = new Map<string, PgDocRef>();
      for (const d of invSnap.docs) {
        const sku = ((d.data().sku as string) || '').trim();
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
    const companyId = (req as Request & { uid: string }).uid;
    const t0 = Date.now();
    try {
      const customers = await dynamicsGetAll(token, 'customers');
      const leadSnap = await adminDb.collection('leads').get();
      const byDynId = new Map<string, PgDocRef>();
      const byVkn = new Map<string, PgDocRef>();
      const byName = new Map<string, PgDocRef>();
      const normVkn = (v?: string) => (v || '').replace(/\D/g, '');
      for (const d of leadSnap.docs) {
        const data = d.data();
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
