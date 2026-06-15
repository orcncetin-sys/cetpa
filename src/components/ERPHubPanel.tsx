/**
 * ERPHubPanel.tsx — Unified ERP integration hub
 *
 * Displays all supported ERPs as selectable cards.
 * Only one ERP can be active at a time (settings/erpHub doc: { activeErp: ErpId }).
 * Backward-compatible: also mirrors toggle state to settings/mikro and settings/luca
 * so existing App.tsx listeners keep working.
 *
 * Adding a new ERP:
 *  1. Add entry to SUPPORTED_ERPS in types/erp.ts
 *  2. Create src/components/erp/<ErpId>SyncPanel.tsx
 *  3. Add a lazy import below and an entry in PANEL_MAP
 */

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  ExternalLink, KeyRound, Eye, EyeOff, Save,
} from 'lucide-react';
import {
  doc, onSnapshot, setDoc, getDoc,
} from '../lib/dbClient';
import { db } from '../firebase';
import { SUPPORTED_ERPS, type ErpId, type ErpInfo, type ErpStatusResult } from '../types/erp';

// ── Lazy-load each ERP panel ──────────────────────────────────────────────────
// (only the active ERP's bundle is fetched)

const MikroSyncPanel    = React.lazy(() => import('./MikroSyncPanel'));
const ParasutSyncPanel  = React.lazy(() => import('./erp/ParasutSyncPanel'));
const LucaSyncPanel     = React.lazy(() => import('./LucaSyncPanel'));
const LogoSyncPanel     = React.lazy(() => import('./erp/LogoSyncPanel'));
const DynamicsSyncPanel = React.lazy(() => import('./erp/DynamicsSyncPanel'));
const SAPSyncPanel      = React.lazy(() => import('./erp/SAPSyncPanel'));

const PANEL_MAP: Record<ErpId, React.ComponentType<{ lang?: string; currentLanguage?: string }>> = {
  mikro:        MikroSyncPanel,
  parasut:      ParasutSyncPanel,
  luca:         LucaSyncPanel,
  logo:         LogoSyncPanel,
  dynamics365:  DynamicsSyncPanel,
  sap:          SAPSyncPanel,
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface HubDoc {
  activeErp?: ErpId;
}

interface StatusCache {
  [erpId: string]: ErpStatusResult & { fetching?: boolean };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert ENV_VAR_NAME → envVarName (camelCase Firestore field key) */
function envToField(envVar: string): string {
  return envVar.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Human-readable label from ENV_VAR_NAME */
function envToLabel(envVar: string): string {
  return envVar
    .replace(/^(MIKRO_|LUCA_|LOGO_|SAP_|DYNAMICS_)/, '')
    .split('_')
    .map(w => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

const SECRET_PATTERN = /PASSWORD|SECRET|KEY|TOKEN/i;

// ── ErpCredentialsEditor ──────────────────────────────────────────────────────

interface CredsEditorProps {
  erp: ErpInfo;
  lang: boolean;
  connected?: boolean;
  onSaved?: () => void;
}

function ErpCredentialsEditor({ erp, lang, connected, onSaved }: CredsEditorProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'settings', erp.id)).then(snap => {
      if (!snap.exists()) return;
      const data = snap.data() as Record<string, unknown>;
      const loaded: Record<string, string> = {};
      erp.requiredEnvVars.forEach(v => {
        const field = envToField(v);
        loaded[v] = (data[field] as string) ?? '';
      });
      setValues(loaded);
    });
  }, [erp]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const firestoreFields: Record<string, string> = {};
      erp.requiredEnvVars.forEach(v => { firestoreFields[envToField(v)] = values[v] ?? ''; });
      await setDoc(doc(db, 'settings', erp.id), { ...firestoreFields, updatedAt: new Date().toISOString() }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [erp, values, onSaved]);

  const hasFirestoreValues = erp.requiredEnvVars.some(v => values[v]);
  const showConfigured = connected && !hasFirestoreValues && !editing;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
          {lang ? 'Bağlantı Bilgileri' : 'Credentials'}
        </span>
      </div>

      {showConfigured ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-emerald-700">{lang ? 'Sunucu ortam değişkenlerinden yapılandırıldı' : 'Configured via server environment variables'}</p>
            <p className="text-[11px] text-emerald-600 mt-0.5">{lang ? 'Kimlik bilgileri .env dosyasında güvenli şekilde saklanıyor.' : 'Credentials are securely stored in the .env file.'}</p>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-[11px] font-bold text-emerald-700 border border-emerald-300 rounded-lg px-3 py-1.5 hover:bg-emerald-100 transition-colors shrink-0"
          >
            {lang ? 'Üstüne Yaz' : 'Override'}
          </button>
        </div>
      ) : (
      <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {erp.requiredEnvVars.map(envVar => {
          const isSecret = SECRET_PATTERN.test(envVar);
          const showPlain = revealed[envVar];
          return (
            <div key={envVar} className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{envToLabel(envVar)}</label>
              <div className="relative">
                <input
                  type={isSecret && !showPlain ? 'password' : 'text'}
                  value={values[envVar] ?? ''}
                  onChange={e => setValues(prev => ({ ...prev, [envVar]: e.target.value }))}
                  placeholder={envVar}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/20 pr-8"
                />
                {isSecret && (
                  <button
                    type="button"
                    onClick={() => setRevealed(prev => ({ ...prev, [envVar]: !showPlain }))}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPlain ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 bg-brand text-white text-xs font-bold px-4 py-2 rounded-full hover:bg-brand/90 transition-colors disabled:opacity-50"
        >
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {lang ? 'Kaydet' : 'Save'}
        </button>
        {editing && (
          <button onClick={() => setEditing(false)} className="text-[11px] text-gray-400 hover:text-gray-600">
            {lang ? 'İptal' : 'Cancel'}
          </button>
        )}
        {saved && (
          <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {lang ? 'Kaydedildi' : 'Saved'}
          </span>
        )}
        <span className="text-[10px] text-gray-400 ml-auto">
          {lang ? 'Bilgiler güvenli olarak saklanır.' : 'Credentials stored securely.'}
        </span>
      </div>
      </>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ERPHubPanel({ currentLanguage = 'tr' }: { currentLanguage?: string }) {
  const t = currentLanguage === 'tr';

  const [activeErp,   setActiveErpState] = useState<ErpId | null>(null);
  const [expanded,    setExpanded]       = useState<ErpId | null>(null);
  const [statusCache, setStatusCache]    = useState<StatusCache>({});
  const [saving,      setSaving]         = useState(false);

  // ── Subscribe to active ERP setting ─────────────────────────────────────────

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'erpHub'), snap => {
      const data = snap.data() as HubDoc | undefined;
      if (data?.activeErp) {
        setActiveErpState(data.activeErp);
        setExpanded(data.activeErp);
      }
    });
    return unsub;
  }, []);

  // ── Fetch connection status for all ERPs on mount ────────────────────────────

  useEffect(() => {
    SUPPORTED_ERPS.forEach(erp => {
      setStatusCache(prev => ({ ...prev, [erp.id]: { configured: false, connected: false, fetching: true } }));
      fetch(erp.statusPath)
        .then(r => r.json())
        .then((d: ErpStatusResult) => setStatusCache(prev => ({ ...prev, [erp.id]: { ...d, fetching: false } })))
        .catch(() => setStatusCache(prev => ({
          ...prev,
          [erp.id]: { configured: false, connected: false, fetching: false },
        })));
    });
  }, []);

  // ── Activate ERP ─────────────────────────────────────────────────────────────

  async function activateErp(erpId: ErpId) {
    if (saving) return;
    setSaving(true);
    try {
      // Write to erpHub (new architecture)
      await setDoc(doc(db, 'settings', 'erpHub'), { activeErp: erpId }, { merge: true });

      // Karşılıklı dışlama: aktif ERP dışındakiler kapanır (Mikro ↔ Paraşüt dahil)
      await setDoc(doc(db, 'settings', 'mikro'),   { enabled: erpId === 'mikro'   }, { merge: true });
      await setDoc(doc(db, 'settings', 'parasut'), { enabled: erpId === 'parasut' }, { merge: true });
      await setDoc(doc(db, 'settings', 'luca'),    { enabled: erpId === 'luca'    }, { merge: true });

      setActiveErpState(erpId);
      setExpanded(erpId);
    } finally {
      setSaving(false);
    }
  }

  async function deactivateErp() {
    if (saving) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'erpHub'), { activeErp: null }, { merge: true });
      await setDoc(doc(db, 'settings', 'mikro'),   { enabled: false }, { merge: true });
      await setDoc(doc(db, 'settings', 'parasut'), { enabled: false }, { merge: true });
      await setDoc(doc(db, 'settings', 'luca'),    { enabled: false }, { merge: true });
      setActiveErpState(null);
      setExpanded(null);
    } finally {
      setSaving(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">

      {/* Active status bar */}
      {activeErp && (
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-bold text-emerald-800">
              {SUPPORTED_ERPS.find(e => e.id === activeErp)?.displayName ?? activeErp}
              &nbsp;
              <span className="font-normal text-emerald-600">
                {t ? 'aktif ERP entegrasyonu' : 'is the active ERP integration'}
              </span>
            </span>
          </div>
          <button
            onClick={() => void deactivateErp()}
            disabled={saving}
            className="text-[11px] font-bold text-emerald-600 hover:text-emerald-800 transition-colors disabled:opacity-50"
          >
            {t ? 'Devre Dışı Bırak' : 'Disable'}
          </button>
        </div>
      )}

      {/* ERP cards */}
      {SUPPORTED_ERPS.map(erp => (
        <ErpCard
          key={erp.id}
          erp={erp}
          isActive={activeErp === erp.id}
          isExpanded={expanded === erp.id}
          status={statusCache[erp.id]}
          saving={saving}
          lang={currentLanguage}
          onToggleExpand={() => setExpanded(prev => prev === erp.id ? null : erp.id)}
          onActivate={() => void activateErp(erp.id)}
        />
      ))}

      {/* Footer note */}
      <p className="text-[10px] text-center text-gray-400 pt-1">
        {t
          ? 'Firebase her zaman gerçek veri kaynağıdır. ERP entegrasyonu veriyi senkronize eder, silmez.'
          : 'Firebase is always the source of truth. ERP integration syncs data, never deletes it.'}
      </p>
    </div>
  );
}

// ── ErpCard ───────────────────────────────────────────────────────────────────

interface ErpCardProps {
  erp:          ErpInfo;
  isActive:     boolean;
  isExpanded:   boolean;
  status?:      ErpStatusResult & { fetching?: boolean };
  saving:       boolean;
  lang:         string;
  onToggleExpand: () => void;
  onActivate:   () => void;
}

function ErpCard({
  erp, isActive, isExpanded, status, saving, lang,
  onToggleExpand, onActivate,
}: ErpCardProps) {
  const t = lang === 'tr';
  const Panel = PANEL_MAP[erp.id];
  const [credTab, setCredTab] = useState<'creds' | 'sync'>('creds');

  return (
    <div className={`bg-white rounded-2xl border transition-all overflow-hidden ${
      isActive ? 'border-emerald-200 shadow-sm' : 'border-gray-100'
    }`}>

      {/* Card header */}
      <div className="flex items-center gap-4 p-4">

        {/* Logo / emoji */}
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: erp.brandColor + '15' }}
        >
          {erp.logoEmoji}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-sm text-gray-900 leading-tight">{erp.displayName}</p>
            {isActive && (
              <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                {t ? 'Aktif' : 'Active'}
              </span>
            )}
            {erp.comingSoon && (
              <span className="text-[10px] font-bold bg-indigo-50 text-indigo-500 px-2 py-0.5 rounded-full">
                {t ? '🚧 Yakında' : '🚧 Coming Soon'}
              </span>
            )}
            {status?.fetching === false && (
              <>
                {status.connected
                  ? <span className="text-[10px] font-bold bg-green-50 text-green-600 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                      <CheckCircle2 className="w-2.5 h-2.5" />{t ? 'Bağlı' : 'Connected'}
                    </span>
                  : status.configured
                    ? <span className="text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                        <XCircle className="w-2.5 h-2.5" />{t ? 'Bağlanamadı' : 'No connection'}
                      </span>
                    : <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                        {t ? 'Yapılandırılmamış' : 'Not configured'}
                      </span>
                }
              </>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5 truncate">
            {t ? erp.descTr : erp.descEn}
          </p>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <FeatureChips features={erp.features} lang={t} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {erp.docsUrl && (
            <a
              href={erp.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              title={t ? 'API Belgelerine Git' : 'Go to API Docs'}
            >
              <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
            </a>
          )}

          {/* Activate toggle */}
          <button
            onClick={isActive || erp.comingSoon ? undefined : onActivate}
            disabled={saving || isActive || erp.comingSoon}
            title={erp.comingSoon ? (t ? 'Sunucu adaptörü henüz hazır değil' : 'Server adapter not ready yet') : isActive ? (t ? 'Zaten aktif' : 'Already active') : (t ? 'Bu ERP\'yi aktifleştir' : 'Activate this ERP')}
            className={`relative w-10 h-5 rounded-full transition-all flex-shrink-0 ${
              isActive ? 'bg-emerald-400 cursor-default' : 'bg-gray-200 hover:bg-gray-300 cursor-pointer'
            } disabled:opacity-50`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isActive ? 'translate-x-5' : ''}`} />
          </button>

          {/* Expand / collapse */}
          <button
            onClick={onToggleExpand}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {isExpanded
              ? <ChevronUp   className="w-4 h-4 text-gray-400" />
              : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
        </div>
      </div>

      {/* Required env vars hint (collapsed) */}
      {!isExpanded && !status?.configured && (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-1.5 text-[10px] text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-amber-100 transition-colors" onClick={onToggleExpand}>
            <KeyRound className="w-3 h-3 flex-shrink-0" />
            <span>{t ? 'Bağlantı bilgilerini girmek için tıklayın' : 'Click to enter credentials'}</span>
          </div>
        </div>
      )}

      {/* Expanded: tabs — Credentials | Sync */}
      {isExpanded && (
        <div className="border-t border-gray-100">
          {/* Tab bar */}
          <div className="flex border-b border-gray-100 px-4 pt-3 gap-4">
            <button
              onClick={() => setCredTab('creds')}
              className={`text-xs font-bold pb-2.5 border-b-2 transition-colors ${credTab === 'creds' ? 'border-brand text-brand' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
              <span className="flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" />{t ? 'Bağlantı Bilgileri' : 'Credentials'}</span>
            </button>
            <button
              onClick={() => setCredTab('sync')}
              className={`text-xs font-bold pb-2.5 border-b-2 transition-colors ${credTab === 'sync' ? 'border-brand text-brand' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
              <span className="flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" />{t ? 'Senkronizasyon' : 'Sync'}</span>
            </button>
          </div>

          <div className="p-4">
            {credTab === 'creds' ? (
              <ErpCredentialsEditor erp={erp} lang={t} connected={status?.connected} />
            ) : (
              <Suspense fallback={
                <div className="flex items-center justify-center gap-2 py-8 text-gray-400 text-sm">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  {t ? 'Panel yükleniyor…' : 'Loading panel…'}
                </div>
              }>
                <Panel lang={lang} currentLanguage={lang} />
              </Suspense>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Feature chip strip ────────────────────────────────────────────────────────

const FEATURE_LABELS: Record<string, { tr: string; en: string; color: string }> = {
  import_stok:    { tr: 'Stok ←',    en: 'Stock ←',    color: 'bg-blue-50 text-blue-600' },
  export_stok:    { tr: 'Stok →',    en: 'Stock →',    color: 'bg-blue-100 text-blue-700' },
  import_cari:    { tr: 'Cari ←',    en: 'Customers ←',color: 'bg-purple-50 text-purple-600' },
  export_cari:    { tr: 'Cari →',    en: 'Customers →',color: 'bg-purple-100 text-purple-700' },
  export_siparis: { tr: 'Sipariş →', en: 'Orders →',   color: 'bg-orange-50 text-orange-600' },
  export_fatura:  { tr: 'Fatura →',  en: 'Invoice →',  color: 'bg-amber-50 text-amber-600' },
  pull_bakiye:    { tr: 'Bakiye ←',  en: 'Balance ←',  color: 'bg-green-50 text-green-600' },
  pull_mizan:     { tr: 'Mizan ←',   en: 'Trial Bal ←',color: 'bg-teal-50 text-teal-600' },
  pull_kdv:       { tr: 'KDV ←',     en: 'VAT ←',      color: 'bg-red-50 text-red-600' },
};

function FeatureChips({ features, lang }: { features: string[]; lang: boolean }) {
  return (
    <>
      {features.map(f => {
        const lbl = FEATURE_LABELS[f];
        if (!lbl) return null;
        return (
          <span key={f} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${lbl.color}`}>
            {lang ? lbl.tr : lbl.en}
          </span>
        );
      })}
    </>
  );
}
