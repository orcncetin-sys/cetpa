/**
 * GenelBloklar6.test.tsx — P1 «Tüm Zamanların Rekorları» «Top Customer» kartı, bileşen GERÇEKTEN çizilerek (Faz 3 6d inceleme
 * turu, 2026-10-18; bulgu B3).
 *
 * Neden render testi: `rapor/musteri.ciroSirali` cirosu bilinmeyen müşteriyi SONA dizer ama listeyi boşaltmaz — sözleşmesi
 * doğrudur (`musteri.test.ts`). Hata bileşendeydi: `ciroSirali(...)[0]` hiçbir müşterinin cirosu okunamazken de bir müşteri
 * döndürür ve kart onu adıyla «en iyi müşteri» diye taçlıyordu. Kaynak taraması bu ayrımı göremez.
 *
 * Fikstürler Türkçe ve inşaat malzemesi. Başlığı olmayan sipariş = Mikro meblağı okunamayan fatura gibi (`totalPrice` alanı yok).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import GenelBloklar6 from './GenelBloklar6';
import type { Order } from '../../../types';
import { kisaTutar } from '../../../utils/currency';
import { kapsamNotu } from '../../../utils/rapor/kapsamNotu';

type Props = ComponentProps<typeof GenelBloklar6>;

const fmtAna: Props['fmtAna'] = (v, fmt = 'full', ondalik = 0) => kisaTutar(v, { fmt, ondalik, birim: 'TRY', rates: null });

const BUGUN = new Date();

let sira = 0;
/** Seramik yapıştırıcı siparişi: başlık tutarı = tek kalemin tutarı. */
const siparis = (customerName: string, tutar: number): Order => {
  sira += 1;
  return {
    id: `sip-${sira}`, customerName, totalPrice: tutar, status: 'Delivered', customerType: 'B2B', createdAt: BUGUN, paid: true,
    lineItems: [{ id: `k-${sira}`, sku: 'YAP-25', name: 'SERAMİK YAPIŞTIRICI 25KG', quantity: 1, price: tutar }],
  };
};
/** Başlığı olmayan sipariş: `totalPrice` alanı çalışma anında YOK, kalemleri tam (kalemden HESAPLANMAZ — O26). */
const basliksiz = (customerName: string, kalemTutari: number): Order => {
  const o = siparis(customerName, kalemTutari);
  Reflect.deleteProperty(o, 'totalPrice');   // `Order` tipi alanı zorunlu tutar; sunucu yazmadığında kayıtta alan hiç yoktur
  return o;
};

function ciz(orders: Order[]) {
  return render(
    <GenelBloklar6 reportsTab="genel" orders={orders} inventory={[]} employees={[]} quotations={[]} currentLanguage="tr"
      fmtAna={fmtAna} leadCariKodu={new Map()} />,
  );
}

function panel(): HTMLElement {
  const k = screen.getByText('Tüm Zamanların Rekorları').closest('.apple-card');
  if (!(k instanceof HTMLElement)) throw new Error('panel bulunamadı: Tüm Zamanların Rekorları');
  return k;
}
/** P1 kutusu: etiket (`span`) → değer (`.text-base`) ve alt satır (`.truncate`). */
function kutu(etiket: 'Largest Order' | 'Top Customer'): { deger: string; alt: string } {
  const k = [...panel().querySelectorAll('.rounded-xl')].find(d => d.querySelector('span.text-\\[10px\\]')?.textContent === etiket);
  const deger = k?.querySelector('p.text-base');
  const alt = k?.querySelector('p.truncate');
  if (!deger || !alt) throw new Error(`kutu bulunamadı: ${etiket}`);
  return { deger: deger.textContent ?? '', alt: alt.textContent ?? '' };
}
const paragraflar = (k: HTMLElement) => [...k.querySelectorAll('p')].map(p => p.textContent ?? '');

describe('P1 Top Customer — taç yalnız cirosu bilinen müşteriye (inceleme B3)', () => {
  const ADLAR = ['Şirin Yapı', 'Yıldız Yapı Market', 'Kaya Hırdavat'] as const;

  it('başlıksız üç TL siparişi → «Top Customer» değeri ve alt satırı «—», müşteri adı hiçbir kartta yok, not 3 sipariş sayar', () => {
    const { container } = ciz(ADLAR.map(ad => basliksiz(ad, 2_500)));
    expect(kutu('Top Customer')).toEqual({ deger: '—', alt: '—' });
    expect(kutu('Largest Order')).toEqual({ deger: '—', alt: '—' });
    for (const ad of ADLAR) expect(container.textContent, ad).not.toContain(ad);
    // Tutarı okunamayan sipariş notta (kart sessizce boş kalmaz). Beklenen metin modülün kendi biçimleyicisinden.
    const not = kapsamNotu({ tutarsiz: 3, kimliksiz: 0 }, { birim: 'siparis', dil: 'tr' });
    expect(paragraflar(panel()).filter(p => p === not)).toHaveLength(1);
  });

  it('kâhin: aynı müşterilerden biri bilinen tutarla → o müşteri taçlanır (yalnız bilinmeyen dal «—»)', () => {
    ciz([basliksiz(ADLAR[0], 2_500), basliksiz(ADLAR[1], 2_500), siparis(ADLAR[2], 5_000)]);
    expect(kutu('Top Customer')).toEqual({ deger: fmtAna(5_000, 'K', 1), alt: ADLAR[2] });
    expect(kutu('Largest Order').alt).toBe(ADLAR[2]);
  });
});
