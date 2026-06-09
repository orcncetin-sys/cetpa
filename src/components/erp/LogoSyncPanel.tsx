/**
 * LogoSyncPanel.tsx — Logo Tiger / Go / Start ERP integration
 *
 * Server routes expected:
 *   GET  /api/logo/status          → ErpStatusResult
 *   POST /api/logo/import/stok     → ErpImportResult
 *   POST /api/logo/import/cari     → ErpImportResult
 *   POST /api/logo/export/siparis  { orderId } → { success, logoEvrakNo }
 *
 * Required server env vars:
 *   LOGO_API_URL   — e.g. https://your-tiger-server/logo-api
 *   LOGO_API_KEY   — generated in Logo Admin > API Keys
 *   LOGO_FIRM_NO   — Logo firm number (usually "1")
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, CheckCircle2, XCircle, AlertCircle,
  Package, Users, ShoppingCart, Activity, Clock,
  ChevronDown, ChevronUp, Download, ArrowUpRight,
} from 'lucide-react';
import { collection, query, limit, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { format } from 'date-fns';
import { tr as trLocale } from 'date-fns/locale';
import type { ErpImportResult, ErpStatusResult } from '../../types/erp';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImportState {
  running: boolean;
  result:  ErpImportResult | null;
  error:   string | null;
}

interface ExportState {
  running: boolean;
  result:  string | null;
  error:   string | null;
}

interface LogEntry {
  id:        string;
  operation: string;
  entityType?: string;
  entityId?:  string;
  success:   boolean;
  logoRef:   string | null;
  error:     string | null;
  duration:  number;
  timestamp?: { toDate: () => Date };
}

const INIT_IMPORT: ImportState = { running: false, result: null, error: null };
const INIT_EXPORT: ExportState = { running: false, result: null, error: null };

// ── Helpers ───────────────────────────────────────────────────────────────────

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
      ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
    }`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}
    </span>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function LogoSyncPanel({ lang = 'tr' }: { lang?: string }) {
  const t = lang === 'tr';

  const [status,         setStatus]         = useState<ErpStatusResult | null>(null);
  const [statusLoading,  setStatusLoading]  = useState(false);
  const [stokImport,     setStokImport]     = useState<ImportState>(INIT_IMPORT);
  const [cariImport,     setCariImport]     = useState<ImportState>(INIT_IMPORT);
  const [siparisExport,  setSiparisExport]  = useState<ExportState>(INIT_EXPORT);
  const [orderId,        setOrderId]        = useState('');
  const [logs,           setLogs]           = useState<LogEntry[]>([]);
  const [showLogs,       setShowLogs]       = useState(false);

  // ── Status ──────────────────────────────────────────────────────────────────

  const checkStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const r = await fetch('/api/logo/status');
      setStatus(await r.json() as ErpStatusResult);
    } catch {
      setStatus({ configured: false, connected: false, error: t ? 'Sunucuya ulaşılamadı' : 'Server unreachable' });
    } finally {
      setStatusLoading(false);
    }
  }, [t]);

  useEffect(() => { void checkStatus(); }, [checkStatus]);

  // ── Sync log ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const q = query(collection(db, 'logoSyncLog'), orderBy('timestamp', 'desc'), limit(25));
    return onSnapshot(q, snap =>
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as LogEntry)))
    );
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function runImport(
    endpoint: string,
    setState: React.Dispatch<React.SetStateAction<ImportState>>,
  ) {
    setState({ running: true, result: null, error: null });
    try {
      const r = await fetch(endpoint, { method: 'POST' });
      const d = await r.json() as ErpImportResult & { notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'Logo yapılandırılmamış. Ayarlar\'dan env değişkenlerini girin.' : 'Logo not configured. Set env vars in Settings.');
      setState({ running: false, result: d, error: d.success ? null : (d.error ?? 'Hata') });
    } catch (e) {
      setState({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function runSiparisExport() {
    const id = orderId.trim();
    if (!id) { setSiparisExport(s => ({ ...s, error: t ? 'Sipariş ID girin.' : 'Enter an order ID.' })); return; }
    setSiparisExport({ running: true, result: null, error: null });
    try {
      const r = await fetch('/api/logo/export/siparis', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderId: id }),
      });
      const d = await r.json() as { success: boolean; logoEvrakNo?: string; error?: string; notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'Logo yapılandırılmamış.' : 'Logo not configured.');
      if (!d.success)      throw new Error(d.error ?? 'Hata');
      setSiparisExport({ running: false, result: `✓ ${t ? 'Evrak No' : 'Doc No'}: ${d.logoEvrakNo ?? '—'}`, error: null });
    } catch (e) {
      setSiparisExport({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const connected = !!status?.connected;

  return (
    <div className="space-y-4">

      {/* Status */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl" style={{ background: '#e63312' + '18' }}>
              🐯
            </div>
            <div>
              <p className="font-bold text-sm text-gray-900">Logo Tiger / Go / Start</p>
              <p className="text-[11px] text-gray-400">Logo Yazılım — REST API</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status && (
              <>
                <Chip ok={status.configured} label={t ? 'Yapılandırıldı' : 'Configured'} />
                <Chip ok={status.connected}  label={t ? 'Bağlı' : 'Connected'} />
              </>
            )}
            <button onClick={checkStatus} disabled={statusLoading} className="p-2 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 text-gray-400 ${statusLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {status && !status.configured && (
          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5 text-[11px] text-amber-700">
            <p className="font-bold mb-1">{t ? 'Yapılandırma gerekiyor:' : 'Configuration required:'}</p>
            <p className="font-mono">LOGO_API_URL · LOGO_API_KEY · LOGO_FIRM_NO</p>
            <p className="mt-1 text-amber-600">{t ? 'Bu değerleri sunucu ortam değişkenlerine (.env) ekleyin.' : 'Add these to your server environment variables (.env).'}</p>
          </div>
        )}
        {status?.error && (
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-red-600 bg-red-50 rounded-xl px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {status.error}
          </div>
        )}
      </div>

      {/* Import cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ImportCard
          icon={<Package className="w-5 h-5 text-[#e63312]" />}
          bg="bg-red-50"
          title={t ? 'Stok İçeri Al (Logo → Cetpa)' : 'Import Stock (Logo → Cetpa)'}
          desc={t ? 'Logo\'daki tüm malzeme kartlarını Cetpa envanterine aktar.' : 'Import all Logo material cards into Cetpa inventory.'}
          btnLabel={t ? 'Stokları İçeri Al' : 'Import All Stock'}
          state={stokImport}
          disabled={!connected}
          onRun={() => void runImport('/api/logo/import/stok', setStokImport)}
          lang={t}
        />
        <ImportCard
          icon={<Users className="w-5 h-5 text-purple-600" />}
          bg="bg-purple-50"
          title={t ? 'Cari İçeri Al (Logo → Cetpa)' : 'Import Customers (Logo → Cetpa)'}
          desc={t ? 'Logo\'daki cari hesapları (müşteri/tedarikçi) Cetpa\'ya aktar.' : 'Import Logo customer & supplier accounts into Cetpa.'}
          btnLabel={t ? 'Carileri İçeri Al' : 'Import Customers'}
          state={cariImport}
          disabled={!connected}
          onRun={() => void runImport('/api/logo/import/cari', setCariImport)}
          lang={t}
        />
      </div>

      {/* Export siparis */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h4 className="font-bold text-sm text-gray-900 flex items-center gap-2">
          <ArrowUpRight className="w-4 h-4 text-[#e63312]" />
          {t ? 'Sipariş Gönder (Cetpa → Logo)' : 'Push Order (Cetpa → Logo)'}
        </h4>
        <p className="text-[11px] text-gray-400">
          {t ? 'Seçilen siparişi Logo\'ya satış siparişi olarak gönder.' : 'Send the selected order as a sales order to Logo.'}
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={orderId}
            onChange={e => setOrderId(e.target.value)}
            placeholder={t ? 'Sipariş ID…' : 'Order ID…'}
            className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#e63312] focus:ring-2 focus:ring-[#e63312]/10 font-mono"
            disabled={!connected}
          />
          <button
            onClick={() => void runSiparisExport()}
            disabled={siparisExport.running || !connected}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-bold transition-colors disabled:opacity-40"
            style={{ background: '#e63312' }}
          >
            {siparisExport.running
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <ShoppingCart className="w-3.5 h-3.5" />}
            {t ? 'Gönder' : 'Push'}
          </button>
        </div>
        {siparisExport.result && <Feedback ok  msg={siparisExport.result} />}
        {siparisExport.error  && <Feedback ok={false} msg={siparisExport.error} />}
      </div>

      {/* Sync log */}
      <LogPanel logs={logs} show={showLogs} onToggle={() => setShowLogs(v => !v)} lang={t} erpName="Logo" />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Feedback({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <div className={`flex items-start gap-1.5 text-[11px] rounded-lg px-2.5 py-2 ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
      {msg}
    </div>
  );
}

interface ImportCardProps {
  icon: React.ReactNode; bg: string; title: string; desc: string;
  btnLabel: string; state: ImportState; disabled: boolean;
  onRun: () => void; lang: boolean;
}

function ImportCard({ icon, bg, title, desc, btnLabel, state, disabled, onRun, lang: t }: ImportCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 flex flex-col">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 ${bg} rounded-xl flex items-center justify-center`}>{icon}</div>
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

      <button
        onClick={onRun}
        disabled={state.running || disabled}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#e63312] hover:bg-[#e63312]/90 text-white text-xs font-bold transition-all disabled:opacity-40"
      >
        {state.running
          ? <><RefreshCw className="w-4 h-4 animate-spin" />{t ? 'Aktarılıyor…' : 'Importing…'}</>
          : <><Download className="w-4 h-4" />{btnLabel}</>}
      </button>
      {disabled && !state.running && (
        <p className="text-[10px] text-center text-gray-400">{t ? 'Logo bağlantısı gerekli' : 'Logo connection required'}</p>
      )}
    </div>
  );
}

interface LogPanelProps {
  logs: LogEntry[]; show: boolean; onToggle: () => void; lang: boolean; erpName: string;
}

function LogPanel({ logs, show, onToggle, lang: t }: LogPanelProps) {
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
                return (
                  <div key={entry.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50/60 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      {entry.success
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                        : <XCircle     className="w-3.5 h-3.5 text-red-400    flex-shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate">{entry.operation}</p>
                        {entry.logoRef && <p className="text-[10px] font-mono text-gray-400">#{entry.logoRef}</p>}
                        {entry.error   && <p className="text-[10px] text-red-400 truncate">{entry.error}</p>}
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
