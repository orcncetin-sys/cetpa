/** iskontoTutarsizlik — "başka böyle bir kayıt var mı" raporu (2026-09-28). Kural lib/stokFiyat'ta; burada fatura
 *  bazında gruplama, Mikro toplamı → doğru toplam, özet sayaçları ve kolon planı (kolon adı tahmini YOK). */
import { describe, it, expect } from 'vitest';
import { iskontoTutarsizlikRaporu, satirKolonPlani, TEMEL_SATIR_KOLONLARI } from './iskontoTutarsizlik';

// Mikro SqlVeriOkuV2 sayıları METİN de döndürebilir — rapor ikisini de doğru okumalı.
const E420 = { sth_evraktip: '3', sth_evrakno_seri: '', sth_evrakno_sira: '420', sth_tarih: '2026-08-31T00:00:00', sth_stok_kod: 'RULO1081', sth_tip: '0',
  sth_miktar: '1050', sth_tutar: '398317.5', sth_vergi: '33736.5', sth_vergi_pntr: '4', sth_iptal: '0', sth_iskonto1: '85050', sth_iskonto2: '29767.5' };
const B420 = { cha_evrakno_seri: '', cha_evrakno_sira: 420, cha_tip: 1, cha_meblag: 317236.5, cha_iptal: 0, cha_tarihi: '2026-08-31T00:00:00', cha_kod: '7721308691' };
const E435 = { sth_evraktip: 3, sth_evrakno_seri: '', sth_evrakno_sira: 435, sth_tarih: '2026-09-14', sth_stok_kod: 'RULO1081', sth_tip: 0,
  sth_miktar: 2, sth_tutar: 758.7, sth_vergi: 64.26, sth_vergi_pntr: 4, sth_iptal: 0, sth_iskonto1: 162, sth_iskonto2: 56.7 };
const B435 = { cha_evrakno_seri: '', cha_evrakno_sira: 435, cha_tip: 1, cha_meblag: 604.26, cha_iptal: 0, cha_tarihi: '2026-09-14', cha_kod: '7721308691' };
// Mikro ile TUTARLI iskontolu satış faturası (1000 − 100 = 900, KDV 180) — rapora GİRMEMELİ.
const S500 = { sth_evraktip: 4, sth_evrakno_seri: '', sth_evrakno_sira: 500, sth_tarih: '2026-09-01', sth_stok_kod: 'CIM-50', sth_tip: 1,
  sth_miktar: 10, sth_tutar: 1000, sth_vergi: 180, sth_vergi_pntr: 4, sth_iptal: 0, sth_iskonto1: 100 };
const B500 = { cha_evrakno_seri: '', cha_evrakno_sira: 500, cha_tip: 0, cha_meblag: 1080, cha_iptal: 0, cha_tarihi: '2026-09-01', cha_kod: '120.01.0042' };

describe('iskontoTutarsizlikRaporu', () => {
  it('evrak 420 + 435: fatura bazında Mikro toplamı → e-faturayla tutarlı toplam; tutarlı fatura girmez', () => {
    const r = iskontoTutarsizlikRaporu([E420, E435, S500], [B420, B435, B500]);
    expect(r.faturalar.map(f => f.sira)).toEqual(['420', '435']);          // fazlası büyükten küçüğe
    const f = r.faturalar[0];
    expect(f).toMatchObject({ yon: 'gelen', seri: '', sira: '420', tarih: '2026-08-31', cariKod: '7721308691', mikroToplam: 317236.5 });
    expect(f.fazla).toBeCloseTo(114817.5, 2);
    expect(f.dogruToplam).toBeCloseTo(202419, 2);                          // e-fatura TOPLAM
    expect(f.satirlar).toHaveLength(1);
    expect(f.satirlar[0].net).toBeCloseTo(168682.5, 2);
    expect(r.faturalar[1].dogruToplam).toBeCloseTo(385.56, 2);             // 604,26 − 218,70 = 321,30 + 64,26
    expect(r.ozet).toMatchObject({ incelenenSatir: 3, incelenenFatura: 3, tutarsizFatura: 2, tutarsizSatir: 2, degerlendirilemeyenUrun: 0 });
    expect(r.ozet.fazlaGelen).toBeCloseTo(114817.5 + 218.7, 2);
    expect(r.ozet.fazlaGiden).toBe(0);
  });

  it('aynı faturada ikinci satır aralık korumasına takılıyorsa: doğru toplam İDDİA EDİLMEZ (null, kesin: false), fazla alt sınır', () => {
    // (a) 2.300/300/KDV 340 imzalı (gerçek net 1.700); (b) 1.100/100/KDV 180 — 1.000 × %18 = 180 ≡ 900 × %20 → korumaya
    // takılır, gösterilen net 1.000 (gerçek 900 olabilir). Gerçek e-fatura toplamı 3.120 olabilir; 3.220 "e-fatura toplamı" DEĞİL.
    const a = { ...E420, sth_evrakno_sira: '600', sth_stok_kod: 'A600', sth_miktar: 10, sth_tutar: 2300, sth_iskonto1: 300, sth_iskonto2: 0, sth_vergi: 340 };
    const b = { ...a, sth_stok_kod: 'B600', sth_tutar: 1100, sth_iskonto1: 100, sth_vergi: 180 };
    const r = iskontoTutarsizlikRaporu([a, b], [{ ...B420, cha_evrakno_sira: 600, cha_meblag: 3520 }]);
    expect(r.faturalar).toHaveLength(1);
    expect(r.faturalar[0]).toMatchObject({ sira: '600', mikroToplam: 3520, kesin: false, dogruToplam: null, belirsizSatir: 1 });
    expect(r.faturalar[0].fazla).toBeCloseTo(300, 6);
    expect(r.ozet).toMatchObject({ tutarsizFatura: 1, kesinOlmayanFatura: 1, degerlendirilemeyenUrun: 1 });
  });

  it('yalnız korumaya takılan TEK %10 iskontolu satır: fatura listelenmez ama "yok" da denmez (değerlendirilemeyen ürün)', () => {
    const b = { ...E420, sth_evrakno_sira: '601', sth_stok_kod: 'B601', sth_miktar: 10, sth_tutar: 1100, sth_iskonto1: 100, sth_iskonto2: 0, sth_vergi: 180 };
    const r = iskontoTutarsizlikRaporu([b], [{ ...B420, cha_evrakno_sira: 601, cha_meblag: 1180 }]);
    expect(r.faturalar).toEqual([]);
    expect(r.ozet).toMatchObject({ tutarsizFatura: 0, degerlendirilemeyenUrun: 1 });
  });

  it('420 + 435: kesin (başka şüpheli satır yok) → doğru toplam verilir', () => {
    const r = iskontoTutarsizlikRaporu([E420, E435, S500], [B420, B435, B500]);
    expect(r.faturalar.map(f => [f.sira, f.kesin, f.belirsizSatir])).toEqual([['420', true, 0], ['435', true, 0]]);
    expect(r.ozet.kesinOlmayanFatura).toBe(0);
  });

  it('çok kalemli fatura: iskontosuz kalem başlık hakeminin hedefine girer, yalnız imzalı kalem listelenir', () => {
    const iskontosuz = { ...E420, sth_stok_kod: 'SADE', sth_miktar: 10, sth_tutar: 1000, sth_vergi: 200, sth_iskonto1: 0, sth_iskonto2: 0 };
    const r = iskontoTutarsizlikRaporu([E420, iskontosuz], [{ ...B420, cha_meblag: 317236.5 + 1200 }]);
    expect(r.faturalar).toHaveLength(1);
    expect(r.faturalar[0].satirlar.map(s => s.sku)).toEqual(['RULO1081']);
    expect(r.faturalar[0].dogruToplam).toBeCloseTo(202419 + 1200, 2);
  });

  it('başlık iptal / yok ise hüküm YOK (liste boş, ürün değerlendirilemedi olarak sayılır)', () => {
    expect(iskontoTutarsizlikRaporu([E420], [{ ...B420, cha_iptal: 1 }]).faturalar).toEqual([]);
    const r = iskontoTutarsizlikRaporu([E420], []);
    expect(r.faturalar).toEqual([]);
    expect(r.ozet).toMatchObject({ tutarsizFatura: 0, degerlendirilemeyenUrun: 1 });
  });

  it('satış yönlü tutarsızlık da raporlanır (alacak şişer) — fazlaGiden', () => {
    const s = { ...E420, sth_evraktip: 4, sth_tip: 1, sth_evrakno_sira: '9' };
    const b = { ...B420, cha_tip: 0, cha_evrakno_sira: 9 };
    const r = iskontoTutarsizlikRaporu([s], [b]);
    expect(r.faturalar[0]).toMatchObject({ yon: 'giden', sira: '9' });
    expect(r.ozet.fazlaGiden).toBeCloseTo(114817.5, 2);
    expect(r.ozet.fazlaGelen).toBe(0);
  });
});

describe('iskontoTutarsizlikRaporu — tur 2: bulgulu ürünün BAŞKA faturasındaki belirsiz satır görünmez olmaz', () => {
  it('420 kesin bulgu + aynı ürünün 388 faturası imzalı ama başlık onaylamıyor → değerlendirilemeyen ürün 1, 388 ayrıca listelenir', () => {
    const b388 = { ...E420, sth_evrakno_sira: '388', sth_miktar: '10', sth_tutar: '2300', sth_iskonto1: '300', sth_iskonto2: '0', sth_vergi: '340' };
    const r = iskontoTutarsizlikRaporu([E420, b388], [B420, { ...B420, cha_evrakno_sira: 388, cha_meblag: 1000 }]);
    expect(r.faturalar.map(f => [f.sira, f.kesin])).toEqual([['420', true]]);
    expect(r.ozet).toMatchObject({ degerlendirilemeyenUrun: 1, belirsizFatura: 1 });
    expect(r.belirsizFaturalar).toEqual([{ yon: 'gelen', seri: '', sira: '388', belirsizSatir: 1 }]);
  });
});

describe('satirKolonPlani — kolon adı TAHMİN EDİLMEZ, şemadan', () => {
  it('iskonto/masraf aile kolonları şemadan; temel kolonlar yazıldığı büyük/küçük harfle', () => {
    const p = satirKolonPlani([...TEMEL_SATIR_KOLONLARI, 'sth_iskonto1', 'sth_iskonto2', 'sth_isk_mas1', 'sth_masraf1', 'sth_aciklama']);
    expect(p.eksik).toEqual([]);
    expect(p.iskonto).toEqual(['sth_iskonto1', 'sth_iskonto2']);          // sth_isk_mas1 bayrağı TUTAR DEĞİL — girmez
    expect(p.secim).toEqual([...TEMEL_SATIR_KOLONLARI, 'sth_iskonto1', 'sth_iskonto2', 'sth_masraf1']);
  });
  it('eksik temel kolon adıyla döner (rapor koşmaz); iskonto kolonu yoksa liste boş', () => {
    const p = satirKolonPlani(TEMEL_SATIR_KOLONLARI.filter(k => k !== 'sth_vergi_pntr'));
    expect(p.eksik).toEqual(['sth_vergi_pntr']);
    expect(p.iskonto).toEqual([]);
  });
});
