import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Scale, FileText, ShieldCheck, Plus, Search, Trash2, Edit2, 
  AlertTriangle, CheckCircle2, Clock, Calendar, ChevronRight, Download, Folder, X, Eye, TrendingUp
} from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { db, auth } from '../firebase';
import { 
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, 
  doc, serverTimestamp, query, orderBy 
} from 'firebase/firestore';
import { logFirestoreError, OperationType } from '../utils/firebase';
import { 
  type Contract, 
  type LegalCase, 
  type ComplianceItem,
  type LegalDoc
} from '../types';
import { cn } from '../lib/utils';

const SortHeader: React.FC<{ label: string; sortKey: string; currentSort: { key: string; direction: 'asc' | 'desc' } | null; onSort: (key: string) => void }> = ({ label, sortKey, currentSort, onSort }) => (
  <th 
    className="py-4 px-6 text-[#86868B] font-bold cursor-pointer hover:bg-gray-50 transition-colors group/header"
    onClick={() => onSort(sortKey)}
  >
    <div className="flex items-center gap-2">
      {label}
      <TrendingUp className={cn(
        "w-3 h-3 transition-all opacity-0 group-hover/header:opacity-100",
        currentSort?.key === sortKey ? "opacity-100 text-[#ff4000]" : "text-gray-300",
        currentSort?.key === sortKey && currentSort.direction === 'desc' ? "rotate-180" : ""
      )} />
    </div>
  </th>
);

// Contract, LegalCase, ComplianceItem are imported from ../types

interface LegalModuleProps {
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
}

const LegalModule: React.FC<LegalModuleProps> = ({ currentLanguage }) => {
  const [activeTab, setActiveTab] = useState<'contracts' | 'cases' | 'compliance' | 'documents'>('contracts');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [compliance, setCompliance] = useState<ComplianceItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [contractsFilter, setContractsFilter] = useState<'Tümü' | 'Aktif' | 'Yenileme Bekliyor' | 'Süresi Dolan' | 'Taslak'>('Tümü');
  const [casesFilter, setCasesFilter] = useState<'Tümü' | 'Devam Ediyor' | 'Kazanılan' | 'Kaybedilen' | 'Temyiz'>('Tümü');
  const [complianceFilter, setComplianceFilter] = useState<'Tümü' | 'Uyumlu' | 'Uyumsuz' | 'İncelemede'>('Tümü');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  
  // Sorting States
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      showToast(currentLanguage === 'tr' ? 'Dosya yüklendi: ' + e.target.files[0].name : 'File uploaded: ' + e.target.files[0].name);
    }
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortedData = <T extends Record<string, any>>(data: T[]) => {
    if (!sortConfig) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };
  
  // Modal States
  const [modalConfig, setModalConfig] = useState<{ isOpen: boolean; type: 'contract' | 'case' | 'compliance' | 'documents' | null; mode: 'add' | 'edit' | 'view'; data: Contract | LegalCase | ComplianceItem | LegalDoc | string | null }>({
    isOpen: false,
    type: null,
    mode: 'add',
    data: null
  });
  
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    // Stagger subscriptions to prevent Firebase watch-stream assertion errors
    // when many listeners are registered simultaneously.
    const t1 = setTimeout(() => {
      unsubs.push(onSnapshot(query(collection(db, 'contracts'), orderBy('no')), (snap) => {
        setContracts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Contract)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'contracts', auth.currentUser?.uid)));
    }, 0);
    const t2 = setTimeout(() => {
      unsubs.push(onSnapshot(query(collection(db, 'legalCases'), orderBy('no')), (snap) => {
        setCases(snap.docs.map(d => ({ id: d.id, ...d.data() } as LegalCase)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'legalCases', auth.currentUser?.uid)));
    }, 150);
    const t3 = setTimeout(() => {
      unsubs.push(onSnapshot(query(collection(db, 'complianceItems'), orderBy('title')), (snap) => {
        setCompliance(snap.docs.map(d => ({ id: d.id, ...d.data() } as ComplianceItem)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'complianceItems', auth.currentUser?.uid)));
    }, 300);

    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      unsubs.forEach(u => u());
    };
  }, []);

  const saveContracts = async (newContract: Omit<Contract, 'id'>) => {
    try {
      if (modalConfig.mode === 'edit' && typeof modalConfig.data === 'object' && modalConfig.data !== null && 'id' in modalConfig.data) {
        await updateDoc(doc(db, 'contracts', (modalConfig.data as Contract).id), newContract as Record<string, unknown>);
        showToast(currentLanguage === 'tr' ? 'Sözleşme güncellendi' : 'Contract updated');
      } else {
        await addDoc(collection(db, 'contracts'), { ...newContract, createdAt: serverTimestamp() });
        showToast(currentLanguage === 'tr' ? 'Sözleşme oluşturuldu' : 'Contract created');
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'contracts', auth.currentUser?.uid);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu' : 'Error occurred', 'error');
    }
  };

  const saveCases = async (newCase: Omit<LegalCase, 'id'>) => {
    try {
      if (modalConfig.mode === 'edit' && typeof modalConfig.data === 'object' && modalConfig.data !== null && 'id' in modalConfig.data) {
        await updateDoc(doc(db, 'legalCases', (modalConfig.data as LegalCase).id), newCase as Record<string, unknown>);
        showToast(currentLanguage === 'tr' ? 'Dava güncellendi' : 'Case updated');
      } else {
        await addDoc(collection(db, 'legalCases'), { ...newCase, createdAt: serverTimestamp() });
        showToast(currentLanguage === 'tr' ? 'Dava oluşturuldu' : 'Case created');
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'legalCases', auth.currentUser?.uid);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu' : 'Error occurred', 'error');
    }
  };

  const saveCompliance = async (newItem: Omit<ComplianceItem, 'id'>) => {
    try {
      if (modalConfig.mode === 'edit' && typeof modalConfig.data === 'object' && modalConfig.data !== null && 'id' in modalConfig.data) {
        await updateDoc(doc(db, 'complianceItems', (modalConfig.data as ComplianceItem).id), newItem as Record<string, unknown>);
        showToast(currentLanguage === 'tr' ? 'Uyum öğesi güncellendi' : 'Compliance item updated');
      } else {
        await addDoc(collection(db, 'complianceItems'), { ...newItem, createdAt: serverTimestamp() });
        showToast(currentLanguage === 'tr' ? 'Uyum öğesi oluşturuldu' : 'Compliance item created');
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'complianceItems', auth.currentUser?.uid);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu' : 'Error occurred', 'error');
    }
  };

  const handleDelete = (id: string, type: 'contract' | 'case' | 'compliance') => {
    setConfirmModal({
      isOpen: true,
      title: currentLanguage === 'tr' ? 'Silme Onayı' : 'Delete Confirmation',
      message: currentLanguage === 'tr' ? 'Bu kaydı silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this record?',
      onConfirm: async () => {
        try {
          const col = type === 'contract' ? 'contracts' : type === 'case' ? 'legalCases' : 'complianceItems';
          await deleteDoc(doc(db, col, id));
          showToast(currentLanguage === 'tr' ? 'Kayıt başarıyla silindi.' : 'Record deleted successfully.');
        } catch (err) {
          logFirestoreError(err, OperationType.DELETE, `${type}s/${id}`, auth.currentUser?.uid);
          showToast(currentLanguage === 'tr' ? 'Hata oluştu' : 'Error occurred', 'error');
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = Object.fromEntries(formData.entries());
    
    if (modalConfig.type === 'contract') {
      const contractData = {
        ...data,
        value: Number(data.value)
      };
      await saveContracts(contractData as unknown as Omit<Contract, 'id'>);
    } else if (modalConfig.type === 'case') {
      const caseData = {
        ...data,
        amount: Number(data.amount)
      };
      await saveCases(caseData as unknown as Omit<LegalCase, 'id'>);
    } else if (modalConfig.type === 'compliance') {
      const compData = {
        ...data,
        isCritical: data.isCritical === 'true'
      };
      await saveCompliance(compData as unknown as Omit<ComplianceItem, 'id'>);
    }
    
    setModalConfig({ isOpen: false, type: null, mode: 'add', data: null });
  };

  const t = {
    contracts: currentLanguage === 'tr' ? 'Sözleşmeler' : 'Contracts',
    cases: currentLanguage === 'tr' ? 'Dava & İtirazlar' : 'Cases & Objections',
    compliance: currentLanguage === 'tr' ? 'Uyum & KVKK' : 'Compliance & GDPR',
    documents: currentLanguage === 'tr' ? 'Belgeler' : 'Documents',
    add: currentLanguage === 'tr' ? 'Ekle' : 'Add',
    search: currentLanguage === 'tr' ? 'Ara...' : 'Search...',
    status: currentLanguage === 'tr' ? 'Durum' : 'Status',
    actions: currentLanguage === 'tr' ? 'İşlemler' : 'Actions',
  };

  // KPIs
  const activeContractsValue = contracts.filter(c => c.status === 'Aktif').reduce((sum, c) => sum + c.value, 0);
  const totalCasesValue = cases.reduce((sum, c) => sum + c.amount, 0);

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 p-1.5 bg-white border border-gray-200 rounded-2xl w-max shadow-sm overflow-x-auto max-w-full scrollbar-none">
        {[
          { id: 'contracts', label: t.contracts, icon: FileText, count: contracts.length },
          { id: 'cases', label: t.cases, icon: Scale, count: cases.length },
          { id: 'compliance', label: t.compliance, icon: ShieldCheck, count: compliance.length },
          { id: 'documents', label: t.documents, icon: Folder, count: null },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'contracts' | 'cases' | 'compliance' | 'documents')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-[#ff4000] text-white shadow-md' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-50'}`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.count !== null && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {/* CONTRACTS TAB */}
        {activeTab === 'contracts' && (
          <motion.div key="contracts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <button className="apple-card p-6 flex flex-col justify-between cursor-pointer group text-left" onClick={() => { setActiveTab('contracts'); setContractsFilter('Tümü'); setSearchQuery(''); }}>
                <div className="flex justify-between items-start mb-4">
                  <p className="text-sm font-semibold text-[#86868B]">{currentLanguage === 'tr' ? 'Toplam' : 'Total'}</p>
                  <FileText className="w-5 h-5 text-blue-500" />
                </div>
                <p className="text-3xl font-bold text-[#1D1D1F]">{contracts.length}</p>
              </button>
              <button className="apple-card p-6 flex flex-col justify-between cursor-pointer group text-left" onClick={() => { setActiveTab('contracts'); setContractsFilter('Aktif'); setSearchQuery(''); }}>
                <div className="flex justify-between items-start mb-4">
                  <p className="text-sm font-semibold text-[#86868B]">{currentLanguage === 'tr' ? 'Aktif' : 'Active'}</p>
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                </div>
                <p className="text-3xl font-bold text-[#1D1D1F]">{contracts.filter(c => c.status === 'Aktif').length}</p>
              </button>
              <button className="apple-card p-6 flex flex-col justify-between cursor-pointer group text-left" onClick={() => { setActiveTab('contracts'); setContractsFilter('Yenileme Bekliyor'); setSearchQuery(''); }}>
                <div className="flex justify-between items-start mb-4">
                  <p className="text-sm font-semibold text-[#86868B]">{currentLanguage === 'tr' ? 'Sona Yaklaşan' : 'Expiring Soon'}</p>
                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                </div>
                <p className="text-3xl font-bold text-[#1D1D1F]">{contracts.filter(c => c.status === 'Yenileme Bekliyor').length}</p>
              </button>
              <button className="apple-card p-6 flex flex-col justify-between cursor-pointer group text-left" onClick={() => setActiveTab('contracts')}>
                <div className="flex justify-between items-start mb-4">
                  <p className="text-sm font-semibold text-[#86868B]">{currentLanguage === 'tr' ? 'Aktif Değer' : 'Active Value'}</p>
                  <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-[#ff4000] transition-colors" />
                </div>
                <p className="text-3xl font-bold text-[#1D1D1F]">{activeContractsValue.toLocaleString('tr-TR')} ₺</p>
              </button>
            </div>

            {/* Search & Add */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input 
                  type="text" 
                  placeholder={currentLanguage === 'tr' ? 'Sözleşme ara...' : 'Search contracts...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="apple-input w-full pl-12 pr-4 py-3"
                />
              </div>
              <button onClick={() => setModalConfig({ isOpen: true, type: 'contract', mode: 'add', data: null })} className="apple-button-primary flex items-center justify-center gap-2 px-6 py-3">
                <Plus className="w-5 h-5" /> {t.add}
              </button>
            </div>

            {/* Table */}
            <div className="apple-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <SortHeader label={currentLanguage === 'tr' ? 'No' : 'No'} sortKey="no" currentSort={sortConfig} onSort={handleSort} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Başlık' : 'Title'} sortKey="title" currentSort={sortConfig} onSort={handleSort} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Taraf' : 'Party'} sortKey="party" currentSort={sortConfig} onSort={handleSort} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Bitiş' : 'End Date'} sortKey="endDate" currentSort={sortConfig} onSort={handleSort} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Değer' : 'Value'} sortKey="value" currentSort={sortConfig} onSort={handleSort} />
                      <SortHeader label={t.status} sortKey="status" currentSort={sortConfig} onSort={handleSort} />
                      <th className="py-4 px-6 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {getSortedData(contracts.filter(c => 
                      (contractsFilter === 'Tümü' || c.status === contractsFilter) &&
                      (c.title.toLowerCase().includes(searchQuery.toLowerCase()) || c.party.toLowerCase().includes(searchQuery.toLowerCase()))
                    )).map((contract: Contract) => (
                      <tr key={contract.id} className="hover:bg-gray-50 transition-colors group">
                        <td className="py-4 px-6 font-mono text-xs text-gray-500">{contract.no}</td>
                        <td className="py-4 px-6 font-bold text-[#1D1D1F]">{contract.title}</td>
                        <td className="py-4 px-6 text-gray-600">{contract.party}</td>
                        <td className="py-4 px-6 text-gray-600 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-gray-400"/> {contract.endDate}</td>
                        <td className="py-4 px-6 font-semibold text-[#1D1D1F]">{contract.value.toLocaleString('tr-TR')} ₺</td>
                        <td className="py-4 px-6">
                          <span className={`px-3 py-1 rounded-full text-[11px] font-bold ${
                            contract.status === 'Aktif' ? 'bg-green-100 text-green-700' :
                            contract.status === 'Yenileme Bekliyor' ? 'bg-orange-100 text-orange-700' :
                            contract.status === 'Süresi Dolan' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {contract.status}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setModalConfig({ isOpen: true, type: 'contract', mode: 'view', data: contract })} className="p-2 hover:bg-blue-50 text-blue-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'İncele' : 'View'}><Eye className="w-4 h-4" /></button>
                            <button onClick={() => setModalConfig({ isOpen: true, type: 'contract', mode: 'edit', data: contract })} className="p-2 hover:bg-gray-200 text-gray-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => handleDelete(contract.id, 'contract')} className="p-2 hover:bg-red-50 text-red-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* CASES TAB */}
        {activeTab === 'cases' && (
          <motion.div key="cases" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm flex flex-col justify-between cursor-pointer hover:border-[#ff4000] transition-colors group" onClick={() => { setActiveTab('cases'); setCasesFilter('Tümü'); setSearchQuery(''); }}>
                <div className="flex justify-between items-start mb-4">
                  <p className="text-sm font-semibold text-[#86868B]">{currentLanguage === 'tr' ? 'Toplam Dava' : 'Total Cases'}</p>
                  <Scale className="w-5 h-5 text-blue-500" />
                </div>
                <p className="text-3xl font-bold text-[#1D1D1F]">{cases.length}</p>
              </div>
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm flex flex-col justify-between cursor-pointer hover:border-[#ff4000] transition-colors group" onClick={() => { setActiveTab('cases'); setCasesFilter('Devam Ediyor'); setSearchQuery(''); }}>
                <div className="flex justify-between items-start mb-4">
                  <p className="text-sm font-semibold text-[#86868B]">{currentLanguage === 'tr' ? 'Devam Eden' : 'Ongoing'}</p>
                  <Clock className="w-5 h-5 text-orange-500" />
                </div>
                <p className="text-3xl font-bold text-[#1D1D1F]">{cases.filter(c => c.status === 'Devam Ediyor').length}</p>
              </div>
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm flex flex-col justify-between cursor-pointer hover:border-[#ff4000] transition-colors group" onClick={() => { setActiveTab('cases'); setCasesFilter('Kazanılan'); setSearchQuery(''); }}>
                <div className="flex justify-between items-start mb-4">
                  <p className="text-sm font-semibold text-[#86868B]">{currentLanguage === 'tr' ? 'Kazanılan' : 'Won'}</p>
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                </div>
                <p className="text-3xl font-bold text-[#1D1D1F]">{cases.filter(c => c.status === 'Kazanılan').length}</p>
              </div>
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm flex flex-col justify-between cursor-pointer hover:border-[#ff4000] transition-colors group" onClick={() => setActiveTab('cases')}>
                <div className="flex justify-between items-start mb-4">
                  <p className="text-sm font-semibold text-[#86868B]">{currentLanguage === 'tr' ? 'Toplam Değer' : 'Total Value'}</p>
                  <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-[#ff4000] transition-colors" />
                </div>
                <p className="text-3xl font-bold text-[#1D1D1F]">{totalCasesValue.toLocaleString('tr-TR')}₺</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input 
                  type="text" 
                  placeholder={currentLanguage === 'tr' ? 'Dava ara...' : 'Search cases...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm focus:border-[#ff4000] outline-none transition-all shadow-sm"
                />
              </div>
              <button onClick={() => setModalConfig({ isOpen: true, type: 'case', mode: 'add', data: null })} className="apple-button-primary flex items-center justify-center gap-2 px-6 py-3 rounded-2xl">
                <Plus className="w-5 h-5" /> {currentLanguage === 'tr' ? 'Dava Ekle' : 'Add Case'}
              </button>
            </div>

            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <SortHeader label="No" sortKey="no" currentSort={sortConfig} onSort={handleSort} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Başlık' : 'Title'} sortKey="title" currentSort={sortConfig} onSort={handleSort} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Mahkeme' : 'court'} sortKey="court" currentSort={sortConfig} onSort={handleSort} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Duruşma' : 'Hearing'} sortKey="nextHearing" currentSort={sortConfig} onSort={handleSort} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Tutar' : 'Amount'} sortKey="amount" currentSort={sortConfig} onSort={handleSort} />
                      <SortHeader label={t.status} sortKey="status" currentSort={sortConfig} onSort={handleSort} />
                      <th className="py-4 px-6 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {getSortedData(cases.filter(c => 
                      (casesFilter === 'Tümü' || c.status === casesFilter) &&
                      c.title.toLowerCase().includes(searchQuery.toLowerCase())
                    )).map((item: LegalCase) => (
                      <tr key={item.id} className="hover:bg-gray-50 transition-colors group">
                        <td className="py-4 px-6 font-mono text-xs text-gray-500">{item.no}</td>
                        <td className="py-4 px-6">
                          <p className="font-bold text-[#1D1D1F]">{item.title}</p>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wider">{item.type}</p>
                        </td>
                        <td className="py-4 px-6 text-gray-600">{item.court}</td>
                        <td className="py-4 px-6 text-gray-600">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-gray-400"/>
                            {item.nextHearing || '—'}
                          </div>
                        </td>
                        <td className="py-4 px-6 text-right font-bold text-[#ff4000]">{item.amount.toLocaleString('tr-TR')} ₺</td>
                        <td className="py-4 px-6 text-center">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold ${
                            item.status === 'Devam Ediyor' ? 'bg-blue-100 text-blue-700' :
                            item.status === 'Kazanılan' ? 'bg-green-100 text-green-700' :
                            item.status === 'Kaybedilen' ? 'bg-red-100 text-red-700' :
                            'bg-orange-100 text-orange-700'
                          }`}>{item.status}</span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setModalConfig({ isOpen: true, type: 'case', mode: 'view', data: item })} className="p-2 hover:bg-blue-50 text-blue-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'İncele' : 'View'}><Eye className="w-4 h-4" /></button>
                            <button onClick={() => setModalConfig({ isOpen: true, type: 'case', mode: 'edit', data: item })} className="p-2 hover:bg-gray-100 text-gray-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => handleDelete(item.id, 'case')} className="p-2 hover:bg-red-50 text-red-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* COMPLIANCE TAB */}
        {activeTab === 'compliance' && (
          <motion.div key="compliance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input 
                  type="text" 
                  placeholder={currentLanguage === 'tr' ? 'Uyum maddesi ara...' : 'Search compliance items...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm focus:border-[#ff4000] outline-none transition-all shadow-sm"
                />
              </div>
              <button onClick={() => setModalConfig({ isOpen: true, type: 'compliance', mode: 'add', data: null })} className="apple-button-primary flex items-center justify-center gap-2 px-6 py-3 rounded-2xl">
                <Plus className="w-5 h-5" /> {currentLanguage === 'tr' ? 'Yeni Ekle' : 'Add New'}
              </button>
            </div>

            <div className="flex gap-2">
              {['Tümü', 'Uyumlu', 'Uyumsuz', 'İncelemede'].map(f => (
                <button key={f} onClick={() => { setComplianceFilter(f as 'Tümü' | 'Uyumlu' | 'Uyumsuz' | 'İncelemede'); setSearchQuery(''); }} className={`px-4 py-2 rounded-full text-xs font-bold ${complianceFilter === f ? 'bg-[#ff4000] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{f}</button>
              ))}
            </div>

            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <SortHeader label={currentLanguage === 'tr' ? 'Başlık' : 'Title'} sortKey="title" currentSort={sortConfig} onSort={handleSort} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Sorumlu' : 'Responsible'} sortKey="responsible" currentSort={sortConfig} onSort={handleSort} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Tarih' : 'Date'} sortKey="nextDate" currentSort={sortConfig} onSort={handleSort} />
                      <SortHeader label={t.status} sortKey="status" currentSort={sortConfig} onSort={handleSort} />
                      <th className="py-4 px-6 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {getSortedData(compliance.filter(c => (complianceFilter === 'Tümü' || c.status === complianceFilter) && c.title.toLowerCase().includes(searchQuery.toLowerCase()))).map((item: ComplianceItem) => (
                      <tr key={item.id} className="hover:bg-gray-50 transition-colors group">
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-[#1D1D1F]">{item.title}</p>
                            {item.isCritical && <span className="text-[9px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded uppercase">Kritik</span>}
                          </div>
                          <p className="text-[11px] text-gray-400 italic truncate max-w-xs">{item.description}</p>
                        </td>
                        <td className="py-4 px-6 text-gray-600 font-medium">{item.responsible}</td>
                        <td className="py-4 px-6 text-gray-600">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-gray-400"/>
                            {item.nextDate}
                          </div>
                        </td>
                        <td className="py-4 px-6 text-center">
                          <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold ${
                            item.status === 'Uyumlu' ? 'bg-green-100 text-green-700' :
                            item.status === 'Uyumsuz' ? 'bg-red-100 text-red-700' :
                            item.status === 'İncelemede' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {item.status === 'Uyumlu' && <CheckCircle2 className="w-3 h-3" />}
                            {item.status === 'Uyumsuz' && <AlertTriangle className="w-3 h-3" />}
                            {item.status === 'İncelemede' && <Clock className="w-3 h-3" />}
                            {item.status}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setModalConfig({ isOpen: true, type: 'compliance', mode: 'view', data: item })} className="p-2 hover:bg-blue-50 text-blue-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'İncele' : 'View'}><Eye className="w-4 h-4" /></button>
                            <button onClick={() => setModalConfig({ isOpen: true, type: 'compliance', mode: 'edit', data: item })} className="p-2 hover:bg-gray-100 text-gray-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => handleDelete(item.id, 'compliance')} className="p-2 hover:bg-red-50 text-red-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* DOCUMENTS TAB */}
        {activeTab === 'documents' && (
          <motion.div key="documents" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="bg-white rounded-3xl p-12 border border-gray-100 shadow-sm">
            <div className="text-center max-w-lg mx-auto mb-12">
              <div className="w-24 h-24 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <Folder className="w-12 h-12 text-gray-300" />
              </div>
              <h3 className="text-2xl font-bold text-[#1D1D1F] mb-3">{currentLanguage === 'tr' ? 'Belge Yönetimi' : 'Document Management'}</h3>
              <p className="text-[#86868B] mb-8">{currentLanguage === 'tr' ? 'Sözleşme ve hukuki belgelerinizi buradan yönetin.' : 'Manage your contracts and legal documents here.'}</p>
              <div className="flex justify-center gap-3">
                <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                <button onClick={() => fileInputRef.current?.click()} className="apple-button-primary flex items-center gap-2 px-6 py-3">
                  <Plus className="w-5 h-5" /> {currentLanguage === 'tr' ? 'Belge Yükle' : 'Upload Document'}
                </button>
                <button onClick={() => showToast(currentLanguage === 'tr' ? 'İndirme başlatıldı.' : 'Download started.')} className="apple-button-secondary flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 text-gray-700">
                  <Download className="w-5 h-5" /> {currentLanguage === 'tr' ? 'İndir' : 'Download'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <button onClick={() => setModalConfig({ isOpen: true, type: 'documents', mode: 'view', data: 'Sözleşme Şablonları' })} className="bg-gray-50 rounded-3xl p-8 text-center hover:bg-gray-100 transition-colors cursor-pointer w-full">
                <FileText className="w-8 h-8 text-gray-400 mx-auto mb-4" />
                <h4 className="font-bold text-[#1D1D1F] mb-1">{currentLanguage === 'tr' ? 'Sözleşme Şablonları' : 'Contract Templates'}</h4>
                <p className="text-sm text-gray-500">5 {currentLanguage === 'tr' ? 'dosya' : 'files'}</p>
              </button>
              <button onClick={() => setModalConfig({ isOpen: true, type: 'documents', mode: 'view', data: 'Hukuki Yazışmalar' })} className="bg-gray-50 rounded-3xl p-8 text-center hover:bg-gray-100 transition-colors cursor-pointer w-full">
                <Eye className="w-8 h-8 text-gray-400 mx-auto mb-4" />
                <h4 className="font-bold text-[#1D1D1F] mb-1">{currentLanguage === 'tr' ? 'Hukuki Yazışmalar' : 'Legal Correspondence'}</h4>
                <p className="text-sm text-gray-500">12 {currentLanguage === 'tr' ? 'dosya' : 'files'}</p>
              </button>
              <button onClick={() => setModalConfig({ isOpen: true, type: 'documents', mode: 'view', data: 'Mahkeme Belgeleri' })} className="bg-gray-50 rounded-3xl p-8 text-center hover:bg-gray-100 transition-colors cursor-pointer w-full">
                <Scale className="w-8 h-8 text-gray-400 mx-auto mb-4" />
                <h4 className="font-bold text-[#1D1D1F] mb-1">{currentLanguage === 'tr' ? 'Mahkeme Belgeleri' : 'Court Documents'}</h4>
                <p className="text-sm text-gray-500">8 {currentLanguage === 'tr' ? 'dosya' : 'files'}</p>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODALS */}
      <AnimatePresence>
        {modalConfig.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModalConfig({ isOpen: false, type: null, mode: 'add', data: null })} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xl font-bold text-[#1D1D1F]">
                  {modalConfig.data ? (currentLanguage === 'tr' ? 'Düzenle' : 'Edit') : (currentLanguage === 'tr' ? 'Yeni Ekle' : 'Add New')}
                </h3>
                <button onClick={() => setModalConfig({ isOpen: false, type: null, mode: 'add', data: null })} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              
              <form onSubmit={handleSaveModal} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                {modalConfig.type === 'contract' && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">No</label>
                        <input name="no" defaultValue={(modalConfig.data as Contract)?.no || ''} required className="apple-input w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Tür' : 'Type'}</label>
                        <input name="type" defaultValue={(modalConfig.data as Contract)?.type || ''} required className="apple-input w-full" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Başlık' : 'Title'}</label>
                      <input name="title" defaultValue={(modalConfig.data as Contract)?.title || ''} required className="apple-input w-full" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Taraf' : 'Party'}</label>
                      <input name="party" defaultValue={(modalConfig.data as Contract)?.party || ''} required className="apple-input w-full" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Başlangıç' : 'Start Date'}</label>
                        <input type="date" name="startDate" defaultValue={(modalConfig.data as Contract)?.startDate || ''} required className="apple-input w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Bitiş' : 'End Date'}</label>
                        <input type="date" name="endDate" defaultValue={(modalConfig.data as Contract)?.endDate || ''} required className="apple-input w-full" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-2">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Değer' : 'Value'}</label>
                        <input type="number" name="value" defaultValue={(modalConfig.data as Contract)?.value || ''} required className="apple-input w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Para Birimi' : 'Currency'}</label>
                        <select name="currency" defaultValue={(modalConfig.data as Contract)?.currency || 'TRY'} className="apple-input w-full">
                          <option value="TRY">TRY</option>
                          <option value="USD">USD</option>
                          <option value="EUR">EUR</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</label>
                      <select name="status" defaultValue={(modalConfig.data as Contract)?.status || 'Aktif'} className="apple-input w-full">
                        <option value="Aktif">{currentLanguage === 'tr' ? 'Aktif' : 'Active'}</option>
                        <option value="Yenileme Bekliyor">{currentLanguage === 'tr' ? 'Yenileme Bekliyor' : 'Renewal Pending'}</option>
                        <option value="Süresi Dolan">{currentLanguage === 'tr' ? 'Süresi Dolan' : 'Expired'}</option>
                        <option value="Taslak">{currentLanguage === 'tr' ? 'Taslak' : 'Draft'}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Sözleşme Dosyası (PDF)' : 'Contract File (PDF)'}</label>
                      <input type="file" accept=".pdf" onChange={handleFileUpload} className="apple-input w-full" />
                    </div>
                  </>
                )}

                {modalConfig.type === 'case' && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">No</label>
                        <input name="no" defaultValue={(modalConfig.data as LegalCase)?.no || ''} required className="apple-input w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Tür' : 'Type'}</label>
                        <select name="type" defaultValue={(modalConfig.data as LegalCase)?.type || 'İcra'} className="apple-input w-full">
                          <option value="İcra">{currentLanguage === 'tr' ? 'İcra' : 'Execution'}</option>
                          <option value="Ceza">{currentLanguage === 'tr' ? 'Ceza' : 'Criminal'}</option>
                          <option value="Hukuk">{currentLanguage === 'tr' ? 'Hukuk' : 'Civil'}</option>
                          <option value="İdare">{currentLanguage === 'tr' ? 'İdare' : 'Administrative'}</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Başlık' : 'Title'}</label>
                      <input name="title" defaultValue={(modalConfig.data as LegalCase)?.title || ''} required className="apple-input w-full" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Mahkeme' : 'Court'}</label>
                      <select name="court" defaultValue={(modalConfig.data as LegalCase)?.court || 'Asliye Hukuk'} className="apple-input w-full">
                        <option value="Asliye Hukuk">{currentLanguage === 'tr' ? 'Asliye Hukuk' : 'District Civil Court'}</option>
                        <option value="Sulh Hukuk">{currentLanguage === 'tr' ? 'Sulh Hukuk' : 'Conciliation Court'}</option>
                        <option value="İcra Mahkemesi">{currentLanguage === 'tr' ? 'İcra Mahkemesi' : 'Execution Court'}</option>
                        <option value="Ceza Mahkemesi">{currentLanguage === 'tr' ? 'Ceza Mahkemesi' : 'Criminal Court'}</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Davacı' : 'Plaintiff'}</label>
                        <input name="plaintiff" defaultValue={(modalConfig.data as LegalCase)?.plaintiff || ''} required className="apple-input w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Davalı' : 'Defendant'}</label>
                        <input name="defendant" defaultValue={(modalConfig.data as LegalCase)?.defendant || ''} required className="apple-input w-full" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Avukat' : 'Lawyer'}</label>
                        <input name="lawyer" defaultValue={(modalConfig.data as LegalCase)?.lawyer || ''} required className="apple-input w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Sonraki Duruşma' : 'Next Hearing'}</label>
                        <input type="date" name="nextHearing" defaultValue={(modalConfig.data as LegalCase)?.nextHearing || ''} className="apple-input w-full" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Tutar' : 'Amount'}</label>
                        <input type="number" name="amount" defaultValue={(modalConfig.data as LegalCase)?.amount || ''} required className="apple-input w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</label>
                        <select name="status" defaultValue={(modalConfig.data as LegalCase)?.status || 'Devam Ediyor'} className="apple-input w-full">
                          <option value="Devam Ediyor">{currentLanguage === 'tr' ? 'Devam Ediyor' : 'Ongoing'}</option>
                          <option value="Kazanılan">{currentLanguage === 'tr' ? 'Kazanılan' : 'Won'}</option>
                          <option value="Kaybedilen">{currentLanguage === 'tr' ? 'Kaybedilen' : 'Lost'}</option>
                          <option value="Temyiz">{currentLanguage === 'tr' ? 'Temyiz' : 'Appeal'}</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Açıklama' : 'Description'}</label>
                      <textarea name="description" defaultValue={(modalConfig.data as LegalCase)?.description || ''} rows={3} className="apple-input w-full resize-none" />
                    </div>
                  </>
                )}

                {modalConfig.type === 'documents' && (
                  <div className="space-y-4">
                    <h4 className="font-bold text-[#1D1D1F] flex items-center gap-2">
                      <Folder className="w-4 h-4 text-gray-400" />
                      {typeof modalConfig.data === 'string' ? modalConfig.data : ''}
                    </h4>
                    <ul className="space-y-2">
                      {(
                        modalConfig.data === 'Sözleşme Şablonları' ? [
                          'Genel Satış Sözleşmesi.pdf',
                          'Gizlilik Sözleşmesi (NDA).pdf',
                          'Hizmet Alım Sözleşmesi.docx',
                          'Bayilik Sözleşmesi.pdf',
                          'Kira Sözleşmesi Örneği.pdf'
                        ] : modalConfig.data === 'Hukuki Yazışmalar' ? [
                          'İhtarname Örneği - Ödeme Gecikmesi.pdf',
                          'KVKK Aydınlatma Metni.pdf',
                          'Muva faka fername.docx',
                          'İstifa Dilekçesi Örneği.pdf'
                        ] : modalConfig.data === 'Mahkeme Belgeleri' ? [
                          'Dava Dilekçesi Taslağı.pdf',
                          'Cevap Dilekçesi.docx',
                          'Bilirkişi Raporu İtiraz.pdf',
                          'Vekaletname Örneği.pdf'
                        ] : ['Dosya 1.pdf', 'Dosya 2.docx', 'Dosya 3.xlsx']
                      ).map((file, i) => (
                        <li key={i} className="flex items-center justify-between p-4 bg-gray-50 hover:bg-white hover:shadow-md transition-all rounded-2xl border border-transparent hover:border-brand/10 text-sm group/file">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-white border border-gray-100 flex items-center justify-center shadow-sm">
                              {file.endsWith('.pdf') ? <FileText className="w-5 h-5 text-red-500" /> : <ShieldCheck className="w-5 h-5 text-blue-500" />}
                            </div>
                            <div>
                                <p className="font-bold text-gray-800">{file}</p>
                                <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">{file.split('.').pop()} Document</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                             <button 
                               type="button" 
                               onClick={() => {
                                  showToast(currentLanguage === 'tr' ? 'Belge yükleniyor...' : 'Loading document...');
                                  setTimeout(() => {
                                    const win = window.open('', '_blank');
                                    win?.document.write(`<html><head><title>${file}</title></head><body style="margin:0;display:flex;align-items:center;justify-center;background:#525659;"><iframe src="https://mozilla.github.io/pdf.js/web/viewer.html?file=https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/examples/learning/helloworld.pdf" width="100%" height="100%" style="border:none"></iframe></body></html>`);
                                  }, 500);
                                }} 
                               className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 font-bold text-[11px] hover:bg-blue-100 transition-colors"
                             >
                               {currentLanguage === 'tr' ? 'Görüntüle' : 'View'}
                             </button>
                             <button 
                               type="button" 
                               onClick={() => {
                                 showToast(currentLanguage === 'tr' ? 'İndirme başlatıldı: ' + file : 'Download started: ' + file);
                                 const link = document.createElement('a');
                                 link.href = '#';
                                 link.setAttribute('download', file);
                                 link.click();
                               }}
                               className="px-3 py-1.5 rounded-lg bg-[#ff4000]/10 text-[#ff4000] font-bold text-[11px] hover:bg-[#ff4000]/20 transition-colors"
                             >
                               {currentLanguage === 'tr' ? 'İndir' : 'Download'}
                             </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {modalConfig.type === 'compliance' && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Başlık' : 'Title'}</label>
                      <input name="title" defaultValue={(modalConfig.data as ComplianceItem)?.title || ''} required className="apple-input w-full" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Sorumlu' : 'Responsible'}</label>
                        <input name="responsible" defaultValue={(modalConfig.data as ComplianceItem)?.responsible || ''} required className="apple-input w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Sonraki Tarih' : 'Next Date'}</label>
                        <input type="date" name="nextDate" defaultValue={(modalConfig.data as ComplianceItem)?.nextDate || ''} required className="apple-input w-full" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Kritik mi?' : 'Is Critical?'}</label>
                        <select name="isCritical" defaultValue={(modalConfig.data as ComplianceItem)?.isCritical ? 'true' : 'false'} className="apple-input w-full">
                          <option value="true">{currentLanguage === 'tr' ? 'Evet' : 'Yes'}</option>
                          <option value="false">{currentLanguage === 'tr' ? 'Hayır' : 'No'}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</label>
                        <select name="status" defaultValue={(modalConfig.data as ComplianceItem)?.status || 'Uyumlu'} className="apple-input w-full">
                          <option value="Uyumlu">{currentLanguage === 'tr' ? 'Uyumlu' : 'Compliant'}</option>
                          <option value="Uyumsuz">{currentLanguage === 'tr' ? 'Uyumsuz' : 'Non-Compliant'}</option>
                          <option value="İncelemede">{currentLanguage === 'tr' ? 'İncelemede' : 'Under Review'}</option>
                          <option value="Planlı">{currentLanguage === 'tr' ? 'Planlı' : 'Planned'}</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Açıklama' : 'Description'}</label>
                      <textarea name="description" defaultValue={(modalConfig.data as ComplianceItem)?.description || ''} rows={3} className="apple-input w-full resize-none" />
                    </div>
                  </>
                )}

                <div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
                  <button type="button" onClick={() => setModalConfig({ isOpen: false, type: null, mode: 'add', data: null })} className="px-6 py-2.5 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                    {currentLanguage === 'tr' ? 'İptal' : 'Cancel'}
                  </button>
                  <button type="submit" className="apple-button-primary px-8 py-2.5">
                    {currentLanguage === 'tr' ? 'Kaydet' : 'Save'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* TOAST */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-6 right-6 z-[200] flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl text-sm font-bold text-white ${
              toast.type === 'success' ? 'bg-green-600' : toast.type === 'error' ? 'bg-red-600' : 'bg-blue-600'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={currentLanguage === 'tr' ? 'Sil' : 'Delete'}
        cancelText={currentLanguage === 'tr' ? 'Vazgeç' : 'Cancel'}
      />
    </div>
  );
};

export default LegalModule;
