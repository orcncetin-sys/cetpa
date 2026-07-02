import express, { Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import {
  type AppRole, type DbOp, ADMIN_ROLES, APPEND_ONLY_COLLECTIONS, PUBLIC_WRITE_COLLECTIONS,
  isAllowed, isSelfDocAccess, blocksRoleEscalation,
} from "./src/lib/rbac.js";
import pg from "pg";
import { EventEmitter } from "events";
// vite is imported dynamically below — only in development, never in production
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cron from "node-cron";
import admin from "firebase-admin";
import { createHmac, createHash } from "crypto";
import { generateSecret as totpSecret, generateURI as totpURI, verifySync as totpVerifyRaw } from "otplib";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import Stripe from "stripe";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z, ZodError } from "zod";

dotenv.config();

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

const dbEvents = new EventEmitter();
dbEvents.setMaxListeners(0);

async function initDocsTable(): Promise<void> {
  if (!pgPool) { console.warn('DATABASE_URL not set — /api/db routes disabled.'); return; }
  await pgPool.query(`CREATE TABLE IF NOT EXISTS docs (
    coll text NOT NULL,
    id   text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (coll, id)
  )`);
  console.log('PostgreSQL docs table ready ✓');
  await initMikroTables();
  await initMfaTable();
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
  if (sig !== expected) return null;
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
const TENANT_COLLECTIONS = new Set([
  // ── Çekirdek satış/stok/lojistik ──
  'inventory', 'leads', 'orders', 'quotations', 'shipments', 'warehouseItems',
  'warehouses', 'employees', 'customerRisks', 'inventoryMovements', 'priceLists',
  'priceOverrides', 'suppliers', 'purchaseOrders', 'returns', 'recurringOrders',
  'recurringBilling', 'revenueContracts', 'contracts', 'supportTickets',
  'demandRequests', 'productionOrders', 'projectCosts', 'projectTimelines',
  'capacityLines', 'letterOfCredit', 'intercompanyTxns', 'approvalRequests',
  'payrolls', 'leaveRequests', 'warranties', 'workflowTasks', 'categories',
  'commissionRules', 'subeler', 'vergiTakvimi', 'mikroFaturalar', 'transfers',
  'checks', 'budgets', 'waybills', 'services', 'accountingPeriods', 'taxSummary',
  'wmsLocations', 'dataRequests',
  // ── 2026-06-22 review: eksik tenant-private iş koleksiyonları eklendi ──
  'akreditifler', 'amortismanKayitlari', 'arizalar', 'assemblyMeetings', 'auditItems',
  'bankAccounts', 'bankTransactions', 'boardMeetings', 'bom', 'campaigns', 'cargoTracking',
  'complaints', 'complianceItems', 'cpqQuotes', 'cpqTemplates', 'ctpatRecords',
  'documentTemplates', 'dunningInvoices', 'dunningPolicies', 'eBelgeler', 'eightDRecords',
  'ekipmanlar', 'fiveSRecords', 'fmeaRecords', 'garantiler', 'gumrukBeyannameleri',
  'holdingAccounts', 'holdingEntities', 'holdingIntercompany', 'ihracatlar', 'invoices',
  'isEmirleri', 'ithalatlar', 'jobs', 'journalEntries', 'kaizenRecords', 'kasaHareketleri',
  'kasaKapanislar', 'kasalar', 'legalCases', 'legalDocs', 'lotHareketleri', 'lotKayitlari',
  'machines', 'maliyetKalemleri', 'maliyetMerkezleri', 'masraflar', 'orderReturns',
  'payments', 'payrollEntries', 'performanceReviews', 'pfmeaRecords', 'projects',
  'qcRecords', 'resources', 'revenueSchedules', 'rmaRequests', 'routingTemplates',
  'sabitKiymetBakim', 'sabitKiymetSigorta', 'sabitKiymetler', 'seriNolar', 'servisTalepleri',
  'shareholders', 'skuMappings', 'subeTransferler', 'tahsilatKayitlari', 'tahsilatOdemeleri',
  'tasks', 'taxDeclarations', 'teknisyenler', 'territories', 'timeAttendance', 'trainings',
  'travelRequests', 'warehouseBins', 'webhookConfigs', 'wmsCycleCounts', 'wmsTasks', 'workCenters',
  // Entegrasyon senkron logları (firma-bazlı)
  'dynamicsSyncLog', 'logoSyncLog', 'lucaSyncLog', 'sapSyncLog', 'syncLog',
]);
const USER_SCOPED_COLLECTIONS = new Set(['notifications', 'userPrefs', 'userOnboarding']);
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

// ── firebase-admin Firestore compatible shim over PostgreSQL ─────────────────
// server.ts's 170+ adminDb call sites (Shopify/Mikro sync, audit log, crons)
// keep their code shape; only the backing store changes. Writes broadcast over
// SSE so connected browsers update live, exactly like client-initiated writes.

/* eslint-disable @typescript-eslint/no-explicit-any */
type PgDocData = Record<string, any>;

/** Mikro Jump kurulum sürümü — V16'da SqlVeriOkuV2 ve cha_ebelge_turu YOK.
 *  (V16/V17 Postman koleksiyonları diff'i, 2026-06-12). Müşteri V17'ye
 *  geçtiğinde .env.production'a MIKRO_JUMP_SURUM=17 eklemek yeterli. */
const MIKRO_JUMP_SURUM = Number(process.env.MIKRO_JUMP_SURUM || 16);

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
): Promise<void> {
  if (!pgPool || !rows?.length) return;
  try {
    for (const r of rows) {
      const veri = JSON.stringify(r);
      const hash = createHash('md5').update(table + veri).digest('hex');
      const names = Object.keys(cols);
      const vals = names.map(n => cols[n](r));
      await pgPool.query(
        `INSERT INTO ${table} (${names.join(', ')}, veri, veri_hash)
         VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}, $${names.length + 1}, $${names.length + 2})
         ON CONFLICT (veri_hash) DO NOTHING`,
        [...vals, veri, hash],
      );
    }
  } catch (e) { console.warn(`[mikroMirror:${table}]`, (e as Error).message); }
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
  cha_vergi: r => numOrNull(r.cha_vergi),
  cha_aciklama: r => strOrNull(r.cha_aciklama),
  cha_evrakno_seri: r => strOrNull(r.cha_evrakno_seri),
  cha_evrakno_sira: r => strOrNull(r.cha_evrakno_sira),
  cha_belge_no: r => strOrNull(r.cha_belge_no),
  cha_ebelge_turu: r => numOrNull(r.cha_ebelge_turu),
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
      companyId: actor.uid,
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
      const invSnap = await adminDb.collection('inventory').get();
      const invBySku = new Map<string, PgDocRef>();
      for (const d of invSnap.docs) {
        const sku = (d.data().sku as string)?.trim();
        if (sku && !invBySku.has(sku)) invBySku.set(sku, d.ref);
      }
      let stokYeni = 0, stokGuncel = 0;
      let batch = adminDb.batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = adminDb!.batch(); ops = 0; } };
      const seenSku = new Set<string>();
      for (const s of stoklar) {
        const sku = (s.sto_kod as string)?.trim();
        if (!sku || seenSku.has(sku)) continue;
        seenSku.add(sku);
        const fields = {
          name: (s.sto_isim as string) || sku,
          unit: (s.sto_birim1_ad as string) || 'ADET',
          vatRate: Number(s.sto_perakende_vergi) || 20,
          // sto_mevcut_mik: StokListesiV2'nin gercek mevcut miktar alani (bkz.
          // POST /api/mikro/stok/listesi ile ayni eslesme) - onceden burada hic
          // yazilmiyordu, tum urunler otomatik senkronda stockLevel=0 kaliyordu.
          stockLevel: Number(s.sto_mevcut_mik ?? s.toplam_miktar ?? 0),
          mikroStoKod: sku, mikroSynced: true,
          mikroSyncedAt: pgServerTimestamp(),
        };
        const ref = invBySku.get(sku);
        if (ref) { batch.update(ref, fields); stokGuncel++; }
        else {
          batch.set(adminDb.collection('inventory').doc(), {
            ...fields, companyId, sku, category: 'Genel',
            lowStockThreshold: 5, prices: {}, price: 0,
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
      for (const d of leadSnap.docs) {
        const kod = (d.data().mikroCariKod as string)?.trim();
        if (kod && !leadByKod.has(kod)) leadByKod.set(kod, d.ref);
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
        };
        const ref = leadByKod.get(kod);
        if (ref) { batch.update(ref, fields); cariGuncel++; }
        else {
          batch.set(adminDb.collection('leads').doc(), {
            ...fields, companyId, status: 'Active', source: 'mikro_cron',
            createdAt: pgServerTimestamp(),
          });
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
      const sonTarih = `${new Date().getFullYear() + 1}-12-31`;
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
            const qty = Number(d.EldekiMiktar ?? 0);
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
    const SESSION_MAX_AGE = 5 * 24 * 60 * 60 * 1000; // 5 gün
    const parseCookie = (header: string | undefined, name: string): string | null => {
      if (!header) return null;
      for (const part of header.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return decodeURIComponent(v.join('='));
      }
      return null;
    };
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
    app.post('/api/db/session/logout', dbLimiter, (_req: Request, res: Response) => {
      res.clearCookie(SESSION_COOKIE, { path: '/api/db' });
      res.clearCookie(MFA_COOKIE, { path: '/' });
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

    // ── MFA gate: MFA açık kullanıcılar için veri rotaları doğrulanana dek 403 ──
    const requireMfaVerified = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const uid = (req as Request & { uid?: string }).uid || '';
      if (!(await userHasMfa(uid))) { next(); return; } // MFA kapalı → geç
      if (verifyMfaToken(parseCookie(req.headers.cookie, MFA_COOKIE), uid)) { next(); return; }
      res.status(403).json({ error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true });
    };

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
      const colls = String(req.query.colls || '').split(',').filter(c => COLL_RE.test(c));
      if (!colls.length) { res.status(400).json({ error: 'colls query param required.' }); return; }
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
        if (!data) return true;
        if (TENANT_COLLECTIONS.has(coll)) { const dc = data.companyId as string | undefined; return !dc || dc === streamCid; }
        if (USER_SCOPED_COLLECTIONS.has(coll)) { const du = data.userId as string | undefined; return !du || du === streamUid; }
        if (coll === 'settings') { const dc = data.companyId as string | undefined; return !dc || dc === streamCid; } // firma-bazlı ayar init izolasyonu
        return true;
      };
      try {
        const { rows } = await docsDb.query('SELECT coll, id, data FROM docs WHERE coll = ANY($1)', [colls]);
        const byColl: Record<string, Array<{ id: string; data: unknown }>> = {};
        for (const c of colls) byColl[c] = [];
        for (const r of rows) if (rowVisible(r.coll, r.data as Record<string, unknown>)) byColl[r.coll].push({ id: r.id, data: r.data });
        for (const c of colls) res.write(`event: init\ndata: ${JSON.stringify({ coll: c, docs: byColl[c] })}\n\n`);
      } catch (e) {
        res.write(`event: err\ndata: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
      }
      const onChange = (ev: { coll: string; cid?: string; uid?: string }) => {
        if (!colls.includes(ev.coll)) return;
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
    const dbErr = (e: unknown, res: Response, op: string, coll: string) => {
      console.error(`[/api/db ${op} ${coll}]`, (e as Error).message);
      res.status(500).json({ error: 'Veritabanı işlemi başarısız.' });
    };
    // Yetki kapısı — yetkisizse 403 döner ve true verir (çağıran return etmeli).
    // docId verilirse 'kendi kaydı' istisnası uygulanır (users/{uid}).
    const denied = async (
      req: Request, res: Response, coll: string, op: 'read' | 'write' | 'delete', docId?: string,
    ): Promise<boolean> => {
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
        res.json({ data: rows[0].data });
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
        const incoming = resolveSentinels(req.body ?? {}) as Record<string, unknown>;
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
        const patch = resolveSentinels(req.body ?? {}) as Record<string, unknown>;
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
    // ── HMAC doğrulaması (fail-closed) ───────────────────────────────────
    // Secret tanımsızsa webhook doğrulanamaz → işlenmez (önce atlanıp sahte
    // sipariş enjekte edilebiliyordu).
    const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    const shopifyHmac   = req.headers['x-shopify-hmac-sha256'] as string | undefined;
    if (!webhookSecret) { res.status(503).send('Webhook not configured'); return; }
    if (!shopifyHmac || !req.rawBody) { res.status(401).send('Missing signature'); return; }
    {
      const computed = createHmac('sha256', webhookSecret).update(req.rawBody).digest('base64');
      if (computed !== shopifyHmac) { res.status(401).send('Invalid signature'); return; }
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
          await adminDb.collection('orders').add({
            ...orderData,
            lineItems: (body.line_items || []).map((li: Record<string, unknown>) => ({
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
        const snap = await adminDb
          .collection('orders')
          .where('shopifyOrderId', '==', shopifyOrderId)
          .limit(1)
          .get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({
            status: 'Cancelled',
            updatedAt: pgServerTimestamp(),
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
            updatedAt: pgServerTimestamp(),
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
      void mirrorMikroStoklar(stoklar);

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
      if (success) void mirrorMikroCariler([cari]);

      if (adminDb && firebaseId && success) {
        await adminDb.collection('leads').doc(firebaseId).update({
          mikroCariKod:  cariKod,
          mikroSynced:   true,
          mikroSyncedAt: pgServerTimestamp(),
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
        FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl,cari_hareket_tipi,cari_baglanti_tipi',
        WhereStr:  whereStr,
        Sort:      'cari_kod',
        Size:      String(size),
        Index:     index,
      });

      if (!ok) return res.status(status).json({ success: false, error: data });

      const cariler = (mikroData(data).CariListesi ?? []) as Record<string, unknown>[];
      void mirrorMikroCariler(cariler);

      if (adminDb && Array.isArray(cariler)) {
        for (const c of cariler) {
          const cariKod = c.cari_kod as string;
          if (!cariKod) continue;
          const snap = await adminDb.collection('leads').where('mikroCariKod', '==', cariKod).limit(1).get();
          if (!snap.empty) {
            await snap.docs[0].ref.update({
              email:         (c.cari_EMail  as string) || '',
              phone:         (c.cari_CepTel as string) || '',
              mikroSyncedAt: pgServerTimestamp(),
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
      const existingBySku = new Map<string, PgDocRef>();
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
        void mirrorMikroStoklar(stoklar);
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
              mikroSyncedAt:    pgServerTimestamp(),
            };

            // Upsert via batch: update if exists, create if not
            const existingRef = existingBySku.get(sku);
            if (existingRef) {
              batch.update(existingRef, item);
              updated++;
            } else {
              const newRef = adminDb.collection('inventory').doc();
              batch.set(newRef, { ...item, createdAt: pgServerTimestamp() });
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
      const existingByKod = new Map<string, PgDocRef>();
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

            // Upsert by mikroCariKod via batch
            const existingRef = existingByKod.get(cariKod);
            if (existingRef) {
              batch.update(existingRef, lead);
              updated++;
            } else {
              const newRef = adminDb.collection('leads').doc();
              batch.set(newRef, { ...lead, createdAt: pgServerTimestamp() });
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


  /** POST /api/mikro/import/stok-miktar — stok miktarlarını Mikro'dan çek.
   *  StokListesiV2 miktar DÖNDÜRMEZ; tek kaynak GenelAmacliMaliyetListesiV2
   *  (SKU başına tek çağrı, EldekiMiktar + MaliyetBedeli döner).
   *  1700+ SKU = uzun iş → hemen { started: true } döner, ilerleme
   *  jobs/stokMiktarImport dokümanına canlı yazılır (panel onSnapshot ile izler).
   */
  let stokMiktarJobRunning = false;
  app.post('/api/mikro/import/stok-miktar', requireAuth, async (req: Request, res: Response) => {
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
      try {
        const invSnap = await adminDb!.collection('inventory').where('source', '==', 'mikro_import').get();
        const items = invSnap.docs
          .map(d => ({ ref: d.ref, sku: ((d.data().sku as string) || '').trim() }))
          .filter(x => x.sku);
        const total = items.length;
        await jobRef.set({ running: true, processed: 0, updated: 0, failed: 0, total, startedAt: pgServerTimestamp(), finishedAt: null, error: null });

        const sonTarih = `${new Date().getFullYear() + 1}-12-31`;
        const CONCURRENCY = 8;
        let batch = adminDb!.batch(); let ops = 0;
        const commitBatch = async () => { if (ops > 0) { await batch.commit(); batch = adminDb!.batch(); ops = 0; } };

        for (let i = 0; i < items.length; i += CONCURRENCY) {
          const slice = items.slice(i, i + CONCURRENCY);
          const results = await Promise.all(slice.map(async (it) => {
            try {
              const { ok, data } = await mikroPost('GenelAmacliMaliyetListesiV2', {
                StokKod: it.sku, IlkTarih: '2000-01-01', SonTarih: sonTarih, Depolar: '1,2,3,4,5',
              });
              const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
              if (!ok || !r0 || r0.IsError) return { it, qty: null as number | null, cost: null as number | null };
              const d = (r0.Data ?? {}) as Record<string, unknown>;
              const qty = Number(d.EldekiMiktar ?? 0);
              const totalCost = Number(d.MaliyetBedeli ?? 0);
              return { it, qty, cost: qty > 0 ? totalCost / qty : null };
            } catch { return { it, qty: null, cost: null }; }
          }));

          for (const r of results) {
            processed++;
            if (r.qty === null) { failed++; continue; }
            batch.update(r.it.ref, {
              stockLevel: r.qty,
              ...(r.cost !== null ? { costPrice: Math.round(r.cost * 100) / 100 } : {}),
              mikroSyncedAt: pgServerTimestamp(),
            });
            ops++;
            // Depo sekmesindeki kayıt da güncellensin
            batch.set(adminDb!.collection('warehouseItems').doc(`mikro-${r.it.sku.replace(/[/\\]/g, '_')}`), {
              quantity: r.qty, updatedAt: pgServerTimestamp(),
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
        await jobRef.set({ running: false, processed, updated, failed, finishedAt: pgServerTimestamp(), durationMs: duration }, { merge: true });
        await writeAuditLog(actor, 'Mikro Stok Miktarları', `${updated} ürünün miktarı güncellendi, ${failed} hata (${Math.round(duration / 1000)}sn)`);
        console.log(`Stok miktar import bitti: ${updated} güncellendi, ${failed} hata, ${duration}ms`);
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
      if (success) void mirrorMikroInsert('mikro_cari_hesap_hareketleri', [{ ...hareket, __kaynak: 'hareket_push' }], CHA_COLS);
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
  app.post('/api/mikro/import/faturalar', requireAuth, async (req: Request, res: Response) => {
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
        "cha_kod, cha_aciklama, cha_meblag, cha_aratoplam, cha_vergi, cha_ebelge_turu, cha_belge_no " +
        "FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 63 AND cha_iptal = 0 ORDER BY cha_tarihi DESC";
      const { ok, data, status } = await mikroPost('SqlVeriOkuV2', { SQLSorgu: sql });
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) {
        return res.status(502).json({ success: false, error: (r0?.ErrorMessage as string) || `HTTP ${status}` });
      }
      const rows = firstArrayIn(mikroData(data));
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
  app.post('/api/admin/cleanup-dummy-inventory', requireAuth, requireAdmin, async (req: Request, res: Response) => {
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
  app.post('/api/mikro/fatura/kaydet', requireAuth, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const parsed = validate(FaturaKaydetSchema, req.body, res);
    if (!parsed) return;
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
        void mirrorMikroInsert('mikro_stok_hareketleri',
          (satirlar as unknown as Record<string, unknown>[]).map(s => ({ ...s, __kaynak: 'fatura_push' })), STH_COLS);
        void mirrorMikroInsert('mikro_cari_hesap_hareketleri',
          [{ ...evrak, detay: undefined, cha_meblag: toplamTutar, cha_belge_no: mikroFaturaNo, __kaynak: 'fatura_push' }], CHA_COLS);
      }
      if (adminDb && firebaseId && success) {
        await adminDb.collection('orders').doc(firebaseId).set({
          mikroFaturaNo,
          ettn,
          hasInvoice:      true,
          mikroFaturaDate: faturaDate,
          mikroSynced:     true,
          mikroSyncedAt:   pgServerTimestamp(),
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
            updatedAt: pgServerTimestamp(),
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
        syncedAt: pgServerTimestamp(),
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
        syncedAt: pgServerTimestamp(),
      }, { merge: true });
      await writeAuditLog(reqActor(req), 'Mikro KDV Özeti Çekme', `${period} dönemi KDV özeti alındı`);
      res.json({ success: true, period, data: md, duration: Date.now() - t0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Mikro Gelen e-Fatura Kabul / Ret ────────────────────────────────────────
  // POST /api/mikro/gelen-fatura/kabul  — GİB üzerinden gelen e-faturayı kabul et
  // POST /api/mikro/gelen-fatura/ret    — GİB üzerinden gelen e-faturayı reddet
  // Body: { faturaGuid: string, firebaseId?: string }   (ret için: aciklama?: string)
  // Endpoint'ler Mikro destek tarafından 2026-06-11'de onaylandı.

  app.post('/api/mikro/gelen-fatura/kabul', requireAuth, async (req: Request, res: Response) => {
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
          gibDurumu: 'kabul',
          gibKabulAt: pgServerTimestamp(),
        }, { merge: true });
      }

      res.json({ success: isOk, data: r0?.Data ?? null, duration: Date.now() - t0, error: errorMsg });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/mikro/gelen-fatura/ret', requireAuth, async (req: Request, res: Response) => {
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

  app.post('/api/parasut/import/cari', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const creds = await getParasutCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });
    if (!adminDb) return res.status(503).json({ success: false, error: 'DB yok.' });
    const companyId = (req as Request & { uid: string }).uid;
    const t0 = Date.now();
    try {
      const contacts = await parasutGetAll(creds, 'contacts');
      const leadSnap = await adminDb.collection('leads').get();
      const byParasutId = new Map<string, PgDocRef>();
      for (const d of leadSnap.docs) {
        const pid = (d.data().parasutId as string) || '';
        if (pid) byParasutId.set(pid, d.ref);
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
        };
        const ref = byParasutId.get(pid);
        if (ref) { batch.update(ref, fields); updated++; }
        else { batch.set(adminDb.collection('leads').doc(), { ...fields, companyId, status: 'Active', createdAt: pgServerTimestamp() }); created++; }
        if (++ops >= 400) await flush();
      }
      await flush();
      await writeAuditLog(reqActor(req), 'Paraşüt Cari İçe Aktarma', `${created} yeni / ${updated} güncel`);
      res.json({ success: true, created, updated, total: contacts.length, duration: Date.now() - t0 });
    } catch (e) { res.status(500).json({ success: false, error: (e as Error).message }); }
  });

  app.post('/api/parasut/import/stok', requireAuth, requireAdmin, async (req: Request, res: Response) => {
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
        };
        const ref = bySku.get(sku);
        if (ref) { batch.update(ref, fields); updated++; }
        else { batch.set(adminDb.collection('inventory').doc(), { ...fields, companyId, sku, category: 'Genel', lowStockThreshold: 5, costPrice: 0, createdAt: pgServerTimestamp() }); created++; }
        if (++ops >= 400) await flush();
      }
      await flush();
      await writeAuditLog(reqActor(req), 'Paraşüt Stok İçe Aktarma', `${created} yeni / ${updated} güncel (fiyat dahil)`);
      res.json({ success: true, created, updated, total: products.length, duration: Date.now() - t0 });
    } catch (e) { res.status(500).json({ success: false, error: (e as Error).message }); }
  });

  app.post('/api/parasut/fatura', requireAuth, async (req: Request, res: Response) => {
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
            updatedAt:       pgServerTimestamp(),
          };
          if (existing.empty) {
            await adminDb.collection('orders').add({ ...payload, createdAt: pgServerTimestamp() });
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
            updatedAt:          pgServerTimestamp(),
          };
          if (existing.empty) {
            await adminDb.collection('orders').add({ ...payload, createdAt: pgServerTimestamp() });
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
  app.post('/api/email/send', requireAuth, async (req: Request, res: Response) => {
    const body = validate(EmailSendSchema, req.body, res);
    if (!body) return;
    const result = await sendEmail(body.to, body.subject, body.html, body.from, body.replyTo);
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
        orderId, to: customerEmail, subject: subjectText, status, sentAt: pgServerTimestamp(),
      });
    }
    res.json({ success: true, id: result.id });
  });

  // ── Admin: User Invite ────────────────────────────────────────────────────
  // POST /api/admin/invite — sends invite email via Resend, stores invite doc in Firestore
  // Body: { email, role }
  app.post('/api/admin/invite', authLimiter, requireAuth, requireAdmin, async (req: Request, res: Response) => {
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
          updatedAt:  pgServerTimestamp(),
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
    const chatValidated = validate(AiChatSchema, { message: req.body?.message, context: req.body?.systemInstruction, language: req.body?.language }, res);
    if (!chatValidated) return;
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

    // Idempotency: Stripe aynı event'i birden çok kez teslim edebilir → bir kez işle.
    try {
      const evRef = adminDb.collection('stripeEvents').doc(event.id);
      if ((await evRef.get()).exists) return res.sendStatus(200);
      await evRef.set({ type: event.type, processedAt: pgServerTimestamp() });
    } catch (e) { console.warn('[Stripe webhook] idempotency check failed:', (e as Error).message); }

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
          createdAt: pgServerTimestamp(),
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
    // ── PostgreSQL: doğrudan ping ───────────────────────────────────────────
    const postgresOk = pgPool
      ? await timeout(pgPool.query('SELECT 1').then(() => true).catch(() => false), 4000, false)
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
  app.post('/api/superadmin/tenants/:companyId/status', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
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
  app.post('/api/superadmin/tenants/:companyId/update', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
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
  app.post('/api/superadmin/tenants/:companyId/payment-link', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
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
  app.post('/api/marketplace/search', requireAuth, async (req: Request, res: Response) => {
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
