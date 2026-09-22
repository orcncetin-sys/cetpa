/**
 * useReportsData.test.ts — CRM "En Çok Sipariş Veren Müşteriler" listesinin SAF çekirdeği
 * (Faz 3 6a, grup "use-reports-data", hakem düzeltme turu 2026-09-20).
 *
 * ## Neden var (hakem bulgusu — mutasyon HAYATTA KALDI)
 * K2 süzgeci (`orders.filter(o => o.status !== 'Cancelled')`) hook GÖVDESİNDE duruyordu
 * (`useReportsData.ts:307`, HEAD ölçümü). `musteriOzeti` sipariş durumunu BİLEREK okumaz
 * (süzgeç çağıranda durur) ve hook'un testi yoktu → süzgeci silen mutasyon
 * (`musteriOzeti(orders, …)`) tüm test paketini YEŞİL bırakıyordu:
 *   Şirin İnşaat'ın 100.000 TL 'Delivered' + 80.000 TL 'Cancelled' siparişi varken CRM sekmesi
 *   180.000 TL / 2 sipariş basar (K2'ye göre 100.000 TL / 1 sipariş), yalnız iptali olan müşteri
 *   listeye geri girer — `tsc` ve `rapor6a.degismez.test.ts` yeşil kalır.
 * `rapor6a.degismez.test.ts` §4 yorumundaki "K2 … `raporVeriKatmani.raporCirosu` içinde
 * davranışsaldır, birim testinde korunur" cümlesi KPI cirosu için doğru, `topCustomers` için
 * YANLIŞTI: bu panel `raporCirosu`'ndan GEÇMİYOR. Süzgeç bu yüzden hook gövdesinden saf ve
 * testli `musteriListesi`'ne alındı; bu dosya onun ÖLÇÜSÜDÜR.
 *
 * ## Uygulanan kullanıcı kararları (KARARLAR.md — BAĞLAYICI)
 *   K2: "İptaller ciroya girsin mi → hayır."
 *   K4: "Müşteriyi adla mı kimlikle mi gruplayacağız → kimlikle."
 *
 * ## Parite
 * Bilinen girdide sayı eski `topCustomers` `reduce`'u ile BİREBİR (tek kimlikli, adı tutarlı
 * müşteride ciro = toplam, adet = sipariş sayısı; sıra azalan ciro). Bilinçli farklar K2/K4
 * gereğidir ve `utils/rapor/musteri.test.ts`'te de kilitlidir; burada BAĞLAMA kilitlenir.
 */
import { describe, it, expect } from 'vitest';
import { musteriListesi, type MusteriListesiSiparisi } from './useReportsData';

const OCAK = Date.UTC(2026, 0, 10);
const SUBAT = Date.UTC(2026, 1, 1);
const MART = Date.UTC(2026, 2, 14);

/** Kısa fikstür kurucusu — alanların hiçbiri zorunlu değil (yapısal girdi). */
const s = (o: MusteriListesiSiparisi): MusteriListesiSiparisi => o;

describe('musteriListesi — K2: iptaller ciroya GİRMEZ', () => {
  it('1. iptal edilen sipariş müşterinin CİROSUNA da ADEDİNE de girmez', () => {
    const sonuc = musteriListesi([
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 100000, status: 'Delivered', createdAt: OCAK }),
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 80000, status: 'Cancelled', createdAt: SUBAT }),
    ]);
    expect(sonuc.satirlar).toEqual([
      { name: 'Şirin İnşaat', anahtar: 'kayit:lead-sirin', total: 100000, count: 1, bilinmeyen: 0 },
    ]);
  });

  it('2. YALNIZ iptal siparişi olan müşteri listede YOK (satır düşer)', () => {
    const sonuc = musteriListesi([
      s({ leadId: 'lead-beton', customerName: 'Beton Yapı', totalPrice: 50000, status: 'Cancelled', createdAt: OCAK }),
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 10000, status: 'Delivered', createdAt: OCAK }),
    ]);
    expect(sonuc.satirlar.map(x => x.anahtar)).toEqual(['kayit:lead-sirin']);
  });

  it('3. iptal edilen siparişin okunamayan tutarı `bilinmeyen` sayacını ŞİŞİRMEZ', () => {
    // İptal "bilinmeyen tutar" DEĞİLDİR: sayacı şişirirse "N kayıt tutarsız" notu YALANCI olur.
    const sonuc = musteriListesi([
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 100000, status: 'Delivered', createdAt: OCAK }),
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 'çözülemez', status: 'Cancelled', createdAt: SUBAT }),
    ]);
    expect(sonuc.satirlar).toEqual([
      { name: 'Şirin İnşaat', anahtar: 'kayit:lead-sirin', total: 100000, count: 1, bilinmeyen: 0 },
    ]);
  });

  it('4. iptal edilen KİMLİKSİZ sipariş "kimliksiz N sipariş" notunu ŞİŞİRMEZ', () => {
    const sonuc = musteriListesi([
      s({ customerName: null, totalPrice: 5000, status: 'Cancelled', createdAt: OCAK }),
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 10000, status: 'Delivered', createdAt: OCAK }),
    ]);
    expect(sonuc.kimliksiz).toBe(0);
  });

  it('5. süzgeç `raporCirosu` ile BİREBİR: yalnız `Cancelled` düşer, diğer durumlar KALIR', () => {
    const sonuc = musteriListesi([
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 1000, status: 'Pending', createdAt: OCAK }),
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 2000, status: 'Processing', createdAt: OCAK }),
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 4000, status: 'Shipped', createdAt: OCAK }),
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 8000, status: 'Delivered', createdAt: OCAK }),
      // Durumu HİÇ okunamayan sipariş de kalır (`!== 'Cancelled'` doğrudur) — parite.
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 16000, createdAt: OCAK }),
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 32000, status: 'Cancelled', createdAt: OCAK }),
    ]);
    expect(sonuc.satirlar[0]).toEqual({
      name: 'Şirin İnşaat', anahtar: 'kayit:lead-sirin', total: 31000, count: 5, bilinmeyen: 0,
    });
  });
});

describe('musteriListesi — K4: kimlikle gruplama', () => {
  it('6. bağ haritası verilince Cetpa siparişi + aynı carinin Mikro faturası TEK satır', () => {
    const siparisler = [
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 100000, status: 'Delivered', createdAt: OCAK }),
      s({ mikroCariKod: '120-SIRIN', customerName: 'ŞİRİN İNŞAAT LTD. ŞTİ.', totalPrice: 40000, status: 'Processing', createdAt: SUBAT }),
    ];
    expect(musteriListesi(siparisler, new Map([['lead-sirin', '120-SIRIN']])).satirlar).toEqual([
      // Görünen ad = EN SON tarihli siparişteki ad (Şubat > Ocak).
      { name: 'ŞİRİN İNŞAAT LTD. ŞTİ.', anahtar: 'cari:120-SIRIN', total: 140000, count: 2, bilinmeyen: 0 },
    ]);
    // Harita VERİLMEZSE uydurma bağ kurulmaz: iki ayrı satır (bilinçli — `utils-musteri.md`).
    // Sıra azalan ciro: 100.000 TL'lik Cetpa kaydı önce, 40.000 TL'lik Mikro carisi sonra.
    expect(musteriListesi(siparisler).satirlar.map(x => x.anahtar)).toEqual(['kayit:lead-sirin', 'cari:120-SIRIN']);
  });

  it('7. kimliği de adı da olmayan sipariş SATIR olmaz, `kimliksiz` NOTU olur', () => {
    const sonuc = musteriListesi([
      s({ customerName: '—', totalPrice: 1000, status: 'Delivered', createdAt: OCAK }),
      s({ customerName: '   ', totalPrice: 2000, status: 'Pending', createdAt: SUBAT }),
    ]);
    expect(sonuc.satirlar).toEqual([]);
    expect(sonuc.kimliksiz).toBe(2);
  });

  it('8. adsız `cari` satırı KODU basar; adsız `kayit` satırında lead id BASILMAZ', () => {
    expect(musteriListesi([s({ mikroCariKod: '120-SIRIN', totalPrice: 1000, status: 'Delivered', createdAt: OCAK })])
      .satirlar[0].name).toBe('120-SIRIN');
    expect(musteriListesi([s({ leadId: 'lead-sirin', totalPrice: 500, status: 'Delivered', createdAt: OCAK })])
      .satirlar[0].name).toBe('—');
  });
});

describe('musteriListesi — ekran sözleşmesi (bilinmeyen 0 SAYILMAZ) + sıra', () => {
  it('9. tutarı okunamayan müşterinin `total`ı NaN (0 DEĞİL) ve sırada SONDA', () => {
    const sonuc = musteriListesi([
      s({ leadId: 'lead-a', customerName: 'A İnşaat', totalPrice: 'çözülemez', status: 'Delivered', createdAt: OCAK }),
      s({ leadId: 'lead-b', customerName: 'B Beton', totalPrice: 10000, status: 'Delivered', createdAt: OCAK }),
    ]);
    expect(sonuc.satirlar.map(x => x.name)).toEqual(['B Beton', 'A İnşaat']);
    expect(Number.isNaN(sonuc.satirlar[1].total)).toBe(true);
    expect(sonuc.satirlar[1].bilinmeyen).toBe(1);
  });

  it('10. kısmi bilinen müşteride KISMİ toplam + `bilinmeyen` sayacı (tutar kaybolmaz)', () => {
    const sonuc = musteriListesi([
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 60000, status: 'Delivered', createdAt: OCAK }),
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: undefined, status: 'Delivered', createdAt: SUBAT }),
    ]);
    expect(sonuc.satirlar[0]).toEqual({
      name: 'Şirin İnşaat', anahtar: 'kayit:lead-sirin', total: 60000, count: 2, bilinmeyen: 1,
    });
  });

  it('11. `totalPrice` yoksa `totalAmount` okunur (tek kaynak `siparisTutari`)', () => {
    const sonuc = musteriListesi([
      s({ leadId: 'lead-cimento', customerName: 'ÇİMENTO 50KG Bayii', totalAmount: 7500, status: 'Delivered', createdAt: OCAK }),
    ]);
    expect(sonuc.satirlar[0].total).toBe(7500);
  });

  it('12. liste EN ÇOK 8 satır, azalan ciro sırasında', () => {
    const siparisler = Array.from({ length: 12 }, (_, i) => s({
      leadId: `lead-${i}`, customerName: `Müşteri ${i}`, totalPrice: (i + 1) * 1000,
      status: 'Delivered', createdAt: MART,
    }));
    const satirlar = musteriListesi(siparisler).satirlar;
    expect(satirlar).toHaveLength(8);
    expect(satirlar.map(x => x.total)).toEqual([12000, 11000, 10000, 9000, 8000, 7000, 6000, 5000]);
  });

  it('13. boş girdi: satır YOK, kimliksiz 0 (uydurma satır üretilmez)', () => {
    expect(musteriListesi([])).toEqual({ satirlar: [], kimliksiz: 0 });
  });

  it('14. girdi dizisi MUTASYONA uğramaz', () => {
    const siparisler = [
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 100000, status: 'Delivered', createdAt: OCAK }),
      s({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 80000, status: 'Cancelled', createdAt: SUBAT }),
    ];
    const kopya = siparisler.map(o => ({ ...o }));
    musteriListesi(siparisler);
    expect(siparisler).toEqual(kopya);
  });
});
