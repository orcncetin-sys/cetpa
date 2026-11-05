/**
 * stokKodGocuRoutes.ts — stok kodu göçünün KURU KOŞU uçları (şartname `.wf/SARTNAME-mikro-baglanti-d-kod.md` D1 + DH16 / DH17;
 * 05.11.2026). İki uç, TEK gövde (`mikro/stokKodGocuKuru.ts`):
 *   • `POST /api/ops/stok-kod-gocu/kuru` — ops jetonu (`opsJetonuGecerli`, `X-Ops-Token`); kiracı = Mikro işlerinin kiracısı
 *     (`cronKiracisi`, crons.ts `cronCompanyId` kuralı). Kullanıcı kararı (05.11, Soru 3 → b): çalıştıran `scripts/ops-istek.sh --govde`.
 *   • `POST /api/stok-kod-gocu/kuru` — Yönetici: `requireAuth` → `requireMfaVerified` → yalnız Yönetici (`yalnizYoneticiMi`);
 *     kiracı `reqCompanyId`.
 * SALT OKUMA: POST yalnız gövde taşımak içindir (DH16; `ops-istek.sh --govde` POST gönderir). Hiçbir uç yazmaz; denetim satırı yok.
 *
 * NEDEN AYRI MODÜL (şartnamedeki «mikroRoutes.ts / opsRoutes.ts» yerine — en küçük sapma): `mikroRoutes.ts`'in rol kapısı çiti
 * (`mikroRoutes.rolKapisi.test.ts` Ç1 / BASLIK) yalnız `/api/mikro/*` yolunu ve sabit kayıt sayısını kabul eder; Dilim A'nın ikinci
 * turu aynı iki dosyada sürüyor. Uygulama / geri alma / pasif liste uçları (D4 / D5, DH17) bu modüle eklenecek.
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
  getPgPool: () => KuruPgHavuzu | null;
  requireAuth: RequestHandler;
  requireMfaVerified: RequestHandler;
  getUserRole: (uid: string) => Promise<AppRole | null>;
  isSuperAdmin: (req: Request) => boolean;
  reqCompanyId: (req: Request) => Promise<string>;
  mikroIdCozucuIds: (ids: Iterable<string>, cid: string) => (anahtar: string) => string;
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
}
