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
 *      status, totalPrice + 2026-09-19'da eklenen depoNo/kdvOran). Eski kod
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
  status?: D;
  totalPrice?: number | null;
  kdvOran?: number | null;
  /** TÜRETİLEN: `totalPrice`/`kdvOran` değişince yeniden hesaplanır; türetilemezse `null`. */
  kdvHaricTutar?: number | null;
  /** TÜRETİLEN — bkz. `kdvHaricTutar`. */
  kdvTutari?: number | null;
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
}

/**
 * KDV türevleri — `App.tsx handleAddOrder`'daki oluşturma formülünün TEK kopyası:
 *   `kdvHaricTutar = faturali ? tutar / (1 + oran/100) : tutar`
 *   `kdvTutari     = faturali ? tutar - kdvHaricTutar  : 0`
 * (Oluşturmadaki `kdvOran ?? 20` uydurması BURAYA TAŞINMADI: bilinmeyen oran %20 değildir.)
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
    ...girilenAlanYamasi('totalPrice', formSayisi(form.tutarHam), onceki?.totalPrice),
    ...(form.kdvHam === undefined ? {} : girilenAlanYamasi('kdvOran', formSayisi(form.kdvHam), onceki?.kdvOran)),
  };

  const etkinTutar = etkinSayi(temel, 'totalPrice', onceki?.totalPrice);
  const etkinOran  = etkinSayi(temel, 'kdvOran',    onceki?.kdvOran);
  if (ayniSayi(etkinTutar, oncekiSayi(onceki?.totalPrice)) && ayniSayi(etkinOran, oncekiSayi(onceki?.kdvOran))) {
    return temel;   // girdiler değişmedi → bayatlık yok, türevlere dokunma
  }
  const turev = kdvTurevleri(etkinTutar, etkinOran, onceki?.faturali);
  return {
    ...temel,
    ...girilenAlanYamasi('kdvHaricTutar', turev.kdvHaricTutar, onceki?.kdvHaricTutar),
    ...girilenAlanYamasi('kdvTutari',     turev.kdvTutari,     onceki?.kdvTutari),
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
