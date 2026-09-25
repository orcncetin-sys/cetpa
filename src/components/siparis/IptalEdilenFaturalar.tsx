/**
 * İptal Edilen Faturalar (Mikro) — 2026-09-25 kullanıcı isteği: "iptal faturaları da iptal olarak görünsün ama başka bir
 * hesaplamaya dahil olmasın (iptal edilen faturalar olarak ve iptal iade sayfasında görünebilir)".
 *
 * Kaynak `mikroIptalFaturalar` (Mikro SQL importu, iptal edilmiş fatura başlıkları). Bu koleksiyonu HİÇBİR hesap okumaz —
 * yalnız bu liste. Yön `cha_tip` (0 satış, diğer alış — sunucu eslemeFatura.faturaYonu ile aynı kural); okunamazsa '—'
 * (yön UYDURULMAZ). Yetkisiz rol İÇİN abonelik AÇILMAZ, ekranda yazılır (inceleme 2026-09-25: sunucu yetkisiz koleksiyonu
 * SSE akışından SESSİZCE ayıklıyor, hata geri çağrısı hiç tetiklenmiyor → liste sonsuza dek "Yükleniyor…" kalıyordu).
 * Okuma hatası da ekranda: boş liste "iptal yok" demek değildir.
 */
import { useEffect, useState } from 'react';
import { collection, query, onSnapshot } from '../../lib/dbClient';
import { db } from '../../firebase';
import { paraYaz } from '../../utils/currency';
import { tarihYaz } from '../../utils/zaman';
import { bilinenSayi } from '../../utils/para';
import { oc } from '../../i18n/ortak';
import { isAllowed } from '../../lib/rbac';
import type { AppRole } from '../../lib/rbac';

type Fatura = Record<string, unknown> & { id: string };

export function iptalFaturaYonu(f: Record<string, unknown>): 'satis' | 'alis' | null {
  return bilinenSayi(f.cha_tip) ? (Number(f.cha_tip) === 0 ? 'satis' : 'alis') : null;
}

export default function IptalEdilenFaturalar({ dil, rol }: { dil: string; rol: string | null | undefined }) {
  const tr = dil === 'tr';
  const yetkili = isAllowed((rol ?? null) as AppRole | null, 'mikroIptalFaturalar', 'read');
  const [durum, setDurum] = useState<{ yukleniyor: boolean; faturalar: Fatura[]; hata: string | null }>({ yukleniyor: true, faturalar: [], hata: null });
  useEffect(() => {
    if (!yetkili) return;
    const unsub = onSnapshot(
      query(collection(db, 'mikroIptalFaturalar')),
      snap => {
        const liste: Fatura[] = snap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id }));
        liste.sort((a, b) => String(b.cha_tarihi ?? '').localeCompare(String(a.cha_tarihi ?? '')));
        setDurum({ yukleniyor: false, faturalar: liste, hata: null });
      },
      err => setDurum({ yukleniyor: false, faturalar: [], hata: err instanceof Error ? err.message : String(err) }),
    );
    return () => unsub();
  }, [yetkili]);

  return (
    <section className="apple-card overflow-hidden" aria-label={tr ? 'İptal edilen faturalar (Mikro)' : 'Cancelled invoices (Mikro)'}>
      <div className="px-4 py-3 border-b border-gray-100">
        <h4 className="font-bold text-sm text-gray-800">{tr ? 'İptal Edilen Faturalar (Mikro)' : 'Cancelled Invoices (Mikro)'}</h4>
        <p className="text-[11px] text-gray-500 mt-0.5">
          {tr
            ? 'Mikro\'da iptal edilen faturalar. Ciro, KDV, cari bakiye ve raporların HİÇBİRİNE dahil değildir. Entegrasyon → "İptal Edilen Faturalar" ile güncellenir.'
            : 'Invoices cancelled in Mikro. Excluded from revenue, VAT, balances and all reports. Refresh via Integration → "Cancelled Invoices".'}
        </p>
      </div>
      {!yetkili ? (
        <p role="status" className="px-4 py-3 text-xs text-gray-600 bg-gray-50">
          {tr ? 'Bu listeyi görme yetkiniz yok (Yönetici, Müdür ya da Muhasebe rolü gerekir).' : 'You are not allowed to view this list (Admin, Manager or Accounting role required).'}
        </p>
      ) : durum.hata ? (
        <p role="alert" className="px-4 py-3 text-xs text-red-700 bg-red-50">
          {tr ? `İptal edilen faturalar okunamadı: ${durum.hata}` : `Could not read cancelled invoices: ${durum.hata}`}
        </p>
      ) : durum.yukleniyor ? (
        <p className="px-4 py-3 text-xs text-gray-400">{tr ? 'Yükleniyor…' : 'Loading…'}</p>
      ) : durum.faturalar.length === 0 ? (
        <p className="px-4 py-3 text-xs text-gray-400">{tr ? 'İptal edilen fatura yok (ya da henüz çekilmedi).' : 'No cancelled invoices (or not pulled yet).'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60 text-xs font-bold text-gray-400 uppercase">
                <th className="px-4 py-2.5 text-left">{tr ? 'Evrak' : 'Document'}</th>
                <th className="px-4 py-2.5 text-left">{oc(dil).tarih}</th>
                <th className="px-4 py-2.5 text-left">{tr ? 'Yön' : 'Type'}</th>
                <th className="px-4 py-2.5 text-left">{tr ? 'Cari' : 'Account'}</th>
                <th className="px-4 py-2.5 text-right">{oc(dil).tutar}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {durum.faturalar.map(f => {
                const yon = iptalFaturaYonu(f);
                return (
                  <tr key={f.id}>
                    <td className="px-4 py-2 font-medium text-gray-800">{`${String(f.cha_evrakno_seri ?? '').trim()}${String(f.cha_evrakno_sira ?? '').trim()}` || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{tarihYaz(f.cha_tarihi, undefined, tr ? 'tr' : 'en')}</td>
                    <td className="px-4 py-2 text-gray-600">{yon === 'satis' ? oc(dil).satis : yon === 'alis' ? (tr ? 'Alış' : 'Purchase') : '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{String(f.cha_kod ?? '').trim() || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-500 line-through decoration-gray-300">{paraYaz(bilinenSayi(f.cha_meblag) ? Number(f.cha_meblag) : null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
