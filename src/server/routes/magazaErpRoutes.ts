/**
 * magazaErpRoutes.ts — mağaza taleplerinin ERP KÖKENİNDEKİ (app.cetpa.com.tr) uçları (dilim 2a § 3.2, § 4; dilim 2b § 10.3).
 *
 *   POST /api/magaza-panel/yetki-kodu               — «ERP ile bağlan»: site paneli için tek kullanımlık yetki kodu (§ 3.2)
 *   POST /api/magaza-talepleri/:id/durum            — aşama / müşteriye görünen açıklama (SAKLANAN sözlük: `yeni`)
 *   POST /api/magaza-talepleri/:id/kalem-teslim     — kalem kalem «teslim edildi» işareti
 *   POST /api/magaza-talepleri/:id/bildirim-gonder  — bildirimi elle yeniden kuyruğa alma (V22 «Yeniden gönder»);
 *                                                     2b: `?tur=revize` → revize bildirimi (`bildirimRevize`)
 *   POST /api/magaza-talepleri                      — (2b) ERP'de ELLE talep açma (numarayı sunucu üretir)
 *   POST /api/magaza-talepleri/:id/icerik           — (2b) içerik düzenleme: müşteri bilgileri, not, TEYİT edilen kalemler
 *   POST /api/magaza-talepleri/:id/sil              — (2b) yumuşak silme; `geriAl: true` → geri alma (ikisi de yalnız Yönetici)
 *
 * KONUM: öbür rota modülleriyle, genel gövde ayrıştırıcıdan (`app.use(express.json(…))`) SONRA kaydolur — öne alınırsa bütün
 * POST'lar gövdesiz kalır (mikroRoutes arıza sınıfı). Bu yüzden zincirde 415 denetimi YOKTUR: yanlış içerik türünde genel
 * ayrıştırıcı gövdeyi atlar, `.strict()` şeması 400 verir; 413 yalnız `express.json` boyut sınırından gelir.
 *
 * YETKİ KODU UCUNDA EK KAPI (inceleme 2026-10-10): `iptalKapisi` — Firebase belirtecinin İPTAL denetimli doğrulaması. `requireAuth`
 * belirteci yerel doğrular, iptale BAKMAZ (ve değişmez): ERP çıkışı refresh token'ları iptal etse de eldeki kimlik belirteci
 * süresi dolana dek (≤ 1 saat) geçerlidir; kapı olmasaydı çıkıştan SONRA o belirteçle yeni yetki kodu — 8 saatlik panel
 * belirteci — alınabilirdi. Kapı sınırlayıcıdan SONRADIR (kullanıcı başına 10 / 15 dk → Firebase'e en çok o kadar çağrı).
 *
 * ZİNCİRLER: üç 2a talep ucu `requireAuth` → `requireMfaVerified` → `C.dbLimiter` (`/api/db/session/logout` ile aynı kova).
 * Üç 2b ucu (elle talep, içerik, silme / geri alma) `requireAuth` → `requireMfaVerified` → `C.magazaIcerikLimiter` (kullanıcı
 * başına 60 / 15 dk; 429'u bu modülün `magazaIcerik429` işlevi yazar) — içerik yazımı ve elle talep e-posta bildirimi üretir,
 * gevşek `dbLimiter` (2.000 / dk) buna sel koruması olmaz. Yetki `requireCollectionAccess` ile DEĞİL: `'write'` üç rolü de
 * reddeder, `'read'` süper-yöneticiyi rolüne bakmadan geçirir. Rol, kiracı ve ad her istekte `panelKullanicisi(uid)`'den okunur
 * (hatayı YUTMAZ → 503) ve `magazaTalepIslemYetkisi(rol)` ile — silme / geri almada `magazaTalepSilmeYetkisi(rol)` (yalnız
 * Yönetici) ile — ölçülür; süper-yönetici baypası YOK. Kiracı gövdeden ALINMAZ: `panelKullanicisi(uid).cid`.
 *
 * YAZMA KURALI BU DOSYADA DEĞİL: `kanal/magazaDurum.ts` (aşama, kalem teslim, elle bildirim) ve `kanal/magazaIcerik.ts` (içerik,
 * silme, geri alma, elle talep) işlevleri — panel uçlarıyla ortak; `kanal: 'erp'`. `/api/db` bu koleksiyona yazamaz
 * (`SUNUCU_YAZAR_COLLECTIONS`) — buradaki uçlar ERP'nin TEK yazma yoludur. Sonuç akıştan gelir: 200 gövdesi yalnız
 * `{ ok: true }` (içerikte ek `degisti`; elle talepte `201 { ok: true, id, talepNo }`). Yazma işlevinin HER sonucu `switch`
 * ile ele alınır; ele alınmamış sonuç DERLENMEZ (`eleAlinmamisSonuc` — 2b'nin `silindi` sonucu `if` zincirinde sessizce 200'e
 * düşüyordu).
 *
 * YANIT GÖVDELERİ SABİTTİR (`{ ok, kod?, durum?, surum?, icerikSurum? }`; `yapilandirilmamis`'ta ek `kip` + eksik ortam
 * değişkeni ADLARI). zod ayrıntısı, hata iletisi, sır / değer DÖNMEZ; günlüğe yalnız sabit metin + hata kodu yazılır.
 */
import type { Express, Request, RequestHandler, Response } from 'express';
import { magazaTalepIslemYetkisi, magazaTalepSilmeYetkisi } from '../../lib/rbac.js';
import type { AppRole } from '../../lib/rbac.js';
import { yetkiBelirteci } from '../istemciIp.js';
import { bildirimiYenidenKuyrugaAl, kalemTeslimYaz, talepDurumunuDegistir } from '../kanal/magazaDurum.js';
import type { MagazaDurumDeps, MagazaIcerikDeps } from '../kanal/magazaDurum.js';
import { elleTalepAc, talepGeriAl, talepIcerigiDegistir, talepSil, urunKdvOkumaHatasiMi } from '../kanal/magazaIcerik.js';
import type { IcerikDegistirSonucu, TalepGeriAlSonucu, TalepSilSonucu } from '../kanal/magazaIcerik.js';
import { MAGAZA_PANEL_KOD_OMRU_MS, kodOzetiHesapla, panelKoduUret } from '../kanal/magazaPanelKod.js';
import type { PanelKodDeposu } from '../kanal/magazaPanelKod.js';
import type { PanelKullanicisi } from '../kanal/magazaPanelKullanici.js';
import {
  BildirimGonderGovdesi, BildirimGonderSorgusu, ErpDurumGovdesi, ErpElleTalepGovdesi, ErpIcerikGovdesi, ErpSilGovdesi, KalemTeslimGovdesi,
  YetkiKoduGovdesi,
} from '../schemas.js';
import type { SmtpKipi } from '../smtpPosta.js';
import { eleAlinmamisSonuc, magazaPanelSay } from './magazaPanelZinciri.js';
import { hataKodu } from './magazaRoutes.js';
import type { MagazaPgHavuzu } from './magazaRoutes.js';

/** server.ts'ten ihtiyaç duyulan HER ŞEY — açık liste (import DEĞİL; döngü olurdu). */
export interface MagazaErpRouteCtx {
  requireAuth: RequestHandler;
  requireMfaVerified: RequestHandler;
  /** server.ts `dbLimiter`'ının KENDİSİ (tanımı `if (pgPool) {` bloğunun dışındadır ki bağlama geçebilsin). */
  dbLimiter: RequestHandler;
  /** 10 / 15 dk, kullanıcı anahtarlı; 429 yanıtını bu modülün `magazaYetkiKodu429` işlevi üretir. */
  magazaYetkiKoduLimiter: RequestHandler;
  /**
   * (2b) Elle talep / içerik / silme (ve geri alma) uçlarının ORTAK kovası: 60 / 15 dk, kullanıcı anahtarlı; 429 yanıtını bu
   * modülün `magazaIcerik429` işlevi üretir. Zincirde kimlik ve MFA kapısından SONRADIR (reddedilen istek kovaya sayılmaz).
   */
  magazaIcerikLimiter: RequestHandler;
  /** Kullanıcı okuyucu (§ 3.5) — panel kapısıyla AYNI örnek; hatayı YUTMAZ. */
  panelKullanicisi: (uid: string) => Promise<PanelKullanicisi | null>;
  /** Yetki kodu deposu — `/api/magaza/panel/oturum` (okuyup silen) ile AYNI örnek. */
  kodDeposu: PanelKodDeposu;
  /**
   * Firebase kimlik belirtecinin İPTAL denetimli doğrulaması (server.ts: `getAuth().verifyIdToken(belirtec, true)`). YALNIZ
   * yetki kodu ucunun `iptalKapisi` çağırır. Geçerliyse çözülür; iptal / devre dışı / silinmiş kullanıcıda Firebase'in
   * `auth/…` kodlu hatasıyla, denetim yapılamıyorsa (ağ, kimlik bilgisi) başka bir hatayla reddeder.
   */
  belirtecIptalDenetle: (belirtec: string) => Promise<unknown>;
  /** İptal denetiminin bekleme tavanı (ms; test için). Varsayılan `MAGAZA_IPTAL_DENETIMI_SURESI_MS`. */
  iptalDenetimiSuresiMs?: number;
  getPgPool: () => MagazaPgHavuzu | null;
  broadcastDocChange: MagazaDurumDeps['broadcastDocChange'];
  writeAuditLog: MagazaDurumDeps['writeAuditLog'];
  /** Dilim 1'in enjekte edilmiş bildirim isteği (`magazaBildirimIste`): asla reddetmez; iş verisi yalnız `{ talepId }`. */
  bildirimIste: MagazaDurumDeps['bildirimIste'];
  /**
   * (2b) Revize bildirimi isteği — İKİNCİ kuyruk (`MAGAZA_REVIZE_KUYRUGU`), `bildirimIste` ile AYNI sözleşme ve aynı isteyici
   * kalıbı (server.ts kurar; modül pg-boss görmez). İçerik yazımı ve `bildirim-gonder?tur=revize` yazma işlevinin İÇİNDEN,
   * yanıttan ÖNCE çağırır.
   */
  revizeBildirimiIste: MagazaIcerikDeps['revizeBildirimiIste'];
  /** Yalnız kip + eksik ortam değişkeni ADLARI (değer yok). */
  smtpYapilandirmasi: () => { tamam: boolean; eksik: string[]; kip: SmtpKipi };
  /** Sunucu kiracısı (önbelleksiz; yetki kodu ucu seyrek çağrılır). */
  serverTenantId: () => Promise<string>;
  /**
   * Panelin dönüş adresi — doğrulanmış KURALLI biçim (`origin + pathname`; ham ortam metni DEĞİL). `null` = panel
   * yapılandırılmamış (dönüş adresi geçersiz ya da panel anahtarı yok): kod üretilmez, 503 `panel-yapilandirilmamis`.
   */
  panelDonus: string | null;
  /** Saat (test için). */
  simdi?: () => Date;
  /**
   * (2b) Elle talep numarası üreteci (test için — numara çakışması başka yoldan üretilemez). Varsayılan
   * `kanal/magazaIcerik.ts` `elleTalepNoUret`; server.ts VERMEZ.
   */
  elleNoUret?: MagazaIcerikDeps['elleNoUret'];
}

/**
 * İptal denetiminin bekleme tavanı. Firebase yönetici kitaplığı tek isteği 25 sn bekler ve 4 kez yineler; Google'a çıkış
 * tıkandığında (bu sunucuda yaşandı) onay düğmesi dakikalarca asılı kalmasın.
 */
export const MAGAZA_IPTAL_DENETIMI_SURESI_MS = 4000;

/**
 * Firebase'in «bu belirteç / kullanıcı artık geçersiz» dediği hata kodları — KAPALI küme (firebase-admin 14
 * `lib/auth/error.js`: `ID_TOKEN_REVOKED`, `USER_DISABLED`, `USER_NOT_FOUND`, `ID_TOKEN_EXPIRED`; önek `auth/`). Günlük
 * deseni `/` taşımadığı için kod `firebaseKodu` ile `auth.…` biçiminde karşılaştırılır.
 */
const FIREBASE_IPTAL_KODLARI: ReadonlySet<string> = new Set([
  'auth.id-token-revoked', 'auth.user-disabled', 'auth.user-not-found', 'auth.id-token-expired',
]);

/** Hatanın `code` alanı (dizgeyse), `/` → `.` (`auth/id-token-revoked` → `auth.id-token-revoked`); yoksa boş. İleti OKUNMAZ. */
function firebaseKodu(hata: unknown): string {
  const kod = typeof hata === 'object' && hata !== null && 'code' in hata ? hata.code : undefined;
  return typeof kod === 'string' ? kod.replaceAll('/', '.') : '';
}

/** Söz `ms` içinde sonuçlanmazsa `ETIMEDOUT` koduyla reddeder; zamanlayıcı her durumda temizlenir (geç sonuç yok sayılır). */
function sureli<T>(soz: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((coz, reddet) => {
    const sayac = setTimeout(() => { reddet(Object.assign(new Error('zaman aşımı'), { code: 'ETIMEDOUT' })); }, ms);
    void soz.then(coz, reddet).finally(() => { clearTimeout(sayac); });
  });
}

/** `magazaYetkiKoduLimiter`'ın `handler` seçeneği: sayaç + sabit `429 { ok: false, kod: 'sinir' }`. */
export function magazaYetkiKodu429(_req: Request, res: Response): void {
  magazaPanelSay('yetkiKoduRet');
  res.setHeader('Cache-Control', 'no-store');
  res.status(429).json({ ok: false, kod: 'sinir' });
}

/** `magazaIcerikLimiter`'ın `handler` seçeneği (2b): sayaç + sabit `429 { ok: false, kod: 'sinir' }`. */
export function magazaIcerik429(_req: Request, res: Response): void {
  magazaPanelSay('icerik429');
  res.setHeader('Cache-Control', 'no-store');
  res.status(429).json({ ok: false, kod: 'sinir' });
}

export function magazaErpRoutes(app: Express, C: MagazaErpRouteCtx): void {
  const simdi = (): Date => C.simdi?.() ?? new Date();
  /**
   * Yazma işlevlerinin bağımlılıkları (`kanal/magazaDurum.ts`, `kanal/magazaIcerik.ts`) — 2b'nin GENİŞ bağlamı. Revize
   * isteyicisi sayaçlı sarmalayıcıdan geçer: «istendi» her çağrıda, «istenemedi» yalnız isteyici sözleşmesine AYKIRI
   * reddederse artar (yazma işlevi reddi yakalar, yazımı geri almaz; kaçan süpürmesi `bekliyor`u sahiplenir).
   */
  const D: MagazaIcerikDeps = {
    getPgPool: C.getPgPool, broadcastDocChange: C.broadcastDocChange, writeAuditLog: C.writeAuditLog, bildirimIste: C.bildirimIste, simdi,
    ...(C.elleNoUret !== undefined ? { elleNoUret: C.elleNoUret } : {}),
    revizeBildirimiIste: async (talepId) => {
      magazaPanelSay('revizeBildirimIstendi');
      try {
        await C.revizeBildirimiIste(talepId);
      } catch (e) {
        magazaPanelSay('revizeBildirimIstenemedi');
        throw e;
      }
    },
  };

  /** `requireAuth`'un yazdığı kimlik. E-posta Firebase belirtecindendir (denetim kaydına gider). */
  const kimlik = (req: Request): { uid: string; eposta: string } => {
    const r = req as Request & { uid?: string; userEmail?: string };
    return { uid: typeof r.uid === 'string' ? r.uid : '', eposta: typeof r.userEmail === 'string' ? r.userEmail : '' };
  };
  const talepKimligi = (req: Request): string => (typeof req.params.id === 'string' ? req.params.id : '');

  /**
   * Yetki: `panelKullanicisi(uid)` (fırlatırsa `503 { ok: false }`; yoksa 403) → `yetki(rol)` (değilse
   * `403 { ok: false, kod: 'rol' }`). Varsayılan ölçüt `magazaTalepIslemYetkisi` (Yönetici / Müdür / Satış); silme ve geri
   * alma `magazaTalepSilmeYetkisi` verir (yalnız Yönetici). Ret yanıtını KENDİSİ yazar ve `null` döner.
   */
  const yetkili = async (
    req: Request, res: Response, yetki: (rol: AppRole | null) => boolean = magazaTalepIslemYetkisi,
  ): Promise<{ uid: string; eposta: string; kullanici: PanelKullanicisi } | null> => {
    const { uid, eposta } = kimlik(req);
    if (uid === '') { res.status(401).json({ ok: false }); return null; }
    let kullanici: PanelKullanicisi | null;
    try {
      kullanici = await C.panelKullanicisi(uid);
    } catch (e) {
      console.error('[magaza-erp] kullanıcı okunamadı:', hataKodu(e));
      res.status(503).json({ ok: false });
      return null;
    }
    if (kullanici === null || !yetki(kullanici.rol)) { res.status(403).json({ ok: false, kod: 'rol' }); return null; }
    return { uid, eposta, kullanici };
  };
  /** Yazma işlevine giden «kim»: `ad` yazma anında `panelKullanicisi(uid).ad`, e-posta Firebase belirtecinden. */
  const yazan = (y: { uid: string; eposta: string; kullanici: PanelKullanicisi }): { uid: string; ad: string; eposta: string } =>
    ({ uid: y.uid, ad: y.kullanici.ad, eposta: y.eposta });
  /** Sunucu kiracısı (önbelleksiz); çözülemezse `''` — çağıran 503 döner (yetkisizlik DEĞİLDİR). ASLA fırlatmaz. */
  const sunucuKiracisi = async (): Promise<string> => {
    let kiraci = '';
    try { kiraci = await C.serverTenantId(); } catch { kiraci = ''; }
    return typeof kiraci === 'string' && kiraci.trim() !== '' ? kiraci : '';
  };
  const hata500 = (res: Response, e: unknown, is: string): void => {
    console.error(`[magaza-erp] ${is} işlenemedi:`, hataKodu(e));
    if (!res.headersSent) res.status(500).json({ ok: false });
  };
  const onbelleksiz: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };

  // ── § 3.2 İptal edilmiş Firebase belirteci kod ALAMAZ (inceleme 2026-10-10; dosya başı «EK KAPI») ────────────────
  //  • Firebase «iptal / devre dışı / kullanıcı yok / süresi doldu» derse → `401 { ok: false }` (onay sayfası «oturum»
  //    metnini basar: çıkış yapıp yeniden giriş). Kod ÜRETİLMEZ.
  //  • Denetim YAPILAMAZSA (ağ, süre aşımı, sunucuda Firebase hizmet hesabı kimliği yok) kod YİNE verilir — bu kapı
  //    eklenmeden önceki davranış. Gerekçe: denetim ek bir savunma katmanıdır; Google'a erişimin kesilmesi ya da hizmet
  //    hesabı kimliğinin bulunmaması «ERP ile bağlan»ı bütünüyle durdurmasın (çıkıştan önce alınmış kodu `oturum` ucu
  //    zaten yerel denetimle öldürür). SESSİZ DEĞİL: her seferinde sayaç (`yetkiKoduIptalDenetimsiz`, bekçi yazar) + uyarı.
  const iptalDenetimiSuresi = C.iptalDenetimiSuresiMs === undefined ? MAGAZA_IPTAL_DENETIMI_SURESI_MS : C.iptalDenetimiSuresiMs;
  const iptalKapisi: RequestHandler = async (req, res, next) => {
    // Ayıklama `requireAuth` ile AYNI işlevden: denetlenen belirteç, kapının az önce kabul ettiği belirteçtir.
    const belirtec = yetkiBelirteci(req.headers.authorization);
    if (belirtec === '') { magazaPanelSay('yetkiKoduRet'); res.status(401).json({ ok: false }); return; }
    try {
      await sureli(C.belirtecIptalDenetle(belirtec), iptalDenetimiSuresi);
    } catch (e) {
      const err = { code: firebaseKodu(e) };
      if (FIREBASE_IPTAL_KODLARI.has(err.code)) { magazaPanelSay('yetkiKoduRet'); res.status(401).json({ ok: false }); return; }
      magazaPanelSay('yetkiKoduIptalDenetimsiz');
      console.warn('[magaza-erp] yetki kodu: belirteç iptali denetlenemedi, kod yine verilir:', hataKodu(err));
    }
    next();
  };

  // ── § 3.2 Yetki kodu ────────────────────────────────────────────────────────────────────────────────────────────
  // Sayfa (`/magaza-panel-baglan`) kullanıcı düğmeye basınca çağırır. İstekten dönüş adresine HİÇBİR parça alınmaz (açık
  // yönlendirme yok): `donus = panelDonus + '#kod=' + kod + '&tur=' + tur`; `tur` yalnız geri yansıtılır (şema: 22 base64url).
  const yetkiKodu = async (req: Request, res: Response): Promise<void> => {
    const ret = (kod: number, govde: Record<string, unknown>): void => { magazaPanelSay('yetkiKoduRet'); res.status(kod).json(govde); };
    try {
      const cozum = YetkiKoduGovdesi.safeParse(req.body);
      if (!cozum.success) { ret(400, { ok: false }); return; }
      if (C.panelDonus === null) { ret(503, { ok: false, kod: 'panel-yapilandirilmamis' }); return; }
      const { uid, eposta } = kimlik(req);
      if (uid === '') { ret(401, { ok: false }); return; }
      let kullanici: PanelKullanicisi | null;
      try {
        kullanici = await C.panelKullanicisi(uid);
      } catch (e) {
        console.error('[magaza-erp] yetki kodu: kullanıcı okunamadı:', hataKodu(e));
        ret(503, { ok: false });
        return;
      }
      if (kullanici === null || !magazaTalepIslemYetkisi(kullanici.rol)) { ret(403, { ok: false, kod: 'rol' }); return; }
      // Sunucu kiracısı BOŞSA bu bir yetkisizlik değildir (ortam değişkeni yok + tarama tek kiracı bulamadı / tarama hatası).
      const kiraci = await sunucuKiracisi();
      if (kiraci === '') { ret(503, { ok: false, kod: 'panel-yapilandirilmamis' }); return; }
      // Mağaza talepleri yalnız sunucu kiracısına yazılır: başka kiracının kullanıcısına boş panel yerine açık ret.
      if (kullanici.cid !== kiraci) { ret(403, { ok: false, kod: 'kiraci' }); return; }

      const kod = panelKoduUret();
      C.kodDeposu.ver({
        kodOzeti: kodOzetiHesapla(kod), meydan: cozum.data.meydan, uid, cid: kullanici.cid, ad: kullanici.ad, eposta,
        mfa: kullanici.mfaAcik, bitis: simdi().getTime() + MAGAZA_PANEL_KOD_OMRU_MS,
      });
      magazaPanelSay('yetkiKodu');
      res.status(200).json({ donus: `${C.panelDonus}#kod=${kod}&tur=${cozum.data.tur}` });
    } catch (e) {
      magazaPanelSay('yetkiKoduRet');
      hata500(res, e, 'yetki kodu');
    }
  };

  // ── § 4 Aşama / açıklama ────────────────────────────────────────────────────────────────────────────────────────
  const durum = async (req: Request, res: Response): Promise<void> => {
    try {
      const y = await yetkili(req, res);
      if (!y) return;
      const cozum = ErpDurumGovdesi.safeParse(req.body);
      if (!cozum.success) { res.status(400).json({ ok: false }); return; }
      if (!C.getPgPool()) { res.status(503).json({ ok: false }); return; }
      const sonuc = await talepDurumunuDegistir(D, {
        id: talepKimligi(req), companyId: y.kullanici.cid, onceki: cozum.data.onceki, surum: cozum.data.surum, yeni: cozum.data.durum,
        ...(cozum.data.aciklama !== undefined ? { aciklama: cozum.data.aciklama } : {}),
        kim: yazan(y), kanal: 'erp',
      });
      switch (sonuc.sonuc) {
        case 'tamam':
          magazaPanelSay('durumErp');
          res.status(200).json({ ok: true });
          return;
        case 'bulunamadi':
          res.status(404).json({ ok: false });
          return;
        case 'gecis-yok':
          magazaPanelSay('durumErp409');
          // Güncel aşama SAKLANAN sözlükle; bilinmiyorsa alan YOK (panelle aynı).
          res.status(409).json({ ok: false, kod: 'gecis-yok', ...(sonuc.durum !== null ? { durum: sonuc.durum } : {}) });
          return;
        case 'silindi':
          // (2b) Silinmiş talep DONUKTUR: aşama / açıklama yazılmadı.
          magazaPanelSay('durumErp409');
          res.status(409).json({ ok: false, kod: 'silindi' });
          return;
        default:
          eleAlinmamisSonuc(sonuc);
      }
    } catch (e) { hata500(res, e, 'aşama yazımı'); }
  };

  // ── § 4 Kalem teslim (panelle AYNI şema: `KalemTeslimGovdesi`) ──────────────────────────────────────────────────
  const kalemTeslim = async (req: Request, res: Response): Promise<void> => {
    try {
      const y = await yetkili(req, res);
      if (!y) return;
      const cozum = KalemTeslimGovdesi.safeParse(req.body);
      if (!cozum.success) { res.status(400).json({ ok: false }); return; }
      if (!C.getPgPool()) { res.status(503).json({ ok: false }); return; }
      const sonuc = await kalemTeslimYaz(D, {
        id: talepKimligi(req), companyId: y.kullanici.cid, surum: cozum.data.surum, teslim: cozum.data.teslim,
        kalemler: cozum.data.kalemler, kim: yazan(y), kanal: 'erp',
      });
      switch (sonuc.sonuc) {
        case 'tamam':
          magazaPanelSay('kalemTeslimErp');
          res.status(200).json({ ok: true });
          return;
        case 'bulunamadi':
          res.status(404).json({ ok: false });
          return;
        case 'gecersiz':
          // Tanınmayan / öbür kaynağın anahtarı (2b: teyit yazılmış talepte `b:` anahtarı): hiçbir şey yazılmadı.
          res.status(400).json({ ok: false });
          return;
        case 'gecis-yok':
          magazaPanelSay('kalemTeslimErp409');
          res.status(409).json({ ok: false, kod: 'gecis-yok', ...(sonuc.durum !== null ? { durum: sonuc.durum } : {}) });
          return;
        case 'surum-eski':
          // (2b) Okuma ile yazma arasına teyit yazımı girdi: anahtar kümesi bayat — ekran akıştan yeniler.
          magazaPanelSay('kalemTeslimErp409');
          res.status(409).json({ ok: false, kod: 'surum-eski' });
          return;
        case 'silindi':
          magazaPanelSay('kalemTeslimErp409');
          res.status(409).json({ ok: false, kod: 'silindi' });
          return;
        default:
          eleAlinmamisSonuc(sonuc);
      }
    } catch (e) { hata500(res, e, 'kalem teslim yazımı'); }
  };

  // ── § 4 Bildirimi elle yeniden gönder (V22); 2b: `?tur=revize` → revize bildirimi (§ 10.3) ───────────────────────
  // Sıra: (0) bildirim bilerek KAPALI → 409 `kapali` («eksik ayar» diye gösterilmez); (1) yapılandırma eksik → 409
  // `yapilandirilmamis` + kip + eksik ADLARI; ikisinde de veritabanına gidilmez. (2) yazma işlevi: `zaten-gitti` çift posta
  // engelidir; `revize-yok` = talebin revizyonu yok (yoktan revizyon YARATILMAZ); `silindi` = donuk talep. Kuyruğa ekleme,
  // yayın ve denetim işlevin İÇİNDE, yanıttan ÖNCE. `tur` YALNIZ `revize` değerini alır (yok = ilk bildirim; `ilk` dâhil başka
  // her değer ve tanınmayan parametre 400). Sorgu dizesi kimlik / rol kapısından SONRA ayrıştırılır: kimliksiz
  // `?tur=revize` isteği 401 alır (400 değil — sonda bunu ölçer). Panelde bu uç YOKTUR.
  const bildirimGonder = async (req: Request, res: Response): Promise<void> => {
    try {
      const y = await yetkili(req, res);
      if (!y) return;
      const sorgu = BildirimGonderSorgusu.safeParse({ ...req.query });
      if (!BildirimGonderGovdesi.safeParse(req.body).success || !sorgu.success) { res.status(400).json({ ok: false }); return; }
      const revize = sorgu.data.tur === 'revize';
      // İki bildirimin sayaçları AYRI (revize, ilk bildirim sayacına karışmaz).
      const ret409 = (govde: Record<string, unknown>): void => {
        magazaPanelSay(revize ? 'bildirimGonderRevize409' : 'bildirimGonder409');
        res.status(409).json(govde);
      };
      const smtp = C.smtpYapilandirmasi();
      if (smtp.kip === 'kapali') { ret409({ ok: false, kod: 'kapali' }); return; }
      if (!smtp.tamam) { ret409({ ok: false, kod: 'yapilandirilmamis', kip: smtp.kip, eksik: [...smtp.eksik] }); return; }
      if (!C.getPgPool()) { res.status(503).json({ ok: false }); return; }
      const sonuc = await bildirimiYenidenKuyrugaAl(D, {
        id: talepKimligi(req), companyId: y.kullanici.cid, tur: revize ? 'revize' : 'ilk', kim: yazan(y),
      });
      switch (sonuc.sonuc) {
        case 'tamam':
          magazaPanelSay(revize ? 'bildirimGonderRevize' : 'bildirimGonder');
          res.status(200).json({ ok: true });
          return;
        case 'bulunamadi':
          res.status(404).json({ ok: false });
          return;
        case 'zaten-gitti':
          ret409({ ok: false, kod: 'zaten-gitti' });
          return;
        case 'silindi':
          ret409({ ok: false, kod: 'silindi' });
          return;
        case 'revize-yok':
          ret409({ ok: false, kod: 'revize-yok' });
          return;
        default:
          eleAlinmamisSonuc(sonuc);
      }
    } catch (e) { hata500(res, e, 'elle bildirim'); }
  };

  // ── § 10.3 Elle talep (2b; V15, V20) ────────────────────────────────────────────────────────────────────────────
  // Numarayı SUNUCU üretir; belge mağazadan gelen taleple AYNI eşleyiciden çıkar ve `bildirim: bekliyor` ile dilim 1 kuyruğuna
  // girer (işçi ve bekçi elle talebi AYIRT ETMEZ). Mağaza talepleri yalnız SUNUCU kiracısına yazılır — müşterinin takip ucu
  // kimliği o kiracıyla türetir, bildirim e-postası o kiracının kutusuna gider: başka kiracının kullanıcısı elle talep AÇAMAZ
  // (`403 { kod: 'kiraci' }`; kayıt açık olduğu için bu kapı olmasaydı her yeni hesap o kutuya posta düşürebilirdi). Kiracı
  // çözülemiyorsa ve numara üst üste çakışıyorsa 503. Kuyruğa ekleme başarısız olsa da 201 döner (kayıt geri alınmaz).
  const elleTalep = async (req: Request, res: Response): Promise<void> => {
    try {
      const y = await yetkili(req, res);
      if (!y) return;
      const cozum = ErpElleTalepGovdesi.safeParse(req.body);
      if (!cozum.success) { res.status(400).json({ ok: false }); return; }
      if (!C.getPgPool()) { res.status(503).json({ ok: false }); return; }
      const kiraci = await sunucuKiracisi();
      if (kiraci === '') { res.status(503).json({ ok: false }); return; }
      if (y.kullanici.cid !== kiraci) { res.status(403).json({ ok: false, kod: 'kiraci' }); return; }
      const sonuc = await elleTalepAc(D, { companyId: y.kullanici.cid, girdi: cozum.data, kim: yazan(y) });
      switch (sonuc.sonuc) {
        case 'tamam':
          magazaPanelSay('elleTalep');
          res.status(201).json({ ok: true, id: sonuc.id, talepNo: sonuc.talepNo });
          return;
        case 'gecersiz':
          // Temizlikten sonra zorunlu alan boş ya da telefonda 10 rakam yok (takip ucu aynı `no` + telefonla çalışır).
          res.status(400).json({ ok: false });
          return;
        case 'cakisti':
          magazaPanelSay('elleTalepCakisti');
          res.status(503).json({ ok: false });
          return;
        default:
          eleAlinmamisSonuc(sonuc);
      }
    } catch (e) { hata500(res, e, 'elle talep'); }
  };

  // ── § 10.3 İçerik düzenleme (2b; V15: yalnız ERP) ───────────────────────────────────────────────────────────────
  // Form her zaman TAM gövde gönderir; «ne değişti» sunucuda ölçülür (`degisti`). Müşterinin ilk talebi (`kalemler`,
  // `talepEdilen`) ve toplamlar gövdede KABUL EDİLMEZ (şema `.strict()`): beyan değişmez, teyit toplamlarını sunucu türetir.
  // Revize bildirimi yalnız yazım GERÇEKTEN yapıldıysa, yazma işlevinin içinden ve yanıttan ÖNCE istenir.
  const icerik = async (req: Request, res: Response): Promise<void> => {
    try {
      const y = await yetkili(req, res);
      if (!y) return;
      const cozum = ErpIcerikGovdesi.safeParse(req.body);
      if (!cozum.success) { magazaPanelSay('icerik400'); res.status(400).json({ ok: false }); return; }
      if (!C.getPgPool()) { res.status(503).json({ ok: false }); return; }
      let sonuc: IcerikDegistirSonucu;
      try {
        sonuc = await talepIcerigiDegistir(D, {
          id: talepKimligi(req), companyId: y.kullanici.cid, icerikSurum: cozum.data.icerikSurum,
          musteri: cozum.data.musteri, not: cozum.data.not, teyit: cozum.data.teyit, kim: yazan(y), kanal: 'erp',
        });
      } catch (e) {
        // Ürün KDV oranı okunamadı: yazım YAPILMADI — varsayılan 20 ile sessizce yazılmaz («sahte kesinlik» yasağı) → 503.
        // Başka her hata dıştaki yakalayıcıya gider (500).
        if (!urunKdvOkumaHatasiMi(e)) throw e;
        magazaPanelSay('icerik503');
        console.error('[magaza-erp] içerik yazılmadı, ürün KDV oranı okunamadı:', hataKodu(e));
        res.status(503).json({ ok: false });
        return;
      }
      switch (sonuc.sonuc) {
        case 'tamam':
          magazaPanelSay('icerik');
          res.status(200).json({ ok: true, degisti: true });
          return;
        case 'degisiklik-yok':
          // Verilen hiçbir alan saklıdan farklı değil: yazım, bildirim, denetim YOK.
          magazaPanelSay('icerikDegisiklikYok');
          res.status(200).json({ ok: true, degisti: false });
          return;
        case 'bulunamadi':
          res.status(404).json({ ok: false });
          return;
        case 'gecersiz':
          // Temizlikten sonra boş ad / 10 rakamsız telefon / tanınmayan `t:` / aralık dışı `b:` — hiçbir şey yazılmadı.
          magazaPanelSay('icerik400');
          res.status(400).json({ ok: false });
          return;
        case 'surum-eski':
          magazaPanelSay('icerik409');
          res.status(409).json({ ok: false, kod: 'surum-eski', icerikSurum: sonuc.icerikSurum });
          return;
        case 'silindi':
          magazaPanelSay('icerik409');
          res.status(409).json({ ok: false, kod: 'silindi' });
          return;
        default:
          eleAlinmamisSonuc(sonuc);
      }
    } catch (e) { hata500(res, e, 'içerik yazımı'); }
  };

  // ── § 10.3 Yumuşak silme / geri alma (2b; V17: yalnız Yönetici) ─────────────────────────────────────────────────
  // Kayıt SİLİNMEZ, `silindi` işareti alır; gövdede `geriAl: true` işareti `null` yapar (geri alma — TEK uç, şartname § 10.3).
  // İkisi de bildirim ÜRETMEZ (V20). `surum` = ekranda görülen `durumSurum` (teslim'e geçmiş talep bayat ekrandan silinmesin;
  // silme sayacı artırır, geri alma akıştan gelen güncel değerle yapılır).
  const silYaniti = (res: Response, sonuc: TalepSilSonucu): void => {
    switch (sonuc.sonuc) {
      case 'tamam':
        magazaPanelSay('silErp');
        res.status(200).json({ ok: true });
        return;
      case 'bulunamadi':
        res.status(404).json({ ok: false });
        return;
      case 'zaten-silindi':
        magazaPanelSay('silErp409');
        res.status(409).json({ ok: false, kod: 'silindi' });
        return;
      case 'surum-eski':
        magazaPanelSay('silErp409');
        res.status(409).json({ ok: false, kod: 'surum-eski', surum: sonuc.surum });
        return;
      default:
        eleAlinmamisSonuc(sonuc);
    }
  };
  const geriAlYaniti = (res: Response, sonuc: TalepGeriAlSonucu): void => {
    switch (sonuc.sonuc) {
      case 'tamam':
        magazaPanelSay('geriAl');
        res.status(200).json({ ok: true });
        return;
      case 'bulunamadi':
        res.status(404).json({ ok: false });
        return;
      case 'silinmemis':
        // Geri alınacak bir şey yok.
        magazaPanelSay('geriAl409');
        res.status(409).json({ ok: false, kod: 'silinmemis' });
        return;
      case 'surum-eski':
        magazaPanelSay('geriAl409');
        res.status(409).json({ ok: false, kod: 'surum-eski', surum: sonuc.surum });
        return;
      default:
        eleAlinmamisSonuc(sonuc);
    }
  };
  const sil = async (req: Request, res: Response): Promise<void> => {
    try {
      const y = await yetkili(req, res, magazaTalepSilmeYetkisi);
      if (!y) return;
      const cozum = ErpSilGovdesi.safeParse(req.body);
      if (!cozum.success) { res.status(400).json({ ok: false }); return; }
      if (!C.getPgPool()) { res.status(503).json({ ok: false }); return; }
      const ortak = { id: talepKimligi(req), companyId: y.kullanici.cid, surum: cozum.data.surum, kim: yazan(y) };
      if (cozum.data.geriAl === true) geriAlYaniti(res, await talepGeriAl(D, ortak));
      else silYaniti(res, await talepSil(D, { ...ortak, kanal: 'erp' }));
    } catch (e) { hata500(res, e, 'silme / geri alma'); }
  };

  app.post('/api/magaza-panel/yetki-kodu', onbelleksiz, C.requireAuth, C.requireMfaVerified, C.magazaYetkiKoduLimiter, iptalKapisi, yetkiKodu);
  app.post('/api/magaza-talepleri/:id/durum', C.requireAuth, C.requireMfaVerified, C.dbLimiter, durum);
  app.post('/api/magaza-talepleri/:id/kalem-teslim', C.requireAuth, C.requireMfaVerified, C.dbLimiter, kalemTeslim);
  app.post('/api/magaza-talepleri/:id/bildirim-gonder', C.requireAuth, C.requireMfaVerified, C.dbLimiter, bildirimGonder);
  app.post('/api/magaza-talepleri', C.requireAuth, C.requireMfaVerified, C.magazaIcerikLimiter, elleTalep);
  app.post('/api/magaza-talepleri/:id/icerik', C.requireAuth, C.requireMfaVerified, C.magazaIcerikLimiter, icerik);
  app.post('/api/magaza-talepleri/:id/sil', C.requireAuth, C.requireMfaVerified, C.magazaIcerikLimiter, sil);
}
