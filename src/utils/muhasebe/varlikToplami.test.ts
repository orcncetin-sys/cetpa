/**
 * varlikToplami.test.ts — sabit kıymet KPI toplamlarının sözleşmesi (Faz 3 5/n düzeltici turu,
 * 2026-09-19). ÖNCE YAZILDI (kırmızı görüldü: modül yoktu).
 *
 * NEDEN VAR: `SabitKiymetModule.toplaTRY` (satır ~347) "tek kalem çevrilemiyorsa toplam da
 * güvenilmez → null" diyordu. Aynı kapı 2026-09-19'da BİLİNMEYEN TUTARA da genişletilince,
 * 40 doğru demirbaşın yanına Mikro importundan alış tarihi çözülemeyen TEK varlık düşmesi
 * "Toplam Defter Değeri" ve "Birikmiş Amortisman" kartlarının İKİSİNİ birden '—' yapıyordu.
 * Önceki gün ₺4,2M gösteren kart AÇIKLAMASIZ boşalıyor, kur-yok yolu da aynı '—'yı bastığı
 * için kullanıcı nedeni ayırt edemiyordu.
 *
 * SÖZLEŞME (src/utils/para.ts): kart bir EKRAN toplamıdır — bilinenlerin kısmi toplamı + "N
 * varlık dışarıda" notu; hiç bilinen yoksa NaN ('—'). İki dışlama nedeni AYRI sayılır
 * (türetilemeyen değer ≠ bulunamayan kur), çünkü kullanıcının yapacağı iş farklıdır.
 */
import { describe, it, expect } from 'vitest';
import { varlikToplami } from './varlikToplami';

/** Şirin İnşaat şantiye demirbaşları. */
interface Varlik { ad: string; net: number; paraBirimi?: string }
const v = (ad: string, net: number, paraBirimi?: string): Varlik => ({ ad, net, paraBirimi });

/** ₺ doğrudan; USD 34 TL; başka birim çevrilemez (kur yok → null). */
const kur = (ham: number, o: Varlik): number | null =>
  !o.paraBirimi || o.paraBirimi === 'TRY' ? ham : o.paraBirimi === 'USD' ? ham * 34 : null;

describe('varlikToplami — parite (hepsi ₺ ve hepsi biliniyor)', () => {
  it('toplam eski `reduce` ile BİREBİR aynı, sayaçlar 0', () => {
    const r = varlikToplami([v('Forklift', 240_000), v('Beton mikseri', 1_000_000)], o => o.net, kur);
    expect(r.ekran).toBe(1_240_000);
    expect(r.hesaplanamayan).toBe(0);
    expect(r.kursuz).toBe(0);
  });

  it('kur çevrimi yapılan varlık da toplama girer', () => {
    const r = varlikToplami([v('Forklift', 100_000), v('Lazer nivo', 1_000, 'USD')], o => o.net, kur);
    expect(r.ekran).toBe(134_000);
  });

  it('boş liste gerçek 0 (varlık yok ≠ bilinmiyor)', () => {
    expect(varlikToplami([], (o: Varlik) => o.net, kur).ekran).toBe(0);
  });
});

describe('varlikToplami — TEK eksik varlık kartı boşaltmaz, SAYILIR', () => {
  it('MUTASYON AYIRT EDİCİ: amortismanı türetilemeyen varlık kısmi toplamı düşürmez', () => {
    // Eski kapı (`if (!Number.isFinite(ham)) return null`) 40 doğru varlığın toplamını da siliyordu.
    const r = varlikToplami(
      [v('Forklift', 240_000), v('Beton mikseri', 1_000_000), v('Mikro kaydı (tarihsiz)', NaN)],
      o => o.net, kur,
    );
    expect(r.ekran).toBe(1_240_000);
    expect(r.hesaplanamayan).toBe(1);
    expect(r.kursuz).toBe(0);
  });

  it('MUTASYON AYIRT EDİCİ: kuru bulunamayan varlık AYRI sayılır (aynı sayaca girmez)', () => {
    const r = varlikToplami(
      [v('Forklift', 240_000), v('Alman vinç', 5_000, 'EUR')],
      o => o.net, kur,
    );
    expect(r.ekran).toBe(240_000);
    expect(r.kursuz).toBe(1);
    expect(r.hesaplanamayan).toBe(0);
  });

  it('iki neden bir arada: her varlık YALNIZ bir sayaca düşer', () => {
    const r = varlikToplami(
      [v('Forklift', 240_000), v('Mikro kaydı', NaN), v('Alman vinç', 5_000, 'EUR')],
      o => o.net, kur,
    );
    expect(r.ekran).toBe(240_000);
    expect(r.hesaplanamayan).toBe(1);
    expect(r.kursuz).toBe(1);
    expect(r.tutar.bilinmeyen).toBe(2);
  });

  it('değeri bilinmeyen varlıkta kur HİÇ sorulmaz (tarihsiz EUR kaydı iki kez sayılmaz)', () => {
    let kurSorusu = 0;
    const r = varlikToplami([v('Alman vinç (tarihsiz)', NaN, 'EUR')], o => o.net, (ham, o) => {
      kurSorusu++;
      return kur(ham, o);
    });
    expect(kurSorusu).toBe(0);
    expect(r.hesaplanamayan).toBe(1);
    expect(r.kursuz).toBe(0);
  });
});

describe('varlikToplami — hiç bilinen yoksa EKRAN değeri NaN ("—", ₺0 DEĞİL)', () => {
  it('tek varlık ve o da türetilemiyorsa NaN', () => {
    const r = varlikToplami([v('Mikro kaydı', NaN)], o => o.net, kur);
    expect(Number.isNaN(r.ekran)).toBe(true);
  });

  it('hepsinin kuru yoksa NaN', () => {
    const r = varlikToplami([v('Alman vinç', 5_000, 'EUR'), v('İsviçre lazer', 900, 'CHF')], o => o.net, kur);
    expect(Number.isNaN(r.ekran)).toBe(true);
    expect(r.kursuz).toBe(2);
  });

  it('kur çeviricisi NaN/Infinity döndürürse de "bilinmiyor" sayılır (sessiz ₺0 yok)', () => {
    const r = varlikToplami([v('Forklift', 100_000, 'USD')], o => o.net, () => NaN);
    expect(Number.isNaN(r.ekran)).toBe(true);
    expect(r.kursuz).toBe(1);
  });
});
