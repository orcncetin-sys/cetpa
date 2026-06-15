/**
 * PerformansModule — İK Performans Değerlendirme
 * Gap vs competitors: Zoho People, Odoo HR, SAP B1 HR (partially)
 *
 * Features:
 *  - Review cycles (annual, semi-annual, quarterly)
 *  - OKR / KPI definition per employee with weight
 *  - Manager + self assessment with 1-5 rating
 *  - Competency scoring (Teknik, İletişim, Liderlik, Problem Çözme)
 *  - Overall score calculation (weighted average)
 *  - Status workflow: Taslak → Çalışan Değerlendirdi → Yönetici Tamamladı → Kapatıldı
 *  - Team summary dashboard
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Star, Plus, X,
  CheckCircle2, ChevronDown
} from 'lucide-react';
import {
  collection, addDoc, updateDoc, doc,
  onSnapshot, serverTimestamp
} from '../lib/dbClient';
import { db } from '../firebase';
import { sortByCreatedAt } from '../utils/fsSort';
import ModuleHeader from './ModuleHeader';

// ─── Types ─────────────────────────────────────────────────────────────────

type ReviewStatus = 'Taslak' | 'Çalışan Değerlendirdi' | 'Yönetici Tamamladı' | 'Kapatıldı';
type ReviewPeriod = 'Yıllık' | 'Yarıyıllık' | 'Çeyreklik';

interface OKR {
  title: string;
  weight: number;    // 0-100
  selfScore: number; // 1-5
  managerScore: number;
}

interface Competency {
  name: string;
  selfScore: number;
  managerScore: number;
}

interface PerformanceReview {
  id: string;
  employeeName: string;
  employeeRole: string;
  managerName: string;
  period: ReviewPeriod;
  year: number;
  status: ReviewStatus;
  okrs: OKR[];
  competencies: Competency[];
  selfNotes: string;
  managerNotes: string;
  developmentPlan: string;
  overallSelfScore: number;
  overallManagerScore: number;
  createdAt?: unknown;
}

interface Props {
  currentLanguage: string;
  isAuthenticated: boolean;
  employees?: Array<{ id: string; name: string; position?: string; department?: string }>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_COMPETENCIES = [
  'Teknik Yetkinlik',
  'İletişim',
  'Takım Çalışması',
  'Problem Çözme',
  'Liderlik & Girişim',
  'Zaman Yönetimi',
];

const STATUS_CONFIG: Record<ReviewStatus, { label: string; labelEn: string; color: string }> = {
  'Taslak':                   { label: 'Taslak',                  labelEn: 'Draft',             color: 'bg-gray-100 text-gray-600' },
  'Çalışan Değerlendirdi':   { label: 'Çalışan Değerlendirdi',  labelEn: 'Self-Assessed',      color: 'bg-blue-100 text-blue-700' },
  'Yönetici Tamamladı':      { label: 'Yönetici Tamamladı',      labelEn: 'Manager Reviewed',  color: 'bg-amber-100 text-amber-700' },
  'Kapatıldı':               { label: 'Kapatıldı',               labelEn: 'Closed',            color: 'bg-green-100 text-green-700' },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function StarRating({ value, onChange, size = 'sm' }: { value: number; onChange?: (v: number) => void; size?: 'sm' | 'lg' }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <button key={s} type="button"
          onClick={() => onChange?.(s)}
          className={`${size === 'lg' ? 'w-6 h-6' : 'w-4 h-4'} transition-colors ${onChange ? 'cursor-pointer' : 'cursor-default'}`}>
          <Star className={`w-full h-full ${s <= value ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'}`} />
        </button>
      ))}
    </div>
  );
}

function weightedAvgScore(okrs: OKR[], field: 'selfScore' | 'managerScore'): number {
  const totalWeight = okrs.reduce((s, o) => s + o.weight, 0);
  if (!totalWeight) return 0;
  const weighted = okrs.reduce((s, o) => s + o[field] * o.weight, 0);
  return Math.round((weighted / totalWeight) * 10) / 10;
}

function competencyAvg(comps: Competency[], field: 'selfScore' | 'managerScore'): number {
  if (!comps.length) return 0;
  return Math.round((comps.reduce((s, c) => s + c[field], 0) / comps.length) * 10) / 10;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function PerformansModule({ currentLanguage, isAuthenticated, employees = [] }: Props) {
  const tr = currentLanguage === 'tr';

  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<ReviewStatus | 'all'>('all');

  const emptyOKR: OKR = { title: '', weight: 25, selfScore: 3, managerScore: 3 };
  const emptyReview: Omit<PerformanceReview, 'id' | 'createdAt'> = {
    employeeName: '', employeeRole: '', managerName: '',
    period: 'Yıllık', year: new Date().getFullYear(), status: 'Taslak',
    okrs: [{ ...emptyOKR, title: tr ? 'Satış Hedefi' : 'Sales Target' }],
    competencies: DEFAULT_COMPETENCIES.map(n => ({ name: n, selfScore: 3, managerScore: 3 })),
    selfNotes: '', managerNotes: '', developmentPlan: '',
    overallSelfScore: 3, overallManagerScore: 3,
  };
  const [draft, setDraft] = useState<Omit<PerformanceReview, 'id' | 'createdAt'>>(emptyReview);

  // ── Firestore listener ────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'performanceReviews'), snap => {
      const data = sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as PerformanceReview)));
      setReviews(data);
    });
    return () => unsub();
  }, []);

  // ── Derived ─────────────────────────────────────────────────────────────
  const closed = reviews.filter(r => r.status === 'Kapatıldı');
  const pending = reviews.filter(r => r.status !== 'Kapatıldı');
  const avgScore = closed.length
    ? Math.round((closed.reduce((s, r) => s + r.overallManagerScore, 0) / closed.length) * 10) / 10
    : 0;

  const filtered = filterStatus === 'all' ? reviews : reviews.filter(r => r.status === filterStatus);
  const selected = reviews.find(r => r.id === selectedId) ?? null;

  // ── Save ──────────────────────────────────────────────────────────────────
  const saveReview = async () => {
    if (!draft.employeeName.trim()) return;
    const payload = {
      ...draft,
      overallSelfScore: Math.round(((weightedAvgScore(draft.okrs, 'selfScore') + competencyAvg(draft.competencies, 'selfScore')) / 2) * 10) / 10,
      overallManagerScore: Math.round(((weightedAvgScore(draft.okrs, 'managerScore') + competencyAvg(draft.competencies, 'managerScore')) / 2) * 10) / 10,
    };
    await addDoc(collection(db, 'performanceReviews'), { ...payload, createdAt: serverTimestamp() });
    setShowForm(false);
    setDraft(emptyReview);
  };

  const advanceStatus = async (review: PerformanceReview) => {
    const order: ReviewStatus[] = ['Taslak', 'Çalışan Değerlendirdi', 'Yönetici Tamamladı', 'Kapatıldı'];
    const idx = order.indexOf(review.status);
    if (idx < order.length - 1) {
      await updateDoc(doc(db, 'performanceReviews', review.id), { status: order[idx + 1] });
    }
  };

  const scoreColor = (s: number) => s >= 4.5 ? 'text-green-600' : s >= 3.5 ? 'text-blue-600' : s >= 2.5 ? 'text-amber-600' : 'text-red-500';

  return (
    <div className="space-y-4">
      <ModuleHeader
        title={tr ? 'Performans Değerlendirme' : 'Performance Reviews'}
        subtitle={tr ? 'OKR bazlı çalışan değerlendirmesi, yetkinlik skorlama ve gelişim planları' : 'OKR-based reviews, competency scoring, development plans'}
        icon={Star}
        actionButton={isAuthenticated ? (
          <button onClick={() => { setShowForm(true); setDraft(emptyReview); }}
            className="apple-button-primary px-4 py-2 text-sm flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />{tr ? 'Değerlendirme Başlat' : 'Start Review'}
          </button>
        ) : undefined}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: tr ? 'Toplam Değerlendirme' : 'Total Reviews', v: reviews.length, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: tr ? 'Bekleyen' : 'Pending', v: pending.length, color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: tr ? 'Tamamlanan' : 'Completed', v: closed.length, color: 'text-green-600', bg: 'bg-green-50' },
          { label: tr ? 'Ort. Puan' : 'Avg Score', v: avgScore ? `${avgScore}/5` : '—', color: avgScore >= 4 ? 'text-green-600' : 'text-amber-600', bg: avgScore >= 4 ? 'bg-green-50' : 'bg-amber-50' },
        ].map(k => (
          <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.v}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {(['all', 'Taslak', 'Çalışan Değerlendirdi', 'Yönetici Tamamladı', 'Kapatıldı'] as const).map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap
              ${filterStatus === s ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {s === 'all' ? (tr ? 'Tümü' : 'All') : (tr ? STATUS_CONFIG[s].label : STATUS_CONFIG[s].labelEn)}
          </button>
        ))}
      </div>

      {/* New review form */}
      <AnimatePresence>
        {showForm && (
          <motion.div key="form" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="apple-card p-5 border-2 border-brand/20 space-y-5">
            <div className="flex justify-between items-center">
              <h4 className="font-bold text-gray-800">{tr ? 'Yeni Performans Değerlendirmesi' : 'New Performance Review'}</h4>
              <button onClick={() => setShowForm(false)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>

            {/* Basic info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select value={draft.employeeName} onChange={e => setDraft(d => ({ ...d, employeeName: e.target.value }))}
                className="apple-input px-3 py-2 text-sm">
                <option value="">{tr ? '-- Çalışan Seç --' : '-- Select Employee --'}</option>
                {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                <option value="__custom">{tr ? 'Manuel gir...' : 'Type manually...'}</option>
              </select>
              {(draft.employeeName === '__custom' || !employees.find(e => e.name === draft.employeeName)) && (
                <input value={draft.employeeName === '__custom' ? '' : draft.employeeName}
                  onChange={e => setDraft(d => ({ ...d, employeeName: e.target.value }))}
                  placeholder={tr ? 'Çalışan adı' : 'Employee name'} className="apple-input px-3 py-2 text-sm" />
              )}
              <input value={draft.employeeRole} onChange={e => setDraft(d => ({ ...d, employeeRole: e.target.value }))}
                placeholder={tr ? 'Pozisyon / Rol' : 'Position / Role'} className="apple-input px-3 py-2 text-sm" />
              <input value={draft.managerName} onChange={e => setDraft(d => ({ ...d, managerName: e.target.value }))}
                placeholder={tr ? 'Değerlendiren Yönetici' : 'Reviewing Manager'} className="apple-input px-3 py-2 text-sm" />
              <select value={draft.period} onChange={e => setDraft(d => ({ ...d, period: e.target.value as ReviewPeriod }))}
                className="apple-input px-3 py-2 text-sm">
                {(['Yıllık', 'Yarıyıllık', 'Çeyreklik'] as const).map(p => <option key={p}>{p}</option>)}
              </select>
              <input type="number" value={draft.year} onChange={e => setDraft(d => ({ ...d, year: parseInt(e.target.value) || new Date().getFullYear() }))}
                className="apple-input px-3 py-2 text-sm" min={2020} max={2030} />
            </div>

            {/* OKRs */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <p className="text-sm font-bold text-gray-700">OKR / {tr ? 'Hedefler' : 'Objectives'}</p>
                <button onClick={() => setDraft(d => ({ ...d, okrs: [...d.okrs, { ...emptyOKR }] }))}
                  className="text-xs text-brand font-semibold flex items-center gap-1">
                  <Plus className="w-3 h-3" />{tr ? 'OKR Ekle' : 'Add OKR'}
                </button>
              </div>
              <div className="space-y-2">
                {draft.okrs.map((okr, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded-xl p-2">
                    <input value={okr.title} onChange={e => setDraft(d => ({ ...d, okrs: d.okrs.map((o, j) => j === i ? { ...o, title: e.target.value } : o) }))}
                      placeholder={tr ? 'Hedef açıklaması' : 'Objective'} className="col-span-5 apple-input px-2 py-1.5 text-xs" />
                    <div className="col-span-2 flex items-center gap-1">
                      <span className="text-xs text-gray-500">%</span>
                      <input type="number" value={okr.weight} min={0} max={100}
                        onChange={e => setDraft(d => ({ ...d, okrs: d.okrs.map((o, j) => j === i ? { ...o, weight: parseInt(e.target.value) || 0 } : o) }))}
                        className="apple-input px-2 py-1.5 text-xs w-14" />
                    </div>
                    <div className="col-span-2">
                      <p className="text-[10px] text-gray-400 mb-0.5">{tr ? 'Çalışan' : 'Self'}</p>
                      <StarRating value={okr.selfScore} onChange={v => setDraft(d => ({ ...d, okrs: d.okrs.map((o, j) => j === i ? { ...o, selfScore: v } : o) }))} />
                    </div>
                    <div className="col-span-2">
                      <p className="text-[10px] text-gray-400 mb-0.5">{tr ? 'Yönetici' : 'Mgr'}</p>
                      <StarRating value={okr.managerScore} onChange={v => setDraft(d => ({ ...d, okrs: d.okrs.map((o, j) => j === i ? { ...o, managerScore: v } : o) }))} />
                    </div>
                    {draft.okrs.length > 1 && (
                      <button className="col-span-1" onClick={() => setDraft(d => ({ ...d, okrs: d.okrs.filter((_, j) => j !== i) }))}>
                        <X className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {tr ? 'Toplam ağırlık:' : 'Total weight:'} {draft.okrs.reduce((s, o) => s + o.weight, 0)}%
                {draft.okrs.reduce((s, o) => s + o.weight, 0) !== 100 && <span className="text-amber-500 ml-1">(100% olmalı)</span>}
              </p>
            </div>

            {/* Competencies */}
            <div>
              <p className="text-sm font-bold text-gray-700 mb-2">{tr ? 'Yetkinlik Değerlendirmesi' : 'Competency Assessment'}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {draft.competencies.map((comp, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-2.5 flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700 font-medium min-w-0 flex-1">{comp.name}</span>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div>
                        <p className="text-[10px] text-gray-400">{tr ? 'Çalışan' : 'Self'}</p>
                        <StarRating value={comp.selfScore} onChange={v => setDraft(d => ({ ...d, competencies: d.competencies.map((c, j) => j === i ? { ...c, selfScore: v } : c) }))} />
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400">{tr ? 'Yönetici' : 'Mgr'}</p>
                        <StarRating value={comp.managerScore} onChange={v => setDraft(d => ({ ...d, competencies: d.competencies.map((c, j) => j === i ? { ...c, managerScore: v } : c) }))} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <textarea value={draft.selfNotes} onChange={e => setDraft(d => ({ ...d, selfNotes: e.target.value }))}
                placeholder={tr ? 'Çalışanın kendi değerlendirme notu...' : 'Employee self-assessment notes...'}
                className="apple-input px-3 py-2 text-sm resize-none" rows={3} />
              <textarea value={draft.managerNotes} onChange={e => setDraft(d => ({ ...d, managerNotes: e.target.value }))}
                placeholder={tr ? 'Yönetici değerlendirme notu...' : "Manager's review notes..."}
                className="apple-input px-3 py-2 text-sm resize-none" rows={3} />
              <textarea value={draft.developmentPlan} onChange={e => setDraft(d => ({ ...d, developmentPlan: e.target.value }))}
                placeholder={tr ? 'Gelişim planı ve eğitim önerileri...' : 'Development plan and training recommendations...'}
                className="apple-input px-3 py-2 text-sm resize-none md:col-span-2" rows={2} />
            </div>

            <div className="flex gap-2">
              <button onClick={saveReview} className="apple-button-primary px-4 py-2 text-sm">{tr ? 'Değerlendirmeyi Kaydet' : 'Save Review'}</button>
              <button onClick={() => setShowForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr ? 'İptal' : 'Cancel'}</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Review list */}
      <div className="space-y-3">
        {filtered.map(r => {
          const sc = STATUS_CONFIG[r.status];
          const isExpanded = selectedId === r.id;
          return (
            <motion.div key={r.id} layout className="apple-card overflow-hidden">
              <div className="p-4 flex items-center justify-between cursor-pointer"
                onClick={() => setSelectedId(isExpanded ? null : r.id)}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center flex-shrink-0">
                    <Star className="w-4 h-4 text-brand" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 text-sm">{r.employeeName}</p>
                    <p className="text-xs text-gray-500">{r.employeeRole} • {r.period} {r.year} • {tr ? 'Yönetici:' : 'Mgr:'} {r.managerName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {r.overallManagerScore > 0 && (
                    <div className="flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      <span className={`text-sm font-bold ${scoreColor(r.overallManagerScore)}`}>{r.overallManagerScore}</span>
                    </div>
                  )}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sc.color}`}>
                    {tr ? sc.label : sc.labelEn}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>
              </div>

              {/* Expanded detail */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div key="detail" initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                    className="overflow-hidden border-t border-gray-100">
                    <div className="p-4 space-y-4">
                      {/* OKR table */}
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase mb-2">OKR</p>
                        <div className="space-y-1.5">
                          {r.okrs.map((okr, i) => (
                            <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                              <span className="text-sm text-gray-700 flex-1 min-w-0 mr-2">{okr.title}</span>
                              <span className="text-xs text-gray-400 mx-2">%{okr.weight}</span>
                              <div className="flex items-center gap-3">
                                <StarRating value={okr.selfScore} />
                                <StarRating value={okr.managerScore} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Competencies */}
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase mb-2">{tr ? 'Yetkinlikler' : 'Competencies'}</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {r.competencies.map((c, i) => (
                            <div key={i} className="bg-gray-50 rounded-lg p-2">
                              <p className="text-xs text-gray-600 font-medium mb-1">{c.name}</p>
                              <div className="flex items-center gap-2">
                                <StarRating value={c.selfScore} />
                                <span className="text-gray-300">|</span>
                                <StarRating value={c.managerScore} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Notes */}
                      {(r.selfNotes || r.managerNotes || r.developmentPlan) && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {r.selfNotes && (
                            <div className="bg-blue-50 rounded-xl p-3">
                              <p className="text-xs font-bold text-blue-400 uppercase mb-1">{tr ? 'Çalışan Notu' : 'Self Note'}</p>
                              <p className="text-sm text-blue-900">{r.selfNotes}</p>
                            </div>
                          )}
                          {r.managerNotes && (
                            <div className="bg-amber-50 rounded-xl p-3">
                              <p className="text-xs font-bold text-amber-400 uppercase mb-1">{tr ? 'Yönetici Notu' : 'Manager Note'}</p>
                              <p className="text-sm text-amber-900">{r.managerNotes}</p>
                            </div>
                          )}
                          {r.developmentPlan && (
                            <div className="bg-green-50 rounded-xl p-3">
                              <p className="text-xs font-bold text-green-400 uppercase mb-1">{tr ? 'Gelişim Planı' : 'Dev Plan'}</p>
                              <p className="text-sm text-green-900">{r.developmentPlan}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Advance status button */}
                      {isAuthenticated && r.status !== 'Kapatıldı' && (
                        <button onClick={() => advanceStatus(r)}
                          className="apple-button-primary px-4 py-2 text-sm flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4" />
                          {r.status === 'Taslak' ? (tr ? 'Çalışan Değerlendirmesini Onayla' : 'Mark Self-Assessed')
                            : r.status === 'Çalışan Değerlendirdi' ? (tr ? 'Yönetici Değerlendirmesini Tamamla' : 'Complete Manager Review')
                            : (tr ? 'Kapat' : 'Close')}
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Empty state */}
      {reviews.length === 0 && !showForm && (
        <div className="apple-card p-12 text-center space-y-3">
          <Star className="w-12 h-12 text-gray-200 mx-auto" />
          <p className="font-semibold text-gray-500">{tr ? 'Henüz değerlendirme yok' : 'No reviews yet'}</p>
          <p className="text-sm text-gray-400 max-w-sm mx-auto">
            {tr ? 'OKR bazlı değerlendirmeler başlatın, yetkinlik skorlayın ve çalışan gelişim planları oluşturun.' : 'Start OKR-based reviews, score competencies, and create employee development plans.'}
          </p>
          {isAuthenticated && (
            <button onClick={() => setShowForm(true)} className="apple-button-primary px-5 py-2 text-sm mx-auto flex items-center gap-2">
              <Plus className="w-4 h-4" />{tr ? 'İlk Değerlendirmeyi Başlat' : 'Start First Review'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
