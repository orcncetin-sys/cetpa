/**
 * raporMarj.ts — Raporlar'ın brüt marj/kâr hesabının TEK kaynağı (Faz 3 5/n düzeltici turu,
 * 2026-09-19). Test: `raporMarj.test.ts` (önce yazıldı, kırmızı görüldü).
 * Saf modül: React/DB/kur/kullanıcı metni yok — kur çevrimi çağıranın `birimMaliyet` seçicisinde.
 *
 * ## NEDEN VAR — `useReportsData.brutMarj` içindeki üç sahte kesinlik
 *
 *  1. **Ciro/maliyet asimetrisi (satır ~329).** Ciro tarafı `ekranTutari` ile tutarı okunamayan
 *     siparişi DIŞLIYOR, maliyet tarafı ise `kapsamli.reduce(...)` ile AYNI siparişin kalem
 *     maliyetini toplamaya devam ediyordu. `ciro − maliyet` yazan tüketiciler (IKRapor:631
 *     "Çalışan Başı Brüt Kâr", GenelBloklar2:249 marj köprüsü) kısmi cirodan TAM maliyeti
 *     çıkarıp brüt kâr üretiyordu — ₺50.000'lik tek bir tutarsız sipariş "Brüt Kâr / Maaş
 *     Kütlesi" rozetini 2,1× yeşilden 1,9× sarıya düşürebiliyordu. IKRapor'un "brüt kâr bu
 *     kayıtları İÇERMEZ" notu da yanlıştı: maliyetleri içerideydi.
 *
 *  2. **%60 uydurma maliyet oranı (satır ~335).** `inv ? itemCostTRY(inv, rates) : li.price * 0.6`
 *     — katalogda eşleşmeyen kaleme hiçbir veriye dayanmayan sabit oran. "Nakliye bedeli ₺5.000"
 *     satırı ₺3.000 maliyet sayılıp kesin bir %40 marj basılıyordu.
 *
 *  3. **`itemCostTRY` 0 döner.** Kuru çevrilemeyen (ya da kartında maliyet hiç girilmemiş) kalem
 *     için 0 döndüğü cost.ts'te belgelidir; burada o 0 "bedelsiz kalem" sayılıp marjı şişiriyordu.
 *
 * (2) ve (3) Pano'nun Phase 124 "Segment Kârlılığı" panelinde zaten kaldırılmıştı: aynı sipariş
 * Pano'da '— marj', Raporlar'da "%40" gösteriyordu (yarım düzeltme sınıfı). Kural artık tek yerde.
 *
 * ## SÖZLEŞME (src/utils/para.ts — İKİ SÖZLEŞME, KARIŞTIRMA)
 *   • `ciro` / `maliyet` / `toplamCiro` **EKRAN** toplamıdır: bilinenlerin kısmi toplamı, yanında
 *     `*Tutar.bilinmeyen` sayacı ("N kayıt tutarsız"). Hiç bilinen yoksa NaN → '—'.
 *   • `brutKar` / `marj` **TÜRETME**dir: ciro ya da maliyet tarafında TEK bilinmeyen bile varsa
 *     hesaplanmaz (NaN / null). Yüzde çubuğu ve renk rozeti o hâlde ÇİZİLMEZ.
 *
 * ## PARİTE
 * Tüm kalemleri katalogda eşleşen, maliyeti ve başlık tutarı bilinen siparişlerde ciro, maliyet,
 * kâr ve marj eski reduce'ların verdiği sayının AYNISIDIR.
 *
 * ## BİLİNÇLİ FARKLAR
 *  1. **Kalemin KENDİ `costPrice`'ı öncelikli.** Eski `brutMarj` bu alanı hiç okumuyor, her zaman
 *     bugünkü stok kartına bakıyordu; Pano'nun Phase 124 paneli ise `siparisKarliligi` üzerinden
 *     kalemin kendi maliyetini önce okuyor (`utils/siparisler/siparisKarlilik.ts`). Aynı siparişin
 *     iki ekranda farklı marj vermesinin ikinci kaynağı buydu. Satışın ANINDAKİ maliyet, kartın
 *     bugünkü maliyetinden daha doğrudur; kural artık iki ekranda da aynı. Meşru ₺0 (promosyon /
 *     numune satırı) burada BİLİNEN maliyettir — kataloğa düşürülmez.
 *  2. **Maliyeti çözülemeyen sipariş `maliyet` toplamına GİRMEZ, SAYILIR.** Eski kod eksik kalemi
 *     %60 oranı ya da 0 ile doldurduğu için toplam hep "dolu" görünüyordu. `maliyet` artık kısmi
 *     bir EKRAN toplamıdır ve `maliyetTutar.bilinmeyen` ekrana YAZILMALIDIR (DIO/COGS tüketicileri).
 */
import { toplaBilinen, ekranTutari, tamTutar, siparisMaliyeti, bilinenSayi, type Tutar } from '../para';
import { raporSiparisi, type RaporSiparisi } from './raporVeriKatmani';

/** Sipariş kalemi — yapısal (kanonik `OrderLineItem` ve rapor türevleri uyar). */
export interface MarjSatiri {
  inventoryId?: unknown;
  name?: unknown;
  price?: unknown;
  quantity?: unknown;
  /** Kalemin KENDİ birim maliyeti; varsa katalog aranmaz (meşru ₺0 dahil). */
  costPrice?: unknown;
}

/** Marj hesabına giren sipariş — tutar alanları `raporSiparisi` ile okunur (`totalPrice ?? totalAmount`). */
export interface MarjSiparisi extends RaporSiparisi {
  lineItems?: readonly MarjSatiri[] | null;
}

/**
 * Kalemin birim maliyetini çözen fonksiyon. **Bilinmiyorsa `null`/`NaN` dönmeli** — 0
 * "bedelsiz" demektir, "bilinmiyor" değil (bkz. `cost.kartMaliyetiTL` ↔ `cost.itemCostTRY`).
 */
export type KalemMaliyetCozucu = (satir: MarjSatiri) => number | null;

/** Eşleştirme anahtarı: yalnız DOLU metin. Boş/boşluk/metin olmayan → null (anahtar yok). */
function anahtar(x: unknown): string | null {
  return typeof x === 'string' && x.trim() !== '' ? x : null;
}

/**
 * Kalem → stok KARTI eşleşmesi (maliyetten bağımsız; 6a, 2026-09-19'da `stokMaliyetCozucu`
 * gövdesinden buraya çıkarıldı — `rapor/stokTalep.talepKartCozucu` ad-yedeği için AYNI kuralı
 * kullanmalıydı, kopyalamak eşleme kuralını ikinci kez çatallandırırdı). `stokMaliyetCozucu`
 * artık bunu çağırır; imzası ve `raporMarj.test.ts` vakaları AYNEN korundu.
 *
 * BOŞ ANAHTAR EŞLEŞMEZ: eski `inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name)`
 * kuralı `'' === ''` (ve `undefined === undefined`) olduğu için serbest satırı ("Nakliye bedeli",
 * kanal siparişi kalemi) katalogdaki adsız İLK karta bağlıyor, o ilgisiz kartın maliyetini
 * "bilinen maliyet" sayıyordu. OR sırası (önce kimlik, sonra ad) parite için korundu: eşleşme,
 * liste sırasında kimliği YA DA adı tutan İLK karttır — kimliğe öncelik vermek davranış
 * değişikliği olurdu.
 */
export function stokKartiCozucu<K extends { id?: unknown; name?: unknown }>(
  kartlar: readonly K[],
): (satir: MarjSatiri) => K | null {
  return (satir) => {
    const kimlik = anahtar(satir.inventoryId);
    const ad = anahtar(satir.name);
    if (kimlik === null && ad === null) return null;
    return kartlar.find(k =>
      (kimlik !== null && anahtar(k.id) === kimlik) ||
      (ad !== null && anahtar(k.name) === ad),
    ) ?? null;
  };
}

/**
 * Kalem → BİRİM MALİYET çözücüsü: kalemin kendi `costPrice`'ı öncelikli, yoksa `stokKartiCozucu`
 * ile bulunan kartın maliyeti. Eşleşme kuralı için yukarıya bak (boş anahtar eşleşmez).
 *
 * `birimMaliyet` kur çevrimini yapan çağırandan gelir (`kartMaliyetiTL(kart, rates)`);
 * `itemCostTRY` DOĞRUDAN geçilmemeli — çevrilemeyen kaleme 0 döndürür.
 */
export function stokMaliyetCozucu<K extends { id?: unknown; name?: unknown }>(
  kartlar: readonly K[],
  birimMaliyet: (k: K) => number | null,
): KalemMaliyetCozucu {
  const kartCozucu = stokKartiCozucu(kartlar);
  return (satir) => {
    if (bilinenSayi(satir.costPrice)) return Number(satir.costPrice);
    const kart = kartCozucu(satir);
    return kart ? birimMaliyet(kart) : null;
  };
}

export interface BrutMarjSonucu {
  /** EKRAN cirosu — marj KAPSAMINDAKİ (kalemi olan) siparişlerin kısmi toplamı. */
  ciro: number;
  /** EKRAN maliyeti — maliyeti BİLİNEN siparişlerin kısmi toplamı (DIO gibi tüketiciler için). */
  maliyet: number;
  /** TÜRETME: ciro ve maliyetin İKİSİ de tam biliniyorsa fark, aksi hâlde NaN ('—'). */
  brutKar: number;
  /** Ham marj yüzdesi (yuvarlanmış). null = hesaplanamaz → çubuk/rozet ÇİZİLMEZ. */
  marj: number | null;
  /** Kalem verisi hiç olmayan (Mikro faturasından türetilen / sentetik) sipariş sayısı. */
  kapsamDisi: number;
  /**
   * Karta basılacak BENZERSİZ sayaç: kapsamdaki siparişlerden kaçının tutarı YA DA maliyeti
   * okunamadı. `ciroTutar.bilinmeyen + maliyetTutar.bilinmeyen` TOPLANMAZ — iki sayaç aynı
   * `kapsamli` kümesinden çıkar ve KESİŞİR (tutarı da maliyeti de okunamayan tek sipariş
   * "2 sipariş" diye raporlanır). `finansKpi.nakitPozisyonu.tutarsizKayit` ile aynı kural.
   */
  tutarsizSiparis: number;
  /** EKRAN cirosu — TÜM siparişler (kapsam dışındakiler dahil). */
  toplamCiro: number;
  ciroTutar: Tutar;
  toplamCiroTutar: Tutar;
  /** Maliyet toplamı + `bilinmeyen` sayacı: kaç siparişin maliyeti çözülemedi. */
  maliyetTutar: Tutar;
}

/**
 * Brüt marj / kâr. `kalemMaliyeti` bilinmeyeni `null`/`NaN` ile bildirmeli.
 *
 * Siparişin maliyeti `para.siparisMaliyeti` ile hesaplanır — COGS'un TEK KAYNAĞI: tek kalemin
 * birim maliyeti ya da miktarı bilinmiyorsa SİPARİŞİN maliyeti bilinmez (kısmi COGS, eksik
 * maliyet kadar uydurma kârdır) ve sipariş `maliyetTutar.bilinmeyen`e düşer.
 */
export function brutMarjHesabi(
  list: readonly MarjSiparisi[],
  kalemMaliyeti: KalemMaliyetCozucu,
): BrutMarjSonucu {
  const toplamCiroTutar = toplaBilinen(list, raporSiparisi);
  const kapsamli = list.filter(o => (o.lineItems ?? []).length > 0);
  const kapsamDisi = list.length - kapsamli.length;

  const ciroTutar = toplaBilinen(kapsamli, raporSiparisi);
  // Siparişin maliyeti BİR KEZ hesaplanır: hem `maliyetTutar` hem benzersiz sayaç aynı sayıyı
  // okur (iki ayrı geçiş, kalem çözücüsünü sipariş başına iki kez çağırırdı).
  const maliyetler = kapsamli.map(o =>
    siparisMaliyeti({ lineItems: (o.lineItems ?? []).map(s => ({ costPrice: kalemMaliyeti(s), quantity: s.quantity })) }),
  );
  const maliyetTutar = toplaBilinen(maliyetler, m => m);
  // Benzersiz sayaç: kesişen iki kümeyi TOPLAMAK tek kaydı iki kez raporlardı (bkz. `tutarsizSiparis`).
  let tutarsizSiparis = 0;
  for (let i = 0; i < kapsamli.length; i++) {
    if (!Number.isFinite(raporSiparisi(kapsamli[i])) || !Number.isFinite(maliyetler[i])) tutarsizSiparis++;
  }

  // TÜRETME kapısı: iki taraf da TAM bilinmeli (kısmi cirodan tam maliyeti çıkarmak,
  // dışlanan siparişlerin maliyeti kadar uydurma zarardır — asimetrinin ta kendisi).
  const ciroTam = tamTutar(ciroTutar);
  const maliyetTam = tamTutar(maliyetTutar);
  const brutKar = Number.isFinite(ciroTam) && Number.isFinite(maliyetTam) ? ciroTam - maliyetTam : NaN;
  const marj = Number.isFinite(brutKar) && ciroTam > 0 ? Math.round((brutKar / ciroTam) * 100) : null;

  return {
    ciro: ekranTutari(ciroTutar),
    maliyet: ekranTutari(maliyetTutar),
    brutKar,
    marj,
    kapsamDisi,
    tutarsizSiparis,
    toplamCiro: ekranTutari(toplamCiroTutar),
    ciroTutar,
    toplamCiroTutar,
    maliyetTutar,
  };
}

/** DIO neden hesaplanamadı — ekran TEK nedeni yazar ('—' açıklamasız kalmasın, yanlış neden de basılmasın). */
export type DioNedeni = 'maliyet-bilinmiyor' | 'kalemsiz-siparis' | 'maliyetli-siparis-yok' | 'stok-bilinmiyor' | null;

/**
 * Stok Devir Günü (DIO) = stok değeri / günlük COGS — TÜRETİLEN sayı: paydası eksikse HESAPLANMAZ.
 *
 * ## NEDEN VAR (2026-09-19 son inceleme)
 *
 * GenelOzet DIO'yu satır içinde üretiyordu ve kapısı yalnız `maliyetTutar.bilinmeyen`i görüyordu.
 * Oysa `brutMarjHesabi` KALEMSİZ siparişi (Mikro giden faturasından ekranda türetilen sözde sipariş —
 * RaporlarPage onları `lineItems` olmadan listeye ekler) `maliyetTutar`a HİÇ sokmaz; ayrı `kapsamDisi`
 * sayacına yazar. Marjda bu tutarlıdır (pay ve payda aynı `kapsamli` kümeden). DIO'da DEĞİL: pay TÜM
 * stoktur, payda yalnız kalemli kümenin COGS'u. 300 kalemsiz fatura + COGS'u ₺200K olan 10 sipariş +
 * ₺3M stok → "1350 gün, nakit sıkışıklığı riski var" (gerçek ≈ 39 gün). Kalemsiz TEK sipariş bile
 * COGS'u eksik bırakır → `null`.
 *
 * `stokDegeri` çağıranın sorumluluğundadır (bilinmiyorsa NaN geçilir → `null`).
 */
export function stokDevirGunu(
  stokDegeri: number,
  marj: Pick<BrutMarjSonucu, 'maliyetTutar' | 'kapsamDisi'>,
  gunSayisi: number,
): { dio: number | null; neden: DioNedeni } {
  if (marj.maliyetTutar.bilinmeyen > 0) return { dio: null, neden: 'maliyet-bilinmiyor' };
  if (marj.kapsamDisi > 0) return { dio: null, neden: 'kalemsiz-siparis' };
  const cogs = tamTutar(marj.maliyetTutar);
  if (!Number.isFinite(cogs) || cogs <= 0 || !Number.isFinite(gunSayisi) || gunSayisi <= 0) return { dio: null, neden: 'maliyetli-siparis-yok' };
  if (!Number.isFinite(stokDegeri)) return { dio: null, neden: 'stok-bilinmiyor' };
  return { dio: Math.round(stokDegeri / (cogs / gunSayisi)), neden: null };
}
