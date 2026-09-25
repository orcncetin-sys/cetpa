/**
 * Mikro faturasından türeyen siparişin kalemleri Cetpa'ya aktarılmamışken (2026-09-25 kullanıcı bildirimi: MF-383
 * "sipariş kalemleri gelmemiş") Mikro'dan CANLI okunan kalem tablosu. Tutarlar NET ve KDV HARİÇ — satır + fatura altı
 * iskontoları düşülmüş (lib/stokFiyat.kalemleriCoz, fatura detayı ve Fiyat Karşılaştırma ile AYNI hesap; ciro kararı
 * K-KALEM "KDV hariç"). Alt satırda KDV ve siparişin (faturanın) genel toplamı ayrı yazılır.
 */
import { useMemo } from 'react';
import { kalemleriCoz, kalemSaglamasi } from '../../lib/stokFiyat';
import { mikroKalemNotlari } from '../../services/mikroFaturaKalemleri';
import { ekranTutari, toplaBilinen } from '../../utils/para';
import { paraYaz } from '../../utils/currency';
import { oc } from '../../i18n/ortak';

interface Props {
  durum: 'yukleniyor' | 'hazir' | 'hata';
  kalemler: Record<string, unknown>[];
  hata: string | null;
  /** Fatura genel toplamı (siparişin `totalPrice`, KDV dâhil) — iskonto hakemliği + alt satır. */
  genelToplam: unknown;
  evrakNo: string;
  dil: string;
}

export default function MikroSiparisKalemleri({ durum, kalemler, hata, genelToplam, evrakNo, dil }: Props) {
  const tr = dil === 'tr';
  const cozumler = useMemo(() => kalemleriCoz(kalemler, genelToplam), [kalemler, genelToplam]);
  if (durum === 'yukleniyor') return <p className="text-sm text-gray-400 py-6 text-center">{tr ? 'Kalemler Mikro faturasından yükleniyor…' : 'Loading lines from the Mikro invoice…'}</p>;
  if (durum === 'hata') return <p className="text-sm text-red-600 py-6 text-center">{hata}</p>;
  if (kalemler.length === 0) return <p className="text-sm text-gray-400 py-6 text-center">{tr ? 'Mikro faturasında kalem bulunamadı.' : 'No lines on the Mikro invoice.'}</p>;
  const ara = toplaBilinen(cozumler, c => c.net);
  const kdv = toplaBilinen(kalemler, k => k.sth_vergi);
  const saglama = kalemSaglamasi(kalemler, cozumler, genelToplam);
  const notlar = mikroKalemNotlari(ara.bilinmeyen, kdv.bilinmeyen, saglama, dil);
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
        {tr
          ? `Kalemler Cetpa'ya aktarılmamış — Mikro faturasından (evrak ${evrakNo}) canlı okunuyor. Tutarlar KDV hariç, iskontolar düşülmüş.`
          : `Lines were not imported into Cetpa — read live from the Mikro invoice (doc ${evrakNo}). Amounts excl. VAT, discounts deducted.`}
      </p>
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr className="text-[10px] font-bold text-gray-500 uppercase">
              <th className="px-4 py-2 text-left">{oc(dil).urun}</th>
              <th className="px-4 py-2 text-center">{oc(dil).miktar}</th>
              <th className="px-4 py-2 text-right">{tr ? 'Birim (KDV hariç)' : 'Unit (excl. VAT)'}</th>
              <th className="px-4 py-2 text-right">{tr ? 'Tutar (KDV hariç)' : 'Amount (excl. VAT)'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {kalemler.map((k, i) => {
              const c = cozumler[i];
              const ad = String(k.urunAdi ?? '').trim() || String(k.sth_stok_kod ?? '—');
              return (
                <tr key={i}>
                  <td className="px-4 py-3">
                    <p className="font-bold text-[#1D2226]">{ad}</p>
                    {k.sth_stok_kod != null && <p className="text-[10px] text-gray-400">{String(k.sth_stok_kod)}</p>}
                  </td>
                  <td className="px-4 py-3 text-center font-medium">{c?.miktar ?? '—'}{typeof k.birim === 'string' && k.birim ? ` ${k.birim}` : ''}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{paraYaz(c?.birimFiyat ?? null)}</td>
                  <td className="px-4 py-3 text-right font-bold text-[#1D2226]">{paraYaz(c?.net ?? null)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 text-sm">
            <tr>
              <td colSpan={3} className="px-4 py-2 text-gray-500">{tr ? 'Ara toplam (KDV hariç)' : 'Subtotal (excl. VAT)'}</td>
              <td className="px-4 py-2 text-right font-semibold">{paraYaz(ekranTutari(ara))}</td>
            </tr>
            {saglama !== null && saglama.masraf > 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-2 text-gray-500">{tr ? 'Masraf' : 'Charges'}</td>
                <td className="px-4 py-2 text-right">{paraYaz(saglama.masraf)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={3} className="px-4 py-2 text-gray-500">{oc(dil).kdv}</td>
              <td className="px-4 py-2 text-right">{paraYaz(ekranTutari(kdv))}</td>
            </tr>
            <tr>
              <td colSpan={3} className="px-4 py-3 font-bold text-gray-600">{tr ? 'Genel toplam (fatura)' : 'Grand total (invoice)'}</td>
              <td className="px-4 py-3 text-right text-lg font-bold text-brand">{paraYaz(genelToplam)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {notlar.map((n, i) => <p key={i} className="text-[11px] text-amber-700">{n}</p>)}
    </div>
  );
}
