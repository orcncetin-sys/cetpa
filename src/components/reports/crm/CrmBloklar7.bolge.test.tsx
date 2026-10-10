/**
 * CrmBloklar7.bolge.test.tsx — «Bölgeye Göre Ciro Yoğunlaşması» bloğunun YAPISAL ŞEHİR dalı, bileşen GERÇEKTEN çizilerek
 * (inceleme 2026-10-10).
 *
 * Sipariş penceresinde il artık listeden seçiliyor (`teslimatSehri`, büyük «İ» ile: «İstanbul», «İzmir»). Blok bölgeyi
 * ÖNCE o alandan okur (`siparisSehri`) ve altı adlı ille `katla()` üzerinden karşılaştırır. Kaynak çiti
 * (utils/siparisler/teslimatAdresi.cit.test.ts) çağrının VARLIĞINI sabitler, kovanın DOĞRULUĞUNU değil: inceleme,
 * `const katli = katla(sehir)` satırı hemen altındaki eski dalın kalıbına benzetilip `sehir.toLowerCase()` yapıldığında
 * tam paketin (265 dosya / 5.936 test) yeşil kaldığını ölçtü — oysa 'İstanbul'.toLowerCase() 'i' + U+0307 + 'stanbul'
 * üretir, «İstanbul» ve «İzmir» siparişlerinin TAMAMI sessizce «Other TR» kovasına düşer (Ankara / Bursa / Antalya /
 * Adana doğru kaldığı için rapora bakarak fark etmek de zordur). Bu dosya o mutasyonu davranışla yakalar.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import CrmBloklar7 from './CrmBloklar7';
import { MAGAZA_KAYNAGI } from '../../../lib/magazaKaynagi';
import type { Order } from '../../../types';

type Props = ComponentProps<typeof CrmBloklar7>;

/** Tutarı ayırt edilebilir düz metne çevirir — satırdaki ciro hücresi sayı olarak geri okunur. */
const fmtAna: Props['fmtAna'] = v => `₺${Math.round(v)}`;

let sira = 0;
const siparis = (ek: Partial<Order>): Order => {
  sira += 1;
  return { id: `sip-${sira}`, customerName: `Müşteri ${sira}`, totalPrice: 1000, status: 'Delivered', customerType: 'B2B', lineItems: [], ...ek };
};

interface BolgeSatiri { siparis: number; ciro: number }

/** Bloğu çizer ve kartın satırlarını `{ bölge → { sipariş adedi, ciro } }` olarak okur. */
function bolgeler(orders: Order[]): Record<string, BolgeSatiri> {
  const { unmount } = render(
    <CrmBloklar7 reportsTab="crm" orders={orders} quotations={[]} inventory={[]} exchangeRates={null} currentLanguage="tr" fmtAna={fmtAna} />,
  );
  const kart = screen.getByRole('heading', { name: 'Bölgeye Göre Ciro Yoğunlaşması' }).closest('.apple-card');
  if (!kart) throw new Error('bölge kartı bulunamadı');
  const sonuc: Record<string, BolgeSatiri> = {};
  for (const satir of kart.querySelectorAll('.space-y-2 > div')) {
    const hucreler = [...satir.querySelectorAll('span')].map(s => s.textContent ?? '');
    // Satır: [bölge, «N ord», «%», ciro]
    const [bolge, adet, , ciro] = hucreler;
    sonuc[bolge] = { siparis: Number(adet.replace(' ord', '')), ciro: Number(ciro.replace('₺', '')) };
  }
  unmount();
  return sonuc;
}

describe('CrmBloklar7 — «Bölgeye Göre Ciro»: yapısal şehir (`teslimatSehri`) doğru kovaya düşer', () => {
  it('«İstanbul» ve «İzmir» (listeden, büyük «İ» ile) KENDİ kovasında — «Other TR»ye düşmez (mutasyon-ayırt-edici)', () => {
    const sonuc = bolgeler([
      // Sipariş penceresinin yazdığı kayıtlar: adres «kalan»dır (il adı metinde YOK) — kova yalnız yapısal şehirden gelir.
      siparis({ shippingAddress: 'Kadıköy, Moda Cad. No:12', teslimatSehri: 'İstanbul', teslimatUlke: 'TR', totalPrice: 5000 }),
      siparis({ shippingAddress: 'Şişli, Halaskargazi Cad. No:40', teslimatSehri: 'İstanbul', teslimatUlke: 'TR', totalPrice: 3000 }),
      siparis({ shippingAddress: 'Ümraniye, Alemdağ Cad. No:7', teslimatSehri: 'İstanbul', teslimatUlke: 'TR', totalPrice: 2000 }),
      siparis({ shippingAddress: 'Bornova, Ege Sanayi Sitesi No:3', teslimatSehri: 'İzmir', teslimatUlke: 'TR', totalPrice: 4000 }),
      siparis({ shippingAddress: 'Konak, Fevzipaşa Blv. No:9', teslimatSehri: 'İzmir', teslimatUlke: 'TR', totalPrice: 2500 }),
      siparis({ shippingAddress: 'Ostim OSB 1234. Sok. No:5', teslimatSehri: 'Ankara', teslimatUlke: 'TR', totalPrice: 1500 }),
      siparis({ shippingAddress: 'Nilüfer, Organize Sanayi 4. Cad.', teslimatSehri: 'Bursa', teslimatUlke: 'TR', totalPrice: 1200 }),
      siparis({ shippingAddress: 'Kepez, Yenigün Mah. 1063 Sok. No:4', teslimatSehri: 'Antalya', teslimatUlke: 'TR', totalPrice: 1100 }),
      siparis({ shippingAddress: 'Seyhan, Organize Sanayi 2. Cad.', teslimatSehri: 'Adana', teslimatUlke: 'TR', totalPrice: 900 }),
      // Altı adlı il dışı: yurt içinde «Other TR».
      siparis({ shippingAddress: 'OSB 7. Cadde No:12', teslimatSehri: 'Kayseri', teslimatUlke: 'TR', totalPrice: 700 }),
    ]);
    expect(sonuc['İstanbul']).toEqual({ siparis: 3, ciro: 10_000 });
    expect(sonuc['İzmir']).toEqual({ siparis: 2, ciro: 6500 });
    expect(sonuc['Ankara']).toEqual({ siparis: 1, ciro: 1500 });
    expect(sonuc['Bursa']).toEqual({ siparis: 1, ciro: 1200 });
    expect(sonuc['Antalya']).toEqual({ siparis: 1, ciro: 1100 });
    expect(sonuc['Adana']).toEqual({ siparis: 1, ciro: 900 });
    // «Other TR»de YALNIZ Kayseri var — İstanbul / İzmir buraya düşseydi 6 sipariş / ₺17.200 olurdu.
    expect(sonuc['Other TR']).toEqual({ siparis: 1, ciro: 700 });
    expect(Object.keys(sonuc).sort()).toEqual(['Adana', 'Ankara', 'Antalya', 'Bursa', 'Other TR', 'İstanbul', 'İzmir'].sort());
  });

  it('altı il dışı: yurt içinde «Other TR», başka ülkede «Other»; ülke alanı olmayan kayıt yurt içi sayılır', () => {
    const sonuc = bolgeler([
      siparis({ teslimatSehri: 'Kayseri', teslimatUlke: 'TR', totalPrice: 700 }),
      siparis({ teslimatSehri: 'Konya', totalPrice: 300 }),                                    // ülke alanı yok → 'TR'
      siparis({ shippingAddress: 'Hauptstr. 5', teslimatSehri: 'Berlin', teslimatUlke: 'DE', totalPrice: 4000 }),
      siparis({ teslimatSehri: 'Hamburg', teslimatUlke: 'DE', totalPrice: 1000 }),
      // Yazımı listeden farklı MEVCUT değer de katlanarak eşleşir (büyük harf, ASCII «I»).
      siparis({ teslimatSehri: 'ISTANBUL', teslimatUlke: 'TR', totalPrice: 600 }),
      siparis({ teslimatSehri: 'izmir', teslimatUlke: 'TR', totalPrice: 500 }),
      ...Array.from({ length: 4 }, () => siparis({ teslimatSehri: 'Ankara', teslimatUlke: 'TR', totalPrice: 100 })),
    ]);
    expect(sonuc['Other TR']).toEqual({ siparis: 2, ciro: 1000 });
    expect(sonuc['Other']).toEqual({ siparis: 2, ciro: 5000 });
    expect(sonuc['İstanbul']).toEqual({ siparis: 1, ciro: 600 });
    expect(sonuc['İzmir']).toEqual({ siparis: 1, ciro: 500 });
    expect(sonuc['Ankara']).toEqual({ siparis: 4, ciro: 400 });
  });

  it('yapısal şehir YOKSA eski dal aynen: eski kayıt ve mağaza siparişi adres metninden; adressiz kayıt «Unknown»', () => {
    const sonuc = bolgeler([
      // Eski kayıt (alan yok): metinde şehir adı aranır.
      siparis({ shippingAddress: 'Kadıköy, istanbul', totalPrice: 800 }),
      siparis({ shippingAddress: 'Organize Sanayi Bölgesi 7. Cadde No:12, Kayseri', totalPrice: 300 }),   // eski dal: «Other»
      // Mağaza siparişi: `teslimatSehri` «ilçe / il»dir, il değil → yapısal dal ATLANIR, tam adres metni okunur.
      siparis({ source: MAGAZA_KAYNAGI, shippingAddress: 'Ayşe Yılmaz, Atatürk Blv. 12, Çankaya, Ankara, 06100', teslimatSehri: 'Çankaya / Ankara', teslimatUlke: 'TR', totalPrice: 900 }),
      // İl `null` (boşaltılmış) → yapısal şehir yok → eski dal.
      siparis({ shippingAddress: 'Nilüfer, bursa', teslimatSehri: null as unknown as string, teslimatUlke: 'TR', totalPrice: 400 }),
      siparis({ totalPrice: 50 }),                                                              // adres yok → «Unknown»
      ...Array.from({ length: 5 }, () => siparis({ teslimatSehri: 'İzmir', teslimatUlke: 'TR', totalPrice: 100 })),
    ]);
    expect(sonuc['İstanbul']).toEqual({ siparis: 1, ciro: 800 });
    expect(sonuc['Ankara']).toEqual({ siparis: 1, ciro: 900 });
    expect(sonuc['Bursa']).toEqual({ siparis: 1, ciro: 400 });
    expect(sonuc['Other']).toEqual({ siparis: 1, ciro: 300 });
    expect(sonuc['Unknown']).toEqual({ siparis: 1, ciro: 50 });
    expect(sonuc['İzmir']).toEqual({ siparis: 5, ciro: 500 });
    expect(sonuc['Other TR']).toBeUndefined();
  });
});
