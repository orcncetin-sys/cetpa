// @vitest-environment node
/**
 * magazaTalep.icerik.test.ts — mağaza talebi ortak sözleşmesinin DİLİM 2b saf işlevleri (şartname v6 § 10.1 / § 10.8 «Saf», V24).
 *
 * Kilitlenen değişmezler:
 *  • PARA KURALI (V19): teyit toplamları tam sayı KURUŞLA, KDV KALEM oranıyla ve satır bazında; herhangi bir fiyat `null` ise
 *    üç toplam da `null` (kısmi toplam basılmaz, sıfır değil). Kullanıcı örneği: 2 × 95,00 + 1 × 40,00, %20 → 230,00 / 46,00 / 276,00.
 *  • KDV oranının varsayılanı tek zincir: `magazaKdvVarsayilani(magazaUrunKdvOrani(kayitlar, sku))` — birebir SKU önce, yoksa
 *    `-D\d{3}` son eki atılmış taban; çelişen ürün kaydı oran UYDURMAZ; küme dışı oran (8, 18) 20 + «varsayılan» imi.
 *  • `degisenAlanlar` «ne değişti»yi alan alan ölçer; `alanlariBirlestir` saklanan diziyi tekilleştirir.
 *  • Silinmiş ölçütü: `silindi` NESNE ise (JSON `null` = geri alınmış → canlı).
 *  • V24 süzgeci: Açık · Kapalı (yalnız teslim) · Silinen / İptal · Hepsi (silinmişler hariç) — dört sayı aynı işlevden.
 *  • Bildirim durumu kümesi DÖRT değerdir ve değişmedi (tip düzeyinde; `@ts-expect-error` yok).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { kaynakDosyalari, kodSatirlari, SRC_KOK, suclular } from '../test/kaynakTarama';
import type { InventoryItem } from '../types';
import { MAGAZA_BILDIRIM_DURUMLARI } from '../server/kanal/magazaBildirimSayim';
import {
  MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS, MAGAZA_DURUM_SUZGECLERI, MAGAZA_KALEM_ANAHTARI_DESENI, MAGAZA_KDV_KAYNAKLARI, MAGAZA_KDV_ORANLARI,
  MAGAZA_KDV_VARSAYILAN_ORANI, MAGAZA_MUSTERI_ALANLARI, MAGAZA_REVIZE_ALANLARI, MAGAZA_TALEP_ASAMALARI, MAGAZA_TEYIT_KALEM_ALANLARI,
  alanlariBirlestir, bildirimGorunumu, degisenAlanlar, magazaAcikMi, magazaKalemAnahtariCoz, magazaKalemAnahtarlari, magazaKalemTeslimMi,
  magazaKdvKaynagiMi, magazaKdvOraniMi, magazaKdvVarsayilani, magazaSilinmisMi, magazaSuzgeceUyar, magazaSuzgecle, magazaSuzgecSayilari,
  magazaTabanSku, magazaTeslimIsaretsiz, magazaTeslimKaynagi, magazaTeyitToplamlari, magazaUrunKdvOrani, magazaYenidenGonderilebilir,
  type MagazaBildirim, type MagazaBildirimDurumu, type MagazaBildirimRevize, type MagazaDurumSuzgeci, type MagazaKdvOrani,
  type MagazaRevizeAlani, type MagazaTalepAsamasi, type MagazaTalepMusteri, type MagazaTeyit, type MagazaTeyitKalemi,
} from './magazaTalep';

/** Tip eşitliği (derleme anı; çalışma anında yalnız `true` sabiti). İki tip birebir aynı değilse atama derlenmez. */
type Esit<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

const kalem = (ek: Partial<MagazaTeyitKalemi> = {}): MagazaTeyitKalemi => ({
  anahtar: 't:0123456789ab', id: 'u1', sku: 'ABC', ad: 'Boya', marka: 'DYO', adet: 2, birimFiyat: 95, kdvOrani: 20, kdvKaynagi: 'urun', tedarik: false, ...ek,
});
const MUSTERI: MagazaTalepMusteri = { ad: 'Şükrü Öztürk', firma: 'Işık Yapı', telefon: '0532 111 22 33', eposta: 'a@b.c', il: 'Antalya', adres: 'Aksu', vergi: '123' };

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('magazaTeyitToplamlari — tam sayı kuruşla, KDV kalem oranıyla (V19)', () => {
  const T = (kalemler: Array<{ adet: number; birimFiyat: number | null; kdvOrani: MagazaKdvOrani }>) => magazaTeyitToplamlari(kalemler);

  it('KULLANICI ÖRNEĞİ: 2 × 95,00 + 1 × 40,00, %20 → ara toplam 230,00 · KDV 46,00 · toplam 276,00', () => {
    expect(T([{ adet: 2, birimFiyat: 95, kdvOrani: 20 }, { adet: 1, birimFiyat: 40, kdvOrani: 20 }])).toEqual({ araToplam: 230, kdv: 46, toplam: 276 });
  });
  it('kalem başına FARKLI oran: 2 × 95,00 (%20) + 1 × 40,00 (%10) → 230,00 · 38,00 + 4,00 = 42,00 · 272,00 (tek orandan DEĞİL)', () => {
    expect(T([{ adet: 2, birimFiyat: 95, kdvOrani: 20 }, { adet: 1, birimFiyat: 40, kdvOrani: 10 }])).toEqual({ araToplam: 230, kdv: 42, toplam: 272 });
  });
  it('herhangi bir `birimFiyat === null` → ÜÇÜ de `null` («fiyat sorulacak»; kısmi toplam YOK, sıfır DEĞİL) — sıra fark etmez', () => {
    const BILINMIYOR = { araToplam: null, kdv: null, toplam: null };
    expect(T([{ adet: 2, birimFiyat: 95, kdvOrani: 20 }, { adet: 1, birimFiyat: null, kdvOrani: 20 }])).toEqual(BILINMIYOR);
    expect(T([{ adet: 1, birimFiyat: null, kdvOrani: 20 }, { adet: 2, birimFiyat: 95, kdvOrani: 20 }])).toEqual(BILINMIYOR);
    expect(T([{ adet: 1, birimFiyat: null, kdvOrani: 0 }])).toEqual(BILINMIYOR);
  });
  it('fiyatı SIFIR olan kalem bilinen fiyattır (0,00), `null` değildir: toplamlar dolu kalır', () => {
    expect(T([{ adet: 3, birimFiyat: 0, kdvOrani: 20 }, { adet: 1, birimFiyat: 40, kdvOrani: 20 }])).toEqual({ araToplam: 40, kdv: 8, toplam: 48 });
  });
  it('`kdvOrani` 0 → KDV 0,00, toplam = ara toplam; %1 → 100,00 için 1,00', () => {
    expect(T([{ adet: 2, birimFiyat: 95, kdvOrani: 0 }])).toEqual({ araToplam: 190, kdv: 0, toplam: 190 });
    expect(T([{ adet: 1, birimFiyat: 100, kdvOrani: 1 }])).toEqual({ araToplam: 100, kdv: 1, toplam: 101 });
  });
  it('kuruş yuvarlaması tam sayıyla KARARLI: 0,015 × 3 → birim 2 kuruş × 3 = 0,06 (kayan nokta toplamı değil); 19,99 × 3 = 59,97; 245,99 × 1', () => {
    expect(T([{ adet: 3, birimFiyat: 0.015, kdvOrani: 0 }])).toEqual({ araToplam: 0.06, kdv: 0, toplam: 0.06 });
    expect(T([{ adet: 3, birimFiyat: 19.99, kdvOrani: 20 }])).toEqual({ araToplam: 59.97, kdv: 11.99, toplam: 71.96 });
    expect(T([{ adet: 1, birimFiyat: 245.99, kdvOrani: 20 }])).toEqual({ araToplam: 245.99, kdv: 49.2, toplam: 295.19 });
    // 0,1 + 0,2 sınıfı: 0,10 × 1 + 0,20 × 1 kayan noktayla 0,30000000000000004 verirdi.
    expect(T([{ adet: 1, birimFiyat: 0.1, kdvOrani: 0 }, { adet: 1, birimFiyat: 0.2, kdvOrani: 0 }])).toEqual({ araToplam: 0.3, kdv: 0, toplam: 0.3 });
    // 1.000 kalem × 0,01: kuruş toplamı tam 10,00.
    expect(T(Array.from({ length: 1000 }, () => ({ adet: 1, birimFiyat: 0.01, kdvOrani: 0 as const }))).araToplam).toBe(10);
  });
  it('(inceleme 2b, bulgu 2) YARIM KURUŞ HER ZAMAN YUKARI: 1,005 → 101 kuruş, 0,145 → 15 kuruş (çarpımın kayan nokta kalıntısı yönü değiştirmez); 95 → 9.500 kuruş aynen', () => {
    const kurus = (birimFiyat: number): number | null => { const t = T([{ adet: 1, birimFiyat, kdvOrani: 0 }]).araToplam; return t === null ? null : Math.round(t * 100); };
    // Kalıntının KENDİSİ (çit boş kümeyi sınamasın): düz çarpım yarımın ALTINDA kalıyor, düz yuvarlama aşağı iniyordu.
    expect(1.005 * 100).toBeLessThan(100.5);
    expect(0.145 * 100).toBeLessThan(14.5);
    expect(kurus(1.005)).toBe(101);
    expect(kurus(0.145)).toBe(15);
    expect(kurus(95)).toBe(9500);
    // Adetle büyüyen fark: 100 × 1,005 → 101,00 (eski 100,00); 1.000 × 0,145 → 150,00 (eski 140,00). KDV satır tutarından.
    expect(T([{ adet: 100, birimFiyat: 1.005, kdvOrani: 20 }])).toEqual({ araToplam: 101, kdv: 20.2, toplam: 121.2 });
    expect(T([{ adet: 1000, birimFiyat: 0.145, kdvOrani: 20 }])).toEqual({ araToplam: 150, kdv: 30, toplam: 180 });
    // Kalıntısız yarımlar ve yarımın altı / üstü değişmedi: 0,155 → 16; 0,125 → 13; 0,015 → 2; 0,014 → 1; 0,0149 → 1; 0,016 → 2.
    expect([0.155, 0.125, 0.015, 0.014, 0.0149, 0.016].map(kurus)).toEqual([16, 13, 2, 1, 1, 2]);
    // GERİLEME: iki ondalıklı her fiyat (0,00 – 2.000,00; 200.001 değer) tam kendi kuruşunu verir — temizlik bilinen fiyatı OYNATMAZ.
    const sapan: number[] = [];
    for (let k = 0; k <= 200_000; k += 1) if (kurus(k / 100) !== k) sapan.push(k);
    expect(sapan).toEqual([]);
    // x,xx5 biçimli fiyatların HEPSİ yukarı: 0,005 – 999,995 arası 100.000 değerde aşağı inen yok.
    const asagi: number[] = [];
    for (let k = 0; k < 100_000; k += 1) if (kurus((k * 10 + 5) / 1000) !== k + 1) asagi.push(k);
    expect(asagi).toEqual([]);
  });
  it('KDV SATIR bazında yuvarlanır: iki satır 0,05 (%10) → 0,5 kuruş + 0,5 kuruş → 1 + 1 = 0,02 (toplam matrahtan tek seferde 0,01 çıkardı)', () => {
    expect(T([{ adet: 1, birimFiyat: 0.05, kdvOrani: 10 }, { adet: 1, birimFiyat: 0.05, kdvOrani: 10 }])).toEqual({ araToplam: 0.1, kdv: 0.02, toplam: 0.12 });
    expect(T([{ adet: 3, birimFiyat: 0.33, kdvOrani: 10 }])).toEqual({ araToplam: 0.99, kdv: 0.1, toplam: 1.09 });
  });
  it('sonlu olmayan fiyat / adet ya da güvenli tam sayıyı aşan tutar → üçü de `null` (yuvarlanmış sahte tutar YAZILMAZ)', () => {
    const BILINMIYOR = { araToplam: null, kdv: null, toplam: null };
    for (const birimFiyat of [Number.NaN, Number.POSITIVE_INFINITY]) expect(T([{ adet: 1, birimFiyat, kdvOrani: 20 }]), String(birimFiyat)).toEqual(BILINMIYOR);
    expect(T([{ adet: Number.NaN, birimFiyat: 1, kdvOrani: 20 }])).toEqual(BILINMIYOR);
    expect(T([{ adet: Number.MAX_SAFE_INTEGER, birimFiyat: 1_000_000, kdvOrani: 20 }])).toEqual(BILINMIYOR);
  });
  it('(inceleme 2b, ikinci tur) BÜYÜK TUTAR KORUMASI — birim fiyat VE satır tutarı: 1e15 kuruşun (10 trilyon TL) altında tutar TAM; 1e15 kuruş ve üstünde üçü de `null` (15 haneye yuvarlanmış kayık kuruş YAZILMAZ)', () => {
    const BILINMIYOR = { araToplam: null, kdv: null, toplam: null };
    // Sınırın çok altı ve hemen altı: kuruş aynen korunur.
    expect(T([{ adet: 999, birimFiyat: 9999999.99, kdvOrani: 20 }])).toEqual({ araToplam: 9989999990.01, kdv: 1997999998, toplam: 11987999988.01 });
    expect(T([{ adet: 1, birimFiyat: 9999999999999.99, kdvOrani: 20 }])).toEqual({ araToplam: 9999999999999.99, kdv: 2000000000000, toplam: 11999999999999.99 });
    // Sınırın kendisi ve üstü: koruma olmasa 12.345.678.901.234,56 → …,60 yazılırdı (`null` üçlüsüne de düşmüyordu).
    expect(T([{ adet: 1, birimFiyat: 1e13, kdvOrani: 20 }])).toEqual(BILINMIYOR);
    expect(T([{ adet: 1, birimFiyat: 12345678901234.56, kdvOrani: 20 }])).toEqual(BILINMIYOR);
    // Birim fiyat sınırın ALTINDA ama adetle çarpılınca SATIR 1e15 kuruşu geçiyor: KDV 1 kuruş kayık yazılırdı — o da `null`.
    expect(T([{ adet: 999, birimFiyat: 62240576744.08, kdvOrani: 20 }])).toEqual(BILINMIYOR);
    expect(T([{ adet: 9, birimFiyat: 7388603806495.66, kdvOrani: 10 }])).toEqual(BILINMIYOR);
  });
  it('kalemsiz liste 0 / 0 / 0 (bilinen boş toplam); girdi dizisi ve kalemler DEĞİŞMEZ; fazladan alan taşıyan teyit kalemi de geçer', () => {
    expect(T([])).toEqual({ araToplam: 0, kdv: 0, toplam: 0 });
    const kalemler = [kalem(), kalem({ anahtar: 't:aaaaaaaaaaaa', adet: 1, birimFiyat: 40 })];
    const kopya = structuredClone(kalemler);
    expect(magazaTeyitToplamlari(kalemler)).toEqual({ araToplam: 230, kdv: 46, toplam: 276 });
    expect(kalemler).toEqual(kopya);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('KDV oranı — küme, varsayılan, ürün kaydından okuma', () => {
  it('`MAGAZA_KDV_ORANLARI` = [0, 1, 10, 20]; varsayılan 20 kümede; kaynak kümesi üç değer', () => {
    expect([...MAGAZA_KDV_ORANLARI]).toEqual([0, 1, 10, 20]);
    expect(MAGAZA_KDV_VARSAYILAN_ORANI).toBe(20);
    expect([...MAGAZA_KDV_KAYNAKLARI]).toEqual(['urun', 'varsayilan', 'personel']);
    const oranTipi: Esit<MagazaKdvOrani, 0 | 1 | 10 | 20> = true;
    expect(oranTipi).toBe(true);
    for (const o of MAGAZA_KDV_ORANLARI) expect(magazaKdvOraniMi(o), String(o)).toBe(true);
    for (const v of [8, 18, 4, 20.5, -1, '20', null, undefined, Number.NaN, [20]]) expect(magazaKdvOraniMi(v), String(v)).toBe(false);
    for (const k of MAGAZA_KDV_KAYNAKLARI) expect(magazaKdvKaynagiMi(k)).toBe(true);
    for (const v of ['Urun', 'elle', '', 1, null, undefined]) expect(magazaKdvKaynagiMi(v), String(v)).toBe(false);
  });
  it('`magazaKdvVarsayilani`: kümedeki sayı → o oran + `urun`; eşleşme yok / null / dizge / küme dışı → 20 + `varsayilan`', () => {
    expect(magazaKdvVarsayilani(10)).toEqual({ kdvOrani: 10, kdvKaynagi: 'urun' });
    expect(magazaKdvVarsayilani(20)).toEqual({ kdvOrani: 20, kdvKaynagi: 'urun' });
    expect(magazaKdvVarsayilani(0)).toEqual({ kdvOrani: 0, kdvKaynagi: 'urun' });
    expect(magazaKdvVarsayilani(1)).toEqual({ kdvOrani: 1, kdvKaynagi: 'urun' });
    for (const v of [undefined, null, '20', '10', 4, 8, 18, 20.5, Number.NaN, {}, [10], true]) {
      expect(magazaKdvVarsayilani(v), String(v)).toEqual({ kdvOrani: 20, kdvKaynagi: 'varsayilan' });
    }
  });
  it('`magazaTabanSku`: yalnız TAM üç rakamlı `-Dnnn` son eki; iki / dört hane, küçük harf, son ek dışında kalan boş → null', () => {
    expect(magazaTabanSku('DEKOR-1325-D002')).toBe('DEKOR-1325');
    expect(magazaTabanSku('A-D001-D002')).toBe('A-D001');
    for (const sku of ['X-D12', 'X-D1234', 'X-d002', 'XD002', 'X-D00A', '-D002', 'DEKOR-1325', '', 'X-D002 ']) expect(magazaTabanSku(sku), sku).toBeNull();
  });
  it('`magazaUrunKdvOrani`: taban eşleme — `DEKOR-1325` (10) kartı `DEKOR-1325-D002` kalemini karşılar', () => {
    expect(magazaUrunKdvOrani([{ sku: 'DEKOR-1325', vatRate: 10 }], 'DEKOR-1325-D002')).toBe(10);
    expect(magazaUrunKdvOrani([{ sku: 'DEKOR-1325', vatRate: 10 }], 'DEKOR-1325')).toBe(10);
  });
  it('`magazaUrunKdvOrani`: BİREBİR kayıt tabandan ÖNCE — birebir (20) ve taban (10) birlikteyken 20; birebirin oranı okunamıyorsa tabana DÜŞÜLMEZ', () => {
    const kayitlar = [{ sku: 'DEKOR-1325', vatRate: 10 }, { sku: 'DEKOR-1325-D002', vatRate: 20 }];
    expect(magazaUrunKdvOrani(kayitlar, 'DEKOR-1325-D002')).toBe(20);
    expect(magazaUrunKdvOrani([{ sku: 'DEKOR-1325', vatRate: 10 }, { sku: 'DEKOR-1325-D002' }], 'DEKOR-1325-D002')).toBeUndefined();
  });
  it('`magazaUrunKdvOrani`: aynı SKU iki kayıt FARKLI oran → undefined (oran uydurulmaz); aynı oran → o oran; oranı okunamayan kayıt çelişki sayılmaz', () => {
    expect(magazaUrunKdvOrani([{ sku: 'X', vatRate: 10 }, { sku: 'X', vatRate: 20 }], 'X')).toBeUndefined();
    expect(magazaUrunKdvOrani([{ sku: 'X', vatRate: 20 }, { sku: 'X', vatRate: 10 }], 'X')).toBeUndefined();
    expect(magazaUrunKdvOrani([{ sku: 'X', vatRate: 10 }, { sku: 'X', vatRate: 10 }], 'X')).toBe(10);
    expect(magazaUrunKdvOrani([{ sku: 'X', vatRate: 10 }, { sku: 'X' }, { sku: 'X', vatRate: null }], 'X')).toBe(10);
    // Taban kümesinde de aynı kural.
    expect(magazaUrunKdvOrani([{ sku: 'X', vatRate: 10 }, { sku: 'X', vatRate: 1 }], 'X-D005')).toBeUndefined();
  });
  it('`magazaUrunKdvOrani`: `vatRate` dizge / undefined / null / NaN ya da alan HİÇ yok → undefined; eşleşen kayıt yok → undefined', () => {
    for (const vatRate of ['10', undefined, null, Number.NaN, Number.POSITIVE_INFINITY, {}, true]) expect(magazaUrunKdvOrani([{ sku: 'X', vatRate }], 'X'), String(vatRate)).toBeUndefined();
    expect(magazaUrunKdvOrani([{ sku: 'X' }], 'X')).toBeUndefined();
    expect(magazaUrunKdvOrani([], 'X')).toBeUndefined();
    expect(magazaUrunKdvOrani([{ sku: 'Y', vatRate: 10 }], 'X')).toBeUndefined();
  });
  it('`magazaUrunKdvOrani`: boş SKU → undefined (boş SKU\'lu kartla EŞLEŞMEZ); `-D12` / `-D1234` son ek sayılmaz; büyütme / kırpma YOK', () => {
    expect(magazaUrunKdvOrani([{ sku: '', vatRate: 10 }], '')).toBeUndefined();
    expect(magazaUrunKdvOrani([{ sku: 'X', vatRate: 10 }], 'X-D12')).toBeUndefined();
    expect(magazaUrunKdvOrani([{ sku: 'X', vatRate: 10 }], 'X-D1234')).toBeUndefined();
    expect(magazaUrunKdvOrani([{ sku: 'DEKOR-1325', vatRate: 10 }], 'dekor-1325')).toBeUndefined();
    expect(magazaUrunKdvOrani([{ sku: 'DEKOR-1325', vatRate: 10 }], ' DEKOR-1325')).toBeUndefined();
    expect(magazaUrunKdvOrani([{ sku: 'DEKOR-1325 ', vatRate: 10 }], 'DEKOR-1325')).toBeUndefined();
  });
  it('`magazaUrunKdvOrani` küme dışı oranı da AYNEN döner (18) — kümeye indirgeme `magazaKdvVarsayilani`\'nin işi: zincir 20 + `varsayilan` verir', () => {
    expect(magazaUrunKdvOrani([{ sku: 'X', vatRate: 18 }], 'X')).toBe(18);
    expect(magazaKdvVarsayilani(magazaUrunKdvOrani([{ sku: 'X', vatRate: 18 }], 'X'))).toEqual({ kdvOrani: 20, kdvKaynagi: 'varsayilan' });
    expect(magazaKdvVarsayilani(magazaUrunKdvOrani([{ sku: 'X', vatRate: 10 }], 'X-D003'))).toEqual({ kdvOrani: 10, kdvKaynagi: 'urun' });
    expect(magazaKdvVarsayilani(magazaUrunKdvOrani([{ sku: 'X', vatRate: 10 }, { sku: 'X', vatRate: 20 }], 'X'))).toEqual({ kdvOrani: 20, kdvKaynagi: 'varsayilan' });
  });
  it('TİP ÇİTİ (kapı 4, Y4): `InventoryItem[]` daraltma / eşleme kopyası / `as` olmadan DOĞRUDAN geçer (`vatRate` tipte yok — dizin imzasından okunur)', () => {
    const envanter: InventoryItem[] = [
      { id: '1', sku: 'ABC', name: 'Boya', stockLevel: 1, lowStockThreshold: 0, prices: {}, costPrice: 0, vatRate: 10 },
      { id: '2', sku: 'DEF', name: 'Fırça', stockLevel: 1, lowStockThreshold: 0, prices: {}, costPrice: 0 },
    ];
    // Aşağıdaki iki çağrı derleniyorsa çit tutuyordur (imza `vatRate?: unknown`; zorunlu olsaydı TS2345 verirdi).
    expect(magazaUrunKdvOrani(envanter, 'ABC')).toBe(10);
    expect(magazaUrunKdvOrani(envanter, 'DEF')).toBeUndefined();
    const salt: ReadonlyArray<InventoryItem> = envanter;
    expect(magazaUrunKdvOrani(salt, 'ABC-D012')).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('degisenAlanlar — «ne değişti» sunucuda ölçülür (kapı 3, K13)', () => {
  const KALEMLER = [kalem(), kalem({ anahtar: 't:aaaaaaaaaaaa', sku: 'DEF', adet: 1, birimFiyat: 40 })];
  const ESKI = { musteri: { ...MUSTERI }, not: 'eski not', teyit: { kalemler: structuredClone(KALEMLER), zaman: 'z1', kim: { uid: 'u1', ad: 'A' }, araToplam: 230, kdv: 46, toplam: 276 } };

  it('hiçbiri değişmedi (tam gövde) → []; verilmeyen alan karşılaştırılmaz', () => {
    expect(degisenAlanlar(ESKI, { musteri: { ...MUSTERI }, not: 'eski not', teyit: { kalemler: structuredClone(KALEMLER) } })).toEqual([]);
    expect(degisenAlanlar(ESKI, {})).toEqual([]);
    expect(degisenAlanlar(ESKI, { not: 'eski not' })).toEqual([]);
    // Verilmeyen alanın eskisi ne olursa olsun listeye girmez.
    expect(degisenAlanlar({ musteri: 'çöp', not: 7, teyit: null }, {})).toEqual([]);
  });
  it('müşteri: yedi alanın yedisi eşitse YOK; herhangi TEK alan farklıysa VAR (yedi alanın her biri için)', () => {
    expect([...MAGAZA_MUSTERI_ALANLARI]).toEqual(['ad', 'firma', 'telefon', 'eposta', 'il', 'adres', 'vergi']);
    for (const alan of MAGAZA_MUSTERI_ALANLARI) {
      expect(degisenAlanlar(ESKI, { musteri: { ...MUSTERI, [alan]: `${MUSTERI[alan]} x` } }), alan).toEqual(['musteri']);
    }
    expect(degisenAlanlar(ESKI, { musteri: { ...MUSTERI } })).toEqual([]);
    // Eski kayıtta fazladan alan olması fark DEĞİLDİR (yalnız yedi alan ölçülür); eksik alan farktır.
    expect(degisenAlanlar({ ...ESKI, musteri: { ...MUSTERI, eskiAlan: 1 } }, { musteri: { ...MUSTERI } })).toEqual([]);
    const { vergi: _vergi, ...eksik } = MUSTERI;
    expect(degisenAlanlar({ ...ESKI, musteri: eksik }, { musteri: { ...MUSTERI } })).toEqual(['musteri']);
  });
  it('not: metin eşitse YOK; farklıysa VAR; yalnız `not` değişince `[\'not\']` (gövdede `musteri` ve `teyit` de gönderilmiş olsa bile)', () => {
    expect(degisenAlanlar(ESKI, { not: 'yeni not' })).toEqual(['not']);
    expect(degisenAlanlar(ESKI, { musteri: { ...MUSTERI }, not: 'yeni not', teyit: { kalemler: structuredClone(KALEMLER) } })).toEqual(['not']);
    expect(degisenAlanlar(ESKI, { not: '' })).toEqual(['not']);
    expect(degisenAlanlar({ ...ESKI, not: '' }, { not: '' })).toEqual([]);
  });
  it('teyit: kalemin HER alanı ölçülür (adet, fiyat, KDV oranı, KDV kaynağı, anahtar, id, sku, ad, marka, tedarik)', () => {
    expect([...MAGAZA_TEYIT_KALEM_ALANLARI]).toEqual(['anahtar', 'id', 'sku', 'ad', 'marka', 'adet', 'birimFiyat', 'kdvOrani', 'kdvKaynagi', 'tedarik']);
    const degisik: Record<typeof MAGAZA_TEYIT_KALEM_ALANLARI[number], Partial<MagazaTeyitKalemi>> = {
      anahtar: { anahtar: 't:ffffffffffff' }, id: { id: 'u9' }, sku: { sku: 'ZZZ' }, ad: { ad: 'Başka' }, marka: { marka: 'Marshall' }, adet: { adet: 3 },
      birimFiyat: { birimFiyat: 96 }, kdvOrani: { kdvOrani: 10 }, kdvKaynagi: { kdvKaynagi: 'personel' }, tedarik: { tedarik: true },
    };
    for (const alan of MAGAZA_TEYIT_KALEM_ALANLARI) {
      const yeni = [{ ...KALEMLER[0], ...degisik[alan] }, KALEMLER[1]];
      expect(degisenAlanlar(ESKI, { teyit: { kalemler: yeni } }), alan).toEqual(['teyit']);
    }
    // Fiyatın `null`'a («fiyat sorulacak») dönmesi de farktır; `null` → `null` fark değildir.
    expect(degisenAlanlar(ESKI, { teyit: { kalemler: [{ ...KALEMLER[0], birimFiyat: null }, KALEMLER[1]] } })).toEqual(['teyit']);
    const fiyatsiz = [{ ...KALEMLER[0], birimFiyat: null }];
    expect(degisenAlanlar({ teyit: { kalemler: structuredClone(fiyatsiz) } }, { teyit: { kalemler: fiyatsiz } })).toEqual([]);
  });
  it('teyit: kalem SIRASI değişince VAR; kalem eklenince / silinince VAR; `zaman` / `kim` / toplam farkı YOK sayılır', () => {
    expect(degisenAlanlar(ESKI, { teyit: { kalemler: [KALEMLER[1], KALEMLER[0]] } })).toEqual(['teyit']);
    expect(degisenAlanlar(ESKI, { teyit: { kalemler: [KALEMLER[0]] } })).toEqual(['teyit']);
    expect(degisenAlanlar(ESKI, { teyit: { kalemler: [...KALEMLER, kalem({ anahtar: 't:bbbbbbbbbbbb' })] } })).toEqual(['teyit']);
    const baskaKisi = { ...ESKI, teyit: { ...ESKI.teyit, zaman: 'z9', kim: { uid: 'u9', ad: 'Başkası' }, toplam: 1 } };
    expect(degisenAlanlar(baskaKisi, { teyit: { kalemler: structuredClone(KALEMLER) } })).toEqual([]);
  });
  it('eski değer beklenen biçimde değilse (yok / null / dizge / dizi / çöp kalem) alan DEĞİŞMİŞ sayılır; fırlatmaz', () => {
    for (const eski of [undefined, null, 'çöp', 7, [], [MUSTERI]]) expect(degisenAlanlar({ musteri: eski }, { musteri: MUSTERI }), String(eski)).toEqual(['musteri']);
    for (const eski of [undefined, null, 7, ['eski not']]) expect(degisenAlanlar({ not: eski }, { not: 'eski not' }), String(eski)).toEqual(['not']);
    for (const eski of [undefined, null, 'çöp', { kalemler: null }, { kalemler: 'çöp' }, { kalemler: [null, null] }, { kalemler: ['a', 'b'] }, KALEMLER]) {
      expect(degisenAlanlar({ teyit: eski }, { teyit: { kalemler: KALEMLER } }), JSON.stringify(eski)).toEqual(['teyit']);
    }
  });
  it('sıra sabit (`musteri`, `not`, `teyit`); girdiler DEĞİŞMEZ', () => {
    const eski = structuredClone(ESKI);
    const yeni = { teyit: { kalemler: [KALEMLER[1]] }, not: 'x', musteri: { ...MUSTERI, il: 'İzmir' } };
    const yeniKopya = structuredClone(yeni);
    expect(degisenAlanlar(eski, yeni)).toEqual(['musteri', 'not', 'teyit']);
    expect(eski).toEqual(ESKI);
    expect(yeni).toEqual(yeniKopya);
    expect([...MAGAZA_REVIZE_ALANLARI]).toEqual(['musteri', 'not', 'teyit']);
  });
});

describe('alanlariBirlestir — saklanan `bildirimRevize.alanlar`\'ın okunuşu (kapı 3, K9)', () => {
  it('küme birleşimi, İLK görülme sırası: [not, teyit, not] → [not, teyit]; [not, not] → [not]', () => {
    expect(alanlariBirlestir(['not', 'teyit', 'not'])).toEqual(['not', 'teyit']);
    expect(alanlariBirlestir(['not', 'not'])).toEqual(['not']);
    expect(alanlariBirlestir(['teyit', 'musteri', 'teyit', 'not', 'musteri'])).toEqual(['teyit', 'musteri', 'not']);
    expect(alanlariBirlestir([])).toEqual([]);
  });
  it('bilinmeyen ad düşer (dizge olmayan eleman dâhil); dizi değilse []', () => {
    expect(alanlariBirlestir(['not', 'fiyat', 'MUSTERI', '', 7, null, ['teyit'], { ad: 'not' }, 'teyit'])).toEqual(['not', 'teyit']);
    for (const v of [undefined, null, 'not', 7, { 0: 'not', length: 1 }, true]) expect(alanlariBirlestir(v), String(v)).toEqual([]);
  });
  it('dönen dizi YENİ dizidir (saklanan değişmez) ve tipi `MagazaRevizeAlani[]`', () => {
    const saklanan = ['not', 'not'];
    const sonuc: MagazaRevizeAlani[] = alanlariBirlestir(saklanan);
    sonuc.push('teyit');
    expect(saklanan).toEqual(['not', 'not']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('magazaSilinmisMi — `silindi` NESNE ise silinmiş (V17)', () => {
  it('nesne → true; `null` (geri alınmış) / yok → false; dizi / dizge / sayı / `true` → false (SQL `jsonb_typeof(…) = \'object\'` ile aynı)', () => {
    expect(magazaSilinmisMi({ silindi: { zaman: 'z', kim: { uid: 'u', ad: 'A' }, kanal: 'erp' } })).toBe(true);
    expect(magazaSilinmisMi({ silindi: {} })).toBe(true);
    expect(magazaSilinmisMi({ silindi: null })).toBe(false);
    expect(magazaSilinmisMi({})).toBe(false);
    for (const silindi of [undefined, [], [{}], 'evet', 1, true]) expect(magazaSilinmisMi({ silindi }), String(silindi)).toBe(false);
  });
});

describe('kalem anahtarı ve teslim kaynağı — teyit dalı (2b\'de canlanır)', () => {
  it('`magazaKalemAnahtariCoz`: `b:<dizin>` → beyan + dizin; `t:…` → teyit; desene uymayan → null (ikinci desen yok)', () => {
    expect(magazaKalemAnahtariCoz('b:0')).toEqual({ kaynak: 'beyan', dizin: 0 });
    expect(magazaKalemAnahtariCoz('b:12')).toEqual({ kaynak: 'beyan', dizin: 12 });
    expect(magazaKalemAnahtariCoz('b:9999')).toEqual({ kaynak: 'beyan', dizin: 9999 });
    expect(magazaKalemAnahtariCoz('t:0123456789ab')).toEqual({ kaynak: 'teyit' });
    for (const a of ['b:01', 'b:001', 'b:10000', 'b:', 'b:-1', 't:0123456789AB', 't:0123456789a', 't:0123456789abc', 'c:0', '', ' b:0', 'b:0 ', 'hepsi']) {
      expect(magazaKalemAnahtariCoz(a), a).toBeNull();
      expect(MAGAZA_KALEM_ANAHTARI_DESENI.test(a), a).toBe(false);
    }
  });
  it('gerçek `MagazaTeyit` nesnesiyle: kaynak `teyit`, anahtarlar teyit kalemlerinin sırasıyla; işaretsiz sayımı teyit kalemlerinden (beyan işareti SAYILMAZ)', () => {
    const teyit: MagazaTeyit = {
      kalemler: [kalem({ anahtar: 't:bbbbbbbbbbbb' }), kalem({ anahtar: 't:aaaaaaaaaaaa' }), kalem({ anahtar: 't:cccccccccccc' })],
      araToplam: 570, kdv: 114, toplam: 684, zaman: '2026-10-10T08:00:00.000Z', kim: { uid: 'u', ad: 'A' },
    };
    const giris = { durum: 'teslim', zaman: '2026-10-10T09:00:00.000Z', kim: { uid: 'u', ad: 'A' } };
    const t = { kalemler: [{}, {}], teyit, kalemTeslim: { 'b:0': giris, 'b:1': giris, 't:aaaaaaaaaaaa': giris } };
    expect(magazaTeslimKaynagi(t)).toBe('teyit');
    expect(magazaKalemAnahtarlari(t)).toEqual(['t:bbbbbbbbbbbb', 't:aaaaaaaaaaaa', 't:cccccccccccc']);
    expect(magazaTeslimIsaretsiz(t)).toBe(2);
    expect(magazaKalemTeslimMi(t.kalemTeslim, 't:aaaaaaaaaaaa')).toBe(true);
    expect(magazaKalemTeslimMi(t.kalemTeslim, 't:bbbbbbbbbbbb')).toBe(false);
    // Teyit kalemleri boş dizi / teyit yok → kaynak yine beyan (2a davranışı).
    expect(magazaTeslimKaynagi({ kalemler: [{}, {}], teyit: { ...teyit, kalemler: [] } })).toBe('beyan');
    expect(magazaTeslimIsaretsiz({ kalemler: [{}, {}], kalemTeslim: t.kalemTeslim })).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('magazaSuzgecle — «Silinen / İptal» sekmesi (V24; «silinenleri gizle» onay kutusunun YERİNE)', () => {
  const SILINDI = { zaman: 'z', kim: { uid: 'u', ad: 'A' }, kanal: 'erp' };
  interface S { ad: string; durum: MagazaTalepAsamasi | null; silindi?: unknown }
  const acik: S = { ad: 'açık', durum: 'hazirlaniyor' };
  const teslim: S = { ad: 'teslim', durum: 'teslim' };
  const iptal: S = { ad: 'iptal', durum: 'iptal' };
  const silinmisAcik: S = { ad: 'silinmiş-açık', durum: 'yeni', silindi: SILINDI };
  const silinmisIptal: S = { ad: 'silinmiş-iptal', durum: 'iptal', silindi: SILINDI };
  const bilinmeyen: S = { ad: 'bilinmeyen aşama', durum: null };
  const HEPSI: S[] = [acik, teslim, iptal, silinmisAcik, silinmisIptal, bilinmeyen];
  const adlar = (suzgec: MagazaDurumSuzgeci): string[] => magazaSuzgecle(HEPSI, suzgec).map(t => t.ad);

  it('dört süzgeç, ekran sırasıyla: Açık · Kapalı · Silinen / İptal · Hepsi', () => {
    expect([...MAGAZA_DURUM_SUZGECLERI]).toEqual(['acik', 'kapali', 'silinenIptal', 'hepsi']);
    const tip: Esit<MagazaDurumSuzgeci, 'acik' | 'kapali' | 'silinenIptal' | 'hepsi'> = true;
    expect(tip).toBe(true);
  });
  it('4 süzgeç × 6 satır (açık, teslim, iptal, silinmiş-açık, silinmiş-iptal, bilinmeyen aşama) — tablo', () => {
    const TABLO: Record<MagazaDurumSuzgeci, Record<string, boolean>> = {
      //              açık           teslim           iptal           silinmiş-açık           silinmiş-iptal           bilinmeyen aşama
      acik:         { 'açık': true,  'teslim': false, 'iptal': false, 'silinmiş-açık': false, 'silinmiş-iptal': false, 'bilinmeyen aşama': true },
      kapali:       { 'açık': false, 'teslim': true,  'iptal': false, 'silinmiş-açık': false, 'silinmiş-iptal': false, 'bilinmeyen aşama': false },
      silinenIptal: { 'açık': false, 'teslim': false, 'iptal': true,  'silinmiş-açık': true,  'silinmiş-iptal': true,  'bilinmeyen aşama': false },
      hepsi:        { 'açık': true,  'teslim': true,  'iptal': true,  'silinmiş-açık': false, 'silinmiş-iptal': false, 'bilinmeyen aşama': true },
    };
    for (const suzgec of MAGAZA_DURUM_SUZGECLERI) {
      for (const t of HEPSI) expect(magazaSuzgeceUyar(t, suzgec), `${suzgec} × ${t.ad}`).toBe(TABLO[suzgec][t.ad]);
    }
  });
  it('Açık = silinmemiş VE açık aşama (aşaması okunamayan satır AÇIKTIR, kaybolmaz); silinmiş açık talep Açık\'ta YOK', () => {
    expect(adlar('acik')).toEqual(['açık', 'bilinmeyen aşama']);
    for (const durum of MAGAZA_TALEP_ASAMALARI) {
      expect(magazaSuzgeceUyar({ durum }, 'acik'), durum).toBe(magazaAcikMi(durum));
      expect(magazaSuzgeceUyar({ durum, silindi: SILINDI }, 'acik'), durum).toBe(false);
    }
  });
  it('Kapalı = silinmemiş VE `teslim` — `iptal` artık BURADA DEĞİL (2a\'da «Kapalı» teslim + iptal idi; bilerek değişen davranış)', () => {
    expect(adlar('kapali')).toEqual(['teslim']);
    expect(magazaSuzgeceUyar(iptal, 'kapali')).toBe(false);
    expect(magazaSuzgeceUyar({ durum: 'teslim', silindi: SILINDI }, 'kapali')).toBe(false);
  });
  it('Silinen / İptal = silinmiş YA DA iptal; silinmiş + iptal TEK satırdır (bir kez); silinmiş teslim de burada', () => {
    expect(adlar('silinenIptal')).toEqual(['iptal', 'silinmiş-açık', 'silinmiş-iptal']);
    expect(magazaSuzgeceUyar({ durum: 'teslim', silindi: SILINDI }, 'silinenIptal')).toBe(true);
    expect(magazaSuzgeceUyar({ durum: null, silindi: SILINDI }, 'silinenIptal')).toBe(true);
  });
  it('Hepsi = silinmemişlerin tamamı (açık + teslim + iptal); silinmişler «Hepsi»de GÖRÜNMEZ', () => {
    expect(adlar('hepsi')).toEqual(['açık', 'teslim', 'iptal', 'bilinmeyen aşama']);
  });
  it('geri alınmış talep (`silindi: null`) silinmemiştir: Açık / Hepsi\'de görünür, «Silinen / İptal»de görünmez', () => {
    const geriAlinmis = { durum: 'sevk' as const, silindi: null };
    expect(magazaSuzgeceUyar(geriAlinmis, 'acik')).toBe(true);
    expect(magazaSuzgeceUyar(geriAlinmis, 'hepsi')).toBe(true);
    expect(magazaSuzgeceUyar(geriAlinmis, 'silinenIptal')).toBe(false);
  });
  it('dört sayı AYNI işlevden ve tutarlı: Açık + Kapalı + (iptal ama silinmemiş) = Hepsi; her sayı `magazaSuzgecle(…).length`', () => {
    const sayilar = magazaSuzgecSayilari(HEPSI);
    expect(sayilar).toEqual({ acik: 2, kapali: 1, silinenIptal: 3, hepsi: 4 });
    for (const suzgec of MAGAZA_DURUM_SUZGECLERI) expect(sayilar[suzgec], suzgec).toBe(magazaSuzgecle(HEPSI, suzgec).length);
    const iptalAmaSilinmemis = HEPSI.filter(t => t.durum === 'iptal' && !magazaSilinmisMi(t)).length;
    expect(sayilar.acik + sayilar.kapali + iptalAmaSilinmemis).toBe(sayilar.hepsi);
    // Her satır Hepsi ile «Silinen / İptal»in BİRLEŞİMİNDEDİR (hiçbir satır dört düğmenin dışında kalmaz).
    for (const t of HEPSI) expect(magazaSuzgeceUyar(t, 'hepsi') || magazaSuzgeceUyar(t, 'silinenIptal'), t.ad).toBe(true);
    expect(magazaSuzgecSayilari([])).toEqual({ acik: 0, kapali: 0, silinenIptal: 0, hepsi: 0 });
  });
  it('sıra korunur, girdi dizisi değişmez, dönen dizi YENİ dizidir; satır tipi taşınır (ek alanlar kaybolmaz)', () => {
    const girdi = [...HEPSI];
    const sonuc = magazaSuzgecle(girdi, 'hepsi');
    expect(girdi).toEqual(HEPSI);
    expect(sonuc).not.toBe(girdi);
    expect(sonuc[0]).toBe(acik);
    const ilkAd: string = sonuc[0].ad;   // `T` korunur: derleme çiti
    expect(ilkAd).toBe('açık');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('revize bildirimi rozeti — `bildirimGorunumu(t.bildirimRevize, t.icerikZamani, simdi)` (K17, Y2)', () => {
  const SIMDI = Date.parse('2026-10-10T12:00:00.000Z');
  const once = (dakika: number): string => new Date(SIMDI - dakika * 60_000).toISOString();
  const revize = (ek: Partial<MagazaBildirimRevize> = {}): MagazaBildirimRevize => ({
    durum: 'bekliyor', zaman: once(1), alanlar: ['not'], kim: { uid: 'u', ad: 'A' }, icerikSurum: 3, ...ek,
  });

  it('`MagazaBildirimRevize` ortak `MagazaBildirim` tipini GENİŞLETİR: aynı işleve daraltmasız geçer (kopya rozet işlevi yok)', () => {
    const b: MagazaBildirim = revize();
    expect(bildirimGorunumu(b, once(1), SIMDI)).toEqual({ tur: 'gonderiliyor' });
    const genisler: MagazaBildirimRevize extends MagazaBildirim ? true : false = true;
    expect(genisler).toBe(true);
  });
  it('başlangıç `max(icerikZamani, bildirimRevize.zaman)`: sınır + 1 ms sonra «bekleme aşıldı»; tam sınırda hâlâ «gönderiliyor»', () => {
    const z = once(0);
    expect(bildirimGorunumu(revize({ zaman: z }), z, SIMDI + MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS)).toEqual({ tur: 'gonderiliyor' });
    expect(bildirimGorunumu(revize({ zaman: z }), z, SIMDI + MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS + 1)).toEqual({ tur: 'uyari', neden: 'bekleme-asildi' });
  });
  it('`icerikZamani` eski + `zaman` yeni → başlangıç BÜYÜK olan (`zaman`): günler önceki revizyonun elle yeniden gönderimi taze «gönderiliyor»', () => {
    expect(bildirimGorunumu(revize({ zaman: once(2) }), once(3 * 24 * 60), SIMDI)).toEqual({ tur: 'gonderiliyor' });
    // Tersi: `icerikZamani` yeni + `zaman` eski → yine büyük olan (`icerikZamani`).
    expect(bildirimGorunumu(revize({ zaman: once(3 * 24 * 60) }), once(2), SIMDI)).toEqual({ tur: 'gonderiliyor' });
    // İkisi de eski → bekleme aşıldı.
    expect(bildirimGorunumu(revize({ zaman: once(30) }), once(40), SIMDI)).toEqual({ tur: 'uyari', neden: 'bekleme-asildi' });
  });
  it('`zaman` çözülmüyorsa `icerikZamani`; `icerikZamani` çözülmüyorsa `zaman`; ikisi de çözülmüyorsa `okunamadi`', () => {
    expect(bildirimGorunumu(revize({ zaman: 'çöp' }), once(2), SIMDI)).toEqual({ tur: 'gonderiliyor' });
    expect(bildirimGorunumu(revize({ zaman: 'çöp' }), once(30), SIMDI)).toEqual({ tur: 'uyari', neden: 'bekleme-asildi' });
    expect(bildirimGorunumu(revize({ zaman: once(2) }), undefined, SIMDI)).toEqual({ tur: 'gonderiliyor' });
    expect(bildirimGorunumu(revize({ zaman: 'çöp' }), undefined, SIMDI)).toEqual({ tur: 'uyari', neden: 'okunamadi' });
    expect(bildirimGorunumu(revize({ zaman: 'çöp' }), '1', SIMDI)).toEqual({ tur: 'uyari', neden: 'okunamadi' });
  });
  it('dört hâl + «Yeniden gönder» görünürlüğü: gonderilemedi / yapilandirilmamis / bekleme aşılmış → VAR; gitti / taze bekliyor / okunamadı → YOK', () => {
    const gorunur = (b: MagazaBildirimRevize | null, taban: string | undefined): boolean => magazaYenidenGonderilebilir(bildirimGorunumu(b, taban, SIMDI));
    expect(gorunur(revize({ durum: 'gonderilemedi', deneme: 8, hataSinifi: 'baglanti' }), once(1))).toBe(true);
    expect(gorunur(revize({ durum: 'yapilandirilmamis' }), once(1))).toBe(true);
    expect(gorunur(revize({ zaman: once(30) }), once(40))).toBe(true);
    expect(gorunur(revize({ durum: 'gitti' }), once(40))).toBe(false);
    expect(gorunur(revize(), once(1))).toBe(false);
    expect(gorunur(revize({ zaman: 'çöp' }), undefined)).toBe(false);
    // `null` → `okunamadi` (ilk bildirim dalı); revize rozetini çizen bileşen `null`'da işlevi ÇAĞIRMAZ — o kural bileşen testindedir.
    expect(bildirimGorunumu(null, once(1), SIMDI)).toEqual({ tur: 'uyari', neden: 'okunamadi' });
    expect(gorunur(null, once(1))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('bildirim durumu kümesi DEĞİŞMEDİ — dört değer (kapı 3, K1; madde 8)', () => {
  it('tip düzeyinde tam DÖRT değer; çalışma zamanı dizisi (`MAGAZA_BILDIRIM_DURUMLARI`) aynı küme', () => {
    const dortDeger: Esit<MagazaBildirimDurumu, 'bekliyor' | 'gitti' | 'gonderilemedi' | 'yapilandirilmamis'> = true;
    expect(dortDeger).toBe(true);
    const diziTipi: Esit<typeof MAGAZA_BILDIRIM_DURUMLARI[number], MagazaBildirimDurumu> = true;
    expect(diziTipi).toBe(true);
    const revizeDurumu: Esit<MagazaBildirimRevize['durum'], MagazaBildirimDurumu> = true;
    expect(revizeDurumu).toBe(true);
    expect([...MAGAZA_BILDIRIM_DURUMLARI].sort()).toEqual(['bekliyor', 'gitti', 'gonderilemedi', 'yapilandirilmamis']);
  });
  it('v3\'ün kaldırılan beşinci değeri `src/` üretim kodunda HİÇBİR dosyada yok (yorum hariç; dizge burada parçalardan kurulur)', () => {
    const kaldirilan = ['gerek', 'miyor'].join('');
    const desen = new RegExp(kaldirilan);
    expect(suclular(kaynakDosyalari(SRC_KOK), desen)).toEqual([]);
    expect(suclular([join(SRC_KOK, '..', 'server.ts')], desen)).toEqual([]);
  }, 60_000);   // `src/`in tamamı tek testte taranır: yük altında 5 sn'lik varsayılan süre yetmez (depo kalıbı)
});

describe('kaynak çitleri — src/lib/magazaTalep.ts (2b)', () => {
  const DOSYA = join(SRC_KOK, 'lib', 'magazaTalep.ts');
  const satirlar = kodSatirlari(DOSYA).map(s => s.kod);
  const kod = satirlar.join('\n');

  it('yaprak modül: hiçbir şey içe aktarmaz (sunucu ve istemci döngüsüz okur)', () => {
    expect(kod).not.toMatch(/^\s*import\s/m);
    expect(kod).not.toMatch(/\brequire\(|\bimport\(/);
  });
  it('KDV oranı kümesinin TEK tanımı burada: mağaza yolunda (sunucu, sipariş bileşenleri, kancalar) başka `[0, 1, 10, 20]` literali yok', () => {
    const LITERAL = /\[\s*0\s*,\s*1\s*,\s*10\s*,\s*20\s*\]/;
    expect(satirlar.filter(s => LITERAL.test(s))).toEqual(['export const MAGAZA_KDV_ORANLARI = [0, 1, 10, 20] as const;']);
    const kapsam = [
      ...kaynakDosyalari(join(SRC_KOK, 'server')), ...kaynakDosyalari(join(SRC_KOK, 'components', 'siparis')), ...kaynakDosyalari(join(SRC_KOK, 'hooks')),
    ];
    expect(kapsam.length).toBeGreaterThan(20);
    expect(suclular(kapsam, LITERAL)).toEqual([]);
  });
  it('para ve sayı: sessiz varsayılan yok (`?? 0` / `|| 0`); global `isFinite` yok; Türkçe harfe dokunan dönüşüm yok', () => {
    expect(kod).not.toMatch(/(\?\?|\|\|)\s*0\b/);
    expect(kod).not.toMatch(/(^|[^.\w])isFinite\(/);
    expect(kod).not.toMatch(/toUpperCase|toLowerCase|toLocaleUpperCase|toLocaleLowerCase/);
    expect(kod).not.toMatch(/\bas any\b|@ts-ignore|@ts-expect-error/);
  });
  it('toplam formülü TEK yerde: `Math.round(` yalnız `magazaTeyitToplamlari` içinde, iki kez (satır kuruşu + satır KDV kuruşu)', () => {
    const bas = satirlar.findIndex(s => s.startsWith('export function magazaTeyitToplamlari('));
    const son = satirlar.findIndex((s, i) => i > bas && s === '}');
    expect(bas).toBeGreaterThan(-1);
    expect(son).toBeGreaterThan(bas);
    const govde = satirlar.slice(bas, son + 1).join('\n');
    expect(govde.match(/Math\.round\(/g)).toHaveLength(2);
    expect(kod.match(/Math\.round\(/g)).toHaveLength(2);
    // (İnceleme 2b, bulgu 2 — bilerek değişen çit) birim kuruşu: çarpımın kalıntısı 15 anlamlı haneyle temizlenip yuvarlanır.
    // (Kuruş kararı 2026-10-17, B1 — bilerek değişen çit) temizlik TEK yardımcıda (`temizKurus`); kuruş denetimi
    // (`magazaKurusluMu`) AYNI adımı paylaşır — iki ayrı `toPrecision` yazımı ayrışabilirdi.
    expect(govde).toContain('Math.round(temizKurus(k.birimFiyat)) * k.adet');
    expect(govde).not.toContain('Math.round(k.birimFiyat * 100)');
    expect(kod.match(/toPrecision\(/g)).toHaveLength(1);
    expect(satirlar).toContain('  return Number((fiyat * 100).toPrecision(15));');
    const kBas = satirlar.findIndex(s => s.startsWith('export function magazaKurusluMu('));
    const kSon = satirlar.findIndex((s, i) => i > kBas && s === '}');
    expect(kBas).toBeGreaterThan(-1);
    expect(satirlar.slice(kBas, kSon + 1).join('\n')).toContain('Number.isInteger(temizKurus(n))');
    expect(govde).toContain('Math.round(satirKurus * k.kdvOrani / 100)');
  });
});
