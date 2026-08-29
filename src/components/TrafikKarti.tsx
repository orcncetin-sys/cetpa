import { useEffect, useState } from 'react';
import { BarChart2, RefreshCw, Globe } from 'lucide-react';
import { authedFetch } from '../lib/dbClient';

/**
 * TrafikKarti — süper-admin panelinde çerezsiz trafik sayacının özeti.
 *
 * Veri: GET /api/trafik/ozet (yalnız süper-admin; trafikGunluk SERVER_ONLY
 * olduğu için /api/db ve SSE'den görünmez). Sayacın kendisi ve KVKK notları:
 * src/server/routes/trafikRoutes.ts.
 *
 * Grafik kütüphanesi bilerek YOK: 30 kutucuklu mini bar dizisi düz div'lerle
 * çiziliyor — recharts bu panel için 100+ kB gereksiz yük olurdu.
 */

interface Gun {
  gun: string;
  toplam?: number;
  sayfalar?: Record<string, number>;
  kaynaklar?: Record<string, number>;
}

export default function TrafikKarti({ currentLanguage }: { currentLanguage: string }) {
  const tr = currentLanguage === 'tr';
  const [gunler, setGunler] = useState<Gun[] | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  async function yukle() {
    setYukleniyor(true); setHata(null);
    try {
      const r = await authedFetch('/api/trafik/ozet?gun=30');
      const d = await r.json() as { success: boolean; gunler?: Gun[]; error?: string };
      if (!d.success) throw new Error(d.error || 'Hata');
      setGunler(d.gunler ?? []);
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYukleniyor(false);
    }
  }
  useEffect(() => { void yukle(); }, []);

  const toplam30 = gunler?.reduce((s, g) => s + (g.toplam ?? 0), 0) ?? 0;
  const enYuksek = Math.max(1, ...(gunler ?? []).map(g => g.toplam ?? 0));
  const bugun = gunler?.[gunler.length - 1];
  // Bugünün en çok görüntülenen 5 sayfası
  const sayfalar = Object.entries(bugun?.sayfalar ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const kaynaklar = Object.entries(bugun?.kaynaklar ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="apple-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-brand" />
          <h3 className="font-bold text-sm">{tr ? 'Site Trafiği (30 gün)' : 'Site Traffic (30 days)'}</h3>
        </div>
        <button onClick={() => void yukle()} disabled={yukleniyor}
          aria-label={tr ? 'Yenile' : 'Refresh'}
          className="p-1.5 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-40">
          <RefreshCw className={`w-3.5 h-3.5 text-gray-400 ${yukleniyor ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <p className="text-[11px] text-gray-400">
        {tr
          ? 'Çerezsiz sayaç — kişisel veri toplamaz, veriler kendi veritabanımızda. Google arama trafiği için Search Console\'a bakın.'
          : 'Cookieless counter — no personal data, stored in our own database.'}
      </p>

      {hata && (
        <p className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{hata}</p>
      )}

      {gunler && gunler.length === 0 && !hata && (
        <p className="text-xs text-gray-400">
          {tr ? 'Henüz veri yok — sayaç ilk ziyaretlerle dolmaya başlar.' : 'No data yet.'}
        </p>
      )}

      {gunler && gunler.length > 0 && (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-gray-900">{toplam30.toLocaleString('tr-TR')}</span>
            <span className="text-xs text-gray-400">{tr ? 'görüntüleme / 30 gün' : 'views / 30 days'}</span>
          </div>

          {/* Mini bar serisi — kütüphanesiz */}
          <div className="flex items-end gap-[2px] h-16" role="img"
            aria-label={tr ? 'Günlük görüntüleme grafiği' : 'Daily views chart'}>
            {gunler.map(g => (
              <div key={g.gun} className="flex-1 bg-brand/70 rounded-t-sm min-h-[2px] hover:bg-brand transition-colors"
                style={{ height: `${Math.round(((g.toplam ?? 0) / enYuksek) * 100)}%` }}
                title={`${g.gun}: ${g.toplam ?? 0}`} />
            ))}
          </div>

          {(sayfalar.length > 0 || kaynaklar.length > 0) && (
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-bold text-gray-500 mb-1">{tr ? 'Bugün — sayfalar' : 'Today — pages'}</p>
                {sayfalar.map(([yol, n]) => (
                  <div key={yol} className="flex justify-between text-gray-600">
                    <span className="font-mono truncate">{yol}</span><span>{n}</span>
                  </div>
                ))}
                {sayfalar.length === 0 && <span className="text-gray-300">—</span>}
              </div>
              <div>
                <p className="font-bold text-gray-500 mb-1 flex items-center gap-1">
                  <Globe className="w-3 h-3" />{tr ? 'Bugün — kaynaklar' : 'Today — referrers'}
                </p>
                {kaynaklar.map(([host, n]) => (
                  <div key={host} className="flex justify-between text-gray-600">
                    <span className="truncate">{host}</span><span>{n}</span>
                  </div>
                ))}
                {kaynaklar.length === 0 && <span className="text-gray-300">—</span>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
