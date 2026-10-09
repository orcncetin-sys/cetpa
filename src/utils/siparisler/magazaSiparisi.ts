/**
 * magazaSiparisi.ts — ÇEVRİM İÇİ MAĞAZA (Shopify) siparişinin tanımı + "Online Siparişler" ekranının saf hesapları.
 * TEK KAYNAK (2026-10-02, şartname online-siparis §4 + v2 yamaları). Test: magazaSiparisi.test.ts.
 *
 * NEDEN VAR
 *   1. AYIRT EDİCİ TEK ALAN `source === 'shopify_webhook'`dir. `shopifyOrderId` İŞE YARAMAZ: elle girilen sipariş de o
 *      alanı yazar ("SHP-…", App.tsx AddOrder). Kural tek yerde dursun diye `magazaSiparisiMi` buradadır; ekran,
 *      Siparişler listesindeki rozet ve teslim onayındaki otomatik müşteri iletisinin kapısı (App.tsx) aynı işlevi sorar.
 *   2. SAHTE SIFIR YOK: TRY dışı siparişte sunucu `totalPrice` YAZMAZ (`dovizTutar` + `paraBirimi` yazar; kullanıcı
 *      kararı «kur yoksa uydurma yok»). O sipariş toplama 0 olarak GİRMEZ; kaç siparişin giremediği ayrıca döner ve
 *      ekranda not olarak yazılır (para.ts `toplaBilinen` sözleşmesi).
 *   3. İKİ AYRI DURUM EKSENİ var ve ikisi de okunur:
 *        • Cetpa durumu `status` (Pending < Processing < Shipped < Delivered; Cancelled kalıcı) — kullanıcı Cetpa'da
 *          ilerletebilir, sunucu geri almaz. Süzgeç çipleri BUNA bakar.
 *        • Mağazanın ham durumları `shopifyRaw.financialStatus` / `.fulfillmentStatus` — her olayda tazelenir.
 *      Rozetler ikisini ÇELİŞTİRMEDEN birleştirir: Cetpa'da "ödendi" işaretlenen havale siparişi mağazada hâlâ
 *      'pending' olabilir (sunucu `paid`i tek yönlü tutar) — rozet "Ödendi" der, mağazadaki durum ipucunda kalır.
 *
 * TİPLER YAPISAL (utils/siparis.ts ile aynı karar): işlevler kanonik `Order`'ı şart koşmaz, GERÇEKTEN okuduğu
 * alanları ister — yerel daraltılmış sipariş tipleri de uyar. Saf: I/O, React, tarih "şimdi"si (parametre) yok.
 */
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi';
import { bilinenSayi, toplaBilinen, type Tutar } from '../para';
import { paraYaz } from '../currency';
import { gorunenSiparisNo, siparisIptalMi, siparisTarih, siparisTarihMs } from '../siparis';
import { bugunAnahtari, gunAnahtari } from '../zaman';
import { eslesir } from '../arama';
import { kargoDurumuEtiketi, odemeDurumuEtiketi, siparisDurumEtiketi } from '../durumEtiketi';

/** Sunucudaki webhook eşleyicisinin `orders.source`a yazdığı değer — tek kaynak lib/magazaKaynagi (sunucu da oradan okur). */
export { MAGAZA_KAYNAGI };

/** Mağazanın ham durumları — types.ts `ShopifyHamDurum` ile yapısal olarak uyumlu. */
export interface MagazaHamDurum {
  financialStatus?: string | null;
  fulfillmentStatus?: string | null;
  odemeYontemi?: string | null;
}

/** Bu modülün bir siparişten okuduğu alanlar. Kanonik `Order` yapısal olarak uyar. */
export interface MagazaSiparisAlanlari {
  id?: string;
  source?: string;
  status?: string;
  paid?: boolean;
  orderNumber?: string;
  shopifyOrderId?: string | number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  teslimatSehri?: string;
  paraBirimi?: string;
  totalPrice?: unknown;
  dovizTutar?: unknown;
  syncedAt?: unknown;
  createdAt?: unknown;
  orderDate?: unknown;
  lineItems?: readonly unknown[] | null;
  shopifyRaw?: MagazaHamDurum | null;
}

/** Çevrim içi mağazadan (webhook ile) gelen sipariş mi? Tek ölçüt `source`. */
export function magazaSiparisiMi(o: { source?: unknown } | null | undefined): boolean {
  return !!o && o.source === MAGAZA_KAYNAGI;
}

/** Listeden yalnız mağaza siparişlerini süzer (sıra korunur). */
export function magazaSiparisleri<T extends { source?: unknown }>(siparisler: readonly T[]): T[] {
  return siparisler.filter(magazaSiparisiMi);
}

// ── TUTAR ─────────────────────────────────────────────────────────────────────────────────────────────────────

const birimMetni = (o: MagazaSiparisAlanlari): string => (typeof o.paraBirimi === 'string' ? o.paraBirimi.trim() : '');

/**
 * Sipariş TRY dışı mı? Birim yazılmamışsa TRY sayılır: sunucu `totalPrice`ı YALNIZ TRY siparişte yazar, birimsiz +
 * `totalPrice`lı kayıt (eski biçim) TL'dir. Kıyas ASCII kod üzerinde, büyük/küçük harf duyarsız.
 */
export function tryDisiMi(o: MagazaSiparisAlanlari): boolean {
  const b = birimMetni(o);
  return b !== '' && !/^try$/i.test(b);
}

/** Siparişin TL tutarı; TRY dışıysa ya da `totalPrice` yoksa NaN (ASLA 0 — toplama girmez). */
export function tryTutari(o: MagazaSiparisAlanlari): number {
  if (tryDisiMi(o)) return NaN;
  return bilinenSayi(o.totalPrice) ? Number(o.totalPrice) : NaN;
}

/**
 * Ekranda gösterilecek tutar, siparişin KENDİ para biriminde — çeviri YOK.
 * TRY dışı: `dovizTutar` + birim. TRY (ya da birimsiz): `totalPrice` + 'TRY'. Bilinmiyorsa `tutar` NaN ('—' basılır).
 */
export function magazaTutari(o: MagazaSiparisAlanlari): { tutar: number; birim: string } {
  if (tryDisiMi(o)) return { tutar: bilinenSayi(o.dovizTutar) ? Number(o.dovizTutar) : NaN, birim: birimMetni(o) };
  return { tutar: tryTutari(o), birim: 'TRY' };
}

/**
 * Tutarın ekran metni (siparişin kendi para biriminde) + yanına yazılacak birim kodu.
 * `paraYaz` simgesi olan birimde simge basar ('₺1.250,50', '$99.90') → kod ayrıca yazılır ki "$" hangi dolar belli olsun;
 * simgesi olmayan birimde kodu zaten metne koyar ('1.234,50 XAU') → `birimEki` null (kod iki kez basılmaz).
 * Bilinmeyen tutar: '—', birim eki yok.
 */
export function magazaTutarMetni(o: MagazaSiparisAlanlari): { metin: string; birimEki: string | null } {
  const { tutar, birim } = magazaTutari(o);
  if (!Number.isFinite(tutar)) return { metin: '—', birimEki: null };
  const metin = paraYaz(tutar, { birim });
  return { metin, birimEki: metin.toLowerCase().includes(birim.toLowerCase()) ? null : birim };
}

// ── ÖDEME ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Mağazada parası HENÜZ tam alınmamış ödeme durumları (Shopify `financial_status`). */
const ODEMESI_BEKLEYEN = new Set(['pending', 'authorized', 'partially_paid']);

const hamOdeme = (o: MagazaSiparisAlanlari): string => {
  const d = o.shopifyRaw?.financialStatus;
  return typeof d === 'string' ? d.trim() : '';
};

/**
 * Ödeme bekliyor mu? İptal edilen sipariş beklemez. `paid === true` (mağaza "ödendi" dedi YA DA kullanıcı Cetpa'da
 * işaretledi — sunucu bu alanı geri almaz) → beklemiyor. Aksi hâlde mağazanın ödeme durumu belirler: pending /
 * authorized / partially_paid bekliyor; refunded / voided BEKLEMİYOR (para iade/iptal edilmiş, gelecek ödeme yok).
 * Mağaza durumu hiç yoksa yalnız AÇIKÇA `paid === false` yazılmış kayıt bekliyor sayılır — `paid` alanı da yoksa
 * durum BİLİNMİYOR'dur, "bekliyor" uydurulmaz.
 */
export function odemeBekliyorMu(o: MagazaSiparisAlanlari): boolean {
  if (siparisIptalMi(o)) return false;
  if (o.paid === true) return false;
  const ham = hamOdeme(o);
  if (ham) return ODEMESI_BEKLEYEN.has(ham);
  return o.paid === false;
}

// ── SÜZGEÇ ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Durum çipleri — kimlikler ASCII ve tireli (URL / test seçicisi olarak da kullanılabilir). */
export type MagazaSuzgeci = 'tumu' | 'odeme-bekliyor' | 'hazirlanacak' | 'kargoda' | 'teslim-edildi' | 'iptal';

export const MAGAZA_SUZGECLERI: readonly MagazaSuzgeci[] = ['tumu', 'odeme-bekliyor', 'hazirlanacak', 'kargoda', 'teslim-edildi', 'iptal'];

/**
 * Hazırlanacak = HENÜZ KARGOYA VERİLMEMİŞ (Cetpa durumu Bekliyor ya da Hazırlanıyor). Ödeme bekleyenler DÂHİLDİR:
 * kapıda ödemeli sipariş mağazada 'pending' durur ama hazırlanması gerekir; onu "ödeme bekliyor" diye bu kümeden
 * çıkarmak işi gizlerdi. Havale bekleyen sipariş de burada görünür — satırdaki ödeme rozeti ayırır, özet kutusu
 * kaçının ödeme beklediğini ayrıca yazar.
 */
export function hazirlanacakMi(o: MagazaSiparisAlanlari): boolean {
  return o.status === 'Pending' || o.status === 'Processing';
}

/**
 * Sipariş süzgece uyuyor mu? Dört ilerleme çipi (`hazirlanacak` / `kargoda` / `teslim-edildi` / `iptal`) Cetpa
 * durumunun BÖLÜNTÜSÜDÜR: birlik içindeki her sipariş tam birinde görünür. `odeme-bekliyor` çapraz bir süzgeçtir.
 */
export function suzgeceUyar(o: MagazaSiparisAlanlari, suzgec: MagazaSuzgeci): boolean {
  switch (suzgec) {
    case 'tumu': return true;
    case 'odeme-bekliyor': return odemeBekliyorMu(o);
    case 'hazirlanacak': return hazirlanacakMi(o);
    case 'kargoda': return o.status === 'Shipped';
    case 'teslim-edildi': return o.status === 'Delivered';
    case 'iptal': return siparisIptalMi(o);
  }
}

/** Her çipin yanındaki sayı. */
export function suzgecSayilari(siparisler: readonly MagazaSiparisAlanlari[]): Record<MagazaSuzgeci, number> {
  const s: Record<MagazaSuzgeci, number> = { 'tumu': 0, 'odeme-bekliyor': 0, 'hazirlanacak': 0, 'kargoda': 0, 'teslim-edildi': 0, 'iptal': 0 };
  for (const o of siparisler) for (const k of MAGAZA_SUZGECLERI) if (suzgeceUyar(o, k)) s[k]++;
  return s;
}

// ── ARAMA ─────────────────────────────────────────────────────────────────────────────────────────────────────

const rakamlar = (x: unknown): string => String(x ?? '').replace(/\D/g, '');

/**
 * Arama: sipariş no, müşteri, e-posta, telefon. Türkçe-duyarlı (utils/arama: `toLocaleLowerCase('tr')` + ASCII
 * indirgeme — "ısık" yazan "IŞIK"ı, "sisli" yazan "Şişli"yi bulur). Telefon ayrıca YALNIZ RAKAMLA kıyaslanır:
 * kayıt "+90 532 123 45 67", sorgu "0532 123" ya da "5321234" olabilir; baştaki 0 / ülke kodu atlanır.
 * Boş sorgu her kaydı geçirir.
 */
export function aramayaUyar(o: MagazaSiparisAlanlari, sorgu: string): boolean {
  if (!sorgu.trim()) return true;
  if (eslesir(sorgu, gorunenSiparisNo(o), o.customerName, o.customerEmail, o.customerPhone)) return true;
  // Telefon biçimi: sorgu yalnız rakam ve ayırıcıdan oluşuyorsa (en az 3 rakam) rakam dizisi olarak ara.
  if (!/^[\d\s+()\-.]+$/.test(sorgu)) return false;
  const tel = rakamlar(o.customerPhone);
  const ham = rakamlar(sorgu);
  if (ham.length >= 3 && tel.includes(ham)) return true;
  const ulusal = ham.replace(/^(?:90|0)/, '');   // "+90 532…" / "0532…" → "532…"
  return ulusal.length >= 3 && tel.includes(ulusal);
}

/** Ekrandaki liste: süzgeç + arama, EN YENİ üstte (tarihi çözülemeyen kayıt en sonda — siparisTarihMs). */
export function magazaListesi<T extends MagazaSiparisAlanlari>(siparisler: readonly T[], suzgec: MagazaSuzgeci, sorgu: string): T[] {
  return siparisler
    .filter(o => suzgeceUyar(o, suzgec) && aramayaUyar(o, sorgu))
    .sort((a, b) => siparisTarihMs(b) - siparisTarihMs(a));
}

// ── ÖZET KUTULARI ─────────────────────────────────────────────────────────────────────────────────────────────

export interface MagazaOzeti {
  /** Mağaza siparişi sayısı (iptaller dâhil — "Tümü" çipiyle aynı sayı). */
  siparis: number;
  /** BUGÜN (yerel gün) gelen, iptal edilmemiş sipariş. Tarihi çözülemeyen kayıt bugüne SAYILMAZ. */
  bugun: number;
  odemeBekleyen: number;
  hazirlanacak: number;
  /** `hazirlanacak` içinden ödemesi bekleyenler (kutunun alt satırı — iki sayı örtüşür, gizlenmez). */
  hazirlanacakOdemeBekleyen: number;
  kargoda: number;
  /**
   * İptal DIŞI siparişlerin TL toplamı (K2: iptal edilen sipariş satış değildir). `toplaBilinen` sözleşmesi:
   * `bilinmeyen` = toplama GİREMEYEN sipariş sayısı; ekrana `ekranTutari(tutar)` basılır (hiçbiri bilinmiyorsa '—').
   */
  tutar: Tutar;
  /** Toplama giremeyenlerin kırılımı: TRY dışı (kur çevrilmez) ve tutarı hiç okunamayan. Toplamları `tutar.bilinmeyen`. */
  tryDisi: number;
  tutarsiz: number;
}

/** Sayfanın özet kutuları. `simdi` parametredir (test edilebilirlik; "bugün" yerel gündür). */
export function magazaOzeti(siparisler: readonly MagazaSiparisAlanlari[], simdi: Date = new Date()): MagazaOzeti {
  const bugun = bugunAnahtari(simdi);
  const iptalDisi = siparisler.filter(o => !siparisIptalMi(o));
  const hazir = iptalDisi.filter(hazirlanacakMi);
  const tryDisi = iptalDisi.filter(tryDisiMi).length;
  const tutar = toplaBilinen(iptalDisi, tryTutari);
  return {
    siparis: siparisler.length,
    bugun: iptalDisi.filter(o => gunAnahtari(siparisTarih(o)) === bugun).length,
    odemeBekleyen: iptalDisi.filter(odemeBekliyorMu).length,
    hazirlanacak: hazir.length,
    hazirlanacakOdemeBekleyen: hazir.filter(odemeBekliyorMu).length,
    kargoda: iptalDisi.filter(o => o.status === 'Shipped').length,
    tutar,
    tryDisi,
    tutarsiz: tutar.bilinmeyen - tryDisi,
  };
}

// ── ROZETLER ──────────────────────────────────────────────────────────────────────────────────────────────────

export type RozetTonu = 'yesil' | 'sari' | 'mavi' | 'kirmizi' | 'gri';

export interface MagazaRozeti {
  /** Ekran etiketi (seçili dilde). Durum bilinmiyorsa '—'. */
  metin: string;
  ton: RozetTonu;
  /**
   * Rozetin dediği ile mağazanın dediği FARKLIYSA mağazadaki durumun etiketi (ipucu için); aynıysa null.
   * Ödemede: kullanıcı Cetpa'da "ödendi" işaretledi, mağaza hâlâ bekliyor diyor. Kargoda: Cetpa durumu ilerledi.
   */
  magazadaki: string | null;
}

const ODEME_TONU: Record<string, RozetTonu> = {
  paid: 'yesil', pending: 'sari', authorized: 'sari', partially_paid: 'sari',
  partially_refunded: 'gri', refunded: 'gri', voided: 'gri',
};
const tonSec = (harita: Record<string, RozetTonu>, ham: string): RozetTonu =>
  Object.prototype.hasOwnProperty.call(harita, ham) ? harita[ham] : 'gri';

/**
 * Ödeme rozeti. Mağaza durumu + Cetpa'daki `paid` işareti birlikte okunur; süzgeçle (`odemeBekliyorMu`) ÇELİŞMEZ:
 * `paid === true` iken mağaza hâlâ bekliyor diyorsa (ya da durumu yoksa) rozet "Ödendi"dir, mağazadaki durum
 * `magazadaki`nde kalır. İade/geçersiz durumlarında mağazanın etiketi korunur (daha bilgilendirici).
 */
export function odemeRozeti(o: MagazaSiparisAlanlari, dil: string): MagazaRozeti {
  const ham = hamOdeme(o);
  if (o.paid === true && (ham === '' || ODEMESI_BEKLEYEN.has(ham))) {
    return { metin: odemeDurumuEtiketi('paid', dil), ton: 'yesil', magazadaki: ham ? odemeDurumuEtiketi(ham, dil) : null };
  }
  if (ham) return { metin: odemeDurumuEtiketi(ham, dil), ton: tonSec(ODEME_TONU, ham), magazadaki: null };
  // Mağaza durumu yok: yalnız açıkça `paid === false` yazılmışsa "bekliyor"; o da yoksa bilinmiyor.
  if (o.paid === false) return { metin: odemeDurumuEtiketi('pending', dil), ton: 'sari', magazadaki: null };
  return { metin: '—', ton: 'gri', magazadaki: null };
}

const KARGO_TONU: Record<string, RozetTonu> = { unfulfilled: 'sari', partial: 'mavi', fulfilled: 'mavi', restocked: 'gri' };

/**
 * Kargo rozeti. Cetpa durumu ilerlemişse (Kargoda / Teslim Edildi / İptal) O gösterilir — durum çipleri de ona
 * bakar, "Kargoda" çipinin altında "Hazırlanmadı" rozeti olmaz. Aksi hâlde mağazanın gönderim durumu
 * (`fulfillmentStatus`; null = Hazırlanmadı). `shopifyRaw` HİÇ yoksa mağaza durumu bilinmiyor: Cetpa durumu basılır.
 */
export function kargoRozeti(o: MagazaSiparisAlanlari, dil: string): MagazaRozeti {
  const raw = o.shopifyRaw;
  const hamVar = raw !== null && raw !== undefined && raw.fulfillmentStatus !== undefined;
  const magazaEtiketi = hamVar ? kargoDurumuEtiketi(raw.fulfillmentStatus, dil) : null;
  const cetpa = (ton: RozetTonu): MagazaRozeti => {
    const metin = siparisDurumEtiketi(o.status, dil) || '—';
    return { metin, ton, magazadaki: magazaEtiketi !== null && magazaEtiketi !== '—' && magazaEtiketi !== metin ? magazaEtiketi : null };
  };
  if (o.status === 'Cancelled') return cetpa('kirmizi');
  if (o.status === 'Delivered') return cetpa('yesil');
  if (o.status === 'Shipped') return cetpa('mavi');
  if (!hamVar || magazaEtiketi === null) return cetpa('gri');
  const ham = raw.fulfillmentStatus;
  const anahtar = ham === null ? 'unfulfilled' : String(ham).trim();
  return { metin: magazaEtiketi, ton: anahtar ? tonSec(KARGO_TONU, anahtar) : 'gri', magazadaki: null };
}

/** Kalem sayısı; kalem dizisi hiç yazılmamışsa null ('—' basılır — "0 kalem" uydurulmaz). */
export function kalemSayisi(o: MagazaSiparisAlanlari): number | null {
  return Array.isArray(o.lineItems) ? o.lineItems.length : null;
}

// ── BAĞLANTI DURUMU (GET /api/shopify/baglanti) ───────────────────────────────────────────────────────────────

export interface MagazaBaglantiDurumu {
  sonBildirim: string | null;
  sonTopic: string | null;
  sonSiparisNo: string | null;
  sonSonuc: string | null;
  sonHata: string | null;
  sonHataZamani: string | null;
  sonApiSurumu: string | null;
  /** Bilinmiyorsa null — 0 UYDURULMAZ. */
  toplamBildirim: number | null;
  /** İmzası tutmayan son bildirimin zamanı (ISO). Başarılı bildirimde SİLİNMEZ — güncel mi, `guncelImzaReddiMs` söyler. */
  sonImzaReddi: string | null;
}

export interface MagazaBaglantisi {
  configured: boolean;
  shopDomain: string | null;
  webhookSirriKayitli: boolean;
  webhookAdresi: string | null;
  durum: MagazaBaglantiDurumu | null;
}

const metinYaDaNull = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x : null);
const nesneMi = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Bağlantı ucunun yanıtını DOĞRULAYARAK çözer. Beklenen biçim değilse (`success !== true`, `configured` boolean
 * değil, yanıt nesne değil) null döner → şerit GİZLENİR. Yarım yanıttan "bağlı değil" sonucu ÇIKARILMAZ: yanlış bir
 * "bağlantı kurulmamış" uyarısı, hiç uyarı göstermemekten kötüdür.
 */
export function baglantiYanitiniCoz(govde: unknown): MagazaBaglantisi | null {
  if (!nesneMi(govde) || govde.success !== true || typeof govde.configured !== 'boolean') return null;
  const d = govde.durum;
  return {
    configured: govde.configured,
    shopDomain: metinYaDaNull(govde.shopDomain),
    webhookSirriKayitli: govde.webhookSirriKayitli === true,
    webhookAdresi: metinYaDaNull(govde.webhookAdresi),
    durum: nesneMi(d) ? {
      sonBildirim: metinYaDaNull(d.sonBildirim),
      sonTopic: metinYaDaNull(d.sonTopic),
      sonSiparisNo: metinYaDaNull(d.sonSiparisNo),
      sonSonuc: metinYaDaNull(d.sonSonuc),
      sonHata: metinYaDaNull(d.sonHata),
      sonHataZamani: metinYaDaNull(d.sonHataZamani),
      sonApiSurumu: metinYaDaNull(d.sonApiSurumu),
      toplamBildirim: typeof d.toplamBildirim === 'number' && Number.isFinite(d.toplamBildirim) ? d.toplamBildirim : null,
      sonImzaReddi: metinYaDaNull(d.sonImzaReddi),
    } : null,
  };
}

/**
 * GÜNCEL imza reddinin zamanı (epoch ms); güncel ret yoksa null. Ret günceldir: son KABUL edilen bildirimden yeniyse ya da
 * hiç bildirim kabul edilmemişse. Sunucu `sonImzaReddi`'yi başarılı bildirimde silmez — eski bir ret, sonradan düzelen
 * bağlantıda uyarı olarak kalmasın diye kıyaslanır. TEK KAYNAK: Ayarlar kartı (ShopifyBaglantiKarti) ve Online Siparişler
 * şeridi aynı kuralı buradan okur; kıyas iki yerde ayrı yazılırsa iki yüzey aynı durumda farklı konuşur.
 */
export function guncelImzaReddiMs(sonImzaReddiMs: number | null, sonBildirimMs: number | null): number | null {
  if (sonImzaReddiMs === null) return null;
  return sonBildirimMs === null || sonImzaReddiMs > sonBildirimMs ? sonImzaReddiMs : null;
}
