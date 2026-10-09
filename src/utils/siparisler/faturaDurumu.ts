/**
 * faturaDurumu — "bu siparişin faturası VAR mı" ile "faturalı satış mı" AYRI sorulardır.
 *
 * Neden var (2026-09-24, kullanıcı kuralı: "faturası olan bir şeye tekrar fatura kestiremeyiz"):
 * OrdersPage:1449 'Fatura Kes' düğmesi `!hasInvoice && faturali !== false` ile açılıyordu.
 * Mikro'dan gelen fatura satırları (`source: 'mikro-fatura'`, sunucu `faturali: true` yazar,
 * `mikroFaturaNo` dolu) bu koşulu GEÇİYOR ve MF-383 gibi zaten-fatura olan satırda
 * 'Fatura Kes' görünüyordu. Kök neden: `faturali` bayrağı "faturalı satış / faturasız satış"
 * ayrımıdır (App.tsx:3121 form alanı, kdvAylik sayacı), "fatura kesildi" anlamına gelmez.
 *
 * Sözleşme:
 *  - `siparisFaturaVar`: Cetpa faturası (`hasInvoice`) YA DA Mikro faturası (`mikroFaturaNo`)
 *    YA DA satırın kendisi bir Mikro faturası (`source === 'mikro-fatura'`). Yalnız GERÇEK
 *    boolean/string kabul edilir — `'true'`/`1` gibi değerler fatura kanıtı sayılmaz.
 *  - `faturaKesilebilir`: faturasız satış (`faturali === false`) DEĞİL ve faturası YOK.
 *  - `mikroyaFaturaGonderilebilir`: Mikro'da faturası yok ve satır Mikro faturası değil;
 *    Cetpa-iç faturanın (`hasInvoice`) olması Mikro'ya e-Fatura göndermeyi ENGELLEMEZ
 *    (yerel kayıt → Mikro e-Fatura akışı meşru). `faturali === false` yine kapatır.
 *    ÇEVRİM İÇİ MAĞAZA siparişi (`source === MAGAZA_KAYNAGI`) de KAPALI (2026-10-07): eşleyici kalemde `price`
 *    yazmaz ve sipariş cariye bağlı gelmez — gönderim her yoldan sunucu şemasında 400 ile bitiyor, düğme ise
 *    kullanıcıyı «belge tipini seç» + resmî belge onayına yürütüp ölü uca çıkarıyordu. Mağaza siparişine fatura
 *    yolu yazıldığında (kaleme `price` + cari eşlemesi) bu dal onunla BİRLİKTE açılır.
 *    `faturaKesilebilir` bu kuralın DIŞINDA: o düğme yalnız Muhasebe sekmesine götürür, çıkmaz üretmez.
 *
 * Parite: eşleşen bilinen girdilerde (native sipariş, hasInvoice yok, faturali undefined/true)
 * eski davranışla BİREBİR; tek fark Mikro faturası olan satırlarda düğmenin KAPANMASI.
 */
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi';

export interface FaturaDurumuGirdisi {
  source?: string;
  hasInvoice?: boolean;
  mikroFaturaNo?: string;
  faturali?: boolean;
}

export function siparisFaturaVar(o: FaturaDurumuGirdisi | null | undefined): boolean {
  if (!o) return false;
  if (o.source === 'mikro-fatura') return true;
  if (typeof o.mikroFaturaNo === 'string' && o.mikroFaturaNo.trim() !== '') return true;
  return o.hasInvoice === true;
}

export function faturaKesilebilir(o: FaturaDurumuGirdisi | null | undefined): boolean {
  if (!o) return false;
  if (o.faturali === false) return false;
  return !siparisFaturaVar(o);
}

export function mikroyaFaturaGonderilebilir(o: FaturaDurumuGirdisi | null | undefined): boolean {
  if (!o) return false;
  if (o.faturali === false) return false;
  if (o.source === 'mikro-fatura') return false;
  if (o.source === MAGAZA_KAYNAGI) return false;
  return !(typeof o.mikroFaturaNo === 'string' && o.mikroFaturaNo.trim() !== '');
}

// ── Bayat kalem: satır KDV'si hangi orana ait ────────────────────────────────────────────────────────────────────
// Sipariş penceresi kaleme satır KDV'sini (`kdv`) ve — KDV dâhil girilen fiyatta — orana bağlı net birim fiyatı kalemin
// `vatRate`'iyle yazar. Sipariş oranı (`kdvOran`) ondan FARKLIYSA kalem eski orana aittir (bayat). Üç durum, iki saf işlev:
//   • kalem oranı = sipariş oranı        → satır KDV'si belgeye aynen gider (`kalemSatirKdv`);
//   • kalem oranı BİLİNİYOR ve farklı    → belge KESİLMEZ (`bayatKalemVar`): yalnız KDV'yi düşürüp göndermek KDV dâhil çapada
//                                           bayat net fiyatla yanlış toplamlı belge keserdi (yazılan 50,01 yerine 45,85);
//   • kalemde oran YOK (pencere dışı kalem) → KDV'nin hangi orana ait olduğu bilinmez: gönderilmez, sunucu güncel orandan
//                                           hesaplar; belge engellenmez (o kalemde net birim orana bağlı değildir).
// App.tsx `handleMikroFatura` bu ikisini kullanır; yüklem satır içi dururken çit testi yalnız METNİ kilitleyebiliyordu
// (kapıyı söndüren mutantlar yeşil kalıyordu — inceleme 2026-10-08).

interface KdvliKalem { kdv?: unknown; vatRate?: unknown }
const sonluSayi = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Siparişte, satır KDV'si sipariş oranından FARKLI bir orana ait kalem var mı (→ fatura isteği gönderilmez). */
export function bayatKalemVar(o: { kdvOran?: unknown; lineItems?: ReadonlyArray<KdvliKalem> | null } | null | undefined): boolean {
  if (!o || !sonluSayi(o.kdvOran)) return false;      // sipariş oranı yoksa karışılmaz — sunucu 400 ile sebebini söyler
  return (o.lineItems ?? []).some(l => sonluSayi(l.kdv) && sonluSayi(l.vatRate) && l.vatRate !== o.kdvOran);
}

/** Fatura isteğine konacak satır KDV'si: yalnız kalemin oranı sipariş oranıyla AYNIYSA; değilse `undefined` (alan gönderilmez). */
export function kalemSatirKdv(l: KdvliKalem, kdvOran: unknown): number | undefined {
  return sonluSayi(l.kdv) && sonluSayi(kdvOran) && l.vatRate === kdvOran ? l.kdv : undefined;
}
