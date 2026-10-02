/** yetimRaporu — Cetpa'daki fatura kopyaları ↔ Mikro'nun güncel GUID kümesi (fatura 389 ölçümü, 2026-10-02). */
import { describe, it, expect } from 'vitest';
import { yetimRaporu, guidAnahtari, guidBicimli, iptalMi, type CetpaFatura } from './faturaTani';

const G = (n: number) => `AAAAAAAA-0000-0000-0000-${String(n).padStart(12, '0')}`;
const c = (n: number, o: Partial<CetpaFatura> = {}): CetpaFatura => ({
  id: G(n), companyId: 'K1', seri: '', sira: String(n), tip: '0', tarih: `2026-09-${String(n).padStart(2, '0')}T00:00:00`, meblag: '100', guncelleme: null, ...o,
});

describe('yetimRaporu', () => {
  it('Mikro\'da kaydı olmayan kopya YETİM; iptal bayraklı olan iptalKalan; ikisi de geçerliyse temiz', () => {
    const r = yetimRaporu([c(1), c(2), c(3)], [{ guid: G(1), iptal: false }, { guid: G(3), iptal: true }]);
    expect(r).toMatchObject({ cetpaAdet: 3, mikroAdet: 2, mikroIptalAdet: 1, yetimAdet: 1, iptalKalanAdet: 1, cetpadaEksikAdet: 0 });
    expect(r.yetim.map(f => f.sira)).toEqual(['2']);
    expect(r.iptalKalan.map(f => f.sira)).toEqual(['3']);
  });
  it('GUID harf büyüklüğü / süslü parantez farkı yetim SAYILMAZ, ayrı sayılır (süpürge `id = GUID` ile arar)', () => {
    const r = yetimRaporu([c(1), c(2)], [{ guid: G(1).toLowerCase(), iptal: 0 }, { guid: `{${G(2)}}`, iptal: '0' }]);
    expect(r.yetimAdet).toBe(0);
    expect(r.yazimFarkiAdet).toBe(2);
  });
  it('Mikro\'da iptalsiz olup Cetpa\'da olmayan sayılır; iptal olan "eksik" sayılmaz', () => {
    const r = yetimRaporu([c(1)], [{ guid: G(1), iptal: 0 }, { guid: G(7), iptal: 0 }, { guid: G(8), iptal: 1 }]);
    expect(r.cetpadaEksikAdet).toBe(1);
    expect(r.mikroIptalAdet).toBe(1);
  });
  it('liste en yeni tarihten, sınırla kesilir; adet tam kalır; kiracı kırılımı (etiketsiz ayrı)', () => {
    const r = yetimRaporu([c(1), c(5), c(3, { companyId: null })], [], 2);
    expect(r.yetimAdet).toBe(3);
    expect(r.yetim.map(f => f.sira)).toEqual(['5', '3']);
    expect(r.kiracilar).toEqual({ K1: 2, '(etiketsiz)': 1 });
  });
});

describe('yardımcılar', () => {
  it('iptalMi: boolean / sayı / metin; boş ve null iptal DEĞİL', () => {
    for (const v of [true, 1, '1', 'true', 2]) expect(iptalMi(v)).toBe(true);
    for (const v of [false, 0, '0', null, undefined, '', 'false']) expect(iptalMi(v)).toBe(false);
  });
  it('guidAnahtari / guidBicimli', () => {
    expect(guidAnahtari(` {${G(1)}} `)).toBe(G(1).toLowerCase());
    expect(guidBicimli(G(1))).toBe(true);
    expect(guidBicimli(`${G(1)}' OR 1=1 --`)).toBe(false);
    expect(guidBicimli(null)).toBe(false);
  });
});
