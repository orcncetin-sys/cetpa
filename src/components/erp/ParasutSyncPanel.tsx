/**
 * ParasutSyncPanel.tsx — Paraşüt entegrasyon paneli (Mikro alternatifi)
 *
 * Sunucu rotaları:
 *   GET  /api/parasut/status        → ErpStatusResult
 *   POST /api/parasut/import/cari   → { created, updated, total }
 *   POST /api/parasut/import/stok   → { created, updated, total }  (fiyat dahil)
 *   POST /api/parasut/fatura        { order } → { success }
 *
 * Gerekli sunucu env: PARASUT_CLIENT_ID/SECRET, PARASUT_USERNAME/PASSWORD,
 * PARASUT_COMPANY_ID. Mikro V16'nın aksine ürün fiyatını + cari bakiyeyi verir.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Package, Users, Loader2 } from 'lucide-react';
import { authFetch } from '../../services/authFetch';
import type { ErpStatusResult } from '../../types/erp';

interface ImportState { running: boolean; result: { created: number; updated: number; total: number } | null; error: string | null; }

export default function ParasutSyncPanel({ currentLanguage }: { lang?: string; currentLanguage?: string }) {
  const tr = currentLanguage !== 'en';
  const [status, setStatus] = useState<ErpStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [cari, setCari] = useState<ImportState>({ running: false, result: null, error: null });
  const [stok, setStok] = useState<ImportState>({ running: false, result: null, error: null });

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch('/api/parasut/status');
      setStatus(await r.json() as ErpStatusResult);
    } catch { setStatus({ configured: false, connected: false, error: tr ? 'Durum alınamadı' : 'Status failed' }); }
    setLoading(false);
  }, [tr]);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  const runImport = async (endpoint: string, set: React.Dispatch<React.SetStateAction<ImportState>>) => {
    set({ running: true, result: null, error: null });
    try {
      const r = await authFetch(endpoint, { method: 'POST' });
      const j = await r.json();
      if (j.success) set({ running: false, result: { created: j.created, updated: j.updated, total: j.total }, error: null });
      else set({ running: false, result: null, error: j.error || (tr ? 'İçe aktarma başarısız' : 'Import failed') });
    } catch (e) { set({ running: false, result: null, error: (e as Error).message }); }
  };

  const ImportCard = ({ icon: Icon, title, desc, state, onRun }: {
    icon: typeof Package; title: string; desc: string; state: ImportState; onRun: () => void;
  }) => (
    <div className="border border-gray-100 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-brand" />
        <div><p className="text-sm font-bold text-gray-900">{title}</p><p className="text-[11px] text-gray-400">{desc}</p></div>
      </div>
      <button onClick={onRun} disabled={state.running || !status?.connected}
        className="apple-button-primary text-xs w-full justify-center disabled:opacity-50">
        {state.running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        {tr ? 'İçe Aktar' : 'Import'}
      </button>
      {state.result && (
        <p className="text-[11px] text-emerald-600 font-medium">
          ✓ {state.result.created} {tr ? 'yeni' : 'new'}, {state.result.updated} {tr ? 'güncel' : 'updated'} ({state.result.total} {tr ? 'toplam' : 'total'})
        </p>
      )}
      {state.error && <p className="text-[11px] text-red-600">{state.error}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Bağlantı durumu */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status?.connected ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-gray-400" />}
          <span className="text-xs font-semibold text-gray-700">
            {!status ? (tr ? 'Kontrol ediliyor…' : 'Checking…')
              : status.connected ? (tr ? 'Paraşüt bağlı' : 'Paraşüt connected')
              : status.configured ? (tr ? 'Bağlantı hatası' : 'Connection error')
              : (tr ? 'Yapılandırılmamış' : 'Not configured')}
          </span>
        </div>
        <button onClick={() => void fetchStatus()} disabled={loading} className="text-[11px] text-brand font-bold hover:underline">
          {tr ? 'Yenile' : 'Refresh'}
        </button>
      </div>
      {status && !status.configured && (
        <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          {tr
            ? 'Sunucu env değişkenlerini ayarlayın: PARASUT_CLIENT_ID, PARASUT_CLIENT_SECRET, PARASUT_USERNAME, PARASUT_PASSWORD, PARASUT_COMPANY_ID.'
            : 'Set server env vars: PARASUT_CLIENT_ID, PARASUT_CLIENT_SECRET, PARASUT_USERNAME, PARASUT_PASSWORD, PARASUT_COMPANY_ID.'}
        </p>
      )}
      {status?.error && <p className="text-[11px] text-red-600">{status.error}</p>}

      {/* İçe aktarma kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ImportCard icon={Users} title={tr ? 'Cariler' : 'Contacts'}
          desc={tr ? 'Müşteri/tedarikçi + bakiye' : 'Customers/suppliers + balance'}
          state={cari} onRun={() => void runImport('/api/parasut/import/cari', setCari)} />
        <ImportCard icon={Package} title={tr ? 'Ürünler' : 'Products'}
          desc={tr ? 'Stok + fiyat (Mikro V16\'da yok!)' : 'Stock + price (absent in Mikro V16!)'}
          state={stok} onRun={() => void runImport('/api/parasut/import/stok', setStok)} />
      </div>

      <p className="text-[10px] text-gray-400">
        {tr
          ? 'Paraşüt ürün fiyatlarını ve cari bakiyeleri API\'den verir — Mikro V16\'nın çözemediği eksiği kapatır.'
          : 'Paraşüt exposes product prices and contact balances via API — fills the gap Mikro V16 cannot.'}
      </p>
    </div>
  );
}
