/** matrahTani — fatura matrahı tanımı ÖLÇÜLÜR (2026-09-28): başlık satırlardan hangi formülle çıkıyor, cha_aratoplam ne. */
import { describe, it, expect } from 'vitest';
import { matrahTaniRaporu, type SatirToplami, type BaslikSatiri } from './matrahTani';

const satir = (sira: number, o: Partial<Record<'tutar' | 'isk' | 'masraf' | 'vergi' | 'masrafVergi' | 'n' | 'bilinmeyen' | 'iptalSatir' | 'iptalTutar' | 'negatifIsk', number | null>>, evraktip = 3): SatirToplami =>
  ({ sth_evraktip: String(evraktip), sth_evrakno_seri: '', sth_evrakno_sira: String(sira), n: 1, isk: 0, masraf: 0, bilinmeyen: 0, iptalSatir: 0, iptalTutar: 0, negatifIsk: 0, ...o });
const baslik = (sira: number, meblag: number | null, o: Partial<BaslikSatiri> = {}, tip = 1): BaslikSatiri =>
  ({ cha_tip: tip, cha_evrakno_seri: '', cha_evrakno_sira: sira, cha_tarihi: '2026-08-31T00:00:00', cha_kod: 'C1', cha_meblag: meblag, iptal: 0, ...o });

describe('matrahTaniRaporu — sınıflar', () => {
  it('iskontolu fatura: meblağ = (brüt − isk) + KDV → tutuyor; KDV hariç net = aratoplam ise "net" ilişkisi', () => {
    // SİZGEN e-faturası gibi: brüt 283.500, isk 114.817,50, net 168.682,50, KDV 33.736,50, toplam 202.419
    const r = matrahTaniRaporu([satir(1, { tutar: 283500, isk: 114817.5, vergi: 33736.5 })], [baslik(1, 202419, { aratoplam: 168682.5 })]);
    expect(r.ozet.sinif.tutuyor).toEqual({ gelen: 1, giden: 0 });
    expect(r.ozet.iskontoluFatura).toBe(1);
    expect(r.ozet.aratoplam).toEqual({ ayirtEdiciFatura: 1, iliski: { brut: 0, net: 1, netMasraf: 1, brutMasraf: 0, meblagEksiKdv: 1 }, hicbiri: 0 });
    expect(r.tutmayanlar).toEqual({});
  });

  it('aratoplam BRÜT ise net ilişkileri sayılmaz (masraf 0 iken brüt = brüt+masraf — ikisi birlikte, ayırt edilemez)', () => {
    const r = matrahTaniRaporu([satir(1, { tutar: 1000, isk: 100, vergi: 180 })], [baslik(1, 1080, { aratoplam: 1000 })]);
    expect(r.ozet.aratoplam.iliski).toEqual({ brut: 1, net: 0, netMasraf: 0, brutMasraf: 1, meblagEksiKdv: 0 });
    const m = matrahTaniRaporu([satir(1, { tutar: 1000, isk: 100, masraf: 40, vergi: 188 })], [baslik(1, 1128, { aratoplam: 1000 })]);
    expect(m.ozet.aratoplam.iliski).toEqual({ brut: 1, net: 0, netMasraf: 0, brutMasraf: 0, meblagEksiKdv: 0 });
  });

  it('iskontosuz VE masrafsız fatura aratoplam ilişkisine GİRMEZ (brüt = net: ayırt etmez)', () => {
    const r = matrahTaniRaporu([satir(1, { tutar: 1000, vergi: 200 })], [baslik(1, 1200, { aratoplam: 1000 })]);
    expect(r.ozet.aratoplam.ayirtEdiciFatura).toBe(0);
    expect(r.ozet.sinif.tutuyor.gelen).toBe(1);
  });

  it('masraf: meblağ = net + masraf + KDV → tutuyor; masraf KDV\'si ayrı kolondaysa tutuyorMasrafVergili', () => {
    const a = matrahTaniRaporu([satir(1, { tutar: 1000, masraf: 50, vergi: 210 })], [baslik(1, 1260)]);
    expect(a.ozet.sinif.tutuyor.gelen).toBe(1);
    expect(a.ozet.masrafliFatura).toBe(1);
    const b = matrahTaniRaporu([satir(1, { tutar: 1000, masraf: 50, vergi: 200, masrafVergi: 10 })], [baslik(1, 1260)]);
    expect(b.ozet.sinif.tutuyorMasrafVergili.gelen).toBe(1);
    expect(b.ozet.masrafVergiliFatura).toBe(1);
  });

  it('iskontolu faturada meblağ İSKONTO DÜŞÜLMEDEN tutuyorsa işaretlenir (sth_tutar zaten net varsayımı)', () => {
    const r = matrahTaniRaporu([satir(1, { tutar: 900, isk: 100, vergi: 180 })], [baslik(1, 1080)]);
    expect(r.ozet.sinif.iskontosuzTutuyor.gelen).toBe(1);
    expect(r.tutmayanlar.iskontosuzTutuyor?.[0]).toMatchObject({ sira: '1', beklenen: 980, fark: 100 });
  });

  it('satıra dağıtılmamış fatura altı iskonto: meblağ satırlardan AZ → eksik, fark eksi; ft iskontolu başlık sayılır', () => {
    const r = matrahTaniRaporu([satir(1, { tutar: 2240, vergi: 403.2 })], [baslik(1, 2419.2, { ftIsk: 224 })]);
    expect(r.ozet.sinif.eksik.gelen).toBe(1);
    expect(r.ozet.faturaAltiIskontoluBaslik).toBe(1);
    expect(r.tutmayanlar.eksik?.[0].fark).toBeCloseTo(-224, 2);
  });

  it('satırsız başlık, bilinmeyen satır, meblağsız başlık ayrı sınıflar; iptal başlık sayılmaz', () => {
    const r = matrahTaniRaporu(
      [satir(2, { tutar: 100, vergi: null }), satir(3, { tutar: 100, vergi: 20, bilinmeyen: 1 })],
      [baslik(1, 500, { aratoplam: 450 }), baslik(2, 120), baslik(3, 120), baslik(4, null), baslik(5, 999, { iptal: 1 })],
    );
    expect(r.ozet).toMatchObject({ baslik: 4, iptalBaslik: 1 });
    expect(r.ozet.sinif.satirsiz.gelen).toBe(1);
    expect(r.ozet.sinif.satirBilinmiyor.gelen).toBe(2);
    expect(r.ozet.sinif.meblagBilinmiyor.gelen).toBe(1);
    expect(r.tutmayanlar.satirsiz?.[0]).toMatchObject({ sira: '1', meblag: 500, aratoplam: 450, satirSayisi: null });
  });

  it('yön eşleşmesi: satış başlığı (cha_tip 0) evraktip 4 satırıyla eşleşir, aynı numaralı alış satırıyla DEĞİL', () => {
    const r = matrahTaniRaporu([satir(7, { tutar: 100, vergi: 20 }, 4), satir(7, { tutar: 999, vergi: 1 }, 3)], [baslik(7, 120, {}, 0)]);
    expect(r.ozet.sinif.tutuyor).toEqual({ gelen: 0, giden: 1 });
  });

  it('pay YALNIZ yuvarlamaya bağlı (0,06 + satır başına 0,02): 600.000 ₺\'lik 12 satırlı faturada 250 ₺ iskonto AYIRT EDİLİR', () => {
    // Eski oransal pay (binde yarım = 300 ₺) bu iskontoyu yutup "tutuyor" diyordu — iskonto düşülmeden de tutuyor olurdu.
    const net = matrahTaniRaporu([satir(1, { tutar: 500250, isk: 250, vergi: 100000, n: 12 })], [baslik(1, 600000)]);
    expect(net.ozet.sinif.tutuyor.gelen).toBe(1);
    const brut = matrahTaniRaporu([satir(1, { tutar: 500000, isk: 250, vergi: 100000, n: 12 })], [baslik(1, 600000)]);
    expect(brut.ozet.sinif.iskontosuzTutuyor.gelen).toBe(1);
  });

  it('iskonto payın içindeyse iki formül de tutar → ayirtEdilemez (tutuyor ÖNCELİĞİ yok, kanıt sayılmaz)', () => {
    const r = matrahTaniRaporu([satir(1, { tutar: 1000, isk: 0.05, vergi: 200 })], [baslik(1, 1199.97, { aratoplam: 999.95 })]);
    expect(r.ozet.sinif.ayirtEdilemez.gelen).toBe(1);
    expect(r.ozet.aratoplam.ayirtEdiciFatura).toBe(0);                                      // payın içindeki iskonto ayırt etmez
    expect(r.tutmayanlar.ayirtEdilemez?.[0].sira).toBe('1');
  });

  it('satır başına pay bileşeni: 10 satırda 0,12 fark tutuyor, tek satırda fazla', () => {
    expect(matrahTaniRaporu([satir(1, { tutar: 100, vergi: 20, n: 10 })], [baslik(1, 120.12)]).ozet.sinif.tutuyor.gelen).toBe(1);
    expect(matrahTaniRaporu([satir(1, { tutar: 100, vergi: 20, n: 1 })], [baslik(1, 120.12)]).ozet.sinif.fazla.gelen).toBe(1);
  });

  it('iskonto brüte iki kez eklenmiş kayıt "tutuyor" GÖRÜNÜR (iç tutarlı) → iskontoluTutuyor listesinde etkin KDV %11,9 / çift okuma %20', () => {
    // Evrak 420: sth_tutar 398.317,50, Σisk 114.817,50, KDV 33.736,50, Mikro başlığı 317.236,50 (e-fatura 202.419).
    const r = matrahTaniRaporu([satir(420, { tutar: 398317.5, isk: 114817.5, vergi: 33736.5 })], [baslik(420, 317236.5)]);
    expect(r.ozet.sinif.tutuyor.gelen).toBe(1);
    expect(r.iskontoluTutuyor).toHaveLength(1);
    expect(r.iskontoluTutuyor[0]).toMatchObject({ sira: '420', etkinKdvOrani: 11.9, ciftIskontoKdvOrani: 20 });
    expect(r.ozet.not).toContain('İÇ TUTARLI');
  });

  it('iptal satırları: yalnız iptal satırlı grup ayrı sınıf; iptalsizin yanındaki iptal satırı sayılır; negatif iskonto toplanır', () => {
    const r = matrahTaniRaporu(
      [satir(1, { n: 0, tutar: null, vergi: null, iptalSatir: 2, iptalTutar: 500 }), satir(2, { tutar: 100, vergi: 20, iptalSatir: 1, iptalTutar: 40, negatifIsk: 1 })],
      [baslik(1, 600), baslik(2, 120)],
    );
    expect(r.ozet.sinif.yalnizIptalSatirli.gelen).toBe(1);
    expect(r.ozet.sinif.tutuyor.gelen).toBe(1);
    expect(r.ozet).toMatchObject({ iptalSatirliFatura: 1, iptalTutarToplami: 40, negatifIskSatir: 1 });
    expect(r.iptalSatirliFaturalar.map(o => o.sira)).toEqual(['2']);                         // 'tutuyor' olsa da listede
    expect(r.tutmayanlar.yalnizIptalSatirli?.[0]).toMatchObject({ sira: '1', iptalSatir: 2, iptalTutar: 500 });
  });

  it('aynı anahtara düşen birden çok iptalsiz başlık ortakAnahtar — sınıflanmaz; iptal başlık sayıma girmez', () => {
    const r = matrahTaniRaporu([satir(5, { tutar: 100, vergi: 20 })], [baslik(5, 120), baslik(5, 60), baslik(6, 1, { iptal: 1 }), baslik(6, 12)]);
    expect(r.ozet.sinif.ortakAnahtar.gelen).toBe(2);
    expect(r.ozet.sinif.satirsiz.gelen).toBe(1);                                            // 6: iptal ikiz sayılmadı
    // Ortak anahtarlı iki başlık aynı iptalli satır grubunu paylaşınca fatura BİR kez sayılır.
    const i = matrahTaniRaporu([satir(8, { tutar: 100, vergi: 20, iptalSatir: 1, iptalTutar: 5 })], [baslik(8, 120), baslik(8, 60)]);
    expect(i.ozet).toMatchObject({ iptalSatirliFatura: 1, iptalTutarToplami: 5 });
  });

  it('iskontoluTutuyor sessizce kesilmez: toplam sayı ozet\'te, liste iskonto büyükten küçüğe', () => {
    const satirlar = Array.from({ length: 5 }, (_, i) => satir(i + 1, { tutar: 1000, isk: 10 * (i + 1), vergi: 200 - 2 * (i + 1) }));
    const basliklar = satirlar.map((_, i) => baslik(i + 1, 1000 - 10 * (i + 1) + 200 - 2 * (i + 1)));
    const r = matrahTaniRaporu(satirlar, basliklar, 3);
    expect(r.ozet.iskontoluTutuyorSayisi).toBe(5);
    expect(r.iskontoluTutuyor.map(o => o.sira)).toEqual(['5', '4', '3']);
  });

  it('yuvarlama payı: çok satırlı faturada kuruş farkları tutuyor sayılır, gerçek fark sayılmaz', () => {
    const r = matrahTaniRaporu([satir(1, { tutar: 1000, vergi: 200, n: 10 })], [baslik(1, 1200.1)]);
    expect(r.ozet.sinif.tutuyor.gelen).toBe(1);
    const f = matrahTaniRaporu([satir(1, { tutar: 1000, vergi: 200, n: 2 })], [baslik(1, 1201)]);
    expect(f.ozet.sinif.fazla.gelen).toBe(1);
  });

  it('sınıf başına kesme: liste sınırı aşılırsa kalan sayı yazılır (sessiz kesme yok); büyük fark önce', () => {
    const satirlar = [1, 2, 3].map(i => satir(i, { tutar: 100, vergi: 20 }));
    const r = matrahTaniRaporu(satirlar, [baslik(1, 110), baslik(2, 100), baslik(3, 119)], 2);
    expect(r.tutmayanlar.eksik?.map(o => o.sira)).toEqual(['2', '1']);
    expect(r.kesildi).toEqual({ eksik: 1 });
  });
});
