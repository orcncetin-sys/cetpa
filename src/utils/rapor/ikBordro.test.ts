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
import { calisanDurumu, maasKutlesi } from './ikBordro';
import { tamTutar } from '../para';

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

// ══ 6c eki (grup "utils-ikbordro") — çalışan (employees) okuma: calisanDurumu + maasKutlesi ═══════
// ÖNCE YAZILDI (kırmızı görüldü: `calisanDurumu is not a function` / `maasKutlesi is not a function`).
// Sahte kesinlik sitesi — GenelBloklar4 P&L paneli bordro satırı:
//   employees.filter(e=>e.status==='Aktif').reduce((s,e)=>s+(e.salary||0),0)
// maaşı girilmemiş aktif çalışanı "₺0 biliniyor" sayıyor, `salaryCurrency`yi yok sayıp USD/EUR maaşı
// TL gibi topluyor, metin saklanmış maaşta `0 + '42000'` metin birleştirmesi yapıyor.
// K23 (KARARLAR.md) — kullanıcı: "Önerin ok. Sorunun cevabı dediğin gibi olacak."
// Fikstür: kanonik `Employee` şekli (types.ts `interface Employee`), Türkçe adlar, TL.
const calisan = (salary: unknown, ek: Record<string, unknown> = {}) =>
  ({ name: 'Ahmet Demir', department: 'Sevkiyat', status: 'Aktif', salary, salaryCurrency: 'TRY', ...ek });

describe('calisanDurumu — çalışan durumu anahtarı (GenelBloklar2 «Özet içgörüler» / GenelBloklar4 P&L parite)', () => {
  it('durum-1 · kanonik üç değer; PARİTE: aktif sayısı eski `status === \'Aktif\'` süzgeciyle BİREBİR', () => {
    expect(calisanDurumu({ status: 'Aktif' })).toBe('aktif');
    expect(calisanDurumu({ status: 'Ayrıldı' })).toBe('ayrildi');
    expect(calisanDurumu({ status: 'İzinli' })).toBe('izinli');

    const kadro = [
      calisan(42000, { name: 'Ahmet Demir' }),
      calisan(38500, { name: 'Ayşe Yılmaz', department: 'Depo', status: 'Ayrıldı' }),
      calisan(51000, { name: 'Mehmet Kaya', department: 'Satış', status: 'İzinli' }),
      calisan(35000, { name: 'Zeynep Arslan', department: 'Depo' }),
      calisan(60000, { name: 'Emre Çelik', department: 'Satış' }),
    ];
    const eski = kadro.filter(e => e.status === 'Aktif').length;
    expect(kadro.filter(e => calisanDurumu(e) === 'aktif').length).toBe(eski);
    expect(eski).toBe(3);
  });

  it('durum-2 · trim + tr-TR küçük harf (mutasyon: `toLowerCase()` → "İ" i + birleşik nokta \\u0307 olur, eşleşmez)', () => {
    expect(calisanDurumu({ status: ' AKTİF ' })).toBe('aktif');
    expect(calisanDurumu({ status: 'ayrıldı' })).toBe('ayrildi');
    expect(calisanDurumu({ status: 'AYRILDI' })).toBe('ayrildi');   // tr-TR: I → ı (dil ayarsız dönüşüm 'ayrildi' verir)
    expect(calisanDurumu({ status: 'İZİNLİ' })).toBe('izinli');
  });

  it('durum-3 · okunamayan durum \'bilinmiyor\' — varsayılan \'aktif\' DEĞİL (mutasyon: `?? \'aktif\'`)', () => {
    for (const status of [undefined, null, '', '   ', 42, 'Active', 'Inactive', 'Pasif']) {
      expect(calisanDurumu({ status })).toBe('bilinmiyor');
    }
    expect(calisanDurumu({})).toBe('bilinmiyor');
  });

  it('durum-4 · prototip anahtarı tuzağı: \'constructor\' / \'toString\' bilinen durum DEĞİL (mutasyon: Map yerine düz nesne)', () => {
    expect(calisanDurumu({ status: 'constructor' })).toBe('bilinmiyor');
    expect(calisanDurumu({ status: 'toString' })).toBe('bilinmiyor');
    expect(calisanDurumu({ status: '__proto__' })).toBe('bilinmiyor');
  });
});

describe('maasKutlesi — aylık maaş kütlesi (GenelBloklar4 P&L bordro satırı + EBITDA notu; K23 / O11 / O12)', () => {
  // Eski GenelBloklar4 P&L ifadesi — yalnız PARİTE kanıtı için testte satır içi (fikstürde `salary: unknown`).
  const eskiBordro = (kadro: readonly { status: unknown; salary: unknown }[]) =>
    kadro.filter(e => e.status === 'Aktif').reduce((s, e) => s + ((e.salary as number) || 0), 0);

  const paritKadrosu = () => [
    calisan(42000, { name: 'Ahmet Demir' }),
    calisan(38500, { name: 'Ayşe Yılmaz', department: 'Depo' }),
    calisan(51000, { name: 'Mehmet Kaya', department: 'Satış' }),
    calisan(60000, { name: 'Zeynep Arslan', department: 'Depo', status: 'Ayrıldı' }),
    calisan(35000, { name: 'Emre Çelik', department: 'Satış', status: 'İzinli' }),
  ];

  it('kütle-5 · PARİTE: eski GenelBloklar4 P&L bordro ifadesiyle BİREBİR (Ayrıldı / İzinli dışarıda)', () => {
    const kadro = paritKadrosu();
    const m = maasKutlesi(kadro);
    expect(m.tutar).toEqual({ toplam: 131500, bilinen: 3, bilinmeyen: 0 });
    expect(ekranTutari(m.tutar)).toBe(eskiBordro(kadro));
    expect(m.aktif).toBe(3);
    expect(m.maasiGirilmemis).toBe(0);
    expect(m.dovizli).toBe(0);
    expect(m.durumBilinmeyen).toBe(0);
  });

  it('kütle-6 · maaşı girilmemiş aktif çalışan ₺0 SAYILMAZ (mutasyon: `e => e.salary || 0` → bilinen 6 / bilinmeyen 0)', () => {
    const m = maasKutlesi([
      calisan(42000, { name: 'Ahmet Demir' }),
      calisan(undefined, { name: 'Ayşe Yılmaz' }),
      calisan(null, { name: 'Mehmet Kaya' }),
      calisan('', { name: 'Zeynep Arslan' }),
      calisan('abc', { name: 'Emre Çelik' }),
      calisan(NaN, { name: 'Ayşe Yılmaz', department: 'Depo' }),
    ]);
    expect(m.tutar).toEqual({ toplam: 42000, bilinen: 1, bilinmeyen: 5 });
    expect(m.maasiGirilmemis).toBe(5);
    // TÜRETME kapısı kısmi kütleden sayı üretmez; EKRAN sözleşmesi kısmi toplamı verir (O12: EBITDA buna girer).
    expect(Number.isNaN(tamTutar(m.tutar))).toBe(true);
    expect(ekranTutari(m.tutar)).toBe(42000);
  });

  it('kütle-7 · maaş 0 = GİRİLMEMİŞ (yazıcı varsayılanı); negatif de girilmemiş (mutasyon: `n > 0` kapısı kalkarsa bilinen 3)', () => {
    const m = maasKutlesi([
      calisan(42000, { name: 'Ahmet Demir' }),
      calisan(0, { name: 'Ayşe Yılmaz', department: 'Depo' }),
      calisan(-5000, { name: 'Mehmet Kaya', department: 'Satış' }),
    ]);
    expect(m.tutar).toEqual({ toplam: 42000, bilinen: 1, bilinmeyen: 2 });
    expect(m.maasiGirilmemis).toBe(2);
    // 0 eklemek = hariç tutmak: toplam eski ifadeyle aynı, yalnız sayaç değişir.
    expect(m.tutar.toplam).toBe(eskiBordro([calisan(42000), calisan(0)]));
  });

  it('kütle-8 · sayısal string bilinendir, METİN BİRLEŞTİRMESİ yok', () => {
    const kadro = [calisan('42000', { name: 'Ahmet Demir' }), calisan(38500, { name: 'Ayşe Yılmaz' })];
    const m = maasKutlesi(kadro);
    expect(m.tutar.toplam).toBe(80500);
    expect(typeof m.tutar.toplam).toBe('number');
    // Eski ifade `0 + '42000'` ile metin üretiyordu (bilinçli fark: artık sayı).
    expect(typeof eskiBordro(kadro)).toBe('string');
  });

  it('kütle-9 · dövizli maaş TL\'ye TOPLANMAZ, ayrı sayılır — K23 (mutasyon: `tlKaydi` çağrısı kalkarsa toplam 47.500)', () => {
    const m = maasKutlesi([
      calisan(42000, { name: 'Ahmet Demir' }),
      calisan(3000, { name: 'Ayşe Yılmaz', department: 'Satış', salaryCurrency: 'USD' }),
      calisan(2500, { name: 'Mehmet Kaya', department: 'Satış', salaryCurrency: 'EUR' }),
    ]);
    expect(m.tutar.toplam).toBe(42000);
    expect(m.tutar.bilinen).toBe(1);
    expect(m.dovizli).toBe(2);
    expect(m.aktif).toBe(3);
  });

  it('kütle-10 · boş / eksik / küçük harf para birimi = TRY (mevcut `tlKaydi` sözleşmesi yeniden kullanılıyor)', () => {
    const m = maasKutlesi([
      calisan(42000, { name: 'Ahmet Demir', salaryCurrency: undefined }),
      calisan(38500, { name: 'Ayşe Yılmaz', salaryCurrency: '' }),
      calisan(51000, { name: 'Mehmet Kaya', salaryCurrency: '  ' }),
      calisan(35000, { name: 'Zeynep Arslan', salaryCurrency: 'try' }),
      calisan(30000, { name: 'Emre Çelik', salaryCurrency: null }),
    ]);
    expect(m.tutar).toEqual({ toplam: 196500, bilinen: 5, bilinmeyen: 0 });
    expect(m.dovizli).toBe(0);
  });

  it('kütle-11 · sayaçlar ÇİFT SAYMAZ + DEĞİŞMEZLER (mutasyon: döviz denetimi maaştan SONRA → maaşsız USD iki sayaçta)', () => {
    const m = maasKutlesi([
      calisan(0, { name: 'Ayşe Yılmaz', department: 'Satış', salaryCurrency: 'USD' }),
      calisan(undefined, { name: 'Mehmet Kaya', department: 'Depo' }),
      calisan(42000, { name: 'Ahmet Demir' }),
    ]);
    expect(m.dovizli).toBe(1);
    expect(m.maasiGirilmemis).toBe(1);
    expect(m.tutar.bilinmeyen).toBe(1);
    expect(m.tutar.bilinen).toBe(1);
    expect(m.aktif).toBe(3);
    expect(m.aktif).toBe(m.tutar.bilinen + m.maasiGirilmemis + m.dovizli);
    expect(m.maasiGirilmemis).toBe(m.tutar.bilinmeyen);
  });

  it('kütle-12 · yalnız aktif — İzinli / Ayrıldı kütleye GİRMEZ (mutasyon: yalnız `ayrildi` süzülürse İzinli girer)', () => {
    const m = maasKutlesi([
      calisan(35000, { name: 'Zeynep Arslan', status: 'İzinli' }),
      calisan(60000, { name: 'Emre Çelik', status: 'Ayrıldı' }),
    ]);
    expect(m.tutar).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(m.aktif).toBe(0);
    expect(m.durumBilinmeyen).toBe(0);
    expect(ekranTutari(m.tutar)).toBe(0);
  });

  it('kütle-13 · durumu okunamayan sayılır, aktif SAYILMAZ (mutasyon: bilinmeyen durum aktif sayılırsa toplam 137.000)', () => {
    const m = maasKutlesi([
      calisan(50000, { name: 'Mehmet Kaya', status: undefined }),
      calisan(45000, { name: 'Ayşe Yılmaz', status: 'Active' }),
      calisan(42000, { name: 'Ahmet Demir' }),
    ]);
    expect(m.tutar.toplam).toBe(42000);
    expect(m.aktif).toBe(1);
    expect(m.durumBilinmeyen).toBe(2);
  });

  it('kütle-14 · hiç maaş girilmemiş kadro ekranda \'—\' verir, ₺0 DEĞİL', () => {
    const m = maasKutlesi([
      calisan(0, { name: 'Ahmet Demir' }),
      calisan(0, { name: 'Ayşe Yılmaz', department: 'Depo' }),
    ]);
    expect(Number.isNaN(ekranTutari(m.tutar))).toBe(true);
    expect(m.tutar.bilinmeyen).toBe(2);
    expect(m.maasiGirilmemis).toBe(2);
  });

  it('kütle-15 · boş liste gerçek 0 (NaN değil), tüm sayaçlar 0', () => {
    const m = maasKutlesi([]);
    expect(ekranTutari(m.tutar)).toBe(0);
    expect(m).toEqual({
      tutar: { toplam: 0, bilinen: 0, bilinmeyen: 0 },
      maasiGirilmemis: 0,
      dovizli: 0,
      aktif: 0,
      durumBilinmeyen: 0,
    });
  });

  it('kütle-16 · girdi mutasyona uğramaz (dondurulmuş dizi + öğeler; sonuç PARİTE vakasıyla aynı)', () => {
    const kadro = Object.freeze(paritKadrosu().map(e => Object.freeze(e)));
    expect(() => maasKutlesi(kadro)).not.toThrow();
    expect(maasKutlesi(kadro)).toEqual(maasKutlesi(paritKadrosu()));
    expect(maasKutlesi(kadro).tutar).toEqual({ toplam: 131500, bilinen: 3, bilinmeyen: 0 });
  });
});
