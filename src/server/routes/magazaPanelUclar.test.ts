// @vitest-environment node
/**
 * magazaPanelUclar.test.ts — site paneli alt zinciri (`magazaPanelZinciri.ts`) + ERP kökenindeki mağaza uçları
 * (`magazaErpRoutes.ts`) GERÇEK express, GERÇEK zincir ve GERÇEK PostgreSQL motoruyla (dilim 2a, şartname v6 § 7 «Oturum»,
 * «Belirteç ve kapı», «Uçlar», «Liste», «ERP durum ucu») + iki modülün kaynak çitleri.
 *
 * DÜZENEK üretimdeki gibi AYRI kurulmuş iki kayıt çağrısıdır: `app.use('/api/magaza', magazaZinciri({ …, panelZinciri }))`
 * genel gövde ayrıştırıcıdan ÖNCE, `magazaErpRoutes(app, { … })` SONRA; kod deposu, iptal çifti ve kullanıcı okuyucu TEK
 * örnektir ve iki bağlama da AYNI tanımlayıcı gider (her modül kendi `Map`'ini kursaydı her kod değişimi 401 dönerdi).
 * İstekler gerçek soketten (`fetch`). `requireAuth` / `requireMfaVerified` server.ts'te yaşar (testte koşturulamaz): burada
 * gövdeleri AYNEN taşıyan sahteleri vardır; ERP çıkış işleyicisi server.ts'teki satırların kopyasıdır (çit:
 * `magazaBaglama.degismez.test.ts`).
 *
 * Veritabanı PGlite (PostgreSQL WASM): yazma işlevlerinin CAS'ı, liste ifadesinin tek anlık görüntüsü ve takip okumasının
 * jsonb süzgeci sahte havuzla sınanamaz. Örnek DOSYA başına bir kez kurulur; testler arasında tablolar boşaltılır. Tablo
 * DDL'i `docsSema.ts`'ten (kopya yok). Yazma işlevlerinin KENDİ senaryoları `kanal/magazaDurum.pglite.test.ts`'tedir.
 *
 * Sınırlayıcılar gerçek kitaplıkla, test tavanlarıyla kurulur (üretim tavanları ve anahtar üreticileri server.ts çitlerinde).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import http from 'node:http';
import { join } from 'node:path';
import rateLimit from 'express-rate-limit';
import { PGlite } from '@electric-sql/pglite';
import { kaynakDosyalari, kodSatirlari, oku, SRC_KOK, suclular } from '../../test/kaynakTarama';
import { MAGAZA_TALEP_KOLEKSIYONU } from '../../lib/magazaTalep';
import { APP_ROLES, magazaTalepIslemYetkisi, type AppRole } from '../../lib/rbac';
import type { AdminDbLike, AdminDocRef } from '../adminDbTypes';
import { DOCS_INDEKS_DDL, DOCS_TABLOSU_DDL } from '../docsSema';
import { JWT_BICIMI, yetkiBelirteci } from '../istemciIp';
import { MAGAZA_BILDIRIM_KALEM_SINIRI } from '../kanal/magazaBildirim';
import { KALEM_TESLIM_SQL } from '../kanal/magazaDurum';
import {
  MAGAZA_PANEL_BELIRTEC_OMRU_MS, donusTabaniCoz, panelAnahtariTuret, panelBelirteciUret, type PanelBelirtecYuku,
} from '../kanal/magazaPanelBelirtec';
import { iptalKur } from '../kanal/magazaPanelIptal';
import { kodDeposuKur, meydanHesapla, panelKoduUret } from '../kanal/magazaPanelKod';
import { panelKullanicisiKur } from '../kanal/magazaPanelKullanici';
import { magazaTalepKimligi } from '../kanal/magazaTalep';
import type { SmtpKipi } from '../smtpPosta';
import { magazaErpRoutes, magazaYetkiKodu429 } from './magazaErpRoutes';
import {
  MAGAZA_PANEL_ACIK_SINIRI, MAGAZA_PANEL_KAPALI_PENCERE_MS, MAGAZA_PANEL_KAPALI_SINIRI, MAGAZA_PANEL_LISTE_ONBELLEK_MS,
  MAGAZA_PANEL_LISTE_SQL, erpCikisindaPanelIptalEt, magazaPanel429, magazaPanelSayaclari, magazaPanelSayaclariniSifirla,
  magazaPanelZinciri, panelListesiKur, panelSiparisiEsle, type PanelListe, type PanelSiparis,
} from './magazaPanelZinciri';
import { MAGAZA_TAKIP_SQL, magaza429, magazaSayaclari, magazaSayaclariniSifirla, magazaZinciri, type MagazaPgHavuzu } from './magazaRoutes';

type Satir = Record<string, unknown>;
const COLL = MAGAZA_TALEP_KOLEKSIYONU;
const CID = 'kiraci-1';
const IZINLI = 'https://www.cetpa.com.tr';
const DONUS = 'https://www.cetpa.com.tr/panel.html';
const APP_URL = 'https://app.cetpa.com.tr';
const SAAT_0 = Date.parse('2026-10-09T12:00:00.000Z');
const SIFIR_KIMLIK = 'mt-00000000000000000000000000000000';
/** Günlükte / yanıtta görünmemesi gereken ayırt edici dizge. */
const ISARET = 'QZX7-4471-KVW9';
const DAKIKA = 60_000;
const GUN = 24 * 60 * DAKIKA;

// ── Gerçek motor ──────────────────────────────────────────────────────────────────────────────────────────────────
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(DOCS_TABLOSU_DDL);
  for (const ddl of DOCS_INDEKS_DDL) await db.exec(ddl);
  // server.ts `mfa_secrets` tablosunun bu testte okunan sütunları (`panelKullanicisi` yalnız `enabled` okur).
  await db.exec('CREATE TABLE mfa_secrets (uid text PRIMARY KEY, secret text, enabled boolean NOT NULL DEFAULT false)');
}, 30_000);
afterAll(async () => { await db.close(); });

let kimlikSirasi = 0;
const yeniKimlik = (): string => `mt-${String(++kimlikSirasi).padStart(32, '0')}`;
const zaman = (ms: number): string => new Date(ms).toISOString();
function talepVerisi(ek: Satir = {}): Satir {
  return {
    companyId: CID, talepNo: 'T261009-AB12', durum: 'sevk', durumSurum: 3, olusturma: zaman(SAAT_0 - 3 * 60 * DAKIKA),
    durumZamani: zaman(SAAT_0 - 2 * 60 * DAKIKA), durumAciklama: 'Kargoya verildi',
    musteri: { ad: 'Şükrü Ağaoğlu', firma: 'Iğdır Yapı', telefon: '0532 111 22 33', eposta: 'sukru@ornek.com.tr', il: 'İstanbul', adres: 'Çiçek Sk. 4', vergi: '1234567890' },
    telefonSon10: '5321112233', istemciTarihi: null, not: 'Öğleden sonra arayın.',
    kalemler: [
      { id: 'u-1', sku: 'DYO-0001', ad: 'İç cephe boyası 15 L', marka: 'DYO', adet: 2, talepFiyat: 204.99, tedarik: false },
      { id: 'u-2', sku: 'KRB-77', ad: 'Fayans yapıştırıcısı', marka: 'Karbosan', adet: 5, talepFiyat: null, tedarik: true },
      { id: '', sku: '', ad: 'Rulo', marka: '', adet: 1, talepFiyat: 49.99, tedarik: false },
    ],
    talepEdilen: { araToplam: 459.97, kdv: null, toplam: null }, fiyatiSorulacakVar: true,
    bildirim: { durum: 'gitti', zaman: zaman(SAAT_0 - 3 * 60 * DAKIKA) }, ...ek,
  };
}
async function talepEkle(ek: Satir = {}, id = yeniKimlik()): Promise<string> {
  await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', [COLL, id, JSON.stringify(talepVerisi(ek))]);
  return id;
}
async function belge(id: string): Promise<Satir> {
  const r = await db.query<{ data: Satir }>('SELECT data FROM docs WHERE coll = $1 AND id = $2', [COLL, id]);
  return r.rows[0].data;
}

// ── Sahte adminDb (`users`, `companyStatus`, `magazaPanelIptal`) ──────────────────────────────────────────────────
function sahteDb() {
  const veri = new Map<string, Map<string, Satir>>();
  const koleksiyon = (ad: string): Map<string, Satir> => {
    let k = veri.get(ad);
    if (!k) { k = new Map(); veri.set(ad, k); }
    return k;
  };
  const durum = { okumaHatasi: null as unknown, yazimHatasi: null as unknown, yazimlar: [] as string[] };
  const doc = (coll: string, id: string): AdminDocRef => ({
    id,
    async get() {
      if (durum.okumaHatasi) throw durum.okumaHatasi;
      const d = koleksiyon(coll).get(id);
      return { exists: d !== undefined, id, data: () => d };
    },
    async set(v) {
      if (durum.yazimHatasi) throw durum.yazimHatasi;
      durum.yazimlar.push(`${coll}/${id}`);
      koleksiyon(coll).set(id, v);
      return undefined;
    },
    async update() { throw new Error('kullanılmaz'); },
    async delete() { throw new Error('kullanılmaz'); },
  });
  const adminDb: AdminDbLike = {
    collection: (ad) => ({
      doc: (id) => doc(ad, id ?? 'yeni'),
      add: async () => { throw new Error('kullanılmaz'); },
      where() { return this; }, orderBy() { return this; }, limit() { return this; },
      async get() { return { docs: [], empty: true, size: 0 }; },
    }),
    batch: () => { throw new Error('kullanılmaz'); },
  };
  return { adminDb, koleksiyon, durum };
}

// ── Düzenek ───────────────────────────────────────────────────────────────────────────────────────────────────────
interface Ayar {
  kiraci?: () => Promise<string>;
  /** `undefined` = geçerli anahtar; `null` = panel yapılandırılmamış. */
  anahtar?: Buffer | null;
  /** ERP yetki kodu ucunun dönüş adresi; `null` = yapılandırılmamış. */
  panelDonus?: string | null;
  oturumTavani?: number;
  panelTavani?: number;
  yetkiTavani?: number;
  dbTavani?: number;
  talepTavani?: number;
  smtp?: { tamam: boolean; eksik: string[]; kip: SmtpKipi };
  bildirimIste?: (id: string) => Promise<void>;
  /** Yetki kodu ucundaki Firebase iptal denetiminin bekleme tavanı (ms). */
  iptalDenetimiSuresiMs?: number;
}
interface Duzenek {
  taban: string;
  saat: { ms: number };
  anahtar: Buffer;
  sahte: ReturnType<typeof sahteDb>;
  kullaniciOkuyucu: ReturnType<typeof panelKullanicisiKur>;
  kodDeposu: ReturnType<typeof kodDeposuKur>;
  iptal: ReturnType<typeof iptalKur>;
  sorgular: string[];
  /** Verilirse eşleşen sorgu bununla reddeder. */
  sorguHatasi: ((sql: string) => unknown) | null;
  /** Verilirse her sorgudan SONRA koşar (okuma ile yazma arasına giren başka yazımı taklit eder). */
  kanca: ((sql: string) => Promise<void>) | null;
  /** Verilirse sorgu sonucu dönmeden ÖNCE beklenir (geç dönen sorgu). */
  gecikme: ((sql: string) => Promise<void>) | null;
  yayinlar: unknown[][];
  denetim: unknown[][];
  bildirimler: string[];
  /** Kimlik kapısı sayacı: sahte `requireAuth`'un belirteci doğruladığı istek sayısı (Firebase doğrulayıcısının vekili). */
  sayim: { kiraci: number; apiLimiter: number; kimlikDogrulama: number };
  mfaEngeli: boolean;
  /**
   * server.ts `getAuth().verifyIdToken(belirtec, true)` vekili: denetlenen belirteçler + davranış (`null` = geçerli). Sahte
   * `requireAuth` belirteci YEREL doğrular (asıl gibi iptale bakmaz); iptal hükmü yalnız buradan gelir.
   */
  firebase: { cagrilar: string[]; davranis: ((belirtec: string) => Promise<unknown>) | null };
  kacan: { genelAyristirici: number; genel404: number; genelYakalayici: number };
}
const sunucular: http.Server[] = [];
let konsol: string[] = [];

const sinirlayici = (tavan: number, handler: (req: Request, res: Response) => void): RequestHandler => rateLimit({
  windowMs: 15 * 60 * 1000, max: tavan, standardHeaders: true, legacyHeaders: false, keyGenerator: () => 'tek-istemci', handler,
});
const VARSAYILAN_ANAHTAR = (): Buffer => {
  const a = panelAnahtariTuret({ sirVar: true, oturumSirri: 'test-oturum-sirri', donusTabani: DONUS, appUrl: APP_URL });
  if (!a) throw new Error('test anahtarı türetilemedi');
  return a;
};

async function kur(a: Ayar = {}): Promise<Duzenek> {
  const sahte = sahteDb();
  const saat = { ms: SAAT_0 };
  const simdi = (): Date => new Date(saat.ms);
  const anahtar = VARSAYILAN_ANAHTAR();
  const d: Duzenek = {
    taban: '', saat, anahtar, sahte,
    kullaniciOkuyucu: undefined as never, kodDeposu: kodDeposuKur({ simdi }), iptal: iptalKur({ adminDb: () => sahte.adminDb, simdi }),
    sorgular: [], sorguHatasi: null, kanca: null, gecikme: null, yayinlar: [], denetim: [], bildirimler: [],
    sayim: { kiraci: 0, apiLimiter: 0, kimlikDogrulama: 0 }, mfaEngeli: false, firebase: { cagrilar: [], davranis: null },
    kacan: { genelAyristirici: 0, genel404: 0, genelYakalayici: 0 },
  };
  const havuz: MagazaPgHavuzu = {
    async query(sql, params = []) {
      d.sorgular.push(sql);
      const hata = d.sorguHatasi?.(sql);
      if (hata) throw hata;
      const r = await db.query<Satir>(sql, params as unknown[]);
      if (d.gecikme) await d.gecikme(sql);
      if (d.kanca) await d.kanca(sql);
      return { rows: r.rows };
    },
  };
  d.kullaniciOkuyucu = panelKullanicisiKur({ adminDb: () => sahte.adminDb, pgPool: () => havuz, simdi });

  // pgShim `broadcastDocChange` taklidi: kaydeder ve değişiklik olayını yayınlar (panel liste önbelleği bunu dinler).
  const dinleyiciler: Array<(olay: { coll?: string }) => void> = [];
  const broadcastDocChange = (...argumanlar: unknown[]): void => {
    d.yayinlar.push(argumanlar);
    for (const dinleyici of dinleyiciler) dinleyici({ coll: String(argumanlar[0]) });
  };
  const writeAuditLog = async (...argumanlar: unknown[]): Promise<void> => { d.denetim.push(argumanlar); };
  const bildirimIste = (id: string): Promise<void> => { d.bildirimler.push(id); return a.bildirimIste ? a.bildirimIste(id) : Promise.resolve(); };
  const serverTenantId = (): Promise<string> => { d.sayim.kiraci += 1; return a.kiraci ? a.kiraci() : Promise.resolve(CID); };
  const getPgPool = (): MagazaPgHavuzu => havuz;

  const app = express();
  const panelZinciri = magazaPanelZinciri({
    panelOturumSinirlayici: sinirlayici(a.oturumTavani ?? 1000, magazaPanel429),
    panelSinirlayici: sinirlayici(a.panelTavani ?? 5000, magazaPanel429),
    panelAnahtari: a.anahtar === undefined ? anahtar : a.anahtar,
    panelKullanicisi: d.kullaniciOkuyucu.panelKullanicisi, kodDeposu: d.kodDeposu, iptal: d.iptal,
    getPgPool, serverTenantId, broadcastDocChange, writeAuditLog, bildirimIste,
    degisiklikDinle: (dinleyici) => { dinleyiciler.push(dinleyici); },
    izinliKokenler: () => [IZINLI], simdi,
  });
  // Üretimdeki AYNI yer: genel sınırlayıcıdan ve genel ayrıştırıcıdan ÖNCE.
  app.use('/api/magaza', magazaZinciri({
    apiLimiter: (_i, _y, sonraki) => { d.sayim.apiLimiter += 1; sonraki(); },
    talepSinirlayici: sinirlayici(a.talepTavani ?? 1000, magaza429), durumSinirlayici: sinirlayici(1000, magaza429), panelZinciri,
    getPgPool, serverTenantId, broadcastDocChange, bildirimIste, izinliKokenler: () => [IZINLI], simdi,
  }));
  app.use(express.json({ verify: () => { d.kacan.genelAyristirici += 1; } }));

  // server.ts `requireAuth` / `requireMfaVerified` sahteleri — ret GÖVDELERİ asıllarıyla aynı (onay sayfası onlardan tanır).
  const requireAuth: RequestHandler = (req, res, next) => {
    const belirtec = yetkiBelirteci(req.headers.authorization);
    if (!belirtec) { res.status(401).json({ error: 'Missing Authorization header.' }); return; }
    d.sayim.kimlikDogrulama += 1;
    if (!belirtec.startsWith('erp-')) { res.status(401).json({ error: 'Invalid or expired token.' }); return; }
    const uid = belirtec.slice(4);
    Object.assign(req, { uid, userEmail: `${uid}@ornek.com.tr`, emailVerified: true });
    next();
  };
  const requireMfaVerified: RequestHandler = (_req, res, next) => {
    if (d.mfaEngeli) { res.status(403).json({ error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true }); return; }
    next();
  };
  const dbLimiter = sinirlayici(a.dbTavani ?? 1000, (_req, res) => { res.status(429).json({ error: 'Too many database requests.' }); });
  // server.ts `POST /api/db/session/logout` işleyicisinin panel iptali satırları (kimlik ÇEREZDEN; `requireAuth` yok).
  app.post('/api/db/session/logout', dbLimiter, async (req: Request, res: Response) => {
    const cerez = /(?:^|;\s*)oturum=([^;]+)/.exec(req.headers.cookie ?? '');
    await erpCikisindaPanelIptalEt(d.iptal, cerez ? cerez[1] : null);
    res.json({ ok: true });
  });
  magazaErpRoutes(app, {
    requireAuth, requireMfaVerified, dbLimiter, magazaYetkiKoduLimiter: sinirlayici(a.yetkiTavani ?? 1000, magazaYetkiKodu429),
    belirtecIptalDenetle: (belirtec) => {
      d.firebase.cagrilar.push(belirtec);
      return d.firebase.davranis ? d.firebase.davranis(belirtec) : Promise.resolve({ uid: belirtec.slice(4) });
    },
    ...(a.iptalDenetimiSuresiMs !== undefined ? { iptalDenetimiSuresiMs: a.iptalDenetimiSuresiMs } : {}),
    panelKullanicisi: d.kullaniciOkuyucu.panelKullanicisi, kodDeposu: d.kodDeposu,
    getPgPool, broadcastDocChange, writeAuditLog, bildirimIste,
    smtpYapilandirmasi: () => a.smtp ?? { tamam: true, eksik: [], kip: 'kimlikli' }, serverTenantId,
    panelDonus: a.panelDonus === undefined ? DONUS : a.panelDonus, simdi,
  });
  app.use((_req, res) => { d.kacan.genel404 += 1; res.status(404).json({ error: 'Not found' }); });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    d.kacan.genelYakalayici += 1;
    if (res.headersSent) return;
    const durum = (err as { status?: unknown }).status;
    res.status(typeof durum === 'number' ? durum : 500).json({ error: 'Sunucu hatası.' });
  });

  const sunucu = http.createServer(app);
  sunucular.push(sunucu);
  await new Promise<void>(coz => { sunucu.listen(0, '127.0.0.1', () => coz()); });
  const adres = sunucu.address();
  if (!adres || typeof adres === 'string') throw new Error('test sunucusu dinlemiyor');
  d.taban = `http://127.0.0.1:${adres.port}`;

  // Varsayılan kullanıcılar: paneli görebilen üç rol + görmeyen bir rol + başka kiracının yöneticisi.
  kullanici(d, 'u-satis', { role: 'Sales', name: 'Ayşe Yılmaz' });
  kullanici(d, 'u-mudur', { role: 'Manager', name: 'Müdür Bey' });
  kullanici(d, 'u-yonetici', { role: 'Admin', name: 'Yönetici Hanım' });
  kullanici(d, 'u-depo', { role: 'Logistics', name: 'Depocu' });
  kullanici(d, 'u-baska', { role: 'Admin', name: 'Başka Firma', companyId: 'kiraci-2' });
  return d;
}
function kullanici(d: Duzenek, uid: string, ek: Satir): void {
  d.sahte.koleksiyon('users').set(uid, { companyId: CID, email: `${uid}@ornek.com.tr`, ...ek });
  d.kullaniciOkuyucu.dusur(uid);
}

// ── İstek ─────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Istek {
  method?: string;
  /** `undefined` = izinli köken; `null` = Origin başlığı yok. */
  koken?: string | null;
  tur?: string | null;
  govde?: unknown;
  ham?: string;
  /** Panel belirteci ya da ERP sahte belirteci (`erp-<uid>`). */
  belirtec?: string;
  cerez?: string;
}
interface Yanit { kod: number; metin: string; json: unknown; baslik: (ad: string) => string | null }
async function iste(d: Duzenek, tamYol: string, o: Istek = {}): Promise<Yanit> {
  const basliklar: Record<string, string> = {};
  if (o.koken !== null && o.koken !== undefined) basliklar.Origin = o.koken;
  let govde: Uint8Array<ArrayBuffer> | undefined;
  if (o.ham !== undefined) govde = new TextEncoder().encode(o.ham);
  else if (o.govde !== undefined) govde = new TextEncoder().encode(JSON.stringify(o.govde));
  const tur = o.tur === undefined ? (govde ? 'application/json' : null) : o.tur;
  if (tur !== null) basliklar['Content-Type'] = tur;
  if (o.belirtec !== undefined) basliklar.Authorization = `Bearer ${o.belirtec}`;
  if (o.cerez !== undefined) basliklar.Cookie = o.cerez;
  const y = await fetch(`${d.taban}${tamYol}`, { method: o.method ?? (govde ? 'POST' : 'GET'), headers: basliklar, body: govde });
  const metin = await y.text();
  let json: unknown;
  try { json = JSON.parse(metin); } catch { json = undefined; }
  return { kod: y.status, metin, json, baslik: ad => y.headers.get(ad) };
}
/** Panel ucu (izinli kökenle). */
const panel = (d: Duzenek, yol: string, o: Istek = {}): Promise<Yanit> => iste(d, `/api/magaza/panel${yol}`, { koken: IZINLI, ...o });
/** ERP ucu (aynı köken: Origin başlığı yok). */
const erp = (d: Duzenek, yol: string, uid: string | null, govde: unknown = {}, o: Istek = {}): Promise<Yanit> =>
  iste(d, yol, { govde, ...(uid !== null ? { belirtec: `erp-${uid}` } : {}), ...o });

/** Kapıdan geçen belirteç — doğrudan üretilir (tam akış «oturum» bölümünde sınanır). */
function belirtec(d: Duzenek, uid = 'u-satis', ek: Partial<PanelBelirtecYuku> = {}, anahtar: Buffer = d.anahtar): string {
  return panelBelirteciUret(anahtar, {
    uid, cid: CID, rol: 'Sales', ad: 'Ayşe Yılmaz', eposta: `${uid}@ornek.com.tr`, mfa: false,
    bas: d.saat.ms - 1000, bitis: d.saat.ms - 1000 + MAGAZA_PANEL_BELIRTEC_OMRU_MS, ...ek,
  });
}
/** «ERP ile bağlan» başlangıcı: mağazanın ürettiği doğrulayıcı + meydan ile yetki kodu ister; dönüş adresinden kodu okur. */
async function kodAl(d: Duzenek, uid = 'u-satis'): Promise<{ y: Yanit; kod: string; dogrulayici: string; donus: string }> {
  const dogrulayici = panelKoduUret();
  const y = await erp(d, '/api/magaza-panel/yetki-kodu', uid, { meydan: meydanHesapla(dogrulayici), tur: 'T'.repeat(22) });
  const donus = typeof (y.json as { donus?: unknown } | undefined)?.donus === 'string' ? (y.json as { donus: string }).donus : '';
  return { y, kod: /#kod=([A-Za-z0-9_-]{43})&tur=/.exec(donus)?.[1] ?? '', dogrulayici, donus };
}
const siparisler = (y: Yanit): PanelSiparis[] => (y.json as PanelListe).siparisler;

beforeEach(async () => {
  await db.exec('DELETE FROM docs; DELETE FROM mfa_secrets;');
  magazaPanelSayaclariniSifirla();
  magazaSayaclariniSifirla();
  konsol = [];
  for (const ad of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, ad).mockImplementation((...argumanlar: unknown[]) => { konsol.push(`${ad}: ${argumanlar.map(String).join(' ')}`); });
  }
});
afterEach(async () => {
  const cikti = konsol.join('\n');
  vi.restoreAllMocks();
  await Promise.all(sunucular.splice(0).map(s => new Promise<void>(coz => { s.closeAllConnections(); s.close(() => coz()); })));
  expect(cikti).not.toContain('ERR_ERL');
  // Günlüğe gövde / kişisel veri / belirteç YAZILMAZ.
  expect(cikti).not.toContain(ISARET);
  expect(cikti).not.toMatch(/mp1-|Şükrü|0532/);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('oturum — «ERP ile bağlan»: yetki kodu → belirteç (§ 3.1–3.3, 3.8)', () => {
  it('AYRI kurulmuş iki kayıt çağrısı, TEK kod deposu: `yetki-kodu` → `oturum` 200 → belirteç kendi kapısından geçer', async () => {
    const d = await kur();
    const { y, kod, dogrulayici, donus } = await kodAl(d);
    expect(y.kod).toBe(200);
    expect(y.baslik('cache-control')).toBe('no-store');
    // `donus` doğrulanmış kurallı tabandan; `tur` aynen geri döner; tek `#`.
    expect(donus).toBe(`${DONUS}#kod=${kod}&tur=${'T'.repeat(22)}`);
    expect(Object.keys(y.json as object)).toEqual(['donus']);

    const o = await panel(d, '/oturum', { govde: { kod, dogrulayici } });
    expect(o.kod).toBe(200);
    expect(o.baslik('cache-control')).toBe('no-store');
    const g = o.json as { token: string; ad: string; rol: string; bitis: string };
    expect(Object.keys(g).sort()).toEqual(['ad', 'bitis', 'rol', 'token']);
    expect(g).toMatchObject({ ad: 'Ayşe Yılmaz', rol: 'Sales', bitis: zaman(SAAT_0 + MAGAZA_PANEL_BELIRTEC_OMRU_MS) });
    // İKİ parçalı biçim: JWT desenine UYMAZ (hiçbir sınırlayıcıda Firebase doğrulayıcısına gitmez).
    expect(g.token).toMatch(/^mp1-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(JWT_BICIMI.test(g.token)).toBe(false);
    d.saat.ms += 1; // belirteç `bas`ından sonraki istek
    expect((await panel(d, '/siparisler', { belirtec: g.token })).kod).toBe(200);

    // Denetim: tam 1 kayıt; kod / doğrulayıcı / belirteç metni YOK.
    expect(d.denetim).toEqual([[{ uid: 'u-satis', email: 'u-satis@ornek.com.tr' }, 'Mağaza paneli oturumu', 'açıldı · u-satis@ornek.com.tr']]);
    const denetimMetni = JSON.stringify(d.denetim);
    for (const gizli of [kod, dogrulayici, g.token]) expect(denetimMetni).not.toContain(gizli);
    expect(magazaPanelSayaclari()).toMatchObject({ yetkiKodu: 1, yetkiKoduRet: 0, oturum: 1, oturum401: 0 });
    expect(d.kacan).toEqual({ genelAyristirici: 1, genel404: 0, genelYakalayici: 0 }); // yalnız ERP isteği genel ayrıştırıcıdan geçti
  });
  it('aynı kodla 3 EŞZAMANLI istek → tam 1 başarı; sonraki deneme 401', async () => {
    const d = await kur();
    const { kod, dogrulayici } = await kodAl(d);
    const yanitlar = await Promise.all([1, 2, 3].map(() => panel(d, '/oturum', { govde: { kod, dogrulayici } })));
    expect(yanitlar.map(y => y.kod).sort()).toEqual([200, 401, 401]);
    const sonra = await panel(d, '/oturum', { govde: { kod, dogrulayici } });
    expect(sonra.kod).toBe(401);
    expect(sonra.metin).toBe('{"ok":false}');
    expect(magazaPanelSayaclari()).toMatchObject({ oturum: 1, oturum401: 3 });
  });
  it('kod 60 sn yaşar: 59 999 ms\'de geçer, 60 000 ms\'de (ve 61. sn\'de) 401', async () => {
    const d = await kur();
    const a = await kodAl(d);
    d.saat.ms = SAAT_0 + 59_999;
    expect((await panel(d, '/oturum', { govde: { kod: a.kod, dogrulayici: a.dogrulayici } })).kod).toBe(200);
    d.saat.ms = SAAT_0;
    const b = await kodAl(d, 'u-mudur');
    d.saat.ms = SAAT_0 + 60_000;
    expect((await panel(d, '/oturum', { govde: { kod: b.kod, dogrulayici: b.dogrulayici } })).kod).toBe(401);
    d.saat.ms = SAAT_0;
    const c = await kodAl(d, 'u-yonetici');
    d.saat.ms = SAAT_0 + 61_000;
    expect((await panel(d, '/oturum', { govde: { kod: c.kod, dogrulayici: c.dogrulayici } })).kod).toBe(401);
  });
  it('yanlış doğrulayıcı 401 ve kayıt SİLİNİR (doğru doğrulayıcıyla ikinci deneme de 401)', async () => {
    const d = await kur();
    const { kod, dogrulayici } = await kodAl(d);
    expect((await panel(d, '/oturum', { govde: { kod, dogrulayici: 'A'.repeat(43) } })).kod).toBe(401);
    expect((await panel(d, '/oturum', { govde: { kod, dogrulayici } })).kod).toBe(401);
    expect(d.kodDeposu.boyut()).toBe(0);
  });
  it('aynı kullanıcının ikinci `yetki-kodu` ilkini geçersiz kılar; A\'nın 50 isteği B\'nin canlı kodunu DÜŞÜRMEZ', async () => {
    const d = await kur();
    const ilk = await kodAl(d, 'u-satis');
    const b = await kodAl(d, 'u-mudur');
    let son = ilk;
    for (let i = 0; i < 50; i++) son = await kodAl(d, 'u-satis');
    expect(d.kodDeposu.boyut()).toBe(2); // kullanıcı başına en çok 1 canlı kod
    expect((await panel(d, '/oturum', { govde: { kod: ilk.kod, dogrulayici: ilk.dogrulayici } })).kod).toBe(401);
    expect((await panel(d, '/oturum', { govde: { kod: b.kod, dogrulayici: b.dogrulayici } })).kod).toBe(200);
    expect((await panel(d, '/oturum', { govde: { kod: son.kod, dogrulayici: son.dogrulayici } })).kod).toBe(200);
  });
  it('`{ eposta, sifre }` gövdesi 400; yanıtta ve günlükte parola metni YOK; bozuk `kod` / `dogrulayici` 400', async () => {
    const d = await kur();
    const y = await panel(d, '/oturum', { govde: { eposta: 'ayse@ornek.com.tr', sifre: ISARET } });
    expect(y.kod).toBe(400);
    expect(y.metin).toBe('{"ok":false}');
    const { kod, dogrulayici } = await kodAl(d);
    for (const g of [{ kod, dogrulayici, eposta: 'x' }, { kod: kod.slice(1), dogrulayici }, { kod, dogrulayici: `${dogrulayici}=` }, { kod }, {}, []]) {
      expect((await panel(d, '/oturum', { govde: g })).kod, JSON.stringify(g)).toBe(400);
    }
    expect(konsol).toEqual([]);
    // Şema reddi kodu YAKMAZ (kayıt yalnız şemadan geçen istekte alınır).
    expect((await panel(d, '/oturum', { govde: { kod, dogrulayici } })).kod).toBe(200);
  });
  it('`yetki-kodu` retleri: bozuk `meydan` / `tur` 400 · rol 403 `rol` · başka kiracı 403 `kiraci` · kimliksiz 401 · MFA gövdesi AYNEN', async () => {
    const d = await kur();
    const gecerli = { meydan: 'M'.repeat(43), tur: 'T'.repeat(22) };
    for (const g of [{ ...gecerli, meydan: 'M'.repeat(42) }, { ...gecerli, tur: 'T'.repeat(23) }, { ...gecerli, tur: 'T'.repeat(21) + '+' }, { meydan: gecerli.meydan }, { ...gecerli, donus: 'https://kotu.example' }]) {
      const y = await erp(d, '/api/magaza-panel/yetki-kodu', 'u-satis', g);
      expect(y.kod, JSON.stringify(g)).toBe(400);
      expect(y.metin).toBe('{"ok":false}');
    }
    // Rolü kümede olmayan kullanıcı (süper-yönetici olsa da — modül süper-yöneticiyi hiç tanımaz) ve kayıtsız kullanıcı.
    for (const uid of ['u-depo', 'u-kayitsiz']) {
      const y = await erp(d, '/api/magaza-panel/yetki-kodu', uid, gecerli);
      expect(y.kod, uid).toBe(403);
      expect(y.json).toEqual({ ok: false, kod: 'rol' });
    }
    const baska = await erp(d, '/api/magaza-panel/yetki-kodu', 'u-baska', gecerli);
    expect(baska.kod).toBe(403);
    expect(baska.json).toEqual({ ok: false, kod: 'kiraci' });
    expect(baska.baslik('cache-control')).toBe('no-store');
    const kimliksiz = await erp(d, '/api/magaza-panel/yetki-kodu', null, gecerli);
    expect(kimliksiz.kod).toBe(401);
    expect(kimliksiz.baslik('cache-control')).toBe('no-store');
    d.mfaEngeli = true;
    const mfa = await erp(d, '/api/magaza-panel/yetki-kodu', 'u-satis', gecerli);
    expect(mfa.kod).toBe(403);
    expect(mfa.json).toEqual({ error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true });
    expect(d.kodDeposu.boyut()).toBe(0);
    expect(magazaPanelSayaclari()).toMatchObject({ yetkiKodu: 0, yetkiKoduRet: 8 });
  });
  it('`yetki-kodu` 429 gövdesi `{ ok: false, kod: "sinir" }`', async () => {
    const d = await kur({ yetkiTavani: 2 });
    expect((await kodAl(d)).y.kod).toBe(200);
    expect((await kodAl(d)).y.kod).toBe(200);
    const y = (await kodAl(d)).y;
    expect(y.kod).toBe(429);
    expect(y.json).toEqual({ ok: false, kod: 'sinir' });
    expect(y.baslik('cache-control')).toBe('no-store');
  });
  it('iptal edilmiş Firebase belirteci `yetki-kodu` ALAMAZ (inceleme 2026-10-10): iptal / devre dışı / silinmiş / süresi dolmuş → 401 `{ ok: false }`, kod üretilmez; denetim sınırlayıcıdan SONRA', async () => {
    const d = await kur({ yetkiTavani: 5 });
    // Sağlam belirteç: denetim tam 1 kez, kimlik kapısının kabul ettiği belirteçle.
    expect((await kodAl(d)).y.kod).toBe(200);
    expect(d.firebase.cagrilar).toEqual(['erp-u-satis']);
    // ERP çıkışı refresh token'ları iptal etti (`revokeRefreshTokens`): eldeki kimlik belirteci YEREL doğrulamadan (sahte
    // `requireAuth`, asıl gibi) hâlâ geçer; iptal denetimli doğrulamadan geçemez.
    for (const kod of ['auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found', 'auth/id-token-expired']) {
      d.firebase.davranis = () => Promise.reject(Object.assign(new Error(`iptal ${ISARET}`), { code: kod }));
      const y = (await kodAl(d, 'u-mudur')).y;
      expect(y.kod, kod).toBe(401);
      expect(y.json, kod).toEqual({ ok: false });
      expect(y.baslik('cache-control'), kod).toBe('no-store');
    }
    expect(d.kodDeposu.boyut()).toBe(1);   // yalnız ilk (sağlam) isteğin kodu
    expect(magazaPanelSayaclari()).toMatchObject({ yetkiKodu: 1, yetkiKoduRet: 4, yetkiKoduIptalDenetimsiz: 0 });
    expect(konsol).toEqual([]);            // ret günlüğe yazılmaz
    // Tavan (5) doldu: 6. istek 429 alır ve Firebase'e GİTMEZ (kapı sınırlayıcıdan sonradır).
    expect((await kodAl(d, 'u-mudur')).y.kod).toBe(429);
    expect(d.firebase.cagrilar).toHaveLength(5);
  });
  it('iptal denetimi yalnız kimlik + MFA kapısından geçen `yetki-kodu` isteğinde çağrılır; öbür ERP uçları HİÇ çağırmaz', async () => {
    const d = await kur();
    const govde = { meydan: 'M'.repeat(43), tur: 'T'.repeat(22) };
    expect((await erp(d, '/api/magaza-panel/yetki-kodu', null, govde)).kod).toBe(401);
    expect((await iste(d, '/api/magaza-panel/yetki-kodu', { govde, belirtec: 'gecersiz' })).kod).toBe(401);
    d.mfaEngeli = true;
    expect((await erp(d, '/api/magaza-panel/yetki-kodu', 'u-satis', govde)).kod).toBe(403);
    d.mfaEngeli = false;
    const id = await talepEkle();
    expect((await erp(d, `/api/magaza-talepleri/${id}/durum`, 'u-satis', { onceki: 'sevk', surum: 3, durum: 'teslim' })).kod).toBe(200);
    expect((await erp(d, `/api/magaza-talepleri/${id}/kalem-teslim`, 'u-satis', { surum: 4, teslim: true, kalemler: 'hepsi' })).kod).toBe(200);
    expect(d.firebase.cagrilar).toEqual([]);
    // Bozuk gövde de denetimden SONRA 400 alır (kapı işleyiciden önce): sayaç tek ret.
    expect((await erp(d, '/api/magaza-panel/yetki-kodu', 'u-satis', { meydan: 'kisa', tur: 'T'.repeat(22) })).kod).toBe(400);
    expect(d.firebase.cagrilar).toEqual(['erp-u-satis']);
  });
  it('iptal denetimi YAPILAMAZSA (kimlik bilgisi yok / ağ / kodsuz hata / süre aşımı / eşzamanlı fırlatma) kod YİNE verilir — sayaç + uyarı (sessiz değil); hata iletisi günlüğe yazılmaz', async () => {
    const d = await kur({ iptalDenetimiSuresiMs: 40 });
    const durumlar: Array<[() => Promise<unknown>, string]> = [
      [() => Promise.reject(Object.assign(new Error(`kimlik yok ${ISARET}`), { code: 'app/invalid-credential' })), 'app.invalid-credential'],
      [() => Promise.reject(Object.assign(new Error(ISARET), { code: 'ECONNRESET' })), 'ECONNRESET'],
      [() => Promise.reject(new Error(ISARET)), 'bilinmiyor'],
      [() => new Promise<never>(() => undefined), 'ETIMEDOUT'],
      [() => { throw Object.assign(new Error(ISARET), { code: 'app/no-app' }); }, 'app.no-app'],
    ];
    let son = await kodAl(d);
    for (const [davranis] of durumlar) {
      d.firebase.davranis = davranis;
      son = await kodAl(d);
      expect(son.y.kod).toBe(200);
    }
    // Verilen kod gerçekten takas edilir (kapı isteği yarıda bırakmadı).
    expect((await panel(d, '/oturum', { govde: { kod: son.kod, dogrulayici: son.dogrulayici } })).kod).toBe(200);
    expect(magazaPanelSayaclari()).toMatchObject({ yetkiKodu: 6, yetkiKoduRet: 0, yetkiKoduIptalDenetimsiz: 5 });
    expect(konsol).toEqual(durumlar.map(([, kod]) => `warn: [magaza-erp] yetki kodu: belirteç iptali denetlenemedi, kod yine verilir: ${kod}`));
  });
  it('kod verildikten SONRA rol düşerse / firma askıya alınırsa / MFA açılırsa değişim 401', async () => {
    const d = await kur();
    const a = await kodAl(d, 'u-satis');
    kullanici(d, 'u-satis', { role: 'Logistics' });
    expect((await panel(d, '/oturum', { govde: { kod: a.kod, dogrulayici: a.dogrulayici } })).kod).toBe(401);
    const b = await kodAl(d, 'u-mudur');
    d.sahte.koleksiyon('companyStatus').set(CID, { status: 'suspended' });
    d.kullaniciOkuyucu.temizle();
    expect((await panel(d, '/oturum', { govde: { kod: b.kod, dogrulayici: b.dogrulayici } })).kod).toBe(401);
    d.sahte.koleksiyon('companyStatus').delete(CID);
    d.kullaniciOkuyucu.temizle();
    const c = await kodAl(d, 'u-yonetici');
    await db.query('INSERT INTO mfa_secrets (uid, secret, enabled) VALUES ($1, $2, true)', ['u-yonetici', 's']);
    d.kullaniciOkuyucu.dusur('u-yonetici');
    expect((await panel(d, '/oturum', { govde: { kod: c.kod, dogrulayici: c.dogrulayici } })).kod).toBe(401);
  });
  it('değişimde okuma hatası 503 (401 değil) ve AYNI kod ikinci kez 401 (kod yanmıştır)', async () => {
    const d = await kur();
    const { kod, dogrulayici } = await kodAl(d);
    d.kullaniciOkuyucu.dusur('u-satis');
    d.sahte.durum.okumaHatasi = Object.assign(new Error(`bağlantı koptu ${ISARET}`), { code: '57P01' });
    const y = await panel(d, '/oturum', { govde: { kod, dogrulayici } });
    expect(y.kod).toBe(503);
    expect(y.metin).toBe('{"ok":false}');
    d.sahte.durum.okumaHatasi = null;
    expect((await panel(d, '/oturum', { govde: { kod, dogrulayici } })).kod).toBe(401);
    expect(konsol).toEqual(['error: [magaza-panel] oturum: kullanıcı okunamadı: 57P01']);
    expect(magazaPanelSayaclari()).toMatchObject({ oturum: 0, oturum503: 1, oturum401: 1 });
  });
  it('kiracı `""` iken `yetki-kodu` 503 `panel-yapilandirilmamis` (403 değil, kod üretilmez) ve `oturum` 503 (401 değil)', async () => {
    let kiraci = CID;
    const d = await kur({ kiraci: () => Promise.resolve(kiraci) });
    const { kod, dogrulayici } = await kodAl(d);
    kiraci = '';
    d.saat.ms += 59_000; // panel zincirinin kiracı önbelleği henüz dolmadı (ilk panel isteği)
    const y = (await kodAl(d, 'u-mudur')).y;
    expect(y.kod).toBe(503);
    expect(y.json).toEqual({ ok: false, kod: 'panel-yapilandirilmamis' });
    expect(d.kodDeposu.boyut()).toBe(1);
    const o = await panel(d, '/oturum', { govde: { kod, dogrulayici } });
    expect(o.kod).toBe(503);
    expect(o.metin).toBe('{"ok":false}');
  });
  it('1.000 birimlik `users.name` ile verilen belirteç kendi kapısından geçer (`ad` 80 birime kırpılmış)', async () => {
    const d = await kur();
    kullanici(d, 'u-satis', { role: 'Sales', name: 'İ'.repeat(1000) });
    const { kod, dogrulayici } = await kodAl(d);
    const o = await panel(d, '/oturum', { govde: { kod, dogrulayici } });
    const g = o.json as { token: string; ad: string };
    expect(g.ad).toBe('İ'.repeat(80));
    expect(g.token.length).toBeLessThan(2048);
    d.saat.ms += 1;
    expect((await panel(d, '/siparisler', { belirtec: g.token })).kod).toBe(200);
  });
  it('dönüş adresi: sonu `#` / boşluk olan ayarda `donus` TEK `#` taşır; geçersiz ayarda 503 `panel-yapilandirilmamis`; istek gövdesi `donus`u etkilemez', async () => {
    for (const ham of [`${DONUS}#`, `${DONUS} `, ` ${DONUS}`, DONUS]) {
      const taban = donusTabaniCoz(ham, { uretim: true, izinliKokenler: [IZINLI] });
      expect(taban).toBe(DONUS);
      const d = await kur({ panelDonus: taban });
      const { donus } = await kodAl(d);
      expect(donus.split('#')).toHaveLength(2);
      expect(donus.startsWith(`${DONUS}#kod=`)).toBe(true);
    }
    // Liste sırası sonucu değiştirmez; http (üretim), liste dışı köken, sorgu / parça / kullanıcı adı → null → 503.
    expect(donusTabaniCoz(DONUS, { uretim: true, izinliKokenler: ['https://b.example', IZINLI] })).toBe(DONUS);
    for (const ham of ['http://www.cetpa.com.tr/panel.html', 'https://kotu.example/panel.html', `${DONUS}?a=1`, `${DONUS}#x`, 'https://kul@www.cetpa.com.tr/panel.html']) {
      expect(donusTabaniCoz(ham, { uretim: true, izinliKokenler: [IZINLI] }), ham).toBeNull();
    }
    const d = await kur({ panelDonus: null });
    const y = (await kodAl(d)).y;
    expect(y.kod).toBe(503);
    expect(y.json).toEqual({ ok: false, kod: 'panel-yapilandirilmamis' });
    expect(d.kodDeposu.boyut()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('belirteç ve kapı (§ 3.4–3.7)', () => {
  it('bozuk imza / çok baytlı imza / 2.048\'den uzun / biçimsiz belirteç → 401 (500 değil); oturum çerezi biçimi belirteç yerine geçmez', async () => {
    const d = await kur();
    const gecerli = belirtec(d);
    const [yuk, imza] = gecerli.split('.');
    // İmzanın İLK karakteri değişir (son karakterin artık bitleri base64url çözümünde yok sayılır — orada tek karakterlik
    // değişiklik aynı baytları verebilir).
    const bozukImza = `${imza[0] === 'A' ? 'B' : 'A'}${imza.slice(1)}`;
    const adaylar = [
      `${yuk}.${bozukImza}`, `${yuk}.${'é'.repeat(43)}`, `${yuk}.${imza}${'A'.repeat(2048)}`, `${yuk}`, `${yuk}.${imza}.x`,
      `mp2-${yuk.slice(4)}.${imza}`, 'dXN8MTIz.aW16YQ', 'a.b.c', '', `${yuk}x.${imza}`, `${yuk}.`, `.${imza}`,
    ];
    for (const aday of adaylar) {
      const y = await panel(d, '/siparisler', { belirtec: aday });
      expect(y.kod, aday.slice(0, 30)).toBe(401);
      expect(y.metin).toBe('{"ok":false}');
    }
    expect((await panel(d, '/siparisler', { belirtec: gecerli })).kod).toBe(200);
    expect(d.kacan).toEqual({ genelAyristirici: 0, genel404: 0, genelYakalayici: 0 });
  });
  it('süre: 8 saat sonuna 1 ms kala geçer, `bitis` anında ve sonrasında 401; `bas` gelecekte 401', async () => {
    const d = await kur();
    const b = belirtec(d, 'u-satis', { bas: SAAT_0, bitis: SAAT_0 + MAGAZA_PANEL_BELIRTEC_OMRU_MS });
    d.saat.ms = SAAT_0 + MAGAZA_PANEL_BELIRTEC_OMRU_MS - 1;
    expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(200);
    d.saat.ms = SAAT_0 + MAGAZA_PANEL_BELIRTEC_OMRU_MS;
    expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(401);
    d.saat.ms = SAAT_0 + MAGAZA_PANEL_BELIRTEC_OMRU_MS + 1;
    expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(401);
    d.saat.ms = SAAT_0;
    expect((await panel(d, '/siparisler', { belirtec: belirtec(d, 'u-satis', { bas: SAAT_0 + 1, bitis: SAAT_0 + 5000 }) })).kod).toBe(401);
  });
  it('farklı `APP_URL`, farklı dönüş adresi ya da farklı sırla imzalanmış belirteç 401', async () => {
    const d = await kur();
    const turet = (g: Partial<{ oturumSirri: string; donusTabani: string; appUrl: string }>): Buffer => {
      const a = panelAnahtariTuret({ sirVar: true, oturumSirri: 'test-oturum-sirri', donusTabani: DONUS, appUrl: APP_URL, ...g });
      if (!a) throw new Error('anahtar yok');
      return a;
    };
    for (const baska of [turet({ appUrl: 'https://staging.cetpa.com.tr' }), turet({ donusTabani: 'https://www.cetpa.com.tr/panel2.html' }), turet({ oturumSirri: 'baska-sir' })]) {
      expect((await panel(d, '/siparisler', { belirtec: belirtec(d, 'u-satis', {}, baska) })).kod).toBe(401);
    }
    expect((await panel(d, '/siparisler', { belirtec: belirtec(d, 'u-satis', {}, turet({})) })).kod).toBe(200);
  });
  it('anahtar yokken (iki sır da yok / boş, ya da dönüş adresi geçersiz) belirteçli DE belirteçsiz DE 503 `panel-yapilandirilmamis`; ön uçuş 204; kovaya sayılmaz', async () => {
    for (const ortam of [{}, { SESSION_TOKEN_SECRET: '', FIREBASE_PRIVATE_KEY: '' }]) {
      const sirVar = !!(ortam as { SESSION_TOKEN_SECRET?: string }).SESSION_TOKEN_SECRET || !!(ortam as { FIREBASE_PRIVATE_KEY?: string }).FIREBASE_PRIVATE_KEY;
      expect(panelAnahtariTuret({ sirVar, oturumSirri: 'sabit-yedek', donusTabani: DONUS, appUrl: APP_URL })).toBeNull();
    }
    expect(panelAnahtariTuret({ sirVar: true, oturumSirri: 's', donusTabani: null, appUrl: APP_URL })).toBeNull();
    const d = await kur({ anahtar: null, panelTavani: 2, oturumTavani: 2 });
    const gecerli = belirtec(d);
    const istekler: Array<[string, Istek]> = [
      ['/siparisler', {}], ['/siparisler', { belirtec: gecerli }], ['/oturum', { govde: { kod: 'A'.repeat(43), dogrulayici: 'A'.repeat(43) } }],
      ['/cikis', { govde: {}, belirtec: gecerli }], ['/yok', {}], [`/siparisler/${SIFIR_KIMLIK}/durum`, { ham: '{bozuk' }],
    ];
    for (const [yol, o] of istekler) {
      const y = await panel(d, yol, o);
      expect(y.kod, yol).toBe(503);
      expect(y.json).toEqual({ ok: false, kod: 'panel-yapilandirilmamis' });
      expect(y.baslik('cache-control')).toBe('no-store');
      // 503 köken başlığı taşır (panel `kod`u okuyabilsin) ve hiçbir kovaya sayılmaz.
      expect(y.baslik('access-control-allow-origin')).toBe(IZINLI);
      expect(y.baslik('ratelimit-remaining')).toBeNull();
    }
    const onUcus = await panel(d, '/siparisler', { method: 'OPTIONS' });
    expect(onUcus.kod).toBe(204);
    expect(magazaPanelSayaclari()).toMatchObject({ r503: 6, r401: 0, r429: 0 });
  });
  it('yetki her istekte YENİDEN okunur — saat ilerletilmeden: rol düşünce, kiracı değişince, kullanıcı silinince, firma askıya alınınca, MFA sonradan açılınca 401', async () => {
    const d = await kur();
    const b = belirtec(d);
    const dene = async (): Promise<number> => (await panel(d, '/siparisler', { belirtec: b })).kod;
    expect(await dene()).toBe(200);
    // (a) `users` olayı → `dusur(uid)`.
    kullanici(d, 'u-satis', { role: 'Logistics' });
    expect(await dene()).toBe(401);
    kullanici(d, 'u-satis', { role: 'Sales' });
    expect(await dene()).toBe(200);
    kullanici(d, 'u-satis', { role: 'Sales', companyId: 'kiraci-2' });
    expect(await dene()).toBe(401);
    d.sahte.koleksiyon('users').delete('u-satis');
    d.kullaniciOkuyucu.dusur('u-satis');
    expect(await dene()).toBe(401);
    kullanici(d, 'u-satis', { role: 'Sales' });
    expect(await dene()).toBe(200);
    // (b) `companyStatus` olayı → `temizle()`.
    d.sahte.koleksiyon('companyStatus').set(CID, { status: 'suspended' });
    d.kullaniciOkuyucu.temizle();
    expect(await dene()).toBe(401);
    d.sahte.koleksiyon('companyStatus').set(CID, { status: 'active' });
    d.kullaniciOkuyucu.temizle();
    expect(await dene()).toBe(200);
    // (c) MFA yazımı → `dusur(uid)`: MFA'sız verilmiş belirteç düşer; MFA'lı verilmiş olan yaşar.
    await db.query('INSERT INTO mfa_secrets (uid, secret, enabled) VALUES ($1, $2, true)', ['u-satis', 's']);
    d.kullaniciOkuyucu.dusur('u-satis');
    expect(await dene()).toBe(401);
    expect((await panel(d, '/siparisler', { belirtec: belirtec(d, 'u-satis', { mfa: true }) })).kod).toBe(200);
    // Yükteki `rol` yalnız gösterimdir: Admin yazan ama gerçekte yetkisiz kullanıcının belirteci geçmez.
    expect((await panel(d, '/siparisler', { belirtec: belirtec(d, 'u-depo', { rol: 'Admin' }) })).kod).toBe(401);
    // Önbellek DOLUYKEN de: liste önbelleği kapıdan SONRADIR.
    expect(d.kacan).toEqual({ genelAyristirici: 0, genel404: 0, genelYakalayici: 0 });
  });
  it('okuma hatası ret DEĞİLDİR: `panelKullanicisi` / iptal okuması fırlatınca 503 (401 değil — panel oturumu düşmez)', async () => {
    const d = await kur();
    const b = belirtec(d);
    d.sahte.durum.okumaHatasi = Object.assign(new Error(ISARET), { code: '57P01' });
    const y = await panel(d, '/siparisler', { belirtec: b });
    expect(y.kod).toBe(503);
    expect(y.metin).toBe('{"ok":false}');
    d.sahte.durum.okumaHatasi = null;
    // MFA okuması (havuz) fırlatınca da.
    d.sorguHatasi = sql => (sql.includes('mfa_secrets') ? Object.assign(new Error('x'), { code: '08006' }) : null);
    expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(503);
    d.sorguHatasi = null;
    expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(200);
    expect(konsol).toEqual(['error: [magaza-panel] kapı okuması başarısız: 57P01', 'error: [magaza-panel] kapı okuması başarısız: 08006']);
    expect(magazaPanelSayaclari()).toMatchObject({ r503: 2, r401: 0 });
  });
  it('kiracı `""` iken belirteçli istek 503 (401 değil); art arda N panel isteğinde `serverTenantId` en çok 1 kez çağrılır', async () => {
    let kiraci = '';
    const d = await kur({ kiraci: () => Promise.resolve(kiraci) });
    const b = belirtec(d);
    expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(503);
    expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(503);
    expect(d.sayim.kiraci).toBe(1);
    kiraci = CID;
    d.saat.ms += 10_000; // boş sonuç en çok 10 sn önbellekte
    for (let i = 0; i < 12; i++) expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(200);
    expect(d.sayim.kiraci).toBe(2);
    // Sunucu kiracısı kullanıcının kiracısı değilse 401.
    kiraci = 'kiraci-9';
    d.saat.ms += 60_000;
    expect((await panel(d, '/siparisler', { belirtec: belirtec(d) })).kod).toBe(401);
  });
  it('çıkış: 204 + denetim; aynı belirteç 401; o kullanıcının ÖNCEKİ bütün belirteçleri ölür, sonradan verilen yaşar, başka kullanıcı etkilenmez', async () => {
    const d = await kur();
    const b1 = belirtec(d, 'u-satis');
    const b2 = belirtec(d, 'u-satis', { bas: SAAT_0 - 5000 });
    const baskasi = belirtec(d, 'u-mudur', { rol: 'Manager' });
    const y = await panel(d, '/cikis', { govde: {}, belirtec: b1 });
    expect(y.kod).toBe(204);
    expect(y.metin).toBe('');
    expect(y.baslik('cache-control')).toBe('no-store');
    expect(d.sahte.koleksiyon('magazaPanelIptal').get('u-satis')).toEqual({ gecersizOnce: zaman(SAAT_0), companyId: CID });
    for (const b of [b1, b2]) expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(401);
    expect((await panel(d, '/siparisler', { belirtec: baskasi })).kod).toBe(200);
    d.saat.ms += 2000;
    expect((await panel(d, '/siparisler', { belirtec: belirtec(d, 'u-satis', { bas: SAAT_0 + 1 }) })).kod).toBe(200);
    expect(d.denetim).toEqual([[{ uid: 'u-satis', email: 'u-satis@ornek.com.tr' }, 'Mağaza paneli oturumu', 'kapandı · u-satis@ornek.com.tr']]);
    expect(JSON.stringify(d.denetim)).not.toContain('mp1-');
  });
  it('`cikis` yazımı fırlatınca 503 (204 değil) ve aynı süreçte o belirteç HEMEN ve 61. saniyede 401', async () => {
    const d = await kur();
    const b = belirtec(d);
    d.sahte.durum.yazimHatasi = Object.assign(new Error(ISARET), { code: '53300' });
    const y = await panel(d, '/cikis', { govde: {}, belirtec: b });
    expect(y.kod).toBe(503);
    expect(y.metin).toBe('{"ok":false}');
    d.sahte.durum.yazimHatasi = null;
    expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(401);
    d.saat.ms += 61_000;
    expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(401);
    expect(d.sahte.durum.yazimlar).toEqual([]);
    expect(d.denetim).toEqual([]);
    expect(konsol).toEqual(['error: [magaza-panel] çıkış: iptal yazılamadı: 53300']);
  });
  it('ERP çıkışı (ÇEREZLİ, `Authorization` başlıksız) panel belirteçlerini öldürür; çerezsiz çıkış iptal YAZMAZ ve yine `{ ok: true }`; önbellek sıfırlanınca yine 401', async () => {
    const d = await kur();
    const b = belirtec(d);
    const cerezsiz = await iste(d, '/api/db/session/logout', { govde: {} });
    expect(cerezsiz.json).toEqual({ ok: true });
    expect(d.sahte.durum.yazimlar).toEqual([]);
    expect(magazaPanelSayaclari().cikisUidsiz).toBe(1);
    expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(200);

    const cerezli = await iste(d, '/api/db/session/logout', { govde: {}, cerez: 'oturum=u-satis' });
    expect(cerezli.json).toEqual({ ok: true });
    expect(d.sahte.durum.yazimlar).toEqual(['magazaPanelIptal/u-satis']);
    expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(401);
    expect(magazaPanelSayaclari().cikisUidsiz).toBe(1);

    // Yeniden başlatma provası: AYNI veritabanı, TAZE iptal çifti (süreç içi değer ve önbellek yok) → değer veritabanından okunur.
    const taze = iptalKur({ adminDb: () => d.sahte.adminDb, simdi: () => new Date(d.saat.ms) });
    expect(await taze.gecersizOnce('u-satis')).toBe(SAAT_0);
  });
  it('ERP çıkışında iptal yazımı fırlasa da çıkış TAMAMLANIR (yardımcı fırlatmaz); süreç içi değer belirteci yine öldürür', async () => {
    const d = await kur();
    const b = belirtec(d);
    d.sahte.durum.yazimHatasi = Object.assign(new Error(ISARET), { code: '57P01' });
    const y = await iste(d, '/api/db/session/logout', { govde: {}, cerez: 'oturum=u-satis' });
    expect(y.kod).toBe(200);
    expect(y.json).toEqual({ ok: true });
    d.sahte.durum.yazimHatasi = null;
    expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(401);
    expect(konsol).toEqual(['warn: [magaza-panel] ERP çıkışında panel iptali yazılamadı: 57P01']);
  });
  it('çıkış BEKLEYEN YETKİ KODUNU da öldürür (V8; inceleme 2026-10-10): kod → ERP çıkışı → takas 401; çıkışla AYNI anda verilen kod da 401; saat ilerleyince verilen YENİ kod 200', async () => {
    const d = await kur();
    const once = await kodAl(d, 'u-satis');
    const baskasi = await kodAl(d, 'u-mudur');
    d.saat.ms += 10_000;   // kod hâlâ canlı (60 sn)
    expect((await iste(d, '/api/db/session/logout', { govde: {}, cerez: 'oturum=u-satis' })).json).toEqual({ ok: true });
    const cikis = d.saat.ms;
    d.saat.ms += 5_000;    // takas çıkıştan SONRA: denetim olmasaydı belirtecin `bas`ı iptal değerinden büyük olur, kapıdan geçerdi
    const y = await panel(d, '/oturum', { govde: { kod: once.kod, dogrulayici: once.dogrulayici } });
    expect(y.kod).toBe(401);
    expect(y.metin).toBe('{"ok":false}');
    // Başka kullanıcının bekleyen kodu etkilenmez.
    expect((await panel(d, '/oturum', { govde: { kod: baskasi.kod, dogrulayici: baskasi.dogrulayici } })).kod).toBe(200);

    // Eşit an RETTİR (kapıdaki `bas > gecersizOnce` kuralıyla aynı): çıkışla aynı milisaniyede verilen kod takas edilemez.
    d.saat.ms = cikis;
    const esit = await kodAl(d, 'u-satis');
    expect(esit.y.kod).toBe(200);
    expect((await panel(d, '/oturum', { govde: { kod: esit.kod, dogrulayici: esit.dogrulayici } })).kod).toBe(401);

    // Yasal yeniden bağlanma: çıkıştan SONRA (1 ms yeter) verilen yeni kod 200 ve belirteci kendi kapısından geçer.
    d.saat.ms = cikis + 1;
    const sonra = await kodAl(d, 'u-satis');
    const o = await panel(d, '/oturum', { govde: { kod: sonra.kod, dogrulayici: sonra.dogrulayici } });
    expect(o.kod).toBe(200);
    d.saat.ms += 1;
    expect((await panel(d, '/siparisler', { belirtec: (o.json as { token: string }).token })).kod).toBe(200);
    expect(magazaPanelSayaclari()).toMatchObject({ oturum: 2, oturum401: 2, oturum503: 0 });
  });
  it('panel «Çıkış»ı da bekleyen kodu öldürür; çıkıştan sonra yeniden bağlanma (yeni kod) 200', async () => {
    const d = await kur();
    const b = belirtec(d, 'u-satis');
    const once = await kodAl(d, 'u-satis');
    d.saat.ms += 1_000;
    expect((await panel(d, '/cikis', { govde: {}, belirtec: b })).kod).toBe(204);
    d.saat.ms += 1_000;
    expect((await panel(d, '/oturum', { govde: { kod: once.kod, dogrulayici: once.dogrulayici } })).kod).toBe(401);
    const sonra = await kodAl(d, 'u-satis');
    expect((await panel(d, '/oturum', { govde: { kod: sonra.kod, dogrulayici: sonra.dogrulayici } })).kod).toBe(200);
  });
  it('takasta iptal okuması fırlarsa 503 (401 değil) ve AYNI kod ikinci kez 401 (kod yanmıştır)', async () => {
    const d = await kur();
    const { kod, dogrulayici } = await kodAl(d);   // kullanıcı okuyucunun önbelleği doldu: yalnız İPTAL okuması veritabanına gider
    d.sahte.durum.okumaHatasi = Object.assign(new Error(`bağlantı koptu ${ISARET}`), { code: '57P01' });
    const y = await panel(d, '/oturum', { govde: { kod, dogrulayici } });
    expect(y.kod).toBe(503);
    expect(y.metin).toBe('{"ok":false}');
    d.sahte.durum.okumaHatasi = null;
    expect((await panel(d, '/oturum', { govde: { kod, dogrulayici } })).kod).toBe(401);
    expect(konsol).toEqual(['error: [magaza-panel] oturum: iptal okunamadı: 57P01']);
    expect(magazaPanelSayaclari()).toMatchObject({ oturum: 0, oturum503: 1, oturum401: 1 });
    expect(d.denetim).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('uçlar — gerçek zincir: kapı, köken, gövde, sınırlayıcı (§ 4)', () => {
  it('belirteçsiz her yol 401 (büyük harf, sondaki eğik çizgi, bilinmeyen yol, `/oturum/x`); `POST /PANEL/OTURUM/` kapıya takılmaz', async () => {
    const d = await kur();
    for (const yol of ['/api/magaza/PANEL/siparisler', '/api/magaza/panel/siparisler/', '/api/magaza/panel/yok', '/api/magaza/panel/oturum/x', '/api/magaza/panel', '/api/magaza/panel/cikis']) {
      const y = await iste(d, yol, { koken: IZINLI });
      expect(y.kod, yol).toBe(401);
      expect(y.metin).toBe('{"ok":false}');
      expect(y.baslik('cache-control')).toBe('no-store');
    }
    // Kapıya takılsaydı 401 olurdu; işleyiciye ulaştığı için şema reddi (400).
    expect((await iste(d, '/api/magaza/PANEL/OTURUM/', { koken: IZINLI, govde: {} })).kod).toBe(400);
    // Gövde kapıdan ÖNCE ayrıştırılmaz: belirteçsiz + bozuk gövde / yanlış tür / dev gövde 401'dir.
    for (const uc of ['durum', 'kalem-teslim', 'etiket-basildi']) {
      expect((await panel(d, `/siparisler/${SIFIR_KIMLIK}/${uc}`, { ham: '{bozuk' })).kod, uc).toBe(401);
      expect((await panel(d, `/siparisler/${SIFIR_KIMLIK}/${uc}`, { govde: {} })).kod, uc).toBe(401);
      expect((await panel(d, `/siparisler/${SIFIR_KIMLIK}/${uc}`, { ham: 'x', tur: 'text/plain' })).kod, uc).toBe(401);
    }
    // Belirteçliyken bilinmeyen yol ve yanlış yöntem 404.
    const b = belirtec(d);
    for (const [yol, o] of [['/yok', {}], ['/siparisler', { govde: {} }], [`/siparisler/${SIFIR_KIMLIK}/durum`, {}], ['/oturum', {}]] as Array<[string, Istek]>) {
      const y = await panel(d, yol, { belirtec: b, ...o });
      expect(y.kod, yol).toBe(404);
      expect(y.metin).toBe('{"ok":false}');
    }
    expect(magazaPanelSayaclari()).toMatchObject({ r401: 15, r404: 4 });
    expect(d.kacan).toEqual({ genelAyristirici: 0, genel404: 0, genelYakalayici: 0 });
    expect(magazaSayaclari().r404).toBe(0);
  });
  it('ön uçuş: `/panel` → `GET, POST` + `Authorization, Content-Type`; dış uçlar → yalnız `POST` + `Content-Type` (Authorization YOK); `Allow-Credentials` hiçbirinde yok', async () => {
    const d = await kur();
    for (const yol of ['/siparisler', '/oturum', `/siparisler/${SIFIR_KIMLIK}/kalem-teslim`, '/yok']) {
      const y = await panel(d, yol, { method: 'OPTIONS' });
      expect(y.kod, yol).toBe(204);
      expect(y.baslik('access-control-allow-origin')).toBe(IZINLI);
      expect(y.baslik('access-control-allow-methods')).toBe('GET, POST');
      expect(y.baslik('access-control-allow-headers')).toBe('Authorization, Content-Type');
      expect(y.baslik('access-control-max-age')).toBe('600');
      expect(y.baslik('access-control-allow-credentials')).toBeNull();
      expect(y.baslik('cache-control')).toBe('no-store');
    }
    for (const yol of ['/api/magaza/siparis-talebi', '/api/magaza/siparis-durumu']) {
      const y = await iste(d, yol, { method: 'OPTIONS', koken: IZINLI });
      expect(y.kod).toBe(204);
      expect(y.baslik('access-control-allow-methods')).toBe('POST');
      expect(y.baslik('access-control-allow-headers')).toBe('Content-Type');
      expect(y.baslik('access-control-allow-credentials')).toBeNull();
    }
    // Ön uçuş hiçbir kovaya ve sayaca işlenmez.
    expect(magazaPanelSayaclari()).toMatchObject({ r401: 0, r403: 0, r404: 0 });
  });
  it('panelde izinsiz köken ve kökensiz istek 403 (belirteç geçerli olsa da); izinsiz kökene köken başlığı yazılmaz', async () => {
    const d = await kur();
    const b = belirtec(d);
    for (const koken of ['https://kotu.example', null, 'null', 'https://www.cetpa.com.tr.kotu.example']) {
      const y = await iste(d, '/api/magaza/panel/siparisler', { koken, belirtec: b });
      expect(y.kod, String(koken)).toBe(403);
      expect(y.metin).toBe('{"ok":false}');
      expect(y.baslik('access-control-allow-origin')).toBeNull();
      expect(y.baslik('access-control-allow-credentials')).toBeNull();
      expect(y.baslik('cache-control')).toBe('no-store');
    }
    expect(magazaPanelSayaclari().r403).toBe(4);
  });
  it('`oturum`, `…/durum`, `…/kalem-teslim`, `…/etiket-basildi`, `cikis`: JSON olmayan 415 · 64 KB üstü 413 · bozuk JSON 400 (zincirin kendi yakalayıcısı)', async () => {
    const d = await kur();
    const b = belirtec(d);
    const id = await talepEkle();
    const dev = JSON.stringify({ dolgu: 'x'.repeat(70 * 1024) });
    for (const yol of ['/oturum', `/siparisler/${id}/durum`, `/siparisler/${id}/kalem-teslim`, `/siparisler/${id}/etiket-basildi`, '/cikis']) {
      const o: Istek = yol === '/oturum' ? {} : { belirtec: b };
      expect((await panel(d, yol, { ...o, ham: '{}', tur: 'text/plain' })).kod, yol).toBe(415);
      expect((await panel(d, yol, { ...o, method: 'POST' })).kod, yol).toBe(415);
      expect((await panel(d, yol, { ...o, ham: dev })).kod, yol).toBe(413);
      const bozuk = await panel(d, yol, { ...o, ham: `{"a": ${ISARET}` });
      expect(bozuk.kod, yol).toBe(400);
      expect(bozuk.metin).toBe('{"ok":false}');
      expect(bozuk.baslik('cache-control')).toBe('no-store');
    }
    expect(d.kacan).toEqual({ genelAyristirici: 0, genel404: 0, genelYakalayici: 0 });
    expect(d.yayinlar).toEqual([]);
    expect(konsol).toEqual([]);
  });
  it('601. panel isteği 429 `{ ok: false }`; 600 panel isteğinden sonra aynı IP\'den `siparis-talebi` 429 ALMAZ; panel genel sınırlayıcıya ve kimlik doğrulayıcısına HİÇ gitmez', async () => {
    const d = await kur({ panelTavani: 600 });
    const b = belirtec(d);
    // Belirteçsiz 401'ler de kovaya sayılır: 300 belirteçsiz + 300 belirteçli.
    const kodlar = new Map<number, number>();
    for (let tur = 0; tur < 60; tur++) {
      const dalga = await Promise.all(Array.from({ length: 10 }, (_, i) => panel(d, '/siparisler', (tur * 10 + i) % 2 === 0 ? {} : { belirtec: b })));
      for (const y of dalga) kodlar.set(y.kod, (kodlar.get(y.kod) ?? 0) + 1);
    }
    expect(Object.fromEntries(kodlar)).toEqual({ 200: 300, 401: 300 });
    const dolu = await panel(d, '/siparisler', { belirtec: b });
    expect(dolu.kod).toBe(429);
    expect(dolu.metin).toBe('{"ok":false}');
    expect(dolu.baslik('cache-control')).toBe('no-store');
    expect(dolu.baslik('access-control-allow-origin')).toBe(IZINLI);
    // Kova AYRI: mağazanın sipariş talebi etkilenmez; panel 429'u panel sayacında (dilim 1'in `r429`'unda değil).
    const talep = await iste(d, '/api/magaza/siparis-talebi', { koken: IZINLI, govde: { no: 'T261009-ZZ99', musteri: { ad: 'A', telefon: '0' }, kalemler: [{ ad: 'x', adet: 1 }] } });
    expect(talep.kod).toBe(400);
    expect(magazaPanelSayaclari().r429).toBe(1);
    expect(magazaSayaclari().r429).toBe(0);
    // 601 panel isteği: genel /api sınırlayıcısı (kullanıcı anahtarı üretirken belirteç doğrular) ve kimlik kapısı 0 kez.
    expect(d.sayim.apiLimiter).toBe(1); // yalnız sipariş talebi
    expect(d.sayim.kimlikDogrulama).toBe(0);
    // `oturum` kovası ayrıdır: panel kovası doluyken de kod değişimi denenebilir.
    expect((await panel(d, '/oturum', { govde: { kod: 'A'.repeat(43), dogrulayici: 'A'.repeat(43) } })).kod).toBe(401);
  }, 60_000);
  it('`oturum` kendi kovasında: tavan dolunca 429; panel kovasına sayılmaz', async () => {
    const d = await kur({ oturumTavani: 3, panelTavani: 2 });
    const g = { kod: 'A'.repeat(43), dogrulayici: 'A'.repeat(43) };
    const kodlar: number[] = [];
    for (let i = 0; i < 4; i++) kodlar.push((await panel(d, '/oturum', { govde: g })).kod);
    expect(kodlar).toEqual([401, 401, 401, 429]);
    // Panel kovası dokunulmamış: 2 hak duruyor.
    expect((await panel(d, '/siparisler')).baslik('ratelimit-remaining')).toBe('1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('panel yazma uçları — aşama, kalem teslim, etiket (§ 4; yazma kuralı `magazaDurum.ts`)', () => {
  it('aşama: ileri geçiş 200 + GÜNCEL liste (panel sözlüğü, yeni sürüm, geçişler); belgeye `kanal: "panel"`, `kim.ad` okuyucudan (belirteçtekinden DEĞİL)', async () => {
    const d = await kur();
    const id = await talepEkle({ durum: 'yeni', durumSurum: 0, durumAciklama: undefined });
    const b = belirtec(d, 'u-satis', { ad: 'BELİRTEÇTEKİ AD' });
    // Önbellek dolsun: yazımdan sonra dönen liste yine de günceldir.
    expect(siparisler(await panel(d, '/siparisler', { belirtec: b }))[0]).toMatchObject({ durum: 'alindi', surum: 0, gecisler: ['teyit', 'iptal'] });
    const y = await panel(d, `/siparisler/${id}/durum`, { belirtec: b, govde: { onceki: 'alindi', surum: 0, durum: 'teyit', aciklama: `  Hazırlanıyor\n${ISARET}  ` } });
    expect(y.kod).toBe(200);
    expect(Object.keys(y.json as object)).toEqual(['siparisler', 'acikToplam', 'kesildi']);
    expect(siparisler(y)[0]).toMatchObject({ id, durum: 'teyit', surum: 1, gecisler: ['alindi', 'hazirlaniyor', 'iptal'], aciklama: `Hazırlanıyor ${ISARET}`, guncelleme: zaman(SAAT_0) });
    const yazilan = await belge(id);
    expect(yazilan.durumGecmisi).toEqual([{ onceki: 'yeni', yeni: 'teyit', zaman: zaman(SAAT_0), kim: { uid: 'u-satis', ad: 'Ayşe Yılmaz' }, kanal: 'panel' }]);
    // Denetim: panel kanalında e-posta dolu; açıklama METNİ yok.
    expect(d.denetim).toEqual([[{ uid: 'u-satis', email: 'u-satis@ornek.com.tr' }, 'Mağaza talebi durumu', 'T261009-AB12 · panel · açıklama var', { durum: { from: 'yeni', to: 'teyit' } }]]);
    expect(magazaPanelSayaclari()).toMatchObject({ durumPanel: 1, durumPanel409: 0 });
  });
  it('aşama 409 `gecis-yok` + güncel aşama PANEL sözlüğüyle (bayat aşama, bayat sürüm, izinsiz geçiş); bilinmeyen saklı aşamada `durum` alanı YOK', async () => {
    const d = await kur();
    const b = belirtec(d);
    const id = await talepEkle({ durum: 'yeni', durumSurum: 4 });
    for (const g of [
      { onceki: 'teyit', surum: 4, durum: 'hazirlaniyor' },      // bayat aşama
      { onceki: 'alindi', surum: 3, durum: 'teyit' },            // bayat sürüm
      { onceki: 'alindi', surum: 4, durum: 'sevk' },             // izinsiz geçiş
    ]) {
      const y = await panel(d, `/siparisler/${id}/durum`, { belirtec: b, govde: g });
      expect(y.kod, JSON.stringify(g)).toBe(409);
      expect(y.json).toEqual({ ok: false, kod: 'gecis-yok', durum: 'alindi' });
      expect(y.baslik('cache-control')).toBe('no-store');
    }
    const bilinmeyen = await talepEkle({ durum: 'kargoda' });
    const y = await panel(d, `/siparisler/${bilinmeyen}/durum`, { belirtec: b, govde: { onceki: 'sevk', surum: 3, durum: 'teslim' } });
    expect(y.kod).toBe(409);
    expect(y.json).toEqual({ ok: false, kod: 'gecis-yok' });
    expect((await belge(id)).durum).toBe('yeni');
    expect(d.yayinlar).toEqual([]);
    expect(magazaPanelSayaclari()).toMatchObject({ durumPanel: 0, durumPanel409: 4 });
  });
  it('aşama 400: `surum`suz, `onceki: "bilinmiyor"`, saklanan sözlük (`yeni`), aynı aşamada açıklamasız, tanınmayan alan, 2.001 karakter açıklama', async () => {
    const d = await kur();
    const b = belirtec(d);
    const id = await talepEkle({ durum: 'yeni', durumSurum: 0 });
    for (const g of [
      { onceki: 'alindi', durum: 'teyit' }, { onceki: 'bilinmiyor', surum: 0, durum: 'teyit' }, { onceki: 'yeni', surum: 0, durum: 'teyit' },
      { onceki: 'alindi', surum: 0, durum: 'alindi' }, { onceki: 'alindi', surum: 0, durum: 'teyit', companyId: 'kiraci-2' },
      { onceki: 'alindi', surum: 0, durum: 'teyit', aciklama: 'x'.repeat(2001) }, { onceki: 'alindi', surum: -1, durum: 'teyit' }, { onceki: 'alindi', surum: 0.5, durum: 'teyit' },
    ]) {
      const y = await panel(d, `/siparisler/${id}/durum`, { belirtec: b, govde: g });
      expect(y.kod, JSON.stringify(g).slice(0, 80)).toBe(400);
      expect(y.metin).toBe('{"ok":false}');
    }
    expect((await belge(id)).durumSurum).toBe(0);
  });
  it('başka kiracının talebi / bozuk kimlik / olmayan talep → 404 `{ ok: false }` (üçü aynı yanıt) — dört yazma ucunda', async () => {
    const d = await kur();
    const b = belirtec(d);
    const baska = await talepEkle({ companyId: 'kiraci-2' });
    const govdeler: Record<string, unknown> = {
      durum: { onceki: 'sevk', surum: 3, durum: 'teslim' }, 'kalem-teslim': { surum: 3, teslim: true, kalemler: 'hepsi' }, 'etiket-basildi': {},
    };
    for (const [uc, g] of Object.entries(govdeler)) {
      for (const id of [baska, 'mt-BOZUK', SIFIR_KIMLIK, 'mt-' + 'g'.repeat(32)]) {
        const y = await panel(d, `/siparisler/${id}/${uc}`, { belirtec: b, govde: g });
        expect(y.kod, `${uc} ${id}`).toBe(404);
        expect(y.metin).toBe('{"ok":false}');
      }
    }
    expect(await belge(baska)).toEqual(talepVerisi({ companyId: 'kiraci-2' }));
    expect(d.yayinlar).toEqual([]);
    expect(magazaPanelSayaclari()).toMatchObject({ etiketBasildi404: 4 });
  });
  it('kalem teslim: `kalemler: "hepsi"` TEK istek → 200 güncel liste, bütün `teslim === true`, `teslimIsaretsiz: 0`; `teslim: false` → hepsi false; aşama DEĞİŞMEZ', async () => {
    const d = await kur();
    const b = belirtec(d);
    const id = await talepEkle();
    const y = await panel(d, `/siparisler/${id}/kalem-teslim`, { belirtec: b, govde: { surum: 3, teslim: true, kalemler: 'hepsi' } });
    expect(y.kod).toBe(200);
    expect(y.baslik('cache-control')).toBe('no-store');
    const kart = siparisler(y)[0];
    expect(kart.kalemler.map(k => [k.anahtar, k.teslim])).toEqual([['b:0', true], ['b:1', true], ['b:2', true]]);
    expect(kart).toMatchObject({ teslimIsaretsiz: 0, kalemSayisi: 3, teslimKaynagi: 'beyan', durum: 'sevk', surum: 4, guncelleme: zaman(SAAT_0) });
    // TEK yazım (kalem başına istek / yazım yok).
    expect(d.sorgular.filter(s => s === KALEM_TESLIM_SQL)).toHaveLength(1);
    d.saat.ms += 5000;
    const kaldir = await panel(d, `/siparisler/${id}/kalem-teslim`, { belirtec: b, govde: { surum: 4, teslim: false, kalemler: 'hepsi' } });
    expect(kaldir.kod).toBe(200);
    expect(siparisler(kaldir)[0]).toMatchObject({ teslimIsaretsiz: 3, kalemSayisi: 3, surum: 5, guncelleme: zaman(SAAT_0 + 5000) });
    expect(siparisler(kaldir)[0].kalemler.every(k => !k.teslim)).toBe(true);
    // Tek kalem + denetim (anahtar listesi / kalem adı yok).
    const tek = await panel(d, `/siparisler/${id}/kalem-teslim`, { belirtec: b, govde: { surum: 5, teslim: true, kalemler: ['b:1'] } });
    expect(siparisler(tek)[0].kalemler.map(k => k.teslim)).toEqual([false, true, false]);
    expect(d.denetim.map(k => k.slice(1))).toEqual([
      ['Mağaza talebi kalem teslimi', 'T261009-AB12 · panel · beyan · işaretlendi 3 / kaldırıldı 0'],
      ['Mağaza talebi kalem teslimi', 'T261009-AB12 · panel · beyan · işaretlendi 0 / kaldırıldı 3'],
      ['Mağaza talebi kalem teslimi', 'T261009-AB12 · panel · beyan · işaretlendi 1 / kaldırıldı 0'],
    ]);
    expect(magazaPanelSayaclari()).toMatchObject({ kalemTeslimPanel: 3, kalemTeslimPanel409: 0 });
  });
  it('kalem teslim 400 (şema): `surum`suz, `teslim`siz, boş liste, 501 anahtar, desene uymayan (`c:0`, `b:`, `B:0`, `b:01`), yinelenen, tanınmayan alan, `teslim: "evet"`', async () => {
    const d = await kur();
    const b = belirtec(d);
    const id = await talepEkle();
    const gecerli = { surum: 3, teslim: true };
    for (const g of [
      { teslim: true, kalemler: 'hepsi' }, { surum: 3, kalemler: 'hepsi' }, { ...gecerli, kalemler: [] }, { ...gecerli },
      { ...gecerli, kalemler: Array.from({ length: 501 }, (_, i) => `b:${i}`) },
      { ...gecerli, kalemler: ['c:0'] }, { ...gecerli, kalemler: ['b:'] }, { ...gecerli, kalemler: ['B:0'] }, { ...gecerli, kalemler: ['b:1', 'b:01'] },
      { ...gecerli, kalemler: ['b:0', 'b:0'] }, { ...gecerli, kalemler: 'hepsi', kanal: 'erp' }, { surum: 3, teslim: 'evet', kalemler: 'hepsi' },
      { ...gecerli, kalemler: 'tumu' },
    ]) {
      const y = await panel(d, `/siparisler/${id}/kalem-teslim`, { belirtec: b, govde: g });
      expect(y.kod, JSON.stringify(g).slice(0, 60)).toBe(400);
      expect(y.metin).toBe('{"ok":false}');
    }
    // `gecersiz` (yazma işlevi): aralık dışı dizin, öbür kaynağın anahtarı, geçerli + geçersiz karışık → 400, belge değişmez.
    for (const kalemler of [['b:3'], ['t:0123456789ab'], ['b:0', 'b:7']]) {
      expect((await panel(d, `/siparisler/${id}/kalem-teslim`, { belirtec: b, govde: { ...gecerli, kalemler } })).kod, String(kalemler)).toBe(400);
    }
    expect(await belge(id)).toEqual(talepVerisi());
    expect(d.yayinlar).toEqual([]);
    expect(magazaPanelSayaclari()).toMatchObject({ kalemTeslimPanel: 0, kalemTeslimPanel409: 0 });
  });
  it('kalem teslim 409: bayat `surum` (aşama ucuyla AYNI sayaç) → `gecis-yok` + güncel aşama; `iptal` → `durum: "iptal"`; bilinmeyen aşamada alan yok; `surum-eski`de `durum` yok', async () => {
    const d = await kur();
    const b = belirtec(d);
    const id = await talepEkle();
    // Aşama yazımı sürümü ilerletti: bayat kartla gelen kalem isteği 409.
    expect((await panel(d, `/siparisler/${id}/durum`, { belirtec: b, govde: { onceki: 'sevk', surum: 3, durum: 'sevk', aciklama: 'Yolda' } })).kod).toBe(200);
    const bayat = await panel(d, `/siparisler/${id}/kalem-teslim`, { belirtec: b, govde: { surum: 3, teslim: true, kalemler: ['b:0'] } });
    expect(bayat.kod).toBe(409);
    expect(bayat.json).toEqual({ ok: false, kod: 'gecis-yok', durum: 'sevk' });
    // Kalem yazımından SONRA eski sürümle aşama yazımı da 409 (iki yazım aynı sayacı paylaşır).
    expect((await panel(d, `/siparisler/${id}/kalem-teslim`, { belirtec: b, govde: { surum: 4, teslim: true, kalemler: ['b:0'] } })).kod).toBe(200);
    expect((await panel(d, `/siparisler/${id}/durum`, { belirtec: b, govde: { onceki: 'sevk', surum: 4, durum: 'teslim' } })).json).toEqual({ ok: false, kod: 'gecis-yok', durum: 'sevk' });

    const iptal = await talepEkle({ durum: 'iptal', iptalOncesi: 'sevk' });
    expect((await panel(d, `/siparisler/${iptal}/kalem-teslim`, { belirtec: b, govde: { surum: 3, teslim: true, kalemler: 'hepsi' } })).json).toEqual({ ok: false, kod: 'gecis-yok', durum: 'iptal' });
    const bilinmeyen = await talepEkle({ durum: null });
    expect((await panel(d, `/siparisler/${bilinmeyen}/kalem-teslim`, { belirtec: b, govde: { surum: 3, teslim: true, kalemler: 'hepsi' } })).json).toEqual({ ok: false, kod: 'gecis-yok' });

    // Kaynak değişimi yarışı (2b'nin içerik yazımı ham UPDATE ile taklit): dar okuma ile yazım arasına `icerikSurum` +1 girer.
    const yaris = await talepEkle();
    let yapildi = false;
    d.kanca = async (sql) => {
      if (yapildi || !sql.startsWith('SELECT') || !sql.includes('icerik_surum')) return;
      yapildi = true;
      await db.query(`UPDATE docs SET data = data || '{"icerikSurum": 1, "teyit": {"kalemler": [{"anahtar": "t:0123456789ab", "ad": "x", "adet": 1}]}}'::jsonb WHERE id = $1`, [yaris]);
    };
    const eski = await panel(d, `/siparisler/${yaris}/kalem-teslim`, { belirtec: b, govde: { surum: 3, teslim: true, kalemler: ['b:0'] } });
    d.kanca = null;
    expect(eski.kod).toBe(409);
    expect(eski.json).toEqual({ ok: false, kod: 'surum-eski' });
    expect((await belge(yaris)).kalemTeslim).toBeUndefined();
    expect(magazaPanelSayaclari()).toMatchObject({ kalemTeslimPanel: 1, kalemTeslimPanel409: 4, durumPanel: 1, durumPanel409: 1 });
  });
  it('etiket basıldı: `{}` → 200 `{ ok, etiketBasildi: { zaman } }` (`koli` ve `kim` YOK); `{ koli: 3 }`; ikinci basış zamanı yeniler; sürüm DEĞİŞMEZ; yayın 1, denetim 0', async () => {
    const d = await kur();
    const b = belirtec(d);
    const id = await talepEkle();
    const y = await panel(d, `/siparisler/${id}/etiket-basildi`, { belirtec: b, govde: {} });
    expect(y.kod).toBe(200);
    expect(y.json).toEqual({ ok: true, etiketBasildi: { zaman: zaman(SAAT_0) } });
    expect(y.baslik('cache-control')).toBe('no-store');
    // Belgede `kim` VAR (uid belirteçten, `panel: true`); yanıtta ve listede YOK.
    expect((await belge(id)).etiketBasildi).toEqual({ zaman: zaman(SAAT_0), kim: { uid: 'u-satis', panel: true } });
    expect(d.yayinlar).toHaveLength(1);
    expect(d.yayinlar[0].slice(0, 3)).toEqual([COLL, 'set', id]);
    expect(d.yayinlar[0][3]).toEqual(await belge(id));
    d.saat.ms += 7000;
    const ikinci = await panel(d, `/siparisler/${id}/etiket-basildi`, { belirtec: b, govde: { koli: 3 } });
    expect(ikinci.json).toEqual({ ok: true, etiketBasildi: { zaman: zaman(SAAT_0 + 7000), koli: 3 } });
    const liste = await panel(d, '/siparisler', { belirtec: b });
    expect(siparisler(liste)[0]).toMatchObject({ etiketBasildi: { zaman: zaman(SAAT_0 + 7000), koli: 3 }, surum: 3, durum: 'sevk' });
    // Etiket `guncelleme`ye girmez, aşama sürümünü artırmaz (aşama ile yarışmaz).
    expect(siparisler(liste)[0].guncelleme).toBe(zaman(SAAT_0 - 2 * 60 * DAKIKA));
    expect(liste.metin).not.toContain('"kim"');
    expect((await belge(id)).durumSurum).toBe(3);
    expect(d.denetim).toEqual([]);
    expect(magazaPanelSayaclari()).toMatchObject({ etiketBasildi: 2, etiketBasildi404: 0, etiketBasildi409: 0 });
  });
  it('etiket basıldı 400: `koli` 0 / -1 / 1.5 / "3", `surum` (uç İSTEMEZ), tanınmayan alan; `iptal` ve `teslim` aşamasında da 200', async () => {
    const d = await kur();
    const b = belirtec(d);
    const id = await talepEkle();
    for (const g of [{ koli: 0 }, { koli: -1 }, { koli: 1.5 }, { koli: '3' }, { surum: 1 }, { koli: 2, not: 'x' }, { koli: null }, [1]]) {
      const y = await panel(d, `/siparisler/${id}/etiket-basildi`, { belirtec: b, govde: g });
      expect(y.kod, JSON.stringify(g)).toBe(400);
      expect(y.metin).toBe('{"ok":false}');
    }
    expect((await belge(id)).etiketBasildi).toBeUndefined();
    for (const durum of ['iptal', 'teslim']) {
      const kapali = await talepEkle({ durum });
      expect((await panel(d, `/siparisler/${kapali}/etiket-basildi`, { belirtec: b, govde: { koli: 1 } })).kod, durum).toBe(200);
    }
  });
  it('rolü düşen kullanıcının belirteci yazma uçlarında da 401 (kapı yetkiyi her istekte yeniden okur; düşürme saat ilerletilmeden)', async () => {
    const d = await kur();
    const b = belirtec(d);
    const id = await talepEkle();
    kullanici(d, 'u-satis', { role: 'Accounting' });
    for (const [uc, g] of [['durum', { onceki: 'sevk', surum: 3, durum: 'teslim' }], ['kalem-teslim', { surum: 3, teslim: true, kalemler: 'hepsi' }], ['etiket-basildi', {}]] as Array<[string, unknown]>) {
      expect((await panel(d, `/siparisler/${id}/${uc}`, { belirtec: b, govde: g })).kod, uc).toBe(401);
    }
    expect(await belge(id)).toEqual(talepVerisi());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('liste — GET /panel/siparisler (§ 4; tek ifade, gerçek motor)', () => {
  /** Çok sayıda satırı tek ifadeyle ekler. */
  async function topluEkle(adet: number, uret: (i: number) => Satir): Promise<void> {
    const satirlar = Array.from({ length: adet }, (_, i) => ({ id: yeniKimlik(), data: talepVerisi(uret(i)) }));
    await db.query(
      `INSERT INTO docs (coll, id, data) SELECT $1, e->>'id', e->'data' FROM jsonb_array_elements($2::jsonb) e`,
      [COLL, JSON.stringify(satirlar)],
    );
  }
  it('kart biçimi: alan alan; null fiyat / toplam KORUNUR; yasak alanlar (geçmiş, bildirim, telefonSon10, companyId, iptalOncesi, ham kalemTeslim, kim) YOK', async () => {
    const d = await kur();
    const id = await talepEkle({
      durumGecmisi: [{ onceki: 'yeni', yeni: 'teyit', zaman: zaman(SAAT_0 - GUN), kim: { uid: 'u-x', ad: 'Gizli Personel' }, kanal: 'erp' }],
      kalemTeslim: { 'b:1': { durum: 'teslim', zaman: zaman(SAAT_0 - 30 * DAKIKA), kim: { uid: 'u-x', ad: 'Gizli Personel' } } },
      etiketBasildi: { zaman: zaman(SAAT_0 - 10 * DAKIKA), koli: 2, kim: { uid: 'u-x', panel: true } },
      iptalOncesi: null,
    });
    const y = await panel(d, '/siparisler', { belirtec: belirtec(d) });
    expect(y.kod).toBe(200);
    expect(y.baslik('cache-control')).toBe('no-store');
    expect(y.json).toEqual({
      siparisler: [{
        id, no: 'T261009-AB12', tarih: zaman(SAAT_0 - 3 * 60 * DAKIKA), guncelleme: zaman(SAAT_0 - 30 * DAKIKA),
        durum: 'sevk', surum: 3, gecisler: ['hazirlaniyor', 'teslim', 'iptal'], aciklama: 'Kargoya verildi', not: 'Öğleden sonra arayın.',
        kaynak: 'magaza_talep',
        musteri: { ad: 'Şükrü Ağaoğlu', firma: 'Iğdır Yapı', telefon: '0532 111 22 33', eposta: 'sukru@ornek.com.tr', il: 'İstanbul', adres: 'Çiçek Sk. 4', vergi: '1234567890' },
        kalemler: [
          { anahtar: 'b:0', sku: 'DYO-0001', ad: 'İç cephe boyası 15 L', marka: 'DYO', adet: 2, birimFiyat: 204.99, tedarik: false, teslim: false },
          { anahtar: 'b:1', sku: 'KRB-77', ad: 'Fayans yapıştırıcısı', marka: 'Karbosan', adet: 5, birimFiyat: null, tedarik: true, teslim: true },
          { anahtar: 'b:2', sku: '', ad: 'Rulo', marka: '', adet: 1, birimFiyat: 49.99, tedarik: false, teslim: false },
        ],
        kalemSayisi: 3, teslimKaynagi: 'beyan', teslimIsaretsiz: 2,
        araToplam: 459.97, kdv: null, toplam: null,
        etiketBasildi: { zaman: zaman(SAAT_0 - 10 * DAKIKA), koli: 2 },
      }],
      acikToplam: 1, kesildi: false,
    });
    for (const yasak of ['durumGecmisi', 'bildirim', 'telefonSon10', 'istemciTarihi', 'companyId', 'iptalOncesi', 'kalemTeslim', '"kim"', 'Gizli Personel', 'talepEdilen', 'talepFiyat']) {
      expect(y.metin, yasak).not.toContain(yasak);
    }
  });
  it('`panelSiparisiEsle` (saf): aşamasız / bilinmeyen → `bilinmiyor` + `gecisler: []`; `surum` yoksa 0; 60 kalem → 50 + `kalemSayisi` 60, `teslimIsaretsiz` BÜTÜNDEN; bozuk etiket → `null`', () => {
    expect(panelSiparisiEsle('mt-x', talepVerisi({ durum: undefined, durumSurum: undefined }))).toMatchObject({ durum: 'bilinmiyor', gecisler: [], surum: 0 });
    expect(panelSiparisiEsle('mt-x', talepVerisi({ durum: 'kargoda', durumSurum: '7' }))).toMatchObject({ durum: 'bilinmiyor', gecisler: [], surum: 0 });
    expect(panelSiparisiEsle('mt-x', talepVerisi({ durum: 'iptal', iptalOncesi: 'teyit' })).gecisler).toEqual(['teyit']);
    expect(panelSiparisiEsle('mt-x', talepVerisi({ durum: 'iptal', iptalOncesi: 'teslim' })).gecisler).toEqual([]);
    const altmis = Array.from({ length: 60 }, (_, i) => ({ ad: `K${i}`, adet: 1, talepFiyat: null }));
    const isaret = { durum: 'teslim', zaman: zaman(SAAT_0), kim: { uid: 'u', ad: 'a' } };
    const kart = panelSiparisiEsle('mt-x', talepVerisi({ kalemler: altmis, kalemTeslim: { 'b:0': isaret, 'b:55': isaret, 'b:59': isaret, 't:0123456789ab': isaret } }));
    expect(MAGAZA_BILDIRIM_KALEM_SINIRI).toBe(50);
    expect(kart.kalemler).toHaveLength(50);
    expect(kart).toMatchObject({ kalemSayisi: 60, teslimIsaretsiz: 57, teslimKaynagi: 'beyan' });
    expect(kart.kalemler[49].anahtar).toBe('b:49');
    for (const bozuk of [null, undefined, 'evet', { koli: 3 }, { zaman: '2026-10-09T15:00:00+03:00' }, { zaman: 7 }]) {
      expect(panelSiparisiEsle('mt-x', talepVerisi({ etiketBasildi: bozuk })).etiketBasildi, JSON.stringify(bozuk)).toBeNull();
    }
    expect(panelSiparisiEsle('mt-x', talepVerisi({ etiketBasildi: { zaman: zaman(SAAT_0), koli: 0 } })).etiketBasildi).toEqual({ zaman: zaman(SAAT_0) });
    // Bozuk kalem / müşteri / tutar: fırlatmaz; bilinmeyen sayı `null` (0 değil).
    const bozukKart = panelSiparisiEsle('mt-x', { durum: 'yeni', kalemler: ['dizge', { ad: 'A', adet: '2', talepFiyat: '9' }], musteri: 'x', talepEdilen: null });
    expect(bozukKart.kalemler).toEqual([
      { anahtar: 'b:0', sku: '', ad: '', marka: '', adet: null, birimFiyat: null, tedarik: false, teslim: false },
      { anahtar: 'b:1', sku: '', ad: 'A', marka: '', adet: null, birimFiyat: null, tedarik: false, teslim: false },
    ]);
    expect(bozukKart).toMatchObject({ araToplam: null, kdv: null, toplam: null, musteri: { ad: '', telefon: '' }, tarih: '', no: '' });
  });
  it('600 kapalı + 40 açık → 40 açığın HEPSİ döner; kapalılardan en çok 200 (en yeni kapanış önce); yinelenen `id` yok', async () => {
    const d = await kur();
    await topluEkle(600, i => ({ durum: i % 2 === 0 ? 'teslim' : 'iptal', durumZamani: zaman(SAAT_0 - (i + 1) * DAKIKA), talepNo: `K-${i}` }));
    await topluEkle(40, i => ({ durum: (['yeni', 'teyit', 'hazirlaniyor', 'sevk'] as const)[i % 4], olusturma: zaman(SAAT_0 - (i + 1) * 60 * DAKIKA), talepNo: `A-${i}` }));
    const y = await panel(d, '/siparisler', { belirtec: belirtec(d) });
    const liste = y.json as PanelListe;
    expect(MAGAZA_PANEL_KAPALI_SINIRI).toBe(200);
    expect(liste).toMatchObject({ acikToplam: 40, kesildi: false });
    const aciklar = liste.siparisler.filter(s => s.no.startsWith('A-'));
    const kapalilar = liste.siparisler.filter(s => s.no.startsWith('K-'));
    expect(aciklar.map(s => s.no)).toEqual(Array.from({ length: 40 }, (_, i) => `A-${i}`));
    expect(kapalilar.map(s => s.no)).toEqual(Array.from({ length: 200 }, (_, i) => `K-${i}`));
    expect(new Set(liste.siparisler.map(s => s.id)).size).toBe(240);
    // Tek ifade: liste için TEK sorgu.
    expect(d.sorgular.filter(s => s === MAGAZA_PANEL_LISTE_SQL)).toHaveLength(1);
    expect(Buffer.byteLength(y.metin, 'utf8')).toBeLessThan(2 * 1024 * 1024);
  }, 30_000);
  it('501 açık → 500 kart, `acikToplam: 501`, `kesildi: true`; 500 açıkta `kesildi: false`', async () => {
    const d = await kur();
    await topluEkle(500, i => ({ durum: 'yeni', olusturma: zaman(SAAT_0 - (i + 1) * 1000), talepNo: `A-${i}` }));
    const tam = (await panel(d, '/siparisler', { belirtec: belirtec(d) })).json as PanelListe;
    expect(MAGAZA_PANEL_ACIK_SINIRI).toBe(500);
    expect(tam).toMatchObject({ acikToplam: 500, kesildi: false });
    expect(tam.siparisler).toHaveLength(500);
    await talepEkle({ durum: 'yeni', olusturma: zaman(SAAT_0 - 999_999_000), talepNo: 'EN-ESKİ' });
    d.saat.ms += MAGAZA_PANEL_LISTE_ONBELLEK_MS;
    const tasan = (await panel(d, '/siparisler', { belirtec: belirtec(d) })).json as PanelListe;
    expect(tasan).toMatchObject({ acikToplam: 501, kesildi: true });
    expect(tasan.siparisler).toHaveLength(500);
    // Düşen en ESKİ açıktır.
    expect(tasan.siparisler.some(s => s.no === 'EN-ESKİ')).toBe(false);
  }, 30_000);
  it('aşamasız / bilinmeyen aşamalı satır AÇIK sayılır ve döner (`bilinmiyor`, `gecisler: []`); tarihsiz satır SONA düşer; başka kiracının talebi listede YOK', async () => {
    const d = await kur();
    const asamasiz = await talepEkle({ durum: undefined, talepNo: 'AŞAMASIZ', olusturma: zaman(SAAT_0 - 1000) });
    const bilinmeyen = await talepEkle({ durum: 'kargoda', talepNo: 'BİLİNMEYEN', olusturma: zaman(SAAT_0 - 2000) });
    const tarihsiz = await talepEkle({ durum: 'yeni', olusturma: undefined, durumZamani: undefined, talepNo: 'TARİHSİZ' });
    const olagan = await talepEkle({ durum: 'yeni', talepNo: 'OLAĞAN', olusturma: zaman(SAAT_0 - 3000) });
    await talepEkle({ companyId: 'kiraci-2', talepNo: 'BAŞKA' });
    await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', ['orders', yeniKimlik(), JSON.stringify(talepVerisi({ talepNo: 'BAŞKA-KOLEKSİYON' }))]);
    const liste = (await panel(d, '/siparisler', { belirtec: belirtec(d) })).json as PanelListe;
    expect(liste.siparisler.map(s => s.id)).toEqual([asamasiz, bilinmeyen, olagan, tarihsiz]);
    expect(liste.siparisler.slice(0, 2).map(s => [s.durum, s.gecisler])).toEqual([['bilinmiyor', []], ['bilinmiyor', []]]);
    expect(liste).toMatchObject({ acikToplam: 4, kesildi: false });
  });
  it('KAPALI penceresi KAPANIŞ zamanınındır: 31 gün önce gelen, bugün kapatılan listede; 31 gün önce kapatılan DEĞİL; sonradan verilen kalem işareti / etiket pencereyi UZATMAZ', async () => {
    const d = await kur();
    const bugunKapanan = await talepEkle({ durum: 'teslim', olusturma: zaman(SAAT_0 - 31 * GUN), durumZamani: zaman(SAAT_0 - 1000), talepNo: 'BUGÜN' });
    const sinirda = await talepEkle({ durum: 'iptal', olusturma: zaman(SAAT_0 - 40 * GUN), durumZamani: zaman(SAAT_0 - MAGAZA_PANEL_KAPALI_PENCERE_MS), talepNo: 'SINIRDA' });
    await talepEkle({ durum: 'teslim', olusturma: zaman(SAAT_0 - 40 * GUN), durumZamani: zaman(SAAT_0 - 31 * GUN), talepNo: 'ESKİ' });
    // 31 gün önce kapanan, bugün işaretlenen / etiketi basılan talep: pencere dışında kalır.
    await talepEkle({
      durum: 'teslim', olusturma: zaman(SAAT_0 - 40 * GUN), durumZamani: zaman(SAAT_0 - 31 * GUN), talepNo: 'ESKİ-İŞARETLİ',
      kalemTeslim: { 'b:0': { durum: 'teslim', zaman: zaman(SAAT_0 - 1000), kim: { uid: 'u', ad: 'a' } } },
      etiketBasildi: { zaman: zaman(SAAT_0 - 1000), kim: { uid: 'u', panel: true } },
    });
    // `durumZamani` yokken kapanış zamanı `olusturma`dır.
    const zamansiz = await talepEkle({ durum: 'teslim', olusturma: zaman(SAAT_0 - 2 * GUN), durumZamani: undefined, talepNo: 'ZAMANSIZ' });
    const liste = (await panel(d, '/siparisler', { belirtec: belirtec(d) })).json as PanelListe;
    expect(liste.siparisler.map(s => s.id)).toEqual([bugunKapanan, zamansiz, sinirda]);
    expect(liste).toMatchObject({ acikToplam: 0, kesildi: false });
    // Kapalı talepte de kartın `guncelleme`si kalem zamanını gösterir.
    const isaretli = await talepEkle({
      durum: 'teslim', durumZamani: zaman(SAAT_0 - 5 * GUN), talepNo: 'İŞARETLİ',
      kalemTeslim: { 'b:0': { durum: 'bekliyor', zaman: zaman(SAAT_0 - 1000), kim: { uid: 'u', ad: 'a' } } },
    });
    d.saat.ms += MAGAZA_PANEL_LISTE_ONBELLEK_MS;
    const sonra = (await panel(d, '/siparisler', { belirtec: belirtec(d) })).json as PanelListe;
    expect(sonra.siparisler.find(s => s.id === isaretli)).toMatchObject({ guncelleme: zaman(SAAT_0 - 1000), durum: 'teslim' });
  });
  it('önbellek: 25 sn içinde N istek TEK sorgu; değişiklik olayında düşer; 25 sn sonra yeniden sorgulanır; yetkisi düşen kullanıcıya önbellekten yanıt GİTMEZ', async () => {
    const d = await kur();
    const b = belirtec(d);
    const id = await talepEkle();
    const say = (): number => d.sorgular.filter(s => s === MAGAZA_PANEL_LISTE_SQL).length;
    for (let i = 0; i < 5; i++) expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(200);
    expect(say()).toBe(1);
    d.saat.ms += MAGAZA_PANEL_LISTE_ONBELLEK_MS - 1;
    await panel(d, '/siparisler', { belirtec: b });
    expect(say()).toBe(1);
    d.saat.ms += 1;
    await panel(d, '/siparisler', { belirtec: b });
    expect(say()).toBe(2);
    // Başka yoldan (ERP) gelen yazım değişiklik olayı üretir → önbellek düşer, sonraki liste günceldir.
    expect((await erp(d, `/api/magaza-talepleri/${id}/kalem-teslim`, 'u-mudur', { surum: 3, teslim: true, kalemler: ['b:2'] })).kod).toBe(200);
    const guncel = await panel(d, '/siparisler', { belirtec: b });
    expect(say()).toBe(3);
    expect(siparisler(guncel)[0].kalemler.map(k => k.teslim)).toEqual([false, false, true]);
    // Başka koleksiyonun olayı önbelleği düşürmez (dilim 1 talep yazımı AYNI koleksiyondur, düşürür).
    await panel(d, '/siparisler', { belirtec: b });
    expect(say()).toBe(3);
    // Süren sorgu paylaşılır: önbellek boşken AYNI anda gelen 8 istek TEK sorgu.
    d.saat.ms += MAGAZA_PANEL_LISTE_ONBELLEK_MS;
    const dalga = await Promise.all(Array.from({ length: 8 }, () => panel(d, '/siparisler', { belirtec: b })));
    expect(dalga.map(y => y.kod)).toEqual(Array.from({ length: 8 }, () => 200));
    expect(say()).toBe(4);
    // Kapı önbellekten ÖNCE.
    kullanici(d, 'u-satis', { role: 'HR' });
    expect((await panel(d, '/siparisler', { belirtec: b })).kod).toBe(401);
    expect(say()).toBe(4);
  });
  it('kuşak: geç dönen sorgu, o sırada gelen değişiklikten SONRA önbelleği doldurmaz (bayat gövde 25 sn kilitlenmez)', async () => {
    const d = await kur();
    const b = belirtec(d);
    const id = await talepEkle();
    let birak: () => void = () => undefined;
    const bekleyen = new Promise<void>(coz => { birak = coz; });
    let ilk = true;
    d.gecikme = async (sql) => { if (ilk && sql === MAGAZA_PANEL_LISTE_SQL) { ilk = false; await bekleyen; } };
    const gec = panel(d, '/siparisler', { belirtec: b });
    // Sorgu satırları okudu ama dönmedi; araya etiket yazımı (değişiklik olayı) giriyor.
    await vi.waitFor(() => { expect(ilk).toBe(false); });
    expect((await panel(d, `/siparisler/${id}/etiket-basildi`, { belirtec: b, govde: { koli: 4 } })).kod).toBe(200);
    birak();
    // Geç dönen yanıt bayattır (kendi anlık görüntüsü) ama önbelleğe YAZILMAZ: sonraki istek güncel değeri okur.
    expect(siparisler(await gec)[0].etiketBasildi).toBeNull();
    expect(siparisler(await panel(d, '/siparisler', { belirtec: b }))[0].etiketBasildi).toEqual({ zaman: zaman(SAAT_0), koli: 4 });
  });
  it('TEK ifade = tek anlık görüntü: aynı satır açık VE kapalı kümede birlikte dönemez; `acikToplam` aynı ifadeden (gerçek motor)', async () => {
    await topluEkle(3, i => ({ durum: 'sevk', talepNo: `A-${i}` }));
    await topluEkle(2, i => ({ durum: 'teslim', durumZamani: zaman(SAAT_0 - 1000), talepNo: `K-${i}` }));
    const r = await db.query<Satir>(MAGAZA_PANEL_LISTE_SQL, [COLL, CID, zaman(SAAT_0 - MAGAZA_PANEL_KAPALI_PENCERE_MS)]);
    expect(r.rows.map(s => s.tur).sort()).toEqual(['a', 'a', 'a', 'k', 'k']);
    expect(r.rows.filter(s => s.tur === 'a').every(s => Number(s.toplam) === 3)).toBe(true);
    expect(r.rows.filter(s => s.tur === 'k').every(s => s.toplam === null)).toBe(true);
    // Kaynak: tek ifade (iki CTE + UNION ALL), noktalı virgül yok; açık ölçütü bekçiyle AYNI sabit; metin karşılaştırması `COLLATE "C"`.
    expect(MAGAZA_PANEL_LISTE_SQL).not.toContain(';');
    expect(MAGAZA_PANEL_LISTE_SQL.match(/COALESCE\(data->>'durum', ''\) NOT IN \('teslim', 'iptal'\)/g)).toHaveLength(2);
    expect(MAGAZA_PANEL_LISTE_SQL).toContain(`AND NOT (COALESCE(data->>'durum', '') NOT IN ('teslim', 'iptal'))`);
    expect(MAGAZA_PANEL_LISTE_SQL.match(/COLLATE "C"/g)).toHaveLength(3);   // açık sırası + kapalı süzgeci + kapalı sırası
    expect(MAGAZA_PANEL_LISTE_SQL).toMatch(/LIMIT 500\), kapali AS .* LIMIT 200\) SELECT 'a' AS tur, id, data, toplam FROM acik UNION ALL SELECT 'k', id, data, NULL FROM kapali$/);
    expect(MAGAZA_PANEL_LISTE_SQL).not.toMatch(/now\(\)|::timestamptz|UPDATE|DELETE|INSERT/);
  });
  it('`panelListesiKur` (saf): bütçe aşılınca ÖNCE en eski kapalılar, SONRA en eski açıklar kırpılır ve `kesildi: true`; çift satır bir kez; `acikToplam` satır yokken 0', () => {
    const satir = (tur: 'a' | 'k', i: number, ek: Satir = {}): Satir => ({
      tur, id: `mt-${tur}${i}`, toplam: tur === 'a' ? '3' : null,
      data: talepVerisi({ durum: tur === 'a' ? 'sevk' : 'teslim', olusturma: zaman(SAAT_0 - i * DAKIKA), durumZamani: zaman(SAAT_0 - i * DAKIKA), not: 'n'.repeat(1000), ...ek }),
    });
    const rows = [satir('a', 1), satir('a', 2), satir('a', 3), satir('k', 1), satir('k', 2), satir('k', 3), satir('a', 1)];
    const tam = panelListesiKur(rows);
    expect(tam.siparisler.map(s => s.id)).toEqual(['mt-a1', 'mt-a2', 'mt-a3', 'mt-k1', 'mt-k2', 'mt-k3']);
    expect(tam).toMatchObject({ acikToplam: 3, kesildi: false });
    const kartBoyu = Buffer.byteLength(JSON.stringify(tam.siparisler[0]), 'utf8');
    // Bütçe 4 karta yetiyor: iki en eski kapalı düşer.
    const dort = panelListesiKur(rows, kartBoyu * 4 + 200);
    expect(dort.siparisler.map(s => s.id)).toEqual(['mt-a1', 'mt-a2', 'mt-a3', 'mt-k1']);
    expect(dort.kesildi).toBe(true);
    // Bütçe 2 karta yetiyor: bütün kapalılar, sonra en eski açık düşer.
    const iki = panelListesiKur(rows, kartBoyu * 2 + 200);
    expect(iki.siparisler.map(s => s.id)).toEqual(['mt-a1', 'mt-a2']);
    expect(iki).toMatchObject({ acikToplam: 3, kesildi: true });
    expect(Buffer.byteLength(JSON.stringify(iki), 'utf8')).toBeLessThanOrEqual(kartBoyu * 2 + 200);
    expect(panelListesiKur([])).toEqual({ siparisler: [], acikToplam: 0, kesildi: false });
    expect(panelListesiKur([{ tur: 'a', id: 7, data: {} }, { tur: 'a', id: 'mt-x', data: 'çöp' }]).siparisler).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('ERP uçları — aşama, kalem teslim, elle bildirim (§ 4; `magazaErpRoutes.ts`)', () => {
  const YOL = (id: string, uc: string): string => `/api/magaza-talepleri/${id}/${uc}`;
  const GOVDELER: Record<string, unknown> = {
    durum: { onceki: 'sevk', surum: 3, durum: 'teslim' }, 'kalem-teslim': { surum: 3, teslim: true, kalemler: ['b:0'] }, 'bildirim-gonder': {},
  };
  const bildirimsiz = { bildirim: { durum: 'gonderilemedi', zaman: zaman(SAAT_0 - GUN), deneme: 3, hataSinifi: 'baglanti' } };

  it('üç uçta da: yetkili üç rol 200 `{ ok: true }` + diğer BÜTÜN `APP_ROLES` 403 `{ ok: false, kod: "rol" }` + kayıtsız kullanıcı 403 + kimliksiz 401', async () => {
    const d = await kur();
    const yetkililer = APP_ROLES.filter(r => magazaTalepIslemYetkisi(r));
    expect([...yetkililer].sort()).toEqual(['Admin', 'Manager', 'Sales']);
    for (const [uc, govde] of Object.entries(GOVDELER)) {
      for (const rol of APP_ROLES) {
        const uid = `u-rol-${rol}`;
        kullanici(d, uid, { role: rol, name: rol });
        const id = await talepEkle(bildirimsiz);
        const y = await erp(d, YOL(id, uc), uid, govde);
        if (yetkililer.includes(rol)) {
          expect(y.kod, `${uc} ${rol}`).toBe(200);
          expect(y.json).toEqual({ ok: true });
        } else {
          expect(y.kod, `${uc} ${rol}`).toBe(403);
          expect(y.json).toEqual({ ok: false, kod: 'rol' });
          expect(await belge(id)).toEqual(talepVerisi(bildirimsiz));
        }
      }
      const id = await talepEkle(bildirimsiz);
      const kayitsiz = await erp(d, YOL(id, uc), 'u-kayitsiz', govde);
      expect(kayitsiz.kod).toBe(403);
      expect(kayitsiz.json).toEqual({ ok: false, kod: 'rol' });
      const kimliksiz = await erp(d, YOL(id, uc), null, govde);
      expect(kimliksiz.kod).toBe(401);
      expect(kimliksiz.json).toEqual({ error: 'Missing Authorization header.' });
    }
  });
  it('zincir: MFA kapısı üç uçta da (gövdesi AYNEN); `panelKullanicisi` fırlatınca 503; `dbLimiter` tavanı dolunca ÜÇÜ de 429 (ayrı kova yok — çıkış ucuyla aynı)', async () => {
    const d = await kur({ dbTavani: 4 });
    const id = await talepEkle(bildirimsiz);
    d.mfaEngeli = true;
    for (const [uc, govde] of Object.entries(GOVDELER)) {
      const y = await erp(d, YOL(id, uc), 'u-satis', govde);
      expect(y.kod, uc).toBe(403);
      expect(y.json).toEqual({ error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true });
    }
    d.mfaEngeli = false;
    // MFA reddi kovaya sayılmaz (sınırlayıcı zincirde kimlik ve MFA kapısından SONRA).
    d.sahte.durum.okumaHatasi = Object.assign(new Error(ISARET), { code: '57P01' });
    d.kullaniciOkuyucu.temizle();
    const hata = await erp(d, YOL(id, 'durum'), 'u-satis', GOVDELER.durum);
    expect(hata.kod).toBe(503);
    expect(hata.json).toEqual({ ok: false });
    d.sahte.durum.okumaHatasi = null;
    expect((await iste(d, '/api/db/session/logout', { govde: {} })).kod).toBe(200);
    expect((await erp(d, YOL(id, 'kalem-teslim'), 'u-satis', GOVDELER['kalem-teslim'])).kod).toBe(200);
    expect((await erp(d, YOL(id, 'bildirim-gonder'), 'u-satis', {})).kod).toBe(200);
    for (const [uc, govde] of Object.entries(GOVDELER)) expect((await erp(d, YOL(id, uc), 'u-satis', govde)).kod, uc).toBe(429);
    expect((await iste(d, '/api/db/session/logout', { govde: {} })).kod).toBe(429);
    expect(konsol).toEqual(['error: [magaza-erp] kullanıcı okunamadı: 57P01']);
  });
  it('aşama: SAKLANAN sözlük (`yeni`); yazma işlevine `kanal: "erp"`, kiracı ve ad `panelKullanicisi`\'nden (gövdeden `companyId` alınmaz); 409 güncel aşama saklanan sözlükle', async () => {
    const d = await kur();
    const id = await talepEkle({ durum: 'yeni', durumSurum: 0 });
    // Panel sözlüğü (`alindi`) ERP ucunda 400'dür; `companyId` tanınmayan alandır.
    expect((await erp(d, YOL(id, 'durum'), 'u-mudur', { onceki: 'alindi', surum: 0, durum: 'teyit' })).kod).toBe(400);
    expect((await erp(d, YOL(id, 'durum'), 'u-mudur', { onceki: 'yeni', surum: 0, durum: 'teyit', companyId: CID })).kod).toBe(400);
    expect((await erp(d, YOL(id, 'durum'), 'u-mudur', { onceki: 'yeni', durum: 'teyit' })).kod).toBe(400);
    const y = await erp(d, YOL(id, 'durum'), 'u-mudur', { onceki: 'yeni', surum: 0, durum: 'teyit' });
    expect(y.kod).toBe(200);
    expect(y.json).toEqual({ ok: true });
    expect((await belge(id)).durumGecmisi).toEqual([{ onceki: 'yeni', yeni: 'teyit', zaman: zaman(SAAT_0), kim: { uid: 'u-mudur', ad: 'Müdür Bey' }, kanal: 'erp' }]);
    expect(d.denetim).toEqual([[{ uid: 'u-mudur', email: 'u-mudur@ornek.com.tr' }, 'Mağaza talebi durumu', 'T261009-AB12 · erp · açıklama yok', { durum: { from: 'yeni', to: 'teyit' } }]]);
    const bayat = await erp(d, YOL(id, 'durum'), 'u-mudur', { onceki: 'yeni', surum: 0, durum: 'teyit' });
    expect(bayat.kod).toBe(409);
    expect(bayat.json).toEqual({ ok: false, kod: 'gecis-yok', durum: 'teyit' });
    const bilinmeyen = await talepEkle({ durum: 'kargoda' });
    expect((await erp(d, YOL(bilinmeyen, 'durum'), 'u-mudur', { onceki: 'sevk', surum: 3, durum: 'teslim' })).json).toEqual({ ok: false, kod: 'gecis-yok' });
    // Başka kiracının talebi / bozuk kimlik 404; başka kiracının kullanıcısı KENDİ kiracısına yazar (bu talebi göremez).
    const baska = await talepEkle({ companyId: 'kiraci-2' });
    for (const [kimlik, uid] of [[baska, 'u-mudur'], ['mt-bozuk', 'u-mudur'], [id, 'u-baska']] as Array<[string, string]>) {
      const r = await erp(d, YOL(kimlik, 'durum'), uid, { onceki: 'sevk', surum: 3, durum: 'teslim' });
      expect(r.kod, `${kimlik} ${uid}`).toBe(404);
      expect(r.json).toEqual({ ok: false });
    }
    expect(magazaPanelSayaclari()).toMatchObject({ durumErp: 1, durumErp409: 2, durumPanel: 0 });
  });
  it('kalem teslim: panelle AYNI şema; 409 `gecis-yok` (saklanan sözlük, `iptal`), `surum-eski`; `gecersiz` ve şema 400; 404', async () => {
    const d = await kur();
    const id = await talepEkle();
    expect((await erp(d, YOL(id, 'kalem-teslim'), 'u-yonetici', { surum: 3, teslim: true, kalemler: 'hepsi' })).json).toEqual({ ok: true });
    expect((await belge(id)).kalemTeslim).toEqual(Object.fromEntries(['b:0', 'b:1', 'b:2'].map(a => [a, { durum: 'teslim', zaman: zaman(SAAT_0), kim: { uid: 'u-yonetici', ad: 'Yönetici Hanım' } }])));
    expect(d.denetim[0].slice(1)).toEqual(['Mağaza talebi kalem teslimi', 'T261009-AB12 · erp · beyan · işaretlendi 3 / kaldırıldı 0']);
    // `gecis-yok` DURUM KODUYLA birlikte sabit (inceleme 2026-10-10): yalnız gövdeye bakan çit 409 → 200 / 500 değişimini görmüyordu;
    // istemci (`magazaKalemTeslimYaz`) hükmü durum kodundan verir.
    const bayat = await erp(d, YOL(id, 'kalem-teslim'), 'u-yonetici', { surum: 3, teslim: false, kalemler: ['b:0'] });
    expect(bayat.kod).toBe(409);
    expect(bayat.json).toEqual({ ok: false, kod: 'gecis-yok', durum: 'sevk' });
    const iptal = await talepEkle({ durum: 'iptal' });
    const iptalYaniti = await erp(d, YOL(iptal, 'kalem-teslim'), 'u-yonetici', { surum: 3, teslim: true, kalemler: 'hepsi' });
    expect(iptalYaniti.kod).toBe(409);
    expect(iptalYaniti.json).toEqual({ ok: false, kod: 'gecis-yok', durum: 'iptal' });
    const yeni = await talepEkle({ durum: 'yeni', durumSurum: 0 });
    for (const g of [{ surum: 0, teslim: true, kalemler: ['b:01'] }, { surum: 0, teslim: true, kalemler: ['b:3'] }, { surum: 0, teslim: true }, { surum: 0, teslim: true, kalemler: 'hepsi', companyId: CID }]) {
      const y = await erp(d, YOL(yeni, 'kalem-teslim'), 'u-yonetici', g);
      expect(y.kod, JSON.stringify(g)).toBe(400);
      expect(y.json).toEqual({ ok: false });
    }
    expect((await erp(d, YOL(SIFIR_KIMLIK, 'kalem-teslim'), 'u-yonetici', { surum: 0, teslim: true, kalemler: 'hepsi' })).kod).toBe(404);
    // `yeni` aşamasında İZİNLİ.
    expect((await erp(d, YOL(yeni, 'kalem-teslim'), 'u-yonetici', { surum: 0, teslim: true, kalemler: ['b:2'] })).kod).toBe(200);
    // Kaynak değişimi yarışı → `surum-eski`.
    const yaris = await talepEkle();
    let yapildi = false;
    d.kanca = async (sql) => {
      if (yapildi || !sql.startsWith('SELECT') || !sql.includes('icerik_surum')) return;
      yapildi = true;
      await db.query(`UPDATE docs SET data = data || '{"icerikSurum": 1}'::jsonb WHERE id = $1`, [yaris]);
    };
    const eski = await erp(d, YOL(yaris, 'kalem-teslim'), 'u-yonetici', { surum: 3, teslim: true, kalemler: ['b:0'] });
    d.kanca = null;
    expect(eski.kod).toBe(409);
    expect(eski.json).toEqual({ ok: false, kod: 'surum-eski' });
    expect(magazaPanelSayaclari()).toMatchObject({ kalemTeslimErp: 2, kalemTeslimErp409: 3, kalemTeslimPanel: 0 });
  });
  it('elle bildirim 200: `bildirim` TAM OLARAK `{ durum: "bekliyor", zaman }`; `bildirimIste` tam 1 kez ve YANITTAN ÖNCE; yayın RETURNING satırı; denetim 1 kayıt; sürüm artmaz', async () => {
    let cozuldu = false;
    const d = await kur({ bildirimIste: async () => { await new Promise(coz => setTimeout(coz, 30)); cozuldu = true; } });
    const id = await talepEkle(bildirimsiz);
    const y = await erp(d, YOL(id, 'bildirim-gonder'), 'u-satis', {});
    expect(y.kod).toBe(200);
    expect(y.json).toEqual({ ok: true });
    expect(cozuldu).toBe(true);
    expect(d.bildirimler).toEqual([id]);
    const yazilan = await belge(id);
    expect(yazilan).toEqual(talepVerisi({ bildirim: { durum: 'bekliyor', zaman: zaman(SAAT_0) } }));
    expect(d.yayinlar).toEqual([[COLL, 'set', id, yazilan, { cid: CID }]]);
    expect(d.denetim).toEqual([[{ uid: 'u-satis', email: 'u-satis@ornek.com.tr' }, 'Mağaza talebi bildirimi elle kuyruğa alındı', 'T261009-AB12 · erp']]);
    expect(JSON.stringify(d.denetim)).not.toMatch(/Şükrü|sukru@|0532/);
    expect(magazaPanelSayaclari()).toMatchObject({ bildirimGonder: 1, bildirimGonder409: 0 });
    // `yapilandirilmamis` ve süresi geçmiş `bekliyor` da yeniden kuyruğa alınır.
    for (const durum of ['yapilandirilmamis', 'bekliyor']) {
      const baska = await talepEkle({ bildirim: { durum, zaman: zaman(SAAT_0 - GUN) } });
      expect((await erp(d, YOL(baska, 'bildirim-gonder'), 'u-satis', {})).kod, durum).toBe(200);
      expect((await belge(baska)).bildirim).toEqual({ durum: 'bekliyor', zaman: zaman(SAAT_0) });
    }
  });
  it('elle bildirim: kuyruğa ekleme reddetse de yazım geri alınmaz, 200 döner (kaçan süpürmesi sahiplenir)', async () => {
    const d = await kur({ bildirimIste: () => Promise.reject(Object.assign(new Error(ISARET), { code: 'EKUYRUK' })) });
    const id = await talepEkle(bildirimsiz);
    expect((await erp(d, YOL(id, 'bildirim-gonder'), 'u-satis', {})).kod).toBe(200);
    expect((await belge(id)).bildirim).toEqual({ durum: 'bekliyor', zaman: zaman(SAAT_0) });
    expect(konsol).toHaveLength(1);
  });
  it('elle bildirim 409: `kapali` (eksik listesi YOK) · `yapilandirilmamis` + `kip` + eksik ADLARI · `zaten-gitti` — üçünde de SQL yazımı / kuyruk / denetim 0', async () => {
    const id = await talepEkle(bildirimsiz);
    const kapali = await kur({ smtp: { tamam: false, eksik: [], kip: 'kapali' } });
    const y1 = await erp(kapali, YOL(id, 'bildirim-gonder'), 'u-satis', {});
    expect(y1.kod).toBe(409);
    expect(y1.json).toEqual({ ok: false, kod: 'kapali' });
    const eksik = await kur({ smtp: { tamam: false, eksik: ['APP_URL'], kip: 'yerel' } });
    const y2 = await erp(eksik, YOL(id, 'bildirim-gonder'), 'u-satis', {});
    expect(y2.kod).toBe(409);
    expect(y2.json).toEqual({ ok: false, kod: 'yapilandirilmamis', kip: 'yerel', eksik: ['APP_URL'] });
    for (const d of [kapali, eksik]) {
      expect(d.sorgular.filter(s => /UPDATE/.test(s))).toEqual([]);
      expect([d.bildirimler, d.denetim, d.yayinlar]).toEqual([[], [], []]);
    }
    expect(await belge(id)).toEqual(talepVerisi(bildirimsiz));
    const d = await kur();
    const gitti = await talepEkle();
    const y3 = await erp(d, YOL(gitti, 'bildirim-gonder'), 'u-satis', {});
    expect(y3.kod).toBe(409);
    expect(y3.json).toEqual({ ok: false, kod: 'zaten-gitti' });
    expect(await belge(gitti)).toEqual(talepVerisi());
    expect([d.bildirimler, d.denetim, d.yayinlar]).toEqual([[], [], []]);
    expect(magazaPanelSayaclari()).toMatchObject({ bildirimGonder: 0, bildirimGonder409: 3 });
  });
  it('elle bildirim: gövde `{}` dışı 400; `?tur` 2a\'da tanınmaz (400); bozuk kimlik / başka kiracı 404; bozuk JSON genel ayrıştırıcıdan (rota gövdesiz kalmıyor)', async () => {
    const d = await kur();
    const id = await talepEkle(bildirimsiz);
    for (const g of [{ tur: 'ilk' }, { id }, [], { '': 0 }]) expect((await erp(d, YOL(id, 'bildirim-gonder'), 'u-satis', g)).kod, JSON.stringify(g)).toBe(400);
    for (const sorgu of ['?tur=revize', '?tur=ilk', '?tur=']) expect((await erp(d, `${YOL(id, 'bildirim-gonder')}${sorgu}`, 'u-satis', {})).kod, sorgu).toBe(400);
    // Yanlış içerik türü: zincirde 415 denetimi YOK — genel ayrıştırıcı gövdeyi atlar, `.strict()` 400 verir.
    expect((await erp(d, YOL(id, 'durum'), 'u-satis', undefined, { ham: JSON.stringify(GOVDELER.durum), tur: 'text/plain' })).kod).toBe(400);
    const baska = await talepEkle({ companyId: 'kiraci-2', ...bildirimsiz });
    for (const kimlik of [baska, 'mt-bozuk', SIFIR_KIMLIK]) {
      const y = await erp(d, YOL(kimlik, 'bildirim-gonder'), 'u-satis', {});
      expect(y.kod, kimlik).toBe(404);
      expect(y.json).toEqual({ ok: false });
    }
    expect(await belge(id)).toEqual(talepVerisi(bildirimsiz));
    // Bozuk JSON: genel ayrıştırıcı zincirde (rota modülü ayrıştırıcıdan SONRA kayıtlı) → kimlik kapısına bile varmaz.
    const bozuk = await iste(d, YOL(id, 'durum'), { ham: '{bozuk', belirtec: 'erp-u-satis' });
    expect(bozuk.kod).toBe(400);
    expect(d.kacan.genelYakalayici).toBe(1);
    // ERP'de etiket ucu YOK (yalnız panelde): zincirin rota-yok 404'ü.
    const etiket = await erp(d, YOL(id, 'etiket-basildi'), 'u-satis', {});
    expect(etiket.kod).toBe(404);
    expect(etiket.json).toEqual({ error: 'Not found' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('takip okuması — `MAGAZA_TAKIP_SQL` gerçek motorda (§ 4; rota mantığı magazaRoutes.test.ts\'te)', () => {
  const sor = async (id: string, cid = CID): Promise<Satir | undefined> => (await db.query<Satir>(MAGAZA_TAKIP_SQL, [COLL, id, cid])).rows[0];

  it('kalemler ÜÇ alana iner (+ dizideki yer); SKU / fiyat / id / tedarik / müşteri belleğe GELMEZ; nesne olmayan öğe atılır, sayım TAM uzunluktur', async () => {
    const id = await talepEkle({ kalemler: [{ id: 'u-1', sku: 'DYO-0001', ad: 'Boya', marka: 'DYO', adet: 2, talepFiyat: 204.99, tedarik: true }, 'dizge', 42, null, { ad: 'Rulo', adet: 1 }] });
    const s = await sor(id);
    expect(s).toEqual({
      durum: 'sevk', aciklama: 'Kargoya verildi', zaman: zaman(SAAT_0 - 2 * 60 * DAKIKA), olusturma: zaman(SAAT_0 - 3 * 60 * DAKIKA),
      // Nesne olmayan üç öğe atıldı; kalan kalemler dizideki YERİNİ korur (`b:4` işareti `b:1`e kaymaz).
      kalemler: [{ sira: 0, ad: 'Boya', marka: 'DYO', adet: 2 }, { sira: 4, ad: 'Rulo', marka: null, adet: 1 }],
      beyan_sayisi: 5, teyit_kalemleri: null, teyit_sayisi: 0, kalem_teslim: null,
    });
    const metin = JSON.stringify(s);
    for (const yasak of ['DYO-0001', '204.99', 'u-1', 'tedarik', 'Şükrü', '5321112233', 'Öğleden', 'gitti']) expect(metin, yasak).not.toContain(yasak);
  });
  it('`kalemler` / `teyit.kalemler` dizi DEĞİLSE hata yok (boş); teyit kalemi `anahtar`ını taşır; kiracı ve kimlik koşulu', async () => {
    const bozuk = await talepEkle({ kalemler: 'dizge', teyit: { kalemler: { a: 1 } }, kalemTeslim: 'çöp' });
    expect(await sor(bozuk)).toMatchObject({ kalemler: [], beyan_sayisi: 0, teyit_kalemleri: null, teyit_sayisi: 0, kalem_teslim: 'çöp' });
    const teyitli = await talepEkle({
      teyit: { kalemler: [{ anahtar: 't:0123456789ab', sku: 'X', ad: 'Teyitli', marka: 'M', adet: 3, birimFiyat: 10 }, 7] },
      kalemTeslim: { 't:0123456789ab': { durum: 'teslim', zaman: zaman(SAAT_0), kim: { uid: 'u', ad: 'a' } } },
    });
    expect(await sor(teyitli)).toMatchObject({
      teyit_kalemleri: [{ anahtar: 't:0123456789ab', ad: 'Teyitli', marka: 'M', adet: 3 }], teyit_sayisi: 2, beyan_sayisi: 3,
    });
    expect(await sor(teyitli, 'kiraci-2')).toBeUndefined();
    expect(await sor(SIFIR_KIMLIK)).toBeUndefined();
  });
  it('uçtan uca (gerçek motor): mağazanın yazdığı talep, takip ucundan kalem listesi ve teslim işaretiyle okunur', async () => {
    const d = await kur();
    const no = 'T261009-ZK77';
    const talep = await iste(d, '/api/magaza/siparis-talebi', {
      koken: IZINLI,
      govde: { no, musteri: { ad: 'Şükrü Ağaoğlu', telefon: '+90 (532) 123 45 67' }, kalemler: [{ ad: 'İç cephe boyası', marka: 'DYO', sku: 'DYO-1', adet: 2, birimFiyat: 204.99 }, { ad: 'Rulo', adet: 1 }] },
    });
    expect(talep.kod).toBe(201);
    const id = magazaTalepKimligi(CID, no, '5321234567');
    d.saat.ms += 5000;
    expect((await erp(d, `/api/magaza-talepleri/${id}/kalem-teslim`, 'u-satis', { surum: 0, teslim: true, kalemler: ['b:1'] })).kod).toBe(200);
    const y = await iste(d, '/api/magaza/siparis-durumu', { koken: IZINLI, govde: { no, telefon: '0532 123 45 67' } });
    expect(y.kod).toBe(200);
    expect(y.json).toEqual({
      ok: true, durum: 'alindi', tarih: zaman(SAAT_0), guncelleme: zaman(SAAT_0 + 5000), kaynak: 'beyan',
      kalemler: [{ ad: 'İç cephe boyası', marka: 'DYO', adet: 2, teslim: false }, { ad: 'Rulo', adet: 1, teslim: true }], kalemSayisi: 2,
    });
    expect(y.baslik('cache-control')).toBe('no-store');
    for (const yasak of ['DYO-1', '204.99', 'Şükrü', '532']) expect(y.metin, yasak).not.toContain(yasak);
    // Yanlış telefonla aynı no: bulunamadı (kimlik no + telefondan türer).
    expect((await iste(d, '/api/magaza/siparis-durumu', { koken: IZINLI, govde: { no, telefon: '0532 123 45 68' } })).json).toEqual({ ok: false, kod: 'bulunamadi' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('sayaçlar ve 429 yazıcıları', () => {
  it('`magazaPanelSayaclari()`: anahtarlar SABİT, sıfırdan başlar, dönen nesne kopyadır; dilim 1 sayaçlarına KARIŞMAZ', () => {
    expect(Object.keys(magazaPanelSayaclari())).toEqual([
      'oturum', 'oturum401', 'oturum503', 'yetkiKodu', 'yetkiKoduRet', 'yetkiKoduIptalDenetimsiz',
      'durumPanel', 'durumPanel409', 'durumErp', 'durumErp409',
      'kalemTeslimPanel', 'kalemTeslimPanel409', 'kalemTeslimErp', 'kalemTeslimErp409', 'etiketBasildi', 'etiketBasildi404', 'etiketBasildi409',
      'bildirimGonder', 'bildirimGonder409', 'cikisUidsiz', 'r401', 'r403', 'r404', 'r429', 'r500', 'r503',
    ]);
    expect(Object.values(magazaPanelSayaclari()).every(v => v === 0)).toBe(true);
    (magazaPanelSayaclari() as Record<string, number>).oturum = 99;
    expect(magazaPanelSayaclari().oturum).toBe(0);
    expect(Object.keys(magazaSayaclari())).toEqual(['eklenen', 'cakisan', 'r400', 'r403', 'r404', 'r413', 'r415', 'r429', 'r500', 'r503']);
    // Bekçinin sayaç özeti adı kod kimliği biçiminde bekler.
    for (const ad of Object.keys(magazaPanelSayaclari())) expect(ad).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,39}$/);
  });
  it('`magazaPanel429` ve `magazaYetkiKodu429`: sabit gövde + kendi sayacı; dilim 1\'in `r429`\'u ARTMAZ', () => {
    const cagrilar: unknown[] = [];
    const yanit = { setHeader() { return yanit; }, status(kod: number) { cagrilar.push(kod); return yanit; }, json(g: unknown) { cagrilar.push(g); return yanit; } };
    magazaPanel429({} as Request, yanit as unknown as Response);
    magazaYetkiKodu429({} as Request, yanit as unknown as Response);
    expect(cagrilar).toEqual([429, { ok: false }, 429, { ok: false, kod: 'sinir' }]);
    expect(magazaPanelSayaclari()).toMatchObject({ r429: 1, yetkiKoduRet: 1 });
    expect(magazaSayaclari().r429).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('kaynak çitleri — magazaPanelZinciri.ts ve magazaErpRoutes.ts', () => {
  const PANEL = join(SRC_KOK, 'server', 'routes', 'magazaPanelZinciri.ts');
  const ERP = join(SRC_KOK, 'server', 'routes', 'magazaErpRoutes.ts');
  const panelSatirlari = kodSatirlari(PANEL).map(s => s.kod);
  const panelKodu = panelSatirlari.join('\n');
  const erpSatirlari = kodSatirlari(ERP).map(s => s.kod);
  const erpKodu = erpSatirlari.join('\n');

  it('panel alt zincirinin kayıt sırası SABİT (§ 4: 0, 1, 1b, 2–8, 7a, 7c, 9, 10)', () => {
    expect(panelSatirlari.map(s => s.trim()).filter(s => /^panel\.\w+\(/.test(s))).toEqual([
      'panel.use(onbelleksiz);',
      'panel.use(kokenKapisi);',
      'panel.use(yapilandirmaKapisi);',
      "panel.use('/oturum', C.panelOturumSinirlayici);",
      "panel.post('/oturum', jsonDegilse415, govdeAyristir, oturum);",
      'panel.use(C.panelSinirlayici);',
      'panel.use(belirtecKapisi);',
      "panel.get('/siparisler', liste);",
      "panel.post('/siparisler/:id/durum', jsonDegilse415, govdeAyristir, durumYaz);",
      "panel.post('/siparisler/:id/kalem-teslim', jsonDegilse415, govdeAyristir, kalemTeslim);",
      "panel.post('/siparisler/:id/etiket-basildi', jsonDegilse415, govdeAyristir, etiketBasildi);",
      "panel.post('/cikis', jsonDegilse415, govdeAyristir, cikis);",
      'panel.use(bulunamadi);',
      'panel.use(hataYakalayici);',
    ]);
    expect(panelKodu.match(/\bRouter\(/g)).toHaveLength(1);
    expect(panelKodu.match(/express\.(json|urlencoded|text|raw)\(/g)).toEqual(['express.json(']);
    expect(panelKodu).toContain('const govdeAyristir = express.json({ limit: MAGAZA_GOVDE_SINIRI_BAYT });');
    expect(panelKodu).toContain('const hataYakalayici = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {');
    expect(panelKodu).not.toMatch(/\b_?next\(\s*(err|e|hata)\b/);
    // Yönlendirme yol METNİYLE yapılmaz.
    expect(panelKodu).not.toMatch(/req\.(path|originalUrl|url|baseUrl)\b|startsWith\('\/|\.toLowerCase\(/);
  });
  it('`oturum` işleyicisinde `kodDeposu.al` İLK `await`\'ten ÖNCE (tek deneme; silme beklemeden sonraya kalınca aynı kod 3 belirteç üretti)', () => {
    const bas = panelSatirlari.findIndex(s => /const oturum = async \(req: Request, res: Response\): Promise<void> => \{/.test(s));
    const al = panelSatirlari.findIndex((s, i) => i > bas && /C\.kodDeposu\.al\(/.test(s));
    const ilkAwait = panelSatirlari.findIndex((s, i) => i > bas && /\bawait\b/.test(s));
    expect(bas).toBeGreaterThan(-1);
    expect(al).toBeGreaterThan(bas);
    expect(ilkAwait).toBeGreaterThan(al);
    expect(panelKodu.match(/C\.kodDeposu\.al\(/g)).toHaveLength(1);
    expect(erpKodu.match(/C\.kodDeposu\.ver\(/g)).toHaveLength(1);
    expect(erpKodu).not.toMatch(/kodDeposu\.al\(/);
  });
  it('iki modül de sınırlayıcı KURMAZ, sır / server.ts / pgShim / bekçi içe AKTARMAZ; yutan okuyucuları ve süper-yönetici baypasını ÇAĞIRMAZ', () => {
    for (const [ad, yol, kod] of [['panel', PANEL, panelKodu], ['erp', ERP, erpKodu]] as const) {
      expect(oku(yol), ad).not.toContain('express-rate-limit');
      expect(kod, ad).not.toMatch(/\brateLimit\s*\(/);
      expect(kod, ad).not.toMatch(/pgShim|opsWatchdog|server\.js|process\.env\.(SESSION_TOKEN_SECRET|FIREBASE_PRIVATE_KEY|APP_URL|MAGAZA_PANEL_DONUS)/);
      expect(kod, ad).not.toMatch(/getUserRole|getUserCompanyId|getCompanyStatus|userHasMfa|isSuperAdmin|requireCollectionAccess|requireSuperAdmin/);
      // Yazma kuralı `magazaDurum.ts`'te: bu modüllerde `adminDb` ve yazma SQL'i yok.
      expect(kod, ad).not.toMatch(/adminDb|UPDATE |INSERT |DELETE /);
      expect(kod, ad).not.toMatch(/\bas any\b|@ts-ignore|@ts-expect-error/);
      expect(kod, ad).not.toMatch(/(\?\?|\|\|)\s*0\b/);
      expect(kod, ad).not.toMatch(/toUpperCase|toLowerCase|toLocaleUpperCase|toLocaleLowerCase/);
      // Günlük: yalnız sabit metin + `hataKodu(…)`; hata nesnesinin iletisi / gövdesi okunmaz.
      for (const s of kod.split('\n').map(x => x.trim()).filter(x => /\bconsole\./.test(x))) {
        expect(s, ad).toMatch(/^console\.(error|warn)\((`\[magaza-(panel|erp)\] \$\{is\} işlenemedi:`|'\[magaza-(panel|erp)\] [^'$`]+:'), hataKodu\((e|err)\)\);$/);
      }
      expect(kod, ad).not.toMatch(/\.(message|stack|detail|where|cause)\b|JSON\.stringify\((e|err|hata|req)\b/);
      expect(kod, ad).not.toMatch(/\bvalidate\(|\.(issues|errors|flatten|format)\b/);
    }
    // Panelin tek ham SQL'i liste okumasıdır.
    expect(panelKodu.match(/\.query\(/g)).toHaveLength(1);
    expect(erpKodu).not.toMatch(/\.query\(/);
    // Kopya aşama / teslim karşılaştırması yok: ortak işlevler.
    expect(panelKodu).not.toMatch(/durum === 'teslim'|=== 'iptal'/);
    // Panel köken kapısı: `Allow-Credentials` ve joker köken yazılmaz.
    expect(panelKodu).not.toMatch(/Allow-Credentials/i);
    expect(panelKodu).not.toMatch(/Access-Control-Allow-Origin',\s*'\*'/);
  });
  it('`KalemTeslimGovdesi` TEK tanım: iki rota dosyası içe aktarır, ikinci `z.object(` kopyası yok (rota modüllerinde zod şeması kurulmaz)', () => {
    const tanimlar = suclular(kaynakDosyalari(join(SRC_KOK, 'server')), /\bKalemTeslimGovdesi\s*=/);
    expect(tanimlar.map(t => t.site.replace(/:\d+$/, ''))).toEqual(['src/server/schemas.ts']);
    for (const kod of [panelKodu, erpKodu]) {
      expect(kod).toMatch(/import \{[^}]*\bKalemTeslimGovdesi\b[^}]*\} from '\.\.\/schemas\.js';/);
      expect(kod).toContain('KalemTeslimGovdesi.safeParse(req.body)');
      expect(kod).not.toMatch(/\bz\.\w+\(|from 'zod'/);
    }
  });
  it('ERP uçları: üç talep ucu AYNI zincirde (`requireAuth` + `requireMfaVerified` + `C.dbLimiter`), yetki kodu kendi sınırlayıcısıyla; başka `app.` kaydı yok', () => {
    expect(erpSatirlari.map(s => s.trim()).filter(s => /^app\.\w+\(/.test(s))).toEqual([
      "app.post('/api/magaza-panel/yetki-kodu', onbelleksiz, C.requireAuth, C.requireMfaVerified, C.magazaYetkiKoduLimiter, iptalKapisi, yetkiKodu);",
      "app.post('/api/magaza-talepleri/:id/durum', C.requireAuth, C.requireMfaVerified, C.dbLimiter, durum);",
      "app.post('/api/magaza-talepleri/:id/kalem-teslim', C.requireAuth, C.requireMfaVerified, C.dbLimiter, kalemTeslim);",
      "app.post('/api/magaza-talepleri/:id/bildirim-gonder', C.requireAuth, C.requireMfaVerified, C.dbLimiter, bildirimGonder);",
    ]);
    // İptal denetimi YALNIZ yetki kodu zincirinde, sınırlayıcıdan SONRA (tanım + zincir satırı); Firebase çağrısı TEK yerde ve
    // süre tavanının içinde. Panel zinciri Firebase belirteci görmez.
    expect(erpKodu.match(/\biptalKapisi\b/g)).toHaveLength(2);
    expect(erpKodu.match(/belirtecIptalDenetle\(/g)).toHaveLength(1);
    expect(erpKodu).toContain('await sureli(C.belirtecIptalDenetle(belirtec), iptalDenetimiSuresi);');
    expect(panelKodu).not.toMatch(/belirtecIptalDenetle|iptalKapisi/);
    // Yazma işlevine giden kanal ve kiracı: sabit `'erp'`, `panelKullanicisi(uid).cid` (gövdeden değil).
    expect(erpKodu.match(/kanal: 'erp'/g)).toHaveLength(2);
    expect(erpKodu.match(/companyId: y\.kullanici\.cid/g)).toHaveLength(3);
    expect(erpKodu).not.toMatch(/req\.body\??\.companyId|cozum\.data\.companyId/);
    expect(panelKodu.match(/kanal: 'panel'/g)).toHaveLength(2);
    expect(panelKodu.match(/companyId: h\.b\.kullanici\.cid/g)).toHaveLength(3);
    // `bildirimIste` rota modülünde ÇAĞRILMAZ: tek çağrı yazma işlevindedir (`bildirimiYenidenKuyrugaAl`, yanıttan önce beklenir).
    expect(erpKodu).not.toMatch(/bildirimIste\(/);
    expect(panelKodu).not.toMatch(/bildirimIste\(/);
    expect(kodSatirlari(join(SRC_KOK, 'server', 'kanal', 'magazaDurum.ts')).filter(s => /D\.bildirimIste\(/.test(s.kod))).toHaveLength(1);
  });
  it('`src/` altında test dışı dosyada `pglite` içe aktarımı YOK (çalışma anında yüklenmez — V10)', () => {
    const uretim = kaynakDosyalari(SRC_KOK).filter(y => !/\.test\.tsx?$/.test(y));
    expect(suclular(uretim, /pglite/i)).toEqual([]);
  });
  it('rol kümesi kopyalanmaz: iki modül de `magazaTalepIslemYetkisi`\'ni çağırır, rol adı yazmaz', () => {
    const roller = (APP_ROLES as readonly AppRole[]).map(r => `'${r}'`);
    for (const kod of [panelKodu, erpKodu]) {
      expect(kod).toContain('magazaTalepIslemYetkisi(');
      for (const rol of roller) expect(kod, rol).not.toContain(rol);
    }
  });
});
