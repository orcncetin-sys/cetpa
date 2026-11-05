/**
 * riskSatirlari.ts: Risk paneli satırları ve KPI toplamları (şartname «Mikro bağlantı A» A4, 2026-11-05). Test: riskSatirlari.test.ts.
 * Tek çağıran: `components/RiskPanel.tsx` (test edilebilirlik için saf modül).
 *
 * NEDEN: panel bakiye kaydı OLMAYAN cariyi `cariBalances.get(kod) ?? 0` ile ₺0 sayıyor, ardından «bakiye 0 ve limit yok» süzgeciyle
 * listeden ve Toplam Riskli Bakiye'den DÜŞÜRÜYORDU; dinleyicideki `Number(x.bakiye ?? 0)` sayı olmayan bakiyeyi de 0'a çeviriyordu.
 * Canlı: `leads` 236, `cariBalances` 229 (17.10 sonrası açılan her cari için tekrar eder). Artık:
 *   • belge var + bilinen sayı → bakiye; belge var + sayı değil → `null`; belge yok → harita dışı. İkisi de `bakiyeBilinmiyor` satırı;
 *   • bilinmeyen satır listede KALIR (limit olmasa da), `currentBalance` NaN, `riskScore` null;
 *   • toplamlar (riskli bakiye, yüksek risk sayısı, ortalama skor, dağılım) bilinmeyeni KATMAZ, SAYAR (`bilinmeyen`);
 *   • bilinen 0 + limitsiz cari bugünkü gibi düşer.
 */
import { bilinenSayi } from '../para';

export interface RiskCarisi {
  cariKod: string;
  name: string;
  /** Kredi limiti; limit yoksa ya da okunamıyorsa skor hesaplanmaz (0). */
  creditLimit: number;
}

export interface RiskSatiri {
  id: string;
  customerName: string;
  /** Bakiye (TL); bilinmiyorsa NaN. Pozitif = müşteri Cetpa'ya borçlu. */
  currentBalance: number;
  creditLimit: number;
  /** Limit kullanım yüzdesi (0-100); bakiye bilinmiyorsa null. */
  riskScore: number | null;
  bakiyeBilinmiyor?: boolean;
  [key: string]: unknown;
}

/** Satırlar: her Mikro carisi için bir satır; bilinen 0 bakiyeli VE limitsiz cari düşer (bugünkü davranış). */
export function riskSatirlari(cariler: readonly RiskCarisi[], bakiyeler: ReadonlyMap<string, number | null>): RiskSatiri[] {
  return cariler.map((l): RiskSatiri => {
    const bakiye = bakiyeler.get(l.cariKod);
    const limitVar = Number.isFinite(l.creditLimit) && l.creditLimit > 0;
    if (bakiye === undefined || bakiye === null) {
      return { id: l.cariKod, customerName: l.name, currentBalance: Number.NaN, creditLimit: l.creditLimit, riskScore: null, bakiyeBilinmiyor: true };
    }
    // Limit yoksa skor hesaplanamaz: 0 (uydurma yok, bakiye yine listelenir).
    const score = limitVar ? Math.min(100, Math.max(0, Math.round((bakiye / l.creditLimit) * 100))) : 0;
    return { id: l.cariKod, customerName: l.name, currentBalance: bakiye, creditLimit: l.creditLimit, riskScore: score };
  }).filter(r => r.bakiyeBilinmiyor || r.currentBalance !== 0 || r.creditLimit > 0);
}

/** Satırın bakiyesi toplamlara girer mi (bilinmeyen ve geriye uyum dalının sayı olmayan bakiyesi girmez; `utils/para.bilinenSayi`). */
export const bakiyesiBilinir = (r: { currentBalance: unknown; bakiyeBilinmiyor?: boolean }): boolean =>
  !r.bakiyeBilinmiyor && bilinenSayi(r.currentBalance);

export interface RiskToplamlari {
  /** Yalnız POZİTİF bilinen bakiyeler (müşteri borcu). */
  totalExposure: number;
  highRiskCount: number;
  /** Bilinen satırların ortalama skoru (1 ondalık metin); bilinen satır yoksa 0. */
  avgRiskScore: string | 0;
  /** Bakiyesi bilinmeyen satır sayısı (toplamlara girmedi). */
  bilinmeyen: number;
}

export function riskToplamlari(satirlar: readonly { currentBalance: unknown; riskScore: unknown; bakiyeBilinmiyor?: boolean }[]): RiskToplamlari {
  const bilinen = satirlar.filter(bakiyesiBilinir);
  const totalExposure = bilinen.reduce((s, r) => s + Math.max(0, Number(r.currentBalance)), 0);
  const highRiskCount = bilinen.filter(r => Number(r.riskScore) > 70).length;
  const avgRiskScore = bilinen.length > 0 ? (bilinen.reduce((s, r) => s + Number(r.riskScore), 0) / bilinen.length).toFixed(1) : 0;
  return { totalExposure, highRiskCount, avgRiskScore, bilinmeyen: satirlar.length - bilinen.length };
}

/** Tablo sıralaması: bakiyesi bilinmeyen satırlar YÖNDEN BAĞIMSIZ sonda; öbürleri seçili sütuna göre. */
export function riskSiralaKarsilastir(anahtar: string, yon: 'asc' | 'desc') {
  const c = yon === 'asc' ? 1 : -1;
  const sayiAnahtar = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  return (a: RiskSatiri | Record<string, unknown>, b: RiskSatiri | Record<string, unknown>): number => {
    const ab = !bakiyesiBilinir(a as RiskSatiri), bb = !bakiyesiBilinir(b as RiskSatiri);
    if (ab !== bb) return ab ? 1 : -1;
    if (anahtar === 'customerName') return String(a.customerName ?? '').localeCompare(String(b.customerName ?? '')) * c;
    return (sayiAnahtar(a[anahtar]) - sayiAnahtar(b[anahtar])) * c;
  };
}
