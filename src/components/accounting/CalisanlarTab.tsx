import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Eye, Edit2, Trash2, X, Save } from 'lucide-react';
import { format } from 'date-fns';
import { type Employee } from '../../types';
import { SortHeader, formatTRY, type AccountingT } from './shared';

type EmployeeForm = { name: string; employeeId: string; tcId: string; position: string; department: string; salary: number; startDate: string; email: string; phone: string };

interface CalisanlarTabProps {
  t: AccountingT;
  currentLanguage: string;
  displayedCalisanlar: Employee[];
  employeeSearch: string;
  setEmployeeSearch: (v: string) => void;
  calisanSortKey: 'name' | 'position' | 'salary' | 'startDate' | 'department';
  calisanSortDir: 'asc' | 'desc';
  toggleCalisanSort: (key: 'name' | 'position' | 'salary' | 'startDate' | 'department') => void;
  showEmployeeModal: boolean;
  setShowEmployeeModal: (v: boolean) => void;
  editingEmployee: Employee | null;
  setEditingEmployee: (e: Employee | null) => void;
  employeeForm: EmployeeForm;
  setEmployeeForm: React.Dispatch<React.SetStateAction<EmployeeForm>>;
  saveEmployee: () => void;
  deleteEmployee: (id: string) => void;
}

export default function CalisanlarTab({
  t, currentLanguage, displayedCalisanlar, employeeSearch, setEmployeeSearch,
  calisanSortKey, calisanSortDir, toggleCalisanSort,
  showEmployeeModal, setShowEmployeeModal, editingEmployee, setEditingEmployee,
  employeeForm, setEmployeeForm, saveEmployee, deleteEmployee,
}: CalisanlarTabProps) {
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold text-gray-800">{t.calisanlar}</h3>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                <Search size={12} className="text-gray-400" />
                <input value={employeeSearch} onChange={e => setEmployeeSearch(e.target.value)} placeholder={t.name + '...'} className="text-xs outline-none bg-transparent w-32" />
              </div>
              <button onClick={() => setShowEmployeeModal(true)} className="apple-button-primary">
                <Plus size={14} /> {t.add}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="apple-table">
              <thead>
                <tr className="border-b border-gray-100">
                  <SortHeader label={t.name} sortKey="name" currentSort={{ key: calisanSortKey, direction: calisanSortDir }} onSort={(key) => toggleCalisanSort(key as 'name' | 'position' | 'salary' | 'startDate' | 'department')} />
                  <SortHeader label={t.position} sortKey="position" currentSort={{ key: calisanSortKey, direction: calisanSortDir }} onSort={(key) => toggleCalisanSort(key as 'name' | 'position' | 'salary' | 'startDate' | 'department')} className="hidden sm:table-cell" />
                  <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">{t.department}</th>
                  <SortHeader label={t.salary} sortKey="salary" currentSort={{ key: calisanSortKey, direction: calisanSortDir }} onSort={(key) => toggleCalisanSort(key as 'name' | 'position' | 'salary' | 'startDate' | 'department')} className="text-right hidden sm:table-cell" />
                  <SortHeader label={t.startDate} sortKey="startDate" currentSort={{ key: calisanSortKey, direction: calisanSortDir }} onSort={(key) => toggleCalisanSort(key as 'name' | 'position' | 'salary' | 'startDate' | 'department')} className="hidden lg:table-cell" />
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {displayedCalisanlar.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                )}
                {displayedCalisanlar.map(e => (
                  <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-3 font-medium text-gray-800">{e.name}</td>
                    <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell">{e.position}</td>
                    <td className="py-2.5 px-3 text-gray-500 hidden md:table-cell text-xs">{e.department || '—'}</td>
                    <td className="py-2.5 px-3 text-right font-semibold hidden sm:table-cell">{e.salary ? formatTRY(e.salary) : '—'}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500 hidden lg:table-cell">{e.startDate || '—'}</td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => { setEditingEmployee(e); setEmployeeForm({ name: e.name, employeeId: e.employeeId || '', tcId: e.tcId || '', position: e.position, department: e.department || '', salary: e.salary || 0, startDate: e.startDate || format(new Date(), 'yyyy-MM-dd'), email: e.email || '', phone: e.phone || '' }); setShowEmployeeModal(true); }} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                        <button onClick={() => { setEditingEmployee(e); setEmployeeForm({ name: e.name, employeeId: e.employeeId || '', tcId: e.tcId || '', position: e.position, department: e.department || '', salary: e.salary || 0, startDate: e.startDate || format(new Date(), 'yyyy-MM-dd'), email: e.email || '', phone: e.phone || '' }); setShowEmployeeModal(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                        <button onClick={() => deleteEmployee(e.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* EMPLOYEE MODAL */}
      <AnimatePresence>
        {showEmployeeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowEmployeeModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.calisanlar} — {editingEmployee ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowEmployeeModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.name}</label>
                  <input type="text" value={employeeForm.name} onChange={e => setEmployeeForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Ad Soyad" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Çalışan ID' : 'Employee ID'}</label>
                    <input type="text" value={employeeForm.employeeId} onChange={e => setEmployeeForm(prev => ({ ...prev, employeeId: e.target.value }))} placeholder="EMP-001" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'TC Kimlik No' : 'TC ID Number'}</label>
                    <input type="text" value={employeeForm.tcId} onChange={e => setEmployeeForm(prev => ({ ...prev, tcId: e.target.value }))} placeholder="12345678901" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.position}</label>
                    <input type="text" value={employeeForm.position} onChange={e => setEmployeeForm(prev => ({ ...prev, position: e.target.value }))} placeholder="Yazılım Geliştirici" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.department}</label>
                    <input type="text" value={employeeForm.department} onChange={e => setEmployeeForm(prev => ({ ...prev, department: e.target.value }))} placeholder="Teknoloji" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.salary}</label>
                    <input type="number" value={employeeForm.salary} onChange={e => setEmployeeForm(prev => ({ ...prev, salary: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.startDate}</label>
                    <input type="date" value={employeeForm.startDate} onChange={e => setEmployeeForm(prev => ({ ...prev, startDate: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.email}</label>
                    <input type="email" value={employeeForm.email} onChange={e => setEmployeeForm(prev => ({ ...prev, email: e.target.value }))} placeholder="calisan@sirket.com" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.phone}</label>
                    <input type="text" value={employeeForm.phone} onChange={e => setEmployeeForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="+90 555 000 0000" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowEmployeeModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveEmployee} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
