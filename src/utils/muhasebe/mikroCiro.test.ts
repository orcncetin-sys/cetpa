/**
 * mikroCiro.test.ts — Mikro faturalarından ciro/maliyet toplamının SÖZLEŞMESİ
 * (Faz 3 2/n, grup "hook", 2026-09-18). ÖNCE YAZILDI.
 *
 * NEDEN VAR — aynı hesap ÜÇ ekranda elle kopyalanmıştı ve üçü de bilinmeyeni 0 sayıyordu:
 *   FinancePanel 87-88   `mikroGiden.reduce((s, f) => s + f.tutar, 0)`        (hook 0'a zorladığı için sessiz)
 *   SubeModule  179-180  `...filter(subeNo/tarih).reduce((a, f) => a + f.tutar, 0)`
 *   DashboardPage 171/432/496 `reduce((s, f) => s + (f.tutar || 0), 0)`       (açık `|| 0`)
 * Hook grubu `tutar`ı NaN (= bilinmiyor) yaptıktan sonra bu reduce'lar NaN'ı toplama bulaştırır
 * ya da `|| 0` ile eski sahte sıfıra geri düşerdi. Kural: bilinmeyen toplama GİRMEZ, SAYILIR.
 *
 * PARİTE: süzgeçler (yön, tarih öneki, şube no) AYNEN korunur — yalnız toplama biçimi değişir.
 */
import { describe, it, expect } from 'vitest';
import { mikroFaturaSuz, mikroToplam, mikroCiroMaliyet, nativeCiroMaliyet, birlesikKar, type MikroCiroFaturasi } from './mikroCiro';
import { tutarBirlestir, ekranTutari, tamTutar } from '../para';

// ── Fikstür: iki şube, iki ay, biri meblağı okunamayan fatura ────────────────────────────────────
const f = (o: Partial<MikroCiroFaturasi>): MikroCiroFaturasi =>
  ({ yon: 'giden', tutar: 0, tarih: '2026-03-01', subeNo: 1, ...o });

const sirin1  = f({ tutar: 1000, tarih: '2026-03-05', subeNo: 1 });                 // Şirin İnşaat, Mart, şube 1
const sirin2  = f({ tutar: 500,  tarih: '2026-03-20', subeNo: 1 });
const celik   = f({ tutar: 2000, tarih: '2026-03-11', subeNo: 2 });                 // Çelik Yapı, Mart, şube 2
const subat   = f({ tutar: 700,  tarih: '2026-02-28', subeNo: 1 });                 // Şubat
const tutarsiz = f({ tutar: NaN, tarih: '2026-03-15', subeNo: 1 });                 // meblağı OKUNAMADI
const tarihsiz = f({ tutar: 900, tarih: '',           subeNo: 1 });                 // tarihi yok
const alis    = f({ tutar: 3000, tarih: '2026-03-08', subeNo: 1, yon: 'gelen' });   // alış faturası
const alisNaN = f({ tutar: NaN,  tarih: '2026-03-09', subeNo: 1, yon: 'gelen' });

const hepsi = [sirin1, sirin2, celik, subat, tutarsiz, tarihsiz, alis, alisNaN];

describe('mikroFaturaSuz — süzgeç paritesi', () => {
  it('yalnız istenen yön', () => {
    expect(mikroFaturaSuz(hepsi, { yon: 'gelen' })).toEqual([alis, alisNaN]);
  });

  it('tarih öneki "YYYY-MM" ile ay süzer; tarihi boş fatura HİÇBİR döneme girmez', () => {
    const mart = mikroFaturaSuz(hepsi, { yon: 'giden', tarihOneki: '2026-03' });
    expect(mart).toEqual([sirin1, sirin2, celik, tutarsiz]);
    expect(mart).not.toContain(tarihsiz);
  });

  it('tarih öneki gün de olabilir ("YYYY-MM-DD")', () => {
    expect(mikroFaturaSuz(hepsi, { yon: 'giden', tarihOneki: '2026-03-05' })).toEqual([sirin1]);
  });

  it('şube no süzer; şube no çözülemezse (undefined/NaN) HİÇBİR fatura dönmez — yanlış şubeye yazmaktansa boş', () => {
    expect(mikroFaturaSuz(hepsi, { yon: 'giden', subeNo: 2 })).toEqual([celik]);
    expect(mikroFaturaSuz(hepsi, { yon: 'giden', subeNo: NaN })).toEqual([]);
    expect(mikroFaturaSuz(hepsi, { yon: 'giden', subeNo: 'ŞB-1' })).toEqual([]);
  });

  it('şube süzgeci VERİLMEZSE şube bakılmaz (tüm şubeler)', () => {
    expect(mikroFaturaSuz(hepsi, { yon: 'giden' }).length).toBe(6);
  });
});

describe('mikroToplam — bilinmeyen toplama girmez, SAYILIR', () => {
  it('Mart satış: 1000 + 500 + 2000 bilinen, 1 tutarsız', () => {
    expect(mikroToplam(hepsi, { yon: 'giden', tarihOneki: '2026-03' }))
      .toEqual({ toplam: 3500, bilinen: 3, bilinmeyen: 1 });
  });

  it('şube 1 / Mart: tutarsız fatura da şube 1 — kısmi toplam + sayaç', () => {
    const t = mikroToplam(hepsi, { yon: 'giden', tarihOneki: '2026-03', subeNo: 1 });
    expect(t).toEqual({ toplam: 1500, bilinen: 2, bilinmeyen: 1 });
    expect(ekranTutari(t)).toBe(1500);
  });

  it('MUTASYON AYIRT EDİCİ: `|| 0` geri gelirse bilinmeyen 0 sayılır ve sayaç 0 olur', () => {
    const t = mikroToplam([tutarsiz], { yon: 'giden' });
    expect(t.bilinmeyen).toBe(1);
    expect(t.bilinen).toBe(0);
    expect(Number.isNaN(ekranTutari(t))).toBe(true);   // hiç bilinen yok → ekran '—'
  });

  it('eşleşen fatura YOKSA gerçek 0 (hareketsiz dönem), bilinmeyen değil', () => {
    expect(mikroToplam(hepsi, { yon: 'giden', tarihOneki: '2025-01' }))
      .toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(ekranTutari(mikroToplam(hepsi, { yon: 'giden', tarihOneki: '2025-01' }))).toBe(0);
  });

  it('meşru ₺0 fatura BİLİNEN sayılır', () => {
    expect(mikroToplam([f({ tutar: 0 })], { yon: 'giden' }))
      .toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
  });
});

describe('mikroCiroMaliyet — giden = ciro, gelen = maliyet', () => {
  it('iki yönü tek geçişte ayırır', () => {
    const { ciro, maliyet } = mikroCiroMaliyet(hepsi);
    expect(ciro).toEqual({ toplam: 5100, bilinen: 5, bilinmeyen: 1 });    // 1000+500+2000+700+900(tarihsiz)
    expect(maliyet).toEqual({ toplam: 3000, bilinen: 1, bilinmeyen: 1 });
  });

  it('tarih öneki verilirse iki yön de aynı dönemle süzülür', () => {
    const { ciro, maliyet } = mikroCiroMaliyet(hepsi, '2026-03');
    expect(ciro.toplam).toBe(3500);
    expect(maliyet.toplam).toBe(3000);
  });
});

describe('nativeCiroMaliyet — ciro ve maliyet AYNI KÜMEDEN sayılır', () => {
  // Hakem bulgusu (2026-09-18): ciro `orders.filter(odemeTakipli)` üzerinden, maliyet TÜM
  // `orders` üzerinden sayılıyordu. Mikro faturasından türetilen sipariş cirodan bilerek
  // dışlanıyor (çift sayım koruması) ama maliyet kovasında "maliyeti bilinmiyor" olarak
  // kalıyordu; `tamTutar` kapısı bu yüzden marjı ve Net Kâr'ı KALICI olarak veto ediyordu.
  const sirin  = { customerName: 'Şirin İnşaat', totalPrice: 1000, cost: 600 };
  const mikro  = { customerName: 'Çelik Yapı', totalPrice: 5000, source: 'mikro-fatura' };  // cost YOK, tasarım gereği

  it('Mikro kaynaklı sipariş ne ciroya ne maliyete girer — marj hesaplanabilir kalır', () => {
    const { ciro, maliyet } = nativeCiroMaliyet([sirin, mikro]);
    expect(ciro).toEqual({ toplam: 1000, bilinen: 1, bilinmeyen: 0 });
    expect(maliyet).toEqual({ toplam: 600, bilinen: 1, bilinmeyen: 0 });
    expect(tamTutar(maliyet)).toBe(600);        // MUTASYON AYIRT EDİCİ: küme tüm orders olursa NaN
    expect(birlesikKar(ciro, maliyet)).toBe(400);
  });

  it("'mikro-siparis' de dışlanır (yalnız 'mikro-fatura' değil — önek kuralı)", () => {
    const { ciro, maliyet } = nativeCiroMaliyet([sirin, { totalPrice: 9000, source: 'mikro-siparis' }]);
    expect(ciro.toplam).toBe(1000);
    expect(maliyet.bilinmeyen).toBe(0);
  });

  it('native siparişin GERÇEKTEN maliyeti yoksa bilinmeyen SAYILIR (veto meşru)', () => {
    const celikYapi = { customerName: 'Çelik Yapı', totalPrice: 2000 };
    const { maliyet } = nativeCiroMaliyet([sirin, celikYapi]);
    expect(maliyet).toEqual({ toplam: 600, bilinen: 1, bilinmeyen: 1 });
    expect(Number.isNaN(tamTutar(maliyet))).toBe(true);
  });

  it('sipariş yoksa iki toplam da gerçek 0 (hareketsiz dönem)', () => {
    expect(nativeCiroMaliyet([])).toEqual({
      ciro:    { toplam: 0, bilinen: 0, bilinmeyen: 0 },
      maliyet: { toplam: 0, bilinen: 0, bilinmeyen: 0 },
    });
  });
});

describe('birlesikKar — TÜRETME kapısı (tamTutar), ekran sözleşmesi DEĞİL', () => {
  it('iki taraf da tamsa kâr = gelir - gider', () => {
    const gelir = { toplam: 5000, bilinen: 3, bilinmeyen: 0 };
    const gider = { toplam: 2000, bilinen: 2, bilinmeyen: 0 };
    expect(birlesikKar(gelir, gider)).toBe(3000);
  });

  it('bir kayıt bile bilinmiyorsa kâr NaN — kısmi gelirden "net kâr" ÜRETİLMEZ', () => {
    const gelir = { toplam: 5000, bilinen: 3, bilinmeyen: 1 };
    const gider = { toplam: 2000, bilinen: 2, bilinmeyen: 0 };
    expect(Number.isNaN(birlesikKar(gelir, gider))).toBe(true);
    expect(Number.isNaN(birlesikKar(gider, gelir))).toBe(true);
  });

  it('hiç kayıt yoksa kâr 0 (hareketsiz dönem)', () => {
    const bos = { toplam: 0, bilinen: 0, bilinmeyen: 0 };
    expect(birlesikKar(bos, bos)).toBe(0);
  });

  it('native + Mikro birleşimi tutarBirlestir ile: bir taraftaki bilinmeyen kâra SIZAR', () => {
    const native = { toplam: 1000, bilinen: 1, bilinmeyen: 1 };
    const { ciro } = mikroCiroMaliyet(hepsi);
    const toplamGelir = tutarBirlestir(native, ciro);
    expect(toplamGelir.bilinmeyen).toBe(2);
    expect(ekranTutari(toplamGelir)).toBe(6100);                          // ekran: kısmi toplam
    expect(Number.isNaN(birlesikKar(toplamGelir, { toplam: 0, bilinen: 0, bilinmeyen: 0 }))).toBe(true); // türetme: '—'
  });
});
