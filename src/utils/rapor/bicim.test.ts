/**
 * bicim.test.ts — rapor yüzeylerinin yüzde metni sözleşmesi (Faz 3 6/n a, 2026-09-19). ÖNCE YAZILDI.
 *
 * Kilitlenen kurallar (CLAUDE.md "sahte kesinlik gösterme"):
 *   • bilinmeyen oran 0 DEĞİL bilinmiyordur → '—'; 'NaN%' / 'Infinity%' / '0%' UYDURULMAZ
 *   • meşru 0 gerçek sıfırdır → '0%' (bilinmeyenle karıştırılmaz)
 *   • ondalık ayracı YEREL (tr → virgül) — `toFixed` kullanılırsa TR'de nokta basar
 *   • yüzde işareti SONDA ('42%') — Muhasebe'nin ÖNEK biçimi ('%20') AYRI sözleşmedir, birleştirilmez
 *
 * Fikstür bağlamı: Şirin İnşaat'ın ÇİMENTO 50KG siparişlerinden türeyen rapor oranları (TL, tr-TR).
 */
import { describe, it, expect } from 'vitest';
import { yuzdeYaz } from './bicim';
import { kdvOranYaz } from '../muhasebe/mizan';

describe('yuzdeYaz — parite (mevcut rapor yüzeyleriyle birebir)', () => {
  it("tam sayı oran → '42%' (işaret SONDA; RaporlarPage :177/:656/:700 `${Math.round(...)}%` ile parite)", () => {
    // Şirin İnşaat'ın siparişlerinin %42'si "Teslim Edildi" durumunda.
    expect(yuzdeYaz(42)).toBe('42%');
    // Mutasyon kapısı: `%${...}` ön-ek biçimine dönerse burada kırılır.
    expect(yuzdeYaz(42).endsWith('%')).toBe(true);
    expect(yuzdeYaz(42).startsWith('%')).toBe(false);
  });

  it("EN tek ondalık → '12.3%' (RaporlarPage :364 `v.toFixed(1) + '%'` ile parite)", () => {
    expect(yuzdeYaz(12.34, 1, 'en')).toBe('12.3%');
  });

  it('ondalık istenmezse yuvarlar, ondalık basmaz', () => {
    expect(yuzdeYaz(12.34)).toBe('12%');
    expect(yuzdeYaz(12.6)).toBe('13%');
  });
});

describe('yuzdeYaz — yerel ondalık ayracı', () => {
  it("TR ondalık VİRGÜL: '12,3%' (mutasyon: toFixed → '12.3%')", () => {
    expect(yuzdeYaz(12.34, 1)).toBe('12,3%');
    // Varsayılan dil tr: açıkça geçilmese de virgül.
    expect(yuzdeYaz(12.34, 1, 'tr')).toBe('12,3%');
  });

  it("EN ondalık NOKTA: '12.3%' (mutasyon: dil yok sayılıp 'tr-TR' sabitlenirse kırılır)", () => {
    expect(yuzdeYaz(12.34, 1, 'en')).toBe('12.3%');
    expect(yuzdeYaz(12.34, 2, 'en')).toBe('12.34%');
  });
});

describe('yuzdeYaz — bilinmeyen 0 SAYILMAZ', () => {
  it("null / undefined / NaN / ±Infinity → '—' (mutasyon: global isFinite → yuzdeYaz(null) '0%' basar)", () => {
    // Global `isFinite(null)` true'dur (Number(null) === 0) — bu yüzden Number.isFinite ŞART.
    expect(yuzdeYaz(null)).toBe('—');
    expect(yuzdeYaz(undefined)).toBe('—');
    expect(yuzdeYaz(NaN)).toBe('—');
    expect(yuzdeYaz(Infinity)).toBe('—');
    expect(yuzdeYaz(-Infinity)).toBe('—');
  });

  it("bilinmeyen asla 'NaN%' / 'Infinity%' / '0%' basmaz (RaporlarPage :364 bugün 'NaN%' basıyor)", () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
      for (const d of [0, 1, 2]) {
        for (const dil of ['tr', 'en'] as const) {
          const s = yuzdeYaz(v, d, dil);
          expect(s).toBe('—');
          expect(s).not.toMatch(/NaN|Infinity|\d/);
        }
      }
    }
  });

  it("bilinmeyen dilden bağımsız '—' (EN'de 'N/A' gibi ayrı bir metne kaymaz)", () => {
    expect(yuzdeYaz(null, 1, 'en')).toBe('—');
  });

  it("0'a BÖLÜNMEDEN gelen Infinity de bilinmiyordur — payda 0 iken '∞%' uydurulmaz", () => {
    // Çağıran `0 sipariş` üzerinden oran hesaplarsa Infinity gelir; ekranda '—' görünür.
    const payda = 0;
    expect(yuzdeYaz((3 / payda) * 100)).toBe('—');
  });
});

describe('yuzdeYaz — meşru sıfır bilinmeyen DEĞİLDİR', () => {
  it("0 → '0%' (mutasyon: `if (!oran) return '—'` burada kırılır)", () => {
    // Şirin İnşaat'ın HİÇ iptal siparişi yok: gerçek %0.
    expect(yuzdeYaz(0)).toBe('0%');
    expect(yuzdeYaz(0, 1)).toBe('0,0%');
    expect(yuzdeYaz(0, 1, 'en')).toBe('0.0%');
  });
});

describe('yuzdeYaz — işaret', () => {
  it("negatif oran işaretini korur: '-5,5%'", () => {
    expect(yuzdeYaz(-5.5, 1)).toBe('-5,5%');
    expect(yuzdeYaz(-5.5, 1, 'en')).toBe('-5.5%');
  });

  it("pozitife '+' öneki EKLEMEZ (değişim rozetleri kendi önekini koyar)", () => {
    expect(yuzdeYaz(5)).toBe('5%');
    expect(yuzdeYaz(5).startsWith('+')).toBe(false);
  });
});

describe('yuzdeYaz — binlik ayracı YOK', () => {
  it("'1250%' — gruplanmaz (mutasyon: useGrouping varsayılanı → TR'de '1.250%')", () => {
    // Geçen aya göre 12,5 kat artış oranı olarak gelebilir.
    expect(yuzdeYaz(1250)).toBe('1250%');
    expect(yuzdeYaz(1250, 0, 'en')).toBe('1250%');
    expect(yuzdeYaz(1250.5, 1)).toBe('1250,5%');
  });
});

describe('yuzdeYaz — yuvarlama sınırları', () => {
  it("99.95 → '100.0%' (EN, 1 ondalık)", () => {
    expect(yuzdeYaz(99.95, 1, 'en')).toBe('100.0%');
  });

  it("0.04 → '0.0%' — sıfıra yuvarlanan gerçek bir değer '—' OLMAZ", () => {
    expect(yuzdeYaz(0.04, 1, 'en')).toBe('0.0%');
    expect(yuzdeYaz(0.04, 1)).toBe('0,0%');
  });

  it("ondalık sayısı SABİTLENİR: minimumFractionDigits eksikse '0.0%' yerine '0%' basardı", () => {
    expect(yuzdeYaz(100, 1, 'en')).toBe('100.0%');
    expect(yuzdeYaz(100, 2)).toBe('100,00%');
  });
});

describe('yuzdeYaz — oranı HESAPLAMAZ', () => {
  it('girdi hazır orandır (0-100 aralığı zorunlu değil, kırpılmaz)', () => {
    // lojistikKpi.oranYuzde ham, finansKpi.yuzdeOrani yuvarlanmış gelir; modül ikisini de aynen basar.
    expect(yuzdeYaz(137.5, 1)).toBe('137,5%');
    expect(yuzdeYaz(-12)).toBe('-12%');
  });
});

describe('İKİ yüzde biçimi bilinçli olarak YAŞAR', () => {
  it("Muhasebe KDV oranı ÖNEK ('%20'), rapor oranı SONEK ('20%') — biri öbürüne indirgenmez", () => {
    expect(kdvOranYaz(20)).toBe('%20');
    expect(yuzdeYaz(20)).toBe('20%');
    expect(yuzdeYaz(20)).not.toBe(kdvOranYaz(20));
  });

  it("iki biçim de bilinmeyende aynı şeyi der: '—'", () => {
    expect(kdvOranYaz(null)).toBe('—');
    expect(yuzdeYaz(null)).toBe('—');
  });
});
