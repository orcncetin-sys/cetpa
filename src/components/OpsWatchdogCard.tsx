/**
 * OpsWatchdogCard — Operasyon Bekçisi sonuç kartı (süper-admin paneli).
 * Sunucudaki günlük watchdog cron'unun (offsite yedek tazeliği, Mikro sync,
 * stok oranı çöküşü, retry kuyruğu, kur tazeliği) son sonuçlarını gösterir;
 * "Şimdi Çalıştır" ile elle tetiklenebilir. Veri: GET/POST /api/ops/watchdog.
 */
import { useEffect, useState } from 'react';
import { Activity, PlayCircle, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { authedFetch } from '../lib/dbClient';

interface OpsCheck { key: string; ok: boolean; detail: string }
interface OpsResult { date: string; ok: boolean; checks: OpsCheck[] }
/** GET /api/ops/runtime — firebase-admin 14 yükseltmesi Node 22 istiyor. */
interface RuntimeInfo {
  node: string; nodeMajor: number; platform: string;
  firebaseAdmin: string | null; firebaseAdmin14Uyumlu: boolean;
}

const KEY_LABEL: Record<string, { tr: string; en: string }> = {
  backup_db: { tr: 'DB yedeği (offsite)', en: 'DB backup (offsite)' },
  backup_uploads: { tr: 'Uploads yedeği', en: 'Uploads backup' },
  mikro_sync: { tr: 'Mikro senkron', en: 'Mikro sync' },
  stock_ratio: { tr: 'Stok oranı', en: 'Stock ratio' },
  retry_queue: { tr: 'Retry kuyruğu', en: 'Retry queue' },
  exchange_rates: { tr: 'Döviz kuru', en: 'FX rates' },
};

interface Props {
  currentLanguage: string;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function OpsWatchdogCard({ currentLanguage, toast }: Props) {
  const tr = currentLanguage === 'tr';
  const [results, setResults] = useState<OpsResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/api/ops/watchdog');
      const d = await r.json();
      setResults(Array.isArray(d.results) ? d.results : []);
    } catch { /* sessiz — kart boş kalır */ } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  // Calisma ortami: uretimdeki Node surumu baska hicbir yerden gorunmuyordu ve
  // firebase-admin 13->14 yukseltmesi (Node >=22 sarti) bu bilgi olmadan
  // planlanamiyordu. Uc korumali (super-admin) — tarayiciya adres yazarak
  // okunamaz, bu yuzden panelde gosteriliyor.
  useEffect(() => {
    void (async () => {
      try {
        const r = await authedFetch('/api/ops/runtime');
        if (r.ok) setRuntime(await r.json() as RuntimeInfo);
      } catch { /* sessiz — satir gizli kalir */ }
    })();
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await authedFetch('/api/ops/watchdog/run', { method: 'POST' });
      const d = await r.json();
      if (d.success) {
        toast(
          d.result?.ok ? (tr ? 'Bekçi çalıştı: tüm kontroller geçti.' : 'Watchdog ran: all checks passed.')
            : (tr ? 'Bekçi çalıştı: BAŞARISIZ kontrol var!' : 'Watchdog ran: some checks FAILED!'),
          d.result?.ok ? 'success' : 'error'
        );
        await load();
      } else toast(d.error || (tr ? 'Hata' : 'Error'), 'error');
    } catch { toast(tr ? 'Çalıştırılamadı.' : 'Run failed.', 'error'); } finally { setRunning(false); }
  };

  const latest = results[0];
  const label = (key: string) => KEY_LABEL[key]?.[tr ? 'tr' : 'en'] || key;

  return (
    <div className="apple-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${latest ? (latest.ok ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500') : 'bg-gray-100 text-gray-400'}`}>
          <Activity className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-[#1D1D1F]">{tr ? 'Operasyon Bekçisi' : 'Ops Watchdog'}</h3>
          <p className="text-[11px] text-[#86868B]">
            {latest
              ? (tr ? `Son kontrol: ${latest.date}` : `Last check: ${latest.date}`)
              : (tr ? 'Henüz sonuç yok — her sabah 08:30\'da otomatik çalışır.' : 'No results yet — runs daily at 08:30.')}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => void runNow()} disabled={running} className="apple-button-secondary text-xs flex items-center gap-1 px-2.5 py-1.5 disabled:opacity-50">
            <PlayCircle className={`w-3.5 h-3.5 ${running ? 'animate-pulse' : ''}`} />{tr ? 'Şimdi Çalıştır' : 'Run Now'}
          </button>
          <button onClick={() => void load()} className="apple-button-secondary text-xs px-2.5 py-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {runtime && (
        <div className="mb-3 text-[11px] rounded-xl px-3 py-2 bg-gray-50 text-[#1D1D1F] flex flex-wrap items-center gap-x-3 gap-y-1">
          <span><b>Node</b> {runtime.node}</span>
          <span className="text-[#86868B]">{runtime.platform}</span>
          <span><b>firebase-admin</b> {runtime.firebaseAdmin ?? '—'}</span>
          <span className={runtime.firebaseAdmin14Uyumlu ? 'text-emerald-600 font-semibold' : 'text-amber-700 font-semibold'}>
            {runtime.firebaseAdmin14Uyumlu
              ? (tr ? '✓ firebase-admin 14 yükseltmesine uygun' : '✓ ready for firebase-admin 14')
              : (tr ? `⚠ firebase-admin 14 için Node ≥22 gerekli (şu an ${runtime.nodeMajor})` : `⚠ firebase-admin 14 needs Node ≥22 (now ${runtime.nodeMajor})`)}
          </span>
        </div>
      )}

      {latest && (
        <div className="space-y-1.5">
          {latest.checks.map(c => (
            <div key={c.key} className="flex items-start gap-2 text-xs">
              {c.ok
                ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-px" />
                : <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-px" />}
              <span className={`font-semibold shrink-0 ${c.ok ? 'text-[#1D1D1F]' : 'text-red-600'}`}>{label(c.key)}</span>
              <span className="text-[#86868B] break-all">{c.detail}</span>
            </div>
          ))}
        </div>
      )}

      {results.length > 1 && (
        <div className="flex items-center gap-1 mt-3 pt-2 border-t border-gray-100">
          <span className="text-[10px] text-[#86868B] mr-1">{tr ? 'Geçmiş:' : 'History:'}</span>
          {[...results].reverse().map(r => (
            <span key={r.date} title={`${r.date}: ${r.ok ? 'OK' : 'FAIL'}`}
              className={`w-2.5 h-2.5 rounded-full ${r.ok ? 'bg-green-400' : 'bg-red-400'}`} />
          ))}
        </div>
      )}
    </div>
  );
}
