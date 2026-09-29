/**
 * faturaMatrahi.ts — Mikro fatura MATRAHININ tek kaynağı (2026-09-28). Hem JS okuyucular (Cari Ekstre) hem SQL üreticileri
 * (fatura-listesi importu, KDV özeti) BURADAN türer; kural başka yerde yeniden yazılmaz.
 *
 * ÖLÇÜLEN TANIM (canlı `GET /api/mikro/matrah-tani`, 700 fatura başlığı — şartname `faz3-2n-specs/matrah-2026-09-28`):
 *   • sth_tutar BRÜT; KDV (sth_tutar − Σsth_iskonto) üzerinden; cha_meblag = Σ(tutar − Σisk) + Σvergi → 693/700.
 *   • cha_aratoplam BRÜT (Σsth_tutar) — 18/18 ayırt edici fatura.
 *   • Σcha_ft_iskonto1..6 = Σ satır iskontosu — 18/18.
 *   ⇒ MATRAH = cha_aratoplam − Σcha_ft_iskonto  (başlıktan; satırsız faturada ve aynı numaralı iki başlıkta da doğru — satır
 *     JOIN'i ikincisinde matrah/KDV'yi ÇİFT yazıyordu: giden 246). Satırdan: Σ(sth_tutar − Σsth_iskonto + Σsth_masraf).
 * Masraf (KDVK md. 24/b matraha girer): satır formülü ekler; başlık formülü ölçülmedi (masraflı fatura 0) — masraf görülürse
 * import sağlaması (matrah + KDV ≠ meblağ) yüksek sesle sayar.
 *
 * Kolon adı TAHMİN EDİLMEZ: SQL üreticileri kolonları çağıranın verdiği GERÇEK şemadan (mikroKolonlar) alır, katı aile
 * desenleriyle süzer ve gerçek yazımıyla (Türkçe harmanlama) yazar. Yalnız ASCII SQL üretir.
 */
import { bilinenSayi } from '../utils/para.js';

/** Başlık fatura altı iskonto aileleri (TUTAR). `cha_isk_mas*` bayrakları eşleşmez. */
export const FT_ISKONTO_DESENI = /^cha_ft_iskonto\d+$/i;
/** Satır iskonto tutarları. `sth_isk_mas*` bayrakları eşleşmez. */
export const SATIR_ISKONTO_DESENI = /^sth_iskonto\d+$/i;
/** Satır masraf tutarları. `sth_masraf_vergi` / `sth_masraf_vergi_pntr` eşleşmez. */
export const SATIR_MASRAF_DESENI = /^sth_masraf\d+$/i;

/**
 * Başlıktan matrah (JS): `cha_aratoplam − Σcha_ft_iskonto<N>`. BİLİNMİYOR (null): aratoplam okunamadı, dokümanda HİÇ ft alanı yok
 * (eski doküman / başka kurulum — brüte düşmek sahte kesinlik olurdu) ya da var olan bir ft alanı okunamadı (bilinmeyen ≠ 0).
 */
export function baslikMatrahi(d: Readonly<Record<string, unknown>>): number | null {
  if (!bilinenSayi(d.cha_aratoplam)) return null;
  let ft = 0, alan = 0;
  for (const [k, v] of Object.entries(d)) {
    if (!FT_ISKONTO_DESENI.test(k)) continue;
    alan++;
    if (!bilinenSayi(v)) return null;
    ft += Number(v);
  }
  return alan === 0 ? null : Number(d.cha_aratoplam) - ft;
}

/**
 * Sağlama payı (matrah + KDV ≈ meblağ): YALNIZ yuvarlamaya bağlı — 0,06 taban + satır başına 0,02 (tutar ve KDV her satırda ayrı
 * yuvarlanır). Oransal pay YOK (matrah-tani incelemesi 2026-09-28: binde yarım 600.000 ₺'lik faturada 300 ₺ edip iskontoyu yutuyordu).
 * JS ve SQL aynı sabitlerden türer.
 */
export const SAGLAMA_PAYI = { taban: 0.06, satirBasi: 0.02 } as const;
export const saglamaPayi = (satirSayisi: number | null | undefined): number =>
  SAGLAMA_PAYI.taban + SAGLAMA_PAYI.satirBasi * Math.max(1, satirSayisi ?? 1);
/** SQL karşılığı: `satirIfadesi` NULL/0 ise 1 satır sayılır. */
export const saglamaPayiSql = (satirIfadesi: string): string =>
  `(${SAGLAMA_PAYI.taban} + ${SAGLAMA_PAYI.satirBasi} * (CASE WHEN ISNULL(${satirIfadesi}, 0) < 1 THEN 1 ELSE ${satirIfadesi} END))`;

export const gercekAd = (kolonlar: readonly string[], ad: string): string | null => kolonlar.find(k => k.toLowerCase() === ad.toLowerCase()) ?? null;
const topla = (kolonlar: readonly string[], on: string) => kolonlar.map(k => `ISNULL(${on}${k}, 0)`).join(' + ');

/**
 * Başlık matrahı SQL ifadesi: `(cha.cha_aratoplam - (ISNULL(cha.cha_ft_iskonto1, 0) + ...))`. Şemada cha_aratoplam YOKSA ya da HİÇ
 * ft kolonu yoksa null (çağıran satır formülüne düşer — brüt aratoplam matrah diye YAZILMAZ).
 */
export function baslikMatrahSql(chaKolonlari: readonly string[], on = 'cha.'): string | null {
  const aratoplam = gercekAd(chaKolonlari, 'cha_aratoplam');
  const ft = chaKolonlari.filter(k => FT_ISKONTO_DESENI.test(k));
  if (!aratoplam || ft.length === 0) return null;
  return `(${on}${aratoplam} - (${topla(ft, on)}))`;
}

export interface SatirNetSql {
  /** Satır başına net ifadesi (SUM içine konur): `sth_tutar - (isk...) + (masraf...)`. */
  ifade: string;
  iskonto: string[];
  masraf: string[];
}
/**
 * Satır neti SQL ifadesi (satır başına; çağıran SUM'a sarar): `tutar − Σiskonto + Σmasraf`. Şemada sth_tutar YOKSA null. İskonto /
 * masraf ailesi yoksa o parça eklenmez (şema OKUNMUŞ ve aile gerçekten yok demektir — okunamayan şemayı çağıran ayırır).
 */
export function satirNetSql(sthKolonlari: readonly string[], on = ''): SatirNetSql | null {
  const tutar = gercekAd(sthKolonlari, 'sth_tutar');
  if (!tutar) return null;
  const iskonto = sthKolonlari.filter(k => SATIR_ISKONTO_DESENI.test(k));
  const masraf = sthKolonlari.filter(k => SATIR_MASRAF_DESENI.test(k));
  const ifade = `${on}${tutar}${iskonto.length ? ` - (${topla(iskonto, on)})` : ''}${masraf.length ? ` + (${topla(masraf, on)})` : ''}`;
  return { ifade, iskonto, masraf };
}
