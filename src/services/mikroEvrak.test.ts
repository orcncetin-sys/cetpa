/**
 * mikroEvrak.test.ts — DIŞ SİSTEME SAHTE VERİ GİTMEZ (Faz 1, 2026-09-04).
 *
 * `teklifPayload` eskiden `l.price ?? 0` / `l.quantity ?? 1` yapıyordu: fiyatı
 * girilmemiş teklif satırı Mikro ERP'ye 0 TL, miktarı girilmemiş satır 1 adet
 * olarak YAZILIYORDU. Ekranda '—' göstermekle bitmez; karşı tarafın defterine
 * uydurma kayıt düşer. Bu test o kapıyı kilitler: eksik satır varsa payload
 * üretilmez, hata satır numarasıyla yükselir.
 */
import { describe, it, expect } from 'vitest';
import { teklifPayload, izinTalepPayload, bakimTalepPayload, sayimPayload, stokHareketPayload, uretimTalepPayload, etiketPayload, MIKRO_IZIN_TIPI } from './mikroEvrak';

const taban = { cariKod: 'CAR001', date: '2026-09-04' };

describe('teklifPayload — sahte kesinlik kapısı', () => {
  it('tam satır → payload üretir, fiyat/miktar aynen gider', () => {
    const p = teklifPayload({ ...taban, lineItems: [{ sku: 'X1', price: 1250.5, quantity: 3 }] });
    const satir = p.evraklar[0].satirlar[0];
    expect(satir.tkl_Alisfiyati).toBe(1250.5);
    expect(satir.tkl_miktar).toBe(3);
    expect(satir.tkl_cari_kod).toBe('CAR001');
  });

  it('fiyatı OLMAYAN satır → throw, 0 TL ile GİTMEZ', () => {
    expect(() => teklifPayload({ ...taban, lineItems: [{ sku: 'X1', quantity: 2 }] }))
      .toThrow(/satırı 1: fiyat eksik/);
  });

  it('miktarı OLMAYAN satır → throw, 1 adet varsayılmaz', () => {
    expect(() => teklifPayload({ ...taban, lineItems: [{ sku: 'X1', price: 100 }] }))
      .toThrow(/satırı 1: miktar eksik/);
  });

  it('NaN fiyat da eksik sayılır (Number(undefined) yolu)', () => {
    expect(() => teklifPayload({ ...taban, lineItems: [{ sku: 'X1', price: NaN, quantity: 1 }] }))
      .toThrow(/fiyat eksik/);
  });

  it('birden çok eksik satır → ilkini numarasıyla söyler, kalanı sayar', () => {
    expect(() => teklifPayload({ ...taban, lineItems: [
      { sku: 'A', price: 10, quantity: 1 },
      { sku: 'B', quantity: 1 },
      { sku: 'C', price: 5 },
    ] })).toThrow(/satırı 2: fiyat eksik.*\+1 satır daha/);
  });

  it('GERÇEK sıfır fiyat (bedelsiz numune) geçer — sıfır bilinmeyen değildir', () => {
    const p = teklifPayload({ ...taban, lineItems: [{ sku: 'NUMUNE', price: 0, quantity: 1 }] });
    expect(p.evraklar[0].satirlar[0].tkl_Alisfiyati).toBe(0);
  });
});

describe('izinTalepPayload — izin türü Mikro koduna EŞLENİR, 0 (yıllık) varsayılmaz', () => {
  const taban = { persKod: 'P001', startDate: '2026-09-10', days: 3 };
  it("'Hastalık' → 1 (eskiden IKPage type geçmiyor, her izin 0=YILLIK gidiyordu)", () => {
    const p = izinTalepPayload({ ...taban, izinTuru: 'Hastalık' });
    expect(p.evraklar[0].satirlar[0].pit_izin_tipi).toBe(1);
    expect(p.evraklar[0].satirlar[0].pit_gun_sayisi).toBe(3);
  });
  it("'Yıllık İzin' → 0 — gerçek yıllık izin 0'dır (sıfır bilinmeyen değildir)", () => {
    expect(izinTalepPayload({ ...taban, izinTuru: 'Yıllık İzin' }).evraklar[0].satirlar[0].pit_izin_tipi).toBe(0);
  });
  it('bilinmeyen tür → throw (Türkçe İ/ı duyarlı: "yıllık izin" küçük harf eşleşmez)', () => {
    expect(() => izinTalepPayload({ ...taban, izinTuru: 'Babalık' })).toThrow(/eşlenemedi/);
    expect(() => izinTalepPayload({ ...taban, izinTuru: 'yıllık izin' })).toThrow(/eşlenemedi/);
    expect(() => izinTalepPayload({ ...taban, izinTuru: '' })).toThrow(/eşlenemedi/);
  });
  it('gün sayısı eksik/0/NaN → throw, 1 gün varsayılmaz', () => {
    expect(() => izinTalepPayload({ ...taban, days: NaN, izinTuru: 'Mazeret' })).toThrow(/gün sayısı/);
    expect(() => izinTalepPayload({ ...taban, days: 0, izinTuru: 'Mazeret' })).toThrow(/gün sayısı/);
  });
  it('tablo tek kaynak: HRModule\'ün eski dört türü aynen burada', () => {
    expect(MIKRO_IZIN_TIPI).toMatchObject({ 'Yıllık İzin': 0, 'Hastalık': 1, 'Mazeret': 2, 'Diğer': 3 });
  });
  // DEĞİŞMEZ TESTİ: IKPage aynı koleksiyona İngilizce slug yazıyor ('annual'|'sick'|'unpaid'|'other').
  // İlk düzeltme yalnız Türkçe sözlüğü tanıyordu → IKPage'den onaylanan HER izin throw edecekti
  // (ön kontrol yakaladı). İki sözlük de eşlenmeli; 'unpaid' bilinçli dışarıda.
  it("IKPage sözlüğü: 'annual'→0, 'sick'→1, 'other'→3 — Türkçe karşılıklarıyla AYNI kod", () => {
    expect(MIKRO_IZIN_TIPI['annual']).toBe(MIKRO_IZIN_TIPI['Yıllık İzin']);
    expect(MIKRO_IZIN_TIPI['sick']).toBe(MIKRO_IZIN_TIPI['Hastalık']);
    expect(MIKRO_IZIN_TIPI['other']).toBe(MIKRO_IZIN_TIPI['Diğer']);
    expect(izinTalepPayload({ ...taban, izinTuru: 'sick' }).evraklar[0].satirlar[0].pit_izin_tipi).toBe(1);
  });
  it("'unpaid' (ücretsiz izin) → throw — Mikro kodu bilinmiyor, tahmin edilmez", () => {
    expect(() => izinTalepPayload({ ...taban, izinTuru: 'unpaid' })).toThrow(/eşlenemedi/);
  });
});

describe('bakimTalepPayload — miktar bilinmiyorsa alan GİTMEZ, 1 varsayılmaz', () => {
  it('quantity yok → bkmkb_miktari alanı yok', () => {
    const satir = bakimTalepPayload({ stokKod: 'YAG-01', depoNo: 2 }).evraklar[0].satirlar[0] as Record<string, unknown>;
    expect('bkmkb_miktari' in satir).toBe(false);
  });
  it('quantity var → aynen gider', () => {
    const satir = bakimTalepPayload({ stokKod: 'YAG-01', quantity: 4, depoNo: 2 }).evraklar[0].satirlar[0] as Record<string, unknown>;
    expect(satir.bkmkb_miktari).toBe(4);
  });
});

describe('depo bilinmiyorsa dış sisteme GİTMEZ — depo 1 (HAVALİMANI) varsayılmaz', () => {
  it('sayım: depoNo yok → throw (eskiden her sayım depo 1\'e yazılıyordu)', () => {
    expect(() => sayimPayload([{ sku: 'X', counted: 5 }])).toThrow(/depo bilinmiyor/);
  });
  it('sayım: depoNo 2 → aynen gider', () => {
    const satir = sayimPayload([{ sku: 'X', counted: 5, depoNo: 2 }]).evraklar[0].satirlar[0] as Record<string, unknown>;
    expect(satir.sym_depono).toBe(2);
  });
  it('stok hareketi: depoNo yok → throw; miktar 0/NaN → throw', () => {
    expect(() => stokHareketPayload({ sku: 'X', quantity: 3, type: 'in' })).toThrow(/depo bilinmiyor/);
    expect(() => stokHareketPayload({ sku: 'X', quantity: 0, type: 'in', depoNo: 2 })).toThrow(/miktar eksik/);
    expect(() => stokHareketPayload({ sku: 'X', quantity: NaN, type: 'out', depoNo: 2 })).toThrow(/miktar eksik/);
  });
  it('stok hareketi: giriş depo 2 → giriş=2 çıkış=0', () => {
    const satir = stokHareketPayload({ sku: 'X', quantity: 3, type: 'in', depoNo: 2 }).evraklar[0].satirlar[0] as Record<string, unknown>;
    expect(satir.sth_giris_depo_no).toBe(2); expect(satir.sth_cikis_depo_no).toBe(0);
  });
  it('etiket basımı: depoNo yok → throw (7. üretici — varsayılan parametre biçimi grep\'ten kaçmıştı)', () => {
    expect(() => etiketPayload([{ sku: 'X', adet: 10 }])).toThrow(/depo bilinmiyor/);
    expect((etiketPayload([{ sku: 'X', adet: 10 }], 2).evraklar[0].satirlar[0] as Record<string, unknown>).Etkb_DepoNo).toBe(2);
  });
  it('üretim talebi: depoNo yok → throw', () => {
    expect(() => uretimTalepPayload({ sku: 'X', quantity: 10 })).toThrow(/depo bilinmiyor/);
  });
  it('bakım talebi: depoNo yok → throw (miktar koşulundan bağımsız)', () => {
    expect(() => bakimTalepPayload({ stokKod: 'YAG-01', quantity: 4 })).toThrow(/depo bilinmiyor/);
  });
});
