/**
 * GecmisSayimlar — tamamlanmış fiziksel sayım arşivi (`stockCounts`).
 *
 * NEDEN VAR (2026-09-04 denetimi): App.tsx sayımı bitirince sonucu
 * `stockCounts` koleksiyonuna yazıp canlı oturumu (`stockCountSessions`)
 * siliyordu — ama `stockCounts`'u okuyan TEK BİR yer bile yoktu. Kullanıcı
 * sayımı tamamlıyor, ekran sıfırlanıyor ve kayıt bir daha görünmüyordu
 * ("kaydettim ama yok" arıza sınıfı).
 *
 * Sayım bir DENETİM kaydıdır: fark çıkan kalemler sonradan incelenebilmeli,
 * kimin ne zaman saydığı görünmeli. Bu yüzden liste salt-okunur.
 */
import { useEffect, useState } from 'react';
import { collection, onSnapshot } from '../lib/dbClient';
import { db } from '../firebase';
import { ClipboardList, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { zamanDate } from '../utils/zaman';

interface SayimKalemi {
  productId?: string;
  sku?: string;
  productName?: string;
  systemQty?: number;
  countedQty?: number;
  variance?: number;
}

interface SayimKaydi {
  id: string;
  items?: SayimKalemi[];
  totalCounted?: number;
  totalVariance?: number;
  countedBy?: string | null;
  createdAt?: unknown;
}

export default function GecmisSayimlar({ currentLanguage }: { currentLanguage: string }) {
  const tr = currentLanguage === 'tr';
  const [sayimlar, setSayimlar] = useState<SayimKaydi[]>([]);
  const [acikId, setAcikId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'stockCounts'), snap => {
      setSayimlar(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as SayimKaydi))
          // Tarihi çözülemeyen kayıt en sona (asla "bugün" varsayılmaz — bkz. zaman.ts)
          .sort((a, b) => (zamanDate(b.createdAt)?.getTime() ?? -Infinity) - (zamanDate(a.createdAt)?.getTime() ?? -Infinity)),
      );
    });
    return () => unsub();
  }, []);

  if (sayimlar.length === 0) return null;   // hiç sayım yoksa kart hiç çıkmasın

  return (
    <div className="apple-card p-5 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="w-4 h-4 text-gray-500" />
        <h3 className="font-bold text-gray-900 text-sm">
          {tr ? `Geçmiş Sayımlar (${sayimlar.length})` : `Past Counts (${sayimlar.length})`}
        </h3>
      </div>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {sayimlar.map(s => {
          const d = zamanDate(s.createdAt);
          const farkli = s.totalVariance ?? 0;
          const acik = acikId === s.id;
          const farkliKalemler = (s.items ?? []).filter(i => (i.variance ?? 0) !== 0);
          return (
            <div key={s.id} className={`rounded-xl border ${farkli > 0 ? 'border-amber-200 bg-amber-50/50' : 'border-gray-100 bg-gray-50'}`}>
              <button
                onClick={() => setAcikId(acik ? null : s.id)}
                className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-800">
                    {d ? d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : (tr ? 'Tarih yok' : 'No date')}
                  </p>
                  <p className="text-[10px] text-gray-500 truncate">
                    {tr ? `${s.totalCounted ?? 0} kalem sayıldı` : `${s.totalCounted ?? 0} items counted`}
                    {s.countedBy ? ` · ${s.countedBy}` : ''}
                  </p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0 ${
                  farkli > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {farkli > 0
                    ? <><AlertTriangle className="w-3 h-3" />{tr ? `${farkli} fark` : `${farkli} variances`}</>
                    : <><CheckCircle2 className="w-3 h-3" />{tr ? 'fark yok' : 'no variance'}</>}
                </span>
              </button>

              {acik && farkliKalemler.length > 0 && (
                <div className="px-3.5 pb-3 space-y-1 border-t border-black/5 pt-2">
                  {farkliKalemler.map((i, ix) => (
                    <div key={ix} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-gray-700 truncate">{i.productName ?? i.sku ?? '—'}</span>
                      <span className="text-gray-500 flex-shrink-0 tabular-nums">
                        {tr ? 'sistem' : 'system'} {i.systemQty ?? '—'} → {tr ? 'sayılan' : 'counted'} {i.countedQty ?? '—'}
                        <span className={(i.variance ?? 0) > 0 ? 'text-emerald-600 ml-1.5 font-semibold' : 'text-red-500 ml-1.5 font-semibold'}>
                          {(i.variance ?? 0) > 0 ? '+' : ''}{i.variance ?? 0}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {acik && farkliKalemler.length === 0 && (
                <p className="px-3.5 pb-3 text-[10px] text-gray-400 border-t border-black/5 pt-2">
                  {tr ? 'Bu sayımda sistem stoğuyla fark bulunmadı.' : 'No variances against system stock.'}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
