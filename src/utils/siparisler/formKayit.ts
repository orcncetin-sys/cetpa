/**
 * formKayit.ts — OrdersPage'in FORM KAYIT yüzeyi (Faz 3 4/n, "formKayit" grubu, 2026-09-19).
 * Test: formKayit.test.ts (önce yazıldı, kırmızı görüldü).
 *
 * NEDEN VAR — sayfadaki sahte-kesinlik siteleri (satır numaraları bağlama öncesi hâl):
 *   • OrdersPage:1195  `KDV%{order.kdvOran ?? 0}` — Mikro'dan/kanaldan gelen `faturali: true`
 *     siparişlerde `kdvOran` YOK; rozet "e-FATURA • KDV%0" uyduruyordu. %0 gerçek bir oran
 *     (ihracat faturası) olduğu için okuyan kişi bunu ayırt edemiyordu → `kdvEtiketi`.
 *   • OrdersPage:3506  `value={(editingOrderData.totalPrice as number) ?? 0}` +
 *     `onChange={… totalPrice: Number(e.target.value)}` + kayıtta `{ ...editingOrderData }`:
 *     tutarı bilinmeyen sipariş düzenleme kutusunda "0" gösteriyor, yalnız adresi düzeltilip
 *     kaydedilince `totalPrice: 0` yazılıyordu (MusterilerTab:177 / çalışan maaşı ile aynı
 *     yarım-düzeltme sınıfı). Kutu boşaltılınca da `Number('') === 0` → ₺0 sipariş.
 *   • OrdersPage:2516  `quantity: Number(p554Draft.quantity) || 0` — depo lokasyonu (bin)
 *     miktarı boşken 0 adetle kaydediliyor, `warehouseBins` sayım/min-stok uyarılarını besliyor.
 *   • OrdersPage:2882  `value: Number(p622Draft.value) || 0` — ihracat sevkiyatı $0 değerle
 *     kaydediliyor ve "Toplam Değer" kartına $0 olarak giriyordu (gümrük beyanının girdisi).
 *   • OrdersPage:773   `totalPrice: Number(e.target.value)` — `recurringOrders` şablonu ₺0.
 *   • OrdersPage:2766  `km: Number(p593Draft.km) || 0` — km'si bilinmeyen araç 0 km kaydediliyor
 *     ve bakım planlaması (`maintenanceDue`) o sahte sıfıra bakıyor.
 *
 * KAPSAM DIŞI — iade (`salesReturns`) tutar kuralları BU DOSYADA DEĞİL: OrdersPage 1442/2046/3345
 * `siparisler/iadeTalep.ts`'in ("iadeTalep" grubu) tek kaynağıdır; oradaki `iadeTutariDogrula`
 * üst sınırı `siparisTutari` ile okur. Aynı kuralın ikinci kopyasını buraya YAZMA.
 *
 * KURAL (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen sayı 0 DEĞİL bilinmiyordur.
 * Form alanında boş = bilinmiyor (`Number('') === 0` tuzağı); GİRİLEN alanın kaydı
 * `girilenAlanYamasi` sözleşmesine uyar (bilinen → yaz · boş+önceki bilinmiyor → yazma ·
 * boş+önceki biliniyor → açıkça `null`); okunamayan girdi kayıt ettirmez.
 *
 * "≤ 0 REDDEDİLİR" HER ALAN İÇİN GEÇERLİ DEĞİL — alanın ne ölçtüğüne bakılır (2026-09-19 delta):
 *   • İŞLEM/PARA miktarı (şablon tutarı, sevkiyat değeri): girilen ≤ 0 reddedilir.
 *   • STOK SEVİYESİ (raf adedi): bilinen 0 GERÇEK bir durumdur (boş raf) ve kabul edilir;
 *     yalnız negatif reddedilir. `pozitifSayi` kapısı buraya konunca boş raf tanımlanamaz
 *     hâle gelmişti — tablo 0'ı gösterebiliyor, form üretemiyordu.
 *   • DÜZENLEME yolu kapıyı yeniden koşturmaz: eski sahte 0 kaydı (`Number(v) || 0` mirası)
 *     aksi hâlde KİLİTLENİR ve kullanıcı ilerlemek için değer uydurur (`sevkiyatDegeriKaydi`).
 *
 * SAYFA PARİTESİ: bilinen ve geçerli girdide üretilen sayı eskisiyle BİREBİR aynı — kapılar
 * yalnız eskiden 0'a çevrilen BİLİNMEYEN girdiyi reddeder, geçerli girdiyi değiştirmez.
 *
 * BİLİNÇLİ FARKLAR (eski davranıştan ayrıldığımız yerler):
 *   1. Rozet metni "KDV%20" değil "KDV %20" (Türkçe yüzde yazımı); ondalıklı oran Türkçe
 *      ayraçla ("KDV %18,5"). Sayı değeri değişmez.
 *   2. Sipariş düzenleme yaması yalnız formdaki alanları yazar (customerName, shippingAddress,
 *      status, totalPrice + 2026-09-19'da eklenen depoNo/kdvOran + 2026-10-10'da eklenen
 *      teslimatUlke/teslimatSehri). Eski kod
 *      `{ ...editingOrderData }` ile TÜM sipariş nesnesini geri yazıyordu (id/createdAt/
 *      lineItems dâhil) — PATCH-merge'de gereksiz ve eşzamanlı değişiklikleri ezme riski.
 *   3. Kapılar "alan boş" ile "girilen değer geçersiz"i AYRI hata anahtarıyla bildirir; eskiden
 *      ikisi de sessizce 0 kaydediliyordu (hiç uyarı yoktu).
 *   4. `sayiGirdisi` bilinmeyen tutarda kutuyu BOŞ bırakır (eskiden "0" yazıyordu).
 *   5. Düzenleme formunda Sevk Deposu ve KDV Oranı alanları VAR: e-İrsaliye düğmesinin ipucu
 *      kullanıcıyı "siparişi düzenleyip depoyu/oranı tamamlayın" diye yönlendiriyor ama o
 *      alanlar yalnız hiçbir yerden açılamayan bir formdaydı (components/EditOrderModal,
 *      `isEditingOrder` state'ini true yapan satır yoktu) — yönlendirme karşılıksızdı.
 *   6. Düzenleme formunda MÜŞTERİ (cari) seçicisi VAR (2026-09-19 kapanış): `handleAddOrder`
 *      cari seçilmeden sipariş açabiliyor (`leadId: null`) ve o siparişe sonradan lead bağlayan
 *      HİÇBİR ekran yoktu — e-İrsaliye düğmesi kalıcı kilitliydi ('musteriBagliDegil'), ipucu
 *      ise CRM eşleştirmesine (uygulanamaz bir adıma) yönlendiriyordu. Bağ yalnız LİSTEDEN
 *      seçilerek kurulur: ad üzerinden otomatik eşleştirme mükerrer lead riski taşır ve
 *      resmî belge kesilen bir siparişte kabul edilemez. Belge kesildikten sonra alan kilitli.
 *   7. `kdvHaricTutar`/`kdvTutari` TÜRETİLEN alandır ve girdisi değişince tazelenir
 *      (`kdvTurevleri`) — eskiden yama yalnız `kdvOran`ı yazıyor, oluşturmada hesaplanan
 *      türev KDV panosunda bayat yaşıyordu.
 *
 * Saf modül: React/DB/i18n yok. Kullanıcı metni üretmez, HATA ANAHTARI döner; metin çağıran
 * ekranda `currentLanguage === 'tr' ? … : …` olarak yazılır.
 */
import { bilinenSayi } from '../para';
import { formSayisi, girilenAlanYamasi, pozitifSayi } from '../muhasebe/irsaliyeCalisan';
import type { BelgeTipi } from './belgeTipi';
import type { OrderLineItem } from '../../types';
import { oranDegisimi, kayitliTutarlar, fiyatBirimiMi } from './siparisKalemFiyati';
import { etkinUlke } from './teslimatAdresi';

/* ── KDV rozeti ───────────────────────────────────────────────────────────── */

/**
 * Sipariş satırındaki fatura rozetinin KDV kısmı. Bilinen oran → 'KDV %20'; oran yok /
 * okunamıyor / negatif → 'KDV —'. Bilinen `0` GERÇEK bir orandır (KDV'siz ihracat) ve
 * 'KDV %0' basılır — bilinmeyenle karıştırılmaz. Dilden bağımsız: 'KDV' kısaltması sayfada
 * her iki dilde de bu biçimde kullanılıyor (parite).
 */
export function kdvEtiketi(kdvOran: unknown): string {
  if (!bilinenSayi(kdvOran)) return 'KDV —';
  const oran = Number(kdvOran);
  if (oran < 0) return 'KDV —';
  return `KDV %${oran.toLocaleString('tr-TR')}`;
}

/* ── Sayı girdisi gösterimi ───────────────────────────────────────────────── */

/**
 * `<input type="number">` değeri: bilinen sayı → rakamlar, bilinmeyen → '' (boş kutu,
 * placeholder görünür). Ondalık ayracı NOKTA kalır — `toLocaleString` virgülü input
 * type=number'da geçersizdir ve tarayıcı alanı sessizce boşaltır.
 */
export function sayiGirdisi(x: unknown): string {
  return bilinenSayi(x) ? String(Number(x)) : '';
}

/* ── Kayıt kapıları ───────────────────────────────────────────────────────── */

/** Kapı sonucu — geçerse kaydedilecek sayı, geçmezse çağıranın metne çevireceği hata anahtarı. */
export type SayiKapisi<H extends string> =
  | { gecerli: true; deger: number }
  | { gecerli: false; hata: H };

export type MiktarHatasi = 'miktar_bos' | 'miktar_negatif';
export type DegerHatasi = 'deger_bos' | 'deger_pozitif_degil';

/**
 * Depo lokasyonu (bin) adedi — STOK SEVİYESİ kapısı, işlem miktarı kapısı DEĞİL.
 * Boş/okunamayan → 'miktar_bos' (`Number('') === 0` tuzağı: boş alan 0 adet DEĞİLDİR);
 * girilen ama negatif → 'miktar_negatif'.
 *
 * GİRİLEN 0 GEÇERLİDİR: raf adresi stoğun seviyesini taşır, bir hareketin miktarını değil —
 * "şu anda boş" gerçek bir durumdur ve depo sorumlusu raf adreslerini mal gelmeden önce
 * tanımlar. `pozitifSayi` (işlem miktarı kuralı) burada YANLIŞ kapıydı: 0'ı reddedince boş raf
 * HİÇ oluşturulamıyor, ama tablo 0'ı gösterebiliyordu — form ile tablo çelişiyordu
 * (2026-09-19 delta bulgusu; `Number(q) || 0` eski kodu açık 0'ı kaydediyordu).
 *
 * Aynı kapı hem "Lokasyon Ekle" formunda hem satırdaki "Düzelt" (sayım) yolunda kullanılır:
 * iki yüzey aynı alana yazıyor, sözleşmeleri ayrışamaz (yarım düzeltme sınıfı).
 */
export function miktarDogrula(ham: unknown): SayiKapisi<MiktarHatasi> {
  if (!bilinenSayi(ham)) return { gecerli: false, hata: 'miktar_bos' };
  const n = Number(ham);
  if (n < 0) return { gecerli: false, hata: 'miktar_negatif' };
  return { gecerli: true, deger: n };
}

/**
 * GİRİLEN para değeri kapısı (yinelenen sipariş şablonu tutarı). Boş → 'deger_bos';
 * girilen ama ≤ 0 → 'deger_pozitif_degil'. İhracat sevkiyatı değeri için doğrudan bunu
 * ÇAĞIRMA — `sevkiyatDegeriKaydi` kullan (düzenleme yolunun ayrı kuralı var).
 * İADE tutarı için DEĞİL — o `iadeTalep.ts`'te (üst sınır kuralı var).
 */
export function degerDogrula(ham: unknown): SayiKapisi<DegerHatasi> {
  if (!bilinenSayi(ham)) return { gecerli: false, hata: 'deger_bos' };
  if (!pozitifSayi(ham)) return { gecerli: false, hata: 'deger_pozitif_degil' };
  return { gecerli: true, deger: Number(ham) };
}

/**
 * İhracat sevkiyatı listesi ile düzenleme ön-dolumunun ORTAK "gösterilebilir değer" tanımı
 * (`irsaliyeCalisan.gorunenTutar` ile aynı sınıf): bilinen ve > 0 → sayı; 0 ve bilinmeyen → null.
 * Eski `Number(v) || 0` kaydı sahte $0 üretmişti; o sıfır bir değer değil "bilinmiyor"dur —
 * hücre '—' basar, düzenleme kutusu BOŞ açılır (aksi hâlde kullanıcı 0'ı gerçek sanır).
 */
export function gorunenDeger(x: unknown): number | null {
  return bilinenSayi(x) && Number(x) > 0 ? Number(x) : null;
}

/** `updateDoc(doc(db,'exportShipments',id), …)` gövdesinin değer kısmı. `value: null` = bilinmiyor. */
export interface SevkiyatDegerYamasi { value?: number | null }

/**
 * İhracat sevkiyatı "Değer" alanının kayıt sonucu. Kapı YENİ KAYIT ile DÜZENLEMEyi ayırır:
 *   • girilen bilinen değer > 0 → yazılır (her iki yolda)
 *   • girilen ama ≤ 0 → reddedilir (kullanıcı gerçekten geçersiz bir sayı yazdı)
 *   • boş + YENİ kayıt → reddedilir: sahte $0 sevkiyat gümrük beyanının girdisidir
 *   • boş + DÜZENLEME → kayıt DURMAZ; `girilenAlanYamasi` sözleşmesi: önceki değer biliniyorsa
 *     açıkça `null`, bilinmiyorsa alan hiç yazılmaz.
 *
 * Son madde bir regresyonun kapanışıdır (2026-09-19 delta): kapı düzenleme yolunda da koşunca
 * eski `value: 0` kayıtları KİLİTLENİYORDU — satırda durum seçici olmadığı için sevkiyatı
 * 'Gümrükte'ye çekmenin tek yolu bu form ve form "0'dan büyük olmalı" deyip updateDoc'u hiç
 * çalıştırmıyordu; kullanıcı ilerlemek için bilmediği bir değeri UYDURMAK zorunda kalıyordu.
 */
export function sevkiyatDegeriKaydi(
  ham: unknown,
  onceki: unknown,
  duzenleme: boolean,
): { gecerli: true; yama: SevkiyatDegerYamasi } | { gecerli: false; hata: DegerHatasi } {
  const girilen = formSayisi(ham);
  if (girilen === null) {
    if (!duzenleme) return { gecerli: false, hata: 'deger_bos' };
    return { gecerli: true, yama: girilenAlanYamasi('value', null, onceki) };
  }
  if (girilen <= 0) return { gecerli: false, hata: 'deger_pozitif_degil' };
  return { gecerli: true, yama: { value: girilen } };
}

export type KdvHatasi = 'kdv_araligi';

/**
 * Sipariş düzenlemede KDV oranı. BOŞ ALAN HATA DEĞİLDİR — "oran bilinmiyor" demektir ve
 * `?? 20` ile uydurulamaz (uydurma oran Mikro'ya yanlış vergi işaretçisiyle yazılır).
 * Yalnız GİRİLEN ama 0-100 dışında kalan oran reddedilir; sunucunun gövde kuralı budur
 * (`irsaliyeGonder.irsaliyeIstegi` ve `IrsaliyeKaydetSchema`). Bilinen 0 geçerlidir (KDV'siz ihracat).
 */
export function kdvOraniDogrula(ham: unknown): { gecerli: true; deger: number | null } | { gecerli: false; hata: KdvHatasi } {
  const oran = formSayisi(ham);
  if (oran === null) return { gecerli: true, deger: null };
  if (oran < 0 || oran > 100) return { gecerli: false, hata: 'kdv_araligi' };
  return { gecerli: true, deger: oran };
}

/* ── Sipariş düzenleme yaması ─────────────────────────────────────────────── */

/**
 * Sipariş düzenleme modalının girdileri. `tutarHam` / `kdvHam` = kutuya yazılan HAM metin
 * ('' = bilinmiyor). `depoNo` = `SevkDeposuSecici`nin verdiği Mikro depo numarası.
 */
export interface SiparisDuzenlemeGirdileri<D extends string = string> {
  customerName?: string;
  shippingAddress?: string;
  /**
   * Ülke seçicisinin değeri (ISO2). `undefined` → alan yamaya GİRMEZ (mağaza kilidi; alan formda yok). Verildiyse
   * ETKİN ülke önceki kaydın etkin ülkesiyle karşılaştırılır (`etkinUlke`: kayıtta yoksa 'TR') — eşitse YAZILMAZ:
   * `teslimatUlke`'si olmayan eski kayıt yalnız notu / tutarı düzeltilip kaydedilince sessizce 'TR' kazanmaz.
   * İSTİSNA (inceleme 2026-10-10, gizlilik): ADRESE DOKUNULDUYSA (`adreseDokunuldu`: adres metni değişti ya da il
   * yaması var) kayıttaki HAM değerle karşılaştırılır — alanı olmayan eski kayda 'TR' AÇIKÇA yazılır. Çağıran, adresi
   * (`shippingAddress`) verdiği her kayıtta ülkeyi de vermelidir; ikisi birlikte kilitlenir (mağaza kilidi).
   */
  teslimatUlke?: string;
  /**
   * İl / şehir kutusunun değeri ('' = seçilmedi / boşaltıldı). `undefined` → alan yamaya GİRMEZ. GİRİLEN metin alanıdır
   * (`girilenMetinYamasi`): boşaltıldıysa ve önceki doluysa açıkça `null` yazılır.
   */
  teslimatSehri?: string;
  status?: D;
  tutarHam: unknown;
  /** "KDV Oranı (%)" kutusunun ham metni. Alan formda yoksa verilmez (yazılmaz). */
  kdvHam?: unknown;
  /** Seçilmemişse `undefined` — alan yamaya GİRMEZ (bkz. aşağıdaki not). */
  depoNo?: number;
  /**
   * `CustomerCombobox`ten seçilen cari (lead) kimliği. Seçilmediyse `undefined` — alan
   * yazılmaz, mevcut bağ korunur. `leadId`si olmayan sipariş Mikro carisine HİÇ bağlanamıyor,
   * yani e-İrsaliye düğmesi kalıcı kilitli kalıyordu (`musteriBagliDegil`).
   */
  leadId?: string;
  /**
   * Belge tipi seçimi ('e-fatura' | 'e-arsiv' | 'ihracat'). Seçilmediyse `undefined` — alan yazılmaz, mevcut tip
   * korunur; tanınmayan metin yamaya GİRMEZ. Kural ve kaynak: utils/siparisler/belgeTipi.ts.
   */
  faturaTipi?: BelgeTipi;
}

/** `updateDoc(doc(db,'orders',id), …)` gövdesi. `totalPrice: null` = kullanıcı tutarı bilerek sildi. */
export interface SiparisYamasi<D extends string = string> {
  customerName?: string;
  shippingAddress?: string;
  /** Etkin ülke DEĞİŞTİYSE ya da adrese dokunulan kayıtta alan YOKSA yazılır ('TR' dâhil — `adreseDokunuldu`). `null`
   *  üretilmez (etkin ülke hiç boş olmaz); tip `girilenMetinYamasi` çıktısıdır. */
  teslimatUlke?: string | null;
  /** `null` = il BOŞALTILDI (önceki doluydu). Ekrandaki sipariş nesnesine `yerelMetin` ile uygulanır (`Order` tipi `string`). */
  teslimatSehri?: string | null;
  status?: D;
  totalPrice?: number | null;
  kdvOran?: number | null;
  /** TÜRETİLEN: `totalPrice`/`kdvOran` değişince yeniden hesaplanır; türetilemezse `null`. */
  kdvHaricTutar?: number | null;
  /** TÜRETİLEN — bkz. `kdvHaricTutar`. */
  kdvTutari?: number | null;
  /** Yalnız pencereden açılmış kalemli siparişte, kalemler başlık KDV oranına göre bayatsa (oran değişti): kalemler kendi
   *  çapalarıyla yeniden yazılır (oran, satır tutarları; KDV dâhil girilende net birim) — bkz.
   *  `siparisKalemFiyati.oranDegisimi`. Başka hiçbir durumda kalemlere DOKUNULMAZ. */
  lineItems?: OrderLineItem[];
  depoNo?: number;
  leadId?: string;
  faturaTipi?: BelgeTipi;
}

/** Düzenlenen siparişin ÖNCEKİ hâli — türevleri tazelemek için girdiler ve fatura durumu okunur. */
export interface SiparisOncekiHali {
  totalPrice?: unknown;
  kdvOran?: unknown;
  kdvHaricTutar?: unknown;
  kdvTutari?: unknown;
  /** `true` faturalı, `false` faturasız, yoksa BİLİNMİYOR (eski/kanal siparişi). */
  faturali?: unknown;
  /** Sipariş penceresinin İŞARETİ (`Order.fiyatGirisi`): varsa kalem `price`'ı KDV HARİÇ net birimdir ve tutarlar
   *  kalemlerden türer. Yoksa (eski / kanal / başka yüzeyden gelen sipariş) kalemlerin anlamı GARANTİ DEĞİLDİR. */
  fiyatGirisi?: unknown;
  lineItems?: unknown;
  /** Düzenlemeden ÖNCEKİ adres metni («kalan») — yalnız «adres değişti mi» sorusu için okunur (`adreseDokunuldu`). */
  shippingAddress?: unknown;
  /** Kayıtta yok / `null` olabilir — karşılaştırma `etkinUlke` ile ('TR' sayılır); adrese dokunulduysa HAM değerle. */
  teslimatUlke?: unknown;
  /** Kayıtta `null` bulunabilir (mağaza eşleyicisi, önceki boşaltma) — `null` ve yalnız boşluk BOŞ sayılır. */
  teslimatSehri?: unknown;
}

/**
 * KDV türevleri — BAŞLIK tutarından (KDV dâhil toplam) ayrıştırma:
 *   `kdvHaricTutar = faturali ? tutar / (1 + oran/100) : tutar`
 *   `kdvTutari     = faturali ? tutar - kdvHaricTutar  : 0`
 * Kalemlerinin anlamı garanti OLMAYAN siparişin (eski / kanal / kalemsiz) ve tutarı ELLE değiştirilen siparişin yoludur.
 * Sipariş penceresinden açılmış kalemli siparişte türevler bundan DEĞİL kalemlerden gelir (`siparisKalemFiyati.oranDegisimi`
 * — 2026-10-03: oluşturma artık bu formülü kullanmıyor; kalem fiyatı KDV hariç net birim, tutarlar `siparisTutarlari`).
 * (Eski oluşturmadaki `kdvOran ?? 20` uydurması BURAYA TAŞINMADI: bilinmeyen oran %20 değildir.)
 *
 * Bunlar GİRİLEN değil TÜRETİLEN alandır: bir girdi bile bilinmiyorsa türev HESAPLANMAZ
 * (`null`). Fatura durumu bilinmiyorsa hangi formülün geçerli olduğu da bilinmez — `undefined`ı
 * "faturasız" saymak `kdvTutari`ye sahte 0 yazardı (kanal siparişi).
 */
export function kdvTurevleri(
  tutar: number | null,
  oran: number | null,
  faturali: unknown,
): { kdvHaricTutar: number | null; kdvTutari: number | null } {
  const bilinmiyor = { kdvHaricTutar: null, kdvTutari: null };
  if (tutar === null) return bilinmiyor;
  if (faturali === false) return { kdvHaricTutar: tutar, kdvTutari: 0 };
  if (faturali !== true || oran === null) return bilinmiyor;
  const net = tutar / (1 + oran / 100);
  if (!Number.isFinite(net)) return bilinmiyor;   // oran = −100 → bölme sonsuza gider
  return { kdvHaricTutar: net, kdvTutari: tutar - net };
}

/** Sipariş üzerindeki sayısal alanın bilinen değeri; okunamıyorsa `null`. */
const oncekiSayi = (x: unknown): number | null => (bilinenSayi(x) ? Number(x) : null);

/** Yamadan sonra alanın EFEKTİF değeri: yamada varsa o, yoksa önceki kayıttaki. */
function etkinSayi(yama: SiparisYamasi, alan: 'totalPrice' | 'kdvOran', onceki: unknown): number | null {
  if (alan in yama) {
    const v = yama[alan];
    return typeof v === 'number' && bilinenSayi(v) ? v : null;
  }
  return oncekiSayi(onceki);
}

/** İki "bilinen sayı ya da bilinmiyor" değeri aynı mı? İkisi de bilinmiyorsa EŞİT sayılır. */
const ayniSayi = (a: number | null, b: number | null): boolean => (a === null ? b === null : a === b);

/**
 * Kullanıcının GİRDİĞİ METİN alanının (il / şehir, ülke) kayıt yaması — `girilenAlanYamasi`'nın metin eşi (o işlev
 * sayısaldır: «bilinen sayı» kapısı metne uygulanamaz). Karşılaştırma KIRPILMIŞ değerlerle yapılır; kayıttaki `null`,
 * metin olmayan değer ve yalnız boşluktan oluşan metin BOŞ sayılır.
 *   • `yeni` `undefined` (alan formda yok / kilitli) → `{}`
 *   • dolu + öncekinden FARKLI → `{ alan: kırpılmış değer }`
 *   • dolu + öncekiyle AYNI → `{}` (aynı değeri geri yazmak PATCH-merge'de eşzamanlı değişikliği ezme riskidir)
 *   • boş + önceki DOLU → `{ alan: null }` — kullanıcı bilerek boşalttı. `updateDoc` PATCH-merge olduğundan alanı yamaya
 *     KOYMAMAK silmeyi sessiz no-op yapardı («güncellendi» bildirimi çıkar, il kayıtta kalır).
 *   • boş + önceki de boş / `null` / yok → `{}` (sahte `null` / '' yazılmaz)
 */
export function girilenMetinYamasi<K extends string>(alan: K, yeni: string | undefined, onceki: unknown): Partial<Record<K, string | null>> {
  const yama: Partial<Record<K, string | null>> = {};
  if (yeni === undefined) return yama;
  const girilen = yeni.trim();
  const eski = typeof onceki === 'string' ? onceki.trim() : '';
  if (girilen === eski) return yama;
  yama[alan] = girilen === '' ? null : girilen;
  return yama;
}

/**
 * Bu kayıtta ADRESE DOKUNULDU mu: adres metni («kalan») öncekine göre DEĞİŞTİ (kırpılmış karşılaştırma) ya da il yaması
 * var (il seçildi / değişti / boşaltıldı). Yalnız not, tutar, durum, müşteri değişen kayıtta `false`.
 *
 * NEDEN VAR (inceleme 2026-10-10, gizlilik — yüksek): kimliksiz takip ucu `teslimatAdresi.takipAdresi` kaydı «yapısal»
 * sayınca adresi YALNIZ il + ülkeden kurar; yapısal değilse eski «son iki parça» maskesi `shippingAddress`'i okur.
 * Yapısal = `teslimatSehri` ya da `teslimatUlke` DOLU. Ülke yalnız etkin değeri değişince yazılırken, alanı olmayan eski
 * kayıtta adres yeni etikete göre («ilçe, mahalle, sokak») yeniden yazılıp il boş bırakıldığında — ya da il sonradan
 * boşaltıldığında — kayıt yapısal OLMUYOR / olmaktan ÇIKIYOR, maske de artık «kalan» olan metnin sokak / kapı / daire
 * düzeyini dışarı veriyordu. Dokunulan kayıtta ülke bu yüzden kayıttaki HAM değerle karşılaştırılır: alan yoksa 'TR'
 * açıkça yazılır ve kayıt KALICI olarak yapısal olur. Dokunulmayan kayıtta kural eskisi gibidir (sessiz 'TR' yok).
 */
function adreseDokunuldu(form: { shippingAddress?: unknown; teslimatSehri?: string | undefined }, onceki: SiparisOncekiHali | null | undefined): boolean {
  const kirp = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const adresDegisti = form.shippingAddress !== undefined && kirp(form.shippingAddress) !== kirp(onceki?.shippingAddress);
  return adresDegisti || 'teslimatSehri' in girilenMetinYamasi('teslimatSehri', form.teslimatSehri, onceki?.teslimatSehri);
}

/**
 * Sipariş düzenleme kaydının yaması. `totalPrice` ve `kdvOran` GİRİLEN alandır (türetilen
 * değil), bu yüzden `girilenAlanYamasi` sözleşmesine uyar:
 *   • kutuda bilinen sayı → yazılır (bilinen `0` dâhil: bedelsiz/iptal sevk ve KDV'siz ihracat
 *     gerçek değerlerdir)
 *   • kutu boş + önceki değer de bilinmiyor → alan HİÇ yazılmaz (sahte ₺0 / %20 yok)
 *   • kutu boş + önceki değer BİLİNİYOR → açıkça `null`; `updateDoc` PATCH-merge olduğundan
 *     alanı yamaya koymamak silmeyi sessiz no-op yapardı.
 *
 * `depoNo` ve `leadId` bu sözleşmenin DIŞINDADIR: seçici bir kez seçilmiş depoyu "seçilmedi"ye
 * döndürmez (`SevkDeposuSecici bosSecenekYok`), çünkü depoyu silmek siparişi Mikro'ya
 * yazılamaz hâle getirir — yalnız BAŞKA bir depoya çevrilebilir. Seçilmemişse alan yazılmaz.
 *
 * `kdvHaricTutar` / `kdvTutari` ise TÜRETİLEN alandır (2026-09-19 kapanış bulgusu): girdileri
 * (`totalPrice`, `kdvOran`) DEĞİŞTİĞİNDE yeniden hesaplanır, türetilemiyorsa açıkça `null`
 * yazılır. Eski hâlde yama yalnız `kdvOran`ı yazıyordu; oluşturmada hesaplanan eski türev
 * KDV panosunda (`utils/muhasebe/kdvAylik`) yaşamaya devam ediyor, aynı sipariş ekranda %20,
 * panoda ₺2.000, Mikro'da %10 KDV gösteriyordu. Girdi DEĞİŞMEDİYSE türevlere dokunulmaz —
 * yalnız adresi düzeltilen (fatura durumu bilinmeyen) kayıtta veri silinmesin.
 *
 * Metin/durum alanları yalnız verildiklerinde yazılır. Sipariş nesnesinin geri kalanı (id,
 * createdAt, lineItems…) yamaya GİRMEZ — bkz. başlıktaki bilinçli fark 2.
 *
 * `teslimatSehri` ve `teslimatUlke` GİRİLEN METİN alanıdır (2026-10-10; `girilenMetinYamasi`): yalnız DEĞİŞTİYSE
 * yazılır, boşaltılan il açıkça `null`. Ülke iki yanda `etkinUlke` ile karşılaştırılır (kayıtta yoksa 'TR') — seçici
 * hiç boş olmadığı için eski kayıtta 'Türkiye' yalnız GÖRÜNÜMDÜR ve yalnız not / tutar değişen kayda sessizce yazılmaz.
 * ADRESE DOKUNULDUYSA (`adreseDokunuldu`: adres metni değişti ya da il yaması var) ülke kayıttaki HAM değerle
 * karşılaştırılır: alanı olmayan eski kayıtta `teslimatUlke: 'TR'` AÇIKÇA yazılır (kayıt takip ucunda kalıcı yapısal
 * olur — inceleme 2026-10-10); ülkesi zaten yazılı kayıtta aynı kod geri yazılmaz. Ülke değişince formun ili
 * boşalttığı (`teslimatAdresi.ulkeSecimiYamasi`) durumda yama `teslimatUlke: yeni kod` + `teslimatSehri: null` olur.
 * İki alan da `undefined` verilirse (mağaza kilidi) yama anahtarlarında BULUNMAZ. `shippingAddress` kuralı değişmedi.
 */
export function siparisDuzenlemeYamasi<D extends string>(
  form: SiparisDuzenlemeGirdileri<D>,
  onceki: SiparisOncekiHali | null | undefined,
): SiparisYamasi<D> {
  const yama: SiparisYamasi<D> = {};
  if (form.customerName !== undefined) yama.customerName = form.customerName;
  if (form.shippingAddress !== undefined) yama.shippingAddress = form.shippingAddress;
  if (form.status !== undefined) yama.status = form.status;
  if (form.depoNo !== undefined) yama.depoNo = form.depoNo;
  if (form.leadId !== undefined) yama.leadId = form.leadId;
  // Belge tipi: yalnız GEÇERLİ açık seçim yazılır (siparisBelgeTipi ile aynı geçerlilik kümesi).
  if (form.faturaTipi === 'e-fatura' || form.faturaTipi === 'e-arsiv' || form.faturaTipi === 'ihracat') yama.faturaTipi = form.faturaTipi;

  const temel: SiparisYamasi<D> = {
    ...yama,
    ...girilenMetinYamasi('teslimatSehri', form.teslimatSehri, onceki?.teslimatSehri),
    // Adrese dokunulduysa önceki ülke HAM karşılaştırılır (alan yoksa 'TR' açıkça yazılır); dokunulmadıysa etkin değerle.
    ...(form.teslimatUlke === undefined ? {} : girilenMetinYamasi('teslimatUlke', etkinUlke(form.teslimatUlke),
      adreseDokunuldu(form, onceki) ? onceki?.teslimatUlke : etkinUlke(onceki?.teslimatUlke))),
    ...girilenAlanYamasi('totalPrice', formSayisi(form.tutarHam), onceki?.totalPrice),
    ...(form.kdvHam === undefined ? {} : girilenAlanYamasi('kdvOran', formSayisi(form.kdvHam), onceki?.kdvOran)),
  };

  const etkinTutar = etkinSayi(temel, 'totalPrice', onceki?.totalPrice);
  const etkinOran  = etkinSayi(temel, 'kdvOran',    onceki?.kdvOran);
  // PENCEREDEN AÇILMIŞ siparişin kalemleri (işaret: `fiyatGirisi`; kalemlerde çapa ve YAZILMIŞ satır tutarları var). Yalnız bu
  // kalemlere dokunulur — eski / kanal / başka yüzeyden gelen siparişte kalemlerin anlamı garanti değildir.
  const pencereKalemleri: OrderLineItem[] | null =
    onceki?.faturali === true && fiyatBirimiMi(onceki.fiyatGirisi) && Array.isArray(onceki.lineItems)
      && kayitliTutarlar(onceki.lineItems as OrderLineItem[]) !== null
      ? (onceki.lineItems as OrderLineItem[]) : null;
  // KALEM BAYAT MI: kalemin satır KDV'si kalemin `vatRate`'iyle yazılır; başlık oranı ondan farklıysa kalem eski orana aittir.
  // Bayat kalırsa fatura gövdesi (`satirKdvTutari`) kayıtlı satır KDV'sini yeni oranla tutmadığı için siparişi REDDEDER —
  // bu yüzden oranı değiştiren HER yol kalemleri de yeniler (inceleme 2026-10-08: başlık yolu kalemleri bayat bırakıyor,
  // sipariş kalıcı olarak faturalanamıyordu).
  const kalemleriYenile = (): OrderLineItem[] | undefined =>
    pencereKalemleri !== null && etkinOran !== null && pencereKalemleri.some(k => k.vatRate !== etkinOran)
      ? oranDegisimi(pencereKalemleri, etkinOran)?.kalemler
      : undefined;

  if (ayniSayi(etkinTutar, oncekiSayi(onceki?.totalPrice)) && ayniSayi(etkinOran, oncekiSayi(onceki?.kdvOran))) {
    // Girdiler değişmedi → türevlere dokunma. Tek istisna: kalemler başlık oranına göre BAYATSA (önceki bir kayıttan kalma)
    // aynı değerlerle yeniden kaydetmek onları onarır — fatura gövdesinin «düzenleyip yeniden kaydedin» çaresi çalışsın.
    const onarilan = kalemleriYenile();
    return onarilan ? { ...temel, lineItems: onarilan } : temel;
  }
  // KALEM YOLU — pencereden açılmış kalemli sipariş + yalnız ORAN değişti → pencerenin kuralı, aynı işlevle (`oranDegisimi`):
  // her kalem kendi çapasıyla yeniden hesaplanır — KDV hariç girilende MATRAH, KDV dâhil girilende TOPLAM sabit; başlık tutarı
  // da kalemlerden yazılır. Eski yol toplamı sabit tutup matrahı ondan ayrıştırıyordu: 250 × 12 KDV hariç, %20 → %10 için
  // Cetpa 3.600 / 3.272,73 derken kesilecek fatura 3.000 + 300 = 3.300 (inceleme 2026-10-03). Kalem yolu YALNIZ kayıtlı
  // başlık tutarı gerçekten kalemlerden türemişse:
  //   • tutar bu düzenlemede ELLE değiştiyse kullanıcının yazdığı toplam geçerlidir (başlık yolu);
  //   • ÖNCEKİ bir düzenlemede elle yazıldıysa da öyle — kayıtlı toplam, kalemlere YAZILMIŞ satır tutarlarının toplamını
  //     (`kayitliTutarlar`) tutmaz; yoksa pazarlıkla 3.500'e çekilmiş toplam sonraki "yalnız oran" düzenlemesinde uyarısız
  //     3.300 olurdu. Karşılaştırma TOPLAM üzerinden (kuruşu kuruşuna): 1 kuruşluk elle düzeltme de yakalanır.
  // BİLİNEN SINIR (inceleme 2026-10-08, bilinçli): "elle yazıldı" bilgisi ayrı bir işaret DEĞİL, bu eşitliktir. Elle yazılan
  // toplam bir ara oranda kalem toplamına TAM eşit düşerse (250 × 12 → elle 3.300, sonra oran %10: Σ kalem = 3.300) sipariş o
  // andan sonra kalemden türemiş sayılır ve sonraki oran değişikliği toplamı kalemlerden yazar (%20 → 3.600). Kayıp sessiz
  // değildir: düzenleme formu kaydetmeden ÖNCE «3.600 olarak kaydedilir» notunu basar (`duzenlemeTutarOnizleme`); kesilecek
  // belge de zaten kalemlerden kurulur. Ayrı işaret (kalıcı yeni alan) bu nadir tesadüf için eklenmedi — davranış testte kilitli.
  const tutarElleDegisti = !ayniSayi(etkinTutar, oncekiSayi(onceki?.totalPrice));
  if (pencereKalemleri !== null && etkinOran !== null && !tutarElleDegisti
      && oncekiSayi(onceki?.totalPrice) === kayitliTutarlar(pencereKalemleri)?.toplam) {
    const d = oranDegisimi(pencereKalemleri, etkinOran);
    if (d !== null) {
      return { ...temel, totalPrice: d.tutarlar.toplam, kdvHaricTutar: d.tutarlar.matrah, kdvTutari: d.tutarlar.kdv, lineItems: d.kalemler };
    }
  }
  // BAŞLIK YOLU — toplam kullanıcının yazdığıdır; türevler ondan. Oran değiştiyse kalemler YİNE yenilenir (satır KDV'si ve
  // kalem oranı yeni orandan — yukarıdaki bayatlık kuralı); başlık tutarına dokunulmaz.
  const turev = kdvTurevleri(etkinTutar, etkinOran, onceki?.faturali);
  const yenilenen = kalemleriYenile();
  return {
    ...temel,
    ...girilenAlanYamasi('kdvHaricTutar', turev.kdvHaricTutar, onceki?.kdvHaricTutar),
    ...girilenAlanYamasi('kdvTutari',     turev.kdvTutari,     onceki?.kdvTutari),
    ...(yenilenen ? { lineItems: yenilenen } : {}),
  };
}

/**
 * Yama uygulandıktan sonra EKRANDAKİ sipariş nesnesinin tutarı. `Order.totalPrice` tipi
 * `number` olduğundan silinen tutar `NaN` ile temsil edilir — okuyan taraf (`bilinenSayi`,
 * `paraYaz`, `siparisTutari`) NaN'ı zaten bilinmeyen sayıp '—' basar; 0 yazmak sahte kesinlik olurdu.
 */
export function yerelTutar(yamaTutari: number | null | undefined, onceki: unknown): number {
  if (yamaTutari === undefined) return bilinenSayi(onceki) ? Number(onceki) : NaN;
  return yamaTutari === null ? NaN : yamaTutari;
}

/**
 * Yama uygulandıktan sonra ekrandaki siparişin OPSİYONEL sayı alanı (`kdvOran`, `kdvTutari`,
 * `kdvHaricTutar` — hepsi `number | undefined`). Bilinmeyen değer alanın YOKLUĞUYLA temsil
 * edilir; `yerelTutar`ın NaN'ı buraya UYMAZ.
 *
 * NEDEN AYRI (2026-09-19 delta regresyonu): NaN paylaşılan `selectedOrder` nesnesine yazılınca
 * `JSON.stringify(NaN)` onu `null`a çeviriyor ve dış sisteme giden gövdede (`handleMikroFatura`
 * → `FaturaKaydetSchema.kdvOran: z.number().min(0).max(100).optional()`) şema kapısına takılıyor.
 * Kullanıcı alan-bazlı "KDV oranı eksik, siparişi düzenleyin" gerekçesi yerine ham doğrulama
 * hatası görüyordu; alan hiç yazılmadığında ise `JSON.stringify` onu düşürüyor ve sunucu
 * anlamlı gerekçeyi döndürüyor.
 */
export function yerelSayi(yamaDegeri: number | null | undefined, onceki: unknown): number | undefined {
  if (yamaDegeri === undefined) return bilinenSayi(onceki) ? Number(onceki) : undefined;
  return yamaDegeri === null ? undefined : yamaDegeri;
}

/**
 * Yama uygulandıktan sonra ekrandaki siparişin OPSİYONEL METİN alanı (`teslimatSehri`, `teslimatUlke` — `Order`'da
 * `string | undefined`) — `yerelSayi`'nın metin eşi. Yamadaki `null` (boşaltıldı) alanın YOKLUĞUYLA temsil edilir:
 * `{ ...o, ...yama }` `null`'ı `Order`'a taşırdı (tip `string`; okuyan `.trim()` çağırırsa fırlar).
 *   • yamada değer → o değer · yamada `null` → `undefined` · yamada alan yok → önceki (metin değilse `undefined`).
 */
export function yerelMetin(yamaDegeri: string | null | undefined, onceki: unknown): string | undefined {
  if (yamaDegeri === undefined) return typeof onceki === 'string' ? onceki : undefined;
  return yamaDegeri === null ? undefined : yamaDegeri;
}
