import type { InventoryItem } from '../types';

/**
 * Stok kalemi maliyetinin TL karşılığı — ve çevrilemediğinde bunu SÖYLEYEN
 * yardımcılar.
 *
 * ## Neden böyle (2026-08-26 kullanıcı kararı)
 *
 * Eski hâli `raw * (rates[cur] ?? 1)` idi. Kur yoksa `?? 1` devreye giriyor ve
 * maliyeti $100 girilmiş bir ürün ₺100 sayılıyordu: maliyet ~40 KAT düşük,
 * dolayısıyla MARJ ŞİŞKİN görünüyordu. Aynı kusur `!rates` dalında da vardı.
 * Bu, CLAUDE.md'nin "sahte kesinlik gösterme" kuralının ihlaliydi.
 *
 * Kullanıcının verdiği kural:
 *   1. Kuru mümkünse otomatik çek (canlı kur; yoksa TCMB tarihsel arşivi).
 *   2. Hiç kur yoksa UYDURMA — "kur bulunamadı" de. Kur gelince kendiliğinden
 *      düzelsin (kalıcı bir işaret yazılmaz, her render yeniden değerlendirir).
 *   3. Para biriminin TÜRÜ bilinmiyorsa TL toplamına KARIŞTIRMA — ayrı bir
 *      "N/A" birimi olarak göster.
 *
 * ## Toplamlarda ne oluyor
 *
 * `itemCostTRY` çevrilemeyen kalem için **0** döner, yani o kalem toplama
 * KATILMAZ. Bu tek başına sessiz bir eksiltmedir — bu yüzden toplamı gösteren
 * her ekran `cevrilemeyenler()` ile kaç kalemin dışarıda kaldığını sorup
 * kullanıcıya BİLDİRMEK zorundadır. "Eksik ama eksikliği yazılı" > "dolu ama
 * yanlış".
 *
 * ## Tek kaynak
 *
 * Bu fonksiyonun eskiden ÜÇ kopyası vardı (burası,
 * `src/components/reports/useReportsData.ts`, `src/pages/OrdersPage.tsx`) ve
 * üçü de aynı hatayı taşıyordu. Diğer ikisi buraya yönlendirildi.
 */

/** Uygulamanın kur tablosunda karşılığı olabilecek para birimleri. */
const BILINEN_BIRIMLER = new Set(['TRY', 'USD', 'EUR']);

export type MaliyetDurum =
  /** TL cinsinden (ya zaten TL'ydi ya da kurla çevrildi). */
  | { durum: 'tl'; tl: number }
  /** Birim biliniyor ama KURU yok — kur gelince düzelir. */
  | { durum: 'kur-yok'; tutar: number; birim: string }
  /** Birim tanınmıyor (veri kirliliği / Mikro'dan gelen beklenmedik kod).
   *  TL toplamına karıştırılmaz, ayrı N/A olarak gösterilir. */
  | { durum: 'bilinmeyen-birim'; tutar: number; birim: string };

/** Ham maliyet değeri (para birimi ne olursa olsun). */
function hamMaliyet(item: InventoryItem): number {
  const v = item.costPrice ?? (item.cost as number | undefined);
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

/**
 * Kalemin maliyetini SINIFLANDIRIR. Toplama katmadan önce durumu bilmek
 * isteyen çağıranlar bunu kullanır.
 */
export function maliyetDurumu(
  item: InventoryItem,
  rates: Record<string, number> | null | undefined,
): MaliyetDurum {
  const raw = hamMaliyet(item);
  const cur = item.costCurrency;

  // Etiketsiz kayıt TL sayılır (geriye uyumluluk — App.tsx:441'deki karar).
  if (!cur || cur === 'TRY') return { durum: 'tl', tl: raw };

  if (!BILINEN_BIRIMLER.has(cur)) return { durum: 'bilinmeyen-birim', tutar: raw, birim: String(cur) };

  const kur = rates?.[cur];
  if (!kur || !isFinite(kur) || kur <= 0) return { durum: 'kur-yok', tutar: raw, birim: cur };

  return { durum: 'tl', tl: raw * kur };
}

/**
 * Kalemin maliyeti, TL cinsinden.
 *
 * ÇEVRİLEMİYORSA **0** döner — uydurma kur KULLANMAZ. Sıfır dönmesi "bu kalem
 * toplama katılmadı" demektir; toplamı gösteren ekran `cevrilemeyenler()` ile
 * bunu kullanıcıya bildirmelidir.
 */
export function itemCostTRY(
  item: InventoryItem,
  rates: Record<string, number> | null | undefined,
): number {
  const d = maliyetDurumu(item, rates);
  return d.durum === 'tl' ? d.tl : 0;
}

/**
 * Kalemin SATIS fiyati, TL cinsinden. Maliyet tarafiyla AYNI kural:
 * `priceCurrency` biliniyor ama kuru yoksa uydurma yapmaz, 0 doner (kalem
 * toplama katilmaz) ve `cevrilemeyenler()` bunu raporlar.
 *
 * Eskiden `raw * (rates[cur] ?? 1)` idi — $100 fiyat kur yokken ₺100
 * sayiliyordu; maliyet tarafiyla birlesince marj tamamen anlamsizlasiyordu.
 */
export function itemPriceTRY(
  item: InventoryItem,
  tier: string,
  rates: Record<string, number> | null | undefined,
): number {
  const ham = (item.prices?.[tier] as number | undefined)
    ?? (item as unknown as { price?: number }).price;
  const raw = typeof ham === 'number' && isFinite(ham) ? ham : 0;
  const cur = (item as unknown as { priceCurrency?: string }).priceCurrency;
  if (!cur || cur === 'TRY') return raw;
  if (!BILINEN_BIRIMLER.has(cur)) return 0;
  const kur = rates?.[cur];
  if (!kur || !isFinite(kur) || kur <= 0) return 0;
  return raw * kur;
}

export interface CevrilemeyenOzet {
  /** Kuru bulunamadığı için toplama katılmayan kalem sayısı. */
  kurYok: number;
  /** Para birimi tanınmayan kalemler — birim koduna göre adet. */
  na: Record<string, number>;
  /** kurYok + N/A toplamı; 0 ise uyarı gösterilmesine gerek yok. */
  toplam: number;
  /** Hangi para birimlerinin kuru eksik (kullanıcıya "USD kuru yok" demek için). */
  eksikBirimler: string[];
}

/**
 * Bir stok listesinde kaç kalemin maliyeti çevrilemedi?
 *
 * Maliyet-tabanlı bir toplam gösteren HER ekran bunu çağırıp `toplam > 0` ise
 * kullanıcıya bildirmeli. Aksi hâlde `itemCostTRY`nin 0 dönmesi sessiz bir
 * eksiltmeye dönüşür.
 */
export function cevrilemeyenler(
  items: readonly InventoryItem[],
  rates: Record<string, number> | null | undefined,
): CevrilemeyenOzet {
  let kurYok = 0;
  const na: Record<string, number> = {};
  const eksik = new Set<string>();
  for (const it of items) {
    const d = maliyetDurumu(it, rates);
    if (d.durum === 'kur-yok') { kurYok++; eksik.add(d.birim); }
    else if (d.durum === 'bilinmeyen-birim') na[d.birim] = (na[d.birim] ?? 0) + 1;
    // Fiyat tarafi ayri bir para biriminde olabilir (priceCurrency) ve o da
    // cevrilemiyorsa kalem yine eksik sayilir.
    const pc = (it as unknown as { priceCurrency?: string }).priceCurrency;
    if (pc && pc !== 'TRY') {
      if (!BILINEN_BIRIMLER.has(pc)) na[pc] = (na[pc] ?? 0) + 1;
      else { const k = rates?.[pc]; if (!k || !isFinite(k) || k <= 0) { kurYok++; eksik.add(pc); } }
    }
  }
  const naToplam = Object.values(na).reduce((s, n) => s + n, 0);
  return { kurYok, na, toplam: kurYok + naToplam, eksikBirimler: [...eksik].sort() };
}

/** Uyarı metni — `cevrilemeyenler()` sonucundan tek satırlık kullanıcı mesajı. */
export function cevrilemeyenMesaji(o: CevrilemeyenOzet, dil: 'tr' | 'en' = 'tr'): string | null {
  if (o.toplam === 0) return null;
  const p: string[] = [];
  if (o.kurYok > 0) {
    p.push(dil === 'tr'
      ? `${o.kurYok} kalem için ${o.eksikBirimler.join('/')} kuru bulunamadı`
      : `exchange rate missing for ${o.eksikBirimler.join('/')} on ${o.kurYok} item(s)`);
  }
  const naAdet = Object.values(o.na).reduce((s, n) => s + n, 0);
  if (naAdet > 0) {
    p.push(dil === 'tr'
      ? `${naAdet} kalem tanınmayan para biriminde (${Object.keys(o.na).join(', ')})`
      : `${naAdet} item(s) in unrecognised currency (${Object.keys(o.na).join(', ')})`);
  }
  return dil === 'tr'
    ? `${p.join(' · ')} — bu kalemler toplama DAHİL DEĞİL. Kur geldiğinde otomatik düzelir.`
    : `${p.join(' · ')} — these are EXCLUDED from the total. Resolves automatically once rates arrive.`;
}
