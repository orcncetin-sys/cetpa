/**
 * ErpSyncPanel.tsx — SAP / Logo / Dynamics panellerinin ORTAK gövdesi.
 *
 * 2026-08-17: SAPSyncPanel (370), LogoSyncPanel (370), DynamicsSyncPanel (355)
 * neredeyse birebir aynı iskeleti taşıyordu — her biri kendi Chip / Feedback /
 * ImportCard / LogPanel / runImport / runExport kopyasını yazmıştı. Fark yalnız
 * endpoint önekleri, marka rengi/adı, env değişken listesi ve export yanıtındaki
 * alan adlarıydı. Hepsi aşağıdaki config'e indirgendi (~1100 satır → tek gövde).
 *
 * Mikro ve Luca BİLEREK dışarıda: Mikro çok daha zengin (1138 satır, kendine
 * özgü pull/tamir/şema keşfi akışları), Luca'nın da farklı alanları var.
 *
 * YENİ ERP EKLERKEN: yalnız bir config nesnesi yaz (bkz. sapConfig.ts) —
 * bu dosyaya dokunma.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, CheckCircle2, XCircle, AlertCircle,
  Package, Users, ShoppingCart, Clock,
  ChevronDown, ChevronUp, Download, ArrowUpRight, FileText,
} from 'lucide-react';
import { collection, query, limit, onSnapshot, orderBy } from '../../lib/dbClient';
import { db } from '../../firebase';
import { format } from 'date-fns';
import { tr as trLocale } from 'date-fns/locale';
import type { ErpImportResult, ErpStatusResult } from '../../types/erp';
import { authFetch } from '../../services/authFetch';

// ── Config ────────────────────────────────────────────────────────────────────

/** Bir export akışı (sipariş / fatura). `pickRef` yanıttan gösterilecek
 *  referansı çıkarır — her ERP farklı adlandırıyor (logoEvrakNo, sapDocNum…). */
export interface ErpExportSpec {
  /** endpoint son eki: /api/<key>/export/<path> */
  path: string;
  title: (t: boolean) => string;
  desc: (t: boolean) => string;
  /** Sonuç etiketinin başı, ör. 'Evrak No' / 'Doc No' */
  refLabel: (t: boolean) => string;
  pickRef: (d: Record<string, unknown>) => string;
  icon: 'siparis' | 'fatura';
}

export interface ErpPanelConfig {
  /** /api/<key>/… ve <key>SyncLog için kullanılır */
  key: string;
  name: string;
  emoji: string;
  /** marka hex rengi, ör. '#e63312' */
  color: string;
  /** Firestore log koleksiyonu, ör. 'logoSyncLog' */
  logCollection: string;
  /** log kaydından gösterilecek referans metnini çıkarır (her ERP farklı
   *  alan adı kullanıyor: logoRef, sapDocEntry+sapDocNum, dynamicsRef…). */
  pickLogRef: (entry: Record<string, unknown>) => string;
  /** yapılandırma uyarısında gösterilecek env değişkenleri */
  envVars: string[];
  /** ERP'ye özgü ek kurulum notu (firewall/OAuth/doküman linki gibi).
   *  Orijinal panellerdeki bu rehberlik indirgemede kaybolmuştu. */
  configHint?: (t: boolean) => React.ReactNode;
  /** durum satırının altındaki açıklama (bağlıysa canlı bilgi gösterebilir) */
  subtitle: (status: ErpStatusResult | null) => string;
  exports: ErpExportSpec[];
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImportState { running: boolean; result: ErpImportResult | null; error: string | null }
interface ExportState { running: boolean; result: string | null; error: string | null }

interface LogEntry {
  id: string;
  operation: string;
  entityType?: string;
  entityId?: string;
  success: boolean;
  error: string | null;
  duration: number;
  timestamp?: { toDate: () => Date };
  [k: string]: unknown;   // logRefField dinamik okunuyor
}

const INIT_IMPORT: ImportState = { running: false, result: null, error: null };
const INIT_EXPORT: ExportState = { running: false, result: null, error: null };

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ErpSyncPanel({ cfg, lang = 'tr' }: { cfg: ErpPanelConfig; lang?: string }) {
  const t = lang === 'tr';

  const [status, setStatus] = useState<ErpStatusResult | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [stokImport, setStokImport] = useState<ImportState>(INIT_IMPORT);
  const [cariImport, setCariImport] = useState<ImportState>(INIT_IMPORT);
  // Her export akışının kendi state'i (path -> state)
  const [exportStates, setExportStates] = useState<Record<string, ExportState>>({});
  // Tek sipariş ID, tüm export akışlarını besler (orijinal davranış).
  const [sharedOrderId, setSharedOrderId] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  const checkStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const r = await fetch(`/api/${cfg.key}/status`);
      setStatus(await r.json() as ErpStatusResult);
    } catch {
      setStatus({ configured: false, connected: false, error: t ? 'Sunucuya ulaşılamadı' : 'Server unreachable' });
    } finally {
      setStatusLoading(false);
    }
  }, [t, cfg.key]);

  useEffect(() => { void checkStatus(); }, [checkStatus]);

  useEffect(() => {
    const q = query(collection(db, cfg.logCollection), orderBy('timestamp', 'desc'), limit(25));
    return onSnapshot(q, snap => setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as LogEntry))));
  }, [cfg.logCollection]);

  async function runImport(path: string, setState: React.Dispatch<React.SetStateAction<ImportState>>) {
    setState({ running: true, result: null, error: null });
    try {
      const r = await authFetch(`/api/${cfg.key}/import/${path}`, { method: 'POST' });
      const d = await r.json() as ErpImportResult & { notConfigured?: boolean };
      if (d.notConfigured) {
        throw new Error(t
          ? `${cfg.name} yapılandırılmamış. Ayarlar'dan env değişkenlerini girin.`
          : `${cfg.name} not configured. Set env vars in Settings.`);
      }
      setState({ running: false, result: d, error: d.success ? null : (d.error ?? 'Hata') });
    } catch (e) {
      setState({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function runExport(spec: ErpExportSpec) {
    const id = sharedOrderId.trim();
    if (!id) {
      setExportStates(s => ({ ...s, [spec.path]: { running: false, result: null, error: t ? 'Sipariş ID girin.' : 'Enter an order ID.' } }));
      return;
    }
    setExportStates(s => ({ ...s, [spec.path]: { running: true, result: null, error: null } }));
    try {
      const r = await authFetch(`/api/${cfg.key}/export/${spec.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: id }),
      });
      const d = await r.json() as Record<string, unknown>;
      if (d.notConfigured) throw new Error(t ? `${cfg.name} yapılandırılmamış.` : `${cfg.name} not configured.`);
      if (!d.success) throw new Error((d.error as string) ?? 'Hata');
      setExportStates(s => ({ ...s, [spec.path]: { running: false, result: `✓ ${spec.refLabel(t)}: ${spec.pickRef(d) || '—'}`, error: null } }));
    } catch (e) {
      setExportStates(s => ({ ...s, [spec.path]: { running: false, result: null, error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  const connected = !!status?.connected;

  return (
    <div className="space-y-4">
      {/* Durum */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl" style={{ background: cfg.color + '18' }}>
              {cfg.emoji}
            </div>
            <div>
              <p className="font-bold text-sm text-gray-900">{cfg.name}</p>
              <p className="text-[11px] text-gray-400">{cfg.subtitle(status)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status && (
              <>
                <Chip ok={status.configured} label={t ? 'Yapılandırıldı' : 'Configured'} />
                <Chip ok={status.connected} label={t ? 'Bağlı' : 'Connected'} />
              </>
            )}
            <button onClick={checkStatus} disabled={statusLoading}
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50"
              aria-label={t ? 'Durumu yenile' : 'Refresh status'}>
              <RefreshCw className={`w-4 h-4 text-gray-400 ${statusLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {status && !status.configured && (
          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5 text-[11px] text-amber-700">
            <p className="font-bold mb-1">{t ? 'Yapılandırma gerekiyor:' : 'Configuration required:'}</p>
            <p className="font-mono">{cfg.envVars.join(' · ')}</p>
            <p className="mt-1 text-amber-600">
              {t ? 'Bu değerleri sunucu ortam değişkenlerine (.env) ekleyin.' : 'Add these to your server environment variables (.env).'}
            </p>
            {cfg.configHint && <div className="mt-1.5 text-amber-600">{cfg.configHint(t)}</div>}
          </div>
        )}
        {status?.error && (
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-red-600 bg-red-50 rounded-xl px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {status.error}
          </div>
        )}
      </div>

      {/* İçeri alma kartları */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ImportCard
          icon={<Package className="w-5 h-5" style={{ color: cfg.color }} />}
          bgStyle={{ background: cfg.color + '18' }}
          title={t ? `Stok İçeri Al (${cfg.name} → Cetpa)` : `Import Stock (${cfg.name} → Cetpa)`}
          desc={t ? `${cfg.name} ürün/malzeme kartlarını Cetpa envanterine aktar.` : `Import ${cfg.name} item cards into Cetpa inventory.`}
          btnLabel={t ? 'Stokları İçeri Al' : 'Import All Stock'}
          state={stokImport} disabled={!connected} color={cfg.color} erpName={cfg.name}
          onRun={() => void runImport('stok', setStokImport)} lang={t}
        />
        <ImportCard
          icon={<Users className="w-5 h-5 text-purple-600" />}
          bgStyle={{ background: '#a855f718' }}
          title={t ? `Cari İçeri Al (${cfg.name} → Cetpa)` : `Import Customers (${cfg.name} → Cetpa)`}
          desc={t ? `${cfg.name} cari hesaplarını (müşteri/tedarikçi) Cetpa'ya aktar.` : `Import ${cfg.name} customer & supplier accounts into Cetpa.`}
          btnLabel={t ? 'Carileri İçeri Al' : 'Import Customers'}
          state={cariImport} disabled={!connected} color={cfg.color} erpName={cfg.name}
          onRun={() => void runImport('cari', setCariImport)} lang={t}
        />
      </div>

      {/* Dışarı gönderme — TEK sipariş ID girişi, her akış için ayrı düğme.
          Orijinal SAP/Dynamics panellerinde de tek input iki düğmeyi besliyordu;
          indirgemede yanlışlıkla her akışa ayrı input verilmişti (code-review). */}
      {cfg.exports.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <h4 className="font-bold text-sm text-gray-900 flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4" style={{ color: cfg.color }} />
            {t ? `Cetpa → ${cfg.name}` : `Cetpa → ${cfg.name}`}
          </h4>
          <div>
            <label htmlFor={`erp-${cfg.key}-orderid`} className="sr-only">
              {t ? 'Sipariş ID' : 'Order ID'}
            </label>
            <input
              id={`erp-${cfg.key}-orderid`}
              name="orderId"
              type="text"
              value={sharedOrderId}
              onChange={e => setSharedOrderId(e.target.value)}
              placeholder={t ? 'Sipariş ID…' : 'Order ID…'}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none font-mono transition-colors focus:ring-2"
              style={{ ['--tw-ring-color' as string]: cfg.color + '1a', borderColor: undefined }}
              onFocus={e => { e.currentTarget.style.borderColor = cfg.color; }}
              onBlur={e => { e.currentTarget.style.borderColor = ''; }}
              disabled={!connected}
            />
          </div>

          {cfg.exports.map(spec => {
            const st = exportStates[spec.path] ?? INIT_EXPORT;
            return (
              <div key={spec.path} className="rounded-xl border border-gray-100 p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                      {spec.icon === 'fatura'
                        ? <FileText className="w-3.5 h-3.5" style={{ color: cfg.color }} />
                        : <ShoppingCart className="w-3.5 h-3.5" style={{ color: cfg.color }} />}
                      {spec.title(t)}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{spec.desc(t)}</p>
                  </div>
                  <button
                    onClick={() => void runExport(spec)}
                    disabled={st.running || !connected}
                    className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-bold transition-colors disabled:opacity-40"
                    style={{ background: cfg.color }}
                  >
                    {st.running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                    {t ? 'Gönder' : 'Push'}
                  </button>
                </div>
                {st.result && <Feedback ok msg={st.result} />}
                {st.error && <Feedback ok={false} msg={st.error} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Senkron geçmişi */}
      <LogPanel logs={logs} show={showLogs} onToggle={() => setShowLogs(v => !v)} lang={t} pickRef={cfg.pickLogRef} />
    </div>
  );
}

// ── Alt bileşenler ────────────────────────────────────────────────────────────

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
      ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}
    </span>
  );
}

function Feedback({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <div className={`flex items-start gap-1.5 text-[11px] rounded-lg px-2.5 py-2 ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
      {msg}
    </div>
  );
}

interface ImportCardProps {
  icon: React.ReactNode; bgStyle: React.CSSProperties; title: string; desc: string;
  btnLabel: string; state: ImportState; disabled: boolean; color: string;
  erpName: string; onRun: () => void; lang: boolean;
}

function ImportCard({ icon, bgStyle, title, desc, btnLabel, state, disabled, color, erpName, onRun, lang: t }: ImportCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 flex flex-col">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={bgStyle}>{icon}</div>
        <h4 className="font-bold text-sm text-gray-900">{title}</h4>
      </div>
      <p className="text-[11px] text-gray-400 flex-1">{desc}</p>

      {state.result && !state.running && (
        <div className={`rounded-xl p-3 text-xs ${state.result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {state.result.success ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1 font-bold"><CheckCircle2 className="w-3.5 h-3.5" />{t ? 'Tamamlandı' : 'Done'}</div>
              <div className="flex gap-3 text-[11px]">
                <span>🆕 {state.result.created}</span>
                <span>🔄 {state.result.updated}</span>
                {state.result.errors > 0 && <span>⚠️ {state.result.errors}</span>}
                {state.result.duration && <span>⏱ {Math.round(state.result.duration / 1000)}s</span>}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1"><XCircle className="w-3.5 h-3.5" />{state.error}</div>
          )}
        </div>
      )}
      {state.error && !state.result && <Feedback ok={false} msg={state.error} />}

      <button onClick={onRun} disabled={state.running || disabled}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-xs font-bold transition-all disabled:opacity-40"
        style={{ background: color }}>
        {state.running
          ? <><RefreshCw className="w-4 h-4 animate-spin" />{t ? 'Aktarılıyor…' : 'Importing…'}</>
          : <><Download className="w-4 h-4" />{btnLabel}</>}
      </button>
      {disabled && !state.running && (
        <p className="text-[10px] text-center text-gray-400">
          {t ? `${erpName} bağlantısı gerekli` : `${erpName} connection required`}
        </p>
      )}
    </div>
  );
}

function LogPanel({ logs, show, onToggle, lang: t, pickRef }: {
  logs: LogEntry[]; show: boolean; onToggle: () => void; lang: boolean;
  pickRef: (e: Record<string, unknown>) => string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-3">
          <Clock className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-bold text-gray-700">
            {t ? 'Senkronizasyon Geçmişi' : 'Sync History'}
            {logs.length > 0 && <span className="ml-2 text-[11px] font-medium text-gray-400">({logs.length})</span>}
          </span>
        </div>
        {show ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {show && (
        <div className="border-t border-gray-100">
          {logs.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">{t ? 'Henüz kayıt yok.' : 'No records yet.'}</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {logs.map(entry => {
                const ts = entry.timestamp?.toDate?.();
                const ref = pickRef(entry as Record<string, unknown>);
                return (
                  <div key={entry.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50/60 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      {entry.success
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                        : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate">{entry.operation}</p>
                        {ref && <p className="text-[10px] font-mono text-gray-400">#{ref}</p>}
                        {entry.error && <p className="text-[10px] text-red-400 truncate">{entry.error}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-[10px] text-gray-400 font-mono">{entry.duration}ms</span>
                      {ts && <span className="text-[10px] text-gray-400">{format(ts, 'dd.MM HH:mm', { locale: trLocale })}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
