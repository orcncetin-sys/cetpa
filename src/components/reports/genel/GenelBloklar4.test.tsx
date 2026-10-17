/**
 * GenelBloklar4.test.tsx — P&L Özeti (P22) ve Şehir paneli (P238), bileşen GERÇEKTEN çizilerek (6c inceleme 1, 2026-10-17).
 *
 * Neden render testi: iki bulgu da ekran davranışıdır, `rapor6c.degismez`'in kaynak taraması kanıtlayamaz:
 *   (5) P22 «Revenue» satırı başlık tutarından (Mikro faturasında KDV DÂHİL `totalPrice`), «Gross Profit» marj tabanından
 *       (`raporMarj.marjCirosu` — sürüm-2 MF kaleminde KDV HARİÇ Σ `netTutar`) gelir; iki taban ayrışınca Revenue − COGS
 *       satırları Gross Profit'i vermez. Sayılar DEĞİŞMEZ; ayrışan sipariş sayılır ve kartın altına koşullu dipnot düşer.
 *   (6) P238 tutarı okunamayan sipariş sayacı yalnız GÖSTERİLEN 8 şehirden toplanıyordu: cirosu bilinmeyen şehir sıralamada
 *       sona düşüp kesilince not hiç basılmıyordu → TÜM şehirlerin sayacı (P66 kuralı); anahtarsız (şehirsiz) küme HARİÇ
 *       (o siparişler «şehri girilmemiş» notunda zaten sayılıyor — çift sayım yok).
 * Fikstürler Türkçe ve inşaat malzemesi.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import GenelBloklar4 from './GenelBloklar4';
import type { Order, OrderLineItem } from '../../../types';
import { kisaTutar } from '../../../utils/currency';
import { kapsamNotu } from '../../../utils/rapor/kapsamNotu';

type Props = ComponentProps<typeof GenelBloklar4>;

const fmtAna: Props['fmtAna'] = (v, fmt = 'full', ondalik = 0) => kisaTutar(v, { fmt, ondalik, birim: 'TRY', rates: null });

const BUGUN = new Date();
/** İki ay önce — P22 «bu ay» penceresinin DIŞINDA (panel kapısı `orders.length >= 5` için dolgu). */
const IKI_AY_ONCE = new Date(BUGUN.getFullYear(), BUGUN.getMonth() - 2, 15);

let sira = 0;
const siparis = (ek: Partial<Order>): Order => {
  sira += 1;
  return {
    id: `sip-${sira}`, customerName: 'Şirin İnşaat', totalPrice: 1000, status: 'Delivered', customerType: 'B2B',
    createdAt: BUGUN, paid: true, ...ek,
  };
};

/** Sürüm-2 Mikro faturası kalemi: KDV hariç, iskonto düşülmüş net + kalemin kendi maliyeti. */
const mfKalemi = (netTutar: number, maliyet: number): OrderLineItem => ({
  id: 'k-cim', sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 1, price: netTutar, netTutar, kalemSurumu: 2, costPrice: maliyet,
});
/** Mikro faturasından türetilen kalemli sipariş: `totalPrice` = Mikro `cha_meblag` (KDV dâhil). */
const mikroFaturasi = (totalPrice: number, netTutar: number, ek: Partial<Order> = {}): Order =>
  siparis({ source: 'mikro-fatura', totalPrice, lineItems: [mfKalemi(netTutar, 600)], customerName: 'Yıldız Yapı', ...ek });
/** Cetpa'da girilmiş kalemli sipariş — iki taban AYNI (ciro = başlık tutarı). */
const yerelSiparis = (ek: Partial<Order> = {}): Order => siparis({
  totalPrice: 1000, lineItems: [{ id: 'k-boya', sku: 'BOYA-15', name: 'İÇ CEPHE BOYASI 15LT', quantity: 10, price: 100, costPrice: 60 }], ...ek,
});
const eskiDolgu = (): Order[] => Array.from({ length: 4 }, () => yerelSiparis({ createdAt: IKI_AY_ONCE }));

function ciz(orders: Order[], currentLanguage: 'tr' | 'en' = 'tr') {
  return render(
    <GenelBloklar4 reportsTab="genel" orders={orders} inventory={[]} employees={[]} exchangeRates={null}
      currentLanguage={currentLanguage} fmtAna={fmtAna} leadCariKodu={undefined} />,
  );
}

function panel(baslik: string): HTMLElement {
  const k = screen.getByText(baslik).closest('.apple-card');
  if (!(k instanceof HTMLElement)) throw new Error(`panel bulunamadı: ${baslik}`);
  return k;
}
const paragraflar = (k: HTMLElement) => [...k.querySelectorAll('p')].map(p => p.textContent ?? '');
/** P&L satırının değeri (etiketin yanındaki `<span>`). */
function pnlDegeri(etiket: string): string | null {
  return within(panel('P&L Summary — Current Month')).getByText(etiket).parentElement?.querySelectorAll('span')[1]?.textContent ?? null;
}

const DIPNOT_TR = (n: number) => `Brüt kâr KDV hariç kalem netinden; «Revenue» ${n} Mikro faturasında KDV dâhil tutardır`;
const DIPNOT_EN = (n: number) => `Gross profit uses net-of-VAT line totals; «Revenue» is VAT-inclusive for ${n} Mikro invoice(s)`;

describe('P22 P&L — (5) KDV tabanı ayrışan Mikro faturası dipnotu', () => {
  it('ayın tek siparişi MF: totalPrice ₺1.200, netTutar ₺1.000 → dipnot + sayaç 1; sayılar DEĞİŞMEZ', () => {
    ciz([mikroFaturasi(1200, 1000), ...eskiDolgu()]);
    expect(paragraflar(panel('P&L Summary — Current Month')).filter(p => p === DIPNOT_TR(1))).toHaveLength(1);
    // Rakamlar bağlamadaki gibi: Revenue başlık tutarı, Gross Profit KDV hariç net − maliyet.
    expect(pnlDegeri('Revenue')).toBe(`+${fmtAna(1200, 'full', 0)}`);
    expect(pnlDegeri('Cost of Goods Sold')).toBe(fmtAna(600, 'full', 0));
    expect(pnlDegeri('Gross Profit')).toBe(`+${fmtAna(400, 'full', 0)}`);
  });

  it('EN dipnotu', () => {
    ciz([mikroFaturasi(1200, 1000), ...eskiDolgu()], 'en');
    expect(paragraflar(panel('P&L Summary — Current Month')).filter(p => p === DIPNOT_EN(1))).toHaveLength(1);
  });

  it('sayaç yalnız AYRIŞAN siparişi sayar: iki ayrışan MF + tabanı eşit MF + yerel sipariş → 2', () => {
    ciz([mikroFaturasi(1200, 1000), mikroFaturasi(2400, 2000), mikroFaturasi(1000, 1000), yerelSiparis(), ...eskiDolgu()]);
    const p = paragraflar(panel('P&L Summary — Current Month'));
    expect(p.filter(x => x === DIPNOT_TR(2))).toHaveLength(1);
    expect(p.filter(x => x.startsWith('Brüt kâr KDV hariç'))).toHaveLength(1);
  });

  it('taban ayrışmıyorsa dipnot YOK: yalnız yerel sipariş ya da Σ net = totalPrice olan MF', () => {
    ciz([yerelSiparis(), mikroFaturasi(1000, 1000), ...eskiDolgu()]);
    expect(paragraflar(panel('P&L Summary — Current Month')).filter(x => x.startsWith('Brüt kâr KDV hariç'))).toHaveLength(0);
  });

  it('başlık tutarı BİLİNMEYEN MF ayrışan sayılmaz («Revenue»ya girmiyor); Σ net kayan noktası kuruşta eşitse sayılmaz', () => {
    const basliksiz = mikroFaturasi(Number.NaN, 1000);
    const kesirli = siparis({ source: 'mikro-fatura', totalPrice: 0.3, lineItems: [{ ...mfKalemi(0.1, 0), id: 'k-1' }, { ...mfKalemi(0.2, 0), id: 'k-2' }] });
    expect(0.1 + 0.2).not.toBe(0.3);   // fikstürün ayırt ediciliği: ham toplam kuruş yuvarlamasız AYRIŞIRDI
    ciz([basliksiz, kesirli, mikroFaturasi(1200, 1000), ...eskiDolgu()]);
    expect(paragraflar(panel('P&L Summary — Current Month')).filter(x => x === DIPNOT_TR(1))).toHaveLength(1);
  });

  it('marj tabanı BİLİNMEYEN (sürüm-1) MF kalemi ayrışan sayılmaz (brüt kâr zaten \'—\')', () => {
    const surum1 = siparis({ source: 'mikro-fatura', totalPrice: 1200, lineItems: [{ id: 'k-eski', sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 1, price: 1000, total: 1200 }] });
    ciz([surum1, ...eskiDolgu()]);
    expect(pnlDegeri('Gross Profit')).toBe('—');
    expect(paragraflar(panel('P&L Summary — Current Month')).filter(x => x.startsWith('Brüt kâr KDV hariç'))).toHaveLength(0);
  });
});

describe('P238 Şehir paneli — (6) tutarı okunamayan sayacı TÜM şehirlerden', () => {
  const SEHIRLER = ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Konya', 'Kayseri'];
  /** 8 şehir bilinen tutarla (azalan ciro) + 9. sırada kesilen, tutarı bilinmeyen büyük şehir + şehirsiz bir sipariş. */
  const fikstur = (): Order[] => [
    ...SEHIRLER.map((s, i) => siparis({ teslimatSehri: s, totalPrice: (9 - i) * 10000 })),
    siparis({ teslimatSehri: 'Gaziantep', totalPrice: Number.NaN, customerName: 'Kaya Beton' }),   // cirosu bilinmiyor → SONA düşer
    siparis({ totalPrice: Number.NaN, customerName: 'Yıldız Yapı' }),                             // şehir girilmemiş (anahtarsız)
  ];

  it('9. sırada kesilen şehrin tutarı okunamayan siparişi notta SAYILIR; şehirsiz sipariş bu sayaca GİRMEZ', () => {
    ciz(fikstur());
    const k = panel('Sipariş Hacmine Göre En İyi Şehirler');
    // Kesilme gerçekten oldu: Gaziantep satırı yok, 8 şehir var.
    expect(within(k).queryByText('Gaziantep')).toBeNull();
    for (const s of SEHIRLER) expect(within(k).getByText(s)).toBeInTheDocument();
    const p = paragraflar(k);
    expect(p).toContain(kapsamNotu({ tutarsiz: 1 }, { birim: 'siparis', dil: 'tr' }));
    expect(p).not.toContain(kapsamNotu({ tutarsiz: 2 }, { birim: 'siparis', dil: 'tr' }));
    // Anahtarsız sipariş kendi notunda (bir kez).
    expect(p.filter(x => x === '1 siparişin şehri girilmemiş — şehir sıralamasına girmedi')).toHaveLength(1);
  });

  it('tüm şehirlerin tutarı biliniyorsa not YOK (şehirsiz siparişin bilinmeyeni sayaca sızmaz)', () => {
    ciz(fikstur().filter(o => o.teslimatSehri !== 'Gaziantep'));
    const p = paragraflar(panel('Sipariş Hacmine Göre En İyi Şehirler'));
    expect(p.filter(x => /tutarı okunamadı/.test(x))).toHaveLength(0);
  });
});
