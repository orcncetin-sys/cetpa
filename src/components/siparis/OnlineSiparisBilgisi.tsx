/**
 * OnlineSiparisBilgisi — Siparişler ekranındaki çevrim içi mağaza yüzeyleri (şartname online-siparis 2026-10-02 §4):
 *   • `OnlineRozeti`        — liste satırındaki küçük "Online" rozeti;
 *   • `OnlineSiparisBilgisi` — sipariş detayındaki bilgi bloğu: mağazadaki ödeme ve kargo durumu, e-posta, telefon,
 *                              ödeme yöntemi, müşteri notu (+ TRY dışı siparişte kendi para birimindeki tutar).
 *
 * İkisi de `magazaSiparisiMi` (`source === 'shopify_webhook'`) DEĞİLSE hiçbir şey çizmez — çağıran koşul yazmaz, kural
 * tek yerde kalır. SALT OKUNUR: mağazanın söylediği gösterilir; Cetpa'daki durum ve "ödendi" işareti detayın kendi
 * alanlarında (durum seçicisi, Ödeme düğmesi) durur, burada tekrar edilmez.
 *
 * Bilinmeyen alan '—' basılır. Mağazanın ham durumları (`shopifyRaw`) etiket eşlemesinden geçer
 * (utils/durumEtiketi) — 'partially_paid' gibi ham değer ekrana sızmaz, tanınmayan değer büyütülmeden basılır.
 */
import React from 'react';
import { ShoppingBag } from 'lucide-react';
import type { Order } from '../../types';
import { oc } from '../../i18n/ortak';
import { osc } from '../../i18n/onlineSiparis';
import { kargoDurumuEtiketi, odemeDurumuEtiketi } from '../../utils/durumEtiketi';
import { magazaSiparisiMi, magazaTutarMetni, tryDisiMi } from '../../utils/siparisler/magazaSiparisi';

type Dil = 'tr' | 'en';

/** Liste satırı rozeti. Mağaza siparişi değilse null. */
export function OnlineRozeti({ siparis, dil }: { siparis: Pick<Order, 'source'>; dil: Dil }) {
  if (!magazaSiparisiMi(siparis)) return null;
  const t = osc(dil);
  return (
    <span title={t.online_magaza_siparisi} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 flex-shrink-0">
      {t.online}
    </span>
  );
}

const dolu = (x: unknown): string => (typeof x === 'string' && x.trim() !== '' ? x.trim() : '');

function Satir({ baslik, children }: { baslik: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-gray-500 block text-[10px] uppercase font-bold">{baslik}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  );
}

/** Sipariş detayındaki bilgi bloğu. Mağaza siparişi değilse null. */
export default function OnlineSiparisBilgisi({ siparis, dil }: { siparis: Order; dil: Dil }) {
  if (!magazaSiparisiMi(siparis)) return null;
  const t = osc(dil);
  const o = oc(dil);
  const ham = siparis.shopifyRaw;
  // `shopifyRaw` hiç yoksa iki durum da BİLİNMİYOR ('—'); varsa `fulfillmentStatus: null` Shopify'ın "gönderilmedi"sidir.
  const odeme = ham ? odemeDurumuEtiketi(ham.financialStatus, dil) : '—';
  const kargo = ham ? kargoDurumuEtiketi(ham.fulfillmentStatus, dil) : '—';
  const tutar = magazaTutarMetni(siparis);
  return (
    <section aria-label={t.online_siparis_bilgisi} className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
      <h3 className="font-bold mb-4 flex items-center gap-2">
        <ShoppingBag className="w-4 h-4 text-brand" aria-hidden="true" />
        {t.online_siparis_bilgisi}
      </h3>
      <dl className="space-y-4 text-sm">
        <Satir baslik={t.odeme_durumu}>{odeme}</Satir>
        <Satir baslik={t.kargo_durumu}>{kargo}</Satir>
        {/* TRY dışı siparişte detayın "Toplam" alanı '—' basar (TL tutar yazılmaz — kur uydurulmaz); gerçek tutar burada. */}
        {tryDisiMi(siparis) && (
          <Satir baslik={t.siparis_tutari}>
            {tutar.metin}{tutar.birimEki ? ` ${tutar.birimEki}` : ''}
            <span className="ml-1.5 text-xs font-normal text-gray-500">({t.kur_cevrilmedi})</span>
          </Satir>
        )}
        <Satir baslik={o.e_posta}>{dolu(siparis.customerEmail) || '—'}</Satir>
        <Satir baslik={o.telefon}>{dolu(siparis.customerPhone) || '—'}</Satir>
        <Satir baslik={t.odeme_yontemi}>{dolu(ham?.odemeYontemi) || '—'}</Satir>
        <Satir baslik={t.musteri_notu}>
          {dolu(siparis.musteriNotu) ? <span className="whitespace-pre-wrap">{dolu(siparis.musteriNotu)}</span> : '—'}
        </Satir>
      </dl>
    </section>
  );
}
