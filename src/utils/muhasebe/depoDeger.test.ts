/**
 * depoDeger.test.ts — AccountingModule "Depolar" sekmesi (WarehousesTab) depo kartı / envanter detayı
 * toplamlarının (adet, stok değeri) ve İşletme Sermayesi ön-doldurmadaki stok değerinin sözleşmesi
 * (Faz 3 2/n, 2026-09-14). ÖNCE YAZILDI.
 *
 * Sayfadaki sahte kesinlik: WarehousesTab.tsx 44 / 78 `reduce((s, wi) => s + (Number(wi.quantity) || 0), 0)`,
 * 79 `(Number(wi.quantity) || 0) * (Number(costPrice) || 0)`, 77 sıralama `(Number(b.quantity)||0) - …`,
 * 125 `(Number(wi.quantity) || 0).toLocaleString`; AccountingModule.tsx 979 prefillWC aynı çarpım.
 * Kural (CLAUDE.md): bilinmeyen adet/maliyet 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR, ekranda '—'
 * ya da "N kalem maliyetsiz". Boş depo GERÇEK 0. Sayfa paritesi: adedi/maliyeti bilinen kalemde sayı aynı.
 */
import { describe, it, expect } from 'vitest';
import { depoToplamlari, adetYaz, type DepoKalemi } from './depoDeger';
import { ekranTutari, tamTutar, sayiSirala } from '../para';
import { paraYaz } from '../currency';

// Şirin İnşaat'ın Merkez deposu: çimento, demir, tuğla (₺ maliyetli) + Çelik Yapı'dan gelen maliyetsiz kalemler
const cimento: DepoKalemi   = { quantity: 120, costPrice: 85 };        // 120 torba × ₺85   = ₺10.200
const demir: DepoKalemi     = { quantity: 40, costPrice: 1250.5 };     // 40 ton × ₺1.250,50 = ₺50.020
const tugla: DepoKalemi     = { quantity: '3000', costPrice: '2.4' };  // sayısal string (DB'den) → bilinen: ₺7.200
const kum: DepoKalemi       = { quantity: 15 };                        // costPrice alanı YOK (WarehouseItem tipi gibi) → değer bilinmiyor
const kirec: DepoKalemi     = { quantity: 8, costPrice: null };        // DB null → bilinmiyor
const bozukKayit: DepoKalemi = { quantity: null, costPrice: 40 };      // adet bilinmiyor → adet VE değer bilinmiyor
const metinAdet: DepoKalemi = { quantity: 'abc', costPrice: 10 };      // metin → bilinmiyor (`Number('abc') || 0` eskiden 0 sayardı)
const bedavaNumune: DepoKalemi = { quantity: 5, costPrice: 0 };        // bilinen 0 maliyet → değer GERÇEK 0, tutarsız DEĞİL

const SIFIR = { toplam: 0, bilinen: 0, bilinmeyen: 0 };

describe('depoToplamlari — sayfa paritesi (adedi ve maliyeti bilinen kalemler)', () => {
  it('adet = Σ quantity, değer = Σ costPrice × quantity; eski reduce ile aynı sayı', () => {
    const t = depoToplamlari([cimento, demir, tugla]);
    expect(t.adet).toEqual({ toplam: 3160, bilinen: 3, bilinmeyen: 0 });
    expect(t.deger.toplam).toBeCloseTo(10200 + 50020 + 7200, 6);
    expect(t.deger.bilinen).toBe(3);
    expect(t.deger.bilinmeyen).toBe(0);
    // Eski kod: reduce((s, wi) => s + (Number(wi.quantity) || 0) * (Number(costPrice) || 0), 0)
    const eski = [cimento, demir, tugla].reduce((s, wi) => s + (Number(wi.quantity) || 0) * (Number(wi.costPrice) || 0), 0);
    expect(ekranTutari(t.deger)).toBeCloseTo(eski, 6);
  });

  it('boş depo GERÇEK 0 (hareketsiz), bilinmeyen değil → ekranda ₺0, "—" değil', () => {
    const t = depoToplamlari([]);
    expect(t.adet).toEqual(SIFIR);
    expect(t.deger).toEqual(SIFIR);
    expect(ekranTutari(t.deger)).toBe(0);
    expect(tamTutar(t.deger)).toBe(0);
    expect(paraYaz(ekranTutari(t.deger))).toBe('₺0,00');
  });

  it('bilinen 0 maliyet (bedava numune) değeri 0 sayılır, maliyetsiz SAYILMAZ', () => {
    const t = depoToplamlari([bedavaNumune]);
    expect(t.adet).toEqual({ toplam: 5, bilinen: 1, bilinmeyen: 0 });
    expect(t.deger).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
  });
});

describe('depoToplamlari — bilinmeyen 0 sayılmaz, SAYILIR', () => {
  it('costPrice alanı olmayan / null kalem: adet bilinir, değer bilinmez (|| 0 geri gelirse bilinmeyen 0 olur → kırılır)', () => {
    const t = depoToplamlari([cimento, kum, kirec]);
    expect(t.adet).toEqual({ toplam: 143, bilinen: 3, bilinmeyen: 0 });
    expect(t.deger).toEqual({ toplam: 10200, bilinen: 1, bilinmeyen: 2 });
  });

  it('adedi bilinmeyen kalem (null / metin) hem adette hem değerde SAYILIR; toplam kısmi kalır', () => {
    const t = depoToplamlari([demir, bozukKayit, metinAdet]);
    expect(t.adet).toEqual({ toplam: 40, bilinen: 1, bilinmeyen: 2 });
    expect(t.deger).toEqual({ toplam: 50020, bilinen: 1, bilinmeyen: 2 });
  });

  it('hiç maliyet bilinmiyorsa ekran "—" (eski kod 0 basıp `> 0` süzgeciyle "—" gösteriyordu; artık bilinçli)', () => {
    const t = depoToplamlari([kum, kirec]);
    expect(t.adet).toEqual({ toplam: 23, bilinen: 2, bilinmeyen: 0 });
    expect(t.deger).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 2 });
    expect(Number.isNaN(ekranTutari(t.deger))).toBe(true);
    expect(paraYaz(ekranTutari(t.deger))).toBe('—');
    // Türetme kapısı da kapalı: bu değer İşletme Sermayesi'ne (prefillWC) sayı olarak yazılamaz
    expect(Number.isNaN(tamTutar(t.deger))).toBe(true);
  });

  it('kısmi: bilinen toplam + not sayacı (sayfa "N kalem maliyetsiz" yazar); tamTutar NaN (prefill için yetersiz)', () => {
    const t = depoToplamlari([cimento, demir, kum]);
    expect(ekranTutari(t.deger)).toBe(60220);
    expect(t.deger.bilinmeyen).toBe(1);
    expect(paraYaz(ekranTutari(t.deger))).toBe('₺60.220,00');
    expect(Number.isNaN(tamTutar(t.deger))).toBe(true);
  });

  it('sayısal string adet bilinen sayılır (eski Number(x) paritesi); boşluk/boş string bilinmiyor', () => {
    const t = depoToplamlari([{ quantity: '12' }, { quantity: '' }, { quantity: '  ' }]);
    expect(t.adet).toEqual({ toplam: 12, bilinen: 1, bilinmeyen: 2 });
  });
});

describe('adetYaz — satır/kart adet metni', () => {
  it('bilinen adet tr-TR biçimi (eski toLocaleString paritesi), bilinmeyen "—" (eski "0")', () => {
    expect(adetYaz(3000)).toBe('3.000');
    expect(adetYaz('1250.5')).toBe('1.250,5');
    expect(adetYaz(0)).toBe('0');
    expect(adetYaz(null)).toBe('—');
    expect(adetYaz(undefined)).toBe('—');
    expect(adetYaz('abc')).toBe('—');
    expect(adetYaz(NaN)).toBe('—');
  });
});

describe('sıralama — bilinmeyen adet 0 sayılmaz, listenin sonuna gider (para.ts sayiSirala, azalan)', () => {
  it('azalan adet: 120, 40, 8, sonra adedi bilinmeyenler', () => {
    const sirali = [kirec, bozukKayit, cimento, metinAdet, demir].sort((a, b) => sayiSirala(a.quantity, b.quantity, true));
    expect(sirali.map(k => k.quantity)).toEqual([120, 40, 8, null, 'abc']);
  });
});
