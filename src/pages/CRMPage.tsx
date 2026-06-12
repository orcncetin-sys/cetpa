import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Search, Filter, X, ChevronDown, ChevronUp, ChevronRight,
  ArrowLeft, BarChart3, BarChart2, Users, TrendingUp, TrendingDown,
  Star, Clock, CheckCircle, CheckCircle2, XCircle, AlertTriangle, AlertCircle,
  Mail, Phone, MapPin, Calendar, MessageSquare, FileText, Download,
  Edit, Edit2, Trash2, MoreHorizontal, Copy, ExternalLink, RefreshCw,
  DollarSign, Package, Tag, Eye, Lock, Activity, Globe, Zap,
  Target as TargetIcon, Award, Layers, GripVertical, Info, HelpCircle,
  Upload, Archive, UserCheck, UserX, UserPlus, Building2, List,
  Bell, Check, FileDown, Flame, GitBranch, Headphones, Kanban,
} from 'lucide-react';
import { db, auth, storage } from '../firebase';
import {
  doc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, serverTimestamp, Timestamp,
} from '../lib/dbClient';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Papa from 'papaparse';
import { logFirestoreError as handleFirestoreError, OperationType } from '../utils/firebase';
import { authFetch } from '../services/authFetch';
import { exportLeadsCSV } from '../utils/export';
import { formatCurrency } from '../utils/currency';
import { scoreLead } from '../services/geminiService';
import { pushMikroEvrak, ziyaretPayload } from '../services/mikroEvrak';
import AIInlineNudge from '../components/AIInlineNudge';
import ModuleHeader from '../components/ModuleHeader';
import AccountingModule from '../components/AccountingModule';
const CariEkstrePanel = React.lazy(() => import('../components/CariEkstrePanel'));
const MutabakatPanel  = React.lazy(() => import('../components/MutabakatPanel'));
const DealerCommissionPanel = React.lazy(() => import('../components/DealerCommissionPanel'));
import B2BPortal from '../components/B2BPortal';
import type {
  Lead, Order, Employee, InventoryItem,
  LeadActivity, VoiceNote, Warehouse,
} from '../types';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

const SortIcon = ({ col, config }: { col: string; config: { key: string; dir: 'asc' | 'desc' } }) => (
  <span className="inline-flex flex-col ml-0.5 opacity-40">
    <span style={{ fontSize: 8 }}>{config.key === col && config.dir === 'asc' ? '▲' : '▴'}</span>
    <span style={{ fontSize: 8 }}>{config.key === col && config.dir === 'desc' ? '▼' : '▾'}</span>
  </span>
);

interface CommissionRule { id: string; tier: string; targetAmount: number; commissionRate: number; bonusRate: number; period: 'monthly' | 'quarterly'; }
interface SupportTicket { id: string; title: string; customerName: string; description?: string; priority: 'low' | 'medium' | 'high'; status: 'open' | 'in_progress' | 'resolved'; orderId?: string; assignedTo?: string; createdAt?: unknown; }

interface Props {
  crmTab: string;
  setCrmTab: (tab: string) => void;
  selectedLead: Lead | null;
  setSelectedLead: React.Dispatch<React.SetStateAction<Lead | null>>;
  hasFullAccess: (tab: string) => boolean;
  currentLanguage: 'tr' | 'en';
  currentT: Record<string, string>;
  orders: Order[];
  leads: Lead[];
  inventory: InventoryItem[];
  exchangeRates: Record<string, number> | null;
  employees: Employee[];
  userRole: string;
  user: { email?: string | null; uid?: string; displayName?: string | null } | null;
  kpiCurrency: 'TRY' | 'USD' | 'EUR';
  setKpiCurrency: (c: 'TRY' | 'USD' | 'EUR') => void;
  appQuotations: Record<string, unknown>[];
  activeTab: string;
  darkMode: boolean;
  warehouses: Warehouse[];
  supportTickets: SupportTicket[];
  commissionRules: CommissionRule[];
  trackView: (item: { type: 'order' | 'lead' | 'product'; id: string; label: string; tab: string }) => void;
  setEditingLeadData: React.Dispatch<React.SetStateAction<Partial<Lead>>>;
  setIsEditingLead: React.Dispatch<React.SetStateAction<boolean>>;
  setEmailCompose: React.Dispatch<React.SetStateAction<{ open: boolean; to: string; name: string; subject: string; body: string }>>;
  setNewOrder: React.Dispatch<React.SetStateAction<Partial<Order>>>;
  setOrderCustomerSearch: React.Dispatch<React.SetStateAction<string>>;
  handleToggleOrderPaid: (order: Order) => void;
  openConfirm: (opts: { title: string; message: string; confirmLabel?: string; variant?: 'danger' | 'default'; onConfirm: () => void }) => void;
  toast: (msg: string, type?: string) => void;
  setActiveTab: (tab: string) => void;
  setIsAddingLead: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedOrder: React.Dispatch<React.SetStateAction<Order | null>>;
  setIsAddingOrder: React.Dispatch<React.SetStateAction<boolean>>;
  logAuditAction: (action: string, details: string) => Promise<void>;
}

export default function CRMPage({
  crmTab, setCrmTab, selectedLead, setSelectedLead,
  hasFullAccess, currentLanguage, currentT,
  orders, leads, inventory, exchangeRates, employees,
  userRole, user, kpiCurrency, setKpiCurrency,
  appQuotations, activeTab, darkMode, warehouses, supportTickets, commissionRules,
  trackView, setEditingLeadData, setIsEditingLead, setEmailCompose,
  setNewOrder, setOrderCustomerSearch, handleToggleOrderPaid, openConfirm,
  toast, setActiveTab, setIsAddingLead, setSelectedOrder, setIsAddingOrder,
  logAuditAction,
}: Props) {
  // ── Local state ──────────────────────────────────────────────────────────────
  const [crmSearch, setCrmSearch] = useState('');
  const [crmSort, setCrmSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [crmLeadSort, setCrmLeadSort] = useState<'default'|'score'|'activity'|'name'>('default');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkLeadLoading, setBulkLeadLoading] = useState(false);
  const [leadStatusFilter, setLeadStatusFilter] = useState<string>('All');
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [isAddingActivity, setIsAddingActivity] = useState(false);
  const [newActivity, setNewActivity] = useState<Partial<LeadActivity>>({ type: 'Note', description: '' });
  const [leadNoteText, setLeadNoteText] = useState('');
  const leadNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showLeadFunnel, setShowLeadFunnel] = useState(false);
  const [rescoreLeadId, setRescoreLeadId] = useState<string|null>(null);
  const [p515Dismissed, setP515Dismissed] = useState(false);
  const [p544QuickStatus, setP544QuickStatus] = useState<string|null>(null);
  const [p549Iadeler, setP549Iadeler] = useState<Array<{ id: string; orderId: string; customerName: string; items: string; reason: string; condition: string; notes?: string; status: string; decision?: string; createdAt?: unknown }>>([]);
  const [p549Form, setP549Form] = useState(false);
  const [p549Draft, setP549Draft] = useState({ orderId: '', customerName: '', items: '', reason: 'Hasarlı Ürün', condition: 'Hasarlı' as const, notes: '' });
  const [monthlyTarget, setMonthlyTarget] = useState<number>(0);
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState('');
  const [monthlyTargets, setMonthlyTargets] = useState<Record<string, number>>({});
  const [editingMonthKey, setEditingMonthKey] = useState<string | null>(null);
  const [editingMonthDraft, setEditingMonthDraft] = useState('');
  const [p581RepPeriod, setP581RepPeriod] = useState<'30d'|'90d'|'ytd'>('30d');
  const [p585TopN, setP585TopN] = useState(10);
  const [p586Targets, setP586Targets] = useState<Record<string,number>>({});
  const [p601Segment, setP601Segment] = useState<'rfm'|'revenue'|'type'>('rfm');
  const [p604CommRate, setP604CommRate] = useState(5);
  const [p606Campaigns, setP606Campaigns] = useState<Array<{id:string;name:string;sentDate:string;recipients:number;opens:number;clicks:number;conversions:number}>>([]);
  const [p606ShowForm, setP606ShowForm] = useState(false);
  const [p606Draft, setP606Draft] = useState({name:'',sentDate:'',recipients:'',opens:'',clicks:'',conversions:''});
  const [p613Metric, setP613Metric] = useState<'revenue'|'orders'|'risk'>('revenue');
  const [p626Period, setP626Period] = useState<'30d'|'90d'|'ytd'>('90d');
  const [p633Segment, setP633Segment] = useState<'all'|'champions'|'loyal'|'at-risk'|'lost'>('all');
  const [showTicketForm, setShowTicketForm] = useState(false);
  const [ticketForm, setTicketForm] = useState({ title: '', customerName: '', description: '', priority: 'medium' as 'low' | 'medium' | 'high', orderId: '' });
  const [campaignForm, setCampaignForm] = useState({ subject: '', body: '', segment: 'all' });
  const [campaignSending, setCampaignSending] = useState(false);
  const [campaignSent, setCampaignSent] = useState<{ count: number; ts: number } | null>(null);
  const [contracts, setContracts] = useState<Array<{ id: string; customerName: string; title: string; value: number; startDate: string; endDate: string; status: string; autoRenew: boolean; createdAt?: unknown }>>([]);
  const [contractForm, setContractForm] = useState({ customerName: '', title: '', value: 0, startDate: '', endDate: '', status: 'active', autoRenew: false });
  const [showContractForm, setShowContractForm] = useState(false);
  const [priceOverrides, setPriceOverrides] = useState<Array<{ id: string; requestedBy: string; customerName: string; productName: string; standardPrice: number; requestedPrice: number; reason: string; status: 'pending' | 'approved' | 'rejected'; createdAt?: unknown }>>([]);
  const [showPriceOverrideForm, setShowPriceOverrideForm] = useState(false);
  const [priceOverrideForm, setPriceOverrideForm] = useState({ customerName: '', productName: '', standardPrice: 0, requestedPrice: 0, reason: '' });
  const [showStmtModal, setShowStmtModal] = useState<string|null>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderSort, setOrderSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'syncedAt', dir: 'desc' });

  // ── Local utilities ──────────────────────────────────────────────────────────
  const sortData = <T,>(arr: T[], key: string, dir: 'asc' | 'desc'): T[] =>
    [...arr].sort((a: T, b: T) => {
      let av = (a as Record<string, unknown>)[key] as unknown;
      let bv = (b as Record<string, unknown>)[key] as unknown;
      if (av && typeof (av as Record<string, unknown>).toDate === 'function') av = (av as { toDate: () => Date }).toDate().getTime();
      if (bv && typeof (bv as Record<string, unknown>).toDate === 'function') bv = (bv as { toDate: () => Date }).toDate().getTime();
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av === undefined || av === null) av = '';
      if (bv === undefined || bv === null) bv = '';
      if (dir === 'asc') return av < bv ? -1 : av > bv ? 1 : 0;
      return av > bv ? -1 : av < bv ? 1 : 0;
    });

  const toggleSort = (
    current: { key: string; dir: 'asc' | 'desc' },
    key: string,
    setter: (v: { key: string; dir: 'asc' | 'desc' }) => void
  ) => setter({ key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' });

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

  const KpiCurrencyToggle = () => (
    <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
      {(['TRY', 'USD', 'EUR'] as const).map(c => (
        <button key={c} onClick={() => setKpiCurrency(c)}
          className={`text-[11px] font-bold px-2 py-1 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
          {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
        </button>
      ))}
    </div>
  );

  const saveMonthlyTarget = (monthKey: string, value: number) => {
    const curMonth = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; })();
    if (monthKey === curMonth) setMonthlyTarget(value);
    const updated = { ...monthlyTargets, [monthKey]: value };
    if (value === 0) delete updated[monthKey];
    setMonthlyTargets(updated);
    setDoc(doc(db, 'settings', 'targets'), updated, { merge: true }).catch(() => {});
  };

  const createNotification = async (title: string, message: string, type: 'info' | 'warning' | 'success' = 'info') => {
    try {
      await addDoc(collection(db, 'notifications'), { title, message, type, read: false, createdAt: serverTimestamp() });
    } catch { /* ignore */ }
  };

  const handleLeadNoteChange = (val: string) => {
    setLeadNoteText(val);
    if (leadNoteTimer.current) clearTimeout(leadNoteTimer.current);
    if (selectedLead) {
      leadNoteTimer.current = setTimeout(() => {
        updateDoc(doc(db, 'leads', selectedLead.id), { quickNote: val }).catch(() => {});
      }, 600);
    }
  };

  const handleUpdateLeadStatus = async (leadId: string, status: Lead['status']) => {
    try {
      await updateDoc(doc(db, 'leads', leadId), { status, updatedAt: serverTimestamp() });
      if (selectedLead && selectedLead.id === leadId) setSelectedLead({ ...selectedLead, status });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leads/${leadId}`);
    }
  };

  const handleUpdateFollowUpDate = async (date: string) => {
    if (!selectedLead) return;
    try {
      const nextFollowUpDate = Timestamp.fromDate(new Date(date));
      await updateDoc(doc(db, 'leads', selectedLead.id), { nextFollowUpDate });
      setSelectedLead({ ...selectedLead, nextFollowUpDate });
    } catch (error) {
      console.error('Error updating follow-up date:', error);
    }
  };

  const handleDeleteLead = async (leadId: string) => {
    try {
      const targetLead = leads.find(l => l.id === leadId);
      await deleteDoc(doc(db, 'leads', leadId));
      if (selectedLead?.id === leadId) setSelectedLead(null);
      logAuditAction(currentT.lead_deletion, `${targetLead?.name || leadId} ${currentT.lead_deleted}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `leads/${leadId}`);
    }
  };

  const handleAddActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    try {
      const activity: LeadActivity = {
        id: crypto.randomUUID(),
        type: newActivity.type as 'Call' | 'Email' | 'Meeting' | 'Note' | 'Visit',
        description: newActivity.description || '',
        date: Timestamp.now(),
      };
      const updatedActivities = [...(selectedLead.activities || []), activity];
      await updateDoc(doc(db, 'leads', selectedLead.id), { activities: updatedActivities, updatedAt: serverTimestamp() });
      setSelectedLead({ ...selectedLead, activities: updatedActivities });
      if (activity.type === 'Visit') {
        const cariKod = (selectedLead as unknown as { mikroCariKod?: string }).mikroCariKod;
        if (cariKod) {
          pushMikroEvrak('ZiyaretKaydetV2', ziyaretPayload({
            cariKod,
            basZamani: new Date().toISOString(),
            personelKod: (user?.email ?? '').split('@')[0].slice(0, 15),
          }), { entityType: 'leadVisit', entityId: selectedLead.id }).catch(() => {});
        }
      }
      setIsAddingActivity(false);
      setNewActivity({ type: 'Note', description: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leads/${selectedLead.id}`);
    }
  };

  const handleUploadVoiceNote = async (file: File) => {
    if (!selectedLead) return;
    try {
      const sRef = storageRef(storage, `leads/${selectedLead.id}/voiceNotes/${Date.now()}_${file.name}`);
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      const newNote: VoiceNote = { id: Date.now().toString(), url, createdAt: serverTimestamp() };
      const updatedNotes = [...((selectedLead.voiceNotes as VoiceNote[] | undefined) || []), newNote];
      await updateDoc(doc(db, 'leads', selectedLead.id), { voiceNotes: updatedNotes });
      setSelectedLead({ ...selectedLead, voiceNotes: updatedNotes });
    } catch (error) {
      console.error('Error uploading voice note:', error);
    }
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          let importedCount = 0;
          for (const row of results.data as Record<string, string>[]) {
            const firstName = row['First Name'] || '';
            const lastName = row['Last Name'] || '';
            const name = `${firstName} ${lastName}`.trim();
            const company = row['Default Address Company'] || name || 'Unknown Company';
            const email = row['Email'] || '';
            if (!name && !email) continue;
            await addDoc(collection(db, 'leads'), {
              name: name || company,
              company,
              email,
              phone: row['Phone'] || '',
              status: 'New',
              score: 0,
              customerType: 'B2B',
              createdAt: serverTimestamp(),
            });
            importedCount++;
          }
          toast(`${importedCount} ${currentLanguage === 'tr' ? 'lead içe aktarıldı' : 'leads imported'}`, 'success');
        } catch (error) {
          toast(currentLanguage === 'tr' ? 'İçe aktarma hatası' : 'Import error', 'error');
          console.error(error);
        }
      },
    });
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      logAuditAction(currentT.order_deletion || 'Order Deleted', orderId);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `orders/${orderId}`);
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, status: Order['status']) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), { status, updatedAt: serverTimestamp() });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  return (
    <>
      {!selectedLead && (
        <motion.div key="crm-pipeline" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
              <AIInlineNudge
                context="crm"
                currentLanguage={currentLanguage}
                data={{
                  overdueLeadCount: leads.filter(l => {
                    if (['Closed Won','Closed Lost','Closed'].includes(l.status)) return false;
                    if (!l.nextFollowUpDate) return false;
                    try { const d = typeof (l.nextFollowUpDate as {toDate?:()=>Date}).toDate==='function' ? (l.nextFollowUpDate as {toDate:()=>Date}).toDate() : new Date(l.nextFollowUpDate as string); return d < new Date(); } catch { return false; }
                  }).length
                }}
                onAction={() => {}}
              />
              {/* CRM Sub-tabs (hidden on desktop — sidebar handles nav) */}
              <div className="lg:hidden overflow-x-auto scrollbar-none -mx-3 px-3">
                <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max mb-2">
                  {[
                    { id: 'leads', label: currentLanguage === 'tr' ? 'Müşteri Adayları' : 'Leads', icon: Users },
                    { id: 'musteriler', label: currentLanguage === 'tr' ? 'Müşteriler' : 'Customers', icon: UserCheck },
                    { id: 'siparisler', label: currentLanguage === 'tr' ? 'Siparişler' : 'Orders', icon: Package },
                    { id: 'b2b', label: 'B2B Portal', icon: Globe },
                    { id: 'komisyon', label: currentLanguage === 'tr' ? 'Komisyon' : 'Commission', icon: TrendingUp },
                    { id: 'tickets', label: currentLanguage === 'tr' ? 'Destek' : 'Support', icon: MessageSquare },
                    { id: 'kampanya', label: currentLanguage === 'tr' ? 'Kampanyalar' : 'Campaigns', icon: Mail },
                    { id: 'sozlesmeler', label: currentLanguage === 'tr' ? 'Sözleşmeler' : 'Contracts', icon: FileText },
                    { id: 'fiyat-onay', label: currentLanguage === 'tr' ? 'Fiyat Onayı' : 'Price Approvals', icon: Tag },
                    { id: 'pipeline', label: currentLanguage === 'tr' ? 'Pipeline' : 'Pipeline', icon: Kanban },
                    { id: 'hedefler', label: currentLanguage === 'tr' ? 'Hedefler' : 'Targets', icon: TargetIcon },
                  ].map(tab => {
                    const Icon = tab.icon;
                    return (
                      <button key={tab.id} onClick={() => setCrmTab(tab.id)}
                        className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${crmTab === tab.id ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}>
                        <Icon size={13} /><span>{tab.label}</span>
                      </button>
                    );
                  })}
                  <div className="w-px h-5 bg-gray-200 self-center mx-0.5 shrink-0" />
                  <button onClick={() => setActiveTab('sube')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                    <GitBranch size={13} />
                    <span>{currentLanguage === 'tr' ? 'Şubeler' : 'Branches'}</span>
                  </button>
                  <button onClick={() => setActiveTab('servis')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                    <Headphones size={13} />
                    <span>{currentLanguage === 'tr' ? 'Servis' : 'Service'}</span>
                  </button>
                </div>
              </div>

              {/* CRM sub-tab: Müşteriler */}
              {crmTab === 'musteriler' && (
                <AccountingModule orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} exchangeRates={exchangeRates} initialTab="musteriler" allowedTabs={['musteriler']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}

              {/* CRM sub-tab: Siparişler */}
              {crmTab === 'siparisler' && (
                <div className="space-y-6">
                  <ModuleHeader
                    title={currentT.all_orders}
                    subtitle={currentT.manage_orders}
                    icon={Package}
                    actionButton={
                      <div className="flex items-center gap-4">
                        <div className="relative w-full sm:w-auto">
                          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            placeholder={currentT.search_orders}
                            value={orderSearch}
                            onChange={(e) => setOrderSearch(e.target.value)}
                            className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-full text-sm outline-none focus:border-brand w-full sm:w-64 transition-all"
                          />
                        </div>
                        <button onClick={() => { setSelectedLead(null); setIsAddingOrder(true); }}
                          className="apple-button-primary whitespace-nowrap">
                          <Plus className="w-4 h-4" /> {currentT.new_order}
                        </button>
                      </div>
                    }
                  />
                  <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider">{currentT.order_id}</th>
                            {[
                              { key: 'customerName', label: currentT.customer },
                              { key: 'syncedAt', label: currentT.date },
                              { key: 'status', label: currentT.status },
                            ].map(col => (
                              <th key={col.key}
                                className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider cursor-pointer select-none group hover:text-brand transition-colors"
                                onClick={() => toggleSort(orderSort, col.key, setOrderSort)}>
                                {col.label}<SortIcon col={col.key} config={orderSort} />
                              </th>
                            ))}
                            <th className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider text-right cursor-pointer select-none group hover:text-brand transition-colors"
                              onClick={() => toggleSort(orderSort, 'totalPrice', setOrderSort)}>
                              {currentT.total}<SortIcon col="totalPrice" config={orderSort} />
                            </th>
                            <th className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider text-right">{currentT.actions}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(() => {
                            const filtered = orders.filter(o =>
                              o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                              o.shopifyOrderId?.toLowerCase().includes(orderSearch.toLowerCase()) ||
                              o.shippingAddress?.toLowerCase().includes(orderSearch.toLowerCase())
                            );
                            const sorted = sortData(filtered, orderSort.key, orderSort.dir);
                            return sorted.length === 0 ? (
                              <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">{currentT.no_orders_found}</td></tr>
                            ) : sorted.map(order => (
                              <tr key={order.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setSelectedOrder(order)}>
                                <td className="px-6 py-4 font-medium text-[#1D2226]">{order.shopifyOrderId}</td>
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-700 font-medium">{order.customerName}</span>
                                    {/* Phase 46: CustomerType badge */}
                                    {order.customerType && (
                                      <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0", order.customerType === 'B2B' ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500")}>
                                        {order.customerType}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-gray-500">
                                  {order.syncedAt ? (typeof (order.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (order.syncedAt as { toDate: () => Date }).toDate() : new Date(order.syncedAt as unknown as string | number | Date)).toLocaleDateString() : 'Unknown Date'}
                                </td>
                                <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                                  <select value={order.status} onChange={(e) => {
                                    e.stopPropagation(); openConfirm({
                                      title: currentT.status,
                                      message: `Update status to "${e.target.value}"?`,
                                      onConfirm: () => handleUpdateOrderStatus(order.id, e.target.value as Order['status'])
                                    });
                                  }}
                                    className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded-full outline-none cursor-pointer appearance-none",
                                      order.status === 'Pending' ? "bg-amber-50 text-amber-600" :
                                        order.status === 'Processing' ? "bg-purple-50 text-purple-600" :
                                          order.status === 'Shipped' ? "bg-blue-50 text-blue-600" :
                                            order.status === 'Delivered' ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-600"
                                    )}>
                                    <option value="Pending">{currentT.pending}</option>
                                    <option value="Processing">{currentT.processing}</option>
                                    <option value="Shipped">{currentT.shipped}</option>
                                    <option value="Delivered">{currentT.delivered}</option>
                                    <option value="Cancelled">{currentT.cancelled}</option>
                                  </select>
                                </td>
                                <td className="px-6 py-4 text-right font-bold text-[#1D2226]">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {/* Phase 50: Notes indicator */}
                                    {order.notes && (
                                      <span title={order.notes} className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                                        <FileText className="w-2.5 h-2.5 text-amber-600" />
                                      </span>
                                    )}
                                    ₺{order.totalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                  <button onClick={() => handleDeleteOrder(order.id)} className="text-gray-400 hover:text-red-600 transition-colors p-1">
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* CRM sub-tab: B2B Portal */}
              {crmTab === 'b2b' && (
                <B2BPortal user={user as unknown as import('firebase/auth').User} userRole={userRole as unknown as import('../types').UserRole} leads={leads} inventory={inventory} orders={orders} currentT={currentT} currentLanguage={currentLanguage} exchangeRates={exchangeRates} />
              )}

              {crmTab === 'komisyon' && (
                <DealerCommissionPanel
                  currentLanguage={currentLanguage as 'tr' | 'en'}
                  isAuthenticated={!!user}
                  userRole={userRole}
                  leads={leads}
                  orders={orders}
                  exchangeRates={exchangeRates}
                />
              )}

              {/* ── Phase 111: Support Tickets ── */}
              {crmTab === 'tickets' && (
                <div className="space-y-4">
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'Destek Talepleri' : 'Support Tickets'}
                    subtitle={currentLanguage === 'tr' ? 'Müşteri sorunlarını ve şikayetlerini takip edin.' : 'Track customer issues and complaints.'}
                    icon={MessageSquare}
                    actionButton={
                      <button
                        onClick={() => setShowTicketForm(v => !v)}
                        className="apple-button-primary flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Yeni Talep' : 'New Ticket'}
                      </button>
                    }
                  />

                  {/* Ticket stats */}
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: currentLanguage === 'tr' ? 'Açık' : 'Open',          value: supportTickets.filter(t => t.status === 'open').length,        color: 'text-red-600',     bg: 'bg-red-50'     },
                      { label: currentLanguage === 'tr' ? 'İşlemde' : 'In Progress', value: supportTickets.filter(t => t.status === 'in_progress').length,  color: 'text-amber-600',   bg: 'bg-amber-50'   },
                      { label: currentLanguage === 'tr' ? 'Çözüldü' : 'Resolved',   value: supportTickets.filter(t => t.status === 'resolved').length,      color: 'text-emerald-600', bg: 'bg-emerald-50' },
                    ].map((s, i) => (
                      <div key={i} className={`apple-card p-4 ${s.bg} text-center`}>
                        <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
                        <p className="text-[10px] font-bold text-gray-400 mt-1">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* New ticket form */}
                  <AnimatePresence>
                    {showTicketForm && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-3 shadow-sm">
                          <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni Destek Talebi' : 'New Support Ticket'}</h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                              className="apple-input w-full"
                              placeholder={currentLanguage === 'tr' ? 'Konu başlığı' : 'Ticket title'}
                              value={ticketForm.title}
                              onChange={e => setTicketForm(f => ({ ...f, title: e.target.value }))}
                            />
                            <input
                              className="apple-input w-full"
                              placeholder={currentLanguage === 'tr' ? 'Müşteri adı' : 'Customer name'}
                              value={ticketForm.customerName}
                              onChange={e => setTicketForm(f => ({ ...f, customerName: e.target.value }))}
                            />
                          </div>
                          <textarea
                            className="apple-input w-full min-h-[72px] resize-none"
                            placeholder={currentLanguage === 'tr' ? 'Sorun açıklaması...' : 'Issue description...'}
                            value={ticketForm.description}
                            onChange={e => setTicketForm(f => ({ ...f, description: e.target.value }))}
                          />
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <label className="text-xs font-bold text-gray-500">{currentLanguage === 'tr' ? 'Öncelik' : 'Priority'}:</label>
                              {(['low', 'medium', 'high'] as const).map(p => (
                                <button
                                  key={p}
                                  onClick={() => setTicketForm(f => ({ ...f, priority: p }))}
                                  className={`text-[10px] font-bold px-2 py-1 rounded-full transition-all ${
                                    ticketForm.priority === p
                                      ? p === 'high' ? 'bg-red-500 text-white'
                                      : p === 'medium' ? 'bg-amber-400 text-white'
                                      : 'bg-gray-400 text-white'
                                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                  }`}
                                >
                                  {p === 'high' ? (currentLanguage === 'tr' ? 'Yüksek' : 'High')
                                    : p === 'medium' ? (currentLanguage === 'tr' ? 'Orta' : 'Medium')
                                    : (currentLanguage === 'tr' ? 'Düşük' : 'Low')}
                                </button>
                              ))}
                            </div>
                            <div className="ml-auto flex gap-2">
                              <button onClick={() => setShowTicketForm(false)} className="apple-button-secondary px-4 text-sm">
                                {currentLanguage === 'tr' ? 'İptal' : 'Cancel'}
                              </button>
                              <button
                                disabled={!ticketForm.title || !ticketForm.customerName}
                                onClick={async () => {
                                  if (!ticketForm.title || !ticketForm.customerName) return;
                                  try {
                                    await addDoc(collection(db, 'supportTickets'), {
                                      ...ticketForm, status: 'open',
                                      createdAt: serverTimestamp(), assignedTo: user?.displayName || user?.email || 'Sistem'
                                    });
                                    setTicketForm({ title: '', customerName: '', description: '', priority: 'medium', orderId: '' });
                                    setShowTicketForm(false);
                                    toast(currentLanguage === 'tr' ? 'Talep oluşturuldu.' : 'Ticket created.', 'success');
                                  } catch { toast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error.', 'error'); }
                                }}
                                className="apple-button-primary px-6 text-sm disabled:opacity-50"
                              >
                                {currentLanguage === 'tr' ? 'Oluştur' : 'Create'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Ticket list */}
                  <div className="space-y-2">
                    {supportTickets.length === 0 ? (
                      <div className="text-center py-16 bg-white border border-gray-100 rounded-2xl">
                        <MessageSquare size={40} className="mx-auto mb-3 text-gray-200" />
                        <p className="text-sm text-gray-400">{currentLanguage === 'tr' ? 'Henüz destek talebi yok.' : 'No support tickets yet.'}</p>
                      </div>
                    ) : (
                      supportTickets.map(ticket => {
                        const priorityBadge = ticket.priority === 'high'
                          ? 'bg-red-100 text-red-700'
                          : ticket.priority === 'medium'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-gray-100 text-gray-600';
                        const statusBadge = ticket.status === 'open'
                          ? 'bg-red-50 text-red-600'
                          : ticket.status === 'in_progress'
                          ? 'bg-blue-50 text-blue-600'
                          : 'bg-emerald-50 text-emerald-700';
                        const statusLabel = ticket.status === 'open'
                          ? (currentLanguage === 'tr' ? 'Açık' : 'Open')
                          : ticket.status === 'in_progress'
                          ? (currentLanguage === 'tr' ? 'İşlemde' : 'In Progress')
                          : (currentLanguage === 'tr' ? 'Çözüldü' : 'Resolved');
                        return (
                          <div key={ticket.id} className="bg-white border border-gray-100 rounded-xl p-4 flex items-start gap-4 shadow-sm hover:shadow-md transition-shadow">
                            <div className={`p-2 rounded-xl flex-shrink-0 ${ticket.priority === 'high' ? 'bg-red-50' : ticket.priority === 'medium' ? 'bg-amber-50' : 'bg-gray-50'}`}>
                              <MessageSquare className={`w-4 h-4 ${ticket.priority === 'high' ? 'text-red-500' : ticket.priority === 'medium' ? 'text-amber-500' : 'text-gray-400'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start gap-2 mb-1 flex-wrap">
                                <p className="text-sm font-bold text-gray-900 flex-1">{ticket.title}</p>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${priorityBadge}`}>
                                  {ticket.priority === 'high' ? '🔴' : ticket.priority === 'medium' ? '🟡' : '⚪'} {ticket.priority.toUpperCase()}
                                </span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${statusBadge}`}>{statusLabel}</span>
                              </div>
                              <p className="text-xs text-gray-500">{ticket.customerName}</p>
                              {ticket.description && <p className="text-[10px] text-gray-400 mt-1 line-clamp-2">{ticket.description}</p>}
                            </div>
                            {ticket.status !== 'resolved' && (
                              <button
                                onClick={async () => {
                                  const nextStatus = ticket.status === 'open' ? 'in_progress' : 'resolved';
                                  await updateDoc(doc(db, 'supportTickets', ticket.id), { status: nextStatus });
                                }}
                                className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-brand hover:text-white transition-all flex-shrink-0"
                              >
                                {ticket.status === 'open'
                                  ? (currentLanguage === 'tr' ? 'İşleme Al' : 'Start')
                                  : (currentLanguage === 'tr' ? 'Çöz' : 'Resolve')}
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* ── Phase 115: Email Campaign Manager ── */}
              {crmTab === 'kampanya' && (
                <div className="space-y-4">
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'E-posta Kampanyaları' : 'Email Campaigns'}
                    subtitle={currentLanguage === 'tr' ? 'Lead segmentlerine toplu e-posta gönderin.' : 'Send bulk emails to lead segments.'}
                    icon={Mail}
                  />

                  {campaignSent && (
                    <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4">
                      <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0" />
                      <p className="text-sm font-semibold text-emerald-800">
                        {currentLanguage === 'tr'
                          ? `Kampanya gönderildi! ${campaignSent.count} müşteriye e-posta iletildi.`
                          : `Campaign sent! Email dispatched to ${campaignSent.count} recipients.`}
                      </p>
                      <button onClick={() => setCampaignSent(null)} className="ml-auto text-emerald-400 hover:text-emerald-600"><X size={14} /></button>
                    </div>
                  )}

                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-4">
                    <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni Kampanya' : 'New Campaign'}</h3>

                    {/* Segment picker */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Hedef Segment' : 'Target Segment'}</label>
                      <div className="flex flex-wrap gap-2">
                        {([
                          { key: 'all',       label: currentLanguage === 'tr' ? `Tümü (${leads.length})` : `All (${leads.length})` },
                          { key: 'new',       label: currentLanguage === 'tr' ? `Yeni (${leads.filter(l => l.status === 'New').length})` : `New (${leads.filter(l => l.status === 'New').length})` },
                          { key: 'active',    label: currentLanguage === 'tr' ? `Nitelikli (${leads.filter(l => l.status === 'Qualified').length})` : `Qualified (${leads.filter(l => l.status === 'Qualified').length})` },
                          { key: 'highScore', label: currentLanguage === 'tr' ? `Yüksek Skor ≥70 (${leads.filter(l => (l.score || 0) >= 70).length})` : `High Score ≥70 (${leads.filter(l => (l.score || 0) >= 70).length})` },
                        ] as const).map(seg => (
                          <button
                            key={seg.key}
                            onClick={() => setCampaignForm(f => ({ ...f, segment: seg.key }))}
                            className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-all border ${
                              campaignForm.segment === seg.key
                                ? 'bg-brand text-white border-brand'
                                : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            {seg.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Konu' : 'Subject'}</label>
                      <input
                        className="apple-input w-full"
                        placeholder={currentLanguage === 'tr' ? 'E-posta konusu...' : 'Email subject...'}
                        value={campaignForm.subject}
                        onChange={e => setCampaignForm(f => ({ ...f, subject: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Mesaj' : 'Message'}</label>
                      <textarea
                        className="apple-input w-full min-h-[120px] resize-y"
                        placeholder={currentLanguage === 'tr' ? 'Mesaj içeriği... {{isim}} ile kişiselleştirebilirsiniz.' : 'Message body... Use {{name}} to personalize.'}
                        value={campaignForm.body}
                        onChange={e => setCampaignForm(f => ({ ...f, body: e.target.value }))}
                      />
                    </div>

                    {/* Preview + Send */}
                    <div className="flex items-center gap-3 pt-1">
                      <div className="flex-1">
                        {(() => {
                          const count = campaignForm.segment === 'all' ? leads.length
                            : campaignForm.segment === 'new' ? leads.filter(l => l.status === 'New').length
                            : campaignForm.segment === 'active' ? leads.filter(l => l.status === 'Qualified').length
                            : leads.filter(l => (l.score || 0) >= 70).length;
                          const withEmail = leads.filter(l => (l.email as string | undefined) && (
                            campaignForm.segment === 'all' ? true
                            : campaignForm.segment === 'new' ? l.status === 'New'
                            : campaignForm.segment === 'active' ? l.status === 'Qualified'
                            : (l.score || 0) >= 70
                          )).length;
                          return (
                            <p className="text-xs text-gray-500">
                              {currentLanguage === 'tr'
                                ? `${count} kişi seçili · ${withEmail} e-posta adresi var`
                                : `${count} leads selected · ${withEmail} have email addresses`}
                            </p>
                          );
                        })()}
                      </div>
                      <button
                        disabled={!campaignForm.subject || !campaignForm.body || campaignSending}
                        onClick={async () => {
                          setCampaignSending(true);
                          try {
                            // Determine recipients
                            const recipientLeads = leads.filter(l => {
                              const hasEmail = !!(l.email as string | undefined);
                              if (!hasEmail) return false;
                              if (campaignForm.segment === 'all') return true;
                              if (campaignForm.segment === 'new') return l.status === 'New';
                              if (campaignForm.segment === 'active') return l.status === 'Qualified';
                              return (l.score || 0) >= 70;
                            });
                            // Log campaign to Firestore first (get ID for status update)
                            const campaignRef = await addDoc(collection(db, 'campaigns'), {
                              subject: campaignForm.subject,
                              body: campaignForm.body,
                              segment: campaignForm.segment,
                              recipientCount: recipientLeads.length,
                              sentAt: serverTimestamp(),
                              sentBy: user?.email || 'guest',
                              status: 'sending',
                            });
                            // Call bulk email endpoint
                            const token = await auth.currentUser?.getIdToken();
                            const r = await fetch('/api/email/bulk-campaign', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                              body: JSON.stringify({
                                subject: campaignForm.subject,
                                body: campaignForm.body,
                                campaignId: campaignRef.id,
                                recipients: recipientLeads.map(l => ({ name: l.name as string || '', email: l.email as string })),
                              }),
                            });
                            const result = await r.json() as { sent?: number; failed?: number; notConfigured?: boolean };
                            setCampaignSent({ count: result.sent ?? recipientLeads.length, ts: Date.now() });
                            setCampaignForm({ subject: '', body: '', segment: 'all' });
                            if (result.notConfigured) {
                              toast(currentLanguage === 'tr' ? 'Kampanya kaydedildi (Resend API anahtarı yapılandırılmamış — e-posta gönderilmedi).' : 'Campaign saved (Resend API key not configured — emails not sent).', 'success');
                            } else {
                              toast(currentLanguage === 'tr' ? `${result.sent ?? 0} e-posta gönderildi ✓` : `${result.sent ?? 0} emails sent ✓`, 'success');
                            }
                          } catch (e) { console.error('[campaign-send]', e); toast(currentLanguage === 'tr' ? 'Kampanya gönderilemedi.' : 'Campaign send failed.', 'error'); }
                          finally { setCampaignSending(false); }
                        }}
                        className="apple-button-primary px-8 disabled:opacity-50 flex items-center gap-2"
                      >
                        <Mail className="w-4 h-4" />
                        {campaignSending
                          ? (currentLanguage === 'tr' ? 'Gönderiliyor...' : 'Sending...')
                          : (currentLanguage === 'tr' ? 'Kampanya Gönder' : 'Send Campaign')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Phase 606: E-posta Kampanya Analitik ─────────────────────────────── */}
              {crmTab === 'kampanya' && (() => {
                const tr606 = currentLanguage === 'tr';
                const totalRecip = p606Campaigns.reduce((s,c)=>s+c.recipients,0);
                const totalOpens = p606Campaigns.reduce((s,c)=>s+c.opens,0);
                const totalClicks = p606Campaigns.reduce((s,c)=>s+c.clicks,0);
                const totalConv = p606Campaigns.reduce((s,c)=>s+c.conversions,0);
                const avgOr = totalRecip>0?((totalOpens/totalRecip)*100).toFixed(1):'0';
                const avgCr = totalOpens>0?((totalClicks/totalOpens)*100).toFixed(1):'0';
                return (
                  <div className="apple-card p-5 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="font-bold text-gray-900 text-sm">📊 {tr606?'Kampanya Performans Analitik':'Campaign Performance Analytics'}</h3>
                      <button onClick={()=>setP606ShowForm(v=>!v)} className="apple-button-secondary flex items-center gap-1.5 text-xs">
                        <Plus className="w-3.5 h-3.5"/>{tr606?'Kampanya Ekle':'Add Campaign'}
                      </button>
                    </div>
                    {p606ShowForm && (
                      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <input className="apple-input col-span-2 sm:col-span-1" placeholder={tr606?'Kampanya adı':'Campaign name'} value={p606Draft.name} onChange={e=>setP606Draft(d=>({...d,name:e.target.value}))}/>
                          <input type="date" className="apple-input" value={p606Draft.sentDate} onChange={e=>setP606Draft(d=>({...d,sentDate:e.target.value}))}/>
                          <input type="number" className="apple-input" placeholder={tr606?'Alıcı':'Recipients'} value={p606Draft.recipients} onChange={e=>setP606Draft(d=>({...d,recipients:e.target.value}))}/>
                          <input type="number" className="apple-input" placeholder={tr606?'Açma':'Opens'} value={p606Draft.opens} onChange={e=>setP606Draft(d=>({...d,opens:e.target.value}))}/>
                          <input type="number" className="apple-input" placeholder={tr606?'Tıklama':'Clicks'} value={p606Draft.clicks} onChange={e=>setP606Draft(d=>({...d,clicks:e.target.value}))}/>
                          <input type="number" className="apple-input" placeholder={tr606?'Dönüşüm':'Conversions'} value={p606Draft.conversions} onChange={e=>setP606Draft(d=>({...d,conversions:e.target.value}))}/>
                        </div>
                        <button onClick={()=>{
                          if(!p606Draft.name||!p606Draft.sentDate) return;
                          setP606Campaigns(prev=>[...prev,{id:Date.now().toString(),name:p606Draft.name,sentDate:p606Draft.sentDate,recipients:Number(p606Draft.recipients)||0,opens:Number(p606Draft.opens)||0,clicks:Number(p606Draft.clicks)||0,conversions:Number(p606Draft.conversions)||0}]);
                          setP606Draft({name:'',sentDate:'',recipients:'',opens:'',clicks:'',conversions:''});
                          setP606ShowForm(false);
                          toast(tr606?'Kampanya eklendi.':'Campaign added.','success');
                        }} className="apple-button-primary text-xs px-6">{tr606?'Kaydet':'Save'}</button>
                      </div>
                    )}
                    {p606Campaigns.length > 0 && (
                      <>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            {label:tr606?'Toplam Kampanya':'Total Campaigns',val:p606Campaigns.length,color:'text-blue-600',bg:'bg-blue-50'},
                            {label:tr606?'Ort. Açma Oranı':'Avg Open Rate',val:`%${avgOr}`,color:'text-emerald-600',bg:'bg-emerald-50'},
                            {label:tr606?'Ort. Tıklama Oranı':'Avg Click Rate',val:`%${avgCr}`,color:'text-amber-600',bg:'bg-amber-50'},
                            {label:tr606?'Toplam Dönüşüm':'Total Conversions',val:totalConv,color:'text-purple-600',bg:'bg-purple-50'},
                          ].map(k=>(
                            <div key={k.label} className={`rounded-xl p-3 ${k.bg}`}>
                              <p className="text-[10px] font-bold text-gray-400 uppercase">{k.label}</p>
                              <p className={`text-xl font-black ${k.color}`}>{k.val}</p>
                            </div>
                          ))}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-100 bg-gray-50">
                              {[tr606?'Kampanya':'Campaign',tr606?'Tarih':'Date',tr606?'Alıcı':'Recip.',tr606?'Açma %':'Open %',tr606?'Tıklama %':'Click %',tr606?'Dönüşüm':'Conv.'].map(h=>(
                                <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                              ))}
                            </tr></thead>
                            <tbody className="divide-y divide-gray-50">
                              {[...p606Campaigns].sort((a,b)=>b.sentDate.localeCompare(a.sentDate)).map(c=>{
                                const or = c.recipients>0?((c.opens/c.recipients)*100).toFixed(1):'0';
                                const cr = c.opens>0?((c.clicks/c.opens)*100).toFixed(1):'0';
                                return (
                                  <tr key={c.id} className="hover:bg-gray-50/50">
                                    <td className="px-3 py-2.5 font-medium text-gray-800">{c.name}</td>
                                    <td className="px-3 py-2.5 text-gray-500">{new Date(c.sentDate).toLocaleDateString('tr-TR')}</td>
                                    <td className="px-3 py-2.5 font-mono text-gray-600">{c.recipients.toLocaleString()}</td>
                                    <td className="px-3 py-2.5 font-bold text-emerald-600">%{or}</td>
                                    <td className="px-3 py-2.5 font-bold text-amber-600">%{cr}</td>
                                    <td className="px-3 py-2.5 font-bold text-purple-600">{c.conversions}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    {p606Campaigns.length === 0 && (
                      <p className="text-center text-gray-400 text-xs py-6">{tr606?'"Kampanya Ekle" ile geçmiş kampanya verilerini girin.':'Add past campaign data via "Add Campaign".'}</p>
                    )}
                  </div>
                );
              })()}

              {/* ── Phase 116: Contract Management ── */}
              {crmTab === 'sozlesmeler' && (
                <div className="space-y-4">
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'Sözleşme Yönetimi' : 'Contract Management'}
                    subtitle={currentLanguage === 'tr' ? 'Müşteri sözleşmelerini takip edin.' : 'Track customer contracts and renewals.'}
                    icon={FileText}
                    actionButton={
                      <button onClick={() => setShowContractForm(v => !v)} className="apple-button-primary flex items-center gap-2">
                        <Plus className="w-4 h-4" />{currentLanguage === 'tr' ? 'Yeni Sözleşme' : 'New Contract'}
                      </button>
                    }
                  />

                  {/* Expiry alerts */}
                  {(() => {
                    const today = new Date();
                    const expiring = contracts.filter(c => {
                      if (!c.endDate) return false;
                      const d = new Date(c.endDate);
                      const diff = (d.getTime() - today.getTime()) / 86400000;
                      return diff >= 0 && diff <= 30;
                    });
                    if (expiring.length === 0) return null;
                    return (
                      <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3">
                        <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
                        <p className="text-sm font-semibold text-amber-800">
                          {currentLanguage === 'tr'
                            ? `${expiring.length} sözleşme 30 gün içinde sona eriyor.`
                            : `${expiring.length} contract${expiring.length !== 1 ? 's' : ''} expiring within 30 days.`}
                        </p>
                      </div>
                    );
                  })()}

                  {/* New contract form */}
                  <AnimatePresence>
                    {showContractForm && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-3 shadow-sm">
                          <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni Sözleşme' : 'New Contract'}</h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input className="apple-input w-full" placeholder={currentLanguage === 'tr' ? 'Müşteri adı' : 'Customer name'}
                              value={contractForm.customerName} onChange={e => setContractForm(f => ({ ...f, customerName: e.target.value }))} />
                            <input className="apple-input w-full" placeholder={currentLanguage === 'tr' ? 'Sözleşme başlığı' : 'Contract title'}
                              value={contractForm.title} onChange={e => setContractForm(f => ({ ...f, title: e.target.value }))} />
                            <input type="number" className="apple-input w-full" placeholder={currentLanguage === 'tr' ? 'Sözleşme değeri (₺)' : 'Contract value (₺)'}
                              value={contractForm.value || ''} onChange={e => setContractForm(f => ({ ...f, value: Number(e.target.value) }))} />
                            <select className="apple-input w-full" value={contractForm.status} onChange={e => setContractForm(f => ({ ...f, status: e.target.value }))}>
                              <option value="active">{currentLanguage === 'tr' ? 'Aktif' : 'Active'}</option>
                              <option value="draft">{currentLanguage === 'tr' ? 'Taslak' : 'Draft'}</option>
                              <option value="expired">{currentLanguage === 'tr' ? 'Süresi Doldu' : 'Expired'}</option>
                            </select>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400">{currentLanguage === 'tr' ? 'Başlangıç' : 'Start Date'}</label>
                              <input type="date" className="apple-input w-full" value={contractForm.startDate} onChange={e => setContractForm(f => ({ ...f, startDate: e.target.value }))} />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400">{currentLanguage === 'tr' ? 'Bitiş' : 'End Date'}</label>
                              <input type="date" className="apple-input w-full" value={contractForm.endDate} onChange={e => setContractForm(f => ({ ...f, endDate: e.target.value }))} />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <input type="checkbox" id="autoRenew116" checked={contractForm.autoRenew} onChange={e => setContractForm(f => ({ ...f, autoRenew: e.target.checked }))} className="w-4 h-4 accent-brand" />
                            <label htmlFor="autoRenew116" className="text-xs font-semibold text-gray-700">{currentLanguage === 'tr' ? 'Otomatik yenileme' : 'Auto-renew'}</label>
                          </div>
                          <div className="flex justify-end gap-2 pt-1">
                            <button onClick={() => setShowContractForm(false)} className="apple-button-secondary px-4 text-sm">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                            <button
                              disabled={!contractForm.customerName || !contractForm.title}
                              onClick={async () => {
                                if (!contractForm.customerName || !contractForm.title) return;
                                try {
                                  await addDoc(collection(db, 'contracts'), { ...contractForm, createdAt: serverTimestamp() });
                                  setContractForm({ customerName: '', title: '', value: 0, startDate: '', endDate: '', status: 'active', autoRenew: false });
                                  setShowContractForm(false);
                                  toast(currentLanguage === 'tr' ? 'Sözleşme kaydedildi.' : 'Contract saved.', 'success');
                                } catch { toast('Error', 'error'); }
                              }}
                              className="apple-button-primary px-6 text-sm disabled:opacity-50"
                            >
                              {currentLanguage === 'tr' ? 'Kaydet' : 'Save'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Contract list */}
                  {contracts.length === 0 && !showContractForm ? (
                    <div className="text-center py-16 bg-white border border-gray-100 rounded-2xl">
                      <FileText size={40} className="mx-auto mb-3 text-gray-200" />
                      <p className="text-sm text-gray-400">{currentLanguage === 'tr' ? 'Henüz sözleşme yok.' : 'No contracts yet.'}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {contracts.map(c => {
                        const today = new Date();
                        const end = c.endDate ? new Date(c.endDate) : null;
                        const daysLeft = end ? Math.ceil((end.getTime() - today.getTime()) / 86400000) : null;
                        const expired = daysLeft !== null && daysLeft < 0;
                        const expiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;
                        return (
                          <div key={c.id} className={`bg-white border rounded-xl p-4 flex items-center gap-4 shadow-sm ${expired ? 'border-red-100' : expiringSoon ? 'border-amber-100' : 'border-gray-100'}`}>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-gray-900">{c.title}</p>
                              <p className="text-xs text-gray-500">{c.customerName} · {fmtKpi((c.value || 0),'full',0)}</p>
                              {c.endDate && (
                                <p className={`text-[10px] mt-0.5 font-semibold ${expired ? 'text-red-600' : expiringSoon ? 'text-amber-600' : 'text-gray-400'}`}>
                                  {currentLanguage === 'tr'
                                    ? expired ? 'Süresi doldu' : expiringSoon ? `${daysLeft} gün kaldı` : `${c.startDate} → ${c.endDate}`
                                    : expired ? 'Expired' : expiringSoon ? `${daysLeft} days left` : `${c.startDate} → ${c.endDate}`}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                                c.status === 'active' ? 'bg-emerald-100 text-emerald-700'
                                : c.status === 'expired' ? 'bg-red-100 text-red-700'
                                : 'bg-gray-100 text-gray-600'
                              }`}>
                                {c.status === 'active' ? (currentLanguage === 'tr' ? 'Aktif' : 'Active')
                                  : c.status === 'expired' ? (currentLanguage === 'tr' ? 'Süresi Doldu' : 'Expired')
                                  : (currentLanguage === 'tr' ? 'Taslak' : 'Draft')}
                              </span>
                              {c.autoRenew && <span className="text-[9px] text-blue-500 font-semibold">↻ {currentLanguage === 'tr' ? 'Oto-Yenileme' : 'Auto-Renew'}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Phase 122: Price Override Approval ── */}
              {crmTab === 'fiyat-onay' && (
                <div className="space-y-4">
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'Fiyat Onay Sistemi' : 'Price Override Approvals'}
                    subtitle={currentLanguage === 'tr' ? 'Satış ekibinin talep ettiği özel fiyatları onaylayın.' : 'Approve custom pricing requests from the sales team.'}
                    icon={Tag}
                    actionButton={
                      <button onClick={() => setShowPriceOverrideForm(v => !v)} className="apple-button-primary flex items-center gap-2">
                        <Plus className="w-4 h-4" />{currentLanguage === 'tr' ? 'Yeni Talep' : 'New Request'}
                      </button>
                    }
                  />

                  {/* KPI strip */}
                  {(() => {
                    const pending = priceOverrides.filter(p => p.status === 'pending');
                    const approved = priceOverrides.filter(p => p.status === 'approved');
                    const rejected = priceOverrides.filter(p => p.status === 'rejected');
                    const totalDiscount = approved.reduce((s, p) => s + Math.max(0, (p.standardPrice || 0) - (p.requestedPrice || 0)), 0);
                    return (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: currentLanguage === 'tr' ? 'Bekleyen' : 'Pending',   value: String(pending.length),  color: 'text-amber-600',   bg: 'bg-amber-50',   isMoney: false },
                            { label: currentLanguage === 'tr' ? 'Onaylı' : 'Approved',    value: String(approved.length), color: 'text-emerald-600', bg: 'bg-emerald-50', isMoney: false },
                            { label: currentLanguage === 'tr' ? 'Reddedilen' : 'Rejected', value: String(rejected.length), color: 'text-red-600',     bg: 'bg-red-50',     isMoney: false },
                            { label: currentLanguage === 'tr' ? 'Toplam İndirim' : 'Total Discount', value: fmtKpi(totalDiscount), color: 'text-brand', bg: 'bg-brand/5', isMoney: true },
                          ].map(k => (
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <div className="flex items-start justify-between mb-1">
                                <p className="text-xs text-gray-500">{k.label}</p>
                                {/* Phase — embed currency toggle inside Toplam İndirim card */}
                                {k.isMoney && <KpiCurrencyToggle />}
                              </div>
                              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Request form */}
                  <AnimatePresence>
                    {showPriceOverrideForm && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-3">
                          <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni Fiyat Onay Talebi' : 'New Price Override Request'}</h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input className="apple-input w-full" placeholder={currentLanguage === 'tr' ? 'Müşteri adı' : 'Customer name'} value={priceOverrideForm.customerName} onChange={e => setPriceOverrideForm(f => ({ ...f, customerName: e.target.value }))} />
                            <input className="apple-input w-full" placeholder={currentLanguage === 'tr' ? 'Ürün adı' : 'Product name'} value={priceOverrideForm.productName} onChange={e => setPriceOverrideForm(f => ({ ...f, productName: e.target.value }))} />
                            <div>
                              <label className="text-[10px] text-gray-400 font-semibold uppercase mb-1 block">
                                {currentLanguage === 'tr' ? 'Standart Fiyat' : 'Standard Price'}
                                {' '}₺
                                {priceOverrideForm.standardPrice > 0 && kpiCurrency !== 'TRY' && (() => {
                                  const r = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : (exchangeRates?.EUR || 1);
                                  const sym = kpiCurrency === 'USD' ? '$' : '€';
                                  return <span className="text-brand ml-1 normal-case font-bold">≈ {sym}{(priceOverrideForm.standardPrice / r).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>;
                                })()}
                              </label>
                              <input type="number" className="apple-input w-full" value={priceOverrideForm.standardPrice || ''} onChange={e => setPriceOverrideForm(f => ({ ...f, standardPrice: Number(e.target.value) }))} />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-400 font-semibold uppercase mb-1 block">
                                {currentLanguage === 'tr' ? 'Talep Edilen Fiyat' : 'Requested Price'}
                                {' '}₺
                                {priceOverrideForm.requestedPrice > 0 && kpiCurrency !== 'TRY' && (() => {
                                  const r = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : (exchangeRates?.EUR || 1);
                                  const sym = kpiCurrency === 'USD' ? '$' : '€';
                                  return <span className="text-brand ml-1 normal-case font-bold">≈ {sym}{(priceOverrideForm.requestedPrice / r).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>;
                                })()}
                              </label>
                              <input type="number" className="apple-input w-full" value={priceOverrideForm.requestedPrice || ''} onChange={e => setPriceOverrideForm(f => ({ ...f, requestedPrice: Number(e.target.value) }))} />
                            </div>
                          </div>
                          <textarea className="apple-input w-full min-h-[60px] resize-none" placeholder={currentLanguage === 'tr' ? 'Gerekçe...' : 'Reason for override...'} value={priceOverrideForm.reason} onChange={e => setPriceOverrideForm(f => ({ ...f, reason: e.target.value }))} />
                          {priceOverrideForm.standardPrice > 0 && priceOverrideForm.requestedPrice > 0 && (
                            <p className={`text-xs font-semibold ${priceOverrideForm.requestedPrice < priceOverrideForm.standardPrice ? 'text-emerald-600' : 'text-red-600'}`}>
                              {priceOverrideForm.requestedPrice < priceOverrideForm.standardPrice
                                ? `▼ ${Math.abs(Math.round(((priceOverrideForm.requestedPrice - priceOverrideForm.standardPrice) / priceOverrideForm.standardPrice) * 100))}% indirim`
                                : `▲ ${Math.abs(Math.round(((priceOverrideForm.requestedPrice - priceOverrideForm.standardPrice) / priceOverrideForm.standardPrice) * 100))}% artış`}
                            </p>
                          )}
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => setShowPriceOverrideForm(false)} className="apple-button-secondary">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                            <button className="apple-button-primary" onClick={async () => {
                              if (!priceOverrideForm.customerName || !priceOverrideForm.productName) return;
                              try {
                                await addDoc(collection(db, 'priceOverrides'), {
                                  ...priceOverrideForm, status: 'pending',
                                  requestedBy: user?.email || user?.displayName || 'Sales',
                                  createdAt: serverTimestamp(),
                                });
                                setPriceOverrideForm({ customerName: '', productName: '', standardPrice: 0, requestedPrice: 0, reason: '' });
                                setShowPriceOverrideForm(false);
                                toast(currentLanguage === 'tr' ? 'Talep oluşturuldu.' : 'Request submitted.', 'success');
                              } catch { toast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error occurred.', 'error'); }
                            }}>{currentLanguage === 'tr' ? 'Talep Oluştur' : 'Submit Request'}</button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Override list */}
                  {priceOverrides.length === 0 && !showPriceOverrideForm ? (
                    <div className="text-center py-16 bg-white border border-gray-100 rounded-2xl">
                      <Tag size={40} className="mx-auto mb-3 text-gray-200" />
                      <p className="text-sm text-gray-400">{currentLanguage === 'tr' ? 'Henüz fiyat onay talebi yok.' : 'No price override requests yet.'}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {priceOverrides.map(p => {
                        const discountPct = p.standardPrice > 0 ? Math.round(((p.requestedPrice - p.standardPrice) / p.standardPrice) * 100) : 0;
                        return (
                          <div key={p.id} className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-4 shadow-sm">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <p className="text-sm font-bold text-gray-900 truncate">{p.productName}</p>
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                                  p.status === 'pending' ? 'bg-amber-100 text-amber-700'
                                  : p.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-red-100 text-red-700'
                                }`}>
                                  {p.status === 'pending' ? (currentLanguage === 'tr' ? 'Bekliyor' : 'Pending')
                                    : p.status === 'approved' ? (currentLanguage === 'tr' ? 'Onaylı' : 'Approved')
                                    : (currentLanguage === 'tr' ? 'Reddedildi' : 'Rejected')}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500">{p.customerName} · {p.requestedBy}</p>
                              <p className="text-[10px] text-gray-400 mt-0.5 truncate">{p.reason}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0 text-right">
                              <p className="text-xs text-gray-400 line-through">{fmtKpi((p.standardPrice || 0))}</p>
                              <p className="text-sm font-bold text-gray-900">{fmtKpi((p.requestedPrice || 0))}</p>
                              <span className={`text-[9px] font-bold ${discountPct < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {discountPct < 0 ? '▼' : '▲'}{Math.abs(discountPct)}%
                              </span>
                            </div>
                            {p.status === 'pending' && (
                              <div className="flex gap-1 flex-shrink-0">
                                <button onClick={async () => { await updateDoc(doc(db, 'priceOverrides', p.id), { status: 'approved' }); toast(currentLanguage === 'tr' ? 'Onaylandı.' : 'Approved.', 'success'); }}
                                  className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded-lg transition-colors" title={currentLanguage === 'tr' ? 'Onayla' : 'Approve'}>
                                  <Check size={14} />
                                </button>
                                <button onClick={async () => { await updateDoc(doc(db, 'priceOverrides', p.id), { status: 'rejected' }); toast(currentLanguage === 'tr' ? 'Reddedildi.' : 'Rejected.', 'error'); }}
                                  className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors" title={currentLanguage === 'tr' ? 'Reddet' : 'Reject'}>
                                  <X size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Phase 141: Sales Pipeline Kanban Board ── */}
              {crmTab === 'pipeline' && (() => {
                const stages: { key: Lead['status']; label: string; color: string; bg: string; border: string }[] = [
                  { key: 'New',       label: currentLanguage === 'tr' ? 'Yeni'         : 'New',       color: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-200' },
                  { key: 'Contacted', label: currentLanguage === 'tr' ? 'İletişim'     : 'Contacted', color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
                  { key: 'Qualified', label: currentLanguage === 'tr' ? 'Nitelikli'    : 'Qualified', color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-200' },
                  { key: 'Closed',    label: currentLanguage === 'tr' ? 'Kapandı'      : 'Closed',    color: 'text-emerald-600',bg: 'bg-emerald-50',border: 'border-emerald-200' },
                ];
                const grouped: Record<string, Lead[]> = { New: [], Contacted: [], Qualified: [], Closed: [] };
                for (const l of leads) { if (grouped[l.status]) grouped[l.status].push(l); }
                return (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-bold text-gray-900">{currentLanguage === 'tr' ? 'Satış Pipeline' : 'Sales Pipeline'}</h2>
                        <p className="text-sm text-gray-500">{leads.length} {currentLanguage === 'tr' ? 'müşteri adayı' : 'leads total'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <KpiCurrencyToggle />
                        <button onClick={() => setIsAddingLead(true)} className="apple-button-primary"><Plus className="w-4 h-4" />{currentLanguage === 'tr' ? 'Yeni Aday' : 'New Lead'}</button>
                      </div>
                    </div>
                    {/* KPI strip */}
                    <div className="grid grid-cols-4 gap-3">
                      {stages.map(s => {
                        const stageleads = grouped[s.key] || [];
                        const totalValue = stageleads.reduce((sum, l) => sum + (l.creditLimit || 0), 0);
                        return (
                          <div key={s.key} className={`apple-card p-4 border ${s.border}`}>
                            <p className={`text-xs font-semibold ${s.color}`}>{s.label}</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">{stageleads.length}</p>
                            {totalValue > 0 && <p className="text-xs text-gray-400 mt-0.5">{fmtKpi(totalValue)}</p>}
                          </div>
                        );
                      })}
                    </div>
                    {/* Kanban columns */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
                      {stages.map(s => {
                        const stageleads = grouped[s.key] || [];
                        return (
                          <div key={s.key} className={`rounded-2xl border ${s.border} ${s.bg} p-3 space-y-2 min-h-[200px]`}>
                            <div className={`flex items-center justify-between mb-2`}>
                              <span className={`text-xs font-bold uppercase tracking-wide ${s.color}`}>{s.label}</span>
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full bg-white/70 ${s.color}`}>{stageleads.length}</span>
                            </div>
                            {stageleads.length === 0 && (
                              <p className="text-xs text-gray-400 text-center py-8">{currentLanguage === 'tr' ? 'Kayıt yok' : 'No leads'}</p>
                            )}
                            {stageleads.map(lead => (
                              <div key={lead.id}
                                onClick={() => setSelectedLead(lead)}
                                className="bg-white rounded-xl p-3 shadow-sm border border-white/60 cursor-pointer hover:shadow-md transition-all group">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-brand transition-colors">{lead.name}</p>
                                    <p className="text-xs text-gray-500 truncate">{lead.company}</p>
                                  </div>
                                  {lead.score !== undefined && (
                                    <span className={`shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-lg ${lead.score >= 70 ? 'bg-emerald-100 text-emerald-700' : lead.score >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                                      {lead.score}
                                    </span>
                                  )}
                                </div>
                                {lead.creditLimit ? (
                                  <p className="text-xs text-gray-400 mt-1.5">{fmtKpi(lead.creditLimit)}</p>
                                ) : null}
                                {lead.assignedTo && (
                                  <p className="text-[10px] text-gray-400 mt-1 truncate">👤 {lead.assignedTo}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 142: Sales Target Tracker ── */}
              {crmTab === 'hedefler' && (() => {
                const now = new Date();
                const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

                // ── Build revenue-per-month from all orders ──────────────────
                const revenueByMonth: Record<string, number> = {};
                const dealsByMonth: Record<string, number> = {};
                const repByMonth: Record<string, Record<string, { actual: number; deals: number }>> = {};
                for (const o of orders) {
                  const dateStr = o.createdAt
                    ? (() => { try { const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; } catch { return ''; } })()
                    : '';
                  if (!dateStr) continue;
                  revenueByMonth[dateStr] = (revenueByMonth[dateStr] || 0) + (o.totalPrice || 0);
                  dealsByMonth[dateStr] = (dealsByMonth[dateStr] || 0) + 1;
                  const rep = (o.assignedTo as string | undefined) || '—';
                  if (!repByMonth[dateStr]) repByMonth[dateStr] = {};
                  if (!repByMonth[dateStr][rep]) repByMonth[dateStr][rep] = { actual: 0, deals: 0 };
                  repByMonth[dateStr][rep].actual += o.totalPrice || 0;
                  repByMonth[dateStr][rep].deals++;
                }

                // ── Build last 12 months list ───────────────────────────────
                const months: { key: string; label: string; year: number; month: number }[] = [];
                for (let i = 11; i >= 0; i--) {
                  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                  const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                  const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', year: 'numeric' });
                  months.push({ key, label, year: d.getFullYear(), month: d.getMonth()+1 });
                }

                const thisMonthActual = revenueByMonth[thisMonthKey] || 0;
                const globalPct = monthlyTarget > 0 ? Math.min(Math.round((thisMonthActual / monthlyTarget) * 100), 100) : 0;
                const repList = Object.entries(repByMonth[thisMonthKey] || {})
                  .map(([rep, v]) => ({ rep, ...v }))
                  .sort((a, b) => b.actual - a.actual);

                // ── Summary stats ────────────────────────────────────────────
                const hitCount = months.filter(m => {
                  const t = monthlyTargets[m.key] || (m.key === thisMonthKey ? monthlyTarget : 0);
                  const a = revenueByMonth[m.key] || 0;
                  return t > 0 && a >= t;
                }).length;
                const monthsWithTarget = months.filter(m => (monthlyTargets[m.key] || (m.key === thisMonthKey ? monthlyTarget : 0)) > 0).length;
                const totalActual12 = months.reduce((s, m) => s + (revenueByMonth[m.key] || 0), 0);
                const totalTarget12 = months.reduce((s, m) => s + (monthlyTargets[m.key] || (m.key === thisMonthKey ? monthlyTarget : 0)), 0);
                const avg12Pct = totalTarget12 > 0 ? Math.round((totalActual12 / totalTarget12) * 100) : 0;
                const best12 = months.reduce<{ key: string; pct: number } | null>((best, m) => {
                  const t = monthlyTargets[m.key] || (m.key === thisMonthKey ? monthlyTarget : 0);
                  const a = revenueByMonth[m.key] || 0;
                  if (t === 0) return best;
                  const pct = Math.round((a / t) * 100);
                  return (!best || pct > best.pct) ? { key: m.key, pct } : best;
                }, null);

                return (
                  <div className="space-y-5">
                    {/* ── Header ─────────────────────────────────────────── */}
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <h2 className="text-xl font-bold text-gray-900">{currentLanguage === 'tr' ? 'Satış Hedefleri' : 'Sales Targets'}</h2>
                        <p className="text-sm text-gray-500">{now.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'long', year: 'numeric' })}</p>
                      </div>
                      {!isEditingTarget && (
                        <button onClick={() => { setIsEditingTarget(true); setTargetDraft(String(monthlyTarget)); }}
                          className="apple-button-secondary text-xs">{currentLanguage === 'tr' ? 'Bu Ay Hedef Güncelle' : 'Update This Month'}</button>
                      )}
                    </div>

                    {/* ── Bu Ay Card ─────────────────────────────────────── */}
                    <div className="apple-card p-6">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold text-gray-700">{currentLanguage === 'tr' ? 'Bu Ay' : 'This Month'}</p>
                        <div className="flex items-center gap-2">
                          {/* Currency toggle — embedded in the card */}
                          <KpiCurrencyToggle />
                          <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${globalPct >= 100 ? 'bg-emerald-100 text-emerald-700' : globalPct >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>{globalPct}%</span>
                        </div>
                      </div>
                      {isEditingTarget ? (
                        <div className="flex items-center gap-2 mb-4 flex-wrap">
                          <span className="text-sm text-gray-500">₺</span>
                          <input autoFocus type="number" value={targetDraft} onChange={e => setTargetDraft(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { const v = Number(targetDraft); saveMonthlyTarget(thisMonthKey, v); setIsEditingTarget(false); }
                              if (e.key === 'Escape') setIsEditingTarget(false);
                            }}
                            className="apple-input text-lg font-bold w-48 px-3 py-1.5" placeholder="0" />
                          <button onClick={() => { const v = Number(targetDraft); saveMonthlyTarget(thisMonthKey, v); setIsEditingTarget(false); }}
                            className="apple-button-primary text-xs px-4 py-1.5">{currentLanguage === 'tr' ? 'Kaydet' : 'Save'}</button>
                          <button onClick={() => setIsEditingTarget(false)} className="text-sm text-gray-400 hover:text-gray-600">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                        </div>
                      ) : (
                        <div className="flex items-end gap-3 mb-4">
                          <span className="text-3xl font-bold text-gray-900">{fmtKpi(thisMonthActual)}</span>
                          <span className="text-gray-400 mb-1">/ {monthlyTarget > 0 ? fmtKpi(monthlyTarget) : <span className="italic text-gray-300">{currentLanguage === 'tr' ? 'Hedef yok' : 'No target'}</span>}</span>
                        </div>
                      )}
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-700 ${globalPct >= 100 ? 'bg-emerald-500' : globalPct >= 70 ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ width: `${globalPct}%` }} />
                      </div>
                      {repList.length > 0 && (
                        <div className="mt-4 space-y-2 border-t border-gray-50 pt-3">
                          <p className="text-xs font-semibold text-gray-500 mb-2">{currentLanguage === 'tr' ? 'Temsilci Bazlı' : 'Per Rep'}</p>
                          {repList.map((r, i) => {
                            const repTarget = monthlyTarget > 0 ? monthlyTarget / Math.max(repList.length, 1) : 0;
                            const pct = repTarget > 0 ? Math.min(Math.round((r.actual / repTarget) * 100), 100) : 0;
                            return (
                              <div key={r.rep}>
                                <div className="flex items-center justify-between text-xs mb-0.5">
                                  <span className="font-medium text-gray-800 flex items-center gap-1">{i === 0 && '🏆'}{r.rep}</span>
                                  <span className="text-gray-500">{fmtKpi(r.actual)} · {r.deals} {currentLanguage==='tr'?'sipariş':'orders'}</span>
                                </div>
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-400' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* ── 12-Month Summary KPI Cards ──────────────────────── */}
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        {currentLanguage === 'tr' ? '12 Ay Özet' : '12-Month Summary'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: currentLanguage === 'tr' ? '12 Ay Ciro' : '12-Mo Revenue', value: fmtKpi(totalActual12,'K',1), sub: `${months.filter(m => (revenueByMonth[m.key] || 0) > 0).length} ${currentLanguage === 'tr' ? 'aktif ay' : 'active months'}`, color: 'text-emerald-600', icon: '📈' },
                        { label: currentLanguage === 'tr' ? 'Ort. Başarı' : 'Avg. Attainment', value: `%${avg12Pct}`, sub: `${monthsWithTarget} ${currentLanguage === 'tr' ? 'hedefli ay' : 'months w/ target'}`, color: avg12Pct >= 100 ? 'text-emerald-600' : avg12Pct >= 70 ? 'text-amber-600' : 'text-red-500', icon: '🎯' },
                        { label: currentLanguage === 'tr' ? 'Hedef Tutturan' : 'Target Hit', value: `${hitCount}/${monthsWithTarget}`, sub: currentLanguage === 'tr' ? 'ay' : 'months', color: 'text-blue-600', icon: '✅' },
                        { label: currentLanguage === 'tr' ? 'En İyi Ay' : 'Best Month', value: best12 ? `%${best12.pct}` : '—', sub: best12 ? months.find(m => m.key === best12.key)?.label || '' : currentLanguage === 'tr' ? 'veri yok' : 'no data', color: 'text-purple-600', icon: '🏆' },
                      ].map((k, i) => (
                        <div key={i} className="apple-card p-4">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-base">{k.icon}</span>
                            <p className="text-xs text-gray-500 font-medium">{k.label}</p>
                          </div>
                          <p className={`text-2xl font-black ${k.color}`}>{k.value}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{k.sub}</p>
                        </div>
                      ))}
                    </div>

                    {/* ── Last 6 Months Mini Cards ─────────────────────── */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-gray-700">{currentLanguage === 'tr' ? 'Son 6 Ay' : 'Last 6 Months'}</h3>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                        {months.slice(6).map(m => {
                          const target = monthlyTargets[m.key] || (m.key === thisMonthKey ? monthlyTarget : 0);
                          const actual = revenueByMonth[m.key] || 0;
                          const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
                          const isCurrent = m.key === thisMonthKey;
                          const barColor = pct >= 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-400' : target > 0 ? 'bg-red-400' : 'bg-gray-300';
                          const textColor = pct >= 100 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : target > 0 ? 'text-red-500' : 'text-gray-400';
                          return (
                            <div key={m.key} className={`rounded-2xl border p-3 ${isCurrent ? 'border-brand/30 bg-brand/5' : 'border-gray-100 bg-white'} shadow-sm`}>
                              <p className={`text-[10px] font-bold mb-1 ${isCurrent ? 'text-brand' : 'text-gray-500'}`}>{m.label}</p>
                              <p className={`text-base font-black ${target > 0 ? textColor : 'text-gray-700'}`}>
                                {target > 0 ? `%${pct}` : '—'}
                              </p>
                              <p className="text-[10px] text-gray-500 mt-0.5">{fmtKpi(actual,'K',1)}</p>
                              {target > 0 && <p className="text-[9px] text-gray-300 mt-0.5">{currentLanguage === 'tr' ? 'Hdf:' : 'Tgt:'} {fmtKpi(target,'K',1)}</p>}
                              <div className="h-1 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Historical Table ──────────────────────────────── */}
                    <div className="apple-card overflow-hidden">
                      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                        <h3 className="font-bold text-gray-800 text-sm">{currentLanguage === 'tr' ? 'Geçmiş Hedefler (12 Ay)' : 'Target History (12 Months)'}</h3>
                        <div className="flex items-center gap-3">
                          <p className="text-xs text-gray-400 hidden sm:block">{currentLanguage === 'tr' ? 'Hedefi düzenlemek için satıra tıklayın' : 'Click a row to edit its target'}</p>
                          <KpiCurrencyToggle />
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                              <th className="text-left px-4 py-2.5 font-semibold">{currentLanguage === 'tr' ? 'Ay' : 'Month'}</th>
                              <th className="text-right px-4 py-2.5 font-semibold">{currentLanguage === 'tr' ? 'Hedef' : 'Target'}</th>
                              <th className="text-right px-4 py-2.5 font-semibold">{currentLanguage === 'tr' ? 'Gerçekleşen' : 'Actual'}</th>
                              <th className="text-right px-4 py-2.5 font-semibold">{currentLanguage === 'tr' ? 'Fark' : 'Gap'}</th>
                              <th className="text-right px-4 py-2.5 font-semibold">%</th>
                              <th className="text-right px-4 py-2.5 font-semibold">{currentLanguage === 'tr' ? 'Sipariş' : 'Orders'}</th>
                              <th className="px-4 py-2.5 font-semibold">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {[...months].reverse().map(m => {
                              const target = monthlyTargets[m.key] || (m.key === thisMonthKey ? monthlyTarget : 0);
                              const actual = revenueByMonth[m.key] || 0;
                              const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
                              const gap = actual - target;
                              const isCurrent = m.key === thisMonthKey;
                              const isEditingThis = editingMonthKey === m.key;
                              const statusLabel = !target ? (currentLanguage === 'tr' ? '—' : '—') : pct >= 100 ? (currentLanguage === 'tr' ? '✅ Tuttu' : '✅ Hit') : pct >= 70 ? (currentLanguage === 'tr' ? '🟡 Yakın' : '🟡 Close') : (currentLanguage === 'tr' ? '🔴 Geride' : '🔴 Behind');
                              const statusColor = !target ? 'text-gray-300' : pct >= 100 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-500';
                              return (
                                <tr key={m.key}
                                  className={`hover:bg-gray-50 cursor-pointer transition-colors ${isCurrent ? 'bg-brand/5 font-semibold' : ''}`}
                                  onClick={() => { if (!isEditingThis) { setEditingMonthKey(m.key); setEditingMonthDraft(String(target || '')); } }}>
                                  <td className="px-4 py-3">
                                    <span className={`${isCurrent ? 'text-brand font-bold' : 'text-gray-700'}`}>{m.label}</span>
                                    {isCurrent && <span className="ml-1.5 text-[9px] bg-brand text-white px-1.5 py-0.5 rounded-full">{currentLanguage === 'tr' ? 'Bu ay' : 'Now'}</span>}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    {isEditingThis ? (
                                      <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                                        <input
                                          autoFocus
                                          type="number"
                                          value={editingMonthDraft}
                                          onChange={e => setEditingMonthDraft(e.target.value)}
                                          onKeyDown={e => {
                                            if (e.key === 'Enter') { saveMonthlyTarget(m.key, Number(editingMonthDraft)); setEditingMonthKey(null); }
                                            if (e.key === 'Escape') setEditingMonthKey(null);
                                          }}
                                          className="w-28 text-right bg-white border border-brand rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
                                          placeholder="0"
                                        />
                                        <button onClick={e => { e.stopPropagation(); saveMonthlyTarget(m.key, Number(editingMonthDraft)); setEditingMonthKey(null); }}
                                          className="bg-brand text-white rounded-lg px-2 py-1 text-[10px] font-bold whitespace-nowrap">{currentLanguage === 'tr' ? 'Kaydet' : 'Save'}</button>
                                        <button onClick={e => { e.stopPropagation(); setEditingMonthKey(null); }}
                                          className="text-gray-400 hover:text-gray-600 text-[10px]">✕</button>
                                      </div>
                                    ) : (
                                      <span className={`${target > 0 ? 'text-gray-700' : 'text-gray-300 italic'}`}>
                                        {target > 0 ? fmtKpi(target) : (currentLanguage === 'tr' ? 'Hedef yok' : 'No target')}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right text-gray-700">{actual > 0 ? fmtKpi(actual) : <span className="text-gray-300">—</span>}</td>
                                  <td className={`px-4 py-3 text-right ${target > 0 && actual > 0 ? (gap >= 0 ? 'text-emerald-600' : 'text-red-500') : 'text-gray-300'}`}>
                                    {target > 0 && actual > 0 ? `${gap >= 0 ? '+' : ''}${fmtKpi(Math.abs(gap),'K',1)}` : '—'}
                                  </td>
                                  <td className={`px-4 py-3 text-right font-bold ${statusColor}`}>{target > 0 ? `${pct}%` : '—'}</td>
                                  <td className="px-4 py-3 text-right text-gray-500">{dealsByMonth[m.key] || 0}</td>
                                  <td className={`px-4 py-3 text-xs font-semibold ${statusColor}`}>{statusLabel}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          {totalTarget12 > 0 && (
                            <tfoot>
                              <tr className="bg-gray-50 font-bold text-gray-800 border-t-2 border-gray-200">
                                <td className="px-4 py-3 text-xs">{currentLanguage === 'tr' ? 'TOPLAM (12 Ay)' : 'TOTAL (12 Mo)'}</td>
                                <td className="px-4 py-3 text-right text-xs">{fmtKpi(totalTarget12,'K',1)}</td>
                                <td className="px-4 py-3 text-right text-xs">{fmtKpi(totalActual12,'K',1)}</td>
                                <td className={`px-4 py-3 text-right text-xs ${totalActual12 >= totalTarget12 ? 'text-emerald-600' : 'text-red-500'}`}>
                                  {totalActual12 >= totalTarget12 ? '+' : ''}{fmtKpi(Math.abs(totalActual12-totalTarget12),'K',1)}
                                </td>
                                <td className={`px-4 py-3 text-right text-xs ${avg12Pct >= 100 ? 'text-emerald-600' : avg12Pct >= 70 ? 'text-amber-600' : 'text-red-500'}`}>%{avg12Pct}</td>
                                <td className="px-4 py-3 text-right text-xs">{Object.values(dealsByMonth).reduce((s, v) => s + v, 0)}</td>
                                <td className="px-4 py-3" />
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* CRM sub-tab: Leads (default) */}
              {crmTab === 'leads' && <>
              {/* Row 1: Title + primary action */}
              <ModuleHeader
                title={currentT.sales_pipeline}
                subtitle={currentT.manage_leads}
                icon={Users}
                actionButton={
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => exportLeadsCSV(leads, currentLanguage)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold transition-colors"
                      title={currentLanguage === 'tr' ? 'CSV olarak indir' : 'Download as CSV'}
                    >
                      <Download className="w-3.5 h-3.5" />
                      CSV
                    </button>
                    <button onClick={() => setIsAddingLead(true)} className="apple-button-primary">
                      <Plus className="w-4 h-4" /> {currentT.new_lead_btn}
                    </button>
                  </div>
                }
              />
              {/* ── Phase 515: Follow-up Due Alert ── */}
              {!p515Dismissed && (() => {
                const now515 = new Date(); now515.setHours(0,0,0,0);
                const overdue = leads.filter(l => {
                  if (!l.nextFollowUpDate || l.status === 'Closed') return false;
                  const due = typeof (l.nextFollowUpDate as { toDate?: () => Date }).toDate === 'function'
                    ? (l.nextFollowUpDate as { toDate: () => Date }).toDate()
                    : new Date(l.nextFollowUpDate as unknown as string | number);
                  return due <= now515;
                });
                const dueToday = leads.filter(l => {
                  if (!l.nextFollowUpDate || l.status === 'Closed') return false;
                  const due = typeof (l.nextFollowUpDate as { toDate?: () => Date }).toDate === 'function'
                    ? (l.nextFollowUpDate as { toDate: () => Date }).toDate()
                    : new Date(l.nextFollowUpDate as unknown as string | number);
                  const dueD = new Date(due); dueD.setHours(0,0,0,0);
                  return dueD.getTime() === now515.getTime();
                });
                if (overdue.length === 0 && dueToday.length === 0) return null;
                return (
                  <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                    <Bell className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-amber-800">
                        {overdue.length > 0 && <span className="mr-2">{overdue.length} {currentLanguage === 'tr' ? 'gecikmiş takip' : 'overdue follow-up'}{overdue.length > 1 ? 's' : ''}</span>}
                        {dueToday.length > 0 && <span className="text-amber-700">{dueToday.length} {currentLanguage === 'tr' ? 'bugün vadeli' : 'due today'}</span>}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {overdue.slice(0,5).map(l => (
                          <button key={l.id} onClick={() => setSelectedLead(l)}
                            className="text-[10px] font-bold bg-amber-100 hover:bg-amber-200 text-amber-800 px-2 py-1 rounded-full transition-colors flex items-center gap-1">
                            <AlertTriangle className="w-2.5 h-2.5" />{l.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button onClick={() => setP515Dismissed(true)} className="text-amber-400 hover:text-amber-600 flex-shrink-0 mt-0.5"><X className="w-4 h-4" /></button>
                  </div>
                );
              })()}

              {/* Row 2: Search + secondary actions */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder={currentT.search_leads}
                    value={crmSearch}
                    onChange={(e) => setCrmSearch(e.target.value)}
                    className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-full text-sm outline-none focus:border-brand w-full transition-all"
                  />
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-1 flex items-center shadow-sm shrink-0">
                  <button onClick={() => setViewMode('list')} className={cn("p-1.5 rounded-lg transition-colors", viewMode === 'list' ? "bg-gray-100 text-[#1D1D1F]" : "text-gray-400 hover:text-gray-600")} title="Liste">
                    <List className="w-4 h-4" />
                  </button>
                  <button onClick={() => setViewMode('board')} className={cn("p-1.5 rounded-lg transition-colors", viewMode === 'board' ? "bg-gray-100 text-[#1D1D1F]" : "text-gray-400 hover:text-gray-600")} title="Kanban">
                    <Kanban className="w-4 h-4" />
                  </button>
                </div>
                <label className="apple-button-secondary shrink-0 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">CSV</span>
                  <input type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
                </label>
                {/* Phase 529: Funnel view toggle */}
                <button
                  onClick={() => setShowLeadFunnel(f => !f)}
                  className={cn("apple-button-secondary shrink-0", showLeadFunnel && "bg-brand text-white hover:bg-brand/90")}
                  title={currentLanguage === 'tr' ? 'Pipeline hunisi' : 'Pipeline funnel'}
                >
                  <BarChart2 className="w-4 h-4" />
                  <span className="hidden sm:inline">{currentLanguage === 'tr' ? 'Huni' : 'Funnel'}</span>
                </button>
                {/* Phase 537: Sort controls */}
                <div className="bg-white border border-gray-200 rounded-xl p-1 flex items-center shadow-sm shrink-0">
                  {([
                    { key: 'default',  icon: '⇅', title: currentLanguage === 'tr' ? 'Varsayılan' : 'Default' },
                    { key: 'score',    icon: '★',  title: currentLanguage === 'tr' ? 'Skora göre' : 'By score' },
                    { key: 'activity', icon: '🕐', title: currentLanguage === 'tr' ? 'Son aktiviteye göre' : 'By last activity' },
                    { key: 'name',     icon: 'A',  title: currentLanguage === 'tr' ? 'İsme göre' : 'By name' },
                  ] as { key: typeof crmLeadSort; icon: string; title: string }[]).map(s => (
                    <button
                      key={s.key}
                      onClick={() => setCrmLeadSort(s.key)}
                      className={cn("px-2 py-1 rounded-lg text-[10px] font-bold transition-colors", crmLeadSort === s.key ? "bg-gray-100 text-gray-800" : "text-gray-400 hover:text-gray-600")}
                      title={s.title}
                    >
                      {s.icon}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Phase 529: Pipeline Conversion Funnel ── */}
              {showLeadFunnel && (() => {
                const stages = [
                  { key: 'New',        labelTR: 'Yeni',       color: 'bg-blue-500',    textColor: 'text-blue-700',   bg: 'bg-blue-50'   },
                  { key: 'Contacted',  labelTR: 'İletişim',   color: 'bg-violet-500',  textColor: 'text-violet-700', bg: 'bg-violet-50' },
                  { key: 'Qualified',  labelTR: 'Nitelikli',  color: 'bg-amber-500',   textColor: 'text-amber-700',  bg: 'bg-amber-50'  },
                  { key: 'Closed',     labelTR: 'Kapandı',    color: 'bg-emerald-500', textColor: 'text-emerald-700',bg: 'bg-emerald-50'},
                ] as const;
                const counts = stages.map(s => leads.filter(l => l.status === s.key).length);
                const maxCount = Math.max(...counts, 1);
                const totalRev = (stageKey: string) =>
                  orders.filter(o => leads.find(l => l.status === stageKey && (l.name === o.customerName || l.id === o.leadId)))
                    .reduce((s, o) => s + (o.totalPrice ?? 0), 0);
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <h3 className={cn("text-sm font-bold mb-4", darkMode ? "text-white" : "text-gray-800")}>
                      {currentLanguage === 'tr' ? 'Pipeline Dönüşüm Hunisi' : 'Pipeline Conversion Funnel'}
                    </h3>
                    <div className="space-y-3">
                      {stages.map((s, i) => {
                        const count = counts[i];
                        const pct = Math.round((count / maxCount) * 100);
                        const convPct = i > 0 && counts[i-1] > 0 ? Math.round((count / counts[i-1]) * 100) : null;
                        const rev = totalRev(s.key);
                        return (
                          <div key={s.key} className="flex items-center gap-3">
                            <div className="w-20 text-xs font-semibold text-right text-gray-500 shrink-0">
                              {currentLanguage === 'tr' ? s.labelTR : s.key}
                            </div>
                            <div className="flex-1 relative h-7 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={cn("h-full rounded-full transition-all duration-500", s.color)}
                                style={{ width: `${pct}%` }}
                              />
                              <span className="absolute inset-0 flex items-center px-3 text-[10px] font-bold text-white mix-blend-difference">
                                {count} {currentLanguage === 'tr' ? 'aday' : 'lead'}{count !== 1 ? 's' : ''}
                                {rev > 0 && ` · ₺${rev.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`}
                              </span>
                            </div>
                            <div className="w-14 text-right shrink-0">
                              {convPct !== null ? (
                                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", s.bg, s.textColor)}>
                                  {convPct}%
                                </span>
                              ) : <span className="text-[10px] text-gray-300">—</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className={cn("text-[10px] mt-3", darkMode ? "text-white/30" : "text-gray-400")}>
                      {currentLanguage === 'tr' ? '% değerleri bir önceki aşamaya göre dönüşüm oranını gösterir.' : 'Percentages show conversion from the previous stage.'}
                    </p>
                  </div>
                );
              })()}

              {/* ── Phase 91: CRM Win-Rate & Conversion Stats Header ── */}
              {leads.length > 0 && (() => {
                const total      = leads.length;
                const closed     = leads.filter(l => l.status === 'Closed').length;
                const qualified  = leads.filter(l => l.status === 'Qualified').length;
                const winRate    = total > 0 ? Math.round((closed / total) * 100) : 0;
                const convRate   = total > 0 ? Math.round(((closed + qualified) / total) * 100) : 0;
                const pipelineVal = leads
                  .filter(l => l.status !== 'Closed')
                  .reduce((s, l) => s + (l.creditLimit ?? 0), 0);
                const avgScore   = leads.filter(l => l.score != null).length > 0
                  ? Math.round(leads.filter(l => l.score != null).reduce((s, l) => s + (l.score ?? 0), 0) / leads.filter(l => l.score != null).length)
                  : null;
                const p91Rate = kpiCurrency === 'USD' ? (exchangeRates?.USD||1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR||1) : 1;
                const p91Sym  = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const p91Val  = kpiCurrency === 'TRY' ? pipelineVal : pipelineVal / p91Rate;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { label: currentLanguage === 'tr' ? 'Toplam Aday' : 'Total Leads',    value: total.toString(),       sub: null,                        color: 'text-gray-800' },
                      { label: currentLanguage === 'tr' ? 'Kazanma Oranı' : 'Win Rate',      value: `${winRate}%`,          sub: `${closed} ${currentLanguage==='tr'?'kapandı':'closed'}`, color: winRate >= 40 ? 'text-emerald-700' : winRate >= 20 ? 'text-amber-700' : 'text-red-600' },
                      { label: currentLanguage === 'tr' ? 'Pipeline Değeri' : 'Pipeline Value', value: `${p91Sym}${p91Val.toLocaleString('tr-TR',{maximumFractionDigits:0})}`, sub: currentLanguage==='tr'?'aktif adaylar':'active leads', color: 'text-blue-700' },
                      { label: currentLanguage === 'tr' ? 'Ort. AI Puanı' : 'Avg AI Score',  value: avgScore != null ? `${avgScore}/100` : '—',  sub: `${convRate}% ${currentLanguage==='tr'?'dönüşüm':'conversion'}`, color: avgScore != null && avgScore >= 70 ? 'text-emerald-700' : 'text-gray-700' },
                    ].map((s, i) => (
                      <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
                        <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                        <p className="text-[10px] font-bold text-gray-400 mt-0.5 uppercase tracking-wide">{s.label}</p>
                        {s.sub && <p className="text-[9px] text-gray-400 mt-0.5">{s.sub}</p>}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ── Phase 69: Lead Pipeline Funnel Strip ── */}
              {leads.length > 0 && (() => {
                const stages = [
                  { key: 'New',       labelTR: 'Yeni',         color: 'bg-sky-400',     text: 'text-sky-700',     bg: 'bg-sky-50'     },
                  { key: 'Contacted', labelTR: 'İrtibat',      color: 'bg-indigo-400',  text: 'text-indigo-700',  bg: 'bg-indigo-50'  },
                  { key: 'Qualified', labelTR: 'Nitelikli',    color: 'bg-violet-400',  text: 'text-violet-700',  bg: 'bg-violet-50'  },
                  { key: 'Closed',    labelTR: 'Kapandı',      color: 'bg-emerald-400', text: 'text-emerald-700', bg: 'bg-emerald-50' },
                ];
                const total = leads.length;
                const counts = stages.map(s => ({ ...s, count: leads.filter(l => l.status === s.key).length }));
                const maxCount = Math.max(...counts.map(s => s.count), 1);
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
                      {currentLanguage === 'tr' ? 'Satış Hunisi' : 'Pipeline Funnel'}
                      <span className="ml-2 text-gray-300 font-normal">{total} {currentLanguage === 'tr' ? 'aday' : 'leads'}</span>
                    </p>
                    <div className="grid grid-cols-4 gap-3">
                      {counts.map((s) => {
                        const pct = Math.round((s.count / total) * 100);
                        const barH = Math.round((s.count / maxCount) * 48);
                        return (
                          <div key={s.key} className="flex flex-col items-center gap-1.5">
                            {/* Mini bar */}
                            <div className="w-full flex items-end justify-center h-12">
                              <div
                                className={`w-full rounded-t-lg transition-all duration-700 ${s.color} opacity-80`}
                                style={{ height: `${Math.max(barH, 4)}px` }}
                              />
                            </div>
                            {/* Count + label */}
                            <div className={`w-full text-center px-2 py-1.5 rounded-xl ${s.bg}`}>
                              <p className={`text-base font-black ${s.text}`}>{s.count}</p>
                              <p className="text-[9px] font-bold text-gray-500 truncate">
                                {currentLanguage === 'tr' ? s.labelTR : s.key}
                              </p>
                            </div>
                            {/* Percentage */}
                            <span className="text-[9px] text-gray-400 font-medium">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                    {/* Conversion rate hint */}
                    {(() => {
                      const newCount = counts.find(s => s.key === 'New')?.count ?? 0;
                      const closedCount = counts.find(s => s.key === 'Closed')?.count ?? 0;
                      const conv = newCount > 0 ? Math.round((closedCount / total) * 100) : 0;
                      return (
                        <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between">
                          <span className="text-[10px] text-gray-400">
                            {currentLanguage === 'tr' ? 'Dönüşüm oranı' : 'Conversion rate'}
                          </span>
                          <span className={`text-[11px] font-bold ${conv >= 30 ? 'text-emerald-600' : conv >= 15 ? 'text-amber-600' : 'text-gray-500'}`}>
                            {conv}%
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {/* ── Phase 508: Recent CRM Activity Feed ── */}
              {(() => {
                const allActivities = leads.flatMap(l =>
                  (l.activities || []).map(a => ({
                    ...a,
                    leadName: l.name,
                    leadId: l.id,
                    company: l.company,
                  }))
                ).filter(a => a.date).sort((a, b) => {
                  const ta = typeof (a.date as { toDate?: () => Date }).toDate === 'function'
                    ? (a.date as { toDate: () => Date }).toDate().getTime()
                    : new Date(a.date as string | number).getTime();
                  const tb = typeof (b.date as { toDate?: () => Date }).toDate === 'function'
                    ? (b.date as { toDate: () => Date }).toDate().getTime()
                    : new Date(b.date as string | number).getTime();
                  return tb - ta;
                }).slice(0, 8);
                if (allActivities.length === 0) return null;
                const typeIcon: Record<string, string> = { Call: '📞', Email: '✉️', Meeting: '🤝', Note: '📝', Visit: '🏢' };
                return (
                  <div className={cn("rounded-2xl border px-5 py-4", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
                      {currentLanguage === 'tr' ? 'Son Aktiviteler' : 'Recent Activity'}
                    </p>
                    <div className="space-y-2">
                      {allActivities.map((a, i) => {
                        const ts = typeof (a.date as { toDate?: () => Date }).toDate === 'function'
                          ? (a.date as { toDate: () => Date }).toDate()
                          : new Date(a.date as string | number);
                        const daysAgo = Math.floor((Date.now() - ts.getTime()) / 86400000);
                        const timeLabel = daysAgo === 0 ? (currentLanguage === 'tr' ? 'Bugün' : 'Today')
                          : daysAgo === 1 ? (currentLanguage === 'tr' ? 'Dün' : 'Yesterday')
                          : `${daysAgo}${currentLanguage === 'tr' ? ' gün önce' : 'd ago'}`;
                        return (
                          <button
                            key={i}
                            onClick={() => { const l = leads.find(x => x.id === a.leadId); if (l) setSelectedLead(l); }}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors text-left"
                          >
                            <span className="text-lg flex-shrink-0">{typeIcon[a.type] || '📋'}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-gray-800 truncate">{a.description}</p>
                              <p className="text-[10px] text-gray-400">{a.leadName}{a.company ? ` · ${a.company}` : ''}</p>
                            </div>
                            <span className="text-[10px] text-gray-400 flex-shrink-0">{timeLabel}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {viewMode === 'list' ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-3">
                    {/* ── Phase 72: Lead Status Filter Chips ── */}
                    <div className="flex flex-wrap gap-1.5">
                      {(['All', 'New', 'Contacted', 'Qualified', 'Closed'] as const).map(s => {
                        const count = s === 'All' ? leads.length : leads.filter(l => l.status === s).length;
                        const isActive = leadStatusFilter === s;
                        const chipColors: Record<string, string> = {
                          All:       'bg-gray-900 text-white',
                          New:       'bg-sky-500 text-white',
                          Contacted: 'bg-indigo-500 text-white',
                          Qualified: 'bg-violet-500 text-white',
                          Closed:    'bg-emerald-500 text-white',
                        };
                        const labelTR: Record<string, string> = { All: 'Tümü', New: 'Yeni', Contacted: 'İrtibat', Qualified: 'Nitelikli', Closed: 'Kapandı' };
                        return (
                          <button
                            key={s}
                            onClick={() => setLeadStatusFilter(s)}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border",
                              isActive
                                ? `${chipColors[s]} border-transparent shadow-sm`
                                : "bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-800"
                            )}
                          >
                            {currentLanguage === 'tr' ? labelTR[s] : s}
                            <span className={cn("text-[9px] px-1 py-0.5 rounded-full", isActive ? "bg-white/20" : "bg-gray-100 text-gray-500")}>
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {/* Sort bar */}
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] text-[#86868B] font-semibold uppercase mr-1">{currentLanguage === 'tr' ? 'Sırala:' : 'Sort:'}</span>
                      {[
                        { key: 'name', label: 'A–Z' },
                        { key: 'score', label: currentLanguage === 'tr' ? 'Skor' : 'Score' },
                        { key: 'company', label: currentLanguage === 'tr' ? 'Şirket' : 'Company' },
                        { key: 'status', label: currentLanguage === 'tr' ? 'Durum' : 'Status' },
                        { key: 'createdAt', label: currentLanguage === 'tr' ? 'Tarih' : 'Date' },
                      ].map(opt => (
                        <button key={opt.key}
                          onClick={() => toggleSort(crmSort, opt.key, setCrmSort)}
                          className={cn("text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all flex items-center gap-1",
                            crmSort.key === opt.key ? "bg-brand text-white border-brand" : "bg-white text-[#86868B] border-gray-200 hover:border-brand hover:text-brand"
                          )}>
                          {opt.label}
                          {crmSort.key === opt.key && (
                            <TrendingUp className={cn("w-3 h-3 transition-transform", crmSort.dir === 'desc' ? "rotate-180" : "")} />
                          )}
                        </button>
                      ))}
                    </div>
                    {/* ── Phase 519: Bulk Lead Selection Bar ── */}
                    {selectedLeadIds.size > 0 && (
                      <div className={cn("flex items-center justify-between px-4 py-3 rounded-2xl border", darkMode ? "bg-indigo-900/30 border-indigo-500/30" : "bg-indigo-50 border-indigo-200")}>
                        <span className="text-xs font-bold text-indigo-700">{selectedLeadIds.size} {currentLanguage === 'tr' ? 'aday seçildi' : 'leads selected'}</span>
                        <div className="flex items-center gap-2">
                          {(['New','Contacted','Qualified','Closed'] as const).map(s => {
                            const labelTR519: Record<string,string> = { New:'Yeni', Contacted:'İrtibat', Qualified:'Nitelikli', Closed:'Kapandı' };
                            return (
                              <button key={s} disabled={bulkLeadLoading}
                                onClick={async () => {
                                  setBulkLeadLoading(true);
                                  try {
                                    await Promise.all([...selectedLeadIds].map(id =>
                                      updateDoc(doc(db, 'leads', id), { status: s, updatedAt: serverTimestamp() })
                                    ));
                                    toast(`${selectedLeadIds.size} ${currentLanguage === 'tr' ? 'aday güncellendi ✓' : 'leads updated ✓'}`, 'success');
                                    setSelectedLeadIds(new Set());
                                  } catch(e){ console.error("[bulk-lead-status]", e); toast(currentLanguage === "tr" ? "Güncelleme başarısız." : "Update failed.", "error"); } finally { setBulkLeadLoading(false); }
                                }}
                                className="text-[10px] font-bold px-2.5 py-1.5 rounded-full bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white transition-colors disabled:opacity-40">
                                → {currentLanguage === 'tr' ? labelTR519[s] : s}
                              </button>
                            );
                          })}
                          <button onClick={() => setSelectedLeadIds(new Set())} className="text-[10px] font-semibold text-gray-400 hover:text-gray-600 ml-1 transition-colors">{currentLanguage === 'tr' ? 'İptal' : 'Clear'}</button>
                        </div>
                      </div>
                    )}
                    {(() => {
                      const filtered = leads.filter(l =>
                        (leadStatusFilter === 'All' || l.status === leadStatusFilter) &&
                        (l.name.toLowerCase().includes(crmSearch.toLowerCase()) ||
                        l.company.toLowerCase().includes(crmSearch.toLowerCase()) ||
                        l.email.toLowerCase().includes(crmSearch.toLowerCase()))
                      );
                      const sorted = sortData(filtered, crmSort.key, crmSort.dir);
                      // Phase 537: apply crmLeadSort secondary sort
                      const finalSorted = crmLeadSort === 'score'
                        ? [...sorted].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                        : crmLeadSort === 'name'
                          ? [...sorted].sort((a, b) => a.name.localeCompare(b.name, 'tr'))
                          : crmLeadSort === 'activity'
                            ? [...sorted].sort((a, b) => {
                                const actTs = (acts: LeadActivity[]) => acts.length > 0
                                  ? Math.max(...acts.map(act => {
                                      const raw = act as unknown as Record<string, unknown>;
                                      if (typeof raw.date === 'string') return new Date(raw.date).getTime();
                                      const cs = raw.createdAt as {seconds?: number} | undefined;
                                      if (cs?.seconds) return cs.seconds * 1000;
                                      return 0;
                                    }))
                                  : 0;
                                return actTs(b.activities ?? []) - actTs(a.activities ?? []);
                              })
                            : sorted;
                      return finalSorted.length === 0 ? (
                      <div className="bg-white p-12 rounded-xl border border-gray-200 text-center">
                        <Users className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                        <p className="text-gray-500">{currentT.no_leads_found}</p>
                      </div>
                    ) : (
                      finalSorted.map(lead => (
                        <div key={lead.id} className={cn("bg-white p-4 rounded-xl border hover:shadow-md transition-shadow flex items-center justify-between gap-4", selectedLeadIds.has(lead.id) ? "border-indigo-300 bg-indigo-50/30" : "border-gray-200")}>
                          {/* Phase 519: checkbox */}
                          <input type="checkbox" className="rounded accent-indigo-500 cursor-pointer flex-shrink-0"
                            checked={selectedLeadIds.has(lead.id)}
                            onChange={e => { const n = new Set(selectedLeadIds); if(e.target.checked) n.add(lead.id); else n.delete(lead.id); setSelectedLeadIds(n); }}
                            onClick={e => e.stopPropagation()}
                          />
                          <div className="flex items-center gap-4 min-w-0 flex-1 cursor-pointer" onClick={() => { trackView({ type: 'lead', id: lead.id, label: `${lead.name} — ${lead.company}`, tab: 'crm' }); setSelectedLead(lead); }}>
                            <div className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-sm sm:text-lg shrink-0", (lead.score || 0) > 70 ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-400")}>
                              {lead.score || '--'}
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-bold text-[#1D2226] truncate">{lead.name}</h4>
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-xs text-gray-500 truncate">{lead.company}</p>
                                {/* Phase 49 + Phase 85: Lead-to-Order revenue badge with kpiCurrency */}
                                {(() => {
                                  const rev = orders
                                    .filter(o => o.customerName === lead.name || o.customerName === lead.company)
                                    .reduce((s, o) => s + (o.totalPrice || 0), 0);
                                  if (rev === 0) return null;
                                  const p85Rate = kpiCurrency === 'USD' ? (exchangeRates?.USD||1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR||1) : 1;
                                  const p85Sym  = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                                  const p85Val  = kpiCurrency === 'TRY' ? rev : rev / p85Rate;
                                  return (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 flex-shrink-0">
                                      {p85Sym}{p85Val.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                                    </span>
                                  );
                                })()}
                                {/* Phase 81: Lead Age Indicator */}
                                {(() => {
                                  if (!lead.createdAt) return null;
                                  const created = typeof (lead.createdAt as { toDate?: () => Date }).toDate === 'function'
                                    ? (lead.createdAt as { toDate: () => Date }).toDate()
                                    : new Date(lead.createdAt as string | number);
                                  const ageD = Math.round((Date.now() - created.getTime()) / 86400000);
                                  if (ageD < 1) return null;
                                  const ageColor = ageD <= 7 ? 'bg-emerald-50 text-emerald-600' : ageD <= 30 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-500';
                                  const ageLabel = ageD < 30
                                    ? `${ageD}${currentLanguage === 'tr' ? 'g' : 'd'}`
                                    : `${Math.round(ageD / 30)}${currentLanguage === 'tr' ? 'a' : 'm'}`;
                                  return (
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${ageColor}`} title={`Lead created ${ageD} days ago`}>
                                      {ageLabel}
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 sm:gap-6 shrink-0">
                            <div className="text-right hidden sm:block">
                              {/* Phase 544: Quick status toggle */}
                              <div className="relative inline-block" onClick={e => e.stopPropagation()}>
                                <button
                                  onClick={() => setP544QuickStatus(p544QuickStatus === lead.id ? null : lead.id)}
                                  className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded-full flex items-center gap-1 hover:opacity-80 transition-opacity",
                                    lead.status === 'New' ? "bg-blue-50 text-blue-600" :
                                    lead.status === 'Qualified' ? "bg-emerald-50 text-emerald-600" :
                                    lead.status === 'Contacted' ? "bg-purple-50 text-purple-600" :
                                    lead.status === 'Proposal' ? "bg-indigo-50 text-indigo-600" :
                                    lead.status === 'Negotiation' ? "bg-amber-50 text-amber-700" :
                                    lead.status === 'Closed' ? "bg-gray-50 text-gray-500" : "bg-gray-50 text-gray-500"
                                  )}
                                  title={currentLanguage === 'tr' ? 'Durumu değiştir' : 'Change status'}
                                >
                                  {currentT[(lead.status.toLowerCase() as keyof typeof currentT)] || lead.status}
                                  <ChevronDown className="w-2.5 h-2.5" />
                                </button>
                                {p544QuickStatus === lead.id && (
                                  <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[130px]">
                                    {(['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Closed', 'Closed Won', 'Closed Lost'] as const).map(s => (
                                      <button
                                        key={s}
                                        onClick={async () => {
                                          try {
                                            await updateDoc(doc(db, 'leads', lead.id), { status: s, updatedAt: serverTimestamp() });
                                            toast(
                                              currentLanguage === 'tr' ? `Durum "${s}" olarak güncellendi` : `Status updated to "${s}"`,
                                              'success'
                                            );
                                          } catch {}
                                          setP544QuickStatus(null);
                                        }}
                                        className={cn(
                                          "w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors",
                                          s === lead.status ? "bg-brand/10 text-brand" : "hover:bg-gray-50 text-gray-700"
                                        )}
                                      >
                                        {s === lead.status ? '✓ ' : ''}{s}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {/* Phase 533: Activity count badge */}
                              {lead.activities && lead.activities.length > 0 && (
                                <span
                                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 flex-shrink-0"
                                  title={currentLanguage === 'tr' ? `${lead.activities.length} aktivite kaydı` : `${lead.activities.length} activity record${lead.activities.length !== 1 ? 's' : ''}`}
                                >
                                  {lead.activities.length} {currentLanguage === 'tr' ? 'akt.' : 'act.'}
                                </span>
                              )}
                              {/* Phase 527: Last-activity recency badge */}
                              {(() => {
                                const lastAct = lead.activities && lead.activities.length > 0
                                  ? lead.activities[lead.activities.length - 1]
                                  : null;
                                const raw527 = lastAct?.date ?? lead.updatedAt ?? lead.createdAt;
                                if (!raw527) return null;
                                const d527 = typeof (raw527 as { toDate?: () => Date }).toDate === 'function'
                                  ? (raw527 as { toDate: () => Date }).toDate()
                                  : new Date(raw527 as string | number);
                                const days527 = Math.floor((Date.now() - d527.getTime()) / 86400000);
                                if (days527 < 1) return null;
                                const color527 = days527 <= 3 ? 'bg-emerald-50 text-emerald-600'
                                  : days527 <= 7 ? 'bg-amber-50 text-amber-700'
                                  : 'bg-red-50 text-red-500';
                                const label527 = days527 === 1
                                  ? (currentLanguage === 'tr' ? '1g' : '1d')
                                  : days527 <= 30
                                    ? `${days527}${currentLanguage === 'tr' ? 'g' : 'd'}`
                                    : `${Math.round(days527/30)}${currentLanguage === 'tr' ? 'a' : 'm'}`;
                                return (
                                  <span
                                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${color527}`}
                                    title={currentLanguage === 'tr' ? `Son aktivite: ${days527} gün önce` : `Last activity: ${days527} day${days527 !== 1 ? 's' : ''} ago`}
                                  >
                                    🕐 {label527}
                                  </span>
                                );
                              })()}
                              {/* Phase 36: Follow-up due badge */}
                              {lead.nextFollowUpDate && (() => {
                                const due = typeof (lead.nextFollowUpDate as { toDate?: () => Date }).toDate === 'function'
                                  ? (lead.nextFollowUpDate as { toDate: () => Date }).toDate()
                                  : new Date(lead.nextFollowUpDate as unknown as string | number);
                                const today = new Date(); today.setHours(0, 0, 0, 0);
                                const daysLeft = Math.round((due.getTime() - today.getTime()) / 86400000);
                                const isOverdue = daysLeft < 0;
                                const isToday   = daysLeft === 0;
                                const isSoon    = daysLeft > 0 && daysLeft <= 7;
                                if (!isOverdue && !isToday && !isSoon) return null;
                                // Phase 36 + Phase 48: overdue, today, and upcoming
                                return (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full block mt-1 ${isOverdue ? 'bg-red-100 text-red-600' : isToday ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>
                                    {isOverdue
                                      ? (currentLanguage === 'tr' ? '⚠ Gecikmiş' : '⚠ Overdue')
                                      : isToday
                                        ? (currentLanguage === 'tr' ? '📅 Bugün' : '📅 Today')
                                        : (currentLanguage === 'tr' ? `📅 ${daysLeft}g` : `📅 ${daysLeft}d`)}
                                  </span>
                                );
                              })()}
                              <p className="text-[10px] text-gray-400 mt-1">{lead.phone}</p>
                            </div>
                            <button onClick={() => { setSelectedLead(lead); trackView({ type: 'lead', id: lead.id, label: lead.name, tab: 'crm' }); }} className="text-brand text-sm font-bold hover:underline">{currentT.view}</button>
                          </div>
                        </div>
                      )));
                    })()}
                  </div>
                  <div className="space-y-6">
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                      <h3 className="font-bold mb-4 flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-brand" /> {currentT.performance}
                      </h3>
                      <div className="space-y-4">
                        {(() => {
                          const totalLeadsCount = leads.length;
                          const closedWon = leads.filter(l => (l.status as string) === 'Closed Won').length;
                          const activeLeads = leads.filter(l => !(['Closed Won', 'Closed Lost'] as string[]).includes(l.status)).length;
                          const convRate = totalLeadsCount > 0 ? Math.round((closedWon / totalLeadsCount) * 100) : 0;
                          const activePct = totalLeadsCount > 0 ? Math.round((activeLeads / totalLeadsCount) * 100) : 0;
                          return (
                            <div className="space-y-3">
                              <div>
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-gray-500">{currentT.target_achievement} ({currentLanguage === 'tr' ? 'Kazanılan/Toplam' : 'Won/Total'})</span>
                                  <span className="font-bold text-emerald-600">{convRate}%</span>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${convRate}%` }} />
                                </div>
                              </div>
                              <div>
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-gray-500">{currentLanguage === 'tr' ? 'Aktif Hat' : 'Active Pipeline'}</span>
                                  <span className="font-bold text-brand">{activePct}%</span>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-brand transition-all" style={{ width: `${activePct}%` }} />
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                        <div className="grid grid-cols-2 gap-4 pt-2">
                          <button className="bg-gray-50 p-3 rounded-lg text-left hover:bg-gray-100 transition-colors group">
                            <p className="text-[10px] text-gray-500 uppercase font-bold group-hover:text-brand transition-colors">{currentT.total_leads}</p>
                            <p className="text-xl font-bold">{leads.length}</p>
                          </button>
                          <button className="bg-gray-50 p-3 rounded-lg text-left hover:bg-gray-100 transition-colors group" onClick={() => setCrmSearch('score:>80')}>
                            <p className="text-[10px] text-gray-500 uppercase font-bold group-hover:text-emerald-600 transition-colors">{currentT.hot_leads}</p>
                            <p className="text-xl font-bold text-emerald-600">{leads.filter(l => (l.score || 0) > 80).length}</p>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* ── Phase 45: Customer Revenue Leaderboard ── */}
                    {(() => {
                      const revenueMap: Record<string, number> = {};
                      for (const o of orders) {
                        revenueMap[o.customerName] = (revenueMap[o.customerName] ?? 0) + (o.totalPrice || 0);
                      }
                      const top5 = Object.entries(revenueMap)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 5);
                      if (top5.length === 0) return null;
                      const maxRev = top5[0][1];
                      return (
                        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                          <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-brand" />
                            {currentLanguage === 'tr' ? 'En Yüksek Ciro' : 'Top Customers'}
                          </h3>
                          <div className="space-y-3">
                            {top5.map(([name, rev], i) => (
                              <div key={name} className="flex items-center gap-2">
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-gray-100 text-gray-600' : 'bg-gray-50 text-gray-400'}`}>
                                  {i + 1}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-0.5">
                                    <p className="text-[11px] font-semibold text-gray-700 truncate">{name}</p>
                                    <p className="text-[11px] font-bold text-gray-800 ml-2 flex-shrink-0">
                                      {kpiCurrency==='TRY'?'₺':kpiCurrency==='USD'?'$':'€'}{(kpiCurrency==='TRY'?rev:rev/(kpiCurrency==='USD'?(exchangeRates?.USD||1):(exchangeRates?.EUR||1))).toLocaleString('tr-TR',{maximumFractionDigits:0})}
                                    </p>
                                  </div>
                                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-700 ${i === 0 ? 'bg-brand' : i === 1 ? 'bg-gray-400' : 'bg-gray-300'}`}
                                      style={{ width: `${(rev / maxRev) * 100}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Phase 53: Sales Funnel ── */}
                    {leads.length > 0 && (() => {
                      const stages = [
                        { key: 'New',       labelTR: 'Yeni',        color: 'bg-blue-400'    },
                        { key: 'Contacted', labelTR: 'İletişim',    color: 'bg-purple-400'  },
                        { key: 'Qualified', labelTR: 'Nitelikli',   color: 'bg-amber-400'   },
                        { key: 'Closed',    labelTR: 'Kapandı',     color: 'bg-emerald-500' },
                      ];
                      const maxCount = Math.max(...stages.map(s => leads.filter(l => l.status === s.key).length), 1);
                      return (
                        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                          <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                            <Flame className="w-4 h-4 text-brand" />
                            {currentLanguage === 'tr' ? 'Satış Hunisi' : 'Sales Funnel'}
                          </h3>
                          <div className="space-y-2">
                            {stages.map((s, i) => {
                              const count = leads.filter(l => l.status === s.key).length;
                              const width = maxCount > 0 ? (count / maxCount) * 100 : 0;
                              // Funnel taper: each stage is slightly narrower
                              const indent = i * 6;
                              return (
                                <div key={s.key} style={{ paddingLeft: `${indent}px`, paddingRight: `${indent}px` }}>
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-[10px] text-gray-400 w-16 shrink-0 truncate">
                                      {currentLanguage === 'tr' ? s.labelTR : s.key}
                                    </span>
                                    <div className="flex-1 h-5 bg-gray-50 rounded-md overflow-hidden">
                                      <div className={`h-full ${s.color} rounded-md flex items-center justify-end pr-1.5 transition-all duration-700`} style={{ width: `${Math.max(width, count > 0 ? 12 : 0)}%` }}>
                                        <span className="text-[9px] font-black text-white">{count}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Phase 32: AI Score Histogram ── */}
                    {leads.some(l => l.score != null) && (
                      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                          <BarChart3 className="w-4 h-4 text-brand" />
                          {currentLanguage === 'tr' ? 'AI Skor Dağılımı' : 'AI Score Distribution'}
                        </h3>
                        {(() => {
                          const buckets = [
                            { label: '0–20',   min: 0,  max: 20,  color: 'bg-red-400' },
                            { label: '21–40',  min: 21, max: 40,  color: 'bg-orange-400' },
                            { label: '41–60',  min: 41, max: 60,  color: 'bg-amber-400' },
                            { label: '61–80',  min: 61, max: 80,  color: 'bg-blue-400' },
                            { label: '81–100', min: 81, max: 100, color: 'bg-emerald-500' },
                          ];
                          const scored = leads.filter(l => l.score != null);
                          const maxCount = Math.max(...buckets.map(b => scored.filter(l => (l.score ?? 0) >= b.min && (l.score ?? 0) <= b.max).length), 1);
                          return (
                            <div className="space-y-2">
                              {buckets.map(b => {
                                const count = scored.filter(l => (l.score ?? 0) >= b.min && (l.score ?? 0) <= b.max).length;
                                return (
                                  <div key={b.label} className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-400 font-mono w-12 shrink-0">{b.label}</span>
                                    <div className="flex-1 h-4 bg-gray-50 rounded-full overflow-hidden">
                                      <div className={`h-full ${b.color} rounded-full transition-all duration-500`} style={{ width: `${(count / maxCount) * 100}%` }} />
                                    </div>
                                    <span className="text-[10px] font-bold text-gray-600 w-5 text-right shrink-0">{count}</span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {['New', 'Contacted', 'Qualified', 'Closed'].map(status => (
                    <div key={status} className="bg-gray-50 rounded-xl p-4 border border-gray-200 min-h-[200px]">
                      <h3 className="font-bold text-sm mb-4 flex items-center justify-between">
                        {currentT[status.toLowerCase()] || status}
                        <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full text-xs">
                          {leads.filter(l => l.status === status && (
                            l.name.toLowerCase().includes(crmSearch.toLowerCase()) ||
                            l.company.toLowerCase().includes(crmSearch.toLowerCase()) ||
                            l.email.toLowerCase().includes(crmSearch.toLowerCase())
                          )).length}
                        </span>
                      </h3>
                      <div className="space-y-3">
                        {leads.filter(l => l.status === status && (
                          l.name.toLowerCase().includes(crmSearch.toLowerCase()) ||
                          l.company.toLowerCase().includes(crmSearch.toLowerCase()) ||
                          l.email.toLowerCase().includes(crmSearch.toLowerCase())
                        )).map(lead => (
                          /* Phase 87: score bar kanban card */
                          <div key={lead.id} onClick={() => setSelectedLead(lead)} className="bg-white rounded-lg border border-gray-200 shadow-sm cursor-pointer hover:border-brand transition-colors overflow-hidden">
                            <div className="p-4">
                              <div className="flex justify-between items-start mb-2">
                                <h4 className="font-bold text-sm text-[#1D2226]">{lead.name}</h4>
                                <div className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", (lead.score || 0) > 70 ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500")}>
                                  {lead.score || '--'}
                                </div>
                              </div>
                              <p className="text-xs text-gray-500 mb-2">{lead.company}</p>
                              <p className="text-[10px] text-gray-400 truncate">{lead.email}</p>
                            </div>
                            {/* Score stripe */}
                            {lead.score != null && (
                              <div className="h-1 w-full bg-gray-100">
                                <div
                                  className={`h-full transition-all duration-700 ${lead.score >= 80 ? 'bg-emerald-400' : lead.score >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                                  style={{ width: `${lead.score}%` }}
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* ── Phase 581: Satış Temsilcisi Performans Raporu ─────────────── */}
              {activeTab === 'crm' && !selectedLead && crmTab === 'leads' && (() => {
                const tr581 = currentLanguage === 'tr';
                const now581 = new Date();
                const daysBack581 = p581RepPeriod === '30d' ? 30 : p581RepPeriod === '90d' ? 90 : now581.getFullYear() * 365; // ytd: use year start
                const from581 = p581RepPeriod === 'ytd' ? new Date(now581.getFullYear(),0,1) : new Date(now581.getTime()-daysBack581*86400000);
                // Per-rep lead stats
                const repMap: Record<string,{leads:number;won:number;revenue:number}> = {};
                leads.forEach(l => {
                  const rep = l.assignedTo || (tr581?'Atanmamış':'Unassigned');
                  if (!repMap[rep]) repMap[rep] = {leads:0,won:0,revenue:0};
                  repMap[rep].leads++;
                  if (l.status==='Closed Won'||l.status==='Closed') repMap[rep].won++;
                });
                // Add order revenue per assignedTo
                orders.forEach(o => {
                  if (o.status==='Cancelled'||!o.assignedTo) return;
                  if (!o.createdAt) return;
                  try {
                    const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string);
                    if (d<from581) return;
                  } catch { return; }
                  const rep = o.assignedTo;
                  if (!repMap[rep]) repMap[rep] = {leads:0,won:0,revenue:0};
                  repMap[rep].revenue += (o.totalPrice||0);
                });
                const repList = Object.entries(repMap).map(([name,v])=>({name,...v,convRate:v.leads>0?(v.won/v.leads)*100:0})).sort((a,b)=>b.revenue-a.revenue);
                if (repList.length === 0) return null;
                return (
                  <div className="apple-card p-5">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <h3 className="font-bold text-gray-900 text-sm">{tr581?'👤 Satış Temsilcisi Performansı':'👤 Sales Rep Performance'}</h3>
                      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                        {([['30d',tr581?'30 Gün':'30d'],['90d',tr581?'90 Gün':'90d'],['ytd','YTD']] as const).map(([id,label])=>(
                          <button key={id} onClick={()=>setP581RepPeriod(id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${p581RepPeriod===id?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-gray-100 bg-gray-50">
                          {[tr581?'Temsilci':'Rep', tr581?'Lead':'Leads', tr581?'Kapatılan':'Won', tr581?'Dönüşüm':'Conv.', tr581?'Gelir':'Revenue'].map(h=>(
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody className="divide-y divide-gray-50">
                          {repList.map((r,i)=>(
                            <tr key={r.name} className="hover:bg-gray-50/50">
                              <td className="px-3 py-2.5 font-semibold text-gray-800">
                                <span className="inline-flex items-center gap-1.5">
                                  {i===0 && <span className="text-amber-500">🥇</span>}
                                  {i===1 && <span className="text-gray-400">🥈</span>}
                                  {i===2 && <span className="text-amber-700">🥉</span>}
                                  {r.name}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-gray-600">{r.leads}</td>
                              <td className="px-3 py-2.5 text-emerald-600 font-bold">{r.won}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${r.convRate>=30?'bg-emerald-400':r.convRate>=15?'bg-amber-400':'bg-gray-300'}`} style={{width:`${Math.min(r.convRate,100)}%`}}/>
                                  </div>
                                  <span className="font-bold">{r.convRate.toFixed(0)}%</span>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 font-bold font-mono text-brand">
                                {r.revenue > 0 ? `₺${r.revenue.toLocaleString('tr-TR',{maximumFractionDigits:0})}` : '—'}
                                {p586Targets[r.name] > 0 && r.revenue > 0 && (
                                  <span className={`ml-1 text-[9px] font-bold px-1 py-0.5 rounded-full ${r.revenue>=p586Targets[r.name]?'bg-green-100 text-green-700':'bg-red-100 text-red-500'}`}>
                                    {Math.round((r.revenue/p586Targets[r.name])*100)}%
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Phase 586: Per-rep revenue targets */}
                    {hasFullAccess('crm') && repList.length > 0 && (
                      <div className="border-t border-gray-100 px-4 py-3">
                        <p className="text-[10px] text-gray-400 uppercase font-semibold mb-2">{tr581?'Aylık Ciro Hedefleri (₺)':'Monthly Revenue Targets (₺)'}</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {repList.map(r=>(
                            <div key={r.name} className="flex items-center gap-2">
                              <span className="text-xs text-gray-600 truncate min-w-0 flex-1">{r.name}</span>
                              <input type="number" value={p586Targets[r.name]||''} onChange={e=>setP586Targets(prev=>({...prev,[r.name]:Number(e.target.value)||0}))} className="apple-input px-2 py-1 text-xs w-24 text-right" placeholder="0" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Phase 585: Müşteri Sadakat Skoru ──────────────────────────── */}
              {activeTab === 'crm' && !selectedLead && crmTab === 'leads' && (() => {
                const tr585 = currentLanguage === 'tr';
                // Loyalty score: frequency + recency + value
                const customerScores: Record<string,{name:string;orders:number;revenue:number;recencyDays:number;score:number}> = {};
                const now585 = new Date();
                orders.filter(o=>o.status!=='Cancelled').forEach(o=>{
                  const cn = o.customerName||'';
                  if (!cn) return;
                  if (!customerScores[cn]) customerScores[cn]={name:cn,orders:0,revenue:0,recencyDays:999,score:0};
                  customerScores[cn].orders++;
                  customerScores[cn].revenue+=(o.totalPrice||0);
                  if (o.createdAt) {
                    try {
                      const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string);
                      const days=Math.floor((now585.getTime()-d.getTime())/86400000);
                      if (days<customerScores[cn].recencyDays) customerScores[cn].recencyDays=days;
                    } catch {}
                  }
                });
                const maxRev = Math.max(...Object.values(customerScores).map(c=>c.revenue),1);
                const maxOrd = Math.max(...Object.values(customerScores).map(c=>c.orders),1);
                const list585 = Object.values(customerScores).map(c=>{
                  const recencyScore = Math.max(0,100-(c.recencyDays*0.5));
                  const freqScore = (c.orders/maxOrd)*100;
                  const valScore = (c.revenue/maxRev)*100;
                  const score = Math.round(0.3*recencyScore+0.3*freqScore+0.4*valScore);
                  return {...c,score};
                }).sort((a,b)=>b.score-a.score).slice(0,p585TopN);
                if (list585.length===0) return null;
                const getTier=(s:number)=>s>=80?{label:tr585?'Platin':'Platinum',cls:'bg-purple-100 text-purple-700'}:s>=60?{label:tr585?'Altın':'Gold',cls:'bg-amber-100 text-amber-700'}:s>=40?{label:tr585?'Gümüş':'Silver',cls:'bg-gray-100 text-gray-600'}:{label:tr585?'Bronz':'Bronze',cls:'bg-orange-100 text-orange-700'};
                return (
                  <div className="apple-card p-5">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <h3 className="font-bold text-gray-900 text-sm">{tr585?'💎 Müşteri Sadakat Analizi':'💎 Customer Loyalty Analysis'}</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">Top</span>
                        <select value={p585TopN} onChange={e=>setP585TopN(Number(e.target.value))} className="apple-input px-2 py-1 text-xs">
                          {[5,10,20].map(n=><option key={n}>{n}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {list585.map(c=>{
                        const tier=getTier(c.score);
                        return (
                          <div key={c.name} className="flex items-center gap-3 py-1.5">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${tier.cls}`}>{tier.label}</span>
                            <span className="text-xs font-medium text-gray-800 min-w-[120px] truncate">{c.name}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-brand to-orange-400 rounded-full" style={{width:`${c.score}%`}}/>
                            </div>
                            <span className="text-xs font-bold text-gray-700 w-8 text-right">{c.score}</span>
                            <span className="text-[10px] text-gray-400 w-20 text-right hidden sm:block">₺{c.revenue.toLocaleString('tr-TR',{maximumFractionDigits:0})}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-3">* {tr585?'Skor: Son alım (30%), sipariş sıklığı (30%), toplam değer (40%)':'Score: Recency 30%, Frequency 30%, Value 40%'}</p>
                  </div>
                );
              })()}

              {/* ── Phase 601: Müşteri Segmentasyon Analizi ──────────────────── */}
              {activeTab === 'crm' && !selectedLead && crmTab === 'leads' && (() => {
                const tr601 = currentLanguage === 'tr';
                // RFM Segmentation using orders
                const customerMap601: Record<string,{name:string;orders:number;revenue:number;recencyDays:number;type:string}> = {};
                const now601 = new Date();
                orders.filter(o=>o.status!=='Cancelled').forEach(o=>{
                  const cn = o.customerName||'';
                  if (!cn) return;
                  if (!customerMap601[cn]) customerMap601[cn]={name:cn,orders:0,revenue:0,recencyDays:999,type:o.customerType||'Retail'};
                  customerMap601[cn].orders++;
                  customerMap601[cn].revenue+=(o.totalPrice||0);
                  if (o.createdAt) {
                    try {
                      const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string);
                      const days=Math.floor((now601.getTime()-d.getTime())/86400000);
                      if (days<customerMap601[cn].recencyDays) customerMap601[cn].recencyDays=days;
                    } catch {}
                  }
                });
                const customers601 = Object.values(customerMap601);
                if (customers601.length===0) return null;
                // Segment by RFM
                const getSegment = (c: typeof customers601[number]) => {
                  if (c.revenue>50000&&c.orders>=5&&c.recencyDays<=30) return {label:tr601?'Şampiyon':'Champion', cls:'bg-emerald-100 text-emerald-700'};
                  if (c.revenue>20000&&c.recencyDays<=60) return {label:tr601?'Sadık Müşteri':'Loyal', cls:'bg-blue-100 text-blue-700'};
                  if (c.recencyDays>180) return {label:tr601?'Kayıp Risk':'At Risk', cls:'bg-red-100 text-red-600'};
                  if (c.orders===1) return {label:tr601?'Yeni Müşteri':'New', cls:'bg-purple-100 text-purple-700'};
                  return {label:tr601?'Potansiyel':'Potential', cls:'bg-amber-100 text-amber-700'};
                };
                const segmented = customers601.map(c=>({...c,segment:getSegment(c)}));
                // Group by segment
                const segGroups: Record<string,{count:number;revenue:number}> = {};
                segmented.forEach(c=>{
                  const s=c.segment.label;
                  if (!segGroups[s]) segGroups[s]={count:0,revenue:0};
                  segGroups[s].count++;
                  segGroups[s].revenue+=c.revenue;
                });
                const byType601 = {B2B:customers601.filter(c=>c.type==='B2B'),Retail:customers601.filter(c=>c.type!=='B2B')};
                return (
                  <div className="apple-card p-5">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <h3 className="font-bold text-gray-900 text-sm">{tr601?'🎯 Müşteri Segmentasyon Analizi':'🎯 Customer Segmentation'}</h3>
                      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                        {([['rfm',tr601?'RFM Segmentler':'RFM Segments'],['revenue',tr601?'Gelir Dilimi':'Revenue Tier'],['type',tr601?'Müşteri Tipi':'Customer Type']] as const).map(([id,label])=>(
                          <button key={id} onClick={()=>setP601Segment(id)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${p601Segment===id?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{label}</button>
                        ))}
                      </div>
                    </div>
                    {p601Segment==='rfm' && (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {Object.entries(segGroups).map(([seg,v])=>(
                          <div key={seg} className="bg-gray-50 rounded-xl p-3">
                            <p className="text-xs text-gray-500 font-semibold">{seg}</p>
                            <p className="text-xl font-bold text-gray-800 mt-1">{v.count}</p>
                            <p className="text-xs text-gray-400">₺{v.revenue.toLocaleString('tr-TR',{maximumFractionDigits:0})}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {p601Segment==='revenue' && (
                      <div className="space-y-2">
                        {[{label:tr601?'100K+ ₺ (Enterprise)':'100K+ ₺',min:100000},{label:tr601?'50K–100K ₺ (Mid-Market)':'50K–100K ₺',min:50000},{label:tr601?'10K–50K ₺ (SMB)':'10K–50K ₺',min:10000},{label:tr601?'<10K ₺ (Small)':'<10K ₺',min:0}].map((tier,i,arr)=>{
                          const max=arr[i-1]?.min||Infinity;
                          const count=customers601.filter(c=>c.revenue>=tier.min&&c.revenue<max).length;
                          const pct=customers601.length>0?(count/customers601.length)*100:0;
                          return (<div key={tier.label} className="flex items-center gap-3"><span className="text-xs text-gray-600 w-36 truncate">{tier.label}</span><div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden"><div className="h-full bg-brand rounded-full" style={{width:`${pct}%`}}/></div><span className="text-xs font-bold text-gray-700 w-8 text-right">{count}</span></div>);
                        })}
                      </div>
                    )}
                    {p601Segment==='type' && (
                      <div className="grid grid-cols-2 gap-4">
                        {Object.entries(byType601).map(([type,list])=>(
                          <div key={type} className={`rounded-xl p-4 ${type==='B2B'?'bg-blue-50':'bg-purple-50'}`}>
                            <p className={`text-sm font-bold ${type==='B2B'?'text-blue-700':'text-purple-700'}`}>{type==='B2B'?'🏢 B2B':'🛒 Retail'}</p>
                            <p className="text-2xl font-bold text-gray-800 mt-1">{list.length}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{tr601?'Toplam gelir:':'Total revenue:'} ₺{list.reduce((s,c)=>s+c.revenue,0).toLocaleString('tr-TR',{maximumFractionDigits:0})}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Phase 613: Müşteri Portföy Analizi ───────────────────────── */}
              {activeTab === 'crm' && !selectedLead && crmTab === 'leads' && leads.length > 0 && (() => {
                const tr613 = currentLanguage === 'tr';
                // Revenue per customer from orders
                const custRevMap:{[name:string]:{revenue:number;orderCount:number;customerType:string}} = {};
                orders.filter(o=>o.status!=='Cancelled').forEach(o=>{
                  if(!custRevMap[o.customerName]) custRevMap[o.customerName]={revenue:0,orderCount:0,customerType:o.customerType||'Retail'};
                  custRevMap[o.customerName].revenue += o.totalPrice||0;
                  custRevMap[o.customerName].orderCount++;
                });
                const custRows = Object.entries(custRevMap).map(([name,d])=>({name,...d})).sort((a,b)=>b.revenue-a.revenue);
                const totalRev613 = custRows.reduce((s,r)=>s+r.revenue,0);
                // Top 20% (Pareto)
                const top20pct = Math.ceil(custRows.length*0.2);
                const top20rev = custRows.slice(0,top20pct).reduce((s,r)=>s+r.revenue,0);
                const paretoShare = totalRev613>0?(top20rev/totalRev613*100):0;
                if (custRows.length===0) return null;
                return (
                  <div className="apple-card p-5 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="font-bold text-gray-900 text-sm">🎯 {tr613?'Müşteri Portföy Analizi':'Customer Portfolio Analysis'}</h3>
                      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                        {([{k:'revenue',l:tr613?'Ciro':'Revenue'},{k:'orders',l:tr613?'Sipariş':'Orders'},{k:'risk',l:tr613?'Risk':'Risk'}] as {k:'revenue'|'orders'|'risk';l:string}[]).map(t=>(
                          <button key={t.k} onClick={()=>setP613Metric(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p613Metric===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr613?'Müşteri':'Customers'}</p><p className="text-xl font-black text-blue-600">{custRows.length}</p></div>
                      <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr613?'Toplam Ciro':'Total Rev.'}</p><p className="text-base font-black text-emerald-600">₺{Math.round(totalRev613/1000)}K</p></div>
                      <div className="bg-amber-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">Pareto 80/20</p><p className="text-xl font-black text-amber-600">%{paretoShare.toFixed(0)}</p></div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-gray-100 bg-gray-50">
                          {['#',tr613?'Müşteri':'Customer',tr613?'Tip':'Type',tr613?'Ciro':'Revenue',tr613?'Sipariş':'Orders',tr613?'Pay':'Share'].map(h=>(
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody className="divide-y divide-gray-50">
                          {(p613Metric==='revenue'?custRows:p613Metric==='orders'?[...custRows].sort((a,b)=>b.orderCount-a.orderCount):[...custRows].filter(r=>r.revenue<totalRev613*0.01)).slice(0,10).map((r,idx)=>{
                            const share = totalRev613>0?(r.revenue/totalRev613*100):0;
                            return (
                              <tr key={r.name} className={`hover:bg-gray-50/50 ${idx<top20pct&&p613Metric==='revenue'?'bg-amber-50/30':''}`}>
                                <td className="px-3 py-2 text-gray-400">{idx+1}</td>
                                <td className="px-3 py-2 font-medium text-gray-800 truncate max-w-[140px]">{r.name}</td>
                                <td className="px-3 py-2 text-gray-500">{r.customerType}</td>
                                <td className="px-3 py-2 font-mono font-bold text-gray-700">₺{Math.round(r.revenue).toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2 text-gray-500">{r.orderCount}</td>
                                <td className="px-3 py-2 text-blue-600 font-bold">%{share.toFixed(1)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 626: Müşteri Ödeme Davranış Analizi ─────────────────── */}
              {activeTab === 'crm' && !selectedLead && crmTab === 'leads' && orders.length > 0 && (() => {
                const tr626 = currentLanguage === 'tr';
                const daysMap626:{[k:string]:number} = {'30d':30,'90d':90,ytd:new Date().getDate()+new Date().getMonth()*30};
                const days626 = daysMap626[p626Period];
                const cutoff626 = new Date(Date.now()-days626*86400000);
                // Paid orders in period
                const paidOrders = orders.filter(o=>{
                  if(!o.paid||!o.createdAt) return false;
                  try { const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string); return d>=cutoff626; } catch { return false; }
                });
                const unpaidOrders = orders.filter(o=>!o.paid&&o.status!=='Cancelled');
                const payRate = orders.filter(o=>o.status!=='Cancelled').length>0?(paidOrders.length/orders.filter(o=>o.status!=='Cancelled').length*100):0;
                // Payment method breakdown
                const methodMap:{[k:string]:number} = {};
                paidOrders.forEach(o=>{ const m=o.paymentMethod||'other'; methodMap[m]=(methodMap[m]||0)+1; });
                const methodRows = Object.entries(methodMap).sort((a,b)=>b[1]-a[1]);
                const methodLabels:{[k:string]:string} = {cash:tr626?'Nakit':'Cash',bank_transfer:tr626?'Banka Transferi':'Bank Transfer',credit_card:tr626?'Kredi Kartı':'Credit Card',check:tr626?'Çek':'Check',other:tr626?'Diğer':'Other'};
                if (paidOrders.length===0&&unpaidOrders.length===0) return null;
                return (
                  <div className="apple-card p-5 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="font-bold text-gray-900 text-sm">💳 {tr626?'Müşteri Ödeme Analizi':'Customer Payment Analysis'}</h3>
                      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                        {([{k:'30d',l:'30d'},{k:'90d',l:'90d'},{k:'ytd',l:'YTD'}] as {k:'30d'|'90d'|'ytd';l:string}[]).map(t=>(
                          <button key={t.k} onClick={()=>setP626Period(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p626Period===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr626?'Ödeme Oranı':'Pay Rate'}</p><p className="text-xl font-black text-emerald-600">%{payRate.toFixed(1)}</p></div>
                      <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr626?'Ödendi':'Paid'}</p><p className="text-xl font-black text-blue-600">{paidOrders.length}</p></div>
                      <div className="bg-red-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr626?'Ödenmedi':'Unpaid'}</p><p className="text-xl font-black text-red-600">{unpaidOrders.length}</p></div>
                    </div>
                    {methodRows.length>0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-gray-500">{tr626?'Ödeme Yöntemi Dağılımı':'Payment Method Breakdown'}</p>
                        {methodRows.map(([method,count])=>{
                          const pct = paidOrders.length>0?(count/paidOrders.length*100):0;
                          return (
                            <div key={method} className="flex items-center gap-3">
                              <span className="text-xs text-gray-600 w-28 shrink-0">{methodLabels[method]||method}</span>
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-400 rounded-full" style={{width:`${pct}%`}}/>
                              </div>
                              <span className="text-xs font-bold text-gray-700 w-10 text-right">{count}</span>
                              <span className="text-xs text-gray-400 w-10">%{pct.toFixed(0)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Phase 604: Satış Temsilcisi Komisyon Takibi ───────────────── */}
              {activeTab === 'crm' && !selectedLead && crmTab === 'leads' && (() => {
                const tr604 = currentLanguage === 'tr';
                const now604 = new Date();
                const monthStart604 = new Date(now604.getFullYear(), now604.getMonth(), 1);
                const repRevMap: Record<string,number> = {};
                orders.filter(o => {
                  if (o.status==='Cancelled'||!o.assignedTo||!o.createdAt) return false;
                  try {
                    const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string);
                    return d>=monthStart604;
                  } catch { return false; }
                }).forEach(o => {
                  const rep = o.assignedTo!;
                  repRevMap[rep] = (repRevMap[rep]||0) + (o.totalPrice||0);
                });
                const commList = Object.entries(repRevMap).map(([rep,rev])=>({rep,rev,comm:rev*(p604CommRate/100)})).sort((a,b)=>b.comm-a.comm);
                if (commList.length===0) return null;
                return (
                  <div className="apple-card p-5">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <h3 className="font-bold text-gray-900 text-sm">{tr604?'💰 Satış Komisyon Takibi (Bu Ay)':'💰 Sales Commission Tracker (This Month)'}</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{tr604?'Oran:':'Rate:'}</span>
                        <input type="number" value={p604CommRate} onChange={e=>setP604CommRate(Number(e.target.value))} className="apple-input px-2 py-1 text-xs w-14 text-right" />
                        <span className="text-xs text-gray-500">%</span>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-gray-100 bg-gray-50">
                          {[tr604?'Temsilci':'Rep', tr604?'Ciro':'Revenue', tr604?'Komisyon':'Commission'].map(h=>(
                            <th key={h} className="px-4 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody className="divide-y divide-gray-50">
                          {commList.map(r=>(
                            <tr key={r.rep} className="hover:bg-gray-50/50">
                              <td className="px-4 py-2.5 font-medium text-gray-800">{r.rep}</td>
                              <td className="px-4 py-2.5 font-mono text-gray-600">₺{r.rev.toLocaleString('tr-TR',{maximumFractionDigits:0})}</td>
                              <td className="px-4 py-2.5 font-bold font-mono text-emerald-600">₺{r.comm.toLocaleString('tr-TR',{maximumFractionDigits:0})}</td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-gray-200 bg-gray-50">
                            <td className="px-4 py-2 font-bold text-gray-700">{tr604?'Toplam':'Total'}</td>
                            <td className="px-4 py-2 font-bold font-mono text-gray-700">₺{commList.reduce((s,r)=>s+r.rev,0).toLocaleString('tr-TR',{maximumFractionDigits:0})}</td>
                            <td className="px-4 py-2 font-bold font-mono text-emerald-700">₺{commList.reduce((s,r)=>s+r.comm,0).toLocaleString('tr-TR',{maximumFractionDigits:0})}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 633: RFM Müşteri Segmentasyonu ────────────────────── */}
              {activeTab === 'crm' && !selectedLead && crmTab === 'leads' && leads.length > 0 && (() => {
                const tr633 = currentLanguage === 'tr';
                const now633 = Date.now();
                const scored = leads.filter(l=>!['Closed Lost'].includes(l.status)).map(l=>{
                  const cOrds = orders.filter(o=>o.customerName===l.name||(o as unknown as Record<string,unknown>)['customerId']===l.id);
                  const cRev = cOrds.reduce((s,o)=>s+(o.totalPrice||0),0);
                  const lastOrd = cOrds.length>0?Math.max(...cOrds.map(o=>{try{const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string);return d.getTime();}catch{return 0;}})):0;
                  const recency = lastOrd>0?Math.round((now633-lastOrd)/86400000):999;
                  const frequency = cOrds.length;
                  const monetary = cRev;
                  const rScore = recency<30?5:recency<60?4:recency<90?3:recency<180?2:1;
                  const fScore = frequency>=10?5:frequency>=6?4:frequency>=3?3:frequency>=1?2:1;
                  const mScore = monetary>=50000?5:monetary>=20000?4:monetary>=5000?3:monetary>=1000?2:1;
                  const total = rScore+fScore+mScore;
                  const seg: 'champions'|'loyal'|'at-risk'|'lost' = total>=13?'champions':total>=9?'loyal':total>=5?'at-risk':'lost';
                  return {id:l.id,name:l.name,company:l.company||'',recency,frequency,monetary,rScore,fScore,mScore,total,seg};
                }).sort((a,b)=>b.total-a.total);
                const filtered633 = p633Segment==='all'?scored:scored.filter(x=>x.seg===p633Segment);
                const segCounts = {champions:scored.filter(x=>x.seg==='champions').length,loyal:scored.filter(x=>x.seg==='loyal').length,'at-risk':scored.filter(x=>x.seg==='at-risk').length,lost:scored.filter(x=>x.seg==='lost').length};
                const segCls:{[k:string]:string}={champions:'bg-amber-100 text-amber-700',loyal:'bg-emerald-100 text-emerald-700','at-risk':'bg-orange-100 text-orange-700',lost:'bg-red-100 text-red-700'};
                const segLabel:{[k:string]:string}={champions:tr633?'Şampiyon':'Champion',loyal:tr633?'Sadık':'Loyal','at-risk':tr633?'Risk Altında':'At Risk',lost:tr633?'Kayıp':'Lost'};
                return (
                  <div className="apple-card p-5 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div><h3 className="font-bold text-gray-900 text-sm">🎯 {tr633?'RFM Müşteri Segmentasyonu':'RFM Customer Segmentation'}</h3>
                      <p className="text-xs text-gray-400">{tr633?'Recency · Frequency · Monetary değerlerine göre segmentasyon':'Segments customers by recency, frequency & monetary value'}</p></div>
                      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
                        {([{k:'all',l:tr633?'Tümü':'All'},{k:'champions',l:segLabel.champions},{k:'loyal',l:segLabel.loyal},{k:'at-risk',l:segLabel['at-risk']},{k:'lost',l:segLabel.lost}] as {k:'all'|'champions'|'loyal'|'at-risk'|'lost';l:string}[]).map(t=>(
                          <button key={t.k} onClick={()=>setP633Segment(t.k)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${p633Segment===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}{t.k!=='all'?` (${segCounts[t.k as keyof typeof segCounts]})`:''}</button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {(['champions','loyal','at-risk','lost'] as const).map(s=>(
                        <div key={s} className={`rounded-xl p-3 ${segCls[s]}`}><p className="text-[10px] font-bold uppercase opacity-70">{segLabel[s]}</p><p className="text-xl font-black">{segCounts[s]}</p></div>
                      ))}
                    </div>
                    {filtered633.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-gray-100 bg-gray-50">
                            {[tr633?'Müşteri':'Customer','R','F','M',tr633?'Toplam':'Total',tr633?'Segment':'Segment'].map(h=>(
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                            ))}
                          </tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {filtered633.slice(0,12).map(r=>(
                              <tr key={r.id} className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5"><p className="font-semibold text-gray-800">{r.name}</p><p className="text-[10px] text-gray-400">{r.company}</p></td>
                                <td className="px-3 py-2.5"><span className={`font-bold ${r.rScore>=4?'text-emerald-600':r.rScore<=2?'text-red-500':'text-amber-500'}`}>{r.rScore}</span><span className="text-[10px] text-gray-400 ml-1">{r.recency<999?`${r.recency}g`:'—'}</span></td>
                                <td className="px-3 py-2.5"><span className="font-bold text-blue-600">{r.fScore}</span><span className="text-[10px] text-gray-400 ml-1">{r.frequency}</span></td>
                                <td className="px-3 py-2.5"><span className="font-bold text-purple-600">{r.mScore}</span><span className="text-[10px] text-gray-400 ml-1">₺{(r.monetary/1000).toFixed(0)}K</span></td>
                                <td className="px-3 py-2.5 font-black text-gray-800">{r.total}</td>
                                <td className="px-3 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${segCls[r.seg]}`}>{segLabel[r.seg]}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-center text-gray-400 text-xs py-4">{tr633?'Bu segmentte müşteri yok.':'No customers in this segment.'}</p>}
                  </div>
                );
              })()}

              </>}
        </motion.div>
      )}
      {selectedLead && (
        <motion.div key="crm-detail" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setSelectedLead(null)} className="text-gray-500 hover:text-gray-900 bg-white p-2 rounded-full shadow-sm border border-gray-200 shrink-0">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <ModuleHeader
                  title={selectedLead.name}
                  subtitle={selectedLead.company}
                  className="mb-0 w-full"
                  actionButton={
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={() => { setEditingLeadData(selectedLead); setIsEditingLead(true); }} className="apple-button-secondary">
                        <Edit2 className="w-4 h-4" /> {currentT.edit}
                      </button>
                      <button onClick={() => handleDeleteLead(selectedLead.id)} className="apple-button-secondary text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" /> {currentT.delete}
                      </button>
                      {selectedLead.phone && (
                        <button
                          onClick={async () => {
                            const msg = currentLanguage === 'tr'
                              ? `Merhaba ${selectedLead.name}, Cetpa'dan yazıyoruz. Size nasıl yardımcı olabiliriz?`
                              : `Hello ${selectedLead.name}, reaching out from Cetpa. How can we help you?`;
                            try {
                              const r = await authFetch('/api/whatsapp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: selectedLead.phone, message: msg }) });
                              const d = await r.json();
                              if (d.success) toast(currentLanguage === 'tr' ? 'WhatsApp mesajı gönderildi ✓' : 'WhatsApp message sent ✓', 'success');
                              else if (d.notConfigured) toast(currentLanguage === 'tr' ? 'WhatsApp sağlayıcısı yapılandırılmamış. Ayarlar\'dan WHATSAPP_360DIALOG_API_KEY ekleyin.' : 'WhatsApp provider not configured. Add WHATSAPP_360DIALOG_API_KEY in Settings.', 'error');
                              else toast(d.error || 'WhatsApp hatası', 'error');
                            } catch(e) { toast(e instanceof Error ? e.message : 'Hata', 'error'); }
                          }}
                          className="apple-button-secondary text-green-700 hover:bg-green-50"
                        >
                          <MessageSquare className="w-4 h-4" /> WhatsApp
                        </button>
                      )}
                      {/* Phase 41: Quick Call + Email buttons */}
                      {selectedLead.phone && (
                        <a href={`tel:${selectedLead.phone}`}
                          className="apple-button-secondary flex items-center gap-2 text-blue-700 hover:bg-blue-50"
                          title={selectedLead.phone}>
                          <Phone className="w-4 h-4" />
                          {currentLanguage === 'tr' ? 'Ara' : 'Call'}
                        </a>
                      )}
                      {/* Phase 100: In-App Email Compose */}
                      {selectedLead.email && (
                        <button
                          onClick={() => setEmailCompose({
                            open: true,
                            to: selectedLead.email,
                            name: selectedLead.name,
                            subject: currentLanguage === 'tr' ? `Cetpa — ${selectedLead.name}` : `Cetpa — ${selectedLead.name}`,
                            body: currentLanguage === 'tr'
                              ? `Merhaba ${selectedLead.name},\n\n`
                              : `Hello ${selectedLead.name},\n\n`,
                          })}
                          className="apple-button-secondary flex items-center gap-2 text-purple-700 hover:bg-purple-50"
                          title={selectedLead.email}>
                          <Mail className="w-4 h-4" />
                          {currentLanguage === 'tr' ? 'E-posta Yaz' : 'Compose Email'}
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          const leadOrders = orders.filter(o =>
                            o.leadId === selectedLead.id || o.customerName === selectedLead.name
                          );
                          const { exportCustomerStatement } = await import('../utils/pdf');
                          exportCustomerStatement(
                            selectedLead,
                            leadOrders,
                            currentLanguage as 'tr' | 'en',
                          );
                        }}
                        className="apple-button-secondary flex items-center gap-2"
                        title={currentLanguage === 'tr' ? 'Hesap ekstresi PDF olarak indir' : 'Download account statement PDF'}
                      >
                        <FileDown className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Ekstre PDF' : 'Statement PDF'}
                      </button>
                      {/* Phase 502: In-app Customer Statement Modal */}
                      <button
                        onClick={() => setShowStmtModal(selectedLead.id)}
                        className="apple-button-secondary flex items-center gap-2"
                        title={currentLanguage === 'tr' ? 'Hesap ekstresi görüntüle' : 'View account statement'}
                      >
                        <BarChart2 className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Ekstre Görüntüle' : 'View Statement'}
                      </button>
                      {/* Phase 524: Customer Lifetime Value Badge */}
                      {(() => {
                        const clvOrders = orders.filter(o =>
                          (o.leadId === selectedLead.id || o.customerName === selectedLead.name)
                          && o.status !== 'Cancelled'
                        );
                        const clvTotal = clvOrders.reduce((s, o) => s + (o.totalPrice ?? o.totalAmount ?? 0), 0);
                        const clvCount = clvOrders.length;
                        return clvTotal > 0 ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border",
                              darkMode
                                ? "bg-violet-900/40 border-violet-700/50 text-violet-300"
                                : "bg-violet-50 border-violet-200 text-violet-700"
                            )}
                            title={currentLanguage === 'tr'
                              ? `${clvCount} sipariş`
                              : `${clvCount} order${clvCount !== 1 ? 's' : ''}`}
                          >
                            <Tag className="w-3 h-3" />
                            CLV: ₺{clvTotal.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </span>
                        ) : null;
                      })()}
                      {/* Phase 92: Mark as Won / Reopen */}
                      {selectedLead.status !== 'Closed' ? (
                        <button
                          onClick={() => openConfirm({
                            title: currentLanguage === 'tr' ? 'Aday Kazanıldı mı?' : 'Mark Lead as Won?',
                            message: currentLanguage === 'tr'
                              ? `"${selectedLead.name}" adayını Kapandı (Kazanıldı) olarak işaretlemek istiyor musunuz?`
                              : `Mark "${selectedLead.name}" as Closed (Won)?`,
                            confirmLabel: currentLanguage === 'tr' ? 'Kazanıldı ✓' : 'Mark Won ✓',
                            onConfirm: async () => {
                              try {
                                await updateDoc(doc(db, 'leads', selectedLead.id), { status: 'Closed', updatedAt: serverTimestamp() });
                                setSelectedLead({ ...selectedLead, status: 'Closed' });
                                toast(currentLanguage === 'tr' ? '🎉 Aday kazanıldı olarak işaretlendi!' : '🎉 Lead marked as won!', 'success');
                              } catch(err) { handleFirestoreError(err, OperationType.UPDATE, `leads/${selectedLead.id}`); }
                            },
                          })}
                          className="apple-button-secondary text-emerald-700 hover:bg-emerald-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {currentLanguage === 'tr' ? 'Kazanıldı' : 'Mark Won'}
                        </button>
                      ) : (
                        <button
                          onClick={() => openConfirm({
                            title: currentLanguage === 'tr' ? 'Aday Yeniden Aç?' : 'Reopen Lead?',
                            message: currentLanguage === 'tr' ? `"${selectedLead.name}" adayını yeniden açmak istiyor musunuz?` : `Reopen lead "${selectedLead.name}"?`,
                            confirmLabel: currentLanguage === 'tr' ? 'Yeniden Aç' : 'Reopen',
                            onConfirm: async () => {
                              try {
                                await updateDoc(doc(db, 'leads', selectedLead.id), { status: 'Qualified', updatedAt: serverTimestamp() });
                                setSelectedLead({ ...selectedLead, status: 'Qualified' });
                                toast(currentLanguage === 'tr' ? 'Aday yeniden açıldı' : 'Lead reopened', 'info');
                              } catch(err) { handleFirestoreError(err, OperationType.UPDATE, `leads/${selectedLead.id}`); }
                            },
                          })}
                          className="apple-button-secondary text-amber-700 hover:bg-amber-50"
                        >
                          <RefreshCw className="w-4 h-4" />
                          {currentLanguage === 'tr' ? 'Yeniden Aç' : 'Reopen'}
                        </button>
                      )}
                      {/* Phase 83: pre-fill order form from lead */}
                      <button onClick={() => {
                        setNewOrder(prev => ({
                          ...prev,
                          customerName: selectedLead.name,
                          shippingAddress: selectedLead.company || '',
                          customerType: selectedLead.customerType || 'B2B',
                          faturali: selectedLead.customerType === 'B2B',
                          faturaTipi: selectedLead.customerType === 'B2B' ? 'e-fatura' : 'e-arsiv',
                          leadId: selectedLead.id,
                        }));
                        setOrderCustomerSearch(selectedLead.name);
                        setIsAddingOrder(true);
                      }} className="apple-button-primary">
                        <Plus className="w-4 h-4" /> {currentT.add_order}
                      </button>
                    </div>
                  }
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h3 className="font-bold mb-4">{currentT.lead_details}</h3>
                    <div className="space-y-4 text-sm">
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold mb-1">{currentT.status}</span>
                        <select value={selectedLead.status} onChange={(e) => openConfirm({
                          title: currentT.status,
                          message: `Update status to "${e.target.value}"?`,
                          onConfirm: () => handleUpdateLeadStatus(selectedLead.id, e.target.value as 'New' | 'Contacted' | 'Qualified' | 'Closed')
                        })}
                          className="block w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-brand font-medium">
                          <option value="New">{currentT.new}</option>
                          <option value="Contacted">{currentT.contacted}</option>
                          <option value="Qualified">{currentT.qualified}</option>
                          <option value="Closed">{currentT.closed}</option>
                        </select>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">Email</span>
                        <span className="font-medium">{selectedLead.email || '--'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">Phone</span>
                        <span className="font-medium">{selectedLead.phone || '--'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">{currentT.ai_score}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={cn("font-bold text-lg", (selectedLead.score || 0) > 70 ? "text-emerald-600" : "text-[#1D2226]")}>
                            {selectedLead.score || '--'}
                          </span>
                          {/* Phase 542: AI Re-score button */}
                          <button
                            disabled={rescoreLeadId === selectedLead.id}
                            onClick={async () => {
                              setRescoreLeadId(selectedLead.id);
                              try {
                                const newScore = await scoreLead(selectedLead as unknown as Record<string, unknown>);
                                if (typeof newScore === 'number' && !isNaN(newScore)) {
                                  await updateDoc(doc(db, 'leads', selectedLead.id), { score: newScore, scoredAt: serverTimestamp() });
                                  setSelectedLead({ ...selectedLead, score: newScore });
                                  toast(
                                    currentLanguage === 'tr'
                                      ? `AI skoru güncellendi: ${newScore}/100`
                                      : `AI score updated: ${newScore}/100`,
                                    'success'
                                  );
                                }
                              } catch (e) { console.error("[lead-rescore]", e); toast(currentLanguage === "tr" ? "AI skorlama başarısız." : "AI scoring failed.", "error"); }
                              finally { setRescoreLeadId(null); }
                            }}
                            className="text-[9px] font-bold px-2 py-1 rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100 transition-colors disabled:opacity-40 flex items-center gap-1"
                            title={currentLanguage === 'tr' ? 'AI ile yeniden puanla' : 'Re-score with AI'}
                          >
                            {rescoreLeadId === selectedLead.id
                              ? <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                              : '✦'}
                            {currentLanguage === 'tr' ? 'Yeniden Puan' : 'Re-score'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h3 className="font-bold mb-4">{currentT.notes_ai_insights}</h3>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{selectedLead.notes || currentT.no_notes_available}</p>
                  </div>
                  {/* ── Phase 58: Lead Quick-Note ── */}
                  <div className="bg-amber-50 border border-amber-100 p-5 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Hızlı Not (Yerel)' : 'Quick Note (Local)'}
                      </h3>
                      {leadNoteText && (
                        <span className="text-[9px] text-amber-500 font-semibold">
                          {currentLanguage === 'tr' ? 'Otomatik kaydediliyor' : 'Auto-saved'}
                        </span>
                      )}
                    </div>
                    <textarea
                      value={leadNoteText}
                      onChange={e => handleLeadNoteChange(e.target.value)}
                      rows={3}
                      placeholder={currentLanguage === 'tr' ? 'Bu müşteri adayı için hızlı notunuzu yazın…' : 'Jot a quick note about this lead…'}
                      className="w-full bg-white/70 rounded-lg px-3 py-2 text-sm text-gray-700 placeholder-amber-300 outline-none focus:ring-2 focus:ring-amber-200 resize-none leading-relaxed border border-amber-100"
                    />
                  </div>
                </div>

                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h3 className="font-bold mb-4 flex items-center gap-2">
                      <Package className="w-5 h-5 text-brand" /> {currentT.associated_orders}
                    </h3>
                    {/* Phase 96 + Phase 104: Financial summary + CLV + Churn Risk */}
                    {(() => {
                      const custOrders = orders.filter(o => o.leadId === selectedLead.id || o.customerName === selectedLead.name);
                      const p96Rate   = kpiCurrency === 'USD' ? (exchangeRates?.USD||1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR||1) : 1;
                      const p96Sym    = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                      const fmt       = (v: number) => `${p96Sym}${(kpiCurrency === 'TRY' ? v : v / p96Rate).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`;
                      if (custOrders.length === 0) return null;
                      const totalRev  = custOrders.reduce((s, o) => s + (o.totalPrice ?? 0), 0);
                      const paidRev   = custOrders.filter(o => o.paid).reduce((s, o) => s + (o.totalPrice ?? 0), 0);
                      const unpaidRev = totalRev - paidRev;
                      // Phase 104: CLV calculations
                      const getOD104 = (o: Order): Date => {
                        const raw = o.createdAt ?? o.syncedAt;
                        if (!raw) return new Date(0);
                        return typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
                      };
                      const sorted104    = [...custOrders].sort((a, b) => getOD104(a).getTime() - getOD104(b).getTime());
                      const firstOrder   = sorted104[0];
                      const lastOrder    = sorted104[sorted104.length - 1];
                      const firstDate    = getOD104(firstOrder);
                      const lastDate     = getOD104(lastOrder);
                      const daysSinceLast = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
                      const tenureMonths = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 30));
                      const ordersPerMonth = custOrders.length / tenureMonths;
                      const aov = totalRev / custOrders.length;
                      const clv12 = aov * ordersPerMonth * 12;
                      const churnRisk = daysSinceLast > 90 ? 'high' : daysSinceLast > 45 ? 'medium' : 'low';
                      const churnColor = churnRisk === 'high' ? 'bg-red-50 text-red-700 border-red-100' : churnRisk === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100';
                      const churnLabel = churnRisk === 'high' ? (currentLanguage === 'tr' ? '⚠ Kayıp Riski Yüksek' : '⚠ High Churn Risk') : churnRisk === 'medium' ? (currentLanguage === 'tr' ? '~ Orta Risk' : '~ Medium Risk') : (currentLanguage === 'tr' ? '✓ Aktif' : '✓ Active');
                      return (
                        <>
                          <div className="grid grid-cols-3 gap-2 mb-3">
                            {[
                              { label: currentLanguage === 'tr' ? 'Toplam Ciro' : 'Lifetime Revenue', value: fmt(totalRev), color: 'text-gray-800' },
                              { label: currentLanguage === 'tr' ? 'Ödenen' : 'Paid',   value: fmt(paidRev),   color: 'text-emerald-700' },
                              { label: currentLanguage === 'tr' ? 'Bekleyen' : 'Unpaid', value: fmt(unpaidRev), color: unpaidRev > 0 ? 'text-amber-600' : 'text-gray-400' },
                            ].map((s, i) => (
                              <div key={i} className="bg-gray-50 rounded-xl px-3 py-2.5">
                                <p className={`text-base font-black ${s.color}`}>{s.value}</p>
                                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">{s.label}</p>
                              </div>
                            ))}
                          </div>
                          {/* Phase 104: CLV + Churn Risk strip */}
                          <div className="rounded-xl border border-gray-100 bg-gray-50/50 px-4 py-3 mb-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Müşteri Değeri (CLV)' : 'Customer Lifetime Value'}</p>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${churnColor}`}>{churnLabel}</span>
                            </div>
                            <div className="grid grid-cols-4 gap-2 text-center">
                              {[
                                { label: currentLanguage === 'tr' ? '12A CLV' : '12M CLV', value: fmt(clv12), color: 'text-purple-700' },
                                { label: currentLanguage === 'tr' ? 'Ort. Sipariş' : 'Avg Order', value: fmt(aov), color: 'text-blue-600' },
                                { label: currentLanguage === 'tr' ? 'Sıklık/Ay' : 'Freq/Mo', value: ordersPerMonth.toFixed(1), color: 'text-gray-800' },
                                { label: currentLanguage === 'tr' ? 'Son Sipariş' : 'Last Order', value: `${daysSinceLast}g`, color: daysSinceLast > 60 ? 'text-red-500' : 'text-gray-600' },
                              ].map((m, i) => (
                                <div key={i}>
                                  <p className={`text-sm font-black ${m.color}`}>{m.value}</p>
                                  <p className="text-[9px] text-gray-400 font-bold">{m.label}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                    <div className="space-y-3">
                      {orders.filter(o => o.leadId === selectedLead.id || o.customerName === selectedLead.name).length === 0 ? (
                        <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-xl">
                          <Package className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                          <p className="text-sm text-gray-500 font-medium">{currentT.no_orders_found_for_lead}</p>
                          <button onClick={() => setIsAddingOrder(true)} className="mt-4 text-brand font-bold text-sm hover:underline">
                            {currentT.create_first_order}
                          </button>
                        </div>
                      ) : (
                        orders.filter(o => o.leadId === selectedLead.id || o.customerName === selectedLead.name).map(order => (
                          <div key={order.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => { setActiveTab('orders'); setSelectedOrder(order); }}>
                            <div>
                              <p className="font-bold text-sm text-[#1D2226]">{order.shopifyOrderId}</p>
                              <p className="text-xs text-gray-500 mt-1">
                                {order.syncedAt ? (typeof (order.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (order.syncedAt as { toDate: () => Date }).toDate() : new Date(order.syncedAt as unknown as string | number | Date)).toLocaleDateString() : currentT.unknown_date}
                              </p>
                              <p className="text-[10px] text-gray-400 mt-1 truncate max-w-[200px]">{order.shippingAddress}</p>
                            </div>
                            <div className="text-right flex flex-col items-end gap-2">
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteOrder(order.id); }} className="text-gray-400 hover:text-red-600 transition-colors">
                                <Trash2 className="w-4 h-4" />
                              </button>
                              <div>
                                <p className="font-bold text-lg text-[#1D2226]">{formatCurrency(order.totalPrice, exchangeRates)}</p>
                                <div className="flex items-center gap-1.5 mt-1 justify-end flex-wrap">
                                  <select value={order.status} onChange={(e) => { e.stopPropagation(); handleUpdateOrderStatus(order.id, e.target.value as Order['status']); }}
                                    className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded-full inline-block outline-none cursor-pointer appearance-none",
                                      order.status === 'Pending' ? "bg-amber-50 text-amber-600" :
                                        order.status === 'Processing' ? "bg-purple-50 text-purple-600" :
                                          order.status === 'Shipped' ? "bg-blue-50 text-blue-600" :
                                            order.status === 'Delivered' ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-500"
                                    )} onClick={e => e.stopPropagation()}>
                                    <option value="Pending">{currentT.pending}</option>
                                    <option value="Processing">{currentT.processing}</option>
                                    <option value="Shipped">{currentT.shipped}</option>
                                    <option value="Delivered">{currentT.delivered}</option>
                                    <option value="Cancelled">{currentT.cancelled}</option>
                                  </select>
                                  {/* Phase 96: payment badge in lead's order list */}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleToggleOrderPaid(order); }}
                                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full transition-colors ${order.paid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-600'}`}
                                  >
                                    {order.paid ? '✓' : '⏳'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* ── Commission Summary for Dealer / B2B Leads ── */}
                  {(selectedLead.priceTier === 'Dealer' || selectedLead.priceTier === 'B2B Premium' || selectedLead.priceTier === 'B2B Standard' || selectedLead.customerType === 'B2B') && (() => {
                    const now = new Date();
                    const curPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                    const [cpYear, cpMonth] = curPeriod.split('-').map(Number);
                    const dealerOrders = orders.filter(o => {
                      if (o.status === 'Cancelled') return false;
                      const matches = (o.customerName === (selectedLead.company || selectedLead.name));
                      if (!matches) return false;
                      const raw = o.syncedAt ?? o.createdAt;
                      const d = raw && typeof (raw as {toDate?:()=>Date}).toDate === 'function' ? (raw as {toDate:()=>Date}).toDate() : new Date(raw as string|number);
                      return d.getFullYear() === cpYear && d.getMonth() + 1 === cpMonth;
                    });
                    const actualSales = dealerOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
                    const tier = selectedLead.priceTier || 'B2B Standard';
                    const rule = commissionRules.find(r => r.tier === tier);
                    const targetAmount = rule?.targetAmount || 100000;
                    const baseRate = rule?.commissionRate || 3;
                    const bonusRate = rule?.bonusRate || 0;
                    const achievementRate = targetAmount > 0 ? Math.min((actualSales / targetAmount) * 100, 200) : 0;
                    const effectiveRate = achievementRate >= 100 ? baseRate + bonusRate : baseRate * (achievementRate / 100);
                    const commissionEarned = actualSales * (effectiveRate / 100);
                    return (
                      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-bold flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-violet-600" />
                            {currentLanguage === 'tr' ? 'Komisyon Özeti' : 'Commission Summary'}
                          </h3>
                          <span className="text-xs bg-violet-50 text-violet-700 font-bold px-2 py-1 rounded-full">{curPeriod}</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                          {[
                            { label: currentLanguage === 'tr' ? 'Bu Ay Satış' : 'Monthly Sales', value: `₺${actualSales.toLocaleString('tr-TR', {maximumFractionDigits:0})}`, color: 'text-gray-900' },
                            { label: currentLanguage === 'tr' ? 'Hedef' : 'Target', value: `₺${targetAmount.toLocaleString('tr-TR', {maximumFractionDigits:0})}`, color: 'text-gray-500' },
                            { label: currentLanguage === 'tr' ? 'Gerçekleşme' : 'Achievement', value: `${achievementRate.toFixed(1)}%`, color: achievementRate >= 100 ? 'text-emerald-600' : 'text-amber-600' },
                            { label: currentLanguage === 'tr' ? 'Komisyon' : 'Commission', value: `₺${commissionEarned.toLocaleString('tr-TR', {maximumFractionDigits:0})}`, color: 'text-violet-700' },
                          ].map((s, i) => (
                            <div key={i} className="bg-gray-50 rounded-xl p-3">
                              <p className={`text-base font-black ${s.color}`}>{s.value}</p>
                              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">{s.label}</p>
                            </div>
                          ))}
                        </div>
                        {/* Achievement progress */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-gray-500 font-medium">
                            <span>{currentLanguage === 'tr' ? 'Hedef İlerlemesi' : 'Target Progress'}</span>
                            <span className="font-bold">{achievementRate.toFixed(1)}%{achievementRate >= 100 ? ' 🎉' : ''}</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div className={`h-2 rounded-full transition-all ${achievementRate >= 100 ? 'bg-emerald-500' : 'bg-violet-500'}`}
                              style={{ width: `${Math.min(achievementRate, 100)}%` }} />
                          </div>
                          {!rule && (
                            <p className="text-[10px] text-amber-600 mt-1">
                              {currentLanguage === 'tr' ? '⚠ Bu tier için komisyon kuralı tanımlanmamış. CRM → Komisyon bölümünden ekleyin.' : '⚠ No commission rule for this tier. Add one in CRM → Commission.'}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Cari Ekstre (AR aging for this customer) ── */}
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <CariEkstrePanel
                      currentLanguage={currentLanguage}
                      leadId={selectedLead.id}
                      customerName={selectedLead.name}
                    />
                  </div>

                  {/* ── Mutabakat Mektubu ── */}
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <MutabakatPanel leadId={selectedLead.id} currentLanguage={currentLanguage} />
                  </div>

                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-bold flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-brand" /> {currentT.activity_log}
                      </h3>
                      <button onClick={() => setIsAddingActivity(true)} className="text-brand text-sm font-bold hover:underline flex items-center gap-1">
                        <Plus className="w-4 h-4" /> {currentT.add_activity}
                      </button>
                    </div>
                    {isAddingActivity && (
                      <form onSubmit={handleAddActivity} className="mb-6 bg-gray-50 p-4 rounded-xl border border-gray-200">
                        <div className="flex gap-4 mb-3">
                          {['Note', 'Call', 'Email', 'Meeting'].map(type => (
                            <label key={type} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input type="radio" name="type" value={type} checked={newActivity.type === type} onChange={(e) => setNewActivity({ ...newActivity, type: e.target.value as 'Call' | 'Email' | 'Meeting' | 'Note' | 'Visit' })} />
                              {currentT[type.toLowerCase()]}
                            </label>
                          ))}
                        </div>
                        <textarea placeholder={currentT.activity_description} value={newActivity.description} onChange={(e) => setNewActivity({ ...newActivity, description: e.target.value })}
                          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-brand text-sm mb-3 min-h-[80px]" required />
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setIsAddingActivity(false)} className="apple-button-secondary">{currentT.cancel}</button>
                          <button type="submit" className="apple-button-primary">{currentT.save_activity}</button>
                        </div>
                      </form>
                    )}
                    {/* ── Phase 26: Enhanced Activity Timeline ── */}
                    <div className="space-y-0">
                      {(!selectedLead.activities || selectedLead.activities.length === 0) ? (
                        <p className="text-sm text-gray-500 text-center py-4">{currentT.no_activities_logged}</p>
                      ) : (() => {
                        const sorted = [...selectedLead.activities].sort((a, b) => {
                          const getTs = (d: unknown) => typeof (d as { toDate?: () => Date }).toDate === 'function'
                            ? (d as { toDate: () => Date }).toDate().getTime()
                            : new Date(d as string | number).getTime();
                          return getTs(b.date) - getTs(a.date);
                        });
                        const ICON_MAP: Record<string, { icon: React.ElementType; bg: string; color: string }> = {
                          Note:    { icon: FileText, bg: 'bg-gray-100',    color: 'text-gray-600'    },
                          Call:    { icon: Phone,    bg: 'bg-blue-50',     color: 'text-blue-600'    },
                          Email:   { icon: Mail,     bg: 'bg-emerald-50',  color: 'text-emerald-600' },
                          Meeting: { icon: Users,    bg: 'bg-purple-50',   color: 'text-purple-600'  },
                        };
                        return sorted.map((activity, idx) => {
                          const cfg = ICON_MAP[activity.type] ?? ICON_MAP.Note;
                          const Icon = cfg.icon;
                          const dateStr = (() => {
                            const d = typeof (activity.date as { toDate?: () => Date }).toDate === 'function'
                              ? (activity.date as { toDate: () => Date }).toDate()
                              : new Date(activity.date as unknown as string | number);
                            return d.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
                          })();
                          return (
                            <div key={activity.id} className="flex gap-3 relative">
                              {/* Vertical connector line */}
                              {idx < sorted.length - 1 && (
                                <div className="absolute left-4 top-9 bottom-0 w-[2px] bg-gray-100" />
                              )}
                              {/* Icon bubble */}
                              <div className="relative z-10 flex-shrink-0 mt-1">
                                <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center`}>
                                  <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                                </div>
                              </div>
                              {/* Content card */}
                              <div className={`flex-1 bg-gray-50 p-3 rounded-xl border border-gray-100 ${idx < sorted.length - 1 ? 'mb-3' : ''}`}>
                                <div className="flex justify-between items-start mb-1 gap-2">
                                  <span className={`text-xs font-bold ${cfg.color}`}>{currentT[activity.type.toLowerCase()] ?? activity.type}</span>
                                  <span className="text-[9px] text-gray-400 whitespace-nowrap">{dateStr}</span>
                                </div>
                                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{activity.description}</p>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  {/* Voice Notes & Follow-Up */}
                  <div className="mt-6 space-y-6">
                    <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                      <h4 className="font-bold mb-3">{currentT.voice_notes}</h4>
                      <input type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && handleUploadVoiceNote(e.target.files[0])} className="text-sm" />
                      <div className="mt-3 space-y-2">
                        {selectedLead.voiceNotes?.map(note => (
                          <div key={note.id} className="flex items-center gap-2">
                            <audio controls src={note.url} className="h-8" />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                      <h4 className="font-bold mb-3">{currentT.follow_up_reminder}</h4>
                      <input type="date" value={selectedLead.nextFollowUpDate ? (typeof (selectedLead.nextFollowUpDate as { toDate?: () => Date }).toDate === 'function' ? (selectedLead.nextFollowUpDate as { toDate: () => Date }).toDate() : new Date(selectedLead.nextFollowUpDate as unknown as string | number | Date)).toISOString().split('T')[0] : ''} onChange={(e) => handleUpdateFollowUpDate(e.target.value)} className="border rounded p-2 text-sm" />
                    </div>
                  </div>
                </div>
              </div>
        </motion.div>
      )}
      {/* ── Phase 549: İade & Değişim (RMA) ── */}
          {/* ── Phase 549: İade & Değişim (RMA) ──────────────────────────────────── */}
          {activeTab === 'iade' && (() => {
            const tr549 = currentLanguage === 'tr';
            const reasons549 = [tr549?'Hasarlı Ürün':'Damaged Product', tr549?'Yanlış Ürün':'Wrong Product', tr549?'Beklentileri Karşılamıyor':'Unmet Expectations', tr549?'Fikir Değişikliği':'Changed Mind', tr549?'Diğer':'Other'];
            const pending549 = p549Iadeler.filter(r=>r.status==='Bekliyor');
            const approved549 = p549Iadeler.filter(r=>r.status==='Onaylandı');
            const done549 = p549Iadeler.filter(r=>r.status==='Tamamlandı');
            const statusColor = (s: string) => s==='Onaylandı'?'bg-emerald-100 text-emerald-700':s==='Reddedildi'?'bg-red-100 text-red-700':s==='Tamamlandı'?'bg-blue-100 text-blue-700':'bg-orange-100 text-orange-700';
            const decisionColor = (d: string) => d==='İade'?'bg-rose-100 text-rose-700':d==='Değişim'?'bg-violet-100 text-violet-700':d==='Kredi Notu'?'bg-amber-100 text-amber-700':'bg-gray-100 text-gray-600';
            return (
              <motion.div key="iade" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} className="space-y-4">
                <ModuleHeader
                  title={tr549?'İade & Değişim Yönetimi':'Return & Exchange (RMA)'}
                  subtitle={tr549?'Müşteri iade talepleri ve onay süreci (SAP SD Return Order)':'Customer return requests and approval workflow'}
                  icon={RefreshCw}
                  actionButton={hasFullAccess('crm') ? (
                    <button onClick={()=>setP549Form(true)} className="apple-button-primary px-4 py-2 text-sm flex items-center gap-1.5">
                      <Plus className="w-3.5 h-3.5" />{tr549?'İade Talebi Oluştur':'New Return'}
                    </button>
                  ) : undefined}
                />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: tr549?'Bekleyen':'Pending',    v: pending549.length,  color:'text-orange-600', bg:'bg-orange-50' },
                    { label: tr549?'Onaylanan':'Approved',  v: approved549.length, color:'text-emerald-600',bg:'bg-emerald-50' },
                    { label: tr549?'Tamamlanan':'Done',     v: done549.length,     color:'text-blue-600',   bg:'bg-blue-50' },
                    { label: tr549?'Toplam':'Total',        v: p549Iadeler.length, color:'text-gray-600',   bg:'bg-gray-50' },
                  ].map(k=>(
                    <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{k.label}</p>
                      <p className={`text-2xl font-bold ${k.color}`}>{k.v}</p>
                    </div>
                  ))}
                </div>
                {/* New RMA form */}
                {p549Form && (
                  <div className="apple-card p-5 border-2 border-brand/20 space-y-3">
                    <h4 className="font-bold text-gray-800">{tr549?'Yeni İade Talebi':'New Return Request'}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input value={p549Draft.customerName} onChange={e=>setP549Draft(d=>({...d,customerName:e.target.value}))} placeholder={tr549?'Müşteri Adı':'Customer Name'} className="apple-input px-3 py-2 text-sm" />
                      <input value={p549Draft.orderId} onChange={e=>setP549Draft(d=>({...d,orderId:e.target.value}))} placeholder={tr549?'Sipariş ID (opsiyonel)':'Order ID (optional)'} className="apple-input px-3 py-2 text-sm" />
                      <input value={p549Draft.items} onChange={e=>setP549Draft(d=>({...d,items:e.target.value}))} placeholder={tr549?'İade Edilecek Ürünler':'Items to Return'} className="apple-input px-3 py-2 text-sm" />
                      <select value={p549Draft.reason} onChange={e=>setP549Draft(d=>({...d,reason:e.target.value}))} className="apple-input px-3 py-2 text-sm">
                        {reasons549.map(r=><option key={r}>{r}</option>)}
                      </select>
                      <select value={p549Draft.condition} onChange={e=>setP549Draft(d=>({...d,condition:e.target.value as typeof p549Draft.condition}))} className="apple-input px-3 py-2 text-sm">
                        {(['Hasarlı','Sağlam','Kısmen Hasarlı'] as const).map(c=><option key={c}>{c}</option>)}
                      </select>
                      <input value={p549Draft.notes} onChange={e=>setP549Draft(d=>({...d,notes:e.target.value}))} placeholder={tr549?'Notlar':'Notes'} className="apple-input px-3 py-2 text-sm" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async()=>{
                        if(!p549Draft.customerName||!p549Draft.items) return;
                        await addDoc(collection(db,'rmaRequests'),{...p549Draft,decision:'Bekliyor',status:'Bekliyor',createdAt:serverTimestamp()});
                        setP549Form(false); setP549Draft({orderId:'',customerName:'',items:'',reason:tr549?'Hasarlı Ürün':'Damaged Product',condition:'Hasarlı',notes:''});
                      }} className="apple-button-primary px-4 py-2 text-sm">{tr549?'Talebi Oluştur':'Create Request'}</button>
                      <button onClick={()=>setP549Form(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr549?'İptal':'Cancel'}</button>
                    </div>
                  </div>
                )}
                {/* RMA list */}
                <div className="apple-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-100 bg-gray-50/60">
                        <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase">{tr549?'Müşteri':'Customer'}</th>
                        <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase hidden md:table-cell">{tr549?'Ürünler':'Items'}</th>
                        <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase hidden sm:table-cell">{tr549?'Neden':'Reason'}</th>
                        <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{tr549?'Karar':'Decision'}</th>
                        <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{tr549?'Durum':'Status'}</th>
                        {hasFullAccess('crm') && <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{tr549?'İşlem':'Action'}</th>}
                      </tr></thead>
                      <tbody>
                        {p549Iadeler.map(r=>(
                          <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-gray-800">{r.customerName}</p>
                              {r.orderId && <p className="text-xs text-gray-400">{tr549?'Sipariş:':'Order:'} {r.orderId.slice(0,8)}</p>}
                            </td>
                            <td className="px-4 py-2.5 text-gray-600 text-xs hidden md:table-cell">{r.items}</td>
                            <td className="px-4 py-2.5 text-gray-500 text-xs hidden sm:table-cell">{r.reason}</td>
                            <td className="px-4 py-2.5 text-center">
                              {r.status === 'Bekliyor' && hasFullAccess('crm') ? (
                                <select defaultValue={r.decision} onChange={e=>updateDoc(doc(db,'rmaRequests',r.id),{decision:e.target.value})}
                                  className="text-[10px] font-bold px-2 py-0.5 rounded-full border-0 bg-gray-100 text-gray-700">
                                  {[tr549?'Bekliyor':'Pending',tr549?'İade':'Refund',tr549?'Değişim':'Exchange',tr549?'Kredi Notu':'Credit Note'].map(d=><option key={d}>{d}</option>)}
                                </select>
                              ) : (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${decisionColor(r.decision)}`}>{r.decision}</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColor(r.status)}`}>{r.status}</span>
                            </td>
                            {hasFullAccess('crm') && (
                              <td className="px-4 py-2.5 text-center">
                                {r.status === 'Bekliyor' && (
                                  <div className="flex justify-center gap-1">
                                    <button onClick={()=>updateDoc(doc(db,'rmaRequests',r.id),{status:'Onaylandı'})} className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-1 rounded-full hover:bg-emerald-200">{tr549?'Onayla':'Approve'}</button>
                                    <button onClick={()=>updateDoc(doc(db,'rmaRequests',r.id),{status:'Reddedildi'})} className="text-[10px] bg-red-100 text-red-700 font-bold px-2 py-1 rounded-full hover:bg-red-200">{tr549?'Reddet':'Reject'}</button>
                                  </div>
                                )}
                                {r.status === 'Onaylandı' && (
                                  <button onClick={()=>updateDoc(doc(db,'rmaRequests',r.id),{status:'Tamamlandı'})} className="text-[10px] bg-blue-100 text-blue-700 font-bold px-2 py-1 rounded-full hover:bg-blue-200">{tr549?'Tamamla':'Complete'}</button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {p549Iadeler.length===0 && (
                    <div className="text-center py-12 space-y-2">
                      <RefreshCw className="w-10 h-10 text-gray-200 mx-auto" />
                      <p className="text-gray-400 text-sm">{tr549?'Henüz iade talebi yok.':'No return requests yet.'}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })()}

    </>
  );
}
