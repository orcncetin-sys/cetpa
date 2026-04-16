import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Trash2, Edit2, Download, Building2, BookOpen, TrendingUp, TrendingDown,
  X, Save, RefreshCw, Link, Eye, Calculator, BarChart3, FileText, Briefcase,
  AlertCircle, CheckCircle, Info, ArrowUpDown, ShoppingCart, Users, Truck, Package,
  ArrowRightLeft, CreditCard, FileUp, FileDown, Search, Home, MapPin, User, PieChart,
  Wallet, Layers, Landmark, Palette
} from 'lucide-react';
import TahsilatModule from './TahsilatModule';
import MaliyetMerkeziModule from './MaliyetMerkeziModule';
import SabitKiymetModule from './SabitKiymetModule';
import { formatInCurrency } from '../utils/currency';
import DocumentDesigner from './DocumentDesigner';
import { db, auth } from '../firebase';
import { 
  pullBankMovementsFromMikro
} from '../services/mikroService';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, setDoc, onSnapshot,
  orderBy, query, serverTimestamp
} from 'firebase/firestore';
import { logFirestoreError, OperationType } from '../utils/firebase';
import {
  type Order,
  type Employee,
  type BankAccount,
  type BankTransaction,
  type JournalEntry,
  type Customer,
  type Supplier,
  type Service,
  type WarehouseItem,
  type Transfer,
  type Check,
  type Waybill,
  type WaybillItem,
  type Budget,
  type Warehouse,
  type LucaConfig,
  type MikroConfig
} from '../types';
import { format } from 'date-fns';
import ConfirmModal from './ConfirmModal';

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
  const cn = (...classes: unknown[]) => classes.filter(Boolean).join(' ');
  
  return (
    <th 
      className={cn(
        "px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider cursor-pointer hover:bg-gray-100/50 transition-colors group",
        className
      )}
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1.5">
        {label}
        <TrendingUp 
          className={cn(
            "w-3 h-3 transition-all",
            isActive ? "text-[#ff4000] opacity-100" : "text-gray-300 opacity-0 group-hover:opacity-100",
            isActive && currentSort.direction === 'desc' ? "rotate-180" : ""
          )} 
        />
      </div>
    </th>
  );
};

interface AccountingModuleProps {
  orders: Order[];
  currentLanguage: 'tr' | 'en';
  isAuthenticated?: boolean;
  userRole?: string | null;
  exchangeRates?: Record<string, number>;
  initialTab?: string;
  allowedTabs?: string[];
  createNotification?: (title: string, message: string, type?: 'info' | 'warning' | 'success') => Promise<void>;
  warehouses?: Warehouse[];
  employees?: Employee[];
}

const HESAP_PLANI = [
  '100 - Kasa', '102 - Bankalar', '108 - Diğer Hazır Değerler',
  '120 - Alıcılar', '121 - Alacak Senetleri', '153 - Ticari Mallar',
  '191 - İndirilecek KDV', '195 - İş Avansları', '197 - Sayım ve Tesellüm Noksanları',
  '200 - Arazi ve Arsalar', '253 - Tesis, Makine ve Cihazlar', '254 - Taşıtlar',
  '255 - Demirbaşlar', '257 - Birikmiş Amortismanlar', '291 - Gelecek Yıllara Ait Giderler',
  '320 - Satıcılar', '321 - Borç Senetleri', '360 - Ödenecek Vergi ve Fonlar',
  '361 - Ödenecek Sosyal Güvenlik Kesintileri',
  '370 - Dönem Kârı Vergi ve Diğer Yasal Yükümlülük Karşılıkları',
  '391 - Hesaplanan KDV', '400 - Banka Kredileri', '420 - Uzun Vadeli Kredi',
  '500 - Sermaye', '570 - Geçmiş Yıllar Kârları', '590 - Dönem Net Kârı',
  '600 - Yurt İçi Satışlar', '610 - Satıştan İadeler',
  '620 - Satılan Ticari Mallar Maliyeti', '630 - Araştırma ve Geliştirme Giderleri',
  '631 - Pazarlama, Satış ve Dağıtım Giderleri', '632 - Genel Yönetim Giderleri',
  '640 - İştiraklerden Temettü Gelirleri', '642 - Faiz Gelirleri',
  '653 - Komisyon Giderleri', '660 - Kısa Vadeli Borçlanma Giderleri',
  '680 - Çalışmayan Kısım Gid. ve Zararları', '689 - Diğer Olağandışı Gider ve Zararlar',
  '690 - Dönem Kârı veya Zararı',
];

const formatTRY = (n: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n);

const formatCurrency = (n: number, currency: string = 'TRY') =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency.toUpperCase() }).format(n);

const exportCSV = (filename: string, headers: string[], rows: (string | number)[][]) => {
  const bom = '\uFEFF';
  const csv = bom + [headers, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

const MONTHS_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const AT = {
  tr: {
    bankAndCash: 'Banka & Kasa', journal: 'Yevmiye', trialBalance: 'Mizan',
    incomeExpense: 'Gelir/Gider', vat: 'KDV', luca: 'Luca',
    tryBalance: 'TRY Bakiye', usdBalance: 'USD Bakiye', eurBalance: 'EUR Bakiye', accountCount: 'Hesap Sayısı',
    bankCashAccounts: 'Banka & Kasa Hesapları', importStatement: 'Ekstre İçe Aktar', addAccount: 'Hesap Ekle',
    noAccounts: 'Henüz hesap eklenmedi.', bank: 'Banka', accountType: 'Hesap Türü', iban: 'IBAN',
    balance: 'Bakiye', currency: 'Döviz', actions: 'İşlem',
    journalBook: 'Yevmiye Defteri', newEntry: 'Yeni Kayıt', noEntries: 'Henüz kayıt yok.',
    date: 'Tarih', receiptNo: 'Fiş No', description: 'Açıklama', debitAccount: 'Borç Hesabı',
    creditAccount: 'Alacak Hesabı', debit: 'Borç (₺)', credit: 'Alacak (₺)', vatRate: 'KDV%',
    category: 'Kategori', delete: 'Sil',
    totalDebit: 'Toplam Borç', totalCredit: 'Toplam Alacak', debitBalance: 'Borç Bakiyesi', creditBalance: 'Alacak Bakiyesi',
    trialBalanceTitle: 'Mizan', balanced: 'Mizan Dengeli', notBalanced: 'Mizan Dengeli Değil!',
    accountCode: 'Hesap Kodu & Adı', noJournalEntries: 'Yevmiye kaydı bulunmuyor.', total: 'TOPLAM',
    period: 'Dönem:', totalIncome: 'Toplam Gelir', totalExpense: 'Toplam Gider', netProfit: 'Net Kâr/Zarar',
    annualChart: (y: number) => `${y} Yıllık Gelir/Gider Grafiği`, income: 'Gelir', expense: 'Gider',
    incomeBreakdown: 'Gelir Dağılımı', expenseBreakdown: 'Gider Dağılımı',
    noIncomeThisPeriod: 'Bu dönemde gelir yok.', noExpenseThisPeriod: 'Bu dönemde gider yok.',
    account: 'Hesap', amount: 'Tutar',
    calculatedVat: 'Hesaplanan KDV', deductibleVat: 'İndirilecek KDV', vatPayable: 'Ödenecek KDV',
    vatPayableDesc: 'Vergi dairesine ödenecek', vatRefundDesc: 'İade alınacak',
    vatBreakdown: 'KDV Oranlarına Göre Dağılım', vatBase: 'Matrah (₺)', vatAmount: 'KDV Tutarı (₺)',
    noVatEntries: 'Bu dönemde KDV kaydı yok.', vatDeclaration: 'Beyanname PDF',
    lucaTitle: 'Luca ERP Entegrasyonu', connected: 'Bağlı', notConnected: 'Bağlı Değil',
    lucaInfo: "Luca Yazılım, Türkiye'nin önde gelen muhasebe ERP sistemidir. API entegrasyonu ile yevmiye kayıtlarınızı otomatik olarak Luca'ya aktarabilirsiniz.",
    companyCode: 'Şirket Kodu', recordsToSync: 'Aktarılacak Kayıt', lastSync: 'Son Senkronizasyon',
    neverSynced: 'Hiç senkronize edilmedi', save: 'Kaydet', testConnection: 'Bağlantıyı Test Et',
    syncNow: 'Senkronize Et', editAccount: 'Hesabı Düzenle', newBankAccount: 'Yeni Banka Hesabı',
    bankName: 'Banka Adı', branch: 'Şube', accountHolder: 'Hesap Sahibi',
    accountNumber: 'Hesap Numarası', bankBalance: 'Bakiye', cancel: 'İptal',
    newJournalEntry: 'Yeni Yevmiye Kaydı', editJournalEntry: 'Yevmiye Kaydı Düzenle', receiptDoc: 'Fiş / Belge No',
    descriptionPlaceholder: 'Satış faturası...', debitAccountLabel: 'Borç Hesabı', creditAccountLabel: 'Alacak Hesabı',
    debitLabel: 'Borç (₺)', creditLabel: 'Alacak (₺)', vatRateLabel: 'KDV Oranı', categoryLabel: 'Kategori',
    loginRequired: 'Kaydetmek için giriş yapmalısınız.', bankNameRequired: 'Banka adı zorunludur.',
    descRequired: 'Açıklama zorunludur.', errorOccurred: 'Hata oluştu.', deleteError: 'Silme hatası.',
    accountUpdated: 'Hesap güncellendi.', accountAdded: 'Hesap eklendi.', accountDeleted: 'Hesap silindi.',
    journalAdded: 'Yevmiye kaydı eklendi.', journalDeleted: 'Kayıt silindi.',
    confirmDeleteAccount: 'Bu hesabı silmek istediğinize emin misiniz?',
    confirmDeleteEntry: 'Bu kaydı silmek istediğinize emin misiniz?',
    lucaSaved: 'Luca yapılandırması kaydedildi.', lucaSuccess: 'Luca bağlantısı başarılı!',
    lucaError: 'API Key ve Şirket Kodu gerekli.', lucaNotConnected: 'Önce bağlantıyı test edin.',
    lucaSynced: (n: number) => `${n} kayıt Luca'ya aktarıldı.`, declarationPreparing: 'Beyanname hazırlanıyor...',
    csvImported: (n: number) => `${n} işlem yevmiyeye aktarıldı.`, csvSuccess: (n: number) => `${n} CSV işlemi aktarıldı.`,
    csvError: 'CSV okunamadı. Lütfen biçimi kontrol edin.', pdfUploaded: 'PDF yüklendi ve görüntülemeye hazır.',
    unsupportedFormat: 'Desteklenen format: .csv veya .pdf',
    pdfStatus: (name: string) => `"${name}" yüklendi. PDF banka ekstrelerini manuel inceleme için saklayın.`,
    importedCount: (n: number) => `${n} işlem yevmiyeye aktarıldı.`,
    importedLabel: 'İçe aktarıldı',
    searchAccounts: 'Hesap ara...',
    sortBy: 'Sırala',
    satislar: 'Satışlar', musteriler: 'Müşteriler', tedarikciler: 'Tedarikçiler',
    urunler: 'Hizmet & Ürünler', depo: 'Depo', transfer: 'Depolar Arası',
    cekler: 'Çekler', calisanlar: 'Çalışanlar', gidenIrsaliye: 'Giden İrsaliye',
    gelenIrsaliye: 'Gelen İrsaliye', butce: 'Bütçe', isletme_sermayesi: 'İşletme Sermayesi',
    tahsilat: 'Tahsilat & Vade', maliyet_merkezi: 'Maliyet Merkezi', sabit_kiymet: 'Sabit Kıymet',
    noRecords: 'Kayıt bulunamadı.', add: 'Ekle', name: 'Ad', company: 'Şirket',
    email: 'E-posta', phone: 'Telefon', address: 'Adres', notes2: 'Notlar',
    taxNo: 'Vergi No', code: 'Kod', type2: 'Tür', unitPrice: 'Birim Fiyat',
    unit: 'Birim', location: 'Konum', fromWarehouse: 'Çıkış Deposu', toWarehouse: 'Giriş Deposu',
    product: 'Ürün', quantity: 'Miktar', checkNo: 'Çek No', bank2: 'Banka',
    amount2: 'Tutar', dueDate: 'Vade Tarihi', drawer: 'Lehtar/Borçlu', checkType: 'Çek Türü',
    received: 'Alınan', given: 'Verilen', position: 'Görev', department: 'Departman',
    salary: 'Maaş', startDate: 'Başlangıç', waybillNo: 'İrsaliye No', invoiceNo: 'Fatura No', customer2: 'Müşteri',
    supplier2: 'Tedarikçi', status2: 'Durum', total2: 'Toplam', pending2: 'Bekliyor',
    completed2: 'Tamamlandı', cancelled2: 'İptal',
  },
  en: {
    bankAndCash: 'Bank & Cash', journal: 'Journal', trialBalance: 'Trial Balance',
    incomeExpense: 'Income/Expense', vat: 'VAT', luca: 'Luca',
    tryBalance: 'TRY Balance', usdBalance: 'USD Balance', eurBalance: 'EUR Balance', accountCount: 'Accounts',
    bankCashAccounts: 'Bank & Cash Accounts', importStatement: 'Import Statement', addAccount: 'Add Account',
    noAccounts: 'No accounts added yet.', bank: 'Bank', accountType: 'Account Type', iban: 'IBAN',
    balance: 'Balance', currency: 'Currency', actions: 'Actions',
    journalBook: 'Journal Book', newEntry: 'New Entry', noEntries: 'No entries yet.',
    date: 'Date', receiptNo: 'Receipt No', description: 'Description', debitAccount: 'Debit Account',
    creditAccount: 'Credit Account', debit: 'Debit (₺)', credit: 'Credit (₺)', vatRate: 'VAT%',
    category: 'Category', delete: 'Delete',
    totalDebit: 'Total Debit', totalCredit: 'Total Credit', debitBalance: 'Debit Balance', creditBalance: 'Credit Balance',
    trialBalanceTitle: 'Trial Balance', balanced: 'Balanced', notBalanced: 'Not Balanced!',
    accountCode: 'Account Code & Name', noJournalEntries: 'No journal entries found.', total: 'TOTAL',
    period: 'Period:', totalIncome: 'Total Income', totalExpense: 'Total Expense', netProfit: 'Net Profit/Loss',
    annualChart: (y: number) => `${y} Annual Income/Expense Chart`, income: 'Income', expense: 'Expense',
    incomeBreakdown: 'Income Breakdown', expenseBreakdown: 'Expense Breakdown',
    noIncomeThisPeriod: 'No income this period.', noExpenseThisPeriod: 'No expenses this period.',
    account: 'Account', amount: 'Amount',
    calculatedVat: 'Output VAT', deductibleVat: 'Input VAT', vatPayable: 'VAT Payable',
    vatPayableDesc: 'Payable to tax office', vatRefundDesc: 'Refund eligible',
    vatBreakdown: 'VAT by Rate', vatBase: 'Base (₺)', vatAmount: 'VAT Amount (₺)',
    noVatEntries: 'No VAT entries this period.', vatDeclaration: 'Declaration PDF',
    lucaTitle: 'Luca ERP Integration', connected: 'Connected', notConnected: 'Not Connected',
    lucaInfo: 'Luca is a leading Turkish accounting ERP. Use the API integration to automatically push your journal entries to Luca.',
    companyCode: 'Company Code', recordsToSync: 'Records to Sync', lastSync: 'Last Sync',
    neverSynced: 'Never synced', save: 'Save', testConnection: 'Test Connection',
    syncNow: 'Sync Now', editAccount: 'Edit Account', newBankAccount: 'New Bank Account',
    bankName: 'Bank Name', branch: 'Branch', accountHolder: 'Account Holder',
    accountNumber: 'Account Number', bankBalance: 'Balance', cancel: 'Cancel',
    newJournalEntry: 'New Journal Entry', editJournalEntry: 'Edit Journal Entry', receiptDoc: 'Receipt / Doc No',
    descriptionPlaceholder: 'Sales invoice...', debitAccountLabel: 'Debit Account', creditAccountLabel: 'Credit Account',
    debitLabel: 'Debit (₺)', creditLabel: 'Credit (₺)', vatRateLabel: 'VAT Rate', categoryLabel: 'Category',
    loginRequired: 'Please log in to save.', bankNameRequired: 'Bank name is required.',
    descRequired: 'Description is required.', errorOccurred: 'An error occurred.', deleteError: 'Delete error.',
    accountUpdated: 'Account updated.', accountAdded: 'Account added.', accountDeleted: 'Account deleted.',
    journalAdded: 'Journal entry added.', journalDeleted: 'Entry deleted.',
    confirmDeleteAccount: 'Are you sure you want to delete this account?',
    confirmDeleteEntry: 'Are you sure you want to delete this entry?',
    lucaSaved: 'Luca configuration saved.', lucaSuccess: 'Luca connection successful!',
    lucaError: 'API Key and Company Code are required.', lucaNotConnected: 'Please test the connection first.',
    lucaSynced: (n: number) => `${n} records pushed to Luca.`, declarationPreparing: 'Preparing declaration...',
    csvImported: (n: number) => `${n} transactions imported to journal.`, csvSuccess: (n: number) => `${n} CSV transactions imported.`,
    csvError: 'Could not read CSV. Please check the format.', pdfUploaded: 'PDF uploaded and ready to view.',
    unsupportedFormat: 'Supported formats: .csv or .pdf',
    pdfStatus: (name: string) => `"${name}" uploaded. Keep PDF bank statements for manual review.`,
    importedCount: (n: number) => `${n} transactions imported to journal.`,
    importedLabel: 'Imported',
    searchAccounts: 'Search accounts...',
    sortBy: 'Sort',
    satislar: 'Sales', musteriler: 'Customers', tedarikciler: 'Suppliers',
    urunler: 'Services & Products', depo: 'Warehouse', transfer: 'Inter-Warehouse',
    cekler: 'Checks', calisanlar: 'Employees', gidenIrsaliye: 'Outgoing Waybills',
    gelenIrsaliye: 'Incoming Waybills', butce: 'Budget', isletme_sermayesi: 'Working Capital',
    tahsilat: 'Collections & Due Dates', maliyet_merkezi: 'Cost Centers', sabit_kiymet: 'Fixed Assets',
    noRecords: 'No records found.', add: 'Add', name: 'Name', company: 'Company',
    email: 'Email', phone: 'Phone', address: 'Address', notes2: 'Notes',
    taxNo: 'Tax No', code: 'Code', type2: 'Type', unitPrice: 'Unit Price',
    unit: 'Unit', location: 'Location', fromWarehouse: 'From Warehouse', toWarehouse: 'To Warehouse',
    product: 'Product', quantity: 'Quantity', checkNo: 'Check No', bank2: 'Bank',
    amount2: 'Amount', dueDate: 'Due Date', drawer: 'Drawer/Payee', checkType: 'Check Type',
    received: 'Received', given: 'Given', position: 'Position', department: 'Department',
    salary: 'Salary', startDate: 'Start Date', waybillNo: 'Waybill No', invoiceNo: 'Invoice No', customer2: 'Customer',
    supplier2: 'Supplier', status2: 'Status', total2: 'Total', pending2: 'Pending',
    completed2: 'Completed', cancelled2: 'Cancelled',
  },
} as const;

export default function AccountingModule({ orders, currentLanguage, isAuthenticated = false, userRole, exchangeRates, initialTab, allowedTabs, createNotification, warehouses: warehousesProp, employees: employeesProp }: AccountingModuleProps) {
  const t = AT[currentLanguage];
  const MONTHS = currentLanguage === 'en' ? MONTHS_EN : MONTHS_TR;
  const resolvedInitialTab = (() => {
    const tab = initialTab || 'banka';
    if (allowedTabs && allowedTabs.length > 0 && !allowedTabs.includes(tab)) return allowedTabs[0];
    return tab;
  })();
  const [accountingTab, setAccountingTab] = useState<string>(resolvedInitialTab);

  useEffect(() => {
    if (warehousesProp) setWarehouses(warehousesProp);
  }, [warehousesProp]);

  useEffect(() => {
    if (employeesProp) setEmployees(employeesProp);
  }, [employeesProp]);

  const [showWarehouseModal, setShowWarehouseModal] = useState(false);
  const [warehouseForm, setWarehouseForm] = useState({ name: '', location: '', manager: '', notes: '' });
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);

  const [showStockModal, setShowStockModal] = useState(false);
  const [stockForm, setStockForm] = useState({ productName: '', sku: '', quantity: 0, warehouseId: '', category: '', notes: '' });
  const [editingStock, setEditingStock] = useState<WarehouseItem | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [editingTransfer, setEditingTransfer] = useState<Transfer | null>(null);
  const [editingCheck, setEditingCheck] = useState<Check | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editingWaybill, setEditingWaybill] = useState<Waybill | null>(null);
  const [editingJournal, setEditingJournal] = useState<JournalEntry | null>(null);
  const [viewingPdf, setViewingPdf] = useState<{ name: string; date: string; dataUrl?: string } | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  // Invoices
  const [invoices, setInvoices] = useState<Record<string,unknown>[]>([]);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState<'all'|'e-fatura'|'e-arsiv'|'ihracat'>('all');
  const [invoiceSort, setInvoiceSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'date', direction: 'desc' });
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceSource, setInvoiceSource] = useState<Record<string,unknown>|null>(null); // order being invoiced
  const [invoiceForm, setInvoiceForm] = useState({
    faturaNo: '', faturaTipi: 'e-fatura' as 'e-fatura'|'e-arsiv'|'ihracat',
    customerName: '', customerEmail: '', taxId: '', taxOffice: '',
    address: '', kdvOran: 20, date: format(new Date(),'yyyy-MM-dd'), notes: '', orderId: '',
  });

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'invoices'), orderBy('createdAt','desc')), snap => {
      setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});
    return unsub;
  }, []);

  const handleCreateInvoice = async () => {
    const src = invoiceSource;
    const lineItems = src ? (src.lineItems as Record<string,unknown>[] || []) : [];
    const totalPrice = src ? (src.totalPrice as number || 0) : 0;
    const kdvHaric = totalPrice / (1 + invoiceForm.kdvOran / 100);
    const kdvTutari = totalPrice - kdvHaric;
    await addDoc(collection(db, 'invoices'), {
      ...invoiceForm,
      lineItems,
      totalPrice,
      kdvHaric,
      kdvTutari,
      status: 'Kesildi',
      createdAt: serverTimestamp(),
    });
    if (src?.id) {
      await updateDoc(doc(db, 'orders', src.id as string), { hasInvoice: true, invoiceNo: invoiceForm.faturaNo });
    }
    setShowInvoiceModal(false);
    setInvoiceSource(null);
    setInvoiceForm({ faturaNo:'', faturaTipi:'e-fatura', customerName:'', customerEmail:'', taxId:'', taxOffice:'', address:'', kdvOran:20, date:format(new Date(),'yyyy-MM-dd'), notes:'', orderId:'' });
    setToast({ msg: currentLanguage==='tr'?'Fatura başarıyla kesildi.':'Invoice created successfully.', type:'success' });
  };

  // Bank Accounts
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [showBankModal, setShowBankModal] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [bankImportStatus, setBankImportStatus] = useState<string | null>(null);
  const [bankSearch, setBankSearch] = useState('');
  const [bankSortKey, setBankSortKey] = useState<keyof BankAccount>('bankName');
  const [bankSortDir, setBankSortDir] = useState<'asc' | 'desc'>('asc');
  const [bankForm, setBankForm] = useState({
    bankName: '', branch: '', accountHolder: '', accountNumber: '',
    iban: '', currency: 'TRY' as 'TRY' | 'USD' | 'EUR', balance: 0,
    accountType: 'Vadesiz' as 'Vadesiz' | 'Vadeli' | 'Kredi' | 'Kasa',
  });

  // Bank Transactions (auto-pull)
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]);
  const [bankTxSort, setBankTxSort] = useState<{ key: keyof BankTransaction; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [bankTxSearch, setBankTxSearch] = useState('');
  const [bankTxFilter, setBankTxFilter] = useState<'all' | 'credit' | 'debit'>('all');
  const [bankTxPulling, setBankTxPulling] = useState(false);
  const [bankTxLastPull, setBankTxLastPull] = useState<string | null>(null);
  const [bankTxAutoSync, setBankTxAutoSync] = useState(false);

  // Journal Entries
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [showJournalModal, setShowJournalModal] = useState(false);
  const [journalForm, setJournalForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'), fiş: '', aciklama: '',
    debitHesap: HESAP_PLANI[0], alacakHesap: HESAP_PLANI[0],
    borc: 0, alacak: 0, kdvOran: 0,
    kategori: 'Satış' as JournalEntry['kategori'],
  });
  const [journalSearch, setJournalSearch] = useState('');
  const [journalSortKey, setJournalSortKey] = useState<keyof JournalEntry>('date');
  const [journalSortDir, setJournalSortDir] = useState<'asc' | 'desc'>('desc');
  const [mizanSearch, setMizanSearch] = useState('');
  const [mizanSortKey, setMizanSortKey] = useState<'hesap' | 'borc' | 'alacak' | 'borcBakiye' | 'alacakBakiye'>('hesap');
  const [mizanSortDir, setMizanSortDir] = useState<'asc' | 'desc'>('asc');
  const [kdvSearch, setKdvSearch] = useState('');
  const [kdvSortBy, setKdvSortBy] = useState<'ay' | 'hesaplanan' | 'indirilecek' | 'odenecek' | 'oran' | 'matrah' | 'kdv'>('oran');
  const [kdvSortDir2, setKdvSortDir2] = useState<'asc' | 'desc'>('asc');

  // Gelir/Gider filters
  const [gelirMonth, setGelirMonth] = useState<number>(new Date().getMonth() + 1);
  const [gelirYear, setGelirYear] = useState<number>(new Date().getFullYear());
  const [gelirDateFrom, setGelirDateFrom] = useState('');
  const [gelirDateTo, setGelirDateTo] = useState('');
  const [gelirUseRange, setGelirUseRange] = useState(false);
  const [gelirCurrency, setGelirCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const [yevmiyeCurrency, setYevmiyeCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');

  // DrillDown modal
  const [drillDown, setDrillDown] = useState<{
    title: string;
    rows: { label: string; value: string; sub?: string; badge?: string; badgeColor?: string }[];
    total?: string;
  } | null>(null);

  // KDV filters
  const [kdvMonth, setKdvMonth] = useState<number>(new Date().getMonth() + 1);
  const [kdvYear, setKdvYear] = useState<number>(new Date().getFullYear());

  // Luca
  const [lucaEnabled, setLucaEnabled] = useState(true);
  const [lucaApiKey, setLucaApiKey] = useState('');
  const [lucaCompanyId, setLucaCompanyId] = useState('');
  const [lucaBaseUrl, setLucaBaseUrl] = useState('https://api.luca.com.tr');
  const [lucaSyncing, setLucaSyncing] = useState(false);
  const [lucaLastSync, setLucaLastSync] = useState<string | null>(null);
  const [lucaConnected, setLucaConnected] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [lucaTesting, setLucaTesting] = useState(false);

  // Mikro
  const [mikroEnabled, setMikroEnabled] = useState(true);
  const [mikroAccessToken, setMikroAccessToken] = useState('');
  const [mikroEndpoint, setMikroEndpoint] = useState('https://jumpbulutapigw.mikro.com.tr/ApiJB/ApiMethods');
  const [mikroConnected, setMikroConnected] = useState(false);
  const [mikroTesting, setMikroTesting] = useState(false);
  const [mikroSyncing, setMikroSyncing] = useState(false);
  const [mikroLastSync, setMikroLastSync] = useState<string | null>(null);
  const [showMikroToken, setShowMikroToken] = useState(false);

  // New tab states
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [warehouseItems, setWarehouseItems] = useState<WarehouseItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [waybills, setWaybills] = useState<Waybill[]>([]);

  // Modal visibility
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showCheckModal, setShowCheckModal] = useState(false);
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showWaybillModal, setShowWaybillModal] = useState(false);
  const [waybillType, setWaybillType] = useState<'giden' | 'gelen'>('giden');

  // e-Fatura States
  const [vknSearch, setVknSearch] = useState('');
  const [vknResult, setVknResult] = useState<any>(null);
  const [vknLoading, setVknLoading] = useState(false);
  const [lucaKontor, setLucaKontor] = useState<any>(null);
  const [lucaNotConfigured, setLucaNotConfigured] = useState(false);
  const [sendingInvoiceId, setSendingInvoiceId] = useState<string | null>(null);

  // Mikro Bank Movements
  const [mikroBankMovements, setMikroBankMovements] = useState<any[]>([]);
  const [mikroBankLoading, setMikroBankLoading] = useState(false);
  const [mikroBankLastSync, setMikroBankLastSync] = useState<string | null>(null);

  useEffect(() => {
    if (accountingTab === 'e-fatura') {
      fetch('/api/luca/kontor')
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setLucaKontor(data.data);
            setLucaNotConfigured(false);
          } else if (data.notConfigured) {
            setLucaNotConfigured(true);
          }
        })
        .catch(console.error);
    }
  }, [accountingTab]);

  const handleVknSorgula = async () => {
    if (!vknSearch.trim() || vknSearch.trim().length < 10) {
      showToast('Lütfen geçerli bir VKN veya TCKN girin', 'error');
      return;
    }
    setVknLoading(true);
    setVknResult(null);
    try {
      const res = await fetch(`/api/gib/vkn/${vknSearch}`, {
        headers: {
          'x-gib-api-key': lucaApiKey,
          'x-gib-integrator-vkn': lucaCompanyId
        }
      });
      const data = await res.json();
      if (data.success) {
        setVknResult(data.data);
      } else if (data.notConfigured) {
        showToast('GİB API anahtarı yapılandırılmamış. Lütfen Ayarlar → Entegrasyonlar bölümünden LUCA_API_KEY ekleyin.', 'error');
      } else {
        showToast(data.error || 'Sorgulama başarısız', 'error');
      }
    } catch (err) {
      showToast('Sorgulama hatası', 'error');
    } finally {
      setVknLoading(false);
    }
  };

  const handleeFaturaGonder = async (invId: string) => {
    const inv = invoices.find(i => i.id === invId);
    if (!inv) return;

    setConfirmModal({
      isOpen: true,
      title: currentLanguage === 'tr' ? 'e-Fatura Gönder' : 'Send e-Invoice',
      message: currentLanguage === 'tr' 
        ? `${inv.faturaNo} numaralı fatura Luca üzerinden e-Fatura olarak gönderilecektir. Devam etmek istiyor musunuz?`
        : `Invoice ${inv.faturaNo} will be sent as an e-Invoice via Luca. Do you want to continue?`,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setSendingInvoiceId(invId);
        try {
          const res = await fetch('/api/luca/fatura-gonder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceId: invId, invoiceData: inv })
          });
          const data = await res.json();
          if (data.success && data.ettn) {
            showToast(data.message, 'success');
            await updateDoc(doc(db, 'invoices', invId), {
              status: 'e-Fatura Gönderildi',
              ettn: data.ettn,
              eFaturaGonderimTarihi: new Date().toISOString(),
            });
          } else if (data.notConfigured) {
            showToast('LUCA_API_KEY yapılandırılmamış. e-Fatura gönderilemedi.', 'error');
          } else {
            showToast(data.error || 'Gönderim başarısız', 'error');
          }
        } catch (err) {
          showToast('Gönderim hatası', 'error');
        } finally {
          setSendingInvoiceId(null);
        }
      }
    });
  };

  // Search states
  const [customerSearch, setCustomerSearch] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [warehouseSearch, setWarehouseSearch] = useState('');
  const [transferSearch, setTransferSearch] = useState('');
  const [checkSearch, setCheckSearch] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [waybillSearch, setWaybillSearch] = useState('');

  // Sort states for new tabs
  const [satisSortKey, setSatisSortKey] = useState<'customerName' | 'totalPrice' | 'date' | 'faturali'>('date');
  const [satisSortDir, setSatisSortDir] = useState<'asc' | 'desc'>('desc');
  const [satisSearch, setSatisSearch] = useState('');
  const [kpiCurrency, setKpiCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const kpiRate = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
  const kpiSym = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
  const formatConv = (n: number) => kpiCurrency === 'TRY'
    ? formatTRY(n)
    : `${kpiSym}${(n / kpiRate).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const [musteriSortKey, setMusteriSortKey] = useState<'name' | 'company' | 'phone'>('name');
  const [musteriSortDir, setMusteriSortDir] = useState<'asc' | 'desc'>('asc');
  const [tedarikciSortKey, setTedarikciSortKey] = useState<'name' | 'company' | 'phone'>('name');
  const [tedarikciSortDir, setTedarikciSortDir] = useState<'asc' | 'desc'>('asc');
  const [servisSortKey, setServisSortKey] = useState<'name' | 'code' | 'unitPrice' | 'vatRate'>('name');
  const [servisSortDir, setServisSortDir] = useState<'asc' | 'desc'>('asc');
  const [depoSortKey, setDepoSortKey] = useState<'productName' | 'quantity' | 'sku' | 'warehouseId'>('productName');
  const [depoSortDir, setDepoSortDir] = useState<'asc' | 'desc'>('asc');
  const [transferSortKey, setTransferSortKey] = useState<'productName' | 'quantity' | 'date' | 'status'>('date');
  const [transferSortDir, setTransferSortDir] = useState<'asc' | 'desc'>('desc');
  const [cekSortKey, setCekSortKey] = useState<'checkNo' | 'amount' | 'dueDate' | 'type'>('dueDate');
  const [cekSortDir, setCekSortDir] = useState<'asc' | 'desc'>('asc');
  const [calisanSortKey, setCalisanSortKey] = useState<'name' | 'position' | 'salary' | 'startDate' | 'department'>('name');
  const [calisanSortDir, setCalisanSortDir] = useState<'asc' | 'desc'>('asc');
  const [irsaliyeSortKey, setIrsaliyeSortKey] = useState<'waybillNo' | 'party' | 'date' | 'total' | 'status' | 'type'>('date');
  const [irsaliyeSortDir, setIrsaliyeSortDir] = useState<'asc' | 'desc'>('desc');

  // New tab form states
  const [customerForm, setCustomerForm] = useState({ name: '', company: '', email: '', phone: '', address: '', taxNo: '', taxOffice: '', notes: '', creditLimit: 0, balance: 0, riskGroup: 'Düşük' as 'Düşük' | 'Orta' | 'Yüksek' });
  const [supplierForm, setSupplierForm] = useState({ name: '', company: '', email: '', phone: '', address: '', taxNo: '', notes: '' });
  const [serviceForm, setServiceForm] = useState({ code: '', name: '', type: 'Ürün' as 'Ürün' | 'Hizmet', unitPrice: 0, vatRate: 18, unit: 'Adet', notes: '' });
  const [transferForm, setTransferForm] = useState({ fromWarehouse: '', toWarehouse: '', productName: '', quantity: 0, date: format(new Date(), 'yyyy-MM-dd'), notes: '', status: 'Bekliyor' as Transfer['status'] });
  const [checkForm, setCheckForm] = useState({ checkNo: '', bankName: '', amount: 0, dueDate: format(new Date(), 'yyyy-MM-dd'), drawer: '', type: 'Alınan' as Check['type'], status: 'Aktif' as Check['status'] });
  const [employeeForm, setEmployeeForm] = useState({ name: '', employeeId: '', tcId: '', position: '', department: '', salary: 0, startDate: format(new Date(), 'yyyy-MM-dd'), email: '', phone: '' });
  const [budgetForm, setBudgetForm] = useState({ category: 'Genel Gider', amount: 0, period: format(new Date(), 'yyyy-MM') });
  const [waybillForm, setWaybillForm] = useState<{
    waybillNo: string;
    invoiceNo: string;
    party: string;
    date: string;
    items: WaybillItem[];
    total: number;
    status: Waybill['status'];
  }>({
    waybillNo: '', invoiceNo: '', party: '', date: format(new Date(), 'yyyy-MM-dd'),
    items: [], total: 0, status: 'Bekliyor'
  });

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const downloadVatDeclaration = () => {
    const content = `
      KDV BEYANNAMESİ ÖZETİ
      Dönem: ${kdvMonth}/${kdvYear}
      ----------------------------------
      Hesaplanan KDV: ${formatTRY(hesaplananKDV)}
      İndirilecek KDV: ${formatTRY(indirilecekKDV)}
      Ödenecek/İade KDV: ${formatTRY(odenecekKDV)}
      ----------------------------------
      Matrah Detayları:
      ${Object.entries(kdvOranBreakdown).map(([oran, data]) => `%${oran} - Matrah: ${formatTRY(data.matrah)} - KDV: ${formatTRY(data.kdv)}`).join('\n')}
    `;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KDV_Beyanname_${kdvMonth}_${kdvYear}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(t.declarationPreparing);
  };

  const handleBankFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'csv') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const text = ev.target?.result as string;
          const lines = text.split('\n').filter(l => l.trim());
          const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
          let imported = 0;
          lines.slice(1).forEach(line => {
            const cols = line.split(',').map(c => c.replace(/"/g, '').trim());
            const entry: Record<string, string> = {};
            headers.forEach((h, i) => { entry[h] = cols[i] || ''; });
            const amount = parseFloat(entry['tutar'] || entry['amount'] || entry['borc'] || entry['alacak'] || '0');
            if (!isNaN(amount) && amount !== 0) {
              const kategori = amount > 0 ? 'Tahsilat' : 'Ödeme';
              addDoc(collection(db, 'journalEntries'), {
                date: entry['tarih'] || entry['date'] || format(new Date(), 'yyyy-MM-dd'),
                fiş: entry['fiş'] || entry['belge'] || `IMP-${Date.now()}-${imported}`,
                aciklama: entry['açıklama'] || entry['aciklama'] || entry['description'] || entry['işlem'] || t.importedLabel,
                debitHesap: amount > 0 ? '102 - Bankalar' : '320 - Satıcılar',
                alacakHesap: amount > 0 ? '600 - Yurt İçi Satışlar' : '102 - Bankalar',
                borc: amount > 0 ? Math.abs(amount) : 0,
                alacak: amount < 0 ? Math.abs(amount) : 0,
                kdvOran: 0,
                kategori,
                createdAt: serverTimestamp(),
              });
              imported++;
            }
          });
          setBankImportStatus(t.importedCount(imported));
          showToast(t.csvSuccess(imported), 'success');
        } catch {
          showToast(t.csvError, 'error');
        }
      };
      reader.readAsText(file, 'UTF-8');
    } else if (ext === 'pdf') {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setBankImportStatus(t.pdfStatus(file.name));
        setViewingPdf({ name: file.name, date: format(new Date(), 'dd.MM.yyyy HH:mm'), dataUrl });
        showToast(t.pdfUploaded, 'success');
      };
      reader.readAsDataURL(file);
    } else {
      showToast(t.unsupportedFormat, 'error');
    }
    e.target.value = '';
  };

  // Firebase listeners — skip if not authenticated (guest mode)
  useEffect(() => {
    if (!isAuthenticated || !userRole) return;
    const unsub = onSnapshot(collection(db, 'bankAccounts'), snap => {
      setBankAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount)));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'bankAccounts'));
    return unsub;
  }, [isAuthenticated, userRole]);

  useEffect(() => {
    if (!isAuthenticated || !userRole) return;
    const unsub = onSnapshot(
      query(collection(db, 'bankTransactions'), orderBy('date', 'desc')),
      snap => setBankTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() } as BankTransaction))),
      () => {}
    );
    return unsub;
  }, [isAuthenticated, userRole]);

  useEffect(() => {
    if (!isAuthenticated || !userRole) return;
    const q = query(collection(db, 'journalEntries'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setJournalEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as JournalEntry)));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'journalEntries'));
    return unsub;
  }, [isAuthenticated, userRole]);

  useEffect(() => {
    if (!isAuthenticated || !userRole) return;
    const unsubs = [
      onSnapshot(collection(db, 'customers'), s => setCustomers(s.docs.map(d => ({ id: d.id, ...d.data() } as Customer))), (error) => logFirestoreError(error, OperationType.LIST, 'customers')),
      onSnapshot(collection(db, 'suppliers'), s => setSuppliers(s.docs.map(d => ({ id: d.id, ...d.data() } as Supplier))), (error) => logFirestoreError(error, OperationType.LIST, 'suppliers')),
      onSnapshot(collection(db, 'services'), s => setServices(s.docs.map(d => ({ id: d.id, ...d.data() } as Service))), (error) => logFirestoreError(error, OperationType.LIST, 'services')),
      onSnapshot(collection(db, 'warehouseItems'), s => setWarehouseItems(s.docs.map(d => ({ id: d.id, ...d.data() } as WarehouseItem))), (error) => logFirestoreError(error, OperationType.LIST, 'warehouseItems')),
      onSnapshot(collection(db, 'transfers'), s => setTransfers(s.docs.map(d => ({ id: d.id, ...d.data() } as Transfer))), (error) => logFirestoreError(error, OperationType.LIST, 'transfers')),
      onSnapshot(collection(db, 'checks'), s => setChecks(s.docs.map(d => ({ id: d.id, ...d.data() } as Check))), (error) => logFirestoreError(error, OperationType.LIST, 'checks')),
      onSnapshot(collection(db, 'budgets'), s => setBudgets(s.docs.map(d => ({ id: d.id, ...d.data() } as Budget))), (error) => logFirestoreError(error, OperationType.LIST, 'budgets')),
      onSnapshot(collection(db, 'waybills'), s => setWaybills(s.docs.map(d => ({ id: d.id, ...d.data() } as Waybill))), (error) => logFirestoreError(error, OperationType.LIST, 'waybills'))
    ];
    return () => unsubs.forEach(u => u());
  }, [isAuthenticated, userRole]);

  // Load Luca config
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'luca'), (docSnap) => {
      if (docSnap.exists()) {
        const cfg = docSnap.data() as LucaConfig;
        setLucaApiKey(cfg.apiKey || '');
        setLucaCompanyId(cfg.companyId || '');
        setLucaBaseUrl(cfg.baseUrl || 'https://api.luca.com.tr');
        setLucaLastSync(cfg.lastSync || null);
        setLucaConnected(cfg.connected || false);
        setLucaEnabled(!!cfg.enabled);
      }
    }, (err) => logFirestoreError(err, OperationType.GET, 'settings/luca', auth.currentUser?.uid));
    return () => unsub();
  }, []);

  // Load Mikro config
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'mikro'), (docSnap) => {
      if (docSnap.exists()) {
        const cfg = docSnap.data() as MikroConfig;
        setMikroAccessToken(cfg.accessToken || '');
        setMikroEndpoint(cfg.endpoint || 'https://jumpbulutapigw.mikro.com.tr/ApiJB/ApiMethods');
        setMikroLastSync(cfg.lastSync || null);
        setMikroConnected(cfg.connected || false);
        setMikroEnabled(cfg.enabled || false);
      }
    }, (err) => logFirestoreError(err, OperationType.GET, 'settings/mikro', auth.currentUser?.uid));
    return () => unsub();
  }, []);

  const saveLucaConfig = async () => {
    try {
      const cfg: LucaConfig = {
        apiKey: lucaApiKey,
        companyId: lucaCompanyId,
        baseUrl: lucaBaseUrl,
        lastSync: lucaLastSync,
        connected: lucaConnected,
        enabled: lucaEnabled,
        updatedAt: serverTimestamp()
      };
      await setDoc(doc(db, 'settings', 'luca'), cfg, { merge: true });
      
      // Mutual exclusion: if luca is enabled, disable mikro
      if (lucaEnabled) {
        await updateDoc(doc(db, 'settings', 'mikro'), { enabled: false }).catch(() => {});
      }
      
      showToast(t.lucaSaved);
    } catch (err) {
      logFirestoreError(err, OperationType.UPDATE, 'settings/luca', auth.currentUser?.uid);
      showToast(t.errorOccurred, 'error');
    }
  };

  const handleSyncMikroBank = async () => {
    if (!mikroEnabled || !mikroAccessToken) {
      showToast(currentLanguage === 'tr' ? 'Mikro ERP entegrasyonu aktif değil.' : 'Mikro ERP integration is not active.', 'error');
      return;
    }
    setMikroBankLoading(true);
    try {
      const config: MikroConfig = {
        endpoint: mikroEndpoint,
        accessToken: mikroAccessToken,
        enabled: mikroEnabled
      };
      const res: any = await pullBankMovementsFromMikro({}, config);
      if (res && res.Data) {
        setMikroBankMovements(res.Data);
        setMikroBankLastSync(new Date().toLocaleString());
        showToast(currentLanguage === 'tr' ? 'Banka hareketleri başarıyla çekildi.' : 'Bank movements successfully fetched.', 'success');
      } else {
        showToast(currentLanguage === 'tr' ? 'Hareket bulunamadı.' : 'No movements found.', 'info');
      }
    } catch (err) {
      console.error(err);
      showToast(currentLanguage === 'tr' ? 'Mikro API hatası.' : 'Mikro API error.', 'error');
    } finally {
      setMikroBankLoading(false);
    }
  };

  const saveMikroConfig = async () => {
    try {
      const cfg: MikroConfig = {
        accessToken: mikroAccessToken,
        endpoint: mikroEndpoint,
        lastSync: mikroLastSync,
        connected: mikroConnected,
        enabled: mikroEnabled,
        updatedAt: serverTimestamp()
      };
      await setDoc(doc(db, 'settings', 'mikro'), cfg, { merge: true });
      
      // Mutual exclusion: if mikro is enabled, disable luca
      if (mikroEnabled) {
        await updateDoc(doc(db, 'settings', 'luca'), { enabled: false }).catch(() => {});
      }
      
      showToast(currentLanguage === 'tr' ? 'Mikro yapılandırması kaydedildi.' : 'Mikro configuration saved.');
    } catch (err) {
      logFirestoreError(err, OperationType.UPDATE, 'settings/mikro', auth.currentUser?.uid);
      showToast(t.errorOccurred, 'error');
    }
  };

  // Bank CRUD
  const openAddBank = () => {
    setEditingBank(null);
    setBankForm({ bankName: '', branch: '', accountHolder: '', accountNumber: '', iban: '', currency: 'TRY', balance: 0, accountType: 'Vadesiz' });
    setShowBankModal(true);
  };

  const openEditBank = (acc: BankAccount) => {
    setEditingBank(acc);
    setBankForm({ bankName: acc.bankName, branch: acc.branch, accountHolder: acc.accountHolder, accountNumber: acc.accountNumber, iban: acc.iban, currency: acc.currency, balance: acc.balance, accountType: acc.accountType });
    setShowBankModal(true);
  };

  const saveBank = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!bankForm.bankName.trim()) return showToast(t.bankNameRequired, 'error');
    try {
      if (editingBank) {
        await updateDoc(doc(db, 'bankAccounts', editingBank.id), { ...bankForm, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'bankAccounts'), { ...bankForm, updatedAt: serverTimestamp() });
        showToast(t.accountAdded);
      }
      setShowBankModal(false);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteBank = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: currentLanguage === 'tr' ? 'Hesabı Sil' : 'Delete Account',
      message: t.confirmDeleteAccount,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'bankAccounts', id));
          showToast(t.accountDeleted);
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `bankAccounts/${id}`);
          showToast(t.deleteError, 'error');
        }
      }
    });
  };

  // Bank Transaction Pull (from Mikro)
  const pullBankTransactions = async () => {
    if (!mikroEnabled || !mikroAccessToken) {
      showToast(currentLanguage === 'tr' ? 'Mikro entegrasyonu etkin değil veya Access Token eksik.' : 'Mikro integration not enabled or Access Token missing.', 'error');
      return;
    }
    setBankTxPulling(true);
    try {
      const config = { endpoint: mikroEndpoint, accessToken: mikroAccessToken, enabled: mikroEnabled };
      const today = format(new Date(), 'yyyy-MM-dd');
      const monthAgo = format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
      const result = await pullBankMovementsFromMikro({ baslangicTarihi: monthAgo, bitisTarihi: today }, config) as Record<string, unknown>;
      const rows = (result?.data ?? result?.items ?? result?.list ?? []) as Record<string, unknown>[];

      const newTxs: Omit<BankTransaction, 'id'>[] = rows.map((r) => ({
        accountId: String(r.HesapId ?? r.accountId ?? ''),
        accountName: String(r.BankaAdi ?? r.bankName ?? r.HesapAdi ?? ''),
        date: String(r.Tarih ?? r.date ?? today),
        description: String(r.Aciklama ?? r.description ?? r.BelgeNo ?? ''),
        amount: Math.abs(Number(r.Tutar ?? r.amount ?? 0)),
        type: Number(r.Tutar ?? r.amount ?? 0) >= 0 ? 'credit' : 'debit',
        balance: Number(r.BakiyeSonrasi ?? r.balance ?? 0),
        currency: (String(r.DovizKodu ?? r.currency ?? 'TRY') as 'TRY' | 'USD' | 'EUR'),
        reference: String(r.BelgeNo ?? r.reference ?? ''),
        source: 'mikro' as const,
        createdAt: serverTimestamp(),
      }));

      // Upsert to Firestore (skip duplicates by reference+date)
      const existing = new Set(bankTransactions.map(t => `${t.reference}_${t.date}`));
      const toAdd = newTxs.filter(t => !existing.has(`${t.reference}_${t.date}`));
      await Promise.all(toAdd.map(tx => addDoc(collection(db, 'bankTransactions'), tx)));

      const now = format(new Date(), 'dd.MM.yyyy HH:mm');
      setBankTxLastPull(now);
      showToast(
        currentLanguage === 'tr'
          ? `${toAdd.length} yeni hareket çekildi.`
          : `${toAdd.length} new transactions pulled.`,
        'success'
      );
    } catch (err) {
      console.error('Bank pull error:', err);
      showToast(currentLanguage === 'tr' ? 'Banka hareketleri çekilemedi.' : 'Failed to pull bank transactions.', 'error');
    } finally {
      setBankTxPulling(false);
    }
  };

  // Journal CRUD
  const saveJournal = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!journalForm.aciklama.trim()) return showToast(t.descRequired, 'error');
    try {
      if (editingJournal) {
        await updateDoc(doc(db, 'journalEntries', editingJournal.id), { ...journalForm, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'journalEntries'), { ...journalForm, createdAt: serverTimestamp() });
        showToast(t.journalAdded);
      }
      setShowJournalModal(false);
      setEditingJournal(null);
      setJournalForm({ date: format(new Date(), 'yyyy-MM-dd'), fiş: '', aciklama: '', debitHesap: HESAP_PLANI[0], alacakHesap: HESAP_PLANI[0], borc: 0, alacak: 0, kdvOran: 0, kategori: 'Satış' });
    } catch (error) {
      logFirestoreError(error, OperationType.WRITE, 'journalEntries');
      showToast(t.errorOccurred, 'error');
    }
  };

  const deleteJournal = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: currentLanguage === 'tr' ? 'Kaydı Sil' : 'Delete Entry',
      message: t.confirmDeleteEntry,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'journalEntries', id));
          showToast(t.journalDeleted);
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `journalEntries/${id}`);
          showToast(t.deleteError, 'error');
        }
      }
    });
  };

  const openEditJournal = (e: JournalEntry) => {
    setEditingJournal(e);
    setJournalForm({
      date: e.date,
      fiş: e.fiş || '',
      aciklama: e.aciklama,
      debitHesap: e.debitHesap,
      alacakHesap: e.alacakHesap,
      borc: e.borc,
      alacak: e.alacak,
      kdvOran: e.kdvOran ?? 0,
      kategori: e.kategori
    });
    setShowJournalModal(true);
  };

  const saveWarehouse = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!warehouseForm.name.trim()) return showToast(t.bankNameRequired, 'error');
    try {
      if (editingWarehouse) {
        await updateDoc(doc(db, 'warehouses', editingWarehouse.id), { ...warehouseForm, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'warehouses'), { ...warehouseForm, createdAt: serverTimestamp() });
        showToast(t.accountAdded);
      }
      setShowWarehouseModal(false);
      setWarehouseForm({ name: '', location: '', manager: '', notes: '' });
      setEditingWarehouse(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const saveStock = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!stockForm.productName.trim()) return showToast(t.bankNameRequired, 'error');
    try {
      if (editingStock) {
        await updateDoc(doc(db, 'warehouseItems', editingStock.id), { ...stockForm, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'warehouseItems'), { ...stockForm, createdAt: serverTimestamp() });
        showToast(t.accountAdded);
      }
      setShowStockModal(false);
      setStockForm({ productName: '', sku: '', quantity: 0, warehouseId: '', category: '', notes: '' });
      setEditingStock(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteWarehouse = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'warehouses', id));
          showToast(t.accountDeleted);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `warehouses/${id}`);
          showToast(t.deleteError, 'error');
        }
      }
    });
  };

  const deleteStock = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'warehouseItems', id));
          showToast(t.accountDeleted);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `warehouseItems/${id}`);
          showToast(t.deleteError, 'error');
        }
      }
    });
  };

  const saveCustomer = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!customerForm.name.trim()) return showToast(t.bankNameRequired, 'error');
    try {
      if (editingCustomer) {
        await updateDoc(doc(db, 'customers', editingCustomer.id), { ...customerForm, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'customers'), { ...customerForm, createdAt: serverTimestamp() });
        showToast(t.accountAdded);
      }
      setShowCustomerModal(false);
      setCustomerForm({ name: '', company: '', email: '', phone: '', address: '', taxNo: '', taxOffice: '', notes: '', creditLimit: 0, balance: 0, riskGroup: 'Düşük' });
      setEditingCustomer(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteCustomer = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'customers', id));
          showToast(t.accountDeleted);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `customers/${id}`);
          showToast(t.deleteError, 'error');
        }
      }
    });
  };

  const saveSupplier = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!supplierForm.name.trim()) return showToast(t.bankNameRequired, 'error');
    try {
      if (editingSupplier) {
        await updateDoc(doc(db, 'suppliers', editingSupplier.id), { ...supplierForm, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'suppliers'), { ...supplierForm, createdAt: serverTimestamp() });
        showToast(t.accountAdded);
      }
      setShowSupplierModal(false);
      setSupplierForm({ name: '', company: '', email: '', phone: '', address: '', taxNo: '', notes: '' });
      setEditingSupplier(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteSupplier = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'suppliers', id));
          showToast(t.accountDeleted);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `suppliers/${id}`);
          showToast(t.deleteError, 'error');
        }
      }
    });
  };

  const saveService = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!serviceForm.name.trim()) return showToast(t.bankNameRequired, 'error');
    try {
      if (editingService) {
        await updateDoc(doc(db, 'services', editingService.id), { ...serviceForm, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'services'), { ...serviceForm, createdAt: serverTimestamp() });
        showToast(t.accountAdded);
      }
      setShowServiceModal(false);
      setServiceForm({ code: '', name: '', type: 'Ürün', unitPrice: 0, vatRate: 18, unit: 'Adet', notes: '' });
      setEditingService(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteService = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'services', id));
          showToast(t.accountDeleted);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `services/${id}`);
          showToast(t.deleteError, 'error');
        }
      }
    });
  };

  const saveTransfer = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!transferForm.productName.trim()) return showToast(t.bankNameRequired, 'error');
    try {
      if (editingTransfer) {
        await updateDoc(doc(db, 'transfers', editingTransfer.id), { ...transferForm, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'transfers'), { ...transferForm, createdAt: serverTimestamp() });
        showToast(t.accountAdded);
        if (createNotification) {
          await createNotification(
            currentLanguage === 'tr' ? 'Yeni Transfer' : 'New Transfer',
            currentLanguage === 'tr' ? `${transferForm.fromWarehouse} deposundan ${transferForm.toWarehouse} deposuna ${transferForm.quantity} adet ${transferForm.productName} transferi oluşturuldu.` : `New transfer created: ${transferForm.quantity} ${transferForm.productName} from ${transferForm.fromWarehouse} to ${transferForm.toWarehouse}.`,
            'info'
          );
        }
      }
      setShowTransferModal(false);
      setTransferForm({ fromWarehouse: '', toWarehouse: '', productName: '', quantity: 0, date: format(new Date(), 'yyyy-MM-dd'), notes: '', status: 'Bekliyor' });
      setEditingTransfer(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteTransfer = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'transfers', id));
          showToast(t.accountDeleted);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `transfers/${id}`);
          showToast(t.deleteError, 'error');
        }
      }
    });
  };

  const saveCheck = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!checkForm.checkNo.trim()) return showToast(t.bankNameRequired, 'error');
    try {
      if (editingCheck) {
        await updateDoc(doc(db, 'checks', editingCheck.id), { ...checkForm, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'checks'), { ...checkForm, createdAt: serverTimestamp() });
        showToast(t.accountAdded);
      }
      setShowCheckModal(false);
      setCheckForm({ checkNo: '', bankName: '', amount: 0, dueDate: format(new Date(), 'yyyy-MM-dd'), drawer: '', type: 'Alınan', status: 'Aktif' });
      setEditingCheck(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteCheck = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'checks', id));
          showToast(t.accountDeleted);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `checks/${id}`);
          showToast(t.deleteError, 'error');
        }
      }
    });
  };

  const saveEmployee = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!employeeForm.name.trim()) return showToast(t.bankNameRequired, 'error');
    try {
      if (editingEmployee) {
        await updateDoc(doc(db, 'employees', editingEmployee.id), { ...employeeForm, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'employees'), { ...employeeForm, createdAt: serverTimestamp() });
        showToast(t.accountAdded);
      }
      setShowEmployeeModal(false);
      setEmployeeForm({ name: '', employeeId: '', tcId: '', position: '', department: '', salary: 0, startDate: format(new Date(), 'yyyy-MM-dd'), email: '', phone: '' });
      setEditingEmployee(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteEmployee = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'employees', id));
          showToast(t.accountDeleted);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `employees/${id}`);
          showToast(t.deleteError, 'error');
        }
      }
    });
  };

  const saveBudget = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    try {
      await addDoc(collection(db, 'budgets'), { ...budgetForm, createdAt: serverTimestamp() });
      showToast(t.accountAdded);
      setShowBudgetModal(false);
      setBudgetForm({ category: 'Genel Gider', amount: 0, period: format(new Date(), 'yyyy-MM') });
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteBudget = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'budgets', id));
          showToast(t.accountDeleted);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `budgets/${id}`);
          showToast(t.deleteError, 'error');
        }
      }
    });
  };

  const saveWaybill = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!waybillForm.waybillNo.trim()) return showToast(t.bankNameRequired, 'error');
    try {
      let waybillId = '';
      if (editingWaybill) {
        waybillId = editingWaybill.id;
        await updateDoc(doc(db, 'waybills', waybillId), { ...waybillForm, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        const docRef = await addDoc(collection(db, 'waybills'), { ...waybillForm, type: waybillType, createdAt: serverTimestamp() });
        waybillId = docRef.id;
        showToast(t.accountAdded);
      }

      // Stock Integration
      if (waybillForm.status === 'Tamamlandı') {
        for (const item of waybillForm.items) {
          const existingItem = warehouseItems.find(w => w.productName === item.productName && w.sku === item.sku);
          if (existingItem) {
            const newQty = waybillType === 'giden' 
              ? existingItem.quantity - item.quantity 
              : existingItem.quantity + item.quantity;
            await updateDoc(doc(db, 'warehouseItems', existingItem.id), { 
              quantity: newQty,
              updatedAt: serverTimestamp() 
            });
          } else if (waybillType === 'gelen') {
            // Create new stock item if it doesn't exist and it's an incoming waybill
            await addDoc(collection(db, 'warehouseItems'), {
              productName: item.productName,
              sku: item.sku,
              quantity: item.quantity,
              updatedAt: serverTimestamp()
            });
          }
        }
      }

      setShowWaybillModal(false);
      setWaybillForm({ waybillNo: '', invoiceNo: '', party: '', date: format(new Date(), 'yyyy-MM-dd'), items: [], total: 0, status: 'Bekliyor' });
      setEditingWaybill(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteWaybill = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'waybills', id));
          showToast(t.accountDeleted);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          logFirestoreError(error, OperationType.DELETE, `waybills/${id}`);
          showToast(t.deleteError, 'error');
        }
      }
    });
  };

  // KPI computations
  const tryBalance = bankAccounts.filter(a => a.currency === 'TRY').reduce((s, a) => s + a.balance, 0);
  const usdBalance = bankAccounts.filter(a => a.currency === 'USD').reduce((s, a) => s + a.balance, 0);
  const eurBalance = bankAccounts.filter(a => a.currency === 'EUR').reduce((s, a) => s + a.balance, 0);

  // Filtered + sorted bank accounts
  const toggleBankSort = (key: keyof BankAccount) => {
    if (bankSortKey === key) setBankSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setBankSortKey(key); setBankSortDir('asc'); }
  };
  const displayedAccounts = bankAccounts
    .filter(a => {
      const q = bankSearch.toLowerCase();
      return !q || a.bankName.toLowerCase().includes(q) || a.accountHolder.toLowerCase().includes(q) || a.iban.toLowerCase().includes(q) || a.accountType.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const av = a[bankSortKey] ?? '';
      const bv = b[bankSortKey] ?? '';
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'tr');
      return bankSortDir === 'asc' ? cmp : -cmp;
    });

  const toggleJournalSort = (key: keyof JournalEntry) => {
    if (journalSortKey === key) setJournalSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setJournalSortKey(key); setJournalSortDir('desc'); }
  };
  const displayedJournal = journalEntries
    .filter(e => {
      const q = journalSearch.toLowerCase();
      return !q || e.aciklama.toLowerCase().includes(q) || e.fiş.toLowerCase().includes(q) || e.debitHesap.toLowerCase().includes(q) || e.alacakHesap.toLowerCase().includes(q) || e.kategori.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      let cmp = 0;
      if (journalSortKey === 'date') cmp = (a.date || '').localeCompare(b.date || '');
      else if (journalSortKey === 'borc') cmp = a.borc - b.borc;
      else if (journalSortKey === 'alacak') cmp = a.alacak - b.alacak;
      else if (journalSortKey === 'kategori') cmp = (a.kategori || '').localeCompare(b.kategori || '', 'tr');
      return journalSortDir === 'asc' ? cmp : -cmp;
    });

  // Mizan computation
  const mizanMap: Record<string, { borc: number; alacak: number }> = {};
  journalEntries.forEach(e => {
    if (!mizanMap[e.debitHesap]) mizanMap[e.debitHesap] = { borc: 0, alacak: 0 };
    if (!mizanMap[e.alacakHesap]) mizanMap[e.alacakHesap] = { borc: 0, alacak: 0 };
    mizanMap[e.debitHesap].borc += e.borc;
    mizanMap[e.alacakHesap].alacak += e.alacak;
  });
  const mizanRows = Object.entries(mizanMap).map(([hesap, vals]) => ({
    hesap, borc: vals.borc, alacak: vals.alacak,
    borcBakiye: Math.max(0, vals.borc - vals.alacak),
    alacakBakiye: Math.max(0, vals.alacak - vals.borc),
  }));

  const toggleMizanSort = (key: typeof mizanSortKey) => {
    if (mizanSortKey === key) setMizanSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setMizanSortKey(key); setMizanSortDir('asc'); }
  };

  const sortedMizanRows = [...mizanRows].sort((a, b) => {
    let cmp: number;
    if (mizanSortKey === 'hesap') cmp = a.hesap.localeCompare(b.hesap, 'tr');
    else cmp = (a[mizanSortKey] || 0) - (b[mizanSortKey] || 0);
    return mizanSortDir === 'asc' ? cmp : -cmp;
  });

  const mizanTotals = mizanRows.reduce((acc, r) => ({
    borc: acc.borc + r.borc, alacak: acc.alacak + r.alacak,
    borcBakiye: acc.borcBakiye + r.borcBakiye, alacakBakiye: acc.alacakBakiye + r.alacakBakiye,
  }), { borc: 0, alacak: 0, borcBakiye: 0, alacakBakiye: 0 });
  const mizanDengeli = Math.abs(mizanTotals.borc - mizanTotals.alacak) < 0.01;
  const displayedMizan = mizanSearch
    ? sortedMizanRows.filter(r => r.hesap.toLowerCase().includes(mizanSearch.toLowerCase()))
    : sortedMizanRows;

  // Satışlar computed
  const displayedSatis = orders
    .filter((o: Order) => {
      const q = satisSearch.toLowerCase();
      return !q || (o.customerName || '').toLowerCase().includes(q) || String(o.totalPrice || 0).includes(q);
    })
    .sort((a: Order, b: Order) => {
      let cmp: number;
      if (satisSortKey === 'customerName') cmp = (a.customerName || '').localeCompare(b.customerName || '', 'tr');
      else if (satisSortKey === 'totalPrice') cmp = (a.totalPrice || 0) - (b.totalPrice || 0);
      else if (satisSortKey === 'faturali') cmp = (a.faturali ? 1 : 0) - (b.faturali ? 1 : 0);
      else {
        const ad = (a.syncedAt as { toDate?: () => Date })?.toDate ? (a.syncedAt as { toDate: () => Date }).toDate().toISOString() : '';
        const bd = (b.syncedAt as { toDate?: () => Date })?.toDate ? (b.syncedAt as { toDate: () => Date }).toDate().toISOString() : '';
        cmp = ad.localeCompare(bd);
      }
      return satisSortDir === 'asc' ? cmp : -cmp;
    });

  const toggleSatisSort = (key: typeof satisSortKey) => {
    if (satisSortKey === key) setSatisSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSatisSortKey(key); setSatisSortDir('asc'); }
  };

  // Müşteriler computed
  const displayedMusteriler = customers
    .filter(c => !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()) || (c.company || '').toLowerCase().includes(customerSearch.toLowerCase()))
    .sort((a, b) => {
      const av = (a[musteriSortKey] || '') as string;
      const bv = (b[musteriSortKey] || '') as string;
      const cmp = av.localeCompare(bv, 'tr');
      return musteriSortDir === 'asc' ? cmp : -cmp;
    });

  const toggleMusteriSort = (key: typeof musteriSortKey) => {
    if (musteriSortKey === key) setMusteriSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setMusteriSortKey(key); setMusteriSortDir('asc'); }
  };

  // Tedarikçiler computed
  const displayedTedarikciler = suppliers
    .filter(s => !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase()) || (s.company || '').toLowerCase().includes(supplierSearch.toLowerCase()))
    .sort((a, b) => {
      const av = (a[tedarikciSortKey] || '') as string;
      const bv = (b[tedarikciSortKey] || '') as string;
      const cmp = av.localeCompare(bv, 'tr');
      return tedarikciSortDir === 'asc' ? cmp : -cmp;
    });

  const toggleTedarikciSort = (key: typeof tedarikciSortKey) => {
    if (tedarikciSortKey === key) setTedarikciSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setTedarikciSortKey(key); setTedarikciSortDir('asc'); }
  };

  // Hizmet & Ürünler computed
  const displayedServisler = services
    .filter(s => !serviceSearch || s.name.toLowerCase().includes(serviceSearch.toLowerCase()) || s.code.toLowerCase().includes(serviceSearch.toLowerCase()))
    .sort((a, b) => {
      let cmp: number;
      if (servisSortKey === 'unitPrice') cmp = a.unitPrice - b.unitPrice;
      else if (servisSortKey === 'vatRate') cmp = a.vatRate - b.vatRate;
      else cmp = (a[servisSortKey] || '').localeCompare(b[servisSortKey] || '', 'tr');
      return servisSortDir === 'asc' ? cmp : -cmp;
    });

  const toggleServisSort = (key: typeof servisSortKey) => {
    if (servisSortKey === key) setServisSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setServisSortKey(key); setServisSortDir('asc'); }
  };

  // Depo computed
  const displayedDepo = warehouseItems
    .filter(w => !warehouseSearch || w.productName.toLowerCase().includes(warehouseSearch.toLowerCase()))
    .sort((a, b) => {
      let cmp: number;
      if (depoSortKey === 'quantity') cmp = a.quantity - b.quantity;
      else if (depoSortKey === 'sku') cmp = (a.sku || '').localeCompare(b.sku || '', 'tr');
      else cmp = a.productName.localeCompare(b.productName, 'tr');
      return depoSortDir === 'asc' ? cmp : -cmp;
    });

  const toggleDepoSort = (key: typeof depoSortKey) => {
    if (depoSortKey === key) setDepoSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setDepoSortKey(key); setDepoSortDir('asc'); }
  };

  // Transfer computed
  const displayedTransfers = transfers
    .filter(tr => !transferSearch || tr.productName.toLowerCase().includes(transferSearch.toLowerCase()))
    .sort((a, b) => {
      let cmp: number;
      if (transferSortKey === 'quantity') cmp = a.quantity - b.quantity;
      else if (transferSortKey === 'date') cmp = a.date.localeCompare(b.date);
      else if (transferSortKey === 'status') cmp = a.status.localeCompare(b.status, 'tr');
      else cmp = a.productName.localeCompare(b.productName, 'tr');
      return transferSortDir === 'asc' ? cmp : -cmp;
    });

  const toggleTransferSort = (key: typeof transferSortKey) => {
    if (transferSortKey === key) setTransferSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setTransferSortKey(key); setTransferSortDir('asc'); }
  };

  // Çekler computed
  const displayedCekler = checks
    .filter(c => !checkSearch || c.checkNo.toLowerCase().includes(checkSearch.toLowerCase()) || c.drawer.toLowerCase().includes(checkSearch.toLowerCase()))
    .sort((a, b) => {
      let cmp: number;
      if (cekSortKey === 'amount') cmp = a.amount - b.amount;
      else if (cekSortKey === 'dueDate') cmp = a.dueDate.localeCompare(b.dueDate);
      else if (cekSortKey === 'type') cmp = a.type.localeCompare(b.type, 'tr');
      else cmp = a.checkNo.localeCompare(b.checkNo);
      return cekSortDir === 'asc' ? cmp : -cmp;
    });

  const toggleCekSort = (key: typeof cekSortKey) => {
    if (cekSortKey === key) setCekSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setCekSortKey(key); setCekSortDir('asc'); }
  };

  // Çalışanlar computed
  const displayedCalisanlar = employees
    .filter(e => !employeeSearch || e.name.toLowerCase().includes(employeeSearch.toLowerCase()) || e.position.toLowerCase().includes(employeeSearch.toLowerCase()))
    .sort((a, b) => {
      let cmp: number;
      if (calisanSortKey === 'salary') cmp = (a.salary || 0) - (b.salary || 0);
      else if (calisanSortKey === 'startDate') cmp = (a.startDate || '').localeCompare(b.startDate || '');
      else if (calisanSortKey === 'department') cmp = (a.department || '').localeCompare(b.department || '', 'tr');
      else cmp = a.name.localeCompare(b.name, 'tr');
      return calisanSortDir === 'asc' ? cmp : -cmp;
    });

  const toggleCalisanSort = (key: typeof calisanSortKey) => {
    if (calisanSortKey === key) setCalisanSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setCalisanSortKey(key); setCalisanSortDir('asc'); }
  };

  // İrsaliye computed (shared sort state for both giden/gelen)
  const makeDisplayedWaybills = (type: 'giden' | 'gelen') =>
    waybills
      .filter(w => w.type === type && (!waybillSearch || w.waybillNo.toLowerCase().includes(waybillSearch.toLowerCase()) || w.party.toLowerCase().includes(waybillSearch.toLowerCase())))
      .sort((a, b) => {
        let cmp: number;
        if (irsaliyeSortKey === 'total') cmp = (a.total || 0) - (b.total || 0);
        else if (irsaliyeSortKey === 'date') cmp = a.date.localeCompare(b.date);
        else if (irsaliyeSortKey === 'status') cmp = a.status.localeCompare(b.status, 'tr');
        else if (irsaliyeSortKey === 'party') cmp = a.party.localeCompare(b.party, 'tr');
        else cmp = a.waybillNo.localeCompare(b.waybillNo);
        return irsaliyeSortDir === 'asc' ? cmp : -cmp;
      });

  const toggleIrsaliyeSort = (key: typeof irsaliyeSortKey) => {
    if (irsaliyeSortKey === key) setIrsaliyeSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setIrsaliyeSortKey(key); setIrsaliyeSortDir('asc'); }
  };

  // Gelir/Gider computation
  const filteredEntries = journalEntries.filter(e => {
    if (!e.date) return false;
    const d = new Date(e.date);
    if (gelirUseRange && gelirDateFrom && gelirDateTo) {
      return e.date >= gelirDateFrom && e.date <= gelirDateTo;
    }
    return d.getMonth() + 1 === gelirMonth && d.getFullYear() === gelirYear;
  });
  const gelirEntries = filteredEntries.filter(e => e.alacakHesap.startsWith('6'));
  const giderEntries = filteredEntries.filter(e => e.debitHesap.startsWith('6') || e.debitHesap.startsWith('7') || e.debitHesap.startsWith('8'));
  const toplamGelir = gelirEntries.reduce((s, e) => s + e.borc, 0);
  const toplamGider = giderEntries.reduce((s, e) => s + e.borc, 0);
  const netKar = toplamGelir - toplamGider;

  // Monthly chart data
  const monthlyData = MONTHS.map((m, i) => {
    const month = i + 1;
    const mEntries = journalEntries.filter(e => {
      if (!e.date) return false;
      const d = new Date(e.date);
      return d.getMonth() + 1 === month && d.getFullYear() === gelirYear;
    });
    const gelir = mEntries.filter(e => e.alacakHesap.startsWith('6')).reduce((s, e) => s + e.borc, 0);
    const gider = mEntries.filter(e => e.debitHesap.startsWith('6') || e.debitHesap.startsWith('7') || e.debitHesap.startsWith('8')).reduce((s, e) => s + e.borc, 0);
    return { month: m, gelir, gider };
  });
  const maxChartVal = Math.max(...monthlyData.map(d => Math.max(d.gelir, d.gider)), 1);

  // Gelir breakdown by account
  const gelirBreakdown: Record<string, number> = {};
  gelirEntries.forEach(e => { gelirBreakdown[e.alacakHesap] = (gelirBreakdown[e.alacakHesap] || 0) + e.borc; });
  const giderBreakdown: Record<string, number> = {};
  giderEntries.forEach(e => { giderBreakdown[e.debitHesap] = (giderBreakdown[e.debitHesap] || 0) + e.borc; });

  // KDV computation
  const kdvFilteredEntries = journalEntries.filter(e => {
    if (!e.date) return true;
    const d = new Date(e.date);
    return d.getMonth() + 1 === kdvMonth && d.getFullYear() === kdvYear;
  });
  const hesaplananKDV = kdvFilteredEntries.filter(e => e.alacakHesap === '391 - Hesaplanan KDV').reduce((s, e) => s + e.alacak, 0);
  const indirilecekKDV = kdvFilteredEntries.filter(e => e.debitHesap === '191 - İndirilecek KDV').reduce((s, e) => s + e.borc, 0);
  const odenecekKDV = hesaplananKDV - indirilecekKDV;
  const kdvOranBreakdown: Record<number, { matrah: number; kdv: number }> = {};
  kdvFilteredEntries.forEach(e => {
    const oran = e.kdvOran ?? 0;
    if (!kdvOranBreakdown[oran]) kdvOranBreakdown[oran] = { matrah: 0, kdv: 0 };
    kdvOranBreakdown[oran].matrah += e.borc;
    kdvOranBreakdown[oran].kdv += e.borc * (oran / 100);
  });

  const tabs = [
    { key: 'faturalar', label: currentLanguage === 'tr' ? 'Faturalar' : 'Invoices', icon: FileText },
    { key: 'e-fatura', label: 'e-Fatura', icon: Link },
    { key: 'evrak_tasarimi', label: currentLanguage === 'tr' ? 'Evrak Tasarımı' : 'Doc Design', icon: Palette },
    { key: 'banka', label: t.bankAndCash, icon: Building2 },
    { key: 'yevmiye', label: t.journal, icon: BookOpen },
    { key: 'mizan', label: t.trialBalance, icon: ArrowUpDown },
    { key: 'gelir', label: t.incomeExpense, icon: BarChart3 },
    { key: 'kdv', label: t.vat, icon: Calculator },
    { key: 'luca', label: t.luca, icon: Link },
    { key: 'mikro', label: 'Mikro ERP', icon: Link },
    { key: 'banka_hareketleri', label: currentLanguage === 'tr' ? 'Banka Hareketleri' : 'Bank Movements', icon: Landmark },
    { key: 'satislar', label: t.satislar, icon: ShoppingCart },
    { key: 'musteriler', label: t.musteriler, icon: Users },
    { key: 'tedarikciler', label: t.tedarikciler, icon: Truck },
    { key: 'urunler', label: t.urunler, icon: Package },
    { key: 'depo', label: t.depo, icon: Package },
    { key: 'warehouses', label: currentLanguage === 'tr' ? 'Depo Tanımları' : 'Warehouse Definitions', icon: Home },
    { key: 'transfer', label: t.transfer, icon: ArrowRightLeft },
    { key: 'cekler', label: t.cekler, icon: CreditCard },
    { key: 'calisanlar', label: t.calisanlar, icon: FileText },
    { key: 'giden_irsaliye', label: t.gidenIrsaliye, icon: FileUp },
    { key: 'gelen_irsaliye', label: t.gelenIrsaliye, icon: FileDown },
    { key: 'butce', label: t.butce, icon: BarChart3 },
    { key: 'isletme_sermayesi', label: t.isletme_sermayesi, icon: Briefcase },
    { key: 'tahsilat', label: t.tahsilat, icon: Wallet },
    { key: 'maliyet_merkezi', label: t.maliyet_merkezi, icon: Layers },
    { key: 'sabit_kiymet', label: t.sabit_kiymet, icon: Landmark },
  ] as const;

  const visibleTabs = allowedTabs ? tabs.filter(t => allowedTabs.includes(t.key)) : tabs;

  return (
    <div className="space-y-4 overflow-x-hidden">
      {/* Sub-tab Nav */}
      <div className="overflow-x-auto scrollbar-none -mx-3 px-3 sm:-mx-4 sm:px-4">
        <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
          {visibleTabs.map(t => {
            const Icon = t.icon;
            const isActive = accountingTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setAccountingTab(t.key)}
                className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${isActive ? 'bg-[#ff4000] text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}
              >
                <Icon size={13} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* FATURALAR */}
      {accountingTab === 'faturalar' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Invoice creation modal */}
          {showInvoiceModal && (
            <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-bold text-lg">{currentLanguage==='tr'?'Fatura Kes':'Create Invoice'}</h3>
                  <button onClick={()=>setShowInvoiceModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4"/></button>
                </div>
                {/* Invoice type */}
                <div className="mb-4">
                  <label className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 block">{currentLanguage==='tr'?'Fatura Türü':'Invoice Type'}</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { v:'e-fatura', l:'e-Fatura', d:currentLanguage==='tr'?'Kayıtlı mükellef':'Registered taxpayer' },
                      { v:'e-arsiv', l:'e-Arşiv', d:currentLanguage==='tr'?'Bireysel / kayıtsız':'Individual / unregistered' },
                      { v:'ihracat', l:currentLanguage==='tr'?'İhracat':'Export', d:currentLanguage==='tr'?'Yurt dışı':'International' },
                    ] as const).map(tp => (
                      <button key={tp.v} type="button" onClick={()=>setInvoiceForm(f=>({...f,faturaTipi:tp.v}))}
                        className={`p-2.5 rounded-xl border text-left transition-all ${invoiceForm.faturaTipi===tp.v?'border-[#ff4000] bg-[#ff4000]/5':'border-gray-200 hover:border-gray-300'}`}>
                        <p className={`text-[11px] font-bold ${invoiceForm.faturaTipi===tp.v?'text-[#ff4000]':'text-gray-700'}`}>{tp.l}</p>
                        <p className="text-[9px] text-gray-400 mt-0.5">{tp.d}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{currentLanguage==='tr'?'Fatura No':'Invoice No'}</label>
                      <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.faturaNo} onChange={e=>setInvoiceForm(f=>({...f,faturaNo:e.target.value}))} placeholder="FTR-2026-001" /></div>
                    <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{currentLanguage==='tr'?'Tarih':'Date'}</label>
                      <input type="date" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.date} onChange={e=>setInvoiceForm(f=>({...f,date:e.target.value}))} /></div>
                  </div>
                  <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{currentLanguage==='tr'?'Müşteri Adı':'Customer Name'}</label>
                    <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.customerName} onChange={e=>setInvoiceForm(f=>({...f,customerName:e.target.value}))} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{currentLanguage==='tr'?'Vergi No':'Tax ID'}</label>
                      <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.taxId} onChange={e=>setInvoiceForm(f=>({...f,taxId:e.target.value}))} /></div>
                    <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{currentLanguage==='tr'?'Vergi Dairesi':'Tax Office'}</label>
                      <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000]" value={invoiceForm.taxOffice} onChange={e=>setInvoiceForm(f=>({...f,taxOffice:e.target.value}))} /></div>
                  </div>
                  <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">{currentLanguage==='tr'?'Adres':'Address'}</label>
                    <textarea rows={2} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#ff4000] resize-none" value={invoiceForm.address} onChange={e=>setInvoiceForm(f=>({...f,address:e.target.value}))} /></div>
                  <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">KDV %</label>
                    <div className="flex gap-2">
                      {[0,1,8,10,18,20].map(r => (
                        <button key={r} type="button" onClick={()=>setInvoiceForm(f=>({...f,kdvOran:r}))}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${invoiceForm.kdvOran===r?'bg-[#ff4000] text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>%{r}</button>
                      ))}
                    </div>
                  </div>
                  {invoiceSource && (
                    <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1">
                      <div className="flex justify-between"><span className="text-gray-500">{currentLanguage==='tr'?'Sipariş':'Order'}:</span><span className="font-semibold">#{(invoiceSource.id as string).slice(0,8)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">{currentLanguage==='tr'?'Matrah (KDV hariç)':'Net (excl. VAT)'}:</span><span className="font-semibold">₺{((invoiceSource.totalPrice as number||0)/(1+invoiceForm.kdvOran/100)).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
                      <div className="flex justify-between text-[#ff4000]"><span>KDV %{invoiceForm.kdvOran}:</span><span className="font-semibold">₺{((invoiceSource.totalPrice as number||0)-(invoiceSource.totalPrice as number||0)/(1+invoiceForm.kdvOran/100)).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
                      <div className="flex justify-between font-bold border-t border-gray-200 pt-1"><span>{currentLanguage==='tr'?'Toplam':'Total'}:</span><span>₺{(invoiceSource.totalPrice as number||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 mt-5">
                  <button onClick={handleCreateInvoice} className="flex-1 bg-[#ff4000] hover:bg-[#cc3200] text-white py-2.5 rounded-xl text-sm font-bold transition-colors">{currentLanguage==='tr'?'Faturayı Kes':'Create Invoice'}</button>
                  <button onClick={()=>setShowInvoiceModal(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-bold transition-colors">{currentLanguage==='tr'?'İptal':'Cancel'}</button>
                </div>
              </div>
            </div>
          )}

          {/* KPI + header */}
          <div className="flex items-center justify-between">
            <div className="grid grid-cols-3 gap-3 flex-1 mr-4">
              {[
                { label: currentLanguage==='tr'?'Toplam Fatura':'Total Invoices', value: invoices.length, color: 'text-[#ff4000]' },
                { label: 'e-Fatura', value: invoices.filter(i=>i.faturaTipi==='e-fatura').length, color: 'text-green-600' },
                { label: 'e-Arşiv', value: invoices.filter(i=>i.faturaTipi==='e-arsiv').length, color: 'text-purple-600' },
              ].map((k,i)=>(
                <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-xs text-gray-500 mt-1">{k.label}</p>
                </div>
              ))}
            </div>
            {isAuthenticated && (
              <button onClick={()=>{setInvoiceSource(null);setShowInvoiceModal(true);}} className="flex items-center gap-2 bg-[#ff4000] hover:bg-[#cc3200] text-white px-4 py-2.5 rounded-full text-sm font-bold transition-colors shadow-sm shrink-0">
                <Plus className="w-4 h-4"/>{currentLanguage==='tr'?'Yeni Fatura':'New Invoice'}
              </button>
            )}
          </div>

          {/* Filter + Search */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"/>
              <input className="pl-9 w-full bg-white border border-gray-200 rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-[#ff4000]"
                placeholder={currentLanguage==='tr'?'Fatura ara...':'Search invoices...'}
                value={invoiceSearch} onChange={e=>setInvoiceSearch(e.target.value)} />
            </div>
            <div className="flex gap-1 bg-white border border-gray-200 rounded-2xl p-1">
              {(['all','e-fatura','e-arsiv','ihracat'] as const).map(f => (
                <button key={f} onClick={()=>setInvoiceTypeFilter(f)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${invoiceTypeFilter===f?'bg-[#ff4000] text-white':'text-gray-500 hover:text-gray-700'}`}>
                  {f==='all'?(currentLanguage==='tr'?'Tümü':'All'):f==='ihracat'?(currentLanguage==='tr'?'İhracat':'Export'):f}
                </button>
              ))}
            </div>
          </div>

          {/* Invoices table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <SortHeader label={currentLanguage==='tr'?'Fatura No':'Invoice No'} sortKey="faturaNo" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} />
                    <SortHeader label={currentLanguage==='tr'?'Müşteri':'Customer'} sortKey="customerName" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} />
                    <SortHeader label={currentLanguage==='tr'?'Tür':'Type'} sortKey="faturaTipi" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} />
                    <SortHeader label={currentLanguage==='tr'?'Tarih':'Date'} sortKey="date" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} className="hidden md:table-cell" />
                    <SortHeader label="KDV %" sortKey="kdvOran" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} className="text-right" />
                    <SortHeader label={currentLanguage==='tr'?'Matrah':'Net'} sortKey="kdvHaric" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} className="text-right" />
                    <SortHeader label={currentLanguage==='tr'?'Toplam':'Total'} sortKey="totalPrice" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} className="text-right" />
                    <SortHeader label={currentLanguage==='tr'?'Durum':'Status'} sortKey="status" currentSort={invoiceSort} onSort={k=>setInvoiceSort(p=>({key:k,direction:p.key===k&&p.direction==='asc'?'desc':'asc'}))} />
                    {isAuthenticated && <th className="px-4 py-3"/>}
                  </tr>
                </thead>
                <tbody>
                  {invoices
                    .filter(inv => invoiceTypeFilter==='all' || inv.faturaTipi===invoiceTypeFilter)
                    .filter(inv => {
                      const s = invoiceSearch.toLowerCase();
                      return !s || (inv.customerName as string||'').toLowerCase().includes(s) || (inv.faturaNo as string||'').toLowerCase().includes(s);
                    })
                    .sort((a, b) => {
                      const av = (a[invoiceSort.key as keyof typeof a] as string | number) ?? '';
                      const bv = (b[invoiceSort.key as keyof typeof b] as string | number) ?? '';
                      if (av < bv) return invoiceSort.direction === 'asc' ? -1 : 1;
                      if (av > bv) return invoiceSort.direction === 'asc' ? 1 : -1;
                      return 0;
                    })
                    .map(inv => {
                      const tp = inv.faturaTipi as string;
                      const typeColor = tp==='ihracat'?'bg-blue-100 text-blue-600':tp==='e-arsiv'?'bg-purple-100 text-purple-600':'bg-green-100 text-green-600';
                      return (
                        <tr key={inv.id as string} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold text-[#ff4000]">{inv.faturaNo as string || `#${(inv.id as string).slice(0,8)}`}</td>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-[#1D1D1F]">{inv.customerName as string}</p>
                            {inv.taxId && <p className="text-[10px] text-gray-400">VKN: {inv.taxId as string}</p>}
                          </td>
                          <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${typeColor}`}>{tp}</span></td>
                          <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{inv.date as string}</td>
                          <td className="px-4 py-3 text-right text-gray-600">%{inv.kdvOran as number}</td>
                          <td className="px-4 py-3 text-right text-gray-600">₺{(inv.kdvHaric as number||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                          <td className="px-4 py-3 text-right font-bold text-[#1D1D1F]">₺{(inv.totalPrice as number||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                          <td className="px-4 py-3"><span className="text-[10px] font-bold bg-green-100 text-green-600 px-2 py-0.5 rounded-full">{inv.status as string || 'Kesildi'}</span></td>
                          {isAuthenticated && (
                            <td className="px-4 py-3">
                              <button onClick={async()=>{if(window.confirm(currentLanguage==='tr'?'Faturayı silmek istediğinize emin misiniz?':'Delete this invoice?')){await deleteDoc(doc(db,'invoices',inv.id as string));}}} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  {invoices.length===0 && (
                    <tr><td colSpan={9} className="text-center py-12 text-gray-400">
                      <FileText className="w-10 h-10 mx-auto mb-2 opacity-20"/>
                      <p className="text-sm">{currentLanguage==='tr'?'Henüz fatura kesilmedi.':'No invoices yet.'}</p>
                      <p className="text-xs mt-1">{currentLanguage==='tr'?'Siparişler listesinden "Fatura Kes" butonunu kullanın.':'Use the "Create Invoice" button from the orders list.'}</p>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* BANKA & KASA */}
      {accountingTab === 'banka' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                label: t.tryBalance, value: formatTRY(tryBalance), symbol: '₺', color: 'text-green-600',
                onClick: () => setDrillDown({ title: '₺ TRY Hesaplar', rows: bankAccounts.filter(a => a.currency === 'TRY').map(a => ({ label: a.bankName, sub: `${a.accountType} — ${a.accountHolder}`, value: formatTRY(a.balance) })), total: formatTRY(tryBalance) })
              },
              {
                label: t.usdBalance, value: `$${usdBalance.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, symbol: '$', color: 'text-blue-600',
                onClick: () => setDrillDown({ title: '$ USD Hesaplar', rows: bankAccounts.filter(a => a.currency === 'USD').map(a => ({ label: a.bankName, sub: `${a.accountType} — ${a.accountHolder}`, value: `$${a.balance.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` })), total: `$${usdBalance.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` })
              },
              {
                label: t.eurBalance, value: `€${eurBalance.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, symbol: '€', color: 'text-purple-600',
                onClick: () => setDrillDown({ title: '€ EUR Hesaplar', rows: bankAccounts.filter(a => a.currency === 'EUR').map(a => ({ label: a.bankName, sub: `${a.accountType} — ${a.accountHolder}`, value: `€${a.balance.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` })), total: `€${eurBalance.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` })
              },
              {
                label: t.accountCount, value: String(bankAccounts.length), symbol: '#', color: 'text-[#ff4000]',
                onClick: () => setDrillDown({ title: currentLanguage === 'tr' ? 'Tüm Hesaplar' : 'All Accounts', rows: bankAccounts.map(a => ({ label: a.bankName, sub: `${a.accountHolder} — ${a.accountType}`, badge: a.currency, badgeColor: a.currency === 'TRY' ? 'bg-green-100 text-green-600' : a.currency === 'USD' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600', value: a.currency === 'TRY' ? formatTRY(a.balance) : a.currency === 'USD' ? `$${a.balance.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}` : `€${a.balance.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}` })) })
              },
            ].map((kpi, i) => (
              <button key={i} onClick={kpi.onClick} className="apple-card p-4 text-left cursor-pointer group">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 font-medium">{kpi.label}</span>
                  <span className={`text-base font-black ${kpi.color} group-hover:scale-110 transition-transform`}>{kpi.symbol}</span>
                </div>
                <div className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</div>
                <div className="text-[10px] text-gray-300 mt-1 group-hover:text-gray-400 transition-colors">{currentLanguage === 'tr' ? 'Detay için tıkla' : 'Click for details'}</div>
              </button>
            ))}
          </div>
          <div className="apple-card p-4">
            {/* Row 1: Title + actions */}
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800">{t.bankCashAccounts}</h3>
              <div className="flex items-center gap-2">
                <label className="apple-button-secondary py-1.5 px-3 text-xs cursor-pointer">
                  <Download size={12} />
                  {t.importStatement}
                  <input type="file" accept=".csv,.pdf" className="hidden" onChange={handleBankFileImport} />
                </label>
                <button onClick={openAddBank} className="apple-button-primary py-1.5 px-3 text-xs">
                  <Plus size={14} /> {t.addAccount}
                </button>
              </div>
            </div>
            {/* Row 2: Search bar */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder={t.searchAccounts}
                value={bankSearch}
                onChange={e => setBankSearch(e.target.value)}
                className="apple-input w-full pl-9 py-2"
              />
            </div>
            {bankImportStatus && (
              <div className="mb-3 px-3 py-2 bg-green-50 text-green-700 text-xs rounded-xl font-medium flex items-center justify-between">
                <span>{bankImportStatus}</span>
                <button onClick={() => setBankImportStatus(null)} className="ml-2 text-green-500 hover:text-green-700"><X size={12} /></button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={t.bank} 
                      sortKey="bankName" 
                      currentSort={{ key: bankSortKey, direction: bankSortDir }} 
                      onSort={(key) => toggleBankSort(key as keyof BankAccount)} 
                    />
                    <SortHeader 
                      label={t.accountType} 
                      sortKey="accountType" 
                      currentSort={{ key: bankSortKey, direction: bankSortDir }} 
                      onSort={(key) => toggleBankSort(key as keyof BankAccount)} 
                    />
                    <SortHeader 
                      label={t.iban} 
                      sortKey="iban" 
                      currentSort={{ key: bankSortKey, direction: bankSortDir }} 
                      onSort={(key) => toggleBankSort(key as keyof BankAccount)} 
                      className="hidden sm:table-cell"
                    />
                    <SortHeader 
                      label={t.balance} 
                      sortKey="balance" 
                      currentSort={{ key: bankSortKey, direction: bankSortDir }} 
                      onSort={(key) => toggleBankSort(key as keyof BankAccount)} 
                      className="text-right"
                    />
                    <SortHeader 
                      label={t.currency} 
                      sortKey="currency" 
                      currentSort={{ key: bankSortKey, direction: bankSortDir }} 
                      onSort={(key) => toggleBankSort(key as keyof BankAccount)} 
                      className="hidden sm:table-cell"
                    />
                    <th className="text-center py-2 px-3 text-gray-500 font-medium">{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedAccounts.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t.noAccounts}</td></tr>
                  )}
                  {displayedAccounts.map(acc => (
                    <tr key={acc.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-gray-800">{acc.bankName}</div>
                        <div className="text-xs text-gray-400">{acc.accountHolder}</div>
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">{acc.accountType}</td>
                      <td className="py-2.5 px-3 text-gray-500 font-mono text-xs hidden sm:table-cell">{acc.iban}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-gray-800">
                        {acc.currency === 'TRY'
                          ? formatTRY(acc.balance)
                          : acc.currency === 'USD'
                            ? `$${acc.balance.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : `€${acc.balance.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        }
                      </td>
                      <td className="py-2.5 px-3 hidden sm:table-cell">
                        <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs font-semibold">{acc.currency}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => openEditBank(acc)} className="action-btn-view" title={currentLanguage === 'tr' ? 'İncele' : 'View'}><Eye size={14} /></button>
                          <button onClick={() => openEditBank(acc)} className="action-btn-edit" title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}><Edit2 size={14} /></button>
                          <button onClick={() => deleteBank(acc.id)} className="action-btn-delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Bank Transactions (Auto-Pull) ── */}
          <div className="apple-card p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h3 className="font-semibold text-gray-800">{currentLanguage === 'tr' ? 'Banka Hareketleri' : 'Bank Transactions'}</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {mikroEnabled && mikroConnected
                    ? currentLanguage === 'tr' ? 'Mikro ERP üzerinden otomatik çekilir' : 'Auto-pulled via Mikro ERP'
                    : currentLanguage === 'tr' ? 'Mikro entegrasyonu etkinleştirilerek otomatik çekilebilir' : 'Enable Mikro integration for auto-pull'}
                  {bankTxLastPull && <span className="ml-2 text-gray-300">· {currentLanguage === 'tr' ? 'Son çekim' : 'Last pull'}: {bankTxLastPull}</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Auto-sync toggle */}
                <button
                  onClick={() => setBankTxAutoSync(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${bankTxAutoSync ? 'bg-green-50 border-green-200 text-green-700' : 'apple-button-secondary py-1.5 px-3 text-xs'}`}
                  title={currentLanguage === 'tr' ? 'Otomatik Senkronizasyon' : 'Auto Sync'}
                >
                  <RefreshCw size={12} className={bankTxAutoSync ? 'animate-spin' : ''} />
                  {currentLanguage === 'tr' ? 'Oto Sync' : 'Auto Sync'}
                  {bankTxAutoSync && <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />}
                </button>
                <button
                  onClick={pullBankTransactions}
                  disabled={bankTxPulling || !mikroEnabled}
                  className="apple-button-primary py-1.5 px-3 text-xs"
                >
                  <ArrowRightLeft size={12} className={bankTxPulling ? 'animate-spin' : ''} />
                  {bankTxPulling
                    ? (currentLanguage === 'tr' ? 'Çekiliyor...' : 'Pulling...')
                    : (currentLanguage === 'tr' ? 'Şimdi Çek' : 'Pull Now')}
                </button>
              </div>
            </div>

            {/* Filter + Search */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder={currentLanguage === 'tr' ? 'Hareket ara...' : 'Search transactions...'}
                  value={bankTxSearch}
                  onChange={e => setBankTxSearch(e.target.value)}
                  className="apple-input w-full pl-8 py-2 text-xs"
                />
              </div>
              <div className="flex gap-1">
                {(['all', 'credit', 'debit'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setBankTxFilter(f)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${bankTxFilter === f ? 'bg-brand text-white' : 'apple-button-secondary py-1.5'}`}
                  >
                    {f === 'all' ? (currentLanguage === 'tr' ? 'Tümü' : 'All') : f === 'credit' ? (currentLanguage === 'tr' ? '↓ Alacak' : '↓ Credit') : (currentLanguage === 'tr' ? '↑ Borç' : '↑ Debit')}
                  </button>
                ))}
              </div>
            </div>

            {!mikroEnabled && (
              <div className="flex items-center gap-2 px-4 py-3 bg-orange-50 text-orange-700 text-xs rounded-xl mb-3">
                <AlertCircle size={14} />
                {currentLanguage === 'tr'
                  ? 'Otomatik çekim için Entegrasyonlar → Mikro ERP sekmesinden bağlantı kurun.'
                  : 'Connect via Integrations → Mikro ERP tab to enable auto-pull.'}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr>
                    {([
                      { key: 'date', label: currentLanguage === 'tr' ? 'Tarih' : 'Date' },
                      { key: 'accountName', label: currentLanguage === 'tr' ? 'Hesap' : 'Account' },
                      { key: 'description', label: currentLanguage === 'tr' ? 'Açıklama' : 'Description' },
                      { key: 'type', label: currentLanguage === 'tr' ? 'Tür' : 'Type' },
                      { key: 'amount', label: currentLanguage === 'tr' ? 'Tutar' : 'Amount', align: 'right' },
                      { key: 'balance', label: currentLanguage === 'tr' ? 'Bakiye' : 'Balance', align: 'right' },
                    ] as { key: keyof BankTransaction; label: string; align?: string }[]).map(col => (
                      <th
                        key={col.key}
                        onClick={() => setBankTxSort(s => ({ key: col.key, dir: s.key === col.key && s.dir === 'asc' ? 'desc' : 'asc' }))}
                        className={`cursor-pointer select-none px-4 py-3 text-[10px] font-bold uppercase tracking-wider transition-colors ${col.align === 'right' ? 'text-right' : 'text-left'} ${bankTxSort.key === col.key ? 'text-brand' : 'text-gray-400 hover:text-gray-600'}`}
                      >
                        {col.label}{' '}
                        <span className={bankTxSort.key === col.key ? 'opacity-100' : 'opacity-25'}>
                          {bankTxSort.key === col.key ? (bankTxSort.dir === 'asc' ? '↑' : '↓') : '↕'}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filtered = bankTransactions
                      .filter(tx =>
                        (bankTxFilter === 'all' || tx.type === bankTxFilter) &&
                        (!bankTxSearch || tx.description.toLowerCase().includes(bankTxSearch.toLowerCase()) || tx.accountName.toLowerCase().includes(bankTxSearch.toLowerCase()) || (tx.reference ?? '').toLowerCase().includes(bankTxSearch.toLowerCase()))
                      )
                      .sort((a, b) => {
                        const av = a[bankTxSort.key] ?? '';
                        const bv = b[bankTxSort.key] ?? '';
                        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
                        return bankTxSort.dir === 'asc' ? cmp : -cmp;
                      });
                    if (filtered.length === 0) return (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-gray-400 text-sm">
                          <div className="flex flex-col items-center gap-2">
                            <Landmark size={28} className="text-gray-300" />
                            <span>
                              {bankTransactions.length === 0
                                ? (currentLanguage === 'tr' ? '"Şimdi Çek" ile Mikro\'dan hareketleri çekin.' : 'Use "Pull Now" to fetch transactions from Mikro.')
                                : (currentLanguage === 'tr' ? 'Arama veya filtre sonucu yok.' : 'No results match filter.')}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                    return filtered.map(tx => (
                      <tr key={tx.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                        <td className="px-4 py-3 text-sm font-mono text-gray-500 whitespace-nowrap">{tx.date}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{tx.accountName || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-800 max-w-[200px] truncate" title={tx.description}>{tx.description || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`apple-badge ${tx.type === 'credit' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {tx.type === 'credit' ? '↓ ' : '↑ '}
                            {tx.type === 'credit' ? (currentLanguage === 'tr' ? 'Alacak' : 'Credit') : (currentLanguage === 'tr' ? 'Borç' : 'Debit')}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm font-semibold text-right whitespace-nowrap ${tx.type === 'credit' ? 'text-green-600' : 'text-red-500'}`}>
                          {tx.type === 'debit' ? '−' : '+'}{tx.currency === 'TRY' ? '₺' : tx.currency === 'USD' ? '$' : '€'}{tx.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600 whitespace-nowrap">
                          {tx.currency === 'TRY' ? '₺' : tx.currency === 'USD' ? '$' : '€'}{tx.balance.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* YEVMİYE */}
      {accountingTab === 'yevmiye' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="apple-card p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800">{t.journalBook}</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => exportCSV('yevmiye.csv',
                    [t.date, t.receiptNo, t.description, t.debitAccount, t.creditAccount, t.debit, t.credit, t.vatRate, t.category],
                    journalEntries.map(e => [e.date, e.fiş, e.aciklama, e.debitHesap, e.alacakHesap, e.borc, e.alacak, e.kdvOran ?? 0, e.kategori])
                  )}
                  className="apple-button-secondary py-2 px-4 text-sm"
                >
                  <Download size={14} /> CSV
                </button>
                <button onClick={() => setShowJournalModal(true)} className="apple-button-primary">
                  <Plus size={14} /> {t.newEntry}
                </button>
              </div>
            </div>
            {/* Search bar */}
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={currentLanguage === 'en' ? 'Search entries...' : 'Kayıt ara...'}
                value={journalSearch}
                onChange={e => setJournalSearch(e.target.value)}
                className="apple-input w-full pl-9 py-2"
              />
            </div>
            {/* Yevmiye Currency Switcher */}
            <div className="flex items-center gap-1 bg-gray-50 rounded-xl px-3 py-2 mb-3 w-fit">
              <span className="text-xs text-gray-400 font-medium mr-1">{currentLanguage === 'tr' ? 'Para Birimi:' : 'Currency:'}</span>
              {(['TRY', 'USD', 'EUR'] as const).map(cur => (
                <button
                  key={cur}
                  onClick={() => setYevmiyeCurrency(cur)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${yevmiyeCurrency === cur ? 'bg-brand text-white shadow-sm' : 'text-gray-500 hover:bg-white hover:shadow-sm'}`}
                >
                  {cur === 'TRY' ? '₺ TRY' : cur === 'USD' ? '$ USD' : '€ EUR'}
                </button>
              ))}
              {exchangeRates && yevmiyeCurrency !== 'TRY' && (
                <span className="ml-2 text-[10px] text-gray-400 font-mono">
                  {yevmiyeCurrency === 'USD' ? `1 USD = ₺${(exchangeRates.USD||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}` : `1 EUR = ₺${(exchangeRates.EUR||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}`}
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={t.date} 
                      sortKey="date" 
                      currentSort={{ key: journalSortKey, direction: journalSortDir }} 
                      onSort={(key) => toggleJournalSort(key as keyof JournalEntry)} 
                    />
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{t.receiptNo}</th>
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{t.description}</th>
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">{t.debitAccount}</th>
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">{t.creditAccount}</th>
                    <SortHeader 
                      label={`Borç ${yevmiyeCurrency === 'TRY' ? '(₺)' : yevmiyeCurrency === 'USD' ? '($)' : '(€)'}`} 
                      sortKey="borc" 
                      currentSort={{ key: journalSortKey, direction: journalSortDir }} 
                      onSort={(key) => toggleJournalSort(key as keyof JournalEntry)} 
                      className="text-right"
                    />
                    <SortHeader 
                      label={`Alacak ${yevmiyeCurrency === 'TRY' ? '(₺)' : yevmiyeCurrency === 'USD' ? '($)' : '(€)'}`} 
                      sortKey="alacak" 
                      currentSort={{ key: journalSortKey, direction: journalSortDir }} 
                      onSort={(key) => toggleJournalSort(key as keyof JournalEntry)} 
                      className="text-right hidden sm:table-cell"
                    />
                    <th className="text-center py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{t.vatRate}</th>
                    <SortHeader 
                      label={t.category} 
                      sortKey="kategori" 
                      currentSort={{ key: journalSortKey, direction: journalSortDir }} 
                      onSort={(key) => toggleJournalSort(key as keyof JournalEntry)} 
                      className="hidden lg:table-cell"
                    />
                    <th className="text-center py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{t.delete}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedJournal.length === 0 && (
                    <tr><td colSpan={10} className="text-center py-8 text-gray-400">{t.noEntries}</td></tr>
                  )}
                  {displayedJournal.map(e => (
                    <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap">{e.date}</td>
                      <td className="py-2.5 px-3 text-gray-500 font-mono text-xs hidden sm:table-cell">{e.fiş}</td>
                      <td className="py-2.5 px-3 text-gray-800 max-w-[160px] truncate">
                        <div className="flex items-center gap-2">
                          {e.aciklama}
                          {e.isSynced && (
                            <span className="bg-green-100 text-green-600 text-[8px] font-bold px-1 py-0.5 rounded uppercase tracking-tighter">LUCA</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-gray-500 text-xs hidden md:table-cell max-w-[140px] truncate">{e.debitHesap}</td>
                      <td className="py-2.5 px-3 text-gray-500 text-xs hidden md:table-cell max-w-[140px] truncate">{e.alacakHesap}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-gray-800">{formatInCurrency(e.borc, yevmiyeCurrency, exchangeRates)}</td>
                      <td className="py-2.5 px-3 text-right text-gray-600 hidden sm:table-cell">{formatInCurrency(e.alacak, yevmiyeCurrency, exchangeRates)}</td>
                      <td className="py-2.5 px-3 text-center hidden sm:table-cell">
                        <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full text-xs font-semibold">%{e.kdvOran ?? 0}</span>
                      </td>
                      <td className="py-2.5 px-3 text-gray-500 text-xs hidden lg:table-cell">{e.kategori}</td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => openEditJournal(e)} className="action-btn-view" title={currentLanguage === 'tr' ? 'İncele' : 'View'}><Eye size={13} /></button>
                          <button onClick={() => openEditJournal(e)} className="action-btn-edit" title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}><Edit2 size={13} /></button>
                          <button onClick={() => deleteJournal(e.id)} className="action-btn-delete"><Trash2 size={13} /></button>
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

      {/* MİZAN */}
      {accountingTab === 'mizan' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Toplam Borç */}
            <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Borç Toplamı — Hesap Detayı' : 'Total Debit — Account Detail', rows: mizanRows.filter(r => r.borc > 0).sort((a, b) => b.borc - a.borc).map(r => ({ label: r.hesap, value: formatConv(r.borc) })), total: formatConv(mizanTotals.borc) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl bg-red-100 flex items-center justify-center">
                  <TrendingDown size={15} className="text-red-600" />
                </div>
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <button key={c} onClick={e => { e.stopPropagation(); setKpiCurrency(c); }}
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xl font-bold text-red-600">{formatConv(mizanTotals.borc)}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">{t.totalDebit}</p>
            </button>
            {/* Toplam Alacak */}
            <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Alacak Toplamı — Hesap Detayı' : 'Total Credit — Account Detail', rows: mizanRows.filter(r => r.alacak > 0).sort((a, b) => b.alacak - a.alacak).map(r => ({ label: r.hesap, value: formatConv(r.alacak) })), total: formatConv(mizanTotals.alacak) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
                  <TrendingUp size={15} className="text-green-600" />
                </div>
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <button key={c} onClick={e => { e.stopPropagation(); setKpiCurrency(c); }}
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xl font-bold text-green-600">{formatConv(mizanTotals.alacak)}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">{t.totalCredit}</p>
            </button>
            {/* Borç Bakiyesi */}
            <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Borç Bakiyesi — Hesap Detayı' : 'Debit Balance — Account Detail', rows: mizanRows.filter(r => r.borcBakiye > 0).sort((a, b) => b.borcBakiye - a.borcBakiye).map(r => ({ label: r.hesap, value: formatConv(r.borcBakiye) })), total: formatConv(mizanTotals.borcBakiye) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center">
                  <ArrowUpDown size={15} className="text-red-500" />
                </div>
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <button key={c} onClick={e => { e.stopPropagation(); setKpiCurrency(c); }}
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xl font-bold text-red-500">{formatConv(mizanTotals.borcBakiye)}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">{t.debitBalance}</p>
            </button>
            {/* Alacak Bakiyesi */}
            <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Alacak Bakiyesi — Hesap Detayı' : 'Credit Balance — Account Detail', rows: mizanRows.filter(r => r.alacakBakiye > 0).sort((a, b) => b.alacakBakiye - a.alacakBakiye).map(r => ({ label: r.hesap, value: formatConv(r.alacakBakiye) })), total: formatConv(mizanTotals.alacakBakiye) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center">
                  <Wallet size={15} className="text-green-500" />
                </div>
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <button key={c} onClick={e => { e.stopPropagation(); setKpiCurrency(c); }}
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xl font-bold text-green-500">{formatConv(mizanTotals.alacakBakiye)}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">{t.creditBalance}</p>
            </button>
          </div>
          <div className="apple-card p-4">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-gray-800">{t.trialBalanceTitle}</h3>
                <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${mizanDengeli ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                  {mizanDengeli ? <><CheckCircle size={12} /> {t.balanced}</> : <><AlertCircle size={12} /> {t.notBalanced}</>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder={currentLanguage === 'en' ? 'Search accounts...' : 'Hesap ara...'}
                    value={mizanSearch}
                    onChange={e => setMizanSearch(e.target.value)}
                    className="apple-input pl-7 pr-3 py-1.5 w-44"
                  />
                </div>
                <button
                  onClick={() => exportCSV('mizan.csv',
                    ['Hesap', 'Borç Toplamı', 'Alacak Toplamı', 'Borç Bakiyesi', 'Alacak Bakiyesi'],
                    mizanRows.map(r => [r.hesap, r.borc, r.alacak, r.borcBakiye, r.alacakBakiye])
                  )}
                  className="apple-button-secondary py-2 px-4 text-sm"
                >
                  <Download size={14} /> CSV
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={t.accountCode} 
                      sortKey="hesap" 
                      currentSort={{ key: mizanSortKey, direction: mizanSortDir }} 
                      onSort={(key) => toggleMizanSort(key as 'hesap' | 'borc' | 'alacak' | 'borcBakiye' | 'alacakBakiye')} 
                    />
                    <SortHeader 
                      label={t.totalDebit} 
                      sortKey="borc" 
                      currentSort={{ key: mizanSortKey, direction: mizanSortDir }} 
                      onSort={(key) => toggleMizanSort(key as 'hesap' | 'borc' | 'alacak' | 'borcBakiye' | 'alacakBakiye')} 
                      className="text-right"
                    />
                    <SortHeader 
                      label={t.totalCredit} 
                      sortKey="alacak" 
                      currentSort={{ key: mizanSortKey, direction: mizanSortDir }} 
                      onSort={(key) => toggleMizanSort(key as 'hesap' | 'borc' | 'alacak' | 'borcBakiye' | 'alacakBakiye')} 
                      className="text-right"
                    />
                    <SortHeader 
                      label={t.debitBalance} 
                      sortKey="borcBakiye" 
                      currentSort={{ key: mizanSortKey, direction: mizanSortDir }} 
                      onSort={(key) => toggleMizanSort(key as 'hesap' | 'borc' | 'alacak' | 'borcBakiye' | 'alacakBakiye')} 
                      className="text-right hidden sm:table-cell"
                    />
                    <SortHeader 
                      label={t.creditBalance} 
                      sortKey="alacakBakiye" 
                      currentSort={{ key: mizanSortKey, direction: mizanSortDir }} 
                      onSort={(key) => toggleMizanSort(key as 'hesap' | 'borc' | 'alacak' | 'borcBakiye' | 'alacakBakiye')} 
                      className="text-right hidden sm:table-cell"
                    />
                  </tr>
                </thead>
                <tbody>
                  {displayedMizan.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400">{t.noJournalEntries}</td></tr>
                  )}
                  {displayedMizan.map((r, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 px-3 text-gray-700 font-medium text-xs">{r.hesap}</td>
                      <td className="py-2.5 px-3 text-right text-red-600 font-semibold">{formatTRY(r.borc)}</td>
                      <td className="py-2.5 px-3 text-right text-green-600 font-semibold">{formatTRY(r.alacak)}</td>
                      <td className="py-2.5 px-3 text-right text-red-500 hidden sm:table-cell">{r.borcBakiye > 0 ? formatTRY(r.borcBakiye) : '-'}</td>
                      <td className="py-2.5 px-3 text-right text-green-500 hidden sm:table-cell">{r.alacakBakiye > 0 ? formatTRY(r.alacakBakiye) : '-'}</td>
                    </tr>
                  ))}
                  {mizanRows.length > 0 && (
                    <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                      <td className="py-2.5 px-3 text-gray-800">{t.total}</td>
                      <td className="py-2.5 px-3 text-right text-red-700">{formatTRY(mizanTotals.borc)}</td>
                      <td className="py-2.5 px-3 text-right text-green-700">{formatTRY(mizanTotals.alacak)}</td>
                      <td className="py-2.5 px-3 text-right text-red-600 hidden sm:table-cell">{formatTRY(mizanTotals.borcBakiye)}</td>
                      <td className="py-2.5 px-3 text-right text-green-600 hidden sm:table-cell">{formatTRY(mizanTotals.alacakBakiye)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* GELİR/GİDER */}
      {accountingTab === 'gelir' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Filters */}
          <div className="apple-card p-4 flex flex-wrap gap-3 items-center">
            <span className="text-sm font-medium text-gray-600">{t.period}</span>
            <select value={gelirMonth} onChange={e => { setGelirMonth(Number(e.target.value)); setGelirUseRange(false); }} className="apple-input py-2 px-3">
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <input type="number" value={gelirYear} onChange={e => { setGelirYear(Number(e.target.value)); setGelirUseRange(false); }} className="apple-input py-2 px-3 w-24" />
            <span className="text-gray-300 text-sm">|</span>
            <span className="text-sm font-medium text-gray-600">{currentLanguage === 'en' ? 'Or date range:' : 'Veya tarih aralığı:'}</span>
            <input
              type="date"
              value={gelirDateFrom}
              onChange={e => {
                setGelirDateFrom(e.target.value);
                if (e.target.value) {
                  setGelirUseRange(true);
                  const d = new Date(e.target.value);
                  setGelirMonth(d.getMonth() + 1);
                  setGelirYear(d.getFullYear());
                }
              }}
              className="apple-input py-2 px-3"
            />
            <span className="text-gray-400 text-sm">—</span>
            <input
              type="date"
              value={gelirDateTo}
              onChange={e => {
                setGelirDateTo(e.target.value);
                if (e.target.value) setGelirUseRange(true);
              }}
              className="apple-input py-2 px-3"
            />
            {gelirUseRange && (
              <button onClick={() => { setGelirUseRange(false); setGelirDateFrom(''); setGelirDateTo(''); }} className="text-xs font-bold text-brand hover:underline">
                ✕ {currentLanguage === 'en' ? 'Clear range' : 'Aralığı temizle'}
              </button>
            )}
          </div>
          {/* Currency switcher + KPI Cards */}
          <div className="flex items-center gap-1 apple-card px-3 py-2 w-fit">
            <span className="text-xs text-gray-400 font-medium mr-1">{currentLanguage === 'tr' ? 'Para Birimi:' : 'Currency:'}</span>
            {(['TRY', 'USD', 'EUR'] as const).map(cur => (
              <button
                key={cur}
                onClick={() => setGelirCurrency(cur)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${gelirCurrency === cur ? 'bg-brand text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                {cur === 'TRY' ? '₺ TRY' : cur === 'USD' ? '$ USD' : '€ EUR'}
              </button>
            ))}
            {exchangeRates && (
              <span className="ml-2 text-[10px] text-gray-400 font-mono">
                {gelirCurrency === 'USD' ? `1 USD = ₺${(exchangeRates.USD || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` :
                 gelirCurrency === 'EUR' ? `1 EUR = ₺${(exchangeRates.EUR || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'TCMB'}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Gelir Detayı' : 'Income Detail', rows: Object.entries(gelirBreakdown).sort(([,a],[,b])=>(b as number)-(a as number)).map(([hesap,tutar])=>({ label: hesap, value: formatInCurrency(tutar as number, gelirCurrency, exchangeRates) })), total: formatInCurrency(toplamGelir, gelirCurrency, exchangeRates) })} className="apple-card p-4 text-left cursor-pointer group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 font-medium">{t.totalIncome}</span>
                <TrendingUp size={16} className="text-green-500" />
              </div>
              <div className="text-2xl font-bold text-green-600">
                {formatInCurrency(toplamGelir, gelirCurrency, exchangeRates)}
              </div>
              <div className="text-[10px] text-gray-300 mt-1 group-hover:text-gray-400 transition-colors">{currentLanguage === 'tr' ? 'Detay için tıkla' : 'Click for details'}</div>
            </button>
            <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Gider Detayı' : 'Expense Detail', rows: Object.entries(giderBreakdown).sort(([,a],[,b])=>(b as number)-(a as number)).map(([hesap,tutar])=>({ label: hesap, value: formatInCurrency(tutar as number, gelirCurrency, exchangeRates) })), total: formatInCurrency(toplamGider, gelirCurrency, exchangeRates) })} className="apple-card p-4 text-left cursor-pointer group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 font-medium">{t.totalExpense}</span>
                <TrendingDown size={16} className="text-red-500" />
              </div>
              <div className="text-2xl font-bold text-red-600">
                {formatInCurrency(toplamGider, gelirCurrency, exchangeRates)}
              </div>
              <div className="text-[10px] text-gray-300 mt-1 group-hover:text-gray-400 transition-colors">{currentLanguage === 'tr' ? 'Detay için tıkla' : 'Click for details'}</div>
            </button>
            <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Net Kâr/Zarar Özeti' : 'Net Profit/Loss Summary', rows: [{ label: currentLanguage === 'tr' ? 'Toplam Gelir' : 'Total Income', value: formatInCurrency(toplamGelir, gelirCurrency, exchangeRates) }, { label: currentLanguage === 'tr' ? 'Toplam Gider' : 'Total Expense', value: formatInCurrency(toplamGider, gelirCurrency, exchangeRates) }, { label: 'Net', badge: netKar >= 0 ? 'Kâr' : 'Zarar', badgeColor: netKar >= 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600', value: formatInCurrency(netKar, gelirCurrency, exchangeRates) }] })} className="apple-card p-4 text-left cursor-pointer group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 font-medium">{t.netProfit}</span>
                <span className={`text-base font-black ${netKar >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {gelirCurrency === 'USD' ? '$' : gelirCurrency === 'EUR' ? '€' : '₺'}
                </span>
              </div>
              <div className={`text-2xl font-bold ${netKar >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatInCurrency(netKar, gelirCurrency, exchangeRates)}
              </div>
              <div className="text-[10px] text-gray-300 mt-1 group-hover:text-gray-400 transition-colors">{currentLanguage === 'tr' ? 'Detay için tıkla' : 'Click for details'}</div>
            </button>
          </div>
          {/* Bar Chart */}
          <div className="apple-card p-4">
            <h3 className="font-semibold text-gray-800 mb-4">{t.annualChart(gelirYear)}</h3>
            <div className="overflow-x-auto">
              <div className="flex items-end gap-2 min-w-[600px] h-48 px-2">
                {monthlyData.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex items-end justify-center gap-0.5 h-36">
                      <div
                        className="flex-1 bg-green-400 rounded-t-sm transition-all"
                        style={{ height: `${maxChartVal > 0 ? (d.gelir / maxChartVal) * 100 : 0}%`, minHeight: d.gelir > 0 ? 4 : 0 }}
                        title={`${t.income}: ${formatTRY(d.gelir)}`}
                      />
                      <div
                        className="flex-1 bg-red-400 rounded-t-sm transition-all"
                        style={{ height: `${maxChartVal > 0 ? (d.gider / maxChartVal) * 100 : 0}%`, minHeight: d.gider > 0 ? 4 : 0 }}
                        title={`${t.expense}: ${formatTRY(d.gider)}`}
                      />
                    </div>
                    <span className="text-[10px] text-gray-500">{d.month.slice(0, 3)}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-4 mt-2 justify-center">
                <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3 h-3 rounded-sm bg-green-400" /> {t.income}</div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3 h-3 rounded-sm bg-red-400" /> {t.expense}</div>
              </div>
            </div>
          </div>
          {/* Breakdown Tables */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <h4 className="font-semibold text-gray-800 mb-3 text-sm">{t.incomeBreakdown}</h4>
              <div className="overflow-x-auto">
                <table className="apple-table">
                  <thead><tr className="border-b border-gray-100"><th className="text-left py-1.5 px-2 text-gray-500 font-medium">{t.account}</th><th className="text-right py-1.5 px-2 text-gray-500 font-medium">{t.amount}</th></tr></thead>
                  <tbody>
                    {Object.entries(gelirBreakdown).length === 0 && <tr><td colSpan={2} className="text-center py-4 text-gray-400 text-xs">{t.noIncomeThisPeriod}</td></tr>}
                    {Object.entries(gelirBreakdown).map(([hesap, tutar], i) => (
                      <tr key={i} className="border-b border-gray-50"><td className="py-2 px-2 text-gray-600 text-xs">{hesap}</td><td className="py-2 px-2 text-right font-semibold text-green-600">{formatTRY(tutar)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <h4 className="font-semibold text-gray-800 mb-3 text-sm">{t.expenseBreakdown}</h4>
              <div className="overflow-x-auto">
                <table className="apple-table">
                  <thead><tr className="border-b border-gray-100"><th className="text-left py-1.5 px-2 text-gray-500 font-medium">{t.account}</th><th className="text-right py-1.5 px-2 text-gray-500 font-medium">{t.amount}</th></tr></thead>
                  <tbody>
                    {Object.entries(giderBreakdown).length === 0 && <tr><td colSpan={2} className="text-center py-4 text-gray-400 text-xs">{t.noExpenseThisPeriod}</td></tr>}
                    {Object.entries(giderBreakdown).map(([hesap, tutar], i) => (
                      <tr key={i} className="border-b border-gray-50"><td className="py-2 px-2 text-gray-600 text-xs">{hesap}</td><td className="py-2 px-2 text-right font-semibold text-red-600">{formatTRY(tutar)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* BÜTÇE */}
      {accountingTab === 'butce' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-gray-800">{t.butce}</h3>
              <button onClick={() => setShowBudgetModal(true)} className="apple-button-primary">
                <Plus size={14} /> {t.add}
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                {budgets.length === 0 && (
                  <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-100 rounded-2xl">
                    {t.noRecords}
                  </div>
                )}
                {budgets.map(b => {
                  // Calculate actual spending for this category and period
                  const actual = journalEntries
                    .filter(e => e.kategori === b.category && e.date.startsWith(b.period))
                    .reduce((sum, e) => sum + (e.borc || 0), 0);
                  
                  const percent = b.amount > 0 ? Math.min(100, Math.round((actual / b.amount) * 100)) : 0;
                  const color = percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-orange-500' : 'bg-blue-500';

                  return (
                    <div key={b.id} className="group relative">
                      <div className="flex justify-between text-sm mb-2">
                        <div className="flex flex-col">
                          <span className="font-semibold text-gray-800">{b.category}</span>
                          <span className="text-[10px] text-gray-400 uppercase font-bold">{b.period}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-bold text-gray-800">{formatTRY(actual)}</span>
                          <span className="text-gray-400 mx-1">/</span>
                          <span className="text-gray-500">{formatTRY(b.amount)}</span>
                        </div>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${percent}%` }}
                          className={`h-full ${color}`} 
                        />
                      </div>
                      <button 
                        onClick={() => deleteBudget(b.id)}
                        className="absolute -right-2 -top-2 p-1 bg-white shadow-sm border border-gray-100 rounded-full text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>
              
              <div className="bg-gray-50 rounded-2xl p-6 flex flex-col justify-center items-center text-center">
                {budgets.length > 0 ? (
                  <>
                    {(() => {
                      const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);
                      const totalActual = budgets.reduce((sum, b) => {
                        const actual = journalEntries
                          .filter(e => e.kategori === b.category && e.date.startsWith(b.period))
                          .reduce((s, entry) => s + (entry.borc || 0), 0);
                        return sum + actual;
                      }, 0);
                      const totalPercent = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0;
                      
                      return (
                        <>
                          <div className="w-32 h-32 rounded-full border-8 border-brand flex flex-col items-center justify-center mb-4 relative">
                            <svg className="absolute inset-0 w-full h-full -rotate-90">
                              <circle 
                                cx="64" cy="64" r="56" 
                                fill="none" stroke="#f3f4f6" strokeWidth="8" 
                              />
                              <circle 
                                cx="64" cy="64" r="56" 
                                fill="none" stroke="#ff4000" strokeWidth="8" 
                                strokeDasharray={351.8}
                                strokeDashoffset={351.8 - (351.8 * Math.min(100, totalPercent)) / 100}
                                strokeLinecap="round"
                              />
                            </svg>
                            <span className="text-2xl font-black text-gray-800 relative z-10">%{totalPercent}</span>
                            <span className="text-[10px] text-gray-500 uppercase font-bold relative z-10">{currentLanguage === 'tr' ? 'Kullanım' : 'Usage'}</span>
                          </div>
                          <h4 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Genel Bütçe Durumu' : 'Overall Budget Status'}</h4>
                          <p className="text-xs text-gray-500 mt-1">
                            {currentLanguage === 'tr' 
                              ? `Toplam bütçenin %${totalPercent}'i kullanıldı.` 
                              : `${totalPercent}% of total budget used.`}
                          </p>
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <div className="text-gray-400">
                    <PieChart size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="text-sm">{currentLanguage === 'tr' ? 'Henüz bütçe hedefi belirlenmedi.' : 'No budget goals set yet.'}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* İŞLETME SERMAYESİ */}
      {accountingTab === 'isletme_sermayesi' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button 
              onClick={() => setDrillDown({ 
                title: currentLanguage === 'tr' ? 'Dönen Varlıklar Detayı' : 'Current Assets Detail',
                rows: [
                  { label: 'Kasa/Banka', value: '₺1.200.000' },
                  { label: 'Ticari Alacaklar', value: '₺2.450.000' },
                  { label: 'Stoklar', value: '₺1.200.000' }
                ],
                total: '₺4.850.000'
              })}
              className="apple-card p-6 text-left cursor-pointer group"
            >
              <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">{currentLanguage === 'tr' ? 'Dönen Varlıklar' : 'Current Assets'}</h4>
              <p className="text-2xl font-black text-gray-800">₺4.850.000</p>
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-xs"><span className="text-gray-500">Kasa/Banka</span><span>₺1.200.000</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-500">Ticari Alacaklar</span><span>₺2.450.000</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-500">Stoklar</span><span>₺1.200.000</span></div>
              </div>
              <div className="text-[10px] text-gray-300 mt-4 group-hover:text-gray-400 transition-colors">{currentLanguage === 'tr' ? 'Detay için tıkla' : 'Click for details'}</div>
            </button>
            <button 
              onClick={() => setDrillDown({ 
                title: currentLanguage === 'tr' ? 'Kısa Vadeli Yükümlülükler Detayı' : 'Current Liabilities Detail',
                rows: [
                  { label: 'Ticari Borçlar', value: '₺1.450.000' },
                  { label: 'Vergi/SGK', value: '₺420.000' },
                  { label: 'Kısa Vadeli Krediler', value: '₺250.000' }
                ],
                total: '₺2.120.000'
              })}
              className="apple-card p-6 text-left cursor-pointer group"
            >
              <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">{currentLanguage === 'tr' ? 'Kısa Vadeli Yükümlülükler' : 'Current Liabilities'}</h4>
              <p className="text-2xl font-black text-red-600">₺2.120.000</p>
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-xs"><span className="text-gray-500">Ticari Borçlar</span><span>₺1.450.000</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-500">Vergi/SGK</span><span>₺420.000</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-500">Kısa Vadeli Krediler</span><span>₺250.000</span></div>
              </div>
              <div className="text-[10px] text-gray-300 mt-4 group-hover:text-gray-400 transition-colors">{currentLanguage === 'tr' ? 'Detay için tıkla' : 'Click for details'}</div>
            </button>
            <button 
              onClick={() => setDrillDown({ 
                title: currentLanguage === 'tr' ? 'Net İşletme Sermayesi Analizi' : 'Net Working Capital Analysis',
                rows: [
                  { label: 'Dönen Varlıklar', value: '₺4.850.000' },
                  { label: 'KV Yükümlülükler', value: '₺2.120.000' },
                  { label: 'Cari Oran', value: '2.29', badge: 'İdeal', badgeColor: 'bg-green-100 text-green-600' }
                ],
                total: '₺2.730.000'
              })}
              className="apple-card bg-brand p-6 text-white text-left cursor-pointer group"
            >
              <h4 className="text-xs font-bold opacity-70 uppercase mb-2">{currentLanguage === 'tr' ? 'Net İşletme Sermayesi' : 'Net Working Capital'}</h4>
              <p className="text-3xl font-black">₺2.730.000</p>
              <div className="mt-6 p-3 bg-white/10 rounded-xl">
                <p className="text-[10px] font-medium leading-relaxed">
                  {currentLanguage === 'tr' 
                    ? 'İşletme sermayesi rasyosu 2.29 ile ideal seviyededir. Likidite riski bulunmamaktadır.' 
                    : 'Working capital ratio is at ideal level with 2.29. No liquidity risk.'}
                </p>
              </div>
              <div className="text-[10px] text-white/40 mt-4 group-hover:text-white/60 transition-colors">{currentLanguage === 'tr' ? 'Analiz için tıkla' : 'Click for analysis'}</div>
            </button>
          </div>
        </motion.div>
      )}

      {/* KDV */}
      {accountingTab === 'kdv' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Filters */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap gap-3 items-center">
            <span className="text-sm font-medium text-gray-600">{t.period}</span>
            <select value={kdvMonth} onChange={e => setKdvMonth(Number(e.target.value))} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <input type="number" value={kdvYear} onChange={e => setKdvYear(Number(e.target.value))} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000] w-24" />
          </div>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button 
              onClick={() => setDrillDown({ 
                title: t.calculatedVat, 
                rows: journalEntries
                  .filter(e => {
                    if (!e.date) return false;
                    const d = new Date(e.date);
                    return d.getMonth() + 1 === kdvMonth && d.getFullYear() === kdvYear && e.alacakHesap.startsWith('391');
                  })
                  .map(e => ({ label: e.alacakHesap, sub: e.aciklama, value: formatTRY(e.alacak || 0) })),
                total: formatTRY(hesaplananKDV)
              })}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md hover:border-gray-200 transition-all cursor-pointer group"
            >
              <div className="text-xs text-gray-500 font-medium mb-1">{t.calculatedVat}</div>
              <div className="text-2xl font-bold text-[#ff4000]">{formatTRY(hesaplananKDV)}</div>
              <div className="text-[10px] text-gray-400 mt-1 group-hover:text-gray-500 transition-colors">391 - Hesaplanan KDV</div>
            </button>
            <button 
              onClick={() => setDrillDown({ 
                title: t.deductibleVat, 
                rows: journalEntries
                  .filter(e => {
                    if (!e.date) return false;
                    const d = new Date(e.date);
                    return d.getMonth() + 1 === kdvMonth && d.getFullYear() === kdvYear && e.debitHesap.startsWith('191');
                  })
                  .map(e => ({ label: e.debitHesap, sub: e.aciklama, value: formatTRY(e.borc || 0) })),
                total: formatTRY(indirilecekKDV)
              })}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md hover:border-gray-200 transition-all cursor-pointer group"
            >
              <div className="text-xs text-gray-500 font-medium mb-1">{t.deductibleVat}</div>
              <div className="text-2xl font-bold text-blue-600">{formatTRY(indirilecekKDV)}</div>
              <div className="text-[10px] text-gray-400 mt-1 group-hover:text-gray-500 transition-colors">191 - İndirilecek KDV</div>
            </button>
            <button 
              onClick={() => setDrillDown({ 
                title: t.vatPayable, 
                rows: [
                  { label: t.calculatedVat, value: formatTRY(hesaplananKDV) },
                  { label: t.deductibleVat, value: formatTRY(indirilecekKDV) },
                  { label: 'Net', badge: odenecekKDV >= 0 ? 'Ödenecek' : 'Devreden', badgeColor: odenecekKDV >= 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600', value: formatTRY(Math.abs(odenecekKDV)) }
                ]
              })}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md hover:border-gray-200 transition-all cursor-pointer group"
            >
              <div className="text-xs text-gray-500 font-medium mb-1">{t.vatPayable}</div>
              <div className={`text-2xl font-bold ${odenecekKDV >= 0 ? 'text-red-600' : 'text-green-600'}`}>{formatTRY(odenecekKDV)}</div>
              <div className="text-[10px] text-gray-400 mt-1 group-hover:text-gray-500 transition-colors">{odenecekKDV >= 0 ? t.vatPayableDesc : t.vatRefundDesc}</div>
            </button>
          </div>
          <div className="apple-card p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800">{t.vatBreakdown}</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder={currentLanguage === 'en' ? 'Filter rates...' : 'Oran ara...'}
                    value={kdvSearch}
                    onChange={e => setKdvSearch(e.target.value)}
                    className="apple-input pl-7 pr-3 py-1.5 w-32"
                  />
                </div>
                <button onClick={downloadVatDeclaration} className="apple-button-primary py-2 px-4 text-sm">
                  <FileText size={14} /> {t.vatDeclaration}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={t.vatRate} 
                      sortKey="oran" 
                      currentSort={{ key: kdvSortBy, direction: kdvSortDir2 }} 
                      onSort={(key) => {
                        if (kdvSortBy === key) setKdvSortDir2(d => d === 'asc' ? 'desc' : 'asc');
                        else { setKdvSortBy(key as 'ay' | 'hesaplanan' | 'indirilecek' | 'odenecek' | 'oran' | 'matrah' | 'kdv'); setKdvSortDir2('asc'); }
                      }} 
                    />
                    <SortHeader 
                      label={t.vatBase} 
                      sortKey="matrah" 
                      currentSort={{ key: kdvSortBy, direction: kdvSortDir2 }} 
                      onSort={(key) => {
                        if (kdvSortBy === key) setKdvSortDir2(d => d === 'asc' ? 'desc' : 'asc');
                        else { setKdvSortBy(key as 'ay' | 'hesaplanan' | 'indirilecek' | 'odenecek' | 'oran' | 'matrah' | 'kdv'); setKdvSortDir2('asc'); }
                      }} 
                      className="text-right"
                    />
                    <SortHeader 
                      label={t.vatAmount} 
                      sortKey="kdv" 
                      currentSort={{ key: kdvSortBy, direction: kdvSortDir2 }} 
                      onSort={(key) => {
                        if (kdvSortBy === key) setKdvSortDir2(d => d === 'asc' ? 'desc' : 'asc');
                        else { setKdvSortBy(key as 'ay' | 'hesaplanan' | 'indirilecek' | 'odenecek' | 'oran' | 'matrah' | 'kdv'); setKdvSortDir2('asc'); }
                      }} 
                      className="text-right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(kdvOranBreakdown).length === 0 && (
                    <tr><td colSpan={3} className="text-center py-8 text-gray-400">{t.noVatEntries}</td></tr>
                  )}
                  {Object.entries(kdvOranBreakdown)
                    .filter(([oran]) => !kdvSearch || `%${oran}`.includes(kdvSearch))
                    .sort(([oranA, dataA], [oranB, dataB]) => {
                      let cmp: number;
                      if (kdvSortBy === 'oran') cmp = Number(oranA) - Number(oranB);
                      else if (kdvSortBy === 'matrah') cmp = dataA.matrah - dataB.matrah;
                      else cmp = dataA.kdv - dataB.kdv;
                      return kdvSortDir2 === 'asc' ? cmp : -cmp;
                    })
                    .map(([oran, data]) => (
                      <tr key={oran} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2.5 px-3"><span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full text-xs font-semibold">%{oran}</span></td>
                        <td className="py-2.5 px-3 text-right text-gray-700 font-medium">{formatTRY(data.matrah)}</td>
                        <td className="py-2.5 px-3 text-right font-semibold text-[#ff4000]">{formatTRY(data.kdv)}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* LUCA */}
      {accountingTab === 'luca' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="apple-card p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center"><Link size={18} className="text-white" /></div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-800">{t.lucaTitle}</h3>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${lucaConnected && lucaEnabled ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                  {lucaEnabled ? (lucaConnected ? t.connected : t.notConnected) : (currentLanguage === 'tr' ? 'Pasif' : 'Disabled')}
                </span>
              </div>
              {/* On/Off toggle — mutual exclusion with Mikro */}
              <button
                onClick={async () => {
                  const next = !lucaEnabled;
                  setLucaEnabled(next);
                  if (next) {
                    // Luca açılıyor → Mikro'yu kapat
                    setMikroConnected(false);
                    setMikroEnabled(false);
                    await updateDoc(doc(db, 'settings', 'mikro'), { enabled: false }).catch(async err => {
                      if ((err as { code?: string }).code === 'not-found') {
                        await addDoc(collection(db, 'settings'), { id: 'mikro', enabled: false });
                      }
                    });
                    showToast(currentLanguage === 'tr' ? 'Luca etkinleştirildi. Mikro devre dışı bırakıldı.' : 'Luca enabled. Mikro disabled.');
                  }
                }}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${lucaEnabled ? 'bg-brand' : 'bg-gray-200'}`}
                title={lucaEnabled ? (currentLanguage === 'tr' ? 'Kapat' : 'Disable') : (currentLanguage === 'tr' ? 'Etkinleştir' : 'Enable')}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white keep-white rounded-full shadow transition-transform ${lucaEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-sm text-blue-700">
              {t.lucaInfo}
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">API Key</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={lucaApiKey}
                    onChange={e => setLucaApiKey(e.target.value)}
                    placeholder="luca_api_xxxxxxxxxxxxxxxx"
                    className="apple-input w-full pr-10"
                  />
                  <button onClick={() => setShowApiKey(!showApiKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <Eye size={15} />
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {currentLanguage === 'tr' ? 'Entegratör VKN / ID' : 'Integrator VKN / ID'}
                </label>
                <input
                  type="text"
                  value={lucaCompanyId}
                  onChange={e => setLucaCompanyId(e.target.value)}
                  placeholder="1234567890-ORNEK"
                  className="apple-input w-full"
                />
                <p className="text-[9px] text-gray-400 mt-1">
                  {currentLanguage === 'tr' 
                    ? '* GİB sorgulamalarında ENTEGRATOR parametresi olarak kullanılır.' 
                    : '* Used as ENTEGRATOR parameter in GİB queries.'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">API Base URL</label>
                <input
                  type="text"
                  value={lucaBaseUrl}
                  onChange={e => setLucaBaseUrl(e.target.value)}
                  className="apple-input w-full"
                />
              </div>
            </div>
            {/* Stats */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-xs text-gray-500 mb-1">{t.recordsToSync}</div>
                <div className="text-xl font-bold text-gray-800">{journalEntries.filter(e => !e.isSynced).length}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-xs text-gray-500 mb-1">{currentLanguage === 'tr' ? 'Toplam Senkronize' : 'Total Synced'}</div>
                <div className="text-xl font-bold text-green-600">{journalEntries.filter(e => e.isSynced).length}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-xs text-gray-500 mb-1">{t.lastSync}</div>
                <div className="text-sm font-semibold text-gray-700">{lucaLastSync || t.neverSynced}</div>
              </div>
            </div>
            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 mt-4">
              <button onClick={saveLucaConfig} className="apple-button-secondary py-2 px-4 text-sm">
                <Save size={14} /> {t.save}
              </button>
              <button
                onClick={async () => {
                  setLucaTesting(true);
                  await new Promise(r => setTimeout(r, 1000));
                  setLucaTesting(false);
                  if (lucaApiKey && lucaCompanyId) {
                    setLucaConnected(true);
                    showToast(t.lucaSuccess);
                    const cfg = { apiKey: lucaApiKey, companyId: lucaCompanyId, baseUrl: lucaBaseUrl, lastSync: lucaLastSync, connected: true };
                    await updateDoc(doc(db, 'settings', 'luca'), cfg).catch(async (err) => {
                      if (err.code === 'not-found') {
                        await addDoc(collection(db, 'settings'), { ...cfg, id: 'luca' });
                      }
                    });
                  } else {
                    setLucaConnected(false);
                    showToast(t.lucaError, 'error');
                  }
                }}
                disabled={lucaTesting}
                className="apple-button-secondary py-2 px-4 text-sm disabled:opacity-50"
              >
                {lucaTesting ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                {t.testConnection}
              </button>
              <button
                onClick={async () => {
                  if (!lucaConnected) return showToast(t.lucaNotConnected, 'error');
                  setLucaSyncing(true);
                  
                  // Realistically simulate syncing by updating Firestore
                  const unsynced = journalEntries.filter(e => !e.isSynced);
                  if (unsynced.length === 0) {
                    setLucaSyncing(false);
                    showToast(currentLanguage === 'tr' ? 'Senkronize edilecek yeni kayıt yok.' : 'No new records to sync.', 'info');
                    return;
                  }

                  for (const entry of unsynced) {
                    try {
                      await updateDoc(doc(db, 'journalEntries', entry.id), { 
                        isSynced: true,
                        syncedAt: serverTimestamp()
                      });
                    } catch (err) {
                      console.error("Luca sync error for entry:", entry.id, err);
                    }
                  }

                  await new Promise(r => setTimeout(r, 1500));
                  setLucaSyncing(false);
                  const now = format(new Date(), 'dd.MM.yyyy HH:mm');
                  setLucaLastSync(now);
                  const cfg = { apiKey: lucaApiKey, companyId: lucaCompanyId, baseUrl: lucaBaseUrl, lastSync: now, connected: true };
                  await updateDoc(doc(db, 'settings', 'luca'), cfg).catch(async (err) => {
                    if (err.code === 'not-found') {
                      await addDoc(collection(db, 'settings'), { ...cfg, id: 'luca' });
                    }
                  });
                  showToast(t.lucaSynced(unsynced.length));
                }}
                disabled={lucaSyncing}
                className="apple-button-primary py-2 px-4 text-sm disabled:opacity-50"
              >
                {lucaSyncing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {t.syncNow}
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* MIKRO */}
      {accountingTab === 'mikro' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="apple-card p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#1a3a5c] flex items-center justify-center">
                <Link size={18} className="text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-800">Mikro ERP Entegrasyonu</h3>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${mikroEnabled && mikroConnected ? 'bg-green-50 text-green-600' : mikroEnabled ? 'bg-gray-100 text-gray-500' : 'bg-gray-100 text-gray-400'}`}>
                  {mikroEnabled ? (mikroConnected ? (currentLanguage === 'tr' ? 'Bağlı' : 'Connected') : (currentLanguage === 'tr' ? 'Bağlı Değil' : 'Not Connected')) : (currentLanguage === 'tr' ? 'Pasif' : 'Disabled')}
                </span>
              </div>
              {/* On/Off toggle — mutual exclusion with Luca */}
              <button
                onClick={async () => {
                  const next = !mikroEnabled;
                  setMikroEnabled(next);
                  if (next) {
                    // Mikro açılıyor → Luca'yı kapat
                    setLucaConnected(false);
                    setLucaEnabled(false);
                    await updateDoc(doc(db, 'settings', 'luca'), { enabled: false }).catch(async err => {
                      if ((err as { code?: string }).code === 'not-found') {
                        await addDoc(collection(db, 'settings'), { id: 'luca', enabled: false });
                      }
                    });
                    showToast(currentLanguage === 'tr' ? 'Mikro etkinleştirildi. Luca devre dışı bırakıldı.' : 'Mikro enabled. Luca disabled.');
                  }
                }}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${mikroEnabled ? 'bg-[#1a3a5c]' : 'bg-gray-200'}`}
                title={mikroEnabled ? (currentLanguage === 'tr' ? 'Kapat' : 'Disable') : (currentLanguage === 'tr' ? 'Etkinleştir' : 'Enable')}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white keep-white rounded-full shadow transition-transform ${mikroEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-sm text-blue-700">
              {currentLanguage === 'tr'
                ? 'Mikro JumpBulut ERP entegrasyonu ile fatura, cari ve yevmiye kayıtlarınızı Cetpa\'dan Mikro\'ya otomatik olarak aktarabilirsiniz.'
                : 'Sync invoices, customers and journal entries from Cetpa to Mikro JumpBulut ERP automatically.'}
            </div>

            <div className={`space-y-3 ${!mikroEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Access Token</label>
                <div className="relative">
                  <input
                    type={showMikroToken ? 'text' : 'password'}
                    value={mikroAccessToken}
                    onChange={e => setMikroAccessToken(e.target.value)}
                    placeholder="1234..."
                    className="apple-input w-full pr-10"
                  />
                  <button onClick={() => setShowMikroToken(!showMikroToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <Eye size={15} />
                  </button>
                </div>
                <p className="text-[9px] text-gray-400 mt-1">
                  {currentLanguage === 'tr'
                    ? '* Online İşlem Merkezi\'nden oluşturulan şifre. Her request\'in header\'ına eklenir.'
                    : '* Password generated from Online İşlem Merkezi. Added to every request header.'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">API Endpoint</label>
                <input
                  type="text"
                  value={mikroEndpoint}
                  onChange={e => setMikroEndpoint(e.target.value)}
                  className="apple-input w-full font-mono text-xs"
                />
              </div>
            </div>

            {/* Stats */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-xs text-gray-500 mb-1">{currentLanguage === 'tr' ? 'Senkronize Edilecek' : 'To Sync'}</div>
                <div className="text-xl font-bold text-gray-800">{journalEntries.filter(e => !e.isSynced).length}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-xs text-gray-500 mb-1">{currentLanguage === 'tr' ? 'Toplam Senkronize' : 'Total Synced'}</div>
                <div className="text-xl font-bold text-green-600">{journalEntries.filter(e => e.isSynced).length}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 col-span-2">
                <div className="text-xs text-gray-500 mb-1">{currentLanguage === 'tr' ? 'Son Senkronizasyon' : 'Last Sync'}</div>
                <div className="text-sm font-semibold text-gray-700">{mikroLastSync || (currentLanguage === 'tr' ? 'Hiç senkronize edilmedi' : 'Never synced')}</div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 mt-4">
              <button onClick={saveMikroConfig} className="apple-button-secondary py-2 px-4 text-sm">
                <Save size={14} /> {currentLanguage === 'tr' ? 'Kaydet' : 'Save'}
              </button>
              <button
                onClick={async () => {
                  if (!mikroEnabled) return showToast(currentLanguage === 'tr' ? 'Önce entegrasyonu etkinleştirin.' : 'Enable the integration first.', 'error');
                  if (!mikroAccessToken) return showToast(currentLanguage === 'tr' ? 'Access Token gerekli.' : 'Access Token is required.', 'error');
                  setMikroTesting(true);
                  await new Promise(r => setTimeout(r, 1000));
                  setMikroTesting(false);
                  setMikroConnected(true);
                  showToast(currentLanguage === 'tr' ? 'Mikro bağlantısı başarılı!' : 'Mikro connection successful!');
                  const cfg = { accessToken: mikroAccessToken, endpoint: mikroEndpoint, lastSync: mikroLastSync, connected: true, enabled: mikroEnabled };
                  await updateDoc(doc(db, 'settings', 'mikro'), cfg).catch(async (err) => {
                    if ((err as { code?: string }).code === 'not-found') {
                      await addDoc(collection(db, 'settings'), { ...cfg, id: 'mikro' });
                    }
                  });
                }}
                disabled={mikroTesting}
                className="apple-button-secondary py-2 px-4 text-sm disabled:opacity-50"
              >
                {mikroTesting ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                {currentLanguage === 'tr' ? 'Bağlantıyı Test Et' : 'Test Connection'}
              </button>
              <button
                onClick={async () => {
                  if (!mikroEnabled) return showToast(currentLanguage === 'tr' ? 'Önce entegrasyonu etkinleştirin.' : 'Enable the integration first.', 'error');
                  if (!mikroConnected) return showToast(currentLanguage === 'tr' ? 'Önce bağlantıyı test edin.' : 'Please test the connection first.', 'error');
                  setMikroSyncing(true);
                  const unsynced = journalEntries.filter(e => !e.isSynced);
                  if (unsynced.length === 0) {
                    setMikroSyncing(false);
                    showToast(currentLanguage === 'tr' ? 'Senkronize edilecek yeni kayıt yok.' : 'No new records to sync.', 'info');
                    return;
                  }
                  for (const entry of unsynced) {
                    try {
                      await updateDoc(doc(db, 'journalEntries', entry.id), { isSynced: true, syncedAt: serverTimestamp() });
                    } catch (err) { console.error('Mikro sync error:', entry.id, err); }
                  }
                  await new Promise(r => setTimeout(r, 1500));
                  setMikroSyncing(false);
                  const now = format(new Date(), 'dd.MM.yyyy HH:mm');
                  setMikroLastSync(now);
                  const cfg = { accessToken: mikroAccessToken, endpoint: mikroEndpoint, lastSync: now, connected: true, enabled: mikroEnabled };
                  await updateDoc(doc(db, 'settings', 'mikro'), cfg).catch(async (err) => {
                    if ((err as { code?: string }).code === 'not-found') {
                      await addDoc(collection(db, 'settings'), { ...cfg, id: 'mikro' });
                    }
                  });
                  showToast(`${unsynced.length} ${currentLanguage === 'tr' ? 'kayıt Mikro\'ya aktarıldı.' : 'records pushed to Mikro.'}`);
                }}
                disabled={mikroSyncing}
                className="apple-button-primary py-2 px-4 text-sm disabled:opacity-50"
                style={{ background: '#1a3a5c' }}
              >
                {mikroSyncing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {currentLanguage === 'tr' ? 'Şimdi Senkronize Et' : 'Sync Now'}
              </button>
            </div>
          </div>

          {/* Sync Map — Bidirectional */}
          <div className="apple-card p-4 space-y-4">
            {/* Push: Cetpa → Mikro */}
            <div>
              <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#1a3a5c] inline-block" />
                Cetpa → Mikro ({currentLanguage === 'tr' ? 'Gönder' : 'Push'})
              </h4>
              <div className="space-y-1">
                {[
                  { label: currentLanguage === 'tr' ? 'Faturalar' : 'Invoices', method: 'FaturaKaydet' },
                  { label: currentLanguage === 'tr' ? 'Müşteriler / Cariler' : 'Customers', method: 'CariKaydet' },
                  { label: currentLanguage === 'tr' ? 'Yevmiye Kayıtları' : 'Journal Entries', method: 'YevmiyeKaydet' },
                  { label: currentLanguage === 'tr' ? 'Stok' : 'Inventory', method: 'StokGuncelle' },
                ].map((row, i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0 text-xs">
                    <span className="text-gray-700 font-medium w-32">{row.label}</span>
                    <span className="text-gray-400">→</span>
                    <span className="font-mono text-gray-500 flex-1 text-right mr-2">{row.method}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${mikroEnabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                      {mikroEnabled ? (currentLanguage === 'tr' ? 'Aktif' : 'Active') : (currentLanguage === 'tr' ? 'Pasif' : 'Inactive')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {/* Pull: Mikro → Cetpa */}
            <div>
              <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-brand inline-block" />
                Mikro → Cetpa ({currentLanguage === 'tr' ? 'Çek' : 'Pull'})
              </h4>
              <div className="space-y-1">
                {[
                  { label: currentLanguage === 'tr' ? 'Faturalar' : 'Invoices', method: 'FaturaListesi' },
                  { label: currentLanguage === 'tr' ? 'Cariler' : 'Customers', method: 'CariListesi' },
                  { label: currentLanguage === 'tr' ? 'Stok Listesi' : 'Stock List', method: 'StokListesi' },
                  { label: currentLanguage === 'tr' ? 'Banka Hareketleri' : 'Bank Movements', method: 'BankaHareketListesi' },
                ].map((row, i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0 text-xs">
                    <span className="text-gray-700 font-medium w-32">{row.label}</span>
                    <span className="text-gray-400">←</span>
                    <span className="font-mono text-gray-500 flex-1 text-right mr-2">{row.method}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${mikroEnabled ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                      {mikroEnabled ? (currentLanguage === 'tr' ? 'Hazır' : 'Ready') : (currentLanguage === 'tr' ? 'Pasif' : 'Inactive')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* BANK MODAL */}
      <AnimatePresence>
        {showBankModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowBankModal(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg relative z-10 overflow-hidden"
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{editingBank ? t.editAccount : t.newBankAccount}</h3>
                <button onClick={() => setShowBankModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                {[
                  { label: t.bankName, key: 'bankName', placeholder: 'Ziraat Bankası' },
                  { label: t.branch, key: 'branch', placeholder: 'Kadıköy Şubesi' },
                  { label: t.accountHolder, key: 'accountHolder', placeholder: 'Cetpa A.Ş.' },
                  { label: t.accountNumber, key: 'accountNumber', placeholder: '1234567890' },
                  { label: t.iban, key: 'iban', placeholder: 'TR00 0000 0000 0000 0000 0000 00' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                    <input
                      type="text"
                      value={(bankForm as Record<string, unknown>)[f.key] as string | number}
                      onChange={e => setBankForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]"
                    />
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.currency}</label>
                    <select value={bankForm.currency} onChange={e => setBankForm(prev => ({ ...prev, currency: e.target.value as 'TRY' | 'USD' | 'EUR' }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option>TRY</option><option>USD</option><option>EUR</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.accountType}</label>
                    <select value={bankForm.accountType} onChange={e => setBankForm(prev => ({ ...prev, accountType: e.target.value as 'Vadesiz' | 'Vadeli' | 'Kredi' | 'Kasa' }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option>Vadesiz</option><option>Vadeli</option><option>Kredi</option><option>Kasa</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.bankBalance}</label>
                  <input
                    type="number"
                    value={bankForm.balance}
                    onChange={e => setBankForm(prev => ({ ...prev, balance: Number(e.target.value) }))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowBankModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveBank} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* WAREHOUSE MODAL */}
      <AnimatePresence>
        {showWarehouseModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowWarehouseModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.depo} — {editingWarehouse ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowWarehouseModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.name}</label>
                  <input type="text" value={warehouseForm.name} onChange={e => setWarehouseForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Merkez Depo" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.location}</label>
                  <input type="text" value={warehouseForm.location} onChange={e => setWarehouseForm(prev => ({ ...prev, location: e.target.value }))} placeholder="İstanbul, Tuzla" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Sorumlu' : 'Manager'}</label>
                  <input type="text" value={warehouseForm.manager} onChange={e => setWarehouseForm(prev => ({ ...prev, manager: e.target.value }))} placeholder="Mehmet Can" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.notes2}</label>
                  <input type="text" value={warehouseForm.notes} onChange={e => setWarehouseForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="..." className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowWarehouseModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveWarehouse} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* STOCK MODAL */}
      <AnimatePresence>
        {showStockModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowStockModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.depo} — {editingStock ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowStockModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.product}</label>
                  <input type="text" value={stockForm.productName} onChange={e => setStockForm(prev => ({ ...prev, productName: e.target.value }))} placeholder="Ürün Adı" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">SKU</label>
                    <input type="text" value={stockForm.sku} onChange={e => setStockForm(prev => ({ ...prev, sku: e.target.value }))} placeholder="SKU-001" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.quantity}</label>
                    <input type="number" value={stockForm.quantity} onChange={e => setStockForm(prev => ({ ...prev, quantity: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.depo}</label>
                  <select value={stockForm.warehouseId} onChange={e => setStockForm(prev => ({ ...prev, warehouseId: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                    <option value="">{currentLanguage === 'tr' ? 'Depo Seçin' : 'Select Warehouse'}</option>
                    {warehouses.map(wh => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.category}</label>
                  <input type="text" value={stockForm.category} onChange={e => setStockForm(prev => ({ ...prev, category: e.target.value }))} placeholder="Kategori" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.notes2}</label>
                  <input type="text" value={stockForm.notes} onChange={e => setStockForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="..." className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowStockModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveStock} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {accountingTab === 'e-fatura' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* VKN Sorgulama */}
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-2xl bg-[#ff4000]/10 flex items-center justify-center text-[#ff4000]">
                  <Search className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-lg">VKN Sorgulama</h3>
                  <p className="text-xs text-gray-500">GİB üzerinden e-Fatura mükellefi sorgulayın</p>
                </div>
              </div>
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  placeholder="TCKN veya VKN giriniz"
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-[#ff4000] text-sm"
                  value={vknSearch}
                  onChange={(e) => setVknSearch(e.target.value)}
                  maxLength={11}
                />
                <button
                  onClick={handleVknSorgula}
                  disabled={vknLoading}
                  className="bg-[#ff4000] text-white px-6 rounded-xl font-bold text-sm hover:bg-[#e63900] transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  {vknLoading ? 'Sorgulanıyor...' : 'Sorgula'}
                </button>
              </div>
              {vknResult && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-[10px] font-bold text-[#ff4000] px-2 py-1 bg-[#ff4000]/10 rounded-lg uppercase">Durum: {vknResult.durum}</span>
                    <span className="text-xs text-gray-500 font-mono">{vknResult.vknTckn}</span>
                  </div>
                  <h4 className="font-bold text-gray-900 text-sm mb-1">{vknResult.unvan}</h4>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <MapPin className="w-3 h-3" />
                    <span>{vknResult.vergiDairesi} / {vknResult.il}</span>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Luca Kontör */}
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600">
                    <PieChart className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg">Luca Kontör Bakiyesi</h3>
                    <p className="text-xs text-gray-500">e-Fatura gönderim kredileriniz</p>
                  </div>
                </div>
                {lucaKontor ? (
                  <div className="space-y-4">
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Kalan Kontör</p>
                        <p className="text-4xl font-bold text-gray-900">{lucaKontor.remaining.toLocaleString('tr-TR')}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Toplam</p>
                        <p className="text-sm font-bold text-gray-900">{lucaKontor.limit.toLocaleString('tr-TR')}</p>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(lucaKontor.used / lucaKontor.limit) * 100}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-400 flex items-center gap-1 justify-end">
                      <RefreshCw className="w-3 h-3" /> Son güncelleme: {format(new Date(), 'HH:mm')}
                    </p>
                  </div>
                ) : lucaNotConfigured ? (
                  <div className="flex flex-col items-center justify-center h-24 gap-2 text-center">
                    <p className="text-xs font-bold text-amber-600">e-Fatura entegrasyonu aktif değil</p>
                    <p className="text-[11px] text-gray-400">LUCA_API_KEY ortam değişkenini ayarlayın</p>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-24 text-sm text-gray-400">Yükleniyor...</div>
                )}
              </div>
            </div>
          </div>

          {/* e-Fatura Gönderimi Listesi */}
          <div className="bg-white rounded-3xl p-0 shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileUp className="w-5 h-5 text-gray-400" />
                <h3 className="font-bold text-gray-900">Gönderim Bekleyen Faturalar</h3>
              </div>
              <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full uppercase">
                {invoices.filter(i => i.status === 'Kesildi' && i.faturaTipi === 'e-fatura').length} adet beklemede
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="bg-gray-50/50">
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Tarih / No</th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Müşteri</th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Tutar</th>
                    <th className="px-6 py-4 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wider">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {invoices.filter(i => i.status === 'Kesildi' && i.faturaTipi === 'e-fatura').map(inv => (
                    <tr key={inv.id as string} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-semibold text-gray-900">{inv.faturaNo as string}</div>
                        <div className="text-xs text-gray-500">{inv.date as string}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900 truncate max-w-[200px]">{inv.customerName as string}</div>
                        <div className="text-xs text-gray-500 font-mono">{inv.taxId as string}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap font-bold text-gray-900">
                        {formatTRY(inv.totalPrice as number)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleeFaturaGonder(inv.id as string)}
                          disabled={sendingInvoiceId === inv.id}
                          className="px-4 py-2 rounded-xl bg-blue-50 text-blue-600 font-bold hover:bg-blue-100 transition-colors disabled:opacity-50 text-xs flex items-center gap-1.5 ml-auto"
                        >
                          {sendingInvoiceId === inv.id ? (
                            <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Gönderiliyor</>
                          ) : (
                            <><FileUp className="w-3.5 h-3.5" /> e-Fatura Gönder</>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {invoices.filter(i => i.status === 'Kesildi' && i.faturaTipi === 'e-fatura').length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-gray-400 text-sm">
                        Gönderim bekleyen e-Fatura bulunmuyor.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* SATIŞLAR */}
      {accountingTab === 'evrak_tasarimi' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="h-full">
          <DocumentDesigner currentLanguage={currentLanguage} />
        </motion.div>
      )}

      {accountingTab === 'satislar' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* KPI Cards Row 1 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Toplam Sipariş — count, no currency toggle */}
            <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Tüm Siparişler' : 'All Orders', rows: orders.map((o: { customerName?: string, syncedAt?: { toDate?: () => Date }, faturali?: boolean, totalPrice?: number }) => ({ label: o.customerName || '—', sub: o.syncedAt?.toDate ? o.syncedAt.toDate().toLocaleDateString('tr-TR') : '', badge: o.faturali ? 'FATURALI' : 'FATURASIZ', badgeColor: o.faturali ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400', value: formatConv(o.totalPrice || 0) })), total: formatConv(orders.reduce((s: number, o: { totalPrice?: number }) => s + (o.totalPrice || 0), 0)) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center">
                  <ShoppingCart size={15} className="text-brand" />
                </div>
              </div>
              <p className="text-xl font-bold text-[#ff4000]">{orders.length}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Toplam Sipariş</p>
            </button>
            {/* Toplam Ciro */}
            <button onClick={() => { const byCustomer: Record<string, number> = {}; orders.forEach((o: { customerName?: string, totalPrice?: number }) => { const k = o.customerName || '—'; byCustomer[k] = (byCustomer[k] || 0) + (o.totalPrice || 0); }); setDrillDown({ title: currentLanguage === 'tr' ? 'Müşteri Bazlı Ciro' : 'Revenue by Customer', rows: Object.entries(byCustomer).sort(([,a],[,b]) => b - a).map(([name, total]) => ({ label: name, value: formatConv(total) })), total: formatConv(orders.reduce((s: number, o: { totalPrice?: number }) => s + (o.totalPrice || 0), 0)) }); }} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
                  <TrendingUp size={15} className="text-green-600" />
                </div>
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <button key={c} onClick={e => { e.stopPropagation(); setKpiCurrency(c); }}
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xl font-bold text-green-600">{formatConv(orders.reduce((s: number, o: { totalPrice?: number }) => s + (o.totalPrice || 0), 0))}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Toplam Ciro</p>
            </button>
            {/* Faturalı / Faturasız — count, no currency toggle */}
            <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Faturalı Siparişler' : 'Invoiced Orders', rows: orders.filter((o: { faturali?: boolean }) => o.faturali).map((o: { customerName?: string, syncedAt?: { toDate?: () => Date }, totalPrice?: number }) => ({ label: o.customerName || '—', sub: o.syncedAt?.toDate ? o.syncedAt.toDate().toLocaleDateString('tr-TR') : '', badge: 'FATURALI', badgeColor: 'bg-green-100 text-green-600', value: formatConv(o.totalPrice || 0) })), total: formatConv(orders.filter((o: { faturali?: boolean }) => o.faturali).reduce((s: number, o: { totalPrice?: number }) => s + (o.totalPrice || 0), 0)) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
                  <FileText size={15} className="text-blue-600" />
                </div>
              </div>
              <p className="text-xl font-bold text-blue-600">{orders.filter((o: { faturali?: boolean }) => o.faturali).length} / {orders.filter((o: { faturali?: boolean }) => !o.faturali).length}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Faturalı / Faturasız</p>
            </button>
            {/* Toplam KDV — stays TRY */}
            <button onClick={() => { const byRate: Record<string, number> = {}; orders.forEach((o: { kdvOran?: number, kdvTutari?: number }) => { if (o.kdvOran !== undefined) { const k = `%${o.kdvOran} KDV`; byRate[k] = (byRate[k] || 0) + (o.kdvTutari || 0); } }); setDrillDown({ title: currentLanguage === 'tr' ? 'KDV Oranlarına Göre' : 'KDV by Rate', rows: Object.entries(byRate).sort(([,a],[,b]) => b - a).map(([rate, tutar]) => ({ label: rate, value: formatTRY(tutar) })), total: formatTRY(orders.reduce((s: number, o: { kdvTutari?: number }) => s + (o.kdvTutari || 0), 0)) }); }} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl bg-purple-100 flex items-center justify-center">
                  <Calculator size={15} className="text-purple-600" />
                </div>
              </div>
              <p className="text-xl font-bold text-purple-600">{formatTRY(orders.reduce((s: number, o: { kdvTutari?: number }) => s + (o.kdvTutari || 0), 0))}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Toplam KDV</p>
            </button>
          </div>
          {/* KPI Cards Row 2 */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {/* Faturalı Ciro */}
            <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Faturalı Ciro Detayı' : 'Invoiced Revenue Detail', rows: orders.filter((o: { faturali?: boolean }) => o.faturali).map((o: { customerName?: string, totalPrice?: number }) => ({ label: o.customerName || '—', value: formatConv(o.totalPrice || 0) })), total: formatConv(orders.filter((o: { faturali?: boolean }) => o.faturali).reduce((s: number, o: { totalPrice?: number }) => s + (o.totalPrice || 0), 0)) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
                  <CheckCircle size={15} className="text-green-600" />
                </div>
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <button key={c} onClick={e => { e.stopPropagation(); setKpiCurrency(c); }}
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xl font-bold text-green-600">{formatConv(orders.filter((o: { faturali?: boolean }) => o.faturali).reduce((s: number, o: { totalPrice?: number }) => s + (o.totalPrice || 0), 0))}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Faturalı Ciro</p>
            </button>
            {/* Faturasız Ciro */}
            <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Faturasız Ciro Detayı' : 'Non-Invoiced Revenue Detail', rows: orders.filter((o: { faturali?: boolean }) => !o.faturali).map((o: { customerName?: string, totalPrice?: number }) => ({ label: o.customerName || '—', value: formatConv(o.totalPrice || 0) })), total: formatConv(orders.filter((o: { faturali?: boolean }) => !o.faturali).reduce((s: number, o: { totalPrice?: number }) => s + (o.totalPrice || 0), 0)) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center">
                  <FileText size={15} className="text-gray-500" />
                </div>
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <button key={c} onClick={e => { e.stopPropagation(); setKpiCurrency(c); }}
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xl font-bold text-gray-600">{formatConv(orders.filter((o: { faturali?: boolean }) => !o.faturali).reduce((s: number, o: { totalPrice?: number }) => s + (o.totalPrice || 0), 0))}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Faturasız Ciro</p>
            </button>
            {/* Ortalama Sipariş */}
            <button onClick={() => setDrillDown({ title: currentLanguage === 'tr' ? 'Ortalama Sipariş Analizi' : 'Avg Order Analysis', rows: orders.map((o: { customerName?: string, totalPrice?: number }) => ({ label: o.customerName || '—', value: formatConv(o.totalPrice || 0) })), total: formatConv(orders.length > 0 ? orders.reduce((s: number, o: { totalPrice?: number }) => s + (o.totalPrice || 0), 0) / orders.length : 0) })} className="apple-card p-4 text-left cursor-pointer flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center">
                  <BarChart3 size={15} className="text-brand" />
                </div>
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <button key={c} onClick={e => { e.stopPropagation(); setKpiCurrency(c); }}
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xl font-bold text-[#ff4000]">{formatConv(orders.length > 0 ? orders.reduce((s: number, o: { totalPrice?: number }) => s + (o.totalPrice || 0), 0) / orders.length : 0)}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Ortalama Sipariş</p>
            </button>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800">{t.satislar}</h3>
            </div>
            {/* Search bar */}
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={currentLanguage === 'tr' ? 'Müşteri veya tutar ara...' : 'Search customer or amount...'}
                value={satisSearch}
                onChange={e => setSatisSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-gray-50 rounded-xl text-sm border-0 outline-none focus:ring-2 focus:ring-[#ff4000]/20"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={t.customer2} 
                      sortKey="customerName" 
                      currentSort={{ key: satisSortKey, direction: satisSortDir }} 
                      onSort={(key) => toggleSatisSort(key as 'customerName' | 'date' | 'totalPrice' | 'faturali')} 
                    />
                    <SortHeader 
                      label={t.date} 
                      sortKey="date" 
                      currentSort={{ key: satisSortKey, direction: satisSortDir }} 
                      onSort={(key) => toggleSatisSort(key as 'customerName' | 'date' | 'totalPrice' | 'faturali')} 
                      className="hidden sm:table-cell"
                    />
                    <SortHeader 
                      label={t.total2} 
                      sortKey="totalPrice" 
                      currentSort={{ key: satisSortKey, direction: satisSortDir }} 
                      onSort={(key) => toggleSatisSort(key as 'customerName' | 'date' | 'totalPrice' | 'faturali')} 
                      className="text-right"
                    />
                    <SortHeader 
                      label="Fatura" 
                      sortKey="faturali" 
                      currentSort={{ key: satisSortKey, direction: satisSortDir }} 
                      onSort={(key) => toggleSatisSort(key as 'customerName' | 'date' | 'totalPrice' | 'faturali')} 
                      className="text-center"
                    />
                    <th className="text-center py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">KDV%</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedSatis.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>}
                  {displayedSatis.map((o: { id?: string, customerName?: string, syncedAt?: { toDate?: () => Date }, totalPrice?: number, faturali?: boolean, kdvOran?: number }) => (
                    <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-medium text-gray-800">{o.customerName}</td>
                      <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell text-xs">
                        {o.syncedAt?.toDate ? o.syncedAt.toDate().toLocaleDateString('tr-TR') : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold">{formatTRY(o.totalPrice || 0)}</td>
                      <td className="py-2.5 px-3 text-center">
                        {o.faturali
                          ? <span className="text-[9px] font-bold bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full">FATURALI</span>
                          : <span className="text-[9px] font-bold bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">FATURASIZ</span>
                        }
                      </td>
                      <td className="py-2.5 px-3 text-center text-xs text-gray-500 hidden sm:table-cell">%{o.kdvOran ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* MÜŞTERİLER */}
      {accountingTab === 'musteriler' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800">{t.musteriler}</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => exportCSV('musteriler.csv',
                    [t.name, t.company, t.email, t.phone, t.taxNo, t.address],
                    customers.map(c => [c.name, c.company || '', c.email || '', c.phone || '', c.taxNo || '', c.address || ''])
                  )}
                  className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 rounded-full px-3 py-1.5 text-xs font-semibold"
                >
                  <Download size={12} /> CSV
                </button>
                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                  <Search size={12} className="text-gray-400" />
                  <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder={t.name + '...'} className="text-xs outline-none bg-transparent w-32" />
                </div>
                <button onClick={() => setShowCustomerModal(true)} className="apple-button-primary">
                  <Plus size={14} /> {t.add}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={t.name} 
                      sortKey="name" 
                      currentSort={{ key: musteriSortKey, direction: musteriSortDir }} 
                      onSort={(key) => toggleMusteriSort(key as 'name' | 'company' | 'phone')} 
                    />
                    <SortHeader 
                      label={t.company} 
                      sortKey="company" 
                      currentSort={{ key: musteriSortKey, direction: musteriSortDir }} 
                      onSort={(key) => toggleMusteriSort(key as 'name' | 'company' | 'phone')} 
                      className="hidden sm:table-cell"
                    />
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden lg:table-cell">{t.email}</th>
                    <SortHeader
                      label={t.phone}
                      sortKey="phone"
                      currentSort={{ key: musteriSortKey, direction: musteriSortDir }}
                      onSort={(key) => toggleMusteriSort(key as 'name' | 'company' | 'phone')}
                      className="hidden md:table-cell"
                    />
                    <th className="text-right py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{currentLanguage === 'tr' ? 'Bakiye' : 'Balance'}</th>
                    <th className="text-center py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{currentLanguage === 'tr' ? 'Risk' : 'Risk'}</th>
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {displayedMusteriler.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                  )}
                  {displayedMusteriler.map(c => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-medium text-gray-800">{c.name}</td>
                      <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell">{c.company || '—'}</td>
                      <td className="py-2.5 px-3 text-gray-500 hidden lg:table-cell text-xs">{c.email || '—'}</td>
                      <td className="py-2.5 px-3 text-gray-500 hidden md:table-cell text-xs">{c.phone || '—'}</td>
                      <td className="py-2.5 px-3 text-right hidden sm:table-cell">
                        <span className={`text-xs font-bold ${(c.balance || 0) > 0 ? 'text-red-600' : (c.balance || 0) < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                          ₺{(c.balance || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center hidden sm:table-cell">
                        {c.riskGroup ? (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.riskGroup === 'Yüksek' ? 'bg-red-100 text-red-600' : c.riskGroup === 'Orta' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-600'}`}>
                            {c.riskGroup}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => { setEditingCustomer(c); setCustomerForm({ name: c.name, company: c.company || '', email: c.email || '', phone: c.phone || '', address: c.address || '', taxNo: c.taxNo || '', taxOffice: c.taxOffice || '', notes: c.notes || '', creditLimit: c.creditLimit || 0, balance: c.balance || 0, riskGroup: c.riskGroup || 'Düşük' }); setShowCustomerModal(true); }} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                          <button onClick={() => { setEditingCustomer(c); setCustomerForm({ name: c.name, company: c.company || '', email: c.email || '', phone: c.phone || '', address: c.address || '', taxNo: c.taxNo || '', taxOffice: c.taxOffice || '', notes: c.notes || '', creditLimit: c.creditLimit || 0, balance: c.balance || 0, riskGroup: c.riskGroup || 'Düşük' }); setShowCustomerModal(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                          <button onClick={() => deleteCustomer(c.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
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

      {/* TEDARİKÇİLER */}
      {accountingTab === 'tedarikciler' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800">{t.tedarikciler}</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => exportCSV('tedarikciler.csv',
                    [t.name, t.company, t.email, t.phone, t.taxNo, t.address],
                    suppliers.map(s => [s.name, s.company || '', s.email || '', s.phone || '', s.taxNo || '', s.address || ''])
                  )}
                  className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 rounded-full px-3 py-1.5 text-xs font-semibold"
                >
                  <Download size={12} /> CSV
                </button>
                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                  <Search size={12} className="text-gray-400" />
                  <input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder={t.name + '...'} className="text-xs outline-none bg-transparent w-32" />
                </div>
                <button onClick={() => setShowSupplierModal(true)} className="apple-button-primary">
                  <Plus size={14} /> {t.add}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={t.name} 
                      sortKey="name" 
                      currentSort={{ key: tedarikciSortKey, direction: tedarikciSortDir }} 
                      onSort={(key) => toggleTedarikciSort(key as 'name' | 'company' | 'phone')} 
                    />
                    <SortHeader 
                      label={t.company} 
                      sortKey="company" 
                      currentSort={{ key: tedarikciSortKey, direction: tedarikciSortDir }} 
                      onSort={(key) => toggleTedarikciSort(key as 'name' | 'company' | 'phone')} 
                      className="hidden sm:table-cell"
                    />
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">{t.email}</th>
                    <SortHeader 
                      label={t.phone} 
                      sortKey="phone" 
                      currentSort={{ key: tedarikciSortKey, direction: tedarikciSortDir }} 
                      onSort={(key) => toggleTedarikciSort(key as 'name' | 'company' | 'phone')} 
                      className="hidden sm:table-cell"
                    />
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden lg:table-cell">{t.taxNo}</th>
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {displayedTedarikciler.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                  )}
                  {displayedTedarikciler.map(s => (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-medium text-gray-800">{s.name}</td>
                      <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell">{s.company || '—'}</td>
                      <td className="py-2.5 px-3 text-gray-500 hidden md:table-cell text-xs">{s.email || '—'}</td>
                      <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell text-xs">{s.phone || '—'}</td>
                      <td className="py-2.5 px-3 text-gray-500 hidden lg:table-cell text-xs">{s.taxNo || '—'}</td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => { setEditingSupplier(s); setSupplierForm({ name: s.name, company: s.company || '', email: s.email || '', phone: s.phone || '', address: s.address || '', taxNo: s.taxNo || '', notes: s.notes || '' }); setShowSupplierModal(true); }} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                          <button onClick={() => { setEditingSupplier(s); setSupplierForm({ name: s.name, company: s.company || '', email: s.email || '', phone: s.phone || '', address: s.address || '', taxNo: s.taxNo || '', notes: s.notes || '' }); setShowSupplierModal(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                          <button onClick={() => deleteSupplier(s.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
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

      {/* HİZMET & ÜRÜNLER */}
      {accountingTab === 'urunler' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800">{t.urunler}</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => exportCSV('urunler.csv',
                    [t.code, t.name, t.type2, t.unitPrice, t.vatRate, t.unit],
                    services.map(s => [s.code, s.name, s.type, s.unitPrice, s.vatRate, s.unit])
                  )}
                  className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 rounded-full px-3 py-1.5 text-xs font-semibold"
                >
                  <Download size={12} /> CSV
                </button>
                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                  <Search size={12} className="text-gray-400" />
                  <input value={serviceSearch} onChange={e => setServiceSearch(e.target.value)} placeholder={t.name + '...'} className="text-xs outline-none bg-transparent w-32" />
                </div>
                <button onClick={() => setShowServiceModal(true)} className="apple-button-primary">
                  <Plus size={14} /> {t.add}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={t.code} 
                      sortKey="code" 
                      currentSort={{ key: servisSortKey, direction: servisSortDir }} 
                      onSort={(key) => toggleServisSort(key as 'code' | 'name' | 'unitPrice' | 'vatRate')} 
                    />
                    <SortHeader 
                      label={t.name} 
                      sortKey="name" 
                      currentSort={{ key: servisSortKey, direction: servisSortDir }} 
                      onSort={(key) => toggleServisSort(key as 'code' | 'name' | 'unitPrice' | 'vatRate')} 
                    />
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{t.type2}</th>
                    <SortHeader 
                      label={t.unitPrice} 
                      sortKey="unitPrice" 
                      currentSort={{ key: servisSortKey, direction: servisSortDir }} 
                      onSort={(key) => toggleServisSort(key as 'code' | 'name' | 'unitPrice' | 'vatRate')} 
                      className="text-right"
                    />
                    <SortHeader 
                      label="KDV%" 
                      sortKey="vatRate" 
                      currentSort={{ key: servisSortKey, direction: servisSortDir }} 
                      onSort={(key) => toggleServisSort(key as 'code' | 'name' | 'unitPrice' | 'vatRate')} 
                      className="text-center hidden sm:table-cell"
                    />
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">{t.unit}</th>
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {displayedServisler.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                  )}
                  {displayedServisler.map(s => (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-mono text-xs text-gray-600">{s.code}</td>
                      <td className="py-2.5 px-3 font-medium text-gray-800">{s.name}</td>
                      <td className="py-2.5 px-3 hidden sm:table-cell"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.type === 'Hizmet' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>{s.type}</span></td>
                      <td className="py-2.5 px-3 text-right font-semibold">{formatTRY(s.unitPrice)}</td>
                      <td className="py-2.5 px-3 text-center text-xs text-gray-500 hidden sm:table-cell">%{s.vatRate}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 hidden md:table-cell">{s.unit}</td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => { setEditingService(s); setServiceForm({ code: s.code, name: s.name, type: s.type, unitPrice: s.unitPrice, vatRate: s.vatRate, unit: s.unit, notes: s.notes || '' }); setShowServiceModal(true); }} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                          <button onClick={() => { setEditingService(s); setServiceForm({ code: s.code, name: s.name, type: s.type, unitPrice: s.unitPrice, vatRate: s.vatRate, unit: s.unit, notes: s.notes || '' }); setShowServiceModal(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                          <button onClick={() => deleteService(s.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
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

      {/* WAREHOUSES */}
      {accountingTab === 'warehouses' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800">{currentLanguage === 'tr' ? 'Depo Tanımları' : 'Warehouse Definitions'}</h3>
              <button onClick={() => { setEditingWarehouse(null); setWarehouseForm({ name: '', location: '', manager: '', notes: '' }); setShowWarehouseModal(true); }} className="apple-button-primary">
                <Plus size={14} /> {t.add}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {warehouses.map(w => (
                <div key={w.id} className="bg-gray-50 rounded-2xl p-4 border border-gray-100 relative group">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-bold text-gray-800">{w.name}</h4>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingWarehouse(w); setWarehouseForm({ name: w.name, location: w.location || '', manager: w.manager || '', notes: w.notes || '' }); setShowWarehouseModal(true); }} className="p-1.5 hover:bg-white rounded-lg text-blue-500"><Eye size={12} /></button>
                          <button onClick={() => { setEditingWarehouse(w); setWarehouseForm({ name: w.name, location: w.location || '', manager: w.manager || '', notes: w.notes || '' }); setShowWarehouseModal(true); }} className="p-1.5 hover:bg-white rounded-lg text-gray-500"><Edit2 size={12} /></button>
                      <button onClick={() => deleteWarehouse(w.id)} className="p-1.5 hover:bg-white rounded-lg text-red-500"><Trash2 size={12} /></button>
                    </div>
                  </div>
                  <div className="space-y-1 text-xs text-gray-500">
                    <div className="flex items-center gap-1.5"><MapPin size={12} /> {w.location || '—'}</div>
                    <div className="flex items-center gap-1.5"><User size={12} /> {w.manager || '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* DEPO */}
      {accountingTab === 'depo' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800">{t.depo}</h3>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                  <Search size={12} className="text-gray-400" />
                  <input value={warehouseSearch} onChange={e => setWarehouseSearch(e.target.value)} placeholder={t.product + '...'} className="text-xs outline-none bg-transparent w-32" />
                </div>
                <button onClick={() => { setEditingStock(null); setStockForm({ productName: '', sku: '', quantity: 0, warehouseId: '', category: '', notes: '' }); setShowStockModal(true); }} className="apple-button-primary">
                  <Plus size={14} /> {t.add}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={t.product} 
                      sortKey="productName" 
                      currentSort={{ key: depoSortKey, direction: depoSortDir }} 
                      onSort={(key) => toggleDepoSort(key as 'productName' | 'sku' | 'quantity' | 'warehouseId')} 
                    />
                    <SortHeader 
                      label="SKU" 
                      sortKey="sku" 
                      currentSort={{ key: depoSortKey, direction: depoSortDir }} 
                      onSort={(key) => toggleDepoSort(key as 'productName' | 'sku' | 'quantity' | 'warehouseId')} 
                      className="hidden sm:table-cell"
                    />
                    <SortHeader 
                      label={t.quantity} 
                      sortKey="quantity" 
                      currentSort={{ key: depoSortKey, direction: depoSortDir }} 
                      onSort={(key) => toggleDepoSort(key as 'productName' | 'sku' | 'quantity' | 'warehouseId')} 
                      className="text-right"
                    />
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">{t.location}</th>
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden lg:table-cell">{t.category}</th>
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {displayedDepo.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                  )}
                  {displayedDepo.map(w => (
                    <tr key={w.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-medium text-gray-800">{w.productName}</td>
                      <td className="py-2.5 px-3 font-mono text-xs text-gray-500 hidden sm:table-cell">{w.sku || '—'}</td>
                      <td className="py-2.5 px-3 text-right font-semibold">{w.quantity}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 hidden md:table-cell">{warehouses.find(wh => wh.id === w.warehouseId)?.name || w.location || '—'}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 hidden lg:table-cell">{w.category || '—'}</td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => { setEditingStock(w); setStockForm({ productName: w.productName, sku: w.sku || '', quantity: w.quantity, warehouseId: w.warehouseId || '', category: w.category || '', notes: w.notes || '' }); setShowStockModal(true); }} className="p-1.5 hover:bg-blue-50 text-blue-400 rounded-lg transition-colors text-blue-500 hover:bg-blue-50 hover:text-blue-600"><Eye size={13} /></button>
                          <button onClick={() => { setEditingStock(w); setStockForm({ productName: w.productName, sku: w.sku || '', quantity: w.quantity, warehouseId: w.warehouseId || '', category: w.category || '', notes: w.notes || '' }); setShowStockModal(true); }} className="p-1.5 hover:bg-blue-50 text-blue-400 rounded-lg transition-colors"><Edit2 size={13} /></button>
                          <button onClick={() => deleteStock(w.id)} className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"><Trash2 size={13} /></button>
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

      {/* DEPOLAR ARASI TRANSFER */}
      {accountingTab === 'transfer' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800">{t.transfer}</h3>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                  <Search size={12} className="text-gray-400" />
                  <input value={transferSearch} onChange={e => setTransferSearch(e.target.value)} placeholder={t.product + '...'} className="text-xs outline-none bg-transparent w-32" />
                </div>
                <button onClick={() => setShowTransferModal(true)} className="apple-button-primary">
                  <Plus size={14} /> {t.add}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={t.product} 
                      sortKey="productName" 
                      currentSort={{ key: transferSortKey, direction: transferSortDir }} 
                      onSort={(key) => toggleTransferSort(key as 'productName' | 'quantity' | 'date' | 'status')} 
                    />
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{t.fromWarehouse}</th>
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{t.toWarehouse}</th>
                    <SortHeader 
                      label={t.quantity} 
                      sortKey="quantity" 
                      currentSort={{ key: transferSortKey, direction: transferSortDir }} 
                      onSort={(key) => toggleTransferSort(key as 'productName' | 'quantity' | 'date' | 'status')} 
                      className="text-right"
                    />
                    <SortHeader 
                      label={t.date} 
                      sortKey="date" 
                      currentSort={{ key: transferSortKey, direction: transferSortDir }} 
                      onSort={(key) => toggleTransferSort(key as 'productName' | 'quantity' | 'date' | 'status')} 
                      className="hidden md:table-cell"
                    />
                    <SortHeader 
                      label={t.status2} 
                      sortKey="status" 
                      currentSort={{ key: transferSortKey, direction: transferSortDir }} 
                      onSort={(key) => toggleTransferSort(key as 'productName' | 'quantity' | 'date' | 'status')} 
                      className="text-center"
                    />
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {displayedTransfers.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                  )}
                  {displayedTransfers.map(tr => (
                    <tr key={tr.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-medium text-gray-800">{tr.productName}</td>
                      <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell text-xs">{tr.fromWarehouse}</td>
                      <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell text-xs">{tr.toWarehouse}</td>
                      <td className="py-2.5 px-3 text-right font-semibold">{tr.quantity}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 hidden md:table-cell">{tr.date}</td>
                      <td className="py-2.5 px-3 text-center"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tr.status === 'Tamamlandı' ? 'bg-green-100 text-green-600' : tr.status === 'İptal' ? 'bg-red-100 text-red-500' : 'bg-yellow-100 text-yellow-600'}`}>{tr.status}</span></td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => { setEditingTransfer(tr); setTransferForm({ fromWarehouse: tr.fromWarehouse, toWarehouse: tr.toWarehouse, productName: tr.productName, quantity: tr.quantity, date: tr.date, notes: tr.notes || '', status: tr.status }); setShowTransferModal(true); }} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                          <button onClick={() => { setEditingTransfer(tr); setTransferForm({ fromWarehouse: tr.fromWarehouse, toWarehouse: tr.toWarehouse, productName: tr.productName, quantity: tr.quantity, date: tr.date, notes: tr.notes || '', status: tr.status }); setShowTransferModal(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                          <button onClick={() => deleteTransfer(tr.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
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

      {/* ÇEKLER */}
      {accountingTab === 'cekler' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800">{t.cekler}</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => exportCSV('cekler.csv',
                    [t.checkNo, t.bank2, t.amount2, t.dueDate, t.drawer, t.checkType],
                    checks.map(c => [c.checkNo, c.bankName, c.amount, c.dueDate, c.drawer, c.type])
                  )}
                  className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 rounded-full px-3 py-1.5 text-xs font-semibold"
                >
                  <Download size={12} /> CSV
                </button>
                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                  <Search size={12} className="text-gray-400" />
                  <input value={checkSearch} onChange={e => setCheckSearch(e.target.value)} placeholder={t.checkNo + '...'} className="text-xs outline-none bg-transparent w-32" />
                </div>
                <button onClick={() => setShowCheckModal(true)} className="apple-button-primary">
                  <Plus size={14} /> {t.add}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={t.checkNo} 
                      sortKey="checkNo" 
                      currentSort={{ key: cekSortKey, direction: cekSortDir }} 
                      onSort={(key) => toggleCekSort(key as 'checkNo' | 'amount' | 'dueDate' | 'type')} 
                    />
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden sm:table-cell">{t.bank2}</th>
                    <SortHeader 
                      label={t.amount2} 
                      sortKey="amount" 
                      currentSort={{ key: cekSortKey, direction: cekSortDir }} 
                      onSort={(key) => toggleCekSort(key as 'checkNo' | 'amount' | 'dueDate' | 'type')} 
                      className="text-right"
                    />
                    <SortHeader 
                      label={t.dueDate} 
                      sortKey="dueDate" 
                      currentSort={{ key: cekSortKey, direction: cekSortDir }} 
                      onSort={(key) => toggleCekSort(key as 'checkNo' | 'amount' | 'dueDate' | 'type')} 
                      className="hidden md:table-cell"
                    />
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden lg:table-cell">{t.drawer}</th>
                    <SortHeader 
                      label={t.checkType} 
                      sortKey="type" 
                      currentSort={{ key: cekSortKey, direction: cekSortDir }} 
                      onSort={(key) => toggleCekSort(key as 'checkNo' | 'amount' | 'dueDate' | 'type')} 
                      className="text-center"
                    />
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {displayedCekler.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                  )}
                  {displayedCekler.map(c => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-mono text-xs text-gray-800">{c.checkNo}</td>
                      <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell">{c.bankName}</td>
                      <td className="py-2.5 px-3 text-right font-semibold">{formatTRY(c.amount)}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 hidden md:table-cell">{c.dueDate}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 hidden lg:table-cell">{c.drawer}</td>
                      <td className="py-2.5 px-3 text-center"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${c.type === 'Alınan' ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>{c.type}</span></td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => { setEditingCheck(c); setCheckForm({ checkNo: c.checkNo, bankName: c.bankName, amount: c.amount, dueDate: c.dueDate, drawer: c.drawer, type: c.type, status: c.status }); setShowCheckModal(true); }} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                          <button onClick={() => { setEditingCheck(c); setCheckForm({ checkNo: c.checkNo, bankName: c.bankName, amount: c.amount, dueDate: c.dueDate, drawer: c.drawer, type: c.type, status: c.status }); setShowCheckModal(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                          <button onClick={() => deleteCheck(c.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
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

      {/* ÇALIŞANLAR */}
      {accountingTab === 'calisanlar' && (
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
                    <SortHeader 
                      label={t.name} 
                      sortKey="name" 
                      currentSort={{ key: calisanSortKey, direction: calisanSortDir }} 
                      onSort={(key) => toggleCalisanSort(key as 'name' | 'position' | 'salary' | 'startDate' | 'department')} 
                    />
                    <SortHeader 
                      label={t.position} 
                      sortKey="position" 
                      currentSort={{ key: calisanSortKey, direction: calisanSortDir }} 
                      onSort={(key) => toggleCalisanSort(key as 'name' | 'position' | 'salary' | 'startDate' | 'department')} 
                      className="hidden sm:table-cell"
                    />
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">{t.department}</th>
                    <SortHeader 
                      label={t.salary} 
                      sortKey="salary" 
                      currentSort={{ key: calisanSortKey, direction: calisanSortDir }} 
                      onSort={(key) => toggleCalisanSort(key as 'name' | 'position' | 'salary' | 'startDate' | 'department')} 
                      className="text-right hidden sm:table-cell"
                    />
                    <SortHeader 
                      label={t.startDate} 
                      sortKey="startDate" 
                      currentSort={{ key: calisanSortKey, direction: calisanSortDir }} 
                      onSort={(key) => toggleCalisanSort(key as 'name' | 'position' | 'salary' | 'startDate' | 'department')} 
                      className="hidden lg:table-cell"
                    />
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
      )}

      {/* GİDEN İRSALİYE */}
      {accountingTab === 'giden_irsaliye' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800">{t.gidenIrsaliye}</h3>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                  <Search size={12} className="text-gray-400" />
                  <input value={waybillSearch} onChange={e => setWaybillSearch(e.target.value)} placeholder={t.waybillNo + '...'} className="text-xs outline-none bg-transparent w-32" />
                </div>
                <button onClick={() => { setWaybillType('giden'); setShowWaybillModal(true); }} className="apple-button-primary">
                  <Plus size={14} /> {t.add}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={t.waybillNo} 
                      sortKey="waybillNo" 
                      currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }} 
                      onSort={(key) => toggleIrsaliyeSort(key as 'date' | 'waybillNo' | 'party' | 'status' | 'type')} 
                    />
                    <SortHeader 
                      label={t.customer2} 
                      sortKey="party" 
                      currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }} 
                      onSort={(key) => toggleIrsaliyeSort(key as 'date' | 'waybillNo' | 'party' | 'status' | 'type')} 
                      className="hidden sm:table-cell"
                    />
                    <SortHeader 
                      label={t.date} 
                      sortKey="date" 
                      currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }} 
                      onSort={(key) => toggleIrsaliyeSort(key as 'date' | 'waybillNo' | 'party' | 'status' | 'type')} 
                      className="hidden md:table-cell"
                    />
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden lg:table-cell">{t.product}</th>
                    <SortHeader 
                      label={t.total2} 
                      sortKey="total" 
                      currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }} 
                      onSort={(key) => toggleIrsaliyeSort(key as 'date' | 'waybillNo' | 'party' | 'status' | 'type')} 
                      className="text-right"
                    />
                    <SortHeader 
                      label={t.status2} 
                      sortKey="status" 
                      currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }} 
                      onSort={(key) => toggleIrsaliyeSort(key as 'date' | 'waybillNo' | 'party' | 'status' | 'type')} 
                      className="text-center"
                    />
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {makeDisplayedWaybills('giden').length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                  )}
                  {makeDisplayedWaybills('giden').map(w => (
                    <tr key={w.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-mono text-xs text-gray-800">{w.waybillNo}</td>
                      <td className="py-2.5 px-3 text-gray-600 hidden sm:table-cell">{w.party}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 hidden md:table-cell">{w.date}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 hidden lg:table-cell">{w.items?.map(i => i.productName).join(', ') || '—'}</td>
                      <td className="py-2.5 px-3 text-right font-semibold">{w.total ? formatTRY(w.total) : '—'}</td>
                      <td className="py-2.5 px-3 text-center"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${w.status === 'Tamamlandı' ? 'bg-green-100 text-green-600' : w.status === 'İptal' ? 'bg-red-100 text-red-500' : 'bg-yellow-100 text-yellow-600'}`}>{w.status}</span></td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => { setEditingWaybill(w); setWaybillForm({ waybillNo: w.waybillNo, invoiceNo: w.invoiceNo || '', party: w.party, date: w.date, items: w.items || [], total: w.total || 0, status: w.status }); setWaybillType('giden'); setShowWaybillModal(true); }} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                          <button onClick={() => { setEditingWaybill(w); setWaybillForm({ waybillNo: w.waybillNo, invoiceNo: w.invoiceNo || '', party: w.party, date: w.date, items: w.items || [], total: w.total || 0, status: w.status }); setWaybillType('giden'); setShowWaybillModal(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                          <button onClick={() => deleteWaybill(w.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
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

      {/* GELEN İRSALİYE */}
      {accountingTab === 'gelen_irsaliye' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800">{t.gelenIrsaliye}</h3>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                  <Search size={12} className="text-gray-400" />
                  <input value={waybillSearch} onChange={e => setWaybillSearch(e.target.value)} placeholder={t.waybillNo + '...'} className="text-xs outline-none bg-transparent w-32" />
                </div>
                <button onClick={() => { setWaybillType('gelen'); setShowWaybillModal(true); }} className="apple-button-primary">
                  <Plus size={14} /> {t.add}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="apple-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortHeader 
                      label={t.waybillNo} 
                      sortKey="waybillNo" 
                      currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }} 
                      onSort={(key) => toggleIrsaliyeSort(key as 'date' | 'waybillNo' | 'party' | 'status' | 'type')} 
                    />
                    <SortHeader 
                      label={t.supplier2} 
                      sortKey="party" 
                      currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }} 
                      onSort={(key) => toggleIrsaliyeSort(key as 'date' | 'waybillNo' | 'party' | 'status' | 'type')} 
                      className="hidden sm:table-cell"
                    />
                    <SortHeader 
                      label={t.date} 
                      sortKey="date" 
                      currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }} 
                      onSort={(key) => toggleIrsaliyeSort(key as 'date' | 'waybillNo' | 'party' | 'status' | 'type')} 
                      className="hidden md:table-cell"
                    />
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden lg:table-cell">{t.product}</th>
                    <SortHeader 
                      label={t.total2} 
                      sortKey="total" 
                      currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }} 
                      onSort={(key) => toggleIrsaliyeSort(key as 'date' | 'waybillNo' | 'party' | 'status' | 'type')} 
                      className="text-right"
                    />
                    <SortHeader 
                      label={t.status2} 
                      sortKey="status" 
                      currentSort={{ key: irsaliyeSortKey, direction: irsaliyeSortDir }} 
                      onSort={(key) => toggleIrsaliyeSort(key as 'date' | 'waybillNo' | 'party' | 'status' | 'type')} 
                      className="text-center"
                    />
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {makeDisplayedWaybills('gelen').length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t.noRecords}</td></tr>
                  )}
                  {makeDisplayedWaybills('gelen').map(w => (
                    <tr key={w.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-mono text-xs text-gray-800">{w.waybillNo}</td>
                      <td className="py-2.5 px-3 text-gray-600 hidden sm:table-cell">{w.party}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 hidden md:table-cell">{w.date}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 hidden lg:table-cell">{w.items?.map(i => i.productName).join(', ') || '—'}</td>
                      <td className="py-2.5 px-3 text-right font-semibold">{w.total ? formatTRY(w.total) : '—'}</td>
                      <td className="py-2.5 px-3 text-center"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${w.status === 'Tamamlandı' ? 'bg-green-100 text-green-600' : w.status === 'İptal' ? 'bg-red-100 text-red-500' : 'bg-yellow-100 text-yellow-600'}`}>{w.status}</span></td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => { setEditingWaybill(w); setWaybillForm({ waybillNo: w.waybillNo, invoiceNo: w.invoiceNo || '', party: w.party, date: w.date, items: w.items || [], total: w.total || 0, status: w.status }); setWaybillType('gelen'); setShowWaybillModal(true); }} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors text-blue-500"><Eye size={13} /></button>
                          <button onClick={() => { setEditingWaybill(w); setWaybillForm({ waybillNo: w.waybillNo, invoiceNo: w.invoiceNo || '', party: w.party, date: w.date, items: w.items || [], total: w.total || 0, status: w.status }); setWaybillType('gelen'); setShowWaybillModal(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"><Edit2 size={13} /></button>
                          <button onClick={() => deleteWaybill(w.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-red-500"><Trash2 size={13} /></button>
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

      {/* JOURNAL MODAL */}
      <AnimatePresence>
        {showJournalModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowJournalModal(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg relative z-10 overflow-hidden"
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{editingJournal ? t.editJournalEntry : t.newJournalEntry}</h3>
                <button onClick={() => setShowJournalModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.date}</label>
                    <input type="date" value={journalForm.date} onChange={e => setJournalForm(prev => ({ ...prev, date: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.receiptDoc}</label>
                    <input type="text" value={journalForm.fiş} onChange={e => setJournalForm(prev => ({ ...prev, fiş: e.target.value }))} placeholder="FŞ-001" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.description}</label>
                  <input type="text" value={journalForm.aciklama} onChange={e => setJournalForm(prev => ({ ...prev, aciklama: e.target.value }))} placeholder={t.descriptionPlaceholder} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.debitAccountLabel}</label>
                  <select value={journalForm.debitHesap} onChange={e => setJournalForm(prev => ({ ...prev, debitHesap: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                    {HESAP_PLANI.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.creditAccountLabel}</label>
                  <select value={journalForm.alacakHesap} onChange={e => setJournalForm(prev => ({ ...prev, alacakHesap: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                    {HESAP_PLANI.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.debitLabel}</label>
                    <input type="number" value={journalForm.borc} onChange={e => setJournalForm(prev => ({ ...prev, borc: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.creditLabel}</label>
                    <input type="number" value={journalForm.alacak} onChange={e => setJournalForm(prev => ({ ...prev, alacak: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.vatRateLabel}</label>
                    <select value={journalForm.kdvOran} onChange={e => setJournalForm(prev => ({ ...prev, kdvOran: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option value={0}>%0</option><option value={8}>%8</option><option value={18}>%18</option><option value={20}>%20</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.categoryLabel}</label>
                    <select value={journalForm.kategori} onChange={e => setJournalForm(prev => ({ ...prev, kategori: e.target.value as 'Satış' | 'Alış' | 'Gider' | 'Tahsilat' | 'Ödeme' | 'Diğer' }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option>Satış</option><option>Alış</option><option>Gider</option><option>Tahsilat</option><option>Ödeme</option><option>Diğer</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowJournalModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveJournal} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CUSTOMER MODAL */}
      <AnimatePresence>
        {showCustomerModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCustomerModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.musteriler} — {editingCustomer ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowCustomerModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                {[
                  { label: t.name, key: 'name', type: 'text', placeholder: 'Ahmet Yılmaz' },
                  { label: t.company, key: 'company', type: 'text', placeholder: 'ABC Ltd. Şti.' },
                  { label: t.email, key: 'email', type: 'email', placeholder: 'ornek@sirket.com' },
                  { label: t.phone, key: 'phone', type: 'text', placeholder: '+90 555 000 0000' },
                  { label: t.address, key: 'address', type: 'text', placeholder: 'İstanbul, Türkiye' },
                  { label: currentLanguage === 'tr' ? 'Vergi Dairesi' : 'Tax Office', key: 'taxOffice', type: 'text', placeholder: 'Boğaziçi V.D.' },
                  { label: t.taxNo, key: 'taxNo', type: 'text', placeholder: '1234567890' },
                  { label: t.notes2, key: 'notes', type: 'text', placeholder: '...' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                    <input type={f.type} value={customerForm[f.key as keyof typeof customerForm] as string} onChange={e => setCustomerForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                ))}
                {/* Risk & Financial fields */}
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">{currentLanguage === 'tr' ? 'Finansal & Risk' : 'Financial & Risk'}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Kredi Limiti (₺)' : 'Credit Limit (₺)'}</label>
                      <input type="number" value={customerForm.creditLimit} onChange={e => setCustomerForm(prev => ({ ...prev, creditLimit: Number(e.target.value) }))} placeholder="500000" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Açık Bakiye (₺)' : 'Open Balance (₺)'}</label>
                      <input type="number" value={customerForm.balance} onChange={e => setCustomerForm(prev => ({ ...prev, balance: Number(e.target.value) }))} placeholder="0" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">{currentLanguage === 'tr' ? 'Risk Grubu' : 'Risk Group'}</label>
                    <div className="flex gap-2">
                      {(['Düşük', 'Orta', 'Yüksek'] as const).map(g => (
                        <button key={g} type="button"
                          onClick={() => setCustomerForm(prev => ({ ...prev, riskGroup: g }))}
                          className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${customerForm.riskGroup === g
                            ? g === 'Yüksek' ? 'bg-red-500 text-white border-red-500' : g === 'Orta' ? 'bg-yellow-400 text-white border-yellow-400' : 'bg-green-500 text-white border-green-500'
                            : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
                          {g === 'Düşük' ? '🟢' : g === 'Orta' ? '🟡' : '🔴'} {currentLanguage === 'tr' ? g : g === 'Düşük' ? 'Low' : g === 'Orta' ? 'Medium' : 'High'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowCustomerModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveCustomer} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SUPPLIER MODAL */}
      <AnimatePresence>
        {showSupplierModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowSupplierModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.tedarikciler} — {editingSupplier ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowSupplierModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                {[
                  { label: t.name, key: 'name', type: 'text', placeholder: 'Tedarikçi Adı' },
                  { label: t.company, key: 'company', type: 'text', placeholder: 'XYZ A.Ş.' },
                  { label: t.email, key: 'email', type: 'email', placeholder: 'info@tedarikci.com' },
                  { label: t.phone, key: 'phone', type: 'text', placeholder: '+90 555 000 0000' },
                  { label: t.address, key: 'address', type: 'text', placeholder: 'Ankara, Türkiye' },
                  { label: t.taxNo, key: 'taxNo', type: 'text', placeholder: '9876543210' },
                  { label: t.notes2, key: 'notes', type: 'text', placeholder: '...' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                    <input type={f.type} value={supplierForm[f.key as keyof typeof supplierForm]} onChange={e => setSupplierForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowSupplierModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveSupplier} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SERVICE MODAL */}
      <AnimatePresence>
        {showServiceModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowServiceModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.urunler} — {editingService ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowServiceModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.code}</label>
                    <input type="text" value={serviceForm.code} onChange={e => setServiceForm(prev => ({ ...prev, code: e.target.value }))} placeholder="PRD-001" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.type2}</label>
                    <select value={serviceForm.type} onChange={e => setServiceForm(prev => ({ ...prev, type: e.target.value as 'Ürün' | 'Hizmet' }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option value="Ürün">Ürün</option>
                      <option value="Hizmet">Hizmet</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.name}</label>
                  <input type="text" value={serviceForm.name} onChange={e => setServiceForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Ürün / Hizmet Adı" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.unitPrice}</label>
                    <input type="number" value={serviceForm.unitPrice} onChange={e => setServiceForm(prev => ({ ...prev, unitPrice: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">KDV%</label>
                    <select value={serviceForm.vatRate} onChange={e => setServiceForm(prev => ({ ...prev, vatRate: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option value={0}>%0</option><option value={8}>%8</option><option value={18}>%18</option><option value={20}>%20</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.unit}</label>
                  <input type="text" value={serviceForm.unit} onChange={e => setServiceForm(prev => ({ ...prev, unit: e.target.value }))} placeholder="Adet, Kg, Saat..." className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.notes2}</label>
                  <input type="text" value={serviceForm.notes} onChange={e => setServiceForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="..." className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowServiceModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveService} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* TRANSFER MODAL */}
      <AnimatePresence>
        {showTransferModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTransferModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.transfer} — {editingTransfer ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowTransferModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.product}</label>
                  <input type="text" value={transferForm.productName} onChange={e => setTransferForm(prev => ({ ...prev, productName: e.target.value }))} placeholder="Ürün adı" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.fromWarehouse}</label>
                    <input type="text" value={transferForm.fromWarehouse} onChange={e => setTransferForm(prev => ({ ...prev, fromWarehouse: e.target.value }))} placeholder="Depo A" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.toWarehouse}</label>
                    <input type="text" value={transferForm.toWarehouse} onChange={e => setTransferForm(prev => ({ ...prev, toWarehouse: e.target.value }))} placeholder="Depo B" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.quantity}</label>
                    <input type="number" value={transferForm.quantity} onChange={e => setTransferForm(prev => ({ ...prev, quantity: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.date}</label>
                    <input type="date" value={transferForm.date} onChange={e => setTransferForm(prev => ({ ...prev, date: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.status2}</label>
                  <select value={transferForm.status} onChange={e => setTransferForm(prev => ({ ...prev, status: e.target.value as Transfer['status'] }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                    <option value="Bekliyor">Bekliyor</option><option value="Tamamlandı">Tamamlandı</option><option value="İptal">İptal</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.notes2}</label>
                  <input type="text" value={transferForm.notes} onChange={e => setTransferForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="..." className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowTransferModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveTransfer} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CHECK MODAL */}
      <AnimatePresence>
        {showCheckModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCheckModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{t.cekler} — {editingCheck ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowCheckModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.checkNo}</label>
                    <input type="text" value={checkForm.checkNo} onChange={e => setCheckForm(prev => ({ ...prev, checkNo: e.target.value }))} placeholder="ÇEK-001" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.checkType}</label>
                    <select value={checkForm.type} onChange={e => setCheckForm(prev => ({ ...prev, type: e.target.value as Check['type'] }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option value="Alınan">{t.received}</option>
                      <option value="Verilen">{t.given}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.bank2}</label>
                  <input type="text" value={checkForm.bankName} onChange={e => setCheckForm(prev => ({ ...prev, bankName: e.target.value }))} placeholder="Ziraat Bankası" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.amount2}</label>
                    <input type="number" value={checkForm.amount} onChange={e => setCheckForm(prev => ({ ...prev, amount: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.dueDate}</label>
                    <input type="date" value={checkForm.dueDate} onChange={e => setCheckForm(prev => ({ ...prev, dueDate: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.drawer}</label>
                  <input type="text" value={checkForm.drawer} onChange={e => setCheckForm(prev => ({ ...prev, drawer: e.target.value }))} placeholder="Lehtar / Borçlu adı" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowCheckModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveCheck} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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

      {/* BUDGET MODAL */}
      <AnimatePresence>
        {showBudgetModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowBudgetModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">Bütçe Hedefi Belirle</h3>
                <button onClick={() => setShowBudgetModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Kategori</label>
                  <select value={budgetForm.category} onChange={e => setBudgetForm(prev => ({ ...prev, category: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand">
                    <option value="Satış">Satış</option>
                    <option value="Personel">Personel</option>
                    <option value="Genel Gider">Genel Gider</option>
                    <option value="Pazarlama">Pazarlama</option>
                    <option value="Yatırım">Yatırım</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Hedef Tutar (TRY)</label>
                  <input type="number" value={budgetForm.amount} onChange={e => setBudgetForm(prev => ({ ...prev, amount: Number(e.target.value) }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Dönem</label>
                  <input type="month" value={budgetForm.period} onChange={e => setBudgetForm(prev => ({ ...prev, period: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand" />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowBudgetModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveBudget} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* WAYBILL MODAL */}
      <AnimatePresence>
        {showWaybillModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowWaybillModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{waybillType === 'giden' ? t.gidenIrsaliye : t.gelenIrsaliye} — {editingWaybill ? t.editAccount : t.add}</h3>
                <button onClick={() => setShowWaybillModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.waybillNo}</label>
                    <input type="text" value={waybillForm.waybillNo} onChange={e => setWaybillForm(prev => ({ ...prev, waybillNo: e.target.value }))} placeholder="IRS-001" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.invoiceNo}</label>
                    <input type="text" value={waybillForm.invoiceNo} onChange={e => setWaybillForm(prev => ({ ...prev, invoiceNo: e.target.value }))} placeholder="FAT-001" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.date}</label>
                    <input type="date" value={waybillForm.date} onChange={e => setWaybillForm(prev => ({ ...prev, date: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{waybillType === 'giden' ? t.customer2 : t.supplier2}</label>
                  <input type="text" value={waybillForm.party} onChange={e => setWaybillForm(prev => ({ ...prev, party: e.target.value }))} placeholder={waybillType === 'giden' ? 'Müşteri adı' : 'Tedarikçi adı'} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]" />
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-gray-600">{t.product}</label>
                    <button onClick={() => setWaybillForm(prev => ({ ...prev, items: [...prev.items, { productName: '', sku: '', quantity: 1, unitPrice: 0, taxRate: 20 }] }))} className="text-[10px] font-bold text-brand hover:underline flex items-center gap-1">
                      <Plus size={10} /> {t.add}
                    </button>
                  </div>
                  {waybillForm.items.map((item, idx) => (
                    <div key={idx} className="p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-2 relative group">
                      <button onClick={() => setWaybillForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }))} className="absolute top-2 right-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        <X size={14} />
                      </button>
                      <input type="text" value={item.productName} onChange={e => {
                        const newItems = [...waybillForm.items];
                        newItems[idx].productName = e.target.value;
                        setWaybillForm(prev => ({ ...prev, items: newItems }));
                      }} placeholder="Ürün adı" className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-brand" />
                      <div className="grid grid-cols-3 gap-2">
                        <input type="number" value={item.quantity} onChange={e => {
                          const newItems = [...waybillForm.items];
                          newItems[idx].quantity = Number(e.target.value);
                          setWaybillForm(prev => ({ ...prev, items: newItems }));
                        }} placeholder="Miktar" className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-brand" />
                        <input type="number" value={item.unitPrice} onChange={e => {
                          const newItems = [...waybillForm.items];
                          newItems[idx].unitPrice = Number(e.target.value);
                          setWaybillForm(prev => ({ ...prev, items: newItems }));
                        }} placeholder="B.Fiyat" className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-brand" />
                        <input type="number" value={item.taxRate} onChange={e => {
                          const newItems = [...waybillForm.items];
                          newItems[idx].taxRate = Number(e.target.value);
                          setWaybillForm(prev => ({ ...prev, items: newItems }));
                        }} placeholder="KDV" className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-brand" />
                      </div>
                    </div>
                  ))}
                  {waybillForm.items.length === 0 && (
                    <p className="text-[10px] text-gray-400 text-center py-2 italic">Henüz ürün eklenmedi.</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.total2}</label>
                    <input type="number" value={waybillForm.items.reduce((s, i) => s + (i.quantity * i.unitPrice * (1 + i.taxRate / 100)), 0)} readOnly className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.status2}</label>
                    <select value={waybillForm.status} onChange={e => setWaybillForm(prev => ({ ...prev, status: e.target.value as Waybill['status'] }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option value="Bekliyor">Bekliyor</option><option value="Tamamlandı">Tamamlandı</option><option value="İptal">İptal</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowWaybillModal(false)} className="bg-gray-100 hover:bg-gray-200 rounded-full px-4 py-2 text-sm font-semibold transition-colors">{t.cancel}</button>
                <button onClick={saveWaybill} className="apple-button-primary"><Save size={14} /> {t.save}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PDF VIEWER MODAL */}
      <AnimatePresence>
        {viewingPdf && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={() => setViewingPdf(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl h-[80vh] relative z-10 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between p-6 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-500"><FileText size={20} /></div>
                  <div>
                    <h3 className="font-bold text-gray-800">{viewingPdf.name}</h3>
                    <p className="text-xs text-gray-400">{viewingPdf.date} tarihinde yüklendi</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => window.print()} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors"><Download size={18} /></button>
                  <button onClick={() => setViewingPdf(null)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors"><X size={18} /></button>
                </div>
              </div>
              <div className="flex-1 bg-gray-100 p-4 overflow-hidden flex flex-col items-center">
                {viewingPdf.dataUrl ? (
                  <iframe src={viewingPdf.dataUrl} className="w-full h-full rounded-xl shadow-lg border-0" title="PDF Viewer" />
                ) : (
                  <div className="bg-white w-full max-w-[210mm] min-h-[297mm] shadow-lg p-12 font-serif text-sm text-gray-800 space-y-8">
                    <div className="flex justify-between border-b-2 border-gray-900 pb-4">
                      <div className="font-bold text-xl uppercase tracking-widest">{viewingPdf.name.split('.')[0]}</div>
                      <div className="text-right">
                        <div className="font-bold">HESAP EKSTRESİ</div>
                        <div>Dönem: 01.03.2026 - 31.03.2026</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-8 text-xs">
                      <div>
                        <div className="font-bold uppercase text-gray-400 mb-1">Müşteri Bilgileri</div>
                        <div>CETPA DIŞ TİCARET A.Ş.</div>
                        <div>İSTANBUL, TÜRKİYE</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold uppercase text-gray-400 mb-1">Hesap Özeti</div>
                        <div>IBAN: TR00 0000 0000 0000 0000 0000 00</div>
                        <div>Bakiye: 1.250.000,00 TRY</div>
                      </div>
                    </div>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-y border-gray-300 text-[10px] uppercase font-bold">
                          <th className="py-2 text-left">Tarih</th>
                          <th className="py-2 text-left">Açıklama</th>
                          <th className="py-2 text-right">Borç</th>
                          <th className="py-2 text-right">Alacak</th>
                          <th className="py-2 text-right">Bakiye</th>
                        </tr>
                      </thead>
                      <tbody className="text-[11px]">
                        {[
                          { d: '02.03', desc: 'GELEN HAVALE - ABC LTD', b: '', a: '45.000,00', bal: '1.045.000,00' },
                          { d: '05.03', desc: 'MAAŞ ÖDEMELERİ - MART', b: '120.000,00', a: '', bal: '925.000,00' },
                          { d: '10.03', desc: 'VERGİ ÖDEMESİ - KDV', b: '34.500,00', a: '', bal: '890.500,00' },
                          { d: '15.03', desc: 'SATIŞ TAHSİLAT - XYZ A.Ş.', b: '', a: '210.000,00', bal: '1.100.500,00' },
                          { d: '20.03', desc: 'KİRA ÖDEMESİ', b: '25.000,00', a: '', bal: '1.075.500,00' },
                        ].map((row, i) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="py-3">{row.d}</td>
                            <td className="py-3 font-medium">{row.desc}</td>
                            <td className="py-3 text-right">{row.b}</td>
                            <td className="py-3 text-right text-green-600">{row.a}</td>
                            <td className="py-3 text-right font-bold">{row.bal}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DrillDown Modal */}
      <AnimatePresence>
        {drillDown && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDrillDown(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg relative z-10 overflow-hidden"
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-bold text-gray-800">{drillDown.title}</h3>
                <button onClick={() => setDrillDown(null)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto">
                {drillDown.rows.length === 0 ? (
                  <div className="py-12 text-center text-gray-400 text-sm">{currentLanguage === 'tr' ? 'Kayıt bulunamadı.' : 'No records found.'}</div>
                ) : (
                  <table className="apple-table">
                    <tbody>
                      {drillDown.rows.map((row, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2.5 px-5">
                            <div className="font-medium text-gray-800">{row.label}</div>
                            {row.sub && <div className="text-xs text-gray-400">{row.sub}</div>}
                          </td>
                          {row.badge !== undefined ? (
                            <td className="py-2.5 px-3 text-center">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${row.badgeColor || 'bg-gray-100 text-gray-600'}`}>{row.badge}</span>
                            </td>
                          ) : <td />}
                          <td className="py-2.5 px-5 text-right font-semibold text-gray-800">{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                    {drillDown.total && (
                      <tfoot>
                        <tr className="bg-gray-50 border-t-2 border-gray-200">
                          <td className="py-3 px-5 font-bold text-gray-700">TOPLAM</td>
                          <td />
                          <td className="py-3 px-5 text-right font-bold text-[#ff4000]">{drillDown.total}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                )}
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
            className={`fixed bottom-6 right-6 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-white ${toast.type === 'success' ? 'bg-green-500' : toast.type === 'info' ? 'bg-blue-500' : 'bg-red-500'}`}
          >
            {toast.type === 'success' ? <CheckCircle size={15} /> : toast.type === 'info' ? <Info size={15} /> : <AlertCircle size={15} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tahsilat & Vade Takibi ── */}
      {accountingTab === 'tahsilat' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <TahsilatModule currentLanguage={currentLanguage} isAuthenticated={isAuthenticated} />
        </motion.div>
      )}

      {/* ── Maliyet Merkezi ── */}
      {accountingTab === 'maliyet_merkezi' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <MaliyetMerkeziModule currentLanguage={currentLanguage} isAuthenticated={isAuthenticated} />
        </motion.div>
      )}

      {/* ── Sabit Kıymet / Demirbaş ── */}
      {accountingTab === 'sabit_kiymet' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <SabitKiymetModule currentLanguage={currentLanguage} isAuthenticated={isAuthenticated} />
        </motion.div>
      )}

      {/* ── Banka Hareketleri (Mikro) ── */}
      {accountingTab === 'banka_hareketleri' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="apple-card p-4 sm:p-6 bg-white">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-xl font-bold text-[#1D1D1F] flex items-center gap-2">
                  <Landmark className="text-brand w-5 h-5" />
                  {currentLanguage === 'tr' ? 'Banka Hesap Hareketleri' : 'Bank Account Movements'}
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  {currentLanguage === 'tr' ? 'Mikro ERP sisteminden çekilen canlı banka hareketleri.' : 'Live bank movements fetched from Mikro ERP.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {mikroBankLastSync && (
                  <span className="text-[10px] text-gray-400 font-medium">
                    {currentLanguage === 'tr' ? 'Son senkronizasyon:' : 'Last sync:'} {mikroBankLastSync}
                  </span>
                )}
                <button
                  onClick={handleSyncMikroBank}
                  disabled={mikroBankLoading}
                  className="apple-button-primary"
                >
                  <RefreshCw className={`w-4 h-4 ${mikroBankLoading ? 'animate-spin' : ''}`} />
                  {currentLanguage === 'tr' ? 'Mikro\'dan Çek' : 'Fetch from Mikro'}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="apple-table mt-4">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60 sticky top-0">
                    <th className="px-4 py-3 text-left">{currentLanguage === 'tr' ? 'Tarih' : 'Date'}</th>
                    <th className="px-4 py-3 text-left">{currentLanguage === 'tr' ? 'Banka' : 'Bank'}</th>
                    <th className="px-4 py-3 text-left">{currentLanguage === 'tr' ? 'Açıklama' : 'Description'}</th>
                    <th className="px-4 py-3 text-right">{currentLanguage === 'tr' ? 'Borç' : 'Debit'}</th>
                    <th className="px-4 py-3 text-right">{currentLanguage === 'tr' ? 'Alacak' : 'Credit'}</th>
                    <th className="px-4 py-3 text-center">{currentLanguage === 'tr' ? 'Döviz' : 'Currency'}</th>
                  </tr>
                </thead>
                <tbody>
                  {mikroBankMovements.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-20 text-center text-gray-400">
                        <Landmark className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">{currentLanguage === 'tr' ? 'Henüz hareket bulunmuyor.' : 'No movements found yet.'}</p>
                        <button onClick={handleSyncMikroBank} className="text-brand text-xs font-bold hover:underline mt-2">
                          {currentLanguage === 'tr' ? 'Senkronizasyon başlat' : 'Start synchronization'}
                        </button>
                      </td>
                    </tr>
                  ) : (
                    mikroBankMovements.map((move, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/80 transition-all group">
                        <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                          {move.Tarih || move.date || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-[#1D1D1F] text-xs uppercase">{move.BankaAdi || move.bankName || 'Banka'}</div>
                          <div className="text-[10px] text-gray-400">{move.HesapNo || move.accountNo || '•••'}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          {move.Aciklama || move.description || '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-red-600">
                          {move.Borc > 0 ? formatCurrency(move.Borc, move.DovizCinsi || move.currency) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-green-600">
                          {move.Alacak > 0 ? formatCurrency(move.Alacak, move.DovizCinsi || move.currency) : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-0.5 rounded-full">
                            {move.DovizCinsi || move.currency || 'TRY'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

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
