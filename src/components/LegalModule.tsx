import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Scale, FileText, ShieldCheck, Plus, Search, Trash2, Edit2,
  AlertTriangle, CheckCircle2, Clock, Calendar, ChevronRight, Download, Folder, X, Eye, TrendingUp,
  Upload, ThumbsUp, ThumbsDown, Send, Paperclip, CheckSquare
} from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { db, auth, storage } from '../firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, where
} from '../lib/dbClient';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { logFirestoreError, OperationType } from '../utils/firebase';
import {
  type Contract,
  type LegalCase,
  type ComplianceItem,
  type LegalDoc,
  type ApprovalRequest
} from '../types';
import { cn } from '../lib/utils';
import { sortByCreatedAt, byField } from '../utils/fsSort';

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
  const [activeTab, setActiveTab] = useState<'contracts' | 'cases' | 'compliance' | 'documents' | 'approvals'>('contracts');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [compliance, setCompliance] = useState<ComplianceItem[]>([]);
  const [legalDocs, setLegalDocs] = useState<LegalDoc[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [contractsFilter, setContractsFilter] = useState<'Tümü' | 'Aktif' | 'Yenileme Bekliyor' | 'Süresi Dolan' | 'Taslak'>('Tümü');
  const [casesFilter, setCasesFilter] = useState<'Tümü' | 'Devam Ediyor' | 'Kazanılan' | 'Kaybedilen' | 'Temyiz'>('Tümü');
  const [complianceFilter, setComplianceFilter] = useState<'Tümü' | 'Uyumlu' | 'Uyumsuz' | 'İncelemede'>('Tümü');
  const [approvalsFilter, setApprovalsFilter] = useState<'Tümü' | 'Bekliyor' | 'Onaylandı' | 'Reddedildi' | 'İncelemede'>('Tümü');
  const [docsFilter, setDocsFilter] = useState<string>('Tümü');
  const [docUploadCategory, setDocUploadCategory] = useState<string>('Diğer');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docUploadRef = useRef<HTMLInputElement>(null);
  const approvalUploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Approval form state
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [approvalForm, setApprovalForm] = useState({
    title: '', description: '', category: 'Belge' as ApprovalRequest['category'],
    urgency: 'Orta' as ApprovalRequest['urgency'], requestedBy: ''
  });
  const [approvalFile, setApprovalFile] = useState<File | null>(null);
  const [approvalNoteMap, setApprovalNoteMap] = useState<Record<string, string>>({});

  // Sorting States
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>, category: string) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    setUploading(true);
    try {
      const storageRef = ref(storage, `legal-docs/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await addDoc(collection(db, 'legalDocs'), {
        title: file.name, type: category, date: new Date().toISOString().split('T')[0],
        status: 'Aktif', fileUrl: url, fileName: file.name, fileSize: file.size,
        uploadedBy: auth.currentUser?.email || 'unknown', createdAt: serverTimestamp()
      });
      showToast(currentLanguage === 'tr' ? `"${file.name}" yüklendi` : `"${file.name}" uploaded`);
    } catch (err) {
      logFirestoreError(err, OperationType.CREATE, 'legalDocs', auth.currentUser?.uid);
      showToast(currentLanguage === 'tr' ? 'Yükleme başarısız' : 'Upload failed', 'error');
    } finally { setUploading(false); if (e.target) e.target.value = ''; }
  };

  const handleApprovalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setApprovalFile(e.target.files[0]);
  };

  const handleSubmitApproval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvalForm.title || !approvalForm.requestedBy) return;
    setUploading(true);
    try {
      let fileUrl: string | undefined;
      let fileName: string | undefined;
      let fileSize: number | undefined;
      if (approvalFile) {
        const storageRef = ref(storage, `approval-docs/${Date.now()}_${approvalFile.name}`);
        await uploadBytes(storageRef, approvalFile);
        fileUrl = await getDownloadURL(storageRef);
        fileName = approvalFile.name;
        fileSize = approvalFile.size;
      }
      await addDoc(collection(db, 'approvalRequests'), {
        ...approvalForm, status: 'Bekliyor',
        fileUrl, fileName, fileSize, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      showToast(currentLanguage === 'tr' ? 'Onay talebi oluşturuldu' : 'Approval request submitted');
      setApprovalForm({ title: '', description: '', category: 'Belge', urgency: 'Orta', requestedBy: '' });
      setApprovalFile(null);
      setShowApprovalForm(false);
    } catch (err) {
      logFirestoreError(err, OperationType.CREATE, 'approvalRequests', auth.currentUser?.uid);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu' : 'Error occurred', 'error');
    } finally { setUploading(false); }
  };

  const handleApprovalAction = async (id: string, action: 'Onaylandı' | 'Reddedildi' | 'İncelemede') => {
    try {
      const note = approvalNoteMap[id] || '';
      await updateDoc(doc(db, 'approvalRequests', id), {
        status: action, approvedBy: auth.currentUser?.email || 'unknown',
        approvalNote: note, updatedAt: serverTimestamp()
      });
      showToast(
        action === 'Onaylandı'
          ? (currentLanguage === 'tr' ? 'Talep onaylandı' : 'Request approved')
          : action === 'Reddedildi'
          ? (currentLanguage === 'tr' ? 'Talep reddedildi' : 'Request rejected')
          : (currentLanguage === 'tr' ? 'İncelemeye alındı' : 'Under review'),
        action === 'Onaylandı' ? 'success' : action === 'Reddedildi' ? 'error' : 'info'
      );
      setApprovalNoteMap(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch (err) {
      logFirestoreError(err, OperationType.UPDATE, `approvalRequests/${id}`, auth.currentUser?.uid);
    }
  };

  const handleDeleteDoc = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: currentLanguage === 'tr' ? 'Belgeyi Sil' : 'Delete Document',
      message: currentLanguage === 'tr' ? 'Bu belgeyi kalıcı olarak silmek istediğinize emin misiniz?' : 'Are you sure you want to permanently delete this document?',
      onConfirm: async () => {
        try { await deleteDoc(doc(db, 'legalDocs', id)); showToast(currentLanguage === 'tr' ? 'Belge silindi' : 'Document deleted'); }
        catch (err) { logFirestoreError(err, OperationType.DELETE, `legalDocs/${id}`, auth.currentUser?.uid); }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleDocUpload(e, docUploadCategory);
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
      unsubs.push(onSnapshot(query(collection(db, 'contracts')), (snap) => {
        setContracts(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as Contract))).sort(byField('no','asc')));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'contracts', auth.currentUser?.uid)));
    }, 0);
    const t2 = setTimeout(() => {
      unsubs.push(onSnapshot(query(collection(db, 'legalCases')), (snap) => {
        setCases(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as LegalCase))).sort(byField('no','asc')));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'legalCases', auth.currentUser?.uid)));
    }, 150);
    const t3 = setTimeout(() => {
      unsubs.push(onSnapshot(query(collection(db, 'complianceItems')), (snap) => {
        setCompliance(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as ComplianceItem))).sort(byField('title','asc')));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'complianceItems', auth.currentUser?.uid)));
    }, 300);

    const t4 = setTimeout(() => {
      unsubs.push(onSnapshot(query(collection(db, 'legalDocs')), (snap) => {
        setLegalDocs(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as LegalDoc))));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'legalDocs', auth.currentUser?.uid)));
    }, 450);
    const t5 = setTimeout(() => {
      unsubs.push(onSnapshot(query(collection(db, 'approvalRequests')), (snap) => {
        setApprovals(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as ApprovalRequest))));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'approvalRequests', auth.currentUser?.uid)));
    }, 600);

    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5);
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
          { id: 'documents', label: t.documents, icon: Folder, count: legalDocs.length },
          { id: 'approvals', label: currentLanguage === 'tr' ? 'Onaylar' : 'Approvals', icon: CheckSquare, count: approvals.filter(a => a.status === 'Bekliyor').length },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'contracts' | 'cases' | 'compliance' | 'documents' | 'approvals')}
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
          <motion.div key="documents" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {/* Upload Controls */}
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
              <div className="flex flex-wrap gap-2">
                {['Tümü', 'Sözleşme Şablonları', 'Hukuki Yazışmalar', 'Mahkeme Belgeleri', 'Diğer'].map(cat => (
                  <button key={cat} onClick={() => setDocsFilter(cat)} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${docsFilter === cat ? 'bg-[#ff4000] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{cat}</button>
                ))}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select value={docUploadCategory} onChange={e => setDocUploadCategory(e.target.value)} className="apple-input text-sm py-2 px-3 rounded-xl">
                  <option value="Sözleşme Şablonları">{currentLanguage === 'tr' ? 'Sözleşme Şablonları' : 'Contract Templates'}</option>
                  <option value="Hukuki Yazışmalar">{currentLanguage === 'tr' ? 'Hukuki Yazışmalar' : 'Legal Correspondence'}</option>
                  <option value="Mahkeme Belgeleri">{currentLanguage === 'tr' ? 'Mahkeme Belgeleri' : 'Court Documents'}</option>
                  <option value="Diğer">{currentLanguage === 'tr' ? 'Diğer' : 'Other'}</option>
                </select>
                <input type="file" ref={docUploadRef} className="hidden" onChange={e => handleDocUpload(e, docUploadCategory)} />
                <button onClick={() => docUploadRef.current?.click()} disabled={uploading} className="apple-button-primary flex items-center gap-2 px-5 py-2.5 disabled:opacity-60">
                  <Upload className="w-4 h-4" />
                  {uploading ? (currentLanguage === 'tr' ? 'Yükleniyor...' : 'Uploading...') : (currentLanguage === 'tr' ? 'Belge Yükle' : 'Upload')}
                </button>
              </div>
            </div>

            {/* Document List */}
            {legalDocs.filter(d => docsFilter === 'Tümü' || d.type === docsFilter).length === 0 ? (
              <div className="apple-card p-16 text-center">
                <div className="w-20 h-20 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-5">
                  <Folder className="w-10 h-10 text-gray-300" />
                </div>
                <p className="font-bold text-[#1D1D1F] mb-1">{currentLanguage === 'tr' ? 'Belge bulunamadı' : 'No documents found'}</p>
                <p className="text-sm text-gray-400">{currentLanguage === 'tr' ? 'Yeni belge yüklemek için kategori seçip butona tıklayın.' : 'Select a category and click Upload to add documents.'}</p>
              </div>
            ) : (
              <div className="apple-card overflow-hidden">
                <div className="divide-y divide-gray-50">
                  {legalDocs.filter(d => docsFilter === 'Tümü' || d.type === docsFilter).map((document) => (
                    <div key={document.id} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors group">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5 text-red-500" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-[#1D1D1F] text-sm truncate">{document.title}</p>
                          <p className="text-[11px] text-gray-400">
                            {document.type} · {document.date}
                            {document.fileSize ? ` · ${(document.fileSize / 1024).toFixed(0)} KB` : ''}
                            {document.uploadedBy ? ` · ${document.uploadedBy}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-4">
                        {document.fileUrl && (
                          <a href={document.fileUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 font-bold text-[11px] hover:bg-blue-100 transition-colors">
                            {currentLanguage === 'tr' ? 'Görüntüle' : 'View'}
                          </a>
                        )}
                        {document.fileUrl && (
                          <a href={document.fileUrl} download={document.fileName || document.title} className="px-3 py-1.5 rounded-lg bg-[#ff4000]/10 text-[#ff4000] font-bold text-[11px] hover:bg-[#ff4000]/20 transition-colors">
                            {currentLanguage === 'tr' ? 'İndir' : 'Download'}
                          </a>
                        )}
                        <button onClick={() => handleDeleteDoc(document.id)} className="p-2 hover:bg-red-50 text-red-400 hover:text-red-600 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
        {/* APPROVALS TAB */}
        {activeTab === 'approvals' && (
          <motion.div key="approvals" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {([
                { label: currentLanguage === 'tr' ? 'Bekliyor' : 'Pending', count: approvals.filter(a => a.status === 'Bekliyor').length, color: 'text-orange-600', bg: 'bg-orange-50', icon: Clock },
                { label: currentLanguage === 'tr' ? 'Onaylandı' : 'Approved', count: approvals.filter(a => a.status === 'Onaylandı').length, color: 'text-green-600', bg: 'bg-green-50', icon: CheckCircle2 },
                { label: currentLanguage === 'tr' ? 'Reddedildi' : 'Rejected', count: approvals.filter(a => a.status === 'Reddedildi').length, color: 'text-red-600', bg: 'bg-red-50', icon: ThumbsDown },
                { label: currentLanguage === 'tr' ? 'İncelemede' : 'Under Review', count: approvals.filter(a => a.status === 'İncelemede').length, color: 'text-blue-600', bg: 'bg-blue-50', icon: Eye },
              ] as const).map(kpi => (
                <div key={kpi.label} className="apple-card p-5">
                  <div className="flex justify-between items-start mb-3">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">{kpi.label}</p>
                    <div className={`w-8 h-8 rounded-xl ${kpi.bg} flex items-center justify-center`}>
                      <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                    </div>
                  </div>
                  <p className="text-3xl font-bold text-[#1D1D1F]">{kpi.count}</p>
                </div>
              ))}
            </div>

            {/* Filter + New Request */}
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
              <div className="flex flex-wrap gap-2">
                {(['Tümü', 'Bekliyor', 'İncelemede', 'Onaylandı', 'Reddedildi'] as const).map(f => (
                  <button key={f} onClick={() => setApprovalsFilter(f)} className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${approvalsFilter === f ? 'bg-[#ff4000] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{f}</button>
                ))}
              </div>
              <button onClick={() => setShowApprovalForm(v => !v)} className="apple-button-primary flex items-center gap-2 px-5 py-2.5">
                <Plus className="w-4 h-4" /> {currentLanguage === 'tr' ? 'Yeni Talep' : 'New Request'}
              </button>
            </div>

            {/* New Approval Form */}
            {showApprovalForm && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="apple-card p-6">
                <h3 className="text-base font-bold text-[#1D1D1F] mb-5 flex items-center gap-2">
                  <Send className="w-4 h-4 text-[#ff4000]" />
                  {currentLanguage === 'tr' ? 'Yeni Onay Talebi' : 'New Approval Request'}
                </h3>
                <form onSubmit={handleSubmitApproval} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Başlık *' : 'Title *'}</label>
                      <input value={approvalForm.title} onChange={e => setApprovalForm(p => ({ ...p, title: e.target.value }))} required className="apple-input w-full" placeholder={currentLanguage === 'tr' ? 'Talep başlığı...' : 'Request title...'} />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Talep Eden *' : 'Requested By *'}</label>
                      <input value={approvalForm.requestedBy} onChange={e => setApprovalForm(p => ({ ...p, requestedBy: e.target.value }))} required className="apple-input w-full" placeholder={currentLanguage === 'tr' ? 'Ad Soyad veya Departman...' : 'Name or Department...'} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Açıklama' : 'Description'}</label>
                    <textarea value={approvalForm.description} onChange={e => setApprovalForm(p => ({ ...p, description: e.target.value }))} rows={3} className="apple-input w-full resize-none" placeholder={currentLanguage === 'tr' ? 'Detay açıklaması...' : 'Detailed description...'} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Kategori' : 'Category'}</label>
                      <select value={approvalForm.category} onChange={e => setApprovalForm(p => ({ ...p, category: e.target.value as ApprovalRequest['category'] }))} className="apple-input w-full">
                        <option value="Sözleşme">{currentLanguage === 'tr' ? 'Sözleşme' : 'Contract'}</option>
                        <option value="Belge">{currentLanguage === 'tr' ? 'Belge' : 'Document'}</option>
                        <option value="Hukuki">{currentLanguage === 'tr' ? 'Hukuki' : 'Legal'}</option>
                        <option value="Uyum">{currentLanguage === 'tr' ? 'Uyum' : 'Compliance'}</option>
                        <option value="Diğer">{currentLanguage === 'tr' ? 'Diğer' : 'Other'}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Aciliyet' : 'Urgency'}</label>
                      <select value={approvalForm.urgency} onChange={e => setApprovalForm(p => ({ ...p, urgency: e.target.value as ApprovalRequest['urgency'] }))} className="apple-input w-full">
                        <option value="Düşük">{currentLanguage === 'tr' ? 'Düşük' : 'Low'}</option>
                        <option value="Orta">{currentLanguage === 'tr' ? 'Orta' : 'Medium'}</option>
                        <option value="Yüksek">{currentLanguage === 'tr' ? 'Yüksek' : 'High'}</option>
                        <option value="Kritik">{currentLanguage === 'tr' ? 'Kritik' : 'Critical'}</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Dosya Ekle (opsiyonel)' : 'Attach File (optional)'}</label>
                    <div className="flex items-center gap-3">
                      <input type="file" ref={approvalUploadRef} className="hidden" onChange={handleApprovalFileChange} />
                      <button type="button" onClick={() => approvalUploadRef.current?.click()} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold transition-colors">
                        <Paperclip className="w-4 h-4" />
                        {approvalFile ? approvalFile.name : (currentLanguage === 'tr' ? 'Dosya Seç' : 'Select File')}
                      </button>
                      {approvalFile && (
                        <button type="button" onClick={() => setApprovalFile(null)} className="text-gray-400 hover:text-red-500 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                    <button type="button" onClick={() => { setShowApprovalForm(false); setApprovalFile(null); }} className="px-6 py-2.5 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                      {currentLanguage === 'tr' ? 'İptal' : 'Cancel'}
                    </button>
                    <button type="submit" disabled={uploading} className="apple-button-primary px-8 py-2.5 disabled:opacity-60">
                      {uploading ? (currentLanguage === 'tr' ? 'Gönderiliyor...' : 'Sending...') : (currentLanguage === 'tr' ? 'Talep Gönder' : 'Submit Request')}
                    </button>
                  </div>
                </form>
              </motion.div>
            )}

            {/* Approval List */}
            {approvals.filter(a => approvalsFilter === 'Tümü' || a.status === approvalsFilter).length === 0 ? (
              <div className="apple-card p-16 text-center">
                <div className="w-20 h-20 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-5">
                  <CheckSquare className="w-10 h-10 text-gray-300" />
                </div>
                <p className="font-bold text-[#1D1D1F] mb-1">{currentLanguage === 'tr' ? 'Onay talebi bulunamadı' : 'No approval requests found'}</p>
                <p className="text-sm text-gray-400">{currentLanguage === 'tr' ? '"Yeni Talep" butonuyla onay süreci başlatın.' : 'Use "New Request" to start an approval flow.'}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {approvals.filter(a => approvalsFilter === 'Tümü' || a.status === approvalsFilter).map(approval => (
                  <div key={approval.id} className="apple-card p-5">
                    <div className="flex flex-col md:flex-row gap-4 justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-[#1D1D1F] text-base">{approval.title}</p>
                        {approval.description && <p className="text-sm text-gray-500 mt-0.5">{approval.description}</p>}
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <span className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full text-[11px] font-bold">{approval.category}</span>
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            approval.urgency === 'Kritik' ? 'bg-red-100 text-red-700' :
                            approval.urgency === 'Yüksek' ? 'bg-orange-100 text-orange-700' :
                            approval.urgency === 'Orta' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-green-100 text-green-700'
                          }`}>{approval.urgency}</span>
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            approval.status === 'Bekliyor' ? 'bg-orange-100 text-orange-700' :
                            approval.status === 'Onaylandı' ? 'bg-green-100 text-green-700' :
                            approval.status === 'Reddedildi' ? 'bg-red-100 text-red-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>{approval.status}</span>
                          <span className="text-[11px] text-gray-400">{currentLanguage === 'tr' ? 'Talep Eden:' : 'By:'} {approval.requestedBy}</span>
                          {approval.fileUrl && (
                            <a href={approval.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-600 rounded-full text-[11px] font-bold hover:bg-blue-100 transition-colors">
                              <Paperclip className="w-3 h-3" /> {approval.fileName || (currentLanguage === 'tr' ? 'Dosya' : 'File')}
                            </a>
                          )}
                        </div>
                        {approval.approvalNote && (
                          <p className="text-xs text-gray-500 mt-2 italic bg-gray-50 px-3 py-2 rounded-xl">
                            <span className="font-bold not-italic">{currentLanguage === 'tr' ? 'Not:' : 'Note:'}</span> {approval.approvalNote}
                            {approval.approvedBy && <span className="ml-2 text-gray-400 not-italic">— {approval.approvedBy}</span>}
                          </p>
                        )}
                      </div>
                      {(approval.status === 'Bekliyor' || approval.status === 'İncelemede') && (
                        <div className="flex flex-col gap-2 shrink-0 min-w-[220px]">
                          <input
                            type="text"
                            placeholder={currentLanguage === 'tr' ? 'Not ekle (opsiyonel)...' : 'Add note (optional)...'}
                            value={approvalNoteMap[approval.id] || ''}
                            onChange={e => setApprovalNoteMap(prev => ({ ...prev, [approval.id]: e.target.value }))}
                            className="apple-input text-sm py-2 px-3 w-full"
                          />
                          <div className="flex gap-2">
                            {approval.status === 'Bekliyor' && (
                              <button onClick={() => handleApprovalAction(approval.id, 'İncelemede')} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-blue-50 text-blue-600 text-xs font-bold hover:bg-blue-100 transition-colors">
                                <Eye className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'İncele' : 'Review'}
                              </button>
                            )}
                            <button onClick={() => handleApprovalAction(approval.id, 'Reddedildi')} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-red-50 text-red-500 text-xs font-bold hover:bg-red-100 transition-colors">
                              <ThumbsDown className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Reddet' : 'Reject'}
                            </button>
                            <button onClick={() => handleApprovalAction(approval.id, 'Onaylandı')} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-green-50 text-green-600 text-xs font-bold hover:bg-green-100 transition-colors">
                              <ThumbsUp className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Onayla' : 'Approve'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                    {(() => {
                      const category = typeof modalConfig.data === 'string' ? modalConfig.data : '';
                      const categoryDocs = legalDocs.filter(d => !category || category === 'Tümü' || d.type === category);
                      if (categoryDocs.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                            <Folder className="w-10 h-10 text-gray-200" />
                            <p className="text-sm font-semibold text-gray-400">
                              {currentLanguage === 'tr' ? 'Bu kategoride henüz belge yok.' : 'No documents in this category yet.'}
                            </p>
                            <p className="text-xs text-gray-300">
                              {currentLanguage === 'tr' ? '"Belgeler" sekmesinden yeni belge yükleyebilirsiniz.' : 'Upload documents from the "Documents" tab.'}
                            </p>
                          </div>
                        );
                      }
                      return (
                        <ul className="space-y-2">
                          {categoryDocs.map((document) => (
                            <li key={document.id} className="flex items-center justify-between p-4 bg-gray-50 hover:bg-white hover:shadow-md transition-all rounded-2xl border border-transparent hover:border-brand/10 text-sm group/file">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-white border border-gray-100 flex items-center justify-center shadow-sm">
                                  {document.fileName?.endsWith('.pdf') ? <FileText className="w-5 h-5 text-red-500" /> : <ShieldCheck className="w-5 h-5 text-blue-500" />}
                                </div>
                                <div>
                                  <p className="font-bold text-gray-800">{document.title}</p>
                                  <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">
                                    {document.fileName?.split('.').pop() ?? document.type}
                                    {document.fileSize ? ` · ${(document.fileSize / 1024).toFixed(0)} KB` : ''}
                                  </p>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                {document.fileUrl && (
                                  <a href={document.fileUrl} target="_blank" rel="noopener noreferrer"
                                    className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 font-bold text-[11px] hover:bg-blue-100 transition-colors">
                                    {currentLanguage === 'tr' ? 'Görüntüle' : 'View'}
                                  </a>
                                )}
                                {document.fileUrl && (
                                  <a href={document.fileUrl} download={document.fileName || document.title}
                                    className="px-3 py-1.5 rounded-lg bg-[#ff4000]/10 text-[#ff4000] font-bold text-[11px] hover:bg-[#ff4000]/20 transition-colors">
                                    {currentLanguage === 'tr' ? 'İndir' : 'Download'}
                                  </a>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      );
                    })()}
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
