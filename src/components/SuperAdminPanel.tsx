import { useEffect, useRef, useState } from 'react';
import {
  Building2, Users, RefreshCw, Search, ShieldOff, ShieldCheck, Crown, X,
  CreditCard, Link2, Mail, Copy, Check, Calendar, Phone, MapPin, Receipt, FileText,
  UserPlus, UserMinus, Activity,
} from 'lucide-react';
import { authedFetch } from '../lib/dbClient';
import { confirmAction } from '../lib/confirm';
import OpsWatchdogCard from './OpsWatchdogCard';
import TrafikKarti from './TrafikKarti';
import ModuleStatusBoard from './ModuleStatusBoard';

/** Kiracının KENDİ yedek kurulumu (2026-08-21: "her şirket kendi setup'ı"). */
interface TenantBackup {
  yapilandirildi: boolean;
  enabled: boolean;
  lastRunAt: unknown;
  lastStatus: string | null;
  remote: string | null;
}

interface Tenant {
  backup?: TenantBackup;
  companyId: string;
  companyName: string;
  ownerEmail: string;
  userCount: number;
  plan: string;
  subStatus: string;
  status: string; // 'active' | 'suspended'
  cycle: string;
  amount: number;
  nextPaymentDate: unknown;
  lastPaymentDate: unknown;
  createdAt: unknown;
}

interface TenantUser { uid: string; email: string; name: string; role: string; lastLogin: unknown; createdAt: unknown; }
interface TenantInvoice { id: string; amount: number; currency: string; plan?: string; cycle?: string; status?: string; paymentPageUrl?: string; email?: string; createdAt?: unknown; createdMs?: number; }
interface TenantDetail {
  companyId: string;
  profile: { companyName: string; taxNo: string; taxOffice: string; address: string; email: string; phone: string; iban: string; website: string };
  owner: TenantUser | null;
  users: TenantUser[];
  billing: Record<string, unknown>;
  status: string;
  note: string;
  invoices: TenantInvoice[];
}

interface Props {
  currentLanguage: string;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const PLAN_OPTIONS = ['starter', 'professional', 'business', 'enterprise', 'free'] as const;
const PLAN_LABEL: Record<string, { tr: string; en: string }> = {
  starter: { tr: 'Başlangıç', en: 'Starter' },
  professional: { tr: 'Profesyonel', en: 'Professional' },
  business: { tr: 'İşletme', en: 'Business' },
  enterprise: { tr: 'Kurumsal', en: 'Enterprise' },
  free: { tr: 'Ücretsiz', en: 'Free' },
};
const PLAN_PRICES: Record<string, { monthly: number; yearly: number }> = {
  starter: { monthly: 999, yearly: 9990 },
  professional: { monthly: 2499, yearly: 24990 },
  business: { monthly: 4999, yearly: 49990 },
  enterprise: { monthly: 0, yearly: 0 },
  free: { monthly: 0, yearly: 0 },
};

function toMs(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? 0 : t; }
  if (typeof v === 'object') {
    const o = v as { seconds?: number; _seconds?: number; toMillis?: () => number };
    if (typeof o.toMillis === 'function') return o.toMillis();
    if (o.seconds) return o.seconds * 1000;
    if (o._seconds) return o._seconds * 1000;
  }
  return 0;
}
function fmtDate(v: unknown, lang: string): string {
  const ms = toMs(v);
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtMoney(v: number, currency = 'TRY'): string {
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₺';
  return `${sym}${Math.round(v).toLocaleString('tr-TR')}`;
}

/**
 * Süper-admin (SaaS operatörü) — tam kapsamlı kiracı yönetim paneli.
 * Liste + detay çekmecesi (profil, faturalandırma, kullanıcılar, ödeme geçmişi)
 * + ödeme linki oluşturma/e-posta gönderme. Yalnız SUPER_ADMIN_EMAILS için.
 */
export default function SuperAdminPanel({ currentLanguage, toast }: Props) {
  const tr = currentLanguage === 'tr';
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');

  // Detay çekmecesi
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingBilling, setSavingBilling] = useState(false);

  // Düzenlenebilir faturalandırma alanları
  const [fPlan, setFPlan] = useState('starter');
  const [fCycle, setFCycle] = useState('monthly');
  const [fStatus, setFStatus] = useState('active');
  const [fNextDate, setFNextDate] = useState('');
  const [fNote, setFNote] = useState('');

  // Düzenlenebilir firma profili (2026-08-17: önceden salt-okunurdu, kullanıcı bildirimi)
  const [pCompanyName, setPCompanyName] = useState('');
  const [pTaxNo, setPTaxNo] = useState('');
  const [pTaxOffice, setPTaxOffice] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pIban, setPIban] = useState('');
  const [pAddress, setPAddress] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Kullanıcı yönetimi (ekle/rol değiştir/sil)
  const [userBusy, setUserBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  // Kiracının KENDİ yedek hedefi — onboarding'in zorunlu adımı.
  const [backupRemote, setBackupRemote] = useState('');
  const [backupSaving, setBackupSaving] = useState(false);
  const [inviteRole, setInviteRole] = useState('Sales');
  const [inviting, setInviting] = useState(false);
  const USER_ROLES = ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'HR', 'Purchasing', 'B2B', 'Dealer', 'Legal', 'Corporate', 'Quality'];
  const ROLE_LABEL_TR: Record<string, string> = {
    Admin: 'Admin', Manager: 'Yönetici', Sales: 'Satış', Logistics: 'Lojistik',
    Accounting: 'Muhasebe', HR: 'İnsan Kaynakları', Purchasing: 'Satın Alma',
    B2B: 'B2B', Dealer: 'Bayi', Legal: 'Hukuk', Corporate: 'Kurumsal', Quality: 'Kalite',
  };
  const roleLabel = (r: string) => (tr ? (ROLE_LABEL_TR[r] ?? r) : r);

  // Ödeme linki modalı
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payCurrency, setPayCurrency] = useState('TRY');
  const [payEmail, setPayEmail] = useState('');
  const [paySendEmail, setPaySendEmail] = useState(true);
  const [payBusy, setPayBusy] = useState(false);
  const [payResult, setPayResult] = useState<{ url: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const toastRef = useRef(toast); toastRef.current = toast;
  const trRef = useRef(tr); trRef.current = tr;

  async function load() {
    setLoading(true);
    try {
      const res = await authedFetch('/api/superadmin/tenants');
      if (res.ok) { const data = await res.json() as { tenants: Tenant[] }; setTenants(data.tenants || []); }
      else if (res.status === 403) toastRef.current(trRef.current ? 'Süper-admin yetkiniz yok.' : 'Super-admin access required.', 'error');
    } catch { toastRef.current(trRef.current ? 'Kiracılar yüklenemedi.' : 'Failed to load tenants.', 'error'); }
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const openDetail = async (t: Tenant) => {
    setDetailId(t.companyId); setDetail(null); setDetailLoading(true); setPayOpen(false); setPayResult(null);
    try {
      const res = await authedFetch(`/api/superadmin/tenants/${encodeURIComponent(t.companyId)}`);
      if (res.ok) {
        const d = await res.json() as TenantDetail;
        setDetail(d);
        const plan = String(d.billing.plan || t.plan || 'starter');
        const cycle = String(d.billing.cycle || t.cycle || 'monthly');
        setFPlan(PLAN_OPTIONS.includes(plan as typeof PLAN_OPTIONS[number]) ? plan : 'starter');
        setFCycle(cycle === 'yearly' ? 'yearly' : 'monthly');
        setFStatus(d.status === 'suspended' ? 'suspended' : 'active');
        const ms = toMs(d.billing.nextPaymentDate ?? d.billing.currentPeriodEnd);
        setFNextDate(ms ? new Date(ms).toISOString().slice(0, 10) : '');
        setFNote(d.note || '');
        setPCompanyName(d.profile.companyName || '');
        setPTaxNo(d.profile.taxNo || '');
        setPTaxOffice(d.profile.taxOffice || '');
        setPEmail(d.profile.email || '');
        setPPhone(d.profile.phone || '');
        setPIban(d.profile.iban || '');
        setPAddress(d.profile.address || '');
        setInviteEmail(''); setInviteRole('Sales');
        setPayEmail(d.profile.email || d.owner?.email || t.ownerEmail || '');
        setPayAmount(String((d.billing.amount as number) || PLAN_PRICES[plan]?.[cycle === 'yearly' ? 'yearly' : 'monthly'] || ''));
        setPayCurrency('TRY');
      } else { toast(tr ? 'Detay yüklenemedi.' : 'Failed to load detail.', 'error'); }
    } catch { toast(tr ? 'Detay yüklenemedi.' : 'Failed to load detail.', 'error'); }
    setDetailLoading(false);
  };
  const closeDetail = () => { setDetailId(null); setDetail(null); setPayOpen(false); setPayResult(null); };

  // Yalnız detay verisini (ör. ödeme geçmişi) tazeler; çekmece/modal/form durumuna dokunmaz.
  const refreshDetail = async (cid: string) => {
    try {
      const res = await authedFetch(`/api/superadmin/tenants/${encodeURIComponent(cid)}`);
      if (res.ok) setDetail(await res.json() as TenantDetail);
    } catch { /* sessiz */ }
  };

  const saveBilling = async () => {
    if (!detailId) return;
    setSavingBilling(true);
    try {
      const nextMs = fNextDate ? Date.parse(fNextDate) : undefined;
      const res = await authedFetch(`/api/superadmin/tenants/${encodeURIComponent(detailId)}/update`, {
        method: 'POST',
        body: JSON.stringify({ plan: fPlan, cycle: fCycle, status: fStatus, note: fNote, nextPaymentDate: nextMs ?? null }),
      });
      if (res.ok) {
        setTenants(prev => prev.map(x => x.companyId === detailId ? { ...x, plan: fPlan, cycle: fCycle, status: fStatus, nextPaymentDate: nextMs ?? x.nextPaymentDate } : x));
        toast(tr ? 'Faturalandırma güncellendi.' : 'Billing updated.', 'success');
      } else { toast(tr ? 'Güncelleme başarısız.' : 'Update failed.', 'error'); }
    } catch { toast(tr ? 'Güncelleme başarısız.' : 'Update failed.', 'error'); }
    setSavingBilling(false);
  };

  const saveBackup = async () => {
    if (!detailId) return;
    const v = backupRemote.trim();
    // Biçim kontrolü BURADA da yapılır (sunucu ayrıca doğruluyor): yanlış
    // hedef, yedek görevinin gece yarısı sessizce patlaması demektir.
    if (v && !(v.indexOf(':') > 0)) {
      toast(tr ? "Hedef 'ad:yol' biçiminde olmalı (ör. gdrive:cetpa-yedek)." : "Target must be 'name:path'.", 'error');
      return;
    }
    setBackupSaving(true);
    try {
      const res = await authedFetch(`/api/superadmin/tenants/${encodeURIComponent(detailId)}/backup`, {
        method: 'POST', body: JSON.stringify({ rcloneRemote: v }),
      });
      const d = await res.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (res.ok && d.success) {
        toast(tr ? 'Yedek hedefi kaydedildi.' : 'Backup target saved.', 'success');
        setTenants(prev => prev.map(x => x.companyId === detailId
          ? { ...x, backup: { ...(x.backup ?? { enabled: true, lastRunAt: null, lastStatus: null }), yapilandirildi: !!v, remote: v || null } as TenantBackup }
          : x));
      } else {
        toast(d.error || (tr ? 'Kaydedilemedi.' : 'Save failed.'), 'error');
      }
    } catch {
      toast(tr ? 'Kaydedilemedi.' : 'Save failed.', 'error');
    } finally { setBackupSaving(false); }
  };

  const saveProfile = async () => {
    if (!detailId) return;
    setSavingProfile(true);
    try {
      const res = await authedFetch(`/api/superadmin/tenants/${encodeURIComponent(detailId)}/update`, {
        method: 'POST',
        body: JSON.stringify({ profile: { companyName: pCompanyName, taxNo: pTaxNo, taxOffice: pTaxOffice, email: pEmail, phone: pPhone, iban: pIban, address: pAddress } }),
      });
      if (res.ok) { toast(tr ? 'Firma bilgileri güncellendi.' : 'Company info updated.', 'success'); void refreshDetail(detailId); }
      else toast(tr ? 'Güncelleme başarısız.' : 'Update failed.', 'error');
    } catch { toast(tr ? 'Güncelleme başarısız.' : 'Update failed.', 'error'); }
    setSavingProfile(false);
  };

  const changeUserRole = async (uid: string, role: string) => {
    if (!detailId) return;
    setUserBusy(uid);
    try {
      const res = await authedFetch(`/api/superadmin/tenants/${encodeURIComponent(detailId)}/users/${encodeURIComponent(uid)}/role`, { method: 'POST', body: JSON.stringify({ role }) });
      if (res.ok) { toast(tr ? 'Rol güncellendi.' : 'Role updated.', 'success'); void refreshDetail(detailId); }
      else { const d = await res.json().catch(() => ({})) as { error?: string }; toast(d.error || (tr ? 'Rol güncellenemedi.' : 'Role update failed.'), 'error'); }
    } catch { toast(tr ? 'Rol güncellenemedi.' : 'Role update failed.', 'error'); }
    setUserBusy(null);
  };

  const removeUser = async (uid: string, email: string) => {
    if (!detailId) return;
    const ok = await confirmAction({ title: tr ? 'Kullanıcıyı Kaldır' : 'Remove User', message: tr ? `"${email}" bu firmadan kaldırılacak. Emin misiniz?` : `"${email}" will be removed. Are you sure?`, confirmLabel: tr ? 'Kaldır' : 'Remove', variant: 'danger' });
    if (!ok) return;
    setUserBusy(uid);
    try {
      const res = await authedFetch(`/api/superadmin/tenants/${encodeURIComponent(detailId)}/users/${encodeURIComponent(uid)}/remove`, { method: 'POST' });
      if (res.ok) { toast(tr ? 'Kullanıcı kaldırıldı.' : 'User removed.', 'success'); void refreshDetail(detailId); }
      else { const d = await res.json().catch(() => ({})) as { error?: string }; toast(d.error || (tr ? 'Kaldırılamadı.' : 'Removal failed.'), 'error'); }
    } catch { toast(tr ? 'Kaldırılamadı.' : 'Removal failed.', 'error'); }
    setUserBusy(null);
  };

  const inviteUser = async () => {
    if (!detailId || !inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await authedFetch(`/api/superadmin/tenants/${encodeURIComponent(detailId)}/invite`, { method: 'POST', body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }) });
      const d = await res.json().catch(() => ({})) as { success?: boolean; error?: string; emailSent?: boolean; inviteUrl?: string };
      if (res.ok && d.success) {
        toast(d.emailSent ? (tr ? 'Davet e-postası gönderildi.' : 'Invite email sent.') : (tr ? 'Davet oluşturuldu (e-posta gönderilemedi — linki paylaşın).' : 'Invite created (email failed — share the link manually).'), d.emailSent ? 'success' : 'info');
        setInviteEmail('');
      } else toast(d.error || (tr ? 'Davet gönderilemedi.' : 'Invite failed.'), 'error');
    } catch { toast(tr ? 'Davet gönderilemedi.' : 'Invite failed.', 'error'); }
    setInviting(false);
  };

  const quickStatus = async (t: Tenant, status: 'active' | 'suspended') => {
    const ok = await confirmAction(status === 'suspended'
      ? { title: tr ? 'Firmayı Askıya Al' : 'Suspend Company', message: tr ? `"${t.companyName}" askıya alınacak. Tüm kullanıcıları erişemeyecek. Emin misiniz?` : `"${t.companyName}" will be suspended. Are you sure?`, confirmLabel: tr ? 'Askıya Al' : 'Suspend', variant: 'danger' }
      : { title: tr ? 'Firmayı Aktifleştir' : 'Activate Company', message: tr ? `"${t.companyName}" aktifleştirilecek. Devam?` : `Activate "${t.companyName}"?`, confirmLabel: tr ? 'Aktifleştir' : 'Activate', variant: 'warning' });
    if (!ok) return;
    setBusy(t.companyId);
    try {
      const res = await authedFetch(`/api/superadmin/tenants/${encodeURIComponent(t.companyId)}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      if (res.ok) { setTenants(prev => prev.map(x => x.companyId === t.companyId ? { ...x, status } : x)); toast(tr ? (status === 'suspended' ? 'Askıya alındı.' : 'Aktifleştirildi.') : 'Updated.', 'success'); }
      else toast(tr ? 'İşlem başarısız.' : 'Operation failed.', 'error');
    } catch { toast(tr ? 'İşlem başarısız.' : 'Operation failed.', 'error'); }
    setBusy(null);
  };

  const createLink = async () => {
    if (!detailId) return;
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { toast(tr ? 'Geçerli bir tutar girin.' : 'Enter a valid amount.', 'error'); return; }
    setPayBusy(true); setPayResult(null);
    try {
      const res = await authedFetch(`/api/superadmin/tenants/${encodeURIComponent(detailId)}/payment-link`, {
        method: 'POST',
        body: JSON.stringify({ amount: amt, currency: payCurrency, email: payEmail, sendEmail: paySendEmail, plan: fPlan, cycle: fCycle }),
      });
      const d = await res.json() as { success?: boolean; paymentPageUrl?: string; emailed?: boolean; emailError?: string; notConfigured?: boolean; error?: string };
      if (res.ok && d.success && d.paymentPageUrl) {
        setPayResult({ url: d.paymentPageUrl, emailed: !!d.emailed });
        toast(d.emailed ? (tr ? 'Ödeme linki oluşturuldu ve e-posta gönderildi.' : 'Link created & emailed.') : (tr ? 'Ödeme linki oluşturuldu.' : 'Link created.'), 'success');
        if (d.emailError) toast(d.emailError, 'info');
        void refreshDetail(detailId); // ödeme geçmişini tazele — modal/sonuç ekranını bozmadan
      } else if (d.notConfigured) {
        toast(tr ? 'İyzico yapılandırılmamış (IYZICO_API_KEY).' : 'iyzico not configured.', 'error');
      } else { toast(d.error || (tr ? 'Link oluşturulamadı.' : 'Failed to create link.'), 'error'); }
    } catch { toast(tr ? 'Link oluşturulamadı.' : 'Failed to create link.', 'error'); }
    setPayBusy(false);
  };

  const copyLink = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  const filtered = tenants.filter(t => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return t.companyName.toLowerCase().includes(s) || t.ownerEmail.toLowerCase().includes(s) || t.companyId.toLowerCase().includes(s);
  });
  const totalUsers = tenants.reduce((s, t) => s + t.userCount, 0);
  const mrr = tenants.filter(t => t.status === 'active' && t.subStatus === 'active').reduce((s, t) => s + (t.cycle === 'yearly' ? (t.amount || 0) / 12 : (t.amount || 0)), 0);
  const suspended = tenants.filter(t => t.status === 'suspended').length;

  const planBadge = (plan: string) => ({
    free: 'bg-gray-100 text-gray-600', starter: 'bg-blue-100 text-blue-600', professional: 'bg-purple-100 text-purple-600',
    business: 'bg-indigo-100 text-indigo-600', enterprise: 'bg-amber-100 text-amber-700',
  } as Record<string, string>)[plan?.toLowerCase()] || 'bg-gray-100 text-gray-600';
  const planText = (plan: string) => PLAN_LABEL[plan?.toLowerCase()]?.[tr ? 'tr' : 'en'] || plan;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center"><Crown className="w-5 h-5" /></div>
        <div>
          <h2 className="text-lg font-bold text-[#1D1D1F]">{tr ? 'Müşteri (Kiracı) Yönetimi' : 'Customer (Tenant) Management'}</h2>
          <p className="text-xs text-[#86868B]">{tr ? 'SaaS operatörü süper-admin paneli' : 'SaaS operator super-admin panel'}</p>
        </div>
        <button onClick={() => void load()} className="apple-button-secondary ml-auto text-xs flex items-center gap-1.5 px-3 py-2">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />{tr ? 'Yenile' : 'Refresh'}
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="apple-card p-4"><div className="flex items-center gap-2 text-[#86868B] text-xs mb-1"><Building2 className="w-4 h-4" />{tr ? 'Toplam Firma' : 'Companies'}</div><p className="text-2xl font-bold text-[#1D1D1F]">{tenants.length}</p></div>
        <div className="apple-card p-4"><div className="flex items-center gap-2 text-[#86868B] text-xs mb-1"><Users className="w-4 h-4" />{tr ? 'Kullanıcı' : 'Users'}</div><p className="text-2xl font-bold text-[#1D1D1F]">{totalUsers}</p></div>
        <div className="apple-card p-4"><div className="flex items-center gap-2 text-[#86868B] text-xs mb-1"><ShieldCheck className="w-4 h-4" />{tr ? 'Aktif' : 'Active'}</div><p className="text-2xl font-bold text-green-600">{tenants.length - suspended}</p></div>
        <div className="apple-card p-4"><div className="flex items-center gap-2 text-[#86868B] text-xs mb-1"><ShieldOff className="w-4 h-4" />{tr ? 'Askıda' : 'Suspended'}</div><p className="text-2xl font-bold text-red-500">{suspended}</p></div>
        <div className="apple-card p-4"><div className="flex items-center gap-2 text-[#86868B] text-xs mb-1"><CreditCard className="w-4 h-4" />{tr ? 'Aylık Gelir' : 'MRR'}</div><p className="text-2xl font-bold text-[#1D1D1F]">{fmtMoney(mrr)}</p></div>
      </div>

      {/* Operasyon Bekçisi — günlük altyapı sağlık kontrolleri */}
      <OpsWatchdogCard currentLanguage={currentLanguage} toast={toast} />
      <TrafikKarti currentLanguage={currentLanguage} />

      {/* Sistem Sağlığı & Modül Durumu — canlı uç nokta nabzı + sezgisel modül olgunluğu */}
      <ModuleStatusBoard currentLanguage={currentLanguage} toast={toast} />

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 text-[#86868B] absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={q} onChange={e => setQ(e.target.value)} aria-label={tr ? 'Kiracı ara' : 'Search tenants'} placeholder={tr ? 'Firma, sahip e-posta veya ID ara...' : 'Search...'} className="apple-input pl-9 w-full" />
      </div>

      {/* Table */}
      <div className="apple-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#86868B] border-b border-[#f0f0f2]">
                <th className="px-4 py-3 font-medium">{tr ? 'Firma' : 'Company'}</th>
                <th className="px-4 py-3 font-medium">{tr ? 'Sahip' : 'Owner'}</th>
                <th className="px-4 py-3 font-medium text-center">{tr ? 'Kull.' : 'Users'}</th>
                <th className="px-4 py-3 font-medium">{tr ? 'Plan' : 'Plan'}</th>
                <th className="px-4 py-3 font-medium">{tr ? 'Sonraki Ödeme' : 'Next Payment'}</th>
                <th className="px-4 py-3 font-medium">{tr ? 'Yedek' : 'Backup'}</th>
                <th className="px-4 py-3 font-medium">{tr ? 'Durum' : 'Status'}</th>
                <th className="px-4 py-3 font-medium text-right">{tr ? 'İşlem' : 'Action'}</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">{tr ? 'Yükleniyor...' : 'Loading...'}</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">{tr ? 'Kayıt bulunamadı.' : 'No records.'}</td></tr>}
              {!loading && filtered.map(t => (
                <tr key={t.companyId} className="border-b border-[#f7f7f8] last:border-0 hover:bg-gray-50/60 cursor-pointer" onClick={() => void openDetail(t)}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[#1D1D1F]">{t.companyName}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{t.companyId.slice(0, 14)}</div>
                  </td>
                  <td className="px-4 py-3 text-[#1D1D1F]">{t.ownerEmail || '—'}</td>
                  <td className="px-4 py-3 text-center font-medium">{t.userCount}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${planBadge(t.plan)}`}>{planText(t.plan)}</span></td>
                  <td className="px-4 py-3 text-xs text-[#1D1D1F]">{fmtDate(t.nextPaymentDate, currentLanguage)}</td>
                  {/* YEDEK — onboarding kapısı. Kurulum yapılmamış kiracı
                      KIRMIZI görünür: "yedeklendiğini sanan ama yedeklenmeyen
                      müşteri" bu projedeki en pahalı hata sınıfı. */}
                  <td className="px-4 py-3">
                    {!t.backup?.yapilandirildi
                      ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600" title={tr ? 'Bu firma için yedek hedefi tanımlı değil — verisi hiç yedeklenmiyor.' : 'No backup target configured — this company is not backed up.'}>{tr ? 'KURULUM YOK' : 'NOT SET UP'}</span>
                      : t.backup.enabled === false
                        ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500">{tr ? 'Kapalı' : 'Disabled'}</span>
                        : t.backup.lastStatus === 'error'
                          ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600">{tr ? 'HATA' : 'ERROR'}</span>
                          : !t.backup.lastRunAt
                            ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">{tr ? 'Hiç koşmadı' : 'Never ran'}</span>
                            : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-600" title={String(t.backup.remote ?? '')}>{fmtDate(t.backup.lastRunAt, currentLanguage)}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {t.status === 'suspended'
                      ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600">{tr ? 'Askıda' : 'Suspended'}</span>
                      : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-600">{tr ? 'Aktif' : 'Active'}</span>}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => void openDetail(t)} className="text-xs font-semibold text-brand hover:bg-brand/10 px-3 py-1.5 rounded-lg">{tr ? 'Detay' : 'Details'}</button>
                      {t.status === 'suspended'
                        ? <button disabled={busy === t.companyId} onClick={() => quickStatus(t, 'active')} className="text-xs font-semibold text-green-600 hover:bg-green-50 px-3 py-1.5 rounded-lg disabled:opacity-50">{tr ? 'Aktifleştir' : 'Activate'}</button>
                        : <button disabled={busy === t.companyId} onClick={() => quickStatus(t, 'suspended')} className="text-xs font-semibold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg disabled:opacity-50">{tr ? 'Askıya Al' : 'Suspend'}</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail drawer */}
      {detailId && (
        <div className="fixed inset-0 z-[110] flex justify-end bg-black/30 backdrop-blur-sm" onClick={closeDetail}>
          <div className="bg-[#fafafa] w-full max-w-lg h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-[#f0f0f2] px-5 py-4 flex items-center justify-between z-10">
              <div>
                <h3 className="font-bold text-[#1D1D1F]">{detail?.profile.companyName || (tr ? 'Firma Detayı' : 'Tenant Detail')}</h3>
                <p className="text-[10px] text-gray-400 font-mono">{detailId}</p>
              </div>
              <button onClick={closeDetail} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100"><X className="w-4 h-4 text-[#86868B]" /></button>
            </div>

            {detailLoading && <div className="p-10 text-center text-gray-400 text-sm">{tr ? 'Yükleniyor...' : 'Loading...'}</div>}

            {!detailLoading && detail && (
              <div className="p-5 space-y-5">
                {/* Genel / Profil — 2026-08-17'ye kadar salt-okunurdu (kullanıcı bildirimi) */}
                <section className="apple-card p-4">
                  <h4 className="text-xs font-bold text-[#86868B] uppercase mb-3 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" />{tr ? 'Firma Bilgileri' : 'Company Info'}</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-[11px] font-semibold text-[#86868B] mb-1">{tr ? 'Firma Adı' : 'Company Name'}</label>
                      <input value={pCompanyName} onChange={e => setPCompanyName(e.target.value)} className="apple-input w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#86868B] mb-1">{tr ? 'Vergi No' : 'Tax No'}</label>
                      <input value={pTaxNo} onChange={e => setPTaxNo(e.target.value)} className="apple-input w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#86868B] mb-1">{tr ? 'Vergi Dairesi' : 'Tax Office'}</label>
                      <input value={pTaxOffice} onChange={e => setPTaxOffice(e.target.value)} className="apple-input w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#86868B] mb-1 flex items-center gap-1"><Mail className="w-3 h-3" />E-posta</label>
                      <input value={pEmail} onChange={e => setPEmail(e.target.value)} className="apple-input w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#86868B] mb-1 flex items-center gap-1"><Phone className="w-3 h-3" />{tr ? 'Telefon' : 'Phone'}</label>
                      <input value={pPhone} onChange={e => setPPhone(e.target.value)} className="apple-input w-full text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] font-semibold text-[#86868B] mb-1">IBAN</label>
                      <input value={pIban} onChange={e => setPIban(e.target.value)} className="apple-input w-full text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] font-semibold text-[#86868B] mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />{tr ? 'Adres' : 'Address'}</label>
                      <input value={pAddress} onChange={e => setPAddress(e.target.value)} className="apple-input w-full text-sm" />
                    </div>
                  </div>
                  <button onClick={() => void saveProfile()} disabled={savingProfile} className="apple-button-primary text-sm px-4 py-2 mt-3 disabled:opacity-50">{savingProfile ? (tr ? 'Kaydediliyor...' : 'Saving...') : (tr ? 'Kaydet' : 'Save')}</button>
                </section>

                {/* Faturalandırma */}
                <section className="apple-card p-4">
                  <h4 className="text-xs font-bold text-[#86868B] uppercase mb-3 flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" />{tr ? 'Faturalandırma' : 'Billing'}</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#86868B] mb-1">{tr ? 'Plan' : 'Plan'}</label>
                      <select value={fPlan} aria-label={tr ? 'Plan' : 'Plan'} onChange={e => { setFPlan(e.target.value); const pr = PLAN_PRICES[e.target.value]?.[fCycle === 'yearly' ? 'yearly' : 'monthly']; if (pr) setPayAmount(String(pr)); }} className="apple-input w-full text-sm">
                        {PLAN_OPTIONS.map(p => <option key={p} value={p}>{planText(p)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#86868B] mb-1">{tr ? 'Dönem' : 'Cycle'}</label>
                      <select value={fCycle} aria-label={tr ? 'Dönem' : 'Cycle'} onChange={e => { setFCycle(e.target.value); const pr = PLAN_PRICES[fPlan]?.[e.target.value === 'yearly' ? 'yearly' : 'monthly']; if (pr) setPayAmount(String(pr)); }} className="apple-input w-full text-sm">
                        <option value="monthly">{tr ? 'Aylık' : 'Monthly'}</option>
                        <option value="yearly">{tr ? 'Yıllık' : 'Yearly'}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#86868B] mb-1">{tr ? 'Durum' : 'Status'}</label>
                      <select value={fStatus} aria-label={tr ? 'Durum' : 'Status'} onChange={e => setFStatus(e.target.value)} className="apple-input w-full text-sm">
                        <option value="active">{tr ? 'Aktif' : 'Active'}</option>
                        <option value="suspended">{tr ? 'Askıda' : 'Suspended'}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#86868B] mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" />{tr ? 'Sonraki Ödeme' : 'Next Payment'}</label>
                      <input type="date" value={fNextDate} aria-label={tr ? 'Sonraki ödeme tarihi' : 'Next payment date'} onChange={e => setFNextDate(e.target.value)} className="apple-input w-full text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] font-semibold text-[#86868B] mb-1">{tr ? 'Not' : 'Note'}</label>
                      <input value={fNote} aria-label={tr ? 'Not' : 'Note'} onChange={e => setFNote(e.target.value)} placeholder={tr ? 'Örn. ödeme bekleniyor' : 'e.g. awaiting payment'} className="apple-input w-full text-sm" />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => void saveBilling()} disabled={savingBilling} className="apple-button-primary text-sm px-4 py-2 disabled:opacity-50">{savingBilling ? (tr ? 'Kaydediliyor...' : 'Saving...') : (tr ? 'Kaydet' : 'Save')}</button>
                    <button onClick={() => { setPayOpen(true); setPayResult(null); }} className="apple-button-secondary text-sm px-4 py-2 flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5" />{tr ? 'Ödeme Linki Gönder' : 'Send Payment Link'}</button>
                  </div>
                </section>

                {/* Kullanıcılar — 2026-08-17'ye kadar salt-okunurdu (ekle/düzelt/sil
                    yoktu, kullanıcı bildirimi). Rol değişimi + kaldırma cross-tenant
                    yazma gerektirdiğinden ayrı super-admin uçları eklendi. */}
                <section className="apple-card p-4">
                  <h4 className="text-xs font-bold text-[#86868B] uppercase mb-3 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />{tr ? 'Kullanıcılar' : 'Users'} ({detail.users.length})</h4>
                  <div className="space-y-1.5">
                    {detail.users.map(u => {
                      const isOwner = u.uid === detailId;
                      return (
                        <div key={u.uid} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-gray-50 last:border-0">
                          <div className="min-w-0">
                            <div className="text-[#1D1D1F] truncate">{u.name || u.email}{isOwner && <span className="ml-1.5 text-[9px] font-bold text-brand">{tr ? 'SAHİP' : 'OWNER'}</span>}</div>
                            <div className="text-[11px] text-gray-400 truncate">{u.email}</div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <select
                              value={u.role}
                              disabled={userBusy === u.uid}
                              onChange={e => void changeUserRole(u.uid, e.target.value)}
                              aria-label={tr ? 'Rol' : 'Role'}
                              className="text-[11px] px-1.5 py-1 rounded-lg bg-gray-100 text-gray-700 font-semibold border-0 outline-none disabled:opacity-50"
                            >
                              {USER_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                            </select>
                            <button
                              onClick={() => void removeUser(u.uid, u.email)}
                              disabled={isOwner || userBusy === u.uid}
                              title={isOwner ? (tr ? 'Firma sahibi kaldırılamaz' : 'Owner cannot be removed') : (tr ? 'Kaldır' : 'Remove')}
                              className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-400 disabled:opacity-30 disabled:hover:bg-transparent"
                            ><UserMinus className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      );
                    })}
                    {detail.users.length === 0 && <p className="text-xs text-gray-400">{tr ? 'Kullanıcı yok.' : 'No users.'}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-100">
                    <input
                      type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                      placeholder={tr ? 'yeni@kullanici.com' : 'new@user.com'}
                      className="apple-input flex-1 text-sm py-1.5"
                    />
                    <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} aria-label={tr ? 'Davet rolü' : 'Invite role'} className="apple-input text-sm py-1.5 w-28">
                      {USER_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                    </select>
                    <button onClick={() => void inviteUser()} disabled={inviting || !inviteEmail.trim()} className="apple-button-secondary text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-50 shrink-0">
                      <UserPlus className="w-3.5 h-3.5" />{inviting ? (tr ? 'Gönderiliyor...' : 'Sending...') : (tr ? 'Davet Et' : 'Invite')}
                    </button>
                  </div>
                </section>

                {/* ── Yedek kurulumu — ZORUNLU onboarding adımı ── */}
                <section className="apple-card p-4">
                  <h4 className="text-xs font-bold text-[#86868B] uppercase mb-1 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" />{tr ? 'Yedek Hedefi' : 'Backup Target'}
                  </h4>
                  <p className="text-[11px] text-[#86868B] mb-3 leading-relaxed">
                    {tr
                      ? 'Bu firma YALNIZ kendi verisiyle, KENDİ hesabına yedeklenir. Hedef tanımlanmadan firmanın hiçbir yedeği alınmaz.'
                      : 'This company is backed up with ONLY its own data, to ITS OWN account. Without a target, nothing is backed up.'}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <input
                      value={backupRemote}
                      onChange={e => setBackupRemote(e.target.value)}
                      placeholder="gdrive-musteri-a:cetpa-yedek"
                      aria-label={tr ? 'rclone hedefi' : 'rclone target'}
                      className="apple-input flex-1 text-sm py-1.5 font-mono"
                    />
                    <button
                      onClick={() => void saveBackup()}
                      disabled={backupSaving}
                      className="apple-button-secondary text-xs px-3 py-1.5 disabled:opacity-50 shrink-0"
                    >{backupSaving ? (tr ? 'Kaydediliyor...' : 'Saving...') : (tr ? 'Kaydet' : 'Save')}</button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2">
                    {tr
                      ? 'Sunucuda önce `rclone config` ile bu firma için ayrı bir remote oluşturulmalı. Kurulum: docs/YEDEK-RCLONE.md'
                      : 'Create a separate rclone remote for this company on the server first. See docs/YEDEK-RCLONE.md'}
                  </p>
                </section>

                {/* Ödeme geçmişi */}
                <section className="apple-card p-4">
                  <h4 className="text-xs font-bold text-[#86868B] uppercase mb-3 flex items-center gap-1.5"><Receipt className="w-3.5 h-3.5" />{tr ? 'Ödeme Geçmişi' : 'Payment History'} ({detail.invoices.length})</h4>
                  <div className="space-y-1.5">
                    {detail.invoices.map(inv => (
                      <div key={inv.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                        <div>
                          <div className="text-[#1D1D1F] font-medium">{fmtMoney(inv.amount, inv.currency)}</div>
                          <div className="text-[11px] text-gray-400">{planText(inv.plan || '')} · {fmtDate(inv.createdMs || inv.createdAt, currentLanguage)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${inv.status === 'paid' ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>{inv.status === 'paid' ? (tr ? 'Ödendi' : 'Paid') : (tr ? 'Bekliyor' : 'Pending')}</span>
                          {inv.paymentPageUrl && <button onClick={() => void copyLink(inv.paymentPageUrl!)} className="text-gray-400 hover:text-brand" title={tr ? 'Linki kopyala' : 'Copy link'}><Copy className="w-3.5 h-3.5" /></button>}
                        </div>
                      </div>
                    ))}
                    {detail.invoices.length === 0 && <p className="text-xs text-gray-400 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" />{tr ? 'Henüz ödeme kaydı yok.' : 'No payments yet.'}</p>}
                  </div>
                </section>
              </div>
            )}
          </div>

          {/* Ödeme linki modalı (drawer üstünde) */}
          {payOpen && (
            <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/40" onClick={e => { e.stopPropagation(); if (!payBusy) setPayOpen(false); }}>
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-[#f0f0f2]">
                  <h3 className="font-bold text-[#1D1D1F] flex items-center gap-2"><Link2 className="w-4 h-4 text-brand" />{tr ? 'Ödeme Linki' : 'Payment Link'}</h3>
                  <button onClick={() => setPayOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100"><X className="w-4 h-4 text-[#86868B]" /></button>
                </div>
                {!payResult ? (
                  <>
                    <div className="p-5 space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <label className="block text-[11px] font-semibold text-[#86868B] mb-1">{tr ? 'Tutar' : 'Amount'}</label>
                          <input type="number" value={payAmount} aria-label={tr ? 'Tutar' : 'Amount'} onChange={e => setPayAmount(e.target.value)} className="apple-input w-full text-sm" />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-[#86868B] mb-1">{tr ? 'Para Birimi' : 'Currency'}</label>
                          <select value={payCurrency} aria-label={tr ? 'Para birimi' : 'Currency'} onChange={e => setPayCurrency(e.target.value)} className="apple-input w-full text-sm"><option>TRY</option><option>USD</option><option>EUR</option></select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-[#86868B] mb-1">{tr ? 'Müşteri E-postası' : 'Customer Email'}</label>
                        <input value={payEmail} aria-label={tr ? 'Müşteri e-postası' : 'Customer email'} onChange={e => setPayEmail(e.target.value)} className="apple-input w-full text-sm" />
                      </div>
                      <label className="flex items-center gap-2 text-sm text-[#1D1D1F] cursor-pointer">
                        <input type="checkbox" checked={paySendEmail} onChange={e => setPaySendEmail(e.target.checked)} className="w-4 h-4 accent-[#ff4000]" />
                        <Mail className="w-3.5 h-3.5 text-[#86868B]" />{tr ? 'Linki müşteriye e-posta ile gönder' : 'Email the link to customer'}
                      </label>
                      <p className="text-[11px] text-gray-400">{tr ? 'Link İyzico üzerinden güvenli ödeme sayfası oluşturur.' : 'Creates a secure iyzico payment page.'}</p>
                    </div>
                    <div className="flex gap-3 p-5 pt-0">
                      <button onClick={() => setPayOpen(false)} disabled={payBusy} className="apple-button-secondary flex-1">{tr ? 'Vazgeç' : 'Cancel'}</button>
                      <button onClick={() => void createLink()} disabled={payBusy} className="apple-button-primary flex-1 disabled:opacity-50">{payBusy ? (tr ? 'Oluşturuluyor...' : 'Creating...') : (tr ? 'Link Oluştur' : 'Create Link')}</button>
                    </div>
                  </>
                ) : (
                  <div className="p-5 space-y-4">
                    <div className="flex items-center gap-2 text-green-600 text-sm font-semibold"><Check className="w-4 h-4" />{payResult.emailed ? (tr ? 'Link oluşturuldu ve e-posta gönderildi.' : 'Link created & emailed.') : (tr ? 'Link oluşturuldu.' : 'Link created.')}</div>
                    <div className="bg-gray-50 rounded-xl p-3 text-xs text-[#1D1D1F] break-all font-mono">{payResult.url}</div>
                    <div className="flex gap-3">
                      <button onClick={() => void copyLink(payResult.url)} className="apple-button-secondary flex-1 flex items-center justify-center gap-1.5">{copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}{copied ? (tr ? 'Kopyalandı' : 'Copied') : (tr ? 'Kopyala' : 'Copy')}</button>
                      <a href={payResult.url} target="_blank" rel="noreferrer" className="apple-button-primary flex-1 text-center">{tr ? 'Linki Aç' : 'Open Link'}</a>
                    </div>
                    <button onClick={() => { setPayResult(null); }} className="text-xs text-[#86868B] hover:text-[#1D1D1F] w-full text-center">{tr ? 'Yeni link oluştur' : 'Create another'}</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

