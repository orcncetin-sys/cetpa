/**
 * MarketplacePanel.tsx
 *
 * Trendyol + Hepsiburada integration panel.
 * Credentials stored in Firestore settings/trendyol & settings/hepsiburada.
 * Orders pulled into Firebase orders collection (same collection as Shopify/manual orders).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, CheckCircle2, XCircle, ShoppingBag, Package,
  AlertCircle, Settings, ChevronDown, ChevronUp,
} from 'lucide-react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MarketplaceStatus {
  configured: boolean;
  connected: boolean;
  message?: string;
  error?: string;
}

interface SyncResult {
  success: boolean;
  total?: number;
  created?: number;
  updated?: number;
  duration?: number;
  error?: string;
  notConfigured?: boolean;
}

interface SyncState {
  running: boolean;
  result: SyncResult | null;
}

interface TrendyolSettings {
  supplierId?: string;
  apiKey?: string;
  apiSecret?: string;
  enabled?: boolean;
}

interface HBSettings {
  merchantId?: string;
  username?: string;
  password?: string;
  enabled?: boolean;
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

// ── Credential row ────────────────────────────────────────────────────────────

function CredentialField({
  label, value, placeholder, isSecret, onChange,
}: {
  label: string; value: string; placeholder: string; isSecret: boolean;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-0.5">
      <label className="text-[10px] font-bold text-gray-500 uppercase">{label}</label>
      <div className="relative">
        <input
          type={isSecret && !show ? 'password' : 'text'}
          defaultValue={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value.trim())}
          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/10 transition-all font-mono pr-8"
        />
        {isSecret && (
          <button
            type="button"
            onClick={() => setShow(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-[10px]"
          >
            {show ? '🙈' : '👁'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Single marketplace card ───────────────────────────────────────────────────

interface MarketplaceCardProps {
  name: string;
  logo: React.ReactNode;
  color: string;
  settingsDoc: string;
  statusEndpoint: string;
  syncEndpoint: string;
  fields: { key: string; label: string; placeholder: string; isSecret: boolean }[];
  currentSettings: Record<string, string>;
  lang: string;
}

function MarketplaceCard({
  name, logo, color, settingsDoc, statusEndpoint, syncEndpoint,
  fields, currentSettings, lang,
}: MarketplaceCardProps) {
  const t = lang === 'tr';
  const [status, setStatus] = useState<MarketplaceStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [sync, setSync] = useState<SyncState>({ running: false, result: null });
  const [showCreds, setShowCreds] = useState(false);
  const [localSettings, setLocalSettings] = useState<Record<string, string>>(currentSettings);

  // Update local when parent settings load
  useEffect(() => { setLocalSettings(currentSettings); }, [currentSettings]);

  const checkStatus = useCallback(async () => {
    setCheckingStatus(true);
    try {
      const r = await fetch(statusEndpoint);
      const d = await r.json() as MarketplaceStatus;
      setStatus(d);
    } catch {
      setStatus({ configured: false, connected: false, error: 'Bağlantı hatası' });
    } finally { setCheckingStatus(false); }
  }, [statusEndpoint]);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const handleSync = async () => {
    setSync({ running: true, result: null });
    try {
      const r = await fetch(syncEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ daysBack: 7 }) });
      const d = await r.json() as SyncResult;
      setSync({ running: false, result: d });
      if (d.success) checkStatus();
    } catch (e) {
      setSync({ running: false, result: { success: false, error: e instanceof Error ? e.message : String(e) } });
    }
  };

  const handleFieldChange = (key: string, val: string) => {
    const updated = { ...localSettings, [key]: val };
    setLocalSettings(updated);
    setDoc(doc(db, 'settings', settingsDoc), { [key]: val }, { merge: true });
  };

  const isConfigured = fields.every(f => localSettings[f.key]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center`}>
          {logo}
        </div>
        <div className="flex-1">
          <h4 className="font-bold text-sm text-gray-900">{name}</h4>
          <p className="text-[11px] text-gray-400">
            {t ? 'Sipariş & stok senkronizasyonu' : 'Order & stock synchronisation'}
          </p>
        </div>
        {status && (
          <div className="flex gap-1.5 flex-wrap justify-end">
            <StatusBadge ok={status.configured} label={t ? 'Yapılandırıldı' : 'Configured'} />
            <StatusBadge ok={status.connected}  label={t ? 'Bağlı' : 'Connected'} />
          </div>
        )}
      </div>

      {/* Status error */}
      {status?.error && (
        <div className="text-[11px] text-red-500 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />{status.error}
        </div>
      )}

      {/* Sync result */}
      {sync.result && !sync.running && (
        <div className={`rounded-xl p-3 text-xs ${sync.result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {sync.result.success ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1 font-bold"><CheckCircle2 className="w-3.5 h-3.5" />{t ? 'Senkronizasyon tamamlandı' : 'Sync complete'}</div>
              <div className="flex gap-3 text-[11px] flex-wrap">
                <span>📦 {t ? 'Toplam' : 'Total'}: <b>{sync.result.total ?? 0}</b></span>
                <span>🆕 {t ? 'Oluşturuldu' : 'Created'}: <b>{sync.result.created ?? 0}</b></span>
                <span>🔄 {t ? 'Güncellendi' : 'Updated'}: <b>{sync.result.updated ?? 0}</b></span>
                {sync.result.duration && <span>⏱ {Math.round(sync.result.duration / 1000)}s</span>}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {sync.result.notConfigured
                ? (t ? 'Kimlik bilgileri eksik. Aşağıdan girin.' : 'Credentials missing. Enter them below.')
                : sync.result.error}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={checkStatus}
          disabled={checkingStatus}
          className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-bold transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${checkingStatus ? 'animate-spin' : ''}`} />
          {t ? 'Durumu Kontrol Et' : 'Check Status'}
        </button>
        <button
          onClick={handleSync}
          disabled={sync.running || !status?.connected}
          className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sync.running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
          {sync.running ? (t ? 'Aktarılıyor…' : 'Syncing…') : (t ? 'Siparişleri Çek (7g)' : 'Pull Orders (7d)')}
        </button>
      </div>

      {!isConfigured && !showCreds && (
        <p className="text-[10px] text-center text-amber-600 font-medium">
          {t ? '⚠️ Kimlik bilgileri eksik — ayarları görmek için aşağıya tıklayın.' : '⚠️ Credentials missing — click below to configure.'}
        </p>
      )}

      {/* Credentials accordion */}
      <button
        onClick={() => setShowCreds(v => !v)}
        className="w-full flex items-center justify-between text-[11px] text-gray-400 hover:text-gray-600 transition-colors pt-1 border-t border-gray-100"
      >
        <span className="flex items-center gap-1"><Settings className="w-3 h-3" />{t ? 'API Kimlik Bilgileri' : 'API Credentials'}</span>
        {showCreds ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {showCreds && (
        <div className="space-y-3 pt-1">
          {fields.map(f => (
            <CredentialField
              key={f.key}
              label={f.label}
              value={localSettings[f.key] ?? ''}
              placeholder={f.placeholder}
              isSecret={f.isSecret}
              onChange={v => handleFieldChange(f.key, v)}
            />
          ))}
          <p className="text-[10px] text-gray-400">
            {t ? '* Değerler otomatik kaydedilir. Kayıt sonrası "Durumu Kontrol Et"e basın.' : '* Values auto-saved. Press "Check Status" after saving.'}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────

interface MarketplacePanelProps {
  currentLanguage?: string;
}

export default function MarketplacePanel({ currentLanguage = 'tr' }: MarketplacePanelProps) {
  const t = currentLanguage === 'tr';
  const [trendyolSettings, setTrendyolSettings] = useState<TrendyolSettings>({});
  const [hbSettings, setHbSettings]             = useState<HBSettings>({});

  // Live-load credentials from Firestore
  useEffect(() => {
    const unsubTY = onSnapshot(doc(db, 'settings', 'trendyol'),   snap => { if (snap.exists()) setTrendyolSettings(snap.data() as TrendyolSettings); });
    const unsubHB = onSnapshot(doc(db, 'settings', 'hepsiburada'), snap => { if (snap.exists()) setHbSettings(snap.data() as HBSettings); });
    return () => { unsubTY(); unsubHB(); };
  }, []);

  return (
    <div className="space-y-4">
      <div className="p-3 bg-orange-50 rounded-xl text-xs text-orange-700 font-medium">
        📦 {t
          ? 'Trendyol ve Hepsiburada siparişleri otomatik olarak Firebase\'e aktarılır ve diğer siparişlerle birlikte yönetilir.'
          : 'Trendyol and Hepsiburada orders are imported into Firebase and managed alongside other orders.'}
      </div>

      {/* Trendyol */}
      <MarketplaceCard
        name="Trendyol"
        logo={<ShoppingBag className="w-5 h-5 text-orange-500" />}
        color="bg-orange-50"
        settingsDoc="trendyol"
        statusEndpoint="/api/trendyol/status"
        syncEndpoint="/api/trendyol/sync"
        currentSettings={{
          supplierId: trendyolSettings.supplierId ?? '',
          apiKey:     trendyolSettings.apiKey     ?? '',
          apiSecret:  trendyolSettings.apiSecret  ?? '',
        }}
        fields={[
          { key: 'supplierId', label: t ? 'Satıcı ID'  : 'Supplier ID',  placeholder: '123456',      isSecret: false },
          { key: 'apiKey',     label: 'API Key',                          placeholder: 'api-key…',    isSecret: true  },
          { key: 'apiSecret',  label: 'API Secret',                       placeholder: 'api-secret…', isSecret: true  },
        ]}
        lang={currentLanguage}
      />

      {/* Hepsiburada */}
      <MarketplaceCard
        name="Hepsiburada"
        logo={<ShoppingBag className="w-5 h-5 text-red-500" />}
        color="bg-red-50"
        settingsDoc="hepsiburada"
        statusEndpoint="/api/hepsiburada/status"
        syncEndpoint="/api/hepsiburada/sync"
        currentSettings={{
          merchantId: hbSettings.merchantId ?? '',
          username:   hbSettings.username   ?? '',
          password:   hbSettings.password   ?? '',
        }}
        fields={[
          { key: 'merchantId', label: t ? 'Satıcı ID' : 'Merchant ID', placeholder: 'HB-MERCHANT-ID', isSecret: false },
          { key: 'username',   label: t ? 'Kullanıcı Adı' : 'Username', placeholder: 'username',       isSecret: false },
          { key: 'password',   label: t ? 'Şifre / API Key' : 'Password / API Key', placeholder: '…', isSecret: true  },
        ]}
        lang={currentLanguage}
      />

      <p className="text-[10px] text-gray-400 text-center px-2">
        {t
          ? 'Siparişler son 7 günden çekilir. Her sipariş Firebase\'deki orders koleksiyonuna yazılır ve Sipariş Yönetimi ekranında görünür.'
          : 'Orders are pulled from the last 7 days. Each order is written to the Firebase orders collection and appears in the Order Management screen.'}
      </p>
    </div>
  );
}
