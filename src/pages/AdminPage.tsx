import React, { useState, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  BarChart3, Users, Shield, Activity, FileText, Building2,
  List, Package,
  RefreshCw, Upload, Mail, Image as ImageIcon, Search,
} from 'lucide-react';
import { db, storage } from '../firebase';
import {
  doc, setDoc, updateDoc, deleteDoc,
  collection, onSnapshot,
} from '../lib/dbClient';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { logFirestoreError as handleFirestoreError, OperationType } from '../utils/firebase';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import DocumentDesigner from '../components/DocumentDesigner';
import SuperAdminPanel from '../components/SuperAdminPanel';
import { authFetch } from '../services/authFetch';
import { UserRole, type LucaConfig, type MikroConfig } from '../types';
import type { Lead, Order, InventoryItem, InventoryMovement, Employee } from '../types';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

type AdminTabId = 'overview' | 'users' | 'access' | 'auditlog' | 'system' | 'company' | 'evrak' | 'tenants';
type AccessVal = '✅' | '👁' | '📊' | '❌';

// Rol Simülatörü'nde İngilizce enum değeri (RBAC/Firestore'un kullandığı gerçek
// değer) yerine Türkçe görünen ad — yalnız görünüm katmanı, setUserRole'e giden
// değeri değiştirmez.
const ROL_ADI_TR: Record<UserRole, string> = {
  [UserRole.Admin]: 'Yönetici', [UserRole.Manager]: 'Müdür', [UserRole.Sales]: 'Satış',
  [UserRole.Logistics]: 'Lojistik', [UserRole.Accounting]: 'Muhasebe', [UserRole.HR]: 'İK',
  [UserRole.Purchasing]: 'Satın Alma', [UserRole.B2B]: 'B2B', [UserRole.Dealer]: 'Bayi',
  [UserRole.Legal]: 'Hukuk', [UserRole.Corporate]: 'Kurumsal', [UserRole.Quality]: 'Kalite',
};

const ACCESS_VALUES = ['✅', '👁', '📊', '❌'] as const;
const DEFAULT_ACCESS_MATRIX: { section: string; access: AccessVal[] }[] = [
  { section: 'Dashboard',         access: ['✅','✅','📊','📊','📊','📊','📊'] },
  { section: 'CRM & Satış',       access: ['✅','✅','👁','✅','❌','❌','👁'] },
  { section: 'Envanter',          access: ['✅','✅','👁','👁','✅','❌','✅'] },
  { section: 'Lojistik & Depo',   access: ['✅','✅','👁','👁','✅','❌','👁'] },
  { section: 'Muhasebe & Finans', access: ['✅','👁','✅','❌','❌','❌','❌'] },
  { section: 'Satın Alma',        access: ['✅','✅','👁','❌','✅','❌','✅'] },
  { section: 'İnsan Kaynakları',  access: ['✅','✅','👁','❌','❌','✅','❌'] },
  { section: 'Risk & Uyarılar',   access: ['✅','✅','✅','👁','👁','❌','👁'] },
  { section: 'Raporlar',          access: ['✅','✅','✅','📊','📊','📊','📊'] },
  { section: 'Entegrasyonlar',    access: ['✅','👁','❌','❌','❌','❌','❌'] },
  { section: 'Admin',             access: ['✅','❌','❌','❌','❌','❌','❌'] },
];

interface Props {
  adminTab: AdminTabId;
  setAdminTab: (tab: AdminTabId) => void;
  isSuperAdmin?: boolean;
  kpiCurrency: 'TRY' | 'USD' | 'EUR';
  setKpiCurrency: (c: 'TRY' | 'USD' | 'EUR') => void;
  canAccess: (tab: string) => boolean;
  hasFullAccess: (tab: string) => boolean;
  currentLanguage: 'tr' | 'en';
  currentT: Record<string, string>;
  orders: Order[];
  leads: Lead[];
  inventory: InventoryItem[];
  exchangeRates: Record<string, number> | null;
  employees: Employee[];
  inventoryMovements: InventoryMovement[];
  userRole: string;
  user: { email?: string | null; uid?: string; providerData?: { providerId: string }[] } | null;
  isOwnerAdmin: boolean;
  auditLogs: Record<string, unknown>[];
  companySettings: Record<string, unknown>;
  setCompanySettings: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  notifPrefs: Record<string, boolean>;
  toggleNotifPref: (key: string) => void;
  accessMatrix: { section: string; access: AccessVal[] }[];
  setAccessMatrix: React.Dispatch<React.SetStateAction<{ section: string; access: AccessVal[] }[]>>;
  firestoreUsers: Record<string, unknown>[];
  mikroSettings: Partial<MikroConfig>;
  lucaSettings: Partial<LucaConfig>;
  setUserRole: (role: UserRole) => void;
  openConfirm: (opts: { title: string; message: string; confirmLabel?: string; variant?: 'danger' | 'default'; onConfirm: () => void }) => void;
  toast: (msg: string, type?: string) => void;
  logAuditAction: (action: string, details: string) => Promise<void>;
  setActiveTab: (tab: string) => void;
}

export default function AdminPage({
  adminTab, setAdminTab, isSuperAdmin = false, kpiCurrency, setKpiCurrency,
  canAccess, hasFullAccess, currentLanguage, currentT,
  orders, leads, inventory, exchangeRates, employees, inventoryMovements,
  userRole, user, isOwnerAdmin,
  auditLogs, companySettings, setCompanySettings,
  notifPrefs, toggleNotifPref, accessMatrix, setAccessMatrix,
  firestoreUsers, mikroSettings, lucaSettings, setUserRole, openConfirm,
  toast, logAuditAction, setActiveTab,
}: Props) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Sales');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [p571AuditFilter, setP571AuditFilter] = useState('');
  const [p571AuditAction, setP571AuditAction] = useState<string>('all');
  const [healthData, setHealthData] = useState<{
    status: string; uptime: number; env: string;
    firebase: boolean; postgres?: boolean; resend: boolean; whatsapp: boolean; iyzico: boolean;
    timestamp: string;
  } | null>(null);
  const [statsData, setStatsData] = useState<Record<string, number> | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // ── Son client hataları (clientErrors koleksiyonu, append-only) ──────────
  type ClientError = { id: string; kind?: string; message?: string; url?: string;
    userEmail?: string | null; source?: string; timestamp?: { toMillis?: () => number } };
  const [clientErrors, setClientErrors] = useState<ClientError[]>([]);
  useEffect(() => {
    if (adminTab !== 'system') return;
    const unsub = onSnapshot(collection(db, 'clientErrors'), snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as ClientError));
      rows.sort((a, b) => (b.timestamp?.toMillis?.() ?? 0) - (a.timestamp?.toMillis?.() ?? 0));
      setClientErrors(rows.slice(0, 50));
    }, () => { /* RBAC reddi / offline — sessiz */ });
    return () => unsub();
     
  }, [adminTab]);

  const fetchSystemHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const [hr, sr] = await Promise.all([fetch('/api/health'), authFetch('/api/admin/stats')]);
      if (hr.ok) setHealthData(await hr.json() as typeof healthData);
      if (sr.ok) { const sd = await sr.json() as { counts: Record<string, number> }; setStatsData(sd.counts); }
    } catch { /* ignore — offline */ }
    setHealthLoading(false);
  }, []);

  useEffect(() => {
    if (adminTab === 'system') void fetchSystemHealth();
  }, [adminTab, fetchSystemHealth]);

  const fmtKpi = (v: number, fmt: 'full' | 'K' = 'full', decimals = 0): string => {
    const usd = exchangeRates?.USD ?? 32;
    const eur = exchangeRates?.EUR ?? 35;
    const rate = kpiCurrency === 'USD' ? usd : kpiCurrency === 'EUR' ? eur : 1;
    const sym = kpiCurrency === 'USD' ? '$' : kpiCurrency === 'EUR' ? '€' : '₺';
    const locale = kpiCurrency === 'USD' ? 'en-US' : kpiCurrency === 'EUR' ? 'de-DE' : 'tr-TR';
    const cv = v / rate;
    if (fmt === 'K') return `${sym}${(cv / 1000).toFixed(decimals)}K`;
    return `${sym}${cv.toLocaleString(locale, { maximumFractionDigits: decimals })}`;
  };


  const defaultAccessMatrix = DEFAULT_ACCESS_MATRIX;
  const ref = storageRef;

  return (
    <motion.div key="admin" initial={{opacity:0,x:20}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-20}} className="space-y-4">
    {/* Admin Sub-tab Nav (hidden on desktop — sidebar handles nav) */}
    <div className="lg:hidden overflow-x-auto scrollbar-none">
      <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
        {([
          { id: 'overview', label: currentLanguage==='tr'?'Genel Bakış':'Overview', icon: BarChart3 },
          { id: 'users', label: currentLanguage==='tr'?'Kullanıcılar':'Users', icon: Users },
          { id: 'access', label: currentLanguage==='tr'?'Erişim Yönetimi':'Access Control', icon: Shield },
          { id: 'auditlog', label: currentLanguage==='tr'?'Audit Log':'Audit Log', icon: FileText },
          { id: 'system', label: currentLanguage==='tr'?'Sistem Durumu':'System Status', icon: Activity },
          { id: 'company', label: currentLanguage==='tr'?'Şirket Ayarları':'Company Settings', icon: Building2 },
          { id: 'evrak', label: currentLanguage==='tr'?'Evrak Tasarımı':'Document Design', icon: FileText },
          ...(isSuperAdmin ? [{ id: 'tenants' as const, label: currentLanguage==='tr'?'Müşteri Yönetimi':'Customer Mgmt', icon: Building2 }] : []),
        ] as const).map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setAdminTab(tab.id)}
              className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${adminTab === tab.id ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}>
              <Icon size={13} />{tab.label}
            </button>
          );
        })}
      </div>
    </div>

    {/* OVERVIEW */}
    {adminTab === 'overview' && (
      <div className="space-y-4">
        {/* Department performance KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: currentLanguage==='tr'?'Toplam Sipariş':'Total Orders', value: String(orders.length), color: 'text-brand', icon: Package, tab: 'orders' },
            { label: currentLanguage==='tr'?'Aktif Müşteri':'Active Customers', value: String(new Set(orders.map(o=>o.customerName).filter(Boolean)).size), color: 'text-blue-600', icon: Users, tab: 'crm' },
            { label: currentLanguage==='tr'?'Envanter':'Inventory Items', value: String(inventory.length), color: 'text-purple-600', icon: List, tab: 'inventory' },
          ].map((kpi,i) => {
            const Icon = kpi.icon;
            return (
              <div key={i} className="apple-card p-4 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setActiveTab(kpi.tab)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 font-medium">{kpi.label}</span>
                  <Icon size={16} className={kpi.color} />
                </div>
                <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
              </div>
            );
          })}
          {/* Revenue card with currency toggle */}
          {(() => {
            const totalTRY = orders.reduce((s,o)=>s+(o.totalPrice||0),0);
            const rate = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
            const converted = kpiCurrency === 'TRY' ? totalTRY : totalTRY / rate;
            const symbol = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
            return (
              <div className="apple-card p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab('reports')}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 font-medium">{currentLanguage==='tr'?'Toplam Ciro':'Total Revenue'}</span>
                  <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5" onClick={e => e.stopPropagation()}>
                    {(['TRY','USD','EUR'] as const).map(c => (
                      <button key={c} onClick={() => setKpiCurrency(c)}
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency===c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                        {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-2xl font-bold text-green-600">{symbol}{converted.toLocaleString('tr-TR',{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
              </div>
            );
          })()}
        </div>

        {/* Department Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Departman Performansı':'Department Performance'}</h3>
            <div className="space-y-3">
              {[
                { name: currentLanguage==='tr'?'CRM & Satış':'CRM & Sales', value: orders.length, max: Math.max(orders.length, 1), color: 'bg-brand', unit: currentLanguage==='tr'?'sipariş':'orders' },
                { name: currentLanguage==='tr'?'Envanter':'Inventory', value: inventory.filter(i=>i.stockLevel>i.lowStockThreshold).length, max: Math.max(inventory.length,1), color: 'bg-blue-500', unit: currentLanguage==='tr'?'aktif ürün':'active items' },
                { name: currentLanguage==='tr'?'Muhasebe':'Accounting', value: orders.length > 0 ? Math.round((orders.filter(o => o.status === 'Delivered').length / orders.length) * 100) : 0, max: 100, color: 'bg-green-500', unit: '%' },
              ].map((dept,i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">{dept.name}</span>
                    <span className="text-gray-500 text-xs">{dept.value} {dept.unit}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${dept.color} rounded-full transition-all`} style={{width:`${Math.min(100,(dept.value/dept.max)*100)}%`}} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Bekleyen İşler':'Pending Actions'}</h3>
            <div className="space-y-2">
              {[
                { label: currentLanguage==='tr'?'Düşük stok uyarısı':'Low stock alerts', count: inventory.filter(i=>i.stockLevel<=i.lowStockThreshold).length, color: 'text-orange-500', bg: 'bg-orange-50' },
                { label: currentLanguage==='tr'?'Geciken ödeme':'Overdue payments', count: orders.filter(o=>o.status==='Cancelled').length, color: 'text-red-500', bg: 'bg-red-50' },
                { label: currentLanguage==='tr'?'Aktif teklif':'Active quotes', count: orders.filter(o=>o.status==='Pending').length, color: 'text-blue-500', bg: 'bg-blue-50' },
              ].map((item,i) => (
                <div key={i} className={`flex items-center justify-between p-3 ${item.bg} rounded-xl`}>
                  <span className="text-sm font-medium text-gray-700">{item.label}</span>
                  <span className={`text-lg font-bold ${item.color}`}>{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Son Siparişler':'Recent Orders'}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">{currentLanguage==='tr'?'Müşteri':'Customer'}</th>
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">{currentLanguage==='tr'?'Tutar':'Amount'}</th>
                  <th className="text-center py-2 px-3 text-gray-500 font-medium hidden sm:table-cell">{currentLanguage==='tr'?'Durum':'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0,8).map((o,i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-3 font-medium text-gray-800">{o.customerName||'—'}</td>
                    <td className="py-2.5 px-3 text-right font-semibold text-brand">{fmtKpi((o.totalPrice||0),'full',2)}</td>
                    <td className="py-2.5 px-3 text-center hidden sm:table-cell">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${o.status==='Delivered'?'bg-green-100 text-green-600':o.status==='Pending'?'bg-yellow-100 text-yellow-600':'bg-gray-100 text-gray-500'}`}>{o.status||'—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )}

    {/* USERS */}
    {adminTab === 'users' && (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-gray-800">{currentLanguage==='tr'?'Kullanıcı Yönetimi':'User Management'}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{firestoreUsers.length} {currentLanguage==='tr'?'kullanıcı':'users'}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">{currentLanguage==='tr'?'Kullanıcı':'User'}</th>
                  <th className="text-left py-2 px-3 text-gray-500 font-medium hidden sm:table-cell">E-posta</th>
                  <th className="text-center py-2 px-3 text-gray-500 font-medium">{currentLanguage==='tr'?'Rol':'Role'}</th>
                  <th className="text-center py-2 px-3 text-gray-500 font-medium">{currentLanguage==='tr'?'İşlem':'Action'}</th>
                </tr>
              </thead>
              <tbody>
                {firestoreUsers.length > 0 ? firestoreUsers.map((u: Record<string, unknown>) => (
                  <tr key={u.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center text-brand font-bold text-xs">
                          {((u.email as string)||(u.displayName as string)||'?')[0].toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-800 text-xs">{(u.displayName as string)||(u.email as string)?.split('@')[0]||'Kullanıcı'}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 text-xs hidden sm:table-cell">{(u.email as string)||'—'}</td>
                    <td className="py-2.5 px-3 text-center">
                      <select
                        value={(u.role as string)||'Sales'}
                        onChange={async (e) => {
                          try {
                            await updateDoc(doc(db, 'users', u.id as string), { role: e.target.value });
                          } catch { console.debug('error updating role'); }
                        }}
                        className="text-[10px] font-bold px-2 py-1 rounded-lg bg-gray-100 border-none cursor-pointer"
                      >
                        {(['Admin','Manager','Accounting','Sales','Logistics','HR','Purchasing','B2B','Dealer'] as string[]).map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {u.id !== user?.uid && (
                        <button
                          onClick={() => {
                            openConfirm({
                              title: currentLanguage === 'tr' ? 'Kullanıcıyı Sil' : 'Delete User',
                              message: currentLanguage === 'tr' ? 'Bu kullanıcıyı silmek istediğinizden emin misiniz?' : 'Are you sure you want to delete this user?',
                              variant: 'danger',
                              onConfirm: async () => {
                                try {
                                  await deleteDoc(doc(db, 'users', u.id as string));
                                } catch (error) {
                                  handleFirestoreError(error, OperationType.DELETE, `users/${u.id}`);
                                }
                              }
                            });
                          }}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                        >
                          {currentLanguage === 'tr' ? 'Sil' : 'Delete'}
                        </button>
                      )}
                      {u.id === user?.uid && (
                        <span className="text-[10px] text-gray-400">{currentLanguage==='tr'?'(Siz)':'(You)'}</span>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} className="text-center py-8 text-gray-400 text-xs">{currentLanguage==='tr'?'Veritabanında kullanıcı kaydı bulunamadı. Kullanıcılar ilk giriş yaptıklarında buraya eklenir.':'No user records in the database. Users are added here when they first log in.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Invite User ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center">
              <Mail size={16} className="text-blue-500" />
            </div>
            <div>
              <h3 className="font-bold text-gray-800 text-sm">{currentLanguage==='tr'?'Kullanıcı Davet Et':'Invite User'}</h3>
              <p className="text-xs text-gray-400">{currentLanguage==='tr'?'E-posta ile davet linki gönder':'Send an invite link via email'}</p>
            </div>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!inviteEmail.trim()) return;
              setInviteLoading(true);
              try {
                const r = await authFetch('/api/admin/invite', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
                });
                const d = await r.json() as { success: boolean; notConfigured?: boolean; error?: string };
                if (d.success) {
                  toast(currentLanguage === 'tr' ? `Davet gönderildi: ${inviteEmail}` : `Invite sent to ${inviteEmail}`, 'success');
                  setInviteEmail('');
                } else if (d.notConfigured) {
                  toast(currentLanguage === 'tr' ? 'E-posta servisi yapılandırılmamış. Ayarlar > Resend API anahtarını girin.' : 'Email not configured. Add Resend API key in Settings.', 'error');
                } else {
                  toast(d.error || 'Davet gönderilemedi', 'error');
                }
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Hata', 'error');
              } finally {
                setInviteLoading(false);
              }
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="ornek@sirket.com"
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand transition-colors"
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand transition-colors"
            >
              {(['Admin','Manager','Sales','Logistics','Accounting','HR','Purchasing','B2B','Dealer'] as string[]).map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={inviteLoading || !inviteEmail}
              className="apple-button-primary flex items-center gap-1.5 disabled:opacity-50 shrink-0"
            >
              {inviteLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {currentLanguage === 'tr' ? 'Davet Gönder' : 'Send Invite'}
            </button>
          </form>
          <p className="text-[10px] text-gray-400 mt-2">
            {currentLanguage === 'tr'
              ? 'Davet edilen kullanıcı, e-posta üzerinden kayıt olabilir. Rol ataması önceden yapılır.'
              : 'The invited user can register via email. The role is pre-assigned.'}
          </p>
        </div>

        {/* Role Simulator */}
        <div className="bg-white rounded-2xl shadow-sm border border-amber-100 p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center">
              <Shield size={16} className="text-amber-500" />
            </div>
            <div>
              <h3 className="font-bold text-gray-800 text-sm">{currentLanguage==='tr'?'Rol Simülatörü':'Role Simulator'}</h3>
              <p className="text-xs text-gray-400">{currentLanguage==='tr'?'Farklı rollerin UI\'sini test edin':'Test the UI as different roles'}</p>
            </div>
          </div>
          {/* Düğme metni role'ün TÜRKÇE karşılığı; setUserRole'e giden değer değişmedi
              (RBAC/Firestore'daki role alanı İngilizce enum — bu yalnız görünüm katmanı).
              Eskiden {role} ham enum değerini basıyordu ("Admin" yerine "Manager" gibi
              çevirisiz İngilizce metin — Türkçe arayüzde göze batıyordu). */}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {([UserRole.Admin, UserRole.Manager, UserRole.Sales, UserRole.Logistics, UserRole.Accounting, UserRole.HR, UserRole.Purchasing, UserRole.B2B, UserRole.Dealer] as UserRole[]).map(role => (
              <button key={role} onClick={() => setUserRole(role)}
                className={cn(
                  'px-2 py-2 rounded-xl text-xs font-bold border transition-all',
                  userRole === role
                    ? 'bg-brand text-white border-brand shadow-sm'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-100'
                )}>
                {currentLanguage === 'tr' ? ROL_ADI_TR[role] ?? role : role}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-amber-600 mt-3 bg-amber-50 rounded-lg px-2 py-1.5">
            ⚠️ {currentLanguage==='tr'?'Bu simülasyon sadece UI görünümünü değiştirir. Gerçek erişim kuralları sunucu tarafında uygulanır.':'This simulation only changes UI appearance. Actual access rules are enforced server-side.'}
          </p>
        </div>
      </div>
    )}

    {/* ACCESS CONTROL */}
    {adminTab === 'access' && (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-800 mb-2">{currentLanguage==='tr'?'Departman Erişim Matrisi':'Department Access Matrix'}</h3>
          <p className="text-xs text-gray-500 mb-4">{currentLanguage==='tr'?'Her rolün hangi bölümlere erişebileceğini görün':'See which sections each role can access'}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-gray-600 font-bold min-w-[140px]">{currentLanguage==='tr'?'Bölüm':'Section'}</th>
                  {['Admin','Manager','Muhasebe','Satış','Depo','IK','Satın Alma'].map(role => (
                    <th key={role} className="py-2 px-2 text-center text-gray-500 font-semibold whitespace-nowrap">{role}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accessMatrix.map((row, i) => (
                  <tr key={i} className={`border-b border-gray-50 ${i%2===0?'bg-white':'bg-gray-50/50'}`}>
                    <td className="py-2.5 px-3 font-semibold text-gray-700">{row.section}</td>
                    {row.access.map((cell, j) => (
                      <td key={j} className="py-2.5 px-2 text-center">
                        <button
                          className="text-base hover:scale-125 transition-transform cursor-pointer"
                          title="Tıklayarak değiştir"
                          onClick={() => {
                            const next = ACCESS_VALUES[(ACCESS_VALUES.indexOf(cell) + 1) % ACCESS_VALUES.length];
                            setAccessMatrix(prev => prev.map((r, ri) => ri === i ? { ...r, access: r.access.map((v, vi) => vi === j ? next : v) as AccessVal[] } : r));
                          }}
                        >{cell}</button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-500">
            <span>✅ Tam erişim</span><span>👁 Sadece okuma</span><span>📊 Kendi departmanı</span><span>❌ Erişim yok</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button onClick={() => setAccessMatrix(defaultAccessMatrix)} className="text-xs text-gray-400 hover:text-gray-600 underline">Varsayılana sıfırla</button>
            <span className="text-xs text-green-600">✓ Değişiklikler otomatik kaydedilir (oturum boyunca)</span>
          </div>
          <div className="mt-3 p-3 bg-amber-50 rounded-xl text-xs text-amber-700">
            {currentLanguage==='tr'?'Rol tabanlı kısıtlamalar gelecek bir fazda aktif hale getirilecektir. Şu an tüm giriş yapmış kullanıcılar admin haklarına sahiptir.':'Role-based restrictions will be activated in a future phase. Currently all logged-in users have admin rights.'}
          </div>
        </div>
      </div>
    )}

    {/* AUDIT LOG — Phase 571: Enhanced with search + action filter */}
    {adminTab === 'auditlog' && (() => {
      const tr571 = currentLanguage === 'tr';
      // Derive unique actions
      const uniqueActions = Array.from(new Set(auditLogs.map(l => (l.action as string) || '').filter(Boolean)));
      const filtered571 = auditLogs.filter(log => {
        const matchSearch = !p571AuditFilter ||
          ((log.userEmail as string)||'').toLowerCase().includes(p571AuditFilter.toLowerCase()) ||
          ((log.details as string)||'').toLowerCase().includes(p571AuditFilter.toLowerCase()) ||
          ((log.action as string)||'').toLowerCase().includes(p571AuditFilter.toLowerCase());
        const matchAction = p571AuditAction === 'all' || (log.action as string) === p571AuditAction;
        return matchSearch && matchAction;
      });

      return (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-400" />
                <h3 className="font-bold text-gray-800">{tr571?'Sistem Denetim İzi':'System Audit Trail'}</h3>
                <span className="text-[10px] text-gray-400">({filtered571.length}/{auditLogs.length})</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input className="apple-input pl-8 text-xs py-1.5 w-48" placeholder={tr571?'Kullanıcı, aksiyon, detay…':'User, action, detail…'}
                    value={p571AuditFilter} onChange={e => setP571AuditFilter(e.target.value)} />
                </div>
                <select className="apple-input text-xs py-1.5 px-2" value={p571AuditAction} onChange={e => setP571AuditAction(e.target.value)}>
                  <option value="all">{tr571?'Tüm Aksiyonlar':'All Actions'}</option>
                  {uniqueActions.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-2 px-3 text-[10px] font-bold text-gray-400 uppercase">{tr571?'Zaman':'Time'}</th>
                    <th className="text-left py-2 px-3 text-[10px] font-bold text-gray-400 uppercase hidden sm:table-cell">{tr571?'Kullanıcı':'User'}</th>
                    <th className="text-left py-2 px-3 text-[10px] font-bold text-gray-400 uppercase">{tr571?'Aksiyon':'Action'}</th>
                    <th className="text-left py-2 px-3 text-[10px] font-bold text-gray-400 uppercase hidden md:table-cell">{tr571?'Detay':'Detail'}</th>
                    <th className="text-left py-2 px-3 text-[10px] font-bold text-gray-400 uppercase hidden lg:table-cell">{tr571?'IP / Cihaz':'IP / Device'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered571.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-xs">{tr571?'Sonuç bulunamadı.':'No results found.'}</td></tr>
                  ) : (
                    filtered571.map((log: Record<string, unknown>, i: number) => {
                      const ts = (log.createdAt as {toDate?:()=>Date})?.toDate?.()
                        ?? ((log.timestamp as {toDate?:()=>Date})?.toDate?.())
                        ?? (log.createdAt ? new Date(log.createdAt as string) : null);
                      const action = (log.action as string) || '—';
                      const actionColor = action.includes('DELETE') || action.includes('Sil') ? 'bg-red-100 text-red-700'
                        : action.includes('CREATE') || action.includes('Oluştur') ? 'bg-emerald-100 text-emerald-700'
                        : action.includes('UPDATE') || action.includes('Güncelle') ? 'bg-blue-100 text-blue-700'
                        : 'bg-brand/10 text-brand';
                      return (
                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                          <td className="py-2.5 px-3 text-xs text-gray-500 whitespace-nowrap font-mono">
                            {ts ? ts.toLocaleString(tr571?'tr-TR':'en-US') : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-600 hidden sm:table-cell">{(log.userEmail as string)||(log.userName as string)||'—'}</td>
                          <td className="py-2.5 px-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${actionColor}`}>{action}</span>
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-500 hidden md:table-cell max-w-[320px]">
                            <span className="block truncate">{(log.details as string)||(log.description as string)||'—'}</span>
                            {(() => {
                              const diff = log.diff as Record<string, { from: unknown; to: unknown }> | undefined;
                              if (!diff || !Object.keys(diff).length) return null;
                              const fmt = (v: unknown) => v === undefined || v === null || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40);
                              return (
                                <div className="mt-1 space-y-0.5">
                                  {Object.entries(diff).slice(0, 5).map(([field, ch]) => (
                                    <div key={field} className="text-[10px] flex items-center gap-1 flex-wrap">
                                      <span className="font-semibold text-gray-600">{field}:</span>
                                      <span className="text-red-500 line-through">{fmt(ch.from)}</span>
                                      <span className="text-gray-300">→</span>
                                      <span className="text-emerald-600">{fmt(ch.to)}</span>
                                    </div>
                                  ))}
                                  {Object.keys(diff).length > 5 && <span className="text-[10px] text-gray-400">+{Object.keys(diff).length - 5} alan</span>}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-400 hidden lg:table-cell font-mono">{(log.ip as string)||'—'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    })()}

    {/* SYSTEM STATUS */}
    {adminTab === 'system' && (
      <div className="space-y-6">
        {/* Refresh button */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
            {currentLanguage === 'tr' ? 'Sistem Sağlık Durumu' : 'System Health'}
          </h3>
          <button
            onClick={() => void fetchSystemHealth()}
            disabled={healthLoading}
            className="apple-button-secondary flex items-center gap-2 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
            {currentLanguage === 'tr' ? 'Yenile' : 'Refresh'}
          </button>
        </div>

        {/* Service connectivity cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {([
            {
              name: 'PostgreSQL',
              ok: healthData ? (healthData.postgres ?? healthData.firebase) : null,
              status: !healthData ? (currentLanguage==='tr' ? 'Bekleniyor' : 'Pending') : (healthData.postgres ?? healthData.firebase) ? (currentLanguage==='tr' ? 'Aktif' : 'Active') : (currentLanguage==='tr' ? 'Bağlantı Hatası' : 'Connection Error'),
              desc: currentLanguage==='tr' ? 'Gerçek zamanlı veritabanı (kendi sunucumuz)' : 'Real-time database (self-hosted)',
              optional: false,
              settingsTab: null as string|null,
            },
            {
              name: 'Firebase Auth',
              ok: true as boolean|null,
              status: user ? (currentLanguage==='tr' ? 'Giriş Yapıldı' : 'Authenticated') : (currentLanguage==='tr' ? 'Misafir (Anonim)' : 'Guest (Anonymous)'),
              desc: user?.email || 'anonymous',
              optional: false,
              settingsTab: null as string|null,
            },
            {
              name: 'TCMB Kur API',
              ok: !!exchangeRates as boolean|null,
              status: exchangeRates ? (currentLanguage==='tr' ? 'Bağlı' : 'Connected') : (currentLanguage==='tr' ? 'Bekleniyor' : 'Pending'),
              desc: exchangeRates ? `1 USD = ₺${(exchangeRates.USD||0).toFixed(2)}` : (currentLanguage==='tr' ? 'Güncelleniyor...' : 'Fetching...'),
              optional: false,
              settingsTab: null as string|null,
            },
            {
              name: 'Express Server',
              ok: !!healthData as boolean|null,
              status: healthData ? `${currentLanguage==='tr' ? 'Çalışıyor' : 'Running'} — ${Math.floor((healthData.uptime || 0) / 60)}m` : (currentLanguage==='tr' ? 'Bağlanılamadı' : 'Unreachable'),
              desc: healthData ? healthData.env : '—',
              optional: false,
              settingsTab: null as string|null,
            },
            {
              name: 'Resend (E-posta)',
              ok: healthData ? (healthData.resend ? true : null) : null,
              status: !healthData ? '…' : healthData.resend ? (currentLanguage==='tr' ? 'Yapılandırıldı' : 'Configured') : (currentLanguage==='tr' ? 'Yapılandırılmamış' : 'Not Configured'),
              desc: currentLanguage==='tr' ? 'Haftalık rapor & davet emaili' : 'Weekly report & invite emails',
              optional: true,
              settingsTab: 'settings' as string|null,
            },
            {
              name: 'WhatsApp (Twilio)',
              ok: healthData ? (healthData.whatsapp ? true : null) : null,
              status: !healthData ? '…' : healthData.whatsapp ? (currentLanguage==='tr' ? 'Yapılandırıldı' : 'Configured') : (currentLanguage==='tr' ? 'Yapılandırılmamış' : 'Not Configured'),
              desc: currentLanguage==='tr' ? 'Kargo bildirim mesajları' : 'Shipping notification messages',
              optional: true,
              settingsTab: 'settings' as string|null,
            },
            {
              name: 'İyzico (Ödeme)',
              ok: healthData ? (healthData.iyzico ? true : null) : null,
              status: !healthData ? '…' : healthData.iyzico ? (currentLanguage==='tr' ? 'Yapılandırıldı' : 'Configured') : (currentLanguage==='tr' ? 'Yapılandırılmamış' : 'Not Configured'),
              desc: currentLanguage==='tr' ? 'B2B ödeme entegrasyonu' : 'B2B payment integration',
              optional: true,
              settingsTab: 'settings' as string|null,
            },
            {
              name: 'Shopify',
              ok: true as boolean|null,
              status: currentLanguage==='tr' ? 'Manuel Sync' : 'Manual Sync',
              desc: currentLanguage==='tr' ? 'Son sync: manuel' : 'Last sync: manual',
              optional: false,
              settingsTab: null as string|null,
            },
          ] as { name: string; ok: boolean|null; status: string; desc: string; optional: boolean; settingsTab: string|null }[]).map((s, i) => {
            // ok=true → green, ok=false → red (required) or gray (optional not configured), ok=null → amber/pending
            const badge =
              s.ok === true  ? 'bg-green-100 text-green-700' :
              s.ok === false ? 'bg-red-100 text-red-600' :
              s.optional     ? 'bg-gray-100 text-gray-500' :
                               'bg-amber-100 text-amber-600';
            const dot = s.ok === true ? '●' : s.ok === false ? '●' : '○';
            return (
              <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-800 text-sm">{s.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{s.desc}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.ok !== true && s.optional && s.settingsTab && (
                      <button
                        onClick={() => setActiveTab(s.settingsTab!)}
                        className="text-[11px] font-semibold text-brand hover:underline whitespace-nowrap"
                      >
                        {currentLanguage==='tr' ? 'Yapılandır →' : 'Configure →'}
                      </button>
                    )}
                    <span className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap ${badge}`}>
                      {dot} {s.status}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Collection counts */}
        {statsData && (
          <div>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
              {currentLanguage === 'tr' ? 'Koleksiyon Kayıt Sayıları' : 'Collection Record Counts'}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Object.entries(statsData).map(([col, cnt]) => (
                <div key={col} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between">
                  <span className="text-xs text-gray-500 font-medium truncate">{col}</span>
                  <span className="text-sm font-black text-brand ml-2">{cnt.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Last refreshed */}
        {healthData && (
          <p className="text-xs text-gray-300 text-right">
            {currentLanguage === 'tr' ? 'Son güncelleme: ' : 'Last refreshed: '}
            {new Date(healthData.timestamp).toLocaleTimeString('tr-TR')}
          </p>
        )}

        {/* ── Phase 600: Entegrasyon Sağlık Durumu ───────────────────────────── */}
        {(() => {
          const tr600 = currentLanguage === 'tr';
          const integrations600 = [
            { name: 'Shopify', connected: !!(healthData as {shopify?:boolean}|null)?.shopify, lastSync: tr600?'Entegrasyon':'Integration', icon: '🛒', desc: tr600?'E-ticaret entegrasyonu':'E-commerce integration' },
            { name: 'Mikro', connected: !!(mikroSettings as {connected?:boolean})?.connected, lastSync: (mikroSettings as {lastSync?:string})?.lastSync ? new Date((mikroSettings as {lastSync:string}).lastSync).toLocaleString('tr-TR') : null, icon: '💼', desc: tr600?'ERP entegrasyonu (JumpBulut)':'ERP integration (JumpBulut)' },
            { name: 'Luca', connected: !!(lucaSettings as {connected?:boolean})?.connected, lastSync: (lucaSettings as {lastSync?:string})?.lastSync ? new Date((lucaSettings as {lastSync:string}).lastSync).toLocaleString('tr-TR') : null, icon: '📒', desc: tr600?'Muhasebe entegrasyonu':'Accounting integration' },
            { name: 'Logo', connected: false, lastSync: null, icon: '🐯', desc: tr600?'Logo Tiger/Go ERP':'Logo Tiger/Go ERP' },
            { name: 'Dynamics', connected: false, lastSync: null, icon: '🪟', desc: tr600?'Microsoft Dynamics 365 BC':'Microsoft Dynamics 365 BC' },
            { name: 'SAP B1', connected: false, lastSync: null, icon: '🔷', desc: tr600?'SAP Business One':'SAP Business One' },
            { name: 'Gemini AI', connected: true, lastSync: tr600?'Sürekli':'Continuous', icon: '🤖', desc: tr600?'Lead skorlama yapay zekası':'Lead scoring AI' },
            { name: 'Firebase', connected: true, lastSync: tr600?'Gerçek zamanlı':'Real-time', icon: '🔥', desc: tr600?'Veritabanı & kimlik doğrulama':'Database & auth' },
          ];
          const connectedCount = integrations600.filter(i=>i.connected).length;
          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">{tr600?'🔌 Entegrasyon Sağlık Durumu':'🔌 Integration Health'}</h3>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${connectedCount===integrations600.length?'bg-green-100 text-green-700':'bg-amber-100 text-amber-700'}`}>{connectedCount}/{integrations600.length} {tr600?'bağlı':'connected'}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {integrations600.map(integ=>(
                  <div key={integ.name} className={`rounded-xl border p-4 ${integ.connected?'bg-green-50/30 border-green-200':'bg-red-50/30 border-red-200'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{integ.icon}</span>
                      <p className="font-bold text-gray-800 text-sm">{integ.name}</p>
                      <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full ${integ.connected?'bg-green-100 text-green-700':'bg-red-100 text-red-600'}`}>{integ.connected?(tr600?'Bağlı':'Connected'):(tr600?'Bağlı Değil':'Not Connected')}</span>
                    </div>
                    <p className="text-xs text-gray-500">{integ.desc}</p>
                    {integ.lastSync&&<p className="text-[10px] text-gray-400 mt-1">{tr600?'Son sync:':'Last sync:'} {integ.lastSync}</p>}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── Son Client Hataları (clientErrors, append-only, salt-okuma) ── */}
        <div className="apple-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <span>🐛</span> {currentLanguage === 'tr' ? 'Son Uygulama Hataları' : 'Recent Client Errors'}
            </h3>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${clientErrors.length > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {clientErrors.length > 0
                ? `${clientErrors.length} ${currentLanguage === 'tr' ? 'kayıt' : 'records'}`
                : (currentLanguage === 'tr' ? 'Temiz' : 'Clean')}
            </span>
          </div>
          {clientErrors.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">
              {currentLanguage === 'tr' ? 'Kayıtlı hata yok. 👍' : 'No errors logged. 👍'}
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {clientErrors.map(e => {
                const ts = e.timestamp?.toMillis?.();
                const when = ts ? new Date(ts).toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US') : '—';
                return (
                  <div key={e.id} className="border border-gray-100 rounded-xl p-3 hover:bg-gray-50/60 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-gray-900 break-words">{e.message || '—'}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] text-gray-400">
                          {e.kind && <span className="font-bold uppercase text-red-500">{e.kind}</span>}
                          {e.source && <span className="font-mono">{e.source}</span>}
                          {e.url && <span className="truncate max-w-[200px]">{e.url.replace(/^https?:\/\/[^/]+/, '')}</span>}
                          {e.userEmail && <span>{e.userEmail}</span>}
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap shrink-0">{when}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3">
            * {currentLanguage === 'tr'
              ? 'Son 50 kayıt. Hata kayıtları değiştirilemez/silinemez (append-only denetim).'
              : 'Last 50 records. Error logs are immutable (append-only audit).'}
          </p>
        </div>
      </div>
    )}

    {/* COMPANY SETTINGS */}
    {adminTab === 'company' && (
      <div className="space-y-4">
        {/* Logo Upload */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Şirket Logosu':'Company Logo'}</h3>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0">
              {logoUrl
                ? <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                : <ImageIcon className="w-8 h-8 text-gray-300" />
              }
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-700 mb-1">{currentLanguage==='tr'?'Logo Yükle':'Upload Logo'}</p>
              <p className="text-xs text-gray-400 mb-3">{currentLanguage==='tr'?'PNG, JPG, SVG — maks 2MB':'PNG, JPG, SVG — max 2MB'}</p>
              <label className="cursor-pointer apple-button-primary">
                <Upload className="w-3.5 h-3.5" />
                {isUploadingLogo ? (currentLanguage==='tr'?'Yükleniyor...':'Uploading...') : (currentLanguage==='tr'?'Dosya Seç':'Choose File')}
                <input type="file" accept="image/*" className="hidden" disabled={isUploadingLogo}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || !user) return;
                    setIsUploadingLogo(true);
                    try {
                      const storageRef = ref(storage, `company/logo_${user.uid}`);
                      await uploadBytes(storageRef, file);
                      const url = await getDownloadURL(storageRef);
                      setLogoUrl(url);
                      setCompanySettings((prev: Record<string, unknown>) => ({ ...prev, logoUrl: url }));
                    } catch (err) {
                      console.error('Logo upload failed:', err);
                    } finally {
                      setIsUploadingLogo(false);
                    }
                  }}
                />
              </label>
            </div>
          </div>
        </div>



        {/* Company Info */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Şirket Bilgileri':'Company Information'}</h3>
          <div className="space-y-3">
            {[
              { label: currentLanguage==='tr'?'Şirket Adı':'Company Name', key: 'companyName', placeholder: 'CETPA Teknoloji A.Ş.' },
              { label: currentLanguage==='tr'?'Vergi No':'Tax No', key: 'taxNo', placeholder: '1234567890' },
              { label: currentLanguage==='tr'?'Vergi Dairesi':'Tax Office', key: 'taxOffice', placeholder: 'Kadıköy' },
              { label: currentLanguage==='tr'?'Adres':'Address', key: 'address', placeholder: 'İstanbul, Türkiye' },
              { label: 'E-posta', key: 'email', placeholder: 'info@cetpa.com.tr' },
              { label: currentLanguage==='tr'?'Telefon':'Phone', key: 'phone', placeholder: '+90 212 000 0000' },
              { label: currentLanguage==='tr'?'IBAN':'IBAN', key: 'iban', placeholder: 'TR00 0000 0000 0000 0000 0000 00' },
              { label: currentLanguage==='tr'?'Web Sitesi':'Website', key: 'website', placeholder: 'https://cetpa.com.tr' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                <input
                  type="text"
                  defaultValue={(companySettings[f.key] as string) || ''}
                  onChange={e => setCompanySettings((prev: Record<string, unknown>) => ({...prev, [f.key]: e.target.value}))}
                  placeholder={f.placeholder}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors"
                />
              </div>
            ))}

            {/* İmza / Footer alanı */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage==='tr'?'E-posta/PDF İmzası':'Email/PDF Signature'}</label>
              <textarea
                rows={3}
                defaultValue={(companySettings.signature as string) || ''}
                onChange={e => setCompanySettings((prev: Record<string, unknown>) => ({...prev, signature: e.target.value}))}
                placeholder={currentLanguage==='tr'?'CETPA Teknoloji A.Ş.\ninfo@cetpa.com.tr\n+90 212 000 0000':'CETPA Technology Inc.\ninfo@cetpa.com.tr\n+90 212 000 0000'}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors resize-none font-mono"
              />
            </div>

            <button
              onClick={async () => {
                try {
                  await setDoc(doc(db, 'settings', 'app'), { companySettings }, { merge: true });
                  logAuditAction('Ayar Değişikliği', 'Şirket ayarları kaydedildi');
                  toast(currentLanguage==='tr'?'Ayarlar kaydedildi!':'Settings saved!', 'success');
                } catch (error) {
                  handleFirestoreError(error, OperationType.WRITE, 'settings/app');
                  toast(currentLanguage==='tr'?'Hata oluştu!':'Error occurred!', 'error');
                }
              }}
              className="apple-button-primary w-full mt-2"
            >
              {currentLanguage==='tr'?'Kaydet':'Save'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Evrak Tasarımı ── */}
    {adminTab === 'evrak' && (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="py-2">
        <DocumentDesigner currentLanguage={currentLanguage} />
      </motion.div>
    )}

    {adminTab === 'tenants' && isSuperAdmin && (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="py-2">
        <SuperAdminPanel currentLanguage={currentLanguage} toast={toast as (m: string, t?: 'success' | 'error' | 'info') => void} />
      </motion.div>
    )}
    </motion.div>
  );
}
