import { useEffect, useState, useCallback } from 'react';
import { Building2, Users, RefreshCw, Search, ShieldOff, ShieldCheck, Crown } from 'lucide-react';
import { authedFetch } from '../lib/dbClient';
import { confirmAction } from '../lib/confirm';

interface Tenant {
  companyId: string;
  companyName: string;
  ownerEmail: string;
  userCount: number;
  plan: string;
  subStatus: string;
  status: string; // 'active' | 'suspended'
  createdAt: unknown;
}

interface Props {
  currentLanguage: string;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

/**
 * Süper-admin (SaaS operatörü) paneli — tüm kiracı firmaları listeler,
 * askıya alma/aktifleştirme yapılır. Sadece SUPER_ADMIN_EMAILS için görünür.
 */
export default function SuperAdminPanel({ currentLanguage, toast }: Props) {
  const tr = currentLanguage === 'tr';
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch('/api/superadmin/tenants');
      if (res.ok) {
        const data = await res.json() as { tenants: Tenant[] };
        setTenants(data.tenants || []);
      } else if (res.status === 403) {
        toast(tr ? 'Süper-admin yetkiniz yok.' : 'Super-admin access required.', 'error');
      }
    } catch {
      toast(tr ? 'Kiracılar yüklenemedi.' : 'Failed to load tenants.', 'error');
    }
    setLoading(false);
  }, [tr, toast]);

  useEffect(() => { void load(); }, [load]);

  const setStatus = async (t: Tenant, status: 'active' | 'suspended') => {
    const ok = await confirmAction(
      status === 'suspended'
        ? {
            title: tr ? 'Firmayı Askıya Al' : 'Suspend Company',
            message: tr
              ? `"${t.companyName}" askıya alınacak. Bu firmanın tüm kullanıcıları sisteme erişemeyecek. Emin misiniz?`
              : `"${t.companyName}" will be suspended. All its users will lose access. Are you sure?`,
            confirmLabel: tr ? 'Askıya Al' : 'Suspend',
            variant: 'danger',
          }
        : {
            title: tr ? 'Firmayı Aktifleştir' : 'Activate Company',
            message: tr
              ? `"${t.companyName}" yeniden aktifleştirilecek. Devam edilsin mi?`
              : `"${t.companyName}" will be re-activated. Continue?`,
            confirmLabel: tr ? 'Aktifleştir' : 'Activate',
            variant: 'warning',
          },
    );
    if (!ok) return;
    setBusy(t.companyId);
    try {
      const res = await authedFetch(`/api/superadmin/tenants/${encodeURIComponent(t.companyId)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setTenants(prev => prev.map(x => x.companyId === t.companyId ? { ...x, status } : x));
        toast(tr ? (status === 'suspended' ? 'Firma askıya alındı.' : 'Firma aktifleştirildi.') : 'Updated.', 'success');
      } else {
        toast(tr ? 'İşlem başarısız.' : 'Operation failed.', 'error');
      }
    } catch {
      toast(tr ? 'İşlem başarısız.' : 'Operation failed.', 'error');
    }
    setBusy(null);
  };

  const filtered = tenants.filter(t => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return t.companyName.toLowerCase().includes(s) || t.ownerEmail.toLowerCase().includes(s) || t.companyId.toLowerCase().includes(s);
  });

  const totalUsers = tenants.reduce((s, t) => s + t.userCount, 0);
  const suspended = tenants.filter(t => t.status === 'suspended').length;

  const planBadge = (plan: string) => {
    const map: Record<string, string> = {
      free: 'bg-gray-100 text-gray-600', starter: 'bg-blue-100 text-blue-600',
      pro: 'bg-purple-100 text-purple-600', enterprise: 'bg-amber-100 text-amber-700',
    };
    return map[plan?.toLowerCase()] || 'bg-gray-100 text-gray-600';
  };

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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="apple-card p-4">
          <div className="flex items-center gap-2 text-[#86868B] text-xs mb-1"><Building2 className="w-4 h-4" />{tr ? 'Toplam Firma' : 'Total Companies'}</div>
          <p className="text-2xl font-bold text-[#1D1D1F]">{tenants.length}</p>
        </div>
        <div className="apple-card p-4">
          <div className="flex items-center gap-2 text-[#86868B] text-xs mb-1"><Users className="w-4 h-4" />{tr ? 'Toplam Kullanıcı' : 'Total Users'}</div>
          <p className="text-2xl font-bold text-[#1D1D1F]">{totalUsers}</p>
        </div>
        <div className="apple-card p-4">
          <div className="flex items-center gap-2 text-[#86868B] text-xs mb-1"><ShieldCheck className="w-4 h-4" />{tr ? 'Aktif' : 'Active'}</div>
          <p className="text-2xl font-bold text-green-600">{tenants.length - suspended}</p>
        </div>
        <div className="apple-card p-4">
          <div className="flex items-center gap-2 text-[#86868B] text-xs mb-1"><ShieldOff className="w-4 h-4" />{tr ? 'Askıda' : 'Suspended'}</div>
          <p className="text-2xl font-bold text-red-500">{suspended}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 text-[#86868B] absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={tr ? 'Firma, sahip e-posta veya ID ara...' : 'Search company, owner email or ID...'}
          className="apple-input pl-9 w-full" />
      </div>

      {/* Table */}
      <div className="apple-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#86868B] border-b border-[#f0f0f2]">
                <th className="px-4 py-3 font-medium">{tr ? 'Firma' : 'Company'}</th>
                <th className="px-4 py-3 font-medium">{tr ? 'Sahip' : 'Owner'}</th>
                <th className="px-4 py-3 font-medium text-center">{tr ? 'Kullanıcı' : 'Users'}</th>
                <th className="px-4 py-3 font-medium">{tr ? 'Plan' : 'Plan'}</th>
                <th className="px-4 py-3 font-medium">{tr ? 'Durum' : 'Status'}</th>
                <th className="px-4 py-3 font-medium text-right">{tr ? 'İşlem' : 'Action'}</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="text-center py-10 text-gray-400 text-sm">{tr ? 'Yükleniyor...' : 'Loading...'}</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-gray-400 text-sm">{tr ? 'Kayıt bulunamadı.' : 'No records.'}</td></tr>}
              {!loading && filtered.map(t => (
                <tr key={t.companyId} className="border-b border-[#f7f7f8] last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[#1D1D1F]">{t.companyName}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{t.companyId.slice(0, 14)}</div>
                  </td>
                  <td className="px-4 py-3 text-[#1D1D1F]">{t.ownerEmail || '—'}</td>
                  <td className="px-4 py-3 text-center font-medium">{t.userCount}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${planBadge(t.plan)}`}>{t.plan}</span>
                  </td>
                  <td className="px-4 py-3">
                    {t.status === 'suspended'
                      ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600">{tr ? 'Askıda' : 'Suspended'}</span>
                      : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-600">{tr ? 'Aktif' : 'Active'}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {t.status === 'suspended'
                      ? <button disabled={busy === t.companyId} onClick={() => setStatus(t, 'active')}
                          className="text-xs font-semibold text-green-600 hover:bg-green-50 px-3 py-1.5 rounded-lg disabled:opacity-50">{tr ? 'Aktifleştir' : 'Activate'}</button>
                      : <button disabled={busy === t.companyId} onClick={() => setStatus(t, 'suspended')}
                          className="text-xs font-semibold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg disabled:opacity-50">{tr ? 'Askıya Al' : 'Suspend'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
