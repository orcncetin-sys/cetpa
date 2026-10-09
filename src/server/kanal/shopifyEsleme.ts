/**
 * shopifyEsleme.ts — Shopify webhook gövdesi → Cetpa `orders` dokümanı. SAF (ağ / veritabanı / saat yok); 2026-10-02.
 *
 * NEDEN AYRI MODÜL: eski işleyici (server.ts `processShopifyWebhook`) kapanış içindeydi, hiç testi yoktu ve ölçülen kusurları
 * taşıyordu — sipariş araması kiracısız ve `#<sipariş no>` ile (kiracılar arası çakışma), kargo olayı hiçbir siparişle
 * eşleşmiyor, `orders/updated` iptal/kargo durumunu geri eziyor, tutar `|| '0'` (sahte sıfır), müşteri adı
 * "undefined undefined", kayıt yokken gelen güncelleme düşüyor.
 *
 * SÖZLEŞME (şartname `faz3-2n-specs/online-siparis-2026-10-02/SARTNAME.md` + v2 yamaları):
 *  • Kimlik `body.id` (Shopify'ın değişmez sayısal kimliği). Doküman kimliği `shopify__<sha256(tuz|cid|id) ilk 32 hane>`:
 *    yeniden teslim AYNI dokümana yazar, kiracılar arası çakışma olamaz, kimlik TAHMİN EDİLEMEZ (kimliksiz
 *    `/api/track/:orderId` ucu kimliği bilen herkese siparişi gösterir).
 *  • Bütün sipariş olayları (create / updated / paid / cancelled / fulfilled / partially_fulfilled) AYNI eşleyiciden geçer ve
 *    UPSERT'tir — gövde her seferinde tam Order nesnesidir; güncelleme oluşturmadan önce gelirse düşmez.
 *  • SAHTE KESİNLİK YOK: okunamayan tutar / miktar YAZILMAZ ya da açıkça `null` — asla 0.
 *  • Durum GERİ GİTMEZ (Pending < Processing < Shipped < Delivered); `Cancelled` kalıcıdır; `paid` tek yönlüdür.
 *  • DEĞİŞMEYEN `status` / `paid: false` yamaya GİRMEZ: çağıran oku → eşle → yaz zincirinde kilit tutmaz; bayat okumayla
 *    hesaplanan yama aynı değeri yeniden yazsaydı, o arada Cetpa kullanıcısının verdiği durumu / "Ödendi"yi geri ezerdi.
 *  • Tazelenen metin alanı (e-posta, telefon, teslimat adresi / şehri, müşteri notu) Shopify'da BOŞALTILMIŞSA ve kayıtta
 *    doluysa açıkça `null` yazılır (yamaya koymamak silmeyi sessiz no-op yapar). Kargo alanları boşla EZİLMEZ.
 *  • `faturali` / `kdvOran` / `kdvTutari` / `kdvHaricTutar` YAZILMAZ: `faturali:false` Cetpa'da "FATURASIZ SATIŞ" demektir ve
 *    fatura / e-İrsaliye yollarını kapatır. Kalemde `price` YAZILMAZ (MF sürüm-2 modeliyle aynı anlam: tutar `total`da).
 *  • TRY dışı sipariş: `totalPrice` YAZILMAZ; `dovizTutar` + `paraBirimi` (kullanıcı kararı: kur yoksa uydurma yok).
 *  • Test bildirimi (`test: true`) siparişe dönüşmez.
 * Yazım çağıranda `set(…, { merge: true })` ile yapılır: buradaki yamada OLMAYAN alanlara (timeline, notes, stockApplied,
 * irsaliyeNo, mikroFaturaNo, depoNo) dokunulmaz.
 */
import { createHash } from 'crypto';
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi.js';

export const SIPARIS_TOPICLERI: ReadonlySet<string> = new Set([
  'orders/create', 'orders/updated', 'orders/paid', 'orders/cancelled', 'orders/fulfilled', 'orders/partially_fulfilled',
]);
export const KARGO_TOPICLERI: ReadonlySet<string> = new Set(['fulfillments/create', 'fulfillments/update']);
export { MAGAZA_KAYNAGI };

export interface ShopifyBaglam { cid: string; tuz: string }

export type AtlamaNedeni = 'test' | 'kimliksiz' | 'bayat' | 'topic' | 'kayitYok' | 'gonderimBasarisiz' | 'degisiklikYok';
export type EslemeSonucu =
  | { tur: 'atla'; neden: AtlamaNedeni }
  | { tur: 'yaz'; docId: string; yama: Record<string, unknown>; olustur: boolean; siparisNo: string | null };

type Nesne = Record<string, unknown>;
const nesne = (v: unknown): Nesne | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Nesne : undefined);
const metin = (v: unknown): string | undefined => {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
};
/** Shopify tutarları METİN gönderir ("199.90"). Okunamayan → undefined (asla 0). */
const sayi = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const kurus = (n: number): number => Math.round(n * 100) / 100;

/** `body.id` / `body.order_id`: güvenli tamsayı (JSON.parse 2^53 üstünü yuvarlar → yanlış siparişe yazılırdı) ya da rakam dizisi. */
export function shopifyKimligi(v: unknown): string | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? String(v) : null;
  if (typeof v === 'string' && /^[1-9][0-9]{0,24}$/.test(v)) return v;
  return null;
}

export function shopifySiparisKimligi(b: ShopifyBaglam, shopifyId: string): string {
  return `shopify__${createHash('sha256').update(`${b.tuz}|${b.cid}|${shopifyId}`).digest('hex').slice(0, 32)}`;
}

const DURUM_SIRASI: Record<string, number> = { Pending: 0, Processing: 1, Shipped: 2, Delivered: 3 };
const ODENMIS = new Set(['paid', 'partially_refunded']);
const ISLEMDE = new Set(['paid', 'partially_paid', 'authorized', 'partially_refunded']);

function shopifyDurumu(body: Nesne): 'Cancelled' | 'Shipped' | 'Processing' | 'Pending' {
  if (metin(body.cancelled_at)) return 'Cancelled';
  const kargo = metin(body.fulfillment_status), odeme = metin(body.financial_status);
  if (kargo === 'fulfilled') return 'Shipped';
  if (kargo === 'partial') return 'Processing';
  return odeme && ISLEMDE.has(odeme) ? 'Processing' : 'Pending';
}

/** Mevcut kayıtla birleşik durum: iptal kalıcı; değilse ilerideki durum korunur (kullanıcının Cetpa'da verdiği dâhil). */
function birlesikDurum(yeni: string, mevcut: unknown): string {
  if (mevcut === 'Cancelled') return 'Cancelled';
  if (yeni === 'Cancelled' || typeof mevcut !== 'string' || !(mevcut in DURUM_SIRASI)) return yeni;
  return DURUM_SIRASI[mevcut] > DURUM_SIRASI[yeni] ? mevcut : yeni;
}

function musteriAdi(body: Nesne): string {
  const musteri = nesne(body.customer);
  const adSoyad = [metin(musteri?.first_name), metin(musteri?.last_name)].filter(Boolean).join(' ');
  return metin(nesne(body.billing_address)?.name) ?? metin(nesne(body.shipping_address)?.name) ?? (adSoyad || undefined)
    ?? metin(body.email) ?? metin(musteri?.email) ?? 'Adı bilinmiyor (online)';
}

/** Tek satır adres: alıcı, adres 1-2, ilçe / il, posta kodu, ülke. `Order.shippingAddress` metindir. */
function adresMetni(a: Nesne | undefined): string | undefined {
  if (!a) return undefined;
  const sehir = [metin(a.city), metin(a.province)].filter(Boolean).join(' / ');
  const parcalar = [metin(a.name), metin(a.address1), metin(a.address2), sehir || undefined, metin(a.zip), metin(a.country)].filter(Boolean);
  return parcalar.length ? parcalar.join(', ') : undefined;
}

export interface MagazaKalemi {
  id: string; sku: string; name: string; title: string | null; quantity: number | null;
  /** KDV dâhil, satır iskontosu düşülmüş. */ total: number | null;
  kdv: number | null;
  /** KDV hariç. */ netTutar: number | null;
  variantId: string | null;
}

function kalem(li: Nesne, vergiDahil: boolean | undefined): MagazaKalemi {
  const fiyat = sayi(li.price), miktar = sayi(li.quantity);
  // Satır iskontosu = Σ discount_allocations (`total_discount` OKUNMAZ — sipariş iskontosu oraya da dağıtılır, çift düşerdi).
  const paylar = Array.isArray(li.discount_allocations) ? li.discount_allocations.map(p => sayi(nesne(p)?.amount)) : [];
  const iskonto = paylar.some(p => p === undefined) ? undefined : paylar.reduce<number>((t, p) => t + (p as number), 0);
  const vergiSatirlari = Array.isArray(li.tax_lines) ? li.tax_lines.map(v => sayi(nesne(v)?.price)) : undefined;
  const kdv = !vergiSatirlari || vergiSatirlari.some(v => v === undefined) ? undefined : vergiSatirlari.reduce<number>((t, v) => t + (v as number), 0);
  const satir = fiyat !== undefined && miktar !== undefined && iskonto !== undefined ? fiyat * miktar - iskonto : undefined;
  // Vergi dâhil mağaza: satır = brüt (net = satır − KDV). Vergi hariç: satır = net (brüt = net + KDV). Hangisi olduğu bilinmiyorsa
  // satırın brüt mü net mi olduğu da bilinmez → ikisi de null.
  let total: number | null = null, net: number | null = null;
  if (satir !== undefined && vergiDahil === true) { total = kurus(satir); net = kdv !== undefined ? kurus(satir - kdv) : null; }
  if (satir !== undefined && vergiDahil === false) { net = kurus(satir); total = kdv !== undefined ? kurus(satir + kdv) : null; }
  const ad = metin(li.name) ?? metin(li.title) ?? 'Adsız kalem';
  return {
    id: metin(li.id) ?? '', sku: metin(li.sku) ?? '', name: ad, title: metin(li.title) ?? null,
    quantity: miktar ?? null, total, kdv: kdv !== undefined ? kurus(kdv) : null, netTutar: net,
    variantId: metin(li.variant_id) ?? null,
  };
}

/** Siparişin kargo bilgisi: takip numarası taşıyan SON başarılı gönderim. Yoksa alanlar yazılmaz (boşla ezilmez). */
function kargoBilgisi(gonderimler: unknown): { trackingNumber?: string; cargoCompany?: string } {
  if (!Array.isArray(gonderimler)) return {};
  for (let i = gonderimler.length - 1; i >= 0; i--) {
    const g = nesne(gonderimler[i]);
    const no = metin(g?.tracking_number);
    if (!g || !no || (metin(g.status) ?? 'success') !== 'success') continue;
    const firma = metin(g.tracking_company);
    return { trackingNumber: no, ...(firma ? { cargoCompany: firma } : {}) };
  }
  return {};
}

/** Kayıttaki alan dolu mu: undefined / null / '' BOŞ sayılır (zaten boş alana `null` yazmak gereksiz yazımdır). */
const kayittaDolu = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * Her sipariş olayında TAZELENEN, sahibi Shopify olan metin alanı. Gelen değer doluysa yazılır. Shopify'da BOŞALTILMIŞSA ve
 * kayıtta doluysa açıkça `null` yazılır: alanı yamaya hiç koymamak `set(merge)`'de eski değeri korur — mağazada silinen
 * "Kapıya bırakın" notu depoda görünmeye devam ederdi. Oluşturmada (`mevcut` yok) ve kayıt zaten boşken alan YAZILMAZ.
 */
const tazelenen = (alan: string, gelen: string | undefined, mevcut: Nesne | undefined): Nesne =>
  gelen ? { [alan]: gelen } : kayittaDolu(mevcut?.[alan]) ? { [alan]: null } : {};

const zamanMs = (v: unknown): number => (typeof v === 'string' ? Date.parse(v) : NaN);

/**
 * Sipariş olayı → yama. `mevcut`: aynı kimlikli dokümanın şu anki hâli (yoksa undefined → oluşturma).
 * `simdiIso`: `created_at` okunamazsa oluşturma zamanı, ödeme anı okunamazsa `paidAt` (saat çağıranda — modül saf kalsın).
 */
export function siparisOlayiEsle(govde: unknown, mevcut: Nesne | undefined, b: ShopifyBaglam, simdiIso: string): EslemeSonucu {
  const body = nesne(govde);
  if (!body) return { tur: 'atla', neden: 'kimliksiz' };
  if (body.test === true) return { tur: 'atla', neden: 'test' };
  const sid = shopifyKimligi(body.id);
  if (!sid) return { tur: 'atla', neden: 'kimliksiz' };
  // Bayat olay (Shopify sırayı garanti etmez): kayıtlı güncelleme daha yeniyse atla. Biri çözülemezse olay işlenir.
  const eskiMs = zamanMs(mevcut?.shopifyGuncelleme), yeniMs = zamanMs(body.updated_at);
  if (Number.isFinite(eskiMs) && Number.isFinite(yeniMs) && eskiMs > yeniMs) return { tur: 'atla', neden: 'bayat' };

  const siparisNo = metin(body.name) ?? (metin(body.order_number) ? `#${metin(body.order_number)}` : null);
  const musteri = nesne(body.customer), teslimat = nesne(body.shipping_address), fatura = nesne(body.billing_address);
  const vergiDahil = typeof body.taxes_included === 'boolean' ? body.taxes_included : undefined;
  const paraBirimi = metin(body.currency);
  const tutar = sayi(body.total_price);
  const odeme = metin(body.financial_status);
  const kargoUcreti = sayi(nesne(nesne(body.total_shipping_price_set)?.shop_money)?.amount);
  const iskontoToplami = sayi(body.total_discounts);
  const eposta = metin(body.email) ?? metin(body.contact_email) ?? metin(musteri?.email);
  const telefon = metin(body.phone) ?? metin(teslimat?.phone) ?? metin(fatura?.phone) ?? metin(musteri?.phone);
  const adres = adresMetni(teslimat) ?? adresMetni(fatura);
  const sehir = [metin(teslimat?.city), metin(teslimat?.province)].filter(Boolean).join(' / ');
  const not = metin(body.note);
  const odemeYontemi = Array.isArray(body.payment_gateway_names) ? body.payment_gateway_names.map(metin).filter(Boolean).join(', ') : '';
  const olustur = !mevcut;
  const durum = birlesikDurum(shopifyDurumu(body), mevcut?.status);

  const yama: Nesne = {
    shopifyId: sid,
    ...(siparisNo ? { shopifyOrderId: siparisNo } : {}),
    ...(metin(body.updated_at) ? { shopifyGuncelleme: metin(body.updated_at) } : {}),
    customerName: musteriAdi(body),
    ...tazelenen('customerEmail', eposta, mevcut),
    ...tazelenen('customerPhone', telefon, mevcut),
    ...tazelenen('shippingAddress', adres, mevcut),
    ...tazelenen('teslimatSehri', sehir || undefined, mevcut),
    ...tazelenen('musteriNotu', not, mevcut),
    ...(paraBirimi ? { paraBirimi } : {}),
    // TRY (ya da para birimi hiç gelmediyse — mağaza TRY) → totalPrice; başka birim → dovizTutar (ciro kur çevirmez).
    ...(tutar === undefined ? {} : paraBirimi && paraBirimi !== 'TRY' ? { dovizTutar: tutar } : { totalPrice: tutar }),
    ...(kargoUcreti !== undefined ? { kargoUcreti } : {}),
    ...(iskontoToplami !== undefined ? { iskontoToplami } : {}),
    ...(Array.isArray(body.line_items) ? { lineItems: body.line_items.map(li => kalem(nesne(li) ?? {}, vergiDahil)) } : {}),
    // Kargo alanları `tazelenen` DEĞİLDİR: gönderim listesi boş gelirse kayıttaki takip numarası korunur (boşla ezilmez).
    ...kargoBilgisi(body.fulfillments),
    // `status` yalnız OLUŞTURMADA ya da birleşik durum kayıttakinden FARKLIYSA yazılır. Durumu değiştirmeyen sıradan bir olay
    // bayat `mevcut`'taki değeri yeniden yazsaydı, okuma ile yazma arasında kullanıcının verdiği "Teslim edildi" sessizce geri
    // alınırdı (Shopify `Delivered` bilmez → sonraki olay da düzeltmez). Durumu GERÇEKTEN değiştiren olayda pencere açık kalır.
    ...(olustur || durum !== mevcut?.status ? { status: durum } : {}),
    shopifyRaw: {
      financialStatus: odeme ?? null,
      fulfillmentStatus: metin(body.fulfillment_status) ?? null,
      cancelReason: metin(body.cancel_reason) ?? null,
      cancelledAt: metin(body.cancelled_at) ?? null,
      odemeYontemi: odemeYontemi || null,
      vergi: sayi(body.total_tax) ?? null,
      vergiDahil: vergiDahil ?? null,
    },
  };
  // `paid` TEK YÖNLÜ: true olan kayda false yazılmaz (kullanıcı havale siparişini "Ödendi" işaretleyebilir). Alan yoksa yazılmaz.
  if (odeme && ODENMIS.has(odeme)) {
    yama.paid = true;
    // `paidAt` ödeme ANIDIR ve bir kez yazılır (zaten ödenmiş kayıtta — elle "Ödendi" dâhil — dokunulmaz). Kayıt ilk kez ve zaten
    // ödenmiş oluşuyorsa (kartla ödeme) `processed_at`; MEVCUT kayıt ödenmemişten ödenmişe geçiyorsa `updated_at`: ödeme o
    // güncellemeyle geldi, `processed_at` ise siparişin işlendiği andır (Shopify Order belgesine göre ödeme alınınca değişmez;
    // canlı gövdeyle ÖLÇÜLMEDİ) — havale siparişinde ödeme tarihi günlerce geriye yazılırdı. Hiçbiri yoksa çağıranın saati.
    if (mevcut?.paid !== true) {
      const islenme = metin(body.processed_at), guncelleme = metin(body.updated_at);
      yama.paidAt = (olustur ? islenme ?? guncelleme : guncelleme ?? islenme) ?? simdiIso;
    }
  } else if (odeme && typeof mevcut?.paid !== 'boolean') {
    // `paid: false` yalnız oluşturmada ya da kayıtta `paid` bir boolean DEĞİLKEN yazılır. Kayıt zaten `false` iken yeniden yazmak
    // değeri değiştirmez; ama bayat okumayla hesaplanan yama, o arada kullanıcının yazdığı `paid: true`'yu geri ezerdi.
    yama.paid = false;
  }
  if (olustur) {
    const olusma = metin(body.created_at);
    Object.assign(yama, {
      companyId: b.cid, source: MAGAZA_KAYNAGI, customerType: 'Retail',
      createdAt: olusma && Number.isFinite(Date.parse(olusma)) ? olusma : simdiIso,
      // Mağazanın yerel günü (Shopify `created_at`'i mağaza saat dilimiyle verir): UTC'ye çevirmek gece siparişini dünküne atardı.
      orderDate: (olusma && /^\d{4}-\d{2}-\d{2}/.test(olusma) ? olusma : simdiIso).slice(0, 10),
    });
  }
  return { tur: 'yaz', docId: shopifySiparisKimligi(b, sid), yama, olustur, siparisNo };
}

/**
 * Kargo olayı (`fulfillments/create|update`) → YALNIZ takip numarası / kargo firması. DURUM DEĞİŞTİRMEZ (kısmi gönderim
 * `Shipped` olmasın — durum sipariş olayından gelir). Sipariş kaydı yoksa atlanır (sipariş olayı gelince kurulur).
 * `siparisKimligi`: çağıranın `body.order_id`'den doküman kimliğini bulması için.
 */
export function kargoOlayiKimligi(govde: unknown, b: ShopifyBaglam): string | null {
  const sid = shopifyKimligi(nesne(govde)?.order_id);
  return sid ? shopifySiparisKimligi(b, sid) : null;
}
export function kargoOlayiEsle(govde: unknown, mevcut: Nesne | undefined, b: ShopifyBaglam): EslemeSonucu {
  const body = nesne(govde);
  const docId = kargoOlayiKimligi(govde, b);
  if (!body || !docId) return { tur: 'atla', neden: 'kimliksiz' };
  if (!mevcut) return { tur: 'atla', neden: 'kayitYok' };
  if (metin(body.status) !== 'success') return { tur: 'atla', neden: 'gonderimBasarisiz' };
  const no = metin(body.tracking_number), firma = metin(body.tracking_company);
  if (!no && !firma) return { tur: 'atla', neden: 'degisiklikYok' };
  return {
    tur: 'yaz', docId, olustur: false, siparisNo: typeof mevcut.shopifyOrderId === 'string' ? mevcut.shopifyOrderId : null,
    yama: { ...(no ? { trackingNumber: no } : {}), ...(firma ? { cargoCompany: firma } : {}) },
  };
}

/** Olay yönlendirmesi: sipariş mi, kargo mu, bilinmeyen mi. Çağıran `mevcut`'u bu kimlikle okur. */
export function olayKimligi(topic: string, govde: unknown, b: ShopifyBaglam): { tur: 'siparis' | 'kargo'; docId: string } | { tur: 'atla'; neden: AtlamaNedeni } {
  if (SIPARIS_TOPICLERI.has(topic)) {
    const body = nesne(govde);
    if (body?.test === true) return { tur: 'atla', neden: 'test' };
    const sid = shopifyKimligi(body?.id);
    return sid ? { tur: 'siparis', docId: shopifySiparisKimligi(b, sid) } : { tur: 'atla', neden: 'kimliksiz' };
  }
  if (KARGO_TOPICLERI.has(topic)) {
    const docId = kargoOlayiKimligi(govde, b);
    return docId ? { tur: 'kargo', docId } : { tur: 'atla', neden: 'kimliksiz' };
  }
  return { tur: 'atla', neden: 'topic' };
}
