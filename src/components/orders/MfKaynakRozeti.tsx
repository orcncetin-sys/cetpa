/**
 * MfKaynakRozeti.tsx: Mikro faturasından türeyen (MF) siparişin rozeti. OrdersPage'in satır içi MF dalından ÇIKARILDI (şartname
 * «Mikro bağlantı B» BH16, 05.11.2026): üç dal tek yerde, render testi `MfKaynakRozeti.test.tsx`, bağlantı çiti
 * `src/test/qSerisi.kaynak.test.ts` (OrdersPage `<MfKaynakRozeti` çağırır, satır içi dal kalmaz).
 *
 * DALLAR (sıra önemli; TEK rozet basılır):
 *   1. Kaynaksız (`mfKaynaksizMi`; Mikro'da aynı numarada satış faturası yok, sunucu işareti): amber «Mikro'da satış faturası yok»;
 *      başlıkta gece kontrolünün tarihi ve «ciroya ve KDV'ye sayılmaz; sipariş silinmez». Seri Q ise başlığa seri bilgisi eklenir
 *      (kaynaksız durum ciro dışılığını bildirdiği için önce gelir; Q yalnız seri bilgisidir).
 *   2. Seri Q (`faturasizEtiketi`; q-serisi v3 QH5-9): «FATURASIZ · MİKRO Q».
 *   3. Öteki MF: «MİKRO FATURA» (mobilde kısa «MİKRO FTR»).
 * Metinler doğru yazımla sözlükte (i18n/orders); `toUpperCase` YOK.
 */
import type { Order } from '../../types';
import { op } from '../../i18n/orders';
import { faturasizEtiketi } from '../../utils/durumEtiketi';
import { mfKaynaksizMi } from '../../lib/mfKaynagi';
import { tarihYaz } from '../../utils/zaman';

type RozetSiparisi = Pick<Order, 'id' | 'source' | 'faturali' | 'mikroEvrak' | 'mfKaynaksiz' | 'mfKaynaksizGoruldu'>;

export default function MfKaynakRozeti({ order, currentLanguage, boyut = 'liste' }: {
  order: RozetSiparisi;
  currentLanguage: string;
  /** `liste`: masaüstü tablo hücresi; `mobil`: kart altındaki küçük rozet. */
  boyut?: 'liste' | 'mobil';
}) {
  const dil = currentLanguage === 'tr' ? 'tr' : 'en';
  const s = op(dil);
  const kucuk = boyut === 'mobil' ? 'text-[8px] font-bold px-1 py-0.5 rounded-full' : 'text-[9px] font-bold px-1.5 py-0.5 rounded-full';
  const turetildi = dil === 'tr'
    ? `Mikro satış faturasından türetildi (${order.mikroEvrak ? order.mikroEvrak.seri + order.mikroEvrak.sira : ''})`
    : 'Derived from Mikro sales invoice';
  const qEtiketi = faturasizEtiketi(order, currentLanguage);
  if (mfKaynaksizMi(order)) {
    const baslik = [s.mf_kaynaksiz_aciklama.replace('{tarih}', tarihYaz(order.mfKaynaksizGoruldu, undefined, dil)), qEtiketi ? s.mf_kaynaksiz_q_seri_eki : null]
      .filter((x): x is string => x !== null).join(' ');
    return (
      <span data-mf-kaynaksiz-rozet={order.id} className={`${kucuk} bg-amber-50 text-amber-700`} title={baslik}>
        {s.mikroda_satis_faturasi_yok}
      </span>
    );
  }
  if (qEtiketi) {
    return <span data-faturasiz-rozet={order.id} className={`${kucuk} bg-gray-100 text-gray-500`} title={turetildi}>{qEtiketi}</span>;
  }
  return (
    <span className={`${kucuk} bg-[#1a3a5c]/10 text-[#1a3a5c]`} title={turetildi}>
      {boyut === 'mobil' ? s.mikro_ftr : s.mikro_fatura}
    </span>
  );
}
