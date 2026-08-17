/**
 * MikroFaturaDetay.tsx — Mikro faturasının detay penceresi + XML/PDF indirme.
 *
 * 2026-08-01: Faturalar sekmesinde yalnız tablo vardı; kullanıcı satıra girip
 * belgenin XML ve PDF'ini alabilmek istedi.
 *
 * XML e-belgenin YASAL aslıdır, PDF yalnız görüntüsüdür — mali müşavire
 * gönderim ve arşiv için gereken XML'dir. İkisi de Mikro'dan çekilir
 * (/api/mikro/ebelge/xml ve /api/mikro/ebelge/pdf).
 *
 * UUID yoksa e-belge çekilemez: fatura Mikro'da kesilmiş ama GİB'e
 * gönderilmemiş (ya da kağıt fatura) olabilir. O durumda düğmeler yerine
 * sebebi yazılır — sessizce boş buton göstermek yanıltıcı olur.
 */
import { useState, useEffect, useMemo } from 'react';
import { X, Download, FileCode, Loader2, AlertTriangle, Package } from 'lucide-react';
import { eBelgeIndir } from '../services/ebelgeIndir';
import { authFetch } from '../services/authFetch';
import { VERGI_PNTR_ORAN } from '../hooks/useMikroFaturalar';

export interface MikroFaturaDetayVerisi {
  id: string;
  faturaNo: string;
  musteri: string;
  cariKod: string;
  tarih: string;
  tutar: number;
  kdv: number;
  matrah: number;
  oran: number | null;
  oranKarma?: boolean;
  yon: 'gelen' | 'giden';
  uuid?: string;
}

interface Props {
  fatura: MikroFaturaDetayVerisi;
  currentLanguage: string;
  onClose: () => void;
}

const tl = (n: number) =>
  `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function MikroFaturaDetay({ fatura, currentLanguage, onClose }: Props) {
  const tr = currentLanguage === 'tr';
  const [indiriliyor, setIndiriliyor] = useState<'xml' | 'pdf' | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  /** Fatura KALEMLERİ (satırları) — Mikro Jump'ta fatura açılınca görülenin karşılığı.
   *  Başlık CARI_HESAP_HAREKETLERI'nde, satırlar STOK_HAREKETLERI'nde durur; sunucu
   *  evrak seri+sıra ve yön (satış=4 / alış=3) ile eşleştirir. */
  // faturaNo 'SERİ-SIRA' biçiminde birleştirilmişti; sıra son parçadır.
  const { seri, sira } = useMemo(() => {
    const p = (fatura.faturaNo || '').split('-');
    return { sira: p.at(-1) ?? '', seri: p.length > 1 ? p.slice(0, -1).join('-') : '' };
  }, [fatura.faturaNo]);
  const evrakOkunabilir = /^\d+$/.test(sira);

  const [kalemler, setKalemler] = useState<Record<string, unknown>[] | null>(null);
  const [cekimDurum, setCekimDurum] = useState<'yukleniyor' | 'hazir' | 'hata'>('yukleniyor');
  const [cekimHata, setCekimHata] = useState<string | null>(null);

  useEffect(() => {
    if (!evrakOkunabilir) return;   // durum türetilir, effect'te setState yok
    let iptal = false;
    (async () => {
      try {
        const r = await authFetch('/api/mikro/fatura/kalemler', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seri, sira, yon: fatura.yon }),
        });
        const d = await r.json() as { success?: boolean; error?: string; kalemler?: Record<string, unknown>[] };
        if (iptal) return;
        if (!r.ok || !d.success) { setCekimDurum('hata'); setCekimHata(d.error || (tr ? 'Kalemler alınamadı.' : 'Failed to load lines.')); return; }
        setKalemler(d.kalemler ?? []);
        setCekimDurum('hazir');
      } catch {
        if (!iptal) { setCekimDurum('hata'); setCekimHata(tr ? 'Sunucuya ulaşılamadı.' : 'Server unreachable.'); }
      }
    })();
    return () => { iptal = true; };
  }, [seri, sira, evrakOkunabilir, fatura.yon, tr]);

  // Okunamayan evrak no bir RENDER durumudur, effect yan etkisi değil.
  const kalemDurum = evrakOkunabilir ? cekimDurum : 'hata';
  const kalemHata = evrakOkunabilir
    ? cekimHata
    : (tr ? 'Evrak numarası okunamadı — kalemler getirilemiyor.' : 'Unreadable document number.');

  /** Karma KDV kırılımı (2026-08-17, kullanıcı bildirdi): fatura başlığı tek bir
   *  "%20" gösteriyordu ama satırlarda hem %10 hem %20'li ürün olabiliyordu.
   *  `kalemler` zaten sth_vergi_pntr/sth_vergi/sth_tutar'ı satır satır getiriyor
   *  — yeni bir Mikro sorgusu gerekmeden, burada gruplanıp gerçek kırılım
   *  gösterilebilir (liste ekranındaki "Karma" rozeti yalnız uyarı verir,
   *  burada asıl rakamlar var). */
  const oranKirilim = useMemo(() => {
    if (!kalemler?.length) return null;
    const map = new Map<string, { oran: number | null; matrah: number; kdv: number }>();
    for (const k of kalemler) {
      const oran = VERGI_PNTR_ORAN[String(k.sth_vergi_pntr ?? '')] ?? null;
      const key = oran === null ? 'bilinmiyor' : String(oran);
      const cur = map.get(key) ?? { oran, matrah: 0, kdv: 0 };
      cur.matrah += Number(k.sth_tutar ?? 0) || 0;
      cur.kdv += Number(k.sth_vergi ?? 0) || 0;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => (b.oran ?? -1) - (a.oran ?? -1));
  }, [kalemler]);

  const indir = async (tur: 'xml' | 'pdf') => {
    if (indiriliyor) return;
    setIndiriliyor(tur);
    setHata(null);
    // İndirme mantığı ortak serviste (EBelgeMerkezi de aynısını kullanır).
    setHata(await eBelgeIndir({
      tur,
      uuid: fatura.uuid,
      faturaGuid: fatura.id,
      belgeTuru: 'e-fatura',
      yon: fatura.yon,
      dosyaAdi: fatura.faturaNo || fatura.id,
    }, tr));
    setIndiriliyor(null);
  };

  const satir = (etiket: string, deger: string) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{etiket}</span>
      <span className="text-sm font-semibold text-[#1D1D1F]">{deger}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      {/* Kalem tablosu eklendiği için genişletildi; uzun faturada gövde kaydırılır. */}
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-[#1D1D1F]">
              {tr ? 'Fatura Detayı' : 'Invoice Detail'}
              <span className={`ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full align-middle ${fatura.yon === 'gelen' ? 'bg-purple-100 text-purple-600' : 'bg-teal-100 text-teal-700'}`}>
                {fatura.yon === 'gelen' ? (tr ? 'GELEN' : 'IN') : (tr ? 'GİDEN' : 'OUT')}
              </span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{fatura.faturaNo || '—'}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 min-h-0">
          {satir(tr ? 'Müşteri / Cari' : 'Customer', fatura.musteri)}
          {satir(tr ? 'Cari kodu' : 'Account code', fatura.cariKod || '—')}
          {satir(tr ? 'Tarih' : 'Date', fatura.tarih || '—')}
          {satir(tr ? 'Matrah' : 'Base', typeof fatura.matrah === 'number' ? tl(fatura.matrah) : '—')}
          {satir(tr ? 'KDV' : 'VAT', typeof fatura.kdv === 'number' ? `${tl(fatura.kdv)}${fatura.oranKarma ? (tr ? ' (Karma oran)' : ' (Mixed rate)') : (fatura.oran !== null ? ` (%${fatura.oran})` : '')}` : '—')}
          {fatura.oranKarma && oranKirilim && oranKirilim.length > 1 && (
            <div className="bg-amber-50 rounded-xl px-3 py-2 my-2 space-y-1">
              <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">{tr ? 'KDV Kırılımı' : 'VAT Breakdown'}</p>
              {oranKirilim.map(r => (
                <div key={String(r.oran)} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">{r.oran === null ? (tr ? 'Bilinmiyor' : 'Unknown') : `%${r.oran}`}</span>
                  <span className="font-semibold text-[#1D1D1F]">{tl(r.kdv)} <span className="text-gray-400 font-normal">({tr ? 'matrah' : 'base'} {tl(r.matrah)})</span></span>
                </div>
              ))}
            </div>
          )}
          {satir(tr ? 'Toplam' : 'Total', typeof fatura.tutar === 'number' ? tl(fatura.tutar) : '—')}

          {/* ── Fatura kalemleri ── */}
          <div className="mt-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Package size={13} className="text-gray-400" />
              <span className="text-xs font-bold text-gray-600">
                {tr ? 'Kalemler' : 'Line items'}
                {kalemler?.length ? <span className="text-gray-400 font-normal"> · {kalemler.length}</span> : null}
              </span>
            </div>

            {kalemDurum === 'yukleniyor' && (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                <Loader2 size={13} className="animate-spin" />{tr ? 'Kalemler yükleniyor…' : 'Loading lines…'}
              </div>
            )}

            {kalemDurum === 'hata' && (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2">
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />{kalemHata}
              </div>
            )}

            {kalemDurum === 'hazir' && kalemler?.length === 0 && (
              <p className="text-xs text-gray-400 py-2">
                {tr
                  ? 'Bu faturanın stok satırı yok — hizmet/masraf faturası olabilir.'
                  : 'No stock lines — may be a service/expense invoice.'}
              </p>
            )}

            {kalemDurum === 'hazir' && !!kalemler?.length && (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100">
                      <th className="text-left font-semibold py-1.5 px-1">{tr ? 'Ürün' : 'Product'}</th>
                      <th className="text-right font-semibold py-1.5 px-1">{tr ? 'Miktar' : 'Qty'}</th>
                      <th className="text-right font-semibold py-1.5 px-1">{tr ? 'Tutar' : 'Amount'}</th>
                      <th className="text-right font-semibold py-1.5 px-1">{tr ? 'KDV' : 'VAT'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kalemler.map((k, i) => {
                      const sku    = String(k.sth_stok_kod ?? '');
                      const ad     = String(k.urunAdi ?? '') || sku || '—';
                      const miktar = Number(k.sth_miktar ?? 0) || 0;
                      const tutar  = Number(k.sth_tutar ?? 0) || 0;
                      const kdv    = Number(k.sth_vergi ?? 0) || 0;
                      return (
                        <tr key={`${sku}-${i}`} className="border-b border-gray-50 last:border-0">
                          <td className="py-1.5 px-1 text-[#1D1D1F]">
                            <span className="font-medium">{ad}</span>
                            {sku && ad !== sku && <span className="block text-[10px] text-gray-400 font-mono">{sku}</span>}
                          </td>
                          <td className="py-1.5 px-1 text-right tabular-nums text-gray-600">
                            {miktar.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-1.5 px-1 text-right tabular-nums font-semibold text-[#1D1D1F]">{tl(tutar)}</td>
                          <td className="py-1.5 px-1 text-right tabular-nums text-gray-500">{tl(kdv)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {hata && (
            <div className="mt-3 flex items-start gap-2 text-xs text-red-700 bg-red-50 rounded-xl px-3 py-2">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />{hata}
            </div>
          )}

          {!fatura.uuid && (
            <div className="mt-3 text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2">
              {tr
                ? 'Bu faturanın GİB belge kimliği (UUID) yok — e-belge olarak gönderilmemiş olabilir. XML çekilemez; PDF Mikro belge numarasıyla denenir.'
                : 'No GİB document id (UUID) — may not have been sent as an e-document. XML unavailable; PDF is attempted by document id.'}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="apple-button-secondary px-4 py-2 text-sm">{tr ? 'Kapat' : 'Close'}</button>
          <button
            onClick={() => void indir('pdf')}
            disabled={!!indiriliyor}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {indiriliyor === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            PDF
          </button>
          <button
            onClick={() => void indir('xml')}
            disabled={!!indiriliyor || !fatura.uuid}
            title={!fatura.uuid ? (tr ? 'UUID yok — XML çekilemez' : 'No UUID') : (tr ? 'XML — belgenin yasal aslı' : 'XML — legal original')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {indiriliyor === 'xml' ? <Loader2 size={14} className="animate-spin" /> : <FileCode size={14} />}
            XML
          </button>
        </div>
      </div>
    </div>
  );
}
