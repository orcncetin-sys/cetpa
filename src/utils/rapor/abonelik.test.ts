/**
 * abonelik.test.ts — abonelik (tekrarlayan sipariş) gelirinin TEK kuralı. Faz 3 6/n, 2026-09-19.
 * ÖNCE YAZILDI (kırmızı görüldü, sonra modül yazıldı).
 *
 * ## Neden var
 * Aynı şablonlar ÜÇ sitede ÜÇ ayrı katsayıyla yıllıklaştırılıyordu (HEAD 46c53a8):
 *   - `GenelOzet.tsx:130,154`      haftalık ×4/ay  (= ×48/yıl)
 *   - `LojistikRapor.tsx:1082,1089` haftalık ×52/yıl (aylık ×12, üç aylık ×4)
 *   - `LojistikRapor.tsx:1277-1283` `{weekly: 4.33, monthly: 1, quarterly: 0.333}` (= ×51,96/yıl)
 *     + tanınmayan frekansa `|| 1` uydurması.
 * Aynı müşteri üç ekranda üç farklı ARR görüyordu. Ayrıca `GenelOzet:129` korumasız `reduce`:
 * tutarı bilinmeyen TEK şablon MRR'yi ve ARR'yi birlikte NaN ('—') yapıyor, nedeni yazılmıyordu.
 *
 * ## Parite
 * Aylık ve üç aylık şablonlarda rakam eski GenelOzet koduyla BİREBİR (test 1 parite alt vakası).
 * BİLİNÇLİ FARK (K19): haftalık şablonun aylık karşılığı ×4 → ×52÷12 (+%8,33) — test 1.
 */
import { describe, it, expect } from 'vitest';
import { sablonAylikTutari, tekrarlayanGelir } from './abonelik';

/** Test fikstürü — yazıcı yüzey (`OrdersPage.tsx:973` addDoc) alanlarının yapısal karşılığı. */
type Sablon = { templateName?: string; customerName?: string; totalPrice?: unknown; frequency?: unknown; active?: unknown };

const sirinHaftalik: Sablon = { templateName: 'ÇİMENTO 50KG', customerName: 'Şirin İnşaat', totalPrice: 1000, frequency: 'weekly', active: true };
const sirinAylik: Sablon = { templateName: 'DEMİR 12MM', customerName: 'Şirin İnşaat', totalPrice: 2000, frequency: 'monthly', active: true };
const sirinUcAylik: Sablon = { templateName: 'KUM M³', customerName: 'Şirin İnşaat', totalPrice: 3000, frequency: 'quarterly', active: true };

describe('sablonAylikTutari — tek katsayı tablosu (K19)', () => {
  it('6. katsayılar: haftalık 52÷12, aylık ×1, üç aylık ÷3 (tam bölünen vektörler)', () => {
    expect(sablonAylikTutari({ totalPrice: 1200, frequency: 'weekly' })).toBe(5200); // 1200 × 52 ÷ 12
    expect(sablonAylikTutari({ totalPrice: 750, frequency: 'monthly' })).toBe(750);
    expect(sablonAylikTutari({ totalPrice: 300, frequency: 'quarterly' })).toBe(100);
  });

  it('6. kart toplamı ile satır listesi AYNI katsayıdan beslenir', () => {
    const liste: Sablon[] = [{ totalPrice: 1200, frequency: 'weekly', active: true }];
    expect(tekrarlayanGelir(liste).mrr.toplam).toBe(sablonAylikTutari(liste[0]));
  });

  it('3. tutarı bilinmeyen şablon → NaN (0 DEĞİL)', () => {
    expect(sablonAylikTutari({ totalPrice: undefined, frequency: 'monthly' })).toBeNaN();
    expect(sablonAylikTutari({ totalPrice: null, frequency: 'weekly' })).toBeNaN();
    expect(sablonAylikTutari({ totalPrice: '', frequency: 'monthly' })).toBeNaN();
    expect(sablonAylikTutari({ totalPrice: 'bilinmiyor', frequency: 'monthly' })).toBeNaN();
  });

  it('4. meşru 0 tutar bilinendir', () => {
    expect(sablonAylikTutari({ totalPrice: 0, frequency: 'weekly' })).toBe(0);
  });

  it('9. sayısal string tutar bilinendir', () => {
    expect(sablonAylikTutari({ totalPrice: '1500', frequency: 'monthly' })).toBe(1500);
  });

  it('5. tanınmayan / boş frekans → NaN (×1 UYDURULMAZ)', () => {
    expect(sablonAylikTutari({ totalPrice: 2000, frequency: 'yearly' })).toBeNaN();
    expect(sablonAylikTutari({ totalPrice: 2000, frequency: undefined })).toBeNaN();
    expect(sablonAylikTutari({ totalPrice: 2000, frequency: '' })).toBeNaN();
    // Frekans eşleşmesi BİREBİR — yazıcı yüzey küçük harf yazıyor, 'Weekly' katlanmaz.
    expect(sablonAylikTutari({ totalPrice: 2000, frequency: 'Weekly' })).toBeNaN();
  });

  it('5. prototip anahtarı değer ÇEKMEZ (constructor / toString)', () => {
    expect(sablonAylikTutari({ totalPrice: 2000, frequency: 'constructor' })).toBeNaN();
    expect(sablonAylikTutari({ totalPrice: 2000, frequency: 'toString' })).toBeNaN();
    expect(sablonAylikTutari({ totalPrice: 2000, frequency: 'hasOwnProperty' })).toBeNaN();
  });
});

describe('tekrarlayanGelir — MRR / ARR', () => {
  it('1. K19 vektörü (GenelOzet paritesi DEĞİL — bilinçli fark: haftalık ×4 → ×52÷12)', () => {
    const s = tekrarlayanGelir([sirinHaftalik, sirinAylik, sirinUcAylik]);
    // haftalık 1000 → 4333,33 · aylık 2000 → 2000 · üç aylık 3000 → 1000
    expect(s.mrr.toplam).toBeCloseTo(7333.333333, 6); // mutasyon: weekly 4 → 7000 · 4.33 → 7330
    expect(s.mrr.bilinen).toBe(3);
    expect(s.mrr.bilinmeyen).toBe(0);
    expect(s.tutarsiz).toBe(0);
    expect(s.bilinmeyenFrekans).toBe(0);
    expect(s.aktif).toBe(3);
    // ARR = 1000×52 + 2000×12 + 3000×4 — LojistikRapor.tsx:1082 tamsayılarıyla AYNI sayı.
    expect(s.arr).toBeCloseTo(88000, 6); // mutasyon: weekly 4 → 84000 · 4.33 → 87960
  });

  it('1. parite alt vakası: kararın DOKUNMADIĞI frekanslar eski kodla BİREBİR', () => {
    const s = tekrarlayanGelir([sirinAylik, sirinUcAylik]);
    expect(s.mrr.toplam).toBe(3000);
    expect(s.arr).toBe(36000);
  });

  it('2. pasif şablon ne sayılır ne toplanır', () => {
    const s = tekrarlayanGelir([sirinAylik, { ...sirinUcAylik, active: false }]);
    expect(s.aktif).toBe(1);
    expect(s.mrr.toplam).toBe(2000);
    expect(s.arr).toBe(24000);
  });

  it('8. truthy parite: active 1 / "true" aktif; 0 / "" / undefined değil', () => {
    expect(tekrarlayanGelir([{ ...sirinAylik, active: 1 }]).aktif).toBe(1);
    expect(tekrarlayanGelir([{ ...sirinAylik, active: 'true' }]).aktif).toBe(1);
    expect(tekrarlayanGelir([{ ...sirinAylik, active: 0 }]).aktif).toBe(0);
    expect(tekrarlayanGelir([{ ...sirinAylik, active: '' }]).aktif).toBe(0);
    expect(tekrarlayanGelir([{ ...sirinAylik, active: undefined }]).aktif).toBe(0);
  });

  it('3. tutarı bilinmeyen şablon: MRR kısmi toplam + sayaç, ARR "—" (NaN)', () => {
    const s = tekrarlayanGelir([sirinAylik, { ...sirinUcAylik, totalPrice: undefined }]);
    expect(s.mrr).toEqual({ toplam: 2000, bilinen: 1, bilinmeyen: 1 });
    expect(s.tutarsiz).toBe(1);
    expect(s.bilinmeyenFrekans).toBe(0);
    // TÜRETME kapısı: kısmi MRR'den ARR üretilmez (mutasyon: mrr.toplam * 12 → 24000, kırmızı).
    expect(s.arr).toBeNaN();
  });

  it('4. meşru 0 tutar ARR üretimini engellemez', () => {
    const s = tekrarlayanGelir([{ ...sirinAylik, totalPrice: 0 }, sirinUcAylik]);
    expect(s.mrr).toEqual({ toplam: 1000, bilinen: 2, bilinmeyen: 0 });
    expect(s.tutarsiz).toBe(0);
    expect(s.arr).toBe(12000);
  });

  it('5. bilinmeyen frekans (K19: toplanmaz, SAYILIR)', () => {
    const s = tekrarlayanGelir([sirinAylik, { ...sirinUcAylik, frequency: 'yearly' }]);
    // mutasyon: else dalı ×1 → toplam 5000, bilinmeyenFrekans 0 (iki assertion birden kırmızı).
    expect(s.mrr.toplam).toBe(2000);
    expect(s.mrr.bilinmeyen).toBe(1);
    expect(s.bilinmeyenFrekans).toBe(1);
    expect(s.tutarsiz).toBe(0);
    expect(s.arr).toBeNaN();
  });

  it('5. prototip anahtarlı frekans da SAYILIR (düz TABLO[f] araması burada fonksiyon döndürür)', () => {
    const s = tekrarlayanGelir([sirinAylik, { ...sirinUcAylik, frequency: 'constructor' }]);
    expect(s.mrr.toplam).toBe(2000);
    expect(s.bilinmeyenFrekans).toBe(1);
    expect(s.tutarsiz).toBe(0);
    expect(s.arr).toBeNaN();
  });

  it('7. hiç aktif şablon yok → gerçek 0 (panel zaten aktif > 0 kapılı)', () => {
    expect(tekrarlayanGelir([])).toEqual({ mrr: { toplam: 0, bilinen: 0, bilinmeyen: 0 }, arr: 0, tutarsiz: 0, bilinmeyenFrekans: 0, aktif: 0 });
    const pasif = tekrarlayanGelir([{ ...sirinAylik, active: false }]);
    expect(pasif.mrr).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(pasif.arr).toBe(0);
    expect(pasif.aktif).toBe(0);
  });

  it('10. DEĞİŞMEZ: tutarsiz + bilinmeyenFrekans === mrr.bilinmeyen (çift sayım YOK)', () => {
    const s = tekrarlayanGelir([
      sirinHaftalik,                                              // sağlam
      { ...sirinAylik, totalPrice: undefined },                   // yalnız tutar bilinmiyor
      { ...sirinUcAylik, frequency: 'yearly' },                   // yalnız frekans bilinmiyor
      { totalPrice: '', frequency: 'Weekly', active: true },      // İKİSİ de bilinmiyor → TEK sayaçta
      { ...sirinAylik, totalPrice: undefined, active: false },    // pasif → hiç sayılmaz
    ]);
    expect(s.aktif).toBe(4);
    expect(s.mrr.bilinmeyen).toBe(3);
    expect(s.tutarsiz).toBe(1);
    expect(s.bilinmeyenFrekans).toBe(2);
    expect(s.tutarsiz + s.bilinmeyenFrekans).toBe(s.mrr.bilinmeyen);
    expect(s.mrr.toplam).toBeCloseTo(4333.333333, 6);
    expect(s.arr).toBeNaN();
  });
});
