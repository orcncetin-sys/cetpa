import React, { useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  Activity, Bell, CreditCard, Globe, Link, Lock, Mail,
  MessageSquare, RefreshCw, Shield, ShoppingBag, Users, X,
} from 'lucide-react';
import { db, auth } from '../firebase';
import {
  doc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, serverTimestamp, Timestamp,
} from '../lib/dbClient';
import { authFetch } from '../services/authFetch';
import { logFirestoreError as handleFirestoreError, OperationType } from '../utils/firebase';
import ModuleHeader from '../components/ModuleHeader';
import SubscriptionPanel from '../components/SubscriptionPanel';
import ERPHubPanel from '../components/ERPHubPanel';
import IntegrationHealthPanel from '../components/IntegrationHealthPanel';
import SkuMappingPanel from '../components/SkuMappingPanel';
import MarketplacePanel from '../components/MarketplacePanel';
import type { UserSubscription, SubscriptionPlan, BillingCycle } from '../types/subscription';

type ClassValue = string | null | undefined | boolean | ClassValue[];
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

type WebhookConfig = { id: string; url: string; events: string[]; enabled: boolean; createdAt?: unknown };
const WEBHOOK_EVENTS = ['order.created', 'order.updated', 'payment.received', 'lead.created', 'inventory.low'];

type PaymentHistoryItem = { id: string; date: string; amount: number; plan: string; planName?: Record<string, string>; cycle: string; status: 'paid' | 'pending' | 'failed' };

interface Props {
  currentLanguage: 'tr' | 'en';
  userRole: string;
  user: { email?: string | null; uid?: string; providerData?: { providerId: string }[] } | null;
  isOwnerAdmin: boolean;
  exchangeRates: Record<string, number> | null;
  setExchangeRates: (rates: Record<string, number>) => void;
  userSubscription: UserSubscription | null;
  paymentHistory: PaymentHistoryItem[];
  companySettings: Record<string, unknown>;
  setCompanySettings: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  geminiApiKeySetting: string;
  setGeminiApiKeySetting: (val: string) => void;
  notifPrefs: Record<string, boolean>;
  toggleNotifPref: (key: string) => void;
  auditLogs: Record<string, unknown>[];
  webhookConfigs: WebhookConfig[];
  toast: (msg: string, type?: string) => void;
  logAuditAction: (action: string, details: string) => Promise<void>;
  handleSelectPlan: (plan: SubscriptionPlan, cycle: BillingCycle) => void;
  handleCancelSubscription: () => void;
  setShowPricingPage: (show: boolean) => void;
}

export default function SettingsPage({
  currentLanguage, userRole, user, isOwnerAdmin,
  exchangeRates, setExchangeRates,
  userSubscription, paymentHistory,
  companySettings, setCompanySettings,
  geminiApiKeySetting, setGeminiApiKeySetting,
  notifPrefs, toggleNotifPref,
  auditLogs, webhookConfigs,
  toast, logAuditAction,
  handleSelectPlan, handleCancelSubscription, setShowPricingPage,
}: Props) {
  const [savingGeminiKey, setSavingGeminiKey] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [p641Entity, setP641Entity] = useState<'all' | 'orders' | 'inventory' | 'leads' | 'muhasebe'>('all');
  const [webhookDraft, setWebhookDraft] = useState({ url: '', events: [] as string[] });
  const [webhookTestLoading, setWebhookTestLoading] = useState<string | null>(null);
  const [webhookSaving, setWebhookSaving] = useState(false);

  return (
    <>
      {/* ─── Subscription Management ─── */}
      <SubscriptionPanel
        currentLanguage={currentLanguage}
        subscription={userSubscription}
        paymentHistory={paymentHistory}
        onChangePlan={handleSelectPlan}
        onCancelSubscription={handleCancelSubscription}
        onViewPricing={() => setShowPricingPage(true)}
      />

      <hr className="border-gray-100" />

      <ModuleHeader
        title={currentLanguage === 'tr' ? 'Entegrasyonlar' : 'Integrations'}
        subtitle={currentLanguage === 'tr' ? 'ERP, e-ticaret ve servis entegrasyonlarını buradan yönetin.' : 'Manage ERP, e-commerce and service integrations here.'}
        icon={RefreshCw}
      />

      {/* ── ERP Entegrasyon Merkezi ── */}
      <div className="space-y-3">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <Activity className="w-3 h-3" />
          {currentLanguage === 'tr' ? 'ERP Entegrasyonları' : 'ERP Integrations'}
        </p>
        <React.Suspense fallback={
          <div className="flex items-center justify-center gap-2 py-8 text-gray-400 text-sm apple-card">
            <RefreshCw className="w-4 h-4 animate-spin" />
            {currentLanguage === 'tr' ? 'ERP paneli yükleniyor…' : 'Loading ERP panel…'}
          </div>
        }>
          <ERPHubPanel currentLanguage={currentLanguage} />
        </React.Suspense>
      </div>

      {/* ── Entegrasyon Sağlığı ── */}
      <React.Suspense fallback={null}>
        <IntegrationHealthPanel currentLanguage={currentLanguage} />
      </React.Suspense>

      {/* ── Stok Kodu Eşleştirme ── */}
      <React.Suspense fallback={null}>
        <SkuMappingPanel currentLanguage={currentLanguage} />
      </React.Suspense>

      {/* ── Bağlı Servisler ── */}
      <div className="space-y-3">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <Link className="w-3 h-3" />
          {currentLanguage === 'tr' ? 'Bağlı Servisler' : 'Connected Services'}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Shopify */}
          <div className="apple-card p-5 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center">
                <ShoppingBag className="w-4.5 h-4.5 text-green-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-sm">Shopify</h3>
                <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'E-ticaret entegrasyonu' : 'E-commerce integration'}</p>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${companySettings?.shopify_access_token ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                {companySettings?.shopify_access_token ? (currentLanguage === 'tr' ? 'Bağlı' : 'Connected') : (currentLanguage === 'tr' ? 'Bağlı Değil' : 'Not Connected')}
              </span>
            </div>
            {[
              { key: 'shopify_store_url',    label: currentLanguage === 'tr' ? 'Mağaza URL' : 'Store URL',    placeholder: 'mystore.myshopify.com', secret: false },
              { key: 'shopify_access_token', label: 'Access Token', placeholder: 'shpat_...', secret: true },
              { key: 'shopify_api_key',      label: 'API Key',      placeholder: 'API Key',   secret: false },
              { key: 'shopify_api_secret',   label: 'API Secret',   placeholder: 'API Secret', secret: true },
            ].map(f => (
              <div key={f.key} className="space-y-0.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase">{f.label}</label>
                <input
                  type={f.secret ? 'password' : 'text'}
                  defaultValue={(companySettings?.[f.key] as string) || ''}
                  placeholder={f.placeholder}
                  onChange={e => setCompanySettings((prev: Record<string, unknown>) => ({ ...prev, [f.key]: e.target.value }))}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-green-400 focus:ring-2 focus:ring-green-400/10 transition-all font-mono"
                />
              </div>
            ))}
            <button
              onClick={async () => {
                const token = (companySettings?.shopify_access_token as string) || '';
                if (!token) { toast(currentLanguage === 'tr' ? 'Önce Access Token girin.' : 'Enter Access Token first.', 'error'); return; }
                toast(currentLanguage === 'tr' ? 'Shopify senkronizasyonu başlatıldı…' : 'Starting Shopify sync…', 'info');
                try {
                  const r = await authFetch('/api/shopify/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: token, storeUrl: companySettings?.shopify_store_url || '' }) });
                  const d = await r.json();
                  if (d.error) throw new Error(d.error);
                  toast(`${currentLanguage === 'tr' ? 'Senkronize edildi' : 'Synced'} — ${d.products?.length ?? 0} ${currentLanguage === 'tr' ? 'ürün' : 'products'}, ${d.orders?.length ?? 0} ${currentLanguage === 'tr' ? 'sipariş' : 'orders'}`, 'success');
                } catch (e) { toast(e instanceof Error ? e.message : 'Sync hatası', 'error'); }
              }}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-bold transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {currentLanguage === 'tr' ? 'Senkronize Et' : 'Sync Now'}
            </button>
          </div>

          {/* TCMB Döviz */}
          <div className="apple-card p-5 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
                <Globe className="w-4.5 h-4.5 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-sm">TCMB Döviz</h3>
                <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Canlı kur bilgisi' : 'Live exchange rates'}</p>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${exchangeRates ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'}`}>
                {exchangeRates ? (currentLanguage === 'tr' ? 'Canlı' : 'Live') : (currentLanguage === 'tr' ? 'Bekleniyor' : 'Loading')}
              </span>
            </div>
            <div className="space-y-2 text-xs text-gray-500">
              <div className="flex justify-between"><span>USD / TRY</span><span className="font-mono font-semibold text-gray-800">{exchangeRates?.USD ? `₺${(exchangeRates.USD).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span></div>
              <div className="flex justify-between"><span>EUR / TRY</span><span className="font-mono font-semibold text-gray-800">{exchangeRates?.EUR ? `₺${(exchangeRates.EUR).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span></div>
              <div className="flex justify-between"><span>GBP / TRY</span><span className="font-mono font-semibold text-gray-800">{exchangeRates?.GBP ? `₺${(exchangeRates.GBP).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span></div>
            </div>
            <button
              onClick={async () => {
                toast(currentLanguage === 'tr' ? 'Kurlar güncelleniyor…' : 'Refreshing rates…', 'info');
                try {
                  const r = await fetch('/api/settings/exchange-rates');
                  const d = await r.json();
                  if (d.rates) { setExchangeRates(d.rates); toast(currentLanguage === 'tr' ? 'Döviz kurları güncellendi.' : 'Exchange rates updated.', 'success'); }
                  else throw new Error('Kur verisi alınamadı');
                } catch (e) { toast(e instanceof Error ? e.message : 'Hata', 'error'); }
              }}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors mt-auto"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {currentLanguage === 'tr' ? 'Kurları Yenile' : 'Refresh Rates'}
            </button>
          </div>
        </div>

        {/* Pazaryerleri */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            {currentLanguage === 'tr' ? 'Türk Pazaryerleri' : 'Turkish Marketplaces'}
          </p>
          <MarketplacePanel currentLanguage={currentLanguage} />
        </div>
      </div>

      {/* ── Webhook'lar ── */}
      <div className="space-y-3">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <Link className="w-3 h-3" />
          {currentLanguage === 'tr' ? "Giden Webhook'lar" : 'Outbound Webhooks'}
        </p>
        <div className="apple-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-500">{currentLanguage === 'tr' ? 'Cetpa olaylarını dış sistemlere gönder.' : 'Push Cetpa events to external systems.'}</p>
            <span className="text-[10px] font-bold text-gray-400">{webhookConfigs.length} {currentLanguage === 'tr' ? 'endpoint' : 'endpoints'}</span>
          </div>

          {webhookConfigs.length > 0 && (
            <div className="space-y-2">
              {webhookConfigs.map(wh => (
                <div key={wh.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-mono font-semibold text-gray-800 truncate">{wh.url}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(wh.events || []).map(ev => (
                        <span key={ev} className="text-[9px] font-bold bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{ev}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={async () => {
                        setWebhookTestLoading(wh.id);
                        try {
                          const token = await auth.currentUser?.getIdToken();
                          const r = await fetch('/api/webhooks/test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ url: wh.url }) });
                          const d = await r.json() as { ok?: boolean; status?: number };
                          toast(d.ok ? `✓ ${d.status ?? 200}` : `✗ ${d.status ?? 'error'}`, d.ok ? 'success' : 'error');
                        } catch { toast(currentLanguage === 'tr' ? 'Test başarısız' : 'Test failed', 'error'); }
                        finally { setWebhookTestLoading(null); }
                      }}
                      className="text-[9px] font-bold px-2 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors disabled:opacity-40"
                      disabled={webhookTestLoading === wh.id}
                    >
                      {webhookTestLoading === wh.id ? '…' : 'Test'}
                    </button>
                    <button
                      onClick={async () => { try { await updateDoc(doc(db, 'webhookConfigs', wh.id), { enabled: !wh.enabled }); } catch { toast('Error', 'error'); } }}
                      className={`text-[9px] font-bold px-2 py-1 rounded-lg transition-colors ${wh.enabled ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                    >
                      {wh.enabled ? (currentLanguage === 'tr' ? 'Aktif' : 'Active') : (currentLanguage === 'tr' ? 'Pasif' : 'Inactive')}
                    </button>
                    <button onClick={async () => { try { await deleteDoc(doc(db, 'webhookConfigs', wh.id)); } catch { toast('Error', 'error'); } }} className="text-gray-300 hover:text-red-400 transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Yeni Webhook Ekle' : 'Add New Webhook'}</p>
            <input
              className="apple-input w-full text-xs"
              placeholder="https://your-service.com/webhook"
              value={webhookDraft.url}
              onChange={e => setWebhookDraft(d => ({ ...d, url: e.target.value }))}
            />
            <div className="flex flex-wrap gap-1.5">
              {WEBHOOK_EVENTS.map(ev => (
                <button
                  key={ev}
                  onClick={() => setWebhookDraft(d => ({ ...d, events: d.events.includes(ev) ? d.events.filter(e => e !== ev) : [...d.events, ev] }))}
                  className={`text-[9px] font-bold px-2 py-1 rounded-lg border transition-all ${webhookDraft.events.includes(ev) ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-300'}`}
                >
                  {ev}
                </button>
              ))}
            </div>
            <button
              disabled={!webhookDraft.url.startsWith('http') || webhookDraft.events.length === 0 || webhookSaving}
              onClick={async () => {
                setWebhookSaving(true);
                try {
                  await addDoc(collection(db, 'webhookConfigs'), { url: webhookDraft.url.trim(), events: webhookDraft.events, enabled: true, createdAt: serverTimestamp() });
                  setWebhookDraft({ url: '', events: [] });
                  toast(currentLanguage === 'tr' ? 'Webhook eklendi ✓' : 'Webhook added ✓', 'success');
                } catch { toast(currentLanguage === 'tr' ? 'Webhook eklenemedi.' : 'Failed to add webhook.', 'error'); }
                finally { setWebhookSaving(false); }
              }}
              className="apple-button-primary text-xs px-5 disabled:opacity-40"
            >
              {webhookSaving ? '…' : (currentLanguage === 'tr' ? 'Ekle' : 'Add')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Bildirim & Ödeme ── */}
      <div className="space-y-3">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <Bell className="w-3 h-3" />
          {currentLanguage === 'tr' ? 'Bildirim & Ödeme' : 'Notifications & Payments'}
        </p>

        {/* WhatsApp Business */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center">
              <MessageSquare className="w-4.5 h-4.5 text-green-600" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-gray-900">WhatsApp Business API</h4>
              <p className="text-[11px] text-gray-400">{currentLanguage === 'tr' ? 'Müşterilere kargo ve teslimat bildirimleri.' : 'Order shipping & delivery notifications.'}</p>
            </div>
          </div>
          {[
            { key: 'phoneNumberId', label: 'Phone Number ID',                                                  placeholder: '1234567890',          isSecret: false },
            { key: 'accessToken',   label: 'Access Token',                                                     placeholder: 'EAA...',              isSecret: true  },
            { key: 'templateName',  label: currentLanguage === 'tr' ? 'Şablon Adı' : 'Template Name',         placeholder: 'order_status_update', isSecret: false },
            { key: 'templateLang',  label: currentLanguage === 'tr' ? 'Şablon Dili' : 'Template Language',    placeholder: 'tr',                  isSecret: false },
          ].map(f => (
            <div key={f.key} className="space-y-0.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase">{f.label}</label>
              <input
                type={f.isSecret ? 'password' : 'text'}
                placeholder={f.placeholder}
                onChange={e => setDoc(doc(db, 'settings', 'whatsapp'), { [f.key]: e.target.value.trim() }, { merge: true })}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-green-400 focus:ring-2 focus:ring-green-400/10 transition-all font-mono"
              />
            </div>
          ))}
          <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? "* Meta Developer Console'dan System User Permanent Token alın." : '* Get a System User Permanent Token from Meta Developer Console.'}</p>
        </div>

        {/* iyzico */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-50 rounded-xl flex items-center justify-center">
              <CreditCard className="w-4.5 h-4.5 text-emerald-600" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-gray-900">iyzico</h4>
              <p className="text-[11px] text-gray-400">{currentLanguage === 'tr' ? 'B2B müşterilere ödeme linki oluştur.' : 'Generate payment links for B2B customers.'}</p>
            </div>
          </div>
          {[
            { key: 'apiKey',    label: 'API Key',    placeholder: 'sandbox-...', isSecret: false },
            { key: 'secretKey', label: 'Secret Key', placeholder: 'sandbox-...', isSecret: true  },
            { key: 'baseUrl',   label: 'Base URL',   placeholder: 'https://sandbox-api.iyzipay.com', isSecret: false },
          ].map(f => (
            <div key={f.key} className="space-y-0.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase">{f.label}</label>
              <input
                type={f.isSecret ? 'password' : 'text'}
                placeholder={f.placeholder}
                onChange={e => setDoc(doc(db, 'settings', 'iyzico'), { [f.key]: e.target.value.trim() }, { merge: true })}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/10 transition-all font-mono"
              />
            </div>
          ))}
          <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? '* Test için sandbox URL kullanın. Canlı: https://api.iyzipay.com' : '* Use sandbox for testing. Live: https://api.iyzipay.com'}</p>
        </div>

        {/* Resend */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
              <Mail className="w-4.5 h-4.5 text-blue-600" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-gray-900">Resend</h4>
              <p className="text-[11px] text-gray-400">{currentLanguage === 'tr' ? 'Sipariş durumu otomatik e-posta bildirimleri.' : 'Automatic order status email notifications.'}</p>
            </div>
          </div>
          {[
            { key: 'apiKey',      label: currentLanguage === 'tr' ? 'API Anahtarı' : 'API Key',        placeholder: 're_...', isSecret: true  },
            { key: 'fromAddress', label: currentLanguage === 'tr' ? 'Gönderen Adres' : 'From Address', placeholder: 'siparis@cetpa.com.tr', isSecret: false },
          ].map(f => (
            <div key={f.key} className="space-y-0.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase">{f.label}</label>
              <input
                type={f.isSecret ? 'password' : 'email'}
                placeholder={f.placeholder}
                onChange={e => setDoc(doc(db, 'settings', 'email'), { [f.key]: e.target.value.trim() }, { merge: true })}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/10 transition-all font-mono"
              />
            </div>
          ))}
          <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? '* Ücretsiz API anahtarı: resend.com' : '* Free API key at resend.com'}</p>
        </div>
      </div>

      {/* ── Gemini AI ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center text-lg">🤖</div>
          <div className="flex-1">
            <h4 className="font-bold text-sm text-gray-900">Gemini AI</h4>
            <p className="text-[11px] text-gray-400">{currentLanguage === 'tr' ? 'AI Asistan, lead skorlama ve analiz için Google Gemini API anahtarı.' : 'Google Gemini API key for AI Assistant, lead scoring and analysis.'}</p>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${geminiApiKeySetting ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-500'}`}>
            {geminiApiKeySetting ? (currentLanguage === 'tr' ? 'Yapılandırıldı' : 'Configured') : (currentLanguage === 'tr' ? 'Eksik' : 'Missing')}
          </span>
        </div>
        <div className="space-y-0.5">
          <label className="text-[10px] font-bold text-gray-400 uppercase">{currentLanguage === 'tr' ? 'API Anahtarı' : 'API Key'}</label>
          <input
            type="password"
            placeholder="AIza..."
            value={geminiApiKeySetting}
            onChange={e => setGeminiApiKeySetting(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/10 transition-all"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              setSavingGeminiKey(true);
              try {
                await setDoc(doc(db, 'settings', 'aiConfig'), { geminiApiKey: geminiApiKeySetting.trim() }, { merge: true });
                toast(currentLanguage === 'tr' ? 'Gemini API anahtarı kaydedildi ✓' : 'Gemini API key saved ✓', 'success');
              } catch (e) {
                handleFirestoreError(e, OperationType.WRITE, 'settings/aiConfig');
              } finally {
                setSavingGeminiKey(false);
              }
            }}
            disabled={savingGeminiKey}
            className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-4 py-2 rounded-full transition-colors disabled:opacity-50"
          >
            {savingGeminiKey ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
            {currentLanguage === 'tr' ? 'Kaydet' : 'Save'}
          </button>
          <p className="text-[10px] text-gray-400">
            {currentLanguage === 'tr' ? '* Ücretsiz anahtar: ' : '* Free key at '}
            <span className="font-mono">aistudio.google.com/apikey</span>
          </p>
        </div>
      </div>

      {/* Ayarları kaydet */}
      <button
        disabled={savingSettings || settingsSaved}
        onClick={async () => {
          setSavingSettings(true);
          setSettingsSaved(false);
          try {
            await setDoc(doc(db, 'settings', 'app'), { companySettings }, { merge: true });
            logAuditAction('Ayar Değişikliği', 'Şirket ayarları kaydedildi');
            setSettingsSaved(true);
            toast(currentLanguage === 'tr' ? 'Ayarlar kaydedildi!' : 'Settings saved!', 'success');
            setTimeout(() => setSettingsSaved(false), 2500);
          } catch (error) {
            console.error('[Settings save error]', error);
            handleFirestoreError(error, OperationType.WRITE, 'settings/app');
            toast(currentLanguage === 'tr' ? 'Hata oluştu! Konsolu kontrol edin.' : 'Error occurred! Check console.', 'error');
          } finally {
            setSavingSettings(false);
          }
        }}
        className={`w-full rounded-full py-3 text-sm font-semibold transition-all ${
          settingsSaved ? 'bg-green-500 text-white' : 'apple-button-primary'
        } disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        {savingSettings
          ? (currentLanguage === 'tr' ? 'Kaydediliyor…' : 'Saving…')
          : settingsSaved
            ? (currentLanguage === 'tr' ? '✓ Kaydedildi' : '✓ Saved')
            : (currentLanguage === 'tr' ? 'Ayarları Kaydet' : 'Save Settings')
        }
      </button>

      {/* Firebase / General */}
      <div className="apple-card p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 bg-yellow-50 rounded-xl flex items-center justify-center">
            <Shield className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <h3 className="font-bold text-sm">{currentLanguage === 'tr' ? 'Güvenlik & Genel' : 'Security & General'}</h3>
            <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Uygulama güvenlik ayarları' : 'Application security settings'}</p>
          </div>
        </div>
        <div className="p-3 bg-blue-50 rounded-xl text-xs text-blue-700 font-medium">
          💡 {currentLanguage === 'tr' ? 'API anahtarları güvenli bir şekilde saklanmalıdır. Üretim ortamında .env dosyası kullanmanızı öneririz.' : 'API keys should be stored securely. We recommend using .env files in production.'}
        </div>
      </div>

      {/* Security module — session info */}
      <div className="apple-card p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center">
            <Lock className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h3 className="font-bold text-sm">{currentLanguage === 'tr' ? 'Aktif Oturum & Güvenlik' : 'Active Session & Security'}</h3>
            <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Oturum ve rol bilgileri' : 'Session and role information'}</p>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          {[
            { label: currentLanguage === 'tr' ? 'Kullanıcı' : 'User', value: user?.email || '—' },
            { label: currentLanguage === 'tr' ? 'Rol' : 'Role', value: userRole },
            { label: 'UID', value: user?.uid?.slice(0, 16) + '...' || '—' },
            { label: currentLanguage === 'tr' ? 'Giriş Yöntemi' : 'Sign-in Method', value: user?.providerData?.[0]?.providerId || 'anonymous' },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <span className="text-[#86868B] text-xs font-medium">{row.label}</span>
              <span className="text-xs font-mono font-semibold text-[#1D1D1F] truncate max-w-[180px]">{row.value}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className={cn('p-3 rounded-xl text-xs font-medium text-center', userRole === 'Admin' ? 'bg-red-50 text-red-600' : userRole === 'Manager' ? 'bg-orange-50 text-orange-600' : userRole === 'Dealer' ? 'bg-purple-50 text-purple-600' : 'bg-gray-50 text-gray-600')}>
            <p className="font-bold text-lg">{userRole}</p>
            <p className="opacity-70">{currentLanguage === 'tr' ? 'Yetki Seviyesi' : 'Permission Level'}</p>
          </div>
          <div className="p-3 rounded-xl bg-green-50 text-green-600 text-xs font-medium text-center">
            <p className="font-bold text-lg">●</p>
            <p>{currentLanguage === 'tr' ? 'Oturum Aktif' : 'Session Active'}</p>
          </div>
        </div>
      </div>

      {/* ── Phase 65: Notification Preferences ── */}
      {(() => {
        const notifItems = [
          { key: 'lowStock',   icon: '📦', label: currentLanguage === 'tr' ? 'Düşük stok uyarıları' : 'Low stock alerts',       default: true  },
          { key: 'newOrder',   icon: '🛒', label: currentLanguage === 'tr' ? 'Yeni sipariş bildirimi' : 'New order notification',  default: true  },
          { key: 'newLead',    icon: '👤', label: currentLanguage === 'tr' ? 'Yeni müşteri adayı' : 'New lead',                   default: true  },
          { key: 'followUp',   icon: '📅', label: currentLanguage === 'tr' ? 'Takip hatırlatıcıları' : 'Follow-up reminders',     default: true  },
          { key: 'shipment',   icon: '🚚', label: currentLanguage === 'tr' ? 'Kargo durum değişikliği' : 'Shipment status change', default: false },
          { key: 'poDeadline', icon: '⏰', label: currentLanguage === 'tr' ? 'Satın alma son tarihi' : 'PO deadline alerts',       default: true  },
        ];
        return (
          <div className="apple-card p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
                <Bell className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-bold text-sm">{currentLanguage === 'tr' ? 'Bildirim Tercihleri' : 'Notification Preferences'}</h3>
                <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Hangi bildirimleri almak istediğinizi seçin' : 'Choose which notifications you want to receive'}</p>
              </div>
            </div>
            <div className="space-y-3">
              {notifItems.map(item => {
                const isOn = item.key in notifPrefs ? notifPrefs[item.key] : item.default;
                return (
                  <div key={item.key} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">{item.icon}</span>
                      <span className="text-sm text-gray-700">{item.label}</span>
                    </div>
                    <button
                      onClick={() => toggleNotifPref(item.key)}
                      className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${isOn ? 'bg-brand' : 'bg-gray-200'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isOn ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? '* Tercihler bu cihazda yerel olarak saklanır.' : '* Preferences are stored locally on this device.'}</p>
          </div>
        );
      })()}

      {/* Dealer Portal info */}
      <div className="apple-card p-6 space-y-3 bg-purple-50/50 border border-purple-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center">
            <Users className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-purple-800">{currentLanguage === 'tr' ? 'Bayi Yönetimi' : 'Dealer Management'}</h3>
            <p className="text-[11px] text-purple-600">{currentLanguage === 'tr' ? 'Bayilere özel erişim tanımla' : 'Define dealer-specific access'}</p>
          </div>
        </div>
        <div className="text-xs text-purple-700 space-y-1.5">
          <p>✓ {currentLanguage === 'tr' ? 'Bayi rolündeki kullanıcılar yalnızca kendi siparişlerini görür.' : 'Dealer-role users only see their own orders.'}</p>
          <p>✓ {currentLanguage === 'tr' ? 'Bayiler müşteri ve sipariş oluşturabilir.' : 'Dealers can create customers and orders.'}</p>
          <p>✓ {currentLanguage === 'tr' ? 'Admin panelinden "Bayi / Dealer" rolü ile davet edebilirsiniz.' : 'Invite via Admin panel with "Bayi / Dealer" role.'}</p>
        </div>
      </div>

      {/* ── Phase 641: Denetim İzi (Audit Trail) ── */}
      {(() => {
        const tr641 = currentLanguage === 'tr';
        const entityOptions: { k: 'all' | 'orders' | 'inventory' | 'leads' | 'muhasebe'; l: string }[] = [
          { k: 'all',       l: tr641 ? 'Tümü'      : 'All'      },
          { k: 'orders',    l: tr641 ? 'Siparişler' : 'Orders'   },
          { k: 'inventory', l: tr641 ? 'Stok'       : 'Inventory'},
          { k: 'leads',     l: tr641 ? 'CRM'        : 'CRM'      },
          { k: 'muhasebe',  l: tr641 ? 'Muhasebe'   : 'Finance'  },
        ];
        const normalised = auditLogs.map(l => ({
          id: String(l.id || ''),
          user: String(l.user || l.userId || l.email || 'system'),
          action: String(l.action || l.type || 'update'),
          entity: String(l.entity || l.collection || l.module || ''),
          entityId: String(l.entityId || l.docId || l.id || ''),
          ts: l.timestamp instanceof Timestamp ? l.timestamp.toDate().toISOString() : String(l.timestamp || l.createdAt || new Date().toISOString()),
          details: l.details || l.description || l.message ? String(l.details || l.description || l.message) : undefined,
        }));
        const filtered641 = p641Entity === 'all' ? normalised : normalised.filter(l => l.entity === p641Entity);
        const actionIcon: { [k: string]: string } = { create: '➕', update: '✏️', delete: '🗑️', view: '👁️' };
        const entityBadge: { [k: string]: string } = { orders: 'bg-blue-100 text-blue-700', inventory: 'bg-emerald-100 text-emerald-700', leads: 'bg-purple-100 text-purple-700', muhasebe: 'bg-amber-100 text-amber-700' };
        return (
          <div className="apple-card p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="font-bold text-gray-900 text-sm">🔍 {tr641 ? 'Denetim İzi (Audit Trail)' : 'Audit Trail'}</h3>
                <p className="text-xs text-gray-400">{tr641 ? `Firestore auditLog — son ${auditLogs.length} kayıt` : `Firestore auditLog — ${auditLogs.length} recent entries`}</p>
              </div>
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
                {entityOptions.map(t => (
                  <button key={t.k} onClick={() => setP641Entity(t.k)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${p641Entity === t.k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                ))}
              </div>
            </div>
            {filtered641.length > 0 ? (
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {filtered641.slice(0, 20).map((l, idx) => (
                  <div key={l.id || idx} className="flex items-start gap-3 border border-gray-50 rounded-xl px-3 py-2.5 hover:bg-gray-50/50">
                    <span className="text-base mt-0.5">{actionIcon[l.action] || '•'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-gray-800">{l.user}</span>
                        {l.entity && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${entityBadge[l.entity] || 'bg-gray-100 text-gray-600'}`}>{l.entity}</span>}
                        {l.entityId && <span className="text-[10px] text-gray-400 font-mono">#{l.entityId.slice(-8)}</span>}
                      </div>
                      {l.details && <p className="text-[10px] text-gray-500 truncate">{l.details}</p>}
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">{new Date(l.ts).toLocaleString('tr-TR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-center text-gray-400 text-xs py-4">{tr641 ? 'Henüz denetim kaydı yok — işlemler gerçekleştikçe burada görünür.' : 'No audit logs yet — entries appear here as actions occur.'}</p>}
          </div>
        );
      })()}
    </>
  );
}
