/**
 * IlSecici.tsx — teslimat İLİ / ŞEHRİ kutusu. Ortak bileşen: Yeni Sipariş ve Sipariş Düzenle pencereleri AYNI bileşeni
 * kullanır (2026-10-10; kullanıcı isteği 2026-10-09: «şehir ve ülke seçtir droplist (otomatik liste yap)»).
 *
 * ÜÇ KİP:
 *   • TR (`ulke === 'TR'`) — arama kutulu açılır liste, 81 il (`src/data/iller`). `onDegis` YALNIZ listedeki bir il adıyla
 *     ya da '' ile çağrılır: sipariş penceresinin yazdığı `teslimatSehri` Türkiye'de hep listedendir. Listede olmayan
 *     MEVCUT değer (eski / beklenmeyen kayıt) kutuda aynen görünür; kullanıcı dokunmadıkça değişmez.
 *   • Diğer ülke — serbest metin + öneri (`<datalist>`, `useCitiesForCountry`). «Yalnız listeden» kuralı burada YOK:
 *     öneri boşsa (çevrim dışı, küçük ülke) kutu yine yazılabilir. Öneri adları GeoNames / İngilizce yazımdır ('Munich').
 *     TR'de şehir isteği YAPILMAZ — `public/geo/cities/TR.json` il listesi değildir (1.052 yerleşim; 5 il yok).
 *   • `saltOkunur` (mağaza kilidi) — seçici DEĞİL: kayıttaki değeri AYNEN gösteren salt okunur kutu («Çankaya / Ankara»).
 *
 * TR KİPİ KLAVYE / FARE:
 *   • Odak, yazma ya da ↓ listeyi açar. Yalnız odakla açılan listede etkin seçenek YOKTUR; yazınca ilk eşleşme etkin olur.
 *   • ↓ / ↑ etkin seçeneği gezdirir (uçta durur). Enter: liste AÇIKKEN her zaman `preventDefault` — Yeni Sipariş
 *     penceresi `<form>`dur, il ararken sipariş kaydedilmesin; etkin seçenek varsa onu seçer.
 *   • Escape: liste açıkken YALNIZ listeyi kapatır, yazılan atılır. Dinleyici YEREL (DOM) olaydır: pencere Escape'i
 *     kendi kökünde yerel dinleyiciyle yakalıyorsa (`useModalErisilebilirlik`) React işleyicisi ona göre GEÇ kalır —
 *     olay React köküne varmadan pencere kapanmış olurdu.
 *   • Fare / dokunma seçimi `onMouseDown` + `preventDefault` (kutu odağı kaybetmez → odak kaybı yarışı ve zamanlayıcı yok).
 *   • Odak çıkınca: kutu BOŞSA seçim temizlenir; yazılan bir ile birebir eşitse (`ilBul`: 'antalya' → Antalya) o il
 *     seçilir; aksi hâlde yazılan atılır, önceki seçim geri gelir.
 *
 * İl adları iki dilde de Türkçe yazımla gösterilir (özel ad). Etiket pencere tarafındadır: `<label htmlFor={id}>`.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ilBul, illeriSuz } from '../../data/iller';
import { useCitiesForCountry } from '../../hooks/useWorldGeo';
import { oc } from '../../i18n/ortak';

export interface IlSeciciProps {
  id: string;
  /** Seçili il / yazılmış şehir; '' = seçilmemiş. */
  deger: string;
  onDegis: (il: string) => void;
  /** ETKİN ülke kodu (`etkinUlke` uygulanmış). */
  ulke: string;
  saltOkunur?: boolean;
  dil: 'tr' | 'en';
  className?: string;
}

type KipProps = Pick<IlSeciciProps, 'id' | 'deger' | 'onDegis' | 'dil'> & { className: string };

const VARSAYILAN_SINIF = 'apple-input w-full text-sm';

/** Seçenek öğesinin DOM kimliği — `aria-activedescendant` ve görünür alana kaydırma aynı kimliği kullanır. */
const secenekKimligi = (id: string, sira: number): string => `${id}-secenek-${sira}`;

/** Türkiye: arama kutulu açılır liste (81 il). */
function TurkiyeIlKutusu({ id, deger, onDegis, dil, className }: KipProps) {
  const [acik, setAcik] = useState(false);
  /** Kutuya YAZILAN metin; `null` = kullanıcı yazmıyor, kutu seçili ili (`deger`) gösterir. */
  const [yazilan, setYazilan] = useState<string | null>(null);
  /** Etkin (klavyeyle işaretli) seçeneğin `secenekler` içindeki sırası; -1 = yok. */
  const [etkin, setEtkin] = useState(-1);
  const kutuRef = useRef<HTMLInputElement>(null);
  const acikRef = useRef(acik);
  acikRef.current = acik;
  /** Odak fareyle geldiyse, o tıklamanın `mouseup`'ı odakta yapılan «tümünü seç»i bozmasın (bkz. `onFocus`). */
  const tumuSeciliRef = useRef(false);

  const listeKimligi = `${id}-liste`;
  const secenekler = illeriSuz(yazilan === null ? '' : yazilan);

  /** Listeyi kapatır ve yazılanı atar — kutu yeniden seçili ili (`deger`) gösterir. */
  const kapat = useCallback(() => { setAcik(false); setYazilan(null); setEtkin(-1); }, []);
  const sec = (il: string) => { kapat(); if (il !== deger) onDegis(il); };

  // Escape — YEREL dinleyici (başlık yorumu). Liste kapalıyken olaya dokunulmaz: pencere kendi Escape'ini görür.
  useEffect(() => {
    const kutu = kutuRef.current;
    if (!kutu) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !acikRef.current) return;
      e.stopPropagation();
      kapat();
    };
    kutu.addEventListener('keydown', escape);
    return () => kutu.removeEventListener('keydown', escape);
  }, [kapat]);

  // Etkin seçenek liste görünür alanının dışındaysa içeri kaydırılır. `scrollIntoView` jsdom'da yoktur → isteğe bağlı çağrı.
  useEffect(() => {
    if (!acik || etkin < 0) return;
    document.getElementById(secenekKimligi(id, etkin))?.scrollIntoView?.({ block: 'nearest' });
  }, [acik, etkin, id]);

  const tus = (e: React.KeyboardEvent<HTMLInputElement>) => {
    tumuSeciliRef.current = false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!acik) { setAcik(true); return; }
      setEtkin(sira => Math.min(sira + 1, secenekler.length - 1));
    } else if (e.key === 'ArrowUp') {
      if (!acik) return;
      e.preventDefault();
      setEtkin(sira => (sira > 0 ? sira - 1 : sira));
    } else if (e.key === 'Enter') {
      if (!acik) return;                       // liste kapalı: Enter pencerenin (form gönderimi)
      e.preventDefault();
      if (etkin >= 0 && etkin < secenekler.length) sec(secenekler[etkin]);
    }
  };

  const odakCikti = () => {
    const metin = yazilan;
    tumuSeciliRef.current = false;
    kapat();
    if (metin === null) return;                // kullanıcı yazmadı → seçim aynen
    if (metin.trim() === '') { if (deger !== '') onDegis(''); return; }
    const il = ilBul(metin);
    if (il !== null && il !== deger) onDegis(il);
  };

  return (
    <div className="relative">
      <input
        ref={kutuRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={acik}
        aria-controls={listeKimligi}
        aria-autocomplete="list"
        aria-activedescendant={acik && etkin >= 0 ? secenekKimligi(id, etkin) : undefined}
        autoComplete="off"
        value={yazilan === null ? deger : yazilan}
        placeholder={oc(dil).il_secin}
        className={className}
        // Odakta «tümünü seç»: kutu seçili ili gösterirken yazılan ilk harf onun YERİNE geçsin ('Antalya' + 'b' →
        // 'Antalyab' değil 'b'). Bazı tarayıcılar odağı getiren tıklamanın `mouseup`'ında seçimi kaldırır → o tek
        // `mouseup` yutulur.
        onFocus={e => { setAcik(true); e.target.select(); tumuSeciliRef.current = true; }}
        onMouseUp={e => { if (tumuSeciliRef.current) { e.preventDefault(); tumuSeciliRef.current = false; } }}
        onClick={() => setAcik(true)}
        onChange={e => {
          const metin = e.target.value;
          setYazilan(metin);
          setAcik(true);
          setEtkin(metin.trim() !== '' && illeriSuz(metin).length > 0 ? 0 : -1);
        }}
        onKeyDown={tus}
        onBlur={odakCikti}
      />
      {acik && (
        // Kabın kendisinde de `preventDefault`: kaydırma çubuğuna / boşluğa basmak kutunun odağını düşürmesin.
        <div
          id={listeKimligi}
          role="listbox"
          onMouseDown={e => e.preventDefault()}
          className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto"
        >
          {secenekler.map((il, sira) => (
            <div
              key={il}
              id={secenekKimligi(id, sira)}
              role="option"
              aria-selected={sira === etkin}
              onMouseDown={e => { e.preventDefault(); sec(il); }}
              className={`px-4 py-2 text-sm cursor-pointer border-b border-gray-50 last:border-0 ${sira === etkin ? 'bg-gray-100' : 'hover:bg-gray-50'} ${il === deger ? 'font-semibold text-brand' : 'text-[#1D1D1F]'}`}
            >
              {il}
            </div>
          ))}
          {secenekler.length === 0 && (
            <div role="option" aria-disabled="true" aria-selected={false} className="px-4 py-3 text-xs text-[#86868B]">
              {oc(dil).arama_sonucu_bulunamadi}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Diğer ülke: serbest metin + o ülkenin şehir önerileri. */
function SerbestSehirKutusu({ id, deger, onDegis, dil, className, ulke }: KipProps & { ulke: string }) {
  const oneriler = useCitiesForCountry(ulke);
  const oneriKimligi = `${id}-oneriler`;
  return (
    <>
      <input
        id={id}
        type="text"
        list={oneriKimligi}
        autoComplete="off"
        value={deger}
        placeholder={oc(dil).sehir_yazin}
        className={className}
        onChange={e => onDegis(e.target.value)}
      />
      <datalist id={oneriKimligi}>
        {oneriler.map(sehir => <option key={sehir} value={sehir} />)}
      </datalist>
    </>
  );
}

export default function IlSecici({ id, deger, onDegis, ulke, saltOkunur = false, dil, className = VARSAYILAN_SINIF }: IlSeciciProps) {
  if (saltOkunur) return <input id={id} type="text" readOnly value={deger} className={className} />;
  if (ulke === 'TR') return <TurkiyeIlKutusu id={id} deger={deger} onDegis={onDegis} dil={dil} className={className} />;
  // `key`: ülke değişince kutu yeniden kurulur — önceki ülkenin önerileri yenisi gelene kadar listede kalmasın.
  return <SerbestSehirKutusu key={ulke} id={id} deger={deger} onDegis={onDegis} dil={dil} className={className} ulke={ulke} />;
}
