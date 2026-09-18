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
import { satirNet, stokFiyatOzeti, stokFiyatDetay, faturaToplamlari, kalemleriCoz } from './stokFiyat';

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
    expect(d[1]).toEqual({ tarih: '2026-08-01', yon: 'alis', miktar: 10, brutTutar: 1000, iskonto: 100, tutar: 900, birimFiyat: 90, kaynak: 'dogrulanamadi', cariKod: '320.01', evrakNo: 'A-377' });
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
