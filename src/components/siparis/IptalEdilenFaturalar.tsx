/**
 * İptal Edilen Faturalar (Mikro) — 2026-09-25 kullanıcı isteği: "iptal faturaları da iptal olarak görünsün ama başka bir
 * hesaplamaya dahil olmasın (iptal edilen faturalar olarak ve iptal iade sayfasında görünebilir)".
 *
 * İKİ kaynak, tek liste:
 *   • `mikroIptalFaturalar` — Mikro'da İPTAL EDİLMİŞ fatura başlıkları (Mikro SQL importu). Bu koleksiyonu HİÇBİR hesap okumaz.
 *   • `mikroFaturalar` içinden `gibRed` olanlar — ALICININ REDDETTİĞİ satış e-Faturaları (GİB 2002, lib/gibDurum; 2026-10-02
 *     fatura 389). Mikro'da iptal bayrağı taşımazlar; `useMikroFaturalar` onları hesaplardan düşürür, burada görünürler.
 * Yön `cha_tip` (0 satış, diğer alış — sunucu eslemeFatura.faturaYonu ile aynı kural); okunamazsa '—' (yön UYDURULMAZ).
 * Yetkisiz rol İÇİN abonelik AÇILMAZ, ekranda yazılır (inceleme 2026-09-25: sunucu yetkisiz koleksiyonu SSE akışından SESSİZCE
 * ayıklıyor, hata geri çağrısı hiç tetiklenmiyor → liste sonsuza dek "Yükleniyor…" kalıyordu). Okuma hatası da ekranda: boş
 * liste "iptal yok" demek değildir. Reddedilenler ayrı akıştan gelir; o akış okunamazsa liste YİNE görünür, eksik olduğu yazılır.
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
import { gibReddedildi } from '../../lib/gibDurum';

type Fatura = Record<string, unknown> & { id: string };

export function iptalFaturaYonu(f: Record<string, unknown>): 'satis' | 'alis' | null {
  return bilinenSayi(f.cha_tip) ? (Number(f.cha_tip) === 0 ? 'satis' : 'alis') : null;
}

export default function IptalEdilenFaturalar({ dil, rol }: { dil: string; rol: string | null | undefined }) {
  const tr = dil === 'tr';
  const yetkili = isAllowed((rol ?? null) as AppRole | null, 'mikroIptalFaturalar', 'read');
  const [durum, setDurum] = useState<{ yukleniyor: boolean; faturalar: Fatura[]; hata: string | null }>({ yukleniyor: true, faturalar: [], hata: null });
  // Alıcının reddettikleri: null = henüz gelmedi; `redHata` = akış okunamadı (liste eksik olabilir — yazılır).
  const [red, setRed] = useState<{ faturalar: Fatura[] | null; hata: string | null }>({ faturalar: null, hata: null });
  const redYetkili = yetkili && isAllowed((rol ?? null) as AppRole | null, 'mikroFaturalar', 'read');
  useEffect(() => {
    if (!yetkili) return;
    const unsub = onSnapshot(
      query(collection(db, 'mikroIptalFaturalar')),
      snap => {
        const liste: Fatura[] = snap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id }));
        setDurum({ yukleniyor: false, faturalar: liste, hata: null });
      },
      err => setDurum({ yukleniyor: false, faturalar: [], hata: err instanceof Error ? err.message : String(err) }),
    );
    return () => unsub();
  }, [yetkili]);
  useEffect(() => {
    if (!redYetkili) return;
    const unsub = onSnapshot(
      query(collection(db, 'mikroFaturalar')),
      snap => setRed({ hata: null, faturalar: snap.docs
        .map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id }))
        .filter(gibReddedildi) }),
      err => setRed({ faturalar: null, hata: err instanceof Error ? err.message : String(err) }),
    );
    return () => unsub();
  }, [redYetkili]);
  type Satir = Fatura & { neden: 'iptal' | 'red' };
  // Aynı fatura iki kaynakta da olabilir (reddedildikten sonra Mikro'da iptal edildi, import henüz reddedilen kopyayı süpürmedi):
  // kimlikle tekilleştirilir, Mikro iptali kazanır.
  const iptalKimlikleri = new Set(durum.faturalar.map(f => f.id));
  const satirlar: Satir[] = [
    ...durum.faturalar.map((f): Satir => ({ ...f, neden: 'iptal' })),
    ...(red.faturalar ?? []).filter(f => !iptalKimlikleri.has(f.id)).map((f): Satir => ({ ...f, neden: 'red' })),
  ].sort((a, b) => String(b.cha_tarihi ?? '').localeCompare(String(a.cha_tarihi ?? '')));

  return (
    <section className="apple-card overflow-hidden" aria-label={tr ? 'İptal edilen faturalar (Mikro)' : 'Cancelled invoices (Mikro)'}>
      <div className="px-4 py-3 border-b border-gray-100">
        <h4 className="font-bold text-sm text-gray-800">{tr ? 'İptal Edilen ve Reddedilen Faturalar (Mikro)' : 'Cancelled and Rejected Invoices (Mikro)'}</h4>
        <p className="text-[11px] text-gray-500 mt-0.5">
          {tr
            ? 'Mikro\'da iptal edilen faturalar hiçbir hesaba girmez. Alıcının reddettiği (GİB) faturalar ciro, fatura listeleri ve KDV sekmesine girmez; cari bakiye, stok hareketi ve Mikro\'dan çekilen KDV özeti, fatura Mikro\'da iptal edilene kadar bu faturayı içerir — reddedilen faturayı Mikro\'da da iptal edin. Fatura Cetpa\'dan kesilmişse bağlı sipariş kendiliğinden iptal edilmez; sipariş elle iptal edilene kadar tutarı ciroda kalır. Entegrasyon → "İptal Edilen Faturalar" ve "GİB Durumlarını Sorgula" ile güncellenir.'
            : 'Invoices cancelled in Mikro are excluded from all totals. Invoices rejected by the recipient (GİB) are excluded from revenue, invoice lists and the VAT tab; account balances, stock movements and the VAT summary pulled from Mikro still include them until the invoice is cancelled in Mikro. If the invoice was issued from Cetpa, the linked order is not cancelled automatically; its amount stays in revenue until the order is cancelled manually. Refresh via Integration → "Cancelled Invoices" and "Query GİB Statuses".'}
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
      ) : satirlar.length === 0 ? (
        <p className="px-4 py-3 text-xs text-gray-400">{tr ? 'İptal edilen ya da reddedilen fatura yok (ya da henüz çekilmedi).' : 'No cancelled or rejected invoices (or not pulled yet).'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60 text-xs font-bold text-gray-400 uppercase">
                <th className="px-4 py-2.5 text-left">{tr ? 'Evrak' : 'Document'}</th>
                <th className="px-4 py-2.5 text-left">{oc(dil).tarih}</th>
                <th className="px-4 py-2.5 text-left">{tr ? 'Yön' : 'Type'}</th>
                <th className="px-4 py-2.5 text-left">{tr ? 'Cari' : 'Account'}</th>
                <th className="px-4 py-2.5 text-left">{oc(dil).durum}</th>
                <th className="px-4 py-2.5 text-right">{oc(dil).tutar}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {satirlar.map(f => {
                const yon = iptalFaturaYonu(f);
                return (
                  <tr key={`${f.neden}-${f.id}`}>
                    <td className="px-4 py-2 font-medium text-gray-800">{`${String(f.cha_evrakno_seri ?? '').trim()}${String(f.cha_evrakno_sira ?? '').trim()}` || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{tarihYaz(f.cha_tarihi, undefined, tr ? 'tr' : 'en')}</td>
                    <td className="px-4 py-2 text-gray-600">{yon === 'satis' ? oc(dil).satis : yon === 'alis' ? (tr ? 'Alış' : 'Purchase') : '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{String(f.cha_kod ?? '').trim() || '—'}</td>
                    <td className="px-4 py-2 text-xs">
                      {f.neden === 'red'
                        ? <span className="font-semibold text-amber-700">{tr ? 'Alıcı reddetti (GİB 2002)' : 'Rejected by recipient (GİB 2002)'}</span>
                        : <span className="text-gray-600">{tr ? 'İptal (Mikro)' : 'Cancelled (Mikro)'}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-500 line-through decoration-gray-300">{paraYaz(bilinenSayi(f.cha_meblag) ? Number(f.cha_meblag) : null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {yetkili && red.hata && (
        <p role="alert" className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-t border-amber-100">
          {tr ? `Alıcının reddettiği faturalar okunamadı — liste eksik olabilir: ${red.hata}` : `Could not read rejected invoices — the list may be incomplete: ${red.hata}`}
        </p>
      )}
    </section>
  );
}
