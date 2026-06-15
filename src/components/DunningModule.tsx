/**
 * DunningModule — Otomatik Tahsilat Hatırlatıcı (Dunning / Escalation)
 *
 * Scope: Escalation automation (policy-driven reminders, activity log, DSO KPI)
 * For manual AR ledger & partial payments → use Muhasebe → Tahsilat (TahsilatModule)
 *
 * Firestore collections:
 *   dunningPolicies  — escalation rules per days-overdue threshold
 *   dunningInvoices  — overdue invoice tracking (imported from orders or manual entry)
 *
 * The two-collection design (dunningInvoices vs tahsilatKayitlari in TahsilatModule)
 * is intentional: dunning handles escalation workflow; tahsilat handles cash ledger.
 * A future migration may unify these into a single AR collection.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell, Plus, X, AlertTriangle, CheckCircle2,
  MessageSquare, Mail, Phone, Gavel, ChevronDown
} from 'lucide-react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp
} from '../lib/dbClient';
import { db } from '../firebase';
import { sortByCreatedAt } from '../utils/fsSort';
import ModuleHeader from './ModuleHeader';

// ─── Types ─────────────────────────────────────────────────────────────────

type DunningStatus = 'Açık' | 'İtiraz' | 'Hukuki' | 'Tahsil Edildi' | 'Silindi';
type ContactMethod = 'email' | 'whatsapp' | 'phone' | 'letter';

interface DunningLevel {
  daysOverdue: number;          // trigger when invoice is this many days overdue
  label: string;
  contactMethod: ContactMethod;
  messageTemplate: string;
}

interface DunningPolicy {
  id: string;
  name: string;
  levels: DunningLevel[];
  createdAt?: unknown;
}

interface OverdueInvoice {
  id: string;
  invoiceNo: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  amount: number;
  currency: string;
  dueDate: string;             // ISO date string
  issueDate: string;
  status: DunningStatus;
  lastContactDate?: string;
  lastContactMethod?: ContactMethod;
  policyId?: string;
  notes?: string;
  activityLog?: Array<{ date: string; action: string; user?: string }>;
  createdAt?: unknown;
}

interface Props {
  currentLanguage: string;
  isAuthenticated: boolean;
  /** Pass from orders to auto-populate overdue invoices */
  orders?: Array<{
    id: string;
    customerName: string;
    totalPrice?: number;
    hasInvoice?: boolean;
    invoiceDate?: string;
    dueDate?: string;
    paymentStatus?: string;
    createdAt?: unknown;
  }>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function daysOverdue(dueDateStr: string): number {
  const due = new Date(dueDateStr);
  const today = new Date();
  const diff = Math.floor((today.getTime() - due.getTime()) / 86400000);
  return Math.max(0, diff);
}

function ageBucket(days: number): string {
  if (days <= 0) return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

const DEFAULT_POLICY_LEVELS: DunningLevel[] = [
  { daysOverdue: 1,  label: 'İlk Hatırlatma',    contactMethod: 'email',     messageTemplate: 'Sayın {müşteri}, {fatura_no} numaralı {tutar} tutarlı faturanız {son_tarih} vadeli olup ödemesi beklenmektedir. İlginiz için teşekkürler.' },
  { daysOverdue: 7,  label: '2. Hatırlatma',      contactMethod: 'email',     messageTemplate: 'Sayın {müşteri}, {fatura_no} numaralı faturanız {gün} gün gecikmiştir. Lütfen ödemenizi gerçekleştirin.' },
  { daysOverdue: 14, label: 'Acil Uyarı',          contactMethod: 'whatsapp',  messageTemplate: 'Sayın {müşteri}, {tutar} tutarlı gecikmiş faturanız için acil ödeme talep ediyoruz. Yanıt vermezseniz hukuki süreç başlatılacaktır.' },
  { daysOverdue: 30, label: 'Son Uyarı / Hukuki', contactMethod: 'letter',    messageTemplate: 'Son ihtarname: {fatura_no} faturasına ait {tutar} alacağımız için yasal takip başlatılacaktır.' },
];

const contactIcon: Record<ContactMethod, React.ElementType> = {
  email: Mail, whatsapp: MessageSquare, phone: Phone, letter: Gavel,
};

const statusColor: Record<DunningStatus, string> = {
  'Açık':             'bg-orange-100 text-orange-700',
  'İtiraz':           'bg-yellow-100 text-yellow-700',
  'Hukuki':           'bg-red-100 text-red-700',
  'Tahsil Edildi':    'bg-green-100 text-green-700',
  'Silindi':          'bg-gray-100 text-gray-500',
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function DunningModule({ currentLanguage, isAuthenticated, orders = [] }: Props) {
  const tr = currentLanguage === 'tr';

  const [policies, setPolicies] = useState<DunningPolicy[]>([]);
  const [invoices, setInvoices] = useState<OverdueInvoice[]>([]);
  const [showAddInvoice, setShowAddInvoice] = useState(false);
  const [showPolicyEditor, setShowPolicyEditor] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<DunningStatus | 'all'>('all');
  const [filterBucket, setFilterBucket] = useState<string>('all');

  const emptyInvoice: Omit<OverdueInvoice, 'id' | 'createdAt'> = {
    invoiceNo: '', customerName: '', customerEmail: '', customerPhone: '',
    amount: 0, currency: 'TRY',
    dueDate: new Date().toISOString().slice(0, 10),
    issueDate: new Date().toISOString().slice(0, 10),
    status: 'Açık',
    activityLog: [],
  };
  const [invoiceDraft, setInvoiceDraft] = useState(emptyInvoice);

  const defaultPolicy: Omit<DunningPolicy, 'id' | 'createdAt'> = {
    name: tr ? 'Standart Tahsilat Politikası' : 'Standard Dunning Policy',
    levels: DEFAULT_POLICY_LEVELS,
  };
  const [policyDraft, setPolicyDraft] = useState(defaultPolicy);

  // ── Firestore ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'dunningPolicies'), snap => {
      setPolicies(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as DunningPolicy))));
    });
    const u2 = onSnapshot(collection(db, 'dunningInvoices'), snap => {
      const data = sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as OverdueInvoice)));
      setInvoices(data);
    });
    return () => { u1(); u2(); };
  }, []);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const open = invoices.filter(i => i.status === 'Açık');
  const totalOverdue = open.reduce((s, i) => s + i.amount, 0);
  const avgDaysOverdue = open.length ? Math.round(open.reduce((s, i) => s + daysOverdue(i.dueDate), 0) / open.length) : 0;
  const collected = invoices.filter(i => i.status === 'Tahsil Edildi').reduce((s, i) => s + i.amount, 0);

  const aging: Record<string, { count: number; amount: number }> = {};
  open.forEach(inv => {
    const b = ageBucket(daysOverdue(inv.dueDate));
    if (!aging[b]) aging[b] = { count: 0, amount: 0 };
    aging[b].count++;
    aging[b].amount += inv.amount;
  });

  const filtered = invoices.filter(i => {
    if (filterStatus !== 'all' && i.status !== filterStatus) return false;
    if (filterBucket !== 'all' && ageBucket(daysOverdue(i.dueDate)) !== filterBucket) return false;
    return true;
  });

  const fmtTRY = (v: number) => `₺${Math.round(v).toLocaleString('tr-TR')}`;

  // ── Save invoice ──────────────────────────────────────────────────────────
  const saveInvoice = async () => {
    if (!invoiceDraft.customerName.trim() || !invoiceDraft.amount) return;
    await addDoc(collection(db, 'dunningInvoices'), {
      ...invoiceDraft,
      activityLog: [{ date: new Date().toISOString(), action: tr ? 'Manuel eklendi' : 'Manually added' }],
      createdAt: serverTimestamp(),
    });
    setShowAddInvoice(false);
    setInvoiceDraft(emptyInvoice);
  };

  // ── Save policy ───────────────────────────────────────────────────────────
  const savePolicy = async () => {
    if (!policyDraft.name.trim()) return;
    await addDoc(collection(db, 'dunningPolicies'), { ...policyDraft, createdAt: serverTimestamp() });
    setShowPolicyEditor(false);
    setPolicyDraft(defaultPolicy);
  };

  // ── Log contact action ────────────────────────────────────────────────────
  const logContact = async (inv: OverdueInvoice, method: ContactMethod) => {
    const log = [...(inv.activityLog ?? []), {
      date: new Date().toISOString(),
      action: `${method === 'email' ? '📧' : method === 'whatsapp' ? '💬' : method === 'phone' ? '📞' : '📮'} ${tr ? 'İletişim kuruldu' : 'Contact made'} (${method})`,
    }];
    await updateDoc(doc(db, 'dunningInvoices', inv.id), {
      lastContactDate: new Date().toISOString().slice(0, 10),
      lastContactMethod: method,
      activityLog: log,
    });
  };

  const updateStatus = async (inv: OverdueInvoice, status: DunningStatus) => {
    const log = [...(inv.activityLog ?? []), {
      date: new Date().toISOString(),
      action: `${tr ? 'Durum değişti:' : 'Status changed:'} ${status}`,
    }];
    await updateDoc(doc(db, 'dunningInvoices', inv.id), { status, activityLog: log });
  };

  return (
    <div className="space-y-4">
      <ModuleHeader
        title={tr ? 'Otomatik Tahsilat Hatırlatıcı' : 'Dunning & Collections Automation'}
        subtitle={tr ? 'Gecikmiş fatura takibi, eskalasyon seviyeleri ve DSO yönetimi' : 'Overdue invoice tracking, escalation levels, and DSO management'}
        icon={Bell}
        actionButton={isAuthenticated ? (
          <div className="flex gap-2">
            <button onClick={() => setShowPolicyEditor(true)} className="apple-button-secondary px-3 py-2 text-xs">{tr ? 'Politika Ekle' : 'Add Policy'}</button>
            <button onClick={() => setShowAddInvoice(true)} className="apple-button-primary px-4 py-2 text-sm flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />{tr ? 'Fatura Ekle' : 'Add Invoice'}
            </button>
          </div>
        ) : undefined}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: tr ? 'Vadesi Geçmiş' : 'Overdue', v: fmtTRY(totalOverdue), sub: `${open.length} fatura`, color: 'text-red-600', bg: 'bg-red-50' },
          { label: tr ? 'Ort. Gecikme' : 'Avg Overdue', v: `${avgDaysOverdue}g`, sub: 'DSO proxy', color: avgDaysOverdue > 30 ? 'text-red-600' : 'text-orange-600', bg: 'bg-orange-50' },
          { label: tr ? 'Tahsil Edilen' : 'Collected', v: fmtTRY(collected), sub: `${invoices.filter(i => i.status === 'Tahsil Edildi').length} fatura`, color: 'text-green-600', bg: 'bg-green-50' },
          { label: tr ? 'Hukuki Takip' : 'Legal Track', v: invoices.filter(i => i.status === 'Hukuki').length, sub: '', color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map(k => (
          <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">{k.label}</p>
            <p className={`text-xl font-bold ${k.color}`}>{k.v}</p>
            <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Aging buckets */}
      {open.length > 0 && (
        <div className="apple-card p-4">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">{tr ? 'Alacak Yaşlandırma' : 'AR Aging Buckets'}</p>
          <div className="grid grid-cols-4 gap-3">
            {['1-30', '31-60', '61-90', '90+'].map(bucket => {
              const b = aging[bucket] ?? { count: 0, amount: 0 };
              const maxAmt = Math.max(...Object.values(aging).map(a => a.amount), 1);
              const pct = Math.round((b.amount / maxAmt) * 100);
              return (
                <div key={bucket} className="text-center cursor-pointer" onClick={() => setFilterBucket(filterBucket === bucket ? 'all' : bucket)}>
                  <div className={`text-xs font-bold mb-1 ${filterBucket === bucket ? 'text-brand' : 'text-gray-500'}`}>{bucket} {tr ? 'gün' : 'd'}</div>
                  <div className="h-12 bg-gray-100 rounded-lg relative overflow-hidden">
                    <div className={`absolute bottom-0 left-0 right-0 rounded-b-lg transition-all ${
                      bucket === '90+' ? 'bg-red-400' : bucket === '61-90' ? 'bg-orange-400' : bucket === '31-60' ? 'bg-amber-400' : 'bg-blue-400'
                    }`} style={{ height: `${pct}%` }} />
                  </div>
                  <p className="text-xs font-semibold text-gray-800 mt-1">{fmtTRY(b.amount)}</p>
                  <p className="text-[10px] text-gray-400">{b.count} fatura</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {(['all', 'Açık', 'İtiraz', 'Hukuki', 'Tahsil Edildi'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${filterStatus === s ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
              {s === 'all' ? (tr ? 'Tümü' : 'All') : s}
            </button>
          ))}
        </div>
        {filterBucket !== 'all' && (
          <button onClick={() => setFilterBucket('all')} className="apple-button-secondary px-3 py-1 text-xs flex items-center gap-1">
            <X className="w-3 h-3" /> {filterBucket}g
          </button>
        )}
      </div>

      {/* Policy editor */}
      <AnimatePresence>
        {showPolicyEditor && (
          <motion.div key="policyform" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="apple-card p-5 border-2 border-brand/20 space-y-4">
            <div className="flex justify-between">
              <h4 className="font-bold text-gray-800">{tr ? 'Tahsilat Politikası' : 'Dunning Policy'}</h4>
              <button onClick={() => setShowPolicyEditor(false)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <input value={policyDraft.name} onChange={e => setPolicyDraft(d => ({ ...d, name: e.target.value }))}
              placeholder={tr ? 'Politika adı' : 'Policy name'} className="apple-input px-3 py-2 text-sm w-full md:w-1/2" />
            <div className="space-y-3">
              {policyDraft.levels.map((level, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-start">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{tr ? 'Gün Gecikme' : 'Days Overdue'}</p>
                    <input type="number" value={level.daysOverdue}
                      onChange={e => setPolicyDraft(d => ({ ...d, levels: d.levels.map((l, j) => j === i ? { ...l, daysOverdue: parseInt(e.target.value) || 0 } : l) }))}
                      className="apple-input px-2 py-1.5 text-xs w-full" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{tr ? 'Etiket' : 'Label'}</p>
                    <input value={level.label}
                      onChange={e => setPolicyDraft(d => ({ ...d, levels: d.levels.map((l, j) => j === i ? { ...l, label: e.target.value } : l) }))}
                      className="apple-input px-2 py-1.5 text-xs w-full" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{tr ? 'Yöntem' : 'Method'}</p>
                    <select value={level.contactMethod}
                      onChange={e => setPolicyDraft(d => ({ ...d, levels: d.levels.map((l, j) => j === i ? { ...l, contactMethod: e.target.value as ContactMethod } : l) }))}
                      className="apple-input px-2 py-1.5 text-xs w-full">
                      <option value="email">Email</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="phone">{tr ? 'Telefon' : 'Phone'}</option>
                      <option value="letter">{tr ? 'Mektup' : 'Letter'}</option>
                    </select>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{tr ? 'Şablon' : 'Template'}</p>
                    <textarea value={level.messageTemplate}
                      onChange={e => setPolicyDraft(d => ({ ...d, levels: d.levels.map((l, j) => j === i ? { ...l, messageTemplate: e.target.value } : l) }))}
                      className="apple-input px-2 py-1.5 text-xs w-full resize-none" rows={2} />
                  </div>
                </div>
              ))}
              <button onClick={() => setPolicyDraft(d => ({ ...d, levels: [...d.levels, { daysOverdue: 0, label: '', contactMethod: 'email', messageTemplate: '' }] }))}
                className="text-xs text-brand font-semibold flex items-center gap-1">
                <Plus className="w-3 h-3" />{tr ? 'Seviye Ekle' : 'Add Level'}
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={savePolicy} className="apple-button-primary px-4 py-2 text-sm">{tr ? 'Politikayı Kaydet' : 'Save Policy'}</button>
              <button onClick={() => setShowPolicyEditor(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr ? 'İptal' : 'Cancel'}</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add invoice form */}
      <AnimatePresence>
        {showAddInvoice && (
          <motion.div key="invform" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="apple-card p-5 border-2 border-brand/20 space-y-3">
            <div className="flex justify-between">
              <h4 className="font-bold text-gray-800">{tr ? 'Gecikmiş Fatura Ekle' : 'Add Overdue Invoice'}</h4>
              <button onClick={() => setShowAddInvoice(false)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input value={invoiceDraft.invoiceNo} onChange={e => setInvoiceDraft(d => ({ ...d, invoiceNo: e.target.value }))}
                placeholder={tr ? 'Fatura No' : 'Invoice No'} className="apple-input px-3 py-2 text-sm" />
              <input value={invoiceDraft.customerName} onChange={e => setInvoiceDraft(d => ({ ...d, customerName: e.target.value }))}
                placeholder={tr ? 'Müşteri Adı' : 'Customer Name'} className="apple-input px-3 py-2 text-sm" />
              <input type="number" value={invoiceDraft.amount || ''} onChange={e => setInvoiceDraft(d => ({ ...d, amount: parseFloat(e.target.value) || 0 }))}
                placeholder={tr ? 'Tutar (₺)' : 'Amount (₺)'} className="apple-input px-3 py-2 text-sm" />
              <input value={invoiceDraft.customerEmail ?? ''} onChange={e => setInvoiceDraft(d => ({ ...d, customerEmail: e.target.value }))}
                placeholder="Email" className="apple-input px-3 py-2 text-sm" />
              <input value={invoiceDraft.customerPhone ?? ''} onChange={e => setInvoiceDraft(d => ({ ...d, customerPhone: e.target.value }))}
                placeholder={tr ? 'Telefon' : 'Phone'} className="apple-input px-3 py-2 text-sm" />
              <div className="space-y-1">
                <p className="text-xs text-gray-500">{tr ? 'Vade Tarihi' : 'Due Date'}</p>
                <input type="date" value={invoiceDraft.dueDate} onChange={e => setInvoiceDraft(d => ({ ...d, dueDate: e.target.value }))}
                  className="apple-input px-3 py-2 text-sm w-full" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveInvoice} className="apple-button-primary px-4 py-2 text-sm">{tr ? 'Ekle' : 'Add'}</button>
              <button onClick={() => setShowAddInvoice(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr ? 'İptal' : 'Cancel'}</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Invoice list */}
      <div className="space-y-2">
        {filtered.map(inv => {
          const days = daysOverdue(inv.dueDate);
          const isExpanded = selectedInvoiceId === inv.id;
          const policy = policies[0]; // use first policy for now
          const applicableLevel = policy?.levels
            .filter(l => days >= l.daysOverdue)
            .sort((a, b) => b.daysOverdue - a.daysOverdue)[0];

          return (
            <motion.div key={inv.id} layout className="apple-card overflow-hidden">
              <div className="p-4 flex items-center justify-between cursor-pointer"
                onClick={() => setSelectedInvoiceId(isExpanded ? null : inv.id)}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-10 rounded-full flex-shrink-0 ${
                    days > 60 ? 'bg-red-500' : days > 30 ? 'bg-orange-400' : days > 0 ? 'bg-amber-400' : 'bg-green-400'
                  }`} />
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 text-sm">{inv.customerName}</p>
                    <p className="text-xs text-gray-500">{inv.invoiceNo} • {tr ? 'Vade:' : 'Due:'} {new Date(inv.dueDate).toLocaleDateString('tr-TR')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {days > 0 && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      days > 60 ? 'bg-red-100 text-red-700' : days > 30 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'
                    }`}>{days}g {tr ? 'gecikmiş' : 'overdue'}</span>
                  )}
                  <p className="font-bold text-gray-900">{fmtTRY(inv.amount)}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColor[inv.status]}`}>{inv.status}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>
              </div>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div key="exp" initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                    className="overflow-hidden border-t border-gray-100">
                    <div className="p-4 space-y-4">
                      {/* Policy level alert */}
                      {applicableLevel && inv.status === 'Açık' && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold text-amber-800">{applicableLevel.label}</p>
                            <p className="text-xs text-amber-700 mt-0.5 line-clamp-2">{applicableLevel.messageTemplate}</p>
                          </div>
                        </div>
                      )}

                      {/* Contact actions */}
                      {isAuthenticated && inv.status === 'Açık' && (
                        <div className="flex flex-wrap gap-2">
                          {(['email', 'whatsapp', 'phone', 'letter'] as ContactMethod[]).map(method => {
                            const Icon = contactIcon[method];
                            return (
                              <button key={method} onClick={() => logContact(inv, method)}
                                className="apple-button-secondary px-3 py-1.5 text-xs flex items-center gap-1.5">
                                <Icon className="w-3.5 h-3.5" />
                                {method === 'email' ? 'Email' : method === 'whatsapp' ? 'WhatsApp' : method === 'phone' ? (tr ? 'Telefon' : 'Call') : (tr ? 'Mektup' : 'Letter')}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Status change */}
                      {isAuthenticated && (
                        <div className="flex flex-wrap gap-2">
                          {inv.status !== 'Tahsil Edildi' && (
                            <button onClick={() => updateStatus(inv, 'Tahsil Edildi')}
                              className="text-xs bg-green-100 text-green-700 font-bold px-3 py-1.5 rounded-full hover:bg-green-200 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />{tr ? 'Tahsil Edildi' : 'Mark Collected'}
                            </button>
                          )}
                          {inv.status === 'Açık' && (
                            <>
                              <button onClick={() => updateStatus(inv, 'İtiraz')}
                                className="text-xs bg-yellow-100 text-yellow-700 font-bold px-3 py-1.5 rounded-full hover:bg-yellow-200">{tr ? 'İtiraz Var' : 'Disputed'}</button>
                              <button onClick={() => updateStatus(inv, 'Hukuki')}
                                className="text-xs bg-red-100 text-red-700 font-bold px-3 py-1.5 rounded-full hover:bg-red-200 flex items-center gap-1">
                                <Gavel className="w-3 h-3" />{tr ? 'Hukuki Takip' : 'Legal Action'}
                              </button>
                            </>
                          )}
                        </div>
                      )}

                      {/* Activity log */}
                      {inv.activityLog && inv.activityLog.length > 0 && (
                        <div>
                          <p className="text-xs font-bold text-gray-400 uppercase mb-2">{tr ? 'Aktivite Günlüğü' : 'Activity Log'}</p>
                          <div className="space-y-1">
                            {[...inv.activityLog].reverse().slice(0, 5).map((log, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                                <span className="text-gray-300">{new Date(log.date).toLocaleDateString('tr-TR')}</span>
                                <span>{log.action}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {invoices.length === 0 && !showAddInvoice && (
        <div className="apple-card p-12 text-center space-y-3">
          <Bell className="w-12 h-12 text-gray-200 mx-auto" />
          <p className="font-semibold text-gray-500">{tr ? 'Gecikmiş fatura kaydı yok' : 'No overdue invoices'}</p>
          <p className="text-sm text-gray-400 max-w-sm mx-auto">
            {tr ? 'Vadesi geçmiş faturaları takip edin, eskalasyon politikaları belirleyin ve DSO sürenizi yönetin.'
              : 'Track overdue invoices, define escalation policies, and manage your DSO.'}
          </p>
          {isAuthenticated && (
            <button onClick={() => setShowAddInvoice(true)} className="apple-button-primary px-5 py-2 text-sm mx-auto flex items-center gap-2">
              <Plus className="w-4 h-4" />{tr ? 'Fatura Ekle' : 'Add Invoice'}
            </button>
          )}
        </div>
      )}

      {/* Policies list */}
      {policies.length > 0 && (
        <div className="apple-card p-4 space-y-2">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{tr ? 'Tahsilat Politikaları' : 'Dunning Policies'}</p>
          {policies.map(p => (
            <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <div>
                <p className="text-sm font-semibold text-gray-800">{p.name}</p>
                <p className="text-xs text-gray-400">{p.levels.length} {tr ? 'eskalasyon seviyesi' : 'escalation levels'}</p>
              </div>
              <button onClick={() => deleteDoc(doc(db, 'dunningPolicies', p.id))}
                className="p-1 hover:bg-red-50 rounded-lg"><X className="w-3.5 h-3.5 text-red-400" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
