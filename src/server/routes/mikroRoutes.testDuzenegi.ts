/**
 * mikroRoutes.testDuzenegi.ts — Mikro rota testleri için PAYLAŞILAN düzenek
 * (Faz 3 3/n hazırlık, 2026-09-19). TEST-ONLY: uygulama kodu bu dosyayı import ETMEZ.
 *
 * NEDEN: Düzenek `mikroRoutes.import.test.ts` içinde yaşıyordu (sahte adminDb, sahte
 * app, bağlam `C`, istek/yanıt sahteleri — ~70 satır). Faz 3 3/n'de dört gövde grubu
 * PARALEL yazılacak; her biri bu düzeneği kopyalasaydı dört ayrı sürüm bayatlar ve
 * "yabancı kiracıya yazılmadı", "bilinmeyen alan 0 yazılmadı" gibi ORTAK iddialar
 * gruptan gruba farklı sahteler üstünde koşardı. Tek kaynak burada.
 *
 * ⚠️ vi.mock BURAYA KONULAMAZ. vitest `vi.mock` çağrılarını **test dosyasının**
 * tepesine hoist eder; başka bir modülden çağrılan `vi.mock` modül grafiği çözüldükten
 * SONRA işler ve geç kalır (gerçek `mikroClient` yüklenir, testler ağ dener). Bu yüzden
 * blokları test dosyanın en üstüne KOPYALA — tarif: `mikroMockTarifi` (aşağıda).
 *
 * Ağ/DB YOK: `mikroPost` test dosyasında mock'lanır; sahte adminDb bütün yazımları
 * bellekteki `yazilan` dizisine düşürür, hiçbir şey kalıcılaşmaz.
 */
import type { Express, Request, Response } from 'express';
import { vi } from 'vitest';
import { mikroRoutes, type MikroRouteCtx } from './mikroRoutes.js';
import type { Sema } from '../schemas.js';

/**
 * Test dosyanın EN ÜSTÜNE (import'lardan önce/sonra fark etmez, vitest hoist eder)
 * bu blokları kopyala. Burada string olarak duruyor ki tek kaynak olsun ve yeni bir
 * rota testi yazan "hangi modülleri mock'lamam gerekiyordu?" diye aramasın.
 */
export const mikroMockTarifi = `
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS' }));
vi.mock('../mikroMirror.js', () => ({
  CHA_COLS: {}, STH_COLS: {}, FIS_COLS: {}, SIP_COLS: {},
  mirrorMikroCariler: vi.fn(async () => {}), mirrorMikroInsert: vi.fn(async () => {}), mirrorMikroStoklar: vi.fn(async () => {}),
}));
vi.mock('../mikroClient.js', async (orig) => {
  const gercek = await orig<typeof import('../mikroClient.js')>();
  return {
    ...gercek,
    getMikroCreds: vi.fn(async () => ({ firmaKodu: 'F' })),
    mikroPost: vi.fn(),
    // Map — DÜZ NESNE DEĞİL. Gerçek fonksiyon her koşulda Map döner (ağ hatasında BOŞ
    // Map, mikroClient.ts). \`{}\` ile stokGovdesi tesadüfen doğru 400'ü veriyordu
    // (\`!vergiTablosu.size\` undefined'a düşüyor), fatura/sipariş gövdeleri ise
    // \`for (… of tablo)\` üstünde TypeError atıp rotayı 500'e düşürüyordu — yani
    // "vergi tablosu okunamadı → 400" sözleşmesi varsayılan düzenekte YANLIŞ koda
    // düşüyordu (hakem bulgusu 2026-09-19). Boş Map üretim arıza hâliyle birebir aynı.
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    vergiOraniCoz: vi.fn(() => null),
  };
});
`.trim();

// ── Tipler ───────────────────────────────────────────────────────────────────
export type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
export type Metot = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'USE';
export type Ref = { id: string; coll: string };
/** Sahte adminDb'ye düşen TEK yazım. `data` yalnız set/update'te vardır. */
export type Yazim = { op: 'set' | 'update' | 'delete'; ref: Ref; data?: Record<string, unknown> };
export type SnapDoc = { id: string; data: () => Record<string, unknown>; ref: Ref };
export type Kullanici = { uid?: string; email?: string; companyId?: string };
/** PG havuzu sahtesi: rota `C.getPgPool()` çağırınca bu fonksiyon devreye girer. */
export type SahteSorgu = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;

export interface SahteYanit {
  /** `res.status(n)` ile atanan HTTP kodu; hiç çağrılmadıysa 200. */
  kod: number;
  /** `res.json(...)`/`res.send(...)` gövdesi. */
  govde: unknown;
  basliklar: Record<string, string>;
  bittiMi: boolean;
  status(n: number): SahteYanit;
  json(b: unknown): SahteYanit;
  send(b: unknown): SahteYanit;
  setHeader(ad: string, deger: string): SahteYanit;
  type(t: string): SahteYanit;
  end(b?: unknown): SahteYanit;
  /** Node yanıt olayı. `yaziciyiIstegeBagla` (bakimKilidi.ts) bakım-kilidi yazıcı
   *  kaydını `res.once('finish'|'close')` ile siler — eksikken PG havuzu KURULU her
   *  import rotası `TypeError: res.once is not a function` ile catch'e düşüyordu
   *  (2026-09-19, Faz 3 3/n eslemeFatura bağlaması; `pgAyarla` kullanan ilk test). */
  once(olay: string, fn: () => void): SahteYanit;
}

export interface SahteApp {
  /** Anahtar: `"POST /api/mikro/import/stok"`. Değer: zincirin SON ara katmanı = handler. */
  handlers: Record<string, Handler>;
  /** Rotanın tüm ara katman zinciri — erişim kapısının VARLIĞI buradan doğrulanır (`erisimKapisi` etiketi). */
  zincirler: Record<string, unknown[]>;
  get: KayitFn; post: KayitFn; put: KayitFn; patch: KayitFn; delete: KayitFn; use: KayitFn;
}
type KayitFn = (yol: unknown, ...mw: unknown[]) => void;

export interface Duzenek {
  app: SahteApp;
  C: MikroRouteCtx;
  /** Rotayı çağırır ve sahte yanıtı döner. Rota yoksa kayıtlı yolları listeleyerek fırlatır. */
  cagir(
    metot: Metot | Lowercase<Metot>,
    yol: string,
    govde?: unknown,
    kullanici?: Kullanici,
    ek?: { params?: Record<string, string>; query?: Record<string, unknown>; headers?: Record<string, string> },
  ): Promise<SahteYanit>;
  /** Sahte adminDb'ye düşen tüm yazımlar — SIRALI. Referans sabittir (`sifirla` yerinde boşaltır). */
  yazilan: Yazim[];
  /** `C.writeSyncLog` — `expect(d.syncLog).toHaveBeenCalledWith(...)` için. */
  syncLog: ReturnType<typeof vi.fn>;
  /** Koleksiyonun mevcut dokümanlarını kurar: `{ '<docId>': { ...alanlar } }`. Sıra korunur. */
  snapAyarla(coll: string, kayitlar: Record<string, Record<string, unknown>>): void;
  /** Bakım kilidi (`opsLocks/bakim`). Kilit varken import uçları 423 döner. `null` = kilit yok. */
  kilitAyarla(bilgi: { aciklama: string; baslangic: string } | null): void;
  /** PG havuzunu özelleştir. `null` → havuz YOK (`getPgPool()` null döner, lokal Firestore hâli). */
  pgAyarla(sorgu: SahteSorgu | null): void;
  /** Yazımları, snapshot'ları, kilidi, sayaçları ve mock çağrılarını sıfırlar. */
  sifirla(): void;
  /** Bir koleksiyona düşen yazımlar — `d.yazilan.filter(...)` kısayolu. */
  koleksiyon(coll: string): Yazim[];
}

// ── Düzenek ──────────────────────────────────────────────────────────────────
export interface DuzenekSecenek {
  /** Varsayılan çağıran. Testler `cagir(..., kullanici)` ile tek çağrılık değiştirebilir. */
  kullanici?: Kullanici;
  /** Rota kaydı. Varsayılan `mikroRoutes`; başka bir rota grubu için değiştirilebilir. */
  kayit?: (app: Express, C: MikroRouteCtx) => void;
}

/** Sahte app + bağlam `C` kurar ve rotaları kaydeder. Her `beforeEach`'te bir kez çağır. */
export function duzenekKur(secenek: DuzenekSecenek = {}): Duzenek {
  const VARSAYILAN_KULLANICI: Required<Kullanici> = { uid: 'u1', email: 'a@cetpa.com.tr', companyId: 'A' };

  const yazilan: Yazim[] = [];
  let snap: Record<string, SnapDoc[]> = {};
  let sayac = 0;
  let kilit: { aciklama: string; baslangic: string } | null = null;
  let pgSorgu: SahteSorgu | null = null;
  let aktif: Required<Kullanici> = { ...VARSAYILAN_KULLANICI, ...secenek.kullanici };

  const gecir = () => (_r: unknown, _s: unknown, next: () => void) => next();

  // Doküman referansı: batch dışı `ref.set(...)`/`ref.update(...)` da yazılana düşsün
  // (bazı rotalar batch kullanmaz — ör. `/api/mikro/stok/kaydet` push'tan sonra tek
  // dokümana `mikroSynced` damgası basar). Yeni doküman id'si `yeni-N` — testler id'ye
  // değil `data`ya bakar.
  // 2026-09-19: `update`/`delete` eklendi (Faz 3 3/n, govdeStokCari bağlaması). Bunlar
  // gerçek adminDb yüzeyinin parçası; eksikken rota `TypeError: ref.update is not a
  // function` alıp catch'e düşüyor ve BAŞARILI push testi 500 görüyordu — yani sahte,
  // gerçekte var olmayan bir arıza. Yazımlar batch'inkiyle AYNI biçimde kaydedilir.
  const doc = (coll: string, id?: string) => {
    const ref: Ref & {
      set: (d: Record<string, unknown>) => Promise<void>;
      update: (d: Record<string, unknown>) => Promise<void>;
      delete: () => Promise<void>;
      get: () => Promise<{ exists: boolean; id: string; data: () => Record<string, unknown> | undefined }>;
    } = {
      id: id ?? `yeni-${++sayac}`, coll,
      set:    async (d) => { yazilan.push({ op: 'set',    ref: { id: ref.id, coll }, data: d }); },
      update: async (d) => { yazilan.push({ op: 'update', ref: { id: ref.id, coll }, data: d }); },
      delete: async ()  => { yazilan.push({ op: 'delete', ref: { id: ref.id, coll } }); },
      // 2026-09-19 (kiracı izolasyonu testleri): tek doküman okuma — sahiplik doğrulaması `doc(id).get()` ister.
      // Kaynak yine `snapAyarla`; olmayan id `exists:false` döner (gerçek adminDb ile aynı), uydurma veri YOK.
      get: async () => {
        const dk = (snap[coll] ?? []).find(x => x.id === ref.id);
        return { exists: !!dk, id: ref.id, data: () => dk?.data() };
      },
    };
    return ref;
  };

  /**
   * Koleksiyon sorgusu: `where(...).limit(n).get()`. Kaynak `snapAyarla` ile kurulan
   * dokümanlardır; filtre YERİNDE uygulanır — sorgusuz `get()` tüm koleksiyonu döner.
   *
   * 2026-09-19 (hakem düzeltmesi, grup "eslemeler-stok-cari"): eskiden yalnız `doc()`
   * vardı ve `.where()` çağıran rotalar TypeError ile catch'e düşüyordu. Bu, iki gerçek
   * bulgunun testini imkânsız kılıyordu: `pull/bakiye` cari döngüsü (leads sorgusu) ve
   * `import/stok-miktar` (inventory + warehouses + V17 yoklaması). Filtre gerçekten
   * uygulanır — "hepsini döndür" sahtesi kiracı izolasyonu iddialarını sessizce yeşil
   * yapardı (harness'in kendisi "sessiz sıfır" üretmemeli).
   *
   * Desteklenmeyen operatör SESSİZCE geçilmez, fırlatılır: Firestore semantiği taklit
   * edilirken tahmin etmek, testi gerçekte olmayan bir davranışa kilitler.
   */
  const karsilastir = (deger: unknown, op: string, hedef: unknown): boolean => {
    switch (op) {
      case '==': return deger === hedef;
      case '!=': return deger !== hedef;
      case '>':  return (deger as number) >  (hedef as number);
      case '>=': return (deger as number) >= (hedef as number);
      case '<':  return (deger as number) <  (hedef as number);
      case '<=': return (deger as number) <= (hedef as number);
      case 'in': return Array.isArray(hedef) && hedef.includes(deger);
      default: throw new Error(`Sahte adminDb: '${op}' operatörü desteklenmiyor — testDuzenegi.karsilastir'a ekle.`);
    }
  };
  type Kosul = [alan: string, op: string, hedef: unknown];
  const sorgu = (coll: string, kosullar: Kosul[], sinir: number | null) => ({
    where: (alan: string, op: string, hedef: unknown) => sorgu(coll, [...kosullar, [alan, op, hedef]], sinir),
    limit: (n: number) => sorgu(coll, kosullar, n),
    get: async () => {
      const hepsi = (snap[coll] ?? []).filter(dk => kosullar.every(([alan, op, hedef]) => karsilastir(dk.data()[alan], op, hedef)));
      const docs = sinir === null ? hepsi : hepsi.slice(0, sinir);
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });

  // adminDb sahtesi BİLEREK dar: yalnız gerçekten kullanılan yüzey (batch + collection()).
  // Eksik bir metot eklemek yerine PATLAMASI iyidir — sessizce boş dönen bir `get()`
  // testi yeşil bırakıp gerçek kodu yanlış yola sokardı (projenin "sessiz sıfır" sınıfı).
  const adminDb = {
    batch: () => ({
      set: (ref: Ref, data: Record<string, unknown>) => { yazilan.push({ op: 'set', ref: { id: ref.id, coll: ref.coll }, data }); },
      update: (ref: Ref, data: Record<string, unknown>) => { yazilan.push({ op: 'update', ref: { id: ref.id, coll: ref.coll }, data }); },
      delete: (ref: Ref) => { yazilan.push({ op: 'delete', ref: { id: ref.id, coll: ref.coll } }); },
      commit: async () => {},
    }),
    collection: (coll: string) => ({ doc: (id?: string) => doc(coll, id), ...sorgu(coll, [], null) }),
  };

  const syncLog = vi.fn(async () => {});

  const app = sahteApp();
  const C: MikroRouteCtx = {
    reqActor: () => ({ uid: aktif.uid, email: aktif.email }),
    writeSyncLog: syncLog,
    reqCompanyId: async () => aktif.companyId,
    writeAuditLog: vi.fn(async () => {}),
    tenantSnap: vi.fn(async (coll: string) => ({ docs: snap[coll] ?? [] })),
    mikroIdCozucu: async () => (a: string) => a,
    loadCompanyDocs: vi.fn(async () => []),
    mikroLimiter: gecir(),
    // Kapı ETİKETLİ döner: düzenek ara katmanları koşturmaz (yalnız son halkayı), ama bir rotanın zincirinde
    // HANGİ erişim kapısının durduğu `d.app.zincirler[...]` üzerinden doğrulanabilir (2026-09-19: e-İrsaliye rol kapısı).
    requireCollectionAccess: (coll: string, islem: string) => Object.assign(gecir(), { erisimKapisi: `${coll}:${islem}` }),
    requireAuth: gecir(),
    requireMfaVerified: gecir(),
    getAdminDb: () => adminDb as unknown as ReturnType<MikroRouteCtx['getAdminDb']>,
    // Kilit varken `docs`/`opsLocks` sorgusu satır döndürmeli (bakimKilidiVar).
    // Kilit yoksa ve özel sorgu da yoksa havuz YOK — lokal (Firestore fallback) hâli.
    getPgPool: () => {
      if (pgSorgu) return { query: pgSorgu };
      if (kilit) return { query: async () => ({ rows: [{ data: kilit }] }) };
      return null;
    },
    getUserCompanyId: async () => aktif.companyId,
    mikroIdCozucuIds: () => (a: string) => a,
    // server.ts'teki `validate` ile AYNI davranış (gerçek zod safeParse + 400):
    // `() => null` yazmak her gövdeyi "geçersiz" sayardı ve gövde grubu testleri
    // rotanın gerçek doğrulamasını hiç görmezdi.
    validate: <T,>(sema: Sema<T>, veri: unknown, res: Response): T | null => {
      const sonuc = sema.safeParse(veri);
      if (!sonuc.success) {
        res.status(400).json({ success: false, error: 'Geçersiz istek gövdesi.', details: sonuc.error.flatten() });
        return null;
      }
      return sonuc.data;
    },
    getBoss: () => null,
  };

  (secenek.kayit ?? mikroRoutes)(app as unknown as Express, C);

  const duzenek: Duzenek = {
    app, C, yazilan, syncLog,
    async cagir(metot, yol, govde, kullanici, ek) {
      const anahtar = `${String(metot).toUpperCase()} ${yol}`;
      const handler = app.handlers[anahtar];
      if (!handler) {
        const benzer = Object.keys(app.handlers).filter(k => k.includes(yol.split('?')[0]));
        throw new Error(
          `Rota kayıtlı değil: ${anahtar}.` +
          (benzer.length ? ` Aynı yolda kayıtlı: ${benzer.join(', ')}` : ' (yol veya metot yanlış olabilir)'),
        );
      }
      const onceki = aktif;
      if (kullanici) aktif = { ...aktif, ...kullanici };
      const basliklar = ek?.headers ?? {};
      const req = {
        method: String(metot).toUpperCase(), path: yol, originalUrl: yol, url: yol, ip: '127.0.0.1',
        params: ek?.params ?? {}, query: ek?.query ?? {}, body: govde ?? {},
        headers: basliklar, get: (ad: string) => basliklar[ad.toLowerCase()] ?? basliklar[ad],
        user: { uid: aktif.uid, email: aktif.email },
      } as unknown as Request;
      const res = sahteYanit();
      try {
        await handler(req, res);
      } finally {
        aktif = onceki;
      }
      return res;
    },
    snapAyarla(coll, kayitlar) {
      // `ref` gerçek doküman referansı: bazı rotalar sorgu sonucundaki `doc.ref.update(...)`'i doğrudan çağırır.
      snap[coll] = Object.entries(kayitlar).map(([id, veri]) => ({ id, data: () => veri, ref: doc(coll, id) }));
    },
    kilitAyarla(bilgi) { kilit = bilgi; },
    pgAyarla(sorgu) { pgSorgu = sorgu; },
    sifirla() {
      yazilan.length = 0;   // referans SABİT kalmalı: testler `d.yazilan`ı tutuyor
      snap = {};
      sayac = 0;
      kilit = null;
      pgSorgu = null;
      aktif = { ...VARSAYILAN_KULLANICI, ...secenek.kullanici };
      syncLog.mockClear();
      vi.mocked(C.writeAuditLog).mockClear();
      vi.mocked(C.tenantSnap).mockClear();
      vi.mocked(C.loadCompanyDocs).mockClear();
    },
    koleksiyon(coll) { return yazilan.filter(y => y.ref.coll === coll); },
  };
  return duzenek;
}

/** Express yerine geçen toplayıcı: ara katman zincirinin SON halkasını handler sayar. */
export function sahteApp(): SahteApp {
  const handlers: Record<string, Handler> = {};
  /** Rotanın TÜM ara katman zinciri (son halka dâhil) — erişim kapısı gibi halkaların VARLIĞINI doğrulamak için. */
  const zincirler: Record<string, unknown[]> = {};
  let anonim = 0;
  const kaydet = (metot: Metot) => (yol: unknown, ...mw: unknown[]) => {
    // `app.use(fn)` (yolsuz) da kaydedilsin ki rota SAYISI/sırası incelenebilsin.
    const anahtar = typeof yol === 'string' ? `${metot} ${yol}` : `${metot} *${++anonim}`;
    const zincir = typeof yol === 'string' ? mw : [yol, ...mw];
    handlers[anahtar] = zincir[zincir.length - 1] as Handler;
    zincirler[anahtar] = zincir;
  };
  return {
    handlers, zincirler,
    get: kaydet('GET'), post: kaydet('POST'), put: kaydet('PUT'),
    patch: kaydet('PATCH'), delete: kaydet('DELETE'), use: kaydet('USE'),
  };
}

/** Express Response yerine geçen sahte: `kod` + `govde` okunur, zincirleme çalışır. */
export function sahteYanit(): SahteYanit {
  // 'finish' dinleyicileri: yanıt kapanınca BİR KEZ tetiklenir (Node davranışı).
  // Gerçek karşılığı bakım-kilidi yazıcı kaydının silinmesidir; tetiklenmezse kayıt
  // asılı kalır ve sonraki import'lar kendini bekler.
  const dinleyiciler: Record<string, Array<() => void>> = {};
  const bitir = () => {
    res.bittiMi = true;
    const liste = dinleyiciler.finish ?? [];
    dinleyiciler.finish = [];
    for (const fn of liste) fn();
  };
  const res: SahteYanit = {
    kod: 200, govde: null, basliklar: {}, bittiMi: false,
    status(n) { res.kod = n; return res; },
    json(b) { res.govde = b; bitir(); return res; },
    send(b) { res.govde = b; bitir(); return res; },
    setHeader(ad, deger) { res.basliklar[ad] = deger; return res; },
    type(t) { res.basliklar['Content-Type'] = t; return res; },
    end(b) { if (b !== undefined) res.govde = b; bitir(); return res; },
    once(olay, fn) { (dinleyiciler[olay] ??= []).push(fn); return res; },
  };
  return res;
}
