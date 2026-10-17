// @vitest-environment node
/**
 * magazaRoutes.test.ts — mağaza zincirinin GERÇEK express ile davranışı + modülün kaynak çiti (dilim 1, 2026-10-08).
 * Dilim 2a (2026-10-10): takip ucu (`POST /siparis-durumu`) gerçek yanıt verir; `/panel` alt zinciri bağlamla gelir (kendi
 * testleri `magazaPanelUclar.test.ts`'te — burada yalnız BAĞLANDIĞI YER sınanır). Takip SQL'inin ANLAMI gerçek motorda
 * (PGlite) o dosyada; buradaki sahte havuz hazır satır döndürür ve rota mantığını (tür daraltma, sayaç, yanıt) sınar.
 *
 * DÜZENEK (şartname § 7): gerçek `express()`; üretimdeki AYNI `magazaZinciri(C)` `/api/magaza`'ya bağlanır; ARDINA
 * server.ts'te zincirden sonra gelenlerin kopyası gelir — genel ayrıştırıcı (`verify` sayaçlı), eşleşmeyen /api 404'ü,
 * genel hata yakalayıcı. Kopyasız düzenekte express'in yerleşik son işleyicisi bozuk JSON'a 400, büyük gövdeye 413
 * verir: test yeşil kalır, canlı 500 döner ve gövde parçası günlüğe düşerdi. İstek gerçek soketten (`fetch`) gelir —
 * `sahteApp` deseni bu uç için YETERSİZ (ara katman koşmaz).
 *
 * Her testin sonunda (afterEach) dört «zincirden kaçtı» sayacının 0 olduğu doğrulanır: zincir her isteği KENDİSİ
 * sonlandırır. Düzeneğin sayaçlarının GERÇEKTEN saydığını «düzenek» bölümündeki kontrol testleri kanıtlar.
 *
 * Sınırlayıcılar üretimde server.ts'te kurulur (hız sınırı çiti rota modülünde sınırlayıcı kurulmasını yasaklar; test
 * dosyalarını taramaz). Burada gerçek kitaplıkla, küçük tavanlı iki sınırlayıcı kurulur ve `handler: magaza429` verilir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import rateLimit from 'express-rate-limit';
import { kodSatirlari, oku, SRC_KOK } from '../../test/kaynakTarama';
import { TabanAdresHatasi } from '../../lib/guvenliTaban';
import { MAGAZA_TALEP_KIMLIK_DESENI, MAGAZA_TALEP_KOLEKSIYONU } from '../../lib/magazaTalep';
import { MAGAZA_BILDIRIM_KALEM_SINIRI } from '../kanal/magazaBildirim';
import { magazaTalepKimligi } from '../kanal/magazaTalep';
import { EKLEME_SQL as TASINAN_EKLEME_SQL } from '../kanal/magazaTalepSql';
import { MagazaSiparisDurumuSchema, MagazaSiparisTalebiSchema } from '../schemas';
import {
  MAGAZA_BELGE_SINIRI_BAYT, MAGAZA_GOVDE_SINIRI_BAYT, MAGAZA_TAKIP_SQL, MAGAZA_VARSAYILAN_KOKEN,
  magaza429, magazaIzinliKokenleriCoz, magazaSayaclari, magazaSayaclariniSifirla, magazaTakipSayaclari, magazaZinciri,
  type MagazaPgHavuzu, type MagazaRouteCtx,
} from './magazaRoutes';

const IZINLI = 'https://www.cetpa.com.tr';
const IZINSIZ = 'https://kotu.example';
/** Gövdeye gömülen ayırt edici dizge: yanıtta ya da console çıktısında görünürse gövde sızmıştır. */
const ISARET = 'QZX7-4471-KVW9';
const SIFIR_SAYACLAR = { eklenen: 0, cakisan: 0, r400: 0, r403: 0, r404: 0, r413: 0, r415: 0, r429: 0, r500: 0, r503: 0 };
const EKLEME_SQL = 'INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO NOTHING RETURNING id';
const SAAT_0 = Date.parse('2026-10-08T09:15:30.123Z');
const k = (...kodlar: number[]): string => String.fromCharCode(...kodlar);
const bekle = (ms: number): Promise<void> => new Promise(coz => { setTimeout(coz, ms); });

// ── console yakalama ──────────────────────────────────────────────────────────────────────────────────────────────
/** Hata nesnesi basılırsa iletisi, yığını ve kendi alanları (`body`, `detail` …) da metne girer — sızıntı kaçmasın. */
function ciktiMetni(deger: unknown): string {
  if (deger instanceof Error) {
    const alanlar = Object.fromEntries(Object.getOwnPropertyNames(deger).map(ad => [ad, String((deger as unknown as Record<string, unknown>)[ad])]));
    return `${deger.name}: ${deger.message} ${JSON.stringify(alanlar)}`;
  }
  if (typeof deger === 'object' && deger !== null) { try { return JSON.stringify(deger); } catch { return String(deger); } }
  return String(deger);
}
let konsol: string[] = [];
const konsolMetni = (): string => konsol.join('\n');

// ── düzenek ───────────────────────────────────────────────────────────────────────────────────────────────────────
interface Ayar {
  /** Kiracı çözümleyici; verilmezse `kiraci-1`. */
  kiraci?: () => Promise<string>;
  havuzYok?: boolean;
  /** Verilirse her sorgu bununla reddeder. */
  sorguHatasi?: unknown;
  talepTavani?: number;
  durumTavani?: number;
  bildirimIste?: (talepId: string) => Promise<void>;
  yayinHatasi?: unknown;
  /** `null` = bağlama verilmez (ortam değişkeni yolu). */
  kokenler?: readonly string[] | null;
  apiLimiter?: RequestHandler;
  /** Zincirden ÖNCE bağlanan ara katman. */
  onceki?: RequestHandler;
  /** Takip ucunun dar okumasına (`MAGAZA_TAKIP_SQL`) dönecek satırlar; verilmezse satır yok (bulunamadı). */
  takip?: (params: unknown[]) => Array<Record<string, unknown>>;
  /** `/panel` alt zinciri; verilmezse isteği sayan ve sonlandıran sahte zincir. */
  panelZinciri?: RequestHandler;
}
interface Duzenek {
  taban: string;
  saat: { ms: number };
  sorgular: Array<{ sql: string; params: unknown[] }>;
  yayinlar: unknown[][];
  bildirimler: string[];
  olaylar: string[];
  /** Sahte `/panel` alt zincirine ulaşan istekler (`YÖNTEM yol`; yol alt zincire göre). */
  panelIstekleri: string[];
  sayim: { kiraci: number; havuz: number; apiLimiter: number };
  /** Zincirden KAÇAN istekler: hepsi 0 kalmalı (kontrol testleri hariç). */
  kacan: { sonrakiAraKatman: number; genelAyristirici: number; genel404: number; genelYakalayici: number };
  kontrolTesti: boolean;
}
const sunucular: http.Server[] = [];
let sonDuzenek: Duzenek | undefined;

/** Üretimde server.ts'te kurulan sınırlayıcının küçük tavanlı eşi. Anahtar bir test başlığından: IP okunmaz. */
const sinirlayici = (tavan: number): RequestHandler => rateLimit({
  windowMs: 15 * 60 * 1000,
  max: tavan,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: istek => String(istek.headers['x-deney-anahtari'] ?? 'tek-istemci'),
  handler: magaza429,
});

async function kur(a: Ayar = {}): Promise<Duzenek> {
  const d: Duzenek = {
    taban: '', saat: { ms: SAAT_0 }, sorgular: [], yayinlar: [], bildirimler: [], olaylar: [], panelIstekleri: [],
    sayim: { kiraci: 0, havuz: 0, apiLimiter: 0 },
    kacan: { sonrakiAraKatman: 0, genelAyristirici: 0, genel404: 0, genelYakalayici: 0 },
    kontrolTesti: false,
  };
  const satirlar = new Set<string>();
  const havuz: MagazaPgHavuzu = {
    query: async (sql, params = []) => {
      d.sorgular.push({ sql, params });
      d.olaylar.push('sql');
      if (a.sorguHatasi !== undefined) throw a.sorguHatasi;
      if (sql === MAGAZA_TAKIP_SQL) return { rows: a.takip ? a.takip(params) : [] };
      const anahtar = `${String(params[0])}/${String(params[1])}`;
      if (satirlar.has(anahtar)) return { rows: [] }; // ON CONFLICT … DO NOTHING: çakışmada satır dönmez
      satirlar.add(anahtar);
      return { rows: [{ id: params[1] }] };
    },
  };
  const C: MagazaRouteCtx = {
    apiLimiter: a.apiLimiter ?? ((_istek, _yanit, sonraki) => { d.sayim.apiLimiter += 1; sonraki(); }),
    talepSinirlayici: sinirlayici(a.talepTavani ?? 1000),
    durumSinirlayici: sinirlayici(a.durumTavani ?? 1000),
    panelZinciri: a.panelZinciri ?? ((istek, yanit) => { d.panelIstekleri.push(`${istek.method} ${istek.url}`); yanit.status(404).json({ ok: false, panel: true }); }),
    getPgPool: () => { d.sayim.havuz += 1; return a.havuzYok ? null : havuz; },
    serverTenantId: () => { d.sayim.kiraci += 1; return a.kiraci ? a.kiraci() : Promise.resolve('kiraci-1'); },
    broadcastDocChange: (...argumanlar) => {
      d.yayinlar.push(argumanlar);
      d.olaylar.push('yayin');
      if (a.yayinHatasi !== undefined) throw a.yayinHatasi;
    },
    bildirimIste: (talepId) => {
      d.bildirimler.push(talepId);
      d.olaylar.push('bildirim');
      return a.bildirimIste ? a.bildirimIste(talepId) : Promise.resolve();
    },
    ...(a.kokenler === null ? {} : { izinliKokenler: () => a.kokenler ?? [IZINLI] }),
    simdi: () => new Date(d.saat.ms),
  };

  const app = express();
  if (a.onceki) app.use(a.onceki);
  // Üretimdeki AYNI zincir, server.ts'teki AYNI yere: genel sınırlayıcı bağlamasından ve genel ayrıştırıcıdan ÖNCE.
  app.use('/api/magaza', magazaZinciri(C));

  // ── buradan sonrası server.ts'in KOPYASI (yalnız sayaç satırları eklendi) ──
  // `app.use('/api', apiLimiter)` yerine sayaç: zincirden çıkan istek buraya düşer.
  app.use('/api', (_istek, _yanit, sonraki) => { d.kacan.sonrakiAraKatman += 1; sonraki(); });
  // Capture raw body for Shopify webhook HMAC verification (must come before express.json)
  app.use(express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => {
      d.kacan.genelAyristirici += 1;
      req.rawBody = buf;
    },
  }));
  // Olağan bir rota modülü ucunun yerine (kontrol testleri).
  app.post('/api/kontrol', (req: Request, res: Response) => { res.json({ alindi: req.body !== undefined }); });
  app.use((req, res) => {
    // Eşleşmeyen /api/… isteği → SPA index.html DEĞİL, JSON 404 (HTML-as-JSON karışıklığı engeli).
    if (req.path.startsWith('/api/')) {
      d.kacan.genel404 += 1;
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.status(404).type('text/plain').send('Not found');
  });
  // Global Express hata yakalayıcı — yakalanmamış route hataları + body-parser hataları
  // generic JSON 500 döner (stack/secret sızdırmaz; ham hata sunucu logunda).
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    d.kacan.genelYakalayici += 1;
    console.error('[express error]', err?.message || err);
    if (res.headersSent) return;
    // Ayardaki taban adres kuralı çiğnenmiş (guvenliTaban.ts): metin yalnız kuralı söyler, sır/adres yankılamaz → kullanıcıya açık.
    if (err instanceof TabanAdresHatasi) { res.status(400).json({ success: false, error: err.message }); return; }
    res.status(500).json({ error: 'Sunucu hatası.' });
  });

  const sunucu = http.createServer(app);
  sunucular.push(sunucu);
  await new Promise<void>(coz => { sunucu.listen(0, '127.0.0.1', () => coz()); });
  const adres = sunucu.address();
  if (!adres || typeof adres === 'string') throw new Error('test sunucusu dinlemiyor');
  d.taban = `http://127.0.0.1:${adres.port}`;
  sonDuzenek = d;
  return d;
}

// ── istek ─────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Istek {
  method?: string;
  /** `undefined` = izinli köken; `null` = Origin başlığı yok. */
  koken?: string | null;
  /** `undefined` = gövde varsa `application/json`; `null` = Content-Type başlığı yok. */
  tur?: string | null;
  /** JSON'a çevrilip gönderilir. */
  govde?: unknown;
  /** Olduğu gibi gönderilir (bozuk JSON, kaçışlı metin, sıkıştırılmış gövde). */
  ham?: string | Uint8Array<ArrayBuffer>;
  basliklar?: Record<string, string>;
  /** Tam yol (zincirin dışına istek — kontrol testleri). */
  tamYol?: boolean;
}
interface Yanit { kod: number; metin: string; json: unknown; baslik: (ad: string) => string | null }

async function iste(d: Duzenek, yol: string, o: Istek = {}): Promise<Yanit> {
  const basliklar: Record<string, string> = {};
  const koken = o.koken === undefined ? IZINLI : o.koken;
  if (koken !== null) basliklar.Origin = koken;
  // Gövde HER ZAMAN bayt dizisi: `fetch` dizgeye kendiliğinden `text/plain` başlığı ekler.
  let govde: Uint8Array<ArrayBuffer> | undefined;
  if (o.ham !== undefined) govde = typeof o.ham === 'string' ? new TextEncoder().encode(o.ham) : o.ham;
  else if (o.govde !== undefined) govde = new TextEncoder().encode(JSON.stringify(o.govde));
  const tur = o.tur === undefined ? (govde ? 'application/json' : null) : o.tur;
  if (tur !== null) basliklar['Content-Type'] = tur;
  Object.assign(basliklar, o.basliklar);
  const y = await fetch(`${d.taban}${o.tamYol ? '' : '/api/magaza'}${yol}`, { method: o.method ?? 'POST', headers: basliklar, body: govde });
  const metin = await y.text();
  let json: unknown;
  try { json = JSON.parse(metin); } catch { json = undefined; }
  return { kod: y.status, metin, json, baslik: ad => y.headers.get(ad) };
}

/** Mağazanın gönderdiği biçimde geçerli gövde; `ustune` ile alan ezilir. */
function govde(ustune: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    no: 'T261008-5Y9P',
    tarih: '2026-10-08T12:15:00.000+03:00',
    musteri: { ad: 'Şükrü Ağaoğlu', firma: 'Iğdır Yapı', telefon: '+90 (532) 123 45 67', eposta: 'sukru@ornek.com.tr', il: 'İstanbul', adres: 'Çiçek Sk. No: 4\nKadıköy', vergi: '1234567890' },
    not: 'Öğleden sonra arayın.',
    kalemler: [
      { id: 'u-1', sku: 'DYO-0001', ad: 'İç cephe boyası 15 L', marka: 'DYO', adet: 2, birimFiyat: 204.99, tedarik: false },
      { id: 'u-2', sku: 'KRB-77', ad: 'Fayans yapıştırıcısı', marka: 'Karbosan', adet: 5, birimFiyat: null, tedarik: true },
    ],
    araToplam: 409.98, kdv: 82, toplam: 491.98, fiyatiSorulacakVar: true,
    ...ustune,
  };
}
const talep = (d: Duzenek, ustune: Record<string, unknown> = {}, o: Istek = {}): Promise<Yanit> =>
  iste(d, '/siparis-talebi', { govde: govde(ustune), ...o });
/** n'inci benzersiz talep no (aynı telefonla ayrı doküman). */
const no = (n: number): string => `T261008-${String(n).padStart(4, '0')}`;
/** Yazılan dokümanı SQL parametresinden çözer. */
function yazilan(d: Duzenek, sira = 0): { id: string; json: string; belge: Record<string, unknown> & { musteri: Record<string, string>; kalemler: Array<Record<string, unknown>> } } {
  const p = d.sorgular[sira]?.params;
  if (!p || typeof p[1] !== 'string' || typeof p[2] !== 'string') throw new Error('beklenen ekleme sorgusu yok');
  return { id: p[1], json: p[2], belge: JSON.parse(p[2]) };
}

beforeEach(() => {
  magazaSayaclariniSifirla();
  konsol = [];
  sonDuzenek = undefined;
  for (const ad of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    vi.spyOn(console, ad).mockImplementation((...argumanlar: unknown[]) => { konsol.push(`${ad}: ${argumanlar.map(ciktiMetni).join(' ')}`); });
  }
});
afterEach(async () => {
  const cikti = konsolMetni();
  const d = sonDuzenek;
  vi.restoreAllMocks();
  await Promise.all(sunucular.splice(0).map(s => new Promise<void>(coz => { s.closeAllConnections(); s.close(() => coz()); })));
  // express-rate-limit doğrulama uyarısı (ERR_ERL_…) basılmamalı: test sınırlayıcısı yanlış kurulmuş demektir.
  expect(cikti).not.toContain('ERR_ERL');
  if (d && !d.kontrolTesti) {
    // Zincir her isteği KENDİSİ sonlandırır: genel sınırlayıcıya / ayrıştırıcıya / 404'e / hata yakalayıcıya düşen istek YOK.
    expect(d.kacan).toEqual({ sonrakiAraKatman: 0, genelAyristirici: 0, genel404: 0, genelYakalayici: 0 });
    // Günlükte gövdeden parça YOK.
    expect(cikti).not.toContain(ISARET);
  }
});

describe('düzenek — sayaçlar GERÇEKTEN sayıyor (çit boş kümeyi sınamasın)', () => {
  it('kontrol: zincirin DIŞINDA bozuk JSON genel yakalayıcıya düşer, 500 döner ve gövde parçası günlüğe basılır', async () => {
    const d = await kur();
    d.kontrolTesti = true;
    const y = await iste(d, '/api/kontrol', { tamYol: true, ham: `{"ad": ${ISARET}` });
    expect(y.kod).toBe(500);
    expect(y.json).toEqual({ error: 'Sunucu hatası.' });
    // `verify` ham gövdeyle, çözümlemeden ÖNCE çağrılır — bozuk gövdede de sayar.
    expect(d.kacan).toEqual({ sonrakiAraKatman: 1, genelAyristirici: 1, genel404: 0, genelYakalayici: 1 });
    // Mağaza zincirinin kendi yakalayıcısına NEDEN ihtiyaç duyduğunun ölçüsü: body-parser iletisi gövdeden parça taşır.
    expect(konsolMetni()).toContain(ISARET.slice(0, 4));
  });
  it('kontrol: zincirin DIŞINDA geçerli JSON genel ayrıştırıcıdan geçer; bilinmeyen /api yolu genel 404\'e düşer', async () => {
    const d = await kur();
    d.kontrolTesti = true;
    expect((await iste(d, '/api/kontrol', { tamYol: true, govde: { a: 1 } })).json).toEqual({ alindi: true });
    expect((await iste(d, '/api/yok', { tamYol: true, govde: { a: 1 } })).json).toEqual({ error: 'Not found' });
    expect(d.kacan).toEqual({ sonrakiAraKatman: 2, genelAyristirici: 2, genel404: 1, genelYakalayici: 0 });
    expect(magazaSayaclari()).toEqual(SIFIR_SAYACLAR);
  });
  it('düzenekteki kopyalar server.ts\'teki asıllarıyla AYNI (server.ts değişirse düzenek de güncellenir)', () => {
    const sunucu = kodSatirlari(join(SRC_KOK, '..', 'server.ts')).map(s => s.kod.trim()).filter(s => s !== '').join('\n');
    expect(sunucu).toMatch(/app\.use\(express\.json\(\{\s*verify\b/);
    expect(sunucu).toContain(["if (req.path.startsWith('/api/')) {", "res.status(404).json({ error: 'Not found' });", 'return;', '}'].join('\n'));
    expect(sunucu).toContain([
      'app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {',
      "console.error('[express error]', err?.message || err);",
      'if (res.headersSent) return;',
      'if (err instanceof TabanAdresHatasi) { res.status(400).json({ success: false, error: err.message }); return; }',
      "res.status(500).json({ error: 'Sunucu hatası.' });",
      '});',
    ].join('\n'));
  });
});

describe('köken kapısı (CORS)', () => {
  it('izinli köken: 201 + köken AYNEN yansır; Methods / Headers / Max-Age; Allow-Credentials YOK', async () => {
    const d = await kur();
    const y = await talep(d);
    expect(y.kod).toBe(201);
    expect(y.json).toEqual({ ok: true });
    expect(y.baslik('access-control-allow-origin')).toBe(IZINLI);
    expect(y.baslik('access-control-allow-methods')).toBe('POST');
    expect(y.baslik('access-control-allow-headers')).toBe('Content-Type');
    expect(y.baslik('access-control-max-age')).toBe('600');
    expect(y.baslik('access-control-allow-credentials')).toBeNull();
    expect(y.baslik('vary')).toMatch(/\bOrigin\b/);
  });
  it('izinsiz köken → 403 { ok: false }; köken başlığı YOK; sınırlayıcılara ve veritabanına ulaşmaz', async () => {
    const d = await kur({ talepTavani: 1 });
    for (let i = 0; i < 3; i++) {
      const y = await talep(d, {}, { koken: IZINSIZ });
      expect(y.kod).toBe(403);
      expect(y.json).toEqual({ ok: false });
      expect(y.baslik('access-control-allow-origin')).toBeNull();
      expect(y.baslik('ratelimit-remaining')).toBeNull();
      expect(y.baslik('vary')).toMatch(/\bOrigin\b/);
    }
    expect(d.sayim.apiLimiter).toBe(0);
    expect(d.sorgular).toEqual([]);
    expect(d.sayim.kiraci).toBe(0);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r403: 3 });
    // Kova tüketilmedi: tavanı 1 olan sınırlayıcıdan ilk izinli istek hâlâ geçer.
    expect((await talep(d)).kod).toBe(201);
  });
  it('kökensiz istek → 403 (OPTIONS dışındaki HER yöntemde)', async () => {
    const d = await kur();
    expect((await talep(d, {}, { koken: null })).kod).toBe(403);
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect((await iste(d, '/siparis-talebi', { method, koken: null })).kod, method).toBe(403);
      expect((await iste(d, '/bilinmeyen', { method, koken: IZINSIZ })).kod, method).toBe(403);
    }
    expect((await iste(d, '/siparis-durumu', { govde: {}, koken: null })).kod).toBe(403);
    expect(d.sorgular).toEqual([]);
    expect(d.sayim.apiLimiter).toBe(0);
  });
  it('karşılaştırma BİREBİR: büyük harf, sondaki eğik çizgi, başka şema, başka kapı, uzatılmış ad, `null` → 403', async () => {
    const d = await kur();
    for (const koken of ['https://WWW.cetpa.com.tr', `${IZINLI}/`, 'http://www.cetpa.com.tr', `${IZINLI}:8443`, `${IZINLI}.kotu.example`, 'https://cetpa.com.tr', 'null', '*']) {
      const y = await talep(d, {}, { koken });
      expect(y.kod, koken).toBe(403);
      expect(y.baslik('access-control-allow-origin'), koken).toBeNull();
    }
    expect(d.sorgular).toEqual([]);
  });
  it('OPTIONS → 204 ve BİTER: boş gövde; izinli kökende başlıklar var, izinsizde / kökensizde yok', async () => {
    const d = await kur();
    const izinli = await iste(d, '/siparis-talebi', { method: 'OPTIONS', basliklar: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    expect(izinli.kod).toBe(204);
    expect(izinli.metin).toBe('');
    expect(izinli.baslik('access-control-allow-origin')).toBe(IZINLI);
    expect(izinli.baslik('access-control-allow-methods')).toBe('POST');
    expect(izinli.baslik('access-control-allow-headers')).toBe('Content-Type');
    expect(izinli.baslik('access-control-max-age')).toBe('600');
    expect(izinli.baslik('access-control-allow-credentials')).toBeNull();
    expect(izinli.baslik('vary')).toMatch(/\bOrigin\b/);
    for (const koken of [IZINSIZ, null]) {
      const y = await iste(d, '/siparis-durumu', { method: 'OPTIONS', koken });
      expect(y.kod).toBe(204);
      expect(y.baslik('access-control-allow-origin')).toBeNull();
    }
    expect((await iste(d, '/bilinmeyen', { method: 'OPTIONS' })).kod).toBe(204);
  });
  it('OPTIONS hiçbir kovaya SAYILMAZ: genel sınırlayıcıya, mağaza sınırlayıcılarına, sayaçlara ulaşmaz', async () => {
    const d = await kur({ talepTavani: 2, durumTavani: 1 });
    for (let i = 0; i < 6; i++) {
      const y = await iste(d, i % 2 === 0 ? '/siparis-talebi' : '/siparis-durumu', { method: 'OPTIONS' });
      expect(y.kod).toBe(204);
      expect(y.baslik('ratelimit-remaining')).toBeNull();
    }
    expect(d.sayim.apiLimiter).toBe(0);
    expect(magazaSayaclari()).toEqual(SIFIR_SAYACLAR);
    // Kovalar dokunulmamış: talepte iki, durumda bir hak duruyor.
    expect((await talep(d, { no: no(1) })).baslik('ratelimit-remaining')).toBe('1');
    expect((await talep(d, { no: no(2) })).kod).toBe(201);
    expect((await talep(d, { no: no(3) })).kod).toBe(429);
    expect((await iste(d, '/siparis-durumu', { govde: {} })).kod).toBe(400);
    expect(d.sayim.apiLimiter).toBe(4);
  });
  it('birden çok izinli köken: İSTEYEN köken yansır (liste başı ya da `*` değil)', async () => {
    const d = await kur({ kokenler: [IZINLI, 'https://onizleme.cetpa.com.tr'] });
    expect((await talep(d, { no: no(1) }, { koken: 'https://onizleme.cetpa.com.tr' })).baslik('access-control-allow-origin')).toBe('https://onizleme.cetpa.com.tr');
    expect((await talep(d, { no: no(2) })).baslik('access-control-allow-origin')).toBe(IZINLI);
    expect((await talep(d, { no: no(3) }, { koken: IZINSIZ })).kod).toBe(403);
  });
  it('`Vary` EZİLMEZ, eklenir', async () => {
    const d = await kur({ onceki: (_istek, yanit, sonraki) => { yanit.setHeader('Vary', 'Accept-Encoding'); sonraki(); } });
    const vary = (await talep(d)).baslik('vary');
    expect(vary).toMatch(/\bAccept-Encoding\b/);
    expect(vary).toMatch(/\bOrigin\b/);
  });
  it('köken listesi bağlamla verilmezse `MAGAZA_IZINLI_KOKENLER` ortam değişkeninden okunur; yoksa varsayılan', async () => {
    const yedek = process.env.MAGAZA_IZINLI_KOKENLER;
    try {
      delete process.env.MAGAZA_IZINLI_KOKENLER;
      const d = await kur({ kokenler: null });
      expect((await talep(d, { no: no(1) })).kod).toBe(201);
      expect((await talep(d, { no: no(2) }, { koken: 'https://deneme.example' })).kod).toBe(403);
      process.env.MAGAZA_IZINLI_KOKENLER = ' https://deneme.example/ , * ';
      const y = await talep(d, { no: no(3) }, { koken: 'https://deneme.example' });
      expect(y.kod).toBe(201);
      expect(y.baslik('access-control-allow-origin')).toBe('https://deneme.example');
      // Liste açıkça verildiyse varsayılan köken artık izinli DEĞİL.
      expect((await talep(d, { no: no(4) })).kod).toBe(403);
    } finally {
      if (yedek === undefined) delete process.env.MAGAZA_IZINLI_KOKENLER; else process.env.MAGAZA_IZINLI_KOKENLER = yedek;
    }
  });
  it('magazaIzinliKokenleriCoz: virgülle ayırır, kırpar, sondaki `/` atar; boş, `*` ve `null` yok sayılır; harf çevirmez', () => {
    expect(MAGAZA_VARSAYILAN_KOKEN).toBe('https://www.cetpa.com.tr');
    expect(magazaIzinliKokenleriCoz(undefined)).toEqual([MAGAZA_VARSAYILAN_KOKEN]);
    expect(magazaIzinliKokenleriCoz('')).toEqual([MAGAZA_VARSAYILAN_KOKEN]);
    expect(magazaIzinliKokenleriCoz(' , ,, ')).toEqual([MAGAZA_VARSAYILAN_KOKEN]);
    expect(magazaIzinliKokenleriCoz('*')).toEqual([MAGAZA_VARSAYILAN_KOKEN]);
    expect(magazaIzinliKokenleriCoz('null, *')).toEqual([MAGAZA_VARSAYILAN_KOKEN]);
    expect(magazaIzinliKokenleriCoz(' https://a.example/ ,https://b.example//,, * ,https://C.example:8443')).toEqual(['https://a.example', 'https://b.example', 'https://C.example:8443']);
  });
});

describe('415 — JSON olmayan POST ayrıştırıcıya hiç verilmez', () => {
  it.each([
    ['text/plain (gövde geçerli JSON olsa bile)', 'text/plain'],
    ['text/plain;charset=UTF-8 (tarayıcının dizge gövdeye koyduğu)', 'text/plain;charset=UTF-8'],
    ['form', 'application/x-www-form-urlencoded'],
    ['multipart', 'multipart/form-data; boundary=x'],
    ['JSON benzeri başka tür', 'application/vnd.api+json'],
    ['Content-Type başlığı yok', null],
  ])('%s → 415 { ok: false }; yazma yok', async (_ad, tur) => {
    const d = await kur();
    const y = await talep(d, { not: ISARET }, { tur });
    expect(y.kod).toBe(415);
    expect(y.json).toEqual({ ok: false });
    expect(d.sorgular).toEqual([]);
    expect(konsol).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r415: 1 });
  });
  it('gövdesiz ve türsüz POST → 415; durum ucu ve bilinmeyen yol da aynı denetimden geçer', async () => {
    const d = await kur();
    expect((await iste(d, '/siparis-talebi')).kod).toBe(415);
    expect((await iste(d, '/siparis-durumu', { ham: '{}', tur: 'text/plain' })).kod).toBe(415);
    expect((await iste(d, '/bilinmeyen', { ham: '{}', tur: 'text/plain' })).kod).toBe(415);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r415: 3 });
  });
  it('`application/json; charset=utf-8` kabul edilir', async () => {
    const d = await kur();
    expect((await talep(d, {}, { tur: 'application/json; charset=utf-8' })).kod).toBe(201);
  });
  it('desteklenmeyen karakter kümesi / gövde kodlaması → 415 (ayrıştırıcı hatası zincirin KENDİ yakalayıcısında)', async () => {
    const d = await kur();
    const kume = await talep(d, { not: ISARET }, { tur: 'application/json; charset=iso-8859-9' });
    expect(kume.kod).toBe(415);
    expect(kume.json).toEqual({ ok: false });
    const kodlama = await talep(d, { not: ISARET }, { basliklar: { 'Content-Encoding': 'compress' } });
    expect(kodlama.kod).toBe(415);
    expect(kodlama.json).toEqual({ ok: false });
    expect(d.sorgular).toEqual([]);
    expect(konsol).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r415: 2 });
  });
});

describe('400 — sabit gövde; zod ayrıntısı, hata iletisi, gövde parçası YOK', () => {
  it.each([
    ['yarım JSON', `{"no": "T261008-5Y9P", "musteri": {"ad": "${ISARET}`],
    ['JSON olmayan metin', `${ISARET} bu JSON değil`],
    ['çıplak dizge (katı kip)', `"${ISARET}"`],
    ['çıplak null', 'null'],
    ['sondaki virgül', `{"not": "${ISARET}",}`],
  ])('bozuk JSON — %s → 400 { ok: false } (500 DEĞİL)', async (_ad, ham) => {
    const d = await kur();
    const y = await iste(d, '/siparis-talebi', { ham });
    expect(y.kod).toBe(400);
    expect(y.json).toEqual({ ok: false });
    expect(y.metin).not.toContain(ISARET);
    expect(d.sorgular).toEqual([]);
    expect(konsol).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r400: 1 });
  });
  it.each([
    ['boş nesne', {}],
    ['dizi', [govde()]],
    ['talep no desene uymuyor', govde({ no: `T261008-${ISARET}` })],
    ['talep no yok', govde({ no: undefined })],
    ['müşteri yok', govde({ musteri: undefined, not: ISARET })],
    ['telefon sayı', govde({ musteri: { ad: ISARET, telefon: 5321234567 } })],
    ['kalem yok', govde({ kalemler: [], not: ISARET })],
    ['adet sıfır', govde({ kalemler: [{ ad: ISARET, adet: 0 }] })],
    ['adet kesirli', govde({ kalemler: [{ ad: ISARET, adet: 1.5 }] })],
    ['adet metin', govde({ kalemler: [{ ad: ISARET, adet: '2' }] })],
    ['fiyat eksi', govde({ kalemler: [{ ad: ISARET, adet: 1, birimFiyat: -1 }] })],
    ['toplam metin', govde({ toplam: ISARET })],
    ['not nesne', govde({ not: { a: ISARET } })],
  ])('şemaya uymayan gövde — %s → 400 { ok: false }; yanıtta yalnız sabit gövde', async (_ad, g) => {
    const d = await kur();
    const y = await iste(d, '/siparis-talebi', { govde: g });
    expect(y.kod).toBe(400);
    expect(y.metin).toBe('{"ok":false}');
    expect(d.sorgular).toEqual([]);
    expect(d.yayinlar).toEqual([]);
    expect(d.bildirimler).toEqual([]);
    expect(konsol).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r400: 1 });
  });
  it.each([
    ['ad yalnız boşluk', { musteri: { ad: '   ', telefon: '0532 123 45 67' } }],
    ['ad yalnız denetim karakteri', { musteri: { ad: k(0x00, 0x1B, 0x2028), telefon: '0532 123 45 67' } }],
    ['telefonda 9 rakam', { musteri: { ad: ISARET, telefon: '532 123 45 6' } }],
    ['kalem adı temizlikten sonra boş', { kalemler: [{ ad: 'boya', adet: 1 }, { ad: ` ${k(0x00)} `, adet: 1 }], not: ISARET }],
  ])('şemadan geçen ama eşleyicinin reddettiği gövde — %s → 400; yazma yok', async (_ad, ustune) => {
    const d = await kur();
    const y = await talep(d, ustune);
    expect(y.kod).toBe(400);
    expect(y.metin).toBe('{"ok":false}');
    expect(d.sorgular).toEqual([]);
    expect(konsol).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r400: 1 });
  });
  it('JSON türünde BOŞ gövde → 400 (ayrıştırıcı boş nesne üretir; şema reddeder)', async () => {
    const d = await kur();
    expect((await iste(d, '/siparis-talebi', { tur: 'application/json' })).kod).toBe(400);
    expect((await iste(d, '/siparis-talebi', { ham: '', tur: 'application/json' })).kod).toBe(400);
    expect(d.sorgular).toEqual([]);
  });
  it('bozuk gövde kiracı çözümlemesini ve havuzu HİÇ tetiklemez', async () => {
    const d = await kur();
    await iste(d, '/siparis-talebi', { govde: {} });
    await iste(d, '/siparis-talebi', { ham: '{' });
    expect(d.sayim).toEqual({ kiraci: 0, havuz: 0, apiLimiter: 2 });
  });
});

describe('413 — 64 KB gövde sınırı (genel ayrıştırıcıdan ÖNCE, zincirin kendi ayrıştırıcısında)', () => {
  /** Tam olarak `bayt` uzunluğunda, GEÇERLİ talep gövdesi (dolgu `not` alanında). */
  const tamBoyda = (bayt: number): string => {
    const bos = JSON.stringify(govde({ not: '' }));
    return JSON.stringify(govde({ not: 'a'.repeat(bayt - Buffer.byteLength(bos)) }));
  };
  it('70 KB geçerli gövde → 413 { ok: false } (201 DEĞİL); yazma yok', async () => {
    const d = await kur();
    const ham = tamBoyda(70 * 1024);
    expect(Buffer.byteLength(ham)).toBe(70 * 1024);
    const y = await iste(d, '/siparis-talebi', { ham });
    expect(y.kod).toBe(413);
    expect(y.json).toEqual({ ok: false });
    expect(d.sorgular).toEqual([]);
    expect(d.sayim.kiraci).toBe(0);
    expect(konsol).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r413: 1 });
  });
  it('sınır TAM 64 KB: 65 536 bayt geçer (kırpılarak yazılır), 65 537 bayt 413', async () => {
    const d = await kur();
    const sigan = await iste(d, '/siparis-talebi', { ham: tamBoyda(65_536) });
    expect(sigan.kod).toBe(201);
    expect(yazilan(d).belge).toMatchObject({ kirpildi: true, not: 'a'.repeat(1000) });
    const tasan = await iste(d, '/siparis-talebi', { ham: tamBoyda(65_537).replace('T261008-5Y9P', no(2)) });
    expect(tasan.kod).toBe(413);
    expect(d.sorgular).toHaveLength(1);
  });
  it('büyük gövde durum ucunda ve bilinmeyen yolda da 413 (aynı zincir)', async () => {
    const d = await kur();
    const ham = JSON.stringify({ dolgu: `${ISARET}${'x'.repeat(70 * 1024)}` });
    expect((await iste(d, '/siparis-durumu', { ham })).kod).toBe(413);
    expect((await iste(d, '/bilinmeyen', { ham })).kod).toBe(413);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r413: 2 });
  });
  it('sıkıştırılmış gövde: sınır AÇILMIŞ boyuta uygulanır (küçük paket, 200 KB içerik → 413)', async () => {
    const d = await kur();
    const paket = new Uint8Array(gzipSync(Buffer.from(JSON.stringify(govde({ not: 'a'.repeat(200_000) })))));
    expect(paket.byteLength).toBeLessThan(2000);
    const y = await iste(d, '/siparis-talebi', { ham: paket, basliklar: { 'Content-Encoding': 'gzip' } });
    expect(y.kod).toBe(413);
    expect(y.json).toEqual({ ok: false });
    expect(d.sorgular).toEqual([]);
  });
});

describe('413 — YAZILAN belge sınırı: gövde sınırının 2 katı (teknik koruma; iş sınırı DEĞİL)', () => {
  const bayt = (metin: string): number => Buffer.byteLength(metin, 'utf8');
  /** Şemanın kabul ettiği EN KISA kalem; eşleyici buna beş alan daha yazar (id, sku, marka, talepFiyat, tedarik). */
  const ASGARI_KALEM = { ad: 'a', adet: 1 };
  /** Aynı kalemin YAZILAN karşılığı (yedi alan). */
  const ASGARI_KALEM_YAZILAN = { id: '', sku: '', ad: 'a', marka: '', adet: 1, talepFiyat: null, tedarik: false };
  /** Zorunlu alanlar + `not`; kalemler dışarıdan. */
  const asgariTalep = (talepNo: string, kalemler: unknown[], not = ''): Record<string, unknown> =>
    ({ no: talepNo, musteri: { ad: 'a', telefon: '5321234567' }, not, kalemler });
  const asgariGovde = (talepNo: string, kalemSayisi: number, not = ''): string =>
    JSON.stringify(asgariTalep(talepNo, Array.from({ length: kalemSayisi }, () => ASGARI_KALEM), not));
  /** `kalem`i yineleyerek 64 KB gövde sınırına SIĞAN en uzun gövde (kalan boşluk bir kalemden kısa). */
  const sinirayaYakin = (kalem: Record<string, unknown>, govdeKur: (kalemler: unknown[]) => unknown): { ham: string; kalemSayisi: number } => {
    const tek = bayt(JSON.stringify(govdeKur([kalem])));
    const kalemBayt = bayt(JSON.stringify(kalem)) + 1; // + virgül
    const kalemSayisi = 1 + Math.floor((65_536 - tek) / kalemBayt);
    const ham = JSON.stringify(govdeKur(Array.from({ length: kalemSayisi }, () => kalem)));
    expect(bayt(ham)).toBeLessThanOrEqual(65_536);
    expect(bayt(ham)).toBeGreaterThan(65_536 - kalemBayt);
    return { ham, kalemSayisi };
  };

  it('asgari kalemli (yalnız `ad` + `adet`), gövde sınırına yakın gövde → 413 { ok: false }; SQL çağrısı 0, yayın 0, bildirim 0', async () => {
    const d = await kur();
    const { ham, kalemSayisi } = sinirayaYakin(ASGARI_KALEM, kalemler => asgariTalep('T261008-5Y9P', kalemler));
    // Ölçü: bu gövde yazılsaydı belge sınırın ÜSTÜNDE olurdu (ölçülen: 3.272 kalem, 65,5 KB gövde → 268,7 KB belge, ×4,1).
    expect(kalemSayisi * (bayt(JSON.stringify(ASGARI_KALEM_YAZILAN)) + 1)).toBeGreaterThan(2 * 65_536);
    const y = await iste(d, '/siparis-talebi', { ham });
    expect(y.kod).toBe(413);
    expect(y.metin).toBe('{"ok":false}');
    expect(d.sorgular).toEqual([]);
    expect(d.yayinlar).toEqual([]);
    expect(d.bildirimler).toEqual([]);
    // Gövde AYRIŞTIRICIDAN ve şemadan geçti (gövde 413'ünde kiracı hiç çözülmez): ret yazılacak belgenin boyundan.
    expect(d.sayim.kiraci).toBe(1);
    expect(konsol).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r413: 1 });
  });

  it.each([
    ['gerçekçi kalem', { id: 'u-1', sku: 'DYO-0001', ad: 'İç cephe boyası 15 L', marka: 'DYO', adet: 2, birimFiyat: 204.99, tedarik: false }],
    ['yedi alan da EN KISA değerle', { id: '', sku: '', ad: 'a', marka: '', adet: 1, birimFiyat: null, tedarik: false }],
  ])('MAĞAZA biçimli (yedi alan da gövdede; %s), gövde sınırına yakın gövde → 201: tavan gerçek talebe ÇARPMAZ', async (_ad, kalem) => {
    const d = await kur();
    const { ham, kalemSayisi } = sinirayaYakin(kalem, kalemler => govde({ kalemler }));
    const y = await iste(d, '/siparis-talebi', { ham });
    expect(y.kod).toBe(201);
    expect(y.metin).toBe('{"ok":true}');
    expect(yazilan(d).belge.kalemler).toHaveLength(kalemSayisi);
    // Mağaza biçiminde belge gövdeyle hemen hemen aynı boydadır (ölçülen çarpan ×1,003) — sınırın yarısında kalır.
    const yazilanBayt = bayt(yazilan(d).json);
    expect(yazilanBayt / bayt(ham)).toBeLessThan(1.05);
    expect(yazilanBayt).toBeLessThan(MAGAZA_BELGE_SINIRI_BAYT);
    expect(d.yayinlar).toHaveLength(1);
    expect(d.bildirimler).toHaveLength(1);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, eklenen: 1 });
  });

  it('sınır TAM gövde sınırının 2 katı: 131 072 baytlık belge YAZILIR, 131 073 baytlık belge 413; ölçü UTF-8 BAYTTIR', async () => {
    const d = await kur();
    // Yoklama: tek kalemli belgenin boyu (sabit alanlar + bir kalem).
    expect((await iste(d, '/siparis-talebi', { ham: asgariGovde(no(1), 1) })).kod).toBe(201);
    expect(yazilan(d, 0).belge.kalemler).toEqual([ASGARI_KALEM_YAZILAN]);
    const tekKalemli = bayt(yazilan(d, 0).json);
    const kalemBayt = bayt(JSON.stringify(ASGARI_KALEM_YAZILAN)) + 1; // + virgül
    // Sınıra bir kalemden az kalana dek kalem; kalan açık `not` ile kapatılır (ASCII: karakter = bayt; `not` sınırı 1000).
    const kalemSayisi = Math.floor((131_072 - tekKalemli) / kalemBayt);
    const dolgu = 131_072 - (tekKalemli + (kalemSayisi - 1) * kalemBayt);
    expect(dolgu).toBeGreaterThanOrEqual(kalemBayt);
    expect(dolgu).toBeLessThan(2 * kalemBayt);

    const sigan = asgariGovde(no(2), kalemSayisi, 'n'.repeat(dolgu));
    expect(bayt(sigan)).toBeLessThan(65_536); // gövde sınırı devrede DEĞİL
    expect((await iste(d, '/siparis-talebi', { ham: sigan })).kod).toBe(201);
    expect(bayt(yazilan(d, 1).json)).toBe(131_072);
    expect(yazilan(d, 1).belge.kalemler).toHaveLength(kalemSayisi);

    const tasan = await iste(d, '/siparis-talebi', { ham: asgariGovde(no(3), kalemSayisi, 'n'.repeat(dolgu + 1)) });
    expect(tasan.kod).toBe(413);
    expect(tasan.json).toEqual({ ok: false });

    // Aynı KARAKTER sayısı (131 072 UTF-16 birimi), bir bayt fazlası: «ş» iki bayttır. Ölçü karakter olsaydı yazılırdı.
    const turkce = asgariGovde(no(4), kalemSayisi, `${'n'.repeat(dolgu - 1)}ş`);
    expect((await iste(d, '/siparis-talebi', { ham: turkce })).kod).toBe(413);

    expect(d.sorgular).toHaveLength(2);
    expect(d.yayinlar).toHaveLength(2);
    expect(d.bildirimler).toHaveLength(2);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, eklenen: 2, r413: 2 });
  });
});

describe('kayıt — tek ekleme, akış olayı ve bildirim yalnız satır GERÇEKTEN eklendiyse', () => {
  it('geçerli talep: SQL birebir, kimlik formülü, doküman, yayın ve bildirim', async () => {
    const d = await kur();
    const y = await talep(d);
    expect(y.kod).toBe(201);
    expect(y.metin).toBe('{"ok":true}');
    expect(d.sorgular).toHaveLength(1);
    expect(d.sorgular[0].sql).toBe(EKLEME_SQL);
    const { id, belge } = yazilan(d);
    expect(d.sorgular[0].params).toEqual(['magazaTalepleri', id, expect.any(String)]);
    expect(id).toMatch(MAGAZA_TALEP_KIMLIK_DESENI);
    expect(id).toBe(magazaTalepKimligi('kiraci-1', 'T261008-5Y9P', '5321234567'));
    expect(belge).toEqual({
      companyId: 'kiraci-1',
      talepNo: 'T261008-5Y9P',
      durum: 'yeni',
      olusturma: '2026-10-08T09:15:30.123Z',
      istemciTarihi: '2026-10-08T09:15:00.000Z',
      musteri: { ad: 'Şükrü Ağaoğlu', firma: 'Iğdır Yapı', telefon: '+90 (532) 123 45 67', eposta: 'sukru@ornek.com.tr', il: 'İstanbul', adres: 'Çiçek Sk. No: 4\nKadıköy', vergi: '1234567890' },
      telefonSon10: '5321234567',
      not: 'Öğleden sonra arayın.',
      kalemler: [
        { id: 'u-1', sku: 'DYO-0001', ad: 'İç cephe boyası 15 L', marka: 'DYO', adet: 2, talepFiyat: 204.99, tedarik: false },
        { id: 'u-2', sku: 'KRB-77', ad: 'Fayans yapıştırıcısı', marka: 'Karbosan', adet: 5, talepFiyat: null, tedarik: true },
      ],
      talepEdilen: { araToplam: 409.98, kdv: 82, toplam: 491.98 },
      fiyatiSorulacakVar: true,
      bildirim: { durum: 'bekliyor', zaman: '2026-10-08T09:15:30.123Z' },
    });
    // Akış olayı: yazılan belgeyle AYNI içerik, kiracı kapsamı açıkça verilmiş.
    expect(d.yayinlar).toEqual([['magazaTalepleri', 'set', id, belge, { cid: 'kiraci-1' }]]);
    expect(d.bildirimler).toEqual([id]);
    expect(d.olaylar).toEqual(['sql', 'yayin', 'bildirim']);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, eklenen: 1 });
    expect(konsol).toEqual([]);
  });
  it('ÇAKIŞMA: aynı talep ikinci kez → tek ekleme, tek yayın, tek bildirim; yanıt BİREBİR aynı 201', async () => {
    const d = await kur();
    const ilk = await talep(d);
    const ikinci = await talep(d, { not: 'ikinci gönderimde değişmiş not' });
    const ucuncu = await talep(d, { musteri: { ad: 'Şükrü Ağaoğlu', telefon: '0 532 123 45 67' } });
    for (const y of [ilk, ikinci, ucuncu]) {
      expect(y.kod).toBe(201);
      expect(y.metin).toBe('{"ok":true}');
    }
    // Üç deneme de AYNI kimlikle eklemeyi dener (çakışmayı veritabanı çözer); mevcut kayda dokunan başka sorgu YOK.
    expect(d.sorgular.map(s => s.sql)).toEqual([EKLEME_SQL, EKLEME_SQL, EKLEME_SQL]);
    expect(new Set(d.sorgular.map(s => s.params[1])).size).toBe(1);
    expect(d.yayinlar).toHaveLength(1);
    expect(d.bildirimler).toEqual([yazilan(d).id]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, eklenen: 1, cakisan: 2 });
  });
  it('başka telefon ya da başka talep no AYRI dokümandır', async () => {
    const d = await kur();
    await talep(d);
    await talep(d, { musteri: { ad: 'Şükrü Ağaoğlu', telefon: '0532 123 45 68' } });
    await talep(d, { no: no(7) });
    expect(new Set(d.sorgular.map(s => s.params[1])).size).toBe(3);
    expect(d.yayinlar).toHaveLength(3);
    expect(d.bildirimler).toHaveLength(3);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, eklenen: 3 });
  });
  it('istemcinin gönderdiği kiracı / durum / bildirim / zaman / `fiyatiSorulacakVar` ALINMAZ', async () => {
    const d = await kur();
    await talep(d, {
      companyId: 'baska-kiraci', durum: 'teyit', olusturma: '2000-01-01T00:00:00.000Z', bildirim: { durum: 'gitti' }, kirpildi: true,
      telefonSon10: '0000000000', fiyatiSorulacakVar: true, kalemler: [{ ad: 'boya', adet: 1, birimFiyat: 10 }],
    });
    const { id, belge } = yazilan(d);
    expect(belge).toMatchObject({ companyId: 'kiraci-1', durum: 'yeni', olusturma: '2026-10-08T09:15:30.123Z', telefonSon10: '5321234567', fiyatiSorulacakVar: false, bildirim: { durum: 'bekliyor' } });
    expect('kirpildi' in belge).toBe(false);
    expect(id).toBe(magazaTalepKimligi('kiraci-1', 'T261008-5Y9P', '5321234567'));
    expect(d.yayinlar[0][4]).toEqual({ cid: 'kiraci-1' });
  });
  it('fiyat / toplam yoksa `null` yazılır (0 DEĞİL); isteğe bağlı metinler boş dizge', async () => {
    const d = await kur();
    const y = await iste(d, '/siparis-talebi', { govde: { no: 'T261008-AAAA', musteri: { ad: 'Ali', telefon: '05321234567' }, kalemler: [{ ad: 'boya', adet: 3 }, { ad: 'numune', adet: 1, birimFiyat: 0 }] } });
    expect(y.kod).toBe(201);
    const { belge, json } = yazilan(d);
    expect(belge.kalemler).toEqual([
      { id: '', sku: '', ad: 'boya', marka: '', adet: 3, talepFiyat: null, tedarik: false },
      { id: '', sku: '', ad: 'numune', marka: '', adet: 1, talepFiyat: 0, tedarik: false },
    ]);
    expect(belge).toMatchObject({ talepEdilen: { araToplam: null, kdv: null, toplam: null }, fiyatiSorulacakVar: true, istemciTarihi: null, not: '' });
    expect(belge.musteri).toEqual({ ad: 'Ali', firma: '', telefon: '05321234567', eposta: '', il: '', adres: '', vergi: '' });
    expect(json).toContain('"talepFiyat":null');
  });
  it('(B3 çiti, kuruş kararı 2026-10-17) kuruştan ince beyan fiyatı (83,3333 · 0,001 · 1,005) REDDEDİLMEZ: 201 ve fiyat AYNEN yazılır — kuruş kuralı yalnız ERP gövdelerinde, müşterinin talebi kaybolmaz', async () => {
    const d = await kur();
    const y = await iste(d, '/siparis-talebi', { govde: {
      no: 'T261008-AAAA', musteri: { ad: 'Ali', telefon: '05321234567' },
      kalemler: [{ ad: 'Saten alçı', adet: 12, birimFiyat: 83.3333 }, { ad: 'Vida', adet: 1000, birimFiyat: 0.001 }, { ad: 'Dübel', adet: 1, birimFiyat: 1.005 }],
    } });
    expect([y.kod, y.metin]).toEqual([201, '{"ok":true}']);
    const { belge } = yazilan(d);
    expect(belge.kalemler.map(k => k.talepFiyat)).toEqual([83.3333, 0.001, 1.005]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, eklenen: 1 });
  });
  it('kırpma: aşan alan REDDEDİLMEZ, kırpılır ve `kirpildi: true` yazılır', async () => {
    const d = await kur();
    const y = await talep(d, { not: 'ğ'.repeat(1500), musteri: { ad: 'ş'.repeat(250), telefon: `0532 123 45 67 ${'9'.repeat(60)}`, il: 'İ'.repeat(81) } });
    expect(y.kod).toBe(201);
    const { belge } = yazilan(d);
    expect(belge.kirpildi).toBe(true);
    expect(belge.not).toBe('ğ'.repeat(1000));
    expect(belge.musteri.ad).toBe('ş'.repeat(200));
    expect(belge.musteri.il).toBe('İ'.repeat(80));
    expect(belge.musteri.telefon).toHaveLength(40);
    // Kimliğin anahtarı KIRPMADAN ÖNCEKİ telefonun son 10 rakamı.
    expect(belge.telefonSon10).toBe('9'.repeat(10));
  });
  it('U+0000, U+2028 / U+2029 ve bölünmüş vekil: temizlenip yazılır; jsonb\'yi düşürecek kaçış SQL parametresinde YOK', async () => {
    const d = await kur();
    // Özel karakterler tel üzerinde JSON KAÇIŞI olarak gider (ham NUL / eşsiz vekil UTF-8'e yazılamaz).
    const ham = JSON.stringify(govde({
      musteri: { ad: 'Ah@NUL@met@LS@Yılmaz@UST@', telefon: '0532@NUL@ 123 45 67', il: 'İz@NUL@mir@PS@Bornova', adres: 'Sokak 1@LS@Kat 2@NUL@\r\nDaire 3@ALT@' },
      not: '@NUL@not@UST@ sonu',
      kalemler: [{ ad: 'bo@NUL@ya@LS@15 L', sku: 'S@NUL@1', adet: 1 }],
    })).replaceAll('@NUL@', '\\u0000').replaceAll('@LS@', '\\u2028').replaceAll('@PS@', '\\u2029').replaceAll('@UST@', '\\ud83d').replaceAll('@ALT@', '\\ude00');
    const y = await iste(d, '/siparis-talebi', { ham });
    expect(y.kod).toBe(201);
    const { json, belge } = yazilan(d);
    const yerTutucu = k(0xFFFD);
    // Tek satırlık alan: satır ayırıcı BOŞLUK; çok satırlı alan (adres): `\n`.
    expect(belge.musteri).toMatchObject({ ad: `Ahmet Yılmaz${yerTutucu}`, telefon: '0532 123 45 67', il: 'İzmir Bornova', adres: `Sokak 1\nKat 2\nDaire 3${yerTutucu}` });
    expect(belge.not).toBe(`not${yerTutucu} sonu`);
    expect(belge.kalemler[0]).toMatchObject({ ad: 'boya 15 L', sku: 'S1' });
    expect(json).not.toMatch(/\\u0000/);
    expect(json).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
    expect(json.isWellFormed()).toBe(true);
    expect([...json].some(c => c === k(0x2028) || c === k(0x2029) || c === k(0x00))).toBe(false);
  });
  it('bildirim YANITTAN ÖNCE beklenir', async () => {
    let birak: () => void = () => {};
    const kapi = new Promise<void>(coz => { birak = coz; });
    const d = await kur({ bildirimIste: () => kapi });
    let bitti = false;
    const soz = talep(d).then(y => { bitti = true; return y; });
    await vi.waitFor(() => { expect(d.bildirimler).toHaveLength(1); });
    await bekle(40);
    expect(bitti).toBe(false);
    birak();
    expect((await soz).kod).toBe(201);
  });
  it('bildirim isteği REDDEDERSE (sözleşme dışı) yanıt yine 201; yakalanmamış ret YOK; günlükte yalnız kod', async () => {
    const yakalanmamis: unknown[] = [];
    const dinleyici = (neden: unknown): void => { yakalanmamis.push(neden); };
    process.on('unhandledRejection', dinleyici);
    try {
      const d = await kur({ bildirimIste: () => Promise.reject(Object.assign(new Error(`kuyruk ${ISARET}`), { code: 'EKUYRUK' })) });
      const y = await talep(d);
      expect(y.kod).toBe(201);
      expect(y.json).toEqual({ ok: true });
      await bekle(30);
      expect(yakalanmamis).toEqual([]);
      expect(konsol).toEqual(['error: [magaza] talep yazıldı, bildirim istenemedi: EKUYRUK']);
      expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, eklenen: 1 });
    } finally {
      process.off('unhandledRejection', dinleyici);
    }
  });
  it('bildirim isteği eşzamanlı FIRLATIRSA da yanıt 201', async () => {
    const d = await kur({ bildirimIste: () => { throw new TypeError(`patladı ${ISARET}`); } });
    expect((await talep(d)).kod).toBe(201);
    expect(konsol).toEqual(['error: [magaza] talep yazıldı, bildirim istenemedi: TypeError']);
  });
  it('akış yayını fırlatırsa yanıt 201 kalır ve bildirim YİNE istenir', async () => {
    const d = await kur({ yayinHatasi: new Error(`akış ${ISARET}`) });
    expect((await talep(d)).kod).toBe(201);
    expect(d.bildirimler).toHaveLength(1);
    expect(konsol).toEqual(['error: [magaza] talep yazıldı, akış olayı yayınlanamadı: Error']);
  });
  it('veritabanı hatası → 500 { ok: false }; günlükte hata NESNESİ değil yalnız kod; yayın ve bildirim yok', async () => {
    // pg hata nesnesinin `detail` / `where` alanı JSON verisinden parça taşır.
    const pgHatasi = Object.assign(new Error(`invalid input syntax for type json: ${ISARET}`), { code: '22P02', detail: `Token "${ISARET}" is invalid.`, where: `JSON data, line 1: {"ad":"${ISARET}"` });
    const d = await kur({ sorguHatasi: pgHatasi });
    const y = await talep(d, { not: ISARET });
    expect(y.kod).toBe(500);
    expect(y.metin).toBe('{"ok":false}');
    expect(d.yayinlar).toEqual([]);
    expect(d.bildirimler).toEqual([]);
    expect(konsol).toEqual(['error: [magaza] sipariş talebi işlenemedi: 22P02']);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r500: 1 });
  });
  it('kodu güvenli desene uymayan hata günlüğe `bilinmiyor` diye düşer (serbest metin kod yerine geçemez)', async () => {
    const d = await kur({ sorguHatasi: { code: `kod ${ISARET} boşluklu`, type: `${ISARET}/x`, name: 'x'.repeat(41) } });
    expect((await talep(d)).kod).toBe(500);
    expect(konsol).toEqual(['error: [magaza] sipariş talebi işlenemedi: bilinmiyor']);
  });
});

describe('kiracı ve havuz — çözülemezse 503 ve YAZMA YOK', () => {
  it.each([
    ['boş dizge', () => Promise.resolve('')],
    ['yalnız boşluk', () => Promise.resolve('   ')],
    ['çözümleyici reddediyor', () => Promise.reject(new Error(`users taraması ${ISARET}`))],
  ])('kiracı yok (%s) → 503 { ok: false }; SQL çağrısı 0; yayın ve bildirim yok', async (_ad, kiraci) => {
    const d = await kur({ kiraci });
    const y = await talep(d, { not: ISARET });
    expect(y.kod).toBe(503);
    expect(y.metin).toBe('{"ok":false}');
    expect(d.sorgular).toEqual([]);
    expect(d.yayinlar).toEqual([]);
    expect(d.bildirimler).toEqual([]);
    expect(konsol).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r503: 1 });
  });
  it('havuz yok → 503; kiracı çözümlenmez bile', async () => {
    const d = await kur({ havuzYok: true });
    const y = await talep(d);
    expect(y.kod).toBe(503);
    expect(y.json).toEqual({ ok: false });
    expect(d.sayim.kiraci).toBe(0);
    expect(d.yayinlar).toEqual([]);
    expect(d.bildirimler).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r503: 1 });
  });
  it('dolu sonuç 60 sn önbellekte: 59 999 ms\'de çözümleyici yeniden ÇAĞRILMAZ, 60 000 ms\'de çağrılır', async () => {
    const d = await kur();
    for (let i = 0; i < 3; i++) expect((await talep(d, { no: no(i) })).kod).toBe(201);
    expect(d.sayim.kiraci).toBe(1);
    d.saat.ms = SAAT_0 + 59_999;
    await talep(d, { no: no(10) });
    expect(d.sayim.kiraci).toBe(1);
    d.saat.ms = SAAT_0 + 60_000;
    await talep(d, { no: no(11) });
    expect(d.sayim.kiraci).toBe(2);
  });
  it('yenilenen kiracı yeni dokümanın damgasına ve kimliğine girer', async () => {
    let cid = 'kiraci-1';
    const d = await kur({ kiraci: () => Promise.resolve(cid) });
    await talep(d);
    cid = 'kiraci-2';
    d.saat.ms = SAAT_0 + 30_000;
    await talep(d, { no: no(1) });
    d.saat.ms = SAAT_0 + 60_000;
    await talep(d, { no: no(2) });
    expect(d.sorgular.map((_, i) => yazilan(d, i).belge.companyId)).toEqual(['kiraci-1', 'kiraci-1', 'kiraci-2']);
    expect(yazilan(d, 2).id).toBe(magazaTalepKimligi('kiraci-2', no(2), '5321234567'));
    expect(d.yayinlar[2][4]).toEqual({ cid: 'kiraci-2' });
  });
  it('boş sonuç EN ÇOK 10 sn önbellekte: 9 999 ms\'de hâlâ 503 (çağrı yok), 10 000 ms\'de yeniden çözülür ve uç açılır', async () => {
    let cid = '';
    const d = await kur({ kiraci: () => Promise.resolve(cid) });
    expect((await talep(d)).kod).toBe(503);
    expect(d.sayim.kiraci).toBe(1);
    cid = 'kiraci-1';
    d.saat.ms = SAAT_0 + 9_999;
    expect((await talep(d)).kod).toBe(503);
    expect(d.sayim.kiraci).toBe(1);
    d.saat.ms = SAAT_0 + 10_000;
    expect((await talep(d)).kod).toBe(201);
    expect(d.sayim.kiraci).toBe(2);
    expect(d.sorgular).toHaveLength(1);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, eklenen: 1, r503: 2 });
  });
  it('reddeden çözümleyici de boş sonuç gibi en çok 10 sn önbelleklenir', async () => {
    let patlasin = true;
    const d = await kur({ kiraci: () => (patlasin ? Promise.reject(new Error('geçici')) : Promise.resolve('kiraci-1')) });
    expect((await talep(d)).kod).toBe(503);
    patlasin = false;
    d.saat.ms = SAAT_0 + 5_000;
    expect((await talep(d)).kod).toBe(503);
    expect(d.sayim.kiraci).toBe(1);
    d.saat.ms = SAAT_0 + 10_000;
    expect((await talep(d)).kod).toBe(201);
  });
  it('eşzamanlı istekler TEK çözümlemeyi paylaşır', async () => {
    let birak: (cid: string) => void = () => {};
    const kapi = new Promise<string>(coz => { birak = coz; });
    const d = await kur({ kiraci: () => kapi });
    const sozler = [1, 2, 3, 4].map(n => talep(d, { no: no(n) }));
    await vi.waitFor(() => { expect(d.sayim.havuz).toBe(4); });
    await bekle(20);
    birak('kiraci-1');
    expect((await Promise.all(sozler)).map(y => y.kod)).toEqual([201, 201, 201, 201]);
    expect(d.sayim.kiraci).toBe(1);
    expect(d.sorgular).toHaveLength(4);
  });
  it('önbellek zincire aittir: yeni zincir kiracıyı yeniden çözer', async () => {
    const d1 = await kur();
    await talep(d1);
    const d2 = await kur();
    await talep(d2);
    expect([d1.sayim.kiraci, d2.sayim.kiraci]).toEqual([1, 1]);
    // afterEach yalnız son düzeneğe bakar; ilkini burada doğrula.
    expect(d1.kacan).toEqual({ sonrakiAraKatman: 0, genelAyristirici: 0, genel404: 0, genelYakalayici: 0 });
  });
});

describe('yayın sonrası sonda değişmezi — scripts/verify-deploy.sh 6. adım, «talep yolu» sondası', () => {
  // Betik yayından sonra BU gövdeyi (`curl -d`, birebir) izinli kökenle yollar ve yanıt koduna bakar:
  //   400 = pg havuzu var ve kiracı çözülüyor · 503 = uç gerçek talepleri DÜŞÜRÜYOR (mağaza yanıtı okumaz — sessiz kayıp).
  // Sonda şu sıraya dayanır: gövde şemaya UYAR, telefonunda 10 rakam YOKTUR; ret şemadan değil eşleyiciden
  // (`talepEsle`), yani havuz ve kiracı denetiminden SONRA gelir. Kayıt yazmaz, e-posta göndermez.
  // Şemaya ileride telefon alt sınırı eklenirse ret kiracıdan ÖNCEYE kayar: kiracı boşken de 400 döner ve sonda
  // sessizce yanlış PASS verir. O gün bu testler kırılır — sonda gövdesi ile bu sabit BİRLİKTE güncellenir.
  const SONDA_GOVDESI = '{"no":"T000000-AAAA","musteri":{"ad":"sonda","telefon":"0"},"kalemler":[{"ad":"sonda","adet":1}]}';

  it('sonda gövdesi şemaya UYAR (ret şemadan gelmez)', () => {
    expect(MagazaSiparisTalebiSchema.safeParse(JSON.parse(SONDA_GOVDESI)).success).toBe(true);
  });
  it('betikteki sonda gövdesi bu sabitle BİREBİR (ikisi ayrı dosyada; yalnız yorumla bağlı kalsaydı biri değişince öbürü bayatlardı)', () => {
    const betik = oku(join(SRC_KOK, '..', 'scripts', 'verify-deploy.sh'));
    expect(betik.split(`-d '${SONDA_GOVDESI}' "$MU/siparis-talebi"`).length - 1).toBe(1);
  });
  it.each<[string, Ayar]>([
    ['kiracı çözülemiyor', { kiraci: () => Promise.resolve('') }],
    ['pg havuzu yok', { havuzYok: true }],
  ])('uç talepleri düşürürken (%s) sonda 503 alır — 400 DEĞİL; SQL çağrısı 0', async (_ad, ayar) => {
    const d = await kur(ayar);
    const y = await iste(d, '/siparis-talebi', { ham: SONDA_GOVDESI });
    expect(y.kod).toBe(503);
    expect(y.metin).toBe('{"ok":false}');
    expect(d.sorgular).toEqual([]);
    expect(d.yayinlar).toEqual([]);
    expect(d.bildirimler).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r503: 1 });
  });
  it('havuz var ve kiracı çözülüyorken sonda 400 alır; SQL çağrısı 0, yayın 0, bildirim 0 (kayıt YAZILMAZ)', async () => {
    const d = await kur();
    const y = await iste(d, '/siparis-talebi', { ham: SONDA_GOVDESI });
    expect(y.kod).toBe(400);
    expect(y.metin).toBe('{"ok":false}');
    // Ret havuz ve kiracı denetiminden SONRA: ikisi de birer kez soruldu.
    expect(d.sayim).toMatchObject({ havuz: 1, kiraci: 1 });
    expect(d.sorgular).toEqual([]);
    expect(d.yayinlar).toEqual([]);
    expect(d.bildirimler).toEqual([]);
    expect(konsol).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r400: 1 });
  });
});

describe('takip ucu — POST /siparis-durumu (dilim 2a, § 4; V6 kalem listesi + teslim işareti)', () => {
  const NO = 'T261008-5Y9P';
  const TELEFON = '0532 123 45 67';
  const KIMLIK = magazaTalepKimligi('kiraci-1', NO, '5321234567');
  /** `MAGAZA_TAKIP_SQL`'in döndürdüğü biçimde satır; `ustune` ile sütun ezilir. */
  const satir = (ustune: Record<string, unknown> = {}): Record<string, unknown> => ({
    durum: 'sevk', aciklama: 'Kargoya verildi', zaman: '2026-10-08T10:00:00.000Z', olusturma: '2026-10-08T09:00:00.000Z',
    kalemler: [
      { sira: 0, ad: 'İç cephe boyası 15 L', marka: 'DYO', adet: 2 },
      { sira: 1, ad: 'Fayans yapıştırıcısı', marka: '', adet: 5 },
    ],
    beyan_sayisi: 2, teyit_kalemleri: null, teyit_sayisi: 0, kalem_teslim: null,
    // (2b) `jsonb_typeof(data->'silindi')`: hiç silinmemiş talepte SQL NULL.
    silindi_turu: null,
    ...ustune,
  });
  const sor = (d: Duzenek, g: Record<string, unknown> = { no: NO, telefon: TELEFON }, o: Istek = {}): Promise<Yanit> =>
    iste(d, '/siparis-durumu', { govde: g, ...o });
  /** Yanıtta ASLA bulunmaması gereken anahtarlar (fiyat, kişisel veri, iç adresleme). */
  const YASAK_ANAHTARLAR = ['sku', 'id', 'anahtar', 'sira', 'tedarik', 'talepFiyat', 'birimFiyat', 'araToplam', 'kdv', 'toplam',
    'musteri', 'not', 'telefonSon10', 'kalemTeslim', 'etiketBasildi', 'bildirim', 'durumGecmisi', 'companyId', 'kim'];
  const anahtarlar = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(anahtarlar)
    : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k2, d2]) => [k2, ...anahtarlar(d2)]) : []);

  it('bulunan talep → 200: aşama panel sözlüğüyle, açıklama, tarih, son güncelleme, kaynak, kalem listesi; `no-store`', async () => {
    const d = await kur({ takip: () => [satir()] });
    const y = await sor(d);
    expect(y.kod).toBe(200);
    expect(y.json).toEqual({
      ok: true, durum: 'sevk', aciklama: 'Kargoya verildi', tarih: '2026-10-08T09:00:00.000Z', guncelleme: '2026-10-08T10:00:00.000Z',
      kaynak: 'beyan',
      kalemler: [{ ad: 'İç cephe boyası 15 L', marka: 'DYO', adet: 2, teslim: false }, { ad: 'Fayans yapıştırıcısı', adet: 5, teslim: false }],
      kalemSayisi: 2,
    });
    expect(y.baslik('cache-control')).toBe('no-store');
    expect(y.baslik('access-control-allow-origin')).toBe(IZINLI);
    // TEK dar okuma: kimlik no + telefonun son 10 hanesinden, kiracı sunucudan.
    expect(d.sorgular).toEqual([{ sql: MAGAZA_TAKIP_SQL, params: [MAGAZA_TALEP_KOLEKSIYONU, KIMLIK, 'kiraci-1'] }]);
    expect(magazaTakipSayaclari()).toEqual({ bulundu: 1, bulunamadi: 0, silindi: 0 });
    expect(magazaSayaclari()).toEqual(SIFIR_SAYACLAR);
    expect(konsol).toEqual([]);
  });
  it('yanıtta SKU / fiyat / tutar / müşteri alanı / iç anahtar YOK (satırda gelse bile basılmaz)', async () => {
    // Sütunlara sızdırılmış fazlalık: işleyici yalnız bildiği alanları okur.
    const sizinti = { sira: 0, ad: 'Boya', marka: 'DYO', adet: 1, sku: 'DYO-0001', talepFiyat: 204.99, id: 'u-1', tedarik: true, anahtar: 'b:0' };
    const d = await kur({ takip: () => [satir({ kalemler: [sizinti], beyan_sayisi: 1, musteri: { ad: 'Şükrü Ağaoğlu' }, telefonSon10: '5321234567', not: 'gizli' })] });
    const y = await sor(d);
    expect(y.kod).toBe(200);
    const bulunan = anahtarlar(y.json);
    for (const yasak of YASAK_ANAHTARLAR) expect(bulunan, yasak).not.toContain(yasak);
    expect(bulunan.sort()).toEqual(['aciklama', 'ad', 'adet', 'durum', 'guncelleme', 'kalemSayisi', 'kalemler', 'kaynak', 'marka', 'ok', 'tarih', 'teslim'].sort());
    for (const metin of ['DYO-0001', '204.99', '204,99', 'Şükrü', '5321234567', 'gizli', 'u-1']) expect(y.metin, metin).not.toContain(metin);
  });
  it('tür daraltma: `ad` dizge değilse kalem ATLANMAZ (`ad: ""`); `marka` dizge değilse / boşsa alan YOK; `adet` sonlu sayı değilse `null`', async () => {
    const d = await kur({ takip: () => [satir({
      kalemler: [
        { sira: 0, ad: 7, marka: 9, adet: '3' },
        { sira: 1, ad: null, marka: null, adet: null },
        { sira: 2, ad: `  ${'ç'.repeat(201)}\n`, marka: `${'ğ'.repeat(61)}`, adet: 1.5 },
        { sira: 3, ad: 'satır\nsonu\tsekme', marka: '   ', adet: 4 },
        'dizge', 42, null,
      ],
      beyan_sayisi: 7,
    })] });
    const y = await sor(d);
    expect((y.json as { kalemler: unknown }).kalemler).toEqual([
      { ad: '', adet: null, teslim: false },
      { ad: '', adet: null, teslim: false },
      { ad: 'ç'.repeat(200), marka: 'ğ'.repeat(60), adet: 1.5, teslim: false },
      { ad: 'satır sonu sekme', adet: 4, teslim: false },
    ]);
    // Nesne olmayan öğe atlanır ama `kalemSayisi` dizinin TAM uzunluğudur (SQL sütunu).
    expect((y.json as { kalemSayisi: number }).kalemSayisi).toBe(7);
  });
  it(`kalem listesi en çok ${MAGAZA_BILDIRIM_KALEM_SINIRI}: 51 kalem → 50 kalem + kalemSayisi 51`, async () => {
    const kalemler = Array.from({ length: 51 }, (_, i) => ({ sira: i, ad: `Kalem ${i}`, marka: '', adet: i + 1 }));
    const d = await kur({ takip: () => [satir({ kalemler, beyan_sayisi: 51 })] });
    const g = (await sor(d)).json as { kalemler: Array<{ ad: string }>; kalemSayisi: number };
    expect(MAGAZA_BILDIRIM_KALEM_SINIRI).toBe(50);
    expect(g.kalemler).toHaveLength(50);
    expect(g.kalemler[49].ad).toBe('Kalem 49');
    expect(g.kalemSayisi).toBe(51);
  });
  it('teslim işareti `magazaKalemTeslimMi`\'den: `teslim` girişi true, `bekliyor` girişi ve girişsiz kalem false; anahtar `b:<sira>` (atılan öğe kaydırmaz)', async () => {
    const d = await kur({ takip: () => [satir({
      // Dizide 1. öğe nesne değildi (SQL attı): kalan kalemlerin `sira`sı 0 ve 2'dir.
      kalemler: [{ sira: 0, ad: 'A', marka: '', adet: 1 }, { sira: 2, ad: 'C', marka: '', adet: 1 }],
      beyan_sayisi: 3,
      kalem_teslim: {
        'b:0': { durum: 'bekliyor', zaman: '2026-10-08T11:00:00.000Z', kim: { uid: 'u1', ad: 'Ayşe' } },
        'b:1': { durum: 'teslim', zaman: '2026-10-08T11:30:00.000Z', kim: { uid: 'u1', ad: 'Ayşe' } },
        'b:2': { durum: 'teslim', zaman: '2026-10-08T12:00:00.000Z', kim: { uid: 'u1', ad: 'Ayşe' } },
      },
    })] });
    const y = await sor(d);
    const g = y.json as { kalemler: Array<{ ad: string; teslim: boolean }>; guncelleme: string };
    expect(g.kalemler.map(k2 => [k2.ad, k2.teslim])).toEqual([['A', false], ['C', true]]);
    // «Son güncelleme» kalem teslim zamanını kapsar (aşama yazımından sonraki işaret); `kim` yanıtta yok.
    expect(g.guncelleme).toBe('2026-10-08T12:00:00.000Z');
    expect(y.metin).not.toContain('Ayşe');
  });
  it('son güncelleme: işaret aşama yazımından ÖNCEYSE `durumZamani`; ikisi de yokken `olusturma`; çöp `kalem_teslim` fırlatmaz', async () => {
    const once = { 'b:0': { durum: 'teslim', zaman: '2026-10-08T09:30:00.000Z', kim: { uid: 'u', ad: 'x' } } };
    const d1 = await kur({ takip: () => [satir({ kalem_teslim: once })] });
    expect(((await sor(d1)).json as { guncelleme: string }).guncelleme).toBe('2026-10-08T10:00:00.000Z');
    const d2 = await kur({ takip: () => [satir({ zaman: null, aciklama: null, kalem_teslim: 'çöp' })] });
    const y2 = await sor(d2);
    expect(y2.kod).toBe(200);
    expect(y2.json).toMatchObject({ tarih: '2026-10-08T09:00:00.000Z', guncelleme: '2026-10-08T09:00:00.000Z' });
    // Açıklama boşsa alan gönderilmez.
    expect(y2.json).not.toHaveProperty('aciklama');
    expect(d1.kacan).toEqual({ sonrakiAraKatman: 0, genelAyristirici: 0, genel404: 0, genelYakalayici: 0 });
  });
  it('`durum` hiçbir kayıtta `yeni` değildir (`alindi`); bilinmeyen saklı değerde alan YOK; kalemler yine döner', async () => {
    const d1 = await kur({ takip: () => [satir({ durum: 'yeni' })] });
    expect((await sor(d1)).json).toMatchObject({ durum: 'alindi' });
    for (const bilinmeyen of ['kargoda', '', null, 7]) {
      const d = await kur({ takip: () => [satir({ durum: bilinmeyen })] });
      const y = await sor(d);
      expect(y.kod).toBe(200);
      expect(y.json).not.toHaveProperty('durum');
      expect((y.json as { kalemler: unknown[] }).kalemler).toHaveLength(2);
    }
  });
  it('kaynak: teyit kalemi varsa (2b) `teyit` — kalemler teyit edilen içerik, işaret teyit anahtarından, `kalemSayisi` teyit sayısı', async () => {
    const d = await kur({ takip: () => [satir({
      teyit_kalemleri: [{ anahtar: 't:0123456789ab', ad: 'Teyitli boya', marka: 'DYO', adet: 3 }, { anahtar: 7, ad: 'Anahtarsız', marka: '', adet: 1 }],
      teyit_sayisi: 2,
      kalem_teslim: { 'b:0': { durum: 'teslim', zaman: '2026-10-08T11:00:00.000Z' }, 't:0123456789ab': { durum: 'teslim', zaman: '2026-10-08T11:00:00.000Z' } },
    })] });
    expect((await sor(d)).json).toMatchObject({
      kaynak: 'teyit', kalemSayisi: 2,
      kalemler: [{ ad: 'Teyitli boya', marka: 'DYO', adet: 3, teslim: true }, { ad: 'Anahtarsız', adet: 1, teslim: false }],
    });
  });
  it('bulunamadı ↔ biçim bozuk: BAYT BAYT aynı yanıt (`404 { ok: false, kod: "bulunamadi" }`), başlıklar da aynı; biçim bozukta SQL YOK', async () => {
    const d = await kur();
    const bulunamadi = await iste(d, '/siparis-durumu', { govde: { no: NO, telefon: TELEFON } });
    const cevaplar = [
      await iste(d, '/siparis-durumu', { govde: { no: 't261008-5y9p', telefon: TELEFON } }),   // küçük harf: sunucu DÖNÜŞTÜRMEZ
      await iste(d, '/siparis-durumu', { govde: { no: 'T261008-5Y9', telefon: TELEFON } }),
      await iste(d, '/siparis-durumu', { govde: { no: NO, telefon: '532 123' } }),             // 10 rakam yok
      await iste(d, '/siparis-durumu', { govde: { no: '', telefon: '' } }),
      await iste(d, '/siparis-durumu', { govde: { no: `${NO} `, telefon: TELEFON } }),
    ];
    expect(bulunamadi.kod).toBe(404);
    expect(bulunamadi.metin).toBe('{"ok":false,"kod":"bulunamadi"}');
    const BASLIKLAR = ['content-type', 'content-length', 'cache-control', 'access-control-allow-origin', 'vary', 'etag'];
    for (const y of cevaplar) {
      expect(y.kod).toBe(404);
      expect(Buffer.from(y.metin).equals(Buffer.from(bulunamadi.metin))).toBe(true);
      for (const ad of BASLIKLAR) expect(y.baslik(ad), ad).toBe(bulunamadi.baslik(ad));
    }
    expect(bulunamadi.baslik('cache-control')).toBe('no-store');
    // Yalnız GERÇEK sorgu veritabanına gider.
    expect(d.sorgular).toHaveLength(1);
    // Sayaç ayrı kümede: biçim bozuk da `bulunamadi`; dilim 1'in `r404`'ü ARTMAZ.
    expect(magazaTakipSayaclari()).toEqual({ bulundu: 0, bulunamadi: 6, silindi: 0 });
    expect(magazaSayaclari()).toEqual(SIFIR_SAYACLAR);
    // Zincirin rota-yok 404'ü `kod`suz kalır (sonda ikisini ayırt eder).
    expect((await iste(d, '/siparis-durumu-yok', { govde: {} })).metin).toBe('{"ok":false}');
  });
  it('(2b, § 10.6) silinmiş talep → `404 { ok: false, kod: "silindi" }` + `no-store`: gövde YALNIZ iki alan (aşama / açıklama / tarih / kalem listesi YOK); bulunamadı gövdesinden FARKLI', async () => {
    // Satır dolu (aşama, açıklama, kalemler, teslim işareti) — silinmiş talebin içeriğinden HİÇBİR şey müşteriye basılmaz.
    const dolu = satir({
      silindi_turu: 'object',
      kalem_teslim: { 'b:0': { durum: 'teslim', zaman: '2026-10-08T11:00:00.000Z', kim: { uid: 'u1', ad: 'Ayşe' } } },
      teyit_kalemleri: [{ anahtar: 't:0123456789ab', ad: 'Teyitli boya', marka: 'DYO', adet: 3 }], teyit_sayisi: 1,
    });
    const d = await kur({ takip: () => [dolu] });
    const y = await sor(d);
    expect(y.kod).toBe(404);
    expect(y.metin).toBe('{"ok":false,"kod":"silindi"}');
    expect(Object.keys(y.json as object)).toEqual(['ok', 'kod']);
    for (const yasak of ['durum', 'aciklama', 'tarih', 'guncelleme', 'kalemler', 'kalemSayisi', 'kaynak', 'Kargoya', 'boya', '2026-10-08']) expect(y.metin, yasak).not.toContain(yasak);
    expect(y.baslik('cache-control')).toBe('no-store');
    expect(y.baslik('access-control-allow-origin')).toBe(IZINLI);
    // Okuma YAPILDI (hüküm satırdan) ve TEK sorgu — silinmiş denetimi için ikinci okuma yok.
    expect(d.sorgular).toEqual([{ sql: MAGAZA_TAKIP_SQL, params: [MAGAZA_TALEP_KOLEKSIYONU, KIMLIK, 'kiraci-1'] }]);
    // Kendi sayacı: `bulundu` / `bulunamadi` ve dilim 1'in `r404`'ü ARTMAZ.
    expect(magazaTakipSayaclari()).toEqual({ bulundu: 0, bulunamadi: 0, silindi: 1 });
    expect(magazaSayaclari()).toEqual(SIFIR_SAYACLAR);
    expect(konsol).toEqual([]);

    // Silinmiş ↔ bulunamadı: durum kodu aynı (404), gövdeler FARKLI (müşteri «silinmiş» ile «bizde yok»u ayırt eder — kullanıcı kararı).
    const bos = await kur();
    const bulunamadi = await sor(bos);
    expect(bulunamadi.kod).toBe(404);
    expect(bulunamadi.metin).toBe('{"ok":false,"kod":"bulunamadi"}');
    expect(Buffer.from(y.metin).equals(Buffer.from(bulunamadi.metin))).toBe(false);
    expect(bulunamadi.baslik('cache-control')).toBe('no-store');
  });
  it('(2b, § 10.6) `silindi_turu` ölçütü yalnız `"object"`: geri alınmış (`"null"`) ve hiç silinmemiş (NULL) talep BULUNUR — 200 ve kalem listesi döner; başka tür de silinmiş SAYILMAZ', async () => {
    for (const tur of ['null', null, undefined, 'string', 'boolean', 'array', 'number']) {
      magazaSayaclariniSifirla();
      const d = await kur({ takip: () => [satir({ silindi_turu: tur })] });
      const y = await sor(d);
      expect(y.kod, String(tur)).toBe(200);
      expect(y.json, String(tur)).toMatchObject({ ok: true, durum: 'sevk', kaynak: 'beyan', kalemSayisi: 2 });
      expect((y.json as { kalemler: unknown[] }).kalemler).toHaveLength(2);
      expect(y.json).not.toHaveProperty('kod');
      expect(magazaTakipSayaclari()).toEqual({ bulundu: 1, bulunamadi: 0, silindi: 0 });
    }
  });
  it('(2b, § 10.6) silinmiş denetimi okumadan SONRADIR: biçim bozuk sorgu veritabanına gitmez (yine `bulunamadi`); havuz / kiracı yokken 503, okuma hatasında 500 — `silindi` DEĞİL', async () => {
    const silinmis = (): Array<Record<string, unknown>> => [satir({ silindi_turu: 'object' })];
    const d = await kur({ takip: silinmis });
    const bozuk = await sor(d, { no: 'T261008-5Y9', telefon: TELEFON });
    expect(bozuk.metin).toBe('{"ok":false,"kod":"bulunamadi"}');
    expect(d.sorgular).toEqual([]);
    expect((await sor(await kur({ takip: silinmis, havuzYok: true }))).kod).toBe(503);
    expect((await sor(await kur({ takip: silinmis, kiraci: () => Promise.resolve('') }))).kod).toBe(503);
    const hata = await sor(await kur({ sorguHatasi: Object.assign(new Error('koptu'), { code: '57P01' }) }));
    expect(hata.kod).toBe(500);
    expect(hata.metin).toBe('{"ok":false}');
    expect(magazaTakipSayaclari()).toEqual({ bulundu: 0, bulunamadi: 1, silindi: 0 });
  });
  it('şemaya uymayan gövde (alan eksik / dizge değil) → 400 { ok: false }; kiracı ve havuz HİÇ sorulmaz', async () => {
    const d = await kur();
    for (const g of [{}, { no: NO }, { telefon: TELEFON }, { no: 7, telefon: TELEFON }, { no: NO, telefon: null }, [NO, TELEFON]]) {
      const y = await iste(d, '/siparis-durumu', { govde: g });
      expect(y.kod, JSON.stringify(g)).toBe(400);
      expect(y.metin).toBe('{"ok":false}');
    }
    expect(d.sayim).toMatchObject({ kiraci: 0, havuz: 0 });
    expect(magazaTakipSayaclari()).toEqual({ bulundu: 0, bulunamadi: 0, silindi: 0 });
  });
  it.each<[string, Ayar]>([
    ['kiracı çözülemiyor', { kiraci: () => Promise.resolve('') }],
    ['pg havuzu yok', { havuzYok: true }],
  ])('%s → 503 { ok: false } (404 DEĞİL: mağaza 404\'ü «talep bize ulaşmamış olabilir» diye gösterir); okuma YOK — biçim bozuk sorguda da', async (_ad, ayar) => {
    const d = await kur(ayar);
    for (const g of [{ no: NO, telefon: TELEFON }, { no: 'bozuk', telefon: '1' }]) {
      const y = await iste(d, '/siparis-durumu', { govde: g });
      expect(y.kod).toBe(503);
      expect(y.metin).toBe('{"ok":false}');
      expect(y.baslik('cache-control')).toBe('no-store');
    }
    expect(d.sorgular).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r503: 2 });
    expect(magazaTakipSayaclari()).toEqual({ bulundu: 0, bulunamadi: 0, silindi: 0 });
  });
  it('okuma hatası → 500 { ok: false } (404 değil); günlükte yalnız kod', async () => {
    const d = await kur({ sorguHatasi: Object.assign(new Error(`bağlantı koptu ${ISARET}`), { code: '57P01', detail: ISARET }) });
    const y = await sor(d);
    expect(y.kod).toBe(500);
    expect(y.metin).toBe('{"ok":false}');
    expect(konsol).toEqual(['error: [magaza] takip sorgusu işlenemedi: 57P01']);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r500: 1 });
    expect(magazaTakipSayaclari()).toEqual({ bulundu: 0, bulunamadi: 0, silindi: 0 });
  });
  it('kiracı dilim 1 ile AYNI önbellekli çözümden: talep + takip + takip → çözümleyici 1 kez', async () => {
    const d = await kur({ takip: () => [satir()] });
    await talep(d);
    await sor(d);
    await sor(d);
    expect(d.sayim.kiraci).toBe(1);
  });
  it('sınırlayıcı: 20 istekten sonra 21. istek 429 (bulunamadı yanıtı da kovaya sayılır); 429 takip sayacına işlenmez', async () => {
    const d = await kur({ durumTavani: 20 });
    const kodlar: number[] = [];
    for (let i = 0; i < 21; i++) kodlar.push((await sor(d)).kod);
    expect(kodlar).toEqual([...Array.from({ length: 20 }, () => 404), 429]);
    expect(magazaTakipSayaclari()).toEqual({ bulundu: 0, bulunamadi: 20, silindi: 0 });
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r429: 1 });
  });
  it('aynı zincir: kökensiz 403, JSON olmayan 415, bozuk JSON 400', async () => {
    const d = await kur();
    expect((await iste(d, '/siparis-durumu', { govde: {}, koken: null })).kod).toBe(403);
    expect((await iste(d, '/siparis-durumu', { ham: '{}', tur: 'text/plain' })).kod).toBe(415);
    const bozuk = await iste(d, '/siparis-durumu', { ham: `{"no": ${ISARET}` });
    expect(bozuk.kod).toBe(400);
    expect(bozuk.json).toEqual({ ok: false });
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r400: 1, r403: 1, r415: 1 });
  });
});

describe('yayın sonrası sonda değişmezi — scripts/verify-deploy.sh 6. adım, «takip ucu» sondası (dilim 2a)', () => {
  // Betik yayından sonra BU gövdeyi (`curl -d`, birebir) izinli kökenle yollar: sabit sahte no hiç var olmadı.
  //   404 + `bulunamadi` = takip ucu canlı, havuz var, kiracı çözülüyor · 503 = havuz / kiracı yok ·
  //   `kod`suz 404 = rota kayıtlı değil · 503 + `hazir-degil` = dilim 1 hâlâ canlıda.
  const SONDA_GOVDESI = '{"no":"T000000-AAAA","telefon":"0000000000"}';

  it('sonda gövdesi şemaya ve biçime UYAR (ret biçimden değil, satırın yokluğundan gelir: okuma yapılır)', async () => {
    expect(MagazaSiparisDurumuSchema.safeParse(JSON.parse(SONDA_GOVDESI)).success).toBe(true);
    const d = await kur();
    const y = await iste(d, '/siparis-durumu', { ham: SONDA_GOVDESI });
    expect(y.kod).toBe(404);
    expect(y.metin).toBe('{"ok":false,"kod":"bulunamadi"}');
    expect(d.sorgular).toHaveLength(1);
    expect(d.sorgular[0].sql).toBe(MAGAZA_TAKIP_SQL);
  });
  it('betikteki sonda gövdesi bu sabitle BİREBİR; betik `bulunamadi` arar, `hazir-degil` beklemez', () => {
    const betik = oku(join(SRC_KOK, '..', 'scripts', 'verify-deploy.sh'));
    expect(betik.split(`-d '${SONDA_GOVDESI}' "$MU/siparis-durumu"`).length - 1).toBe(1);
    expect(betik).toMatch(/\[ "\$M3KOD" = "404" \] && printf '%s' "\$M3" \| grep -q 'bulunamadi'/);
  });
  it.each<[string, Ayar]>([
    ['kiracı çözülemiyor', { kiraci: () => Promise.resolve('') }],
    ['pg havuzu yok', { havuzYok: true }],
  ])('uç çalışamazken (%s) sonda 503 alır — 404 DEĞİL', async (_ad, ayar) => {
    const d = await kur(ayar);
    expect((await iste(d, '/siparis-durumu', { ham: SONDA_GOVDESI })).kod).toBe(503);
  });
});

describe('`/panel` alt zinciri — bağlandığı YER (dilim 2a)', () => {
  it('`/panel` altındaki her istek alt zincire gider: dış köken kapısına, genel sınırlayıcıya, mağaza sayaçlarına ULAŞMAZ', async () => {
    const d = await kur();
    // Büyük harf ve sondaki eğik çizgi de (eşleşmeyi Express yapar; yol metni karşılaştırması yok). Kökensiz istek de:
    // dış köken kapısı 403 vermez — kapı alt zincirin KENDİ işidir.
    const yollar: Array<[string, string, Istek]> = [
      ['GET', '/panel/siparisler', { method: 'GET' }],
      ['GET', '/PANEL/siparisler/', { method: 'GET' }],
      ['POST', '/panel/oturum', { govde: {} }],
      ['OPTIONS', '/panel/siparisler', { method: 'OPTIONS' }],
      ['GET', '/panel', { method: 'GET', koken: null }],
    ];
    for (const [, yol, o] of yollar) {
      const y = await iste(d, yol, o);
      expect(y.json, yol).toEqual({ ok: false, panel: true });
      // Dış kapının başlıkları YAZILMAMIŞ (alt zincir kendi başlıklarını yazar).
      expect(y.baslik('access-control-allow-methods'), yol).toBeNull();
    }
    expect(d.panelIstekleri).toEqual(['GET /siparisler', 'GET /siparisler/', 'POST /oturum', 'OPTIONS /siparisler', 'GET /']);
    expect(d.sayim.apiLimiter).toBe(0);
    expect(magazaSayaclari()).toEqual(SIFIR_SAYACLAR);
  });
  it('`/panel` ile BAŞLAYAN ama alt yol olmayan ad dış zincirde kalır (`/panelx` → zincirin 404\'ü)', async () => {
    const d = await kur();
    expect((await iste(d, '/panelx', { govde: {} })).metin).toBe('{"ok":false}');
    expect(d.panelIstekleri).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r404: 1 });
  });
});

describe('zincir içi 404 — /api/magaza altındaki her başka yol', () => {
  it('bilinmeyen alt yol → 404 { ok: false } (genel 404\'ün gövdesi DEĞİL); genel 404\'e düşmez', async () => {
    const d = await kur();
    for (const yol of ['/bilinmeyen', '/bayi/giris', '/', '/siparis-talebi/ek', '/siparis-talebix']) {
      const y = await iste(d, yol, { govde: govde() });
      expect(y.kod, yol).toBe(404);
      expect(y.metin, yol).toBe('{"ok":false}');
    }
    expect(d.sorgular).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r404: 5 });
  });
  it('rota yolunda POST dışı yöntem → 404', async () => {
    const d = await kur();
    for (const method of ['GET', 'DELETE']) {
      expect((await iste(d, '/siparis-talebi', { method })).kod, method).toBe(404);
      expect((await iste(d, '/siparis-durumu', { method })).kod, method).toBe(404);
    }
    expect((await iste(d, '/siparis-talebi', { method: 'PUT', govde: govde() })).kod).toBe(404);
    expect(d.sorgular).toEqual([]);
  });
});

describe('sınırlayıcılar — bağlamla gelir; talep ve durum AYRI kova', () => {
  it('talep kovası dolunca durum kovası etkilenmez (ve tersi); 429 gövdesi sabit, köken başlığı duruyor', async () => {
    const d = await kur({ talepTavani: 2, durumTavani: 3 });
    expect((await talep(d, { no: no(1) })).baslik('ratelimit-remaining')).toBe('1');
    expect((await talep(d, { no: no(2) })).baslik('ratelimit-remaining')).toBe('0');
    const dolu = await talep(d, { no: no(3) });
    expect(dolu.kod).toBe(429);
    expect(dolu.metin).toBe('{"ok":false}');
    expect(dolu.baslik('access-control-allow-origin')).toBe(IZINLI);
    // Durum kovası hiç tüketilmemiş.
    const durumlar = [];
    for (let i = 0; i < 4; i++) durumlar.push(await iste(d, '/siparis-durumu', { govde: {} }));
    expect(durumlar.map(y => y.kod)).toEqual([400, 400, 400, 429]);
    expect(durumlar[0].baslik('ratelimit-remaining')).toBe('2');
    expect(durumlar[3].metin).toBe('{"ok":false}');
    expect(d.sorgular).toHaveLength(2);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, eklenen: 2, r429: 2, r400: 3 });
  });
  it('her sınırlayıcı zincire BİR kez bağlı: tavan 3 ise tam 3 istek geçer', async () => {
    const d = await kur({ talepTavani: 3, durumTavani: 3 });
    const talepler = [];
    for (let i = 0; i < 4; i++) talepler.push((await talep(d, { no: no(i) })).kod);
    expect(talepler).toEqual([201, 201, 201, 429]);
    const durumlar = [];
    for (let i = 0; i < 4; i++) durumlar.push((await iste(d, '/siparis-durumu', { govde: {} })).kod);
    expect(durumlar).toEqual([400, 400, 400, 429]);
  });
  it('sınırlayıcı 415 denetiminden ve ayrıştırıcıdan ÖNCE: reddedilen gövdeler de kovadan düşer', async () => {
    const d = await kur({ talepTavani: 3 });
    expect((await talep(d, {}, { tur: 'text/plain' })).kod).toBe(415);
    expect((await iste(d, '/siparis-talebi', { ham: '{' })).kod).toBe(400);
    expect((await iste(d, '/siparis-talebi', { ham: JSON.stringify({ dolgu: 'x'.repeat(70 * 1024) }) })).kod).toBe(413);
    expect((await talep(d)).kod).toBe(429);
    expect(d.sorgular).toEqual([]);
  });
  it('bilinmeyen alt yol mağaza kovalarına sayılmaz (yalnız genel sınırlayıcıya)', async () => {
    const d = await kur({ talepTavani: 1, durumTavani: 1 });
    for (let i = 0; i < 3; i++) expect((await iste(d, '/bilinmeyen', { govde: {} })).baslik('ratelimit-remaining')).toBeNull();
    expect(d.sayim.apiLimiter).toBe(3);
    expect((await talep(d)).kod).toBe(201);
  });
  it('genel sınırlayıcı mağaza sınırlayıcılarından ÖNCE: o reddederse mağaza kovası tüketilmez, yazma olmaz', async () => {
    let kapali = true;
    const d = await kur({ talepTavani: 1, apiLimiter: (_istek, yanit, sonraki) => { if (kapali) yanit.status(429).json({ error: 'genel' }); else sonraki(); } });
    for (let i = 0; i < 3; i++) {
      const y = await talep(d);
      expect(y.json).toEqual({ error: 'genel' });
      expect(y.baslik('ratelimit-remaining')).toBeNull();
      // Köken kapısı genel sınırlayıcıdan ÖNCE: onun 429'u da köken başlığı taşır.
      expect(y.baslik('access-control-allow-origin')).toBe(IZINLI);
    }
    kapali = false;
    expect((await talep(d)).kod).toBe(201);
    expect(d.sorgular).toHaveLength(1);
  });
  it('magaza429: r429 sayacını artırır, sabit 429 { ok: false } döndürür', () => {
    const cagrilar: unknown[] = [];
    const yanit = { status(kod: number) { cagrilar.push(kod); return yanit; }, json(g: unknown) { cagrilar.push(g); return yanit; } };
    magaza429({} as Request, yanit as unknown as Response);
    magaza429({} as Request, yanit as unknown as Response);
    expect(cagrilar).toEqual([429, { ok: false }, 429, { ok: false }]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r429: 2 });
  });
});

describe('zincir içi hata yakalayıcı — hata genel yakalayıcıya ÇIKMAZ', () => {
  const firlatan = (hata: unknown): RequestHandler => (_istek, _yanit, sonraki) => { sonraki(hata); };
  it('durum kodu taşımayan hata → 500 { ok: false }; günlükte yalnız sınıf adı / kod', async () => {
    const d = await kur({ apiLimiter: firlatan(new RangeError(`depo ${ISARET}`)) });
    const y = await talep(d);
    expect(y.kod).toBe(500);
    expect(y.metin).toBe('{"ok":false}');
    expect(konsol).toEqual(['error: [magaza] zincir hatası: RangeError']);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r500: 1 });
  });
  it('eşzamanlı fırlatılan hata da zincirde kalır', async () => {
    const d = await kur({ apiLimiter: () => { throw Object.assign(new Error(ISARET), { code: 'ESINIR' }); } });
    expect((await talep(d)).kod).toBe(500);
    expect(konsol).toEqual(['error: [magaza] zincir hatası: ESINIR']);
  });
  it.each([
    [400, 'r400'], [403, 'r403'], [404, 'r404'], [413, 'r413'], [415, 'r415'], [429, 'r429'],
  ])('`err.status` %i → aynı kod, sabit gövde, kendi sayacı; günlük YOK', async (durum, sayac) => {
    const d = await kur({ apiLimiter: firlatan(Object.assign(new Error(ISARET), { status: durum, body: ISARET, type: 'entity.parse.failed' })) });
    const y = await talep(d);
    expect(y.kod).toBe(durum);
    expect(y.metin).toBe('{"ok":false}');
    expect(konsol).toEqual([]);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, [sayac]: 1 });
  });
  it('kendi sayacı olmayan 4xx: kod AYNEN döner, «400» sayacına işlenir', async () => {
    const d = await kur({ apiLimiter: firlatan(Object.assign(new Error('x'), { status: 422 })) });
    expect((await talep(d)).kod).toBe(422);
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r400: 1 });
  });
  it.each([
    ['5xx', 503], ['2xx', 200], ['metin', '400'], ['kesirli', 400.5], ['NaN', Number.NaN], ['600', 600], ['399', 399],
  ])('4xx olmayan `err.status` (%s) → 500', async (_ad, durum) => {
    const d = await kur({ apiLimiter: firlatan(Object.assign(new Error('x'), { status: durum })) });
    const y = await talep(d);
    expect(y.kod).toBe(500);
    expect(y.metin).toBe('{"ok":false}');
    expect(magazaSayaclari()).toEqual({ ...SIFIR_SAYACLAR, r500: 1 });
  });
  it('Error olmayan değer fırlatılırsa da 500 ve sabit günlük', async () => {
    const d = await kur({ apiLimiter: firlatan(`dizge ${ISARET}`) });
    expect((await talep(d)).kod).toBe(500);
    expect(konsol).toEqual(['error: [magaza] zincir hatası: bilinmiyor']);
  });
});

describe('sayaçlar', () => {
  it('anahtarlar SABİT ve sıfırdan başlar; dönen nesne kopyadır', () => {
    expect(magazaSayaclari()).toEqual(SIFIR_SAYACLAR);
    expect(Object.keys(magazaSayaclari())).toEqual(['eklenen', 'cakisan', 'r400', 'r403', 'r404', 'r413', 'r415', 'r429', 'r500', 'r503']);
    const kopya = magazaSayaclari() as Record<string, number>;
    kopya.eklenen = 99;
    expect(magazaSayaclari().eklenen).toBe(0);
  });
  it('karışık trafik: her sonuç kendi sayacına; OPTIONS sayılmaz; zincirler sayaçları PAYLAŞIR (modül düzeyi)', async () => {
    const d = await kur({ talepTavani: 6 });
    await talep(d);                                              // eklenen
    await talep(d);                                              // çakışan
    await talep(d, {}, { koken: IZINSIZ });                      // 403
    await talep(d, {}, { tur: 'text/plain' });                   // 415
    await iste(d, '/siparis-talebi', { ham: '{' });              // 400
    await iste(d, '/siparis-talebi', { govde: {} });             // 400
    await iste(d, '/siparis-talebi', { ham: JSON.stringify({ dolgu: 'x'.repeat(70 * 1024) }) }); // 413
    await talep(d, { no: no(1) });                               // 429 (kova: 6)
    await iste(d, '/yok', { govde: {} });                        // 404
    await iste(d, '/siparis-durumu', { govde: {} });             // 400 (takip şeması; dilim 1'de sabit 503'tü)
    await iste(d, '/siparis-durumu', { govde: { no: 'T261008-5Y9P', telefon: '0532 123 45 67' } }); // 404 bulunamadi → takip sayacı (r404 DEĞİL)
    await iste(d, '/siparis-talebi', { method: 'OPTIONS' });     // sayılmaz
    const d2 = await kur({ havuzYok: true });
    await talep(d2);                                             // 503
    expect(magazaSayaclari()).toEqual({ eklenen: 1, cakisan: 1, r400: 3, r403: 1, r404: 1, r413: 1, r415: 1, r429: 1, r500: 0, r503: 1 });
    expect(magazaTakipSayaclari()).toEqual({ bulundu: 0, bulunamadi: 1, silindi: 0 });
    expect(d.kacan).toEqual({ sonrakiAraKatman: 0, genelAyristirici: 0, genel404: 0, genelYakalayici: 0 });
    magazaSayaclariniSifirla();
    expect(magazaSayaclari()).toEqual(SIFIR_SAYACLAR);
    expect(magazaTakipSayaclari()).toEqual({ bulundu: 0, bulunamadi: 0, silindi: 0 });
  });
  it('takip sayaçları AYRI kümedir: anahtarlar sabit, dönen nesne kopya; `magazaSayaclari()` anahtarlarına karışmaz', () => {
    // Dilim 2b: üçüncü anahtar `silindi` (silinmiş talebe gelen sorgu) — bilerek değişen çit; `magazaSayaclari()` / `magazaPanelSayaclari()` değişmez.
    expect(Object.keys(magazaTakipSayaclari())).toEqual(['bulundu', 'bulunamadi', 'silindi']);
    const kopya = magazaTakipSayaclari() as Record<string, number>;
    kopya.bulundu = 99;
    kopya.silindi = 99;
    expect(magazaTakipSayaclari().bulundu).toBe(0);
    expect(magazaTakipSayaclari().silindi).toBe(0);
    expect(Object.keys(magazaSayaclari())).not.toContain('bulundu');
    expect(Object.keys(magazaSayaclari())).not.toContain('silindi');
  });
});

describe('kaynak çiti — magazaRoutes.ts', () => {
  const YOL = join(SRC_KOK, 'server', 'routes', 'magazaRoutes.ts');
  const satirlar = kodSatirlari(YOL).map(s => s.kod);
  const kod = satirlar.join('\n');
  it('kayıt sırası SABİT: panel alt zinciri → köken → genel sınırlayıcı → mağaza sınırlayıcıları → 415 → 64 KB → rotalar → 404 → hata', () => {
    const kayitlar = satirlar.map(s => s.trim()).filter(s => /^r\.\w+\(/.test(s));
    expect(kayitlar).toEqual([
      // Dilim 2a: `/panel` alt zinciri köken kapısından ve genel sınırlayıcıdan ÖNCE; bağlamla gelir (bu modül kurmaz).
      "r.use('/panel', C.panelZinciri);",
      'r.use(kokenKapisi);',
      'r.use(C.apiLimiter);',
      "r.use('/siparis-talebi', C.talepSinirlayici);",
      "r.use('/siparis-durumu', C.durumSinirlayici);",
      'r.use(jsonDegilse415);',
      'r.use(express.json({ limit: MAGAZA_GOVDE_SINIRI_BAYT }));',
      "r.post('/siparis-talebi', siparisTalebi);",
      "r.post('/siparis-durumu', siparisDurumu);",
      'r.use(bulunamadi);',
      'r.use(hataYakalayici);',
    ]);
    // Tek yönlendirici (panel alt zinciri AYRI modülde kurulur), tek ayrıştırıcı; `app.` üzerinden kayıt yok.
    expect(kod.match(/\bRouter\(/g)).toHaveLength(1);
    expect(kod.match(/C\.panelZinciri\b/g)).toHaveLength(1);
    // Alt zincire yönlendirme yol METNİYLE yapılmaz (iki kez yaşanmış arıza sınıfı).
    expect(kod).not.toMatch(/req\.(path|originalUrl|url|baseUrl)\b/);
    expect(kod.match(/express\.(json|urlencoded|text|raw)\(/g)).toEqual(['express.json(']);
    expect(kod).not.toMatch(/\bapp\.\w+\(/);
    // Hata yakalayıcı DÖRT parametreli (Express onu parametre sayısından tanır) ve `next(err)` çağırmaz.
    expect(kod).toContain('const hataYakalayici = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {');
    expect(kod).not.toMatch(/\b_?next\(\s*(err|e|hata)\b/);
  });
  it('modül sınırlayıcı KURMAZ: `express-rate-limit` içe aktarımı ve `rateLimit(` çağrısı YOK', () => {
    expect(oku(YOL)).not.toContain('express-rate-limit');
    expect(kod).not.toMatch(/\brateLimit\s*\(/);
    expect(kod.match(/C\.(talepSinirlayici|durumSinirlayici|apiLimiter)\b/g)).toEqual(['C.apiLimiter', 'C.talepSinirlayici', 'C.durumSinirlayici']);
  });
  it('içe aktarımlar: yalnız express, ortak sözleşme, saf eşleyici, ekleme sorgusu, kalem sınırı, şema (server.ts / pgShim / bekçi / panel modülü YOK)', () => {
    expect(kod.match(/^import .*$/gm)).toEqual([
      "import express, { Router } from 'express';",
      "import type { NextFunction, Request, RequestHandler, Response } from 'express';",
      // Dilim 2a (takip ucu): talep no deseni, aşama → panel sözlüğü, kalem teslim işareti ve «son güncelleme» ORTAK işlevlerden.
      "import { MAGAZA_TALEP_KOLEKSIYONU, MAGAZA_TALEP_NO_DESENI, magazaAsamasiMi, magazaGuncellemeZamani, magazaKalemTeslimMi, panelDurumuna } from '../../lib/magazaTalep.js';",
      "import { MAGAZA_BILDIRIM_KALEM_SINIRI } from '../kanal/magazaBildirim.js';",
      "import { MAGAZA_METIN_SINIRLARI, magazaMetniKirp, magazaMetniTemizle, magazaTalepKimligi, talepEsle, telefonSon10 } from '../kanal/magazaTalep.js';",
      // Dilim 2b: ekleme sorgusu ortak modülde (ERP'deki elle talep AYNI sabiti kullanır) — bilerek değişen çit.
      "import { EKLEME_SQL } from '../kanal/magazaTalepSql.js';",
      "import { MagazaSiparisDurumuSchema, MagazaSiparisTalebiSchema } from '../schemas.js';",
    ]);
    expect(kod).not.toMatch(/\brequire\(|\bimport\(/);
    expect(kod).not.toMatch(/pgShim|opsWatchdog|magazaPanelZinciri|magazaErpRoutes|magazaDurum/);
    // Kopya karşılaştırma yok: teslim işareti ortak işlevden okunur.
    expect(kod).not.toMatch(/durum === 'teslim'/);
  });
  it('doğrulama: ortak `validate()` KULLANILMAZ; kendi `safeParse`; yanıt gövdeleri sabit üç biçim + takip yanıtı', () => {
    expect(kod).not.toMatch(/\bvalidate\(/);
    // Dilim 2a: talep şeması + takip şeması.
    expect(kod.match(/\.safeParse\(/g)).toHaveLength(2);
    const govdeler = [...kod.matchAll(/res\.status\([^)]*\)\.json\(([^)]*)\)/g)].map(m => m[1]);
    // `yanit` = bulunan talebin dar yanıtı (`takipYaniti`); `hazir-degil` gövdesi kalktı, yerine `bulunamadi` geldi.
    // Dilim 2b: + silinmiş talebin AYRI gövdesi `{ ok: false, kod: 'silindi' }` (bilerek değişen çit).
    expect([...new Set(govdeler)].sort()).toEqual(["yanit", "{ ok: false }", "{ ok: false, kod: 'bulunamadi' }", "{ ok: false, kod: 'silindi' }", "{ ok: true }"].sort());
    expect(kod).not.toContain('hazir-degil');
    // `bulunamadi` gövdesi TEK yerde üretilir (bulunamadı ile biçim bozuk aynı işlevden — bayt bayt aynı yanıt).
    expect(govdeler.filter(g => g === "{ ok: false, kod: 'bulunamadi' }")).toHaveLength(1);
    expect(kod.match(/takipBulunamadi\(res\)/g)).toHaveLength(2);
    // `silindi` gövdesi de TEK yerde ve `takipBulunamadi`'den GEÇMEZ; hüküm dar okumanın `silindi_turu` sütunundan (`'object'`).
    expect(govdeler.filter(g => g === "{ ok: false, kod: 'silindi' }")).toHaveLength(1);
    expect(kod.match(/satir\.silindi_turu === 'object'/g)).toHaveLength(1);
    expect(kod).not.toMatch(/silindi_turu (!==|===) (null|undefined)|silindi_turu == /);
    // Başka yanıt yolu yok: her `.json(` ya yukarıdakilerden biri ya da ayrıştırıcı.
    expect((kod.match(/\.json\(/g) ?? []).length).toBe(govdeler.length + 1);
    expect(kod).not.toMatch(/res\.(send|write|sendFile|render|redirect)\(/);
    expect(kod).not.toMatch(/\.(issues|errors|flatten|format)\b/);
  });
  it('günlük: her console çağrısı sabit metin + `hataKodu(…)`; hata nesnesinin iletisi / gövdesi / ayrıntısı OKUNMAZ', () => {
    const konsolSatirlari = satirlar.map(s => s.trim()).filter(s => /\bconsole\./.test(s));
    expect(konsolSatirlari.length).toBeGreaterThan(0);
    for (const s of konsolSatirlari) expect(s).toMatch(/^console\.error\('\[magaza\] [^'$`]+:', hataKodu\((e|err)\)\);$/);
    expect(kod).not.toMatch(/\.(message|stack|detail|where|cause)\b/);
    expect(kod).not.toMatch(/\b(err|e|hata)\.body\b/);
    expect(kod).not.toMatch(/JSON\.stringify\((e|err|hata|req)\b/);
  });
  it('yazma yolu: tek ham ekleme + takip ucunun TEK dar okuması; `adminDb` / `pgServerTimestamp` / UPDATE / DELETE yok', () => {
    // Dilim 2b: `INSERT` metni `kanal/magazaTalepSql.ts`'e TAŞINDI (elle talep aynı sabiti kullanır); rota sabiti içe aktarır,
    // kendi kopyasını TANIMLAMAZ — metin birebir dilim 1 metnidir.
    expect(TASINAN_EKLEME_SQL).toBe(EKLEME_SQL);
    expect(kod).not.toMatch(/const EKLEME_SQL\b|INSERT INTO/);
    const sqlKodu = kodSatirlari(join(SRC_KOK, 'server', 'kanal', 'magazaTalepSql.ts')).map(s => s.kod).join('\n');
    expect(sqlKodu).toContain(`export const EKLEME_SQL = '${EKLEME_SQL}';`);
    expect(sqlKodu).not.toMatch(/^import /m);
    // Dilim 2a: ekleme + takip okuması (1 → 2; bilerek değişen çit). Başka sorgu yok — 2b bu sayıyı DEĞİŞTİRMEZ.
    expect(kod.match(/\.query\(/g)).toHaveLength(2);
    expect(kod).toContain('await havuz.query(MAGAZA_TAKIP_SQL, [MAGAZA_TALEP_KOLEKSIYONU, magazaTalepKimligi(cid, cozum.data.no, son10), cid]);');
    expect(kod).not.toMatch(/adminDb|pgServerTimestamp|UPDATE |DELETE /);
    expect(kod).toContain("C.broadcastDocChange(MAGAZA_TALEP_KOLEKSIYONU, 'set', esleme.id, esleme.belge, { cid });");
  });
  it('boyut sınırları: gövde 64 KB; belge sınırı gövde sınırından TÜRETİLİR (ikinci bir sayı YOK) ve yazmadan ÖNCE denetlenir', () => {
    expect(MAGAZA_GOVDE_SINIRI_BAYT).toBe(65_536);
    expect(MAGAZA_BELGE_SINIRI_BAYT).toBe(131_072);
    expect(kod).toContain('export const MAGAZA_GOVDE_SINIRI_BAYT = 64 * 1024;');
    expect(kod).toContain('export const MAGAZA_BELGE_SINIRI_BAYT = 2 * MAGAZA_GOVDE_SINIRI_BAYT;');
    // Sınır başka bir sayı / dizgeyle YAZILMAZ: gövde sınırı değişince belge sınırı kendiliğinden izler.
    expect(kod.match(/\b64 \* 1024\b/g)).toHaveLength(1);
    expect(kod).not.toMatch(/\d\s*kb\b|65_?536|131_?072|\b128\b/i);
    expect(kod.match(/\bMAGAZA_GOVDE_SINIRI_BAYT\b/g)).toHaveLength(3); // tanım, türetme, ayrıştırıcı
    expect(kod.match(/\bMAGAZA_BELGE_SINIRI_BAYT\b/g)).toHaveLength(2); // tanım, denetim
    // Ölçülen metin yazılan metnin KENDİSİDİR (belge bir kez metne çevrilir) ve denetim eklemeden ÖNCE gelir.
    expect(kod.match(/JSON\.stringify\(/g)).toHaveLength(1);
    const denetim = kod.indexOf("if (Buffer.byteLength(yazilacak, 'utf8') > MAGAZA_BELGE_SINIRI_BAYT) { reddet(res, 413); return; }");
    const ekleme = kod.indexOf('await havuz.query(EKLEME_SQL, [MAGAZA_TALEP_KOLEKSIYONU, esleme.id, yazilacak]);');
    expect(denetim).toBeGreaterThan(-1);
    expect(ekleme).toBeGreaterThan(denetim);
  });
  it('takip ucunun dar okuması: TEK SELECT; kalemler SQL\'de üç alana iner; müşteri / tutar / bildirim / geçmiş sütunu YOK', () => {
    expect(MAGAZA_TAKIP_SQL.match(/\bSELECT\b/g)).toHaveLength(3);   // dış SELECT + iki kalem alt sorgusu (tek ifade)
    expect(MAGAZA_TAKIP_SQL).toMatch(/^SELECT data->>'durum' AS durum, data->>'durumAciklama' AS aciklama, data->>'durumZamani' AS zaman, data->>'olusturma' AS olusturma, /);
    expect(MAGAZA_TAKIP_SQL).toMatch(/ FROM docs WHERE coll = \$1 AND id = \$2 AND data->>'companyId' = \$3$/);
    for (const var_ of ["data->'kalemler'", "data->'teyit'->'kalemler'", "data->'kalemTeslim' AS kalem_teslim", 'AS beyan_sayisi', 'AS teyit_sayisi']) expect(MAGAZA_TAKIP_SQL, var_).toContain(var_);
    // Yalnız dizi tipinde açılır (`CASE` çiti) ve nesne olmayan öğe belleğe gelmez; beyan kalemi dizideki yerini taşır.
    expect(MAGAZA_TAKIP_SQL.match(/CASE WHEN jsonb_typeof\(data->'kalemler'\) = 'array'/g)).toHaveLength(2);
    expect(MAGAZA_TAKIP_SQL.match(/WHERE jsonb_typeof\(e\.k\) = 'object'/g)).toHaveLength(2);
    expect(MAGAZA_TAKIP_SQL).toContain("jsonb_build_object('sira', e.sira - 1, 'ad', e.k->'ad', 'marka', e.k->'marka', 'adet', e.k->'adet')");
    expect(MAGAZA_TAKIP_SQL).toContain("jsonb_build_object('anahtar', e.k->'anahtar', 'ad', e.k->'ad', 'marka', e.k->'marka', 'adet', e.k->'adet')");
    // Dilim 2b (§ 10.6): `silindi`nin yalnız TÜRÜ okunur — aynı TEK `SELECT`'e sütun (yeni sorgu yok); silen / zaman / kanal
    // (personel bilgisi) belleğe gelmez; `IS NULL` karşılaştırması YOK (JSON `null` = geri alınmış ile yokluğu karıştırırdı).
    expect(MAGAZA_TAKIP_SQL).toContain(", data->'kalemTeslim' AS kalem_teslim, jsonb_typeof(data->'silindi') AS silindi_turu FROM docs WHERE ");
    expect(MAGAZA_TAKIP_SQL.match(/silindi/g)).toHaveLength(2);
    expect(MAGAZA_TAKIP_SQL).not.toMatch(/data->'silindi' IS|data->'silindi'->/);
    // Fiyat, SKU, kişisel veri, bildirim, geçmiş: sütun da alt alan da YOK.
    expect(MAGAZA_TAKIP_SQL).not.toMatch(/musteri|talepEdilen|bildirim|durumGecmisi|telefon|'sku'|'id'|talepFiyat|tedarik|'not'|etiketBasildi|iptalOncesi/);
    expect(MAGAZA_TAKIP_SQL).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b|;|data\s+AS\b|SELECT \*|, data,/);
  });
  it('kiracı önbelleği süreleri: dolu 60 sn, boş 10 sn', () => {
    expect(kod).toContain('const KIRACI_DOLU_MS = 60_000;');
    expect(kod).toContain('const KIRACI_BOS_MS = 10_000;');
  });
  it('köken: `Allow-Credentials` ve joker köken yazılmaz', () => {
    expect(kod).not.toMatch(/Allow-Credentials/i);
    expect(kod).not.toMatch(/Access-Control-Allow-Origin',\s*'\*'/);
    expect(kod).toContain("res.setHeader('Access-Control-Allow-Origin', koken);");
  });
  it('sayısal varsayılan ve harf dönüşümü yok; tip kaçağı yok', () => {
    expect(kod).not.toMatch(/(\?\?|\|\|)\s*0\b/);
    expect(kod).not.toMatch(/toUpperCase|toLowerCase|toLocaleUpperCase|toLocaleLowerCase|\.normalize\(/);
    expect(kod).not.toMatch(/\bas any\b|@ts-ignore|@ts-expect-error/);
    expect(kod).not.toMatch(/(^|[^A-Za-z.])isFinite\(/);
  });
});
