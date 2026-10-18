/**
 * FaturaEttnEkle.tsx — faturası Mikro'da KESİLMİŞ (`gonderildi`) ama geçerli ETTN'si kayıtlı olmayan siparişe ETTN ekleme (şartname
 * «fatura gövde + gece MF» § 9.B B2 / B5, 2026-10-19).
 *
 * NEDEN: gece faturadan-sipariş işi Mikro faturasını Cetpa siparişine ETTN ile bağlar. ETTN'si okunamamış (yanıtta yoktu, sıfır ya
 * da biçimsiz geldi, «Mikro'da var» ETTN'siz seçildi) `gonderildi` sipariş varken aynı müşterinin yeni faturaları BEKLETİLİR
 * (hangi faturanın bu sipariş olduğu bilinmiyor — ikinci sipariş türerse ciro iki kez sayılır). Kullanıcı Mikro'daki ETTN'yi
 * buradan girer; bekletme sonraki koşuda kalkar.
 *
 * Görünürlük OrdersPage'de (AYRI koşul): `mikroFaturaSonucuCozebilir && !suruyor && faturaIsareti(canli)?.durum === 'gonderildi'
 * && !cetpaEttnAnahtari(canli.ettn)` — düğmeyi gören rol = `POST /api/mikro/fatura/sonuc` kapısından geçen rol. Ön sınama
 * `FaturaSonucuSecenekleri` ile AYNI işlev (`ettnGirdisi`); burada ETTN ZORUNLU: boş ya da geçersizken düğme pasif. Karar bu
 * bileşende VERİLMEZ: `onEkle` App.tsx `handleMikroFaturaEttnEkle`'yi çağırır (onay penceresi + istek orada). Gönderilen ANAHTARDIR.
 */
import { useId, useState } from 'react';
import { Link } from 'lucide-react';
import type { Order } from '../../types';
import type { ArayuzDili } from '../../utils/zaman';
import { ETTN_GIRDI_UZUNLUGU, ettnGecersizMetni, ettnGirdisi, ettnYardimMetni } from '../../utils/siparisler/ettnGirdisi';

interface Props {
  siparis: Order;
  dil: ArayuzDili;
  /** Geçerli ETTN'nin ANAHTARI ile çağrılır (yalnız düğme etkinken). */
  onEkle: (ettn: string) => void;
}

export default function FaturaEttnEkle({ siparis, dil, onEkle }: Props) {
  const [ham, setHam] = useState('');
  const ettn = ettnGirdisi(ham);
  const kimlik = useId();
  const tr = dil === 'tr';
  const pasif = ettn.anahtar === '';
  return (
    <div data-fatura-ettn-ekle={siparis.id} className="w-full rounded-2xl border border-[#1a3a5c]/20 bg-[#1a3a5c]/5 px-4 py-3 text-[#1a3a5c] space-y-2">
      <p className="text-sm font-bold flex items-center gap-2">
        <Link className="w-4 h-4 shrink-0" />
        {tr ? 'Faturanın ETTN\'si kayıtlı değil' : 'The invoice ETTN is not on record'}
      </p>
      <p className="text-xs">
        {tr
          ? 'Fatura Mikro\'da kesildi ama ETTN\'si bu siparişe yazılmadı. Bu yüzden aynı müşterinin yeni Mikro faturaları siparişe dönüştürülmeden bekletilir. Mikro\'daki ETTN\'yi girin: fatura bu siparişe bağlanır, bekletme sonraki koşuda kalkar.'
          : 'The invoice was issued in Mikro but its ETTN was not recorded on this order, so new Mikro invoices of this customer are held instead of being turned into orders. Enter the ETTN from Mikro: the invoice is linked to this order and the hold is lifted on the next run.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={ham}
          onChange={e => setHam(e.target.value)}
          maxLength={ETTN_GIRDI_UZUNLUGU}
          spellCheck={false}
          autoComplete="off"
          aria-label="Mikro ETTN"
          aria-describedby={`${kimlik}-yardim${ettn.gecersiz ? ` ${kimlik}-hata` : ''}`}
          aria-invalid={ettn.gecersiz}
          placeholder="ETTN"
          className="apple-input text-sm w-80 max-w-full font-mono"
        />
        <button
          type="button"
          data-fatura-ettn-ekle-dugmesi={siparis.id}
          disabled={pasif}
          onClick={() => { if (!pasif) onEkle(ettn.anahtar); }}
          className="bg-[#1a3a5c] text-white px-4 py-2 rounded-full text-sm font-bold shadow-sm hover:bg-[#13304d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {tr ? 'ETTN ekle' : 'Add ETTN'}
        </button>
      </div>
      <p id={`${kimlik}-yardim`} className="text-xs text-[#1a3a5c]/80">{ettnYardimMetni(dil)}</p>
      {ettn.gecersiz && (
        <p id={`${kimlik}-hata`} role="alert" data-ettn-hatasi={siparis.id} className="text-xs font-semibold text-red-700">
          {ettnGecersizMetni(dil)}
        </p>
      )}
    </div>
  );
}
