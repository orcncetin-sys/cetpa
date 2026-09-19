/**
 * iadeTalep.ts — satış iadesi (`salesReturns`) tutar kuralları TEK KAYNAK.
 * Faz 3 4/n, OrdersPage kapatma, grup "iadeTalep". Test: iadeTalep.test.ts (önce yazıldı).
 *
 * NEDEN VAR — OrdersPage.tsx'teki üç sahte-kesinlik sitesi (2026-09-19 ölçümü):
 *   • 1442 `amount: Number(p575Draft.amount) || 0` — İade Yönetimi formunda tutar alanı boş
 *     bırakılınca kayda ₺0 giriyordu (`Number('') === 0`). Tutar OPSİYONEL bir alan; boş
 *     "iade bedelsiz" demek değil, "bilinmiyor" demektir. Düzenlemede de her kayıtta `amount`
 *     yamaya konduğu için kullanıcının sildiği tutar ₺0'a dönüşüyordu.
 *   • 2046 `setReturnAmount(selectedOrder.totalPrice || 0)` — sipariş toplamı bilinmeyen
 *     (Mikro türevi, `totalAmount` taşıyan) siparişte form ₺0 ile ön-doluyordu.
 *   • 3345 `const maxRet = Number(o.totalPrice) || 0` — bilinmeyen toplam ₺0 ÜST SINIRA
 *     dönüşüyor, ardından `returnAmount > maxRet + 0.01` her tutarı reddediyordu:
 *     "İade tutarı 0 ile 0 arasında olmalı." Yani tutarı bilinmeyen siparişin iadesi
 *     hiç kaydedilemiyordu — sahte sıfır, kullanıcıyı kilitleyen bir kapıya dönüşmüştü.
 *
 * PARİTE: girdilerin ikisi de bilinirken sayı ve kabul/ret kararı eskisiyle BİREBİR aynı —
 * 0 < tutar ≤ toplam + 0,01 kuruş toleransı (eski `maxRet + 0.01`), eşitlik geçerli.
 *
 * BİLİNÇLİ FARKLAR:
 *   1. Üst sınır `siparisTutari` ile okunur (`totalPrice ?? totalAmount`) — eski kod yalnız
 *      `totalPrice`e bakıyordu, Mikro türevi siparişte sınır sahte ₺0 oluyordu.
 *   2. Sipariş toplamı BİLİNMİYORSA üst sınır UYGULANMAZ (`ustSinir: null`) — çağıran ekranda
 *      "sipariş tutarı bilinmiyor, üst sınır doğrulanamıyor" uyarısı gösterir. Bilinmeyen bir
 *      sayıyla karşılaştırıp reddetmek, bilinmeyeni 0 saymanın başka bir adıdır.
 *   3. Boş girdi ('bos') ile sıfır/negatif girdi ('pozitifDegil') AYRI hatalar: ilki "doldur",
 *      ikincisi "geçersiz". Eski kodda ikisi de `<= 0` dalına düşüyordu.
 *   4. Spesifikasyona ek iki alan/fonksiyon: sonuçtaki `tutar` (çağıran girdiyi ikinci kez
 *      `Number(...)`den geçirmesin — ikinci ayrıştırma ikinci kural kopyasıdır) ve
 *      `iadeTutarYamasi` (1442'deki opsiyonel alanın PATCH-merge yaması).
 */

import { bilinenSayi } from '../para';
import { siparisTutari, type SiparisTutarAlanlari } from '../siparis';
import { formSayisi, girilenAlanYamasi } from '../muhasebe/irsaliyeCalisan';

/** Kuruş yuvarlamasına tolerans — eski modalin `maxRet + 0.01`i (parite). */
const KURUS_TOLERANSI = 0.01;

export type IadeTutarHatasi =
  /** Alan boş ya da sayıya çözülemiyor → BİLİNMİYOR (₺0 değil). */
  | 'bos'
  /** Bilinen ama ≤ 0 → ₺0 / negatif iade kaydedilmez. */
  | 'pozitifDegil'
  /** Bilinen sipariş toplamını (+ kuruş toleransı) aşıyor. */
  | 'siparisiAsiyor';

export interface IadeTutarSonucu {
  gecerli: boolean;
  hata?: IadeTutarHatasi;
  /**
   * Doğrulanan üst sınır — sipariş toplamı bilinmiyorsa null: sınır UYGULANMAZ, ekran uyarı gösterir.
   * Mesaj metni için de budur (`paraYaz(ustSinir)` bilinmeyeni '—' basar).
   */
  ustSinir: number | null;
  /** Kayda yazılacak sayı; geçersizse null. Çağıran girdiyi yeniden ayrıştırmaz. */
  tutar: number | null;
}

/**
 * İade tutarı doğrulaması. `girilen` ham form değeri (input.value string'i de olur),
 * `siparisToplami` ise BİLİNEN sipariş tutarı ya da bilinmiyor (null/undefined/NaN/'').
 * Üst sınırı `iadeOnTutar`/`siparisTutari` ile üretip buraya verin.
 */
export function iadeTutariDogrula(girilen: unknown, siparisToplami: unknown): IadeTutarSonucu {
  const ustSinir = bilinenSayi(siparisToplami) ? Number(siparisToplami) : null;
  const tutar = formSayisi(girilen);

  if (tutar === null) return { gecerli: false, hata: 'bos', ustSinir, tutar: null };
  if (tutar <= 0) return { gecerli: false, hata: 'pozitifDegil', ustSinir, tutar: null };
  if (ustSinir !== null && tutar > ustSinir + KURUS_TOLERANSI) {
    return { gecerli: false, hata: 'siparisiAsiyor', ustSinir, tutar: null };
  }
  return { gecerli: true, ustSinir, tutar };
}

/**
 * İade modalinin tutar alanı ön-dolumu: siparişin BİLİNEN toplamı, bilinmiyorsa null → alan BOŞ kalır
 * (eski `totalPrice || 0` ₺0 yazıyor, kullanıcı da onu onaylayıp ₺0 iade kaydediyordu).
 * Bilinen 0 toplam 0 döner (meşru sıfır sıfırdır); doğrulama onu 'pozitifDegil' ile reddeder.
 */
export function iadeOnTutar(siparis: SiparisTutarAlanlari | null | undefined): number | null {
  if (!siparis) return null;
  const t = siparisTutari(siparis);
  return Number.isFinite(t) ? t : null;
}

/**
 * İade kaydının `amount` yaması — GİRİLEN, üstelik OPSİYONEL alan (form yalnız müşteri + nedeni zorunlu tutar).
 *   • bilinen tutar → `{ amount: tutar }`
 *   • boş + yeni kayıt / önceki de bilinmiyor → `{}` (alan hiç yazılmaz: sahte ₺0 yok)
 *   • boş + önceki BİLİNİYOR → `{ amount: null }` (kullanıcı bilerek sildi; `updateDoc` PATCH-merge
 *     olduğundan alanı yamaya koymamak silmeyi sessiz no-op yapardı)
 * ÇAĞIRMA SIRASI: önce `iadeTutariDogrula`; 'pozitifDegil'/'siparisiAsiyor' ise toast ile DUR —
 * bu yama reddedilen tutarı kayda sokmaz ama kullanıcıya da bir şey söylemez.
 */
export function iadeTutarYamasi(sonuc: IadeTutarSonucu, onceki: unknown): { amount?: number | null } {
  return girilenAlanYamasi('amount', sonuc.tutar, onceki);
}

/**
 * Liste hücresi ile DÜZENLEME ön-dolumunun ORTAK "gösterilebilir tutar" tanımı: bilinen ve
 * POZİTİF sayı, yoksa null ('—' / boş alan). Ölçüt `iadeTutariDogrula`nın kabul kuralıyla aynıdır
 * (0 ve negatif = 'pozitifDegil'), yani "listede görünmeyen tutar" ile "kaydedilebilir tutar" tek
 * kural.
 *
 * NEDEN (2026-09-19 hakem bulgusu, OrdersPage 1533/1541): hücre `r.amount > 0` kapısıyla '—'
 * basarken düzenle düğmesi `r.amount == null ? '' : String(r.amount)` ile formu '0' ile açıyordu.
 * Eski kayıt kuralı (`Number(draft.amount) || 0`) tutarı boş bırakılan her iadeyi ₺0 kaydettiği
 * için bu kayıtlar yaygın: kullanıcı yalnız nedeni değiştirip Kaydet'e bastığında doğrulama
 * 'pozitifDegil' deyip kaydı DURDURUYORDU — hem de listede tutar '—' görünürken. Form artık boş
 * açılır; boş + önceki bilinen 0 → `iadeTutarYamasi` `{ amount: null }` yazarak sahte sıfırı temizler.
 *
 * `irsaliyeCalisan.gorunenTutar` ile BİLEREK ayrı: o `!== 0` der (negatif bakiye/gider meşrudur),
 * iade tutarında negatif meşru değildir.
 */
export function iadeGorunenTutar(amount: unknown): number | null {
  return bilinenSayi(amount) && Number(amount) > 0 ? Number(amount) : null;
}
