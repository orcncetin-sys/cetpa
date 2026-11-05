import { describe, it, expect } from 'vitest';
import { riskSatirlari, riskToplamlari, riskSiralaKarsilastir, type RiskCarisi } from './riskSatirlari';

// Şartname «Mikro bağlantı A» A4 (2026-11-05): bakiye kaydı olmayan / sayı olmayan cari ₺0 sayılıp düşürülmez.
const CARILER: RiskCarisi[] = [
  { cariKod: '120.01', name: 'Belgesi yok', creditLimit: 0 },
  { cariKod: '120.02', name: 'Sayı değil', creditLimit: 0 },
  { cariKod: '120.03', name: 'Sıfır limitsiz', creditLimit: 0 },
  { cariKod: '120.04', name: 'Borçlu', creditLimit: 10000 },
  { cariKod: '120.05', name: 'Alacaklı', creditLimit: 0 },
  { cariKod: '120.06', name: 'Limitli sıfır', creditLimit: 5000 },
];
const BAKIYELER = new Map<string, number | null>([
  ['120.02', null],
  ['120.03', 0],
  ['120.04', 8000],
  ['120.05', -2500],
  ['120.06', 0],
]);

describe('riskSatirlari · bilinmeyen bakiye listede kalır', () => {
  const satirlar = riskSatirlari(CARILER, BAKIYELER);
  const bul = (kod: string) => satirlar.find(s => s.id === kod);

  it('belgesi OLMAYAN limitsiz cari listede kalır: `bakiyeBilinmiyor`, bakiye NaN, skor null', () => {
    expect(bul('120.01')).toMatchObject({ bakiyeBilinmiyor: true, riskScore: null });
    expect(Number.isNaN(bul('120.01')?.currentBalance)).toBe(true);
  });
  it('belgesi var ama bakiye sayı değil (null) → aynı', () => {
    expect(bul('120.02')).toMatchObject({ bakiyeBilinmiyor: true, riskScore: null });
  });
  it('bilinen 0 + limitsiz cari DÜŞER (bugünkü davranış); bilinen 0 + limitli cari kalır', () => {
    expect(bul('120.03')).toBeUndefined();
    expect(bul('120.06')).toMatchObject({ currentBalance: 0, riskScore: 0 });
  });
  it('bilinen bakiye: skor limit kullanım yüzdesi; limitsiz skor 0', () => {
    expect(bul('120.04')).toMatchObject({ currentBalance: 8000, riskScore: 80 });
    expect(bul('120.05')).toMatchObject({ currentBalance: -2500, riskScore: 0 });
    expect(bul('120.04')?.bakiyeBilinmiyor).toBeUndefined();
  });

  it('toplamlar bilinmeyeni KATMAZ: riskli bakiye yalnız pozitif bilinen (8000), yüksek risk 1, ortalama bilinenlerden; bilinmeyen 2', () => {
    expect(riskToplamlari(satirlar)).toEqual({ totalExposure: 8000, highRiskCount: 1, avgRiskScore: ((80 + 0 + 0) / 3).toFixed(1), bilinmeyen: 2 });
  });
  it('hepsi bilinmeyen → toplam 0, ortalama 0, bilinmeyen sayısı satır sayısı', () => {
    expect(riskToplamlari(riskSatirlari(CARILER.slice(0, 2), new Map()))).toEqual({ totalExposure: 0, highRiskCount: 0, avgRiskScore: 0, bilinmeyen: 2 });
  });

  it('sıralama: bilinmeyen satırlar iki yönde de SONDA', () => {
    const artan = [...satirlar].sort(riskSiralaKarsilastir('currentBalance', 'asc')).map(s => s.id);
    const azalan = [...satirlar].sort(riskSiralaKarsilastir('currentBalance', 'desc')).map(s => s.id);
    expect(artan.slice(0, 3)).toEqual(['120.05', '120.06', '120.04']);
    expect(azalan.slice(0, 3)).toEqual(['120.04', '120.06', '120.05']);
    expect(new Set(artan.slice(3))).toEqual(new Set(['120.01', '120.02']));
    expect(new Set(azalan.slice(3))).toEqual(new Set(['120.01', '120.02']));
  });
});
