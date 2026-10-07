/**
 * siparisKalemFiyati.ts — "Yeni Sipariş" penceresinde bir ürünün SATIŞ FİYATI ve kalem denetimi. Saf (2026-10-02).
 *
 * NEDEN (kullanıcı bildirimi: «sipariş ekranında kur hatası ve fiyat bağlantı hatası var» — her ürün "$0.00"):
 *   • pencere fiyatı `item.price || prices.Retail || 0` ile okuyordu — MÜŞTERİNİN fiyat kademesine (lead.priceTier) hiç
 *     bakmıyor, `price`'ı `prices`'ın önüne koyuyordu (teklif formu tersini yapar: kademe → price);
 *   • kartın para birimini (priceCurrency) yok sayıyordu: USD fiyatlı kartın 12,50'si TL tutarı gibi kaleme yazılıyordu;
 *   • fiyatı BİLİNMEYEN ürünü "0,00" gösterip kaleme 0 fiyatla ekliyordu — sipariş ₺0 ile kaydedilip Mikro'ya 0 fiyatlı
 *     satır gidebiliyordu (sahte kesinlik: 0 "bedelsiz" demektir, "bilinmiyor" değil).
 * Kural: fiyat `kartSatisTL` (utils/cost) ile çözülür — kademe, yoksa kartın düz `price`'ı; dövizliyse güncel kurla TL.
 * Sonuç pozitif değilse fiyat BİLİNMİYOR: pencere "fiyat yok" der, kalem fiyat kutusu BOŞ açılır ve fiyat girilmeden kayıt olmaz.
 *
 * KDV (2026-10-03, kullanıcı: «hesap hatası var — 3000 dâhil birim fiyat girişi var; KDV dâhil ya da KDV hariç birim fiyat
 * girişi seçilebilmeli»): pencere girilen fiyatı HEP KDV dâhil sayıyordu (250 × 12 = 3.000 → matrah 2.500 + KDV 500). Oysa
 *   • Mikro sipariş / fatura gövdesi kalem fiyatını KDV HARİÇ okur (`sip_b_fiyat`, üstüne KDV ekler — govdeSiparis);
 *   • raporlar ve Mikro faturasından türeyen kalem de `price`'ı KDV hariç net birim sayar (eslemeFatura, kalemTutari);
 *   • teklif formu ve stok kartı fiyatı KDV hariçtir.
 * Yani aynı sipariş Cetpa'da 3.000, Mikro'da 3.600 oluyordu. Kural:
 *   • KAYITTA kalemin `price`'ı HER ZAMAN KDV HARİÇ net birimdir (ortak anlam — tek okuma);
 *   • GİRİŞTE birim seçilir (`FiyatBirimi`): her kalem, fiyatının girildiği birimi ÇAPA olarak taşır (kayıtta da:
 *     `fiyatBirimi`, KDV dâhil girilende yazılan birim `dahilFiyat`).
 *   • KDV HARİÇ çapa: matrah = kuruş(fiyat × miktar) · KDV = kuruş(matrah × oran) · toplam = matrah + KDV.
 *   • KDV DÂHİL çapa — **YAZILAN TOPLAM KORUNUR** (kullanıcı kararı 2026-10-07; önizlemede 50,01 × 1 = 50,02 çıkınca «hesap
 *     nasıl farklı çıktı» diye sordu): toplam = kuruş(yazılan × miktar) · matrah = kuruş(net birim × miktar) · KDV = toplam −
 *     matrah (iç yüzde). %20'de 50,01 için matrah 41,68 + KDV 8,33; «KDV = matrah × oran» 8,34 verir ve hiçbir matrah tam
 *     50,01 etmez — bu yüzden satır KDV'si KALEME yazılır (`kdv`) ve fatura gövdesi onu kalemden alır (kayıt = belge).
 *     ÖLÇÜLMEDİ: Mikro / GİB'in matrah × orandan 1 kuruş farklı satır KDV'sini kabul edip etmediği — Cetpa'dan ilk gerçek
 *     fatura kesilince doğrulanacak.
 *   • Oran değişince (pencerede, kopyada, düzenleme formunda — tek kural): KDV dâhil çapada TOPLAM, KDV hariç çapada MATRAH
 *     sabit kalır; net birim çapadan yeniden türetilir (`oranDegisimi`).
 */
import type { InventoryItem, OrderLineItem } from '../../types';
import { kartSatisTL } from '../cost';
import { kurusaYuvarla } from '../para';

export const VARSAYILAN_FIYAT_KADEMESI = 'Retail';

/** Müşterinin fiyat kademesi; tanımlı değilse perakende (teklif formuyla AYNI kural — QuotationForm). */
export function musteriFiyatKademesi(musteri: { priceTier?: unknown } | null | undefined): string {
  return typeof musteri?.priceTier === 'string' && musteri.priceTier.trim() !== '' ? musteri.priceTier : VARSAYILAN_FIYAT_KADEMESI;
}

export type FiyatDurumu =
  | { fiyat: number; neden: null }
  /** 'yok' = kartta bu kademe için (ve düz `price`'ta) pozitif fiyat yok · 'kurYok' = fiyat dövizli ve kuru bilinmiyor / birim tanınmıyor. */
  | { fiyat: null; neden: 'yok' | 'kurYok' };

/** Ürünün TL satış fiyatı. 0 ve negatif "fiyat yok" sayılır (fiyat importu da öyle sayar — eslemeStok.fiyatEsle). */
export function urunSiparisFiyati(item: InventoryItem, kademe: string, kurlar: Record<string, number> | null | undefined): FiyatDurumu {
  const tl = kartSatisTL(item, kademe, kurlar);
  if (tl !== null && tl > 0) return { fiyat: kurusaYuvarla(tl), neden: null };
  if (tl !== null) return { fiyat: null, neden: 'yok' };                      // 0 / negatif
  // null: ya hiç fiyat yok ya da dövizli fiyat çevrilemedi — ikisini ayır ki kullanıcı NEDENİ görsün.
  const ham = (item.prices as Record<string, unknown> | undefined)?.[kademe] ?? (item as { price?: unknown }).price;
  return { fiyat: null, neden: typeof ham === 'number' && Number.isFinite(ham) && ham > 0 ? 'kurYok' : 'yok' };
}

/** Birim fiyatın girildiği birim. Varsayılan KDV HARİÇ (stok kartı, teklif, Mikro ve raporlarla aynı anlam). */
export type FiyatBirimi = 'kdvHaric' | 'kdvDahil';
export const VARSAYILAN_FIYAT_BIRIMI: FiyatBirimi = 'kdvHaric';
export const fiyatBirimiMi = (x: unknown): x is FiyatBirimi => x === 'kdvHaric' || x === 'kdvDahil';

/** Pencerenin kalemi: fiyat girilene kadar `null`. `price` kalemin ÇAPA birimindedir (`fiyatBirimi`; yoksa KDV hariç) —
 *  kayda giden KDV hariç net birim `kayitFiyati` ile türetilir. */
export interface TaslakKalem {
  id: string; price: number | null; quantity: number; fiyatBirimi?: FiyatBirimi;
}

const kdvCarpani = (oran: number): number | null => (Number.isFinite(oran) && oran >= 0 ? 1 + oran / 100 : null);
const altiHane = (n: number): number => Math.round(n * 1e6) / 1e6;
const fiyatBilinen = (k: TaslakKalem): k is TaslakKalem & { price: number } => typeof k.price === 'number' && Number.isFinite(k.price);

/**
 * Kalemin birim fiyatı İSTENEN birimde. Çapa birimi istenenle aynıysa girilen değer AYNEN döner (yuvarlanmaz — kullanıcının
 * yazdığı sayı değişmez); farklıysa KDV oranıyla çevrilir (çağıran gösterirken kuruşa yuvarlar). Fiyat ya da oran bilinmiyorsa null.
 */
export function kalemBirimi(k: TaslakKalem, birim: FiyatBirimi, oran: number): number | null {
  if (!fiyatBilinen(k)) return null;
  const capa = k.fiyatBirimi ?? VARSAYILAN_FIYAT_BIRIMI;
  if (capa === birim) return k.price;
  const c = kdvCarpani(oran);
  if (c === null) return null;
  return birim === 'kdvDahil' ? k.price * c : k.price / c;
}

/** Fiyat kutusunda gösterilen değer: çapa birimindeyse yazıldığı gibi, çevrildiyse kuruşa yuvarlı. */
export function gorunenFiyat(k: TaslakKalem, birim: FiyatBirimi, oran: number): number | null {
  const b = kalemBirimi(k, birim, oran);
  if (b === null) return null;
  // Oran 0 (faturasız / istisna): iki birim AYNI sayıdır — çevrim de yuvarlama da yok.
  return (k.fiyatBirimi ?? VARSAYILAN_FIYAT_BIRIMI) === birim || kdvCarpani(oran) === 1 ? b : kurusaYuvarla(b);
}

/**
 * Satırın tutarları — üçü de KURUŞ; `haric + kdv === dahil`.
 *   • KDV HARİÇ çapa: matrah = kuruş(fiyat × miktar) · KDV = kuruş(matrah × oran / 100) · dâhil = matrah + KDV
 *     (fatura gövdesinin kendi hesabıyla aynı: `sth_vergi = round(sth_tutar × oran) / 100`);
 *   • KDV DÂHİL çapa: dâhil = kuruş(yazılan fiyat × miktar) — kullanıcının yazdığı tutar DEĞİŞMEZ · matrah = kuruş(net birim ×
 *     miktar) — kayda ve Mikro'ya giden net birimle hesaplanan satır tutarının AYNISI (`kayitFiyati`) · KDV = dâhil − matrah.
 *     Bu KDV, matrah × orandan 1 kuruş farklı olabilir; belgeye de bu değer gider (kalem `kdv`'si → fatura gövdesi).
 *   • Oran 0 (faturasız / istisna): üç tutar da kuruş(fiyat × miktar); KDV 0.
 */
export function satirTutarlari(k: TaslakKalem, oran: number): { haric: number; kdv: number; dahil: number } | null {
  const c = kdvCarpani(oran);
  if (!fiyatBilinen(k) || c === null || !Number.isFinite(k.quantity)) return null;
  const capaTutari = kurusaYuvarla(k.price * k.quantity);
  if (c === 1) return { haric: capaTutari, kdv: 0, dahil: capaTutari };
  if ((k.fiyatBirimi ?? VARSAYILAN_FIYAT_BIRIMI) === 'kdvDahil') {
    const haric = kurusaYuvarla(kayitFiyati(k, oran) * k.quantity);
    return { haric, kdv: kurusaYuvarla(capaTutari - haric), dahil: capaTutari };
  }
  const kdv = kurusaYuvarla(capaTutari * (oran / 100));
  return { haric: capaTutari, kdv, dahil: kurusaYuvarla(capaTutari + kdv) };
}

/** Siparişin tutarları: `matrah + kdv === toplam` (satır tutarlarının toplamı). */
export interface SiparisTutarlari { matrah: number; kdv: number; toplam: number }

/**
 * Sipariş tutarları — TEK hesap (pencere özeti, kayıt, yevmiye ve Mikro'ya giden toplam bundan okur): satır tutarlarının
 * toplamı. DEĞİŞMEZLER: `matrah === Σ kuruş(kayitFiyati × miktar)` (Mikro'ya giden satır tutarları) ve `kdv === Σ satır KDV'si`
 * (kaleme yazılan `kdv`; fatura gövdesi onu gönderir) — kayıt = belge.
 * Fiyatı eksik kalem varsa `null`: toplam "bilinmiyor" (eksik kalem 0 sayılıp toplanmaz). Faturasız siparişte çağıran oranı
 * 0 geçer (KDV yok: matrah = toplam, iki birim aynı).
 */
export function siparisTutarlari(kalemler: readonly TaslakKalem[], oran: number): SiparisTutarlari | null {
  if (kdvCarpani(oran) === null) return null;
  let haric = 0, dahil = 0;
  for (const k of kalemler) {
    const t = satirTutarlari(k, oran);
    if (t === null) return null;
    haric += t.haric; dahil += t.dahil;
  }
  const matrah = kurusaYuvarla(haric), toplam = kurusaYuvarla(dahil);
  return { matrah, kdv: kurusaYuvarla(toplam - matrah), toplam };   // satır KDV'leri kuruş: fark = Σ satır KDV'si
}

/**
 * Kayda giden birim fiyat: KDV HARİÇ net birim. KDV hariç girilen fiyat AYNEN; KDV dâhil girilen 6 ondalığa çevrilir
 * (kuruşa yuvarlansa 100,00 dâhil → 83,33 × 12 = 999,96 olur ve Mikro'nun kendi çarpımı Cetpa toplamından sapardı;
 * 83,333333 × 12 = 1.000,00). Oran 0 ise çevrim yoktur. Fiyat / oran bilinmiyorsa FIRLATIR — çağıran `kalemSorunu`
 * kapısından sonra çağırır.
 */
export function kayitFiyati(k: TaslakKalem, oran: number): number {
  const c = kdvCarpani(oran);
  if (!fiyatBilinen(k) || c === null) throw new Error('kalem fiyatı ya da KDV oranı bilinmiyor');
  return (k.fiyatBirimi ?? VARSAYILAN_FIYAT_BIRIMI) === 'kdvHaric' || c === 1 ? k.price : altiHane(k.price / c);
}

/** Faturalı siparişin kalemine yazılan fiyat / tutar alanları (bkz. `kayitAlanlari`). */
export interface KalemKayitAlanlari {
  /** KDV HARİÇ net birim (ortak anlam). */
  price: number;
  /** Fiyatın GİRİLDİĞİ birim — oran değişince neyin sabit kalacağını belirler; kopya aynı çapayla açılır. */
  fiyatBirimi: FiyatBirimi;
  /** KDV dâhil girilende kullanıcının YAZDIĞI birim (net birimden geri hesaplanmaz: 6 ondalıklı net her zaman geri dönmez). */
  dahilFiyat?: number;
  /** Satır matrahı (kuruş) = kuruş(price × miktar). */
  netTutar: number;
  /** Satır KDV'si (kuruş) — fatura gövdesi bunu gönderir. KDV dâhil çapada dâhil tutar − matrah. */
  kdv: number;
}

/**
 * Faturalı siparişin KAYDA giden kalem alanları — pencere (yeni sipariş) ve düzenleme formu (oran değişimi) AYNI işlevden
 * yazar. Fiyat / oran bilinmiyorsa FIRLATIR (çağıran `kalemSorunu` / `siparisTutarlari` kapısından sonra çağırır).
 */
export function kayitAlanlari(k: TaslakKalem, oran: number): KalemKayitAlanlari {
  const t = satirTutarlari(k, oran);
  if (t === null || !fiyatBilinen(k)) throw new Error('kalem fiyatı ya da KDV oranı bilinmiyor');
  const capa = k.fiyatBirimi ?? VARSAYILAN_FIYAT_BIRIMI;
  return {
    price: kayitFiyati(k, oran), fiyatBirimi: capa,
    ...(capa === 'kdvDahil' ? { dahilFiyat: k.price } : {}),
    netTutar: t.haric, kdv: t.kdv,
  };
}

export type KalemSorunu = 'kalemYok' | 'fiyatEksik' | 'miktarGecersiz';

/** Kayıttan ÖNCE denetim: boş sipariş, fiyatı girilmemiş / geçersiz kalem, miktarı pozitif olmayan kalem kaydedilmez. */
export function kalemSorunu(kalemler: readonly TaslakKalem[]): KalemSorunu | null {
  if (kalemler.length === 0) return 'kalemYok';
  if (kalemler.some(k => !(typeof k.quantity === 'number' && Number.isFinite(k.quantity) && k.quantity > 0))) return 'miktarGecersiz';
  if (kalemler.some(k => !(typeof k.price === 'number' && Number.isFinite(k.price) && k.price > 0))) return 'fiyatEksik';
  return null;
}

/**
 * Fiyat kutusunun ham metni → fiyat. Boş / geçersiz / negatif → null (0 uydurulmaz).
 *   • Virgül ONDALIK ayraçtır; virgül varken noktalar BİNLİK ayraçtır: "1.250,50" → 1250,5.
 *   • Virgül yokken nokta ondalıktır ("12.5") — AMA "1.250" gibi tam üç haneli gruplar BELİRSİZDİR (bin iki yüz elli mi,
 *     bir lira yirmi beş kuruş mu): sessizce 1,25 okumak siparişi bin kat ucuza yazardı → null, kullanıcı virgülle yazar.
 *   • Yalnız düz ondalık yazım kabul edilir: `Number()`'ın kabul ettiği "1e3", "0x10", "Infinity" fiyat DEĞİLDİR.
 */
export function fiyatGirdisi(ham: string): number | null {
  let metin = ham.replace(/\s/g, '');
  if (metin === '') return null;
  if (metin.includes(',')) {
    const parcalar = metin.split(',');
    if (parcalar.length !== 2) return null;
    const [tam, ondalik] = parcalar;
    if (tam.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(tam)) return null;
    metin = `${tam.replace(/\./g, '')}.${ondalik}`;
  } else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(metin)) {
    return null;
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(metin)) return null;
  const n = Number(metin);
  return Number.isFinite(n) ? n : null;
}

/** Fiyat kademesinin ekran etiketi. Kademe ADI veridir (stok kartındaki `prices` anahtarı) — bilinmeyen kademe olduğu gibi basılır. */
export function fiyatKademesiEtiketi(kademe: string, tr: boolean): string {
  if (!tr) return kademe;
  const TR: Record<string, string> = { Retail: 'Perakende', Dealer: 'Bayi', 'B2B Standard': 'B2B Standart', 'B2B Premium': 'B2B Premium' };
  return TR[kademe] ?? kademe;
}

const bilinen = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * KAYITLI kalem → pencere taslağı (fiyat ÇAPA biriminde). Pencereden açılmış kalem çapasını taşır: KDV dâhil girilmişse
 * yazılan birim (`dahilFiyat`) ve 'kdvDahil'; değilse net birim ve 'kdvHaric'. Çapası olmayan (eski / başka kaynaklı) kalemde
 * `price` KDV hariç net birim sayılır. Fiyat çözülemiyorsa null.
 */
function kayitliCapa(k: OrderLineItem): { price: number; fiyatBirimi: FiyatBirimi } | null {
  if (k.fiyatBirimi === 'kdvDahil' && bilinen(k.dahilFiyat) && k.dahilFiyat > 0) return { price: k.dahilFiyat, fiyatBirimi: 'kdvDahil' };
  return bilinen(k.price) && k.price > 0 ? { price: k.price, fiyatBirimi: 'kdvHaric' } : null;
}

/** "Siparişi kopyala" ile pencereye giren kalem: yalnız KİMLİK alanları + ÇAPA birimiyle birim fiyat. */
export type KopyaKalemi = Pick<OrderLineItem, 'id' | 'sku' | 'name' | 'title' | 'quantity' | 'vatRate' | 'inventoryId' | 'variantId' | 'costPrice' | 'birim'>
  & { price: number | null; fiyatBirimi: FiyatBirimi };

/**
 * Kopyalanan siparişin kalemi → pencere kalemi.
 *   • Alanlar BEYAZ LİSTEYLE taşınır: tutar alanları (`netTutar` / `kdv` / `total` / `brutTutar` / `iskonto` / `masraf` /
 *     `netKaynagi` / `kalemSurumu`, çalışma anındaki tanı bayrakları) KAYNAK siparişin miktarına ve oranına aittir; kopyada
 *     miktar değişince bayat kalır — pencere kayıtta yeniden yazar.
 *   • KİMLİK her kopya kalemine YENİDEN üretilir: kopya yeni bir kalemdir ve Mikro faturasından türeyen kalemde `id` YOKTUR
 *     (eslemeFatura.mfKalemleri) — kaynaktan taşınsa bütün satırlar aynı kimliği alır, pencerenin kimlikle tuttuğu ham
 *     girdiler (fiyat / miktar kutusu) satırlar arasında karışırdı. Aynı kalemde `title` da yoktur → ad `name`'den.
 *   • Birim fiyat ve ÇAPASI: pencereden açılmış kalem KENDİ çapasıyla (`kayitliCapa` — KDV dâhil girilmişse yazılan birim:
 *     kopya dokunulmadan kaydedilirse kaynakla AYNI tutarı yazar); çapasız kalemde `price` KDV hariç net birim; `price` yoksa
 *     `netTutar ÷ miktar` (KDV hariç); o da yoksa `total ÷ miktar` — KDV DÂHİL çapayla (eski Mikro kalemi yalnız KDV dâhil
 *     `total` taşır). Hiçbiri yoksa null. Bölümden gelen birim 6 ondalıkta tutulur (100 ÷ 3 = 33,33 × 3 = 99,99 olmasın).
 */
export function kopyaKalemi(k: OrderLineItem): KopyaKalemi {
  const miktar = bilinen(k.quantity) && k.quantity > 0 ? k.quantity : null;
  const cozum: { price: number | null; fiyatBirimi: FiyatBirimi } =
    kayitliCapa(k)
    ?? (bilinen(k.netTutar) && k.netTutar > 0 && miktar !== null ? { price: altiHane(k.netTutar / miktar), fiyatBirimi: 'kdvHaric' }
      : bilinen(k.total) && k.total > 0 && miktar !== null ? { price: altiHane(k.total / miktar), fiyatBirimi: 'kdvDahil' }
      : { price: null, fiyatBirimi: 'kdvHaric' });
  return {
    id: crypto.randomUUID(), sku: k.sku, name: k.name, quantity: k.quantity,
    title: typeof k.title === 'string' && k.title !== '' ? k.title : k.name,
    ...(bilinen(k.vatRate) ? { vatRate: k.vatRate } : {}),
    ...(typeof k.inventoryId === 'string' ? { inventoryId: k.inventoryId } : {}),
    ...(typeof k.variantId === 'string' ? { variantId: k.variantId } : {}),
    ...(bilinen(k.costPrice) ? { costPrice: k.costPrice } : {}),
    ...(typeof k.birim === 'string' ? { birim: k.birim } : {}),
    price: cozum.price,
    fiyatBirimi: cozum.fiyatBirimi,
  };
}

/** Kayıtlı siparişin KDV oranı değişince yazılacaklar (düzenleme formu). */
export interface OranDegisimi { tutarlar: SiparisTutarlari; kalemler: OrderLineItem[] }

/** Kayıtlı kalemler → taslak (çapalarıyla); fiyatı / miktarı bilinmeyen ya da pozitif olmayan kalem varsa null. */
function kayitliTaslak(kalemler: readonly OrderLineItem[]): TaslakKalem[] | null {
  if (kalemler.length === 0) return null;
  const taslak: TaslakKalem[] = [];
  for (const k of kalemler) {
    const capa = kayitliCapa(k);
    if (capa === null || !bilinen(k.quantity) || k.quantity <= 0) return null;
    taslak.push({ id: k.id, quantity: k.quantity, ...capa });
  }
  return taslak;
}

/**
 * Kayıtlı kalemlerin YAZILMIŞ satır tutarlarından sipariş tutarları (Σ `netTutar`, Σ `kdv`). Herhangi bir kalemde satır
 * tutarı yoksa null. Düzenleme formu, kayıtlı başlık tutarının gerçekten kalemlerden türeyip türemediğini bununla doğrular
 * (önceki bir düzenlemede toplam ELLE yazıldıysa tutmaz).
 */
export function kayitliTutarlar(kalemler: readonly OrderLineItem[]): SiparisTutarlari | null {
  if (kalemler.length === 0) return null;
  let matrah = 0, kdv = 0;
  for (const k of kalemler) {
    if (!bilinen(k.netTutar) || !bilinen(k.kdv)) return null;
    matrah += k.netTutar; kdv += k.kdv;
  }
  const m = kurusaYuvarla(matrah), v = kurusaYuvarla(kdv);
  return { matrah: m, kdv: v, toplam: kurusaYuvarla(m + v) };
}

/**
 * Pencereden açılmış KAYITLI siparişte KDV ORANI değişince tutarlar ve kalemler — pencerenin kuralının AYNISI, aynı
 * işlevlerle (`siparisTutarlari` / `kayitAlanlari`): her kalem KENDİ çapasıyla yeniden hesaplanır.
 *   • KDV HARİÇ çapa → net birim değişmez: MATRAH sabit, KDV ve toplam yeni orandan;
 *   • KDV DÂHİL çapa → yazılan birim (`dahilFiyat`) değişmez: TOPLAM sabit, net birim ve matrah yeni orandan
 *     (yazılan birim kayıtlı olduğu için 6 ondalıklı netten geri hesap yok — kuruş oynamaz);
 *   • her kalemin `vatRate`'i yeni orana çekilir (Mikro sipariş gövdesi kalem oranını başlık oranından ÖNCE okur).
 * Kalem yoksa, bir kalemin fiyatı / miktarı bilinmiyorsa ya da oran geçersizse `null` — çağıran başlık yoluna düşer.
 */
export function oranDegisimi(kalemler: readonly OrderLineItem[], yeniOran: number): OranDegisimi | null {
  const taslak = kayitliTaslak(kalemler);
  const tutarlar = taslak === null ? null : siparisTutarlari(taslak, yeniOran);
  if (taslak === null || tutarlar === null) return null;
  return {
    tutarlar,
    kalemler: kalemler.map((k, i) => {
      // Eski `dahilFiyat` yeni çapaya ait değilse kalmasın (çapa hariç → alan yok).
      const { dahilFiyat: _eski, ...kalan } = k;
      return { ...kalan, ...kayitAlanlari(taslak[i], yeniOran), vatRate: yeniOran };
    }),
  };
}
