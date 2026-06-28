// ── Fiyatlandırma Motoru ─────────────────────────────────────────────────────
// Saf (yan etkisiz) fonksiyonlar: maliyet + hedef marj + rakip fiyatlar →
// satış fiyatı önerileri; hedef satış fiyatı + marj → maksimum toptan alış fiyatı.
// Veri kaynağından (pazaryeri API / manuel) bağımsızdır.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Satış fiyatı üzerinden kâr marjı (%). margin = (sell - cost) / sell */
export function marginPct(cost: number, sell: number): number {
  if (sell <= 0) return 0;
  return round2(((sell - cost) / sell) * 100);
}

/** Maliyet üzerinden markup (%). markup = (sell - cost) / cost */
export function markupPct(cost: number, sell: number): number {
  if (cost <= 0) return 0;
  return round2(((sell - cost) / cost) * 100);
}

/** Hedef kâr marjından (satış üzerinden %) satış fiyatı. sell = cost / (1 - margin) */
export function sellFromMargin(cost: number, targetMarginPct: number): number {
  const m = Math.max(0, Math.min(99.9, targetMarginPct)) / 100;
  return round2(cost / (1 - m));
}

/** Hedef satış fiyatı + marj → ödenebilecek MAKSİMUM toptan alış fiyatı.
 *  maxCost = sell * (1 - margin) */
export function maxBuyPrice(targetSell: number, targetMarginPct: number): number {
  const m = Math.max(0, Math.min(99.9, targetMarginPct)) / 100;
  return round2(targetSell * (1 - m));
}

export interface CompetitorStat {
  count: number;
  min: number | null;
  avg: number | null;
  max: number | null;
  median: number | null;
}

export function competitorStats(prices: number[]): CompetitorStat {
  const p = (prices || []).filter(x => typeof x === 'number' && x > 0).sort((a, b) => a - b);
  if (p.length === 0) return { count: 0, min: null, avg: null, max: null, median: null };
  const sum = p.reduce((s, x) => s + x, 0);
  const mid = Math.floor(p.length / 2);
  const median = p.length % 2 ? p[mid] : (p[mid - 1] + p[mid]) / 2;
  return { count: p.length, min: p[0], avg: round2(sum / p.length), max: p[p.length - 1], median: round2(median) };
}

export interface PriceSuggestion {
  label: string;
  price: number;
  marginPct: number;   // bu fiyatta maliyete göre satış-marjı
  note: string;
}

export interface PricingResult {
  cost: number;
  targetMarginPct: number;
  marginBasedPrice: number;           // rakipten bağımsız, hedef marjla
  competitor: CompetitorStat;
  suggestions: PriceSuggestion[];     // rekabetçi konumlama önerileri
  maxBuyForMargin: number | null;     // rakip min'i hedef satış kabul edersek maks alış
}

/**
 * Önerileri üretir:
 *  - Hedef marj fiyatı (rakipten bağımsız taban)
 *  - Rakip varsa: min'in %2 altı (agresif), ortalama (eşle), max'ın %3 üstü (premium)
 *  Her öneri için o fiyattaki gerçek marjı da döner (maliyet altına düşerse uyarır).
 */
export function suggestPricing(cost: number, targetMarginPct: number, competitorPrices: number[] = []): PricingResult {
  const c = Math.max(0, Number(cost) || 0);
  const stat = competitorStats(competitorPrices);
  const marginBasedPrice = sellFromMargin(c, targetMarginPct);

  const suggestions: PriceSuggestion[] = [];
  suggestions.push({
    label: 'Hedef marj',
    price: marginBasedPrice,
    marginPct: marginPct(c, marginBasedPrice),
    note: `Maliyet + %${targetMarginPct} marj (rakipten bağımsız)`,
  });

  if (stat.min != null) {
    const undercut = round2(stat.min * 0.98);
    suggestions.push({
      label: 'Agresif (min %2 altı)',
      price: undercut,
      marginPct: marginPct(c, undercut),
      note: undercut < c ? '⚠️ Maliyetin altında — zarar' : 'En düşük rakibin altında konumlan',
    });
  }
  if (stat.avg != null) {
    suggestions.push({
      label: 'Piyasa ortalaması',
      price: stat.avg,
      marginPct: marginPct(c, stat.avg),
      note: stat.avg < c ? '⚠️ Maliyetin altında' : 'Ortalama ile eşle',
    });
  }
  if (stat.max != null) {
    const premium = round2(stat.max * 1.03);
    suggestions.push({
      label: 'Premium (max %3 üstü)',
      price: premium,
      marginPct: marginPct(c, premium),
      note: 'Üst segment / farklılaşma',
    });
  }

  // Rakip min fiyatını hedef satış kabul edersek, hedef marjı korumak için maks alış:
  const maxBuyForMargin = stat.min != null ? maxBuyPrice(stat.min, targetMarginPct) : null;

  return { cost: c, targetMarginPct, marginBasedPrice, competitor: stat, suggestions, maxBuyForMargin };
}
