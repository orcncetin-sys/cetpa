/**
 * MusteriKarAnalizi — inceleme 2026-09-25: faturadan-sipariş importu sürüm-2 Mikro kalemi (price YOK) yazınca eski
 * `li.price * 0.6` yedeği NaN üretip müşterinin kârını bozuyordu; miktarı null kalem sessiz 0 maliyetti. Artık maliyeti
 * ya da miktarı bilinmeyen kalem maliyete EKLENMEZ, sayılır ve kartta "kâr kısmi" yazılır.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MusteriKarAnalizi from './MusteriKarAnalizi';

const fmtAna = (n: number) => (Number.isFinite(n) ? `₺${Math.round(n)}` : '—');

describe('MusteriKarAnalizi — maliyeti bilinmeyen kalem', () => {
  it('fiyatsız (sürüm-2) kalem ve miktarı null kalem kârı NaN yapmaz; "kâr kısmi" notu basılır; bilinen maliyet düşülür', () => {
    const inventory = [{ id: 'i1', sku: 'CMT-50', name: 'ÇİMENTO 50KG', costPrice: 100, currency: 'TRY' }];
    const orders = [
      // Sürüm-2 MF siparişi: ciro Σ netTutar (KDV hariç) = 1.900 — totalPrice (KDV dâhil 2.280) DEĞİL.
      { id: 'o1', customerName: 'ŞİRİN', status: 'Delivered', totalPrice: 2280, source: 'mikro-fatura',
        lineItems: [{ sku: 'CMT-50', name: 'ÇİMENTO 50KG', quantity: 10, netTutar: 1800, kalemSurumu: 2 }, { name: 'KUM', quantity: 5, netTutar: 100, kalemSurumu: 2 }] },
      { id: 'o3', customerName: 'ŞİRİN', status: 'Delivered', totalPrice: 999, lineItems: [] },   // kalemsiz → hesap dışı
      { id: 'o2', customerName: 'ÖRNEK', status: 'Delivered', totalPrice: 500,
        lineItems: [{ name: 'ÇİMENTO 50KG', quantity: null, price: 50 }] },
    ];
    render(<MusteriKarAnalizi orders={orders as never} inventory={inventory as never} inventoryMovements={[] as never}
      exchangeRates={{} as never} currentLanguage="tr" fmtAna={fmtAna as never} />);
    expect(screen.getByText('₺900')).toBeTruthy();                  // 1.900 − 10 × 100 (KUM maliyetsiz, eklenmedi)
    expect(screen.getByText(/1 sipariş hesap dışı/)).toBeTruthy();
    // Genel not: müşteri LİSTEDE (başka siparişiyle) — "müşteri bu yüzden listede yok" DENMEZ (delta hakem 2026-09-25).
    const genel = screen.getByText(/sipariş kâr hesabına girmedi/);
    expect(genel.textContent).toMatch(/^1 sipariş kâr hesabına girmedi — /);
    expect(genel.textContent).not.toMatch(/müşteri bu yüzden/);
    expect(screen.getAllByText(/1 kalem maliyetsiz — kâr kısmi/)).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});

// Delta hakem 2026-09-25: siparişlerinin tamamı hesap dışı kalan müşteri sessizce düşüyor, kart 2'den az müşteride
// açıklamasız kayboluyordu. Artık kart genelinde "N müşteri / M sipariş kâr hesabına girmedi" notu basılır.
describe('MusteriKarAnalizi — hesap dışı kalanlar görünür', () => {
  it('yalnız eski (sürüm-1) MF siparişi olan müşteri listede yok ama genel not var; hesaplanabilen tek müşteride de kart çizilir', () => {
    const inventory = [{ id: 'i1', sku: 'CMT-50', name: 'ÇİMENTO 50KG', costPrice: 100, currency: 'TRY' }];
    const orders = [
      { id: 'a', customerName: 'ESKİ MF', status: 'Delivered', totalPrice: 5000, source: 'mikro-fatura', lineItems: [{ sku: 'CMT-50', total: 5000 }] },
      { id: 'b', customerName: 'NATIVE', status: 'Delivered', totalPrice: 1000, lineItems: [{ sku: 'CMT-50', name: 'ÇİMENTO 50KG', quantity: 5, price: 200 }] },
    ];
    render(<MusteriKarAnalizi orders={orders as never} inventory={inventory as never} inventoryMovements={[] as never}
      exchangeRates={{} as never} currentLanguage="tr" fmtAna={fmtAna as never} />);
    expect(screen.getByText(/1 sipariş kâr hesabına girmedi \(1 müşteri bu yüzden listede yok\)/)).toBeTruthy();
    expect(screen.queryByText('ESKİ MF')).toBeNull();
    expect(screen.queryByText(/cirosu sıfır ya da eksi/)).toBeNull();   // hesap dışı müşteri İKİNCİ notta sayılmaz
    expect(screen.getByText('NATIVE')).toBeTruthy();
  });
});

describe('MusteriKarAnalizi — sıfır/eksi cirolu müşteri AYRI nedenle görünür', () => {
  it('yalnız iade (eksi ciro) müşterisi "hesap dışı sipariş" sayılmaz; kendi notuyla bildirilir ve kart kaybolmaz', () => {
    const inventory = [{ id: 'i1', sku: 'CMT-50', name: 'ÇİMENTO 50KG', costPrice: 100, currency: 'TRY' }];
    const orders = [
      { id: 'r', customerName: 'İADECİ', status: 'Delivered', totalPrice: -300, lineItems: [{ sku: 'CMT-50', name: 'ÇİMENTO 50KG', quantity: -1, price: 300 }] },
      { id: 'n', customerName: 'NATIVE', status: 'Delivered', totalPrice: 1000, lineItems: [{ sku: 'CMT-50', name: 'ÇİMENTO 50KG', quantity: 5, price: 200 }] },
    ];
    render(<MusteriKarAnalizi orders={orders as never} inventory={inventory as never} inventoryMovements={[] as never}
      exchangeRates={{} as never} currentLanguage="tr" fmtAna={fmtAna as never} />);
    expect(screen.getByText(/1 müşterinin cirosu sıfır ya da eksi/)).toBeTruthy();
    expect(screen.queryByText(/kâr hesabına girmedi/)).toBeNull();
    expect(screen.getByText('NATIVE')).toBeTruthy();
  });
});
