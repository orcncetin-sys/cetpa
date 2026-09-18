/**
 * kdvBeyan.test.ts — AccountingModule KDV Beyannamesi (KDV sekmesi KPI + oran kırılımı + PDF/CSV)
 * hesap sözleşmesi. ÖNCE YAZILDI (Faz 3 2/n, 2026-09-14).
 *
 * Sahte-kesinlik siteleri (AccountingModule.tsx, satırlar yaklaşık):
 *   2165-2169 kdvFilteredEntries    `if (!e.date) return false; new Date(e.date)` — tarihsiz fiş SESSİZCE düşüyordu,
 *                                   `new Date(string)` yasak (zaman.ts)
 *   2173-2176 mikroKdvDonem         `String(tarih || '').slice(0,4)` — tarihsiz fatura sessizce düşüyordu
 *   2177-2178 mikroHesaplanan/İndirilecekKDV  reduce(Number(f.kdv) || 0)   KDV'si bilinmeyen fatura 0 sayılıyordu
 *   2179-2180 hesaplanan/indirilecekKDV        reduce(s + e.alacak / e.borc) null → +0 (sessiz), undefined → NaN yayılır
 *   2181      odenecekKDV                      kısmi toplamdan net türetiliyordu
 *   2188-2189 (e.kdvOran ?? 0) > 0 / ?? 0     oranı bilinmeyen gelir fişi kırılımdan SESSİZCE düşüyordu
 *   2190      fisTutari(e) = alacak||borc||0   iki tarafı da bilinmeyen fiş 0 matrah
 *   2199      String(Number(f.oran) || 0)      oranı çözülemeyen Mikro faturası "%0" bandına yazılıyordu
 *   2201-2202 Number(f.matrah/kdv) || 0        bilinmeyen matrah/KDV 0
 *   KdvTab.tsx 69/87 formatTRY(e.alacak || 0 / e.borc || 0)   drill-down satırında bilinmeyen ₺0
 *   655-716   PDF/CSV                          kırılımdan okur — aynı sayılar
 * Kural (CLAUDE.md): bilinmeyen tutar toplama GİRMEZ, SAYILIR (`bilinmeyen`); ekranda '—' + "N kayıt tutarsız".
 * Net (ödenecek) TÜRETMEDİR: bir taraf kısmen bile bilinmiyorsa NaN (para.ts `tamTutar`). Boş dönem GERÇEK 0.
 */
import { describe, it, expect } from 'vitest';
import { ekranTutari, tamTutar } from '../para';
import { paraYaz } from '../currency';
import { kdvDonemi, fisTutari } from './kdvBeyan';

// ── Ortak veri: Mart 2026 ─────────────────────────────────────────────────────────────────
const YEVMIYE = [
  { id: 'Y1', date: '2026-03-05', aciklama: 'Şirin İnşaat satış', debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurtiçi Satışlar', borc: 12000, alacak: 12000, kdvOran: 20 },
  { id: 'Y2', date: '2026-03-05', aciklama: 'Şirin İnşaat KDV', debitHesap: '120 - Alıcılar', alacakHesap: '391 - Hesaplanan KDV', borc: 2400, alacak: 2400 },
  { id: 'Y3', date: '2026-03-10', aciklama: 'Çelik Yapı alış KDV', debitHesap: '191 - İndirilecek KDV', alacakHesap: '320 - Satıcılar', borc: 800, alacak: 800 },
  { id: 'Y4', date: '2026-03-12', aciklama: 'Işık Ltd. satış %10', debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurtiçi Satışlar', borc: 5000, alacak: 5000, kdvOran: 10 },
  { id: 'Y5', date: '2026-04-01', aciklama: 'Nisan KDV', debitHesap: '120 - Alıcılar', alacakHesap: '391 - Hesaplanan KDV', borc: 999, alacak: 999 },                 // başka ay
  { id: 'Y6', date: '', aciklama: 'Tarihsiz KDV', debitHesap: '120 - Alıcılar', alacakHesap: '391 - Hesaplanan KDV', borc: 777, alacak: 777 },                          // tarihsiz
  { id: 'Y7', date: '2026-03-15', aciklama: 'Ömer Nakliyat KDV\'siz', debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurtiçi Satışlar', borc: 3000, alacak: 3000, kdvOran: 0 }, // %0 → kırılım dışı
];
const MIKRO = [
  { id: 'M1', tarih: '2026-03-03', yon: 'giden', tutar: 2400, matrah: 2000, kdv: 400, oran: 20, oranKarma: false },
  { id: 'M2', tarih: '2026-03-08', yon: 'gelen', tutar: 1150, matrah: 1000, kdv: 150, oran: 10, oranKarma: false },
  { id: 'M3', tarih: '2026-03-20', yon: 'giden', tutar: 3300, matrah: 3000, kdv: 300, oran: null, oranKarma: true },   // karma
  { id: 'M4', tarih: '2026-04-02', yon: 'giden', tutar: 120, matrah: 100, kdv: 20, oran: 20, oranKarma: false },        // Nisan
];

describe('fisTutari — gelir fişinin tutarı (alacak || borc, bilinmeyen 0 DEĞİL)', () => {
  it('dengeli fiş → alacak; tek taraflı eski banka import fişi (alacak=0, borc=X) → borc (sayfa paritesi: `||`)', () => {
    expect(fisTutari({ alacak: 1200, borc: 1200 })).toBe(1200);
    expect(fisTutari({ alacak: 0, borc: 500 })).toBe(500);
    expect(fisTutari({ alacak: '750', borc: 0 })).toBe(750);
  });
  it('iki taraf da bilinen 0 → gerçek 0; bir taraf bilinen 0 + diğeri bilinmiyor → NaN; iki taraf da bilinmiyor → NaN (eski `|| 0` 0 basıyordu)', () => {
    expect(fisTutari({ alacak: 0, borc: 0 })).toBe(0);
    expect(fisTutari({ alacak: '0', borc: '250' })).toBe(250);
    expect(Number.isNaN(fisTutari({ alacak: 0 }))).toBe(true);              // tutar borçta olmalıydı, borç bilinmiyor
    expect(Number.isNaN(fisTutari({ alacak: undefined, borc: 0 }))).toBe(true);
    expect(Number.isNaN(fisTutari({}))).toBe(true);
    expect(Number.isNaN(fisTutari({ alacak: null, borc: undefined }))).toBe(true);
    expect(Number.isNaN(fisTutari({ alacak: 'abc', borc: NaN }))).toBe(true);
  });
});

describe('kdvDonemi — sayfa paritesi (temiz veri, Mart 2026)', () => {
  const d = kdvDonemi(YEVMIYE, MIKRO, 2026, 3);
  it('hesaplanan = journal 391 alacak + Mikro giden KDV; indirilecek = journal 191 borç + Mikro gelen KDV; ödenecek = fark', () => {
    expect(d.hesaplanan).toEqual({ toplam: 3100, bilinen: 3, bilinmeyen: 0 });   // Y2 2400 + M1 400 + M3 300
    expect(d.indirilecek).toEqual({ toplam: 950, bilinen: 2, bilinmeyen: 0 });   // Y3 800 + M2 150
    expect(d.odenecek).toBe(2150);
    expect(ekranTutari(d.hesaplanan)).toBe(3100);
    expect(paraYaz(d.odenecek)).toContain('2.150');
  });
  it('başka ay ve tarihsiz kayıtlar döneme girmez; tarihsiz SAYILIR (eski kod sessizce düşürüyordu)', () => {
    expect(d.hesaplanan.toplam).not.toBe(3100 + 999);
    expect(d.tarihsiz).toBe(1);                                                   // Y6
    const nisan = kdvDonemi(YEVMIYE, MIKRO, 2026, 4);
    expect(nisan.hesaplanan).toEqual({ toplam: 999 + 20, bilinen: 2, bilinmeyen: 0 });
    expect(nisan.oranKirilimi['20']).toMatchObject({ matrah: { toplam: 100 }, kdv: { toplam: 20 }, adet: 1 });
  });
  it('oran kırılımı: journal 6xx fişi (matrah×oran) + Mikro giden bandı aynı kovada; karma ayrı; %0 fiş ve GELEN fatura dışarıda', () => {
    expect(Object.keys(d.oranKirilimi).sort()).toEqual(['10', '20', 'karma']);
    expect(d.oranKirilimi['20']).toEqual({ matrah: { toplam: 14000, bilinen: 2, bilinmeyen: 0 }, kdv: { toplam: 2800, bilinen: 2, bilinmeyen: 0 }, adet: 2, tutarsiz: 0 });
    expect(d.oranKirilimi['10']).toEqual({ matrah: { toplam: 5000, bilinen: 1, bilinmeyen: 0 }, kdv: { toplam: 500, bilinen: 1, bilinmeyen: 0 }, adet: 1, tutarsiz: 0 }); // M2 gelen GİRMEZ
    expect(d.oranKirilimi['karma']).toMatchObject({ matrah: { toplam: 3000 }, kdv: { toplam: 300 }, adet: 1 });
    expect(d.oranKirilimi['0']).toBeUndefined();                                 // Y7 kdvOran 0 → KDV'siz, kırılım dışı (sayfa: `> 0`)
  });
  it('drill-down listeleri: 391 ve 191 fişleri tutarlarıyla (kayıt referansı korunur)', () => {
    expect(d.hesaplananListesi.map(r => [r.kayit.id, r.tutar])).toEqual([['Y2', 2400]]);
    expect(d.indirilecekListesi.map(r => [r.kayit.id, r.tutar])).toEqual([['Y3', 800]]);
  });
  it('boş dönem → gerçek 0 (bilinmeyen değil), ödenecek 0, kırılım boş', () => {
    const bos = kdvDonemi([], [], 2026, 3);
    expect(bos).toEqual({
      hesaplanan: { toplam: 0, bilinen: 0, bilinmeyen: 0 }, indirilecek: { toplam: 0, bilinen: 0, bilinmeyen: 0 },
      odenecek: 0, oranKirilimi: {}, hesaplananListesi: [], indirilecekListesi: [], tarihsiz: 0,
    });
    expect(ekranTutari(bos.hesaplanan)).toBe(0);
  });
});

describe('kdvDonemi — bilinmeyen 0 SAYILMAZ, sayılır', () => {
  const Y8 = { id: 'Y8', date: '2026-03-18', aciklama: 'Güneş A.Ş. KDV (tutar boş)', debitHesap: '120 - Alıcılar', alacakHesap: '391 - Hesaplanan KDV', borc: undefined, alacak: undefined };
  const M5 = { id: 'M5', tarih: '2026-03-21', yon: 'giden', tutar: 600, matrah: 500, kdv: null, oran: 20, oranKarma: false };
  it('391 fişinin alacağı bilinmiyor → hesaplanan.bilinmeyen 1, toplam değişmez, ödenecek NaN (kısmi toplamdan net türetilmez)', () => {
    const d = kdvDonemi([...YEVMIYE, Y8], MIKRO, 2026, 3);
    expect(d.hesaplanan).toEqual({ toplam: 3100, bilinen: 3, bilinmeyen: 1 });
    expect(Number.isNaN(d.odenecek)).toBe(true);                                 // `|| 0` geri gelirse 2150 olur → kırılır
    expect(ekranTutari(d.hesaplanan)).toBe(3100);                                // KISMİ toplam + sayfa notu "1 kayıt tutarsız"
    expect(paraYaz(d.odenecek)).toBe('—');
  });
  it('drill-down satırı: bilinmeyen alacak NaN, 0 DEĞİL (KdvTab 69 `e.alacak || 0`)', () => {
    const d = kdvDonemi([...YEVMIYE, Y8], MIKRO, 2026, 3);
    const y8 = d.hesaplananListesi.find(r => r.kayit.id === 'Y8');
    expect(y8).toBeDefined();
    expect(Number.isNaN(y8!.tutar)).toBe(true);
    expect(paraYaz(y8!.tutar)).toBe('—');
  });
  it('Mikro giden faturanın KDV\'si null → hesaplanan.bilinmeyen; kovada matrah sayılır, kdv sayılmaz, tutarsiz 1', () => {
    const d = kdvDonemi(YEVMIYE, [...MIKRO, M5], 2026, 3);
    expect(d.hesaplanan).toEqual({ toplam: 3100, bilinen: 3, bilinmeyen: 1 });
    expect(Number.isNaN(d.odenecek)).toBe(true);
    expect(d.oranKirilimi['20']).toEqual({ matrah: { toplam: 14500, bilinen: 3, bilinmeyen: 0 }, kdv: { toplam: 2800, bilinen: 2, bilinmeyen: 1 }, adet: 3, tutarsiz: 1 });
  });
  it('191 fişinin borcu bilinmiyor → indirilecek.bilinmeyen; sayısal string borç bilinen sayılır', () => {
    const d = kdvDonemi([
      ...YEVMIYE,
      { id: 'Y12', date: '2026-03-26', aciklama: 'Ünal Ticaret alış KDV', debitHesap: '191 - İndirilecek KDV', alacakHesap: '320 - Satıcılar', borc: '250', alacak: '250' },
      { id: 'Y13', date: '2026-03-27', aciklama: 'Borcu boş', debitHesap: '191 - İndirilecek KDV', alacakHesap: '320 - Satıcılar', borc: null, alacak: null },
    ], MIKRO, 2026, 3);
    expect(d.indirilecek).toEqual({ toplam: 1200, bilinen: 3, bilinmeyen: 1 });  // 800 + 150 + 250
    expect(d.indirilecekListesi.map(r => r.kayit.id)).toEqual(['Y3', 'Y12', 'Y13']);
    expect(d.indirilecekListesi[1].tutar).toBe(250);
    expect(Number.isNaN(d.indirilecekListesi[2].tutar)).toBe(true);
    expect(Number.isNaN(d.odenecek)).toBe(true);
  });
  it('hiç bilinen yokken ekranTutari NaN (\'—\'); tamTutar da NaN', () => {
    const d = kdvDonemi([Y8], [], 2026, 3);
    expect(d.hesaplanan).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(Number.isNaN(ekranTutari(d.hesaplanan))).toBe(true);
    expect(Number.isNaN(tamTutar(d.hesaplanan))).toBe(true);
    expect(d.indirilecek).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });     // hareketsiz taraf gerçek 0
    expect(Number.isNaN(d.odenecek)).toBe(true);
  });
});

describe('kdvDonemi — oran kırılımı kovaları', () => {
  it('journal gelir fişinin kdvOran\'ı bilinmiyor → "bilinmiyor" kovası (eski `?? 0 > 0` sessizce düşürüyordu); matrah bilinir, KDV bilinmez', () => {
    const d = kdvDonemi([
      ...YEVMIYE,
      { id: 'Y9', date: '2026-03-19', aciklama: 'Oranı girilmemiş satış', debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurtiçi Satışlar', borc: 4000, alacak: 4000 },
      { id: 'Y9b', date: '2026-03-19', aciklama: 'Oranı bozuk satış', debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurtiçi Satışlar', borc: 100, alacak: 100, kdvOran: NaN },
    ], MIKRO, 2026, 3);
    expect(d.oranKirilimi['bilinmiyor']).toEqual({ matrah: { toplam: 4100, bilinen: 2, bilinmeyen: 0 }, kdv: { toplam: 0, bilinen: 0, bilinmeyen: 2 }, adet: 2, tutarsiz: 2 });
    expect(Number.isNaN(ekranTutari(d.oranKirilimi['bilinmiyor'].kdv))).toBe(true);
    expect(d.oranKirilimi['20'].adet).toBe(2);                                   // diğer kovalar etkilenmez
  });
  it('journal gelir fişinin iki tarafı da bilinmiyor → kovada matrah VE kdv bilinmeyen (eski 0 matrah, 0 KDV)', () => {
    const d = kdvDonemi([
      ...YEVMIYE,
      { id: 'Y10', date: '2026-03-22', aciklama: 'Tutarsız satış', debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurtiçi Satışlar', kdvOran: 20 },
    ], MIKRO, 2026, 3);
    expect(d.oranKirilimi['20']).toEqual({ matrah: { toplam: 14000, bilinen: 2, bilinmeyen: 1 }, kdv: { toplam: 2800, bilinen: 2, bilinmeyen: 1 }, adet: 3, tutarsiz: 1 });
  });
  it('tek taraflı eski fiş (alacak=0, borc=1500) → matrah 1500, KDV 300 (sayfa paritesi `alacak || borc`)', () => {
    const d = kdvDonemi([
      { id: 'Y11', date: '2026-03-23', aciklama: 'Banka import fişi', debitHesap: '102 - Bankalar', alacakHesap: '600 - Yurtiçi Satışlar', borc: 1500, alacak: 0, kdvOran: 20 },
    ], [], 2026, 3);
    expect(d.oranKirilimi['20']).toEqual({ matrah: { toplam: 1500, bilinen: 1, bilinmeyen: 0 }, kdv: { toplam: 300, bilinen: 1, bilinmeyen: 0 }, adet: 1, tutarsiz: 0 });
  });
  it('sayısal string kdvOran (\'20\') sayı kovasına gider; kdvOran negatif → KDV\'siz gibi dışarıda', () => {
    const d = kdvDonemi([
      { id: 'Ya', date: '2026-03-02', aciklama: 'string oran', debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurtiçi Satışlar', borc: 1000, alacak: 1000, kdvOran: '20' },
      { id: 'Yb', date: '2026-03-02', aciklama: 'negatif oran', debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurtiçi Satışlar', borc: 1000, alacak: 1000, kdvOran: -5 },
    ], [], 2026, 3);
    expect(Object.keys(d.oranKirilimi)).toEqual(['20']);
    expect(d.oranKirilimi['20']).toMatchObject({ matrah: { toplam: 1000 }, kdv: { toplam: 200 }, adet: 1 });
  });
  it('Mikro giden faturanın oranı çözülemiyor (null, karma değil) → "bilinmiyor" (eski `Number(oran) || 0` "%0" bandına yazıyordu)', () => {
    const d = kdvDonemi([], [
      { id: 'M6', tarih: '2026-03-25', yon: 'giden', tutar: 1000, matrah: 1000, kdv: 0, oran: null, oranKarma: false },
      { id: 'M7', tarih: '2026-03-25', yon: 'giden', tutar: 1000, matrah: 1000, kdv: 0, oran: 0, oranKarma: false },     // gerçek %0 → '0'
    ], 2026, 3);
    expect(Object.keys(d.oranKirilimi).sort()).toEqual(['0', 'bilinmiyor']);
    expect(d.oranKirilimi['bilinmiyor']).toMatchObject({ matrah: { toplam: 1000 }, kdv: { toplam: 0, bilinen: 1 }, adet: 1 });
    expect(d.oranKirilimi['0']).toMatchObject({ matrah: { toplam: 1000 }, adet: 1 });
  });
  it('Mikro matrahı bilinmiyor → kovada matrah.bilinmeyen; KDV toplamı yine sayılır', () => {
    const d = kdvDonemi([], [
      { id: 'M8', tarih: '2026-03-25', yon: 'giden', tutar: 1200, matrah: undefined, kdv: 200, oran: 20, oranKarma: false },
    ], 2026, 3);
    expect(d.oranKirilimi['20']).toEqual({ matrah: { toplam: 0, bilinen: 0, bilinmeyen: 1 }, kdv: { toplam: 200, bilinen: 1, bilinmeyen: 0 }, adet: 1, tutarsiz: 1 });
    expect(d.hesaplanan).toEqual({ toplam: 200, bilinen: 1, bilinmeyen: 0 });
  });
});

describe('kdvDonemi — tarih çözümü (zaman.ts, `new Date(string)` yok)', () => {
  it('ay sınırları YEREL gün: 1 Mart ve 31 Mart Mart\'ta, 1 Nisan değil; TR biçimi (01.03.2026) ve Date de çözülür', () => {
    const j = (id: string, date: unknown) => ({ id, date, aciklama: id, debitHesap: '120 - Alıcılar', alacakHesap: '391 - Hesaplanan KDV', borc: 10, alacak: 10 });
    const d = kdvDonemi([
      j('ilk', '2026-03-01'), j('son', '2026-03-31'), j('nisan', '2026-04-01'), j('subat', '2026-02-28'),
      j('tr', '15.03.2026'), j('date', new Date(2026, 2, 20, 12)), j('iso', '2026-03-09T23:30:00'),
    ], [], 2026, 3);
    expect(d.hesaplananListesi.map(r => r.kayit.id)).toEqual(['ilk', 'son', 'tr', 'date', 'iso']);
    expect(d.tarihsiz).toBe(0);
  });
  it('çözülemeyen tarih (boş, null, "abc") hiçbir döneme girmez ve tarihsiz sayılır — journal + Mikro birlikte', () => {
    const d = kdvDonemi([
      { id: 'Yt', date: null, aciklama: 'tarihsiz', debitHesap: '120 - Alıcılar', alacakHesap: '391 - Hesaplanan KDV', borc: 10, alacak: 10 },
      { id: 'Yu', date: 'abc', aciklama: 'bozuk', debitHesap: '120 - Alıcılar', alacakHesap: '391 - Hesaplanan KDV', borc: 10, alacak: 10 },
    ], [
      { id: 'Mt', tarih: '', yon: 'giden', tutar: 120, matrah: 100, kdv: 20, oran: 20, oranKarma: false },
      { id: 'Mu', tarih: undefined, yon: 'gelen', tutar: 120, matrah: 100, kdv: 20, oran: 20, oranKarma: false },
    ], 2026, 3);
    expect(d.tarihsiz).toBe(4);
    expect(d.hesaplanan).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(d.indirilecek).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(d.oranKirilimi).toEqual({});
  });
});

/**
 * `tarihsiz` sayacı KDV'YE GİREBİLECEK kayıtları sayar (2026-09-18 delta turu).
 * Eskiden sayaç hesap/yön süzgeçlerinden ÖNCE artıyordu: tarihi çözülemeyen HER yevmiye kaydı
 * — kasa/banka virmanı dahil — KDV sekmesindeki "N tarihsiz kayıt" notuna giriyordu. Kullanıcı
 * KDV beyanını etkileyen kayıt arıyor, ilgisiz fiş buluyordu. Kardeş modül gelirGider.ts sayacı
 * ZATEN süzgeçten sonra artırıyor ("ilgisiz hesap ve Mikro alış sayılmaz"), yani aynı
 * journalEntries iki sekmede iki farklı tarihsiz sayısı gösteriyordu.
 */
describe('tarihsiz — yalnız KDV ile ilgili kayıtlar (ilgisiz virman notu şişirmez)', () => {
  const virman = (id: string) => ({ id, date: '', aciklama: 'kasa→banka virman', debitHesap: '102 - Bankalar', alacakHesap: '100 - Kasa', borc: 5000, alacak: 5000 });

  it('tarihsiz KDV-DIŞI virman sayılmaz; tarihsiz 391 fişi sayılır', () => {
    // MUTASYON AYIRT EDİCİ: sayaç yeniden süzgeçten ÖNCE artırılırsa burası 41 döner.
    const virmanlar = Array.from({ length: 40 }, (_, i) => virman(`V${i}`));
    const fis391 = { id: 'K1', date: '', aciklama: 'tarihsiz KDV', debitHesap: '120 - Alıcılar', alacakHesap: '391 - Hesaplanan KDV', borc: 900, alacak: 900 };
    expect(kdvDonemi([...virmanlar, fis391], [], 2026, 9).tarihsiz).toBe(1);
    expect(kdvDonemi(virmanlar, [], 2026, 9).tarihsiz).toBe(0);
  });

  it('tarihsiz 191 borç fişi ve tarihsiz 6xx gelir fişi (kırılıma girecek) SAYILIR', () => {
    const f191 = { id: 'K2', date: null, aciklama: '', debitHesap: '191 - İndirilecek KDV', alacakHesap: '320 - Satıcılar', borc: 180, alacak: 180 };
    const f600 = { id: 'K3', date: 'abc', aciklama: '', debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurtiçi Satışlar', borc: 1000, alacak: 1000, kdvOran: 20 };
    expect(kdvDonemi([f191, f600], [], 2026, 9).tarihsiz).toBe(2);
  });

  it('KDV\'siz (oran bilinen ve ≤ 0) tarihsiz gelir fişi sayılmaz — kırılıma da girmiyor', () => {
    const kdvsiz = { id: 'K4', date: '', aciklama: 'ihracat', debitHesap: '120 - Alıcılar', alacakHesap: '601 - Yurtdışı Satışlar', borc: 4000, alacak: 4000, kdvOran: 0 };
    expect(kdvDonemi([kdvsiz], [], 2026, 9).tarihsiz).toBe(0);
    // Oranı BİLİNMEYEN gelir fişi 'bilinmiyor' kovasına girdiği için SAYILIR.
    expect(kdvDonemi([{ ...kdvsiz, id: 'K5', kdvOran: undefined }], [], 2026, 9).tarihsiz).toBe(1);
  });

  it('Mikro: giden ve gelen sayılır (ikisi de KDV\'ye girer), tanınmayan yön sayılmaz', () => {
    const m = (id: string, yon: string) => ({ id, tarih: '', yon, tutar: 120, matrah: 100, kdv: 20, oran: 20, oranKarma: false });
    expect(kdvDonemi([], [m('M1', 'giden'), m('M2', 'gelen')], 2026, 9).tarihsiz).toBe(2);
    expect(kdvDonemi([], [m('M3', 'bilinmiyor')], 2026, 9).tarihsiz).toBe(0);
  });
});
