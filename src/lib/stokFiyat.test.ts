/**
 * stokFiyat.test.ts — Fiyat Karşılaştırma raporunun hesabı (ÖNCE yazıldı, 2026-09-18).
 *
 * KULLANICI BİLDİRİMİ: "Fatura altı iskontoları fiyat karşılaştırmasında ortalama fiyat alımına dahil
 * edilmiyor — hatalı fiyat geliyor." Rapor `sth_tutar / sth_miktar` (BRÜT satır tutarı) kullanıyordu; Mikro
 * satır ve fatura altı (evrak) iskontolarını satırın `sth_iskonto<N>` alanlarında tutar — hiçbiri düşülmüyordu.
 * İkinci arıza aynı döngüdeydi: `Number(m.sth_tutar) || 0` tutarı bilinmeyen satırı ₺0 tutarla ama GERÇEK
 * miktarla ortalamaya sokup fiyatı aşağı çekiyordu (CLAUDE.md: sayısal alanda `|| 0` yasak).
 */
import { describe, it, expect } from 'vitest';
import { satirNet, stokFiyatOzeti, stokFiyatDetay, faturaToplamlari, kalemleriCoz, birimFiyatOndaligi, faturaAnahtari, birimSapmalari, BIRIM_SAPMA_KATI, kalemSaglamasi, saglamaKur, mikroTutarsizliklari, netCozumleri, kdvOranaUymuyor } from './stokFiyat';

const alis = (p: Record<string, unknown>) => ({ sth_stok_kod: 'CIM-50', sth_tip: 0, sth_miktar: 10, sth_tutar: 1000, ...p });
const satis = (p: Record<string, unknown>) => ({ sth_stok_kod: 'CIM-50', sth_tip: 1, sth_miktar: 4, sth_tutar: 600, ...p });

describe('satirNet — satır NET tutarı = brüt − Σ sth_iskonto<N> (satır + fatura altı iskontoları)', () => {
  it('satır iskontosu (1) ve faturaya dağıtılmış fatura altı iskontosu (4) birlikte düşülür', () => {
    const r = satirNet(alis({ sth_iskonto1: 100, sth_iskonto4: 50, sth_vergi: 170, sth_tarih: '2025-09-06' }));   // KDV %20 × 850 = 170 ✓
    expect(r).toEqual({ durum: 'tamam', miktar: 10, brut: 1000, iskonto: 150, net: 850, birimFiyat: 85, iskontoKolonlari: ['sth_iskonto1', 'sth_iskonto4'], kaynak: 'satirIskontosu' });
  });
  it('iskonto kolonu AİLESİ katı eşleşir: sth_iskonto<rakam>; sth_isk_mas1 / sth_iskonto_aciklama / sth_tutar değil', () => {
    const r = satirNet(alis({ STH_ISKONTO2: '25,5'.replace(',', '.'), sth_isk_mas1: 1, sth_iskonto_aciklama: 99, sth_masraf1: 40 }));
    expect(r.durum).toBe('tamam');
    if (r.durum !== 'tamam') return;
    expect(r.iskonto).toBeCloseTo(25.5, 6);
    expect(r.iskontoKolonlari).toEqual(['sth_iskonto2']);
    expect(r.net).toBeCloseTo(974.5, 6);
  });
  it('iskonto alanı boş/null ise iskonto YOK sayılır (0), satır geçerli', () => {
    expect(satirNet(alis({ sth_iskonto1: null, sth_iskonto2: '' }))).toMatchObject({ durum: 'tamam', iskonto: 0, net: 1000, birimFiyat: 100 });
  });
  it("tutarı BİLİNMEYEN satır ₺0 sayılmaz: ortalamaya girmez (eski `|| 0` miktarı sayıp tutarı 0 alıyordu)", () => {
    for (const bozuk of [null, undefined, '', 'abc', NaN]) expect(satirNet(alis({ sth_tutar: bozuk })).durum).toBe('tutarBilinmiyor');
    expect(satirNet(alis({ sth_tutar: 0 }))).toMatchObject({ durum: 'tamam', net: 0, birimFiyat: 0 });   // bedelsiz satır GERÇEK 0
  });
  it('miktarı bilinmeyen satır sayılır; miktarı 0 olan satır (fiyat farkı vb.) birim fiyat üretmez ama bilinmeyen de değildir', () => {
    expect(satirNet(alis({ sth_miktar: null })).durum).toBe('miktarBilinmiyor');
    expect(satirNet(alis({ sth_miktar: 0 })).durum).toBe('miktarSifir');
  });
  it('iskonto brütü aşıyorsa veri tutarsızdır: satır ortalamaya girmez (negatif fiyat üretilmez)', () => {
    expect(satirNet(alis({ sth_iskonto1: 1200 })).durum).toBe('iskontoTutarsiz');
  });
  it('kuruş/kayan nokta farkı TOLERE edilir: %100 iskontolu (mal fazlası) satır net 0 ile GİRER, dışlanmaz', () => {
    expect(satirNet(alis({ sth_tutar: 0.3, sth_iskonto1: 0.1, sth_iskonto2: 0.2 }))).toMatchObject({ durum: 'tamam', net: 0 });
    expect(satirNet(alis({ sth_tutar: 99.999, sth_iskonto1: 100 }))).toMatchObject({ durum: 'tamam', net: 0, birimFiyat: 0 });
  });
  it('iade/ters kayıtta eksi miktar-tutar mutlak değere çevrilir (eski davranış korunur)', () => {
    expect(satirNet(alis({ sth_miktar: -10, sth_tutar: -1000, sth_iskonto1: -100 }))).toMatchObject({ durum: 'tamam', miktar: 10, brut: 1000, iskonto: 100, net: 900 });
  });
});

describe("satirNet — net, satırın KENDİ KDV'siyle sağlanır (sth_tutar brüt mü net mi, iskonto satırda mı başlıkta mı: VERİ karar verir)", () => {
  const T = { sth_tarih: '2025-09-06' };   // 2023-07-10 sonrası: geçerli oranlar %20 / %10 / %1
  it('KDV (brüt − iskonto) üzerinden tutuyorsa: satır iskontosu düşülür', () => {
    expect(satirNet(alis({ ...T, sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 180 }))).toMatchObject({ net: 900, iskonto: 100, kaynak: 'satirIskontosu' });
  });
  it('KDV BRÜT üzerinden tutuyorsa sth_tutar ZATEN nettir: iskonto İKİNCİ KEZ düşülmez (çift düşme yok)', () => {
    const r = satirNet(alis({ ...T, sth_tutar: 900, sth_iskonto1: 100, sth_vergi: 180 }));   // 180 = %20 × 900
    expect(r).toMatchObject({ durum: 'tamam', net: 900, brut: 1000, iskonto: 100, birimFiyat: 90, kaynak: 'tutarZatenNet' });
  });
  it("FATURA ALTI iskonto satıra yazılmamışsa (yalnız başlıkta): net, KDV'den türetilir — kullanıcının evrak 48 vakası", () => {
    // 100 × 22,40 = 2.240 brüt; fatura altı %10 → matrah 2.016; KDV %20 = 403,20. Satırda iskonto alanı boş.
    const r = satirNet(alis({ ...T, sth_miktar: 100, sth_tutar: 2240, sth_vergi: 403.2 }));
    expect(r).toMatchObject({ durum: 'tamam', brut: 2240, kaynak: 'faturaAltiKdvden' });
    if (r.durum !== 'tamam') return;
    expect(r.net).toBeCloseTo(2016, 2);
    expect(r.iskonto).toBeCloseTo(224, 2);
    expect(r.birimFiyat).toBeCloseTo(20.16, 4);      // ₺22,40 DEĞİL
  });
  it("2023-07-10 ÖNCESİ %18 geçerli orandır: 403,20 / 2.240 = %18 iskontosuz satırdır, fatura altı uydurulmaz", () => {
    expect(satirNet(alis({ sth_tarih: '2023-03-01', sth_miktar: 100, sth_tutar: 2240, sth_vergi: 403.2 }))).toMatchObject({ net: 2240, iskonto: 0, kaynak: 'iskontosuz' });
  });
  it('GEÇİŞ DÖNEMİ (10 Tem – 31 Ara 2023): eski oranla (%18/%8) kesilmiş iade/düzeltme satırı olabilir — iki oran kümesi de geçerli, fatura altı UYDURULMAZ', () => {
    expect(satirNet(alis({ sth_tarih: '2023-08-15', sth_miktar: 100, sth_tutar: 2240, sth_vergi: 403.2 }))).toMatchObject({ net: 2240, kaynak: 'iskontosuz' });
    expect(satirNet(alis({ sth_tarih: '2024-01-02', sth_miktar: 100, sth_tutar: 2240, sth_vergi: 403.2 }))).toMatchObject({ kaynak: 'faturaAltiKdvden' });
  });
  it('masraf payı (nakliye) KDV matrahına girer ama alış fiyatına EKLENMEZ: net = brüt − iskonto', () => {
    expect(satirNet(alis({ ...T, sth_tutar: 1000, sth_masraf1: 50, sth_vergi: 210 }))).toMatchObject({ net: 1000, iskonto: 0, kaynak: 'iskontosuz' });
  });
  it("KDV'siz/KDV'si bilinmeyen satır sağlanamaz: belgelenmiş Mikro davranışı (brüt − iskonto) uygulanır ve 'dogrulanamadi' diye İŞARETLENİR", () => {
    expect(satirNet(alis({ ...T, sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 0 }))).toMatchObject({ net: 900, kaynak: 'dogrulanamadi' });
    expect(satirNet(alis({ sth_tutar: 1000, sth_iskonto1: 100 }))).toMatchObject({ net: 900, kaynak: 'dogrulanamadi' });
  });
  it('iki oran da makul bir matrah veriyorsa (belirsiz) tahmin YAPILMAZ; sth_vergi_pntr eşlemesi varsa o seçer', () => {
    // KDV 300: %20 → 1.500, %10 → 3.000 (brütü aşar) → tek makul → 1.500
    expect(satirNet(alis({ ...T, sth_tutar: 2000, sth_vergi: 300 }))).toMatchObject({ kaynak: 'faturaAltiKdvden' });
    // KDV 110: %20 → 550 (brütün %55'i), %10 → 1.100 (brütü aşar) → 550 makul; pntr 3 (%10) ise çelişki → doğrulanamadı
    expect(satirNet(alis({ ...T, sth_tutar: 1000, sth_vergi: 110, sth_vergi_pntr: 3 }))).toMatchObject({ net: 1000, kaynak: 'dogrulanamadi' });
  });
});

describe('stokFiyatOzeti — SKU bazında NET ağırlıklı ortalama', () => {
  const HAREKETLER = [
    alis({ sth_miktar: 10, sth_tutar: 1000, sth_iskonto1: 100, sth_iskonto4: 100 }),   // net 800
    alis({ sth_miktar: 5, sth_tutar: 600 }),                                            // net 600
    alis({ sth_miktar: 20, sth_tutar: null }),                                          // tutarı bilinmiyor → DIŞARIDA
    alis({ sth_miktar: 3, sth_tutar: 300, sth_iptal: 1 }),                              // iptal
    satis({ sth_miktar: 4, sth_tutar: 600, sth_iskonto2: 60 }),                         // net 540
    { sth_tip: 0, sth_miktar: 7, sth_tutar: 70 },                                       // native (SKU yok)
    { sth_stok_kod: 'DEMIR-12', sth_tip: 1, sth_miktar: 2, sth_tutar: 900 },
  ];
  const ozet = stokFiyatOzeti(HAREKETLER);
  const cim = ozet.satirlar.find(r => r.sku === 'CIM-50');
  it('ortalama alış = Σnet / Σmiktar = 1400 / 15 (brütten 1600/15 DEĞİL); bilinmeyen satır ortalamayı DÜŞÜRMEZ', () => {
    expect(cim).toBeDefined();
    expect(cim?.alisOrtFiyat).toBeCloseTo(1400 / 15, 6);
    expect(cim?.alisTutar).toBe(1400);
    expect(cim?.alisBrutTutar).toBe(1600);
    expect(cim?.alisIskonto).toBe(200);
    expect(cim?.alisMiktar).toBe(15);        // 20'lik bilinmeyen satır miktara da GİRMEZ (eski kod 1600/35 ≈ 45,7 basardı)
    expect(cim?.alisAdet).toBe(2);
    expect(cim?.bilinmeyenSatir).toBe(1);
    expect(cim?.alisBilinmeyen).toBe(1);     // işaret DOĞRU hücreye: eksik olan alış tarafı
    expect(cim?.satisBilinmeyen).toBe(0);
  });
  it('yalnız SATIŞ tarafında tutarı bilinmeyen satır: sayaç satışta artar, alış işaretlenmez', () => {
    const o = stokFiyatOzeti([alis({}), satis({ sth_tutar: null })]).satirlar[0];
    expect(o).toMatchObject({ alisBilinmeyen: 0, satisBilinmeyen: 1, satisOrtFiyat: null, marjTL: null });
  });
  it('miktarı 0 ama tutarı dolu satır (fiyat farkı / dönem sonu iskonto faturası) ortalamaya girmez ama SAYILIR', () => {
    const o = stokFiyatOzeti([alis({}), alis({ sth_miktar: 0, sth_tutar: 5000 })]);
    expect(o.satirlar[0]).toMatchObject({ alisOrtFiyat: 100, miktarsizSatir: 1 });
  });
  it('net kaynağı dökümü raporlanır (ekran hangi yolla hesaplandığını söyler)', () => {
    const o = stokFiyatOzeti([
      alis({ sth_tarih: '2025-09-06', sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 180 }),
      alis({ sth_tarih: '2025-09-06', sth_miktar: 100, sth_tutar: 2240, sth_vergi: 403.2 }),
      alis({ sth_tutar: 500 }),
    ]);
    expect(o.netKaynaklari).toEqual({ satirIskontosu: 1, faturaAltiKdvden: 1, dogrulanamadi: 1 });
  });
  it('satış ortalaması da NET; marj iki net ortalamadan', () => {
    expect(cim?.satisOrtFiyat).toBeCloseTo(135, 6);
    expect(cim?.marjTL).toBeCloseTo(135 - 1400 / 15, 6);
    expect(cim?.marjYuzde).toBeCloseTo(((135 - 1400 / 15) / (1400 / 15)) * 100, 6);
  });
  it('tek yönlü SKU: diğer yön null, marj null; iptal ve native satır hiç sayılmaz', () => {
    const demir = ozet.satirlar.find(r => r.sku === 'DEMIR-12');
    expect(demir).toMatchObject({ alisOrtFiyat: null, satisOrtFiyat: 450, marjTL: null, marjYuzde: null, bilinmeyenSatir: 0 });
    expect(ozet.satirlar).toHaveLength(2);
  });
  it('veride GERÇEKTEN bulunan iskonto kolonları raporlanır (ayna SELECT * — ad tahmini yok); hiç yoksa boş liste', () => {
    expect(ozet.iskontoKolonlari).toEqual(['sth_iskonto1', 'sth_iskonto2', 'sth_iskonto4']);
    expect(stokFiyatOzeti([alis({})]).iskontoKolonlari).toEqual([]);
    expect(stokFiyatOzeti([alis({ sth_iskonto1: 0 })]).iskontoKolonlari).toEqual(['sth_iskonto1']);   // kolon VAR, değer 0
  });
  it('boş liste → boş rapor', () => {
    expect(stokFiyatOzeti([])).toEqual({ satirlar: [], iskontoKolonlari: [], netKaynaklari: {} });
  });
});

describe('stokFiyatDetay — SKU satırları: brüt, iskonto, net, net birim fiyat', () => {
  it('yalnız istenen SKU, iptal hariç, tarihe göre yeniden eskiye; bilinmeyen satır listede kalır ama fiyatı null', () => {
    const d = stokFiyatDetay([
      alis({ sth_tarih: '2026-08-01', sth_iskonto1: 100, sth_evrakno_seri: 'A', sth_evrakno_sira: 377, sth_cari_kodu: '320.01' }),
      alis({ sth_tarih: '2026-09-01', sth_tutar: null }),
      alis({ sth_tarih: '2026-09-05', sth_iptal: true }),
      { sth_stok_kod: 'BASKA', sth_tip: 0, sth_miktar: 1, sth_tutar: 1 },
    ], 'CIM-50');
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ tarih: '2026-09-01', yon: 'alis', miktar: 10, brutTutar: null, iskonto: null, tutar: null, birimFiyat: null, kaynak: null });
    // `sth_evraktip` yok → faturaya bağlanamaz (fatura: null); evrak numarası yine görünür.
    expect(d[1]).toEqual({ tarih: '2026-08-01', yon: 'alis', miktar: 10, brutTutar: 1000, iskonto: 100, tutar: 900, birimFiyat: 90, kaynak: 'dogrulanamadi', cariKod: '320.01', evrakNo: 'A-377', fatura: null });
  });
});

describe('faturaAnahtari — "evraka bas → faturayı aç" anahtarı (2026-09-25 kullanıcı bildirimi)', () => {
  it('evrak tipi 3 = alış faturası (gelen), 4 = satış faturası (giden); seri boş olabilir', () => {
    expect(faturaAnahtari(alis({ sth_evraktip: 3, sth_evrakno_seri: 'A', sth_evrakno_sira: 128 }))).toEqual({ seri: 'A', sira: '128', yon: 'gelen' });
    expect(faturaAnahtari(satis({ sth_evraktip: 4, sth_evrakno_seri: '', sth_evrakno_sira: '116' }))).toEqual({ seri: '', sira: '116', yon: 'giden' });
  });
  it('fatura olmayan evrak (irsaliye 1, sayım…) ya da sırasız satır → null (yanlış faturayı açmaz)', () => {
    expect(faturaAnahtari(alis({ sth_evraktip: 1, sth_evrakno_sira: 5 }))).toBeNull();
    expect(faturaAnahtari(alis({ sth_evraktip: 3, sth_evrakno_sira: '' }))).toBeNull();
    expect(faturaAnahtari(alis({ sth_evraktip: 3 }))).toBeNull();
    expect(faturaAnahtari(alis({ sth_evrakno_sira: 5 }))).toBeNull();          // tip yok
  });
  it('stokFiyatDetay satırı anahtarı taşır', () => {
    const d = stokFiyatDetay([satis({ sth_tarih: '2025-12-30', sth_evraktip: 4, sth_evrakno_seri: '', sth_evrakno_sira: 116 })], 'CIM-50');
    expect(d[0].fatura).toEqual({ seri: '', sira: '116', yon: 'giden' });
    expect(d[0].evrakNo).toBe('116');
  });
});

describe('tolerans — iskonto küçükken "tutar zaten net" ile "iskonto düşüldü" karışmaz (hakem bulgusu)', () => {
  const T = { sth_tarih: '2025-09-06' };
  it('KDV tutarın KENDİSİNE tam oturuyorsa (10.000 × %20 = 2.000) küçük iskonto (30) tekrar düşülmez', () => {
    expect(satirNet(alis({ ...T, sth_tutar: 10000, sth_iskonto1: 30, sth_vergi: 2000 }))).toMatchObject({ net: 10000, kaynak: 'tutarZatenNet' });
  });
  it('KDV (tutar − iskonto)ya tam oturuyorsa (9.970 × %20 = 1.994) iskonto düşülür', () => {
    expect(satirNet(alis({ ...T, sth_tutar: 10000, sth_iskonto1: 30, sth_vergi: 1994 }))).toMatchObject({ net: 9970, kaynak: 'satirIskontosu' });
  });
});

describe('FATURA BAŞLIĞI hakemdir — satırdan ayırt edilemeyen durum başlık toplamıyla (cha_meblag) çözülür', () => {
  // "%18 KDV, iskonto yok" ile "%20 KDV + %10 fatura altı iskonto" tek satırda aritmetik olarak AYNIDIR (hakem bulgusu).
  const T = { sth_tarih: '2024-03-01', sth_evrakno_seri: '', sth_evrakno_sira: 48, sth_evraktip: 3 };
  const baslik = (meblag: unknown, p: Record<string, unknown> = {}) => ({ cha_evrakno_seri: '', cha_evrakno_sira: 48, cha_tip: 1, cha_meblag: meblag, ...p });
  it('başlık = tutar + KDV ise iskonto YOKTUR (eski oranlı %18 satır): fatura altı uydurulmaz', () => {
    const h = [alis({ ...T, sth_tutar: 1000, sth_vergi: 180 })];
    expect(satirNet(h[0])).toMatchObject({ kaynak: 'faturaAltiKdvden' });                       // başlıksız: en olası okuma
    const o = stokFiyatOzeti(h, { faturaToplamlari: faturaToplamlari([baslik(1180)]) });
    expect(o.satirlar[0]).toMatchObject({ alisOrtFiyat: 100, alisIskonto: 0 });
    expect(o.netKaynaklari).toEqual({ iskontosuz: 1 });
  });
  it('başlık daha küçükse fark FATURA ALTI iskontodur ve satırlara ORANTILI dağıtılır (kullanıcının vakası)', () => {
    const h = [
      alis({ ...T, sth_stok_kod: 'NOVA-350-11304', sth_miktar: 100, sth_tutar: 2240, sth_vergi: 403.2 }),
      alis({ ...T, sth_stok_kod: 'NOVA-350-14122', sth_miktar: 5, sth_tutar: 1000, sth_vergi: 180 }),
    ];
    const o = stokFiyatOzeti(h, { faturaToplamlari: faturaToplamlari([baslik(2016 + 403.2 + 900 + 180)]) });
    const nova = o.satirlar.find(r => r.sku === 'NOVA-350-11304');
    expect(nova?.alisOrtFiyat).toBeCloseTo(20.16, 4);            // ₺22,40 DEĞİL
    expect(nova?.alisIskonto).toBeCloseTo(224, 2);
    expect(o.netKaynaklari).toEqual({ faturaAltiBasliktan: 2 });
    const d = stokFiyatDetay(h, 'NOVA-350-11304', { faturaToplamlari: faturaToplamlari([baslik(3499.2)]) });
    expect(d[0]).toMatchObject({ brutTutar: 2240, kaynak: 'faturaAltiBasliktan' });
    expect(d[0].tutar).toBeCloseTo(2016, 2);
  });
  it('başlık satırlarla BAĞDAŞMIYORSA (tevkifat, ÖTV, aynada eksik satır) başlığa uyulmaz, satır sonucu kalır', () => {
    const h = [alis({ ...T, sth_tutar: 1000, sth_vergi: 180 })];
    const o = stokFiyatOzeti(h, { faturaToplamlari: faturaToplamlari([baslik(5000)]) });        // satırların çok üstünde
    expect(o.netKaynaklari).toEqual({ faturaAltiKdvden: 1 });
    expect(stokFiyatOzeti(h, { faturaToplamlari: faturaToplamlari([baslik(300)]) }).netKaynaklari).toEqual({ faturaAltiKdvden: 1 });   // %50'den büyük "iskonto"
  });
  it("KDV'si geçerli orana OTURAN satıra başlık dokunmaz (tevkifatlı faturada meblağ düşüktür, satır doğrudur)", () => {
    const h = [alis({ ...T, sth_tutar: 1000, sth_vergi: 200 })];
    expect(stokFiyatOzeti(h, { faturaToplamlari: faturaToplamlari([baslik(1080)]) }).netKaynaklari).toEqual({ iskontosuz: 1 });
  });
  it('fatura dışı hareket (irsaliye vb. — sth_evraktip 3/4 değil) ve yönü uymayan başlık eşleşmez; iptal/çift başlık yok sayılır', () => {
    const irsaliye = [alis({ ...T, sth_evraktip: 1, sth_tutar: 1000, sth_vergi: 180 })];
    expect(stokFiyatOzeti(irsaliye, { faturaToplamlari: faturaToplamlari([baslik(1180)]) }).netKaynaklari).toEqual({ faturaAltiKdvden: 1 });
    const h = [alis({ ...T, sth_tutar: 1000, sth_vergi: 180 })];
    expect(stokFiyatOzeti(h, { faturaToplamlari: faturaToplamlari([baslik(1180, { cha_tip: 0 })]) }).netKaynaklari).toEqual({ faturaAltiKdvden: 1 });
    expect(stokFiyatOzeti(h, { faturaToplamlari: faturaToplamlari([baslik(1180, { cha_iptal: 1 })]) }).netKaynaklari).toEqual({ faturaAltiKdvden: 1 });
    expect(faturaToplamlari([baslik(1180), baslik(999)]).size).toBe(0);      // aynı anahtar iki kez → belirsiz → kullanılmaz
    expect(faturaToplamlari([baslik(null), baslik('abc')]).size).toBe(0);    // meblağı bilinmeyen başlık hakem olamaz
  });
});

describe('kalemleriCoz — fatura modalı: tek evrakın kalemleri + başlık toplamı; miktarı 0 olan satırın TUTARI sağlamaya girer', () => {
  it('fiyat farkı satırı (miktar 0, tutar 500, KDV 100) net toplamına katılır — sağlama yanlış alarm vermez', () => {
    const kalemler = [
      { sth_tarih: '2025-09-06', sth_miktar: 10, sth_tutar: 1000, sth_vergi: 200 },
      { sth_tarih: '2025-09-06', sth_miktar: 0, sth_tutar: 500, sth_vergi: 100 },
    ];
    const c = kalemleriCoz(kalemler, 1800);
    expect(c.map(k => k.net)).toEqual([1000, 500]);
    expect(c[1]).toMatchObject({ miktar: 0, birimFiyat: null });
    expect(c.reduce((t, k) => t + (k.net ?? 0), 0) + 300).toBe(1800);
  });
  it('başlık toplamı fatura altı iskontoyu kalemlere dağıtır; tutarı bilinmeyen kalem null kalır (₺0 değil)', () => {
    const c = kalemleriCoz([{ sth_tarih: '2025-09-06', sth_miktar: 100, sth_tutar: 2240, sth_vergi: 403.2 }, { sth_miktar: 1, sth_tutar: null }], 2419.2);
    expect(c[0].net).toBeCloseTo(2016, 2);
    expect(c[0].kaynak).toBe('faturaAltiKdvden');     // tutarı bilinmeyen kalem varken başlık sağlaması yapılamaz → satır sonucu
    expect(c[1]).toMatchObject({ net: null, brut: null, kaynak: null });
  });
});

describe('birimFiyatOndaligi — net birim fiyat kaç ondalıkla basılır (fatura modalı, 2026-09-19)', () => {
  it('2 ondalık net tutarı GERİ ÜRETİYORSA 2: 18 × 187,50 = 3.375,00', () => {
    expect(birimFiyatOndaligi(3375 / 18, 18, 3375)).toBe(2);
  });

  it('2 ondalık net tutarı TUTMUYORSA tutan EN AZ ondalık: 183,34 / 20 = 9,167 → 3 ("9,17" × 20 = 183,40 ≠ 183,34)', () => {
    expect(birimFiyatOndaligi(183.34 / 20, 20, 183.34)).toBe(3);
  });

  it('kesirli miktar (2,5 ton): 437,68 / 2,5 = 175,072 → 3; 437,50 / 2,5 = 175,00 → 2', () => {
    expect(birimFiyatOndaligi(437.68 / 2.5, 2.5, 437.68)).toBe(3);
    expect(birimFiyatOndaligi(437.5 / 2.5, 2.5, 437.5)).toBe(2);
  });

  it('[İNCELEME] çok adetli satırda 4 ondalık da YETMEZ: 5.000 vida / ₺418,37 → "0,0837" × 5.000 = 418,50; 6 tutar', () => {
    expect(birimFiyatOndaligi(418.37 / 5000, 5000, 418.37)).toBe(6);
  });

  it('hiçbir ondalık tutmuyorsa 6 (devirli kesir + dev miktar) — sonsuza gitmez', () => {
    expect(birimFiyatOndaligi(1 / 3, 3_000_000, 1_000_000)).toBe(6);
  });

  it('girdi bilinmiyorsa varsayılan 2 (sütun zaten — basar)', () => {
    expect(birimFiyatOndaligi(null, 20, 183.34)).toBe(2);
    expect(birimFiyatOndaligi(9.167, null, 183.34)).toBe(2);
    expect(birimFiyatOndaligi(NaN, 20, NaN)).toBe(2);
  });
});

describe('birimSapmalari — koli/adet karışıklığı (kullanıcı vakası DAYSON-DYS.029, 2026-09-25)', () => {
  const D = { sth_stok_kod: 'DAYSON-DYS.029' };
  const al = (p: Record<string, unknown>) => ({ ...D, sth_tip: 0, sth_evraktip: 3, sth_evrakno_seri: '', ...p });
  const sat = (p: Record<string, unknown>) => ({ ...D, sth_tip: 1, sth_evraktip: 4, sth_evrakno_seri: '', ...p });
  // Canlı ekrandaki satırlar (brüt = net, iskonto yok): adet fiyatı ~₺129–200, iki alış koli fiyatıyla.
  const hareketler = [
    al({ sth_tarih: '2026-08-19', sth_miktar: 10, sth_tutar: 31250, sth_evrakno_sira: 410 }),
    sat({ sth_tarih: '2026-08-13', sth_miktar: 100, sth_tutar: 15833.33, sth_evrakno_sira: 329 }),
    al({ sth_tarih: '2026-08-11', sth_miktar: 8, sth_tutar: 25833.33, sth_evrakno_sira: 394 }),
    sat({ sth_tarih: '2026-03-07', sth_miktar: 25, sth_tutar: 3854.17, sth_evrakno_sira: 192 }),
    sat({ sth_tarih: '2026-03-06', sth_miktar: 50, sth_tutar: 7291.67, sth_evrakno_sira: 188 }),
    al({ sth_tarih: '2026-02-21', sth_miktar: 500, sth_tutar: 64583.33, sth_evrakno_sira: 213 }),
    sat({ sth_tarih: '2026-02-15', sth_miktar: 40, sth_tutar: 8000, sth_evrakno_sira: 165 }),
    al({ sth_tarih: '2025-12-01', sth_miktar: 125, sth_tutar: 16145.83, sth_evrakno_sira: 135 }),
  ];
  const tek = (sku: string, fiyatlar: number[]) => fiyatlar.map((f, i) => al({ sth_stok_kod: sku, sth_miktar: 1, sth_tutar: f, sth_evrakno_sira: i + 1 }));

  it('koli girilmiş iki alış faturası listelenir (kesin), olağan alış/satış (marj) listelenmez', () => {
    const { satirlar, degerlendirilen } = birimSapmalari(hareketler);
    expect(satirlar.map(x => x.evrakNo)).toEqual(['394', '410']);        // sapması büyükten küçüğe
    expect(satirlar.every(x => !x.belirsiz)).toBe(true);
    expect(satirlar[0].kat).toBeGreaterThan(20);
    expect(satirlar[0].medyan).toBeCloseTo(150, 1);                       // ANA kümenin (6 adet satırı) medyanı
    expect(satirlar[0].fatura).toEqual({ seri: '', sira: '394', yon: 'gelen' });
    expect(degerlendirilen.has('DAYSON-DYS.029')).toBe(true);
  });
  it('tersi yönde (koli fiyatlı üründe tek adet fiyatı) de yakalar', () => {
    const { satirlar } = birimSapmalari(tek('KOLI-1', [2400, 2400, 2400, 100]));
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0].kat).toBeLessThanOrEqual(1 / BIRIM_SAPMA_KATI);
    expect(satirlar[0].belirsiz).toBe(false);
  });
  it('DENGELİ gruplar (2 adet + 2 koli; 1 adet + 2 koli): yalnız ana gruptan sapanlar, "belirsiz" işaretli; ana grubun kendi satırları (kat ≈ 1) listelenmez', () => {
    const ikiIki = birimSapmalari(tek('A', [129, 150, 3125, 3229])).satirlar;
    expect(ikiIki).toHaveLength(2);
    expect(ikiIki.every(x => x.belirsiz && x.kat > BIRIM_SAPMA_KATI)).toBe(true);
    const birIki = birimSapmalari(tek('B', [129, 3125, 3229])).satirlar;
    expect(birIki).toHaveLength(1);
    expect(birIki[0].belirsiz).toBe(true);
    expect(birIki[0].kat).toBeLessThan(1 / BIRIM_SAPMA_KATI);
  });
  it('ZİNCİR: aradaki bir fiyat adet ve koli gruplarını birleştirse de koli satırları kaçmaz (delta incelemesi)', () => {
    const { satirlar } = birimSapmalari(tek('Z', [150, 150, 150, 150, 150, 150, 500, 1800, 1800]));
    expect(satirlar.map(x => Math.round(x.birimFiyat))).toEqual([1800, 1800]);
    expect(satirlar.every(x => !x.belirsiz)).toBe(true);
    // DENGELİ gruplar + köprü (3 adet + 1 ara + 3 koli; 3 + 2 ara + 3): koli satırları yine listelenir, "belirsiz"
    const denge = birimSapmalari(tek('Z2', [150, 150, 150, 500, 1800, 1800, 1800])).satirlar;
    expect(denge.map(x => Math.round(x.birimFiyat))).toEqual([1800, 1800, 1800]);
    expect(denge.every(x => x.belirsiz)).toBe(true);
    expect(birimSapmalari(tek('Z3', [150, 150, 150, 500, 550, 1800, 1800, 1800])).satirlar).toHaveLength(3);
  });
  it('fiyat düzeyi belirlenemiyorsa (hiçbir iki fiyat birbirinin ±2 katı içinde değil) hüküm verilmez', () => {
    expect(birimSapmalari(tek('K', [100, 300, 900])).satirlar).toEqual([]);   // uçlar 9× ama kademeli, yoğunluk yok
    expect(birimSapmalari(tek('K', [100, 300, 900])).degerlendirilen.has('K')).toBe(false);   // hüküm yok → 0 değil, bilinmiyor
    expect(birimSapmalari(tek('K2', [100, 100, 100, 100, 100])).satirlar).toEqual([]);
  });
  it('fiyatı bilinmeyen satır kümeye girmez, şüpheli de sayılmaz; 3\'ten az bilinen satırda ürün DEĞERLENDİRİLMEZ', () => {
    expect(birimSapmalari([...hareketler, al({ sth_tarih: '2026-09-01', sth_miktar: 5, sth_tutar: null, sth_evrakno_sira: 500 })]).satirlar.map(x => x.evrakNo)).toEqual(['394', '410']);
    const az = birimSapmalari(hareketler.slice(0, 2));
    expect(az.satirlar).toEqual([]);
    expect(az.degerlendirilen.has('DAYSON-DYS.029')).toBe(false);              // 0 şüpheli DEĞİL — bilinmiyor
  });
  it('iptal satır ne kümeye girer ne listelenir; eşik sınırı (tam 4 kat) şüphelidir', () => {
    const iptal = al({ sth_tarih: '2026-09-02', sth_miktar: 1, sth_tutar: 99999, sth_iptal: 1, sth_evrakno_sira: 777 });
    expect(birimSapmalari([...hareketler, iptal]).satirlar.some(x => x.evrakNo === '777')).toBe(false);
    expect(birimSapmalari(tek('E', [100, 100, 100, 400])).satirlar).toHaveLength(1);
    expect(birimSapmalari(tek('E', [100, 100, 100, 399])).satirlar).toHaveLength(0);
  });
});

// ── Mikro kaydı KENDİ İÇİNDE TUTARSIZ: iskonto brüte bir kez daha eklenmiş (evrak 420 / 435, 2026-09-26) ──────────
// Kullanıcı: "fiyat karşılaştırmada iskonto hesaplamada sorun var. net tutar iskontolu halde göstermeli demiştim."
// Tedarikçi e-faturası (SİZGEN YAPI SZN2026000001284): RULO1081 1.050 × 270 = 283.500 BRÜT (Mal Hizmet Tutarı), iskonto
// %30 = 85.050 + %15 = 29.767,50 (Σ 114.817,50), NET 168.682,50, KDV %20 = 33.736,50, TOPLAM 202.419. Mikro'da aynı alış:
// sth_tutar 398.317,50 (= brüt + Σiskonto), başlık 317.236,50. KDV / %20 = 168.682,50 = e-faturanın GERÇEK neti.
const E420 = {
  sth_stok_kod: 'RULO1081', sth_tip: 0, sth_evraktip: 3, sth_evrakno_seri: '', sth_evrakno_sira: 420, sth_tarih: '2026-08-31',
  sth_miktar: 1050, sth_tutar: 398317.5, sth_iskonto1: 85050, sth_iskonto2: 29767.5, sth_vergi: 33736.5, sth_vergi_pntr: 4,
};
const B420 = { cha_evrakno_seri: '', cha_evrakno_sira: 420, cha_tip: 1, cha_meblag: 317236.5 };
// Evrak 435 aynı desen: 2 × 270 = 540 brüt; iskonto 218,70 (%30 = 162 + %15 = 56,70 bölüşümü e-faturanın deseninden),
// KDV 64,26 (= %20 × 321,30), başlık 604,26. Tarih şartnamede yok → fikstürde YOK: tarihsiz satırda tüm oranlar denenir.
const E435 = {
  sth_stok_kod: 'RULO1081', sth_tip: 0, sth_evraktip: 3, sth_evrakno_seri: '', sth_evrakno_sira: 435,
  sth_miktar: 2, sth_tutar: 758.7, sth_iskonto1: 162, sth_iskonto2: 56.7, sth_vergi: 64.26, sth_vergi_pntr: 4,
};
const B435 = { cha_evrakno_seri: '', cha_evrakno_sira: 435, cha_tip: 1, cha_meblag: 604.26 };
const FT = faturaToplamlari([B420, B435]);

/** Tek evrak: `sira` numaralı alış faturası kalemi (2026 → geçerli oranlar %20/%10/%1). */
const kalem = (sira: number, p: Record<string, unknown>) => ({ sth_stok_kod: `S${sira}`, sth_tip: 0, sth_evraktip: 3, sth_evrakno_seri: '', sth_evrakno_sira: sira, sth_tarih: '2026-08-31', sth_miktar: 10, ...p });
/** kalemleriCoz + kalemSaglamasi (fatura modalı yolu) — başlıkla. */
const fatura = (satirlar: Record<string, unknown>[], meblag: number) => {
  const c = kalemleriCoz(satirlar, meblag);
  return { c, s: kalemSaglamasi(satirlar, c, meblag) };
};

describe("Mikro kaydı tutarsız (evrak 420/435): net KDV'den, brüt = e-faturanın Mal Hizmet Tutarı — başlık artık EZMEZ", () => {
  it('başlıklı: 420 → net 168.682,50 (e-fatura neti), brüt 283.500, iskonto 114.817,50, birim ₺160,65; kaynak mikroKaydiTutarsiz', () => {
    const d = stokFiyatDetay([E420, E435], 'RULO1081', { faturaToplamlari: FT });
    const r420 = d.find(x => x.evrakNo === '420');
    expect(r420).toMatchObject({ kaynak: 'mikroKaydiTutarsiz', brutTutar: 283500, mikroTutar: 398317.5 });
    expect(r420?.tutar).toBeCloseTo(168682.5, 2);
    expect(r420?.iskonto).toBeCloseTo(114817.5, 2);
    expect(r420?.birimFiyat).toBeCloseTo(160.65, 6);            // ₺270 (283.500 / 1.050) DEĞİL
    const r435 = d.find(x => x.evrakNo === '435');
    expect(r435).toMatchObject({ kaynak: 'mikroKaydiTutarsiz', mikroTutar: 758.7 });
    expect(r435?.brutTutar).toBeCloseTo(540, 6);
    expect(r435?.tutar).toBeCloseTo(321.3, 6);
    expect(r435?.birimFiyat).toBeCloseTo(160.65, 6);
  });
  it('fatura modalı (kalemleriCoz + meblağ) aynı sonucu verir', () => {
    const [k] = kalemleriCoz([E420], 317236.5);
    expect(k).toMatchObject({ kaynak: 'mikroKaydiTutarsiz', brut: 283500 });
    expect(k.net).toBeCloseTo(168682.5, 2);
    expect(k.birimFiyat).toBeCloseTo(160.65, 6);
  });
  it('rapor özeti: alış ortalaması ₺160,65, net kaynağı dökümünde mikroKaydiTutarsiz', () => {
    const o = stokFiyatOzeti([E420, E435], { faturaToplamlari: FT });
    expect(o.satirlar[0].alisOrtFiyat).toBeCloseTo(160.65, 6);
    expect(o.satirlar[0].alisTutar).toBeCloseTo(168682.5 + 321.3, 2);
    expect(o.satirlar[0].alisBrutTutar).toBeCloseTo(283500 + 540, 2);
    expect(o.netKaynaklari).toEqual({ mikroKaydiTutarsiz: 2 });
  });
  it('KAPANIŞ ÖLÇÜSÜ: aynı hareketin satirNet neti == stokFiyatDetay(…, {faturaToplamlari}) neti (ekranlar artık çelişmez)', () => {
    const d = stokFiyatDetay([E420, E435], 'RULO1081', { faturaToplamlari: FT });
    for (const h of [E420, E435]) {
      const s = satirNet(h);
      const r = d.find(x => x.evrakNo === String(h.sth_evrakno_sira));
      expect(s.durum).toBe('tamam');
      if (s.durum !== 'tamam' || !r || r.tutar === null) throw new Error('çözülmedi');
      expect(Math.abs(s.net - r.tutar)).toBeLessThan(0.005);
    }
    // Başlıksız rapor (MusteriKarAnalizi yolu) ile başlıklı rapor aynı ortalamayı basar.
    expect(stokFiyatOzeti([E420, E435]).satirlar[0].alisOrtFiyat).toBeCloseTo(stokFiyatOzeti([E420, E435], { faturaToplamlari: FT }).satirlar[0].alisOrtFiyat ?? NaN, 6);
  });
  it('başlıksız yol DEĞİŞMEZ: faturaAltiKdvden, brüt = sth_tutar, net zaten doğru; detay satırında mikroTutar YOK', () => {
    expect(satirNet(E420)).toMatchObject({ durum: 'tamam', kaynak: 'faturaAltiKdvden', brut: 398317.5 });
    const d = stokFiyatDetay([E420], 'RULO1081');
    expect(d[0].kaynak).toBe('faturaAltiKdvden');
    expect('mikroTutar' in d[0]).toBe(false);
  });
});

describe('sağlama artık DÖNGÜSEL değil: mikroFazlasi / mikroKaydiTutarsiz / kdvUyumsuz', () => {
  it("420: kalem neti + KDV = 202.419 ≠ Mikro toplamı 317.236,50; fark = mikroFazlasi (114.817,50) → mikroKaydiTutarsiz", () => {
    const { s } = fatura([E420], 317236.5);
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.net).toBeCloseTo(168682.5, 2);
    expect(s.kdv).toBeCloseTo(33736.5, 2);
    expect(s.kalemToplami).toBeCloseTo(202419, 2);
    expect(s.fark).toBeCloseTo(-114817.5, 2);
    expect(s.tutuyor).toBe(false);                               // eskiden "✓ Sağlama" (döngüsel)
    expect(s.mikroFazlasi).toBeCloseTo(114817.5, 2);
    expect(s.mikroKaydiTutarsiz).toBe(true);
    expect(s.kdvUyumsuz).toBe(0);                                // net KDV ile tutarlı
  });
  it('435 aynı desen (tarihsiz satır)', () => {
    const { s } = fatura([E435], 604.26);
    expect(s?.mikroFazlasi).toBeCloseTo(218.7, 6);
    expect(s?.mikroKaydiTutarsiz).toBe(true);
    expect(s?.fark).toBeCloseTo(-218.7, 6);
  });
  it('tutarlı fatura: mikroFazlasi 0 (gerçek sıfır, hesaplandı), mikroKaydiTutarsiz false, kdvUyumsuz 0', () => {
    const { s } = fatura([kalem(1, { sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 180, sth_vergi_pntr: 4 })], 1080);
    expect(s).toMatchObject({ tutuyor: true, mikroFazlasi: 0, mikroKaydiTutarsiz: false, kdvUyumsuz: 0 });
  });
  it('saglamaKur: mikroFazlasi verilmezse alanlar HİÇ yazılmaz (bilinmiyor ≠ false; mevcut literaller kırılmaz)', () => {
    const s = saglamaKur({ net: 900, kdv: 180, masraf: 0, brut: 1000, eksik: 0 }, 1080);
    expect(s).toEqual({ net: 900, kdv: 180, masraf: 0, iskonto: 100, kalemToplami: 1080, fark: 0, tutuyor: true, eksik: 0 });
    expect('mikroKaydiTutarsiz' in s || 'mikroFazlasi' in s || 'kdvUyumsuz' in s).toBe(false);
  });
  it('saglamaKur: fazla farkı açıklıyorsa tutarsız; eksik alan varsa ya da fazla farkı açıklamıyorsa DEĞİL', () => {
    const t = { net: 168682.5, kdv: 33736.5, masraf: 0, brut: 283500, eksik: 0, mikroFazlasi: 114817.5, kdvUyumsuz: 0, ciftBelirsiz: 0 };
    expect(saglamaKur(t, 317236.5)).toMatchObject({ mikroFazlasi: 114817.5, mikroKaydiTutarsiz: true, kdvUyumsuz: 0, tutuyor: false });
    expect(saglamaKur({ ...t, eksik: 1 }, 317236.5).mikroKaydiTutarsiz).toBe(false);
    expect(saglamaKur(t, 400000).mikroKaydiTutarsiz).toBe(false);                 // fark 197.581 ≠ fazla
    expect(saglamaKur({ ...t, mikroFazlasi: 0 }, 202419).mikroKaydiTutarsiz).toBe(false);   // fazla yoksa tutarsızlık yok
    expect(saglamaKur({ ...t, mikroFazlasi: NaN }, 317236.5)).not.toHaveProperty('mikroKaydiTutarsiz');
  });
});

describe('meşru vakalar: çift iskonto imzası YALNIZ başlık "net = tutar − Σisk" derken ve KDV yalnız (tutar − 2·Σisk)\'ye oturuyorken', () => {
  it('iskontosuz: KDV tutara oturuyor → iskontosuz, işaret yok', () => {
    const { c, s } = fatura([kalem(2, { sth_tutar: 1000, sth_vergi: 200, sth_vergi_pntr: 4 })], 1200);
    expect(c[0]).toMatchObject({ kaynak: 'iskontosuz', net: 1000 });
    expect(s).toMatchObject({ tutuyor: true, mikroKaydiTutarsiz: false, kdvUyumsuz: 0 });
  });
  it('tutarlı satır iskontosu: KDV (tutar − isk)\'ye oturuyor → satirIskontosu', () => {
    const { c } = fatura([kalem(3, { sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 180, sth_vergi_pntr: 4 })], 1080);
    expect(c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 900, brut: 1000 });
  });
  it('fatura altı iskonto başlıkta (satırda yok): faturaAltiBasliktan, işaret yok', () => {
    const { c, s } = fatura([kalem(4, { sth_miktar: 100, sth_tutar: 2240, sth_vergi: 403.2, sth_vergi_pntr: 4 })], 2419.2);
    expect(c[0].kaynak).toBe('faturaAltiBasliktan');
    expect(c[0].net).toBeCloseTo(2016, 2);
    expect(s).toMatchObject({ tutuyor: true, mikroKaydiTutarsiz: false, kdvUyumsuz: 0 });
  });
  it('2024+ eski %18 iskontolu satır (iade/düzeltme): Mikro okuması %18\'e oturuyor → satirIskontosu 900, işaret yok', () => {
    const { c } = fatura([kalem(5, { sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 162 })], 1062);
    expect(c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 900 });
  });
  it('ARALIK KORUMASI: isk = tutar/11 → (tutar − isk)·%18 ≡ (tutar − 2·isk)·%20; Mikro\'nun tutarlı okuması korunur', () => {
    // 2.200 − 200 = 2.000 × %18 = 360 = 1.800 × %20 — aritmetik olarak ayırt edilemez.
    const { c, s } = fatura([kalem(6, { sth_tutar: 2200, sth_iskonto1: 200, sth_vergi: 360, sth_vergi_pntr: 4 })], 2360);
    expect(c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 2000, brut: 2200 });
    expect(s).toMatchObject({ tutuyor: true, mikroKaydiTutarsiz: false, mikroFazlasi: 0 });
    // …ama pntr %20 diyor ve 2.000 × %20 ≠ 360: bağımsız güvenlik ağı SAYAR (netleri değiştirmez) → yeşil ✓ verilmez.
    expect(s?.kdvUyumsuz).toBe(1);
    // pntr yoksa oran bilinmez → sayılmaz (bilinmeyen ≠ uyumsuz).
    const pntrsiz = fatura([kalem(6, { sth_tutar: 2200, sth_iskonto1: 200, sth_vergi: 360 })], 2360);
    expect(pntrsiz.s?.kdvUyumsuz).toBe(0);
    expect(pntrsiz.c[0].kaynak).toBe('satirIskontosu');
  });
  it('KARMA KDV: %10 tutarlı kalem + %20 çift iskontolu kalem → yalnız ikincisi işaretlenir', () => {
    const { c, s } = fatura([
      kalem(7, { sth_tutar: 1000, sth_vergi: 100, sth_vergi_pntr: 3 }),
      kalem(7, { sth_stok_kod: 'S7B', sth_tutar: 2300, sth_iskonto1: 300, sth_vergi: 340, sth_vergi_pntr: 4 }),
    ], 3440);
    expect(c[0]).toMatchObject({ kaynak: 'iskontosuz', net: 1000 });
    expect(c[1]).toMatchObject({ kaynak: 'mikroKaydiTutarsiz', net: 1700, brut: 2000 });
    expect(s).toMatchObject({ mikroFazlasi: 300, mikroKaydiTutarsiz: true, kdvUyumsuz: 0 });
    // İki çift iskontolu kalem, farklı oranlarda (%20 + %10): ikisi de.
    const iki = fatura([
      kalem(8, { sth_tutar: 2300, sth_iskonto1: 300, sth_vergi: 340, sth_vergi_pntr: 4 }),
      kalem(8, { sth_stok_kod: 'S8B', sth_miktar: 5, sth_tutar: 1300, sth_iskonto1: 300, sth_vergi: 70, sth_vergi_pntr: 3 }),
    ], 3410);
    expect(iki.c.map(k => [k.kaynak, k.net])).toEqual([['mikroKaydiTutarsiz', 1700], ['mikroKaydiTutarsiz', 700]]);
    expect(iki.s).toMatchObject({ mikroFazlasi: 600, mikroKaydiTutarsiz: true });
  });
  it('tevkifat: KDV\'si oturan satıra başlık dokunmaz; sağlama tutmaz ama Mikro kaydı tutarsız DEĞİLDİR', () => {
    const { c, s } = fatura([kalem(9, { sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 180, sth_vergi_pntr: 4 })], 990);   // 5/10 tevkifat
    expect(c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 900 });
    expect(s).toMatchObject({ tutuyor: false, mikroFazlasi: 0, mikroKaydiTutarsiz: false, kdvUyumsuz: 0 });
  });
  it('masraflı: çift iskonto + masraf matrahta → net 1.700 (masraf nete girmez); meşru masraflı satır kdvUyumsuz sayılmaz', () => {
    // 2.600 − 300 = 2.300 (Mikro okuması; hiçbir oranda 420 vermez), 2.600 − 600 = 2.000; (2.000 + 100) × %20 = 420.
    const { c, s } = fatura([kalem(10, { sth_tutar: 2600, sth_iskonto1: 300, sth_masraf1: 100, sth_vergi: 420, sth_vergi_pntr: 4 })], 2820);
    expect(c[0]).toMatchObject({ kaynak: 'mikroKaydiTutarsiz', net: 2000, brut: 2300 });
    expect(s).toMatchObject({ mikroFazlasi: 300, mikroKaydiTutarsiz: true, kdvUyumsuz: 0 });
    // ÇAKIŞMA (aralık koruması): 2.300/300/100/360'ta Mikro okuması 2.000 × %18 = 360'a oturur → ayırt edilemez, Mikro'nun
    // okuması korunur (işaret YOK); pntr %20 dediği için bağımsız ağ SAYAR → yeşil ✓ verilmez.
    const cak = fatura([kalem(10, { sth_tutar: 2300, sth_iskonto1: 300, sth_masraf1: 100, sth_vergi: 360, sth_vergi_pntr: 4 })], 2460);
    expect(cak.c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 2000 });
    expect(cak.s).toMatchObject({ mikroKaydiTutarsiz: false, kdvUyumsuz: 1 });
    const m = fatura([kalem(11, { sth_tutar: 1000, sth_iskonto1: 100, sth_masraf1: 50, sth_vergi: 190, sth_vergi_pntr: 4 })], 1140);
    expect(m.c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 900 });
    expect(m.s).toMatchObject({ tutuyor: true, kdvUyumsuz: 0 });
  });
  it('pntr imzayla ÇELİŞİYORSA (pntr %10, KDV %20\'ye oturuyor) işaret yok — kdvUyumsuz sayar', () => {
    const { c, s } = fatura([kalem(12, { sth_tutar: 2300, sth_iskonto1: 300, sth_vergi: 340, sth_vergi_pntr: 3 })], 2340);
    expect(c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 2000 });
    expect(s).toMatchObject({ mikroKaydiTutarsiz: false, kdvUyumsuz: 1 });
  });
  it('EŞİT TUTARDA meşru fatura altı (satır iskontosu 300 + fatura altı 300): başlık 2.040 → faturaAltiBasliktan, işaret yok', () => {
    // Satır imzayla BİREBİR aynı (2.300 / 300 / KDV 340); ayıran yalnız başlık: Mikro'nun kendi başlığı neti 1.700 diyor.
    const { c, s } = fatura([kalem(13, { sth_tutar: 2300, sth_iskonto1: 300, sth_vergi: 340, sth_vergi_pntr: 4 })], 2040);
    expect(c[0].kaynak).toBe('faturaAltiBasliktan');
    expect(c[0].net).toBeCloseTo(1700, 6);
    expect(c[0].brut).toBe(2300);
    expect(s).toMatchObject({ tutuyor: true, mikroKaydiTutarsiz: false, mikroFazlasi: 0, kdvUyumsuz: 0, ciftBelirsiz: 0 });
    expect(c[0].ciftIskontoBelirsiz).toBe(false);          // tur 2: net, çift okumayla AYNI → belirsizlik yok (mutant `return true` düşer)
    // Başlıksız: imzalı satır da meşru satır da faturaAltiKdvden — net aynı (1.700), ayırt edilemez, DEĞİŞMEZ.
    expect(satirNet(kalem(13, { sth_tutar: 2300, sth_iskonto1: 300, sth_vergi: 340, sth_vergi_pntr: 4 }))).toMatchObject({ kaynak: 'faturaAltiKdvden', net: 1700, brut: 2300 });
  });
  it('kdvUyumsuz: 2023-07-10 ÖNCESİ satırda pntr 4 (%20) o tarihte geçerli oran değil → oran bilinmiyor, sayılmaz', () => {
    const { s } = fatura([kalem(14, { sth_tarih: '2023-03-01', sth_tutar: 1000, sth_vergi: 180, sth_vergi_pntr: 4 })], 1180);
    expect(s).toMatchObject({ tutuyor: true, kdvUyumsuz: 0 });
  });
});

describe("mikroTutarsizliklari — \"Mikro'da düzeltilecek\" listesi (birim sapması kalıbı)", () => {
  const BASKA = { sth_stok_kod: 'CIM-50', sth_tip: 0, sth_evraktip: 3, sth_evrakno_seri: '', sth_evrakno_sira: 500, sth_tarih: '2026-08-31', sth_miktar: 10, sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 180, sth_vergi_pntr: 4 };
  it('yalnız mikroKaydiTutarsiz satırları, fazlası büyükten küçüğe; alanlar e-fatura ile sağlanabilir', () => {
    const { satirlar, degerlendirilen } = mikroTutarsizliklari([E435, BASKA, E420], { faturaToplamlari: FT });
    expect(satirlar.map(x => x.evrakNo)).toEqual(['420', '435']);
    const t = satirlar[0];
    expect(t).toMatchObject({ sku: 'RULO1081', tarih: '2026-08-31', yon: 'alis', miktar: 1050, fatura: { seri: '', sira: '420', yon: 'gelen' }, oran: 20, evrakNo: '420' });
    expect(t.mikroTutar).toBeCloseTo(398317.5, 2);   // sth_tutar
    expect(t.iskonto).toBeCloseTo(114817.5, 2);      // Σ sth_iskonto
    expect(t.kdv).toBeCloseTo(33736.5, 2);
    expect(t.net).toBeCloseTo(168682.5, 2);          // gerçek (KDV'den)
    expect(t.mikroNet).toBeCloseTo(283500, 2);       // tutar − Σisk = e-faturanın Mal Hizmet Tutarı
    expect(t.fazla).toBeCloseTo(114817.5, 2);        // Mikro'nun fazladan eklediği
    expect(satirlar[1].tarih).toBeNull();
    expect(satirlar[1].oran).toBe(20);
    expect(degerlendirilen.has('RULO1081')).toBe(true);
    expect(degerlendirilen.has('CIM-50')).toBe(true);        // KDV'si Mikro okumasına oturuyor → gerçekten temiz (0)
  });
  it('başlık yoksa hüküm YOK: liste boş ve ürün değerlendirilmedi (0 değil, bilinmiyor)', () => {
    const { satirlar, degerlendirilen } = mikroTutarsizliklari([E420, BASKA]);
    expect(satirlar).toEqual([]);
    expect(degerlendirilen.has('RULO1081')).toBe(false);
    expect(degerlendirilen.has('CIM-50')).toBe(true);        // imza yok → başlık olmadan da temiz
  });
  it('hazır çözüm paylaşılır (sunucu hareketleri iki kez çözmez): sonuç aynı', () => {
    const h = [E420, E435, BASKA];
    const hazir = mikroTutarsizliklari(h, undefined, netCozumleri(h, { faturaToplamlari: FT }));
    expect(hazir.satirlar.map(x => x.evrakNo)).toEqual(['420', '435']);
  });
  it('iptal satır, SKU\'suz satır ve iskontosuz satır: listelenmez; iskontosuz ürün değerlendirilmiş sayılır (çift iskonto imkânsız)', () => {
    const iptal = { ...E420, sth_iptal: 1 };
    const r = mikroTutarsizliklari([iptal, { ...E435, sth_stok_kod: '' }, { ...BASKA, sth_stok_kod: 'SADE', sth_iskonto1: 0, sth_vergi: 150 }], { faturaToplamlari: FT });
    expect(r.satirlar).toEqual([]);
    expect(r.degerlendirilen.has('RULO1081')).toBe(false);
    expect(r.degerlendirilen.has('SADE')).toBe(true);
  });
  // Tur 2 (2026-09-28, D3-ek2): başlık fatura altını DOĞRULADI (faturaAltiBasliktan, net = çift okuma neti 1.700) → Mikro
  // kaydı cari ve maliyette tutarlı, gösterilen net iki okumada aynı: fatura modalı gibi TEMİZ (eskiden belirsizdi).
  it('imzalı satırı başlık fatura altı olarak DOĞRULADIYSA (net aynı) temiz; KDV\'siz iskontolu satır DEĞERLENDİRİLEMEDİ', () => {
    const esit = { ...BASKA, sth_stok_kod: 'ESIT', sth_evrakno_sira: 13, sth_tutar: 2300, sth_iskonto1: 300, sth_vergi: 340 };
    const kdvsiz = { ...BASKA, sth_stok_kod: 'KDVSIZ', sth_evrakno_sira: 14, sth_vergi: 0 };
    const r = mikroTutarsizliklari([esit, kdvsiz], { faturaToplamlari: faturaToplamlari([
      { cha_evrakno_seri: '', cha_evrakno_sira: 13, cha_tip: 1, cha_meblag: 2040 },
      { cha_evrakno_seri: '', cha_evrakno_sira: 14, cha_tip: 1, cha_meblag: 900 },
    ]) });
    expect(r.satirlar).toEqual([]);
    expect(r.degerlendirilen.has('ESIT')).toBe(true);
    expect(r.belirsizUrunler.has('ESIT')).toBe(false);
    expect(r.degerlendirilen.has('KDVSIZ')).toBe(false);
  });
  it('tutarsız satırı bulunan ürün, denetlenemeyen başka satırı olsa da DEĞERLENDİRİLMİŞTİR (bulgu kesin; sayı alt sınır)', () => {
    const r = mikroTutarsizliklari([E420, E435], { faturaToplamlari: faturaToplamlari([B420]) });   // 435'in başlığı yok
    expect(r.satirlar.map(x => x.evrakNo)).toEqual(['420']);
    expect(r.degerlendirilen.has('RULO1081')).toBe(true);
  });
});

// ── Tur 1 düzeltmeleri (2026-09-28): aralık koruması / geçerli-oran çakışması SAHTE KESİNLİK üretmesin ──────────────
// D1 çekirdek kuralı DEĞİŞMEZ (netler aynı kalır) — yalnız "temiz" hükmü ve yeşil ✓ artık verilmez.
describe('çift iskonto okuması da aritmetik olarak mümkünse: net DEĞİŞMEZ, ama "temiz" / yeşil hükmü verilmez', () => {
  const baslik = (sira: number, meblag: number) => faturaToplamlari([{ cha_evrakno_seri: '', cha_evrakno_sira: sira, cha_tip: 1, cha_meblag: meblag }]);
  it('TEK %10 iskonto (en yaygın oran): 1.100/100/KDV 180 → Mikro okuması 1.000 × %18 = 180 ≡ 900 × %20 (aralık koruması)', () => {
    const h = kalem(21, { sth_tutar: 1100, sth_iskonto1: 100, sth_vergi: 180, sth_vergi_pntr: 4 });
    const { c, s } = fatura([h], 1180);
    expect(c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 1000 });            // D1: Mikro'nun okuması korunur
    expect(s).toMatchObject({ tutuyor: true, mikroKaydiTutarsiz: false, kdvUyumsuz: 1, ciftBelirsiz: 1 });
    const r = mikroTutarsizliklari([h], { faturaToplamlari: baslik(21, 1180) });
    expect(r.satirlar).toEqual([]);
    expect(r.degerlendirilen.has('S21')).toBe(false);                                // "yok" DEĞİL, değerlendirilemedi
    // pntr yoksa kdvUyumsuz sayamaz — ama çift okuma yine mümkün → yeşil verilmez, ürün yine değerlendirilemedi.
    const p = { ...h, sth_vergi_pntr: undefined };
    const ps = fatura([p], 1180);
    expect(ps.s).toMatchObject({ tutuyor: true, kdvUyumsuz: 0, ciftBelirsiz: 1 });
    expect(mikroTutarsizliklari([p], { faturaToplamlari: baslik(21, 1180) }).degerlendirilen.has('S21')).toBe(false);
  });
  it('%10 KDV\'li kalemde %20 iskonto (pntr 3): 1.200/200/KDV 80 → 1.000 × %8 = 80 ≡ 800 × %10 → değerlendirilemedi', () => {
    const h = kalem(22, { sth_tutar: 1200, sth_iskonto1: 200, sth_vergi: 80, sth_vergi_pntr: 3 });
    expect(fatura([h], 1080).c[0]).toMatchObject({ net: 1000 });
    expect(mikroTutarsizliklari([h], { faturaToplamlari: baslik(22, 1080) }).degerlendirilen.has('S22')).toBe(false);
  });
  it('%50 iskonto: (tutar − isk) × %10 = KDV ama pntr %20 → net değişmez (satirIskontosu), ürün "temiz" SAYILMAZ', () => {
    const h = kalem(23, { sth_miktar: 100, sth_tutar: 15000, sth_iskonto1: 5000, sth_vergi: 1000, sth_vergi_pntr: 4 });
    const { c, s } = fatura([h], 11000);
    expect(c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 10000 });
    expect(s).toMatchObject({ kdvUyumsuz: 1 });
    expect(mikroTutarsizliklari([h], { faturaToplamlari: baslik(23, 11000) }).degerlendirilen.has('S23')).toBe(false);
    // pntr yok: 10.000 × %10 ≡ 5.000 × %20 — iki okuma da geçerli → ciftBelirsiz, ürün değerlendirilemedi
    const p = { ...h, sth_vergi_pntr: undefined };
    expect(fatura([p], 11000).s).toMatchObject({ kdvUyumsuz: 0, ciftBelirsiz: 1 });
    expect(mikroTutarsizliklari([p], { faturaToplamlari: baslik(23, 11000) }).degerlendirilen.has('S23')).toBe(false);
  });
  it('%33⅓ iskonto tutarZatenNet dalında: tutar × %10 = KDV ≡ (tutar − 2·isk) × %20 → değerlendirilemedi (pntr\'li ve pntr\'siz)', () => {
    const h = kalem(24, { sth_tutar: 1200, sth_iskonto1: 300, sth_vergi: 120, sth_vergi_pntr: 4 });
    expect(fatura([h], 1320).c[0]).toMatchObject({ kaynak: 'tutarZatenNet', net: 1200 });
    expect(mikroTutarsizliklari([h], { faturaToplamlari: baslik(24, 1320) }).degerlendirilen.has('S24')).toBe(false);
    const p = { ...h, sth_vergi_pntr: undefined };
    expect(mikroTutarsizliklari([p], { faturaToplamlari: baslik(24, 1320) }).degerlendirilen.has('S24')).toBe(false);
  });
  it('meşru tutarlı satır iskontosu (1.000/100/180): çift okuma oturmuyor → temiz ve yeşil kalır (ciftBelirsiz 0)', () => {
    const h = kalem(25, { sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 180, sth_vergi_pntr: 4 });
    expect(fatura([h], 1080).s).toMatchObject({ tutuyor: true, kdvUyumsuz: 0, ciftBelirsiz: 0 });
    expect(mikroTutarsizliklari([h], { faturaToplamlari: baslik(25, 1080) }).degerlendirilen.has('S25')).toBe(true);
  });
  it('iki çift iskontolu kalem, biri korumaya takılıyor: "kalem netleri doğru" (mikroKaydiTutarsiz) hükmü VERİLMEZ', () => {
    // (a) 2.300/300/340 imzalı (gerçek net 1.700); (b) 1.100/100/180 korumaya takılır (gerçek net 900, gösterilen 1.000).
    const a = kalem(26, { sth_tutar: 2300, sth_iskonto1: 300, sth_vergi: 340, sth_vergi_pntr: 4 });
    const b = kalem(26, { sth_stok_kod: 'S26B', sth_tutar: 1100, sth_iskonto1: 100, sth_vergi: 180, sth_vergi_pntr: 4 });
    const { c, s } = fatura([a, b], 3520);
    expect(c.map(k => [k.kaynak, k.net])).toEqual([['mikroKaydiTutarsiz', 1700], ['satirIskontosu', 1000]]);
    expect(s).toMatchObject({ mikroFazlasi: 300, mikroKaydiTutarsiz: false, tutuyor: false, kdvUyumsuz: 1 });
    // pntr'siz (b): kdvUyumsuz sayamaz; ciftBelirsiz yine hükmü engeller.
    const bp = { ...b, sth_vergi_pntr: undefined };
    expect(fatura([a, bp], 3520).s).toMatchObject({ mikroKaydiTutarsiz: false, kdvUyumsuz: 0, ciftBelirsiz: 1 });
  });
  it('saglamaKur: kdvUyumsuz ya da ciftBelirsiz varken mikroKaydiTutarsiz verilmez; verilmezse alan yazılmaz', () => {
    const t = { net: 168682.5, kdv: 33736.5, masraf: 0, brut: 283500, eksik: 0, mikroFazlasi: 114817.5, kdvUyumsuz: 0, ciftBelirsiz: 0 };
    expect(saglamaKur(t, 317236.5).mikroKaydiTutarsiz).toBe(true);
    expect(saglamaKur({ ...t, kdvUyumsuz: 1 }, 317236.5).mikroKaydiTutarsiz).toBe(false);
    expect(saglamaKur({ ...t, ciftBelirsiz: 1 }, 317236.5)).toMatchObject({ mikroKaydiTutarsiz: false, ciftBelirsiz: 1 });
    expect(saglamaKur({ ...t, ciftBelirsiz: undefined }, 317236.5)).not.toHaveProperty('ciftBelirsiz');
  });
  it('ARALIK KORUMASI masraf kolu: 2024 meşru %18 satır (2.220/220/masraf 200/KDV 396) — (2.000 + 200) × %18 ≡ (1.780 + 200) × %20', () => {
    // Mikro okuması 2.000 hiçbir oranda 396 vermez; YALNIZ masraf eklenince (2.200 × %18) oturur → korumanın masraf kolu.
    const { c, s } = fatura([kalem(27, { sth_tarih: '2024-03-15', sth_tutar: 2220, sth_iskonto1: 220, sth_masraf1: 200, sth_vergi: 396, sth_vergi_pntr: 4 })], 2596);
    expect(c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 2000, brut: 2220 });
    expect(s).toMatchObject({ mikroKaydiTutarsiz: false, mikroFazlasi: 0 });
  });
});

describe('tur 2 (2026-09-28): ayırt edilemezlik TEK ölçü; bayrağı vermeyen çağıran "kalem netleri doğru" hükmü ALAMAZ', () => {
  const basliklar = (...l: [number, number][]) => faturaToplamlari(l.map(([sira, meblag]) => ({ cha_evrakno_seri: '', cha_evrakno_sira: sira, cha_tip: 1, cha_meblag: meblag })));
  it('saglamaKur: kdvUyumsuz / ciftBelirsiz VERİLMEDİYSE mikroKaydiTutarsiz false (bilinmeyen 0 sayılmaz)', () => {
    const t = { net: 168682.5, kdv: 33736.5, masraf: 0, brut: 283500, eksik: 0, mikroFazlasi: 114817.5 };
    expect(saglamaKur(t, 317236.5).mikroKaydiTutarsiz).toBe(false);
    expect(saglamaKur({ ...t, kdvUyumsuz: 0 }, 317236.5).mikroKaydiTutarsiz).toBe(false);
    expect(saglamaKur({ ...t, ciftBelirsiz: 0 }, 317236.5).mikroKaydiTutarsiz).toBe(false);
    expect(saglamaKur({ ...t, kdvUyumsuz: 0, ciftBelirsiz: 0 }, 317236.5).mikroKaydiTutarsiz).toBe(true);
  });
  it('EŞİT net (1.000/100/KDV 160, başlık 960 → net 800): imzalı ama başlık fatura altını DOĞRULADI → modal da liste de temiz', () => {
    const h = kalem(31, { sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 160, sth_vergi_pntr: 4 });
    const { c, s } = fatura([h], 960);
    expect(c[0]).toMatchObject({ kaynak: 'faturaAltiBasliktan', ciftIskontoBelirsiz: false });
    expect(c[0].net).toBeCloseTo(800, 6);
    expect(s).toMatchObject({ tutuyor: true, ciftBelirsiz: 0, kdvUyumsuz: 0, mikroKaydiTutarsiz: false });
    const r = mikroTutarsizliklari([h], { faturaToplamlari: basliklar([31, 960]) });
    expect(r.degerlendirilen.has('S31')).toBe(true);
    expect(r.belirsizFaturalar.size).toBe(0);
    expect(r.belirsizUrunler.size).toBe(0);
    // Başlık yoksa aynı imzalı satır: Mikro kaydının tutarlılığı bilinmiyor → liste için BELİRSİZ kalır.
    expect(mikroTutarsizliklari([h]).belirsizUrunler.has('S31')).toBe(true);
  });
  it('küsurat iskontosu (100.037,50 / 37,50 / KDV 20.000): çift okuma KDV payında ama gösterilen okumadan KÖTÜ → belirsiz DEĞİL', () => {
    const h = kalem(32, { sth_tutar: 100037.5, sth_iskonto1: 37.5, sth_vergi: 20000, sth_vergi_pntr: 4 });
    const { c, s } = fatura([h], 120000);
    expect(c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 100000, ciftIskontoBelirsiz: false });
    expect(s).toMatchObject({ tutuyor: true, ciftBelirsiz: 0, kdvUyumsuz: 0 });
    expect(mikroTutarsizliklari([h], { faturaToplamlari: basliklar([32, 120000]) }).degerlendirilen.has('S32')).toBe(true);
  });
  it('evrak 420 + küsurat satırı aynı faturada: modal ve liste AYNI hüküm (kesin, belirsiz satır yok)', () => {
    const a = kalem(33, { sth_stok_kod: 'RULO1081', sth_miktar: 1050, sth_tutar: 398317.5, sth_iskonto1: 85050, sth_iskonto2: 29767.5, sth_vergi: 33736.5, sth_vergi_pntr: 4 });
    const b = kalem(33, { sth_tutar: 100037.5, sth_iskonto1: 37.5, sth_vergi: 20000, sth_vergi_pntr: 4 });
    const meblag = 317236.5 + 120000;
    expect(fatura([a, b], meblag).s).toMatchObject({ mikroKaydiTutarsiz: true, ciftBelirsiz: 0 });
    const r = mikroTutarsizliklari([a, b], { faturaToplamlari: basliklar([33, meblag]) });
    expect(r.satirlar.map(x => x.sku)).toEqual(['RULO1081']);
    expect(r.belirsizFaturalar.size).toBe(0);
  });
  it('kuruş yuvarlama iskontosu (100,25 / 0,25 / KDV 20) ve %1 KDV (5.000 / 5 / KDV 49,95): yeşil kalır, ürün değerlendirilir', () => {
    const a = kalem(34, { sth_tutar: 100.25, sth_iskonto1: 0.25, sth_vergi: 20, sth_vergi_pntr: 4 });
    const b = kalem(35, { sth_tutar: 5000, sth_iskonto1: 5, sth_vergi: 49.95, sth_vergi_pntr: 2 });
    expect(fatura([a], 120).s).toMatchObject({ tutuyor: true, ciftBelirsiz: 0, kdvUyumsuz: 0 });
    expect(fatura([b], 5044.95).s).toMatchObject({ tutuyor: true, ciftBelirsiz: 0, kdvUyumsuz: 0 });
    const r = mikroTutarsizliklari([a, b], { faturaToplamlari: basliklar([34, 120], [35, 5044.95]) });
    expect([r.degerlendirilen.has('S34'), r.degerlendirilen.has('S35')]).toEqual([true, true]);
  });
  it('belirsizUrunler: ürünün bir faturasında bulgu, başka faturasında belirsiz satır → ürün hem değerlendirilen hem belirsiz', () => {
    const e = kalem(420, { sth_stok_kod: 'RULO1081', sth_miktar: 1050, sth_tutar: 398317.5, sth_iskonto1: 85050, sth_iskonto2: 29767.5, sth_vergi: 33736.5, sth_vergi_pntr: 4 });
    const s388 = kalem(388, { sth_stok_kod: 'RULO1081', sth_tutar: 2300, sth_iskonto1: 300, sth_vergi: 340, sth_vergi_pntr: 4 });
    const r = mikroTutarsizliklari([e, s388], { faturaToplamlari: basliklar([420, 317236.5], [388, 1000]) });
    expect(r.satirlar).toHaveLength(1);
    expect(r.degerlendirilen.has('RULO1081')).toBe(true);        // anlam DEĞİŞMEDİ (Fiyat Karşılaştırma 0/null ayrımı)
    expect(r.belirsizUrunler.has('RULO1081')).toBe(true);
    expect([...r.belirsizFaturalar.keys()]).toEqual(['gelen||388']);
  });
  it('kdvOranaUymuyor dışa açık: kalıcı kalem bayrağı kalemSaglamasi ile AYNI ölçü', () => {
    expect(kdvOranaUymuyor(kalem(36, { sth_tutar: 1000, sth_vergi: 100, sth_vergi_pntr: 4 }), 1000)).toBe(true);
    expect(kdvOranaUymuyor(kalem(36, { sth_tutar: 1000, sth_vergi: 200, sth_vergi_pntr: 4 }), 1000)).toBe(false);
  });
});

describe('tur 3 (2026-09-28): başlık Mikro okumasını AÇIKÇA doğrulamadıkça etiket yok · o tarihte geçersiz pntr BİLİNMİYOR · belirsizlik kuruş yuvarlamasıyla', () => {
  const basliklar = (...l: [number, number][]) => faturaToplamlari(l.map(([sira, meblag]) => ({ cha_evrakno_seri: '', cha_evrakno_sira: sira, cha_tip: 1, cha_meblag: meblag })));
  it('meşru: 100.000 / satır iskontosu 100 / fatura altı 100 (KDV 19.960, başlık 119.760) — başlık ÇİFT okumayı doğruluyor → etiket YOK, net 99.800, liste temiz', () => {
    const h = kalem(41, { sth_tutar: 100000, sth_iskonto1: 100, sth_vergi: 19960, sth_vergi_pntr: 4 });
    const { c, s } = fatura([h], 119760);
    expect(c[0].kaynak).toBe('faturaAltiBasliktan');
    expect(c[0].net).toBeCloseTo(99800, 6);
    expect(s).toMatchObject({ tutuyor: true, mikroFazlasi: 0, kdvUyumsuz: 0, ciftBelirsiz: 0, mikroKaydiTutarsiz: false });
    const r = mikroTutarsizliklari([h], { faturaToplamlari: basliklar([41, 119760]) });
    expect(r.satirlar).toEqual([]);
    expect(r.degerlendirilen.has('S41')).toBe(true);
    expect(r.belirsizUrunler.size).toBe(0);
  });
  it('fatura altı 60 (KDV 19.968, başlık 119.808): gösterilen net GERÇEK net 99.840 — çift okuma 99.800 DEĞİL', () => {
    const h = kalem(42, { sth_tutar: 100000, sth_iskonto1: 100, sth_vergi: 19968, sth_vergi_pntr: 4 });
    const { c, s } = fatura([h], 119808);
    expect(c[0].kaynak).toBe('faturaAltiBasliktan');
    expect(c[0].net).toBeCloseTo(99840, 6);
    expect(s).toMatchObject({ tutuyor: true, mikroFazlasi: 0 });
  });
  // Son kontrol 2026-09-28: karma fatura (A imzalı, B imzasız) → B CANLIDAKİ gibi (90.000, origin/main ile ölçüldü; bilinen sınır,
  // kdvUyumsuz yakalar → yeşil ✓ yok); imzalı A başlık onayı olmadan KENDİ KDV çözümünü korur (9.980 — fikstürün gerçek neti).
  it('karma fatura (A 10.000 / isk 10 imzalı, B 90.000 iskontosuz, %0,1 fatura altı): A bulgu DEĞİL; B canlıdaki gibi 90.000, kdvUyumsuz yakalar', () => {
    const a = kalem(43, { sth_stok_kod: 'A43', sth_tutar: 10000, sth_iskonto1: 10, sth_vergi: 1996, sth_vergi_pntr: 4 });
    const b = kalem(43, { sth_stok_kod: 'B43', sth_tutar: 90000, sth_vergi: 17982, sth_vergi_pntr: 4 });
    const meblag = 119868.01;
    const { c, s } = fatura([a, b], meblag);
    expect(c.map(x => [x.kaynak, x.net])).toEqual([['faturaAltiKdvden', 9980], ['iskontosuz', 90000]]);
    expect(s).toMatchObject({ tutuyor: false, kdvUyumsuz: 1, mikroFazlasi: 0, mikroKaydiTutarsiz: false });
    expect(mikroTutarsizliklari([a, b], { faturaToplamlari: basliklar([43, meblag]) }).satirlar).toEqual([]);
  });
  it('başlık Mikro okumasına geniş hakem payında (%0,15) yakın ama sağlama payında (%0,05) DEĞİL → etiket yok, imzalı satır BELİRSİZ', () => {
    // 100.100 / 100 / KDV 19.980 (= 99.900 × %20); Mikro okuması 100.000 → tutarlı Mikro başlığı 119.980 olurdu; başlık 120 fazla.
    const h = kalem(44, { sth_tutar: 100100, sth_iskonto1: 100, sth_vergi: 19980, sth_vergi_pntr: 4 });
    const { c, s } = fatura([h], 120100);
    expect(c[0].kaynak).toBe('faturaAltiKdvden');
    expect(c[0].net).toBeCloseTo(99900, 6);
    expect(s).toMatchObject({ mikroFazlasi: 0, tutuyor: false });
    const r = mikroTutarsizliklari([h], { faturaToplamlari: basliklar([44, 120100]) });
    expect(r.satirlar).toEqual([]);
    expect([...r.belirsizFaturalar.keys()]).toEqual(['gelen||44']);
    // Mutasyon koruması: başlık Mikro okumasını sağlama payında doğruluyorsa etiket VERİLİR (evrak 420 kalıbı).
    expect(fatura([h], 119980).c[0].kaynak).toBe('mikroKaydiTutarsiz');
  });
  it('2023-07-10 öncesi pntr 4 (%20 o tarihte GEÇERSİZ → bilinmiyor): evrak 420 deseni %18 ile TESPİT edilir, "temiz" denmez', () => {
    const h = kalem(45, { sth_stok_kod: 'RULO1081', sth_tarih: '2022-06-01', sth_miktar: 1050, sth_tutar: 398317.5, sth_iskonto1: 85050, sth_iskonto2: 29767.5, sth_vergi: 30362.85, sth_vergi_pntr: 4 });
    // Başlıksız yol CANLIDAKİ gibi (son kontrol 2026-09-28: fatura altı seçimi ham işaretçiyle; origin/main ile ölçüldü).
    expect(satirNet(h)).toMatchObject({ durum: 'tamam', kaynak: 'dogrulanamadi', net: 283500 });
    const { c, s } = fatura([h], 313862.85);
    expect(c[0].kaynak).toBe('mikroKaydiTutarsiz');
    expect(c[0].net).toBeCloseTo(168682.5, 2);
    expect(s).toMatchObject({ mikroKaydiTutarsiz: true, kdvUyumsuz: 0, ciftBelirsiz: 0 });
    const r = mikroTutarsizliklari([h], { faturaToplamlari: basliklar([45, 313862.85]) });
    expect(r.satirlar).toHaveLength(1);
    expect(r.satirlar[0].oran).toBe(18);
    expect(r.satirlar[0].fazla).toBeCloseTo(114817.5, 2);
  });
  it('2023 öncesi pntr 3 (%10 o tarihte geçersiz; 1.300 / 300 / KDV 56 = 700 × %8): başlıksız liste TEMİZ demez, başlıkla bulgu', () => {
    const h = kalem(46, { sth_tarih: '2022-06-01', sth_tutar: 1300, sth_iskonto1: 300, sth_vergi: 56, sth_vergi_pntr: 3 });
    const r = mikroTutarsizliklari([h]);
    expect(r.degerlendirilen.has('S46')).toBe(false);
    expect(r.belirsizUrunler.has('S46')).toBe(true);
    expect(fatura([h], 1056).c[0].kaynak).toBe('mikroKaydiTutarsiz');
    expect(kdvOranaUymuyor(h, 700)).toBe(false);                      // oran bilinmiyor → hüküm yok (anlam DEĞİŞMEDİ)
  });
  it('%1 KDV (1.000 / 1 / KDV 9,99): çift okuma (998 → 9,98) kuruş yuvarlamasıyla bu KDV\'yi VEREMEZ → belirsiz DEĞİL, yeşil, ürün değerlendirilir', () => {
    const h = kalem(47, { sth_tutar: 1000, sth_iskonto1: 1, sth_vergi: 9.99, sth_vergi_pntr: 2 });
    const { c, s } = fatura([h], 1008.99);
    expect(c[0]).toMatchObject({ kaynak: 'satirIskontosu', ciftIskontoBelirsiz: false });
    expect(s).toMatchObject({ tutuyor: true, ciftBelirsiz: 0, kdvUyumsuz: 0 });
    const r = mikroTutarsizliklari([h], { faturaToplamlari: basliklar([47, 1008.99]) });
    expect(r.degerlendirilen.has('S47')).toBe(true);
    expect(r.belirsizUrunler.size).toBe(0);
  });
  it('yarım kuruş içinde iki okuma da oturuyorsa belirsiz KALIR (%50 iskonto çakışması, çift okuma artığı 0,004)', () => {
    // Mikro okuması 10.000 × %10 = 1.000 (artık 0); çift okuma 5.000,02 × %20 = 1.000,004 (artık 0,004 < yarım kuruş).
    const h = kalem(48, { sth_tutar: 14999.98, sth_iskonto1: 4999.98, sth_vergi: 1000, sth_vergi_pntr: 4 });
    expect(kalemleriCoz([h])[0]).toMatchObject({ kaynak: 'satirIskontosu', ciftIskontoBelirsiz: true });
  });
});

describe('delta tur 1 (2026-09-28): oranı bilinmeyen satırda KDV hükmü · imzasız satır = canlı davranış (bilinen sınır) · sınır/mutasyon vakaları', () => {
  const basliklar = (...l: [number, number][]) => faturaToplamlari(l.map(([sira, meblag]) => ({ cha_evrakno_seri: '', cha_evrakno_sira: sira, cha_tip: 1, cha_meblag: meblag })));
  // ── Bulgu 1: pntr bilinmiyor → tarihin OLASI oranlarının hiçbiri tutmuyorsa uyumsuz (bilinmeyen ≠ tutuyor) ──
  it('2022 pntr 4 (oran bilinmiyor): Mikro\'ya iskontonun yalnız %30\'u girilmiş, KDV e-faturadan → 198.450 × %18/%8/%1 bu KDV\'yi VERMEZ → kdvUyumsuz, yeşil yok, liste belirsiz', () => {
    const h = kalem(50, { sth_tarih: '2022-05-01', sth_tutar: 283500, sth_iskonto1: 85050, sth_vergi: 30362.85, sth_vergi_pntr: 4 });
    const { c, s } = fatura([h], 228812.85);
    expect(c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 198450 });
    expect(s).toMatchObject({ tutuyor: true, kdvUyumsuz: 1 });
    expect(kdvOranaUymuyor(h, 198450)).toBe(true);
    const r = mikroTutarsizliklari([h], { faturaToplamlari: basliklar([50, 228812.85]) });
    expect(r.degerlendirilen.has('S50')).toBe(false);
    expect(r.belirsizUrunler.has('S50')).toBe(true);
  });
  it('pntr YOK (2026): aynı desen → kdvUyumsuz 1', () => {
    const h = kalem(51, { sth_tutar: 283500, sth_iskonto1: 85050, sth_vergi: 33736.5, sth_vergi_pntr: null });
    const { c, s } = fatura([h], 232186.5);
    expect(c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 198450 });
    expect(s).toMatchObject({ kdvUyumsuz: 1 });
  });
  it('iskonto HİÇ girilmemiş (2022 pntr 4, net = brüt 283.500, KDV 30.362,85): yeşil ✓ YOK — kullanıcının şikâyeti', () => {
    const h = kalem(52, { sth_tarih: '2022-05-01', sth_tutar: 283500, sth_vergi: 30362.85, sth_vergi_pntr: 4 });
    const { c, s } = fatura([h], 313862.85);
    expect(c[0]).toMatchObject({ kaynak: 'iskontosuz', net: 283500 });
    expect(s).toMatchObject({ tutuyor: true, kdvUyumsuz: 1 });
  });
  it('oran bilinmiyor ama olası bir orana OTURUYOR → hüküm yok (false): 2022 %18, 2025 eski oranlı %18 iade, 2026 %10; %0 işaretçisi anlamı DEĞİŞMEDİ', () => {
    expect(kdvOranaUymuyor(kalem(53, { sth_tarih: '2022-06-01', sth_vergi: 180, sth_vergi_pntr: 4 }), 1000)).toBe(false);
    expect(kdvOranaUymuyor(kalem(53, { sth_tarih: '2025-06-01', sth_vergi: 180, sth_vergi_pntr: null }), 1000)).toBe(false);
    expect(kdvOranaUymuyor(kalem(53, { sth_vergi: 100, sth_vergi_pntr: null }), 1000)).toBe(false);
    expect(kdvOranaUymuyor(kalem(53, { sth_vergi: 100, sth_vergi_pntr: 1 }), 1000)).toBe(false);
    // Delta 2 (M2): %0 işaretçisi HER tarihte bilinir — ayırt edici KDV: 50 = %5, hiçbir olası orana oturmaz; pntr 1
    // 'bilinmiyor' sayılsa (r === 0 istisnası silinirse) true dönerdi. 100 KDV (%10) iki davranışı ayırt ETMİYORDU.
    expect(kdvOranaUymuyor(kalem(53, { sth_vergi: 50, sth_vergi_pntr: 1 }), 1000)).toBe(false);
    expect(kdvOranaUymuyor(kalem(53, { sth_tarih: '2022-06-01', sth_vergi: 50, sth_vergi_pntr: 1 }), 1000)).toBe(false);
    // 2023-07-10 öncesi %20 yoktu: pntr bilinmiyorsa 1.000 × %20 = 200 KDV hiçbir olası orana oturmaz.
    expect(kdvOranaUymuyor(kalem(53, { sth_tarih: '2022-06-01', sth_vergi: 200, sth_vergi_pntr: null }), 1000)).toBe(true);
    // Masraf matraha girdiyse (1.000 + masraf 100) × %20 = 220 → oturuyor.
    expect(kdvOranaUymuyor(kalem(53, { sth_vergi: 220, sth_vergi_pntr: null, sth_masraf1: 100 }), 1000)).toBe(false);
  });
  // KAPSAM KARARI (orkestratör 2026-09-28): imzasız (Mikro'da tutarlı) satırda başlık hakemi CANLIDAKİ davranışın aynısı —
  // delta turlarında buraya genişletilen "iki okuma" kıyası her turda yeni gerileme üretti. Aşağıdaki beş vaka PARİTE +
  // BİLİNEN SINIR: net canlıyla birebir (origin/main ile ölçüldü); küçük fatura altı iskonto %0,15 pay içinde yutulur ama
  // bağımsız KDV ağı (kdvUyumsuz) satırı yakalar → yeşil ✓ VERİLMEZ, kullanıcı "KDV doğrulanamadı" görür (açık iş).
  it('BİLİNEN SINIR (canlıyla aynı): imzasız 100.000 / 100 / fatura altı 50 (KDV 19.970, başlık 119.820) → net 99.900 (Mikro okuması); kdvUyumsuz yakalar', () => {
    const h = kalem(54, { sth_tutar: 100000, sth_iskonto1: 100, sth_vergi: 19970, sth_vergi_pntr: null });
    const { c, s } = fatura([h], 119820);
    expect(c[0]).toMatchObject({ kaynak: 'satirIskontosu', net: 99900 });
    expect(s).toMatchObject({ kdvUyumsuz: 1 });                  // yeşil ✓ yok
  });
  it('BİLİNEN SINIR (canlıyla aynı): imzasız 10 × 10.000, küsurat fatura altı 100 (KDV 1.998 × 10, başlık 119.880) → 10.000; sağlama tutmaz, 10 kdvUyumsuz', () => {
    const l = Array.from({ length: 10 }, (_, i) => kalem(55, { sth_stok_kod: `K${i}`, sth_tutar: 10000, sth_vergi: 1998, sth_vergi_pntr: 4 }));
    const { c, s } = fatura(l, 119880);
    expect(c.every(x => x.kaynak === 'iskontosuz' && x.net === 10000)).toBe(true);
    expect(s).toMatchObject({ tutuyor: false, kdvUyumsuz: 10 });
  });
  it('imzasız, başlık Mikro okumasını doğruluyor (2025 eski oranlı %18 iade, pntr yok: 1.000 / KDV 180, başlık 1.180) → ≈1 KALIR, net 1.000', () => {
    const h = kalem(56, { sth_tarih: '2025-06-01', sth_tutar: 1000, sth_vergi: 180, sth_vergi_pntr: null });
    const { c, s } = fatura([h], 1180);
    expect(c[0]).toMatchObject({ kaynak: 'iskontosuz', net: 1000 });
    expect(s).toMatchObject({ tutuyor: true, kdvUyumsuz: 0 });
  });
  // ── Bulgu 9: eşitlik sınırı (ciftFark = mikroFark → ≈1 SAYILMAZ) ──
  it('EŞİTLİK sınırı: fatura altı = satır iskontosunun yarısı (KDV 19.960, başlık 119.810) → fatura altı dalı, net 99.850', () => {
    const h = kalem(57, { sth_tutar: 100000, sth_iskonto1: 100, sth_vergi: 19960, sth_vergi_pntr: 4 });
    const { c } = fatura([h], 119810);
    expect(c[0].kaynak).toBe('faturaAltiBasliktan');
    expect(c[0].net).toBeCloseTo(99850, 6);
  });
  // ── Bulgu 5: ayırt payı (ciftFark − mikroFark > ayirtPay) ve satır sayısıyla büyümesi ──
  const imzali = (sira: number) => kalem(sira, { sth_stok_kod: `I${sira}`, sth_tutar: 1000, sth_iskonto1: 1, sth_vergi: 199.6, sth_vergi_pntr: 4 });
  it('tek satır: başlık iki okumayı ayırt etmiyor (hedef 998,52: mikroFark 0,48, ciftFark 0,52) → etiket YOK; başlık Mikro okumasını tam doğrularsa etiket VAR', () => {
    const h = imzali(58);
    const { c, s } = fatura([h], 1198.12);
    expect(c[0]).toMatchObject({ kaynak: 'faturaAltiKdvden', brut: 1000 });
    expect(c[0].net).toBeCloseTo(998, 6);
    expect(s).toMatchObject({ mikroKaydiTutarsiz: false, mikroFazlasi: 0 });
    expect(fatura([h], 1198.6).c[0].kaynak).toBe('mikroKaydiTutarsiz');
  });
  it('20 satır: ayırt payı 0,21 — fark 0,10 (hedef 998,55) etiket VERMEZ, fark 0,60 (hedef 998,80) VERİR', () => {
    const temiz = Array.from({ length: 19 }, (_, i) => kalem(59, { sth_stok_kod: `T${i}`, sth_tutar: 100, sth_vergi: 20, sth_vergi_pntr: 4 }));
    const l = [imzali(59), ...temiz];
    expect(fatura(l, 3478.15).c[0].kaynak).toBe('faturaAltiKdvden');
    expect(fatura(l, 3478.4).c[0].kaynak).toBe('mikroKaydiTutarsiz');
  });
  // ── Bulgu 6: kesin pay meblağla ölçeklenir (max(1, meblağ·0,0005)) — etiket ⇔ sağlamanın hükmü ──
  it('evrak 420, başlık Mikro okumasından 2 / 150 TL fazla (pay 158,6 içinde) → etiket + "Mikro kaydı tutarsız"; 170 TL (pay dışı) → etiket YOK', () => {
    for (const fazla of [2, 150]) {
      const m = 317236.5 + fazla;
      const c = kalemleriCoz([E420], m);
      expect(c[0]).toMatchObject({ kaynak: 'mikroKaydiTutarsiz', net: 168682.5 });
      expect(kalemSaglamasi([E420], c, m)).toMatchObject({ mikroKaydiTutarsiz: true });
      const d = stokFiyatDetay([E420], 'RULO1081', { faturaToplamlari: faturaToplamlari([{ ...B420, cha_meblag: m }]) });
      expect(d[0]).toMatchObject({ kaynak: 'mikroKaydiTutarsiz' });
    }
    const m = 317236.5 + 170;
    const c = kalemleriCoz([E420], m);
    expect(c[0].kaynak).not.toBe('mikroKaydiTutarsiz');
    expect(kalemSaglamasi([E420], c, m)).toMatchObject({ mikroKaydiTutarsiz: false });
  });
  // ── Bulgu 8: yarım kuruş eşitliği kayan noktada 0,005'in ÜSTÜNE düşer — EPS ──
  it('tam yarım kuruş eşitliği (1,21 / 0,08 / KDV 0,11 %10: çift okuma 1,05 → 0,105, artık 0,0050000000000000044) belirsiz KALIR', () => {
    const h = kalem(60, { sth_tarih: '2025-03-01', sth_tutar: 1.21, sth_iskonto1: 0.08, sth_vergi: 0.11, sth_vergi_pntr: 3 });
    expect(kalemleriCoz([h])[0]).toMatchObject({ kaynak: 'satirIskontosu', ciftIskontoBelirsiz: true });
  });
});

describe('son kontrol (2026-09-28): karma fatura ve başlıksız yol CANLIYLA aynı', () => {
  // Değerler origin/main ile ölçüldü (bulgu senaryoları).
  it('karma fatura: imzalı S (100.400 / 200 / KDV 20.000) + %0 imzasız Z (200.000), başlık 320.000 → Z canlıdaki gibi 200.000 iskontosuz', () => {
    const S = kalem(90, { sth_stok_kod: 'S90', sth_tutar: 100400, sth_iskonto1: 200, sth_vergi: 20000, sth_vergi_pntr: 4 });
    const Z = kalem(90, { sth_stok_kod: 'Z90', sth_tutar: 200000, sth_vergi: 0, sth_vergi_pntr: 1 });
    const c = kalemleriCoz([S, Z], 320000);
    expect(c[1]).toMatchObject({ kaynak: 'iskontosuz', net: 200000 });
    expect(c[1].kaynak).not.toBe('faturaAltiBasliktan');
  });
  it('karma fatura: imzalı S + 2025 eski oranlı %18 iade U (50.000 / KDV 9.000), başlık 179.000 → U canlıdaki gibi 50.000', () => {
    const S = kalem(91, { sth_stok_kod: 'S91', sth_tutar: 100400, sth_iskonto1: 200, sth_vergi: 20000, sth_vergi_pntr: 4 });
    const U = kalem(91, { sth_stok_kod: 'U91', sth_tarih: '2025-06-01', sth_tutar: 50000, sth_vergi: 9000, sth_vergi_pntr: null });
    const c = kalemleriCoz([S, U], 179000);
    expect(c[1].net).toBe(50000);
  });
  it('başlıksız 2022 satırı pntr 4 (1.000 / KDV 162) ve pntr 3 (1.000 / KDV 72) → canlıdaki gibi dogrulanamadi 1.000', () => {
    expect(satirNet(kalem(92, { sth_tarih: '2022-05-01', sth_tutar: 1000, sth_vergi: 162, sth_vergi_pntr: 4 }))).toMatchObject({ kaynak: 'dogrulanamadi', net: 1000 });
    expect(satirNet(kalem(92, { sth_tarih: '2022-05-01', sth_tutar: 1000, sth_vergi: 72, sth_vergi_pntr: 3 }))).toMatchObject({ kaynak: 'dogrulanamadi', net: 1000 });
  });
  it('tutarı okunamayan İSKONTOSUZ satır listeyi belirsiz yapmaz (ürün değerlendirilir); iskontolu olan belirsiz sayılır', () => {
    const r = mikroTutarsizliklari([kalem(93, { sth_stok_kod: 'TB', sth_tutar: null, sth_vergi: 20, sth_vergi_pntr: 4 })]);
    expect(r.degerlendirilen.has('TB')).toBe(true);
    expect(r.belirsizUrunler.has('TB')).toBe(false);
    const r2 = mikroTutarsizliklari([kalem(94, { sth_stok_kod: 'TI', sth_tutar: null, sth_iskonto1: 10, sth_vergi: 20, sth_vergi_pntr: 4 })]);
    expect(r2.degerlendirilen.has('TI')).toBe(false);
  });
});

describe('Delta 2 (2026-09-28): imzasız satır = canlı davranış (bilinen sınır, kdvUyumsuz yakalar); test boşlukları', () => {
  // Bulgu 1/2: doğrulanmış büyük satırın KDV payı (tol(vergi)) küsurat fatura altını yutabilir → hedef o küsuratı taşır.
  // Başlık iki okumayı bu belirsizlik ötesinde AYIRT ETMİYORSA ≈1 (Mikro okuması; D1) — KDV'den uydurma iskonto YOK.
  const buyuk = kalem(70, { sth_stok_kod: 'B70', sth_tarih: '2025-05-01', sth_tutar: 100000, sth_vergi: 19992, sth_vergi_pntr: 4 });
  it('bulgu 1: büyük doğrulanmış satır (40 TL küsurat yutulmuş) + küçük %18 iade 30 / KDV 5,40 (başlık 119.987,40) → net 30, uydurma iskonto YOK', () => {
    const iade = kalem(70, { sth_stok_kod: 'K70', sth_tarih: '2025-05-01', sth_tutar: 30, sth_vergi: 5.4, sth_vergi_pntr: null });
    const c = kalemleriCoz([buyuk, iade], 119987.4);
    expect(c[0]).toMatchObject({ kaynak: 'iskontosuz', net: 100000 });
    expect(c[1]).toMatchObject({ kaynak: 'iskontosuz', net: 30, iskonto: 0 });
  });
  it('bulgu 2: aynı büyük satır + %18 iade 100 / KDV 18 (başlık 120.070) → net 100 (yutulan küsurat küçük satıra %40 iskonto diye YIKILMAZ)', () => {
    const iade = kalem(71, { sth_stok_kod: 'K71', sth_tarih: '2025-05-01', sth_tutar: 100, sth_vergi: 18, sth_vergi_pntr: null });
    const c = kalemleriCoz([{ ...buyuk, sth_evrakno_sira: 71 }, iade], 120070);
    expect(c[1]).toMatchObject({ kaynak: 'iskontosuz', net: 100, iskonto: 0 });
  });
  it('BİLİNEN SINIR (canlıyla aynı): masraflı imzasız 100.000 / masraf 500 / fatura altı 100 (KDV 20.080, başlık 120.480) → 100.000; kdvUyumsuz yakalar', () => {
    const h = kalem(72, { sth_tarih: '2025-05-01', sth_tutar: 100000, sth_masraf1: 500, sth_vergi: 20080, sth_vergi_pntr: 4 });
    expect(satirNet(h)).toMatchObject({ kaynak: 'dogrulanamadi', net: 100000 });   // başlıksız yol (D8) DEĞİŞMEDİ
    const { c, s } = fatura([h], 120480);
    expect(c[0]).toMatchObject({ kaynak: 'iskontosuz', net: 100000 });
    expect(s).toMatchObject({ tutuyor: false, kdvUyumsuz: 1 });
  });
  it('BİLİNEN SINIR (canlıyla aynı): %1 satır 100.000 / fatura altı 100,40 (KDV 999, başlık 100.898,60) → 100.000; kdvUyumsuz yakalar', () => {
    const h = kalem(75, { sth_tutar: 100000, sth_vergi: 999, sth_vergi_pntr: 2 });
    const { c, s } = fatura([h], 100898.6);
    expect(c[0]).toMatchObject({ kaynak: 'iskontosuz', net: 100000 });
    expect(s).toMatchObject({ tutuyor: false, kdvUyumsuz: 1 });
  });
  it('BİLİNEN SINIR (canlıyla aynı): büyük satır 5 TL küsurat (KDV 19.999) + küçük satır fatura altı 100 (başlık 121.074) → iki satır da iskontosuz; kdvUyumsuz küçük satırı yakalar', () => {
    const b = kalem(76, { sth_stok_kod: 'B76', sth_tutar: 100000, sth_vergi: 19999, sth_vergi_pntr: 4 });
    const k = kalem(76, { sth_stok_kod: 'K76', sth_tutar: 1000, sth_vergi: 180, sth_vergi_pntr: 4 });
    const { c, s } = fatura([b, k], 121074);
    expect(c.map(x => [x.kaynak, x.net])).toEqual([['iskontosuz', 100000], ['iskontosuz', 1000]]);
    expect(s).toMatchObject({ tutuyor: false, kdvUyumsuz: 1 });
  });
  it('bulgu 6 (M26): çift okuma KDV\'ye gösterilenden DAHA İYİ oturuyor (100,25 / 0,25 / KDV 19,97 %20: artıklar 0,03 vs 0,02) → belirsiz, net DEĞİŞMEZ', () => {
    const h = kalem(73, { sth_tutar: 100.25, sth_iskonto1: 0.25, sth_vergi: 19.97, sth_vergi_pntr: 4 });
    expect(kalemleriCoz([h])[0]).toMatchObject({ net: 100, kaynak: 'satirIskontosu', ciftIskontoBelirsiz: true });
    expect(mikroTutarsizliklari([h]).belirsizUrunler.has('S73')).toBe(true);
    expect(fatura([h], 119.97).s).toMatchObject({ ciftBelirsiz: 1 });
  });
  it('bulgu 7 (M2): %0 işaretçisi + KDV 50 (hiçbir orana oturmaz), başlık 1.050 → net 1.000, kdvUyumsuz 0 (hüküm yok)', () => {
    const h = kalem(74, { sth_tutar: 1000, sth_vergi: 50, sth_vergi_pntr: 1 });
    const { c, s } = fatura([h], 1050);
    expect(c[0]).toMatchObject({ net: 1000, kaynak: 'iskontosuz' });
    expect(s).toMatchObject({ kdvUyumsuz: 0 });
  });
});
