/**
 * magazaPanelBelirtec.ts — site paneli BELİRTECİ (dilim 2a, § 3.4, § 3.7).
 *
 * Biçim `mp1-<yük>.<imza>` — İKİ parça: `istemciIp.JWT_BICIMI`ne (üç parça) UYMAZ, hiçbir sınırlayıcıda Firebase
 * doğrulayıcısına gitmez. `yük = base64url(JSON { uid, cid, rol, ad, eposta, mfa, bas, bitis })` (`bas` / `bitis` ms; ömür 8 sa;
 * `ad` ≤ 80 birim — 700 birimlik adla yük 2.048 tavanını aşıyordu). `imza = base64url(HMAC-SHA256(anahtar, 'mp1-' + yük))`.
 *
 * DOĞRULAMA SIRASI: uzunluk tavanı (2.048) → önek ve tek nokta → imza baytları eşit uzunlukta + `timingSafeEqual` → JSON
 * `try` içinde → alan türleri (zod `.strict()`). Her hata «geçersiz»dir (`null`; kapı 401 — 500 değil). Yükteki `rol` yalnız
 * GÖSTERİMDİR; yetki her istekte `panelKullanicisi(uid)` ile yeniden okunur. Süre (`bas ≤ şimdi < bitis`) ve iptal kapınındır.
 *
 * ANAHTAR (§ 3.7, server.ts'te çözülür; rota modülü sırrı görmez): `HMAC-SHA256(SESSION_TOKEN_SECRET, 'magaza-panel-v1\n' +
 * donusTabani + '\n' + (APP_URL ?? ''))`. `SESSION_TOKEN_SECRET` ve `FIREBASE_PRIVATE_KEY` İKİSİ de boş / tanımsızsa `null`
 * (NODE_ENV'den bağımsız; sabit yedekle belirteç ÜRETİLMEZ). Oturum çereziyle aynı anahtar değildir; etiket ortamı da bağlar
 * (hazırlık ortamı üretimin sırrını kopyalıyor, `APP_URL`'i kopyalamıyor).
 *
 * DÖNÜŞ ADRESİ (§ 3.7): `MAGAZA_PANEL_DONUS` (varsayılan `https://www.cetpa.com.tr/panel.html`) `new URL()` ile çözülür;
 * `https:` (üretim dışında `http://localhost` / `http://127.0.0.1` de), kullanıcı adı / parola / sorgu / parça YOK, `origin`
 * izinli listede VAR. Kurallı biçim `donusTabani = url.origin + url.pathname` kullanılır — ham ortam metni DEĞİL (sonu `#` ya
 * da boşluk olan ayar `new URL` denetiminden geçiyor ama ham birleştirmede `##kod=` üretiyordu).
 *
 * BELİRTEÇ TÜRÜ (2026-10-21, şartname «müşteri siparişlerim» H3): önek, anahtar etiketi ve dönüş varsayılanı TEK `BelirtecTuru`
 * nesnesinden gelir — site paneli (`PANEL_BELIRTECI`: `mp1-`, `magaza-panel-v1`, panel.html) ve müşteri / bayi ekranı
 * (`BAYI_BELIRTECI`: `mb1-`, `magaza-bayi-v1`, bayi.html). Tür parametresi ZORUNLUDUR (varsayılanı yok: unutulursa bayi
 * panel.html'e düşmesin). Etiket ayrı olduğu için aynı sır, `APP_URL` ve dönüş tabanıyla bile iki anahtar EŞİT DEĞİLDİR: panel
 * belirteci bayi kapısında ANAHTAR düzeyinde geçersizdir (önek farkından bağımsız). Eski panel adları (`panelBelirteciUret`,
 * `panelBelirteciCoz`, `panelAnahtariTuret`, `donusTabaniCoz` ve dışa açık sabitler) `PANEL_BELIRTECI`'ne bağlı tek satırlık
 * sarmalayıcılardır — panel davranışı DEĞİŞMEDİ. Bayi sipariş kimliği anahtarı imza anahtarından AYRI türer (`bayiKimlikAnahtariTuret`).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { APP_ROLES } from '../../lib/rbac.js';
import type { AppRole } from '../../lib/rbac.js';
import { MAGAZA_PANEL_AD_SINIRI } from '../../lib/magazaTalep.js';

/** Belirteç türü: biçimin öneki, anahtar türetme etiketi ve dönüş adresinin varsayılanı birlikte değişir. */
export interface BelirtecTuru {
  readonly onek: string;
  readonly etiket: string;
  readonly donusVarsayilan: string;
}

/** Site paneli (personel; dilim 2a). */
export const PANEL_BELIRTECI: BelirtecTuru = Object.freeze({
  onek: 'mp1-', etiket: 'magaza-panel-v1', donusVarsayilan: 'https://www.cetpa.com.tr/panel.html',
});
/** Müşteri / bayi ekranı (dış rol; 2026-10-21). */
export const BAYI_BELIRTECI: BelirtecTuru = Object.freeze({
  onek: 'mb1-', etiket: 'magaza-bayi-v1', donusVarsayilan: 'https://www.cetpa.com.tr/bayi.html',
});

export const MAGAZA_PANEL_BELIRTEC_OMRU_MS = 8 * 60 * 60 * 1000;
/** Bayi belirtecinin ömrü — panelle AYNI (8 sa); sitedeki 30 dakikalık hareketsizlik kapanışı ayrıca istemcidedir. */
export const MAGAZA_BAYI_BELIRTEC_OMRU_MS = MAGAZA_PANEL_BELIRTEC_OMRU_MS;
export const MAGAZA_PANEL_BELIRTEC_EN_UZUN = 2048;
export const MAGAZA_PANEL_BELIRTEC_ONEKI = PANEL_BELIRTECI.onek;
export const MAGAZA_PANEL_ANAHTAR_ETIKETI = PANEL_BELIRTECI.etiket;
export const MAGAZA_PANEL_DONUS_VARSAYILAN = PANEL_BELIRTECI.donusVarsayilan;
/** Bayi sipariş kimliği anahtarının etiketi (imza anahtarından AYRI türetilir; dönüş tabanını taşımaz). */
export const MAGAZA_BAYI_KIMLIK_ETIKETI = 'magaza-bayi-kimlik-v1';

export interface PanelBelirtecYuku {
  uid: string;
  cid: string;
  /** Yalnız gösterim; yetki her istekte yeniden okunur. */
  rol: AppRole;
  ad: string;
  eposta: string;
  /** Veriliş anında MFA açık mıydı (sonradan açan kullanıcının eski belirteci kapıda düşer). */
  mfa: boolean;
  bas: number;
  bitis: number;
}

const rolMu = (v: unknown): v is AppRole => typeof v === 'string' && (APP_ROLES as readonly string[]).includes(v);

const YukSemasi = z.object({
  uid: z.string().min(1),
  cid: z.string().min(1),
  rol: z.custom<AppRole>(rolMu),
  ad: z.string().max(MAGAZA_PANEL_AD_SINIRI),
  eposta: z.string(),
  mfa: z.boolean(),
  bas: z.number().int(),
  bitis: z.number().int(),
}).strict();

const BASE64URL = /^[A-Za-z0-9_-]+$/;

const imzala = (tur: BelirtecTuru, anahtar: Buffer, yuk: string): Buffer =>
  createHmac('sha256', anahtar).update(tur.onek + yuk, 'utf8').digest();

/** `<önek><yük>.<imza>` — önek ve imza girdisi türden. */
export function belirtecUret(tur: BelirtecTuru, anahtar: Buffer, yuk: PanelBelirtecYuku): string {
  const yukMetni = Buffer.from(JSON.stringify(yuk), 'utf8').toString('base64url');
  return `${tur.onek}${yukMetni}.${imzala(tur, anahtar, yukMetni).toString('base64url')}`;
}

/** Her hata `null` (fırlatmaz). Süre ve iptal denetimi ÇAĞIRANINDIR. Başka türün öneki / anahtarı → `null`. */
export function belirtecCoz(tur: BelirtecTuru, anahtar: Buffer, belirtec: unknown): PanelBelirtecYuku | null {
  if (typeof belirtec !== 'string' || belirtec.length > MAGAZA_PANEL_BELIRTEC_EN_UZUN || !belirtec.startsWith(tur.onek)) return null;
  const parcalar = belirtec.slice(tur.onek.length).split('.');
  if (parcalar.length !== 2) return null;
  const [yukMetni, imzaMetni] = parcalar;
  if (!BASE64URL.test(yukMetni) || !BASE64URL.test(imzaMetni)) return null;
  const beklenen = imzala(tur, anahtar, yukMetni);
  const gelen = Buffer.from(imzaMetni, 'base64url');
  if (gelen.length !== beklenen.length || !timingSafeEqual(gelen, beklenen)) return null;
  let ham: unknown;
  try {
    ham = JSON.parse(Buffer.from(yukMetni, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const cozum = YukSemasi.safeParse(ham);
  return cozum.success ? cozum.data : null;
}

export function panelBelirteciUret(anahtar: Buffer, yuk: PanelBelirtecYuku): string {
  return belirtecUret(PANEL_BELIRTECI, anahtar, yuk);
}

/** Her hata `null` (fırlatmaz). Süre ve iptal denetimi ÇAĞIRANINDIR. */
export function panelBelirteciCoz(anahtar: Buffer, belirtec: unknown): PanelBelirtecYuku | null {
  return belirtecCoz(PANEL_BELIRTECI, anahtar, belirtec);
}

/** `bas ≤ şimdi < bitis`. */
export function belirtecSuresiIcinde(yuk: Pick<PanelBelirtecYuku, 'bas' | 'bitis'>, simdiMs: number): boolean {
  return yuk.bas <= simdiMs && simdiMs < yuk.bitis;
}

/** server.ts açılış kapısıyla aynı ölçüt (`!process.env.X`; `=== undefined` boş dizgeyi kaçırırdı — kapı 2 `donus.mts`). */
export function panelSirriVar(ortam: { SESSION_TOKEN_SECRET?: string; FIREBASE_PRIVATE_KEY?: string }): boolean {
  return !!ortam.SESSION_TOKEN_SECRET || !!ortam.FIREBASE_PRIVATE_KEY;
}

/** Anahtar türetme girdisi (server.ts'te çözülür; sır yalnız buraya gelir). */
export interface AnahtarGirdisi { sirVar: boolean; oturumSirri: string; donusTabani: string | null; appUrl: string | undefined }

/**
 * Türün belirteç anahtarı: `HMAC-SHA256(oturumSirri, '<etiket>\n' + donusTabani + '\n' + (APP_URL ?? ''))`. `oturumSirri` server.ts'in
 * TÜRETİLMİŞ `SESSION_TOKEN_SECRET` sabitidir (ham ortam değeri ya da `FIREBASE_PRIVATE_KEY`ten türetilen); `sirVar` yanlışsa (iki
 * ortam değişkeni de boş) ya da dönüş adresi `null` ise `null`.
 */
export function anahtarTuret(tur: BelirtecTuru, g: AnahtarGirdisi): Buffer | null {
  if (!g.sirVar || g.donusTabani === null) return null;
  return createHmac('sha256', g.oturumSirri).update(`${tur.etiket}\n${g.donusTabani}\n${g.appUrl ?? ''}`, 'utf8').digest();
}

/** Panel anahtarı (`anahtarTuret(PANEL_BELIRTECI, …)`). */
export function panelAnahtariTuret(g: AnahtarGirdisi): Buffer | null {
  return anahtarTuret(PANEL_BELIRTECI, g);
}

/**
 * Bayi sipariş kimliği anahtarı — imza anahtarından AYRI: `HMAC-SHA256(oturumSirri, 'magaza-bayi-kimlik-v1\n' + (APP_URL ?? ''))`.
 * Sır yoksa `null` (bayi uçları 503; sabit yedek anahtar YOK). Dönüş tabanını taşımaz: dönüş adresi değişince müşterinin gördüğü
 * kimlikler oturum içinde zaten değişir (oturum anahtarı `bas`), anahtarın ayrı kalması yeter.
 */
export function bayiKimlikAnahtariTuret(g: { sirVar: boolean; oturumSirri: string; appUrl: string | undefined }): Buffer | null {
  if (!g.sirVar) return null;
  return createHmac('sha256', g.oturumSirri).update(`${MAGAZA_BAYI_KIMLIK_ETIKETI}\n${g.appUrl ?? ''}`, 'utf8').digest();
}

/**
 * Türün kurallı dönüş tabanı (`origin + pathname`) ya da `null` (ayar geçersiz → türün bütün uçları 503). Boş / yalnız boşluk ham
 * değer türün VARSAYILANINA düşer (bayi için bayi.html — panel.html'e değil).
 */
export function donusTabaniCozTur(tur: BelirtecTuru, ham: string | undefined, secenek: { uretim: boolean; izinliKokenler: readonly string[] }): string | null {
  const metin = (ham ?? '').trim() === '' ? tur.donusVarsayilan : (ham ?? '');
  let url: URL;
  try {
    url = new URL(metin);
  } catch {
    return null;
  }
  const yerel = !secenek.uretim && url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !yerel) return null;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null;
  // Sonu `#` / `?` / boşluk olan ayar: `hash` / `search` BOŞ döner (reddedilmez) — kurallı `origin + pathname` ayracı taşımaz.
  if (!secenek.izinliKokenler.includes(url.origin)) return null;
  return url.origin + url.pathname;
}

/** Panel dönüş tabanı (`donusTabaniCozTur(PANEL_BELIRTECI, …)`); `null` → bütün panel uçları 503 `panel-yapilandirilmamis`. */
export function donusTabaniCoz(ham: string | undefined, secenek: { uretim: boolean; izinliKokenler: readonly string[] }): string | null {
  return donusTabaniCozTur(PANEL_BELIRTECI, ham, secenek);
}
