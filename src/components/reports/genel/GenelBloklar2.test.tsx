/**
 * GenelBloklar2.test.tsx — Finansal Sağlık (P239) ve Ödeme Yöntemi Dağılımı (P249) panelleri, bileşen GERÇEKTEN çizilerek
 * (6c inceleme 1, 2026-10-17).
 *
 * Neden render testi: `rapor6c.degismez` kaynakta VARLIK / YOKLUK çitler, ekrana basılan harfi ve metni kanıtlayamaz. Bu
 * dosyadaki dört bulgu ekran davranışıdır:
 *   (1) «Inventory» harfi kalemsiz (Mikro türevi) sipariş varken KISMİ COGS'tan hesaplanıyordu → harf verilmez ('—').
 *   (2) Aynı dövizli cümlesi iki satırda basılıyordu (pencere ↔ Cetpa alacağı) → alacak satırı «Cetpa alacağı: » önekli.
 *   (3) Türkçe «eksik bileşen» cümlesine İngilizce kutu adları giriyordu → her bileşenin dile göre `eksikAdi`'si.
 *   (4) Ödeme yöntemi enum kodu ham basılıyordu («bank_transfer») → `siparisler/odemeYontemi.odemeYontemiEtiketi`.
 *
 * Beklenen metinler sözlükten / not modülünden okunur (`oc`, `op`, `kapsamNotu`); cümle tablosu değişirse bu dosya değil
 * sahibinin testi kırılsın. Fikstürler Türkçe ve inşaat malzemesi (ÇİMENTO 50KG, İÇ CEPHE BOYASI 15LT).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import GenelBloklar2 from './GenelBloklar2';
import type { InventoryItem, Order } from '../../../types';
import { kisaTutar } from '../../../utils/currency';
import { kapsamNotu } from '../../../utils/rapor/kapsamNotu';
import { oc } from '../../../i18n/ortak';
import { op } from '../../../i18n/orders';

type Props = ComponentProps<typeof GenelBloklar2>;

/** Ekrandaki `fmtAna` ile AYNI biçimleyici (TRY, kur gerekmez). */
const fmtAna: Props['fmtAna'] = (v, fmt = 'full', ondalik = 0) => kisaTutar(v, { fmt, ondalik, birim: 'TRY', rates: null });

const BUGUN = new Date();

let sira = 0;
/** Kanonik sipariş — her alan açık; varsayılan bugün tarihli, teslim edilmiş, ödenmiş TL siparişi. */
const siparis = (ek: Partial<Order>): Order => {
  sira += 1;
  return {
    id: `sip-${sira}`, customerName: 'Şirin İnşaat', totalPrice: 1000, status: 'Delivered', customerType: 'B2B',
    createdAt: BUGUN, paid: true, ...ek,
  };
};

/** Çalışma anı TRY dışı mağaza siparişi: sunucu `totalPrice` YAZMAZ (`types.ts` `Order.totalPrice` yorumu, O21). */
const dovizliSiparis = (): Order => {
  const { totalPrice: _yok, ...govde } = siparis({
    source: 'shopify_webhook', paraBirimi: 'EUR', dovizTutar: 50, status: 'Pending', paid: false, customerName: 'Ayşe Öztürk',
    lineItems: [{ id: 'k-eur', sku: '', name: 'Fırça Seti', quantity: 1, price: 50 }],
  });
  void _yok;
  return govde as Order;   // tip `totalPrice`'ı zorunlu sayıyor; çalışma anında alan YOK (gerçek mağaza kaydı biçimi)
};

/** ÇİMENTO 50KG kalemi — kalemin kendi maliyeti YOK, maliyet stok kartından (₺60). */
const cimentoKalemi = (adet: number) => [{ id: 'k-cim', sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: adet, price: 100 }];

/** Kalemli sipariş: 10 torba × ₺100 → ciro ₺1.000, COGS 10 × ₺60 = ₺600. */
const kalemliSiparis = (ek: Partial<Order> = {}): Order => siparis({ totalPrice: 1000, lineItems: cimentoKalemi(10), ...ek });
/** Kalemsiz (Mikro faturasından türetilen) sipariş — maliyeti BİLİNMİYOR. */
const kalemsizSiparis = (): Order => siparis({ source: 'mikro-fatura', totalPrice: 2000, customerName: 'Yıldız Yapı' });

const kart = (ek: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'sku' | 'name'>): InventoryItem => ({
  stockLevel: 0, lowStockThreshold: 5, prices: {}, costPrice: 0, ...ek,
});
/** Stok değeri ₺6.150 = ÇİMENTO 100 × ₺60 + İÇ CEPHE BOYASI 15 × ₺10. */
const STOK_6150: InventoryItem[] = [
  kart({ id: 'inv-cim', sku: 'CIM-50', name: 'ÇİMENTO 50KG', stockLevel: 100, costPrice: 60 }),
  kart({ id: 'inv-boya', sku: 'BOYA-15', name: 'İÇ CEPHE BOYASI 15LT', stockLevel: 15, costPrice: 10 }),
];

function ciz(orders: Order[], inventory: InventoryItem[], currentLanguage: 'tr' | 'en' = 'tr') {
  return render(
    <GenelBloklar2 reportsTab="genel" orders={orders} inventory={inventory} employees={[]} exchangeRates={null}
      currentLanguage={currentLanguage} fmtAna={fmtAna} leadCariKodu={undefined} />,
  );
}

/** Başlığı verilen panelin kartı (`.apple-card`). */
function panel(baslik: string): HTMLElement {
  const k = screen.getByText(baslik).closest('.apple-card');
  if (!(k instanceof HTMLElement)) throw new Error(`panel bulunamadı: ${baslik}`);
  return k;
}

/** Finansal Sağlık kutusunun harf rozeti (etiketin yanındaki `<span>`). */
function harf(etiket: string, baslik = '🏦 Finansal Sağlık Göstergesi'): string | null {
  const satir = within(panel(baslik)).getByText(etiket).parentElement;
  return satir?.querySelector('span')?.textContent ?? null;
}

/** Kart içinde metni TAM olarak verilen `<p>` sayısı (alt dize değil). */
const paragrafSayisi = (k: HTMLElement, metin: string) => [...k.querySelectorAll('p')].filter(p => p.textContent === metin).length;

describe('P239 Finansal Sağlık — (1) «Inventory» harfi kalemsiz siparişte verilmez', () => {
  it('1 kalemli + 5 kalemsiz sipariş, stok ₺6.150 → harf \'—\' (kısmi COGS ₺600 ile eskiden \'C\' çıkıyordu)', () => {
    ciz([kalemliSiparis(), ...Array.from({ length: 5 }, kalemsizSiparis)], STOK_6150);
    expect(harf('Inventory')).toBe('—');
    // Kutu değeri değişmez: stok değeri basılmaya devam eder.
    expect(within(panel('🏦 Finansal Sağlık Göstergesi')).getByText(fmtAna(6150, 'K', 0))).toBeInTheDocument();
    // Kalemsiz sayısı mevcut notta (yeni metin yok).
    const not = kapsamNotu({ kalemsiz: 5 }, { birim: 'siparis', dil: 'tr' });
    expect(not).not.toBeNull();
    expect(paragrafSayisi(panel('🏦 Finansal Sağlık Göstergesi'), not ?? '')).toBe(1);
  });

  it('PARİTE: kalemsiz sipariş yokken harf eski formülle BİREBİR (5 × COGS ₺600 = ₺3.000; ₺6.150 ≤ ₺7.500 → B)', () => {
    ciz(Array.from({ length: 5 }, () => kalemliSiparis()), STOK_6150);
    expect(harf('Inventory')).toBe('B');
    expect(harf('Gross Margin')).toBe('A');   // %40 — eşik `>= 30`
  });

  it('O20 değişmedi: AR harfi hâlâ yok → genel not \'—\' (iki vakada da)', () => {
    ciz(Array.from({ length: 5 }, () => kalemliSiparis()), STOK_6150);
    const baslik = within(panel('🏦 Finansal Sağlık Göstergesi')).getByText('🏦 Finansal Sağlık Göstergesi');
    expect(baslik.parentElement?.querySelector('span')?.textContent).toBe('—');
  });
});

describe('P239 Finansal Sağlık — (3) «eksik bileşen» cümlesi arayüz dilinde', () => {
  it('TR: kalemsiz siparişli vakada eksikler Türkçe adla, girdi sırasıyla (Alacak → Stok değeri)', () => {
    ciz([kalemliSiparis(), ...Array.from({ length: 5 }, kalemsizSiparis)], STOK_6150);
    expect(paragrafSayisi(panel('🏦 Finansal Sağlık Göstergesi'),
      'Genel not verilmedi — eksik bileşen: Alacak (Mikro cari bakiyesi bu ekrana bağlı değil), Stok / satılan malın maliyeti oranı')).toBe(1);
  });

  it('TR: dört bileşen de bilinmiyorsa dört Türkçe ad (İngilizce kutu etiketi cümleye girmez)', () => {
    // Tek sipariş tutarsız + kalemi katalogda yok + kalemsiz sipariş → marj, 3 aylık ciro, alacak, stok / COGS oranı bilinmiyor.
    const tutarsiz = siparis({ totalPrice: Number.NaN, lineItems: [{ id: 'k-x', sku: 'YOK-1', name: 'Nakliye bedeli', quantity: 1, price: 750 }] });
    ciz([tutarsiz, ...Array.from({ length: 4 }, kalemsizSiparis)], STOK_6150);
    expect(paragrafSayisi(panel('🏦 Finansal Sağlık Göstergesi'),
      'Genel not verilmedi — eksik bileşen: Brüt marj, 3 aylık ciro, Alacak (Mikro cari bakiyesi bu ekrana bağlı değil), Stok / satılan malın maliyeti oranı')).toBe(1);
  });

  it('EN: metin eskisiyle BİREBİR (kutu etiketleri + AR açıklaması)', () => {
    const tutarsiz = siparis({ totalPrice: Number.NaN, lineItems: [{ id: 'k-x', sku: 'YOK-1', name: 'Nakliye bedeli', quantity: 1, price: 750 }] });
    ciz([tutarsiz, ...Array.from({ length: 4 }, kalemsizSiparis)], STOK_6150, 'en');
    expect(paragrafSayisi(panel('🏦 Financial Health Dashboard'),
      'No overall grade — missing: Gross Margin, Revenue Trend, AR Health (Mikro account balance not connected to this screen), Inventory')).toBe(1);
  });
});

describe('P239 Finansal Sağlık — (2) dövizli cümlesi iki satırda ayırt edilir', () => {
  it('4 TL siparişi + 1 ödenmemiş bugünkü EUR siparişi: «Cetpa alacağı: …» TAM bir kez, öneksiz pencere cümlesi TAM bir kez', () => {
    ciz([...Array.from({ length: 4 }, () => kalemliSiparis()), dovizliSiparis()], STOK_6150);
    const k = panel('🏦 Finansal Sağlık Göstergesi');
    const cumle = kapsamNotu({ dovizli: 1 }, { birim: 'siparis', dil: 'tr' });
    expect(cumle).toBe('1 siparişin para birimi TL değil — toplanmadı');
    expect(paragrafSayisi(k, `Cetpa alacağı: ${cumle}`)).toBe(1);
    expect(paragrafSayisi(k, cumle ?? '')).toBe(1);
  });

  it('EN: önek «Cetpa receivable: »', () => {
    ciz([...Array.from({ length: 4 }, () => kalemliSiparis()), dovizliSiparis()], STOK_6150, 'en');
    const k = panel('🏦 Financial Health Dashboard');
    const cumle = kapsamNotu({ dovizli: 1 }, { birim: 'siparis', dil: 'en' });
    expect(paragrafSayisi(k, `Cetpa receivable: ${cumle}`)).toBe(1);
    expect(paragrafSayisi(k, cumle ?? '')).toBe(1);
  });

  it('dövizli aday yokken alacak satırı HİÇ çizilmez (0 iken düğüm yok)', () => {
    ciz(Array.from({ length: 5 }, () => kalemliSiparis()), STOK_6150);
    const k = panel('🏦 Finansal Sağlık Göstergesi');
    expect([...k.querySelectorAll('p')].filter(p => (p.textContent ?? '').startsWith('Cetpa alacağı:'))).toHaveLength(0);
  });
});

describe('P249 Ödeme Yöntemi Dağılımı — (4) enum kodu yerine sözlük etiketi', () => {
  const yontemli = (): Order[] => [
    siparis({ paymentMethod: 'bank_transfer', totalPrice: 50000 }),
    siparis({ paymentMethod: 'cash', totalPrice: 40000 }),
    siparis({ paymentMethod: 'credit_card', totalPrice: 30000 }),
    siparis({ paymentMethod: 'check', totalPrice: 20000 }),
    siparis({ paymentMethod: 'other', totalPrice: 10000 }),
  ];
  const HAM = ['bank_transfer', 'cash', 'credit_card', 'check', 'other'];

  for (const dil of ['tr', 'en'] as const) {
    it(`${dil.toLocaleUpperCase('tr-TR')}: beş yöntem OrdersPage rozetiyle AYNI sözlük metniyle; ham kod ve \`capitalize\` yok`, () => {
      ciz(yontemli(), STOK_6150, dil);
      const k = panel(dil === 'tr' ? '💳 Ödeme Yöntemi Dağılımı' : '💳 Payment Method Distribution');
      for (const metin of [op(dil).eft, oc(dil).nakit, op(dil).kart, oc(dil).cek, oc(dil).diger]) {
        expect(within(k).getByText(metin), metin).toBeInTheDocument();
      }
      for (const ham of HAM) expect(within(k).queryByText(ham), ham).toBeNull();
      expect(k.querySelectorAll('.capitalize')).toHaveLength(0);
    });
  }

  it('yöntemsiz sipariş «Belirtilmemiş» satırında kalır (parite)', () => {
    ciz([...yontemli().slice(0, 4), siparis({ totalPrice: 5000 })], STOK_6150);
    expect(within(panel('💳 Ödeme Yöntemi Dağılımı')).getByText(oc('tr').belirtilmemis)).toBeInTheDocument();
  });
});
