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
import { satirNet, stokFiyatOzeti, stokFiyatDetay, faturaToplamlari, kalemleriCoz, birimFiyatOndaligi, faturaAnahtari, birimSapmalari, BIRIM_SAPMA_KATI } from './stokFiyat';

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
