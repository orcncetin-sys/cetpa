import React, { useState, useEffect } from 'react';
import { 
  Gavel, Users, FileText, Calendar, Plus, Search, Edit2, Trash2, Download, AlertCircle,
  Shield, Scale, Briefcase, UserPlus, CheckCircle2, X, Eye, TrendingUp
} from 'lucide-react';
import { 
  collection, addDoc, updateDoc, deleteDoc, doc, 
  onSnapshot, query, orderBy, serverTimestamp 
} from 'firebase/firestore';
import { db } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import ModuleHeader from './ModuleHeader';
import { logFirestoreError, OperationType } from '../utils/firebase';
import { cn } from '../lib/utils';

import { 
  BoardMeeting, 
  Shareholder
} from '../types';

interface CorporateGovernanceModuleProps {
  currentLanguage: 'tr' | 'en';
  isAuthenticated?: boolean;
  userRole?: string | null;
  onNavigate?: (tab: string) => void;
}

export default function CorporateGovernanceModule({ currentLanguage, isAuthenticated, userRole, onNavigate }: CorporateGovernanceModuleProps) {
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };
  const [activeTab, setActiveTab] = useState<'board' | 'assembly' | 'shareholders' | 'legal' | 'contracts'>('board');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const SortHeader = ({ label, sortKey, align = 'left' }: { label: string; sortKey: string; align?: 'left' | 'right' | 'center' }) => (
    <th 
      className={cn(
        "py-4 px-6 text-[#86868B] font-bold uppercase tracking-wider cursor-pointer select-none group hover:text-[#ff4000] transition-colors text-[10px]",
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      )}
      onClick={() => handleSort(sortKey)}
    >
      <div className={cn("flex items-center gap-1", align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start')}>
        {label}
        <TrendingUp className={cn(
          "w-3 h-3 transition-all opacity-0 group-hover:opacity-100",
          sortConfig?.key === sortKey ? "opacity-100 text-[#ff4000]" : "text-gray-300",
          sortConfig?.key === sortKey && sortConfig.direction === 'desc' ? "rotate-180" : ""
        )} />
      </div>
    </th>
  );

  // Data States
  const [boardMeetings, setBoardMeetings] = useState<BoardMeeting[]>([]);
  const [shareholders, setShareholders] = useState<Shareholder[]>([]);
  const [assemblyMeetings, setAssemblyMeetings] = useState<Array<{id: string; title: string; date: string; type: string; decisions: string; attendees: string}>>([]);
  const [contracts, setContracts] = useState<Array<{id: string; title: string; party: string; date: string; expiryDate?: string; type: string; status: string}>>([]);

  // Modal States
  const [showBoardModal, setShowBoardModal] = useState(false);
  const [showShareholderModal, setShowShareholderModal] = useState(false);
  const [showAssemblyModal, setShowAssemblyModal] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [editingShareholderId, setEditingShareholderId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean, title: string, message: string, onConfirm: () => void } | null>(null);

  // Form States
  const [boardForm, setBoardForm] = useState({
    title: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    location: '',
    attendees: '',
    decisions: '',
    status: 'Planlandı' // Planlandı, Tamamlandı, İptal
  });

  const [shareholderForm, setShareholderForm] = useState({
    name: '',
    shareCount: 0,
    sharePercentage: 0,
    type: 'Gerçek Kişi', // Gerçek Kişi, Tüzel Kişi
    contact: ''
  });

  const [assemblyForm, setAssemblyForm] = useState({
    title: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    type: 'Olağan', // Olağan, Olağanüstü
    decisions: '',
    attendees: ''
  });

  const [contractForm, setContractForm] = useState({
    title: '',
    party: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    expiryDate: '',
    type: 'Hizmet', // Hizmet, Gizlilik, Satış, Kira
    status: 'Aktif' // Aktif, Süresi Dolmuş, İptal
  });

  useEffect(() => {
    if (!isAuthenticated || !userRole) return;
    const unsubBoard = onSnapshot(query(collection(db, 'boardMeetings'), orderBy('date', 'desc')), (snap) => {
      setBoardMeetings(snap.docs.map(d => ({ id: d.id, ...d.data() } as BoardMeeting)));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'boardMeetings'));

    const t1 = setTimeout(() => {
      const unsubShareholders = onSnapshot(collection(db, 'shareholders'), (snap) => {
        setShareholders(snap.docs.map(d => ({ id: d.id, ...d.data() } as Shareholder)));
      }, (error) => logFirestoreError(error, OperationType.LIST, 'shareholders'));
      return () => unsubShareholders();
    }, 150);

    const t2 = setTimeout(() => {
      const unsubAssembly = onSnapshot(query(collection(db, 'assemblyMeetings'), orderBy('date', 'desc')), (snap) => {
        setAssemblyMeetings(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
      }, (error) => logFirestoreError(error, OperationType.LIST, 'assemblyMeetings'));
      return () => unsubAssembly();
    }, 300);

    const t3 = setTimeout(() => {
      const unsubContracts = onSnapshot(query(collection(db, 'contracts'), orderBy('createdAt', 'desc')), (snap) => {
        setContracts(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
      }, (error) => logFirestoreError(error, OperationType.LIST, 'contracts'));
      return () => unsubContracts();
    }, 450);

    return () => {
      unsubBoard();
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isAuthenticated, userRole]);

  const handleSaveBoardMeeting = async () => {
    try {
      if (editingMeetingId) {
        await updateDoc(doc(db, 'boardMeetings', editingMeetingId), {
          ...boardForm,
          updatedAt: serverTimestamp()
        });
        showToast(currentLanguage === 'tr' ? 'Toplantı güncellendi.' : 'Meeting updated.');
      } else {
        await addDoc(collection(db, 'boardMeetings'), {
          ...boardForm,
          createdAt: serverTimestamp()
        });
        showToast(currentLanguage === 'tr' ? 'Toplantı kaydedildi.' : 'Meeting saved.');
      }
      setShowBoardModal(false);
      setEditingMeetingId(null);
      setBoardForm({ title: '', date: format(new Date(), 'yyyy-MM-dd'), location: '', attendees: '', decisions: '', status: 'Planlandı' });
    } catch (error) {
      console.error(error);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error occurred.', 'error');
    }
  };

  const handleSaveShareholder = async () => {
    try {
      if (editingShareholderId) {
        await updateDoc(doc(db, 'shareholders', editingShareholderId), {
          ...shareholderForm,
          updatedAt: serverTimestamp()
        });
        showToast(currentLanguage === 'tr' ? 'Ortak güncellendi.' : 'Shareholder updated.');
      } else {
        await addDoc(collection(db, 'shareholders'), {
          ...shareholderForm,
          updatedAt: serverTimestamp()
        });
        showToast(currentLanguage === 'tr' ? 'Ortak kaydedildi.' : 'Shareholder saved.');
      }
      setShowShareholderModal(false);
      setEditingShareholderId(null);
      setShareholderForm({ name: '', shareCount: 0, sharePercentage: 0, type: 'Gerçek Kişi', contact: '' });
    } catch (error) {
      console.error(error);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error occurred.', 'error');
    }
  };

  const handleSaveAssembly = async () => {
    try {
      await addDoc(collection(db, 'assemblyMeetings'), {
        ...assemblyForm,
        createdAt: serverTimestamp()
      });
      showToast(currentLanguage === 'tr' ? 'Genel Kurul kaydı eklendi.' : 'Assembly record added.');
      setShowAssemblyModal(false);
      setAssemblyForm({ title: '', date: format(new Date(), 'yyyy-MM-dd'), type: 'Olağan', decisions: '', attendees: '' });
    } catch (error) {
      console.error(error);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error occurred.', 'error');
    }
  };

  const handleSaveContract = async () => {
    try {
      await addDoc(collection(db, 'contracts'), {
        ...contractForm,
        createdAt: serverTimestamp()
      });
      showToast(currentLanguage === 'tr' ? 'Sözleşme eklendi.' : 'Contract added.');
      setShowContractModal(false);
      setContractForm({ title: '', party: '', date: format(new Date(), 'yyyy-MM-dd'), expiryDate: '', type: 'Hizmet', status: 'Aktif' });
    } catch (error) {
      console.error(error);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu.' : 'Error occurred.', 'error');
    }
  };

  const tabs = [
    { id: 'board', label: currentLanguage === 'tr' ? 'Yönetim Kurulu' : 'Board of Directors', icon: Gavel },
    { id: 'assembly', label: currentLanguage === 'tr' ? 'Genel Kurul' : 'General Assembly', icon: Users },
    { id: 'shareholders', label: currentLanguage === 'tr' ? 'Pay Sahipleri' : 'Shareholders', icon: UserPlus },
    { id: 'contracts', label: currentLanguage === 'tr' ? 'Sözleşmeler' : 'Contracts', icon: FileText },
    { id: 'legal', label: currentLanguage === 'tr' ? 'Hukuk & Uyum' : 'Legal & Compliance', icon: Scale },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <ModuleHeader
        title={currentLanguage === 'tr' ? 'Kurumsal Yönetim' : 'Corporate Governance'}
        subtitle={currentLanguage === 'tr' ? 'A.Ş. yönetim süreçleri, toplantılar ve paydaş yönetimi' : 'Joint-stock company management, meetings, and stakeholder management'}
        icon={Briefcase}
        actionButton={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input 
                type="text" 
                placeholder={currentLanguage === 'tr' ? 'Ara...' : 'Search...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#ff4000]/20 outline-none w-full sm:w-64 transition-all"
              />
            </div>
            {isAuthenticated && activeTab === 'board' && (
              <button onClick={() => setShowBoardModal(true)} className="apple-button-primary">
                <Plus size={18} /> {currentLanguage === 'tr' ? 'Yeni Toplantı' : 'New Meeting'}
              </button>
            )}
            {isAuthenticated && activeTab === 'shareholders' && (
              <button onClick={() => setShowShareholderModal(true)} className="apple-button-primary">
                <Plus size={18} /> {currentLanguage === 'tr' ? 'Yeni Ortak' : 'New Shareholder'}
              </button>
            )}
            {isAuthenticated && activeTab === 'assembly' && (
              <button onClick={() => setShowAssemblyModal(true)} className="apple-button-primary">
                <Plus size={18} /> {currentLanguage === 'tr' ? 'Yeni Kayıt' : 'New Record'}
              </button>
            )}
            {isAuthenticated && activeTab === 'contracts' && (
              <button onClick={() => setShowContractModal(true)} className="apple-button-primary">
                <Plus size={18} /> {currentLanguage === 'tr' ? 'Yeni Sözleşme' : 'New Contract'}
              </button>
            )}
          </div>
        }
      />

      {/* Tabs */}
      <div className="overflow-x-auto scrollbar-none -mx-4 px-4">
        <div className="flex gap-2 p-1 bg-gray-100/50 rounded-2xl w-max">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as 'board' | 'assembly' | 'shareholders' | 'legal' | 'contracts')}
                className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === tab.id
                  ? 'bg-white text-[#ff4000] shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'board' && (
          <motion.div key="board" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input 
                type="text" 
                placeholder={currentLanguage === 'tr' ? 'Toplantı Ara...' : 'Search Meeting...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#ff4000]/20 outline-none w-full transition-all"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {boardMeetings.filter(m => m.title.toLowerCase().includes(searchQuery.toLowerCase())).map(meeting => (
              <div key={meeting.id} className="apple-card p-6 space-y-4">
                <div className="flex justify-between items-start">
                  <div className="bg-orange-50 p-3 rounded-2xl">
                    <Calendar className="text-[#ff4000]" size={24} />
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                    meeting.status === 'Tamamlandı' ? 'bg-green-50 text-green-600' :
                    meeting.status === 'İptal' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                  }`}>
                    {meeting.status === 'Tamamlandı' ? (currentLanguage === 'tr' ? 'Tamamlandı' : 'Completed') :
                     meeting.status === 'İptal' ? (currentLanguage === 'tr' ? 'İptal' : 'Cancelled') :
                     (currentLanguage === 'tr' ? 'Planlandı' : 'Planned')}
                  </span>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900">{meeting.title}</h4>
                  <p className="text-xs text-gray-500">{meeting.date} • {meeting.location}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Kararlar' : 'Decisions'}</p>
                  <p className="text-sm text-gray-600 line-clamp-3">{meeting.decisions}</p>
                </div>
                <div className="pt-4 border-t border-gray-50 flex justify-between items-center">
                  <span className="text-[10px] text-gray-400">{meeting.attendees.split(',').length} {currentLanguage === 'tr' ? 'Katılımcı' : 'Attendees'}</span>
                  <div className="flex gap-2">
                    {isAuthenticated && (
                      <>
                        <button 
                          onClick={() => {
                            setBoardForm({
                              title: meeting.title,
                              date: meeting.date,
                              location: meeting.location,
                              attendees: meeting.attendees,
                              decisions: meeting.decisions,
                              status: meeting.status
                            });
                            setEditingMeetingId(meeting.id);
                            setShowBoardModal(true);
                          }}
                          className="p-2 hover:bg-blue-50 rounded-xl text-gray-400 hover:text-blue-600 transition-all"
                          title={currentLanguage === 'tr' ? 'İncele' : 'View'}
                        >
                          <Eye size={16} />
                        </button>
                        <button 
                          onClick={() => {
                            setBoardForm({
                              title: meeting.title,
                              date: meeting.date,
                              location: meeting.location,
                              attendees: meeting.attendees,
                              decisions: meeting.decisions,
                              status: meeting.status
                            });
                            setEditingMeetingId(meeting.id);
                            setShowBoardModal(true);
                          }}
                          className="p-2 hover:bg-gray-50 rounded-xl text-gray-400 hover:text-blue-600 transition-all"
                          title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => setConfirmModal({
                            isOpen: true,
                            title: currentLanguage === 'tr' ? 'Toplantıyı Sil' : 'Delete Meeting',
                            message: currentLanguage === 'tr' ? 'Bu toplantı kaydını silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this meeting record?',
                            onConfirm: async () => {
                              await deleteDoc(doc(db, 'boardMeetings', meeting.id));
                              showToast(currentLanguage === 'tr' ? 'Silindi' : 'Deleted');
                            }
                          })}
                          className="p-2 hover:bg-red-50 rounded-xl text-gray-400 hover:text-red-600 transition-all"
                          title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}
                        ><Trash2 size={16} /></button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            </div>
          </motion.div>
        )}

        {activeTab === 'shareholders' && (
          <motion.div key="shareholders" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input 
                type="text" 
                placeholder={currentLanguage === 'tr' ? 'Pay Sahibi Ara...' : 'Search Shareholder...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#ff4000]/20 outline-none w-full transition-all"
              />
            </div>
            <div className="apple-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <SortHeader label={currentLanguage === 'tr' ? 'Ad Soyad / Ünvan' : 'Name / Title'} sortKey="name" />
                  <SortHeader label={currentLanguage === 'tr' ? 'Tür' : 'Type'} sortKey="type" />
                  <SortHeader label={currentLanguage === 'tr' ? 'Pay Adedi' : 'Share Count'} sortKey="shareCount" align="right" />
                  <SortHeader label={currentLanguage === 'tr' ? 'Pay Oranı' : 'Share %'} sortKey="sharePercentage" align="right" />
                  <th className="text-center py-4 px-6 font-bold text-gray-500 uppercase tracking-wider text-[10px]">{currentLanguage === 'tr' ? 'İşlemler' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[...shareholders]
                  .filter(sh => sh.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .sort((a, b) => {
                    if (!sortConfig) return 0;
                    const { key, direction } = sortConfig;
                    const aVal = a[key as keyof Shareholder];
                    const bVal = b[key as keyof Shareholder];
                    if (aVal !== undefined && bVal !== undefined) {
                      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
                      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
                    }
                    return 0;
                  })
                  .map(sh => (
                  <tr key={sh.id} className="hover:bg-gray-50/50 transition-all">
                    <td className="py-4 px-6 font-bold text-gray-900">{sh.name}</td>
                    <td className="py-4 px-6">
                      <span className="px-2 py-1 bg-gray-100 rounded-lg text-[10px] font-bold text-gray-600">
                        {sh.type === 'Gerçek Kişi' ? (currentLanguage === 'tr' ? 'Gerçek Kişi' : 'Natural Person') :
                         sh.type === 'Tüzel Kişi' ? (currentLanguage === 'tr' ? 'Tüzel Kişi' : 'Legal Entity') : sh.type}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right font-mono">{sh.shareCount.toLocaleString()}</td>
                    <td className="py-4 px-6 text-right font-bold text-[#ff4000]">{sh.sharePercentage}%</td>
                    <td className="py-4 px-6 text-center">
                      {isAuthenticated && (
                        <div className="flex justify-center gap-2">
                          <button 
                            onClick={() => {
                              setShareholderForm({
                                name: sh.name,
                                shareCount: sh.shareCount,
                                sharePercentage: sh.sharePercentage,
                                type: sh.type,
                                contact: sh.contact || ''
                              });
                              setEditingShareholderId(sh.id);
                              setShowShareholderModal(true);
                            }}
                            className="p-2 hover:bg-blue-50 rounded-xl text-blue-600 transition-all"
                            title={currentLanguage === 'tr' ? 'İncele' : 'View'}
                          >
                            <Eye size={16} />
                          </button>
                          <button 
                            onClick={() => {
                              setShareholderForm({
                                name: sh.name,
                                shareCount: sh.shareCount,
                                sharePercentage: sh.sharePercentage,
                                type: sh.type,
                                contact: sh.contact || ''
                              });
                              setEditingShareholderId(sh.id);
                              setShowShareholderModal(true);
                            }}
                            className="p-2 hover:bg-gray-100 rounded-xl text-gray-600 transition-all"
                            title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button 
                            onClick={() => setConfirmModal({
                              isOpen: true,
                              title: currentLanguage === 'tr' ? 'Ortağı Sil' : 'Delete Shareholder',
                              message: currentLanguage === 'tr' ? 'Bu ortağı silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this shareholder?',
                              onConfirm: async () => {
                                await deleteDoc(doc(db, 'shareholders', sh.id));
                                showToast(currentLanguage === 'tr' ? 'Silindi' : 'Deleted');
                              }
                            })}
                            className="p-2 hover:bg-red-50 rounded-xl text-red-600 transition-all"
                            title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}
                          ><Trash2 size={16} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </motion.div>
        )}

        {activeTab === 'assembly' && (
          <motion.div key="assembly" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            {assemblyMeetings.length === 0 ? (
              <div className="apple-card p-12 text-center">
                <div className="w-20 h-20 bg-blue-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
                  <Users className="w-10 h-10 text-blue-500" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">{currentLanguage === 'tr' ? 'Genel Kurul Kayıtları' : 'General Assembly Records'}</h3>
                <p className="text-gray-500 max-w-md mx-auto mb-8">{currentLanguage === 'tr' ? 'Olağan ve olağanüstü genel kurul toplantı tutanakları, hazirun cetvelleri ve alınan kararlar.' : 'Ordinary and extraordinary general assembly minutes, attendee lists, and resolutions.'}</p>
                {isAuthenticated && (
                  <button onClick={() => setShowAssemblyModal(true)} className="apple-button-primary px-8 py-3">
                    {currentLanguage === 'tr' ? 'Kayıt Ekle' : 'Add Record'}
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {assemblyMeetings.filter(m => m.title.toLowerCase().includes(searchQuery.toLowerCase())).map(meeting => (
                  <div key={meeting.id} className="apple-card p-6 space-y-4">
                    <div className="flex justify-between items-start">
                      <div className="bg-blue-50 p-3 rounded-2xl">
                        <Users className="text-blue-600" size={24} />
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                        meeting.type === 'Olağanüstü' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'
                      }`}>
                        {meeting.type === 'Olağanüstü' ? (currentLanguage === 'tr' ? 'Olağanüstü' : 'Extraordinary') : (currentLanguage === 'tr' ? 'Olağan' : 'Ordinary')}
                      </span>
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900">{meeting.title}</h4>
                      <p className="text-xs text-gray-500">{meeting.date}</p>
                    </div>
                    {meeting.decisions && (
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Kararlar' : 'Decisions'}</p>
                        <p className="text-sm text-gray-600 line-clamp-3">{meeting.decisions}</p>
                      </div>
                    )}
                    {isAuthenticated && (
                      <div className="pt-4 border-t border-gray-50 flex justify-end">
                        <button
                          onClick={() => setConfirmModal({
                            isOpen: true,
                            title: currentLanguage === 'tr' ? 'Kaydı Sil' : 'Delete Record',
                            message: currentLanguage === 'tr' ? 'Bu genel kurul kaydını silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this assembly record?',
                            onConfirm: async () => {
                              await deleteDoc(doc(db, 'assemblyMeetings', meeting.id));
                              showToast(currentLanguage === 'tr' ? 'Silindi' : 'Deleted');
                            }
                          })}
                          className="p-2 hover:bg-red-50 rounded-xl text-gray-400 hover:text-red-600 transition-all"
                        ><Trash2 size={16} /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'contracts' && (
          <motion.div key="contracts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            {contracts.length === 0 ? (
              <div className="apple-card p-12 text-center">
                <div className="w-20 h-20 bg-orange-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
                  <FileText className="w-10 h-10 text-[#ff4000]" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">{currentLanguage === 'tr' ? 'Sözleşme Yönetimi' : 'Contract Management'}</h3>
                <p className="text-gray-500 max-w-md mx-auto mb-8">{currentLanguage === 'tr' ? 'Şirket sözleşmeleri, gizlilik anlaşmaları ve hizmet sözleşmelerinin takibi.' : 'Tracking of company contracts, NDAs, and service agreements.'}</p>
                {isAuthenticated && <button onClick={() => setShowContractModal(true)} className="apple-button-primary px-8 py-3">{currentLanguage === 'tr' ? 'Sözleşme Ekle' : 'Add Contract'}</button>}
              </div>
            ) : (
              <div className="apple-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="py-4 px-6 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Sözleşme' : 'Contract'}</th>
                      <th className="py-4 px-6 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Karşı Taraf' : 'Counterparty'}</th>
                      <th className="py-4 px-6 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Tür' : 'Type'}</th>
                      <th className="py-4 px-6 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'İmza' : 'Signed'}</th>
                      <th className="py-4 px-6 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Bitiş' : 'Expiry'}</th>
                      <th className="py-4 px-6 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</th>
                      <th className="py-4 px-6 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'İşlemler' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {contracts.filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()) || c.party.toLowerCase().includes(searchQuery.toLowerCase())).map(c => (
                      <tr key={c.id} className="hover:bg-gray-50/50 transition-all">
                        <td className="py-4 px-6 font-bold text-gray-900">{c.title}</td>
                        <td className="py-4 px-6 text-gray-600">{c.party}</td>
                        <td className="py-4 px-6">
                          <span className="px-2 py-1 bg-gray-100 rounded-lg text-[10px] font-bold text-gray-600">
                            {c.type === 'Hizmet' ? (currentLanguage === 'tr' ? 'Hizmet' : 'Service') :
                             c.type === 'Gizlilik' ? (currentLanguage === 'tr' ? 'Gizlilik' : 'NDA') :
                             c.type === 'Satış' ? (currentLanguage === 'tr' ? 'Satış' : 'Sales') :
                             c.type === 'Kira' ? (currentLanguage === 'tr' ? 'Kira' : 'Lease') : c.type}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-gray-500 text-xs">{c.date}</td>
                        <td className="py-4 px-6 text-gray-500 text-xs">{c.expiryDate || '-'}</td>
                        <td className="py-4 px-6 text-center">
                          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                            c.status === 'Aktif' ? 'bg-green-50 text-green-600' :
                            c.status === 'Süresi Dolmuş' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {c.status === 'Aktif' ? (currentLanguage === 'tr' ? 'Aktif' : 'Active') :
                             c.status === 'Süresi Dolmuş' ? (currentLanguage === 'tr' ? 'Süresi Dolmuş' : 'Expired') :
                             (currentLanguage === 'tr' ? 'İptal' : 'Cancelled')}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-center">
                          {isAuthenticated && (
                            <button
                              onClick={() => setConfirmModal({
                                isOpen: true,
                                title: currentLanguage === 'tr' ? 'Sözleşmeyi Sil' : 'Delete Contract',
                                message: currentLanguage === 'tr' ? 'Bu sözleşmeyi silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this contract?',
                                onConfirm: async () => {
                                  await deleteDoc(doc(db, 'contracts', c.id));
                                  showToast(currentLanguage === 'tr' ? 'Silindi' : 'Deleted');
                                }
                              })}
                              className="p-2 hover:bg-red-50 rounded-xl text-gray-400 hover:text-red-600 transition-all"
                            ><Trash2 size={16} /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'legal' && (
          <motion.div key="legal" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="apple-card p-6 border-l-4 border-l-blue-500">
              <div className="flex items-center gap-4 mb-6">
                <div className="bg-blue-50 p-3 rounded-2xl"><Shield className="text-blue-600" size={24} /></div>
                <div>
                  <h4 className="font-bold">{currentLanguage === 'tr' ? 'Şirket Esas Sözleşmesi' : 'Articles of Association'}</h4>
                  <p className="text-xs text-gray-500">{currentLanguage === 'tr' ? 'Güncel ana sözleşme ve tadil metinleri' : 'Current articles and amendment texts'}</p>
                </div>
              </div>
              <button 
                onClick={() => showToast(currentLanguage === 'tr' ? 'Dosya indiriliyor...' : 'Downloading file...')}
                className="w-full py-3 bg-gray-50 rounded-2xl text-sm font-bold text-gray-600 hover:bg-gray-100 transition-all flex items-center justify-center gap-2"
              >
                <Download size={16} /> {currentLanguage === 'tr' ? 'Görüntüle / İndir' : 'View / Download'}
              </button>
            </div>
            <div className="apple-card p-6 border-l-4 border-l-purple-500">
              <div className="flex items-center gap-4 mb-6">
                <div className="bg-purple-50 p-3 rounded-2xl"><Scale className="text-purple-600" size={24} /></div>
                <div>
                  <h4 className="font-bold">{currentLanguage === 'tr' ? 'İmza Sirküleri' : 'Signature Circular'}</h4>
                  <p className="text-xs text-gray-500">{currentLanguage === 'tr' ? 'Temsil ve ilzam yetkilileri listesi' : 'List of authorized representatives'}</p>
                </div>
              </div>
              <button 
                onClick={() => showToast(currentLanguage === 'tr' ? 'Dosya indiriliyor...' : 'Downloading file...')}
                className="w-full py-3 bg-gray-50 rounded-2xl text-sm font-bold text-gray-600 hover:bg-gray-100 transition-all flex items-center justify-center gap-2"
              >
                <Download size={16} /> {currentLanguage === 'tr' ? 'Görüntüle / İndir' : 'View / Download'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {showBoardModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowBoardModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni Toplantı Kaydı' : 'New Meeting Record'}</h3>
                <button onClick={() => setShowBoardModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Toplantı Başlığı' : 'Meeting Title'}</label>
                  <input type="text" value={boardForm.title} onChange={e => setBoardForm({...boardForm, title: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Tarih' : 'Date'}</label>
                    <input type="date" value={boardForm.date} onChange={e => setBoardForm({...boardForm, date: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Yer' : 'Location'}</label>
                    <input type="text" value={boardForm.location} onChange={e => setBoardForm({...boardForm, location: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Katılımcılar' : 'Attendees'}</label>
                  <input type="text" placeholder="Örn: Ali Yılmaz, Ayşe Demir" value={boardForm.attendees} onChange={e => setBoardForm({...boardForm, attendees: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Alınan Kararlar' : 'Decisions'}</label>
                  <textarea value={boardForm.decisions} onChange={e => setBoardForm({...boardForm, decisions: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm h-32 resize-none" />
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button onClick={() => setShowBoardModal(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-all">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                <button onClick={handleSaveBoardMeeting} className="apple-button-primary flex-1 justify-center py-3 rounded-2xl">{currentLanguage === 'tr' ? 'Kaydet' : 'Save'}</button>
              </div>
            </motion.div>
          </div>
        )}

        {showShareholderModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowShareholderModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni Pay Sahibi' : 'New Shareholder'}</h3>
                <button onClick={() => setShowShareholderModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Ad Soyad / Ünvan' : 'Name / Title'}</label>
                  <input type="text" value={shareholderForm.name} onChange={e => setShareholderForm({...shareholderForm, name: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Pay Adedi' : 'Share Count'}</label>
                    <input type="number" value={shareholderForm.shareCount} onChange={e => setShareholderForm({...shareholderForm, shareCount: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Pay Oranı (%)' : 'Share %'}</label>
                    <input type="number" value={shareholderForm.sharePercentage} onChange={e => setShareholderForm({...shareholderForm, sharePercentage: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Tür' : 'Type'}</label>
                  <select value={shareholderForm.type} onChange={e => setShareholderForm({...shareholderForm, type: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm">
                    <option value="Gerçek Kişi">{currentLanguage === 'tr' ? 'Gerçek Kişi' : 'Natural Person'}</option>
                    <option value="Tüzel Kişi">{currentLanguage === 'tr' ? 'Tüzel Kişi' : 'Legal Entity'}</option>
                  </select>
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button onClick={() => setShowShareholderModal(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-all">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                <button onClick={handleSaveShareholder} className="apple-button-primary flex-1 justify-center py-3 rounded-2xl">{currentLanguage === 'tr' ? 'Kaydet' : 'Save'}</button>
              </div>
            </motion.div>
          </div>
        )}

        {showAssemblyModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAssemblyModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni Genel Kurul Kaydı' : 'New Assembly Record'}</h3>
                <button onClick={() => setShowAssemblyModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Toplantı Başlığı' : 'Meeting Title'}</label>
                  <input type="text" value={assemblyForm.title} onChange={e => setAssemblyForm({...assemblyForm, title: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Tarih' : 'Date'}</label>
                    <input type="date" value={assemblyForm.date} onChange={e => setAssemblyForm({...assemblyForm, date: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Tür' : 'Type'}</label>
                    <select value={assemblyForm.type} onChange={e => setAssemblyForm({...assemblyForm, type: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm">
                      <option value="Olağan">{currentLanguage === 'tr' ? 'Olağan' : 'Ordinary'}</option>
                      <option value="Olağanüstü">{currentLanguage === 'tr' ? 'Olağanüstü' : 'Extraordinary'}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Alınan Kararlar' : 'Decisions'}</label>
                  <textarea value={assemblyForm.decisions} onChange={e => setAssemblyForm({...assemblyForm, decisions: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm h-32 resize-none" />
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button onClick={() => setShowAssemblyModal(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-all">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                <button onClick={handleSaveAssembly} className="apple-button-primary flex-1 justify-center py-3 rounded-2xl">{currentLanguage === 'tr' ? 'Kaydet' : 'Save'}</button>
              </div>
            </motion.div>
          </div>
        )}

        {showContractModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowContractModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni Sözleşme' : 'New Contract'}</h3>
                <button onClick={() => setShowContractModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Sözleşme Başlığı' : 'Contract Title'}</label>
                  <input type="text" value={contractForm.title} onChange={e => setContractForm({...contractForm, title: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Karşı Taraf' : 'Counterparty'}</label>
                  <input type="text" value={contractForm.party} onChange={e => setContractForm({...contractForm, party: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'İmza Tarihi' : 'Date'}</label>
                    <input type="date" value={contractForm.date} onChange={e => setContractForm({...contractForm, date: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Bitiş Tarihi' : 'Expiry Date'}</label>
                    <input type="date" value={contractForm.expiryDate} onChange={e => setContractForm({...contractForm, expiryDate: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{currentLanguage === 'tr' ? 'Tür' : 'Type'}</label>
                  <select value={contractForm.type} onChange={e => setContractForm({...contractForm, type: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#ff4000]/20 text-sm">
                    <option value="Hizmet">{currentLanguage === 'tr' ? 'Hizmet' : 'Service'}</option>
                    <option value="Gizlilik">{currentLanguage === 'tr' ? 'Gizlilik' : 'Confidentiality'}</option>
                    <option value="Satış">{currentLanguage === 'tr' ? 'Satış' : 'Sales'}</option>
                    <option value="Kira">{currentLanguage === 'tr' ? 'Kira' : 'Lease'}</option>
                  </select>
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button onClick={() => setShowContractModal(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-all">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                <button onClick={handleSaveContract} className="apple-button-primary flex-1 justify-center py-3 rounded-2xl">{currentLanguage === 'tr' ? 'Kaydet' : 'Save'}</button>
              </div>
            </motion.div>
          </div>
        )}

        {confirmModal?.isOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center gap-3 mb-4 text-red-600">
                <AlertCircle size={24} />
                <h3 className="text-lg font-bold">{confirmModal.title}</h3>
              </div>
              <p className="text-gray-600 mb-6">{confirmModal.message}</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmModal(null)} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-all">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                <button 
                  onClick={async () => {
                    try {
                      await confirmModal.onConfirm();
                    } catch (error) {
                      console.error("Confirmation action failed:", error);
                      showToast(currentLanguage === 'tr' ? 'İşlem başarısız oldu.' : 'Action failed.', 'error');
                    } finally {
                      setConfirmModal(null);
                    }
                  }} 
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm transition-all"
                >
                  {currentLanguage === 'tr' ? 'Sil' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {toast && (
          <div className={`fixed bottom-8 right-8 px-6 py-3 rounded-2xl shadow-2xl z-[300] flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-300 ${
            toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            <span className="font-bold">{toast.msg}</span>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
