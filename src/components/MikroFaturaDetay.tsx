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
import { useState } from 'react';
import { X, Download, FileCode, Loader2, AlertTriangle } from 'lucide-react';
import { authFetch } from '../services/authFetch';

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

  /** Yanıttaki base64/metin alanını bul — alan adı Mikro sürümüne göre değişir. */
  const uzunAlan = (d: unknown, minUzunluk: number) => {
    if (typeof d === 'string') return d.length > minUzunluk ? d : undefined;
    if (d && typeof d === 'object') {
      const vals = Object.values(d);
      for (const v of vals) {
        if (typeof v === 'string' && v.length > minUzunluk) return v;
      }
    }
    return undefined;
  };

  const indir = async (tur: 'xml' | 'pdf') => {
    if (indiriliyor) return;
    setIndiriliyor(tur);
    setHata(null);
    try {
      const url = tur === 'xml' ? '/api/mikro/ebelge/xml' : '/api/mikro/ebelge/pdf';
      const govde = tur === 'xml'
        ? { uuid: fatura.uuid, tur: 'e-fatura', yon: fatura.yon }
        : (fatura.uuid ? { uuid: fatura.uuid } : { faturaGuid: fatura.id });
      // authFetch ŞART: /api/mikro/ebelge/* requireAuth arkasında. Düz fetch +
      // credentials:'same-origin' yetmiyor — oturum çerezle değil Firebase ID
      // token'ıyla taşınıyor, o yüzden "Missing Authorization header" dönüyordu.
      const r = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(govde),
      });
      const d = await r.json() as { success?: boolean; error?: string; data?: unknown };
      if (!r.ok || !d.success) { setHata(d.error || (tr ? 'Belge alınamadı.' : 'Failed to fetch.')); return; }

      const alan = uzunAlan(d.data, tur === 'xml' ? 200 : 500);
      if (!alan) { setHata(tr ? 'Yanıt beklenen biçimde değil.' : 'Unexpected response shape.'); return; }

      let blob: Blob;
      if (tur === 'xml') {
        // Base64 de olabilir düz XML de — '<' ile başlıyorsa düzdür.
        const metin = alan.trimStart().startsWith('<') ? alan : (() => {
          try { return decodeURIComponent(escape(atob(alan.replace(/^data:.*?;base64,/, '')))); }
          catch { return alan; }
        })();
        blob = new Blob([metin], { type: 'application/xml;charset=utf-8' });
      } else {
        const bin = atob(alan.replace(/^data:.*?;base64,/, ''));
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        blob = new Blob([buf], { type: 'application/pdf' });
      }
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${fatura.faturaNo || fatura.id}.${tur}`;
      a.click();
      URL.revokeObjectURL(href);
    } catch {
      setHata(tr ? 'İndirme başarısız — sunucuya ulaşılamadı.' : 'Download failed.');
    } finally {
      setIndiriliyor(null);
    }
  };

  const satir = (etiket: string, deger: string) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{etiket}</span>
      <span className="text-sm font-semibold text-[#1D1D1F]">{deger}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
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

        <div className="p-5">
          {satir(tr ? 'Müşteri / Cari' : 'Customer', fatura.musteri)}
          {satir(tr ? 'Cari kodu' : 'Account code', fatura.cariKod || '—')}
          {satir(tr ? 'Tarih' : 'Date', fatura.tarih || '—')}
          {satir(tr ? 'Matrah' : 'Base', typeof fatura.matrah === 'number' ? tl(fatura.matrah) : '—')}
          {satir(tr ? 'KDV' : 'VAT', typeof fatura.kdv === 'number' ? `${tl(fatura.kdv)}${fatura.oran !== null ? ` (%${fatura.oran})` : ''}` : '—')}
          {satir(tr ? 'Toplam' : 'Total', typeof fatura.tutar === 'number' ? tl(fatura.tutar) : '—')}

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

        <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100">
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
