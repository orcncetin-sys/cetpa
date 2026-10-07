import { describe, it, expect } from 'vitest';
import { sevkiyatKovalari, slaOzeti, teslimSuresiGun, SLA_GUN } from './sevkiyatKartlari';

const BUGUN = '2026-10-02';
const gun = (n: number) => new Date(2026, 9, 2 - n, 10, 0, 0);   // yerel saat: bugün − n gün
const siparisler = [
  { id: 'p', status: 'Pending', createdAt: gun(1) },
  { id: 'h', status: 'Processing', createdAt: gun(2) },
  { id: 'k1', status: 'Shipped', createdAt: gun(0) },                              // bugün oluşturulup kargoya verilmiş
  { id: 'k2', status: 'Shipped', createdAt: gun(3) },
  { id: 'z', status: 'Delivered', createdAt: gun(10), deliveredAt: gun(5) },      // 5 gün → zamanında
  { id: 'g', status: 'Delivered', createdAt: gun(20), deliveredAt: gun(5) },      // 15 gün → gecikmeli
  { id: 's', status: 'Delivered', createdAt: gun(17), deliveredAt: gun(10) },     // tam 7 gün → zamanında (sınır dâhil)
  { id: 'mf', status: 'Delivered', createdAt: gun(3), syncedAt: gun(3) },         // Mikro faturası: teslim anı YOK
  { id: 'i', status: 'Cancelled', createdAt: gun(1) },
];
const idler = (x: Array<{ id: string }>) => x.map(o => o.id);

describe('sevkiyatKovalari — kart sayısı ile kartın açtığı liste AYNI kovadan', () => {
  const k = sevkiyatKovalari(siparisler, BUGUN);
  it('durum kovaları', () => {
    expect(idler(k.suren)).toEqual(['p', 'h', 'k1', 'k2']);          // teslim ve iptal hariç
    expect(idler(k.kargoda)).toEqual(['k1', 'k2']);
    expect(idler(k.bugun)).toEqual(['k1']);
    expect(idler(k.hazirlaniyor)).toEqual(['h']);
    expect(idler(k.teslim)).toEqual(['z', 'g', 's', 'mf']);
  });
  it('teslimat süresi GERÇEK teslim anından; teslim anı olmayan teslimat ne zamanında ne gecikmeli — ölçülemeyen', () => {
    expect(idler(k.zamaninda)).toEqual(['z', 's']);
    expect(idler(k.gecikmeli)).toEqual(['g']);
    expect(idler(k.olculemeyen)).toEqual(['mf']);
    expect(k.zamaninda.length + k.gecikmeli.length + k.olculemeyen.length).toBe(k.teslim.length);
  });
});

describe('teslimSuresiGun', () => {
  it('oluşturmadan teslime gün; eksik / okunamayan / ters sıralı an → null', () => {
    expect(teslimSuresiGun({ createdAt: gun(10), deliveredAt: gun(5) })).toBe(5);
    expect(teslimSuresiGun({ createdAt: gun(3), syncedAt: gun(3) })).toBeNull();          // eski şerit bunu "0 gün, zamanında" sayıyordu
    expect(teslimSuresiGun({ deliveredAt: gun(1) })).toBeNull();
    expect(teslimSuresiGun({ createdAt: 'bozuk', deliveredAt: gun(1) })).toBeNull();
    expect(teslimSuresiGun({ createdAt: gun(1), deliveredAt: gun(4) })).toBeNull();        // teslim, oluşturmadan önce
  });
});

describe('slaOzeti', () => {
  it('oran yalnız ÖLÇÜLEN teslimatlardan; ölçülemeyen ayrı sayılır', () => {
    const o = slaOzeti(sevkiyatKovalari(siparisler, BUGUN));
    expect(o).toMatchObject({ oran: 67, zamaninda: 2, gecikmeli: 1, olculen: 3, olculemeyen: 1 });
    expect(o.ortGun).toBeCloseTo((5 + 15 + 7) / 3, 6);
  });
  it('hiç ölçülen teslimat yoksa oran ve ortalama BİLİNMİYOR — 389 Mikro faturası "%100 zamanında" DEĞİLDİR', () => {
    const yalnizFatura = Array.from({ length: 389 }, (_, i) => ({ id: `mf${i}`, status: 'Delivered', createdAt: gun(3), syncedAt: gun(3) }));
    expect(slaOzeti(sevkiyatKovalari(yalnizFatura, BUGUN))).toEqual({ oran: null, zamaninda: 0, gecikmeli: 0, olculen: 0, olculemeyen: 389, ortGun: null });
  });
  it('eşik sabiti ekrandaki notla aynı', () => { expect(SLA_GUN).toBe(7); });
});
