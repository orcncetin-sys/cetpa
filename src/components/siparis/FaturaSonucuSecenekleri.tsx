/**
 * FaturaSonucuSecenekleri.tsx — sonucu BİLİNMEYEN e-Fatura için sipariş ayrıntısındaki uyarı + iki seçenek (2026-10-17, şartname
 * «e-Fatura çift kesim» § 7 D6). Gönderim Mikro'ya gitti ama yanıt okunamadı (ağ, zaman aşımı, vekilin hata sayfası, stub) ya da
 * gönderim işareti bayatladı: fatura Mikro'da kesilmiş OLABİLİR. Kesim düğmesi bu durumda ÇİZİLMEZ (sunucu da 409 döner);
 * kullanıcı Mikro'da bakıp kaydı çözer:
 *   • «Mikro'da var» → sipariş faturalanmış sayılır (numara girilirse o da yazılır; girilmezse uydurulmaz). ETTN de girilebilir
 *     (şartname «fatura gövde + gece MF» § 9.B B5, 2026-10-19): gece faturadan-sipariş işi faturayı bu siparişe ETTN ile bağlar,
 *     aynı müşterinin yeni faturalarını bekletmez. İsteğe bağlı; doluysa `ettnGirdisi` (ölçüt `cetpaEttnAnahtari` — sunucuyla
 *     AYNI) geçersiz derse «Mikro'da var» PASİF ve satır içi hata. Gönderilen ANAHTARDIR (küçük harf, parantezsiz);
 *   • «Mikro'da yok, yeniden gönderilebilir» → işaret silinir, kesim düğmesi geri gelir.
 * Karar bu bileşende VERİLMEZ: `onKarar` App.tsx `handleMikroFaturaSonuc`'u çağırır — onay penceresi (resmî belge kararı; «yok»
 * `danger`) ve istek orada. Metinler Türkçe tam karakterle; büyük harf dönüşümü yok.
 */
import { useId, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Order } from '../../types';
import { faturaIsareti, type FaturaSonucKarari } from '../../lib/faturaGonderimi';
import { tarihSaatYaz, type ArayuzDili } from '../../utils/zaman';
import { ETTN_GIRDI_UZUNLUGU, ettnGecersizMetni, ettnGirdisi, ettnYardimMetni } from '../../utils/siparisler/ettnGirdisi';

/** Kararın ekleri: girilmeyen alan YOKTUR (boş metin gönderilmez). `ettn` = geçerli ETTN'nin anahtarı. */
export interface FaturaSonucEki { numara?: string; ettn?: string }

interface Props {
  siparis: Order;
  dil: ArayuzDili;
  onKarar: (karar: FaturaSonucKarari, ek?: FaturaSonucEki) => void;
}

export default function FaturaSonucuSecenekleri({ siparis, dil, onKarar }: Props) {
  const [numara, setNumara] = useState('');
  const [ettnHam, setEttnHam] = useState('');
  const ettn = ettnGirdisi(ettnHam);
  const kimlik = useId();
  const isaret = faturaIsareti(siparis);
  const tr = dil === 'tr';
  const deneme = isaret ? ` (${tarihSaatYaz(isaret.zaman, undefined, dil)} · ${isaret.kim || '—'})` : '';
  return (
    <div role="alert" data-fatura-sonucu={siparis.id} className="w-full rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 space-y-2">
      <p className="text-sm font-bold flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        {tr ? 'Fatura sonucu bilinmiyor' : 'Invoice result unknown'}
      </p>
      <p className="text-xs">
        {tr
          ? `Fatura Mikro'ya gönderildi ama sonucu okunamadı${deneme}. Mikro'da kesilmiş OLABİLİR: bu cari ve tutarla Mikro'da arayıp aşağıdan seçin.`
          : `The invoice was sent to Mikro but its result could not be read${deneme}. It MAY have been issued: search Mikro for this customer and amount, then choose below.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={numara}
          onChange={e => setNumara(e.target.value)}
          maxLength={64}
          aria-label={tr ? 'Mikro fatura numarası (isteğe bağlı)' : 'Mikro invoice number (optional)'}
          placeholder={tr ? 'Mikro fatura no (isteğe bağlı)' : 'Mikro invoice no (optional)'}
          className="apple-input text-sm w-56"
        />
        <input
          type="text"
          value={ettnHam}
          onChange={e => setEttnHam(e.target.value)}
          maxLength={ETTN_GIRDI_UZUNLUGU}
          spellCheck={false}
          autoComplete="off"
          aria-label={tr ? 'Mikro ETTN (isteğe bağlı)' : 'Mikro ETTN (optional)'}
          aria-describedby={`${kimlik}-yardim${ettn.gecersiz ? ` ${kimlik}-hata` : ''}`}
          aria-invalid={ettn.gecersiz}
          placeholder={tr ? 'ETTN (isteğe bağlı)' : 'ETTN (optional)'}
          className="apple-input text-sm w-80 max-w-full font-mono"
        />
        <button
          type="button"
          disabled={ettn.gecersiz}
          onClick={() => {
            if (ettn.gecersiz) return;
            const no = numara.trim();
            onKarar('mikrodaVar', { ...(no !== '' ? { numara: no } : {}), ...(ettn.anahtar !== '' ? { ettn: ettn.anahtar } : {}) });
          }}
          className="bg-[#1a3a5c] text-white px-4 py-2 rounded-full text-sm font-bold shadow-sm hover:bg-[#13304d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {tr ? 'Mikro\'da var' : 'It is in Mikro'}
        </button>
        <button
          type="button"
          onClick={() => onKarar('mikrodaYok')}
          className="bg-white text-red-700 border border-red-300 px-4 py-2 rounded-full text-sm font-bold shadow-sm hover:bg-red-50 transition-colors"
        >
          {tr ? 'Mikro\'da yok, yeniden gönderilebilir' : 'Not in Mikro, can be sent again'}
        </button>
      </div>
      <p id={`${kimlik}-yardim`} className="text-xs text-amber-800">{ettnYardimMetni(dil)}</p>
      {ettn.gecersiz && (
        <p id={`${kimlik}-hata`} role="alert" data-ettn-hatasi={siparis.id} className="text-xs font-semibold text-red-700">
          {ettnGecersizMetni(dil)}
        </p>
      )}
    </div>
  );
}
