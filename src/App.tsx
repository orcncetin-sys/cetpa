import DashboardAnalysis from './components/DashboardAnalysis';
import AIChat from './components/AIChat';
import ModuleHeader from './components/ModuleHeader';
import { logFirestoreError as importedLogFirestoreError, OperationType } from './utils/firebase';
import React, { useState, useEffect, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  signInAnonymously,
  GoogleAuthProvider,
  signOut,
  getRedirectResult,
  User
} from 'firebase/auth';
import {
  collection,
  onSnapshot,
  query,
  where,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  deleteDoc,
  setDoc,
  getDoc,
  getDocs,
  orderBy,
  limit,
  Timestamp
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getDownloadURL
} from 'firebase/storage';
import {
  LayoutDashboard,
  Users,
  Truck,
  Package,
  LogOut,
  Plus,
  Search,
  Calculator,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  MapPin,
  TrendingUp,
  BarChart3,
  Scan,
  RefreshCw,
  FileText,
  Calendar,
  ArrowLeft,
  Trash2,
  Edit2,
  Kanban,
  List,
  MessageSquare,
  Phone,
  Mail,
  Upload,
  Route,
  GripVertical,
  Navigation,
  Shield,
  Bell,
  Settings,
  ChevronRight,
  Download,
  FilePlus,
  CreditCard,
  DollarSign,
  Lock,
  History,
  Globe,
  X,
  ImageIcon,
  Menu,
  FileDown,
  FileUp,
  Target as TargetIcon,
  Eye,
  UserCheck,
  ShieldCheck,
  Scale,
  Activity,
  ArrowRightLeft,
  Building2,
  BookOpen,
  ShoppingBag,
  ShoppingCart,
  Factory,
  Link,
  Flame,
  Award,
  Moon,
  Sun
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { auth, db, storage } from './firebase';
import { 
  type Shipment, 
  UserRole, 
  type Lead, 
  type LeadActivity, 
  type VoiceNote, 
  type Order, 
  type OrderLineItem, 
  type InventoryItem, 
  type Quotation, 
  type QuotationItem, 
  type PriceList,
  type Employee,
  type InventoryMovement,
  type Warehouse,
  type RouteStop,
  type LucaConfig,
  type MikroConfig
} from './types';
import { scoreLead } from './services/geminiService';
import { syncShopify, createShopifyDraftOrder } from './services/shopifyService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Papa from 'papaparse';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart as RePieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { format, subDays, startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { tr, enUS } from 'date-fns/locale';
import ProductionModule from './components/ProductionModule';
import QualityModule from './components/QualityModule';
import ProjectModule from './components/ProjectModule';
import LegalModule from './components/LegalModule';
import QuotationForm from './components/QuotationForm';
import AccountingModule from './components/AccountingModule';
import PurchasingModule from './components/PurchasingModule';
import HRModule from './components/HRModule';
import LandingPage from './components/LandingPage';
import CorporateGovernanceModule from './components/CorporateGovernanceModule';
import FinancePanel from './components/FinancePanel';
import RiskPanel from './components/RiskPanel';
import AnalyticsPanel from './components/AnalyticsPanel';
import PriceListForm from './components/PriceListForm';
import QuotationDetail from './components/QuotationDetail';
import BarcodeScanner from './components/BarcodeScanner';
import ProductForm from './components/ProductForm';
import ProductDetail from './components/ProductDetail';
import { exportOrderPDF } from './utils/pdf';
import { formatCurrency, formatInCurrency } from './utils/currency';
import { haversineDistance, optimizeRoute } from './utils/logistics';
import { ToastProvider, useToast } from './components/Toast';
import DateRangePicker from './components/DateRangePicker';
import ConfirmModal from './components/ConfirmModal';
import DealerCommissionPanel from './components/DealerCommissionPanel';
import { translations, type Language } from './translations';
import PricingPage from './components/PricingPage';
import OnboardingFlow from './components/OnboardingFlow';
import UpgradeModal from './components/UpgradeModal';
import SubscriptionPanel from './components/SubscriptionPanel';
import CargoTrackingTab from './components/CargoTrackingTab';
import DocumentDesigner from './components/DocumentDesigner';
import {
  type UserSubscription,
  type SubscriptionPlan,
  type BillingCycle,
  canAccessModule,
  createTrialSubscription,
  isTrialActive,
  daysRemaining,
  getPlanConfig,
} from './types/subscription';

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
// --- Permission Matrix ---
// 'full' = full read+write access, 'readonly' = read-only view
const TAB_PERMISSIONS: Record<string, { full: UserRole[]; readonly: UserRole[] }> = {
  dashboard:     { full: [UserRole.Admin, UserRole.Manager, UserRole.Sales, UserRole.Logistics, UserRole.Accounting, UserRole.HR, UserRole.Purchasing, UserRole.B2B, UserRole.Dealer], readonly: [] },
  crm:           { full: [UserRole.Admin, UserRole.Manager, UserRole.Sales], readonly: [UserRole.Accounting, UserRole.Purchasing] },
  orders:        { full: [UserRole.Admin, UserRole.Manager, UserRole.Sales], readonly: [UserRole.Accounting, UserRole.Purchasing] },
  inventory:     { full: [UserRole.Admin, UserRole.Manager, UserRole.Logistics, UserRole.Purchasing], readonly: [UserRole.Accounting, UserRole.Sales] },
  lojistik:      { full: [UserRole.Admin, UserRole.Manager, UserRole.Logistics, UserRole.Purchasing], readonly: [UserRole.Accounting, UserRole.Sales] },
  muhasebe:      { full: [UserRole.Admin, UserRole.Accounting], readonly: [UserRole.Manager] },
  'satin-alma':  { full: [UserRole.Admin, UserRole.Manager, UserRole.Logistics, UserRole.Purchasing], readonly: [UserRole.Accounting] },
  ik:            { full: [UserRole.Admin, UserRole.Manager, UserRole.HR], readonly: [UserRole.Accounting] },
  hukuk:         { full: [UserRole.Admin, UserRole.Manager], readonly: [UserRole.Accounting, UserRole.HR] },
  proje:         { full: [UserRole.Admin, UserRole.Manager], readonly: [UserRole.Sales, UserRole.Logistics, UserRole.Purchasing] },
  kalite:        { full: [UserRole.Admin, UserRole.Manager], readonly: [UserRole.Logistics, UserRole.Purchasing] },
  production:    { full: [UserRole.Admin, UserRole.Manager, UserRole.Logistics], readonly: [UserRole.Purchasing, UserRole.Quality] },
  b2b:           { full: [UserRole.Admin, UserRole.Manager, UserRole.Sales, UserRole.B2B, UserRole.Dealer], readonly: [UserRole.Accounting] },
  risk:          { full: [UserRole.Admin, UserRole.Manager, UserRole.Accounting, UserRole.Purchasing], readonly: [UserRole.Sales, UserRole.Logistics] },
  reports:       { full: [UserRole.Admin, UserRole.Manager, UserRole.Accounting], readonly: [UserRole.Sales, UserRole.Logistics, UserRole.HR, UserRole.Purchasing] },
  integrations:  { full: [UserRole.Admin], readonly: [UserRole.Manager] },
  admin:         { full: [UserRole.Admin], readonly: [] },
  settings:      { full: [UserRole.Admin, UserRole.Manager], readonly: [] },
};

interface B2BPortalProps {
  user: User | null;
  userRole: UserRole;
  leads: Lead[];
  inventory: InventoryItem[];
  currentT: Record<string, string>;
  currentLanguage: string;
}

// --- Error Handling ---

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// ... (rest of imports)

// Non-throwing version — use inside onSnapshot error callbacks to avoid unhandled rejections
// (The logFirestoreError function is now imported from ./utils/firebase)

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, errorInfo: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorInfo: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Bir hata oluştu. Lütfen sayfayı yenileyin.";
      try {
        const parsed = JSON.parse(this.state.errorInfo);
        if (parsed.error.includes('permission-denied')) {
          displayMessage = "Bu işlemi yapmak için yetkiniz bulunmuyor.";
        }
      } catch (e) { console.debug(e); }

      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4 text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Hata Oluştu</h1>
          <p className="text-gray-600 mb-6 max-w-md">{displayMessage}</p>
          <button
            onClick={() => window.location.reload()}
            className="apple-button-primary"
          >
            Yeniden Dene
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Route Optimizer Utilities ---
// --- SortHeader Component ---
const SortHeader = ({ 
  label, 
  sortKey, 
  currentSort, 
  onSort, 
  className 
}: { 
  label: string, 
  sortKey: string, 
  currentSort: { key: string, direction: 'asc' | 'desc' }, 
  onSort: (key: string) => void,
  className?: string
}) => {
  const isActive = currentSort.key === sortKey;
  
  return (
    <th 
      className={cn(
        "px-6 py-4 text-xs font-bold text-[#86868B] uppercase tracking-wider cursor-pointer hover:bg-gray-100/50 transition-colors group",
        className
      )}
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1.5">
        {label}
        <TrendingUp className={cn(
          "w-3 h-3 transition-all opacity-0 group-hover:opacity-100",
          isActive ? "opacity-100 text-brand" : "text-gray-300",
          isActive && currentSort.direction === 'desc' ? "rotate-180" : ""
        )} />
      </div>
    </th>
  );
};

// haversineDistance and optimizeRoute are imported from ./utils/logistics

// --- B2B Portal Components ---
// QuotationItem, Quotation, B2BPortalProps, PriceList are imported from ./types

// --- B2B Portal Components ---
const B2BPortal = ({ user, userRole, leads, inventory, currentT, currentLanguage }: B2BPortalProps) => {
  const [b2bTab, setB2bTab] = useState<'quotations'|'dealers'|'pricelists'|'komisyon'>('quotations');
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [dealers, setDealers] = useState<Record<string,unknown>[]>([]);
  const [isCreatingQuote, setIsCreatingQuote] = useState(false);
  const [isAddingPrice, setIsAddingPrice] = useState(false);
  const [selectedQuotation, setSelectedQuotation] = useState<Quotation | null>(null);
  const [selectedPriceList, setSelectedPriceList] = useState<PriceList | null>(null);
  const [isEditingQuotation, setIsEditingQuotation] = useState(false);
  const [isEditingPriceList, setIsEditingPriceList] = useState(false);
  const [isEditingCredit, setIsEditingCredit] = useState(false);
  const [creditInfo, setCreditInfo] = useState({ limit: 500000, used: 200000 });
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'createdAt', direction: 'desc' });
  const [sortConfigDealers, setSortConfigDealers] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });
  const [sortConfigPriceLists, setSortConfigPriceLists] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'productName', direction: 'asc' });
  // Dealer form state
  const [isDealerModalOpen, setIsDealerModalOpen] = useState(false);
  const [editingDealer, setEditingDealer] = useState<Record<string,unknown>|null>(null);
  const [dealerForm, setDealerForm] = useState({ name:'', company:'', email:'', phone:'', taxId:'', creditLimit:500000, priceTier:'Dealer' as string, paymentTerms:'30', address:'' });
  const [dealerSearch, setDealerSearch] = useState('');
  const [shopifySyncing, setShopifySyncing] = useState(false);
  const [shopifySyncStatus, setShopifySyncStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: 'danger' | 'default';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => { },
  });

  useEffect(() => {
    if (!user || !userRole) return;
    const q = userRole === 'Admin' || userRole === 'Manager'
      ? collection(db, 'quotations')
      : query(collection(db, 'quotations'), where('customerEmail', '==', user?.email ?? ''));

    const unsubQuotes = onSnapshot(q, (snap) => {
      setQuotations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Quotation)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'quotations', auth.currentUser?.uid));

    const unsubPrices = onSnapshot(collection(db, 'priceLists'), (snap) => {
      setPriceLists(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PriceList)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'priceLists', auth.currentUser?.uid));

    // Fetch dealers from leads (customerType === 'Dealer' or priceTier === 'Dealer')
    const dealerQ = userRole === 'Admin' || userRole === 'Manager'
      ? query(collection(db, 'leads'), where('customerType', '==', 'Dealer'))
      : query(collection(db, 'leads'), where('email', '==', user?.email ?? ''));
    const unsubDealers = onSnapshot(dealerQ, (snap) => {
      setDealers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // Fetch credit info from leads/customers
    const unsubCredit = onSnapshot(query(collection(db, 'leads'), where('email', '==', user?.email ?? '')), (snap) => {
      if (!snap.empty) {
        const leadData = snap.docs[0].data();
        setCreditInfo({
          limit: leadData.creditLimit || 500000,
          used: leadData.creditUsed || 0
        });
      }
    });

    return () => { unsubQuotes(); unsubPrices(); unsubCredit(); unsubDealers(); };
  }, [user?.email, userRole, user]);

  const handleSaveDealer = async () => {
    try {
      const data = { ...dealerForm, customerType: 'Dealer', status: 'Active', updatedAt: new Date() };
      if (editingDealer) {
        await updateDoc(doc(db, 'leads', editingDealer.id as string), data);
      } else {
        await addDoc(collection(db, 'leads'), { ...data, createdAt: new Date() });
      }
      setIsDealerModalOpen(false);
      setEditingDealer(null);
      setDealerForm({ name:'', company:'', email:'', phone:'', taxId:'', creditLimit:500000, priceTier:'Dealer', paymentTerms:'30', address:'' });
    } catch(e) { console.error(e); }
  };

  const filteredDealers = dealers
    .filter(d =>
      (d.name as string || '').toLowerCase().includes(dealerSearch.toLowerCase()) ||
      (d.company as string || '').toLowerCase().includes(dealerSearch.toLowerCase()) ||
      (d.email as string || '').toLowerCase().includes(dealerSearch.toLowerCase())
    )
    .sort((a, b) => {
      const aValue = a[sortConfigDealers.key] || '';
      const bValue = b[sortConfigDealers.key] || '';
      if (aValue < bValue) return sortConfigDealers.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfigDealers.direction === 'asc' ? 1 : -1;
      return 0;
    });

  const filteredQuotations = quotations
    .filter(q =>
      q.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.id.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

  const handleConvertToOrder = async (q: Quotation) => {
    setConfirmState({
      isOpen: true,
      title: currentT.confirm_convert_to_order || 'Siparişe Dönüştür',
      message: currentT.confirm_convert_to_order_msg || 'Bu teklifi Shopify siparişine dönüştürmek istediğinize emin misiniz?',
      onConfirm: async () => {
        setShopifySyncing(true);
        try {
          const response = await fetch('/api/shopify/draft-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerName: q.customerName,
              email: q.customerEmail,
              note: `Converted from Quotation #${q.id}. Notes: ${q.notes || ''}`,
              lineItems: (q.lineItems || q.items || []).map((item: QuotationItem) => ({
                title: item.name,
                sku: item.sku,
                price: item.price,
                quantity: item.quantity
              }))
            })
          });
          if (!response.ok) throw new Error('Shopify API error');
          await updateDoc(doc(db, 'quotations', q.id), { status: 'Converted' });
          setShopifySyncStatus({ type: 'success', message: 'Teklif başarıyla Shopify siparişine dönüştürüldü.' });
        } catch (err) {
          setShopifySyncStatus({ type: 'error', message: err instanceof Error ? err.message : 'Dönüştürme hatası.' });
        } finally {
          setShopifySyncing(false);
        }
      }
    });
  };

  return (
    <div className="space-y-6">
      <AnimatePresence>
        {shopifySyncStatus && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
              "fixed top-4 right-4 z-[10000] p-4 rounded-2xl shadow-2xl flex items-center gap-3",
              shopifySyncStatus.type === 'success' ? "bg-green-50 text-green-800 border border-green-100" : "bg-red-50 text-red-800 border border-red-100"
            )}
          >
            {shopifySyncStatus.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            <p className="text-sm font-bold">{shopifySyncStatus.message}</p>
            <button onClick={() => setShopifySyncStatus(null)} className="ml-2 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Row 1: Title + primary action */}
      <ModuleHeader
        title={currentT.b2b_portal}
        subtitle={currentT.b2b_portal_desc}
        icon={Globe}
        actionButton={
          b2bTab === 'quotations' ? (
            <button onClick={() => setIsCreatingQuote(true)} className="apple-button-primary">
              <FilePlus className="w-4 h-4" /> {currentT.new_quotation}
            </button>
          ) : b2bTab === 'dealers' ? (
            <button onClick={() => { setEditingDealer(null); setDealerForm({ name:'', company:'', email:'', phone:'', taxId:'', creditLimit:500000, priceTier:'Dealer', paymentTerms:'30', address:'' }); setIsDealerModalOpen(true); }} className="apple-button-primary">
              <Plus className="w-4 h-4" /> {currentLanguage === 'tr' ? 'Yeni Bayi' : 'New Dealer'}
            </button>
          ) : b2bTab === 'pricelists' ? (
            <button onClick={() => setIsAddingPrice(true)} className="apple-button-primary">
              <Plus className="w-4 h-4" /> {currentT.new_price_list}
            </button>
          ) : null
        }
      />

      {/* Sub-tabs */}
      <div className="overflow-x-auto scrollbar-none -mx-4 px-4">
        <div className="flex items-center gap-1 w-max border-b" style={{borderColor:'var(--border-subtle)'}}>
          {([
            { id: 'quotations', label: currentLanguage==='tr'?'Teklifler':'Quotations', icon: FileText },
            { id: 'dealers', label: currentLanguage==='tr'?'Bayiler':'Dealers', icon: Users },
            { id: 'pricelists', label: currentLanguage==='tr'?'Fiyat Listeleri':'Price Lists', icon: List },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setB2bTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap -mb-px ${b2bTab===t.id ? 'border-brand text-brand' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              <t.icon className="w-3.5 h-3.5" />{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dealer management modal */}
      {isDealerModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
          <div className="apple-card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg">{editingDealer ? (currentLanguage==='tr'?'Bayi Düzenle':'Edit Dealer') : (currentLanguage==='tr'?'Yeni Bayi':'New Dealer')}</h3>
              <button onClick={() => setIsDealerModalOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage==='tr'?'Ad Soyad':'Full Name'}</label>
                  <input className="apple-input w-full" value={dealerForm.name} onChange={e=>setDealerForm(f=>({...f,name:e.target.value}))} placeholder="Ahmet Yılmaz" /></div>
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage==='tr'?'Firma':'Company'}</label>
                  <input className="apple-input w-full" value={dealerForm.company} onChange={e=>setDealerForm(f=>({...f,company:e.target.value}))} placeholder="ABC Ticaret Ltd." /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">E-posta</label>
                  <input className="apple-input w-full" type="email" value={dealerForm.email} onChange={e=>setDealerForm(f=>({...f,email:e.target.value}))} placeholder="bayi@firma.com" /></div>
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage==='tr'?'Telefon':'Phone'}</label>
                  <input className="apple-input w-full" value={dealerForm.phone} onChange={e=>setDealerForm(f=>({...f,phone:e.target.value}))} placeholder="+90 555 000 00 00" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage==='tr'?'Vergi No':'Tax ID'}</label>
                  <input className="apple-input w-full" value={dealerForm.taxId} onChange={e=>setDealerForm(f=>({...f,taxId:e.target.value}))} placeholder="1234567890" /></div>
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage==='tr'?'Fiyat Kademesi':'Price Tier'}</label>
                  <select className="apple-input w-full" value={dealerForm.priceTier} onChange={e=>setDealerForm(f=>({...f,priceTier:e.target.value}))}>
                    <option value="Dealer">Bayi</option>
                    <option value="B2B Premium">B2B Premium</option>
                    <option value="B2B Standard">B2B Standard</option>
                    <option value="Retail">Perakende</option>
                  </select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage==='tr'?'Kredi Limiti (₺)':'Credit Limit (₺)'}</label>
                  <input className="apple-input w-full" type="number" value={dealerForm.creditLimit} onChange={e=>setDealerForm(f=>({...f,creditLimit:Number(e.target.value)}))} /></div>
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage==='tr'?'Ödeme Vadesi (gün)':'Payment Terms (days)'}</label>
                  <input className="apple-input w-full" type="number" value={dealerForm.paymentTerms} onChange={e=>setDealerForm(f=>({...f,paymentTerms:e.target.value}))} /></div>
              </div>
              <div><label className="text-xs font-semibold text-gray-500 mb-1 block">{currentLanguage==='tr'?'Adres':'Address'}</label>
                <textarea className="apple-input w-full resize-none" rows={2} value={dealerForm.address} onChange={e=>setDealerForm(f=>({...f,address:e.target.value}))} /></div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleSaveDealer} className="apple-button-primary flex-1 justify-center">{currentLanguage==='tr'?'Kaydet':'Save'}</button>
              <button onClick={() => setIsDealerModalOpen(false)} className="apple-button-secondary flex-1 justify-center">{currentLanguage==='tr'?'İptal':'Cancel'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Row 2: Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868B] pointer-events-none" />
        <input
          type="text"
          placeholder={b2bTab === 'dealers' ? (currentLanguage==='tr'?'Bayi ara...':'Search dealer...') : currentT.search_quote}
          className="apple-input pl-10 w-full"
          value={b2bTab === 'dealers' ? dealerSearch : searchTerm}
          onChange={(e) => b2bTab === 'dealers' ? setDealerSearch(e.target.value) : setSearchTerm(e.target.value)}
        />
      </div>

      {isAddingPrice && <PriceListForm isOpen={isAddingPrice} onClose={() => setIsAddingPrice(false)} inventory={inventory} t={currentT} />}
      {isEditingPriceList && selectedPriceList && (
        <PriceListForm
          isOpen={isEditingPriceList}
          onClose={() => {
            setIsEditingPriceList(false);
            setSelectedPriceList(null);
          }}
          inventory={inventory}
          initialData={selectedPriceList}
          t={currentT}
        />
      )}
      {selectedQuotation && !isEditingQuotation && (
        <QuotationDetail
          isOpen={!!selectedQuotation}
          quotation={selectedQuotation}
          onClose={() => setSelectedQuotation(null)}
          onEdit={(q) => {
            setSelectedQuotation(q);
            setIsEditingQuotation(true);
          }}
          onConvertToOrder={handleConvertToOrder}
          t={currentT}
        />
      )}

      {/* Dealers Tab */}
      {b2bTab === 'dealers' && (
        <div className="space-y-4">
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: currentLanguage==='tr'?'Toplam Bayi':'Total Dealers', value: dealers.length, color: 'text-brand', bg: 'bg-brand/10' },
              { label: currentLanguage==='tr'?'Aktif':'Active', value: dealers.filter(d=>d.status==='Active').length, color: 'text-green-600', bg: 'bg-green-50' },
              { label: currentLanguage==='tr'?'Toplam Kredi Limiti':'Total Credit', value: `₺${dealers.reduce((s,d)=>s+(d.creditLimit as number||0),0).toLocaleString('tr-TR',{maximumFractionDigits:0})}`, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: currentLanguage==='tr'?'Toplam Teklif':'Quotes', value: quotations.length, color: 'text-purple-600', bg: 'bg-purple-50' },
            ].map((k,i) => (
              <div key={i} className="apple-card p-4">
                <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                <p className="text-xs text-gray-500 mt-1">{k.label}</p>
              </div>
            ))}
          </div>
          {/* Dealers table */}
          <div className="apple-card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr>
                    <SortHeader label={currentLanguage==='tr'?'Bayi / Firma':'Dealer / Company'} sortKey="name" currentSort={sortConfigDealers} onSort={(key) => setSortConfigDealers(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} />
                    <SortHeader label="E-posta" sortKey="email" currentSort={sortConfigDealers} onSort={(key) => setSortConfigDealers(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} />
                    <th className="hidden md:table-cell px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{currentLanguage==='tr'?'Telefon':'Phone'}</th>
                    <SortHeader label={currentLanguage==='tr'?'Kademe':'Tier'} sortKey="priceTier" currentSort={sortConfigDealers} onSort={(key) => setSortConfigDealers(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="hidden sm:table-cell" />
                    <SortHeader label={currentLanguage==='tr'?'Kredi Limiti':'Credit Limit'} sortKey="creditLimit" currentSort={sortConfigDealers} onSort={(key) => setSortConfigDealers(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="hidden lg:table-cell" />
                    <SortHeader label={currentLanguage==='tr'?'Vade':'Terms'} sortKey="paymentTerms" currentSort={sortConfigDealers} onSort={(key) => setSortConfigDealers(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="hidden lg:table-cell" />
                    <SortHeader label={currentLanguage==='tr'?'Durum':'Status'} sortKey="status" currentSort={sortConfigDealers} onSort={(key) => setSortConfigDealers(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} />
                    <th className="text-right px-4 py-3 text-right text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{currentLanguage==='tr'?'İşlem':'Actions'}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDealers.map(d => (
                    <tr key={d.id as string}>
                      <td>
                        <p className="font-semibold">{d.name as string}</p>
                        <p className="text-xs text-gray-400">{d.company as string}</p>
                      </td>
                      <td className="text-gray-500">{d.email as string}</td>
                      <td className="hidden md:table-cell text-gray-500">{d.phone as string}</td>
                      <td className="hidden sm:table-cell">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand">{d.priceTier as string || 'Dealer'}</span>
                      </td>
                      <td className="hidden lg:table-cell font-semibold">₺{(d.creditLimit as number||0).toLocaleString('tr-TR')}</td>
                      <td className="hidden lg:table-cell text-gray-500">{d.paymentTerms as string || '30'} {currentLanguage==='tr'?'gün':'days'}</td>
                      <td>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${d.status==='Active'?'bg-green-100 text-green-600':'bg-gray-100 text-gray-500'}`}>
                          {d.status as string || 'Active'}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => {
                            setEditingDealer(d);
                            setDealerForm({ name:d.name as string||'', company:d.company as string||'', email:d.email as string||'', phone:d.phone as string||'', taxId:d.taxId as string||'', creditLimit:d.creditLimit as number||500000, priceTier:d.priceTier as string||'Dealer', paymentTerms:d.paymentTerms as string||'30', address:d.address as string||'' });
                            setIsDealerModalOpen(true);
                          }} className="action-btn-edit"><Edit2 className="w-3.5 h-3.5" /></button>
                          <button onClick={async () => { await deleteDoc(doc(db, 'leads', d.id as string)); }} className="action-btn-delete"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredDealers.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3">
                        <p className="text-gray-400 text-sm">
                          {dealers.length === 0
                            ? (currentLanguage==='tr'?'Henüz bayi eklenmedi.':'No dealers yet.')
                            : (currentLanguage==='tr'?'Arama sonucu bulunamadı.':'No results found.')}
                        </p>
                        {dealers.length === 0 && (
                          <button
                            onClick={() => { setEditingDealer(null); setDealerForm({ name:'', company:'', email:'', phone:'', taxId:'', creditLimit:500000, priceTier:'Dealer', paymentTerms:'30', address:'' }); setIsDealerModalOpen(true); }}
                            className="apple-button-primary text-sm px-5 py-2 flex items-center gap-1.5"
                          >
                            <Plus className="w-3.5 h-3.5" /> {currentLanguage==='tr'?'Bayi Ekle':'Add Dealer'}
                          </button>
                        )}
                      </div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Price Lists Tab */}
      {b2bTab === 'pricelists' && (
        <div className="apple-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="apple-table">
              <thead><tr>
                <SortHeader label={currentT.product} sortKey="productName" currentSort={sortConfigPriceLists} onSort={(key) => setSortConfigPriceLists(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} />
                <SortHeader label="Retail" sortKey="prices.Retail" currentSort={sortConfigPriceLists} onSort={(key) => setSortConfigPriceLists(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="text-right" />
                <SortHeader label="B2B Standard" sortKey="prices.B2B Standard" currentSort={sortConfigPriceLists} onSort={(key) => setSortConfigPriceLists(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="text-right hidden sm:table-cell" />
                <SortHeader label="B2B Premium" sortKey="prices.B2B Premium" currentSort={sortConfigPriceLists} onSort={(key) => setSortConfigPriceLists(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="text-right hidden sm:table-cell" />
                <SortHeader label={currentLanguage==='tr'?'Bayi':'Dealer'} sortKey="prices.Dealer" currentSort={sortConfigPriceLists} onSort={(key) => setSortConfigPriceLists(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} className="text-right" />
                <th className="text-right px-4 py-3 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{currentT.actions||'İşlem'}</th>
              </tr></thead>
              <tbody>
                {priceLists
                  .sort((a, b) => {
                    const getVal = (pl: PriceList, key: string): string | number => {
                      if (key.startsWith('prices.')) {
                        const tier = key.slice(7);
                        return (pl.prices as Record<string, number>)?.[tier] ?? 0;
                      }
                      return (pl[key as keyof PriceList] as string | number) || '';
                    };
                    const aValue = getVal(a, sortConfigPriceLists.key);
                    const bValue = getVal(b, sortConfigPriceLists.key);
                    if (aValue < bValue) return sortConfigPriceLists.direction === 'asc' ? -1 : 1;
                    if (aValue > bValue) return sortConfigPriceLists.direction === 'asc' ? 1 : -1;
                    return 0;
                  })
                  .map(pl => (
                  <tr key={pl.id}>
                    <td>
                      <p className="font-semibold">{(pl.productName as string)||(pl.itemName as string)}</p>
                      <p className="text-xs text-gray-400">{pl.sku as string}</p>
                    </td>
                    <td className="text-right font-semibold">{(pl.prices?.['Retail']??0).toLocaleString('tr-TR')} {(pl.currency as string)||'₺'}</td>
                    <td className="text-right text-gray-500 hidden sm:table-cell">{(pl.prices?.['B2B Standard']??0).toLocaleString('tr-TR')}</td>
                    <td className="text-right text-gray-500 hidden sm:table-cell">{(pl.prices?.['B2B Premium']??0).toLocaleString('tr-TR')}</td>
                    <td className="text-right text-brand font-bold">{(pl.prices?.['Dealer']??0).toLocaleString('tr-TR')}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={()=>{setSelectedPriceList(pl);setIsEditingPriceList(true);}} className="action-btn-edit"><Edit2 className="w-3.5 h-3.5"/></button>
                        <button onClick={async()=>{await deleteDoc(doc(db,'priceLists',pl.id));}} className="action-btn-delete"><Trash2 className="w-3.5 h-3.5"/></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {priceLists.length===0 && (
                  <tr><td colSpan={6} className="text-center py-12">
                    <div className="flex flex-col items-center gap-3">
                      <p className="text-gray-400 text-sm">{currentLanguage==='tr'?'Henüz fiyat listesi eklenmedi.':'No price lists yet.'}</p>
                      <button onClick={() => setIsAddingPrice(true)} className="apple-button-primary text-sm px-5 py-2 flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5" /> {currentLanguage==='tr'?'Fiyat Listesi Ekle':'Add Price List'}
                      </button>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {b2bTab === 'quotations' && <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="apple-card p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">{currentT.active_quotations}</h3>
              <span className="text-xs text-[#86868B] font-medium">{filteredQuotations.length} {currentT.items || 'kayıt'}</span>
            </div>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={currentT.customer || 'Müşteri'} 
                      sortKey="customerName" 
                      currentSort={sortConfig} 
                      onSort={(key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} 
                      className="py-2 px-2"
                    />
                    <SortHeader 
                      label="Ref No" 
                      sortKey="id" 
                      currentSort={sortConfig} 
                      onSort={(key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} 
                      className="py-2 px-2 hidden md:table-cell"
                    />
                    <SortHeader 
                      label={currentT.amount || 'Tutar'} 
                      sortKey="totalAmount" 
                      currentSort={sortConfig} 
                      onSort={(key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} 
                      className="py-2 px-2"
                    />
                    <SortHeader 
                      label={currentT.status || 'Durum'} 
                      sortKey="status" 
                      currentSort={sortConfig} 
                      onSort={(key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} 
                      className="py-2 px-2"
                    />
                    <SortHeader 
                      label={currentT.date || 'Tarih'} 
                      sortKey="createdAt" 
                      currentSort={sortConfig} 
                      onSort={(key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))} 
                      className="py-2 px-2 hidden md:table-cell"
                    />
                    <th className="py-2 px-2 text-[#86868B] font-semibold text-xs text-right">{currentT.actions || 'İşlem'}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotations.map((q) => (
                    <tr key={q.id} onClick={() => setSelectedQuotation(q)} className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer group">
                      <td className="py-2.5 px-2">
                        <p className="font-semibold text-[#1D1D1F] truncate max-w-[140px]">{q.customerName}</p>
                        <p className="text-[10px] text-[#86868B]">{q.items?.length || 0} {currentT.items || 'ürün'}</p>
                      </td>
                      <td className="py-2.5 px-2 font-mono text-xs text-[#86868B] hidden md:table-cell">#{q.id.slice(0, 8)}</td>
                      <td className="py-2.5 px-2 font-bold text-[#1D1D1F] whitespace-nowrap">
                        {(q.totalAmount ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {q.currency || 'TL'}
                      </td>
                      <td className="py-2.5 px-2">
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase whitespace-nowrap",
                          q.status === 'approved' ? "bg-green-100 text-green-600" :
                            q.status === 'Converted to Order' ? "bg-blue-100 text-blue-600" : "bg-orange-100 text-orange-600"
                        )}>
                          {q.status === 'approved' ? currentT.approved :
                            q.status === 'Converted to Order' ? currentT.converted : currentT.pending}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-xs text-[#86868B] hidden md:table-cell">
                        {(q.createdAt as { toDate?: () => Date })?.toDate ? (q.createdAt as { toDate: () => Date }).toDate().toLocaleDateString('tr-TR') : '—'}
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedQuotation(q); }}
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-[#86868B] hover:text-blue-600 transition-colors"
                            title={currentLanguage === 'tr' ? 'İncele' : 'View'}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); exportOrderPDF(q as unknown as Record<string, unknown>, currentT); }}
                            className="p-1.5 rounded-lg hover:bg-green-50 text-[#86868B] hover:text-green-600 transition-colors"
                            title={currentT.download_pdf || 'PDF İndir'}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedQuotation(q); setIsEditingQuotation(true); }}
                            className="p-1.5 rounded-lg hover:bg-brand/10 text-[#86868B] hover:text-brand transition-colors"
                            title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmState({
                                isOpen: true,
                                title: currentT.confirm_delete,
                                message: currentT.confirm_delete_quotation || 'Bu teklifi silmek istediğinize emin misiniz?',
                                onConfirm: async () => {
                                  try {
                                    await deleteDoc(doc(db, 'quotations', q.id));
                                  } catch (error) {
                                    handleFirestoreError(error, OperationType.DELETE, `quotations/${q.id}`);
                                  }
                                }
                              });
                            }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-[#86868B] hover:text-red-500 transition-colors"
                            title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredQuotations.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-8 text-[#86868B] text-sm">{currentT.no_records}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="apple-card p-6 bg-brand text-white">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold">{currentT.credit_limit}</h3>
              <button onClick={() => setIsEditingCredit(true)} className="text-xs underline">{currentT.edit}</button>
            </div>
            {isEditingCredit ? (
              <div className="space-y-3">
                <input
                  type="number"
                  value={creditInfo.limit}
                  onChange={(e) => setCreditInfo({ ...creditInfo, limit: Number(e.target.value) })}
                  className="w-full bg-white/20 border border-white/30 rounded-xl px-3 py-2 text-white outline-none focus:bg-white/30"
                  placeholder={currentT.credit_limit_label}
                />
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      const lead = leads.find(l => l.email === user?.email);
                      if (lead) {
                        await updateDoc(doc(db, 'leads', lead.id), { creditLimit: creditInfo.limit });
                      }
                      setIsEditingCredit(false);
                    }}
                    className="flex-1 bg-white text-brand py-2 rounded-xl text-xs font-bold"
                  >
                    {currentT.save}
                  </button>
                  <button
                    onClick={() => setIsEditingCredit(false)}
                    className="flex-1 bg-white/20 text-white py-2 rounded-xl text-xs font-bold"
                  >
                    {currentT.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-3xl font-bold mb-4">{creditInfo.limit.toLocaleString()} TL</p>
                <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden mb-2">
                  <div className={cn("h-full", (creditInfo.used / creditInfo.limit) > 0.8 ? "bg-red-500" : (creditInfo.used / creditInfo.limit) > 0.5 ? "bg-yellow-400" : "bg-white")} style={{ width: `${Math.min(100, (creditInfo.used / creditInfo.limit) * 100)}%` }} />
                </div>
                <p className="text-xs opacity-80">{currentT.used_limit}: {creditInfo.used.toLocaleString()} TL ({Math.round((creditInfo.used / creditInfo.limit) * 100)}%)</p>
                {creditInfo.used > creditInfo.limit && <p className="text-xs font-bold mt-2 text-red-200">⚠️ {currentT.over_limit}</p>}
              </>
            )}
          </div>

          <div className="apple-card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <ShoppingBag className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold">Shopify Entegrasyonu</h3>
                <p className="text-[11px] text-[#86868B]">Ürün ve sipariş senkronizasyonu</p>
              </div>
            </div>
            {shopifySyncStatus && (
              <div className={cn(
                "text-xs px-3 py-2 rounded-xl mb-3 font-medium",
                shopifySyncStatus.type === 'success' ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
              )}>
                {shopifySyncStatus.message}
              </div>
            )}
            <button
              onClick={async () => {
                setShopifySyncing(true);
                setShopifySyncStatus(null);
                try {
                  const result = await syncShopify();
                  const productCount = result?.products?.length ?? 0;
                  const orderCount = result?.orders?.length ?? 0;
                  setShopifySyncStatus({
                    type: 'success',
                    message: `${productCount} ürün, ${orderCount} sipariş senkronize edildi.`,
                  });
                } catch (err) {
                  setShopifySyncStatus({
                    type: 'error',
                    message: err instanceof Error ? err.message : 'Shopify bağlantısı kurulamadı.',
                  });
                } finally {
                  setShopifySyncing(false);
                }
              }}
              disabled={shopifySyncing}
              className={cn(
                "w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2",
                shopifySyncing
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-green-600 hover:bg-green-700 text-white active:scale-95"
              )}
            >
              <RefreshCw className={cn("w-3.5 h-3.5", shopifySyncing && "animate-spin")} />
              {shopifySyncing ? 'Senkronize ediliyor...' : 'Shopify Senkronize Et'}
            </button>
          </div>
        </div>
      </div>}

      {isCreatingQuote && (
        <QuotationForm isOpen={isCreatingQuote} onClose={() => setIsCreatingQuote(false)} leads={leads} inventory={inventory} t={currentT} />
      )}
      {isEditingQuotation && selectedQuotation && (
        <QuotationForm
          isOpen={isEditingQuotation}
          onClose={() => {
            setIsEditingQuotation(false);
            setSelectedQuotation(null);
          }}
          leads={leads}
          inventory={inventory}
          initialData={selectedQuotation}
          t={currentT}
        />
      )}
      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
        onConfirm={() => {
          confirmState.onConfirm();
          setConfirmState(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

const InventoryView = ({ inventory, categories, selectedCategory, setSelectedCategory, currentT, currentLanguage, inventoryMovements, warehouses }: { inventory: InventoryItem[], categories: string[], selectedCategory: string, setSelectedCategory: (c: string) => void, currentT: Record<string, string>, currentLanguage: string, isAuthenticated?: boolean, userRole?: string | null, inventoryMovements: InventoryMovement[], warehouses: Warehouse[] }) => {
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<InventoryItem | null>(null);
  const [editingProduct, setEditingProduct] = useState<InventoryItem | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: 'danger' | 'default';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => { },
  });

  useEffect(() => {
    setMovements(inventoryMovements);
  }, [inventoryMovements]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const filteredInventory = inventory
    .filter(item => {
      const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesCategory && matchesSearch;
    })
    .sort((a: InventoryItem, b: InventoryItem) => {
      const aValue = (a as unknown as Record<string, unknown>)[sortConfig.key] ?? '';
      const bValue = (b as unknown as Record<string, unknown>)[sortConfig.key] ?? '';
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

  return (
    <div className="space-y-8">
      {/* Row 1: Title + Add button */}
      <ModuleHeader
        title={currentT.inventory}
        subtitle={currentT.inventory_desc}
        icon={Package}
        actionButton={
          <button onClick={() => setIsAddingProduct(true)} className="apple-button-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> {currentT.add_product}
          </button>
        }
      />
      {/* Row 2: Search + Scan + Export */}
      <div className="flex flex-col sm:flex-row gap-3 -mt-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868B]" />
          <input
            type="text"
            placeholder={currentT.search}
            className="apple-input pl-10 w-full"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsScannerOpen(true)}
            className="apple-button-secondary flex items-center justify-center gap-2"
            title={currentLanguage === 'tr' ? 'Barkod Tara' : 'Scan Barcode'}
          >
            <Scan className="w-4 h-4" />
            <span>{currentLanguage === 'tr' ? 'Barkod Tara' : 'Scan Barcode'}</span>
          </button>
          <button
            onClick={() => {
              const csv = Papa.unparse(inventory.map(i => ({
                'Ürün Adı': i.name,
                'SKU': i.sku,
                'Kategori': i.category,
                'Stok': i.stockLevel,
                'Maliyet': i.costPrice,
                'Fiyat': i.prices?.['Retail'] || i.price
              })));
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
              const link = document.createElement('a');
              link.href = URL.createObjectURL(blob);
              link.download = `envanter_${new Date().toISOString().split('T')[0]}.csv`;
              link.click();
            }}
            className="apple-button-secondary p-2.5 flex items-center justify-center"
            title={currentLanguage === 'tr' ? 'Dışa Aktar' : 'Export'}
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Category Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none -mx-1 px-1">
        <button
          onClick={() => setSelectedCategory('all')}
          className={cn(
            "px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap",
            selectedCategory === 'all'
              ? "bg-brand text-white shadow-md"
              : "bg-white text-[#86868B] border border-gray-200 hover:border-gray-300"
          )}
        >
          {currentLanguage === 'tr' ? 'Tümü' : 'All'}
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap",
              selectedCategory === cat
                ? "bg-brand text-white shadow-md"
                : "bg-white text-[#86868B] border border-gray-200 hover:border-gray-300"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      <BarcodeScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        currentLanguage={currentLanguage as 'tr' | 'en'}
        title={currentLanguage === 'tr' ? 'Ürün Barkodu Tara' : 'Scan Product Barcode'}
        placeholder={currentLanguage === 'tr' ? 'SKU veya barkod girin...' : 'Enter SKU or barcode...'}
        onScan={(barcode) => {
          setSearchTerm(barcode);
          // auto-select if single exact match
          const match = inventory.find(i => i.sku === barcode || i.sku.toLowerCase() === barcode.toLowerCase());
          if (match) setSelectedProduct(match);
        }}
      />
      <ProductForm
        isOpen={isAddingProduct}
        onClose={() => { setIsAddingProduct(false); setEditingProduct(null); }}
        initialData={editingProduct}
        onSave={() => {
          setIsAddingProduct(false);
          setEditingProduct(null);
        }}
        warehouses={warehouses}
        existingCategories={categories}
      />
      {selectedProduct && <ProductDetail product={selectedProduct} onClose={() => setSelectedProduct(null)} />}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        <div className="xl:col-span-3 space-y-6">
          {/* Desktop Table View */}
          <div className="apple-card overflow-hidden hidden md:block border border-gray-100 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <SortHeader 
                      label={`${currentT.product} / SKU`} 
                      sortKey="name" 
                      currentSort={sortConfig} 
                      onSort={handleSort} 
                    />
                    <SortHeader 
                      label={currentT.category} 
                      sortKey="category" 
                      currentSort={sortConfig} 
                      onSort={handleSort} 
                    />
                    <th className="px-6 py-4 text-[11px] font-bold text-[#86868B] uppercase tracking-widest">{currentT.warehouse}</th>
                    <SortHeader 
                      label={currentT.stock} 
                      sortKey="stockLevel" 
                      currentSort={sortConfig} 
                      onSort={handleSort} 
                    />
                    <SortHeader 
                      label={currentT.price} 
                      sortKey="price" 
                      currentSort={sortConfig} 
                      onSort={handleSort} 
                    />
                    <th className="px-6 py-4 text-[11px] font-bold text-[#86868B] uppercase tracking-widest">{currentT.status}</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-[#86868B] uppercase tracking-widest text-right">{currentT.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredInventory.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/50 transition-colors cursor-pointer group" onClick={() => setSelectedProduct(item)}>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-gray-900">{item.name}</span>
                          <span className="text-[10px] font-mono text-[#86868B] tracking-wider">{item.sku}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-0.5 bg-gray-100 text-[#86868B] rounded-md text-[10px] font-bold uppercase">
                          {item.category || currentT.unspecified}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-gray-600">
                        {item.location || currentT.main_warehouse}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-sm font-bold",
                            item.stockLevel <= item.lowStockThreshold ? "text-red-500" : "text-gray-900"
                          )}>
                            {item.stockLevel}
                          </span>
                          {item.stockLevel <= item.lowStockThreshold && (
                            <AlertTriangle className="w-3 h-3 text-red-500" />
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-bold text-gray-900">
                          {(item.price ?? item.prices?.['Retail'] ?? 0).toLocaleString()} TL
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider",
                          item.stockLevel <= item.lowStockThreshold ? "bg-red-50 text-red-600 border border-red-100" : "bg-green-50 text-green-600 border border-green-100"
                        )}>
                          {item.stockLevel <= item.lowStockThreshold ? currentT.critical : currentT.normal}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedProduct(item); }}
                            className="p-2 rounded-xl hover:bg-blue-50 text-[#86868B] hover:text-blue-600 transition-all"
                            title={currentLanguage === 'tr' ? 'İncele' : 'View'}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingProduct(item); setIsAddingProduct(true); }}
                            className="p-2 rounded-xl hover:bg-brand/10 text-[#86868B] hover:text-brand transition-all"
                            title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmState({
                                isOpen: true,
                                title: currentT.confirm_delete,
                                message: currentT.confirm_delete_product || 'Bu ürünü silmek istediğinize emin misiniz?',
                                onConfirm: async () => {
                                  try {
                                    await deleteDoc(doc(db, 'inventory', item.id));
                                  } catch (error) {
                                    handleFirestoreError(error, OperationType.DELETE, `inventory/${item.id}`);
                                  }
                                }
                              });
                            }}
                            className="p-2 rounded-xl hover:bg-red-50 text-[#86868B] hover:text-red-500 transition-all"
                            title={currentT.delete}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {filteredInventory.map((item) => (
              <div key={item.id} className="apple-card p-4 space-y-4" onClick={() => setSelectedProduct(item)}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-bold">{item.name}</p>
                    <p className="text-xs text-[#86868B]">{item.sku}</p>
                  </div>
                  <span className={cn(
                    "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                    item.stockLevel <= item.lowStockThreshold ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"
                  )}>
                    {item.stockLevel <= item.lowStockThreshold ? currentT.critical : currentT.normal}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
                  <div>
                    <p className="text-[10px] font-bold text-[#86868B] uppercase">{currentT.stock}</p>
                    <p className="text-sm font-bold">{item.stockLevel}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[#86868B] uppercase">{currentT.price}</p>
                    <p className="text-sm font-bold">{(item.price ?? item.prices?.['Retail'] ?? 0).toLocaleString()} TL</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[#86868B] uppercase">{currentT.category}</p>
                    <p className="text-xs font-medium">{item.category || currentT.unspecified}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[#86868B] uppercase">{currentT.warehouse}</p>
                    <p className="text-xs font-medium">{item.location || currentT.main_warehouse}</p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-100">
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedProduct(item); }}
                    className="p-2 rounded-xl bg-blue-50 text-blue-600"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingProduct(item); setIsAddingProduct(true); }}
                    className="p-2 rounded-xl bg-brand/10 text-brand"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmState({
                        isOpen: true,
                        title: currentT.confirm_delete,
                        message: currentT.confirm_delete_product || 'Bu ürünü silmek istediğinize emin misiniz?',
                        onConfirm: async () => {
                          try {
                            await deleteDoc(doc(db, 'inventory', item.id));
                          } catch (error) {
                            handleFirestoreError(error, OperationType.DELETE, `inventory/${item.id}`);
                          }
                        }
                      });
                    }}
                    className="p-2 rounded-xl bg-red-50 text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="xl:col-span-1">
          <div className="apple-card p-6 border border-gray-100 shadow-sm sticky top-24">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-brand" /> {currentT.movements}
              </h3>
            </div>
            <div className="space-y-4">
              {movements.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <History className="w-6 h-6 text-gray-300" />
                  </div>
                  <p className="text-sm text-gray-400 font-medium">{currentLanguage === 'tr' ? 'Kayıt bulunamadı' : 'No movements found'}</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {movements.map((mov) => (
                    <div key={mov.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn(
                          "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded",
                          mov.type === 'in' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                        )}>
                          {mov.type === 'in' ? (currentLanguage === 'tr' ? 'Giriş' : 'In') : (currentLanguage === 'tr' ? 'Çıkış' : 'Out')}
                        </span>
                        <span className="text-[10px] text-gray-400 font-medium">
                          {mov.timestamp && typeof (mov.timestamp as { toDate?: () => Date }).toDate === 'function' ? format((mov.timestamp as { toDate: () => Date }).toDate(), 'HH:mm') : ''}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-gray-900 truncate">{mov.productName}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-gray-500">
                          {mov.timestamp ? format(typeof (mov.timestamp as { toDate?: () => Date }).toDate === 'function' ? (mov.timestamp as { toDate: () => Date }).toDate() : new Date(mov.timestamp as string | number | Date), 'dd MMM yyyy', { locale: currentLanguage === 'tr' ? tr : undefined }) : ''}
                        </span>
                        <span className={cn(
                          "text-xs font-bold",
                          mov.type === 'in' ? "text-green-600" : "text-red-600"
                        )}>
                          {mov.type === 'in' ? '+' : '-'}{mov.quantity}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
        onConfirm={() => {
          confirmState.onConfirm();
          setConfirmState(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
// --- Unauthorized Access View ---
const UnauthorizedView = ({ currentLanguage, tab }: { currentLanguage: string; tab: string }) => (
  <motion.div key="unauthorized" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
    className="flex flex-col items-center justify-center min-h-[400px] text-center px-4">
    <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mb-6">
      <Lock className="w-10 h-10 text-red-400" />
    </div>
    <h2 className="text-2xl font-bold text-[#1D1D1F] mb-2">
      {currentLanguage === 'tr' ? 'Erişim Kısıtlı' : 'Access Restricted'}
    </h2>
    <p className="text-sm text-gray-500 max-w-sm">
      {currentLanguage === 'tr'
        ? `"${tab}" bölümüne erişim yetkiniz bulunmuyor. Lütfen sisteminize yöneticiye başvurun.`
        : `You don't have permission to access "${tab}". Please contact your system administrator.`}
    </p>
    <div className="mt-6 px-4 py-2.5 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium">
      🔒 {currentLanguage === 'tr' ? 'Bu alan yalnızca yetkili personele açıktır.' : 'This area is restricted to authorized personnel only.'}
    </div>
  </motion.div>
);

// --- Read-Only Banner ---
const ReadOnlyBanner = ({ currentLanguage }: { currentLanguage: string }) => (
  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-xl text-xs font-semibold text-amber-700 mb-4">
    <Eye className="w-3.5 h-3.5 flex-shrink-0" />
    {currentLanguage === 'tr' ? 'Yalnızca Görüntüleme — Bu bölümü düzenleyemezsiniz.' : 'Read Only — You cannot edit this section.'}
  </div>
);

const ReportsDashboard = ({ orders, inventory, exchangeRates, currentT, currentLanguage, userRole, onNavigate, employees }: { orders: Order[], inventory: InventoryItem[], exchangeRates: Record<string, number> | null, currentT: Record<string, string>, currentLanguage: string, userRole?: string | null, onNavigate?: (tab: string) => void, employees: Employee[] }) => {
  const [timeRange, setTimeRange] = useState('30');
  const [revenueCurrency, setRevenueCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const [reportsTab, setReportsTab] = useState<'genel'|'crm'|'envanter'|'lojistik'|'ik'>('genel');
  const [invSummarySort, setInvSummarySort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'name', dir: 'asc'});
  const [logisticsSummarySort, setLogisticsSummarySort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'customerName', dir: 'asc'});

  // HR Data for Reports
  const [hrStats, setHrStats] = useState({
    activeEmployees: 0,
    totalPayroll: 0,
    pendingLeave: 0,
    departmentDistribution: [] as { name: string, value: number }[],
    payrollTrend: [] as { name: string, value: number }[]
  });

  useEffect(() => {
    if (!employees) return;
    const active = employees.filter(e => e.status === 'Aktif').length;
    const depts = employees.reduce((acc: Record<string, number>, e) => {
      acc[e.department] = (acc[e.department] || 0) + 1;
      return acc;
    }, {});
    // eslint-disable-next-line
    setHrStats(prev => ({
      ...prev,
      activeEmployees: active,
      departmentDistribution: Object.entries(depts).map(([name, value]) => ({ name, value: Number(value) }))
    }));
  }, [employees]);

  useEffect(() => {
    if (reportsTab !== 'ik' || !userRole) return;

    const unsubLeave = onSnapshot(query(collection(db, 'leaveRequests'), where('status', '==', 'Bekliyor')), (snap) => {
      setHrStats(prev => ({ ...prev, pendingLeave: snap.size }));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'leaveRequests', auth.currentUser?.uid));

    const unsubPayroll = onSnapshot(collection(db, 'payrolls'), (snap) => {
      const pays = snap.docs.map(d => d.data());
      const total = pays.filter(p => p.status === 'Ödendi').reduce((sum, p) => sum + (p.netSalary || 0), 0);
      
      const trend = pays.reduce((acc: Record<string, number>, p) => {
        const key = `${p.month}/${p.year}`;
        acc[key] = (acc[key] || 0) + (p.netSalary || 0);
        return acc;
      }, {});

      setHrStats(prev => ({
        ...prev,
        totalPayroll: total,
        payrollTrend: Object.entries(trend).map(([name, value]) => ({ name, value: Number(value) }))
      }));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'payrolls', auth.currentUser?.uid));

    return () => {
      unsubLeave();
      unsubPayroll();
    };
  }, [reportsTab, userRole]);

  // KPI Calculations
  const totalRevenueTRY = orders
    .filter(o => o.status !== 'Cancelled')
    .reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0);
  const revenueSymbol = revenueCurrency === 'USD' ? '$' : revenueCurrency === 'EUR' ? '€' : '₺';
  const revenueFormatted = formatInCurrency(totalRevenueTRY, revenueCurrency, exchangeRates);
  const totalOrders = orders.length;
  const avgOrderValueTRY = totalOrders > 0 ? totalRevenueTRY / totalOrders : 0;
  const avgOrderFormatted = formatInCurrency(avgOrderValueTRY, revenueCurrency, exchangeRates);
  const lowStockItems = inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length;

  // Sales Trend Data
  const salesByDate = orders.reduce((acc: Record<string, number>, o) => {
    let date = currentT.unknown;
    if (o.syncedAt) {
      try {
        const d = typeof (o.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (o.syncedAt as { toDate: () => Date }).toDate() : new Date(o.syncedAt as unknown as string | number | Date);
        date = format(d, 'dd MMM', { locale: currentLanguage === 'tr' ? tr : enUS });
      } catch (e) {
        console.error("Error formatting date:", e);
      }
    }
    acc[date] = (acc[date] || 0) + (Number(o.totalPrice) || 0);
    return acc;
  }, {});

  const trendData = Object.entries(salesByDate)
    .map(([name, value]) => ({ name, value: Number(value) }))
    .sort((a, b) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
      const getMonthIndex = (dateStr: string) => { const parts = dateStr.split(' '); if (parts.length < 2) return -1; return months.indexOf(parts[1]); };
      const getDay = (dateStr: string) => parseInt(dateStr.split(' ')[0]);
      const monthA = getMonthIndex(a.name); const monthB = getMonthIndex(b.name);
      if (monthA !== monthB) return monthA - monthB;
      return getDay(a.name) - getDay(b.name);
    })
    .slice(-30);

  // Category Data
  const categoryData = inventory.reduce((acc: Record<string, number>, item) => {
    const category = item.category || currentT.other;
    acc[category] = (acc[category] || 0) + item.stockLevel;
    return acc;
  }, {});
  const categoryChartData = Object.entries(categoryData).map(([name, value]) => ({ name, value: Number(value) }));

  // --- CRM sub-data ---
  const ordersByStatus = orders.reduce((acc: Record<string, number>, o) => { acc[o.status] = (acc[o.status]||0)+1; return acc; }, {});
  const statusChartData = Object.entries(ordersByStatus).map(([name, value]) => ({ name, value: Number(value) }));
  const topCustomers = Object.values(
    orders.reduce((acc: Record<string, { name: string; total: number; count: number }>, o) => {
      const k = o.customerName || '—';
      if (!acc[k]) acc[k] = { name: k, total: 0, count: 0 };
      acc[k].total += Number(o.totalPrice) || 0;
      acc[k].count += 1;
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total).slice(0, 8);

  // --- Inventory sub-data ---
  const totalInventoryValueTRY = inventory.reduce((s, i) => s + (i.stockLevel * ((i.prices?.['Retail']) || 0)), 0);
  const categoryValueData = inventory.reduce((acc: Record<string, { name: string; count: number; value: number }>, item) => {
    const cat = item.category || 'Diğer';
    if (!acc[cat]) acc[cat] = { name: cat, count: 0, value: 0 };
    acc[cat].count += item.stockLevel;
    acc[cat].value += item.stockLevel * ((item.prices?.['Retail']) || 0);
    return acc;
  }, {});
  const categoryValueChartData = Object.values(categoryValueData);

  const COLORS = ['#ff4000', '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#00C7BE', '#FF2D55'];

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.text(currentT.report_title, 14, 15);
    autoTable(doc, {
      head: [[currentT.customer, currentT.amount, currentT.status, currentT.date]],
      body: orders.map(o => [
        o.customerName,
        `${Number(o.totalPrice).toLocaleString()} TL`,
        currentT[o.status.toLowerCase()] || o.status,
        o.syncedAt ? format(typeof (o.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (o.syncedAt as { toDate: () => Date }).toDate() : new Date(o.syncedAt as unknown as string | number | Date), 'dd.MM.yyyy') : ''
      ]),
      startY: 25,
    });
    doc.save(`cetpa-rapor-${format(new Date(), 'dd-MM-yyyy')}.pdf`);
  };

  const subTabs = [
    { id: 'genel', label: currentLanguage==='tr'?'Genel Bakış':'Overview', icon: LayoutDashboard },
    { id: 'crm', label: currentLanguage==='tr'?'CRM & Satış':'CRM & Sales', icon: Users },
    { id: 'envanter', label: currentLanguage==='tr'?'Envanter':'Inventory', icon: List },
    { id: 'lojistik', label: currentLanguage==='tr'?'Lojistik':'Logistics', icon: Truck },
    { id: 'ik', label: currentLanguage==='tr'?'İnsan Kaynakları':'Human Resources', icon: UserCheck },
  ] as const;

  return (
    <div className="space-y-6">
      <ModuleHeader
        title={currentT.reports}
        subtitle={currentT.reports_dashboard_desc}
        icon={BarChart3}
        actionButton={
          <div className="flex gap-3">
            <button onClick={exportPDF} className="apple-button-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> {currentT.export_pdf}
            </button>
            <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="apple-input text-sm font-semibold">
              <option value="7">{currentT.last_7_days}</option>
              <option value="30">{currentT.last_30_days}</option>
              <option value="90">{currentT.last_90_days}</option>
            </select>
          </div>
        }
      />

      {/* Sub-tab Navigation */}
      <div className="overflow-x-auto scrollbar-none">
        <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
          {subTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setReportsTab(tab.id)}
                className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${reportsTab === tab.id ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}>
                <Icon size={13} />{tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── GENEL BAKIŞ ── */}
      {reportsTab === 'genel' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}
              onClick={() => onNavigate?.('crm')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigate?.('crm'); }}
              className="apple-card p-6 text-left w-full hover:shadow-md hover:scale-[1.01] transition-all duration-200 cursor-pointer group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-brand/10">
                  <span className="text-xl font-black text-brand leading-none">{revenueSymbol}</span>
                </div>
                <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5" onClick={e => e.stopPropagation()}>
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <button key={c} onClick={() => setRevenueCurrency(c)} className={cn('px-1.5 py-0.5 rounded-md text-[9px] font-bold transition-colors', revenueCurrency === c ? 'bg-white text-brand shadow-sm' : 'text-gray-400 hover:text-gray-600')}>
                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">{currentT.kpi_revenue}</p>
              <p className="text-2xl font-bold mt-1">{revenueFormatted}</p>
              <p className="text-[10px] text-brand mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Detaya git' : 'View details'}
              </p>
            </motion.div>
            {[
              { label: currentT.kpi_orders, value: String(totalOrders), icon: Package as React.ElementType | null, symbol: null as string | null, color: 'text-blue-500', bg: 'bg-blue-50', tab: 'crm' },
              { label: currentT.kpi_avg_order, value: avgOrderFormatted, icon: null, symbol: revenueSymbol, color: 'text-green-500', bg: 'bg-green-50', tab: 'crm' },
              { label: currentT.kpi_low_stock, value: String(lowStockItems), icon: AlertCircle as React.ElementType | null, symbol: null, color: 'text-orange-500', bg: 'bg-orange-50', tab: 'inventory' },
            ].map((kpi, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: (i + 1) * 0.1 }}
                onClick={() => onNavigate?.(kpi.tab)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigate?.(kpi.tab); }}
                className="apple-card p-6 text-left w-full hover:shadow-md hover:scale-[1.01] transition-all duration-200 cursor-pointer group">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-4", kpi.bg)}>
                  {kpi.symbol ? <span className={cn('text-xl font-black leading-none', kpi.color)}>{kpi.symbol}</span> : kpi.icon && <kpi.icon className={cn("w-6 h-6", kpi.color)} />}
                </div>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">{kpi.label}</p>
                <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                <p className="text-[10px] text-brand mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Detaya git' : 'View details'}
                </p>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="apple-card p-8">
              <h3 className="text-lg font-bold mb-6">{currentT.sales_trend}</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff4000" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#ff4000" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5F7" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#86868B' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#86868B' }} />
                    <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }} />
                    <Area type="monotone" dataKey="value" stroke="#ff4000" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="apple-card p-8">
              <h3 className="text-lg font-bold mb-6">{currentT.category_dist}</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie data={categoryChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                      {categoryChartData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36} />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CRM & SATIŞ ── */}
      {reportsTab === 'crm' && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: currentLanguage==='tr'?'Toplam Sipariş':'Total Orders', value: String(totalOrders), color: 'text-brand', bg: 'bg-brand/10' },
              { label: currentLanguage==='tr'?'Teslim Edilen':'Delivered', value: String(orders.filter(o=>o.status==='Delivered').length), color: 'text-green-600', bg: 'bg-green-50' },
              { label: currentLanguage==='tr'?'Bekleyen':'Pending', value: String(orders.filter(o=>o.status==='Pending').length), color: 'text-yellow-600', bg: 'bg-yellow-50' },
              { label: currentLanguage==='tr'?'İptal':'Cancelled', value: String(orders.filter(o=>o.status==='Cancelled').length), color: 'text-red-500', bg: 'bg-red-50' },
            ].map((k,i) => (
              <motion.div key={i} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}}
                className={`apple-card p-5 ${k.bg}`}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{k.label}</p>
                <p className={`text-3xl font-bold ${k.color}`}>{k.value}</p>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Status Dağılımı */}
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Sipariş Durumu Dağılımı':'Order Status Distribution'}</h3>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie data={statusChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={4} dataKey="value" label={(props: { name?: string, percent?: number }) => `${props.name || ''} ${((props.percent||0)*100).toFixed(0)}%`} labelLine={false}>
                      {statusChartData.map((_, i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Top Müşteriler */}
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'En Çok Sipariş Veren Müşteriler':'Top Customers by Revenue'}</h3>
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {topCustomers.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">{currentLanguage==='tr'?'Henüz sipariş yok.':'No orders yet.'}</p>
                ) : topCustomers.map((c, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <div className="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center text-[10px] font-bold text-brand flex-shrink-0">{i+1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
                      <p className="text-xs text-gray-400">{c.count} {currentLanguage==='tr'?'sipariş':'orders'}</p>
                    </div>
                    <span className="text-sm font-bold text-brand">₺{c.total.toLocaleString('tr-TR',{minimumFractionDigits:0})}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Satış Trendi */}
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentT.sales_trend}</h3>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5F7" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#86868B'}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#86868B'}} />
                  <Tooltip contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 10px 25px rgba(0,0,0,0.1)'}} />
                  <Bar dataKey="value" fill="#ff4000" radius={[6,6,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ── ENVANTERi ── */}
      {reportsTab === 'envanter' && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: currentLanguage==='tr'?'Toplam Ürün':'Total Products', value: String(inventory.length), color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: currentLanguage==='tr'?'Düşük Stok':'Low Stock', value: String(lowStockItems), color: 'text-orange-500', bg: 'bg-orange-50' },
              { label: currentLanguage==='tr'?'Toplam Stok Değeri':'Total Stock Value', value: `₺${totalInventoryValueTRY.toLocaleString('tr-TR',{minimumFractionDigits:0,maximumFractionDigits:0})}`, color: 'text-green-600', bg: 'bg-green-50' },
              { label: currentLanguage==='tr'?'Kategori Sayısı':'Categories', value: String(Object.keys(categoryData).length), color: 'text-purple-600', bg: 'bg-purple-50' },
            ].map((k,i) => (
              <motion.div key={i} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}}
                className={`apple-card p-5 ${k.bg}`}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{k.label}</p>
                <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Kategori Stok */}
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Kategori Bazlı Stok':'Stock by Category'}</h3>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryValueChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F5F5F7" />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#86868B'}} />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#86868B'}} width={80} />
                    <Tooltip contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 10px 25px rgba(0,0,0,0.1)'}} />
                    <Bar dataKey="count" fill="#007AFF" radius={[0,6,6,0]} name={currentLanguage==='tr'?'Adet':'Units'} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Düşük Stok Listesi */}
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Kritik Stok Ürünleri':'Critical Stock Items'}</h3>
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="text-sm font-medium">{currentLanguage==='tr'?'Tüm ürünler yeterli stokta':'All products in stock'}</span>
                  </div>
                ) : inventory.filter(i => i.stockLevel <= i.lowStockThreshold).sort((a,b) => a.stockLevel-b.stockLevel).map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{item.name}</p>
                      <p className="text-xs text-gray-400">{item.sku}</p>
                    </div>
                    <div className="text-right ml-3">
                      <p className="text-sm font-bold text-red-500">{item.stockLevel} {currentLanguage==='tr'?'adet':'units'}</p>
                      <p className="text-[10px] text-gray-400">Min: {item.lowStockThreshold}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tüm Envanter Tablosu */}
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Envanter Özeti':'Inventory Summary'}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {[
                      {k:'name', label:currentLanguage==='tr'?'Ürün':'Product', align:'text-left', cls:''},
                      {k:'category', label:currentLanguage==='tr'?'Kategori':'Category', align:'text-left', cls:'hidden sm:table-cell'},
                      {k:'stockLevel', label:currentLanguage==='tr'?'Stok':'Stock', align:'text-right', cls:''},
                      {k:'value', label:currentLanguage==='tr'?'Değer':'Value', align:'text-right', cls:'hidden md:table-cell'},
                    ].map(({k,label,align,cls}) => {
                      const active = invSummarySort.key === k;
                      return (
                        <th key={k} onClick={() => setInvSummarySort(s=>({key:k,dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} className={`${align} py-2 px-3 font-medium text-xs cursor-pointer select-none transition-colors ${cls} ${active?'text-brand':'text-gray-500 hover:text-gray-700'}`}>
                          {label} <span className={active?'opacity-100':'opacity-25'}>{active?(invSummarySort.dir==='asc'?'↑':'↓'):'↕'}</span>
                        </th>
                      );
                    })}
                    <th className="text-center py-2 px-3 text-gray-500 font-medium text-xs">{currentLanguage==='tr'?'Durum':'Status'}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...inventory].sort((a,b) => {
                    const av = invSummarySort.key === 'value'
                      ? (a.stockLevel * (a.prices?.['Retail'] || 0))
                      : (a as Record<string,unknown>)[invSummarySort.key] as string|number ?? '';
                    const bv = invSummarySort.key === 'value'
                      ? (b.stockLevel * (b.prices?.['Retail'] || 0))
                      : (b as Record<string,unknown>)[invSummarySort.key] as string|number ?? '';
                    if (av < bv) return invSummarySort.dir === 'asc' ? -1 : 1;
                    if (av > bv) return invSummarySort.dir === 'asc' ? 1 : -1;
                    return 0;
                  }).slice(0,10).map((item, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3">
                        <p className="font-medium text-gray-800">{item.name}</p>
                        <p className="text-xs text-gray-400">{item.sku}</p>
                      </td>
                      <td className="py-2.5 px-3 text-gray-500 text-xs hidden sm:table-cell">{item.category||'—'}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-gray-800">{item.stockLevel}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500 text-xs hidden md:table-cell">₺{((item.stockLevel*(item.prices?.['Retail']||0))).toLocaleString('tr-TR',{minimumFractionDigits:0})}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.stockLevel <= item.lowStockThreshold ? 'bg-red-100 text-red-600' : item.stockLevel <= item.lowStockThreshold*2 ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'}`}>
                          {item.stockLevel <= item.lowStockThreshold ? (currentLanguage==='tr'?'Kritik':'Critical') : item.stockLevel <= item.lowStockThreshold*2 ? (currentLanguage==='tr'?'Düşük':'Low') : (currentLanguage==='tr'?'Normal':'Normal')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {inventory.length > 10 && <p className="text-xs text-center text-gray-400 mt-3 py-2">{currentLanguage==='tr'?`+${inventory.length-10} ürün daha — Envanter sekmesine gidin`:`+${inventory.length-10} more items — Go to Inventory tab`}</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── LOJİSTİK ── */}
      {reportsTab === 'lojistik' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: currentLanguage==='tr'?'Toplam Sipariş':'Total Orders', value: String(totalOrders), color: 'text-brand', bg: 'bg-brand/10' },
              { label: currentLanguage==='tr'?'Teslim Edilen':'Delivered', value: String(orders.filter(o=>o.status==='Delivered').length), color: 'text-green-600', bg: 'bg-green-50' },
              { label: currentLanguage==='tr'?'Aktarma':'In Transit', value: String(orders.filter(o=>o.status==='Shipped').length), color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: currentLanguage==='tr'?'Toplam Ciro':'Revenue', value: `₺${totalRevenueTRY.toLocaleString('tr-TR',{minimumFractionDigits:0})}`, color: 'text-purple-600', bg: 'bg-purple-50' },
            ].map((k,i) => (
              <motion.div key={i} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}} className={`apple-card p-5 ${k.bg}`}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{k.label}</p>
                <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              </motion.div>
            ))}
          </div>

          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Teslimat Performansı':'Delivery Performance'}</h3>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie data={statusChartData} cx="50%" cy="50%" outerRadius={100} paddingAngle={4} dataKey="value" label={(props: { name?: string, value?: number }) => `${props.name || ''}: ${props.value || 0}`}>
                    {statusChartData.map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </RePieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Son Siparişler — Lojistik Durumu':'Recent Orders — Logistics Status'}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {[
                      {k:'shopifyOrderId', label:currentLanguage==='tr'?'Sipariş':'Order', align:'text-left', cls:''},
                      {k:'customerName', label:currentLanguage==='tr'?'Müşteri':'Customer', align:'text-left', cls:'hidden sm:table-cell'},
                      {k:'shippingAddress', label:currentLanguage==='tr'?'Adres':'Address', align:'text-left', cls:'hidden md:table-cell'},
                      {k:'status', label:currentLanguage==='tr'?'Durum':'Status', align:'text-center', cls:''},
                    ].map(({k,label,align,cls}) => {
                      const active = logisticsSummarySort.key === k;
                      return (
                        <th key={k} onClick={() => setLogisticsSummarySort(s=>({key:k,dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} className={`${align} py-2 px-3 font-medium text-xs cursor-pointer select-none transition-colors ${cls} ${active?'text-brand':'text-gray-500 hover:text-gray-700'}`}>
                          {label} <span className={active?'opacity-100':'opacity-25'}>{active?(logisticsSummarySort.dir==='asc'?'↑':'↓'):'↕'}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {[...orders].sort((a,b) => {
                    const av = (a as unknown as Record<string,unknown>)[logisticsSummarySort.key] as string|number ?? '';
                    const bv = (b as unknown as Record<string,unknown>)[logisticsSummarySort.key] as string|number ?? '';
                    if (av < bv) return logisticsSummarySort.dir === 'asc' ? -1 : 1;
                    if (av > bv) return logisticsSummarySort.dir === 'asc' ? 1 : -1;
                    return 0;
                  }).slice(0,8).map((o,i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-mono text-xs text-gray-600">#{o.shopifyOrderId||o.id?.slice(-6)||'—'}</td>
                      <td className="py-2.5 px-3 font-medium text-gray-800 hidden sm:table-cell">{o.customerName||'—'}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-400 truncate max-w-[150px] hidden md:table-cell">{o.shippingAddress||'—'}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${o.status==='Delivered'?'bg-green-100 text-green-600':o.status==='Shipped'?'bg-blue-100 text-blue-600':o.status==='Pending'?'bg-yellow-100 text-yellow-600':'bg-gray-100 text-gray-500'}`}>{o.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── İNSAN KAYNAKLARI ── */}
      {reportsTab === 'ik' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: currentLanguage==='tr'?'Aktif Çalışan':'Active Employees', value: hrStats.activeEmployees.toString(), icon: Users, color: 'text-blue-600', bg: 'bg-blue-50', desc: currentLanguage==='tr'?'Toplam çalışan sayısı':'Total employee count' },
              { label: currentLanguage==='tr'?'Ödenen Maaş':'Paid Salary', value: '₺' + hrStats.totalPayroll.toLocaleString(), icon: CreditCard, color: 'text-green-600', bg: 'bg-green-50', desc: currentLanguage==='tr'?'Toplam ödenen bordro':'Total paid payroll' },
              { label: currentLanguage==='tr'?'İzin Bekleyen':'Pending Leave', value: hrStats.pendingLeave.toString(), icon: Calendar, color: 'text-orange-500', bg: 'bg-orange-50', desc: currentLanguage==='tr'?'Onay bekleyen talepler':'Requests awaiting approval' },
            ].map((k,i) => {
              const Icon = k.icon;
              return (
                <div key={i} className={`apple-card p-5 ${k.bg}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <Icon className={`w-5 h-5 ${k.color}`} />
                    <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">{k.label}</p>
                  </div>
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{k.desc}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="apple-card p-6">
              <h4 className="font-bold mb-6">{currentLanguage==='tr'?'Departman Dağılımı':'Department Distribution'}</h4>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie
                      data={hrStats.departmentDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {hrStats.departmentDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="apple-card p-6">
              <h4 className="font-bold mb-6">{currentLanguage==='tr'?'Maaş Ödeme Trendi':'Payroll Payment Trend'}</h4>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hrStats.payrollTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#ff4000" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="apple-card p-6 text-center">
            <div className="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <UserCheck className="w-8 h-8 text-purple-500" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">{currentLanguage==='tr'?'İK Yönetimine Git':'Go to HR Management'}</h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">{currentLanguage==='tr'?'Detaylı çalışan yönetimi, bordro hesaplama ve izin onayları için İK sekmesini kullanın.':'Use the HR tab for detailed employee management, payroll calculation, and leave approvals.'}</p>
            <button onClick={() => onNavigate?.('ik')} className="apple-button-primary px-6 py-2 text-sm">
              {currentLanguage==='tr'?'İnsan Kaynakları Sekmesine Git →':'Go to Human Resources →'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Fix Leaflet icons
// @ts-expect-error Leaflet types don't include _getIconUrl
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const LogisticsMap = ({ orders, routeStops, depot, currentT }: { orders: Order[]; routeStops: RouteStop[]; depot: { lat: number; lng: number }; currentT: Record<string, string> }) => {
  const routePositions: [number, number][] = routeStops.length > 0
    ? [[depot.lat, depot.lng], ...routeStops.map(s => [s.location.lat, s.location.lng] as [number, number])]
    : [];

  return (
    <div className="h-[400px] md:h-[600px] w-full rounded-xl overflow-hidden border border-gray-200 shadow-sm relative z-0">
      <MapContainer
        center={[depot.lat, depot.lng]}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {/* Route polyline */}
        {routePositions.length > 1 && (
          <Polyline positions={routePositions} color="#ff4000" weight={3} dashArray="8 4" />
        )}
        {orders.filter(o => o.location).map(order => {
          const routeStop = routeStops.find(s => s.orderId === order.id);
          return (
            <Marker
              key={order.id}
              position={[order.location!.lat, order.location!.lng]}
            >
              <Popup>
                <div className="p-1">
                  <h4 className="font-bold text-sm text-[#1D2226]">{order.customerName}</h4>
                  <p className="text-xs text-gray-500 mt-1">{currentT.order}: {order.shopifyOrderId}</p>
                  <p className="text-xs font-medium text-brand mt-1">{currentT.status}: {currentT[order.status.toLowerCase()] || order.status}</p>
                  {routeStop && (
                    <p className="text-xs font-bold text-brand mt-1">
                      {currentT.stop} #{routeStop.sequence} — {currentT.eta}: {routeStop.estimatedMinutes} {currentT.min}
                    </p>
                  )}
                  <p className="text-[10px] text-gray-400 mt-2">{order.shippingAddress}</p>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </ErrorBoundary>
  );
}

const SortIcon = ({ col, config }: { col: string; config: { key: string; dir: 'asc' | 'desc' } }) => (
  <TrendingUp className={cn(
    "w-3 h-3 ml-1 transition-all opacity-0 group-hover:opacity-100",
    config.key === col ? "opacity-100 text-brand" : "text-gray-300",
    config.key === col && config.dir === 'desc' ? "rotate-180" : ""
  )} />
);

function AppContent() {
  const [currentLanguage, setCurrentLanguage] = useState<Language>('tr');
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('cetpa-theme-mode') === 'dark';
  });

  React.useEffect(() => {
    const html = document.documentElement;
    if (darkMode) {
      html.classList.add('dark');
      localStorage.setItem('cetpa-theme-mode', 'dark');
    } else {
      html.classList.remove('dark');
      localStorage.setItem('cetpa-theme-mode', 'light');
    }
  }, [darkMode]);
  const toast = useToast();
  const currentT = translations[currentLanguage];
  const dashT = currentLanguage === 'en' ? {
    greeting: 'Hello', subtitle: 'Cetpa Sales & Logistics — Overview',
    total_orders: 'Total Orders', pending: 'pending', active_leads: 'Active Leads', total: 'total',
    inventory_label: 'Inventory', low_stock: 'low stock', total_revenue: 'Total Revenue', all_time: 'all time',
    quick_access: 'Quick Access', new_lead: 'New Lead', new_order: 'New Order',
    logistics: 'Logistics', reports: 'Reports', delayed: 'Overdue',
    recent_orders: 'Recent Orders', see_all: 'All →', no_orders: 'No orders yet',
    low_stock_alert: 'Low Stock Alert', inventory_link: 'Inventory →', units: 'units',
    all_in_stock: 'All products in stock', lead_summary: 'Lead Pipeline Summary',
    lead_labels: { New: 'New', Contacted: 'Contacted', Qualified: 'Qualified', Proposal: 'Proposal', Negotiation: 'Negotiation', 'Closed Won': 'Won' },
  } : {
    greeting: 'Merhaba', subtitle: 'Cetpa Satış & Lojistik — Genel Özet',
    total_orders: 'Toplam Sipariş', pending: 'bekliyor', active_leads: 'Aktif Müşteri Adayı', total: 'toplam',
    inventory_label: 'Envanter', low_stock: 'düşük stok', total_revenue: 'Toplam Gelir', all_time: 'tüm zamanlar',
    quick_access: 'Hızlı Erişim', new_lead: 'Yeni Müşteri Adayı', new_order: 'Yeni Sipariş',
    logistics: 'Lojistik', reports: 'Raporlar', delayed: 'Geciken Öd.',
    recent_orders: 'Son Siparişler', see_all: 'Tümü →', no_orders: 'Henüz sipariş yok',
    low_stock_alert: 'Düşük Stok Uyarısı', inventory_link: 'Envanter →', units: 'adet',
    all_in_stock: 'Tüm ürünler yeterli stokta', lead_summary: 'Müşteri Adayı Hattı Özeti',
    lead_labels: { New: 'Yeni', Contacted: 'İletişimde', Qualified: 'Nitelikli', Proposal: 'Teklif', Negotiation: 'Müzakere', 'Closed Won': 'Kazanıldı' },
  };
  const [user, setUser] = useState<User | null>(null);
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [emailLogin, setEmailLogin] = useState({ email: '', password: '' });
  const [isEmailLoginLoading, setIsEmailLoginLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRole>(UserRole.Sales);

  // Permission helpers
  const canAccess = (tab: string) => {
    const perms = TAB_PERMISSIONS[tab];
    if (!perms) return true; // unknown tabs: default allow
    return perms.full.includes(userRole) || perms.readonly.includes(userRole);
  };
  const hasFullAccess = (tab: string) => {
    const perms = TAB_PERMISSIONS[tab];
    if (!perms) return true;
    return perms.full.includes(userRole);
  };

  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [lojistikTab, setLojistikTab] = useState('sevkiyat');
  const [crmTab, setCrmTab] = useState('leads');
  const [adminTab, setAdminTab] = useState<'overview'|'users'|'access'|'auditlog'|'system'|'company'|'evrak'>('overview');
  const ACCESS_VALUES = ['✅','👁','📊','❌'] as const;
  type AccessVal = typeof ACCESS_VALUES[number];
  const defaultAccessMatrix: { section: string; access: AccessVal[] }[] = [
    { section: 'Dashboard',       access: ['✅','✅','📊','📊','📊','📊','📊'] },
    { section: 'CRM & Satış',    access: ['✅','✅','👁','✅','❌','❌','👁'] },
    { section: 'Envanter',       access: ['✅','✅','👁','👁','✅','❌','✅'] },
    { section: 'Lojistik & Depo',access: ['✅','✅','👁','👁','✅','❌','👁'] },
    { section: 'Muhasebe & Finans',access: ['✅','👁','✅','❌','❌','❌','❌'] },
    { section: 'Satın Alma',     access: ['✅','✅','👁','❌','✅','❌','✅'] },
    { section: 'İnsan Kaynakları',access: ['✅','✅','👁','❌','❌','✅','❌'] },
    { section: 'Risk & Uyarılar',access: ['✅','✅','✅','👁','👁','❌','👁'] },
    { section: 'Raporlar',       access: ['✅','✅','✅','📊','📊','📊','📊'] },
    { section: 'Entegrasyonlar', access: ['✅','👁','❌','❌','❌','❌','❌'] },
    { section: 'Admin',          access: ['✅','❌','❌','❌','❌','❌','❌'] },
  ];
  const [accessMatrix, setAccessMatrix] = useState(defaultAccessMatrix);
  const [firestoreUsers, setFirestoreUsers] = useState<Record<string, unknown>[]>([]);
  const [auditLogs, setAuditLogs] = useState<Record<string, unknown>[]>([]);
  const [companySettings, setCompanySettings] = useState<Record<string, unknown>>({});
  const [lucaSettings, setLucaSettings] = useState<Partial<LucaConfig>>({});
  const [mikroSettings, setMikroSettings] = useState<Partial<MikroConfig>>({});
  const [leads, setLeads] = useState<Lead[]>([]);
  const [dateRange, setDateRange] = useState({
    startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd')
  });

  const [orders, setOrders] = useState<Order[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [firestoreCategories, setFirestoreCategories] = useState<string[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | null>(null);
  const [notifications, setNotifications] = useState<Record<string, unknown>[]>([]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [kpiCurrency, setKpiCurrency] = useState<'TRY'|'USD'|'EUR'>('TRY');

  // ─── Subscription State ─────────────────────────────────────────────────
  const [userSubscription, setUserSubscription] = useState<UserSubscription | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showLoginPage, setShowLoginPage] = useState(false);
  const [showDemoForm, setShowDemoForm] = useState(false);
  const [demoForm, setDemoForm] = useState({ name: '', company: '', email: '', phone: '', message: '' });
  const [demoSubmitting, setDemoSubmitting] = useState(false);
  const [demoSubmitted, setDemoSubmitted] = useState(false);
  const [enteredApp, setEnteredApp] = useState(false);
  const [showPricingPage, setShowPricingPage] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState<{ isOpen: boolean; blockedModule: string }>({ isOpen: false, blockedModule: '' });
  const [subscriptionLoaded, setSubscriptionLoaded] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<{ id: string; date: string; amount: number; plan: string; planName?: Record<string, string>; cycle: string; status: 'paid' | 'pending' | 'failed' }[]>([]);

  // Load subscription from Firestore
  useEffect(() => {
    if (!user) { setUserSubscription(null); setSubscriptionLoaded(false); setPaymentHistory([]); return; }
    const unsub = onSnapshot(doc(db, 'subscriptions', user.uid), (snap) => {
      if (snap.exists()) {
        setUserSubscription(snap.data() as UserSubscription);
      } else {
        setUserSubscription(null);
      }
      setSubscriptionLoaded(true);
    }, () => setSubscriptionLoaded(true));

    // Load real payment history from Firestore
    const unsubPayments = onSnapshot(
      query(collection(db, 'payments'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(24)),
      (snap) => {
        setPaymentHistory(snap.docs.map(d => {
          const data = d.data();
          return { id: d.id, ...data, status: (['paid','pending','failed'].includes(data.status) ? data.status : 'paid') } as { id: string; date: string; amount: number; plan: string; planName?: Record<string, string>; cycle: string; status: 'paid' | 'pending' | 'failed' };
        }));
      },
      () => { /* payments collection may not exist yet */ }
    );

    return () => { unsub(); unsubPayments(); };
  }, [user]);

  // Check if module is accessible by subscription
  const canAccessBySubscription = (tabId: string): boolean => {
    if (isGuestMode) return true; // Guest mode: no gating
    if (!userSubscription) return false;
    if (tabId === 'settings' || tabId === 'admin') return true; // Always allow settings/admin
    return canAccessModule(userSubscription, tabId);
  };

  // Handle tab clicks with subscription gating
  const handleTabClick = (tabId: string) => {
    if (!canAccessBySubscription(tabId) && userSubscription) {
      setUpgradeModal({ isOpen: true, blockedModule: tabId });
      return;
    }
    setActiveTab(tabId);
    setIsMobileMenuOpen(false);
  };

  // Subscription handlers
  const handleSelectPlan = async (planId: SubscriptionPlan, cycle: BillingCycle) => {
    if (!user) return;
    const now = new Date();
    const endDate = new Date(now);
    if (cycle === 'monthly') endDate.setMonth(endDate.getMonth() + 1);
    else endDate.setFullYear(endDate.getFullYear() + 1);
    const planConfig = getPlanConfig(planId);
    const amount = cycle === 'monthly' ? planConfig.monthlyPrice : planConfig.yearlyPrice;
    const sub: UserSubscription = {
      plan: planId,
      cycle,
      status: 'active',
      startDate: now.toISOString(),
      endDate: endDate.toISOString(),
      maxUsers: planConfig.maxUsers,
      currentUsers: 1,
      lastPayment: now.toISOString(),
    };
    try {
      await setDoc(doc(db, 'subscriptions', user.uid), sub);
      // Write payment record to payments collection
      await addDoc(collection(db, 'payments'), {
        userId: user.uid,
        plan: planId,
        planName: planConfig.name,
        cycle,
        amount,
        currency: 'TRY',
        status: 'paid',
        date: now.toISOString(),
        createdAt: serverTimestamp(),
      });
      setShowPricingPage(false);
    } catch (e) { console.error(e); }
  };

  const handleStartTrial = async (planId: SubscriptionPlan) => {
    if (!user) return;
    const sub = createTrialSubscription(planId);
    try {
      await setDoc(doc(db, 'subscriptions', user.uid), sub);
      setShowPricingPage(false);
    } catch (e) { console.error(e); }
  };

  const handleOnboardingComplete = async (subscription: UserSubscription, companyInfo: { name: string; sector: string; size: string }) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'subscriptions', user.uid), subscription);
      await setDoc(doc(db, 'companies', user.uid), { ...companyInfo, createdAt: serverTimestamp() }, { merge: true });
      setShowOnboarding(false);
    } catch (e) { console.error(e); }
  };

  const handleCancelSubscription = async () => {
    if (!user || !userSubscription) return;
    try {
      await setDoc(doc(db, 'subscriptions', user.uid), {
        ...userSubscription,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
      });
    } catch (e) { console.error(e); }
  };

  const handleUpgrade = (planId: SubscriptionPlan) => {
    setUpgradeModal({ isOpen: false, blockedModule: '' });
    handleSelectPlan(planId, userSubscription?.cycle || 'monthly');
  };

  // Lock body scroll when menu is open
  React.useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isMobileMenuOpen]);

  const filteredOrders = orders.filter(o => {
    if (!o.createdAt) return true;
    const orderDate = (o.createdAt as { toDate?: () => Date })?.toDate ? (o.createdAt as { toDate: () => Date }).toDate() : new Date(o.createdAt as string | number | Date);
    return isWithinInterval(orderDate, {
      start: startOfDay(new Date(dateRange.startDate)),
      end: endOfDay(new Date(dateRange.endDate))
    });
  });

  const filteredLeads = leads.filter(l => {
    if (!l.createdAt) return true;
    const leadDate = (l.createdAt as { toDate?: () => Date })?.toDate ? (l.createdAt as { toDate: () => Date }).toDate() : new Date(l.createdAt as string | number | Date);
    return isWithinInterval(leadDate, {
      start: startOfDay(new Date(dateRange.startDate)),
      end: endOfDay(new Date(dateRange.endDate))
    });
  });

  // Redirect to dashboard if userRole changes and current tab is no longer accessible
  useEffect(() => {
    if (!canAccess(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [userRole]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch('/api/settings/exchange-rates')
      .then(res => res.json())
      .then(data => setExchangeRates(data.rates))
      .catch(err => console.error("Failed to fetch exchange rates:", err));
  }, []);

  useEffect(() => {
    if (!user || !userRole) return;
    const unsubNotifications = onSnapshot(query(collection(db, 'notifications'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(10)), (snap) => {
      setNotifications(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'notifications', auth.currentUser?.uid));
    return () => unsubNotifications();
  }, [user, userRole]);

  useEffect(() => {
    if (!user || userRole !== 'Admin') return;
    getDocs(query(collection(db, 'users'), limit(50)))
      .then(snap => setFirestoreUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {});
  }, [user, userRole]);

  const markNotificationRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notifications/${id}`);
    }
  };

  const createNotification = async (title: string, message: string, type: 'info' | 'warning' | 'success' = 'info') => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'notifications'), {
        userId: user.uid,
        title,
        message,
        type,
        read: false,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error creating notification:', error);
    }
  };

  // ── Auto-notification engine ──────────────────────────────────────────────
  // Runs once per session after data loads. Checks business rules and creates
  // notifications if they don't already exist (deduped by a 24h window).
  useEffect(() => {
    if (!user || !inventory.length || !orders.length) return;

    const dedupeKey = `autonotif_${user.uid}_${new Date().toDateString()}`;
    if (sessionStorage.getItem(dedupeKey)) return;
    sessionStorage.setItem(dedupeKey, '1');

    const now = Date.now();
    const DAY = 86_400_000;

    const autoNotify = async (title: string, message: string, type: 'info' | 'warning' | 'success') => {
      if (!user) return;
      try {
        // Check for duplicate in last 24h
        const recent = await getDocs(query(
          collection(db, 'notifications'),
          where('userId', '==', user.uid),
          where('title', '==', title),
          orderBy('createdAt', 'desc'),
          limit(1)
        ));
        if (!recent.empty) {
          const ts = recent.docs[0].data().createdAt?.toMillis?.() ?? 0;
          if (now - ts < DAY) return; // already notified today
        }
        await addDoc(collection(db, 'notifications'), {
          userId: user.uid, title, message, type, read: false, createdAt: serverTimestamp()
        });
      } catch { /* silent */ }
    };

    const run = async () => {
      const lang = currentLanguage;

      // 1. Low stock items
      const lowStock = inventory.filter(i => i.stockLevel <= i.lowStockThreshold);
      if (lowStock.length > 0) {
        await autoNotify(
          lang === 'tr' ? '⚠️ Düşük Stok Uyarısı' : '⚠️ Low Stock Alert',
          lang === 'tr'
            ? `${lowStock.length} ürün kritik stok seviyesinde: ${lowStock.slice(0, 3).map(i => i.name).join(', ')}${lowStock.length > 3 ? '...' : ''}`
            : `${lowStock.length} product(s) at critical stock: ${lowStock.slice(0, 3).map(i => i.name).join(', ')}${lowStock.length > 3 ? '...' : ''}`,
          'warning'
        );
      }

      // 2. Overdue pending orders (> 7 days)
      const overdueOrders = orders.filter(o => {
        if (o.status !== 'Pending') return false;
        const d = (o.createdAt as { toDate?: () => Date })?.toDate?.() ?? new Date(o.createdAt as string | number);
        return now - d.getTime() > 7 * DAY;
      });
      if (overdueOrders.length > 0) {
        await autoNotify(
          lang === 'tr' ? '🕐 Bekleyen Siparişler' : '🕐 Pending Orders Overdue',
          lang === 'tr'
            ? `${overdueOrders.length} sipariş 7 günden uzun süredir bekliyor.`
            : `${overdueOrders.length} order(s) have been pending for over 7 days.`,
          'warning'
        );
      }

      // 3. Welcome / first login
      const allNotifs = await getDocs(query(collection(db, 'notifications'), where('userId', '==', user.uid), limit(2)));
      if (allNotifs.empty) {
        await autoNotify(
          lang === 'tr' ? '👋 Cetpa\'ya Hoş Geldiniz!' : '👋 Welcome to Cetpa!',
          lang === 'tr'
            ? 'Sisteme başarıyla giriş yaptınız. İyi çalışmalar!'
            : 'You have successfully logged in. Have a productive day!',
          'success'
        );
      }
    };

    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, inventory, orders]);

  const logAuditAction = useCallback(async (action: string, details: string) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'auditLog'), {
        action,
        details,
        userId: user.uid,
        userName: user?.displayName || user?.email || 'Misafir',
        timestamp: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'auditLog');
    }
  }, [user]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const [isAddingLead, setIsAddingLead] = useState(false);
  const [newLead, setNewLead] = useState({ name: '', company: '', email: '', phone: '', notes: '' });
  const [isScoring, setIsScoring] = useState(false);

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [editingOrderData, setEditingOrderData] = useState<Partial<Order>>({});
  const [isAddingOrder, setIsAddingOrder] = useState(false);
  const [isAddingShipment, setIsAddingShipment] = useState(false);
  const [newShipment, setNewShipment] = useState<Partial<Shipment>>({ status: 'Pending' });
  const [editingShipmentId, setEditingShipmentId] = useState<string | null>(null);
  const [shipmentCustomerSearch, setShipmentCustomerSearch] = useState('');
  const [shipmentCustomerOpen, setShipmentCustomerOpen] = useState(false);
  const [newOrder, setNewOrder] = useState<Partial<Order>>({
    totalPrice: 0,
    status: 'Pending',
    shippingAddress: ''
  });
  const [orderLineItems, setOrderLineItems] = useState<OrderLineItem[]>([]);
  const [isPushingToShopify, setIsPushingToShopify] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [isOrderScannerOpen, setIsOrderScannerOpen] = useState(false);
  const [orderCustomerSearch, setOrderCustomerSearch] = useState('');
  const [orderCustomerOpen, setOrderCustomerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [isEditingLead, setIsEditingLead] = useState(false);
  const [editingLeadData, setEditingLeadData] = useState<Partial<Lead>>({});
  const [isAddingActivity, setIsAddingActivity] = useState(false);
  const [newActivity, setNewActivity] = useState<Partial<LeadActivity>>({ type: 'Note', description: '' });

  // --- Filters ---
  const [crmSearch, setCrmSearch] = useState('');
  const [crmSort, setCrmSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [orderSearch, setOrderSearch] = useState('');
  const [orderSort, setOrderSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'syncedAt', dir: 'desc' });
  const [shipmentSort, setShipmentSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  // Merge Firestore category master list with any category strings on existing inventory items
  const inventoryCategories = [...new Set([
    ...firestoreCategories,
    ...inventory.map(i => i.category).filter((c): c is string => !!c)
  ])].sort();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // ── Confirmation Modal state (replaces PIN + window.confirm) ──────────────
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: 'danger' | 'default';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => { },
  });

  const openConfirm = (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: 'danger' | 'default';
    onConfirm: () => void;
  }) => setConfirmState({ ...opts, isOpen: true });

  const closeConfirm = () => setConfirmState(prev => ({ ...prev, isOpen: false }));

  const DEPOTS = {
    eski_sanayi: { name: 'Eski Sanayi', lat: 36.9081, lng: 30.6956 },
    havalimani: { name: 'Havalimanı', lat: 36.8985, lng: 30.8005 }
  };
  const [selectedDepot, setSelectedDepot] = useState<'eski_sanayi' | 'havalimani'>('eski_sanayi');

  // --- Route Optimizer State ---
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  const [isRouteOptimized, setIsRouteOptimized] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // --- Auth & User Profile ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        // Sync user profile to Firestore
        const userRef = doc(db, 'users', u.uid);
        const userSnap = await getDoc(userRef);

        const fetchLocation = async () => {
          try {
            const res = await fetch('https://ipapi.co/json/');
            const data = await res.json();
            return `${data.city}, ${data.country_name}`;
          } catch {
            return 'Antalya, TR';
          }
        };

        const location = await fetchLocation();
        const userData = {
          name: u.displayName || 'Anonymous',
          email: u.email || '',
          photoURL: u.photoURL || '',
          lastLogin: serverTimestamp(),
          device: navigator.userAgent,
          location
        };

        if (!userSnap.exists()) {
          // New user, default to Sales role unless it's the first user or specific email
          const role = u.email === 'orcncetin@gmail.com' || u.isAnonymous ? 'Admin' : 'Sales';
          try {
            await setDoc(userRef, { ...userData, role, createdAt: serverTimestamp() });
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, `users/${u.uid}`);
          }
          setUserRole(role as UserRole);
        } else {
          try {
            await updateDoc(userRef, userData);
          } catch (error) {
            handleFirestoreError(error, OperationType.UPDATE, `users/${u.uid}`);
          }
          setUserRole((u.isAnonymous ? 'Admin' : (userSnap.data().role || 'Sales')) as UserRole);
        }
      }
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // --- Real-time Logo & Settings ---
  useEffect(() => {
    if (!user) return;
    const unsubSettings = onSnapshot(doc(db, 'settings', 'app'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setLogoUrl(data.logoUrl || null);
        setCompanySettings(data.companySettings || {});
      }
    }, (error) => importedLogFirestoreError(error, OperationType.GET, 'settings/app', user.uid));
    return () => unsubSettings();
  }, [user]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 2 * 1024 * 1024) {
      alert(currentT.logo_size_error);
      return;
    }

    setIsUploadingLogo(true);
    try {
      const logoRef = ref(storage, `settings/logo`);
      await uploadBytes(logoRef, file);
      const url = await getDownloadURL(logoRef);

      await setDoc(doc(db, 'settings', 'app'), { logoUrl: url }, { merge: true });
      setLogoUrl(url);
      logAuditAction(currentT.logo_update, currentT.logo_updated);
      alert(currentT.logo_update_success);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/app');
      alert(currentT.logo_upload_failed);
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleLogin = async () => {
    setAuthError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      const code = (error as Record<string, unknown>)?.code as string | undefined;

      // Popup flow can fail in Safari/strict privacy/adblock contexts.
      if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request') {
        try {
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectError) {
          console.error("Redirect login error:", redirectError);
        }
      }

      if (code === 'auth/unauthorized-domain') {
        alert(
          currentLanguage === 'tr'
            ? 'Bu domain Firebase Auth icin yetkili degil. Firebase Console > Authentication > Settings > Authorized domains altina localhost ve 127.0.0.1 ekleyin.'
            : 'This domain is not authorized for Firebase Auth. In Firebase Console > Authentication > Settings > Authorized domains, add localhost and 127.0.0.1.'
        );
      } else if (code === 'auth/operation-not-allowed') {
        alert(
          currentLanguage === 'tr'
            ? 'Google ile giris Firebase Authentication ayarlarinda etkin degil. Sign-in method altindan Google provider\'i aktif edin.'
            : 'Google sign-in is not enabled in Firebase Authentication. Enable the Google provider under Sign-in method.'
        );
      } else if (code === 'auth/popup-closed-by-user') {
        alert(currentLanguage === 'tr' ? 'Giris penceresi kapatildi.' : 'The sign-in popup was closed.');
      } else {
        alert(
          currentLanguage === 'tr'
            ? `Google ile giris basarisiz: ${code || 'bilinmeyen-hata'}`
            : `Google sign-in failed: ${code || 'unknown-error'}`
        );
      }
      console.error("Login error:", error);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (!emailLogin.email || !emailLogin.password) {
      setAuthError(currentLanguage === 'tr' ? 'E-posta ve sifre gerekli.' : 'Email and password are required.');
      return;
    }

    setIsEmailLoginLoading(true);
    try {
      await signInWithEmailAndPassword(auth, emailLogin.email.trim(), emailLogin.password);
    } catch (error) {
      const code = (error as Record<string, unknown>)?.code as string | undefined;
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setAuthError(currentLanguage === 'tr' ? 'E-posta veya sifre hatali.' : 'Invalid email or password.');
      } else if (code === 'auth/invalid-email') {
        setAuthError(currentLanguage === 'tr' ? 'Gecersiz e-posta adresi.' : 'Invalid email address.');
      } else if (code === 'auth/too-many-requests') {
        setAuthError(currentLanguage === 'tr' ? 'Cok fazla deneme yapildi. Lutfen daha sonra tekrar deneyin.' : 'Too many attempts. Please try again later.');
      } else {
        setAuthError(currentLanguage === 'tr' ? `Giris basarisiz: ${code || 'bilinmeyen-hata'}` : `Sign in failed: ${code || 'unknown-error'}`);
      }
      console.error('Email login error:', error);
    } finally {
      setIsEmailLoginLoading(false);
    }
  };

  const handleGuestContinue = async () => {
    setAuthError(null);
    try {
      await signInAnonymously(auth);
    } catch (error) {
      const code = (error as Record<string, unknown>)?.code as string | undefined;
      // Firebase anonymous auth not enabled — fall back to local guest mode
      if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
        setIsGuestMode(true);
        setUserRole(UserRole.Admin);
        setIsAuthReady(true);
      } else {
        // Any other error: also enter guest mode so user can still access the app
        setIsGuestMode(true);
        setUserRole(UserRole.Admin);
        setIsAuthReady(true);
      }
    }
  };

  useEffect(() => {
    getRedirectResult(auth).catch((error) => {
      console.error('Redirect result error:', error);
    });
  }, []);

  const handleLogout = () => {
    if (isGuestMode) {
      setIsGuestMode(false);
      setUser(null);
    } else {
      signOut(auth);
    }
  };

  // --- Data Fetching ---
  useEffect(() => {
    if (!isAuthReady || !user || !userRole) return;
    const leadsQuery = (userRole === UserRole.Admin || userRole === UserRole.Manager)
      ? collection(db, 'leads')
      : query(collection(db, 'leads'), where('assignedTo', '==', user.uid));
    const unsubLeads = onSnapshot(leadsQuery, (snapshot) => {
      setLeads(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Lead)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'leads', auth.currentUser?.uid));

    const ordersQuery = (userRole === UserRole.Dealer)
      ? query(collection(db, 'orders'), where('assignedTo', '==', user.uid))
      : collection(db, 'orders');
    const unsubOrders = onSnapshot(ordersQuery, (snapshot) => {
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'orders', auth.currentUser?.uid));

    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snapshot) => {
      setInventory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'inventory', auth.currentUser?.uid));

    const unsubCategories = onSnapshot(query(collection(db, 'categories'), orderBy('name')), (snapshot) => {
      setFirestoreCategories(snapshot.docs.map(d => d.data().name as string).filter(Boolean));
    }, () => { /* silently ignore — categories may not exist yet */ });

    const unsubWarehouses = onSnapshot(collection(db, 'warehouses'), (snapshot) => {
      setWarehouses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Warehouse)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'warehouses', auth.currentUser?.uid));

    const unsubMovements = onSnapshot(query(collection(db, 'inventoryMovements'), orderBy('timestamp', 'desc'), limit(20)), (snapshot) => {
      setInventoryMovements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryMovement)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'inventoryMovements', auth.currentUser?.uid));

    const unsubEmployees = onSnapshot(collection(db, 'employees'), (snapshot) => {
      setEmployees(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'employees', auth.currentUser?.uid));

    const unsubShipments = onSnapshot(collection(db, 'shipments'), (snapshot) => {
      setShipments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shipment)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'shipments', auth.currentUser?.uid));

    const unsubAuditLogs = onSnapshot(query(collection(db, 'auditLog'), orderBy('timestamp', 'desc'), limit(50)), (snapshot) => {
      setAuditLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'auditLog', auth.currentUser?.uid));

    return () => {
      unsubLeads();
      unsubOrders();
      unsubInventory();
      unsubCategories();
      unsubWarehouses();
      unsubMovements();
      unsubEmployees();
      unsubShipments();
      unsubAuditLogs();
    };
  }, [user, userRole, isAuthReady]);

  // ── Customer Risk Scoring — writes to customerRisks collection ──────────
  useEffect(() => {
    if (!user || leads.length === 0) return;
    // Debounce: only run 3 s after last lead/order change to avoid write storms
    const timer = setTimeout(async () => {
      const now = new Date();
      for (const lead of leads) {
        try {
          const customerOrders = orders.filter(
            o => o.leadId === lead.id || o.customerName === lead.name
          );
          const totalBalance = customerOrders
            .filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled')
            .reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0);

          // Overdue: orders past their payment term date
          let daysAllowed = 30;
          if (lead.paymentTerms) {
            const match = lead.paymentTerms.match(/\d+/);
            if (match) daysAllowed = parseInt(match[0], 10);
          }
          const overdueCount = customerOrders.filter(o => {
            if (o.status === 'Delivered' || o.status === 'Cancelled') return false;
            const oAny = o as unknown as Record<string, unknown>;
            const createdAt = oAny.createdAt;
            const orderDate = createdAt && typeof createdAt === 'object' && 'toDate' in createdAt
              ? (createdAt as { toDate: () => Date }).toDate()
              : new Date((oAny.syncedAt as string) || now);
            const due = new Date(orderDate);
            due.setDate(due.getDate() + daysAllowed);
            return now > due;
          }).length;

          const creditLimit = Number(lead.creditLimit) || 0;
          const utilisation = creditLimit > 0 ? Math.min(totalBalance / creditLimit, 1) : 0;

          // Risk score 0–100: weighted sum of utilisation, overdue, and order count
          const riskScore = Math.min(
            Math.round(utilisation * 50 + overdueCount * 20 + (customerOrders.length > 10 ? 10 : 0)),
            100
          );

          await setDoc(doc(db, 'customerRisks', lead.id), {
            customerId: lead.id,
            customerName: lead.name,
            company: lead.company || '',
            currentBalance: totalBalance,
            creditLimit,
            riskScore,
            overdueOrders: overdueCount,
            totalOrders: customerOrders.length,
            updatedAt: serverTimestamp(),
          }, { merge: true });
        } catch {
          // Non-critical — risk panel will show stale data
        }
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [leads, orders, user]);

  // --- Reports Filters ---
  // Nearest-neighbor TSP heuristic starting from Antalya (Eski Sanayi) depot
  const handleBuildRoute = () => {
    const eligible = orders.filter(o => o.location && o.status !== 'Delivered' && o.status !== 'Cancelled');
    if (eligible.length === 0) {
      alert(currentT.no_active_orders_to_route);
      return;
    }
    const stops: RouteStop[] = eligible.map(o => ({
      orderId: o.id,
      customerName: o.customerName,
      address: o.shippingAddress || 'Unknown Address',
      location: o.location!,
      status: o.status,
      estimatedMinutes: 0,
      sequence: 0,
    }));
    const optimized = optimizeRoute(stops, DEPOTS[selectedDepot]);
    setRouteStops(optimized);
    setIsRouteOptimized(true);
  };

  const handleClearRoute = () => {
    setRouteStops([]);
    setIsRouteOptimized(false);
  };

  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const updated = [...routeStops];
    const [moved] = updated.splice(dragIndex, 1);
    updated.splice(index, 0, moved);
    // Recalculate sequences and estimated times
    const depot = DEPOTS[selectedDepot];
    let elapsed = 0;
    let prev = { lat: depot.lat, lng: depot.lng };
    const recalculated = updated.map((stop, i) => {
      const dist = haversineDistance(prev, stop.location);
      elapsed += Math.round((dist / 60) * 60) + 15;
      prev = stop.location;
      return { ...stop, sequence: i + 1, estimatedMinutes: elapsed };
    });
    setRouteStops(recalculated);
    setDragIndex(index);
  };
  const handleDragEnd = () => setDragIndex(null);

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          let importedCount = 0;
          for (const row of results.data as Record<string, string>[]) {
            const firstName = row['First Name'] || '';
            const lastName = row['Last Name'] || '';
            const name = `${firstName} ${lastName}`.trim();
            const company = row['Default Address Company'] || name || 'Unknown Company';
            const email = row['Email'] || '';
            const phone = row['Phone'] || row['Default Address Phone'] || '';
            const notes = row['Note'] || '';
            if (name) {
              try {
                await addDoc(collection(db, 'leads'), {
                  name, company, email, phone, status: 'New', score: 50, notes,
                  assignedTo: user?.uid ?? 'guest', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
                });
                importedCount++;
              } catch (error) {
                handleFirestoreError(error, OperationType.CREATE, 'leads');
              }
            }
          }
          logAuditAction(currentT.csv_lead_import, currentT.csv_lead_imported.replace('{0}', importedCount.toString()));
          alert(currentT.csv_import_success.replace('{0}', importedCount.toString()));
        } catch (error) {
          console.error("Error importing CSV:", error);
          alert(currentT.csv_import_failed);
        }
      }
    });
  };

  const handleDeleteShipment = async (shipmentId: string) => {
    try {
      await deleteDoc(doc(db, 'shipments', shipmentId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `shipments/${shipmentId}`);
    }
  };

  const handleAddShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      if (editingShipmentId) {
        // Update existing shipment
        await updateDoc(doc(db, 'shipments', editingShipmentId), {
          ...newShipment,
          updatedAt: serverTimestamp()
        });
      } else {
        // Create new shipment
        await addDoc(collection(db, 'shipments'), {
          ...newShipment,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      setNewShipment({ status: 'Pending' });
      setShipmentCustomerSearch('');
      setEditingShipmentId(null);
      setIsAddingShipment(false);
    } catch (error) {
      handleFirestoreError(error, editingShipmentId ? OperationType.UPDATE : OperationType.CREATE, 'shipments');
    }
  };

  const handleEditShipment = (shipment: Shipment) => {
    setEditingShipmentId(shipment.id);
    setNewShipment({ ...shipment });
    setShipmentCustomerSearch(shipment.customerName || '');
    setIsAddingShipment(true);
  };

  const handleAddLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsScoring(true);
    try {
      const scoreResult = await scoreLead(newLead);
      await addDoc(collection(db, 'leads'), {
        ...newLead, status: 'New', score: scoreResult.score,
        notes: `${newLead.notes}\n\nAI Insights: ${scoreResult.reasoning}`,
        assignedTo: user?.uid ?? 'guest', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      setNewLead({ name: '', company: '', email: '', phone: '', notes: '' });
      setIsAddingLead(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'leads');
    } finally {
      setIsScoring(false);
    }
  };

  const handleUpdateLeadStatus = async (leadId: string, status: Lead['status']) => {
    try {
      await updateDoc(doc(db, 'leads', leadId), { status, updatedAt: serverTimestamp() });
      if (selectedLead && selectedLead.id === leadId) setSelectedLead({ ...selectedLead, status });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leads/${leadId}`);
    }
  };

  const handleUploadVoiceNote = async (file: File) => {
    if (!selectedLead) return;
    try {
      const storageRef = ref(storage, `leads/${selectedLead.id}/voiceNotes/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      const newNote: VoiceNote = { id: Date.now().toString(), url, createdAt: serverTimestamp() };
      const updatedNotes = [...(selectedLead.voiceNotes || []), newNote];
      await updateDoc(doc(db, 'leads', selectedLead.id), { voiceNotes: updatedNotes });
      setSelectedLead({ ...selectedLead, voiceNotes: updatedNotes });
    } catch (error) {
      console.error("Error uploading voice note:", error);
    }
  };

  const handleUpdateFollowUpDate = async (date: string) => {
    if (!selectedLead) return;
    try {
      const nextFollowUpDate = Timestamp.fromDate(new Date(date));
      await updateDoc(doc(db, 'leads', selectedLead.id), { nextFollowUpDate });
      setSelectedLead({ ...selectedLead, nextFollowUpDate });
    } catch (error) {
      console.error("Error updating follow-up date:", error);
    }
  };

  const handleAddLineItem = (item: InventoryItem) => {
    // Automatically set KDV (vatRate) from product if not already set or if explicitly requested
    const vatRate = (item.vatRate as number | undefined) || 20;
    setNewOrder(prev => ({ ...prev, kdvOran: vatRate as number, faturali: true }));

    const existing = orderLineItems.findIndex(l => l.inventoryId === item.id);
    if (existing >= 0) {
      const updated = [...orderLineItems];
      updated[existing].quantity += 1;
      setOrderLineItems(updated);
    } else {
      setOrderLineItems([...orderLineItems, {
        id: crypto.randomUUID(),
        inventoryId: item.id,
        name: item.name,
        title: item.name,
        sku: item.sku,
        price: item.price || (typeof item.prices === 'object' && item.prices ? (item.prices as Record<string, number>).Retail || 0 : 0),
        quantity: 1,
        vatRate: vatRate as number
      }]);
    }
    setShowProductPicker(false);
    setProductSearch('');
  };

  const handleUpdateLineItemQty = (idx: number, qty: number) => {
    if (qty < 1) {
      setOrderLineItems(orderLineItems.filter((_, i) => i !== idx));
      return;
    }
    const updated = [...orderLineItems];
    updated[idx].quantity = qty;
    setOrderLineItems(updated);
  };

  const handleUpdateLineItemPrice = (idx: number, price: number) => {
    const updated = [...orderLineItems];
    updated[idx].price = price;
    setOrderLineItems(updated);
  };

  const computedTotal = orderLineItems.reduce((sum, l) => sum + l.price * l.quantity, 0);

  // ── Generic sort helper ──────────────────────────────────────────────────
  const sortData = <T,>(arr: T[], key: string, dir: 'asc' | 'desc'): T[] => {
    return [...arr].sort((a: T, b: T) => {
      let av = (a as Record<string, unknown>)[key]; let bv = (b as Record<string, unknown>)[key];
      // Handle Firestore Timestamps
      if (av && typeof (av as Record<string, unknown>).toDate === 'function') av = (av as { toDate: () => Date }).toDate().getTime();
      if (bv && typeof (bv as Record<string, unknown>).toDate === 'function') bv = (bv as { toDate: () => Date }).toDate().getTime();
      // Handle strings case-insensitively
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av === undefined || av === null) av = '';
      if (bv === undefined || bv === null) bv = '';
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  };
  const toggleSort = (
    current: { key: string; dir: 'asc' | 'desc' },
    key: string,
    setter: (v: { key: string; dir: 'asc' | 'desc' }) => void
  ) => setter({ key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' });

  const handleAddOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const customerName = selectedLead ? selectedLead.name : newOrder.customerName || 'Unknown Customer';
    const email = selectedLead ? selectedLead.email : undefined;

    setIsPushingToShopify(true);
    // Pre-generate the Firestore doc ref so its ID can be reused as a stable order reference
    const orderDocRef = doc(collection(db, 'orders'));
    let shopifyOrderId = `SHP-${orderDocRef.id.slice(0, 8).toUpperCase()}`;

    try {
      // Push to Shopify as draft order if we have line items
      if (orderLineItems.length > 0) {
        try {
          const draft = await createShopifyDraftOrder({
            customerName,
            email,
            shippingAddress: newOrder.shippingAddress,
            lineItems: orderLineItems.map(l => ({
              id: l.id,
              name: l.title,
              title: l.title,
              price: l.price,
              quantity: l.quantity,
              sku: l.sku,
              variantId: l.variantId,
            })),
            note: newOrder.notes,
          } as unknown as Order);
          shopifyOrderId = draft.shopifyDraftOrderId || shopifyOrderId;
        } catch (shopifyErr) {
          console.warn('Shopify draft order failed, saving locally only:', shopifyErr instanceof Error ? shopifyErr.message : String(shopifyErr));
        }
      }

      const finalTotal = orderLineItems.length > 0 ? computedTotal : (newOrder.totalPrice || 0);
      const kdvOran = newOrder.faturali ? (newOrder.kdvOran ?? 20) : 0;
      const kdvHaricTutar = newOrder.faturali ? finalTotal / (1 + kdvOran / 100) : finalTotal;
      const kdvTutari = newOrder.faturali ? finalTotal - kdvHaricTutar : 0;

      try {
        // Use setDoc with the pre-generated ref so the doc ID is deterministic
        // trackingNumber is derived from the Firestore doc ID — no random needed
        await setDoc(orderDocRef, {
          ...newOrder,
          shopifyOrderId,
          customerName,
          leadId: selectedLead ? selectedLead.id : null,
          totalPrice: finalTotal,
          lineItems: orderLineItems,
          faturali: newOrder.faturali ?? false,
          faturaTipi: (newOrder as Order & {faturaTipi?: string}).faturaTipi || (newOrder.faturali ? 'e-fatura' : null),
          kdvOran,
          kdvHaricTutar,
          kdvTutari,
          trackingNumber: `TRK-${orderDocRef.id.slice(0, 12).toUpperCase()}`,
          location: null,
          assignedTo: user?.uid ?? null,
          createdAt: serverTimestamp(),
          syncedAt: serverTimestamp()
        });
        
        await createNotification(
          currentLanguage === 'tr' ? 'Yeni Sipariş' : 'New Order',
          currentLanguage === 'tr' ? `${customerName} için yeni sipariş oluşturuldu.` : `New order created for ${customerName}.`,
          'success'
        );

        // Faturalı satışlarda otomatik yevmiye kaydı oluştur
        if (newOrder.faturali) {
          try {
            await addDoc(collection(db, 'journalEntries'), {
              date: new Date().toISOString().split('T')[0],
              fiş: `SIP-${shopifyOrderId}`,
              aciklama: `${customerName} - Faturalı Satış`,
              debitHesap: '120 - Alıcılar',
              alacakHesap: '600 - Yurt İçi Satışlar',
              borc: kdvHaricTutar,
              alacak: kdvHaricTutar,
              kdvOran,
              kategori: 'Satış',
              createdAt: serverTimestamp(),
            });
            if (kdvOran > 0) {
              await addDoc(collection(db, 'journalEntries'), {
                date: new Date().toISOString().split('T')[0],
                fiş: `SIP-${shopifyOrderId}-KDV`,
                aciklama: `${customerName} - KDV %${kdvOran}`,
                debitHesap: '120 - Alıcılar',
                alacakHesap: '391 - Hesaplanan KDV',
                borc: kdvTutari,
                alacak: kdvTutari,
                kdvOran,
                kategori: 'Satış',
                createdAt: serverTimestamp(),
              });
            }
          } catch (journalErr) {
            console.warn('Yevmiye kaydı oluşturulamadı:', journalErr);
          }
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'orders');
      }

      setIsAddingOrder(false);
      setNewOrder({ totalPrice: 0, status: 'Pending', shippingAddress: '', customerName: '' });
      setOrderLineItems([]);
    } catch (error) {
      console.error("Error adding order:", error);
    } finally {
      setIsPushingToShopify(false);
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, status: Order['status']) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), { status });
      logAuditAction(currentT.order_status_update, `${currentT.order} #${orderId} ${currentT.order_status_updated_to.replace('{0}', currentT[status.toLowerCase()] || status)}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  const handleEditLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    try {
      await updateDoc(doc(db, 'leads', selectedLead.id), { ...editingLeadData, updatedAt: serverTimestamp() });
      setSelectedLead({ ...selectedLead, ...editingLeadData } as Lead);
      setIsEditingLead(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leads/${selectedLead.id}`);
    }
  };

  const handleEditOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;
    try {
      await updateDoc(doc(db, 'orders', selectedOrder.id), { ...editingOrderData, updatedAt: serverTimestamp() });
      setSelectedOrder({ ...selectedOrder, ...editingOrderData } as Order);
      setIsEditingOrder(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${selectedOrder.id}`);
    }
  };

  const handleDeleteLead = async (leadId: string) => {
    try {
      const targetLead = leads.find(l => l.id === leadId);
      await deleteDoc(doc(db, 'leads', leadId));
      if (selectedLead?.id === leadId) setSelectedLead(null);
      logAuditAction(currentT.lead_deletion, `${targetLead?.name || leadId} ${currentT.lead_deleted}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `leads/${leadId}`);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      logAuditAction(currentT.order_deletion, `${currentT.order} #${orderId} ${currentT.order_deleted}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `orders/${orderId}`);
    }
  };

  const handleAddActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    try {
      const activity: LeadActivity = {
        id: crypto.randomUUID(),
        type: newActivity.type as 'Call' | 'Email' | 'Meeting' | 'Note' | 'Visit',
        description: newActivity.description || '',
        date: Timestamp.now()
      };
      const updatedActivities = [...(selectedLead.activities || []), activity];
      await updateDoc(doc(db, 'leads', selectedLead.id), { activities: updatedActivities, updatedAt: serverTimestamp() });
      setSelectedLead({ ...selectedLead, activities: updatedActivities });
      setIsAddingActivity(false);
      setNewActivity({ type: 'Note', description: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leads/${selectedLead.id}`);
    }
  };

  // --- Render ---
  if (!isAuthReady) return (
    <div className={cn("h-screen flex items-center justify-center transition-colors duration-500", darkMode ? "bg-[#0a0a0a]" : "bg-[#F5F5F7]")}>
      <Clock className="animate-spin text-brand" />
    </div>
  );

  // --- Entrance Logic: Landing vs Login vs App ---
  if (!enteredApp && !isGuestMode) {
    if (!showLoginPage || user) {
      const handleDemoSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!demoForm.name || !demoForm.email) return;
        setDemoSubmitting(true);
        try {
          await addDoc(collection(db, 'demoRequests'), {
            ...demoForm,
            createdAt: serverTimestamp(),
            status: 'new',
            source: 'landing',
          });
          setDemoSubmitted(true);
        } catch {
          // silently ignore
        } finally {
          setDemoSubmitting(false);
        }
      };

      return (
        <>
          <LandingPage
            currentLanguage={currentLanguage}
            onLoginClick={() => setShowLoginPage(true)}
            onTryClick={() => {
              if (user) setEnteredApp(true);
              else setShowDemoForm(true);
            }}
            onDashboardClick={() => setEnteredApp(true)}
            heroImageUrl="/erp_hero.png"
            isLoggedIn={!!user}
            onLanguageToggle={() => setCurrentLanguage(currentLanguage === 'tr' ? 'en' : 'tr')}
            darkMode={darkMode}
            onDarkModeToggle={() => setDarkMode(!darkMode)}
          />

          {/* Demo Request Modal */}
          <AnimatePresence>
            {showDemoForm && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
                  onClick={() => { setShowDemoForm(false); setDemoSubmitted(false); setDemoForm({ name: '', company: '', email: '', phone: '', message: '' }); }}
                />
                <motion.div
                  initial={{ opacity: 0, y: 40, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 20, scale: 0.97 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className="fixed inset-0 z-[201] flex items-center justify-center p-4 pointer-events-none"
                >
                  <div className={cn("w-full max-w-lg rounded-[2.5rem] overflow-hidden pointer-events-auto shadow-2xl", darkMode ? "bg-[#1c1c1e] border border-white/10" : "bg-white border border-black/5")}>
                    {!demoSubmitted ? (
                      <>
                        {/* Header */}
                        <div className={cn("px-10 pt-10 pb-6 border-b", darkMode ? "border-white/10" : "border-black/5")}>
                          <div className="flex items-center justify-between mb-1">
                            <h2 className={cn("text-2xl font-black tracking-tight", darkMode ? "text-white" : "text-[#1D1D1F]")}>
                              {currentLanguage === 'tr' ? 'Demo Talebi' : 'Request a Demo'}
                            </h2>
                            <button
                              onClick={() => { setShowDemoForm(false); setDemoForm({ name: '', company: '', email: '', phone: '', message: '' }); }}
                              className={cn("p-2 rounded-xl transition-all", darkMode ? "text-white/40 hover:text-white hover:bg-white/10" : "text-gray-400 hover:text-gray-900 hover:bg-black/5")}
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </div>
                          <p className={cn("text-sm", darkMode ? "text-white/40" : "text-black/40")}>
                            {currentLanguage === 'tr' ? 'Bilgilerinizi bırakın, ekibimiz 24 saat içinde ulaşsın.' : 'Leave your details and our team will reach out within 24 hours.'}
                          </p>
                        </div>

                        {/* Form */}
                        <form onSubmit={handleDemoSubmit} className="px-10 py-8 space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label className={cn("text-[10px] font-black uppercase tracking-widest ml-1", darkMode ? "text-white/30" : "text-gray-400")}>
                                {currentLanguage === 'tr' ? 'Ad Soyad *' : 'Full Name *'}
                              </label>
                              <input
                                type="text"
                                required
                                value={demoForm.name}
                                onChange={e => setDemoForm(p => ({ ...p, name: e.target.value }))}
                                placeholder={currentLanguage === 'tr' ? 'Adınız' : 'Your name'}
                                className={cn("w-full rounded-2xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-medium", darkMode ? "bg-white/5 border border-white/10 text-white placeholder-white/20" : "bg-gray-50 border border-gray-200 text-[#1D1D1F] placeholder-gray-400")}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[10px] font-black uppercase tracking-widest ml-1", darkMode ? "text-white/30" : "text-gray-400")}>
                                {currentLanguage === 'tr' ? 'Şirket' : 'Company'}
                              </label>
                              <input
                                type="text"
                                value={demoForm.company}
                                onChange={e => setDemoForm(p => ({ ...p, company: e.target.value }))}
                                placeholder={currentLanguage === 'tr' ? 'Şirket adı' : 'Company name'}
                                className={cn("w-full rounded-2xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-medium", darkMode ? "bg-white/5 border border-white/10 text-white placeholder-white/20" : "bg-gray-50 border border-gray-200 text-[#1D1D1F] placeholder-gray-400")}
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label className={cn("text-[10px] font-black uppercase tracking-widest ml-1", darkMode ? "text-white/30" : "text-gray-400")}>
                                {currentLanguage === 'tr' ? 'E-posta *' : 'Email *'}
                              </label>
                              <input
                                type="email"
                                required
                                value={demoForm.email}
                                onChange={e => setDemoForm(p => ({ ...p, email: e.target.value }))}
                                placeholder="ornek@sirket.com"
                                className={cn("w-full rounded-2xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-medium", darkMode ? "bg-white/5 border border-white/10 text-white placeholder-white/20" : "bg-gray-50 border border-gray-200 text-[#1D1D1F] placeholder-gray-400")}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[10px] font-black uppercase tracking-widest ml-1", darkMode ? "text-white/30" : "text-gray-400")}>
                                {currentLanguage === 'tr' ? 'Telefon' : 'Phone'}
                              </label>
                              <input
                                type="tel"
                                value={demoForm.phone}
                                onChange={e => setDemoForm(p => ({ ...p, phone: e.target.value }))}
                                placeholder="+90 5xx xxx xx xx"
                                className={cn("w-full rounded-2xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-medium", darkMode ? "bg-white/5 border border-white/10 text-white placeholder-white/20" : "bg-gray-50 border border-gray-200 text-[#1D1D1F] placeholder-gray-400")}
                              />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className={cn("text-[10px] font-black uppercase tracking-widest ml-1", darkMode ? "text-white/30" : "text-gray-400")}>
                              {currentLanguage === 'tr' ? 'Mesajınız' : 'Message'}
                            </label>
                            <textarea
                              rows={3}
                              value={demoForm.message}
                              onChange={e => setDemoForm(p => ({ ...p, message: e.target.value }))}
                              placeholder={currentLanguage === 'tr' ? 'Hangi modüllere ihtiyaç duyduğunuzu kısaca belirtin...' : 'Briefly describe which modules you need...'}
                              className={cn("w-full rounded-2xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-medium resize-none", darkMode ? "bg-white/5 border border-white/10 text-white placeholder-white/20" : "bg-gray-50 border border-gray-200 text-[#1D1D1F] placeholder-gray-400")}
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={demoSubmitting}
                            className="w-full bg-brand hover:bg-brand-hover text-white font-black py-4 rounded-2xl transition-all disabled:opacity-60 active:scale-[0.98] shadow-lg shadow-brand/20 text-sm mt-2"
                          >
                            {demoSubmitting
                              ? (currentLanguage === 'tr' ? 'GÖNDERİLİYOR...' : 'SENDING...')
                              : (currentLanguage === 'tr' ? 'DEMO TALEBİ GÖNDER' : 'SEND DEMO REQUEST')}
                          </button>
                        </form>
                      </>
                    ) : (
                      /* Success state */
                      <div className="px-10 py-16 text-center">
                        <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                          <CheckCircle2 className="w-8 h-8 text-green-500" />
                        </div>
                        <h2 className={cn("text-2xl font-black mb-3", darkMode ? "text-white" : "text-[#1D1D1F]")}>
                          {currentLanguage === 'tr' ? 'Talebiniz Alındı!' : 'Request Received!'}
                        </h2>
                        <p className={cn("text-sm mb-8", darkMode ? "text-white/40" : "text-black/40")}>
                          {currentLanguage === 'tr' ? 'Ekibimiz en kısa sürede sizinle iletişime geçecek.' : 'Our team will contact you as soon as possible.'}
                        </p>
                        <button
                          onClick={() => { setShowDemoForm(false); setDemoSubmitted(false); setDemoForm({ name: '', company: '', email: '', phone: '', message: '' }); }}
                          className={cn("px-8 py-3 rounded-2xl font-bold text-sm transition-all", darkMode ? "bg-white/10 text-white hover:bg-white/20" : "bg-black/5 text-[#1D1D1F] hover:bg-black/10")}
                        >
                          {currentLanguage === 'tr' ? 'Kapat' : 'Close'}
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </>
      );
    }
  }

  // Handle Login Page Exit
  const exitLoginToHome = () => {
    setShowLoginPage(false);
    setEnteredApp(false);
  };

  if (!user && !isGuestMode) {
    return (
      <div className={cn("min-h-screen relative flex items-center justify-center overflow-hidden font-avenir transition-colors duration-500", darkMode ? "bg-[#0a0a0a]" : "bg-white")}>
        {/* Animated blurred blob background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {/* Primary brand-red orb — top-left */}
          <div
            className={cn("absolute -top-48 -left-48 w-[750px] h-[750px] rounded-full blur-[160px] animate-pulse", darkMode ? "bg-brand/35" : "bg-brand/20")}
            style={{ animationDuration: '3s' }}
          />
          {/* Secondary dark orb — bottom-right */}
          <div
            className={cn("absolute -bottom-48 -right-32 w-[650px] h-[650px] rounded-full blur-[140px] animate-pulse", darkMode ? "bg-black" : "bg-black/8")}
            style={{ animationDuration: '4s', animationDelay: '1s' }}
          />
          {/* Accent red orb — center-right */}
          <div
            className={cn("absolute top-1/2 -translate-y-1/2 -right-32 w-[400px] h-[400px] rounded-full blur-[120px] animate-pulse", darkMode ? "bg-brand/15" : "bg-brand/10")}
            style={{ animationDuration: '5s', animationDelay: '0.5s' }}
          />
          {/* Subtle grain overlay for texture */}
          <div className={cn("absolute inset-0 opacity-[0.03]", darkMode ? "bg-white" : "bg-black")} style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")', backgroundSize: '128px' }} />
        </div>

        {/* Back to Home */}
        <button
          onClick={() => setShowLoginPage(false)}
          className={cn("absolute top-6 left-6 flex items-center gap-2 transition-all z-20 text-xs font-bold px-4 py-2 rounded-full border backdrop-blur-xl shadow-sm", darkMode ? "bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10" : "bg-white/60 border-black/5 text-gray-500 hover:text-gray-900 hover:bg-white")}
        >
          <X className="w-4 h-4" />
          {currentLanguage === 'tr' ? 'Anasayfaya Dön' : 'Back to Home'}
        </button>

        {/* Toggles */}
        <div className="absolute top-6 right-6 flex items-center gap-2 z-20">
          <button
            onClick={() => setCurrentLanguage(currentLanguage === 'tr' ? 'en' : 'tr')}
            className={cn("flex items-center gap-1.5 px-3 py-2 rounded-xl backdrop-blur-xl border text-xs font-bold transition-all shadow-sm outline-none", darkMode ? "bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10" : "bg-white/70 border-black/8 text-gray-600 hover:text-gray-900 hover:bg-white")}
          >
            <Globe className="w-3.5 h-3.5" />
            {currentLanguage === 'tr' ? 'EN' : 'TR'}
          </button>
          <button
            onClick={() => setDarkMode(!darkMode)}
            title={darkMode ? (currentLanguage === 'tr' ? 'Açık Mod' : 'Light Mode') : (currentLanguage === 'tr' ? 'Karanlık Mod' : 'Dark Mode')}
            className={cn("flex items-center justify-center w-[38px] h-[38px] rounded-xl backdrop-blur-xl border transition-all shadow-sm outline-none", darkMode ? "bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10" : "bg-white/70 border-black/8 text-gray-500 hover:text-gray-900 hover:bg-white")}
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {/* Glass card */}
        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 w-full max-w-md mx-4"
        >
          <div className={cn("backdrop-blur-3xl rounded-[2.5rem] overflow-hidden transition-colors duration-500", darkMode ? "bg-[#1c1c1e]/90 border border-white/10 shadow-[0_40px_80px_rgba(0,0,0,0.6)]" : "bg-white/80 border border-white shadow-[0_40px_80px_rgba(0,0,0,0.08)]")}>
            {/* Brand strip */}
            <div className="px-10 pt-12 pb-8 text-center">
              <div className="flex justify-center mb-6">
                <img src="/cetpalogo.avif" alt="CETPA" className="h-14 w-auto object-contain drop-shadow-sm" />
              </div>
              <h1 className={cn("text-3xl font-black tracking-tight mb-2", darkMode ? "text-[#f5f5f7]" : "text-[#1D1D1F]")}>
                {currentLanguage === 'tr' ? 'Hoş Geldiniz' : 'Welcome Back'}
              </h1>
              <p className={cn("text-base font-medium", darkMode ? "text-white/50" : "text-gray-500")}>
                {currentLanguage === 'tr' ? 'Satış & Lojistik Yazılımı' : 'Sales & Logistics Software'}
              </p>
            </div>

            <div className="px-10 pb-10 space-y-5">
              {/* Email / Password form */}
              <form onSubmit={handleEmailSignIn} className="space-y-4">
                <div className="space-y-1.5">
                  <label className={cn("text-[11px] font-black uppercase tracking-widest ml-1", darkMode ? "text-white/30" : "text-gray-400")}>
                    {currentLanguage === 'tr' ? 'E-POSTA ADRESİ' : 'EMAIL ADDRESS'}
                  </label>
                  <input
                    type="email"
                    value={emailLogin.email}
                    onChange={(e) => setEmailLogin(prev => ({ ...prev, email: e.target.value }))}
                    placeholder={currentLanguage === 'tr' ? 'örnek@cetpa.com' : 'example@cetpa.com'}
                    className={cn("w-full rounded-2xl px-5 py-4 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-medium", darkMode ? "bg-white/5 border border-white/10 text-[#f5f5f7] placeholder-white/20" : "bg-gray-50/50 border border-gray-200 text-[#1D1D1F] placeholder-gray-400 shadow-inner")}
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={cn("text-[11px] font-black uppercase tracking-widest ml-1", darkMode ? "text-white/30" : "text-gray-400")}>
                    {currentLanguage === 'tr' ? 'GÜVENLİ ŞİFRE' : 'SECURE PASSWORD'}
                  </label>
                  <input
                    type="password"
                    value={emailLogin.password}
                    onChange={(e) => setEmailLogin(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="••••••••"
                    className={cn("w-full rounded-2xl px-5 py-4 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-medium", darkMode ? "bg-white/5 border border-white/10 text-[#f5f5f7] placeholder-white/20" : "bg-gray-50/50 border border-gray-200 text-[#1D1D1F] placeholder-gray-400 shadow-inner")}
                    autoComplete="current-password"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isEmailLoginLoading}
                  className="w-full font-black py-4 px-6 rounded-2xl transition-all disabled:opacity-60 mt-2 text-sm active:scale-[0.98] bg-[#1D1D1F] hover:bg-black text-white shadow-xl shadow-black/20 outline-none"
                >
                  {isEmailLoginLoading
                    ? (currentLanguage === 'tr' ? 'GİRİŞ YAPILIYOR...' : 'SIGNING IN...')
                    : (currentLanguage === 'tr' ? 'HESABA GİRİŞ YAP' : 'SIGN IN TO ACCOUNT')}
                </button>
              </form>

              {/* Divider */}
              <div className="relative flex items-center gap-4 py-2">
                <div className={cn("flex-1 h-px", darkMode ? "bg-white/10" : "bg-gray-100")} />
                <span className={cn("text-[12px] font-bold uppercase tracking-widest", darkMode ? "text-white/20" : "text-gray-300")}>
                  {currentLanguage === 'tr' ? 'veya' : 'OR'}
                </span>
                <div className={cn("flex-1 h-px", darkMode ? "bg-white/10" : "bg-gray-100")} />
              </div>

              {/* Google */}
              <button
                onClick={handleLogin}
                className={cn("w-full flex items-center justify-center gap-3 font-bold py-4 px-6 rounded-2xl transition-all shadow-sm group active:scale-[0.98]", darkMode ? "bg-white/5 hover:bg-white/10 border border-white/10 text-[#f5f5f7]" : "bg-white hover:bg-gray-50 border border-gray-200 text-[#1D1D1F]")}
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0 transition-transform group-hover:scale-110" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {currentT.sign_in_google || 'Google ile Devam Et'}
              </button>

              {/* Guest */}
              <button
                onClick={handleGuestContinue}
                className="w-full text-brand hover:text-brand/80 text-sm font-black transition-all hover:underline underline-offset-4"
              >
                {currentLanguage === 'tr' ? 'Misafir Olarak Devam Et →' : 'Continue as Guest →'}
              </button>

              {authError && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 text-center"
                >
                  {authError}
                </motion.p>
              )}
            </div>
          </div>

          <p className={cn("text-center text-xs mt-6", darkMode ? "text-white/20" : "text-gray-400")}>
            © 2026 CETPA · {currentT.authorized_only || 'Authorized Personnel Only'}
          </p>
        </motion.div>
      </div>
    );
  }

  // ─── Onboarding Gate: Show onboarding for new users ───────────────────
  if (user && subscriptionLoaded && !userSubscription && !isGuestMode && !showPricingPage) {
    return (
      <OnboardingFlow
        currentLanguage={currentLanguage}
        onComplete={handleOnboardingComplete}
      />
    );
  }

  // ─── Pricing Page (full screen) ───────────────────────────────────────
  if (showPricingPage) {
    return (
      <PricingPage
        currentLanguage={currentLanguage}
        onSelectPlan={handleSelectPlan}
        onStartTrial={handleStartTrial}
        showBackButton={true}
        onBack={() => {
          if (userSubscription) setShowPricingPage(false);
          else {
            setShowPricingPage(false);
            setEnteredApp(false);
            if (!userSubscription) setShowOnboarding(true);
          }
        }}
      />
    );
  }

  return (
    <div className="min-h-screen font-avenir overflow-x-hidden" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-3xl border-b shadow-sm" style={{ background: 'var(--nav-bg)', borderColor: 'var(--nav-border)' }}>
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center gap-2">
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
            {/* Always-visible hamburger */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className={cn("p-2 transition-colors flex-shrink-0 rounded-xl", darkMode ? "text-white/70 hover:text-white hover:bg-white/10" : "text-gray-600 hover:text-gray-900 hover:bg-black/[0.06]")}
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            {/* Logo */}
            <button onClick={() => setActiveTab('dashboard')} className="flex items-center gap-2 hover:opacity-80 transition-opacity flex-shrink-0">
              <div className="relative group">
                <img src="/cetpalogo.avif" alt="CETPA" className="h-8 w-auto object-contain" />
                {userRole === 'Admin' && (
                  <label className="absolute -bottom-1 -right-1 bg-white/20 backdrop-blur-sm rounded-full p-1 shadow-md cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity z-10" onClick={e => e.stopPropagation()}>
                    <Upload className="w-3 h-3 text-white" />
                    <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/avif,image/webp" className="hidden" onChange={handleLogoUpload} />
                  </label>
                )}
              </div>
            </button>

            {/* Active tab label */}
            <span className={cn("font-semibold text-sm truncate hidden sm:block", darkMode ? "text-white/90" : "text-gray-900")}>
              {([
                { id: 'dashboard', label: currentT.dashboard },
                { id: 'crm', label: currentLanguage === 'tr' ? 'CRM & Satış' : 'CRM & Sales' },
                { id: 'inventory', label: currentT.inventory },
                { id: 'lojistik', label: currentLanguage === 'tr' ? 'Lojistik & Depo' : 'Logistics' },
                { id: 'muhasebe', label: currentLanguage === 'tr' ? 'Muhasebe' : 'Accounting' },
                { id: 'satin-alma', label: currentLanguage === 'tr' ? 'Satın Alma' : 'Purchasing' },
                { id: 'ik', label: currentLanguage === 'tr' ? 'İK' : 'HR' },
                { id: 'hukuk', label: currentLanguage === 'tr' ? 'Hukuk' : 'Legal' },
                { id: 'proje', label: currentLanguage === 'tr' ? 'Projeler' : 'Projects' },
                { id: 'production', label: currentLanguage === 'tr' ? 'Üretim' : 'Production' },
                { id: 'kalite', label: currentLanguage === 'tr' ? 'Kalite' : 'Quality' },
                { id: 'kurumsal', label: currentLanguage === 'tr' ? 'Kurumsal' : 'Governance' },
                { id: 'b2b', label: currentLanguage === 'tr' ? 'B2B Portal' : 'B2B Portal' },
                { id: 'risk', label: currentLanguage === 'tr' ? 'Risk' : 'Risk' },
                { id: 'reports', label: currentT.reports },
                { id: 'integrations', label: currentLanguage === 'tr' ? 'Entegrasyonlar' : 'Integrations' },
                { id: 'admin', label: currentT.admin },
                { id: 'settings', label: currentLanguage === 'tr' ? 'Ayarlar' : 'Settings' },
                { id: 'finance', label: currentLanguage === 'tr' ? 'Finans' : 'Finance' },
              ].find(t => t.id === activeTab)?.label || activeTab)}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">

            {/* Language toggle — icon only on mobile, icon+text on sm+ */}
            <button
              onClick={() => setCurrentLanguage(currentLanguage === 'tr' ? 'en' : 'tr')}
              className={cn("flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 rounded-xl border text-xs font-bold transition-all outline-none", darkMode ? "bg-white/10 border-white/15 text-white/70 hover:text-white hover:bg-white/20" : "bg-black/[0.05] border-black/10 text-gray-600 hover:text-gray-900 hover:bg-black/[0.09]")}
            >
              <Globe className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden sm:inline">{currentLanguage === 'tr' ? 'EN' : 'TR'}</span>
            </button>

            {/* Dark mode toggle */}
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={cn("flex items-center justify-center w-[34px] h-[34px] sm:w-[38px] sm:h-[38px] rounded-xl border transition-all outline-none flex-shrink-0", darkMode ? "bg-white/10 border-white/15 text-white/70 hover:text-white hover:bg-white/20" : "bg-black/[0.05] border-black/10 text-gray-500 hover:text-gray-900 hover:bg-black/[0.09]")}
              title={darkMode ? 'Açık Mod' : 'Karanlık Mod'}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className="relative">
              <button
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className={cn("relative p-2 transition-colors rounded-xl", darkMode ? "text-white/70 hover:text-white hover:bg-white/10" : "text-gray-500 hover:text-gray-900 hover:bg-black/[0.06]")}
              >
                <Bell className="w-5 h-5" />
                {notifications.filter(n => !n.read).length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-brand rounded-full border-2 border-black/80 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-white leading-none px-0.5">
                      {notifications.filter(n => !n.read).length > 9 ? '9+' : notifications.filter(n => !n.read).length}
                    </span>
                  </span>
                )}
              </button>

              <AnimatePresence>
                {isNotificationsOpen && (
                  <>
                    <div className="fixed inset-0 z-[99]" onClick={() => setIsNotificationsOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-84 apple-card z-[100] shadow-2xl overflow-hidden"
                      style={{ width: 320 }}
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm">{currentT.notifications}</h3>
                          {notifications.filter(n => !n.read).length > 0 && (
                            <span className="bg-brand/10 text-brand text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                              {notifications.filter(n => !n.read).length}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {notifications.some(n => !n.read) && (
                            <button
                              onClick={async () => {
                                for (const n of notifications.filter(x => !x.read)) {
                                  await markNotificationRead(n.id as string);
                                }
                              }}
                              className="text-[10px] text-brand font-semibold hover:underline px-2 py-1"
                            >
                              {currentLanguage === 'tr' ? 'Tümünü okundu işaretle' : 'Mark all read'}
                            </button>
                          )}
                          <button onClick={() => setIsNotificationsOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* List */}
                      <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                        {notifications.map((n: Record<string, unknown>) => {
                          const type = n.type as string || 'info';
                          const typeConfig = {
                            warning: { bg: 'bg-amber-50', dot: 'bg-amber-400', border: 'border-amber-100' },
                            success: { bg: 'bg-green-50', dot: 'bg-green-500', border: 'border-green-100' },
                            info:    { bg: 'bg-blue-50',  dot: 'bg-blue-400',  border: 'border-blue-100' },
                          }[type] ?? { bg: 'bg-gray-50', dot: 'bg-gray-300', border: 'border-gray-100' };
                          const createdAt = n.createdAt as { toDate?: () => Date };
                          const dateObj = createdAt?.toDate?.() ?? null;
                          const timeStr = dateObj ? format(dateObj, 'HH:mm') : '';
                          const isToday = dateObj ? dateObj.toDateString() === new Date().toDateString() : true;
                          const dateStr = dateObj && !isToday ? format(dateObj, 'dd.MM') : '';
                          return (
                            <div
                              key={n.id as string}
                              onClick={() => markNotificationRead(n.id as string)}
                              className={cn(
                                "flex gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-gray-50",
                                !n.read && typeConfig.bg
                              )}
                            >
                              <div className="flex-shrink-0 mt-0.5">
                                <div className={cn("w-2 h-2 rounded-full mt-1", n.read ? 'bg-gray-200' : typeConfig.dot)} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={cn("text-xs font-semibold leading-tight", n.read ? 'text-gray-500' : 'text-[#1D1D1F]')}>
                                  {n.title as string}
                                </p>
                                <p className="text-[11px] text-gray-400 mt-0.5 leading-snug line-clamp-2">{n.message as string}</p>
                                <p className="text-[10px] text-gray-300 mt-1">{dateStr || timeStr}</p>
                              </div>
                            </div>
                          );
                        })}
                        {notifications.length === 0 && (
                          <div className="text-center py-10">
                            <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                            <p className="text-xs text-gray-400">{currentLanguage === 'tr' ? 'Bildirim yok' : 'No notifications'}</p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <div className={cn("flex items-center gap-2 pl-2 sm:pl-3 border-l", darkMode ? "border-white/15" : "border-black/10")}>
              <div className="text-right hidden md:block">
                <p className={cn("text-xs font-semibold leading-none", darkMode ? "text-white/90" : "text-gray-900")}>{user?.displayName || 'Misafir'}</p>
                <span className={cn(
                  "text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 inline-block",
                  userRole === 'Admin' ? 'bg-brand/20 text-brand' :
                  userRole === 'Manager' ? 'bg-orange-500/20 text-orange-400' :
                  userRole === 'Accounting' ? 'bg-blue-500/20 text-blue-400' :
                  userRole === 'Sales' ? 'bg-green-500/20 text-green-400' :
                  userRole === 'Logistics' ? 'bg-purple-500/20 text-purple-400' :
                  userRole === 'HR' ? 'bg-pink-500/20 text-pink-400' :
                  userRole === 'Purchasing' ? 'bg-cyan-500/20 text-cyan-400' :
                  'bg-white/10 text-white/50'
                )}>{userRole}</span>
              </div>
              {user?.photoURL ? (
                <img src={user.photoURL} className={cn("w-8 h-8 rounded-full border-2 shadow-sm flex-shrink-0", darkMode ? "border-white/20" : "border-black/10")} alt="User" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-brand">{(user?.displayName || 'M')[0].toUpperCase()}</span>
                </div>
              )}
              <button onClick={handleLogout} className={cn("p-1.5 transition-colors flex-shrink-0 rounded-xl", darkMode ? "text-white/40 hover:text-red-400 hover:bg-white/10" : "text-gray-400 hover:text-red-500 hover:bg-red-50")}>
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-0 backdrop-blur-3xl z-40 flex flex-col pt-14 sm:pt-16"
            style={{ background: darkMode ? 'rgba(10,10,10,0.95)' : 'rgba(245,245,247,0.96)' }}
          >
            {/* Nav grid — fills all available space */}
            <div className="flex-1 min-h-0 px-4 pt-4 pb-2">
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 h-full" style={{ gridAutoRows: 'minmax(0, 1fr)' }}>
                {([
                  { id: 'dashboard', label: currentT.dashboard || 'Dashboard', icon: LayoutDashboard },
                  { id: 'crm', label: currentLanguage === 'tr' ? 'CRM & Satış' : 'CRM & Sales', icon: Users },
                  { id: 'inventory', label: currentT.inventory, icon: List },
                  { id: 'lojistik', label: currentLanguage === 'tr' ? 'Lojistik & Depo' : 'Logistics & Warehouse', icon: Truck },
                  { id: 'muhasebe', label: currentLanguage === 'tr' ? 'Muhasebe & Finans' : 'Accounting & Finance', icon: BookOpen },
                  { id: 'satin-alma', label: currentLanguage === 'tr' ? 'Satın Alma' : 'Purchasing', icon: ShoppingCart },
                  { id: 'ik', label: currentLanguage === 'tr' ? 'İnsan Kaynakları' : 'Human Resources', icon: UserCheck },
                  { id: 'hukuk', label: currentLanguage === 'tr' ? 'Hukuk & Uyum' : 'Legal & Compliance', icon: ShieldCheck },
                  { id: 'proje', label: currentLanguage === 'tr' ? 'Proje Yönetimi' : 'Project Management', icon: TargetIcon },
                  { id: 'production', label: currentLanguage === 'tr' ? 'Üretim Yönetimi' : 'Production Management', icon: Factory },
                  { id: 'kalite', label: currentLanguage === 'tr' ? 'Kalite Yönetimi' : 'Quality Management', icon: Award },
                  { id: 'kurumsal', label: currentLanguage === 'tr' ? 'Kurumsal Yönetim' : 'Corporate Governance', icon: Building2 },
                  { id: 'b2b', label: currentLanguage === 'tr' ? 'B2B Bayi Portalı' : 'B2B Dealer Portal', icon: ShoppingBag },
                  { id: 'risk', label: currentLanguage === 'tr' ? 'Risk & Uyarılar' : 'Risk & Alerts', icon: AlertTriangle },
                  { id: 'reports', label: currentT.reports, icon: BarChart3 },
                  { id: 'integrations', label: currentLanguage === 'tr' ? 'Entegrasyonlar' : 'Integrations', icon: Link },
                  ...(userRole === 'Admin' ? [{ id: 'admin', label: currentT.admin, icon: Shield }] : []),
                  ...(userRole === 'Admin' || userRole === 'Manager' ? [{ id: 'settings', label: currentLanguage === 'tr' ? 'Ayarlar' : 'Settings', icon: Settings }] : [])
                ] as { id: string; label: string; icon: React.ElementType }[]).filter(tab => canAccess(tab.id)).map(tab => {
                  const isActive = activeTab === tab.id;
                  const isLocked = !isGuestMode && userSubscription && !canAccessBySubscription(tab.id);
                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleTabClick(tab.id)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-1 p-2 rounded-xl text-[10px] font-semibold transition-all duration-200 w-full h-full min-h-0 relative",
                        isActive
                          ? "text-brand bg-brand/15 border border-brand/25"
                          : isLocked
                            ? darkMode
                              ? "text-white/25 hover:text-white/40 hover:bg-white/[0.04] border border-transparent"
                              : "text-gray-300 hover:text-gray-400 hover:bg-gray-50 border border-transparent"
                            : darkMode
                              ? "text-white/60 hover:text-white hover:bg-white/[0.08] border border-transparent"
                              : "text-gray-500 hover:text-gray-900 hover:bg-black/[0.06] border border-transparent"
                      )}
                    >
                      <div className="relative">
                        <tab.icon className={cn("w-5 h-5 flex-shrink-0", isActive ? "text-brand" : isLocked ? "opacity-40" : "")} />
                        {isLocked && (
                          <Lock className="w-2.5 h-2.5 absolute -top-1 -right-1 text-amber-500" />
                        )}
                      </div>
                      <span className="text-center leading-tight line-clamp-2">{tab.label}</span>
                      {isLocked && (
                        <span className={cn(
                          "text-[7px] font-bold px-1.5 py-0.5 rounded-full mt-0.5",
                          darkMode ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-600"
                        )}>PRO</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom section: settings + contact */}
            <div className={cn("px-4 pb-4 pt-3", darkMode ? "border-t border-white/[0.10]" : "border-t border-black/[0.08]")}>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setCurrentLanguage(currentLanguage === 'tr' ? 'en' : 'tr'); }}
                  className={cn("flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all",
                    darkMode ? "bg-white/[0.08] border-white/10 text-white/60 hover:text-white hover:bg-white/15"
                              : "bg-black/[0.05] border-black/10 text-gray-500 hover:text-gray-900 hover:bg-black/10")}
                >
                  <Globe className="w-3.5 h-3.5 text-brand" />
                  {currentLanguage === 'tr' ? 'EN' : 'TR'}
                </button>
                <div className={cn("flex-1 flex items-center justify-end gap-3 text-[10px]", darkMode ? "text-white/30" : "text-gray-400")}>
                  <a href="mailto:info@cetpa.com" className={cn("flex items-center gap-1 transition-all", darkMode ? "hover:text-white/60" : "hover:text-gray-700")}>
                    <Mail className="w-3 h-3 text-brand" /> info@cetpa.com
                  </a>
                  <a href="tel:+902121234567" className={cn("flex items-center gap-1 transition-all hidden sm:flex", darkMode ? "hover:text-white/60" : "hover:text-gray-700")}>
                    <Phone className="w-3 h-3 text-brand" /> +90 212 123 45 67
                  </a>
                  <span>© 2026 CETPA</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 overflow-x-hidden">
        <AnimatePresence mode="wait">

          {/* ── Dashboard (Home) ── */}
          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              {/* Welcome */}
              <ModuleHeader
                title={`${dashT.greeting}${user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''} 👋`}
                subtitle={dashT.subtitle}
                icon={LayoutDashboard}
                actionButton={
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <DashboardAnalysis data={{
                      orders: filteredOrders,
                      leads: filteredLeads,
                      inventory: inventory,
                      revenue: filteredOrders.reduce((s, o) => s + (o.totalPrice || o.totalAmount || 0), 0)
                    }} />
                    <DateRangePicker
                      startDate={dateRange.startDate}
                      endDate={dateRange.endDate}
                      onStartDateChange={(d) => setDateRange(prev => ({ ...prev, startDate: d }))}
                      onEndDateChange={(d) => setDateRange(prev => ({ ...prev, endDate: d }))}
                      currentLanguage={currentLanguage}
                    />
                    <div className="hidden lg:block text-sm text-gray-400 whitespace-nowrap">{new Date().toLocaleDateString(currentLanguage === 'en' ? 'en-US' : 'tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
                  </div>
                }
              />

              {/* KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: dashT.total_orders, value: filteredOrders.length, icon: Package, color: 'text-blue-500', bg: 'bg-blue-50', sub: `${filteredOrders.filter(o => o.status === 'Pending').length} ${dashT.pending}`, tab: 'orders' },
                  { label: dashT.active_leads, value: filteredLeads.filter(l => !['Closed Won','Closed Lost'].includes(l.status)).length, icon: Users, color: 'text-brand', bg: 'bg-brand/10', sub: `${filteredLeads.length} ${dashT.total}`, tab: 'crm' },
                  { label: dashT.inventory_label, value: inventory.length, icon: List, color: 'text-purple-500', bg: 'bg-purple-50', sub: `${inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length} ${dashT.low_stock}`, tab: 'inventory' },
                ].map((kpi, i) => (
                  <button key={i} onClick={() => setActiveTab(kpi.tab)}
                    className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.02] transition-all duration-150 cursor-pointer group">
                    <div className={`w-9 h-9 rounded-xl ${kpi.bg} flex items-center justify-center mb-3`}>
                      <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                    </div>
                    <p className="text-2xl font-bold" style={{color:'var(--text-primary)'}}>{kpi.value}</p>
                    <p className="text-xs font-semibold text-gray-500 mt-1">{kpi.label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{kpi.sub}</p>
                    <p className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                      <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Detaya git' : 'View details'}
                    </p>
                  </button>
                ))}
                {/* Revenue KPI with currency toggle */}
                {(() => {
                  const totalTRY = filteredOrders.reduce((s, o) => s + (o.totalPrice || o.totalAmount || 0), 0);
                  const rate = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
                  const converted = kpiCurrency === 'TRY' ? totalTRY : totalTRY / rate;
                  const symbol = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                  return (
                    <div className="apple-card p-4 text-left group">
                      <div className="flex items-center justify-between mb-3">
                        <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
                          <DollarSign className="w-4 h-4 text-green-500" />
                        </div>
                        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                          {(['TRY','USD','EUR'] as const).map(c => (
                            <button key={c} onClick={() => setKpiCurrency(c)}
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency===c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                              {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-2xl font-bold" style={{color:'var(--text-primary)'}}>{symbol}{converted.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                      <p className="text-xs font-semibold text-gray-500 mt-1">{dashT.total_revenue}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{dashT.all_time}</p>
                      <button onClick={() => setActiveTab('reports')} className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Detaya git' : 'View details'}
                      </button>
                    </div>
                  );
                })()}
              </div>

              {/* Quick Actions */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">{dashT.quick_access}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: currentLanguage === 'tr' ? 'Kalite Yönetimi' : 'Quality', tab: 'kalite', icon: Activity, color: '#ff4000' },
                    { label: currentLanguage === 'tr' ? 'Hukuk & Uyum' : 'Legal', tab: 'hukuk', icon: ShieldCheck, color: '#3b82f6' },
                    { label: currentLanguage === 'tr' ? 'Proje Yönetimi' : 'Projects', tab: 'proje', icon: TargetIcon, color: '#8b5cf6' },
                    { label: currentLanguage === 'tr' ? 'Satın Alma' : 'Purchasing', tab: 'satin-alma', icon: ShoppingCart, color: '#10b981' },
                    { label: dashT.new_order, tab: 'orders', icon: Package, color: '#f59e0b' },
                    { label: currentLanguage === 'tr' ? 'Lojistik' : 'Logistics', tab: 'lojistik', icon: Truck, color: '#06b6d4' },
                    { label: currentLanguage === 'en' ? 'Accounting' : 'Muhasebe', tab: 'muhasebe', icon: BookOpen, color: '#ec4899' },
                    { label: dashT.reports, tab: 'reports', icon: BarChart3, color: '#ef4444' },
                  ].map((a, i) => (
                    <button key={i} onClick={() => setActiveTab(a.tab)}
                      className={cn("flex items-center gap-2 p-3 rounded-xl border transition-all text-left", darkMode ? "border-white/10 hover:border-white/20 hover:bg-white/5" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50")}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${a.color}15` }}>
                        <a.icon className="w-4 h-4" style={{ color: a.color }} />
                      </div>
                      <span className={cn("text-xs font-semibold", darkMode ? "text-white/90" : "text-[#1D1D1F]")}>{a.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Recent Orders + Low Stock side by side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">{dashT.recent_orders}</h3>
                    <button onClick={() => { setActiveTab('crm'); setCrmTab('siparisler'); }} className="text-xs text-brand font-semibold hover:underline">{dashT.see_all}</button>
                  </div>
                  <div className="space-y-2">
                    {filteredOrders.slice(0, 5).map(o => (
                      <div key={o.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                        <div>
                          <p className="text-sm font-semibold text-[#1D1D1F]">{o.customerName || currentT.customer}</p>
                          <p className="text-xs text-gray-400">#{o.shopifyOrderId || o.id?.slice(-6)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-[#1D1D1F]">₺{(o.totalPrice || o.totalAmount || 0).toLocaleString('tr-TR')}</p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${o.status === 'Delivered' ? 'bg-green-100 text-green-700' : o.status === 'Cancelled' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{o.status}</span>
                        </div>
                      </div>
                    ))}
                    {filteredOrders.length === 0 && <p className="text-sm text-gray-400 text-center py-4">{dashT.no_orders}</p>}
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">{dashT.low_stock_alert}</h3>
                    <button onClick={() => setActiveTab('inventory')} className="text-xs text-brand font-semibold hover:underline">{dashT.inventory_link}</button>
                  </div>
                  <div className="space-y-2">
                    {inventory.filter(i => i.stockLevel <= i.lowStockThreshold).slice(0, 5).map(item => (
                      <div key={item.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                        <div>
                          <p className="text-sm font-semibold text-[#1D1D1F]">{item.name}</p>
                          <p className="text-xs text-gray-400">{item.sku}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-red-500">{item.stockLevel} {dashT.units}</p>
                          <p className="text-[10px] text-gray-400">Min: {item.lowStockThreshold}</p>
                        </div>
                      </div>
                    ))}
                    {inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length === 0 && (
                      <p className="text-sm text-green-600 text-center py-4 flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4" />{dashT.all_in_stock}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Lead Pipeline Summary */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">{dashT.lead_summary}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(['New','Contacted','Qualified','Proposal','Negotiation','Closed Won'] as const).map(status => {
                    const count = leads.filter(l => l.status === status).length;
                    const colors: Record<string,string> = { New:'bg-gray-100 text-gray-600', Contacted:'bg-blue-100 text-blue-700', Qualified:'bg-purple-100 text-purple-700', Proposal:'bg-yellow-100 text-yellow-700', Negotiation:'bg-orange-100 text-orange-700', 'Closed Won':'bg-green-100 text-green-700' };
                    return (
                      <div key={status} className={`${colors[status]} rounded-xl p-3 text-center`}>
                        <p className="text-2xl font-bold">{count}</p>
                        <p className="text-xs font-semibold mt-1">{dashT.lead_labels[status]}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Reports Dashboard ── */}
          {activeTab === 'reports' && (
            <motion.div key="reports" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              {!canAccess('reports') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Raporlar':'Reports'} /> : (
                <>
                  {!hasFullAccess('reports') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <ReportsDashboard orders={orders} inventory={inventory} exchangeRates={exchangeRates} currentT={currentT} currentLanguage={currentLanguage} userRole={userRole} onNavigate={setActiveTab} employees={employees} />
                </>
              )}
            </motion.div>
          )}

          {/* ── Muhasebe & Finans ── */}
          {activeTab === 'muhasebe' && (
            <motion.div key="muhasebe" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              {!canAccess('muhasebe') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Muhasebe & Finans':'Accounting & Finance'} /> : (
                <>
                  {!hasFullAccess('muhasebe') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <ModuleHeader 
                    title={currentLanguage === 'tr' ? 'Muhasebe & Finans' : 'Accounting & Finance'} 
                    subtitle={currentLanguage === 'tr' ? 'Finansal kayıtları ve raporları yönetin.' : 'Manage financial records and reports.'}
                    icon={Calculator}
                  />
                  <AccountingModule orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('muhasebe')} userRole={userRole} exchangeRates={exchangeRates} createNotification={createNotification} warehouses={warehouses} employees={employees} />
                </>
              )}
            </motion.div>
          )}

          {/* ── Satın Alma ── */}
          {activeTab === 'satin-alma' && (
            <motion.div key="satin-alma" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              {!canAccess('satin-alma') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Satın Alma':'Purchasing'} /> : (
                <>
                  {!hasFullAccess('satin-alma') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <PurchasingModule
                    currentLanguage={currentLanguage}
                    isAuthenticated={!!user && hasFullAccess('satin-alma')}
                    userRole={userRole}
                    inventory={inventory}
                    orders={orders}
                    onNavigate={setActiveTab}
                    exchangeRates={exchangeRates}
                  />
                </>
              )}
            </motion.div>
          )}

          {/* ── İnsan Kaynakları ── */}
          {activeTab === 'ik' && (
            <motion.div key="ik" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('ik') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'İnsan Kaynakları':'Human Resources'} /> : (
                <>
                  {!hasFullAccess('ik') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <ModuleHeader 
                    title={currentLanguage === 'tr' ? 'İnsan Kaynakları' : 'Human Resources'} 
                    subtitle={currentLanguage === 'tr' ? 'Çalışan yönetimi, izin, seyahat, avans ve bordro' : 'Employee management, leave, travel, advance and payroll'}
                    icon={Users}
                  />
                  <HRModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('ik')} userRole={userRole} employees={employees} />
                </>
              )}
            </motion.div>
          )}

          {/* ── Hukuk & Uyum ── */}
          {activeTab === 'hukuk' && (
            <motion.div key="hukuk" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('hukuk') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Hukuk & Uyum':'Legal & Compliance'} /> : (
                <>
                  {!hasFullAccess('hukuk') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <ModuleHeader 
                    title={currentLanguage === 'tr' ? 'Hukuk & Uyum' : 'Legal & Compliance'} 
                    subtitle={currentLanguage === 'tr' ? 'Sözleşmeler, davalar ve KVKK uyum süreçleri' : 'Contracts, cases and GDPR compliance processes'}
                    icon={Scale}
                  />
                  <LegalModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('hukuk')} />
                </>
              )}
            </motion.div>
          )}

          {/* ── Proje Yönetimi ── */}
          {activeTab === 'proje' && (
            <motion.div key="proje" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('proje') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Proje Yönetimi':'Project Management'} /> : (
                <>
                  {!hasFullAccess('proje') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <ProjectModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('proje')} userRole={userRole} />
                </>
              )}
            </motion.div>
          )}

          {activeTab === 'kalite' && (
            <motion.div key="kalite" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('kalite') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Kalite Yönetimi':'Quality Management'} /> : (
                <>
                  {!hasFullAccess('kalite') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <QualityModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('kalite')} />
                </>
              )}
            </motion.div>
          )}

          {activeTab === 'production' && (
            <motion.div key="production" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('production') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Üretim Yönetimi':'Production Management'} /> : (
                <>
                  {!hasFullAccess('production') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <ProductionModule currentLanguage={currentLanguage} isAuthenticated={!!user} />
                </>
              )}
            </motion.div>
          )}

          {/* ── Kurumsal Yönetim ── */}
          {activeTab === 'kurumsal' && (
            <motion.div key="kurumsal" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('kurumsal') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Kurumsal Yönetim':'Corporate Governance'} /> : (
                <>
                  {!hasFullAccess('kurumsal') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <CorporateGovernanceModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('kurumsal')} userRole={userRole} onNavigate={setActiveTab} />
                </>
              )}
            </motion.div>
          )}

          {/* ── Integrations / Entegrasyonlar ── */}
          {activeTab === 'integrations' && (
            <motion.div key="integrations" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6 max-w-3xl">
              {!canAccess('integrations') && <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Entegrasyonlar':'Integrations'} />}
              {canAccess('integrations') && <>
              {!hasFullAccess('integrations') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
              <ModuleHeader 
                title={currentLanguage === 'tr' ? 'Entegrasyonlar' : 'Integrations'} 
                subtitle={currentLanguage === 'tr' ? 'Bağlı sistemler ve dış servis durumları.' : 'Connected systems and external service statuses.'}
                icon={RefreshCw}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Shopify */}
                <div className="apple-card p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                      <ShoppingBag className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-[#1D1D1F]">Shopify</h3>
                      <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'E-ticaret entegrasyonu' : 'E-commerce integration'}</p>
                    </div>
                    <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${companySettings?.shopify_access_token ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                      {companySettings?.shopify_access_token ? (currentLanguage === 'tr' ? 'Bağlı' : 'Connected') : (currentLanguage === 'tr' ? 'Bağlı Değil' : 'Not Connected')}
                    </span>
                  </div>
                  <div className="space-y-2 text-xs text-gray-500">
                    <div className="flex justify-between"><span>Store URL</span><span className="font-mono text-gray-700 truncate max-w-[160px]">{(companySettings?.shopify_store_url as string) || '—'}</span></div>
                    <div className="flex justify-between"><span>Access Token</span><span className="font-mono text-gray-400">{companySettings?.shopify_access_token ? '••••••••' : '—'}</span></div>
                  </div>
                </div>

                {/* TCMB */}
                <div className="apple-card p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                      <Globe className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-[#1D1D1F]">TCMB Döviz</h3>
                      <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Canlı kur bilgisi' : 'Live exchange rates'}</p>
                    </div>
                    <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${exchangeRates ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'}`}>
                      {exchangeRates ? (currentLanguage === 'tr' ? 'Canlı' : 'Live') : (currentLanguage === 'tr' ? 'Bekleniyor' : 'Loading')}
                    </span>
                  </div>
                  <div className="space-y-2 text-xs text-gray-500">
                    <div className="flex justify-between"><span>USD / TRY</span><span className="font-mono font-semibold text-gray-800">{exchangeRates?.USD ? `₺${(exchangeRates.USD).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span></div>
                    <div className="flex justify-between"><span>EUR / TRY</span><span className="font-mono font-semibold text-gray-800">{exchangeRates?.EUR ? `₺${(exchangeRates.EUR).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span></div>
                    <div className="flex justify-between"><span>GBP / TRY</span><span className="font-mono font-semibold text-gray-800">{exchangeRates?.GBP ? `₺${(exchangeRates.GBP).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span></div>
                  </div>
                </div>

                {/* Luca */}
                <div className="apple-card p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
                      <BookOpen className="w-5 h-5 text-purple-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-sm text-[#1D1D1F]">Luca ERP</h3>
                      <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Muhasebe entegrasyonu' : 'Accounting integration'}</p>
                    </div>
                    <button
                      onClick={async () => {
                        const newVal = !lucaSettings.enabled;
                        await updateDoc(doc(db, 'settings', 'luca'), { enabled: newVal });
                        if (newVal) {
                          await updateDoc(doc(db, 'settings', 'mikro'), { enabled: false }).catch(() => {});
                        }
                      }}
                      className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${lucaSettings.enabled ? 'bg-purple-500' : 'bg-gray-200'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white keep-white rounded-full shadow transition-transform ${lucaSettings.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  <div className="space-y-2 text-xs text-gray-500">
                    <div className="flex justify-between"><span>{currentLanguage === 'tr' ? 'Yevmiye senkronizasyonu' : 'Journal sync'}</span><span className="text-gray-700">{currentLanguage === 'tr' ? 'Muhasebe → Luca sekmesi' : 'Accounting → Luca tab'}</span></div>
                    <div className="flex justify-between"><span>API</span><span className="font-mono text-gray-400">https://api.luca.com.tr</span></div>
                  </div>
                </div>

                {/* Mikro */}
                <div className="apple-card p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#e8f0f7' }}>
                      <BookOpen className="w-5 h-5" style={{ color: '#1a3a5c' }} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-sm text-[#1D1D1F]">Mikro ERP</h3>
                      <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'JumpBulut entegrasyonu' : 'JumpBulut integration'}</p>
                    </div>
                    <button
                      onClick={async () => {
                        const newVal = !mikroSettings.enabled;
                        await updateDoc(doc(db, 'settings', 'mikro'), { enabled: newVal });
                        if (newVal) {
                          await updateDoc(doc(db, 'settings', 'luca'), { enabled: false }).catch(() => {});
                        }
                      }}
                      className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${mikroSettings.enabled ? 'bg-[#1a3a5c]' : 'bg-gray-200'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white keep-white rounded-full shadow transition-transform ${mikroSettings.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  <div className="space-y-2 text-xs text-gray-500">
                    <div className="flex justify-between"><span>{currentLanguage === 'tr' ? 'Veri akışı' : 'Data flow'}</span><span className="text-gray-700">Cetpa ↔ Mikro</span></div>
                    <div className="flex justify-between"><span>API</span><span className="font-mono text-gray-400 truncate max-w-[140px]">jumpbulutapigw.mikro.com.tr</span></div>
                  </div>
                </div>

                {/* Firebase */}
                <div className="apple-card p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
                      <Flame className="w-5 h-5 text-orange-500" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-[#1D1D1F]">Firebase</h3>
                      <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Veritabanı & Kimlik Doğrulama' : 'Database & Authentication'}</p>
                    </div>
                    <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${user ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                      {user ? (currentLanguage === 'tr' ? 'Bağlı' : 'Connected') : (currentLanguage === 'tr' ? 'Anonim' : 'Anonymous')}
                    </span>
                  </div>
                  <div className="space-y-2 text-xs text-gray-500">
                    <div className="flex justify-between"><span>{currentLanguage === 'tr' ? 'Kullanıcı' : 'User'}</span><span className="font-mono text-gray-700 truncate max-w-[160px]">{user?.email || user?.uid?.slice(0, 8) || '—'}</span></div>
                    <div className="flex justify-between"><span>Firestore</span><span className="text-green-600 font-semibold">{currentLanguage === 'tr' ? 'Aktif' : 'Active'}</span></div>
                    <div className="flex justify-between"><span>Auth</span><span className={`font-semibold ${user ? 'text-green-600' : 'text-gray-400'}`}>{user ? (currentLanguage === 'tr' ? 'Oturum Açık' : 'Signed In') : (currentLanguage === 'tr' ? 'Oturum Yok' : 'Not Signed In')}</span></div>
                  </div>
                </div>
              </div>

              {/* Webhooks */}
              <div className="apple-card p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center">
                    <Link className="w-4 h-4 text-gray-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-[#1D1D1F]">Webhooks</h3>
                    <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Gelen & giden event bildirimleri' : 'Incoming & outgoing event notifications'}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {[
                    { name: 'orders/create', source: 'Shopify → Cetpa', status: currentLanguage === 'tr' ? 'Aktif' : 'Active', color: 'bg-green-100 text-green-600' },
                    { name: 'orders/update', source: 'Shopify → Cetpa', status: currentLanguage === 'tr' ? 'Aktif' : 'Active', color: 'bg-green-100 text-green-600' },
                    { name: 'inventory/update', source: 'Cetpa → Shopify', status: currentLanguage === 'tr' ? 'Pasif' : 'Inactive', color: 'bg-gray-100 text-gray-500' },
                    { name: 'journal/sync', source: 'Cetpa → Luca', status: currentLanguage === 'tr' ? 'Manuel' : 'Manual', color: 'bg-yellow-100 text-yellow-600' },
                    { name: 'fatura/sync', source: 'Cetpa ↔ Mikro', status: companySettings?.mikro_enabled ? (currentLanguage === 'tr' ? 'Aktif' : 'Active') : (currentLanguage === 'tr' ? 'Pasif' : 'Inactive'), color: companySettings?.mikro_enabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400' },
                  ].map((wh, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div>
                        <div className="text-xs font-mono font-semibold text-gray-800">{wh.name}</div>
                        <div className="text-[10px] text-gray-400">{wh.source}</div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${wh.color}`}>{wh.status}</span>
                    </div>
                  ))}
                </div>
              </div>
              </>}
            </motion.div>
          )}

          {/* ── Finance Panel ── */}
          {activeTab === 'finance' && (
            <motion.div key="finance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <FinancePanel orders={orders} currentLanguage={currentLanguage as 'tr' | 'en'} />
            </motion.div>
          )}

          {/* ── Risk Panel ── */}
          {activeTab === 'risk' && (
            <motion.div key="risk" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <RiskPanel
                orders={orders}
                leads={leads}
                currentLanguage={currentLanguage as 'tr' | 'en'}
                userRole={userRole}
                setActiveTab={setActiveTab}
                exchangeRates={exchangeRates}
              />
            </motion.div>
          )}

          {/* ── Analytics Panel ── */}
          {activeTab === 'analytics' && (
            <motion.div key="analytics" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <AnalyticsPanel orders={orders} currentLanguage={currentLanguage as 'tr' | 'en'} />
            </motion.div>
          )}

          {/* ── Admin Panel ── */}
          {activeTab === 'admin' && (
  <motion.div key="admin" initial={{opacity:0,x:20}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-20}} className="space-y-4">
    {/* Admin Sub-tab Nav */}
    <div className="overflow-x-auto scrollbar-none">
      <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
        {([
          { id: 'overview', label: currentLanguage==='tr'?'Genel Bakış':'Overview', icon: BarChart3 },
          { id: 'users', label: currentLanguage==='tr'?'Kullanıcılar':'Users', icon: Users },
          { id: 'access', label: currentLanguage==='tr'?'Erişim Yönetimi':'Access Control', icon: Shield },
          { id: 'auditlog', label: currentLanguage==='tr'?'Audit Log':'Audit Log', icon: FileText },
          { id: 'system', label: currentLanguage==='tr'?'Sistem Durumu':'System Status', icon: Activity },
          { id: 'company', label: currentLanguage==='tr'?'Şirket Ayarları':'Company Settings', icon: Building2 },
          { id: 'evrak', label: currentLanguage==='tr'?'Evrak Tasarımı':'Document Design', icon: FileText },
        ] as const).map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setAdminTab(tab.id)}
              className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${adminTab === tab.id ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}>
              <Icon size={13} />{tab.label}
            </button>
          );
        })}
      </div>
    </div>

    {/* OVERVIEW */}
    {adminTab === 'overview' && (
      <div className="space-y-4">
        {/* Department performance KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: currentLanguage==='tr'?'Toplam Sipariş':'Total Orders', value: String(orders.length), color: 'text-brand', icon: Package, tab: 'orders' },
            { label: currentLanguage==='tr'?'Aktif Müşteri':'Active Customers', value: String(new Set(orders.map(o=>o.customerName).filter(Boolean)).size), color: 'text-blue-600', icon: Users, tab: 'crm' },
            { label: currentLanguage==='tr'?'Envanter':'Inventory Items', value: String(inventory.length), color: 'text-purple-600', icon: List, tab: 'inventory' },
          ].map((kpi,i) => {
            const Icon = kpi.icon;
            return (
              <div key={i} className="apple-card p-4 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setActiveTab(kpi.tab)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 font-medium">{kpi.label}</span>
                  <Icon size={16} className={kpi.color} />
                </div>
                <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
              </div>
            );
          })}
          {/* Revenue card with currency toggle */}
          {(() => {
            const totalTRY = orders.reduce((s,o)=>s+(o.totalPrice||0),0);
            const rate = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
            const converted = kpiCurrency === 'TRY' ? totalTRY : totalTRY / rate;
            const symbol = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
            return (
              <div className="apple-card p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab('reports')}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 font-medium">{currentLanguage==='tr'?'Toplam Ciro':'Total Revenue'}</span>
                  <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5" onClick={e => e.stopPropagation()}>
                    {(['TRY','USD','EUR'] as const).map(c => (
                      <button key={c} onClick={() => setKpiCurrency(c)}
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency===c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                        {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-2xl font-bold text-green-600">{symbol}{converted.toLocaleString('tr-TR',{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
              </div>
            );
          })()}
        </div>

        {/* Department Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Departman Performansı':'Department Performance'}</h3>
            <div className="space-y-3">
              {[
                { name: currentLanguage==='tr'?'CRM & Satış':'CRM & Sales', value: orders.length, max: Math.max(orders.length, 1), color: 'bg-brand', unit: currentLanguage==='tr'?'sipariş':'orders' },
                { name: currentLanguage==='tr'?'Envanter':'Inventory', value: inventory.filter(i=>i.stockLevel>i.lowStockThreshold).length, max: Math.max(inventory.length,1), color: 'bg-blue-500', unit: currentLanguage==='tr'?'aktif ürün':'active items' },
                { name: currentLanguage==='tr'?'Muhasebe':'Accounting', value: orders.length > 0 ? Math.round((orders.filter(o => o.status === 'Delivered').length / orders.length) * 100) : 0, max: 100, color: 'bg-green-500', unit: '%' },
              ].map((dept,i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">{dept.name}</span>
                    <span className="text-gray-500 text-xs">{dept.value} {dept.unit}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${dept.color} rounded-full transition-all`} style={{width:`${Math.min(100,(dept.value/dept.max)*100)}%`}} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Bekleyen İşler':'Pending Actions'}</h3>
            <div className="space-y-2">
              {[
                { label: currentLanguage==='tr'?'Düşük stok uyarısı':'Low stock alerts', count: inventory.filter(i=>i.stockLevel<=i.lowStockThreshold).length, color: 'text-orange-500', bg: 'bg-orange-50' },
                { label: currentLanguage==='tr'?'Geciken ödeme':'Overdue payments', count: orders.filter(o=>o.status==='Cancelled').length, color: 'text-red-500', bg: 'bg-red-50' },
                { label: currentLanguage==='tr'?'Aktif teklif':'Active quotes', count: orders.filter(o=>o.status==='Pending').length, color: 'text-blue-500', bg: 'bg-blue-50' },
              ].map((item,i) => (
                <div key={i} className={`flex items-center justify-between p-3 ${item.bg} rounded-xl`}>
                  <span className="text-sm font-medium text-gray-700">{item.label}</span>
                  <span className={`text-lg font-bold ${item.color}`}>{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Son Siparişler':'Recent Orders'}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">{currentLanguage==='tr'?'Müşteri':'Customer'}</th>
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">{currentLanguage==='tr'?'Tutar':'Amount'}</th>
                  <th className="text-center py-2 px-3 text-gray-500 font-medium hidden sm:table-cell">{currentLanguage==='tr'?'Durum':'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0,8).map((o,i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-3 font-medium text-gray-800">{o.customerName||'—'}</td>
                    <td className="py-2.5 px-3 text-right font-semibold text-brand">₺{(o.totalPrice||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                    <td className="py-2.5 px-3 text-center hidden sm:table-cell">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${o.status==='Delivered'?'bg-green-100 text-green-600':o.status==='Pending'?'bg-yellow-100 text-yellow-600':'bg-gray-100 text-gray-500'}`}>{o.status||'—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )}

    {/* USERS */}
    {adminTab === 'users' && (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-gray-800">{currentLanguage==='tr'?'Kullanıcı Yönetimi':'User Management'}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{firestoreUsers.length} {currentLanguage==='tr'?'kullanıcı':'users'}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">{currentLanguage==='tr'?'Kullanıcı':'User'}</th>
                  <th className="text-left py-2 px-3 text-gray-500 font-medium hidden sm:table-cell">E-posta</th>
                  <th className="text-center py-2 px-3 text-gray-500 font-medium">{currentLanguage==='tr'?'Rol':'Role'}</th>
                  <th className="text-center py-2 px-3 text-gray-500 font-medium">{currentLanguage==='tr'?'İşlem':'Action'}</th>
                </tr>
              </thead>
              <tbody>
                {firestoreUsers.length > 0 ? firestoreUsers.map((u: Record<string, unknown>) => (
                  <tr key={u.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center text-brand font-bold text-xs">
                          {((u.email as string)||(u.displayName as string)||'?')[0].toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-800 text-xs">{(u.displayName as string)||(u.email as string)?.split('@')[0]||'Kullanıcı'}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 text-xs hidden sm:table-cell">{(u.email as string)||'—'}</td>
                    <td className="py-2.5 px-3 text-center">
                      <select
                        value={(u.role as string)||'Sales'}
                        onChange={async (e) => {
                          try {
                            await updateDoc(doc(db, 'users', u.id as string), { role: e.target.value });
                          } catch { console.debug('error updating role'); }
                        }}
                        className="text-[10px] font-bold px-2 py-1 rounded-lg bg-gray-100 border-none cursor-pointer"
                      >
                        {(['Admin','Manager','Accounting','Sales','Logistics','HR','Purchasing','B2B','Dealer'] as string[]).map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {u.id !== user?.uid && (
                        <button
                          onClick={() => {
                            setConfirmState({
                              isOpen: true,
                              title: currentLanguage === 'tr' ? 'Kullanıcıyı Sil' : 'Delete User',
                              message: currentLanguage === 'tr' ? 'Bu kullanıcıyı silmek istediğinizden emin misiniz?' : 'Are you sure you want to delete this user?',
                              onConfirm: async () => {
                                try {
                                  await deleteDoc(doc(db, 'users', u.id as string));
                                } catch (error) {
                                  handleFirestoreError(error, OperationType.DELETE, `users/${u.id}`);
                                }
                              }
                            });
                          }}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                        >
                          {currentLanguage === 'tr' ? 'Sil' : 'Delete'}
                        </button>
                      )}
                      {u.id === user?.uid && (
                        <span className="text-[10px] text-gray-400">{currentLanguage==='tr'?'(Siz)':'(You)'}</span>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} className="text-center py-8 text-gray-400 text-xs">{currentLanguage==='tr'?'Firestore\'da kullanıcı kaydı bulunamadı. Kullanıcılar ilk giriş yaptıklarında buraya eklenir.':'No user records in Firestore. Users are added here when they first log in.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Role Simulator */}
        <div className="bg-white rounded-2xl shadow-sm border border-amber-100 p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center">
              <Shield size={16} className="text-amber-500" />
            </div>
            <div>
              <h3 className="font-bold text-gray-800 text-sm">{currentLanguage==='tr'?'Rol Simülatörü':'Role Simulator'}</h3>
              <p className="text-xs text-gray-400">{currentLanguage==='tr'?'Farklı rollerin UI\'sini test edin':'Test the UI as different roles'}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {([UserRole.Admin, UserRole.Manager, UserRole.Sales, UserRole.Logistics, UserRole.Accounting, UserRole.HR, UserRole.Purchasing, UserRole.B2B, UserRole.Dealer] as UserRole[]).map(role => (
              <button key={role} onClick={() => setUserRole(role)}
                className={cn(
                  'px-2 py-2 rounded-xl text-xs font-bold border transition-all',
                  userRole === role
                    ? 'bg-brand text-white border-brand shadow-sm'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-100'
                )}>
                {role}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-amber-600 mt-3 bg-amber-50 rounded-lg px-2 py-1.5">
            ⚠️ {currentLanguage==='tr'?'Bu simülasyon sadece UI görünümünü değiştirir. Gerçek Firestore erişim kuralları bu panelden bağımsızdır.':'This simulation only changes UI appearance. Actual Firestore security rules are independent of this panel.'}
          </p>
        </div>
      </div>
    )}

    {/* ACCESS CONTROL */}
    {adminTab === 'access' && (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-800 mb-2">{currentLanguage==='tr'?'Departman Erişim Matrisi':'Department Access Matrix'}</h3>
          <p className="text-xs text-gray-500 mb-4">{currentLanguage==='tr'?'Her rolün hangi bölümlere erişebileceğini görün':'See which sections each role can access'}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-gray-600 font-bold min-w-[140px]">{currentLanguage==='tr'?'Bölüm':'Section'}</th>
                  {['Admin','Manager','Muhasebe','Satış','Depo','IK','Satın Alma'].map(role => (
                    <th key={role} className="py-2 px-2 text-center text-gray-500 font-semibold whitespace-nowrap">{role}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accessMatrix.map((row, i) => (
                  <tr key={i} className={`border-b border-gray-50 ${i%2===0?'bg-white':'bg-gray-50/50'}`}>
                    <td className="py-2.5 px-3 font-semibold text-gray-700">{row.section}</td>
                    {row.access.map((cell, j) => (
                      <td key={j} className="py-2.5 px-2 text-center">
                        <button
                          className="text-base hover:scale-125 transition-transform cursor-pointer"
                          title="Tıklayarak değiştir"
                          onClick={() => {
                            const next = ACCESS_VALUES[(ACCESS_VALUES.indexOf(cell) + 1) % ACCESS_VALUES.length];
                            setAccessMatrix(prev => prev.map((r, ri) => ri === i ? { ...r, access: r.access.map((v, vi) => vi === j ? next : v) as AccessVal[] } : r));
                          }}
                        >{cell}</button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-500">
            <span>✅ Tam erişim</span><span>👁 Sadece okuma</span><span>📊 Kendi departmanı</span><span>❌ Erişim yok</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button onClick={() => setAccessMatrix(defaultAccessMatrix)} className="text-xs text-gray-400 hover:text-gray-600 underline">Varsayılana sıfırla</button>
            <span className="text-xs text-green-600">✓ Değişiklikler otomatik kaydedilir (oturum boyunca)</span>
          </div>
          <div className="mt-3 p-3 bg-amber-50 rounded-xl text-xs text-amber-700">
            {currentLanguage==='tr'?'Rol tabanlı kısıtlamalar gelecek bir fazda aktif hale getirilecektir. Şu an tüm giriş yapmış kullanıcılar admin haklarına sahiptir.':'Role-based restrictions will be activated in a future phase. Currently all logged-in users have admin rights.'}
          </div>
        </div>
      </div>
    )}

    {/* AUDIT LOG */}
    {adminTab === 'auditlog' && (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Sistem Audit Logu':'System Audit Log'}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">{currentLanguage==='tr'?'Zaman':'Time'}</th>
                  <th className="text-left py-2 px-3 text-gray-500 font-medium hidden sm:table-cell">{currentLanguage==='tr'?'Kullanıcı':'User'}</th>
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">{currentLanguage==='tr'?'Aksiyon':'Action'}</th>
                  <th className="text-left py-2 px-3 text-gray-500 font-medium hidden md:table-cell">{currentLanguage==='tr'?'Detay':'Detail'}</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-8 text-gray-400">{currentLanguage==='tr'?'Henüz audit logu yok.':'No audit logs yet.'}</td></tr>
                ) : (
                  auditLogs.map((log: Record<string, unknown>, i: number) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 text-xs text-gray-500 whitespace-nowrap">
                        {(log.createdAt as { toDate?: () => Date })?.toDate ? (log.createdAt as { toDate: () => Date }).toDate().toLocaleString('tr-TR') : (log.timestamp as { toDate?: () => Date })?.toDate ? (log.timestamp as { toDate: () => Date }).toDate().toLocaleString('tr-TR') : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-gray-600 hidden sm:table-cell">{(log.userEmail as string)||(log.userName as string)||'—'}</td>
                      <td className="py-2.5 px-3">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand">{(log.action as string)||'—'}</span>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 hidden md:table-cell max-w-[200px] truncate">{(log.details as string)||'—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )}

    {/* SYSTEM STATUS */}
    {adminTab === 'system' && (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { name: 'Firebase Firestore', status: 'Aktif', ok: true, desc: currentLanguage==='tr'?'Gerçek zamanlı veritabanı':'Real-time database' },
            { name: 'Firebase Auth', status: user?'Giriş Yapılmış':'Misafir', ok: true, desc: user?.email||'anonymous' },
            { name: 'TCMB Kur API', status: exchangeRates?'Bağlı':'Bekleniyor', ok: !!exchangeRates, desc: exchangeRates?`1 USD = ₺${(exchangeRates.USD||0).toFixed(2)}`:'Güncelleniyor...' },
            { name: 'Shopify', status: 'Manuel Sync', ok: true, desc: currentLanguage==='tr'?'Son sync: manuel':'Last sync: manual' },
          ].map((s,i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-800">{s.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{s.desc}</div>
                </div>
                <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${s.ok?'bg-green-100 text-green-600':'bg-red-100 text-red-500'}`}>
                  {s.ok?'●':' '} {s.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}

    {/* COMPANY SETTINGS */}
    {adminTab === 'company' && (
      <div className="space-y-4">
        {/* Logo Upload */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Şirket Logosu':'Company Logo'}</h3>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0">
              {logoUrl
                ? <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                : <ImageIcon className="w-8 h-8 text-gray-300" />
              }
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-700 mb-1">{currentLanguage==='tr'?'Logo Yükle':'Upload Logo'}</p>
              <p className="text-xs text-gray-400 mb-3">{currentLanguage==='tr'?'PNG, JPG, SVG — maks 2MB':'PNG, JPG, SVG — max 2MB'}</p>
              <label className="cursor-pointer apple-button-primary">
                <Upload className="w-3.5 h-3.5" />
                {isUploadingLogo ? (currentLanguage==='tr'?'Yükleniyor...':'Uploading...') : (currentLanguage==='tr'?'Dosya Seç':'Choose File')}
                <input type="file" accept="image/*" className="hidden" disabled={isUploadingLogo}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || !user) return;
                    setIsUploadingLogo(true);
                    try {
                      const storageRef = ref(storage, `company/logo_${user.uid}`);
                      await uploadBytes(storageRef, file);
                      const url = await getDownloadURL(storageRef);
                      setLogoUrl(url);
                      setCompanySettings((prev: Record<string, unknown>) => ({ ...prev, logoUrl: url }));
                    } catch (err) {
                      console.error('Logo upload failed:', err);
                    } finally {
                      setIsUploadingLogo(false);
                    }
                  }}
                />
              </label>
            </div>
          </div>
        </div>



        {/* Company Info */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Şirket Bilgileri':'Company Information'}</h3>
          <div className="space-y-3">
            {[
              { label: currentLanguage==='tr'?'Şirket Adı':'Company Name', key: 'companyName', placeholder: 'CETPA Teknoloji A.Ş.' },
              { label: currentLanguage==='tr'?'Vergi No':'Tax No', key: 'taxNo', placeholder: '1234567890' },
              { label: currentLanguage==='tr'?'Vergi Dairesi':'Tax Office', key: 'taxOffice', placeholder: 'Kadıköy' },
              { label: currentLanguage==='tr'?'Adres':'Address', key: 'address', placeholder: 'İstanbul, Türkiye' },
              { label: 'E-posta', key: 'email', placeholder: 'info@cetpa.com.tr' },
              { label: currentLanguage==='tr'?'Telefon':'Phone', key: 'phone', placeholder: '+90 212 000 0000' },
              { label: currentLanguage==='tr'?'IBAN':'IBAN', key: 'iban', placeholder: 'TR00 0000 0000 0000 0000 0000 00' },
              { label: currentLanguage==='tr'?'Web Sitesi':'Website', key: 'website', placeholder: 'https://cetpa.com.tr' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                <input
                  type="text"
                  defaultValue={(companySettings[f.key] as string) || ''}
                  onChange={e => setCompanySettings((prev: Record<string, unknown>) => ({...prev, [f.key]: e.target.value}))}
                  placeholder={f.placeholder}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors"
                />
              </div>
            ))}

            {/* İmza / Footer alanı */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage==='tr'?'E-posta/PDF İmzası':'Email/PDF Signature'}</label>
              <textarea
                rows={3}
                defaultValue={(companySettings.signature as string) || ''}
                onChange={e => setCompanySettings((prev: Record<string, unknown>) => ({...prev, signature: e.target.value}))}
                placeholder={currentLanguage==='tr'?'CETPA Teknoloji A.Ş.\ninfo@cetpa.com.tr\n+90 212 000 0000':'CETPA Technology Inc.\ninfo@cetpa.com.tr\n+90 212 000 0000'}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors resize-none font-mono"
              />
            </div>

            <button
              onClick={async () => {
                try {
                  await setDoc(doc(db, 'settings', 'app'), { companySettings }, { merge: true });
                  toast(currentLanguage==='tr'?'Ayarlar kaydedildi!':'Settings saved!', 'success');
                } catch (error) {
                  handleFirestoreError(error, OperationType.WRITE, 'settings/app');
                  toast(currentLanguage==='tr'?'Hata oluştu!':'Error occurred!', 'error');
                }
              }}
              className="apple-button-primary w-full mt-2"
            >
              {currentLanguage==='tr'?'Kaydet':'Save'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Evrak Tasarımı ── */}
    {adminTab === 'evrak' && (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="py-2">
        <DocumentDesigner currentLanguage={currentLanguage} />
      </motion.div>
    )}
  </motion.div>
)}

          {/* ── Settings / Ayarlar ── */}
          {activeTab === 'settings' && (userRole === 'Admin' || userRole === 'Manager') && (
            <motion.div key="settings" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6 max-w-2xl">

              {/* ─── Subscription Management ─── */}
              <SubscriptionPanel
                currentLanguage={currentLanguage}
                subscription={userSubscription}
                paymentHistory={paymentHistory}
                onChangePlan={handleSelectPlan}
                onCancelSubscription={handleCancelSubscription}
                onViewPricing={() => setShowPricingPage(true)}
              />

              <hr className="border-gray-100" />

              <ModuleHeader 
                title={currentLanguage === 'tr' ? 'Entegrasyon Ayarları' : 'Integration Settings'} 
                subtitle={currentLanguage === 'tr' ? 'API anahtarları ve entegrasyon bilgilerini buradan yönetin.' : 'Manage API keys and integration credentials here.'}
                icon={Settings}
              />

              {/* Shopify */}
              <div className="apple-card p-6 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center">
                    <ShoppingBag className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Shopify</h3>
                    <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'E-ticaret entegrasyonu' : 'E-commerce integration'}</p>
                  </div>
                </div>
                {[
                  { key: 'shopify_store_url', label: currentLanguage === 'tr' ? 'Mağaza URL' : 'Store URL', placeholder: 'mystore.myshopify.com' },
                  { key: 'shopify_access_token', label: currentLanguage === 'tr' ? 'Access Token' : 'Access Token', placeholder: 'shpat_...' },
                  { key: 'shopify_api_key', label: 'API Key', placeholder: 'API Key' },
                  { key: 'shopify_api_secret', label: 'API Secret', placeholder: 'API Secret' },
                ].map(field => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{field.label}</label>
                    <input
                      type={field.key.includes('token') || field.key.includes('secret') ? 'password' : 'text'}
                      defaultValue={(companySettings?.[field.key] as string) || ''}
                      placeholder={field.placeholder}
                      onChange={e => setCompanySettings((prev: Record<string, unknown>) => ({...prev, [field.key]: e.target.value}))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all font-mono"
                    />
                  </div>
                ))}
                <button
                  onClick={async () => {
                    try {
                      await syncShopify({
                        accessToken: companySettings.shopify_access_token as string,
                        storeUrl: companySettings.shopify_store_url as string
                      });
                      alert(currentLanguage === 'tr' ? 'Shopify bağlantısı başarılı!' : 'Shopify connection successful!');
                    } catch (e) {
                      alert(e instanceof Error ? e.message : 'Error');
                    }
                  }}
                  className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {currentLanguage === 'tr' ? 'Bağlantıyı Test Et' : 'Test Connection'}
                </button>
              </div>

              {/* Luca */}
              <div className="apple-card p-6 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-sm">Luca Muhasebe</h3>
                    <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Muhasebe yazılımı entegrasyonu' : 'Accounting software integration'}</p>
                  </div>
                  <button
                    onClick={async () => {
                      const newVal = !lucaSettings.enabled;
                      await updateDoc(doc(db, 'settings', 'luca'), { enabled: newVal });
                      if (newVal) {
                        await updateDoc(doc(db, 'settings', 'mikro'), { enabled: false }).catch(() => {});
                      }
                    }}
                    className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${lucaSettings.enabled ? 'bg-purple-500' : 'bg-gray-200'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${lucaSettings.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
                {[
                  { key: 'luca_api_key', label: 'API Key', placeholder: 'Luca API Key' },
                  { key: 'luca_company_id', label: currentLanguage === 'tr' ? 'Şirket ID' : 'Company ID', placeholder: 'Company ID' },
                  { key: 'luca_base_url', label: 'Base URL', placeholder: 'https://api.luca.com.tr' },
                ].map(field => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{field.label}</label>
                    <input
                      type={field.key.includes('key') ? 'password' : 'text'}
                      defaultValue={(companySettings?.[field.key] as string) || (field.key === 'luca_base_url' ? 'https://api.luca.com.tr' : '')}
                      placeholder={field.placeholder}
                      onChange={e => {
                        const val = e.target.value;
                        const key = field.key === 'luca_api_key' ? 'apiKey' : field.key === 'luca_company_id' ? 'companyId' : 'baseUrl';
                        updateDoc(doc(db, 'settings', 'luca'), { [key]: val });
                      }}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all font-mono"
                    />
                  </div>
                ))}
              </div>

              {/* Mikro */}
              <div className="apple-card p-6 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#e8f0f7' }}>
                    <BookOpen className="w-5 h-5" style={{ color: '#1a3a5c' }} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-sm">Mikro ERP (JumpBulut)</h3>
                    <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Cetpa → Mikro senkronizasyon' : 'Cetpa → Mikro sync'}</p>
                  </div>
                  <button
                    onClick={async () => {
                      const newVal = !mikroSettings.enabled;
                      await updateDoc(doc(db, 'settings', 'mikro'), { enabled: newVal });
                      if (newVal) {
                        await updateDoc(doc(db, 'settings', 'luca'), { enabled: false }).catch(() => {});
                      }
                    }}
                    className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${mikroSettings.enabled ? 'bg-[#1a3a5c]' : 'bg-gray-200'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${mikroSettings.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
                {[
                  { key: 'mikro_access_token', label: 'Access Token', placeholder: '1234...', isSecret: true },
                  { key: 'mikro_endpoint', label: 'API Endpoint', placeholder: 'https://jumpbulutapigw.mikro.com.tr/ApiJB/ApiMethods', isSecret: false },
                ].map(field => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{field.label}</label>
                    <input
                      type={field.isSecret ? 'password' : 'text'}
                      defaultValue={(companySettings?.[field.key] as string) || (field.key === 'mikro_endpoint' ? 'https://jumpbulutapigw.mikro.com.tr/ApiJB/ApiMethods' : '')}
                      placeholder={field.placeholder}
                      onChange={e => {
                        const val = e.target.value;
                        updateDoc(doc(db, 'settings', 'mikro'), { [field.key.replace('mikro_', '')]: val });
                      }}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all font-mono"
                    />
                  </div>
                ))}
                <div className="p-3 bg-blue-50 rounded-xl text-xs text-blue-700">
                  💡 {currentLanguage === 'tr'
                    ? 'Access Token\'ı "Online İşlem Merkezi"nden oluşturun. Erişim için izin verilen IP adresinden bağlanın.'
                    : 'Generate the Access Token from "Online İşlem Merkezi". Connect from the whitelisted IP address.'}
                </div>
              </div>

              <button
                onClick={async () => {
                  try {
                    await setDoc(doc(db, 'settings', 'app'), { companySettings }, { merge: true });
                    toast(currentLanguage==='tr'?'Entegrasyon ayarları kaydedildi!':'Integration settings saved!', 'success');
                  } catch (error) {
                    handleFirestoreError(error, OperationType.WRITE, 'settings/app');
                    toast(currentLanguage==='tr'?'Hata oluştu!':'Error occurred!', 'error');
                  }
                }}
                className="apple-button-primary w-full mt-4"
              >
                {currentLanguage==='tr'?'Ayarları Kaydet':'Save Settings'}
              </button>

              {/* Firebase / General */}
              <div className="apple-card p-6 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 bg-yellow-50 rounded-xl flex items-center justify-center">
                    <Shield className="w-5 h-5 text-yellow-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">{currentLanguage === 'tr' ? 'Güvenlik & Genel' : 'Security & General'}</h3>
                    <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Uygulama güvenlik ayarları' : 'Application security settings'}</p>
                  </div>
                </div>
                <div className="p-3 bg-blue-50 rounded-xl text-xs text-blue-700 font-medium">
                  💡 {currentLanguage === 'tr' ? 'API anahtarları güvenli bir şekilde saklanmalıdır. Üretim ortamında .env dosyası kullanmanızı öneririz.' : 'API keys should be stored securely. We recommend using .env files in production.'}
                </div>
              </div>

              {/* Security module — session info */}
              <div className="apple-card p-6 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center">
                    <Lock className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">{currentLanguage === 'tr' ? 'Aktif Oturum & Güvenlik' : 'Active Session & Security'}</h3>
                    <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Oturum ve rol bilgileri' : 'Session and role information'}</p>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  {[
                    { label: currentLanguage === 'tr' ? 'Kullanıcı' : 'User', value: user?.email || '—' },
                    { label: currentLanguage === 'tr' ? 'Rol' : 'Role', value: userRole },
                    { label: 'UID', value: user?.uid?.slice(0, 16) + '...' || '—' },
                    { label: currentLanguage === 'tr' ? 'Giriş Yöntemi' : 'Sign-in Method', value: user?.providerData?.[0]?.providerId || 'anonymous' },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <span className="text-[#86868B] text-xs font-medium">{row.label}</span>
                      <span className="text-xs font-mono font-semibold text-[#1D1D1F] truncate max-w-[180px]">{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className={cn("p-3 rounded-xl text-xs font-medium text-center", userRole === 'Admin' ? 'bg-red-50 text-red-600' : userRole === 'Manager' ? 'bg-orange-50 text-orange-600' : userRole === 'Dealer' ? 'bg-purple-50 text-purple-600' : 'bg-gray-50 text-gray-600')}>
                    <p className="font-bold text-lg">{userRole}</p>
                    <p className="opacity-70">{currentLanguage === 'tr' ? 'Yetki Seviyesi' : 'Permission Level'}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-green-50 text-green-600 text-xs font-medium text-center">
                    <p className="font-bold text-lg">●</p>
                    <p>{currentLanguage === 'tr' ? 'Oturum Aktif' : 'Session Active'}</p>
                  </div>
                </div>
              </div>

              {/* Dealer Portal info */}
              <div className="apple-card p-6 space-y-3 bg-purple-50/50 border border-purple-100">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center">
                    <Users className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-purple-800">{currentLanguage === 'tr' ? 'Bayi Yönetimi' : 'Dealer Management'}</h3>
                    <p className="text-[11px] text-purple-600">{currentLanguage === 'tr' ? 'Bayilere özel erişim tanımla' : 'Define dealer-specific access'}</p>
                  </div>
                </div>
                <div className="text-xs text-purple-700 space-y-1.5">
                  <p>✓ {currentLanguage === 'tr' ? 'Bayi rolündeki kullanıcılar yalnızca kendi siparişlerini görür.' : 'Dealer-role users only see their own orders.'}</p>
                  <p>✓ {currentLanguage === 'tr' ? 'Bayiler müşteri ve sipariş oluşturabilir.' : 'Dealers can create customers and orders.'}</p>
                  <p>✓ {currentLanguage === 'tr' ? 'Admin panelinden "Bayi / Dealer" rolü ile davet edebilirsiniz.' : 'Invite via Admin panel with "Bayi / Dealer" role.'}</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── B2B Portal ── */}
          {activeTab === 'b2b' && (
            <motion.div key="b2b" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <B2BPortal user={user} userRole={userRole} leads={leads} inventory={inventory} currentT={currentT} currentLanguage={currentLanguage} />
            </motion.div>
          )}


          {/* ── Inventory ── */}
          {activeTab === 'inventory' && (
            <motion.div key="inventory" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <InventoryView
                inventory={inventory}
                categories={inventoryCategories}
                selectedCategory={selectedCategory}
                setSelectedCategory={setSelectedCategory}
                currentT={currentT}
                currentLanguage={currentLanguage}
                isAuthenticated={!!user}
                userRole={userRole}
                inventoryMovements={inventoryMovements}
                warehouses={warehouses}
              />
            </motion.div>
          )}

          {/* ── CRM Pipeline ── */}
          {activeTab === 'crm' && !selectedLead && (
            <motion.div key="crm-pipeline" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
              {/* CRM Sub-tabs */}
              <div className="overflow-x-auto scrollbar-none -mx-3 px-3">
                <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max mb-2">
                  {[
                    { id: 'leads', label: currentLanguage === 'tr' ? 'Müşteri Adayları' : 'Leads', icon: Users },
                    { id: 'musteriler', label: currentLanguage === 'tr' ? 'Müşteriler' : 'Customers', icon: UserCheck },
                    { id: 'siparisler', label: currentLanguage === 'tr' ? 'Siparişler' : 'Orders', icon: Package },
                    { id: 'b2b', label: 'B2B Portal', icon: Globe },
                    { id: 'komisyon', label: currentLanguage === 'tr' ? 'Komisyon' : 'Commission', icon: TrendingUp },
                  ].map(tab => {
                    const Icon = tab.icon;
                    return (
                      <button key={tab.id} onClick={() => setCrmTab(tab.id)}
                        className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${crmTab === tab.id ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}>
                        <Icon size={13} /><span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* CRM sub-tab: Müşteriler */}
              {crmTab === 'musteriler' && (
                <AccountingModule orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} exchangeRates={exchangeRates} initialTab="musteriler" allowedTabs={['musteriler']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}

              {/* CRM sub-tab: Siparişler */}
              {crmTab === 'siparisler' && (
                <div className="space-y-6">
                  <ModuleHeader
                    title={currentT.all_orders}
                    subtitle={currentT.manage_orders}
                    icon={Package}
                    actionButton={
                      <div className="flex items-center gap-4">
                        <div className="relative w-full sm:w-auto">
                          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            placeholder={currentT.search_orders}
                            value={orderSearch}
                            onChange={(e) => setOrderSearch(e.target.value)}
                            className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-full text-sm outline-none focus:border-brand w-full sm:w-64 transition-all"
                          />
                        </div>
                        <button onClick={() => { setSelectedLead(null); setIsAddingOrder(true); }}
                          className="apple-button-primary whitespace-nowrap">
                          <Plus className="w-4 h-4" /> {currentT.new_order}
                        </button>
                      </div>
                    }
                  />
                  <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider">{currentT.order_id}</th>
                            {[
                              { key: 'customerName', label: currentT.customer },
                              { key: 'syncedAt', label: currentT.date },
                              { key: 'status', label: currentT.status },
                            ].map(col => (
                              <th key={col.key}
                                className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider cursor-pointer select-none group hover:text-brand transition-colors"
                                onClick={() => toggleSort(orderSort, col.key, setOrderSort)}>
                                {col.label}<SortIcon col={col.key} config={orderSort} />
                              </th>
                            ))}
                            <th className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider text-right cursor-pointer select-none group hover:text-brand transition-colors"
                              onClick={() => toggleSort(orderSort, 'totalPrice', setOrderSort)}>
                              {currentT.total}<SortIcon col="totalPrice" config={orderSort} />
                            </th>
                            <th className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider text-right">{currentT.actions}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(() => {
                            const filtered = orders.filter(o =>
                              o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                              o.shopifyOrderId?.toLowerCase().includes(orderSearch.toLowerCase()) ||
                              o.shippingAddress?.toLowerCase().includes(orderSearch.toLowerCase())
                            );
                            const sorted = sortData(filtered, orderSort.key, orderSort.dir);
                            return sorted.length === 0 ? (
                              <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">{currentT.no_orders_found}</td></tr>
                            ) : sorted.map(order => (
                              <tr key={order.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setSelectedOrder(order)}>
                                <td className="px-6 py-4 font-medium text-[#1D2226]">{order.shopifyOrderId}</td>
                                <td className="px-6 py-4 text-gray-600">{order.customerName}</td>
                                <td className="px-6 py-4 text-gray-500">
                                  {order.syncedAt ? (typeof (order.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (order.syncedAt as { toDate: () => Date }).toDate() : new Date(order.syncedAt as unknown as string | number | Date)).toLocaleDateString() : 'Unknown Date'}
                                </td>
                                <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                                  <select value={order.status} onChange={(e) => {
                                    e.stopPropagation(); openConfirm({
                                      title: currentT.status,
                                      message: `Update status to "${e.target.value}"?`,
                                      onConfirm: () => handleUpdateOrderStatus(order.id, e.target.value as Order['status'])
                                    });
                                  }}
                                    className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded-full outline-none cursor-pointer appearance-none",
                                      order.status === 'Pending' ? "bg-amber-50 text-amber-600" :
                                        order.status === 'Processing' ? "bg-purple-50 text-purple-600" :
                                          order.status === 'Shipped' ? "bg-blue-50 text-blue-600" :
                                            order.status === 'Delivered' ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-600"
                                    )}>
                                    <option value="Pending">{currentT.pending}</option>
                                    <option value="Processing">{currentT.processing}</option>
                                    <option value="Shipped">{currentT.shipped}</option>
                                    <option value="Delivered">{currentT.delivered}</option>
                                    <option value="Cancelled">{currentT.cancelled}</option>
                                  </select>
                                </td>
                                <td className="px-6 py-4 text-right font-bold text-[#1D2226]">₺{order.totalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                  <button onClick={() => handleDeleteOrder(order.id)} className="text-gray-400 hover:text-red-600 transition-colors p-1">
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* CRM sub-tab: B2B Portal */}
              {crmTab === 'b2b' && (
                <B2BPortal user={user} userRole={userRole} leads={leads} inventory={inventory} currentT={currentT} currentLanguage={currentLanguage} />
              )}

              {crmTab === 'komisyon' && (
                <DealerCommissionPanel
                  currentLanguage={currentLanguage as 'tr' | 'en'}
                  isAuthenticated={!!user}
                  userRole={userRole}
                  leads={leads}
                  orders={orders}
                  exchangeRates={exchangeRates}
                />
              )}

              {/* CRM sub-tab: Leads (default) */}
              {crmTab === 'leads' && <>
              {/* Row 1: Title + primary action */}
              <ModuleHeader
                title={currentT.sales_pipeline}
                subtitle={currentT.manage_leads}
                icon={Users}
                actionButton={
                  <button onClick={() => setIsAddingLead(true)} className="apple-button-primary">
                    <Plus className="w-4 h-4" /> {currentT.new_lead_btn}
                  </button>
                }
              />
              {/* Row 2: Search + secondary actions */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder={currentT.search_leads}
                    value={crmSearch}
                    onChange={(e) => setCrmSearch(e.target.value)}
                    className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-full text-sm outline-none focus:border-brand w-full transition-all"
                  />
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-1 flex items-center shadow-sm shrink-0">
                  <button onClick={() => setViewMode('list')} className={cn("p-1.5 rounded-lg transition-colors", viewMode === 'list' ? "bg-gray-100 text-[#1D1D1F]" : "text-gray-400 hover:text-gray-600")} title="Liste">
                    <List className="w-4 h-4" />
                  </button>
                  <button onClick={() => setViewMode('board')} className={cn("p-1.5 rounded-lg transition-colors", viewMode === 'board' ? "bg-gray-100 text-[#1D1D1F]" : "text-gray-400 hover:text-gray-600")} title="Kanban">
                    <Kanban className="w-4 h-4" />
                  </button>
                </div>
                <label className="apple-button-secondary shrink-0 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">CSV</span>
                  <input type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
                </label>
              </div>

              {viewMode === 'list' ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-3">
                    {/* Sort bar */}
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] text-[#86868B] font-semibold uppercase mr-1">{currentLanguage === 'tr' ? 'Sırala:' : 'Sort:'}</span>
                      {[
                        { key: 'name', label: 'A–Z' },
                        { key: 'score', label: currentLanguage === 'tr' ? 'Skor' : 'Score' },
                        { key: 'company', label: currentLanguage === 'tr' ? 'Şirket' : 'Company' },
                        { key: 'status', label: currentLanguage === 'tr' ? 'Durum' : 'Status' },
                        { key: 'createdAt', label: currentLanguage === 'tr' ? 'Tarih' : 'Date' },
                      ].map(opt => (
                        <button key={opt.key}
                          onClick={() => toggleSort(crmSort, opt.key, setCrmSort)}
                          className={cn("text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all flex items-center gap-1",
                            crmSort.key === opt.key ? "bg-brand text-white border-brand" : "bg-white text-[#86868B] border-gray-200 hover:border-brand hover:text-brand"
                          )}>
                          {opt.label}
                          {crmSort.key === opt.key && (
                            <TrendingUp className={cn("w-3 h-3 transition-transform", crmSort.dir === 'desc' ? "rotate-180" : "")} />
                          )}
                        </button>
                      ))}
                    </div>
                    {(() => {
                      const filtered = leads.filter(l =>
                        l.name.toLowerCase().includes(crmSearch.toLowerCase()) ||
                        l.company.toLowerCase().includes(crmSearch.toLowerCase()) ||
                        l.email.toLowerCase().includes(crmSearch.toLowerCase())
                      );
                      const sorted = sortData(filtered, crmSort.key, crmSort.dir);
                      return sorted.length === 0 ? (
                      <div className="bg-white p-12 rounded-xl border border-gray-200 text-center">
                        <Users className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                        <p className="text-gray-500">{currentT.no_leads_found}</p>
                      </div>
                    ) : (
                      sorted.map(lead => (
                        <div key={lead.id} className="bg-white p-4 rounded-xl border border-gray-200 hover:shadow-md transition-shadow flex items-center justify-between gap-4">
                          <div className="flex items-center gap-4 min-w-0">
                            <div className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-sm sm:text-lg shrink-0", (lead.score || 0) > 70 ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-400")}>
                              {lead.score || '--'}
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-bold text-[#1D2226] truncate">{lead.name}</h4>
                              <p className="text-xs text-gray-500 truncate">{lead.company}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 sm:gap-6 shrink-0">
                            <div className="text-right hidden sm:block">
                              <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded-full",
                                lead.status === 'New' ? "bg-blue-50 text-blue-600" :
                                  lead.status === 'Qualified' ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-500"
                              )}>
                                {currentT[lead.status.toLowerCase()] || lead.status}
                              </span>
                              <p className="text-[10px] text-gray-400 mt-1">{lead.phone}</p>
                            </div>
                            <button onClick={() => setSelectedLead(lead)} className="text-brand text-sm font-bold hover:underline">{currentT.view}</button>
                          </div>
                        </div>
                      )));
                    })()}
                  </div>
                  <div className="space-y-6">
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                      <h3 className="font-bold mb-4 flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-brand" /> {currentT.performance}
                      </h3>
                      <div className="space-y-4">
                        {(() => {
                          const totalLeadsCount = leads.length;
                          const closedWon = leads.filter(l => (l.status as string) === 'Closed Won').length;
                          const activeLeads = leads.filter(l => !(['Closed Won', 'Closed Lost'] as string[]).includes(l.status)).length;
                          const convRate = totalLeadsCount > 0 ? Math.round((closedWon / totalLeadsCount) * 100) : 0;
                          const activePct = totalLeadsCount > 0 ? Math.round((activeLeads / totalLeadsCount) * 100) : 0;
                          return (
                            <div className="space-y-3">
                              <div>
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-gray-500">{currentT.target_achievement} ({currentLanguage === 'tr' ? 'Kazanılan/Toplam' : 'Won/Total'})</span>
                                  <span className="font-bold text-emerald-600">{convRate}%</span>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${convRate}%` }} />
                                </div>
                              </div>
                              <div>
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-gray-500">{currentLanguage === 'tr' ? 'Aktif Hat' : 'Active Pipeline'}</span>
                                  <span className="font-bold text-brand">{activePct}%</span>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-brand transition-all" style={{ width: `${activePct}%` }} />
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                        <div className="grid grid-cols-2 gap-4 pt-2">
                          <button className="bg-gray-50 p-3 rounded-lg text-left hover:bg-gray-100 transition-colors group">
                            <p className="text-[10px] text-gray-500 uppercase font-bold group-hover:text-brand transition-colors">{currentT.total_leads}</p>
                            <p className="text-xl font-bold">{leads.length}</p>
                          </button>
                          <button className="bg-gray-50 p-3 rounded-lg text-left hover:bg-gray-100 transition-colors group" onClick={() => setCrmSearch('score:>80')}>
                            <p className="text-[10px] text-gray-500 uppercase font-bold group-hover:text-emerald-600 transition-colors">{currentT.hot_leads}</p>
                            <p className="text-xl font-bold text-emerald-600">{leads.filter(l => (l.score || 0) > 80).length}</p>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {['New', 'Contacted', 'Qualified', 'Closed'].map(status => (
                    <div key={status} className="bg-gray-50 rounded-xl p-4 border border-gray-200 min-h-[200px]">
                      <h3 className="font-bold text-sm mb-4 flex items-center justify-between">
                        {currentT[status.toLowerCase()] || status}
                        <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full text-xs">
                          {leads.filter(l => l.status === status && (
                            l.name.toLowerCase().includes(crmSearch.toLowerCase()) ||
                            l.company.toLowerCase().includes(crmSearch.toLowerCase()) ||
                            l.email.toLowerCase().includes(crmSearch.toLowerCase())
                          )).length}
                        </span>
                      </h3>
                      <div className="space-y-3">
                        {leads.filter(l => l.status === status && (
                          l.name.toLowerCase().includes(crmSearch.toLowerCase()) ||
                          l.company.toLowerCase().includes(crmSearch.toLowerCase()) ||
                          l.email.toLowerCase().includes(crmSearch.toLowerCase())
                        )).map(lead => (
                          <div key={lead.id} onClick={() => setSelectedLead(lead)} className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm cursor-pointer hover:border-brand transition-colors">
                            <div className="flex justify-between items-start mb-2">
                              <h4 className="font-bold text-sm text-[#1D2226]">{lead.name}</h4>
                              <div className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", (lead.score || 0) > 70 ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500")}>
                                {lead.score || '--'}
                              </div>
                            </div>
                            <p className="text-xs text-gray-500 mb-2">{lead.company}</p>
                            <p className="text-[10px] text-gray-400 truncate">{lead.email}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              </>}
            </motion.div>
          )}

          {/* ── CRM Detail ── */}
          {activeTab === 'crm' && selectedLead && (
            <motion.div key="crm-detail" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setSelectedLead(null)} className="text-gray-500 hover:text-gray-900 bg-white p-2 rounded-full shadow-sm border border-gray-200 shrink-0">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <ModuleHeader
                  title={selectedLead.name}
                  subtitle={selectedLead.company}
                  className="mb-0 w-full"
                  actionButton={
                    <div className="flex gap-2">
                      <button onClick={() => { setEditingLeadData(selectedLead); setIsEditingLead(true); }} className="apple-button-secondary">
                        <Edit2 className="w-4 h-4" /> {currentT.edit}
                      </button>
                      <button onClick={() => handleDeleteLead(selectedLead.id)} className="apple-button-secondary text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" /> {currentT.delete}
                      </button>
                      <button onClick={() => setIsAddingOrder(true)} className="apple-button-primary">
                        <Plus className="w-4 h-4" /> {currentT.add_order}
                      </button>
                    </div>
                  }
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h3 className="font-bold mb-4">{currentT.lead_details}</h3>
                    <div className="space-y-4 text-sm">
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold mb-1">{currentT.status}</span>
                        <select value={selectedLead.status} onChange={(e) => openConfirm({
                          title: currentT.status,
                          message: `Update status to "${e.target.value}"?`,
                          onConfirm: () => handleUpdateLeadStatus(selectedLead.id, e.target.value as 'New' | 'Contacted' | 'Qualified' | 'Closed')
                        })}
                          className="block w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-brand font-medium">
                          <option value="New">{currentT.new}</option>
                          <option value="Contacted">{currentT.contacted}</option>
                          <option value="Qualified">{currentT.qualified}</option>
                          <option value="Closed">{currentT.closed}</option>
                        </select>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">Email</span>
                        <span className="font-medium">{selectedLead.email || '--'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">Phone</span>
                        <span className="font-medium">{selectedLead.phone || '--'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">{currentT.ai_score}</span>
                        <span className={cn("font-bold text-lg", (selectedLead.score || 0) > 70 ? "text-emerald-600" : "text-[#1D2226]")}>
                          {selectedLead.score || '--'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h3 className="font-bold mb-4">{currentT.notes_ai_insights}</h3>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{selectedLead.notes || currentT.no_notes_available}</p>
                  </div>
                </div>

                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h3 className="font-bold mb-4 flex items-center gap-2">
                      <Package className="w-5 h-5 text-brand" /> {currentT.associated_orders}
                    </h3>
                    <div className="space-y-3">
                      {orders.filter(o => o.leadId === selectedLead.id || o.customerName === selectedLead.name).length === 0 ? (
                        <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-xl">
                          <Package className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                          <p className="text-sm text-gray-500 font-medium">{currentT.no_orders_found_for_lead}</p>
                          <button onClick={() => setIsAddingOrder(true)} className="mt-4 text-brand font-bold text-sm hover:underline">
                            {currentT.create_first_order}
                          </button>
                        </div>
                      ) : (
                        orders.filter(o => o.leadId === selectedLead.id || o.customerName === selectedLead.name).map(order => (
                          <div key={order.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:bg-gray-50 transition-colors">
                            <div>
                              <p className="font-bold text-sm text-[#1D2226]">{order.shopifyOrderId}</p>
                              <p className="text-xs text-gray-500 mt-1">
                                {order.syncedAt ? (typeof (order.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (order.syncedAt as { toDate: () => Date }).toDate() : new Date(order.syncedAt as unknown as string | number | Date)).toLocaleDateString() : currentT.unknown_date}
                              </p>
                              <p className="text-[10px] text-gray-400 mt-1 truncate max-w-[200px]">{order.shippingAddress}</p>
                            </div>
                            <div className="text-right flex flex-col items-end gap-2">
                              <button onClick={() => handleDeleteOrder(order.id)} className="text-gray-400 hover:text-red-600 transition-colors">
                                <Trash2 className="w-4 h-4" />
                              </button>
                              <div>
                                <p className="font-bold text-lg text-[#1D2226]">{formatCurrency(order.totalPrice, exchangeRates)}</p>
                                <select value={order.status} onChange={(e) => handleUpdateOrderStatus(order.id, e.target.value as Order['status'])}
                                  className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded-full inline-block mt-2 outline-none cursor-pointer appearance-none",
                                    order.status === 'Pending' ? "bg-amber-50 text-amber-600" :
                                      order.status === 'Processing' ? "bg-purple-50 text-purple-600" :
                                        order.status === 'Shipped' ? "bg-blue-50 text-blue-600" :
                                          order.status === 'Delivered' ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-500"
                                  )}>
                                  <option value="Pending">{currentT.pending}</option>
                                  <option value="Processing">{currentT.processing}</option>
                                  <option value="Shipped">{currentT.shipped}</option>
                                  <option value="Delivered">{currentT.delivered}</option>
                                  <option value="Cancelled">{currentT.cancelled}</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-bold flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-brand" /> {currentT.activity_log}
                      </h3>
                      <button onClick={() => setIsAddingActivity(true)} className="text-brand text-sm font-bold hover:underline flex items-center gap-1">
                        <Plus className="w-4 h-4" /> {currentT.add_activity}
                      </button>
                    </div>
                    {isAddingActivity && (
                      <form onSubmit={handleAddActivity} className="mb-6 bg-gray-50 p-4 rounded-xl border border-gray-200">
                        <div className="flex gap-4 mb-3">
                          {['Note', 'Call', 'Email', 'Meeting'].map(type => (
                            <label key={type} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input type="radio" name="type" value={type} checked={newActivity.type === type} onChange={(e) => setNewActivity({ ...newActivity, type: e.target.value as 'Call' | 'Email' | 'Meeting' | 'Note' | 'Visit' })} />
                              {currentT[type.toLowerCase()]}
                            </label>
                          ))}
                        </div>
                        <textarea placeholder={currentT.activity_description} value={newActivity.description} onChange={(e) => setNewActivity({ ...newActivity, description: e.target.value })}
                          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-brand text-sm mb-3 min-h-[80px]" required />
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setIsAddingActivity(false)} className="apple-button-secondary">{currentT.cancel}</button>
                          <button type="submit" className="apple-button-primary">{currentT.save_activity}</button>
                        </div>
                      </form>
                    )}
                    <div className="space-y-4">
                      {(!selectedLead.activities || selectedLead.activities.length === 0) ? (
                        <p className="text-sm text-gray-500 text-center py-4">{currentT.no_activities_logged}</p>
                      ) : (
                        [...selectedLead.activities].sort((a, b) => (typeof (b.date as { toDate?: () => Date }).toDate === 'function' ? (b.date as { toDate: () => Date }).toDate() : new Date(b.date as unknown as string | number | Date)).getTime() - (typeof (a.date as { toDate?: () => Date }).toDate === 'function' ? (a.date as { toDate: () => Date }).toDate() : new Date(a.date as unknown as string | number | Date)).getTime()).map(activity => (
                          <div key={activity.id} className="flex gap-4">
                            <div className="mt-1">
                              {activity.type === 'Note' && <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"><FileText className="w-4 h-4 text-gray-600" /></div>}
                              {activity.type === 'Call' && <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center"><Phone className="w-4 h-4 text-blue-600" /></div>}
                              {activity.type === 'Email' && <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center"><Mail className="w-4 h-4 text-emerald-600" /></div>}
                              {activity.type === 'Meeting' && <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center"><Users className="w-4 h-4 text-purple-600" /></div>}
                            </div>
                            <div className="flex-1 bg-gray-50 p-3 rounded-xl border border-gray-100">
                              <div className="flex justify-between items-start mb-1">
                                <span className="font-bold text-sm">{currentT[activity.type.toLowerCase()]}</span>
                                <span className="text-[10px] text-gray-400">{(typeof (activity.date as { toDate?: () => Date }).toDate === 'function' ? (activity.date as { toDate: () => Date }).toDate() : new Date(activity.date as unknown as string | number | Date)).toLocaleString()}</span>
                              </div>
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">{activity.description}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Voice Notes & Follow-Up */}
                  <div className="mt-6 space-y-6">
                    <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                      <h4 className="font-bold mb-3">{currentT.voice_notes}</h4>
                      <input type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && handleUploadVoiceNote(e.target.files[0])} className="text-sm" />
                      <div className="mt-3 space-y-2">
                        {selectedLead.voiceNotes?.map(note => (
                          <div key={note.id} className="flex items-center gap-2">
                            <audio controls src={note.url} className="h-8" />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                      <h4 className="font-bold mb-3">{currentT.follow_up_reminder}</h4>
                      <input type="date" value={selectedLead.nextFollowUpDate ? (typeof (selectedLead.nextFollowUpDate as { toDate?: () => Date }).toDate === 'function' ? (selectedLead.nextFollowUpDate as { toDate: () => Date }).toDate() : new Date(selectedLead.nextFollowUpDate as unknown as string | number | Date)).toISOString().split('T')[0] : ''} onChange={(e) => handleUpdateFollowUpDate(e.target.value)} className="border rounded p-2 text-sm" />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Orders List ── */}
          {activeTab === 'orders' && !selectedOrder && (
            <motion.div key="orders-list" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              <ModuleHeader
                title={currentT.all_orders}
                subtitle={currentT.manage_orders}
                icon={Package}
                actionButton={
                  <div className="flex items-center gap-4">
                    <div className="relative w-full sm:w-auto">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder={currentT.search_orders}
                        value={orderSearch}
                        onChange={(e) => setOrderSearch(e.target.value)}
                        className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-full text-sm outline-none focus:border-brand w-full sm:w-64 transition-all"
                      />
                    </div>
                    <button onClick={() => { setSelectedLead(null); setIsAddingOrder(true); }}
                      className="apple-button-primary">
                      <Plus className="w-4 h-4" /> {currentT.new_order}
                    </button>
                  </div>
                }
              />

              {/* Desktop Table View */}
              <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider">{currentT.order_id}</th>
                        {[
                          { key: 'customerName', label: currentT.customer },
                          { key: 'syncedAt', label: currentT.date },
                          { key: 'status', label: currentT.status },
                        ].map(col => (
                          <th key={col.key}
                            className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider cursor-pointer select-none group hover:text-brand transition-colors"
                            onClick={() => toggleSort(orderSort, col.key, setOrderSort)}>
                            {col.label}<SortIcon col={col.key} config={orderSort} />
                          </th>
                        ))}
                        <th className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider text-right cursor-pointer select-none group hover:text-brand transition-colors"
                          onClick={() => toggleSort(orderSort, 'totalPrice', setOrderSort)}>
                          {currentT.total}<SortIcon col="totalPrice" config={orderSort} />
                        </th>
                        <th className="px-6 py-4 font-bold text-gray-500 uppercase text-[10px] tracking-wider text-right">{currentT.actions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => {
                        const filtered = orders.filter(o =>
                          o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                          o.shopifyOrderId?.toLowerCase().includes(orderSearch.toLowerCase()) ||
                          o.shippingAddress?.toLowerCase().includes(orderSearch.toLowerCase())
                        );
                        const sorted = sortData(filtered, orderSort.key, orderSort.dir);
                        return sorted.length === 0 ? (
                          <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">{currentT.no_orders_found}</td></tr>
                        ) : sorted.map(order => (
                          <tr key={order.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setSelectedOrder(order)}>
                            <td className="px-6 py-4 font-medium text-[#1D2226]">{order.shopifyOrderId}</td>
                            <td className="px-6 py-4 text-gray-600">{order.customerName}</td>
                            <td className="px-6 py-4 text-gray-500">
                              {order.syncedAt ? (typeof (order.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (order.syncedAt as { toDate: () => Date }).toDate() : new Date(order.syncedAt as unknown as string | number | Date)).toLocaleDateString() : 'Unknown Date'}
                            </td>
                            <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                              <select value={order.status} onChange={(e) => {
                                e.stopPropagation(); openConfirm({
                                  title: currentT.status,
                                  message: `Update status to "${e.target.value}"?`,
                                  onConfirm: () => handleUpdateOrderStatus(order.id, e.target.value as Order['status'])
                                });
                              }}
                                className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded-full outline-none cursor-pointer appearance-none",
                                  order.status === 'Pending' ? "bg-amber-50 text-amber-600" :
                                    order.status === 'Processing' ? "bg-purple-50 text-purple-600" :
                                      order.status === 'Shipped' ? "bg-blue-50 text-blue-600" :
                                        order.status === 'Delivered' ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-600"
                                )}>
                                <option value="Pending">{currentT.pending}</option>
                                <option value="Processing">{currentT.processing}</option>
                                <option value="Shipped">{currentT.shipped}</option>
                                <option value="Delivered">{currentT.delivered}</option>
                                <option value="Cancelled">{currentT.cancelled}</option>
                              </select>
                            </td>
                            <td className="px-6 py-4 text-right font-bold text-[#1D2226]">
                              <div>₺{order.totalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                              {order.faturali ? (
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${order.faturaTipi==='ihracat' ? 'bg-blue-100 text-blue-600' : order.faturaTipi==='e-arsiv' ? 'bg-purple-100 text-purple-600' : 'bg-green-100 text-green-600'}`}>
                                  {order.faturaTipi ? order.faturaTipi.toUpperCase() : 'e-FATURA'} • KDV%{order.kdvOran ?? 0}
                                </span>
                              ) : (
                                <span className="text-[9px] font-bold bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">
                                  {currentLanguage === 'tr' ? 'FATURASIZ' : 'NO INVOICE'}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-2">
                                {order.status === 'Pending' && (
                                  <button onClick={() => openConfirm({
                                    title: currentT.confirm_approve_title,
                                    message: currentT.confirm_approve_msg,
                                    confirmLabel: currentT.approve,
                                    onConfirm: () => handleUpdateOrderStatus(order.id, 'Processing')
                                  })} className="text-emerald-500 hover:text-emerald-700 transition-colors" title={currentT.approve_order}>
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>
                                )}
                                {!order.hasInvoice && order.faturali !== false && (
                                  <button
                                    onClick={() => setActiveTab('muhasebe')}
                                    className="text-xs font-bold px-2 py-1 bg-brand/10 text-brand hover:bg-brand hover:text-white rounded-lg transition-all flex items-center gap-1"
                                    title={currentLanguage==='tr'?'Fatura Kes':'Create Invoice'}
                                  >
                                    <FileText className="w-3.5 h-3.5"/>
                                    {currentLanguage==='tr'?'Fatura Kes':'Invoice'}
                                  </button>
                                )}
                                {order.hasInvoice && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 bg-green-100 text-green-600 rounded-full flex items-center gap-0.5">
                                    <CheckCircle2 className="w-3 h-3"/>{currentLanguage==='tr'?'Faturalı':'Invoiced'}
                                  </span>
                                )}
                                <button onClick={() => openConfirm({
                                  title: currentT.confirm_delete_title,
                                  message: currentT.confirm_delete,
                                  confirmLabel: currentT.delete,
                                  variant: 'danger',
                                  onConfirm: () => handleDeleteOrder(order.id)
                                })} className="text-gray-400 hover:text-red-600 transition-colors" title={currentT.delete_order}>
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-4">
                {sortData(orders.filter(o =>
                  o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                  o.shopifyOrderId?.toLowerCase().includes(orderSearch.toLowerCase()) ||
                  o.shippingAddress?.toLowerCase().includes(orderSearch.toLowerCase())
                ), orderSort.key, orderSort.dir).map(order => (
                  <div key={order.id} className="apple-card p-4 space-y-3" onClick={() => setSelectedOrder(order)}>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold text-sm text-[#1D2226]">{order.shopifyOrderId}</p>
                        <p className="text-xs text-gray-500">{order.customerName}</p>
                      </div>
                      <span className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded-full",
                        order.status === 'Pending' ? "bg-amber-50 text-amber-600" :
                          order.status === 'Processing' ? "bg-purple-50 text-purple-600" :
                            order.status === 'Shipped' ? "bg-blue-50 text-blue-600" :
                              order.status === 'Delivered' ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-600"
                      )}>
                        {currentT[order.status.toLowerCase()] || order.status}
                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div className="text-xs text-gray-400">
                        {order.syncedAt ? (typeof (order.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (order.syncedAt as { toDate: () => Date }).toDate() : new Date(order.syncedAt as unknown as string | number | Date)).toLocaleDateString() : 'Unknown Date'}
                      </div>
                      <p className="font-bold text-brand">{order.totalPrice.toLocaleString()} TL</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Order Detail ── */}
          {activeTab === 'orders' && selectedOrder && (
            <motion.div key="order-detail" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setSelectedOrder(null)} className="text-gray-500 hover:text-gray-900 bg-white p-2 rounded-full shadow-sm border border-gray-200 shrink-0">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <ModuleHeader
                  title={`Order ${selectedOrder.shopifyOrderId}`}
                  subtitle={`Customer: ${selectedOrder.customerName}`}
                  className="mb-0 w-full"
                  actionButton={
                    <div className="flex gap-2">
                      {selectedOrder.status === 'Pending' && (
                        <button onClick={() => openConfirm({
                          title: currentT.confirm_approve_title,
                          message: currentT.confirm_approve_msg,
                          confirmLabel: currentT.approve,
                          onConfirm: () => { handleUpdateOrderStatus(selectedOrder.id, 'Processing'); setSelectedOrder({ ...selectedOrder, status: 'Processing' }); }
                        })}
                          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-emerald-200 transition-colors">
                          Approve
                        </button>
                      )}
                      <button onClick={() => openConfirm({
                        title: currentT.confirm_delete_title,
                        message: currentT.confirm_delete,
                        confirmLabel: currentT.edit,
                        onConfirm: () => { setEditingOrderData(selectedOrder); setIsEditingOrder(true); }
                      })} className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 transition-colors">
                        <Edit2 className="w-4 h-4" /> Edit
                      </button>
                      <button onClick={() => openConfirm({
                        title: currentT.confirm_delete_title,
                        message: currentT.confirm_delete,
                        confirmLabel: currentT.delete,
                        variant: 'danger',
                        onConfirm: () => { handleDeleteOrder(selectedOrder.id); setSelectedOrder(null); }
                      })} className="bg-white hover:bg-red-50 text-red-600 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 transition-colors">
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  }
                />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h3 className="font-bold mb-4">{currentT.order_details}</h3>
                    <div className="space-y-4 text-sm">
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold mb-1">{currentT.status}</span>
                        <select value={selectedOrder.status} onChange={(e) => openConfirm({
                          title: currentT.status,
                          message: `Update status to "${e.target.value}"?`,
                          onConfirm: () => { handleUpdateOrderStatus(selectedOrder.id, e.target.value as 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled'); setSelectedOrder({ ...selectedOrder, status: e.target.value as 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled' }); }
                        })}
                          className="block w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-brand font-medium">
                          <option value="Pending">{currentT.pending}</option>
                          <option value="Processing">{currentT.processing}</option>
                          <option value="Shipped">{currentT.shipped}</option>
                          <option value="Delivered">{currentT.delivered}</option>
                          <option value="Cancelled">{currentT.cancelled}</option>
                        </select>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">{currentT.total_price}</span>
                        <span className="font-bold text-lg">${selectedOrder.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">{currentT.tracking_number}</span>
                        <span className="font-medium">{selectedOrder.trackingNumber || '--'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">{currentT.shipping_address}</span>
                        <span className="font-medium">{selectedOrder.shippingAddress || '--'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">{currentT.date}</span>
                        <span className="font-medium">{selectedOrder.syncedAt ? (typeof (selectedOrder.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (selectedOrder.syncedAt as { toDate: () => Date }).toDate() : new Date(selectedOrder.syncedAt as unknown as string | number | Date)).toLocaleString() : currentT.unknown_date}</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h3 className="font-bold mb-4">{currentT.notes}</h3>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{selectedOrder.notes || currentT.no_notes_available}</p>
                  </div>
                </div>
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h3 className="font-bold mb-4 flex items-center gap-2">
                      <Package className="w-5 h-5 text-brand" /> {currentT.order_items}
                    </h3>
                    {selectedOrder.lineItems && selectedOrder.lineItems.length > 0 ? (
                      <div className="border border-gray-100 rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                              <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">{currentT.product}</th>
                              <th className="px-4 py-2 text-center text-[10px] font-bold text-gray-500 uppercase">{currentT.qty}</th>
                              <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-500 uppercase">{currentT.unit}</th>
                              <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-500 uppercase">{currentT.subtotal}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {selectedOrder.lineItems.map((item, idx) => (
                              <tr key={idx}>
                                <td className="px-4 py-3">
                                  <p className="font-bold text-[#1D2226]">{item.title}</p>
                                  {item.sku && <p className="text-[10px] text-gray-400">{item.sku}</p>}
                                </td>
                                <td className="px-4 py-3 text-center font-medium">{item.quantity}</td>
                                <td className="px-4 py-3 text-right text-gray-500">${item.price.toFixed(2)}</td>
                                <td className="px-4 py-3 text-right font-bold text-[#1D2226]">${(item.price * item.quantity).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="border-t border-gray-200 bg-gray-50">
                            <tr>
                              <td colSpan={3} className="px-4 py-3 font-bold text-gray-500 text-sm">{currentT.total}</td>
                              <td className="px-4 py-3 text-right text-lg font-bold text-brand">
                                ${selectedOrder.lineItems.reduce((s, l) => s + l.price * l.quantity, 0).toFixed(2)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-xl">
                        <Package className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                        <p className="text-sm text-gray-500 font-medium">{currentT.no_items_on_order}</p>
                        <p className="text-xs text-gray-400 mt-1">{currentT.product_picker_hint}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Lojistik & Depo ── */}
          {activeTab === 'lojistik' && (
            <motion.div key="lojistik" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              <ModuleHeader 
                title={currentLanguage === 'tr' ? 'Lojistik & Depo' : 'Logistics & Warehouse'} 
                subtitle={currentLanguage === 'tr' ? 'Sevkiyatlar, depo yönetimi ve transferler' : 'Shipments, warehouse management and transfers'}
                icon={Truck}
              />
              {/* Lojistik Sub-tabs */}
              <div className="overflow-x-auto scrollbar-none -mx-3 px-3">
                <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max mb-2">
                  {[
                    { id: 'sevkiyat', label: currentLanguage === 'tr' ? 'Sevkiyatlar' : 'Shipments', icon: Truck },
                    { id: 'kargo_takip', label: currentLanguage === 'tr' ? 'Kargo Takip' : 'Tracking', icon: Navigation },
                    { id: 'depo', label: currentLanguage === 'tr' ? 'Depo' : 'Warehouse', icon: Building2 },
                    { id: 'transfer', label: currentLanguage === 'tr' ? 'Depolar Arası' : 'Transfer', icon: ArrowRightLeft },
                    { id: 'giden_irsaliye', label: currentLanguage === 'tr' ? 'Giden İrsaliye' : 'Outgoing', icon: FileUp },
                    { id: 'gelen_irsaliye', label: currentLanguage === 'tr' ? 'Gelen İrsaliye' : 'Incoming', icon: FileDown },
                  ].map(tab => {
                    const Icon = tab.icon;
                    return (
                      <button key={tab.id} onClick={() => setLojistikTab(tab.id)}
                        className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${lojistikTab === tab.id ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}>
                        <Icon size={13} /><span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Kargo Takip ── */}
              {lojistikTab === 'kargo_takip' && (
                <CargoTrackingTab darkMode={darkMode} currentLanguage={currentLanguage} />
              )}
              {/* Lojistik sub-tab: Depo/Transfer/İrsaliye via AccountingModule */}
              {lojistikTab === 'depo' && (
                <AccountingModule orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} exchangeRates={exchangeRates} initialTab="depo" allowedTabs={['depo']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}
              {lojistikTab === 'transfer' && (
                <AccountingModule orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} exchangeRates={exchangeRates} initialTab="transfer" allowedTabs={['transfer']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}
              {lojistikTab === 'giden_irsaliye' && (
                <AccountingModule orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} exchangeRates={exchangeRates} initialTab="giden_irsaliye" allowedTabs={['giden_irsaliye']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}
              {lojistikTab === 'gelen_irsaliye' && (
                <AccountingModule orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} exchangeRates={exchangeRates} initialTab="gelen_irsaliye" allowedTabs={['gelen_irsaliye']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}

              {/* Lojistik sub-tab: Sevkiyatlar (existing logistics content) */}
              {lojistikTab === 'sevkiyat' && <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold">{currentT.logistics_tracking}</h2>
                  <p className="text-sm text-gray-500">{currentT.real_time_status}</p>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <div className="apple-card px-4 py-2 flex items-center gap-2 text-sm w-full sm:w-auto">
                    <Search className="w-4 h-4 text-gray-400" />
                    <input type="text" placeholder={currentT.search_tracking} className="bg-transparent outline-none w-full sm:w-40" />
                  </div>
                </div>
              </div>

              {/* ── Route Optimizer Panel ── */}
              <div className="apple-card overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-brand/5 to-transparent">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-brand rounded-lg flex items-center justify-center shrink-0">
                      <Route className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">{currentT.route_optimization}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[11px] text-gray-500">{currentT.start_point}</p>
                        <select
                          value={selectedDepot}
                          onChange={(e) => setSelectedDepot(e.target.value as 'eski_sanayi' | 'havalimani')}
                          className="text-[11px] font-bold text-brand bg-transparent border-none p-0 focus:ring-0 outline-none cursor-pointer"
                        >
                          <option value="eski_sanayi">Antalya (Eski Sanayi)</option>
                          <option value="havalimani">Antalya (Havalimanı)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {isRouteOptimized && (
                      <button onClick={handleClearRoute} className="apple-button-secondary">
                        {currentT.clear_route_btn}
                      </button>
                    )}
                    <button onClick={handleBuildRoute} className="apple-button-primary">
                      <Navigation className="w-4 h-4" />
                      {isRouteOptimized ? currentT.reoptimize_route_btn : currentT.optimize_route_btn}
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Past Shipments ── */}
              <div className="apple-card overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-bold text-sm">Geçmiş Sevkiyatlar</h3>
                  <button onClick={() => { setEditingShipmentId(null); setNewShipment({ status: 'Pending' }); setIsAddingShipment(true); }} className="apple-button-primary text-xs py-1.5 px-3">
                    <Plus className="w-3.5 h-3.5" /> Sevkiyat Ekle
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="apple-table">
                    <thead>
                      <tr>
                        {[
                          { key: 'customerName', label: 'Müşteri' },
                          { key: 'destination', label: 'Varış' },
                          { key: 'driver', label: 'Sürücü' },
                          { key: 'cargoFirm', label: 'Kargo' },
                          { key: 'date', label: 'Tarih' },
                          { key: 'status', label: 'Durum' },
                          { key: 'trackingNo', label: 'Takip No' },
                        ].map(col => (
                          <th key={col.key}
                            className="cursor-pointer select-none group hover:text-brand transition-colors whitespace-nowrap"
                            onClick={() => toggleSort(shipmentSort, col.key, setShipmentSort)}>
                            {col.label}<SortIcon col={col.key} config={shipmentSort} />
                          </th>
                        ))}
                        <th>İşlemler</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortData(shipments, shipmentSort.key, shipmentSort.dir).map(shipment => (
                        <tr key={shipment.id} className="hover:bg-gray-50">
                          <td className="font-bold">{shipment.customerName}</td>
                          <td>{shipment.destination}</td>
                          <td>{shipment.driver}</td>
                          <td>{shipment.cargoFirm}</td>
                          <td>{shipment.date}</td>
                          <td>
                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${shipment.status === 'Delivered' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                              {shipment.status}
                            </span>
                          </td>
                          <td className="font-mono text-xs">{shipment.trackingNo}</td>
                          <td className="flex gap-2">
                            <button onClick={() => handleEditShipment(shipment)} className="action-btn-edit"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => handleDeleteShipment(shipment.id)} className="action-btn-delete"><Trash2 className="w-4 h-4" /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="apple-card overflow-hidden">
                {isRouteOptimized && routeStops.length > 0 && (
                  <div className="p-4">
                    {/* Summary stats */}
                    <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
                      <div className="bg-gray-50 rounded-lg p-2 sm:p-3 text-center">
                        <p className="text-[9px] sm:text-[10px] text-gray-500 uppercase font-bold">{currentT.total_stops}</p>
                        <p className="text-lg sm:text-xl font-bold text-brand">{routeStops.length}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 sm:p-3 text-center">
                        <p className="text-[9px] sm:text-[10px] text-gray-500 uppercase font-bold">{currentT.estimated_time}</p>
                        <p className="text-lg sm:text-xl font-bold text-[#1D2226]">
                          {routeStops.length > 0 ? `${Math.round(routeStops[routeStops.length - 1].estimatedMinutes / 60)}s ${routeStops[routeStops.length - 1].estimatedMinutes % 60}d` : '--'}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 sm:p-3 text-center">
                        <p className="text-[9px] sm:text-[10px] text-gray-500 uppercase font-bold">{currentT.algorithm}</p>
                        <p className="text-[10px] sm:text-sm font-bold text-gray-700">{currentT.nearest_neighbor}</p>
                      </div>
                    </div>

                    {/* Drag-and-drop stop list */}
                    <p className="text-[11px] text-gray-400 mb-3 flex items-center gap-1">
                      <GripVertical className="w-3 h-3" /> {currentT.drag_to_reorder}
                    </p>
                    <div className="space-y-2">
                      {/* Depot (start) */}
                      <div className="flex items-center gap-3 p-3 bg-brand/5 border border-brand/20 rounded-lg">
                        <div className="w-7 h-7 bg-brand rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">D</div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm">{currentT.depot} — {DEPOTS[selectedDepot].name}</p>
                          <p className="text-[10px] text-gray-400 truncate">{currentT.starting_point} • {DEPOTS[selectedDepot].lat.toFixed(4)}°N, {DEPOTS[selectedDepot].lng.toFixed(4)}°E</p>
                        </div>
                        <span className="text-[10px] font-bold text-brand shrink-0">00:00</span>
                      </div>

                      {routeStops.map((stop, idx) => (
                        <div
                          key={stop.orderId}
                          draggable
                          onDragStart={() => handleDragStart(idx)}
                          onDragOver={(e) => handleDragOver(e, idx)}
                          onDragEnd={handleDragEnd}
                          className={cn(
                            "flex items-center gap-3 p-3 border rounded-lg cursor-grab active:cursor-grabbing transition-all",
                            dragIndex === idx ? "border-brand bg-brand/5 shadow-md scale-[1.01]" : "border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm"
                          )}
                        >
                          <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
                          <div className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
                            {stop.sequence}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm truncate">{stop.customerName}</p>
                            <p className="text-[10px] text-gray-400 truncate">{stop.address}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded mb-1 block",
                              stop.status === 'Pending' ? "bg-amber-50 text-amber-600" :
                                stop.status === 'Processing' ? "bg-purple-50 text-purple-600" :
                                  stop.status === 'Shipped' ? "bg-blue-50 text-blue-600" :
                                    "bg-emerald-50 text-emerald-600"
                            )}>
                              {currentT[stop.status.toLowerCase()] || stop.status}
                            </span>
                            <p className="text-[10px] font-bold text-brand">
                              +{stop.estimatedMinutes >= 60
                                ? `${Math.floor(stop.estimatedMinutes / 60)}s ${stop.estimatedMinutes % 60}d`
                                : `${stop.estimatedMinutes}d`}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!isRouteOptimized && (
                  <div className="p-8 text-center text-gray-400">
                    <Route className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                    <p className="text-sm font-medium">{currentLanguage === 'tr' ? 'Tüm aktif siparişler için en verimli teslimat sırasını hesaplamak için "Rotayı Optimize Et"e tıklayın.' : 'Click "Optimize Route" to calculate the most efficient delivery sequence for all active orders.'}</p>
                  </div>
                )}
              </div>

              {/* Map + Shipments */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 order-2 lg:order-1">
                  <LogisticsMap orders={orders} routeStops={routeStops} depot={DEPOTS[selectedDepot]} currentT={currentT} />
                </div>
                <div className="apple-card flex flex-col order-1 lg:order-2">
                  <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-bold text-sm">{currentT.active_shipments}</h3>
                    <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {orders.filter(o => o.status === 'Shipped').length} {currentT.on_the_way}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[400px] lg:max-h-[520px] p-2 space-y-2">
                    {orders.length === 0 ? (
                      <div className="p-8 text-center text-gray-400 text-sm">{currentT.no_active_orders_found}</div>
                    ) : (
                      orders.map(order => {
                        const routeStop = routeStops.find(s => s.orderId === order.id);
                        return (
                          <div key={order.id} className="p-3 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100 cursor-pointer">
                            <div className="flex justify-between items-start mb-1">
                              <h4 className="font-bold text-xs">{order.customerName}</h4>
                              <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded",
                                order.status === 'Pending' ? "bg-amber-50 text-amber-600" :
                                  order.status === 'Processing' ? "bg-purple-50 text-purple-600" :
                                    order.status === 'Shipped' ? "bg-blue-50 text-blue-600" :
                                      order.status === 'Delivered' ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-600"
                              )}>
                                {currentT[order.status.toLowerCase()] || order.status}
                              </span>
                            </div>
                            <p className="text-[10px] text-gray-500">ID: {order.shopifyOrderId}</p>
                            {routeStop && (
                              <p className="text-[10px] font-bold text-brand mt-1">{currentT.stop} #{routeStop.sequence} • ETA +{routeStop.estimatedMinutes}d</p>
                            )}
                            <div className="flex items-center gap-1 mt-2 text-[10px] text-gray-400">
                              <MapPin className="w-3 h-3 shrink-0" />
                              <span className="truncate">{order.shippingAddress}</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
              </>}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Confirm Modal (replaces PIN modal + window.confirm) ── */}
      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
        onConfirm={() => { confirmState.onConfirm(); closeConfirm(); }}
        onCancel={closeConfirm}
      />

      {/* ── Add Lead Modal ── */}
      <AnimatePresence>
        {isAddingLead && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !isScoring && setIsAddingLead(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white w-full max-w-lg rounded-2xl shadow-2xl relative z-10 overflow-hidden border border-gray-200">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xl font-bold">{currentT.add_new_sales_lead}</h3>
                <button onClick={() => !isScoring && setIsAddingLead(false)} className="text-gray-400 hover:text-gray-600"><Plus className="w-6 h-6 rotate-45" /></button>
              </div>
              <form onSubmit={handleAddLead} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.contact_name}</label>
                    <input required value={newLead.name} onChange={e => setNewLead({ ...newLead, name: e.target.value })}
                      className="apple-input" placeholder="Ahmet Yılmaz" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.company}</label>
                    <input required value={newLead.company} onChange={e => setNewLead({ ...newLead, company: e.target.value })}
                      className="apple-input" placeholder="ABC Ticaret A.Ş." />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.email}</label>
                    <input type="email" value={newLead.email} onChange={e => setNewLead({ ...newLead, email: e.target.value })}
                      className="apple-input" placeholder="ornek@sirket.com" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.phone}</label>
                    <input value={newLead.phone} onChange={e => setNewLead({ ...newLead, phone: e.target.value })}
                      className="apple-input" placeholder="+90 555..." />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.notes}</label>
                  <textarea value={newLead.notes} onChange={e => setNewLead({ ...newLead, notes: e.target.value })} rows={3}
                    className="apple-input resize-none" placeholder={currentT.describe_lead_interest} />
                </div>
                <button disabled={isScoring} type="submit"
                  className="apple-button-primary w-full mt-4">
                  {isScoring ? (<><Clock className="w-4 h-4 animate-spin" />{currentT.ai_scoring_in_progress}</>) : currentT.create_lead_and_score}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Add Order Modal ── */}
      <AnimatePresence>
        {isAddingOrder && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { if (!isPushingToShopify) { setIsAddingOrder(false); setOrderLineItems([]); setShowProductPicker(false); } }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl relative z-10 overflow-hidden border border-gray-200 max-h-[90vh] flex flex-col">

              {/* Header */}
              <div className="p-6 border-b border-gray-100 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-xl font-bold">{selectedLead ? `${currentT.new_order} — ${selectedLead.name}` : currentT.create_new_order}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{currentT.products_pulled_from_shopify}</p>
                </div>
                <button onClick={() => { if (!isPushingToShopify) { setIsAddingOrder(false); setOrderLineItems([]); setShowProductPicker(false); } }}
                  className="text-gray-400 hover:text-gray-600"><Plus className="w-6 h-6 rotate-45" /></button>
              </div>

              <form onSubmit={handleAddOrder} className="flex flex-col flex-1 overflow-hidden">
                <div className="overflow-y-auto flex-1 p-6 space-y-5">

                  {/* Customer */}
                  {!selectedLead && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.customer_name}</label>
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        <input
                          type="text"
                          value={newOrder.customerName || ''}
                          onChange={e => {
                            setNewOrder({ ...newOrder, customerName: e.target.value, shippingAddress: newOrder.shippingAddress });
                            setOrderCustomerSearch(e.target.value);
                            setOrderCustomerOpen(true);
                          }}
                          onFocus={() => setOrderCustomerOpen(true)}
                          onBlur={() => setTimeout(() => setOrderCustomerOpen(false), 200)}
                          className="apple-input pl-9"
                          placeholder={currentLanguage === 'tr' ? 'Müşteri ara veya yaz...' : 'Search or type customer...'}
                        />
                        {orderCustomerOpen && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto">
                            {leads.filter(l =>
                              !orderCustomerSearch ||
                              l.name.toLowerCase().includes(orderCustomerSearch.toLowerCase()) ||
                              l.company?.toLowerCase().includes(orderCustomerSearch.toLowerCase())
                            ).slice(0, 8).map(lead => (
                              <button key={lead.id} type="button"
                                onMouseDown={() => {
                                  const isEFatura = lead.customerType === 'B2B' || (lead.taxId && lead.taxId.length >= 10);
                                  setNewOrder({ 
                                    ...newOrder, 
                                    customerName: lead.name, 
                                    shippingAddress: lead.company || '',
                                    faturali: true,
                                    faturaTipi: isEFatura ? 'e-fatura' : 'e-arsiv'
                                  });
                                  setOrderCustomerSearch(lead.name);
                                  setOrderCustomerOpen(false);
                                  setSelectedLead(lead);
                                }}
                                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                                <p className="text-sm font-semibold text-[#1D1D1F]">{lead.name}</p>
                                <p className="text-[11px] text-[#86868B]">{lead.company} • {lead.email}</p>
                              </button>
                            ))}
                            {leads.length === 0 && (
                              <p className="px-4 py-3 text-xs text-[#86868B]">{currentLanguage === 'tr' ? 'Henüz müşteri yok' : 'No customers yet'}</p>
                            )}
                            <button type="button"
                              onMouseDown={() => { setOrderCustomerOpen(false); setIsAddingLead(true); }}
                              className="w-full text-left px-4 py-2.5 text-xs font-bold text-brand hover:bg-brand/5 flex items-center gap-2">
                              <Plus className="w-3.5 h-3.5" />
                              {currentLanguage === 'tr' ? 'Yeni müşteri ekle' : 'Add new customer'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Product Picker ── */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.products_line_items}</label>
                      <div className="flex items-center gap-3">
                        {orderLineItems.length > 0 && (
                          <button type="button" onClick={() => setOrderLineItems([])}
                            className="text-gray-400 text-[10px] font-bold hover:text-red-500 transition-colors">
                            {currentT.clear_all}
                          </button>
                        )}
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setIsOrderScannerOpen(true)}
                            className="text-gray-500 text-xs font-bold flex items-center gap-1 hover:text-brand hover:underline transition-colors">
                            <Scan className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Tara' : 'Scan'}
                          </button>
                          <button type="button" onClick={() => setShowProductPicker(!showProductPicker)}
                            className="text-brand text-xs font-bold flex items-center gap-1 hover:underline">
                            <Plus className="w-3.5 h-3.5" /> {currentT.add_product}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Order barcode scanner */}
                    <BarcodeScanner
                      isOpen={isOrderScannerOpen}
                      onClose={() => setIsOrderScannerOpen(false)}
                      currentLanguage={currentLanguage as 'tr' | 'en'}
                      title={currentLanguage === 'tr' ? 'Ürün Barkodu Tara' : 'Scan Product Barcode'}
                      onScan={(barcode) => {
                        const match = inventory.find(i => i.sku === barcode || i.sku.toLowerCase() === barcode.toLowerCase() || i.name.toLowerCase().includes(barcode.toLowerCase()));
                        if (match) handleAddLineItem(match);
                        else setProductSearch(barcode);
                        setShowProductPicker(true);
                      }}
                    />

                    {/* Inventory search dropdown */}
                    {showProductPicker && (
                      <div className="border border-gray-200 rounded-xl overflow-hidden shadow-lg">
                        <div className="p-3 border-b border-gray-100 bg-gray-50">
                          <div className="flex items-center gap-2">
                            <Search className="w-4 h-4 text-gray-400 shrink-0" />
                            <input autoFocus type="text" placeholder={currentT.search_products} value={productSearch}
                              onChange={e => setProductSearch(e.target.value)}
                              className="flex-1 bg-transparent outline-none text-sm" />
                          </div>
                        </div>
                        <div className="max-h-52 overflow-y-auto">
                          {inventory.length === 0 ? (
                            <div className="p-6 text-center text-sm text-gray-400">
                              <Package className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                              {currentT.no_inventory_synced}{' '}
                              <button type="button" onClick={() => { setIsAddingOrder(false); setActiveTab('inventory'); }}
                                className="text-brand font-bold hover:underline">{currentT.go_sync_shopify}</button>
                            </div>
                          ) : (
                            inventory
                              .filter(item => item.name.toLowerCase().includes(productSearch.toLowerCase()) || item.sku.toLowerCase().includes(productSearch.toLowerCase()))
                              .map(item => (
                                <button key={item.id} type="button" onClick={() => handleAddLineItem(item)}
                                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0">
                                  <div>
                                    <p className="font-bold text-sm text-[#1D2226]">{item.name}</p>
                                    <p className="text-[10px] text-gray-400">{item.sku} • Stock: {item.stockLevel}</p>
                                  </div>
                                  <div className="text-right shrink-0 ml-4">
                                    <p className="font-bold text-sm text-brand">${item.price.toFixed(2)}</p>
                                    {item.stockLevel <= item.lowStockThreshold && (
                                      <span className="text-[9px] font-bold text-red-500 uppercase">Low Stock</span>
                                    )}
                                  </div>
                                </button>
                              ))
                          )}
                        </div>
                      </div>
                    )}

                    {/* Selected line items */}
                    {orderLineItems.length > 0 ? (
                      <div className="border border-gray-200 rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                              <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Product</th>
                              <th className="px-4 py-2 text-center text-[10px] font-bold text-gray-500 uppercase">Price</th>
                              <th className="px-4 py-2 text-center text-[10px] font-bold text-gray-500 uppercase">Qty</th>
                              <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-500 uppercase">Total</th>
                              <th className="px-2 py-2"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {orderLineItems.map((item, idx) => (
                              <tr key={idx}>
                                <td className="px-4 py-2.5">
                                  <p className="font-bold text-[#1D2226]">{item.title}</p>
                                  <p className="text-[10px] text-gray-400">{item.sku}</p>
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center justify-center gap-1">
                                    <span className="text-gray-400 text-xs">$</span>
                                    <input type="number" step="0.01" value={item.price} onChange={e => handleUpdateLineItemPrice(idx, parseFloat(e.target.value) || 0)}
                                      className="w-16 text-center font-bold text-sm bg-gray-50 border border-gray-100 rounded px-1 py-0.5 focus:ring-0" />
                                  </div>
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center justify-center gap-1">
                                    <button type="button" onClick={() => handleUpdateLineItemQty(idx, item.quantity - 1)}
                                      className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold text-sm leading-none">−</button>
                                    <input type="number" value={item.quantity} onChange={e => handleUpdateLineItemQty(idx, parseInt(e.target.value) || 0)}
                                      className="w-10 text-center font-bold text-sm bg-transparent border-none focus:ring-0 p-0" />
                                    <button type="button" onClick={() => handleUpdateLineItemQty(idx, item.quantity + 1)}
                                      className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold text-sm leading-none">+</button>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-right font-bold text-[#1D2226]">
                                  ${(item.price * item.quantity).toFixed(2)}
                                </td>
                                <td className="px-2 py-2.5">
                                  <button type="button" onClick={() => setOrderLineItems(orderLineItems.filter((_, i) => i !== idx))}
                                    className="text-gray-300 hover:text-red-500 transition-colors">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="border-t border-gray-200 bg-gray-50">
                            <tr>
                              <td colSpan={2} className="px-4 py-3 text-sm font-bold text-gray-500">{currentT.order_total}</td>
                              <td className="px-4 py-3 text-right text-lg font-bold text-brand">${computedTotal.toFixed(2)}</td>
                              <td></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ) : (
                      <div className="border-2 border-dashed border-gray-100 rounded-xl p-6 text-center text-gray-400 text-sm">
                        <Package className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                        {currentT.no_products_added}
                      </div>
                    )}
                  </div>

                  {/* Status + Address */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.status}</label>
                      <select value={newOrder.status} onChange={e => setNewOrder({ ...newOrder, status: e.target.value as 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled' })}
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors">
                        <option value="Pending">{currentT.pending}</option>
                        <option value="Processing">{currentT.processing}</option>
                        <option value="Shipped">{currentT.shipped}</option>
                        <option value="Delivered">{currentT.delivered}</option>
                        <option value="Cancelled">{currentT.cancelled}</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.shipping_address}</label>
                      <input type="text" value={newOrder.shippingAddress || ''} onChange={e => setNewOrder({ ...newOrder, shippingAddress: e.target.value })}
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" placeholder={currentT.city_district} />
                    </div>
                  </div>

                  {/* Fatura / KDV Seçimi */}
                  <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-gray-700">{currentLanguage === 'tr' ? 'Faturalı Satış' : 'Invoice Required'}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{currentLanguage === 'tr' ? 'Kapalı = faturasız sevk, KDV yok' : 'Off = shipped without invoice, no VAT'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNewOrder(prev => ({ ...prev, faturali: !prev.faturali, kdvOran: !prev.faturali ? 20 : 0 }))}
                        className={cn(
                          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
                          newOrder.faturali ? 'bg-brand' : 'bg-gray-300'
                        )}
                      >
                        <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', newOrder.faturali ? 'translate-x-6' : 'translate-x-1')} />
                      </button>
                    </div>
                    {newOrder.faturali && (
                      <div className="space-y-3">
                        {/* Invoice Type */}
                        <div>
                          <label className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 block">{currentLanguage === 'tr' ? 'Fatura Türü' : 'Invoice Type'}</label>
                          <div className="grid grid-cols-3 gap-2">
                            {([
                              { value: 'e-fatura', label: 'e-Fatura', desc: currentLanguage==='tr'?'Kayıtlı mükellef':'Registered taxpayer' },
                              { value: 'e-arsiv', label: 'e-Arşiv', desc: currentLanguage==='tr'?'Kayıtsız / bireysel':'Unregistered / individual' },
                              { value: 'ihracat', label: currentLanguage==='tr'?'İhracat':'Export', desc: currentLanguage==='tr'?'Yurt dışı satış':'International sale' },
                            ] as const).map(type => (
                              <button key={type.value} type="button"
                                onClick={() => setNewOrder(prev => ({ ...prev, faturaTipi: type.value } as Order & {faturaTipi?: string}))}
                                className={cn('p-2 rounded-xl border text-left transition-all',
                                  (newOrder as Order & {faturaTipi?: string}).faturaTipi === type.value ? 'border-brand bg-brand/5' : 'border-gray-200 hover:border-gray-300'
                                )}>
                                <p className={`text-[10px] font-bold ${(newOrder as Order & {faturaTipi?: string}).faturaTipi === type.value ? 'text-brand' : 'text-gray-700'}`}>{type.label}</p>
                                <p className="text-[9px] text-gray-400 leading-tight mt-0.5">{type.desc}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase">{currentLanguage === 'tr' ? 'KDV Oranı' : 'VAT Rate'}</label>
                            {orderLineItems.length > 0 && (
                              <span className="text-[9px] font-bold text-brand bg-brand/10 px-1.5 py-0.5 rounded-full">
                                ↑ {currentLanguage === 'tr' ? 'üründen otomatik' : 'auto from product'}
                              </span>
                            )}
                          </div>
                          {/* Dropdown — auto from product, manual override */}
                          <select
                            value={newOrder.kdvOran ?? 20}
                            onChange={e => setNewOrder(prev => ({ ...prev, kdvOran: Number(e.target.value) }))}
                            className="apple-input w-full mb-2 text-sm font-bold text-gray-700"
                          >
                            {[0, 1, 8, 10, 18, 20].map(rate => (
                              <option key={rate} value={rate}>
                                {'%' + rate + ' KDV' + (rate === 0 ? ' — İstisna/İhracat' : rate === 1 ? ' — Temel Gıda' : rate === 8 ? ' — İndirimli' : rate === 20 ? ' — Genel Oran' : '')}
                              </option>
                            ))}
                          </select>
                          {/* Quick-pick buttons */}
                          <div className="flex gap-1.5">
                            {[0, 1, 8, 10, 18, 20].map(rate => (
                              <button
                                key={rate}
                                type="button"
                                onClick={() => setNewOrder(prev => ({ ...prev, kdvOran: rate }))}
                                className={cn(
                                  'flex-1 py-1 rounded-lg text-[10px] font-bold transition-colors',
                                  newOrder.kdvOran === rate ? 'bg-brand text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-500 hover:border-brand hover:text-brand'
                                )}
                              >
                                %{rate}
                              </button>
                            ))}
                          </div>
                        </div>
                        {orderLineItems.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-200 space-y-0.5 text-xs text-gray-500">
                            <div className="flex justify-between">
                              <span>{currentLanguage === 'tr' ? 'Matrah (KDV hariç)' : 'Net (excl. VAT)'}</span>
                              <span className="font-semibold">₺{(computedTotal / (1 + (newOrder.kdvOran || 0) / 100)).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex justify-between text-brand">
                              <span>KDV %{newOrder.kdvOran || 0}</span>
                              <span className="font-semibold">₺{(computedTotal - computedTotal / (1 + (newOrder.kdvOran || 0) / 100)).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex justify-between font-bold text-gray-800 pt-0.5">
                              <span>{currentLanguage === 'tr' ? 'Toplam' : 'Total'}</span>
                              <span>₺{computedTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.notes}</label>
                    <textarea value={newOrder.notes || ''} onChange={e => setNewOrder({ ...newOrder, notes: e.target.value })} rows={2}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors resize-none" placeholder={currentT.add_notes} />
                  </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 shrink-0 space-y-2">
                  {/* Fatura özeti */}
                  {newOrder.faturali ? (
                    <div className="flex items-center justify-center gap-2 text-[10px] font-bold text-green-600 bg-green-50 rounded-lg py-1.5">
                      <FileText className="w-3 h-3" />
                      {currentLanguage === 'tr' ? `Faturalı • KDV %${newOrder.kdvOran || 0}` : `Invoiced • VAT %${newOrder.kdvOran || 0}`}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2 text-[10px] font-bold text-gray-400 bg-gray-50 rounded-lg py-1.5">
                      <FileText className="w-3 h-3" />
                      {currentLanguage === 'tr' ? 'Faturasız sevkiyat — KDV yok' : 'Shipped without invoice — no VAT'}
                    </div>
                  )}
                  {orderLineItems.length > 0 && (
                    <p className="text-[11px] text-center text-gray-400 flex items-center justify-center gap-1">
                      <RefreshCw className="w-3 h-3" />
                      {currentT.create_draft_order_shopify}
                    </p>
                  )}
                  <button type="submit" disabled={isPushingToShopify}
                    className="apple-button-primary w-full">
                    {isPushingToShopify ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> {currentT.saving_and_pushing}</>
                    ) : (
                      <>{currentT.create_order} {orderLineItems.length > 0 && `• $${computedTotal.toFixed(2)}`}</>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Add Shipment Modal ── */}
      <AnimatePresence>
        {isAddingShipment && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setIsAddingShipment(false); setEditingShipmentId(null); setNewShipment({ status: 'Pending' }); }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white w-full max-w-lg rounded-2xl shadow-2xl relative z-10 overflow-hidden border border-gray-200">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xl font-bold">{editingShipmentId ? 'Sevkiyatı Düzenle' : 'Sevkiyat Ekle'}</h3>
                <button onClick={() => { setIsAddingShipment(false); setEditingShipmentId(null); setNewShipment({ status: 'Pending' }); }} className="text-gray-400 hover:text-gray-600"><Plus className="w-6 h-6 rotate-45" /></button>
              </div>
              <form onSubmit={handleAddShipment} className="p-6 space-y-4">
                {/* Customer picker with address auto-fill */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase">Müşteri Seç</label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      value={shipmentCustomerSearch}
                      placeholder="Müşteri ara..."
                      onChange={e => { setShipmentCustomerSearch(e.target.value); setShipmentCustomerOpen(true); }}
                      onFocus={() => setShipmentCustomerOpen(true)}
                      onBlur={() => setTimeout(() => setShipmentCustomerOpen(false), 200)}
                      className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-brand transition-colors"
                    />
                    {shipmentCustomerOpen && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-20 max-h-44 overflow-y-auto">
                        {leads.filter(l => !shipmentCustomerSearch || l.name.toLowerCase().includes(shipmentCustomerSearch.toLowerCase()) || l.company?.toLowerCase().includes(shipmentCustomerSearch.toLowerCase())).slice(0, 6).map(lead => (
                          <button key={lead.id} type="button"
                            onMouseDown={() => {
                              setNewShipment({ ...newShipment, customerName: lead.name, destination: lead.company || '' });
                              setShipmentCustomerSearch(lead.name);
                              setShipmentCustomerOpen(false);
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0">
                            <p className="text-sm font-semibold">{lead.name}</p>
                            <p className="text-[11px] text-[#86868B]">{lead.company} • {lead.phone}</p>
                          </button>
                        ))}
                        {leads.length === 0 && <p className="px-4 py-3 text-xs text-[#86868B]">Henüz müşteri yok</p>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Müşteri Adı</label>
                    <input required value={newShipment.customerName || ''} onChange={e => setNewShipment({ ...newShipment, customerName: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Varış</label>
                    <input required value={newShipment.destination || ''} onChange={e => setNewShipment({ ...newShipment, destination: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Sürücü</label>
                    <input required value={newShipment.driver || ''} onChange={e => setNewShipment({ ...newShipment, driver: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Kargo Firması</label>
                    <input required value={newShipment.cargoFirm || ''} onChange={e => setNewShipment({ ...newShipment, cargoFirm: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Tarih</label>
                    <input required type="date" value={newShipment.date || ''} onChange={e => setNewShipment({ ...newShipment, date: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Durum</label>
                    <select value={newShipment.status} onChange={e => setNewShipment({ ...newShipment, status: e.target.value as 'Pending' | 'In Transit' | 'Delivered' | 'Cancelled' })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors">
                      <option value="Pending">Pending</option>
                      <option value="In Transit">In Transit</option>
                      <option value="Delivered">Delivered</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase">Takip No</label>
                  <input required value={newShipment.trackingNo || ''} onChange={e => setNewShipment({ ...newShipment, trackingNo: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
                </div>
                <button type="submit" className="apple-button-primary w-full mt-4">
                  {editingShipmentId ? 'Değişiklikleri Kaydet' : 'Sevkiyat Ekle'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Edit Lead Modal ── */}
      <AnimatePresence>
        {isEditingLead && selectedLead && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsEditingLead(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white w-full max-w-lg rounded-2xl shadow-2xl relative z-10 overflow-hidden border border-gray-200">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xl font-bold">{currentT.edit_lead}</h3>
                <button onClick={() => setIsEditingLead(false)} className="text-gray-400 hover:text-gray-600"><Plus className="w-6 h-6 rotate-45" /></button>
              </div>
              <form onSubmit={handleEditLead} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.contact_name}</label>
                    <input required value={editingLeadData.name || ''} onChange={e => setEditingLeadData({ ...editingLeadData, name: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.company}</label>
                    <input required value={editingLeadData.company || ''} onChange={e => setEditingLeadData({ ...editingLeadData, company: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.email}</label>
                    <input type="email" value={editingLeadData.email || ''} onChange={e => setEditingLeadData({ ...editingLeadData, email: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.phone}</label>
                    <input value={editingLeadData.phone || ''} onChange={e => setEditingLeadData({ ...editingLeadData, phone: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.notes}</label>
                  <textarea value={editingLeadData.notes || ''} onChange={e => setEditingLeadData({ ...editingLeadData, notes: e.target.value })} rows={3}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors resize-none" />
                </div>
                <button type="submit" className="apple-button-primary w-full mt-4">
                  {currentT.save_changes}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Edit Order Modal ── */}
      <AnimatePresence>
        {isEditingOrder && selectedOrder && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsEditingOrder(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white w-full max-w-lg rounded-2xl shadow-2xl relative z-10 overflow-hidden border border-gray-200">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xl font-bold">{currentT.edit_order}</h3>
                <button onClick={() => setIsEditingOrder(false)} className="text-gray-400 hover:text-gray-600"><Plus className="w-6 h-6 rotate-45" /></button>
              </div>
              <form onSubmit={handleEditOrder} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.customer_name}</label>
                    <input required value={editingOrderData.customerName || ''} onChange={e => setEditingOrderData({ ...editingOrderData, customerName: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.total_price}</label>
                    <input required type="number" step="0.01" value={editingOrderData.totalPrice || ''} onChange={e => setEditingOrderData({ ...editingOrderData, totalPrice: parseFloat(e.target.value) })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.tracking_number}</label>
                    <input value={editingOrderData.trackingNumber || ''} onChange={e => setEditingOrderData({ ...editingOrderData, trackingNumber: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.status}</label>
                    <select value={editingOrderData.status || 'Pending'} onChange={e => setEditingOrderData({ ...editingOrderData, status: e.target.value as Order['status'] })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors">
                      <option value="Pending">{currentT.pending}</option>
                      <option value="Processing">{currentT.processing}</option>
                      <option value="Shipped">{currentT.shipped}</option>
                      <option value="Delivered">{currentT.delivered}</option>
                      <option value="Cancelled">{currentT.cancelled}</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.shipping_address}</label>
                  <textarea value={editingOrderData.shippingAddress || ''} onChange={e => setEditingOrderData({ ...editingOrderData, shippingAddress: e.target.value })} rows={2}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors resize-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.notes}</label>
                  <textarea value={editingOrderData.notes || ''} onChange={e => setEditingOrderData({ ...editingOrderData, notes: e.target.value })} rows={3}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors resize-none" />
                </div>
                <button type="submit" className="apple-button-primary w-full mt-4">
                  {currentT.save_changes}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AIChat />
    </div>
  );
}
