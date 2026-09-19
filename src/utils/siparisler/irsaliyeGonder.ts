/**
 * irsaliyeGonder.ts — `/api/mikro/irsaliye/kaydet` isteğinin GÖVDESİ + yanıt mesajı
 * (Faz 3 4/n, OrdersPage kapanışı, 2026-09-19). SAF: React, DB, ağ yok.
 * Test: irsaliyeGonder.test.ts (ÖNCE yazıldı).
 *
 * NEDEN VAR — istek gövdesi App.tsx'in `handleUpdateOrderStatus` Shipped dalında satır
 * içinde kuruluyordu. Sonuçları:
 *   1. Depo/KDV'si sonradan tamamlanan siparişte e-İrsaliye'yi yeniden göndermenin tek
 *      yolu durumu geri alıp tekrar 'Kargoda' yapmaktı (3/n'den devreden açık madde) —
 *      sipariş detayında düğme yoktu, çünkü gövde orada üretilemiyordu.
 *   2. Gövde ancak SUNUCUDA doğrulanıyordu: eksik depo/KDV/kalem 400 olarak geri
 *      dönüyor, kullanıcı ancak fire-and-forget toast'ı yakalarsa öğreniyordu.
 *   3. Kardeş gövde kuralları (sunucu: src/server/mikro/govdeFaturaIrsaliye.ts +
 *      `IrsaliyeKaydetSchema`) istemcide hiç yazılı değildi; "gönderilebilir mi?"
 *      sorusunun tek cevabı isteği atıp beklemekti.
 *   4. Üstelik o Shipped dalı ÖLÜ KODDU (2026-09-19 delta): `handleUpdateOrderStatus`un
 *      tek çağıranı DeliveryNoteModal ve sabit `'Delivered'` geçiriyor; kullanıcı durumu
 *      'Kargoda' yapınca sayfa-yerel kopya (OrdersPage/CRMPage) çalışıyor. Yani e-İrsaliye
 *      hiçbir zaman kendiliğinden kesilmiyordu. Dal kaldırıldı; bu modülün TEK çağrı
 *      yüzeyi sipariş detayındaki düğmedir (`handleEIrsaliye`). Otomatiğin bağlanması
 *      resmî belge kesen bir yan etki olduğu için kullanıcı kararı (`acikSorular`).
 *
 * SAHTE KESİNLİK: bu gövde DIŞ SİSTEME (Mikro resmî defteri) yazar — varsayılan YOKTUR.
 * `kdvOran ?? 20`, `depoNo ?? 1`, `quantity ?? 1`, `price ?? 0` gibi tek bir uydurma
 * değer bile geçerli GÖRÜNEN sahte bir stok hareketi üretir (2026-09-05: yedi gövde
 * üreticisi her kaydı depo 1 = HAVALİMANI'na yazıyordu, mal depo 2'deydi; hata sessizdi).
 * Bilinmeyen alan → `gonderilebilir: false` + neden; gövde HİÇ kurulmaz.
 *
 * PARİTE: bilinen girdide üretilen gövde App.tsx'inkiyle BİREBİR aynı — alan adları,
 * `name: title || name || sku`, `destination`/`cargoFirm` boş metin varsayılanı,
 * `trackingNo` yedeği (`trackingNumber || id.slice(0, 8)`), `date` = ISO damgası.
 * Testte `toEqual` ile kilitli. Yanıt mesajı da eski toast'la aynı: notConfigured
 * sessiz, yönlendirme yalnız 400'de.
 *
 * BİLİNÇLİ FARKLAR:
 *   1. Eksik alan artık İSTEK ATILMADAN yakalanır (eskiden sunucu 400 dönerdi).
 *      Kullanıcı sinyali KAYBOLMAMALI: çağıran `neden`i `irsaliyeNedenMetni` ile
 *      göstermek ZORUNDA — o metin 400 toast'ındaki yönlendirmenin aynısını söyler.
 *      Kapıya takılan her durum sunucuda zaten 400'dü; çalışan hiçbir gönderim
 *      engellenmiyor.
 *   2. Kapılar zod ŞEMASININ tip sözleşmesine göre (`IrsaliyeKaydetSchema`): sayılar
 *      gerçekten `number` olmalı — sayısal metin ('20', '100') zod'u geçemez. Bu yüzden
 *      `bilinenSayi`ın metin toleransı burada bilerek daraltıldı (`sayiAlani`).
 *   3. `quantity` sonlu sayı ve > 0 olmalı (şema `z.number().positive().finite()`); KESİRLİ miktar
 *      GEÇERLİDİR — 2026-09-19 kullanıcı kararıyla açıldı (2,5 ton demir, 0,75 m³ beton). `depoNo`
 *      tam sayı ve > 0 kalır.
 *   4. `d.error` boş/boşluk metinse eski kod BOŞ bir hata toast'ı basardı (`??` yalnız
 *      null/undefined'ı yakalar); artık varsayılan gerekçeye düşer.
 *   5. **Cari kod yedek zincirinden `taxId` ve `customerName` ÇIKARILDI** (2026-09-19 delta).
 *      Eski zincir `mikroCariKod || cariKod || taxId || customerName` idi ve müşteri ADINI
 *      Mikro'ya cari kodu olarak yazıyordu; sunucu yalnız boş-değil kontrolü yapıyor
 *      (`govdeFaturaIrsaliye.metinGerekli`), yani var olmayan bir cariye bağlı resmî e-İrsaliye
 *      kesiliyor ya da Mikro reddediyor ve kullanıcı "cari eşleştir" yönlendirmesini hiç
 *      görmüyordu — `customerName` dolu olduğu sürece 'cariYok' kapısı ÖLÜYDÜ. VKN de cari kodu
 *      değildir (mirror'da `cari_vdaire_no` ile eşleşir, `cari_kod` ile değil).
 *      DAVRANIŞ DEĞİŞİKLİĞİ: Mikro carisiyle eşleştirilmemiş müşterinin siparişi artık
 *      gönderilmez; düğme devre dışı kalır ve ipucu eşleştirmeyi ister.
 *      Aynı ham zincir `App.tsx handleMikroFatura` (e-Fatura gövdesi) içinde DURUYOR — kapsam
 *      dışı, `acikSorular`da.
 *   6. **`musteriBagliDegil` ile `cariYok` AYRI nedendir** (2026-09-19 kapanış bulgusu).
 *      `leadId: null` ile açılan siparişte (müşteri adı elle yazılmış) `leads.find(...)`
 *      undefined döner; tek neden 'cariYok' olduğu için düğme kalıcı kilitleniyor ve ipucu
 *      kullanıcıyı UYGULANAMAZ bir adıma ("CRM'de cari eşleştir") gönderiyordu — sipariş o
 *      lead'e bağlı olmadığından eşleştirme sonucu değiştirmez. Doğru adım siparişi düzenleyip
 *      müşteriyi seçmek; o seçici artık düzenleme formunda (`formKayit` bilinçli fark 6).
 *      Müşteri ADINDAN otomatik bağ KURULMAZ — resmî belge, mükerrer lead riski.
 *
 * NOT: gövdedeki alanların tek doğrulayıcısı SUNUCUDUR. Bu modül sunucunun kapısının
 * yerine geçmez, onu erkene alır — kural değişirse ikisi birlikte değişir
 * (src/server/schemas.ts `IrsaliyeKaydetSchema` + `irsaliyeGovdesi`).
 */
import { bilinenSayi } from '../para';
import type { ArayuzDili } from '../zaman';

// ── Girdi tipleri ────────────────────────────────────────────────────────────
// Alanlar bilerek gevşek (`unknown`): `Order`/`Lead` tipleri alanları `number`/`string`
// ilan etse de gerçek kayıtlar (eski sipariş, Shopify/Mikro kanalı, yarım form) onları
// taşımayabiliyor. `Order` ve `Lead` bu arayüzlere yapısal olarak uyar.

/** Sevkiyat kalemi — `OrderLineItem`in gevşek karşılığı. */
export interface IrsaliyeKalemi {
  sku?: unknown;
  name?: unknown;
  title?: unknown;
  quantity?: unknown;
  price?: unknown;
}

/** Gönderilecek sipariş — `Order`in gevşek karşılığı. */
export interface IrsaliyeSiparisi {
  id: string;
  customerName?: unknown;
  shippingAddress?: unknown;
  trackingNumber?: unknown;
  cargoCompany?: unknown;
  lineItems?: readonly IrsaliyeKalemi[] | null;
  kdvOran?: unknown;
  depoNo?: unknown;
  /** `false` = faturasız sevkiyat: Mikro'ya YAZILMAZ. Alan yoksa eski davranış (gönderilir). */
  faturali?: unknown;
}

/**
 * Siparişin carisi — `Lead`in gevşek karşılığı. Bulunamadıysa `null`/`undefined`.
 * `taxId` BİLEREK YOK: VKN cari kodu değildir (bkz. başlıktaki bilinçli fark 5).
 */
export interface IrsaliyeCarisi {
  mikroCariKod?: unknown;
  /** @deprecated Yazılmıyor; yedek zincirde eski kayıtlar için duruyor (App.tsx paritesi). */
  cariKod?: unknown;
}

/** Gövdedeki kalem — `IrsaliyeKaydetSchema.shipment.items[]` ile AYNI tipler. */
export interface IrsaliyeGovdeKalemi {
  sku: string;
  name: string;
  quantity: number;
  price: number;
}

/** `POST /api/mikro/irsaliye/kaydet` gövdesi. */
export interface IrsaliyeIstekGovdesi {
  shipment: {
    mikroCariKod: string;
    customerName: string;
    destination: string;
    trackingNo: string;
    cargoFirm: string;
    items: IrsaliyeGovdeKalemi[];
    date: string;
    kdvOran: number;
    /** `true` ya da (eski/kanal siparişinde) yok — `false` buraya kadar gelemez. */
    faturali: boolean | undefined;
    depoNo: number;
  };
  firebaseId: string;
}

/**
 * Gönderilememe nedeni. Sırası kararlıdır (`irsaliyeIstegi` içinde kontrol sırası):
 * kimlik → içerik → lojistik alanları.
 *
 * `musteriBagliDegil` ile `cariYok` AYRI nedenlerdir, çünkü çözümleri farklı ekranlardadır:
 * ilki siparişin hiçbir müşteri kaydına (`leadId`) bağlı olmaması — düzeltmesi sipariş
 * düzenleme formunda müşteriyi seçmektir; ikincisi bağlı müşterinin Mikro cari kodunun
 * olmaması — düzeltmesi CRM'de cari eşleştirmesidir. İkisini tek nedende toplamak
 * `leadId: null` ile açılmış siparişlerde kullanıcıyı UYGULANAMAZ bir adıma yönlendiriyordu
 * (2026-09-19 kapanış bulgusu).
 */
export type IrsaliyeEngeli = 'faturasiz' | 'musteriBagliDegil' | 'cariYok' | 'kalemYok' | 'depoYok' | 'kdvYok';

export interface IrsaliyeIstegiSonucu {
  gonderilebilir: boolean;
  neden?: IrsaliyeEngeli;
  govde?: IrsaliyeIstekGovdesi;
}

export interface IrsaliyeIstegiSecenekleri {
  /** Evrak damgası — test/deterministik çağrı için. Verilmezse `new Date()` (eski davranış). */
  simdi?: Date;
}

// ── Alan kapıları ────────────────────────────────────────────────────────────

/**
 * Gövdeye yazılabilir SAYI alanı: bilinen sonlu sayı VE gerçekten `number`.
 * `bilenSayi` sayısal metni de kabul eder (ekran tarafı için doğru); burada kabul
 * edilemez, çünkü zod `z.number()` metni reddedip isteği 400 yapar.
 */
const sayiAlani = (x: unknown): x is number => typeof x === 'number' && bilinenSayi(x);

/** Gövdeye yazılabilir METİN alanı: boşluk kırpıldığında boş kalmayan `string`. */
const doluMetin = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';

/** Serbest metin (adres, kargo firması, plaka) — para değil, boş kalabilir (eski davranış). */
const serbestMetin = (x: unknown): string => (typeof x === 'string' ? x : '');

/**
 * `||` yedek zinciri — App.tsx'teki `lead?.mikroCariKod || lead?.cariKod || lead?.taxId ||
 * order.customerName` ile AYNI: boş metin atlanır, boşluktan ibaret metin ATLANMAZ
 * (truthy). Zincir sonucu yine de `doluMetin` kapısından geçer, yani '   ' cariYok olur —
 * sunucunun `metinGerekli` (trim) kapısıyla aynı sonuç.
 */
function ilkDoluDeger(...adaylar: readonly unknown[]): string {
  for (const a of adaylar) if (typeof a === 'string' && a !== '') return a;
  return '';
}

/** Kalem Mikro satırına dönüşebilir mi? Tek bir alanı bile eksikse HAYIR (kısmi gönderim yok). */
function govdeKalemi(k: IrsaliyeKalemi): IrsaliyeGovdeKalemi | null {
  // Stok kodu boşsa Mikro defterine SAHİPSİZ bir stok hareketi düşer — sunucu da
  // (`stokKoduGerekli`) reddeder. Şema `sku`yu `z.string()` ister: sayısal kod bile
  // metin olmalı.
  if (!doluMetin(k.sku)) return null;
  const ad = ilkDoluDeger(k.title, k.name, k.sku);
  if (!doluMetin(ad)) return null;                                   // şema: name min(1)
  // KESİRLİ miktar GEÇERLİ (2026-09-19 kullanıcı kararı): inşaat malzemesinde 2,5 ton / 0,75 m³ gerçektir. Eski
  // `Number.isInteger` kapısı bu siparişlerde düğmeyi "kalem eksik" diye kilitliyordu; sunucu şeması da 400 dönüyordu.
  if (!sayiAlani(k.quantity) || k.quantity <= 0) return null;
  // BİLİNEN ₺0 geçerli (numune/bedelsiz sevkiyat) — `!k.price` ile kapatılamaz.
  if (!sayiAlani(k.price)) return null;
  return { sku: k.sku, name: ad, quantity: k.quantity, price: k.price };
}

// ── İstek ────────────────────────────────────────────────────────────────────

/**
 * Siparişten e-İrsaliye isteği kurar. Gövde ancak TÜM zorunlu alanlar bilindiğinde
 * doğar; aksi hâlde `neden` döner ve çağıran bunu kullanıcıya söyler
 * (`irsaliyeNedenMetni`) — sessizce vazgeçmek, e-İrsaliye'nin hiç kesilmediğini
 * kimsenin fark etmemesi demektir (2026-08-22 C15/P2 arızasının sınıfı).
 */
export function irsaliyeIstegi(
  siparis: IrsaliyeSiparisi,
  cari: IrsaliyeCarisi | null | undefined,
  secenek: IrsaliyeIstegiSecenekleri = {},
): IrsaliyeIstegiSonucu {
  // 1. Faturasız sevkiyat Mikro'ya HİÇ yazılmaz (App.tsx `faturali !== false` kapısı +
  //    sunucu savunma katmanı). Alanı olmayan eski/kanal siparişi eskisi gibi gönderilir.
  if (siparis.faturali === false) return { gonderilebilir: false, neden: 'faturasiz' };

  // 2a. Sipariş bir müşteri KAYDINA bağlı mı? `handleAddOrder` cari seçilmeden de sipariş
  //     açabiliyor (`leadId: selectedLead ? selectedLead.id : null`), o siparişte
  //     `leads.find(...)` undefined döner. Bu, CRM'de cari eşleştirerek ÇÖZÜLEMEZ — sipariş
  //     o lead'e bağlı olmadığı için sonuç değişmez; düzeltme sipariş düzenleme formunda
  //     müşteriyi seçmektir. Ayrı neden olmasaydı ipucu uygulanamaz bir adıma yönlendirirdi.
  if (cari === null || cari === undefined) return { gonderilebilir: false, neden: 'musteriBagliDegil' };

  // 2b. Cari kod: kimliksiz evrak yazılmaz (şema min(1), sunucu `metinGerekli` trim'ler).
  //     YALNIZ GERÇEK CARİ KODU. Müşteri adı ve VKN cari kodu DEĞİLDİR — bkz. bilinçli fark 5.
  const mikroCariKod = ilkDoluDeger(cari.mikroCariKod, cari.cariKod);
  if (!doluMetin(mikroCariKod)) return { gonderilebilir: false, neden: 'cariYok' };

  // 3. Kalemler: kalemsiz ya da tek alanı eksik kalemli sevkiyat, 1 adet / ₺0 satırlık
  //    SAHTE belge üretirdi. Kısmi gönderim de yok — bir kalem eksikse istek kurulmaz.
  const hamKalemler = siparis.lineItems ?? [];
  const items: IrsaliyeGovdeKalemi[] = [];
  for (const k of hamKalemler) {
    const kalem = govdeKalemi(k);
    if (!kalem) return { gonderilebilir: false, neden: 'kalemYok' };
    items.push(kalem);
  }
  if (items.length === 0) return { gonderilebilir: false, neden: 'kalemYok' };

  // 4. Sevk deposu: `sth_giris/cikis_depo_no`. Varsayılan 1 (HAVALİMANI) SAHTE kayıt demek.
  const depoNo = siparis.depoNo;
  if (!sayiAlani(depoNo) || !Number.isInteger(depoNo) || depoNo <= 0) {
    return { gonderilebilir: false, neden: 'depoYok' };
  }

  // 5. KDV oranı: vergi işaretçisinin ters aramasını besler. BİLİNEN 0 geçerlidir
  //    (KDV'siz kalem) — `kdvOran || 20` bunu kaçırıp yanlış vergi işaretçisi yazardı.
  const kdvOran = siparis.kdvOran;
  if (!sayiAlani(kdvOran) || kdvOran < 0 || kdvOran > 100) {
    return { gonderilebilir: false, neden: 'kdvYok' };
  }

  return {
    gonderilebilir: true,
    govde: {
      shipment: {
        mikroCariKod,
        customerName: serbestMetin(siparis.customerName),
        destination:  serbestMetin(siparis.shippingAddress),
        trackingNo:   ilkDoluDeger(siparis.trackingNumber) || siparis.id.slice(0, 8),
        cargoFirm:    serbestMetin(siparis.cargoCompany),
        items,
        date:     (secenek.simdi ?? new Date()).toISOString(),
        kdvOran,
        faturali: siparis.faturali === true ? true : undefined,   // JSON.stringify undefined alanı düşürür (parite)
        depoNo,
      },
      firebaseId: siparis.id,
    },
  };
}

// ── Neden metni ──────────────────────────────────────────────────────────────

/**
 * Devre dışı düğmenin ipucu / otomatik akışın uyarısı. Depo ve KDV metinleri, sunucunun
 * 400 yanıtında basılan yönlendirmenin AYNISINI söyler: kapı istemciye alındığı için o
 * yönlendirme başka türlü kaybolurdu.
 * Metinler satır içi tr/en çifti — orkestratör `src/i18n/orders.ts`'e taşıyacak.
 */
export function irsaliyeNedenMetni(neden: IrsaliyeEngeli, dil: ArayuzDili): string {
  const tr = dil === 'tr';
  switch (neden) {
    case 'faturasiz':
      return tr ? 'Faturasız sevkiyat Mikro\'ya e-İrsaliye olarak yazılmaz.'
                : 'A non-invoiced shipment is not written to Mikro as an e-waybill.';
    case 'musteriBagliDegil':
      return tr ? 'Sipariş bir müşteri kaydına bağlı değil — siparişi düzenleyip müşteriyi seçin.'
                : 'This order is not linked to a customer record — edit the order and select the customer.';
    case 'cariYok':
      return tr ? 'Cari kod bilinmiyor — müşteriyi Mikro carisiyle eşleştirin.'
                : 'Customer account code unknown — match the customer to a Mikro account.';
    case 'kalemYok':
      return tr ? 'Sevkiyat kalemleri eksik: her satırda stok kodu, sıfırdan büyük miktar (kesirli olabilir) ve birim fiyat olmalı.'
                : 'Shipment lines incomplete: every line needs a stock code, a quantity greater than zero (fractions allowed) and a unit price.';
    case 'depoYok':
      return tr ? 'Sevk Deposu seçilmemiş — siparişi düzenleyip depoyu tamamlayın.'
                : 'Shipping Warehouse not selected — edit the order and complete it.';
    case 'kdvYok':
      return tr ? 'KDV oranı girilmemiş — siparişi düzenleyip oranı tamamlayın.'
                : 'VAT rate is missing — edit the order and complete it.';
  }
}

// ── Yanıt ────────────────────────────────────────────────────────────────────

/** `/api/mikro/irsaliye/kaydet` yanıtı (alanlar gevşek: ağdan gelen ham JSON). */
export interface IrsaliyeYaniti {
  success?: unknown;
  irsaliyeNo?: unknown;
  /** Mesajda kullanılmaz; çağıran siparişe yazarken okur (bkz. bağlama notu). */
  irsaliyeEttn?: unknown;
  notConfigured?: unknown;
  /** Sunucu kapısı (HTTP 409): bu sevkiyat için belge ZATEN kesilmiş, Mikro'ya gidilmedi. */
  zatenGonderildi?: unknown;
  error?: unknown;
}

export interface IrsaliyeMesaji {
  /** `null` = SESSİZ (Mikro kurulu değil) — toast basılmaz. */
  tur: 'success' | 'error' | 'info' | null;
  metin: string;
}

/**
 * App.tsx'teki toast mantığının tamamı:
 *   • başarı → "İrsaliye oluşturuldu" (+ numara varsa `: <no>`)
 *   • `notConfigured` → SESSİZ (Mikro kurulu değilse normal)
 *   • aksi hâlde → hata. Mikro'nun reddi HTTP 200 + `success:false` döner; `error`
 *     alanı ŞART DEĞİL, yoksa da uyarı çıkar (sessiz geçmek 2026-08-22'de her isteğin
 *     400 olduğunu aylarca gizledi).
 *   • "Siparişi düzenle…" yönlendirmesi YALNIZ 400'de (eksik alan): Mikro reddi / 500 /
 *     MFA 403'te yanıltıcı olurdu.
 */
export function irsaliyeYanitMesaji(kod: number, yanit: IrsaliyeYaniti, dil: ArayuzDili): IrsaliyeMesaji {
  const tr = dil === 'tr';
  if (yanit.success) {
    const no = doluMetin(yanit.irsaliyeNo) ? `: ${yanit.irsaliyeNo}` : '';
    return { tur: 'success', metin: `${tr ? 'İrsaliye oluşturuldu' : 'Waybill created'}${no}` };
  }
  // Sunucu mükerrer kapısı (409): HATA DEĞİL, korumanın çalıştığının bildirimi. 'error'
  // basmak kullanıcıyı "gitmemiş, tekrar dene"ye iter — kapının önlemek istediğinin tersi.
  if (yanit.zatenGonderildi === true) {
    const no = doluMetin(yanit.irsaliyeNo) ? `: ${yanit.irsaliyeNo}` : '';
    return {
      tur: 'info',
      metin: tr
        ? `Bu sevkiyat için e-İrsaliye zaten kesilmiş${no} — ikinci resmî belge oluşmasın diye gönderilmedi.`
        : `An e-waybill was already issued for this shipment${no} — not sent again to avoid a duplicate official document.`,
    };
  }
  if (yanit.notConfigured) return { tur: null, metin: '' };
  const sebep = doluMetin(yanit.error)
    ? yanit.error
    : (tr ? 'Mikro irsaliyeyi reddetti' : 'Mikro rejected the waybill');
  const yonlendirme = kod === 400
    ? (tr ? ' — Siparişi düzenle → Sevk Deposu / KDV oranını tamamla; sonra e-İrsaliye\'yi yeniden gönder.'
          : ' — Edit the order → complete Shipping Warehouse / VAT rate, then send the e-waybill again.')
    : '';
  return { tur: 'error', metin: `${sebep}${yonlendirme}` };
}

// ── Başarı yaması ────────────────────────────────────────────────────────────

/** Başarılı gönderimden sonra `orders/{id}`'ye yazılacak alanlar. */
export interface IrsaliyeSonucYamasi {
  /**
   * "Bu sevkiyat için Mikro'ya e-İrsaliye YAZILDI." Numaradan AYRI bir alan, çünkü
   * Mikro başarı dönüp numara döndürmeyebilir (`irsaliyeNo: null`) — o durumda numara
   * uydurulamaz ama mükerrer gönderim de açık bırakılamaz.
   */
  irsaliyeGonderildi: true;
  /** Mikro'nun döndürdüğü evrak numarası. Dönmediyse alan YOKTUR (bilinmiyor). */
  irsaliyeNo?: string;
  /** e-Belge ETTN'i. Dönmediyse alan YOKTUR. */
  irsaliyeEttn?: string;
}

/**
 * Başarılı `/api/mikro/irsaliye/kaydet` yanıtından sipariş yaması üretir; başarısızsa
 * `null` (hiçbir şey yazılmaz).
 *
 * NEDEN VAR — sunucu numarayı YALNIZ `shipments/{firebaseId}`'ye yazar
 * (mikroRoutes.ts: `collection('shipments').doc(firebaseId).set`), `orders`a DEĞİL ve o kaydı
 * kimse okumuyor. `orders.irsaliyeGonderildi/irsaliyeNo` işaretini istemci koyar; işaret
 * konmazsa detaydaki düğme etkin görünür ve aynı sevkiyat İKİNCİ kez resmî e-İrsaliye olarak
 * kesilir (rotada gönderim ÖNCESİ mükerrer kontrolü yok, gövdedeki `date` her istekte farklı).
 * Yama tek kaynakta — yeni bir çağrı yüzeyi eklendiğinde de aynı işaret yazılır.
 * ("Yarım düzeltme sınıfı": düzeltmeyi tek yüzeye uygulamak.)
 *
 * SINIRI: bu işaret İSTEMCİDEDİR ve ancak yanıt çözüldükten SONRA yazılır. Proxy 502'si,
 * sekme yenileme ya da ikinci bir kullanıcı bu kapıyı aşar; bu yüzden 2026-09-19'da rotaya
 * gönderim ÖNCESİ kapı eklendi (`shipments/{firebaseId}` damgası → 409 `zatenGonderildi`).
 * UÇUŞTAKİ iki eşzamanlı istek hâlâ açık: atomik "gönderiliyor" kaydı gerekir (`acikSorular`).
 *
 * 409 DA İŞARET YAZDIRIR: sunucu "zaten kesilmiş" diyorsa sipariş işaretsiz kalmamalı —
 * aksi hâlde düğme etkin kalır ve kullanıcı her tıklayışta aynı 409'u görür (durum onarılmaz).
 *
 * SAHTE KESİNLİK: numara/ETTN yalnız DOLU METİN olarak yazılır. Sayısal ya da bozuk bir
 * değer metne ÇEVRİLMEZ; `undefined` alan yamaya hiç konmaz, çünkü `updateDoc` PATCH-merge
 * bir yandan onu sessizce yutar, bir yandan da okuyan tarafta "yazıldı" yanılsaması bırakır.
 */
export function irsaliyeSonucYamasi(yanit: IrsaliyeYaniti): IrsaliyeSonucYamasi | null {
  if (!yanit.success && yanit.zatenGonderildi !== true) return null;
  return {
    irsaliyeGonderildi: true,
    ...(doluMetin(yanit.irsaliyeNo)   ? { irsaliyeNo:   yanit.irsaliyeNo.trim()   } : {}),
    ...(doluMetin(yanit.irsaliyeEttn) ? { irsaliyeEttn: yanit.irsaliyeEttn.trim() } : {}),
  };
}
