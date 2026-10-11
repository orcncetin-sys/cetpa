// @vitest-environment node
/**
 * magazaPanelUclar.test.ts — site paneli alt zinciri (`magazaPanelZinciri.ts`) + ERP kökenindeki mağaza uçları
 * (`magazaErpRoutes.ts`) GERÇEK express, GERÇEK zincir ve GERÇEK PostgreSQL motoruyla (dilim 2a, şartname v6 § 7 «Oturum»,
 * «Belirteç ve kapı», «Uçlar», «Liste», «ERP durum ucu»; dilim 2b § 10.8 «Uçlar»: elle talep, içerik, silme / geri alma,
 * `bildirim-gonder?tur=revize`, panel silme ucu, kartta `teyit` / `elle` / `silebilir`, takipte `silindi`) + iki modülün kaynak çitleri.
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
import { MAGAZA_TALEP_KOLEKSIYONU, MAGAZA_TALEP_NO_DESENI } from '../../lib/magazaTalep';
import { APP_ROLES, magazaTalepIslemYetkisi, magazaTalepSilmeYetkisi, type AppRole } from '../../lib/rbac';
import type { AdminDbLike, AdminDocRef } from '../adminDbTypes';
import { DOCS_INDEKS_DDL, DOCS_TABLOSU_DDL } from '../docsSema';
import { JWT_BICIMI, yetkiBelirteci } from '../istemciIp';
import { MAGAZA_BILDIRIM_KALEM_SINIRI } from '../kanal/magazaBildirim';
import { KALEM_TESLIM_SQL, MAGAZA_ACIK_SQL, MAGAZA_SILINMEMIS_SQL } from '../kanal/magazaDurum';
import { ELLE_TALEP_DENEME_SINIRI, ICERIK_SQL, URUN_KDV_SQL } from '../kanal/magazaIcerik';
import {
  MAGAZA_PANEL_BELIRTEC_OMRU_MS, donusTabaniCoz, panelAnahtariTuret, panelBelirteciUret, type PanelBelirtecYuku,
} from '../kanal/magazaPanelBelirtec';
import { iptalKur } from '../kanal/magazaPanelIptal';
import { kodDeposuKur, meydanHesapla, panelKoduUret } from '../kanal/magazaPanelKod';
import { panelKullanicisiKur } from '../kanal/magazaPanelKullanici';
import { magazaTalepKimligi } from '../kanal/magazaTalep';
import { EKLEME_SQL } from '../kanal/magazaTalepSql';
import type { SmtpKipi } from '../smtpPosta';
import { magazaErpRoutes, magazaIcerik429, magazaYetkiKodu429 } from './magazaErpRoutes';
import {
  MAGAZA_PANEL_ACIK_SINIRI, MAGAZA_PANEL_KAPALI_PENCERE_MS, MAGAZA_PANEL_KAPALI_SINIRI, MAGAZA_PANEL_LISTE_ONBELLEK_MS,
  MAGAZA_PANEL_LISTE_SQL, erpCikisindaPanelIptalEt, magazaPanel429, magazaPanelSayaclari, magazaPanelSayaclariniSifirla,
  magazaPanelZinciri, panelListesiKur, panelSiparisiEsle, type PanelListe, type PanelSiparis,
} from './magazaPanelZinciri';
import { MAGAZA_TAKIP_SQL, magaza429, magazaSayaclari, magazaSayaclariniSifirla, magazaTakipSayaclari, magazaZinciri, type MagazaPgHavuzu } from './magazaRoutes';

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
  /** (2b) Elle talep / içerik / silme uçlarının ORTAK kovası (`magazaIcerikLimiter`). */
  icerikTavani?: number;
  talepTavani?: number;
  smtp?: { tamam: boolean; eksik: string[]; kip: SmtpKipi };
  bildirimIste?: (id: string) => Promise<void>;
  /** (2b) Revize kuyruğunun isteyicisi (server.ts `magazaRevizeBildirimIste` vekili). */
  revizeBildirimiIste?: (id: string) => Promise<void>;
  /** (2b) Elle talep numarası üreteci (çakışma senaryosu için; verilmezse gerçek üreteç). */
  elleNoUret?: (simdi: Date) => string;
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
  /** (2b) Revize kuyruğuna istenen işler (`{ talepId }` — sahte isteyicinin gördüğü kimlikler, çağrı sırasıyla). */
  revizeler: string[];
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
    sorgular: [], sorguHatasi: null, kanca: null, gecikme: null, yayinlar: [], denetim: [], bildirimler: [], revizeler: [],
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
  const revizeBildirimiIste = (id: string): Promise<void> => { d.revizeler.push(id); return a.revizeBildirimiIste ? a.revizeBildirimiIste(id) : Promise.resolve(); };
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
    magazaIcerikLimiter: sinirlayici(a.icerikTavani ?? 1000, magazaIcerik429),
    belirtecIptalDenetle: (belirtec) => {
      d.firebase.cagrilar.push(belirtec);
      return d.firebase.davranis ? d.firebase.davranis(belirtec) : Promise.resolve({ uid: belirtec.slice(4) });
    },
    ...(a.iptalDenetimiSuresiMs !== undefined ? { iptalDenetimiSuresiMs: a.iptalDenetimiSuresiMs } : {}),
    panelKullanicisi: d.kullaniciOkuyucu.panelKullanicisi, kodDeposu: d.kodDeposu,
    getPgPool, broadcastDocChange, writeAuditLog, bildirimIste, revizeBildirimiIste,
    smtpYapilandirmasi: () => a.smtp ?? { tamam: true, eksik: [], kip: 'kimlikli' }, serverTenantId,
    panelDonus: a.panelDonus === undefined ? DONUS : a.panelDonus, simdi,
    ...(a.elleNoUret !== undefined ? { elleNoUret: a.elleNoUret } : {}),
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
    // (2b) `sil` de: paneli göremeyen role düşen kullanıcı silme ucunda 403 `rol` DEĞİL, kapının 401'ini alır (kapı önce).
    for (const [uc, g] of [['durum', { onceki: 'sevk', surum: 3, durum: 'teslim' }], ['kalem-teslim', { surum: 3, teslim: true, kalemler: 'hepsi' }], ['etiket-basildi', {}], ['sil', { surum: 3 }]] as Array<[string, unknown]>) {
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
        // Dilim 2b: mağazadan gelen talep (`elle` yok) ve Satış rolü (silemez); `teyit` alanı yalnız teyit yazılmış talepte.
        elle: false, silebilir: false,
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
    // (2b) Silinmiş açık ve silinmiş kapalı satır iki kümeye de GİRMEZ, `toplam`a sayılmaz.
    await topluEkle(4, i => ({ durum: i % 2 === 0 ? 'sevk' : 'teslim', durumZamani: zaman(SAAT_0 - 1000), talepNo: `S-${i}`, silindi: { zaman: zaman(SAAT_0), kim: { uid: 'u', ad: 'a' }, kanal: 'erp' } }));
    const r = await db.query<Satir>(MAGAZA_PANEL_LISTE_SQL, [COLL, CID, zaman(SAAT_0 - MAGAZA_PANEL_KAPALI_PENCERE_MS)]);
    expect(r.rows.map(s => s.tur).sort()).toEqual(['a', 'a', 'a', 'k', 'k']);
    expect(r.rows.filter(s => s.tur === 'a').every(s => Number(s.toplam) === 3)).toBe(true);
    expect(r.rows.filter(s => s.tur === 'k').every(s => s.toplam === null)).toBe(true);
    // Kaynak: tek ifade (iki CTE + UNION ALL), noktalı virgül yok; açık ölçütü bekçiyle AYNI sabit; metin karşılaştırması `COLLATE "C"`.
    expect(MAGAZA_PANEL_LISTE_SQL).not.toContain(';');
    expect(MAGAZA_PANEL_LISTE_SQL.match(/COALESCE\(data->>'durum', ''\) NOT IN \('teslim', 'iptal'\)/g)).toHaveLength(2);
    // Dilim 2b (bilerek değişen çit): açık ölçütü silinmemiş koşulunu İÇERİR; onun değillemesi silinmişi de yakalayacağı için
    // kapalı kümeye silinmemiş koşulu AYRICA eklenir — silinmiş talep iki kümede de yok.
    const SILINMEMIS = `jsonb_typeof(data->'silindi') IS DISTINCT FROM 'object'`;
    const ACIK = `COALESCE(data->>'durum', '') NOT IN ('teslim', 'iptal') AND ${SILINMEMIS}`;
    expect(MAGAZA_SILINMEMIS_SQL).toBe(SILINMEMIS);
    expect(MAGAZA_ACIK_SQL).toBe(ACIK);
    expect(MAGAZA_PANEL_LISTE_SQL).toContain(`WHERE coll = $1 AND data->>'companyId' = $2 AND ${ACIK} ORDER BY (data->>'olusturma')`);
    expect(MAGAZA_PANEL_LISTE_SQL).toContain(`WHERE coll = $1 AND data->>'companyId' = $2 AND NOT (${ACIK}) AND ${SILINMEMIS} AND (COALESCE(data->>'durumZamani', data->>'olusturma')) COLLATE "C" >= $3`);
    expect(MAGAZA_PANEL_LISTE_SQL.match(/IS DISTINCT FROM 'object'/g)).toHaveLength(3);
    expect(MAGAZA_PANEL_LISTE_SQL).not.toMatch(/data->'silindi' IS (NOT )?NULL/);
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
  it('elle bildirim: gövde `{}` dışı 400; `?tur` YALNIZ `revize` değerini alır (2b — `ilk` dâhil başka değer 400); bozuk kimlik / başka kiracı 404; bozuk JSON genel ayrıştırıcıdan (rota gövdesiz kalmıyor)', async () => {
    const d = await kur();
    const id = await talepEkle(bildirimsiz);
    for (const g of [{ tur: 'ilk' }, { id }, [], { '': 0 }]) expect((await erp(d, YOL(id, 'bildirim-gonder'), 'u-satis', g)).kod, JSON.stringify(g)).toBe(400);
    // Dilim 2b (bilerek değişen çit): 2a'da her `?tur` 400'dü; artık `?tur=revize` revize bildirimi demektir (bu talebin
    // revizyonu yok → 409 `revize-yok`, ilk bildirimin kuyruğuna DÜŞÜLMEZ). `ilk` ve boş değer 400 kalır.
    for (const sorgu of ['?tur=ilk', '?tur=']) expect((await erp(d, `${YOL(id, 'bildirim-gonder')}${sorgu}`, 'u-satis', {})).kod, sorgu).toBe(400);
    const revize = await erp(d, `${YOL(id, 'bildirim-gonder')}?tur=revize`, 'u-satis', {});
    expect([revize.kod, revize.json]).toEqual([409, { ok: false, kod: 'revize-yok' }]);
    expect(d.bildirimler).toEqual([]);
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
    // ERP'de etiket ucu YOK (yalnız panelde; 2b de eklemez): zincirin rota-yok 404'ü.
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
      // Dilim 2b: `silindi` alanının TÜRÜ (hiç silinmemiş talepte SQL NULL).
      silindi_turu: null,
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
  it('(2b, § 10.6) `silindi_turu` üç hâli AYIRIR: hiç silinmemiş → NULL, geri alınmış (`silindi: null`) → `"null"`, silinmiş → `"object"`; silen / zaman / kanal belleğe GELMEZ', async () => {
    const hic = await talepEkle();
    const geri = await talepEkle({ silindi: null });
    const silinmis = await talepEkle(silinmisEk());
    expect((await sor(hic))?.silindi_turu).toBeNull();
    expect((await sor(geri))?.silindi_turu).toBe('null');
    expect((await sor(silinmis))?.silindi_turu).toBe('object');
    expect(JSON.stringify(await sor(silinmis))).not.toMatch(/Silen Kişi|u-x|"kanal"|"erp"/);
    // Nesne olmayan çöp değer «silinmiş» sayılmaz (ölçüt yalnız `'object'`).
    for (const [cop, tur] of [['evet', 'string'], [true, 'boolean'], [[1], 'array'], [7, 'number']] as Array<[unknown, string]>) {
      expect((await sor(await talepEkle({ silindi: cop })))?.silindi_turu, tur).toBe(tur);
    }
  });
  it('(2b, § 10.6) uçtan uca: ERP\'de silinen talep takip ucunda `404 { ok: false, kod: "silindi" }` + `no-store` (aşama / kalem / tarih YOK; bulunamadı gövdesinden FARKLI); geri alınınca AYNI sorgu 200 ve kalem listesi döner', async () => {
    const d = await kur();
    const no = 'T261009-ZK78';
    const sorgu: Istek = { koken: IZINLI, govde: { no, telefon: '0532 123 45 67' } };
    expect((await iste(d, '/api/magaza/siparis-talebi', {
      koken: IZINLI, govde: { no, musteri: { ad: 'Şükrü Ağaoğlu', telefon: '+90 (532) 123 45 67' }, kalemler: [{ ad: 'İç cephe boyası', marka: 'DYO', adet: 2 }] },
    })).kod).toBe(201);
    const id = magazaTalepKimligi(CID, no, '5321234567');
    expect((await iste(d, '/api/magaza/siparis-durumu', sorgu)).kod).toBe(200);
    expect((await erp(d, ERP_YOLU(id, 'sil'), 'u-yonetici', { surum: 0 })).kod).toBe(200);
    const silinmis = await iste(d, '/api/magaza/siparis-durumu', sorgu);
    expect(silinmis.kod).toBe(404);
    expect(silinmis.metin).toBe('{"ok":false,"kod":"silindi"}');
    expect(silinmis.baslik('cache-control')).toBe('no-store');
    for (const yasak of ['durum', 'kalemler', 'tarih', 'guncelleme', 'boyası', 'Yönetici']) expect(silinmis.metin, yasak).not.toContain(yasak);
    // Hiç olmayan talep «bulunamadı»dır; iki 404'ün gövdesi FARKLI (başlıkları aynı).
    const yok = await iste(d, '/api/magaza/siparis-durumu', { koken: IZINLI, govde: { no: 'T261009-YOK1', telefon: '0532 123 45 67' } });
    expect(yok.metin).toBe('{"ok":false,"kod":"bulunamadi"}');
    expect(Buffer.from(silinmis.metin).equals(Buffer.from(yok.metin))).toBe(false);
    for (const ad of ['content-type', 'cache-control', 'access-control-allow-origin']) expect(silinmis.baslik(ad), ad).toBe(yok.baslik(ad));
    // Yanlış telefonla silinmiş talep de «bulunamadı»dır (kimlik no + telefondan; silindiği yalnız ikisini bilene açıklanır).
    expect((await iste(d, '/api/magaza/siparis-durumu', { koken: IZINLI, govde: { no, telefon: '0532 123 45 68' } })).metin).toBe('{"ok":false,"kod":"bulunamadi"}');
    expect(magazaTakipSayaclari()).toEqual({ bulundu: 1, bulunamadi: 2, silindi: 1 });
    // Geri alınan talep yeniden bulunur.
    expect((await erp(d, ERP_YOLU(id, 'sil'), 'u-yonetici', { surum: 1, geriAl: true })).kod).toBe(200);
    const geri = await iste(d, '/api/magaza/siparis-durumu', sorgu);
    expect(geri.kod).toBe(200);
    expect(geri.json).toMatchObject({ ok: true, durum: 'alindi', kaynak: 'beyan', kalemSayisi: 1, kalemler: [{ ad: 'İç cephe boyası', marka: 'DYO', adet: 2, teslim: false }] });
    expect(magazaTakipSayaclari()).toEqual({ bulundu: 2, bulunamadi: 2, silindi: 1 });
    expect(magazaSayaclari().r404).toBe(0);
  });
  it('(2b) uçtan uca: teyit yazılınca takip ucu TEYİT edilen kalemleri basar (`kaynak: "teyit"`), teslim işareti `t:` girişinden; fiyat / KDV / anahtar yanıta GİRMEZ', async () => {
    const d = await kur();
    const id = await talepEkle({}, magazaTalepKimligi(CID, 'T261009-AB12', '5321112233'));
    expect((await erp(d, ERP_YOLU(id, 'icerik'), 'u-satis', { icerikSurum: 0, teyit: { kalemler: [
      { anahtar: 'b:0', sku: 'DYO-0001', ad: 'İç cephe boyası 15 L', marka: 'DYO', adet: 3, birimFiyat: 95, kdvOrani: 20 },
      { ad: 'Astar', adet: 1, birimFiyat: null },
    ] } })).json).toEqual({ ok: true, degisti: true });
    const astar = (await teyitOku(id)).kalemler[1].anahtar;
    expect((await erp(d, ERP_YOLU(id, 'kalem-teslim'), 'u-satis', { surum: 3, teslim: true, kalemler: [astar] })).kod).toBe(200);
    const y = await iste(d, '/api/magaza/siparis-durumu', { koken: IZINLI, govde: { no: 'T261009-AB12', telefon: '0532 111 22 33' } });
    expect(y.kod).toBe(200);
    expect(y.json).toMatchObject({
      ok: true, durum: 'sevk', kaynak: 'teyit', kalemSayisi: 2,
      kalemler: [{ ad: 'İç cephe boyası 15 L', marka: 'DYO', adet: 3, teslim: false }, { ad: 'Astar', adet: 1, teslim: true }],
    });
    for (const yasak of ['birimFiyat', 'kdv', 'anahtar', 't:', 'DYO-0001', 'Rulo', 'Fayans']) expect(y.metin, yasak).not.toContain(yasak);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DİLİM 2b (şartname v6 § 10.3, § 10.5, § 10.6; § 10.8 «Uçlar»). Yazma işlevlerinin KENDİ senaryoları (CAS, taşıma, KDV
// çözümü, revize birleştirme) `kanal/magazaIcerik.pglite.test.ts`'tedir; burada UÇ ölçülür: zincir, rol, şema, durum
// kodu / gövde, kuyruk isteği, sayaç — gerçek express + gerçek zincir + gerçek motor.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
/** Saklı `talepVerisi().musteri` ile AYNI yedi alan: içerik gövdesinde gönderilince «değişmedi» sayılır. */
const MUSTERI_AYNI = { ad: 'Şükrü Ağaoğlu', firma: 'Iğdır Yapı', telefon: '0532 111 22 33', eposta: 'sukru@ornek.com.tr', il: 'İstanbul', adres: 'Çiçek Sk. 4', vergi: '1234567890' };
const NOT_AYNI = 'Öğleden sonra arayın.';
const TEYIT_ANAHTARI = /^t:[0-9a-f]{12}$/;
const ERP_YOLU = (id: string, uc: string): string => `/api/magaza-talepleri/${id}/${uc}`;
/** Para kuralı örneği (kullanıcı kararı): 2 × 95,00 + 1 × 40,00, %20 → ara toplam 230,00 · KDV 46,00 · toplam 276,00. */
const TEYIT_GOVDESI = { kalemler: [
  { anahtar: 'b:0', id: 'u-1', sku: 'DYO-0001', ad: 'İç cephe boyası 15 L', marka: 'DYO', adet: 2, birimFiyat: 95, kdvOrani: 20 },
  { ad: 'Rulo', adet: 1, birimFiyat: 40, kdvOrani: 20 },
] };
interface SakliTeyitKalemi { anahtar: string; id: string; sku: string; ad: string; marka: string; adet: number; birimFiyat: number | null; kdvOrani: number; kdvKaynagi: string; tedarik: boolean }
interface SakliTeyit { kalemler: SakliTeyitKalemi[]; araToplam: number | null; kdv: number | null; toplam: number | null; zaman: string; kim: { uid: string; ad: string } }
const teyitOku = async (id: string): Promise<SakliTeyit> => (await belge(id)).teyit as SakliTeyit;
/** Saklı teyit kalemini, formun göndereceği gövde kalemine çevirir (kendi `t:` anahtarıyla; `kdvKaynagi` gövdeye GİRMEZ). */
const govdeKalemi = (k: SakliTeyitKalemi, oranla = true): Satir => ({
  anahtar: k.anahtar, id: k.id, sku: k.sku, ad: k.ad, marka: k.marka, adet: k.adet, birimFiyat: k.birimFiyat, tedarik: k.tedarik,
  ...(oranla ? { kdvOrani: k.kdvOrani } : {}),
});
/** ERP ürün kaydı (`inventory`); `companyId: undefined` → etiketsiz eski kayıt. */
async function urunEkle(sku: string, ek: Satir = {}): Promise<void> {
  await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', ['inventory', `urun-${++kimlikSirasi}`, JSON.stringify({ companyId: CID, sku, ...ek })]);
}
const silinmisEk = (surum = 4): Satir => ({ silindi: { zaman: zaman(SAAT_0 - DAKIKA), kim: { uid: 'u-x', ad: 'Silen Kişi' }, kanal: 'erp' }, durumSurum: surum });
const revizeEk = (durum: string, ek: Satir = {}): Satir => ({
  icerikSurum: 2, icerikZamani: zaman(SAAT_0 - GUN),
  bildirimRevize: { durum, zaman: zaman(SAAT_0 - GUN), alanlar: ['not', 'teyit'], kim: { uid: 'u-mudur', ad: 'Müdür Bey' }, icerikSurum: 2, ...ek },
});

describe('ERP uçları (dilim 2b) — elle talep, içerik düzenleme, yumuşak silme / geri alma (§ 10.3; `magazaErpRoutes.ts`)', () => {
  const ELLE_GOVDESI = {
    musteri: { ad: 'Ümit Çağlar', telefon: '0533 444 55 66', firma: 'Çağlar İnşaat' },
    kalemler: [{ ad: 'Saten alçı 25 kg', marka: 'Knauf', sku: 'KNF-25', adet: 4, birimFiyat: 180 }, { ad: 'Mala', adet: 1 }],
    not: 'Telefonla geldi.',
  };
  const ELLE_SON10 = '5334445566';
  const elleSayisi = async (): Promise<number> =>
    Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM docs WHERE coll = $1 AND jsonb_typeof(data->'elle') = 'object'`, [COLL])).rows[0].n);

  it('zincir: üç 2b ucu genel ayrıştırıcıdan SONRA ve `requireAuth` → `requireMfaVerified` zincirinde (kimliksiz `{}` 401 · bozuk JSON 400 · MFA gövdesi AYNEN); `panelKullanicisi` fırlatınca 503', async () => {
    const d = await kur();
    const id = await talepEkle();
    const UCLAR: Array<[string, unknown]> = [['/api/magaza-talepleri', ELLE_GOVDESI], [ERP_YOLU(id, 'icerik'), { icerikSurum: 0, not: 'Yeni not' }], [ERP_YOLU(id, 'sil'), { surum: 3 }]];
    for (const [yol, govde] of UCLAR) {
      // Kimliksiz + GEÇERLİ gövde → kimlik kapısının 401'i (rota kayıtlı ve kapının arkasında — yayın sondasının ölçtüğü).
      const kimliksiz = await erp(d, yol, null, govde);
      expect(kimliksiz.kod, yol).toBe(401);
      expect(kimliksiz.json).toEqual({ error: 'Missing Authorization header.' });
      // Bozuk JSON → genel ayrıştırıcının 400'ü (kimlik kapısına varmaz: rota modülü ayrıştırıcıdan SONRA kayıtlı).
      expect((await iste(d, yol, { ham: '{bozuk', belirtec: 'erp-u-yonetici' })).kod, yol).toBe(400);
      d.mfaEngeli = true;
      const mfa = await erp(d, yol, 'u-yonetici', govde);
      expect(mfa.kod, yol).toBe(403);
      expect(mfa.json).toEqual({ error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true });
      d.mfaEngeli = false;
    }
    expect(d.kacan.genelYakalayici).toBe(3);
    // Kullanıcı okunamadı → 503 (403 DEĞİL: yetkisizlik değildir).
    d.sahte.durum.okumaHatasi = Object.assign(new Error(ISARET), { code: '57P01' });
    d.kullaniciOkuyucu.temizle();
    for (const [yol, govde] of UCLAR) {
      const hata = await erp(d, yol, 'u-yonetici', govde);
      expect(hata.kod, yol).toBe(503);
      expect(hata.json).toEqual({ ok: false });
    }
    d.sahte.durum.okumaHatasi = null;
    expect(await belge(id)).toEqual(talepVerisi());
    expect(await elleSayisi()).toBe(0);
    expect([d.yayinlar, d.denetim, d.bildirimler, d.revizeler]).toEqual([[], [], [], []]);
    expect(konsol).toEqual(Array.from({ length: 3 }, () => 'error: [magaza-erp] kullanıcı okunamadı: 57P01'));
  });
  it('yayın sonrası sonda değişmezi (§ 10.8 «Sondalar»): betikteki 2b yolları GERÇEK zincirde beklenen yanıtı verir — kimliksiz `{}` 401 (rota kayıtlı), bozuk JSON 400, `?tur=revize` 401 (400 DEĞİL), panel silme belirteçsiz 401; hiçbiri kayıt okumaz', async () => {
    const d = await kur();
    const betik = oku(join(SRC_KOK, '..', 'scripts', 'verify-deploy.sh'));
    for (const yol of ['/api/magaza-talepleri', `/api/magaza-talepleri/${SIFIR_KIMLIK}/icerik`, `/api/magaza-talepleri/${SIFIR_KIMLIK}/sil`]) {
      // Yol betiğin İKİ listesinde de var (bozuk JSON + geçerli JSON); listelerin tamamı `verifyDeployMagaza.test.ts`'te kilitli.
      expect(betik.split(yol).length - 1, yol).toBeGreaterThanOrEqual(2);
      expect((await erp(d, yol, null, {})).kod, yol).toBe(401);
      expect((await iste(d, yol, { ham: '{bozuk' })).kod, yol).toBe(400);
    }
    const revize = `/api/magaza-talepleri/${SIFIR_KIMLIK}/bildirim-gonder?tur=revize`;
    expect(betik).toContain(`REVIZE_PROBE="${revize}"`);
    expect((await erp(d, revize, null, {})).kod).toBe(401);
    expect(betik).toContain('"$PU/siparisler/$PANEL_SIFIR/sil"');
    expect(betik).toContain(`PANEL_SIFIR="${SIFIR_KIMLIK}"`);
    const panelSil = await panel(d, `/siparisler/${SIFIR_KIMLIK}/sil`, { govde: {} });
    expect([panelSil.kod, panelSil.metin]).toEqual([401, '{"ok":false}']);
    // Sondalar oturum açmaz, kayıt okumaz / yazmaz.
    expect(d.sorgular).toEqual([]);
    expect([d.yayinlar, d.denetim, d.bildirimler, d.revizeler]).toEqual([[], [], [], []]);
  });
  it('`magazaIcerikLimiter`: üç uç TEK kovada — 60 istekten sonra 61. istek 429 `{ ok: false, kod: "sinir" }`; kimlik / MFA reddi kovaya SAYILMAZ; 2a uçlarının `dbLimiter` kovası etkilenmez', async () => {
    const d = await kur({ icerikTavani: 60 });
    const id = await talepEkle();
    // Reddedilen (kimliksiz, MFA) istekler kovadan DÜŞMEZ: sınırlayıcı zincirde iki kapıdan SONRA.
    for (let i = 0; i < 5; i++) expect((await erp(d, ERP_YOLU(id, 'icerik'), null, {})).kod).toBe(401);
    d.mfaEngeli = true;
    for (let i = 0; i < 5; i++) expect((await erp(d, ERP_YOLU(id, 'sil'), 'u-yonetici', { surum: 3 })).kod).toBe(403);
    d.mfaEngeli = false;
    // 60 istek üç uca dağılmış (şema 400'leri: kovaya sayılır, hiçbir şey yazılmaz).
    const yollar = ['/api/magaza-talepleri', ERP_YOLU(id, 'icerik'), ERP_YOLU(id, 'sil')];
    const kodlar: number[] = [];
    for (let i = 0; i < 60; i++) kodlar.push((await erp(d, yollar[i % 3], 'u-yonetici', {})).kod);
    expect(kodlar).toEqual(Array.from({ length: 60 }, () => 400));
    for (const yol of yollar) {
      const dolu = await erp(d, yol, 'u-yonetici', {});
      expect(dolu.kod, yol).toBe(429);
      expect(dolu.json).toEqual({ ok: false, kod: 'sinir' });
      expect(dolu.baslik('cache-control')).toBe('no-store');
    }
    // 2a uçları AYRI kovada (`dbLimiter`): içerik kovası doluyken aşama yazımı ve revize bildirimi isteği geçer.
    expect((await erp(d, ERP_YOLU(id, 'durum'), 'u-yonetici', { onceki: 'sevk', surum: 3, durum: 'teslim' })).kod).toBe(200);
    expect((await erp(d, `${ERP_YOLU(id, 'bildirim-gonder')}?tur=revize`, 'u-yonetici', {})).kod).toBe(409);
    expect(magazaPanelSayaclari()).toMatchObject({ icerik429: 3, icerik400: 20 });
    expect(magazaSayaclari().r429).toBe(0);
  }, 30_000);
  it('`/sil` (silme VE geri alma): yalnız Yönetici 200; Müdür / Satış ve diğer BÜTÜN `APP_ROLES` 403 `{ ok: false, kod: "rol" }`; süper-yönetici baypası YOK; kayıtsız 403; kimliksiz 401', async () => {
    const d = await kur();
    expect(APP_ROLES.filter(r => magazaTalepSilmeYetkisi(r))).toEqual(['Admin']);
    for (const rol of APP_ROLES) {
      const uid = `u-rol-${rol}`;
      kullanici(d, uid, { role: rol, name: `Ad ${rol}` });
      const canli = await talepEkle();
      const olu = await talepEkle(silinmisEk());
      const sil = await erp(d, ERP_YOLU(canli, 'sil'), uid, { surum: 3 });
      const geriAl = await erp(d, ERP_YOLU(olu, 'sil'), uid, { surum: 4, geriAl: true });
      if (rol === 'Admin') {
        expect([sil.kod, sil.json], rol).toEqual([200, { ok: true }]);
        expect([geriAl.kod, geriAl.json], rol).toEqual([200, { ok: true }]);
        expect((await belge(canli)).silindi).toEqual({ zaman: zaman(SAAT_0), kim: { uid, ad: 'Ad Admin' }, kanal: 'erp' });
        expect((await belge(olu)).silindi).toBeNull();
      } else {
        for (const y of [sil, geriAl]) {
          expect(y.kod, rol).toBe(403);
          expect(y.json).toEqual({ ok: false, kod: 'rol' });
        }
        expect(await belge(canli)).toEqual(talepVerisi());
        expect(await belge(olu)).toEqual(talepVerisi(silinmisEk()));
      }
    }
    // Süper-yönetici: modül süper-yöneticiyi HİÇ tanımaz (rol `panelKullanicisi(uid)`'den) — rolü Yönetici olmayan süper-yönetici de 403.
    vi.stubEnv('SUPER_ADMIN_EMAILS', 'u-super@ornek.com.tr');
    try {
      kullanici(d, 'u-super', { role: 'Manager', name: 'Süper Yönetici' });
      const canli = await talepEkle();
      const olu = await talepEkle(silinmisEk());
      for (const y of [await erp(d, ERP_YOLU(canli, 'sil'), 'u-super', { surum: 3 }), await erp(d, ERP_YOLU(olu, 'sil'), 'u-super', { surum: 4, geriAl: true })]) {
        expect(y.kod).toBe(403);
        expect(y.json).toEqual({ ok: false, kod: 'rol' });
      }
      expect(await belge(canli)).toEqual(talepVerisi());
      // Kayıtsız kullanıcı (users belgesi yok) ve kimliksiz istek.
      const kayitsiz = await erp(d, ERP_YOLU(canli, 'sil'), 'u-kayitsiz', { surum: 3 });
      expect([kayitsiz.kod, kayitsiz.json]).toEqual([403, { ok: false, kod: 'rol' }]);
      expect((await erp(d, ERP_YOLU(canli, 'sil'), null, { surum: 3 })).kod).toBe(401);
    } finally { vi.unstubAllEnvs(); }
    // Silme ve geri alma bildirim ÜRETMEZ (V20).
    expect([d.bildirimler, d.revizeler]).toEqual([[], []]);
    expect(magazaPanelSayaclari()).toMatchObject({ silErp: 1, geriAl: 1, silErp409: 0, geriAl409: 0 });
  });
  it('`/icerik` ve `POST /api/magaza-talepleri`: yetkili üç rol 200 / 201; diğer BÜTÜN `APP_ROLES` 403 `rol`; kayıtsız 403; kimliksiz 401', async () => {
    const d = await kur();
    const yetkililer = APP_ROLES.filter(r => magazaTalepIslemYetkisi(r));
    expect([...yetkililer].sort()).toEqual(['Admin', 'Manager', 'Sales']);
    for (const rol of APP_ROLES) {
      const uid = `u-rol-${rol}`;
      kullanici(d, uid, { role: rol, name: rol });
      const id = await talepEkle();
      const icerik = await erp(d, ERP_YOLU(id, 'icerik'), uid, { icerikSurum: 0, not: `Not ${rol}` });
      const elle = await erp(d, '/api/magaza-talepleri', uid, ELLE_GOVDESI);
      if (yetkililer.includes(rol)) {
        expect([icerik.kod, icerik.json], rol).toEqual([200, { ok: true, degisti: true }]);
        expect(elle.kod, rol).toBe(201);
        expect((await belge(id)).not).toBe(`Not ${rol}`);
      } else {
        for (const y of [icerik, elle]) {
          expect(y.kod, rol).toBe(403);
          expect(y.json).toEqual({ ok: false, kod: 'rol' });
        }
        expect(await belge(id)).toEqual(talepVerisi());
      }
    }
    // Yalnız üç yetkili rolün açtığı üç elle talep var.
    expect(await elleSayisi()).toBe(3);
    const id = await talepEkle();
    for (const [yol, govde] of [[ERP_YOLU(id, 'icerik'), { icerikSurum: 0, not: 'x' }], ['/api/magaza-talepleri', ELLE_GOVDESI]] as Array<[string, unknown]>) {
      const kayitsiz = await erp(d, yol, 'u-kayitsiz', govde);
      expect([kayitsiz.kod, kayitsiz.json], yol).toEqual([403, { ok: false, kod: 'rol' }]);
      expect((await erp(d, yol, null, govde)).kod, yol).toBe(401);
    }
    expect(await elleSayisi()).toBe(3);
    expect(d.bildirimler).toHaveLength(3);
    expect(d.revizeler).toHaveLength(3);
  });

  // ── İçerik ────────────────────────────────────────────────────────────────────────────────────────────────────────
  it('içerik 200 `{ ok: true, degisti: true }`: PARA ÖRNEĞİ 2 × 95,00 + 1 × 40,00 (%20) → 230,00 / 46,00 / 276,00 (sunucuda); müşterinin ilk talebi (`kalemler`, `talepEdilen`) DEĞİŞMEZ; revize kuyruğuna tam 1 iş ve YANITTAN ÖNCE', async () => {
    let cozuldu = false;
    const d = await kur({ revizeBildirimiIste: async () => { await new Promise(coz => setTimeout(coz, 30)); cozuldu = true; } });
    const id = await talepEkle();
    const onceki = await belge(id);
    // Form her zaman TAM gövde gönderir (müşteri ve not saklıyla AYNI): «ne değişti» sunucuda ölçülür.
    const y = await erp(d, ERP_YOLU(id, 'icerik'), 'u-satis', { icerikSurum: 0, musteri: MUSTERI_AYNI, not: NOT_AYNI, teyit: TEYIT_GOVDESI });
    expect(y.kod).toBe(200);
    expect(y.json).toEqual({ ok: true, degisti: true });
    expect(cozuldu).toBe(true);
    expect(d.revizeler).toEqual([id]);
    expect(d.bildirimler).toEqual([]);
    const yazilan = await belge(id);
    // V16: beyan ve içerik dışı her alan alan alan AYNI. Eklenenler: dört içerik alanı + boş `kalemTeslim` (beyandan kopyalanan
    // `b:0` kaleminin taşınacak işareti yoktu: taşıma ifadesi boş nesne bırakır — işaret üretmez).
    expect(Object.keys(yazilan).sort()).toEqual([...Object.keys(onceki), 'teyit', 'icerikSurum', 'icerikZamani', 'bildirimRevize', 'kalemTeslim'].sort());
    for (const alan of Object.keys(onceki)) expect(yazilan[alan], alan).toEqual(onceki[alan]);
    expect(yazilan.kalemTeslim).toEqual({});
    expect(yazilan.kalemler).toEqual(talepVerisi().kalemler);
    expect(yazilan.talepEdilen).toEqual({ araToplam: 459.97, kdv: null, toplam: null });
    expect(yazilan.teyit).toEqual({
      kalemler: [
        { anahtar: expect.stringMatching(TEYIT_ANAHTARI), id: 'u-1', sku: 'DYO-0001', ad: 'İç cephe boyası 15 L', marka: 'DYO', adet: 2, birimFiyat: 95, kdvOrani: 20, kdvKaynagi: 'personel', tedarik: false },
        { anahtar: expect.stringMatching(TEYIT_ANAHTARI), id: '', sku: '', ad: 'Rulo', marka: '', adet: 1, birimFiyat: 40, kdvOrani: 20, kdvKaynagi: 'personel', tedarik: false },
      ],
      araToplam: 230, kdv: 46, toplam: 276, zaman: zaman(SAAT_0), kim: { uid: 'u-satis', ad: 'Ayşe Yılmaz' },
    });
    expect([yazilan.icerikSurum, yazilan.icerikZamani]).toEqual([1, zaman(SAAT_0)]);
    // `alanlar` = GERÇEKTEN değişen (gövdede müşteri ve not da vardı).
    expect(yazilan.bildirimRevize).toEqual({ durum: 'bekliyor', zaman: zaman(SAAT_0), alanlar: ['teyit'], kim: { uid: 'u-satis', ad: 'Ayşe Yılmaz' }, icerikSurum: 1 });
    expect(d.yayinlar).toEqual([[COLL, 'set', id, yazilan, { cid: CID }]]);
    // Denetim: alan ADLARI; müşteri verisi / tutar / KDV oranı / anahtar YOK.
    expect(d.denetim).toEqual([[{ uid: 'u-satis', email: 'u-satis@ornek.com.tr' }, 'Mağaza talebi içeriği', 'T261009-AB12 · erp · teyit']]);
    expect(JSON.stringify(d.denetim)).not.toMatch(/Şükrü|sukru@|0532|230|276|t:[0-9a-f]|b:0/);
    expect(y.metin).not.toMatch(/teyit|230|Şükrü/);
    expect(magazaPanelSayaclari()).toMatchObject({ icerik: 1, icerikDegisiklikYok: 0, revizeBildirimIstendi: 1, revizeBildirimIstenemedi: 0 });
  });
  it('içerik: aynı içerik ikinci kez → `200 { ok: true, degisti: false }` — yazım / revize işi / denetim / yayın YOK; sonra yalnız `not` değişince `alanlar` yalnız `not` (gövdede müşteri de olsa), `teyit.zaman` DEĞİŞMEZ', async () => {
    const d = await kur();
    const id = await talepEkle();
    expect((await erp(d, ERP_YOLU(id, 'icerik'), 'u-satis', { icerikSurum: 0, musteri: MUSTERI_AYNI, not: NOT_AYNI, teyit: TEYIT_GOVDESI })).json).toEqual({ ok: true, degisti: true });
    const ilk = await belge(id);
    const teyit = await teyitOku(id);
    d.saat.ms += 5000;
    // Formun ikinci «Kaydet»i: aynı kalemler artık kendi `t:` anahtarlarıyla, güncel sürümle.
    const ayni = { icerikSurum: 1, musteri: MUSTERI_AYNI, not: NOT_AYNI, teyit: { kalemler: teyit.kalemler.map(k => govdeKalemi(k)) } };
    const y = await erp(d, ERP_YOLU(id, 'icerik'), 'u-mudur', ayni);
    expect(y.kod).toBe(200);
    expect(y.json).toEqual({ ok: true, degisti: false });
    expect(await belge(id)).toEqual(ilk);
    expect([d.revizeler, d.denetim.length, d.yayinlar.length]).toEqual([[id], 1, 1]);
    // KDV oranı gövdede YOKKEN de değişiklik yok: personelin daha önce seçtiği oran korunur (başkasının kaydı tutarı değiştirmez).
    const oransiz = await erp(d, ERP_YOLU(id, 'icerik'), 'u-mudur', { ...ayni, teyit: { kalemler: teyit.kalemler.map(k => govdeKalemi(k, false)) } });
    expect(oransiz.json).toEqual({ ok: true, degisti: false });
    expect(await belge(id)).toEqual(ilk);
    // Yalnız not değişti.
    const notlu = await erp(d, ERP_YOLU(id, 'icerik'), 'u-mudur', { ...ayni, not: '  Sabah arayın.\r\n' });
    expect(notlu.json).toEqual({ ok: true, degisti: true });
    const sonra = await belge(id);
    expect(sonra.not).toBe('Sabah arayın.');
    expect(sonra.teyit).toEqual(ilk.teyit);   // `teyit.zaman` / `teyit.kim` notu düzenleyene GEÇMEZ
    expect(sonra.musteri).toEqual(ilk.musteri);
    expect([sonra.icerikSurum, sonra.icerikZamani]).toEqual([2, zaman(SAAT_0 + 5000)]);
    // İlk revize bildirimi hâlâ `bekliyor`: alan adları BİRLEŞİR, `zaman` / `kim` / `icerikSurum` sonuncusunun.
    expect(sonra.bildirimRevize).toEqual({ durum: 'bekliyor', zaman: zaman(SAAT_0 + 5000), alanlar: ['teyit', 'not'], kim: { uid: 'u-mudur', ad: 'Müdür Bey' }, icerikSurum: 2 });
    expect(d.denetim.map(k => k[2])).toEqual(['T261009-AB12 · erp · teyit', 'T261009-AB12 · erp · not']);
    expect(d.revizeler).toEqual([id, id]);
    expect(sonra.bildirim).toEqual(talepVerisi().bildirim);   // ilk bildirim alanı EZİLMEZ
    expect(magazaPanelSayaclari()).toMatchObject({ icerik: 2, icerikDegisiklikYok: 2, icerik409: 0, icerik400: 0 });
  });
  it('içerik: `kdvOrani` verilmeyen kalemde oran ERP ürün kaydından (`urun`), eşleşmeyen / küme dışı / çelişen kayıtta 20 + `varsayilan`; karışık oran 2 × 95 (%20) + 1 × 40 (%10) → 230 / 42 / 272; fiyatı `null` kalem varsa ÜÇ toplam da `null`', async () => {
    const d = await kur();
    await urunEkle('X20', { vatRate: 20 });
    await urunEkle('X10', { vatRate: 10 });
    await urunEkle('DEKOR-1325', { vatRate: 10, companyId: undefined });   // etiketsiz eski kayıt + `-Dnnn` paket SKU'sunun tabanı
    await urunEkle('ESKI-18', { vatRate: 18 });                            // küme dışı
    await urunEkle('CELISEN', { vatRate: 10 });
    await urunEkle('CELISEN', { vatRate: 20 });
    await urunEkle('YABANCI', { vatRate: 10, companyId: 'kiraci-2' });     // başka kiracının kartı EŞLEŞMEZ
    const id = await talepEkle();
    const y = await erp(d, ERP_YOLU(id, 'icerik'), 'u-satis', { icerikSurum: 0, teyit: { kalemler: [
      { sku: 'X20', ad: 'Yirmilik', adet: 2, birimFiyat: 95 },
      { sku: 'X10', ad: 'Onluk', adet: 1, birimFiyat: 40 },
    ] } });
    expect(y.json).toEqual({ ok: true, degisti: true });
    const karisik = await teyitOku(id);
    expect(karisik.kalemler.map(k => [k.sku, k.kdvOrani, k.kdvKaynagi])).toEqual([['X20', 20, 'urun'], ['X10', 10, 'urun']]);
    expect([karisik.araToplam, karisik.kdv, karisik.toplam]).toEqual([230, 42, 272]);
    // Akışa giden satır da kaynağı taşır (ekran «varsayılan» imini buradan basar).
    expect(JSON.stringify(d.yayinlar[0][3])).toContain('"kdvKaynagi":"urun"');

    const kaynaklar = await erp(d, ERP_YOLU(id, 'icerik'), 'u-satis', { icerikSurum: 1, teyit: { kalemler: [
      { sku: 'DEKOR-1325-D002', ad: 'Paket', adet: 1, birimFiyat: 10 },
      { sku: 'ESKI-18', ad: 'Eski oran', adet: 1, birimFiyat: 10 },
      { sku: 'CELISEN', ad: 'Çelişen', adet: 1, birimFiyat: 10 },
      { sku: 'YABANCI', ad: 'Yabancı', adet: 1, birimFiyat: 10 },
      { sku: 'YOK-1', ad: 'Eşleşmeyen', adet: 1, birimFiyat: 10 },
      { ad: 'SKU\'suz', adet: 1, birimFiyat: 10 },
      { sku: 'YOK-2', ad: 'Personel seçti', adet: 1, birimFiyat: 10, kdvOrani: 1 },
      { sku: 'X10', ad: 'Fiyatı sorulacak', adet: 3, birimFiyat: null },
    ] } });
    expect(kaynaklar.json).toEqual({ ok: true, degisti: true });
    const t = await teyitOku(id);
    expect(t.kalemler.map(k => [k.sku, k.kdvOrani, k.kdvKaynagi])).toEqual([
      ['DEKOR-1325-D002', 10, 'urun'], ['ESKI-18', 20, 'varsayilan'], ['CELISEN', 20, 'varsayilan'], ['YABANCI', 20, 'varsayilan'],
      ['YOK-1', 20, 'varsayilan'], ['', 20, 'varsayilan'], ['YOK-2', 1, 'personel'], ['X10', 10, 'urun'],
    ]);
    // Akıştaki satır iki kaynağı da taşır (ekran «varsayılan» imini buradan basar; istemci kaynağı KENDİ çıkarmaz).
    expect(d.yayinlar).toHaveLength(2);
    for (const kaynak of ['urun', 'varsayilan', 'personel']) expect(JSON.stringify(d.yayinlar[1][3]), kaynak).toContain(`"kdvKaynagi":"${kaynak}"`);
    // «Fiyat sorulacak»: kısmi toplam basılmaz, sıfır DEĞİL.
    expect(t.kalemler[7].birimFiyat).toBeNull();
    expect([t.araToplam, t.kdv, t.toplam]).toEqual([null, null, null]);
    // TEK dar ürün okuması / yazım (kalem başına sorgu yok).
    expect(d.sorgular.filter(s => s === URUN_KDV_SQL)).toHaveLength(2);
  });
  it('içerik 400 (şema): `kdvKaynagi`, `kdvOrani: 18` / 8, kısmi `musteri`, boş gövde, boş `kalemler`, `b:01`, yinelenen anahtar, beyan / toplam alanları, 4.001 karakter not, bozuk `icerikSurum`, `companyId` — ve yazma işlevinin `gecersiz`i (tanınmayan `t:`, aralık dışı `b:`, boş ad, 9 rakamlı telefon)', async () => {
    const d = await kur();
    const id = await talepEkle();
    const kalem = { ad: 'Rulo', adet: 1, birimFiyat: 40 };
    const alti = { ad: 'A', firma: '', telefon: '0532 111 22 33', eposta: '', il: '', adres: '' };
    const govdeler: unknown[] = [
      {}, { icerikSurum: 0 }, { not: 'x' }, { icerikSurum: -1, not: 'x' }, { icerikSurum: 0.5, not: 'x' }, { icerikSurum: '0', not: 'x' },
      { icerikSurum: 0, not: 'x', companyId: CID }, { icerikSurum: 0, not: 'x'.repeat(4001) }, { icerikSurum: 0, not: 7 },
      { icerikSurum: 0, musteri: alti }, { icerikSurum: 0, musteri: { ...MUSTERI_AYNI, telefonSon10: '5321112233' } }, { icerikSurum: 0, musteri: { ...MUSTERI_AYNI, vergi: null } },
      { icerikSurum: 0, teyit: { kalemler: [] } }, { icerikSurum: 0, teyit: {} }, { icerikSurum: 0, teyit: { kalemler: [kalem], araToplam: 40 } },
      { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, kdvKaynagi: 'personel' }] } },
      { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, kdvOrani: 18 }] } }, { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, kdvOrani: 8 }] } },
      { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, kdvOrani: '20' }] } },
      { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, anahtar: 'b:01' }] } }, { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, anahtar: 'c:0' }] } },
      { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, anahtar: 'b:0' }, { ...kalem, anahtar: 'b:0' }] } },
      { icerikSurum: 0, teyit: { kalemler: [{ ad: 'Rulo', adet: 1 }] } },                       // `birimFiyat` anahtarı ZORUNLU (sayı ya da açıkça null)
      { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, adet: 0 }] } }, { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, adet: 1.5 }] } },
      { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, birimFiyat: -1 }] } }, { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, talepFiyat: 40 }] } },
      { icerikSurum: 0, not: 'x', kalemler: [kalem] }, { icerikSurum: 0, not: 'x', talepEdilen: { araToplam: 1 } }, { icerikSurum: 0, not: 'x', silindi: null },
      // Şemadan geçer, yazma işlevi `gecersiz` der:
      { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, anahtar: 't:0123456789ab' }] } }, { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, anahtar: 'b:3' }] } },
      { icerikSurum: 0, teyit: { kalemler: [{ ...kalem, ad: ' \n ' }] } },
      { icerikSurum: 0, musteri: { ...MUSTERI_AYNI, ad: '   ' } }, { icerikSurum: 0, musteri: { ...MUSTERI_AYNI, telefon: '532 111 22 3' } },
    ];
    for (const g of govdeler) {
      const y = await erp(d, ERP_YOLU(id, 'icerik'), 'u-satis', g);
      expect(y.kod, JSON.stringify(g).slice(0, 90)).toBe(400);
      expect(y.json).toEqual({ ok: false });
    }
    expect(await belge(id)).toEqual(talepVerisi());
    expect([d.yayinlar, d.denetim, d.revizeler]).toEqual([[], [], []]);
    expect(d.sorgular.filter(s => /^UPDATE/.test(s))).toEqual([]);
    expect(magazaPanelSayaclari()).toMatchObject({ icerik400: govdeler.length, icerik: 0 });
  });
  it('içerik 409 `surum-eski` + güncel `icerikSurum` · 409 `silindi` · 404 (başka kiracı / bozuk kimlik / olmayan talep) — hiçbirinde revize işi / yazım / denetim YOK', async () => {
    const d = await kur();
    const id = await talepEkle({ icerikSurum: 4 });
    for (const bayat of [0, 3, 5]) {
      const y = await erp(d, ERP_YOLU(id, 'icerik'), 'u-satis', { icerikSurum: bayat, not: 'Yeni' });
      expect(y.kod, String(bayat)).toBe(409);
      expect(y.json).toEqual({ ok: false, kod: 'surum-eski', icerikSurum: 4 });
    }
    expect(await belge(id)).toEqual(talepVerisi({ icerikSurum: 4 }));
    const silinmis = await talepEkle(silinmisEk());
    const s = await erp(d, ERP_YOLU(silinmis, 'icerik'), 'u-satis', { icerikSurum: 0, not: 'Yeni' });
    expect([s.kod, s.json]).toEqual([409, { ok: false, kod: 'silindi' }]);
    expect(await belge(silinmis)).toEqual(talepVerisi(silinmisEk()));
    const baska = await talepEkle({ companyId: 'kiraci-2' });
    for (const [kimlik, uid] of [[baska, 'u-satis'], ['mt-bozuk', 'u-satis'], [SIFIR_KIMLIK, 'u-satis'], [id, 'u-baska']] as Array<[string, string]>) {
      const y = await erp(d, ERP_YOLU(kimlik, 'icerik'), uid, { icerikSurum: 0, not: 'Yeni' });
      expect(y.kod, `${kimlik} ${uid}`).toBe(404);
      expect(y.json).toEqual({ ok: false });
    }
    expect([d.yayinlar, d.denetim, d.revizeler, d.bildirimler]).toEqual([[], [], [], []]);
    expect(magazaPanelSayaclari()).toMatchObject({ icerik409: 4, icerik: 0, revizeBildirimIstendi: 0 });
  });
  it('içerik 503: ürün KDV oranı OKUNAMAZSA yazım YAPILMAZ (varsayılan 20 ile sessizce yazılmaz); belge değişmez, revize işi yok; başka veritabanı hatası 500', async () => {
    const d = await kur();
    const id = await talepEkle();
    const govde = { icerikSurum: 0, teyit: { kalemler: [{ sku: 'DYO-0001', ad: 'Boya', adet: 1, birimFiyat: 10 }] } };
    d.sorguHatasi = sql => (sql === URUN_KDV_SQL ? Object.assign(new Error(`ürün okunamadı ${ISARET}`), { code: '57P01', detail: ISARET }) : null);
    const y = await erp(d, ERP_YOLU(id, 'icerik'), 'u-satis', govde);
    expect(y.kod).toBe(503);
    expect(y.json).toEqual({ ok: false });
    expect(await belge(id)).toEqual(talepVerisi());
    expect([d.yayinlar, d.denetim, d.revizeler]).toEqual([[], [], []]);
    expect(d.sorgular).not.toContain(ICERIK_SQL);
    // Oran personelden geldiyse ürün okuması HİÇ yapılmaz: aynı arıza yazımı durdurmaz.
    const personel = await erp(d, ERP_YOLU(id, 'icerik'), 'u-satis', { icerikSurum: 0, teyit: { kalemler: [{ sku: 'DYO-0001', ad: 'Boya', adet: 1, birimFiyat: 10, kdvOrani: 10 }] } });
    expect(personel.json).toEqual({ ok: true, degisti: true });
    // Yazım ifadesinin hatası «ürün KDV okuması» DEĞİLDİR: 500.
    d.sorguHatasi = sql => (sql === ICERIK_SQL ? Object.assign(new Error('koptu'), { code: '08006' }) : null);
    const baska = await erp(d, ERP_YOLU(id, 'icerik'), 'u-satis', { icerikSurum: 1, not: 'Yeni' });
    expect(baska.kod).toBe(500);
    expect(baska.json).toEqual({ ok: false });
    d.sorguHatasi = null;
    expect(konsol).toEqual([
      'error: [magaza-erp] içerik yazılmadı, ürün KDV oranı okunamadı: 57P01',
      'error: [magaza-erp] içerik yazımı işlenemedi: 08006',
    ]);
    expect(magazaPanelSayaclari()).toMatchObject({ icerik503: 1, icerik: 1, r500: 0 });
  });
  it('içerik: revize isteyicisi sözleşmeye AYKIRI reddetse de yazım geri alınmaz, 200 döner (belge `bekliyor` taşır; kaçan süpürmesi sahiplenir) — sayaç + günlük', async () => {
    const d = await kur({ revizeBildirimiIste: () => Promise.reject(Object.assign(new Error(ISARET), { code: 'EKUYRUK' })) });
    const id = await talepEkle();
    const y = await erp(d, ERP_YOLU(id, 'icerik'), 'u-satis', { icerikSurum: 0, not: 'Yeni not' });
    expect([y.kod, y.json]).toEqual([200, { ok: true, degisti: true }]);
    expect((await belge(id)).bildirimRevize).toMatchObject({ durum: 'bekliyor', alanlar: ['not'], icerikSurum: 1 });
    expect(d.denetim).toHaveLength(1);
    expect(konsol).toEqual(['error: [magaza-icerik] içerik yazıldı, revize bildirimi istenemedi: EKUYRUK']);
    expect(magazaPanelSayaclari()).toMatchObject({ icerik: 1, revizeBildirimIstendi: 1, revizeBildirimIstenemedi: 1 });
  });

  // ── Elle talep ────────────────────────────────────────────────────────────────────────────────────────────────────
  it('elle talep 201 `{ ok, id, talepNo }`: numarayı SUNUCU üretir (İstanbul günü); belge `elle` + `durum: "yeni"` + `bildirim: bekliyor` + `istemciTarihi: null`; ilk kuyruğa tam 1 iş (`{ talepId }`) ve YANITTAN ÖNCE; takip ucunda aynı no + telefonla bulunur', async () => {
    let cozuldu = false;
    const d = await kur({ bildirimIste: async () => { await new Promise(coz => setTimeout(coz, 30)); cozuldu = true; } });
    const y = await erp(d, '/api/magaza-talepleri', 'u-mudur', ELLE_GOVDESI);
    expect(y.kod).toBe(201);
    const g = y.json as { ok: boolean; id: string; talepNo: string };
    expect(Object.keys(g)).toEqual(['ok', 'id', 'talepNo']);
    expect(g.ok).toBe(true);
    expect(g.talepNo).toMatch(MAGAZA_TALEP_NO_DESENI);
    // SAAT_0 = 2026-10-09 12:00 UTC = 15:00 İstanbul.
    expect(g.talepNo.slice(0, 8)).toBe('T261009-');
    // Kimlik türetimi dilim 1'le AYNI (kiracı + no + telefonun son 10 hanesi).
    expect(g.id).toBe(magazaTalepKimligi(CID, g.talepNo, ELLE_SON10));
    expect(cozuldu).toBe(true);
    expect(d.bildirimler).toEqual([g.id]);
    expect(d.revizeler).toEqual([]);
    const yazilan = await belge(g.id);
    expect(yazilan).toEqual({
      companyId: CID, talepNo: g.talepNo, durum: 'yeni', olusturma: zaman(SAAT_0), istemciTarihi: null,
      musteri: { ad: 'Ümit Çağlar', firma: 'Çağlar İnşaat', telefon: '0533 444 55 66', eposta: '', il: '', adres: '', vergi: '' },
      telefonSon10: ELLE_SON10, not: 'Telefonla geldi.',
      kalemler: [
        { id: '', sku: 'KNF-25', ad: 'Saten alçı 25 kg', marka: 'Knauf', adet: 4, talepFiyat: 180, tedarik: false },
        { id: '', sku: '', ad: 'Mala', marka: '', adet: 1, talepFiyat: null, tedarik: false },
      ],
      talepEdilen: { araToplam: null, kdv: null, toplam: null }, fiyatiSorulacakVar: true,
      bildirim: { durum: 'bekliyor', zaman: zaman(SAAT_0) },
      elle: { zaman: zaman(SAAT_0), kim: { uid: 'u-mudur', ad: 'Müdür Bey' } },
    });
    // Kaldırılan beşinci bildirim durumu hiçbir yazımda üretilmez.
    expect(JSON.stringify(yazilan)).not.toContain('gerekmiyor');
    expect(d.yayinlar).toEqual([[COLL, 'set', g.id, yazilan, { cid: CID }]]);
    expect(d.denetim).toEqual([[{ uid: 'u-mudur', email: 'u-mudur@ornek.com.tr' }, 'Mağaza talebi elle açıldı', `${g.talepNo} · erp`]]);
    expect(JSON.stringify(d.denetim)).not.toMatch(/Ümit|0533|Saten/);
    expect(magazaPanelSayaclari()).toMatchObject({ elleTalep: 1, elleTalepCakisti: 0 });
    // Müşteri takip ucunda aynı `no` + telefonla sorgular (V20).
    const takip = await iste(d, '/api/magaza/siparis-durumu', { koken: IZINLI, govde: { no: g.talepNo, telefon: '+90 533 444 55 66' } });
    expect(takip.kod).toBe(200);
    expect(takip.json).toMatchObject({ ok: true, durum: 'alindi', kaynak: 'beyan', kalemSayisi: 2, kalemler: [{ ad: 'Saten alçı 25 kg', marka: 'Knauf', adet: 4, teslim: false }, { ad: 'Mala', adet: 1, teslim: false }] });
    // Panel kartında `elle: true`.
    expect(siparisler(await panel(d, '/siparisler', { belirtec: belirtec(d) })).find(s => s.id === g.id)).toMatchObject({ elle: true, no: g.talepNo, durum: 'alindi' });
  });
  it('elle talep 400: telefonu 9 rakamlı gövde, `no` / `tarih` / tanınmayan alan (`.strict()`), boş kalem listesi, boş ad, `adet: 0` — kayıt, kuyruk işi, denetim YOK', async () => {
    const d = await kur();
    const govdeler: unknown[] = [
      { ...ELLE_GOVDESI, musteri: { ad: 'Ümit Çağlar', telefon: '533 444 55 6' } },                 // 9 rakam (takip ucu no + telefonla çalışır)
      { ...ELLE_GOVDESI, musteri: { ad: 'Ümit Çağlar', telefon: '' } }, { ...ELLE_GOVDESI, musteri: { ad: ' ', telefon: '0533 444 55 66' } },
      { ...ELLE_GOVDESI, no: 'T261009-ZZ99' }, { ...ELLE_GOVDESI, tarih: zaman(SAAT_0) }, { ...ELLE_GOVDESI, companyId: CID }, { ...ELLE_GOVDESI, elle: true },
      { ...ELLE_GOVDESI, durum: 'teslim' }, { ...ELLE_GOVDESI, kalemler: [] }, { ...ELLE_GOVDESI, kalemler: [{ ad: 'x', adet: 0 }] },
      { ...ELLE_GOVDESI, kalemler: [{ ad: ' ', adet: 1 }] }, { musteri: ELLE_GOVDESI.musteri }, {}, [],
    ];
    for (const g of govdeler) {
      const y = await erp(d, '/api/magaza-talepleri', 'u-satis', g);
      expect(y.kod, JSON.stringify(g).slice(0, 90)).toBe(400);
      expect(y.json).toEqual({ ok: false });
    }
    expect(Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM docs WHERE coll = $1', [COLL])).rows[0].n)).toBe(0);
    expect([d.yayinlar, d.denetim, d.bildirimler]).toEqual([[], [], []]);
  });
  it('elle talep: numara çakışırsa yeni numarayla dener — üç çakışmada 503 `{ ok: false }` ve kuyrukta iş YOK (mevcut kayda dokunulmaz); ikinci denemede tutarsa 201 ve tam 1 iş', async () => {
    const dolu = (no: string): Promise<string> => talepEkle({ talepNo: no, not: 'MEVCUT' }, magazaTalepKimligi(CID, no, ELLE_SON10));
    const hep = await kur({ elleNoUret: () => 'T261009-AAAA' });
    const mevcut = await dolu('T261009-AAAA');
    const y = await erp(hep, '/api/magaza-talepleri', 'u-satis', ELLE_GOVDESI);
    expect(y.kod).toBe(503);
    expect(y.json).toEqual({ ok: false });
    expect(ELLE_TALEP_DENEME_SINIRI).toBe(3);
    expect(hep.sorgular.filter(s => s === EKLEME_SQL)).toHaveLength(3);
    expect(await belge(mevcut)).toEqual(talepVerisi({ talepNo: 'T261009-AAAA', not: 'MEVCUT' }));
    expect([hep.bildirimler, hep.yayinlar, hep.denetim]).toEqual([[], [], []]);
    expect(magazaPanelSayaclari()).toMatchObject({ elleTalep: 0, elleTalepCakisti: 1 });

    const numaralar = ['T261009-AAAA', 'T261009-BBBB'];
    const ikinci = await kur({ elleNoUret: () => numaralar.shift() ?? 'T261009-CCCC' });
    const tutan = await erp(ikinci, '/api/magaza-talepleri', 'u-satis', ELLE_GOVDESI);
    expect(tutan.kod).toBe(201);
    expect(tutan.json).toEqual({ ok: true, id: magazaTalepKimligi(CID, 'T261009-BBBB', ELLE_SON10), talepNo: 'T261009-BBBB' });
    // Çakışan denemede kuyruk isteği / yayın YOK; tutan denemede tam 1.
    expect(ikinci.bildirimler).toEqual([magazaTalepKimligi(CID, 'T261009-BBBB', ELLE_SON10)]);
    expect(ikinci.yayinlar).toHaveLength(1);
    expect(await belge(mevcut)).toEqual(talepVerisi({ talepNo: 'T261009-AAAA', not: 'MEVCUT' }));
  });
  it('elle talep: mağaza talepleri yalnız SUNUCU kiracısına yazılır — başka kiracının kullanıcısı 403 `kiraci`; kiracı çözülemiyorsa 503; kuyruğa ekleme reddetse de 201 (kayıt geri alınmaz)', async () => {
    const d = await kur();
    const baska = await erp(d, '/api/magaza-talepleri', 'u-baska', ELLE_GOVDESI);
    expect([baska.kod, baska.json]).toEqual([403, { ok: false, kod: 'kiraci' }]);
    for (const kiraci of [() => Promise.resolve(''), () => Promise.reject(new Error(ISARET))]) {
      const kiracisiz = await kur({ kiraci });
      const y = await erp(kiracisiz, '/api/magaza-talepleri', 'u-satis', ELLE_GOVDESI);
      expect([y.kod, y.json]).toEqual([503, { ok: false }]);
      expect(kiracisiz.bildirimler).toEqual([]);
    }
    expect(await elleSayisi()).toBe(0);
    const reddeden = await kur({ bildirimIste: () => Promise.reject(Object.assign(new Error(ISARET), { code: 'EKUYRUK' })) });
    const y = await erp(reddeden, '/api/magaza-talepleri', 'u-satis', ELLE_GOVDESI);
    expect(y.kod).toBe(201);
    expect((await belge((y.json as { id: string }).id)).bildirim).toEqual({ durum: 'bekliyor', zaman: zaman(SAAT_0) });
    expect(reddeden.denetim).toHaveLength(1);
    expect(konsol).toEqual(['error: [magaza-icerik] elle talep yazıldı, bildirim istenemedi: EKUYRUK']);
  });

  // ── Silme / geri alma ─────────────────────────────────────────────────────────────────────────────────────────────
  it('sil → 200: kayıt DURUR, `silindi: { zaman, kim, kanal: "erp" }` + `durumSurum` +1 (başka alan değişmez); zaten silinmiş 409 `silindi`; bayat sürüm 409 `surum-eski` + güncel `surum`; geri al → `silindi: null` ve aşama yazımı yeniden geçer; silinmemişte 409 `silinmemis`', async () => {
    const d = await kur();
    const ek = { kalemTeslim: { 'b:1': { durum: 'teslim', zaman: zaman(SAAT_0 - DAKIKA), kim: { uid: 'u', ad: 'a' } } }, ...revizeEk('gonderilemedi') };
    const id = await talepEkle(ek);
    // Bayat ekran (teslim'e geçmiş talep bayat ekrandan silinmesin).
    const bayat = await erp(d, ERP_YOLU(id, 'sil'), 'u-yonetici', { surum: 2 });
    expect([bayat.kod, bayat.json]).toEqual([409, { ok: false, kod: 'surum-eski', surum: 3 }]);
    const y = await erp(d, ERP_YOLU(id, 'sil'), 'u-yonetici', { surum: 3 });
    expect([y.kod, y.json]).toEqual([200, { ok: true }]);
    const silinen = await belge(id);
    expect(silinen).toEqual(talepVerisi({ ...ek, silindi: { zaman: zaman(SAAT_0), kim: { uid: 'u-yonetici', ad: 'Yönetici Hanım' }, kanal: 'erp' }, durumSurum: 4 }));
    expect(d.yayinlar).toEqual([[COLL, 'set', id, silinen, { cid: CID }]]);
    expect(d.denetim).toEqual([[{ uid: 'u-yonetici', email: 'u-yonetici@ornek.com.tr' }, 'Mağaza talebi silindi', 'T261009-AB12 · erp']]);
    const yine = await erp(d, ERP_YOLU(id, 'sil'), 'u-yonetici', { surum: 4 });
    expect([yine.kod, yine.json]).toEqual([409, { ok: false, kod: 'silindi' }]);

    // Geri alma: silmenin artırdığı güncel sürümle.
    d.saat.ms += 5000;
    const eskiSurum = await erp(d, ERP_YOLU(id, 'sil'), 'u-yonetici', { surum: 3, geriAl: true });
    expect([eskiSurum.kod, eskiSurum.json]).toEqual([409, { ok: false, kod: 'surum-eski', surum: 4 }]);
    const geri = await erp(d, ERP_YOLU(id, 'sil'), 'u-yonetici', { surum: 4, geriAl: true });
    expect([geri.kod, geri.json]).toEqual([200, { ok: true }]);
    const canli = await belge(id);
    // Anahtar VAR, değer JSON null (`||` alan silemez); başka her alan aynen.
    expect(canli).toEqual(talepVerisi({ ...ek, silindi: null, durumSurum: 5 }));
    expect('silindi' in canli).toBe(true);
    expect(d.denetim[1]).toEqual([{ uid: 'u-yonetici', email: 'u-yonetici@ornek.com.tr' }, 'Mağaza talebi geri alındı', 'T261009-AB12 · erp']);
    const silinmemis = await erp(d, ERP_YOLU(id, 'sil'), 'u-yonetici', { surum: 5, geriAl: true });
    expect([silinmemis.kod, silinmemis.json]).toEqual([409, { ok: false, kod: 'silinmemis' }]);
    // Geri alınan talep yeniden CANLIDIR: aşama yazımı geçer.
    expect((await erp(d, ERP_YOLU(id, 'durum'), 'u-satis', { onceki: 'sevk', surum: 5, durum: 'teslim' })).kod).toBe(200);
    // Silme / geri alma bildirim ÜRETMEZ; bildirim alanlarına DOKUNMAZ (yukarıdaki tam eşitlik).
    expect([d.bildirimler, d.revizeler]).toEqual([[], []]);
    expect(magazaPanelSayaclari()).toMatchObject({ silErp: 1, silErp409: 2, geriAl: 1, geriAl409: 2 });
  });
  it('sil 400 (şema): `surum`suz, eksi / kesirli / dizge `surum`, `geriAl: "evet"`, tanınmayan alan; 404: başka kiracı / bozuk kimlik / olmayan talep (silme ve geri almada)', async () => {
    const d = await kur();
    const id = await talepEkle();
    for (const g of [{}, { geriAl: true }, { surum: -1 }, { surum: 1.5 }, { surum: '3' }, { surum: 3, geriAl: 'evet' }, { surum: 3, kanal: 'panel' }, { surum: 3, companyId: CID }, [3]]) {
      const y = await erp(d, ERP_YOLU(id, 'sil'), 'u-yonetici', g);
      expect(y.kod, JSON.stringify(g)).toBe(400);
      expect(y.json).toEqual({ ok: false });
    }
    const baska = await talepEkle({ companyId: 'kiraci-2' });
    for (const kimlik of [baska, 'mt-bozuk', SIFIR_KIMLIK]) {
      for (const g of [{ surum: 3 }, { surum: 3, geriAl: true }]) {
        const y = await erp(d, ERP_YOLU(kimlik, 'sil'), 'u-yonetici', g);
        expect(y.kod, `${kimlik} ${JSON.stringify(g)}`).toBe(404);
        expect(y.json).toEqual({ ok: false });
      }
    }
    // Başka kiracının Yöneticisi bu kiracının talebini SİLEMEZ (kiracı gövdeden değil, kullanıcıdan).
    expect((await erp(d, ERP_YOLU(id, 'sil'), 'u-baska', { surum: 3 })).kod).toBe(404);
    expect(await belge(id)).toEqual(talepVerisi());
    expect(await belge(baska)).toEqual(talepVerisi({ companyId: 'kiraci-2' }));
    expect([d.yayinlar, d.denetim]).toEqual([[], []]);
    // ERP'de ayrı geri alma / panel silme yolu YOK: geri alma `sil` ucunun `geriAl` bayrağıdır.
    expect((await erp(d, ERP_YOLU(id, 'geri-al'), 'u-yonetici', { surum: 3 })).json).toEqual({ error: 'Not found' });
  });
  it('silinmiş talep DONUKTUR (V17): ERP aşama / kalem teslim / elle bildirim (ilk + revize) / içerik ve panel aşama / kalem teslim / etiket → 409 `{ ok: false, kod: "silindi" }`; belge değişmez, kuyruk / yayın / denetim 0', async () => {
    const d = await kur();
    const ek = { ...silinmisEk(), ...revizeEk('gonderilemedi'), bildirim: { durum: 'gonderilemedi', zaman: zaman(SAAT_0 - GUN), deneme: 3, hataSinifi: 'baglanti' } };
    const id = await talepEkle(ek);
    const erpIstekleri: Array<[string, unknown]> = [
      [ERP_YOLU(id, 'durum'), { onceki: 'sevk', surum: 4, durum: 'teslim' }], [ERP_YOLU(id, 'durum'), { onceki: 'sevk', surum: 4, durum: 'sevk', aciklama: 'Not' }],
      [ERP_YOLU(id, 'kalem-teslim'), { surum: 4, teslim: true, kalemler: 'hepsi' }], [ERP_YOLU(id, 'bildirim-gonder'), {}],
      [`${ERP_YOLU(id, 'bildirim-gonder')}?tur=revize`, {}], [ERP_YOLU(id, 'icerik'), { icerikSurum: 2, not: 'Yeni' }],
    ];
    for (const [yol, govde] of erpIstekleri) {
      const y = await erp(d, yol, 'u-yonetici', govde);
      expect(y.kod, yol).toBe(409);
      expect(y.json).toEqual({ ok: false, kod: 'silindi' });
    }
    const b = belirtec(d);
    for (const [uc, govde] of [['durum', { onceki: 'sevk', surum: 4, durum: 'teslim' }], ['kalem-teslim', { surum: 4, teslim: true, kalemler: ['b:0'] }], ['etiket-basildi', { koli: 2 }]] as Array<[string, unknown]>) {
      const y = await panel(d, `/siparisler/${id}/${uc}`, { belirtec: b, govde });
      expect(y.kod, uc).toBe(409);
      expect(y.json).toEqual({ ok: false, kod: 'silindi' });
      expect(y.baslik('cache-control')).toBe('no-store');
    }
    expect(await belge(id)).toEqual(talepVerisi(ek));
    expect([d.yayinlar, d.denetim, d.bildirimler, d.revizeler]).toEqual([[], [], [], []]);
    expect(magazaPanelSayaclari()).toMatchObject({
      durumErp409: 2, kalemTeslimErp409: 1, bildirimGonder409: 1, bildirimGonderRevize409: 1, icerik409: 1,
      durumPanel409: 1, kalemTeslimPanel409: 1, etiketBasildi409: 1, etiketBasildi404: 0,
    });
  });

  // ── Kalem teslim: teyit yazılmış talepte (2a ucu, 2b dokunuşu) ────────────────────────────────────────────────────
  it('kalem teslim teyitli talepte (iki kanal): `b:` anahtarı 400, `t:` 200, `"hepsi"` teyit kalemlerini işaretler; beyandan kopyalanan kalemin işareti yeni `t:` anahtarına TAŞINIR; araya giren teyit yazımında 409 `surum-eski`', async () => {
    const d = await kur();
    const b = belirtec(d);
    const id = await talepEkle();
    // Beyan kalemi `b:1` teslim işaretli; teyit `b:1`'i kopyalar + yeni kalem ekler.
    expect((await erp(d, ERP_YOLU(id, 'kalem-teslim'), 'u-satis', { surum: 3, teslim: true, kalemler: ['b:1'] })).kod).toBe(200);
    expect((await erp(d, ERP_YOLU(id, 'icerik'), 'u-satis', { icerikSurum: 0, teyit: { kalemler: [
      { anahtar: 'b:1', sku: 'KRB-77', ad: 'Fayans yapıştırıcısı', marka: 'Karbosan', adet: 5, birimFiyat: 120, kdvOrani: 20 },
      { ad: 'Derz dolgu', adet: 2, birimFiyat: 60, kdvOrani: 20 },
    ] } })).json).toEqual({ ok: true, degisti: true });
    const [tasinan, yeni] = (await teyitOku(id)).kalemler.map(k => k.anahtar);
    const kart = siparisler(await panel(d, '/siparisler', { belirtec: b }))[0];
    expect(kart).toMatchObject({ teslimKaynagi: 'teyit', teslimIsaretsiz: 1, kalemSayisi: 3, surum: 4 });
    expect(kart.teyit?.kalemler.map(k => [k.anahtar, k.teslim])).toEqual([[tasinan, true], [yeni, false]]);
    // Beyan girişi DURUYOR (tarihçe): beyan tablosu işareti göstermeye devam eder.
    expect(kart.kalemler.map(k => [k.anahtar, k.teslim])).toEqual([['b:0', false], ['b:1', true], ['b:2', false]]);
    // Kaynak artık teyit: `b:` anahtarı iki kanalda da 400, belge değişmez.
    const once = await belge(id);
    expect((await erp(d, ERP_YOLU(id, 'kalem-teslim'), 'u-satis', { surum: 4, teslim: true, kalemler: ['b:0'] })).kod).toBe(400);
    expect((await panel(d, `/siparisler/${id}/kalem-teslim`, { belirtec: b, govde: { surum: 4, teslim: true, kalemler: ['b:0'] } })).kod).toBe(400);
    expect(await belge(id)).toEqual(once);
    // `t:` anahtarı: ERP 200, panel 200 + güncel liste.
    expect((await erp(d, ERP_YOLU(id, 'kalem-teslim'), 'u-satis', { surum: 4, teslim: true, kalemler: [yeni] })).json).toEqual({ ok: true });
    const kaldir = await panel(d, `/siparisler/${id}/kalem-teslim`, { belirtec: b, govde: { surum: 5, teslim: false, kalemler: 'hepsi' } });
    expect(kaldir.kod).toBe(200);
    expect(siparisler(kaldir)[0]).toMatchObject({ teslimKaynagi: 'teyit', teslimIsaretsiz: 2, surum: 6 });
    expect(siparisler(kaldir)[0].teyit?.kalemler.map(k => k.teslim)).toEqual([false, false]);
    expect(d.denetim.map(k => k[2]).slice(-2)).toEqual(['T261009-AB12 · erp · teyit · işaretlendi 1 / kaldırıldı 0', 'T261009-AB12 · panel · teyit · işaretlendi 0 / kaldırıldı 2']);

    // Yarış: kalem teslim isteğinin dar okuması ile yazımı arasına GERÇEK içerik yazımı girer (kalem silinir → anahtar kümesi bayat).
    for (const kanal of ['erp', 'panel'] as const) {
      const surum = Number((await belge(id)).durumSurum);
      const icerikSurum = Number((await belge(id)).icerikSurum);
      const kalemler = (await teyitOku(id)).kalemler;
      let yapildi = false;
      d.kanca = async (sql) => {
        if (yapildi || !sql.startsWith('SELECT') || !sql.includes('icerik_surum')) return;
        yapildi = true;
        const araya = await erp(d, ERP_YOLU(id, 'icerik'), 'u-mudur', { icerikSurum, teyit: { kalemler: [{ ...govdeKalemi(kalemler[0]), adet: kalemler[0].adet + 1 }, govdeKalemi(kalemler[1])] } });
        expect(araya.json).toEqual({ ok: true, degisti: true });
      };
      const istek = { surum, teslim: true, kalemler: [kalemler[1].anahtar] };
      const y = kanal === 'erp'
        ? await erp(d, ERP_YOLU(id, 'kalem-teslim'), 'u-satis', istek)
        : await panel(d, `/siparisler/${id}/kalem-teslim`, { belirtec: b, govde: istek });
      d.kanca = null;
      expect(yapildi, kanal).toBe(true);
      expect(y.kod, kanal).toBe(409);
      expect(y.json).toEqual({ ok: false, kod: 'surum-eski' });
      // İşaret yazılmadı, aşama sürümü artmadı.
      expect((await belge(id)).durumSurum).toBe(surum);
      expect(((await belge(id)).kalemTeslim as Satir)[kalemler[1].anahtar]).toMatchObject({ durum: 'bekliyor' });
    }
  });

  // ── Revize bildirimini elle yeniden gönder (`bildirim-gonder?tur=revize`; K19) ────────────────────────────────────
  it('`?tur=revize` 200: `bildirimRevize` → `bekliyor` + yeni `zaman`, `deneme` / `hataSinifi` YOK, `alanlar` / `kim` / `icerikSurum` AYNEN; REVİZE kuyruğuna tam 1 iş (ilk kuyruğa 0) ve YANITTAN ÖNCE; denetim `· erp · revize`; ilk `bildirim` alanı değişmez', async () => {
    let cozuldu = false;
    const d = await kur({ revizeBildirimiIste: async () => { await new Promise(coz => setTimeout(coz, 30)); cozuldu = true; } });
    const ek = revizeEk('gonderilemedi', { deneme: 3, hataSinifi: 'baglanti' });
    const id = await talepEkle(ek);
    const y = await erp(d, `${ERP_YOLU(id, 'bildirim-gonder')}?tur=revize`, 'u-satis', {});
    expect([y.kod, y.json]).toEqual([200, { ok: true }]);
    expect(cozuldu).toBe(true);
    expect([d.revizeler, d.bildirimler]).toEqual([[id], []]);
    const yazilan = await belge(id);
    expect(yazilan).toEqual(talepVerisi({ ...ek, bildirimRevize: { durum: 'bekliyor', zaman: zaman(SAAT_0), alanlar: ['not', 'teyit'], kim: { uid: 'u-mudur', ad: 'Müdür Bey' }, icerikSurum: 2 } }));
    expect(d.yayinlar).toEqual([[COLL, 'set', id, yazilan, { cid: CID }]]);
    expect(d.denetim).toEqual([[{ uid: 'u-satis', email: 'u-satis@ornek.com.tr' }, 'Mağaza talebi bildirimi elle kuyruğa alındı', 'T261009-AB12 · erp · revize']]);
    // `yapilandirilmamis` ve süresi geçmiş `bekliyor` da yeniden kuyruğa alınır.
    for (const durum of ['yapilandirilmamis', 'bekliyor']) {
      const baska = await talepEkle(revizeEk(durum));
      expect((await erp(d, `${ERP_YOLU(baska, 'bildirim-gonder')}?tur=revize`, 'u-mudur', {})).kod, durum).toBe(200);
      expect((await belge(baska)).bildirimRevize).toMatchObject({ durum: 'bekliyor', zaman: zaman(SAAT_0), alanlar: ['not', 'teyit'], icerikSurum: 2 });
    }
    // Sayaçlar AYRI: revize, ilk bildirim sayacına karışmaz.
    expect(magazaPanelSayaclari()).toMatchObject({ bildirimGonderRevize: 3, bildirimGonderRevize409: 0, bildirimGonder: 0, bildirimGonder409: 0, revizeBildirimIstendi: 3 });
  });
  it('`?tur=revize` retleri: kimliksiz 401 (sorgu dizesi kapıdan SONRA ayrıştırılır) · `?tur=x` / `?tur=ilk` / `?tur=` / tanınmayan parametre 400 · rol dışı 403 `rol` · bozuk kimlik / başka kiracı 404', async () => {
    const d = await kur();
    const id = await talepEkle(revizeEk('gonderilemedi'));
    const yol = `${ERP_YOLU(id, 'bildirim-gonder')}?tur=revize`;
    // Yayın sondasının ölçtüğü: 400 olsaydı `tur` ayrıştırması kapıdan önce koşuyor demekti.
    for (const sorgu of ['?tur=revize', '?tur=x', '?tur=ilk']) {
      const kimliksiz = await erp(d, `${ERP_YOLU(id, 'bildirim-gonder')}${sorgu}`, null, {});
      expect(kimliksiz.kod, sorgu).toBe(401);
    }
    for (const sorgu of ['?tur=x', '?tur=ilk', '?tur=', '?tur=Revize', '?tur=revize&tur=revize', '?tur=revize&kanal=erp', '?kanal=erp']) {
      const y = await erp(d, `${ERP_YOLU(id, 'bildirim-gonder')}${sorgu}`, 'u-satis', {});
      expect(y.kod, sorgu).toBe(400);
      expect(y.json).toEqual({ ok: false });
    }
    expect((await erp(d, yol, 'u-satis', { tur: 'revize' })).kod).toBe(400);   // tür gövdede DEĞİL, sorgu dizesinde
    const rolDisi = await erp(d, yol, 'u-depo', {});
    expect([rolDisi.kod, rolDisi.json]).toEqual([403, { ok: false, kod: 'rol' }]);
    // Rol dışı kullanıcıya bozuk `tur` de 403'tür (yetki, sorgu ayrıştırmasından ÖNCE).
    expect((await erp(d, `${ERP_YOLU(id, 'bildirim-gonder')}?tur=x`, 'u-depo', {})).kod).toBe(403);
    const baska = await talepEkle({ companyId: 'kiraci-2', ...revizeEk('gonderilemedi') });
    for (const kimlik of [baska, 'mt-bozuk', SIFIR_KIMLIK]) {
      const y = await erp(d, `${ERP_YOLU(kimlik, 'bildirim-gonder')}?tur=revize`, 'u-satis', {});
      expect([y.kod, y.json], kimlik).toEqual([404, { ok: false }]);
    }
    expect(await belge(id)).toEqual(talepVerisi(revizeEk('gonderilemedi')));
    expect([d.revizeler, d.bildirimler, d.denetim, d.yayinlar]).toEqual([[], [], [], []]);
  });
  it('`?tur=revize` 409: `kapali` · `yapilandirilmamis` + eksik ADLARI (sır / değer yok) · `revize-yok` (alan yok / çöp — yoktan revizyon YARATILMAZ) · `zaten-gitti` (çift posta yok) — hiçbirinde kuyruk işi / denetim / yazım yok', async () => {
    const ek = revizeEk('gonderilemedi');
    const id = await talepEkle(ek);
    const yol = (kimlik: string): string => `${ERP_YOLU(kimlik, 'bildirim-gonder')}?tur=revize`;
    const kapali = await kur({ smtp: { tamam: false, eksik: [], kip: 'kapali' } });
    const y1 = await erp(kapali, yol(id), 'u-satis', {});
    expect([y1.kod, y1.json]).toEqual([409, { ok: false, kod: 'kapali' }]);
    const eksik = await kur({ smtp: { tamam: false, eksik: ['APP_URL'], kip: 'yerel' } });
    const y2 = await erp(eksik, yol(id), 'u-satis', {});
    expect([y2.kod, y2.json]).toEqual([409, { ok: false, kod: 'yapilandirilmamis', kip: 'yerel', eksik: ['APP_URL'] }]);
    // Yalnız ortam değişkeni ADI: değer / adres / sır yok.
    expect(y2.metin).not.toMatch(/https?:|=|@/);
    for (const k of [kapali, eksik]) {
      expect(k.sorgular.filter(s => /UPDATE/.test(s))).toEqual([]);
      expect([k.revizeler, k.bildirimler, k.denetim, k.yayinlar]).toEqual([[], [], [], []]);
    }
    const d = await kur();
    // Revizyonu OLMAYAN talep (ilk bildirimi gönderilemedi olsa da): ilk bildirimin kuyruğuna DÜŞÜLMEZ.
    const ilkGonderilemedi = { bildirim: { durum: 'gonderilemedi', zaman: zaman(SAAT_0 - GUN) } };
    const revizesiz = await talepEkle(ilkGonderilemedi);
    const cop = await talepEkle({ bildirimRevize: 'çöp' });
    const bos = await talepEkle({ bildirimRevize: null });
    for (const kimlik of [revizesiz, cop, bos]) {
      const y = await erp(d, yol(kimlik), 'u-satis', {});
      expect([y.kod, y.json], kimlik).toEqual([409, { ok: false, kod: 'revize-yok' }]);
    }
    expect(await belge(revizesiz)).toEqual(talepVerisi(ilkGonderilemedi));
    expect((await belge(cop)).bildirimRevize).toBe('çöp');
    const gitti = await talepEkle(revizeEk('gitti'));
    const y4 = await erp(d, yol(gitti), 'u-satis', {});
    expect([y4.kod, y4.json]).toEqual([409, { ok: false, kod: 'zaten-gitti' }]);
    expect(await belge(gitti)).toEqual(talepVerisi(revizeEk('gitti')));
    expect(await belge(id)).toEqual(talepVerisi(ek));
    expect([d.revizeler, d.bildirimler, d.denetim, d.yayinlar]).toEqual([[], [], [], []]);
    // 2 (kapalı + eksik) + 3 (revize yok) + 1 (gitti); ilk bildirimin sayacı ARTMAZ.
    expect(magazaPanelSayaclari()).toMatchObject({ bildirimGonderRevize: 0, bildirimGonderRevize409: 6, bildirimGonder409: 0, revizeBildirimIstendi: 0 });
  });
  it('`?tur=revize` yalnız REVİZE alanına bakar: revize `gitti` iken `tur`suz istek ilk bildirimi yeniden kuyruğa alır (ilk kuyruk), ilk bildirim `gitti` iken `?tur=revize` revizeyi (revize kuyruğu)', async () => {
    const d = await kur();
    const ilkAcik = await talepEkle({ ...revizeEk('gitti'), bildirim: { durum: 'gonderilemedi', zaman: zaman(SAAT_0 - GUN) } });
    expect((await erp(d, ERP_YOLU(ilkAcik, 'bildirim-gonder'), 'u-satis', {})).kod).toBe(200);
    expect([d.bildirimler, d.revizeler]).toEqual([[ilkAcik], []]);
    expect((await belge(ilkAcik)).bildirimRevize).toEqual(revizeEk('gitti').bildirimRevize);
    const revizeAcik = await talepEkle(revizeEk('gonderilemedi'));   // ilk bildirim `gitti`
    expect((await erp(d, `${ERP_YOLU(revizeAcik, 'bildirim-gonder')}?tur=revize`, 'u-satis', {})).kod).toBe(200);
    expect([d.bildirimler, d.revizeler]).toEqual([[ilkAcik], [revizeAcik]]);
    expect((await belge(revizeAcik)).bildirim).toEqual(talepVerisi().bildirim);
    expect(d.denetim.map(k => k[2])).toEqual(['T261009-AB12 · erp', 'T261009-AB12 · erp · revize']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('site paneli (dilim 2b) — yumuşak silme ucu, salt okunur `teyit`, `silebilir`, silinmiş talep listede YOK (§ 10.3, § 10.5)', () => {
  /** Yönetici'nin panel belirteci (kapı rolü her istekte `panelKullanicisi`'nden YENİDEN okur; belirteçteki `rol` gösterimdir). */
  const yoneticiBelirteci = (d: Duzenek): string => belirtec(d, 'u-yonetici', { rol: 'Admin', ad: 'Yönetici Hanım' });

  it('panel sil: Yönetici 200 + GÜNCEL liste (silinen talep listede YOK, `acikToplam` düşer); belgeye `kanal: "panel"`, `kim.ad` okuyucudan; Müdür / Satış 403 `{ ok: false, kod: "rol" }`', async () => {
    const d = await kur();
    const hedef = await talepEkle({ talepNo: 'SİLİNECEK' });
    const kalan = await talepEkle({ talepNo: 'KALAN', olusturma: zaman(SAAT_0 - 4 * 60 * DAKIKA) });
    for (const [uid, rol] of [['u-mudur', 'Manager'], ['u-satis', 'Sales']] as Array<[string, AppRole]>) {
      const y = await panel(d, `/siparisler/${hedef}/sil`, { belirtec: belirtec(d, uid, { rol }), govde: { surum: 3 } });
      expect(y.kod, uid).toBe(403);
      expect(y.json).toEqual({ ok: false, kod: 'rol' });
      expect(y.baslik('cache-control')).toBe('no-store');
    }
    expect(await belge(hedef)).toEqual(talepVerisi({ talepNo: 'SİLİNECEK' }));
    const b = yoneticiBelirteci(d);
    // Önbellek dolsun: silmeden sonra dönen liste yine de günceldir.
    expect(((await panel(d, '/siparisler', { belirtec: b })).json as PanelListe)).toMatchObject({ acikToplam: 2 });
    const y = await panel(d, `/siparisler/${hedef}/sil`, { belirtec: b, govde: { surum: 3 } });
    expect(y.kod).toBe(200);
    expect(Object.keys(y.json as object)).toEqual(['siparisler', 'acikToplam', 'kesildi']);
    expect(siparisler(y).map(s => s.id)).toEqual([kalan]);
    expect(y.json).toMatchObject({ acikToplam: 1, kesildi: false });
    // Kayıt DURUR.
    const silinen = await belge(hedef);
    expect(silinen).toEqual(talepVerisi({ talepNo: 'SİLİNECEK', silindi: { zaman: zaman(SAAT_0), kim: { uid: 'u-yonetici', ad: 'Yönetici Hanım' }, kanal: 'panel' }, durumSurum: 4 }));
    expect(d.yayinlar).toEqual([[COLL, 'set', hedef, silinen, { cid: CID }]]);
    expect(d.denetim).toEqual([[{ uid: 'u-yonetici', email: 'u-yonetici@ornek.com.tr' }, 'Mağaza talebi silindi', 'SİLİNECEK · panel']]);
    expect([d.bildirimler, d.revizeler]).toEqual([[], []]);
    // Başka kullanıcının listesinde de yok (önbellek değişiklik olayıyla düştü).
    expect(siparisler(await panel(d, '/siparisler', { belirtec: belirtec(d) })).map(s => s.id)).toEqual([kalan]);
    expect(magazaPanelSayaclari()).toMatchObject({ silPanel: 1, silPanel409: 0, r403: 2, silErp: 0 });
  });
  it('panel sil: yetki İSTEK anında yeniden ölçülür — belirteci «Yönetici» diyen ama rolü Müdür\'e düşmüş kullanıcı 403; belirteci «Satış» diyen ama rolü Yönetici olan kullanıcı 200', async () => {
    const d = await kur();
    const id = await talepEkle();
    const b = yoneticiBelirteci(d);
    kullanici(d, 'u-yonetici', { role: 'Manager', name: 'Yönetici Hanım' });
    const dusen = await panel(d, `/siparisler/${id}/sil`, { belirtec: b, govde: { surum: 3 } });
    expect([dusen.kod, dusen.json]).toEqual([403, { ok: false, kod: 'rol' }]);
    expect(await belge(id)).toEqual(talepVerisi());
    kullanici(d, 'u-satis', { role: 'Admin', name: 'Ayşe Yılmaz' });
    const yukselen = await panel(d, `/siparisler/${id}/sil`, { belirtec: belirtec(d, 'u-satis', { rol: 'Sales' }), govde: { surum: 3 } });
    expect(yukselen.kod).toBe(200);
    expect((await belge(id)).silindi).toEqual({ zaman: zaman(SAAT_0), kim: { uid: 'u-satis', ad: 'Ayşe Yılmaz' }, kanal: 'panel' });
  });
  it('panel sil retleri: belirteçsiz 401 (gövde kapıdan SONRA) · 415 / 413 / bozuk JSON 400 · şema 400 (`surum`suz, `geriAl` — panelden geri alma YOK) · 409 `surum-eski` / `silindi` · 404 · panelde geri alma ucu YOK', async () => {
    const d = await kur();
    const id = await talepEkle();
    const yol = `/siparisler/${id}/sil`;
    // Kapı gövdeden ÖNCE: belirteçsiz + bozuk gövde / yanlış tür 401'dir.
    for (const o of [{ govde: { surum: 3 } }, { ham: '{bozuk' }, { ham: 'x', tur: 'text/plain' }] as Istek[]) {
      const y = await panel(d, yol, o);
      expect(y.kod).toBe(401);
      expect(y.metin).toBe('{"ok":false}');
    }
    const b = yoneticiBelirteci(d);
    expect((await panel(d, yol, { belirtec: b, ham: '{}', tur: 'text/plain' })).kod).toBe(415);
    expect((await panel(d, yol, { belirtec: b, ham: JSON.stringify({ dolgu: 'x'.repeat(70 * 1024) }) })).kod).toBe(413);
    expect((await panel(d, yol, { belirtec: b, ham: `{"surum": ${ISARET}` })).kod).toBe(400);
    for (const g of [{}, { surum: -1 }, { surum: '3' }, { surum: 3, geriAl: true }, { surum: 3, geriAl: false }, { surum: 3, kanal: 'erp' }, [3]]) {
      const y = await panel(d, yol, { belirtec: b, govde: g });
      expect(y.kod, JSON.stringify(g)).toBe(400);
      expect(y.metin).toBe('{"ok":false}');
    }
    // Bayat kart (araya aşama yazımı girdi).
    const bayat = await panel(d, yol, { belirtec: b, govde: { surum: 2 } });
    expect([bayat.kod, bayat.json]).toEqual([409, { ok: false, kod: 'surum-eski' }]);
    expect(await belge(id)).toEqual(talepVerisi());
    const silinmis = await talepEkle(silinmisEk());
    const zaten = await panel(d, `/siparisler/${silinmis}/sil`, { belirtec: b, govde: { surum: 4 } });
    expect([zaten.kod, zaten.json]).toEqual([409, { ok: false, kod: 'silindi' }]);
    const baska = await talepEkle({ companyId: 'kiraci-2' });
    for (const kimlik of [baska, 'mt-BOZUK', SIFIR_KIMLIK]) {
      const y = await panel(d, `/siparisler/${kimlik}/sil`, { belirtec: b, govde: { surum: 3 } });
      expect(y.kod, kimlik).toBe(404);
      expect(y.metin).toBe('{"ok":false}');
    }
    // Panelden geri alma YOK (V18): uç yok, `sil` gövdesinde `geriAl` 400 (yukarıda) — silinmiş talep panelden canlandırılamaz.
    expect((await panel(d, `/siparisler/${silinmis}/geri-al`, { belirtec: b, govde: { surum: 4 } })).kod).toBe(404);
    expect(await belge(silinmis)).toEqual(talepVerisi(silinmisEk()));
    expect([d.yayinlar, d.denetim]).toEqual([[], []]);
    expect(magazaPanelSayaclari()).toMatchObject({ silPanel: 0, silPanel409: 2 });
    expect(d.kacan).toEqual({ genelAyristirici: 0, genel404: 0, genelYakalayici: 0 });
  });
  it('liste: silinmiş talep (açık DA kapalı DA) listede YOK ve `acikToplam` yalnız CANLI açıkları sayar; geri alınmış (`silindi: null`) talep listede (gerçek motor)', async () => {
    const d = await kur();
    const acik = await talepEkle({ durum: 'yeni', talepNo: 'AÇIK', olusturma: zaman(SAAT_0 - 1000) });
    const kapali = await talepEkle({ durum: 'teslim', talepNo: 'KAPALI', durumZamani: zaman(SAAT_0 - 2000) });
    const geriAlinan = await talepEkle({ durum: 'sevk', talepNo: 'GERİ-ALINAN', olusturma: zaman(SAAT_0 - 3000), silindi: null });
    const geriAlinanKapali = await talepEkle({ durum: 'iptal', talepNo: 'GERİ-ALINAN-KAPALI', durumZamani: zaman(SAAT_0 - 4000), silindi: null });
    await talepEkle({ durum: 'yeni', talepNo: 'SİLİNMİŞ-AÇIK', ...silinmisEk() });
    await talepEkle({ durum: 'teslim', talepNo: 'SİLİNMİŞ-KAPALI', durumZamani: zaman(SAAT_0 - 500), ...silinmisEk() });
    await talepEkle({ durum: 'iptal', talepNo: 'SİLİNMİŞ-İPTAL', durumZamani: zaman(SAAT_0 - 500), ...silinmisEk() });
    await talepEkle({ durum: undefined, talepNo: 'SİLİNMİŞ-AŞAMASIZ', ...silinmisEk() });
    const y = await panel(d, '/siparisler', { belirtec: belirtec(d) });
    const liste = y.json as PanelListe;
    expect(liste.siparisler.map(s => s.id)).toEqual([acik, geriAlinan, kapali, geriAlinanKapali]);
    expect(liste).toMatchObject({ acikToplam: 2, kesildi: false });
    expect(y.metin).not.toContain('SİLİNMİŞ');
    // Silen kişi / silme zamanı / `silindi` alanı yanıta GİRMEZ (canlı kartta da).
    for (const yasak of ['silindi', 'Silen Kişi']) expect(y.metin, yasak).not.toContain(yasak);
  });
  it('`silebilir`: Yönetici\'ye her kartta `true`, Satış / Müdür\'e `false` — liste gövdesi kiracı başına ÖNBELLEKTE olsa da kullanıcıya göre işaretlenir (yazma uçlarının 200 listesinde de)', async () => {
    const d = await kur();
    const id = await talepEkle();
    await talepEkle({ durum: 'teslim', durumZamani: zaman(SAAT_0 - 1000) });
    const satis = belirtec(d);
    const yonetici = yoneticiBelirteci(d);
    const say = (): number => d.sorgular.filter(s => s === MAGAZA_PANEL_LISTE_SQL).length;
    // Önce Satış okur (önbellek `false`larla dolar), sonra Yönetici: önbellekten gelir ama `true` görür; sonra yine Satış: `false`.
    expect(siparisler(await panel(d, '/siparisler', { belirtec: satis })).map(s => s.silebilir)).toEqual([false, false]);
    expect(siparisler(await panel(d, '/siparisler', { belirtec: yonetici })).map(s => s.silebilir)).toEqual([true, true]);
    expect(siparisler(await panel(d, '/siparisler', { belirtec: belirtec(d, 'u-mudur', { rol: 'Manager' }) })).map(s => s.silebilir)).toEqual([false, false]);
    expect(siparisler(await panel(d, '/siparisler', { belirtec: satis })).map(s => s.silebilir)).toEqual([false, false]);
    expect(say()).toBe(1);
    // Yazma ucunun 200 listesi de aynı kuralla.
    const yoneticiYazdi = await panel(d, `/siparisler/${id}/kalem-teslim`, { belirtec: yonetici, govde: { surum: 3, teslim: true, kalemler: ['b:0'] } });
    expect(siparisler(yoneticiYazdi).map(s => s.silebilir)).toEqual([true, true]);
    const satisYazdi = await panel(d, `/siparisler/${id}/durum`, { belirtec: satis, govde: { onceki: 'sevk', surum: 4, durum: 'sevk', aciklama: 'Yolda' } });
    expect(siparisler(satisYazdi).map(s => s.silebilir)).toEqual([false, false]);
    // Rolü düşen Yönetici artık `false` görür (gösterim de istekte okunan rolden).
    kullanici(d, 'u-yonetici', { role: 'Sales', name: 'Yönetici Hanım' });
    expect(siparisler(await panel(d, '/siparisler', { belirtec: yonetici })).map(s => s.silebilir)).toEqual([false, false]);
  });
  it('kart: `teyit` SALT OKUNUR — 60 teyit kalemi → 50 + `kalemSayisi` 60, her biri `anahtar` + `teslim`; `teslimKaynagi: "teyit"`, `teslimIsaretsiz` BÜTÜNDEN; `kdvKaynagi` / `icerikSurum` / `bildirimRevize` / teyit `zaman`-`kim` yanıta GİRMEZ; beyan toplamları beyan olarak kalır', async () => {
    const d = await kur();
    const isaret = { durum: 'teslim', zaman: zaman(SAAT_0 - DAKIKA), kim: { uid: 'u-x', ad: 'Gizli Personel' } };
    const anahtar = (i: number): string => `t:${i.toString(16).padStart(12, '0')}`;
    const kalemler = Array.from({ length: 60 }, (_, i) => ({
      anahtar: anahtar(i), id: `u-${i}`, sku: `SKU-${i}`, ad: `Teyit ${i}`, marka: 'M', adet: i + 1, birimFiyat: i === 3 ? null : 10,
      kdvOrani: i === 4 ? 18 : 20, kdvKaynagi: 'personel', tedarik: i === 5,
    }));
    const id = await talepEkle({
      teyit: { kalemler, araToplam: null, kdv: null, toplam: null, zaman: zaman(SAAT_0 - 5 * DAKIKA), kim: { uid: 'u-x', ad: 'Gizli Personel' } },
      kalemTeslim: { [anahtar(0)]: isaret, [anahtar(55)]: isaret, 'b:1': isaret },
      ...revizeEk('bekliyor'), elle: { zaman: zaman(SAAT_0 - GUN), kim: { uid: 'u-x', ad: 'Gizli Personel' } },
    });
    const y = await panel(d, '/siparisler', { belirtec: belirtec(d) });
    const kart = siparisler(y)[0];
    expect(kart).toMatchObject({ id, teslimKaynagi: 'teyit', kalemSayisi: 3, teslimIsaretsiz: 58, elle: true, silebilir: false, araToplam: 459.97, kdv: null, toplam: null });
    expect(Object.keys(kart.teyit ?? {})).toEqual(['kalemler', 'kalemSayisi', 'araToplam', 'kdv', 'toplam']);
    expect(kart.teyit).toMatchObject({ kalemSayisi: 60, araToplam: null, kdv: null, toplam: null });
    expect(kart.teyit?.kalemler).toHaveLength(50);
    expect(kart.teyit?.kalemler[0]).toEqual({ anahtar: anahtar(0), sku: 'SKU-0', ad: 'Teyit 0', marka: 'M', adet: 1, birimFiyat: 10, kdvOrani: 20, tedarik: false, teslim: true });
    expect(kart.teyit?.kalemler[1].teslim).toBe(false);
    // `null` fiyat KORUNUR (0 değil); küme dışı saklı oran BİLİNMİYOR (`null` — oran uydurulmaz).
    expect(kart.teyit?.kalemler[3].birimFiyat).toBeNull();
    expect(kart.teyit?.kalemler[4].kdvOrani).toBeNull();
    expect(kart.teyit?.kalemler[5].tedarik).toBe(true);
    expect(kart.teyit?.kalemler[49].anahtar).toBe(anahtar(49));
    // Beyan kalemleri işaretini `b:<i>` girişinden okumaya devam eder (tarihçe).
    expect(kart.kalemler.map(k => k.teslim)).toEqual([false, true, false]);
    for (const yasak of ['kdvKaynagi', 'icerikSurum', 'icerikZamani', 'bildirimRevize', 'Gizli Personel', '"kim"', '"alanlar"', '"zaman"']) expect(y.metin, yasak).not.toContain(yasak);
  });
  it('`panelSiparisiEsle` (saf, 2b): teyit yok / `kalemler` boş dizi / dizi değil → `teyit` alanı YOK ve kaynak `beyan`; bozuk teyit kalemi fırlatmaz (bilinmeyen sayı `null`); `elle` yalnız NESNEYSE `true`; `silebilir` hep `false`', () => {
    for (const teyit of [undefined, null, 'çöp', {}, { kalemler: [] }, { kalemler: 'x' }, { kalemler: { a: 1 } }]) {
      const kart = panelSiparisiEsle('mt-x', talepVerisi({ teyit }));
      expect('teyit' in kart, JSON.stringify(teyit)).toBe(false);
      expect(kart).toMatchObject({ teslimKaynagi: 'beyan', kalemSayisi: 3, teslimIsaretsiz: 3, elle: false, silebilir: false });
    }
    const bozuk = panelSiparisiEsle('mt-x', talepVerisi({ teyit: { kalemler: ['dizge', { anahtar: 7, ad: 9, adet: '2', birimFiyat: '9', kdvOrani: '20', tedarik: 'evet' }], araToplam: '230', kdv: Number.NaN, toplam: 276 } }));
    expect(bozuk.teyit).toEqual({
      kalemler: [
        { anahtar: '', sku: '', ad: '', marka: '', adet: null, birimFiyat: null, kdvOrani: null, tedarik: false, teslim: false },
        { anahtar: '', sku: '', ad: '', marka: '', adet: null, birimFiyat: null, kdvOrani: null, tedarik: false, teslim: false },
      ],
      kalemSayisi: 2, araToplam: null, kdv: null, toplam: 276,
    });
    expect(bozuk.teslimKaynagi).toBe('teyit');
    for (const elle of [true, 'evet', 1, null, undefined, []]) expect(panelSiparisiEsle('mt-x', talepVerisi({ elle })).elle, JSON.stringify(elle)).toBe(false);
    expect(panelSiparisiEsle('mt-x', talepVerisi({ elle: {} })).elle).toBe(true);
    // Saf eşleyici `silebilir`i ASLA `true` üretmez (liste gövdesi kiracı başına önbelleklenir; hüküm rota yanıtında).
    expect(panelSiparisiEsle('mt-x', talepVerisi({ silebilir: true })).silebilir).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('sayaçlar ve 429 yazıcıları', () => {
  it('`magazaPanelSayaclari()`: anahtarlar SABİT, sıfırdan başlar, dönen nesne kopyadır; dilim 1 sayaçlarına KARIŞMAZ', () => {
    expect(Object.keys(magazaPanelSayaclari())).toEqual([
      'oturum', 'oturum401', 'oturum503', 'yetkiKodu', 'yetkiKoduRet', 'yetkiKoduIptalDenetimsiz',
      'durumPanel', 'durumPanel409', 'durumErp', 'durumErp409',
      'kalemTeslimPanel', 'kalemTeslimPanel409', 'kalemTeslimErp', 'kalemTeslimErp409', 'etiketBasildi', 'etiketBasildi404', 'etiketBasildi409',
      'bildirimGonder', 'bildirimGonder409',
      // Dilim 2b (§ 10.7; bilerek değişen çit): revize bildirimi, içerik, silme / geri alma, elle talep.
      'bildirimGonderRevize', 'bildirimGonderRevize409', 'revizeBildirimIstendi', 'revizeBildirimIstenemedi',
      'icerik', 'icerikDegisiklikYok', 'icerik409', 'icerik400', 'icerik503', 'icerik429',
      'silPanel', 'silPanel409', 'silErp', 'silErp409', 'geriAl', 'geriAl409', 'elleTalep', 'elleTalepCakisti',
      'cikisUidsiz', 'r401', 'r403', 'r404', 'r429', 'r500', 'r503',
    ]);
    // Tek yazım (kapı 4, Y8): revize sayacının adı `bildirimGonderRevize`'dir.
    expect(Object.keys(magazaPanelSayaclari())).not.toContain('revizeBildirimGonder');
    expect(Object.values(magazaPanelSayaclari()).every(v => v === 0)).toBe(true);
    (magazaPanelSayaclari() as Record<string, number>).oturum = 99;
    expect(magazaPanelSayaclari().oturum).toBe(0);
    expect(Object.keys(magazaSayaclari())).toEqual(['eklenen', 'cakisan', 'r400', 'r403', 'r404', 'r413', 'r415', 'r429', 'r500', 'r503']);
    // Bekçinin sayaç özeti adı kod kimliği biçiminde bekler.
    for (const ad of Object.keys(magazaPanelSayaclari())) expect(ad).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,39}$/);
  });
  it('`magazaPanel429`, `magazaYetkiKodu429` ve (2b) `magazaIcerik429`: sabit gövde + kendi sayacı; dilim 1\'in `r429`\'u ARTMAZ', () => {
    const cagrilar: unknown[] = [];
    const yanit = { setHeader() { return yanit; }, status(kod: number) { cagrilar.push(kod); return yanit; }, json(g: unknown) { cagrilar.push(g); return yanit; } };
    magazaPanel429({} as Request, yanit as unknown as Response);
    magazaYetkiKodu429({} as Request, yanit as unknown as Response);
    magazaIcerik429({} as Request, yanit as unknown as Response);
    expect(cagrilar).toEqual([429, { ok: false }, 429, { ok: false, kod: 'sinir' }, 429, { ok: false, kod: 'sinir' }]);
    expect(magazaPanelSayaclari()).toMatchObject({ r429: 1, yetkiKoduRet: 1, icerik429: 1 });
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

  it('panel alt zincirinin kayıt sırası SABİT (§ 4: 0, 1, 1b, 2–8, 7a, 7b [2b silme], 7c, 9, 10)', () => {
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
      // Dilim 2b (7b): silme — `kalem-teslim`'den (7a) SONRA, belirteç kapısından SONRA; panelde geri alma / içerik / elle talep ucu YOK.
      "panel.post('/siparisler/:id/sil', jsonDegilse415, govdeAyristir, sil);",
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
  it('ERP uçları: üç 2a talep ucu AYNI zincirde (`requireAuth` + `requireMfaVerified` + `C.dbLimiter`), üç 2b ucu `C.magazaIcerikLimiter` ile, yetki kodu kendi sınırlayıcısıyla; başka `app.` kaydı yok', () => {
    expect(erpSatirlari.map(s => s.trim()).filter(s => /^app\.\w+\(/.test(s))).toEqual([
      "app.post('/api/magaza-panel/yetki-kodu', onbelleksiz, C.requireAuth, C.requireMfaVerified, C.magazaYetkiKoduLimiter, iptalKapisi, yetkiKodu);",
      "app.post('/api/magaza-talepleri/:id/durum', C.requireAuth, C.requireMfaVerified, C.dbLimiter, durum);",
      "app.post('/api/magaza-talepleri/:id/kalem-teslim', C.requireAuth, C.requireMfaVerified, C.dbLimiter, kalemTeslim);",
      "app.post('/api/magaza-talepleri/:id/bildirim-gonder', C.requireAuth, C.requireMfaVerified, C.dbLimiter, bildirimGonder);",
      // Dilim 2b (§ 10.3): elle talep, içerik, silme / geri alma — kimlik ve MFA kapısından SONRA ortak içerik kovası.
      "app.post('/api/magaza-talepleri', C.requireAuth, C.requireMfaVerified, C.magazaIcerikLimiter, elleTalep);",
      "app.post('/api/magaza-talepleri/:id/icerik', C.requireAuth, C.requireMfaVerified, C.magazaIcerikLimiter, icerik);",
      "app.post('/api/magaza-talepleri/:id/sil', C.requireAuth, C.requireMfaVerified, C.magazaIcerikLimiter, sil);",
    ]);
    // Her uçta iki kapı da var ve sınırlayıcıdan ÖNCE (reddedilen istek kovaya sayılmaz).
    for (const kayit of erpSatirlari.map(x => x.trim()).filter(x => /^app\.post\(/.test(x))) expect(kayit).toMatch(/C\.requireAuth, C\.requireMfaVerified, C\.(dbLimiter|magazaIcerikLimiter|magazaYetkiKoduLimiter), /);
    // İptal denetimi YALNIZ yetki kodu zincirinde, sınırlayıcıdan SONRA (tanım + zincir satırı); Firebase çağrısı TEK yerde ve
    // süre tavanının içinde. Panel zinciri Firebase belirteci görmez.
    expect(erpKodu.match(/\biptalKapisi\b/g)).toHaveLength(2);
    expect(erpKodu.match(/belirtecIptalDenetle\(/g)).toHaveLength(1);
    expect(erpKodu).toContain('await sureli(C.belirtecIptalDenetle(belirtec), iptalDenetimiSuresi);');
    expect(panelKodu).not.toMatch(/belirtecIptalDenetle|iptalKapisi/);
    // Yazma işlevine giden kanal ve kiracı: sabit `'erp'`, `panelKullanicisi(uid).cid` (gövdeden değil).
    // Dilim 2b ile sayılar bilerek değişti: ERP'de + içerik ve silme (`kanal`), + elle talep / içerik / silme-geri alma (kiracı);
    // panelde + silme.
    expect(erpKodu.match(/kanal: 'erp'/g)).toHaveLength(4);
    expect(erpKodu.match(/companyId: y\.kullanici\.cid/g)).toHaveLength(6);
    expect(erpKodu).not.toMatch(/req\.body\??\.companyId|cozum\.data\.companyId/);
    expect(panelKodu.match(/kanal: 'panel'/g)).toHaveLength(3);
    expect(panelKodu.match(/companyId: h\.b\.kullanici\.cid/g)).toHaveLength(4);
    // `bildirimIste` rota modülünde ÇAĞRILMAZ: tek çağrı yazma işlevindedir (`bildirimiYenidenKuyrugaAl`, yanıttan önce beklenir).
    expect(erpKodu).not.toMatch(/bildirimIste\(/);
    expect(panelKodu).not.toMatch(/bildirimIste\(/);
    expect(kodSatirlari(join(SRC_KOK, 'server', 'kanal', 'magazaDurum.ts')).filter(s => /D\.bildirimIste\(/.test(s.kod))).toHaveLength(1);
  });
  it('(2b) yazma işlevinin HER sonucu `switch` ile ele alınır: `if (sonuc.sonuc …` zinciri YOK ve her `switch`in `default` dalı `eleAlinmamisSonuc(sonuc)` — işlev yeni sonuç kazanınca rota DERLENMEZ (`silindi` sessizce 200\'e düşüyordu)', () => {
    for (const [ad, kod, adet] of [['panel', panelKodu, 4], ['erp', erpKodu, 7]] as const) {
      expect(kod, ad).not.toMatch(/\bif \(sonuc\.sonuc\b|sonuc\.sonuc (===|!==)/);
      // Panel: aşama, kalem teslim, silme, etiket · ERP: aşama, kalem teslim, elle bildirim, elle talep, içerik, silme, geri alma.
      expect(kod.match(/switch \(sonuc\.sonuc\) \{/g), ad).toHaveLength(adet);
      expect(kod.match(/default:\s+eleAlinmamisSonuc\(sonuc\);/g), ad).toHaveLength(adet);
      expect(kod.match(/\bswitch \(/g), ad).toHaveLength(adet);
    }
    // TEK tanım (panel modülünde); ERP modülü içe aktarır. Parametre `never`: ele alınmamış dal derleme hatasıdır.
    expect(panelKodu).toContain('export function eleAlinmamisSonuc(_sonuc: never): never {');
    expect(erpKodu).toContain("import { eleAlinmamisSonuc, magazaPanelSay } from './magazaPanelZinciri.js';");
    expect(suclular(kaynakDosyalari(join(SRC_KOK, 'server')), /function eleAlinmamisSonuc\b/).map(t => t.site.replace(/:\d+$/, ''))).toEqual(['src/server/routes/magazaPanelZinciri.ts']);
    // Fırlatılan ileti SABİT: sonuç nesnesi belge taşıyabilir, iletiye yazılmaz.
    expect(panelKodu).toContain("throw new Error('magaza: yazma işlevinin sonucu rota tarafından ele alınmadı');");
  });
  it('(2b) «yazıldı ama bağlanmadı»: dört yazma işlevi ve beş şema rota modüllerinden GERÇEKTEN çağrılıyor; silme yetkisi iki kanalda da `magazaTalepSilmeYetkisi`; panel içerik / elle talep / geri alma / bildirim işlevi ÇAĞIRMAZ', () => {
    for (const cagri of ['elleTalepAc(D, ', 'talepIcerigiDegistir(D, ', 'talepGeriAl(D, ', 'talepSil(D, ']) expect(erpKodu.split(cagri).length - 1, cagri).toBe(1);
    expect(panelKodu.split('talepSil(D, ').length - 1).toBe(1);
    for (const sema of ['ErpElleTalepGovdesi', 'ErpIcerikGovdesi', 'ErpSilGovdesi']) expect(erpKodu.split(`${sema}.safeParse(req.body)`).length - 1, sema).toBe(1);
    expect(erpKodu.split('BildirimGonderSorgusu.safeParse({ ...req.query })').length - 1).toBe(1);
    expect(panelKodu.split('PanelSilGovdesi.safeParse(req.body)').length - 1).toBe(1);
    // Silme / geri alma: ERP'de `yetkili(…, magazaTalepSilmeYetkisi)`; öbür beş ERP ucu varsayılan ölçütle (`magazaTalepIslemYetkisi`).
    expect(erpKodu.match(/await yetkili\(req, res, magazaTalepSilmeYetkisi\)/g)).toHaveLength(1);
    expect(erpKodu.match(/await yetkili\(req, res\);/g)).toHaveLength(5);
    // Panelde iki yerde: kartın `silebilir` işareti (gösterim) ve silme ucunun hükmü — ikisi de kapıda bu istek için okunan rolle.
    expect(panelKodu.match(/magazaTalepSilmeYetkisi\(h\.b\.kullanici\.rol\)/g)).toHaveLength(2);
    expect(panelKodu).not.toMatch(/yuk\.rol\b/);
    // Panel içerik düzenlemez, elle talep açmaz, geri almaz, bildirim istemez (V15, V18). (`geriAl` yalnız ERP uçlarının da
    // yazdığı ortak sayaç tablosunun anahtarı olarak geçer — sayaç satırı dışında adı yok.)
    expect(panelKodu).not.toMatch(/talepIcerigiDegistir|elleTalepAc|talepGeriAl|bildirimiYenidenKuyrugaAl|revizeBildirimiIste/);
    expect(panelSatirlari.filter(x => /geriAl/i.test(x)).map(x => x.trim())).toEqual(['silPanel: 0, silPanel409: 0, silErp: 0, silErp409: 0, geriAl: 0, geriAl409: 0,']);
    expect(panelSatirlari.map(x => x.trim()).filter(x => /^panel\.post\(/.test(x) && /icerik|geri-al|bildirim/.test(x))).toEqual([]);
  });
  it('(2b) revize bildirimi isteği: rota modülünde YALNIZ sayaçlı sarmalayıcıda (`C.revizeBildirimiIste`) — asıl çağrılar yazma işlevlerinde, yanıttan ÖNCE; sorgu dizesi kimlik / rol kapısından SONRA ayrıştırılır', () => {
    expect(erpKodu.match(/C\.revizeBildirimiIste\(/g)).toHaveLength(1);
    expect(erpKodu).not.toMatch(/D\.revizeBildirimiIste\(|D\.bildirimIste\(|C\.bildirimIste\(/);
    const icerikKodu = kodSatirlari(join(SRC_KOK, 'server', 'kanal', 'magazaIcerik.ts')).map(x => x.kod).join('\n');
    const durumKodu = kodSatirlari(join(SRC_KOK, 'server', 'kanal', 'magazaDurum.ts')).map(x => x.kod).join('\n');
    // İçerik yazımı → revize kuyruğu; elle talep → İLK kuyruk; elle yeniden gönderme → türüne göre.
    expect(icerikKodu.match(/await D\.revizeBildirimiIste\(/g)).toHaveLength(1);
    expect(icerikKodu.match(/await D\.bildirimIste\(/g)).toHaveLength(1);
    expect(durumKodu.match(/await D\.revizeBildirimiIste\?\.\(/g)).toHaveLength(1);
    expect(durumKodu.match(/await D\.bildirimIste\(/g)).toHaveLength(1);
    // `bildirim-gonder`: yetki → sorgu ayrıştırma → SMTP ön denetimi → yazma işlevi (kimliksiz `?tur=x` 401, rol dışı 403 alır).
    const bas = erpSatirlari.findIndex(x => /const bildirimGonder = async \(req: Request, res: Response\): Promise<void> => \{/.test(x));
    const sira = ['await yetkili(req, res);', 'BildirimGonderSorgusu.safeParse(', 'C.smtpYapilandirmasi()', 'await bildirimiYenidenKuyrugaAl(D, {'].map(parca => erpSatirlari.findIndex((x, i) => i > bas && x.includes(parca)));
    expect(bas).toBeGreaterThan(-1);
    expect(sira.every(n => n > bas)).toBe(true);
    expect([...sira].sort((a, b) => a - b)).toEqual(sira);
    // `tur` yalnız `revize`: rota `'ilk'` değerini istekten OKUMAZ (yokluk = ilk bildirim).
    expect(erpKodu).toContain("tur: revize ? 'revize' : 'ilk'");
    expect(erpKodu).toContain("const revize = sorgu.data.tur === 'revize';");
    expect(erpKodu).not.toMatch(/req\.query\.tur|req\.body\??\.tur/);
  });
  it('`src/` altında test dışı dosyada `pglite` içe aktarımı YOK (çalışma anında yüklenmez — V10)', () => {
    const uretim = kaynakDosyalari(SRC_KOK).filter(y => !/\.test\.tsx?$/.test(y));
    expect(suclular(uretim, /pglite/i)).toEqual([]);
  }, 60_000);   // `src/`in tamamı tek testte taranır: yük altında 5 sn'lik varsayılan süre yetmez (depo kalıbı)
  it('rol kümesi kopyalanmaz: iki modül de `magazaTalepIslemYetkisi`\'ni çağırır, rol adı yazmaz', () => {
    const roller = (APP_ROLES as readonly AppRole[]).map(r => `'${r}'`);
    for (const kod of [panelKodu, erpKodu]) {
      expect(kod).toContain('magazaTalepIslemYetkisi(');
      for (const rol of roller) expect(kod, rol).not.toContain(rol);
    }
  });
});
