/**
 * ikBordro.test.ts — İK bordro okuma sözleşmesi (Faz 3 6a, grup "ik-bordro", 2026-09-19).
 * ÖNCE YAZILDI (kırmızı görüldü, sonra modül). Saf — React/DB yok.
 *
 * Sahte kesinlik siteleri (sayfa DIŞI okuma katmanı — useReportsData.ts'e DOKUNULMADI):
 *   src/components/reports/useReportsData.ts
 *     102  acc[e.department] = (acc[e.department] || 0) + 1        (departman dilimi; boş ad 'undefined' dilimi)
 *     121  const pays = sortByCreatedAt(snap.docs.map(d => d.data()))   (createdAt DESC — kronolojik DEĞİL)
 *     122  total = pays.filter(p => p.status === 'Ödendi')
 *                      .reduce((sum, p) => sum + (p.netSalary || 0), 0)
 *     125  const key = `${p.month}/${p.year}`                       (ay/yıl yoksa 'undefined/undefined' çubuğu)
 *     126  acc[key] = (acc[key] || 0) + (p.netSalary || 0)
 *
 * `|| 0` netSalary'si okunamayan bordroyu "₺0 biliniyor" sayıp "Ödenen Maaş" KPI'ını ve
 * bordro trendini sessizce EKSİK gösteriyor; kaç kaydın dışarıda kaldığı hiçbir yerde yazmıyor.
 * Bu testler o üç kuralı (bilinmeyen sayılır / döviz ayrılır / dönem çözülemezse çubuk yok) kilitler.
 */
import { describe, it, expect } from 'vitest';
import { odenenBordro, bordroTrendi, departmanAnahtari } from './ikBordro';
import { ekranTutari } from '../para';

// ── Fikstür: Türkçe alanlar, TL, gerçek şekil (types.ts:377 Payroll) ────────────────────────
const odendi = (netSalary: unknown, ek: Record<string, unknown> = {}) =>
  ({ status: 'Ödendi', employeeName: 'Ayşe Yılmaz', netSalary, month: 3, year: 2026, ...ek });

describe('odenenBordro — "Ödenen Maaş" KPI (useReportsData.ts:122 parite)', () => {
  it('1 · PARİTE: yalnız Ödendi toplanır, Taslak sayılmaz', () => {
    const bordrolar = [
      odendi(1000),
      odendi(2000),
      odendi(3000),
      { status: 'Taslak', employeeName: 'Mehmet Çetin', netSalary: 9999, month: 3, year: 2026 },
    ];
    const { tutar, dovizli } = odenenBordro(bordrolar);
    expect(tutar).toEqual({ toplam: 6000, bilinen: 3, bilinmeyen: 0 });
    expect(dovizli).toBe(0);
  });

  it('2 · bilinmeyen tutar SAYILIR, ₺0 sayılmaz (mutasyon: `|| 0` → bilinen 3 / bilinmeyen 0)', () => {
    const { tutar } = odenenBordro([odendi(1000), odendi(2000), odendi(undefined)]);
    expect(tutar.toplam).toBe(3000);
    expect(tutar.bilinen).toBe(2);
    expect(tutar.bilinmeyen).toBe(1);
  });

  it('2b · null / boş metin / NaN / sayı olmayan metin de bilinmiyordur', () => {
    const { tutar } = odenenBordro([
      odendi(null), odendi(''), odendi('   '), odendi(Number.NaN), odendi('bilinmiyor'), odendi({}),
    ]);
    expect(tutar).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 6 });
  });

  it('2c · DB\'de metin saklanmış sayı bilinendir (sayısal string)', () => {
    const { tutar } = odenenBordro([odendi('1500.5')]);
    expect(tutar).toEqual({ toplam: 1500.5, bilinen: 1, bilinmeyen: 0 });
  });

  it('3 · meşru 0 bilinen 0\'dır (bilinen++, toplam değişmez)', () => {
    const { tutar } = odenenBordro([odendi(2500), odendi(0)]);
    expect(tutar).toEqual({ toplam: 2500, bilinen: 2, bilinmeyen: 0 });
  });

  it('4 · hiç bilinen yokken ekran değeri NaN (ekranda "—", "₺0,00" DEĞİL)', () => {
    const { tutar } = odenenBordro([odendi(undefined)]);
    expect(Number.isNaN(ekranTutari(tutar))).toBe(true);
  });

  it('4b · hiç Ödendi bordro yoksa gerçek 0 (boş liste), NaN değil', () => {
    const { tutar } = odenenBordro([{ status: 'Bekliyor', netSalary: 4000 }]);
    expect(tutar).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(ekranTutari(tutar)).toBe(0);
  });

  it('5 · dövizli bordro TL toplamına KATILMAZ, ayrı sayılır (mutasyon: currency yok sayılırsa toplam 1000 artar)', () => {
    const { tutar, dovizli } = odenenBordro([
      odendi(4000, { currency: 'TRY' }),
      odendi(3000, { currency: undefined }),
      odendi(1000, { currency: 'USD' }),
    ]);
    expect(tutar).toEqual({ toplam: 7000, bilinen: 2, bilinmeyen: 0 });
    expect(dovizli).toBe(1);
  });

  it('5b · boş / yalnız boşluk currency = TRY (bugünkü tüm kayıtlar)', () => {
    const { tutar, dovizli } = odenenBordro([odendi(1200, { currency: '' }), odendi(800, { currency: '  ' })]);
    expect(tutar).toEqual({ toplam: 2000, bilinen: 2, bilinmeyen: 0 });
    expect(dovizli).toBe(0);
  });

  it('5c · sayaçlar ÇİFT SAYMAZ: dövizli + tutarsız bordro yalnız dovizli\'de', () => {
    const { tutar, dovizli } = odenenBordro([odendi(undefined, { currency: 'EUR' })]);
    expect(dovizli).toBe(1);
    expect(tutar).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });
});

describe('bordroTrendi — bordro trendi çubukları (useReportsData.ts:124-128 parite)', () => {
  it('6 · dönem çözümü: geçerli ay/yıl "YYYY-MM" olur', () => {
    const { satirlar, donemsiz } = bordroTrendi([
      { netSalary: 1000, month: 3, year: 2026 },
      { netSalary: 2000, month: 12, year: 2025 },
    ]);
    expect(satirlar.map(s => s.donem)).toEqual(['2025-12', '2026-03']);
    expect(satirlar[1]).toEqual({ donem: '2026-03', ay: 3, yil: 2026, tutar: { toplam: 1000, bilinen: 1, bilinmeyen: 0 } });
    expect(donemsiz).toBe(0);
  });

  it('6b · geçersiz ay/yıl çubuk ÜRETMEZ, donemsiz sayılır (mutasyon: aralık denetimi kalkarsa "2026-13" çubuğu)', () => {
    const gecersiz = [
      { netSalary: 100, month: 0, year: 2026 },
      { netSalary: 100, month: 13, year: 2026 },
      { netSalary: 100, month: 2.5, year: 2026 },
      { netSalary: 100, month: '3x', year: 2026 },
      { netSalary: 100, month: undefined, year: 2026 },
      { netSalary: 100, month: 3, year: undefined },
      { netSalary: 100, month: 3, year: 26 },
    ];
    const { satirlar, donemsiz } = bordroTrendi(gecersiz);
    expect(satirlar).toEqual([]);
    expect(donemsiz).toBe(7);
  });

  it('6c · sayısal string ay/yıl kabul edilir ve SAYI olarak döner', () => {
    const { satirlar } = bordroTrendi([{ netSalary: 500, month: '3', year: '2026' }]);
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0].donem).toBe('2026-03');
    expect(satirlar[0].ay).toBe(3);
    expect(satirlar[0].yil).toBe(2026);
    expect(typeof satirlar[0].ay).toBe('number');
  });

  it('7 · kronolojik artan sıralanır (mutasyon: sıralama kalkarsa ekleme sırası)', () => {
    const { satirlar } = bordroTrendi([
      { netSalary: 100, month: 2, year: 2026 },
      { netSalary: 200, month: 12, year: 2025 },
      { netSalary: 300, month: 1, year: 2026 },
    ]);
    expect(satirlar.map(s => s.donem)).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('8 · dönemsiz bordro hiçbir çubuğa girmez ("undefined/undefined" çubuğu yok)', () => {
    const { satirlar, donemsiz } = bordroTrendi([
      { netSalary: 500, month: undefined, year: undefined },
      { netSalary: 700, month: 4, year: 2026 },
    ]);
    expect(satirlar.map(s => s.donem)).toEqual(['2026-04']);
    expect(satirlar.some(s => s.donem.includes('undefined'))).toBe(false);
    expect(donemsiz).toBe(1);
  });

  it('9 · aynı dönem tek çubukta birleşir; kısmi toplam + bilinmeyen sayacı', () => {
    const { satirlar } = bordroTrendi([
      { netSalary: 1000, month: 5, year: 2026 },
      { netSalary: undefined, month: 5, year: 2026 },
    ]);
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0].tutar).toEqual({ toplam: 1000, bilinen: 1, bilinmeyen: 1 });
  });

  it('10 · PARİTE: trend durum süzgeci UYGULAMAZ (Taslak da sayılır)', () => {
    const { satirlar } = bordroTrendi([
      { status: 'Ödendi', netSalary: 1000, month: 6, year: 2026 },
      { status: 'Taslak', netSalary: 500, month: 6, year: 2026 },
      { status: 'Bekliyor', netSalary: 250, month: 6, year: 2026 },
    ]);
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0].tutar).toEqual({ toplam: 1750, bilinen: 3, bilinmeyen: 0 });
  });

  it('10b · dövizli bordro çubuğa girmez, ayrı sayılır', () => {
    const { satirlar, dovizli } = bordroTrendi([
      { netSalary: 1000, month: 7, year: 2026, currency: 'TRY' },
      { netSalary: 900, month: 7, year: 2026, currency: 'USD' },
    ]);
    expect(satirlar[0].tutar).toEqual({ toplam: 1000, bilinen: 1, bilinmeyen: 0 });
    expect(dovizli).toBe(1);
  });

  it('10c · sayaçlar ÇİFT SAYMAZ: dövizli + dönemsiz bordro yalnız dovizli\'de', () => {
    const { satirlar, donemsiz, dovizli } = bordroTrendi([
      { netSalary: 900, month: undefined, year: undefined, currency: 'USD' },
    ]);
    expect(satirlar).toEqual([]);
    expect(dovizli).toBe(1);
    expect(donemsiz).toBe(0);
  });

  it('10d · boş liste: çubuk yok, sayaçlar 0', () => {
    expect(bordroTrendi([])).toEqual({ satirlar: [], donemsiz: 0, dovizli: 0 });
  });
});

describe('departmanAnahtari — departman dilimi (useReportsData.ts:102 parite)', () => {
  it('11 · dolu ad trim\'li döner; "Satış " ve "Satış" tek dilim', () => {
    expect(departmanAnahtari({ department: '  Depo ' })).toBe('Depo');
    expect(departmanAnahtari({ department: 'Satış ' })).toBe(departmanAnahtari({ department: 'Satış' }));
  });

  it('11b · boş / metin olmayan departman null (mutasyon: `|| 0` kalıbı "undefined" dilimi üretiyordu)', () => {
    expect(departmanAnahtari({ department: '' })).toBeNull();
    expect(departmanAnahtari({ department: '   ' })).toBeNull();
    expect(departmanAnahtari({ department: undefined })).toBeNull();
    expect(departmanAnahtari({ department: null })).toBeNull();
    expect(departmanAnahtari({ department: 42 })).toBeNull();
    expect(departmanAnahtari({ department: {} })).toBeNull();
    expect(departmanAnahtari({})).toBeNull();
  });
});
