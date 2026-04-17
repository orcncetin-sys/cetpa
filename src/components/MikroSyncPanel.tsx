import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, CheckCircle2, XCircle, AlertCircle, Download,
  Package, Users, ShoppingCart, Activity, Clock, ChevronDown, ChevronUp,
} from 'lucide-react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  getMikroStatus,
  importStokFromMikro,
  importCariFromMikro,
  syncInventoryItemToMikro,
  syncLeadToMikro,
  MikroStatus,
  MikroImportResult,
} from '../services/mikroService';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PullState {
  running: boolean;
  result: string | null;
  error: string | null;
}

interface SyncLogEntry {
  id: string;
  operation: string;
  entityType: string;
  entityId: string;
  success: boolean;
  mikroRef: string | null;
  error: string | null;
  duration: number;
  timestamp?: { toDate: () => Date };
}

interface ImportState {
  running: boolean;
  result: MikroImportResult | null;
  error: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
      ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
    }`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}
    </span>
  );
}

function OpBadge({ op }: { op: string }) {
  const colors: Record<string, string> = {
    StokKaydetV2:    'bg-blue-100 text-blue-700',
    StokListesiV2:   'bg-blue-50  text-blue-500',
    CariKaydetV2:    'bg-purple-100 text-purple-700',
    CariListesiV2:   'bg-purple-50  text-purple-500',
    SiparisKaydetV2: 'bg-orange-100 text-orange-700',
    ImportStok:      'bg-teal-100 text-teal-700',
    ImportCari:      'bg-teal-50  text-teal-600',
  };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${colors[op] || 'bg-gray-100 text-gray-600'}`}>
      {op}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface MikroSyncPanelProps {
  currentLanguage?: string;
}

export default function MikroSyncPanel({ currentLanguage = 'tr' }: MikroSyncPanelProps) {
  const t = currentLanguage === 'tr';

  // Status
  const [status, setStatus] = useState<MikroStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Import states
  const [stokImport, setStokImport] = useState<ImportState>({ running: false, result: null, error: null });
  const [cariImport, setCariImport] = useState<ImportState>({ running: false, result: null, error: null });

  // Pull-flow states
  const defaultPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [pullPeriod, setPullPeriod] = useState(defaultPeriod);
  const [bakiyePull, setBakiyePull] = useState<PullState>({ running: false, result: null, error: null });
  const [mizanPull,  setMizanPull]  = useState<PullState>({ running: false, result: null, error: null });
  const [kdvPull,    setKdvPull]    = useState<PullState>({ running: false, result: null, error: null });

  // Sync log
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);

  // ── Live syncLog subscription ──────────────────────────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, 'syncLog'),
      orderBy('timestamp', 'desc'),
      limit(30)
    );
    const unsub = onSnapshot(q, snap => {
      setSyncLog(snap.docs.map(d => ({ id: d.id, ...d.data() } as SyncLogEntry)));
    });
    return () => unsub();
  }, []);

  // ── Status check ───────────────────────────────────────────────────────────
  const checkStatus = useCallback(async () => {
    setCheckingStatus(true);
    try {
      const s = await getMikroStatus();
      setStatus(s);
    } catch {
      setStatus({ configured: false, connected: false, error: 'Bağlantı hatası' });
    } finally {
      setCheckingStatus(false);
    }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  // ── Import handlers ────────────────────────────────────────────────────────
  async function handleImportStok() {
    setStokImport({ running: true, result: null, error: null });
    try {
      const result = await importStokFromMikro();
      setStokImport({ running: false, result, error: result.success ? null : (result.error || 'Bilinmeyen hata') });
    } catch (e) {
      setStokImport({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleImportCari() {
    setCariImport({ running: true, result: null, error: null });
    try {
      const result = await importCariFromMikro();
      setCariImport({ running: false, result, error: result.success ? null : (result.error || 'Bilinmeyen hata') });
    } catch (e) {
      setCariImport({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── Pull-flow handlers ─────────────────────────────────────────────────────
  async function handlePullBakiye() {
    setBakiyePull({ running: true, result: null, error: null });
    try {
      const r = await fetch('/api/mikro/pull/bakiye', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json() as { success: boolean; updated?: number; skipped?: number; error?: string; notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'Mikro yapılandırılmamış.' : 'Mikro not configured.');
      if (!d.success) throw new Error(d.error || 'Hata');
      setBakiyePull({ running: false, result: `${t ? 'Güncellendi' : 'Updated'}: ${d.updated ?? 0} / ${t ? 'Atlandı' : 'Skipped'}: ${d.skipped ?? 0}`, error: null });
    } catch (e) {
      setBakiyePull({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handlePullMizan() {
    setMizanPull({ running: true, result: null, error: null });
    try {
      const r = await fetch('/api/mikro/pull/mizan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: pullPeriod }) });
      const d = await r.json() as { success: boolean; period?: string; rows?: number; error?: string; notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'Mikro yapılandırılmamış.' : 'Mikro not configured.');
      if (!d.success) throw new Error(d.error || 'Hata');
      setMizanPull({ running: false, result: `${t ? 'Dönem' : 'Period'}: ${d.period ?? pullPeriod} · ${d.rows ?? 0} ${t ? 'satır' : 'rows'}`, error: null });
    } catch (e) {
      setMizanPull({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handlePullKdv() {
    setKdvPull({ running: true, result: null, error: null });
    try {
      const r = await fetch('/api/mikro/pull/kdv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: pullPeriod }) });
      const d = await r.json() as { success: boolean; period?: string; kdvMatrahi?: number; hesaplananKdv?: number; error?: string; notConfigured?: boolean };
      if (d.notConfigured) throw new Error(t ? 'Mikro yapılandırılmamış.' : 'Mikro not configured.');
      if (!d.success) throw new Error(d.error || 'Hata');
      setKdvPull({ running: false, result: `${t ? 'Matrah' : 'Base'}: ₺${(d.kdvMatrahi ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} · KDV: ₺${(d.hesaplananKdv ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, error: null });
    } catch (e) {
      setKdvPull({ running: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Connection Status Card ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#1a3a5c]/10 rounded-xl flex items-center justify-center">
              <Activity className="w-5 h-5 text-[#1a3a5c]" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-gray-900">
                {t ? 'Mikro Jump Bağlantı Durumu' : 'Mikro Jump Connection Status'}
              </h3>
              <p className="text-[11px] text-gray-400">jumpbulutapigw.mikro.com.tr</p>
            </div>
          </div>
          <button
            onClick={checkStatus}
            disabled={checkingStatus}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50"
            title={t ? 'Yenile' : 'Refresh'}
          >
            <RefreshCw className={`w-4 h-4 text-gray-500 ${checkingStatus ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {status ? (
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge ok={status.configured} label={t ? 'Yapılandırıldı' : 'Configured'} />
            <StatusBadge ok={status.connected}  label={t ? 'Bağlı' : 'Connected'} />
            {status.error && (
              <span className="text-[11px] text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {status.error}
              </span>
            )}
            {!status.configured && (
              <p className="text-[11px] text-gray-400 w-full mt-1">
                {t
                  ? 'Mikro env değişkenlerini sunucuda ayarlayın (MIKRO_IDM_EMAIL, MIKRO_IDM_PASSWORD, MIKRO_API_KEY, MIKRO_ALIAS)'
                  : 'Set Mikro env vars on the server (MIKRO_IDM_EMAIL, MIKRO_IDM_PASSWORD, MIKRO_API_KEY, MIKRO_ALIAS)'}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <RefreshCw className="w-3 h-3 animate-spin" />
            {t ? 'Kontrol ediliyor...' : 'Checking...'}
          </div>
        )}
      </div>

      {/* ── Import Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Stok Import */}
        <ImportCard
          icon={<Package className="w-5 h-5 text-blue-600" />}
          iconBg="bg-blue-50"
          title={t ? 'Stok İçeri Al' : 'Import Stock'}
          description={t
            ? 'Mikro\'daki tüm stok kartlarını Cetpa envanterine aktar. Mevcut ürünler güncellenir, yeniler oluşturulur.'
            : 'Import all Mikro stock cards into Cetpa inventory. Existing products updated, new ones created.'}
          buttonLabel={t ? 'Stokları İçeri Al' : 'Import All Stock'}
          buttonColor="bg-blue-600 hover:bg-blue-700"
          running={stokImport.running}
          result={stokImport.result}
          error={stokImport.error}
          disabled={!status?.connected}
          onImport={handleImportStok}
          lang={currentLanguage}
        />

        {/* Cari Import */}
        <ImportCard
          icon={<Users className="w-5 h-5 text-purple-600" />}
          iconBg="bg-purple-50"
          title={t ? 'Cari İçeri Al' : 'Import Customers'}
          description={t
            ? 'Mikro\'daki tüm cari hesapları (müşteri & tedarikçi) Cetpa\'ya aktar. Mevcut kayıtlar güncellenir.'
            : 'Import all Mikro cari accounts (customers & suppliers) into Cetpa. Existing records updated.'}
          buttonLabel={t ? 'Carileri İçeri Al' : 'Import All Customers'}
          buttonColor="bg-purple-600 hover:bg-purple-700"
          running={cariImport.running}
          result={cariImport.result}
          error={cariImport.error}
          disabled={!status?.connected}
          onImport={handleImportCari}
          lang={currentLanguage}
        />
      </div>

      {/* ── Pull Flows ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="font-bold text-sm text-gray-900 flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#1a3a5c]" />
            {t ? 'Mikro\'dan Veri Çek' : 'Pull Data from Mikro'}
          </h4>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-gray-400 uppercase">{t ? 'Dönem' : 'Period'}</label>
            <input
              type="month"
              value={pullPeriod}
              onChange={e => setPullPeriod(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-[#1a3a5c] bg-gray-50"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Cari Bakiye */}
          <PullCard
            icon={<Users className="w-4 h-4 text-[#1a3a5c]" />}
            title={t ? 'Cari Bakiye' : 'Account Balances'}
            description={t ? 'Tüm cari hesapların bakiyelerini Mikro\'dan çek.' : 'Pull AR/AP balances from Mikro for all accounts.'}
            state={bakiyePull}
            disabled={!status?.connected}
            onPull={handlePullBakiye}
            lang={t}
          />
          {/* Mizan */}
          <PullCard
            icon={<ShoppingCart className="w-4 h-4 text-indigo-600" />}
            title={t ? 'Mizan' : 'Trial Balance'}
            description={t ? `${pullPeriod} dönemine ait mizanı çek.` : `Pull trial balance for ${pullPeriod}.`}
            state={mizanPull}
            disabled={!status?.connected}
            onPull={handlePullMizan}
            lang={t}
          />
          {/* KDV Özet */}
          <PullCard
            icon={<Download className="w-4 h-4 text-amber-600" />}
            title={t ? 'KDV Özeti' : 'VAT Summary'}
            description={t ? `${pullPeriod} KDV matrahı ve hesaplanan KDV'yi çek.` : `Pull VAT base and calculated tax for ${pullPeriod}.`}
            state={kdvPull}
            disabled={!status?.connected}
            onPull={handlePullKdv}
            lang={t}
          />
        </div>

        {!status?.connected && (
          <p className="text-[10px] text-center text-gray-400">
            {t ? 'Pull işlemleri için Mikro bağlantısı gerekli.' : 'Mikro connection required for pull operations.'}
          </p>
        )}
      </div>

      {/* ── Sync Log ── */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <button
          onClick={() => setShowLog(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-bold text-gray-700">
              {t ? 'Senkronizasyon Geçmişi' : 'Sync History'}
              {syncLog.length > 0 && (
                <span className="ml-2 text-[11px] font-medium text-gray-400">({syncLog.length} kayıt)</span>
              )}
            </span>
          </div>
          {showLog ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {showLog && (
          <div className="border-t border-gray-100 overflow-x-auto">
            {syncLog.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">
                {t ? 'Henüz senkronizasyon kaydı yok.' : 'No sync records yet.'}
              </p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] w-32">
                      {t ? 'Zaman' : 'Time'}
                    </th>
                    <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px]">
                      {t ? 'İşlem' : 'Operation'}
                    </th>
                    <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px]">
                      {t ? 'Varlık' : 'Entity'}
                    </th>
                    <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px]">
                      {t ? 'Mikro Ref.' : 'Mikro Ref.'}
                    </th>
                    <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] text-center">
                      {t ? 'Durum' : 'Status'}
                    </th>
                    <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] text-right">
                      {t ? 'Süre' : 'Duration'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {syncLog.map(entry => (
                    <tr key={entry.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">
                        {entry.timestamp?.toDate
                          ? format(entry.timestamp.toDate(), 'dd.MM HH:mm:ss', { locale: tr })
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <OpBadge op={entry.operation} />
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">
                        <span className="font-medium">{entry.entityType}</span>
                        {entry.entityId !== 'bulk' && entry.entityId !== 'unknown' && (
                          <span className="text-gray-300 ml-1">/{entry.entityId.substring(0, 8)}</span>
                        )}
                        {entry.entityId === 'bulk' && (
                          <span className="ml-1 text-[10px] text-teal-500 font-bold">BULK</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 font-mono text-[10px]">
                        {entry.mikroRef || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {entry.success
                          ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                          : (
                            <span title={entry.error || ''}>
                              <XCircle className="w-4 h-4 text-red-400 mx-auto" />
                            </span>
                          )
                        }
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-400">
                        {entry.duration ? `${entry.duration}ms` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ImportCard sub-component ──────────────────────────────────────────────────

interface ImportCardProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  buttonLabel: string;
  buttonColor: string;
  running: boolean;
  result: MikroImportResult | null;
  error: string | null;
  disabled: boolean;
  onImport: () => void;
  lang: string;
}

function ImportCard({
  icon, iconBg, title, description, buttonLabel, buttonColor,
  running, result, error, disabled, onImport, lang,
}: ImportCardProps) {
  const t = lang === 'tr';

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 flex flex-col">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 ${iconBg} rounded-xl flex items-center justify-center`}>
          {icon}
        </div>
        <h4 className="font-bold text-sm text-gray-900">{title}</h4>
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed flex-1">{description}</p>

      {/* Result banner */}
      {result && !running && (
        <div className={`rounded-xl p-3 text-xs space-y-1 ${result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {result.success ? (
            <>
              <div className="flex items-center gap-1 font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t ? 'İçeri aktarma tamamlandı' : 'Import complete'}
              </div>
              <div className="flex gap-4 text-[11px] mt-1">
                <span>🆕 {t ? 'Oluşturuldu' : 'Created'}: <b>{result.created}</b></span>
                <span>🔄 {t ? 'Güncellendi' : 'Updated'}: <b>{result.updated}</b></span>
                {result.errors > 0 && <span>⚠️ {t ? 'Hata' : 'Errors'}: <b>{result.errors}</b></span>}
                {result.duration && <span>⏱ {Math.round(result.duration / 1000)}s</span>}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" />
              <span className="font-bold">{t ? 'Hata: ' : 'Error: '}</span>
              {error}
            </div>
          )}
        </div>
      )}

      {error && !result && !running && (
        <div className="rounded-xl p-3 bg-red-50 text-red-600 text-xs flex items-center gap-1">
          <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <button
        onClick={onImport}
        disabled={running || disabled}
        className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-white text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${buttonColor}`}
      >
        {running ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            {t ? 'Aktarılıyor...' : 'Importing...'}
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            {buttonLabel}
          </>
        )}
      </button>

      {disabled && !running && (
        <p className="text-[10px] text-center text-gray-400">
          {t ? 'Mikro bağlantısı gerekli' : 'Mikro connection required'}
        </p>
      )}
    </div>
  );
}

// ── PullCard sub-component ────────────────────────────────────────────────────

interface PullCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  state: PullState;
  disabled: boolean;
  onPull: () => void;
  lang: boolean;
}

function PullCard({ icon, title, description, state, disabled, onPull, lang: t }: PullCardProps) {
  return (
    <div className="border border-gray-100 rounded-xl p-4 space-y-3 flex flex-col">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 bg-gray-50 rounded-lg flex items-center justify-center">
          {icon}
        </div>
        <h5 className="font-bold text-xs text-gray-800">{title}</h5>
      </div>
      <p className="text-[11px] text-gray-400 flex-1">{description}</p>

      {state.result && !state.running && (
        <div className="rounded-lg p-2 bg-green-50 text-green-700 text-[11px] flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3 flex-shrink-0" /> {state.result}
        </div>
      )}
      {state.error && !state.running && (
        <div className="rounded-lg p-2 bg-red-50 text-red-600 text-[11px] flex items-center gap-1.5">
          <XCircle className="w-3 h-3 flex-shrink-0" /> {state.error}
        </div>
      )}

      <button
        onClick={onPull}
        disabled={state.running || disabled}
        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#1a3a5c] hover:bg-[#1a3a5c]/90 text-white text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {state.running
          ? <><RefreshCw className="w-3.5 h-3.5 animate-spin"/>{t ? 'Çekiliyor…' : 'Pulling…'}</>
          : <><Download className="w-3.5 h-3.5"/>{t ? 'Çek' : 'Pull'}</>}
      </button>
    </div>
  );
}
