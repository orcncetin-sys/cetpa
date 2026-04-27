import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, Calendar, CreditCard, 
  Plus, Search, Trash2, X, 
  TrendingUp, GraduationCap, Star, Plane, 
  DollarSign,
  CheckCircle, AlertCircle, Edit2, Eye
} from 'lucide-react';
import { 
  collection, onSnapshot, addDoc, deleteDoc, 
  doc, updateDoc, serverTimestamp, query, where, getDocs 
} from 'firebase/firestore';
import { db } from '../firebase';
import { logFirestoreError, OperationType } from '../utils/firebase';
import { 
  type Employee, 
  type PerformanceReview, 
  type Training, 
  type TravelRequest, 
  type LeaveRequest, 
  type Payroll 
} from '../types';
import { format } from 'date-fns';
import ConfirmModal from './ConfirmModal';
import { cn } from '../lib/utils';

// Employee, PerformanceReview, Training, TravelRequest, LeaveRequest, Payroll are imported from ../types

interface HRModuleProps {
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
  userRole: string | null;
  employees?: Employee[];
  exchangeRates?: Record<string, number> | null;
}

const HR_TABS = {
  tr: [
    { key: 'employees', label: 'Çalışanlar', icon: Users },
    { key: 'leave', label: 'İzin Takibi', icon: Calendar },
    { key: 'payroll', label: 'Bordro', icon: CreditCard },
    { key: 'performance', label: 'Performans', icon: Star },
    { key: 'training', label: 'Eğitim', icon: GraduationCap },
    { key: 'travel', label: 'Seyahat/Avans', icon: Plane },
  ],
  en: [
    { key: 'employees', label: 'Employees', icon: Users },
    { key: 'leave', label: 'Leave Tracking', icon: Calendar },
    { key: 'payroll', label: 'Payroll', icon: CreditCard },
    { key: 'performance', label: 'Performance', icon: Star },
    { key: 'training', label: 'Training', icon: GraduationCap },
    { key: 'travel', label: 'Travel/Advance', icon: Plane },
  ]
};

const SortHeader: React.FC<{ label: string; sortKey: string; currentSort: { key: string; dir: 'asc' | 'desc' }; onSort: (key: string) => void; align?: 'left' | 'right' | 'center' }> = ({ label, sortKey, currentSort, onSort, align = 'left' }) => {
  const isActive = currentSort.key === sortKey;
  return (
    <th 
      className={cn(
        "py-3 px-5 text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none group hover:text-[#ff4000] transition-colors",
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      )}
      onClick={() => onSort(sortKey)}
    >
      <div className={cn("flex items-center gap-1", align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start')}>
        {label}
        <TrendingUp className={cn(
          "w-3 h-3 transition-all",
          isActive ? "text-[#ff4000] opacity-100" : "text-gray-300 opacity-0 group-hover:opacity-100",
          isActive && currentSort.dir === 'desc' ? "rotate-180" : ""
        )} />
      </div>
    </th>
  );
};

export default function HRModule({ currentLanguage, isAuthenticated, userRole, employees: employeesProp, exchangeRates }: HRModuleProps) {
  const [activeTab, setActiveTab] = useState('employees');
  const [salaryCurrency, setSalaryCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });
  const [employees, setEmployees] = useState<Employee[]>([]);

  useEffect(() => {
    if (employeesProp) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEmployees(employeesProp);
    }
  }, [employeesProp]);

  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [performanceReviews, setPerformanceReviews] = useState<PerformanceReview[]>([]);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [travelRequests, setTravelRequests] = useState<TravelRequest[]>([]);
  
  // Search & Sort States
  const [employeesSearch, setEmployeesSearch] = useState('');
  const [employeesSort, setEmployeesSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });

  const [leaveSearch, setLeaveSearch] = useState('');
  const [leaveSort, setLeaveSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'startDate', dir: 'desc' });

  const [payrollSearch, setPayrollSearch] = useState('');
  const [payrollSort, setPayrollSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'month', dir: 'desc' });

  const [performanceSearch, setPerformanceSearch] = useState('');
  const [performanceSort, setPerformanceSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });

  const [trainingSearch, setTrainingSearch] = useState('');
  const [trainingSort, setTrainingSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });

  const [travelSearch, setTravelSearch] = useState('');
  const [travelSort, setTravelSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'startDate', dir: 'desc' });

  // Sort Helper
  const sortData = <T extends Record<string, any>>(data: T[], key: string, dir: 'asc' | 'desc') => {
    return [...data].sort((a, b) => {
      const aVal = a[key] as string | number;
      const bVal = b[key] as string | number;
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

  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [employeeForm, setEmployeeForm] = useState<Partial<Employee>>({
    name: '', position: '', department: '', salary: 0, 
    salaryCurrency: 'TRY',
    startDate: format(new Date(), 'yyyy-MM-dd'), email: '', 
    phone: '', status: 'Aktif', employeeId: '', tcId: '', role: 'Employee', city: 'İstanbul'
  });

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [editingLeaveId, setEditingLeaveId] = useState<string | null>(null);
  const [leaveForm, setLeaveForm] = useState<Partial<LeaveRequest>>({
    employeeId: '', type: 'Yıllık İzin', startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'), days: 1, status: 'Bekliyor', notes: ''
  });

  const [showPayrollModal, setShowPayrollModal] = useState(false);
  const [payrollForm, setPayrollForm] = useState<Partial<Payroll>>({
    employeeId: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(),
    baseSalary: 0, bonus: 0, deduction: 0, status: 'Taslak', currency: 'TRY'
  });

  const [showPerformanceModal, setShowPerformanceModal] = useState(false);
  const [editingPerformanceId, setEditingPerformanceId] = useState<string | null>(null);
  const [performanceForm, setPerformanceForm] = useState<Partial<PerformanceReview>>({
    employeeId: '', reviewer: '', date: format(new Date(), 'yyyy-MM-dd'), score: 5, comments: '', status: 'Bekliyor'
  });

  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [editingTrainingId, setEditingTrainingId] = useState<string | null>(null);
  const [trainingForm, setTrainingForm] = useState<Partial<Training>>({
    employeeId: '', title: '', date: format(new Date(), 'yyyy-MM-dd'), provider: '', status: 'Planlandı'
  });

  const [showTravelModal, setShowTravelModal] = useState(false);
  const [editingTravelId, setEditingTravelId] = useState<string | null>(null);
  const [travelForm, setTravelForm] = useState<Partial<TravelRequest>>({
    employeeId: '', destination: '', city: '', startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'), advanceAmount: 0, status: 'Bekliyor', notes: ''
  });

  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const t = {
    employees: currentLanguage === 'tr' ? 'Çalışanlar' : 'Employees',
    add: currentLanguage === 'tr' ? 'Ekle' : 'Add',
    save: currentLanguage === 'tr' ? 'Kaydet' : 'Save',
    cancel: currentLanguage === 'tr' ? 'İptal' : 'Cancel',
    name: currentLanguage === 'tr' ? 'Ad Soyad' : 'Full Name',
    position: currentLanguage === 'tr' ? 'Pozisyon' : 'Position',
    department: currentLanguage === 'tr' ? 'Departman' : 'Department',
    salary: currentLanguage === 'tr' ? 'Maaş' : 'Salary',
    startDate: currentLanguage === 'tr' ? 'Başlangıç' : 'Start Date',
    endDate: currentLanguage === 'tr' ? 'Bitiş' : 'End Date',
    status: currentLanguage === 'tr' ? 'Durum' : 'Status',
    noRecords: currentLanguage === 'tr' ? 'Kayıt bulunamadı.' : 'No records found.',
    confirmDelete: currentLanguage === 'tr' ? 'Bu kaydı silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this record?',
    payroll: currentLanguage === 'tr' ? 'Bordro' : 'Payroll',
    calculate: currentLanguage === 'tr' ? 'Hesapla' : 'Calculate',
    netSalary: currentLanguage === 'tr' ? 'Net Maaş' : 'Net Salary',
    bonus: currentLanguage === 'tr' ? 'Prim/Ek' : 'Bonus/Extra',
    deduction: currentLanguage === 'tr' ? 'Kesinti' : 'Deduction',
    month: currentLanguage === 'tr' ? 'Ay' : 'Month',
    year: currentLanguage === 'tr' ? 'Yıl' : 'Year',
  };

  useEffect(() => {
    if (!isAuthenticated || !userRole) return;

    const unsubLeave = onSnapshot(collection(db, 'leaveRequests'), (snap) => {
      setLeaveRequests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LeaveRequest)));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'leaveRequests'));
    const unsubPayroll = onSnapshot(collection(db, 'payrolls'), (snap) => {
      setPayrolls(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payroll)));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'payrolls'));
    const unsubPerformance = onSnapshot(collection(db, 'performanceReviews'), (snap) => {
      setPerformanceReviews(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PerformanceReview)));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'performanceReviews'));
    const unsubTraining = onSnapshot(collection(db, 'trainings'), (snap) => {
      setTrainings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Training)));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'trainings'));
    const unsubTravel = onSnapshot(collection(db, 'travelRequests'), (snap) => {
      setTravelRequests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as TravelRequest)));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'travelRequests'));
    return () => {
      unsubLeave();
      unsubPayroll();
      unsubPerformance();
      unsubTraining();
      unsubTravel();
    };
  }, [isAuthenticated, userRole]);

  const handleDeleteEmployee = async (empId: string) => {
    setConfirmModal({
      isOpen: true,
      title: currentLanguage === 'tr' ? 'Çalışanı Sil' : 'Delete Employee',
      message: t.confirmDelete,
      onConfirm: async () => {
        try {
          // Find all related documents
          const relatedDocs = [
            { collection: 'leaveRequests', field: 'employeeId' },
            { collection: 'payrolls', field: 'employeeId' },
            { collection: 'performanceReviews', field: 'employeeId' },
            { collection: 'trainings', field: 'employeeId' },
            { collection: 'travelRequests', field: 'employeeId' },
          ];

          for (const docInfo of relatedDocs) {
            const q = query(collection(db, docInfo.collection), where(docInfo.field, '==', empId));
            const snap = await getDocs(q);
            for (const docItem of snap.docs) {
              await deleteDoc(doc(db, docInfo.collection, docItem.id));
            }
          }

          // Delete the employee
          await deleteDoc(doc(db, 'employees', empId));
          showToast(currentLanguage === 'tr' ? 'Çalışan ve ilişkili veriler silindi.' : 'Employee and related data deleted.');
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `employees/${empId}`);
          showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'An error occurred.', 'error');
        }
      }
    });
  };

  const handleSaveEmployee = async () => {
    if (!isAuthenticated) return showToast(currentLanguage === 'tr' ? 'Lütfen giriş yapın.' : 'Please login.', 'error');
    if (!employeeForm.name?.trim()) return showToast(currentLanguage === 'tr' ? 'Lütfen isim girin.' : 'Please enter a name.', 'error');
    try {
      await addDoc(collection(db, 'employees'), {
        ...employeeForm,
        createdAt: serverTimestamp()
      });
      setShowEmployeeModal(false);
      setEmployeeForm({
        name: '', position: '', department: '', salary: 0, 
        startDate: format(new Date(), 'yyyy-MM-dd'), email: '', 
        phone: '', status: 'Aktif', employeeId: '', tcId: '', role: 'Employee', city: 'İstanbul'
      });
      showToast(currentLanguage === 'tr' ? 'Çalışan eklendi.' : 'Employee added.');
    } catch (error) {
      console.error("Error adding employee:", error);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'An error occurred.', 'error');
    }
  };

  const handleSaveLeave = async () => {
    if (!isAuthenticated) return showToast(currentLanguage === 'tr' ? 'Lütfen giriş yapın.' : 'Please login.', 'error');
    if (!leaveForm.employeeId) return showToast(currentLanguage === 'tr' ? 'Lütfen çalışan seçin.' : 'Please select an employee.', 'error');
    const emp = employees.find(e => e.id === leaveForm.employeeId);
    try {
      if (editingLeaveId) {
        await updateDoc(doc(db, 'leaveRequests', editingLeaveId), {
          ...leaveForm,
          employeeName: emp?.name || 'Unknown',
        });
        showToast(currentLanguage === 'tr' ? 'İzin güncellendi.' : 'Leave updated.');
      } else {
        await addDoc(collection(db, 'leaveRequests'), {
          ...leaveForm,
          employeeName: emp?.name || 'Unknown',
          createdAt: serverTimestamp()
        });
        showToast(currentLanguage === 'tr' ? 'İzin talebi eklendi.' : 'Leave request added.');
      }
      setShowLeaveModal(false);
      setEditingLeaveId(null);
      setLeaveForm({
        employeeId: '', type: 'Yıllık İzin', startDate: format(new Date(), 'yyyy-MM-dd'),
        endDate: format(new Date(), 'yyyy-MM-dd'), days: 1, status: 'Bekliyor', notes: ''
      });
    } catch (error) {
      console.error("Error saving leave:", error);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'An error occurred.', 'error');
    }
  };

  const handleAddPayroll = async () => {
    if (!isAuthenticated) return showToast(currentLanguage === 'tr' ? 'Lütfen giriş yapın.' : 'Please login.', 'error');
    if (!payrollForm.employeeId) return showToast(currentLanguage === 'tr' ? 'Lütfen çalışan seçin.' : 'Please select an employee.', 'error');
    const emp = employees.find(e => e.id === payrollForm.employeeId);
    
    // Calculate performance bonus
    const empPerformance = performanceReviews.filter(p => p.employeeId === payrollForm.employeeId && p.status === 'Onaylandı');
    const latestPerformance = empPerformance.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    const performanceBonus = latestPerformance ? latestPerformance.score * 1000 : 0;
    
    const net = (payrollForm.baseSalary || 0) + (payrollForm.bonus || 0) + performanceBonus - (payrollForm.deduction || 0);
    try {
      await addDoc(collection(db, 'payrolls'), {
        ...payrollForm,
        bonus: (payrollForm.bonus || 0) + performanceBonus,
        employeeName: emp?.name || 'Unknown',
        netSalary: net,
        approvalStatus: 'Bekliyor',
        createdAt: serverTimestamp()
      });
      setShowPayrollModal(false);
      setPayrollForm({
        employeeId: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(),
        baseSalary: 0, bonus: 0, deduction: 0, status: 'Taslak'
      });
      showToast(currentLanguage === 'tr' ? 'Bordro eklendi.' : 'Payroll added.');
    } catch (error) {
      console.error("Error adding payroll:", error);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'An error occurred.', 'error');
    }
  };

  const handleSavePerformance = async () => {
    if (!isAuthenticated) return showToast(currentLanguage === 'tr' ? 'Lütfen giriş yapın.' : 'Please login.', 'error');
    if (!performanceForm.employeeId) return showToast(currentLanguage === 'tr' ? 'Lütfen çalışan seçin.' : 'Please select an employee.', 'error');
    const emp = employees.find(e => e.id === performanceForm.employeeId);
    try {
      if (editingPerformanceId) {
        await updateDoc(doc(db, 'performanceReviews', editingPerformanceId), {
          ...performanceForm,
          employeeName: emp?.name || 'Unknown',
        });
        showToast(currentLanguage === 'tr' ? 'Değerlendirme güncellendi.' : 'Review updated.');
      } else {
        await addDoc(collection(db, 'performanceReviews'), {
          ...performanceForm,
          employeeName: emp?.name || 'Unknown',
          createdAt: serverTimestamp()
        });
        showToast(currentLanguage === 'tr' ? 'Değerlendirme eklendi.' : 'Review added.');
      }
      setShowPerformanceModal(false);
      setEditingPerformanceId(null);
      setPerformanceForm({
        employeeId: '', reviewer: '', date: format(new Date(), 'yyyy-MM-dd'), score: 5, comments: '', status: 'Bekliyor'
      });
    } catch (error) {
      console.error("Error saving performance:", error);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'An error occurred.', 'error');
    }
  };

  const handleSaveTraining = async () => {
    if (!isAuthenticated) return showToast(currentLanguage === 'tr' ? 'Lütfen giriş yapın.' : 'Please login.', 'error');
    if (!trainingForm.employeeId) return showToast(currentLanguage === 'tr' ? 'Lütfen çalışan seçin.' : 'Please select an employee.', 'error');
    const emp = employees.find(e => e.id === trainingForm.employeeId);
    try {
      if (editingTrainingId) {
        await updateDoc(doc(db, 'trainings', editingTrainingId), {
          ...trainingForm,
          employeeName: emp?.name || 'Unknown',
        });
        showToast(currentLanguage === 'tr' ? 'Eğitim güncellendi.' : 'Training updated.');
      } else {
        await addDoc(collection(db, 'trainings'), {
          ...trainingForm,
          employeeName: emp?.name || 'Unknown',
          createdAt: serverTimestamp()
        });
        showToast(currentLanguage === 'tr' ? 'Eğitim eklendi.' : 'Training added.');
      }
      setShowTrainingModal(false);
      setEditingTrainingId(null);
      setTrainingForm({
        employeeId: '', title: '', date: format(new Date(), 'yyyy-MM-dd'), provider: '', status: 'Planlandı'
      });
    } catch (error) {
      console.error("Error saving training:", error);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'An error occurred.', 'error');
    }
  };

  const handleSaveTravel = async () => {
    if (!isAuthenticated) return showToast(currentLanguage === 'tr' ? 'Lütfen giriş yapın.' : 'Please login.', 'error');
    if (!travelForm.employeeId) return showToast(currentLanguage === 'tr' ? 'Lütfen çalışan seçin.' : 'Please select an employee.', 'error');
    const emp = employees.find(e => e.id === travelForm.employeeId);
    try {
      if (editingTravelId) {
        await updateDoc(doc(db, 'travelRequests', editingTravelId), {
          ...travelForm,
          employeeName: emp?.name || 'Unknown',
        });
        showToast(currentLanguage === 'tr' ? 'Seyahat/Avans güncellendi.' : 'Travel/Advance updated.');
      } else {
        await addDoc(collection(db, 'travelRequests'), {
          ...travelForm,
          employeeName: emp?.name || 'Unknown',
          createdAt: serverTimestamp()
        });
        showToast(currentLanguage === 'tr' ? 'Seyahat/Avans eklendi.' : 'Travel/Advance added.');
      }
      setShowTravelModal(false);
      setEditingTravelId(null);
      setTravelForm({
        employeeId: '', destination: '', city: '', startDate: format(new Date(), 'yyyy-MM-dd'),
        endDate: format(new Date(), 'yyyy-MM-dd'), advanceAmount: 0, status: 'Bekliyor', notes: ''
      });
    } catch (error) {
      console.error("Error saving travel request:", error);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'An error occurred.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-white border border-gray-100 rounded-2xl shadow-sm overflow-x-auto scrollbar-none">
        {HR_TABS[currentLanguage].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 min-w-max inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${isActive ? 'bg-brand text-white shadow-sm' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="apple-card p-4 cursor-pointer group" onClick={() => setActiveTab('employees')}>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Toplam Çalışan</h3>
          <p className="text-2xl font-bold text-gray-900">{employees.length}</p>
        </div>
        <div className="apple-card p-4 cursor-pointer group" onClick={() => setActiveTab('leave')}>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Bekleyen İzin</h3>
          <p className="text-2xl font-bold text-gray-900">{leaveRequests.filter(l => l.status === 'Bekliyor').length}</p>
        </div>
        <div className="apple-card p-4 cursor-pointer group" onClick={() => setActiveTab('payroll')}>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Bekleyen Bordro</h3>
          <p className="text-2xl font-bold text-gray-900">{payrolls.filter(p => p.status === 'Taslak').length}</p>
        </div>
        <div className="apple-card p-4 cursor-pointer group" onClick={() => setActiveTab('performance')}>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Bekleyen Değerlendirme</h3>
          <p className="text-2xl font-bold text-gray-900">{performanceReviews.filter(p => p.status === 'Bekliyor').length}</p>
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'employees' && (
          <motion.div key="employees" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input 
                  type="text" 
                  placeholder={t.employees + '...'} 
                  value={employeesSearch}
                  onChange={e => setEmployeesSearch(e.target.value)}
                  className="apple-input w-full pl-10 pr-4 py-2.5"
                />
              </div>
              <button 
                onClick={() => setShowEmployeeModal(true)}
                className="apple-button-primary"
              >
                <Plus size={18} /> {t.add}
              </button>
            </div>

            <div className="apple-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <SortHeader label={t.name} sortKey="name" currentSort={employeesSort} onSort={(k) => toggleSort(employeesSort, k, setEmployeesSort)} />
                      <SortHeader label={t.position} sortKey="position" currentSort={employeesSort} onSort={(k) => toggleSort(employeesSort, k, setEmployeesSort)} />
                      <SortHeader label={t.department} sortKey="department" currentSort={employeesSort} onSort={(k) => toggleSort(employeesSort, k, setEmployeesSort)} />
                      <SortHeader label={t.salary} sortKey="salary" currentSort={employeesSort} onSort={(k) => toggleSort(employeesSort, k, setEmployeesSort)} align="right" />
                      <SortHeader label={t.startDate} sortKey="startDate" currentSort={employeesSort} onSort={(k) => toggleSort(employeesSort, k, setEmployeesSort)} align="center" />
                      <SortHeader label={t.status} sortKey="status" currentSort={employeesSort} onSort={(k) => toggleSort(employeesSort, k, setEmployeesSort)} align="center" />
                      <th className="py-3 px-5 text-right text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap">{currentLanguage === 'tr' ? 'İşlemler' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sortData(employees.filter(e => 
                      e.name.toLowerCase().includes(employeesSearch.toLowerCase()) || 
                      e.position.toLowerCase().includes(employeesSearch.toLowerCase()) ||
                      e.department.toLowerCase().includes(employeesSearch.toLowerCase())
                    ), employeesSort.key, employeesSort.dir).map(emp => (
                      <tr key={emp.id} className="hover:bg-gray-50 transition-all group">
                        <td className="py-3 px-5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center text-brand font-bold text-xs border border-gray-100">
                              {emp.name.charAt(0)}
                            </div>
                            <span className="font-bold text-gray-900">{emp.name}</span>
                          </div>
                        </td>
                        <td className="py-3 px-5 text-gray-600">{emp.position}</td>
                        <td className="py-3 px-5 text-gray-500">{emp.department}</td>
                        <td className="py-3 px-5 text-right font-medium">₺{emp.salary.toLocaleString()}</td>
                        <td className="py-3 px-5 text-center text-gray-400">{emp.startDate}</td>
                        <td className="py-3 px-5 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${emp.status === 'Aktif' ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
                            {emp.status}
                          </span>
                        </td>
                        <td className="py-3 px-5 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => { setEmployeeForm(emp); setShowEmployeeModal(true); }}
                              className="action-btn-view"
                            >
                              <Eye size={14} />
                            </button>
                            <button 
                              onClick={() => { setEmployeeForm(emp); setShowEmployeeModal(true); }}
                              className="action-btn-view"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button 
                              onClick={() => handleDeleteEmployee(emp.id)}
                              className="action-btn-delete"
                            >
                              <Trash2 size={14} />
                            </button>
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

        {activeTab === 'payroll' && (
          <motion.div key="payroll" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 cursor-pointer hover:shadow-md transition-all text-left group" onClick={() => setActiveTab('employees')}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-blue-50 rounded-xl text-blue-600 group-hover:bg-blue-100 transition-colors"><Users size={20} /></div>
                  <h3 className="text-sm font-bold text-gray-500">{currentLanguage === 'tr' ? 'Toplam Çalışan' : 'Total Employees'}</h3>
                </div>
                <p className="text-3xl font-bold text-gray-900">{employees.length}</p>
              </button>
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 text-left">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-50 rounded-xl text-green-600"><DollarSign size={20} /></div>
                    <h3 className="text-sm font-bold text-gray-500">{currentLanguage === 'tr' ? 'Aylık Toplam Maaş' : 'Monthly Total Salary'}</h3>
                  </div>
                  {exchangeRates && (
                    <div className="flex gap-1">
                      {(['TRY','USD','EUR'] as const).map(c => (
                        <button key={c} onClick={() => setSalaryCurrency(c)}
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${salaryCurrency === c ? 'bg-[#ff4000] text-white' : 'text-gray-400 hover:bg-gray-100'}`}>
                          {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {(() => {
                  const totalTRY = employees.reduce((s, e) => s + (e.salary || 0), 0);
                  const rate = salaryCurrency === 'USD' ? (exchangeRates?.USD || 1) : salaryCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
                  const sym = salaryCurrency === 'TRY' ? '₺' : salaryCurrency === 'USD' ? '$' : '€';
                  const converted = salaryCurrency === 'TRY' ? totalTRY : totalTRY / rate;
                  return (
                    <>
                      <p className="text-3xl font-bold text-gray-900">{sym}{converted.toLocaleString('tr-TR', { maximumFractionDigits: salaryCurrency === 'TRY' ? 0 : 0 })}</p>
                      {salaryCurrency !== 'TRY' && (
                        <p className="text-xs text-gray-400 mt-0.5">₺{totalTRY.toLocaleString('tr-TR', {maximumFractionDigits: 0})} · 1 {salaryCurrency} = ₺{rate.toFixed(2)}</p>
                      )}
                    </>
                  );
                })()}
              </div>
              <button className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 cursor-pointer hover:shadow-md transition-all text-left group" onClick={() => setActiveTab('payroll')}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-purple-50 rounded-xl text-purple-600 group-hover:bg-purple-100 transition-colors"><CreditCard size={20} /></div>
                  <h3 className="text-sm font-bold text-gray-500">{currentLanguage === 'tr' ? 'Ödenen Bordrolar' : 'Paid Payrolls'}</h3>
                </div>
                <p className="text-3xl font-bold text-gray-900">{payrolls.filter(p => p.status === 'Ödendi').length}</p>
              </button>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input 
                  type="text" 
                  placeholder={(currentLanguage === 'tr' ? 'Bordrolarda Ara' : 'Search Payrolls') + '...'} 
                  value={payrollSearch}
                  onChange={e => setPayrollSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-100 rounded-2xl shadow-sm outline-none focus:ring-2 focus:ring-[#ff4000]/20 transition-all text-sm"
                />
              </div>
              <button 
                onClick={() => setShowPayrollModal(true)}
                className="apple-button-primary"
              >
                <Plus size={14} /> {t.calculate}
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <SortHeader label={t.name} sortKey="employeeName" currentSort={payrollSort} onSort={(k) => toggleSort(payrollSort, k, setPayrollSort)} />
                      <SortHeader label={t.month + '/' + t.year} sortKey="month" currentSort={payrollSort} onSort={(k) => toggleSort(payrollSort, k, setPayrollSort)} align="center" />
                      <SortHeader label={t.salary} sortKey="baseSalary" currentSort={payrollSort} onSort={(k) => toggleSort(payrollSort, k, setPayrollSort)} align="right" />
                      <SortHeader label={t.bonus} sortKey="bonus" currentSort={payrollSort} onSort={(k) => toggleSort(payrollSort, k, setPayrollSort)} align="right" />
                      <SortHeader label={t.deduction} sortKey="deduction" currentSort={payrollSort} onSort={(k) => toggleSort(payrollSort, k, setPayrollSort)} align="right" />
                      <SortHeader label={t.netSalary} sortKey="netSalary" currentSort={payrollSort} onSort={(k) => toggleSort(payrollSort, k, setPayrollSort)} align="right" />
                      <SortHeader label={t.status} sortKey="status" currentSort={payrollSort} onSort={(k) => toggleSort(payrollSort, k, setPayrollSort)} align="center" />
                      <th className="py-3 px-5 text-right text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap">{currentLanguage === 'tr' ? 'İşlemler' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sortData(payrolls.filter(p => 
                      p.employeeName.toLowerCase().includes(payrollSearch.toLowerCase())
                    ), payrollSort.key, payrollSort.dir).map(p => (
                      <tr key={p.id} className="hover:bg-gray-50 transition-all group">
                        <td className="py-3 px-5 font-bold text-gray-900">{p.employeeName}</td>
                        <td className="py-3 px-5 text-center text-gray-500">{p.month}/{p.year}</td>
                        <td className="py-3 px-5 text-right">₺{p.baseSalary.toLocaleString()}</td>
                        <td className="py-3 px-5 text-right text-green-600">+₺{p.bonus.toLocaleString()}</td>
                        <td className="py-3 px-5 text-right text-red-500">-₺{p.deduction.toLocaleString()}</td>
                        <td className="py-3 px-5 text-right font-bold text-gray-900">₺{p.netSalary.toLocaleString()}</td>
                        <td className="py-3 px-5 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.status === 'Ödendi' ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600'}`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="py-3 px-5 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {p.status === 'Taslak' && (
                              <button 
                                onClick={async () => {
                                  if (!isAuthenticated) return showToast(currentLanguage === 'tr' ? 'Lütfen giriş yapın.' : 'Please login.', 'error');
                                  try {
                                    await updateDoc(doc(db, 'payrolls', p.id as string), { status: 'Ödendi' });
                                    showToast(currentLanguage === 'tr' ? 'Bordro ödendi olarak işaretlendi.' : 'Payroll marked as paid.');
                                  } catch {
                                    showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'An error occurred.', 'error');
                                  }
                                }} 
                                className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-all"
                                title={currentLanguage === 'tr' ? 'Ödendi İşaretle' : 'Mark as Paid'}
                              >
                                <CheckCircle size={14} />
                              </button>
                            )}
                            <button 
                              onClick={async () => {
                                setConfirmModal({
                                  isOpen: true,
                                  title: currentLanguage === 'tr' ? 'Bordro Sil' : 'Delete Payroll',
                                  message: t.confirmDelete,
                                  onConfirm: async () => {
                                    try {
                                      await deleteDoc(doc(db, 'payrolls', p.id as string));
                                      showToast(currentLanguage === 'tr' ? 'Bordro silindi.' : 'Payroll deleted.');
                                      setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                    } catch (error) {
                                      logFirestoreError(error, OperationType.DELETE, `payrolls/${p.id}`);
                                      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error occurred.', 'error');
                                    }
                                  }
                                });
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
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

        {activeTab === 'leave' && (
          <motion.div key="leave" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
             <div className="flex items-center justify-between gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input 
                    type="text" 
                    placeholder={(currentLanguage === 'tr' ? 'İzin Taleplerinde Ara' : 'Search Leave Requests') + '...'} 
                    value={leaveSearch}
                    onChange={e => setLeaveSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-100 rounded-2xl shadow-sm outline-none focus:ring-2 focus:ring-[#ff4000]/20 transition-all text-sm"
                  />
                </div>
                <button 
                  onClick={() => setShowLeaveModal(true)}
                  className="apple-button-primary"
                >
                  <Plus size={16} /> {currentLanguage === 'tr' ? 'Yeni İzin Talebi' : 'New Leave Request'}
                </button>
             </div>

             <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
               <div className="overflow-x-auto">
                 <table className="w-full text-sm">
                   <thead>
                     <tr className="bg-gray-50 border-b border-gray-100">
                       <SortHeader label={t.name} sortKey="employeeName" currentSort={leaveSort} onSort={(k) => toggleSort(leaveSort, k, setLeaveSort)} />
                       <SortHeader label={currentLanguage === 'tr' ? 'Tür' : 'Type'} sortKey="type" currentSort={leaveSort} onSort={(k) => toggleSort(leaveSort, k, setLeaveSort)} />
                       <SortHeader label={currentLanguage === 'tr' ? 'Başlangıç' : 'Start'} sortKey="startDate" currentSort={leaveSort} onSort={(k) => toggleSort(leaveSort, k, setLeaveSort)} align="center" />
                       <SortHeader label={currentLanguage === 'tr' ? 'Bitiş' : 'End'} sortKey="endDate" currentSort={leaveSort} onSort={(k) => toggleSort(leaveSort, k, setLeaveSort)} align="center" />
                       <SortHeader label={currentLanguage === 'tr' ? 'Gün' : 'Days'} sortKey="days" currentSort={leaveSort} onSort={(k) => toggleSort(leaveSort, k, setLeaveSort)} align="right" />
                       <SortHeader label={t.status} sortKey="status" currentSort={leaveSort} onSort={(k) => toggleSort(leaveSort, k, setLeaveSort)} align="center" />
                       <th className="py-3 px-5 text-right text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap">{currentLanguage === 'tr' ? 'İşlemler' : 'Actions'}</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-gray-50">
                     {sortData(leaveRequests.filter(req => 
                       req.employeeName.toLowerCase().includes(leaveSearch.toLowerCase()) ||
                       req.type.toLowerCase().includes(leaveSearch.toLowerCase())
                     ), leaveSort.key, leaveSort.dir).map(req => (
                       <tr key={req.id} className="hover:bg-gray-50 transition-all group">
                         <td className="py-3 px-5 font-bold text-gray-900">{req.employeeName}</td>
                         <td className="py-3 px-5">
                           <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${req.type === 'Yıllık İzin' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                             {req.type}
                           </span>
                         </td>
                         <td className="py-3 px-5 text-center text-gray-500">{req.startDate}</td>
                         <td className="py-3 px-5 text-center text-gray-500">{req.endDate}</td>
                         <td className="py-3 px-5 text-right font-medium">{req.days}</td>
                         <td className="py-3 px-5 text-center">
                           <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${req.status === 'Onaylandı' ? 'bg-green-50 text-green-600' : req.status === 'Reddedildi' ? 'bg-red-50 text-red-600' : 'bg-yellow-50 text-yellow-600'}`}>
                             {req.status}
                           </span>
                         </td>
                         <td className="py-3 px-5 text-right">
                           <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                             <button 
                               onClick={() => updateDoc(doc(db, 'leaveRequests', req.id as string), { status: 'Onaylandı', approvalStatus: 'Onaylandı' })}
                               className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-all"
                               title={currentLanguage === 'tr' ? 'Onayla' : 'Approve'}
                             >
                               <CheckCircle size={14} />
                             </button>
                             <button 
                               onClick={() => updateDoc(doc(db, 'leaveRequests', req.id as string), { status: 'Reddedildi', approvalStatus: 'Reddedildi' })}
                               className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                               title={currentLanguage === 'tr' ? 'Reddet' : 'Reject'}
                             >
                               <X size={14} />
                             </button>
                             <button 
                               onClick={() => { setLeaveForm(req); setEditingLeaveId(req.id as string); setShowLeaveModal(true); }}
                               className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                             >
                               <Eye size={14} />
                             </button>
                             <button 
                               onClick={() => { setLeaveForm(req); setEditingLeaveId(req.id as string); setShowLeaveModal(true); }}
                               className="p-1.5 text-gray-400 hover:text-brand hover:bg-brand/10 rounded-lg transition-all"
                             >
                               <Edit2 size={14} />
                             </button>
                             <button 
                               onClick={async () => {
                                 setConfirmModal({
                                   isOpen: true,
                                   title: currentLanguage === 'tr' ? 'İzin Sil' : 'Delete Leave',
                                   message: t.confirmDelete,
                                   onConfirm: async () => {
                                     try {
                                       await deleteDoc(doc(db, 'leaveRequests', req.id as string));
                                       showToast(currentLanguage === 'tr' ? 'İzin silindi.' : 'Leave deleted.');
                                       setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                     } catch (error) {
                                       logFirestoreError(error, OperationType.DELETE, `leaveRequests/${req.id}`);
                                       showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error occurred.', 'error');
                                     }
                                   }
                                 });
                               }}
                               className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                               title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}
                             >
                               <Trash2 size={14} />
                             </button>
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

        {activeTab === 'performance' && (
          <motion.div key="performance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input 
                  type="text" 
                  placeholder={(currentLanguage === 'tr' ? 'Değerlendirmelerde Ara' : 'Search Reviews') + '...'} 
                  value={performanceSearch}
                  onChange={e => setPerformanceSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-100 rounded-2xl shadow-sm outline-none focus:ring-2 focus:ring-[#ff4000]/20 transition-all text-sm"
                />
              </div>
              <button onClick={() => setShowPerformanceModal(true)} className="apple-button-primary">
                <Plus size={16} /> {currentLanguage === 'tr' ? 'Yeni Değerlendirme' : 'New Review'}
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <SortHeader label={t.name} sortKey="employeeName" currentSort={performanceSort} onSort={(k) => toggleSort(performanceSort, k, setPerformanceSort)} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Değerlendiren' : 'Reviewer'} sortKey="reviewer" currentSort={performanceSort} onSort={(k) => toggleSort(performanceSort, k, setPerformanceSort)} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Tarih' : 'Date'} sortKey="date" currentSort={performanceSort} onSort={(k) => toggleSort(performanceSort, k, setPerformanceSort)} align="center" />
                      <SortHeader label={currentLanguage === 'tr' ? 'Puan' : 'Score'} sortKey="score" currentSort={performanceSort} onSort={(k) => toggleSort(performanceSort, k, setPerformanceSort)} align="center" />
                      <th className="py-3 px-5 text-right text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap">{currentLanguage === 'tr' ? 'İşlemler' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sortData(performanceReviews.filter(rev => 
                      rev.employeeName.toLowerCase().includes(performanceSearch.toLowerCase()) ||
                      rev.reviewer.toLowerCase().includes(performanceSearch.toLowerCase())
                    ), performanceSort.key, performanceSort.dir).map(rev => (
                      <tr key={rev.id} className="hover:bg-gray-50 transition-all group">
                        <td className="py-3 px-5 font-bold text-gray-900">{rev.employeeName}</td>
                        <td className="py-3 px-5 text-gray-600">{rev.reviewer}</td>
                        <td className="py-3 px-5 text-center text-gray-500">{rev.date}</td>
                        <td className="py-3 px-5 text-center">
                          <div className="flex items-center justify-center gap-1 text-[#ff4000]">
                            <Star size={12} fill="currentColor" />
                            <span className="font-bold">{rev.score}/5</span>
                          </div>
                        </td>
                        <td className="py-3 px-5 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => { setPerformanceForm(rev); setEditingPerformanceId(rev.id); setShowPerformanceModal(true); }}
                              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                            >
                              <Eye size={14} />
                            </button>
                            <button 
                              onClick={() => { setPerformanceForm(rev); setEditingPerformanceId(rev.id); setShowPerformanceModal(true); }}
                              className="p-1.5 text-gray-400 hover:text-brand hover:bg-brand/10 rounded-lg transition-all"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button 
                              onClick={async () => {
                                setConfirmModal({
                                  isOpen: true,
                                  title: currentLanguage === 'tr' ? 'Değerlendirme Sil' : 'Delete Review',
                                  message: t.confirmDelete,
                                  onConfirm: async () => {
                                    try {
                                      await deleteDoc(doc(db, 'performanceReviews', rev.id));
                                      showToast(currentLanguage === 'tr' ? 'Değerlendirme silindi.' : 'Review deleted.');
                                      setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                    } catch (error) {
                                      logFirestoreError(error, OperationType.DELETE, `performanceReviews/${rev.id}`);
                                      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error occurred.', 'error');
                                    }
                                  }
                                });
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                              title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}
                            >
                              <Trash2 size={14} />
                            </button>
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

        {activeTab === 'training' && (
          <motion.div key="training" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input 
                  type="text" 
                  placeholder={(currentLanguage === 'tr' ? 'Eğitimlerde Ara' : 'Search Trainings') + '...'} 
                  value={trainingSearch}
                  onChange={e => setTrainingSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-100 rounded-2xl shadow-sm outline-none focus:ring-2 focus:ring-[#ff4000]/20 transition-all text-sm"
                />
              </div>
              <button onClick={() => setShowTrainingModal(true)} className="apple-button-primary">
                <Plus size={16} /> {currentLanguage === 'tr' ? 'Yeni Eğitim' : 'New Training'}
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <SortHeader label={t.name} sortKey="employeeName" currentSort={trainingSort} onSort={(k) => toggleSort(trainingSort, k, setTrainingSort)} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Eğitim Adı' : 'Training Title'} sortKey="title" currentSort={trainingSort} onSort={(k) => toggleSort(trainingSort, k, setTrainingSort)} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Sağlayıcı' : 'Provider'} sortKey="provider" currentSort={trainingSort} onSort={(k) => toggleSort(trainingSort, k, setTrainingSort)} />
                      <SortHeader label={t.status} sortKey="status" currentSort={trainingSort} onSort={(k) => toggleSort(trainingSort, k, setTrainingSort)} align="center" />
                      <SortHeader label={t.startDate} sortKey="date" currentSort={trainingSort} onSort={(k) => toggleSort(trainingSort, k, setTrainingSort)} align="center" />
                      <th className="py-3 px-5 text-right text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap">{currentLanguage === 'tr' ? 'İşlemler' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sortData(trainings.filter(tr => 
                      tr.employeeName.toLowerCase().includes(trainingSearch.toLowerCase()) ||
                      tr.title.toLowerCase().includes(trainingSearch.toLowerCase())
                    ), trainingSort.key, trainingSort.dir).map(tr => (
                      <tr key={tr.id} className="hover:bg-gray-50 transition-all group">
                        <td className="py-3 px-5 font-bold text-gray-900">{tr.employeeName}</td>
                        <td className="py-3 px-5 text-gray-600">{tr.title}</td>
                        <td className="py-3 px-5 text-gray-500">{tr.provider}</td>
                        <td className="py-3 px-5 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tr.status === 'Tamamlandı' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                            {tr.status}
                          </span>
                        </td>
                        <td className="py-3 px-5 text-center text-gray-400">{tr.date}</td>
                        <td className="py-3 px-5 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => { setTrainingForm(tr); setEditingTrainingId(tr.id); setShowTrainingModal(true); }}
                              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                            >
                              <Eye size={14} />
                            </button>
                            <button 
                              onClick={() => { setTrainingForm(tr); setEditingTrainingId(tr.id); setShowTrainingModal(true); }}
                              className="p-1.5 text-gray-400 hover:text-brand hover:bg-brand/10 rounded-lg transition-all"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button 
                              onClick={async () => {
                                setConfirmModal({
                                  isOpen: true,
                                  title: currentLanguage === 'tr' ? 'Eğitim Sil' : 'Delete Training',
                                  message: t.confirmDelete,
                                  onConfirm: async () => {
                                    try {
                                      await deleteDoc(doc(db, 'trainings', tr.id));
                                      showToast(currentLanguage === 'tr' ? 'Eğitim silindi.' : 'Training deleted.');
                                      setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                    } catch (error) {
                                      logFirestoreError(error, OperationType.DELETE, `trainings/${tr.id}`);
                                      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error occurred.', 'error');
                                    }
                                  }
                                });
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                              title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}
                            >
                              <Trash2 size={14} />
                            </button>
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

        {activeTab === 'travel' && (
          <motion.div key="travel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input 
                  type="text" 
                  placeholder={(currentLanguage === 'tr' ? 'Taleplerde Ara' : 'Search Requests') + '...'} 
                  value={travelSearch}
                  onChange={e => setTravelSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-100 rounded-2xl shadow-sm outline-none focus:ring-2 focus:ring-[#ff4000]/20 transition-all text-sm"
                />
              </div>
              <button onClick={() => setShowTravelModal(true)} className="apple-button-primary">
                <Plus size={16} /> {currentLanguage === 'tr' ? 'Yeni Talep' : 'New Request'}
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <SortHeader label={t.name} sortKey="employeeName" currentSort={travelSort} onSort={(k) => toggleSort(travelSort, k, setTravelSort)} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Varış Yeri' : 'Destination'} sortKey="destination" currentSort={travelSort} onSort={(k) => toggleSort(travelSort, k, setTravelSort)} />
                      <SortHeader label={t.startDate} sortKey="startDate" currentSort={travelSort} onSort={(k) => toggleSort(travelSort, k, setTravelSort)} align="center" />
                      <SortHeader label={t.endDate} sortKey="endDate" currentSort={travelSort} onSort={(k) => toggleSort(travelSort, k, setTravelSort)} align="center" />
                      <SortHeader label={currentLanguage === 'tr' ? 'Avans' : 'Advance'} sortKey="advanceAmount" currentSort={travelSort} onSort={(k) => toggleSort(travelSort, k, setTravelSort)} align="right" />
                      <SortHeader label={t.status} sortKey="status" currentSort={travelSort} onSort={(k) => toggleSort(travelSort, k, setTravelSort)} align="center" />
                      <th className="py-3 px-5 text-right text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap">{currentLanguage === 'tr' ? 'İşlemler' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sortData(travelRequests.filter(req => 
                      req.employeeName.toLowerCase().includes(travelSearch.toLowerCase()) ||
                      req.destination.toLowerCase().includes(travelSearch.toLowerCase())
                    ), travelSort.key, travelSort.dir).map(req => (
                      <tr key={req.id} className="hover:bg-gray-50 transition-all group">
                        <td className="py-3 px-5 font-bold text-gray-900">{req.employeeName}</td>
                        <td className="py-3 px-5 text-gray-600">{req.destination}</td>
                        <td className="py-3 px-5 text-center text-gray-500">{req.startDate}</td>
                        <td className="py-3 px-5 text-center text-gray-500">{req.endDate}</td>
                        <td className="py-3 px-5 text-right font-bold">₺{req.advanceAmount.toLocaleString()}</td>
                        <td className="py-3 px-5 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${req.status === 'Onaylandı' ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600'}`}>
                            {req.status}
                          </span>
                        </td>
                        <td className="py-3 px-5 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {req.status === 'Bekliyor' && (
                              <>
                                <button 
                                  onClick={() => updateDoc(doc(db, 'travelRequests', req.id), { status: 'Onaylandı', approvalStatus: 'Onaylandı' })}
                                  className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-all"
                                  title={currentLanguage === 'tr' ? 'Onayla' : 'Approve'}
                                >
                                  <CheckCircle size={14} />
                                </button>
                                <button 
                                  onClick={() => updateDoc(doc(db, 'travelRequests', req.id), { status: 'Reddedildi', approvalStatus: 'Reddedildi' })}
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                  title={currentLanguage === 'tr' ? 'Reddet' : 'Reject'}
                                >
                                  <X size={14} />
                                </button>
                              </>
                            )}
                            <button 
                              onClick={() => { setTravelForm(req); setEditingTravelId(req.id); setShowTravelModal(true); }}
                              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                            >
                              <Eye size={14} />
                            </button>
                            <button 
                              onClick={() => { setTravelForm(req); setEditingTravelId(req.id); setShowTravelModal(true); }}
                              className="p-1.5 text-gray-400 hover:text-brand hover:bg-brand/10 rounded-lg transition-all"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button 
                              onClick={async () => {
                                setConfirmModal({
                                  isOpen: true,
                                  title: currentLanguage === 'tr' ? 'Talep Sil' : 'Delete Request',
                                  message: t.confirmDelete,
                                  onConfirm: async () => {
                                    try {
                                      await deleteDoc(doc(db, 'travelRequests', req.id));
                                      showToast(currentLanguage === 'tr' ? 'Talep silindi.' : 'Request deleted.');
                                      setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                    } catch (error) {
                                      logFirestoreError(error, OperationType.DELETE, `travelRequests/${req.id}`);
                                      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error occurred.', 'error');
                                    }
                                  }
                                });
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                              title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}
                            >
                              <Trash2 size={14} />
                            </button>
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
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {showEmployeeModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowEmployeeModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni Çalışan' : 'New Employee'}</h3>
                <button onClick={() => setShowEmployeeModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto scrollbar-none">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Çalışan ID</label>
                    <input type="text" value={employeeForm.employeeId} onChange={e => setEmployeeForm({...employeeForm, employeeId: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">TC No</label>
                    <input type="text" value={employeeForm.tcId} onChange={e => setEmployeeForm({...employeeForm, tcId: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.name}</label>
                  <input type="text" value={employeeForm.name} onChange={e => setEmployeeForm({...employeeForm, name: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.position}</label>
                    <input type="text" value={employeeForm.position} onChange={e => setEmployeeForm({...employeeForm, position: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.department}</label>
                    <input type="text" value={employeeForm.department} onChange={e => setEmployeeForm({...employeeForm, department: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.salary}</label>
                    <div className="flex gap-2">
                      <input type="number" value={employeeForm.salary} onChange={e => setEmployeeForm({...employeeForm, salary: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                      <select value={employeeForm.salaryCurrency} onChange={e => setEmployeeForm({...employeeForm, salaryCurrency: e.target.value})} className="px-2 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm">
                        <option value="TRY">TRY</option>
                        <option value="EUR">EUR</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.startDate}</label>
                    <input type="date" value={employeeForm.startDate} onChange={e => setEmployeeForm({...employeeForm, startDate: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Rol</label>
                    <select value={employeeForm.role} onChange={e => setEmployeeForm({...employeeForm, role: e.target.value as 'Employee' | 'Manager' | 'Admin'})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm">
                      <option value="Employee">Çalışan</option>
                      <option value="Manager">Yönetici</option>
                      <option value="Admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Şehir</label>
                    <input type="text" value={employeeForm.city} onChange={e => setEmployeeForm({...employeeForm, city: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button onClick={() => setShowEmployeeModal(false)} className="apple-button-secondary flex-1">{t.cancel}</button>
                <button onClick={handleSaveEmployee} className="apple-button-primary flex-1">{t.save}</button>
              </div>
            </motion.div>
          </div>
        )}

        {showLeaveModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowLeaveModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni İzin Talebi' : 'New Leave Request'}</h3>
                <button onClick={() => setShowLeaveModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.employees}</label>
                  <select 
                    value={leaveForm.employeeId} 
                    onChange={e => setLeaveForm({...leaveForm, employeeId: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm"
                  >
                    <option value="">{currentLanguage === 'tr' ? 'Çalışan Seçin' : 'Select Employee'}</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Başlangıç' : 'Start'}</label>
                    <input type="date" value={leaveForm.startDate} onChange={e => setLeaveForm({...leaveForm, startDate: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Bitiş' : 'End'}</label>
                    <input type="date" value={leaveForm.endDate} onChange={e => setLeaveForm({...leaveForm, endDate: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'İzin Türü' : 'Leave Type'}</label>
                  <select 
                    value={leaveForm.type} 
                    onChange={e => setLeaveForm({...leaveForm, type: e.target.value as 'Yıllık İzin' | 'Hastalık' | 'Mazeret' | 'Diğer'})}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm"
                  >
                    <option value="Yıllık İzin">Yıllık İzin</option>
                    <option value="Hastalık">Hastalık</option>
                    <option value="Mazeret">Mazeret</option>
                    <option value="Diğer">Diğer</option>
                  </select>
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button onClick={() => setShowLeaveModal(false)} className="apple-button-secondary flex-1">{t.cancel}</button>
                <button onClick={handleSaveLeave} className="apple-button-primary flex-1">{t.save}</button>
              </div>
            </motion.div>
          </div>
        )}

        {showPayrollModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowPayrollModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Bordro Hesapla' : 'Calculate Payroll'}</h3>
                <button onClick={() => setShowPayrollModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.employees}</label>
                  <select 
                    value={payrollForm.employeeId} 
                    onChange={e => {
                      const emp = employees.find(emp => emp.id === e.target.value);
                      setPayrollForm({...payrollForm, employeeId: e.target.value, baseSalary: emp?.salary || 0});
                    }}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm"
                  >
                    <option value="">{currentLanguage === 'tr' ? 'Çalışan Seçin' : 'Select Employee'}</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.month}</label>
                    <input type="number" min="1" max="12" value={payrollForm.month} onChange={e => setPayrollForm({...payrollForm, month: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.year}</label>
                    <input type="number" value={payrollForm.year} onChange={e => setPayrollForm({...payrollForm, year: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.bonus}</label>
                    <input type="number" value={payrollForm.bonus} onChange={e => setPayrollForm({...payrollForm, bonus: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.deduction}</label>
                    <input type="number" value={payrollForm.deduction} onChange={e => setPayrollForm({...payrollForm, deduction: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Para Birimi</label>
                  <select value={payrollForm.currency} onChange={e => setPayrollForm({...payrollForm, currency: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm">
                    <option value="TRY">TRY</option>
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-gray-500">{t.netSalary}</span>
                    <span className="text-xl font-bold text-[#ff4000]">₺{((payrollForm.baseSalary || 0) + (payrollForm.bonus || 0) - (payrollForm.deduction || 0)).toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button onClick={() => setShowPayrollModal(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-all">{t.cancel}</button>
                <button onClick={handleAddPayroll} className="apple-button-primary flex-1 justify-center py-3 rounded-2xl">{t.save}</button>
              </div>
            </motion.div>
          </div>
        )}

        {showPerformanceModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowPerformanceModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni Değerlendirme' : 'New Review'}</h3>
                <button onClick={() => setShowPerformanceModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.employees}</label>
                  <select value={performanceForm.employeeId} onChange={e => setPerformanceForm({...performanceForm, employeeId: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm">
                    <option value="">{currentLanguage === 'tr' ? 'Çalışan Seçin' : 'Select Employee'}</option>
                    {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Değerlendiren' : 'Reviewer'}</label>
                    <input type="text" value={performanceForm.reviewer} onChange={e => setPerformanceForm({...performanceForm, reviewer: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Puan (1-5)' : 'Score (1-5)'}</label>
                    <input type="number" min="1" max="5" value={performanceForm.score} onChange={e => setPerformanceForm({...performanceForm, score: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Yorumlar' : 'Comments'}</label>
                  <textarea value={performanceForm.comments} onChange={e => setPerformanceForm({...performanceForm, comments: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm h-24 resize-none" />
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button onClick={() => setShowPerformanceModal(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-all">{t.cancel}</button>
                <button onClick={handleSavePerformance} className="apple-button-primary flex-1 justify-center py-3 rounded-2xl">{t.save}</button>
              </div>
            </motion.div>
          </div>
        )}

        {showTrainingModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTrainingModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni Eğitim' : 'New Training'}</h3>
                <button onClick={() => setShowTrainingModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.employees}</label>
                  <select value={trainingForm.employeeId} onChange={e => setTrainingForm({...trainingForm, employeeId: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm">
                    <option value="">{currentLanguage === 'tr' ? 'Çalışan Seçin' : 'Select Employee'}</option>
                    {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Eğitim Adı' : 'Training Title'}</label>
                  <input type="text" value={trainingForm.title} onChange={e => setTrainingForm({...trainingForm, title: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Sağlayıcı' : 'Provider'}</label>
                    <input type="text" value={trainingForm.provider} onChange={e => setTrainingForm({...trainingForm, provider: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.startDate}</label>
                    <input type="date" value={trainingForm.date} onChange={e => setTrainingForm({...trainingForm, date: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button onClick={() => setShowTrainingModal(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-all">{t.cancel}</button>
                <button onClick={handleSaveTraining} className="apple-button-primary flex-1 justify-center py-3 rounded-2xl">{t.save}</button>
              </div>
            </motion.div>
          </div>
        )}

        {showTravelModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTravelModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni Talep' : 'New Request'}</h3>
                <button onClick={() => setShowTravelModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{t.employees}</label>
                  <select value={travelForm.employeeId} onChange={e => setTravelForm({...travelForm, employeeId: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm">
                    <option value="">{currentLanguage === 'tr' ? 'Çalışan Seçin' : 'Select Employee'}</option>
                    {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Varış Noktası' : 'Destination'}</label>
                  <input type="text" value={travelForm.destination} onChange={e => setTravelForm({...travelForm, destination: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Başlangıç' : 'Start'}</label>
                    <input type="date" value={travelForm.startDate} onChange={e => setTravelForm({...travelForm, startDate: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Bitiş' : 'End'}</label>
                    <input type="date" value={travelForm.endDate} onChange={e => setTravelForm({...travelForm, endDate: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Avans Tutarı' : 'Advance Amount'}</label>
                  <input type="number" value={travelForm.advanceAmount} onChange={e => setTravelForm({...travelForm, advanceAmount: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button onClick={() => setShowTravelModal(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-all">{t.cancel}</button>
                <button onClick={handleSaveTravel} className="apple-button-primary flex-1 justify-center py-3 rounded-2xl">{t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
            className={`fixed bottom-6 right-6 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-white ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}
          >
            {toast.type === 'success' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
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
}
