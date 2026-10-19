// @vitest-environment node
/**
 * entegrasyonUcKapilari.zincir.test.ts — İÇ ROLLER ARASI DARALTMA (2026-10-17, şartname `.wf/SARTNAME-ic-rol-daraltma.md` § 2,
 * § 3, § 7): LUCA, Paraşüt, yapay zekâ, Shopify, SKU eşleştirme ve otomatik SAS uçlarının rol kapısı, GERÇEK `server.ts` +
 * GERÇEK express zinciriyle.
 *
 * ÜÇ KATMAN, TEK TABLO (`BEKLENEN`):
 *   Ç — kaynak çiti: rota satırındaki kapı metni ═ `BEKLENEN` ═ ortak tablo (`src/lib/entegrasyonUcKapilari.ts`). Tablodaki her
 *       satırın rotası var, her rotanın satırı var; MFA bugün olduğu her uçta KORUNUR; kapısı DEĞİŞMEYEN uçlar adıyla sabit.
 *   Z — çalışma zamanı zinciri: kayıtlı rotanın katman dizisi `BEKLENEN`'le aynı; rol katmanı tek başına koşturulunca kararı
 *       tablonun kararıyla aynı (boğaz sökülse de dış rol / rolsüz hesap geçemez).
 *   D — davranış (gerçek HTTP): 12 uç × 10 iç rol rol matrisi; Y1 model sunucuda; L4 kiracı sınırı; S1 `raw` yok; S2 dizi yok.
 *
 * TABLOLAR ELLE YAZILIR (rbac.ts'ten TÜRETİLMEZ): kural ya da ekran değişince bu test BİLİNÇLİ güncellenir.
 *
 * SAHTE OLANLAR (yalnız süreç dışına çıkan her şey — düzenek `kucukKapanislar.zincir.test.ts` ile AYNI kalıp): Firebase belirteç
 * doğrulayıcısı (belirteç = "<uid>|<e-posta>|<1|0>"), `pg` havuzu (süreç içi PGlite), pg-boss, node-cron, vite, `dotenv` (hiçbir
 * ortam dosyası YÜKLENMEZ), Gemini istemcisi (`@google/genai` `GoogleGenAI` — çağrılar kaydedilir) ve dışarı giden `fetch`
 * (kaydedilir, hiçbir yere gitmez; LUCA / Shopify yanıtları burada üretilir). Canlıya, Firebase'e, Mikro'ya, LUCA'ya, Shopify'a,
 * Paraşüt'e, Gemini'ye istek YOK. Sunucu `PORT=0` ile boş bir kapıda açılır ve `afterAll`'da kapatılır.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { ThinkingLevel } from '@google/genai';
import { APP_ROLES, EXTERNAL_ROLES, STAFF_ROLES, hasExplicitRule, isAllowed, type AppRole } from '../lib/rbac';
import * as tabloModulu from '../lib/entegrasyonUcKapilari';
import { ENTEGRASYON_UC_KAPILARI, entegrasyonUcKapisindanGecer, type EntegrasyonKapiliUc } from '../lib/entegrasyonUcKapilari';
import { MIKRO_UC_KAPILARI } from '../lib/mikroUcKapilari';
import { SRC_KOK, gorece, kodSatirlari } from '../test/kaynakTarama';

// ── Sahteler (yalnız süreç dışına çıkanlar) ────────────────────────────────────────────────────────────────────────────────
vi.mock('dotenv', () => ({ default: { config: () => ({ parsed: {} }) }, config: () => ({ parsed: {} }) }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    // Belirteç biçimi: "<uid>|<e-posta>|<1|0>" — imza yok; yalnız bu sınamada.
    verifyIdToken: async (t: string) => {
      const [uid, email, v] = String(t).split('|');
      if (!uid || !email) throw new Error('geçersiz belirteç');
      return { uid, email, email_verified: v === '1' };
    },
    revokeRefreshTokens: async () => undefined,
  }),
}));
vi.mock('pg-boss', () => ({
  PgBoss: class { on() {} async start() {} async createQueue() {} async work() {} async send() { return null; } async stop() {} },
}));
vi.mock('node-cron', () => ({ default: { schedule: () => ({ stop() {}, start() {} }), validate: () => true } }));
vi.mock('vite', () => ({ createServer: async () => ({ middlewares: (_q: unknown, _s: unknown, n: () => void) => n() }) }));
vi.mock('pg', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  (globalThis as Record<string, unknown>).__icRolPg = db;
  const q = async (text: unknown, params?: unknown[]) => {
    let sql = String(text); let p = params;
    if (text && typeof text === 'object') { const o = text as { text: string; values?: unknown[] }; sql = o.text; p = o.values; }
    if (!p || p.length === 0) {
      const r = await db.exec(sql);
      const son = r[r.length - 1];
      if (!son) return { rows: [], rowCount: null };
      return { rows: son.rows, rowCount: son.affectedRows ?? son.rows.length };
    }
    const r = await db.query(sql, p);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  class Pool { query = q; async connect() { return { query: q, release() {} }; } on() {} async end() {} }
  class Client { query = q; async connect() {} async end() {} on() {} }
  return { default: { Pool, Client }, Pool, Client };
});
// Gemini: gerçek modülün enum'ları (ThinkingLevel, Type) KALIR; yalnız istemci sahte — aldığı yapılandırma kaydedilir.
vi.mock('@google/genai', async (orig) => {
  const gercek = await orig<typeof import('@google/genai')>();
  const cagrilar: Array<{ ne: 'generateContent' | 'chats.create'; arg: Record<string, unknown> }> = [];
  (globalThis as Record<string, unknown>).__icRolGemini = cagrilar;
  // İki ajan şemasını da karşılayan yanıt (zod nesneleri fazladan alanı atar); talep tahmini de bu metni JSON olarak ayrıştırır.
  const YANIT = JSON.stringify({ ozet: 'sınama özeti', oneriler: [], tedarikciGruplari: [], riskNotlari: [] });
  class SahteGemini {
    models = { generateContent: async (a: Record<string, unknown>) => { cagrilar.push({ ne: 'generateContent', arg: a }); return { text: YANIT }; } };
    chats = {
      create: (a: Record<string, unknown>) => {
        cagrilar.push({ ne: 'chats.create', arg: a });
        return { sendMessage: async () => ({ text: 'tamam' }) };
      },
    };
  }
  return { ...gercek, GoogleGenAI: SahteGemini };
});

vi.setConfig({ testTimeout: 90_000 });

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TABLOLAR (elle)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** Halka etiketi: kimlik / MFA / personel kapısı adıyla; koleksiyon kuralı `koleksiyon:eylem`. */
type Halka = 'requireAuth' | 'requireMfaVerified' | 'requireStaff' | `${string}:${'read' | 'write'}`;

/** Yeni zincir (§ 2 + § 7). Rol kapısı `requireStaff`'ın YERİNE geçer; MFA bugün olduğu her uçta kalır. */
const BEKLENEN: Record<string, readonly Halka[]> = {
  'GET /api/luca/kontor': ['requireAuth', 'eBelgeler:read'],                                         // L1 — MFA'sız (GET kalıbı)
  'POST /api/luca/fatura-gonder': ['requireAuth', 'requireMfaVerified', 'invoices:write'],           // L2 — LA (2026-10-19): kapı aynen, uç 400
  'POST /api/luca/sync/yevmiye': ['requireAuth', 'requireMfaVerified', 'journalEntries:write'],      // L3
  'POST /api/luca/sync/stok': ['requireAuth', 'requireMfaVerified', 'inventory:write'],              // L4
  'POST /api/luca/sync/fatura': ['requireAuth', 'requireMfaVerified', 'invoices:write'],             // L5 / K4 — LA: kapı aynen, uç 400
  'POST /api/parasut/fatura': ['requireAuth', 'requireMfaVerified', 'invoices:write'],               // P1 / K3
  'POST /api/ai/satis-ajani': ['requireAuth', 'invoices:read', 'requireMfaVerified'],                // Y2
  'POST /api/ai/satinalma-ajani': ['requireAuth', 'purchaseOrders:read', 'requireMfaVerified'],      // Y3
  'POST /api/shopify/draft-order': ['requireAuth', 'requireMfaVerified', 'orders:write'],            // S1
  'POST /api/shopify/sync': ['requireAuth', 'requireMfaVerified', 'orders:read'],                    // S2 / K1
  'POST /api/sku-mapping/auto-match': ['requireAuth', 'skuMappings:write', 'requireMfaVerified'],    // S3
  'POST /api/inventory/auto-reorder': ['requireAuth', 'purchaseOrders:write', 'requireMfaVerified'], // A1 / K3
};
/** Taban (yayin-15 = ba38f55) zincirleri — § 7 «Ölçülen Bugün zincirleri». MFA değişmezinin karşılaştırma noktası. */
const TABAN: Record<string, readonly Halka[]> = {
  'GET /api/luca/kontor': ['requireAuth'],
  'POST /api/luca/fatura-gonder': ['requireAuth', 'requireMfaVerified'],
  'POST /api/luca/sync/yevmiye': ['requireAuth', 'requireMfaVerified'],
  'POST /api/luca/sync/stok': ['requireAuth', 'requireMfaVerified'],
  'POST /api/luca/sync/fatura': ['requireAuth', 'requireMfaVerified', 'requireStaff'],
  'POST /api/parasut/fatura': ['requireAuth', 'requireMfaVerified', 'requireStaff'],
  'POST /api/ai/satis-ajani': ['requireAuth', 'requireStaff', 'requireMfaVerified'],
  'POST /api/ai/satinalma-ajani': ['requireAuth', 'requireStaff', 'requireMfaVerified'],
  'POST /api/shopify/draft-order': ['requireAuth', 'requireMfaVerified'],
  'POST /api/shopify/sync': ['requireAuth', 'requireMfaVerified', 'requireStaff'],
  'POST /api/sku-mapping/auto-match': ['requireAuth', 'requireStaff', 'requireMfaVerified'],
  'POST /api/inventory/auto-reorder': ['requireAuth', 'requireStaff', 'requireMfaVerified'],
};
/** Bu işte kapısı DEĞİŞMEYEN (§ 2 L6, Y1): tabloda YOK, zinciri adıyla sabit. */
const DEGISMEYEN: Record<string, readonly Halka[]> = {
  'GET /api/luca/status': ['requireAuth', 'requireStaff'],
  'POST /api/ai/generate': ['requireAuth', 'requireStaff', 'requireMfaVerified'],
  'POST /api/ai/chat': ['requireAuth', 'requireStaff', 'requireMfaVerified'],
  'POST /api/ai/demand-forecast': ['requireAuth', 'requireStaff', 'requireMfaVerified'],
};
/** Rotanın kaynak dosyası. */
const SERVER = path.join(SRC_KOK, '..', 'server.ts');
const R = (ad: string): string => path.join(SRC_KOK, 'server', 'routes', ad);
const DOSYA: Record<string, string> = {
  'GET /api/luca/kontor': SERVER, 'POST /api/luca/fatura-gonder': SERVER, 'POST /api/luca/sync/yevmiye': SERVER,
  'POST /api/luca/sync/stok': SERVER, 'POST /api/luca/sync/fatura': SERVER, 'GET /api/luca/status': SERVER,
  'POST /api/sku-mapping/auto-match': SERVER, 'POST /api/inventory/auto-reorder': SERVER,
  'POST /api/parasut/fatura': R('erpRoutes.ts'),
  'POST /api/ai/satis-ajani': R('ticaretAjaniRoutes.ts'), 'POST /api/ai/satinalma-ajani': R('ticaretAjaniRoutes.ts'),
  'POST /api/ai/generate': R('aiRoutes.ts'), 'POST /api/ai/chat': R('aiRoutes.ts'), 'POST /api/ai/demand-forecast': R('aiRoutes.ts'),
  'POST /api/shopify/draft-order': R('kanalRoutes.ts'), 'POST /api/shopify/sync': R('kanalRoutes.ts'),
};
/** Kuraldan geçen iç / dış roller — ELLE (rbac.ts değişirse bilinçli güncellenir; Ç-2 gerçek kuralla eşitliğini sınar). */
const GECEN: Record<string, readonly AppRole[]> = {
  'eBelgeler:read': ['Admin', 'Manager', 'Accounting'],
  'invoices:write': ['Admin', 'Manager', 'Accounting'],
  'invoices:read': ['Admin', 'Manager', 'Sales', 'Accounting'],
  'journalEntries:write': ['Admin', 'Accounting'],
  'inventory:write': ['Admin', 'Manager', 'Logistics', 'Purchasing'],
  'purchaseOrders:read': ['Admin', 'Manager', 'Logistics', 'Accounting', 'Purchasing'],
  'purchaseOrders:write': ['Admin', 'Manager', 'Purchasing'],
  'skuMappings:write': ['Admin', 'Manager', 'Sales', 'Logistics'],
  'orders:write': ['Admin', 'Manager', 'Sales', 'Logistics'],
  'orders:read': ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'Purchasing'],
};
const kural = (anahtar: string): string => {
  const k = BEKLENEN[anahtar].find(h => h.includes(':'));
  if (!k) throw new Error(`${anahtar}: BEKLENEN zincirinde koleksiyon kuralı yok`);
  return k;
};
const gecenRoller = (anahtar: string): readonly AppRole[] => {
  const r = GECEN[kural(anahtar)];
  if (!r) throw new Error(`GECEN tablosunda '${kural(anahtar)}' yok`);
  return r;
};
const sirali = (a: readonly string[]): string[] => [...a].sort();
const TABLO_ANAHTARLARI = Object.keys(ENTEGRASYON_UC_KAPILARI) as EntegrasyonKapiliUc[];

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// KAYNAK ÇİTİ (sunucu açılmadan da koşar)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const kacis = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HALKA_DESENI = /(?:C\.)?(requireAuth|requireMfaVerified|requireStaff)(?: as never)?|(?:C\.)?requireCollectionAccess\('([A-Za-z]+)', '(read|write)'\)/g;
/** Rota satırını bulur (TAM bir kez) ve halkalarını etiketler. Tanınmayan halka (takma ad, değişkenli kural) fırlatır. */
function kaynakZinciri(anahtar: string): Halka[] {
  const [yontem, yol] = anahtar.split(' ');
  const dosya = DOSYA[anahtar];
  if (!dosya) throw new Error(`${anahtar}: kaynak dosyası tabloda yok`);
  const desen = new RegExp(`^app\\.${yontem.toLowerCase()}\\((['"])${kacis(yol)}\\1, (.+), async \\(_?req: Request, res: Response\\) => \\{$`);
  const bulunan = kodSatirlari(dosya).map(s => s.kod.trim()).filter(k => desen.test(k));
  if (bulunan.length !== 1) throw new Error(`${gorece(dosya)}: '${anahtar}' rota satırı ${bulunan.length} kez bulundu (TAM bir kez olmalı)`);
  const zincir = desen.exec(bulunan[0])?.[2] ?? '';
  const parcalar = [...zincir.matchAll(HALKA_DESENI)];
  if (parcalar.map(m => m[0]).join(', ') !== zincir) throw new Error(`${anahtar}: zincirde tanınmayan halka — ${zincir}`);
  return parcalar.map(m => (m[1] ? m[1] : `${m[2]}:${m[3]}`) as Halka);
}

describe('kaynak çiti — rota satırı ═ BEKLENEN ═ ortak tablo', () => {
  it('Ç-1 — tablo = BEKLENEN: tablodaki her satırın rotası var, her rotanın satırı var; anahtar ve kural birebir', () => {
    expect(sirali(TABLO_ANAHTARLARI)).toEqual(sirali(Object.keys(BEKLENEN)));
    expect(TABLO_ANAHTARLARI).toHaveLength(12);
    for (const a of TABLO_ANAHTARLARI) {
      const [k, e] = ENTEGRASYON_UC_KAPILARI[a];
      expect(`${k}:${e}`, a).toBe(kural(a));
    }
    // Modül yalnız tabloyu ve tek soru işlevini dışa verir (kopya yardımcı / ikinci tablo yok).
    expect(sirali(Object.keys(tabloModulu))).toEqual(['ENTEGRASYON_UC_KAPILARI', 'entegrasyonUcKapisindanGecer']);
    // İki tablo AYRIŞIK: aynı uç iki tabloda iki ayrı kapıyla yazılamaz.
    expect(TABLO_ANAHTARLARI.filter(a => a in MIKRO_UC_KAPILARI)).toEqual([]);
  });

  it('Ç-2 — rota satırındaki kapı metni BEKLENEN zinciriyle AYNI (12 uç); kapısı değişmeyen 4 uç adıyla sabit', () => {
    for (const a of Object.keys(BEKLENEN)) expect(kaynakZinciri(a), a).toEqual(BEKLENEN[a]);
    for (const a of Object.keys(DEGISMEYEN)) expect(kaynakZinciri(a), a).toEqual(DEGISMEYEN[a]);
    // Kapısı değişmeyen uçlar tabloda DEĞİL (istemci onları sormuyor; personel kapısı tabloyla anlatılamaz).
    expect(Object.keys(DEGISMEYEN).filter(a => a in ENTEGRASYON_UC_KAPILARI)).toEqual([]);
  });

  it('Ç-3 — MFA KORUNUR: tabanda MFA olan her uçta yeni zincirde de var, olmayanda (L1) yok; `requireStaff` hiçbirinde kalmadı', () => {
    for (const a of Object.keys(BEKLENEN)) {
      expect(BEKLENEN[a].includes('requireMfaVerified'), `${a} — MFA`).toBe(TABAN[a].includes('requireMfaVerified'));
      expect(BEKLENEN[a][0], a).toBe('requireAuth');
      expect(BEKLENEN[a].filter(h => h.includes(':')), a).toHaveLength(1);
      expect(BEKLENEN[a].includes('requireStaff'), a).toBe(false);
      // Rol kapısı `requireStaff`'ın YERİNE geçer: personel kapısı olan tabanda AYNI sırada; olmayanda zincirin sonunda.
      const yeri = BEKLENEN[a].findIndex(h => h.includes(':'));
      const tabanYeri = TABAN[a].indexOf('requireStaff');
      expect(yeri, a).toBe(tabanYeri >= 0 ? tabanYeri : TABAN[a].length);
    }
    expect(Object.keys(BEKLENEN).filter(a => !BEKLENEN[a].includes('requireMfaVerified'))).toEqual(['GET /api/luca/kontor']);
  });

  it('Ç-4 — çit kendi desenini sınar: tanınmayan halka, eksik rota, çift rota fırlatır', () => {
    expect(() => kaynakZinciri('POST /api/yok/boyle-bir-uc')).toThrow(/kaynak dosyası/);
    const zincir = "requireAuth, ozelKapi, requireCollectionAccess('invoices', 'write')";
    expect([...zincir.matchAll(HALKA_DESENI)].map(m => m[0]).join(', ')).not.toBe(zincir);
    expect([...'C.requireAuth as never, C.requireCollectionAccess(\'invoices\', \'read\')'.matchAll(HALKA_DESENI)].map(m => m[1] ?? `${m[2]}:${m[3]}`))
      .toEqual(['requireAuth', 'invoices:read']);
  });

  it('Ç-5 — politika: her kural AÇIK tanımlı; dış rol ve rolsüz hesap GEÇEMEZ (boğaz sökülse de kapalı); elle yazılan GECEN = gerçek kural', () => {
    for (const a of TABLO_ANAHTARLARI) {
      const [k, e] = ENTEGRASYON_UC_KAPILARI[a];
      expect(hasExplicitRule(k), `${k} açık kural`).toBe(true);
      for (const dis of EXTERNAL_ROLES) expect(isAllowed(dis, k, e), `${a} × ${dis}`).toBe(false);
      expect(isAllowed(null, k, e)).toBe(false);
      expect(sirali(APP_ROLES.filter(r => isAllowed(r, k, e))), `${a} GECEN`).toEqual(sirali(gecenRoller(a)));
      // İstemci süzgeci sunucu kapısıyla AYNI kararı verir.
      for (const r of APP_ROLES) expect(entegrasyonUcKapisindanGecer(r, a), `${a} × ${r}`).toBe(gecenRoller(a).includes(r));
      expect(entegrasyonUcKapisindanGecer(null, a)).toBe(false);
      expect(entegrasyonUcKapisindanGecer(undefined, a)).toBe(false);
    }
    // Tip dışı çağrı (tabloda olmayan / miras anahtar) kapalı başarısızlıktır — fırlatmaz, geçirmez.
    for (const ad of ['GET /api/luca/status', 'POST /api/ai/generate', 'constructor', 'toString', '__proto__', '']) {
      expect(APP_ROLES.filter(r => entegrasyonUcKapisindanGecer(r, ad as EntegrasyonKapiliUc)), `'${ad}'`).toEqual([]);
    }
  });

  it('Ç-6 — ortak çekirdek: iki tablonun soru işlevi AYNI çekirdeği çağırır; karar (`isAllowed`) yalnız çekirdekte', () => {
    for (const ad of ['entegrasyonUcKapilari.ts', 'mikroUcKapilari.ts']) {
      const kod = kodSatirlari(path.join(SRC_KOK, 'lib', ad)).map(s => s.kod.trim());
      expect(kod.filter(k => /^return tablodakiUcKapisindanGecer\((ENTEGRASYON|MIKRO)_UC_KAPILARI, rol, uc\);$/.test(k)), ad).toHaveLength(1);
      expect(kod.filter(k => /\bisAllowed\(|hasOwnProperty/.test(k)), ad).toEqual([]);
    }
    const cekirdek = kodSatirlari(path.join(SRC_KOK, 'lib', 'ucKapisiCekirdegi.ts')).map(s => s.kod.trim());
    expect(cekirdek.filter(k => k === "if (!rol || !Object.prototype.hasOwnProperty.call(tablo, uc)) return false;")).toHaveLength(1);
    expect(cekirdek.filter(k => k === 'return isAllowed(rol, koleksiyon, eylem);')).toHaveLength(1);
  });

  it('Ç-7 — K2: `resolveGeminiModel` parametresiz — iki bağlam tipi ve server.ts tanımı; gövdeden `model` okuyan satır yok', () => {
    const tip = /^resolveGeminiModel: \(\) => string;$/;
    for (const ad of ['aiRoutes.ts', 'ticaretAjaniRoutes.ts']) {
      const kod = kodSatirlari(R(ad)).map(s => s.kod.trim());
      expect(kod.filter(k => tip.test(k)), ad).toHaveLength(1);
      expect(kod.filter(k => /resolveGeminiModel\([^)]/.test(k)), `${ad}: argümanlı çağrı`).toEqual([]);
    }
    const sunucu = kodSatirlari(SERVER).map(s => s.kod.trim());
    expect(sunucu.filter(k => k === 'const resolveGeminiModel = (): string => geminiKeyCache?.model || DEFAULT_GEMINI_MODEL;')).toHaveLength(1);
    // Üretim / sohbet işleyicisi gövdeden `model` ayıklamaz.
    const ai = kodSatirlari(R('aiRoutes.ts')).map(s => s.kod);
    expect(ai.filter(k => /\bmodel\b[^:]*=\s*req\.body|\{[^}]*\bmodel\b[^}]*\}\s*=\s*req\.body|req\.body\??\.model\b/.test(k))).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DÜZENEK — gerçek server.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

interface Pg { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }
const G = globalThis as Record<string, unknown>;
const pg = (): Pg => G.__icRolPg as Pg;
const geminiCagrilari = (): Array<{ ne: string; arg: Record<string, unknown> }> => G.__icRolGemini as Array<{ ne: string; arg: Record<string, unknown> }>;

interface Katman { name?: string; method?: string; handle: (...a: unknown[]) => unknown; route?: { path: unknown; methods: Record<string, boolean>; stack: Katman[] } }
interface Uygulama { router: { stack: Katman[] } }

let sunucu: http.Server | undefined;
let uygulama: Uygulama | undefined;
let kapiNo = 0;
let yuklemeDizini = '';
const gercekFetch = globalThis.fetch;
/** Sunucunun DIŞARI yapmaya çalıştığı her istek (hiçbiri gitmez). */
const disari: Array<{ yontem: string; url: string; belirtec: string | null; govde: string }> = [];

const KIRACI = 'CETPA';
const BASKA_KIRACI = 'BASKA-FIRMA';
const SUPER_EPOSTA = 'super@example.test';
const SAHTE_SHOPIFY = 'sinama-shopify-belirteci';
const GIZLI_EPOSTA = 'gizli.musteri@example.test';
const GIZLI_TELEFON = '+90 555 000 11 22';
const COZULEN_MODEL = 'gemini-sinama-modeli';
const eposta = (uid: string): string => `${uid.toLowerCase()}@example.test`;
const belirtec = (uid: string, ep = eposta(uid), dogrulanmis = true): Record<string, string> => ({ Authorization: `Bearer ${uid}|${ep}|${dogrulanmis ? 1 : 0}` });
const icUid = (rol: AppRole): string => `ic-${rol}`;
const ic = (rol: AppRole): Record<string, string> => belirtec(icUid(rol));
const SUPER = belirtec('super-1', SUPER_EPOSTA);

interface Yanit { s: number; j: Record<string, unknown>; metin: string }
let ipSayaci = 0;
const sonrakiIp = (): string => { ipSayaci++; return `10.${(ipSayaci >> 16) & 255}.${(ipSayaci >> 8) & 255}.${ipSayaci & 255}`; };
function istek(yontem: string, yol: string, basliklar: Record<string, string> = {}, govde?: unknown): Promise<Yanit> {
  return new Promise((coz, reddet) => {
    const veri = govde === undefined ? undefined : JSON.stringify(govde);
    const q = http.request({
      host: '127.0.0.1', port: kapiNo, method: yontem, path: yol, agent: false,
      headers: {
        'X-Forwarded-For': sonrakiIp(), ...basliklar,
        ...(veri !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(veri)) } : {}),
      },
    }, r => {
      const durum = r.statusCode;
      if (durum === undefined) { reddet(new Error(`durum kodu yok: ${yontem} ${yol}`)); return; }
      const parcalar: Buffer[] = [];
      r.on('data', (p: Buffer) => parcalar.push(p));
      r.on('end', () => {
        const metin = Buffer.concat(parcalar).toString('utf8');
        let j: Record<string, unknown> = {};
        try { const o: unknown = JSON.parse(metin); if (o && typeof o === 'object' && !Array.isArray(o)) j = o as Record<string, unknown>; } catch { /* düz metin */ }
        coz({ s: durum, j, metin });
      });
    });
    q.setTimeout(20_000, () => q.destroy(new Error(`zaman aşımı: ${yontem} ${yol}`)));
    q.on('error', reddet);
    if (veri !== undefined) q.write(veri);
    q.end();
  });
}
const bekle = async (kosul: () => boolean | Promise<boolean>, ms: number, ne: string): Promise<void> => {
  const son = Date.now() + ms;
  while (Date.now() < son) { if (await kosul()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(`beklenen olmadı (${ms} ms): ${ne}`);
};
const belgeKoy = (coll: string, id: string, data: Record<string, unknown>): Promise<unknown> =>
  pg().query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data', [coll, id, JSON.stringify(data)]);
const belgeOku = async (coll: string, id: string): Promise<Record<string, unknown> | undefined> =>
  (await pg().query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id])).rows[0]?.data as Record<string, unknown> | undefined;
const belgeSil = (coll: string, id: string): Promise<unknown> => pg().query('DELETE FROM docs WHERE coll = $1 AND id = $2', [coll, id]);

// ── Rota dökümü: gerçek uygulamanın yönlendiricisinden ─────────────────────────────────────────────────────────────────────
interface Uc { yontem: string; desen: string; katmanlar: Katman[]; adlar: string[] }
function rotaDokumu(): Uc[] {
  if (!uygulama) throw new Error('uygulama yakalanmadı');
  const uclar: Uc[] = [];
  const gez = (yigin: Katman[]): void => {
    for (const k of yigin) {
      const alt = (k.handle as unknown as { stack?: Katman[] }).stack;
      if (!k.route) { if (Array.isArray(alt)) gez(alt); continue; }
      const yollar = Array.isArray(k.route.path) ? k.route.path : [k.route.path];
      for (const y of yollar) for (const [m, acik] of Object.entries(k.route.methods)) {
        if (!acik || typeof y !== 'string') continue;
        const katmanlar = k.route.stack.filter(s => !s.method || s.method === m);
        uclar.push({ yontem: m.toUpperCase(), desen: y, katmanlar, adlar: katmanlar.map(s => s.name || '(adsız)') });
      }
    }
  };
  gez(uygulama.router.stack);
  return uclar;
}
const ucBul = (anahtar: string): Uc => {
  const [yontem, desen] = anahtar.split(' ');
  const bulunan = rotaDokumu().filter(u => u.yontem === yontem && u.desen === desen);
  expect(bulunan, `${anahtar} tam bir kez kayıtlı olmalı`).toHaveLength(1);
  return bulunan[0];
};
/** Sahte istek / yanıtla TEK bir zincir katmanını koşturur (işleyiciye ulaşmadan kapının kararını ölçer). */
async function katmanKostur(k: Katman, req: Record<string, unknown>): Promise<{ ileri: number; durum: number; govde: unknown }> {
  let ileri = 0; let durum = 0; let govde: unknown;
  const yanit = { status(kod: number) { durum = kod; return yanit; }, json(g: unknown) { govde = g; return yanit; } };
  await k.handle({ headers: {}, ...req }, yanit, () => { ileri++; });
  return { ileri, durum, govde };
}

// ── Sahte dış dünya (fetch) ────────────────────────────────────────────────────────────────────────────────────────────────
/** LUCA stok çekme yanıtı (L4 sınaması kurar). */
let lucaStoklari: Array<Record<string, unknown>> = [];
/** Shopify yanıtında listesi EKSİK gelecek dizi (S2 «sayı uydurulmaz» sınaması kurar); `null` = ikisi de dolu. */
let shopifyEksikListe: 'products' | 'orders' | null = null;
const sahteYanit = (govde: unknown, durum = 200): Response => new Response(JSON.stringify(govde), { status: durum, headers: { 'content-type': 'application/json' } });
function sahteFetch(url: string, init?: RequestInit): Response {
  if (/\.myshopify\.com\/admin\/api\/[^/]+\/products\.json/.test(url)) {
    if (shopifyEksikListe === 'products') return sahteYanit({});
    return sahteYanit({ products: [{ id: 1, title: 'DYO Boya', variants: [{ id: 11, sku: 'DYO-001' }] }, { id: 2, title: 'Fırça', variants: [{ id: 21, sku: 'FRC-1' }] }] });
  }
  if (/\.myshopify\.com\/admin\/api\/[^/]+\/orders\.json/.test(url)) {
    if (shopifyEksikListe === 'orders') return sahteYanit({});
    return sahteYanit({ orders: [{ id: 501, email: GIZLI_EPOSTA, phone: GIZLI_TELEFON, shipping_address: { address1: 'Gizli Sokak 1' } }] });
  }
  if (/\.myshopify\.com\/admin\/api\/[^/]+\/draft_orders\.json/.test(url)) {
    const g = JSON.parse(String(init?.body ?? '{}')) as { draft_order?: Record<string, unknown> };
    return sahteYanit({ draft_order: { id: 9001, order_number: 1001, admin_graphql_api_id: 'gid://shopify/DraftOrder/9001', invoice_url: 'https://cetpa.myshopify.com/fatura/9001', customer: { email: GIZLI_EPOSTA, phone: GIZLI_TELEFON }, ...g.draft_order } });
  }
  if (/^https:\/\/api\.luca\.com\.tr\/v1\/stoklar/.test(url)) return sahteYanit({ items: lucaStoklari });
  return sahteYanit({});
}

beforeAll(async () => {
  yuklemeDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-rol-daraltma-'));
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://sinama/yok';      // yalnız «PG var» dalını açar; havuz PGlite
  process.env.SESSION_TOKEN_SECRET = 'sinama-sirri';
  process.env.UPLOAD_DIR = yuklemeDizini;
  process.env.SUPER_ADMIN_EMAILS = SUPER_EPOSTA;
  // Kabuktan sızmış olabilecek dış sistem kimlikleri: bu sınama hiçbirini kullanmaz (değerleri okunmaz, yazdırılmaz).
  for (const ad of Object.keys(process.env)) {
    if (/^(VITE_)?(STRIPE|RESEND|LUCA|SHOPIFY|SMTP|GEMINI|ANTHROPIC|MIKRO|IYZICO|TRENDYOL|HEPSIBURADA|AMAZON|PARASUT|LOGO|SAP|DYNAMICS|DHL|UPS|FEDEX|YURTICI|MNG|ARAS|WHATSAPP|FIREBASE|GOOGLE_APPLICATION|OPS_|SERVER_TENANT_)/.test(ad)) delete process.env[ad];
  }
  globalThis.fetch = (async (girdi: unknown, init?: RequestInit) => {
    const url = String(typeof girdi === 'string' ? girdi : (girdi as { url?: string }).url ?? girdi);
    const h = new Headers(init?.headers);
    disari.push({ yontem: init?.method ?? 'GET', url: url.replace(/\?.*$/, ''), belirtec: h.get('X-Shopify-Access-Token'), govde: typeof init?.body === 'string' ? init.body : '' });
    return sahteFetch(url, init);
  }) as typeof fetch;

  const dinleyiciCasusu = vi.spyOn(http, 'createServer');
  await import('../../server.ts');
  await bekle(() => dinleyiciCasusu.mock.results.some(r => r.type === 'return'), 150_000, 'sunucu dinleyicisi kuruldu');
  const cagri = dinleyiciCasusu.mock.calls.findIndex(a => typeof a[0] === 'function');
  uygulama = dinleyiciCasusu.mock.calls[cagri][0] as unknown as Uygulama;
  sunucu = dinleyiciCasusu.mock.results[cagri].value as http.Server;
  dinleyiciCasusu.mockRestore();
  await bekle(() => sunucu?.listening === true, 30_000, 'sunucu dinliyor');
  kapiNo = (sunucu.address() as AddressInfo).port;
  await bekle(async () => {
    const r = await pg().query("SELECT to_regclass('docs') AS d, to_regclass('mfa_secrets') AS m, to_regclass('mikro_stok_hareketleri') AS s");
    const t = r.rows[0]; return !!(t.d && t.m && t.s);
  }, 60_000, 'tablolar hazır');

  // Gerçek kiracı = CETPA: her iç rolden bir kullanıcı + kritik stoklu bir kart (otomatik SAS / satın alma ajanı için).
  for (const rol of STAFF_ROLES) await belgeKoy('users', icUid(rol), { email: eposta(icUid(rol)), role: rol, companyId: KIRACI });
  for (const [uid, rol] of [['dis-b2b', 'B2B'], ['dis-bayi', 'Dealer']] as const) await belgeKoy('users', uid, { email: eposta(uid), role: rol, companyId: KIRACI });
  await belgeKoy('users', 'rolsuz-1', { email: eposta('rolsuz-1'), name: 'Yabancı' });
  await belgeKoy('inventory', 'mikro-DYO-001', { sku: 'DYO-001', name: 'DYO Boya 15 L', stockLevel: 1, lowStockThreshold: 5, companyId: KIRACI });
  // Yapay zekâ anahtarı + modeli arayüzün yolundan (Yönetici `settings/aiConfig` yazar → sunucu önbelleği tazelenir).
  const ayar = await istek('PUT', '/api/db/settings/aiConfig?merge=1', ic('Admin'), { geminiApiKey: 'sinama-anahtari', geminiModel: COZULEN_MODEL });
  expect(ayar.s, ayar.metin).toBe(200);
}, 240_000);

afterAll(async () => {
  globalThis.fetch = gercekFetch;
  delete process.env.SHOPIFY_ACCESS_TOKEN;
  const s = sunucu;
  if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  if (yuklemeDizini) fs.rmSync(yuklemeDizini, { recursive: true, force: true });
}, 30_000);

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('çalışma zamanı zinciri — kayıtlı rota = BEKLENEN; rol katmanının kararı = tablo', () => {
  /** Halka etiketi → express katman adı (koleksiyon kuralı fabrikadan döner, adsızdır). */
  const ad = (h: Halka): string => (h.includes(':') ? '<anonymous>' : h);

  it('Z-1 — 12 uç + kapısı değişmeyen 4 uç: katman adları BEKLENEN sırasıyla, ardından TEK işleyici', () => {
    for (const [a, zincir] of [...Object.entries(BEKLENEN), ...Object.entries(DEGISMEYEN)]) {
      expect(ucBul(a).adlar, a).toEqual([...zincir.map(ad), '<anonymous>']);
    }
  });

  it('Z-2 — rol katmanı tek başına: geçen rol `next`, kilitli iç rol / dış rol / rolsüz / belgesiz 403 «Bu veri için yetkiniz yok.»; süper yönetici geçer', async () => {
    for (const a of TABLO_ANAHTARLARI) {
      const u = ucBul(a);
      const kapi = u.katmanlar[BEKLENEN[a].findIndex(h => h.includes(':'))];
      const [yontem, desen] = a.split(' ');
      const kostur = (uid: string, ek: Record<string, unknown> = {}) => katmanKostur(kapi, { uid, method: yontem, originalUrl: desen, path: desen, ...ek });
      for (const rol of STAFF_ROLES) {
        const r = await kostur(icUid(rol));
        if (gecenRoller(a).includes(rol)) expect([a, rol, r.ileri, r.durum]).toEqual([a, rol, 1, 0]);
        else expect([a, rol, r.ileri, r.durum, r.govde]).toEqual([a, rol, 0, 403, { error: 'Bu veri için yetkiniz yok.' }]);
      }
      for (const uid of ['dis-b2b', 'dis-bayi', 'rolsuz-1', 'belgesiz-1']) {
        const r = await kostur(uid);
        expect([a, uid, r.ileri, r.durum]).toEqual([a, uid, 0, 403]);
      }
      const s = await kostur('super-1', { userEmail: SUPER_EPOSTA, emailVerified: true });
      expect([a, 'süper', s.ileri]).toEqual([a, 'süper', 1]);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('rol matrisi — gerçek HTTP, 12 uç × 10 iç rol (geçen: 2xx ya da 503 «yapılandırılmamış»; kilitli: kapının 403\'ü)', () => {
  /** Geçen rolün yanıtı. LUCA / Paraşüt kimliği YOK → 503 (kapıdan geçtiğinin kanıtı); Shopify belirteci ve Gemini sahte → 200.
   *  İki LUCA fatura ucu 2026-10-19'dan beri (LA) kimlik TANIMLIYKEN 400 `LUCA_FATURA_KAPALI` döner — 503 bu sınamada kapının
   *  geçildiğini göstermeye yeter; kapanış davranışı takipKoduVeLuca.zincir.test «LA»da (kimlik tanımlı, LUCA'ya istek 0). */
  const MATRIS: ReadonlyArray<{ anahtar: EntegrasyonKapiliUc; govde: unknown; gecen: number }> = [
    { anahtar: 'GET /api/luca/kontor', govde: undefined, gecen: 503 },
    { anahtar: 'POST /api/luca/fatura-gonder', govde: { invoiceId: 'f-1', invoiceData: {} }, gecen: 503 },
    { anahtar: 'POST /api/luca/sync/yevmiye', govde: { entries: [{ id: 'y-1' }] }, gecen: 503 },
    { anahtar: 'POST /api/luca/sync/stok', govde: {}, gecen: 503 },
    { anahtar: 'POST /api/luca/sync/fatura', govde: { orderId: 's-1' }, gecen: 503 },
    { anahtar: 'POST /api/parasut/fatura', govde: { order: { id: 's-1' } }, gecen: 503 },
    { anahtar: 'POST /api/ai/satis-ajani', govde: { cariKod: '120.01.999' }, gecen: 200 },
    { anahtar: 'POST /api/ai/satinalma-ajani', govde: {}, gecen: 200 },
    { anahtar: 'POST /api/shopify/draft-order', govde: { customerName: 'Şirin Yapı', lineItems: [{ title: 'DYO Boya', price: 10, quantity: 1 }] }, gecen: 200 },
    { anahtar: 'POST /api/shopify/sync', govde: {}, gecen: 200 },
    { anahtar: 'POST /api/sku-mapping/auto-match', govde: {}, gecen: 200 },
    { anahtar: 'POST /api/inventory/auto-reorder', govde: {}, gecen: 200 },
  ];
  const cagir = (a: EntegrasyonKapiliUc, b: Record<string, string>): Promise<Yanit> => {
    const satir = MATRIS.find(m => m.anahtar === a);
    if (!satir) throw new Error(`matriste yok: ${a}`);
    const [yontem, yol] = a.split(' ');
    return istek(yontem, yol, b, satir.govde);
  };

  it('matris tablonun TAMAMINI kapsar', () => {
    expect(sirali(MATRIS.map(m => m.anahtar))).toEqual(sirali(TABLO_ANAHTARLARI));
  });

  it('her iç rol tabloya göre: geçen beklenen yanıtı, kilitli kapının 403\'ünü alır (boğazın reddi değil — `code` yok)', async () => {
    process.env.SHOPIFY_ACCESS_TOKEN = SAHTE_SHOPIFY;
    try {
      const fark: string[] = [];
      for (const { anahtar, gecen } of MATRIS) for (const rol of STAFF_ROLES) {
        const r = await cagir(anahtar, ic(rol));
        const beklenen = gecenRoller(anahtar).includes(rol) ? gecen : 403;
        if (r.s !== beklenen) fark.push(`${rol} ${anahtar} → ${r.s} (beklenen ${beklenen}) ${r.metin.slice(0, 140)}`);
        if (beklenen === 403) expect(r.j, `${rol} ${anahtar}`).toEqual({ error: 'Bu veri için yetkiniz yok.' });
      }
      expect(fark, fark.join('\n')).toEqual([]);
    } finally { delete process.env.SHOPIFY_ACCESS_TOKEN; }
  }, 240_000);

  it('şartname § 3 / § 7 asgari çiftleri adıyla (kilitli 403, geçen kapıdan geçer)', async () => {
    const CIFTLER: ReadonlyArray<[EntegrasyonKapiliUc, AppRole[], AppRole[]]> = [
      ['POST /api/luca/fatura-gonder', ['Sales'], ['Accounting']],                     // L2
      ['POST /api/luca/sync/stok', ['Sales'], ['Logistics']],                          // L4
      ['POST /api/ai/satis-ajani', ['Logistics'], ['Sales']],                          // Y2
      ['POST /api/ai/satinalma-ajani', ['Sales'], ['Purchasing']],                     // Y3
      ['POST /api/shopify/draft-order', ['Accounting'], ['Sales']],                    // S1
      ['POST /api/sku-mapping/auto-match', ['Purchasing'], ['Logistics']],             // S3
      ['POST /api/shopify/sync', ['Quality', 'HR'], ['Accounting', 'Purchasing']],     // K1
      ['POST /api/parasut/fatura', ['Sales'], ['Accounting']],                         // P1
      ['POST /api/inventory/auto-reorder', ['Logistics'], ['Purchasing']],             // A1
    ];
    process.env.SHOPIFY_ACCESS_TOKEN = SAHTE_SHOPIFY;
    try {
      for (const [a, kilitli, gecen] of CIFTLER) {
        for (const rol of kilitli) expect([a, rol, (await cagir(a, ic(rol))).s]).toEqual([a, rol, 403]);
        for (const rol of gecen) expect([401, 403], `${a} × ${rol}`).not.toContain((await cagir(a, ic(rol))).s);
      }
    } finally { delete process.env.SHOPIFY_ACCESS_TOKEN; }
  });

  it('dış rol ve rolsüz hesap 12 uçta 403 (boğaz); süper yönetici (rolsüz sahip) hiçbir uçta 401 / 403 almaz', async () => {
    for (const uid of ['dis-b2b', 'dis-bayi', 'rolsuz-1']) for (const { anahtar } of MATRIS) {
      expect([uid, anahtar, (await cagir(anahtar, belirtec(uid))).s]).toEqual([uid, anahtar, 403]);
    }
    for (const { anahtar } of MATRIS) expect([401, 403], `süper × ${anahtar}`).not.toContain((await cagir(anahtar, SUPER)).s);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Y1 / K2 — model sunucuda; düşünme düzeyi korunur (sahte Gemini istemcisi)', () => {
  const son = (ne: string): Record<string, unknown> => {
    const c = geminiCagrilari().filter(x => x.ne === ne);
    const s = c[c.length - 1];
    if (!s) throw new Error(`Gemini '${ne}' çağrılmadı`);
    return s.arg;
  };
  const yapilandirma = (arg: Record<string, unknown>): Record<string, unknown> => (arg.config ?? {}) as Record<string, unknown>;

  it('/generate: gövdede `model: gemini-2.5-pro` → çağrılan model ÇÖZÜLEN model; `thinkingLevel: HIGH` korunur', async () => {
    const r = await istek('POST', '/api/ai/generate', ic('Sales'), { prompt: 'merhaba', model: 'gemini-2.5-pro', thinkingLevel: 'HIGH' });
    expect([r.s, r.j]).toEqual([200, { text: expect.any(String) }]);
    const a = son('generateContent');
    expect(a.model).toBe(COZULEN_MODEL);
    expect(yapilandirma(a).thinkingConfig).toEqual({ thinkingLevel: ThinkingLevel.HIGH });
    // Yanıt modeli söylemez (bugün alan yoktu — eklenmedi, ölçüldü).
    expect(Object.keys(r.j)).toEqual(['text']);
  });

  it('/chat: gövdede `model` → çözülen model; `highThinking: true` → `thinkingLevel = HIGH`; yoksa düşünme yapılandırması yok', async () => {
    const r = await istek('POST', '/api/ai/chat', ic('Logistics'), { message: 'merhaba', model: 'gemini-2.5-pro', highThinking: true });
    expect(r.s, r.metin).toBe(200);
    const a = son('chats.create');
    expect(a.model).toBe(COZULEN_MODEL);
    expect(yapilandirma(a).thinkingConfig).toEqual({ thinkingLevel: ThinkingLevel.HIGH });
    expect((await istek('POST', '/api/ai/chat', ic('Logistics'), { message: 'merhaba', model: 'gemini-2.5-pro' })).s).toBe(200);
    const b = son('chats.create');
    expect(b.model).toBe(COZULEN_MODEL);
    expect(yapilandirma(b).thinkingConfig).toBeUndefined();
  });

  it('talep tahmini ve satın alma ajanı da çözülen modeli kullanır (gövdedeki ad hiçbir uçta okunmaz)', async () => {
    expect((await istek('POST', '/api/ai/demand-forecast', ic('Manager'), { model: 'gemini-2.5-pro' })).s).toBe(200);
    expect(son('generateContent').model).toBe(COZULEN_MODEL);
    expect((await istek('POST', '/api/ai/satinalma-ajani', ic('Purchasing'), { model: 'gemini-2.5-pro' })).s).toBe(200);
    expect(son('generateContent').model).toBe(COZULEN_MODEL);
    expect(geminiCagrilari().filter(c => c.arg.model !== COZULEN_MODEL)).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('S1 / S2 — Shopify yanıtları kişisel veri taşımaz', () => {
  it('S1 — taslak sipariş yanıtında `raw` YOK; müşteri nesnesi (e-posta, telefon) yanıta sızmaz', async () => {
    process.env.SHOPIFY_ACCESS_TOKEN = SAHTE_SHOPIFY;
    try {
      const r = await istek('POST', '/api/shopify/draft-order', ic('Sales'), { customerName: 'Şirin Yapı', email: GIZLI_EPOSTA, lineItems: [{ title: 'DYO Boya', price: 10, quantity: 2 }] });
      expect(r.s, r.metin).toBe(200);
      expect(r.j).toEqual({ shopifyDraftOrderId: '#1001', shopifyAdminUrl: 'gid://shopify/DraftOrder/9001', invoiceUrl: 'https://cetpa.myshopify.com/fatura/9001' });
      expect(r.metin).not.toContain(GIZLI_EPOSTA);
      expect(r.metin).not.toContain(GIZLI_TELEFON);
    } finally { delete process.env.SHOPIFY_ACCESS_TOKEN; }
  });

  it('S2 / K1 — senkron yanıtında dizi YOK, yalnız sayılar; gövdedeki belirteç / mağaza adresi YOK SAYILIR; Muhasebe ve Satın Alma geçer', async () => {
    process.env.SHOPIFY_ACCESS_TOKEN = SAHTE_SHOPIFY;
    try {
      for (const rol of ['Accounting', 'Purchasing'] as const) {
        const once = disari.length;
        const r = await istek('POST', '/api/shopify/sync', ic(rol), { accessToken: 'saldirgan-belirteci', storeUrl: 'kotu-magaza.myshopify.com' });
        expect(r.s, r.metin).toBe(200);
        expect(r.j).toEqual({ message: "Shopify'dan 2 ürün, 1 sipariş okundu (Cetpa'ya aktarılmadı).", urunSayisi: 2, siparisSayisi: 1 });
        for (const gizli of [GIZLI_EPOSTA, GIZLI_TELEFON, 'Gizli Sokak']) expect(r.metin).not.toContain(gizli);
        const giden = disari.slice(once).filter(d => /myshopify\.com/.test(d.url));   // arka plan kur isteği karışmasın
        expect(giden.map(d => d.url)).toEqual([
          'https://cetpa.myshopify.com/admin/api/2024-01/products.json',
          'https://cetpa.myshopify.com/admin/api/2024-01/orders.json',
        ]);
        expect(giden.map(d => d.belirtec)).toEqual([SAHTE_SHOPIFY, SAHTE_SHOPIFY]);
      }
      for (const rol of ['Quality', 'HR'] as const) expect((await istek('POST', '/api/shopify/sync', ic(rol), {})).s).toBe(403);
    } finally { delete process.env.SHOPIFY_ACCESS_TOKEN; }
  });

  it('S2 — Shopify yanıtında liste yoksa sayı UYDURULMAZ («0 ürün okundu» denmez): 500 + hangi listenin eksik olduğu, sayı alanı yok', async () => {
    // Eskiden `(… || []).length` eksik listeyi «0 ürün, 0 sipariş senkronize edildi» diye başarı olarak gösteriyordu.
    process.env.SHOPIFY_ACCESS_TOKEN = SAHTE_SHOPIFY;
    try {
      for (const [eksik, ileti] of [['products', 'Shopify yanıtında ürün listesi yok.'], ['orders', 'Shopify yanıtında sipariş listesi yok.']] as const) {
        shopifyEksikListe = eksik;
        const r = await istek('POST', '/api/shopify/sync', ic('Admin'), {});
        expect([eksik, r.s, r.j]).toEqual([eksik, 500, { error: ileti }]);
      }
    } finally { shopifyEksikListe = null; delete process.env.SHOPIFY_ACCESS_TOKEN; }
  });

  it('S2 — sunucuda belirteç yoksa gövdeden gelen belirteçle dışarı ÇIKILMAZ (400, istek yok)', async () => {
    const once = disari.length;
    const r = await istek('POST', '/api/shopify/sync', ic('Admin'), { accessToken: 'saldirgan-belirteci', storeUrl: 'kotu-magaza.myshopify.com' });
    expect(r.s).toBe(400);
    expect(disari.slice(once).filter(d => /myshopify\.com/.test(d.url))).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('L4 — LUCA stok çekme kiracı sınırı (kimlik biçimi `luca-<sku>` değişmedi)', () => {
  const LUCA_AYARI = { apiKey: 'sinama-luca-anahtari-GIZLI', companyId: 'LUCA-FIRMA-GIZLI' };

  it('yabancı `companyId`li var olan kart EZİLMEZ (sayaç `yabanci: 1`); etiketsiz eski kart onarılır; kendi kartı güncellenir; yenisi açılır', async () => {
    await belgeKoy('settings', 'luca', LUCA_AYARI);
    await belgeKoy('inventory', 'luca-DYO-1', { sku: 'DYO-1', name: 'Başka firmanın kartı', quantity: 99, source: 'luca', companyId: BASKA_KIRACI });
    await belgeKoy('inventory', 'luca-ESKI-1', { sku: 'ESKI-1', name: 'Etiketsiz eski kart', quantity: 1, source: 'luca' });
    await belgeKoy('inventory', 'luca-KENDI-1', { sku: 'KENDI-1', name: 'Kendi kartı', quantity: 2, source: 'luca', companyId: KIRACI });
    lucaStoklari = [
      { stokKodu: 'DYO-1', stokAdi: 'DYO (LUCA)', miktar: 5 },
      { stokKodu: 'ESKI-1', stokAdi: 'Eski (LUCA)', miktar: 7 },
      { stokKodu: 'KENDI-1', stokAdi: 'Kendi (LUCA)', miktar: 8 },
      { stokKodu: 'YENI-1', stokAdi: 'Yeni (LUCA)', miktar: 9 },
    ];
    try {
      // Kilitli rol (Satış) hiçbir kartı değiştiremez.
      const ret = await istek('POST', '/api/luca/sync/stok', ic('Sales'), {});
      expect(ret.s).toBe(403);
      expect(await belgeOku('inventory', 'luca-ESKI-1')).toMatchObject({ quantity: 1 });
      expect(await belgeOku('inventory', 'luca-YENI-1')).toBeUndefined();

      const r = await istek('POST', '/api/luca/sync/stok', ic('Logistics'), {});
      expect(r.s, r.metin).toBe(200);
      expect(r.j).toMatchObject({ success: true, total: 4, created: 1, updated: 2, yabanci: 1 });
      // Yabancı kart: hiçbir alanı değişmedi (kiracısı taşınmadı).
      expect(await belgeOku('inventory', 'luca-DYO-1')).toEqual({ sku: 'DYO-1', name: 'Başka firmanın kartı', quantity: 99, source: 'luca', companyId: BASKA_KIRACI });
      // Etiketsiz eski kart onarıldı (çağıranın kiracısıyla etiketlendi) ve güncellendi.
      expect(await belgeOku('inventory', 'luca-ESKI-1')).toMatchObject({ name: 'Eski (LUCA)', quantity: 7, companyId: KIRACI, lucaSynced: true });
      expect(await belgeOku('inventory', 'luca-KENDI-1')).toMatchObject({ name: 'Kendi (LUCA)', quantity: 8, companyId: KIRACI });
      expect(await belgeOku('inventory', 'luca-YENI-1')).toMatchObject({ sku: 'YENI-1', quantity: 9, companyId: KIRACI, source: 'luca' });
    } finally {
      lucaStoklari = [];
      for (const id of ['luca-DYO-1', 'luca-ESKI-1', 'luca-KENDI-1', 'luca-YENI-1']) await belgeSil('inventory', id);
      await belgeSil('settings', 'luca');
    }
  });

  it('L6 — `GET /api/luca/status` kapısı DEĞİŞMEDİ (personel) ve yanıtında sır yok: anahtar / firma kimliği / başlık değerleri dönmez', async () => {
    await belgeKoy('settings', 'luca', LUCA_AYARI);
    try {
      for (const rol of STAFF_ROLES) {
        const r = await istek('GET', '/api/luca/status', ic(rol));
        expect([rol, r.s]).toEqual([rol, 200]);
        expect(Object.keys(r.j).sort()).toEqual(['companyName', 'configured', 'connected']);
        expect(r.metin).not.toContain(LUCA_AYARI.apiKey);
        expect(r.metin).not.toContain(LUCA_AYARI.companyId);
      }
      expect((await istek('GET', '/api/luca/status', belirtec('dis-b2b'))).s).toBe(403);
    } finally { await belgeSil('settings', 'luca'); }
  });
});
