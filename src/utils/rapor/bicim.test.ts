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
  it("tam sayı oran → TR '%42' (işaret ÖNDE, kullanıcı kararı 2026-09-25: \"%42 şeklinde olsun\"), EN '42%'", () => {
    // Şirin İnşaat'ın siparişlerinin %42'si "Teslim Edildi" durumunda.
    expect(yuzdeYaz(42)).toBe('%42');
    expect(yuzdeYaz(42, 0, 'en')).toBe('42%');
    // Mutasyon kapısı: iki dilde de sonek biçimine (eski `${…}%`) dönerse burada kırılır.
    expect(yuzdeYaz(42).startsWith('%')).toBe(true);
    expect(yuzdeYaz(42, 0, 'en').endsWith('%')).toBe(true);
  });

  it("EN tek ondalık → '12.3%' (RaporlarPage :364 `v.toFixed(1) + '%'` ile parite)", () => {
    expect(yuzdeYaz(12.34, 1, 'en')).toBe('12.3%');
  });

  it('ondalık istenmezse yuvarlar, ondalık basmaz', () => {
    expect(yuzdeYaz(12.34)).toBe('%12');
    expect(yuzdeYaz(12.6)).toBe('%13');
  });
});

describe('yuzdeYaz — yerel ondalık ayracı', () => {
  it("TR ondalık VİRGÜL: '12,3%' (mutasyon: toFixed → '12.3%')", () => {
    expect(yuzdeYaz(12.34, 1)).toBe('%12,3');
    // Varsayılan dil tr: açıkça geçilmese de virgül.
    expect(yuzdeYaz(12.34, 1, 'tr')).toBe('%12,3');
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
    expect(yuzdeYaz(0)).toBe('%0');
    expect(yuzdeYaz(0, 1)).toBe('%0,0');
    expect(yuzdeYaz(0, 1, 'en')).toBe('0.0%');
  });
});

describe('yuzdeYaz — işaret', () => {
  it("negatif oran işaretini korur: '-5,5%'", () => {
    expect(yuzdeYaz(-5.5, 1)).toBe('-%5,5');
    expect(yuzdeYaz(-5.5, 1, 'en')).toBe('-5.5%');
  });

  it("pozitife '+' öneki EKLEMEZ (değişim rozetleri kendi önekini koyar)", () => {
    expect(yuzdeYaz(5)).toBe('%5');
    expect(yuzdeYaz(5).startsWith('+')).toBe(false);
  });
});

describe('yuzdeYaz — binlik ayracı YOK', () => {
  it("'1250%' — gruplanmaz (mutasyon: useGrouping varsayılanı → TR'de '1.250%')", () => {
    // Geçen aya göre 12,5 kat artış oranı olarak gelebilir.
    expect(yuzdeYaz(1250)).toBe('%1250');
    expect(yuzdeYaz(1250, 0, 'en')).toBe('1250%');
    expect(yuzdeYaz(1250.5, 1)).toBe('%1250,5');
  });
});

describe('yuzdeYaz — yuvarlama sınırları', () => {
  it("99.95 → '100.0%' (EN, 1 ondalık)", () => {
    expect(yuzdeYaz(99.95, 1, 'en')).toBe('100.0%');
  });

  it("0.04 → '0.0%' — sıfıra yuvarlanan gerçek bir değer '—' OLMAZ", () => {
    expect(yuzdeYaz(0.04, 1, 'en')).toBe('0.0%');
    expect(yuzdeYaz(0.04, 1)).toBe('%0,0');
  });

  it("ondalık sayısı SABİTLENİR: minimumFractionDigits eksikse '0.0%' yerine '0%' basardı", () => {
    expect(yuzdeYaz(100, 1, 'en')).toBe('100.0%');
    expect(yuzdeYaz(100, 2)).toBe('%100,00');
  });
});

describe('yuzdeYaz — oranı HESAPLAMAZ', () => {
  it('girdi hazır orandır (0-100 aralığı zorunlu değil, kırpılmaz)', () => {
    // lojistikKpi.oranYuzde ham, finansKpi.yuzdeOrani yuvarlanmış gelir; modül ikisini de aynen basar.
    expect(yuzdeYaz(137.5, 1)).toBe('%137,5');
    expect(yuzdeYaz(-12)).toBe('-%12');
  });
});

describe('İKİ yüzde biçimi — TR\'de birleşti (2026-09-25)', () => {
  it("TR'de iki biçim artık AYNI yazılır ('%20') — rapor oranı da önek (2026-09-25); EN rapor oranı sonek", () => {
    expect(kdvOranYaz(20)).toBe('%20');
    expect(yuzdeYaz(20)).toBe('%20');
    expect(yuzdeYaz(20)).toBe(kdvOranYaz(20));
    expect(yuzdeYaz(20, 0, 'en')).toBe('20%');
  });

  it("iki biçim de bilinmeyende aynı şeyi der: '—'", () => {
    expect(kdvOranYaz(null)).toBe('—');
    expect(yuzdeYaz(null)).toBe('—');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6b EKİ (2026-09-24): `katYaz` + `gunYaz` — kat ve gün metni
//   GenelBloklar3.tsx:580 `{s.toFixed(1)}x`                            → TR'de nokta ('1.2x')
//   GenelBloklar3.tsx:342 `${inventoryTurnover.toFixed(1)}x` (:338 `: 0`) → veri yokken '0.0x'
//   GenelBloklar1.tsx:326/:330/:334 `{avgCycle} {oc(currentLanguage).gun}` → sayı kapısı yok: "NaN gün" / "Infinity gün"
// Parametre sırası (değer, ondalik, dil) = `yuzdeYaz` (PLAN.md:164 `gunYaz(g, dil)` taslağından bilinçli sapma).
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { katYaz, gunYaz } from './bicim';
import { oc } from '../../i18n/ortak';

describe('katYaz — 6b eki: kat (çarpan) metni', () => {
  it("parite: katYaz(1.2, 1, 'en') → '1.2x'; katYaz(4, 1, 'en') → '4.0x' (GB3:580 `toFixed(1)` + 'x')", () => {
    expect(katYaz(1.2, 1, 'en')).toBe('1.2x');
    expect(katYaz(4, 1, 'en')).toBe('4.0x');
    expect(katYaz(1.2, 1, 'en')).toBe(`${(1.2).toFixed(1)}x`);
  });

  it("TR ondalık VİRGÜL: katYaz(1.25, 1) → '1,3x' (yuvarlama), katYaz(1.2, 1) → '1,2x' (mutasyon: toFixed → '1.2x')", () => {
    expect(katYaz(1.25, 1)).toBe('1,3x');
    expect(katYaz(1.2, 1)).toBe('1,2x');
    expect(katYaz(1.2)).toBe('1,2x');                       // varsayılan ondalik 1, dil tr
  });

  it("bilinmeyen → '—' (mutasyon: global isFinite → katYaz(null) '0,0x')", () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(katYaz(v, 1), String(v)).toBe('—');
      expect(katYaz(v, 1, 'en'), String(v)).toBe('—');
    }
    expect(katYaz(null)).not.toBe('0,0x');
  });

  it("meşru sıfır gerçek sıfırdır: katYaz(0) → '0,0x'; katYaz(0, 0) → '0x'", () => {
    expect(katYaz(0)).toBe('0,0x');
    expect(katYaz(0, 0)).toBe('0x');
  });

  it("negatif işaret korunur, binlik ayracı YOK: '-0,5x', '1250x'", () => {
    expect(katYaz(-0.5, 1)).toBe('-0,5x');
    expect(katYaz(1250, 0)).toBe('1250x');
    expect(katYaz(1250, 0, 'en')).toBe('1250x');
  });
});

describe('gunYaz — 6b eki: gün metni (birim ORTAK sözlükten)', () => {
  it("parite: gunYaz(12) → '12 gün'; gunYaz(12, 0, 'en') → '12 d' (GB1 `{12} {oc(dil).gun}` ile BİREBİR; mutasyon: satır içi birim → EN'de 'gün'/'days')", () => {
    expect(gunYaz(12)).toBe('12 gün');
    expect(gunYaz(12, 0, 'en')).toBe('12 d');
    expect(gunYaz(12)).toBe(`${12} ${oc('tr').gun}`);
    expect(gunYaz(12, 0, 'en')).toBe(`${12} ${oc('en').gun}`);
    expect(gunYaz(12, 0, 'en')).not.toBe('12 gün');
    expect(gunYaz(12, 0, 'en')).not.toBe('12 days');
  });

  it("bilinmeyen → '—'; Infinity ZORUNLU vaka (GB1:307 `Math.min(...[])` → Infinity; mutasyon: `|| 0` → '0 gün')", () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(gunYaz(v), String(v)).toBe('—');
      expect(gunYaz(v, 0, 'en'), String(v)).toBe('—');
    }
    expect(gunYaz(Math.min(...([] as number[])))).toBe('—');
    expect(gunYaz(null)).not.toBe('0 gün');
  });

  it("meşru sıfır ve yuvarlama: '0 gün', 12.6 → '13 gün', 12.5 → '13 gün' (yarım YUKARI = Math.round), 12.55/1 → '12,6 gün' / '12.6 d'", () => {
    expect(gunYaz(0)).toBe('0 gün');
    expect(gunYaz(12.6)).toBe('13 gün');
    expect(gunYaz(12.5)).toBe('13 gün');
    expect(gunYaz(12.5)).toBe(`${Math.round(12.5)} gün`);   // GB1:306 eski Math.round paritesi
    expect(gunYaz(12.55, 1)).toBe('12,6 gün');
    expect(gunYaz(12.55, 1, 'en')).toBe('12.6 d');
  });

  it("negatif korunur: gunYaz(-3) → '-3 gün' (çağıran eler; yardımcı sayıyı SAKLAMAZ)", () => {
    expect(gunYaz(-3)).toBe('-3 gün');
    expect(gunYaz(-3, 0, 'en')).toBe('-3 d');
  });

  it('sözlük bağı: birim metni oc(dil).gun ile biter (sözlük değişirse test uyarır)', () => {
    expect(gunYaz(1, 0, 'en').endsWith(oc('en').gun)).toBe(true);
    expect(gunYaz(1, 0, 'tr').endsWith(oc('tr').gun)).toBe(true);
    expect(gunYaz(1).endsWith(` ${oc('tr').gun}`)).toBe(true);   // tek boşluk
  });
});
