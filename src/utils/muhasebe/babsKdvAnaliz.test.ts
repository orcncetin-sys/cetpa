/**
 * babsKdvAnaliz.test.ts — MuhasebePage üç panelinin hesap sözleşmesi. ÖNCE YAZILDI (Faz 3 1/n, 2026-09-13).
 *
 *   • Phase 555 Ba/Bs Formu       (MuhasebePage ~2013-2110)  baMap/bsMap: `(baMap[ad] || 0) + f.tutar`
 *   • Phase 557 Senaryo Bütçesi   (~2112-2207)  `reduce(s + (o.totalPrice || 0))`, `/ (… || 1)`, `margin : 0`
 *   • Phase 558 KDV Analiz Raporu (~2209-2373)  `reduce(s + f.kdv)`, `f.kdv > 0` süzgeci, `rateMap[key] || 0`
 *
 * Kural (CLAUDE.md): bilinmeyen tutar 0 DEĞİL — toplama girmez, SAYILIR (`bilinmeyen`); ekranda '—' + not.
 * Oran/ortalama hesaplanamıyorsa null — %0 ya da ₺0K uydurulmaz. Tarihi çözülemeyen kayıt bugüne düşmez, sayılır.
 */
import { describe, it, expect } from 'vitest';
import { donemAnahtari, babsFormu, ciroTemeli, senaryoProjeksiyonu, kdvAnalizi, kdvOranAnahtari } from './babsKdvAnaliz';
import { ekranTutari, bilinenSayi } from '../para';

const SIMDI = new Date(2026, 8, 13, 10, 0, 0); // 13 Eyl 2026 10:00 (yerel)
const gun = (y: number, ay: number, g: number) => new Date(y, ay - 1, g, 12);
const zorunlu = <T,>(v: T | null): T => { if (v === null) throw new Error('null beklenmiyordu'); return v; };

describe('donemAnahtari — kaydın YYYY-MM dönemi (zaman.ts gunAnahtari üstüne)', () => {
  it("'YYYY-MM-DD' YEREL gün olarak çözülür — ayın 1'i UTC kaymasıyla önceki aya düşmez", () => {
    expect(donemAnahtari('2026-09-01')).toBe('2026-09');
    expect(donemAnahtari('2026-12-31')).toBe('2026-12');
  });
  it('Türk biçimi, Date ve ham Timestamp zarfı da çözülür', () => {
    expect(donemAnahtari('05.09.2026')).toBe('2026-09');
    expect(donemAnahtari(gun(2026, 8, 20))).toBe('2026-08');
    expect(donemAnahtari({ _seconds: Math.floor(gun(2026, 7, 15).getTime() / 1000), _nanoseconds: 0 })).toBe('2026-07');
  });
  it("çözülemeyen (''/undefined/null/'abc') → null — BUGÜNE DÜŞMEZ", () => {
    expect(donemAnahtari('')).toBeNull();
    expect(donemAnahtari(undefined)).toBeNull();
    expect(donemAnahtari(null)).toBeNull();
    expect(donemAnahtari('abc')).toBeNull();
  });
});

// ── Phase 555: Ba/Bs ───────────────────────────────────────────────────────────────────────

const CARI_AD = new Map<string, string>([
  ['ŞİŞ01', 'Şişecam İnşaat'], ['IŞK02', 'Işık Çelik'], ['ÇAĞ03', 'Çağlar Nakliyat'], ['ÖMR04', 'Ömer Yapı'], ['ÜLK05', 'Ülkü Boya'],
]);
const cariAd = (kod: string) => CARI_AD.get(kod);

const FATURALAR = [
  { cariKod: 'ŞİŞ01', yon: 'gelen', tarih: '2026-09-03', tutar: 3000 },
  { cariKod: 'ŞİŞ01', yon: 'gelen', tarih: '2026-09-15', tutar: 2500 },      // Şişecam toplam 5.500 → Ba'da
  { cariKod: 'IŞK02', yon: 'gelen', tarih: '2026-09-10', tutar: 4999 },      // eşik altı, KESİN → dışarıda
  { cariKod: 'ÇAĞ03', yon: 'gelen', tarih: '2026-09-20', tutar: 1000 },
  { cariKod: 'ÇAĞ03', yon: 'gelen', tarih: '2026-09-21', tutar: undefined }, // bilinmeyen → eşik kararı verilemez
  { cariKod: 'ÜLK05', yon: 'gelen', tarih: '2026-09-05', tutar: '6000' },    // sayısal string bilinir
  { cariKod: 'ÖMR04', yon: 'giden', tarih: '2026-09-12', tutar: 12000 },     // Bs
  { cariKod: 'ŞİŞ01', yon: 'gelen', tarih: '2026-08-30', tutar: 99999 },     // başka dönem
  { cariKod: 'ŞİŞ01', yon: 'gelen', tarih: '', tutar: 7000 },                // tarihsiz — hiçbir döneme giremez
  { cariKod: 'KODSUZ', yon: 'giden', tarih: '2026-09-25', tutar: 8000 },     // adı yok → kod
  { cariKod: '', yon: 'giden', tarih: '2026-09-26', tutar: 9000 },           // kodu da yok → '—'
];

describe('babsFormu — cari bazında ≥ ₺5.000 alım (Ba) / satış (Bs) bildirimi', () => {
  it('Ba: dönemdeki GELEN faturalar cari bazında toplanır, eşik üstü azalan sırada', () => {
    const ba = babsFormu(FATURALAR, 'gelen', '2026-09', cariAd);
    expect(ba.satirlar.map(s => s.ad)).toEqual(['Ülkü Boya', 'Şişecam İnşaat']);
    expect(ba.satirlar[0]?.tutar).toEqual({ toplam: 6000, bilinen: 1, bilinmeyen: 0 });
    expect(ba.satirlar[1]?.tutar).toEqual({ toplam: 5500, bilinen: 2, bilinmeyen: 0 });
    expect(ba.toplam).toEqual({ toplam: 11500, bilinen: 3, bilinmeyen: 0 });
    expect(ba.faturaSayisi).toBe(6);
  });
  it('tutarı bilinmeyen faturası olan eşik-altı cari DIŞLANAMAZ → `belirsiz` listesine düşer (eski kod 0 sayıp beyandan düşürüyordu)', () => {
    const ba = babsFormu(FATURALAR, 'gelen', '2026-09', cariAd);
    expect(ba.belirsiz).toEqual([{ ad: 'Çağlar Nakliyat', tutar: { toplam: 1000, bilinen: 1, bilinmeyen: 1 } }]);
    expect(ba.satirlar.map(s => s.ad)).not.toContain('Işık Çelik'); // kesin eşik altı: belirsiz DEĞİL
    expect(ba.belirsiz.map(s => s.ad)).not.toContain('Işık Çelik');
  });
  it('tarihi çözülemeyen fatura hiçbir döneme girmez, `tarihsiz` sayılır', () => {
    expect(babsFormu(FATURALAR, 'gelen', '2026-09', cariAd).tarihsiz).toBe(1);
    expect(babsFormu(FATURALAR, 'gelen', '2026-08', cariAd).satirlar).toEqual([{ ad: 'Şişecam İnşaat', tutar: { toplam: 99999, bilinen: 1, bilinmeyen: 0 } }]);
  });
  it('Bs: GİDEN faturalar; cari adı yoksa kod, kod da yoksa "—" (sayfadaki sıra)', () => {
    const bs = babsFormu(FATURALAR, 'giden', '2026-09', cariAd);
    expect(bs.satirlar.map(s => [s.ad, s.tutar.toplam])).toEqual([['Ömer Yapı', 12000], ['—', 9000], ['KODSUZ', 8000]]);
    expect(bs.belirsiz).toEqual([]);
    expect(bs.tarihsiz).toBe(0);
  });
  it('eşik üstü cari, bilinmeyen faturası olsa da satırdadır; sayaç toplamda taşınır', () => {
    const ba = babsFormu([
      { cariKod: 'ŞİŞ01', yon: 'gelen', tarih: '2026-09-01', tutar: 6000 },
      { cariKod: 'ŞİŞ01', yon: 'gelen', tarih: '2026-09-02', tutar: null },
    ], 'gelen', '2026-09', cariAd);
    expect(ba.satirlar).toEqual([{ ad: 'Şişecam İnşaat', tutar: { toplam: 6000, bilinen: 1, bilinmeyen: 1 } }]);
    expect(ba.belirsiz).toEqual([]);
    expect(ba.toplam.bilinmeyen).toBe(1);
  });
  it("yalnız bilinmeyen tutarlı cari: belirsiz, ekran tutarı NaN → '—' (0 DEĞİL)", () => {
    const ba = babsFormu([
      { cariKod: 'ÇAĞ03', yon: 'gelen', tarih: '2026-09-01', tutar: NaN },
      { cariKod: 'ÇAĞ03', yon: 'gelen', tarih: '2026-09-02', tutar: '' },
    ], 'gelen', '2026-09', cariAd);
    expect(ba.satirlar).toEqual([]);
    expect(ba.belirsiz[0]?.tutar).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 2 });
    expect(ekranTutari(zorunlu(ba.belirsiz[0] ?? null).tutar)).toBeNaN();
  });
  it('boş liste → boş form; eşik parametre ile değişir', () => {
    expect(babsFormu([], 'gelen', '2026-09', cariAd)).toEqual({ satirlar: [], belirsiz: [], toplam: { toplam: 0, bilinen: 0, bilinmeyen: 0 }, faturaSayisi: 0, tarihsiz: 0 });
    expect(babsFormu(FATURALAR, 'gelen', '2026-09', cariAd, 1000).satirlar.map(s => s.ad)).toEqual(['Ülkü Boya', 'Şişecam İnşaat', 'Işık Çelik', 'Çağlar Nakliyat']);
  });
});

// ── Phase 557: Senaryo Bütçesi ─────────────────────────────────────────────────────────────

const SIPARISLER = [
  { customerName: 'Şirin Yapı', createdAt: gun(2026, 9, 2), totalPrice: 10000, status: 'Delivered' },
  { customerName: 'Işık Çelik', createdAt: '2026-09-02', totalPrice: 5000, status: 'Pending' },
  { customerName: 'İptal', createdAt: gun(2026, 9, 5), totalPrice: 99999, status: 'Cancelled' },
  { customerName: 'İptal tutarsız', createdAt: gun(2026, 9, 6), totalPrice: undefined, status: 'Cancelled' },
  { customerName: 'Ağustos', createdAt: { _seconds: Math.floor(gun(2026, 8, 10).getTime() / 1000), _nanoseconds: 0 }, totalPrice: 8000, status: 'Delivered' },
  { customerName: 'Temmuz tutarsız', createdAt: gun(2026, 7, 7), totalPrice: undefined, status: 'Delivered' },
  { customerName: 'Mayıs', createdAt: '15.05.2026', totalPrice: 6000, status: 'Delivered' },
  { customerName: 'Mart (pencere dışı)', createdAt: gun(2026, 3, 1), totalPrice: 50000, status: 'Delivered' },
  { customerName: 'Tarihsiz', createdAt: undefined, totalPrice: 7000, status: 'Delivered' },
];

describe('ciroTemeli — son 6 ayın ciro tabanı (senaryo projeksiyonunun girdisi)', () => {
  it('aylar eskiden yeniye 6 adet; iptal dışlanır; bilinmeyen tutar toplama girmez, sayılır', () => {
    const t = ciroTemeli(SIPARISLER, SIMDI);
    expect(t.aylar.map(a => a.ay)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(t.aylar.map(a => a.ciro)).toEqual([
      { toplam: 0, bilinen: 0, bilinmeyen: 0 },
      { toplam: 6000, bilinen: 1, bilinmeyen: 0 },
      { toplam: 0, bilinen: 0, bilinmeyen: 0 },
      { toplam: 0, bilinen: 0, bilinmeyen: 1 },
      { toplam: 8000, bilinen: 1, bilinmeyen: 0 },
      { toplam: 15000, bilinen: 2, bilinmeyen: 0 },
    ]);
    expect(t.bilinmeyen).toBe(1); // iptal edilmiş tutarsız sipariş SAYILMAZ (zaten dışarıda)
    expect(t.tarihsiz).toBe(1);
  });
  it('ortalama = Σciro / cirolu ay sayısı (sayfadaki v>0 süzgeci); pencere dışı ay girmez', () => {
    const t = ciroTemeli(SIPARISLER, SIMDI);
    expect(t.ciroluAy).toBe(3);
    expect(t.ortalama).toBeCloseTo((6000 + 8000 + 15000) / 3, 6);
  });
  it('hiç cirolu ay yoksa ortalama null — ₺0 taban uydurulmaz (eski `|| 1` böleni 0 basıyordu)', () => {
    expect(ciroTemeli([], SIMDI).ortalama).toBeNull();
    const t = ciroTemeli([{ createdAt: gun(2026, 9, 1), totalPrice: undefined, status: 'Delivered' }], SIMDI);
    expect(t.ortalama).toBeNull();
    expect(t.bilinmeyen).toBe(1);
  });
  it('ay adedi parametre', () => {
    expect(ciroTemeli(SIPARISLER, SIMDI, 3).aylar.map(a => a.ay)).toEqual(['2026-07', '2026-08', '2026-09']);
  });
});

describe('senaryoProjeksiyonu — 12 aylık ciro/gider/net/marj', () => {
  const IYIMSER = { buyume: 0.2, giderBuyume: 0.1 };
  it('taban null → projeksiyon null (ekran "—"); NaN da null', () => {
    expect(senaryoProjeksiyonu(null, IYIMSER, SIMDI)).toBeNull();
    expect(senaryoProjeksiyonu(NaN, IYIMSER, SIMDI)).toBeNull();
  });
  it('aylar bir sonraki aydan başlar; ciro = round(taban·(1+g)^n), gider = round(taban·0,65·(1+eg)^n)', () => {
    const p = zorunlu(senaryoProjeksiyonu(10000, IYIMSER, SIMDI));
    expect(p.aylar).toHaveLength(12);
    expect(p.aylar[0]?.tarih).toEqual(new Date(2026, 9, 1));
    expect(p.aylar[11]?.tarih).toEqual(new Date(2027, 8, 1));
    expect(p.aylar[0]).toMatchObject({ ciro: 12000, gider: 7150, net: 4850, marj: 40 });
    expect(p.aylar[1]).toMatchObject({ ciro: 14400, gider: 7865, net: 6535, marj: 45 });
  });
  it('toplamlar aylık YUVARLANMIŞ değerlerin toplamı (sayfadaki gibi); net = ciro − gider', () => {
    const p = zorunlu(senaryoProjeksiyonu(10000, IYIMSER, SIMDI));
    expect(p.toplamCiro).toBe(p.aylar.reduce((s, m) => s + m.ciro, 0));
    expect(p.toplamGider).toBe(p.aylar.reduce((s, m) => s + m.gider, 0));
    expect(p.toplamNet).toBe(p.toplamCiro - p.toplamGider);
  });
  it('kötümser senaryo küçülür; ciro ≤ 0 iken marj null (eski kod %0 basıyordu)', () => {
    expect(zorunlu(senaryoProjeksiyonu(10000, { buyume: -0.1, giderBuyume: 0.02 }, SIMDI)).aylar[0]?.ciro).toBe(9000);
    expect(zorunlu(senaryoProjeksiyonu(0, IYIMSER, SIMDI)).aylar[0]?.marj).toBeNull();
  });
  it('gider oranı ve ay adedi parametre', () => {
    const p = zorunlu(senaryoProjeksiyonu(10000, { buyume: 0, giderBuyume: 0 }, SIMDI, 3, 0.5));
    expect(p.aylar.map(m => m.gider)).toEqual([5000, 5000, 5000]);
    expect(p.toplamNet).toBe(15000);
  });
});

// ── Phase 558: KDV Analiz ──────────────────────────────────────────────────────────────────

const KDV_FATURALARI = [
  { cariKod: 'ŞİŞ01', yon: 'giden', tarih: '2026-01-10', kdv: 2000, oran: 20, oranKarma: false },
  { cariKod: 'IŞK02', yon: 'giden', tarih: '2026-01-20', kdv: 500, oran: 10, oranKarma: false },
  { cariKod: 'ÇAĞ03', yon: 'gelen', tarih: '2026-01-05', kdv: 800, oran: 20, oranKarma: false },
  { cariKod: 'ÖMR04', yon: 'giden', tarih: '2026-03-01', kdv: undefined, oran: 20, oranKarma: false }, // KDV'si bilinmeyen satış
  { cariKod: 'ÜLK05', yon: 'giden', tarih: '2026-03-02', kdv: 300, oran: 20, oranKarma: true },       // karma oranlı
  { cariKod: 'ŞİŞ01', yon: 'giden', tarih: '2026-04-01', kdv: 100, oran: null, oranKarma: false },     // oranı çözülememiş
  { cariKod: 'ŞİŞ01', yon: 'giden', tarih: '2026-05-01', kdv: 0, oran: 0, oranKarma: false },          // KDV'siz (istisna)
  { cariKod: 'ÇAĞ03', yon: 'gelen', tarih: '2026-06-01', kdv: NaN, oran: 20, oranKarma: false },       // KDV'si bilinmeyen alış
  { cariKod: 'IŞK02', yon: 'giden', tarih: '2026-07-01', kdv: '250', oran: 20, oranKarma: false },
  { cariKod: 'IŞK02', yon: 'giden', tarih: '2026-08-01', kdv: -100, oran: 20, oranKarma: false },      // iade
  { cariKod: 'ŞİŞ01', yon: 'giden', tarih: '2025-12-31', kdv: 9999, oran: 20, oranKarma: false },      // başka yıl
  { cariKod: 'ŞİŞ01', yon: 'giden', tarih: '', kdv: 1234, oran: 20, oranKarma: false },                // tarihsiz
];

describe('kdvOranAnahtari — oran kovası', () => {
  it('karma > sayısal oran > bilinmiyor', () => {
    expect(kdvOranAnahtari({ oran: 20, oranKarma: true })).toBe('karma');
    expect(kdvOranAnahtari({ oran: 20, oranKarma: false })).toBe('20');
    expect(kdvOranAnahtari({ oran: '10' })).toBe('10');
    expect(kdvOranAnahtari({ oran: null })).toBe('bilinmiyor');
    expect(kdvOranAnahtari({ oran: NaN })).toBe('bilinmiyor');
    expect(kdvOranAnahtari({})).toBe('bilinmiyor');
  });
});

describe('kdvAnalizi — yıllık tahsil edilen / ödenen / net KDV', () => {
  it('12 ay Ocak→Aralık; giden=tahsil, gelen=ödenen; bilinmeyen KDV toplama girmez, sayılır', () => {
    const k = kdvAnalizi(KDV_FATURALARI, 2026);
    expect(k.aylar).toHaveLength(12);
    expect(k.aylar.map(a => a.anahtar)[0]).toBe('2026-01');
    expect(k.aylar[0]).toMatchObject({ ay: 1, tahsil: { toplam: 2500, bilinen: 2, bilinmeyen: 0 }, odenen: { toplam: 800, bilinen: 1, bilinmeyen: 0 }, net: 1700, bilinmeyen: 0 });
    expect(k.aylar[2]).toMatchObject({ ay: 3, tahsil: { toplam: 300, bilinen: 1, bilinmeyen: 1 }, bilinmeyen: 1 });
    expect(ekranTutari(k.aylar[2]?.tahsil ?? { toplam: NaN, bilinen: 0, bilinmeyen: 0 })).toBe(300);   // tahsil hücresi kısmi + not
    expect(k.aylar[2]?.net).toBeNaN();                                                               // net kısmi KDV'den TÜRETİLMEZ
    expect(k.aylar[4]).toMatchObject({ ay: 5, tahsil: { toplam: 0, bilinen: 1, bilinmeyen: 0 }, net: 0 }); // KDV'siz fatura: 0 BİLİNİR
    expect(k.aylar[7]).toMatchObject({ ay: 8, tahsil: { toplam: -100, bilinen: 1, bilinmeyen: 0 }, net: -100 }); // iade aylık nete girer
  });
  it("ayın tek KDV kaydı bilinmiyorsa o tarafın ekran tutarı NaN → net NaN ('—'), 0 DEĞİL", () => {
    const haziran = zorunlu(kdvAnalizi(KDV_FATURALARI, 2026).aylar[5] ?? null);
    expect(haziran.odenen).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(ekranTutari(haziran.odenen)).toBeNaN();
    expect(haziran.net).toBeNaN();
    expect(haziran.bilinmeyen).toBe(1);
  });
  it('yıl toplamları ve net; başka yıl ve tarihsiz kayıtlar girmez ama tarihsiz SAYILIR', () => {
    const k = kdvAnalizi(KDV_FATURALARI, 2026);
    expect(k.toplamTahsil).toEqual({ toplam: 3050, bilinen: 7, bilinmeyen: 1 });
    expect(k.toplamOdenen).toEqual({ toplam: 800, bilinen: 1, bilinmeyen: 1 });
    expect(k.toplamNet).toBeNaN();                       // yılda 2 bilinmeyen KDV → yıl neti türetilmez ('—' + not)
    expect(kdvAnalizi(KDV_FATURALARI.filter(f => bilinenSayi(f.kdv)), 2026).toplamNet).toBe(2250);   // hepsi bilinince sayı
    expect(k.faturaSayisi).toBe(10);
    expect(k.tarihsiz).toBe(1);
    expect(kdvAnalizi(KDV_FATURALARI, 2025)).toMatchObject({ faturaSayisi: 1, toplamTahsil: { toplam: 9999, bilinen: 1, bilinmeyen: 0 } });
  });
  it('oran dağılımı yalnız GİDEN ve KDV>0 (ya da bilinmeyen) faturalardan; KDV=0 ve iade kovaya girmez', () => {
    const { oranDagilimi } = kdvAnalizi(KDV_FATURALARI, 2026);
    expect(oranDagilimi).toEqual({
      '20': { toplam: 2250, bilinen: 2, bilinmeyen: 1 }, // 2000 + '250'; Mart'ın bilinmeyeni oranı bilindiği için burada sayılır
      '10': { toplam: 500, bilinen: 1, bilinmeyen: 0 },
      karma: { toplam: 300, bilinen: 1, bilinmeyen: 0 },
      bilinmiyor: { toplam: 100, bilinen: 1, bilinmeyen: 0 },
    });
    expect(Object.keys(oranDagilimi)).not.toContain('0');
  });
  it('boş liste → 12 sıfır ay, toplam 0, dağılım boş, uyarı için faturaSayisi 0', () => {
    const k = kdvAnalizi([], 2026);
    expect(k.aylar.every(a => a.net === 0 && a.bilinmeyen === 0)).toBe(true);
    expect(k.toplamNet).toBe(0);
    expect(k.oranDagilimi).toEqual({});
    expect(k.faturaSayisi).toBe(0);
  });
});
