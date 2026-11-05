/**
 * magazaBayiZinciri.ts — müşteri / bayi ekranı (www.cetpa.com.tr/bayi.html) uçlarının ALT ZİNCİRİ (2026-10-21, şartname
 * `.wf/SARTNAME-musteri-siparislerim.md` K5–K7, H1–H3, H8, H10–H14). Salt okuma: müşteri ERP hesabıyla girer ve carisinin
 * siparişlerini görür. Sipariş verme, fiyat, iskonto, bakiye, ekstre, başvuru, takip bu dilimde YOK (404).
 *
 * `magazaRoutes.ts` bu zinciri yalnız `r.use('/bayi', C.bayiZinciri)` satırıyla bağlar — panel alt zincirinin ALTINDA, dış
 * zincirin köken kapısından ve genel sınırlayıcıdan ÖNCE (sonra bağlansaydı `GET` ön uçuşu dış kapıda `Allow-Methods: POST` ile
 * biterdi). Zincir her isteği KENDİSİ sonlandırır; eşleşmeyi Express yapar (yol metni karşılaştırması YOK).
 *
 * KAYIT SIRASI SABİT (çit: magazaBayi.zincir.test.ts «kaynak çitleri»):
 *   0. `onbelleksiz` · 1. köken kapısı (ortak `magazaKokenKapisiKur`; `GET, POST` + `Authorization, Content-Type`) ·
 *   1b. yapılandırma kapısı (imza ya da kimlik anahtarı yoksa 503 `bayi-yapilandirilmamis`; kovaya sayılmaz) ·
 *   2-3. `/oturum` kovası + kod → belirteç değişimi · 4. genel bayi kovası · 5. belirteç kapısı ·
 *   6. `ben`, `siparisler`, `cikis` · 7. 404 · 8. hata yakalayıcı (dört parametreli).
 *
 * KAPI (her bayi isteğinde): (1) `mb1-` imzası (bayi anahtarı — panel belirteci ANAHTAR düzeyinde geçersiz) + `bas ≤ şimdi <
 * bitis`; (2) `panelKullanicisi(uid)` YENİDEN — kullanıcı var, rolü DIŞ ROL, `cid === yük.cid === kiracı`, firma askıda değil,
 * MFA açıksa `yük.mfa`; (3) bağ kaydı YENİDEN (`musteriHesaplari/{uid}`; 60 sn önbellek, olayla düşer) — var, `durum: 'acik'`,
 * `companyId` kiracıyla aynı; (4) iptal: `yük.bas > gecersizOnce(uid)` (ERP çıkışı, mağaza çıkışı, erişim kapatma ve bağ değişimi
 * aynı ortak iptal örneğine yazar). (1)–(4) reddi 401'dir; okuma HATASI ve boş kiracı `503 { ok: false }`.
 *
 * YANIT GÖVDELERİ: `oturum` 200 `{ token, bitis (ms), bayi: { firma } }`; `ben` → `{ bayi: { firma }, ozet: { bakiye: null,
 * vadesiGecen: null, acikSiparis: null } }` (iskonto / özel oran / vade anahtarı HİÇ yok); `siparisler` → `{ siparisler: [{ id, no,
 * tarih, durum, kalemler: [{ sku, ad, adet }] }] }` (tek süzgeç: kanal/magazaBayiSiparis); retler `{ ok: false }` (+ yalnız
 * yapılandırmada `kod`).
 *
 * GÜNLÜK: kişisel veri, gövde, kod, doğrulayıcı, belirteç YAZILMAZ; yalnız sabit metin + hata kodu (`hataKodu`). Sayaçlar AYRI
 * kümedir (`magazaBayiSayaclari()`; panel kümesine EKLENMEZ — bayi isteği `magazaPanelSayaclari()`'nı artırmaz). ERP kökenindeki
 * bayi köprü uçları (`magazaErpRoutes.ts`) da BU kümeye sayar (`magazaBayiSay`). Modül bekçiyle AYNI yoldan içe aktarılır.
 */
import express, { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi.js';
import { disRolMu } from '../../lib/kimlikYuzeyi.js';
import { yetkiBelirteci } from '../istemciIp.js';
import {
  BAYI_SIPARIS_ADAY_SQL, BAYI_SIPARIS_ADAY_UYARI_SINIRI, BAYI_SIPARIS_GOVDE_SQL, BAYI_BEN_OZETI, bayiSiparisKimligi, bayiSiparisListesi,
  bayiSiparisParametreleri, bayiSiparisSirasi,
} from '../kanal/magazaBayiSiparis.js';
import type { MagazaDurumDeps } from '../kanal/magazaDurum.js';
import { BAYI_BELIRTECI, MAGAZA_BAYI_BELIRTEC_OMRU_MS, belirtecCoz, belirtecSuresiIcinde, belirtecUret } from '../kanal/magazaPanelBelirtec.js';
import type { PanelBelirtecYuku } from '../kanal/magazaPanelBelirtec.js';
import type { PanelIptalCifti } from '../kanal/magazaPanelIptal.js';
import { MAGAZA_BAYI_KOD_OMRU_MS, kodOzetiHesapla, meydanEslesiyor } from '../kanal/magazaPanelKod.js';
import type { PanelKodDeposu } from '../kanal/magazaPanelKod.js';
import type { PanelKullanicisi } from '../kanal/magazaPanelKullanici.js';
import type { MusteriHesabi } from '../musteriHesap.js';
import { PanelOturumGovdesi } from '../schemas.js';
import { MAGAZA_GOVDE_SINIRI_BAYT, hataKodu, magazaIzinliKokenleriCoz, magazaKiraciCozucuKur, magazaKokenKapisiKur } from './magazaRoutes.js';
import type { MagazaPgHavuzu } from './magazaRoutes.js';

/** server.ts'ten ihtiyaç duyulan HER ŞEY — açık liste (import DEĞİL; döngü olurdu). Örnekler server.ts'te BİR kez kurulur. */
export interface MagazaBayiCtx {
  /** `/oturum` ve öbür bayi uçlarının sınırlayıcıları — yalnız IP anahtarlı, server.ts'te kurulur; 429'u `magazaBayi429` yazar. */
  bayiOturumSinirlayici: RequestHandler;
  bayiSinirlayici: RequestHandler;
  /** Bayi belirteci imza anahtarı (`anahtarTuret(BAYI_BELIRTECI, …)`); `null` → bütün uçlar 503 `bayi-yapilandirilmamis`. */
  bayiAnahtari: Buffer | null;
  /** Opak sipariş kimliği anahtarı (`bayiKimlikAnahtariTuret`; imza anahtarından AYRI); `null` → 503 `bayi-yapilandirilmamis`. */
  bayiKimlikAnahtari: Buffer | null;
  /** Kullanıcı okuyucu — panel ve ERP uçlarıyla AYNI örnek; hatayı YUTMAZ (kapı 503). */
  panelKullanicisi: (uid: string) => Promise<PanelKullanicisi | null>;
  /** Bağ okuyucu (`musteriHesapOkuyucuKur`); hatayı YUTMAZ. */
  musteriHesabi: (uid: string) => Promise<MusteriHesabi | null>;
  /** Bayi yetki kodu deposu — `magazaErpRoutes` bayi yetki kodu ucuyla AYNI örnek, panel deposundan AYRI. */
  kodDeposu: PanelKodDeposu;
  /** İptal çifti — panel ve ERP çıkışıyla ORTAK örnek (ERP çıkışı bayi belirteçlerini de öldürür). */
  iptal: PanelIptalCifti;
  /** Firebase yenileme belirteçlerinin iptali (server.ts `firebaseYenilemeIptal` — TEK yardımcı). */
  firebaseYenilemeIptal: (uid: string) => Promise<void>;
  /** PostgreSQL havuzu; yoksa liste ucu 503 döner, `adminDb`'ye DÜŞÜLMEZ. */
  getPgPool: () => MagazaPgHavuzu | null;
  serverTenantId: () => Promise<string>;
  writeAuditLog: MagazaDurumDeps['writeAuditLog'];
  /** İzinli kökenler (varsayılan `MAGAZA_IZINLI_KOKENLER`). Test için. */
  izinliKokenler?: () => readonly string[];
  /** Saat (test için). */
  simdi?: () => Date;
}

// ── Süreç içi sayaçlar (AYRI küme; bekçi okur) ───────────────────────────────────────────────────────────────────────
const sayaclar = {
  /** Kod → belirteç: başarılı / 401 / 503. */
  oturum: 0, oturum401: 0, oturum503: 0,
  /** ERP kökeni yetki kodu: verildi / ret (400, 401, 403, 429, 503) / Firebase iptal denetimi yapılamadı (kod VERİLMEDİ, 503). */
  yetkiKodu: 0, yetkiKoduRet: 0, yetkiKoduIptalDenetlenemedi: 0,
  /** ERP kökeni firma okuma ucu (onay sayfası): 200 / ret. */
  hesap: 0, hesapRet: 0,
  /** Hesap özeti ve liste okumaları; aday satır uyarı sınırını aşan liste sorgusu. */
  ben: 0, siparisler: 0, siparisAdayFazla: 0,
  /** Mağaza çıkışı; Firebase yenileme iptali yazılamadı (çıkış yine 204). */
  cikis: 0, cikisFirebaseIptalYazilamadi: 0,
  /** Zincirin retleri. */
  r401: 0, r403: 0, r404: 0, r429: 0, r500: 0, r503: 0,
};
export type MagazaBayiSayaci = keyof typeof sayaclar;

/** Süreç içi bayi sayaçları (bekçi okur). Dönen nesne kopyadır. */
export function magazaBayiSayaclari(): Readonly<Record<string, number>> {
  return { ...sayaclar };
}

/** Sayaçları sıfırlar — YALNIZ test için. */
export function magazaBayiSayaclariniSifirla(): void {
  for (const anahtar of Object.keys(sayaclar) as MagazaBayiSayaci[]) sayaclar[anahtar] = 0;
}

/** Tek sayaç artırır — `magazaErpRoutes.ts` bayi köprü uçları için (sayaçlar TEK modül örneğinde). */
export function magazaBayiSay(anahtar: MagazaBayiSayaci): void {
  sayaclar[anahtar] += 1;
}

type RetKodu = 401 | 403 | 404 | 429 | 500 | 503;
const RET_SAYACI: Readonly<Record<RetKodu, MagazaBayiSayaci>> = { 401: 'r401', 403: 'r403', 404: 'r404', 429: 'r429', 500: 'r500', 503: 'r503' };
const retSayaciVar = (kod: number): kod is RetKodu => Object.hasOwn(RET_SAYACI, kod);

/** Sabit ret: (varsa) sayaç + `{ ok: false }`. */
function reddet(res: Response, kod: number): void {
  if (retSayaciVar(kod)) sayaclar[RET_SAYACI[kod]] += 1;
  res.status(kod).json({ ok: false });
}

/** Bayi sınırlayıcılarının `handler` seçeneği: `r429` (bayi kümesi) + sabit `429 { ok: false }`. */
export function magazaBayi429(_req: Request, res: Response): void {
  reddet(res, 429);
}

const nesneMi = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

interface BayiIstegi { yuk: PanelBelirtecYuku; kullanici: PanelKullanicisi; bag: MusteriHesabi }

export function magazaBayiZinciri(C: MagazaBayiCtx): Router {
  const simdi = (): Date => C.simdi?.() ?? new Date();
  const izinliKokenler = (): readonly string[] => C.izinliKokenler?.() ?? magazaIzinliKokenleriCoz(process.env.MAGAZA_IZINLI_KOKENLER);
  const kiraciCoz = magazaKiraciCozucuKur(() => C.serverTenantId(), simdi);
  const istekBaglami = new WeakMap<Request, BayiIstegi>();

  // 0. Hiçbir bayi yanıtı ara belleğe alınmaz (belirteç, sipariş verisi, 401 / 503 dâhil).
  const onbelleksiz: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };

  // 1. Köken kapısı — ortak işlev; panelle AYNI yöntem / başlık listesi.
  const kokenKapisi = magazaKokenKapisiKur({ izinliKokenler, yontemler: 'GET, POST', basliklar: 'Authorization, Content-Type', reddet });

  // 1b. Yapılandırma kapısı (kovaya sayılmaz).
  const yapilandirmaYok = (res: Response): void => {
    sayaclar.r503 += 1;
    res.status(503).json({ ok: false, kod: 'bayi-yapilandirilmamis' });
  };
  const yapilandirmaKapisi: RequestHandler = (_req, res, next) => {
    if (C.bayiAnahtari === null || C.bayiKimlikAnahtari === null) { yapilandirmaYok(res); return; }
    next();
  };

  const jsonDegilse415: RequestHandler = (req, res, next) => {
    if (!req.is('application/json')) { reddet(res, 415); return; }
    next();
  };
  const govdeAyristir = express.json({ limit: MAGAZA_GOVDE_SINIRI_BAYT });

  /** Kullanıcı: var, rolü DIŞ ROL, kiracısı belirteçtekiyle ve sunucu kiracısıyla aynı, firma askıda değil, MFA uyumlu. */
  const kullaniciGecerli = (k: PanelKullanicisi | null, cid: string, kiraci: string, mfa: boolean): k is PanelKullanicisi =>
    k !== null && disRolMu(k.rol) && k.cid === cid && k.cid === kiraci && k.firmaDurumu !== 'suspended' && (!k.mfaAcik || mfa);
  /** Bağ: var, erişim açık, kiracısı sunucu kiracısıyla aynı. */
  const bagGecerli = (b: MusteriHesabi | null, kiraci: string): b is MusteriHesabi =>
    b !== null && b.durum === 'acik' && b.companyId === kiraci;

  // 3. Kod → belirteç değişimi (panel `oturum` sırası; H10).
  const oturum = async (req: Request, res: Response): Promise<void> => {
    const cozum = PanelOturumGovdesi.safeParse(req.body);
    if (!cozum.success) { reddet(res, 400); return; }
    // Kayıt HERHANGİ bir `await`'ten ÖNCE alınır ve silinir (eşleşsin eşleşmesin TEK deneme).
    const kayit = C.kodDeposu.al(kodOzetiHesapla(cozum.data.kod));
    const anahtar = C.bayiAnahtari;
    if (anahtar === null) { yapilandirmaYok(res); return; }
    const ret401 = (): void => { sayaclar.oturum401 += 1; res.status(401).json({ ok: false }); };
    const ret503 = (): void => { sayaclar.oturum503 += 1; res.status(503).json({ ok: false }); };
    if (!kayit || kayit.bitis <= simdi().getTime() || !meydanEslesiyor(cozum.data.dogrulayici, kayit.meydan)) { ret401(); return; }
    try {
      let kullanici: PanelKullanicisi | null;
      try {
        kullanici = await C.panelKullanicisi(kayit.uid);
      } catch (e) {
        console.error('[magaza-bayi] oturum: kullanıcı okunamadı:', hataKodu(e));
        ret503();
        return;
      }
      const kiraci = await kiraciCoz();
      if (kiraci === '') { ret503(); return; }
      if (!kullaniciGecerli(kullanici, kayit.cid, kiraci, kayit.mfa)) { ret401(); return; }
      // Kod verildikten SONRA çıkış (ERP ya da mağaza) / erişim kapatma / bağ değişimi olduysa bekleyen kod da ölür: veriliş anı
      // (`bitis − ömür`) iptal değerinden BÜYÜK olmalı (eşit an rettir). Okuma hatası 503 (kod yanmıştır).
      let gecersizOnce: number;
      try {
        gecersizOnce = await C.iptal.gecersizOnce(kayit.uid);
      } catch (e) {
        console.error('[magaza-bayi] oturum: iptal okunamadı:', hataKodu(e));
        ret503();
        return;
      }
      if (!(kayit.bitis - MAGAZA_BAYI_KOD_OMRU_MS > gecersizOnce)) { ret401(); return; }
      let bag: MusteriHesabi | null;
      try {
        bag = await C.musteriHesabi(kayit.uid);
      } catch (e) {
        console.error('[magaza-bayi] oturum: bağ okunamadı:', hataKodu(e));
        ret503();
        return;
      }
      if (!bagGecerli(bag, kiraci)) { ret401(); return; }
      const bas = simdi().getTime();
      const bitis = bas + MAGAZA_BAYI_BELIRTEC_OMRU_MS;
      const token = belirtecUret(BAYI_BELIRTECI, anahtar, {
        uid: kayit.uid, cid: kullanici.cid, rol: kullanici.rol, ad: kullanici.ad, eposta: kayit.eposta, mfa: kayit.mfa, bas, bitis,
      });
      sayaclar.oturum += 1;
      try {
        await C.writeAuditLog({ uid: kayit.uid, email: kayit.eposta }, 'Müşteri ekranı oturumu', `açıldı · ${kayit.eposta}`);
      } catch (e) {
        console.error('[magaza-bayi] oturum denetim kaydı yazılamadı:', hataKodu(e));
      }
      res.status(200).json({ token, bitis, bayi: { firma: bag.firma } });
    } catch (e) {
      console.error('[magaza-bayi] oturum işlenemedi:', hataKodu(e));
      if (!res.headersSent) reddet(res, 500);
    }
  };

  // 5. Belirteç kapısı (dosya başı «KAPI»).
  const belirtecKapisi = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const anahtar = C.bayiAnahtari;
    if (anahtar === null) { yapilandirmaYok(res); return; }
    const yuk = belirtecCoz(BAYI_BELIRTECI, anahtar, yetkiBelirteci(req.headers.authorization));
    if (!yuk || !belirtecSuresiIcinde(yuk, simdi().getTime())) { reddet(res, 401); return; }
    let kullanici: PanelKullanicisi | null;
    let kiraci: string;
    let gecersizOnce: number;
    let bag: MusteriHesabi | null;
    try {
      kullanici = await C.panelKullanicisi(yuk.uid);
      kiraci = await kiraciCoz();
      gecersizOnce = await C.iptal.gecersizOnce(yuk.uid);
      bag = await C.musteriHesabi(yuk.uid);
    } catch (e) {
      console.error('[magaza-bayi] kapı okuması başarısız:', hataKodu(e));
      reddet(res, 503);
      return;
    }
    if (kiraci === '') { reddet(res, 503); return; }
    if (!kullaniciGecerli(kullanici, yuk.cid, kiraci, yuk.mfa) || !bagGecerli(bag, kiraci) || !(yuk.bas > gecersizOnce)) {
      reddet(res, 401);
      return;
    }
    istekBaglami.set(req, { yuk, kullanici, bag });
    next();
  };

  const hata500 = (res: Response, e: unknown, is: string): void => {
    console.error(`[magaza-bayi] ${is} işlenemedi:`, hataKodu(e));
    if (!res.headersSent) reddet(res, 500);
  };

  // 6a. Hesap özeti: firma bağdan; özet SABİT üç `null` (iskonto / vade / özel oran anahtarı YOK).
  const ben = (req: Request, res: Response): void => {
    const b = istekBaglami.get(req);
    if (!b) { reddet(res, 401); return; }
    sayaclar.ben += 1;
    res.status(200).json({ bayi: { firma: b.bag.firma }, ozet: { ...BAYI_BEN_OZETI } });
  };

  // 6b. Siparişler: iki aşamalı okuma (kanal/magazaBayiSiparis — sabitler, sıra, süzgeç orada).
  const siparisler = async (req: Request, res: Response): Promise<void> => {
    try {
      const b = istekBaglami.get(req);
      if (!b) { reddet(res, 401); return; }
      const kimlikAnahtari = C.bayiKimlikAnahtari;
      if (kimlikAnahtari === null) { yapilandirmaYok(res); return; }
      const havuz = C.getPgPool();
      if (!havuz) { reddet(res, 503); return; }
      const p = bayiSiparisParametreleri(b.kullanici.cid, b.bag, MAGAZA_KAYNAGI);
      const { rows: adaylar } = await havuz.query(BAYI_SIPARIS_ADAY_SQL, p);
      if (adaylar.length > BAYI_SIPARIS_ADAY_UYARI_SINIRI) {
        sayaclar.siparisAdayFazla += 1;
        console.warn('[magaza-bayi] siparişler: aday satır sayısı uyarı sınırını aştı (kesilmedi)');
      }
      const sira = bayiSiparisSirasi(adaylar);
      const govdeler = sira.length === 0 ? [] : (await havuz.query(BAYI_SIPARIS_GOVDE_SQL, [...p, sira])).rows;
      const liste = bayiSiparisListesi(sira, govdeler, docId => bayiSiparisKimligi(kimlikAnahtari, {
        cid: b.kullanici.cid, uid: b.yuk.uid, bas: b.yuk.bas, docId,
      }));
      sayaclar.siparisler += 1;
      res.status(200).json({ siparisler: liste });
    } catch (e) { hata500(res, e, 'sipariş listesi'); }
  };

  // 6c. Çıkış (K7, H2): o kişinin BÜTÜN mağaza belirteçleri ölür (ortak iptal — panel belirteçleri dâhil), ARDINDAN ERP
  // tarafında Firebase yenileme belirteçleri iptal edilir (ERP çıkışıyla aynı). İptal yazılamazsa 503 ve Firebase'e GEÇİLMEZ
  // (süreç içi iptal değeri yine «şimdi»dir); Firebase iptali başarısızsa sayaç + uyarı, çıkış yine 204.
  const cikis = async (req: Request, res: Response): Promise<void> => {
    const b = istekBaglami.get(req);
    if (!b) { reddet(res, 401); return; }
    try {
      await C.iptal.iptalEt(b.yuk.uid, b.bag.companyId);
    } catch (e) {
      console.error('[magaza-bayi] çıkış: iptal yazılamadı:', hataKodu(e));
      reddet(res, 503);
      return;
    }
    try {
      await C.firebaseYenilemeIptal(b.yuk.uid);
    } catch (e) {
      sayaclar.cikisFirebaseIptalYazilamadi += 1;
      console.warn('[magaza-bayi] çıkış: Firebase yenileme belirteçleri iptal edilemedi:', hataKodu(e));
    }
    try {
      await C.writeAuditLog({ uid: b.yuk.uid, email: b.yuk.eposta }, 'Müşteri ekranı oturumu', `kapandı · ${b.yuk.eposta}`);
    } catch (e) {
      console.error('[magaza-bayi] çıkış denetim kaydı yazılamadı:', hataKodu(e));
    }
    sayaclar.cikis += 1;
    res.status(204).end();
  };

  // 7. `/bayi` altındaki her başka yol ve yöntem — sipariş verme, fiyat, ekstre, başvuru, takip bu dilimde YOK (kapıdan SONRA:
  // belirteçsiz istek buraya ulaşamaz, 401 alır).
  const bulunamadi = (_req: Request, res: Response): void => { reddet(res, 404); };

  // 8. Zincir içi hata yakalayıcı — panelle AYNI kural; `next(err)` ÇAĞRILMAZ.
  const hataYakalayici = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (res.headersSent) { req.socket.destroy(); return; }
    const durum = nesneMi(err) ? err.status : undefined;
    if (typeof durum === 'number' && Number.isInteger(durum) && durum >= 400 && durum <= 499) { reddet(res, durum); return; }
    console.error('[magaza-bayi] zincir hatası:', hataKodu(err));
    reddet(res, 500);
  };

  const bayi = Router();
  bayi.use(onbelleksiz);
  bayi.use(kokenKapisi);
  bayi.use(yapilandirmaKapisi);
  bayi.use('/oturum', C.bayiOturumSinirlayici);
  bayi.post('/oturum', jsonDegilse415, govdeAyristir, oturum);
  bayi.use(C.bayiSinirlayici);
  bayi.use(belirtecKapisi);
  bayi.get('/ben', ben);
  bayi.get('/siparisler', siparisler);
  bayi.post('/cikis', jsonDegilse415, govdeAyristir, cikis);
  bayi.use(bulunamadi);
  bayi.use(hataYakalayici);
  return bayi;
}
