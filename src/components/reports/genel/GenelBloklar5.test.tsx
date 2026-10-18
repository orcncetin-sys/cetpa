/**
 * GenelBloklar5.test.tsx — P6 «Sales Milestones» merdiven paritesi, bileşen GERÇEKTEN çizilerek (Faz 3 6d bağlama, 2026-10-18;
 * şartname faz3-2n-specs/6n-kesif/6d/baglama-genel-bloklar5.md «Merdiven paritesi testi»). Ek (6d inceleme turu, aynı gün):
 * P4 / P9 yönü yuvarlanmış yüzdeden okunmaz (B1) ve P13 notunun tarihi örneklemesiz seriden gelir (B2) — ikisi de render
 * düzeyinde: yardımcılar doğruydu, hata bileşenin hangi alanı okuduğundaydı.
 *
 * Neden render testi: orkestratör O33 ile basamak `rapor/skor.esikBandi`'den bulunur ve bant tablosu (`basamakBantlari` /
 * `KILOMETRE_BANTLARI`) GenelBloklar5'in dosya başı SABİTİDİR — utils'te değildir, dışa açılmaz (`genel/` bileşenleri yalnız
 * `export default` taşır). `skor.test.ts` yalnız `esikBandi` sözleşmesini kilitler; kaynak taraması tablonun DEĞERİNİ
 * kanıtlayamaz. Bileşen testi ESKİ kodda da koşar: 1–11 eskiyle BİREBİR (parite), 12–16 kararların değiştirdiği yerlerdir
 * (K2 + O28 sayım kümesi, GENEL-2 kısaltma, O26 kısmi ciro, negatif ciro — bilinçli fark 21).
 *
 * Başlık tutarı = kalem toplamı: eski kod ciroyu kalemden, yeni kod başlıktan okur; parite vakaları iki kodda aynı sayıyı verir.
 * Fikstürler Türkçe ve inşaat malzemesi.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import GenelBloklar5 from './GenelBloklar5';
import type { Order } from '../../../types';
import { kisaTutar } from '../../../utils/currency';
import { kapsamNotu } from '../../../utils/rapor/kapsamNotu';
import { yuzdeYaz } from '../../../utils/rapor/bicim';
import { tarihYaz } from '../../../utils/zaman';

type Props = ComponentProps<typeof GenelBloklar5>;

const fmtAna: Props['fmtAna'] = (v, fmt = 'full', ondalik = 0) => kisaTutar(v, { fmt, ondalik, birim: 'TRY', rates: null });
/** Beklenen kısaltılmış tutar metni — testin kendi `fmtAna`'sından (literal yazılmaz). */
const kisa = (v: number) => fmtAna(v, 'K', 0);
/** Bilinen ₺0 tam biçimde basılır (GENEL-2: kısaltma rakamsız kalırsa tam tutar). */
const SIFIR = fmtAna(0, 'full', 0);

const BUGUN = new Date();

let sira = 0;
/** Çimento siparişi: başlık tutarı = tek kalemin tutarı (KDV'siz, iskontosuz — parite fikstürü). */
const siparis = (tutar: number, ek: Partial<Order> = {}): Order => {
  sira += 1;
  return {
    id: `sip-${sira}`, customerName: 'Şirin Yapı', totalPrice: tutar, status: 'Delivered', customerType: 'B2B',
    createdAt: BUGUN, paid: true,
    lineItems: [{ id: `k-${sira}`, sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 1, price: tutar }],
    ...ek,
  };
};
/** Başlığı olmayan sipariş (Mikro meblağı okunamayan fatura gibi): `totalPrice` alanı çalışma anında YOK, kalemleri tam. */
const basliksiz = (kalemTutari: number): Order => {
  const o = siparis(kalemTutari, { customerName: 'Yıldız Yapı Market' });
  Reflect.deleteProperty(o, 'totalPrice');   // `Order` tipi alanı zorunlu tutar; sunucu yazmadığında kayıtta alan hiç yoktur
  return o;
};
const coklu = (n: number, tutar: number, ek: Partial<Order> = {}): Order[] => Array.from({ length: n }, () => siparis(tutar, ek));

function ciz(orders: Order[]) {
  return render(<GenelBloklar5 reportsTab="genel" orders={orders} inventory={[]} currentLanguage="tr" fmtAna={fmtAna} />);
}

function panel(): HTMLElement {
  const k = screen.getByText('🏆 Sales Milestones').closest('.apple-card');
  if (!(k instanceof HTMLElement)) throw new Error('panel bulunamadı: 🏆 Sales Milestones');
  return k;
}

/** P6 bloğu: «değer / hedef» satırı (`.font-bold`) ve uç satırındaki iki etiket («önceki» · «hedef»). */
function blok(etiket: 'Total Orders' | 'Total Revenue'): { deger: string; uclar: string[] } {
  const b = [...panel().querySelectorAll('.space-y-4 > div')].find(d => (d.textContent ?? '').includes(etiket));
  if (!(b instanceof HTMLElement)) throw new Error(`blok bulunamadı: ${etiket}`);
  const deger = b.querySelector('.font-bold');
  const uc = [...b.querySelectorAll('div')].find(d => d.classList.contains('text-[9px]'));
  if (deger === null || uc === undefined) throw new Error(`blok yapısı bulunamadı: ${etiket}`);
  return { deger: deger.textContent ?? '', uclar: [...uc.querySelectorAll('span')].map(s => s.textContent ?? '') };
}
const paragraflar = (k: HTMLElement) => [...k.querySelectorAll('p')].map(p => p.textContent ?? '');

describe('P6 Sales Milestones — merdiven paritesi (K20, O28, O33)', () => {
  // 1–6 · sipariş merdiveni PARİTE: bugünkü `find(m => x < m) ?? son` + `[indexOf(m) − 1] ?? 0` ile BİREBİR (sınır dâhil).
  it.each([
    [9, '9 / 10', ['0', '10']],
    [10, '10 / 50', ['10', '50']],
    [49, '49 / 50', ['10', '50']],
    [4999, '4999 / 5000', ['1000', '5000']],
    [5000, '5000 / 5000', ['1000', '5000']],
    [7000, '7000 / 5000', ['1000', '5000']],
  ])('sipariş parite: %i iptalsiz sipariş → «%s»', (n, deger, uclar) => {
    ciz(coklu(n, 100));
    expect(blok('Total Orders')).toEqual({ deger, uclar });
  });

  // 7–11 · ciro merdiveni PARİTE (tek sipariş; tutar tam bilinir).
  it.each([
    [100_000, 500_000, 100_000],
    [480_000, 500_000, 100_000],
    [9_999_000, 10_000_000, 5_000_000],
    [10_000_000, 10_000_000, 5_000_000],
    [12_000_000, 10_000_000, 5_000_000],
  ])('ciro parite: ₺%i → hedef ₺%i, önceki ₺%i', (ciro, hedef, onceki) => {
    ciz([siparis(ciro)]);
    expect(blok('Total Revenue')).toEqual({ deger: `${kisa(ciro)} / ${kisa(hedef)}`, uclar: [kisa(onceki), kisa(hedef)] });
  });

  it('12 · O28: iptal edilen sipariş basamağa SAYILMAZ (118 + 2 iptal → 118 / 250)', () => {
    ciz([...coklu(118, 100), ...coklu(2, 100, { status: 'Cancelled' })]);
    expect(blok('Total Orders')).toEqual({ deger: '118 / 250', uclar: ['100', '250'] });
  });

  it('13 · O28 + GENEL-2: yalnız iptal → sipariş 0 / 10; ciro bilinen ₺0 tam biçimde (kısaltma «0K» basmaz)', () => {
    ciz([siparis(100, { status: 'Cancelled' })]);
    expect(blok('Total Orders')).toEqual({ deger: '0 / 10', uclar: ['0', '10'] });
    expect(blok('Total Revenue')).toEqual({ deger: `${SIFIR} / ${kisa(100_000)}`, uclar: [SIFIR, kisa(100_000)] });
  });

  it('14 · GENEL-2: merdiven tabanı ucu bilinen ₺0 → tam biçim', () => {
    ciz([siparis(99_000)]);
    expect(blok('Total Revenue')).toEqual({ deger: `${kisa(99_000)} / ${kisa(100_000)}`, uclar: [SIFIR, kisa(100_000)] });
  });

  it('15 · O26: başlığı okunamayan sipariş kalemden HESAPLANMAZ → ciro kısmi, basamak «—», not; sayımda SAYILIR (O28)', () => {
    ciz([siparis(480_000), basliksiz(2_000)]);
    expect(blok('Total Orders')).toEqual({ deger: '2 / 10', uclar: ['0', '10'] });
    expect(blok('Total Revenue')).toEqual({ deger: `${kisa(480_000)} / —`, uclar: ['—', '—'] });
    const not = kapsamNotu({ tutarsiz: 1 }, { birim: 'siparis', dil: 'tr', sonuc: 'ciro basamağı hesaplanmadı' });
    expect(paragraflar(panel()).filter(p => p === not)).toHaveLength(1);
  });

  it('16 · bilinçli fark 21: negatif toplam ciro (iade ağırlıklı) basamak bulamaz → «—»', () => {
    ciz([siparis(-5_000)]);
    expect(blok('Total Revenue')).toEqual({ deger: `${kisa(-5_000)} / —`, uclar: ['—', '—'] });
  });
});

/** Başlığından panel kartı (`.apple-card`). */
function kart(baslik: string): HTMLElement {
  const k = screen.getByText(baslik).closest('.apple-card');
  if (!(k instanceof HTMLElement)) throw new Error(`panel bulunamadı: ${baslik}`);
  return k;
}
/** Tarayıcının bir CSS rengini nasıl normalleştirdiği (jsdom `#ef4444` → `rgb(…)`) — beklenen değer literal yazılmaz. */
const renkNormal = (renk: string): string => { const d = document.createElement('div'); d.style.color = renk; return d.style.color; };
const KIRMIZI = '#ef4444';
const GUN_MS = 86_400_000;

describe('P4 / P9 — yön yuvarlanmış yüzdeden değil karşılaştırmadan (inceleme B1)', () => {
  // Bu ayın 5'i saat 10:00 — `geri` ay önce. Bu ayın siparişi BUGÜN (gelecek tarih yok).
  const ayIci = (geri: number) => new Date(BUGUN.getFullYear(), BUGUN.getMonth() - geri, 5, 10);
  const ayEtiketi = (geri: number) => String(new Date(BUGUN.getFullYear(), BUGUN.getMonth() - geri, 1).getMonth() + 1).padStart(2, '0');
  /** P4 sütunu: ay etiketi (`mt-1`) ve yüzde (`.font-bold`). */
  function sutun(k: HTMLElement, ay: string): HTMLElement {
    const etiket = [...k.querySelectorAll('span')].find(s => s.textContent === ay && s.classList.contains('mt-1'));
    const kutu = etiket?.parentElement;
    const yuzde = kutu?.querySelector('span.font-bold');
    if (!(yuzde instanceof HTMLElement)) throw new Error(`P4 sütunu bulunamadı: ${ay}`);
    return yuzde;
  }

  it('P4 · önceki ay ₺100.000, bu ay ₺99.700 (−%0,3 → −0) → «+-%0» yok, kırmızı «-%0»; artış yeşil kalır', () => {
    // Kapılar: ≥ 10 sipariş, ≥ 3 siparişli ay. İki ay önce 80.000 → geçen ay 100.000 (+%25) → bu ay 99.700.
    ciz([
      ...coklu(4, 20_000, { createdAt: ayIci(2) }),
      ...coklu(4, 25_000, { createdAt: ayIci(1) }),
      ...coklu(2, 49_850, { createdAt: BUGUN }),
    ]);
    const k = kart('Aylık Ciro Artışı');
    expect(k.textContent).not.toContain('+-');
    const buAy = sutun(k, ayEtiketi(0));
    // Beklenen metin bileşenin kendi biçimleyicisinden: yuvarlanmış −0 yüzde (literal yazılmaz).
    expect(buAy.textContent).toBe(yuzdeYaz(Math.round(((99_700 - 100_000) / 100_000) * 100), 0, 'tr'));
    expect(buAy.classList.contains('text-red-500')).toBe(true);
    expect(buAy.classList.contains('text-green-600')).toBe(false);
    // Kâhin: gerçek artış yeşil ve `+` önekli (yön kuralı artışı bozmadı).
    const gecenAy = sutun(k, ayEtiketi(1));
    expect(gecenAy.textContent).toBe(`+${yuzdeYaz(25, 0, 'tr')}`);
    expect(gecenAy.classList.contains('text-green-600')).toBe(true);
  });

  it('P9 · son 90 gün ₺99.700, önceki 90 gün ₺100.000 → ciro kartı «▼» ve kırmızı, «▲» yok', () => {
    ciz([
      ...coklu(4, 25_000, { createdAt: new Date(BUGUN.getTime() - 100 * GUN_MS) }),
      ...coklu(2, 49_850, { createdAt: new Date(BUGUN.getTime() - 10 * GUN_MS) }),
    ]);
    const k = kart('Son 90 Gün ve Önceki 90 Gün');
    const ciro = [...k.querySelectorAll('.rounded-xl')].find(d => d.querySelector('p')?.textContent === 'Revenue');
    const satir = ciro?.querySelectorAll('p')[2];
    if (!(satir instanceof HTMLElement)) throw new Error('P9 ciro kartı bulunamadı');
    expect(satir.textContent).toContain(`▼ ${yuzdeYaz(0, 0, 'tr')}`);
    expect(satir.textContent).not.toContain('▲');
    expect(satir.style.color).toBe(renkNormal(KIRMIZI));
  });

  it('P4 · geçen ay ₺100.000, bu ay ₺100.000 → yeşil «+%0» (eşitlik artış sayılır, eski davranış)', () => {
    ciz([
      ...coklu(4, 20_000, { createdAt: ayIci(2) }),
      ...coklu(4, 25_000, { createdAt: ayIci(1) }),
      ...coklu(2, 50_000, { createdAt: BUGUN }),
    ]);
    const buAy = sutun(kart('Aylık Ciro Artışı'), ayEtiketi(0));
    expect(buAy.textContent).toBe(`+${yuzdeYaz(0, 0, 'tr')}`);
    expect(buAy.classList.contains('text-green-600')).toBe(true);
  });

  it('P9 · iki dönem ₺100.000 → ciro kartı «▲» ve yeşil (eşitlik artış sayılır, eski davranış)', () => {
    ciz([
      ...coklu(4, 25_000, { createdAt: new Date(BUGUN.getTime() - 100 * GUN_MS) }),
      ...coklu(2, 50_000, { createdAt: new Date(BUGUN.getTime() - 10 * GUN_MS) }),
    ]);
    const k = kart('Son 90 Gün ve Önceki 90 Gün');
    const satir = [...k.querySelectorAll('.rounded-xl')].find(d => d.querySelector('p')?.textContent === 'Revenue')?.querySelectorAll('p')[2];
    if (!(satir instanceof HTMLElement)) throw new Error('P9 ciro kartı bulunamadı');
    expect(satir.textContent).toContain(`▲ ${yuzdeYaz(0, 0, 'tr')}`);
    expect(satir.style.color).toBe(renkNormal('#22c55e'));
  });
});

describe('P9 adet kartı — yön karşılaştırmadan (B1, adet yarısı)', () => {
  it('önceki 90 gün 200, son 90 gün 199 sipariş (−%0,5 → −0) → Orders kartı «▼» ve kırmızı, «▲» yok', () => {
    ciz([
      ...coklu(200, 1_000, { createdAt: new Date(BUGUN.getTime() - 100 * GUN_MS) }),
      ...coklu(199, 1_000, { createdAt: new Date(BUGUN.getTime() - 10 * GUN_MS) }),
    ]);
    const k = kart('Son 90 Gün ve Önceki 90 Gün');
    const adet = [...k.querySelectorAll('.rounded-xl')].find(d => d.querySelector('p')?.textContent === 'Orders');
    const satir = adet?.querySelectorAll('p')[2];
    if (!(satir instanceof HTMLElement)) throw new Error('P9 adet kartı bulunamadı');
    expect(satir.textContent).toContain(`▼ ${yuzdeYaz(0, 0, 'tr')}`);
    expect(satir.textContent).not.toContain('▲');
    expect(satir.style.color).toBe(renkNormal(KIRMIZI));
  });
});

describe('P13 Kümülatif Ciro Seyri — notun tarihi örneklemesiz seriden (inceleme B2)', () => {
  it('200 gün, tutarı okunamayan sipariş 3. günde → not 3. günü basar (örneklenmiş seri 6. günü gösterirdi)', () => {
    // 200 ayrı gün, eğri en çok 40 nokta: örnek indeksleri round(k · 199 / 39) → 0, 5, 10, … — 3. gün (indeks 2) örneklenmez.
    const gun = (i: number) => new Date(2025, 0, 1 + i, 10);
    ciz(Array.from({ length: 200 }, (_, i) => ({ ...(i === 2 ? basliksiz(1_000) : siparis(1_000)), createdAt: gun(i) })));
    const k = kart('Kümülatif Ciro Seyri');
    const bicim = { day: '2-digit', month: 'short', year: 'numeric' } as const;
    const not = paragraflar(k).find(p => p.startsWith('Eğri çizilmedi'));
    expect(not).toBe(`Eğri çizilmedi: ${tarihYaz(new Date(2025, 0, 3), bicim, 'tr')} tarihinden itibaren tutarı okunamayan sipariş var; toplam alt sınırdır.`);
    // Kâhin: örneklenmiş serinin ilk kısmi noktası (6. gün) basılmıyor.
    expect(not).not.toContain(tarihYaz(new Date(2025, 0, 6), bicim, 'tr'));
  });
});
