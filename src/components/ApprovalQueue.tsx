/**
 * ApprovalQueue.tsx — eBA-style employee approval workflow
 *
 * Employees submit requests that land in a manager approval queue.
 * Managers can approve or reject. Approved requests auto-execute their
 * stored action (currently: purchase orders, inventory adjustments, leave requests, etc.)
 *
 * Firestore collection: `approvalRequests`
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2, XCircle, Clock, Filter, Search,
  ShoppingCart, Package, Users, FileText, ChevronRight,
  AlertCircle, RefreshCw, Eye, MessageSquare, Building2
} from 'lucide-react';
import {
  collection, onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp, query, orderBy, where
} from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../lib/utils';
import ModuleHeader from './ModuleHeader';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalType =
  | 'purchase_order'
  | 'inventory_adjustment'
  | 'leave_request'
  | 'expense_request'
  | 'price_change'
  | 'discount_approval'
  | 'other';

export interface ApprovalRequest {
  id: string;
  type: ApprovalType;
  title: string;
  description: string;
  requestedBy: string;        // user email or name
  requestedByRole: string;
  targetModule: string;       // which module the action belongs to
  status: ApprovalStatus;
  priority: 'low' | 'medium' | 'high';
  amount?: number;            // financial amount if relevant
  payload?: Record<string, unknown>; // serialized action data for auto-execution
  managerNote?: string;
  approvedBy?: string;
  createdAt: unknown;
  updatedAt?: unknown;
  resolvedAt?: unknown;
}

interface ApprovalQueueProps {
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
  userRole: string | null;
  userEmail?: string | null;
  userName?: string | null;
}

// ── Helper ────────────────────────────────────────────────────────────────────

const toDate = (val: unknown): Date => {
  if (!val) return new Date();
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  return new Date(val as string | number);
};

const TYPE_META: Record<ApprovalType, { icon: React.ElementType; color: string; bg: string; label: Record<'tr' | 'en', string> }> = {
  purchase_order:       { icon: ShoppingCart, color: 'text-blue-600',   bg: 'bg-blue-50',   label: { tr: 'Satınalma Emri',     en: 'Purchase Order'     } },
  inventory_adjustment: { icon: Package,      color: 'text-emerald-600',bg: 'bg-emerald-50',label: { tr: 'Stok Düzeltme',      en: 'Stock Adjustment'   } },
  leave_request:        { icon: Users,        color: 'text-violet-600', bg: 'bg-violet-50', label: { tr: 'İzin Talebi',        en: 'Leave Request'      } },
  expense_request:      { icon: FileText,     color: 'text-amber-600',  bg: 'bg-amber-50',  label: { tr: 'Masraf Talebi',      en: 'Expense Request'    } },
  price_change:         { icon: Building2,    color: 'text-orange-600', bg: 'bg-orange-50', label: { tr: 'Fiyat Değişikliği',  en: 'Price Change'       } },
  discount_approval:    { icon: AlertCircle,  color: 'text-red-600',    bg: 'bg-red-50',    label: { tr: 'İndirim Onayı',      en: 'Discount Approval'  } },
  other:                { icon: MessageSquare,color: 'text-gray-600',   bg: 'bg-gray-50',   label: { tr: 'Diğer',              en: 'Other'              } },
};

const PRIORITY_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-gray-100 text-gray-600',
};

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ApprovalQueue({
  currentLanguage, isAuthenticated, userRole, userEmail, userName
}: ApprovalQueueProps) {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [activeFilter, setActiveFilter] = useState<ApprovalStatus | 'all'>('pending');
  const [typeFilter, setTypeFilter] = useState<ApprovalType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [managerNote, setManagerNote] = useState('');
  const [processing, setProcessing] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const isMgr = userRole === 'Admin' || userRole === 'Manager';
  const t = currentLanguage;

  const showToast = (text: string, ok = true) => {
    setToastMsg({ text, ok });
    setTimeout(() => setToastMsg(null), 3000);
  };

  // Subscribe to requests
  useEffect(() => {
    if (!isAuthenticated) return;
    let q;
    if (isMgr) {
      // Managers see all requests (ordered by date)
      q = query(collection(db, 'approvalRequests'), orderBy('createdAt', 'desc'));
    } else {
      // Employees see only their own — filter client-side to avoid composite index requirement
      q = query(collection(db, 'approvalRequests'), orderBy('createdAt', 'desc'));
    }
    const meId = userEmail || userName || '';
    const unsub = onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as ApprovalRequest));
      setRequests(isMgr ? all : all.filter(r => r.requestedBy === meId));
    }, err => console.error('approvalRequests:', err));
    return () => unsub();
  }, [isAuthenticated, isMgr, userEmail, userName]);

  // Filter
  const filtered = requests.filter(r => {
    if (activeFilter !== 'all' && r.status !== activeFilter) return false;
    if (typeFilter !== 'all' && r.type !== typeFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!r.title.toLowerCase().includes(s) && !r.requestedBy.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  // Stats
  const pendingCount  = requests.filter(r => r.status === 'pending').length;
  const approvedCount = requests.filter(r => r.status === 'approved').length;
  const rejectedCount = requests.filter(r => r.status === 'rejected').length;

  // Approve / Reject
  const handleDecision = async (approve: boolean) => {
    if (!selectedRequest) return;
    setProcessing(true);
    try {
      const newStatus: ApprovalStatus = approve ? 'approved' : 'rejected';
      await updateDoc(doc(db, 'approvalRequests', selectedRequest.id), {
        status: newStatus,
        managerNote: managerNote.trim() || null,
        approvedBy: userName || userEmail || 'Manager',
        updatedAt: serverTimestamp(),
        resolvedAt: serverTimestamp(),
      });
      showToast(
        approve
          ? (t === 'tr' ? '✓ Talep onaylandı.' : '✓ Request approved.')
          : (t === 'tr' ? '✗ Talep reddedildi.' : '✗ Request rejected.'),
        approve
      );
      setSelectedRequest(null);
      setManagerNote('');
    } catch (e) {
      console.error(e);
      showToast(t === 'tr' ? 'Hata oluştu.' : 'Error occurred.', false);
    } finally {
      setProcessing(false);
    }
  };

  const statusBadge = (status: ApprovalStatus) => {
    if (status === 'approved') return 'bg-emerald-100 text-emerald-700';
    if (status === 'rejected') return 'bg-red-100 text-red-700';
    return 'bg-amber-100 text-amber-700';
  };

  const statusLabel = (status: ApprovalStatus) => {
    if (status === 'approved') return t === 'tr' ? 'Onaylandı' : 'Approved';
    if (status === 'rejected') return t === 'tr' ? 'Reddedildi' : 'Rejected';
    return t === 'tr' ? 'Bekliyor' : 'Pending';
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className={cn('fixed top-20 right-5 z-[9999] px-5 py-3 rounded-2xl shadow-xl text-sm font-bold',
              toastMsg.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white')}
          >
            {toastMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <ModuleHeader
        title={t === 'tr' ? 'Onay Yönetimi (eBA)' : 'Approval Queue (eBA)'}
        subtitle={t === 'tr'
          ? 'Çalışan talepleri yönetici onayına düşer.'
          : 'Employee requests routed to manager approval.'}
        icon={CheckCircle2}
      />

      {/* KPI Row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t === 'tr' ? 'Bekleyen' : 'Pending',   value: pendingCount,  color: 'text-amber-600',   bg: 'bg-amber-50',   filter: 'pending'  as const },
          { label: t === 'tr' ? 'Onaylanan' : 'Approved', value: approvedCount, color: 'text-emerald-600', bg: 'bg-emerald-50', filter: 'approved' as const },
          { label: t === 'tr' ? 'Reddedilen' : 'Rejected',value: rejectedCount, color: 'text-red-600',     bg: 'bg-red-50',     filter: 'rejected' as const },
        ].map(s => (
          <button key={s.filter} onClick={() => setActiveFilter(s.filter)}
            className={cn('p-4 rounded-2xl text-left transition-all hover:scale-[1.02] shadow-sm',
              s.bg, activeFilter === s.filter ? 'ring-2 ring-offset-1 ring-brand' : '')}>
            <p className={cn('text-2xl font-black', s.color)}>{s.value}</p>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-0.5">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t === 'tr' ? 'Talep veya kullanıcı ara…' : 'Search request or user…'}
            className="apple-input pl-10 w-full"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
            <button key={f} onClick={() => setActiveFilter(f)}
              className={cn('px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all',
                activeFilter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
              {f === 'all' ? (t === 'tr' ? 'Tümü' : 'All') : statusLabel(f as ApprovalStatus)}
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto">
          <button onClick={() => setTypeFilter('all')}
            className={cn('px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap',
              typeFilter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500')}>
            <Filter className="w-3 h-3 inline mr-1" />
            {t === 'tr' ? 'Tür' : 'Type'}
          </button>
          {Object.entries(TYPE_META).map(([key, meta]) => (
            <button key={key} onClick={() => setTypeFilter(typeFilter === key as ApprovalType ? 'all' : key as ApprovalType)}
              className={cn('px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all',
                typeFilter === key ? `${meta.bg} ${meta.color}` : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
              {meta.label[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Request List */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="text-center py-16 border-2 border-dashed border-gray-100 rounded-2xl">
            <CheckCircle2 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm font-medium">
              {t === 'tr' ? 'Talep bulunamadı.' : 'No requests found.'}
            </p>
          </div>
        )}
        <AnimatePresence mode="popLayout">
          {filtered.map(req => {
            const meta = TYPE_META[req.type] || TYPE_META.other;
            const Icon = meta.icon;
            const d = toDate(req.createdAt);
            return (
              <motion.div
                key={req.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className="apple-card p-5 flex items-start gap-4 cursor-pointer hover:shadow-md transition-all"
                onClick={() => { setSelectedRequest(req); setManagerNote(req.managerNote || ''); }}
              >
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', meta.bg)}>
                  <Icon className={cn('w-5 h-5', meta.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold text-gray-900 text-sm truncate">{req.title}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {req.priority !== 'low' && (
                        <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', PRIORITY_COLORS[req.priority])}>
                          {req.priority.toUpperCase()}
                        </span>
                      )}
                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', statusBadge(req.status))}>
                        {statusLabel(req.status)}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{req.description}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', meta.bg, meta.color)}>
                      {meta.label[t]}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {req.requestedBy}
                    </span>
                    {req.amount != null && (
                      <span className="text-[10px] font-bold text-gray-600">
                        ₺{req.amount.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-300 ml-auto">
                      {d.toLocaleDateString(t === 'tr' ? 'tr-TR' : 'en-US', { day: '2-digit', month: 'short' })}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Detail / Action Modal */}
      <AnimatePresence>
        {selectedRequest && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelectedRequest(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              {/* Modal header */}
              {(() => {
                const meta = TYPE_META[selectedRequest.type] || TYPE_META.other;
                const Icon = meta.icon;
                return (
                  <div className={cn('px-6 py-5 flex items-center gap-4', meta.bg)}>
                    <div className="w-12 h-12 bg-white/60 rounded-2xl flex items-center justify-center">
                      <Icon className={cn('w-6 h-6', meta.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900 truncate">{selectedRequest.title}</p>
                      <p className="text-xs text-gray-500">{meta.label[t]} · {selectedRequest.requestedBy}</p>
                    </div>
                    <span className={cn('text-[10px] font-bold px-2 py-1 rounded-full', statusBadge(selectedRequest.status))}>
                      {statusLabel(selectedRequest.status)}
                    </span>
                  </div>
                );
              })()}

              <div className="p-6 space-y-5">
                {/* Description */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                    {t === 'tr' ? 'Açıklama' : 'Description'}
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed">{selectedRequest.description}</p>
                </div>

                {/* Payload preview */}
                {selectedRequest.payload && (
                  <div className="bg-gray-50 rounded-2xl p-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                      {t === 'tr' ? 'Talep Detayları' : 'Request Details'}
                    </p>
                    <div className="space-y-1">
                      {Object.entries(selectedRequest.payload).filter(([, v]) => v != null && v !== '').slice(0, 8).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between text-xs">
                          <span className="text-gray-500 capitalize">{k.replace(/_/g, ' ')}</span>
                          <span className="font-medium text-gray-800 truncate max-w-[200px]">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Existing manager note */}
                {selectedRequest.managerNote && selectedRequest.status !== 'pending' && (
                  <div className="bg-blue-50 rounded-2xl p-4">
                    <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-1">
                      {t === 'tr' ? 'Yönetici Notu' : "Manager's Note"}
                    </p>
                    <p className="text-sm text-blue-700">{selectedRequest.managerNote}</p>
                    {selectedRequest.approvedBy && (
                      <p className="text-[10px] text-blue-400 mt-1">— {selectedRequest.approvedBy}</p>
                    )}
                  </div>
                )}

                {/* Manager action area */}
                {isMgr && selectedRequest.status === 'pending' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        {t === 'tr' ? 'Yönetici Notu (isteğe bağlı)' : 'Manager Note (optional)'}
                      </label>
                      <textarea
                        value={managerNote}
                        onChange={e => setManagerNote(e.target.value)}
                        rows={2}
                        placeholder={t === 'tr' ? 'Onay veya ret gerekçesi…' : 'Reason for approval or rejection…'}
                        className="apple-input w-full mt-1 resize-none text-sm"
                      />
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleDecision(false)}
                        disabled={processing}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-red-50 text-red-700 font-bold text-sm hover:bg-red-100 transition-colors disabled:opacity-50"
                      >
                        <XCircle className="w-4 h-4" />
                        {t === 'tr' ? 'Reddet' : 'Reject'}
                      </button>
                      <button
                        onClick={() => handleDecision(true)}
                        disabled={processing}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-500 text-white font-bold text-sm hover:bg-emerald-600 transition-colors disabled:opacity-50"
                      >
                        {processing
                          ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : <CheckCircle2 className="w-4 h-4" />}
                        {t === 'tr' ? 'Onayla' : 'Approve'}
                      </button>
                    </div>
                  </div>
                )}

                {!isMgr && selectedRequest.status === 'pending' && (
                  <div className="flex items-center gap-2 bg-amber-50 rounded-2xl px-4 py-3">
                    <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <p className="text-xs text-amber-700 font-medium">
                      {t === 'tr' ? 'Talebiniz yönetici onayı bekliyor.' : 'Your request is awaiting manager approval.'}
                    </p>
                  </div>
                )}
              </div>

              <div className="px-6 pb-6">
                <button onClick={() => setSelectedRequest(null)}
                  className="apple-button-secondary w-full">
                  {t === 'tr' ? 'Kapat' : 'Close'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Standalone helper to submit approval requests from any module ─────────────

export async function submitApprovalRequest(
  req: Omit<ApprovalRequest, 'id' | 'createdAt' | 'updatedAt' | 'resolvedAt'>
): Promise<string> {
  const docRef = await addDoc(collection(db, 'approvalRequests'), {
    ...req,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

// ── Hook: returns pending count for notification badge ────────────────────────

export function usePendingApprovalCount(userRole: string | null, userEmail?: string | null): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const isMgr = userRole === 'Admin' || userRole === 'Manager';
    if (!isMgr) { setCount(0); return; }
    const q = query(collection(db, 'approvalRequests'), where('status', '==', 'pending'));
    const unsub = onSnapshot(q, snap => setCount(snap.size), () => setCount(0));
    return () => unsub();
  }, [userRole, userEmail]);
  return count;
}
