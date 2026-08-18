import { describe, it, expect } from 'vitest';
import { huniAsamasi, adayYasiGun, HUNI_ESIK_GUN } from './huni';

const SIMDI = new Date('2026-08-18T12:00:00Z').getTime();
const gunOnce = (n: number) => new Date(SIMDI - n * 86_400_000).toISOString();

describe('huniAsamasi — yaş tabanlı aşama', () => {
  it('0-30 gün arası aday Yeni', () => {
    for (const g of [0, 1, 15, 29]) {
      expect(huniAsamasi({ createdAt: gunOnce(g) }, SIMDI)).toBe('New');
    }
  });

  it('30-60 gün arası aday Nitelikli', () => {
    for (const g of [30, 45, 59]) {
      expect(huniAsamasi({ createdAt: gunOnce(g) }, SIMDI)).toBe('Qualified');
    }
  });

  it('60-90 gün arası aday İrtibat', () => {
    for (const g of [60, 75, 89]) {
      expect(huniAsamasi({ createdAt: gunOnce(g) }, SIMDI)).toBe('Contacted');
    }
  });

  it('90+ gün aday Kapandı', () => {
    for (const g of [90, 120, 400]) {
      expect(huniAsamasi({ createdAt: gunOnce(g) }, SIMDI)).toBe('Closed');
    }
  });

  it('sınır günleri tam eşikte üst kutuya geçer', () => {
    expect(huniAsamasi({ createdAt: gunOnce(HUNI_ESIK_GUN.nitelikli - 1) }, SIMDI)).toBe('New');
    expect(huniAsamasi({ createdAt: gunOnce(HUNI_ESIK_GUN.nitelikli) }, SIMDI)).toBe('Qualified');
    expect(huniAsamasi({ createdAt: gunOnce(HUNI_ESIK_GUN.irtibat) }, SIMDI)).toBe('Contacted');
    expect(huniAsamasi({ createdAt: gunOnce(HUNI_ESIK_GUN.kapandi) }, SIMDI)).toBe('Closed');
  });
});

describe('huniAsamasi — elle atanan durum yaşı ezer', () => {
  it('elle Kapandı yapılan 5 günlük aday Yeni’ye düşmez', () => {
    expect(huniAsamasi({ status: 'Closed', createdAt: gunOnce(5) }, SIMDI)).toBe('Closed');
  });

  it('elle Nitelikli yapılan 200 günlük aday Kapandı olmaz', () => {
    expect(huniAsamasi({ status: 'Qualified', createdAt: gunOnce(200) }, SIMDI)).toBe('Qualified');
  });

  it('Proposal/Negotiation Nitelikli kutusuna düşer', () => {
    expect(huniAsamasi({ status: 'Proposal', createdAt: gunOnce(200) }, SIMDI)).toBe('Qualified');
    expect(huniAsamasi({ status: 'Negotiation', createdAt: gunOnce(1) }, SIMDI)).toBe('Qualified');
  });

  it("'New' elle atanmış sayılmaz — yaş devreye girer", () => {
    expect(huniAsamasi({ status: 'New', createdAt: gunOnce(75) }, SIMDI)).toBe('Contacted');
  });
});

describe('adayYasiGun — bozuk/eksik tarih', () => {
  it('tarih yoksa null, aşama Yeni kalır', () => {
    expect(adayYasiGun(undefined, SIMDI)).toBeNull();
    expect(huniAsamasi({}, SIMDI)).toBe('New');
  });

  it('geçersiz tarih metni null döner', () => {
    expect(adayYasiGun('bu bir tarih degil', SIMDI)).toBeNull();
    expect(huniAsamasi({ createdAt: 'bu bir tarih degil' }, SIMDI)).toBe('New');
  });

  it('Firestore Timestamp nesnesi desteklenir', () => {
    const ts = { toDate: () => new Date(SIMDI - 70 * 86_400_000) };
    expect(huniAsamasi({ createdAt: ts }, SIMDI)).toBe('Contacted');
  });
});
