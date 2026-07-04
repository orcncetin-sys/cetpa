import DashboardAnalysis from './components/DashboardAnalysis';
import KpiCurrencyToggle from './components/KpiCurrencyToggle';
import AIChat from './components/AIChat';
import ModuleHeader from './components/ModuleHeader';
import AIInlineNudge from './components/AIInlineNudge';
const InventoryViewComponent = React.lazy(() => import('./components/InventoryView'));
const PriceIntelPanel        = React.lazy(() => import('./components/PriceIntelPanel'));
const RaporlarPage            = React.lazy(() => import('./pages/RaporlarPage'));
const SettingsPage            = React.lazy(() => import('./pages/SettingsPage'));
const AdminPage               = React.lazy(() => import('./pages/AdminPage'));
const CRMPage                 = React.lazy(() => import('./pages/CRMPage'));
const OrdersPage              = React.lazy(() => import('./pages/OrdersPage'));
const MuhasebePage            = React.lazy(() => import('./pages/MuhasebePage'));
const SatinAlmaPage           = React.lazy(() => import('./pages/SatinAlmaPage'));
import { logFirestoreError as importedLogFirestoreError, OperationType } from './utils/firebase';
import { MfaSettings, MfaChallengeModal } from './components/MfaSettings';
import { getMfaStatus } from './lib/mfa';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
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
  limit,
  orderBy,
  authedFetch,
  incrementField,
  resetStream
} from './lib/dbClient';
import { sortByCreatedAt } from './utils/fsSort';
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
  TrendingUp,
  BarChart3,
  Scan,
  RefreshCw,
  FileText,
  Calendar,
  Trash2,
  Edit2,
  List,
  Phone,
  Mail,
  Upload,
  Shield,
  Bell,
  Settings,
  ChevronRight,
  Download,
  CreditCard,
  DollarSign,
  Lock,
  History,
  Globe,
  X,
  Menu,
  FileDown,
  Target as TargetIcon,
  UserCheck,
  ShieldCheck,
  Sparkles,
  Scale,
  Activity,
  Building2,
  BookOpen,
  ShoppingBag,
  ShoppingCart,
  Factory,
  Award,
  Moon,
  Sun,
  Check,
  Tag,
  ChevronDown,
  BarChart2,
  Wallet,
  Wrench,
  Headphones,
  Ship,
  GitBranch,
  Receipt,
  Hash,
  TrendingDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, storage } from './firebase';
import { authFetch } from './services/authFetch';
import { syncOrderWithCari } from './services/mikroService';
import { pushMikroEvrak, processMikroRetries, izinTalepPayload } from './services/mikroEvrak';
import { 
  type Shipment, 
  UserRole, 
  type Lead, 
  type Order, 
  type OrderLineItem, 
  type InventoryItem, 
  type Quotation,
  type Employee,
  type Payroll,
  type InventoryMovement,
  type Consignment,
  type StockDiscrepancy,
  type Warehouse,
  type RouteStop,
  type LucaConfig,
  type MikroConfig,
  type Supplier
} from './types';
import { scoreLead } from './services/geminiService';
import { createShopifyDraftOrder } from './services/shopifyService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart as RePieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { format, subDays, startOfDay, endOfDay, isWithinInterval } from 'date-fns';
// ── Lazy auth/marketing pages (not needed on initial render) ─────────────────
const LandingPage = React.lazy(() => import('./components/LandingPage'));
const OnboardingFlow = React.lazy(() => import('./components/OnboardingFlow'));
const PricingPage = React.lazy(() => import('./components/PricingPage'));
import ConfirmModal from './components/ConfirmModal';
import GlobalConfirm from './components/GlobalConfirm';
import { confirmDelete } from './lib/confirm';
import OnboardingChecklist from './components/OnboardingChecklist';
import DataImportWizard from './components/DataImportWizard';
import GlobalSearch from './components/GlobalSearch';
import BarcodeScanner from './components/BarcodeScanner';
import DateRangePicker from './components/DateRangePicker';
import LabelSheetModal, { type LabelItem } from './components/LabelSheetModal';
import { ToastProvider, useToast } from './components/Toast';
import EmailComposeModal from './components/EmailComposeModal';
import ShortcutModal from './components/ShortcutModal';
import ReturnModal from './components/ReturnModal';
import CustomerStatementModal from './components/CustomerStatementModal';
import DeliveryNoteModal from './components/DeliveryNoteModal';
import StockCountModal from './components/StockCountModal';
import QuickShipmentModal from './components/QuickShipmentModal';
import OverduePanel from './components/OverduePanel';
import PaymentMethodModal from './components/PaymentMethodModal';
import { translations, type Language } from './translations';
import { optimizeRoute } from './utils/logistics';
import { useDataStore } from './store/dataStore';

// ── Lazy imports (loaded on first tab visit — keeps initial bundle ~40% lighter) ─
const B2BPortalComponent = React.lazy(() => import('./components/B2BPortal'));
// static: already bundled via InventoryView
const AccountingModule        = React.lazy(() => import('./components/AccountingModule'));
const PurchasingModule        = React.lazy(() => import('./components/PurchasingModule'));
const HRModule                = React.lazy(() => import('./components/HRModule'));
const LegalModule             = React.lazy(() => import('./components/LegalModule'));
const ProductionModule        = React.lazy(() => import('./components/ProductionModule'));
const QualityModule           = React.lazy(() => import('./components/QualityModule'));
const ProjectModule           = React.lazy(() => import('./components/ProjectModule'));
const CorporateGovernanceModule = React.lazy(() => import('./components/CorporateGovernanceModule'));
const FinancePanel            = React.lazy(() => import('./components/FinancePanel'));
const RiskPanel               = React.lazy(() => import('./components/RiskPanel'));
const AnalyticsPanel          = React.lazy(() => import('./components/AnalyticsPanel'));
const CariEkstrePanel         = React.lazy(() => import('./components/CariEkstrePanel'));
const BOMPanel                = React.lazy(() => import('./components/BOMPanel'));
const OrderTrackingView       = React.lazy(() => import('./components/OrderTrackingView'));
const EBelgeMerkezi           = React.lazy(() => import('./components/EBelgeMerkezi'));
const BakimModule             = React.lazy(() => import('./components/BakimModule'));
const ServisModule            = React.lazy(() => import('./components/ServisModule'));
const IhracatModule           = React.lazy(() => import('./components/IhracatModule'));
const SubeModule              = React.lazy(() => import('./components/SubeModule'));
const VergiTakvimi            = React.lazy(() => import('./components/VergiTakvimi'));
const LotSeriModule           = React.lazy(() => import('./components/LotSeriModule'));
const TerritoryModule         = React.lazy(() => import('./components/TerritoryModule'));
const PerformansModule        = React.lazy(() => import('./components/PerformansModule'));
const CPQPanel                = React.lazy(() => import('./components/CPQPanel'));
const DunningModule           = React.lazy(() => import('./components/DunningModule'));
const MRPModule               = React.lazy(() => import('./components/MRPModule'));
const HoldingModule           = React.lazy(() => import('./components/HoldingModule'));
const MuhtasarModule          = React.lazy(() => import('./components/MuhtasarModule'));
const MobileWMSModule         = React.lazy(() => import('./components/MobileWMSModule'));
const GelirTanimaModule       = React.lazy(() => import('./components/GelirTanimaModule'));
const SabitKiymetModule       = React.lazy(() => import('./components/SabitKiymetModule'));
const MaliyetMerkeziModule    = React.lazy(() => import('./components/MaliyetMerkeziModule'));
const KasaModule              = React.lazy(() => import('./components/KasaModule'));
const TahsilatModule          = React.lazy(() => import('./components/TahsilatModule'));
import NewLeadModal, { type NewLeadData } from './components/NewLeadModal';
import AddOrderModal from './components/AddOrderModal';
import AddShipmentModal from './components/AddShipmentModal';
import EditLeadModal from './components/EditLeadModal';
import EditOrderModal from './components/EditOrderModal';
import ApprovalQueue, { usePendingApprovalCount } from './components/ApprovalQueue';
import {
  type UserSubscription,
  type SubscriptionPlan,
  type BillingCycle,
  canAccessModule,
  createTrialSubscription,
} from './types/subscription';
import { useAppStore } from './store/appStore';
import { useRouteSync } from './hooks/useRouteSync';

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
  finance:       { full: [UserRole.Admin, UserRole.Accounting, UserRole.Manager], readonly: [UserRole.Sales, UserRole.Logistics, UserRole.Purchasing] },
  analytics:     { full: [UserRole.Admin, UserRole.Manager, UserRole.Accounting, UserRole.Sales], readonly: [UserRole.Logistics, UserRole.HR, UserRole.Purchasing] },
  // New ERP modules
  ebelge:        { full: [UserRole.Admin, UserRole.Accounting, UserRole.Manager], readonly: [UserRole.Sales, UserRole.Logistics] },
  bakim:         { full: [UserRole.Admin, UserRole.Manager, UserRole.Logistics], readonly: [UserRole.Purchasing] },
  servis:        { full: [UserRole.Admin, UserRole.Manager, UserRole.Sales], readonly: [UserRole.Logistics] },
  ihracat:       { full: [UserRole.Admin, UserRole.Manager, UserRole.Logistics, UserRole.Purchasing], readonly: [UserRole.Accounting] },
  sube:          { full: [UserRole.Admin, UserRole.Manager], readonly: [UserRole.Accounting, UserRole.Sales] },
  vergi:         { full: [UserRole.Admin, UserRole.Accounting], readonly: [UserRole.Manager] },
  lotseri:       { full: [UserRole.Admin, UserRole.Manager, UserRole.Logistics], readonly: [UserRole.Purchasing, UserRole.Sales] },
};

// B2BPortal + SortHeader extracted to separate files
const B2BPortal = B2BPortalComponent;

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

// ── TabErrorBoundary: per-module crash isolation (Red-team Fix 1) ────────────
class TabErrorBoundary extends React.Component<
  { children: React.ReactNode; tabName: string; lang?: string },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { children: React.ReactNode; tabName: string; lang?: string }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }
  static getDerivedStateFromError(error: Error) { return { hasError: true, errorMsg: error.message }; }
  componentDidCatch(error: Error) {
    console.error(`[TabErrorBoundary:${this.props.tabName}]`, error);
    // Stale chunk / deploy cache hatası → sayfayı bir kez otomatik yenile (döngü koruması).
    const msg = error?.message || '';
    const isChunkError = /dynamically imported module|Loading chunk|Importing a module script failed|Failed to fetch/i.test(msg);
    if (isChunkError) {
      const key = 'cetpa_chunk_reload';
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        // SW cache'ini temizleyip tam yeniden yükle
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
          if (window.caches) caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});
        }
        setTimeout(() => window.location.reload(), 300);
      }
    }
  }
  render() {
    if (this.state.hasError) {
      const isTR = this.props.lang !== 'en';
      const msg = this.state.errorMsg || '';
      const isChunkError = /dynamically imported module|Loading chunk|Importing a module script failed|Failed to fetch/i.test(msg);
      return (
        <div className="apple-card p-10 flex flex-col items-center justify-center text-center gap-4 min-h-[280px]">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
            <AlertCircle className="w-7 h-7 text-red-400" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 text-base mb-1">
              {isTR ? `${this.props.tabName} modülünde bir hata oluştu` : `Error in ${this.props.tabName} module`}
            </h3>
            <p className="text-sm text-gray-500 max-w-xs mx-auto">
              {isChunkError
                ? (isTR ? 'Yeni sürüm yüklendi. Sayfayı yenileyin (önbellek temizlenecek).' : 'A new version was deployed. Reload the page (cache will be cleared).')
                : (isTR ? 'Diğer modüller etkilenmedi. Yeniden yüklemek için butona tıklayın.' : 'Other modules are unaffected. Click below to reload.')}
            </p>
          </div>
          <button
            onClick={() => {
              if (isChunkError) { sessionStorage.removeItem('cetpa_chunk_reload'); window.location.reload(); }
              else this.setState({ hasError: false, errorMsg: '' });
            }}
            className="apple-button-secondary px-6 py-2 text-sm font-semibold"
          >
            {isChunkError ? (isTR ? '↺ Sayfayı Yenile' : '↺ Reload Page') : (isTR ? '↺ Modülü Yenile' : '↺ Reload Module')}
          </button>
          {msg && <p className="text-[10px] text-gray-400 font-mono max-w-md break-all bg-gray-50 rounded-lg px-3 py-2">{msg}</p>}
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Multi-currency helpers ──────────────────────────────────────────────────
/**
 * Returns the cost of an inventory item expressed in TRY.
 * Items now store their native currency in costCurrency (USD/EUR/TRY).
 * Backward-compatible: items without costCurrency are assumed TRY.
 */
function itemCostTRY(item: InventoryItem, rates: Record<string, number> | null | undefined): number {
  const raw = item.costPrice ?? (item.cost as number | undefined) ?? 0;
  const cur = item.costCurrency;
  if (!cur || cur === 'TRY' || !rates) return raw;
  return raw * (rates[cur] ?? 1);
}

/**
 * Returns a specific price tier of an item expressed in TRY.
 * Items may store prices in USD/EUR (priceCurrency). Falls back to TRY if unset.
 */
// haversineDistance and optimizeRoute are imported from ./utils/logistics

const InventoryView = InventoryViewComponent;
// --- Unauthorized Access View ---
import UnauthorizedView from './components/UnauthorizedView';
import ReadOnlyBanner from './components/ReadOnlyBanner';


// ── Back to Top — sol altta, sayfa kaydırılınca görünür ───────────────────────
const BackToTopButton: React.FC = () => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Başa dön"
      className="fixed bottom-6 left-6 z-[200] w-11 h-11 rounded-full bg-white/90 backdrop-blur border border-gray-200 shadow-lg flex items-center justify-center text-gray-600 hover:text-brand hover:border-brand/30 hover:shadow-xl transition-all"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  );
};


// Kur Değerleme sayısal girişi — modül seviyesinde (render içinde tanımlanırsa
// her tuşta yeniden mount olur ve focus kaybolur).
const FxInput = ({ value, onChange, w = 'w-28' }: { value: number; onChange: (v: number) => void; w?: string }) => (
  <input type="number" step="0.01" value={value || ''} onChange={e => onChange(Number(e.target.value) || 0)}
    placeholder="0" className={`${w} px-2 py-1 text-xs text-right bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-brand tabular-nums`} />
);

// Tek kaynak: canlı kur yokken kullanılan yedek oranlar (soğuk başlangıç).
// Önceden modüller arası tutarsızdı (32/35 vs 38/41). KPI'larda `|| 1` ham TRY'yi
// $/€ diye gösteriyordu → `?? FX_FALLBACK` ile gerçek oran kullanılır.
const FX_FALLBACK = { USD: 38, EUR: 41 } as const;

// Modül seviyesinde (render-içi tanım yerine) — her render'da yeni identity/remount engeli.
function DeltaBadge({ delta }: { delta: number | null | undefined }) {
  if (delta == null || isNaN(delta)) return null;
  const up = delta >= 0;
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${up ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
      {up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

// KpiCurrencyToggle src/components/KpiCurrencyToggle.tsx'e tasindi (sayfa
// ayrimlarinda paylasiliyor).

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppContent />
        <GlobalConfirm />
      </ToastProvider>
    </ErrorBoundary>
  );
}

function AppContent() {
  const [currentLanguage, setCurrentLanguage] = useState<Language>('tr');
  const [darkMode, setDarkMode] = useState(false); // synced from userPrefs/{uid} on login
  const darkModeFromServerRef = React.useRef(false); // listener'dan gelen değeri işaretler (echo-write engeli)

  // ── Zustand store sync ────────────────────────────────────────────────────
  const { setExchangeRates: storeSetRates,
          setUser: storeSetUser, setUserRole: storeSetRole, setCompanyId: storeSetCompanyId,
          companyId: storeCompanyId } = useAppStore();

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

  // Phase 514: live clock
  useEffect(() => {
    const t = setInterval(() => setDashClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);  

  React.useEffect(() => {
    const html = document.documentElement;
    if (darkMode) { html.classList.add('dark'); } else { html.classList.remove('dark'); }
    // Listener'dan gelen değer için Firestore'a echo-yazma yapma (yarış/loop engeli).
    if (darkModeFromServerRef.current) { darkModeFromServerRef.current = false; return; }
    const uid = auth.currentUser?.uid;
    if (uid) setDoc(doc(db, 'userPrefs', uid), { darkMode }, { merge: true }).catch(() => {});
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
  const [signupForm, setSignupForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [isEmailLoginLoading, setIsEmailLoginLoading] = useState(false);
  const [authMode, setAuthMode] = useState<'signin'|'signup'|'reset'>('signin');
  const [resetSent, setResetSent] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // 2FA: kullanıcının 2FA'sı açık ama bu oturum doğrulanmamışsa challenge sürülür.
  const [mfaChallenge, setMfaChallenge] = useState(false);
  const [showMfaSettings, setShowMfaSettings] = useState(false);
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
  const [activeTab, setActiveTab] = useState(() => {
    // Prefer URL path (React Router), fall back to legacy hash
    const path = window.location.pathname.replace(/^\//, '').split('/')[0];
    const hash = window.location.hash.replace('#', '');
    return path || hash || 'dashboard';
  });
  // URL ↔ activeTab bidirectional sync (React Router)
  useRouteSync({ activeTab, setActiveTab });

  const [lojistikTab, setLojistikTab] = useState('sevkiyat');
  const [crmTab, setCrmTab] = useState('leads');
  const [adminTab, setAdminTab] = useState<'overview'|'users'|'access'|'auditlog'|'system'|'company'|'evrak'|'tenants'>('overview');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [muhasebeTab, setMuhasebeTab] = useState<'genel'|'sabit-kiymet'|'maliyet'|'tahsilat'|'ap'|'butce'|'nakit-akis'|'banka'|'ar-aging'|'finansal-oranlar'|'pnl'|'kasa'|'bilanco'|'mutabakat'|'masraf'|'babs'|'kdv'|'cari'|'fatura-takip'|'fiyat-kural'|'butce-gercek'|'oto-fatura'|'gelir-tanima'|'kdv-mutabakat'|'gelir-gider-butce'|'varyans-analiz'|'kur-degerleme'|'tekrar-fatura'|'sirket-arasi'>('genel');
  // Lifted from ReportsDashboard so sidebar can control it
  const [appReportsTab, setAppReportsTab] = useState<'genel'|'crm'|'envanter'|'lojistik'|'ik'|'urunler'>('genel');

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
  const fetchSystemHealth = useCallback(async () => {
    try {
      const hr = await fetch('/api/health');
      if (hr.ok) setHealthData(await hr.json() as typeof healthData);
    } catch { /* ignore — offline */ }
  }, []);

  useEffect(() => {
    if (adminTab === 'system') void fetchSystemHealth();
  }, [adminTab, fetchSystemHealth]);

  // Süper-admin (SaaS operatörü) mü? — kiracı yönetimi sekmesinin görünürlüğü için
  useEffect(() => {
    if (!user) { setIsSuperAdmin(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/superadmin/me');
        if (res.ok && !cancelled) { const d = await res.json() as { isSuperAdmin?: boolean }; setIsSuperAdmin(!!d.isSuperAdmin); }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [user]);
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

  // Firma logosu özelleştirmesi — settings/app.logoUrl'den yüklenir, header'da gösterilir

  const [isUploadingLogo, setIsUploadingLogo] = useState(false);


  // Notification preferences — must be top-level (not inside conditional IIFE) to respect Rules of Hooks

  const toggleNotifPref = (key: string) => {
    setNotifPrefs(prev => {
      const next = { ...prev, [key]: !prev[key] };
      const uid = auth.currentUser?.uid;
      if (uid) setDoc(doc(db, 'userPrefs', uid), { notifPrefs: next }, { merge: true }).catch(() => {});
      return next;
    });
  };
  const {
    leads, setLeads,
    orders, setOrders,
    shipments, setShipments,
    inventory, setInventory,
    appQuotations, setAppQuotations,
    warehouses, setWarehouses,
    vehicles, setVehicles,
    locationStocks,
    inventoryMovements, setInventoryMovements,
    consignments, setConsignments,
    stockDiscrepancies, setStockDiscrepancies,
    employees, setEmployees,
    payrolls, setPayrolls,
    commissionRules, setCommissionRules,
    suppliers, setSuppliers,
    userSubscription, setUserSubscription,
    paymentHistory, setPaymentHistory,
    notifications, setNotifications,
    fxPos, setFxPos,
    companySettings, setCompanySettings,
    logoUrl, setLogoUrl,
    geminiApiKeySetting, setGeminiApiKeySetting,
    mikroSettings, setMikroSettings,
    lucaSettings, setLucaSettings,
    gibConnected, setGibConnected,
    exchangeRates, setExchangeRates,
    branchNames, setBranchNames,
    notifPrefs, setNotifPrefs
  } = useDataStore();

  const [dateRange, setDateRange] = useState({
    startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd')
  });

  // eBA approval queue pending count (badge on nav tab)
  const pendingApprovalsCount = usePendingApprovalCount(userRole, user?.email);

  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [kpiCurrency, setKpiCurrency] = useState<'TRY'|'USD'|'EUR'>('TRY');
  const fmtKpi = (v: number, fmt: 'full' | 'K' = 'full', decimals = 0): string => {
    const usd = exchangeRates?.USD ?? FX_FALLBACK.USD;
    const eur = exchangeRates?.EUR ?? FX_FALLBACK.EUR;
    const rate = kpiCurrency === 'USD' ? usd : kpiCurrency === 'EUR' ? eur : 1;
    const sym = kpiCurrency === 'USD' ? '$' : kpiCurrency === 'EUR' ? '€' : '₺';
    const locale = kpiCurrency === 'USD' ? 'en-US' : kpiCurrency === 'EUR' ? 'de-DE' : 'tr-TR';
    const cv = v / rate;
    if (fmt === 'K') return `${sym}${(cv/1000).toFixed(decimals)}K`;
    return `${sym}${cv.toLocaleString(locale, {maximumFractionDigits: decimals})}`;
  };

  // ── Commission Rules (for lead detail commission summary) ─────────────────
  interface CommissionRuleApp { id: string; tier: string; targetAmount: number; commissionRate: number; bonusRate: number; period: 'monthly' | 'quarterly'; }

  useEffect(() => {
    if (!user || activeTab !== 'crm') return; // yalnızca CRM lead detayında kullanılır
    const unsub = onSnapshot(collection(db, 'commissionRules'), snap => {
      setCommissionRules(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as CommissionRuleApp))));
    });
    return () => unsub();
   
  }, [user, activeTab]);

  // ── Phase 29: Supplier Directory ──────────────────────────────────────────

  const [purchasingSubTab, setPurchasingSubTab] = useState<'pos' | 'suppliers' | 'scorecard' | 'odeme-takvimi' | 'tedarikci-portal' | 'satin-butce' | 'tedarik-risk'>('pos');
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [newSupplier, setNewSupplier] = useState<Partial<Supplier>>({});

  useEffect(() => {
    if (!user || !['satin-alma', 'muhasebe', 'lojistik'].includes(activeTab)) return;
    const unsub = onSnapshot(collection(db, 'suppliers'), snap => {
      setSuppliers(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as Supplier))));
    }, err => console.error('suppliers:', err));
    return () => unsub();
   
  }, [user, activeTab]);

  const [vknLookupLoading, setVknLookupLoading] = useState(false);
  const [vknLookupMsg, setVknLookupMsg] = useState<{text: string; ok: boolean} | null>(null);

  const handleVknLookup = async () => {
    const vkn = (newSupplier.taxNo || '').trim();
    if (vkn.length < 10) {
      setVknLookupMsg({ text: currentLanguage === 'tr' ? 'VKN/TCKN 10 haneli olmalı.' : 'VKN/TCKN must be 10 digits.', ok: false });
      return;
    }
    setVknLookupLoading(true);
    setVknLookupMsg(null);
    try {
      const res = await authFetch(`/api/gib/vkn/${vkn}`);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        setNewSupplier(prev => ({
          ...prev,
          name: prev.name || d.unvan || '',
          company: d.unvan || prev.company || '',
          taxNo: d.vknTckn || vkn,
          taxOffice: d.vergiDairesi || prev.taxOffice || '',
          address: d.il ? (prev.address || d.il) : (prev.address || ''),
        }));
        setVknLookupMsg({ text: currentLanguage === 'tr' ? `✓ ${d.unvan} bulundu.` : `✓ Found: ${d.unvan}`, ok: true });
      } else if (json.notConfigured) {
        setVknLookupMsg({ text: currentLanguage === 'tr' ? 'GİB API anahtarı yapılandırılmamış. Lütfen sunucu ayarlarını kontrol edin.' : 'GİB API key not configured. Check server settings.', ok: false });
      } else {
        setVknLookupMsg({ text: json.error || (currentLanguage === 'tr' ? 'Kayıt bulunamadı.' : 'Record not found.'), ok: false });
      }
    } catch {
      setVknLookupMsg({ text: currentLanguage === 'tr' ? 'Sorgu başarısız. Sunucu çalışıyor mu?' : 'Query failed. Is the server running?', ok: false });
    } finally {
      setVknLookupLoading(false);
    }
  };

  const handleSaveSupplier = async () => {
    if (!newSupplier.name?.trim()) return;
    try {
      if (editingSupplier) {
        await updateDoc(doc(db, 'suppliers', editingSupplier.id), { ...newSupplier });
      } else {
        await addDoc(collection(db, 'suppliers'), { ...newSupplier, createdAt: serverTimestamp() });
      }
      setAddingSupplier(false); setEditingSupplier(null); setNewSupplier({}); setVknLookupMsg(null);
      toast(currentLanguage === 'tr' ? 'Tedarikçi kaydedildi ✓' : 'Supplier saved ✓', 'success');
    } catch (e) { console.error('[handleSaveSupplier]', e); toast(currentLanguage === 'tr' ? 'Tedarikçi kaydedilemedi.' : 'Failed to save supplier.', 'error'); }
  };

  const handleDeleteSupplier = async (id: string) => {
    const s = suppliers.find(x => x.id === id);
    if (!await confirmDelete(s?.name, currentLanguage === 'tr' ? 'tr' : 'en')) return;
    await deleteDoc(doc(db, 'suppliers', id));
  };

  // ── Phase 38: Recently Viewed trail ───────────────────────────────────────
  const [recentlyViewed, setRecentlyViewed] = useState<{ type: 'order' | 'lead' | 'product'; id: string; label: string; tab: string }[]>([]);
  const trackView = useCallback((item: { type: 'order' | 'lead' | 'product'; id: string; label: string; tab: string }) => {
    setRecentlyViewed(prev => {
      const next = [item, ...prev.filter(r => r.id !== item.id)].slice(0, 5);
      const uid = auth.currentUser?.uid;
      if (uid) setDoc(doc(db, 'userPrefs', uid), { recentlyViewed: next }, { merge: true }).catch(() => {});
      return next;
    });
  }, []);

  // ── Phase 27: Dashboard Quick Note ────────────────────────────────────────
  const [quickNote, setQuickNote] = useState<string>('');
  const quickNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleQuickNoteChange = (val: string) => {
    setQuickNote(val);
    if (quickNoteTimer.current) clearTimeout(quickNoteTimer.current);
    quickNoteTimer.current = setTimeout(() => {
      const uid = auth.currentUser?.uid;
      if (uid) setDoc(doc(db, 'userPrefs', uid), { quickNote: val }, { merge: true }).catch(() => {});
    }, 600);
  };

  // ─── Subscription State ─────────────────────────────────────────────────

  const [showLoginPage, setShowLoginPage] = useState(false);
  const [showDemoForm, setShowDemoForm] = useState(false);
  const [demoForm, setDemoForm] = useState({ name: '', company: '', email: '', phone: '', message: '' });
  const [demoSubmitting, setDemoSubmitting] = useState(false);
  const [demoSubmitted, setDemoSubmitted] = useState(false);
  const [enteredApp, setEnteredApp] = useState(false);
  const [showPricingPage, setShowPricingPage] = useState(false);
  const [subscriptionLoaded, setSubscriptionLoaded] = useState(false);


  // Admin emails that bypass subscription gating entirely
  const ADMIN_EMAILS = ['orcncetin@gmail.com'];
  const isOwnerAdmin = !!(user?.email && ADMIN_EMAILS.includes(user.email));

  // Load subscription from Firestore
  useEffect(() => {
    if (!user) { setUserSubscription(null); setSubscriptionLoaded(false); setPaymentHistory([]); return; }

    // Owner/admin accounts get a permanent enterprise subscription — no Firestore doc needed
    if (ADMIN_EMAILS.includes(user.email ?? '')) {
      setUserSubscription({
        plan: 'enterprise',
        status: 'active',
        cycle: 'annual',
        startDate: '2024-01-01',
        endDate: '2099-12-31',
        currentPeriodEnd: '2099-12-31',
        maxUsers: 9999,
        currentUsers: 1,
      } as unknown as UserSubscription);
      setSubscriptionLoaded(true);
      return;
    }

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
      query(collection(db, 'payments'), where('userId', '==', user.uid), limit(24)),
      (snap) => {
        setPaymentHistory(sortByCreatedAt(snap.docs.map(d => {
          const data = d.data();
          return { id: d.id, ...data, status: (['paid','pending','failed'].includes(data.status) ? data.status : 'paid') } as { id: string; date: string; amount: number; plan: string; planName?: Record<string, string>; cycle: string; status: 'paid' | 'pending' | 'failed' };
        })));
      },
      () => { /* payments collection may not exist yet */ }
    );

    return () => { unsub(); unsubPayments(); };
  }, [user]);

  // ── Mikro retry kuyruğu: başarısız push'lar geçici hatada kuyruğa girer;
  //    burada açılışta + 90 sn'de bir bekleyenler yeniden denenir (exponential backoff) ──
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const tick = () => { if (!cancelled) void processMikroRetries().catch(() => {}); };
    tick(); // açılışta bir kez
    const timer = setInterval(tick, 90_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [user]);

  // Check if module is accessible by subscription
  const canAccessBySubscription = (tabId: string): boolean => {
    if (isGuestMode) return true;   // Guest mode: no gating
    if (isOwnerAdmin) return true;  // Owner/admin: full access always
    if (!userSubscription) return false;
    if (tabId === 'settings' || tabId === 'admin') return true; // Always allow settings/admin
    return canAccessModule(userSubscription, tabId);
  };

  // Handle tab clicks with subscription gating
  const handleTabClick = (tabId: string) => {
    if (!canAccessBySubscription(tabId) && userSubscription) {
      // Go directly to pricing page when a locked (PRO) module is clicked
      setShowPricingPage(true);
      return;
    }
    setActiveTab(tabId);
    setIsMobileMenuOpen(false);
  };

  // Subscription handlers
  const handleSelectPlan = async (planId: SubscriptionPlan, cycle: BillingCycle) => {
    if (!user) return;
    // Enterprise uses custom pricing — redirect to contact form
    if (planId === 'enterprise') {
      window.open('mailto:sales@cetpa.com.tr?subject=Enterprise Plan', '_blank');
      return;
    }
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planId, cycle }),
      });
      if (!res.ok) throw new Error(`Checkout error ${res.status}`);
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;   // redirect to Stripe Checkout
      } else {
        throw new Error(data.error ?? 'No checkout URL returned');
      }
    } catch (e) {
      console.error('[handleSelectPlan]', e);
      toast(currentLanguage === 'tr' ? 'Ödeme sayfası açılamadı.' : 'Could not open checkout page.', 'error');
    }
  };

  const handleStartTrial = async (planId: SubscriptionPlan) => {
    if (!user) return;
    const sub = createTrialSubscription(planId);
    try {
      await setDoc(doc(db, 'subscriptions', user.uid), sub);
      setShowPricingPage(false);
    } catch (e) {
      console.error('[handleStartTrial]', e);
      toast(currentLanguage === 'tr' ? 'Deneme başlatılamadı.' : 'Could not start trial.', 'error');
    }
  };

  const handleOnboardingComplete = async (subscription: UserSubscription, companyInfo: { name: string; sector: string; size: string }) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'subscriptions', user.uid), subscription);
      await setDoc(doc(db, 'companies', user.uid), { ...companyInfo, createdAt: serverTimestamp() }, { merge: true });
    } catch (e) {
      console.error('[handleOnboardingComplete]', e);
      toast(currentLanguage === 'tr' ? 'Kurulum kaydedilemedi.' : 'Could not save onboarding data.', 'error');
    }
  };

  const handleCancelSubscription = async () => {
    if (!user || !userSubscription) return;
    try {
      await setDoc(doc(db, 'subscriptions', user.uid), {
        ...userSubscription,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
      });
      toast(currentLanguage === 'tr' ? 'Abonelik iptal edildi.' : 'Subscription cancelled.', 'success');
    } catch (e) {
      console.error('[handleCancelSubscription]', e);
      toast(currentLanguage === 'tr' ? 'İptal işlemi başarısız.' : 'Could not cancel subscription.', 'error');
    }
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
  }, [activeTab]);  

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

  // Keep URL hash in sync with active tab
  useEffect(() => {
    window.location.hash = activeTab;
  }, [activeTab]);

  // Redirect to dashboard if userRole changes and current tab is no longer accessible
  useEffect(() => {
    if (!canAccess(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [userRole]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Try local Express server first (dev), then fall back to Frankfurter public API
    const setRatesFromFrankfurter = () =>
      fetch('https://api.frankfurter.app/latest?from=USD&to=TRY,EUR')
        .then(r => r.json())
        .then(data => {
          const tryPerUsd: number = data.rates?.TRY ?? FX_FALLBACK.USD;
          const eurPerUsd: number = data.rates?.EUR ?? 0.92;
          const tryPerEur = tryPerUsd / eurPerUsd;
          setExchangeRates({ USD: tryPerUsd, EUR: tryPerEur });
          storeSetRates({ USD: tryPerUsd, EUR: tryPerEur });
        })
        .catch(err => console.error('Frankfurter API failed:', err));

    fetch('/api/settings/exchange-rates')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (data?.rates?.USD) { setExchangeRates(data.rates); storeSetRates(data.rates); }
        else setRatesFromFrankfurter();
      })
      .catch(() => setRatesFromFrankfurter());
  }, []);

  useEffect(() => {
    if (!user || !userRole) return;
    const unsubNotifications = onSnapshot(query(collection(db, 'notifications'), where('userId', '==', user.uid), limit(10)), (snap) => {
      setNotifications(sortByCreatedAt(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'notifications', auth.currentUser?.uid));
    return () => unsubNotifications();
  }, [user, userRole]);

  useEffect(() => {
    if (!user || userRole !== 'Admin') return;
    getDocs(query(collection(db, 'users'), limit(50)))
      .then(snap => setFirestoreUsers(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() })))))
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

    // İstek fırtınası koruması: inventory/orders her SSE güncellemesinde yeni
    // referans üretir ve bu effect'i tetikler; throttle olmadan her tetikte
    // notifications'a 2-3 GET atılıp tarayıcı havuzu tükeniyordu
    // (ERR_INSUFFICIENT_RESOURCES). Otomatik bildirimler saatte bir koşar.
    const lastRun = Number(sessionStorage.getItem('autoNotifyLastRun') || 0);
    if (now - lastRun < 60 * 60 * 1000) return;
    sessionStorage.setItem('autoNotifyLastRun', String(now));

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
        companyId: storeCompanyId ?? user.uid,
        userName: user?.displayName || user?.email || 'Misafir',
        userEmail: user?.email || '',
        timestamp: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'auditLog');
    }
  }, [user, storeCompanyId]);

  // ── Add/Edit Lead ──────────────────────────────────────────────────────────
  const [isAddingLead, setIsAddingLead] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState<string|null>(null);

  // ── Add Order ──────────────────────────────────────────────────────────────
  const [isScoring, setIsScoring] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Lead quick-note — saved to leads/{id}.quickNote in Firestore
  const [labelItems,         setLabelItems]         = useState<LabelItem[] | null>(null);
  // Public order tracking — read from URL on mount
  const trackOrderId = new URLSearchParams(window.location.search).get('track') ?? null;
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [isAddingOrder, setIsAddingOrder] = useState(false);
  const [isAddingShipment, setIsAddingShipment] = useState(false);
  const [editingShipmentId, setEditingShipmentId] = useState<string | null>(null);
  const [shipmentInitialData, setShipmentInitialData] = useState<Partial<Shipment>>({ status: 'Pending' });
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
  const [isEditingLead, setIsEditingLead] = useState(false);

  // --- Filters ---
  // ── Phase 501-515 ────────────────────────────────────────────────────────────
  const [showStmtModal, setShowStmtModal] = useState<string|null>(null); // Phase 502 — customerId
  const [deliveryNoteOrder, setDeliveryNoteOrder] = useState<Order|null>(null); // Phase 506
  const [deliveryNoteText, setDeliveryNoteText] = useState(''); // Phase 506
  // ── Phase 504-520 ────────────────────────────────────────────────────────────
  const [showStockCount, setShowStockCount] = useState(false); // Phase 507
  const [stockCountDraft, setStockCountDraft] = useState<Record<string, number>>({}); // Phase 507
  const [stockCountSaving, setStockCountSaving] = useState(false); // Phase 507
  const [stockCountSearch, setStockCountSearch] = useState(''); // Phase 507
  const [dashClock, setDashClock] = useState(new Date()); // Phase 514
  const [showQuickShipment, setShowQuickShipment] = useState<Order|null>(null); // Phase 512
  // ── Phase 515-534 ────────────────────────────────────────────────────────────
  const [p528Dismissed, setP528Dismissed] = useState<Set<string>>(new Set()); // Phase 528 — smart alerts
  const [p532PayOrder, setP532PayOrder] = useState<Order|null>(null); // Phase 532 — payment method picker
  const [p532Method, setP532Method] = useState<Order['paymentMethod']>('bank_transfer'); // Phase 532
  const [showOverduePanel, setShowOverduePanel] = useState(false); // Phase 538 — overdue payments panel
  const [shipmentsExpanded, setShipmentsExpanded] = useState(false); // Phase 539 — shipments KPI
  // ── Phase 543–545 ────────────────────────────────────────────────────────────
  const [dashVergiDeadlines, setDashVergiDeadlines] = useState<{ id: string; vergiTuru: string; sonTarih: string; durum: string }[]>([]); // Phase 543
  // ── Phase 547: Bilanço — bank accounts fetched on demand ──────────────────
  const [p547BankAccounts, setP547BankAccounts] = useState<Array<{ id: string; bankName: string; accountType: string; balance: number; currency: string }>>([]);
  const [p547FixedAssets, setP547FixedAssets]   = useState<Array<{ id: string; name: string; cost: number; depreciation: number }>>([]);
  // ── Phase 548: Masraf Yönetimi — expense claims ────────────────────────────
  const [p548Masraflar, setP548Masraflar] = useState<Array<{
    id: string; employeeName: string; category: string; amount: number; currency: string;
    date: string; description: string; receiptUrl?: string;
    status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi'; createdAt?: unknown; rejectionNote?: string;
  }>>([]);
  const [p548Form, setP548Form] = useState(false);
  const [p548Draft, setP548Draft] = useState({ employeeName: '', category: 'Ulaşım', amount: '', currency: 'TRY', date: new Date().toISOString().slice(0,10), description: '' });
  // ── Phase 549: İade Yönetimi (RMA) ──────────────────────────────────────
  const [p549Iadeler, setP549Iadeler] = useState<Array<{
    id: string; orderId: string; customerName: string; items: string; reason: string;
    condition: 'Hasarlı' | 'Sağlam' | 'Kısmen Hasarlı'; decision: 'İade' | 'Değişim' | 'Kredi Notu' | 'Bekliyor';
    status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi' | 'Tamamlandı'; createdAt?: unknown; notes?: string;
  }>>([]);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false); // Phase 28
  // ── User invite state ─────────────────────────────────────────────

  // ── Phase 99: Monthly Sales Target ───────────────────────────────────────
  const [monthlyTarget, setMonthlyTarget] = useState<number>(0);
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState('');
  // Per-month target history: { "2026-05": 100000, ... } — synced from settings/targets
  const [monthlyTargets, setMonthlyTargets] = useState<Record<string, number>>({});
  const saveMonthlyTarget = (monthKey: string, value: number) => {
    const isCurrentMonth = monthKey === (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; })();
    if (isCurrentMonth) setMonthlyTarget(value);
    const updated = { ...monthlyTargets, [monthKey]: value };
    if (value === 0) { delete updated[monthKey]; }
    setMonthlyTargets(updated);
    setDoc(doc(db, 'settings', 'targets'), updated, { merge: true }).catch(() => {});
  };
  // ── Phase 551: Tedarikçi Portalı ─────────────────────────────────────────
  const [p551SelSupplier, setP551SelSupplier] = useState<string>('');
  // ── Phase 552: Mesai & Devam (Time & Attendance) ─────────────────────────
  const [p552Records, setP552Records] = useState<Array<{
    id: string; employeeName: string; employeeId?: string; date: string;
    checkIn: string; checkOut: string; totalHours: number;
    status: 'Normal' | 'Geç Giriş' | 'Erken Çıkış' | 'Devamsız' | 'İzinli';
  }>>([]);
  const [p552AddForm, setP552AddForm] = useState(false);
  const [p552Draft, setP552Draft] = useState({ employeeName: '', date: new Date().toISOString().slice(0,10), checkIn: '09:00', checkOut: '18:00' });
  // ── Phase 553: Çalışan Self-Servis ───────────────────────────────────────
  // (no extra state — uses existing employees/payrolls/leaveRequests)
  // ── Phase 555: Ba/Bs Formu ───────────────────────────────────────────────
  const [p555Period, setP555Period] = useState(() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; });
  // ── Phase 557: Senaryo Bütçesi ───────────────────────────────────────────
  const [p557Scenario, setP557Scenario] = useState<'base'|'best'|'worst'>('base');
  // ── Phase 554: WMS Bin/Location ──────────────────────────────────────────
  const [p554Bins, setP554Bins] = useState<Array<{
    id: string; warehouseId: string; warehouseName: string; binCode: string;
    productSku: string; productName: string; quantity: number; minQty?: number;
    lastCounted?: string; notes?: string; createdAt?: unknown;
  }>>([]);
  // ── Phase 556: SGK e-Bildirge ─────────────────────────────────────────────
  const [p556Period, setP556Period] = useState(() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; });
  // ── Phase 558: KDV Analiz Raporu ─────────────────────────────────────────
  const [p558Year, setP558Year] = useState(() => String(new Date().getFullYear()));
  // ── Phase 559: Müşteri Cari Hesap Ekstresi ────────────────────────────────
  const [p559Customer, setP559Customer] = useState('');
  // ── Phase 560: Sipariş Onay Akışı ────────────────────────────────────────
  const [p560ApprovalThreshold, setP560ApprovalThreshold] = useState(50000);
  // ── Phase 561: MRP Reorder Suggestions ────────────────────────────────────
  const [p561ShowAll, setP561ShowAll] = useState(false);
  // ── Phase 562: Stock Reservation View ─────────────────────────────────────
  const [p562ShowReservations, setP562ShowReservations] = useState(false);
  // ── Phase 563: Multi-Currency P&L ────────────────────────────────────────
  const [p563PnlCurrency, setP563PnlCurrency] = useState<'TRY'|'USD'|'EUR'>('TRY');
  // ── Phase 564: e-Fatura Takip ──────────────────────────────────────────────
  const [p564FaturaFilter, setP564FaturaFilter] = useState<'all'|'missing'|'synced'|'pending'>('missing');
  // ── Phase 567: Tedarikçi Değerlendirme Matrisi ────────────────────────────
  const [p567Ratings, setP567Ratings] = useState<Record<string, Record<string,number>>>({});
  // ── Phase 568: Ürün Maliyet Kartı ────────────────────────────────────────
  const [p568Overhead, setP568Overhead] = useState(15); // overhead %
  const [p568SortBy, setP568SortBy] = useState<'margin'|'cost'|'name'>('margin');
  // ── Phase 570: KPI Hedef Takibi ───────────────────────────────────────────
  const [p570Targets, setP570Targets] = useState({ revenue: 500000, orders: 100, avgOrderVal: 5000, leadConv: 30 });
  // ── Phase 571: Audit Trail Filter ────────────────────────────────────────
  // ── Phase 572: Employee Performance Scorecard ─────────────────────────────
  const [p572SelEmpId, setP572SelEmpId] = useState<string>('');
  // ── Phase 573: Dynamic Pricing Rules Engine ───────────────────────────────
  const [p573Rules, setP573Rules] = useState<Array<{id:string;name:string;type:'bulk'|'customer-tier'|'promo';minQty?:number;tierName?:string;discountPct:number;active:boolean}>>([]);
  const [p573Draft, setP573Draft] = useState({name:'',type:'bulk' as 'bulk'|'customer-tier'|'promo',minQty:'',tierName:'',discountPct:'',active:true});
  const [p573ShowForm, setP573ShowForm] = useState(false);
  // ── Phase 574: Inventory Valuation Report ─────────────────────────────────
  const [p574ValMethod, setP574ValMethod] = useState<'cost'|'retail'|'weighted'>('cost');
  // ── Phase 575: Customer Returns & Complaints ──────────────────────────────
  // ── Phase 576: Supply Chain KPI Dashboard ─────────────────────────────────
  // ── Phase 578: PO Approval Workflow ──────────────────────────────────────
  const [p578Threshold, setP578Threshold] = useState(25000);
  // ── Phase 579: Batch/Serial Number Tracking ───────────────────────────────
  const [p579Batches, setP579Batches] = useState<Array<{id:string;sku:string;productName:string;batchNo:string;expiryDate?:string;qty:number;location?:string;status:'Aktif'|'Karantina'|'Kullanıldı'}>>([]);
  const [p579ShowForm, setP579ShowForm] = useState(false);
  const [p579Draft, setP579Draft] = useState({sku:'',productName:'',batchNo:'',expiryDate:'',qty:'',location:''});
  const [p579Search, setP579Search] = useState('');
  // ── Phase 580: Budget vs Actual ───────────────────────────────────────────
  const [p580Year, setP580Year] = useState(() => String(new Date().getFullYear()));
  // ── Phase 581: Sales Rep Performance ──────────────────────────────────────
  // ── Phase 582: Project Cost Tracking ──────────────────────────────────────
  const [p582Projects, setP582Projects] = useState<Array<{id:string;name:string;budget:number;spent:number;status:'Aktif'|'Tamamlandı'|'Beklemede'}>>([]);
  const [p582ShowForm, setP582ShowForm] = useState(false);
  const [p582Draft, setP582Draft] = useState({name:'',budget:'',spent:'',status:'Aktif' as 'Aktif'|'Tamamlandı'|'Beklemede'});
  // ── Phase 583: Warranty & Service Requests ────────────────────────────────
  // ── Phase 584: Physical Inventory / Cycle Count ───────────────────────────
  const [p584CountItems, setP584CountItems] = useState<Array<{id:string;sku:string;name:string;systemQty:number;countedQty?:number;variance?:number}>>([]);
  const [p584Active, setP584Active] = useState(false);
  const [p584Finalizing, setP584Finalizing] = useState(false);
  // Sayimi kapatirken: sayilan (countedQty dolu) ve fark olan her urun icin
  // stockLevel'i sayilan degere getirir + inventoryMovements'a sayim_duzeltme
  // kategorisiyle loglar + tum oturumu 'stockCounts'a arsivler. Onceden bu
  // veriler "Sayımı Kapat"ta sessizce atiliyordu (hicbir stok/kayit etkisi yoktu).
  const handleFinalizeCycleCount = async () => {
    setP584Finalizing(true);
    try {
      const counted = p584CountItems.filter(i => i.countedQty !== undefined);
      const variant = counted.filter(i => (i.variance || 0) !== 0);
      for (const item of variant) {
        const diff = item.variance || 0;
        await incrementField('inventory', item.id, 'stockLevel', diff, 0);
        await addDoc(collection(db, 'inventoryMovements'), {
          productId: item.id,
          productName: item.name,
          sku: item.sku,
          type: diff > 0 ? 'in' : 'out',
          quantity: Math.abs(diff),
          category: 'sayim_duzeltme',
          reason: currentLanguage === 'tr' ? 'Sayım Düzeltmesi' : 'Count Correction',
          companyId: user?.uid ?? null,
          timestamp: serverTimestamp(),
        });
      }
      await addDoc(collection(db, 'stockCounts'), {
        items: counted.map(i => ({ productId: i.id, sku: i.sku, productName: i.name, systemQty: i.systemQty, countedQty: i.countedQty, variance: i.variance || 0 })),
        totalCounted: counted.length,
        totalVariance: variant.length,
        companyId: user?.uid ?? null,
        countedBy: user?.email ?? user?.uid ?? null,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      importedLogFirestoreError(error as Error, OperationType.WRITE, 'stockCounts', auth.currentUser?.uid);
    } finally {
      setP584Finalizing(false);
      setP584Active(false);
      setP584CountItems([]);
    }
  };
  // ── Phase 585: Customer Loyalty Score ─────────────────────────────────────
  // ── Phase 586: Sales Target by Rep ────────────────────────────────────────
  // ── Phase 587: Quality Inspection Checklist ───────────────────────────────
  const [p587Checks, setP587Checks] = useState<Array<{id:string;item:string;checked:boolean;severity:'Kritik'|'Uyarı'|'Bilgi'}>>([]);
  const [p587NewItem, setP587NewItem] = useState('');
  // ── Phase 588: Consignment Stock ──────────────────────────────────────────
  const [p588Consign, setP588Consign] = useState<Array<{id:string;supplierName:string;productName:string;sku:string;qty:number;agreedPrice:number;locationCode?:string;startDate:string;status:'Depoda'|'Satıldı'|'İade Edildi'}>>([]);
  const [p588ShowForm, setP588ShowForm] = useState(false);
  const [p588Draft, setP588Draft] = useState({supplierName:'',productName:'',sku:'',qty:'',agreedPrice:'',locationCode:'',startDate:new Date().toISOString().slice(0,10)});
  // ── Phase 590: Notification Inbox ─────────────────────────────────────────
  // ── Phase 591: Auto-Invoice Scheduler ─────────────────────────────────────
  const [p591Schedules, setP591Schedules] = useState<Array<{id:string;customerName:string;amount:number;frequency:'monthly'|'quarterly'|'yearly';nextDate:string;description:string;active:boolean}>>([]);
  const [p591ShowForm, setP591ShowForm] = useState(false);
  const [p591Draft, setP591Draft] = useState({customerName:'',amount:'',frequency:'monthly' as 'monthly'|'quarterly'|'yearly',nextDate:'',description:''});
  // ── Phase 593: Vehicle Fleet Tracking ─────────────────────────────────────
  // ── Phase 595: Task & Reminder Board ──────────────────────────────────────
  const [p595Tasks, setP595Tasks] = useState<Array<{id:string;title:string;dueDate:string;assignedTo:string;module:string;priority:'Düşük'|'Orta'|'Yüksek'|'Kritik';done:boolean}>>([]);
  const [p595ShowForm, setP595ShowForm] = useState(false);
  const [p595Draft, setP595Draft] = useState({title:'',dueDate:'',assignedTo:'',module:'',priority:'Orta' as 'Düşük'|'Orta'|'Yüksek'|'Kritik'});
  // ── Phase 596: Smart Replenishment Advisor ────────────────────────────────
  // ── Phase 597: Revenue Recognition Schedule ───────────────────────────────
  const [p597Contracts, setP597Contracts] = useState<Array<{id:string;customerName:string;totalValue:number;startDate:string;endDate:string;recognized:number}>>([]);
  const [p597ShowForm, setP597ShowForm] = useState(false);
  const [p597Draft, setP597Draft] = useState({customerName:'',totalValue:'',startDate:'',endDate:'',recognized:''});
  // ── Phase 598: Contract Renewal Alerts ────────────────────────────────────
  const [p598AlertDays, setP598AlertDays] = useState(30);
  // ── Phase 599: Employee Skill Matrix ──────────────────────────────────────
  const [p599Skills] = useState(['Excel','ERP','Müşteri İlişkileri','Proje Yönetimi','Teknik Destek','Muhasebe','Lojistik','İngilizce','Satış']);
  const [p599Ratings, setP599Ratings] = useState<Record<string,Record<string,number>>>({});
  const [p599SelEmp, setP599SelEmp] = useState<string>('');
  // ── Phase 600: Integration Health Dashboard ────────────────────────────────
  // (state derived from existing config — no new useState needed)
  // ── Phase 601: Müşteri Segmentasyon Analizi ───────────────────────────────
  // ── Phase 602: Çoklu Döviz Sipariş Yönetimi ──────────────────────────────
  // ── Phase 604: Satıcı Komisyon Takibi ─────────────────────────────────────
  // ── Phase 605: Üretim Kapasitesi Planlama ─────────────────────────────────
  const [p605Capacity, setP605Capacity] = useState<Array<{line:string;maxCap:number;planned:number;actual:number}>>([]);
  const [p605ShowForm, setP605ShowForm] = useState(false);
  const [p605Draft, setP605Draft] = useState({line:'',maxCap:'',planned:'',actual:''});
  // ── Phase 606: E-posta Kampanya Takibi ────────────────────────────────────
  // ── Phase 607: Tahsilat Hatırlatma Otomasyonu ─────────────────────────────
  const [p607ReminderDays, setP607ReminderDays] = useState([7, 14, 30]);
  // ── Phase 608: Tedarikçi Fiyat Karşılaştırması ───────────────────────────
  const [p608SelProduct, setP608SelProduct] = useState('');
  const [p608Quotes, setP608Quotes] = useState<Array<{id:string;supplier:string;price:number;leadDays:number;minQty:number;validUntil?:string}>>([]);
  const [p608ShowForm, setP608ShowForm] = useState(false);
  const [p608Draft, setP608Draft] = useState({supplier:'',price:'',leadDays:'',minQty:'',validUntil:''});
  // ── Phase 609: SLA & Müşteri Memnuniyeti Takibi ───────────────────────────
  // ── Phase 610: Kâr Merkezi Analizi ───────────────────────────────────────
  const [p610Period, setP610Period] = useState<'this_month'|'last_month'|'ytd'>('this_month');
  // ── Phase 611: Stok Devir Hızı ────────────────────────────────────────────
  const [p611Period, setP611Period] = useState<'30d'|'90d'|'180d'>('90d');
  // ── Phase 612: Satın Alma Bütçesi ─────────────────────────────────────────
  const [p612Budgets, setP612Budgets] = useState<Array<{id:string;category:string;allocated:number;spent:number;period:string}>>([]);
  const [p612ShowForm, setP612ShowForm] = useState(false);
  const [p612Draft, setP612Draft] = useState({category:'',allocated:'',spent:'',period:new Date().toISOString().slice(0,7)});
  // ── Phase 613: Müşteri Portföy Analizi ────────────────────────────────────
  // ── Phase 614: Nakit Pozisyon Özeti ──────────────────────────────────────
  // ── Phase 615: Üretim Kalite Metrikleri ──────────────────────────────────
  const [p615Metrics, setP615Metrics] = useState<Array<{id:string;date:string;line:string;total:number;defects:number;rework:number}>>([]);
  const [p615ShowForm, setP615ShowForm] = useState(false);
  const [p615Draft, setP615Draft] = useState({date:new Date().toISOString().slice(0,10),line:'',total:'',defects:'',rework:''});
  // ── Phase 616: Çalışan Devir Analizi ─────────────────────────────────────
  const [p616Period, setP616Period] = useState<'3m'|'6m'|'12m'>('12m');
  // ── Phase 617: KDV Mutabakat ──────────────────────────────────────────────
  const [p617Month, setP617Month] = useState(()=>new Date().toISOString().slice(0,7));
  // ── Phase 618: Proje Zaman Çizelgesi ─────────────────────────────────────
  const [p618Projects, setP618Projects] = useState<Array<{id:string;name:string;start:string;end:string;progress:number;status:'Aktif'|'Tamamlandı'|'Gecikmiş'|'Beklemede';owner:string}>>([]);
  const [p618ShowForm, setP618ShowForm] = useState(false);
  const [p618Draft, setP618Draft] = useState({name:'',start:'',end:'',progress:'0',status:'Aktif' as 'Aktif'|'Tamamlandı'|'Gecikmiş'|'Beklemede',owner:''});
  // ── Phase 621: Talep Yönetimi (Demand Management) ─────────────────────────
  const [p621Demands, setP621Demands] = useState<Array<{id:string;productName:string;sku:string;requestedQty:number;requestedBy:string;priority:'Düşük'|'Orta'|'Yüksek';status:'Bekliyor'|'Onaylandı'|'Reddedildi'|'Sipariş Verildi';notes?:string;createdAt:string}>>([]);
  // ── Phase 622: İhracat & Gümrük Takibi ───────────────────────────────────
  // ── Phase 623: Akreditif & Ödeme Belgesi Takibi ──────────────────────────
  const [p623LCs, setP623LCs] = useState<Array<{id:string;bank:string;beneficiary:string;amount:number;currency:'USD'|'EUR';expiryDate:string;status:'Açık'|'Kullanıldı'|'Sona Erdi'|'İptal';ref:string}>>([]);
  const [p623ShowForm, setP623ShowForm] = useState(false);
  const [p623Draft, setP623Draft] = useState({bank:'',beneficiary:'',amount:'',currency:'USD' as 'USD'|'EUR',expiryDate:'',ref:''});
  // ── Phase 624: Üretim Emri Yönetimi ──────────────────────────────────────
  const [p624Orders, setP624Orders] = useState<Array<{id:string;productName:string;qty:number;plannedStart:string;plannedEnd:string;status:'Planlandı'|'Üretimde'|'Tamamlandı'|'İptal';priority:'Normal'|'Acil';workCenter:string}>>([]);
  const [p624ShowForm, setP624ShowForm] = useState(false);
  const [p624Draft, setP624Draft] = useState({productName:'',qty:'',plannedStart:'',plannedEnd:'',status:'Planlandı' as 'Planlandı'|'Üretimde'|'Tamamlandı'|'İptal',priority:'Normal' as 'Normal'|'Acil',workCenter:''});
  // ── Phase 625: Gelir Gider Bütçe Karşılaştırması ─────────────────────────
  const [p625BudgetYear, setP625BudgetYear] = useState(()=>new Date().getFullYear());
  const [p625BudgetData, setP625BudgetData] = useState<Array<{month:number;budgetRevenue:number;budgetExpense:number}>>([]);
  const [p625EditMonth, setP625EditMonth] = useState<number|null>(null);
  // ── Phase 626: Müşteri Ödeme Analizi ─────────────────────────────────────
  // ── Phase 627: Tedarik Zinciri Riski ─────────────────────────────────────
  const [p627Risks, setP627Risks] = useState<Array<{id:string;supplier:string;riskType:'Tedarik Kesintisi'|'Kalite'|'Fiyat Artışı'|'Teslimat Gecikmesi'|'Diğer';severity:'Düşük'|'Orta'|'Yüksek'|'Kritik';probability:number;mitigationPlan?:string;status:'Aktif'|'Azaltıldı'|'Kabul Edildi'}>>([]);
  const [p627ShowForm, setP627ShowForm] = useState(false);
  const [p627Draft, setP627Draft] = useState({supplier:'',riskType:'Tedarik Kesintisi' as 'Tedarik Kesintisi'|'Kalite'|'Fiyat Artışı'|'Teslimat Gecikmesi'|'Diğer',severity:'Orta' as 'Düşük'|'Orta'|'Yüksek'|'Kritik',probability:'50',mitigationPlan:''});
  // ── Phase 628: Stok Optimizasyon Analizi ─────────────────────────────────
  // ── Phase 629: Çalışan Performans KPI ────────────────────────────────────
  const [p629KpiPeriod, setP629KpiPeriod] = useState<'this_month'|'last_month'|'ytd'>('this_month');
  // ── Phase 630: Fatura Takip & Yaşlandırma ─────────────────────────────────
  const [p630InvoicePeriod, setP630InvoicePeriod] = useState<'7d'|'30d'|'60d'|'90d'>('30d');
  // ── Red-team Fix A: Integration Staleness Detection ───────────────────────
  const [staleIntegrations, setStaleIntegrations] = useState<string[]>([]);
  const [staleAlertDismissed, setStaleAlertDismissed] = useState(false);
  useEffect(() => {
    const STALE_HOURS = 24;
    const threshold = Date.now() - STALE_HOURS * 3600000;
    const stale: string[] = [];
    const parseSync = (v: unknown): number | null => {
      if (!v) return null;
      try { return typeof (v as {toDate?:()=>Date}).toDate==='function' ? (v as {toDate:()=>Date}).toDate().getTime() : new Date(v as string).getTime(); } catch { return null; }
    };
    const mikroTs = parseSync(mikroSettings.lastSync);
    const lucaTs  = parseSync(lucaSettings.lastSync);
    if (mikroSettings.enabled && mikroSettings.connected && mikroTs !== null && mikroTs < threshold) stale.push('Mikro ERP');
    if (lucaSettings.enabled && lucaSettings.connected && lucaTs !== null && lucaTs < threshold) stale.push('Luca');
    setStaleIntegrations(stale);
    setStaleAlertDismissed(false);
  }, [mikroSettings, lucaSettings]);

  // ── Red-team Fix B: KVKK Consent (enterprise users, once per session) ──────
  const [showKvkkModal, setShowKvkkModal] = useState(false);
  const [kvkkAccepted, setKvkkAccepted] = useState(() => sessionStorage.getItem('cetpa_kvkk') === '1');
  useEffect(() => {
    if (!kvkkAccepted && user && userSubscription?.plan && ['business','enterprise'].includes(userSubscription.plan)) {
      const t = setTimeout(() => setShowKvkkModal(true), 1500);
      return () => clearTimeout(t);
    }
  }, [user, userSubscription, kvkkAccepted]);
  const acceptKvkk = () => { sessionStorage.setItem('cetpa_kvkk','1'); setKvkkAccepted(true); setShowKvkkModal(false); };
  const [kvkkConcern, setKvkkConcern] = useState(false);
  const [kvkkCopied, setKvkkCopied] = useState(false);
  const copyKvkkContact = async () => {
    try { await navigator.clipboard.writeText('info@cetpa.com.tr'); setKvkkCopied(true); setTimeout(() => setKvkkCopied(false), 2000); } catch { /* clipboard yok */ }
  };

  // ── Gemini AI (Yapay Zeka Destek Modülü) kullanım onayı ─────────────────────
  // Mikro'nun kendi AI modülündeki desenle ayni: Aydinlatma Metni + Kullanim
  // Kosullari icin iki ayri onay, kullanicinin kendi hesabina (aiConsents/{uid})
  // kalici olarak yazilir - sessionStorage'daki genel KVKK modalinden farkli
  // olarak burada gercek bir onay kaydi/audit izi tutulur (ne zaman, hangi
  // versiyon metni onaylandi).
  const AI_CONSENT_VERSION = 1;
  const [aiConsentChecked, setAiConsentChecked] = useState(false);
  const [aiConsentGiven, setAiConsentGiven] = useState(false);
  const [showAiConsentModal, setShowAiConsentModal] = useState(false);
  const [aiConsentAydinlatma, setAiConsentAydinlatma] = useState(false);
  const [aiConsentKosullar, setAiConsentKosullar] = useState(false);
  const [aiConsentExpanded, setAiConsentExpanded] = useState<'aydinlatma' | 'kosullar' | null>(null);

  useEffect(() => {
    if (!user) { setAiConsentChecked(false); setAiConsentGiven(false); return; }
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'aiConsents', user.uid));
        const given = snap.exists() && (snap.data() as { accepted?: boolean; version?: number }).accepted === true
          && (snap.data() as { version?: number }).version === AI_CONSENT_VERSION;
        setAiConsentGiven(given);
      } catch {
        setAiConsentGiven(false);
      } finally {
        setAiConsentChecked(true);
      }
    })();
  }, [user]);

  // Mikro'nun kendi AI modul deseninde oldugu gibi kullanim denenmeden ONCE
  // proaktif olarak goster (KVKK modaliyla ayni gecikme deseni - ust uste
  // binmesinler diye biraz daha gec).
  useEffect(() => {
    if (aiConsentChecked && !aiConsentGiven && user) {
      const t = setTimeout(() => setShowAiConsentModal(true), 2500);
      return () => clearTimeout(t);
    }
  }, [aiConsentChecked, aiConsentGiven, user]);

  const acceptAiConsent = async () => {
    if (!user || !aiConsentAydinlatma || !aiConsentKosullar) return;
    try {
      await setDoc(doc(db, 'aiConsents', user.uid), {
        userId: user.uid,
        accepted: true,
        version: AI_CONSENT_VERSION,
        acceptedAt: serverTimestamp(),
        acceptedBy: user.email || user.uid,
      });
      setAiConsentGiven(true);
      setShowAiConsentModal(false);
    } catch { /* kullanici tekrar deneyebilir, modal acik kalir */ }
  };

  // ── Stripe Checkout return handler ───────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    if (!checkout) return;
    // Strip the param from the URL without a full reload
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);
    if (checkout === 'success') {
      const plan = params.get('plan') ?? '';
      toast(
        currentLanguage === 'tr'
          ? `🎉 Ödeme başarılı! ${plan ? plan.charAt(0).toUpperCase() + plan.slice(1) + ' planı' : 'Plan'} aktif edildi.`
          : `🎉 Payment successful! ${plan ? plan.charAt(0).toUpperCase() + plan.slice(1) + ' plan' : 'Plan'} is now active.`,
        'success'
      );
      setShowPricingPage(false);
    } else if (checkout === 'cancel') {
      toast(
        currentLanguage === 'tr' ? 'Ödeme iptal edildi.' : 'Payment was cancelled.',
        'error'
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Red-team Fix C: PWA Install Prompt ────────────────────────────────────
  const [pwaPromptEvent, setPwaPromptEvent] = useState<Event & {prompt:()=>void; userChoice:Promise<{outcome:string}>} | null>(null);
  const [showPwaBanner, setShowPwaBanner] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setPwaPromptEvent(e as Event & {prompt:()=>void;userChoice:Promise<{outcome:string}>}); setShowPwaBanner(true); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  const installPwa = () => { pwaPromptEvent?.prompt(); pwaPromptEvent?.userChoice.then(() => setShowPwaBanner(false)); };

  // ── Red-team Fix D: Data Import Wizard ────────────────────────────────────
  const [showDataImport, setShowDataImport] = useState(false);
  // ── Phase 633: RFM Müşteri Segmentasyonu ──────────────────────────────────
  // ── Phase 634: Bütçe-Fiili Varyans Analizi ────────────────────────────────
  const [p634Period, setP634Period] = useState<'this_month'|'last_month'|'ytd'>('this_month');
  // ── Phase 635: Kur Değerleme (FX Revaluation) ─────────────────────────────
  // Kur Değerleme: açık döviz pozisyonu (foreign tutar) + defterdeki kur — editlenebilir,
  // settings/fxRevaluation'da saklanır. Güncel kur canlı TCMB'den (exchangeRates).

  const [fxRefreshing, setFxRefreshing] = useState(false);
  
  const fxSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateFx = (field: keyof typeof fxPos, value: number) => {
    setFxPos(prev => {
      const next = { ...prev, [field]: value };
      if (fxSaveTimer.current) clearTimeout(fxSaveTimer.current);
      fxSaveTimer.current = setTimeout(() => {
        void setDoc(doc(db, 'settings', 'fxRevaluation'), { ...next, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
      }, 600);
      return next;
    });
  };
  const refreshFxRates = async () => {
    setFxRefreshing(true);
    try {
      const res = await fetch('/api/settings/exchange-rates');
      const data = await res.json();
      if (data?.rates?.USD) { setExchangeRates(data.rates); storeSetRates(data.rates); }
    } catch { /* başarısızsa mevcut kalır */ }
    setFxRefreshing(false);
  };
  // ── Phase 636: SGK/Net Bordro Hesaplama Motoru ────────────────────────────
  const [p636Month, setP636Month] = useState(()=>new Date().toISOString().slice(0,7));
  const [p636Payrolls, setP636Payrolls] = useState<Array<{id:string;name:string;position:string;gross:number;sgkEmployee:number;sgkEmployer:number;incomeTax:number;stampTax:number;net:number}>>([]);
  const [p636Calculated, setP636Calculated] = useState(false);
  // ── Phase 637: Kapasite Planlama ──────────────────────────────────────────
  const [p637Horizon, setP637Horizon] = useState<'7d'|'30d'|'90d'>('30d');
  // ── Phase 638: Otomatik Ödeme Eşleştirme ──────────────────────────────────
  const [p638MatchResults, setP638MatchResults] = useState<Array<{invoiceId:string;invoiceNo:string;customer:string;invoiceAmount:number;matchedAmount:number;confidence:number;status:'Tam'|'Kısmi'|'Eşleşmedi'}>>([]);
  const [p638Running, setP638Running] = useState(false);
  // ── Phase 639: İade & Kredi Notu ──────────────────────────────────────────
  const [p639Returns, setP639Returns] = useState<Array<{id:string;orderId:string;customerName:string;reason:string;amount:number;status:'Bekliyor'|'Onaylandı'|'Reddedildi';createdAt:string}>>([]);
  // ── Phase 640: Tekrarlayan Fatura / Abonelik ───────────────────────────────
  const [p640Subs, setP640Subs] = useState<Array<{id:string;customerName:string;amount:number;frequency:'Aylık'|'3 Aylık'|'Yıllık';nextDate:string;status:'Aktif'|'Pasif'|'İptal'}>>([]);
  const [p640ShowForm, setP640ShowForm] = useState(false);
  const [p640Draft, setP640Draft] = useState({customerName:'',amount:'',frequency:'Aylık' as 'Aylık'|'3 Aylık'|'Yıllık',nextDate:new Date().toISOString().slice(0,10)});
  // ── Phase 641: Denetim İzi (Audit Trail) ──────────────────────────────────

  // ── Phase 642: Garanti Takip ───────────────────────────────────────────────
  const [p642Warranties, setP642Warranties] = useState<Array<{id:string;productName:string;sku:string;serialNo:string;customerName:string;purchaseDate:string;warrantyMonths:number;status:'Aktif'|'Sona Erdi'|'Talep Açık'}>>([]);
  const [p642ShowForm, setP642ShowForm] = useState(false);
  const [p642Draft, setP642Draft] = useState({productName:'',sku:'',serialNo:'',customerName:'',purchaseDate:new Date().toISOString().slice(0,10),warrantyMonths:'12'});
  // ── Phase 643: Şirketlerarası İşlemler ────────────────────────────────────
  const [p643Txns, setP643Txns] = useState<Array<{id:string;from:string;to:string;amount:number;currency:'TRY'|'USD'|'EUR';desc:string;date:string;status:'Bekliyor'|'Netleştirildi'}>>([]);
  const [p643ShowForm, setP643ShowForm] = useState(false);
  const [p643Draft, setP643Draft] = useState({from:'Cetpa A.Ş.',to:'Cetpa Lojistik Ltd.',amount:'',currency:'TRY' as 'TRY'|'USD'|'EUR',desc:'',date:new Date().toISOString().slice(0,10)});
  // ── Phase 644: MRP / Malzeme İhtiyaç Planlaması ───────────────────────────
  const [p644Horizon, setP644Horizon] = useState(30);

  // ── Phase 645–650 state ───────────────────────────────────────────────────
  type WebhookConfig = { id: string; url: string; events: string[]; enabled: boolean; createdAt?: unknown };
  const [webhookConfigs, setWebhookConfigs] = useState<WebhookConfig[]>([]);


  // ── Phase 649: Subscribe to webhookConfigs collection ────────────────────
  useEffect(() => {
    if (!user || activeTab !== 'settings') return; // yalnızca Ayarlar ekranında gösterilir
    return onSnapshot(collection(db, 'webhookConfigs'), s =>
      setWebhookConfigs(s.docs.map(d => ({ id: d.id, ...d.data() } as WebhookConfig))),
      () => setWebhookConfigs([])
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, activeTab]);

  // ── Phase 632: Konsolidasyon & Holding Raporu ─────────────────────────────
  // p632Consolidation kaldırıldı — hiç render edilmeyen hardcoded dummy veriydi.
  // ── Phase 547: Fetch bank accounts + fixed assets for Bilanço ───────────
  useEffect(() => {
    if (activeTab !== 'muhasebe' || muhasebeTab !== 'bilanco') return;
    const unsubBank = onSnapshot(collection(db, 'bankAccounts'), snap => {
      setP547BankAccounts(sortByCreatedAt(snap.docs.map(d => ({
        id: d.id, bankName: d.data().bankName || d.data().bank || '—',
        accountType: d.data().accountType || 'Vadesiz',
        balance: Number(d.data().balance) || 0,
        currency: d.data().currency || 'TRY',
      }))));
    }, () => setP547BankAccounts([]));
    const unsubFA = onSnapshot(collection(db, 'sabitKiymetler'), snap => {
      setP547FixedAssets(sortByCreatedAt(snap.docs.map(d => ({
        id: d.id, name: d.data().name || '—',
        cost: Number(d.data().cost) || Number(d.data().edinimBedeli) || 0,
        depreciation: Number(d.data().birikimliAmortisman) || 0,
      }))));
    }, () => setP547FixedAssets([]));
    return () => { unsubBank(); unsubFA(); };
   
  }, [activeTab, muhasebeTab]);

  // ── Phase 548: Fetch expense claims (masraf) ───────────────────────────
  useEffect(() => {
    if (activeTab !== 'muhasebe' || muhasebeTab !== 'masraf') return;
    const unsub = onSnapshot(query(collection(db, 'masraflar')), snap => {
      setP548Masraflar(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p548Masraflar[number]))));
    }, () => {});
    return () => unsub();
   
  }, [activeTab, muhasebeTab]);

  // ── Phase 552: Fetch time & attendance when on IK tab ────────────────────
  useEffect(() => {
    if (activeTab !== 'ik') return;
    const unsub = onSnapshot(query(collection(db, 'timeAttendance')), snap => {
      setP552Records(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p552Records[number]))));
    }, () => {});
    return () => unsub();
   
  }, [activeTab]);

  // ── Phase 554: Fetch WMS bins when on lojistik/wms tab ──────────────────
  useEffect(() => {
    if (activeTab !== 'lojistik' || lojistikTab !== 'wms') return;
    const unsub = onSnapshot(collection(db, 'warehouseBins'), snap => {
      setP554Bins(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p554Bins[number]))));
    }, () => {});
    return () => unsub();
   
  }, [activeTab, lojistikTab]);

  // ── Phase 549: Fetch RMA/İade requests ──────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'iade') return;
    const unsub = onSnapshot(query(collection(db, 'rmaRequests')), snap => {
      setP549Iadeler(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p549Iadeler[number]))));
    }, () => {});
    return () => unsub();
   
  }, [activeTab]);

  // ── Phase 543: Subscribe to vergiTakvimi when on dashboard ───────────────
  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    const today543 = new Date().toISOString().slice(0, 10);
    const unsub = onSnapshot(
      query(collection(db, 'vergiTakvimi')),
      snap => {
        const upcoming = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as { vergiTuru: string; sonTarih: string; durum: string }) }))
          .filter(d => d.sonTarih >= today543 && d.durum !== 'Tamamlandı')
          .slice(0, 4);
        setDashVergiDeadlines(upcoming);
      },
      () => setDashVergiDeadlines([])
    );
    return () => unsub();
   
  }, [activeTab]);

  // ── Phase 100: In-App Email Compose ──────────────────────────────────────
  const [emailCompose, setEmailCompose] = useState<{ open: boolean; to: string; name: string; subject: string; body: string }>({
    open: false, to: '', name: '', subject: '', body: ''
  });
  const [emailSending, setEmailSending] = useState(false);
  // ── Phase 101: Order Activity Timeline ───────────────────────────────────
  type TimelineEntry = { action: string; actor: string; ts: number; note?: string };
  // ── Phase 102: Quick PO prefill ──────────────────────────────────────────
  const [quickPOProduct, setQuickPOProduct] = useState<{ name: string; sku: string } | null>(null);
  // ── Phase 110: AP Tracker — purchase orders for accounting ───────────────
  const [apPurchaseOrders, setApPurchaseOrders] = useState<Array<{
    id: string; orderNumber: string; supplier: string; totalAmount: number;
    status: string; expectedDate?: unknown; createdAt?: unknown;
  }>>([]);
  const [apCurrency, setApCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  // ── Phase 111: Support Tickets ────────────────────────────────────────────
  const [supportTickets, setSupportTickets] = useState<Array<{
    id: string; title: string; customerName: string; orderId?: string;
    priority: 'low' | 'medium' | 'high'; status: 'open' | 'in_progress' | 'resolved';
    createdAt?: unknown; assignedTo?: string; description?: string;
  }>>([]);
  // ── Phase 112: RMA / Returns ──────────────────────────────────────────────
  const [returnModal, setReturnModal] = useState<{ open: boolean; order: Order | null }>({ open: false, order: null });
  const [returnReason, setReturnReason] = useState('');
  const [returnItems, setReturnItems] = useState<string>('');
  const [returnAmount, setReturnAmount] = useState<number>(0);
  const [returnSubmitting, setReturnSubmitting] = useState(false);
  // ── Phase 115: Email Campaign Manager ────────────────────────────────────
  // ── Phase 116: Contract Management ────────────────────────────────────────
  const [contracts, setContracts] = useState<Array<{
    id: string; customerName: string; title: string; value: number;
    startDate: string; endDate: string; status: string; autoRenew: boolean;
  }>>([]);
  // ── Phase 121: Leave Management ──────────────────────────────────────────
  const [leaveRequests, setLeaveRequests] = useState<Array<{
    id: string; employeeId: string; employeeName: string;
    type: 'annual' | 'sick' | 'unpaid' | 'other';
    startDate: string; endDate: string; days: number;
    status: 'pending' | 'approved' | 'rejected'; reason?: string;
  }>>([]);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ employeeName: '', type: 'annual' as 'annual' | 'sick' | 'unpaid' | 'other', startDate: '', endDate: '', reason: '' });
  // ── Phase 117: Payroll ────────────────────────────────────────────────────
  const [payrollMonth, setPayrollMonth] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [payrollView, setPayrollView] = useState<'summary' | 'detail'>('summary');
  // ── Phase 118: Bank Reconciliation ───────────────────────────────────────
  const [bankBalance, setBankBalance] = useState<number>(0);
  const [bankBalanceDraft, setBankBalanceDraft] = useState('');
  const [bankBalanceEditing, setBankBalanceEditing] = useState(false);
  const [reconMonth, setReconMonth] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  // ── Phase 119: Recurring Order Templates ─────────────────────────────────
  const [recurringOrders, setRecurringOrders] = useState<Array<{
    id: string; templateName: string; customerName: string; totalPrice: number;
    frequency: 'weekly' | 'monthly' | 'quarterly'; nextDue: string; active: boolean;
  }>>([]);
  // ── Phase 122: Price Override Approval ──────────────────────────────────
  const [priceOverrides, setPriceOverrides] = useState<Array<{
    id: string; requestedBy: string; customerName: string;
    productName: string; standardPrice: number; requestedPrice: number;
    reason: string; status: 'pending' | 'approved' | 'rejected';
    createdAt: unknown;
  }>>([]);
  // ── Phase 113: Budget vs Actuals ─────────────────────────────────────────
  type BudgetEntry = { dept: string; budgetTRY: number };
  const [budgets, setBudgets] = useState<BudgetEntry[]>([]);
  const [allBudgetsFirestore, setAllBudgetsFirestore] = useState<Record<string, BudgetEntry[]>>({});
  const [budgetDraft, setBudgetDraft] = useState<Record<string, string>>({});
  const [budgetMonth, setBudgetMonth] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  // Sync budgets state when month selector or Firestore data changes
  useEffect(() => {
    setBudgets(allBudgetsFirestore[budgetMonth] ?? []);
  }, [budgetMonth, allBudgetsFirestore]);
  const [butceCurrency, setButceCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  // Kategori chip'leri YALNIZCA envanterdeki gerçek ürünlerden türer —
  // categories koleksiyonundaki dummy/eski kayıtlar filtreye sızamaz.
  // (firestoreCategories ürün formu dropdown'ı için ayrıca duruyor.)
  const inventoryCategories = [...new Set(
    inventory.map(i => i.category).filter((c): c is string => !!c)
  )].sort((a, b) => a.localeCompare(b, 'tr'));
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

  // --- Auth & User Profile ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      let resolvedCompanyId: string | null = null;
      if (u) {
        // 2FA: kullanıcının 2FA'sı açık ama oturum doğrulanmamışsa challenge sür.
        // (Veri yükleyiciler /api/db'ye erişmeden önce doğrulama gerekir.)
        try {
          const mfa = await getMfaStatus();
          setMfaChallenge(mfa.enabled && !mfa.verified);
        } catch { /* status alınamazsa engelleme */ }
        // Sync user profile to Firestore
        const userRef = doc(db, 'users', u.uid);
        const userSnap = await getDoc(userRef);
        // Gerçek companyId = users/{uid}.companyId ?? uid (davet edilen üyeler için).
        resolvedCompanyId = (userSnap.exists() && (userSnap.data()?.companyId as string)) || u.uid;

        const fetchLocation = async () => {
          try {
            // 3sn timeout — 3. parti geolocation auth boot'unu süresiz bloke etmesin.
            const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) });
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
          storeSetRole(role as UserRole);
        } else {
          try {
            await updateDoc(userRef, userData);
          } catch (error) {
            handleFirestoreError(error, OperationType.UPDATE, `users/${u.uid}`);
          }
          const resolvedRole = (u.isAnonymous ? 'Admin' : (userSnap.data().role || 'Sales')) as UserRole;
          setUserRole(resolvedRole);
          storeSetRole(resolvedRole);
        }
      }
      setUser(u);
      storeSetUser(u);
      storeSetCompanyId(resolvedCompanyId);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // --- Real-time Logo & Settings ---
  

  // --- AI Config (Gemini key) ---
  

  // --- Real-time Mikro & Luca Settings ---
  

  // --- GIB connection status + Branch names for order form ---
  

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
        const currentDomain = window.location.hostname;
        toast(
          currentLanguage === 'tr'
            ? `"${currentDomain}" Firebase Auth için yetkili değil. Firebase Console > Authentication > Settings > Authorized domains altına "${currentDomain}" ekleyin.`
            : `"${currentDomain}" is not authorized for Firebase Auth. Add "${currentDomain}" in Firebase Console > Authentication > Settings > Authorized domains.`,
          'error'
        );
      } else if (code === 'auth/operation-not-allowed') {
        toast(
          currentLanguage === 'tr'
            ? "Google ile giriş Firebase Authentication ayarlarında etkin değil. Sign-in method altından Google provider'ı aktif edin."
            : "Google sign-in is not enabled in Firebase Authentication. Enable the Google provider under Sign-in method.",
          'error'
        );
      } else if (code === 'auth/popup-closed-by-user') {
        toast(currentLanguage === 'tr' ? 'Giriş penceresi kapatıldı.' : 'The sign-in popup was closed.', 'info');
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

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const tr = currentLanguage === 'tr';
    if (!signupForm.name.trim() || !signupForm.email.trim() || !signupForm.password) {
      setAuthError(tr ? 'Tüm alanlar zorunludur.' : 'All fields are required.');
      return;
    }
    if (signupForm.password.length < 8) {
      setAuthError(tr ? 'Şifre en az 8 karakter olmalıdır.' : 'Password must be at least 8 characters.');
      return;
    }
    if (signupForm.password !== signupForm.confirm) {
      setAuthError(tr ? 'Şifreler eşleşmiyor.' : 'Passwords do not match.');
      return;
    }
    setIsEmailLoginLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, signupForm.email.trim(), signupForm.password);
      await updateProfile(cred.user, { displayName: signupForm.name.trim() });
      await sendEmailVerification(cred.user);
      // user state will be set by onAuthStateChanged
    } catch (error) {
      const code = (error as Record<string, unknown>)?.code as string | undefined;
      if (code === 'auth/email-already-in-use') {
        setAuthError(tr ? 'Bu e-posta zaten kullanımda.' : 'This email is already in use.');
      } else if (code === 'auth/invalid-email') {
        setAuthError(tr ? 'Geçersiz e-posta adresi.' : 'Invalid email address.');
      } else if (code === 'auth/weak-password') {
        setAuthError(tr ? 'Şifre çok zayıf.' : 'Password is too weak.');
      } else {
        setAuthError(tr ? `Kayıt başarısız: ${code || 'bilinmeyen-hata'}` : `Sign up failed: ${code || 'unknown-error'}`);
      }
    } finally {
      setIsEmailLoginLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const tr = currentLanguage === 'tr';
    if (!emailLogin.email.trim()) {
      setAuthError(tr ? 'E-posta adresi gerekli.' : 'Email address is required.');
      return;
    }
    setIsEmailLoginLoading(true);
    try {
      await sendPasswordResetEmail(auth, emailLogin.email.trim());
      setResetSent(true);
    } catch (error) {
      const code = (error as Record<string, unknown>)?.code as string | undefined;
      if (code === 'auth/user-not-found') {
        // Don't reveal if email exists for security
        setResetSent(true);
      } else {
        setAuthError(tr ? 'Sıfırlama e-postası gönderilemedi.' : 'Could not send reset email.');
      }
    } finally {
      setIsEmailLoginLoading(false);
    }
  };

  useEffect(() => {
    getRedirectResult(auth).catch((error) => {
      console.error('Redirect result error:', error);
    });
  }, []);

  const handleLogout = async () => {
    if (isGuestMode) {
      setIsGuestMode(false);
      setUser(null);
      storeSetUser(null);
      return;
    }
    try {
      await signOut(auth); // await: oturum kapanışı tamamlanmadan state temizlenmesin
    } catch (e) { console.error('[handleLogout]', e); }
    // Yerel durum + SSE oturum cookie'sini temizle (bayat veri kalmasın).
    setUser(null);
    storeSetUser(null);
    storeSetCompanyId(null);
    resetStream(); // SSE bağlantısı + bellekteki kiracı verisini temizle
    try { await authedFetch('/api/db/session/logout', { method: 'POST' }); } catch { /* ignore */ }
  };

  // --- Data Fetching ---
  useEffect(() => {
    if (!isAuthReady || !user || !userRole) return;
    if (mfaChallenge) return; // 2FA doğrulanana kadar tenant verisi yüklenmez

    // Data is scoped by companyId (= uid of the account owner).
    // Documents without a companyId field are legacy/test data and are excluded.
    const companyId = storeCompanyId ?? user.uid;

    const leadsQuery = (userRole === UserRole.Admin || userRole === UserRole.Manager)
      ? query(collection(db, 'leads'), where('companyId', '==', companyId))
      : query(collection(db, 'leads'), where('companyId', '==', companyId), where('assignedTo', '==', user.uid));
    const unsubLeads = onSnapshot(leadsQuery, (snapshot) => {
      setLeads(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Lead)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'leads', auth.currentUser?.uid));

    const ordersQuery = (userRole === UserRole.Dealer)
      ? query(collection(db, 'orders'), where('companyId', '==', companyId), where('assignedTo', '==', user.uid))
      : query(collection(db, 'orders'), where('companyId', '==', companyId));
    const unsubOrders = onSnapshot(ordersQuery, (snapshot) => {
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'orders', auth.currentUser?.uid));

    const unsubInventory = onSnapshot(query(collection(db, 'inventory'), where('companyId', '==', companyId)), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
      setInventory(items);

      // Düşük stok bildirimi: ürün-başına DEĞİL, TEK ÖZET bildirim (günde bir).
      // Önceki sürüm her düşük-stok ürün için ayrı POST atıyordu; 2000+ ürün
      // kritik olunca sunucuyu boğan bir fırtına yaratıyordu (429/503).
      const uid = auth.currentUser?.uid;
      const lowCount = items.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5)).length;
      const DAY = 24 * 60 * 60 * 1000;
      const last = Number(sessionStorage.getItem('lowStockNotifyAt') || 0);
      if (uid && lowCount > 0 && Date.now() - last > DAY) {
        sessionStorage.setItem('lowStockNotifyAt', String(Date.now()));
        void addDoc(collection(db, 'notifications'), {
          userId: uid,
          title: currentLanguage === 'tr' ? 'Düşük Stok Uyarısı' : 'Low Stock Alert',
          message: currentLanguage === 'tr'
            ? `${lowCount} ürün kritik stok seviyesinde.`
            : `${lowCount} product(s) at critical stock level.`,
          type: 'warning', read: false, createdAt: serverTimestamp(),
        }).catch(() => { /* non-critical */ });
      }
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'inventory', auth.currentUser?.uid));


    const unsubWarehouses = onSnapshot(collection(db, 'warehouses'), (snapshot) => {
      setWarehouses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Warehouse)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'warehouses', auth.currentUser?.uid));

    const unsubMovements = onSnapshot(query(collection(db, 'inventoryMovements'), where('companyId', '==', companyId), limit(200)), (snapshot) => {
      setInventoryMovements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryMovement)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'inventoryMovements', auth.currentUser?.uid));

    const unsubConsignments = onSnapshot(query(collection(db, 'consignments'), where('companyId', '==', companyId)), (snapshot) => {
      setConsignments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Consignment)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'consignments', auth.currentUser?.uid));

    const unsubDiscrepancies = onSnapshot(query(collection(db, 'stockDiscrepancies'), where('companyId', '==', companyId), where('resolved', '==', false), limit(100)), (snapshot) => {
      setStockDiscrepancies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockDiscrepancy)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'stockDiscrepancies', auth.currentUser?.uid));

    const unsubEmployees = onSnapshot(collection(db, 'employees'), (snapshot) => {
      setEmployees(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'employees', auth.currentUser?.uid));

    const unsubPayrolls = onSnapshot(collection(db, 'payrolls'), (snapshot) => {
      setPayrolls(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payroll)));
    }, () => { /* non-critical */ });

    const unsubShipments = onSnapshot(collection(db, 'shipments'), (snapshot) => {
      setShipments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shipment)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'shipments', auth.currentUser?.uid));

    // auditLog aboneliği ayrı, admin sekmesine gate'li bir effect'te (aşağıda)

    // ── Phase 110: Fetch purchaseOrders for AP Tracker ───────────────────────
    const unsubAPOrders = onSnapshot(collection(db, 'purchaseOrders'), (snapshot) => {
      setApPurchaseOrders(snapshot.docs.map(d => ({
        id: d.id, orderNumber: d.data().orderNumber || d.id.slice(0, 8),
        supplier: d.data().supplier || '—', totalAmount: d.data().totalAmount || 0,
        status: d.data().status || '', expectedDate: d.data().expectedDate,
        createdAt: d.data().createdAt
      })));
    }, () => { /* non-critical */ });

    // ── Phase 111: Support Tickets ────────────────────────────────────────────
    const unsubTickets = onSnapshot(query(collection(db, 'supportTickets'), limit(100)), (snapshot) => {
      setSupportTickets(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as typeof supportTickets[number])));
    }, () => { /* non-critical */ });

    // ── Phase 116: Contracts ──────────────────────────────────────────────────
    const unsubContracts = onSnapshot(collection(db, 'contracts'), (snapshot) => {
      setContracts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as typeof contracts[number])));
    }, () => { /* non-critical */ });

    // ── Phase 119: Recurring Orders ───────────────────────────────────────────
    const unsubRecurring = onSnapshot(collection(db, 'recurringOrders'), (snapshot) => {
      setRecurringOrders(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as typeof recurringOrders[number])));
    }, () => { /* non-critical */ });

    // ── Phase 121: Leave Requests ─────────────────────────────────────────────
    const unsubLeave = onSnapshot(query(collection(db, 'leaveRequests'), limit(100)), (snapshot) => {
      setLeaveRequests(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as typeof leaveRequests[number])));
    }, () => { /* non-critical */ });

    // ── Phase 122: Price Override Approvals ──────────────────────────────────
    const unsubPriceOverrides = onSnapshot(query(collection(db, 'priceOverrides'), limit(100)), (snapshot) => {
      setPriceOverrides(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as typeof priceOverrides[number])));
    }, () => { /* non-critical */ });

    // ── Phase 145: App-level quotations for Reports Dashboard ─────────────────
    const unsubAppQuotations = onSnapshot(query(collection(db, 'quotations'), limit(200)), (snapshot) => {
      setAppQuotations(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Quotation)));
    }, () => { /* non-critical */ });

    // ── userPrefs listener — dark mode, notif prefs, starred orders, quick note, recently viewed ──
    const unsubUserPrefs = onSnapshot(doc(db, 'userPrefs', user.uid), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.darkMode !== undefined && d.darkMode !== darkMode) { darkModeFromServerRef.current = true; setDarkMode(d.darkMode as boolean); }
      if (d.notifPrefs) setNotifPrefs(d.notifPrefs as Record<string, boolean>);
      if (typeof d.quickNote === 'string') setQuickNote(d.quickNote);
      if (Array.isArray(d.recentlyViewed)) setRecentlyViewed(d.recentlyViewed);
    }, () => { /* non-critical */ });

    // ── Monthly targets listener ──────────────────────────────────────────────
    const unsubTargets = onSnapshot(doc(db, 'settings', 'targets'), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data() as Record<string, number>;
      setMonthlyTargets(d);
      const curKey = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; })();
      if (d[curKey] !== undefined) setMonthlyTarget(d[curKey]);
    }, () => { /* non-critical */ });

    // ── Budget vs Actuals listener ────────────────────────────────────────────
    const unsubBudgets = onSnapshot(doc(db, 'settings', 'budgets'), (snap) => {
      if (!snap.exists()) return;
      setAllBudgetsFirestore(snap.data() as Record<string, BudgetEntry[]>);
    }, () => { /* non-critical */ });

    return () => {
      unsubLeads();
      unsubOrders();
      unsubInventory();
      unsubWarehouses();
      unsubMovements();
      unsubConsignments();
      unsubDiscrepancies();
      unsubEmployees();
      unsubPayrolls();
      unsubShipments();
      unsubAPOrders();
      unsubTickets();
      unsubContracts();
      unsubRecurring();
      unsubLeave();
      unsubPriceOverrides();
      unsubAppQuotations();
      unsubUserPrefs();
      unsubTargets();
      unsubBudgets();
    };
  }, [user, userRole, isAuthReady, storeCompanyId, mfaChallenge]);

  // ── auditLog: yalnızca Admin > Denetim Kaydı açıkken dinle ────────────────
  useEffect(() => {
    if (!user || activeTab !== 'admin') return;
    const companyId = storeCompanyId ?? user.uid;
    const unsub = onSnapshot(
      query(collection(db, 'auditLog'), where('companyId', '==', companyId), orderBy('timestamp', 'desc'), limit(100)),
      (snapshot) => setAuditLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))),
      (error) => importedLogFirestoreError(error, OperationType.LIST, 'auditLog', auth.currentUser?.uid)
    );
    return () => unsub();

  }, [user, activeTab, storeCompanyId]);

  // ── Phase extended collections — Firestore subscriptions ─────────────────
  useEffect(() => {
    if (!user) return;
    const u: (() => void)[] = [];
    const sub = (col: string, setter: (d: unknown[]) => void) =>
      u.push(onSnapshot(collection(db, col), s => setter(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => setter([])));

    sub('projectCosts',    (d) => setP582Projects(d as typeof p582Projects));
    sub('workflowTasks',   (d) => setP595Tasks(d as typeof p595Tasks));
    sub('revenueContracts',(d) => setP597Contracts(d as typeof p597Contracts));
    sub('capacityLines',   (d) => setP605Capacity(d as typeof p605Capacity));
    sub('projectTimelines',(d) => setP618Projects(d as typeof p618Projects));
    sub('demandRequests',  (d) => setP621Demands(d as typeof p621Demands));
    sub('letterOfCredit',  (d) => setP623LCs(d as typeof p623LCs));
    sub('productionOrders',(d) => setP624Orders(d as typeof p624Orders));
    sub('returns',         (d) => setP639Returns(d as typeof p639Returns));
    sub('recurringBilling',(d) => setP640Subs(d as typeof p640Subs));
    sub('warranties',      (d) => setP642Warranties(d as typeof p642Warranties));
    sub('intercompanyTxns',(d) => setP643Txns(d as typeof p643Txns));

    return () => u.forEach(fn => fn());
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Customer Risk Scoring — writes to customerRisks collection ──────────
  useEffect(() => {
    if (!user || leads.length === 0) return;
    // Günlük throttle: SSE her snapshot'ta leads referansını yeniler; throttle
    // olmadan her yüklemede 187 PUT atılıp gereksiz yük oluşuyordu.
    const lastRisk = Number(sessionStorage.getItem('riskScoreAt') || 0);
    if (Date.now() - lastRisk < 24 * 60 * 60 * 1000) return;
    // Debounce: only run 3 s after last lead/order change to avoid write storms
    const timer = setTimeout(async () => {
      sessionStorage.setItem('riskScoreAt', String(Date.now()));
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

          // İzlenecek bir şey yoksa (sipariş yok + bakiye 0 + limit 0) yazma —
          // gereksiz kayıt/PUT'tan kaçın.
          if (customerOrders.length === 0 && totalBalance === 0 && creditLimit === 0) continue;

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

  const handleAddShipmentSubmit = async (formData: Partial<Shipment>) => {
    if (!user) return;
    try {
      if (editingShipmentId) {
        await updateDoc(doc(db, 'shipments', editingShipmentId), {
          ...formData,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'shipments'), {
          ...formData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      setEditingShipmentId(null);
      setIsAddingShipment(false);
    } catch (error) {
      handleFirestoreError(error, editingShipmentId ? OperationType.UPDATE : OperationType.CREATE, 'shipments');
    }
  };

  const handleAddLead = async (data: NewLeadData) => {
    if (!user) return;

    // Duplicate onleme: VKN (rakam-disi karakterler yok sayilarak normalize) ->
    // case-insensitive isim/sirket. PurchasingModule'deki tedarikci deseniyle
    // ayni oncelik sirasi (VKN en guvenilir kimlik, isim en zayif).
    const normalizeVkn = (v?: string) => (v || '').replace(/\D/g, '');
    const vkn = normalizeVkn(data.taxId);
    const nameKey = data.name.trim().toLowerCase();
    const companyKey = (data.company || '').trim().toLowerCase();
    const existingLead = leads.find(l => {
      const lVkn = normalizeVkn((l as unknown as { taxId?: string }).taxId);
      if (vkn && lVkn === vkn) return true;
      const lName = (l.name || '').trim().toLowerCase();
      if (nameKey && lName === nameKey) return true;
      const lCompany = ((l as unknown as { company?: string }).company || '').trim().toLowerCase();
      if (companyKey && lCompany && lCompany === companyKey) return true;
      return false;
    });
    if (existingLead) {
      toast(
        currentLanguage === 'tr'
          ? `Bu VKN/isimde bir kayıt zaten var: "${existingLead.name}". Lütfen mevcut kaydı düzenleyin.`
          : `A record with this tax ID/name already exists: "${existingLead.name}". Please edit the existing record instead.`,
        'error'
      );
      return;
    }

    // Gemini AI (lead skorlama) yalnizca kullanici aydinlatma metni + kullanim
    // kosullarini onaylamissa calisir - onay yoksa modal gosterilir ve lead
    // AI skorlamasi olmadan (0 / not yok) olusturulur; CRM'in temel islevi
    // (lead ekleme) bir AI onay karari yuzunden engellenmez.
    const useAi = aiConsentChecked && aiConsentGiven;
    if (aiConsentChecked && !aiConsentGiven) setShowAiConsentModal(true);

    setIsScoring(true);
    try {
      const scoreResult = useAi ? await scoreLead(data) : { score: 0, reasoning: '' };
      const docRef = await addDoc(collection(db, 'leads'), {
        ...data, status: 'New', score: scoreResult.score,
        notes: useAi ? `${data.notes ?? ''}\n\nAI Insights: ${scoreResult.reasoning}` : (data.notes ?? ''),
        companyId: storeCompanyId ?? user?.uid ?? 'guest',
        assignedTo: user?.uid ?? 'guest', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        customerType: 'B2B' as const,
      });
      createNotification(
        currentLanguage === 'tr' ? 'Yeni Müşteri Adayı' : 'New Lead',
        `${data.name}${data.company ? ` — ${data.company}` : ''} ${currentLanguage === 'tr' ? 'eklendi' : 'added'}${useAi ? ` (AI Skor: ${scoreResult.score}/100)` : ''}`,
        'info'
      ).catch(() => {});
      if (leadFromOrderRef.current) {
        const freshLead = { id: docRef.id, ...data, status: 'New' as const, score: scoreResult.score, assignedTo: user?.uid ?? 'guest', customerType: 'B2B' as const };
        setNewOrder(prev => ({ ...prev, customerName: data.name, shippingAddress: data.company || '' }));
        setOrderCustomerSearch(data.name);
        setSelectedLead(freshLead as unknown as Lead);
        leadFromOrderRef.current = false;
      }
      setIsAddingLead(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'leads');
    } finally {
      setIsScoring(false);
    }
  };

  // ── Generic sort helper ──────────────────────────────────────────────────

  const handleAddOrder = async (
    newOrder: Partial<Order>,
    orderLineItems: OrderLineItem[],
    computedTotal: number
  ) => {
    const customerName = selectedLead ? selectedLead.name : newOrder.customerName || 'Unknown Customer';
    const email = selectedLead ? selectedLead.email : undefined;

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
          companyId: storeCompanyId ?? user?.uid ?? null,
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

          // ── Resmi (faturalı) satış → Mikro'ya sipariş kaydı ─────────────────
          // Faturasız işlemler Mikro'ya GİTMEZ — stok takibi yalnızca yerelde
          // kalır (çift stok kontrolü: resmi stok Mikro'da, gayriresmi yerelde).
          if (selectedLead) {
            try {
              const orderForMikro = {
                ...newOrder,
                customerName,
                totalPrice:   finalTotal,
                lineItems:    orderLineItems,
                mikroCariKod: (selectedLead as unknown as Record<string, unknown>).mikroCariKod,
              } as unknown as Record<string, unknown>;
              const { cariResult, orderResult } = await syncOrderWithCari(
                selectedLead as unknown as Record<string, unknown>,
                selectedLead.id,
                orderForMikro,
                orderDocRef.id
              );
              if (orderResult.success) {
                logAuditAction('Mikro Sipariş Kaydı', `${customerName} — resmi sipariş Mikro'ya kaydedildi (${orderResult.mikroEvrakNo ?? 'evrak no yok'})`);
                toast(currentLanguage === 'tr' ? `Sipariş Mikro'ya kaydedildi ✓` : 'Order synced to Mikro ✓', 'success');
              } else if (!orderResult.notConfigured) {
                logAuditAction('Mikro Sipariş Hatası', `${customerName} — ${orderResult.error ?? cariResult.error ?? 'bilinmeyen hata'}`);
                toast(currentLanguage === 'tr' ? `Mikro kaydı başarısız: ${orderResult.error ?? ''}` : `Mikro sync failed: ${orderResult.error ?? ''}`, 'error');
              }
            } catch (mikroErr) {
              console.warn('Mikro sipariş kaydı başarısız:', mikroErr);
            }
          }
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'orders');
      }

      // AddOrderModal handles closing its own state
    } catch (error) {
      console.error("Error adding order:", error);
    }
  };

  // Sipariş kalemlerine göre stok hareketi uygular ve inventoryMovements'a loglar.
  // direction 'out' = sevkiyatta düş, 'in' = iptal/iade'de geri yükle. Idempotent
  // değil — çağıran stockApplied flag'iyle çift uygulamayı engeller.
  const applyOrderStockMovement = async (order: Order, direction: 'out' | 'in', reason: string) => {
    for (const li of (order.lineItems || []) as unknown as Array<Record<string, unknown>>) {
      const invId = li.inventoryId as string | undefined;
      const qty = Number(li.quantity) || 0;
      if (!invId || qty <= 0) continue;
      const inv = inventory.find(i => i.id === invId);
      if (!inv) continue;
      try {
        // Atomik artırma (yarış koşulu yok); 'out' min 0'a clamp'lenir.
        await incrementField('inventory', invId, 'stockLevel', direction === 'out' ? -qty : qty, 0);
        await addDoc(collection(db, 'inventoryMovements'), {
          type: direction, productId: invId,
          productName: inv.name || (li.name as string) || (li.title as string) || invId,
          quantity: qty, reason, orderId: order.id,
          companyId: storeCompanyId ?? user?.uid ?? null,
          timestamp: serverTimestamp(),
        });
      } catch (err) { console.error('[applyOrderStockMovement]', err); }
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, status: Order['status']) => {
    try {
      // Phase 101: append timeline entry
      const ord101r = orders.find(o => o.id === orderId) as unknown as Record<string, unknown> | undefined;
      const prevTimeline = Array.isArray(ord101r?.timeline)
        ? ord101r!.timeline as { action: string; actor: string; ts: number }[]
        : [];
      const newEntry = { action: `Durum: ${status}`, actor: user?.displayName || user?.email || 'Sistem', ts: Date.now() };
      const updatedTimeline = [...prevTimeline, newEntry];
      await updateDoc(doc(db, 'orders', orderId), { status, timeline: updatedTimeline });
      logAuditAction(currentT.order_status_update, `${currentT.order} #${orderId} ${currentT.order_status_updated_to.replace('{0}', currentT[status.toLowerCase()] || status)}`);

      // ── Stok hareketi: sevkiyatta düş, iptalde geri yükle (idempotent) ──────
      {
        const ordStk = orders.find(o => o.id === orderId);
        const applied = (ordStk as unknown as Record<string, unknown> | undefined)?.stockApplied === true;
        if (ordStk && !applied && (status === 'Shipped' || status === 'Delivered')) {
          await applyOrderStockMovement(ordStk, 'out', currentLanguage === 'tr' ? 'Sevkiyat' : 'Shipment');
          await updateDoc(doc(db, 'orders', orderId), { stockApplied: true });
        } else if (ordStk && applied && status === 'Cancelled') {
          await applyOrderStockMovement(ordStk, 'in', currentLanguage === 'tr' ? 'Sipariş iptali' : 'Order cancelled');
          await updateDoc(doc(db, 'orders', orderId), { stockApplied: false });
        }
      }

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
          authFetch('/api/mikro/irsaliye/kaydet', {
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
          authFetch('/api/whatsapp/order-notification', {
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
    try {
      const lead = leads.find(l => l.id === order.leadId);
      const r = await authFetch('/api/mikro/fatura/kaydet', {
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
    }
  };

  // ── iyzico: generate payment link ─────────────────────────────────────────
  const handleIyzicoPaymentLink = async (order: Order) => {
    try {
      const lead = leads.find(l => l.id === order.leadId);
      const r = await authFetch('/api/iyzico/payment-link', {
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
    }
  };

  const handleEditLeadSubmit = async (updatedData: Partial<Lead>) => {
    if (!selectedLead) return;
    try {
      await updateDoc(doc(db, 'leads', selectedLead.id), { ...updatedData, updatedAt: serverTimestamp() });
      setSelectedLead({ ...selectedLead, ...updatedData } as Lead);
      setIsEditingLead(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leads/${selectedLead.id}`);
    }
  };

  const handleEditOrderSubmit = async (updatedData: Partial<Order>) => {
    if (!selectedOrder) return;
    try {
      await updateDoc(doc(db, 'orders', selectedOrder.id), { ...updatedData, updatedAt: serverTimestamp() });
      setSelectedOrder({ ...selectedOrder, ...updatedData } as Order);
      setIsEditingOrder(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${selectedOrder.id}`);
    }
  };

  // ── Phase 89 + Phase 532: Toggle order payment status (with method picker) ──
  const handleToggleOrderPaid = (order: Order) => {
    if (!order.paid) {
      // Phase 532: show payment method picker before marking as paid
      setP532PayOrder(order);
      setP532Method('bank_transfer');
    } else {
      // Mark as unpaid directly (no method needed)
      updateDoc(doc(db, 'orders', order.id), { paid: false, paidAt: null, paymentMethod: null })
        .then(() => toast(currentLanguage === 'tr' ? 'Ödeme bekliyor olarak işaretlendi' : 'Marked as unpaid', 'info'))
        .catch(err => handleFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`));
    }
  };
  const handleConfirmPayment = async () => {
    if (!p532PayOrder) return;
    try {
      await updateDoc(doc(db, 'orders', p532PayOrder.id), {
        paid: true,
        paidAt: serverTimestamp(),
        paymentMethod: p532Method,
      });
      toast(currentLanguage === 'tr' ? '✓ Ödeme alındı' : '✓ Payment recorded', 'success');
      setP532PayOrder(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${p532PayOrder.id}`);
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
          <React.Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-white"><div className="w-8 h-8 rounded-full border-2 border-[#ff4000] border-t-transparent animate-spin" /></div>}>
          <LandingPage
            currentLanguage={currentLanguage}
            onLoginClick={() => setShowLoginPage(true)}
            onTryClick={() => {
              if (user) setEnteredApp(true);
              else setShowDemoForm(true);
            }}
            onDashboardClick={() => setEnteredApp(true)}
            heroImageUrl="/erp_hero.webp"
            isLoggedIn={!!user}
            onLanguageToggle={() => setCurrentLanguage(currentLanguage === 'tr' ? 'en' : 'tr')}
            darkMode={darkMode}
            onDarkModeToggle={() => setDarkMode(!darkMode)}
          />
          </React.Suspense>

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
            <div className="px-10 pt-10 pb-6 text-center">
              <div className="flex justify-center mb-5">
                <img src="/cetpalogo.avif" alt="CETPA" className="h-12 w-auto object-contain drop-shadow-sm" />
              </div>
              <h1 className={cn("text-2xl font-black tracking-tight mb-1", darkMode ? "text-[#f5f5f7]" : "text-[#1D1D1F]")}>
                {authMode === 'signup'
                  ? (currentLanguage === 'tr' ? 'Hesap Oluştur' : 'Create Account')
                  : authMode === 'reset'
                  ? (currentLanguage === 'tr' ? 'Şifre Sıfırla' : 'Reset Password')
                  : (currentLanguage === 'tr' ? 'Hoş Geldiniz' : 'Welcome Back')}
              </h1>
              <p className={cn("text-sm font-medium", darkMode ? "text-white/50" : "text-gray-500")}>
                CETPA Cloud ERP
              </p>
            </div>

            {/* Mode tabs */}
            <div className="px-10 mb-4">
              <div className={cn("flex rounded-2xl p-1 gap-1", darkMode ? "bg-white/5" : "bg-gray-100")}>
                {(['signin','signup'] as const).map(m => (
                  <button key={m} onClick={() => { setAuthMode(m); setAuthError(null); setResetSent(false); }}
                    className={cn("flex-1 py-2 rounded-xl text-xs font-black transition-all",
                      authMode === m
                        ? "bg-brand text-white shadow-sm"
                        : darkMode ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-700"
                    )}>
                    {m === 'signin' ? (currentLanguage === 'tr' ? 'Giriş Yap' : 'Sign In') : (currentLanguage === 'tr' ? 'Kayıt Ol' : 'Sign Up')}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-10 pb-8 space-y-4">
              {/* ── PASSWORD RESET mode ── */}
              {authMode === 'reset' && (
                resetSent
                  ? <div className="text-center py-4 space-y-3">
                      <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                        <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      </div>
                      <p className={cn("text-sm font-semibold", darkMode ? "text-white" : "text-gray-800")}>
                        {currentLanguage === 'tr' ? 'Sıfırlama bağlantısı e-postanıza gönderildi.' : 'Reset link sent to your email.'}
                      </p>
                      <button onClick={() => { setAuthMode('signin'); setResetSent(false); }} className="text-brand text-sm font-black hover:underline">
                        {currentLanguage === 'tr' ? '← Giriş Yap' : '← Back to Sign In'}
                      </button>
                    </div>
                  : <form onSubmit={handlePasswordReset} className="space-y-4">
                      <p className={cn("text-xs", darkMode ? "text-white/50" : "text-gray-500")}>
                        {currentLanguage === 'tr' ? 'E-posta adresinizi girin, sıfırlama bağlantısı gönderelim.' : 'Enter your email and we\'ll send a reset link.'}
                      </p>
                      <input type="email" value={emailLogin.email}
                        onChange={(e) => setEmailLogin(prev => ({ ...prev, email: e.target.value }))}
                        placeholder={currentLanguage === 'tr' ? 'örnek@cetpa.com' : 'example@cetpa.com'}
                        className={cn("w-full rounded-2xl px-5 py-3.5 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-medium", darkMode ? "bg-white/5 border border-white/10 text-[#f5f5f7] placeholder-white/20" : "bg-gray-50/50 border border-gray-200 text-[#1D1D1F] placeholder-gray-400")}
                        autoComplete="email" autoFocus />
                      <button type="submit" disabled={isEmailLoginLoading}
                        className="w-full font-black py-3.5 px-6 rounded-2xl transition-all disabled:opacity-60 text-sm active:scale-[0.98] bg-brand hover:bg-brand/90 text-white shadow-lg outline-none">
                        {isEmailLoginLoading ? '...' : (currentLanguage === 'tr' ? 'SIFIRLAMA BAĞLANTISI GÖNDER' : 'SEND RESET LINK')}
                      </button>
                      <button type="button" onClick={() => { setAuthMode('signin'); setAuthError(null); }}
                        className={cn("w-full text-sm font-semibold", darkMode ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-600")}>
                        {currentLanguage === 'tr' ? '← Giriş Yap' : '← Back to Sign In'}
                      </button>
                    </form>
              )}

              {/* ── SIGN UP mode ── */}
              {authMode === 'signup' && (
                <form onSubmit={handleEmailSignUp} className="space-y-3">
                  {[
                    { key: 'name', label: currentLanguage === 'tr' ? 'AD SOYAD' : 'FULL NAME', type: 'text', ac: 'name' },
                    { key: 'email', label: currentLanguage === 'tr' ? 'E-POSTA' : 'EMAIL', type: 'email', ac: 'email' },
                    { key: 'password', label: currentLanguage === 'tr' ? 'ŞİFRE (min 8)' : 'PASSWORD (min 8)', type: 'password', ac: 'new-password' },
                    { key: 'confirm', label: currentLanguage === 'tr' ? 'ŞİFRE TEKRAR' : 'CONFIRM PASSWORD', type: 'password', ac: 'new-password' },
                  ].map(f => (
                    <div key={f.key} className="space-y-1">
                      <label className={cn("text-[10px] font-black uppercase tracking-widest ml-1", darkMode ? "text-white/30" : "text-gray-400")}>{f.label}</label>
                      <input type={f.type} value={signupForm[f.key as keyof typeof signupForm]}
                        onChange={(e) => setSignupForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                        className={cn("w-full rounded-xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-medium", darkMode ? "bg-white/5 border border-white/10 text-[#f5f5f7] placeholder-white/20" : "bg-gray-50/50 border border-gray-200 text-[#1D1D1F] placeholder-gray-400")}
                        autoComplete={f.ac} />
                    </div>
                  ))}
                  <button type="submit" disabled={isEmailLoginLoading}
                    className="w-full font-black py-3.5 px-6 rounded-2xl transition-all disabled:opacity-60 text-sm active:scale-[0.98] bg-brand hover:bg-brand/90 text-white shadow-lg outline-none mt-1">
                    {isEmailLoginLoading ? '...' : (currentLanguage === 'tr' ? 'HESAP OLUŞTUR' : 'CREATE ACCOUNT')}
                  </button>
                  <p className={cn("text-[10px] text-center", darkMode ? "text-white/30" : "text-gray-400")}>
                    {currentLanguage === 'tr' ? 'Kayıt olarak ' : 'By registering you agree to our '}
                    <span className="text-brand">{currentLanguage === 'tr' ? 'Kullanım Koşulları' : 'Terms of Service'}</span>
                    {currentLanguage === 'tr' ? "'nı kabul etmiş olursunuz." : '.'}
                  </p>
                </form>
              )}

              {/* ── SIGN IN mode ── */}
              {authMode === 'signin' && (
                <form onSubmit={handleEmailSignIn} className="space-y-3">
                  <div className="space-y-1">
                    <label className={cn("text-[10px] font-black uppercase tracking-widest ml-1", darkMode ? "text-white/30" : "text-gray-400")}>
                      {currentLanguage === 'tr' ? 'E-POSTA ADRESİ' : 'EMAIL ADDRESS'}
                    </label>
                    <input type="email" value={emailLogin.email}
                      onChange={(e) => setEmailLogin(prev => ({ ...prev, email: e.target.value }))}
                      placeholder={currentLanguage === 'tr' ? 'örnek@cetpa.com' : 'example@cetpa.com'}
                      className={cn("w-full rounded-xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-medium", darkMode ? "bg-white/5 border border-white/10 text-[#f5f5f7] placeholder-white/20" : "bg-gray-50/50 border border-gray-200 text-[#1D1D1F] placeholder-gray-400")}
                      autoComplete="email" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between ml-1">
                      <label className={cn("text-[10px] font-black uppercase tracking-widest", darkMode ? "text-white/30" : "text-gray-400")}>
                        {currentLanguage === 'tr' ? 'ŞİFRE' : 'PASSWORD'}
                      </label>
                      <button type="button" onClick={() => { setAuthMode('reset'); setAuthError(null); }}
                        className="text-[10px] font-bold text-brand hover:underline">
                        {currentLanguage === 'tr' ? 'Şifremi Unuttum' : 'Forgot password?'}
                      </button>
                    </div>
                    <input type="password" value={emailLogin.password}
                      onChange={(e) => setEmailLogin(prev => ({ ...prev, password: e.target.value }))}
                      placeholder="••••••••"
                      className={cn("w-full rounded-xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-medium", darkMode ? "bg-white/5 border border-white/10 text-[#f5f5f7] placeholder-white/20" : "bg-gray-50/50 border border-gray-200 text-[#1D1D1F] placeholder-gray-400")}
                      autoComplete="current-password" />
                  </div>
                  <button type="submit" disabled={isEmailLoginLoading}
                    className="w-full font-black py-3.5 px-6 rounded-2xl transition-all disabled:opacity-60 text-sm active:scale-[0.98] bg-[#1D1D1F] hover:bg-black text-white shadow-xl shadow-black/20 outline-none">
                    {isEmailLoginLoading ? (currentLanguage === 'tr' ? 'GİRİŞ YAPILIYOR...' : 'SIGNING IN...') : (currentLanguage === 'tr' ? 'GİRİŞ YAP' : 'SIGN IN')}
                  </button>
                </form>
              )}

              {authError && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 text-center">
                  {authError}
                </motion.p>
              )}

              {/* Divider */}
              {authMode !== 'reset' && (
                <>
                  <div className="relative flex items-center gap-4 py-1">
                    <div className={cn("flex-1 h-px", darkMode ? "bg-white/10" : "bg-gray-100")} />
                    <span className={cn("text-[11px] font-bold uppercase tracking-widest", darkMode ? "text-white/20" : "text-gray-300")}>
                      {currentLanguage === 'tr' ? 'veya' : 'OR'}
                    </span>
                    <div className={cn("flex-1 h-px", darkMode ? "bg-white/10" : "bg-gray-100")} />
                  </div>
                  {/* Google */}
                  <button onClick={handleLogin}
                    className={cn("w-full flex items-center justify-center gap-3 font-bold py-3.5 px-6 rounded-2xl transition-all shadow-sm group active:scale-[0.98]", darkMode ? "bg-white/5 hover:bg-white/10 border border-white/10 text-[#f5f5f7]" : "bg-white hover:bg-gray-50 border border-gray-200 text-[#1D1D1F]")}>
                    <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    {currentT.sign_in_google || 'Google ile Devam Et'}
                  </button>
                </>
              )}
            </div>
          </div>

          <p className={cn("text-center text-xs mt-4", darkMode ? "text-white/20" : "text-gray-400")}>
            © 2026 CETPA · {currentT.authorized_only || 'Authorized Personnel Only'}
          </p>
        </motion.div>
      </div>
    );
  }

  // ─── Onboarding Gate: Show onboarding for new users ───────────────────
  if (user && subscriptionLoaded && !userSubscription && !isGuestMode && !showPricingPage && !isOwnerAdmin) {
    return (
      <React.Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-white"><div className="w-8 h-8 rounded-full border-2 border-[#ff4000] border-t-transparent animate-spin" /></div>}>
        <OnboardingFlow
          currentLanguage={currentLanguage}
          onComplete={handleOnboardingComplete}
        />
      </React.Suspense>
    );
  }

  // ─── Pricing Page (full screen) ───────────────────────────────────────
  if (showPricingPage) {
    return (
      <React.Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-white"><div className="w-8 h-8 rounded-full border-2 border-[#ff4000] border-t-transparent animate-spin" /></div>}>
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
            }
          }}
        />
      </React.Suspense>
    );
  }

  // Tüm sekme/alt-modül id'leri için tek kaynak etiket lookup'ı (header + hata sınırı)
  const tabLabelOf = (id: string): string => (({
    dashboard: currentT.dashboard, crm: currentLanguage === 'tr' ? 'CRM & Satış' : 'CRM & Sales',
    inventory: currentT.inventory, lojistik: currentLanguage === 'tr' ? 'Lojistik & Depo' : 'Logistics',
    muhasebe: currentLanguage === 'tr' ? 'Muhasebe' : 'Accounting', 'satin-alma': currentLanguage === 'tr' ? 'Satın Alma' : 'Purchasing',
    ik: currentLanguage === 'tr' ? 'İK' : 'HR', hukuk: currentLanguage === 'tr' ? 'Hukuk' : 'Legal',
    proje: currentLanguage === 'tr' ? 'Projeler' : 'Projects', production: currentLanguage === 'tr' ? 'Üretim' : 'Production',
    kalite: currentLanguage === 'tr' ? 'Kalite' : 'Quality', kurumsal: currentLanguage === 'tr' ? 'Kurumsal' : 'Governance',
    b2b: 'B2B Portal', risk: 'Risk', reports: currentT.reports, onaylar: currentLanguage === 'tr' ? 'Onaylar' : 'Approvals',
    admin: currentT.admin, settings: currentLanguage === 'tr' ? 'Ayarlar' : 'Settings',
    ebelge: currentLanguage === 'tr' ? 'E-Belge Merkezi' : 'E-Document Hub', vergi: currentLanguage === 'tr' ? 'Vergi Takvimi' : 'Tax Calendar',
    ihracat: currentLanguage === 'tr' ? 'İthalat/İhracat' : 'Import/Export', lotseri: currentLanguage === 'tr' ? 'Lot/Seri Takip' : 'Lot/Serial',
    bakim: currentLanguage === 'tr' ? 'Bakım-Onarım' : 'Maintenance', sube: currentLanguage === 'tr' ? 'Şubeler' : 'Branches',
    servis: currentLanguage === 'tr' ? 'Servis' : 'After-Sales Service', iade: currentLanguage === 'tr' ? 'İade & Değişim' : 'Returns (RMA)',
    orders: currentLanguage === 'tr' ? 'Siparişler' : 'Orders', mesai: currentLanguage === 'tr' ? 'Mesai & Devam' : 'Time & Attendance',
    selfservis: currentLanguage === 'tr' ? 'Self-Servis Portalı' : 'Self-Service Portal',
    cpq: currentLanguage === 'tr' ? 'CPQ Teklif' : 'CPQ Quote', dunning: currentLanguage === 'tr' ? 'Tahsilat Takip' : 'Dunning',
    finance: currentLanguage === 'tr' ? 'Finans Paneli' : 'Finance Panel', gelirtanima: currentLanguage === 'tr' ? 'IFRS 15 Gelir Tanıma' : 'IFRS 15 Rev. Rec.',
    holding: currentLanguage === 'tr' ? 'Holding Yönetimi' : 'Holding', mobilewms: currentLanguage === 'tr' ? 'Mobil WMS' : 'Mobile WMS',
    mrp: 'MRP II', muhtasar: currentLanguage === 'tr' ? 'Muhtasar' : 'Withholding', performans: currentLanguage === 'tr' ? 'Performans' : 'Performance',
    territory: currentLanguage === 'tr' ? 'Satış Bölgeleri' : 'Territories',
  } as Record<string, string>)[id] || id);

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
                <img src={logoUrl || '/cetpalogo.avif'} alt="Logo" className="h-8 w-auto max-w-[160px] object-contain" />
                {isUploadingLogo && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60 rounded">
                    <Clock className="w-4 h-4 animate-spin text-brand" />
                  </div>
                )}
                {userRole === 'Admin' && (
                  <label className="absolute -bottom-1.5 -right-1.5 bg-brand rounded-full p-1 shadow-md ring-2 ring-white cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity z-10" onClick={e => e.stopPropagation()} title={currentLanguage === 'tr' ? 'Şirket logosunu yükle' : 'Upload company logo'}>
                    <Upload className="w-3 h-3 text-white" />
                    <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/avif,image/webp" className="hidden" onChange={handleLogoUpload} />
                  </label>
                )}
              </div>
            </button>

            {/* Active tab label */}
            <span className={cn("font-semibold text-sm truncate hidden sm:block", darkMode ? "text-white/90" : "text-gray-900")}>
              {tabLabelOf(activeTab)}
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
              <div className="relative w-8 h-8 flex-shrink-0">
                {/* Taban: baş harf — foto yüklenmezse/hatalıysa bu görünür */}
                <div className={cn("absolute inset-0 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center", darkMode && "border-brand/40")}>
                  <span className="text-xs font-bold text-brand">{(user?.displayName || user?.email || 'M')[0].toUpperCase()}</span>
                </div>
                {user?.photoURL && (
                  <img src={user.photoURL} referrerPolicy="no-referrer" loading="lazy"
                    onError={e => { e.currentTarget.style.display = 'none'; }}
                    className={cn("absolute inset-0 w-8 h-8 rounded-full border-2 shadow-sm object-cover", darkMode ? "border-white/20" : "border-black/10")} alt="User" />
                )}
              </div>
              {user && (
                <button onClick={() => setShowMfaSettings(true)} title={currentLanguage === 'tr' ? 'Güvenlik (2FA)' : 'Security (2FA)'}
                  className={cn("p-1.5 transition-colors flex-shrink-0 rounded-xl", darkMode ? "text-white/40 hover:text-emerald-400 hover:bg-white/10" : "text-gray-400 hover:text-emerald-600 hover:bg-emerald-50")}>
                  <ShieldCheck className="w-4 h-4" />
                </button>
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
                  { id: 'onaylar', label: currentLanguage === 'tr' ? 'Onaylar' : 'Approvals', icon: CheckCircle2 },
                  ...(userRole === 'Admin' || isOwnerAdmin ? [{ id: 'admin', label: currentT.admin, icon: Shield }] : []),
                  ...(userRole === 'Admin' || userRole === 'Manager' || isOwnerAdmin ? [{ id: 'settings', label: currentLanguage === 'tr' ? 'Ayarlar' : 'Settings', icon: Settings }] : [])
                ] as { id: string; label: string; icon: React.ElementType }[]).filter(tab => canAccess(tab.id)).map(tab => {
                  const navChildOf: Record<string,string> = { lotseri:'production', bakim:'production', ihracat:'lojistik', ebelge:'muhasebe', vergi:'muhasebe', sube:'crm', servis:'crm', iade:'crm', orders:'crm', mesai:'ik', selfservis:'ik', territory:'crm', cpq:'crm', performans:'ik', dunning:'muhasebe', mrp:'inventory', holding:'muhasebe', muhtasar:'ik', mobilewms:'lojistik', gelirtanima:'muhasebe' };
                  const isActive = activeTab === tab.id || navChildOf[activeTab] === tab.id;
                  const isLocked = !isGuestMode && userSubscription && !canAccessBySubscription(tab.id);
                  // Phase 30 — tab count badges
                  const badgeCount = tab.id === 'orders'
                    ? orders.filter(o => o.status === 'Pending').length
                    : tab.id === 'crm'
                      ? leads.filter(l => l.status === 'New').length
                      : tab.id === 'inventory'
                        ? inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5)).length
                        : tab.id === 'onaylar'
                          ? pendingApprovalsCount
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

      {/* ── Left Sidebar + Content Wrapper ── */}
      <div className="flex">

        {/* ── Persistent Left Sidebar (desktop only) ── */}
        {(() => {
          type SidebarItem = { label: string; subId: string; action: () => void };
          type SidebarGroup = {
            id: string; label: string; icon: React.ElementType;
            childIds?: string[];
            children?: SidebarItem[];
          };
          const tr = currentLanguage === 'tr';
          const sidebarGroups: SidebarGroup[] = [
            { id: 'dashboard', label: tr ? 'Panel' : 'Dashboard', icon: LayoutDashboard },
            {
              id: 'crm', label: tr ? 'CRM & Satış' : 'CRM & Sales', icon: Users,
              childIds: ['sube', 'servis', 'iade', 'orders', 'territory', 'cpq'],
              children: [
                { label: tr ? 'Müşteri Adayları' : 'Leads',       subId: 'leads',       action: () => { setActiveTab('crm'); setCrmTab('leads'); } },
                { label: tr ? 'Müşteriler' : 'Customers',          subId: 'musteriler',  action: () => { setActiveTab('crm'); setCrmTab('musteriler'); } },
                { label: tr ? 'Siparişler' : 'Orders',             subId: 'orders',      action: () => setActiveTab('orders') },
                { label: tr ? 'İade & Değişim' : 'Returns (RMA)', subId: 'iade',        action: () => setActiveTab('iade') }, // Phase 549
                { label: tr ? 'Pipeline' : 'Pipeline',             subId: 'pipeline',    action: () => { setActiveTab('crm'); setCrmTab('pipeline'); } },
                { label: tr ? 'Kampanyalar' : 'Campaigns',         subId: 'kampanya',    action: () => { setActiveTab('crm'); setCrmTab('kampanya'); } },
                { label: tr ? 'Sözleşmeler' : 'Contracts',         subId: 'sozlesmeler', action: () => { setActiveTab('crm'); setCrmTab('sozlesmeler'); } },
                { label: tr ? 'Destek Talepleri' : 'Support',      subId: 'tickets',     action: () => { setActiveTab('crm'); setCrmTab('tickets'); } },
                { label: tr ? 'Hedefler' : 'Targets',              subId: 'hedefler',    action: () => { setActiveTab('crm'); setCrmTab('hedefler'); } },
                { label: tr ? 'Komisyon' : 'Commission',           subId: 'komisyon',    action: () => { setActiveTab('crm'); setCrmTab('komisyon'); } },
                { label: tr ? 'Satış Bölgeleri' : 'Territories',  subId: 'territory',   action: () => setActiveTab('territory') },
                { label: tr ? 'CPQ Teklif' : 'CPQ',               subId: 'cpq',         action: () => setActiveTab('cpq') },
                { label: tr ? 'Şubeler' : 'Branches',              subId: 'sube',        action: () => setActiveTab('sube') },
                { label: tr ? 'Servis' : 'After-Sales',            subId: 'servis',      action: () => setActiveTab('servis') },
              ],
            },
            {
              id: 'inventory', label: tr ? 'Envanter' : 'Inventory', icon: List,
              childIds: ['lotseri', 'bakim', 'mrp', 'fiyat-istihbarat'],
              children: [
                { label: tr ? 'Stok Yönetimi' : 'Stock Mgmt',     subId: 'inventory', action: () => setActiveTab('inventory') },
                { label: tr ? 'Lot / Seri Takip' : 'Lot/Serial',  subId: 'lotseri',   action: () => setActiveTab('lotseri') },
                { label: tr ? 'Bakım-Onarım' : 'Maintenance',     subId: 'bakim',     action: () => setActiveTab('bakim') },
                { label: tr ? 'MRP II / Kapasite' : 'MRP II',     subId: 'mrp',       action: () => setActiveTab('mrp') },
                { label: tr ? 'Fiyat İstihbaratı' : 'Price Intel', subId: 'fiyat-istihbarat', action: () => setActiveTab('fiyat-istihbarat') },
              ],
            },
            {
              id: 'lojistik', label: tr ? 'Lojistik & Depo' : 'Logistics', icon: Truck,
              childIds: ['ihracat', 'mobilewms'],
              children: [
                { label: tr ? 'Sevkiyat' : 'Shipments',              subId: 'sevkiyat',        action: () => { setActiveTab('lojistik'); setLojistikTab('sevkiyat'); } },
                { label: tr ? 'Kargo Takip' : 'Cargo Tracking',      subId: 'kargo_takip',     action: () => { setActiveTab('lojistik'); setLojistikTab('kargo_takip'); } },
                { label: tr ? 'Depo' : 'Warehouse',                  subId: 'depo',             action: () => { setActiveTab('lojistik'); setLojistikTab('depo'); } },
                { label: tr ? 'Bin / Lokasyon' : 'Bin / Location',   subId: 'wms',              action: () => { setActiveTab('lojistik'); setLojistikTab('wms'); } }, // Phase 554
                { label: tr ? 'Transfer' : 'Transfer',               subId: 'transfer',         action: () => { setActiveTab('lojistik'); setLojistikTab('transfer'); } },
                { label: tr ? 'Giden İrsaliye' : 'Dispatch Notes',   subId: 'giden_irsaliye',   action: () => { setActiveTab('lojistik'); setLojistikTab('giden_irsaliye'); } },
                { label: tr ? 'Gelen İrsaliye' : 'Receiving',        subId: 'gelen_irsaliye',   action: () => { setActiveTab('lojistik'); setLojistikTab('gelen_irsaliye'); } },
                { label: tr ? 'Tedarik Zinciri KPI' : 'Supply Chain KPI', subId: 'tedarik-kpi', action: () => { setActiveTab('lojistik'); setLojistikTab('tedarik-kpi'); } }, // Phase 576
                { label: tr ? 'Araç Takip' : 'Fleet Tracking', subId: 'arac-takip',         action: () => { setActiveTab('lojistik'); setLojistikTab('arac-takip'); } }, // Phase 593
                { label: tr ? 'İhracat & Gümrük' : 'Export & Customs', subId: 'ihracat-gumruk', action: () => { setActiveTab('lojistik'); setLojistikTab('ihracat-gumruk'); } }, // Phase 622
                { label: tr ? 'İthalat/İhracat' : 'Import/Export',   subId: 'ihracat',          action: () => setActiveTab('ihracat') },
                { label: tr ? 'Mobil WMS' : 'Mobile WMS',           subId: 'mobilewms',        action: () => setActiveTab('mobilewms') },
              ],
            },
            {
              id: 'muhasebe', label: tr ? 'Muhasebe & Finans' : 'Accounting', icon: BookOpen,
              childIds: ['ebelge', 'vergi', 'finance', 'holding', 'gelirtanima', 'dunning'],
              children: [
                { label: tr ? 'Genel Bakış' : 'Overview',          subId: 'genel',          action: () => { setActiveTab('muhasebe'); setMuhasebeTab('genel'); } },
                { label: tr ? 'Bilanço' : 'Balance Sheet',         subId: 'bilanco',        action: () => { setActiveTab('muhasebe'); setMuhasebeTab('bilanco'); } }, // Phase 547
                { label: 'P & L',                                   subId: 'pnl',            action: () => { setActiveTab('muhasebe'); setMuhasebeTab('pnl'); } },
                { label: tr ? 'Nakit Akışı' : 'Cash Flow',         subId: 'nakit-akis',     action: () => { setActiveTab('muhasebe'); setMuhasebeTab('nakit-akis'); } },
                { label: tr ? 'Kasa' : 'Cash Desk',                subId: 'kasa',           action: () => { setActiveTab('muhasebe'); setMuhasebeTab('kasa'); } },
                { label: tr ? 'Banka' : 'Banking',                 subId: 'banka',          action: () => { setActiveTab('muhasebe'); setMuhasebeTab('banka'); } },
                { label: tr ? 'Tahsilat' : 'Collections',          subId: 'tahsilat',       action: () => { setActiveTab('muhasebe'); setMuhasebeTab('tahsilat'); } },
                { label: tr ? 'Otomatik Hatırlatıcı' : 'Dunning', subId: 'dunning',        action: () => setActiveTab('dunning') },
                { label: tr ? 'Borç Yönetimi' : 'Payables',        subId: 'ap',             action: () => { setActiveTab('muhasebe'); setMuhasebeTab('ap'); } },
                { label: tr ? 'Mutabakat' : 'Reconciliation',      subId: 'mutabakat',      action: () => { setActiveTab('muhasebe'); setMuhasebeTab('mutabakat'); } }, // Phase 550
                { label: tr ? 'Masraf Yönetimi' : 'Expenses',      subId: 'masraf',         action: () => { setActiveTab('muhasebe'); setMuhasebeTab('masraf'); } }, // Phase 548
                { label: tr ? 'AR Yaşlandırma' : 'AR Aging',       subId: 'ar-aging',       action: () => { setActiveTab('muhasebe'); setMuhasebeTab('ar-aging'); } },
                { label: tr ? 'Bütçe & Senaryo' : 'Budget & Scenarios', subId: 'butce',     action: () => { setActiveTab('muhasebe'); setMuhasebeTab('butce'); } },
                { label: tr ? 'Ba/Bs Formu' : 'Ba/Bs Tax Form',      subId: 'babs',           action: () => { setActiveTab('muhasebe'); setMuhasebeTab('babs'); } }, // Phase 555
                { label: tr ? 'KDV Analiz' : 'VAT Analysis',       subId: 'kdv',            action: () => { setActiveTab('muhasebe'); setMuhasebeTab('kdv'); } }, // Phase 558
                { label: tr ? 'Cari Hesap' : 'Account Statement',  subId: 'cari',           action: () => { setActiveTab('muhasebe'); setMuhasebeTab('cari'); } }, // Phase 559
                { label: tr ? 'e-Fatura Takip' : 'e-Invoice Tracker', subId: 'fatura-takip', action: () => { setActiveTab('muhasebe'); setMuhasebeTab('fatura-takip'); } }, // Phase 564
                { label: tr ? 'Maliyet' : 'Cost Analysis',         subId: 'maliyet',        action: () => { setActiveTab('muhasebe'); setMuhasebeTab('maliyet'); } },
                { label: tr ? 'Sabit Kıymet' : 'Fixed Assets',     subId: 'sabit-kiymet',   action: () => { setActiveTab('muhasebe'); setMuhasebeTab('sabit-kiymet'); } },
                { label: tr ? 'Finansal Oranlar' : 'Fin. Ratios',  subId: 'finansal-oranlar', action: () => { setActiveTab('muhasebe'); setMuhasebeTab('finansal-oranlar'); } },
                { label: tr ? 'Fiyat Kuralları' : 'Pricing Rules', subId: 'fiyat-kural',    action: () => { setActiveTab('muhasebe'); setMuhasebeTab('fiyat-kural'); } }, // Phase 573
                { label: tr ? 'Bütçe vs Gerçekleşen' : 'Budget vs Actual', subId: 'butce-gercek', action: () => { setActiveTab('muhasebe'); setMuhasebeTab('butce-gercek'); } }, // Phase 580
                { label: tr ? 'Oto. Fatura' : 'Auto-Invoice', subId: 'oto-fatura',         action: () => { setActiveTab('muhasebe'); setMuhasebeTab('oto-fatura'); } }, // Phase 591
                { label: tr ? 'Gelir Tanıma' : 'Rev. Recognition', subId: 'gelir-tanima',  action: () => { setActiveTab('muhasebe'); setMuhasebeTab('gelir-tanima'); } }, // Phase 597
                { label: tr ? 'KDV Mutabakat' : 'VAT Reconciliation', subId: 'kdv-mutabakat', action: () => { setActiveTab('muhasebe'); setMuhasebeTab('kdv-mutabakat'); } }, // Phase 617
                { label: tr ? 'Gelir/Gider Bütçe' : 'Rev/Exp Budget', subId: 'gelir-gider-butce', action: () => { setActiveTab('muhasebe'); setMuhasebeTab('gelir-gider-butce'); } }, // Phase 625
                { label: tr ? 'Varyans Analizi' : 'Variance Analysis', subId: 'varyans-analiz',  action: () => { setActiveTab('muhasebe'); setMuhasebeTab('varyans-analiz'); } }, // Phase 634
                { label: tr ? 'Kur Değerleme' : 'FX Revaluation',       subId: 'kur-degerleme',   action: () => { setActiveTab('muhasebe'); setMuhasebeTab('kur-degerleme'); } }, // Phase 635
                { label: tr ? 'Tekrarlayan Fatura' : 'Recurring Billing', subId: 'tekrar-fatura', action: () => { setActiveTab('muhasebe'); setMuhasebeTab('tekrar-fatura'); } }, // Phase 640
                { label: tr ? 'Şirketlerarası' : 'Intercompany',          subId: 'sirket-arasi',  action: () => { setActiveTab('muhasebe'); setMuhasebeTab('sirket-arasi'); } }, // Phase 643
                { label: tr ? 'Holding Yönetimi' : 'Holding',           subId: 'holding',       action: () => setActiveTab('holding') },
                { label: tr ? 'IFRS 15 Gelir Tanıma' : 'IFRS 15 Rev. Rec.', subId: 'gelirtanima', action: () => setActiveTab('gelirtanima') },
                { label: tr ? 'Finans Paneli' : 'Finance Panel',   subId: 'finance',        action: () => setActiveTab('finance') },
                { label: tr ? 'E-Belge Merkezi' : 'E-Documents',   subId: 'ebelge',         action: () => setActiveTab('ebelge') },
                { label: tr ? 'Vergi Takvimi' : 'Tax Calendar',    subId: 'vergi',          action: () => setActiveTab('vergi') },
              ],
            },
            {
              id: 'satin-alma', label: tr ? 'Satın Alma' : 'Purchasing', icon: ShoppingCart,
              children: [
                { label: tr ? 'Satın Alma Siparişleri' : 'Purchase Orders', subId: 'pos',              action: () => { setActiveTab('satin-alma'); setPurchasingSubTab('pos'); } },
                { label: tr ? 'Tedarikçiler' : 'Suppliers',                  subId: 'suppliers',        action: () => { setActiveTab('satin-alma'); setPurchasingSubTab('suppliers'); } },
                { label: tr ? 'Tedarikçi Performansı' : 'Supplier Score',   subId: 'scorecard',        action: () => { setActiveTab('satin-alma'); setPurchasingSubTab('scorecard'); } },
                { label: tr ? 'Ödeme Takvimi' : 'Payment Schedule',         subId: 'odeme-takvimi',    action: () => { setActiveTab('satin-alma'); setPurchasingSubTab('odeme-takvimi'); } },
                { label: tr ? 'Tedarikçi Portalı' : 'Supplier Portal',      subId: 'tedarikci-portal', action: () => { setActiveTab('satin-alma'); setPurchasingSubTab('tedarikci-portal'); } }, // Phase 551
                { label: tr ? 'Satın Alma Bütçesi' : 'Purchase Budget',     subId: 'satin-butce',      action: () => { setActiveTab('satin-alma'); setPurchasingSubTab('satin-butce'); } }, // Phase 612
                { label: tr ? 'Tedarik Zinciri Riski' : 'Supply Chain Risk', subId: 'tedarik-risk',   action: () => { setActiveTab('satin-alma'); setPurchasingSubTab('tedarik-risk'); } }, // Phase 627
              ],
            },
            {
              id: 'ik', label: tr ? 'İnsan Kaynakları' : 'HR', icon: UserCheck,
              childIds: ['selfservis', 'muhtasar', 'performans', 'mesai'],
              children: [
                { label: tr ? 'Çalışanlar & İK' : 'Employees & HR',         subId: 'ik-main',    action: () => setActiveTab('ik') },
                { label: tr ? 'Mesai & Devam' : 'Time & Attendance',         subId: 'mesai',      action: () => setActiveTab('mesai') }, // Phase 552
                { label: tr ? 'Performans Değerlendirme' : 'Performance Reviews', subId: 'performans', action: () => setActiveTab('performans') },
                { label: tr ? 'Self-Servis Portalı' : 'Self-Service',        subId: 'selfservis', action: () => setActiveTab('selfservis') }, // Phase 553
                { label: tr ? 'SGK e-Bildirge' : 'SGK e-Declaration',        subId: 'sgk-bildirge', action: () => setActiveTab('ik') }, // Phase 556 (renders in IK tab)
                { label: tr ? 'Muhtasar & SGK' : 'Muhtasar & SGK',          subId: 'muhtasar',   action: () => setActiveTab('muhtasar') },
                // Masraf Yönetimi İK'dan kaldırıldı — tek kanonik yer Muhasebe grubu (Phase 548 merge)
              ],
            },
            { id: 'hukuk',    label: tr ? 'Hukuk & Uyum' : 'Legal & Compliance',  icon: ShieldCheck },
            { id: 'proje',    label: tr ? 'Proje Yönetimi' : 'Projects',           icon: TargetIcon },
            { id: 'production', label: tr ? 'Üretim' : 'Production',              icon: Factory },
            { id: 'kalite',   label: tr ? 'Kalite Yönetimi' : 'Quality',           icon: Award },
            { id: 'kurumsal', label: tr ? 'Kurumsal Yönetim' : 'Governance',       icon: Building2 },
            { id: 'b2b',      label: tr ? 'B2B Bayi Portalı' : 'B2B Portal',       icon: ShoppingBag },
            { id: 'risk',     label: tr ? 'Risk & Uyarılar' : 'Risk',              icon: AlertTriangle },
            {
              id: 'reports', label: tr ? 'Raporlar' : 'Reports', icon: BarChart3,
              children: [
                { label: tr ? 'Genel Bakış' : 'Overview',          subId: 'r-genel',    action: () => { setActiveTab('reports'); setAppReportsTab('genel'); } },
                { label: tr ? 'CRM & Satış' : 'CRM & Sales',       subId: 'r-crm',      action: () => { setActiveTab('reports'); setAppReportsTab('crm'); } },
                { label: tr ? 'Envanter' : 'Inventory',            subId: 'r-envanter', action: () => { setActiveTab('reports'); setAppReportsTab('envanter'); } },
                { label: tr ? 'Lojistik' : 'Logistics',            subId: 'r-lojistik', action: () => { setActiveTab('reports'); setAppReportsTab('lojistik'); } },
                { label: tr ? 'İnsan Kaynakları' : 'HR',           subId: 'r-ik',       action: () => { setActiveTab('reports'); setAppReportsTab('ik'); } },
                { label: tr ? 'Ürün Performansı' : 'Products',     subId: 'r-urunler',  action: () => { setActiveTab('reports'); setAppReportsTab('urunler'); } },
              ],
            },
            { id: 'analytics', label: tr ? 'Analitik' : 'Analytics',         icon: BarChart2 },
            { id: 'onaylar',   label: tr ? 'Onaylar' : 'Approvals',           icon: CheckCircle2 },
            ...(userRole === 'Admin' ? [{
              id: 'admin', label: tr ? 'Yönetim' : 'Admin', icon: Shield,
              children: [
                { label: tr ? 'Genel Bakış' : 'Overview',    subId: 'a-overview', action: () => { setActiveTab('admin'); setAdminTab('overview'); } },
                { label: tr ? 'Kullanıcılar' : 'Users',       subId: 'a-users',    action: () => { setActiveTab('admin'); setAdminTab('users'); } },
                { label: tr ? 'Erişim Kontrolü' : 'Access',  subId: 'a-access',   action: () => { setActiveTab('admin'); setAdminTab('access'); } },
                { label: 'Audit Log',                          subId: 'a-audit',    action: () => { setActiveTab('admin'); setAdminTab('auditlog'); } },
                { label: tr ? 'Şirket Bilgileri' : 'Company', subId: 'a-company',  action: () => { setActiveTab('admin'); setAdminTab('company'); } },
                ...(isSuperAdmin ? [{ label: tr ? 'Müşteri Yönetimi' : 'Customer Mgmt', subId: 'a-tenants', action: () => { setActiveTab('admin'); setAdminTab('tenants'); } }] : []),
              ],
            }] as SidebarGroup[] : []),
            ...((userRole === 'Admin' || userRole === 'Manager') ? [{ id: 'settings', label: tr ? 'Ayarlar' : 'Settings', icon: Settings }] as SidebarGroup[] : []),
          ].filter(g => canAccess(g.id));

          return (
            <aside className={cn(
              'hidden lg:flex flex-col w-56 xl:w-60 shrink-0 sticky top-16 overflow-y-auto border-r scrollbar-thin',
              'h-[calc(100vh-4rem)]',
              darkMode ? 'bg-[#0a0a0a] border-white/[0.08]' : 'bg-white/90 backdrop-blur border-gray-100'
            )}>
              <nav className="flex-1 py-2 px-1.5 space-y-0.5 overflow-y-auto">
                {sidebarGroups.map(group => {
                  const Icon = group.icon;
                  const isGroupActive = activeTab === group.id || (group.childIds ?? []).includes(activeTab);
                  const isChildActive = (subId: string) => {
                    // check if this sub-item corresponds to current state
                    if (subId === activeTab) return true;
                    if (subId === 'ik-main' && activeTab === 'ik') return true; // IK main
                    if (subId === 'tedarikci-portal' && activeTab === 'satin-alma' && purchasingSubTab === 'tedarikci-portal') return true; // Phase 551
                    if (activeTab === 'crm') return subId === crmTab;
                    if (activeTab === 'muhasebe') return subId === muhasebeTab;
                    if (activeTab === 'lojistik') return subId === lojistikTab;
                    if (activeTab === 'satin-alma') return subId === purchasingSubTab;
                    if (activeTab === 'admin') return subId === `a-${adminTab}`;
                    if (activeTab === 'reports') return subId === `r-${appReportsTab}`;
                    return false;
                  };
                  const hasChildren = group.children && group.children.length > 0;

                  return (
                    <div key={group.id}>
                      <button
                        onClick={() => {
                          if (isGroupActive && !hasChildren) return;
                          setSelectedLead(null); setSelectedOrder(null); // detay görünümünü kapat
                          setActiveTab(group.id);
                          if (group.id === 'crm') setCrmTab('leads');
                          if (group.id === 'muhasebe') setMuhasebeTab('genel');
                          if (group.id === 'lojistik') setLojistikTab('sevkiyat');
                          if (group.id === 'satin-alma') setPurchasingSubTab('pos');
                          if (group.id === 'admin') setAdminTab('overview');
                          if (group.id === 'reports') setAppReportsTab('genel');
                        }}
                        className={cn(
                          'w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-semibold transition-all text-left',
                          isGroupActive && !hasChildren
                            ? darkMode ? 'bg-brand/20 text-brand' : 'bg-brand/10 text-brand'
                            : isGroupActive && hasChildren
                              ? darkMode ? 'text-white font-bold' : 'text-gray-900 font-bold'
                              : darkMode ? 'text-white/50 hover:text-white/80 hover:bg-white/[0.06]' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                        )}
                      >
                        <Icon className={cn('w-4 h-4 shrink-0', isGroupActive ? 'text-brand' : '')} />
                        <span className="truncate flex-1">{group.label}</span>
                        {hasChildren && (
                          <ChevronDown className={cn('w-3 h-3 shrink-0 transition-transform', isGroupActive ? 'rotate-180 text-brand' : darkMode ? 'text-white/30' : 'text-gray-300')} />
                        )}
                      </button>

                      {hasChildren && isGroupActive && (
                        <div className="mt-0.5 ml-3 pl-2.5 border-l space-y-0.5 pb-1" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.08)' : '#e5e7eb' }}>
                          {group.children!.map(child => {
                            const active = isChildActive(child.subId);
                            return (
                              <button
                                key={child.subId}
                                onClick={() => { setSelectedLead(null); setSelectedOrder(null); child.action(); setIsMobileMenuOpen(false); }}
                                className={cn(
                                  'w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all',
                                  active
                                    ? darkMode ? 'bg-brand/20 text-brand' : 'bg-brand/10 text-brand font-semibold'
                                    : darkMode ? 'text-white/40 hover:text-white/70 hover:bg-white/[0.05]' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                                )}
                              >
                                {child.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            </aside>
          );
        })()}

        <main className="flex-1 min-w-0 px-3 sm:px-4 lg:px-6 py-4 sm:py-6 overflow-x-hidden">

          {/* ── Red-team Fix: Integration Staleness Banner ────────────── */}
          {staleIntegrations.length > 0 && !staleAlertDismissed && (
            <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <p className="text-xs font-semibold text-amber-800 flex-1">
                {currentLanguage === 'tr'
                  ? `⚠️ ${staleIntegrations.join(', ')} entegrasyonu 24 saatten uzun süredir senkronize edilmedi. Muhasebe verileriniz güncel olmayabilir.`
                  : `⚠️ ${staleIntegrations.join(', ')} integration hasn't synced in 24+ hours. Your accounting data may be stale.`}
              </p>
              <button onClick={() => { setActiveTab('settings'); setStaleAlertDismissed(true); }} className="text-xs font-bold text-amber-700 underline whitespace-nowrap">
                {currentLanguage === 'tr' ? 'Ayarlara Git' : 'Fix in Settings'}
              </button>
              <button onClick={() => setStaleAlertDismissed(true)} className="text-amber-400 hover:text-amber-600 ml-1 text-sm font-bold leading-none">✕</button>
            </div>
          )}

          {/* ── Red-team Fix: PWA Install Banner ─────────────────────── */}
          {showPwaBanner && (
            <div className="mb-4 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
              <span className="text-lg flex-shrink-0">📲</span>
              <p className="text-xs font-semibold text-blue-800 flex-1">
                {currentLanguage === 'tr' ? 'CETPA\'yı ana ekrana ekleyin — çevrimdışı da çalışır.' : 'Install CETPA on your home screen — works offline too.'}
              </p>
              <button onClick={installPwa} className="apple-button-primary text-xs px-4 py-1.5 whitespace-nowrap">
                {currentLanguage === 'tr' ? 'Yükle' : 'Install'}
              </button>
              <button onClick={() => setShowPwaBanner(false)} className="text-blue-400 hover:text-blue-600 ml-1 text-sm font-bold leading-none">✕</button>
            </div>
          )}

          {/* ── 2FA: girişte challenge (oturum doğrulanana dek veri yüklenmez) ── */}
          {mfaChallenge && (
            <MfaChallengeModal
              currentLanguage={currentLanguage as 'tr' | 'en'}
              onSuccess={() => { setMfaChallenge(false); window.location.reload(); }}
              onCancel={() => { setMfaChallenge(false); handleLogout(); }}
            />
          )}

          {/* ── 2FA: kullanıcı güvenlik ayarları ── */}
          {showMfaSettings && user && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowMfaSettings(false)}>
              <div className="w-full max-w-md" onClick={e => e.stopPropagation()}>
                <MfaSettings currentLanguage={currentLanguage as 'tr' | 'en'} />
                <button onClick={() => setShowMfaSettings(false)} className="mt-3 w-full apple-button-secondary justify-center py-2.5 text-sm">
                  {currentLanguage === 'tr' ? 'Kapat' : 'Close'}
                </button>
              </div>
            </div>
          )}

          {/* ── Red-team Fix: KVKK Data Processing Modal ─────────────── */}
          {showKvkkModal && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="apple-card max-w-md w-full p-8 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="w-5 h-5 text-blue-600" />
                  </div>
                  <h3 className="font-bold text-gray-900 text-base">
                    {currentLanguage === 'tr' ? 'KVKK Veri İşleme Bildirimi' : 'Data Processing Notice (KVKK/GDPR)'}
                  </h3>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {currentLanguage === 'tr'
                    ? 'CETPA, verilerinizi Google Firebase altyapısında (Frankfurt, Avrupa Birliği) saklamaktadır. İşletme ve Kurumsal plan kullanıcıları için 6698 sayılı KVKK kapsamında kişisel verilerin işlenmesine açık rızanız gerekmektedir. Verileriniz üçüncü şahıslarla paylaşılmaz.'
                    : 'CETPA stores your data on Google Firebase infrastructure (Frankfurt, EU). Enterprise plan users must explicitly consent to personal data processing under KVKK (Law 6698). Your data is never shared with third parties.'}
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs text-amber-800 font-medium">
                    {currentLanguage === 'tr'
                      ? '⚠️ Kamu sektörü ve finans kuruluşları için yerli sunucu seçeneğini inceleyiniz: info@cetpa.com.tr'
                      : '⚠️ Public sector & financial institutions: inquire about on-premise hosting at info@cetpa.com.tr'}
                  </p>
                </div>
                {kvkkConcern ? (
                  <div className="flex flex-col gap-3">
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
                      <p className="text-sm text-gray-700">
                        {currentLanguage === 'tr'
                          ? 'KVKK, veri saklama veya yerli sunucu talepleriniz için ekibimize ulaşın:'
                          : 'Reach our team for data residency, retention or on-premise requests:'}
                      </p>
                      <div className="flex items-center justify-between gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                        <span className="text-sm font-semibold text-gray-900 select-all">info@cetpa.com.tr</span>
                        <button onClick={copyKvkkContact} className="text-xs font-bold text-brand hover:underline whitespace-nowrap">
                          {kvkkCopied ? (currentLanguage === 'tr' ? '✓ Kopyalandı' : '✓ Copied') : (currentLanguage === 'tr' ? 'Kopyala' : 'Copy')}
                        </button>
                      </div>
                      <a href="mailto:info@cetpa.com.tr?subject=KVKK%20Talebi" className="block text-xs text-brand hover:underline">
                        {currentLanguage === 'tr' ? 'E-posta uygulamasında aç →' : 'Open in mail app →'}
                      </a>
                    </div>
                    <button onClick={() => setKvkkConcern(false)} className="apple-button-secondary w-full py-3 text-sm font-bold">
                      {currentLanguage === 'tr' ? '← Geri' : '← Back'}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <button onClick={acceptKvkk} className="apple-button-primary w-full py-3 text-sm font-bold">
                      {currentLanguage === 'tr' ? 'Okudum, Kabul Ediyorum' : 'I Understand & Accept'}
                    </button>
                    <button onClick={() => setKvkkConcern(true)} className="apple-button-secondary w-full py-3 text-sm font-bold text-center">
                      {currentLanguage === 'tr' ? 'Sorun Var?' : 'Concerns?'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Gemini AI (Yapay Zeka Destek Modülü) kullanım onayı ── */}
          {showAiConsentModal && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="apple-card max-w-md w-full p-8 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-5 h-5 text-violet-600" />
                  </div>
                  <h3 className="font-bold text-gray-900 text-base">
                    {currentLanguage === 'tr' ? 'Yapay Zeka Destek Modülü' : 'AI Support Module'}
                  </h3>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {currentLanguage === 'tr'
                    ? 'Yapay Zeka Destek Modülünü (lead skorlama, AI sohbet, analiz önerileri) kullanabilmek için aydınlatma metni ve kullanıcı sözleşmesi metnine onay verilmesi gerekmektedir.'
                    : 'To use the AI Support Module (lead scoring, AI chat, analysis suggestions), you must consent to the disclosure notice and user agreement.'}
                </p>

                {aiConsentExpanded && (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 max-h-56 overflow-y-auto text-xs text-gray-600 leading-relaxed space-y-2">
                    {aiConsentExpanded === 'aydinlatma' ? (
                      currentLanguage === 'tr' ? (
                        <>
                          <p><strong>Aydınlatma Metni (KVKK m.10):</strong></p>
                          <p>Bu modülü kullandığınızda; lead/müşteri adı, şirket, iletişim bilgileri ve girdiğiniz notlar gibi kişisel veriler, analiz/skorlama/öneri üretimi amacıyla Google LLC tarafından işletilen Gemini API'ye (ABD merkezli, uluslararası veri aktarımı içerir) iletilir. Veriler Google'ın kendi saklama politikaları kapsamında işlenir, CETPA tarafından reklam/pazarlama amacıyla kullanılmaz veya üçüncü kişilerle paylaşılmaz. Onayınızı istediğiniz zaman Ayarlar'dan geri çekebilirsiniz; geri çekmeniz AI destekli özellikleri devre dışı bırakır, uygulamanın diğer işlevlerini etkilemez.</p>
                        </>
                      ) : (
                        <>
                          <p><strong>Disclosure Notice:</strong></p>
                          <p>When you use this module, personal data you enter (lead/customer name, company, contact details, notes) is sent to Google's Gemini API (US-based, involves international data transfer) for analysis/scoring/suggestion generation. Data is processed under Google's own retention policies; CETPA does not use it for advertising and does not share it with other third parties. You may withdraw consent anytime in Settings; withdrawing disables AI-assisted features only.</p>
                        </>
                      )
                    ) : (
                      currentLanguage === 'tr' ? (
                        <>
                          <p><strong>Kullanım Koşulları:</strong></p>
                          <p>AI çıktıları (skor, öneri, analiz) otomatik üretilmiştir ve bir tavsiye niteliği taşır; nihai iş/finansal kararlar için tek başına dayanak olarak kullanılmamalıdır. CETPA, AI çıktılarının doğruluğunu garanti etmez. Modülü kötüye kullanım (örn. üçüncü kişilere ait hassas veriyi yetkisiz şekilde girme) kullanıcının sorumluluğundadır.</p>
                        </>
                      ) : (
                        <>
                          <p><strong>Terms of Use:</strong></p>
                          <p>AI outputs (scores, suggestions, analysis) are automatically generated and advisory in nature; they should not be used as the sole basis for final business/financial decisions. CETPA does not guarantee the accuracy of AI outputs. Misuse of the module (e.g. entering unauthorized sensitive third-party data) is the user's responsibility.</p>
                        </>
                      )
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aiConsentAydinlatma}
                      onChange={e => setAiConsentAydinlatma(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-brand flex-shrink-0"
                    />
                    <span className="text-sm text-gray-700">
                      <button type="button" onClick={(e) => { e.preventDefault(); setAiConsentExpanded(aiConsentExpanded === 'aydinlatma' ? null : 'aydinlatma'); }} className="text-brand font-semibold hover:underline">
                        {currentLanguage === 'tr' ? "Aydınlatma Metni'ni" : "the Disclosure Notice"}
                      </button>
                      {currentLanguage === 'tr'
                        ? " okudum, verilerin aydınlatma metni kapsamında işlenmesine onay veriyorum."
                        : " I have read and consent to data processing under it."}
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aiConsentKosullar}
                      onChange={e => setAiConsentKosullar(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-brand flex-shrink-0"
                    />
                    <span className="text-sm text-gray-700">
                      <button type="button" onClick={(e) => { e.preventDefault(); setAiConsentExpanded(aiConsentExpanded === 'kosullar' ? null : 'kosullar'); }} className="text-brand font-semibold hover:underline">
                        {currentLanguage === 'tr' ? "Kullanım Koşulları Metni'ni" : "the Terms of Use"}
                      </button>
                      {currentLanguage === 'tr' ? " okudum, onaylıyorum." : " I have read and approve."}
                    </span>
                  </label>
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => void acceptAiConsent()}
                    disabled={!aiConsentAydinlatma || !aiConsentKosullar}
                    className="apple-button-primary w-full py-3 text-sm font-bold disabled:opacity-40"
                  >
                    {currentLanguage === 'tr' ? 'Onayla' : 'Accept'}
                  </button>
                  <button
                    onClick={() => setShowAiConsentModal(false)}
                    className="apple-button-secondary w-full py-3 text-sm font-bold text-center"
                  >
                    {currentLanguage === 'tr' ? 'Şimdilik Reddet (AI özellikleri kapalı kalır)' : 'Decline for now (AI features stay off)'}
                  </button>
                </div>
              </div>
            </div>
          )}

        <TabErrorBoundary tabName={tabLabelOf(activeTab)} lang={currentLanguage}>
        <React.Suspense fallback={
          <div className="flex flex-col items-center justify-center min-h-[320px] gap-4">
            <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
            <p className="text-sm text-gray-400">{currentLanguage === 'tr' ? 'Modül yükleniyor…' : 'Loading module…'}</p>
          </div>
        }>
        <AnimatePresence mode="wait">

          {/* ── Dashboard (Home) ── */}
          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              {/* Welcome */}
              <ModuleHeader
                title={`${(() => {
                  const h = dashClock.getHours();
                  if (currentLanguage === 'tr') return h < 12 ? 'Günaydın' : h < 17 ? 'İyi öğlenler' : 'İyi akşamlar';
                  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
                })()}${user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''} ${dashClock.getHours() < 12 ? '☀️' : dashClock.getHours() < 17 ? '👋' : '🌙'}`}
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
                    {/* Phase 514: Live clock */}
                    <div className="hidden lg:flex flex-col items-end text-right">
                      <span className="text-sm font-black text-gray-800 tabular-nums">{dashClock.toLocaleTimeString(currentLanguage === 'en' ? 'en-US' : 'tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                      <span className="text-[10px] text-gray-400">{dashClock.toLocaleDateString(currentLanguage === 'en' ? 'en-US' : 'tr-TR', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    </div>
                  </div>
                }
              />

              {/* ── Phase 528: Smart Alert Strip ── */}
              {(() => {
                const now528 = Date.now();
                const alerts: { id: string; color: string; icon: string; msg: string }[] = [];

                // Orders stuck in Pending > 3 days
                const stuckPending = orders.filter(o => {
                  if (o.status !== 'Pending') return false;
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return false;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number);
                  return (now528 - d.getTime()) > 3 * 86400000;
                });
                if (stuckPending.length > 0)
                  alerts.push({ id: 'stuckPending', color: 'amber', icon: '⏳',
                    msg: currentLanguage === 'tr'
                      ? `${stuckPending.length} sipariş 3+ gündür bekliyor`
                      : `${stuckPending.length} order${stuckPending.length > 1 ? 's' : ''} pending for 3+ days` });

                // Leads with no activity > 7 days
                const inactiveLeads = leads.filter(l => {
                  if (l.status === 'Closed') return false;
                  const raw = l.updatedAt ?? l.createdAt;
                  if (!raw) return false;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number);
                  return (now528 - d.getTime()) > 7 * 86400000;
                });
                if (inactiveLeads.length > 0)
                  alerts.push({ id: 'inactiveLeads', color: 'blue', icon: '👤',
                    msg: currentLanguage === 'tr'
                      ? `${inactiveLeads.length} aktif aday 7+ gündür güncellenmedi`
                      : `${inactiveLeads.length} active lead${inactiveLeads.length > 1 ? 's' : ''} with no activity in 7+ days` });

                // Critical low stock
                const criticalStock = inventory.filter(i => (i.stockLevel ?? 0) <= 0);
                if (criticalStock.length > 0)
                  alerts.push({ id: 'criticalStock', color: 'red', icon: '📦',
                    msg: currentLanguage === 'tr'
                      ? `${criticalStock.length} ürün stokta kalmadı (sıfır stok)`
                      : `${criticalStock.length} product${criticalStock.length > 1 ? 's' : ''} out of stock` });

                // Unpaid delivered orders
                const unpaidDelivered = orders.filter(o => o.status === 'Delivered' && !o.paid);
                if (unpaidDelivered.length > 0)
                  alerts.push({ id: 'unpaidDelivered', color: 'rose', icon: '💳',
                    msg: currentLanguage === 'tr'
                      ? `${unpaidDelivered.length} teslim edilmiş sipariş hâlâ ödenmedi`
                      : `${unpaidDelivered.length} delivered order${unpaidDelivered.length > 1 ? 's' : ''} still unpaid` });

                const visible = alerts.filter(a => !p528Dismissed.has(a.id));
                if (visible.length === 0) return null;

                const colorMap: Record<string, string> = {
                  amber: 'bg-amber-50 border-amber-200 text-amber-800',
                  blue:  'bg-blue-50 border-blue-200 text-blue-800',
                  red:   'bg-red-50 border-red-200 text-red-800',
                  rose:  'bg-rose-50 border-rose-200 text-rose-800',
                };
                return (
                  <div className="flex flex-wrap gap-2">
                    {visible.map(alert => (
                      <div key={alert.id} className={cn("flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium", colorMap[alert.color] ?? colorMap.amber)}>
                        <span>{alert.icon}</span>
                        <span>{alert.msg}</span>
                        <button
                          onClick={() => setP528Dismissed(prev => new Set([...prev, alert.id]))}
                          className="ml-1 opacity-50 hover:opacity-100 transition-opacity font-bold text-[10px]"
                          title={currentLanguage === 'tr' ? 'Kapat' : 'Dismiss'}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* KPI Cards */}
              {(() => {
                return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: dashT.total_orders, value: filteredOrders.length, icon: Package, color: 'text-blue-500', bg: 'bg-blue-50', sub: `${filteredOrders.filter(o => o.status === 'Pending').length} ${dashT.pending}`, tab: 'orders', delta: summaryData?.orders?.delta },
                  { label: dashT.active_leads, value: filteredLeads.filter(l => !['Closed Won','Closed Lost'].includes(l.status)).length, icon: Users, color: 'text-brand', bg: 'bg-brand/10', sub: `${filteredLeads.length} ${dashT.total}`, tab: 'crm', delta: null },
                  { label: dashT.inventory_label, value: inventory.length, icon: List, color: 'text-purple-500', bg: 'bg-purple-50', sub: `${inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length} ${dashT.low_stock}`, tab: 'inventory', delta: null },
                ].map((kpi, i) => (
                  <button key={i} onClick={() => setActiveTab(kpi.tab)}
                    className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.02] transition-all duration-150 cursor-pointer group flex flex-col min-h-[130px]">
                    <div className="flex items-start justify-between mb-2">
                      <div className={`w-9 h-9 rounded-xl ${kpi.bg} flex items-center justify-center`}>
                        <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                      </div>
                      <DeltaBadge delta={kpi.delta} />
                    </div>
                    <p className="text-2xl font-bold mt-auto" style={{color:'var(--text-primary)'}}>{kpi.value}</p>
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
                  const rate = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
                  const converted = kpiCurrency === 'TRY' ? totalTRY : totalTRY / rate;
                  const symbol = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                  const revDelta = summaryData?.revenue?.delta;
                  return (
                    <div className="apple-card p-4 text-left group flex flex-col min-h-[130px]">
                      <div className="flex items-center justify-between mb-2">
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
                      <p className="text-2xl font-bold mt-auto" style={{color:'var(--text-primary)'}}>{symbol}{converted.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
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

                const insightRate   = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
                const insightSymbol = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const cvtWeek = kpiCurrency === 'TRY' ? weekRevenue : weekRevenue / insightRate;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* ── 7-Day Revenue card — with currency toggle ── */}
                    <div
                      onClick={() => setActiveTab('reports')}
                      role="button" tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && setActiveTab('reports')}
                      className="apple-card p-4 cursor-pointer hover:shadow-md hover:scale-[1.02] transition-all duration-150 group flex flex-col min-h-[130px]"
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
                      <p className="text-2xl font-bold text-emerald-600 mt-auto">
                        {insightSymbol}{cvtWeek.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                      </p>
                      <p className="text-[10px] font-semibold text-gray-500 truncate mt-1">{currentLanguage === 'tr' ? '7 Günlük Ciro' : '7-Day Revenue'}</p>
                      <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Bu hafta' : 'This week'}</p>
                    </div>

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
                          className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.02] transition-all duration-150 group flex flex-col min-h-[130px]"
                        >
                          <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center mb-2`}>
                            <Icon className={`w-4 h-4 ${stat.color}`} />
                          </div>
                          <p className={`text-2xl font-bold ${stat.color} mt-auto`}>{stat.value}</p>
                          <p className="text-[10px] font-semibold text-gray-500 mt-0.5 truncate">{stat.label}</p>
                          <p className="text-[10px] text-gray-400 truncate">{stat.sub}</p>
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
                const lowStock = inventory.filter(i => (Number(i.stock) || 0) > 0 && (Number(i.stock) || 0) <= (Number(i.minStock) || 5));
                if (lowStock.length > 0) {
                  const top = lowStock.sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0))[0];
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

              {/* ── Phase 543: Upcoming Tax Deadlines Widget ── */}
              {dashVergiDeadlines.length > 0 && (() => {
                const getDays = (sonTarih: string) => Math.ceil((new Date(sonTarih).getTime() - Date.now()) / 86400000);
                return (
                  <div className={cn('rounded-2xl border p-4', darkMode ? 'bg-white/5 border-white/10' : 'bg-amber-50/60 border-amber-200/60')}>
                    <div className="flex items-center justify-between mb-3">
                      <p className={cn('text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5', darkMode ? 'text-white/40' : 'text-amber-700')}>
                        <Receipt className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Yaklaşan Vergi Tarihleri' : 'Upcoming Tax Deadlines'}
                      </p>
                      <button
                        onClick={() => setActiveTab('vergi')}
                        className="text-[10px] font-bold text-amber-600 hover:text-amber-800 transition-colors flex items-center gap-0.5"
                      >
                        {currentLanguage === 'tr' ? 'Tümü' : 'All'} <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {dashVergiDeadlines.map(d => {
                        const days = getDays(d.sonTarih);
                        const isUrgent = days <= 7;
                        const isCritical = days <= 2;
                        return (
                          <div
                            key={d.id}
                            className={cn(
                              'flex items-center justify-between px-3 py-2 rounded-xl',
                              isCritical ? 'bg-red-100 border border-red-200' : isUrgent ? 'bg-orange-50 border border-orange-200' : 'bg-white border border-amber-100'
                            )}
                          >
                            <div className="min-w-0">
                              <p className={cn('text-xs font-bold truncate', isCritical ? 'text-red-800' : isUrgent ? 'text-orange-800' : 'text-gray-800')}>{d.vergiTuru}</p>
                              <p className="text-[10px] text-gray-500">{new Date(d.sonTarih).toLocaleDateString('tr-TR')}</p>
                            </div>
                            <span className={cn(
                              'shrink-0 ml-2 text-[10px] font-black px-2 py-0.5 rounded-full',
                              isCritical ? 'bg-red-200 text-red-800' : isUrgent ? 'bg-orange-200 text-orange-800' : 'bg-amber-100 text-amber-700'
                            )}>
                              {days === 0 ? (currentLanguage === 'tr' ? 'Bugün!' : 'Today!') : `${days}g`}
                            </span>
                          </div>
                        );
                      })}
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
                const mtdRate        = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
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

              {/* ── Phase 99: Monthly Sales Target (Satış Hedefi) ── */}
              {(() => {
                const now = new Date();
                const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                const getOD = (o: Order): Date => {
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return new Date(0);
                  return typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
                };
                const mtdRev99 = orders.filter(o => getOD(o) >= thisMonthStart && o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0);
                const pct99 = monthlyTarget > 0 ? Math.min(Math.round((mtdRev99 / monthlyTarget) * 100), 200) : 0;
                const barColor99 = pct99 >= 100 ? 'bg-emerald-400' : pct99 >= 70 ? 'bg-brand' : pct99 >= 40 ? 'bg-amber-400' : 'bg-red-400';
                const rate99 = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
                const sym99 = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const cvtRev99 = kpiCurrency === 'TRY' ? mtdRev99 : mtdRev99 / rate99;
                const cvtTarget99 = kpiCurrency === 'TRY' ? monthlyTarget : monthlyTarget / rate99;
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-white/50" : "text-gray-400")}>
                          {currentLanguage === 'tr' ? 'Bu Ay Satış Hedefi' : 'Monthly Sales Target'}
                        </h3>
                        {isEditingTarget ? (
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              autoFocus
                              type="number"
                              value={targetDraft}
                              onChange={e => setTargetDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const v = Number(targetDraft);
                                  const mk = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; })();
                                  saveMonthlyTarget(mk, v);
                                  setIsEditingTarget(false);
                                }
                                if (e.key === 'Escape') setIsEditingTarget(false);
                              }}
                              className="text-sm font-bold bg-gray-100 rounded-lg px-2 py-1 outline-none w-36"
                              placeholder="0"
                            />
                            <button onClick={() => { const v = Number(targetDraft); const mk = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; })(); saveMonthlyTarget(mk, v); setIsEditingTarget(false); }}
                              className="text-[10px] bg-brand text-white px-2 py-1 rounded-lg font-bold">{currentLanguage === 'tr' ? 'Kaydet' : 'Save'}</button>
                            <button onClick={() => setIsEditingTarget(false)} className="text-[10px] text-gray-400 hover:text-gray-600">{currentLanguage === 'tr' ? 'İptal' : 'Cancel'}</button>
                          </div>
                        ) : (
                          <button onClick={() => { setTargetDraft(String(monthlyTarget)); setIsEditingTarget(true); }}
                            className="flex items-center gap-1 mt-0.5 group">
                            <p className={cn("text-xl font-black", darkMode ? "text-white" : "text-gray-900")}>
                              {monthlyTarget > 0 ? `${sym99}${cvtTarget99.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}` : (currentLanguage === 'tr' ? 'Hedef belirle…' : 'Set target…')}
                            </p>
                            <span className="text-gray-300 group-hover:text-brand transition-colors text-[10px]">✎</span>
                          </button>
                        )}
                      </div>
                      <div className="text-right">
                        <p className={`text-2xl font-black ${pct99 >= 100 ? 'text-emerald-600' : pct99 >= 70 ? 'text-brand' : pct99 >= 40 ? 'text-amber-600' : 'text-red-500'}`}>{pct99}%</p>
                        <p className={cn("text-[10px]", darkMode ? "text-white/40" : "text-gray-400")}>{sym99}{cvtRev99.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} {currentLanguage === 'tr' ? 'gerçekleşti' : 'achieved'}</p>
                      </div>
                    </div>
                    <div className={cn("h-2.5 rounded-full overflow-hidden", darkMode ? "bg-white/10" : "bg-gray-100")}>
                      <div className={`h-full rounded-full transition-all duration-700 ${barColor99}`} style={{ width: `${Math.min(pct99, 100)}%` }} />
                    </div>
                    <div className="flex justify-between mt-1.5">
                      <span className={cn("text-[10px]", darkMode ? "text-white/30" : "text-gray-400")}>0</span>
                      {pct99 >= 100 && <span className="text-[10px] font-bold text-emerald-600">🎯 {currentLanguage === 'tr' ? 'Hedefe ulaşıldı!' : 'Target reached!'}</span>}
                      <span className={cn("text-[10px]", darkMode ? "text-white/30" : "text-gray-400")}>{monthlyTarget > 0 ? `${sym99}${cvtTarget99.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}` : '—'}</span>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 174: Sales vs Budget – Last 3 Months ── */}
              {monthlyTarget > 0 && orders.length > 0 && (() => {
                const now174 = new Date();
                const months174 = Array.from({ length: 3 }, (_, i) => {
                  const d = new Date(now174.getFullYear(), now174.getMonth() - (2 - i), 1);
                  const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
                  const mOrders = orders.filter(o => {
                    if (o.status === 'Cancelled') return false;
                    try {
                      const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                      return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
                    } catch { return false; }
                  });
                  const actual = mOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
                  const pct = monthlyTarget > 0 ? Math.round((actual / monthlyTarget) * 100) : 0;
                  return { label, actual, pct };
                });
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-3", darkMode ? "text-white/50" : "text-gray-400")}>
                      {currentLanguage === 'tr' ? 'Satış / Bütçe (3 Ay)' : 'Sales vs Budget (3M)'}
                    </h3>
                    <div className="flex items-end gap-4 h-20">
                      {months174.map((m, i) => {
                        const h = Math.min(m.pct, 120);
                        const barCls = m.pct >= 100 ? 'bg-emerald-400' : m.pct >= 70 ? 'bg-amber-400' : 'bg-red-400';
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <div className="w-full flex flex-col justify-end relative" style={{ height: '60px' }}>
                              <div className={`w-full rounded-t-lg transition-all ${barCls}`} style={{ height: `${Math.max(h * 0.5, 4)}%` }} />
                              <div className="absolute bottom-0 w-full border-t-2 border-dashed border-gray-300" style={{ bottom: '50%' }} />
                            </div>
                            <span className="text-[9px] text-gray-400">{m.label}</span>
                            <span className={`text-[9px] font-bold ${m.pct >= 100 ? 'text-emerald-600' : m.pct >= 70 ? 'text-amber-600' : 'text-red-500'}`}>%{m.pct}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 text-center">{currentLanguage==='tr'?'Kesikli çizgi = hedef':'Dashed = target'}</p>
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
                const kpiRate   = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
                const kpiSymbol = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const cvtAov    = kpiCurrency === 'TRY' ? aov : aov / kpiRate;
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* ── AOV card — with currency toggle ── */}
                    <div onClick={() => setActiveTab('reports')}
                      role="button" tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && setActiveTab('reports')}
                      className="apple-card p-4 cursor-pointer hover:shadow-md hover:scale-[1.02] transition-all duration-150 group flex flex-col">
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
                    </div>

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
                          className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.02] transition-all duration-150 group flex flex-col">
                          <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center flex-shrink-0 mb-2`}>
                            <Icon className={`w-4 h-4 ${stat.color}`} />
                          </div>
                          <p className={`text-xl font-bold ${stat.color} mt-auto`}>{stat.value}</p>
                          <p className="text-[10px] font-semibold text-gray-500 mt-0.5 truncate">{stat.label}</p>
                          <p className="text-[10px] text-gray-400 truncate">{stat.sub}</p>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ── Phase 124: KPI Alert Thresholds ── */}
              {(() => {
                const alerts125: Array<{ level: 'warn' | 'danger'; icon: string; message: string }> = [];
                // Low stock items
                const lowStockCount = inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? i.minStock ?? 5)).length;
                if (lowStockCount > 0) alerts125.push({ level: 'warn', icon: '📦', message: currentLanguage === 'tr' ? `${lowStockCount} ürün kritik stok seviyesinde` : `${lowStockCount} products at critical stock level` });
                // Overdue payments
                const now125 = Date.now();
                const overdueCount = orders.filter(o => !o.paid && o.status !== 'Cancelled' && o.createdAt && (() => {
                  const ts = o.createdAt;
                  if (!ts) return false;
                  const d = typeof (ts as { toDate?: () => Date }).toDate === 'function' ? (ts as { toDate: () => Date }).toDate() : new Date(ts as string);
                  return (now125 - d.getTime()) > 30 * 86400000;
                })()).length;
                if (overdueCount > 0) alerts125.push({ level: 'danger', icon: '💳', message: currentLanguage === 'tr' ? `${overdueCount} siparişin ödemesi 30+ gün gecikmiş` : `${overdueCount} orders have payment overdue 30+ days` });
                // Pending price overrides
                const pendingOverrides = priceOverrides.filter(p => p.status === 'pending').length;
                if (pendingOverrides > 0) alerts125.push({ level: 'warn', icon: '🏷️', message: currentLanguage === 'tr' ? `${pendingOverrides} fiyat onay talebi bekliyor` : `${pendingOverrides} price override requests pending` });
                // Pending leave requests
                const pendingLeaves = leaveRequests.filter(l => l.status === 'pending').length;
                if (pendingLeaves > 0) alerts125.push({ level: 'warn', icon: '📅', message: currentLanguage === 'tr' ? `${pendingLeaves} izin talebi onay bekliyor` : `${pendingLeaves} leave requests awaiting approval` });
                if (alerts125.length === 0) return null;
                return (
                  <div className="space-y-2">
                    {alerts125.map((a, i) => (
                      <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold border ${a.level === 'danger' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-amber-50 border-amber-100 text-amber-700'}`}>
                        <span>{a.icon}</span>
                        <span className="flex-1">{a.message}</span>
                        {/* Phase 538: open overdue panel for payment alerts */}
                        {a.icon === '💳' && (
                          <button
                            onClick={() => setShowOverduePanel(true)}
                            className="text-[10px] font-bold underline underline-offset-2 opacity-80 hover:opacity-100 shrink-0"
                          >
                            {currentLanguage === 'tr' ? 'Tümünü Gör' : 'View All'}
                          </button>
                        )}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.level === 'danger' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                          {a.level === 'danger' ? (currentLanguage === 'tr' ? 'Kritik' : 'Critical') : (currentLanguage === 'tr' ? 'Uyarı' : 'Warning')}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ── Phase 130: Daily Cash Position ── */}
              {orders.length > 0 && (() => {
                const today130 = new Date();
                const todayStr = today130.toDateString();
                const todayOrders = orders.filter(o => {
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return false;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
                  return d.toDateString() === todayStr && o.status !== 'Cancelled';
                });
                const todayRevenue = todayOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
                const todayPaid = todayOrders.filter(o => o.paid).reduce((s, o) => s + (o.totalPrice || 0), 0);
                const totalUnpaid = orders.filter(o => !o.paid && o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0);
                const r130 = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
                const s130 = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const cvt130 = (v: number) => (kpiCurrency === 'TRY' ? v : v / r130).toLocaleString('tr-TR', { maximumFractionDigits: 0 });
                return (
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-base">💵</span>
                        <div>
                          <h3 className="text-sm font-bold text-gray-800">{currentLanguage === 'tr' ? 'Günlük Nakit Pozisyonu' : 'Daily Cash Position'}</h3>
                          <p className="text-[10px] text-gray-400">{today130.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-black text-emerald-600">{s130}{cvt130(todayPaid)}</p>
                        <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'bugün tahsil' : 'collected today'}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: currentLanguage === 'tr' ? 'Bugün Ciro' : "Today's Revenue", val: todayRevenue, color: 'text-gray-800' },
                        { label: currentLanguage === 'tr' ? 'Bugün Tahsil' : 'Collected Today', val: todayPaid, color: 'text-emerald-600' },
                        { label: currentLanguage === 'tr' ? 'Toplam Alacak' : 'Total Receivable', val: totalUnpaid, color: 'text-amber-600' },
                      ].map(c => (
                        <div key={c.label} className="text-center bg-gray-50 rounded-xl p-3">
                          <p className={`text-base font-bold ${c.color}`}>{s130}{cvt130(c.val)}</p>
                          <p className="text-[9px] text-gray-400 leading-tight mt-0.5">{c.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 159: Sales Velocity (Revenue per Working Day) ── */}
              {orders.length > 0 && (() => {
                const now159 = new Date();
                // Last 30 days revenue vs prior 30 days
                const d30ago = new Date(now159); d30ago.setDate(d30ago.getDate() - 30);
                const d60ago = new Date(now159); d60ago.setDate(d60ago.getDate() - 60);
                const getOD159 = (o: Order): Date => {
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return new Date(0);
                  return typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string | number);
                };
                const last30 = orders.filter(o => { const d = getOD159(o); return d >= d30ago && o.status !== 'Cancelled'; });
                const prev30 = orders.filter(o => { const d = getOD159(o); return d >= d60ago && d < d30ago && o.status !== 'Cancelled'; });
                const rev30 = last30.reduce((s, o) => s + (o.totalPrice || 0), 0);
                const revPrev = prev30.reduce((s, o) => s + (o.totalPrice || 0), 0);
                const dailyRev = rev30 / 30;
                const dailyPrev = revPrev / 30;
                const velocityChange = dailyPrev > 0 ? Math.round(((dailyRev - dailyPrev) / dailyPrev) * 100) : null;
                // Weekly sparkline (last 8 weeks)
                const weeks: number[] = Array(8).fill(0);
                for (const o of orders) {
                  if (o.status === 'Cancelled') continue;
                  const d = getOD159(o);
                  const daysAgo = Math.floor((now159.getTime() - d.getTime()) / 86400000);
                  const weekIdx = 7 - Math.floor(daysAgo / 7);
                  if (weekIdx >= 0 && weekIdx < 8) weeks[weekIdx] += o.totalPrice || 0;
                }
                const maxWeek = Math.max(...weeks, 1);
                const r159 = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
                const s159 = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const f159 = (v: number) => (kpiCurrency === 'TRY' ? v : v / r159).toLocaleString(undefined, { maximumFractionDigits: 0 });
                return (
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-bold text-gray-800">{currentLanguage === 'tr' ? '⚡ Satış Hızı' : '⚡ Sales Velocity'}</h3>
                        <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Günlük ortalama ciro (son 30 gün)' : 'Avg. daily revenue (last 30 days)'}</p>
                      </div>
                      {velocityChange !== null && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${velocityChange >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                          {velocityChange >= 0 ? '↑' : '↓'}{Math.abs(velocityChange)}% vs {currentLanguage==='tr'?'önceki 30g':'prev 30d'}
                        </span>
                      )}
                    </div>
                    <p className="text-3xl font-black text-brand mb-3">{s159}{f159(dailyRev)}<span className="text-sm font-normal text-gray-400">/{currentLanguage==='tr'?'gün':'day'}</span></p>
                    <div className="flex items-end gap-0.5 h-10">
                      {weeks.map((w, i) => (
                        <div key={i} className="flex-1 flex flex-col justify-end">
                          <div className={`w-full rounded-sm transition-all ${i === 7 ? 'bg-brand' : 'bg-brand/25'}`}
                            style={{ height: `${Math.max(Math.round((w / maxWeek) * 100), 4)}%` }} />
                        </div>
                      ))}
                    </div>
                    <p className="text-[9px] text-gray-400 mt-1 text-right">{currentLanguage==='tr'?'Son 8 hafta':'Last 8 weeks'}</p>
                  </div>
                );
              })()}

              {/* ── Phase 539: Shipments Mini-Widget ── */}
              {shipments.length > 0 && (() => {
                const todayStr539 = new Date().toDateString();
                const inTransit  = shipments.filter(s => s.status === 'In Transit').length;
                const pending539 = shipments.filter(s => s.status === 'Pending').length;
                const delivToday = shipments.filter(s => {
                  if (s.status !== 'Delivered') return false;
                  const raw = (s as unknown as Record<string, unknown>).updatedAt ?? (s as unknown as Record<string, unknown>).date;
                  if (!raw) return false;
                  const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
                    ? (raw as { toDate: () => Date }).toDate()
                    : new Date(raw as string);
                  return d.toDateString() === todayStr539;
                }).length;
                const recent539 = [...shipments]
                  .sort((a, b) => {
                    const getT = (s: Shipment) => {
                      const raw = (s as unknown as Record<string, unknown>).createdAt;
                      if (!raw) return 0;
                      return typeof (raw as { toDate?: () => Date }).toDate === 'function'
                        ? (raw as { toDate: () => Date }).toDate().getTime()
                        : new Date(raw as string).getTime();
                    };
                    return getT(b) - getT(a);
                  })
                  .slice(0, 5);
                const statusColor539 = (st: string) =>
                  st === 'Delivered' ? 'text-emerald-600 bg-emerald-50' :
                  st === 'In Transit' || st === 'Shipped' ? 'text-blue-600 bg-blue-50' :
                  st === 'Pending' ? 'text-amber-600 bg-amber-50' : 'text-gray-500 bg-gray-50';
                return (
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🚚</span>
                        <div>
                          <h3 className="text-sm font-bold text-gray-800">{currentLanguage === 'tr' ? 'Sevkiyat Durumu' : 'Shipments Overview'}</h3>
                          <p className="text-[10px] text-gray-400">{shipments.length} {currentLanguage === 'tr' ? 'toplam sevkiyat' : 'total shipments'}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setShipmentsExpanded(e => !e)}
                        className="text-[10px] font-bold text-gray-400 hover:text-brand transition-colors flex items-center gap-1"
                      >
                        {shipmentsExpanded ? (currentLanguage === 'tr' ? 'Gizle' : 'Hide') : (currentLanguage === 'tr' ? 'Detaylar' : 'Details')}
                        <ChevronDown className={cn("w-3 h-3 transition-transform", shipmentsExpanded && "rotate-180")} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      {[
                        { label: currentLanguage === 'tr' ? 'Yolda'     : 'In Transit',   value: inTransit,  color: 'text-blue-600',    bg: 'bg-blue-50' },
                        { label: currentLanguage === 'tr' ? 'Bekliyor'  : 'Pending',       value: pending539, color: 'text-amber-600',   bg: 'bg-amber-50' },
                        { label: currentLanguage === 'tr' ? 'Bugün Teslim' : 'Del. Today', value: delivToday, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                      ].map(c => (
                        <div key={c.label} className={`text-center rounded-xl p-3 ${c.bg}`}>
                          <p className={`text-xl font-black ${c.color}`}>{c.value}</p>
                          <p className="text-[9px] text-gray-500 leading-tight mt-0.5">{c.label}</p>
                        </div>
                      ))}
                    </div>
                    {/* Phase 539: Expandable recent shipments list */}
                    {shipmentsExpanded && (
                      <div className="border-t border-gray-100 pt-3 space-y-2">
                        {recent539.map(s => (
                          <div key={s.id} className="flex items-center gap-3 text-xs">
                            <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0", statusColor539(s.status))}>
                              {s.status}
                            </span>
                            <span className="font-medium text-gray-800 flex-1 truncate">{s.customerName}</span>
                            <span className="text-gray-400 truncate max-w-[120px]">{(s as unknown as Record<string, string>).destination || '—'}</span>
                            <span className="text-gray-400 shrink-0">{(s as unknown as Record<string, string>).cargoFirm || '—'}</span>
                          </div>
                        ))}
                        <button
                          onClick={() => setActiveTab('lojistik')}
                          className="text-[10px] text-brand font-bold flex items-center gap-1 mt-1"
                        >
                          <ChevronRight className="w-3 h-3" />
                          {currentLanguage === 'tr' ? 'Tüm Sevkiyatlar' : 'All Shipments'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── New ERP Module Quick-Status Strip ── */}
              {(() => {
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* E-Belge status */}
                    <button onClick={() => setActiveTab('ebelge')} className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.01] transition-all group flex flex-col min-h-[120px]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-3.5 h-3.5 text-indigo-600" />
                        </div>
                        <span className="text-xs font-bold text-gray-500 uppercase truncate">{currentLanguage === 'tr' ? 'E-Belge' : 'E-Doc'}</span>
                      </div>
                      <p className="text-xl font-bold text-gray-900 mt-auto">
                        {gibConnected
                          ? (currentLanguage === 'tr' ? 'GIB Bağlı' : 'GIB Connected')
                          : (currentLanguage === 'tr' ? 'GIB Bağlı Değil' : 'GIB Not Connected')}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{currentLanguage === 'tr' ? 'E-Fatura · E-Arşiv · E-İrsaliye' : 'E-Invoice · E-Archive · E-Waybill'}</p>
                      <div className="flex items-center gap-1 mt-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${gibConnected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
                        <span className={`text-[10px] font-semibold ${gibConnected ? 'text-green-600' : 'text-red-500'}`}>
                          {gibConnected ? (currentLanguage === 'tr' ? 'Aktif' : 'Active') : (currentLanguage === 'tr' ? 'Bağlı Değil' : 'Disconnected')}
                        </span>
                      </div>
                    </button>

                    {/* Kasa balance */}
                    <button onClick={() => setActiveTab('muhasebe')} className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.01] transition-all group flex flex-col min-h-[120px]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                          <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                        </div>
                        <span className="text-xs font-bold text-gray-500 uppercase truncate">{currentLanguage === 'tr' ? 'Kasa' : 'Cash'}</span>
                      </div>
                      <p className="text-xl font-bold text-gray-900 mt-auto">
                        {currentLanguage === 'tr' ? 'Kasa Yönetimi' : 'Cash Desk'}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{currentLanguage === 'tr' ? 'Günlük kapanış ve hareketler' : 'Daily close and transactions'}</p>
                      <p className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Kasaya git' : 'Go to cash desk'}
                      </p>
                    </button>

                    {/* Vergi Takvimi — overdue count */}
                    <button onClick={() => setActiveTab('vergi')} className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.01] transition-all group flex flex-col min-h-[120px]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                          <Receipt className="w-3.5 h-3.5 text-amber-600" />
                        </div>
                        <span className="text-xs font-bold text-gray-500 uppercase truncate">{currentLanguage === 'tr' ? 'Vergi Takvimi' : 'Tax Calendar'}</span>
                      </div>
                      <p className="text-xl font-bold text-gray-900 mt-auto">
                        {currentLanguage === 'tr' ? 'Beyanname Takibi' : 'Declaration Tracking'}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{currentLanguage === 'tr' ? 'KDV · Muhtasar · SGK · Geçici Vergi' : 'VAT · WHT · SGK · Provisional Tax'}</p>
                      <p className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Takvimi gör' : 'View calendar'}
                      </p>
                    </button>

                    {/* Bakım — upcoming */}
                    <button onClick={() => setActiveTab('bakim')} className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.01] transition-all group flex flex-col min-h-[120px]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                          <Wrench className="w-3.5 h-3.5 text-orange-600" />
                        </div>
                        <span className="text-xs font-bold text-gray-500 uppercase truncate">{currentLanguage === 'tr' ? 'Bakım' : 'Maintenance'}</span>
                      </div>
                      <p className="text-xl font-bold text-gray-900 mt-auto">
                        {currentLanguage === 'tr' ? 'Ekipman Bakımı' : 'Equipment Maint.'}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{currentLanguage === 'tr' ? 'Önleyici · Düzeltici · Acil iş emirleri' : 'Preventive · Corrective · Emergency orders'}</p>
                      <p className="text-[10px] text-brand mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'İş emirlerine git' : 'View work orders'}
                      </p>
                    </button>
                  </div>
                );
              })()}

              {/* ── Phase 160: Customer Payment Behavior ── */}
              {orders.filter(o => o.paid).length >= 3 && (() => {
                // For paid orders, estimate days to payment (createdAt → updatedAt/paidAt if available, else skip)
                const custPay: Record<string, { name: string; totalPaid: number; totalOrders: number; lateCount: number }> = {};
                for (const o of orders) {
                  if (!o.paid || o.status === 'Cancelled') continue;
                  const name = o.customerName || '—';
                  if (!custPay[name]) custPay[name] = { name, totalPaid: 0, totalOrders: 0, lateCount: 0 };
                  custPay[name].totalPaid += o.totalPrice || 0;
                  custPay[name].totalOrders++;
                  // Simplified late check: if order was old when marked paid (no paidAt field, just heuristic)
                }
                // Also track unpaid customers
                const custUnpaid: Record<string, number> = {};
                for (const o of orders) {
                  if (o.paid || o.status === 'Cancelled') continue;
                  const name = o.customerName || '—';
                  custUnpaid[name] = (custUnpaid[name] ?? 0) + (o.totalPrice || 0);
                }
                const topPayers = Object.values(custPay).sort((a, b) => b.totalPaid - a.totalPaid).slice(0, 5);
                const topDebtors = Object.entries(custUnpaid).sort(([,a],[,b]) => b - a).slice(0, 5);
                const r160 = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
                const s160 = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const f160 = (v: number) => (kpiCurrency === 'TRY' ? v : v / r160).toLocaleString(undefined, { maximumFractionDigits: 0 });
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
                      <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-3">✓ {currentLanguage==='tr'?'En Çok Ödeme Yapanlar':'Top Payers'}</h4>
                      <div className="space-y-2">
                        {topPayers.map((c, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-xs text-gray-700 truncate">{c.name}</span>
                            <span className="text-xs font-bold text-emerald-600 shrink-0 ml-2">{s160}{f160(c.totalPaid)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white border border-amber-100 rounded-2xl shadow-sm p-4">
                      <h4 className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-3">⚠ {currentLanguage==='tr'?'Ödenmemiş Alacak':'Outstanding Receivables'}</h4>
                      <div className="space-y-2">
                        {topDebtors.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-2">{currentLanguage==='tr'?'Bekleyen alacak yok':'No outstanding receivables'}</p>
                        ) : topDebtors.map(([name, amt], i) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-xs text-gray-700 truncate">{name}</span>
                            <span className="text-xs font-bold text-amber-600 shrink-0 ml-2">{s160}{f160(amt)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 103: 6-Month Revenue Bar Chart ── */}
              {orders.length > 0 && (() => {
                const now103 = new Date();
                const months103 = Array.from({ length: 6 }, (_, i) => {
                  const d = new Date(now103.getFullYear(), now103.getMonth() - (5 - i), 1);
                  return { year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' }) };
                });
                const getOD103 = (o: Order): Date => {
                  const raw = o.createdAt ?? o.syncedAt;
                  if (!raw) return new Date(0);
                  return typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
                };
                const data103 = months103.map(m => ({
                  label: m.label,
                  rev: orders.filter(o => { const d = getOD103(o); return d.getFullYear() === m.year && d.getMonth() === m.month && o.status !== 'Cancelled'; }).reduce((s, o) => s + (o.totalPrice || 0), 0),
                }));
                const maxRev103 = Math.max(...data103.map(d => d.rev), 1);
                const rate103 = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
                const sym103 = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                        <BarChart3 className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Son 6 Ay Ciro' : 'Last 6 Months Revenue'}
                      </h3>
                    </div>
                    <div className="flex items-end gap-2 h-28">
                      {data103.map((m, i) => {
                        const h = maxRev103 > 0 ? Math.max((m.rev / maxRev103) * 100, m.rev > 0 ? 4 : 0) : 0;
                        const isCurrentMonth = i === 5;
                        const cvt = kpiCurrency === 'TRY' ? m.rev : m.rev / rate103;
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
                            <div
                              title={`${sym103}${cvt.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`}
                              className={`w-full rounded-t-lg transition-all duration-700 ${isCurrentMonth ? 'bg-brand' : darkMode ? 'bg-white/20 hover:bg-white/30' : 'bg-gray-200 hover:bg-gray-300'}`}
                              style={{ height: `${h}%`, minHeight: m.rev > 0 ? '4px' : '0' }}
                            />
                            <span className={cn("text-[9px] font-bold", isCurrentMonth ? 'text-brand' : darkMode ? 'text-white/40' : 'text-gray-400')}>{m.label}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between mt-2 text-[9px] text-gray-400">
                      <span>0</span>
                      <span>{sym103}{(kpiCurrency === 'TRY' ? maxRev103 : maxRev103 / rate103).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</span>
                    </div>
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
                const p79Rate   = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
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

              {/* ── Phase 106: Revenue Donut by Customer Type ── */}
              {orders.length > 0 && (() => {
                type Seg = { label: string; color: string; rev: number };
                const ct106 = (o: Order) => (o.customerType as unknown as string) || '';
                const segs: Seg[] = [
                  { label: 'B2B',                                             color: '#3b82f6', rev: orders.filter(o => ct106(o) === 'B2B').reduce((s, o) => s + (o.totalPrice || 0), 0) },
                  { label: currentLanguage === 'tr' ? 'Bayi' : 'Dealer',      color: '#ff4000', rev: orders.filter(o => ct106(o) === 'Dealer').reduce((s, o) => s + (o.totalPrice || 0), 0) },
                  { label: currentLanguage === 'tr' ? 'Perakende' : 'Retail', color: '#6b7280', rev: orders.filter(o => { const c = ct106(o); return !c || (c !== 'B2B' && c !== 'Dealer'); }).reduce((s, o) => s + (o.totalPrice || 0), 0) },
                ];
                const total106 = segs.reduce((s, seg) => s + seg.rev, 0);
                if (total106 === 0) return null;
                const p106Rate = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
                const p106Sym  = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const cvt106   = (v: number) => (kpiCurrency === 'TRY' ? v : v / p106Rate).toLocaleString('tr-TR', { maximumFractionDigits: 0 });

                // SVG donut: r=40, circumference=251.3
                const R = 40, C = 2 * Math.PI * R;
                let offset = 0;
                const paths = segs.filter(s => s.rev > 0).map(s => {
                  const pct = s.rev / total106;
                  const dash = pct * C;
                  const gap  = C - dash;
                  const el = { ...s, pct, dash, gap, offset };
                  offset += dash;
                  return el;
                });
                const bigSeg = [...segs].sort((a, b) => b.rev - a.rev)[0];

                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-4", darkMode ? "text-white/50" : "text-gray-400")}>
                      {currentLanguage === 'tr' ? 'Müşteri Tipi Bazında Ciro' : 'Revenue by Customer Type'}
                    </h3>
                    <div className="flex items-center gap-6">
                      {/* Donut */}
                      <div className="relative flex-shrink-0">
                        <svg width="96" height="96" viewBox="0 0 96 96">
                          <circle cx="48" cy="48" r={R} fill="none" stroke="#f3f4f6" strokeWidth="14" />
                          {paths.map((p, i) => (
                            <circle
                              key={i}
                              cx="48" cy="48" r={R}
                              fill="none"
                              stroke={p.color}
                              strokeWidth="14"
                              strokeDasharray={`${p.dash} ${p.gap}`}
                              strokeDashoffset={-p.offset + C * 0.25}
                              className="transition-all duration-700"
                            />
                          ))}
                        </svg>
                        {/* Center label */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                          <span className="text-[9px] font-bold text-gray-400 leading-none">
                            {bigSeg.label}
                          </span>
                          <span className="text-sm font-black text-gray-900 leading-none mt-0.5">
                            {Math.round((bigSeg.rev / total106) * 100)}%
                          </span>
                        </div>
                      </div>
                      {/* Legend */}
                      <div className="flex-1 space-y-3">
                        {segs.filter(s => s.rev > 0).map((s, i) => {
                          const pct = Math.round((s.rev / total106) * 100);
                          return (
                            <div key={i} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                                  <span className="text-xs font-semibold text-gray-700">{s.label}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-gray-400">{p106Sym}{cvt106(s.rev)}</span>
                                  <span className="text-[10px] font-black text-gray-600 w-7 text-right">{pct}%</span>
                                </div>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: s.color }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 124: Customer Segment Profitability ── */}
              {orders.length > 0 && inventory.length > 0 && (() => {
                // Build per-customer-type revenue vs estimated COGS
                type SegProfit = { type: string; revenue: number; cogs: number; margin: number; orderCount: number; avgOrder: number };
                const segMap: Record<string, SegProfit> = {};
                for (const o of orders) {
                  if (o.status === 'Cancelled') continue;
                  const type = o.customerType || 'Retail';
                  if (!segMap[type]) segMap[type] = { type, revenue: 0, cogs: 0, margin: 0, orderCount: 0, avgOrder: 0 };
                  segMap[type].revenue += o.totalPrice || 0;
                  segMap[type].orderCount++;
                  // Estimate COGS from lineItems
                  const cogsCost = (o.lineItems || []).reduce((s, li) => {
                    const inv = inventory.find(i => i.id === li.inventoryId || i.name === li.name);
                    return s + (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
                  }, 0);
                  segMap[type].cogs += cogsCost;
                }
                const segs = Object.values(segMap).map(s => ({
                  ...s,
                  margin: s.revenue > 0 ? Math.round(((s.revenue - s.cogs) / s.revenue) * 100) : 0,
                  avgOrder: s.orderCount > 0 ? s.revenue / s.orderCount : 0,
                })).sort((a, b) => b.revenue - a.revenue);
                if (segs.length === 0) return null;
                const colors = { 'B2B': '#3b82f6', 'Retail': '#10b981', 'Dealer': '#f59e0b', 'Other': '#8b5cf6' };
                const maxRev = Math.max(...segs.map(s => s.revenue));
                return (
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                      <span className="text-base">💰</span>
                      <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Segment Kârlılığı' : 'Segment Profitability'}</h3>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {segs.map(s => {
                        const barColor = (colors as Record<string, string>)[s.type] || '#6b7280';
                        return (
                          <div key={s.type} className="px-5 py-4">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: barColor }} />
                                <p className="text-sm font-bold text-gray-800">{s.type}</p>
                                <span className="text-[10px] text-gray-400">{s.orderCount} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs">
                                <span className="text-gray-500">{fmtKpi(s.revenue,'K',1)}</span>
                                <span className={`font-bold ${s.margin >= 30 ? 'text-emerald-600' : s.margin >= 15 ? 'text-amber-600' : 'text-red-500'}`}>
                                  %{s.margin} {currentLanguage === 'tr' ? 'marj' : 'margin'}
                                </span>
                              </div>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                              <div className="h-2 rounded-full transition-all duration-700" style={{ width: `${(s.revenue / maxRev) * 100}%`, backgroundColor: barColor }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="px-5 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
                      {currentLanguage === 'tr' ? 'Maliyet tahmini: Ürün maliyeti × miktar' : 'COGS estimated from product cost × quantity'}
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
                const costValue   = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
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
                        const ivRate = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
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
                const mtdTopRate   = kpiCurrency === 'USD' ? (exchangeRates?.USD ?? FX_FALLBACK.USD) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR ?? FX_FALLBACK.EUR) : 1;
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
                    <button onClick={() => {
                      setRecentlyViewed([]);
                      const uid = auth.currentUser?.uid;
                      if (uid) setDoc(doc(db, 'userPrefs', uid), { recentlyViewed: [] }, { merge: true }).catch(() => {});
                    }}
                      className="text-[10px] text-gray-400 hover:text-gray-600 px-2 py-1.5 ml-auto self-center transition-colors">
                      {currentLanguage === 'tr' ? 'Temizle' : 'Clear'}
                    </button>
                  </div>
                </div>
              )}
          {/* ── Phase 595: Görevler & Hatırlatıcılar ─────────────────────── */}
          {activeTab === 'dashboard' && (() => {
            const tr595 = currentLanguage === 'tr';
            const today595 = new Date().toISOString().slice(0,10);
            const overdueTasks = p595Tasks.filter(t => !t.done && t.dueDate < today595);
            const todayTasks = p595Tasks.filter(t => !t.done && t.dueDate === today595);
            const prioColors595: Record<string,string> = {'Kritik':'border-l-red-500 bg-red-50/30','Yüksek':'border-l-orange-400 bg-orange-50/20','Orta':'border-l-amber-300 bg-amber-50/10','Düşük':'border-l-gray-300 bg-gray-50/50'};
            const prioBadge595: Record<string,string> = {'Kritik':'bg-red-100 text-red-700','Yüksek':'bg-orange-100 text-orange-700','Orta':'bg-amber-100 text-amber-700','Düşük':'bg-gray-100 text-gray-500'};
            return (
              <div className="apple-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm">{tr595?'📌 Görevler & Hatırlatıcılar':'📌 Tasks & Reminders'}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {overdueTasks.length>0&&<span className="text-red-500 font-bold">{overdueTasks.length} {tr595?'gecikmiş · ':'overdue · '}</span>}
                      {todayTasks.length>0&&<span className="text-amber-600 font-bold">{todayTasks.length} {tr595?'bugün vadeli · ':'due today · '}</span>}
                      {p595Tasks.filter(t=>!t.done).length} {tr595?'açık görev':'open task(s)'}
                    </p>
                  </div>
                  <button onClick={()=>setP595ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{tr595?'Görev Ekle':'Add Task'}</button>
                </div>
                {p595ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <input className="apple-input px-3 py-2 text-sm col-span-2" placeholder={tr595?'Görev başlığı...':'Task title...'} value={p595Draft.title} onChange={e=>setP595Draft(d=>({...d,title:e.target.value}))} />
                      <input type="date" className="apple-input px-3 py-2 text-sm" value={p595Draft.dueDate} onChange={e=>setP595Draft(d=>({...d,dueDate:e.target.value}))} />
                      <select className="apple-input px-3 py-2 text-sm" value={p595Draft.priority} onChange={e=>setP595Draft(d=>({...d,priority:e.target.value as typeof d.priority}))}>
                        <option value="Düşük">{tr595?'Düşük':'Low'}</option>
                        <option value="Orta">{tr595?'Orta':'Medium'}</option>
                        <option value="Yüksek">{tr595?'Yüksek':'High'}</option>
                        <option value="Kritik">{tr595?'Kritik':'Critical'}</option>
                      </select>
                      <input className="apple-input px-3 py-2 text-sm" placeholder={tr595?'Atanan kişi':'Assigned to'} value={p595Draft.assignedTo} onChange={e=>setP595Draft(d=>({...d,assignedTo:e.target.value}))} />
                      <input className="apple-input px-3 py-2 text-sm" placeholder={tr595?'Modül (ör. CRM, Stok)':'Module (e.g. CRM, Stock)'} value={p595Draft.module} onChange={e=>setP595Draft(d=>({...d,module:e.target.value}))} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async ()=>{
                        if(!p595Draft.title) return;
                        try { await addDoc(collection(db,'workflowTasks'),{title:p595Draft.title,dueDate:p595Draft.dueDate||today595,assignedTo:p595Draft.assignedTo,module:p595Draft.module,priority:p595Draft.priority,done:false,createdAt:serverTimestamp()}); toast(currentLanguage === 'tr' ? 'Görev eklendi ✓' : 'Task added ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(currentLanguage === 'tr' ? 'Görev eklenemedi.' : 'Failed to add task.', 'error');}
                        setP595Draft({title:'',dueDate:'',assignedTo:'',module:'',priority:'Orta'});
                        setP595ShowForm(false);
                      }} className="apple-button-primary text-sm px-4 py-1.5">{tr595?'Kaydet':'Save'}</button>
                      <button onClick={()=>setP595ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{tr595?'İptal':'Cancel'}</button>
                    </div>
                  </div>
                )}
                {p595Tasks.length===0 ? (
                  <p className="text-center py-6 text-gray-400 text-sm">{tr595?'Henüz görev yok. "Görev Ekle" ile başlayın.':'No tasks yet. Click "Add Task" to start.'}</p>
                ) : (
                  <div className="space-y-2">
                    {p595Tasks.filter(t=>!t.done).sort((a,b)=>{
                      const pOrder = {Kritik:0,Yüksek:1,Orta:2,Düşük:3};
                      return (pOrder[a.priority]||3)-(pOrder[b.priority]||3) || a.dueDate.localeCompare(b.dueDate);
                    }).map(t=>(
                      <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border border-l-4 ${prioColors595[t.priority]}`}>
                        <button onClick={async ()=>{try{await updateDoc(doc(db,'workflowTasks',t.id),{done:true});}catch(e){console.error("[firestore]", e);}}} className="w-5 h-5 rounded border-2 border-gray-300 hover:border-emerald-500 flex-shrink-0 transition-colors" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{t.title}</p>
                          <p className="text-xs text-gray-400">
                            {t.dueDate&&<span className={t.dueDate<today595?'text-red-500 font-bold':t.dueDate===today595?'text-amber-600 font-bold':''}>{t.dueDate} · </span>}
                            {t.assignedTo&&<span>{t.assignedTo} · </span>}
                            {t.module&&<span className="text-blue-500">{t.module}</span>}
                          </p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${prioBadge595[t.priority]}`}>{t.priority}</span>
                        <button onClick={async ()=>{if(!await confirmDelete(undefined, currentLanguage==='tr'?'tr':'en'))return;try{await deleteDoc(doc(db,'workflowTasks',t.id));}catch(e){console.error("[firestore]", e);}}} className="text-gray-300 hover:text-red-400 shrink-0">✕</button>
                      </div>
                    ))}
                    {p595Tasks.filter(t=>t.done).length>0&&(
                      <p className="text-xs text-gray-400 text-center pt-1">✓ {p595Tasks.filter(t=>t.done).length} {tr595?'tamamlanan görev':'completed task(s)'} &nbsp;
                        <button onClick={async ()=>{if(!await confirmDelete(undefined, currentLanguage==='tr'?'tr':'en'))return;p595Tasks.filter(t=>t.done).forEach(t=>deleteDoc(doc(db,'workflowTasks',t.id)));}} className="text-red-400 hover:text-red-600">{tr595?'Temizle':'Clear'}</button>
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

            </motion.div>
          )}

          {/* ── Reports Dashboard ── */}
          {activeTab === 'reports' && (
            <motion.div key="reports" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <React.Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-brand border-t-transparent rounded-full" /></div>}>
                <RaporlarPage
                  canAccess={canAccess} hasFullAccess={hasFullAccess}
                  currentLanguage={currentLanguage} currentT={currentT}
                  orders={orders} leads={leads} inventory={inventory}
                  exchangeRates={exchangeRates} userRole={userRole} employees={employees}
                  appQuotations={appQuotations} inventoryMovements={inventoryMovements}
                  recurringOrders={recurringOrders} appReportsTab={appReportsTab}
                  setAppReportsTab={setAppReportsTab} onNavigate={setActiveTab}
                  p570Targets={p570Targets} setP570Targets={setP570Targets}
                  fmtKpi={fmtKpi}
                />
              </React.Suspense>
            </motion.div>
          )}

          {/* ── Muhasebe & Finans ── */}
          {/* ── Muhasebe & Finans ── */}
          {activeTab === 'muhasebe' && (
            <React.Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-brand border-t-transparent rounded-full" /></div>}>
              <MuhasebePage
                currentLanguage={currentLanguage}
                currentT={currentT}
                canAccess={canAccess}
                hasFullAccess={hasFullAccess}
                user={user}
                userRole={userRole}
                orders={orders}
                employees={employees}
                warehouses={warehouses}
                suppliers={suppliers}
                inventory={inventory}
                leads={leads}
                exchangeRates={exchangeRates}
                fmtKpi={fmtKpi}
                createNotification={createNotification}
                toast={toast}
                setActiveTab={setActiveTab}
                kpiCurrency={kpiCurrency}
                setKpiCurrency={setKpiCurrency}
                fxPos={fxPos}
                updateFx={updateFx}
                refreshFxRates={refreshFxRates}
                fxRefreshing={fxRefreshing}
                muhasebeTab={muhasebeTab}
                setMuhasebeTab={setMuhasebeTab}
                budgets={budgets}
                setBudgets={setBudgets}
                allBudgetsFirestore={allBudgetsFirestore}
                setAllBudgetsFirestore={setAllBudgetsFirestore}
                budgetDraft={budgetDraft}
                setBudgetDraft={setBudgetDraft}
                budgetMonth={budgetMonth}
                setBudgetMonth={setBudgetMonth}
                butceCurrency={butceCurrency}
                setButceCurrency={setButceCurrency}
                apPurchaseOrders={apPurchaseOrders}
                setApPurchaseOrders={setApPurchaseOrders}
                apCurrency={apCurrency}
                setApCurrency={setApCurrency}
                p607ReminderDays={p607ReminderDays}
                setP607ReminderDays={setP607ReminderDays}
                bankBalance={bankBalance}
                setBankBalance={setBankBalance}
                bankBalanceDraft={bankBalanceDraft}
                setBankBalanceDraft={setBankBalanceDraft}
                bankBalanceEditing={bankBalanceEditing}
                setBankBalanceEditing={setBankBalanceEditing}
                reconMonth={reconMonth}
                setReconMonth={setReconMonth}
                p547BankAccounts={p547BankAccounts}
                setP547BankAccounts={setP547BankAccounts}
                p547FixedAssets={p547FixedAssets}
                setP547FixedAssets={setP547FixedAssets}
                p548Masraflar={p548Masraflar}
                setP548Masraflar={setP548Masraflar}
                p548Form={p548Form}
                setP548Form={setP548Form}
                p548Draft={p548Draft}
                setP548Draft={setP548Draft}
                p555Period={p555Period}
                setP555Period={setP555Period}
                p559Customer={p559Customer}
                setP559Customer={setP559Customer}
                p560ApprovalThreshold={p560ApprovalThreshold}
                setP560ApprovalThreshold={setP560ApprovalThreshold}
                p563PnlCurrency={p563PnlCurrency}
                setP563PnlCurrency={setP563PnlCurrency}
                p564FaturaFilter={p564FaturaFilter}
                setP564FaturaFilter={setP564FaturaFilter}
                p573Rules={p573Rules}
                setP573Rules={setP573Rules}
                p573Draft={p573Draft}
                setP573Draft={setP573Draft}
                p573ShowForm={p573ShowForm}
                setP573ShowForm={setP573ShowForm}
                p557Scenario={p557Scenario}
                setP557Scenario={setP557Scenario}
                p558Year={p558Year}
                setP558Year={setP558Year}
                p580Year={p580Year}
                setP580Year={setP580Year}
                p591Schedules={p591Schedules}
                setP591Schedules={setP591Schedules}
                p591ShowForm={p591ShowForm}
                setP591ShowForm={setP591ShowForm}
                p591Draft={p591Draft}
                setP591Draft={setP591Draft}
                p597Contracts={p597Contracts}
                setP597Contracts={setP597Contracts}
                p597ShowForm={p597ShowForm}
                setP597ShowForm={setP597ShowForm}
                p597Draft={p597Draft}
                setP597Draft={setP597Draft}
                p610Period={p610Period}
                setP610Period={setP610Period}
                p617Month={p617Month}
                setP617Month={setP617Month}
                p623LCs={p623LCs}
                setP623LCs={setP623LCs}
                p623ShowForm={p623ShowForm}
                setP623ShowForm={setP623ShowForm}
                p623Draft={p623Draft}
                setP623Draft={setP623Draft}
                p625BudgetYear={p625BudgetYear}
                setP625BudgetYear={setP625BudgetYear}
                p625BudgetData={p625BudgetData}
                setP625BudgetData={setP625BudgetData}
                p625EditMonth={p625EditMonth}
                setP625EditMonth={setP625EditMonth}
                p630InvoicePeriod={p630InvoicePeriod}
                setP630InvoicePeriod={setP630InvoicePeriod}
                p634Period={p634Period}
                setP634Period={setP634Period}
                p638MatchResults={p638MatchResults}
                setP638MatchResults={setP638MatchResults}
                p638Running={p638Running}
                setP638Running={setP638Running}
                p640Subs={p640Subs}
                setP640Subs={setP640Subs}
                p640ShowForm={p640ShowForm}
                setP640ShowForm={setP640ShowForm}
                p640Draft={p640Draft}
                setP640Draft={setP640Draft}
                p643Txns={p643Txns}
                setP643Txns={setP643Txns}
                p643ShowForm={p643ShowForm}
                setP643ShowForm={setP643ShowForm}
                p643Draft={p643Draft}
                setP643Draft={setP643Draft}
              />
            </React.Suspense>
          )}


          {/* ── Satın Alma ── */}
          {activeTab === 'satin-alma' && (
            <React.Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-brand border-t-transparent rounded-full" /></div>}>
              <SatinAlmaPage
                currentLanguage={currentLanguage}
                canAccess={canAccess}
                hasFullAccess={hasFullAccess}
                user={user}
                userRole={userRole}
                darkMode={darkMode}
                orders={orders}
                inventory={inventory}
                suppliers={suppliers}
                exchangeRates={exchangeRates}
                fmtKpi={fmtKpi}
                toast={toast}
                setActiveTab={setActiveTab}
                kpiCurrency={kpiCurrency}
                setKpiCurrency={setKpiCurrency}
                purchasingSubTab={purchasingSubTab}
                setPurchasingSubTab={setPurchasingSubTab}
                apPurchaseOrders={apPurchaseOrders}
                addingSupplier={addingSupplier}
                setAddingSupplier={setAddingSupplier}
                editingSupplier={editingSupplier}
                setEditingSupplier={setEditingSupplier}
                supplierSearch={supplierSearch}
                setSupplierSearch={setSupplierSearch}
                newSupplier={newSupplier}
                setNewSupplier={setNewSupplier}
                vknLookupLoading={vknLookupLoading}
                vknLookupMsg={vknLookupMsg}
                setVknLookupMsg={setVknLookupMsg}
                handleVknLookup={handleVknLookup}
                handleSaveSupplier={handleSaveSupplier}
                handleDeleteSupplier={handleDeleteSupplier}
                quickPOProduct={quickPOProduct}
                setQuickPOProduct={setQuickPOProduct}
                p551SelSupplier={p551SelSupplier}
                setP551SelSupplier={setP551SelSupplier}
                p567Ratings={p567Ratings}
                setP567Ratings={setP567Ratings}
                p578Threshold={p578Threshold}
                setP578Threshold={setP578Threshold}
                p608SelProduct={p608SelProduct}
                setP608SelProduct={setP608SelProduct}
                p608Quotes={p608Quotes}
                setP608Quotes={setP608Quotes}
                p608ShowForm={p608ShowForm}
                setP608ShowForm={setP608ShowForm}
                p608Draft={p608Draft}
                setP608Draft={setP608Draft}
                p612Budgets={p612Budgets}
                setP612Budgets={setP612Budgets}
                p612ShowForm={p612ShowForm}
                setP612ShowForm={setP612ShowForm}
                p612Draft={p612Draft}
                setP612Draft={setP612Draft}
                p627Risks={p627Risks}
                setP627Risks={setP627Risks}
                p627ShowForm={p627ShowForm}
                setP627ShowForm={setP627ShowForm}
                p627Draft={p627Draft}
                setP627Draft={setP627Draft}
              />
            </React.Suspense>
          )}

          {/* ── Phase 552: Mesai & Devam (Time & Attendance) ──────────────────── */}
          {activeTab === 'mesai' && (() => {
            const tr552 = currentLanguage === 'tr';
            const today552 = new Date().toISOString().slice(0,10);
            // Stats
            const totalHours = p552Records.reduce((s,r) => s + (r.totalHours||0), 0);
            const avgHours   = p552Records.length ? (totalHours / p552Records.length).toFixed(1) : '0';
            const lateCount  = p552Records.filter(r => r.status === 'Geç Giriş').length;
            const absentCount = p552Records.filter(r => r.status === 'Devamsız').length;
            const calcHours = (ci: string, co: string) => {
              const [h1,m1] = ci.split(':').map(Number); const [h2,m2] = co.split(':').map(Number);
              return Math.max(0, parseFloat(((h2*60+m2 - h1*60-m1)/60).toFixed(1)));
            };
            const statusFor = (ci: string) => {
              const [h] = ci.split(':').map(Number);
              if (h > 9) return 'Geç Giriş';
              return 'Normal';
            };
            return (
              <motion.div key="mesai" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} className="space-y-4">
                <ModuleHeader
                  title={tr552?'Mesai & Devam Takibi':'Time & Attendance'}
                  subtitle={tr552?'Çalışan giriş-çıkış kayıtları ve devam analizi':'Employee check-in/out records and attendance analysis'}
                  icon={Clock}
                  actionButton={hasFullAccess('ik') ? (
                    <button onClick={()=>setP552AddForm(f=>!f)} className="apple-button-primary px-4 py-2 text-sm flex items-center gap-1.5">
                      <Plus className="w-3.5 h-3.5" />{tr552?'Kayıt Ekle':'Add Record'}
                    </button>
                  ) : undefined}
                />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: tr552?'Toplam Kayıt':'Total Records',  v: String(p552Records.length), color:'text-blue-600',   bg:'bg-blue-50' },
                    { label: tr552?'Ort. Çalışma':'Avg Hours/Day', v: `${avgHours}h`,              color:'text-emerald-600',bg:'bg-emerald-50' },
                    { label: tr552?'Geç Giriş':'Late Arrivals',    v: String(lateCount),           color:'text-orange-600', bg:'bg-orange-50' },
                    { label: tr552?'Devamsız':'Absent',            v: String(absentCount),         color:'text-red-600',    bg:'bg-red-50' },
                  ].map(k=>(
                    <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{k.label}</p>
                      <p className={`text-2xl font-bold ${k.color}`}>{k.v}</p>
                    </div>
                  ))}
                </div>
                {p552AddForm && (
                  <div className="apple-card p-5 border-2 border-brand/20 space-y-3">
                    <h4 className="font-bold text-gray-800">{tr552?'Yeni Mesai Kaydı':'New Attendance Record'}</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <input value={p552Draft.employeeName} onChange={e=>setP552Draft(d=>({...d,employeeName:e.target.value}))} placeholder={tr552?'Çalışan Adı':'Employee Name'} className="apple-input px-3 py-2 text-sm" />
                      <input type="date" value={p552Draft.date} onChange={e=>setP552Draft(d=>({...d,date:e.target.value}))} className="apple-input px-3 py-2 text-sm" />
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 shrink-0">{tr552?'Giriş':'In'}</label>
                        <input type="time" value={p552Draft.checkIn} onChange={e=>setP552Draft(d=>({...d,checkIn:e.target.value}))} className="apple-input px-3 py-2 text-sm flex-1" />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 shrink-0">{tr552?'Çıkış':'Out'}</label>
                        <input type="time" value={p552Draft.checkOut} onChange={e=>setP552Draft(d=>({...d,checkOut:e.target.value}))} className="apple-input px-3 py-2 text-sm flex-1" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async()=>{
                        if(!p552Draft.employeeName) return;
                        const hours = calcHours(p552Draft.checkIn, p552Draft.checkOut);
                        const status = statusFor(p552Draft.checkIn);
                        await addDoc(collection(db,'timeAttendance'),{...p552Draft,totalHours:hours,status,createdAt:serverTimestamp()});
                        setP552AddForm(false); setP552Draft({employeeName:'',date:today552,checkIn:'09:00',checkOut:'18:00'});
                      }} className="apple-button-primary px-4 py-2 text-sm">{tr552?'Kaydet':'Save'}</button>
                      <button onClick={()=>setP552AddForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{tr552?'İptal':'Cancel'}</button>
                    </div>
                  </div>
                )}
                <div className="apple-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-100 bg-gray-50/60">
                        <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase">{tr552?'Çalışan':'Employee'}</th>
                        <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase hidden sm:table-cell">{tr552?'Tarih':'Date'}</th>
                        <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{tr552?'Giriş':'Check-In'}</th>
                        <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{tr552?'Çıkış':'Check-Out'}</th>
                        <th className="px-4 py-2.5 text-right text-xs font-bold text-gray-400 uppercase">{tr552?'Saat':'Hours'}</th>
                        <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{tr552?'Durum':'Status'}</th>
                      </tr></thead>
                      <tbody>
                        {p552Records.map(r=>{
                          const sc = r.status==='Normal'?'bg-emerald-100 text-emerald-700':r.status==='Geç Giriş'?'bg-orange-100 text-orange-700':r.status==='Devamsız'?'bg-red-100 text-red-700':'bg-blue-100 text-blue-700';
                          return (
                            <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="px-4 py-2.5 font-medium text-gray-800">{r.employeeName}</td>
                              <td className="px-4 py-2.5 text-gray-500 text-xs hidden sm:table-cell">{r.date}</td>
                              <td className="px-4 py-2.5 text-center text-gray-700 tabular-nums">{r.checkIn}</td>
                              <td className="px-4 py-2.5 text-center text-gray-700 tabular-nums">{r.checkOut}</td>
                              <td className="px-4 py-2.5 text-right font-bold text-gray-800 tabular-nums">{r.totalHours}h</td>
                              <td className="px-4 py-2.5 text-center"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sc}`}>{r.status}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {p552Records.length===0 && (
                    <div className="text-center py-12 space-y-2">
                      <Clock className="w-10 h-10 text-gray-200 mx-auto" />
                      <p className="text-gray-400 text-sm">{tr552?'"Kayıt Ekle" ile mesai takibine başlayın':'Click "Add Record" to start tracking attendance'}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })()}

          {/* ── Phase 553: Çalışan Self-Servis Portalı ───────────────────────── */}
          {activeTab === 'selfservis' && (() => {
            const tr553 = currentLanguage === 'tr';
            // Find current user's employee record by email
            const myEmp = employees.find(e => e.email === user?.email);
            const myPayrolls = payrolls.filter(p => myEmp && (p.employeeId === myEmp.id || p.employeeName === myEmp.name)).sort((a,b) => {
              const ay = a.year*100+a.month; const by = b.year*100+b.month; return by-ay;
            });
            return (
              <motion.div key="selfservis" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} className="space-y-4">
                <ModuleHeader title={tr553?'Self-Servis Portalım':'My Self-Service Portal'} subtitle={tr553?'Kişisel bilgiler, maaş bordroları ve izin bakiyeniz':'Personal info, payslips and leave balance'} icon={UserCheck} />
                {!myEmp ? (
                  <div className="apple-card p-8 text-center space-y-3">
                    <Users className="w-12 h-12 text-gray-200 mx-auto" />
                    <p className="text-gray-400">{tr553?'Hesabınıza bağlı bir çalışan kaydı bulunamadı.':'No employee record found linked to your account.'}</p>
                    <p className="text-xs text-gray-400">{tr553?`(${user?.email})`:`(${user?.email})`}</p>
                  </div>
                ) : (
                  <>
                    {/* Employee card */}
                    <div className="apple-card p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center shrink-0">
                        <span className="text-2xl font-black text-brand">{myEmp.name.charAt(0)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-900 text-lg">{myEmp.name}</p>
                        <p className="text-sm text-gray-500">{myEmp.position} · {myEmp.department}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{myEmp.email} · {myEmp.phone}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-gray-400">{tr553?'Başlangıç':'Start Date'}</p>
                        <p className="font-semibold text-gray-700">{myEmp.startDate}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 inline-block ${myEmp.status==='Aktif'?'bg-emerald-100 text-emerald-700':'bg-gray-100 text-gray-600'}`}>{myEmp.status}</span>
                      </div>
                    </div>
                    {/* Payroll history */}
                    <div className="apple-card p-5">
                      <h4 className="font-bold text-gray-800 mb-3">{tr553?'Maaş Geçmişi':'Payroll History'}</h4>
                      {myPayrolls.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-6">{tr553?'Bordro kaydı bulunamadı.':'No payroll records found.'}</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead><tr className="border-b border-gray-100">
                              <th className="py-2 text-left text-xs font-bold text-gray-400 uppercase">{tr553?'Dönem':'Period'}</th>
                              <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{tr553?'Brüt':'Gross'}</th>
                              <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{tr553?'Kesinti':'Deductions'}</th>
                              <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{tr553?'Net':'Net'}</th>
                              <th className="py-2 text-center text-xs font-bold text-gray-400 uppercase">{tr553?'Durum':'Status'}</th>
                            </tr></thead>
                            <tbody>
                              {myPayrolls.slice(0,12).map((p,i) => (
                                <tr key={i} className="border-b border-gray-50">
                                  <td className="py-2 text-gray-700">{p.year}/{String(p.month).padStart(2,'0')}</td>
                                  <td className="py-2 text-right tabular-nums text-gray-600">₺{((p.baseSalary||0)+(p.bonus||0)).toLocaleString('tr-TR')}</td>
                                  <td className="py-2 text-right tabular-nums text-red-500">-₺{(p.deductions||0).toLocaleString('tr-TR')}</td>
                                  <td className="py-2 text-right tabular-nums font-bold text-emerald-700">₺{(p.netSalary||0).toLocaleString('tr-TR')}</td>
                                  <td className="py-2 text-center"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.status==='Ödendi'?'bg-emerald-100 text-emerald-700':'bg-orange-100 text-orange-700'}`}>{p.status}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                    {/* Mesai summary */}
                    {p552Records.filter(r=>r.employeeName===myEmp.name).length > 0 && (
                      <div className="apple-card p-5">
                        <h4 className="font-bold text-gray-800 mb-3">{tr553?'Mesai Özeti (Son 30 Gün)':'Attendance Summary (Last 30 Days)'}</h4>
                        {(() => {
                          const cut = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
                          const myRecs = p552Records.filter(r=>r.employeeName===myEmp.name && r.date>=cut);
                          const totalH = myRecs.reduce((s,r)=>s+(r.totalHours||0),0);
                          return (
                            <div className="grid grid-cols-3 gap-3">
                              {[
                                { label: tr553?'Gün':'Days', v: myRecs.length, color:'text-blue-600' },
                                { label: tr553?'Toplam Saat':'Total Hours', v: `${totalH.toFixed(0)}h`, color:'text-emerald-600' },
                                { label: tr553?'Geç Giriş':'Late', v: myRecs.filter(r=>r.status==='Geç Giriş').length, color:'text-orange-600' },
                              ].map(k=>(
                                <div key={k.label} className="text-center">
                                  <p className={`text-2xl font-bold ${k.color}`}>{k.v}</p>
                                  <p className="text-xs text-gray-400 mt-0.5">{k.label}</p>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            );
          })()}

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
                  {/* ── Phase 117: Payroll Basic ── */}
                  {employees.length > 0 && (() => {
                    // Turkish payroll calculation (simplified)
                    const SGK_EMP    = 0.14;   // employee SGK
                    const UNEMP_EMP  = 0.01;   // employee unemployment insurance
                    const SGK_EMPL   = 0.205;  // employer SGK
                    const UNEMP_EMPL = 0.02;   // employer unemployment insurance
                    const incomeTax  = (taxBase: number) => {
                      let tax = 0, remaining = taxBase;
                      const brackets = [[70000, 0.15], [80000, 0.20], [220000, 0.27], [1530000, 0.35]] as [number, number][];
                      for (const [limit, rate] of brackets) {
                        if (remaining <= 0) break;
                        const chunk = Math.min(remaining, limit);
                        tax += chunk * rate;
                        remaining -= chunk;
                      }
                      if (remaining > 0) tax += remaining * 0.40;
                      return tax;
                    };

                    const activeEmps = employees.filter(e => e.status === 'Aktif');
                    const payroll = activeEmps.map(e => {
                      const gross = e.salary || 0;
                      const sgkEmp   = Math.round(gross * SGK_EMP);
                      const unempEmp = Math.round(gross * UNEMP_EMP);
                      const taxBase  = gross - sgkEmp - unempEmp;
                      const tax      = Math.round(incomeTax(taxBase));
                      const net      = gross - sgkEmp - unempEmp - tax;
                      const employerCost = gross + Math.round(gross * SGK_EMPL) + Math.round(gross * UNEMP_EMPL);
                      return { ...e, gross, sgkEmp, unempEmp, tax, net, employerCost };
                    });
                    const totals = payroll.reduce((acc, p) => ({
                      gross: acc.gross + p.gross, net: acc.net + p.net,
                      tax: acc.tax + p.tax, cost: acc.cost + p.employerCost,
                    }), { gross: 0, net: 0, tax: 0, cost: 0 });

                    return (
                      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <DollarSign size={16} className="text-gray-400" />
                            <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Bordro Özeti' : 'Payroll Summary'}</h3>
                          </div>
                          <div className="flex items-center gap-2">
                            <KpiCurrencyToggle kpiCurrency={kpiCurrency} setKpiCurrency={setKpiCurrency} />
                            <input type="month" value={payrollMonth} onChange={e => setPayrollMonth(e.target.value)} className="apple-input text-xs px-2 py-1" />
                            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                              {(['summary', 'detail'] as const).map(v => (
                                <button key={v} onClick={() => setPayrollView(v)}
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md transition-all ${payrollView === v ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400'}`}>
                                  {v === 'summary' ? (currentLanguage === 'tr' ? 'Özet' : 'Summary') : (currentLanguage === 'tr' ? 'Detay' : 'Detail')}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {payrollView === 'summary' ? (
                          <div className="p-5">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                              {[
                                { label: currentLanguage === 'tr' ? 'Toplam Brüt' : 'Total Gross',  value: totals.gross, color: 'text-gray-800',    bg: 'bg-gray-50'   },
                                { label: currentLanguage === 'tr' ? 'Toplam Net'  : 'Total Net',    value: totals.net,   color: 'text-emerald-700', bg: 'bg-emerald-50' },
                                { label: currentLanguage === 'tr' ? 'Vergi'       : 'Income Tax',   value: totals.tax,   color: 'text-red-600',     bg: 'bg-red-50'    },
                                { label: currentLanguage === 'tr' ? 'İşveren Mlt' : 'Employer Cost', value: totals.cost, color: 'text-blue-700',    bg: 'bg-blue-50'   },
                              ].map((k, i) => (
                                <div key={i} className={`rounded-xl p-3 ${k.bg}`}>
                                  <p className="text-[10px] font-bold text-gray-400 mb-1">{k.label}</p>
                                  <p className={`text-lg font-black ${k.color}`}>{fmtKpi(k.value,'full',0)}</p>
                                </div>
                              ))}
                            </div>
                            <p className="text-[10px] text-gray-400">
                              {activeEmps.length} {currentLanguage === 'tr' ? 'aktif çalışan · SGK işçi %14 · Gelir Vergisi dilimli' : 'active employees · SGK employee 14% · Progressive income tax'}
                            </p>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 border-b border-gray-100">
                                  {[
                                    currentLanguage === 'tr' ? 'Çalışan' : 'Employee',
                                    currentLanguage === 'tr' ? 'Departman' : 'Dept',
                                    currentLanguage === 'tr' ? 'Brüt' : 'Gross',
                                    'SGK',
                                    currentLanguage === 'tr' ? 'Vergi' : 'Tax',
                                    currentLanguage === 'tr' ? 'Net' : 'Net',
                                    currentLanguage === 'tr' ? 'İşveren' : 'Employer Cost',
                                  ].map(h => (
                                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {payroll.map(p => (
                                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="px-4 py-2.5 font-semibold text-gray-800">{p.name}</td>
                                    <td className="px-4 py-2.5 text-gray-500">{p.department}</td>
                                    <td className="px-4 py-2.5 font-bold text-gray-800">{fmtKpi(p.gross)}</td>
                                    <td className="px-4 py-2.5 text-red-500">−{fmtKpi((p.sgkEmp + p.unempEmp))}</td>
                                    <td className="px-4 py-2.5 text-red-500">−{fmtKpi(p.tax)}</td>
                                    <td className="px-4 py-2.5 font-black text-emerald-700">{fmtKpi(p.net)}</td>
                                    <td className="px-4 py-2.5 text-blue-700 font-bold">{fmtKpi(p.employerCost)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="bg-gray-50 border-t-2 border-gray-200 font-black text-[11px]">
                                  <td colSpan={2} className="px-4 py-2.5 text-gray-600">{currentLanguage === 'tr' ? 'Toplam' : 'Total'}</td>
                                  <td className="px-4 py-2.5 text-gray-800">{fmtKpi(totals.gross)}</td>
                                  <td className="px-4 py-2.5 text-red-500">—</td>
                                  <td className="px-4 py-2.5 text-red-500">{fmtKpi(totals.tax)}</td>
                                  <td className="px-4 py-2.5 text-emerald-700">{fmtKpi(totals.net)}</td>
                                  <td className="px-4 py-2.5 text-blue-700">{fmtKpi(totals.cost)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── Phase 121: Leave Management ── */}
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calendar size={15} className="text-gray-400" />
                        <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'İzin Yönetimi' : 'Leave Management'}</h3>
                        {leaveRequests.filter(l => l.status === 'pending').length > 0 && (
                          <span className="bg-amber-400 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                            {leaveRequests.filter(l => l.status === 'pending').length} {currentLanguage === 'tr' ? 'bekliyor' : 'pending'}
                          </span>
                        )}
                      </div>
                      <button onClick={() => setShowLeaveForm(v => !v)} className="text-[10px] font-bold text-brand hover:underline flex items-center gap-1">
                        <Plus size={11} />{currentLanguage === 'tr' ? 'Talep Ekle' : 'Add Request'}
                      </button>
                    </div>

                    {/* Stats strip */}
                    <div className="grid grid-cols-3 divide-x divide-gray-50 border-b border-gray-50">
                      {[
                        { label: currentLanguage === 'tr' ? 'Bekliyor' : 'Pending',  count: leaveRequests.filter(l => l.status === 'pending').length,  color: 'text-amber-600' },
                        { label: currentLanguage === 'tr' ? 'Onaylı'   : 'Approved', count: leaveRequests.filter(l => l.status === 'approved').length, color: 'text-emerald-600' },
                        { label: currentLanguage === 'tr' ? 'Reddedildi' : 'Rejected', count: leaveRequests.filter(l => l.status === 'rejected').length, color: 'text-red-500' },
                      ].map((s, i) => (
                        <div key={i} className="py-3 text-center">
                          <p className={`text-xl font-black ${s.color}`}>{s.count}</p>
                          <p className="text-[10px] font-bold text-gray-400">{s.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Form */}
                    <AnimatePresence>
                      {showLeaveForm && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                          <div className="p-4 bg-gray-50 border-b border-gray-100 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <input className="apple-input text-sm" placeholder={currentLanguage === 'tr' ? 'Çalışan adı' : 'Employee name'}
                                value={leaveForm.employeeName} onChange={e => setLeaveForm(f => ({ ...f, employeeName: e.target.value }))} />
                              <select className="apple-input text-sm" value={leaveForm.type} onChange={e => setLeaveForm(f => ({ ...f, type: e.target.value as typeof leaveForm.type }))}>
                                <option value="annual">{currentLanguage === 'tr' ? 'Yıllık İzin' : 'Annual Leave'}</option>
                                <option value="sick">{currentLanguage === 'tr' ? 'Hastalık' : 'Sick Leave'}</option>
                                <option value="unpaid">{currentLanguage === 'tr' ? 'Ücretsiz İzin' : 'Unpaid Leave'}</option>
                                <option value="other">{currentLanguage === 'tr' ? 'Diğer' : 'Other'}</option>
                              </select>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400">{currentLanguage === 'tr' ? 'Başlangıç' : 'Start'}</label>
                                <input type="date" className="apple-input text-sm" value={leaveForm.startDate} onChange={e => setLeaveForm(f => ({ ...f, startDate: e.target.value }))} />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400">{currentLanguage === 'tr' ? 'Bitiş' : 'End'}</label>
                                <input type="date" className="apple-input text-sm" value={leaveForm.endDate} onChange={e => setLeaveForm(f => ({ ...f, endDate: e.target.value }))} />
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <input className="apple-input text-sm flex-1" placeholder={currentLanguage === 'tr' ? 'Açıklama (opsiyonel)' : 'Reason (optional)'}
                                value={leaveForm.reason} onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))} />
                              <button
                                disabled={!leaveForm.employeeName || !leaveForm.startDate || !leaveForm.endDate}
                                onClick={async () => {
                                  if (!leaveForm.employeeName || !leaveForm.startDate || !leaveForm.endDate) return;
                                  const start = new Date(leaveForm.startDate);
                                  const end   = new Date(leaveForm.endDate);
                                  const days  = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1);
                                  const emp = employees.find(e => e.name.toLowerCase().includes(leaveForm.employeeName.toLowerCase()));
                                  await addDoc(collection(db, 'leaveRequests'), {
                                    ...leaveForm, days, status: 'pending',
                                    employeeId: emp?.id || '', createdAt: serverTimestamp(),
                                  });
                                  setLeaveForm({ employeeName: '', type: 'annual', startDate: '', endDate: '', reason: '' });
                                  setShowLeaveForm(false);
                                  toast(currentLanguage === 'tr' ? 'İzin talebi oluşturuldu.' : 'Leave request created.', 'success');
                                }}
                                className="apple-button-primary text-xs px-4 disabled:opacity-50"
                              >{currentLanguage === 'tr' ? 'Talep Et' : 'Submit'}</button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Request list */}
                    {leaveRequests.length === 0 ? (
                      <div className="py-8 text-center">
                        <Calendar size={28} className="mx-auto mb-2 text-gray-200" />
                        <p className="text-xs text-gray-400">{currentLanguage === 'tr' ? 'İzin talebi yok.' : 'No leave requests.'}</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                        {leaveRequests.map(lr => {
                          const typeLabel = { annual: currentLanguage === 'tr' ? 'Yıllık' : 'Annual', sick: currentLanguage === 'tr' ? 'Hastalık' : 'Sick', unpaid: currentLanguage === 'tr' ? 'Ücretsiz' : 'Unpaid', other: currentLanguage === 'tr' ? 'Diğer' : 'Other' }[lr.type] || lr.type;
                          return (
                            <div key={lr.id} className="flex items-center gap-3 px-5 py-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-gray-800">{lr.employeeName}</p>
                                <p className="text-[10px] text-gray-400">{typeLabel} · {lr.startDate} → {lr.endDate} · {lr.days} {currentLanguage === 'tr' ? 'gün' : 'days'}</p>
                              </div>
                              {lr.status === 'pending' && hasFullAccess('ik') ? (
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <button onClick={async () => {
                                    await updateDoc(doc(db, 'leaveRequests', lr.id), { status: 'approved' });
                                    toast(currentLanguage === 'tr' ? 'Onaylandı.' : 'Approved.', 'success');
                                    // Onaylanan izni Mikro'ya da gönder (hata lokali engellemez, syncLog'da görünür)
                                    pushMikroEvrak('PersonelIzinTalepKaydetV2', izinTalepPayload({
                                      persKod: ((lr as unknown as { mikroPersKod?: string }).mikroPersKod ?? lr.employeeName ?? '').slice(0, 15),
                                      startDate: lr.startDate,
                                      days: Number(lr.days) || 1,
                                      reason: `${lr.type ?? ''}`,
                                    }), { entityType: 'leaveRequest', entityId: lr.id }).catch(() => {});
                                  }}
                                    className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors">
                                    {currentLanguage === 'tr' ? 'Onayla' : 'Approve'}
                                  </button>
                                  <button onClick={async () => { await updateDoc(doc(db, 'leaveRequests', lr.id), { status: 'rejected' }); }}
                                    className="text-[10px] font-bold px-2 py-1 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition-colors">
                                    {currentLanguage === 'tr' ? 'Reddet' : 'Reject'}
                                  </button>
                                </div>
                              ) : (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                                  lr.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                                  : lr.status === 'rejected' ? 'bg-red-100 text-red-700'
                                  : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {lr.status === 'approved' ? (currentLanguage === 'tr' ? '✓ Onaylı' : '✓ Approved')
                                    : lr.status === 'rejected' ? (currentLanguage === 'tr' ? '✗ Reddedildi' : '✗ Rejected')
                                    : (currentLanguage === 'tr' ? '⏳ Bekliyor' : '⏳ Pending')}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Phase 128: Employee Performance Dashboard ── */}
                  {employees.length > 0 && (() => {
                    // Build per-department headcount and salary data
                    type DeptStat = { dept: string; count: number; totalSalary: number; active: number };
                    const deptMap: Record<string, DeptStat> = {};
                    for (const emp of employees) {
                      const dept = emp.department || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
                      if (!deptMap[dept]) deptMap[dept] = { dept, count: 0, totalSalary: 0, active: 0 };
                      deptMap[dept].count++;
                      deptMap[dept].totalSalary += emp.salary || 0;
                      if (emp.status === 'Aktif') deptMap[dept].active++;
                    }
                    const depts = Object.values(deptMap).sort((a, b) => b.count - a.count);
                    const totalHeadcount = employees.length;
                    const totalActive = employees.filter(e => e.status === 'Aktif').length;
                    const totalSalaryBudget = employees.reduce((s, e) => s + (e.salary || 0), 0);
                    return (
                      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-base">👥</span>
                            <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Personel Özeti' : 'Employee Overview'}</h3>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span>{totalActive}/{totalHeadcount} {currentLanguage === 'tr' ? 'aktif' : 'active'}</span>
                            <span>{fmtKpi(totalSalaryBudget,'K',0)} {currentLanguage === 'tr' ? 'bordro' : 'payroll'}</span>
                          </div>
                        </div>
                        <div className="divide-y divide-gray-50">
                          {depts.slice(0, 6).map(d => (
                            <div key={d.dept} className="flex items-center gap-4 px-5 py-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-gray-800 truncate">{d.dept}</p>
                                <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden mt-1">
                                  <div className="h-1.5 bg-brand/60 rounded-full transition-all duration-700" style={{ width: `${(d.count / Math.max(...depts.map(x => x.count))) * 100}%` }} />
                                </div>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0 text-right">
                                <span className="text-xs font-bold text-gray-700">{d.count} {currentLanguage === 'tr' ? 'kişi' : 'staff'}</span>
                                <span className="text-[10px] text-gray-400">{fmtKpi(d.totalSalary,'K',0)}</span>
                                {d.active < d.count && <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{d.count - d.active} {currentLanguage === 'tr' ? 'pasif' : 'inactive'}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 138: Leave Calendar ── */}
                  {leaveRequests.filter(l => l.status === 'approved').length > 0 && (() => {
                    const approved = leaveRequests.filter(l => l.status === 'approved');
                    const today138 = new Date();
                    const thisMonth138 = today138.getMonth();
                    const thisYear138 = today138.getFullYear();
                    // Show leaves active in current month
                    const current = approved.filter(l => {
                      const start = l.startDate ? new Date(l.startDate) : null;
                      const end = l.endDate ? new Date(l.endDate) : null;
                      if (!start || !end) return false;
                      return (
                        (start.getFullYear() === thisYear138 && start.getMonth() === thisMonth138) ||
                        (end.getFullYear() === thisYear138 && end.getMonth() === thisMonth138) ||
                        (start <= today138 && end >= today138)
                      );
                    });
                    if (current.length === 0) return null;
                    return (
                      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                          <Calendar size={16} className="text-purple-400" />
                          <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Bu Ay İzinli Personel' : 'Employees on Leave This Month'}</h3>
                          <span className="ml-auto text-[10px] font-bold text-purple-500 bg-purple-50 px-2 py-0.5 rounded-full">{current.length}</span>
                        </div>
                        <div className="divide-y divide-gray-50">
                          {current.map(l => {
                            const typeLabel = { annual: currentLanguage === 'tr' ? 'Yıllık' : 'Annual', sick: currentLanguage === 'tr' ? 'Hastalık' : 'Sick', unpaid: currentLanguage === 'tr' ? 'Ücretsiz' : 'Unpaid', other: currentLanguage === 'tr' ? 'Diğer' : 'Other' }[l.type] || l.type;
                            const isNow = l.startDate && l.endDate && new Date(l.startDate) <= today138 && new Date(l.endDate) >= today138;
                            return (
                              <div key={l.id} className="flex items-center gap-4 px-5 py-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs font-bold text-gray-800">{l.employeeName}</p>
                                    {isNow && <span className="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">{currentLanguage === 'tr' ? '🟢 Şu an' : '🟢 Now'}</span>}
                                  </div>
                                  <p className="text-[10px] text-gray-400">{typeLabel} · {l.startDate} → {l.endDate}</p>
                                </div>
                                <span className="text-xs font-bold text-gray-600 flex-shrink-0">{l.days} {currentLanguage === 'tr' ? 'gün' : 'd'}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 572: Çalışan Performans Skorkartı ─────────────────────────── */}
                  {employees.length > 0 && (() => {
                    const tr572 = currentLanguage === 'tr';
                    const selEmp = p572SelEmpId ? employees.find(e => e.id === p572SelEmpId) : employees[0];
                    if (!selEmp) return null;

                    // Derive metrics from available data
                    const empOrders = orders.filter(o => o.assignedTo === selEmp.id || o.assignedTo === selEmp.email).length;
                    const empLeads = leads.filter(l => l.assignedTo === selEmp.email || l.assignedTo === selEmp.name).length;
                    const empClosedLeads = leads.filter(l => (l.assignedTo === selEmp.email || l.assignedTo === selEmp.name) && (l.status === 'Closed Won' || l.status === 'Closed')).length;
                    const convRate = empLeads > 0 ? (empClosedLeads / empLeads) * 100 : 0;
                    const attendance = p552Records.filter(r => r.employeeName === selEmp.name && r.status === 'Normal').length;
                    const totalDays = p552Records.filter(r => r.employeeName === selEmp.name).length;
                    const attendancePct = totalDays > 0 ? (attendance / totalDays) * 100 : 0;

                    const kpis572 = [
                      { label: tr572?'Atanan Sipariş':'Assigned Orders', val: empOrders, max: Math.max(...employees.map(e => orders.filter(o => o.assignedTo===e.id||o.assignedTo===e.email).length), 1), unit: '', color: 'blue' },
                      { label: tr572?'Müşteri Adayı':'Assigned Leads', val: empLeads, max: Math.max(...employees.map(e => leads.filter(l => l.assignedTo===e.email||l.assignedTo===e.name).length), 1), unit: '', color: 'purple' },
                      { label: tr572?'Dönüşüm Oranı':'Conversion Rate', val: convRate, max: 100, unit: '%', color: 'emerald' },
                      { label: tr572?'Devam Oranı':'Attendance Rate', val: attendancePct || 100, max: 100, unit: '%', color: 'amber' },
                    ];

                    return (
                      <div className="apple-card p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                          <div className="flex items-center gap-2">
                            <UserCheck className="w-4 h-4 text-brand" />
                            <h4 className="font-bold text-gray-800 text-sm">{tr572?'Çalışan Performans Skorkartı':'Employee Performance Scorecard'}</h4>
                          </div>
                          <select className="apple-input text-sm px-3 py-1.5 max-w-xs" value={p572SelEmpId || (employees[0]?.id || '')}
                            onChange={e => setP572SelEmpId(e.target.value)}>
                            {employees.map(e => <option key={e.id} value={e.id}>{e.name} — {e.department}</option>)}
                          </select>
                        </div>

                        {/* Employee card */}
                        <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-xl">
                          <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center font-black text-brand text-lg flex-shrink-0">
                            {selEmp.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-gray-800">{selEmp.name}</p>
                            <p className="text-xs text-gray-500">{selEmp.position} · {selEmp.department}</p>
                          </div>
                          <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${selEmp.status==='Aktif'?'bg-emerald-100 text-emerald-700':'bg-gray-100 text-gray-600'}`}>{selEmp.status}</span>
                        </div>

                        {/* KPI grid */}
                        <div className="grid grid-cols-2 gap-3">
                          {kpis572.map(k => {
                            const pct = k.max > 0 ? Math.min((k.val / k.max) * 100, 100) : 0;
                            const colorMap = { blue:'text-blue-700 bg-blue-50 bg-blue-500', purple:'text-purple-700 bg-purple-50 bg-purple-500', emerald:'text-emerald-700 bg-emerald-50 bg-emerald-500', amber:'text-amber-700 bg-amber-50 bg-amber-400' };
                            const [tc, bg, bar] = (colorMap[k.color as keyof typeof colorMap] || colorMap.blue).split(' ');
                            return (
                              <div key={k.label} className={`rounded-xl p-3 ${bg}`}>
                                <p className="text-[10px] font-bold text-gray-400 mb-1">{k.label}</p>
                                <p className={`text-xl font-black ${tc}`}>{k.unit === '%' ? `${k.val.toFixed(1)}%` : k.val}</p>
                                <div className="h-1.5 bg-white/50 rounded-full overflow-hidden mt-1.5">
                                  <div className={`h-full ${bar} rounded-full`} style={{width:`${pct}%`}} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 556: SGK e-Bildirge ────────────────────────────────────────── */}
                  {employees.length > 0 && (() => {
                    const tr556 = currentLanguage === 'tr';
                    const SGK_EMP    = 0.14;
                    const UNEMP_EMP  = 0.01;
                    const SGK_EMPL   = 0.205;
                    const UNEMP_EMPL = 0.02;
                    const STAMP_RATE = 0.00759; // Damga vergisi oranı

                    const activeEmps = employees.filter(e => e.status === 'Aktif');
                    const [pYear, pMonthStr] = p556Period.split('-');
                    const pMonth = Number(pMonthStr);
                    const monthNames = tr556
                      ? ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık']
                      : ['January','February','March','April','May','June','July','August','September','October','November','December'];
                    const periodLabel = `${monthNames[pMonth-1]} ${pYear}`;

                    const rows = activeEmps.map(e => {
                      const gross = e.salary || 0;
                      const sgkBase = gross;
                      const sgkEmp  = Math.round(sgkBase * SGK_EMP);
                      const unempEmp = Math.round(sgkBase * UNEMP_EMP);
                      const sgkEmpl  = Math.round(sgkBase * SGK_EMPL);
                      const unempEmpl = Math.round(sgkBase * UNEMP_EMPL);
                      const taxBase = gross - sgkEmp - unempEmp;
                      const stamp = Math.round(gross * STAMP_RATE);
                      const totalDeductions = sgkEmp + unempEmp;
                      const totalEmployerSgk = sgkEmpl + unempEmpl;
                      const netSalary = gross - sgkEmp - unempEmp - stamp;
                      return { emp: e, gross, sgkBase, sgkEmp, unempEmp, sgkEmpl, unempEmpl, taxBase, stamp, totalDeductions, totalEmployerSgk, netSalary };
                    });

                    const totals = rows.reduce((acc, r) => ({
                      gross: acc.gross + r.gross,
                      sgkBase: acc.sgkBase + r.sgkBase,
                      sgkEmp: acc.sgkEmp + r.sgkEmp,
                      unempEmp: acc.unempEmp + r.unempEmp,
                      sgkEmpl: acc.sgkEmpl + r.sgkEmpl,
                      unempEmpl: acc.unempEmpl + r.unempEmpl,
                      stamp: acc.stamp + r.stamp,
                      totalEmployerSgk: acc.totalEmployerSgk + r.totalEmployerSgk,
                      netSalary: acc.netSalary + r.netSalary,
                    }), { gross:0, sgkBase:0, sgkEmp:0, unempEmp:0, sgkEmpl:0, unempEmpl:0, stamp:0, totalEmployerSgk:0, netSalary:0 });

                    return (
                      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                        {/* Header */}
                        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-xl bg-teal-50 flex items-center justify-center">
                              <Shield className="w-4 h-4 text-teal-600" />
                            </div>
                            <div>
                              <h3 className="font-bold text-gray-800">{tr556 ? 'SGK e-Bildirge Raporu' : 'SGK e-Declaration Report'}</h3>
                              <p className="text-[10px] text-gray-400">{tr556 ? 'Aylık SGK prim bildirgesi özeti' : 'Monthly SGK premium declaration summary'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <input type="month" value={p556Period} onChange={e => setP556Period(e.target.value)}
                              className="apple-input text-xs px-3 py-1.5" />
                            <button onClick={() => {
                              const lines = [
                                `SGK e-Bildirge — ${periodLabel}`,
                                '',
                                ['TC/Çalışan', 'Brüt Ücret', 'SGK Matrahı', 'SGK İşçi (%14)', 'İşsizlik İşçi (%1)', 'SGK İşveren (%20.5)', 'İşsizlik İşveren (%2)', 'Damga Vergisi', 'Net Ücret'].join('\t'),
                                ...rows.map(r => [
                                  r.emp.name, r.gross, r.sgkBase, r.sgkEmp, r.unempEmp, r.sgkEmpl, r.unempEmpl, r.stamp, r.netSalary
                                ].join('\t')),
                                '',
                                ['TOPLAM', totals.gross, totals.sgkBase, totals.sgkEmp, totals.unempEmp, totals.sgkEmpl, totals.unempEmpl, totals.stamp, totals.netSalary].join('\t'),
                              ].join('\n');
                              const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url; a.download = `sgk-bildirge-${p556Period}.txt`; a.click();
                              URL.revokeObjectURL(url);
                              toast(tr556 ? 'SGK raporu indirildi.' : 'SGK report downloaded.', 'success');
                            }} className="flex items-center gap-1.5 text-xs font-semibold text-teal-600 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg transition-colors">
                              <Download className="w-3.5 h-3.5" />{tr556 ? 'TXT İndir' : 'Download TXT'}
                            </button>
                          </div>
                        </div>

                        {/* Summary cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100">
                          {[
                            { label: tr556 ? 'Toplam Brüt' : 'Total Gross',        val: totals.gross,           color: 'text-gray-800' },
                            { label: tr556 ? 'SGK Matrahı' : 'SGK Base',           val: totals.sgkBase,         color: 'text-teal-700' },
                            { label: tr556 ? 'İşçi SGK+İşsizlik' : 'Employee SGK', val: totals.sgkEmp + totals.unempEmp, color: 'text-red-600' },
                            { label: tr556 ? 'İşveren SGK+İşsizlik' : 'Employer SGK', val: totals.totalEmployerSgk, color: 'text-blue-700' },
                          ].map(k => (
                            <div key={k.label} className="bg-white p-4">
                              <p className="text-[10px] font-bold text-gray-400 mb-1">{k.label}</p>
                              <p className={`text-lg font-black ${k.color}`}>{fmtKpi(k.val,'full',0)}</p>
                            </div>
                          ))}
                        </div>

                        {/* Period + totals info */}
                        <div className="px-5 py-3 bg-teal-50 border-b border-teal-100 flex flex-wrap gap-4 text-xs text-teal-800">
                          <span className="font-bold">{tr556 ? 'Dönem:' : 'Period:'} {periodLabel}</span>
                          <span>·</span>
                          <span>{activeEmps.length} {tr556 ? 'Aktif Çalışan' : 'Active Employees'}</span>
                          <span>·</span>
                          <span>{tr556 ? 'SGK İşçi: %14 | İşsizlik İşçi: %1 | SGK İşveren: %20,5 | İşsizlik İşveren: %2' : 'SGK Emp: 14% | Unemp Emp: 1% | SGK Empl: 20.5% | Unemp Empl: 2%'}</span>
                        </div>

                        {/* Detail table */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-100">
                                {[
                                  tr556?'Çalışan':'Employee',
                                  tr556?'Departman':'Dept',
                                  tr556?'Brüt':'Gross',
                                  tr556?'SGK Matrahı':'SGK Base',
                                  tr556?'SGK İşçi':'SGK Emp',
                                  tr556?'İşsizlik İşçi':'Unemp Emp',
                                  tr556?'SGK İşveren':'SGK Empl',
                                  tr556?'İşsizlik İşveren':'Unemp Empl',
                                  tr556?'Damga':'Stamp',
                                  tr556?'Net':'Net',
                                ].map(h => (
                                  <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {rows.map(r => (
                                <tr key={r.emp.id} className="hover:bg-gray-50/50 transition-colors">
                                  <td className="px-3 py-2.5 font-semibold text-gray-800 whitespace-nowrap">{r.emp.name}</td>
                                  <td className="px-3 py-2.5 text-gray-500">{r.emp.department}</td>
                                  <td className="px-3 py-2.5 font-bold text-gray-800 font-mono">{r.gross.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 text-teal-700 font-mono">{r.sgkBase.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 text-red-500 font-mono">−{r.sgkEmp.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 text-red-400 font-mono">−{r.unempEmp.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 text-blue-600 font-mono">{r.sgkEmpl.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 text-blue-400 font-mono">{r.unempEmpl.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 text-amber-600 font-mono">−{r.stamp.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 font-bold text-emerald-700 font-mono">{r.netSalary.toLocaleString('tr-TR')}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                                <td className="px-3 py-2.5 text-gray-700 text-[10px] uppercase" colSpan={2}>{tr556 ? 'TOPLAM' : 'TOTAL'}</td>
                                <td className="px-3 py-2.5 text-gray-800 font-mono">{totals.gross.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-teal-700 font-mono">{totals.sgkBase.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-red-500 font-mono">−{totals.sgkEmp.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-red-400 font-mono">−{totals.unempEmp.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-blue-600 font-mono">{totals.sgkEmpl.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-blue-400 font-mono">{totals.unempEmpl.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-amber-600 font-mono">−{totals.stamp.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-emerald-700 font-mono">{totals.netSalary.toLocaleString('tr-TR')}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                        <p className="px-5 py-3 text-[10px] text-gray-400 border-t border-gray-50">
                          {tr556 ? '* Bu rapor hesaplanmış tahmini değerleri göstermektedir. Resmi SGK bildirgesini Mali Müşavirinizle birlikte hazırlayınız.' : '* This report shows calculated estimated values. Prepare the official SGK declaration with your CPA.'}
                        </p>
                      </div>
                    );
                  })()}

                  {/* ── Phase 599: Çalışan Yetkinlik Matrisi (Skill Matrix) ─────── */}
                  {(() => {
                    const tr599 = currentLanguage === 'tr';
                    if (employees.length === 0) return null;
                    const selEmp = employees.find(e => e.id === p599SelEmp) || employees[0];
                    const ratings = p599Ratings[selEmp?.id || ''] || {};
                    const avgScore = p599Skills.length > 0
                      ? p599Skills.reduce((s, sk) => s + (ratings[sk] || 0), 0) / p599Skills.length
                      : 0;
                    return (
                      <div className="apple-card p-5">
                        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">{tr599 ? '🧠 Yetkinlik Matrisi' : '🧠 Employee Skill Matrix'}</h3>
                          <select value={p599SelEmp || selEmp?.id} onChange={e => setP599SelEmp(e.target.value)} className="apple-input px-3 py-2 text-sm">
                            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        </div>
                        {selEmp && (
                          <>
                            <div className="flex items-center gap-3 mb-4">
                              <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center text-brand font-bold text-sm">{selEmp.name.charAt(0)}</div>
                              <div>
                                <p className="font-semibold text-gray-800">{selEmp.name}</p>
                                <p className="text-xs text-gray-500">{selEmp.position} • {selEmp.department}</p>
                              </div>
                              <div className="ml-auto text-right">
                                <p className="text-xs text-gray-400">{tr599 ? 'Ort. Yetkinlik' : 'Avg. Skill'}</p>
                                <p className={`text-xl font-bold ${avgScore >= 4 ? 'text-emerald-600' : avgScore >= 2.5 ? 'text-amber-600' : 'text-red-500'}`}>{avgScore.toFixed(1)}/5</p>
                              </div>
                            </div>
                            <div className="space-y-3">
                              {p599Skills.map(sk => {
                                const score = ratings[sk] || 0;
                                return (
                                  <div key={sk} className="flex items-center gap-3">
                                    <span className="text-xs text-gray-700 font-medium w-36 truncate">{sk}</span>
                                    <div className="flex gap-1">
                                      {[1,2,3,4,5].map(n => (
                                        <button key={n} onClick={() => hasFullAccess('ik') && setP599Ratings(prev => ({
                                          ...prev,
                                          [selEmp.id]: { ...(prev[selEmp.id] || {}), [sk]: n }
                                        }))}
                                          className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${score >= n ? 'bg-brand text-white' : 'bg-gray-100 text-gray-400 hover:bg-brand/20'}`}>
                                          {n}
                                        </button>
                                      ))}
                                    </div>
                                    <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                      <div className={`h-full rounded-full transition-all ${score >= 4 ? 'bg-emerald-400' : score >= 3 ? 'bg-amber-400' : 'bg-gray-300'}`} style={{ width: `${(score / 5) * 100}%` }} />
                                    </div>
                                    <span className={`text-xs font-bold w-6 text-right ${score >= 4 ? 'text-emerald-600' : score >= 3 ? 'text-amber-600' : 'text-gray-400'}`}>{score || '—'}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  <HRModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('ik')} userRole={userRole} employees={employees} exchangeRates={exchangeRates} />

                  {/* ── Phase 616: Çalışan Devir Analizi ────────────────────────── */}
                  {employees.length > 0 && (() => {
                    const tr616 = currentLanguage === 'tr';
                    const daysMap:{[k:string]:number} = {'3m':90,'6m':180,'12m':365};
                    const days616 = daysMap[p616Period];
                    const cutoff616 = new Date(Date.now()-days616*86400000).toISOString().slice(0,10);
                    const activeEmps = employees.filter(e=>e.status==='Aktif').length;
                    const leftEmps = employees.filter(e=>e.status==='Ayrıldı'&&e.startDate>=cutoff616).length;
                    const turnoverRate = activeEmps+leftEmps>0?(leftEmps/(activeEmps+leftEmps)*100):0;
                    const byDept:{[dept:string]:{active:number;left:number}} = {};
                    employees.forEach(e=>{
                      if(!byDept[e.department]) byDept[e.department]={active:0,left:0};
                      if(e.status==='Aktif') byDept[e.department].active++;
                      else if(e.status==='Ayrıldı'&&e.startDate>=cutoff616) byDept[e.department].left++;
                    });
                    const deptRows = Object.entries(byDept).map(([dept,d])=>({dept,...d,rate:d.active+d.left>0?(d.left/(d.active+d.left)*100):0})).sort((a,b)=>b.rate-a.rate);
                    return (
                      <div className="apple-card p-5 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">📉 {tr616?'Çalışan Devir Analizi':'Employee Turnover Analysis'}</h3>
                          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                            {([{k:'3m',l:'3M'},{k:'6m',l:'6M'},{k:'12m',l:'12M'}] as {k:'3m'|'6m'|'12m';l:string}[]).map(t=>(
                              <button key={t.k} onClick={()=>setP616Period(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p616Period===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr616?'Aktif':'Active'}</p><p className="text-xl font-black text-blue-600">{activeEmps}</p></div>
                          <div className="bg-red-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr616?'Ayrılan':'Left'}</p><p className="text-xl font-black text-red-600">{leftEmps}</p></div>
                          <div className={`rounded-xl p-3 ${turnoverRate>15?'bg-red-50':turnoverRate>8?'bg-amber-50':'bg-emerald-50'}`}><p className="text-[10px] font-bold text-gray-400 uppercase">{tr616?'Devir Oranı':'Turnover Rate'}</p><p className={`text-xl font-black ${turnoverRate>15?'text-red-600':turnoverRate>8?'text-amber-600':'text-emerald-600'}`}>%{turnoverRate.toFixed(1)}</p></div>
                        </div>
                        <div className="space-y-2">
                          {deptRows.filter(r=>r.active+r.left>0).map(r=>(
                            <div key={r.dept} className="flex items-center gap-3">
                              <span className="text-xs text-gray-700 font-medium w-32 truncate shrink-0">{r.dept}</span>
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${r.rate>15?'bg-red-400':r.rate>8?'bg-amber-400':'bg-emerald-400'}`} style={{width:`${Math.min(r.rate*2,100)}%`}}/>
                              </div>
                              <span className={`text-xs font-bold shrink-0 w-10 text-right ${r.rate>15?'text-red-600':r.rate>8?'text-amber-600':'text-emerald-600'}`}>%{r.rate.toFixed(0)}</span>
                              <span className="text-xs text-gray-400 shrink-0">{r.left}/{r.active+r.left}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 629: Çalışan Performans KPI ──────────────────────── */}
                  {employees.length > 0 && (() => {
                    const tr629 = currentLanguage === 'tr';
                    const now629 = new Date();
                    let start629: Date;
                    if (p629KpiPeriod==='this_month') start629 = new Date(now629.getFullYear(), now629.getMonth(), 1);
                    else if (p629KpiPeriod==='last_month') start629 = new Date(now629.getFullYear(), now629.getMonth()-1, 1);
                    else start629 = new Date(now629.getFullYear(), 0, 1);
                    const end629 = p629KpiPeriod==='last_month'?new Date(now629.getFullYear(), now629.getMonth(), 0):now629;
                    // Sales per rep in period
                    const repSales:{[name:string]:{orders:number;revenue:number}} = {};
                    orders.filter(o=>{
                      if(o.status==='Cancelled'||!o.assignedTo||!o.createdAt) return false;
                      try { const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string); return d>=start629&&d<=end629; } catch { return false; }
                    }).forEach(o=>{ const r=o.assignedTo!; if(!repSales[r]) repSales[r]={orders:0,revenue:0}; repSales[r].orders++; repSales[r].revenue+=(o.totalPrice||0); });
                    const rows = employees.filter(e=>e.status==='Aktif').map(e=>({...e,sales:repSales[e.name]||{orders:0,revenue:0}})).sort((a,b)=>b.sales.revenue-a.sales.revenue);
                    return (
                      <div className="apple-card p-5 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">🏆 {tr629?'Çalışan Performans KPI':'Employee Performance KPI'}</h3>
                          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                            {([{k:'this_month',l:tr629?'Bu Ay':'This M.'},{k:'last_month',l:tr629?'Geçen':'Last M.'},{k:'ytd',l:'YTD'}] as {k:'this_month'|'last_month'|'ytd';l:string}[]).map(t=>(
                              <button key={t.k} onClick={()=>setP629KpiPeriod(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p629KpiPeriod===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                            ))}
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-100 bg-gray-50">
                              {['#',tr629?'Çalışan':'Employee',tr629?'Departman':'Dept',tr629?'Sipariş':'Orders',tr629?'Ciro':'Revenue'].map(h=>(
                                <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                              ))}
                            </tr></thead>
                            <tbody className="divide-y divide-gray-50">
                              {rows.slice(0,10).map((e,idx)=>(
                                <tr key={e.id} className="hover:bg-gray-50/50">
                                  <td className="px-3 py-2.5 text-gray-400">{idx+1}</td>
                                  <td className="px-3 py-2.5 font-medium text-gray-800">{e.name}</td>
                                  <td className="px-3 py-2.5 text-gray-500">{e.department}</td>
                                  <td className="px-3 py-2.5 font-bold text-blue-600">{e.sales.orders}</td>
                                  <td className="px-3 py-2.5 font-bold text-emerald-600">₺{Math.round(e.sales.revenue).toLocaleString('tr-TR')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 636: SGK/Net Bordro Hesaplama Motoru ─────────────── */}
                  {employees.length > 0 && (() => {
                    const tr636 = currentLanguage === 'tr';
                    const calcPayroll = () => {
                      const rows = employees.filter(e=>e.status==='Aktif').map(e=>{
                        const gross = e.salary||0;
                        const sgkEmp = Math.round(gross*0.14);
                        const sgkEmpr = Math.round(gross*0.2075);
                        const taxableBase = gross - sgkEmp;
                        const incomeTax = Math.round(taxableBase<=32000?taxableBase*0.15:taxableBase<=70000?32000*0.15+(taxableBase-32000)*0.20:32000*0.15+38000*0.20+(taxableBase-70000)*0.27);
                        const stampTax = Math.round(gross*0.00759);
                        const net = gross - sgkEmp - incomeTax - stampTax;
                        return {id:e.id,name:e.name,position:e.position,gross,sgkEmployee:sgkEmp,sgkEmployer:sgkEmpr,incomeTax,stampTax,net};
                      });
                      setP636Payrolls(rows);
                      setP636Calculated(true);
                    };
                    const totalGross = p636Payrolls.reduce((s,r)=>s+r.gross,0);
                    const totalNet = p636Payrolls.reduce((s,r)=>s+r.net,0);
                    const totalSgkEmployer = p636Payrolls.reduce((s,r)=>s+r.sgkEmployer,0);
                    const totalCost = p636Payrolls.reduce((s,r)=>s+r.gross+r.sgkEmployer,0);
                    return (
                      <div className="apple-card p-5 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div><h3 className="font-bold text-gray-900 text-sm">💰 {tr636?'SGK/Net Bordro Hesaplama':'SGK/Net Payroll Calculator'}</h3>
                          <p className="text-xs text-gray-400">{tr636?'SGK işçi/işveren payı, gelir vergisi ve net maaş hesabı (2024 dilimleri)':'SGK employee/employer share, income tax and net salary (2024 brackets)'}</p></div>
                          <div className="flex items-center gap-2">
                            <div className="apple-input px-3 py-1.5 text-xs flex items-center gap-1.5"><span className="text-gray-400">{tr636?'Dönem:':'Period:'}</span><input type="month" value={p636Month} onChange={e=>setP636Month(e.target.value)} className="bg-transparent focus:outline-none text-xs" /></div>
                            <button onClick={calcPayroll} className="apple-button-primary text-xs px-4 py-1.5 flex items-center gap-1.5">⚡ {tr636?'Hesapla':'Calculate'}</button>
                          </div>
                        </div>
                        {p636Calculated && p636Payrolls.length > 0 && (
                          <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr636?'Brüt Toplam':'Total Gross'}</p><p className="text-lg font-black text-gray-800">₺{totalGross.toLocaleString('tr-TR')}</p></div>
                              <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr636?'Net Toplam':'Total Net'}</p><p className="text-lg font-black text-emerald-600">₺{totalNet.toLocaleString('tr-TR')}</p></div>
                              <div className="bg-orange-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr636?'İşveren SGK':'Employer SGK'}</p><p className="text-lg font-black text-orange-600">₺{totalSgkEmployer.toLocaleString('tr-TR')}</p></div>
                              <div className="bg-red-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr636?'Toplam Maliyet':'Total Cost'}</p><p className="text-lg font-black text-red-600">₺{totalCost.toLocaleString('tr-TR')}</p></div>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead><tr className="border-b border-gray-100 bg-gray-50">
                                  {[tr636?'Çalışan':'Employee',tr636?'Pozisyon':'Position',tr636?'Brüt':'Gross',tr636?'SGK İşçi':'SGK Emp.',tr636?'Gelir Vergisi':'Inc. Tax',tr636?'Damga':'Stamp',tr636?'Net':'Net'].map(h=>(
                                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                  ))}
                                </tr></thead>
                                <tbody className="divide-y divide-gray-50">
                                  {p636Payrolls.map(r=>(
                                    <tr key={r.id} className="hover:bg-gray-50/50">
                                      <td className="px-3 py-2.5 font-semibold text-gray-800">{r.name}</td>
                                      <td className="px-3 py-2.5 text-gray-500">{r.position}</td>
                                      <td className="px-3 py-2.5 font-mono text-gray-700">₺{r.gross.toLocaleString('tr-TR')}</td>
                                      <td className="px-3 py-2.5 font-mono text-orange-600">₺{r.sgkEmployee.toLocaleString('tr-TR')}</td>
                                      <td className="px-3 py-2.5 font-mono text-purple-600">₺{r.incomeTax.toLocaleString('tr-TR')}</td>
                                      <td className="px-3 py-2.5 font-mono text-gray-500">₺{r.stampTax.toLocaleString('tr-TR')}</td>
                                      <td className="px-3 py-2.5 font-bold font-mono text-emerald-600">₺{r.net.toLocaleString('tr-TR')}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <p className="text-[10px] text-gray-400">* {tr636?'SGK işçi: %14, işveren: %20.75; Vergi dilimleri: 0-32K %15, 32-70K %20, 70K+ %27; Damga: %0.759':'SGK emp: 14%, employer: 20.75%; Tax brackets: 0-32K 15%, 32-70K 20%, 70K+ 27%; Stamp: 0.759%'}</p>
                          </>
                        )}
                        {!p636Calculated && <p className="text-center text-gray-400 text-xs py-4">{tr636?`"Hesapla" butonuna tıklayın (${employees.filter(e=>e.status==='Aktif').length} aktif çalışan).`:`Click "Calculate" to compute payroll (${employees.filter(e=>e.status==='Aktif').length} active employees).`}</p>}
                      </div>
                    );
                  })()}
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
                  {/* ── Phase 598: Sözleşme Yenileme Uyarıları ─────────────────── */}
                  {(() => {
                    const tr598 = currentLanguage === 'tr';
                    const today598 = new Date().toISOString().slice(0,10);
                    const alertDate598 = new Date(Date.now()+p598AlertDays*86400000).toISOString().slice(0,10);
                    // Use contracts from LegalModule's Firestore — but we don't have them directly
                    // Instead show alert config + derive from p597Contracts as a proxy
                    const expiringContracts = p597Contracts.filter(c=>c.endDate&&c.endDate>=today598&&c.endDate<=alertDate598);
                    const expiredContracts = p597Contracts.filter(c=>c.endDate&&c.endDate<today598);
                    if (expiringContracts.length===0&&expiredContracts.length===0&&p597Contracts.length===0) return null;
                    return (
                      <div className="apple-card p-5">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-bold text-gray-900 text-sm">{tr598?'📋 Sözleşme Yenileme Uyarıları':'📋 Contract Renewal Alerts'}</h3>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">{tr598?'Uyarı eşiği:':'Alert threshold:'}</span>
                            <input type="number" value={p598AlertDays} onChange={e=>setP598AlertDays(Number(e.target.value))} className="apple-input px-2 py-1 text-xs w-14 text-right" />
                            <span className="text-xs text-gray-500">{tr598?'gün':'days'}</span>
                          </div>
                        </div>
                        {expiredContracts.length>0&&(<div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-2"><p className="text-xs text-red-700 font-bold">❌ {expiredContracts.length} {tr598?'sözleşme süresi dolmuş:':'contract(s) expired:'} {expiredContracts.map(c=>c.customerName).join(', ')}</p></div>)}
                        {expiringContracts.length>0&&(<div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2"><p className="text-xs text-amber-700 font-bold">⚠️ {expiringContracts.length} {tr598?`sözleşme ${p598AlertDays} gün içinde sona eriyor:`:`contract(s) expiring in ${p598AlertDays} days:`} {expiringContracts.map(c=>`${c.customerName} (${c.endDate})`).join(', ')}</p></div>)}
                        {expiringContracts.length===0&&expiredContracts.length===0&&(<p className="text-center py-4 text-gray-400 text-xs">{tr598?'Yaklaşan sözleşme yenileme yok.':'No upcoming contract renewals.'}</p>)}
                        <p className="text-[10px] text-gray-400 mt-2">* {tr598?'Gelir Tanıma modülünde kayıtlı sözleşmeler izlenmektedir.':'Contracts from Revenue Recognition module are monitored here.'}</p>
                      </div>
                    );
                  })()}
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
                  {/* ── Phase 582: Proje Maliyet Takibi ─────────────────────────── */}
                  {(() => {
                    const tr582 = currentLanguage === 'tr';
                    const statusColors582: Record<string,string> = {'Aktif':'bg-green-100 text-green-700','Tamamlandı':'bg-blue-100 text-blue-700','Beklemede':'bg-gray-100 text-gray-500'};
                    return (
                      <div className="apple-card p-5">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-bold text-gray-900 text-sm">{tr582?'💼 Proje Maliyet Takibi':'💼 Project Cost Tracking'}</h3>
                          {hasFullAccess('proje') && (
                            <button onClick={()=>setP582ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm">
                              <Plus className="w-4 h-4"/>{tr582?'Proje Ekle':'Add Project'}
                            </button>
                          )}
                        </div>
                        {p582ShowForm && (
                          <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <input className="apple-input px-3 py-2 text-sm col-span-2" placeholder={tr582?'Proje Adı':'Project Name'} value={p582Draft.name} onChange={e=>setP582Draft(d=>({...d,name:e.target.value}))} />
                              <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr582?'Bütçe (₺)':'Budget (₺)'} value={p582Draft.budget} onChange={e=>setP582Draft(d=>({...d,budget:e.target.value}))} />
                              <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr582?'Harcanan (₺)':'Spent (₺)'} value={p582Draft.spent} onChange={e=>setP582Draft(d=>({...d,spent:e.target.value}))} />
                              <select className="apple-input px-3 py-2 text-sm" value={p582Draft.status} onChange={e=>setP582Draft(d=>({...d,status:e.target.value as typeof d.status}))}>
                                <option value="Aktif">{tr582?'Aktif':'Active'}</option>
                                <option value="Tamamlandı">{tr582?'Tamamlandı':'Completed'}</option>
                                <option value="Beklemede">{tr582?'Beklemede':'On Hold'}</option>
                              </select>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={async ()=>{
                                if(!p582Draft.name) return;
                                try { await addDoc(collection(db,'projectCosts'),{name:p582Draft.name,budget:Number(p582Draft.budget)||0,spent:Number(p582Draft.spent)||0,status:p582Draft.status,createdAt:serverTimestamp()}); toast(currentLanguage === 'tr' ? 'Proje maliyeti eklendi ✓' : 'Project cost added ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(currentLanguage === 'tr' ? 'Maliyet eklenemedi.' : 'Failed to add cost.', 'error');}
                                setP582Draft({name:'',budget:'',spent:'',status:'Aktif'});
                                setP582ShowForm(false);
                              }} className="apple-button-primary text-sm px-4 py-1.5">{tr582?'Kaydet':'Save'}</button>
                              <button onClick={()=>setP582ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{tr582?'İptal':'Cancel'}</button>
                            </div>
                          </div>
                        )}
                        {p582Projects.length === 0 ? (
                          <p className="text-center py-8 text-gray-400 text-sm">{tr582?'"Proje Ekle" ile bütçe takibi başlatın.':'Click "Add Project" to start tracking project costs.'}</p>
                        ) : (
                          <div className="space-y-3">
                            {p582Projects.map(p=>{
                              const pct = p.budget>0?Math.min(100,(p.spent/p.budget)*100):0;
                              const isOver = p.spent>p.budget && p.budget>0;
                              return (
                                <div key={p.id} className={`p-4 rounded-xl border ${isOver?'border-red-200 bg-red-50/20':'border-gray-100'}`}>
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <p className="font-semibold text-gray-800">{p.name}</p>
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors582[p.status]}`}>{p.status}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className={`font-bold ${isOver?'text-red-600':'text-gray-700'}`}>₺{p.spent.toLocaleString()} / ₺{p.budget.toLocaleString()}</span>
                                      <button onClick={async ()=>{if(!await confirmDelete(undefined, currentLanguage==='tr'?'tr':'en'))return;try{await deleteDoc(doc(db,'projectCosts',p.id));}catch(e){console.error("[firestore]", e);}}} className="text-red-400 hover:text-red-600 ml-2">✕</button>
                                    </div>
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${isOver?'bg-red-500':pct>80?'bg-amber-500':'bg-emerald-400'}`} style={{width:`${pct}%`}} />
                                  </div>
                                  <p className="text-xs text-gray-400 mt-1">{pct.toFixed(0)}% {tr582?'harcandı':'spent'}{isOver?` • ⚠️ ${tr582?'Bütçe aşıldı!':'Over budget!'}`:''}</p>
                                </div>
                              );
                            })}
                            <div className="border-t border-gray-100 pt-3 flex justify-between text-xs font-semibold text-gray-600">
                              <span>{tr582?'Toplam Bütçe:':'Total Budget:'} ₺{p582Projects.reduce((s,p)=>s+p.budget,0).toLocaleString()}</span>
                              <span>{tr582?'Toplam Harcama:':'Total Spent:'} ₺{p582Projects.reduce((s,p)=>s+p.spent,0).toLocaleString()}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <ProjectModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('proje')} userRole={userRole} />

                  {/* ── Phase 618: Proje Zaman Çizelgesi (Gantt-lite) ───────────── */}
                  {(() => {
                    const tr618 = currentLanguage === 'tr';
                    const today618 = new Date().toISOString().slice(0,10);
                    const overdue618 = p618Projects.filter(p=>p.end<today618&&p.status!=='Tamamlandı').length;
                    return (
                      <div className="apple-card p-5 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">📐 {tr618?'Proje Zaman Çizelgesi':'Project Timeline'}</h3>
                          <button onClick={()=>setP618ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{tr618?'Proje Ekle':'Add Project'}</button>
                        </div>
                        {overdue618>0&&<div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-red-700">⚠️ {overdue618} {tr618?'proje gecikmiş':'project(s) overdue'}</div>}
                        {p618ShowForm && (
                          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                              <input className="apple-input col-span-2 md:col-span-1" placeholder={tr618?'Proje adı':'Project name'} value={p618Draft.name} onChange={e=>setP618Draft(d=>({...d,name:e.target.value}))}/>
                              <input className="apple-input" placeholder={tr618?'Sorumlu':'Owner'} value={p618Draft.owner} onChange={e=>setP618Draft(d=>({...d,owner:e.target.value}))}/>
                              <select value={p618Draft.status} onChange={e=>setP618Draft(d=>({...d,status:e.target.value as typeof d.status}))} className="apple-input">
                                {['Aktif','Beklemede','Gecikmiş','Tamamlandı'].map(s=><option key={s}>{s}</option>)}
                              </select>
                              <input type="date" className="apple-input" value={p618Draft.start} onChange={e=>setP618Draft(d=>({...d,start:e.target.value}))}/>
                              <input type="date" className="apple-input" value={p618Draft.end} onChange={e=>setP618Draft(d=>({...d,end:e.target.value}))}/>
                              <input type="number" min="0" max="100" className="apple-input" placeholder="% İlerleme" value={p618Draft.progress} onChange={e=>setP618Draft(d=>({...d,progress:e.target.value}))}/>
                            </div>
                            <button onClick={async ()=>{
                              if(!p618Draft.name||!p618Draft.start||!p618Draft.end) return;
                              try { await addDoc(collection(db,'projectTimelines'),{name:p618Draft.name,start:p618Draft.start,end:p618Draft.end,progress:Number(p618Draft.progress)||0,status:p618Draft.status,owner:p618Draft.owner,createdAt:serverTimestamp()}); toast(currentLanguage === 'tr' ? 'Zaman çizelgesi eklendi ✓' : 'Timeline added ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(currentLanguage === 'tr' ? 'Zaman çizelgesi eklenemedi.' : 'Failed to add timeline.', 'error');}
                              setP618Draft({name:'',start:'',end:'',progress:'0',status:'Aktif',owner:''});
                              setP618ShowForm(false);
                              toast(tr618?'Proje eklendi.':'Project added.','success');
                            }} className="apple-button-primary text-xs px-6">{tr618?'Kaydet':'Save'}</button>
                          </div>
                        )}
                        {p618Projects.length > 0 && (
                          <div className="space-y-3">
                            {[...p618Projects].sort((a,b)=>a.start.localeCompare(b.start)).map(p=>{
                              const statusCls:{[k:string]:string} = {Aktif:'text-blue-600 bg-blue-50',Tamamlandı:'text-emerald-600 bg-emerald-50',Gecikmiş:'text-red-600 bg-red-50',Beklemede:'text-gray-500 bg-gray-100'};
                              const cls = statusCls[p.status]||'text-gray-500 bg-gray-100';
                              const isLate = p.end<today618&&p.status!=='Tamamlandı';
                              return (
                                <div key={p.id} className={`border rounded-xl px-4 py-3 ${isLate?'border-red-200 bg-red-50/20':'border-gray-100'}`}>
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <p className="font-semibold text-gray-800 text-sm truncate">{p.name}</p>
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${cls}`}>{p.status}</span>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0 text-xs text-gray-400">
                                      <span>{p.owner}</span>
                                      <input type="range" min="0" max="100" value={p.progress} onChange={async e=>{try{await updateDoc(doc(db,'projectTimelines',p.id),{progress:Number(e.target.value)});}catch(err){console.error(err);}}} className="w-20"/>
                                      <span className="font-bold text-gray-700 w-8 text-right">%{p.progress}</span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 text-[10px] text-gray-400 mb-2">
                                    <span>{new Date(p.start).toLocaleDateString('tr-TR')}</span>
                                    <span>→</span>
                                    <span className={isLate?'text-red-500 font-bold':''}>{new Date(p.end).toLocaleDateString('tr-TR')}</span>
                                  </div>
                                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${p.status==='Tamamlandı'?'bg-emerald-400':isLate?'bg-red-400':'bg-blue-400'}`} style={{width:`${p.progress}%`}}/>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {p618Projects.length===0&&<p className="text-center text-gray-400 text-xs py-4">{tr618?'Zaman çizelgesi için proje ekleyin.':'Add projects to track on the timeline.'}</p>}
                      </div>
                    );
                  })()}
                </>
              )}
            </motion.div>
          )}

          {activeTab === 'kalite' && (
            <motion.div key="kalite" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('kalite') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Kalite Yönetimi':'Quality Management'} /> : (
                <>
                  {!hasFullAccess('kalite') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  {/* ── Phase 587: Kalite Kontrol Çeklisti ─────────────────────── */}
                  {(() => {
                    const tr587 = currentLanguage === 'tr';
                    const sevColors: Record<string,string> = {'Kritik':'text-red-600','Uyarı':'text-amber-600','Bilgi':'text-blue-600'};
                    const criticalFailed = p587Checks.filter(c=>c.severity==='Kritik'&&!c.checked).length;
                    return (
                      <div className="apple-card p-5">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="font-bold text-gray-900 text-sm">{tr587?'✅ Kalite Kontrol Çeklisti':'✅ Quality Inspection Checklist'}</h3>
                            {criticalFailed>0&&<p className="text-xs text-red-600 font-semibold mt-0.5">⚠️ {criticalFailed} {tr587?'kritik madde tamamlanmadı':'critical item(s) incomplete'}</p>}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-emerald-600">{p587Checks.filter(c=>c.checked).length}/{p587Checks.length}</span>
                          </div>
                        </div>
                        {p587Checks.length>0 && (
                          <div className="w-full bg-gray-200 rounded-full h-2 mb-4 overflow-hidden">
                            <div className="h-full bg-emerald-400 rounded-full transition-all" style={{width:`${p587Checks.length>0?(p587Checks.filter(c=>c.checked).length/p587Checks.length)*100:0}%`}}/>
                          </div>
                        )}
                        <div className="space-y-2 mb-4">
                          {p587Checks.map(c=>(
                            <div key={c.id} className={`flex items-center gap-3 p-3 rounded-xl ${c.checked?'bg-green-50/50':'bg-gray-50'}`}>
                              <button onClick={()=>setP587Checks(prev=>prev.map(x=>x.id===c.id?{...x,checked:!x.checked}:x))} className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${c.checked?'bg-emerald-500 border-emerald-500':'border-gray-300'}`}>
                                {c.checked&&<svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                              </button>
                              <span className={`flex-1 text-sm ${c.checked?'line-through text-gray-400':'text-gray-700'}`}>{c.item}</span>
                              <span className={`text-[10px] font-bold shrink-0 ${sevColors[c.severity]}`}>{c.severity}</span>
                              <button onClick={()=>setP587Checks(prev=>prev.filter(x=>x.id!==c.id))} className="text-gray-300 hover:text-red-400 shrink-0">✕</button>
                            </div>
                          ))}
                        </div>
                        {hasFullAccess('kalite') && (
                          <div className="flex gap-2">
                            <input className="flex-1 apple-input px-3 py-2 text-sm" placeholder={tr587?'Yeni kontrol maddesi...':'New check item...'} value={p587NewItem} onChange={e=>setP587NewItem(e.target.value)} onKeyDown={e=>{
                              if(e.key==='Enter'&&p587NewItem.trim()){
                                setP587Checks(prev=>[...prev,{id:Date.now().toString(),item:p587NewItem.trim(),checked:false,severity:'Bilgi'}]);
                                setP587NewItem('');
                              }
                            }} />
                            <button onClick={()=>{
                              if(!p587NewItem.trim()) return;
                              setP587Checks(prev=>[...prev,{id:Date.now().toString(),item:p587NewItem.trim(),checked:false,severity:'Bilgi'}]);
                              setP587NewItem('');
                            }} className="apple-button-primary px-3 py-2 text-sm">{tr587?'Ekle':'Add'}</button>
                            {p587Checks.length>0&&(
                              <button onClick={()=>setP587Checks(prev=>prev.map(c=>({...c,checked:true})))} className="apple-button-secondary px-3 py-2 text-xs">{tr587?'Tümünü İşaretle':'Check All'}</button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <QualityModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('kalite')} />

                  {/* ── Phase 615: Üretim Kalite Metrikleri ─────────────────────── */}
                  {hasFullAccess('kalite') && (() => {
                    const tr615 = currentLanguage === 'tr';
                    const totalProduced = p615Metrics.reduce((s,m)=>s+m.total,0);
                    const totalDefects  = p615Metrics.reduce((s,m)=>s+m.defects,0);
                    const totalRework   = p615Metrics.reduce((s,m)=>s+m.rework,0);
                    const defectRate = totalProduced>0?(totalDefects/totalProduced*100):0;
                    const firstPassYield = totalProduced>0?((totalProduced-totalDefects-totalRework)/totalProduced*100):0;
                    return (
                      <div className="apple-card p-5 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">📊 {tr615?'Üretim Kalite Metrikleri':'Production Quality Metrics'}</h3>
                          <button onClick={()=>setP615ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{tr615?'Kayıt Ekle':'Add Record'}</button>
                        </div>
                        {p615ShowForm && (
                          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                              <input type="date" className="apple-input" value={p615Draft.date} onChange={e=>setP615Draft(d=>({...d,date:e.target.value}))}/>
                              <input className="apple-input" placeholder={tr615?'Hat':'Line'} value={p615Draft.line} onChange={e=>setP615Draft(d=>({...d,line:e.target.value}))}/>
                              <input type="number" className="apple-input" placeholder={tr615?'Toplam':'Total'} value={p615Draft.total} onChange={e=>setP615Draft(d=>({...d,total:e.target.value}))}/>
                              <input type="number" className="apple-input" placeholder={tr615?'Hatalı':'Defects'} value={p615Draft.defects} onChange={e=>setP615Draft(d=>({...d,defects:e.target.value}))}/>
                              <input type="number" className="apple-input" placeholder={tr615?'Yeniden İşlem':'Rework'} value={p615Draft.rework} onChange={e=>setP615Draft(d=>({...d,rework:e.target.value}))}/>
                            </div>
                            <button onClick={()=>{
                              if(!p615Draft.line||!p615Draft.total) return;
                              setP615Metrics(prev=>[...prev,{id:Date.now().toString(),date:p615Draft.date,line:p615Draft.line,total:Number(p615Draft.total),defects:Number(p615Draft.defects)||0,rework:Number(p615Draft.rework)||0}]);
                              setP615Draft(d=>({...d,line:'',total:'',defects:'',rework:''}));
                              setP615ShowForm(false);
                              toast(tr615?'Kayıt eklendi.':'Record added.','success');
                            }} className="apple-button-primary text-xs px-6">{tr615?'Kaydet':'Save'}</button>
                          </div>
                        )}
                        {p615Metrics.length > 0 && (
                          <>
                            <div className="grid grid-cols-3 gap-3">
                              <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr615?'Toplam Üretim':'Total Produced'}</p><p className="text-xl font-black text-blue-600">{totalProduced.toLocaleString()}</p></div>
                              <div className="bg-red-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr615?'Hata Oranı':'Defect Rate'}</p><p className="text-xl font-black text-red-600">%{defectRate.toFixed(2)}</p></div>
                              <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr615?'İlk Geçiş Verimi':'First Pass Yield'}</p><p className="text-xl font-black text-emerald-600">%{firstPassYield.toFixed(1)}</p></div>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead><tr className="border-b border-gray-100 bg-gray-50">
                                  {[tr615?'Tarih':'Date',tr615?'Hat':'Line',tr615?'Toplam':'Total',tr615?'Hatalı':'Defects',tr615?'Yeniden İşlem':'Rework',tr615?'Hata %':'Defect %'].map(h=>(
                                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                  ))}
                                </tr></thead>
                                <tbody className="divide-y divide-gray-50">
                                  {[...p615Metrics].sort((a,b)=>b.date.localeCompare(a.date)).map(m=>{
                                    const dr = m.total>0?(m.defects/m.total*100):0;
                                    return (
                                      <tr key={m.id} className="hover:bg-gray-50/50">
                                        <td className="px-3 py-2 text-gray-500">{new Date(m.date).toLocaleDateString('tr-TR')}</td>
                                        <td className="px-3 py-2 font-medium text-gray-800">{m.line}</td>
                                        <td className="px-3 py-2 tabular-nums text-gray-600">{m.total}</td>
                                        <td className="px-3 py-2 tabular-nums text-red-600 font-bold">{m.defects}</td>
                                        <td className="px-3 py-2 tabular-nums text-amber-600">{m.rework}</td>
                                        <td className={`px-3 py-2 font-bold ${dr>5?'text-red-600':dr>2?'text-amber-600':'text-emerald-600'}`}>%{dr.toFixed(2)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                        {p615Metrics.length === 0 && <p className="text-center text-gray-400 text-xs py-4">{tr615?'Üretim kalite verisi ekleyin.':'Add production quality records.'}</p>}
                      </div>
                    );
                  })()}
                </>
              )}
            </motion.div>
          )}

          {activeTab === 'production' && (
            <motion.div key="production" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              {!canAccess('production') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'Üretim Yönetimi':'Production Management'} /> : (
                <>
                  {!hasFullAccess('production') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  {/* ── Üretim Group Nav ── */}
                  <div className="overflow-x-auto scrollbar-none">
                    <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
                      <button className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-brand text-white shadow-sm whitespace-nowrap">
                        <Factory className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Üretim Yönetimi' : 'Production'}
                      </button>
                      <button onClick={() => setActiveTab('lotseri')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <Hash className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Lot/Seri Takip' : 'Lot/Serial'}
                      </button>
                      <button onClick={() => setActiveTab('bakim')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <Wrench className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Bakım-Onarım' : 'Maintenance'}
                      </button>
                    </div>
                  </div>
                  {/* ── Phase 605: Üretim Kapasitesi Planlama ────────────────────── */}
                  {(() => {
                    const tr605 = currentLanguage === 'tr';
                    const totalUtil = p605Capacity.length > 0
                      ? p605Capacity.reduce((s,l)=>s+(l.maxCap>0?(l.planned/l.maxCap)*100:0),0)/p605Capacity.length : 0;
                    return (
                      <div className="apple-card p-5">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="font-bold text-gray-900 text-sm">{tr605?'🏭 Üretim Kapasitesi Planlama':'🏭 Production Capacity Planning'}</h3>
                            {p605Capacity.length>0&&<p className="text-xs text-gray-400 mt-0.5">{tr605?'Ort. Kapasite Kullanımı:':'Avg Utilization:'} <span className={`font-bold ${totalUtil>90?'text-red-600':totalUtil>70?'text-amber-600':'text-emerald-600'}`}>{totalUtil.toFixed(0)}%</span></p>}
                          </div>
                          {hasFullAccess('production')&&(<button onClick={()=>setP605ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{tr605?'Hat Ekle':'Add Line'}</button>)}
                        </div>
                        {p605ShowForm&&(
                          <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <input className="apple-input px-3 py-2 text-sm" placeholder={tr605?'Hat Adı':'Line Name'} value={p605Draft.line} onChange={e=>setP605Draft(d=>({...d,line:e.target.value}))} />
                              <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr605?'Max Kapasite':'Max Capacity'} value={p605Draft.maxCap} onChange={e=>setP605Draft(d=>({...d,maxCap:e.target.value}))} />
                              <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr605?'Planlanan':'Planned'} value={p605Draft.planned} onChange={e=>setP605Draft(d=>({...d,planned:e.target.value}))} />
                              <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr605?'Gerçekleşen':'Actual'} value={p605Draft.actual} onChange={e=>setP605Draft(d=>({...d,actual:e.target.value}))} />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={async ()=>{if(!p605Draft.line) return; try{await addDoc(collection(db,'capacityLines'),{line:p605Draft.line,maxCap:Number(p605Draft.maxCap)||0,planned:Number(p605Draft.planned)||0,actual:Number(p605Draft.actual)||0,createdAt:serverTimestamp()});}catch(e){console.error("[firestore]", e);} setP605Draft({line:'',maxCap:'',planned:'',actual:''}); setP605ShowForm(false);}} className="apple-button-primary text-sm px-4 py-1.5">{tr605?'Kaydet':'Save'}</button>
                              <button onClick={()=>setP605ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{tr605?'İptal':'Cancel'}</button>
                            </div>
                          </div>
                        )}
                        {p605Capacity.length===0?(
                          <p className="text-center py-6 text-gray-400 text-sm">{tr605?'"Hat Ekle" ile üretim hatlarını ve kapasitelerini tanımlayın.':'Click "Add Line" to define production lines and their capacities.'}</p>
                        ):(
                          <div className="space-y-3">
                            {p605Capacity.map((l,i)=>{
                              const planPct = l.maxCap>0?Math.min(100,(l.planned/l.maxCap)*100):0;
                              const actPct = l.maxCap>0?Math.min(100,(l.actual/l.maxCap)*100):0;
                              return (
                                <div key={i} className="space-y-1.5">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-semibold text-gray-800">{l.line}</span>
                                    <span className="text-gray-500">{l.actual}/{l.maxCap} {tr605?'birim':'units'} ({actPct.toFixed(0)}%)</span>
                                  </div>
                                  <div className="relative w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                                    <div className="absolute h-full bg-blue-200 rounded-full" style={{width:`${planPct}%`}}/>
                                    <div className={`absolute h-full rounded-full ${actPct>90?'bg-red-500':actPct>70?'bg-amber-400':'bg-emerald-400'}`} style={{width:`${actPct}%`}}/>
                                  </div>
                                  <p className="text-[10px] text-gray-400">{tr605?'Planlanan:':'Planned:'} {planPct.toFixed(0)}% · {tr605?'Gerçekleşen:':'Actual:'} {actPct.toFixed(0)}%</p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <ProductionModule currentLanguage={currentLanguage} isAuthenticated={!!user} />
                  {/* ── BOM / MRP ── */}
                  <div className="bg-white rounded-2xl border border-gray-100 p-6">
                    <BOMPanel currentLanguage={currentLanguage} />
                  </div>
                  {/* ── Phase 624: Üretim Emri Yönetimi ──────────────────────────── */}
                  {(() => {
                    const tr624 = currentLanguage === 'tr';
                    const statusCls:{[k:string]:string}={Planlandı:'bg-gray-100 text-gray-600',Üretimde:'bg-blue-100 text-blue-700',Tamamlandı:'bg-emerald-100 text-emerald-700',İptal:'bg-red-100 text-red-700'};
                    const inProd = p624Orders.filter(o=>o.status==='Üretimde').length;
                    const urgent = p624Orders.filter(o=>o.priority==='Acil'&&o.status!=='Tamamlandı'&&o.status!=='İptal').length;
                    return (
                      <div className="apple-card p-5 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">⚙️ {tr624?'Üretim Emri Yönetimi':'Production Order Management'}</h3>
                          <button onClick={()=>setP624ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{tr624?'Üretim Emri':'New Order'}</button>
                        </div>
                        {urgent>0&&<div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs font-bold text-red-700">🔴 {urgent} {tr624?'acil üretim emri':'urgent production order(s)'}</div>}
                        {p624ShowForm && (
                          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                              <input className="apple-input col-span-2 md:col-span-1" placeholder={tr624?'Ürün':'Product'} value={p624Draft.productName} onChange={e=>setP624Draft(d=>({...d,productName:e.target.value}))}/>
                              <input type="number" className="apple-input" placeholder={tr624?'Miktar':'Qty'} value={p624Draft.qty} onChange={e=>setP624Draft(d=>({...d,qty:e.target.value}))}/>
                              <input className="apple-input" placeholder={tr624?'İş Merkezi':'Work Center'} value={p624Draft.workCenter} onChange={e=>setP624Draft(d=>({...d,workCenter:e.target.value}))}/>
                              <input type="date" className="apple-input" value={p624Draft.plannedStart} onChange={e=>setP624Draft(d=>({...d,plannedStart:e.target.value}))}/>
                              <input type="date" className="apple-input" value={p624Draft.plannedEnd} onChange={e=>setP624Draft(d=>({...d,plannedEnd:e.target.value}))}/>
                              <select value={p624Draft.priority} onChange={e=>setP624Draft(d=>({...d,priority:e.target.value as typeof d.priority}))} className="apple-input">
                                {['Normal','Acil'].map(p=><option key={p}>{p}</option>)}
                              </select>
                            </div>
                            <button onClick={async ()=>{
                              if(!p624Draft.productName||!p624Draft.qty) return;
                              try { await addDoc(collection(db,'productionOrders'),{productName:p624Draft.productName,qty:Number(p624Draft.qty),plannedStart:p624Draft.plannedStart,plannedEnd:p624Draft.plannedEnd,status:'Planlandı',priority:p624Draft.priority,workCenter:p624Draft.workCenter,createdAt:serverTimestamp()}); toast(currentLanguage === 'tr' ? 'Üretim emri oluşturuldu ✓' : 'Production order created ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(currentLanguage === 'tr' ? 'Üretim emri oluşturulamadı.' : 'Failed to create order.', 'error');}
                              setP624Draft(d=>({...d,productName:'',qty:'',workCenter:'',plannedStart:'',plannedEnd:''}));
                              setP624ShowForm(false);
                              toast(tr624?'Üretim emri oluşturuldu.':'Production order created.','success');
                            }} className="apple-button-primary text-xs px-6">{tr624?'Oluştur':'Create'}</button>
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr624?'Üretimde':'In Prod.'}</p><p className="text-xl font-black text-blue-600">{inProd}</p></div>
                          <div className="bg-amber-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr624?'Planlandı':'Planned'}</p><p className="text-xl font-black text-amber-600">{p624Orders.filter(o=>o.status==='Planlandı').length}</p></div>
                          <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr624?'Tamamlanan':'Done'}</p><p className="text-xl font-black text-emerald-600">{p624Orders.filter(o=>o.status==='Tamamlandı').length}</p></div>
                        </div>
                        {p624Orders.length > 0 && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead><tr className="border-b border-gray-100 bg-gray-50">
                                {[tr624?'Ürün':'Product',tr624?'Miktar':'Qty',tr624?'İş Merkezi':'Work Center',tr624?'Başlangıç':'Start',tr624?'Bitiş':'End',tr624?'Durum':'Status',tr624?'Öncelik':'Priority'].map(h=>(
                                  <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                ))}
                              </tr></thead>
                              <tbody className="divide-y divide-gray-50">
                                {[...p624Orders].sort((a,b)=>a.plannedStart.localeCompare(b.plannedStart)).map(o=>(
                                  <tr key={o.id} className={`hover:bg-gray-50/50 ${o.priority==='Acil'?'bg-red-50/20':''}`}>
                                    <td className="px-3 py-2.5 font-medium text-gray-800">{o.productName}</td>
                                    <td className="px-3 py-2.5 text-gray-600">{o.qty}</td>
                                    <td className="px-3 py-2.5 text-gray-500">{o.workCenter||'—'}</td>
                                    <td className="px-3 py-2.5 text-gray-500">{o.plannedStart?new Date(o.plannedStart).toLocaleDateString('tr-TR'):'—'}</td>
                                    <td className="px-3 py-2.5 text-gray-500">{o.plannedEnd?new Date(o.plannedEnd).toLocaleDateString('tr-TR'):'—'}</td>
                                    <td className="px-3 py-2.5">
                                      <select value={o.status} onChange={async e=>{try{await updateDoc(doc(db,'productionOrders',o.id),{status:e.target.value});}catch(err){console.error(err);}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 ${statusCls[o.status]}`}>
                                        {['Planlandı','Üretimde','Tamamlandı','İptal'].map(s=><option key={s}>{s}</option>)}
                                      </select>
                                    </td>
                                    <td className="px-3 py-2.5"><span className={`text-[10px] font-bold ${o.priority==='Acil'?'text-red-600':'text-gray-400'}`}>{o.priority}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {p624Orders.length===0&&<p className="text-center text-gray-400 text-xs py-4">{tr624?'Üretim emri ekleyin.':'Create production orders to track manufacturing.'}</p>}
                      </div>
                    );
                  })()}

                  {/* ── Phase 637: Kapasite Planlama ──────────────────────────────── */}
                  {(() => {
                    const tr637 = currentLanguage === 'tr';
                    const horizonDays = p637Horizon==='7d'?7:p637Horizon==='30d'?30:90;
                    const cutoff637 = new Date(Date.now()+horizonDays*86400000).toISOString().slice(0,10);
                    const upcoming637 = p624Orders.filter(o=>o.status!=='Tamamlandı'&&o.status!=='İptal'&&o.plannedEnd&&o.plannedEnd<=cutoff637);
                    const workCenterLoad:{[wc:string]:{orders:number;totalQty:number}} = {};
                    upcoming637.forEach(o=>{
                      const wc = o.workCenter||tr637?'Genel Hat':'General Line';
                      if(!workCenterLoad[wc]) workCenterLoad[wc]={orders:0,totalQty:0};
                      workCenterLoad[wc].orders++;
                      workCenterLoad[wc].totalQty += o.qty||0;
                    });
                    const wcRows = Object.entries(workCenterLoad).map(([wc,d])=>({wc,...d})).sort((a,b)=>b.totalQty-a.totalQty);
                    const maxQty = wcRows.length>0?Math.max(...wcRows.map(r=>r.totalQty),1):1;
                    return (
                      <div className="apple-card p-5 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div><h3 className="font-bold text-gray-900 text-sm">🏭 {tr637?'Kapasite Planlama':'Capacity Planning'}</h3>
                          <p className="text-xs text-gray-400">{tr637?'İş merkezi bazında yük dağılımı':'Workload distribution by work center'}</p></div>
                          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                            {([{k:'7d',l:'7G'},{k:'30d',l:'30G'},{k:'90d',l:'90G'}] as {k:'7d'|'30d'|'90d';l:string}[]).map(t=>(
                              <button key={t.k} onClick={()=>setP637Horizon(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p637Horizon===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                            ))}
                          </div>
                        </div>
                        {wcRows.length > 0 ? (
                          <div className="space-y-3">
                            {wcRows.map(r=>{
                              const pct = maxQty>0?(r.totalQty/maxQty)*100:0;
                              const overloaded = pct > 80;
                              return (
                                <div key={r.wc}>
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="font-semibold text-gray-800">{r.wc}</span>
                                    <span className="text-gray-500">{r.orders} {tr637?'emir':'orders'} · {r.totalQty} {tr637?'birim':'units'}</span>
                                  </div>
                                  <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${overloaded?'bg-red-500':pct>50?'bg-amber-400':'bg-emerald-400'}`} style={{width:`${pct}%`}} />
                                  </div>
                                  {overloaded&&<p className="text-[10px] text-red-500 mt-0.5">⚠️ {tr637?'Yüksek yük — kapasite aşımı riski':'High load — capacity overrun risk'}</p>}
                                </div>
                              );
                            })}
                          </div>
                        ) : <p className="text-center text-gray-400 text-xs py-4">{tr637?`Önümüzdeki ${horizonDays} gün içinde planlanmış üretim emri yok.`:`No production orders planned in the next ${horizonDays} days.`}</p>}
                        <div className="grid grid-cols-3 gap-3 border-t border-gray-100 pt-3">
                          <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr637?'Bekleyen Emir':'Pending Orders'}</p><p className="text-xl font-black text-blue-600">{upcoming637.length}</p></div>
                          <div className="bg-amber-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr637?'İş Merkezi':'Work Centers'}</p><p className="text-xl font-black text-amber-600">{wcRows.length}</p></div>
                          <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr637?'Toplam Birim':'Total Units'}</p><p className="text-xl font-black text-emerald-600">{wcRows.reduce((s,r)=>s+r.totalQty,0)}</p></div>
                        </div>
                      </div>
                    );
                  })()}
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
              <AnalyticsPanel orders={orders} leads={leads} inventory={inventory} currentLanguage={currentLanguage as 'tr' | 'en'} />
            </motion.div>
          )}

          {/* ── eBA Onay Kuyruğu ── */}
          {activeTab === 'onaylar' && (
            <motion.div key="onaylar" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <ApprovalQueue
                currentLanguage={currentLanguage as 'tr' | 'en'}
                isAuthenticated={!!user}
                userRole={userRole}
                userEmail={user?.email}
                userName={user?.displayName}
              />
            </motion.div>
          )}

          {/* ── Admin Panel ── */}
          {/* ── Admin Panel ── */}
          {activeTab === 'admin' && (
            <React.Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-brand border-t-transparent rounded-full" /></div>}>
              <AdminPage
                adminTab={adminTab}
                setAdminTab={setAdminTab}
                isSuperAdmin={isSuperAdmin}
                kpiCurrency={kpiCurrency}
                setKpiCurrency={setKpiCurrency}
                canAccess={canAccess}
                hasFullAccess={hasFullAccess}
                currentLanguage={currentLanguage}
                currentT={currentT}
                orders={orders}
                leads={leads}
                inventory={inventory}
                exchangeRates={exchangeRates}
                employees={employees}
                inventoryMovements={inventoryMovements}
                userRole={userRole}
                user={user}
                isOwnerAdmin={isOwnerAdmin}
                auditLogs={auditLogs}
                companySettings={companySettings}
                setCompanySettings={setCompanySettings}
                notifPrefs={notifPrefs}
                toggleNotifPref={toggleNotifPref}
                accessMatrix={accessMatrix}
                setAccessMatrix={setAccessMatrix}
                firestoreUsers={firestoreUsers}
                mikroSettings={mikroSettings}
                lucaSettings={lucaSettings}
                setUserRole={setUserRole}
                openConfirm={openConfirm}
                toast={toast}
                logAuditAction={logAuditAction}
                setActiveTab={setActiveTab}
              />
            </React.Suspense>
          )}


          {/* ── Settings / Ayarlar ── */}
          {activeTab === 'settings' && (userRole === 'Admin' || userRole === 'Manager' || isOwnerAdmin) && (
            <motion.div key="settings" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6 max-w-3xl">
              <React.Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-brand border-t-transparent rounded-full" /></div>}>
                <SettingsPage
                  currentLanguage={currentLanguage}
                  userRole={userRole}
                  user={user}
                  isOwnerAdmin={isOwnerAdmin}
                  exchangeRates={exchangeRates}
                  setExchangeRates={setExchangeRates}
                  userSubscription={userSubscription}
                  paymentHistory={paymentHistory}
                  companySettings={companySettings}
                  setCompanySettings={setCompanySettings}
                  geminiApiKeySetting={geminiApiKeySetting}
                  setGeminiApiKeySetting={setGeminiApiKeySetting}
                  notifPrefs={notifPrefs}
                  toggleNotifPref={toggleNotifPref}
                  auditLogs={auditLogs}
                  webhookConfigs={webhookConfigs}
                  toast={toast}
                  logAuditAction={logAuditAction}
                  handleSelectPlan={handleSelectPlan}
                  handleCancelSubscription={handleCancelSubscription}
                  setShowPricingPage={setShowPricingPage}
                />
              </React.Suspense>
            </motion.div>
          )}

          {/* ── B2B Portal ── */}
          {activeTab === 'b2b' && (
            <motion.div key="b2b" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <B2BPortal user={user} userRole={userRole} leads={leads} inventory={inventory} orders={orders} currentT={currentT} currentLanguage={currentLanguage} exchangeRates={exchangeRates} />
            </motion.div>
          )}

          {/* ── E-Belge Merkezi ── */}
          {activeTab === 'ebelge' && (
            <motion.div key="ebelge" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('ebelge') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage === 'tr' ? 'E-Belge Merkezi' : 'E-Document Hub'} /> : (
                <>
                  {!hasFullAccess('ebelge') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  {/* ── Muhasebe Group Nav ── */}
                  <div className="overflow-x-auto scrollbar-none">
                    <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
                      <button onClick={() => setActiveTab('muhasebe')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <BookOpen className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Muhasebe & Finans' : 'Accounting & Finance'}
                      </button>
                      <button className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-brand text-white shadow-sm whitespace-nowrap">
                        <FileText className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'E-Belge Merkezi' : 'E-Document Hub'}
                      </button>
                      <button onClick={() => setActiveTab('vergi')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <Receipt className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Vergi Takvimi' : 'Tax Calendar'}
                      </button>
                    </div>
                  </div>
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'E-Belge Merkezi' : 'E-Document Hub'}
                    subtitle={currentLanguage === 'tr' ? 'E-Fatura, E-Arşiv, E-İrsaliye ve E-SMM belge yönetimi' : 'E-Invoice, E-Archive, E-Waybill and E-SMM document management'}
                    icon={FileText}
                  />
                  <EBelgeMerkezi currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('ebelge')} />
                </>
              )}
            </motion.div>
          )}

          {/* ── Bakım-Onarım ── */}
          {activeTab === 'bakim' && (
            <motion.div key="bakim" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('bakim') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage === 'tr' ? 'Bakım-Onarım' : 'Maintenance'} /> : (
                <>
                  {!hasFullAccess('bakim') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  {/* ── Üretim Group Nav ── */}
                  <div className="overflow-x-auto scrollbar-none">
                    <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
                      <button onClick={() => setActiveTab('production')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <Factory className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Üretim Yönetimi' : 'Production'}
                      </button>
                      <button onClick={() => setActiveTab('lotseri')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <Hash className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Lot/Seri Takip' : 'Lot/Serial'}
                      </button>
                      <button className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-brand text-white shadow-sm whitespace-nowrap">
                        <Wrench className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Bakım-Onarım' : 'Maintenance'}
                      </button>
                    </div>
                  </div>
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'Bakım-Onarım Yönetimi' : 'Plant Maintenance'}
                    subtitle={currentLanguage === 'tr' ? 'Ekipman sicili, iş emirleri, bakım planı ve arıza takibi' : 'Equipment register, work orders, maintenance schedule and failure tracking'}
                    icon={Wrench}
                  />
                  <BakimModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('bakim')} />
                </>
              )}
            </motion.div>
          )}

          {/* ── Servis Yönetimi ── */}
          {activeTab === 'servis' && (
            <motion.div key="servis" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('servis') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage === 'tr' ? 'Servis Yönetimi' : 'Service Management'} /> : (
                <>
                  {!hasFullAccess('servis') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  {/* ── CRM Group Nav ── */}
                  <div className="overflow-x-auto scrollbar-none">
                    <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
                      <button onClick={() => setActiveTab('crm')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <Users className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'CRM & Satış' : 'CRM & Sales'}
                      </button>
                      <button onClick={() => setActiveTab('sube')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <GitBranch className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Şubeler' : 'Branches'}
                      </button>
                      <button className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-brand text-white shadow-sm whitespace-nowrap">
                        <Headphones className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Servis' : 'Service'}
                      </button>
                    </div>
                  </div>
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'Servis Yönetimi' : 'After-Sales Service'}
                    subtitle={currentLanguage === 'tr' ? 'Servis talepleri, SLA takibi, garanti ve teknisyen yönetimi' : 'Service tickets, SLA tracking, warranty and technician management'}
                    icon={Headphones}
                  />
                  <ServisModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('servis')} />
                </>
              )}
            </motion.div>
          )}

          {/* ── İthalat / İhracat ── */}
          {activeTab === 'ihracat' && (
            <motion.div key="ihracat" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('ihracat') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage === 'tr' ? 'İthalat/İhracat' : 'Import/Export'} /> : (
                <>
                  {!hasFullAccess('ihracat') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  {/* ── Lojistik Group Nav ── */}
                  <div className="overflow-x-auto scrollbar-none">
                    <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
                      <button onClick={() => setActiveTab('lojistik')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <Truck className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Lojistik & Depo' : 'Logistics & Warehouse'}
                      </button>
                      <button className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-brand text-white shadow-sm whitespace-nowrap">
                        <Ship className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'İthalat/İhracat' : 'Import/Export'}
                      </button>
                    </div>
                  </div>
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'İthalat / İhracat' : 'Import / Export'}
                    subtitle={currentLanguage === 'tr' ? 'Dış ticaret, akreditif ve gümrük beyanname yönetimi' : 'Foreign trade, letters of credit and customs declarations'}
                    icon={Ship}
                  />
                  <IhracatModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('ihracat')} exchangeRates={exchangeRates} />
                </>
              )}
            </motion.div>
          )}

          {/* ── Territory Management ── */}
          {activeTab === 'territory' && (
            <motion.div key="territory" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <React.Suspense fallback={<div className="apple-card p-8 text-center text-gray-400">Yükleniyor…</div>}>
                <TerritoryModule
                  currentLanguage={currentLanguage}
                  isAuthenticated={!!user}
                  orders={orders}
                  leads={leads}
                />
              </React.Suspense>
            </motion.div>
          )}

          {/* ── CPQ ── */}
          {activeTab === 'cpq' && (
            <motion.div key="cpq" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <React.Suspense fallback={<div className="apple-card p-8 text-center text-gray-400">Yükleniyor…</div>}>
                <CPQPanel currentLanguage={currentLanguage} isAuthenticated={!!user} />
              </React.Suspense>
            </motion.div>
          )}

          {/* ── Performans Değerlendirme ── */}
          {activeTab === 'performans' && (
            <motion.div key="performans" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <React.Suspense fallback={<div className="apple-card p-8 text-center text-gray-400">Yükleniyor…</div>}>
                <PerformansModule
                  currentLanguage={currentLanguage}
                  isAuthenticated={!!user}
                  employees={employees}
                />
              </React.Suspense>
            </motion.div>
          )}

          {/* ── Dunning / Otomatik Tahsilat Hatırlatıcı ── */}
          {activeTab === 'dunning' && (
            <motion.div key="dunning" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <React.Suspense fallback={<div className="apple-card p-8 text-center text-gray-400">Yükleniyor…</div>}>
                <DunningModule
                  currentLanguage={currentLanguage}
                  isAuthenticated={!!user}
                  orders={orders}
                />
              </React.Suspense>
            </motion.div>
          )}

          {/* ── MRP II / Kapasite Planlama ── */}
          {activeTab === 'mrp' && (
            <motion.div key="mrp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <React.Suspense fallback={<div className="apple-card p-8 text-center text-gray-400">Yükleniyor…</div>}>
                <MRPModule
                  currentLanguage={currentLanguage}
                  isAuthenticated={!!user}
                  productionOrders={[]}
                  boms={[]}
                  inventory={inventory}
                />
              </React.Suspense>
            </motion.div>
          )}

          {/* ── Holding / Çok Şirketli Konsolidasyon ── */}
          {activeTab === 'holding' && (
            <motion.div key="holding" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <React.Suspense fallback={<div className="apple-card p-8 text-center text-gray-400">Yükleniyor…</div>}>
                <HoldingModule
                  currentLanguage={currentLanguage}
                  isAuthenticated={!!user}
                  exchangeRates={exchangeRates}
                />
              </React.Suspense>
            </motion.div>
          )}

          {/* ── Muhtasar & SGK e-Bildirge ── */}
          {activeTab === 'muhtasar' && (
            <motion.div key="muhtasar" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <React.Suspense fallback={<div className="apple-card p-8 text-center text-gray-400">Yükleniyor…</div>}>
                <MuhtasarModule
                  currentLanguage={currentLanguage}
                  isAuthenticated={!!user}
                />
              </React.Suspense>
            </motion.div>
          )}

          {/* ── Mobil WMS ── */}
          {activeTab === 'mobilewms' && (
            <motion.div key="mobilewms" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <React.Suspense fallback={<div className="apple-card p-8 text-center text-gray-400">Yükleniyor…</div>}>
                <MobileWMSModule
                  currentLanguage={currentLanguage}
                  isAuthenticated={!!user}
                  inventory={inventory}
                  orders={orders}
                />
              </React.Suspense>
            </motion.div>
          )}

          {/* ── IFRS 15 Gelir Tanıma ── */}
          {activeTab === 'gelirtanima' && (
            <motion.div key="gelirtanima" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <React.Suspense fallback={<div className="apple-card p-8 text-center text-gray-400">Yükleniyor…</div>}>
                <GelirTanimaModule
                  currentLanguage={currentLanguage}
                  isAuthenticated={!!user}
                />
              </React.Suspense>
            </motion.div>
          )}

          {/* ── Şube Yönetimi ── */}
          {activeTab === 'sube' && (
            <motion.div key="sube" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('sube') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage === 'tr' ? 'Şube Yönetimi' : 'Branch Management'} /> : (
                <>
                  {!hasFullAccess('sube') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  {/* ── CRM Group Nav ── */}
                  <div className="overflow-x-auto scrollbar-none">
                    <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
                      <button onClick={() => setActiveTab('crm')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <Users className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'CRM & Satış' : 'CRM & Sales'}
                      </button>
                      <button className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-brand text-white shadow-sm whitespace-nowrap">
                        <GitBranch className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Şubeler' : 'Branches'}
                      </button>
                      <button onClick={() => setActiveTab('servis')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <Headphones className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Servis' : 'Service'}
                      </button>
                    </div>
                  </div>
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'Şube Yönetimi' : 'Branch Management'}
                    subtitle={currentLanguage === 'tr' ? 'Şubeler, şubeler arası transfer ve şube bazlı P&L analizi' : 'Branches, inter-branch transfers and branch P&L analysis'}
                    icon={GitBranch}
                  />
                  <SubeModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('sube')} />
                </>
              )}
            </motion.div>
          )}

          {/* ── Vergi Takvimi ── */}
          {activeTab === 'vergi' && (
            <motion.div key="vergi" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('vergi') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage === 'tr' ? 'Vergi Takvimi' : 'Tax Calendar'} /> : (
                <>
                  {!hasFullAccess('vergi') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  {/* ── Muhasebe Group Nav ── */}
                  <div className="overflow-x-auto scrollbar-none">
                    <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
                      <button onClick={() => setActiveTab('muhasebe')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <BookOpen className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Muhasebe & Finans' : 'Accounting & Finance'}
                      </button>
                      <button onClick={() => setActiveTab('ebelge')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <FileText className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'E-Belge Merkezi' : 'E-Document Hub'}
                      </button>
                      <button className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-brand text-white shadow-sm whitespace-nowrap">
                        <Receipt className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Vergi Takvimi' : 'Tax Calendar'}
                      </button>
                    </div>
                  </div>
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'Vergi Takvimi' : 'Tax Calendar'}
                    subtitle={currentLanguage === 'tr' ? 'KDV, muhtasar, kurumlar vergisi ve diğer beyanname takvimleri' : 'VAT, withholding tax, corporate tax and other declaration schedules'}
                    icon={Receipt}
                  />
                  <VergiTakvimi currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('vergi')} orders={orders} />
                </>
              )}
            </motion.div>
          )}


          {activeTab === 'lotseri' && (
            <motion.div key="lotseri" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('lotseri') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage === 'tr' ? 'Lot/Seri Takip' : 'Lot/Serial'} /> : (
                <>
                  {!hasFullAccess('lotseri') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  {/* ── Üretim Group Nav ── */}
                  <div className="overflow-x-auto scrollbar-none">
                    <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
                      <button onClick={() => setActiveTab('production')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <Factory className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Üretim Yönetimi' : 'Production'}
                      </button>
                      <button className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-brand text-white shadow-sm whitespace-nowrap">
                        <Hash className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Lot/Seri Takip' : 'Lot/Serial'}
                      </button>
                      <button onClick={() => setActiveTab('bakim')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                        <Wrench className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Bakım-Onarım' : 'Maintenance'}
                      </button>
                    </div>
                  </div>
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'Lot & Seri No Takibi' : 'Lot & Serial Tracking'}
                    subtitle={currentLanguage === 'tr' ? 'Lot kayıtları, seri numaraları, hareketler ve karantina yönetimi' : 'Lot records, serial numbers, movements and quarantine management'}
                    icon={Hash}
                  />
                  <LotSeriModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('lotseri')} />
                </>
              )}
            </motion.div>
          )}

          {/* ── Fiyat İstihbaratı ── */}
          {activeTab === 'fiyat-istihbarat' && (
            <motion.div key="fiyat-istihbarat" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <React.Suspense fallback={<div className="p-8 text-center text-gray-400 text-sm">{currentLanguage === 'tr' ? 'Yükleniyor...' : 'Loading...'}</div>}>
                <PriceIntelPanel inventory={inventory} currentLanguage={currentLanguage} toast={toast as (m: string, t?: 'success' | 'error' | 'info') => void} />
              </React.Suspense>
            </motion.div>
          )}

          {/* ── Inventory ── */}
          {activeTab === 'inventory' && (
            <motion.div key="inventory" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <AIInlineNudge
                context="inventory"
                currentLanguage={currentLanguage}
                data={{ lowStockCount: inventory.filter(i=>(i.stockLevel??0)<=(i.lowStockThreshold??5)).length }}
                onAction={a => { if(a==='go-low-stock') window.scrollTo({top:400,behavior:'smooth'}); }}
              />
              {/* ── Ürün tablosu — sayfanın ana içeriği, en üstte ── */}
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
                onQuickPO={(item) => { setQuickPOProduct(item); setActiveTab('satin-alma'); }}
                exchangeRates={exchangeRates}
                consignments={consignments}
                stockDiscrepancies={stockDiscrepancies}
              />

              {/* ── Phase 94: Inventory KPI Summary Strip ── */}
              {inventory.length > 0 && (() => {
                const totalSKUs    = inventory.length;
                const totalUnits   = inventory.reduce((s, i) => s + (i.stockLevel ?? 0), 0);
                const outOfStock   = inventory.filter(i => (i.stockLevel ?? 0) === 0).length;
                const stockVal     = inventory.reduce((s, i) => s + (i.prices?.['Retail'] ?? i.price ?? 0) * (i.stockLevel ?? 0), 0);
                const costVal      = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
                const avgMarginPct = stockVal > 0 && costVal > 0
                  ? Math.round(((stockVal - costVal) / stockVal) * 100)
                  : null;
                const p94Rate = kpiCurrency === 'USD' ? (exchangeRates?.USD||1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR||1) : 1;
                const p94Sym  = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
                const p94Val  = kpiCurrency === 'TRY' ? stockVal : stockVal / p94Rate;
                return (
                  <>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{currentLanguage === 'tr' ? 'Envanter Özeti' : 'Inventory Summary'}</p>
                    <div className="flex items-center gap-2">
                      {/* Phase 507: Quick Stock Count button */}
                      <button
                        onClick={() => { setStockCountDraft({}); setStockCountSearch(''); setShowStockCount(true); }}
                        className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-brand bg-white border border-gray-200 hover:border-brand/30 px-3 py-1.5 rounded-full transition-all shadow-sm"
                        title={currentLanguage === 'tr' ? 'Hızlı stok sayımı' : 'Quick stock count'}
                      >
                        <Calculator className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Stok Sayımı' : 'Stock Count'}
                      </button>
                      <KpiCurrencyToggle kpiCurrency={kpiCurrency} setKpiCurrency={setKpiCurrency} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: currentLanguage === 'tr' ? 'Toplam SKU' : 'Total SKUs',       value: totalSKUs.toString(),  icon: '📋', color: 'text-gray-800',    bg: 'bg-white' },
                      { label: currentLanguage === 'tr' ? 'Stok Değeri' : 'Stock Value',     value: `${p94Sym}${p94Val.toLocaleString('tr-TR',{maximumFractionDigits:0})}`, icon: '💰', color: 'text-blue-700', bg: 'bg-blue-50' },
                      { label: currentLanguage === 'tr' ? 'Stok Dışı' : 'Out of Stock',      value: outOfStock.toString(), icon: '⚠️', color: outOfStock > 0 ? 'text-red-600' : 'text-emerald-700', bg: outOfStock > 0 ? 'bg-red-50' : 'bg-emerald-50' },
                      { label: currentLanguage === 'tr' ? 'Ort. Marj' : 'Avg Margin',        value: avgMarginPct != null ? `${avgMarginPct}%` : `${totalUnits.toLocaleString()} ${currentLanguage==='tr'?'birim':'units'}`, icon: avgMarginPct != null ? '📊' : '📦', color: avgMarginPct != null ? (avgMarginPct >= 40 ? 'text-emerald-700' : avgMarginPct >= 20 ? 'text-amber-700' : 'text-red-600') : 'text-purple-700', bg: 'bg-white' },
                    ].map((s, i) => (
                      <div key={i} className={`rounded-xl border border-gray-100 shadow-sm px-4 py-3 ${s.bg}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-base">{s.icon}</span>
                          <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                        </div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  </>
                );
              })()}

              {/* ── Phase 510: Inventory ABC Analysis ── */}
              {inventory.length >= 5 && (() => {
                const sorted510 = [...inventory].sort((a, b) =>
                  ((b.prices?.['Retail'] ?? b.price ?? 0) * (b.stockLevel ?? 0)) - ((a.prices?.['Retail'] ?? a.price ?? 0) * (a.stockLevel ?? 0))
                );
                const totalVal510 = sorted510.reduce((s, i) => s + (i.prices?.['Retail'] ?? i.price ?? 0) * (i.stockLevel ?? 0), 0);
                let cum510 = 0;
                const classes510 = { A: 0, B: 0, C: 0 };
                const classA: string[] = [], classB: string[] = [], classC: string[] = [];
                for (const item of sorted510) {
                  const v = (item.prices?.['Retail'] ?? item.price ?? 0) * (item.stockLevel ?? 0);
                  cum510 += v;
                  const pct = totalVal510 > 0 ? cum510 / totalVal510 : 1;
                  if (pct <= 0.7) { classes510.A++; classA.push(item.name); }
                  else if (pct <= 0.9) { classes510.B++; classB.push(item.name); }
                  else { classes510.C++; classC.push(item.name); }
                }
                const aVal = classA.length / sorted510.length * 100;
                const bVal = classB.length / sorted510.length * 100;
                const cVal = classC.length / sorted510.length * 100;
                return (
                  <div className={cn("rounded-2xl border px-5 py-4", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        {currentLanguage === 'tr' ? 'ABC Analizi (Stok Değeri)' : 'ABC Analysis (Stock Value)'}
                      </p>
                      <span className="text-[10px] text-gray-400">{sorted510.length} SKU</span>
                    </div>
                    {/* Stacked bar */}
                    <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-3">
                      <div className="bg-emerald-400 rounded-l-full transition-all" style={{ width: `${aVal}%` }} title={`A: ${classes510.A} items`} />
                      <div className="bg-amber-400 transition-all" style={{ width: `${bVal}%` }} title={`B: ${classes510.B} items`} />
                      <div className="bg-gray-300 rounded-r-full transition-all" style={{ width: `${cVal}%` }} title={`C: ${classes510.C} items`} />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { cls: 'A', count: classes510.A, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-100', desc: currentLanguage === 'tr' ? 'Yüksek Değer (İlk %70)' : 'High Value (Top 70%)', top: classA[0] },
                        { cls: 'B', count: classes510.B, color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-100',   desc: currentLanguage === 'tr' ? 'Orta Değer (%70-90)'  : 'Mid Value (70-90%)',  top: classB[0] },
                        { cls: 'C', count: classes510.C, color: 'text-gray-500',    bg: 'bg-gray-50',    border: 'border-gray-100',    desc: currentLanguage === 'tr' ? 'Düşük Değer (Son %10)' : 'Low Value (Bottom 10%)', top: classC[0] },
                      ].map(x => (
                        <div key={x.cls} className={cn("rounded-xl border p-3", x.bg, x.border)}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={cn("text-lg font-black", x.color)}>Sınıf {x.cls}</span>
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", x.bg, x.color)}>{x.count} SKU</span>
                          </div>
                          <p className="text-[10px] text-gray-400">{x.desc}</p>
                          {x.top && <p className="text-[9px] text-gray-500 truncate mt-1 font-medium" title={x.top}>{x.top}</p>}
                        </div>
                      ))}
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

              {/* ── Phase 114: Demand Forecasting ── */}
              {inventoryMovements.length > 0 && inventory.length > 0 && (() => {
                const now114 = Date.now();
                const MS_30D = 30 * 24 * 60 * 60 * 1000;
                const MS_60D = 60 * 24 * 60 * 60 * 1000;

                // Build monthly consumption map: productName → [last30, prev30]
                const cons: Record<string, { last30: number; prev30: number }> = {};
                for (const m of inventoryMovements) {
                  if (m.type !== 'out') continue;
                  const ts = (() => {
                    const t = m.timestamp;
                    if (!t) return 0;
                    if (typeof (t as { toDate?: () => Date }).toDate === 'function') return (t as { toDate: () => Date }).toDate().getTime();
                    return new Date(t as string | number).getTime();
                  })();
                  const age = now114 - ts;
                  const key = (m.productId as string | undefined) || m.productName;
                  cons[key] = cons[key] || { last30: 0, prev30: 0 };
                  if (age <= MS_30D) cons[key].last30 += m.quantity;
                  else if (age <= MS_60D) cons[key].prev30 += m.quantity;
                }

                // Build forecasts for all products with movement data
                type Forecast = { item: InventoryItem; last30: number; trend: number; nextMonth: number; weeksLeft: number };
                const forecasts: Forecast[] = [];
                for (const item of inventory) {
                  const key = item.id || item.name;
                  const data = cons[key] ?? cons[item.name];
                  if (!data || data.last30 === 0) continue;
                  const trend   = data.prev30 > 0 ? ((data.last30 - data.prev30) / data.prev30) * 100 : 0;
                  const nextMonth = Math.ceil(data.last30 * (1 + Math.max(trend / 100, -0.3)));
                  const stock   = item.stockLevel ?? 0;
                  const dailyRate = data.last30 / 30;
                  const weeksLeft = dailyRate > 0 ? Math.floor((stock / dailyRate) / 7) : 99;
                  forecasts.push({ item, last30: data.last30, trend, nextMonth, weeksLeft });
                }
                forecasts.sort((a, b) => a.weeksLeft - b.weeksLeft);
                if (forecasts.length === 0) return null;

                const urgent = forecasts.filter(f => f.weeksLeft <= 4);

                return (
                  <div className="bg-white border border-blue-100 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-blue-50 flex items-center justify-between bg-blue-50/40">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🔮</span>
                        <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Talep Tahmini' : 'Demand Forecast'}</h3>
                        {urgent.length > 0 && (
                          <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                            {urgent.length} {currentLanguage === 'tr' ? 'acil' : 'urgent'}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-blue-500">{currentLanguage === 'tr' ? '30 günlük harekete göre' : 'Based on 30-day velocity'}</span>
                    </div>
                    <div className="divide-y divide-gray-50 max-h-56 overflow-y-auto">
                      {forecasts.slice(0, 10).map(({ item, last30, trend, nextMonth, weeksLeft }) => {
                        const urgency = weeksLeft <= 1 ? 'text-red-600' : weeksLeft <= 3 ? 'text-amber-600' : 'text-emerald-600';
                        const trendStr = trend > 5 ? `↑${Math.round(trend)}%` : trend < -5 ? `↓${Math.round(Math.abs(trend))}%` : '→';
                        const trendColor = trend > 5 ? 'text-emerald-600' : trend < -5 ? 'text-red-500' : 'text-gray-400';
                        return (
                          <div key={item.id} className="flex items-center gap-4 px-5 py-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-gray-800 truncate">{item.name}</p>
                              <p className="text-[10px] text-gray-400">
                                {currentLanguage === 'tr' ? `Son 30 gün: ${last30} adet · Sonraki ay tahmini: ${nextMonth} adet` : `Last 30d: ${last30} units · Next month est.: ${nextMonth} units`}
                              </p>
                            </div>
                            <span className={`text-[10px] font-bold flex-shrink-0 ${trendColor}`}>{trendStr}</span>
                            <div className="flex-shrink-0 text-right">
                              <p className={`text-xs font-black ${urgency}`}>
                                {weeksLeft >= 99 ? '∞' : weeksLeft} {currentLanguage === 'tr' ? 'hafta' : 'wk'}
                              </p>
                              <p className="text-[9px] text-gray-400">{currentLanguage === 'tr' ? 'stok ömrü' : 'runway'}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="px-5 py-2.5 bg-gray-50/60 border-t border-gray-100 text-[10px] text-gray-400">
                      {currentLanguage === 'tr'
                        ? `${forecasts.length} ürün analiz edildi · Stok ömrü = mevcut stok ÷ günlük ortalama çıkış`
                        : `${forecasts.length} products analyzed · Runway = current stock ÷ avg daily outbound`}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 157: Product Margin Alert Panel ── */}
              {inventory.filter(i => i.costPrice > 0).length > 0 && (() => {
                const threshold157 = 15; // warn below 15% margin
                const lowMarginItems = inventory
                  .filter(i => {
                    const price = i.prices?.['Retail'] ?? i.price ?? 0;
                    const cost = i.costPrice ?? i.cost ?? 0;
                    if (price <= 0 || cost <= 0) return false;
                    const margin = ((price - cost) / price) * 100;
                    return margin < threshold157;
                  })
                  .map(i => {
                    const price = i.prices?.['Retail'] ?? i.price ?? 0;
                    const cost = i.costPrice ?? i.cost ?? 0;
                    return { ...i, margin: Math.round(((price - cost) / price) * 100), price, cost };
                  })
                  .sort((a, b) => a.margin - b.margin)
                  .slice(0, 10);
                if (lowMarginItems.length === 0) return null;
                return (
                  <div className="apple-card p-6 border border-amber-100">
                    <div className="flex items-center gap-2 mb-4">
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                      <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Düşük Marjlı Ürünler' : 'Low Margin Products'}</h3>
                      <span className="ml-auto text-xs text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded-full">
                        {lowMarginItems.length} {currentLanguage==='tr'?'ürün %'+threshold157+' altında':'products below '+threshold157+'%'}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Ürün':'Product'}</th>
                            <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Maliyet':'Cost'}</th>
                            <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Satış':'Price'}</th>
                            <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Marj':'Margin'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {lowMarginItems.map(item => (
                            <tr key={item.id} className={item.margin < 0 ? 'bg-red-50/40' : ''}>
                              <td className="py-2 px-2 font-medium text-gray-800 text-xs truncate max-w-[180px]">{item.name}</td>
                              <td className="py-2 px-2 text-right text-xs text-gray-500 tabular-nums">{fmtKpi(item.cost)}</td>
                              <td className="py-2 px-2 text-right text-xs text-gray-700 tabular-nums">{fmtKpi(item.price)}</td>
                              <td className="py-2 px-2 text-right">
                                <span className={`text-xs font-bold tabular-nums ${item.margin < 0 ? 'text-red-600' : item.margin < 10 ? 'text-orange-600' : 'text-amber-600'}`}>
                                  %{item.margin}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 561: MRP — Tedarik Öneri Raporu ─────────────────────────── */}
              {(() => {
                const tr561 = currentLanguage === 'tr';
                // Build demand map from open orders (Pending / Processing)
                const demandMap: Record<string, { name: string; demanded: number; stock: number; sku: string }> = {};
                orders.filter(o => o.status === 'Pending' || o.status === 'Processing').forEach(o => {
                  (o.lineItems || []).forEach(li => {
                    const invId = li.inventoryId || li.id;
                    if (!invId) return;
                    if (!demandMap[invId]) {
                      const invItem = inventory.find(i => i.id === invId || i.sku === li.sku);
                      demandMap[invId] = { name: li.name || li.title || '?', demanded: 0, stock: invItem?.stockLevel ?? 0, sku: li.sku || '' };
                    }
                    demandMap[invId].demanded += li.quantity || 0;
                  });
                });
                const suggestions = Object.values(demandMap).filter(d => d.demanded >= d.stock);
                if (suggestions.length === 0) return null;
                const visible = p561ShowAll ? suggestions : suggestions.slice(0,5);
                return (
                  <div className="apple-card p-5 border-l-4 border-blue-400">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-blue-500" />
                        <h4 className="font-bold text-blue-800 text-sm">
                          {tr561 ? `MRP — ${suggestions.length} Ürün Satın Alma Önerisi` : `MRP — ${suggestions.length} Purchase Suggestion${suggestions.length>1?'s':''}`}
                        </h4>
                      </div>
                      {suggestions.length > 5 && (
                        <button onClick={() => setP561ShowAll(v => !v)} className="text-xs text-blue-600 font-semibold hover:underline">
                          {p561ShowAll ? (tr561?'Daha az göster':'Show less') : (tr561?'Tümünü göster':'Show all')}
                        </button>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-blue-100">
                            {['SKU', tr561?'Ürün':'Product', tr561?'Stok':'Stock', tr561?'Talep':'Demand', tr561?'Açık':'Shortage', tr561?'Öneri':'Suggestion'].map(h => (
                              <th key={h} className="py-2 px-3 text-left text-[10px] font-bold text-blue-400 uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-blue-50">
                          {visible.map((s, i) => {
                            const shortage = s.demanded - s.stock;
                            const suggestQty = Math.ceil(shortage * 1.2); // 20% buffer
                            return (
                              <tr key={i} className="hover:bg-blue-50/50">
                                <td className="px-3 py-2 font-mono text-blue-500">{s.sku || '—'}</td>
                                <td className="px-3 py-2 font-semibold text-gray-800 max-w-[180px] truncate">{s.name}</td>
                                <td className="px-3 py-2 text-gray-600">{s.stock}</td>
                                <td className="px-3 py-2 text-amber-700 font-bold">{s.demanded}</td>
                                <td className="px-3 py-2 text-red-600 font-bold">−{shortage}</td>
                                <td className="px-3 py-2">
                                  <button onClick={() => { setQuickPOProduct({ name: s.name, sku: s.sku }); setActiveTab('satin-alma'); }}
                                    className="text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-600 px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap">
                                    + {suggestQty} {tr561?'birim al':'units PO'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[10px] text-blue-400 mt-2">{tr561?'Sadece bekleyen ve hazırlanan siparişler dikkate alınmıştır.':'Only Pending and Processing orders included.'}</p>
                  </div>
                );
              })()}

              {/* ── Phase 562: Stok Rezervasyon Özeti ─────────────────────────────── */}
              {(() => {
                const tr562 = currentLanguage === 'tr';
                // Build reservation map: sum quantities from Pending+Processing orders per sku
                const reservedMap: Record<string, { name: string; reserved: number; available: number; sku: string; stockLevel: number }> = {};
                orders.filter(o => o.status === 'Pending' || o.status === 'Processing').forEach(o => {
                  (o.lineItems || []).forEach(li => {
                    const key = li.sku || li.id;
                    if (!key) return;
                    if (!reservedMap[key]) {
                      const inv = inventory.find(i => i.sku === li.sku || i.id === li.inventoryId);
                      const stock = inv?.stockLevel ?? 0;
                      reservedMap[key] = { name: li.name || li.title || '?', reserved: 0, available: stock, sku: key, stockLevel: stock };
                    }
                    reservedMap[key].reserved += li.quantity || 0;
                  });
                });
                const reservations = Object.values(reservedMap).filter(r => r.reserved > 0);
                if (reservations.length === 0) return null;

                return (
                  <div className="apple-card overflow-hidden">
                    <button onClick={() => setP562ShowReservations(v => !v)}
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-purple-500" />
                        <h4 className="font-bold text-purple-800 text-sm">
                          {tr562 ? `Stok Rezervasyonları — ${reservations.length} Ürün` : `Stock Reservations — ${reservations.length} Item${reservations.length>1?'s':''}`}
                        </h4>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${p562ShowReservations?'rotate-180':''}`} />
                    </button>
                    <AnimatePresence>
                      {p562ShowReservations && (
                        <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} className="overflow-hidden">
                          <div className="overflow-x-auto border-t border-gray-100">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-purple-50 border-b border-purple-100">
                                  {['SKU', tr562?'Ürün':'Product', tr562?'Stok':'Total Stock', tr562?'Rezerve':'Reserved', tr562?'Kullanılabilir':'Available'].map(h => (
                                    <th key={h} className="py-2 px-4 text-left text-[10px] font-bold text-purple-400 uppercase">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {reservations.map((r, i) => {
                                  const avail = r.stockLevel - r.reserved;
                                  return (
                                    <tr key={i} className={`hover:bg-gray-50/50 ${avail < 0 ? 'bg-red-50/30' : ''}`}>
                                      <td className="px-4 py-2.5 font-mono text-gray-500">{r.sku}</td>
                                      <td className="px-4 py-2.5 font-semibold text-gray-800 max-w-[180px] truncate">{r.name}</td>
                                      <td className="px-4 py-2.5 text-gray-600">{r.stockLevel}</td>
                                      <td className="px-4 py-2.5 font-bold text-purple-700">{r.reserved}</td>
                                      <td className="px-4 py-2.5">
                                        <span className={`font-bold ${avail < 0 ? 'text-red-600' : avail === 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
                                          {avail}
                                        </span>
                                        {avail < 0 && <span className="ml-1 text-[9px] font-bold text-white bg-red-500 px-1 py-0.5 rounded">{tr562?'Açık':'OVERSOLD'}</span>}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <p className="px-4 pb-3 pt-2 text-[10px] text-gray-400">{tr562?'Bekleyen ve hazırlanan siparişlerden rezervasyon türetilmiştir.':'Reservations derived from Pending and Processing orders.'}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })()}

              {/* ── Phase 568: Ürün Maliyet Kartı ────────────────────────────────── */}
              {inventory.length > 0 && (() => {
                const tr568 = currentLanguage === 'tr';
                const itemsWithCost = inventory
                  .filter(i => (i.costPrice || i.cost || 0) > 0)
                  .map(i => {
                    const cost = i.costPrice || i.cost || 0;
                    const overhead = cost * (p568Overhead / 100);
                    const totalCost = cost + overhead;
                    const price = i.prices?.['Retail'] ?? i.price ?? 0;
                    const margin = price > 0 ? ((price - totalCost) / price) * 100 : 0;
                    const markupPct = totalCost > 0 ? ((price - totalCost) / totalCost) * 100 : 0;
                    return { ...i, cost, overhead, totalCost, price, margin, markupPct };
                  })
                  .sort((a,b) => {
                    if (p568SortBy === 'margin') return a.margin - b.margin;
                    if (p568SortBy === 'cost') return b.totalCost - a.totalCost;
                    return a.name.localeCompare(b.name);
                  });

                if (itemsWithCost.length === 0) return null;
                const avgMargin = itemsWithCost.reduce((s,i) => s+i.margin, 0) / itemsWithCost.length;
                const negativeMargin = itemsWithCost.filter(i => i.margin < 0).length;

                return (
                  <div className="apple-card overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-amber-500" />
                        <h4 className="font-bold text-gray-800 text-sm">{tr568?'Ürün Maliyet Analizi':'Product Cost Analysis'}</h4>
                        {negativeMargin > 0 && (
                          <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                            {negativeMargin} {tr568?'ürün negatif marj!':'items negative margin!'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-xs text-gray-600">
                          <label>{tr568?'Genel Gider %:':'Overhead %:'}</label>
                          <input type="number" min="0" max="100" value={p568Overhead}
                            onChange={e => setP568Overhead(Number(e.target.value))}
                            className="apple-input text-xs px-2 py-1 w-14" />
                        </div>
                        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                          {(['margin','cost','name'] as const).map(s => (
                            <button key={s} onClick={() => setP568SortBy(s)}
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md transition-all ${p568SortBy===s?'bg-white shadow-sm text-gray-800':'text-gray-400'}`}>
                              {s==='margin'?'%'+tr568?'Marj':'Margin':s==='cost'?(tr568?'Maliyet':'Cost'):(tr568?'İsim':'Name')}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {/* Avg margin banner */}
                    <div className={`px-5 py-2 text-xs font-semibold flex items-center gap-2 ${avgMargin>=30?'bg-emerald-50 text-emerald-700':avgMargin>=15?'bg-amber-50 text-amber-700':'bg-red-50 text-red-700'}`}>
                      <span>{tr568?'Ortalama Brüt Marj:':'Avg Gross Margin:'}</span>
                      <span className="font-black">%{avgMargin.toFixed(1)}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50">
                            {[tr568?'Ürün':'Product', 'SKU', tr568?'Alış Maliyeti':'Purchase Cost',
                              `${tr568?'Genel Gider':'Overhead'} (%${p568Overhead})`,
                              tr568?'Toplam Maliyet':'Total Cost', tr568?'Satış Fiyatı':'Sell Price',
                              tr568?'Brüt Marj':'Gross Margin', tr568?'Markup':'Markup'].map(h => (
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {itemsWithCost.slice(0,20).map(item => (
                            <tr key={item.id} className={`hover:bg-gray-50/50 transition-colors ${item.margin<0?'bg-red-50/20':item.margin<15?'bg-amber-50/20':''}`}>
                              <td className="px-3 py-2.5 font-semibold text-gray-800 max-w-[160px] truncate">{item.name}</td>
                              <td className="px-3 py-2.5 font-mono text-gray-400">{item.sku}</td>
                              <td className="px-3 py-2.5 font-mono text-gray-600">₺{item.cost.toLocaleString('tr-TR')}</td>
                              <td className="px-3 py-2.5 font-mono text-gray-500">₺{item.overhead.toLocaleString('tr-TR',{maximumFractionDigits:0})}</td>
                              <td className="px-3 py-2.5 font-mono font-bold text-gray-700">₺{item.totalCost.toLocaleString('tr-TR',{maximumFractionDigits:0})}</td>
                              <td className="px-3 py-2.5 font-mono text-gray-700">{item.price > 0 ? `₺${item.price.toLocaleString('tr-TR')}` : '—'}</td>
                              <td className="px-3 py-2.5">
                                <span className={`font-black text-sm ${item.margin>=30?'text-emerald-600':item.margin>=15?'text-amber-600':item.margin>=0?'text-orange-500':'text-red-600'}`}>
                                  {item.margin.toFixed(1)}%
                                </span>
                                <div className="w-16 h-1 bg-gray-100 rounded-full mt-0.5 overflow-hidden">
                                  <div className={`h-full rounded-full ${item.margin>=30?'bg-emerald-400':item.margin>=15?'bg-amber-400':'bg-red-400'}`}
                                    style={{width:`${Math.max(0,Math.min(100,item.margin))}%`}} />
                                </div>
                              </td>
                              <td className="px-3 py-2.5 font-mono text-gray-500">{item.price>0?`+${item.markupPct.toFixed(0)}%`:'—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {itemsWithCost.length > 20 && (
                      <p className="px-5 py-2 text-[10px] text-gray-400 border-t border-gray-50">{tr568?`${itemsWithCost.length-20} ürün daha var.`:`${itemsWithCost.length-20} more items.`}</p>
                    )}
                  </div>
                );
              })()}

              {/* ── Phase 574: Stok Değerleme Raporu ──────────────────────────────── */}
              {(() => {
                const tr574 = currentLanguage === 'tr';
                if (inventory.length === 0) return null;
                const methods574 = [
                  { id: 'cost' as const, label: tr574?'Maliyet Fiyatı':'Cost Price' },
                  { id: 'retail' as const, label: tr574?'Perakende Fiyatı':'Retail Price' },
                  { id: 'weighted' as const, label: tr574?'Ağırlıklı Ortalama':'Weighted Average' },
                ];
                const getItemValue = (item: typeof inventory[number]) => {
                  const qty = item.stockLevel || 0;
                  if (p574ValMethod === 'cost') return qty * (item.costPrice || 0);
                  if (p574ValMethod === 'retail') return qty * (item.prices?.['Retail'] || item.price || 0);
                  // weighted: avg of cost and retail
                  const cost = item.costPrice || 0;
                  const retail = item.prices?.['Retail'] || item.price || 0;
                  const avg = retail > 0 ? (cost + retail) / 2 : cost;
                  return qty * avg;
                };
                const catGroups574: Record<string,{count:number;qty:number;value:number}> = {};
                inventory.forEach(item => {
                  const cat = item.category || (tr574?'Genel':'General');
                  if (!catGroups574[cat]) catGroups574[cat] = {count:0,qty:0,value:0};
                  catGroups574[cat].count++;
                  catGroups574[cat].qty += item.stockLevel||0;
                  catGroups574[cat].value += getItemValue(item);
                });
                const catList574 = Object.entries(catGroups574).sort((a,b)=>b[1].value-a[1].value);
                const totalValue574 = catList574.reduce((s,[,v])=>s+v.value,0);
                const lowStockValue = inventory.filter(i=>i.stockLevel<=i.lowStockThreshold).reduce((s,i)=>s+getItemValue(i),0);
                return (
                  <div className="apple-card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <h3 className="font-bold text-gray-900 text-sm">{tr574?'📦 Stok Değerleme Raporu':'📦 Inventory Valuation Report'}</h3>
                      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                        {methods574.map(m=>(
                          <button key={m.id} onClick={()=>setP574ValMethod(m.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${p574ValMethod===m.id?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      {[
                        {label:tr574?'Toplam Değer':'Total Value', val:`₺${totalValue574.toLocaleString('tr-TR',{maximumFractionDigits:0})}`, color:'text-blue-700'},
                        {label:tr574?'Toplam SKU':'Total SKUs', val:String(inventory.length), color:'text-gray-700'},
                        {label:tr574?'Toplam Stok':'Total Stock', val:inventory.reduce((s,i)=>s+(i.stockLevel||0),0).toLocaleString(), color:'text-gray-700'},
                        {label:tr574?'Düşük Stok Değeri':'Low-Stock Value', val:`₺${lowStockValue.toLocaleString('tr-TR',{maximumFractionDigits:0})}`, color:'text-amber-600'},
                      ].map(k=>(
                        <div key={k.label} className="bg-gray-50 rounded-xl p-3">
                          <p className="text-[10px] text-gray-500 uppercase font-semibold">{k.label}</p>
                          <p className={`text-lg font-bold mt-0.5 ${k.color}`}>{k.val}</p>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      {catList574.map(([cat, v])=>{
                        const pct = totalValue574>0?(v.value/totalValue574)*100:0;
                        return (
                          <div key={cat} className="flex items-center gap-3">
                            <span className="text-xs text-gray-700 font-medium w-32 truncate">{cat}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                              <div className="h-full bg-blue-400 rounded-full" style={{width:`${pct}%`}} />
                            </div>
                            <span className="text-xs font-bold text-gray-700 w-28 text-right font-mono">₺{v.value.toLocaleString('tr-TR',{maximumFractionDigits:0})}</span>
                            <span className="text-[10px] text-gray-400 w-10 text-right">{pct.toFixed(0)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 579: Lot/Seri No Takibi ────────────────────────────────── */}
              {(() => {
                const tr579 = currentLanguage === 'tr';
                const filteredBatches = p579Batches.filter(b =>
                  !p579Search || b.productName.toLowerCase().includes(p579Search.toLowerCase()) || b.batchNo.toLowerCase().includes(p579Search.toLowerCase()) || b.sku.toLowerCase().includes(p579Search.toLowerCase())
                );
                const statusColors579: Record<string,string> = { 'Aktif': 'bg-green-100 text-green-700', 'Karantina': 'bg-red-100 text-red-700', 'Kullanıldı': 'bg-gray-100 text-gray-500' };
                const today579 = new Date().toISOString().slice(0,10);
                const expiringSoon = p579Batches.filter(b => b.status==='Aktif' && b.expiryDate && b.expiryDate > today579 && b.expiryDate <= new Date(Date.now()+30*86400000).toISOString().slice(0,10));
                const expired = p579Batches.filter(b => b.status==='Aktif' && b.expiryDate && b.expiryDate < today579);
                return (
                  <div className="apple-card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <h3 className="font-bold text-gray-900 text-sm">{tr579?'🏷️ Lot / Seri No Takibi':'🏷️ Batch / Serial Tracking'}</h3>
                      {hasFullAccess('inventory') && (
                        <button onClick={()=>setP579ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm">
                          <Plus className="w-4 h-4"/>{tr579?'Lot Ekle':'Add Batch'}
                        </button>
                      )}
                    </div>
                    {(expiringSoon.length>0||expired.length>0) && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {expired.length>0 && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 font-semibold">⚠️ {expired.length} {tr579?'lot süresi dolmuş':'batch(es) expired'}</div>}
                        {expiringSoon.length>0 && <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700 font-semibold">🔔 {expiringSoon.length} {tr579?'lot 30 gün içinde sona eriyor':'batch(es) expiring in 30 days'}</div>}
                      </div>
                    )}
                    {p579ShowForm && (
                      <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <input className="apple-input px-3 py-2 text-sm" placeholder="SKU" value={p579Draft.sku} onChange={e=>setP579Draft(d=>({...d,sku:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr579?'Ürün Adı':'Product Name'} value={p579Draft.productName} onChange={e=>setP579Draft(d=>({...d,productName:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr579?'Lot No':'Batch No'} value={p579Draft.batchNo} onChange={e=>setP579Draft(d=>({...d,batchNo:e.target.value}))} />
                          <input type="date" className="apple-input px-3 py-2 text-sm" placeholder={tr579?'SKT':'Expiry'} value={p579Draft.expiryDate} onChange={e=>setP579Draft(d=>({...d,expiryDate:e.target.value}))} />
                          <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr579?'Miktar':'Qty'} value={p579Draft.qty} onChange={e=>setP579Draft(d=>({...d,qty:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr579?'Lokasyon':'Location'} value={p579Draft.location} onChange={e=>setP579Draft(d=>({...d,location:e.target.value}))} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={()=>{
                            if(!p579Draft.batchNo||!p579Draft.sku) return;
                            setP579Batches(prev=>[...prev,{id:Date.now().toString(),sku:p579Draft.sku,productName:p579Draft.productName,batchNo:p579Draft.batchNo,expiryDate:p579Draft.expiryDate||undefined,qty:Number(p579Draft.qty)||0,location:p579Draft.location||undefined,status:'Aktif'}]);
                            setP579Draft({sku:'',productName:'',batchNo:'',expiryDate:'',qty:'',location:''});
                            setP579ShowForm(false);
                          }} className="apple-button-primary text-sm px-4 py-1.5">{tr579?'Kaydet':'Save'}</button>
                          <button onClick={()=>setP579ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{tr579?'İptal':'Cancel'}</button>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-3">
                      <Search className="w-4 h-4 text-gray-400"/>
                      <input className="flex-1 apple-input px-3 py-2 text-sm" placeholder={tr579?'SKU, ürün adı veya lot no ile ara...':'Search by SKU, product or batch no...'} value={p579Search} onChange={e=>setP579Search(e.target.value)} />
                    </div>
                    {filteredBatches.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-gray-300 text-4xl mb-2">🏷️</p>
                        <p className="text-gray-400 text-sm">{p579Batches.length===0?(tr579?'"Lot Ekle" ile takip başlatın.':'Click "Add Batch" to start tracking.'):(tr579?'Arama sonucu bulunamadı.':'No results found.')}</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-gray-100 bg-gray-50">
                            {['SKU', tr579?'Ürün':'Product', tr579?'Lot No':'Batch No', tr579?'SKT':'Expiry', tr579?'Miktar':'Qty', tr579?'Lokasyon':'Location', tr579?'Durum':'Status'].map(h=>(
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                            ))}
                          </tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {filteredBatches.map(b=>{
                              const isExp = b.expiryDate && b.expiryDate < today579;
                              const isExpSoon = b.expiryDate && !isExp && b.expiryDate <= new Date(Date.now()+30*86400000).toISOString().slice(0,10);
                              return (
                                <tr key={b.id} className={`hover:bg-gray-50/50 ${isExp?'bg-red-50/20':isExpSoon?'bg-amber-50/20':''}`}>
                                  <td className="px-3 py-2.5 font-mono text-gray-500">{b.sku}</td>
                                  <td className="px-3 py-2.5 font-medium text-gray-800 max-w-[140px] truncate">{b.productName||'—'}</td>
                                  <td className="px-3 py-2.5 font-mono font-bold text-gray-700">{b.batchNo}</td>
                                  <td className="px-3 py-2.5"><span className={isExp?'text-red-600 font-bold':isExpSoon?'text-amber-600 font-bold':'text-gray-500'}>{b.expiryDate||'—'}</span></td>
                                  <td className="px-3 py-2.5 font-bold text-gray-700">{b.qty}</td>
                                  <td className="px-3 py-2.5 text-gray-400">{b.location||'—'}</td>
                                  <td className="px-3 py-2.5">
                                    <select value={b.status} onChange={e=>setP579Batches(prev=>prev.map(x=>x.id===b.id?{...x,status:e.target.value as typeof b.status}:x))} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 cursor-pointer ${statusColors579[b.status]}`}>
                                      <option value="Aktif">{tr579?'Aktif':'Active'}</option>
                                      <option value="Karantina">{tr579?'Karantina':'Quarantine'}</option>
                                      <option value="Kullanıldı">{tr579?'Kullanıldı':'Used'}</option>
                                    </select>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Phase 584: Fiziksel Sayım (Cycle Count) ──────────────────── */}
              {(() => {
                const tr584 = currentLanguage === 'tr';
                if (!p584Active) return (
                  <div className="apple-card p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-gray-900 text-sm">{tr584?'📊 Fiziksel Sayım (Cycle Count)':'📊 Physical Inventory / Cycle Count'}</h3>
                        <p className="text-xs text-gray-400 mt-1">{tr584?'Sistem stoğunu gerçek sayımla karşılaştırın.':'Compare system quantities to physical count.'}</p>
                      </div>
                      {hasFullAccess('inventory') && (
                        <button onClick={()=>{
                          setP584CountItems(inventory.slice(0,50).map(i=>({id:i.id,sku:i.sku,name:i.name,systemQty:i.stockLevel||0,countedQty:undefined,variance:undefined})));
                          setP584Active(true);
                        }} className="apple-button-primary text-sm flex items-center gap-2">
                          <RefreshCw className="w-4 h-4"/>{tr584?'Sayım Başlat':'Start Count'}
                        </button>
                      )}
                    </div>
                  </div>
                );
                const counted = p584CountItems.filter(i=>i.countedQty!==undefined);
                const variances = counted.filter(i=>(i.variance||0)!==0);
                return (
                  <div className="apple-card p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-bold text-gray-900 text-sm">{tr584?'📊 Fiziksel Sayım':'📊 Cycle Count'}</h3>
                        <p className="text-xs text-gray-500">{counted.length}/{p584CountItems.length} {tr584?'sayıldı':'counted'} • {variances.length} {tr584?'fark':'variance(s)'}</p>
                      </div>
                      <button disabled={p584Finalizing} onClick={()=>void handleFinalizeCycleCount()} className="apple-button-secondary text-xs px-3 py-1.5 disabled:opacity-40">{p584Finalizing?'…':(tr584?'Sayımı Kapat ve Uygula':'End Count & Apply')}</button>
                    </div>
                    <div className="overflow-y-auto max-h-64">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-gray-100 bg-gray-50 sticky top-0">
                          {['SKU', tr584?'Ürün':'Product', tr584?'Sistem':'System', tr584?'Sayım':'Count', tr584?'Fark':'Variance'].map(h=>(
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody className="divide-y divide-gray-50">
                          {p584CountItems.map(item=>{
                            const v = item.countedQty!==undefined ? item.countedQty-item.systemQty : undefined;
                            return (
                              <tr key={item.id} className={`hover:bg-gray-50/50 ${v!==undefined&&v!==0?'bg-amber-50/30':''}`}>
                                <td className="px-3 py-2 font-mono text-gray-500">{item.sku}</td>
                                <td className="px-3 py-2 text-gray-700 max-w-[150px] truncate">{item.name}</td>
                                <td className="px-3 py-2 font-bold text-gray-600">{item.systemQty}</td>
                                <td className="px-3 py-2">
                                  <input type="number" className="w-16 apple-input px-2 py-0.5 text-xs" placeholder="—" value={item.countedQty??''} onChange={e=>{
                                    const val = e.target.value===''?undefined:Number(e.target.value);
                                    setP584CountItems(prev=>prev.map(x=>x.id===item.id?{...x,countedQty:val,variance:val!==undefined?val-x.systemQty:undefined}:x));
                                  }} />
                                </td>
                                <td className="px-3 py-2">
                                  {v!==undefined&&<span className={`font-bold ${v>0?'text-emerald-600':v<0?'text-red-600':'text-gray-400'}`}>{v>0?'+':''}{v}</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 588: Konsinye Stok Takibi ────────────────────────────── */}
              {(() => {
                const tr588 = currentLanguage === 'tr';
                const statusColors588: Record<string,string> = {'Depoda':'bg-blue-100 text-blue-700','Satıldı':'bg-green-100 text-green-700','İade Edildi':'bg-gray-100 text-gray-500'};
                const totalConsignValue = p588Consign.filter(c=>c.status==='Depoda').reduce((s,c)=>s+c.qty*c.agreedPrice,0);
                return (
                  <div className="apple-card p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-bold text-gray-900 text-sm">{tr588?'🤝 Konsinye Stok':'🤝 Consignment Stock'}</h3>
                        {p588Consign.length>0&&<p className="text-xs text-gray-500 mt-0.5">{tr588?'Depodaki değer:':'Value on hand:'} <span className="font-bold text-blue-600">₺{totalConsignValue.toLocaleString('tr-TR',{maximumFractionDigits:0})}</span></p>}
                      </div>
                      {hasFullAccess('inventory') && (
                        <button onClick={()=>setP588ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm">
                          <Plus className="w-4 h-4"/>{tr588?'Konsinye Ekle':'Add Consignment'}
                        </button>
                      )}
                    </div>
                    {p588ShowForm && (
                      <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr588?'Tedarikçi':'Supplier'} value={p588Draft.supplierName} onChange={e=>setP588Draft(d=>({...d,supplierName:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr588?'Ürün Adı':'Product'} value={p588Draft.productName} onChange={e=>setP588Draft(d=>({...d,productName:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder="SKU" value={p588Draft.sku} onChange={e=>setP588Draft(d=>({...d,sku:e.target.value}))} />
                          <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr588?'Miktar':'Qty'} value={p588Draft.qty} onChange={e=>setP588Draft(d=>({...d,qty:e.target.value}))} />
                          <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={tr588?'Anlaşma Fiyatı (₺)':'Agreed Price (₺)'} value={p588Draft.agreedPrice} onChange={e=>setP588Draft(d=>({...d,agreedPrice:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={tr588?'Lokasyon Kodu':'Location Code'} value={p588Draft.locationCode} onChange={e=>setP588Draft(d=>({...d,locationCode:e.target.value}))} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={()=>{
                            if(!p588Draft.supplierName||!p588Draft.productName) return;
                            setP588Consign(prev=>[...prev,{id:Date.now().toString(),supplierName:p588Draft.supplierName,productName:p588Draft.productName,sku:p588Draft.sku,qty:Number(p588Draft.qty)||0,agreedPrice:Number(p588Draft.agreedPrice)||0,locationCode:p588Draft.locationCode||undefined,startDate:p588Draft.startDate,status:'Depoda'}]);
                            setP588Draft({supplierName:'',productName:'',sku:'',qty:'',agreedPrice:'',locationCode:'',startDate:new Date().toISOString().slice(0,10)});
                            setP588ShowForm(false);
                          }} className="apple-button-primary text-sm px-4 py-1.5">{tr588?'Kaydet':'Save'}</button>
                          <button onClick={()=>setP588ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{tr588?'İptal':'Cancel'}</button>
                        </div>
                      </div>
                    )}
                    {p588Consign.length===0 ? (
                      <p className="text-center py-6 text-gray-400 text-sm">{tr588?'Henüz konsinye kaydı yok.':'No consignment records yet.'}</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-gray-100 bg-gray-50">
                            {[tr588?'Tedarikçi':'Supplier', tr588?'Ürün':'Product', 'SKU', tr588?'Miktar':'Qty', tr588?'Değer':'Value', tr588?'Durum':'Status'].map(h=>(
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                            ))}
                          </tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {p588Consign.map(c=>(
                              <tr key={c.id} className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5 font-medium text-gray-800">{c.supplierName}</td>
                                <td className="px-3 py-2.5 text-gray-600">{c.productName}</td>
                                <td className="px-3 py-2.5 font-mono text-gray-500">{c.sku}</td>
                                <td className="px-3 py-2.5 font-bold text-gray-700">{c.qty}</td>
                                <td className="px-3 py-2.5 font-bold font-mono text-blue-700">₺{(c.qty*c.agreedPrice).toLocaleString('tr-TR',{maximumFractionDigits:0})}</td>
                                <td className="px-3 py-2.5">
                                  <select value={c.status} onChange={e=>setP588Consign(prev=>prev.map(x=>x.id===c.id?{...x,status:e.target.value as typeof c.status}:x))} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 cursor-pointer ${statusColors588[c.status]}`}>
                                    <option>Depoda</option><option>Satıldı</option><option>İade Edildi</option>
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Phase 611: Stok Devir Hızı ───────────────────────────────── */}
              {inventory.length > 0 && (() => {
                const tr611 = currentLanguage === 'tr';
                const daysMap:{[k:string]:number} = {'30d':30,'90d':90,'180d':180};
                const days611 = daysMap[p611Period];
                const cutoff611 = new Date(Date.now() - days611*86400000);
                const recentOut611 = inventoryMovements.filter(m => {
                  if (m.type!=='out'||!m.timestamp) return false;
                  try { const d=(m.timestamp as {toDate?:()=>Date}).toDate?.()??new Date(m.timestamp as string); return d>=cutoff611; } catch { return false; }
                });
                // Aggregate qty out per product name
                const qtyOut:{[name:string]:number} = {};
                recentOut611.forEach(m=>{ qtyOut[m.productName]=(qtyOut[m.productName]||0)+(m.quantity||0); });
                const rows = inventory.map(item=>{
                  const sold = qtyOut[item.name]||0;
                  const avgStock = (item.stockLevel||0);
                  const turnover = avgStock>0?(sold/avgStock*(365/days611)):0;
                  return {name:item.name,sku:item.sku,stock:item.stockLevel||0,sold,turnover};
                }).filter(r=>r.sold>0||r.stock>0).sort((a,b)=>b.turnover-a.turnover).slice(0,10);
                if (rows.length===0) return null;
                return (
                  <div className="apple-card p-5">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <h3 className="font-bold text-gray-900 text-sm">🔄 {tr611?'Stok Devir Hızı':'Inventory Turnover'}</h3>
                      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                        {([{k:'30d',l:tr611?'30g':'30d'},{k:'90d',l:tr611?'90g':'90d'},{k:'180d',l:tr611?'180g':'180d'}] as {k:'30d'|'90d'|'180d';l:string}[]).map(t=>(
                          <button key={t.k} onClick={()=>setP611Period(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p611Period===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                        ))}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-gray-100 bg-gray-50">
                          {[tr611?'Ürün':'Product','SKU',tr611?'Mevcut':'Stock',tr611?`Satış (${p611Period})`:`Sales (${p611Period})`,tr611?'Devir Hızı':'Turnover'].map(h=>(
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody className="divide-y divide-gray-50">
                          {rows.map(r=>(
                            <tr key={r.sku} className="hover:bg-gray-50/50">
                              <td className="px-3 py-2.5 font-medium text-gray-800 truncate max-w-[160px]">{r.name}</td>
                              <td className="px-3 py-2.5 font-mono text-gray-500">{r.sku}</td>
                              <td className="px-3 py-2.5 text-gray-600">{r.stock}</td>
                              <td className="px-3 py-2.5 text-blue-600 font-bold">{r.sold}</td>
                              <td className={`px-3 py-2.5 font-bold ${r.turnover>=4?'text-emerald-600':r.turnover>=2?'text-amber-600':'text-red-500'}`}>{r.turnover.toFixed(1)}x</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}


              {/* ── Phase 642: Garanti Takip ─────────────────────────────────── */}
              {(() => {
                const tr642 = currentLanguage === 'tr';
                const today642 = new Date().toISOString().slice(0,10);
                const getExpiryDate = (w: typeof p642Warranties[0]) => {
                  const d = new Date(w.purchaseDate);
                  d.setMonth(d.getMonth()+w.warrantyMonths);
                  return d.toISOString().slice(0,10);
                };
                const statusCls:{[k:string]:string}={Aktif:'bg-emerald-100 text-emerald-700','Sona Erdi':'bg-gray-100 text-gray-600','Talep Açık':'bg-amber-100 text-amber-700'};
                const expiringSoon = p642Warranties.filter(w=>{const e=getExpiryDate(w);return e>=today642&&e<=new Date(Date.now()+30*86400000).toISOString().slice(0,10)&&w.status==='Aktif';});
                return (
                  <div className="apple-card p-5 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div><h3 className="font-bold text-gray-900 text-sm">🛡️ {tr642?'Garanti Takip':'Warranty Tracking'}</h3>
                      <p className="text-xs text-gray-400">{tr642?'Ürün garanti süreleri ve talep yönetimi':'Product warranty periods and claim management'}</p></div>
                      <button onClick={()=>setP642ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{tr642?'Garanti Ekle':'Add Warranty'}</button>
                    </div>
                    {expiringSoon.length>0&&<div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-amber-700">⚠️ {expiringSoon.length} {tr642?'ürün garantisi 30 gün içinde sona eriyor':'product warranty(ies) expiring within 30 days'}</div>}
                    {p642ShowForm && (
                      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <input className="apple-input" placeholder={tr642?'Ürün Adı':'Product Name'} value={p642Draft.productName} onChange={e=>setP642Draft(d=>({...d,productName:e.target.value}))}/>
                          <input className="apple-input" placeholder="SKU" value={p642Draft.sku} onChange={e=>setP642Draft(d=>({...d,sku:e.target.value}))}/>
                          <input className="apple-input" placeholder={tr642?'Seri No':'Serial No'} value={p642Draft.serialNo} onChange={e=>setP642Draft(d=>({...d,serialNo:e.target.value}))}/>
                          <input className="apple-input" placeholder={tr642?'Müşteri':'Customer'} value={p642Draft.customerName} onChange={e=>setP642Draft(d=>({...d,customerName:e.target.value}))}/>
                          <input type="date" className="apple-input" value={p642Draft.purchaseDate} onChange={e=>setP642Draft(d=>({...d,purchaseDate:e.target.value}))}/>
                          <input type="number" className="apple-input" placeholder={tr642?'Garanti (ay)':'Warranty (months)'} value={p642Draft.warrantyMonths} onChange={e=>setP642Draft(d=>({...d,warrantyMonths:e.target.value}))}/>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={async ()=>{
                            if(!p642Draft.productName) return;
                            try { await addDoc(collection(db,'warranties'),{productName:p642Draft.productName,sku:p642Draft.sku,serialNo:p642Draft.serialNo,customerName:p642Draft.customerName,purchaseDate:p642Draft.purchaseDate,warrantyMonths:Number(p642Draft.warrantyMonths)||12,status:'Aktif',createdAt:serverTimestamp()}); toast(currentLanguage === 'tr' ? 'Garanti kaydedildi ✓' : 'Warranty saved ✓', 'success'); } catch(e){console.error("[firestore]", e); toast(currentLanguage === 'tr' ? 'Garanti kaydedilemedi.' : 'Failed to save warranty.', 'error');}
                            setP642Draft({productName:'',sku:'',serialNo:'',customerName:'',purchaseDate:new Date().toISOString().slice(0,10),warrantyMonths:'12'});
                            setP642ShowForm(false);
                            toast(tr642?'Garanti kaydı oluşturuldu.':'Warranty record created.','success');
                          }} className="apple-button-primary text-xs px-6">{tr642?'Kaydet':'Save'}</button>
                          <button onClick={()=>setP642ShowForm(false)} className="apple-button-secondary text-xs px-4">{tr642?'İptal':'Cancel'}</button>
                        </div>
                      </div>
                    )}
                    {p642Warranties.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-gray-100 bg-gray-50">
                            {[tr642?'Ürün':'Product','SKU',tr642?'Seri No':'Serial',tr642?'Müşteri':'Customer',tr642?'Satın Alma':'Purchase',tr642?'Bitiş':'Expiry',tr642?'Durum':'Status'].map(h=>(
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                            ))}
                          </tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {p642Warranties.map(w=>{
                              const expiry = getExpiryDate(w);
                              const expired = expiry < today642;
                              const autoStatus: typeof w.status = expired?'Sona Erdi':w.status;
                              return (
                                <tr key={w.id} className="hover:bg-gray-50/50">
                                  <td className="px-3 py-2.5 font-semibold text-gray-800">{w.productName}</td>
                                  <td className="px-3 py-2.5 font-mono text-gray-500">{w.sku||'—'}</td>
                                  <td className="px-3 py-2.5 font-mono text-gray-500">{w.serialNo||'—'}</td>
                                  <td className="px-3 py-2.5 text-gray-600">{w.customerName||'—'}</td>
                                  <td className="px-3 py-2.5 text-gray-500">{new Date(w.purchaseDate).toLocaleDateString('tr-TR')}</td>
                                  <td className={`px-3 py-2.5 font-semibold ${expired?'text-red-500':expiry<=new Date(Date.now()+30*86400000).toISOString().slice(0,10)?'text-amber-500':'text-gray-600'}`}>{new Date(expiry).toLocaleDateString('tr-TR')}</td>
                                  <td className="px-3 py-2.5">
                                    <select value={autoStatus} onChange={async e=>{try{await updateDoc(doc(db,'warranties',w.id),{status:e.target.value});}catch(err){console.error(err);}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 ${statusCls[autoStatus]}`}>
                                      {['Aktif','Sona Erdi','Talep Açık'].map(s=><option key={s}>{s}</option>)}
                                    </select>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-center text-gray-400 text-xs py-4">{tr642?'Garanti kaydı ekleyin.':'Add warranty records to track product warranties.'}</p>}
                  </div>
                );
              })()}

              {/* ── Phase 644: MRP / Malzeme İhtiyaç Planlaması ─────────────── */}
              {inventory.length > 0 && (() => {
                const tr644 = currentLanguage === 'tr';
                // Determine demand from open orders
                const demandMap:{[sku:string]:{name:string;demand:number}} = {};
                orders.filter(o=>o.status==='Pending'||o.status==='Processing').forEach(o=>{
                  (o.lineItems||[]).forEach(li=>{
                    if(!demandMap[li.sku]) demandMap[li.sku]={name:li.name||li.sku,demand:0};
                    demandMap[li.sku].demand += li.quantity||1;
                  });
                });
                const mrpRows = Object.entries(demandMap).map(([sku,d])=>{
                  const item = inventory.find(i=>i.sku===sku||i.name===d.name);
                  const onHand = item?.stockLevel||0;
                  const reorderPoint = item?.lowStockThreshold||5;
                  const net = onHand - d.demand;
                  const needToProcure = Math.max(0, d.demand - onHand);
                  const status: 'OK'|'Sipariş Ver'|'Kritik' = net >= reorderPoint ? 'OK' : needToProcure > 0 ? 'Sipariş Ver' : 'Kritik';
                  return {sku,name:d.name,demand:d.demand,onHand,reorderPoint,net,needToProcure,status};
                }).sort((a,b)=>b.needToProcure-a.needToProcure);
                const criticalCount = mrpRows.filter(r=>r.status==='Kritik'||r.status==='Sipariş Ver').length;
                const statusCls644:{[k:string]:string}={OK:'bg-emerald-100 text-emerald-700','Sipariş Ver':'bg-amber-100 text-amber-700',Kritik:'bg-red-100 text-red-700'};
                return (
                  <div className="apple-card p-5 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div><h3 className="font-bold text-gray-900 text-sm">🔧 {tr644?'MRP — Malzeme İhtiyaç Planlaması':'MRP — Material Requirements Planning'}</h3>
                      <p className="text-xs text-gray-400">{tr644?'Açık siparişlere göre net malzeme ihtiyacı hesabı':'Net material requirements from open orders'}</p></div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{tr644?'Ufuk:':'Horizon:'}</span>
                        <input type="number" value={p644Horizon} onChange={e=>setP644Horizon(Math.max(1,Number(e.target.value)))} className="apple-input px-2 py-1 text-xs w-14 text-right" />
                        <span className="text-xs text-gray-500">{tr644?'gün':'days'}</span>
                      </div>
                    </div>
                    {criticalCount > 0 && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-red-700">⚠️ {criticalCount} {tr644?'ürün için tedarik gerekiyor':'product(s) require procurement'}</div>}
                    {mrpRows.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-gray-100 bg-gray-50">
                            {['SKU',tr644?'Ürün':'Product',tr644?'Talep':'Demand',tr644?'Eldeki':'On Hand',tr644?'Net':'Net',tr644?'Tedarik Et':'Procure',tr644?'Durum':'Status'].map(h=>(
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                            ))}
                          </tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {mrpRows.map(r=>(
                              <tr key={r.sku} className={`hover:bg-gray-50/50 ${r.status==='Kritik'?'bg-red-50/20':r.status==='Sipariş Ver'?'bg-amber-50/20':''}`}>
                                <td className="px-3 py-2.5 font-mono text-gray-500">{r.sku}</td>
                                <td className="px-3 py-2.5 font-semibold text-gray-800">{r.name}</td>
                                <td className="px-3 py-2.5 font-bold text-blue-600">{r.demand}</td>
                                <td className="px-3 py-2.5 font-mono text-gray-600">{r.onHand}</td>
                                <td className={`px-3 py-2.5 font-bold ${r.net<0?'text-red-600':'text-emerald-600'}`}>{r.net}</td>
                                <td className="px-3 py-2.5 font-bold text-orange-600">{r.needToProcure > 0 ? r.needToProcure : '—'}</td>
                                <td className="px-3 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusCls644[r.status]}`}>{tr644&&r.status==='OK'?'Yeterli':r.status}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-4 space-y-1">
                        <p className="text-gray-400 text-xs">{tr644?`Ufuk dahilindeki açık siparişlere ait talep yok (${p644Horizon} gün).`:`No demand from open orders within the ${p644Horizon}-day horizon.`}</p>
                        <p className="text-[10px] text-gray-300">{tr644?'Planlanmış ve Onaylanmış siparişler dahil edilmektedir.':'Planned and Confirmed orders are included.'}</p>
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400">Ufuk: {tr644?'önümüzdeki':'next'} {p644Horizon} {tr644?'gün':'days'} · {tr644?'son güncelleme:':'as of:'} {new Date().toLocaleDateString('tr-TR')}</p>
                  </div>
                );
              })()}
            </motion.div>
          )}

          {/* ── CRM Pipeline ── */}
          {/* ── CRM ── */}
          {(activeTab === 'crm' || activeTab === 'iade') && (
            <React.Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-brand border-t-transparent rounded-full" /></div>}>
              <CRMPage
                crmTab={crmTab}
                setCrmTab={setCrmTab}
                selectedLead={selectedLead}
                setSelectedLead={setSelectedLead}
                hasFullAccess={hasFullAccess}
                currentLanguage={currentLanguage}
                currentT={currentT}
                orders={orders}
                leads={leads}
                inventory={inventory}
                exchangeRates={exchangeRates}
                employees={employees}
                userRole={userRole}
                user={user}
                kpiCurrency={kpiCurrency}
                setKpiCurrency={setKpiCurrency}
                appQuotations={appQuotations}
                activeTab={activeTab}
                darkMode={darkMode}
                warehouses={warehouses}
                supportTickets={supportTickets}
                commissionRules={commissionRules}
                trackView={trackView}
                setIsEditingLead={setIsEditingLead}
                setEmailCompose={setEmailCompose}
                setNewOrder={setNewOrder}
                setOrderCustomerSearch={setOrderCustomerSearch}
                handleToggleOrderPaid={handleToggleOrderPaid}
                openConfirm={openConfirm}
                toast={toast}
                setActiveTab={setActiveTab}
                setIsAddingLead={setIsAddingLead}
                setSelectedOrder={setSelectedOrder}
                setIsAddingOrder={setIsAddingOrder}
                logAuditAction={logAuditAction}
              />
            </React.Suspense>
          )}


          {/* ── Orders List ── */}
          {/* ── Orders + Lojistik (her ikisi de OrdersPage içinde) ── */}
          {(activeTab === 'orders' || activeTab === 'lojistik') && (
            <React.Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-brand border-t-transparent rounded-full" /></div>}>
              <OrdersPage
                selectedOrder={selectedOrder}
                setSelectedOrder={setSelectedOrder}
                lojistikTab={lojistikTab}
                setLojistikTab={setLojistikTab}
                routeStops={routeStops}
                isRouteOptimized={isRouteOptimized}
                selectedDepot={selectedDepot}
                setSelectedDepot={setSelectedDepot}
                DEPOTS={DEPOTS}
                recurringOrders={recurringOrders}
                hasFullAccess={hasFullAccess}
                currentLanguage={currentLanguage}
                currentT={currentT}
                orders={orders}
                leads={leads}
                inventory={inventory}
                exchangeRates={exchangeRates}
                employees={employees}
                userRole={userRole}
                user={user}
                kpiCurrency={kpiCurrency}
                activeTab={activeTab}
                darkMode={darkMode}
                warehouses={warehouses}
                vehicles={vehicles}
                locationStocks={locationStocks}
                shipments={shipments}
                newOrder={newOrder}
                setNewOrder={setNewOrder}
                orderLineItems={orderLineItems}
                setOrderLineItems={setOrderLineItems}
                handleMikroFatura={handleMikroFatura}
                handleIyzicoPaymentLink={handleIyzicoPaymentLink}
                setRouteStops={setRouteStops}
                handleBuildRoute={handleBuildRoute}
                handleClearRoute={handleClearRoute}
                handleToggleOrderPaid={handleToggleOrderPaid}
                trackView={trackView}
                openConfirm={openConfirm}
                toast={toast}
                setActiveTab={setActiveTab}
                setSelectedLead={setSelectedLead}
                setIsAddingOrder={setIsAddingOrder}
                logAuditAction={logAuditAction}
              />
            </React.Suspense>
          )}

        </AnimatePresence>
        </React.Suspense>
        </TabErrorBoundary>
      </main>
      </div>{/* ── /flex wrapper (sidebar + main) ── */}

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

      {/* ── Add Lead Modal (Zod-validated) ── */}
      <NewLeadModal
        isOpen={isAddingLead}
        isScoring={isScoring}
        fromOrder={leadFromOrderRef.current}
        currentLanguage={currentLanguage}
        currentT={currentT}
        onClose={() => { leadFromOrderRef.current = false; setIsAddingLead(false); }}
        onSubmit={handleAddLead}
      />

      {/* ── Add Order Modal ── */}
      <AddOrderModal
        isOpen={isAddingOrder}
        onClose={() => setIsAddingOrder(false)}
        selectedLead={selectedLead}
        setSelectedLead={setSelectedLead}
        leads={leads}
        inventory={inventory}
        branchNames={branchNames}
        currentLanguage={currentLanguage}
        currentT={currentT}
        onSubmit={handleAddOrder}
        onAddLeadClick={() => { leadFromOrderRef.current = true; setIsAddingLead(true); }}
        onGoToInventory={() => setActiveTab('inventory')}
      />

      {/* ── Add Shipment Modal ── */}
      <AddShipmentModal
        isOpen={isAddingShipment}
        onClose={() => {
          setIsAddingShipment(false);
          setEditingShipmentId(null);
        }}
        leads={leads}
        initialData={shipmentInitialData}
        onSubmit={handleAddShipmentSubmit}
      />

      {/* ── Edit Lead Modal ── */}
      <EditLeadModal
        isOpen={isEditingLead}
        onClose={() => setIsEditingLead(false)}
        lead={selectedLead}
        currentT={currentT}
        onSubmit={handleEditLeadSubmit}
      />

      {/* ── Edit Order Modal ── */}
      <EditOrderModal
        isOpen={isEditingOrder}
        onClose={() => setIsEditingOrder(false)}
        order={selectedOrder}
        currentT={currentT}
        onSubmit={handleEditOrderSubmit}
      />
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

      {/* ── Back to Top (sol alt) ── */}
      <BackToTopButton />

      {/* ── Email Verification Banner ── */}
      {user && !user.isAnonymous && user.providerData?.[0]?.providerId === 'password' && !user.emailVerified && (
        <div className="fixed top-0 left-0 right-0 z-[300] bg-amber-500 text-white text-xs font-bold px-4 py-2.5 flex items-center justify-between gap-4 shadow-lg">
          <span>
            {currentLanguage === 'tr'
              ? `📧 E-posta adresinizi doğrulamanız gerekiyor. ${user.email} adresine bir doğrulama bağlantısı gönderildi.`
              : `📧 Please verify your email address. A verification link was sent to ${user.email}.`}
          </span>
          <button
            onClick={async () => { try { await sendEmailVerification(user); toast(currentLanguage === 'tr' ? 'Doğrulama e-postası yeniden gönderildi.' : 'Verification email resent.', 'success'); } catch { /* ignore */ } }}
            className="shrink-0 bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1 transition-colors whitespace-nowrap"
          >
            {currentLanguage === 'tr' ? 'Yeniden Gönder' : 'Resend'}
          </button>
        </div>
      )}

      {/* ── Onboarding Checklist (post-purchase activation) ── */}
      {user && userSubscription && (
        <OnboardingChecklist
          userId={user.uid}
          currentLanguage={currentLanguage}
          onNavigate={(tab, subTarget) => {
            setSelectedLead(null); setSelectedOrder(null); // açık detay görünümünü kapat
            setActiveTab(tab as typeof activeTab);
            // Hedef sayfanın doğru alt-sekmesine/aksiyonuna indir
            if (tab === 'crm') setCrmTab(subTarget === 'musteriler' ? 'musteriler' : 'leads');
            else if (tab === 'muhasebe') setMuhasebeTab(subTarget === 'banka' ? 'banka' : 'genel');
            else if (tab === 'orders' && subTarget === 'add') setIsAddingOrder(true);
            else if (tab === 'admin') setAdminTab(subTarget === 'invite' ? 'users' : 'overview');
          }}
          onOpenImport={() => setShowDataImport(true)}
        />
      )}

      {/* ── Data Import Wizard ── */}
      <DataImportWizard
        isOpen={showDataImport}
        onClose={() => setShowDataImport(false)}
        currentLanguage={currentLanguage}
        userId={user?.uid ?? ''}
      />

      <AIChat
        currentLanguage={currentLanguage}
        businessContext={(() => {
          const now = new Date();
          const thisMonth = orders.filter(o => {
            if (!o.createdAt) return false;
            try { const d = typeof (o.createdAt as {toDate?:()=>Date}).toDate === 'function' ? (o.createdAt as {toDate:()=>Date}).toDate() : new Date(o.createdAt as string); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); } catch { return false; }
          });
          const totalRev = thisMonth.filter(o=>o.status!=='Cancelled').reduce((s,o)=>s+(o.totalPrice||0),0);
          const pendingOrders = orders.filter(o=>o.status==='Pending').length;
          const processingOrders = orders.filter(o=>o.status==='Processing').length;
          const lowStockItems = inventory.filter(i=>(i.stockLevel||0)<=(i.lowStockThreshold||5)).length;
          const activeLeads = leads.filter(l=>!['Closed Won','Closed Lost','Closed'].includes(l.status)).length;
          const topLead = [...leads].sort((a,b)=>(b.score||0)-(a.score||0))[0];
          const cancelledRatio = orders.length > 0 ? Math.round(orders.filter(o=>o.status==='Cancelled').length / orders.length * 100) : 0;
          return [
            `Bu Ay Ciro: ₺${Math.round(totalRev).toLocaleString('tr-TR')} (${thisMonth.length} sipariş)`,
            `Bekleyen Siparişler: ${pendingOrders} | İşlemde: ${processingOrders}`,
            `Düşük Stok Uyarısı: ${lowStockItems} ürün`,
            `Aktif Lead: ${activeLeads}${topLead ? ` | En Yüksek Puanlı: ${topLead.name} (${topLead.score||'?'})` : ''}`,
            `Toplam Sipariş: ${orders.length} | İptal Oranı: %${cancelledRatio}`,
            `Toplam Envanter SKU: ${inventory.length} | Çalışan: ${employees.filter(e=>e.status==='Aktif').length}`,
          ].join('\n');
        })()}
      />

      {/* ── Phase 112: RMA / Return Modal ── */}
      {returnModal.open && returnModal.order && (
        <ReturnModal
          order={returnModal.order}
          onClose={() => setReturnModal({ open: false, order: null })}
          currentLanguage={currentLanguage as 'tr' | 'en'}
          userEmail={user?.email || 'guest'}
          onSuccess={(msg) => toast(msg, 'success')}
          onError={(msg) => toast(msg, 'error')}
        />
      )}

      {/* ── Phase 100: In-App Email Compose Modal ── */}
      {emailCompose.open && (
        <EmailComposeModal
          emailCompose={emailCompose}
          setEmailCompose={setEmailCompose}
          currentLanguage={currentLanguage as 'tr' | 'en'}
          userEmail={user?.email || 'system'}
          onSuccess={(msg) => toast(msg, 'success')}
          onError={(msg) => toast(msg, 'error')}
          leads={leads}
        />
      )}

      {/* ── Phase 28: Keyboard Shortcut Cheat-Sheet ── */}
      {shortcutModalOpen && (
        <ShortcutModal
          isOpen={shortcutModalOpen}
          onClose={() => setShortcutModalOpen(false)}
          currentLanguage={currentLanguage as 'tr' | 'en'}
        />
      )}

      {/* ── Phase 502: Customer Statement Modal ── */}
      {showStmtModal && (
        <CustomerStatementModal
          leadId={showStmtModal}
          onClose={() => setShowStmtModal(null)}
          leads={leads}
          orders={orders}
          currentLanguage={currentLanguage as 'tr' | 'en'}
        />
      )}

      {/* ── Phase 506: Delivery Note Modal ── */}
      {deliveryNoteOrder && (
        <DeliveryNoteModal
          order={deliveryNoteOrder}
          deliveryNoteText={deliveryNoteText}
          setDeliveryNoteText={setDeliveryNoteText}
          onClose={() => { setDeliveryNoteOrder(null); setDeliveryNoteText(''); }}
          onConfirm={async () => {
            const ord = deliveryNoteOrder;
            await handleUpdateOrderStatus(ord.id, 'Delivered');
            if (deliveryNoteText.trim()) {
              await updateDoc(doc(db, 'orders', ord.id), { deliveryNote: deliveryNoteText.trim(), deliveredAt: serverTimestamp() });
            }
            if (selectedOrder?.id === ord.id) setSelectedOrder({ ...selectedOrder, status: 'Delivered' });
            setDeliveryNoteOrder(null);
            setDeliveryNoteText('');
            toast(currentLanguage === 'tr' ? 'Sipariş teslim edildi ✓' : 'Order marked as delivered ✓', 'success');
          }}
          currentLanguage={currentLanguage as 'tr' | 'en'}
        />
      )}

      {/* ── Phase 507: Quick Stock Count Modal ── */}
      {showStockCount && (
        <StockCountModal
          isOpen={showStockCount}
          onClose={() => setShowStockCount(false)}
          currentLanguage={currentLanguage as 'tr' | 'en'}
          inventory={inventory}
          onSuccess={(msg) => toast(msg, 'success')}
          onError={(msg) => toast(msg, 'error')}
        />
      )}

      {/* ── Phase 512: Quick Shipment Modal ── */}
      {showQuickShipment && (
        <QuickShipmentModal
          order={showQuickShipment}
          onClose={() => setShowQuickShipment(null)}
          currentLanguage={currentLanguage as 'tr' | 'en'}
          onSuccess={(msg) => {
            toast(msg, 'success');
            setShowQuickShipment(null);
          }}
        />
      )}

      {/* ── Phase 538: Overdue Payments Slide-in Panel ── */}
      <OverduePanel
        isOpen={showOverduePanel}
        onClose={() => setShowOverduePanel(false)}
        currentLanguage={currentLanguage as 'tr' | 'en'}
        orders={orders}
        onMarkPaid={handleToggleOrderPaid}
      />

      {/* ── Phase 532: Payment Method Picker Modal ── */}
      {p532PayOrder && (
        <PaymentMethodModal
          order={p532PayOrder}
          onClose={() => setP532PayOrder(null)}
          onConfirm={handleConfirmPayment}
          currentLanguage={currentLanguage as 'tr' | 'en'}
        />
      )}

    </div>
  );
}
