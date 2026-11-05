/**
 * stokKodGocuRoutes.ts — stok kodu göçünün uçları (şartname `.wf/SARTNAME-mikro-baglanti-d-kod.md` D1 + D4 / D5 + DH16 / DH17;
 * 05.11.2026). Her işin İKİ ucu var, TEK gövde: ops jetonlu (`/api/ops/stok-kod-gocu/*`; kullanıcı kararı 05.11 Soru 3 → b: çalıştıran
 * `scripts/ops-istek.sh`, denetim aktörü «ops») ve Yönetici (`/api/stok-kod-gocu/*`: `requireAuth` → `requireMfaVerified` → yalnız
 * Yönetici; kiracı `reqCompanyId`).
 *
 * KURU KOŞU (`mikro/stokKodGocuKuru.ts`):
 *   • `POST /api/ops/stok-kod-gocu/kuru` — ops jetonu (`opsJetonuGecerli`, `X-Ops-Token`); kiracı = Mikro işlerinin kiracısı
 *     (`cronKiracisi`, crons.ts `cronCompanyId` kuralı). Kullanıcı kararı (05.11, Soru 3 → b): çalıştıran `scripts/ops-istek.sh --govde`.
 *   • `POST /api/stok-kod-gocu/kuru` — Yönetici: `requireAuth` → `requireMfaVerified` → yalnız Yönetici (`yalnizYoneticiMi`);
 *     kiracı `reqCompanyId`.
 * SALT OKUMA: POST yalnız gövde taşımak içindir (DH16; `ops-istek.sh --govde` POST gönderir). Kuru koşu yazmaz; denetim satırı yok.
 *
 * UYGULAMA / GERİ ALMA / PASİF LİSTE (`mikro/stokKodGocuUygula.ts`, D4 / D5; DH17 çağıranı):
 *   • `POST …/uygula` `{ planImza, ciftler, onayli, pasif? }` — imzasız / biçimsiz 400, imza tutmazsa 409, onaylı liste kuru koşuyla
 *     uyuşmazsa 400 (satır satır `gecersiz`), kilit varsa 423; kabulde 202 + `calismaId` (iş aynı süreçte arka planda koşar).
 *   • `POST …/geri-al` `{ calismaId }` — 202; kayıtta geri yazılamayacak satır (beyaz liste dışı / yabancı kiracı) varsa 422 (DH10).
 *   • `GET …/calisma/:calismaId` — çalışma başlığı (durum, çift özetleri, sayılar; ad YOK).
 *   • `GET …/pasif` — `mikroPasif` işaretli kartlar (kod + kart kimliği; ad YOK).
 *
 * NEDEN AYRI MODÜL (şartnamedeki «mikroRoutes.ts / opsRoutes.ts» yerine — en küçük sapma): `mikroRoutes.ts`'in rol kapısı çiti
 * (`mikroRoutes.rolKapisi.test.ts` Ç1 / BASLIK) yalnız `/api/mikro/*` yolunu ve sabit kayıt sayısını kabul eder; Dilim A'nın ikinci
 * turu aynı iki dosyada sürüyor. Uygulama / geri alma / pasif liste uçları (D4 / D5, DH17) da bu modüldedir (aynı gerekçe; bu tur
 * mikroRoutes.ts / opsRoutes.ts'e HİÇ dokunmaz — paralel dal aynı dosyalarda).
 *
 * GÖVDE AYRIŞTIRICISI: genel `express.json` sınırı 100 KB; 2.000 satırlık onay listesi (DH16 sınırı) bunu aşabilir. Bu iki yol için
 * ayrıştırıcı GENEL ayrıştırıcıdan ÖNCE bağlanır (server.ts; Shopify webhook deseni) ve bozuk JSON'u 400 ile yanıtlar (genel hata
 * yakalayıcı 500 verirdi). Sınırlayıcı (`/api` genel kovası) ayrıştırıcıdan ÖNCE koşar. Rotalar `express.json`'dan SONRA kayıtlıdır.
 */
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { AppRole } from '../../lib/rbac.js';
import { yalnizYoneticiMi } from '../../lib/rbac.js';
import { opsJetonuGecerli } from '../opsJeton.js';
import { cronKiracisi } from '../kiraciOrtami.js';
import { listeZamanAsimiMs, mikroKolonlar, mikroSql } from '../mikroClient.js';
import { kuruGovdesiniCoz } from '../mikro/stokKodGocu.js';
import { KURU_TOPLAM_SURE_MS, stokKodGocuKuruKos, type KuruBagimliliklari, type KuruPgHavuzu } from '../mikro/stokKodGocuKuru.js';
import { CALISMA_KIMLIGI, geriAlGovdesiniCoz, uygulaGovdesiniCoz } from '../mikro/stokKodGocuTasima.js';
import {
  OPS_AKTORU, calismaBasligiOku, stokKodGocuGeriAlBaslat, stokKodGocuPasifListesi, stokKodGocuUygulaBaslat,
  type Aktor, type UygulaBagimliliklari, type UygulaPgHavuzu,
} from '../mikro/stokKodGocuUygula.js';

/** Gövde ayrıştırıcısının bağlandığı yollar (server.ts `app.use(STOK_KOD_GOCU_YOLLARI, …)`). */
export const STOK_KOD_GOCU_YOLLARI = ['/api/ops/stok-kod-gocu', '/api/stok-kod-gocu'];
/** 2.000 satır × en çok 2 × 50 karakter (Türkçe harf 2 bayt) + alan adları ≈ 0,5 MB. */
const GOVDE_SINIRI = '1mb';

/** Bu yolların gövde ayrıştırıcısı + yalnız ayrıştırma hatasını yanıtlayan hata ara katmanı (başka hata genel yakalayıcıya gider). */
export function stokKodGocuGovdeAyristiricisi(): Array<RequestHandler | ((err: unknown, req: Request, res: Response, next: NextFunction) => void)> {
  return [
    express.json({ limit: GOVDE_SINIRI }),
    (err: unknown, _req: Request, res: Response, next: NextFunction): void => {
      const tur = err && typeof err === 'object' ? (err as { type?: unknown }).type : undefined;
      if (tur === 'entity.parse.failed') { res.status(400).json({ success: false, error: 'Gövde JSON olarak okunamadı.' }); return; }
      if (tur === 'entity.too.large') { res.status(413).json({ success: false, error: `Gövde çok büyük (en çok ${GOVDE_SINIRI}).` }); return; }
      next(err);
    },
  ];
}

/** server.ts'ten ihtiyaç duyulan HER ŞEY — açık liste (import DEĞİL; döngü olurdu). */
export interface StokKodGocuRouteCtx {
  /** `pg.Pool`: kuru koşu yalnız `query`; uygulama / geri alma çift başına `connect` + BEGIN / COMMIT (DH9). */
  getPgPool: () => UygulaPgHavuzu | null;
  requireAuth: RequestHandler;
  requireMfaVerified: RequestHandler;
  getUserRole: (uid: string) => Promise<AppRole | null>;
  isSuperAdmin: (req: Request) => boolean;
  reqCompanyId: (req: Request) => Promise<string>;
  mikroIdCozucuIds: (ids: Iterable<string>, cid: string) => (anahtar: string) => string;
  /** server.ts `writeAuditLog` — uygulama / geri alma başına TEK satır (D4; aktör ops ucunda «ops»). */
  writeAuditLog: (actor: { uid: string; email: string }, action: string, details: string, diff?: undefined, kiraci?: string) => Promise<void>;
  /** server.ts `broadcastDocChange` — ham SQL yazımı açık istemcilere duyurulur. */
  broadcastDocChange: (coll: string, type: 'set' | 'delete', id: string, data?: unknown) => void;
  reqActor: (req: Request) => { uid: string; email: string };
  /** Yalnız test: `yazicilariBekle` seçenekleri (kısa aralık). Üretimde verilmez. */
  bekleme?: UygulaBagimliliklari['bekleme'];
}

/** Yönetici kapısının reddi — `code` istemcinin ayırt etmesi için. */
const YONETICI_GEREKLI = { success: false, error: 'Stok kodu göçü yalnız Yönetici içindir.', code: 'YONETICI_GEREKLI' } as const;

export function stokKodGocuRoutes(app: Express, C: StokKodGocuRouteCtx): void {
  /** Aynı anda tek kuru koşu: Mikro'ya ~20 okuma yapar; eşzamanlı ikinci koşu Mikro'ya yük bindirmekten başka şey üretmez. */
  let kosuyor = false;

  /** Mikro işlerinin kiracısı (`users` taraması yalnız `role` + `companyId` seçer; kişi verisi okunmaz). */
  const mikroKiracisi = async (havuz: KuruPgHavuzu): Promise<string> => {
    if (process.env.MIKRO_CRON_COMPANY_ID) return process.env.MIKRO_CRON_COMPANY_ID;
    const { rows } = await havuz.query("SELECT id, data->'role' AS role, data->'companyId' AS cid FROM docs WHERE coll = 'users'");
    return cronKiracisi(process.env, rows.map(r => ({ id: String(r.id), veri: { role: r.role, companyId: r.cid } })));
  };

  const calistir = async (res: Response, havuz: KuruPgHavuzu, companyId: string, aynaKullan: boolean, govde: unknown, etiket: string): Promise<void> => {
    const coz = kuruGovdesiniCoz(govde);
    if (!coz.tamam) { res.status(400).json({ success: false, error: coz.error }); return; }
    if (kosuyor) { res.status(409).json({ success: false, error: 'Bir kuru koşu zaten sürüyor; bitince yeniden deneyin.' }); return; }
    kosuyor = true;
    try {
      // Toplam süre sınırı (inceleme MBS #4, 2026-11-05): uç senkron, ARR ~120 sn'de keser; 20-30 ardışık okumanın her biri 120 sn
      // bekleyebilirdi. Sınır dolunca kalan ölçüler «ölçülemedi» olur ve kısmi rapor ARR kesmeden döner.
      const d: KuruBagimliliklari = {
        havuz, mikroSql, mikroKolonlar, mikroIdCozucuIds: C.mikroIdCozucuIds, zamanAsimiMs: listeZamanAsimiMs(), toplamSureMs: KURU_TOPLAM_SURE_MS,
      };
      const sonuc = await stokKodGocuKuruKos(d, { companyId, aynaKullan, ciftler: coz.ciftler, yokSayilan: coz.yokSayilan });
      if (!sonuc.tamam) { res.status(sonuc.durum).json({ success: false, error: sonuc.error }); return; }
      res.json(sonuc.rapor);
    } catch (e) {
      console.error(`[${etiket}]`, e instanceof Error ? e.message : String(e));
      res.status(500).json({ success: false, error: 'Kuru koşu yapılamadı. Ayrıntı sunucu günlüğünde.' });
    } finally {
      kosuyor = false;
    }
  };

  /**
   * POST /api/ops/stok-kod-gocu/kuru `[{ eski, yeni, kaynak }]` ya da `{ ciftler?: [...] }` — kuru koşu, ops jetonuyla (D1). Kiracı
   * Mikro işlerinin kiracısıdır; o yüzden ayna GUID kanıtı her zaman kullanılır (DH13). Gövde: `scripts/ops-istek.sh --govde <dosya>`.
   */
  app.post('/api/ops/stok-kod-gocu/kuru', async (req: Request, res: Response) => {
    if (!opsJetonuGecerli(req, res)) return;
    const havuz = C.getPgPool();
    if (!havuz) { res.status(503).json({ success: false, error: 'pg havuzu yok (lokal Firestore fallback)' }); return; }
    try {
      const kiraci = await mikroKiracisi(havuz);
      if (!kiraci) { res.status(503).json({ success: false, error: 'Mikro işlerinin kiracısı çözülemedi (MIKRO_CRON_COMPANY_ID yok, kiracı birden çok).' }); return; }
      await calistir(res, havuz, kiraci, true, req.body, '/api/ops/stok-kod-gocu/kuru');
    } catch (e) {
      console.error('[/api/ops/stok-kod-gocu/kuru]', e instanceof Error ? e.message : String(e));
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Kuru koşu yapılamadı. Ayrıntı sunucu günlüğünde.' });
    }
  });

  /** Yalnız Yönetici (ya da süper yönetici) — rol kapısı; dış rol ve rolsüz hesap `requireAuth` boğazında zaten 403'tür. */
  const yalnizYonetici = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const uid = (req as Request & { uid?: string }).uid;
    const rol = uid ? await C.getUserRole(uid) : null;
    if (yalnizYoneticiMi(rol, C.isSuperAdmin(req))) { next(); return; }
    res.status(403).json(YONETICI_GEREKLI);
  };

  /** POST /api/stok-kod-gocu/kuru — aynı gövde, Yönetici oturumuyla; kiracı `reqCompanyId`. Ayna kanıtı yalnız Mikro kiracısında (DH13). */
  app.post('/api/stok-kod-gocu/kuru', C.requireAuth, C.requireMfaVerified, yalnizYonetici, async (req: Request, res: Response) => {
    const havuz = C.getPgPool();
    if (!havuz) { res.status(503).json({ success: false, error: 'pg havuzu yok (lokal Firestore fallback)' }); return; }
    try {
      const kiraci = await C.reqCompanyId(req);
      if (!kiraci) { res.status(400).json({ success: false, error: 'Kiracı çözülemedi.' }); return; }
      const aynaKullan = kiraci === await mikroKiracisi(havuz);
      await calistir(res, havuz, kiraci, aynaKullan, req.body, '/api/stok-kod-gocu/kuru');
    } catch (e) {
      console.error('[/api/stok-kod-gocu/kuru]', e instanceof Error ? e.message : String(e));
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Kuru koşu yapılamadı. Ayrıntı sunucu günlüğünde.' });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // D4 / D5 · uygulama, geri alma, çalışma durumu, pasif liste (DH17: ops jetonlu + Yönetici)
  // ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

  const bagimliliklar = (havuz: UygulaPgHavuzu): UygulaBagimliliklari => ({
    havuz,
    kuru: { mikroSql, mikroKolonlar, mikroIdCozucuIds: C.mikroIdCozucuIds, zamanAsimiMs: listeZamanAsimiMs(), toplamSureMs: KURU_TOPLAM_SURE_MS },
    yayinla: (coll, tur, id, veri) => C.broadcastDocChange(coll, tur, id, veri),
    denetim: (aktor, eylem, ayrinti, kiraci) => C.writeAuditLog(aktor, eylem, ayrinti, undefined, kiraci),
    ...(C.bekleme ? { bekleme: C.bekleme } : {}),
  });

  /** Uygulamanın eşzamanlı yolu (kuru koşu yeniden + imza + onay doğrulaması) Mikro'ya kuru koşu kadar okur: aynı tek koşu bayrağı. */
  const uygula = async (res: Response, havuz: UygulaPgHavuzu, companyId: string, aynaKullan: boolean, govde: unknown, aktor: Aktor, etiket: string): Promise<void> => {
    const coz = uygulaGovdesiniCoz(govde);
    if (!coz.tamam) { res.status(400).json({ success: false, error: coz.error }); return; }
    if (kosuyor) { res.status(409).json({ success: false, error: 'Bir kuru koşu ya da uygulama zaten sürüyor; bitince yeniden deneyin.' }); return; }
    kosuyor = true;
    try {
      const sonuc = await stokKodGocuUygulaBaslat(bagimliliklar(havuz), { companyId, aynaKullan, govde: coz.g, aktor });
      if (!sonuc.tamam) { res.status(sonuc.durum).json({ success: false, error: sonuc.error, ...(sonuc.gecersiz ? { gecersiz: sonuc.gecersiz } : {}) }); return; }
      sonuc.is.catch(e => console.error(`[${etiket}] ${sonuc.calismaId}:`, e instanceof Error ? e.message : String(e)));
      res.status(202).json({ success: true, calismaId: sonuc.calismaId, plan: sonuc.plan, durum: 'kosuyor' });
    } finally {
      kosuyor = false;
    }
  };

  const geriAl = async (res: Response, havuz: UygulaPgHavuzu, companyId: string, govde: unknown, aktor: Aktor, etiket: string): Promise<void> => {
    const coz = geriAlGovdesiniCoz(govde);
    if (!coz.tamam) { res.status(400).json({ success: false, error: coz.error }); return; }
    const sonuc = await stokKodGocuGeriAlBaslat(bagimliliklar(havuz), { companyId, calismaId: coz.g.calismaId, aktor });
    if (!sonuc.tamam) { res.status(sonuc.durum).json({ success: false, error: sonuc.error, ...(sonuc.ret ? { ret: sonuc.ret } : {}) }); return; }
    sonuc.is.catch(e => console.error(`[${etiket}] ${sonuc.calismaId}:`, e instanceof Error ? e.message : String(e)));
    res.status(202).json({ success: true, calismaId: sonuc.calismaId, durum: 'kosuyor' });
  };

  /** Ops ucunun ortak başı: jeton → havuz → Mikro işlerinin kiracısı. Yanıt yazıldıysa `null`. */
  const opsBasi = async (req: Request, res: Response): Promise<{ havuz: UygulaPgHavuzu; kiraci: string } | null> => {
    if (!opsJetonuGecerli(req, res)) return null;
    const havuz = C.getPgPool();
    if (!havuz) { res.status(503).json({ success: false, error: 'pg havuzu yok (lokal Firestore fallback)' }); return null; }
    const kiraci = await mikroKiracisi(havuz);
    if (!kiraci) { res.status(503).json({ success: false, error: 'Mikro işlerinin kiracısı çözülemedi (MIKRO_CRON_COMPANY_ID yok, kiracı birden çok).' }); return null; }
    return { havuz, kiraci };
  };
  /** Yönetici ucunun ortak başı: havuz → `reqCompanyId`. */
  const yoneticiBasi = async (req: Request, res: Response): Promise<{ havuz: UygulaPgHavuzu; kiraci: string } | null> => {
    const havuz = C.getPgPool();
    if (!havuz) { res.status(503).json({ success: false, error: 'pg havuzu yok (lokal Firestore fallback)' }); return null; }
    const kiraci = await C.reqCompanyId(req);
    if (!kiraci) { res.status(400).json({ success: false, error: 'Kiracı çözülemedi.' }); return null; }
    return { havuz, kiraci };
  };
  const yakala = (etiket: string, res: Response, e: unknown): void => {
    console.error(`[${etiket}]`, e instanceof Error ? e.message : String(e));
    if (!res.headersSent) res.status(500).json({ success: false, error: 'İşlem yapılamadı. Ayrıntı sunucu günlüğünde.' });
  };

  /** POST /api/ops/stok-kod-gocu/uygula — ops jetonuyla (DH17); denetim aktörü «ops». Ayna kanıtı açık (kiracı Mikro kiracısı; DH13). */
  app.post('/api/ops/stok-kod-gocu/uygula', async (req: Request, res: Response) => {
    try {
      const b = await opsBasi(req, res);
      if (b) await uygula(res, b.havuz, b.kiraci, true, req.body, OPS_AKTORU, '/api/ops/stok-kod-gocu/uygula');
    } catch (e) { yakala('/api/ops/stok-kod-gocu/uygula', res, e); }
  });
  app.post('/api/stok-kod-gocu/uygula', C.requireAuth, C.requireMfaVerified, yalnizYonetici, async (req: Request, res: Response) => {
    try {
      const b = await yoneticiBasi(req, res);
      if (b) await uygula(res, b.havuz, b.kiraci, b.kiraci === await mikroKiracisi(b.havuz), req.body, C.reqActor(req), '/api/stok-kod-gocu/uygula');
    } catch (e) { yakala('/api/stok-kod-gocu/uygula', res, e); }
  });

  /** POST /api/ops/stok-kod-gocu/geri-al `{ calismaId }` — aynı yoldan geri alma (kullanıcı kararı 05.11). */
  app.post('/api/ops/stok-kod-gocu/geri-al', async (req: Request, res: Response) => {
    try {
      const b = await opsBasi(req, res);
      if (b) await geriAl(res, b.havuz, b.kiraci, req.body, OPS_AKTORU, '/api/ops/stok-kod-gocu/geri-al');
    } catch (e) { yakala('/api/ops/stok-kod-gocu/geri-al', res, e); }
  });
  app.post('/api/stok-kod-gocu/geri-al', C.requireAuth, C.requireMfaVerified, yalnizYonetici, async (req: Request, res: Response) => {
    try {
      const b = await yoneticiBasi(req, res);
      if (b) await geriAl(res, b.havuz, b.kiraci, req.body, C.reqActor(req), '/api/stok-kod-gocu/geri-al');
    } catch (e) { yakala('/api/stok-kod-gocu/geri-al', res, e); }
  });

  /** GET …/calisma/:calismaId — çalışma başlığı (kiracı süzgeçli; başka kiracının çalışması 404). */
  const calisma = async (res: Response, havuz: UygulaPgHavuzu, kiraci: string, calismaId: unknown): Promise<void> => {
    if (typeof calismaId !== 'string' || !CALISMA_KIMLIGI.test(calismaId)) { res.status(400).json({ success: false, error: 'Çalışma kimliği biçimsiz.' }); return; }
    const b = await calismaBasligiOku(havuz, kiraci, calismaId);
    if (!b) { res.status(404).json({ success: false, error: 'Çalışma bulunamadı.' }); return; }
    res.json({ success: true, calisma: b });
  };
  app.get('/api/ops/stok-kod-gocu/calisma/:calismaId', async (req: Request, res: Response) => {
    try { const b = await opsBasi(req, res); if (b) await calisma(res, b.havuz, b.kiraci, req.params.calismaId); }
    catch (e) { yakala('/api/ops/stok-kod-gocu/calisma', res, e); }
  });
  app.get('/api/stok-kod-gocu/calisma/:calismaId', C.requireAuth, C.requireMfaVerified, yalnizYonetici, async (req: Request, res: Response) => {
    try { const b = await yoneticiBasi(req, res); if (b) await calisma(res, b.havuz, b.kiraci, req.params.calismaId); }
    catch (e) { yakala('/api/stok-kod-gocu/calisma', res, e); }
  });

  /** GET …/pasif — D5 pasif liste (kod + kart kimliği; ad YOK). Bu dilimde hiçbir ekran `mikroPasif`'i süzmez. */
  app.get('/api/ops/stok-kod-gocu/pasif', async (req: Request, res: Response) => {
    try { const b = await opsBasi(req, res); if (b) { const liste = await stokKodGocuPasifListesi(b.havuz, b.kiraci); res.json({ success: true, sayi: liste.length, liste }); } }
    catch (e) { yakala('/api/ops/stok-kod-gocu/pasif', res, e); }
  });
  app.get('/api/stok-kod-gocu/pasif', C.requireAuth, C.requireMfaVerified, yalnizYonetici, async (req: Request, res: Response) => {
    try { const b = await yoneticiBasi(req, res); if (b) { const liste = await stokKodGocuPasifListesi(b.havuz, b.kiraci); res.json({ success: true, sayi: liste.length, liste }); } }
    catch (e) { yakala('/api/stok-kod-gocu/pasif', res, e); }
  });
}
