import { useEffect, useRef, useState } from 'react';
import { Building2, Users, RefreshCw, Search, ShieldOff, ShieldCheck, Crown, Pencil, X } from 'lucide-react';
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

const PLAN_OPTIONS = ['starter', 'professional', 'business', 'enterprise', 'free'] as const;
const PLAN_LABEL: Record<string, { tr: string; en: string }> = {
  starter: { tr: 'Başlangıç', en: 'Starter' },
  professional: { tr: 'Profesyonel', en: 'Professional' },
  business: { tr: 'İşletme', en: 'Business' },
  enterprise: { tr: 'Kurumsal', en: 'Enterprise' },
  free: { tr: 'Ücretsiz', en: 'Free' },
};

/**
 * Süper-admin (SaaS operatörü) paneli — tüm kiracı firmaları listeler,
 * plan/durum düzenler, askıya alma/aktifleştirme yapılır.
 * Sadece SUPER_ADMIN_EMAILS için görünür.
 */
export default function SuperAdminPanel({ currentLanguage, toast }: Props) {
  const tr = currentLanguage === 'tr';
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [editPlan, setEditPlan] = useState<string>('starter');
  const [editStatus, setEditStatus] = useState<string>('active');
  const [editNote, setEditNote] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // toast prop'u her render'da yeni referans olabilir → load'u ref ile sabitle
  // (yoksa useEffect sonsuz döngüye girer).
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const trRef = useRef(tr);
  trRef.current = tr;

  async function load() {
    setLoading(true);
    try {
      const res = await authedFetch('/api/superadmin/tenants');
      if (res.ok) {
        const data = await res.json() as { tenants: Tenant[] };
        setTenants(data.tenants || []);
      } else if (res.status === 403) {
        toastRef.current(trRef.current ? 'Süper-admin yetkiniz yok.' : 'Super-admin access required.', 'error');
      }
    } catch {
      toastRef.current(trRef.current ? 'Kiracılar yüklenemedi.' : 'Failed to load tenants.', 'error');
    }
    setLoading(false);
  }

  // Yalnızca mount'ta bir kez yükle; "Yenile" butonu manuel tetikler.
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

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

  const openEdit = (t: Tenant) => {
    setEditing(t);
    setEditPlan(PLAN_OPTIONS.includes(t.plan as typeof PLAN_OPTIONS[number]) ? t.plan : 'starter');
    setEditStatus(t.status === 'suspended' ? 'suspended' : 'active');
    setEditNote('');
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await authedFetch(`/api/superadmin/tenants/${encodeURIComponent(editing.companyId)}/update`, {
        method: 'POST',
        body: JSON.stringify({ plan: editPlan, status: editStatus, note: editNote }),
      });
      if (res.ok) {
        setTenants(prev => prev.map(x => x.companyId === editing.companyId ? { ...x, plan: editPlan, status: editStatus } : x));
        toast(tr ? 'Firma güncellendi.' : 'Tenant updated.', 'success');
        setEditing(null);
      } else {
        toast(tr ? 'Güncelleme başarısız.' : 'Update failed.', 'error');
      }
    } catch {
      toast(tr ? 'Güncelleme başarısız.' : 'Update failed.', 'error');
    }
    setSaving(false);
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
      professional: 'bg-purple-100 text-purple-600', business: 'bg-indigo-100 text-indigo-600',
      enterprise: 'bg-amber-100 text-amber-700',
    };
    return map[plan?.toLowerCase()] || 'bg-gray-100 text-gray-600';
  };
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
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${planBadge(t.plan)}`}>{planText(t.plan)}</span>
                  </td>
                  <td className="px-4 py-3">
                    {t.status === 'suspended'
                      ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600">{tr ? 'Askıda' : 'Suspended'}</span>
                      : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-600">{tr ? 'Aktif' : 'Active'}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(t)}
                        className="text-xs font-semibold text-[#1D1D1F] hover:bg-gray-100 px-3 py-1.5 rounded-lg flex items-center gap-1">
                        <Pencil className="w-3.5 h-3.5" />{tr ? 'Düzenle' : 'Edit'}
                      </button>
                      {t.status === 'suspended'
                        ? <button disabled={busy === t.companyId} onClick={() => setStatus(t, 'active')}
                            className="text-xs font-semibold text-green-600 hover:bg-green-50 px-3 py-1.5 rounded-lg disabled:opacity-50">{tr ? 'Aktifleştir' : 'Activate'}</button>
                        : <button disabled={busy === t.companyId} onClick={() => setStatus(t, 'suspended')}
                            className="text-xs font-semibold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg disabled:opacity-50">{tr ? 'Askıya Al' : 'Suspend'}</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => !saving && setEditing(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-[#f0f0f2]">
              <div>
                <h3 className="font-bold text-[#1D1D1F]">{tr ? 'Firmayı Düzenle' : 'Edit Tenant'}</h3>
                <p className="text-xs text-[#86868B] mt-0.5">{editing.companyName}</p>
              </div>
              <button onClick={() => setEditing(null)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100"><X className="w-4 h-4 text-[#86868B]" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#86868B] mb-1.5">{tr ? 'Plan' : 'Plan'}</label>
                <select value={editPlan} onChange={e => setEditPlan(e.target.value)} className="apple-input w-full">
                  {PLAN_OPTIONS.map(p => <option key={p} value={p}>{planText(p)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#86868B] mb-1.5">{tr ? 'Durum' : 'Status'}</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className="apple-input w-full">
                  <option value="active">{tr ? 'Aktif' : 'Active'}</option>
                  <option value="suspended">{tr ? 'Askıda' : 'Suspended'}</option>
                </select>
                {editStatus === 'suspended' && <p className="text-[11px] text-red-500 mt-1">{tr ? 'Askıya alınırsa firmanın tüm kullanıcıları erişemez.' : 'Suspending blocks all users of this company.'}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#86868B] mb-1.5">{tr ? 'Not (opsiyonel)' : 'Note (optional)'}</label>
                <input value={editNote} onChange={e => setEditNote(e.target.value)} placeholder={tr ? 'Örn. ödeme bekleniyor' : 'e.g. awaiting payment'} className="apple-input w-full" />
              </div>
            </div>
            <div className="flex gap-3 p-5 pt-0">
              <button onClick={() => setEditing(null)} disabled={saving} className="apple-button-secondary flex-1">{tr ? 'Vazgeç' : 'Cancel'}</button>
              <button onClick={() => void saveEdit()} disabled={saving} className="apple-button-primary flex-1 disabled:opacity-50">{saving ? (tr ? 'Kaydediliyor...' : 'Saving...') : (tr ? 'Kaydet' : 'Save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
