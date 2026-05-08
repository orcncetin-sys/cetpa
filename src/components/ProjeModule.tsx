import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  FolderKanban, ListTodo, Clock, BarChart2,
  Plus, Pencil, Trash2, Save, X, ChevronDown,
  AlertTriangle, CheckCircle2, CircleDashed, Ban,
  TrendingUp, Users, Calendar, DollarSign, Briefcase,
} from 'lucide-react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { db } from '../firebase';

// ─── Types ───────────────────────────────────────────────────────────────────

type ProjeDurum = 'Planlama' | 'Aktif' | 'Beklemede' | 'Tamamlandı' | 'İptal';
type GorevDurum = 'Bekliyor' | 'Devam Ediyor' | 'Tamamlandı' | 'İptal';
type GorevOncelik = 'Düşük' | 'Normal' | 'Yüksek' | 'Acil';

interface Proje {
  id?: string;
  projeNo: string;
  projeAdi: string;
  musteriAdi: string;
  projeMuduru: string;
  baslangicTarihi: string;
  bitisTarihi: string;
  butce: number;
  harcananTutar: number;
  tamamlanmaYuzdesi: number;
  durum: ProjeDurum;
  aciklama: string;
  createdAt?: unknown;
}

interface Gorev {
  id?: string;
  gorevNo: string;
  projeId: string;
  projeAdi: string;
  gorevBasligi: string;
  atananKisi: string;
  baslangicTarihi: string;
  bitisTarihi: string;
  oncelik: GorevOncelik;
  durum: GorevDurum;
  tamamlanmaYuzdesi: number;
  createdAt?: unknown;
}

interface ZamanKaydi {
  id?: string;
  kayitTarihi: string;
  projeId: string;
  projeAdi: string;
  gorev: string;
  calisanAdi: string;
  harcananSaat: number;
  aciklama: string;
  faturalandirabilir: boolean;
  saatUcreti: number;
  createdAt?: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().split('T')[0];

function nextProjeNo(existing: Proje[]): string {
  const year = new Date().getFullYear();
  const max = existing.reduce((acc, p) => {
    const m = p.projeNo?.match(/PRJ-\d{4}-(\d{4})/);
    return m ? Math.max(acc, parseInt(m[1], 10)) : acc;
  }, 0);
  return `PRJ-${year}-${String(max + 1).padStart(4, '0')}`;
}

function nextGorevNo(existing: Gorev[]): string {
  const max = existing.reduce((acc, g) => {
    const m = g.gorevNo?.match(/TSK-(\d+)/);
    return m ? Math.max(acc, parseInt(m[1], 10)) : acc;
  }, 0);
  return `TSK-${String(max + 1).padStart(4, '0')}`;
}

const PROJE_DURUM_COLORS: Record<ProjeDurum, string> = {
  Planlama: 'bg-blue-100 text-blue-700',
  Aktif: 'bg-green-100 text-green-700',
  Beklemede: 'bg-amber-100 text-amber-700',
  Tamamlandı: 'bg-gray-100 text-gray-600',
  İptal: 'bg-red-100 text-red-600',
};

const GOREV_DURUM_COLORS: Record<GorevDurum, string> = {
  Bekliyor: 'bg-blue-100 text-blue-700',
  'Devam Ediyor': 'bg-amber-100 text-amber-700',
  Tamamlandı: 'bg-green-100 text-green-700',
  İptal: 'bg-red-100 text-red-600',
};

const ONCELIK_COLORS: Record<GorevOncelik, string> = {
  Düşük: 'bg-gray-100 text-gray-500',
  Normal: 'bg-blue-100 text-blue-600',
  Yüksek: 'bg-amber-100 text-amber-700',
  Acil: 'bg-red-100 text-red-600',
};

const fmt = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Sub-tab: Projeler ────────────────────────────────────────────────────────

function ProjelerTab({ projeler, tr }: { projeler: Proje[]; tr: boolean }) {
  const empty: Proje = {
    projeNo: '',
    projeAdi: '',
    musteriAdi: '',
    projeMuduru: '',
    baslangicTarihi: '',
    bitisTarihi: '',
    butce: 0,
    harcananTutar: 0,
    tamamlanmaYuzdesi: 0,
    durum: 'Planlama' as ProjeDurum,
    aciklama: '',
  };

  const [form, setForm] = useState<Proje>(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const openNew = () => {
    setForm({ ...empty, projeNo: nextProjeNo(projeler) });
    setEditId(null);
    setShowForm(true);
  };

  const openEdit = (p: Proje) => {
    setForm({ ...p });
    setEditId(p.id!);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.projeAdi.trim()) return;
    setSaving(true);
    try {
      const payload = { ...form, updatedAt: serverTimestamp() };
      if (editId) {
        await updateDoc(doc(db, 'projeler', editId), payload);
      } else {
        await addDoc(collection(db, 'projeler'), { ...payload, createdAt: serverTimestamp() });
      }
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'projeler', id));
    setDeleteId(null);
  };

  const isOverdue = (p: Proje) =>
    p.bitisTarihi < TODAY && p.durum !== 'Tamamlandı' && p.durum !== 'İptal';
  const isBudgetWarn = (p: Proje) =>
    p.butce > 0 && p.harcananTutar / p.butce > 0.8 && p.durum !== 'Tamamlandı' && p.durum !== 'İptal';

  const field = (k: keyof Proje) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    setForm(f => ({ ...f, [k]: v }));
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">{tr ? 'Projeler' : 'Projects'}</h2>
        <button onClick={openNew} className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm">
          <Plus size={15} />
          {tr ? 'Yeni Proje' : 'New Project'}
        </button>
      </div>

      {/* Table */}
      <div className="apple-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">{tr ? 'No' : 'No'}</th>
                <th className="px-4 py-3">{tr ? 'Proje Adı' : 'Project Name'}</th>
                <th className="px-4 py-3">{tr ? 'Müşteri' : 'Customer'}</th>
                <th className="px-4 py-3">{tr ? 'Müdür' : 'Manager'}</th>
                <th className="px-4 py-3">{tr ? 'Bitiş' : 'Due'}</th>
                <th className="px-4 py-3">{tr ? 'Bütçe' : 'Budget'}</th>
                <th className="px-4 py-3 w-36">{tr ? 'İlerleme' : 'Progress'}</th>
                <th className="px-4 py-3">{tr ? 'Durum' : 'Status'}</th>
                <th className="px-4 py-3 text-right">{tr ? 'İşlem' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {projeler.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-gray-400">
                    {tr ? 'Henüz proje yok.' : 'No projects yet.'}
                  </td>
                </tr>
              )}
              {projeler.map(p => (
                <motion.tr
                  key={p.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="hover:bg-gray-50/60 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.projeNo}</td>
                  <td className="px-4 py-3 font-medium text-gray-800 max-w-[160px] truncate">
                    {p.projeAdi}
                    {isOverdue(p) && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full">
                        <AlertTriangle size={10} />
                        {tr ? 'Gecikti' : 'Overdue'}
                      </span>
                    )}
                    {isBudgetWarn(p) && (
                      <span className="ml-1 inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full">
                        <AlertTriangle size={10} />
                        {tr ? 'Bütçe' : 'Budget'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{p.musteriAdi}</td>
                  <td className="px-4 py-3 text-gray-600">{p.projeMuduru}</td>
                  <td className="px-4 py-3 text-gray-500">{p.bitisTarihi}</td>
                  <td className="px-4 py-3 text-gray-700">₺{fmt(p.butce)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand rounded-full transition-all"
                          style={{ width: `${Math.min(p.tamamlanmaYuzdesi, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">{p.tamamlanmaYuzdesi}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${PROJE_DURUM_COLORS[p.durum]}`}>
                      {p.durum}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => setDeleteId(p.id!)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-500 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="apple-card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 text-base">
                {editId ? (tr ? 'Proje Düzenle' : 'Edit Project') : (tr ? 'Yeni Proje' : 'New Project')}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Proje No' : 'Project No'}</label>
                <input className="apple-input w-full px-3 py-2 text-sm" value={form.projeNo} onChange={field('projeNo')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Proje Adı *' : 'Project Name *'}</label>
                <input className="apple-input w-full px-3 py-2 text-sm" value={form.projeAdi} onChange={field('projeAdi')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Müşteri Adı' : 'Customer Name'}</label>
                <input className="apple-input w-full px-3 py-2 text-sm" value={form.musteriAdi} onChange={field('musteriAdi')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Proje Müdürü' : 'Project Manager'}</label>
                <input className="apple-input w-full px-3 py-2 text-sm" value={form.projeMuduru} onChange={field('projeMuduru')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Başlangıç Tarihi' : 'Start Date'}</label>
                <input type="date" className="apple-input w-full px-3 py-2 text-sm" value={form.baslangicTarihi} onChange={field('baslangicTarihi')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Bitiş Tarihi' : 'End Date'}</label>
                <input type="date" className="apple-input w-full px-3 py-2 text-sm" value={form.bitisTarihi} onChange={field('bitisTarihi')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Bütçe (₺)' : 'Budget (₺)'}</label>
                <input type="number" min={0} className="apple-input w-full px-3 py-2 text-sm" value={form.butce} onChange={field('butce')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Harcanan Tutar (₺)' : 'Spent (₺)'}</label>
                <input type="number" min={0} className="apple-input w-full px-3 py-2 text-sm" value={form.harcananTutar} onChange={field('harcananTutar')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Tamamlanma %' : 'Completion %'}</label>
                <input type="number" min={0} max={100} className="apple-input w-full px-3 py-2 text-sm" value={form.tamamlanmaYuzdesi} onChange={field('tamamlanmaYuzdesi')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Durum' : 'Status'}</label>
                <select
                  className="apple-input w-full px-3 py-2 text-sm"
                  value={form.durum}
                  onChange={e => setForm(f => ({ ...f, durum: e.target.value as ProjeDurum }))}
                >
                  {(['Planlama', 'Aktif', 'Beklemede', 'Tamamlandı', 'İptal'] as ProjeDurum[]).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Açıklama' : 'Description'}</label>
                <textarea rows={3} className="apple-input w-full px-3 py-2 text-sm resize-none" value={form.aciklama} onChange={field('aciklama')} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowForm(false)} className="apple-button-secondary px-4 py-2 text-sm">
                {tr ? 'İptal' : 'Cancel'}
              </button>
              <button onClick={handleSave} disabled={saving} className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm">
                <Save size={14} />
                {saving ? (tr ? 'Kaydediliyor…' : 'Saving…') : (tr ? 'Kaydet' : 'Save')}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="apple-card p-6 max-w-sm w-full space-y-4"
          >
            <p className="text-gray-700 text-sm">{tr ? 'Bu projeyi silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this project?'}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteId(null)} className="apple-button-secondary px-4 py-2 text-sm">{tr ? 'İptal' : 'Cancel'}</button>
              <button onClick={() => handleDelete(deleteId)} className="apple-button-primary px-4 py-2 text-sm">{tr ? 'Sil' : 'Delete'}</button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-tab: Görevler ────────────────────────────────────────────────────────

function GorevlerTab({ gorevler, projeler, tr }: { gorevler: Gorev[]; projeler: Proje[]; tr: boolean }) {
  const empty: Gorev = {
    gorevNo: '',
    projeId: '',
    projeAdi: '',
    gorevBasligi: '',
    atananKisi: '',
    baslangicTarihi: '',
    bitisTarihi: '',
    oncelik: 'Normal' as GorevOncelik,
    durum: 'Bekliyor' as GorevDurum,
    tamamlanmaYuzdesi: 0,
  };

  const [form, setForm] = useState<Gorev>(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'oncelik' | 'proje'>('oncelik');
  const [filterOncelik, setFilterOncelik] = useState<GorevOncelik | 'Tümü'>('Tümü');

  const openNew = () => {
    setForm({ ...empty, gorevNo: nextGorevNo(gorevler) });
    setEditId(null);
    setShowForm(true);
  };

  const openEdit = (g: Gorev) => {
    setForm({ ...g });
    setEditId(g.id!);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.gorevBasligi.trim()) return;
    setSaving(true);
    try {
      const payload = { ...form, updatedAt: serverTimestamp() };
      if (editId) {
        await updateDoc(doc(db, 'projeGorevleri', editId), payload);
      } else {
        await addDoc(collection(db, 'projeGorevleri'), { ...payload, createdAt: serverTimestamp() });
      }
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'projeGorevleri', id));
    setDeleteId(null);
  };

  const field = (k: keyof Gorev) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    setForm(f => ({ ...f, [k]: v }));
  };

  const filtered = useMemo(() => {
    let list = [...gorevler];
    if (filterOncelik !== 'Tümü') list = list.filter(g => g.oncelik === filterOncelik);
    return list;
  }, [gorevler, filterOncelik]);

  const groups = useMemo(() => {
    if (groupBy === 'oncelik') {
      const order: GorevOncelik[] = ['Acil', 'Yüksek', 'Normal', 'Düşük'];
      return order.map(o => ({ label: o, items: filtered.filter(g => g.oncelik === o) })).filter(g => g.items.length > 0);
    } else {
      const projeAdilar = [...new Set(filtered.map(g => g.projeAdi || '—'))];
      return projeAdilar.map(p => ({ label: p, items: filtered.filter(g => (g.projeAdi || '—') === p) }));
    }
  }, [filtered, groupBy]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-gray-800">{tr ? 'Görevler' : 'Tasks'}</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl px-3 py-1.5 text-sm text-gray-600">
            <ChevronDown size={14} />
            <select
              className="bg-transparent text-sm outline-none cursor-pointer"
              value={groupBy}
              onChange={e => setGroupBy(e.target.value as 'oncelik' | 'proje')}
            >
              <option value="oncelik">{tr ? 'Önceliğe Göre' : 'By Priority'}</option>
              <option value="proje">{tr ? 'Projeye Göre' : 'By Project'}</option>
            </select>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl px-3 py-1.5 text-sm text-gray-600">
            <select
              className="bg-transparent text-sm outline-none cursor-pointer"
              value={filterOncelik}
              onChange={e => setFilterOncelik(e.target.value as GorevOncelik | 'Tümü')}
            >
              <option value="Tümü">{tr ? 'Tüm Öncelikler' : 'All Priorities'}</option>
              {(['Acil', 'Yüksek', 'Normal', 'Düşük'] as GorevOncelik[]).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <button onClick={openNew} className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm">
            <Plus size={15} />
            {tr ? 'Yeni Görev' : 'New Task'}
          </button>
        </div>
      </div>

      {groups.length === 0 && (
        <div className="apple-card px-6 py-10 text-center text-gray-400 text-sm">
          {tr ? 'Henüz görev yok.' : 'No tasks yet.'}
        </div>
      )}

      {groups.map(group => (
        <div key={group.label} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${groupBy === 'oncelik' ? ONCELIK_COLORS[group.label as GorevOncelik] : 'bg-gray-100 text-gray-600'}`}>
              {group.label}
            </span>
            <span className="text-xs text-gray-400">{group.items.length} {tr ? 'görev' : 'tasks'}</span>
          </div>
          <div className="apple-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">{tr ? 'No' : 'No'}</th>
                  <th className="px-4 py-3">{tr ? 'Başlık' : 'Title'}</th>
                  <th className="px-4 py-3">{tr ? 'Proje' : 'Project'}</th>
                  <th className="px-4 py-3">{tr ? 'Atanan' : 'Assignee'}</th>
                  <th className="px-4 py-3">{tr ? 'Bitiş' : 'Due'}</th>
                  <th className="px-4 py-3">{tr ? 'Öncelik' : 'Priority'}</th>
                  <th className="px-4 py-3">{tr ? 'Durum' : 'Status'}</th>
                  <th className="px-4 py-3 w-32">{tr ? 'İlerleme' : 'Progress'}</th>
                  <th className="px-4 py-3 text-right">{tr ? 'İşlem' : ''}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {group.items.map(g => (
                  <motion.tr key={g.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{g.gorevNo}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{g.gorevBasligi}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{g.projeAdi}</td>
                    <td className="px-4 py-3 text-gray-600">{g.atananKisi}</td>
                    <td className="px-4 py-3 text-gray-500">{g.bitisTarihi}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ONCELIK_COLORS[g.oncelik]}`}>{g.oncelik}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${GOREV_DURUM_COLORS[g.durum]}`}>{g.durum}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-brand rounded-full" style={{ width: `${g.tamamlanmaYuzdesi}%` }} />
                        </div>
                        <span className="text-xs text-gray-400">{g.tamamlanmaYuzdesi}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => openEdit(g)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => setDeleteId(g.id!)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="apple-card w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 text-base">
                {editId ? (tr ? 'Görev Düzenle' : 'Edit Task') : (tr ? 'Yeni Görev' : 'New Task')}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Görev No' : 'Task No'}</label>
                <input className="apple-input w-full px-3 py-2 text-sm" value={form.gorevNo} onChange={field('gorevNo')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Görev Başlığı *' : 'Task Title *'}</label>
                <input className="apple-input w-full px-3 py-2 text-sm" value={form.gorevBasligi} onChange={field('gorevBasligi')} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Proje' : 'Project'}</label>
                <select
                  className="apple-input w-full px-3 py-2 text-sm"
                  value={form.projeId}
                  onChange={e => {
                    const p = projeler.find(x => x.id === e.target.value);
                    setForm(f => ({ ...f, projeId: e.target.value, projeAdi: p?.projeAdi || '' }));
                  }}
                >
                  <option value="">{tr ? '-- Proje Seçin --' : '-- Select Project --'}</option>
                  {projeler.map(p => <option key={p.id} value={p.id}>{p.projeAdi}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Atanan Kişi' : 'Assignee'}</label>
                <input className="apple-input w-full px-3 py-2 text-sm" value={form.atananKisi} onChange={field('atananKisi')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Tamamlanma %' : 'Completion %'}</label>
                <input type="number" min={0} max={100} className="apple-input w-full px-3 py-2 text-sm" value={form.tamamlanmaYuzdesi} onChange={field('tamamlanmaYuzdesi')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Başlangıç' : 'Start'}</label>
                <input type="date" className="apple-input w-full px-3 py-2 text-sm" value={form.baslangicTarihi} onChange={field('baslangicTarihi')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Bitiş' : 'End'}</label>
                <input type="date" className="apple-input w-full px-3 py-2 text-sm" value={form.bitisTarihi} onChange={field('bitisTarihi')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Öncelik' : 'Priority'}</label>
                <select
                  className="apple-input w-full px-3 py-2 text-sm"
                  value={form.oncelik}
                  onChange={e => setForm(f => ({ ...f, oncelik: e.target.value as GorevOncelik }))}
                >
                  {(['Düşük', 'Normal', 'Yüksek', 'Acil'] as GorevOncelik[]).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Durum' : 'Status'}</label>
                <select
                  className="apple-input w-full px-3 py-2 text-sm"
                  value={form.durum}
                  onChange={e => setForm(f => ({ ...f, durum: e.target.value as GorevDurum }))}
                >
                  {(['Bekliyor', 'Devam Ediyor', 'Tamamlandı', 'İptal'] as GorevDurum[]).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr ? 'İptal' : 'Cancel'}</button>
              <button onClick={handleSave} disabled={saving} className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm">
                <Save size={14} />
                {saving ? (tr ? 'Kaydediliyor…' : 'Saving…') : (tr ? 'Kaydet' : 'Save')}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="apple-card p-6 max-w-sm w-full space-y-4">
            <p className="text-gray-700 text-sm">{tr ? 'Bu görevi silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this task?'}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteId(null)} className="apple-button-secondary px-4 py-2 text-sm">{tr ? 'İptal' : 'Cancel'}</button>
              <button onClick={() => handleDelete(deleteId)} className="apple-button-primary px-4 py-2 text-sm">{tr ? 'Sil' : 'Delete'}</button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-tab: Zaman Takibi ────────────────────────────────────────────────────

function ZamanTakibiTab({ zamanKayitlari, projeler, gorevler, tr }: { zamanKayitlari: ZamanKaydi[]; projeler: Proje[]; gorevler: Gorev[]; tr: boolean }) {
  const empty: ZamanKaydi = {
    kayitTarihi: TODAY,
    projeId: '',
    projeAdi: '',
    gorev: '',
    calisanAdi: '',
    harcananSaat: 0,
    aciklama: '',
    faturalandirabilir: false,
    saatUcreti: 0,
  };

  const [form, setForm] = useState<ZamanKaydi>(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const openNew = () => { setForm(empty); setEditId(null); setShowForm(true); };
  const openEdit = (z: ZamanKaydi) => { setForm({ ...z }); setEditId(z.id!); setShowForm(true); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { ...form, updatedAt: serverTimestamp() };
      if (editId) {
        await updateDoc(doc(db, 'projeZamanKayitlari', editId), payload);
      } else {
        await addDoc(collection(db, 'projeZamanKayitlari'), { ...payload, createdAt: serverTimestamp() });
      }
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'projeZamanKayitlari', id));
    setDeleteId(null);
  };

  const field = (k: keyof ZamanKaydi) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.type === 'number' ? Number(e.target.value)
      : e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked
      : e.target.value;
    setForm(f => ({ ...f, [k]: v }));
  };

  // KPI: total hours per project
  const kpiByProje = useMemo(() => {
    const map: Record<string, number> = {};
    zamanKayitlari.forEach(z => {
      map[z.projeAdi || '—'] = (map[z.projeAdi || '—'] || 0) + (z.harcananSaat || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [zamanKayitlari]);

  const totalHours = zamanKayitlari.reduce((s, z) => s + (z.harcananSaat || 0), 0);
  const billableHours = zamanKayitlari.filter(z => z.faturalandirabilir).reduce((s, z) => s + (z.harcananSaat || 0), 0);

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="apple-card px-4 py-3">
          <p className="text-xs text-gray-500">{tr ? 'Toplam Saat' : 'Total Hours'}</p>
          <p className="text-2xl font-bold text-gray-800 mt-0.5">{totalHours.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</p>
        </div>
        <div className="apple-card px-4 py-3">
          <p className="text-xs text-gray-500">{tr ? 'Faturalandırılabilir' : 'Billable'}</p>
          <p className="text-2xl font-bold text-brand mt-0.5">{billableHours.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</p>
        </div>
        {kpiByProje.slice(0, 2).map(([name, hours]) => (
          <div key={name} className="apple-card px-4 py-3">
            <p className="text-xs text-gray-500 truncate">{name}</p>
            <p className="text-2xl font-bold text-gray-700 mt-0.5">{hours.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} <span className="text-sm font-normal text-gray-400">h</span></p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">{tr ? 'Zaman Kayıtları' : 'Time Entries'}</h2>
        <button onClick={openNew} className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm">
          <Plus size={15} />
          {tr ? 'Yeni Kayıt' : 'New Entry'}
        </button>
      </div>

      <div className="apple-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">{tr ? 'Tarih' : 'Date'}</th>
                <th className="px-4 py-3">{tr ? 'Proje' : 'Project'}</th>
                <th className="px-4 py-3">{tr ? 'Görev' : 'Task'}</th>
                <th className="px-4 py-3">{tr ? 'Çalışan' : 'Employee'}</th>
                <th className="px-4 py-3">{tr ? 'Saat' : 'Hours'}</th>
                <th className="px-4 py-3">{tr ? 'Saat Ücreti' : 'Rate'}</th>
                <th className="px-4 py-3">{tr ? 'Tutar' : 'Amount'}</th>
                <th className="px-4 py-3">{tr ? 'Faturalı' : 'Billable'}</th>
                <th className="px-4 py-3">{tr ? 'Açıklama' : 'Note'}</th>
                <th className="px-4 py-3 text-right">{tr ? 'İşlem' : ''}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {zamanKayitlari.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">{tr ? 'Henüz zaman kaydı yok.' : 'No time entries yet.'}</td></tr>
              )}
              {zamanKayitlari.map(z => (
                <motion.tr key={z.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3 text-gray-500">{z.kayitTarihi}</td>
                  <td className="px-4 py-3 text-gray-700">{z.projeAdi}</td>
                  <td className="px-4 py-3 text-gray-600">{z.gorev}</td>
                  <td className="px-4 py-3 text-gray-600">{z.calisanAdi}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{z.harcananSaat}</td>
                  <td className="px-4 py-3 text-gray-500">₺{fmt(z.saatUcreti)}</td>
                  <td className="px-4 py-3 text-gray-700 font-medium">₺{fmt(z.harcananSaat * z.saatUcreti)}</td>
                  <td className="px-4 py-3">
                    {z.faturalandirabilir
                      ? <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium">{tr ? 'Evet' : 'Yes'}</span>
                      : <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">{tr ? 'Hayır' : 'No'}</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-[140px] truncate">{z.aciklama}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => openEdit(z)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"><Pencil size={13} /></button>
                      <button onClick={() => setDeleteId(z.id!)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="apple-card w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 text-base">{editId ? (tr ? 'Kayıt Düzenle' : 'Edit Entry') : (tr ? 'Yeni Zaman Kaydı' : 'New Time Entry')}</h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Tarih' : 'Date'}</label>
                <input type="date" className="apple-input w-full px-3 py-2 text-sm" value={form.kayitTarihi} onChange={field('kayitTarihi')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Proje' : 'Project'}</label>
                <select
                  className="apple-input w-full px-3 py-2 text-sm"
                  value={form.projeId}
                  onChange={e => {
                    const p = projeler.find(x => x.id === e.target.value);
                    setForm(f => ({ ...f, projeId: e.target.value, projeAdi: p?.projeAdi || '' }));
                  }}
                >
                  <option value="">{tr ? '-- Proje Seçin --' : '-- Select Project --'}</option>
                  {projeler.map(p => <option key={p.id} value={p.id}>{p.projeAdi}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Görev' : 'Task'}</label>
                <select
                  className="apple-input w-full px-3 py-2 text-sm"
                  value={form.gorev}
                  onChange={e => setForm(f => ({ ...f, gorev: e.target.value }))}
                >
                  <option value="">{tr ? '-- Görev Seçin --' : '-- Select Task --'}</option>
                  {gorevler.filter(g => !form.projeId || g.projeId === form.projeId).map(g => (
                    <option key={g.id} value={g.gorevBasligi}>{g.gorevBasligi}</option>
                  ))}
                  <option value="__other__">{tr ? 'Diğer' : 'Other'}</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Çalışan Adı' : 'Employee Name'}</label>
                <input className="apple-input w-full px-3 py-2 text-sm" value={form.calisanAdi} onChange={field('calisanAdi')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Harcanan Saat' : 'Hours Spent'}</label>
                <input type="number" min={0} step={0.25} className="apple-input w-full px-3 py-2 text-sm" value={form.harcananSaat} onChange={field('harcananSaat')} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Saat Ücreti (₺)' : 'Hourly Rate (₺)'}</label>
                <input type="number" min={0} className="apple-input w-full px-3 py-2 text-sm" value={form.saatUcreti} onChange={field('saatUcreti')} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Açıklama' : 'Description'}</label>
                <textarea rows={2} className="apple-input w-full px-3 py-2 text-sm resize-none" value={form.aciklama} onChange={field('aciklama')} />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  id="faturalandirabilir"
                  type="checkbox"
                  className="w-4 h-4 accent-[#ff4000] cursor-pointer"
                  checked={form.faturalandirabilir}
                  onChange={e => setForm(f => ({ ...f, faturalandirabilir: e.target.checked }))}
                />
                <label htmlFor="faturalandirabilir" className="text-sm text-gray-700 cursor-pointer">
                  {tr ? 'Faturalandırılabilir' : 'Billable'}
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr ? 'İptal' : 'Cancel'}</button>
              <button onClick={handleSave} disabled={saving} className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm">
                <Save size={14} />
                {saving ? (tr ? 'Kaydediliyor…' : 'Saving…') : (tr ? 'Kaydet' : 'Save')}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="apple-card p-6 max-w-sm w-full space-y-4">
            <p className="text-gray-700 text-sm">{tr ? 'Bu kaydı silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this entry?'}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteId(null)} className="apple-button-secondary px-4 py-2 text-sm">{tr ? 'İptal' : 'Cancel'}</button>
              <button onClick={() => handleDelete(deleteId)} className="apple-button-primary px-4 py-2 text-sm">{tr ? 'Sil' : 'Delete'}</button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-tab: Proje P&L ───────────────────────────────────────────────────────

function ProjePLTab({ projeler, zamanKayitlari, tr }: { projeler: Proje[]; zamanKayitlari: ZamanKaydi[]; tr: boolean }) {
  const plData = useMemo(() => {
    return projeler.map(p => {
      const calisan = zamanKayitlari
        .filter(z => z.projeId === p.id)
        .reduce((s, z) => s + z.harcananSaat * z.saatUcreti, 0);
      const toplamHarcanan = (p.harcananTutar || 0) + calisan;
      const kalanButce = (p.butce || 0) - toplamHarcanan;
      const marj = p.butce > 0 ? ((p.butce - toplamHarcanan) / p.butce) * 100 : 0;
      return { proje: p, calisan, toplamHarcanan, kalanButce, marj };
    });
  }, [projeler, zamanKayitlari]);

  const toplamButce = plData.reduce((s, d) => s + d.proje.butce, 0);
  const toplamHarcanan = plData.reduce((s, d) => s + d.toplamHarcanan, 0);
  const toplamKalan = toplamButce - toplamHarcanan;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-800">{tr ? 'Proje Kâr & Zarar' : 'Project P&L'}</h2>

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="apple-card px-5 py-4">
          <p className="text-xs text-gray-500">{tr ? 'Toplam Bütçe' : 'Total Budget'}</p>
          <p className="text-2xl font-bold text-gray-800 mt-0.5">₺{fmt(toplamButce)}</p>
        </div>
        <div className="apple-card px-5 py-4">
          <p className="text-xs text-gray-500">{tr ? 'Toplam Harcanan' : 'Total Spent'}</p>
          <p className="text-2xl font-bold text-gray-800 mt-0.5">₺{fmt(toplamHarcanan)}</p>
        </div>
        <div className="apple-card px-5 py-4">
          <p className="text-xs text-gray-500">{tr ? 'Kalan Bütçe' : 'Remaining'}</p>
          <p className={`text-2xl font-bold mt-0.5 ${toplamKalan >= 0 ? 'text-green-600' : 'text-red-500'}`}>₺{fmt(toplamKalan)}</p>
        </div>
      </div>

      {/* P&L Table + bar charts */}
      <div className="apple-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">{tr ? 'Proje' : 'Project'}</th>
                <th className="px-4 py-3">{tr ? 'Durum' : 'Status'}</th>
                <th className="px-4 py-3 text-right">{tr ? 'Toplam Bütçe' : 'Budget'}</th>
                <th className="px-4 py-3 text-right">{tr ? 'Mal. Harcama' : 'Direct Costs'}</th>
                <th className="px-4 py-3 text-right">{tr ? 'İşçilik' : 'Labor'}</th>
                <th className="px-4 py-3 text-right">{tr ? 'Toplam Harcanan' : 'Total Spent'}</th>
                <th className="px-4 py-3 text-right">{tr ? 'Kalan' : 'Remaining'}</th>
                <th className="px-4 py-3 text-right">{tr ? 'Marj %' : 'Margin %'}</th>
                <th className="px-4 py-3 w-48">{tr ? 'Bütçe / Harcama' : 'Budget vs Spent'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {plData.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">{tr ? 'Veri yok.' : 'No data.'}</td></tr>
              )}
              {plData.map(({ proje, calisan, toplamHarcanan: th, kalanButce, marj }) => {
                const spentPct = proje.butce > 0 ? Math.min((th / proje.butce) * 100, 100) : 0;
                const overBudget = th > proje.butce;
                return (
                  <motion.tr key={proje.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800 max-w-[160px] truncate">{proje.projeAdi}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PROJE_DURUM_COLORS[proje.durum]}`}>{proje.durum}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">₺{fmt(proje.butce)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">₺{fmt(proje.harcananTutar)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">₺{fmt(calisan)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${overBudget ? 'text-red-500' : 'text-gray-800'}`}>₺{fmt(th)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${kalanButce >= 0 ? 'text-green-600' : 'text-red-500'}`}>₺{fmt(kalanButce)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${marj >= 0 ? 'text-green-600' : 'text-red-500'}`}>{marj.toFixed(1)}%</td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        {/* Budget bar */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400 w-12 text-right">{tr ? 'Bütçe' : 'Budget'}</span>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-300 rounded-full" style={{ width: '100%' }} />
                          </div>
                        </div>
                        {/* Spent bar */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400 w-12 text-right">{tr ? 'Harcama' : 'Spent'}</span>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${overBudget ? 'bg-red-400' : 'bg-brand'}`}
                              style={{ width: `${spentPct}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400">{spentPct.toFixed(0)}%</span>
                        </div>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type TabKey = 'projeler' | 'gorevler' | 'zaman' | 'pl';

export default function ProjeModule({ currentLanguage, isAuthenticated }: { currentLanguage: string; isAuthenticated: boolean }) {
  const tr = currentLanguage === 'tr';

  const [activeTab, setActiveTab] = useState<TabKey>('projeler');
  const [projeler, setProjeler] = useState<Proje[]>([]);
  const [gorevler, setGorevler] = useState<Gorev[]>([]);
  const [zamanKayitlari, setZamanKayitlari] = useState<ZamanKaydi[]>([]);

  // Firestore real-time subscriptions
  useEffect(() => {
    if (!isAuthenticated) return;
    const unsub = onSnapshot(
      query(collection(db, 'projeler'), orderBy('createdAt', 'desc')),
      snap => setProjeler(snap.docs.map(d => ({ id: d.id, ...d.data() } as Proje))),
    );
    return unsub;
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const unsub = onSnapshot(
      query(collection(db, 'projeGorevleri'), orderBy('createdAt', 'desc')),
      snap => setGorevler(snap.docs.map(d => ({ id: d.id, ...d.data() } as Gorev))),
    );
    return unsub;
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const unsub = onSnapshot(
      query(collection(db, 'projeZamanKayitlari'), orderBy('createdAt', 'desc')),
      snap => setZamanKayitlari(snap.docs.map(d => ({ id: d.id, ...d.data() } as ZamanKaydi))),
    );
    return unsub;
  }, [isAuthenticated]);

  const tabs: { key: TabKey; labelTr: string; labelEn: string; icon: React.ReactNode }[] = [
    { key: 'projeler', labelTr: 'Projeler', labelEn: 'Projects', icon: <FolderKanban size={15} /> },
    { key: 'gorevler', labelTr: 'Görevler', labelEn: 'Tasks', icon: <ListTodo size={15} /> },
    { key: 'zaman', labelTr: 'Zaman Takibi', labelEn: 'Time Tracking', icon: <Clock size={15} /> },
    { key: 'pl', labelTr: 'Proje P&L', labelEn: 'Project P&L', icon: <BarChart2 size={15} /> },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-2xl bg-brand/10">
          <Briefcase size={22} className="text-brand" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{tr ? 'Proje Yönetimi' : 'Project Management'}</h1>
          <p className="text-sm text-gray-500">{tr ? 'Projeler, görevler ve zaman takibi' : 'Projects, tasks & time tracking'}</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-gray-100/80 rounded-2xl p-1 w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === t.key
                ? 'bg-white shadow text-gray-800'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon}
            {tr ? t.labelTr : t.labelEn}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        {activeTab === 'projeler' && <ProjelerTab projeler={projeler} tr={tr} />}
        {activeTab === 'gorevler' && <GorevlerTab gorevler={gorevler} projeler={projeler} tr={tr} />}
        {activeTab === 'zaman' && <ZamanTakibiTab zamanKayitlari={zamanKayitlari} projeler={projeler} gorevler={gorevler} tr={tr} />}
        {activeTab === 'pl' && <ProjePLTab projeler={projeler} zamanKayitlari={zamanKayitlari} tr={tr} />}
      </motion.div>
    </div>
  );
}
