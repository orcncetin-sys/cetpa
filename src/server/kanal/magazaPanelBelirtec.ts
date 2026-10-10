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
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { APP_ROLES } from '../../lib/rbac.js';
import type { AppRole } from '../../lib/rbac.js';
import { MAGAZA_PANEL_AD_SINIRI } from '../../lib/magazaTalep.js';

export const MAGAZA_PANEL_BELIRTEC_OMRU_MS = 8 * 60 * 60 * 1000;
export const MAGAZA_PANEL_BELIRTEC_EN_UZUN = 2048;
export const MAGAZA_PANEL_BELIRTEC_ONEKI = 'mp1-';
export const MAGAZA_PANEL_ANAHTAR_ETIKETI = 'magaza-panel-v1';
export const MAGAZA_PANEL_DONUS_VARSAYILAN = 'https://www.cetpa.com.tr/panel.html';

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

const imzala = (anahtar: Buffer, yuk: string): Buffer =>
  createHmac('sha256', anahtar).update(MAGAZA_PANEL_BELIRTEC_ONEKI + yuk, 'utf8').digest();

export function panelBelirteciUret(anahtar: Buffer, yuk: PanelBelirtecYuku): string {
  const yukMetni = Buffer.from(JSON.stringify(yuk), 'utf8').toString('base64url');
  return `${MAGAZA_PANEL_BELIRTEC_ONEKI}${yukMetni}.${imzala(anahtar, yukMetni).toString('base64url')}`;
}

/** Her hata `null` (fırlatmaz). Süre ve iptal denetimi ÇAĞIRANINDIR. */
export function panelBelirteciCoz(anahtar: Buffer, belirtec: unknown): PanelBelirtecYuku | null {
  if (typeof belirtec !== 'string' || belirtec.length > MAGAZA_PANEL_BELIRTEC_EN_UZUN || !belirtec.startsWith(MAGAZA_PANEL_BELIRTEC_ONEKI)) return null;
  const parcalar = belirtec.slice(MAGAZA_PANEL_BELIRTEC_ONEKI.length).split('.');
  if (parcalar.length !== 2) return null;
  const [yukMetni, imzaMetni] = parcalar;
  if (!BASE64URL.test(yukMetni) || !BASE64URL.test(imzaMetni)) return null;
  const beklenen = imzala(anahtar, yukMetni);
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

/** `bas ≤ şimdi < bitis`. */
export function belirtecSuresiIcinde(yuk: Pick<PanelBelirtecYuku, 'bas' | 'bitis'>, simdiMs: number): boolean {
  return yuk.bas <= simdiMs && simdiMs < yuk.bitis;
}

/** server.ts açılış kapısıyla aynı ölçüt (`!process.env.X`; `=== undefined` boş dizgeyi kaçırırdı — kapı 2 `donus.mts`). */
export function panelSirriVar(ortam: { SESSION_TOKEN_SECRET?: string; FIREBASE_PRIVATE_KEY?: string }): boolean {
  return !!ortam.SESSION_TOKEN_SECRET || !!ortam.FIREBASE_PRIVATE_KEY;
}

/**
 * Panel anahtarı. `oturumSirri` server.ts'in TÜRETİLMİŞ `SESSION_TOKEN_SECRET` sabitidir (ham ortam değeri ya da
 * `FIREBASE_PRIVATE_KEY`ten türetilen); `sirVar` yanlışsa (iki ortam değişkeni de boş) ya da dönüş adresi `null` ise `null`.
 */
export function panelAnahtariTuret(g: { sirVar: boolean; oturumSirri: string; donusTabani: string | null; appUrl: string | undefined }): Buffer | null {
  if (!g.sirVar || g.donusTabani === null) return null;
  return createHmac('sha256', g.oturumSirri).update(`${MAGAZA_PANEL_ANAHTAR_ETIKETI}\n${g.donusTabani}\n${g.appUrl ?? ''}`, 'utf8').digest();
}

/** Kurallı dönüş tabanı (`origin + pathname`) ya da `null` (ayar geçersiz → bütün panel uçları 503 `panel-yapilandirilmamis`). */
export function donusTabaniCoz(ham: string | undefined, secenek: { uretim: boolean; izinliKokenler: readonly string[] }): string | null {
  const metin = (ham ?? '').trim() === '' ? MAGAZA_PANEL_DONUS_VARSAYILAN : (ham ?? '');
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
