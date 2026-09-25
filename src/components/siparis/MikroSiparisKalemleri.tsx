/**
 * Mikro faturasından türeyen siparişin kalemleri Cetpa'ya aktarılmamışken (2026-09-25 kullanıcı bildirimi: MF-383
 * "sipariş kalemleri gelmemiş") Mikro'dan CANLI okunan kalem tablosu. Tutarlar KDV HARİÇ (ciro kararı K-KALEM); iskonto
 * AYRI sütunda (K-İSKONTO "iskontoları atlama"): liste birim fiyatı → iskonto → net. Satır + fatura altı iskonto
 * lib/stokFiyat.kalemleriCoz ile (fatura detayı ve Fiyat Karşılaştırma ile AYNI hesap). Tablo modeli fişle ORTAK:
 * services/mikroFaturaKalemleri.mikroKalemTablosu. Alt satırda KDV ve siparişin (faturanın) genel toplamı ayrı yazılır.
 */
import { useMemo } from 'react';
import { mikroKalemTablosu, kayitliKalemTablosu, type KayitliMikroKalem } from '../../services/mikroFaturaKalemleri';
import { ekranTutari } from '../../utils/para';
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
  /** Faturadan-sipariş importunun YAZDIĞI sürüm-2 kalemler (2026-09-25). Verilirse canlı okuma YOK; tablo bunlardan. */
  kayitli?: readonly KayitliMikroKalem[];
}

export default function MikroSiparisKalemleri({ durum, kalemler, hata, genelToplam, evrakNo, dil, kayitli }: Props) {
  const tr = dil === 'tr';
  const tablo = useMemo(
    () => (kayitli ? kayitliKalemTablosu(kayitli, genelToplam, dil) : mikroKalemTablosu(kalemler, genelToplam, dil)),
    [kayitli, kalemler, genelToplam, dil]);
  if (!kayitli && durum === 'yukleniyor') return <p className="text-sm text-gray-400 py-6 text-center">{tr ? 'Kalemler Mikro faturasından yükleniyor…' : 'Loading lines from the Mikro invoice…'}</p>;
  if (!kayitli && durum === 'hata') return <p className="text-sm text-red-600 py-6 text-center">{hata}</p>;
  if (tablo.satirlar.length === 0) return <p className="text-sm text-gray-400 py-6 text-center">{tr ? 'Mikro faturasında kalem bulunamadı.' : 'No lines on the Mikro invoice.'}</p>;
  // Brüt/iskonto alt satırları yalnız BİLİNEN iskonto varken (inceleme 2026-09-25: bilinmeyen kalem varken "−₺0,00"
  // sahte kesinlik basıyordu). Çözülemeyen kalem notta: "brüt, iskonto ve ara toplama girmedi".
  const iskontoVar = tablo.iskonto.toplam > 0;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
        {kayitli
          ? (tr
            ? `Kalemler Mikro faturasından (evrak ${evrakNo}) aktarıldı. Tutarlar KDV hariç; iskonto ayrı sütunda, net tutardan düşülmüş.`
            : `Lines imported from the Mikro invoice (doc ${evrakNo}). Amounts excl. VAT; discount shown separately and deducted from the net amount.`)
          : (tr
            ? `Kalemler Cetpa'ya aktarılmamış — Mikro faturasından (evrak ${evrakNo}) canlı okunuyor. Tutarlar KDV hariç; iskonto ayrı sütunda, net tutardan düşülmüş.`
            : `Lines were not imported into Cetpa — read live from the Mikro invoice (doc ${evrakNo}). Amounts excl. VAT; discount shown separately and deducted from the net amount.`)}
      </p>
      <div className="border border-gray-100 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr className="text-[10px] font-bold text-gray-500 uppercase">
              <th className="px-4 py-2 text-left">{oc(dil).urun}</th>
              <th className="px-4 py-2 text-center">{oc(dil).miktar}</th>
              <th className="px-4 py-2 text-right">{tr ? 'Birim fiyat (KDV hariç)' : 'Unit price (excl. VAT)'}</th>
              <th className="px-4 py-2 text-right">{tr ? 'İskonto' : 'Discount'}</th>
              <th className="px-4 py-2 text-right">{tr ? 'Tutar (net, KDV hariç)' : 'Amount (net, excl. VAT)'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {tablo.satirlar.map((s, i) => (
              <tr key={i}>
                <td className="px-4 py-3">
                  <p className="font-bold text-[#1D2226]">{s.ad}</p>
                  {s.sku !== null && <p className="text-[10px] text-gray-400">{s.sku}</p>}
                </td>
                <td className="px-4 py-3 text-center font-medium">{s.miktarMetni}</td>
                <td className="px-4 py-3 text-right text-gray-500 tabular-nums">{paraYaz(s.birimFiyat)}</td>
                <td className={`px-4 py-3 text-right tabular-nums ${s.iskonto ? 'text-amber-700' : 'text-gray-400'}`}
                  title={!s.iskonto ? undefined
                    : s.faturaAltiKaynagi === 'baslik' ? (tr ? 'Fatura altı iskonto — satırda yazılı değil; fatura toplamından satırlara dağıtıldı' : 'Invoice-level discount — not on the line; allocated from the invoice total')
                    : s.faturaAltiKaynagi === 'kdv' ? (tr ? "Fatura altı iskonto TAHMİNİ — satırda yazılı değil, fatura toplamıyla doğrulanamadı; satırın KDV'sinden türetildi" : 'Estimated invoice-level discount — not on the line, not verifiable via the invoice total; derived from the line VAT')
                    : undefined}>
                  {s.iskonto === null ? '—' : s.iskonto > 0 ? `−${paraYaz(s.iskonto)}` : paraYaz(0)}
                </td>
                <td className="px-4 py-3 text-right font-bold text-[#1D2226] tabular-nums">{paraYaz(s.net)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 text-sm">
            {iskontoVar && (
              <>
                <tr>
                  <td colSpan={4} className="px-4 py-2 text-gray-500">{tr ? 'Brüt toplam (KDV hariç)' : 'Gross total (excl. VAT)'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{paraYaz(ekranTutari(tablo.brut))}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-4 py-2 text-gray-500">{tr ? 'İskonto' : 'Discount'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-amber-700">−{paraYaz(ekranTutari(tablo.iskonto))}</td>
                </tr>
              </>
            )}
            <tr>
              <td colSpan={4} className="px-4 py-2 text-gray-500">{tr ? 'Ara toplam (net, KDV hariç)' : 'Subtotal (net, excl. VAT)'}</td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums">{paraYaz(ekranTutari(tablo.ara))}</td>
            </tr>
            {tablo.masraf !== null && tablo.masraf > 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-2 text-gray-500">{tr ? 'Masraf' : 'Charges'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{paraYaz(tablo.masraf)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={4} className="px-4 py-2 text-gray-500">{oc(dil).kdv}</td>
              <td className="px-4 py-2 text-right tabular-nums">{paraYaz(ekranTutari(tablo.kdv))}</td>
            </tr>
            <tr>
              <td colSpan={4} className="px-4 py-3 font-bold text-gray-600">{tr ? 'Genel toplam (fatura)' : 'Grand total (invoice)'}</td>
              <td className="px-4 py-3 text-right text-lg font-bold text-brand tabular-nums">{paraYaz(genelToplam)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {tablo.notlar.map((n, i) => <p key={i} className="text-[11px] text-amber-700">{n}</p>)}
    </div>
  );
}
