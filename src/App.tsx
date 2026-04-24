import DashboardAnalysis from './components/DashboardAnalysis';
import AIChat from './components/AIChat';
import ModuleHeader from './components/ModuleHeader';
import { logFirestoreError as importedLogFirestoreError, OperationType } from './utils/firebase';
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Sun,
  Copy
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
  type MikroConfig,
  type Supplier
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
import { exportOrdersCSV, exportLeadsCSV, exportInventoryCSV, exportMonthlySummaryCSV, exportStockMovementsCSV, downloadInventoryImportTemplate, type MonthlySummaryRow, type StockMovementRow } from './utils/export';
import MikroSyncPanel from './components/MikroSyncPanel';
import MarketplacePanel from './components/MarketplacePanel';
import CariEkstrePanel from './components/CariEkstrePanel';
import MutabakatPanel from './components/MutabakatPanel';
import DemandForecastPanel from './components/DemandForecastPanel';
import BOMPanel from './components/BOMPanel';
import OrderTrackingView from './components/OrderTrackingView';
import LabelSheetModal, { type LabelItem } from './components/LabelSheetModal';
import LucaSyncPanel from './components/LucaSyncPanel';
import GlobalSearch from './components/GlobalSearch';
import { exportCustomerStatement } from './utils/pdf';
import { formatCurrency, formatInCurrency } from './utils/currency';
import { haversineDistance, optimizeRoute } from './utils/logistics';
import { ToastProvider, useToast } from './components/Toast';
import DateRangePicker from './components/DateRangePicker';
import ConfirmModal from './components/ConfirmModal';
import DealerCommissionPanel from './components/DealerCommissionPanel';
import SabitKiymetModule from './components/SabitKiymetModule';
import MaliyetMerkeziModule from './components/MaliyetMerkeziModule';
import TahsilatModule from './components/TahsilatModule';
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
  exchangeRates?: Record<string, number> | null;
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
  // Redact PII (email) before logging — only log error code and operation
  console.error('Firestore Error:', errInfo.error, '|', errInfo.operationType, errInfo.path);
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
const B2BPortal = ({ user, userRole, leads, inventory, currentT, currentLanguage, exchangeRates }: B2BPortalProps) => {
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
  const [dealerCurrency, setDealerCurrency] = useState<'TRY'|'USD'|'EUR'>('TRY');
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
          {(() => {
            const dcRate = dealerCurrency === 'USD' ? (exchangeRates?.USD || 1) : dealerCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
            const dcSym  = dealerCurrency === 'TRY' ? '₺' : dealerCurrency === 'USD' ? '$' : '€';
            const totalCredit = dealers.reduce((s,d)=>s+(d.creditLimit as number||0),0);
            const cvtCredit   = dealerCurrency === 'TRY' ? totalCredit : totalCredit / dcRate;
            return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="apple-card p-4">
              <p className="text-xl font-bold text-brand">{dealers.length}</p>
              <p className="text-xs text-gray-500 mt-1">{currentLanguage==='tr'?'Toplam Bayi':'Total Dealers'}</p>
            </div>
            <div className="apple-card p-4">
              <p className="text-xl font-bold text-green-600">{dealers.filter(d=>d.status==='Active').length}</p>
              <p className="text-xs text-gray-500 mt-1">{currentLanguage==='tr'?'Aktif':'Active'}</p>
            </div>
            <div className="apple-card p-4 relative">
              <button
                onClick={() => setDealerCurrency(c => c==='TRY'?'USD':c==='USD'?'EUR':'TRY')}
                className="absolute top-2.5 right-2.5 text-[9px] font-bold bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full hover:bg-blue-200 transition-colors"
              >{dealerCurrency}</button>
              <p className="text-xl font-bold text-blue-600">{dcSym}{cvtCredit.toLocaleString('tr-TR',{maximumFractionDigits:0})}</p>
              <p className="text-xs text-gray-500 mt-1">{currentLanguage==='tr'?'Toplam Kredi Limiti':'Total Credit'}</p>
            </div>
            <div className="apple-card p-4">
              <p className="text-xl font-bold text-purple-600">{quotations.length}</p>
              <p className="text-xs text-gray-500 mt-1">{currentLanguage==='tr'?'Toplam Teklif':'Quotes'}</p>
            </div>
          </div>
            );
          })()}
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
                      <td className="hidden lg:table-cell font-semibold">{dealerCurrency === 'TRY' ? '₺' : dealerCurrency === 'USD' ? '$' : '€'}{(dealerCurrency === 'TRY' ? (d.creditLimit as number||0) : (d.creditLimit as number||0) / (dealerCurrency === 'USD' ? (exchangeRates?.USD||1) : (exchangeRates?.EUR||1))).toLocaleString('tr-TR',{maximumFractionDigits:0})}</td>
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

const InventoryView = ({ inventory, categories, selectedCategory, setSelectedCategory, currentT, currentLanguage, inventoryMovements, warehouses, onPrintLabels }: { inventory: InventoryItem[], categories: string[], selectedCategory: string, setSelectedCategory: (c: string) => void, currentT: Record<string, string>, currentLanguage: string, isAuthenticated?: boolean, userRole?: string | null, inventoryMovements: InventoryMovement[], warehouses: Warehouse[], onPrintLabels?: (items: LabelItem[]) => void }) => {
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

  const [autoReorderLoading, setAutoReorderLoading] = useState(false);
  const [autoReorderResult, setAutoReorderResult]   = useState<string | null>(null);

  // ── CSV Import state ────────────────────────────────────────────────────────
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRows, setImportRows]           = useState<Record<string, string>[]>([]);
  const [importLoading, setImportLoading]     = useState(false);
  const [importResult, setImportResult]       = useState<string | null>(null);
  const importFileRef                         = useRef<HTMLInputElement>(null);

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setImportRows(results.data);
        setImportModalOpen(true);
      },
    });
    e.target.value = '';
  };

  const handleConfirmImport = async () => {
    setImportLoading(true);
    let upserted = 0;
    try {
      for (const row of importRows) {
        const sku = (row.sku ?? '').trim();
        if (!sku) continue;
        const existing = inventory.find(i => i.sku === sku);
        const payload: Record<string, unknown> = {
          name:              (row.name ?? '').trim(),
          sku,
          category:          (row.category ?? '').trim(),
          stockLevel:        Number(row.stockLevel)        || 0,
          lowStockThreshold: Number(row.lowStockThreshold) || 5,
          prices: {
            'Retail':       Number(row['price_Retail'])         || 0,
            'B2B Standard': Number(row['price_B2B Standard'])   || 0,
            'B2B Premium':  Number(row['price_B2B Premium'])    || 0,
            'Dealer':       Number(row['price_Dealer'])         || 0,
          },
          supplier:    (row.supplier    ?? '').trim(),
          warehouseId: (row.warehouseId ?? '').trim(),
          updatedAt:   serverTimestamp(),
        };
        if (existing) {
          await updateDoc(doc(db, 'inventory', existing.id), payload);
        } else {
          await addDoc(collection(db, 'inventory'), { ...payload, createdAt: serverTimestamp() });
        }
        upserted++;
      }
      setImportResult(
        currentLanguage === 'tr'
          ? `${upserted} ürün başarıyla içe aktarıldı.`
          : `${upserted} products imported successfully.`
      );
      setImportModalOpen(false);
      setImportRows([]);
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : 'Hata / Error');
    } finally {
      setImportLoading(false);
    }
  };

  const handleAutoReorder = async () => {
    setAutoReorderLoading(true);
    setAutoReorderResult(null);
    try {
      const r = await fetch('/api/inventory/auto-reorder', { method: 'POST' });
      const d = await r.json() as { success: boolean; created: number; lowStockCount: number; message?: string; error?: string; items?: string[] };
      if (d.success) {
        const msg = d.created === 0
          ? (currentLanguage === 'tr' ? 'Tüm stoklar limitin üzerinde.' : 'All stock levels are above threshold.')
          : `${d.created} ${currentLanguage === 'tr' ? 'taslak SAS oluşturuldu' : 'draft POs created'} (${d.items?.slice(0,3).join(', ')}${(d.items?.length ?? 0) > 3 ? '…' : ''})`;
        setAutoReorderResult(msg);
      }
    } catch (e) {
      setAutoReorderResult(e instanceof Error ? e.message : 'Hata');
    } finally {
      setAutoReorderLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Row 1: Title + Add button */}
      <ModuleHeader
        title={currentT.inventory}
        subtitle={currentT.inventory_desc}
        icon={Package}
        actionButton={
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleAutoReorder()}
              disabled={autoReorderLoading}
              className="apple-button-secondary flex items-center gap-2 text-sm"
              title={currentLanguage === 'tr' ? 'Düşük stoklar için taslak SAS oluştur' : 'Create draft POs for low-stock items'}
            >
              {autoReorderLoading
                ? <RefreshCw className="w-4 h-4 animate-spin" />
                : <ShoppingCart className="w-4 h-4" />}
              {currentLanguage === 'tr' ? 'Otomatik SAS' : 'Auto-Reorder'}
            </button>
            <button onClick={() => setIsAddingProduct(true)} className="apple-button-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> {currentT.add_product}
            </button>
          </div>
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
          {/* hidden CSV file picker */}
          <input
            ref={importFileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={() => importFileRef.current?.click()}
            className="apple-button-secondary p-2.5 flex items-center justify-center"
            title={currentLanguage === 'tr' ? 'CSV olarak içe aktar' : 'Import from CSV'}
          >
            <Upload className="w-4 h-4" />
          </button>
          <button
            onClick={() => exportInventoryCSV(inventory, currentLanguage)}
            className="apple-button-secondary p-2.5 flex items-center justify-center"
            title={currentLanguage === 'tr' ? 'CSV olarak dışa aktar' : 'Export as CSV'}
          >
            <Download className="w-4 h-4" />
          </button>
          {onPrintLabels && (
            <button
              onClick={() => {
                const labelData: LabelItem[] = filteredInventory.map(i => ({
                  id:    i.id,
                  name:  i.name,
                  sku:   i.sku,
                  price: i.prices?.['Retail'] ?? i.price ?? 0,
                  unit:  (i as InventoryItem & { unit?: string }).unit,
                }));
                onPrintLabels(labelData);
              }}
              className="apple-button-secondary p-2.5 flex items-center justify-center"
              title={currentLanguage === 'tr' ? 'Etiket Yazdır' : 'Print Labels'}
            >
              <FileText className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Auto-reorder result banner */}
      {autoReorderResult && (
        <div className="flex items-center gap-2 text-xs px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{autoReorderResult}</span>
          <button onClick={() => setAutoReorderResult(null)} className="ml-auto text-emerald-400 hover:text-emerald-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* CSV import result banner */}
      {importResult && (
        <div className="flex items-center gap-2 text-xs px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-blue-700">
          <FileUp className="w-4 h-4 flex-shrink-0" />
          <span>{importResult}</span>
          <button onClick={() => setImportResult(null)} className="ml-auto text-blue-400 hover:text-blue-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Phase 31: Low-Stock Watchlist Panel ── */}
      {(() => {
        const critical = inventory.filter(i => (i.stockLevel ?? 0) === 0);
        const warning  = inventory.filter(i => (i.stockLevel ?? 0) > 0 && (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5));
        if (critical.length === 0 && warning.length === 0) return null;
        return (
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: critical.length > 0 ? '#fca5a5' : '#fde68a' }}>
            <div className={`px-4 py-3 flex items-center justify-between ${critical.length > 0 ? 'bg-red-50' : 'bg-amber-50'}`}>
              <div className="flex items-center gap-2">
                <AlertTriangle className={`w-4 h-4 ${critical.length > 0 ? 'text-red-500' : 'text-amber-500'}`} />
                <span className={`text-xs font-bold ${critical.length > 0 ? 'text-red-700' : 'text-amber-700'}`}>
                  {currentLanguage === 'tr'
                    ? `${critical.length > 0 ? `${critical.length} kritik (0 stok)` : ''}${critical.length > 0 && warning.length > 0 ? ', ' : ''}${warning.length > 0 ? `${warning.length} uyarı (düşük stok)` : ''}`
                    : `${critical.length > 0 ? `${critical.length} critical (out of stock)` : ''}${critical.length > 0 && warning.length > 0 ? ', ' : ''}${warning.length > 0 ? `${warning.length} low stock warning` : ''}`}
                </span>
              </div>
              <button onClick={() => void handleAutoReorder()} disabled={autoReorderLoading}
                className={`text-[10px] font-bold px-3 py-1 rounded-full transition-colors ${critical.length > 0 ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
                {autoReorderLoading ? '…' : (currentLanguage === 'tr' ? '⚡ Otomatik SAS' : '⚡ Auto-Reorder')}
              </button>
            </div>
            <div className="bg-white divide-y divide-gray-50 max-h-48 overflow-y-auto">
              {[...critical, ...warning].slice(0, 10).map(item => {
                const pct = item.lowStockThreshold > 0 ? Math.min((item.stockLevel ?? 0) / item.lowStockThreshold, 1) : 0;
                const isCrit = (item.stockLevel ?? 0) === 0;
                return (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{item.name}</p>
                      <p className="text-[10px] text-gray-400">{item.sku}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${isCrit ? 'bg-red-500' : 'bg-amber-400'}`} style={{ width: `${pct * 100}%` }} />
                      </div>
                      <span className={`text-[10px] font-bold w-10 text-right ${isCrit ? 'text-red-600' : 'text-amber-600'}`}>
                        {item.stockLevel ?? 0}/{item.lowStockThreshold ?? 5}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* CSV Import Preview Modal */}
      <AnimatePresence>
        {importModalOpen && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              className="bg-white rounded-[2rem] shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden"
            >
              {/* header */}
              <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white">
                    <FileUp className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-[#1D1D1F]">
                      {currentLanguage === 'tr' ? 'CSV İçe Aktarma Önizlemesi' : 'CSV Import Preview'}
                    </h2>
                    <p className="text-xs text-[#86868B]">
                      {currentLanguage === 'tr'
                        ? `${importRows.length} satır — SKU eşleşirse güncellenir, yoksa eklenir`
                        : `${importRows.length} rows — existing SKUs will be updated, new ones added`}
                    </p>
                  </div>
                </div>
                <button onClick={() => setImportModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* table */}
              <div className="flex-1 overflow-auto p-6">
                <div className="text-xs text-gray-400 mb-3 flex items-center gap-2">
                  <span>{currentLanguage === 'tr' ? 'Şablon indir:' : 'Download template:'}</span>
                  <button
                    onClick={() => downloadInventoryImportTemplate()}
                    className="text-brand font-semibold hover:underline flex items-center gap-1"
                  >
                    <Download className="w-3 h-3" /> CETPA_Envanter_Sablon.csv
                  </button>
                </div>
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      {['sku', 'name', 'category', 'stockLevel', 'price_Retail', 'price_B2B Standard', 'supplier'].map(h => (
                        <th key={h} className="px-3 py-2 font-bold text-gray-500 border border-gray-100 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.slice(0, 50).map((row, i) => {
                      const exists = inventory.some(inv => inv.sku === (row.sku ?? '').trim());
                      return (
                        <tr key={i} className={exists ? 'bg-amber-50' : 'bg-white'}>
                          {['sku', 'name', 'category', 'stockLevel', 'price_Retail', 'price_B2B Standard', 'supplier'].map(h => (
                            <td key={h} className="px-3 py-1.5 border border-gray-100 text-gray-700 max-w-[140px] truncate">{row[h] ?? ''}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {importRows.length > 50 && (
                  <p className="text-xs text-gray-400 mt-2 text-center">
                    {currentLanguage === 'tr' ? `...ve ${importRows.length - 50} satır daha` : `...and ${importRows.length - 50} more rows`}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-4 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-200 inline-block" />
                    {currentLanguage === 'tr' ? 'Mevcut SKU — güncellenecek' : 'Existing SKU — will be updated'}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-white border border-gray-200 inline-block" />
                    {currentLanguage === 'tr' ? 'Yeni SKU — eklenecek' : 'New SKU — will be added'}
                  </span>
                </div>
              </div>

              {/* footer */}
              <div className="px-8 py-5 bg-gray-50/50 border-t border-gray-100 flex items-center justify-end gap-3">
                <button onClick={() => setImportModalOpen(false)} className="apple-button-secondary">
                  {currentLanguage === 'tr' ? 'İptal' : 'Cancel'}
                </button>
                <button
                  onClick={() => void handleConfirmImport()}
                  disabled={importLoading}
                  className="apple-button-primary px-10 flex items-center gap-2"
                >
                  {importLoading && <RefreshCw className="w-4 h-4 animate-spin" />}
                  {currentLanguage === 'tr' ? 'İçe Aktar' : 'Import'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                    {/* Phase 59: Cost Price + Margin column */}
                    <th className="px-4 py-4 text-[11px] font-bold text-[#86868B] uppercase tracking-widest hidden xl:table-cell">
                      {currentLanguage === 'tr' ? 'Maliyet / Marj' : 'Cost / Margin'}
                    </th>
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
                          {/* Phase 52: SKU click-to-copy */}
                          <button
                            className="flex items-center gap-1 w-fit group/sku mt-0.5"
                            onClick={e => { e.stopPropagation(); void navigator.clipboard.writeText(item.sku); }}
                            title={currentT.copy_sku || 'Copy SKU'}
                          >
                            <span className="text-[10px] font-mono text-[#86868B] tracking-wider group-hover/sku:text-brand transition-colors">{item.sku}</span>
                            <Copy className="w-2.5 h-2.5 text-gray-300 group-hover/sku:text-brand opacity-0 group-hover/sku:opacity-100 transition-all" />
                          </button>
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
                        {/* Phase 33: Stock mini-gauge */}
                        {(() => {
                          const stock  = item.stockLevel ?? 0;
                          const thresh = item.lowStockThreshold ?? 5;
                          const refMax = Math.max(thresh * 4, stock, 20);
                          const pct    = Math.min(stock / refMax, 1);
                          const isCrit = stock === 0;
                          const isLow  = stock > 0 && stock <= thresh;
                          const barColor = isCrit ? 'bg-red-500' : isLow ? 'bg-amber-400' : 'bg-emerald-400';
                          return (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className={cn("text-sm font-bold", isCrit ? "text-red-500" : isLow ? "text-amber-600" : "text-gray-900")}>
                                  {stock}
                                </span>
                                {(isCrit || isLow) && <AlertTriangle className={`w-3 h-3 ${isCrit ? 'text-red-500' : 'text-amber-500'}`} />}
                              </div>
                              <div className="w-16 h-1 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct * 100}%` }} />
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-bold text-gray-900">
                          {(item.price ?? item.prices?.['Retail'] ?? 0).toLocaleString()} TL
                        </span>
                      </td>
                      {/* Phase 59: Cost Price + Margin cell */}
                      <td className="px-4 py-4 hidden xl:table-cell">
                        {(() => {
                          const retail = item.price ?? item.prices?.['Retail'] ?? 0;
                          const cost   = item.costPrice ?? item.cost ?? 0;
                          const margin = retail > 0 && cost > 0 ? Math.round(((retail - cost) / retail) * 100) : null;
                          return (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs font-semibold text-gray-500">{cost > 0 ? `₺${cost.toLocaleString('tr-TR')}` : '—'}</span>
                              {margin !== null && (
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full w-fit ${margin >= 30 ? 'bg-emerald-50 text-emerald-700' : margin >= 15 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                                  %{margin}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span className={cn(
                            "px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit",
                            item.stockLevel <= item.lowStockThreshold ? "bg-red-50 text-red-600 border border-red-100" : "bg-green-50 text-green-600 border border-green-100"
                          )}>
                            {item.stockLevel <= item.lowStockThreshold ? currentT.critical : currentT.normal}
                          </span>
                          {/* Phase 66: Last movement date */}
                          {(() => {
                            const lastMov = movements
                              .filter(m => (m as { productId?: string }).productId === item.id || m.productName === item.name)
                              .sort((a, b) => {
                                const getT = (x: unknown) => {
                                  if (!x) return 0;
                                  if (typeof (x as { toDate?: () => Date }).toDate === 'function') return (x as { toDate: () => Date }).toDate().getTime();
                                  return new Date(x as string | number).getTime();
                                };
                                return getT(b.timestamp) - getT(a.timestamp);
                              })[0];
                            if (!lastMov) return null;
                            const d = typeof (lastMov.timestamp as { toDate?: () => Date }).toDate === 'function'
                              ? (lastMov.timestamp as { toDate: () => Date }).toDate()
                              : new Date(lastMov.timestamp as string | number);
                            const daysAgo = Math.round((Date.now() - d.getTime()) / 86400000);
                            return (
                              <span className="text-[9px] text-gray-400" title={d.toLocaleDateString()}>
                                {daysAgo === 0
                                  ? (currentLanguage === 'tr' ? 'Bugün hareket' : 'Moved today')
                                  : (currentLanguage === 'tr' ? `${daysAgo}g önce` : `${daysAgo}d ago`)}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* Phase 54: Quick Stock Adjustment */}
                          <button
                            onClick={async (e) => { e.stopPropagation(); const newStock = Math.max(0, (item.stockLevel ?? 0) - 1); await updateDoc(doc(db, 'inventory', item.id), { stockLevel: newStock }); }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-all font-bold text-xs"
                            title={currentLanguage === 'tr' ? 'Stok azalt' : 'Decrease stock'}
                          >
                            −
                          </button>
                          <button
                            onClick={async (e) => { e.stopPropagation(); const newStock = (item.stockLevel ?? 0) + 1; await updateDoc(doc(db, 'inventory', item.id), { stockLevel: newStock }); }}
                            className="p-1.5 rounded-lg hover:bg-emerald-50 text-gray-300 hover:text-emerald-600 transition-all font-bold text-xs"
                            title={currentLanguage === 'tr' ? 'Stok artır' : 'Increase stock'}
                          >
                            +
                          </button>
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
                    {/* Phase 39: Mobile stock gauge */}
                    <p className="text-sm font-bold">{item.stockLevel}</p>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${(item.stockLevel ?? 0) === 0 ? 'bg-red-500' : (item.stockLevel ?? 0) <= (item.lowStockThreshold ?? 5) ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: `${Math.min(((item.stockLevel ?? 0) / Math.max((item.lowStockThreshold ?? 5) * 4, 1)) * 100, 100)}%` }} />
                    </div>
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
              {movements.length > 0 && (
                <button
                  onClick={() => exportStockMovementsCSV(movements as unknown as StockMovementRow[], currentLanguage)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                  title={currentLanguage === 'tr' ? 'CSV olarak indir' : 'Download CSV'}
                >
                  <Download className="w-4 h-4" />
                </button>
              )}
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
                    <span className="text-sm font-bold text-brand">{revenueSymbol}{formatInCurrency(c.total, revenueCurrency, exchangeRates)}</span>
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
              { label: currentLanguage==='tr'?'Toplam Stok Değeri':'Total Stock Value', value: `${revenueSymbol}${formatInCurrency(totalInventoryValueTRY, revenueCurrency, exchangeRates)}`, color: 'text-green-600', bg: 'bg-green-50' },
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
              { label: currentLanguage==='tr'?'Ödenen Maaş':'Paid Salary', value: revenueSymbol + formatInCurrency(hrStats.totalPayroll, revenueCurrency, exchangeRates), icon: CreditCard, color: 'text-green-600', bg: 'bg-green-50', desc: currentLanguage==='tr'?'Toplam ödenen bordro':'Total paid payroll' },
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

// ── Order Status Timeline ────────────────────────────────────────────────────

const ORDER_STATUS_STEPS = [
  { key: 'Pending',    labelTR: 'Sipariş Alındı',  labelEN: 'Received',   icon: Clock        },
  { key: 'Processing', labelTR: 'Hazırlanıyor',     labelEN: 'Processing', icon: Package      },
  { key: 'Shipped',    labelTR: 'Kargoya Verildi',  labelEN: 'Shipped',    icon: Truck        },
  { key: 'Delivered',  labelTR: 'Teslim Edildi',    labelEN: 'Delivered',  icon: CheckCircle2 },
] as const;

function OrderStatusTimeline({ status, lang = 'tr' }: { status: string; lang?: string }) {
  const isTR = lang === 'tr';
  const isCancelled = status === 'Cancelled';
  const activeIdx = Math.max(ORDER_STATUS_STEPS.findIndex(s => s.key === status), 0);

  return (
    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-4">
        {isTR ? 'Sipariş Durumu' : 'Order Status'}
      </p>
      {isCancelled ? (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <X className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <p className="font-bold text-red-600 text-sm">{isTR ? 'Sipariş İptal Edildi' : 'Order Cancelled'}</p>
            <p className="text-[11px] text-red-400">{isTR ? 'Bu sipariş iptal edilmiştir.' : 'This order has been cancelled.'}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-end">
          {ORDER_STATUS_STEPS.map((step, idx) => {
            const done   = activeIdx >= idx;
            const active = activeIdx === idx;
            const Icon   = step.icon;
            return (
              <React.Fragment key={step.key}>
                <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300
                    ${done ? 'bg-brand text-white' : 'bg-gray-100 text-gray-300'}
                    ${active ? 'ring-4 ring-brand/20 scale-110' : ''}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`text-[9px] text-center font-bold leading-tight max-w-[60px] ${done ? 'text-brand' : 'text-gray-300'}`}>
                    {isTR ? step.labelTR : step.labelEN}
                  </span>
                </div>
                {idx < ORDER_STATUS_STEPS.length - 1 && (
                  <div className={`flex-1 h-[3px] mb-[22px] mx-1.5 rounded-full transition-all duration-500
                    ${activeIdx > idx ? 'bg-brand' : 'bg-gray-100'}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

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

  // ── Phase 25: Online / offline indicator ──────────────────────────────────
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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
  const [muhasebeTab, setMuhasebeTab] = useState<'genel'|'sabit-kiymet'|'maliyet'|'tahsilat'>('genel');

  // ── Dashboard summary (30-day KPI deltas) ─────────────────────────────────
  const [summaryData, setSummaryData] = useState<{
    orders:    { count: number; prevCount: number; delta: number };
    revenue:   { total: number; prev: number; delta: number };
    leads:     { total: number; new30: number };
    inventory: { total: number; lowStock: number };
    delivered: number;
  } | null>(null);

  useEffect(() => {
    fetch('/api/reports/summary')
      .then(r => r.ok ? r.json() : null)
      .then((d: typeof summaryData) => { if (d) setSummaryData(d); })
      .catch(() => {});
  }, []);

  // ── System health state ────────────────────────────────────────────────────
  const [healthData, setHealthData] = useState<{
    status: string; uptime: number; env: string;
    firebase: boolean; resend: boolean; whatsapp: boolean; iyzico: boolean;
    timestamp: string;
  } | null>(null);
  const [statsData, setStatsData] = useState<Record<string, number> | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const fetchSystemHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const [hr, sr] = await Promise.all([
        fetch('/api/health'),
        fetch('/api/admin/stats'),
      ]);
      if (hr.ok) setHealthData(await hr.json() as typeof healthData);
      if (sr.ok) {
        const sd = await sr.json() as { counts: Record<string, number> };
        setStatsData(sd.counts);
      }
    } catch { /* ignore — offline */ }
    setHealthLoading(false);
  }, []);

  useEffect(() => {
    if (adminTab === 'system') void fetchSystemHealth();
  }, [adminTab, fetchSystemHealth]);
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

  // ── Phase 29: Supplier Directory ──────────────────────────────────────────
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchasingSubTab, setPurchasingSubTab] = useState<'pos' | 'suppliers'>('pos');
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [newSupplier, setNewSupplier] = useState<Partial<Supplier>>({});

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'suppliers'), snap => {
      setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Supplier)));
    }, err => console.error('suppliers:', err));
    return () => unsub();
  }, [user]);

  const handleSaveSupplier = async () => {
    if (!newSupplier.name?.trim()) return;
    try {
      if (editingSupplier) {
        await updateDoc(doc(db, 'suppliers', editingSupplier.id), { ...newSupplier });
      } else {
        await addDoc(collection(db, 'suppliers'), { ...newSupplier, createdAt: serverTimestamp() });
      }
      setAddingSupplier(false); setEditingSupplier(null); setNewSupplier({});
    } catch (e) { console.error(e); }
  };

  const handleDeleteSupplier = async (id: string) => {
    if (!window.confirm(currentLanguage === 'tr' ? 'Tedarikçiyi silmek istiyor musunuz?' : 'Delete this supplier?')) return;
    await deleteDoc(doc(db, 'suppliers', id));
  };

  // ── Phase 38: Recently Viewed trail ───────────────────────────────────────
  const [recentlyViewed, setRecentlyViewed] = useState<{ type: 'order' | 'lead' | 'product'; id: string; label: string; tab: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('cetpa-recent') ?? '[]'); } catch { return []; }
  });
  const trackView = useCallback((item: { type: 'order' | 'lead' | 'product'; id: string; label: string; tab: string }) => {
    setRecentlyViewed(prev => {
      const next = [item, ...prev.filter(r => r.id !== item.id)].slice(0, 5);
      localStorage.setItem('cetpa-recent', JSON.stringify(next));
      return next;
    });
  }, []);

  // ── Phase 27: Dashboard Quick Note ────────────────────────────────────────
  const [quickNote, setQuickNote] = useState<string>(() => localStorage.getItem('cetpa-quick-note') ?? '');
  const quickNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleQuickNoteChange = (val: string) => {
    setQuickNote(val);
    if (quickNoteTimer.current) clearTimeout(quickNoteTimer.current);
    quickNoteTimer.current = setTimeout(() => {
      localStorage.setItem('cetpa-quick-note', val);
    }, 600);
  };

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

  // Global search keyboard shortcut — Cmd+K / Ctrl+K
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setGlobalSearchOpen(v => !v);
      }
      // Phase 28: ? key → shortcut cheat-sheet
      if (e.key === '?' && !inInput && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShortcutModalOpen(v => !v);
      }
      // Single-key tab navigation (only when not in an input)
      if (!inInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        switch (e.key) {
          case 'd': setActiveTab('dashboard'); break;
          case 'o': setActiveTab('orders');    break;
          case 'c': setActiveTab('crm');       break;
          case 'i': setActiveTab('inventory'); break;
          case 'r': setActiveTab('reports');   break;
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Phase 68: N shortcut — open new-item form based on active tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName);
      if (inInput || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'n') return;
      e.preventDefault();
      if (activeTab === 'orders') { setSelectedLead(null); setIsAddingOrder(true); }
      else if (activeTab === 'crm') { setIsAddingLead(true); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const [faturaLoading,      setFaturaLoading]      = useState<Record<string, boolean>>({});
  const [iyzicoLinkLoading,  setIyzicoLinkLoading]  = useState<Record<string, boolean>>({});
  const [labelItems,         setLabelItems]         = useState<LabelItem[] | null>(null);
  // Public order tracking — read from URL on mount
  const trackOrderId = new URLSearchParams(window.location.search).get('track') ?? null;
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
  const leadFromOrderRef = useRef(false); // Phase 82: track lead-modal opened from order form
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [isEditingLead, setIsEditingLead] = useState(false);
  const [editingLeadData, setEditingLeadData] = useState<Partial<Lead>>({});
  const [isAddingActivity, setIsAddingActivity] = useState(false);
  const [newActivity, setNewActivity] = useState<Partial<LeadActivity>>({ type: 'Note', description: '' });

  // --- Filters ---
  const [crmSearch, setCrmSearch] = useState('');
  const [crmSort, setCrmSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter,  setOrderStatusFilter]  = useState<string>('All'); // Phase 55
  const [leadStatusFilter,   setLeadStatusFilter]   = useState<string>('All'); // Phase 72
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false); // Phase 28
  // ── User invite state ─────────────────────────────────────────────
  const [inviteEmail, setInviteEmail]   = useState('');
  const [inviteRole,  setInviteRole]    = useState('Sales');
  const [inviteLoading, setInviteLoading] = useState(false);
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

  // --- Real-time Mikro & Luca Settings ---
  useEffect(() => {
    if (!user) return;
    const unsubMikro = onSnapshot(doc(db, 'settings', 'mikro'), (docSnap) => {
      if (docSnap.exists()) setMikroSettings(docSnap.data() as Partial<MikroConfig>);
    });
    const unsubLuca = onSnapshot(doc(db, 'settings', 'luca'), (docSnap) => {
      if (docSnap.exists()) setLucaSettings(docSnap.data() as Partial<LucaConfig>);
    });
    return () => { unsubMikro(); unsubLuca(); };
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

    // Track previously-known low-stock IDs so we only fire once per drop
    const prevLowStockIds = new Set<string>();

    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
      setInventory(items);

      // Detect newly-low-stock items and create bell notifications
      const uid = auth.currentUser?.uid;
      if (uid) {
        for (const item of items) {
          const isLow = (item.stockLevel ?? 0) <= (item.lowStockThreshold ?? 5);
          if (isLow && !prevLowStockIds.has(item.id)) {
            prevLowStockIds.add(item.id);
            // Fire-and-forget: write to flat notifications collection (matches listener)
            addDoc(collection(db, 'notifications'), {
              userId: uid,
              title: currentLanguage === 'tr' ? 'Düşük Stok Uyarısı' : 'Low Stock Alert',
              message: `${item.name} — ${currentLanguage === 'tr' ? 'stok kritik seviyede' : 'stock is critically low'}: ${item.stockLevel ?? 0} ${currentLanguage === 'tr' ? 'adet' : 'units'}`,
              type: 'warning',
              read: false,
              createdAt: serverTimestamp(),
            }).catch(() => { /* non-critical */ });
          } else if (!isLow) {
            prevLowStockIds.delete(item.id);
          }
        }
      }
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'inventory', auth.currentUser?.uid));

    const unsubCategories = onSnapshot(query(collection(db, 'categories'), orderBy('name')), (snapshot) => {
      setFirestoreCategories(snapshot.docs.map(d => d.data().name as string).filter(Boolean));
    }, () => { /* silently ignore — categories may not exist yet */ });

    const unsubWarehouses = onSnapshot(collection(db, 'warehouses'), (snapshot) => {
      setWarehouses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Warehouse)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'warehouses', auth.currentUser?.uid));

    const unsubMovements = onSnapshot(query(collection(db, 'inventoryMovements'), orderBy('timestamp', 'desc'), limit(200)), (snapshot) => {
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
      const docRef = await addDoc(collection(db, 'leads'), {
        ...newLead, status: 'New', score: scoreResult.score,
        notes: `${newLead.notes}\n\nAI Insights: ${scoreResult.reasoning}`,
        assignedTo: user?.uid ?? 'guest', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        customerType: 'B2B' as const,
      });
      createNotification(
        currentLanguage === 'tr' ? 'Yeni Müşteri Adayı' : 'New Lead',
        `${newLead.name}${newLead.company ? ` — ${newLead.company}` : ''} ${currentLanguage === 'tr' ? 'eklendi' : 'added'} (AI Skor: ${scoreResult.score}/100)`,
        'info'
      ).catch(() => {});
      // Phase 82: if opened from within order form, auto-select the new lead as customer
      if (leadFromOrderRef.current) {
        const freshLead = { id: docRef.id, ...newLead, status: 'New' as const, score: scoreResult.score, assignedTo: user?.uid ?? 'guest', customerType: 'B2B' as const };
        setNewOrder(prev => ({ ...prev, customerName: newLead.name, shippingAddress: newLead.company || '' }));
        setOrderCustomerSearch(newLead.name);
        setSelectedLead(freshLead as unknown as Lead);
        leadFromOrderRef.current = false;
      }
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

      // ── Notification trigger on key status changes ─────────────────────────
      {
        const ord = orders.find(o => o.id === orderId);
        if (ord) {
          if (status === 'Delivered') {
            createNotification(
              currentLanguage === 'tr' ? 'Sipariş Teslim Edildi' : 'Order Delivered',
              `${ord.customerName} — #${ord.shopifyOrderId ?? orderId.slice(0, 8)} ${currentLanguage === 'tr' ? 'teslim edildi' : 'delivered'} ₺${ord.totalPrice.toLocaleString('tr-TR')}`,
              'success'
            ).catch(() => {});
          } else if (status === 'Shipped') {
            createNotification(
              currentLanguage === 'tr' ? 'Sipariş Kargoya Verildi' : 'Order Shipped',
              `${ord.customerName} — #${ord.shopifyOrderId ?? orderId.slice(0, 8)} ${currentLanguage === 'tr' ? 'kargoya verildi' : 'shipped'}`,
              'info'
            ).catch(() => {});
          } else if (status === 'Cancelled') {
            createNotification(
              currentLanguage === 'tr' ? 'Sipariş İptal Edildi' : 'Order Cancelled',
              `${ord.customerName} — #${ord.shopifyOrderId ?? orderId.slice(0, 8)}`,
              'warning'
            ).catch(() => {});
          }
        }
      }

      // Auto-trigger e-İrsaliye when an order is marked as Shipped (fire-and-forget)
      if (status === 'Shipped') {
        const order = orders.find(o => o.id === orderId);
        if (order) {
          const lead = leads.find(l => l.id === order.leadId);
          fetch('/api/mikro/irsaliye/kaydet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shipment: {
                mikroCariKod: lead?.cariKod || lead?.taxId || order.customerName,
                customerName: order.customerName,
                destination: order.shippingAddress || '',
                trackingNo: order.trackingNumber || orderId.slice(0, 8),
                cargoFirm: order.cargoCompany || '',
                items: (order.lineItems || []).map(l => ({
                  name: l.title || l.name || l.sku,
                  qty: l.quantity,
                  unitPrice: l.price,
                })),
                date: new Date().toISOString(),
              },
              firebaseId: orderId,
            }),
          }).then(r => r.json()).then((d: { success: boolean; irsaliyeNo?: string; notConfigured?: boolean }) => {
            if (d.success && d.irsaliyeNo) {
              toast(`${currentLanguage === 'tr' ? 'İrsaliye oluşturuldu' : 'Waybill created'}: ${d.irsaliyeNo}`, 'success');
            }
            // notConfigured → silently skip; error → silently skip (fire-and-forget)
          }).catch(() => { /* Mikro not available — silent */ });
        }
      }
      // Auto-send email + WhatsApp on Shipped / Delivered (fire-and-forget)
      if (status === 'Shipped' || status === 'Delivered') {
        const ord  = orders.find(o => o.id === orderId);
        const lead = ord ? leads.find(l => l.id === ord.leadId) : null;
        const toEmail = lead?.email || (ord as (Order & { customerEmail?: string }) | undefined)?.customerEmail;
        const toPhone = lead?.phone || (ord as (Order & { customerPhone?: string }) | undefined)?.customerPhone;

        if (toEmail && ord) {
          fetch('/api/email/order-notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId, status,
              customerEmail: toEmail,
              customerName:  ord.customerName,
              orderNo:       ord.shopifyOrderId,
              lang:          currentLanguage,
            }),
          }).then(r => r.json())
            .then((d: { success: boolean; notConfigured?: boolean }) => {
              if (d.success) toast(currentLanguage === 'tr' ? 'Bildirim e-postası gönderildi ✓' : 'Notification email sent ✓', 'success');
            }).catch(() => {});
        }

        // WhatsApp notification (fire-and-forget)
        if (toPhone && ord) {
          fetch('/api/whatsapp/order-notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId, status,
              phone:        toPhone,
              customerName: ord.customerName,
              orderNo:      ord.shopifyOrderId,
              lang:         currentLanguage,
            }),
          }).then(r => r.json())
            .then((d: { success: boolean; notConfigured?: boolean }) => {
              if (d.success) toast(currentLanguage === 'tr' ? 'WhatsApp bildirimi gönderildi ✓' : 'WhatsApp notification sent ✓', 'success');
            }).catch(() => {});
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  // ── e-Fatura: push order to Mikro ────────────────────────────────────────────
  const handleMikroFatura = async (order: Order) => {
    setFaturaLoading(prev => ({ ...prev, [order.id]: true }));
    try {
      const lead = leads.find(l => l.id === order.leadId);
      const r = await fetch('/api/mikro/fatura/kaydet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order: {
            mikroCariKod: lead?.cariKod || lead?.taxId || order.customerName,
            customerName: order.customerName,
            lineItems: (order.lineItems || []).map(l => ({
              name: l.title || l.name || l.sku,
              qty: l.quantity,
              unitPrice: l.price,
              vatRate: l.vatRate ?? order.kdvOran ?? 20,
            })),
            totalPrice: order.totalPrice,
            faturaTipi: order.faturaTipi || 'e-arsiv',
            kdvOran: order.kdvOran ?? 20,
          },
          firebaseId: order.id,
        }),
      });
      const d = await r.json() as { success: boolean; mikroFaturaNo?: string; notConfigured?: boolean; error?: string };
      if (d.success) {
        toast(`${currentLanguage === 'tr' ? 'Fatura kaydedildi' : 'Invoice recorded'}: ${d.mikroFaturaNo ?? ''}`, 'success');
        // Optimistic update — Firestore onSnapshot will sync the real value shortly
        if (selectedOrder?.id === order.id) setSelectedOrder({ ...selectedOrder, mikroFaturaNo: d.mikroFaturaNo, hasInvoice: true });
      } else if (d.notConfigured) {
        toast(currentLanguage === 'tr' ? 'Mikro bağlantısı yapılandırılmamış. Ayarlar\'dan girin.' : 'Mikro not configured. Go to Settings.', 'error');
      } else {
        toast(d.error || (currentLanguage === 'tr' ? 'Fatura gönderilemedi.' : 'Invoice push failed.'), 'error');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setFaturaLoading(prev => ({ ...prev, [order.id]: false }));
    }
  };

  // ── iyzico: generate payment link ─────────────────────────────────────────
  const handleIyzicoPaymentLink = async (order: Order) => {
    setIyzicoLinkLoading(prev => ({ ...prev, [order.id]: true }));
    try {
      const lead = leads.find(l => l.id === order.leadId);
      const r = await fetch('/api/iyzico/payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId:        order.id,
          amount:         order.totalPrice,
          currency:       'TRY',
          customerName:   order.customerName,
          customerEmail:  lead?.email || order.customerEmail || '',
          customerPhone:  lead?.phone || '',
          shippingAddress: order.shippingAddress || 'Türkiye',
          taxId:          lead?.taxId || '11111111111',
          lineItems:      (order.lineItems || []).map(l => ({
            name:  l.title || l.name || l.sku,
            price: l.price,
            qty:   l.quantity,
          })),
        }),
      });
      const d = await r.json() as { success: boolean; paymentPageUrl?: string; notConfigured?: boolean; error?: string };
      if (d.success && d.paymentPageUrl) {
        // Open in new tab + copy to clipboard
        window.open(d.paymentPageUrl, '_blank');
        navigator.clipboard?.writeText(d.paymentPageUrl).catch(() => {});
        toast(currentLanguage === 'tr' ? 'Ödeme linki oluşturuldu ve açıldı ✓' : 'Payment link created and opened ✓', 'success');
        if (selectedOrder?.id === order.id) setSelectedOrder({ ...selectedOrder, iyzicoPaymentUrl: d.paymentPageUrl });
      } else if (d.notConfigured) {
        toast(currentLanguage === 'tr' ? 'iyzico yapılandırılmamış. Entegrasyonlar\'dan API anahtarını girin.' : 'iyzico not configured. Add API key in Integrations.', 'error');
      } else {
        toast(d.error || (currentLanguage === 'tr' ? 'Ödeme linki oluşturulamadı.' : 'Payment link failed.'), 'error');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setIyzicoLinkLoading(prev => ({ ...prev, [order.id]: false }));
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

  // ── Phase 89: Toggle order payment status ─────────────────────────────────
  const handleToggleOrderPaid = async (order: Order) => {
    const next = !order.paid;
    try {
      await updateDoc(doc(db, 'orders', order.id), {
        paid:   next,
        paidAt: next ? serverTimestamp() : null,
      });
      toast(
        next
          ? (currentLanguage === 'tr' ? '✓ Ödeme alındı olarak işaretlendi' : '✓ Marked as paid')
          : (currentLanguage === 'tr' ? 'Ödeme bekliyor olarak işaretlendi' : 'Marked as unpaid'),
        next ? 'success' : 'info'
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`);
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

  // Public order tracking — no auth required
  if (trackOrderId) {
    return (
      <OrderTrackingView
        orderId={trackOrderId}
        currentLanguage={currentLanguage}
        onBack={() => { window.history.pushState({}, '', '/'); window.location.reload(); }}
      />
    );
  }

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

            {/* Global search trigger */}
            <button
              onClick={() => setGlobalSearchOpen(true)}
              className={cn(
                "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs transition-all outline-none flex-shrink-0",
                darkMode
                  ? "bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white/70"
                  : "bg-black/[0.04] border-black/10 text-gray-400 hover:bg-black/[0.07]"
              )}
              title={currentLanguage === 'tr' ? 'Ara (⌘K)' : 'Search (⌘K)'}
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">{currentLanguage === 'tr' ? 'Ara…' : 'Search…'}</span>
              <kbd className="hidden lg:inline text-[9px] bg-black/[0.06] px-1 py-0.5 rounded font-mono">⌘K</kbd>
            </button>

            {/* Keyboard shortcut help — Phase 28 */}
            <button
              onClick={() => setShortcutModalOpen(true)}
              className={cn("hidden md:flex items-center justify-center w-[34px] h-[34px] sm:w-[38px] sm:h-[38px] rounded-xl border transition-all outline-none flex-shrink-0 font-bold", darkMode ? "bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white/70" : "bg-black/[0.04] border-black/10 text-gray-400 hover:bg-black/[0.07] hover:text-gray-600")}
              title={currentLanguage === 'tr' ? 'Klavye kısayolları (?)' : 'Keyboard shortcuts (?)'}
            >
              <span className="text-xs">?</span>
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
                  // Phase 30 — tab count badges
                  const badgeCount = tab.id === 'orders'
                    ? orders.filter(o => o.status === 'Pending').length
                    : tab.id === 'crm'
                      ? leads.filter(l => l.status === 'New').length
                      : tab.id === 'inventory'
                        ? inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5)).length
                        : 0;
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
                        {/* Count badge */}
                        {!isLocked && badgeCount > 0 && (
                          <span className="absolute -top-1 -right-1.5 min-w-[14px] h-3.5 bg-brand rounded-full text-white text-[8px] font-bold flex items-center justify-center px-0.5 leading-none">
                            {badgeCount > 99 ? '99+' : badgeCount}
                          </span>
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

      {/* ── Phase 25: Offline Banner ── */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="bg-amber-500 text-white text-center text-xs font-bold py-2 px-4 flex items-center justify-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {currentLanguage === 'tr'
                ? 'İnternet bağlantısı yok — veriler yüklenemiyor olabilir.'
                : 'No internet connection — data may not load.'}
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
                title={`${(() => {
                  const h = new Date().getHours();
                  if (currentLanguage === 'tr') return h < 12 ? 'Günaydın' : h < 17 ? 'İyi öğlenler' : 'İyi akşamlar';
                  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
                })()}${user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''} ${new Date().getHours() < 12 ? '☀️' : new Date().getHours() < 17 ? '👋' : '🌙'}`}
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
              {(() => {
                const DeltaBadge = ({ delta }: { delta: number | null | undefined }) => {
                  if (delta == null || isNaN(delta)) return null;
                  const up = delta >= 0;
                  return (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${up ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
                      {up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
                    </span>
                  );
                };
                return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: dashT.total_orders, value: filteredOrders.length, icon: Package, color: 'text-blue-500', bg: 'bg-blue-50', sub: `${filteredOrders.filter(o => o.status === 'Pending').length} ${dashT.pending}`, tab: 'orders', delta: summaryData?.orders?.delta },
                  { label: dashT.active_leads, value: filteredLeads.filter(l => !['Closed Won','Closed Lost'].includes(l.status)).length, icon: Users, color: 'text-brand', bg: 'bg-brand/10', sub: `${filteredLeads.length} ${dashT.total}`, tab: 'crm', delta: null },
                  { label: dashT.inventory_label, value: inventory.length, icon: List, color: 'text-purple-500', bg: 'bg-purple-50', sub: `${inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length} ${dashT.low_stock}`, tab: 'inventory', delta: null },
                ].map((kpi, i) => (
                  <button key={i} onClick={() => setActiveTab(kpi.tab)}
                    className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.02] transition-all duration-150 cursor-pointer group">
                    <div className="flex items-start justify-between mb-3">
                      <div className={`w-9 h-9 rounded-xl ${kpi.bg} flex items-center justify-center`}>
                        <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                      </div>
                      <DeltaBadge delta={kpi.delta} />
                    </div>
                    <p className="text-2xl font-bold" style={{color:'var(--text-primary)'}}>{kpi.value}</p>
                    <p className="text-xs font-semibold text-gray-500 mt-1">{kpi.label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{kpi.sub}</p>
                    <p className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                      <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Detaya git' : 'View details'}
                    </p>
                  </button>
                ))}
                {/* Revenue KPI with currency toggle + delta */}
                {(() => {
                  const totalTRY = filteredOrders.reduce((s, o) => s + (o.totalPrice || o.totalAmount || 0), 0);
                  const rate = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
                  const converted = kpiCurrency === 'TRY' ? totalTRY : totalTRY / rate;
                  const symbol = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                  const revDelta = summaryData?.revenue?.delta;
                  return (
                    <div className="apple-card p-4 text-left group">
                      <div className="flex items-center justify-between mb-3">
                        <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
                          <DollarSign className="w-4 h-4 text-green-500" />
                        </div>
                        <div className="flex items-center gap-1.5">
                          {revDelta != null && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${revDelta >= 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
                              {revDelta >= 0 ? '▲' : '▼'} {Math.abs(revDelta).toFixed(1)}%
                            </span>
                          )}
                          <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                            {(['TRY','USD','EUR'] as const).map(c => (
                              <button key={c} onClick={() => setKpiCurrency(c)}
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency===c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                                {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <p className="text-2xl font-bold" style={{color:'var(--text-primary)'}}>{symbol}{converted.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                      <p className="text-xs font-semibold text-gray-500 mt-1">{dashT.total_revenue}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {summaryData ? (currentLanguage === 'tr' ? 'Son 30 gün' : 'Last 30 days') : dashT.all_time}
                      </p>
                      {/* Phase 35: 7-day revenue sparkline */}
                      {(() => {
                        const days = Array.from({ length: 7 }, (_, i) => {
                          const d = new Date(); d.setDate(d.getDate() - (6 - i));
                          const dayStr = d.toDateString();
                          const rev = orders.filter(o => {
                            const od = (o.syncedAt as { toDate?: () => Date })?.toDate?.() ?? (o.createdAt ? new Date(o.createdAt as string | number) : null);
                            return od?.toDateString() === dayStr;
                          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
                          return { day: d.getDate(), rev };
                        });
                        const maxRev = Math.max(...days.map(d => d.rev), 1);
                        return (
                          <div className="flex items-end gap-0.5 mt-2 h-8">
                            {days.map((d, i) => (
                              <div key={i} className="flex-1 flex flex-col justify-end">
                                <div
                                  className="bg-green-400 rounded-sm opacity-60 group-hover:opacity-100 transition-opacity"
                                  style={{ height: `${Math.max((d.rev / maxRev) * 100, 4)}%` }}
                                  title={`${d.day}: ₺${d.rev.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`}
                                />
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      <button onClick={() => setActiveTab('reports')} className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Detaya git' : 'View details'}
                      </button>
                    </div>
                  );
                })()}
              </div>
                );
              })()}

              {/* ── Insight strip: revenue trend + alerts + search CTA ── */}
              {(() => {
                const pendingCount   = orders.filter(o => o.status === 'Pending').length;
                const lowStockCount  = inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5)).length;
                const shippedToday   = orders.filter(o => {
                  const d = (o.syncedAt as { toDate?: () => Date })?.toDate?.() ?? new Date(0);
                  return o.status === 'Shipped' && d.toDateString() === new Date().toDateString();
                }).length;
                const weekRevenue = filteredOrders
                  .filter(o => {
                    const d = (o.syncedAt as { toDate?: () => Date })?.toDate?.() ?? new Date(0);
                    return (Date.now() - d.getTime()) < 7 * 86400000;
                  })
                  .reduce((s, o) => s + o.totalPrice, 0);

                const insightRate   = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
                const insightSymbol = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const cvtWeek = kpiCurrency === 'TRY' ? weekRevenue : weekRevenue / insightRate;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* ── 7-Day Revenue card — with currency toggle ── */}
                    <button
                      onClick={() => setActiveTab('reports')}
                      className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.02] transition-all duration-150 group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                          <TrendingUp className="w-4 h-4 text-emerald-600" />
                        </div>
                        {/* Currency toggle */}
                        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5" onClick={e => e.stopPropagation()}>
                          {(['TRY','USD','EUR'] as const).map(c => (
                            <button key={c} onClick={() => setKpiCurrency(c)}
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency===c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                              {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-xl font-bold text-emerald-600">
                        {insightSymbol}{cvtWeek.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                      </p>
                      <p className="text-[10px] font-semibold text-gray-500 truncate mt-1">{currentLanguage === 'tr' ? '7 Günlük Ciro' : '7-Day Revenue'}</p>
                      <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Bu hafta' : 'This week'}</p>
                    </button>

                    {/* ── Remaining plain cards ── */}
                    {[
                      {
                        icon: Clock,
                        label: currentLanguage === 'tr' ? 'Bekleyen Sipariş' : 'Pending Orders',
                        value: pendingCount,
                        color: pendingCount > 5 ? 'text-amber-600' : 'text-gray-600',
                        bg:   pendingCount > 5 ? 'bg-amber-50' : 'bg-gray-50',
                        sub:  pendingCount > 5 ? (currentLanguage === 'tr' ? '⚠ Acil' : '⚠ Urgent') : (currentLanguage === 'tr' ? 'Normal' : 'Normal'),
                        onClick: () => setActiveTab('orders'),
                      },
                      {
                        icon: AlertTriangle,
                        label: currentLanguage === 'tr' ? 'Düşük Stok' : 'Low Stock',
                        value: lowStockCount,
                        color: lowStockCount > 0 ? 'text-red-600' : 'text-gray-400',
                        bg:   lowStockCount > 0 ? 'bg-red-50' : 'bg-gray-50',
                        sub:  lowStockCount > 0 ? (currentLanguage === 'tr' ? 'Sipariş verilmeli' : 'Reorder needed') : (currentLanguage === 'tr' ? 'Stok yeterli' : 'Stock OK'),
                        onClick: () => setActiveTab('inventory'),
                      },
                      {
                        icon: Truck,
                        label: currentLanguage === 'tr' ? 'Bugün Kargolandı' : 'Shipped Today',
                        value: shippedToday,
                        color: 'text-blue-600',
                        bg:   'bg-blue-50',
                        sub:  currentLanguage === 'tr' ? 'Kargoya verilen' : 'Dispatched',
                        onClick: () => setActiveTab('lojistik'),
                      },
                    ].map((stat, i) => {
                      const Icon = stat.icon;
                      return (
                        <button
                          key={i}
                          onClick={stat.onClick}
                          className="apple-card p-4 flex items-center gap-3 text-left hover:shadow-md hover:scale-[1.02] transition-all duration-150 group"
                        >
                          <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center flex-shrink-0`}>
                            <Icon className={`w-4 h-4 ${stat.color}`} />
                          </div>
                          <div className="min-w-0">
                            <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                            <p className="text-[10px] font-semibold text-gray-500 truncate">{stat.label}</p>
                            <p className="text-[10px] text-gray-400 truncate">{stat.sub}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ── Phase 90: Smart Insights Strip ── */}
              {(() => {
                const insights: { icon: string; text: string; color: string; bg: string; borderColor: string }[] = [];

                // Insight 1: low-stock products
                const lowStock = inventory.filter(i => (i.stock ?? 0) > 0 && (i.stock ?? 0) <= (i.minStock ?? 5));
                if (lowStock.length > 0) {
                  const top = lowStock.sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))[0];
                  insights.push({
                    icon: '📦',
                    text: currentLanguage === 'tr'
                      ? `${top.name} kritik stokta (${top.stock ?? 0} adet kaldı)`
                      : `${top.name} is low in stock (${top.stock ?? 0} left)`,
                    color: 'text-amber-700',
                    bg: 'bg-amber-50',
                    borderColor: 'border-amber-200',
                  });
                }

                // Insight 2: unpaid orders total
                const unpaidOrders = orders.filter(o => !o.paid && o.status !== 'Cancelled');
                if (unpaidOrders.length > 0) {
                  const unpaidTotal = unpaidOrders.reduce((s, o) => s + (o.totalPrice ?? 0), 0);
                  insights.push({
                    icon: '💳',
                    text: currentLanguage === 'tr'
                      ? `${unpaidOrders.length} siparişte ₺${unpaidTotal.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} ödeme bekliyor`
                      : `${unpaidOrders.length} order${unpaidOrders.length > 1 ? 's' : ''} pending payment (₺${unpaidTotal.toLocaleString('tr-TR', { maximumFractionDigits: 0 })})`,
                    color: 'text-red-700',
                    bg: 'bg-red-50',
                    borderColor: 'border-red-200',
                  });
                }

                // Insight 3: overdue leads (no follow-up in 7+ days with Contacted status)
                const now7 = Date.now();
                const overdueleads = leads.filter(l => {
                  if (l.status === 'Closed') return false;
                  const raw = l.updatedAt ?? l.createdAt;
                  if (!raw) return true;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number);
                  return now7 - d.getTime() > 7 * 86400000;
                });
                if (overdueleads.length > 0) {
                  insights.push({
                    icon: '🎯',
                    text: currentLanguage === 'tr'
                      ? `${overdueleads.length} müşteri adayı 7+ gündür güncellenmedi`
                      : `${overdueleads.length} lead${overdueleads.length > 1 ? 's' : ''} haven't been updated in 7+ days`,
                    color: 'text-purple-700',
                    bg: 'bg-purple-50',
                    borderColor: 'border-purple-200',
                  });
                }

                // Insight 4: top revenue month-over-month rise
                const nowD = new Date();
                const thisMonthRev = orders
                  .filter(o => {
                    const raw = o.syncedAt ?? o.createdAt;
                    if (!raw) return false;
                    const d = typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
                    return d.getFullYear() === nowD.getFullYear() && d.getMonth() === nowD.getMonth();
                  })
                  .reduce((s, o) => s + (o.totalPrice ?? 0), 0);
                const lastMonthRev = orders
                  .filter(o => {
                    const raw = o.syncedAt ?? o.createdAt;
                    if (!raw) return false;
                    const d = typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
                    const lm = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1);
                    return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
                  })
                  .reduce((s, o) => s + (o.totalPrice ?? 0), 0);
                if (lastMonthRev > 0 && thisMonthRev > lastMonthRev * 1.1) {
                  const pct = Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100);
                  insights.push({
                    icon: '📈',
                    text: currentLanguage === 'tr'
                      ? `Bu ay gelir geçen aya göre %${pct} artışta`
                      : `Revenue is up ${pct}% vs last month`,
                    color: 'text-emerald-700',
                    bg: 'bg-emerald-50',
                    borderColor: 'border-emerald-200',
                  });
                }

                if (insights.length === 0) return null;

                return (
                  <div className={`rounded-2xl border p-4 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-100 shadow-sm'}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5 ${darkMode ? 'text-white/40' : 'text-gray-400'}`}>
                      ✨ {currentLanguage === 'tr' ? 'Akıllı İçgörüler' : 'Smart Insights'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {insights.slice(0, 4).map((ins, i) => (
                        <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium ${ins.bg} ${ins.borderColor} ${ins.color}`}>
                          <span className="text-sm">{ins.icon}</span>
                          <span>{ins.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 56: MTD Revenue vs. Last Month ── */}
              {orders.length > 0 && (() => {
                const now = new Date();
                const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
                const getOrderDate = (o: Order): Date => {
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return new Date(0);
                  return typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number);
                };
                const mtdRev  = orders.filter(o => getOrderDate(o) >= thisMonthStart).reduce((s, o) => s + (o.totalPrice || 0), 0);
                const lastRev = orders.filter(o => { const d = getOrderDate(o); return d >= lastMonthStart && d <= lastMonthEnd; }).reduce((s, o) => s + (o.totalPrice || 0), 0);
                const pct = lastRev > 0 ? Math.round(((mtdRev - lastRev) / lastRev) * 100) : null;
                const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                const dayProgress = Math.round((now.getDate() / daysInMonth) * 100);
                // On-pace projection
                const projectedRev   = dayProgress > 0 ? Math.round(mtdRev * (100 / dayProgress)) : mtdRev;
                const mtdRate        = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
                const mtdSymbol      = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const cvtMtd         = kpiCurrency === 'TRY' ? mtdRev      : mtdRev / mtdRate;
                const cvtProjected   = kpiCurrency === 'TRY' ? projectedRev : projectedRev / mtdRate;
                const cvtLastRev     = kpiCurrency === 'TRY' ? lastRev     : lastRev / mtdRate;
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
                          {currentLanguage === 'tr' ? 'Bu Ay Ciro (MTD)' : 'Revenue MTD'}
                        </h3>
                        <p className={cn("text-xl font-black mt-0.5", darkMode ? "text-white" : "text-gray-900")}>
                          {mtdSymbol}{cvtMtd.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        {/* Currency toggle — shared kpiCurrency */}
                        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                          {(['TRY','USD','EUR'] as const).map(c => (
                            <button key={c} onClick={() => setKpiCurrency(c)}
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency===c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                              {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                            </button>
                          ))}
                        </div>
                        {pct !== null && (
                          <span className={cn("text-sm font-black px-2 py-1 rounded-xl", pct >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")}>
                            {pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}%
                          </span>
                        )}
                        <p className={cn("text-[10px]", darkMode ? "text-white/40" : "text-gray-400")}>
                          {currentLanguage === 'tr' ? 'Geçen aya göre' : 'vs. last month'}
                        </p>
                      </div>
                    </div>
                    {/* Month progress bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>{currentLanguage === 'tr' ? 'Ay ilerlemesi' : 'Month progress'}: {dayProgress}%</span>
                        <span>{currentLanguage === 'tr' ? 'Projeksiyon' : 'Projected'}: {mtdSymbol}{cvtProjected.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div className={cn("h-2 rounded-full overflow-hidden", darkMode ? "bg-white/10" : "bg-gray-100")}>
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand to-orange-400 transition-all duration-700"
                          style={{ width: `${dayProgress}%` }}
                        />
                      </div>
                      {lastRev > 0 && (
                        <div className="flex justify-between text-[10px] text-gray-400">
                          <span>{currentLanguage === 'tr' ? 'Geçen ay' : 'Last month'}: {mtdSymbol}{cvtLastRev.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 42: Financial KPI mini-strip ── */}
              {(() => {
                const aov = filteredOrders.length > 0
                  ? filteredOrders.reduce((s, o) => s + (o.totalPrice || 0), 0) / filteredOrders.length
                  : 0;
                const deliveryRate = orders.length > 0
                  ? Math.round((orders.filter(o => o.status === 'Delivered').length / orders.length) * 100)
                  : 0;
                const leadConvRate = leads.length > 0
                  ? Math.round((leads.filter(l => l.status === 'Closed' || (l.status as string) === 'Closed Won').length / leads.length) * 100)
                  : 0;
                const repeatBuyers = (() => {
                  const custMap: Record<string, number> = {};
                  for (const o of orders) { custMap[o.customerName] = (custMap[o.customerName] ?? 0) + 1; }
                  return Object.values(custMap).filter(c => c > 1).length;
                })();
                const kpiRate   = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
                const kpiSymbol = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const cvtAov    = kpiCurrency === 'TRY' ? aov : aov / kpiRate;
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* ── AOV card — with currency toggle ── */}
                    <button onClick={() => setActiveTab('reports')}
                      className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.02] transition-all duration-150 group">
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                          <DollarSign className="w-4 h-4 text-emerald-600" />
                        </div>
                        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5" onClick={e => e.stopPropagation()}>
                          {(['TRY','USD','EUR'] as const).map(c => (
                            <button key={c} onClick={() => setKpiCurrency(c)}
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency===c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                              {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-xl font-bold text-emerald-600">
                        {kpiSymbol}{cvtAov.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                      </p>
                      <p className="text-[10px] font-semibold text-gray-500 mt-1">{currentLanguage === 'tr' ? 'Ort. Sipariş Değeri' : 'Avg. Order Value'}</p>
                      <p className="text-[10px] text-gray-400">AOV</p>
                    </button>

                    {/* ── Remaining plain KPI cards ── */}
                    {[
                      {
                        label: currentLanguage === 'tr' ? 'Teslimat Oranı' : 'Delivery Rate',
                        value: `${deliveryRate}%`,
                        sub: `${orders.filter(o => o.status === 'Delivered').length} / ${orders.length}`,
                        icon: CheckCircle2, color: deliveryRate > 80 ? 'text-emerald-600' : 'text-amber-600', bg: deliveryRate > 80 ? 'bg-emerald-50' : 'bg-amber-50',
                        onClick: () => setActiveTab('orders'),
                      },
                      {
                        label: currentLanguage === 'tr' ? 'Müşteri Dönüşümü' : 'Lead Conversion',
                        value: `${leadConvRate}%`,
                        sub: `${leads.filter(l => l.status === 'Closed' || (l.status as string) === 'Closed Won').length} ${currentLanguage === 'tr' ? 'kazanıldı' : 'won'}`,
                        icon: TrendingUp, color: leadConvRate > 20 ? 'text-blue-600' : 'text-gray-400', bg: leadConvRate > 20 ? 'bg-blue-50' : 'bg-gray-50',
                        onClick: () => setActiveTab('crm'),
                      },
                      {
                        label: currentLanguage === 'tr' ? 'Tekrar Eden Alıcı' : 'Repeat Buyers',
                        value: repeatBuyers,
                        sub: currentLanguage === 'tr' ? 'birden fazla sipariş' : 'multiple orders',
                        icon: Users, color: 'text-purple-600', bg: 'bg-purple-50',
                        onClick: () => setActiveTab('crm'),
                      },
                    ].map((stat, i) => {
                      const Icon = stat.icon;
                      return (
                        <button key={i} onClick={stat.onClick}
                          className="apple-card p-4 flex items-center gap-3 text-left hover:shadow-md hover:scale-[1.02] transition-all duration-150 group">
                          <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center flex-shrink-0`}>
                            <Icon className={`w-4 h-4 ${stat.color}`} />
                          </div>
                          <div className="min-w-0">
                            <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                            <p className="text-[10px] font-semibold text-gray-500 truncate">{stat.label}</p>
                            <p className="text-[10px] text-gray-400 truncate">{stat.sub}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ── Phase 43: Order Status Segmented Bar ── */}
              {orders.length > 0 && (() => {
                const statusConfig = [
                  { key: 'Pending',    labelTR: 'Bekliyor',   labelEN: 'Pending',    color: 'bg-amber-400',  textColor: 'text-amber-700',  bg: 'bg-amber-50'  },
                  { key: 'Processing', labelTR: 'Hazırlanıyor', labelEN: 'Processing', color: 'bg-purple-400', textColor: 'text-purple-700', bg: 'bg-purple-50' },
                  { key: 'Shipped',    labelTR: 'Kargoda',    labelEN: 'Shipped',    color: 'bg-blue-400',   textColor: 'text-blue-700',   bg: 'bg-blue-50'   },
                  { key: 'Delivered',  labelTR: 'Teslim',     labelEN: 'Delivered',  color: 'bg-emerald-400',textColor: 'text-emerald-700', bg: 'bg-emerald-50'},
                  { key: 'Cancelled',  labelTR: 'İptal',      labelEN: 'Cancelled',  color: 'bg-gray-300',   textColor: 'text-gray-500',   bg: 'bg-gray-50'   },
                ];
                const total = orders.length;
                const counts = statusConfig.map(s => ({ ...s, count: orders.filter(o => o.status === s.key).length }));
                return (
                  <div className={cn("rounded-2xl border p-5 space-y-3", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
                        {currentLanguage === 'tr' ? 'Sipariş Durumu' : 'Order Status'}
                      </h3>
                      <button onClick={() => setActiveTab('orders')} className="text-[10px] font-semibold text-brand hover:underline">
                        {currentLanguage === 'tr' ? 'Tümünü gör' : 'View all'}
                      </button>
                    </div>
                    {/* Segmented bar */}
                    <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                      {counts.filter(s => s.count > 0).map(s => (
                        <div
                          key={s.key}
                          className={`${s.color} transition-all duration-700 first:rounded-l-full last:rounded-r-full`}
                          style={{ width: `${(s.count / total) * 100}%` }}
                          title={`${s.key}: ${s.count}`}
                        />
                      ))}
                    </div>
                    {/* Legend */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {counts.filter(s => s.count > 0).map(s => (
                        <button key={s.key} onClick={() => setActiveTab('orders')} className="flex items-center gap-1.5 group">
                          <span className={`w-2 h-2 rounded-full ${s.color} flex-shrink-0`} />
                          <span className={cn("text-[11px]", darkMode ? "text-white/60" : "text-gray-500")}>
                            {currentLanguage === 'tr' ? s.labelTR : s.labelEN}
                          </span>
                          <span className={cn("text-[11px] font-bold", darkMode ? "text-white/80" : "text-gray-800")}>{s.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 79: B2B vs Retail Revenue Split ── */}
              {orders.length > 0 && (() => {
                const b2bRev    = orders.filter(o => o.customerType === 'B2B').reduce((s, o) => s + (o.totalPrice || 0), 0);
                const retailRev = orders.filter(o => o.customerType !== 'B2B').reduce((s, o) => s + (o.totalPrice || 0), 0);
                const totalRev  = b2bRev + retailRev;
                if (totalRev === 0) return null;
                const b2bPct    = Math.round((b2bRev    / totalRev) * 100);
                const retailPct = 100 - b2bPct;
                const p79Rate   = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
                const p79Sym    = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const cvtB2B    = kpiCurrency === 'TRY' ? b2bRev    : b2bRev    / p79Rate;
                const cvtRetail = kpiCurrency === 'TRY' ? retailRev : retailRev / p79Rate;
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
                        {currentLanguage === 'tr' ? 'B2B vs Perakende Ciro' : 'B2B vs Retail Revenue'}
                      </h3>
                    </div>
                    {/* Split bar */}
                    <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-3">
                      {b2bPct > 0 && (
                        <div className="bg-blue-500 transition-all duration-700 rounded-l-full" style={{ width: `${b2bPct}%` }} title={`B2B: ${b2bPct}%`} />
                      )}
                      {retailPct > 0 && (
                        <div className="bg-gray-300 transition-all duration-700 rounded-r-full" style={{ width: `${retailPct}%` }} title={`Retail: ${retailPct}%`} />
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-blue-700">B2B — {b2bPct}%</p>
                          <p className="text-[10px] text-gray-400">{p79Sym}{cvtB2B.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm bg-gray-300 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-gray-600">{currentLanguage === 'tr' ? 'Perakende' : 'Retail'} — {retailPct}%</p>
                          <p className="text-[10px] text-gray-400">{p79Sym}{cvtRetail.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ⌘K search shortcut banner */}
              <button
                onClick={() => setGlobalSearchOpen(true)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-all hover:shadow-sm group",
                  darkMode ? "bg-white/5 border-white/10 hover:bg-white/8" : "bg-gray-50 border-gray-100 hover:bg-gray-100/80"
                )}
              >
                <Search className="w-4 h-4 text-gray-400" />
                <span className={cn("flex-1 text-sm", darkMode ? "text-white/40" : "text-gray-400")}>
                  {currentLanguage === 'tr' ? 'Sipariş, müşteri veya ürün ara…' : 'Search orders, leads or products…'}
                </span>
                <kbd className="hidden sm:inline text-[10px] text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded font-mono shadow-sm">⌘K</kbd>
              </button>

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

              {/* ── Phase 24: Today's Agenda ── */}
              {(() => {
                const toShip = orders.filter(o => o.status === 'Processing');
                const staleLeads = leads.filter(l => {
                  if (l.status === 'Closed') return false;
                  const lastTouch = l.updatedAt
                    ? (typeof (l.updatedAt as { toDate?: () => Date }).toDate === 'function'
                        ? (l.updatedAt as { toDate: () => Date }).toDate()
                        : new Date(l.updatedAt as string | number))
                    : (l.createdAt
                        ? (typeof (l.createdAt as { toDate?: () => Date }).toDate === 'function'
                            ? (l.createdAt as { toDate: () => Date }).toDate()
                            : new Date(l.createdAt as string | number))
                        : null);
                  return lastTouch ? (Date.now() - lastTouch.getTime()) > 30 * 86400000 : false;
                });
                const lowStockItems = inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5));
                const agendaItems = [
                  ...toShip.slice(0, 3).map(o => ({
                    key: `ship-${o.id}`,
                    icon: Truck, color: 'text-blue-600' as const, bg: 'bg-blue-50' as const,
                    title: currentLanguage === 'tr' ? `Kargoya ver: ${o.customerName}` : `Ship: ${o.customerName}`,
                    sub: `#${o.shopifyOrderId || o.id?.slice(-6)} · ₺${(o.totalPrice || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`,
                    onClick: () => { setActiveTab('orders'); },
                  })),
                  ...staleLeads.slice(0, 2).map(l => ({
                    key: `lead-${l.id}`,
                    icon: Users, color: 'text-amber-600' as const, bg: 'bg-amber-50' as const,
                    title: currentLanguage === 'tr' ? `Hareketsiz: ${l.name}` : `Stale: ${l.name}`,
                    sub: currentLanguage === 'tr' ? '30+ gündür iletişim yok' : '30+ days no contact',
                    onClick: () => setActiveTab('crm'),
                  })),
                  ...lowStockItems.slice(0, 2).map(i => ({
                    key: `stock-${i.id}`,
                    icon: AlertTriangle, color: 'text-red-600' as const, bg: 'bg-red-50' as const,
                    title: currentLanguage === 'tr' ? `Düşük stok: ${i.name}` : `Low stock: ${i.name}`,
                    sub: `${i.stockLevel ?? 0} / ${i.lowStockThreshold ?? 5} ${currentLanguage === 'tr' ? 'adet' : 'units'}`,
                    onClick: () => setActiveTab('inventory'),
                  })),
                ];
                if (agendaItems.length === 0) return null;
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Bugünün Ajandası' : "Today's Agenda"}
                      </h3>
                      <span className="text-[10px] bg-amber-50 text-amber-600 font-bold px-2 py-0.5 rounded-full">
                        {agendaItems.length} {currentLanguage === 'tr' ? 'eylem' : 'actions'}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {agendaItems.map(item => {
                        const Icon = item.icon;
                        return (
                          <button key={item.key} onClick={item.onClick}
                            className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 text-left transition-colors group">
                            <div className={`w-8 h-8 rounded-lg ${item.bg} flex items-center justify-center flex-shrink-0`}>
                              <Icon className={`w-4 h-4 ${item.color}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-gray-800 truncate">{item.title}</p>
                              <p className="text-[10px] text-gray-400 truncate">{item.sub}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0 transition-colors" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 27: Quick Note / Scratchpad ── */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    {currentLanguage === 'tr' ? 'Hızlı Not' : 'Quick Note'}
                  </h3>
                  {quickNote && (
                    <span className="text-[9px] text-gray-400 font-medium">
                      {currentLanguage === 'tr' ? 'Otomatik kaydediliyor' : 'Auto-saving'}
                    </span>
                  )}
                </div>
                <textarea
                  value={quickNote}
                  onChange={e => handleQuickNoteChange(e.target.value)}
                  rows={4}
                  placeholder={currentLanguage === 'tr' ? 'Hızlı notlarınızı buraya yazın… (otomatik kaydedilir)' : 'Jot something down… (auto-saved locally)'}
                  className="w-full bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-700 placeholder-gray-300 outline-none focus:ring-2 focus:ring-brand/20 resize-none leading-relaxed"
                />
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
                          <p className="text-sm font-bold text-[#1D1D1F]">{kpiCurrency==='TRY'?'₺':kpiCurrency==='USD'?'$':'€'}{(kpiCurrency==='TRY'?(o.totalPrice||o.totalAmount||0):(o.totalPrice||o.totalAmount||0)/(kpiCurrency==='USD'?(exchangeRates?.USD||1):(exchangeRates?.EUR||1))).toLocaleString('tr-TR',{maximumFractionDigits:0})}</p>
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

              {/* ── Phase 47: Inventory Value Summary ── */}
              {inventory.length > 0 && (() => {
                const costValue   = inventory.reduce((s, i) => s + (i.costPrice || i.cost || 0) * (i.stockLevel ?? 0), 0);
                const retailValue = inventory.reduce((s, i) => s + (i.prices?.['Retail'] ?? i.price ?? 0) * (i.stockLevel ?? 0), 0);
                const margin      = retailValue > 0 ? Math.round(((retailValue - costValue) / retailValue) * 100) : 0;
                const totalUnits  = inventory.reduce((s, i) => s + (i.stockLevel ?? 0), 0);
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                        <Package className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Stok Değeri Özeti' : 'Inventory Value'}
                      </h3>
                      <button onClick={() => setActiveTab('inventory')} className="text-[10px] font-semibold text-brand hover:underline">
                        {currentLanguage === 'tr' ? 'Stoka git' : 'View inventory'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {(() => {
                        const ivRate = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
                        const ivSym  = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                        const cvCost   = kpiCurrency === 'TRY' ? costValue   : costValue   / ivRate;
                        const cvRetail = kpiCurrency === 'TRY' ? retailValue : retailValue / ivRate;
                        return [
                        { label: currentLanguage === 'tr' ? 'Maliyet Değeri' : 'Cost Value',   value: `${ivSym}${cvCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`,   color: 'text-gray-800',    sub: currentLanguage === 'tr' ? 'stok maliyeti' : 'at cost' },
                        { label: currentLanguage === 'tr' ? 'Satış Değeri'  : 'Retail Value',  value: `${ivSym}${cvRetail.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`,  color: 'text-emerald-700', sub: currentLanguage === 'tr' ? 'tavsiye fiyat' : 'at retail' },
                        { label: currentLanguage === 'tr' ? 'Brüt Marj'     : 'Gross Margin',  value: `${margin}%`,  color: margin >= 30 ? 'text-emerald-600' : margin >= 15 ? 'text-amber-600' : 'text-red-600', sub: currentLanguage === 'tr' ? 'teorik oran' : 'theoretical' },
                        { label: currentLanguage === 'tr' ? 'Toplam Adet'   : 'Total Units',   value: totalUnits.toLocaleString('tr-TR'), color: 'text-blue-700', sub: currentLanguage === 'tr' ? 'stokta' : 'in stock' },
                        ].map((stat, i) => (
                          <div key={i} className={cn("rounded-xl p-3 text-center", darkMode ? "bg-white/5" : "bg-gray-50")}>
                            <p className={`text-lg font-black ${stat.color}`}>{stat.value}</p>
                            <p className={cn("text-[10px] font-bold mt-0.5 truncate", darkMode ? "text-white/50" : "text-gray-500")}>{stat.label}</p>
                            <p className={cn("text-[9px] mt-0.5", darkMode ? "text-white/30" : "text-gray-400")}>{stat.sub}</p>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                );
              })()}

              {/* ── 6-Month Revenue Trend + Top Products ── */}
              {(() => {
                // Build last-6-month buckets
                const now6 = new Date();
                const months: { key: string; label: string; revenue: number; orders: number }[] = [];
                for (let i = 5; i >= 0; i--) {
                  const d = new Date(now6.getFullYear(), now6.getMonth() - i, 1);
                  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                  const short = d.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
                  months.push({ key, label: short, revenue: 0, orders: 0 });
                }
                for (const o of orders) {
                  const raw = o.createdAt;
                  const d = raw
                    ? (typeof raw === 'string' ? new Date(raw) : (raw as { toDate?: () => Date }).toDate?.() ?? new Date())
                    : new Date();
                  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                  const bucket = months.find(m => m.key === key);
                  if (bucket) { bucket.revenue += o.totalPrice; bucket.orders++; }
                }

                // Top-5 products by order line count
                const productCount: Record<string, { name: string; count: number; revenue: number }> = {};
                for (const o of orders) {
                  for (const li of (o.lineItems || [])) {
                    const k = (li as { sku?: string; name?: string; title?: string }).sku || (li as { name?: string }).name || 'Unknown';
                    productCount[k] = productCount[k] || { name: (li as { name?: string; title?: string }).name || (li as { title?: string }).title || k, count: 0, revenue: 0 };
                    productCount[k].count += (li as { quantity?: number }).quantity || 1;
                    productCount[k].revenue += ((li as { price?: number }).price || 0) * ((li as { quantity?: number }).quantity || 1);
                  }
                }
                const top5 = Object.values(productCount).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
                const maxRevTop = Math.max(...top5.map(p => p.revenue), 1);

                const totalRevAll = months.reduce((s, m) => s + m.revenue, 0);
                const totalOrdAll = months.reduce((s, m) => s + m.orders, 0);

                return (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Trend chart — takes 2 cols */}
                    <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                          {currentLanguage === 'tr' ? '6 Aylık Ciro Trendi' : '6-Month Revenue Trend'}
                        </h3>
                        <div className="flex items-center gap-3 text-[10px] text-gray-400">
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-brand inline-block" />{currentLanguage === 'tr' ? 'Ciro' : 'Revenue'}</span>
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-300 inline-block" />{currentLanguage === 'tr' ? 'Sipariş' : 'Orders'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mb-3">
                        <div>
                          {(() => {
                            const r6Rate = kpiCurrency === 'USD' ? (exchangeRates?.USD||1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR||1) : 1;
                            const r6Sym  = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                            const r6Val  = kpiCurrency === 'TRY' ? totalRevAll : totalRevAll / r6Rate;
                            return <p className="text-xl font-bold text-gray-900">{r6Sym}{r6Val.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>;
                          })()}
                          <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? '6 ay toplam ciro' : '6-month total revenue'}</p>
                        </div>
                        <div className="w-px h-8 bg-gray-100" />
                        <div>
                          <p className="text-xl font-bold text-blue-600">{totalOrdAll}</p>
                          <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'toplam sipariş' : 'total orders'}</p>
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={160}>
                        <AreaChart data={months} margin={{ top: 0, right: 4, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#ff4000" stopOpacity={0.18} />
                              <stop offset="95%" stopColor="#ff4000" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="gradOrd" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.15} />
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#86868b' }} axisLine={false} tickLine={false} />
                          <YAxis yAxisId="rev" tick={{ fontSize: 9, fill: '#86868b' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                          <YAxis yAxisId="ord" orientation="right" tick={{ fontSize: 9, fill: '#86868b' }} axisLine={false} tickLine={false} />
                          <Tooltip
                            formatter={(value: number, name: string) =>
                              name === 'revenue'
                                ? [`₺${value.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, currentLanguage === 'tr' ? 'Ciro' : 'Revenue']
                                : [value, currentLanguage === 'tr' ? 'Sipariş' : 'Orders']
                            }
                            contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid #f0f0f0' }}
                          />
                          <Area yAxisId="rev" type="monotone" dataKey="revenue" stroke="#ff4000" strokeWidth={2} fill="url(#gradRev)" dot={{ r: 3, fill: '#ff4000' }} />
                          <Area yAxisId="ord" type="monotone" dataKey="orders"  stroke="#3b82f6" strokeWidth={2} fill="url(#gradOrd)" dot={{ r: 3, fill: '#3b82f6' }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Top products — 1 col */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">
                        {currentLanguage === 'tr' ? 'En Çok Satan Ürünler' : 'Top Products'}
                      </h3>
                      {top5.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-6">{currentLanguage === 'tr' ? 'Sipariş verisi yok' : 'No order data'}</p>
                      ) : (
                        <div className="space-y-3">
                          {top5.map((p, i) => (
                            <div key={i} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-700 truncate max-w-[140px]">{p.name}</span>
                                <span className="text-[10px] font-bold text-gray-500">{kpiCurrency==='TRY'?'₺':kpiCurrency==='USD'?'$':'€'}{(kpiCurrency==='TRY'?p.revenue:p.revenue/(kpiCurrency==='USD'?(exchangeRates?.USD||1):(exchangeRates?.EUR||1))).toLocaleString('tr-TR',{maximumFractionDigits:0})}</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-1.5">
                                <div
                                  className="bg-brand h-1.5 rounded-full transition-all"
                                  style={{ width: `${Math.round((p.revenue / maxRevTop) * 100)}%` }}
                                />
                              </div>
                              <p className="text-[10px] text-gray-400">{p.count} {currentLanguage === 'tr' ? 'adet' : 'units'}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Lead Pipeline Funnel */}
              {(() => {
                const STAGES = [
                  { key: 'New',         label: dashT.lead_labels['New'],         bar: 'bg-gray-400',    text: 'text-gray-600',   bg: 'bg-gray-50' },
                  { key: 'Contacted',   label: dashT.lead_labels['Contacted'],   bar: 'bg-blue-500',    text: 'text-blue-700',   bg: 'bg-blue-50' },
                  { key: 'Qualified',   label: dashT.lead_labels['Qualified'],   bar: 'bg-purple-500',  text: 'text-purple-700', bg: 'bg-purple-50' },
                  { key: 'Proposal',    label: dashT.lead_labels['Proposal'],    bar: 'bg-yellow-500',  text: 'text-yellow-700', bg: 'bg-yellow-50' },
                  { key: 'Negotiation', label: dashT.lead_labels['Negotiation'], bar: 'bg-orange-500',  text: 'text-orange-700', bg: 'bg-orange-50' },
                  { key: 'Closed Won',  label: dashT.lead_labels['Closed Won'],  bar: 'bg-green-500',   text: 'text-green-700',  bg: 'bg-green-50' },
                ] as const;
                const counts = STAGES.map(s => leads.filter(l => l.status === s.key).length);
                const maxCount = Math.max(...counts, 1);
                const totalActive = counts.slice(0, 5).reduce((a, b) => a + b, 0);
                const wonRate = totalActive > 0 ? ((counts[5] / (totalActive + counts[5])) * 100).toFixed(0) : '0';
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">{dashT.lead_summary}</h3>
                      <span className="text-xs font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
                        {currentLanguage === 'tr' ? `Win Rate: ${wonRate}%` : `Win Rate: ${wonRate}%`}
                      </span>
                    </div>
                    <div className="space-y-2.5">
                      {STAGES.map((stage, i) => {
                        const count = counts[i];
                        const pct = Math.round((count / maxCount) * 100);
                        const convPct = i > 0 && counts[i - 1] > 0 ? Math.round((count / counts[i - 1]) * 100) : null;
                        return (
                          <div key={stage.key}>
                            <div className="flex items-center gap-3">
                              <span className={`text-[10px] font-bold w-20 flex-shrink-0 ${stage.text}`}>{stage.label}</span>
                              <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                                <div
                                  className={`h-full ${stage.bar} rounded-full transition-all duration-500`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-sm font-bold text-gray-800 w-6 text-right">{count}</span>
                              {convPct !== null && (
                                <span className={`text-[9px] font-bold w-10 text-right ${convPct >= 50 ? 'text-green-500' : 'text-gray-400'}`}>
                                  {convPct}%↓
                                </span>
                              )}
                              {convPct === null && <span className="w-10" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between text-[10px] text-gray-400">
                      <span>{currentLanguage === 'tr' ? `Toplam: ${leads.length} müşteri adayı` : `Total: ${leads.length} leads`}</span>
                      <button onClick={() => setActiveTab('crm')} className="text-brand font-semibold hover:underline flex items-center gap-0.5">
                        {currentLanguage === 'tr' ? 'CRM\'e git' : 'Open CRM'} <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 51: Upcoming Follow-ups (7-day strip) ── */}
              {(() => {
                const today7 = new Date(); today7.setHours(0, 0, 0, 0);
                const in7 = new Date(today7.getTime() + 7 * 86400000);
                const upcoming = leads
                  .filter(l => {
                    if (!l.nextFollowUpDate) return false;
                    const due = typeof (l.nextFollowUpDate as { toDate?: () => Date }).toDate === 'function'
                      ? (l.nextFollowUpDate as { toDate: () => Date }).toDate()
                      : new Date(l.nextFollowUpDate as unknown as string | number);
                    return due >= today7 && due <= in7;
                  })
                  .sort((a, b) => {
                    const getDate = (x: unknown) => typeof (x as { toDate?: () => Date }).toDate === 'function'
                      ? (x as { toDate: () => Date }).toDate()
                      : new Date(x as string | number);
                    return getDate(a.nextFollowUpDate).getTime() - getDate(b.nextFollowUpDate).getTime();
                  });
                if (upcoming.length === 0) return null;
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                        <Calendar className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? '7 Günlük Takip Planı' : '7-Day Follow-up Plan'}
                      </h3>
                      <button onClick={() => { setActiveTab('crm'); setCrmTab('leads'); }} className="text-[10px] font-semibold text-brand hover:underline">
                        {currentLanguage === 'tr' ? 'CRM\'e git' : 'Go to CRM'}
                      </button>
                    </div>
                    <div className="space-y-2">
                      {upcoming.slice(0, 5).map(l => {
                        const due = typeof (l.nextFollowUpDate as { toDate?: () => Date }).toDate === 'function'
                          ? (l.nextFollowUpDate as { toDate: () => Date }).toDate()
                          : new Date(l.nextFollowUpDate as unknown as string | number);
                        const daysLeft = Math.round((due.getTime() - today7.getTime()) / 86400000);
                        return (
                          <button key={l.id} onClick={() => { setActiveTab('crm'); setSelectedLead(l); }}
                            className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors", darkMode ? "hover:bg-white/5" : "hover:bg-gray-50")}>
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-black ${daysLeft === 0 ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>
                              {daysLeft === 0 ? (currentLanguage === 'tr' ? 'BUG' : 'NOW') : `${daysLeft}g`}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={cn("text-sm font-semibold truncate", darkMode ? "text-white/90" : "text-gray-800")}>{l.name}</p>
                              <p className={cn("text-[10px] truncate", darkMode ? "text-white/40" : "text-gray-400")}>{l.company}</p>
                            </div>
                            <p className={cn("text-[11px] font-bold flex-shrink-0", darkMode ? "text-white/50" : "text-gray-400")}>
                              {due.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', day: 'numeric' })}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 77: Top Customers by Revenue ── */}
              {orders.length > 0 && (() => {
                const custMap: Record<string, { revenue: number; orders: number }> = {};
                for (const o of orders) {
                  const k = o.customerName;
                  custMap[k] = custMap[k] || { revenue: 0, orders: 0 };
                  custMap[k].revenue += o.totalPrice || 0;
                  custMap[k].orders  += 1;
                }
                const top5 = Object.entries(custMap)
                  .map(([name, d]) => ({ name, ...d }))
                  .sort((a, b) => b.revenue - a.revenue)
                  .slice(0, 5);
                if (top5.length === 0) return null;
                const maxRev = top5[0].revenue;
                const mtdTopRate   = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
                const mtdTopSymbol = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                        {currentLanguage === 'tr' ? 'En Yüksek Cirolu Müşteriler' : 'Top Customers by Revenue'}
                      </h3>
                      <button onClick={() => setActiveTab('reports')} className="text-[10px] font-semibold text-brand hover:underline">
                        {currentLanguage === 'tr' ? 'Raporlara git' : 'Open Reports'}
                      </button>
                    </div>
                    <div className="space-y-3">
                      {top5.map((c, i) => {
                        const pct     = Math.round((c.revenue / maxRev) * 100);
                        const cvtRev  = kpiCurrency === 'TRY' ? c.revenue : c.revenue / mtdTopRate;
                        const medal   = ['🥇','🥈','🥉','',''][i] || '';
                        return (
                          <div key={c.name} className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-gray-700 truncate flex items-center gap-1.5">
                                {medal && <span className="text-sm leading-none">{medal}</span>}
                                {c.name}
                              </span>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-[10px] text-gray-400">{c.orders} {currentLanguage === 'tr' ? 'sip.' : 'ord.'}</span>
                                <span className="text-[10px] font-bold text-gray-700">
                                  {mtdTopSymbol}{cvtRev.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                                </span>
                              </div>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full transition-all duration-700 ${i === 0 ? 'bg-brand' : 'bg-gray-300'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 73: Weekday Order Heatmap ── */}
              {orders.length > 0 && (() => {
                const DAYS_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
                const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const counts = Array(7).fill(0);
                for (const o of orders) {
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) continue;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number | Date);
                  counts[d.getDay()] += 1;
                }
                const maxC = Math.max(...counts, 1);
                const totalO = counts.reduce((a, b) => a + b, 0);
                const busiest = counts.indexOf(Math.max(...counts));
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                        {currentLanguage === 'tr' ? 'Haftalık Sipariş Dağılımı' : 'Orders by Weekday'}
                      </h3>
                      <span className="text-[10px] font-bold text-brand bg-brand/10 px-2 py-0.5 rounded-full">
                        {currentLanguage === 'tr' ? `En yoğun: ${DAYS_TR[busiest]}` : `Busiest: ${DAYS_EN[busiest]}`}
                      </span>
                    </div>
                    <div className="flex items-end gap-2">
                      {counts.map((c, i) => {
                        const pct = Math.round((c / maxC) * 100);
                        const isToday = i === new Date().getDay();
                        const isBusiest = i === busiest;
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                            {/* Bar */}
                            <div className="w-full flex items-end justify-center" style={{ height: 64 }}>
                              <div
                                className={`w-full rounded-t-lg transition-all duration-700 ${
                                  isBusiest ? 'bg-brand' : isToday ? 'bg-brand/50' : 'bg-gray-200'
                                }`}
                                style={{ height: `${Math.max(pct, 6)}%` }}
                              />
                            </div>
                            {/* Count */}
                            <span className={`text-[10px] font-bold ${isBusiest ? 'text-brand' : 'text-gray-600'}`}>{c}</span>
                            {/* Day label */}
                            <span className={`text-[9px] font-semibold ${isToday ? 'text-brand' : 'text-gray-400'}`}>
                              {currentLanguage === 'tr' ? DAYS_TR[i] : DAYS_EN[i]}
                              {isToday && <span className="block w-1 h-1 rounded-full bg-brand mx-auto mt-0.5" />}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-3">
                      {currentLanguage === 'tr'
                        ? `${totalO} siparişin haftanın günlerine göre dağılımı`
                        : `Distribution of ${totalO} orders across weekdays`}
                    </p>
                  </div>
                );
              })()}

              {/* ── Phase 38: Recently Viewed ── */}
              {recentlyViewed.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <History className="w-4 h-4" />
                    {currentLanguage === 'tr' ? 'Son Görüntülenenler' : 'Recently Viewed'}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {recentlyViewed.map(item => (
                      <button key={item.id}
                        onClick={() => {
                          setActiveTab(item.tab);
                          if (item.type === 'order') {
                            const o = orders.find(o => o.id === item.id);
                            if (o) setSelectedOrder(o);
                          } else if (item.type === 'lead') {
                            const l = leads.find(l => l.id === item.id);
                            if (l) setSelectedLead(l);
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-full text-xs font-medium text-gray-700 transition-colors"
                      >
                        {item.type === 'order' ? <Package className="w-3 h-3 text-blue-400 flex-shrink-0" />
                          : item.type === 'lead' ? <Users className="w-3 h-3 text-brand flex-shrink-0" />
                          : <List className="w-3 h-3 text-purple-400 flex-shrink-0" />}
                        <span className="truncate max-w-[140px]">{item.label}</span>
                      </button>
                    ))}
                    <button onClick={() => { setRecentlyViewed([]); localStorage.removeItem('cetpa-recent'); }}
                      className="text-[10px] text-gray-400 hover:text-gray-600 px-2 py-1.5 ml-auto self-center transition-colors">
                      {currentLanguage === 'tr' ? 'Temizle' : 'Clear'}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ── Reports Dashboard ── */}
          {activeTab === 'reports' && (
            <motion.div key="reports" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              {!canAccess('reports') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Raporlar':'Reports'} /> : (
                <>
                  {!hasFullAccess('reports') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  {/* ── Export toolbar ── */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Dışa Aktar:' : 'Export:'}</span>
                    <button onClick={() => exportOrdersCSV(orders, currentLanguage)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold transition-colors">
                      <Download className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Siparişler' : 'Orders'}
                    </button>
                    <button onClick={() => exportLeadsCSV(leads, currentLanguage)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold transition-colors">
                      <Download className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Müşteriler' : 'Leads'}
                    </button>
                    <button onClick={() => exportInventoryCSV(inventory, currentLanguage)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold transition-colors">
                      <Download className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Envanter' : 'Inventory'}
                    </button>
                    {/* Phase 63: Full Report PDF */}
                    <button
                      onClick={() => {
                        import('jspdf').then(({ jsPDF }) => {
                          import('jspdf-autotable').then(({ default: autoTable }) => {
                            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                            const tr63 = currentLanguage === 'tr';
                            const today63 = new Date().toLocaleDateString(tr63 ? 'tr-TR' : 'en-US');
                            // Cover
                            pdf.setFillColor(26, 58, 92);
                            pdf.rect(0, 0, 210, 40, 'F');
                            pdf.setTextColor(255, 255, 255);
                            pdf.setFontSize(18); pdf.setFont('helvetica', 'bold');
                            pdf.text('CETPA', 14, 18);
                            pdf.setFontSize(10); pdf.setFont('helvetica', 'normal');
                            pdf.text(tr63 ? 'Yönetim Raporu' : 'Management Report', 14, 26);
                            pdf.text(today63, 14, 34);
                            pdf.setTextColor(0, 0, 0);
                            // Section 1: Orders
                            pdf.setFontSize(12); pdf.setFont('helvetica', 'bold');
                            pdf.text(tr63 ? 'Sipariş Özeti' : 'Order Summary', 14, 52);
                            const totalRev = orders.reduce((s, o) => s + (o.totalPrice || 0), 0);
                            autoTable(pdf, {
                              startY: 56,
                              head: [[tr63 ? 'Durum' : 'Status', tr63 ? 'Adet' : 'Count', tr63 ? 'Oran' : 'Share']],
                              body: ['Pending','Processing','Shipped','Delivered','Cancelled'].map(s => [
                                s, orders.filter(o => o.status === s).length,
                                `${orders.length > 0 ? Math.round((orders.filter(o => o.status === s).length / orders.length) * 100) : 0}%`
                              ]),
                              styles: { fontSize: 9 },
                            });
                            // Section 2: Top Customers
                            const finalY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
                            pdf.setFontSize(12); pdf.setFont('helvetica', 'bold');
                            pdf.text(tr63 ? 'En Yüksek Cirolu Müşteriler' : 'Top Customers by Revenue', 14, finalY);
                            const custMap: Record<string, number> = {};
                            for (const o of orders) { custMap[o.customerName] = (custMap[o.customerName] ?? 0) + (o.totalPrice || 0); }
                            const top5 = Object.entries(custMap).sort(([, a], [, b]) => b - a).slice(0, 5);
                            autoTable(pdf, {
                              startY: finalY + 4,
                              head: [[tr63 ? 'Müşteri' : 'Customer', tr63 ? 'Ciro' : 'Revenue', tr63 ? 'Pay' : 'Share']],
                              body: top5.map(([name, rev]) => [name, `₺${rev.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, `${totalRev > 0 ? Math.round((rev / totalRev) * 100) : 0}%`]),
                              styles: { fontSize: 9 },
                            });
                            // Section 3: Inventory highlights
                            const finalY2 = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
                            pdf.setFontSize(12); pdf.setFont('helvetica', 'bold');
                            pdf.text(tr63 ? 'Kritik Stok Uyarıları' : 'Critical Stock Alerts', 14, finalY2);
                            const lowStock = inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5)).slice(0, 10);
                            autoTable(pdf, {
                              startY: finalY2 + 4,
                              head: [['SKU', tr63 ? 'Ürün' : 'Product', tr63 ? 'Stok' : 'Stock', tr63 ? 'Min' : 'Min']],
                              body: lowStock.map(i => [i.sku, i.name, i.stockLevel ?? 0, i.lowStockThreshold ?? 5]),
                              styles: { fontSize: 9 },
                            });
                            pdf.save(`cetpa-rapor-${new Date().toISOString().split('T')[0]}.pdf`);
                          });
                        });
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-300 bg-[#1a3a5c] hover:bg-[#243f60] text-white text-xs font-semibold transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'PDF Rapor' : 'PDF Report'}
                    </button>
                    <button
                      onClick={() => {
                        // Build monthly summary from orders
                        const monthMap = new Map<string, MonthlySummaryRow>();
                        for (const o of orders) {
                          const raw = o.createdAt;
                          const date = raw
                            ? (typeof raw === 'string' ? new Date(raw) : (raw as { toDate?: () => Date }).toDate?.() ?? new Date())
                            : new Date();
                          const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                          const row = monthMap.get(month) ?? { month, orderCount: 0, revenue: 0, newLeads: 0, delivered: 0 };
                          row.orderCount++;
                          row.revenue += o.totalPrice;
                          if (o.status === 'Delivered') row.delivered++;
                          monthMap.set(month, row);
                        }
                        for (const l of leads) {
                          const raw = l.createdAt;
                          const date = raw
                            ? (typeof raw === 'string' ? new Date(raw) : (raw as { toDate?: () => Date }).toDate?.() ?? new Date())
                            : new Date();
                          const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                          const row = monthMap.get(month) ?? { month, orderCount: 0, revenue: 0, newLeads: 0, delivered: 0 };
                          row.newLeads++;
                          monthMap.set(month, row);
                        }
                        exportMonthlySummaryCSV(
                          [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
                          currentLanguage
                        );
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-brand/30 bg-brand/5 hover:bg-brand/10 text-brand text-xs font-semibold transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" /> {currentLanguage === 'tr' ? 'Aylık Özet' : 'Monthly Summary'}
                    </button>
                  </div>

                  <ReportsDashboard orders={orders} inventory={inventory} exchangeRates={exchangeRates} currentT={currentT} currentLanguage={currentLanguage} userRole={userRole} onNavigate={setActiveTab} employees={employees} />
                  {/* ── AI Demand Forecast ── */}
                  <div className="bg-white rounded-2xl border border-gray-100 p-6">
                    <DemandForecastPanel currentLanguage={currentLanguage} />
                  </div>
                </>
              )}
            </motion.div>
          )}

          {/* ── Muhasebe & Finans ── */}
          {activeTab === 'muhasebe' && (
            <motion.div key="muhasebe" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('muhasebe') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Muhasebe & Finans':'Accounting & Finance'} /> : (
                <>
                  {!hasFullAccess('muhasebe') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'Muhasebe & Finans' : 'Accounting & Finance'}
                    subtitle={currentLanguage === 'tr' ? 'Finansal kayıtları, sabit kıymetler, maliyet merkezleri ve tahsilatları yönetin.' : 'Manage financial records, fixed assets, cost centers and collections.'}
                    icon={Calculator}
                  />

                  {/* ── Sub-tab navigation ── */}
                  <div className="flex gap-1.5 overflow-x-auto pb-1 hide-scrollbar">
                    {([
                      { id: 'genel',        label: currentLanguage === 'tr' ? 'Genel Muhasebe'   : 'General Ledger',    icon: Calculator },
                      { id: 'tahsilat',     label: currentLanguage === 'tr' ? 'Tahsilat Takibi'  : 'Collections',       icon: DollarSign },
                      { id: 'sabit-kiymet', label: currentLanguage === 'tr' ? 'Sabit Kıymetler'  : 'Fixed Assets',      icon: Package },
                      { id: 'maliyet',      label: currentLanguage === 'tr' ? 'Maliyet Merkezleri': 'Cost Centers',     icon: BarChart3 },
                    ] as { id: typeof muhasebeTab; label: string; icon: React.ElementType }[]).map(tab => {
                      const Icon = tab.icon;
                      const isActive = muhasebeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setMuhasebeTab(tab.id)}
                          className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${isActive ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* ── Genel Muhasebe ── */}
                  {muhasebeTab === 'genel' && (
                    <motion.div key="muhasebe-genel" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                      <AccountingModule orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('muhasebe')} userRole={userRole} exchangeRates={exchangeRates} createNotification={createNotification} warehouses={warehouses} employees={employees} />
                      {/* ── Vade Analizi (AR Aging) ── */}
                      <div>
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-1.5">
                          <span>{currentLanguage === 'tr' ? 'Vade Analizi & Cari Ekstre' : 'AR Aging & Account Statement'}</span>
                        </h4>
                        <CariEkstrePanel currentLanguage={currentLanguage} />
                      </div>
                    </motion.div>
                  )}

                  {/* ── Tahsilat Takibi ── */}
                  {muhasebeTab === 'tahsilat' && (
                    <motion.div key="muhasebe-tahsilat" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      <TahsilatModule
                        currentLanguage={currentLanguage as 'tr' | 'en'}
                        isAuthenticated={!!user && hasFullAccess('muhasebe')}
                      />
                    </motion.div>
                  )}

                  {/* ── Sabit Kıymetler ── */}
                  {muhasebeTab === 'sabit-kiymet' && (
                    <motion.div key="muhasebe-sabit" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      <SabitKiymetModule
                        currentLanguage={currentLanguage as 'tr' | 'en'}
                        isAuthenticated={!!user && hasFullAccess('muhasebe')}
                      />
                    </motion.div>
                  )}

                  {/* ── Maliyet Merkezleri ── */}
                  {muhasebeTab === 'maliyet' && (
                    <motion.div key="muhasebe-maliyet" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      <MaliyetMerkeziModule
                        currentLanguage={currentLanguage as 'tr' | 'en'}
                        isAuthenticated={!!user && hasFullAccess('muhasebe')}
                      />
                    </motion.div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* ── Satın Alma ── */}
          {activeTab === 'satin-alma' && (
            <motion.div key="satin-alma" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('satin-alma') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Satın Alma':'Purchasing'} /> : (
                <>
                  {!hasFullAccess('satin-alma') && <ReadOnlyBanner currentLanguage={currentLanguage} />}

                  {/* ── Sub-tab switcher ── */}
                  <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
                    {([
                      { key: 'pos',       label: currentLanguage === 'tr' ? 'Satın Alma Siparişleri' : 'Purchase Orders', icon: ShoppingCart },
                      { key: 'suppliers', label: currentLanguage === 'tr' ? 'Tedarikçiler' : 'Suppliers',         icon: Building2     },
                    ] as { key: 'pos' | 'suppliers'; label: string; icon: React.ElementType }[]).map(t => (
                      <button key={t.key} onClick={() => setPurchasingSubTab(t.key)}
                        className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                          purchasingSubTab === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700')}>
                        <t.icon className="w-4 h-4" /> {t.label}
                      </button>
                    ))}
                  </div>

                  {/* Purchase Orders */}
                  {purchasingSubTab === 'pos' && (
                    <div className="space-y-4">
                      {/* ── Phase 62: Purchasing Spend Trend ── */}
                      {orders.length > 0 && (() => {
                        // Approximate COGS trend from orders costPrice × quantities
                        const months: { label: string; cost: number }[] = [];
                        const now = new Date();
                        for (let i = 5; i >= 0; i--) {
                          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                          const label = d.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
                          const cost = orders.filter(o => {
                            const raw = o.createdAt ?? o.syncedAt;
                            if (!raw) return false;
                            const od = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                              ? (raw as { toDate: () => Date }).toDate()
                              : new Date(raw as string | number);
                            return `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}` === key;
                          }).reduce((s, o) => s + (o.lineItems ?? []).reduce((ls, li) => ls + ((li.costPrice ?? 0) * li.quantity), 0), 0);
                          months.push({ label, cost });
                        }
                        const maxCost = Math.max(...months.map(m => m.cost), 1);
                        const totalCost6m = months.reduce((s, m) => s + m.cost, 0);
                        if (totalCost6m === 0) return null;
                        return (
                          <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                            <div className="flex items-center justify-between mb-4">
                              <h3 className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                                <BarChart3 className="w-3.5 h-3.5" />
                                {currentLanguage === 'tr' ? '6 Aylık Maliyet Trendi' : '6-Month Cost Trend'}
                              </h3>
                              <span className={cn("text-xs font-bold", darkMode ? "text-white/70" : "text-gray-700")}>
                                {kpiCurrency==='TRY'?'₺':kpiCurrency==='USD'?'$':'€'}{(kpiCurrency==='TRY'?totalCost6m:totalCost6m/(kpiCurrency==='USD'?(exchangeRates?.USD||1):(exchangeRates?.EUR||1))).toLocaleString('tr-TR',{maximumFractionDigits:0})}
                              </span>
                            </div>
                            <div className="flex items-end gap-1.5 h-16">
                              {months.map((m, i) => (
                                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                  <div
                                    className={cn("w-full rounded-t-md transition-all duration-700", m.cost > 0 ? "bg-emerald-400" : darkMode ? "bg-white/10" : "bg-gray-100")}
                                    style={{ height: `${Math.max((m.cost / maxCost) * 100, m.cost > 0 ? 8 : 4)}%` }}
                                    title={`₺${m.cost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`}
                                  />
                                  <span className={cn("text-[9px] font-semibold", darkMode ? "text-white/40" : "text-gray-400")}>{m.label}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                      <PurchasingModule
                        currentLanguage={currentLanguage}
                        isAuthenticated={!!user && hasFullAccess('satin-alma')}
                        userRole={userRole}
                        inventory={inventory}
                        orders={orders}
                        onNavigate={setActiveTab}
                        exchangeRates={exchangeRates}
                      />
                    </div>
                  )}

                  {/* ── Phase 29: Supplier Directory ── */}
                  {purchasingSubTab === 'suppliers' && (
                    <div className="space-y-4">
                      <ModuleHeader
                        title={currentLanguage === 'tr' ? 'Tedarikçi Rehberi' : 'Supplier Directory'}
                        subtitle={currentLanguage === 'tr' ? 'Tedarikçi firmalar ve iletişim bilgileri' : 'Supplier companies and contact details'}
                        icon={Building2}
                        actionButton={
                          hasFullAccess('satin-alma') && (
                            <button onClick={() => { setAddingSupplier(true); setNewSupplier({}); }}
                              className="apple-button-primary flex items-center gap-2">
                              <Plus className="w-4 h-4" />
                              {currentLanguage === 'tr' ? 'Yeni Tedarikçi' : 'New Supplier'}
                            </button>
                          )
                        }
                      />

                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                        <input
                          value={supplierSearch}
                          onChange={e => setSupplierSearch(e.target.value)}
                          placeholder={currentLanguage === 'tr' ? 'Tedarikçi ara…' : 'Search suppliers…'}
                          className="apple-input pl-10 w-full"
                        />
                      </div>

                      {/* Supplier Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {suppliers
                          .filter(s => !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase()) || (s.company ?? '').toLowerCase().includes(supplierSearch.toLowerCase()))
                          .map(s => (
                            <div key={s.id} className="apple-card p-5 space-y-3 group">
                              <div className="flex items-start justify-between gap-2">
                                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                                  <Building2 className="w-5 h-5 text-emerald-600" />
                                </div>
                                {hasFullAccess('satin-alma') && (
                                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => { setEditingSupplier(s); setNewSupplier({ ...s }); setAddingSupplier(true); }}
                                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700">
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={() => void handleDeleteSupplier(s.id)}
                                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className="font-bold text-gray-900 text-sm">{s.name}</p>
                                {s.company && <p className="text-[11px] text-gray-500 mt-0.5">{s.company}</p>}
                              </div>
                              <div className="space-y-1.5 text-[11px] text-gray-500">
                                {s.phone && <p className="flex items-center gap-1.5"><Phone className="w-3 h-3 flex-shrink-0" />{s.phone}</p>}
                                {s.email && <p className="flex items-center gap-1.5 truncate"><Mail className="w-3 h-3 flex-shrink-0" />{s.email}</p>}
                                {s.taxNo && <p className="flex items-center gap-1.5"><FileText className="w-3 h-3 flex-shrink-0" />VKN: {s.taxNo}</p>}
                              </div>
                            </div>
                          ))}
                        {suppliers.length === 0 && (
                          <div className="col-span-full text-center py-16 border-2 border-dashed border-gray-100 rounded-2xl">
                            <Building2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                            <p className="text-sm text-gray-400 font-medium">{currentLanguage === 'tr' ? 'Henüz tedarikçi yok' : 'No suppliers yet'}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Add / Edit Supplier Modal */}
                  <AnimatePresence>
                    {addingSupplier && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                        onClick={() => { setAddingSupplier(false); setEditingSupplier(null); setNewSupplier({}); }}>
                        <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
                          onClick={e => e.stopPropagation()}
                          className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
                          <div className="flex items-center justify-between">
                            <h2 className="font-bold text-lg">
                              {editingSupplier
                                ? (currentLanguage === 'tr' ? 'Tedarikçi Düzenle' : 'Edit Supplier')
                                : (currentLanguage === 'tr' ? 'Yeni Tedarikçi' : 'New Supplier')}
                            </h2>
                            <button onClick={() => { setAddingSupplier(false); setEditingSupplier(null); setNewSupplier({}); }}>
                              <X className="w-5 h-5 text-gray-400" />
                            </button>
                          </div>
                          {[
                            { key: 'name',      label: currentLanguage === 'tr' ? 'Ad *' : 'Name *',               required: true  },
                            { key: 'company',   label: currentLanguage === 'tr' ? 'Firma' : 'Company',               required: false },
                            { key: 'email',     label: currentLanguage === 'tr' ? 'E-posta' : 'Email',               required: false },
                            { key: 'phone',     label: currentLanguage === 'tr' ? 'Telefon' : 'Phone',               required: false },
                            { key: 'taxNo',     label: currentLanguage === 'tr' ? 'Vergi No' : 'Tax No',             required: false },
                            { key: 'taxOffice', label: currentLanguage === 'tr' ? 'Vergi Dairesi' : 'Tax Office',    required: false },
                            { key: 'address',   label: currentLanguage === 'tr' ? 'Adres' : 'Address',               required: false },
                          ].map(field => (
                            <div key={field.key} className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-500 uppercase">{field.label}</label>
                              <input
                                value={(newSupplier as Record<string, string>)[field.key] ?? ''}
                                onChange={e => setNewSupplier(prev => ({ ...prev, [field.key]: e.target.value }))}
                                className="apple-input w-full"
                              />
                            </div>
                          ))}
                          <div className="flex gap-2 pt-2">
                            <button onClick={() => { setAddingSupplier(false); setEditingSupplier(null); setNewSupplier({}); }}
                              className="apple-button-secondary flex-1">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                            <button onClick={() => void handleSaveSupplier()}
                              className="apple-button-primary flex-1">{currentLanguage === 'tr' ? 'Kaydet' : 'Save'}</button>
                          </div>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
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
                  {/* ── Phase 61: Employee Status Ring Chart ── */}
                  {employees.length > 0 && (() => {
                    const aktif  = employees.filter(e => e.status === 'Aktif').length;
                    const izinli = employees.filter(e => e.status === 'İzinli').length;
                    const ayrildi = employees.filter(e => e.status === 'Ayrıldı').length;
                    const total  = employees.length;
                    const deptMap: Record<string, number> = {};
                    for (const e of employees) { if (e.status === 'Aktif') deptMap[e.department] = (deptMap[e.department] ?? 0) + 1; }
                    const topDepts = Object.entries(deptMap).sort(([, a], [, b]) => b - a).slice(0, 4);
                    return (
                      <div className={cn("rounded-2xl border p-5 grid grid-cols-1 sm:grid-cols-2 gap-6", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                        {/* Status breakdown */}
                        <div>
                          <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-4 flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                            <Users className="w-3.5 h-3.5" />
                            {currentLanguage === 'tr' ? 'Çalışan Durumu' : 'Employee Status'}
                          </h3>
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              { label: currentLanguage === 'tr' ? 'Aktif' : 'Active',   count: aktif,   color: 'text-emerald-700', bg: 'bg-emerald-50'  },
                              { label: currentLanguage === 'tr' ? 'İzinli' : 'On Leave', count: izinli,  color: 'text-amber-700',   bg: 'bg-amber-50'    },
                              { label: currentLanguage === 'tr' ? 'Ayrıldı' : 'Left',   count: ayrildi, color: 'text-gray-500',    bg: 'bg-gray-50'     },
                            ].map((s, i) => (
                              <div key={i} className={cn("rounded-xl p-3 text-center", darkMode ? "bg-white/5" : s.bg)}>
                                <p className={`text-2xl font-black ${s.color}`}>{s.count}</p>
                                <p className={cn("text-[10px] font-bold mt-0.5", darkMode ? "text-white/50" : "text-gray-500")}>{s.label}</p>
                              </div>
                            ))}
                          </div>
                          {/* Active employees bar */}
                          <div className="mt-4 space-y-1">
                            <div className="flex justify-between text-[10px] text-gray-400">
                              <span>{currentLanguage === 'tr' ? 'Aktiflik oranı' : 'Active rate'}</span>
                              <span className="font-bold text-emerald-600">{total > 0 ? Math.round((aktif / total) * 100) : 0}%</span>
                            </div>
                            <div className={cn("h-2 rounded-full overflow-hidden", darkMode ? "bg-white/10" : "bg-gray-100")}>
                              <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${total > 0 ? (aktif / total) * 100 : 0}%` }} />
                            </div>
                          </div>
                        </div>
                        {/* Department breakdown */}
                        <div>
                          <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-4", darkMode ? "text-white/50" : "text-gray-400")}>
                            {currentLanguage === 'tr' ? 'Departman Dağılımı' : 'By Department'}
                          </h3>
                          <div className="space-y-2">
                            {topDepts.map(([dept, count]) => (
                              <div key={dept} className="flex items-center gap-2">
                                <p className={cn("text-[11px] w-24 truncate flex-shrink-0", darkMode ? "text-white/60" : "text-gray-600")}>{dept}</p>
                                <div className={cn("flex-1 h-2 rounded-full overflow-hidden", darkMode ? "bg-white/10" : "bg-gray-100")}>
                                  <div className="h-full bg-blue-400 rounded-full" style={{ width: `${(count / aktif) * 100}%` }} />
                                </div>
                                <span className={cn("text-[11px] font-bold w-4 text-right flex-shrink-0", darkMode ? "text-white/60" : "text-gray-700")}>{count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
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
            <motion.div key="production" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              {!canAccess('production') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Üretim Yönetimi':'Production Management'} /> : (
                <>
                  {!hasFullAccess('production') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <ProductionModule currentLanguage={currentLanguage} isAuthenticated={!!user} />
                  {/* ── BOM / MRP ── */}
                  <div className="bg-white rounded-2xl border border-gray-100 p-6">
                    <BOMPanel currentLanguage={currentLanguage} />
                  </div>
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
                <div className="apple-card p-5 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                      <ShoppingBag className="w-5 h-5 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-sm text-[#1D1D1F]">Shopify</h3>
                      <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'E-ticaret entegrasyonu' : 'E-commerce integration'}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${companySettings?.shopify_access_token ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                      {companySettings?.shopify_access_token ? (currentLanguage === 'tr' ? 'Bağlı' : 'Connected') : (currentLanguage === 'tr' ? 'Bağlı Değil' : 'Not Connected')}
                    </span>
                  </div>
                  <div className="space-y-2 text-xs text-gray-500">
                    <div className="flex justify-between"><span>Store URL</span><span className="font-mono text-gray-700 truncate max-w-[160px]">{(companySettings?.shopify_store_url as string) || '—'}</span></div>
                    <div className="flex justify-between"><span>Access Token</span><span className="font-mono text-gray-400">{companySettings?.shopify_access_token ? '••••••••' : '—'}</span></div>
                  </div>
                  <button
                    onClick={async () => {
                      const token = (companySettings?.shopify_access_token as string) || '';
                      if (!token) { toast(currentLanguage==='tr'?'Önce Ayarlar\'dan Access Token girin.':'Enter Access Token in Settings first.','error'); return; }
                      toast(currentLanguage==='tr'?'Shopify senkronizasyonu başlatıldı…':'Starting Shopify sync…','info');
                      try {
                        const r = await fetch('/api/shopify/sync', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ accessToken: token, storeUrl: companySettings?.shopify_store_url || '' }) });
                        const d = await r.json();
                        if (d.error) throw new Error(d.error);
                        toast(`${currentLanguage==='tr'?'Senkronize edildi':'Synced'} — ${d.products?.length ?? 0} ${currentLanguage==='tr'?'ürün':'products'}, ${d.orders?.length ?? 0} ${currentLanguage==='tr'?'sipariş':'orders'}`, 'success');
                      } catch(e) { toast(e instanceof Error ? e.message : 'Sync hatası', 'error'); }
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-bold transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {currentLanguage === 'tr' ? 'Senkronize Et' : 'Sync Now'}
                  </button>
                </div>

                {/* TCMB */}
                <div className="apple-card p-5 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                      <Globe className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-sm text-[#1D1D1F]">TCMB Döviz</h3>
                      <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Canlı kur bilgisi' : 'Live exchange rates'}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${exchangeRates ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'}`}>
                      {exchangeRates ? (currentLanguage === 'tr' ? 'Canlı' : 'Live') : (currentLanguage === 'tr' ? 'Bekleniyor' : 'Loading')}
                    </span>
                  </div>
                  <div className="space-y-2 text-xs text-gray-500">
                    <div className="flex justify-between"><span>USD / TRY</span><span className="font-mono font-semibold text-gray-800">{exchangeRates?.USD ? `₺${(exchangeRates.USD).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span></div>
                    <div className="flex justify-between"><span>EUR / TRY</span><span className="font-mono font-semibold text-gray-800">{exchangeRates?.EUR ? `₺${(exchangeRates.EUR).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span></div>
                    <div className="flex justify-between"><span>GBP / TRY</span><span className="font-mono font-semibold text-gray-800">{exchangeRates?.GBP ? `₺${(exchangeRates.GBP).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span></div>
                  </div>
                  <button
                    onClick={async () => {
                      toast(currentLanguage==='tr'?'Kurlar güncelleniyor…':'Refreshing rates…', 'info');
                      try {
                        const r = await fetch('/api/settings/exchange-rates');
                        const d = await r.json();
                        if (d.rates) {
                          setExchangeRates(d.rates);
                          toast(currentLanguage==='tr'?'Döviz kurları güncellendi.':'Exchange rates updated.', 'success');
                        } else throw new Error('Kur verisi alınamadı');
                      } catch(e) { toast(e instanceof Error ? e.message : 'Hata', 'error'); }
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {currentLanguage === 'tr' ? 'Kurları Yenile' : 'Refresh Rates'}
                  </button>
                </div>

                {/* Luca */}
                <div className="apple-card p-5 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
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
                        await setDoc(doc(db, 'settings', 'luca'), { enabled: newVal }, { merge: true });
                        if (newVal) {
                          await setDoc(doc(db, 'settings', 'mikro'), { enabled: false }, { merge: true }).catch(() => {});
                        }
                        toast(newVal ? (currentLanguage==='tr'?'Luca aktif edildi':'Luca enabled') : (currentLanguage==='tr'?'Luca devre dışı':'Luca disabled'), 'success');
                      }}
                      className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${lucaSettings.enabled ? 'bg-purple-500' : 'bg-gray-200'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${lucaSettings.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  <div className="space-y-2 text-xs text-gray-500">
                    <div className="flex justify-between"><span>{currentLanguage === 'tr' ? 'Kontör bakiyesi' : 'e-Invoice credit'}</span>
                      <span className={`font-semibold ${lucaSettings.enabled ? 'text-purple-600' : 'text-gray-400'}`}>{lucaSettings.enabled ? (currentLanguage==='tr'?'Aktif':'Active') : (currentLanguage==='tr'?'Pasif':'Inactive')}</span>
                    </div>
                    <div className="flex justify-between"><span>API</span><span className="font-mono text-gray-400">api.luca.com.tr</span></div>
                  </div>
                  <button
                    onClick={async () => {
                      toast(currentLanguage==='tr'?'Luca bağlantısı test ediliyor…':'Testing Luca connection…','info');
                      try {
                        const r = await fetch('/api/luca/status');
                        const d = await r.json() as { configured: boolean; connected: boolean; companyName?: string; error?: string };
                        if (!d.configured) { toast(currentLanguage==='tr'?'Luca API Key yapılandırılmamış. Ayarlar\'dan girin.':'Luca API Key not configured.','error'); return; }
                        if (d.connected) toast(`${currentLanguage==='tr'?'Luca bağlantısı başarılı':'Luca connected'}${d.companyName ? ` — ${d.companyName}` : ''}`, 'success');
                        else toast(d.error || 'Luca bağlantı hatası', 'error');
                      } catch(e) { toast(e instanceof Error ? e.message : 'Bağlantı hatası','error'); }
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {currentLanguage === 'tr' ? 'Bağlantıyı Test Et' : 'Test Connection'}
                  </button>
                </div>

                {/* Mikro */}
                <div className="apple-card p-5 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
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
                        await setDoc(doc(db, 'settings', 'mikro'), { enabled: newVal }, { merge: true });
                        if (newVal) {
                          await setDoc(doc(db, 'settings', 'luca'), { enabled: false }, { merge: true }).catch(() => {});
                        }
                        toast(newVal ? (currentLanguage==='tr'?'Mikro aktif edildi':'Mikro enabled') : (currentLanguage==='tr'?'Mikro devre dışı':'Mikro disabled'), 'success');
                      }}
                      className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${mikroSettings.enabled ? 'bg-[#1a3a5c]' : 'bg-gray-200'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${mikroSettings.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  <div className="space-y-2 text-xs text-gray-500">
                    <div className="flex justify-between"><span>{currentLanguage === 'tr' ? 'Veri akışı' : 'Data flow'}</span><span className="text-gray-700">Cetpa ↔ Mikro</span></div>
                    <div className="flex justify-between"><span>API</span><span className="font-mono text-gray-400 truncate max-w-[140px]">jumpbulutapigw.mikro.com.tr</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={async () => {
                        toast(currentLanguage==='tr'?'Mikro bağlantısı kontrol ediliyor…':'Checking Mikro connection…','info');
                        try {
                          const r = await fetch('/api/mikro/status');
                          const d = await r.json();
                          if (!d.configured) { toast(currentLanguage==='tr'?'Mikro env vars sunucuda ayarlanmamış.':'Mikro env vars not set on server.','error'); return; }
                          if (d.connected) toast(currentLanguage==='tr'?'Mikro bağlantısı başarılı ✓':'Mikro connection successful ✓','success');
                          else toast(d.error || (currentLanguage==='tr'?'Token alınamadı':'Could not get token'),'error');
                        } catch(e) { toast(e instanceof Error ? e.message : 'Bağlantı hatası','error'); }
                      }}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-[#1a3a5c] text-[#1a3a5c] hover:bg-[#1a3a5c]/5 text-xs font-bold transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      {currentLanguage === 'tr' ? 'Test Et' : 'Test'}
                    </button>
                    <button
                      onClick={() => setActiveTab('settings')}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#1a3a5c] hover:bg-[#1a3a5c]/90 text-white text-xs font-bold transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      {currentLanguage === 'tr' ? 'Veri Aktar' : 'Import Data'}
                    </button>
                  </div>
                </div>

                {/* Firebase */}
                <div className="apple-card p-5 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
                      <Flame className="w-5 h-5 text-orange-500" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-sm text-[#1D1D1F]">Firebase</h3>
                      <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Veritabanı & Kimlik Doğrulama' : 'Database & Authentication'}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${user ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                      {user ? (currentLanguage === 'tr' ? 'Bağlı' : 'Connected') : (currentLanguage === 'tr' ? 'Anonim' : 'Anonymous')}
                    </span>
                  </div>
                  <div className="space-y-2 text-xs text-gray-500">
                    <div className="flex justify-between"><span>{currentLanguage === 'tr' ? 'Kullanıcı' : 'User'}</span><span className="font-mono text-gray-700 truncate max-w-[160px]">{user?.email || user?.uid?.slice(0, 8) || '—'}</span></div>
                    <div className="flex justify-between"><span>Firestore</span><span className="text-green-600 font-semibold">{currentLanguage === 'tr' ? 'Aktif' : 'Active'}</span></div>
                    <div className="flex justify-between"><span>Auth</span><span className={`font-semibold ${user ? 'text-green-600' : 'text-gray-400'}`}>{user ? (currentLanguage === 'tr' ? 'Oturum Açık' : 'Signed In') : (currentLanguage === 'tr' ? 'Oturum Yok' : 'Not Signed In')}</span></div>
                    <div className="flex justify-between"><span>Project ID</span><span className="font-mono text-gray-400 text-[10px]">gen-lang-client-0628151245</span></div>
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

              {/* ── WhatsApp Business ── */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-1 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  {currentLanguage === 'tr' ? 'WhatsApp Business (Meta Cloud API)' : 'WhatsApp Business (Meta Cloud API)'}
                </h4>
                <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                      <MessageSquare className="w-5 h-5 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-sm text-gray-900">WhatsApp Business API</h4>
                      <p className="text-[11px] text-gray-400">
                        {currentLanguage === 'tr'
                          ? 'Müşterilere kargo ve teslimat bildirimleri gönder.'
                          : 'Send order shipping & delivery notifications to customers.'}
                      </p>
                    </div>
                  </div>
                  {[
                    { key: 'phoneNumberId', label: currentLanguage === 'tr' ? 'Phone Number ID'  : 'Phone Number ID',   placeholder: '1234567890',                isSecret: false },
                    { key: 'accessToken',   label: currentLanguage === 'tr' ? 'Access Token'     : 'Access Token',      placeholder: 'EAA...',                    isSecret: true  },
                    { key: 'templateName',  label: currentLanguage === 'tr' ? 'Şablon Adı'       : 'Template Name',     placeholder: 'order_status_update',       isSecret: false },
                    { key: 'templateLang',  label: currentLanguage === 'tr' ? 'Şablon Dili'      : 'Template Language', placeholder: 'tr',                        isSecret: false },
                  ].map(f => (
                    <div key={f.key} className="space-y-0.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase">{f.label}</label>
                      <input
                        type={f.isSecret ? 'password' : 'text'}
                        placeholder={f.placeholder}
                        onChange={e => setDoc(doc(db, 'settings', 'whatsapp'), { [f.key]: e.target.value.trim() }, { merge: true })}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-green-400 focus:ring-2 focus:ring-green-400/10 transition-all font-mono"
                      />
                    </div>
                  ))}
                  <p className="text-[10px] text-gray-400">
                    {currentLanguage === 'tr'
                      ? '* Meta Developer Console\'dan System User Permanent Token alın. Mesaj şablonu önceden Meta tarafından onaylanmış olmalıdır.'
                      : '* Get a System User Permanent Token from Meta Developer Console. The message template must be pre-approved by Meta.'}
                  </p>
                </div>
              </div>

              {/* ── iyzico Payment Gateway ── */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-1 flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5" />
                  {currentLanguage === 'tr' ? 'iyzico Ödeme Geçidi' : 'iyzico Payment Gateway'}
                </h4>
                <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                      <CreditCard className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-sm text-gray-900">iyzico</h4>
                      <p className="text-[11px] text-gray-400">
                        {currentLanguage === 'tr' ? 'B2B müşterilere ödeme linki oluştur ve gönder.' : 'Generate and send payment links to B2B customers.'}
                      </p>
                    </div>
                  </div>
                  {[
                    { key: 'apiKey',    label: 'API Key',    placeholder: 'sandbox-...', isSecret: false },
                    { key: 'secretKey', label: 'Secret Key', placeholder: 'sandbox-...', isSecret: true  },
                    { key: 'baseUrl',   label: 'Base URL',   placeholder: 'https://sandbox-api.iyzipay.com', isSecret: false },
                  ].map(f => (
                    <div key={f.key} className="space-y-0.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase">{f.label}</label>
                      <input
                        type={f.isSecret ? 'password' : 'text'}
                        placeholder={f.placeholder}
                        onChange={e => setDoc(doc(db, 'settings', 'iyzico'), { [f.key]: e.target.value.trim() }, { merge: true })}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/10 transition-all font-mono"
                      />
                    </div>
                  ))}
                  <p className="text-[10px] text-gray-400">
                    {currentLanguage === 'tr'
                      ? '* Değerler otomatik kaydedilir. Test için sandbox URL kullanın. Canlıya geçmek için https://api.iyzipay.com girin.'
                      : '* Values auto-saved. Use sandbox URL for testing. Enter https://api.iyzipay.com for production.'}
                  </p>
                </div>
              </div>

              {/* ── Email Notifications (Resend) ── */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-1 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" />
                  {currentLanguage === 'tr' ? 'E-posta Bildirimleri (Resend)' : 'Email Notifications (Resend)'}
                </h4>
                <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                      <Mail className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-sm text-gray-900">Resend</h4>
                      <p className="text-[11px] text-gray-400">
                        {currentLanguage === 'tr'
                          ? 'Sipariş durumu değişimlerinde müşterilere otomatik bildirim gönder.'
                          : 'Automatically notify customers when order status changes.'}
                      </p>
                    </div>
                  </div>
                  {[
                    { key: 'apiKey',      label: currentLanguage === 'tr' ? 'API Anahtarı' : 'API Key',       placeholder: 're_...',                   isSecret: true  },
                    { key: 'fromAddress', label: currentLanguage === 'tr' ? 'Gönderen Adres' : 'From Address', placeholder: 'siparis@cetpa.com.tr',      isSecret: false },
                  ].map(f => (
                    <div key={f.key} className="space-y-0.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase">{f.label}</label>
                      <input
                        type={f.isSecret ? 'password' : 'email'}
                        placeholder={f.placeholder}
                        onChange={e => setDoc(doc(db, 'settings', 'email'), { [f.key]: e.target.value.trim() }, { merge: true })}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/10 transition-all font-mono"
                      />
                    </div>
                  ))}
                  <p className="text-[10px] text-gray-400">
                    {currentLanguage === 'tr'
                      ? '* Değerler anında kaydedilir. Resend\'den ücretsiz API anahtarı alın: resend.com'
                      : '* Values auto-saved. Get a free API key at resend.com'}
                  </p>
                </div>
              </div>

              {/* ── Turkish Marketplaces ── */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-1">
                  {currentLanguage === 'tr' ? 'Türk Pazaryerleri' : 'Turkish Marketplaces'}
                </h4>
                <MarketplacePanel currentLanguage={currentLanguage} />
              </div>
              </>}
            </motion.div>
          )}

          {/* ── Finance Panel ── */}
          {activeTab === 'finance' && (
            <motion.div key="finance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <FinancePanel orders={orders} currentLanguage={currentLanguage as 'tr' | 'en'} exchangeRates={exchangeRates} displayCurrency={kpiCurrency} />
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

        {/* ── Invite User ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center">
              <Mail size={16} className="text-blue-500" />
            </div>
            <div>
              <h3 className="font-bold text-gray-800 text-sm">{currentLanguage==='tr'?'Kullanıcı Davet Et':'Invite User'}</h3>
              <p className="text-xs text-gray-400">{currentLanguage==='tr'?'E-posta ile davet linki gönder':'Send an invite link via email'}</p>
            </div>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!inviteEmail.trim()) return;
              setInviteLoading(true);
              try {
                const r = await fetch('/api/admin/invite', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
                });
                const d = await r.json() as { success: boolean; notConfigured?: boolean; error?: string };
                if (d.success) {
                  toast(currentLanguage === 'tr' ? `Davet gönderildi: ${inviteEmail}` : `Invite sent to ${inviteEmail}`, 'success');
                  setInviteEmail('');
                } else if (d.notConfigured) {
                  toast(currentLanguage === 'tr' ? 'E-posta servisi yapılandırılmamış. Ayarlar > Resend API anahtarını girin.' : 'Email not configured. Add Resend API key in Settings.', 'error');
                } else {
                  toast(d.error || 'Davet gönderilemedi', 'error');
                }
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Hata', 'error');
              } finally {
                setInviteLoading(false);
              }
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="ornek@sirket.com"
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand transition-colors"
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand transition-colors"
            >
              {(['Admin','Manager','Sales','Logistics','Accounting','HR','Purchasing','B2B','Dealer'] as string[]).map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={inviteLoading || !inviteEmail}
              className="apple-button-primary flex items-center gap-1.5 disabled:opacity-50 shrink-0"
            >
              {inviteLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {currentLanguage === 'tr' ? 'Davet Gönder' : 'Send Invite'}
            </button>
          </form>
          <p className="text-[10px] text-gray-400 mt-2">
            {currentLanguage === 'tr'
              ? 'Davet edilen kullanıcı, e-posta üzerinden kayıt olabilir. Rol ataması önceden yapılır.'
              : 'The invited user can register via email. The role is pre-assigned.'}
          </p>
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
      <div className="space-y-6">
        {/* Refresh button */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
            {currentLanguage === 'tr' ? 'Sistem Sağlık Durumu' : 'System Health'}
          </h3>
          <button
            onClick={() => void fetchSystemHealth()}
            disabled={healthLoading}
            className="apple-button-secondary flex items-center gap-2 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
            {currentLanguage === 'tr' ? 'Yenile' : 'Refresh'}
          </button>
        </div>

        {/* Service connectivity cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            {
              name: 'Firebase Firestore',
              ok: healthData ? healthData.firebase : true,
              status: healthData ? (healthData.firebase ? 'Aktif' : 'Hata') : 'Bekleniyor',
              desc: currentLanguage==='tr' ? 'Gerçek zamanlı veritabanı' : 'Real-time database',
            },
            {
              name: 'Firebase Auth',
              ok: true,
              status: user ? (currentLanguage==='tr' ? 'Giriş Yapıldı' : 'Authenticated') : (currentLanguage==='tr' ? 'Misafir' : 'Guest'),
              desc: user?.email || 'anonymous',
            },
            {
              name: 'TCMB Kur API',
              ok: !!exchangeRates,
              status: exchangeRates ? (currentLanguage==='tr' ? 'Bağlı' : 'Connected') : (currentLanguage==='tr' ? 'Bekleniyor' : 'Pending'),
              desc: exchangeRates ? `1 USD = ₺${(exchangeRates.USD||0).toFixed(2)}` : (currentLanguage==='tr' ? 'Güncelleniyor...' : 'Fetching...'),
            },
            {
              name: 'Express Server',
              ok: !!healthData,
              status: healthData ? `${currentLanguage==='tr' ? 'Çalışıyor' : 'Running'} — ${Math.floor((healthData.uptime || 0) / 60)}m` : (currentLanguage==='tr' ? 'Bağlanılamadı' : 'Unreachable'),
              desc: healthData ? healthData.env : '—',
            },
            {
              name: 'Resend (E-posta)',
              ok: !!healthData?.resend,
              status: healthData?.resend ? (currentLanguage==='tr' ? 'Yapılandırıldı' : 'Configured') : (currentLanguage==='tr' ? 'API Key Yok' : 'No API Key'),
              desc: currentLanguage==='tr' ? 'Haftalık rapor & davet emaili' : 'Weekly report & invite emails',
            },
            {
              name: 'WhatsApp (Twilio)',
              ok: !!healthData?.whatsapp,
              status: healthData?.whatsapp ? (currentLanguage==='tr' ? 'Yapılandırıldı' : 'Configured') : (currentLanguage==='tr' ? 'Credentials Yok' : 'No Credentials'),
              desc: currentLanguage==='tr' ? 'Kargo bildirim mesajları' : 'Shipping notification messages',
            },
            {
              name: 'İyzico (Ödeme)',
              ok: !!healthData?.iyzico,
              status: healthData?.iyzico ? (currentLanguage==='tr' ? 'Yapılandırıldı' : 'Configured') : (currentLanguage==='tr' ? 'API Key Yok' : 'No API Key'),
              desc: currentLanguage==='tr' ? 'B2B ödeme entegrasyonu' : 'B2B payment integration',
            },
            {
              name: 'Shopify',
              ok: true,
              status: currentLanguage==='tr' ? 'Manuel Sync' : 'Manual Sync',
              desc: currentLanguage==='tr' ? 'Son sync: manuel' : 'Last sync: manual',
            },
          ].map((s, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-800 text-sm">{s.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{s.desc}</div>
                </div>
                <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${s.ok ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'}`}>
                  {s.ok ? '● ' : '○ '}{s.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Collection counts */}
        {statsData && (
          <div>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
              {currentLanguage === 'tr' ? 'Koleksiyon Kayıt Sayıları' : 'Collection Record Counts'}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Object.entries(statsData).map(([col, cnt]) => (
                <div key={col} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between">
                  <span className="text-xs text-gray-500 font-medium truncate">{col}</span>
                  <span className="text-sm font-black text-brand ml-2">{cnt.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Last refreshed */}
        {healthData && (
          <p className="text-xs text-gray-300 text-right">
            {currentLanguage === 'tr' ? 'Son güncelleme: ' : 'Last refreshed: '}
            {new Date(healthData.timestamp).toLocaleTimeString('tr-TR')}
          </p>
        )}
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
                      await setDoc(doc(db, 'settings', 'luca'), { enabled: newVal }, { merge: true });
                      if (newVal) {
                        await setDoc(doc(db, 'settings', 'mikro'), { enabled: false }, { merge: true }).catch(() => {});
                      }
                    }}
                    className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${lucaSettings.enabled ? 'bg-purple-500' : 'bg-gray-200'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${lucaSettings.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
                {([
                  { firestoreKey: 'apiKey',     label: 'API Key',                                                    placeholder: 'Luca API Key',         isSecret: true  },
                  { firestoreKey: 'companyId',  label: currentLanguage === 'tr' ? 'Şirket ID' : 'Company ID',       placeholder: 'Company ID',           isSecret: false },
                  { firestoreKey: 'baseUrl',    label: 'Base URL',                                                   placeholder: 'https://api.luca.com.tr', isSecret: false },
                ] as { firestoreKey: keyof typeof lucaSettings; label: string; placeholder: string; isSecret: boolean }[]).map(field => (
                  <div key={field.firestoreKey} className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">{field.label}</label>
                    <input
                      key={`luca-${field.firestoreKey}-${String(lucaSettings[field.firestoreKey] ?? '')}`}
                      type={field.isSecret ? 'password' : 'text'}
                      defaultValue={(lucaSettings[field.firestoreKey] as string) || (field.firestoreKey === 'baseUrl' ? 'https://api.luca.com.tr' : '')}
                      placeholder={field.placeholder}
                      onChange={e => {
                        const val = e.target.value.trim();
                        setDoc(doc(db, 'settings', 'luca'), { [field.firestoreKey]: val }, { merge: true });
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
                      await setDoc(doc(db, 'settings', 'mikro'), { enabled: newVal }, { merge: true });
                      if (newVal) {
                        await setDoc(doc(db, 'settings', 'luca'), { enabled: false }, { merge: true }).catch(() => {});
                      }
                    }}
                    className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${mikroSettings.enabled ? 'bg-[#1a3a5c]' : 'bg-gray-200'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${mikroSettings.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* ── Credential fields ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {([
                    { firestoreKey: 'idmEmail',    label: currentLanguage === 'tr' ? 'IDM E-posta' : 'IDM Email',       placeholder: 'ornek@firma.com',  isSecret: false,  hint: currentLanguage === 'tr' ? 'Online İşlem Merkezi kullanıcı adı' : 'Online İşlem Merkezi username' },
                    { firestoreKey: 'idmPassword', label: currentLanguage === 'tr' ? 'IDM Şifre (Access Token)' : 'IDM Password (Access Token)', placeholder: '1234…',             isSecret: true,   hint: currentLanguage === 'tr' ? 'Online İşlem Merkezi şifresi veya API token' : 'Online İşlem Merkezi password or API token' },
                    { firestoreKey: 'alias',       label: 'Alias',                          placeholder: 'XCXY-8332',        isSecret: false,  hint: currentLanguage === 'tr' ? 'Mikro firma alias kodu (zorunlu)' : 'Mikro company alias code (required)' },
                    { firestoreKey: 'apiKey',      label: 'API Key',                        placeholder: 'mikro-api-key…',   isSecret: true,   hint: currentLanguage === 'tr' ? 'Mikro yönetici portalından alınan API anahtarı' : 'API key from Mikro admin portal' },
                    { firestoreKey: 'firmaKodu',   label: currentLanguage === 'tr' ? 'Firma Kodu' : 'Company Code', placeholder: '01',               isSecret: false,  hint: '' },
                    { firestoreKey: 'calismaYili', label: currentLanguage === 'tr' ? 'Çalışma Yılı' : 'Work Year',   placeholder: String(new Date().getFullYear()), isSecret: false, hint: '' },
                    { firestoreKey: 'kullaniciKodu', label: currentLanguage === 'tr' ? 'Kullanıcı Kodu' : 'User Code', placeholder: 'SRV',           isSecret: false,  hint: '' },
                    { firestoreKey: 'sifre',       label: currentLanguage === 'tr' ? 'Sunucu Şifresi (MD5)' : 'Server Password (MD5)', placeholder: 'MD5 hash…', isSecret: true, hint: '' },
                  ] as { firestoreKey: keyof MikroConfig; label: string; placeholder: string; isSecret: boolean; hint: string }[]).map(field => (
                    <div key={field.firestoreKey} className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1">
                        {field.label}
                        {(field.firestoreKey === 'idmPassword' || field.firestoreKey === 'alias') && (
                          <span className="text-red-400">*</span>
                        )}
                      </label>
                      <input
                        key={`mikro-${field.firestoreKey}-${String(mikroSettings[field.firestoreKey] ?? '')}`}
                        type={field.isSecret ? 'password' : 'text'}
                        defaultValue={(mikroSettings[field.firestoreKey] as string) || ''}
                        placeholder={field.placeholder}
                        onChange={e => {
                          const val = e.target.value.trim();
                          setDoc(doc(db, 'settings', 'mikro'), { [field.firestoreKey]: val }, { merge: true });
                        }}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#1a3a5c] focus:ring-2 focus:ring-[#1a3a5c]/10 transition-all font-mono"
                      />
                      {field.hint && (
                        <p className="text-[10px] text-gray-400">{field.hint}</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="p-3 bg-blue-50 rounded-xl text-xs text-blue-700 space-y-1">
                  <p>💡 {currentLanguage === 'tr'
                    ? 'IDM Şifre ve Alias alanları zorunludur. Diğer alanlar boş bırakılırsa sunucu varsayılan değerlerini kullanır.'
                    : 'IDM Password and Alias fields are required. Other fields fall back to server defaults if empty.'}</p>
                  <p className="text-blue-500">{currentLanguage === 'tr'
                    ? '* Sunucuda MIKRO_* ortam değişkenleri tanımlıysa bunlar Firestore ayarlarını geçersiz kılar.'
                    : '* Server MIKRO_* env vars override Firestore settings if defined.'}</p>
                </div>

                {/* Test connection */}
                <button
                  onClick={async () => {
                    toast(currentLanguage==='tr'?'Mikro bağlantısı kontrol ediliyor…':'Checking Mikro connection…','info');
                    try {
                      const r = await fetch('/api/mikro/status');
                      const d = await r.json();
                      if (!d.configured) { toast(currentLanguage==='tr'?'Mikro yapılandırılmamış. IDM Şifre ve Alias alanlarını doldurun.':'Mikro not configured. Fill in IDM Password and Alias.','error'); return; }
                      if (d.connected) toast(currentLanguage==='tr'?'Mikro bağlantısı başarılı ✓':'Mikro connection successful ✓','success');
                      else toast(d.error || (currentLanguage==='tr'?'Token alınamadı':'Could not get token'),'error');
                    } catch(e) { toast(e instanceof Error ? e.message : 'Bağlantı hatası','error'); }
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-[#1a3a5c] text-[#1a3a5c] hover:bg-[#1a3a5c]/5 text-sm font-bold transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  {currentLanguage === 'tr' ? 'Bağlantıyı Test Et' : 'Test Connection'}
                </button>
              </div>

              {/* ── Mikro Data Import Panel ── */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-1">
                  {currentLanguage === 'tr' ? 'Mikro\'dan Veri Aktar' : 'Import Data from Mikro'}
                </h4>
                <MikroSyncPanel currentLanguage={currentLanguage} />
              </div>

              {/* ── Luca Sync Panel ── */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-1 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  {currentLanguage === 'tr' ? 'Luca Muhasebe Entegrasyonu' : 'Luca Accounting Sync'}
                </h4>
                <LucaSyncPanel currentLanguage={currentLanguage} />
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

              {/* ── Phase 65: Notification Preferences ── */}
              {(() => {
                const prefKey = 'cetpa-notif-prefs';
                const [prefs, setPrefs] = React.useState<Record<string, boolean>>(() => {
                  try { return JSON.parse(localStorage.getItem(prefKey) ?? '{}'); } catch { return {}; }
                });
                const toggle = (key: string) => {
                  setPrefs(prev => {
                    const next = { ...prev, [key]: !prev[key] };
                    localStorage.setItem(prefKey, JSON.stringify(next));
                    return next;
                  });
                };
                const items = [
                  { key: 'lowStock',   icon: '📦', label: currentLanguage === 'tr' ? 'Düşük stok uyarıları' : 'Low stock alerts',       default: true  },
                  { key: 'newOrder',   icon: '🛒', label: currentLanguage === 'tr' ? 'Yeni sipariş bildirimi' : 'New order notification',  default: true  },
                  { key: 'newLead',    icon: '👤', label: currentLanguage === 'tr' ? 'Yeni müşteri adayı' : 'New lead',                   default: true  },
                  { key: 'followUp',   icon: '📅', label: currentLanguage === 'tr' ? 'Takip hatırlatıcıları' : 'Follow-up reminders',     default: true  },
                  { key: 'shipment',   icon: '🚚', label: currentLanguage === 'tr' ? 'Kargo durum değişikliği' : 'Shipment status change', default: false },
                  { key: 'poDeadline', icon: '⏰', label: currentLanguage === 'tr' ? 'Satın alma son tarihi' : 'PO deadline alerts',       default: true  },
                ];
                return (
                  <div className="apple-card p-6 space-y-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
                        <Bell className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm">{currentLanguage === 'tr' ? 'Bildirim Tercihleri' : 'Notification Preferences'}</h3>
                        <p className="text-[11px] text-[#86868B]">{currentLanguage === 'tr' ? 'Hangi bildirimleri almak istediğinizi seçin' : 'Choose which notifications you want to receive'}</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {items.map(item => {
                        const isOn = item.key in prefs ? prefs[item.key] : item.default;
                        return (
                          <div key={item.key} className="flex items-center justify-between py-1">
                            <div className="flex items-center gap-2.5">
                              <span className="text-base">{item.icon}</span>
                              <span className="text-sm text-gray-700">{item.label}</span>
                            </div>
                            <button
                              onClick={() => toggle(item.key)}
                              className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${isOn ? 'bg-brand' : 'bg-gray-200'}`}
                            >
                              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isOn ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? '* Tercihler bu cihazda yerel olarak saklanır.' : '* Preferences are stored locally on this device.'}</p>
                  </div>
                );
              })()}

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
              <B2BPortal user={user} userRole={userRole} leads={leads} inventory={inventory} currentT={currentT} currentLanguage={currentLanguage} exchangeRates={exchangeRates} />
            </motion.div>
          )}


          {/* ── Inventory ── */}
          {activeTab === 'inventory' && (
            <motion.div key="inventory" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {/* ── Phase 71: Inventory Reorder Alert Strip ── */}
              {(() => {
                const reorderItems = inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5));
                if (reorderItems.length === 0) return null;
                const critical = reorderItems.filter(i => (i.stockLevel ?? 0) === 0).length;
                const low      = reorderItems.length - critical;
                return (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                      <Package className="w-4 h-4 text-red-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-red-800">
                        {currentLanguage === 'tr'
                          ? `${reorderItems.length} ürün yeniden sipariş eşiğinde`
                          : `${reorderItems.length} product${reorderItems.length > 1 ? 's' : ''} at reorder threshold`}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {critical > 0 && (
                          <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                            {critical} {currentLanguage === 'tr' ? 'Stok Yok' : 'Out of Stock'}
                          </span>
                        )}
                        {low > 0 && (
                          <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                            {low} {currentLanguage === 'tr' ? 'Düşük Stok' : 'Low Stock'}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Scroll-to-first hint — top 3 items */}
                    <div className="hidden sm:flex flex-col items-end gap-0.5 flex-shrink-0 max-w-[140px]">
                      {reorderItems.slice(0, 3).map(i => (
                        <span key={i.id} className="text-[9px] text-red-500 truncate max-w-full font-medium">
                          {i.name} ({i.stockLevel ?? 0})
                        </span>
                      ))}
                      {reorderItems.length > 3 && (
                        <span className="text-[9px] text-red-400">+{reorderItems.length - 3} more</span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 75: Inventory Category Distribution ── */}
              {inventory.length > 0 && (() => {
                const catMap: Record<string, { units: number; value: number }> = {};
                for (const item of inventory) {
                  const cat = item.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
                  catMap[cat] = catMap[cat] || { units: 0, value: 0 };
                  catMap[cat].units += item.stockLevel ?? 0;
                  catMap[cat].value += (item.prices?.['Retail'] ?? item.price ?? 0) * (item.stockLevel ?? 0);
                }
                const catData = Object.entries(catMap)
                  .map(([name, { units, value }]) => ({ name, units, value }))
                  .sort((a, b) => b.value - a.value)
                  .slice(0, 6);
                if (catData.length < 2) return null;
                const totalVal = catData.reduce((s, c) => s + c.value, 0);
                const PALETTE = ['#ff4000', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#6b7280'];
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                        {currentLanguage === 'tr' ? 'Kategori Dağılımı' : 'Category Distribution'}
                      </h3>
                      <span className="text-[10px] text-gray-400">
                        {currentLanguage === 'tr' ? 'Perakende değerine göre' : 'By retail value'}
                      </span>
                    </div>
                    <div className="flex items-center gap-6">
                      {/* Donut via Recharts */}
                      <div className="flex-shrink-0">
                        <ResponsiveContainer width={120} height={120}>
                          <RePieChart>
                            <Pie
                              data={catData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={36}
                              outerRadius={54}
                              strokeWidth={2}
                              stroke="#fff"
                            >
                              {catData.map((_, i) => (
                                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(v: number) => [`₺${v.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, currentLanguage === 'tr' ? 'Değer' : 'Value']}
                              contentStyle={{ fontSize: 11, borderRadius: 8 }}
                            />
                          </RePieChart>
                        </ResponsiveContainer>
                      </div>
                      {/* Legend */}
                      <div className="flex-1 space-y-1.5 min-w-0">
                        {catData.map((c, i) => {
                          const pct = totalVal > 0 ? Math.round((c.value / totalVal) * 100) : 0;
                          return (
                            <div key={c.name} className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                              <span className="text-xs text-gray-700 truncate flex-1">{c.name}</span>
                              <span className="text-[10px] font-bold text-gray-500 flex-shrink-0">{pct}%</span>
                              <span className="text-[10px] text-gray-400 flex-shrink-0 hidden sm:inline">{c.units} {currentLanguage === 'tr' ? 'ad.' : 'u.'}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

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
                onPrintLabels={setLabelItems}
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
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-700 font-medium">{order.customerName}</span>
                                    {/* Phase 46: CustomerType badge */}
                                    {order.customerType && (
                                      <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0", order.customerType === 'B2B' ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500")}>
                                        {order.customerType}
                                      </span>
                                    )}
                                  </div>
                                </td>
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
                                  <div className="flex items-center justify-end gap-1.5">
                                    {/* Phase 50: Notes indicator */}
                                    {order.notes && (
                                      <span title={order.notes} className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                                        <FileText className="w-2.5 h-2.5 text-amber-600" />
                                      </span>
                                    )}
                                    ₺{order.totalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </div>
                                </td>
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
                <B2BPortal user={user} userRole={userRole} leads={leads} inventory={inventory} currentT={currentT} currentLanguage={currentLanguage} exchangeRates={exchangeRates} />
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
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => exportLeadsCSV(leads, currentLanguage)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold transition-colors"
                      title={currentLanguage === 'tr' ? 'CSV olarak indir' : 'Download as CSV'}
                    >
                      <Download className="w-3.5 h-3.5" />
                      CSV
                    </button>
                    <button onClick={() => setIsAddingLead(true)} className="apple-button-primary">
                      <Plus className="w-4 h-4" /> {currentT.new_lead_btn}
                    </button>
                  </div>
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

              {/* ── Phase 91: CRM Win-Rate & Conversion Stats Header ── */}
              {leads.length > 0 && (() => {
                const total      = leads.length;
                const closed     = leads.filter(l => l.status === 'Closed').length;
                const qualified  = leads.filter(l => l.status === 'Qualified').length;
                const winRate    = total > 0 ? Math.round((closed / total) * 100) : 0;
                const convRate   = total > 0 ? Math.round(((closed + qualified) / total) * 100) : 0;
                const pipelineVal = leads
                  .filter(l => l.status !== 'Closed')
                  .reduce((s, l) => s + (l.creditLimit ?? 0), 0);
                const avgScore   = leads.filter(l => l.score != null).length > 0
                  ? Math.round(leads.filter(l => l.score != null).reduce((s, l) => s + (l.score ?? 0), 0) / leads.filter(l => l.score != null).length)
                  : null;
                const p91Rate = kpiCurrency === 'USD' ? (exchangeRates?.USD||1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR||1) : 1;
                const p91Sym  = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const p91Val  = kpiCurrency === 'TRY' ? pipelineVal : pipelineVal / p91Rate;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { label: currentLanguage === 'tr' ? 'Toplam Aday' : 'Total Leads',    value: total.toString(),       sub: null,                        color: 'text-gray-800' },
                      { label: currentLanguage === 'tr' ? 'Kazanma Oranı' : 'Win Rate',      value: `${winRate}%`,          sub: `${closed} ${currentLanguage==='tr'?'kapandı':'closed'}`, color: winRate >= 40 ? 'text-emerald-700' : winRate >= 20 ? 'text-amber-700' : 'text-red-600' },
                      { label: currentLanguage === 'tr' ? 'Pipeline Değeri' : 'Pipeline Value', value: `${p91Sym}${p91Val.toLocaleString('tr-TR',{maximumFractionDigits:0})}`, sub: currentLanguage==='tr'?'aktif adaylar':'active leads', color: 'text-blue-700' },
                      { label: currentLanguage === 'tr' ? 'Ort. AI Puanı' : 'Avg AI Score',  value: avgScore != null ? `${avgScore}/100` : '—',  sub: `${convRate}% ${currentLanguage==='tr'?'dönüşüm':'conversion'}`, color: avgScore != null && avgScore >= 70 ? 'text-emerald-700' : 'text-gray-700' },
                    ].map((s, i) => (
                      <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
                        <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                        <p className="text-[10px] font-bold text-gray-400 mt-0.5 uppercase tracking-wide">{s.label}</p>
                        {s.sub && <p className="text-[9px] text-gray-400 mt-0.5">{s.sub}</p>}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ── Phase 69: Lead Pipeline Funnel Strip ── */}
              {leads.length > 0 && (() => {
                const stages = [
                  { key: 'New',       labelTR: 'Yeni',         color: 'bg-sky-400',     text: 'text-sky-700',     bg: 'bg-sky-50'     },
                  { key: 'Contacted', labelTR: 'İrtibat',      color: 'bg-indigo-400',  text: 'text-indigo-700',  bg: 'bg-indigo-50'  },
                  { key: 'Qualified', labelTR: 'Nitelikli',    color: 'bg-violet-400',  text: 'text-violet-700',  bg: 'bg-violet-50'  },
                  { key: 'Closed',    labelTR: 'Kapandı',      color: 'bg-emerald-400', text: 'text-emerald-700', bg: 'bg-emerald-50' },
                ];
                const total = leads.length;
                const counts = stages.map(s => ({ ...s, count: leads.filter(l => l.status === s.key).length }));
                const maxCount = Math.max(...counts.map(s => s.count), 1);
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
                      {currentLanguage === 'tr' ? 'Satış Hunisi' : 'Pipeline Funnel'}
                      <span className="ml-2 text-gray-300 font-normal">{total} {currentLanguage === 'tr' ? 'aday' : 'leads'}</span>
                    </p>
                    <div className="grid grid-cols-4 gap-3">
                      {counts.map((s) => {
                        const pct = Math.round((s.count / total) * 100);
                        const barH = Math.round((s.count / maxCount) * 48);
                        return (
                          <div key={s.key} className="flex flex-col items-center gap-1.5">
                            {/* Mini bar */}
                            <div className="w-full flex items-end justify-center h-12">
                              <div
                                className={`w-full rounded-t-lg transition-all duration-700 ${s.color} opacity-80`}
                                style={{ height: `${Math.max(barH, 4)}px` }}
                              />
                            </div>
                            {/* Count + label */}
                            <div className={`w-full text-center px-2 py-1.5 rounded-xl ${s.bg}`}>
                              <p className={`text-base font-black ${s.text}`}>{s.count}</p>
                              <p className="text-[9px] font-bold text-gray-500 truncate">
                                {currentLanguage === 'tr' ? s.labelTR : s.key}
                              </p>
                            </div>
                            {/* Percentage */}
                            <span className="text-[9px] text-gray-400 font-medium">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                    {/* Conversion rate hint */}
                    {(() => {
                      const newCount = counts.find(s => s.key === 'New')?.count ?? 0;
                      const closedCount = counts.find(s => s.key === 'Closed')?.count ?? 0;
                      const conv = newCount > 0 ? Math.round((closedCount / total) * 100) : 0;
                      return (
                        <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between">
                          <span className="text-[10px] text-gray-400">
                            {currentLanguage === 'tr' ? 'Dönüşüm oranı' : 'Conversion rate'}
                          </span>
                          <span className={`text-[11px] font-bold ${conv >= 30 ? 'text-emerald-600' : conv >= 15 ? 'text-amber-600' : 'text-gray-500'}`}>
                            {conv}%
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {viewMode === 'list' ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-3">
                    {/* ── Phase 72: Lead Status Filter Chips ── */}
                    <div className="flex flex-wrap gap-1.5">
                      {(['All', 'New', 'Contacted', 'Qualified', 'Closed'] as const).map(s => {
                        const count = s === 'All' ? leads.length : leads.filter(l => l.status === s).length;
                        const isActive = leadStatusFilter === s;
                        const chipColors: Record<string, string> = {
                          All:       'bg-gray-900 text-white',
                          New:       'bg-sky-500 text-white',
                          Contacted: 'bg-indigo-500 text-white',
                          Qualified: 'bg-violet-500 text-white',
                          Closed:    'bg-emerald-500 text-white',
                        };
                        const labelTR: Record<string, string> = { All: 'Tümü', New: 'Yeni', Contacted: 'İrtibat', Qualified: 'Nitelikli', Closed: 'Kapandı' };
                        return (
                          <button
                            key={s}
                            onClick={() => setLeadStatusFilter(s)}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border",
                              isActive
                                ? `${chipColors[s]} border-transparent shadow-sm`
                                : "bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-800"
                            )}
                          >
                            {currentLanguage === 'tr' ? labelTR[s] : s}
                            <span className={cn("text-[9px] px-1 py-0.5 rounded-full", isActive ? "bg-white/20" : "bg-gray-100 text-gray-500")}>
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
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
                        (leadStatusFilter === 'All' || l.status === leadStatusFilter) &&
                        (l.name.toLowerCase().includes(crmSearch.toLowerCase()) ||
                        l.company.toLowerCase().includes(crmSearch.toLowerCase()) ||
                        l.email.toLowerCase().includes(crmSearch.toLowerCase()))
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
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-xs text-gray-500 truncate">{lead.company}</p>
                                {/* Phase 49 + Phase 85: Lead-to-Order revenue badge with kpiCurrency */}
                                {(() => {
                                  const rev = orders
                                    .filter(o => o.customerName === lead.name || o.customerName === lead.company)
                                    .reduce((s, o) => s + (o.totalPrice || 0), 0);
                                  if (rev === 0) return null;
                                  const p85Rate = kpiCurrency === 'USD' ? (exchangeRates?.USD||1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR||1) : 1;
                                  const p85Sym  = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                                  const p85Val  = kpiCurrency === 'TRY' ? rev : rev / p85Rate;
                                  return (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 flex-shrink-0">
                                      {p85Sym}{p85Val.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                                    </span>
                                  );
                                })()}
                                {/* Phase 81: Lead Age Indicator */}
                                {(() => {
                                  if (!lead.createdAt) return null;
                                  const created = typeof (lead.createdAt as { toDate?: () => Date }).toDate === 'function'
                                    ? (lead.createdAt as { toDate: () => Date }).toDate()
                                    : new Date(lead.createdAt as string | number);
                                  const ageD = Math.round((Date.now() - created.getTime()) / 86400000);
                                  if (ageD < 1) return null;
                                  const ageColor = ageD <= 7 ? 'bg-emerald-50 text-emerald-600' : ageD <= 30 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-500';
                                  const ageLabel = ageD < 30
                                    ? `${ageD}${currentLanguage === 'tr' ? 'g' : 'd'}`
                                    : `${Math.round(ageD / 30)}${currentLanguage === 'tr' ? 'a' : 'm'}`;
                                  return (
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${ageColor}`} title={`Lead created ${ageD} days ago`}>
                                      {ageLabel}
                                    </span>
                                  );
                                })()}
                              </div>
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
                              {/* Phase 36: Follow-up due badge */}
                              {lead.nextFollowUpDate && (() => {
                                const due = typeof (lead.nextFollowUpDate as { toDate?: () => Date }).toDate === 'function'
                                  ? (lead.nextFollowUpDate as { toDate: () => Date }).toDate()
                                  : new Date(lead.nextFollowUpDate as unknown as string | number);
                                const today = new Date(); today.setHours(0, 0, 0, 0);
                                const daysLeft = Math.round((due.getTime() - today.getTime()) / 86400000);
                                const isOverdue = daysLeft < 0;
                                const isToday   = daysLeft === 0;
                                const isSoon    = daysLeft > 0 && daysLeft <= 7;
                                if (!isOverdue && !isToday && !isSoon) return null;
                                // Phase 36 + Phase 48: overdue, today, and upcoming
                                return (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full block mt-1 ${isOverdue ? 'bg-red-100 text-red-600' : isToday ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>
                                    {isOverdue
                                      ? (currentLanguage === 'tr' ? '⚠ Gecikmiş' : '⚠ Overdue')
                                      : isToday
                                        ? (currentLanguage === 'tr' ? '📅 Bugün' : '📅 Today')
                                        : (currentLanguage === 'tr' ? `📅 ${daysLeft}g` : `📅 ${daysLeft}d`)}
                                  </span>
                                );
                              })()}
                              <p className="text-[10px] text-gray-400 mt-1">{lead.phone}</p>
                            </div>
                            <button onClick={() => { setSelectedLead(lead); trackView({ type: 'lead', id: lead.id, label: lead.name, tab: 'crm' }); }} className="text-brand text-sm font-bold hover:underline">{currentT.view}</button>
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

                    {/* ── Phase 45: Customer Revenue Leaderboard ── */}
                    {(() => {
                      const revenueMap: Record<string, number> = {};
                      for (const o of orders) {
                        revenueMap[o.customerName] = (revenueMap[o.customerName] ?? 0) + (o.totalPrice || 0);
                      }
                      const top5 = Object.entries(revenueMap)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 5);
                      if (top5.length === 0) return null;
                      const maxRev = top5[0][1];
                      return (
                        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                          <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-brand" />
                            {currentLanguage === 'tr' ? 'En Yüksek Ciro' : 'Top Customers'}
                          </h3>
                          <div className="space-y-3">
                            {top5.map(([name, rev], i) => (
                              <div key={name} className="flex items-center gap-2">
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-gray-100 text-gray-600' : 'bg-gray-50 text-gray-400'}`}>
                                  {i + 1}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-0.5">
                                    <p className="text-[11px] font-semibold text-gray-700 truncate">{name}</p>
                                    <p className="text-[11px] font-bold text-gray-800 ml-2 flex-shrink-0">
                                      {kpiCurrency==='TRY'?'₺':kpiCurrency==='USD'?'$':'€'}{(kpiCurrency==='TRY'?rev:rev/(kpiCurrency==='USD'?(exchangeRates?.USD||1):(exchangeRates?.EUR||1))).toLocaleString('tr-TR',{maximumFractionDigits:0})}
                                    </p>
                                  </div>
                                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-700 ${i === 0 ? 'bg-brand' : i === 1 ? 'bg-gray-400' : 'bg-gray-300'}`}
                                      style={{ width: `${(rev / maxRev) * 100}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Phase 53: Sales Funnel ── */}
                    {leads.length > 0 && (() => {
                      const stages = [
                        { key: 'New',       labelTR: 'Yeni',        color: 'bg-blue-400'    },
                        { key: 'Contacted', labelTR: 'İletişim',    color: 'bg-purple-400'  },
                        { key: 'Qualified', labelTR: 'Nitelikli',   color: 'bg-amber-400'   },
                        { key: 'Closed',    labelTR: 'Kapandı',     color: 'bg-emerald-500' },
                      ];
                      const maxCount = Math.max(...stages.map(s => leads.filter(l => l.status === s.key).length), 1);
                      return (
                        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                          <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                            <Flame className="w-4 h-4 text-brand" />
                            {currentLanguage === 'tr' ? 'Satış Hunisi' : 'Sales Funnel'}
                          </h3>
                          <div className="space-y-2">
                            {stages.map((s, i) => {
                              const count = leads.filter(l => l.status === s.key).length;
                              const width = maxCount > 0 ? (count / maxCount) * 100 : 0;
                              // Funnel taper: each stage is slightly narrower
                              const indent = i * 6;
                              return (
                                <div key={s.key} style={{ paddingLeft: `${indent}px`, paddingRight: `${indent}px` }}>
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-[10px] text-gray-400 w-16 shrink-0 truncate">
                                      {currentLanguage === 'tr' ? s.labelTR : s.key}
                                    </span>
                                    <div className="flex-1 h-5 bg-gray-50 rounded-md overflow-hidden">
                                      <div className={`h-full ${s.color} rounded-md flex items-center justify-end pr-1.5 transition-all duration-700`} style={{ width: `${Math.max(width, count > 0 ? 12 : 0)}%` }}>
                                        <span className="text-[9px] font-black text-white">{count}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Phase 32: AI Score Histogram ── */}
                    {leads.some(l => l.score != null) && (
                      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                          <BarChart3 className="w-4 h-4 text-brand" />
                          {currentLanguage === 'tr' ? 'AI Skor Dağılımı' : 'AI Score Distribution'}
                        </h3>
                        {(() => {
                          const buckets = [
                            { label: '0–20',   min: 0,  max: 20,  color: 'bg-red-400' },
                            { label: '21–40',  min: 21, max: 40,  color: 'bg-orange-400' },
                            { label: '41–60',  min: 41, max: 60,  color: 'bg-amber-400' },
                            { label: '61–80',  min: 61, max: 80,  color: 'bg-blue-400' },
                            { label: '81–100', min: 81, max: 100, color: 'bg-emerald-500' },
                          ];
                          const scored = leads.filter(l => l.score != null);
                          const maxCount = Math.max(...buckets.map(b => scored.filter(l => (l.score ?? 0) >= b.min && (l.score ?? 0) <= b.max).length), 1);
                          return (
                            <div className="space-y-2">
                              {buckets.map(b => {
                                const count = scored.filter(l => (l.score ?? 0) >= b.min && (l.score ?? 0) <= b.max).length;
                                return (
                                  <div key={b.label} className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-400 font-mono w-12 shrink-0">{b.label}</span>
                                    <div className="flex-1 h-4 bg-gray-50 rounded-full overflow-hidden">
                                      <div className={`h-full ${b.color} rounded-full transition-all duration-500`} style={{ width: `${(count / maxCount) * 100}%` }} />
                                    </div>
                                    <span className="text-[10px] font-bold text-gray-600 w-5 text-right shrink-0">{count}</span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}
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
                          /* Phase 87: score bar kanban card */
                          <div key={lead.id} onClick={() => setSelectedLead(lead)} className="bg-white rounded-lg border border-gray-200 shadow-sm cursor-pointer hover:border-brand transition-colors overflow-hidden">
                            <div className="p-4">
                              <div className="flex justify-between items-start mb-2">
                                <h4 className="font-bold text-sm text-[#1D2226]">{lead.name}</h4>
                                <div className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", (lead.score || 0) > 70 ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500")}>
                                  {lead.score || '--'}
                                </div>
                              </div>
                              <p className="text-xs text-gray-500 mb-2">{lead.company}</p>
                              <p className="text-[10px] text-gray-400 truncate">{lead.email}</p>
                            </div>
                            {/* Score stripe */}
                            {lead.score != null && (
                              <div className="h-1 w-full bg-gray-100">
                                <div
                                  className={`h-full transition-all duration-700 ${lead.score >= 80 ? 'bg-emerald-400' : lead.score >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                                  style={{ width: `${lead.score}%` }}
                                />
                              </div>
                            )}
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
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={() => { setEditingLeadData(selectedLead); setIsEditingLead(true); }} className="apple-button-secondary">
                        <Edit2 className="w-4 h-4" /> {currentT.edit}
                      </button>
                      <button onClick={() => handleDeleteLead(selectedLead.id)} className="apple-button-secondary text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" /> {currentT.delete}
                      </button>
                      {selectedLead.phone && (
                        <button
                          onClick={async () => {
                            const msg = currentLanguage === 'tr'
                              ? `Merhaba ${selectedLead.name}, Cetpa'dan yazıyoruz. Size nasıl yardımcı olabiliriz?`
                              : `Hello ${selectedLead.name}, reaching out from Cetpa. How can we help you?`;
                            try {
                              const r = await fetch('/api/whatsapp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: selectedLead.phone, message: msg }) });
                              const d = await r.json();
                              if (d.success) toast(currentLanguage === 'tr' ? 'WhatsApp mesajı gönderildi ✓' : 'WhatsApp message sent ✓', 'success');
                              else if (d.notConfigured) toast(currentLanguage === 'tr' ? 'WhatsApp sağlayıcısı yapılandırılmamış. Ayarlar\'dan WHATSAPP_360DIALOG_API_KEY ekleyin.' : 'WhatsApp provider not configured. Add WHATSAPP_360DIALOG_API_KEY in Settings.', 'error');
                              else toast(d.error || 'WhatsApp hatası', 'error');
                            } catch(e) { toast(e instanceof Error ? e.message : 'Hata', 'error'); }
                          }}
                          className="apple-button-secondary text-green-700 hover:bg-green-50"
                        >
                          <MessageSquare className="w-4 h-4" /> WhatsApp
                        </button>
                      )}
                      {/* Phase 41: Quick Call + Email buttons */}
                      {selectedLead.phone && (
                        <a href={`tel:${selectedLead.phone}`}
                          className="apple-button-secondary flex items-center gap-2 text-blue-700 hover:bg-blue-50"
                          title={selectedLead.phone}>
                          <Phone className="w-4 h-4" />
                          {currentLanguage === 'tr' ? 'Ara' : 'Call'}
                        </a>
                      )}
                      {selectedLead.email && (
                        <a href={`mailto:${selectedLead.email}`}
                          className="apple-button-secondary flex items-center gap-2 text-purple-700 hover:bg-purple-50"
                          title={selectedLead.email}>
                          <Mail className="w-4 h-4" />
                          {currentLanguage === 'tr' ? 'E-posta' : 'Email'}
                        </a>
                      )}
                      <button
                        onClick={() => {
                          const leadOrders = orders.filter(o =>
                            o.leadId === selectedLead.id || o.customerName === selectedLead.name
                          );
                          exportCustomerStatement(
                            selectedLead,
                            leadOrders,
                            currentLanguage as 'tr' | 'en',
                          );
                        }}
                        className="apple-button-secondary flex items-center gap-2"
                        title={currentLanguage === 'tr' ? 'Hesap ekstresi PDF olarak indir' : 'Download account statement PDF'}
                      >
                        <FileDown className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Ekstre PDF' : 'Statement PDF'}
                      </button>
                      {/* Phase 92: Mark as Won / Reopen */}
                      {selectedLead.status !== 'Closed' ? (
                        <button
                          onClick={() => openConfirm({
                            title: currentLanguage === 'tr' ? 'Aday Kazanıldı mı?' : 'Mark Lead as Won?',
                            message: currentLanguage === 'tr'
                              ? `"${selectedLead.name}" adayını Kapandı (Kazanıldı) olarak işaretlemek istiyor musunuz?`
                              : `Mark "${selectedLead.name}" as Closed (Won)?`,
                            confirmLabel: currentLanguage === 'tr' ? 'Kazanıldı ✓' : 'Mark Won ✓',
                            onConfirm: async () => {
                              try {
                                await updateDoc(doc(db, 'leads', selectedLead.id), { status: 'Closed', updatedAt: serverTimestamp() });
                                setSelectedLead({ ...selectedLead, status: 'Closed' });
                                toast(currentLanguage === 'tr' ? '🎉 Aday kazanıldı olarak işaretlendi!' : '🎉 Lead marked as won!', 'success');
                              } catch(err) { handleFirestoreError(err, OperationType.UPDATE, `leads/${selectedLead.id}`); }
                            },
                          })}
                          className="apple-button-secondary text-emerald-700 hover:bg-emerald-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {currentLanguage === 'tr' ? 'Kazanıldı' : 'Mark Won'}
                        </button>
                      ) : (
                        <button
                          onClick={() => openConfirm({
                            title: currentLanguage === 'tr' ? 'Aday Yeniden Aç?' : 'Reopen Lead?',
                            message: currentLanguage === 'tr' ? `"${selectedLead.name}" adayını yeniden açmak istiyor musunuz?` : `Reopen lead "${selectedLead.name}"?`,
                            confirmLabel: currentLanguage === 'tr' ? 'Yeniden Aç' : 'Reopen',
                            onConfirm: async () => {
                              try {
                                await updateDoc(doc(db, 'leads', selectedLead.id), { status: 'Qualified', updatedAt: serverTimestamp() });
                                setSelectedLead({ ...selectedLead, status: 'Qualified' });
                                toast(currentLanguage === 'tr' ? 'Aday yeniden açıldı' : 'Lead reopened', 'info');
                              } catch(err) { handleFirestoreError(err, OperationType.UPDATE, `leads/${selectedLead.id}`); }
                            },
                          })}
                          className="apple-button-secondary text-amber-700 hover:bg-amber-50"
                        >
                          <RefreshCw className="w-4 h-4" />
                          {currentLanguage === 'tr' ? 'Yeniden Aç' : 'Reopen'}
                        </button>
                      )}
                      {/* Phase 83: pre-fill order form from lead */}
                      <button onClick={() => {
                        setNewOrder(prev => ({
                          ...prev,
                          customerName: selectedLead.name,
                          shippingAddress: selectedLead.company || '',
                          customerType: selectedLead.customerType || 'B2B',
                          faturali: selectedLead.customerType === 'B2B',
                          faturaTipi: selectedLead.customerType === 'B2B' ? 'e-fatura' : 'e-arsiv',
                          leadId: selectedLead.id,
                        }));
                        setOrderCustomerSearch(selectedLead.name);
                        setIsAddingOrder(true);
                      }} className="apple-button-primary">
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
                  {/* ── Phase 58: Lead Quick-Note ── */}
                  {(() => {
                    const storageKey = `cetpa-lead-note-${selectedLead.id}`;
                    const [lnText, setLnText] = React.useState<string>(() => localStorage.getItem(storageKey) ?? '');
                    const lnTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
                    const handleLnChange = (val: string) => {
                      setLnText(val);
                      if (lnTimer.current) clearTimeout(lnTimer.current);
                      lnTimer.current = setTimeout(() => localStorage.setItem(storageKey, val), 600);
                    };
                    return (
                      <div className="bg-amber-50 border border-amber-100 p-5 rounded-xl">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            {currentLanguage === 'tr' ? 'Hızlı Not (Yerel)' : 'Quick Note (Local)'}
                          </h3>
                          {lnText && (
                            <span className="text-[9px] text-amber-500 font-semibold">
                              {currentLanguage === 'tr' ? 'Otomatik kaydediliyor' : 'Auto-saved'}
                            </span>
                          )}
                        </div>
                        <textarea
                          value={lnText}
                          onChange={e => handleLnChange(e.target.value)}
                          rows={3}
                          placeholder={currentLanguage === 'tr' ? 'Bu müşteri adayı için hızlı notunuzu yazın…' : 'Jot a quick note about this lead…'}
                          className="w-full bg-white/70 rounded-lg px-3 py-2 text-sm text-gray-700 placeholder-amber-300 outline-none focus:ring-2 focus:ring-amber-200 resize-none leading-relaxed border border-amber-100"
                        />
                      </div>
                    );
                  })()}
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

                  {/* ── Cari Ekstre (AR aging for this customer) ── */}
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <CariEkstrePanel
                      currentLanguage={currentLanguage}
                      leadId={selectedLead.id}
                      customerName={selectedLead.name}
                    />
                  </div>

                  {/* ── Mutabakat Mektubu ── */}
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <MutabakatPanel leadId={selectedLead.id} currentLanguage={currentLanguage} />
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
                    {/* ── Phase 26: Enhanced Activity Timeline ── */}
                    <div className="space-y-0">
                      {(!selectedLead.activities || selectedLead.activities.length === 0) ? (
                        <p className="text-sm text-gray-500 text-center py-4">{currentT.no_activities_logged}</p>
                      ) : (() => {
                        const sorted = [...selectedLead.activities].sort((a, b) => {
                          const getTs = (d: unknown) => typeof (d as { toDate?: () => Date }).toDate === 'function'
                            ? (d as { toDate: () => Date }).toDate().getTime()
                            : new Date(d as string | number).getTime();
                          return getTs(b.date) - getTs(a.date);
                        });
                        const ICON_MAP: Record<string, { icon: React.ElementType; bg: string; color: string }> = {
                          Note:    { icon: FileText, bg: 'bg-gray-100',    color: 'text-gray-600'    },
                          Call:    { icon: Phone,    bg: 'bg-blue-50',     color: 'text-blue-600'    },
                          Email:   { icon: Mail,     bg: 'bg-emerald-50',  color: 'text-emerald-600' },
                          Meeting: { icon: Users,    bg: 'bg-purple-50',   color: 'text-purple-600'  },
                        };
                        return sorted.map((activity, idx) => {
                          const cfg = ICON_MAP[activity.type] ?? ICON_MAP.Note;
                          const Icon = cfg.icon;
                          const dateStr = (() => {
                            const d = typeof (activity.date as { toDate?: () => Date }).toDate === 'function'
                              ? (activity.date as { toDate: () => Date }).toDate()
                              : new Date(activity.date as unknown as string | number);
                            return d.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
                          })();
                          return (
                            <div key={activity.id} className="flex gap-3 relative">
                              {/* Vertical connector line */}
                              {idx < sorted.length - 1 && (
                                <div className="absolute left-4 top-9 bottom-0 w-[2px] bg-gray-100" />
                              )}
                              {/* Icon bubble */}
                              <div className="relative z-10 flex-shrink-0 mt-1">
                                <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center`}>
                                  <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                                </div>
                              </div>
                              {/* Content card */}
                              <div className={`flex-1 bg-gray-50 p-3 rounded-xl border border-gray-100 ${idx < sorted.length - 1 ? 'mb-3' : ''}`}>
                                <div className="flex justify-between items-start mb-1 gap-2">
                                  <span className={`text-xs font-bold ${cfg.color}`}>{currentT[activity.type.toLowerCase()] ?? activity.type}</span>
                                  <span className="text-[9px] text-gray-400 whitespace-nowrap">{dateStr}</span>
                                </div>
                                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{activity.description}</p>
                              </div>
                            </div>
                          );
                        });
                      })()}
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
                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
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
                    {/* Phase 93: Export filtered orders to CSV */}
                    <button
                      onClick={() => {
                        const filtered = orders.filter(o =>
                          (orderStatusFilter === 'All' || o.status === orderStatusFilter) &&
                          (o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                          (o.shopifyOrderId ?? '').toLowerCase().includes(orderSearch.toLowerCase()) ||
                          (o.shippingAddress ?? '').toLowerCase().includes(orderSearch.toLowerCase()))
                        );
                        exportOrdersCSV(filtered, currentLanguage);
                        toast(
                          currentLanguage === 'tr'
                            ? `${filtered.length} sipariş CSV olarak indirildi`
                            : `${filtered.length} order${filtered.length !== 1 ? 's' : ''} exported to CSV`,
                          'success'
                        );
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold transition-colors"
                      title={currentLanguage === 'tr' ? 'Filtrelenmiş siparişleri CSV olarak indir' : 'Export filtered orders as CSV'}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {orderStatusFilter !== 'All'
                        ? `CSV (${orders.filter(o => o.status === orderStatusFilter).length})`
                        : 'CSV'}
                    </button>
                    <button onClick={() => { setSelectedLead(null); setIsAddingOrder(true); }}
                      className="apple-button-primary">
                      <Plus className="w-4 h-4" /> {currentT.new_order}
                    </button>
                  </div>
                }
              />

              {/* ── Bulk action bar (appears when orders are selected) ── */}
              {selectedOrderIds.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#1a3a5c] text-white px-5 py-3 rounded-2xl shadow-2xl border border-white/10">
                  <span className="text-sm font-bold">{selectedOrderIds.size} {currentLanguage === 'tr' ? 'sipariş seçildi' : 'orders selected'}</span>
                  <div className="w-px h-5 bg-white/20" />
                  {(['Processing', 'Shipped', 'Delivered'] as Order['status'][]).map(s => (
                    <button
                      key={s}
                      disabled={bulkActionLoading}
                      onClick={() => openConfirm({
                        title: currentLanguage === 'tr' ? 'Toplu Güncelleme' : 'Bulk Update',
                        message: `${selectedOrderIds.size} ${currentLanguage === 'tr' ? 'siparişin durumunu' : "orders'"} "${s}" ${currentLanguage === 'tr' ? 'olarak güncellensin mi?' : 'status update?'}`,
                        onConfirm: async () => {
                          setBulkActionLoading(true);
                          for (const id of selectedOrderIds) {
                            await handleUpdateOrderStatus(id, s);
                          }
                          setSelectedOrderIds(new Set());
                          setBulkActionLoading(false);
                        },
                      })}
                      className="text-xs font-bold px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 transition-colors disabled:opacity-50"
                    >
                      → {s}
                    </button>
                  ))}
                  <div className="w-px h-5 bg-white/20" />
                  <button
                    onClick={() => {
                      // Bulk PDF export: generate one PDF with all selected orders
                      const sel = orders.filter(o => selectedOrderIds.has(o.id));
                      import('jspdf').then(({ jsPDF }) => {
                        import('jspdf-autotable').then(({ default: autoTable }) => {
                          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                          pdf.setFontSize(14);
                          pdf.text(currentLanguage === 'tr' ? 'Sipariş Listesi' : 'Order List', 14, 20);
                          autoTable(pdf, {
                            startY: 28,
                            head: [['#', currentLanguage==='tr'?'Müşteri':'Customer', currentLanguage==='tr'?'Durum':'Status', currentLanguage==='tr'?'Tutar':'Amount']],
                            body: sel.map(o => [o.shopifyOrderId ?? o.id.slice(0,8), o.customerName, o.status, `₺${o.totalPrice.toLocaleString('tr-TR')}`]),
                            styles: { fontSize: 9 },
                          });
                          pdf.save(`siparisler_${new Date().toISOString().split('T')[0]}.pdf`);
                        });
                      });
                    }}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 transition-colors flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" /> PDF
                  </button>
                  <button
                    onClick={() => setSelectedOrderIds(new Set())}
                    className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* ── Phase 55: Status Filter Chips ── */}
              <div className="flex flex-wrap gap-1.5">
                {(['All', 'Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'] as const).map(s => {
                  const count = s === 'All' ? orders.length : orders.filter(o => o.status === s).length;
                  const isActive = orderStatusFilter === s;
                  const chipColors: Record<string, string> = {
                    All:        'bg-gray-900 text-white',
                    Pending:    'bg-amber-500 text-white',
                    Processing: 'bg-purple-500 text-white',
                    Shipped:    'bg-blue-500 text-white',
                    Delivered:  'bg-emerald-500 text-white',
                    Cancelled:  'bg-gray-400 text-white',
                  };
                  const labelTR: Record<string, string> = { All: 'Tümü', Pending: 'Bekliyor', Processing: 'Hazırlanıyor', Shipped: 'Kargoda', Delivered: 'Teslim', Cancelled: 'İptal' };
                  return (
                    <button
                      key={s}
                      onClick={() => setOrderStatusFilter(s)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border",
                        isActive
                          ? `${chipColors[s]} border-transparent shadow-sm`
                          : darkMode
                            ? "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                            : "bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-800"
                      )}
                    >
                      {currentLanguage === 'tr' ? labelTR[s] : s}
                      <span className={cn("text-[9px] px-1 py-0.5 rounded-full", isActive ? "bg-white/20" : darkMode ? "bg-white/10" : "bg-gray-100 text-gray-500")}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* ── Phase 70: Order Aging Alert ── */}
              {(() => {
                const now = Date.now();
                const THREE_DAYS = 3 * 86400000;
                const stuckOrders = orders.filter(o => {
                  if (o.status !== 'Pending' && o.status !== 'Processing') return false;
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return false;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number | Date);
                  return now - d.getTime() > THREE_DAYS;
                });
                if (stuckOrders.length === 0) return null;
                const pendingStuck    = stuckOrders.filter(o => o.status === 'Pending').length;
                const processingStuck = stuckOrders.filter(o => o.status === 'Processing').length;
                return (
                  <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-amber-800">
                        {currentLanguage === 'tr'
                          ? `${stuckOrders.length} sipariş 3+ gündür bekliyor`
                          : `${stuckOrders.length} order${stuckOrders.length > 1 ? 's' : ''} stuck for 3+ days`}
                      </p>
                      <p className="text-[10px] text-amber-600 mt-0.5">
                        {[
                          pendingStuck    > 0 && `${pendingStuck} Pending`,
                          processingStuck > 0 && `${processingStuck} Processing`,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <button
                      onClick={() => setOrderStatusFilter('Pending')}
                      className="text-[10px] font-bold text-amber-700 hover:text-amber-900 bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded-full transition-colors flex-shrink-0"
                    >
                      {currentLanguage === 'tr' ? 'İncele' : 'Review'}
                    </button>
                  </div>
                );
              })()}

              {/* Desktop Table View */}
              <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {/* Select-all checkbox */}
                        <th className="pl-4 py-4 w-8">
                          <input
                            type="checkbox"
                            className="rounded accent-brand cursor-pointer"
                            checked={selectedOrderIds.size > 0 && (() => {
                              const filtered = orders.filter(o =>
                                o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                                o.shopifyOrderId?.toLowerCase().includes(orderSearch.toLowerCase())
                              );
                              return filtered.every(o => selectedOrderIds.has(o.id));
                            })()}
                            onChange={e => {
                              const filtered = orders.filter(o =>
                                o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                                o.shopifyOrderId?.toLowerCase().includes(orderSearch.toLowerCase())
                              );
                              if (e.target.checked) {
                                setSelectedOrderIds(new Set(filtered.map(o => o.id)));
                              } else {
                                setSelectedOrderIds(new Set());
                              }
                            }}
                          />
                        </th>
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
                          (orderStatusFilter === 'All' || o.status === orderStatusFilter) &&
                          (o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                          o.shopifyOrderId?.toLowerCase().includes(orderSearch.toLowerCase()) ||
                          o.shippingAddress?.toLowerCase().includes(orderSearch.toLowerCase()))
                        );
                        const sorted = sortData(filtered, orderSort.key, orderSort.dir);
                        return sorted.length === 0 ? (
                          <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500">{currentT.no_orders_found}</td></tr>
                        ) : sorted.map(order => (
                          <tr
                            key={order.id}
                            className={cn("hover:bg-gray-50 transition-colors cursor-pointer", selectedOrderIds.has(order.id) && "bg-brand/5")}
                            onClick={() => { setSelectedOrder(order); trackView({ type: 'order', id: order.id, label: `#${order.shopifyOrderId || order.id.slice(-6)} — ${order.customerName}`, tab: 'orders' }); }}
                          >
                            <td className="pl-4 py-4 w-8" onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="rounded accent-brand cursor-pointer"
                                checked={selectedOrderIds.has(order.id)}
                                onChange={e => {
                                  const next = new Set(selectedOrderIds);
                                  if (e.target.checked) next.add(order.id);
                                  else next.delete(order.id);
                                  setSelectedOrderIds(next);
                                }}
                              />
                            </td>
                            <td className="px-6 py-4 font-medium text-[#1D2226]">{order.shopifyOrderId}</td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <span className="text-gray-600">{order.customerName}</span>
                                {/* Phase 46: CustomerType badge */}
                                {order.customerType && (
                                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0", order.customerType === 'B2B' ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500")}>
                                    {order.customerType}
                                  </span>
                                )}
                                {/* Phase 78: Notes indicator dot */}
                                {order.notes && (
                                  <span
                                    className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 cursor-help"
                                    title={order.notes}
                                  >
                                    <FileText className="w-2.5 h-2.5 text-amber-600" />
                                  </span>
                                )}
                              </div>
                            </td>
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
                              <div>{kpiCurrency==='TRY'?'₺':kpiCurrency==='USD'?'$':'€'}{(kpiCurrency==='TRY'?order.totalPrice:order.totalPrice/(kpiCurrency==='USD'?(exchangeRates?.USD||1):(exchangeRates?.EUR||1))).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                              <div className="flex flex-col items-end gap-0.5 mt-0.5">
                                {order.faturali ? (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${order.faturaTipi==='ihracat' ? 'bg-blue-100 text-blue-600' : order.faturaTipi==='e-arsiv' ? 'bg-purple-100 text-purple-600' : 'bg-green-100 text-green-600'}`}>
                                    {order.faturaTipi ? order.faturaTipi.toUpperCase() : 'e-FATURA'} • KDV%{order.kdvOran ?? 0}
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-bold bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">
                                    {currentLanguage === 'tr' ? 'FATURASIZ' : 'NO INVOICE'}
                                  </span>
                                )}
                                {/* Phase 67: Mikro sync badge */}
                                {order.mikroFaturaNo ? (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#1a3a5c]/10 text-[#1a3a5c] inline-flex items-center gap-0.5 max-w-[120px] truncate" title={`Mikro: ${order.mikroFaturaNo}`}>
                                    ✓ {order.mikroFaturaNo}
                                  </span>
                                ) : order.faturali ? (
                                  <span className="text-[9px] text-amber-500 font-medium inline-flex items-center gap-0.5" title={currentLanguage === 'tr' ? 'Mikro\'ya gönderilmedi' : 'Not pushed to Mikro'}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                                    Mikro
                                  </span>
                                ) : null}
                                {/* Phase 89: Payment status badge */}
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleToggleOrderPaid(order); }}
                                  title={order.paid ? (currentLanguage === 'tr' ? 'Ödendi — tıkla: ödenmedi yap' : 'Paid — click to mark unpaid') : (currentLanguage === 'tr' ? 'Ödenmedi — tıkla: ödendi yap' : 'Unpaid — click to mark paid')}
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full transition-colors ${order.paid ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
                                >
                                  {order.paid ? (currentLanguage === 'tr' ? '✓ Ödendi' : '✓ Paid') : (currentLanguage === 'tr' ? '⏳ Ödenmedi' : '⏳ Unpaid')}
                                </button>
                              </div>
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
                                {/* Mikro e-Fatura push */}
                                {!order.mikroFaturaNo && order.faturali !== false && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); void handleMikroFatura(order); }}
                                    disabled={!!faturaLoading[order.id]}
                                    className="text-xs font-bold px-2 py-1 bg-[#1a3a5c]/10 text-[#1a3a5c] hover:bg-[#1a3a5c] hover:text-white rounded-lg transition-all flex items-center gap-1 disabled:opacity-40"
                                    title={currentLanguage==='tr'?'Mikro\'ya e-Fatura gönder':'Push e-Invoice to Mikro'}
                                  >
                                    {faturaLoading[order.id]
                                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin"/>
                                      : <FileUp className="w-3.5 h-3.5"/>}
                                    Mikro
                                  </button>
                                )}
                                {order.mikroFaturaNo && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 bg-[#1a3a5c]/10 text-[#1a3a5c] rounded-full flex items-center gap-0.5" title={order.mikroFaturaNo}>
                                    <CheckCircle2 className="w-3 h-3"/>Mikro
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
                  (orderStatusFilter === 'All' || o.status === orderStatusFilter) &&
                  (o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                  o.shopifyOrderId?.toLowerCase().includes(orderSearch.toLowerCase()) ||
                  o.shippingAddress?.toLowerCase().includes(orderSearch.toLowerCase()))
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
                      <div className="text-right">
                        <p className="font-bold text-brand">{order.totalPrice.toLocaleString()} TL</p>
                        {/* Phase 67: invoice mini-badge on mobile */}
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          {order.faturali ? (
                            <span className={`text-[8px] font-bold px-1 py-0.5 rounded-full ${order.faturaTipi === 'ihracat' ? 'bg-blue-100 text-blue-600' : order.faturaTipi === 'e-arsiv' ? 'bg-purple-100 text-purple-600' : 'bg-green-100 text-green-600'}`}>
                              {order.faturaTipi ? order.faturaTipi.toUpperCase() : 'e-FTR'}
                            </span>
                          ) : null}
                          {order.mikroFaturaNo ? (
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded-full bg-[#1a3a5c]/10 text-[#1a3a5c]">✓ MKR</span>
                          ) : null}
                        </div>
                      </div>
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
                    <div className="flex gap-2 flex-wrap">
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
                      {/* Mikro e-Fatura button in order detail */}
                      {!selectedOrder.mikroFaturaNo && selectedOrder.faturali !== false && (
                        <button
                          onClick={() => void handleMikroFatura(selectedOrder)}
                          disabled={!!faturaLoading[selectedOrder.id]}
                          className="bg-[#1a3a5c]/10 hover:bg-[#1a3a5c] text-[#1a3a5c] hover:text-white px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-[#1a3a5c]/20 transition-colors disabled:opacity-40"
                        >
                          {faturaLoading[selectedOrder.id] ? <RefreshCw className="w-4 h-4 animate-spin"/> : <FileUp className="w-4 h-4"/>}
                          {currentLanguage === 'tr' ? 'Mikro\'ya Fatura' : 'Push Invoice'}
                        </button>
                      )}
                      {selectedOrder.mikroFaturaNo && (
                        <span className="bg-[#1a3a5c]/10 text-[#1a3a5c] px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-[#1a3a5c]/20">
                          <CheckCircle2 className="w-4 h-4"/> Mikro: {selectedOrder.mikroFaturaNo}
                        </span>
                      )}
                      {/* iyzico payment link */}
                      {!selectedOrder.iyzicoPaymentUrl ? (
                        <button
                          onClick={() => void handleIyzicoPaymentLink(selectedOrder)}
                          disabled={!!iyzicoLinkLoading[selectedOrder.id]}
                          className="bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-emerald-200 transition-colors disabled:opacity-40"
                        >
                          {iyzicoLinkLoading[selectedOrder.id]
                            ? <RefreshCw className="w-4 h-4 animate-spin"/>
                            : <CreditCard className="w-4 h-4"/>}
                          {currentLanguage === 'tr' ? 'Ödeme Linki' : 'Payment Link'}
                        </button>
                      ) : (
                        <a
                          href={selectedOrder.iyzicoPaymentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-emerald-200"
                          title={selectedOrder.iyzicoPaymentUrl}
                        >
                          <CheckCircle2 className="w-4 h-4"/> iyzico {selectedOrder.iyzicoSandbox ? '(sandbox)' : ''}
                        </a>
                      )}
                      {/* Copy public tracking link */}
                      <button
                        onClick={() => {
                          const url = `${window.location.origin}/?track=${selectedOrder.id}`;
                          navigator.clipboard.writeText(url).then(() =>
                            toast(currentLanguage === 'tr' ? 'Takip linki kopyalandı ✓' : 'Tracking link copied ✓', 'success')
                          ).catch(() => {});
                        }}
                        className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 transition-colors"
                        title={currentLanguage === 'tr' ? 'Müşteri takip linkini kopyala' : 'Copy customer tracking link'}
                      >
                        <Link className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Takip Linki' : 'Track Link'}
                      </button>
                      {/* Phase 57: Copy Order Summary (WhatsApp-ready) */}
                      <button
                        onClick={() => {
                          const o = selectedOrder;
                          const trackUrl = `${window.location.origin}/?track=${o.id}`;
                          const _waRate = kpiCurrency === 'USD' ? (exchangeRates?.USD||1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR||1) : 1;
                          const _waSym  = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                          const _waAmt  = `${_waSym}${(kpiCurrency === 'TRY' ? (o.totalPrice||0) : (o.totalPrice||0) / _waRate).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`;
                          const summary = currentLanguage === 'tr'
                            ? `📦 *Sipariş Özeti*\nSipariş No: #${o.shopifyOrderId || o.id.slice(-6)}\nMüşteri: ${o.customerName}\nDurum: ${o.status}\nTutar: ${_waAmt}\n${o.trackingNumber ? `Kargo Takip: ${o.trackingNumber}\n` : ''}Takip Linki: ${trackUrl}`
                            : `📦 *Order Summary*\nOrder: #${o.shopifyOrderId || o.id.slice(-6)}\nCustomer: ${o.customerName}\nStatus: ${o.status}\nTotal: ${_waAmt}\n${o.trackingNumber ? `Tracking: ${o.trackingNumber}\n` : ''}Link: ${trackUrl}`;
                          navigator.clipboard.writeText(summary).then(() =>
                            toast(currentLanguage === 'tr' ? 'Sipariş özeti kopyalandı ✓' : 'Order summary copied ✓', 'success')
                          ).catch(() => {});
                        }}
                        className="bg-white hover:bg-green-50 text-gray-700 hover:text-green-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 hover:border-green-200 transition-colors"
                        title={currentLanguage === 'tr' ? 'WhatsApp özeti kopyala' : 'Copy summary (WhatsApp-ready)'}
                      >
                        <MessageSquare className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Özet Kopyala' : 'Copy Summary'}
                      </button>
                      {/* Phase 89: Mark Paid / Unpaid toggle in detail header */}
                      <button
                        onClick={() => handleToggleOrderPaid(selectedOrder)}
                        className={`px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border transition-colors ${
                          selectedOrder.paid
                            ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
                        }`}
                        title={selectedOrder.paid ? (currentLanguage === 'tr' ? 'Ödendi — tıkla: ödenmedi yap' : 'Paid — click to mark unpaid') : (currentLanguage === 'tr' ? 'Bekliyor — tıkla: ödendi yap' : 'Pending — click to mark paid')}
                      >
                        <CreditCard className="w-4 h-4" />
                        {selectedOrder.paid
                          ? (currentLanguage === 'tr' ? '✓ Ödendi' : '✓ Paid')
                          : (currentLanguage === 'tr' ? '⏳ Ödenmedi' : '⏳ Unpaid')}
                      </button>
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

              {/* ── Order Status Timeline (Phase 23) ── */}
              <OrderStatusTimeline status={selectedOrder.status} lang={currentLanguage} />

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
                  {/* Phase 40: Order Quick Note */}
                  {(() => {
                    const [noteText, setNoteText] = React.useState(selectedOrder.notes ?? '');
                    const [noteSaving, setNoteSaving] = React.useState(false);
                    const [noteSaved, setNoteSaved] = React.useState(false);
                    const saveNote = async () => {
                      if (noteText === (selectedOrder.notes ?? '')) return;
                      setNoteSaving(true);
                      await updateDoc(doc(db, 'orders', selectedOrder.id), { notes: noteText, updatedAt: serverTimestamp() });
                      setSelectedOrder({ ...selectedOrder, notes: noteText });
                      setNoteSaving(false); setNoteSaved(true);
                      setTimeout(() => setNoteSaved(false), 2000);
                    };
                    return (
                      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-bold">{currentT.notes}</h3>
                          {noteSaved && <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{currentLanguage === 'tr' ? 'Kaydedildi' : 'Saved'}</span>}
                        </div>
                        <textarea
                          value={noteText}
                          onChange={e => { setNoteText(e.target.value); setNoteSaved(false); }}
                          onBlur={() => void saveNote()}
                          rows={4}
                          placeholder={currentT.no_notes_available}
                          className="w-full text-sm text-gray-700 bg-gray-50 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand/20 resize-none leading-relaxed"
                        />
                        {noteSaving && <p className="text-[10px] text-gray-400 mt-1">{currentLanguage === 'tr' ? 'Kaydediliyor…' : 'Saving…'}</p>}
                      </div>
                    );
                  })()}

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

                    {/* ── Phase 74: Gross Profit Summary ── */}
                    {selectedOrder.lineItems && selectedOrder.lineItems.length > 0 && (() => {
                      const hasCost = selectedOrder.lineItems.some(l => (l.costPrice ?? 0) > 0);
                      if (!hasCost) return null;
                      const revenue  = selectedOrder.lineItems.reduce((s, l) => s + l.price * l.quantity, 0);
                      const cost     = selectedOrder.lineItems.reduce((s, l) => s + ((l.costPrice ?? 0) * l.quantity), 0);
                      const gp       = revenue - cost;
                      const gpPct    = revenue > 0 ? Math.round((gp / revenue) * 100) : 0;
                      const gpColor  = gpPct >= 40 ? 'text-emerald-700' : gpPct >= 20 ? 'text-amber-700' : 'text-red-600';
                      const gpBg     = gpPct >= 40 ? 'bg-emerald-50 border-emerald-100' : gpPct >= 20 ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100';
                      const barColor = gpPct >= 40 ? 'bg-emerald-400' : gpPct >= 20 ? 'bg-amber-400' : 'bg-red-400';
                      return (
                        <div className={`rounded-xl border px-4 py-3 ${gpBg} mt-3`}>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                            {currentLanguage === 'tr' ? 'Tahmini Brüt Kâr' : 'Est. Gross Profit'}
                          </p>
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className={`text-xl font-black ${gpColor}`}>
                                ₺{gp.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                              <p className="text-[10px] text-gray-500 mt-0.5">
                                {currentLanguage === 'tr' ? 'Maliyet' : 'COGS'}: ₺{cost.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                            </div>
                            <div className="flex-1 max-w-[120px]">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Marj' : 'Margin'}</span>
                                <span className={`text-sm font-black ${gpColor}`}>{gpPct}%</span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-2">
                                <div className={`${barColor} h-2 rounded-full transition-all duration-700`} style={{ width: `${Math.min(gpPct, 100)}%` }} />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
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
              {/* ── Phase 60: Today's Shipment Summary ── */}
              {(() => {
                const todayStr = new Date().toDateString();
                const shipped   = orders.filter(o => o.status === 'Shipped');
                const delivered = orders.filter(o => o.status === 'Delivered');
                const todayShipped = orders.filter(o => {
                  if (o.status !== 'Shipped') return false;
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return false;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number);
                  return d.toDateString() === todayStr;
                });
                const pending = orders.filter(o => o.status === 'Processing');
                const stats = [
                  { label: currentLanguage === 'tr' ? 'Kargoda' : 'In Transit',      value: shipped.length,     color: 'text-blue-700',    bg: 'bg-blue-50',    icon: Truck        },
                  { label: currentLanguage === 'tr' ? 'Bugün Gönderildi' : 'Shipped Today', value: todayShipped.length, color: 'text-purple-700', bg: 'bg-purple-50', icon: Package     },
                  { label: currentLanguage === 'tr' ? 'Hazırlanıyor' : 'Preparing',   value: pending.length,     color: 'text-amber-700',   bg: 'bg-amber-50',   icon: Clock        },
                  { label: currentLanguage === 'tr' ? 'Teslim Edildi' : 'Delivered',  value: delivered.length,   color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
                ];
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-4 flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                      <Truck className="w-3.5 h-3.5" />
                      {currentLanguage === 'tr' ? 'Sevkiyat Özeti' : 'Shipment Summary'}
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {stats.map((s, i) => {
                        const Icon = s.icon;
                        return (
                          <div key={i} className={cn("rounded-xl p-4 flex flex-col gap-2", darkMode ? "bg-white/5" : s.bg)}>
                            <Icon className={`w-5 h-5 ${s.color}`} />
                            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                            <p className={cn("text-[10px] font-bold", darkMode ? "text-white/50" : "text-gray-500")}>{s.label}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 80: Cargo Company Performance ── */}
              {(() => {
                const cargoMap: Record<string, { total: number; delivered: number; inTransit: number }> = {};
                for (const o of orders) {
                  if (!o.cargoCompany) continue;
                  const k = o.cargoCompany;
                  cargoMap[k] = cargoMap[k] || { total: 0, delivered: 0, inTransit: 0 };
                  cargoMap[k].total += 1;
                  if (o.status === 'Delivered') cargoMap[k].delivered += 1;
                  if (o.status === 'Shipped')   cargoMap[k].inTransit += 1;
                }
                const cargoList = Object.entries(cargoMap)
                  .map(([name, d]) => ({ name, ...d, rate: d.total > 0 ? Math.round((d.delivered / d.total) * 100) : 0 }))
                  .sort((a, b) => b.total - a.total)
                  .slice(0, 5);
                if (cargoList.length === 0) return null;
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-4 flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                      <Truck className="w-3.5 h-3.5" />
                      {currentLanguage === 'tr' ? 'Kargo Firması Performansı' : 'Cargo Company Performance'}
                    </h3>
                    <div className="space-y-3">
                      {cargoList.map(c => (
                        <div key={c.name} className="space-y-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-semibold text-gray-700 truncate flex-1">{c.name}</span>
                            <div className="flex items-center gap-3 flex-shrink-0 text-[10px]">
                              <span className="text-blue-500 font-bold">{c.inTransit} {currentLanguage === 'tr' ? 'yolda' : 'transit'}</span>
                              <span className="text-emerald-600 font-bold">{c.delivered}/{c.total}</span>
                              <span className={`font-black w-10 text-right ${c.rate >= 80 ? 'text-emerald-600' : c.rate >= 50 ? 'text-amber-600' : 'text-red-500'}`}>{c.rate}%</span>
                            </div>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-700 ${c.rate >= 80 ? 'bg-emerald-400' : c.rate >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                              style={{ width: `${c.rate}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-3">
                      {currentLanguage === 'tr' ? 'Teslimat başarı oranı (tamamlanan / toplam)' : 'Delivery success rate (completed / total)'}
                    </p>
                  </div>
                );
              })()}

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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { if (!isScoring) { leadFromOrderRef.current = false; setIsAddingLead(false); } }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white w-full max-w-lg rounded-2xl shadow-2xl relative z-10 overflow-hidden border border-gray-200">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold">{currentT.add_new_sales_lead}</h3>
                  {leadFromOrderRef.current && (
                    <p className="text-[11px] text-brand mt-0.5 font-medium">
                      {currentLanguage === 'tr' ? '↩ Sipariş formuna otomatik eklenecek' : '↩ Will auto-select in order form'}
                    </p>
                  )}
                </div>
                <button onClick={() => { if (!isScoring) { leadFromOrderRef.current = false; setIsAddingLead(false); } }} className="text-gray-400 hover:text-gray-600"><Plus className="w-6 h-6 rotate-45" /></button>
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
                              onMouseDown={() => { setOrderCustomerOpen(false); leadFromOrderRef.current = true; setIsAddingLead(true); }}
                              className="w-full text-left px-4 py-2.5 text-xs font-bold text-brand hover:bg-brand/5 flex items-center gap-2">
                              <Plus className="w-3.5 h-3.5" />
                              {currentLanguage === 'tr' ? 'Yeni müşteri adayı ekle' : 'Add new lead'}
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
      {/* Global search palette (⌘K) */}
      {globalSearchOpen && (
        <GlobalSearch
          orders={orders}
          leads={leads}
          inventory={inventory}
          currentLanguage={currentLanguage}
          onSelectOrder={order => {
            setSelectedOrder(order);
            setActiveTab('orders');
            setGlobalSearchOpen(false);
          }}
          onSelectLead={lead => {
            setSelectedLead(lead);
            setActiveTab('crm');
            setGlobalSearchOpen(false);
          }}
          onSelectProduct={() => {
            setActiveTab('inventory');
            setGlobalSearchOpen(false);
          }}
          onClose={() => setGlobalSearchOpen(false)}
        />
      )}

      {/* Inventory label sheet modal */}
      {labelItems && (
        <LabelSheetModal
          items={labelItems}
          currentLanguage={currentLanguage}
          onClose={() => setLabelItems(null)}
        />
      )}

      <AIChat />

      {/* ── Phase 28: Keyboard Shortcut Cheat-Sheet ── */}
      <AnimatePresence>
        {shortcutModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
            onClick={() => setShortcutModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-md overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h2 className="font-bold text-gray-900">
                  {currentLanguage === 'tr' ? 'Klavye Kısayolları' : 'Keyboard Shortcuts'}
                </h2>
                <button onClick={() => setShortcutModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                {[
                  {
                    section: currentLanguage === 'tr' ? 'Genel' : 'General',
                    shortcuts: [
                      { keys: ['⌘', 'K'], desc: currentLanguage === 'tr' ? 'Global arama' : 'Global search' },
                      { keys: ['?'],       desc: currentLanguage === 'tr' ? 'Bu ekranı göster' : 'Show this screen' },
                      { keys: ['Esc'],     desc: currentLanguage === 'tr' ? 'Kapat / Geri dön' : 'Close / Go back' },
                    ],
                  },
                  {
                    section: currentLanguage === 'tr' ? 'Navigasyon' : 'Navigation',
                    shortcuts: [
                      { keys: ['D'],   desc: currentLanguage === 'tr' ? 'Dashboard' : 'Dashboard' },
                      { keys: ['O'],   desc: currentLanguage === 'tr' ? 'Siparişler' : 'Orders' },
                      { keys: ['C'],   desc: 'CRM' },
                      { keys: ['I'],   desc: currentLanguage === 'tr' ? 'Envanter' : 'Inventory' },
                      { keys: ['R'],   desc: currentLanguage === 'tr' ? 'Raporlar' : 'Reports' },
                    ],
                  },
                  {
                    section: currentLanguage === 'tr' ? 'Oluştur' : 'Create',
                    shortcuts: [
                      { keys: ['N'], desc: currentLanguage === 'tr' ? 'Yeni sipariş / müşteri adayı (aktif sekme)' : 'New order / lead (active tab)' },
                    ],
                  },
                  {
                    section: currentLanguage === 'tr' ? 'Arama & Dışa Aktarma' : 'Search & Export',
                    shortcuts: [
                      { keys: ['⌘', 'E'], desc: currentLanguage === 'tr' ? 'CSV dışa aktar (aktif modül)' : 'Export CSV (active module)' },
                      { keys: ['⌘', 'P'], desc: currentLanguage === 'tr' ? 'PDF oluştur / Yazdır' : 'Generate PDF / Print' },
                    ],
                  },
                ].map(group => (
                  <div key={group.section}>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{group.section}</p>
                    <div className="space-y-1.5">
                      {group.shortcuts.map((sc, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <span className="text-sm text-gray-700">{sc.desc}</span>
                          <div className="flex items-center gap-1">
                            {sc.keys.map((k, ki) => (
                              <React.Fragment key={ki}>
                                <kbd className="text-[10px] font-mono font-bold bg-gray-100 text-gray-700 px-2 py-0.5 rounded-md border border-gray-200 shadow-sm">{k}</kbd>
                                {ki < sc.keys.length - 1 && <span className="text-gray-300 text-xs">+</span>}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 text-center">
                <p className="text-[10px] text-gray-400">
                  {currentLanguage === 'tr' ? 'Kısayolları kapatmak için ' : 'Press '}
                  <kbd className="text-[10px] font-mono bg-white border border-gray-200 px-1 py-0.5 rounded shadow-sm">Esc</kbd>
                  {currentLanguage === 'tr' ? ' tuşuna basın' : ' to close'}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
