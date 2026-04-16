import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, ClipboardCheck, AlertCircle, BarChart3, Plus, Search, 
  Trash2, Edit2, CheckCircle2, Clock, FileText, 
  TrendingUp, Target, Zap, Activity, Award, Star, Eye, X
} from 'lucide-react';
import ModuleHeader from './ModuleHeader';
import ConfirmModal from './ConfirmModal';
import { cn } from '../lib/utils';
import { suggestFMEAMitigation, suggest8DRootCause } from '../services/geminiService';
import { Loader2, Sparkles } from 'lucide-react';
import Markdown from 'react-markdown';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  BarChart, Bar 
} from 'recharts';
import { db, auth } from '../firebase';
import { 
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, 
  doc, serverTimestamp, query, orderBy 
} from 'firebase/firestore';
import { logFirestoreError, OperationType } from '../utils/firebase';

interface QCRecord {
  id: string;
  date: string;
  productName: string;
  batchNo: string;
  inspector: string;
  sampleSize: number;
  defects: number;
  defectRate: number;
  status: 'Pass' | 'Fail' | 'Conditional';
  notes?: string;
}

interface Complaint {
  id: string;
  date: string;
  customer: string;
  product: string;
  subject: string;
  severity: 'Critical' | 'Major' | 'Minor';
  status: 'Open' | 'Investigating' | 'Resolved' | 'Closed';
  rootCause?: string;
  correctiveAction?: string;
}

interface AuditItem {
  id: string;
  category: string;
  title: string;
  score: number; // 1-5
  notes?: string;
}

interface FMEARecord {
  id: string;
  process: string;
  failureMode: string;
  rpn: number;
}

interface PFMEARecord {
  id: string;
  process: string;
  failureMode: string;
  rpn: number;
}

interface CTPATRecord {
  id: string;
  point: string;
  status: 'Uyumlu' | 'Uyumsuz' | 'İnceleniyor';
}

interface KaizenRecord {
  id: string;
  problem: string;
  responsible: string;
  status: 'Devam Ediyor' | 'Tamamlandı';
  savings?: number;
}

interface FiveSRecord {
  id: string;
  area: string;
  score: number;
  inspector: string;
}

interface EightDRecord {
  id: string;
  problem: string;
  responsible: string;
  stage: string;
}

type QualityData = QCRecord | Complaint | AuditItem | FMEARecord | PFMEARecord | CTPATRecord | KaizenRecord | FiveSRecord | EightDRecord;

interface QualityModuleProps {
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
}

const QualityModule: React.FC<QualityModuleProps> = ({ currentLanguage }) => {
  const [activeTab, setActiveTab] = useState<'qc' | 'complaints' | 'audit' | 'kpi' | 'fmea' | 'pfmea' | 'ctpat' | 'kaizen' | '5s' | '8d'>('qc');
  const [qcRecords, setQcRecords] = useState<QCRecord[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

  const handleAiSuggestion = async (type: 'fmea' | '8d', data: QualityData) => {
    setIsAiLoading(true);
    setAiSuggestion(null);
    try {
      let result = '';
      if (type === 'fmea') {
        const fmea = data as FMEARecord;
        result = await suggestFMEAMitigation(fmea.failureMode, fmea.process);
      } else {
        const eightD = data as EightDRecord;
        result = await suggest8DRootCause(eightD.problem);
      }
      setAiSuggestion(result);
    } catch (error) {
      console.error(error);
      setAiSuggestion("Öneri alınamadı.");
    } finally {
      setIsAiLoading(false);
    }
  };
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  
  // New Module States
  const [fmeaRecords, setFmeaRecords] = useState<FMEARecord[]>([
    { id: '1', process: 'Montaj', failureMode: 'Vida gevşekliği', rpn: 96 },
    { id: '2', process: 'Kaynak', failureMode: 'Gözenek', rpn: 120 },
    { id: '3', process: 'Boya', failureMode: 'Akıntı', rpn: 45 }
  ]);
  const [pfmeaRecords, setPfmeaRecords] = useState<PFMEARecord[]>([
    { id: '1', process: 'Enjeksiyon', failureMode: 'Çapaklanma', rpn: 80 },
    { id: '2', process: 'Paketleme', failureMode: 'Eksik Parça', rpn: 150 }
  ]);
  const [ctpatRecords, setCtpatRecords] = useState<CTPATRecord[]>([
    { id: '1', point: 'Fiziksel Erişim', status: 'Uyumlu' },
    { id: '2', point: 'Personel Güvenliği', status: 'İnceleniyor' },
    { id: '3', point: 'Bilişim Güvenliği', status: 'Uyumsuz' }
  ]);
  const [kaizenRecords, setKaizenRecords] = useState<KaizenRecord[]>([
    { id: '1', problem: 'Yüksek enerji tüketimi', responsible: 'Ahmet Y.', status: 'Devam Ediyor', savings: 45000 },
    { id: '2', problem: 'Hurda oranının yüksekliği', responsible: 'Mehmet K.', status: 'Tamamlandı', savings: 120000 }
  ]);
  const [fiveSRecords, setFiveSRecords] = useState<FiveSRecord[]>([
    { id: '1', area: 'Üretim Hattı A', score: 4.5, inspector: 'Mehmet D.' },
    { id: '2', area: 'Depo', score: 2.5, inspector: 'Ali Y.' }
  ]);
  const [eightDRecords, setEightDRecords] = useState<EightDRecord[]>([
    { id: '1', problem: 'Hatalı sevkiyat', responsible: 'Ayşe K.', stage: 'D4 (Kök Neden)' },
    { id: '2', problem: 'Müşteri iadesi', responsible: 'Fatma S.', stage: 'D8 (Kapanış)' }
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [complaintFilter, setComplaintFilter] = useState<'All' | 'Critical' | 'Major' | 'Minor'>('All');
  const [fmeaFilter, setFmeaFilter] = useState<'All' | 'Critical' | 'Pending' | 'Low'>('All');
  const [pfmeaFilter, setPfmeaFilter] = useState<'All' | 'Critical' | 'Pending' | 'Low'>('All');
  const [ctpatFilter, setCtpatFilter] = useState<'All' | 'Compliant' | 'Non-Compliant' | 'Review'>('All');
  const [kaizenFilter, setKaizenFilter] = useState<'All' | 'In Progress' | 'Completed'>('All');
  const [fiveSFilter, setFiveSFilter] = useState<'All' | 'Low' | 'High'>('All');
  const [eightDFilter, setEightDFilter] = useState<'All' | 'Open' | 'RootCause' | 'Closed'>('All');
  
  // Sorting States
  const [qcSort, setQcSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [complaintSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [auditSort, setAuditSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'category', dir: 'asc' });
  const [fmeaSort, setFmeaSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'process', dir: 'asc' });
  const [pfmeaSort, setPfmeaSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'process', dir: 'asc' });
  const [ctpatSort, setCtpatSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'point', dir: 'asc' });
  const [kaizenSort, setKaizenSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'problem', dir: 'asc' });
  const [fiveSSort, setFiveSSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'area', dir: 'asc' });
  const [eightDSort, setEightDSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'problem', dir: 'asc' });

  // Sort Helper
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortData = <T extends Record<string, any>>(data: T[], key: string, dir: 'asc' | 'desc') => {
    return [...data].sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];
      if (aVal < bVal) return dir === 'asc' ? -1 : 1;
      if (aVal > bVal) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const toggleSort = (current: { key: string; dir: 'asc' | 'desc' }, key: string, setter: React.Dispatch<React.SetStateAction<{ key: string; dir: 'asc' | 'desc' }>>) => {
    if (current.key === key) {
      setter({ key, dir: current.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setter({ key, dir: 'asc' });
    }
  };

  const SortHeader: React.FC<{ label: string; sortKey: string; currentSort: { key: string; dir: 'asc' | 'desc' }; onSort: (key: string) => void; align?: 'left' | 'right' | 'center' }> = ({ label, sortKey, currentSort, onSort, align = 'left' }) => {
    const isActive = currentSort.key === sortKey;
    return (
      <th 
        className={cn(
          "py-3 px-6 text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none group hover:text-[#ff4000] transition-colors",
          align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
        )}
        onClick={() => onSort(sortKey)}
      >
        <div className={cn("flex items-center gap-1", align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start')}>
          {label}
          <div className="flex flex-col -space-y-1 opacity-40 group-hover:opacity-100 transition-opacity">
            <TrendingUp className={cn("w-2.5 h-2.5", isActive && currentSort.dir === 'asc' ? "text-[#ff4000] opacity-100" : "text-gray-400")} />
            <TrendingUp className={cn("w-2.5 h-2.5 rotate-180", isActive && currentSort.dir === 'desc' ? "text-[#ff4000] opacity-100" : "text-gray-400")} />
          </div>
        </div>
      </th>
    );
  };
  
  // Modal States
  const [modalConfig, setModalConfig] = useState<{ isOpen: boolean; type: 'qc' | 'complaint' | 'audit' | 'fmea' | 'pfmea' | 'ctpat' | 'kaizen' | '5s' | '8d' | null; mode: 'add' | 'edit' | 'view'; data: QualityData | null }>({
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
    const schedule = (fn: () => (() => void), delay: number) => {
      const t = setTimeout(() => unsubs.push(fn()), delay);
      return t;
    };
    const timers = [
      schedule(() => onSnapshot(query(collection(db, 'qcRecords'), orderBy('date', 'desc')), (snap) => {
        setQcRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as QCRecord)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'qcRecords', auth.currentUser?.uid)), 0),
      schedule(() => onSnapshot(query(collection(db, 'complaints'), orderBy('date', 'desc')), (snap) => {
        setComplaints(snap.docs.map(d => ({ id: d.id, ...d.data() } as Complaint)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'complaints', auth.currentUser?.uid)), 100),
      schedule(() => onSnapshot(query(collection(db, 'auditItems'), orderBy('category')), (snap) => {
        setAuditItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditItem)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'auditItems', auth.currentUser?.uid)), 200),
      schedule(() => onSnapshot(collection(db, 'fmeaRecords'), (snap) => {
        setFmeaRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as FMEARecord)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'fmeaRecords', auth.currentUser?.uid)), 300),
      schedule(() => onSnapshot(collection(db, 'pfmeaRecords'), (snap) => {
        setPfmeaRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as PFMEARecord)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'pfmeaRecords', auth.currentUser?.uid)), 400),
      schedule(() => onSnapshot(collection(db, 'ctpatRecords'), (snap) => {
        setCtpatRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as CTPATRecord)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'ctpatRecords', auth.currentUser?.uid)), 500),
      schedule(() => onSnapshot(collection(db, 'kaizenRecords'), (snap) => {
        setKaizenRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as KaizenRecord)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'kaizenRecords', auth.currentUser?.uid)), 600),
      schedule(() => onSnapshot(collection(db, 'fiveSRecords'), (snap) => {
        setFiveSRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as FiveSRecord)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'fiveSRecords', auth.currentUser?.uid)), 700),
      schedule(() => onSnapshot(collection(db, 'eightDRecords'), (snap) => {
        setEightDRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as EightDRecord)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'eightDRecords', auth.currentUser?.uid)), 800),
    ];
    return () => {
      timers.forEach(clearTimeout);
      unsubs.forEach(u => u());
    };
  }, []);

  const saveQC = async (newRecord: Partial<QCRecord>) => {
    try {
      if (modalConfig.mode === 'edit' && modalConfig.data) {
        await updateDoc(doc(db, 'qcRecords', modalConfig.data.id), newRecord);
        showToast(currentLanguage === 'tr' ? 'Kayıt güncellendi' : 'Record updated');
      } else {
        await addDoc(collection(db, 'qcRecords'), { ...newRecord, createdAt: serverTimestamp() });
        showToast(currentLanguage === 'tr' ? 'Kayıt oluşturuldu' : 'Record created');
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'qcRecords', auth.currentUser?.uid);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu' : 'Error occurred', 'error');
    }
  };

  const saveComplaints = async (newComplaint: Partial<Complaint>) => {
    try {
      if (modalConfig.mode === 'edit' && modalConfig.data) {
        await updateDoc(doc(db, 'complaints', modalConfig.data.id), newComplaint);
        showToast(currentLanguage === 'tr' ? 'Şikayet güncellendi' : 'Complaint updated');
      } else {
        await addDoc(collection(db, 'complaints'), { ...newComplaint, createdAt: serverTimestamp() });
        showToast(currentLanguage === 'tr' ? 'Şikayet oluşturuldu' : 'Complaint created');
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'complaints', auth.currentUser?.uid);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu' : 'Error occurred', 'error');
    }
  };

  const saveAuditItems = async (newItem: Partial<AuditItem>) => {
    try {
      if (modalConfig.mode === 'edit' && modalConfig.data) {
        await updateDoc(doc(db, 'auditItems', modalConfig.data.id), newItem);
        showToast(currentLanguage === 'tr' ? 'Denetim öğesi güncellendi' : 'Audit item updated');
      } else {
        await addDoc(collection(db, 'auditItems'), { ...newItem, createdAt: serverTimestamp() });
        showToast(currentLanguage === 'tr' ? 'Denetim öğesi oluşturuldu' : 'Audit item created');
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'auditItems', auth.currentUser?.uid);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu' : 'Error occurred', 'error');
    }
  };

  const saveFMEA = async (newRecord: Partial<FMEARecord>) => {
    try {
      if (modalConfig.mode === 'edit' && modalConfig.data) {
        await updateDoc(doc(db, 'fmeaRecords', modalConfig.data.id), newRecord);
      } else {
        await addDoc(collection(db, 'fmeaRecords'), { ...newRecord, createdAt: serverTimestamp() });
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'fmeaRecords', auth.currentUser?.uid);
    }
  };

  const savePFMEA = async (newRecord: Partial<PFMEARecord>) => {
    try {
      if (modalConfig.mode === 'edit' && modalConfig.data) {
        await updateDoc(doc(db, 'pfmeaRecords', modalConfig.data.id), newRecord);
      } else {
        await addDoc(collection(db, 'pfmeaRecords'), { ...newRecord, createdAt: serverTimestamp() });
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'pfmeaRecords', auth.currentUser?.uid);
    }
  };

  const saveCTPAT = async (newRecord: Partial<CTPATRecord>) => {
    try {
      if (modalConfig.mode === 'edit' && modalConfig.data) {
        await updateDoc(doc(db, 'ctpatRecords', modalConfig.data.id), newRecord);
      } else {
        await addDoc(collection(db, 'ctpatRecords'), { ...newRecord, createdAt: serverTimestamp() });
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'ctpatRecords', auth.currentUser?.uid);
    }
  };

  const saveKaizen = async (newRecord: Partial<KaizenRecord>) => {
    try {
      if (modalConfig.mode === 'edit' && modalConfig.data) {
        await updateDoc(doc(db, 'kaizenRecords', modalConfig.data.id), newRecord);
      } else {
        await addDoc(collection(db, 'kaizenRecords'), { ...newRecord, createdAt: serverTimestamp() });
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'kaizenRecords', auth.currentUser?.uid);
    }
  };

  const save5S = async (newRecord: Partial<FiveSRecord>) => {
    try {
      if (modalConfig.mode === 'edit' && modalConfig.data) {
        await updateDoc(doc(db, 'fiveSRecords', modalConfig.data.id), newRecord);
      } else {
        await addDoc(collection(db, 'fiveSRecords'), { ...newRecord, createdAt: serverTimestamp() });
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'fiveSRecords', auth.currentUser?.uid);
    }
  };

  const save8D = async (newRecord: Partial<EightDRecord>) => {
    try {
      if (modalConfig.mode === 'edit' && modalConfig.data) {
        await updateDoc(doc(db, 'eightDRecords', modalConfig.data.id), newRecord);
      } else {
        await addDoc(collection(db, 'eightDRecords'), { ...newRecord, createdAt: serverTimestamp() });
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'eightDRecords', auth.currentUser?.uid);
    }
  };

  const handleDelete = (id: string, type: 'qc' | 'complaint' | 'audit' | 'fmea' | 'pfmea' | 'ctpat' | 'kaizen' | '5s' | '8d') => {
    setConfirmModal({
      isOpen: true,
      title: currentLanguage === 'tr' ? 'Silme Onayı' : 'Delete Confirmation',
      message: currentLanguage === 'tr' ? 'Bu kaydı silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this record?',
      onConfirm: async () => {
        try {
          const col = type === 'qc' ? 'qcRecords' : 
                      type === 'complaint' ? 'complaints' : 
                      type === 'audit' ? 'auditItems' : 
                      type === 'fmea' ? 'fmeaRecords' :
                      type === 'pfmea' ? 'pfmeaRecords' :
                      type === 'ctpat' ? 'ctpatRecords' :
                      type === 'kaizen' ? 'kaizenRecords' :
                      type === '5s' ? 'fiveSRecords' : 'eightDRecords';
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
    if (modalConfig.mode === 'view') {
      setModalConfig({ isOpen: false, type: null, mode: 'add', data: null });
      return;
    }

    const formData = new FormData(e.target as HTMLFormElement);
    const data = Object.fromEntries(formData.entries());
    
    if (modalConfig.type === 'qc') {
      const sampleSize = Number(data.sampleSize);
      const defects = Number(data.defects);
      const defectRate = sampleSize > 0 ? (defects / sampleSize) * 100 : 0;
      
      const qcData = {
        ...data,
        sampleSize,
        defects,
        defectRate: Number(defectRate.toFixed(2)),
      };
      await saveQC(qcData);
    } else if (modalConfig.type === 'complaint') {
      await saveComplaints(data);
    } else if (modalConfig.type === 'audit') {
      const auditData = {
        ...data,
        score: Number(data.score)
      };
      await saveAuditItems(auditData);
    } else if (modalConfig.type === 'fmea') {
      const fmeaData = { ...data, rpn: Number(data.rpn) };
      await saveFMEA(fmeaData);
    } else if (modalConfig.type === 'pfmea') {
      const pfmeaData = { ...data, rpn: Number(data.rpn) };
      await savePFMEA(pfmeaData);
    } else if (modalConfig.type === 'ctpat') {
      await saveCTPAT(data);
    } else if (modalConfig.type === 'kaizen') {
      const kaizenData = { ...data, savings: Number(data.savings || 0) };
      await saveKaizen(kaizenData);
    } else if (modalConfig.type === '5s') {
      const fiveSData = { ...data, score: Number(data.score) };
      await save5S(fiveSData);
    } else if (modalConfig.type === '8d') {
      await save8D(data);
    }
    
    setModalConfig({ isOpen: false, type: null, mode: 'add', data: null });
  };

  const t = {
    qc: currentLanguage === 'tr' ? 'Kalite Kontrol' : 'Quality Control',
    complaints: currentLanguage === 'tr' ? 'Şikayetler' : 'Complaints',
    audit: currentLanguage === 'tr' ? 'İç Denetim' : 'Internal Audit',
    kpi: currentLanguage === 'tr' ? 'Kalite KPI' : 'Quality KPI',
    add: currentLanguage === 'tr' ? 'Yeni Ekle' : 'Add New',
    search: currentLanguage === 'tr' ? 'Ara...' : 'Search...',
    status: currentLanguage === 'tr' ? 'Durum' : 'Status',
    defectRate: currentLanguage === 'tr' ? 'Hata Oranı' : 'Defect Rate',
    pass: currentLanguage === 'tr' ? 'Uygun' : 'Pass',
    fail: currentLanguage === 'tr' ? 'Hatalı' : 'Fail',
    conditional: currentLanguage === 'tr' ? 'Şartlı Kabul' : 'Conditional',
    actions: currentLanguage === 'tr' ? 'İşlemler' : 'Actions',
  };

  const kpiData = React.useMemo(() => {
    const totalSamples = qcRecords.reduce((sum, r) => sum + r.sampleSize, 0);
    const totalDefects = qcRecords.reduce((sum, r) => sum + r.defects, 0);
    const defectRate = totalSamples > 0 ? ((totalDefects / totalSamples) * 100).toFixed(1) : '0.0';
    
    const passCount = qcRecords.filter(r => r.status === 'Pass').length;
    const firstPassYield = qcRecords.length > 0 ? ((passCount / qcRecords.length) * 100).toFixed(1) : '0.0';
    
    const complaintIndex = qcRecords.length > 0 ? (complaints.length / qcRecords.length).toFixed(1) : '0.0';

    // Trend data (mocked dynamically based on qcRecords)
    const trendData = qcRecords.reduce((acc: Record<string, { samples: number, defects: number }>, r) => {
      const month = r.date.substring(5, 7); // YYYY-MM-DD -> MM
      const monthName = new Date(2000, parseInt(month) - 1).toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
      if (!acc[monthName]) acc[monthName] = { samples: 0, defects: 0 };
      acc[monthName].samples += r.sampleSize;
      acc[monthName].defects += r.defects;
      return acc;
    }, {});

    const defectTrendChart = Object.entries(trendData).map(([name, data]) => ({
      name,
      value: data.samples > 0 ? Number(((data.defects / data.samples) * 100).toFixed(1)) : 0
    }));

    // Category pass rate (using productName as category)
    const categoryData = qcRecords.reduce((acc: Record<string, { total: number, pass: number }>, r) => {
      const cat = r.productName.split(' ')[0] || 'Other';
      if (!acc[cat]) acc[cat] = { total: 0, pass: 0 };
      acc[cat].total += 1;
      if (r.status === 'Pass') acc[cat].pass += 1;
      return acc;
    }, {});

    const categoryChart = Object.entries(categoryData).map(([name, data]) => ({
      name,
      value: data.total > 0 ? Number(((data.pass / data.total) * 100).toFixed(0)) : 0
    })).slice(0, 5); // Top 5

    return { defectRate, firstPassYield, complaintIndex, defectTrendChart, categoryChart };
  }, [qcRecords, complaints, currentLanguage]);



  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-lg ${
              toast.type === 'success' ? 'bg-green-500 text-white' : 
              toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : 
             toast.type === 'error' ? <AlertCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <p className="font-medium text-sm">{toast.msg}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <ModuleHeader
        title={currentLanguage === 'tr' ? 'Kalite Yönetimi' : 'Quality Management'}
        subtitle={currentLanguage === 'tr' ? 'Kalite kontrol, şikayet yönetimi ve denetim' : 'Quality control, complaint management and audit'}
        icon={ShieldCheck}
        actionButton={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input 
                type="text" 
                placeholder={t.search}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#ff4000]/20 outline-none w-full sm:w-64 transition-all"
              />
            </div>
            <button 
              onClick={() => {
                const typeMap: Record<string, string> = {
                  qc: 'qc',
                  complaints: 'complaint',
                  audit: 'audit',
                  fmea: 'fmea',
                  pfmea: 'pfmea',
                  ctpat: 'ctpat',
                  kaizen: 'kaizen',
                  '5s': '5s',
                  '8d': '8d'
                };
                setModalConfig({ isOpen: true, type: (typeMap[activeTab] as 'qc' | 'complaint' | 'audit' | 'fmea' | 'pfmea' | 'ctpat' | 'kaizen' | '5s' | '8d') || 'qc', mode: 'add', data: null });
              }}
              className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm"
            >
              <Plus className="w-4 h-4" /> {t.add}
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="w-full overflow-x-auto hide-scrollbar pb-2">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-2xl w-max">
          {[
            { id: 'qc', label: t.qc, icon: ClipboardCheck },
            { id: 'complaints', label: t.complaints, icon: AlertCircle },
            { id: 'audit', label: t.audit, icon: FileText },
            { id: 'kpi', label: t.kpi, icon: BarChart3 },
            { id: 'fmea', label: 'FMEA', icon: Activity },
            { id: 'pfmea', label: 'PFMEA', icon: Activity },
            { id: 'ctpat', label: 'CTPAT', icon: ShieldCheck },
            { id: 'kaizen', label: 'Kaizen', icon: TrendingUp },
            { id: '5s', label: '5S', icon: Target },
            { id: '8d', label: '8D', icon: FileText },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'qc' | 'complaints' | 'audit' | 'kpi' | 'fmea' | 'pfmea' | 'ctpat' | 'kaizen' | '5s' | '8d')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-white text-[#ff4000] shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F]'}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'qc' && (
          <motion.div key="qc" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <button className="apple-card p-5 bg-blue-50 cursor-pointer hover:shadow-md transition-all text-left" onClick={() => setActiveTab('qc')}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Toplam Denetim' : 'Total Audits'}</p>
                <p className="text-2xl font-bold text-blue-600">{qcRecords.length}</p>
              </button>
              <button className="apple-card p-5 bg-green-50 cursor-pointer hover:shadow-md transition-all text-left" onClick={() => setActiveTab('qc')}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Uygunluk Oranı' : 'Pass Rate'}</p>
                <p className="text-2xl font-bold text-green-600">%{qcRecords.length > 0 ? Math.round((qcRecords.filter(r => r.status === 'Pass').length / qcRecords.length) * 100) : 0}</p>
              </button>
              <button className="apple-card p-5 bg-red-50 cursor-pointer hover:shadow-md transition-all text-left" onClick={() => setActiveTab('qc')}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Ort. Hata Oranı' : 'Avg Defect Rate'}</p>
                <p className="text-2xl font-bold text-red-600">%{qcRecords.length > 0 ? (qcRecords.reduce((sum, r) => sum + r.defectRate, 0) / qcRecords.length).toFixed(1) : 0}</p>
              </button>
              <button className="apple-card p-5 bg-purple-50 cursor-pointer hover:shadow-md transition-all text-left" onClick={() => setActiveTab('qc')}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Denetçi Sayısı' : 'Inspectors'}</p>
                <p className="text-2xl font-bold text-purple-600">{new Set(qcRecords.map(r => r.inspector)).size}</p>
              </button>
            </div>

            {/* Table */}
            <div className="apple-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <SortHeader label={currentLanguage === 'tr' ? 'Tarih' : 'Date'} sortKey="date" currentSort={qcSort} onSort={(k) => toggleSort(qcSort, k, setQcSort)} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Ürün' : 'Product'} sortKey="productName" currentSort={qcSort} onSort={(k) => toggleSort(qcSort, k, setQcSort)} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Parti No' : 'Batch No'} sortKey="batchNo" currentSort={qcSort} onSort={(k) => toggleSort(qcSort, k, setQcSort)} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Örneklem' : 'Sample'} sortKey="sampleSize" currentSort={qcSort} onSort={(k) => toggleSort(qcSort, k, setQcSort)} align="right" />
                      <SortHeader label={currentLanguage === 'tr' ? 'Hata' : 'Defect'} sortKey="defects" currentSort={qcSort} onSort={(k) => toggleSort(qcSort, k, setQcSort)} align="right" />
                      <SortHeader label={t.defectRate} sortKey="defectRate" currentSort={qcSort} onSort={(k) => toggleSort(qcSort, k, setQcSort)} align="right" />
                      <SortHeader label={t.status} sortKey="status" currentSort={qcSort} onSort={(k) => toggleSort(qcSort, k, setQcSort)} align="center" />
                      <th className="text-right py-4 px-6 text-[#86868B] font-bold uppercase tracking-wider">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sortData(qcRecords.filter(r => r.productName.toLowerCase().includes(searchQuery.toLowerCase())), qcSort.key, qcSort.dir).map(record => (
                      <tr key={record.id} className="hover:bg-gray-50 transition-colors group">
                        <td className="py-4 px-6 text-[#86868B]">{record.date}</td>
                        <td className="py-4 px-6 font-bold text-[#1D1D1F]">{record.productName}</td>
                        <td className="py-4 px-6 text-[#1D1D1F] font-mono text-xs">{record.batchNo}</td>
                        <td className="py-4 px-6 text-right font-medium">{record.sampleSize}</td>
                        <td className="py-4 px-6 text-right font-medium text-red-500">{record.defects}</td>
                        <td className="py-4 px-6 text-right">
                          <span className={`font-bold ${record.defectRate > 5 ? 'text-red-500' : 'text-green-600'}`}>%{record.defectRate}</span>
                        </td>
                        <td className="py-4 px-6 text-center">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            record.status === 'Pass' ? 'bg-green-100 text-green-600' :
                            record.status === 'Fail' ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'
                          }`}>
                            {record.status === 'Pass' ? t.pass : record.status === 'Fail' ? t.fail : t.conditional}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setModalConfig({ isOpen: true, type: 'qc', mode: 'view', data: record })} className="p-2 hover:bg-blue-50 text-blue-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'İncele' : 'View'}><Eye className="w-4 h-4" /></button>
                            <button onClick={() => setModalConfig({ isOpen: true, type: 'qc', mode: 'edit', data: record })} className="p-2 hover:bg-gray-200 text-gray-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => handleDelete(record.id, 'qc')} className="p-2 hover:bg-red-50 text-red-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
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

        {activeTab === 'complaints' && (
          <motion.div key="complaints" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            <div className="flex items-center gap-2">
              <div className="flex gap-2">
              {(['All', 'Critical', 'Major', 'Minor'] as const).map(filter => (
                <button 
                  key={filter}
                  onClick={() => setComplaintFilter(filter)}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                    complaintFilter === filter 
                      ? "bg-[#ff4000] text-white shadow-sm" 
                      : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                  )}
                >
                  {filter === 'All' ? (currentLanguage === 'tr' ? 'Tüm Şiddetler' : 'All Severities') : 
                   filter === 'Critical' ? (currentLanguage === 'tr' ? 'Kritik' : 'Critical') :
                   filter === 'Major' ? (currentLanguage === 'tr' ? 'Önemli' : 'Major') :
                   filter === 'Minor' ? (currentLanguage === 'tr' ? 'Düşük' : 'Minor') : filter}
                </button>
              ))}
            </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {sortData(complaints.filter(c => (complaintFilter === 'All' || c.severity === complaintFilter) && (c.subject.toLowerCase().includes(searchQuery.toLowerCase()) || c.customer.toLowerCase().includes(searchQuery.toLowerCase()))), complaintSort.key, complaintSort.dir).map(item => (
              <div key={item.id} className="apple-card p-6 space-y-4 hover:shadow-md transition-shadow group relative">
                <div className="flex justify-between items-start">
                  <div className="pr-16">
                    <h3 className="font-bold text-lg text-[#1D1D1F]">{item.subject}</h3>
                    <p className="text-sm text-[#86868B]">{item.customer} — {item.product}</p>
                  </div>
                  <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur-sm p-1 rounded-xl shadow-sm border border-gray-100">
                    <button onClick={() => setModalConfig({ isOpen: true, type: 'complaint', mode: 'view', data: item })} className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"><Eye className="w-4 h-4" /></button>
                    <button onClick={() => setModalConfig({ isOpen: true, type: 'complaint', mode: 'edit', data: item })} className="p-1.5 hover:bg-gray-100 text-gray-500 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(item.id, 'complaint')} className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                    item.severity === 'Critical' ? 'bg-red-100 text-red-600' :
                    item.severity === 'Major' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'
                  }`}>
                    {item.severity === 'Critical' ? (currentLanguage === 'tr' ? 'Kritik' : 'Critical') :
                     item.severity === 'Major' ? (currentLanguage === 'tr' ? 'Önemli' : 'Major') :
                     item.severity === 'Minor' ? (currentLanguage === 'tr' ? 'Düşük' : 'Minor') : item.severity}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-4 py-3 border-y border-gray-50">
                  <div>
                    <p className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Kök Neden' : 'Root Cause'}</p>
                    <p className="text-sm font-semibold text-[#1D1D1F] truncate">{item.rootCause || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Düzeltici Faaliyet' : 'Corrective Action'}</p>
                    <p className="text-sm font-semibold text-green-600 truncate">{item.correctiveAction || '—'}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span className="text-xs text-gray-500">{item.date}</span>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    item.status === 'Resolved' ? 'bg-green-100 text-green-600' :
                    item.status === 'Investigating' ? 'bg-blue-100 text-blue-600' : 
                    item.status === 'Closed' ? 'bg-gray-100 text-gray-600' : 'bg-orange-100 text-orange-600'
                  }`}>
                    {item.status === 'Resolved' ? (currentLanguage === 'tr' ? 'Çözüldü' : 'Resolved') :
                     item.status === 'Investigating' ? (currentLanguage === 'tr' ? 'İnceleniyor' : 'Investigating') :
                     item.status === 'Closed' ? (currentLanguage === 'tr' ? 'Kapalı' : 'Closed') :
                     item.status === 'Open' ? (currentLanguage === 'tr' ? 'Açık' : 'Open') : item.status}
                  </span>
                </div>
              </div>
            ))}
            </div>
          </motion.div>
        )}

        {activeTab === 'audit' && (
          <motion.div key="audit" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="apple-card p-6 flex flex-col items-center justify-center text-center">
              <h3 className="font-bold text-[#1D1D1F] mb-6">{currentLanguage === 'tr' ? 'Denetim Uyumluluk' : 'Audit Compliance'}</h3>
              <div className="relative w-40 h-40">
                <svg className="w-full h-full" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="#F5F5F7" strokeWidth="10" />
                  <circle cx="50" cy="50" r="45" fill="none" stroke="#34C759" strokeWidth="10" strokeDasharray="282.7" strokeDashoffset="28.2" strokeLinecap="round" transform="rotate(-90 50 50)" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-4xl font-bold text-[#1D1D1F]">90</span>
                  <span className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">/ 100</span>
                </div>
              </div>
              <p className="text-sm text-[#86868B] mt-6">{currentLanguage === 'tr' ? 'Son iç denetim sonucuna göre ISO 9001 uyumluluğu yüksektir.' : 'ISO 9001 compliance is high based on the latest internal audit result.'}</p>
            </div>

            <div className="lg:col-span-2 apple-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-[#1D1D1F]">{currentLanguage === 'tr' ? 'Denetim Maddeleri' : 'Audit Items'}</h3>
                <div className="flex gap-2">
                  <button onClick={() => toggleSort(auditSort, 'category', setAuditSort)} className={cn("text-[10px] font-bold px-2 py-1 rounded-lg transition-colors", auditSort.key === 'category' ? "bg-[#ff4000] text-white" : "bg-gray-100 text-gray-500")}>
                    {currentLanguage === 'tr' ? 'Kategori' : 'Category'} {auditSort.key === 'category' && (auditSort.dir === 'asc' ? '↑' : '↓')}
                  </button>
                  <button onClick={() => toggleSort(auditSort, 'score', setAuditSort)} className={cn("text-[10px] font-bold px-2 py-1 rounded-lg transition-colors", auditSort.key === 'score' ? "bg-[#ff4000] text-white" : "bg-gray-100 text-gray-500")}>
                    {currentLanguage === 'tr' ? 'Puan' : 'Score'} {auditSort.key === 'score' && (auditSort.dir === 'asc' ? '↑' : '↓')}
                  </button>
                </div>
              </div>
              <div className="space-y-4">
                {sortData(auditItems.filter(a => a.title.toLowerCase().includes(searchQuery.toLowerCase())), auditSort.key, auditSort.dir).map(item => (
                  <div key={item.id} className="p-4 bg-gray-50 rounded-2xl space-y-3 group relative">
                    <div className="flex justify-between items-start pr-24">
                      <div>
                        <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">
                          {item.category === 'Documentation' ? (currentLanguage === 'tr' ? 'Dokümantasyon' : 'Documentation') :
                           item.category === 'Process' ? (currentLanguage === 'tr' ? 'Süreç' : 'Process') :
                           item.category === 'Safety' ? (currentLanguage === 'tr' ? 'Güvenlik' : 'Safety') :
                           item.category === 'Training' ? (currentLanguage === 'tr' ? 'Eğitim' : 'Training') : item.category}
                        </p>
                        <p className="text-sm font-bold text-[#1D1D1F]">{item.title}</p>
                        {item.notes && <p className="text-xs text-gray-500 mt-1">{item.notes}</p>}
                      </div>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map(star => (
                          <Star key={star} className={`w-4 h-4 ${star <= item.score ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}`} />
                        ))}
                      </div>
                    </div>
                    <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setModalConfig({ isOpen: true, type: 'audit', mode: 'view', data: item })} className="p-1.5 hover:bg-blue-100 text-blue-500 rounded-lg transition-colors"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => setModalConfig({ isOpen: true, type: 'audit', mode: 'edit', data: item })} className="p-1.5 hover:bg-gray-200 text-gray-500 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(item.id, 'audit')} className="p-1.5 hover:bg-red-100 text-red-500 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'kpi' && (
          <motion.div key="kpi" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: 'OEE', value: '%88', icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50', tab: 'kpi' },
                    { label: currentLanguage === 'tr' ? 'Hata Oranı' : 'Defect Rate', value: `%${kpiData.defectRate}`, icon: Zap, color: 'text-red-600', bg: 'bg-red-50', tab: 'qc' },
                    { label: currentLanguage === 'tr' ? 'Şikayet Endeksi' : 'Complaint Index', value: kpiData.complaintIndex, icon: AlertCircle, color: 'text-orange-600', bg: 'bg-orange-50', tab: 'complaints' },
                    { label: currentLanguage === 'tr' ? 'İlk Seferde Doğru' : 'First Pass Yield', value: `%${kpiData.firstPassYield}`, icon: Award, color: 'text-green-600', bg: 'bg-green-50', tab: 'qc' },
                  ].map((kpi, i) => (
                    <button key={i} className={`apple-card p-5 ${kpi.bg} cursor-pointer hover:shadow-md transition-all text-left`} onClick={() => setActiveTab(kpi.tab as 'qc' | 'complaints' | 'audit' | 'kpi' | 'fmea' | 'pfmea' | 'ctpat' | 'kaizen' | '5s' | '8d')}>
                      <div className="flex items-center gap-3 mb-3">
                        <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
                        <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">{kpi.label}</p>
                      </div>
                      <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                    </button>
                  ))}
                </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="apple-card p-6">
                <h3 className="font-bold text-[#1D1D1F] mb-6">{currentLanguage === 'tr' ? 'Hata Oranı Trendi' : 'Defect Rate Trend'}</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={kpiData.defectTrendChart.length > 0 ? kpiData.defectTrendChart : [{ name: 'N/A', value: 0 }]}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5F7" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#86868B' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#86868B' }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="value" stroke="#FF3B30" strokeWidth={3} dot={{ r: 4, fill: '#FF3B30' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="apple-card p-6">
                <h3 className="font-bold text-[#1D1D1F] mb-6">{currentLanguage === 'tr' ? 'Kategori Bazlı Uygunluk' : 'Pass Rate by Category'}</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={kpiData.categoryChart.length > 0 ? kpiData.categoryChart : [{ name: 'N/A', value: 0 }]} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F5F5F7" />
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#86868B' }} width={80} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#34C759" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </motion.div>
        )}
        {activeTab === 'fmea' && (
          <motion.div key="fmea" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", fmeaFilter === 'All' ? 'bg-blue-100' : 'bg-blue-50')}
                onClick={() => setFmeaFilter('All')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Toplam FMEA' : 'Total FMEA'}</p>
                <p className="text-2xl font-bold text-blue-600">{fmeaRecords.length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", fmeaFilter === 'Critical' ? 'bg-red-100' : 'bg-red-50')}
                onClick={() => setFmeaFilter('Critical')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Kritik Risk (RPN>100)' : 'Critical Risk'}</p>
                <p className="text-2xl font-bold text-red-600">{fmeaRecords.filter(r => r.rpn > 100).length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", fmeaFilter === 'Pending' ? 'bg-orange-100' : 'bg-orange-50')}
                onClick={() => setFmeaFilter('Pending')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Aksiyon Bekleyen' : 'Pending Actions'}</p>
                <p className="text-2xl font-bold text-orange-600">{fmeaRecords.filter(r => r.rpn > 50 && r.rpn <= 100).length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", fmeaFilter === 'Low' ? 'bg-green-100' : 'bg-green-50')}
                onClick={() => setFmeaFilter('Low')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Düşük Risk' : 'Low Risk'}</p>
                <p className="text-2xl font-bold text-green-600">{fmeaRecords.filter(r => r.rpn <= 50).length}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input 
                  type="text" 
                  placeholder={currentLanguage === 'tr' ? 'FMEA Ara...' : 'Search FMEA...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#ff4000]/20 outline-none w-full transition-all"
                />
              </div>
              {fmeaFilter !== 'All' && (
                <button 
                  onClick={() => setFmeaFilter('All')}
                  className="text-xs font-bold text-[#ff4000] hover:underline"
                >
                  {currentLanguage === 'tr' ? 'Filtreyi Temizle' : 'Clear Filter'}
                </button>
              )}
            </div>
            <div className="apple-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[#86868B] font-bold uppercase tracking-wider">
                    <SortHeader label={currentLanguage === 'tr' ? 'Süreç' : 'Process'} sortKey="process" currentSort={fmeaSort} onSort={(k) => toggleSort(fmeaSort, k, setFmeaSort)} />
                    <SortHeader label={currentLanguage === 'tr' ? 'Hata Modu' : 'Failure Mode'} sortKey="failureMode" currentSort={fmeaSort} onSort={(k) => toggleSort(fmeaSort, k, setFmeaSort)} />
                    <SortHeader label="RPN" sortKey="rpn" currentSort={fmeaSort} onSort={(k) => toggleSort(fmeaSort, k, setFmeaSort)} align="center" />
                    <th className="py-3 px-4 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider whitespace-nowrap">{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortData(fmeaRecords.filter(r => {
                    const matchesSearch = r.process.toLowerCase().includes(searchQuery.toLowerCase()) || r.failureMode.toLowerCase().includes(searchQuery.toLowerCase());
                    const matchesFilter = fmeaFilter === 'All' || 
                      (fmeaFilter === 'Critical' && r.rpn > 100) ||
                      (fmeaFilter === 'Pending' && r.rpn > 50 && r.rpn <= 100) ||
                      (fmeaFilter === 'Low' && r.rpn <= 50);
                    return matchesSearch && matchesFilter;
                  }), fmeaSort.key, fmeaSort.dir).map(record => (
                    <tr key={record.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-4">{record.process}</td>
                      <td className="py-3 px-4">{record.failureMode}</td>
                      <td className="py-3 px-4 text-center font-bold text-[#ff4000]">{record.rpn}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setModalConfig({ isOpen: true, type: 'fmea', mode: 'view', data: record })} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 transition-all"><Eye size={16} /></button>
                          <button onClick={() => setModalConfig({ isOpen: true, type: 'fmea', mode: 'edit', data: record })} className="p-2 hover:bg-blue-50 rounded-xl text-gray-400 hover:text-blue-600 transition-all"><Edit2 size={16} /></button>
                          <button onClick={() => handleDelete(record.id, 'fmea')} className="p-2 hover:bg-red-50 rounded-xl text-gray-400 hover:text-red-600 transition-all"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
        {activeTab === 'pfmea' && (
          <motion.div key="pfmea" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", pfmeaFilter === 'All' ? 'bg-blue-100' : 'bg-blue-50')}
                onClick={() => setPfmeaFilter('All')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Toplam PFMEA' : 'Total PFMEA'}</p>
                <p className="text-2xl font-bold text-blue-600">{pfmeaRecords.length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", pfmeaFilter === 'Critical' ? 'bg-red-100' : 'bg-red-50')}
                onClick={() => setPfmeaFilter('Critical')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Kritik Risk (RPN>100)' : 'Critical Risk (RPN>100)'}</p>
                <p className="text-2xl font-bold text-red-600">{pfmeaRecords.filter(r => r.rpn > 100).length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", pfmeaFilter === 'Pending' ? 'bg-orange-100' : 'bg-orange-50')}
                onClick={() => setPfmeaFilter('Pending')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Aksiyon Bekleyen' : 'Pending Actions'}</p>
                <p className="text-2xl font-bold text-orange-600">{pfmeaRecords.filter(r => r.rpn > 50 && r.rpn <= 100).length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", pfmeaFilter === 'Low' ? 'bg-green-100' : 'bg-green-50')}
                onClick={() => setPfmeaFilter('Low')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Düşük Risk' : 'Low Risk'}</p>
                <p className="text-2xl font-bold text-green-600">{pfmeaRecords.filter(r => r.rpn <= 50).length}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input 
                  type="text" 
                  placeholder={currentLanguage === 'tr' ? 'PFMEA Ara...' : 'Search PFMEA...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#ff4000]/20 outline-none w-full transition-all"
                />
              </div>
              {pfmeaFilter !== 'All' && (
                <button 
                  onClick={() => setPfmeaFilter('All')}
                  className="text-xs font-bold text-[#ff4000] hover:underline"
                >
                  {currentLanguage === 'tr' ? 'Filtreyi Temizle' : 'Clear Filter'}
                </button>
              )}
            </div>
            <div className="apple-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[#86868B] font-bold uppercase tracking-wider">
                    <SortHeader label={currentLanguage === 'tr' ? 'Süreç' : 'Process'} sortKey="process" currentSort={pfmeaSort} onSort={(k) => toggleSort(pfmeaSort, k, setPfmeaSort)} />
                    <SortHeader label={currentLanguage === 'tr' ? 'Hata Modu' : 'Failure Mode'} sortKey="failureMode" currentSort={pfmeaSort} onSort={(k) => toggleSort(pfmeaSort, k, setPfmeaSort)} />
                    <SortHeader label="RPN" sortKey="rpn" currentSort={pfmeaSort} onSort={(k) => toggleSort(pfmeaSort, k, setPfmeaSort)} align="center" />
                    <th className="py-3 px-4 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider whitespace-nowrap">{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortData(pfmeaRecords.filter(r => {
                    const matchesSearch = r.process.toLowerCase().includes(searchQuery.toLowerCase()) || r.failureMode.toLowerCase().includes(searchQuery.toLowerCase());
                    const matchesFilter = pfmeaFilter === 'All' || 
                      (pfmeaFilter === 'Critical' && r.rpn > 100) ||
                      (pfmeaFilter === 'Pending' && r.rpn > 50 && r.rpn <= 100) ||
                      (pfmeaFilter === 'Low' && r.rpn <= 50);
                    return matchesSearch && matchesFilter;
                  }), pfmeaSort.key, pfmeaSort.dir).map(record => (
                    <tr key={record.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-4">{record.process}</td>
                      <td className="py-3 px-4">{record.failureMode}</td>
                      <td className="py-3 px-4 text-center font-bold text-[#ff4000]">{record.rpn}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => handleAiSuggestion('fmea', record)}
                            className="p-2 hover:bg-purple-50 rounded-xl text-purple-400 hover:text-purple-600 transition-all"
                            title={currentLanguage === 'tr' ? 'Gemini Önerisi' : 'Gemini Suggestion'}
                          >
                            <Sparkles size={16} />
                          </button>
                          <button onClick={() => setModalConfig({ isOpen: true, type: 'pfmea', mode: 'view', data: record })} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 transition-all"><Eye size={16} /></button>
                          <button onClick={() => setModalConfig({ isOpen: true, type: 'pfmea', mode: 'edit', data: record })} className="p-2 hover:bg-blue-50 rounded-xl text-gray-400 hover:text-blue-600 transition-all"><Edit2 size={16} /></button>
                          <button onClick={() => handleDelete(record.id, 'pfmea')} className="p-2 hover:bg-red-50 rounded-xl text-gray-400 hover:text-red-600 transition-all"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
        {activeTab === 'ctpat' && (
          <motion.div key="ctpat" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", ctpatFilter === 'All' ? 'bg-blue-100' : 'bg-blue-50')}
                onClick={() => setCtpatFilter('All')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Kontrol Noktası' : 'Control Points'}</p>
                <p className="text-2xl font-bold text-blue-600">{ctpatRecords.length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", ctpatFilter === 'Compliant' ? 'bg-green-100' : 'bg-green-50')}
                onClick={() => setCtpatFilter('Compliant')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Uyumlu' : 'Compliant'}</p>
                <p className="text-2xl font-bold text-green-600">{ctpatRecords.filter(r => r.status === 'Uyumlu').length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", ctpatFilter === 'Non-Compliant' ? 'bg-red-100' : 'bg-red-50')}
                onClick={() => setCtpatFilter('Non-Compliant')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Uyumsuz' : 'Non-Compliant'}</p>
                <p className="text-2xl font-bold text-red-600">{ctpatRecords.filter(r => r.status === 'Uyumsuz').length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", ctpatFilter === 'Review' ? 'bg-orange-100' : 'bg-orange-50')}
                onClick={() => setCtpatFilter('Review')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'İnceleniyor' : 'Under Review'}</p>
                <p className="text-2xl font-bold text-orange-600">{ctpatRecords.filter(r => r.status === 'İnceleniyor').length}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input 
                  type="text" 
                  placeholder={currentLanguage === 'tr' ? 'CTPAT Ara...' : 'Search CTPAT...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#ff4000]/20 outline-none w-full transition-all"
                />
              </div>
              {ctpatFilter !== 'All' && (
                <button 
                  onClick={() => setCtpatFilter('All')}
                  className="text-xs font-bold text-[#ff4000] hover:underline"
                >
                  {currentLanguage === 'tr' ? 'Filtreyi Temizle' : 'Clear Filter'}
                </button>
              )}
            </div>
            <div className="apple-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[#86868B] font-bold uppercase tracking-wider">
                    <SortHeader label={currentLanguage === 'tr' ? 'Kontrol Noktası' : 'Control Point'} sortKey="point" currentSort={ctpatSort} onSort={(k) => toggleSort(ctpatSort, k, setCtpatSort)} />
                    <SortHeader label={currentLanguage === 'tr' ? 'Durum' : 'Status'} sortKey="status" currentSort={ctpatSort} onSort={(k) => toggleSort(ctpatSort, k, setCtpatSort)} align="center" />
                    <th className="py-3 px-4 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider whitespace-nowrap">{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortData(ctpatRecords.filter(r => {
                    const matchesSearch = r.point.toLowerCase().includes(searchQuery.toLowerCase());
                    const matchesFilter = ctpatFilter === 'All' || 
                      (ctpatFilter === 'Compliant' && r.status === 'Uyumlu') ||
                      (ctpatFilter === 'Non-Compliant' && r.status === 'Uyumsuz') ||
                      (ctpatFilter === 'Review' && r.status === 'İnceleniyor');
                    return matchesSearch && matchesFilter;
                  }), ctpatSort.key, ctpatSort.dir).map(record => (
                    <tr key={record.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-4">{record.point}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-1 rounded-lg text-xs font-bold ${
                          record.status === 'Uyumlu' ? 'bg-green-100 text-green-700' :
                          record.status === 'Uyumsuz' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                        }`}>
                          {record.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setModalConfig({ isOpen: true, type: 'ctpat', mode: 'view', data: record })} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 transition-all"><Eye size={16} /></button>
                          <button onClick={() => setModalConfig({ isOpen: true, type: 'ctpat', mode: 'edit', data: record })} className="p-2 hover:bg-blue-50 rounded-xl text-gray-400 hover:text-blue-600 transition-all"><Edit2 size={16} /></button>
                          <button onClick={() => handleDelete(record.id, 'ctpat')} className="p-2 hover:bg-red-50 rounded-xl text-gray-400 hover:text-red-600 transition-all"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
        {activeTab === 'kaizen' && (
          <motion.div key="kaizen" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", kaizenFilter === 'All' ? 'bg-blue-100' : 'bg-blue-50')}
                onClick={() => setKaizenFilter('All')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Toplam Kaizen' : 'Total Kaizen'}</p>
                <p className="text-2xl font-bold text-blue-600">{kaizenRecords.length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", kaizenFilter === 'In Progress' ? 'bg-orange-100' : 'bg-orange-50')}
                onClick={() => setKaizenFilter('In Progress')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Devam Eden' : 'In Progress'}</p>
                <p className="text-2xl font-bold text-orange-600">{kaizenRecords.filter(r => r.status === 'Devam Ediyor').length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", kaizenFilter === 'Completed' ? 'bg-green-100' : 'bg-green-50')}
                onClick={() => setKaizenFilter('Completed')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Tamamlanan' : 'Completed'}</p>
                <p className="text-2xl font-bold text-green-600">{kaizenRecords.filter(r => r.status === 'Tamamlandı').length}</p>
              </div>
              <div className="apple-card p-5 bg-purple-50">
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Sağlanan Tasarruf' : 'Savings'}</p>
                <p className="text-2xl font-bold text-purple-600">₺{kaizenRecords.reduce((sum, r) => sum + (r.savings || 0), 0).toLocaleString('tr-TR')}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input 
                  type="text" 
                  placeholder={currentLanguage === 'tr' ? 'Kaizen Ara...' : 'Search Kaizen...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#ff4000]/20 outline-none w-full transition-all"
                />
              </div>
              {kaizenFilter !== 'All' && (
                <button 
                  onClick={() => setKaizenFilter('All')}
                  className="text-xs font-bold text-[#ff4000] hover:underline"
                >
                  {currentLanguage === 'tr' ? 'Filtreyi Temizle' : 'Clear Filter'}
                </button>
              )}
            </div>
            <div className="apple-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[#86868B] font-bold uppercase tracking-wider">
                    <SortHeader label={currentLanguage === 'tr' ? 'Problem' : 'Problem'} sortKey="problem" currentSort={kaizenSort} onSort={(k) => toggleSort(kaizenSort, k, setKaizenSort)} />
                    <SortHeader label={currentLanguage === 'tr' ? 'Sorumlu' : 'Responsible'} sortKey="responsible" currentSort={kaizenSort} onSort={(k) => toggleSort(kaizenSort, k, setKaizenSort)} />
                    <SortHeader label={currentLanguage === 'tr' ? 'Durum' : 'Status'} sortKey="status" currentSort={kaizenSort} onSort={(k) => toggleSort(kaizenSort, k, setKaizenSort)} align="center" />
                    <th className="py-3 px-4 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider whitespace-nowrap">{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortData(kaizenRecords.filter(r => {
                    const matchesSearch = r.problem.toLowerCase().includes(searchQuery.toLowerCase()) || r.responsible.toLowerCase().includes(searchQuery.toLowerCase());
                    const matchesFilter = kaizenFilter === 'All' || 
                      (kaizenFilter === 'In Progress' && r.status === 'Devam Ediyor') ||
                      (kaizenFilter === 'Completed' && r.status === 'Tamamlandı');
                    return matchesSearch && matchesFilter;
                  }), kaizenSort.key, kaizenSort.dir).map(record => (
                    <tr key={record.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-4">{record.problem}</td>
                      <td className="py-3 px-4">{record.responsible}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-1 rounded-lg text-xs font-bold ${
                          record.status === 'Tamamlandı' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {record.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setModalConfig({ isOpen: true, type: 'kaizen', mode: 'view', data: record })} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 transition-all"><Eye size={16} /></button>
                          <button onClick={() => setModalConfig({ isOpen: true, type: 'kaizen', mode: 'edit', data: record })} className="p-2 hover:bg-blue-50 rounded-xl text-gray-400 hover:text-blue-600 transition-all"><Edit2 size={16} /></button>
                          <button onClick={() => handleDelete(record.id, 'kaizen')} className="p-2 hover:bg-red-50 rounded-xl text-gray-400 hover:text-red-600 transition-all"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
        {activeTab === '5s' && (
          <motion.div key="5s" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", fiveSFilter === 'All' ? 'bg-blue-100' : 'bg-blue-50')}
                onClick={() => setFiveSFilter('All')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Toplam Denetim' : 'Total Audits'}</p>
                <p className="text-2xl font-bold text-blue-600">{fiveSRecords.length}</p>
              </div>
              <div className="apple-card p-5 bg-green-50">
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Ortalama Puan' : 'Average Score'}</p>
                <p className="text-2xl font-bold text-green-600">{fiveSRecords.length > 0 ? (fiveSRecords.reduce((sum, r) => sum + r.score, 0) / fiveSRecords.length).toFixed(1) : '0'}/5</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", fiveSFilter === 'Low' ? 'bg-red-100' : 'bg-red-50')}
                onClick={() => setFiveSFilter('Low')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Düşük Puanlı Alan' : 'Low Score Areas'}</p>
                <p className="text-2xl font-bold text-red-600">{fiveSRecords.filter(r => r.score < 3).length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", fiveSFilter === 'High' ? 'bg-orange-100' : 'bg-orange-50')}
                onClick={() => setFiveSFilter('High')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Yüksek Puanlı Alan' : 'High Score Areas'}</p>
                <p className="text-2xl font-bold text-orange-600">{fiveSRecords.filter(r => r.score >= 4).length}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input 
                  type="text" 
                  placeholder={currentLanguage === 'tr' ? '5S Ara...' : 'Search 5S...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#ff4000]/20 outline-none w-full transition-all"
                />
              </div>
              {fiveSFilter !== 'All' && (
                <button 
                  onClick={() => setFiveSFilter('All')}
                  className="text-xs font-bold text-[#ff4000] hover:underline"
                >
                  {currentLanguage === 'tr' ? 'Filtreyi Temizle' : 'Clear Filter'}
                </button>
              )}
            </div>
            <div className="apple-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[#86868B] font-bold uppercase tracking-wider">
                    <SortHeader label={currentLanguage === 'tr' ? 'Alan' : 'Area'} sortKey="area" currentSort={fiveSSort} onSort={(k) => toggleSort(fiveSSort, k, setFiveSSort)} />
                    <SortHeader label={currentLanguage === 'tr' ? 'Puan' : 'Score'} sortKey="score" currentSort={fiveSSort} onSort={(k) => toggleSort(fiveSSort, k, setFiveSSort)} align="center" />
                    <SortHeader label={currentLanguage === 'tr' ? 'Denetçi' : 'Inspector'} sortKey="inspector" currentSort={fiveSSort} onSort={(k) => toggleSort(fiveSSort, k, setFiveSSort)} align="center" />
                    <th className="py-3 px-4 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider whitespace-nowrap">{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortData(fiveSRecords.filter(r => {
                    const matchesSearch = r.area.toLowerCase().includes(searchQuery.toLowerCase()) || r.inspector.toLowerCase().includes(searchQuery.toLowerCase());
                    const matchesFilter = fiveSFilter === 'All' || 
                      (fiveSFilter === 'Low' && r.score < 3) ||
                      (fiveSFilter === 'High' && r.score >= 4);
                    return matchesSearch && matchesFilter;
                  }), fiveSSort.key, fiveSSort.dir).map(record => (
                    <tr key={record.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-4">{record.area}</td>
                      <td className="py-3 px-4 text-center font-bold">{record.score}/5</td>
                      <td className="py-3 px-4 text-center">{record.inspector}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setModalConfig({ isOpen: true, type: '5s', mode: 'view', data: record })} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 transition-all"><Eye size={16} /></button>
                          <button onClick={() => setModalConfig({ isOpen: true, type: '5s', mode: 'edit', data: record })} className="p-2 hover:bg-blue-50 rounded-xl text-gray-400 hover:text-blue-600 transition-all"><Edit2 size={16} /></button>
                          <button onClick={() => handleDelete(record.id, '5s')} className="p-2 hover:bg-red-50 rounded-xl text-gray-400 hover:text-red-600 transition-all"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
        {activeTab === '8d' && (
          <motion.div key="8d" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", eightDFilter === 'All' ? 'bg-blue-100' : 'bg-blue-50')}
                onClick={() => setEightDFilter('All')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Toplam 8D' : 'Total 8D'}</p>
                <p className="text-2xl font-bold text-blue-600">{eightDRecords.length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", eightDFilter === 'Open' ? 'bg-orange-100' : 'bg-orange-50')}
                onClick={() => setEightDFilter('Open')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Açık (D1-D3)' : 'Open (D1-D3)'}</p>
                <p className="text-2xl font-bold text-orange-600">{eightDRecords.filter(r => r.stage.includes('D1') || r.stage.includes('D2') || r.stage.includes('D3')).length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", eightDFilter === 'RootCause' ? 'bg-purple-100' : 'bg-purple-50')}
                onClick={() => setEightDFilter('RootCause')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Kök Neden (D4)' : 'Root Cause (D4)'}</p>
                <p className="text-2xl font-bold text-purple-600">{eightDRecords.filter(r => r.stage.includes('D4')).length}</p>
              </div>
              <div 
                className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", eightDFilter === 'Closed' ? 'bg-green-100' : 'bg-green-50')}
                onClick={() => setEightDFilter('Closed')}
              >
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Kapanan (D8)' : 'Closed (D8)'}</p>
                <p className="text-2xl font-bold text-green-600">{eightDRecords.filter(r => r.stage.includes('D8')).length}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input 
                  type="text" 
                  placeholder={currentLanguage === 'tr' ? '8D Ara...' : 'Search 8D...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#ff4000]/20 outline-none w-full transition-all"
                />
              </div>
              {eightDFilter !== 'All' && (
                <button 
                  onClick={() => setEightDFilter('All')}
                  className="text-xs font-bold text-[#ff4000] hover:underline"
                >
                  {currentLanguage === 'tr' ? 'Filtreyi Temizle' : 'Clear Filter'}
                </button>
              )}
            </div>
            <div className="apple-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[#86868B] font-bold uppercase tracking-wider">
                    <SortHeader label={currentLanguage === 'tr' ? 'Problem' : 'Problem'} sortKey="problem" currentSort={eightDSort} onSort={(k) => toggleSort(eightDSort, k, setEightDSort)} />
                    <SortHeader label={currentLanguage === 'tr' ? 'Sorumlu' : 'Responsible'} sortKey="responsible" currentSort={eightDSort} onSort={(k) => toggleSort(eightDSort, k, setEightDSort)} />
                    <SortHeader label={currentLanguage === 'tr' ? 'Aşama' : 'Stage'} sortKey="stage" currentSort={eightDSort} onSort={(k) => toggleSort(eightDSort, k, setEightDSort)} align="center" />
                    <th className="py-3 px-4 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider whitespace-nowrap">{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortData(eightDRecords.filter(r => {
                    const matchesSearch = r.problem.toLowerCase().includes(searchQuery.toLowerCase()) || r.responsible.toLowerCase().includes(searchQuery.toLowerCase());
                    const matchesFilter = eightDFilter === 'All' || 
                      (eightDFilter === 'Open' && (r.stage.includes('D1') || r.stage.includes('D2') || r.stage.includes('D3'))) ||
                      (eightDFilter === 'RootCause' && r.stage.includes('D4')) ||
                      (eightDFilter === 'Closed' && r.stage.includes('D8'));
                    return matchesSearch && matchesFilter;
                  }), eightDSort.key, eightDSort.dir).map(record => (
                    <tr key={record.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-4">{record.problem}</td>
                      <td className="py-3 px-4">{record.responsible}</td>
                      <td className="py-3 px-4 text-center font-bold">{record.stage}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => handleAiSuggestion('8d', record)}
                            className="p-2 hover:bg-purple-50 rounded-xl text-purple-400 hover:text-purple-600 transition-all"
                            title={currentLanguage === 'tr' ? 'Gemini Önerisi' : 'Gemini Suggestion'}
                          >
                            <Sparkles size={16} />
                          </button>
                          <button onClick={() => setModalConfig({ isOpen: true, type: '8d', mode: 'view', data: record })} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 transition-all"><Eye size={16} /></button>
                          <button onClick={() => setModalConfig({ isOpen: true, type: '8d', mode: 'edit', data: record })} className="p-2 hover:bg-blue-50 rounded-xl text-gray-400 hover:text-blue-600 transition-all"><Edit2 size={16} /></button>
                          <button onClick={() => handleDelete(record.id, '8d')} className="p-2 hover:bg-red-50 rounded-xl text-gray-400 hover:text-red-600 transition-all"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Suggestion Modal */}
      <AnimatePresence>
        {(isAiLoading || aiSuggestion) && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-purple-50/50">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-6 h-6 text-purple-600" />
                  <h2 className="text-xl font-bold text-gray-900">{currentLanguage === 'tr' ? 'Gemini Kalite Asistanı' : 'Gemini Quality Assistant'}</h2>
                </div>
                <button onClick={() => { setAiSuggestion(null); setIsAiLoading(false); }} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-8">
                {isAiLoading ? (
                  <div className="flex flex-col items-center justify-center h-48 space-y-4">
                    <Loader2 className="w-10 h-10 text-purple-600 animate-spin" />
                    <p className="text-gray-500 font-medium">{currentLanguage === 'tr' ? 'Gemini analiz ediyor...' : 'Gemini is analyzing...'}</p>
                  </div>
                ) : (
                  <div className="prose prose-purple max-w-none">
                    <div className="markdown-body">
                      <Markdown>{aiSuggestion || ''}</Markdown>
                    </div>
                  </div>
                )}
              </div>
              <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-end">
                <button
                  onClick={() => { setAiSuggestion(null); setIsAiLoading(false); }}
                  className="apple-button-secondary px-8"
                >
                  Kapat
                </button>
              </div>
            </motion.div>
          </div>
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
                  {modalConfig.mode === 'view' ? (currentLanguage === 'tr' ? 'İncele' : 'View') : modalConfig.mode === 'edit' ? (currentLanguage === 'tr' ? 'Düzenle' : 'Edit') : (currentLanguage === 'tr' ? 'Yeni Ekle' : 'Add New')}
                </h3>
                <button onClick={() => setModalConfig({ isOpen: false, type: null, mode: 'add', data: null })} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              
              <form onSubmit={handleSaveModal} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <fieldset disabled={modalConfig.mode === 'view'} className="space-y-4">
                  {modalConfig.type === 'qc' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Tarih' : 'Date'}</label>
                          <input type="date" name="date" defaultValue={(modalConfig.data as QCRecord)?.date || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Ürün Adı' : 'Product Name'}</label>
                          <input name="productName" defaultValue={(modalConfig.data as QCRecord)?.productName || ''} required className="apple-input w-full" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Parti No' : 'Batch No'}</label>
                          <input name="batchNo" defaultValue={(modalConfig.data as QCRecord)?.batchNo || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Denetçi' : 'Inspector'}</label>
                          <input name="inspector" defaultValue={(modalConfig.data as QCRecord)?.inspector || ''} required className="apple-input w-full" />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Örneklem' : 'Sample Size'}</label>
                          <input type="number" name="sampleSize" defaultValue={(modalConfig.data as QCRecord)?.sampleSize || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Hata Sayısı' : 'Defects'}</label>
                          <input type="number" name="defects" defaultValue={(modalConfig.data as QCRecord)?.defects || 0} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</label>
                          <select name="status" defaultValue={(modalConfig.data as QCRecord)?.status || 'Pass'} className="apple-input w-full">
                            <option value="Pass">{currentLanguage === 'tr' ? 'Uygun' : 'Pass'}</option>
                            <option value="Conditional">{currentLanguage === 'tr' ? 'Şartlı Kabul' : 'Conditional'}</option>
                            <option value="Fail">{currentLanguage === 'tr' ? 'Hatalı' : 'Fail'}</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Notlar' : 'Notes'}</label>
                        <textarea name="notes" defaultValue={(modalConfig.data as QCRecord)?.notes || ''} rows={3} className="apple-input w-full" />
                      </div>
                    </>
                  )}

                  {modalConfig.type === 'complaint' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Tarih' : 'Date'}</label>
                          <input type="date" name="date" defaultValue={(modalConfig.data as Complaint)?.date || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Müşteri' : 'Customer'}</label>
                          <input name="customer" defaultValue={(modalConfig.data as Complaint)?.customer || ''} required className="apple-input w-full" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Ürün' : 'Product'}</label>
                          <input name="product" defaultValue={(modalConfig.data as Complaint)?.product || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Konu' : 'Subject'}</label>
                          <input name="subject" defaultValue={(modalConfig.data as Complaint)?.subject || ''} required className="apple-input w-full" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Önem Derecesi' : 'Severity'}</label>
                          <select name="severity" defaultValue={(modalConfig.data as Complaint)?.severity || 'Minor'} className="apple-input w-full">
                            <option value="Critical">{currentLanguage === 'tr' ? 'Kritik' : 'Critical'}</option>
                            <option value="Major">{currentLanguage === 'tr' ? 'Önemli' : 'Major'}</option>
                            <option value="Minor">{currentLanguage === 'tr' ? 'Düşük' : 'Minor'}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</label>
                          <select name="status" defaultValue={(modalConfig.data as Complaint)?.status || 'Open'} className="apple-input w-full">
                            <option value="Open">{currentLanguage === 'tr' ? 'Açık' : 'Open'}</option>
                            <option value="Investigating">{currentLanguage === 'tr' ? 'İnceleniyor' : 'Investigating'}</option>
                            <option value="Resolved">{currentLanguage === 'tr' ? 'Çözüldü' : 'Resolved'}</option>
                            <option value="Closed">{currentLanguage === 'tr' ? 'Kapalı' : 'Closed'}</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Kök Neden' : 'Root Cause'}</label>
                        <input name="rootCause" defaultValue={(modalConfig.data as Complaint)?.rootCause || ''} className="apple-input w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Düzeltici Faaliyet' : 'Corrective Action'}</label>
                        <input name="correctiveAction" defaultValue={(modalConfig.data as Complaint)?.correctiveAction || ''} className="apple-input w-full" />
                      </div>
                    </>
                  )}

                  {modalConfig.type === 'audit' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Kategori' : 'Category'}</label>
                          <input name="category" defaultValue={(modalConfig.data as AuditItem)?.category || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Puan (1-5)' : 'Score (1-5)'}</label>
                          <input type="number" name="score" defaultValue={(modalConfig.data as AuditItem)?.score || 5} min="1" max="5" required className="apple-input w-full" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Başlık' : 'Title'}</label>
                        <input name="title" defaultValue={(modalConfig.data as AuditItem)?.title || ''} required className="apple-input w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Notlar' : 'Notes'}</label>
                        <textarea name="notes" defaultValue={(modalConfig.data as AuditItem)?.notes || ''} rows={3} className="apple-input w-full" />
                      </div>
                    </>
                  )}

                  {modalConfig.type === 'fmea' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Süreç' : 'Process'}</label>
                          <input name="process" defaultValue={(modalConfig.data as FMEARecord)?.process || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Hata Modu' : 'Failure Mode'}</label>
                          <input name="failureMode" defaultValue={(modalConfig.data as FMEARecord)?.failureMode || ''} required className="apple-input w-full" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'RPN' : 'RPN'}</label>
                        <input type="number" name="rpn" defaultValue={(modalConfig.data as FMEARecord)?.rpn || ''} required className="apple-input w-full" />
                      </div>
                    </>
                  )}

                  {modalConfig.type === 'pfmea' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Süreç' : 'Process'}</label>
                          <input name="process" defaultValue={(modalConfig.data as PFMEARecord)?.process || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Hata Modu' : 'Failure Mode'}</label>
                          <input name="failureMode" defaultValue={(modalConfig.data as PFMEARecord)?.failureMode || ''} required className="apple-input w-full" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'RPN' : 'RPN'}</label>
                        <input type="number" name="rpn" defaultValue={(modalConfig.data as PFMEARecord)?.rpn || ''} required className="apple-input w-full" />
                      </div>
                    </>
                  )}

                  {modalConfig.type === 'ctpat' && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Kontrol Noktası' : 'Control Point'}</label>
                        <input name="point" defaultValue={(modalConfig.data as CTPATRecord)?.point || ''} required className="apple-input w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</label>
                        <select name="status" defaultValue={(modalConfig.data as CTPATRecord)?.status || 'Uyumlu'} className="apple-input w-full">
                          <option value="Uyumlu">{currentLanguage === 'tr' ? 'Uyumlu' : 'Compliant'}</option>
                          <option value="Uyumsuz">{currentLanguage === 'tr' ? 'Uyumsuz' : 'Non-Compliant'}</option>
                          <option value="İnceleniyor">{currentLanguage === 'tr' ? 'İnceleniyor' : 'Under Review'}</option>
                        </select>
                      </div>
                    </>
                  )}

                  {modalConfig.type === 'kaizen' && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Problem' : 'Problem'}</label>
                        <input name="problem" defaultValue={(modalConfig.data as KaizenRecord)?.problem || ''} required className="apple-input w-full" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Sorumlu' : 'Responsible'}</label>
                          <input name="responsible" defaultValue={(modalConfig.data as KaizenRecord)?.responsible || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</label>
                          <select name="status" defaultValue={(modalConfig.data as KaizenRecord)?.status || 'Devam Ediyor'} className="apple-input w-full">
                            <option value="Devam Ediyor">{currentLanguage === 'tr' ? 'Devam Ediyor' : 'In Progress'}</option>
                            <option value="Tamamlandı">{currentLanguage === 'tr' ? 'Tamamlandı' : 'Completed'}</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Sağlanan Tasarruf' : 'Savings'}</label>
                        <input type="number" name="savings" defaultValue={(modalConfig.data as KaizenRecord)?.savings || ''} className="apple-input w-full" />
                      </div>
                    </>
                  )}

                  {modalConfig.type === '5s' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Alan' : 'Area'}</label>
                          <input name="area" defaultValue={(modalConfig.data as FiveSRecord)?.area || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Puan' : 'Score'}</label>
                          <input type="number" step="0.1" name="score" defaultValue={(modalConfig.data as FiveSRecord)?.score || ''} required className="apple-input w-full" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Denetçi' : 'Inspector'}</label>
                        <input name="inspector" defaultValue={(modalConfig.data as FiveSRecord)?.inspector || ''} required className="apple-input w-full" />
                      </div>
                    </>
                  )}

                  {modalConfig.type === '8d' && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Problem' : 'Problem'}</label>
                        <input name="problem" defaultValue={(modalConfig.data as EightDRecord)?.problem || ''} required className="apple-input w-full" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Sorumlu' : 'Responsible'}</label>
                          <input name="responsible" defaultValue={(modalConfig.data as EightDRecord)?.responsible || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Aşama' : 'Stage'}</label>
                          <input name="stage" defaultValue={(modalConfig.data as EightDRecord)?.stage || ''} required className="apple-input w-full" />
                        </div>
                      </div>
                    </>
                  )}
                </fieldset>

                <div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
                  <button type="button" onClick={() => setModalConfig({ isOpen: false, type: null, mode: 'add', data: null })} className="px-6 py-2.5 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                    {modalConfig.mode === 'view' ? (currentLanguage === 'tr' ? 'Kapat' : 'Close') : (currentLanguage === 'tr' ? 'İptal' : 'Cancel')}
                  </button>
                  {modalConfig.mode !== 'view' && (
                    <button type="submit" className="apple-button-primary px-8 py-2.5">
                      {currentLanguage === 'tr' ? 'Kaydet' : 'Save'}
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
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

export default QualityModule;
