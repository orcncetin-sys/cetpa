/**
 * shopifyBaglanti.ts — çevrim içi mağaza (Shopify) ↔ kiracı BAĞLANTISI: doğrulama, imza, yanıt biçimi (2026-10-02).
 *
 * "Bağlantı" = mağazanın webhook'u + imza sırrı. Shopify özel başlık gönderemez; kimlik HMAC'tir. Eskiden sır yalnız ortam
 * değişkenindeydi (tek global sır, mağaza ↔ kiracı eşlemesi yok). Artık kiracı başına, `shopifyBaglantilari` koleksiyonunda:
 *   `<cid>`         → { companyId, shopDomain, webhookSecret, tuz, baglantiSurumu, guncelleyenUid, guncellendi }
 *   `<cid>__durum`  → { companyId, baglantiSurumu, sonBildirim, sonTopic, sonSiparisNo, sonSonuc, sonHata, sonHataZamani,
 *                       sonHataOlay, sonHataTopic, sonHataOlayNo, sonApiSurumu, toplamBildirim, sonImzaReddi }
 * Koleksiyon SUNUCUYA ÖZELDİR (/api/db 403, akışa çıkmaz, kiracı yedeğine girmez) — `settings` sır için güvenli değildi.
 * Sırrın DEĞERİ hiçbir yanıtta, günlükte, denetim kaydında yer almaz: yanıtı YALNIZ `baglantiYaniti` üretir.
 * `tuz`: sipariş doküman kimliğini tahmin edilemez kılar (shopifyEsleme.shopifySiparisKimligi); ilk kurulumda üretilir ve sır
 * değişse de DEĞİŞMEZ (değişirse aynı sipariş ikinci kez, başka kimlikle yazılırdı). «Bağlantıyı kaldır» da tuzu SİLMEZ:
 * `<cid>` dokümanı `{ companyId, tuz, … }` yarım kaydı olarak kalır (sır ve alan adı gider → `baglantiKaydi` null, bağlantı yok
 * sayılır); yeniden kurulum aynı tuzu kullanır ve açık siparişlerin sonraki olayları AYNI dokümana düşer.
 * `sonImzaReddi`: imzası tutmayan son bildirimin zamanı (rota yazar, kısıtlı). `sonBildirim` / `toplamBildirim`'e DOKUNMAZ —
 * doğrulanmamış istek bağlantıyı «doğrulanmış» göstermesin; başarılı bildirim de bu alanı silmez (kart zamanları karşılaştırır).
 * `sonHataOlay` / `sonHataTopic` / `sonHataOlayNo`: `sonHata`'yı üreten olayın sipariş dokümanı kimliği, topic'i ve Shopify
 * olay kimliği (`X-Shopify-Webhook-Id`) — iç alanlar, yanıta ÇIKMAZ (shopifyWebhook.durumYaz).
 * `baglantiSurumu` (2026-10-07): bağlantının KİMLİĞİ — rastgele üretilir (sırdan / alan adından TÜRETİLMEZ), alan adı ya da
 * sır DEĞERİ değişince yenilenir. Durum dokümanı yazıldığı sürümü DAMGA olarak taşır; damgası kayıttaki sürümü tutmayan durum
 * eski bağlantının kalıntısıdır: okunurken YOK sayılır (`baglantiYaniti`), yazılırken birleştirilmez (`durumBuSurumunMu`).
 * «Durum bu bağlantıyı doğrular» kuralı böylece durum dokümanının SİLİNMESİNE bağlı değildir — silme başarısız olabilir,
 * kuyrukta bekleyen eski iş silmeden sonra yazabilir. İç alan, yanıta ÇIKMAZ. Sürümsüz (bu alandan önce yazılmış) kayıt
 * geçerlidir ve yalnız damgasız durumla eşleşir; ilk alan adı / sır değişiminde sürüm alır.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const BAGLANTI_KOLEKSIYONU = 'shopifyBaglantilari';
export const WEBHOOK_YOLU = '/api/shopify/webhook';
export const durumKimligi = (cid: string): string => `${cid}__durum`;

const ALAN_ADI = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
// `new RegExp`: düzenli ifade değişmezinde art arda iki eğik çizgi yorum başlangıcı sanılıyor (kaynak tarayan değişmez testleri).
const SEMA = new RegExp('^https?://');

/** Mağaza alan adı: kırp, küçült, `https://` ve yolu at; `<ad>.myshopify.com` değilse null. */
export function alanAdiNormallestir(ham: unknown): string | null {
  if (typeof ham !== 'string') return null;
  const s = ham.trim().toLowerCase().replace(SEMA, '').replace(/[/?#].*$/, '');
  return ALAN_ADI.test(s) ? s : null;
}

/** İmza sırrı: 16–256 karakter, boşluksuz yazdırılabilir ASCII. Uymuyorsa null. */
export function sirGecerli(ham: unknown): string | null {
  if (typeof ham !== 'string') return null;
  const s = ham.trim();
  return /^[\x21-\x7e]{16,256}$/.test(s) ? s : null;
}

export const tuzUret = (): string => randomBytes(32).toString('hex');
/** Bağlantı sürümü: rastgele kimlik — sır ya da alan adı bilgisi TAŞIMAZ. */
export const surumUret = (): string => randomBytes(16).toString('hex');

/** Shopify imzası: HMAC-SHA256(ham gövde, sır) → base64; karşılaştırma sabit zamanlı. */
export function imzaGecerli(hamGovde: Buffer | undefined, imza: unknown, sir: string): boolean {
  if (!hamGovde || typeof imza !== 'string' || imza === '' || !sir) return false;
  const beklenen = Buffer.from(createHmac('sha256', sir).update(hamGovde).digest('base64'), 'utf8');
  const gelen = Buffer.from(imza, 'utf8');
  return beklenen.length === gelen.length && timingSafeEqual(beklenen, gelen);
}

const metinYaDaNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
/** Ham değer (kayıt / durum dokümanı / kuyruk işi) → bağlantı sürümü; eksik, boş ya da metin olmayan = sürümsüz (null). */
export const surumOku = (v: unknown): string | null => metinYaDaNull(v);

export interface BaglantiKaydi {
  companyId: string; shopDomain: string; webhookSecret: string; tuz: string;
  /** Bağlantının kimliği (dosya başı); sürümsüz eski kayıtta null. */
  baglantiSurumu: string | null;
}

/** Veritabanı dokümanı → kayıt. Eksik / bozuk doküman null (bağlantı yok sayılır — yarım kayıtla imza doğrulanmaz). */
export function baglantiKaydi(d: Record<string, unknown> | undefined): BaglantiKaydi | null {
  if (!d) return null;
  const { companyId, shopDomain, webhookSecret, tuz } = d;
  if (typeof companyId !== 'string' || !companyId || typeof shopDomain !== 'string' || !ALAN_ADI.test(shopDomain)) return null;
  if (typeof webhookSecret !== 'string' || !webhookSecret || typeof tuz !== 'string' || !tuz) return null;
  return { companyId, shopDomain, webhookSecret, tuz, baglantiSurumu: surumOku(d.baglantiSurumu) };
}

/** Durum dokümanı BU bağlantı sürümüne mi ait? Damga birebir tutmalı; doküman yoksa da false. */
export function durumBuSurumunMu(durum: Record<string, unknown> | undefined, surum: string | null): boolean {
  return !!durum && surumOku(durum.baglantiSurumu) === surum;
}
/**
 * Durum dokümanına her yazımda konan ortak kısım: kiracı + sürüm damgası. İki yazıcı var (işçi `shopifyWebhook.durumYaz`,
 * rota `imzaReddiniIsaretle`); ikisi de damgayı BURADAN alır ve eldeki durum `durumBuSurumunMu` değilse birleştirmeden yazar.
 */
export const durumDamgasi = (cid: string, surum: string | null): Record<string, unknown> =>
  ({ companyId: cid, ...(surum ? { baglantiSurumu: surum } : {}) });

export interface BaglantiDurumu {
  sonBildirim: string | null; sonTopic: string | null; sonSiparisNo: string | null; sonSonuc: string | null;
  sonHata: string | null; sonHataZamani: string | null; sonApiSurumu: string | null; toplamBildirim: number | null;
  /** İmzası tutmayan son bildirimin zamanı (ISO) — sır yanlışsa kart bunu gösterir. */
  sonImzaReddi: string | null;
}

export interface BaglantiYaniti {
  success: true; configured: boolean; shopDomain: string | null; webhookSirriKayitli: boolean;
  /** Tam adres (APP_URL biliniyorsa) — bilinmiyorsa null; istemci `window.location.origin` + `webhookYolu` ile kurar. */
  webhookAdresi: string | null; webhookYolu: string; durum: BaglantiDurumu | null;
}

/**
 * GET yanıtı — SIR, TUZ ve SÜRÜM ALANI YOK (değişmez testi: anahtar listesi sabit).
 * `hamDurum` yalnız kayıttaki sürümün damgasını taşıyorsa yanıta girer; eski bağlantının kalıntısı `durum: null` verir.
 */
export function baglantiYaniti(kayit: BaglantiKaydi | null, hamDurum: Record<string, unknown> | undefined, uygulamaAdresi: string | undefined): BaglantiYaniti {
  const taban = typeof uygulamaAdresi === 'string' && SEMA.test(uygulamaAdresi) ? uygulamaAdresi.replace(/\/+$/, '') : null;
  const durum = kayit && durumBuSurumunMu(hamDurum, kayit.baglantiSurumu) ? hamDurum : undefined;
  return {
    success: true,
    configured: !!kayit,
    shopDomain: kayit?.shopDomain ?? null,
    webhookSirriKayitli: !!kayit,
    webhookAdresi: taban ? `${taban}${WEBHOOK_YOLU}` : null,
    webhookYolu: WEBHOOK_YOLU,
    durum: durum ? {
      sonBildirim: metinYaDaNull(durum.sonBildirim), sonTopic: metinYaDaNull(durum.sonTopic),
      sonSiparisNo: metinYaDaNull(durum.sonSiparisNo), sonSonuc: metinYaDaNull(durum.sonSonuc),
      sonHata: metinYaDaNull(durum.sonHata), sonHataZamani: metinYaDaNull(durum.sonHataZamani),
      sonApiSurumu: metinYaDaNull(durum.sonApiSurumu),
      toplamBildirim: typeof durum.toplamBildirim === 'number' && Number.isFinite(durum.toplamBildirim) ? durum.toplamBildirim : null,
      sonImzaReddi: metinYaDaNull(durum.sonImzaReddi),
    } : null,
  };
}

export type KayitIstegi =
  | { tamam: true; shopDomain: string; yeniSir: string | null }
  | { tamam: false; hata: string };

/**
 * Kaydetme gövdesinin doğrulaması. `webhookSecret` boş / yok = mevcut sır KORUNUR; ilk kurulumda (`mevcutVar` false) zorunlu.
 * (Alan adı DEĞİŞİYORSA boş sır kabul edilmez — o denetim rotada: eski mağazanın sırrı yeni mağazayı doğrulamaz.)
 * Hata metni girilen sırrı YANKILAMAZ.
 */
export function kayitIstegi(govde: unknown, mevcutVar: boolean): KayitIstegi {
  const g = (govde && typeof govde === 'object' ? govde : {}) as { shopDomain?: unknown; webhookSecret?: unknown };
  const shopDomain = alanAdiNormallestir(g.shopDomain);
  if (!shopDomain) return { tamam: false, hata: 'Mağaza alan adı «magaza-adi.myshopify.com» biçiminde olmalı.' };
  const bos = g.webhookSecret === undefined || g.webhookSecret === null || (typeof g.webhookSecret === 'string' && g.webhookSecret.trim() === '');
  if (bos) return mevcutVar ? { tamam: true, shopDomain, yeniSir: null } : { tamam: false, hata: 'İlk kurulumda webhook imza sırrı gerekli.' };
  const yeniSir = sirGecerli(g.webhookSecret);
  if (!yeniSir) return { tamam: false, hata: 'Webhook imza sırrı 16–256 karakter olmalı ve boşluk içermemeli.' };
  return { tamam: true, shopDomain, yeniSir };
}
