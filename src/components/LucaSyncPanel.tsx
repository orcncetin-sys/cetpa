/**
 * LucaSyncPanel.tsx — Luca accounting integration panel
 *
 * Provides UI for:
 * - Testing Luca API connection  (GET  /api/luca/status)
 * - Pushing an order invoice     (POST /api/luca/sync/fatura)
 * - Pulling Luca stock → Firebase (POST /api/luca/sync/stok)
 *
 * Stores a lightweight sync log in the `lucaSyncLog` Firestore collection
 * (written server-side on every sync call; read here for display).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, CheckCircle2, XCircle, AlertCircle,
  Package, FileText, Activity, Clock, ChevronDown, ChevronUp,
  Plug,
} from 'lucide-react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { format } from 'date-fns';
import { tr as trLocale } from 'date-fns/locale';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LucaStatus {
  configured: boolean;
  connected:  boolean;
  companyName?: string;
  error?:      string;
}

interface SyncState {
  running: boolean;
  result:  string | null;
  error:   string | null;
}

interface LogEntry {
  id:        string;
  operation: string;
  success:   boolean;
  lucaRef:   string | null;
  error:     string | null;
  duration:  number;
  timestamp?: { toDate: () => Date };
}

const EMPTY_SYNC: SyncState = { running: false, result: null, error: null };

// ── Helper ────────────────────────────────────────────────────────────────────

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
      ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
    }`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}
    </span>
  );
}

function SyncCard({
  icon: Icon,
  title,
  description,
  state,
  onRun,
  lang,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  state: SyncState;
  onRun: () => void;
  lang: boolean;
}) {
  return (
    <div className="bg-gray-50 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
          <Icon className="w-4 h-4 text-[#1a3a5c]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800">{title}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>

      <button
        onClick={onRun}
        disabled={state.running}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-[#1a3a5c] hover:bg-[#1a3a5c]/90 text-white text-xs font-bold transition-colors disabled:opacity-50"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${state.running ? 'animate-spin' : ''}`} />
        {state.running ? (lang ? 'Çalışıyor…' : 'Running…') : (lang ? 'Çalıştır' : 'Run')}
      </button>

      {state.result && (
        <div className="flex items-start gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-2">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{state.result}</span>
        </div>
      )}
      {state.error && (
        <div className="flex items-start gap-1.5 text-[11px] text-red-600 bg-red-50 rounded-lg px-2.5 py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{state.error}</span>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function LucaSyncPanel({ currentLanguage = 'tr' }: { currentLanguage?: string }) {
  const lang = currentLanguage === 'tr';

  const [status,       setStatus]       = useState<LucaStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [faturaSync,   setFaturaSync]   = useState<SyncState>(EMPTY_SYNC);
  const [stokSync,     setStokSync]     = useState<SyncState>(EMPTY_SYNC);
  const [logs,         setLogs]         = useState<LogEntry[]>([]);
  const [showLogs,     setShowLogs]     = useState(false);
  const [orderIdInput, setOrderIdInput] = useState('');

  // ── Connection status ──────────────────────────────────────────────────────

  const checkStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const r = await fetch('/api/luca/status');
      const d = await r.json() as LucaStatus;
      setStatus(d);
    } catch {
      setStatus({ configured: false, connected: false, error: lang ? 'Sunucuya ulaşılamadı' : 'Server unreachable' });
    } finally {
      setStatusLoading(false);
    }
  }, [lang]);

  useEffect(() => { void checkStatus(); }, [checkStatus]);

  // ── Sync log subscription ──────────────────────────────────────────────────

  useEffect(() => {
    const q = query(
      collection(db, 'lucaSyncLog'),
      orderBy('timestamp', 'desc'),
      limit(20),
    );
    const unsub = onSnapshot(q, snap =>
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as LogEntry)))
    );
    return unsub;
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const runFaturaSync = async () => {
    const id = orderIdInput.trim();
    if (!id) {
      setFaturaSync(prev => ({ ...prev, error: lang ? 'Sipariş ID girin.' : 'Enter an order ID.' }));
      return;
    }
    setFaturaSync({ running: true, result: null, error: null });
    try {
      const r = await fetch('/api/luca/sync/fatura', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderId: id }),
      });
      const d = await r.json() as { success: boolean; lucaFaturaNo?: string; notConfigured?: boolean; error?: string; duration?: number };
      if (d.notConfigured) {
        setFaturaSync({ running: false, result: null, error: lang ? 'Luca yapılandırılmamış.' : 'Luca not configured.' });
      } else if (d.success) {
        setFaturaSync({ running: false, result: `✓ Fatura No: ${d.lucaFaturaNo ?? '—'} (${d.duration ?? '?'}ms)`, error: null });
      } else {
        setFaturaSync({ running: false, result: null, error: d.error ?? (lang ? 'Bilinmeyen hata' : 'Unknown error') });
      }
    } catch (e) {
      setFaturaSync({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const runStokSync = async () => {
    setStokSync({ running: true, result: null, error: null });
    try {
      const r = await fetch('/api/luca/sync/stok', { method: 'POST' });
      const d = await r.json() as { success: boolean; upserted?: number; notConfigured?: boolean; error?: string; duration?: number };
      if (d.notConfigured) {
        setStokSync({ running: false, result: null, error: lang ? 'Luca yapılandırılmamış.' : 'Luca not configured.' });
      } else if (d.success) {
        setStokSync({ running: false, result: `✓ ${d.upserted ?? 0} ${lang ? 'ürün güncellendi' : 'products synced'} (${d.duration ?? '?'}ms)`, error: null });
      } else {
        setStokSync({ running: false, result: null, error: d.error ?? (lang ? 'Bilinmeyen hata' : 'Unknown error') });
      }
    } catch (e) {
      setStokSync({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">

      {/* ── Header: connection status ── */}
      <div className="p-5 flex items-center gap-4">
        <div className="w-10 h-10 bg-[#1a3a5c]/10 rounded-xl flex items-center justify-center flex-shrink-0">
          <Plug className="w-5 h-5 text-[#1a3a5c]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-gray-900">Luca</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {status === null
              ? (lang ? 'Bağlantı kontrol ediliyor…' : 'Checking connection…')
              : status.connected
                ? (status.companyName ?? (lang ? 'Bağlantı başarılı' : 'Connected'))
                : (lang ? 'Bağlı değil' : 'Not connected')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <Badge
              ok={status.connected}
              label={status.connected ? (lang ? 'Bağlı' : 'Connected') : (lang ? 'Bağlı Değil' : 'Offline')}
            />
          )}
          <button
            onClick={checkStatus}
            disabled={statusLoading}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            title={lang ? 'Yenile' : 'Refresh'}
          >
            <RefreshCw className={`w-4 h-4 text-gray-400 ${statusLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Sync cards ── */}
      <div className="p-5 space-y-4">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
          {lang ? 'Senkronizasyon İşlemleri' : 'Sync Operations'}
        </p>

        {/* Fatura sync — needs an order ID */}
        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
              <FileText className="w-4 h-4 text-[#1a3a5c]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-gray-800">
                {lang ? 'Fatura Gönder (Luca)' : 'Push Invoice to Luca'}
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {lang
                  ? 'Seçilen siparişi Luca\'ya fatura olarak ilet.'
                  : 'Send the selected order as a sales invoice to Luca.'}
              </p>
            </div>
          </div>
          <input
            type="text"
            value={orderIdInput}
            onChange={e => setOrderIdInput(e.target.value)}
            placeholder={lang ? 'Sipariş ID…' : 'Order ID…'}
            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-[#1a3a5c] focus:ring-2 focus:ring-[#1a3a5c]/10 font-mono transition-all"
          />
          <button
            onClick={() => void runFaturaSync()}
            disabled={faturaSync.running}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-[#1a3a5c] hover:bg-[#1a3a5c]/90 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${faturaSync.running ? 'animate-spin' : ''}`} />
            {faturaSync.running ? (lang ? 'Gönderiliyor…' : 'Sending…') : (lang ? 'Fatura Gönder' : 'Send Invoice')}
          </button>
          {faturaSync.result && (
            <div className="flex items-start gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              {faturaSync.result}
            </div>
          )}
          {faturaSync.error && (
            <div className="flex items-start gap-1.5 text-[11px] text-red-600 bg-red-50 rounded-lg px-2.5 py-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              {faturaSync.error}
            </div>
          )}
        </div>

        {/* Stok sync */}
        <SyncCard
          icon={Package}
          title={lang ? 'Stok Çek (Luca → Firebase)' : 'Pull Stock (Luca → Firebase)'}
          description={lang
            ? 'Luca\'dan tüm ürün ve stok bilgilerini çek, envantere uygula.'
            : 'Pull all products and stock levels from Luca and upsert to inventory.'}
          state={stokSync}
          onRun={() => void runStokSync()}
          lang={lang}
        />
      </div>

      {/* ── Sync log ── */}
      <div className="p-5">
        <button
          onClick={() => setShowLogs(v => !v)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-gray-400" />
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              {lang ? 'Son İşlemler' : 'Recent Operations'}
            </span>
            {logs.length > 0 && (
              <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                {logs.length}
              </span>
            )}
          </div>
          {showLogs ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {showLogs && (
          <div className="mt-3 space-y-1.5">
            {logs.length === 0 ? (
              <p className="text-[11px] text-gray-400 text-center py-4">
                {lang ? 'Henüz işlem yok.' : 'No operations yet.'}
              </p>
            ) : (
              logs.map(entry => {
                const ts = entry.timestamp?.toDate?.();
                return (
                  <div key={entry.id} className={`rounded-xl px-3 py-2 flex items-start justify-between gap-2 ${
                    entry.success ? 'bg-emerald-50' : 'bg-red-50'
                  }`}>
                    <div className="flex items-center gap-2 min-w-0">
                      {entry.success
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                        : <XCircle     className="w-3.5 h-3.5 text-red-400    flex-shrink-0" />}
                      <div className="min-w-0">
                        <p className={`text-[11px] font-bold truncate ${entry.success ? 'text-emerald-800' : 'text-red-700'}`}>
                          {entry.operation}
                          {entry.lucaRef && <span className="font-mono ml-1 text-[10px]">#{entry.lucaRef}</span>}
                        </p>
                        {entry.error && <p className="text-[10px] text-red-500 truncate">{entry.error}</p>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                      <span className="text-[10px] text-gray-400 font-mono">{entry.duration}ms</span>
                      {ts && (
                        <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {format(ts, 'dd MMM HH:mm', { locale: lang ? trLocale : undefined })}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
