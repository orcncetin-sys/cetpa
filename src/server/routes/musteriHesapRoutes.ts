/**
 * musteriHesapRoutes.ts — müşteri / bayi hesabının CARİ BAĞI uçları, YALNIZ Yönetici (2026-10-21, şartname
 * `.wf/SARTNAME-musteri-siparislerim.md` K3, H9).
 *
 *   GET  /api/admin/musteri-hesaplari            — kiracının bağları: `{ hesaplar: [{ uid, leadId, firma, durum, guncelleme,
 *                                                  cariKodDurumu }] }` (ham `cariKod` ve `olusturan` DÖNMEZ)
 *   PUT  /api/admin/musteri-hesaplari/:uid       — bağ kurma / değiştirme; aynı `leadId` = cari kodunu TAZELEME (istemci
 *                                                  `X-Cetpa-Method` tüneliyle gönderir) → `{ ok, cariKodDurumu, mfSayisi }`
 *   POST /api/admin/musteri-hesaplari/:uid/durum — erişimi kapat / aç
 *
 * KAPI: `authLimiter` → `requireAuth` → `requireMfaVerified` + işleyici başında `yalnizYoneticiMi` (iki adımlı doğrulama sıfırlama
 * kalıbı; `requireAdmin` Müdür'ü de geçirdiği için KULLANILMAZ). Kiracı OTURUMDAN (`reqCompanyId`), istekten değil; süper
 * yönetici kiracılar arası çalışır (hedefin kiracısıyla). Rota modülünde sınırlayıcı KURULMAZ (server.ts); bağımlılıklar bağlamla.
 *
 * YAZMA ÇEKİRDEĞİ BU DOSYADA DEĞİL: `src/server/musteriHesap.ts` (`musteriBagiKur`, `musteriHesapDurumuYaz`) — hesap açan
 * `POST /api/admin/users` (routes/epostaRoutes) de aynı çekirdeği çağırır. Bağ ya da cari kodu değişince ve erişim
 * kapatılınca o kişinin mağaza belirteçleri ortak iptal örneğiyle ANINDA ölür (`iptal.iptalEt`; kapı bağı her istekte yeniden okur).
 */
import type { Express, Request, RequestHandler, Response } from 'express';
import { disRolMu } from '../../lib/kimlikYuzeyi.js';
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi.js';
import { DIS_ROL_YONETICI_GEREKLI_YANITI, yalnizYoneticiMi } from '../../lib/rbac.js';
import type { AppRole } from '../../lib/rbac.js';
import type { AdminDbLike } from '../adminDbTypes.js';
import { BAYI_MF_SAYISI_SQL } from '../kanal/magazaBayiSiparis.js';
import type { PanelIptalCifti } from '../kanal/magazaPanelIptal.js';
import {
  MUSTERI_HESAP_KOLEKSIYONU, bagCariKodu, musteriBagiKur, musteriHesabiCoz, musteriHesapDurumuYaz,
} from '../musteriHesap.js';
import type { MusteriHesabi, MusteriHesapDeps } from '../musteriHesap.js';
import { MusteriBagGovdesi, MusteriDurumGovdesi } from '../schemas.js';
import { hataKodu } from './magazaRoutes.js';
import type { MagazaPgHavuzu } from './magazaRoutes.js';

/** server.ts'ten ihtiyaç duyulan HER ŞEY — açık liste (import DEĞİL; döngü olurdu). */
export interface MusteriHesapRouteCtx {
  getAdminDb: () => AdminDbLike;
  getPgPool: () => MagazaPgHavuzu | null;
  authLimiter: RequestHandler;
  requireAuth: RequestHandler;
  requireMfaVerified: RequestHandler;
  getUserRole: (uid: string) => Promise<AppRole | null>;
  isSuperAdmin: (req: Request) => boolean;
  reqActor: (req: Request) => { uid: string; email: string };
  reqCompanyId: (req: Request) => Promise<string>;
  writeAuditLog: (actor: { uid: string; email: string }, action: string, details: string) => Promise<void>;
  /** İptal çifti — panel / bayi zincirleri ve ERP çıkışıyla ORTAK örnek (server.ts `magazaPanelIptal`). */
  iptal: PanelIptalCifti;
  /** Firebase yenileme belirteçlerinin iptali (server.ts TEK yardımcı). */
  firebaseYenilemeIptal: (uid: string) => Promise<void>;
}

export type CariKodDurumu = 'yok' | 'uyusuyor' | 'farkli';

/** Bağdaki sabit kod ile lead'in GÜNCEL kırpılmış kodu (SAF): ikisi de yoksa `yok`, eşitse `uyusuyor`, ayrışmışsa `farkli`. */
export function cariKodDurumu(sabit: string | null, guncel: string | null): CariKodDurumu {
  if (sabit === guncel) return sabit === null ? 'yok' : 'uyusuyor';
  return 'farkli';
}

const LISTE_SQL = "SELECT id, data FROM docs WHERE coll = 'musteriHesaplari' AND data->>'companyId' = $1";
const LEAD_KODLARI_SQL = "SELECT id, data->'mikroCariKod' AS k FROM docs WHERE coll = 'leads' AND data->>'companyId' = $1 AND id = ANY($2::text[])";

export function musteriHesapRoutes(app: Express, C: MusteriHesapRouteCtx): void {
  const M: MusteriHesapDeps = { adminDb: () => C.getAdminDb() };

  /** YALNIZ Yönetici / süper yönetici; değilse 403 yanıtını KENDİSİ yazar ve `false` döner. */
  const yonetici = async (req: Request, res: Response): Promise<boolean> => {
    if (yalnizYoneticiMi(await C.getUserRole(C.reqActor(req).uid), C.isSuperAdmin(req))) return true;
    res.status(403).json(DIS_ROL_YONETICI_GEREKLI_YANITI);
    return false;
  };
  const hedefUid = (req: Request): string => (typeof req.params.uid === 'string' ? req.params.uid : '');
  /** Hedef `users` belgesi + kiracısı (`companyId`, yoksa kendi kimliği — `getUserCompanyId` kuralı). */
  const hedefKullanici = async (uid: string): Promise<{ rol: unknown; kiraci: string } | null> => {
    const snap = await C.getAdminDb().collection('users').doc(uid).get();
    if (!snap.exists) return null;
    const v = snap.data() ?? {};
    return { rol: v.role, kiraci: typeof v.companyId === 'string' && v.companyId !== '' ? v.companyId : uid };
  };
  /** MF sipariş sayısı (H5 yüklemi, yalnız cari kolu). Kod yoksa 0 (sorgu yok); havuz yoksa `null` (BİLİNMİYOR). */
  const mfSayisi = async (kiraci: string, cariKod: string | null): Promise<number | null> => {
    if (cariKod === null) return 0;
    const havuz = C.getPgPool();
    if (!havuz) return null;
    const { rows } = await havuz.query(BAYI_MF_SAYISI_SQL, [kiraci, cariKod, MAGAZA_KAYNAGI]);
    const n = Number(rows[0]?.n);
    return Number.isSafeInteger(n) ? n : null;
  };
  /** Erişimi öldürür: ortak iptal (hata yutulur → `false`), ardından Firebase yenileme iptali (en iyi çaba). */
  const iptalEt = async (uid: string, kiraci: string, firebase: boolean): Promise<boolean> => {
    let yazildi = true;
    try {
      await C.iptal.iptalEt(uid, kiraci);
    } catch (e) {
      yazildi = false;
      console.error('[musteri-hesap] iptal yazılamadı (süreç içi değer yine «şimdi»):', hataKodu(e));
    }
    if (firebase) {
      try { await C.firebaseYenilemeIptal(uid); } catch (e) { console.warn('[musteri-hesap] Firebase yenileme iptali yazılamadı:', hataKodu(e)); }
    }
    return yazildi;
  };

  app.get('/api/admin/musteri-hesaplari', C.authLimiter, C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    try {
      if (!(await yonetici(req, res))) return;
      const havuz = C.getPgPool();
      if (!havuz) { res.status(503).json({ ok: false, error: 'Müşteri hesapları bu kurulumda listelenemez (veritabanı bağlı değil).' }); return; }
      const kiraci = await C.reqCompanyId(req);
      const { rows } = await havuz.query(LISTE_SQL, [kiraci]);
      const baglar: Array<{ uid: string; bag: MusteriHesabi }> = [];
      for (const r of rows) {
        const bag = typeof r.id === 'string' ? musteriHesabiCoz(r.data) : null;
        if (typeof r.id === 'string' && bag !== null && bag.companyId === kiraci) baglar.push({ uid: r.id, bag });
      }
      const leadler = baglar.length === 0 ? [] : (await havuz.query(LEAD_KODLARI_SQL, [kiraci, [...new Set(baglar.map(b => b.bag.leadId))]])).rows;
      const guncelKod = new Map<string, string | null>();
      for (const l of leadler) if (typeof l.id === 'string') guncelKod.set(l.id, bagCariKodu(l.k));
      res.status(200).json({
        hesaplar: baglar.map(({ uid, bag }) => ({
          uid, leadId: bag.leadId, firma: bag.firma, durum: bag.durum, guncelleme: bag.guncelleme,
          cariKodDurumu: cariKodDurumu(bag.cariKod, guncelKod.get(bag.leadId) ?? null),
        })),
      });
    } catch (e) {
      console.error('[musteri-hesap] liste okunamadı:', hataKodu(e));
      if (!res.headersSent) res.status(500).json({ ok: false });
    }
  });

  app.put('/api/admin/musteri-hesaplari/:uid', C.authLimiter, C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    try {
      if (!(await yonetici(req, res))) return;
      const govde = MusteriBagGovdesi.safeParse(req.body);
      if (!govde.success) { res.status(400).json({ ok: false, error: 'Gövde yalnız `leadId` taşır.' }); return; }
      const uid = hedefUid(req);
      const hedef = uid === '' ? null : await hedefKullanici(uid);
      if (hedef === null) { res.status(404).json({ ok: false, error: 'Kullanıcı kaydı bulunamadı.' }); return; }
      if (!C.isSuperAdmin(req) && hedef.kiraci !== await C.reqCompanyId(req)) { res.status(403).json({ ok: false, error: 'Bu kullanıcı başka bir firmaya ait.' }); return; }
      if (!disRolMu(hedef.rol)) { res.status(400).json({ ok: false, kod: 'dis-rol-degil', error: 'Cari bağı yalnız müşteri (B2B / Bayi) hesabına kurulur.' }); return; }
      const actor = C.reqActor(req);
      const sonuc = await musteriBagiKur(M, { uid, kiraci: hedef.kiraci, leadId: govde.data.leadId, olusturan: actor.uid });
      if (sonuc.sonuc === 'gecersiz') { res.status(400).json({ ok: false, error: 'Geçerli bir cari seçin.' }); return; }
      if (sonuc.sonuc === 'lead-yok') { res.status(404).json({ ok: false, error: 'Seçilen cari bulunamadı.' }); return; }
      // Bağ ya da cari kodu değiştiyse açık mağaza oturumu kapanır (yazımdan SONRA; eski kodla açılmış liste görünmesin).
      const iptalYazildi = sonuc.bagDegisti ? await iptalEt(uid, hedef.kiraci, false) : true;
      const eski = sonuc.onceki;
      try {
        await C.writeAuditLog(actor, 'musteri_hesap_bag',
          `${uid}: lead ${eski?.leadId ?? '—'} → ${sonuc.kayit.leadId} · cari ${eski?.cariKod ?? '—'} → ${sonuc.kayit.cariKod ?? '—'}`);
      } catch (e) { console.error('[musteri-hesap] bağ denetim kaydı yazılamadı:', hataKodu(e)); }
      res.status(200).json({
        ok: true,
        cariKodDurumu: cariKodDurumu(sonuc.kayit.cariKod, sonuc.kayit.cariKod),
        mfSayisi: await mfSayisi(hedef.kiraci, sonuc.kayit.cariKod),
        ...(iptalYazildi ? {} : { iptalYazilamadi: true }),
      });
    } catch (e) {
      console.error('[musteri-hesap] bağ yazılamadı:', hataKodu(e));
      if (!res.headersSent) res.status(503).json({ ok: false });
    }
  });

  app.post('/api/admin/musteri-hesaplari/:uid/durum', C.authLimiter, C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    try {
      if (!(await yonetici(req, res))) return;
      const govde = MusteriDurumGovdesi.safeParse(req.body);
      if (!govde.success) { res.status(400).json({ ok: false, error: 'Gövde yalnız `durum` (acik / kapali) taşır.' }); return; }
      const uid = hedefUid(req);
      const snap = uid === '' ? null : await C.getAdminDb().collection(MUSTERI_HESAP_KOLEKSIYONU).doc(uid).get();
      const bag = snap !== null && snap.exists ? musteriHesabiCoz(snap.data()) : null;
      if (bag === null) { res.status(404).json({ ok: false, error: 'Bu hesabın cari bağı yok.' }); return; }
      if (!C.isSuperAdmin(req) && bag.companyId !== await C.reqCompanyId(req)) { res.status(403).json({ ok: false, error: 'Bu hesap başka bir firmaya ait.' }); return; }
      const durum = govde.data.durum;
      // Sıra (kapatma): bağ yazılır (hata 503) → ortak iptal (hata: 200 + `iptalYazilamadi` — süreç içi değer zaten «şimdi»; kapı bağı
      // her istekte yeniden okuduğu için belirteç yine ölür) → Firebase yenileme iptali (en iyi çaba). Açma: yalnız bağ (iptal kaydı
      // yüzünden yeniden şifreli giriş gerekir).
      let yazim: Awaited<ReturnType<typeof musteriHesapDurumuYaz>>;
      try {
        yazim = await musteriHesapDurumuYaz(M, { uid, durum });
      } catch (e) {
        console.error('[musteri-hesap] erişim durumu yazılamadı:', hataKodu(e));
        res.status(503).json({ ok: false });
        return;
      }
      if (yazim === null) { res.status(404).json({ ok: false, error: 'Bu hesabın cari bağı yok.' }); return; }
      const iptalYazildi = durum === 'kapali' ? await iptalEt(uid, bag.companyId, true) : true;
      try {
        await C.writeAuditLog(C.reqActor(req), 'musteri_hesap_durum', `${uid}: ${yazim.onceki.durum} → ${durum}`);
      } catch (e) { console.error('[musteri-hesap] durum denetim kaydı yazılamadı:', hataKodu(e)); }
      res.status(200).json({ ok: true, durum, ...(iptalYazildi ? {} : { iptalYazilamadi: true }) });
    } catch (e) {
      console.error('[musteri-hesap] erişim durumu işlenemedi:', hataKodu(e));
      if (!res.headersSent) res.status(500).json({ ok: false });
    }
  });
}
