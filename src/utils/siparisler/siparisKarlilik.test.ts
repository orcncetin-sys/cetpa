/**
 * siparisKarlilik.test.ts — sipariş kârlılığının TEK sözleşmesi (Faz 3 4/n, grup "siparisKarlilik").
 * ÖNCE YAZILDI, kırmızı görüldü; sonra `siparisKarlilik.ts` yazıldı.
 *
 * NEDEN VAR — OrdersPage sipariş detayında kâr AYNI ANDA İKİ KEZ, İKİ FARKLI kuralla hesaplanıyordu
 * (aynı modalde iki farklı marj görünebiliyordu):
 *   • Phase 513 popup (OrdersPage ~1971-1977): `revenue = selectedOrder.totalPrice || 0`,
 *     maliyet zinciri `li.costPrice ?? (inv ? itemCostTRY(inv,…) : li.price * 0.6)` — maliyeti
 *     bilinmeyen kalem için UYDURMA %60 oranı; `margin = revenue > 0 ? … : 0` → sahte "%0,0".
 *   • Phase 74 kutusu (OrdersPage ~2286-2291): `hasCost = some(l => (l.costPrice ?? 0) > 0)`
 *     kapısı — KARIŞIK siparişte (bir kalemin maliyeti var, diğerininki yok) kapıyı geçiyor ve
 *     eksik maliyeti 0 sayıp marjı şişiriyordu; `revenue = Σ price×quantity`.
 *   • WhatsApp özeti (~1919): `kurCevir(o.totalPrice || 0, …)` — tutarı bilinmeyen sipariş
 *     MÜŞTERİYE giden metinde "₺0" oluyordu.
 *   • Kalem tablosu alt toplamı (~2270): `$${Σ l.price*l.quantity.toFixed(2)}` — TL tutarı '$'
 *     sembolüyle, bilinmeyen fiyatta 'NaN'.
 *
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen sayı 0 DEĞİL bilinmiyordur.
 */
import { describe, it, expect, vi } from 'vitest';
import { siparisKarliligi, mesajTutari, kalemlerTutari, stokKartiBul, satirCirosu } from './siparisKarlilik';
import { siparisMaliyeti, ekranTutari } from '../para';
import { kartMaliyetiTL } from '../cost';
import type { Order, InventoryItem } from '../../types';

// ── Türkçe fikstür ────────────────────────────────────────────────────────────
const CIMENTO = { id: 'k1', sku: 'CIM-50', name: 'ÇİMENTO 50KG', price: 500, quantity: 10, costPrice: 300 };
const DEMIR = { id: 'k2', sku: 'DMR-12', name: 'NERVÜRLÜ DEMİR 12MM', price: 1200, quantity: 5, costPrice: 800 };

const siparis = (o: Record<string, unknown> = {}) => ({
  id: 'sip-1',
  customerName: 'Şirin İnşaat Ltd. Şti.',
  totalPrice: 11000,                                   // Cetpa-native: totalPrice === Σ price×quantity
  lineItems: [{ ...CIMENTO }, { ...DEMIR }],
  ...o,
});

const KURLAR = { USD: 40, EUR: 44 };

describe('siparisKarliligi — SAYFA PARİTESİ (bilinen girdide sayı eskiyle birebir)', () => {
  it('Phase 513 popup: ciro/maliyet/kâr ve %.1f marj eski hesapla aynı', () => {
    const o = siparis();
    const k = siparisKarliligi(o);

    // eski kod: revenue = totalPrice (11000) · cogs = Σ costPrice×qty · margin = gp/revenue*100
    const eskiRevenue = 11000;
    const eskiCogs = 300 * 10 + 800 * 5;               // 7000
    const eskiGp = eskiRevenue - eskiCogs;             // 4000
    const eskiMargin = (eskiGp / eskiRevenue) * 100;   // 36.3636…

    expect(k.ciro).toBe(11000);
    expect(k.maliyet).toBe(eskiCogs);
    expect(k.kar).toBe(eskiGp);
    expect(k.marjYuzde).not.toBeNull();
    expect(k.marjYuzde!.toFixed(1)).toBe(eskiMargin.toFixed(1));   // '36.4'
    expect(k.maliyetsizKalem).toBe(0);
  });

  it('Phase 74 kutusu: Σ price×quantity cirosu ve tam sayı marj eskiyle aynı', () => {
    const k = siparisKarliligi(siparis());
    const eskiRevenue = 500 * 10 + 1200 * 5;           // 11000
    const eskiCost = 300 * 10 + 800 * 5;               // 7000
    const eskiGpPct = Math.round(((eskiRevenue - eskiCost) / eskiRevenue) * 100);   // 36

    expect(k.ciro).toBe(eskiRevenue);
    expect(Math.round(k.marjYuzde!)).toBe(eskiGpPct);
  });

  it('satır kırılımı (popup alt listesi) eski liRev/liCost ile aynı', () => {
    const k = siparisKarliligi(siparis());
    expect(k.satirlar.map(s => s.ciro)).toEqual([5000, 6000]);
    expect(k.satirlar.map(s => s.maliyet)).toEqual([3000, 4000]);
    expect(k.satirlar.map(s => s.kar)).toEqual([2000, 2000]);
  });

  it('maliyet, para.siparisMaliyeti ile BİREBİR aynı (tek COGS kaynağı — kopya kural yok)', () => {
    const o = siparis();
    expect(siparisKarliligi(o).maliyet).toBe(siparisMaliyeti(o));
  });
});

describe('siparisKarliligi — maliyeti bilinmeyen kalem (mutasyon-ayırt-edici)', () => {
  it('costPrice YOK → maliyet/kâr hesaplanmaz, marj null, kalem sayılır (eski: `?? 0` → sahte 0 maliyet)', () => {
    const k = siparisKarliligi(siparis({ lineItems: [{ ...CIMENTO }, { ...DEMIR, costPrice: undefined }] }));

    expect(Number.isNaN(k.maliyet)).toBe(true);
    expect(Number.isNaN(k.kar)).toBe(true);
    expect(k.marjYuzde).toBeNull();
    expect(k.maliyetsizKalem).toBe(1);

    // eski Phase 74: cost = 3000 + (undefined ?? 0)*5 = 3000 → %73 marj basıyordu
    expect(k.maliyet).not.toBe(3000);
    expect(k.marjYuzde).not.toBe(73);
  });

  it('KARIŞIK sipariş eski `hasCost` kapısını geçiyordu — artık marj çizilmez (mutasyon-ayırt-edici)', () => {
    const karisik = siparis({ lineItems: [{ ...CIMENTO }, { ...DEMIR, costPrice: null }] });
    const eskiHasCost = karisik.lineItems.some((l: { costPrice?: unknown }) => ((l.costPrice ?? 0) as number) > 0);
    expect(eskiHasCost).toBe(true);                    // eski kapı AÇIK → şişik marj gösteriliyordu

    const k = siparisKarliligi(karisik);
    expect(k.marjYuzde).toBeNull();                    // yeni: hesaplanmaz
    expect(k.maliyetsizKalem).toBe(1);
  });

  it('`null * miktar === 0` tuzağı: costPrice null, miktar 4 → 0 DEĞİL bilinmiyor', () => {
    const k = siparisKarliligi(siparis({ totalPrice: 2000, lineItems: [{ ...CIMENTO, costPrice: null, price: 500, quantity: 4 }] }));
    expect(Number.isNaN(k.satirlar[0].maliyet)).toBe(true);
    expect(k.satirlar[0].maliyet).not.toBe(0);
    expect(Number.isNaN(k.satirlar[0].kar)).toBe(true);
  });

  it('UYDURMA %60 maliyet oranı kalktı: maliyetsiz kalem `price*0.6` sayılmaz', () => {
    const k = siparisKarliligi(siparis({ lineItems: [{ ...CIMENTO, costPrice: undefined }] }));
    expect(k.satirlar[0].maliyet).not.toBe(500 * 0.6 * 10);   // eski zincirin sonu: 3000
    expect(Number.isNaN(k.satirlar[0].maliyet)).toBe(true);
  });

  it('miktarı bilinmeyen kalem: maliyet de ciro da bilinmiyor, kalem sayılır', () => {
    const k = siparisKarliligi(siparis({ lineItems: [{ ...CIMENTO, quantity: null }] }));
    expect(Number.isNaN(k.ciro)).toBe(true);
    expect(Number.isNaN(k.maliyet)).toBe(true);
    expect(k.maliyetsizKalem).toBe(1);
  });

  it('costPrice 0 MEŞRU bir maliyettir (promosyon/bedelsiz) — bilinmiyor sayılmaz', () => {
    const k = siparisKarliligi(siparis({ totalPrice: 5000, lineItems: [{ ...CIMENTO, costPrice: 0 }] }));
    expect(k.maliyet).toBe(0);
    expect(k.maliyetsizKalem).toBe(0);
    expect(k.kar).toBe(5000);
    expect(k.marjYuzde).toBe(100);
  });

  it('sayısal string maliyet ("300") kabul edilir — Mikro/CSV kaynaklı kayıt', () => {
    const k = siparisKarliligi(siparis({ lineItems: [{ ...CIMENTO, costPrice: '300', price: '500', quantity: '10' }] }));
    expect(k.maliyet).toBe(3000);
    expect(k.ciro).toBe(5000);
  });
});

describe('siparisKarliligi — ciro tabanı (kalem cirosu, KDV dahil başlık tutarı değil)', () => {
  it('Cetpa-native siparişte totalPrice === Σ price×quantity: değişiklik yok', () => {
    expect(siparisKarliligi(siparis()).ciro).toBe(11000);
  });

  it('Mikro faturasından türetilen siparişte başlık tutarı KDV DAHİL — ciro kalemlerden (bilinçli fark)', () => {
    const mikro = siparis({ source: 'mikro-fatura', totalPrice: 12980, lineItems: [{ ...CIMENTO }, { ...DEMIR }] });
    const k = siparisKarliligi(mikro);
    expect(k.ciro).toBe(11000);                        // net kalem cirosu — maliyetle aynı taban
    expect(k.ciro).not.toBe(12980);                    // eski Phase 513: KDV'li ciro → ~%46 şişik marj
    expect(Math.round(k.marjYuzde!)).toBe(36);
  });

  it('kalem fiyatı bilinmiyorsa ciro TÜRETİLMEZ (kısmi toplamdan kâr çıkarılmaz)', () => {
    const k = siparisKarliligi(siparis({ lineItems: [{ ...CIMENTO }, { ...DEMIR, price: undefined }] }));
    expect(Number.isNaN(k.ciro)).toBe(true);
    expect(k.ciro).not.toBe(5000);
    expect(k.marjYuzde).toBeNull();
  });

  it('kalemi OLMAYAN siparişte ciro başlık tutarından okunur; maliyet/kâr bilinmez', () => {
    const k = siparisKarliligi({ totalPrice: 7500, lineItems: [] });
    expect(k.ciro).toBe(7500);
    expect(Number.isNaN(k.maliyet)).toBe(true);
    expect(Number.isNaN(k.kar)).toBe(true);
    expect(k.marjYuzde).toBeNull();
    expect(k.maliyetsizKalem).toBe(0);
    expect(siparisKarliligi({ totalAmount: 7500 }).ciro).toBe(7500);   // siparisTutari yedeği
  });

  it('tutarı hiç bilinmeyen sipariş: ciro 0 DEĞİL bilinmiyor (eski `totalPrice || 0` → "%0,0" rozeti)', () => {
    const k = siparisKarliligi({ totalPrice: undefined, lineItems: [] });
    expect(Number.isNaN(k.ciro)).toBe(true);
    expect(k.ciro).not.toBe(0);
    expect(k.marjYuzde).toBeNull();
    expect(k.marjYuzde).not.toBe(0);
  });

  it('ciro 0 ya da negatifse marj yüzdesi yok (0\'a bölme) ama kâr biliniyor', () => {
    const k = siparisKarliligi({ lineItems: [{ price: 0, quantity: 10, costPrice: 300 }] });
    expect(k.ciro).toBe(0);
    expect(k.kar).toBe(-3000);
    expect(k.marjYuzde).toBeNull();
  });
});

describe('siparisKarliligi — stok maliyeti çözücü (opsiyonel)', () => {
  it('kalemin kendi costPrice\'ı yoksa çözücü kullanılır', () => {
    const k = siparisKarliligi(siparis({ lineItems: [{ ...CIMENTO, costPrice: undefined }] }), () => 320);
    expect(k.maliyet).toBe(3200);
    expect(k.maliyetsizKalem).toBe(0);
  });

  it('çözücü bilinmeyen dönerse (kur yok / stokta eşleşme yok) kalem maliyetsiz sayılır', () => {
    for (const cevap of [null, undefined, NaN, '']) {
      const k = siparisKarliligi(siparis({ lineItems: [{ ...CIMENTO, costPrice: undefined }] }), () => cevap);
      expect(Number.isNaN(k.maliyet)).toBe(true);
      expect(k.maliyetsizKalem).toBe(1);
    }
  });

  it('çözücü SAYFANIN kalem tipini aynen alır — `as` gerekmeden li.inventoryId/li.sku okunur', () => {
    // Derleme-zamanı sözleşmesi (generic S): sayfadaki stok arama tam bu biçimde yazılacak.
    const sayfaKalemi = { id: 'k1', sku: 'CIM-50', name: 'ÇİMENTO 50KG', price: 500, quantity: 10, inventoryId: 'stk-9' };
    const stok = [{ id: 'stk-9', sku: 'CIM-50', tlMaliyet: 310 }];
    const k = siparisKarliligi({ totalPrice: 5000, lineItems: [sayfaKalemi] }, li => {
      const inv = stok.find(i => i.id === li.inventoryId || i.sku === li.sku);
      return inv ? inv.tlMaliyet : null;
    });
    expect(k.maliyet).toBe(3100);
    expect(k.kar).toBe(1900);
  });

  it('kanonik `Order` tipiyle derlenir — OrdersPage çağrısının derleme-zamanı provası', () => {
    const o: Order = {
      id: 'sip-9', customerName: 'Şirin İnşaat Ltd. Şti.', totalPrice: 5000,
      status: 'Processing', customerType: 'B2B',
      lineItems: [{ id: 'k1', sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 10, price: 500, inventoryId: 'stk-9' }],
    };
    const k = siparisKarliligi(o, li => (li.inventoryId === 'stk-9' ? 310 : null));
    expect(k.maliyet).toBe(3100);
    expect(kalemlerTutari(o).toplam).toBe(5000);
    expect(mesajTutari(o, 'TRY', KURLAR)).toBe('₺5.000');
  });

  it('kalemin kendi costPrice\'ı varsa çözücüye HİÇ sorulmaz', () => {
    const cozucu = vi.fn(() => 999);
    const k = siparisKarliligi(siparis({ lineItems: [{ ...CIMENTO }] }), cozucu);
    expect(cozucu).not.toHaveBeenCalled();
    expect(k.maliyet).toBe(3000);
  });
});

describe('mesajTutari — müşteriye giden metindeki tutar', () => {
  it('PARİTE: TL ve döviz tutarı eski paraYaz(…, {ondalik: 0}) biçiminde', () => {
    expect(mesajTutari(siparis(), 'TRY', KURLAR)).toBe('₺11.000');
    expect(mesajTutari(siparis(), 'USD', KURLAR)).toBe('$275');       // 11000 / 40
  });

  it('tutarı bilinmeyen sipariş "₺0" DEĞİL \'—\' (mutasyon-ayırt-edici: eski `totalPrice || 0`)', () => {
    const m = mesajTutari({ totalPrice: undefined }, 'TRY', KURLAR);
    expect(m).toBe('—');
    expect(m).not.toBe('₺0');
  });

  it('kur yoksa \'—\' — TL tutarı yabancı sembolle basılmaz', () => {
    expect(mesajTutari(siparis(), 'USD', null)).toBe('—');
    expect(mesajTutari(siparis(), 'USD', { USD: 0 })).toBe('—');
  });

  it('PARİTE: ödeme hatırlatması 2 ondalıkla yazar (paraYaz varsayılanı)', () => {
    expect(mesajTutari(siparis(), 'TRY', KURLAR, 2)).toBe('₺11.000,00');
  });

  it('TL\'de de tutar kapısı çalışır — eski kod `kpiCurrency === \'TRY\'` dalında kurCevir\'i atlıyordu', () => {
    // eski: cv = o.totalPrice (undefined) → `cv === null` FALSE → paraYaz(undefined) = '—'
    // müşteriye giden hatırlatma metnine akıyordu ("… için — tutarındaki ödemeniz").
    expect(mesajTutari({ totalPrice: undefined }, 'TRY', KURLAR, 2)).toBe('—');
  });

  it('totalAmount yedeği ve MEŞRU 0 tutar', () => {
    expect(mesajTutari({ totalAmount: 5000 }, 'TRY', KURLAR)).toBe('₺5.000');
    expect(mesajTutari({ totalPrice: 0 }, 'TRY', KURLAR)).toBe('₺0');   // bedelsiz numune — '—' değil
  });
});

describe('kalemlerTutari — kalem tablosu alt toplamı (EKRAN sözleşmesi)', () => {
  it('PARİTE: tüm kalemler biliniyorsa Σ price×quantity', () => {
    const t = kalemlerTutari(siparis());
    expect(ekranTutari(t)).toBe(11000);
    expect(t.bilinmeyen).toBe(0);
  });

  it('bir kalem bilinmiyorsa KISMİ toplam + sayaç (ekran notu için) — NaN değil', () => {
    const t = kalemlerTutari(siparis({ lineItems: [{ ...CIMENTO }, { ...DEMIR, price: null }] }));
    expect(ekranTutari(t)).toBe(5000);
    expect(t.bilinmeyen).toBe(1);
  });

  it('hiç bilinen kalem yoksa ekran değeri NaN → \'—\' (eski: "$NaN")', () => {
    const t = kalemlerTutari(siparis({ lineItems: [{ ...CIMENTO, price: undefined }] }));
    expect(Number.isNaN(ekranTutari(t))).toBe(true);
  });

  it('kalemsiz sipariş: gerçek 0, sayaçlar boş', () => {
    const t = kalemlerTutari({ lineItems: [] });
    expect(ekranTutari(t)).toBe(0);
    expect(t.bilinmeyen).toBe(0);
  });
});

/**
 * SAYFA KABLOLAMASI — OrdersPage.tsx:284-292'deki stok maliyeti çözücüsünün sözleşmesi.
 *
 * Hakem bulgusu (2026-09-19): çözücü `maliyetDurumu(...).durum === 'tl' ? d.tl : null` idi.
 * O süzgeç yalnız KUR çevrilememesini eliyor, EKSİK maliyeti elemiyordu: maliyeti hiç girilmemiş
 * stok kartı `{durum:'tl', tl:0}` döndüğü için çözücü 0 veriyor, bu modül 0'ı meşru maliyet sayıyor
 * ve marj %100 yeşil çıkıyordu. Üstelik Phase 74 kutusu eskiden native siparişte HİÇ çizilmiyordu
 * (`hasCost` yalnız kalemin kendi costPrice'ına bakıyor, AddOrderModal hiç yazmıyordu) — yani bu
 * sahte sayı yeni bir yüzeyde REGRESYON olacaktı. Çözücü artık `kartMaliyetiTL` (cost.ts).
 */
describe('stokKartiBul — BOŞ SKU hiçbir kartla eşleşmez', () => {
  const kart = (o: Record<string, unknown>) => ({ id: 'i1', sku: 'CIM-50', name: 'ÇİMENTO 50KG', ...o });

  it('inventoryId ile eşleşir', () => {
    const kartlar = [kart({ id: 'i1', sku: 'CIM-50' }), kart({ id: 'i2', sku: 'DMR-12' })];
    expect(stokKartiBul(kartlar, { inventoryId: 'i2' })?.id).toBe('i2');
  });

  it('PARİTE: kimlik ile SKU farklı kartı gösteriyorsa listedeki İLK eşleşme döner', () => {
    // Sayfadaki `find(i => i.id === li.inventoryId || i.sku === li.sku)` OR'dur; kimliğe
    // öncelik vermek DAVRANIŞ DEĞİŞİKLİĞİ olurdu — bu turda bilerek yapılmadı (bkz. acikSorular).
    const kartlar = [kart({ id: 'i1', sku: 'CIM-50' }), kart({ id: 'i2', sku: 'DMR-12' })];
    expect(stokKartiBul(kartlar, { inventoryId: 'i2', sku: 'CIM-50' })?.id).toBe('i1');
  });

  it('kimlik yoksa SKU ile eşleşir (parite)', () => {
    const kartlar = [kart({ id: 'i1', sku: 'CIM-50' }), kart({ id: 'i2', sku: 'DMR-12' })];
    expect(stokKartiBul(kartlar, { sku: 'DMR-12' })?.id).toBe('i2');
  });

  it('BOŞ SKU + SKU\'su boş kart → eşleşme YOK — mutasyon-ayırt-edici', () => {
    // `i.sku === li.sku` kuralı '' === '' olduğu için serbest satırı (nakliye bedeli, kanal
    // siparişi kalemi) katalogdaki SKU'suz İLK karta bağlıyor ve o kartın maliyetini
    // "bilinen maliyet" diye döndürüyordu → sahte yeşil marj (2026-09-19 delta bulgusu).
    const kartlar = [kart({ id: 'ix', sku: '', costPrice: 95 }), kart({ id: 'i1', sku: 'CIM-50' })];
    expect(stokKartiBul(kartlar, { sku: '' })).toBeNull();
    expect(stokKartiBul(kartlar, { sku: '   ' })).toBeNull();
    expect(stokKartiBul(kartlar, {})).toBeNull();
    expect(stokKartiBul(kartlar, { sku: undefined, inventoryId: undefined })).toBeNull();
  });

  it('boş inventoryId de eşleşmez (kartın id\'si boşsa bile)', () => {
    const kartlar = [kart({ id: '', sku: 'BOS' })];
    expect(stokKartiBul(kartlar, { inventoryId: '' })).toBeNull();
  });

  it('MUTASYON-AYIRT EDİCİ: kimlik DOLU + SKU boşken, SKU\'su boş kart araya GİREMEZ', () => {
    // `sku !== null &&` kapısı yalnız "ikisi de boş" erken dönüşüyle korunuyor sanılmıştı; o
    // dönüş bu vakayı kapsamıyor (kimlik dolu). Kapı düşerse `eslesmeAnahtari(k.sku) === sku`
    // yani `null === null` ile listedeki İLK SKU'suz kart eşleşir ve kalem kendi kartına değil,
    // ilgisiz bir karta bağlanır. Bu, AddOrderModal'ın OLAĞAN yoludur: kalemde `inventoryId`
    // var, `sku` '' olabiliyor (2026-09-19 kapanış bulgusu).
    const kartlar = [kart({ id: 'ix', sku: '', costPrice: 95 }), kart({ id: 'i2', sku: '', costPrice: 300 })];
    expect(stokKartiBul(kartlar, { inventoryId: 'i2', sku: '' })?.id).toBe('i2');
  });

  it('MUTASYON-AYIRT EDİCİ: SİLİNMİŞ kart + boş SKU → eşleşme YOK (ilgisiz karta düşmez)', () => {
    const kartlar = [kart({ id: 'ix', sku: '', costPrice: 95 })];
    expect(stokKartiBul(kartlar, { inventoryId: 'silinmis-kart', sku: '' })).toBeNull();
  });

  it('silinmiş kart + boş SKU kârlılıkta MALİYETSİZ: kâr/marj çizilmez (yeşil rozet yok)', () => {
    const kartlar = [{ id: 'ix', sku: '', name: 'Nakliye bedeli', costPrice: 95 }] as InventoryItem[];
    const k = siparisKarliligi(
      siparis({ totalPrice: 1500, lineItems: [{ inventoryId: 'silinmis-kart', sku: '', price: 1500, quantity: 1 }] }),
      (li: { inventoryId?: unknown; sku?: unknown }) => {
        const inv = stokKartiBul(kartlar, li);
        return inv ? kartMaliyetiTL(inv, KURLAR) : null;
      },
    );
    expect(k.maliyetsizKalem).toBe(1);
    expect(k.marjYuzde).toBeNull();
  });

  it('eşleşmeyen SKU → null', () => {
    expect(stokKartiBul([kart({})], { sku: 'YOK-1' })).toBeNull();
  });

  it('SKU\'su boş satır kârlılıkta MALİYETSİZ sayılır (kâr/marj çizilmez)', () => {
    const kartlar = [{ id: 'ix', sku: '', name: 'Elle açılmış kart', costPrice: 95 }] as InventoryItem[];
    const k = siparisKarliligi(
      siparis({ totalPrice: 1500, lineItems: [{ sku: '', price: 1500, quantity: 1 }] }),
      (li: { inventoryId?: unknown; sku?: unknown }) => {
        const inv = stokKartiBul(kartlar, li);
        return inv ? kartMaliyetiTL(inv, KURLAR) : null;
      },
    );
    expect(k.maliyetsizKalem).toBe(1);
    expect(k.marjYuzde).toBeNull();
  });
});

describe('SAYFA KABLOLAMASI — stok kartı maliyet çözücüsü (OrdersPage 284-292)', () => {
  const stokKarti = (o: Partial<InventoryItem>) =>
    ({ id: 'i1', name: 'ÇİMENTO 50KG', sku: 'CIM-50', ...o }) as InventoryItem;

  /** Sayfadaki çözücünün birebir aynısı (kalem → stok kartı → TL maliyet). */
  const cozucu = (envanter: InventoryItem[]) => (li: { inventoryId?: unknown; sku?: unknown }) => {
    const inv = stokKartiBul(envanter, li);
    if (!inv) return null;
    return kartMaliyetiTL(inv, KURLAR);
  };

  const cimentoSiparisi = siparis({
    totalPrice: 11000,
    lineItems: [{ sku: 'CIM-50', price: 110, quantity: 100 }],   // kalemin KENDİ costPrice'ı yok
  });

  it('stok kartında maliyet YOKSA kâr türetilmez, Phase 74 kutusu çizilmez', () => {
    const k = siparisKarliligi(cimentoSiparisi, cozucu([stokKarti({})]));
    expect(k.ciro).toBe(11000);
    expect(Number.isNaN(k.maliyet)).toBe(true);
    expect(Number.isNaN(k.kar)).toBe(true);
    expect(k.marjYuzde).toBeNull();                       // eski süzgeçte 100 çıkıyordu (yeşil rozet)
    expect(k.maliyetsizKalem).toBe(1);                    // "1 kalemin maliyeti bilinmiyor" notu
    expect(k.maliyetsizKalem).toBe(k.satirlar.length);    // kutu `return null` ile hiç çizilmez
  });

  it('kartta costPrice 0 da GİRİLMEMİŞ sayılır — %100 marj üretmez', () => {
    const k = siparisKarliligi(cimentoSiparisi, cozucu([stokKarti({ costPrice: 0 })]));
    expect(k.marjYuzde).toBeNull();
    expect(k.maliyetsizKalem).toBe(1);
  });

  it('PARİTE: kartta maliyet varsa sayı eskiyle birebir aynı', () => {
    const k = siparisKarliligi(cimentoSiparisi, cozucu([stokKarti({ costPrice: 70 })]));
    expect(k.maliyet).toBe(7000);                         // 70 × 100
    expect(k.kar).toBe(4000);
    expect(k.marjYuzde).toBeCloseTo(36.3636, 3);
    expect(k.maliyetsizKalem).toBe(0);
  });

  it('kartta USD maliyet var ama KUR yoksa yine bilinmiyor (0 değil)', () => {
    const inv = [stokKarti({ costPrice: 5, costCurrency: 'USD' })];
    const k = siparisKarliligi(cimentoSiparisi, (li: { sku?: unknown }) => {
      const kart = inv.find(i => i.sku === li.sku);
      return kart ? kartMaliyetiTL(kart, null) : null;    // kur tablosu boş
    });
    expect(k.marjYuzde).toBeNull();
    expect(k.maliyetsizKalem).toBe(1);
  });

  it('kalemin KENDİ costPrice: 0 meşru kalır (promosyon) — çözücüye hiç sorulmaz', () => {
    const cagrildi = vi.fn(() => null);
    const k = siparisKarliligi(
      siparis({ totalPrice: 11000, lineItems: [{ sku: 'CIM-50', price: 110, quantity: 100, costPrice: 0 }] }),
      cagrildi,
    );
    expect(cagrildi).not.toHaveBeenCalled();
    expect(k.maliyet).toBe(0);
    expect(k.marjYuzde).toBe(100);
    expect(k.maliyetsizKalem).toBe(0);
  });
});

// İnceleme 2026-09-25 (CONFIRMED): sürüm-2 Mikro kaleminde `price` yok → ciro NaN idi. Artık KDV hariç `netTutar`;
// eski kalem (yalnız KDV dâhil total) bilinmez kalır — KDV dâhil tutar kârı şişirmesin.
describe('satirCirosu — sürüm-2 Mikro kalemi KDV hariç net', () => {
  it('netTutar varsa o; native price × quantity; yalnız total (eski Mikro) NaN', () => {
    expect(satirCirosu({ netTutar: 18000, quantity: 100 })).toBe(18000);
    expect(satirCirosu({ price: 5, quantity: 3 })).toBe(15);
    expect(Number.isNaN(satirCirosu({ quantity: 100, total: 21600 } as never))).toBe(true);
  });
  it('siparisKarliligi v2 kalemde ciro = Σ netTutar (KDV hariç), maliyet bilinirse kâr üretir', () => {
    const k = siparisKarliligi({ lineItems: [{ netTutar: 900, quantity: 10, costPrice: 60 }, { netTutar: 100, quantity: 1, costPrice: 50 }] } as never);
    expect(k.ciro).toBe(1000);
    expect(k.maliyet).toBe(650);
    expect(k.kar).toBe(350);
    expect(kalemlerTutari({ lineItems: [{ netTutar: 900, quantity: 10 }] } as never).toplam).toBe(900);
  });
});
