/**
 * IlSecici.test.tsx — il / şehir kutusu, GERÇEKTEN çizilerek: TR kipi (arama kutulu liste), diğer ülke kipi (serbest
 * metin + öneri), salt okunur kip. Kullanıcı isteği 2026-10-09: «şehir ve ülke seçtir droplist (otomatik liste yap)».
 *
 * Şehir önerisi kancası (`useCitiesForCountry`) GERÇEKTİR; yalnız `fetch` taklit edilir. Kanca başarılı yanıtı ülke
 * koduna göre önbelleğe alır — başarısız ve başarılı senaryolar bu yüzden AYRI ülke kodu kullanır (sıradan bağımsız).
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import IlSecici from './IlSecici';
import { IL_ADLARI } from '../../data/iller';

const fetchTaklidi = vi.fn<(url: string) => Promise<unknown>>();

beforeEach(() => {
  fetchTaklidi.mockReset();
  fetchTaklidi.mockRejectedValue(new Error('ağ yok'));
  vi.stubGlobal('fetch', fetchTaklidi);
});
afterEach(() => { vi.unstubAllGlobals(); });

type Ek = Partial<React.ComponentProps<typeof IlSecici>>;

/** Denetimli kullanım: pencere gibi değeri durumda tutar. `onDegis` casusu her çağrıyı görür. */
function ciz(ek: Ek = {}, baslangic = '') {
  const onDegis = vi.fn<(il: string) => void>();
  function Sarmal() {
    const [deger, setDeger] = useState(baslangic);
    return (
      <>
        <label htmlFor="il">İl / Şehir</label>
        <IlSecici id="il" deger={deger} onDegis={il => { onDegis(il); setDeger(il); }} ulke="TR" dil="tr" {...ek} />
      </>
    );
  }
  const utils = render(<Sarmal />);
  return { ...utils, onDegis };
}

const kutu = () => screen.getByLabelText('İl / Şehir') as HTMLInputElement;
const liste = () => screen.queryByRole('listbox');
const secenekler = () => within(screen.getByRole('listbox')).getAllByRole('option').filter(s => s.getAttribute('aria-disabled') !== 'true');
const secenekAdlari = () => secenekler().map(s => s.textContent);
const yaz = (metin: string) => fireEvent.change(kutu(), { target: { value: metin } });
const tus = (key: string) => fireEvent.keyDown(kutu(), { key });
const etkinSecenek = () => {
  const kimlik = kutu().getAttribute('aria-activedescendant');
  return kimlik ? document.getElementById(kimlik) : null;
};
/** Öneri isteğinin sonucu (başarısız → boş liste) kancaya işlensin — test bitmeden, `act` uyarısı üretmeden. */
const oneriIstegiBitsin = () => waitFor(() => expect(fetchTaklidi).toHaveBeenCalled());

describe('TR kipi — arama kutulu açılır liste', () => {
  it('odakla liste açılır: 81 il, Türkçe alfabe sırasında; etkin seçenek YOK', () => {
    ciz();
    expect(liste()).toBeNull();
    fireEvent.focus(kutu());
    expect(secenekAdlari()).toEqual([...IL_ADLARI]);
    expect(etkinSecenek()).toBeNull();
  });

  it("yazınca liste süzülür ve İLK eşleşme etkin olur: 'ant' + Enter → onDegis('Antalya')", () => {
    const { onDegis } = ciz();
    fireEvent.focus(kutu());
    yaz('ant');
    expect(secenekAdlari()).toEqual(['Antalya', 'Gaziantep']);
    expect(etkinSecenek()?.textContent).toBe('Antalya');
    tus('Enter');
    expect(onDegis).toHaveBeenCalledTimes(1);
    expect(onDegis).toHaveBeenCalledWith('Antalya');
    expect(liste()).toBeNull();
    expect(kutu().value).toBe('Antalya');
  });

  it("Türkçe karaktersiz yazım da süzer: 'sanli' → Şanlıurfa; 'IS' → Isparta, İstanbul üstte", () => {
    ciz();
    fireEvent.focus(kutu());
    yaz('sanli');
    expect(secenekAdlari()).toEqual(['Şanlıurfa']);
    yaz('IS');
    expect(secenekAdlari().slice(0, 2)).toEqual(['Isparta', 'İstanbul']);
  });

  it('yalnız odakla açılan listede Enter hiçbir şey SEÇMEZ', () => {
    const { onDegis } = ciz();
    fireEvent.focus(kutu());
    tus('Enter');
    expect(onDegis).not.toHaveBeenCalled();
    expect(kutu().value).toBe('');
  });

  it('↓ + Enter seçer; onDegis listedeki adla çağrılır', () => {
    const { onDegis } = ciz();
    fireEvent.focus(kutu());
    tus('ArrowDown');
    expect(etkinSecenek()?.textContent).toBe('Adana');
    tus('ArrowDown');
    expect(etkinSecenek()?.textContent).toBe('Adıyaman');
    tus('Enter');
    expect(onDegis).toHaveBeenCalledTimes(1);
    expect(onDegis).toHaveBeenCalledWith('Adıyaman');
    expect(IL_ADLARI).toContain(onDegis.mock.calls[0][0]);
  });

  it('↓ / ↑ uçta durur: son seçenekten öteye, ilk seçenekten geriye gitmez', () => {
    ciz();
    fireEvent.focus(kutu());
    yaz('ant');                                   // Antalya (etkin), Gaziantep
    tus('ArrowUp');
    expect(etkinSecenek()?.textContent).toBe('Antalya');
    tus('ArrowDown'); tus('ArrowDown'); tus('ArrowDown');
    expect(etkinSecenek()?.textContent).toBe('Gaziantep');
    tus('ArrowUp');
    expect(etkinSecenek()?.textContent).toBe('Antalya');
  });

  it('etkin seçenek görünür alana kaydırılır (`scrollIntoView` varsa; jsdom\'da yoktur — yokluğunda fırlatmaz)', () => {
    expect('scrollIntoView' in Element.prototype).toBe(false);   // bu dosyadaki diğer testler yokluğunda koşuyor
    const kaydir = vi.fn<(this: Element) => void>();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: kaydir, configurable: true, writable: true });
    try {
      ciz();
      fireEvent.focus(kutu());
      expect(kaydir).not.toHaveBeenCalled();        // etkin seçenek yokken kaydırma yok
      tus('ArrowDown'); tus('ArrowDown');
      expect(kaydir).toHaveBeenCalledTimes(2);
      expect(kaydir.mock.contexts[1]).toBe(etkinSecenek());
      expect(etkinSecenek()?.textContent).toBe('Adıyaman');
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('liste AÇIKKEN Enter form gönderimini ENGELLER; liste kapalıyken engellemez', () => {
    const gonder = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={gonder}>
        <label htmlFor="il">İl / Şehir</label>
        <IlSecici id="il" deger="" onDegis={vi.fn()} ulke="TR" dil="tr" />
      </form>,
    );
    fireEvent.focus(kutu());
    // `fireEvent` olay iptal EDİLMEDİYSE true döner. Tarayıcı Enter'ın örtük form gönderimini `keydown` iptal edilince yapmaz.
    expect(fireEvent.keyDown(kutu(), { key: 'Enter' })).toBe(false);   // etkin seçenek yokken de
    yaz('ant');
    expect(fireEvent.keyDown(kutu(), { key: 'Enter' })).toBe(false);   // seçerken de
    expect(liste()).toBeNull();
    expect(fireEvent.keyDown(kutu(), { key: 'Enter' })).toBe(true);    // liste kapalı: Enter pencerenin
    expect(gonder).not.toHaveBeenCalled();
  });

  it('Escape listeyi kapatır; seçim DEĞİŞMEZ, yazılan atılır', () => {
    const { onDegis } = ciz({}, 'Antalya');
    fireEvent.focus(kutu());
    yaz('bur');
    expect(kutu().value).toBe('bur');
    tus('Escape');
    expect(liste()).toBeNull();
    expect(kutu().getAttribute('aria-expanded')).toBe('false');
    expect(kutu().value).toBe('Antalya');
    expect(onDegis).not.toHaveBeenCalled();
  });

  it("Escape liste açıkken pencereye ULAŞMAZ (kökte yerel dinleyici: `useModalErisilebilirlik` kalıbı); kapalıyken ulaşır", () => {
    const pencereEscape = vi.fn();
    ciz();
    // Dinleyici React kökünün İÇİNDEKİ bir öğede (pencere kökü gibi): React `onKeyDown` + `stopPropagation` buna göre
    // geç kalır — olay React köküne varmadan bu dinleyici çalışmış olur. Yalnız kutudaki YEREL dinleyici durdurabilir.
    const pencereKoku = kutu().parentElement as HTMLElement;
    const dinle = (e: KeyboardEvent) => { if (e.key === 'Escape') pencereEscape(); };
    pencereKoku.addEventListener('keydown', dinle);
    fireEvent.focus(kutu());
    tus('Escape');
    expect(pencereEscape).not.toHaveBeenCalled();
    expect(liste()).toBeNull();
    tus('Escape');
    expect(pencereEscape).toHaveBeenCalledTimes(1);
    pencereKoku.removeEventListener('keydown', dinle);
  });

  it('Escape sonrası ↓ listeyi yeniden açar', () => {
    ciz();
    fireEvent.focus(kutu());
    tus('Escape');
    expect(liste()).toBeNull();
    tus('ArrowDown');
    expect(liste()).not.toBeNull();
    expect(kutu().getAttribute('aria-expanded')).toBe('true');
  });

  it('fareyle seçim `mousedown`dadır ve varsayılanı engeller (kutu odağı kaybetmez)', () => {
    const { onDegis } = ciz();
    fireEvent.focus(kutu());
    const bursa = secenekler().find(s => s.textContent === 'Bursa') as HTMLElement;
    expect(fireEvent.mouseDown(bursa)).toBe(false);
    expect(onDegis).toHaveBeenCalledWith('Bursa');
    expect(liste()).toBeNull();
    expect(kutu().value).toBe('Bursa');
  });

  it('listede OLMAYAN metinle odak çıkınca onDegis ÇAĞRILMAZ; kutu önceki seçime döner', () => {
    const { onDegis } = ciz({}, 'Antalya');
    fireEvent.focus(kutu());
    yaz('Kepez');
    fireEvent.blur(kutu());
    expect(onDegis).not.toHaveBeenCalled();
    expect(kutu().value).toBe('Antalya');
    expect(liste()).toBeNull();
  });

  it("yarım yazılmış il de atılır: 'ant' yazıp odak çıkınca seçim değişmez (yalnız BİREBİR eşleşme seçilir)", () => {
    const { onDegis } = ciz();
    fireEvent.focus(kutu());
    yaz('ant');
    fireEvent.blur(kutu());
    expect(onDegis).not.toHaveBeenCalled();
    expect(kutu().value).toBe('');
  });

  it("'antalya' yazıp odak çıkınca onDegis('Antalya') — listedeki DOĞRU yazımla", () => {
    const { onDegis } = ciz();
    fireEvent.focus(kutu());
    yaz('antalya');
    fireEvent.blur(kutu());
    expect(onDegis).toHaveBeenCalledTimes(1);
    expect(onDegis).toHaveBeenCalledWith('Antalya');
    expect(kutu().value).toBe('Antalya');
  });

  it("kutu boşaltılıp odak çıkınca onDegis('') — seçim temizlenir", () => {
    const { onDegis } = ciz({}, 'Antalya');
    fireEvent.focus(kutu());
    yaz('');
    expect(etkinSecenek()).toBeNull();            // boş kutuda etkin seçenek yok: Enter yanlışlıkla Adana seçmesin
    fireEvent.blur(kutu());
    expect(onDegis).toHaveBeenCalledTimes(1);
    expect(onDegis).toHaveBeenCalledWith('');
    expect(kutu().value).toBe('');
  });

  it('yazmadan odaklanıp çıkmak hiçbir şeyi değiştirmez', () => {
    const { onDegis } = ciz({}, 'Antalya');
    fireEvent.focus(kutu());
    fireEvent.blur(kutu());
    expect(onDegis).not.toHaveBeenCalled();
    expect(kutu().value).toBe('Antalya');
  });

  it('listede olmayan MEVCUT değer (eski / beklenmeyen kayıt) aynen gösterilir; dokunulmadıkça değişmez', () => {
    const { onDegis } = ciz({}, 'K.MARAŞ');
    expect(kutu().value).toBe('K.MARAŞ');
    fireEvent.focus(kutu());
    expect(secenekAdlari()).toHaveLength(81);     // mevcut değer süzgeç DEĞİL: liste tam açılır
    fireEvent.blur(kutu());
    expect(onDegis).not.toHaveBeenCalled();
    expect(kutu().value).toBe('K.MARAŞ');
  });

  it('eşleşme yoksa seçilemeyen tek bilgi satırı; Enter hiçbir şey seçmez', () => {
    const { onDegis } = ciz();
    fireEvent.focus(kutu());
    yaz('berlin');
    const satirlar = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0].textContent).toBe('Arama sonucu bulunamadı.');
    expect(satirlar[0].getAttribute('aria-disabled')).toBe('true');
    expect(etkinSecenek()).toBeNull();
    tus('ArrowDown');
    expect(etkinSecenek()).toBeNull();
    tus('Enter');
    fireEvent.mouseDown(satirlar[0]);
    expect(onDegis).not.toHaveBeenCalled();
  });

  it('`onDegis` YALNIZ listedeki bir adla ya da boş metinle çağrılır (serbest metin kayda gitmez)', () => {
    const { onDegis } = ciz();
    fireEvent.focus(kutu());
    for (const metin of ['Kepez', 'ant', 'K.MARAŞ', 'istanbul']) { yaz(metin); fireEvent.blur(kutu()); fireEvent.focus(kutu()); }
    yaz(''); fireEvent.blur(kutu());
    const degerler = onDegis.mock.calls.map(c => c[0]);
    expect(degerler).toEqual(['İstanbul', '']);
    for (const d of degerler) expect(d === '' || IL_ADLARI.includes(d), d).toBe(true);
  });

  it('TR kipinde şehir isteği YAPILMAZ (`TR.json` il listesi değildir)', () => {
    ciz();
    fireEvent.focus(kutu());
    yaz('ant');
    expect(fetchTaklidi).not.toHaveBeenCalled();
  });

  it('yer tutucu ortak sözlükten, dile göre; il adları iki dilde de Türkçe yazımla', () => {
    const { unmount } = ciz();
    expect(kutu().placeholder).toBe('İl seçin');
    unmount();
    ciz({ dil: 'en' });
    expect(kutu().placeholder).toBe('Select province');
    fireEvent.focus(kutu());
    yaz('xyz');
    expect(screen.getByText('No results found.')).toBeTruthy();
    yaz('ist');
    expect(secenekAdlari()).toEqual(['İstanbul']);
  });
});

describe('TR kipi — aria', () => {
  it('kutu `combobox`; `aria-expanded` aç / kapa ile değişir; `aria-controls` listeyi gösterir', () => {
    ciz();
    const k = screen.getByRole('combobox');
    expect(k).toBe(kutu());
    expect(k.getAttribute('aria-expanded')).toBe('false');
    expect(k.getAttribute('aria-autocomplete')).toBe('list');
    expect(k.getAttribute('autocomplete')).toBe('off');
    fireEvent.focus(k);
    expect(k.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(k.getAttribute('aria-controls') as string)).toBe(screen.getByRole('listbox'));
    tus('Escape');
    expect(k.getAttribute('aria-expanded')).toBe('false');
  });

  it('`aria-activedescendant` etkin seçeneği gösterir; etkin seçenek `aria-selected`', () => {
    ciz();
    fireEvent.focus(kutu());
    expect(kutu().hasAttribute('aria-activedescendant')).toBe(false);
    yaz('iz');
    const etkin = etkinSecenek();
    expect(etkin?.getAttribute('role')).toBe('option');
    expect(etkin?.textContent).toBe('İzmir');
    expect(etkin?.getAttribute('aria-selected')).toBe('true');
    expect(secenekler().filter(s => s.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });

  it('seçenekler `option`; kimlikleri tekil', () => {
    ciz();
    fireEvent.focus(kutu());
    const kimlikler = secenekler().map(s => s.id);
    expect(kimlikler).toHaveLength(81);
    expect(new Set(kimlikler).size).toBe(81);
    expect(kimlikler.every(Boolean)).toBe(true);
  });
});

describe('diğer ülke kipi — serbest metin + öneri', () => {
  it('serbest metin HER değişiklikte onDegis ile gelir; açılır il listesi yok', async () => {
    const { onDegis } = ciz({ ulke: 'FR' });
    await oneriIstegiBitsin();
    expect(kutu().hasAttribute('aria-expanded')).toBe(false);   // TR kipinin açılır kutusu değil
    fireEvent.focus(kutu());
    yaz('Ly');
    yaz('Lyon');
    expect(onDegis.mock.calls.map(c => c[0])).toEqual(['Ly', 'Lyon']);
    expect(kutu().value).toBe('Lyon');
    expect(liste()).toBeNull();
  });

  it('öneri isteği başarısızken (çevrim dışı) kutu yine yazılabilir; öneri listesi boş', async () => {
    const { onDegis, container } = ciz({ ulke: 'FR' });
    await waitFor(() => expect(fetchTaklidi).toHaveBeenCalledWith('/geo/cities/FR.json'));
    yaz('Marseille');
    expect(onDegis).toHaveBeenCalledWith('Marseille');
    expect(container.querySelectorAll('datalist option')).toHaveLength(0);
    expect(kutu().readOnly).toBe(false);
  });

  it('öneriler o ülkenin şehirleridir (kutu `list` ile bağlı); listede olmayan şehir de yazılabilir', async () => {
    fetchTaklidi.mockResolvedValue({ ok: true, json: async () => [['Berlin', 3_426_354], ['Munich', 1_260_391]] });
    const { onDegis, container } = ciz({ ulke: 'DE' });
    await waitFor(() => expect(container.querySelectorAll('datalist option')).toHaveLength(2));
    expect(fetchTaklidi).toHaveBeenCalledWith('/geo/cities/DE.json');
    const oneriler = container.querySelector('datalist') as HTMLDataListElement;
    expect(kutu().getAttribute('list')).toBe(oneriler.id);
    expect([...oneriler.querySelectorAll('option')].map(o => o.getAttribute('value'))).toEqual(['Berlin', 'Munich']);
    yaz('Rothenburg ob der Tauber');
    expect(onDegis).toHaveBeenCalledWith('Rothenburg ob der Tauber');
  });

  it('yer tutucu ortak sözlükten, dile göre', async () => {
    const { unmount } = ciz({ ulke: 'FR' });
    await oneriIstegiBitsin();
    expect(kutu().placeholder).toBe('Şehir yazın');
    unmount();
    ciz({ ulke: 'FR', dil: 'en' });
    await oneriIstegiBitsin();
    expect(kutu().placeholder).toBe('Type a city');
  });

  it('ülke TR ↔ diğer değişince kutu kip değiştirir: açılır liste ↔ serbest metin', async () => {
    function Sarmal({ ulke }: { ulke: string }) {
      return (<><label htmlFor="il">İl / Şehir</label><IlSecici id="il" deger="" onDegis={vi.fn()} ulke={ulke} dil="tr" /></>);
    }
    const { rerender } = render(<Sarmal ulke="TR" />);
    expect(kutu().hasAttribute('aria-expanded')).toBe(true);
    expect(kutu().hasAttribute('list')).toBe(false);
    rerender(<Sarmal ulke="FR" />);
    await oneriIstegiBitsin();
    expect(kutu().hasAttribute('aria-expanded')).toBe(false);
    expect(kutu().getAttribute('list')).toBeTruthy();
    fireEvent.focus(kutu());
    expect(liste()).toBeNull();
    rerender(<Sarmal ulke="TR" />);
    expect(kutu().hasAttribute('aria-expanded')).toBe(true);
    expect(kutu().hasAttribute('list')).toBe(false);
  });
});

describe('saltOkunur — mağaza kilidi', () => {
  it('girdi `readOnly`; kayıttaki değer AYNEN («Çankaya / Ankara»); liste AÇILMAZ', () => {
    const { onDegis } = ciz({ saltOkunur: true }, 'Çankaya / Ankara');
    expect(kutu().readOnly).toBe(true);
    expect(kutu().value).toBe('Çankaya / Ankara');
    fireEvent.focus(kutu());
    tus('ArrowDown');
    expect(liste()).toBeNull();
    expect(kutu().hasAttribute('aria-expanded')).toBe(false);
    fireEvent.blur(kutu());
    expect(onDegis).not.toHaveBeenCalled();
  });

  it('yabancı ülkede de salt okunur: öneri isteği yapılmaz, `datalist` yok', () => {
    const { container } = ciz({ saltOkunur: true, ulke: 'DE' }, 'Berlin');
    expect(kutu().readOnly).toBe(true);
    expect(kutu().value).toBe('Berlin');
    expect(container.querySelector('datalist')).toBeNull();
    expect(fetchTaklidi).not.toHaveBeenCalled();
  });
});
