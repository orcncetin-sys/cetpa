/**
 * SAPSyncPanel.tsx — SAP Business One (Service Layer) integration
 *
 * Server routes expected:
 *   GET  /api/sap/status              → ErpStatusResult & { companyDb?, sapVersion? }
 *   POST /api/sap/import/stok         → ErpImportResult
 *   POST /api/sap/import/cari         → ErpImportResult
 *   POST /api/sap/export/siparis  { orderId } → { success, sapDocEntry, sapDocNum }
 *   POST /api/sap/export/fatura   { orderId } → { success, sapDocEntry, sapDocNum }
 *
 * Required server env vars:
 *   SAP_SERVICE_LAYER_URL   — e.g. https://sap-server:50000/b1s/v1
 *   SAP_USERNAME            — SAP Business One user code
 *   SAP_PASSWORD            — SAP user password
 *   SAP_COMPANY_DB          — Company database name (e.g. "SBO_DEMO_TR")
 *
 * Auth: POST /Login { UserName, Password, CompanyDB } → sets cookie SessionId
 * Server manages session renewal (5-min idle timeout in SAP B1).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, CheckCircle2, XCircle, AlertCircle,
  Package, Users, ShoppingCart, FileText, Clock,
  ChevronDown, ChevronUp, Download, ArrowUpRight, Database,
} from 'lucide-react';
import { collection, query, limit, onSnapshot, orderBy } from '../../lib/dbClient';
import { db } from '../../firebase';
import { format } from 'date-fns';
import { tr as trLocale } from 'date-fns/locale';
import type { ErpImportResult, ErpStatusResult } from '../../types/erp';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SAPStatus extends ErpStatusResult {
  companyDb?:  string;
  sapVersion?: string;
}

interface ImportState { running: boolean; result: ErpImportResult | null; error: string | null; }
interface ExportState  { running: boolean; result: string | null;          error: string | null; }

interface LogEntry {
  id: string; operation: string; success: boolean;
  sapDocEntry: number | null; sapDocNum: number | null;
  error: string | null; duration: number;
  timestamp?: { toDate: () => Date };
}

const INIT_I: ImportState = { running: false, result: null, error: null };
const INIT_E: ExportState = { running: false, result: null, error: null };

// ── Main ──────────────────────────────────────────────────────────────────────

export default function SAPSyncPanel({ lang = 'tr' }: { lang?: string }) {
  const t = lang === 'tr';

  const [status,        setStatus]        = useState<SAPStatus | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [stokImport,    setStokImport]    = useState<ImportState>(INIT_I);
  const [cariImport,    setCariImport]    = useState<ImportState>(INIT_I);
  const [siparisExport, setSiparisExport] = useState<ExportState>(INIT_E);
  const [faturaExport,  setFaturaExport]  = useState<ExportState>(INIT_E);
  const [orderId,       setOrderId]       = useState('');
  const [logs,          setLogs]          = useState<LogEntry[]>([]);
  const [showLogs,      setShowLogs]      = useState(false);

  // ── Status ──────────────────────────────────────────────────────────────────

  const checkStatus = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/sap/status');
      setStatus(await r.json() as SAPStatus);
    } catch {
      setStatus({ configured: false, connected: false, error: t ? 'Sunucuya ulaşılamadı' : 'Server unreachable' });
    } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { void checkStatus(); }, [checkStatus]);

  // ── Log subscription ────────────────────────────────────────────────────────

  useEffect(() => {
    const q = query(collection(db, 'sapSyncLog'), orderBy('timestamp', 'desc'), limit(25));
    return onSnapshot(q, snap =>
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as LogEntry)))
    );
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function runImport(endpoint: string, set: React.Dispatch<React.SetStateAction<ImportState>>) {
    set({ running: true, result: null, error: null });
    try {
      const r = await fetch(endpoint, { method: 'POST' });
      const d = await r.json() as ErpImportResult & { notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'SAP yapılandırılmamış. Env değişkenlerini kontrol edin.' : 'SAP not configured. Check env vars.');
      set({ running: false, result: d, error: d.success ? null : (d.error ?? 'Hata') });
    } catch (e) {
      set({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function runExport(
    endpoint: string,
    set: React.Dispatch<React.SetStateAction<ExportState>>,
  ) {
    const id = orderId.trim();
    if (!id) { set(s => ({ ...s, error: t ? 'Sipariş ID girin.' : 'Enter an order ID.' })); return; }
    set({ running: true, result: null, error: null });
    try {
      const r = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderId: id }),
      });
      const d = await r.json() as { success: boolean; sapDocEntry?: number; sapDocNum?: number; notConfigured?: boolean; error?: string };
      if (d.notConfigured) throw new Error(t ? 'SAP yapılandırılmamış.' : 'SAP not configured.');
      if (!d.success) throw new Error(d.error ?? 'Hata');
      set({ running: false, result: `✓ DocEntry: ${d.sapDocEntry ?? '—'} · DocNum: ${d.sapDocNum ?? '—'}`, error: null });
    } catch (e) {
      set({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const connected = !!status?.connected;

  return (
    <div className="space-y-4">

      {/* Status header */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-[#0070f3]/10 text-xl">🔷</div>
            <div>
              <p className="font-bold text-sm text-gray-900">SAP Business One</p>
              <p className="text-[11px] text-gray-400">
                {status?.connected && status.companyDb
                  ? `${status.companyDb}${status.sapVersion ? ' · v' + status.sapVersion : ''}`
                  : 'Service Layer API'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status && (
              <>
                <Chip ok={status.configured} label={t ? 'Yapılandırıldı' : 'Configured'} />
                <Chip ok={status.connected}  label={t ? 'Bağlı' : 'Connected'} />
              </>
            )}
            <button onClick={checkStatus} disabled={loading} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
              <RefreshCw className={`w-4 h-4 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {status && !status.configured && (
          <div className="mt-3 rounded-xl bg-blue-50 border border-blue-100 px-3 py-2.5 text-[11px] text-blue-700">
            <p className="font-bold mb-1">{t ? 'SAP B1 Service Layer bağlantı bilgileri:' : 'SAP B1 Service Layer connection info:'}</p>
            <p className="font-mono text-[10px] leading-5">
              SAP_SERVICE_LAYER_URL · SAP_USERNAME · SAP_PASSWORD · SAP_COMPANY_DB
            </p>
            <p className="mt-1 text-blue-500 text-[10px]">
              {t
                ? 'Service Layer varsayılan olarak https://server:50000/b1s/v1 adresinde çalışır. Port 50000\'in güvenlik duvarında açık olduğundan emin olun.'
                : 'Service Layer runs at https://server:50000/b1s/v1 by default. Ensure port 50000 is open in the firewall.'}
            </p>
          </div>
        )}
        {status?.error && (
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-red-600 bg-red-50 rounded-xl px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {status.error}
          </div>
        )}

        {/* Session info */}
        {status?.connected && (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
            <Database className="w-3.5 h-3.5 text-blue-400" />
            <span>
              {t ? 'Oturum sunucu tarafında yönetiliyor. SAP B1\'in 5 dakikalık idle timeout\'u sunucu tarafından otomatik yenilenir.' : 'Session managed server-side. SAP B1\'s 5-min idle timeout is auto-renewed by the server.'}
            </span>
          </div>
        )}
      </div>

      {/* Import cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SAPImportCard
          icon={<Package className="w-5 h-5 text-[#0070f3]" />} bg="bg-blue-50"
          title={t ? 'Kalemler İçeri Al (SAP → Cetpa)' : 'Import Items (SAP → Cetpa)'}
          desc={t ? 'SAP\'taki tüm stok kalemlerini Cetpa envanterine aktar (Items endpoint).' : 'Import all SAP stock items into Cetpa inventory via Items endpoint.'}
          btnLabel={t ? 'Kalemleri İçeri Al' : 'Import Items'}
          state={stokImport} disabled={!connected}
          onRun={() => void runImport('/api/sap/import/stok', setStokImport)} lang={t}
        />
        <SAPImportCard
          icon={<Users className="w-5 h-5 text-teal-600" />} bg="bg-teal-50"
          title={t ? 'İş Ortağı İçeri Al (SAP → Cetpa)' : 'Import Business Partners (SAP → Cetpa)'}
          desc={t ? 'SAP\'taki müşteri ve tedarikçi iş ortaklarını Cetpa\'ya aktar (BusinessPartners).' : 'Import SAP customer & vendor business partners into Cetpa leads.'}
          btnLabel={t ? 'İş Ortaklarını İçeri Al' : 'Import Business Partners'}
          state={cariImport} disabled={!connected}
          onRun={() => void runImport('/api/sap/import/cari', setCariImport)} lang={t}
        />
      </div>

      {/* Export */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h4 className="font-bold text-sm text-gray-900 flex items-center gap-2">
          <ArrowUpRight className="w-4 h-4 text-[#0070f3]" />
          {t ? 'Cetpa → SAP Business One' : 'Push to SAP Business One'}
        </h4>
        <p className="text-[11px] text-gray-400">
          {t
            ? 'Sipariş → SAP Orders (DocType: dDocument_Items) · Fatura → SAP Invoices (A/R Invoice)'
            : 'Order → SAP Orders (DocType: dDocument_Items) · Invoice → SAP A/R Invoice'}
        </p>
        <input
          type="text"
          value={orderId}
          onChange={e => setOrderId(e.target.value)}
          placeholder={t ? 'Sipariş ID…' : 'Order ID…'}
          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0070f3] focus:ring-2 focus:ring-[#0070f3]/10 font-mono"
          disabled={!connected}
        />
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => void runExport('/api/sap/export/siparis', setSiparisExport)}
            disabled={siparisExport.running || !connected}
            className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#0070f3] hover:bg-[#0070f3]/90 text-white text-xs font-bold disabled:opacity-40 transition-colors"
          >
            {siparisExport.running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5" />}
            {t ? 'Sipariş Gönder' : 'Push Order'}
          </button>
          <button
            onClick={() => void runExport('/api/sap/export/fatura', setFaturaExport)}
            disabled={faturaExport.running || !connected}
            className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold disabled:opacity-40 transition-colors"
          >
            {faturaExport.running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            {t ? 'Fatura Gönder' : 'Push Invoice'}
          </button>
        </div>
        {siparisExport.result && <Fb ok msg={siparisExport.result} />}
        {siparisExport.error  && <Fb ok={false} msg={siparisExport.error} />}
        {faturaExport.result  && <Fb ok msg={faturaExport.result} />}
        {faturaExport.error   && <Fb ok={false} msg={faturaExport.error} />}
      </div>

      {/* Sync log */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <button onClick={() => setShowLogs(v => !v)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-bold text-gray-700">
              {t ? 'Senkronizasyon Geçmişi' : 'Sync History'}
              {logs.length > 0 && <span className="ml-2 text-[11px] font-medium text-gray-400">({logs.length})</span>}
            </span>
          </div>
          {showLogs ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        {showLogs && (
          <div className="border-t border-gray-100 divide-y divide-gray-50">
            {logs.length === 0
              ? <p className="text-center text-sm text-gray-400 py-8">{t ? 'Henüz kayıt yok.' : 'No records yet.'}</p>
              : logs.map(entry => {
                  const ts = entry.timestamp?.toDate?.();
                  return (
                    <div key={entry.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50/60 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        {entry.success
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                          : <XCircle     className="w-3.5 h-3.5 text-red-400    flex-shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-800 truncate">{entry.operation}</p>
                          {(entry.sapDocEntry ?? entry.sapDocNum) && (
                            <p className="text-[10px] font-mono text-gray-400">
                              DocEntry:{entry.sapDocEntry ?? '—'} · DocNum:{entry.sapDocNum ?? '—'}
                            </p>
                          )}
                          {entry.error && <p className="text-[10px] text-red-400 truncate">{entry.error}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-[10px] font-mono text-gray-400">{entry.duration}ms</span>
                        {ts && <span className="text-[10px] text-gray-400">{format(ts, 'dd.MM HH:mm', { locale: trLocale })}</span>}
                      </div>
                    </div>
                  );
                })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

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

function Fb({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <div className={`flex items-start gap-1.5 text-[11px] rounded-lg px-2.5 py-2 ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
      {msg}
    </div>
  );
}

interface SAPImportCardProps {
  icon: React.ReactNode; bg: string; title: string; desc: string;
  btnLabel: string; state: ImportState; disabled: boolean; onRun: () => void; lang: boolean;
}

function SAPImportCard({ icon, bg, title, desc, btnLabel, state, disabled, onRun, lang: t }: SAPImportCardProps) {
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
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1"><XCircle className="w-3.5 h-3.5" />{state.error}</div>
          )}
        </div>
      )}
      {state.error && !state.result && (
        <div className="flex items-start gap-1.5 text-[11px] bg-red-50 text-red-600 rounded-lg px-2.5 py-2">
          <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{state.error}
        </div>
      )}
      <button onClick={onRun} disabled={state.running || disabled}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#0070f3] hover:bg-[#0070f3]/90 text-white text-xs font-bold transition-all disabled:opacity-40">
        {state.running
          ? <><RefreshCw className="w-4 h-4 animate-spin" />{t ? 'Aktarılıyor…' : 'Importing…'}</>
          : <><Download className="w-4 h-4" />{btnLabel}</>}
      </button>
      {disabled && !state.running && (
        <p className="text-[10px] text-center text-gray-400">{t ? 'SAP bağlantısı gerekli' : 'SAP connection required'}</p>
      )}
    </div>
  );
}
