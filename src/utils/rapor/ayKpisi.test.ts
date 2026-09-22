/**
 * ayKpisi.test.ts — "Bu Ay" KPI kartlarının (RaporlarPage Phase 570) tek hesabı.
 * ÖNCE YAZILDI (kırmızı görüldü, sonra modül yazıldı) — Faz 3 6a hakem turu, 2026-09-20.
 *
 * NEDEN BU TEST VAR: hakem, sayfadaki `actOrders570 = ciro570.bilinen + ciro570.bilinmeyen`
 * satırını `monthOrders570.length` yapan bir mutasyon denedi (K2 kümesi bozulur: Sipariş
 * Adedi iptalleri sayar, Ort. Sipariş Değeri'nin payı iptal hariç / paydası iptal dahil olur)
 * ve HİÇBİR test kırılmadı — hesap sayfada inline durduğu için ölçüsü yoktu. Hesap bu modüle
 * taşındı; aşağıdaki "K2" vakaları o mutasyonu ayırt eder.
 */
import { describe, it, expect } from 'vitest';
import { ayKpisi } from './ayKpisi';

// Eylül 2026 ayının başı — sabit fikstür (testin "bu ay"ı yok).
const AY_BASI = new Date(2026, 8, 1).getTime();

/** Fikstür siparişi — Cetpa alan adlarıyla (tutar `totalPrice`, tarih `createdAt`). */
function sip(o: {
  id: string;
  musteri?: string;
  tutar?: unknown;
  tarih?: unknown;
  status?: string;
}) {
  return {
    id: o.id,
    customerName: o.musteri ?? 'Şirin İnşaat',
    totalPrice: o.tutar,
    // `'tarih' in o` — `??` DEĞİL: açıkça `undefined` geçilen tarihsiz fikstür yedeğe düşerse
    // "tarihi okunamayan sipariş" vakası sessizce tarihli bir siparişi sınardı.
    createdAt: 'tarih' in o ? o.tarih : '2026-09-12T10:00:00',
    status: o.status ?? 'Delivered',
  };
}

describe('ayKpisi — ay içi ciro / adet / ortalama TEK kümeden (K2)', () => {
  it('iptal edilen sipariş ne ciroya ne ADEDE girer', () => {
    const k = ayKpisi([
      sip({ id: 'S1', tutar: 12_000 }),                            // ÇİMENTO 50KG × 40
      sip({ id: 'S2', tutar: 8_000 }),
      sip({ id: 'S3', tutar: 100_000, status: 'Cancelled' }),      // iptal — K2: girmez
    ], AY_BASI);

    expect(k.ciro).toEqual({ toplam: 20_000, bilinen: 2, bilinmeyen: 0 });
    expect(k.adet).toBe(2);                    // `liste.length` olsaydı 3 olurdu
    expect(k.ekranCiro).toBe(20_000);
    expect(k.tamCiro).toBe(20_000);
    expect(k.ortalama).toBe(10_000);           // payda da iptal HARİÇ
  });

  it('yalnız iptal varsa: adet 0, ciro gerçek ₺0 — "ay boş" demek DOĞRU', () => {
    const k = ayKpisi([sip({ id: 'S1', tutar: 50_000, status: 'Cancelled' })], AY_BASI);
    expect(k.adet).toBe(0);
    expect(k.ekranCiro).toBe(0);
    expect(Number.isNaN(k.ortalama)).toBe(true);   // 0 siparişin ortalaması YOK
  });

  it('ortalama, iptalli kümede pay ile paydayı AYRIŞTIRMAZ', () => {
    // Mutasyon ayırt edici: payda `length` (3) olsaydı ortalama 10.000 yerine 6.666,67 olurdu.
    const k = ayKpisi([
      sip({ id: 'S1', tutar: 12_000 }),
      sip({ id: 'S2', tutar: 8_000 }),
      sip({ id: 'S3', tutar: 999_999, status: 'Cancelled' }),
    ], AY_BASI);
    expect(k.ortalama).toBe(10_000);
  });
});

describe('ayKpisi — bilinmeyen tutar 0 SAYILMAZ (iki sözleşme)', () => {
  it('tutarı okunamayan sipariş: EKRAN kısmi toplam, adet SAYAR, türetilenler hesaplanmaz', () => {
    const k = ayKpisi([
      sip({ id: 'S1', tutar: 12_000 }),
      sip({ id: 'S2', tutar: undefined }),      // tutarı okunamadı — 0 DEĞİL, bilinmiyor
    ], AY_BASI);

    expect(k.ciro).toEqual({ toplam: 12_000, bilinen: 1, bilinmeyen: 1 });
    expect(k.ekranCiro).toBe(12_000);           // EKRAN: kısmi toplam + "1 sipariş tutarsız" notu
    expect(Number.isNaN(k.tamCiro)).toBe(true); // TÜRETME kapısı: hedef gerçekleşmesi hesaplanmaz
    expect(Number.isNaN(k.ortalama)).toBe(true);
    expect(k.adet).toBe(2);                     // kayıt VAR, tutarı yok — adet düşmez
  });

  it('hiç bilinen tutar yoksa EKRAN da "—" (NaN), adet yine sayar', () => {
    const k = ayKpisi([
      sip({ id: 'S1', tutar: null }),
      sip({ id: 'S2', tutar: 'abc' }),
    ], AY_BASI);
    expect(Number.isNaN(k.ekranCiro)).toBe(true);
    expect(k.adet).toBe(2);
    expect(k.ciro.bilinmeyen).toBe(2);
  });

  it('sayısal metin tutar BİLİNİR (`siparisTutari` sözleşmesi), meşru ₺0 sıfır kalır', () => {
    const k = ayKpisi([
      sip({ id: 'S1', tutar: '2500.50' }),
      sip({ id: 'S2', tutar: 0 }),              // bedelsiz sevk — gerçek 0, bilinmeyen değil
    ], AY_BASI);
    expect(k.ciro).toEqual({ toplam: 2500.5, bilinen: 2, bilinmeyen: 0 });
    expect(k.adet).toBe(2);
  });
});

describe('ayKpisi — ay penceresi', () => {
  it('ay başından ÖNCEKİ sipariş girmez, ay başının kendisi girer', () => {
    const k = ayKpisi([
      sip({ id: 'S1', tutar: 5_000, tarih: '2026-08-31T23:59:59' }),
      sip({ id: 'S2', tutar: 7_000, tarih: new Date(2026, 8, 1).toISOString() }),
    ], AY_BASI);
    expect(k.adet).toBe(1);
    expect(k.ekranCiro).toBe(7_000);
  });

  it('tarihi okunamayan sipariş aya GİRMEZ (parite: sayfa da almıyordu)', () => {
    const k = ayKpisi([
      sip({ id: 'S1', tutar: 5_000, tarih: undefined }),
      sip({ id: 'S2', tutar: 7_000 }),
    ], AY_BASI);
    expect(k.adet).toBe(1);
    expect(k.ekranCiro).toBe(7_000);
  });

  it('`Date` ve Firestore `Timestamp` biçimi de çözülür (zamanMs sözleşmesi)', () => {
    const k = ayKpisi([
      sip({ id: 'S1', tutar: 1_000, tarih: new Date(2026, 8, 15) }),
      sip({ id: 'S2', tutar: 2_000, tarih: { toMillis: () => new Date(2026, 8, 16).getTime() } }),
    ], AY_BASI);
    expect(k.adet).toBe(2);
    expect(k.ekranCiro).toBe(3_000);
  });

  it('boş ay: adet 0, ciro gerçek ₺0, ortalama hesaplanmaz', () => {
    const k = ayKpisi([], AY_BASI);
    expect(k.adet).toBe(0);
    expect(k.ekranCiro).toBe(0);
    expect(k.tamCiro).toBe(0);
    expect(Number.isNaN(k.ortalama)).toBe(true);
  });

  /**
   * `iptalAdedi` — Faz 3 6a düzeltme turu (2026-09-22).
   * ARIZA: K2 uygulandıktan sonra AYNI SAYFADA iki "sipariş adedi" belirdi — KPI kartı
   * iptalleri düşüyor (34), hemen altındaki P603 trend grafiği 'orders' metriğinde
   * düşmüyor (39) — ve farkı açıklayan TEK satır yoktu. Sayaç, kartın altına
   * "N sipariş iptal edildi" notunu bastırmak için ADDITIVE eklendi.
   */
  it('iptal edilen sipariş SAYILIR (ekranda notu basılsın diye) ama adede/ciroya girmez', () => {
    const k = ayKpisi([
      sip({ id: 'S1', tutar: 12_000 }),
      sip({ id: 'S2', tutar: 8_000 }),
      sip({ id: 'S3', tutar: 100_000, status: 'Cancelled' }),
      sip({ id: 'S4', tutar: undefined, status: 'Cancelled' }),   // tutarsız iptal de SAYILIR
    ], AY_BASI);
    expect(k.adet).toBe(2);
    expect(k.iptalAdedi).toBe(2);
    expect(k.ciro.bilinmeyen).toBe(0);      // tutarsız İPTAL `ciro` sayacını şişirmez
  });

  it('iptal yoksa 0 (gerçek sıfır — not basılmaz); ay dışı iptal SAYILMAZ', () => {
    const k = ayKpisi([sip({ id: 'S1', tutar: 12_000 })], AY_BASI);
    expect(k.iptalAdedi).toBe(0);
    const k2 = ayKpisi([
      sip({ id: 'S1', tutar: 12_000 }),
      sip({ id: 'ONCEKI', tutar: 5_000, tarih: '2026-08-28T09:00:00', status: 'Cancelled' }),
      sip({ id: 'TARIHSIZ', tutar: 5_000, tarih: undefined, status: 'Cancelled' }),
    ], AY_BASI);
    expect(k2.iptalAdedi).toBe(0);         // pencere DIŞI iptal bu ayın notuna yazılmaz
  });

  it('ay başı ÇÖZÜLEMEZSE sonuç BİLİNMEZ — "bu ay hiç sipariş yok" DEMEZ', () => {
    for (const bozuk of [NaN, new Date('gecersiz'), null, undefined, 'dün']) {
      const k = ayKpisi([sip({ id: 'S1', tutar: 9_000 })], bozuk);
      expect(Number.isNaN(k.adet), String(bozuk)).toBe(true);
      expect(Number.isNaN(k.ekranCiro), String(bozuk)).toBe(true);
      expect(Number.isNaN(k.tamCiro), String(bozuk)).toBe(true);
      expect(Number.isNaN(k.ortalama), String(bozuk)).toBe(true);
      // Pencere çözülemezse iptal sayısı da BİLİNMEZ — "0 iptal" uydurma olurdu.
      expect(Number.isNaN(k.iptalAdedi), String(bozuk)).toBe(true);
      expect(k.ciro.bilinen + k.ciro.bilinmeyen, String(bozuk)).toBe(0);
    }
  });
});

describe('ayKpisi — saflık', () => {
  it('girdi dizisi ve öğeleri MUTASYONA uğramaz', () => {
    const liste = [sip({ id: 'S1', tutar: 12_000 }), sip({ id: 'S2', status: 'Cancelled', tutar: 4_000 })];
    const kopya = JSON.parse(JSON.stringify(liste));
    ayKpisi(liste, AY_BASI);
    expect(JSON.parse(JSON.stringify(liste))).toEqual(kopya);
  });
});
