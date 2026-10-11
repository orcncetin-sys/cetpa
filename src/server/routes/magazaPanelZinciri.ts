/**
 * magazaPanelZinciri.ts — site paneli (www.cetpa.com.tr/panel.html) uçlarının ALT ZİNCİRİ (dilim 2a, şartname v6 § 3–§ 4;
 * dilim 2b § 10.3, § 10.5: yumuşak silme ucu, kartta salt okunur `teyit` + `elle` + `silebilir`, listede silinmiş talep YOK).
 *
 * `magazaRoutes.ts` bu zinciri yalnız `r.use('/panel', C.panelZinciri)` satırıyla bağlar — dış zincirin köken kapısından ve
 * genel sınırlayıcıdan ÖNCE. Zincir her isteği KENDİSİ sonlandırır: dış zincire, genel /api sınırlayıcısına (kova mağazanın
 * sipariş talebiyle paylaşılırdı), genel ayrıştırıcıya, genel hata yakalayıcıya DÜŞMEZ. Eşleşmeyi Express yapar; `req.path` /
 * `originalUrl` karşılaştırması YOKTUR (bu depoda iki kez yaşanmış arıza sınıfı: `/PANEL/siparisler` işleyiciye ulaşır ama
 * `startsWith('/panel/')` yanlış der).
 *
 * KAYIT SIRASI SABİT (çit: magazaPanelUclar.test.ts «kayıt sırası»; şartname § 4 numaralarıyla — 7 aşama, 7a kalem teslim,
 * 7b (2b) silme, 7c etiket):
 *   0.  `onbelleksiz`        — HER yanıta `Cache-Control: no-store` (403 / 204 / 429 / 503 dâhil).
 *   1.  köken kapısı         — dış zincirle AYNI izinli köken listesi; `GET, POST` + `Authorization, Content-Type`;
 *                              `Allow-Credentials` YOK; `OPTIONS` → 204; izinsiz / kökensiz → 403.
 *   1b. yapılandırma kapısı  — panel anahtarı yoksa (sır ya da dönüş adresi geçersiz) yöntemden ve yoldan bağımsız
 *                              `503 { ok: false, kod: 'panel-yapilandirilmamis' }`. Köken kapısından SONRA (panel `kod`u
 *                              okuyabilsin; ön uçuş 204 kalır), sınırlayıcılardan ÖNCE (kovaya sayılmaz).
 *   2-3. `/oturum`           — kendi kovası; kod → belirteç değişimi (belirteç İSTEMEZ). Muafiyet yol metniyle değil,
 *                              rotanın kapıdan ÖNCE kaydedilmesiyle sağlanır.
 *   4.  panel sınırlayıcısı  — belirteçsiz 401'ler de sayılır.
 *   5.  `belirtecKapisi`     — bundan sonra kaydedilen HER ŞEY (bilinmeyen yol dâhil) belirteçsiz 401 alır. Gövde kapıdan
 *                              SONRA ayrıştırılır: belirteçsiz + bozuk gövdeli istek 401'dir (400 değil).
 *   6-8. liste, aşama, kalem teslim, silme, etiket, çıkış · 9. 404 · 10. hata yakalayıcı (dört parametreli).
 *
 * KAPI (her panel isteğinde, § 3.5): (1) imza + `bas ≤ şimdi < bitis`; (2) `panelKullanicisi(uid)` YENİDEN okunur — kullanıcı
 * var, `magazaTalepIslemYetkisi(rol)`, `cid === yük.cid` ve `=== kiracı`, firma askıda değil, MFA açıksa `yük.mfa === true`;
 * (3) iptal: `yük.bas > gecersizOnce(uid)`. (1)–(3) reddi 401'dir. Okuma HATASI ve BOŞ kiracı ret DEĞİLDİR: `503 { ok: false }`
 * (panel 401'de oturumu siler; veritabanının anlık hatası herkesi panelden düşürmesin). Yükteki `rol` yalnız gösterimdir.
 * İptal BEKLEYEN YETKİ KODUNU da öldürür (inceleme 2026-10-10): `/oturum` kodun VERİLİŞ anını aynı değerle ölçer (`veriliş >
 * gecersizOnce`; değilse 401, iptal okunamazsa 503) — çıkıştan önce alınmış kod çıkıştan sonra belirtece çevrilemez.
 *
 * YAZMA KURALI BU DOSYADA DEĞİL: aşama / kalem teslim / etiket yazımı `kanal/magazaDurum.ts`, (2b) yumuşak silme
 * `kanal/magazaIcerik.ts` işlevleridir (ERP uçlarıyla ortak). Bu dosyada `adminDb`, `UPDATE` / `INSERT` / `DELETE` yoktur; tek ham
 * SQL liste okumasıdır (`MAGAZA_PANEL_LISTE_SQL`). Yazma işlevinin HER sonucu `switch` ile ele alınır (`eleAlinmamisSonuc`).
 *
 * PANEL İÇERİK DÜZENLEMEZ (V15): müşteri bilgisi, not, teyit kalemi, fiyat ve yeni talep yalnız ERP'dedir. Panel teyit edilen
 * içeriği SALT OKUR, kalem teslim işaretini (teyit varken `t:` anahtarıyla) verir ve — yalnız Yönetici — talebi SİLER; panelden
 * geri alma YOKTUR (V18). Silinmiş talep DONUKTUR: listede görünmez, aşama / kalem teslim / etiket yazımı `409 silindi` alır.
 *
 * GÜNLÜK: kişisel veri, gövde, kod, doğrulayıcı, belirteç YAZILMAZ; yalnız sabit metin + hata kodu (`hataKodu`). 4xx retleri
 * günlüğe hiç yazılmaz; süreç içi sayaçlara işlenir (`magazaPanelSayaclari()`, bekçi okur).
 */
import express, { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  MAGAZA_TALEP_KOLEKSIYONU, MAGAZA_UTC_ZAMAN_DESENI, magazaAsamasiMi, magazaGuncellemeZamani, magazaIzinliGecisler,
  magazaKalemTeslimMi, magazaKdvOraniMi, magazaTeslimIsaretsiz, magazaTeslimKaynagi, panelDurumuna, paneldenAsamaya,
} from '../../lib/magazaTalep.js';
import type { MagazaKdvOrani, MagazaTalepAsamasi, PanelDurumu, PanelKartDurumu } from '../../lib/magazaTalep.js';
import { magazaTalepIslemYetkisi, magazaTalepSilmeYetkisi } from '../../lib/rbac.js';
import { yetkiBelirteci } from '../istemciIp.js';
import { MAGAZA_BILDIRIM_KALEM_SINIRI } from '../kanal/magazaBildirim.js';
import { MAGAZA_ACIK_SQL, MAGAZA_SILINMEMIS_SQL, etiketBasildiYaz, kalemTeslimYaz, talepDurumunuDegistir } from '../kanal/magazaDurum.js';
import type { MagazaDurumDeps } from '../kanal/magazaDurum.js';
import { talepSil } from '../kanal/magazaIcerik.js';
import { MAGAZA_PANEL_BELIRTEC_OMRU_MS, belirtecSuresiIcinde, panelBelirteciCoz, panelBelirteciUret } from '../kanal/magazaPanelBelirtec.js';
import type { PanelBelirtecYuku } from '../kanal/magazaPanelBelirtec.js';
import type { PanelIptalCifti } from '../kanal/magazaPanelIptal.js';
import { MAGAZA_PANEL_KOD_OMRU_MS, kodOzetiHesapla, meydanEslesiyor } from '../kanal/magazaPanelKod.js';
import type { PanelKodDeposu } from '../kanal/magazaPanelKod.js';
import type { PanelKullanicisi } from '../kanal/magazaPanelKullanici.js';
import { EtiketBasildiGovdesi, KalemTeslimGovdesi, PanelDurumGovdesi, PanelOturumGovdesi, PanelSilGovdesi } from '../schemas.js';
import { MAGAZA_GOVDE_SINIRI_BAYT, hataKodu, magazaIzinliKokenleriCoz, magazaKiraciCozucuKur } from './magazaRoutes.js';
import type { MagazaPgHavuzu } from './magazaRoutes.js';

/** server.ts'ten ihtiyaç duyulan HER ŞEY — açık liste (import DEĞİL; döngü olurdu). Örnekler server.ts'te BİR kez kurulur. */
export interface MagazaPanelCtx {
  /**
   * `/oturum` (20 / 15 dk) ve öbür panel uçlarının (600 / 15 dk) sınırlayıcıları — yalnız IP anahtarlı, server.ts'te kurulur
   * (hız sınırı çiti: rota modülünde sınırlayıcı kurulmaz). 429 yanıtını bu modülün `magazaPanel429` işlevi üretir.
   */
  panelOturumSinirlayici: RequestHandler;
  panelSinirlayici: RequestHandler;
  /**
   * Panel belirteci anahtarı (server.ts'te çözülür; modül sırrı GÖRMEZ — `magazaPanelBelirtec.panelAnahtariTuret`). `null` =
   * panel yapılandırılmamış (iki sır da yok ya da dönüş adresi geçersiz): bütün uçlar 503 `panel-yapilandirilmamis`.
   */
  panelAnahtari: Buffer | null;
  /** Kullanıcı okuyucu (§ 3.5): hatayı YUTMAZ — fırlatırsa kapı 503 döner; `null` = kullanıcı yok / rolü küme dışı. */
  panelKullanicisi: (uid: string) => Promise<PanelKullanicisi | null>;
  /** Yetki kodu deposu — `magazaErpRoutes` (yazan) ile AYNI örnek (ayrı `Map` olsaydı her değişim 401 dönerdi). */
  kodDeposu: PanelKodDeposu;
  /** İptal çifti — ERP çıkış işleyicisiyle AYNI örnek (§ 3.6). */
  iptal: PanelIptalCifti;
  /** PostgreSQL havuzu; yoksa liste / yazma uçları 503 döner, `adminDb`'ye DÜŞÜLMEZ. */
  getPgPool: () => MagazaPgHavuzu | null;
  /** Kiracı çözümleyici (server.ts `serverTenantId`); zincir KENDİ önbelleğiyle çağırır (dolu 60 sn, boş 10 sn). */
  serverTenantId: () => Promise<string>;
  broadcastDocChange: MagazaDurumDeps['broadcastDocChange'];
  writeAuditLog: MagazaDurumDeps['writeAuditLog'];
  /** `MagazaDurumDeps` yüzeyi tam olsun diye (yazma işlevleriyle AYNI bağımlılık nesnesi); panel uçları bildirim İSTEMEZ. */
  bildirimIste: MagazaDurumDeps['bildirimIste'];
  /**
   * Değişiklik olayı aboneliği (server.ts: `d => dbEvents.on('change', d)`; zincir modülleri pgShim'i içe aktarmaz).
   * `magazaTalepleri` olayında liste önbelleği düşer.
   */
  degisiklikDinle: (dinleyici: (olay: { coll?: string }) => void) => void;
  /** İzinli kökenler (varsayılan: `MAGAZA_IZINLI_KOKENLER` → `https://www.cetpa.com.tr`). Test için. */
  izinliKokenler?: () => readonly string[];
  /** Saat (test için). */
  simdi?: () => Date;
}

// ── Süreç içi sayaçlar ────────────────────────────────────────────────────────────────────────────────────────────
// AYRI küme (§ 6): `magazaSayaclari()`'nın sabit anahtarlarına EKLENMEZ; bekçi ayrı parçada yazar. ERP kökenindeki mağaza
// uçları (`magazaErpRoutes.ts`) ve ERP çıkış işleyicisi de BU kümeye sayar (`magazaPanelSay`). Yeniden başlatmada sıfırlanır.
const sayaclar = {
  /** Panel oturumu (kod → belirteç): başarılı / ret 401 / 503 (okuma hatası, boş kiracı). */
  oturum: 0, oturum401: 0, oturum503: 0,
  /**
   * Yetki kodu (ERP kökeni): verildi / ret (400, 401, 403, 429, 503) / Firebase iptal denetimi YAPILAMADAN verildi (ağ, süre
   * aşımı, hizmet hesabı kimliği yok — `magazaErpRoutes` `iptalKapisi`; sıfırdan büyükse o denetim devrede DEĞİLDİR).
   */
  yetkiKodu: 0, yetkiKoduRet: 0, yetkiKoduIptalDenetimsiz: 0,
  /** Aşama / açıklama yazımı: başarılı / 409 (`gecis-yok`, 2b `silindi`) — panel ve ERP ayrı anahtar. */
  durumPanel: 0, durumPanel409: 0, durumErp: 0, durumErp409: 0,
  /** Kalem teslim yazımı: tamam / 409 (2b `silindi` dâhil) — aynı kalıp (`gecersiz` rota 400'üdür, ayrı sayılmaz). */
  kalemTeslimPanel: 0, kalemTeslimPanel409: 0, kalemTeslimErp: 0, kalemTeslimErp409: 0,
  /** Etiket basıldı (yalnız panel; denetim yok): tamam / 404 / 409 (`silindi` — 2b). */
  etiketBasildi: 0, etiketBasildi404: 0, etiketBasildi409: 0,
  /** Elle bildirim (ERP): tamam / 409 (`kapali`, `yapilandirilmamis`, `zaten-gitti`, 2b `silindi` tek sayaçta). */
  bildirimGonder: 0, bildirimGonder409: 0,
  /** (2b) Revize bildirimini elle yeniden kuyruğa alma (ERP, `?tur=revize`): tamam / 409 — ilk bildirim sayacına KARIŞMAZ. */
  bildirimGonderRevize: 0, bildirimGonderRevize409: 0,
  /** (2b) Revize bildirimi isteği (içerik yazımı + elle yeniden gönderme): istendi / isteyici sözleşmesine aykırı REDDETTİ. */
  revizeBildirimIstendi: 0, revizeBildirimIstenemedi: 0,
  /**
   * (2b) İçerik yazımı (ERP): tamam / değişiklik yok (yazım yapılmadı) / 409 (`surum-eski`, `silindi`) / 400 (şema, `gecersiz`) /
   * 503 (ürün KDV oranı okunamadı — yazılmadı) / 429 (elle talep, içerik ve silme / geri alma uçlarının ORTAK kovası).
   */
  icerik: 0, icerikDegisiklikYok: 0, icerik409: 0, icerik400: 0, icerik503: 0, icerik429: 0,
  /** (2b) Yumuşak silme: tamam / 409 (`surum-eski`, zaten silinmiş) — panel ve ERP ayrı anahtar; geri alma yalnız ERP. */
  silPanel: 0, silPanel409: 0, silErp: 0, silErp409: 0, geriAl: 0, geriAl409: 0,
  /** (2b) Elle talep (ERP): tamam / üretilen numara üst üste çakıştı (503). */
  elleTalep: 0, elleTalepCakisti: 0,
  /** ERP çıkışında oturum çerezi yok / süresi dolmuş → panel iptali YAZILAMADI. */
  cikisUidsiz: 0,
  /** Panel zincirinin retleri: kapı 401, köken 403, 404, sınırlayıcı 429, 500, 503. */
  r401: 0, r403: 0, r404: 0, r429: 0, r500: 0, r503: 0,
};
export type MagazaPanelSayaci = keyof typeof sayaclar;

/** Süreç içi panel + ERP mağaza uç sayaçları (bekçi okur). Dönen nesne kopyadır. */
export function magazaPanelSayaclari(): Readonly<Record<string, number>> {
  return { ...sayaclar };
}

/** Sayaçları sıfırlar — YALNIZ test için (üretimde çağıranı yok). */
export function magazaPanelSayaclariniSifirla(): void {
  for (const anahtar of Object.keys(sayaclar) as MagazaPanelSayaci[]) sayaclar[anahtar] = 0;
}

/** Tek sayaç artırır — `magazaErpRoutes.ts` ve ERP çıkış yardımcısı için (sayaçlar TEK modül örneğinde dursun). */
export function magazaPanelSay(anahtar: MagazaPanelSayaci): void {
  sayaclar[anahtar] += 1;
}

/**
 * Tüketici denetim: rota, yazma işlevinin sonucunu `switch` ile ele alır ve `default` dalında bunu çağırır — işlev YENİ bir sonuç
 * kazanırsa çağıran rota DERLENMEZ (2b'nin `silindi` sonucu `if` zincirli rotalarda sessizce 200'e düşüyordu). Çalışma anında
 * ulaşılırsa (tip dışı değer) SABİT metinle fırlatır: sonuç nesnesi belge taşıyabilir, iletiye YAZILMAZ. ERP uçları da bunu kullanır.
 */
export function eleAlinmamisSonuc(_sonuc: never): never {
  throw new Error('magaza: yazma işlevinin sonucu rota tarafından ele alınmadı');
}

/** Panel zincirinin sayaçlı ret kodları. */
type RetKodu = 401 | 403 | 404 | 429 | 500 | 503;
const RET_SAYACI: Readonly<Record<RetKodu, MagazaPanelSayaci>> = { 401: 'r401', 403: 'r403', 404: 'r404', 429: 'r429', 500: 'r500', 503: 'r503' };
const retSayaciVar = (kod: number): kod is RetKodu => Object.hasOwn(RET_SAYACI, kod);

/** Sabit ret: (varsa) sayaç + `{ ok: false }`. Gövdeye ayrıntı KONMAZ. */
function reddet(res: Response, kod: number): void {
  if (retSayaciVar(kod)) sayaclar[RET_SAYACI[kod]] += 1;
  res.status(kod).json({ ok: false });
}

/** Panel sınırlayıcılarının `handler` seçeneği: `r429` (panel kümesi) + sabit `429 { ok: false }`. */
export function magazaPanel429(_req: Request, res: Response): void {
  reddet(res, 429);
}

/**
 * ERP çıkışı (`POST /api/db/session/logout`) o kullanıcının BÜTÜN panel belirteçlerini öldürür (§ 3.6, V8). `uid` oturum
 * ÇEREZİNDEN okunur (uç `requireAuth` taşımaz): çerez yoksa / süresi dolmuşsa iptal YAZILMAZ, sayaç artar. Yazım başarısız
 * olursa çıkış YİNE tamamlanır — ASLA fırlatmaz; süreç içi iptal değeri «şimdi» kalır (`magazaPanelIptal.ts`), günlüğe yalnız kod.
 */
export async function erpCikisindaPanelIptalEt(iptal: PanelIptalCifti, uid: string | null): Promise<void> {
  if (uid === null || uid === '') { sayaclar.cikisUidsiz += 1; return; }
  try {
    await iptal.iptalEt(uid);
  } catch (e) {
    console.warn('[magaza-panel] ERP çıkışında panel iptali yazılamadı:', hataKodu(e));
  }
}

// ── Liste ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const MAGAZA_PANEL_ACIK_SINIRI = 500;
export const MAGAZA_PANEL_KAPALI_SINIRI = 200;
/** KAPALI talepler KAPANIŞ zamanına göre son 30 gün (`olusturma`'ya göre süzülseydi eski talep kapatıldığı an kaybolurdu). */
export const MAGAZA_PANEL_KAPALI_PENCERE_MS = 30 * 24 * 60 * 60 * 1000;
/** Liste önbelleği en çok bu kadar yaşar (panel 25 sn'de bir sorar: N sekme tek sorguyu paylaşır). */
export const MAGAZA_PANEL_LISTE_ONBELLEK_MS = 25_000;
/** Yanıt gövdesinin üst sınırı (JSON metninin UTF-8 baytı); aşılırsa önce en eski kapalılar, sonra en eski açıklar kırpılır. */
export const MAGAZA_PANEL_LISTE_BUTCESI_BAYT = 2 * 1024 * 1024;

/**
 * TEK ifade = tek anlık görüntü (iki sorgu iki ayrı anlık görüntüydü: araya giren tek aşama yazımı aynı talebi iki kez ya da
 * hiç döndürüyor, araya giren yeni talep `kesildi`yi yanlış doğru yapıyordu — kapı 2 deneyi). $1 koleksiyon, $2 kiracı,
 * $3 kapalı penceresinin başı (`toISOString()`).
 *  • AÇIK: ölçüt `MAGAZA_ACIK_SQL` (bekçiyle AYNI sabit) — aşaması olmayan / bilinmeyen satır AÇIKTIR, kaybolmaz; en çok 500,
 *    `toplam` süzgecin TAMAMININ sayısıdır (`count(*) OVER ()`, `LIMIT`ten önce).
 *  • KAPALI: `NOT (açık ölçütü)` VE silinmemiş; kapanış zamanı `durumZamani` (yoksa `olusturma`) pencerede; en çok 200.
 *  • (2b) SİLİNMİŞ talep iki kümede de YOKTUR: açık ölçütü silinmemiş koşulunu İÇERİR (`MAGAZA_ACIK_SQL`); onun değillemesi
 *    silinmişi de yakalayacağı için kapalı kümeye `MAGAZA_SILINMEMIS_SQL` ayrıca eklenir. `toplam` (= `acikToplam`) canlı açıkları sayar.
 *  • Zaman karşılaştırması BİLEREK metin (`COLLATE "C"`): alanlar `toISOString()` biçimindedir, bayt sırası zaman sırasıdır;
 *    `::timestamptz` tek bozuk satırda bütün sorguyu düşürürdü. Tarihsiz satır sona düşer (`NULLS LAST`).
 */
export const MAGAZA_PANEL_LISTE_SQL = `WITH acik AS (SELECT id, data, count(*) OVER () AS toplam FROM docs WHERE coll = $1 AND data->>'companyId' = $2 AND ${MAGAZA_ACIK_SQL} ORDER BY (data->>'olusturma') COLLATE "C" DESC NULLS LAST LIMIT ${MAGAZA_PANEL_ACIK_SINIRI}), kapali AS (SELECT id, data FROM docs WHERE coll = $1 AND data->>'companyId' = $2 AND NOT (${MAGAZA_ACIK_SQL}) AND ${MAGAZA_SILINMEMIS_SQL} AND (COALESCE(data->>'durumZamani', data->>'olusturma')) COLLATE "C" >= $3 ORDER BY (COALESCE(data->>'durumZamani', data->>'olusturma')) COLLATE "C" DESC NULLS LAST LIMIT ${MAGAZA_PANEL_KAPALI_SINIRI}) SELECT 'a' AS tur, id, data, toplam FROM acik UNION ALL SELECT 'k', id, data, NULL FROM kapali`;

export interface PanelSiparisKalemi {
  /** Kalem teslim isteğinin anahtarı (`b:<dizin>`); sunucu verir, panel üretmez. */
  anahtar: string;
  sku: string;
  ad: string;
  marka: string;
  /** Saklı değer sonlu sayı değilse `null` (BİLİNMİYOR; 0 değil). */
  adet: number | null;
  /** = `talepFiyat` — müşterinin sitede gördüğü BEYAN; `null` = fiyat sorulacak (0 değil). */
  birimFiyat: number | null;
  tedarik: boolean;
  teslim: boolean;
}

/** (2b) Teyit edilen kalem — SALT OKUNUR (panel içerik düzenlemez). `kdvKaynagi` panele GİRMEZ (personelin düzenleme bilgisi). */
export interface PanelTeyitKalemi {
  /** Kalem teslim isteğinin anahtarı (`t:<12 onaltılık>`); sunucu verir. Teyit varken kutular BU kalemlere bağlıdır. */
  anahtar: string;
  sku: string;
  ad: string;
  marka: string;
  adet: number | null;
  /** KDV HARİÇ net; `null` = fiyat sorulacak (0 değil). */
  birimFiyat: number | null;
  /** Saklı değer `MAGAZA_KDV_ORANLARI` dışındaysa `null` (BİLİNMİYOR; oran uydurulmaz). */
  kdvOrani: MagazaKdvOrani | null;
  tedarik: boolean;
  teslim: boolean;
}

/** (2b) Personelin TEYİT ETTİĞİ içerik. Toplamlar sunucunun türettiği kayıtlı değerlerdir; `null` = fiyatı sorulacak kalem var. */
export interface PanelTeyit {
  /** En çok `MAGAZA_BILDIRIM_KALEM_SINIRI` kalem; tamamının sayısı `kalemSayisi`. */
  kalemler: PanelTeyitKalemi[];
  kalemSayisi: number;
  araToplam: number | null;
  kdv: number | null;
  toplam: number | null;
}

/** Panel kartı (§ 4 `Siparis`). Yol ve kart anahtarı `id`'dir; `no` kiracıda TEKİL DEĞİLDİR (yalnız gösterim / arama). */
export interface PanelSiparis {
  id: string;
  no: string;
  tarih: string;
  /** `magazaGuncellemeZamani`: `durumZamani ?? olusturma` ile kalem teslim zamanlarının en büyüğü. */
  guncelleme: string;
  durum: PanelKartDurumu;
  /** = `durumSurum` (yoksa 0); istemci gördüğü sürümü geri gönderir. */
  surum: number;
  gecisler: PanelDurumu[];
  aciklama: string;
  not: string;
  kaynak: 'magaza_talep';
  musteri: { ad: string; firma: string; telefon: string; eposta: string; il: string; adres: string; vergi: string };
  /** En çok `MAGAZA_BILDIRIM_KALEM_SINIRI` kalem; tamamının sayısı `kalemSayisi`. */
  kalemler: PanelSiparisKalemi[];
  kalemSayisi: number;
  teslimKaynagi: 'beyan' | 'teyit';
  /** BÜTÜN kaynak kalemlerinden (kalem kesiminden bağımsız). */
  teslimIsaretsiz: number;
  araToplam: number | null;
  kdv: number | null;
  toplam: number | null;
  /** `kim` yanıta GİRMEZ (personel bilgisidir). */
  etiketBasildi: { zaman: string; koli?: number } | null;
  /** (2b) Yalnız teyit yazılmış talepte (`teslimKaynagi: 'teyit'`); `zaman` / `kim` yanıta GİRMEZ. */
  teyit?: PanelTeyit;
  /** (2b) ERP'de elle açılmış talep (mağazadan gelmedi). */
  elle: boolean;
  /**
   * (2b) İsteği yapan kullanıcı bu talebi silebilir mi (yalnız Yönetici). GÖSTERİMDİR: hüküm silme ucunda yeniden verilir.
   * `panelSiparisiEsle` hep `false` üretir (liste gövdesi kiracı başına önbelleklenir); rota yanıtı kullanıcıya göre işaretler.
   */
  silebilir: boolean;
}

export interface PanelListe { siparisler: PanelSiparis[]; acikToplam: number; kesildi: boolean }

const nesneMi = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const metin = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Beyan tutarı: sonlu sayı değilse `null` (BİLİNMİYOR). */
const tutar = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Saklı belgeden panel kartı (SAF). Yanıta GİRMEYENLER: `durumGecmisi`, `bildirim`, `telefonSon10`, `istemciTarihi`,
 * `companyId`, `iptalOncesi`, ham `kalemTeslim` nesnesi ve `etiketBasildi.kim` (kim / zaman personel bilgisidir; kart yalnız
 * `teslim` bayrağını basar). Bilinmeyen saklı aşama `alindi`'ye ÇEVRİLMEZ: `'bilinmiyor'`, `gecisler: []`.
 * (2b) `teyit` kalemleri `anahtar` + `teslim` ile (teyit varken `teslimKaynagi` / `teslimIsaretsiz` teyit kalemlerinden; beyan
 * `kalemler[].teslim` yine `b:<i>` girişinden okunur — tarihçe); `teyit.zaman` / `teyit.kim`, `kdvKaynagi`, `icerikSurum`,
 * `silindi`, `bildirimRevize`, `elle.kim` yanıta GİRMEZ. `araToplam` / `kdv` / `toplam` müşterinin BEYANI olarak kalır (V16).
 */
export function panelSiparisiEsle(id: string, data: Record<string, unknown>): PanelSiparis {
  const asama: MagazaTalepAsamasi | null = magazaAsamasiMi(data.durum) ? data.durum : null;
  const olusturma = metin(data.olusturma);
  const musteri = nesneMi(data.musteri) ? data.musteri : {};
  const beyan = nesneMi(data.talepEdilen) ? data.talepEdilen : {};
  const hamKalemler = Array.isArray(data.kalemler) ? data.kalemler : [];
  const kalemler: PanelSiparisKalemi[] = hamKalemler.slice(0, MAGAZA_BILDIRIM_KALEM_SINIRI).map((ham, dizin) => {
    const k = nesneMi(ham) ? ham : {};
    const anahtar = `b:${dizin}`;
    return {
      anahtar, sku: metin(k.sku), ad: metin(k.ad), marka: metin(k.marka),
      adet: tutar(k.adet), birimFiyat: tutar(k.talepFiyat), tedarik: k.tedarik === true,
      teslim: magazaKalemTeslimMi(data.kalemTeslim, anahtar),
    };
  });
  // (2b) Teyit: kaynak ölçütü ortak işlevden (`teyit` nesne VE `kalemler` boş olmayan dizi). Bozuk kalem fırlatmaz.
  const teyitNesnesi = magazaTeslimKaynagi(data) === 'teyit' && nesneMi(data.teyit) ? data.teyit : null;
  const teyitKalemleri: unknown[] | null = teyitNesnesi !== null && Array.isArray(teyitNesnesi.kalemler) ? teyitNesnesi.kalemler : null;
  const teyit: PanelTeyit | null = teyitNesnesi === null || teyitKalemleri === null ? null : {
    kalemler: teyitKalemleri.slice(0, MAGAZA_BILDIRIM_KALEM_SINIRI).map((ham): PanelTeyitKalemi => {
      const k = nesneMi(ham) ? ham : {};
      const anahtar = metin(k.anahtar);
      return {
        anahtar, sku: metin(k.sku), ad: metin(k.ad), marka: metin(k.marka),
        adet: tutar(k.adet), birimFiyat: tutar(k.birimFiyat), kdvOrani: magazaKdvOraniMi(k.kdvOrani) ? k.kdvOrani : null,
        tedarik: k.tedarik === true, teslim: magazaKalemTeslimMi(data.kalemTeslim, anahtar),
      };
    }),
    kalemSayisi: teyitKalemleri.length,
    araToplam: tutar(teyitNesnesi.araToplam), kdv: tutar(teyitNesnesi.kdv), toplam: tutar(teyitNesnesi.toplam),
  };
  const etiket = data.etiketBasildi;
  const etiketBasildi = nesneMi(etiket) && typeof etiket.zaman === 'string' && MAGAZA_UTC_ZAMAN_DESENI.test(etiket.zaman)
    ? { zaman: etiket.zaman, ...(typeof etiket.koli === 'number' && Number.isSafeInteger(etiket.koli) && etiket.koli >= 1 ? { koli: etiket.koli } : {}) }
    : null;
  return {
    id,
    no: metin(data.talepNo),
    tarih: olusturma,
    guncelleme: magazaGuncellemeZamani({ olusturma, durumZamani: data.durumZamani, kalemTeslim: data.kalemTeslim }),
    durum: asama === null ? 'bilinmiyor' : panelDurumuna(asama),
    // Sürüm sayacıdır (tutar değil): alan yoksa / sayı değilse 0 — SQL'deki `COALESCE(data->>'durumSurum', '0')` ile aynı kural.
    surum: typeof data.durumSurum === 'number' && Number.isSafeInteger(data.durumSurum) && data.durumSurum > 0 ? data.durumSurum : 0,
    gecisler: asama === null ? [] : magazaIzinliGecisler(asama, data.iptalOncesi).map(panelDurumuna),
    aciklama: metin(data.durumAciklama),
    not: metin(data.not),
    kaynak: 'magaza_talep',
    musteri: {
      ad: metin(musteri.ad), firma: metin(musteri.firma), telefon: metin(musteri.telefon), eposta: metin(musteri.eposta),
      il: metin(musteri.il), adres: metin(musteri.adres), vergi: metin(musteri.vergi),
    },
    kalemler,
    kalemSayisi: hamKalemler.length,
    teslimKaynagi: magazaTeslimKaynagi(data),
    teslimIsaretsiz: magazaTeslimIsaretsiz(data),
    araToplam: tutar(beyan.araToplam),
    kdv: tutar(beyan.kdv),
    toplam: tutar(beyan.toplam),
    etiketBasildi,
    ...(teyit !== null ? { teyit } : {}),
    elle: nesneMi(data.elle),
    silebilir: false,
  };
}

/** Sıralama anahtarı büyükten küçüğe (METİN sırası = zaman sırası); boş anahtar sona. */
const yeniOnce = (a: string, b: string): number => (a === b ? 0 : a === '' ? 1 : b === '' ? -1 : a > b ? -1 : 1);

/**
 * `MAGAZA_PANEL_LISTE_SQL` satırlarından yanıt gövdesi (SAF). `id` TEKİLDİR (tek anlık görüntü; yine de çift satır bir kez
 * alınır). `acikToplam` = 'a' satırlarının `toplam`ı, 'a' satırı yoksa 0. `kesildi`: `acikToplam > 500` ya da bütçe kırpması.
 */
export function panelListesiKur(rows: Array<Record<string, unknown>>, butceBayt: number = MAGAZA_PANEL_LISTE_BUTCESI_BAYT): PanelListe {
  /** `sira`: açıkta kayıt zamanı, kapalıda KAPANIŞ zamanı (`durumZamani`, yoksa `olusturma`) — SQL'in sıralama anahtarıyla aynı. */
  const acik: Array<{ s: PanelSiparis; sira: string }> = [];
  const kapali: Array<{ s: PanelSiparis; sira: string }> = [];
  const gorulen = new Set<string>();
  let acikToplam = 0;
  for (const r of rows) {
    if (typeof r.id !== 'string' || !nesneMi(r.data) || gorulen.has(r.id)) continue;
    gorulen.add(r.id);
    const s = panelSiparisiEsle(r.id, r.data);
    if (r.tur === 'a') {
      // `count(*)` bigint'tir: pg metin, PGlite sayı / bigint döndürür. Açık satır varsa toplam en az 1'dir.
      const toplam = Number(r.toplam);
      if (Number.isSafeInteger(toplam) && toplam > acikToplam) acikToplam = toplam;
      acik.push({ s, sira: s.tarih });
    } else {
      const kapanis = metin(r.data.durumZamani);
      kapali.push({ s, sira: kapanis !== '' ? kapanis : s.tarih });
    }
  }
  // UNION ALL sıra GÜVENCESİ vermez: iki küme de kendi anahtarıyla yeniden sıralanır (yeni önce, tarihsiz sona).
  acik.sort((a, b) => yeniOnce(a.sira, b.sira));
  kapali.sort((a, b) => yeniOnce(a.sira, b.sira));

  // Bütçe: kart başına JSON boyutu bir kez ölçülür (+1 ayraç); aşılırsa önce en eski kapalılar, sonra en eski açıklar düşer.
  const ZARF_BAYT = 64; // `{"siparisler":[],"acikToplam":…,"kesildi":…}`
  const boylar = new Map<string, number>();
  let toplamBayt = ZARF_BAYT;
  for (const { s } of [...acik, ...kapali]) {
    const boy = Buffer.byteLength(JSON.stringify(s), 'utf8') + 1;
    boylar.set(s.id, boy);
    toplamBayt += boy;
  }
  let kirpildi = false;
  for (const kume of [kapali, acik]) {
    while (toplamBayt > butceBayt) {
      const dusen = kume.pop();
      if (!dusen) break;
      const boy = boylar.get(dusen.s.id);
      if (boy !== undefined) toplamBayt -= boy;
      kirpildi = true;
    }
  }
  return { siparisler: [...acik, ...kapali].map(k => k.s), acikToplam, kesildi: acikToplam > MAGAZA_PANEL_ACIK_SINIRI || kirpildi };
}

// ── Zincir ────────────────────────────────────────────────────────────────────────────────────────────────────────
interface PanelIstegi { yuk: PanelBelirtecYuku; kullanici: PanelKullanicisi }

export function magazaPanelZinciri(C: MagazaPanelCtx): Router {
  const simdi = (): Date => C.simdi?.() ?? new Date();
  const izinliKokenler = (): readonly string[] => C.izinliKokenler?.() ?? magazaIzinliKokenleriCoz(process.env.MAGAZA_IZINLI_KOKENLER);
  // Dilim 1'in önbellekli çözücüsünün panel örneği: ardışık N panel isteğinde `serverTenantId` en çok 1 kez çağrılır.
  const kiraciCoz = magazaKiraciCozucuKur(() => C.serverTenantId(), simdi);
  /** Yazma işlevlerinin bağımlılıkları (`kanal/magazaDurum.ts`): ERP uçlarıyla AYNI işlevler, aynı yüzey. */
  const D: MagazaDurumDeps = {
    getPgPool: C.getPgPool, broadcastDocChange: C.broadcastDocChange, writeAuditLog: C.writeAuditLog, bildirimIste: C.bildirimIste, simdi,
  };
  /** Kapıdan geçen isteğin belirteç yükü + o an okunan kullanıcı (işleyiciler `req`'e alan yazmaz). */
  const istekBaglami = new WeakMap<Request, PanelIstegi>();

  // Liste önbelleği: kiracı başına son gövde + KUŞAK sayacı. Sorgu başlarken okunan kuşak sonuç yazılırken değişmişse sonuç
  // önbelleğe YAZILMAZ (yanıt yine döner; geç dönen sorgu bayat gövdeyi 25 sn kilitliyordu — kapı 2 `onbellek.mjs`).
  // Süren sorgu da paylaşılır (N sekme aynı anda sorarsa TEK sorgu) — ama yalnız AYNI kuşakta başladıysa: yazımdan sonra
  // gelen istek, yazımdan önce başlamış sorgunun bayat sonucuna bağlanmaz.
  let kusak = 0;
  const listeOnbellegi = new Map<string, { govde: PanelListe; bitis: number }>();
  const surenListe = new Map<string, { kusak: number; soz: Promise<PanelListe> }>();
  const onbellegiDusur = (): void => { kusak += 1; listeOnbellegi.clear(); };
  C.degisiklikDinle((olay) => { if (olay.coll === MAGAZA_TALEP_KOLEKSIYONU) onbellegiDusur(); });

  const listeOku = (havuz: MagazaPgHavuzu, cid: string): Promise<PanelListe> => {
    const kayit = listeOnbellegi.get(cid);
    if (kayit && simdi().getTime() < kayit.bitis) return Promise.resolve(kayit.govde);
    const suren = surenListe.get(cid);
    if (suren && suren.kusak === kusak) return suren.soz;
    const baslangicKusagi = kusak;
    const soz = (async (): Promise<PanelListe> => {
      const pencereBasi = new Date(simdi().getTime() - MAGAZA_PANEL_KAPALI_PENCERE_MS).toISOString();
      const { rows } = await havuz.query(MAGAZA_PANEL_LISTE_SQL, [MAGAZA_TALEP_KOLEKSIYONU, cid, pencereBasi]);
      const govde = panelListesiKur(rows);
      if (kusak === baslangicKusagi) listeOnbellegi.set(cid, { govde, bitis: simdi().getTime() + MAGAZA_PANEL_LISTE_ONBELLEK_MS });
      return govde;
    })().finally(() => { if (surenListe.get(cid)?.soz === soz) surenListe.delete(cid); });
    surenListe.set(cid, { kusak: baslangicKusagi, soz });
    return soz;
  };

  // 0. Hiçbir panel yanıtı ara belleğe alınmaz (belirteç, müşteri verisi, 401 / 503 dâhil).
  const onbelleksiz: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };

  // 1. Panel köken kapısı. Dış zincirin kapısı DEĞİŞMEZ (`POST` + `Content-Type`); `Authorization` yalnız burada izinlidir.
  const kokenKapisi: RequestHandler = (req, res, next) => {
    res.vary('Origin');
    const koken = req.headers.origin;
    const izinli = typeof koken === 'string' && izinliKokenler().includes(koken);
    if (izinli) {
      res.setHeader('Access-Control-Allow-Origin', koken);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    // Ön uçuş burada BİTER: yapılandırma kapısına ve sınırlayıcılara ulaşmaz.
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (!izinli) { reddet(res, 403); return; }
    next();
  };

  // 1b. Yapılandırma kapısı (kovaya sayılmaz).
  const yapilandirmaYok = (res: Response): void => {
    sayaclar.r503 += 1;
    res.status(503).json({ ok: false, kod: 'panel-yapilandirilmamis' });
  };
  const yapilandirmaKapisi: RequestHandler = (_req, res, next) => {
    if (C.panelAnahtari === null) { yapilandirmaYok(res); return; }
    next();
  };

  // 415: POST gövdesi JSON değilse (ya da gövde / tür başlığı yoksa) ayrıştırıcıya hiç verilmez.
  const jsonDegilse415: RequestHandler = (req, res, next) => {
    if (!req.is('application/json')) { reddet(res, 415); return; }
    next();
  };
  const govdeAyristir = express.json({ limit: MAGAZA_GOVDE_SINIRI_BAYT });

  /** § 3.5 (2): kullanıcı var, yetkili, kiracısı belirteçtekiyle ve sunucu kiracısıyla aynı, firma askıda değil, MFA uyumlu. */
  const kullaniciGecerli = (k: PanelKullanicisi | null, cid: string, kiraci: string, mfa: boolean): k is PanelKullanicisi =>
    k !== null && magazaTalepIslemYetkisi(k.rol) && k.cid === cid && k.cid === kiraci && k.firmaDurumu !== 'suspended' && (!k.mfaAcik || mfa);

  // 3. Kod → belirteç değişimi (§ 3.3).
  const oturum = async (req: Request, res: Response): Promise<void> => {
    const cozum = PanelOturumGovdesi.safeParse(req.body);
    // Tanınmayan alan (`eposta`, `sifre`) da 400'dür; gövde günlüğe YAZILMAZ.
    if (!cozum.success) { reddet(res, 400); return; }
    // Kayıt HERHANGİ bir `await`'ten ÖNCE alınır ve silinir (eşleşsin eşleşmesin TEK deneme; silme beklemeden sonraya
    // kalınca aynı kod 3 belirteç üretti — kapı ölçümü). Denetimler silinmiş kaydın kopyasında.
    const kayit = C.kodDeposu.al(kodOzetiHesapla(cozum.data.kod));
    const anahtar = C.panelAnahtari;
    if (anahtar === null) { yapilandirmaYok(res); return; }
    const ret401 = (): void => { sayaclar.oturum401 += 1; res.status(401).json({ ok: false }); };
    const ret503 = (): void => { sayaclar.oturum503 += 1; res.status(503).json({ ok: false }); };
    if (!kayit || kayit.bitis <= simdi().getTime() || !meydanEslesiyor(cozum.data.dogrulayici, kayit.meydan)) { ret401(); return; }
    try {
      let kullanici: PanelKullanicisi | null;
      try {
        kullanici = await C.panelKullanicisi(kayit.uid);
      } catch (e) {
        // Okuma hatası ret değildir (kod yanmıştır; kullanıcı yeniden bağlanır).
        console.error('[magaza-panel] oturum: kullanıcı okunamadı:', hataKodu(e));
        ret503();
        return;
      }
      const kiraci = await kiraciCoz();
      if (kiraci === '') { ret503(); return; }
      // Kod verildikten SONRA rol düştüyse / firma askıya alındıysa / MFA açıldıysa değişim reddedilir.
      if (!kullaniciGecerli(kullanici, kayit.cid, kiraci, kayit.mfa)) { ret401(); return; }
      // Kod verildikten SONRA çıkış yapıldıysa (ERP çıkışı ya da panel «Çıkış»ı) bekleyen kod da ölür (V8; inceleme
      // 2026-10-10): kapıdaki `bas > gecersizOnce` kuralının eşi — kodun VERİLİŞ anı iptal değerinden BÜYÜK olmalı (eşit an
      // rettir). Veriliş anı kayıttan türer: `magazaErpRoutes` `bitis = veriliş + MAGAZA_PANEL_KOD_OMRU_MS` yazar. Bu denetim
      // olmasaydı çıkıştan önce alınmış kod, çıkıştan sonraki 60 sn içinde 8 saatlik geçerli belirtece çevrilebilirdi
      // (belirtecin `bas`ı takas anıdır, iptal değerinden büyüktür). Okuma HATASI ret değildir: 503 (kod yanmıştır).
      let gecersizOnce: number;
      try {
        gecersizOnce = await C.iptal.gecersizOnce(kayit.uid);
      } catch (e) {
        console.error('[magaza-panel] oturum: iptal okunamadı:', hataKodu(e));
        ret503();
        return;
      }
      if (!(kayit.bitis - MAGAZA_PANEL_KOD_OMRU_MS > gecersizOnce)) { ret401(); return; }
      const bas = simdi().getTime();
      const bitis = bas + MAGAZA_PANEL_BELIRTEC_OMRU_MS;
      const token = panelBelirteciUret(anahtar, {
        uid: kayit.uid, cid: kullanici.cid, rol: kullanici.rol, ad: kullanici.ad, eposta: kayit.eposta, mfa: kayit.mfa, bas, bitis,
      });
      sayaclar.oturum += 1;
      // Denetim: kod / doğrulayıcı / belirteç YOK. Yazım başarısızlığı oturumu geri almaz.
      try {
        await C.writeAuditLog({ uid: kayit.uid, email: kayit.eposta }, 'Mağaza paneli oturumu', `açıldı · ${kayit.eposta}`);
      } catch (e) {
        console.error('[magaza-panel] oturum denetim kaydı yazılamadı:', hataKodu(e));
      }
      res.status(200).json({ token, ad: kullanici.ad, rol: kullanici.rol, bitis: new Date(bitis).toISOString() });
    } catch (e) {
      console.error('[magaza-panel] oturum işlenemedi:', hataKodu(e));
      if (!res.headersSent) reddet(res, 500);
    }
  };

  // 5. Belirteç kapısı (dosya başı «KAPI»).
  const belirtecKapisi = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const anahtar = C.panelAnahtari;
    if (anahtar === null) { yapilandirmaYok(res); return; }
    // Ayıklama `requireAuth` ile AYNI işlevden; `mp1-…` iki parçadır, hiçbir sınırlayıcıda Firebase doğrulayıcısına gitmez.
    const yuk = panelBelirteciCoz(anahtar, yetkiBelirteci(req.headers.authorization));
    if (!yuk || !belirtecSuresiIcinde(yuk, simdi().getTime())) { reddet(res, 401); return; }
    let kullanici: PanelKullanicisi | null;
    let kiraci: string;
    let gecersizOnce: number;
    try {
      kullanici = await C.panelKullanicisi(yuk.uid);
      kiraci = await kiraciCoz();
      gecersizOnce = await C.iptal.gecersizOnce(yuk.uid);
    } catch (e) {
      console.error('[magaza-panel] kapı okuması başarısız:', hataKodu(e));
      reddet(res, 503);
      return;
    }
    // Kiracı çözümü BOŞSA ret değildir (401 panelde oturumu silerdi): 503.
    if (kiraci === '') { reddet(res, 503); return; }
    if (!kullaniciGecerli(kullanici, yuk.cid, kiraci, yuk.mfa) || !(yuk.bas > gecersizOnce)) { reddet(res, 401); return; }
    istekBaglami.set(req, { yuk, kullanici });
    next();
  };

  /** Kapıdan geçmiş isteğin bağlamı + havuz; eksikse yanıtı KENDİSİ yazar ve `null` döner. */
  const hazirla = (req: Request, res: Response): { b: PanelIstegi; havuz: MagazaPgHavuzu } | null => {
    const b = istekBaglami.get(req);
    if (!b) { reddet(res, 401); return null; }
    const havuz = C.getPgPool();
    if (!havuz) { reddet(res, 503); return null; }
    return { b, havuz };
  };
  const talepKimligi = (req: Request): string => (typeof req.params.id === 'string' ? req.params.id : '');
  const yazan = (b: PanelIstegi): { uid: string; ad: string; eposta: string } =>
    // `ad` yazma anında `panelKullanicisi(uid).ad`'dır (belirteçteki `ad` yalnız panel başlığındaki gösterimdir).
    ({ uid: b.yuk.uid, ad: b.kullanici.ad, eposta: b.yuk.eposta });
  const hata500 = (res: Response, e: unknown, is: string): void => {
    console.error(`[magaza-panel] ${is} işlenemedi:`, hataKodu(e));
    if (!res.headersSent) reddet(res, 500);
  };

  /**
   * Liste gövdesi (liste ucu ve yazma uçlarının 200 yanıtı). Gövde önbellekte KİRACI başına tutulur (N sekme tek sorgu);
   * `silebilir` (2b) ise isteği yapan KULLANICIYA göredir — önbelleğe girmez, yanıt verilirken işaretlenir: silme yetkisi
   * olana (yalnız Yönetici) her kartta `true`, öbürlerine önbellekteki `false`. Rol kapıda bu istek için okunan değerdir.
   */
  const listeYaniti = async (h: { b: PanelIstegi; havuz: MagazaPgHavuzu }): Promise<PanelListe> => {
    const liste = await listeOku(h.havuz, h.b.kullanici.cid);
    if (!magazaTalepSilmeYetkisi(h.b.kullanici.rol)) return liste;
    return { ...liste, siparisler: liste.siparisler.map(s => ({ ...s, silebilir: true })) };
  };

  // 6. Liste. Kapı önbellekten ÖNCEDİR: yetkisi düşen kullanıcıya önbellekten yanıt gitmez.
  const liste = async (req: Request, res: Response): Promise<void> => {
    try {
      const h = hazirla(req, res);
      if (!h) return;
      res.status(200).json(await listeYaniti(h));
    } catch (e) { hata500(res, e, 'liste'); }
  };

  // 7. Aşama / açıklama (panel sözlüğü). Yanıt güncel listedir (önbellek düşürülmüştür).
  const durumYaz = async (req: Request, res: Response): Promise<void> => {
    try {
      const h = hazirla(req, res);
      if (!h) return;
      const cozum = PanelDurumGovdesi.safeParse(req.body);
      if (!cozum.success) { reddet(res, 400); return; }
      const onceki = paneldenAsamaya(cozum.data.onceki);
      const yeni = paneldenAsamaya(cozum.data.durum);
      if (onceki === null || yeni === null) { reddet(res, 400); return; }
      const sonuc = await talepDurumunuDegistir(D, {
        id: talepKimligi(req), companyId: h.b.kullanici.cid, onceki, surum: cozum.data.surum, yeni,
        ...(cozum.data.aciklama !== undefined ? { aciklama: cozum.data.aciklama } : {}),
        kim: yazan(h.b), kanal: 'panel',
      });
      switch (sonuc.sonuc) {
        case 'tamam':
          sayaclar.durumPanel += 1;
          onbellegiDusur();
          res.status(200).json(await listeYaniti(h));
          return;
        case 'bulunamadi':
          reddet(res, 404);
          return;
        case 'gecis-yok':
          sayaclar.durumPanel409 += 1;
          // Güncel aşama panel sözlüğüyle; bilinmiyorsa alan YOK.
          res.status(409).json({ ok: false, kod: 'gecis-yok', ...(sonuc.durum !== null ? { durum: panelDurumuna(sonuc.durum) } : {}) });
          return;
        case 'silindi':
          // (2b) Silinmiş talep DONUKTUR (panel listeyi yeniler; talep listeden düşmüştür).
          sayaclar.durumPanel409 += 1;
          res.status(409).json({ ok: false, kod: 'silindi' });
          return;
        default:
          eleAlinmamisSonuc(sonuc);
      }
    } catch (e) { hata500(res, e, 'aşama yazımı'); }
  };

  // 7a. Kalem teslim («tümünü işaretle / kaldır» TEK istektir: `kalemler: 'hepsi'`).
  const kalemTeslim = async (req: Request, res: Response): Promise<void> => {
    try {
      const h = hazirla(req, res);
      if (!h) return;
      const cozum = KalemTeslimGovdesi.safeParse(req.body);
      if (!cozum.success) { reddet(res, 400); return; }
      const sonuc = await kalemTeslimYaz(D, {
        id: talepKimligi(req), companyId: h.b.kullanici.cid, surum: cozum.data.surum, teslim: cozum.data.teslim,
        kalemler: cozum.data.kalemler, kim: yazan(h.b), kanal: 'panel',
      });
      switch (sonuc.sonuc) {
        case 'tamam':
          sayaclar.kalemTeslimPanel += 1;
          onbellegiDusur();
          res.status(200).json(await listeYaniti(h));
          return;
        case 'bulunamadi':
          reddet(res, 404);
          return;
        case 'gecersiz':
          // Tanınmayan / öbür kaynağın anahtarı (2b: teyit yazılmış talepte `b:` anahtarı): hiçbir şey yazılmadı.
          reddet(res, 400);
          return;
        case 'gecis-yok':
          sayaclar.kalemTeslimPanel409 += 1;
          res.status(409).json({ ok: false, kod: 'gecis-yok', ...(sonuc.durum !== null ? { durum: panelDurumuna(sonuc.durum) } : {}) });
          return;
        case 'surum-eski':
          // (2b) Okuma ile yazma arasına teyit yazımı girdi: kutuların anahtar kümesi bayat — panel listeyi yeniler.
          sayaclar.kalemTeslimPanel409 += 1;
          res.status(409).json({ ok: false, kod: 'surum-eski' });
          return;
        case 'silindi':
          sayaclar.kalemTeslimPanel409 += 1;
          res.status(409).json({ ok: false, kod: 'silindi' });
          return;
        default:
          eleAlinmamisSonuc(sonuc);
      }
    } catch (e) { hata500(res, e, 'kalem teslim yazımı'); }
  };

  // 7b. Yumuşak silme (2b; V17, V18): yalnız Yönetici; panelden GERİ ALMA yok (ERP'de). Kayıt silinmez, `silindi` işareti
  // alır; yanıt güncel listedir (silinen talep listede YOKTUR). Bildirim ÜRETMEZ. `surum` = kartta görülen `durumSurum`.
  const sil = async (req: Request, res: Response): Promise<void> => {
    try {
      const h = hazirla(req, res);
      if (!h) return;
      // Kapı «paneli görebilir mi»yi ölçtü; silme AYRI yetkidir ve bu istek için kapıda YENİDEN okunan rolle ölçülür
      // (karttaki `silebilir` yalnız gösterimdir; rolü düşen Yönetici'nin açık sekmesi silemez).
      if (!magazaTalepSilmeYetkisi(h.b.kullanici.rol)) { sayaclar.r403 += 1; res.status(403).json({ ok: false, kod: 'rol' }); return; }
      const cozum = PanelSilGovdesi.safeParse(req.body);
      if (!cozum.success) { reddet(res, 400); return; }
      const sonuc = await talepSil(D, {
        id: talepKimligi(req), companyId: h.b.kullanici.cid, surum: cozum.data.surum, kim: yazan(h.b), kanal: 'panel',
      });
      switch (sonuc.sonuc) {
        case 'tamam':
          sayaclar.silPanel += 1;
          onbellegiDusur();
          res.status(200).json(await listeYaniti(h));
          return;
        case 'bulunamadi':
          reddet(res, 404);
          return;
        case 'zaten-silindi':
          sayaclar.silPanel409 += 1;
          res.status(409).json({ ok: false, kod: 'silindi' });
          return;
        case 'surum-eski':
          // Kart bayat (araya aşama / kalem teslim yazımı girdi): panel listeyi yeniler, kullanıcı güncel kartla yeniden dener.
          sayaclar.silPanel409 += 1;
          res.status(409).json({ ok: false, kod: 'surum-eski' });
          return;
        default:
          eleAlinmamisSonuc(sonuc);
      }
    } catch (e) { hata500(res, e, 'silme'); }
  };

  // 7c. Etiket basıldı (V23): `surum` İSTEMEZ, liste DÖNMEZ (önbellek değişiklik olayıyla / aşağıda düşer); denetim YOK.
  const etiketBasildi = async (req: Request, res: Response): Promise<void> => {
    try {
      const h = hazirla(req, res);
      if (!h) return;
      const cozum = EtiketBasildiGovdesi.safeParse(req.body);
      if (!cozum.success) { reddet(res, 400); return; }
      const sonuc = await etiketBasildiYaz(D, {
        id: talepKimligi(req), companyId: h.b.kullanici.cid,
        ...(cozum.data.koli !== undefined ? { koli: cozum.data.koli } : {}),
        kim: { uid: h.b.yuk.uid },
      });
      switch (sonuc.sonuc) {
        case 'tamam': {
          sayaclar.etiketBasildi += 1;
          onbellegiDusur();
          // `kim` yanıta GİRMEZ (personel bilgisidir; yalnız belgede).
          const { zaman, koli } = sonuc.etiketBasildi;
          res.status(200).json({ ok: true, etiketBasildi: { zaman, ...(koli !== undefined ? { koli } : {}) } });
          return;
        }
        case 'bulunamadi':
          sayaclar.etiketBasildi404 += 1;
          res.status(404).json({ ok: false });
          return;
        case 'silindi':
          // (2b) Silinmiş talebe etiket işareti yazılmaz.
          sayaclar.etiketBasildi409 += 1;
          res.status(409).json({ ok: false, kod: 'silindi' });
          return;
        default:
          eleAlinmamisSonuc(sonuc);
      }
    } catch (e) { hata500(res, e, 'etiket yazımı'); }
  };

  // 8. Çıkış: o kullanıcının BÜTÜN panel belirteçleri ölür. Yazım başarısızsa 503 (204 değil) — süreç içi iptal değeri
  // yine «şimdi»dir (bu süreçte belirteç hemen ölür); panel belirteci her iki durumda da siler.
  const cikis = async (req: Request, res: Response): Promise<void> => {
    const b = istekBaglami.get(req);
    if (!b) { reddet(res, 401); return; }
    try {
      await C.iptal.iptalEt(b.yuk.uid, b.kullanici.cid);
    } catch (e) {
      console.error('[magaza-panel] çıkış: iptal yazılamadı:', hataKodu(e));
      reddet(res, 503);
      return;
    }
    try {
      await C.writeAuditLog({ uid: b.yuk.uid, email: b.yuk.eposta }, 'Mağaza paneli oturumu', `kapandı · ${b.yuk.eposta}`);
    } catch (e) {
      console.error('[magaza-panel] çıkış denetim kaydı yazılamadı:', hataKodu(e));
    }
    res.status(204).end();
  };

  // 9. `/panel` altındaki her başka yol ve yöntem (kapıdan SONRA: belirteçsiz istek buraya ulaşamaz, 401 alır).
  const bulunamadi = (_req: Request, res: Response): void => { reddet(res, 404); };

  // 10. Zincir içi hata yakalayıcı — dış zincirinkiyle AYNI kural (gövde hatası 400 / 413, diğeri 500; kişisel veri yazmaz).
  // DÖRT parametre şart; `next(err)` ÇAĞRILMAZ (genel yakalayıcı hata iletisini — gövdenin ilk karakterlerini — günlüğe basar).
  const hataYakalayici = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (res.headersSent) { req.socket.destroy(); return; }
    const durum = nesneMi(err) ? err.status : undefined;
    if (typeof durum === 'number' && Number.isInteger(durum) && durum >= 400 && durum <= 499) { reddet(res, durum); return; }
    console.error('[magaza-panel] zincir hatası:', hataKodu(err));
    reddet(res, 500);
  };

  const panel = Router();
  panel.use(onbelleksiz);
  panel.use(kokenKapisi);
  panel.use(yapilandirmaKapisi);
  panel.use('/oturum', C.panelOturumSinirlayici);
  panel.post('/oturum', jsonDegilse415, govdeAyristir, oturum);
  panel.use(C.panelSinirlayici);
  panel.use(belirtecKapisi);
  panel.get('/siparisler', liste);
  panel.post('/siparisler/:id/durum', jsonDegilse415, govdeAyristir, durumYaz);
  panel.post('/siparisler/:id/kalem-teslim', jsonDegilse415, govdeAyristir, kalemTeslim);
  panel.post('/siparisler/:id/sil', jsonDegilse415, govdeAyristir, sil);
  panel.post('/siparisler/:id/etiket-basildi', jsonDegilse415, govdeAyristir, etiketBasildi);
  panel.post('/cikis', jsonDegilse415, govdeAyristir, cikis);
  panel.use(bulunamadi);
  panel.use(hataYakalayici);
  return panel;
}
