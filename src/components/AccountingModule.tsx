import { useState, useEffect, useRef } from 'react';
import { type MuhasebeMenuItem, type MuhasebeTarget } from '../lib/muhasebeMenu';
import { authFetch } from '../services/authFetch';
import DekontModal from './DekontModal';
import MikroFaturaDetay, { type MikroFaturaDetayVerisi } from './MikroFaturaDetay';
import CeklerTab from './accounting/CeklerTab';
import CalisanlarTab from './accounting/CalisanlarTab';
import ButceTab from './accounting/ButceTab';
import IsletmeSermayesiTab from './accounting/IsletmeSermayesiTab';
import UrunlerTab from './accounting/UrunlerTab';
import WarehousesTab from './accounting/WarehousesTab';
import DepoTab from './accounting/DepoTab';
import TransferTab from './accounting/TransferTab';
import YevmiyeTab from './accounting/YevmiyeTab';
import MizanTab from './accounting/MizanTab';
import GelirGiderTab from './accounting/GelirGiderTab';
import KdvTab from './accounting/KdvTab';
import TedarikcilerTab from './accounting/TedarikcilerTab';
import MusterilerTab from './accounting/MusterilerTab';
import SatislarTab from './accounting/SatislarTab';
import BankaTab from './accounting/BankaTab';
import GidenIrsaliyeTab from './accounting/GidenIrsaliyeTab';
import GelenIrsaliyeTab from './accounting/GelenIrsaliyeTab';
import BankaHareketleriTab from './accounting/BankaHareketleriTab';
import GelirTablosuTab from './accounting/GelirTablosuTab';
import FaturalarTab from './accounting/FaturalarTab';
import { dekontPayload } from '../services/mikroEvrak';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Download, Building2, BookOpen, TrendingUp,
  X, Save, Calculator, BarChart3, FileText, Briefcase,
  AlertCircle, CheckCircle, Info, ArrowUpDown, ShoppingCart, Users, Truck, Package,
  ArrowRightLeft, CreditCard, FileUp, FileDown, Home,
  Wallet, Layers, Landmark, Palette} from 'lucide-react';
import TahsilatModule from './TahsilatModule';
import KasaModule from './KasaModule';
import MaliyetMerkeziModule from './MaliyetMerkeziModule';
import SabitKiymetModule from './SabitKiymetModule';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { registerTurkishFont } from '../utils/pdfFont';
import DocumentDesigner from './DocumentDesigner';
import { useMikroFaturalar } from '../hooks/useMikroFaturalar';
import { db, auth } from '../firebase';
import { 
  pullBankMovementsFromMikro
} from '../services/mikroService';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, setDoc, onSnapshot, query, serverTimestamp
} from '../lib/dbClient';
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
import { confirmAction } from '../lib/confirm';
import { sortByCreatedAt } from '../utils/fsSort';

// --- SortHeader Component ---
export const SortHeader = ({ 
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
  // ── Birleşik Muhasebe menüsü (2026-07-21) ──────────────────────────────────
  // navMenu verilirse sekme barı bu birleşik listeden render edilir (sidebar ile
  // aynı). Muhasebe-dışı hedefler onNavigate ile üst seviyeye bildirilir.
  // controlledTab+onControlledTabChange verilirse sekme kontrollü olur (sidebar'dan
  // AccountingModule sekmesi açılabilsin diye). Yalnız MuhasebePage bunları geçer;
  // CRM/Orders gömüleri eskisi gibi allowedTabs ile tek-sekme çalışır.
  navMenu?: MuhasebeMenuItem[];
  onNavigate?: (target: MuhasebeTarget) => void;
  controlledTab?: string;
  onControlledTabChange?: (tab: string) => void;
  // Sekme barını gizle — MuhasebePage kalıcı birleşik barı kendisi render eder
  // (bar AccountingModule içinde kalırsa rapor sekmesine geçince kayboluyordu).
  hideTabBar?: boolean;
}

export const HESAP_PLANI = [
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

export const formatTRY = (n: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n);

export const formatCurrency = (n: number, currency: string = 'TRY') =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency.toUpperCase() }).format(n);

export const exportCSV = (filename: string, headers: string[], rows: (string | number)[][]) => {
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

export const AT = {
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
    satislar: 'Satışlar', musteriler: 'Cariler', tedarikciler: 'Tedarikçiler',
    urunler: 'Hizmet & Ürünler', depo: 'Depo', transfer: 'Depolar Arası',
    cekler: 'Çekler', calisanlar: 'Çalışanlar', gidenIrsaliye: 'Giden İrsaliye',
    gelenIrsaliye: 'Gelen İrsaliye', butce: 'Bütçe', isletme_sermayesi: 'İşletme Sermayesi',
    tahsilat: 'Tahsilat & Vade', maliyet_merkezi: 'Maliyet Merkezi', sabit_kiymet: 'Sabit Kıymet',
    noRecords: 'Kayıt bulunamadı.', add: 'Ekle', name: 'Ad', company: 'Şirket',
    email: 'E-posta', phone: 'Telefon', address: 'Adres', notes2: 'Notlar',
    taxNo: 'Vergi No', code: 'Kod', type2: 'Tür', unitPrice: 'Birim Fiyat',
    unit: 'Birim', location: 'Konum', fromWarehouse: 'Çıkış Deposu', toWarehouse: 'Giriş Deposu', selectWarehouse: 'Depo seçin',
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
    satislar: 'Sales', musteriler: 'Accounts', tedarikciler: 'Suppliers',
    urunler: 'Services & Products', depo: 'Warehouse', transfer: 'Inter-Warehouse',
    cekler: 'Checks', calisanlar: 'Employees', gidenIrsaliye: 'Outgoing Waybills',
    gelenIrsaliye: 'Incoming Waybills', butce: 'Budget', isletme_sermayesi: 'Working Capital',
    tahsilat: 'Collections & Due Dates', maliyet_merkezi: 'Cost Centers', sabit_kiymet: 'Fixed Assets',
    noRecords: 'No records found.', add: 'Add', name: 'Name', company: 'Company',
    email: 'Email', phone: 'Phone', address: 'Address', notes2: 'Notes',
    taxNo: 'Tax No', code: 'Code', type2: 'Type', unitPrice: 'Unit Price',
    unit: 'Unit', location: 'Location', fromWarehouse: 'From Warehouse', toWarehouse: 'To Warehouse', selectWarehouse: 'Select warehouse',
    product: 'Product', quantity: 'Quantity', checkNo: 'Check No', bank2: 'Bank',
    amount2: 'Amount', dueDate: 'Due Date', drawer: 'Drawer/Payee', checkType: 'Check Type',
    received: 'Received', given: 'Given', position: 'Position', department: 'Department',
    salary: 'Salary', startDate: 'Start Date', waybillNo: 'Waybill No', invoiceNo: 'Invoice No', customer2: 'Customer',
    supplier2: 'Supplier', status2: 'Status', total2: 'Total', pending2: 'Pending',
    completed2: 'Completed', cancelled2: 'Cancelled',
  },
} as const;

export type AccountingT = typeof AT[keyof typeof AT];

export default function AccountingModule({ orders = [], currentLanguage, isAuthenticated = false, userRole, exchangeRates, initialTab, allowedTabs, createNotification, warehouses: warehousesProp, employees: employeesProp, navMenu, onNavigate, controlledTab, onControlledTabChange, hideTabBar }: AccountingModuleProps) {
  const t = AT[currentLanguage];
  const MONTHS = currentLanguage === 'en' ? MONTHS_EN : MONTHS_TR;
  const resolvedInitialTab = (() => {
    const tab = initialTab || 'banka';
    if (allowedTabs && allowedTabs.length > 0 && !allowedTabs.includes(tab)) return allowedTabs[0];
    return tab;
  })();
  // Kontrollü mod: controlledTab verilirse aktif sekme dışarıdan gelir (sidebar
  // ile senkron). setAccountingTab çağrıları değişmeden çalışır — sadece kaynak/
  // hedef değişir. accountingTab okumaları (31 yer) aynen geçerli kalır.
  const [internalTab, setInternalTab] = useState<string>(resolvedInitialTab);
  const accountingTab = controlledTab ?? internalTab;
  const setAccountingTab = (k: string) => {
    if (onControlledTabChange) onControlledTabChange(k);
    else setInternalTab(k);
  };

  useEffect(() => {
    if (warehousesProp) setWarehouses(warehousesProp);
  }, [warehousesProp]);

  useEffect(() => {
    if (employeesProp) setEmployees(employeesProp);
  }, [employeesProp]);

  const [showWarehouseModal, setShowWarehouseModal] = useState(false);
  const [warehouseForm, setWarehouseForm] = useState({ name: '', location: '', manager: '', notes: '' });
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  // Depo Tanımları kartına tıklayınca o depodaki envanteri gösteren detay (2026-08-01).
  const [detayDepo, setDetayDepo] = useState<Warehouse | null>(null);
  // Müşteriye tıklayınca cari ekstre/hareket detayını gösteren modal (2026-08-01).
  const [ekstreMusteri, setEkstreMusteri] = useState<Customer | null>(null);
  // Tedarikçiye tıklayınca aynı ekstre/hareket detayı — Mikro'da tek cari havuzu
  // olduğundan tedarikçinin mikroCariKod'u da mikroCariHareketler'de var (2026-08-13,
  // kullanıcı bulgusu: Tedarikçiler'deki göz ikonu Düzenle ile aynı şeyi yapıyordu).
  const [ekstreTedarikci, setEkstreTedarikci] = useState<Supplier | null>(null);

  const [showStockModal, setShowStockModal] = useState(false);
  const [stockForm, setStockForm] = useState({ productName: '', sku: '', quantity: 0, warehouseId: '', category: '', notes: '' });
  const [editingStock, setEditingStock] = useState<WarehouseItem | null>(null);
  // Dekont modalı hedefi (null = kapalı). Bkz. müşteri satırındaki Mikro düğmesi.
  const [dekontHedef, setDekontHedef] = useState<{ cariKod: string; ad: string; bakiye: number; id: string } | null>(null);
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
    const unsub = onSnapshot(query(collection(db, 'invoices')), snap => {
      setInvoices(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    }, () => {});
    return unsub;
  }, []);

  const handleCreateInvoice = async () => {
    const src = invoiceSource;
    const lineItems = src ? (src.lineItems as Record<string,unknown>[] || []) : [];
    const totalPrice = src ? (src.totalPrice as number || 0) : 0;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const kdvHaric = round2(totalPrice / (1 + invoiceForm.kdvOran / 100));
    const kdvTutari = round2(totalPrice - kdvHaric);
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
    accountType: 'Vadesiz' as 'Vadesiz' | 'Vadeli' | 'Kredi' | 'Kasa' | 'Akreditif (L/C)' | 'Teminat Mektubu',
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
  const [lucaLastSync, setLucaLastSync] = useState<string | null>(null);
  const [lucaConnected, setLucaConnected] = useState(false);

  // Mikro
  const [mikroEnabled, setMikroEnabled] = useState(true);
  const [mikroAccessToken, setMikroAccessToken] = useState('');
  const [mikroEndpoint, setMikroEndpoint] = useState('https://jumpbulutapigw.mikro.com.tr/ApiJB/ApiMethods');
  const [mikroConnected, setMikroConnected] = useState(false);
  const [mikroLastSync, setMikroLastSync] = useState<string | null>(null);

  // New tab states
  const [customers, setCustomers] = useState<Customer[]>([]);
  /** Mikro faturaları — Satışlar sekmesinde Cetpa satışlarının YANINDA gösterilir.
   *  Kullanıcı tanımı (2026-07-31): "satışlar = faturalar ama Q serisi = faturasız
   *  satış; Mikro faturalarını DA orada görmem gerekli."
   *  Bu yüzden mevcut orders tabanlı KPI'lara ve faturalı/faturasız ayrımına
   *  DOKUNULMAZ — Mikro yalnız EK bir kaynak olarak eklenir. */
  // mikroFaturalar ortak hook'tan — cha_* eşlemesi tek yerde (useMikroFaturalar).
  const mikroFaturalar = useMikroFaturalar(isAuthenticated && !!userRole);
  // Varsayılan 'hepsi': Mikro satış faturaları da görünsün. Eskiden 'cetpa'
  // idi ve Cetpa siparişi 0 olduğu için Satışlar ekranı bomboş açılıyordu (2026-08-01).
  const [satisKaynak, setSatisKaynak] = useState<'cetpa' | 'mikro' | 'hepsi'>('hepsi');
  /** Faturalar sekmesi kaynak seçici — Satışlar'daki desenin aynısı.
   *  Bu ekran `invoices` (Cetpa'da kesilen) okuyor; Mikro'dan çekilenler
   *  `mikroFaturalar`da duruyor ve hiç görünmüyordu. Varsayılan 'cetpa'. */
  const [faturaKaynak, setFaturaKaynak] = useState<'cetpa' | 'mikro' | 'hepsi'>('hepsi');
  /** Fatura yönü — Mikro'da hem giden (satış) hem gelen (alış) fatura var.
   *  Gelen faturalar 2026-08-01'e kadar hiç gösterilmiyordu. */
  const [faturaYon, setFaturaYon] = useState<'hepsi' | 'giden' | 'gelen'>('hepsi');
  // Fatura yıl filtresi — import TÜM yılları çekiyor (2020+), KPI hepsini
  // topluyordu; kullanıcı 2026 raporuyla karşılaştırınca "132M hatalı" sandı.
  // Aslında cha_cinsi=6 doğru; 2026 alışı 12,8M (portal 13,9M ✓). Varsayılan
  // cari yıl; 'hepsi' ile tüm zamanlar.
  const [faturaYil, setFaturaYil] = useState<string>(String(new Date().getFullYear()));
  // Satışlar sekmesinin KENDİ yıl kapsamı — Faturalar sekmesinden bağımsız.
  // Varsayılan cari yıl: tüm yılları toplamak all-time balon ciro gösterir.
  const [satisYil, setSatisYil] = useState<string>(String(new Date().getFullYear()));
  /** Fatura detay penceresi (XML/PDF indirme) — 2026-08-01 kullanıcı isteği. */
  const [faturaDetay, setFaturaDetay] = useState<MikroFaturaDetayVerisi | null>(null);
  const [mikroSuppliers, setMikroSuppliers] = useState<Supplier[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [warehouseItems, setWarehouseItems] = useState<WarehouseItem[]>([]);
  // Cari bakiyeleri (cariBalances) — Müşteri/Tedarikçi OLMAYAN ama bakiyesi olan
  // cariler ("gider/diğer", ör. 7 Mehmet) rozetlensin. pull/bakiye doldurur.
  const [cariBalanceKodSet, setCariBalanceKodSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!isAuthenticated || !userRole) return;
    const unsub = onSnapshot(collection(db, 'cariBalances'), s => {
      const set = new Set<string>();
      s.docs.forEach(d => {
        const x = d.data() as Record<string, unknown>;
        const kod = String(x.cariKod ?? d.id).trim();
        if (kod && Number(x.bakiye ?? 0) !== 0) set.add(kod);
      });
      setCariBalanceKodSet(set);
    }, (error) => logFirestoreError(error, OperationType.LIST, 'cariBalances'));
    return () => unsub();
  }, [isAuthenticated, userRole]);
  // İşletme sermayesi — editlenebilir kalemler (settings/workingCapital'da saklanır)
  type WCField = 'kasaBanka' | 'ticariAlacaklar' | 'stoklar' | 'ticariBorclar' | 'vergiSgk' | 'krediler';
  const [workingCapital, setWorkingCapital] = useState<Record<WCField, number>>({
    kasaBanka: 0, ticariAlacaklar: 0, stoklar: 0, ticariBorclar: 0, vergiSgk: 0, krediler: 0,
  });
  const [wcSaved, setWcSaved] = useState(false);
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
  // Mikro Bank Movements
  const [mikroBankMovements, setMikroBankMovements] = useState<any[]>([]);
  const [mikroBankLoading, setMikroBankLoading] = useState(false);
  const [mikroBankLastSync, setMikroBankLastSync] = useState<string | null>(null);
  const [showErpConfig, setShowErpConfig] = useState(false); // ERP bağlantı ayarları formu (Mikro/Luca kimlik)
  const [erpConfigSaving, setErpConfigSaving] = useState<'mikro' | 'luca' | null>(null);

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
  const [satisSortKey, setSatisSortKey] = useState<'customerName' | 'totalPrice' | 'date' | 'faturali' | 'kdvOran'>('date');
  const [satisSortDir, setSatisSortDir] = useState<'asc' | 'desc'>('desc');
  const [satisSearch, setSatisSearch] = useState('');
  const [kpiCurrency, setKpiCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const kpiRate = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
  const kpiSym = kpiCurrency === 'TRY' ? '₺' : kpiCurrency === 'USD' ? '$' : '€';
  const formatConv = (n: number) => kpiCurrency === 'TRY'
    ? formatTRY(n)
    : `${kpiSym}${(n / kpiRate).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const [musteriSortKey, setMusteriSortKey] = useState<'name' | 'company' | 'phone' | 'balance' | 'riskGroup'>('name');
  const [musteriSortDir, setMusteriSortDir] = useState<'asc' | 'desc'>('asc');
  const [tedarikciSortKey, setTedarikciSortKey] = useState<'name' | 'company' | 'phone' | 'email' | 'taxNo' | 'balance' | 'riskGroup'>('name');
  const [tedarikciSortDir, setTedarikciSortDir] = useState<'asc' | 'desc'>('asc');
  const [servisSortKey, setServisSortKey] = useState<'name' | 'code' | 'unitPrice' | 'vatRate' | 'type' | 'unit'>('name');
  const [servisSortDir, setServisSortDir] = useState<'asc' | 'desc'>('asc');
  const [depoSortKey, setDepoSortKey] = useState<'productName' | 'quantity' | 'sku' | 'warehouseId' | 'category'>('productName');
  const [depoSortDir, setDepoSortDir] = useState<'asc' | 'desc'>('asc');
  const [transferSortKey, setTransferSortKey] = useState<'productName' | 'quantity' | 'date' | 'status' | 'fromWarehouse' | 'toWarehouse'>('date');
  const [transferSortDir, setTransferSortDir] = useState<'asc' | 'desc'>('desc');
  const [cekSortKey, setCekSortKey] = useState<'checkNo' | 'amount' | 'dueDate' | 'type' | 'bankName' | 'drawer'>('dueDate');
  const [cekSortDir, setCekSortDir] = useState<'asc' | 'desc'>('asc');
  const [calisanSortKey, setCalisanSortKey] = useState<'name' | 'position' | 'salary' | 'startDate' | 'department'>('name');
  const [calisanSortDir, setCalisanSortDir] = useState<'asc' | 'desc'>('asc');
  const [irsaliyeSortKey, setIrsaliyeSortKey] = useState<'waybillNo' | 'party' | 'date' | 'total' | 'status' | 'type'>('date');
  const [irsaliyeSortDir, setIrsaliyeSortDir] = useState<'asc' | 'desc'>('desc');

  // New tab form states
  const [customerForm, setCustomerForm] = useState({ name: '', company: '', email: '', phone: '', address: '', taxNo: '', taxOffice: '', notes: '', creditLimit: 0, balance: 0, riskGroup: 'Düşük' as 'Düşük' | 'Orta' | 'Yüksek' });
  const [supplierForm, setSupplierForm] = useState({ name: '', company: '', email: '', phone: '', address: '', taxNo: '', notes: '', balance: 0, riskGroup: 'Düşük' as 'Düşük' | 'Orta' | 'Yüksek' });
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
    warehouseId: string;
  }>({
    waybillNo: '', invoiceNo: '', party: '', date: format(new Date(), 'yyyy-MM-dd'),
    items: [], total: 0, status: 'Bekliyor', warehouseId: ''
  });

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // registerTurkishFont (Roboto) Türkçe glifleri kapsıyor — sadeleştirmeye
  // gerek yok, passthrough (2026-08-17, bkz. pdfFont.ts).
  const normTR = (s: string) => s;

  // GERÇEK PDF (buton "Beyanname PDF" diyor ama eskiden .txt indiriyordu).
  const downloadVatDeclaration = async () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    await registerTurkishFont(doc);
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(255, 64, 0);
    doc.rect(0, 0, W, 26, 'F');
    doc.setFont('Roboto', 'bold'); doc.setFontSize(16); doc.setTextColor(255, 255, 255);
    doc.text('KDV BEYANNAMESİ ÖZETİ', 14, 13);
    doc.setFont('Roboto', 'normal'); doc.setFontSize(9);
    doc.text(normTR(`Dönem: ${kdvMonth}/${kdvYear}`), 14, 20);
    autoTable(doc, {
      startY: 34,
      head: [['Kalem', 'Tutar']],
      body: [
        ['Hesaplanan KDV', normTR(formatTRY(hesaplananKDV))],
        ['İndirilecek KDV', normTR(formatTRY(indirilecekKDV))],
        ['Ödenecek/İade KDV', normTR(formatTRY(odenecekKDV))],
      ],
      styles: { font: 'Roboto', fontSize: 10 },
      headStyles: { fillColor: [29, 29, 31] },
    });
    const oranBody = Object.entries(kdvOranBreakdown).map(([oran, data]) => [
      oran === 'karma' ? (currentLanguage === 'tr' ? 'Karma' : 'Mixed') : `%${oran}`,
      normTR(formatTRY(data.matrah)), normTR(formatTRY(data.kdv)),
    ]);
    autoTable(doc, {
      startY: ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60) + 6,
      head: [['Oran', 'Matrah', 'KDV']],
      body: oranBody.length ? oranBody : [['—', '—', '—']],
      styles: { font: 'Roboto', fontSize: 10 },
      headStyles: { fillColor: [255, 64, 0] },
    });
    doc.save(`KDV_Beyanname_${kdvMonth}_${kdvYear}.pdf`);
    showToast(t.declarationPreparing);
  };

  // Excel/pivot çıktısı (CSV): ham SAYI değerleri (₺/format YOK) — Excel'de
  // toplanabilir/pivotlanabilir. Noktalı virgül ayraç (TR Excel ondalık virgül),
  // UTF-8 BOM (Türkçe karakter).
  const downloadVatDeclarationCSV = () => {
    const rows: (string | number)[][] = [
      ['KDV Beyannamesi Ozeti'],
      ['Donem', `${kdvMonth}/${kdvYear}`],
      [],
      ['Kalem', 'Tutar'],
      ['Hesaplanan KDV', Math.round(hesaplananKDV * 100) / 100],
      ['Indirilecek KDV', Math.round(indirilecekKDV * 100) / 100],
      ['Odenecek/Iade KDV', Math.round(odenecekKDV * 100) / 100],
      [],
      ['Oran (%)', 'Matrah', 'KDV'],
      ...Object.entries(kdvOranBreakdown).map(([oran, data]) => [
        oran, Math.round(data.matrah * 100) / 100, Math.round(data.kdv * 100) / 100,
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KDV_Beyanname_${kdvMonth}_${kdvYear}.csv`;
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
      setBankAccounts(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount))));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'bankAccounts'));
    return unsub;
  }, [isAuthenticated, userRole]);

  useEffect(() => {
    if (!isAuthenticated || !userRole) return;
    const unsub = onSnapshot(
      query(collection(db, 'bankTransactions')),
      snap => setBankTransactions(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as BankTransaction)))),
      () => {}
    );
    return unsub;
  }, [isAuthenticated, userRole]);

  useEffect(() => {
    if (!isAuthenticated || !userRole) return;
    const q = query(collection(db, 'journalEntries'));
    const unsub = onSnapshot(q, snap => {
      setJournalEntries(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as JournalEntry))));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'journalEntries'));
    return unsub;
  }, [isAuthenticated, userRole]);

  useEffect(() => {
    if (!isAuthenticated || !userRole) return;
    const unsubs = [
      // mikroFaturalar dinleyicisi useMikroFaturalar hook'una taşındı (eşleme tek yerde).
      // Müşteriler artık CRM ile ORTAK kaynaktan okunur: leads koleksiyonu.
      // (type==='Supplier' olanlar Tedarikçiler sekmesine aittir, burada gizlenir.)
      onSnapshot(collection(db, 'leads'), s => {
        // Mikro'dan gelen tedarikçiler (type==='Supplier') Tedarikçiler sekmesini besler
        setMikroSuppliers(
          s.docs
            .filter(d => (d.data().type as string) === 'Supplier')
            .map(d => {
              const x = d.data() as Record<string, unknown>;
              return {
                id: d.id,
                name:    (x.name as string) || (x.company as string) || '—',
                company: (x.company as string) || '',
                email:   (x.email as string) || '',
                phone:   (x.phone as string) || '',
                address: (x.address as string) || '',
                taxNo:   (x.taxId as string) || (x.taxNo as string) || '',
                taxOffice: (x.taxOffice as string) || '',
                notes:   (x.notes as string) || '',
                balance: Number(x.bakiye ?? x.balance ?? 0),
                riskGroup: (x.riskGroup as Supplier['riskGroup']) || 'Düşük',
                createdAt: x.createdAt,
              } as Supplier;
            })
        );
        setCustomers(
        s.docs
          .filter(d => ((d.data().type as string) ?? 'Customer') !== 'Supplier')
          .map(d => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              name:        (x.name as string) || (x.company as string) || '—',
              company:     (x.company as string) || '',
              email:       (x.email as string) || '',
              phone:       (x.phone as string) || '',
              address:     (x.address as string) || '',
              taxNo:       (x.taxId as string) || (x.taxNo as string) || '',
              taxOffice:   (x.taxOffice as string) || '',
              notes:       (x.notes as string) || '',
              creditLimit: Number(x.creditLimit ?? 0),
              balance:     Number(x.bakiye ?? x.balance ?? 0),
              riskGroup:   (x.riskGroup as Customer['riskGroup']) || 'Düşük',
              // Mikro cari kodu — Mikro faturalarında müşteri ADINI çözmek için
              // şart. Eşlemede yoktu, bu yüzden fatura satırlarında ad yerine
              // "1470747917" gibi cari kodu görünüyordu (2026-08-01).
              mikroCariKod: (x.mikroCariKod as string) || '',
              createdAt:   x.createdAt,
            } as Customer;
          })
      ); }, (error) => logFirestoreError(error, OperationType.LIST, 'leads')),
      onSnapshot(collection(db, 'suppliers'), s => setSuppliers(s.docs.map(d => ({ id: d.id, ...d.data() } as Supplier))), (error) => logFirestoreError(error, OperationType.LIST, 'suppliers')),
      onSnapshot(collection(db, 'services'), s => setServices(s.docs.map(d => ({ id: d.id, ...d.data() } as Service))), (error) => logFirestoreError(error, OperationType.LIST, 'services')),
      onSnapshot(collection(db, 'warehouseItems'), s => setWarehouseItems(s.docs.map(d => ({ id: d.id, ...d.data() } as WarehouseItem))), (error) => logFirestoreError(error, OperationType.LIST, 'warehouseItems')),
      onSnapshot(collection(db, 'transfers'), s => setTransfers(s.docs.map(d => ({ id: d.id, ...d.data() } as Transfer))), (error) => logFirestoreError(error, OperationType.LIST, 'transfers')),
      onSnapshot(collection(db, 'checks'), s => setChecks(s.docs.map(d => ({ id: d.id, ...d.data() } as Check))), (error) => logFirestoreError(error, OperationType.LIST, 'checks')),
      onSnapshot(collection(db, 'budgets'), s => setBudgets(s.docs.map(d => ({ id: d.id, ...d.data() } as Budget))), (error) => logFirestoreError(error, OperationType.LIST, 'budgets')),
      onSnapshot(collection(db, 'waybills'), s => setWaybills(s.docs.map(d => ({ id: d.id, ...d.data() } as Waybill))), (error) => logFirestoreError(error, OperationType.LIST, 'waybills')),
      onSnapshot(doc(db, 'settings', 'workingCapital'), s => {
        if (s.exists()) setWorkingCapital(prev => ({ ...prev, ...(s.data() as Partial<Record<WCField, number>>) }));
      }, () => { /* yoksa varsayılan 0 */ })
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

  // İşletme sermayesi: kalemi güncelle + settings'e kaydet (debounce'lu)
  const wcSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateWC = (field: WCField, value: number) => {
    setWorkingCapital(prev => {
      const next = { ...prev, [field]: value };
      if (wcSaveTimer.current) clearTimeout(wcSaveTimer.current);
      wcSaveTimer.current = setTimeout(() => {
        void setDoc(doc(db, 'settings', 'workingCapital'), { ...next, updatedAt: serverTimestamp() }, { merge: true })
          .then(() => { setWcSaved(true); setTimeout(() => setWcSaved(false), 1500); })
          .catch(() => { /* non-critical */ });
      }, 600);
      return next;
    });
  };
  // Gerçek veriden ön-doldur: alacaklar = ödenmemiş siparişler, stok = depo değeri
  const prefillWC = () => {
    const ar = orders
      .filter(o => !(o as unknown as { paid?: boolean }).paid && o.status !== 'Cancelled')
      .reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
    const stok = warehouseItems.reduce((s, w) => s + (Number(w.quantity) || 0) * (Number((w as unknown as { costPrice?: number }).costPrice) || 0), 0);
    const next = { ...workingCapital, ticariAlacaklar: Math.round(ar), stoklar: Math.round(stok) };
    setWorkingCapital(next);
    void setDoc(doc(db, 'settings', 'workingCapital'), { ...next, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
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
      const res = await pullBankMovementsFromMikro({}, config) as { notImplemented?: boolean; Data?: unknown[] };
      if (res?.notImplemented) {
        showToast(currentLanguage === 'tr' ? 'Mikro JumpBulut API\'sinde banka hareketi servisi bulunmuyor. Banka hesap tanımları Ayarlar > Mikro > "Bankalar" ile çekilebilir.' : 'Mikro JumpBulut API has no bank movement service. Bank account definitions can be pulled via Settings > Mikro > Banks.', 'info');
      } else if (res?.Data) {
        setMikroBankMovements(res.Data as never[]);
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
    const ok = await confirmAction({
      title: currentLanguage === 'tr' ? 'Hesabı Sil' : 'Delete Account',
      message: t.confirmDeleteAccount,
      confirmLabel: currentLanguage === 'tr' ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'bankAccounts', id));
      showToast(t.accountDeleted);
    } catch (error) {
      logFirestoreError(error, OperationType.DELETE, `bankAccounts/${id}`);
      showToast(t.deleteError, 'error');
    }
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
      if (result?.notImplemented) {
        showToast(currentLanguage === 'tr' ? 'Mikro JumpBulut API\'sinde banka hareketi servisi bulunmuyor. Banka hesap tanımları Ayarlar > Mikro > "Bankalar" ile çekilebilir.' : 'Mikro JumpBulut API has no bank movement service. Bank account definitions can be pulled via Settings > Mikro > Banks.', 'info');
        setBankTxPulling(false);
        return;
      }
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
    // Çift taraflı kayıt dengesi: borç == alacak (kuruş toleransı) ve pozitif.
    const jBorc = Number(journalForm.borc) || 0;
    const jAlacak = Number(journalForm.alacak) || 0;
    if (jBorc <= 0 || jAlacak <= 0) return showToast(currentLanguage === 'tr' ? 'Borç ve alacak tutarları sıfırdan büyük olmalı.' : 'Debit and credit must be positive.', 'error');
    if (Math.abs(jBorc - jAlacak) > 0.01) return showToast(currentLanguage === 'tr' ? `Fiş dengesiz: borç (${jBorc}) ≠ alacak (${jAlacak}).` : `Unbalanced entry: debit (${jBorc}) ≠ credit (${jAlacak}).`, 'error');
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
    const ok = await confirmAction({
      title: currentLanguage === 'tr' ? 'Kaydı Sil' : 'Delete Entry',
      message: t.confirmDeleteEntry,
      confirmLabel: currentLanguage === 'tr' ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'journalEntries', id));
      showToast(t.journalDeleted);
    } catch (error) {
      logFirestoreError(error, OperationType.DELETE, `journalEntries/${id}`);
      showToast(t.deleteError, 'error');
    }
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
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: currentLanguage === 'tr' ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'warehouses', id));
      showToast(t.accountDeleted);
    } catch (error) {
      logFirestoreError(error, OperationType.DELETE, `warehouses/${id}`);
      showToast(t.deleteError, 'error');
    }
  };

  const deleteStock = async (id: string) => {
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: currentLanguage === 'tr' ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'warehouseItems', id));
      showToast(t.accountDeleted);
    } catch (error) {
      logFirestoreError(error, OperationType.DELETE, `warehouseItems/${id}`);
      showToast(t.deleteError, 'error');
    }
  };

  const saveCustomer = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!customerForm.name.trim()) return showToast(t.bankNameRequired, 'error');

    // Duplicate onleme (yalniz yeni kayitta - duzenlemede kendisiyle kiyaslamaz):
    // VKN (normalize) -> case-insensitive isim. PurchasingModule tedarikci
    // deseniyle ayni oncelik sirasi.
    if (!editingCustomer) {
      const normalizeVkn = (v?: string) => (v || '').replace(/\D/g, '');
      const vkn = normalizeVkn(customerForm.taxNo);
      const nameKey = customerForm.name.trim().toLowerCase();
      const dup = customers.find(c => {
        if (vkn && normalizeVkn(c.taxNo) === vkn) return true;
        return c.name.trim().toLowerCase() === nameKey;
      });
      if (dup) {
        return showToast(
          currentLanguage === 'tr'
            ? `Bu VKN/isimde bir kayıt zaten var: "${dup.name}". Mevcut kaydı düzenleyin.`
            : `A record with this tax ID/name already exists: "${dup.name}". Please edit the existing record.`,
          'error'
        );
      }
    }

    try {
      // leads koleksiyonuna yaz — CRM ile ortak kaynak (taxNo → taxId eşlemesi)
      const leadPayload = {
        name:        customerForm.name,
        company:     customerForm.company,
        email:       customerForm.email,
        phone:       customerForm.phone,
        address:     customerForm.address,
        taxId:       customerForm.taxNo,
        taxOffice:   customerForm.taxOffice,
        notes:       customerForm.notes,
        creditLimit: customerForm.creditLimit,
        riskGroup:   customerForm.riskGroup,
        type:        'Customer',
        updatedAt:   serverTimestamp(),
      };
      if (editingCustomer) {
        await updateDoc(doc(db, 'leads', editingCustomer.id), leadPayload);
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'leads'), {
          ...leadPayload,
          status:       'Active',
          customerType: 'B2B',
          source:       'manual',
          companyId:    auth.currentUser?.uid ?? null,
          assignedTo:   auth.currentUser?.uid ?? null,
          createdAt:    serverTimestamp(),
        });
        showToast(t.accountAdded);
      }
      setShowCustomerModal(false);
      setCustomerForm({ name: '', company: '', email: '', phone: '', address: '', taxNo: '', taxOffice: '', notes: '', creditLimit: 0, balance: 0, riskGroup: 'Düşük' });
      setEditingCustomer(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteCustomer = async (id: string) => {
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: currentLanguage === 'tr' ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'leads', id)); // ortak kaynak: leads
      showToast(t.accountDeleted);
    } catch (error) {
      logFirestoreError(error, OperationType.DELETE, `customers/${id}`);
      showToast(t.deleteError, 'error');
    }
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
      setSupplierForm({ name: '', company: '', email: '', phone: '', address: '', taxNo: '', notes: '', balance: 0, riskGroup: 'Düşük' });
      setEditingSupplier(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteSupplier = async (id: string) => {
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: currentLanguage === 'tr' ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'suppliers', id));
      showToast(t.accountDeleted);
    } catch (error) {
      logFirestoreError(error, OperationType.DELETE, `suppliers/${id}`);
      showToast(t.deleteError, 'error');
    }
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
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: currentLanguage === 'tr' ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'services', id));
      showToast(t.accountDeleted);
    } catch (error) {
      logFirestoreError(error, OperationType.DELETE, `services/${id}`);
      showToast(t.deleteError, 'error');
    }
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
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: currentLanguage === 'tr' ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'transfers', id));
      showToast(t.accountDeleted);
    } catch (error) {
      logFirestoreError(error, OperationType.DELETE, `transfers/${id}`);
      showToast(t.deleteError, 'error');
    }
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
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: currentLanguage === 'tr' ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'checks', id));
      showToast(t.accountDeleted);
    } catch (error) {
      logFirestoreError(error, OperationType.DELETE, `checks/${id}`);
      showToast(t.deleteError, 'error');
    }
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
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: currentLanguage === 'tr' ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'employees', id));
      showToast(t.accountDeleted);
    } catch (error) {
      logFirestoreError(error, OperationType.DELETE, `employees/${id}`);
      showToast(t.deleteError, 'error');
    }
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
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: currentLanguage === 'tr' ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'budgets', id));
      showToast(t.accountDeleted);
    } catch (error) {
      logFirestoreError(error, OperationType.DELETE, `budgets/${id}`);
      showToast(t.deleteError, 'error');
    }
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
      setWaybillForm({ waybillNo: '', invoiceNo: '', party: '', date: format(new Date(), 'yyyy-MM-dd'), items: [], total: 0, status: 'Bekliyor', warehouseId: '' });
      setEditingWaybill(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteWaybill = async (id: string) => {
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: currentLanguage === 'tr' ? 'Sil' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'waybills', id));
      showToast(t.accountDeleted);
    } catch (error) {
      logFirestoreError(error, OperationType.DELETE, `waybills/${id}`);
      showToast(t.deleteError, 'error');
    }
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
      else if (journalSortKey === 'kdvOran') cmp = (a.kdvOran ?? 0) - (b.kdvOran ?? 0);
      else if (journalSortKey === 'kategori') cmp = (a.kategori || '').localeCompare(b.kategori || '', 'tr');
      else if (journalSortKey === 'fiş') cmp = (a.fiş || '').localeCompare(b.fiş || '', 'tr');
      else if (journalSortKey === 'aciklama') cmp = (a.aciklama || '').localeCompare(b.aciklama || '', 'tr');
      else if (journalSortKey === 'debitHesap') cmp = (a.debitHesap || '').localeCompare(b.debitHesap || '', 'tr');
      else if (journalSortKey === 'alacakHesap') cmp = (a.alacakHesap || '').localeCompare(b.alacakHesap || '', 'tr');
      return journalSortDir === 'asc' ? cmp : -cmp;
    });

  // Mizan computation
  // journalEntries (Cetpa) bu Mikro-ağırlıklı caride boş kalıyordu (2026-08-13
  // code review bulgusu: Mizan hâlâ yalnız journalEntries okuyordu, KDV/Satışlar'a
  // yapılan Mikro-additive düzeltme buraya hiç uygulanmamıştı). mikroFaturalar'dan
  // GERÇEK çift-taraflı (double-entry) satırlar sentezlenir — tahmini bir toplam
  // değil, standart Türk hesap planına göre borç/alacak ayrımı:
  //  giden (satış):  120-Alıcılar borç = tutar  ↔  600-Satışlar alacak = matrah + 391-Hesaplanan KDV alacak = kdv
  //  gelen (alış):   153-Ticari Mallar borç = matrah + 191-İndirilecek KDV borç = kdv  ↔  320-Satıcılar alacak = tutar
  // Alış, GİDER değil VARLIK (stok) hesabına (153) düşer — satır maliyeti bilinmediği
  // için COGS'a (620) atanamaz; bu ayrım Finansal Oranlar'daki "COGS bilinmiyor"
  // ilkesiyle tutarlı, yanlış bir gider rakamı üretmez.
  const mikroMizanSatirlari: { debitHesap: string; alacakHesap: string; borc: number; alacak: number }[] = [];
  mikroFaturalar.forEach(f => {
    if (f.yon === 'giden') {
      if (f.matrah) mikroMizanSatirlari.push({ debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurt İçi Satışlar', borc: f.matrah, alacak: f.matrah });
      if (f.kdv)    mikroMizanSatirlari.push({ debitHesap: '120 - Alıcılar', alacakHesap: '391 - Hesaplanan KDV', borc: f.kdv, alacak: f.kdv });
    } else {
      if (f.matrah) mikroMizanSatirlari.push({ debitHesap: '153 - Ticari Mallar', alacakHesap: '320 - Satıcılar', borc: f.matrah, alacak: f.matrah });
      if (f.kdv)    mikroMizanSatirlari.push({ debitHesap: '191 - İndirilecek KDV', alacakHesap: '320 - Satıcılar', borc: f.kdv, alacak: f.kdv });
    }
  });
  const mizanMap: Record<string, { borc: number; alacak: number }> = {};
  [...journalEntries, ...mikroMizanSatirlari].forEach(e => {
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

  // ── Mikro faturaları, Cetpa satışlarının YANINDA ────────────────────────
  // Mevcut `displayedSatis` (orders tabanlı) ve tüm KPI kartları AYNEN kalır;
  // burada yalnız EK satırlar hazırlanır. Varsayılan kaynak 'cetpa' olduğu için
  // ekran davranışı değişmez — Mikro'yu görmek opt-in.
  //
  // MÜKERRER SAYIM ELEMESİ: Cetpa siparişi Mikro'ya gönderildiğinde evrak no
  // `mikroEvrakNo` alanına geri yazılıyor. Aynı satış iki kez görünmesin diye
  // o evrak numaralarına sahip Mikro faturaları listelenmez.
  const cetpayaAitEvrakNo = new Set(
    orders.map(o => String((o as unknown as { mikroEvrakNo?: string }).mikroEvrakNo ?? '').trim())
          .filter(Boolean),
  );
  const cariAdMap = new Map<string, string>();
  for (const c of customers) {
    const kod = (c as unknown as { mikroCariKod?: string }).mikroCariKod;
    if (kod) cariAdMap.set(String(kod).trim(), c.name);
  }
  // Faturalar sekmesi yön filtresine uyar; Satışlar sekmesi (aşağıda) yalnız
  // GİDEN fatura gösterir — satış tanımı gereği.
  const mikroFaturaSatirlari = mikroFaturalar
    .filter(f => faturaYon === 'hepsi' || f.yon === faturaYon)
    // Yıl filtresi: tarih 'YYYY-...' ile başlıyorsa o yıl. 'hepsi' → tüm yıllar.
    .filter(f => faturaYil === 'hepsi' || (typeof f.tarih === 'string' && f.tarih.startsWith(faturaYil)))
    .filter(f => !f.faturaNo || !cetpayaAitEvrakNo.has(f.faturaNo))
    // e-belge türü filtresi (eskiden yalnız Cetpa invoices'a uygulanıyordu):
    // 0=e-Fatura, 1=e-Arşiv, 2=e-İrsaliye. Tür BİLİNMİYORSA (-1: cha_ebelge_turu
    // Mikro'da dolu değil) filtreden GİZLEME — aksi halde alan boşsa e-Fatura/e-Arşiv
    // seçince liste bombos görünür. Yalnız KESİN karşıt türü ele; İhracat türü
    // cha_ebelge_turu'da YOK (ayrı kavram) → o filtrede Mikro faturası gösterilmez.
    .filter(f => {
      if (invoiceTypeFilter === 'all') return true;
      if (invoiceTypeFilter === 'e-fatura') return f.ebelgeTuru === 0 || f.ebelgeTuru === -1;
      if (invoiceTypeFilter === 'e-arsiv') return f.ebelgeTuru === 1 || f.ebelgeTuru === -1;
      return false; // ihracat
    })
    .map(f => ({ ...f, musteri: cariAdMap.get(f.cariKod) || f.cariKod || '—' }))
    .filter(f => {
      const q = satisSearch.toLowerCase();
      return !q || f.musteri.toLowerCase().includes(q) || String(f.tutar).includes(q) || f.faturaNo.toLowerCase().includes(q);
    })
    .sort((a, b) => (satisSortDir === 'asc' ? 1 : -1) * (
      satisSortKey === 'customerName' ? a.musteri.localeCompare(b.musteri, 'tr')
      : satisSortKey === 'totalPrice' ? a.tutar - b.tutar
      // "KDV%" kolonu Mikro satırlarında tutar+oranı birlikte gösteriyor
      // (₺13.333,34 (%20)) ama neredeyse her satır aynı %20 oranı taşıyor —
      // orana göre sıralamak görsel olarak "rastgele" görünüyordu (2026-08-17
      // bildirimi). Görünen ve değişkenlik gösteren asıl değer tutar (kdv).
      : satisSortKey === 'kdvOran' ? (a.kdv ?? 0) - (b.kdv ?? 0)
      : a.tarih.localeCompare(b.tarih)
    ));
  // Satışlar sekmesi: yalnız giden (satış) faturaları.
  //
  // BAĞIMSIZ ZİNCİR (2026-08-11 düzeltmesi): eskiden bu liste `mikroFaturaSatirlari`
  // üzerinden türetiliyordu, yani FATURALAR sekmesinin filtrelerini (faturaYon,
  // faturaYil, invoiceTypeFilter) sessizce miras alıyordu. Faturalar'da "gelen"
  // seçiliyse `.filter(yon==='giden')` boş küme veriyor, yıl uyuşmazsa da öyle →
  // Satışlar sekmesi "Mikro (0)" ve tüm KPI'lar ₺0,00 görünüyordu. Satışlar'ın
  // kendi yıl seçicisi (satisYil) var; başka sekmenin durumuna bağlı DEĞİL.
  const mikroSatisSatirlari = mikroFaturalar
    .filter(f => f.yon === 'giden')
    .filter(f => satisYil === 'hepsi' || (typeof f.tarih === 'string' && f.tarih.startsWith(satisYil)))
    // Cetpa'dan Mikro'ya gönderilmiş faturayı iki kez sayma.
    .filter(f => !f.faturaNo || !cetpayaAitEvrakNo.has(f.faturaNo))
    .map(f => ({ ...f, musteri: cariAdMap.get(f.cariKod) || f.cariKod || '—' }))
    .filter(f => {
      const q = satisSearch.toLowerCase();
      return !q || f.musteri.toLowerCase().includes(q) || String(f.tutar).includes(q) || f.faturaNo.toLowerCase().includes(q);
    })
    .sort((a, b) => (satisSortDir === 'asc' ? 1 : -1) * (
      satisSortKey === 'customerName' ? a.musteri.localeCompare(b.musteri, 'tr')
      : satisSortKey === 'totalPrice' ? a.tutar - b.tutar
      // "KDV%" kolonu Mikro satırlarında tutar+oranı birlikte gösteriyor
      // (₺13.333,34 (%20)) ama neredeyse her satır aynı %20 oranı taşıyor —
      // orana göre sıralamak görsel olarak "rastgele" görünüyordu (2026-08-17
      // bildirimi). Görünen ve değişkenlik gösteren asıl değer tutar (kdv).
      : satisSortKey === 'kdvOran' ? (a.kdv ?? 0) - (b.kdv ?? 0)
      : a.tarih.localeCompare(b.tarih)
    ));
  const mikroSatisToplam = mikroSatisSatirlari.reduce((t, f) => t + f.tutar, 0);
  const mikroSatisKdvToplam = mikroSatisSatirlari.reduce((t, f) => t + (f.kdv || 0), 0);
  // Mikro satış faturaları tanım gereği FATURALI. Satışlar KPI'larına additive
  // katılır (satisKaynak Mikro'yu içeriyorsa); orders mantığı (q-serisi faturasız
  // dahil) korunur — kullanıcının "bu modülü bozma" uyarısı gereği toplamlar
  // toplanır, drill-down/orders akışına dokunulmaz.
  const mikroDahil = satisKaynak !== 'cetpa';
  const mikroSatisAdet = mikroDahil ? mikroSatisSatirlari.length : 0;
  const mikroSatisCiro = mikroDahil ? mikroSatisToplam : 0;
  const mikroSatisKdv = mikroDahil ? mikroSatisKdvToplam : 0;
  // Satışlar sekmesi drill-down'ları için Mikro satış faturalarını orders şekline
  // çevir; drill-down'lar `satisKayitlari`'ni okur (orders BOŞ olduğu için detaylar
  // "Kayıt bulunamadı" gösteriyordu — 2026-08-02). Mikro faturaları FATURALI sayılır;
  // q-serisi/faturasız orders'ta korunur.
  const mikroSatisAsOrders = mikroDahil
    ? mikroSatisSatirlari.map(f => ({
        customerName: f.musteri,
        totalPrice: f.tutar,
        faturali: true,
        kdvOran: f.oran ?? undefined,
        oranKarma: f.oranKarma,
        kdvTutari: f.kdv,
        syncedAt: undefined as unknown,
      }))
    : [];
  const satisKayitlari: Array<{ customerName?: string; totalPrice?: number; faturali?: boolean; kdvOran?: number; kdvTutari?: number; syncedAt?: { toDate?: () => Date } }> =
    [...(orders as unknown as typeof mikroSatisAsOrders), ...mikroSatisAsOrders] as never;

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
      else if (satisSortKey === 'kdvOran') cmp = (a.kdvOran || 0) - (b.kdvOran || 0);
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
  const RISK_SIRA: Record<string, number> = { 'Düşük': 0, 'Orta': 1, 'Yüksek': 2 };
  const displayedMusteriler = customers
    .filter(c => !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()) || (c.company || '').toLowerCase().includes(customerSearch.toLowerCase()))
    .sort((a, b) => {
      let cmp: number;
      if (musteriSortKey === 'balance') {
        cmp = (a.balance || 0) - (b.balance || 0);
      } else if (musteriSortKey === 'riskGroup') {
        cmp = (RISK_SIRA[a.riskGroup || ''] ?? -1) - (RISK_SIRA[b.riskGroup || ''] ?? -1);
      } else {
        const av = (a[musteriSortKey] || '') as string;
        const bv = (b[musteriSortKey] || '') as string;
        cmp = av.localeCompare(bv, 'tr');
      }
      return musteriSortDir === 'asc' ? cmp : -cmp;
    });

  const toggleMusteriSort = (key: typeof musteriSortKey) => {
    if (musteriSortKey === key) setMusteriSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setMusteriSortKey(key); setMusteriSortDir('asc'); }
  };

  // Tedarikçiler computed — TEK CARİ HAVUZU (kullanıcı kararı 2026-08-01):
  // Mikro'da tek CARI_HESAPLAR var; her cari rolünü faturasından alır. Alış
  // faturası (mikroFaturalar yon='gelen') olan cariler tedarikçidir. suppliers
  // koleksiyonu Mikro'da boş olduğu için ekran bomboştu.
  const alisCariKodSet = new Set(
    mikroFaturalar.filter(f => f.yon === 'gelen').map(f => f.cariKod).filter(Boolean),
  );
  // Satış faturası olan cariler = müşteri. Rol, cari'nin faturasından türer.
  const satisCariKodSet = new Set(
    mikroFaturalar.filter(f => f.yon === 'giden').map(f => f.cariKod).filter(Boolean),
  );
  /** Bir cari'nin rolü: satış faturası varsa müşteri, alış varsa tedarikçi. */
  const cariRol = (c: Customer): { label: string; cls: string } | null => {
    const kod = (c as unknown as { mikroCariKod?: string; code?: string }).mikroCariKod
      || (c as unknown as { code?: string }).code || c.taxNo || '';
    const m = !!kod && satisCariKodSet.has(kod);
    const td = !!kod && alisCariKodSet.has(kod);
    if (m && td) return { label: currentLanguage === 'tr' ? 'Müşteri + Tedarikçi' : 'Customer + Supplier', cls: 'bg-purple-100 text-purple-700' };
    if (td)      return { label: currentLanguage === 'tr' ? 'Tedarikçi' : 'Supplier', cls: 'bg-amber-100 text-amber-700' };
    if (m)       return { label: currentLanguage === 'tr' ? 'Müşteri' : 'Customer', cls: 'bg-teal-100 text-teal-700' };
    // Satış/alış faturası YOK ama bakiyesi VAR → gider/diğer cari (7 Mehmet gibi).
    // "Gider" demiyoruz (personel/banka/vergi carisi de olabilir) — dürüst etiket "Diğer".
    if (!!kod && cariBalanceKodSet.has(kod)) return { label: currentLanguage === 'tr' ? 'Diğer' : 'Other', cls: 'bg-gray-100 text-gray-600' };
    return null;
  };
  const mikroTedarikcileri: Supplier[] = customers
    .filter(c => {
      const kod = (c as unknown as { mikroCariKod?: string; code?: string }).mikroCariKod
        || (c as unknown as { code?: string }).code || c.taxNo;
      return !!kod && alisCariKodSet.has(kod);
    })
    .map(c => ({
      id: c.id,
      name: c.name,
      company: c.company || '',
      email: c.email || '',
      phone: c.phone || '',
      taxNo: c.taxNo || '',
      address: c.address || '',
      // Tedarikçi burada ayrı bir kayıt değil, alış faturası olan AYNI cari
      // (Customer) — bakiye/risk zaten o kayıtta hesaplı, kaybetmeden taşı.
      balance: c.balance || 0,
      riskGroup: c.riskGroup || 'Düşük',
    } as Supplier));
  // Üç kaynak: elle girilmiş suppliers + leads(type='Supplier') + alış faturalı
  // cariler. Ad/vergi no ile dedup.
  const birlesikTedarikciler = [
    ...mikroSuppliers,
    ...mikroTedarikcileri.filter(m => !mikroSuppliers.some(s => s.name === m.name || (!!s.taxNo && s.taxNo === m.taxNo))),
  ];
  const allSuppliers = [
    ...suppliers,
    ...birlesikTedarikciler.filter(m => !suppliers.some(s => s.name === m.name || (!!s.taxNo && s.taxNo === m.taxNo))),
  ];
  const displayedTedarikciler = allSuppliers
    .filter(s => !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase()) || (s.company || '').toLowerCase().includes(supplierSearch.toLowerCase()))
    .sort((a, b) => {
      let cmp: number;
      if (tedarikciSortKey === 'balance') {
        cmp = (a.balance || 0) - (b.balance || 0);
      } else if (tedarikciSortKey === 'riskGroup') {
        cmp = (RISK_SIRA[a.riskGroup || ''] ?? -1) - (RISK_SIRA[b.riskGroup || ''] ?? -1);
      } else {
        const av = (a[tedarikciSortKey] || '') as string;
        const bv = (b[tedarikciSortKey] || '') as string;
        cmp = av.localeCompare(bv, 'tr');
      }
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
      else if (depoSortKey === 'category') cmp = (a.category || '').localeCompare(b.category || '', 'tr');
      else cmp = a.productName.localeCompare(b.productName, 'tr');
      return depoSortDir === 'asc' ? cmp : -cmp;
    });

  const toggleDepoSort = (key: typeof depoSortKey) => {
    if (depoSortKey === key) setDepoSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setDepoSortKey(key); setDepoSortDir('asc'); }
  };

  // Bir depoda görünecek kalemler + O DEPODAKİ miktar. Mikro ürünleri (doc id
  // 'mikro-' ile başlar) TEK depoya toplanmaz — depoBreakdown ile stoğu olan HER
  // depoda kendi miktarıyla görünür (kullanıcı isteği). Manuel ürünler tek warehouseId.
  // depoBreakdown'daki özel kova: hareket defterinde (STOK_HAREKETLERI) karşılığı
  // olmayan, yani hangi depoda olduğu BİLİNMEYEN açılış/devir stoğu. Gerçek bir
  // depo değildir — depo listelerinde kalem olarak GÖSTERİLMEZ, yalnız dağılım
  // etiketinde ayrı ad ile görünür ki toplamlar tutsun ve eksik gizlenmesin.
  const DEVIR_KOVA = '__devir';

  const depoKalemleriIcin = (whId: string): Array<WarehouseItem & { quantity: number }> => {
    const depoNo = whId.startsWith('mikro-depo-') ? whId.slice('mikro-depo-'.length) : null;
    const out: Array<WarehouseItem & { quantity: number }> = [];
    for (const wi of warehouseItems) {
      if (String(wi.id).startsWith('mikro-')) {
        const bd = (wi as unknown as { depoBreakdown?: Record<string, number> | null }).depoBreakdown;
        const q = bd && depoNo ? Number(bd[depoNo] ?? 0) : 0;
        if (q > 0) out.push({ ...wi, quantity: q });
        // depoBreakdown yok/0 → bu depoda gösterme (bayat warehouseId'ye DÜŞME).
      } else if (wi.warehouseId === whId) {
        out.push(wi);
      }
    }
    return out;
  };

  // Düz listede depo sütunu: mikro ürün stoğu olan HER depoyu miktarıyla gösterir.
  const depoDagilimEtiket = (wi: WarehouseItem): string => {
    const bd = (wi as unknown as { depoBreakdown?: Record<string, number> | null }).depoBreakdown;
    if (bd && Object.keys(bd).length) {
      return Object.entries(bd)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([depo, q]) => {
          const ad = depo === DEVIR_KOVA
            ? 'Devir (depo bilinmiyor)'
            : warehouses.find(w => w.id === `mikro-depo-${depo}`)?.name || `Depo ${depo}`;
          return `${ad}: ${Number(q).toLocaleString('tr-TR')}`;
        })
        .join(' · ');
    }
    return warehouses.find(wh => wh.id === wi.warehouseId)?.name || wi.location || '—';
  };

  // Transfer computed
  const displayedTransfers = transfers
    .filter(tr => !transferSearch || tr.productName.toLowerCase().includes(transferSearch.toLowerCase()))
    .sort((a, b) => {
      let cmp: number;
      if (transferSortKey === 'quantity') cmp = a.quantity - b.quantity;
      else if (transferSortKey === 'date') cmp = a.date.localeCompare(b.date);
      else if (transferSortKey === 'status') cmp = a.status.localeCompare(b.status, 'tr');
      else if (transferSortKey === 'fromWarehouse') cmp = a.fromWarehouse.localeCompare(b.fromWarehouse, 'tr');
      else if (transferSortKey === 'toWarehouse') cmp = a.toWarehouse.localeCompare(b.toWarehouse, 'tr');
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
      else if (cekSortKey === 'bankName') cmp = (a.bankName || '').localeCompare(b.bankName || '', 'tr');
      else if (cekSortKey === 'drawer') cmp = (a.drawer || '').localeCompare(b.drawer || '', 'tr');
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
  // Mikro GİDEN (satış) faturaları GELİR tarafına eklenir (KDV/Satışlar'daki
  // additive desenin aynısı, 2026-08-13). Mikro GELEN (alış) faturaları
  // GİDER'e EKLENMEZ — alış tutarı stok (153-Ticari Mallar) hesabına düşer,
  // Gider'e ancak satış anında COGS (620) olarak yansır; Mikro fatura satırında
  // maliyet bilgisi olmadığından bu ayrım yapılamaz (Finansal Oranlar'daki
  // "COGS bilinmiyor" ilkesiyle tutarlı — yanlış bir gider rakamı üretmemek
  // için alış kasıtlı olarak dışarıda bırakıldı).
  const mikroDonemFiltresi = (tarih: string) => {
    if (gelirUseRange && gelirDateFrom && gelirDateTo) return tarih >= gelirDateFrom && tarih <= gelirDateTo;
    const d = new Date(tarih);
    return d.getMonth() + 1 === gelirMonth && d.getFullYear() === gelirYear;
  };
  const mikroGelirTutar = mikroFaturalar.filter(f => f.yon === 'giden' && mikroDonemFiltresi(f.tarih)).reduce((s, f) => s + f.matrah, 0);
  const toplamGelir = gelirEntries.reduce((s, e) => s + (e.alacak ?? e.borc), 0) + mikroGelirTutar; // gelir = alacak (kredi) + Mikro
  const toplamGider = giderEntries.reduce((s, e) => s + e.borc, 0);               // gider = borç (debit) — yalnız native, bkz. yukarıdaki not
  const netKar = toplamGelir - toplamGider;

  // Monthly chart data
  const monthlyData = MONTHS.map((m, i) => {
    const month = i + 1;
    const mEntries = journalEntries.filter(e => {
      if (!e.date) return false;
      const d = new Date(e.date);
      return d.getMonth() + 1 === month && d.getFullYear() === gelirYear;
    });
    const gelir = mEntries.filter(e => e.alacakHesap.startsWith('6')).reduce((s, e) => s + (e.alacak ?? e.borc), 0);
    const gider = mEntries.filter(e => e.debitHesap.startsWith('6') || e.debitHesap.startsWith('7') || e.debitHesap.startsWith('8')).reduce((s, e) => s + e.borc, 0);
    const mikroGelirAy = mikroFaturalar
      .filter(f => f.yon === 'giden' && (() => { const d = new Date(f.tarih); return d.getMonth() + 1 === month && d.getFullYear() === gelirYear; })())
      .reduce((s, f) => s + f.matrah, 0);
    return { month: m, gelir: gelir + mikroGelirAy, gider };
  });
  const maxChartVal = Math.max(...monthlyData.map(d => Math.max(d.gelir, d.gider)), 1);

  // Gelir breakdown by account
  const gelirBreakdown: Record<string, number> = {};
  if (mikroGelirTutar > 0) gelirBreakdown['600 - Yurt İçi Satışlar (Mikro)'] = mikroGelirTutar;
  gelirEntries.forEach(e => { gelirBreakdown[e.alacakHesap] = (gelirBreakdown[e.alacakHesap] || 0) + (e.alacak ?? e.borc); });
  const giderBreakdown: Record<string, number> = {};
  giderEntries.forEach(e => { giderBreakdown[e.debitHesap] = (giderBreakdown[e.debitHesap] || 0) + e.borc; });

  // KDV computation
  const kdvFilteredEntries = journalEntries.filter(e => {
    if (!e.date) return false; // tarihsiz fiş hiçbir döneme dahil edilmez (aylık P&L ile tutarlı)
    const d = new Date(e.date);
    return d.getMonth() + 1 === kdvMonth && d.getFullYear() === kdvYear;
  });
  // Mikro faturalarından KDV özeti (2026-08-02): journalEntries boş — Mikro'da
  // muhasebe fişi yok. Satış faturası (giden) KDV'si = HESAPLANAN (391); alış
  // faturası (gelen) = İNDİRİLECEK (191). Seçili döneme (ay/yıl) filtrelenir.
  // mikroFaturalar zaten iptal edilmişleri dışlamış (server + client _iptal).
  const mikroKdvDonem = mikroFaturalar.filter(f => {
    const ts = String((f as { tarih?: string }).tarih || '');
    return Number(ts.slice(0, 4)) === kdvYear && Number(ts.slice(5, 7)) === kdvMonth;
  });
  const mikroHesaplananKDV = mikroKdvDonem.filter(f => f.yon === 'giden').reduce((s, f) => s + (Number((f as { kdv?: number }).kdv) || 0), 0);
  const mikroIndirilecekKDV = mikroKdvDonem.filter(f => f.yon === 'gelen').reduce((s, f) => s + (Number((f as { kdv?: number }).kdv) || 0), 0);
  const hesaplananKDV = kdvFilteredEntries.filter(e => e.alacakHesap === '391 - Hesaplanan KDV').reduce((s, e) => s + e.alacak, 0) + mikroHesaplananKDV;
  const indirilecekKDV = kdvFilteredEntries.filter(e => e.debitHesap === '191 - İndirilecek KDV').reduce((s, e) => s + e.borc, 0) + mikroIndirilecekKDV;
  const odenecekKDV = hesaplananKDV - indirilecekKDV;
  // Matrah yalnız gelir (alacakHesap 6xx) fişlerinden, oran bazında; KDV = matrah*oran.
  // (Önceki sürüm her borç satırından matrah uyduruyordu.)
  // string key: Mikro'dan gelen karma oranlı faturalar (2026-08-17, task #27,
  // #18'in devamı — bu KDV Beyannamesi PDF/CSV'sini besliyor) 'karma' adında
  // ayrı bir kovaya gider; tek f.oran'a göre kovalarsak KDV yanlış orana yazılır.
  const kdvOranBreakdown: Record<string, { matrah: number; kdv: number }> = {};
  kdvFilteredEntries.filter(e => e.alacakHesap.startsWith('6') && (e.kdvOran ?? 0) > 0).forEach(e => {
    const oran = e.kdvOran ?? 0;
    const matrah = e.alacak ?? e.borc;
    if (!kdvOranBreakdown[oran]) kdvOranBreakdown[oran] = { matrah: 0, kdv: 0 };
    kdvOranBreakdown[oran].matrah += matrah;
    kdvOranBreakdown[oran].kdv += matrah * (oran / 100);
  });
  // Mikro satış faturaları oran bazında (2026-08-02): tablo journalEntries'ten
  // türüyordu, o boş → tablo boştu. mikroFaturaSatirlari matrah/kdv/oran taşır.
  mikroKdvDonem.filter(f => f.yon === 'giden').forEach(f => {
    const karma = (f as { oranKarma?: boolean }).oranKarma;
    const oran = karma ? 'karma' : String(Number((f as { oran?: number }).oran) || 0);
    if (!kdvOranBreakdown[oran]) kdvOranBreakdown[oran] = { matrah: 0, kdv: 0 };
    kdvOranBreakdown[oran].matrah += Number((f as { matrah?: number }).matrah) || 0;
    kdvOranBreakdown[oran].kdv += Number((f as { kdv?: number }).kdv) || 0;
  });

  const tabs = [
    { key: 'faturalar', label: currentLanguage === 'tr' ? 'Faturalar' : 'Invoices', icon: FileText },
    { key: 'evrak_tasarimi', label: currentLanguage === 'tr' ? 'Evrak Tasarımı' : 'Doc Design', icon: Palette },
    { key: 'banka', label: t.bankAndCash, icon: Building2 },
    { key: 'yevmiye', label: t.journal, icon: BookOpen },
    { key: 'mizan', label: t.trialBalance, icon: ArrowUpDown },
    { key: 'gelir', label: t.incomeExpense, icon: BarChart3 },
    { key: 'kdv', label: t.vat, icon: Calculator },
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
    { key: 'kasa', label: currentLanguage === 'tr' ? 'Kasa' : 'Cash Desk', icon: Wallet },
  ] as const;

  const visibleTabs = allowedTabs ? tabs.filter(t => allowedTabs.includes(t.key)) : tabs;

  return (
    <div className="space-y-4 overflow-x-hidden">
      {/* Sub-tab Nav — hideTabBar ise MuhasebePage barı yönetir; navMenu verilirse birleşik menü */}
      {!hideTabBar && (
      <div className="overflow-x-auto scrollbar-none -mx-3 px-3 sm:-mx-4 sm:px-4">
        <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
          {navMenu ? navMenu.map(m => {
            const Icon = m.icon;
            // AccountingModule sekmesiyse burada aktif olur; değilse (rapor/ayrı sayfa)
            // tıklayınca üst seviyeye bildirir (bu görünümden çıkar).
            const isAccountingHere = m.target.kind === 'accounting';
            const isActive = isAccountingHere && accountingTab === m.target.tab;
            return (
              <button
                key={m.id}
                onClick={() => { if (isAccountingHere) setAccountingTab(m.target.tab); else onNavigate?.(m.target); }}
                className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${isActive ? 'bg-[#ff4000] text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}
              >
                <Icon size={13} />
                {m.tr && currentLanguage === 'tr' ? m.tr : m.en}
              </button>
            );
          }) : visibleTabs.map(t => {
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
      )}

      {/* FATURALAR */}
      {accountingTab === 'faturalar' && (
        <FaturalarTab
          currentLanguage={currentLanguage} isAuthenticated={isAuthenticated}
          showInvoiceModal={showInvoiceModal} setShowInvoiceModal={setShowInvoiceModal}
          invoiceForm={invoiceForm} setInvoiceForm={setInvoiceForm}
          invoiceSource={invoiceSource} setInvoiceSource={setInvoiceSource} handleCreateInvoice={handleCreateInvoice}
          faturaKaynak={faturaKaynak} setFaturaKaynak={setFaturaKaynak}
          faturaYon={faturaYon} setFaturaYon={setFaturaYon} faturaYil={faturaYil} setFaturaYil={setFaturaYil}
          mikroFaturalar={mikroFaturalar} mikroFaturaSatirlari={mikroFaturaSatirlari} invoices={invoices}
          invoiceSearch={invoiceSearch} setInvoiceSearch={setInvoiceSearch}
          invoiceTypeFilter={invoiceTypeFilter} setInvoiceTypeFilter={setInvoiceTypeFilter}
          invoiceSort={invoiceSort} setInvoiceSort={setInvoiceSort}
          setFaturaDetay={setFaturaDetay}
        />
      )}


      {/* BANKA & KASA */}
      {accountingTab === 'banka' && (
        <BankaTab
          t={t} currentLanguage={currentLanguage} bankAccounts={bankAccounts}
          tryBalance={tryBalance} usdBalance={usdBalance} eurBalance={eurBalance} setDrillDown={setDrillDown}
          handleBankFileImport={handleBankFileImport} openAddBank={openAddBank}
          bankSearch={bankSearch} setBankSearch={setBankSearch}
          bankImportStatus={bankImportStatus} setBankImportStatus={setBankImportStatus}
          bankSortKey={bankSortKey} bankSortDir={bankSortDir} toggleBankSort={toggleBankSort}
          displayedAccounts={displayedAccounts} openEditBank={openEditBank} deleteBank={deleteBank}
          mikroEnabled={mikroEnabled} mikroConnected={mikroConnected}
          bankTxLastPull={bankTxLastPull} bankTxAutoSync={bankTxAutoSync} setBankTxAutoSync={setBankTxAutoSync}
          pullBankTransactions={pullBankTransactions} bankTxPulling={bankTxPulling}
          bankTxSearch={bankTxSearch} setBankTxSearch={setBankTxSearch}
          bankTxFilter={bankTxFilter} setBankTxFilter={setBankTxFilter}
          bankTransactions={bankTransactions} bankTxSort={bankTxSort} setBankTxSort={setBankTxSort}
          showBankModal={showBankModal} setShowBankModal={setShowBankModal} editingBank={editingBank}
          bankForm={bankForm} setBankForm={setBankForm} saveBank={saveBank}
        />
      )}

      {/* YEVMİYE */}
      {accountingTab === 'yevmiye' && (
        <YevmiyeTab
          t={t} currentLanguage={currentLanguage} journalEntries={journalEntries} displayedJournal={displayedJournal}
          journalSearch={journalSearch} setJournalSearch={setJournalSearch}
          journalSortKey={journalSortKey} journalSortDir={journalSortDir} toggleJournalSort={toggleJournalSort}
          yevmiyeCurrency={yevmiyeCurrency} setYevmiyeCurrency={setYevmiyeCurrency} exchangeRates={exchangeRates}
          openEditJournal={openEditJournal} deleteJournal={deleteJournal}
          showJournalModal={showJournalModal} setShowJournalModal={setShowJournalModal}
          editingJournal={editingJournal} journalForm={journalForm} setJournalForm={setJournalForm} saveJournal={saveJournal}
        />
      )}

      {/* MİZAN */}
      {accountingTab === 'mizan' && (
        <MizanTab
          t={t} currentLanguage={currentLanguage} mizanRows={mizanRows} mizanTotals={mizanTotals}
          mizanDengeli={mizanDengeli} hasMikroMizan={mikroMizanSatirlari.length > 0}
          kpiCurrency={kpiCurrency} setKpiCurrency={setKpiCurrency} formatConv={formatConv} setDrillDown={setDrillDown}
          mizanSearch={mizanSearch} setMizanSearch={setMizanSearch}
          mizanSortKey={mizanSortKey} mizanSortDir={mizanSortDir} toggleMizanSort={toggleMizanSort}
          displayedMizan={displayedMizan}
        />
      )}

      {/* GELİR/GİDER */}
      {accountingTab === 'gelir' && (
        <GelirGiderTab
          t={t} currentLanguage={currentLanguage} MONTHS={MONTHS}
          gelirMonth={gelirMonth} setGelirMonth={setGelirMonth} gelirYear={gelirYear} setGelirYear={setGelirYear}
          gelirDateFrom={gelirDateFrom} setGelirDateFrom={setGelirDateFrom} gelirDateTo={gelirDateTo} setGelirDateTo={setGelirDateTo}
          gelirUseRange={gelirUseRange} setGelirUseRange={setGelirUseRange}
          gelirCurrency={gelirCurrency} setGelirCurrency={setGelirCurrency} exchangeRates={exchangeRates} setDrillDown={setDrillDown}
          gelirBreakdown={gelirBreakdown} giderBreakdown={giderBreakdown}
          toplamGelir={toplamGelir} toplamGider={toplamGider} netKar={netKar}
          monthlyData={monthlyData} maxChartVal={maxChartVal}
        />
      )}

      {/* BÜTÇE */}
      {accountingTab === 'butce' && (
        <ButceTab
          t={t} currentLanguage={currentLanguage} budgets={budgets} journalEntries={journalEntries}
          deleteBudget={deleteBudget} showBudgetModal={showBudgetModal} setShowBudgetModal={setShowBudgetModal}
          budgetForm={budgetForm} setBudgetForm={setBudgetForm} saveBudget={saveBudget}
        />
      )}

      {/* İŞLETME SERMAYESİ */}
      {accountingTab === 'isletme_sermayesi' && (
        <IsletmeSermayesiTab
          currentLanguage={currentLanguage} workingCapital={workingCapital} wcSaved={wcSaved}
          updateWC={updateWC} prefillWC={prefillWC}
        />
      )}

      {/* KDV */}
      {accountingTab === 'kdv' && (
        <KdvTab
          t={t} currentLanguage={currentLanguage} MONTHS={MONTHS}
          kdvMonth={kdvMonth} setKdvMonth={setKdvMonth} kdvYear={kdvYear} setKdvYear={setKdvYear}
          journalEntries={journalEntries} hesaplananKDV={hesaplananKDV} indirilecekKDV={indirilecekKDV} odenecekKDV={odenecekKDV}
          setDrillDown={setDrillDown} kdvSearch={kdvSearch} setKdvSearch={setKdvSearch}
          kdvSortBy={kdvSortBy} kdvSortDir2={kdvSortDir2} setKdvSortBy={setKdvSortBy} setKdvSortDir2={setKdvSortDir2}
          kdvOranBreakdown={kdvOranBreakdown} downloadVatDeclaration={downloadVatDeclaration} downloadVatDeclarationCSV={downloadVatDeclarationCSV}
        />
      )}

      {/* SATIŞLAR */}
      {accountingTab === 'evrak_tasarimi' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="h-full">
          <DocumentDesigner currentLanguage={currentLanguage} />
        </motion.div>
      )}

      {accountingTab === 'satislar' && (
        <SatislarTab
          t={t} currentLanguage={currentLanguage} orders={orders} satisKayitlari={satisKayitlari}
          setDrillDown={setDrillDown} formatConv={formatConv} kpiCurrency={kpiCurrency} setKpiCurrency={setKpiCurrency}
          satisKaynak={satisKaynak} setSatisKaynak={setSatisKaynak}
          mikroSatisToplam={mikroSatisToplam} mikroSatisAdet={mikroSatisAdet} mikroSatisCiro={mikroSatisCiro}
          mikroSatisKdv={mikroSatisKdv} mikroDahil={mikroDahil} mikroSatisSatirlari={mikroSatisSatirlari}
          satisSearch={satisSearch} setSatisSearch={setSatisSearch} satisYil={satisYil} setSatisYil={setSatisYil}
          satisSortKey={satisSortKey} satisSortDir={satisSortDir} toggleSatisSort={toggleSatisSort}
          displayedSatis={displayedSatis}
        />
      )}

      {/* MÜŞTERİLER */}
      {accountingTab === 'musteriler' && (
        <MusterilerTab
          t={t} currentLanguage={currentLanguage} customers={customers} displayedMusteriler={displayedMusteriler}
          customerSearch={customerSearch} setCustomerSearch={setCustomerSearch}
          musteriSortKey={musteriSortKey} musteriSortDir={musteriSortDir} toggleMusteriSort={toggleMusteriSort}
          cariRol={cariRol} setDekontHedef={setDekontHedef}
          showCustomerModal={showCustomerModal} setShowCustomerModal={setShowCustomerModal}
          editingCustomer={editingCustomer} setEditingCustomer={setEditingCustomer}
          customerForm={customerForm} setCustomerForm={setCustomerForm} saveCustomer={saveCustomer} deleteCustomer={deleteCustomer}
          ekstreMusteri={ekstreMusteri} setEkstreMusteri={setEkstreMusteri}
        />
      )}

      {/* TEDARİKÇİLER */}
      {accountingTab === 'tedarikciler' && (
        <TedarikcilerTab
          t={t} currentLanguage={currentLanguage} suppliers={suppliers} displayedTedarikciler={displayedTedarikciler}
          supplierSearch={supplierSearch} setSupplierSearch={setSupplierSearch}
          tedarikciSortKey={tedarikciSortKey} tedarikciSortDir={tedarikciSortDir} toggleTedarikciSort={toggleTedarikciSort}
          showSupplierModal={showSupplierModal} setShowSupplierModal={setShowSupplierModal}
          editingSupplier={editingSupplier} setEditingSupplier={setEditingSupplier}
          supplierForm={supplierForm} setSupplierForm={setSupplierForm} saveSupplier={saveSupplier} deleteSupplier={deleteSupplier}
          ekstreTedarikci={ekstreTedarikci} setEkstreTedarikci={setEkstreTedarikci}
        />
      )}

      {/* HİZMET & ÜRÜNLER */}
      {accountingTab === 'urunler' && (
        <UrunlerTab
          t={t} services={services} displayedServisler={displayedServisler}
          serviceSearch={serviceSearch} setServiceSearch={setServiceSearch}
          servisSortKey={servisSortKey} servisSortDir={servisSortDir} toggleServisSort={toggleServisSort}
          showServiceModal={showServiceModal} setShowServiceModal={setShowServiceModal}
          editingService={editingService} setEditingService={setEditingService}
          serviceForm={serviceForm} setServiceForm={setServiceForm}
          saveService={saveService} deleteService={deleteService}
        />
      )}

      {/* WAREHOUSES */}
      {accountingTab === 'warehouses' && (
        <WarehousesTab
          t={t} currentLanguage={currentLanguage} warehouses={warehouses} depoKalemleriIcin={depoKalemleriIcin}
          detayDepo={detayDepo} setDetayDepo={setDetayDepo} setEditingWarehouse={setEditingWarehouse}
          showWarehouseModal={showWarehouseModal} setShowWarehouseModal={setShowWarehouseModal}
          editingWarehouse={editingWarehouse} warehouseForm={warehouseForm} setWarehouseForm={setWarehouseForm}
          saveWarehouse={saveWarehouse} deleteWarehouse={deleteWarehouse}
        />
      )}

      {/* DEPO */}
      {accountingTab === 'depo' && (
        <DepoTab
          t={t} currentLanguage={currentLanguage} warehouses={warehouses}
          warehouseSearch={warehouseSearch} setWarehouseSearch={setWarehouseSearch}
          depoSortKey={depoSortKey} depoSortDir={depoSortDir} toggleDepoSort={toggleDepoSort}
          displayedDepo={displayedDepo} depoDagilimEtiket={depoDagilimEtiket}
          showStockModal={showStockModal} setShowStockModal={setShowStockModal}
          editingStock={editingStock} setEditingStock={setEditingStock}
          stockForm={stockForm} setStockForm={setStockForm} saveStock={saveStock} deleteStock={deleteStock}
        />
      )}

      {/* DEPOLAR ARASI TRANSFER */}
      {accountingTab === 'transfer' && (
        <TransferTab
          t={t} transferSearch={transferSearch} setTransferSearch={setTransferSearch}
          transferSortKey={transferSortKey} transferSortDir={transferSortDir} toggleTransferSort={toggleTransferSort}
          displayedTransfers={displayedTransfers} showTransferModal={showTransferModal} setShowTransferModal={setShowTransferModal}
          editingTransfer={editingTransfer} setEditingTransfer={setEditingTransfer}
          transferForm={transferForm} setTransferForm={setTransferForm} saveTransfer={saveTransfer} deleteTransfer={deleteTransfer}
          warehouses={warehouses}
        />
      )}

      {/* ÇEKLER */}
      {accountingTab === 'cekler' && (
        <CeklerTab
          t={t} checks={checks} displayedCekler={displayedCekler}
          checkSearch={checkSearch} setCheckSearch={setCheckSearch}
          cekSortKey={cekSortKey} cekSortDir={cekSortDir} toggleCekSort={toggleCekSort}
          showCheckModal={showCheckModal} setShowCheckModal={setShowCheckModal}
          editingCheck={editingCheck} setEditingCheck={setEditingCheck}
          checkForm={checkForm} setCheckForm={setCheckForm}
          saveCheck={saveCheck} deleteCheck={deleteCheck}
        />
      )}

      {/* ÇALIŞANLAR */}
      {accountingTab === 'calisanlar' && (
        <CalisanlarTab
          t={t} currentLanguage={currentLanguage}
          displayedCalisanlar={displayedCalisanlar}
          employeeSearch={employeeSearch} setEmployeeSearch={setEmployeeSearch}
          calisanSortKey={calisanSortKey} calisanSortDir={calisanSortDir} toggleCalisanSort={toggleCalisanSort}
          showEmployeeModal={showEmployeeModal} setShowEmployeeModal={setShowEmployeeModal}
          editingEmployee={editingEmployee} setEditingEmployee={setEditingEmployee}
          employeeForm={employeeForm} setEmployeeForm={setEmployeeForm}
          saveEmployee={saveEmployee} deleteEmployee={deleteEmployee}
        />
      )}

      {/* GİDEN İRSALİYE */}
      {accountingTab === 'giden_irsaliye' && (
        <GidenIrsaliyeTab
          t={t} waybillSearch={waybillSearch} setWaybillSearch={setWaybillSearch}
          setWaybillType={setWaybillType} setShowWaybillModal={setShowWaybillModal}
          irsaliyeSortKey={irsaliyeSortKey} irsaliyeSortDir={irsaliyeSortDir} toggleIrsaliyeSort={toggleIrsaliyeSort}
          makeDisplayedWaybills={makeDisplayedWaybills} setEditingWaybill={setEditingWaybill}
          setWaybillForm={setWaybillForm} deleteWaybill={deleteWaybill}
        />
      )}

      {/* GELEN İRSALİYE */}
      {accountingTab === 'gelen_irsaliye' && (
        <GelenIrsaliyeTab
          t={t} waybillSearch={waybillSearch} setWaybillSearch={setWaybillSearch}
          setWaybillType={setWaybillType} setShowWaybillModal={setShowWaybillModal}
          irsaliyeSortKey={irsaliyeSortKey} irsaliyeSortDir={irsaliyeSortDir} toggleIrsaliyeSort={toggleIrsaliyeSort}
          makeDisplayedWaybills={makeDisplayedWaybills} setEditingWaybill={setEditingWaybill}
          setWaybillForm={setWaybillForm} deleteWaybill={deleteWaybill}
        />
      )}

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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{waybillType === 'giden' ? t.customer2 : t.supplier2}</label>
                    <input
                      type="text" list="waybillPartyList" value={waybillForm.party}
                      onChange={e => setWaybillForm(prev => ({ ...prev, party: e.target.value }))}
                      placeholder={waybillType === 'giden' ? 'Müşteri adı' : 'Tedarikçi adı'}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]"
                    />
                    <datalist id="waybillPartyList">
                      {(waybillType === 'giden' ? customers : suppliers).map(p => <option key={p.id} value={p.name} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.depo}</label>
                    <select value={waybillForm.warehouseId} onChange={e => setWaybillForm(prev => ({ ...prev, warehouseId: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#ff4000]">
                      <option value="">{t.selectWarehouse}</option>
                      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-gray-600">{t.product}</label>
                    <button onClick={() => setWaybillForm(prev => ({ ...prev, items: [...prev.items, { productName: '', sku: '', quantity: 1, unitPrice: 0, taxRate: 20 }] }))} className="text-[10px] font-bold text-brand hover:underline flex items-center gap-1">
                      <Plus size={10} /> {t.add}
                    </button>
                  </div>
                  <datalist id="waybillProductList">
                    {warehouseItems.map(wi => <option key={wi.id} value={wi.productName} />)}
                  </datalist>
                  {waybillForm.items.map((item, idx) => (
                    <div key={idx} className="p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-2 relative group">
                      <button onClick={() => setWaybillForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }))} className="absolute top-2 right-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        <X size={14} />
                      </button>
                      <input type="text" list="waybillProductList" value={item.productName} onChange={e => {
                        const newItems = [...waybillForm.items];
                        const match = warehouseItems.find(wi => wi.productName === e.target.value);
                        newItems[idx].productName = e.target.value;
                        if (match?.sku) newItems[idx].sku = match.sku;
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

      {/* ── Kasa ── */}
      {accountingTab === 'kasa' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <KasaModule currentLanguage={currentLanguage} isAuthenticated={isAuthenticated ?? false} />
        </motion.div>
      )}

      {/* ── Banka Hareketleri (Mikro) ── */}
      {accountingTab === 'banka_hareketleri' && (
        <BankaHareketleriTab
          t={t} currentLanguage={currentLanguage} mikroBankLastSync={mikroBankLastSync}
          showErpConfig={showErpConfig} setShowErpConfig={setShowErpConfig}
          handleSyncMikroBank={handleSyncMikroBank} mikroBankLoading={mikroBankLoading}
          mikroEnabled={mikroEnabled} setMikroEnabled={setMikroEnabled}
          mikroAccessToken={mikroAccessToken} setMikroAccessToken={setMikroAccessToken}
          mikroEndpoint={mikroEndpoint} setMikroEndpoint={setMikroEndpoint}
          erpConfigSaving={erpConfigSaving} setErpConfigSaving={setErpConfigSaving} saveMikroConfig={saveMikroConfig}
          lucaEnabled={lucaEnabled} setLucaEnabled={setLucaEnabled} lucaApiKey={lucaApiKey} setLucaApiKey={setLucaApiKey}
          lucaCompanyId={lucaCompanyId} setLucaCompanyId={setLucaCompanyId} lucaBaseUrl={lucaBaseUrl} setLucaBaseUrl={setLucaBaseUrl}
          saveLucaConfig={saveLucaConfig} mikroBankMovements={mikroBankMovements}
        />
      )}

      {/* ── Gelir Tablosu (Income Statement) ── */}
      {accountingTab === 'gelir_tablosu' && (
        <GelirTablosuTab
          currentLanguage={currentLanguage} orders={orders}
          gelirYear={gelirYear} setGelirYear={setGelirYear} gelirMonth={gelirMonth} setGelirMonth={setGelirMonth}
          gelirCurrency={gelirCurrency} setGelirCurrency={setGelirCurrency} exchangeRates={exchangeRates}
          employeesProp={employeesProp}
        />
      )}


      {faturaDetay && (
        <MikroFaturaDetay
          fatura={faturaDetay}
          currentLanguage={currentLanguage}
          onClose={() => setFaturaDetay(null)}
        />
      )}

      {dekontHedef && (
        <DekontModal
          cariKod={dekontHedef.cariKod}
          cariAdi={dekontHedef.ad}
          mevcutBakiye={dekontHedef.bakiye}
          entityId={dekontHedef.id}
          onClose={() => setDekontHedef(null)}
        />
      )}
    </div>
  );
}
