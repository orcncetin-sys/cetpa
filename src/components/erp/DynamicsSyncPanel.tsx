/**
 * DynamicsSyncPanel.tsx — Microsoft Dynamics 365 Business Central integration
 *
 * Server routes expected:
 *   GET  /api/dynamics/status         → ErpStatusResult & { environmentName?, companyName? }
 *   POST /api/dynamics/import/stok    → ErpImportResult
 *   POST /api/dynamics/import/cari    → ErpImportResult
 *   POST /api/dynamics/export/siparis { orderId } → { success, dynamicsOrderNo }
 *   POST /api/dynamics/export/fatura  { orderId } → { success, dynamicsInvoiceNo }
 *
 * Required server env vars:
 *   DYNAMICS_TENANT_ID      — Azure AD tenant (GUID)
 *   DYNAMICS_CLIENT_ID      — App registration client ID
 *   DYNAMICS_CLIENT_SECRET  — App registration secret
 *   DYNAMICS_COMPANY_ID     — Business Central company GUID
 *   DYNAMICS_ENVIRONMENT    — e.g. "production" or "sandbox" (optional, default: production)
 *
 * Auth flow: client_credentials → access_token → OData v4 calls
 * Base URL: https://api.businesscentral.dynamics.com/v2.0/{tenant}/{env}/api/v2.0/companies({id})/
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, CheckCircle2, XCircle, AlertCircle,
  Package, Users, ShoppingCart, FileText, Clock,
  ChevronDown, ChevronUp, Download, ArrowUpRight,
} from 'lucide-react';
import { collection, query, limit, onSnapshot, orderBy } from '../../lib/dbClient';
import { db } from '../../firebase';
import { format } from 'date-fns';
import { tr as trLocale } from 'date-fns/locale';
import type { ErpImportResult, ErpStatusResult } from '../../types/erp';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DynamicsStatus extends ErpStatusResult {
  environmentName?: string;
  companyName?:     string;
}

interface ImportState { running: boolean; result: ErpImportResult | null; error: string | null; }
interface ExportState  { running: boolean; result: string | null;          error: string | null; }
interface LogEntry {
  id: string; operation: string; success: boolean;
  dynamicsRef: string | null; error: string | null;
  duration: number; timestamp?: { toDate: () => Date };
}

const INIT_I: ImportState = { running: false, result: null, error: null };
const INIT_E: ExportState = { running: false, result: null, error: null };

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

function Fb({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <div className={`flex items-start gap-1.5 text-[11px] rounded-lg px-2.5 py-2 ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
      {msg}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DynamicsSyncPanel({ lang = 'tr' }: { lang?: string }) {
  const t = lang === 'tr';

  const [status,        setStatus]        = useState<DynamicsStatus | null>(null);
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
      const r = await fetch('/api/dynamics/status');
      setStatus(await r.json() as DynamicsStatus);
    } catch {
      setStatus({ configured: false, connected: false, error: t ? 'Sunucuya ulaşılamadı' : 'Server unreachable' });
    } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { void checkStatus(); }, [checkStatus]);

  // ── Log subscription ────────────────────────────────────────────────────────

  useEffect(() => {
    const q = query(collection(db, 'dynamicsSyncLog'), orderBy('timestamp', 'desc'), limit(25));
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
      if (d.notConfigured) throw new Error(t ? 'Dynamics yapılandırılmamış.' : 'Dynamics not configured.');
      set({ running: false, result: d, error: d.success ? null : (d.error ?? 'Hata') });
    } catch (e) {
      set({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function runExport(
    endpoint: string,
    set: React.Dispatch<React.SetStateAction<ExportState>>,
    refKey: string,
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
      const d = await r.json() as Record<string, unknown> & { success: boolean; notConfigured?: boolean; error?: string };
      if (d.notConfigured) throw new Error(t ? 'Dynamics yapılandırılmamış.' : 'Dynamics not configured.');
      if (!d.success) throw new Error(d.error ?? 'Hata');
      set({ running: false, result: `✓ Ref: ${(d[refKey] as string) ?? '—'}`, error: null });
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
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-[#0078d4]/10 text-xl">🪟</div>
            <div>
              <p className="font-bold text-sm text-gray-900">
                Microsoft Dynamics 365 Business Central
              </p>
              <p className="text-[11px] text-gray-400">
                {status?.environmentName
                  ? `${status.environmentName}${status.companyName ? ' · ' + status.companyName : ''}`
                  : 'OData v4 API'}
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
            <p className="font-bold mb-1">{t ? 'Azure AD uygulama kaydı gerekiyor:' : 'Azure AD app registration required:'}</p>
            <p className="font-mono text-[10px] leading-5">
              DYNAMICS_TENANT_ID · DYNAMICS_CLIENT_ID · DYNAMICS_CLIENT_SECRET · DYNAMICS_COMPANY_ID
            </p>
            <a href="https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/automation-apis-using-s2s-authentication"
               target="_blank" rel="noreferrer"
               className="mt-1 inline-flex items-center gap-0.5 text-blue-500 hover:underline">
              {t ? 'Kurulum kılavuzu →' : 'Setup guide →'}
            </a>
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
        <DynImportCard
          icon={<Package className="w-5 h-5 text-[#0078d4]" />} bg="bg-blue-50"
          title={t ? 'Stok İçeri Al (BC → Cetpa)' : 'Import Items (BC → Cetpa)'}
          desc={t ? 'Business Central\'daki tüm kalemleri Cetpa envanterine aktar.' : 'Import all Business Central items into Cetpa inventory.'}
          btnLabel={t ? 'Kalemleri İçeri Al' : 'Import Items'}
          state={stokImport} disabled={!connected}
          onRun={() => void runImport('/api/dynamics/import/stok', setStokImport)} lang={t}
        />
        <DynImportCard
          icon={<Users className="w-5 h-5 text-indigo-600" />} bg="bg-indigo-50"
          title={t ? 'Müşteri İçeri Al (BC → Cetpa)' : 'Import Customers (BC → Cetpa)'}
          desc={t ? 'Business Central\'daki müşterileri Cetpa\'ya aktar.' : 'Import Business Central customers into Cetpa leads.'}
          btnLabel={t ? 'Müşterileri İçeri Al' : 'Import Customers'}
          state={cariImport} disabled={!connected}
          onRun={() => void runImport('/api/dynamics/import/cari', setCariImport)} lang={t}
        />
      </div>

      {/* Export section */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h4 className="font-bold text-sm text-gray-900 flex items-center gap-2">
          <ArrowUpRight className="w-4 h-4 text-[#0078d4]" />
          {t ? 'Cetpa → Business Central' : 'Push to Business Central'}
        </h4>
        <input
          type="text"
          value={orderId}
          onChange={e => setOrderId(e.target.value)}
          placeholder={t ? 'Sipariş ID…' : 'Order ID…'}
          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#0078d4] focus:ring-2 focus:ring-[#0078d4]/10 font-mono"
          disabled={!connected}
        />
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => void runExport('/api/dynamics/export/siparis', setSiparisExport, 'dynamicsOrderNo')}
            disabled={siparisExport.running || !connected}
            className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#0078d4] hover:bg-[#0078d4]/90 text-white text-xs font-bold disabled:opacity-40 transition-colors"
          >
            {siparisExport.running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5" />}
            {t ? 'Sipariş Gönder' : 'Push Order'}
          </button>
          <button
            onClick={() => void runExport('/api/dynamics/export/fatura', setFaturaExport, 'dynamicsInvoiceNo')}
            disabled={faturaExport.running || !connected}
            className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-40 transition-colors"
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

      {/* Log */}
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
                          {entry.dynamicsRef && <p className="text-[10px] font-mono text-gray-400">#{entry.dynamicsRef}</p>}
                          {entry.error       && <p className="text-[10px] text-red-400 truncate">{entry.error}</p>}
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

// ── ImportCard ────────────────────────────────────────────────────────────────

interface DynImportCardProps {
  icon: React.ReactNode; bg: string; title: string; desc: string;
  btnLabel: string; state: ImportState; disabled: boolean; onRun: () => void; lang: boolean;
}

function DynImportCard({ icon, bg, title, desc, btnLabel, state, disabled, onRun, lang: t }: DynImportCardProps) {
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
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#0078d4] hover:bg-[#0078d4]/90 text-white text-xs font-bold transition-all disabled:opacity-40">
        {state.running
          ? <><RefreshCw className="w-4 h-4 animate-spin" />{t ? 'Aktarılıyor…' : 'Importing…'}</>
          : <><Download className="w-4 h-4" />{btnLabel}</>}
      </button>
      {disabled && !state.running && (
        <p className="text-[10px] text-center text-gray-400">{t ? 'Dynamics bağlantısı gerekli' : 'Dynamics connection required'}</p>
      )}
    </div>
  );
}
