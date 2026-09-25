/**
 * stokSevkiyat.test.ts — Pano (DashboardPage) stok + sevkiyat panellerinin sözleşmesi
 * (Faz 3 5/n, 2026-09-19). ÖNCE YAZILDI (kırmızı görüldü, sonra modül yazıldı).
 *
 * Sayfadaki sahte kesinlik siteleri (src/pages/DashboardPage.tsx, 2026-09-19 ölçümü):
 *   1707 `(i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5)` → stoğu BİLİNMEYEN kalem 0 sayılıp
 *        "düşük stok" uyarısına düşüyor; eşiği olmayan kalem uydurma 5 ile kıyaslanıyor.
 *   1727 `${i.stockLevel ?? 0} / ${i.lowStockThreshold ?? 5}` → ekranda "0 / 5" (bilinmiyor değil).
 *   1848 `itemCostTRY(i, rates) * (i.stockLevel ?? 0)` → stoğu bilinmeyen kalem ₺0 değerli.
 *   1849 `(i.prices?.['Retail'] ?? i.price ?? 0) * (i.stockLevel ?? 0)` → fiyatı bilinmeyen kalem ₺0.
 *   1850 `retailValue > 0 ? Math.round(...) : 0` → marj TÜRETİLEN sayı; girdiler eksikken "%0" basıyor.
 *   1851 `(i.stockLevel ?? 0)` toplam adet → bilinmeyen adet 0.
 *   1913 `productCount[k].count += li.quantity || 1` → adedi bilinmeyen satır 1 ADET sayılıyor.
 *   1914 `revenue += (li.price || 0) * (li.quantity || 1)` → fiyatı bilinmeyen satır ₺0, adedi bilinmeyen ×1.
 *   1424 Phase 43 durum çubuğu → tanınmayan/eksik `status` sessizce düşüyor, çubuk %100'e tamamlanmıyor.
 *   2185 Phase 73 `counts.indexOf(Math.max(...counts))` → TÜM siparişlerin tarihi okunamazsa
 *        max 0 olur, indexOf 0 döner ve rozet "En yoğun: Paz" der (uydurma).
 *
 * Kural (CLAUDE.md): bilinmeyen sayı 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR; ekranda '—'
 * ya da "N kayıt tutarsız" notu. Türetilen sayı (marj, oran, rozet) tek girdi bile eksikse HESAPLANMAZ.
 * SAYFA PARİTESİ: girdiler biliniyorsa sayı eskiyle birebir aynı.
 */
import { describe, it, expect } from 'vitest';
import {
  stokDegeriOzeti,
  degerToplami,
  dusukStokKalemleri,
  stokEsikYaz,
  enCokSatanlar,
  durumDagilimi,
  haftaIciIsiHaritasi,
  sonSevkiyatlar,
  PANO_DURUMLARI,
  type StokKalemi,
  type SatisSiparisi,
} from './stokSevkiyat';
import { ekranTutari, tamTutar } from '../para';
import { stokDegeri } from '../muhasebe/finansalOranlar';
import { oranYuzde } from '../siparisler/lojistikKpi';

// ── Şirin İnşaat merkez deposu (inşaat malzemesi toptancısı) ─────────────────────
const cimento: StokKalemi = { stockLevel: 120, costPrice: 85, prices: { Retail: 130 }, lowStockThreshold: 20 };
const demir: StokKalemi   = { stockLevel: 40,  costPrice: 1250, prices: { Retail: 1800 }, lowStockThreshold: 10 };
const tugla: StokKalemi   = { stockLevel: 3,   costPrice: 2.4,  prices: { Retail: 4 },    lowStockThreshold: 5 };  // düşük
const kum: StokKalemi     = { stockLevel: null, costPrice: 60,  prices: { Retail: 90 },   lowStockThreshold: 5 };  // ADET bilinmiyor
const kirec: StokKalemi   = { stockLevel: 25,  costPrice: null, prices: {},               lowStockThreshold: 5 };  // maliyet+fiyat yok
const alcipan: StokKalemi = { stockLevel: 8,   costPrice: 55,   prices: { Retail: 80 } };                          // EŞİK yok
const eskiKalem: StokKalemi = { stockLevel: 0, costPrice: null, prices: {}, lowStockThreshold: 5 };                // stok 0 → değer GERÇEK 0

describe('stokDegeriOzeti — sayfa paritesi (stoğu ve fiyatı bilinen kalemler)', () => {
  it('maliyet/satış/adet eski reduce ile BİREBİR aynı; marj eski Math.round ile aynı', () => {
    const liste = [cimento, demir, tugla];
    const o = stokDegeriOzeti(liste);

    // Eski kod (DashboardPage 1848-1851). Orada `Number(x) ?? 0` yazıyordu; `Number()` hiçbir zaman
    // null/undefined dönmediği için o `?? 0` ÖLÜYDÜ (yedek hiç devreye girmez) — burada anlamı aynı
    // kalacak biçimde yazılmadı (eslint no-constant-binary-expression).
    const eskiMaliyet = liste.reduce((s, i) => s + (Number(i.costPrice) || 0) * Number(i.stockLevel), 0);
    const eskiSatis   = liste.reduce((s, i) => s + Number(i.prices?.['Retail']) * Number(i.stockLevel), 0);
    const eskiAdet    = liste.reduce((s, i) => s + Number(i.stockLevel), 0);
    const eskiMarj    = Math.round(((eskiSatis - eskiMaliyet) / eskiSatis) * 100);

    expect(ekranTutari(o.maliyet)).toBeCloseTo(eskiMaliyet, 6);
    expect(ekranTutari(o.satis)).toBeCloseTo(eskiSatis, 6);
    expect(ekranTutari(o.adet)).toBe(eskiAdet);
    expect(o.marj).toBe(eskiMarj);
    expect(o.maliyet.bilinmeyen).toBe(0);
    expect(o.satis.bilinmeyen).toBe(0);
  });

  it('satış tarafı finansalOranlar.stokDegeri ile TEK KAYNAK — iki hesap aynı sayıyı verir', () => {
    const liste = [cimento, demir, tugla, kum, kirec, eskiKalem];
    expect(stokDegeriOzeti(liste).satis).toEqual(stokDegeri(liste));
    // degerToplami aynı kuralı maliyet tarafına uygular (kopya kod değil, aynı fonksiyon)
    expect(degerToplami(liste, k => k.prices?.['Retail'] ?? k.price)).toEqual(stokDegeri(liste));
  });

  it('boş envanter GERÇEK 0 (hareketsiz) — ama marj YOK (null), "%0" değil', () => {
    const o = stokDegeriOzeti([]);
    expect(ekranTutari(o.maliyet)).toBe(0);
    expect(ekranTutari(o.satis)).toBe(0);
    expect(o.marj).toBeNull();        // mutasyon-ayırt-edici: eski kod `: 0` ile "%0" basıyordu
  });
});

/**
 * DÖVİZ FİYATLI KART — Phase 47'nin iki para birimini topladığı yer (2026-09-19 delta bulgusu).
 *
 * Sayfa maliyet tarafını `kartMaliyetiTL` ile TL'ye çeviriyor, satış tarafını ise seçicisiz
 * bırakıp `finansalOranlar.stokDegeri`ye düşüyordu; o fonksiyon `priceCurrency`ye BAKMAZ.
 * USD fiyatlı kartta "Satış Değeri" dolar rakamını ₺ diye basıyor ve marj eksiye çakılıyordu —
 * üstelik hiçbir girdi "bilinmiyor" olmadığı için '—' kapısı devreye girmiyordu.
 */
describe('stokDegeriOzeti — döviz fiyatlı kart (satış seçicisi verildiğinde)', () => {
  const dovizli: StokKalemi & { priceCurrency?: string; costCurrency?: string } = {
    stockLevel: 1000, costPrice: 8, costCurrency: 'USD', prices: { Retail: 12 }, priceCurrency: 'USD',
  };
  const KUR = 41;
  const satisTL = (k: typeof dovizli) => {
    const ham = k.prices?.['Retail'];
    if (typeof ham !== 'number') return null;
    return k.priceCurrency && k.priceCurrency !== 'TRY' ? ham * KUR : ham;
  };
  const maliyetTL = (k: typeof dovizli) => {
    const ham = k.costPrice;
    if (typeof ham !== 'number') return null;
    return k.costCurrency && k.costCurrency !== 'TRY' ? ham * KUR : ham;
  };

  it('MUTASYON-AYIRT EDİCİ — satış ₺492.000 (₺12.000 DEĞİL) ve marj %33 (−%2633 değil)', () => {
    const o = stokDegeriOzeti([dovizli], { maliyet: maliyetTL, satis: satisTL });
    expect(ekranTutari(o.satis)).toBe(492_000);
    expect(ekranTutari(o.maliyet)).toBe(328_000);
    expect(o.marj).toBe(33);
  });

  it('seçicisiz hâl (eski davranış) iki para birimini topluyordu — sabitlenmesin diye kanıt', () => {
    const eski = stokDegeriOzeti([dovizli], { maliyet: maliyetTL });
    expect(ekranTutari(eski.satis)).toBe(12_000);          // dolar rakamı ₺ diye
    expect(eski.marj).toBeLessThan(-1000);                 // kırmızı, "hesaplandı" görünümlü saçma oran
  });

  it('kur bilinmiyorsa satış kalemi SAYILIR (0 sayılıp toplamı eksiltmez)', () => {
    const o = stokDegeriOzeti([dovizli], { maliyet: maliyetTL, satis: () => null });
    expect(o.satis.bilinmeyen).toBe(1);
    expect(ekranTutari(o.satis)).toBeNaN();
    expect(o.marj).toBeNull();                             // türetme kapısı: '—'
  });
});

describe('stokDegeriOzeti — bilinmeyen 0 sayılmaz, SAYILIR (mutasyon-ayırt-edici)', () => {
  it('stoğu bilinmeyen kalem: adet toplamına 0 olarak GİRMEZ, bilinmeyen SAYILIR', () => {
    const o = stokDegeriOzeti([cimento, kum]);
    expect(o.adet.toplam).toBe(120);
    expect(o.adet.bilinen).toBe(1);
    expect(o.adet.bilinmeyen).toBe(1);   // `?? 0` geri gelirse bilinmeyen 0 olur → kırılır
    expect(o.maliyet.bilinmeyen).toBe(1);
    expect(o.satis.bilinmeyen).toBe(1);
  });

  it('fiyatı/maliyeti bilinmeyen kalem ₺0 değerli SAYILMAZ (null × 25 === 0 tuzağı)', () => {
    const o = stokDegeriOzeti([cimento, kirec]);
    expect(o.maliyet.toplam).toBeCloseTo(120 * 85, 6);
    expect(o.maliyet.bilinmeyen).toBe(1);
    expect(o.satis.bilinmeyen).toBe(1);
    expect(o.adet.bilinmeyen).toBe(0);   // adet BİLİNİYOR (25) — yalnız değer bilinmiyor
  });

  it('marj TÜRETİLEN sayı: tek kalem bile tutarsızsa hesaplanmaz (kısmi toplamdan marj üretilmez)', () => {
    expect(stokDegeriOzeti([cimento, kirec]).marj).toBeNull();
    expect(stokDegeriOzeti([cimento, kum]).marj).toBeNull();
    // Hepsi biliniyorsa hesaplanır
    expect(stokDegeriOzeti([cimento, demir]).marj).not.toBeNull();
  });

  it('bilinen 0 stok: değer GERÇEK 0 — fiyatsız eski kalem "tutarsız" sayacını şişirmez', () => {
    const o = stokDegeriOzeti([eskiKalem]);
    expect(o.maliyet).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
    expect(o.satis).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
    expect(tamTutar(o.maliyet)).toBe(0);
  });

  it('maliyet çözücüsü dışarıdan verilebilir (kur çevrimi: kartMaliyetiTL) — null bilinmiyordur', () => {
    const o = stokDegeriOzeti([cimento, demir], { maliyet: k => (k === cimento ? 100 : null) });
    expect(o.maliyet.toplam).toBeCloseTo(120 * 100, 6);
    expect(o.maliyet.bilinmeyen).toBe(1);
    expect(o.marj).toBeNull();
  });
});

describe('dusukStokKalemleri — "bilinmiyor" düşük stok DEĞİLDİR', () => {
  it('parite: stok ≤ eşik düşüktür, eşitlik dahil; üstü düşük değildir', () => {
    const s = dusukStokKalemleri([cimento, tugla]);
    expect(s.dusuk).toEqual([tugla]);
    const esitlik: StokKalemi = { stockLevel: 5, lowStockThreshold: 5 };
    expect(dusukStokKalemleri([esitlik]).dusuk).toEqual([esitlik]);
  });

  it('stoğu bilinmeyen kalem düşük stok UYARISI üretmez, ayrı sayılır (mutasyon-ayırt-edici)', () => {
    const s = dusukStokKalemleri([kum]);
    expect(s.dusuk).toEqual([]);            // eski `?? 0` → 0 <= 5 → sahte uyarı
    expect(s.stokBilinmeyen).toEqual([kum]);
  });

  it('eşiği bilinmeyen kalem uydurma 5 ile KIYASLANMAZ (mutasyon-ayırt-edici)', () => {
    const s = dusukStokKalemleri([alcipan]);  // stok 8, eşik yok → eski `?? 5`: 8 > 5 → düşük değil
    expect(s.dusuk).toEqual([]);
    expect(s.esikBilinmeyen).toEqual([alcipan]);
    // Eşik uydurulsaydı stoğu 3 olan bir kalem "düşük" diye uyarı üretirdi:
    const esiksizAz: StokKalemi = { stockLevel: 3 };
    const t = dusukStokKalemleri([esiksizAz]);
    expect(t.dusuk).toEqual([]);
    expect(t.esikBilinmeyen).toEqual([esiksizAz]);
  });

  it('eşik seçicisi minStock yedeğini okur (sayfadaki `lowStockThreshold ?? minStock` paritesi)', () => {
    const k: StokKalemi = { stockLevel: 2, minStock: 4 };
    expect(dusukStokKalemleri([k]).dusuk).toEqual([k]);
  });

  it('stokEsikYaz: bilinmeyen taraf "—" basar, "0" değil', () => {
    expect(stokEsikYaz(tugla)).toBe('3 / 5');
    expect(stokEsikYaz(kum)).toBe('— / 5');
    expect(stokEsikYaz(alcipan)).toBe('8 / —');
  });
});

// ── Sipariş satırları: ÇİMENTO 50KG / DEMİR Ø12 / TUĞLA ─────────────────────────
const sip1: SatisSiparisi = {
  lineItems: [
    { sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 100, price: 130 },  // ₺13.000
    { sku: 'DMR-12', name: 'DEMİR Ø12',    quantity: 2,   price: 1800 }, // ₺3.600
  ],
};
const sip2: SatisSiparisi = {
  lineItems: [
    { sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 40, price: 130 },   // ₺5.200
  ],
};
const sipBozuk: SatisSiparisi = {
  lineItems: [
    { sku: 'TGL-19', name: 'TUĞLA 19CM', quantity: null, price: 4 },     // ADET bilinmiyor
    { sku: 'KUM-01', name: 'KUM',        quantity: 5,    price: null },  // FİYAT bilinmiyor
  ],
};

describe('enCokSatanlar — sayfa paritesi (fiyatı ve adedi bilinen satırlar)', () => {
  it('ciro = Σ fiyat × adet, adet = Σ adet; ciroya göre azalan sıralar (eski kodla aynı sayı)', () => {
    const r = enCokSatanlar([sip1, sip2], 5);
    expect(r.map(p => p.anahtar)).toEqual(['CIM-50', 'DMR-12']);
    expect(ekranTutari(r[0].ciro)).toBeCloseTo(13000 + 5200, 6);
    expect(ekranTutari(r[0].adet)).toBe(140);
    expect(ekranTutari(r[1].ciro)).toBeCloseTo(3600, 6);
    expect(r[0].ad).toBe('ÇİMENTO 50KG');
  });

  it('n kadar kesilir; satırsız sipariş listeye ürün eklemez', () => {
    expect(enCokSatanlar([sip1, sip2], 1)).toHaveLength(1);
    expect(enCokSatanlar([{ lineItems: [] }, { lineItems: null }], 5)).toEqual([]);
  });

  it('meşru 0 adet bilinen değerdir (bedelsiz/iptal satır), bilinmeyen değil', () => {
    const r = enCokSatanlar([{ lineItems: [{ sku: 'CIM-50', quantity: 0, price: 130 }] }], 5);
    expect(r[0].adet).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
    expect(r[0].ciro).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
  });
});

describe('enCokSatanlar — bilinmeyen 1 adet / ₺0 sayılmaz (mutasyon-ayırt-edici)', () => {
  it('adedi bilinmeyen satır 1 ADET sayılmaz (eski `quantity || 1`)', () => {
    const r = enCokSatanlar([sipBozuk], 5);
    const tugla19 = r.find(p => p.anahtar === 'TGL-19')!;
    expect(tugla19.adet).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(Number.isNaN(ekranTutari(tugla19.adet))).toBe(true);  // hiç bilinen yok → '—'
    expect(Number.isNaN(ekranTutari(tugla19.ciro))).toBe(true);
  });

  it('fiyatı bilinmeyen satır ₺0 ciro sayılmaz (eski `price || 0`)', () => {
    const r = enCokSatanlar([sipBozuk], 5);
    const kumSatir = r.find(p => p.anahtar === 'KUM-01')!;
    expect(kumSatir.adet).toEqual({ toplam: 5, bilinen: 1, bilinmeyen: 0 });
    expect(kumSatir.ciro).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
  });

  it('cirosu bilinmeyen ürün listenin ORTASINA ₺0 gibi dizilmez, SONA gider', () => {
    const r = enCokSatanlar([sip1, sipBozuk], 5);
    expect(r[0].anahtar).toBe('CIM-50');
    expect(r[1].anahtar).toBe('DMR-12');
    expect(r.slice(2).map(p => p.anahtar).sort()).toEqual(['KUM-01', 'TGL-19']);
  });

  it('kısmi bilinen ürün: bilinen satırların toplamı + "N satır tutarsız" sayacı', () => {
    const karisik: SatisSiparisi = {
      lineItems: [
        { sku: 'CIM-50', quantity: 10, price: 130 },
        { sku: 'CIM-50', quantity: 10, price: null },
      ],
    };
    const r = enCokSatanlar([karisik], 5);
    expect(r[0].ciro).toEqual({ toplam: 1300, bilinen: 1, bilinmeyen: 1 });
    expect(ekranTutari(r[0].ciro)).toBe(1300);
    expect(Number.isNaN(tamTutar(r[0].ciro))).toBe(true);  // türetmeye girmez
  });

  it('sku yoksa ada, o da yoksa TEK "tanımsız" kovasına düşer (ad null → sayfa "—" basar)', () => {
    const r = enCokSatanlar([{ lineItems: [
      { name: 'HARÇ', quantity: 1, price: 50 },
      { quantity: 2, price: 10 },
      { quantity: 3, price: 10 },
    ] }], 5);
    expect(r.find(p => p.anahtar === 'HARÇ')?.ad).toBe('HARÇ');
    const tanimsiz = r.find(p => p.ad === null)!;
    expect(ekranTutari(tanimsiz.adet)).toBe(5);
  });
});

/**
 * ÇUBUK ORANI — 2026-09-19 hakem turu bulgusu.
 *
 * Sayfa (DashboardPage 2049 + 2127) ölçeği KISMİ tepeden alıyor ve çubuğu KISMİ satır
 * cirosundan çiziyordu:
 *     const maxRevTop = top5.reduce((m, p) => (p.ciro.bilinen > 0 && p.ciro.toplam > m ? p.ciro.toplam : m), 0);
 *     const pay = oranYuzde(ekranTutari(p.ciro), maxRevTop);
 * Oysa aynı sayfadaki `musteriAnaliz` panelleri (Phase 77/124) tam tersini yapıyordu —
 * iki çelişen kural. Kural artık `utils/pano/cubuk`ta TEK kaynak; burada o kuralın
 * ürün paneline uygulandığı sabitlenir.
 */
describe('enCokSatanlar — çubuk oranı KISMİ cirodan çizilmez', () => {
  it('parite: tüm satırlar tam → oran eski `(ciro / maxRev) * 100` ile aynı', () => {
    const r = enCokSatanlar([sip1, sip2], 5);   // CIM-50 ₺18.200, DMR-12 ₺3.600
    expect(r[0].barOrani).toBe(100);
    expect(r[1].barOrani).toBeCloseTo((3600 / 18200) * 100, 9);
  });

  it('kısmi cirolu ürünün çubuğu YOK, tam tepe ürünün çubuğu %100 (mutasyon-ayırt-edici)', () => {
    // ÇİMENTO: ₺1.000 bilinen + 500 adetlik FİYATSIZ satır → gerçek cirosu bilinmiyor,
    // büyük olasılıkla listenin tepesinde. DEMİR: 30 × ₺50 = ₺1.500 (tam).
    const karisik: SatisSiparisi = {
      lineItems: [
        { sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 10, price: 100 },
        { sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 500, price: null },
        { sku: 'DMR-12', name: 'NERVÜRLÜ DEMİR 12MM', quantity: 30, price: 50 },
      ],
    };
    const r = enCokSatanlar([karisik], 5);
    expect(r.map(p => p.anahtar)).toEqual(['DMR-12', 'CIM-50']);
    expect(r[0].barOrani).toBe(100);
    expect(r[1].barOrani).toBeNull();   // eski sayfa: oranYuzde(1000, 1500) → %67 çubuk
  });

  it('TEPE ürünün cirosu kısmiysa hiçbir çubuk çizilmez (ölçek güvenilmez)', () => {
    const tepeKismi: SatisSiparisi = {
      lineItems: [
        { sku: 'CIM-50', quantity: 100, price: 130 },   // ₺13.000 bilinen
        { sku: 'CIM-50', quantity: 20, price: null },   // tutarsız → tepe KISMİ
        { sku: 'DMR-12', quantity: 2, price: 1800 },    // ₺3.600 tam
      ],
    };
    const r = enCokSatanlar([tepeKismi], 5);
    expect(r.map(p => p.anahtar)).toEqual(['CIM-50', 'DMR-12']);
    expect(r.map(p => p.barOrani)).toEqual([null, null]);
  });

  it('cirosu HİÇ bilinmeyen ürün yalnız kendi çubuğunu kaybeder', () => {
    const r = enCokSatanlar([sip1, sipBozuk], 5);
    expect(r[0].barOrani).toBe(100);                       // CIM-50 tam
    expect(r.find(p => p.anahtar === 'KUM-01')!.barOrani).toBeNull();
    expect(r.find(p => p.anahtar === 'TGL-19')!.barOrani).toBeNull();
  });

  it('`n` sınırı ölçeğe de uygulanır: çubuklar GÖSTERİLEN listeye göre ölçeklenir', () => {
    const r = enCokSatanlar([sip1, sip2], 1);
    expect(r).toHaveLength(1);
    expect(r[0].barOrani).toBe(100);
  });
});

describe('durumDagilimi — tanınmayan durum sessizce DÜŞMEZ', () => {
  it('parite: bilinen durumlar eski filter().length ile aynı sayıda', () => {
    const siparisler = [
      { status: 'Pending' }, { status: 'Pending' }, { status: 'Shipped' }, { status: 'Delivered' },
    ];
    const d = durumDagilimi(siparisler, PANO_DURUMLARI);
    expect(d.sayilar.Pending).toBe(2);
    expect(d.sayilar.Shipped).toBe(1);
    expect(d.sayilar.Delivered).toBe(1);
    expect(d.sayilar.Processing).toBe(0);
    expect(d.diger).toBe(0);
    expect(d.toplam).toBe(4);
  });

  it('durumu eksik/tanınmayan sipariş `diger` sayılır; sayılar + diger = toplam (mutasyon-ayırt-edici)', () => {
    const siparisler = [
      { status: 'Pending' }, { status: 'Taslak' }, { status: undefined }, { status: null }, {},
    ];
    const d = durumDagilimi(siparisler, PANO_DURUMLARI);
    expect(d.sayilar.Pending).toBe(1);
    expect(d.diger).toBe(4);           // eski çubukta bu 4 sipariş HİÇ görünmüyordu
    const toplananlar = Object.values(d.sayilar).reduce((a, b) => a + b, 0) + d.diger;
    expect(toplananlar).toBe(d.toplam);
  });

  it('boş liste: oran hesaplanmaz (0\'a bölme yok)', () => {
    const d = durumDagilimi([], PANO_DURUMLARI);
    expect(d.toplam).toBe(0);
    expect(oranYuzde(d.sayilar.Pending, d.toplam)).toBeNull();
  });
});

// ── Haftalık ısı haritası: gün indeksleri fikstürün kendisinden türetilir (TZ bağımsız) ──
const pzt = new Date(2026, 8, 14, 10, 0, 0);   // Pazartesi
const sal = new Date(2026, 8, 15, 10, 0, 0);
const cum = new Date(2026, 8, 18, 10, 0, 0);

describe('haftaIciIsiHaritasi — tarihi okunamayan sipariş "Pazar"a düşmez', () => {
  it('parite: tarihi bilinen siparişler getDay() kovasına girer', () => {
    const h = haftaIciIsiHaritasi([
      { createdAt: pzt }, { createdAt: pzt }, { createdAt: sal }, { createdAt: cum },
    ]);
    expect(h.sayilar[pzt.getDay()]).toBe(2);
    expect(h.sayilar[sal.getDay()]).toBe(1);
    expect(h.sayilar[cum.getDay()]).toBe(1);
    expect(h.toplam).toBe(4);
    expect(h.tarihsiz).toBe(0);
    expect(h.enYogunGun).toBe(pzt.getDay());
    expect(h.enYuksek).toBe(2);
  });

  it('tarihi çözülemeyen sipariş SAYILIR, hiçbir güne yazılmaz (mutasyon-ayırt-edici)', () => {
    const h = haftaIciIsiHaritasi([{ createdAt: pzt }, { createdAt: 'bozuk-tarih' }, {}]);
    expect(h.sayilar.reduce((a, b) => a + b, 0)).toBe(1);
    expect(h.sayilar[0]).toBe(0);      // Pazar kovası kirlenmedi
    expect(h.tarihsiz).toBe(2);
  });

  it('HİÇ tarih çözülemezse "en yoğun gün" rozeti hesaplanmaz — null (mutasyon-ayırt-edici)', () => {
    const h = haftaIciIsiHaritasi([{ createdAt: null }, { createdAt: 'x' }]);
    expect(h.enYogunGun).toBeNull();   // eski `counts.indexOf(Math.max(...counts))` → 0 → "En yoğun: Paz"
    expect(h.tarihsiz).toBe(2);
    expect(h.toplam).toBe(0);
  });

  it('boş liste: rozet yok, 7 kova sıfır', () => {
    const h = haftaIciIsiHaritasi([]);
    expect(h.sayilar).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(h.enYogunGun).toBeNull();
  });

  it('createdAt yoksa syncedAt okunur (sayfa paritesi)', () => {
    const h = haftaIciIsiHaritasi([{ syncedAt: sal }]);
    expect(h.sayilar[sal.getDay()]).toBe(1);
    expect(h.tarihsiz).toBe(0);
  });

  it('beraberlikte ilk gün seçilir (eski indexOf paritesi)', () => {
    const h = haftaIciIsiHaritasi([{ createdAt: sal }, { createdAt: cum }]);
    expect(h.enYogunGun).toBe(Math.min(sal.getDay(), cum.getDay()));
  });
});

describe('sonSevkiyatlar — tarihi bilinmeyen sevkiyat sona gider (her iki yönde)', () => {
  const eski = { id: 'a', createdAt: new Date(2026, 8, 1) };
  const yeni = { id: 'b', createdAt: new Date(2026, 8, 18) };
  const tarihsiz = { id: 'c', createdAt: null };

  it('en yeni başta; tarihsiz kayıt epoch gibi ortaya değil SONA', () => {
    expect(sonSevkiyatlar([eski, tarihsiz, yeni], 5).map(s => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('n kadar keser', () => {
    expect(sonSevkiyatlar([eski, tarihsiz, yeni], 2).map(s => s.id)).toEqual(['b', 'a']);
  });

  it('girdi dizisini DEĞİŞTİRMEZ (sayfa state\'i canlı liste)', () => {
    const liste = [eski, tarihsiz, yeni];
    sonSevkiyatlar(liste, 5);
    expect(liste.map(s => s.id)).toEqual(['a', 'c', 'b']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6b EKİ (2026-09-24): `urunSatislari` — `enCokSatanlar`ın iç gruplaması DIŞA AÇILIR (kesilmez).
// A · UrunlerRapor.tsx:57-75
//   :63  `const qty = Number(liR.quantity ?? 1) || 1;`                        → miktarı bilinmeyen kalem 1 ADET
//   :64  `Number(liR.unitPrice ?? liR.price ?? liR.variant_price ?? 0) || 0`  → fiyatı bilinmeyen ₺0; unitPrice/variant_price HAYALET
//   :61  `… ?? 'Unknown'`                                                      → adsız kalem sahte ürün satırı
//   :70  `prodMap[key].orderCount++;`                                          → KALEM sayıyor, sipariş değil
// B · GenelBloklar1.tsx:586-637 (P217 Top 6)
//   :595 `prodRev217[key].rev += li.price * li.quantity;`                      → korumasız çarpım (null × 4 === 0; undefined → NaN)
//   :601 `total217 = sorted217.reduce(…)` payda YALNIZ ilk 6                   → K21 kullanıcı 2026-09-24: "Tüm ciro" (KARARLAR.md)
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { urunSatislari } from './stokSevkiyat';

describe('urunSatislari — 6b eki: gruplama tek gövde, kesme ÇAĞIRANDA', () => {
  it('YENİDEN YAPILANDIRMA PARİTESİ: enCokSatanlar(s, 5) satırları urunSatislari(s).slice(0, 5) ile BİREBİR; barOrani yalnız enCokSatanlar\'da', () => {
    const s = [sip1, sip2, sipBozuk];
    const eski = enCokSatanlar(s, 5);
    const yeni = urunSatislari(s).slice(0, 5);
    expect(eski.length).toBe(yeni.length);
    eski.forEach((e, i) => {
      expect(e.anahtar).toBe(yeni[i].anahtar);
      expect(e.ad).toBe(yeni[i].ad);
      expect(e.adet).toEqual(yeni[i].adet);
      expect(e.ciro).toEqual(yeni[i].ciro);
      expect(e.siparisSayisi).toBe(yeni[i].siparisSayisi);
      expect('barOrani' in e).toBe(true);
    });
    expect(yeni.some(u => 'barOrani' in u)).toBe(false);
  });

  it('MUTASYON-AYIRT EDİCİ: siparisSayisi BENZERSİZ sipariş sayar — aynı siparişte iki ÇİMENTO satırı 1 (UrunlerRapor bugün 2 sayıyor)', () => {
    const tek: SatisSiparisi = {
      lineItems: [
        { sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 10, price: 130 },
        { sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 10, price: 130 },
      ],
    };
    const r1 = urunSatislari([tek]);
    expect(r1).toHaveLength(1);
    expect(r1[0].siparisSayisi).toBe(1);
    expect(ekranTutari(r1[0].adet)).toBe(20);
    expect(ekranTutari(r1[0].ciro)).toBe(2600);

    const r2 = urunSatislari([sip1, sip2]);            // CIM-50 iki ayrı siparişte, DMR-12 birinde
    expect(r2.find(u => u.anahtar === 'CIM-50')!.siparisSayisi).toBe(2);
    expect(r2.find(u => u.anahtar === 'DMR-12')!.siparisSayisi).toBe(1);
    // Aynı alan enCokSatanlar çıktısında da var ve doğru
    expect(enCokSatanlar([sip1, sip2], 5).find(u => u.anahtar === 'CIM-50')!.siparisSayisi).toBe(2);
  });

  it('`baslikYedegi`: sku/name YOK, title VAR → varsayılan tanımsız kovası; true ile başlık anahtar olur (Shopify satırı `title` yazar)', () => {
    const shopify: SatisSiparisi = {
      lineItems: [
        { title: 'BORDÜR 8cm', quantity: 2, price: 100 },
        { title: 'BORDÜR 8cm', quantity: 3, price: 100 },
        { title: 'KİLİT TAŞI', quantity: 1, price: 40 },
      ],
    };
    const varsayilan = urunSatislari([shopify]);
    expect(varsayilan).toHaveLength(1);                // tek tanımsız kova (Pano paritesi)
    expect(varsayilan[0].anahtar).toBeNull();
    expect(ekranTutari(varsayilan[0].adet)).toBe(6);
    // İki ayrı ürünü toplayan anahtarsız kovaya İLK satırın başlığı ad olarak VERİLMEZ (inceleme 2026-09-25:
    // "BORDÜR 8cm ₺540" = bordür + kilit taşı toplamı yanlış etiketle basılıyordu) → ekran '—'.
    expect(varsayilan[0].ad).toBeNull();
    expect(enCokSatanlar([shopify], 5)[0].ad).toBeNull();

    const basliklı = urunSatislari([shopify], { baslikYedegi: true });
    expect(basliklı.map(u => u.anahtar)).toEqual(['BORDÜR 8cm', 'KİLİT TAŞI']);
    expect(basliklı[0].ad).toBe('BORDÜR 8cm');
    expect(ekranTutari(basliklı[0].adet)).toBe(5);
    // sku varken başlık yedeği devreye GİRMEZ (zincir sku → name → title)
    expect(urunSatislari([sip1], { baslikYedegi: true }).map(u => u.anahtar)).toEqual(['CIM-50', 'DMR-12']);
  });

  it('kesme YOK: 8 ürün → 8 satır, ciroya göre azalan; cirosu hiç bilinmeyen ürün SONDA', () => {
    const sekiz: SatisSiparisi = {
      lineItems: [
        { sku: 'U1', quantity: 1, price: 800 }, { sku: 'U2', quantity: 1, price: 100 },
        { sku: 'U3', quantity: 1, price: 500 }, { sku: 'U4', quantity: 1, price: null },   // cirosu bilinmiyor
        { sku: 'U5', quantity: 1, price: 300 }, { sku: 'U6', quantity: 1, price: 700 },
        { sku: 'U7', quantity: 1, price: 200 }, { sku: 'U8', quantity: 1, price: 600 },
      ],
    };
    const r = urunSatislari([sekiz]);
    expect(r).toHaveLength(8);
    expect(r.map(u => u.anahtar)).toEqual(['U1', 'U6', 'U8', 'U3', 'U5', 'U7', 'U2', 'U4']);
    expect(enCokSatanlar([sekiz], 6)).toHaveLength(6);
  });

  it('MUTASYON-AYIRT EDİCİ: bilinmeyen 1 adet / ₺0 SAYILMAZ (mutasyon: `?? 1` / `|| 0`)', () => {
    const r = urunSatislari([sipBozuk]);
    const tugla = r.find(u => u.anahtar === 'TGL-19')!;    // quantity null
    expect(tugla.adet).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(Number.isNaN(ekranTutari(tugla.adet))).toBe(true);
    expect(tugla.ciro.bilinmeyen).toBe(1);
    const kum = r.find(u => u.anahtar === 'KUM-01')!;      // price null
    expect(kum.adet).toEqual({ toplam: 5, bilinen: 1, bilinmeyen: 0 });
    expect(kum.ciro).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(Number.isNaN(ekranTutari(kum.ciro))).toBe(true);
    expect(urunSatislari([{ lineItems: [{ sku: 'X', quantity: undefined, price: 10 }] }])[0].adet.bilinmeyen).toBe(1);
  });

  it('boş girdi: [], [{lineItems: []}], [{lineItems: null}] → []', () => {
    expect(urunSatislari([])).toEqual([]);
    expect(urunSatislari([{ lineItems: [] }])).toEqual([]);
    expect(urunSatislari([{ lineItems: null }])).toEqual([]);
  });

  it('enCokSatanlar sözleşmesi korunuyor: barOrani kuralı aynen (tepe kısmiyse null, tam tepe 100) + siparisSayisi alanı', () => {
    const r = enCokSatanlar([sip1, sip2], 5);
    expect(r[0].barOrani).toBe(100);
    expect(r[0].siparisSayisi).toBe(2);
    expect(r[1].siparisSayisi).toBe(1);
    const tepeKismi: SatisSiparisi = {
      lineItems: [
        { sku: 'CIM-50', quantity: 100, price: 130 },
        { sku: 'CIM-50', quantity: 20, price: null },
        { sku: 'DMR-12', quantity: 2, price: 1800 },
      ],
    };
    expect(enCokSatanlar([tepeKismi], 5).map(p => p.barOrani)).toEqual([null, null]);
  });

  it('girdi mutasyona uğramaz: Object.freeze\'li sipariş/satırlarla hata atmaz', () => {
    const donuk = Object.freeze([sip1, sip2].map(o => Object.freeze({
      lineItems: Object.freeze((o.lineItems ?? []).map(l => Object.freeze({ ...l }))),
    })));
    expect(() => urunSatislari(donuk, { baslikYedegi: true })).not.toThrow();
    expect(() => enCokSatanlar(donuk, 5)).not.toThrow();
    expect(urunSatislari(donuk)[0].anahtar).toBe('CIM-50');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6b HAKEM TURU (2026-09-24, bulgu 1 — K-KALEM=A): `UrunSatisSecenek.tutarSec` + `SatisSatiri.total` (ADDITIVE).
// Neden: Mikro faturasından türeyen sipariş kalemi `price` TAŞIMAZ, tutarı `total`da (KDV dâhil) —
// src/server/mikro/eslemeFatura.ts:166-171 `SiparisSatiri { sku; name; quantity; total }`. Varsayılan seçici
// `satirTutari(price, quantity)` bu kalemleri "tutarı okunamadı" sayıyor, `tamTutar` kapısı da TÜM ürünlerin
// payını/sınıfını '—' yapıyordu (tutarı apaçık yazılı fatura "okunamadı" oluyordu → yanlış neden).
// Kullanıcı kararı K3 (KARARLAR.md): "evet / ana program zaten bu." — Mikro verisi KATILIR.
// Sözleşme: seçici VERİLMEZSE bugünkü `satirTutari` (Pano paritesi — `enCokSatanlar` GEÇMEZ, 5/n testleri sabit).
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { bilinenSayi, satirTutari } from '../para';

describe('urunSatislari — `tutarSec` (6b hakem, K-KALEM=A): satır cirosu seçicisi, varsayılan satirTutari', () => {
  /**
   * UrunlerRapor'un geçtiği seçici (şartname §Açık sorular 1/A): `total` biliniyorsa o, yoksa fiyat × adet.
   * Yedek `satirTutari` OLMAK ZORUNDA: `Number(100) * Number(null)` = 0 → "null × miktar === 0" tuzağı
   * (bu testin ilk taslağı o tuzağa düştü ve C vakası kırmızı yandı — vaka bilerek kalıyor).
   */
  const mikroSecici = (s: { total?: unknown; price?: unknown; quantity?: unknown }): number =>
    bilinenSayi(s.total) ? Number(s.total) : satirTutari(s.price, s.quantity);

  const mikroFaturasi: SatisSiparisi = {
    // eslemeFatura çıktısı: `price` YOK, `total` KDV DÂHİL (130 × 100 × 1,20)
    lineItems: [{ sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 100, total: 15600 }],
  };

  it('şartname vakaları: `{ total: 1180 }` → 1180; `{ total: null, price: 100, quantity: 2 }` → 200; `{ total: null, price: 100, quantity: null }` → NaN', () => {
    const s: SatisSiparisi = {
      lineItems: [
        { sku: 'A', total: 1180 },                                  // yalnız total (adet bilinmiyor, ciro biliniyor)
        { sku: 'B', total: null, price: 100, quantity: 2 },         // total yok → fiyat × adet
        { sku: 'C', total: null, price: 100, quantity: null },      // ikisi de yok → bilinmiyor
      ],
    };
    const r = urunSatislari([s], { tutarSec: mikroSecici });
    const a = r.find(u => u.anahtar === 'A')!;
    const b = r.find(u => u.anahtar === 'B')!;
    const c = r.find(u => u.anahtar === 'C')!;
    expect(a.ciro).toEqual({ toplam: 1180, bilinen: 1, bilinmeyen: 0 });
    expect(a.adet).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });      // adet AYRI kova — total adedi bilinir yapmaz
    expect(b.ciro).toEqual({ toplam: 200, bilinen: 1, bilinmeyen: 0 });
    expect(c.ciro).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(Number.isNaN(ekranTutari(c.ciro))).toBe(true);
    // sıralama seçicinin cirosuyla: A (1180) > B (200) > C (bilinmiyor, SONDA)
    expect(r.map(u => u.anahtar)).toEqual(['A', 'B', 'C']);
  });

  it('MUTASYON-AYIRT EDİCİ: Mikro türevi kalem (price YOK, total VAR) seçiciyle BİLİNİR; seçicisiz "tutarı okunamadı" kalır', () => {
    const seciciyle = urunSatislari([mikroFaturasi], { tutarSec: mikroSecici });
    expect(seciciyle).toHaveLength(1);
    expect(seciciyle[0].ciro).toEqual({ toplam: 15600, bilinen: 1, bilinmeyen: 0 });
    expect(ekranTutari(seciciyle[0].adet)).toBe(100);
    expect(seciciyle[0].siparisSayisi).toBe(1);

    // Varsayılan (Pano paritesi): `total` OKUNMAZ — enCokSatanlar/5-n sözleşmesi değişmez
    const varsayilan = urunSatislari([mikroFaturasi]);
    expect(varsayilan[0].ciro).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(enCokSatanlar([mikroFaturasi], 5)[0].ciro).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
  });

  it('karışık veri: Cetpa-native (price × quantity) + Mikro türevi (total) TEK kovada toplanır; bilinmeyen sayaç 0', () => {
    const r = urunSatislari([sip1, sip2, mikroFaturasi], { tutarSec: mikroSecici });
    const cimentoKova = r.find(u => u.anahtar === 'CIM-50')!;
    expect(cimentoKova.ciro).toEqual({ toplam: 13000 + 5200 + 15600, bilinen: 3, bilinmeyen: 0 });
    expect(ekranTutari(cimentoKova.adet)).toBe(240);
    expect(cimentoKova.siparisSayisi).toBe(3);
    // native ürün seçiciden ETKİLENMEZ (total yok → fiyat × adet)
    expect(r.find(u => u.anahtar === 'DMR-12')!.ciro).toEqual({ toplam: 3600, bilinen: 1, bilinmeyen: 0 });
  });

  it('seçici HAM satırı alır (title/sku dâhil) ve bilinmeyen döndürürse satır SAYILIR (0 değil)', () => {
    const gorulen: unknown[] = [];
    const r = urunSatislari([sip2], { tutarSec: s => { gorulen.push(s.sku); return undefined; } });
    expect(gorulen).toEqual(['CIM-50']);
    expect(r[0].ciro).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6b KAPANIŞ TURU (2026-09-24, bulgu 4 + 6 — K-KALEM=A seçicisi TEK tanım; ADDITIVE):
// `kalemTutari` + `kdvDahilKalemVar`. Yukarıdaki `mikroSecici` GenelBloklar1 P217 (:155) ve UrunlerRapor (:113)
// dosyalarında SATIR İÇİ KOPYA olarak yaşıyordu; biri değişince öteki unutulur, Genel sekmesi ile Ürün Performansı
// aynı ürünün cirosunu FARKLI basar (yarım düzeltme sınıfı). Dipnot kapısı da (yalnız UrunlerRapor'da vardı)
// aynı kuralı ikinci kez yazıyordu. Karar B'ye dönerse YALNIZ bu iki gövde değişir.
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { kalemTutari, kdvDahilKalemVar, type SatisSatiri } from './stokSevkiyat';

describe('kalemTutari — K-KALEM=A seçicisi (6b kapanış, TEK tanım)', () => {
  it('şartname vakaları: `{ total: 1180 }` → 1180; `{ total: null, price: 100, quantity: 2 }` → 200; ikisi de yok → NaN', () => {
    expect(kalemTutari({ total: 1180 })).toBe(1180);
    expect(kalemTutari({ total: null, price: 100, quantity: 2 })).toBe(200);
    expect(Number.isNaN(kalemTutari({ total: null, price: 100, quantity: null }))).toBe(true);
  });

  it('sayısal metin `total` bilinir ("15600" → 15600); bilinen 0 `total` GERÇEK 0 (bedelsiz satır), bilinmeyen değil', () => {
    expect(kalemTutari({ total: '15600' })).toBe(15600);
    expect(kalemTutari({ total: 0, price: 130, quantity: 100 })).toBe(0);   // total ÖNCE — fiyat × adet'e düşmez
  });

  it('MUTASYON-AYIRT EDİCİ: `total` yokken `Number(null) * 4 === 0` tuzağına GİRMEZ (yedek satirTutari, çarpım değil)', () => {
    expect(Number.isNaN(kalemTutari({ price: null, quantity: 4 }))).toBe(true);
    expect(Number.isNaN(kalemTutari({ total: 'abc', price: undefined, quantity: 4 }))).toBe(true);
  });

  it('PARİTE: `urunSatislari(…, { tutarSec: kalemTutari })` iki dosyanın eski satır içi seçicisiyle BİREBİR aynı kovaları verir', () => {
    const eskiSatirIci = (s: SatisSatiri): number =>
      bilinenSayi(s.total) ? Number(s.total) : satirTutari(s.price, s.quantity);
    const mikro: SatisSiparisi = { lineItems: [{ sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 100, total: 15600 }] };
    const karisik = [sip1, sip2, mikro, sipBozuk];
    expect(urunSatislari(karisik, { tutarSec: kalemTutari })).toEqual(urunSatislari(karisik, { tutarSec: eskiSatirIci }));
    expect(urunSatislari(karisik, { tutarSec: kalemTutari, baslikYedegi: true }))
      .toEqual(urunSatislari(karisik, { tutarSec: eskiSatirIci, baslikYedegi: true }));
  });
});

describe('kdvDahilKalemVar — "Mikro kalemlerinde KDV dâhildir" dipnot kapısı (seçicinin ilk dalıyla AYNI kural)', () => {
  it('yalnız native satırlar (price × quantity) → false: Mikro\'suz kiracıda dipnot basılmaz (gürültü)', () => {
    expect(kdvDahilKalemVar([sip1, sip2])).toBe(false);
    expect(kdvDahilKalemVar([])).toBe(false);
    expect(kdvDahilKalemVar([{ lineItems: null }, { lineItems: [] }])).toBe(false);
  });

  it('en az BİR kalemde `total` biliniyorsa true (Mikro faturası türevi) — sayısal metin de sayılır', () => {
    expect(kdvDahilKalemVar([sip1, { lineItems: [{ sku: 'KUM-01', quantity: 1, total: 12000 }] }])).toBe(true);
    expect(kdvDahilKalemVar([{ lineItems: [{ sku: 'KUM-01', total: '12000' }] }])).toBe(true);
  });

  it('MUTASYON-AYIRT EDİCİ: okunamayan `total` (null / "abc" / NaN) kapıyı AÇMAZ — `total` alanının varlığı değil, bilinirliği', () => {
    expect(kdvDahilKalemVar([{ lineItems: [{ sku: 'X', total: null, price: 10, quantity: 1 }] }])).toBe(false);
    expect(kdvDahilKalemVar([{ lineItems: [{ sku: 'X', total: 'abc' }] }])).toBe(false);
    expect(kdvDahilKalemVar([{ lineItems: [{ sku: 'X', total: Number.NaN }] }])).toBe(false);
  });
});
