/**
 * ReportKit.test.tsx — `<KapsamNotu>` + `<OlcekCubugu>` (Faz 3 6a, grup "report-kit", 2026-09-19).
 *
 * NEDEN BU İKİ BİLEŞEN TESTLİ: ikisi de "sahte kesinlik yasağı"nın EKRAN tarafını taşıyor.
 *   • `<KapsamNotu>` metni KENDİ üretmez — `rapor/kapsamNotu`'dan alır. Buradaki testler metnin
 *     doğruluğunu DEĞİL (onun sahibi `kapsamNotu.test.ts`), bileşenin seçenekleri (birim/dil/sonuc)
 *     gerçekten GEÇİRDİĞİNİ ve boş notta hiç DOM düğümü çizmediğini kilitler.
 *   • `<OlcekCubugu>` üç durumu ayırır: BİLİNMİYOR (gri çapraz taralı, tam boy) ≠ gerçek 0 (dolgu
 *     YOK) ≠ pozitif oran. Eski sayfa kodu `Math.max(h, 2)` / `Math.max(4, …)` ile bilinmeyeni de
 *     sıfırı da "biraz dolu" çiziyordu (PLAN K26 VARSAYILANI — kullanıcı kararı değil, bkz.
 *     `OlcekCubugu` gövdesindeki kaynak notu; kullanıcı değiştirirse bu testler kırılmalı).
 *
 * Beklenen metinler ELLE YAZILMAZ: `kapsamNotu(...)` ve `oc(dil)` çağrılarak karşılaştırılır —
 * cümle tablosu değişirse bu dosya değil, sahibinin testi kırılsın.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { KapsamNotu, OlcekCubugu } from './ReportKit';
import { kapsamNotu } from '../../utils/rapor/kapsamNotu';
import { oc } from '../../i18n/ortak';

/** Çubuğun dış öğesi (yatayda ray, dikeyde saydam kap) + varsa dolgusu. `!` yok: bulunamazsa açık hata. */
function cubukParcalari(kap: HTMLElement): { dis: HTMLElement; dolgu: HTMLElement | null } {
  const dis = kap.firstElementChild;
  if (!(dis instanceof HTMLElement)) throw new Error('OlcekCubugu hiçbir dış öğe çizmedi');
  const ic = dis.firstElementChild;
  return { dis, dolgu: ic instanceof HTMLElement ? ic : null };
}

describe('<KapsamNotu>', () => {
  it('1 · sayaç yoksa HİÇBİR DOM düğümü çizilmez (boş <p> değil)', () => {
    const { container } = render(<KapsamNotu sayaclar={{}} dil="tr" />);
    expect(container.firstChild).toBeNull();
    // Bilinmeyen/negatif sayaçlar da not üretmez (kapı `kapsamNotu`'nda, bileşen onu YUTMAMALI).
    const { container: c2 } = render(<KapsamNotu sayaclar={{ tutarsiz: 0, tarihsiz: Number.NaN }} dil="tr" />);
    expect(c2.firstChild).toBeNull();
  });

  it('2 · metin `kapsamNotu` çıktısıyla AYNI (bileşende kopya metin yok)', () => {
    const sayaclar = { tutarsiz: 2 };
    const { container } = render(<KapsamNotu sayaclar={sayaclar} birim="siparis" dil="tr" />);
    expect(container.textContent).toBe(kapsamNotu(sayaclar, { birim: 'siparis', dil: 'tr' }));
  });

  it('2a · `birim` GERÇEKTEN geçirilir (şablon ≠ sipariş cümlesi)', () => {
    const sayaclar = { tutarsiz: 2 };
    const { container } = render(<KapsamNotu sayaclar={sayaclar} birim="sablon" dil="tr" />);
    const beklenen = kapsamNotu(sayaclar, { birim: 'sablon', dil: 'tr' });
    expect(container.textContent).toBe(beklenen);
    // Mutasyon ayırt edici: bileşen `birim`'i yutarsa varsayılan 'siparis' cümlesi basılır.
    expect(beklenen).not.toBe(kapsamNotu(sayaclar, { dil: 'tr' }));
  });

  it('2b · karışık birimli sayaç kümesi TEK <p>; `dil` geçirilir', () => {
    const sayaclar = { miktarsiz: 2, eslesmeyen: 4, kalemsiz: 7, tarihsiz: 1 };
    const { container } = render(<KapsamNotu sayaclar={sayaclar} dil="en" />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    const beklenen = kapsamNotu(sayaclar, { dil: 'en' });
    expect(container.textContent).toBe(beklenen);
    // Mutasyon ayırt edici: `dil` geçirilmezse Türkçe basılır.
    expect(beklenen).not.toBe(kapsamNotu(sayaclar, { dil: 'tr' }));
  });

  it('2c · `sonuc` çağıranın cümlesi olarak sona eklenir', () => {
    const sayaclar = { tutarsiz: 3 };
    const sonuc = 'toplama dâhil değil';
    const { container } = render(<KapsamNotu sayaclar={sayaclar} dil="tr" sonuc={sonuc} />);
    expect(container.textContent).toBe(kapsamNotu(sayaclar, { dil: 'tr', sonuc }));
    expect(container.textContent).toContain(sonuc);
  });

  it('2d · varsayılan sınıf mevcut satır içi notlarla aynı; `className` ezilebilir', () => {
    const { container } = render(<KapsamNotu sayaclar={{ tutarsiz: 1 }} dil="tr" />);
    const p = container.querySelector('p');
    expect(p?.className).toBe('text-[11px] text-amber-600 mt-2');
    const { container: c2 } = render(<KapsamNotu sayaclar={{ tutarsiz: 1 }} dil="tr" className="text-[10px] mt-3" />);
    expect(c2.querySelector('p')?.className).toBe('text-[10px] mt-3');
  });
});

describe('<OlcekCubugu>', () => {
  it('3 · bilinmiyor → tam boy gri çapraz taralı dolgu + aria-label', () => {
    const { container } = render(<OlcekCubugu oran={null} />);
    const { dolgu } = cubukParcalari(container);
    expect(dolgu).not.toBeNull();
    expect(dolgu?.style.width).toBe('100%');
    expect(dolgu?.style.background).toContain('repeating-linear-gradient');
    expect(dolgu?.getAttribute('aria-label')).toBe(oc('tr').bilinmiyor);
    // `undefined` de aynı dal.
    const { container: c2 } = render(<OlcekCubugu oran={undefined} />);
    expect(cubukParcalari(c2).dolgu?.style.background).toContain('repeating-linear-gradient');
  });

  it('3a · bilinmeyende ÇAĞIRANIN RENGİ UYGULANMAZ (gri taralı kalır)', () => {
    const { container } = render(<OlcekCubugu oran={null} renkSinifi="bg-blue-500" renk="#ff4000" />);
    const { dolgu } = cubukParcalari(container);
    expect(dolgu?.className).not.toContain('bg-blue-500');
    expect(dolgu?.style.background).toContain('repeating-linear-gradient');
    expect(dolgu?.style.background).not.toContain('rgb(255, 64, 0)');
  });

  it('3b · aria-label dile göre gelir (ORTAK sözlük)', () => {
    const { container } = render(<OlcekCubugu oran={null} dil="en" />);
    expect(cubukParcalari(container).dolgu?.getAttribute('aria-label')).toBe(oc('en').bilinmiyor);
    expect(oc('en').bilinmiyor).not.toBe(oc('tr').bilinmiyor);
  });

  it('4 · gerçek 0 → dolgu ÖĞESİ YOK (hayalet taban kalktı — K26 varsayılanı)', () => {
    const { container } = render(<OlcekCubugu oran={0} />);
    const { dis, dolgu } = cubukParcalari(container);
    expect(dolgu).toBeNull();
    // Ray yine çizilir (yatayda "boş kutu" görünür kalır).
    expect(dis.className).toContain('bg-gray-100');
  });

  it('4a · negatif oran da dolgu çizdirmez', () => {
    const { container } = render(<OlcekCubugu oran={-12} renkSinifi="bg-red-500" />);
    expect(cubukParcalari(container).dolgu).toBeNull();
  });

  it('5 · pozitif oran → yüzde genişlik + verilen sınıf', () => {
    const { container } = render(<OlcekCubugu oran={37.5} renkSinifi="bg-blue-500" />);
    const { dolgu } = cubukParcalari(container);
    expect(dolgu?.style.width).toBe('37.5%');
    expect(dolgu?.className).toContain('bg-blue-500');
    expect(dolgu?.getAttribute('aria-label')).toBeNull();
  });

  it('5a · `renk` (CSS) arka plana uygulanır', () => {
    const { container } = render(<OlcekCubugu oran={40} renk="#ff4000" />);
    expect(cubukParcalari(container).dolgu?.style.background).toContain('rgb(255, 64, 0)');
  });

  it('6 · 100 üstü oran tavanlanır; NaN ve ±Infinity bilinmeyen dalına düşer', () => {
    const { container } = render(<OlcekCubugu oran={140} renkSinifi="bg-brand" />);
    const { dolgu } = cubukParcalari(container);
    expect(dolgu?.style.width).toBe('100%');
    expect(dolgu?.className).toContain('bg-brand'); // taşan oran BİLİNİR — taralı değil
    for (const bozuk of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const { container: c } = render(<OlcekCubugu oran={bozuk} />);
      const d = cubukParcalari(c).dolgu;
      expect(d?.style.background).toContain('repeating-linear-gradient');
      expect(d?.getAttribute('aria-label')).toBe(oc('tr').bilinmiyor);
    }
  });

  it('7 · dikey → `height` kullanılır, `width` DEĞİL; ray yoktur', () => {
    const { container } = render(<OlcekCubugu oran={60} yon="dikey" renk="#e5e7eb" />);
    const { dis, dolgu } = cubukParcalari(container);
    expect(dolgu?.style.height).toBe('60%');
    expect(dolgu?.style.width).toBe('');
    expect(dis.className).not.toContain('bg-gray-100'); // dikeyde gri ray YOK
    expect(dolgu?.className).toContain('rounded-t-md'); // dikey varsayılan köşe
  });

  it('7a · dikeyde bilinmiyor tam YÜKSEKLİK, gerçek 0 dolgusuz', () => {
    const { container } = render(<OlcekCubugu oran={null} yon="dikey" />);
    const bilinmeyen = cubukParcalari(container).dolgu;
    expect(bilinmeyen?.style.height).toBe('100%');
    expect(bilinmeyen?.style.width).toBe('');
    const { container: c2 } = render(<OlcekCubugu oran={0} yon="dikey" />);
    expect(cubukParcalari(c2).dolgu).toBeNull();
  });

  it('8 · `title` dolgu olmasa da dış öğede durur (0 ve bilinmeyen hover’ı kaybolmaz)', () => {
    const { container } = render(<OlcekCubugu oran={0} title="Çimento 50kg: —" />);
    expect(cubukParcalari(container).dis.getAttribute('title')).toBe('Çimento 50kg: —');
  });

  it('8a · `kalinlik` / `koseSinifi` ezilebilir', () => {
    const { container } = render(<OlcekCubugu oran={20} kalinlik="h-3" koseSinifi="rounded-md" />);
    const { dis, dolgu } = cubukParcalari(container);
    expect(dis.className).toContain('h-3');
    expect(dis.className).toContain('rounded-md');
    expect(dolgu?.className).toContain('rounded-md');
  });
});
