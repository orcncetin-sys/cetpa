import { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import { parseTRNumber, parseTRDate } from '../utils/trParse';
import { tlYaz } from '../utils/currency';
import { bilinenSayi, ekranTutari, sayiSirala, tamTutar } from '../utils/para';
import {
  cetpaEvrakNolari, cariAdHaritasi, mikroSatisSatirlari as mikroSatisSatirlariHesapla,
  cetpaSatisSatirlari, satisKayitlari as satisKayitlariHesapla, satisKpi,
} from '../utils/muhasebe/satislar';
import { faturaTutarlari, mikroFaturaSatirlari as mikroFaturaSatirlariHesapla } from '../utils/muhasebe/faturalar';
import { mikroMizanSatirlari, mizanHesapla, fisDogrula } from '../utils/muhasebe/mizan';
import { kdvDonemi } from '../utils/muhasebe/kdvBeyan';
import { gelirGiderOzeti, grafikTavani } from '../utils/muhasebe/gelirGider';
import { dovizBakiyeleri, hareketleriAyikla } from '../utils/muhasebe/bankaHesap';
import { mikroCarileriAyir, bakiyeliCariKodlari, cariKarsilastirici, cariEslesir, cariKodu, musteridenTedarikci } from '../utils/muhasebe/cariImport';
// Hesap tek kaynakta (utils/muhasebe/isletmeSermayesi.ts) — ön-doldurmanın alacak süzgeci (odemeTakipli)
// ve stok değeri (depoDeger.depoToplamlari) artık oradan gelir; bu dosyada kopya yok.
import { prefillDegerleri, type WCKalemleri } from '../utils/muhasebe/isletmeSermayesi';
// İrsaliye toplamı / çalışan maaşı / depo dağılımı — 13 grubun dışında kalan üç yüzey (kapanış ölçüsü, 2026-09-18).
import { irsaliyeToplami, irsaliyeToplamYamasi, adediBilinmeyenKalem, depodakiAdet, formSayisi, girilenAlanYamasi, gorunenTutar, pozitifSayi } from '../utils/muhasebe/irsaliyeCalisan';
import { type MuhasebeMenuItem, type MuhasebeTarget } from '../lib/muhasebeMenu';
import DekontModal from './DekontModal';
import MikroFaturaDetay, { type MikroFaturaDetayVerisi } from './MikroFaturaDetay';
// SortHeader / formatTRY / formatCurrency / exportCSV / HESAP_PLANI tek evi: ./accounting/shared (döngü kırıldı, 2026-09-18)
import { formatTRY, HESAP_PLANI } from './accounting/shared';
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
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Download, Building2, BookOpen,
  X, Save, Calculator, BarChart3, FileText, Briefcase,
  AlertCircle, CheckCircle, Info, ArrowUpDown, ShoppingCart, Users, Truck, Package,
  ArrowRightLeft, CreditCard, FileUp, FileDown, Home,
  Wallet, Layers, Landmark, Palette} from 'lucide-react';
import TahsilatModule from './TahsilatModule';
import KasaModule from './KasaModule';
import MaliyetMerkeziModule from './MaliyetMerkeziModule';
import SabitKiymetModule from './SabitKiymetModule';
// jspdf + Türkçe font (1.5 MB'lık iki vendor chunk) TIKLAMA ANINDA dinamik
// yüklenir (2026-08-31 performans): statik import, Muhasebe sekmesi AÇILIR
// AÇILMAZ indiriyordu — PDF düğmesine hiç basılmasa bile.
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
import { oc } from '../i18n/ortak';
import { ac, type AccountingT } from '../i18n/accounting';

interface AccountingModuleProps {
  orders: Order[];
  currentLanguage: 'tr' | 'en';
  isAuthenticated?: boolean;
  userRole?: string | null;
  exchangeRates?: Record<string, number>;
  initialTab?: string;
  allowedTabs?: string[];
  /** Müşteriler sekmesi arama kutusunu dışarıdan tohumla (rapor kartından iniş, 2026-08-31). */
  initialCustomerSearch?: string;
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

const MONTHS_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Modül sözlüğü src/i18n/accounting.ts'e taşındı (Faz 3 2/n) — `AT[dil]` artık `ac(dil)`.


export type { AccountingT };

export default function AccountingModule({ orders = [], currentLanguage, isAuthenticated = false, userRole, exchangeRates, initialTab, allowedTabs, initialCustomerSearch, createNotification, warehouses: warehousesProp, employees: employeesProp, navMenu, onNavigate, controlledTab, onControlledTabChange, hideTabBar }: AccountingModuleProps) {
  const t = ac(currentLanguage);
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
  /** bakiye: NaN = bilinmiyor (DekontModal '—' basar; Mikro payload'ına girmez). */
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
    // Elle girilen toplam (KDV DAHİL). `invoiceSource` (sipariş) hiçbir yerden set edilmiyordu
    // (2026-09-18 ölçümü: `setInvoiceSource` yalnız null ile çağrılıyor) → her fatura ₺0/₺0/₺0
    // kaydediliyordu. Sipariş bağlanınca onun tutarı kullanılır, bağlı değilse bu alan.
    // Dokümana YAZILMAZ: hesaplanan totalPrice/kdvHaric/kdvTutari yazılır.
    tutar: '',
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
    // Hesap tek kaynakta (utils/muhasebe/faturalar.faturaTutarlari) — KDV ayrıştırma ve yuvarlama orada.
    // Tutar bilinmiyorsa (sipariş bağlı değil VE alan boş/geçersiz) fatura KAYDEDİLMEZ: eskiden
    // `src.totalPrice as number || 0` ile ₺0 tutarlı, ₺0 KDV'li sahte fatura yazılıyordu.
    const { tutar: girilenTutar, ...faturaAlanlari } = invoiceForm;
    const tutarlar = faturaTutarlari(src ? src.totalPrice : girilenTutar, invoiceForm.kdvOran);
    if (!tutarlar) {
      // İki durum: tutar BİLİNMİYOR (alan boş / sayı değil) ya da EKSİ girilmiş — modaldaki `min="0"`
      // tarayıcıca zorlanmıyor (modalda <form> yok). Mesaj ikisini de kapsar; hangisi olduğunu
      // modaldaki alan altı notu söyler.
      setToast({ msg: currentLanguage==='tr'
        ? 'Fatura tutarı geçersiz — fatura kesilmedi. Toplam (KDV dahil) alanına eksi olmayan bir tutar girin.'
        : 'Invoice amount is invalid — nothing was saved. Enter a non-negative total (VAT included).', type: 'error' });
      return;
    }
    await addDoc(collection(db, 'invoices'), {
      ...faturaAlanlari,
      lineItems,
      totalPrice: tutarlar.toplam,
      kdvHaric: tutarlar.kdvHaric,
      kdvTutari: tutarlar.kdvTutari,
      status: 'Kesildi',
      createdAt: serverTimestamp(),
    });
    if (src?.id) {
      await updateDoc(doc(db, 'orders', src.id as string), { hasInvoice: true, invoiceNo: invoiceForm.faturaNo });
    }
    setShowInvoiceModal(false);
    setInvoiceSource(null);
    setInvoiceForm({ faturaNo:'', faturaTipi:'e-fatura', customerName:'', customerEmail:'', taxId:'', taxOffice:'', address:'', kdvOran:20, date:format(new Date(),'yyyy-MM-dd'), notes:'', orderId:'', tutar:'' });
    setToast({ msg: ac(currentLanguage).fatura_basariyla_kesildi, type:'success' });
  };

  // Bank Accounts
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [showBankModal, setShowBankModal] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [bankImportStatus, setBankImportStatus] = useState<string | null>(null);
  const [bankSearch, setBankSearch] = useState('');
  const [bankSortKey, setBankSortKey] = useState<keyof BankAccount>('bankName');
  const [bankSortDir, setBankSortDir] = useState<'asc' | 'desc'>('asc');
  // `balance: '' ` = girilmedi (bilinmiyor) — eskiden 0'dı ve boş alan `Number('') === 0` ile
  // sessizce ₺0 bakiye kaydediyordu (saveBank artık bilinenSayi ile eler; utils/muhasebe/bankaHesap.ts grubu).
  const [bankForm, setBankForm] = useState({
    bankName: '', branch: '', accountHolder: '', accountNumber: '',
    iban: '', currency: 'TRY' as 'TRY' | 'USD' | 'EUR', balance: '' as number | '',
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
    // kdvOran null = ORAN BİLİNMİYOR (düzenlenen eski kayıt); yeni kayıt varsayılanı %0 (parite).
    borc: 0, alacak: 0, kdvOran: 0 as number | null,
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
      // Hesap tek kaynakta (utils/muhasebe/cariImport.ts): yalnız BİLİNEN ve ≠ 0 bakiye "bakiyeli" sayılır.
      setCariBalanceKodSet(bakiyeliCariKodlari(s.docs.map(d => ({ id: d.id, veri: d.data() as Record<string, unknown> }))));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'cariBalances'));
    return () => unsub();
  }, [isAuthenticated, userRole]);
  // İşletme sermayesi — editlenebilir kalemler (settings/workingCapital'da saklanır)
  type WCField = 'kasaBanka' | 'ticariAlacaklar' | 'stoklar' | 'ticariBorclar' | 'vergiSgk' | 'krediler';
  // Değerler `unknown`: DB'den null gelebilir, boşaltılan alan NaN'dır — 0 DEĞİL (utils/muhasebe/isletmeSermayesi.ts).
  const [workingCapital, setWorkingCapital] = useState<WCKalemleri>({
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
  const [customerSearch, setCustomerSearch] = useState(initialCustomerSearch ?? '');
  // Rapor kartından ikinci kez (farklı adla) inildiğinde de filtre güncellensin.
  useEffect(() => {
    if (initialCustomerSearch !== undefined) setCustomerSearch(initialCustomerSearch);
  }, [initialCustomerSearch]);
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
  // KUR UYDURMASI KALDIRILDI (2026-08-26). Eskiden `kpiRate` kuru okurken
  // "yoksa 1" yedegi kullaniyordu: bolen 1 olunca TL
  // tutari OLDUGU GIBI kalip basina '$' konuyordu (₺40.000 -> "$40.000",
  // ~38 kat sisirilmis KPI). Ceviri karari tek yerde: `kurCevir` kur yoksa
  // null doner, biz de yaniltici sayi yerine '—' basariz.
  // 2026-09-05: govde tek kaynaga (`tlYaz` = kurCevir + paraYaz) devredildi; imza korundu.
  const formatConv = (n: number): string => tlYaz(n, { birim: kpiCurrency, rates: exchangeRates });
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
  // creditLimit / balance BAŞLANGIÇ DEĞERİ null = "girilmedi" (0 DEĞİL) — yeni kayıtta da sahte
  // ₺0 limit/bakiye yazılmasın diye; saveCustomer/saveSupplier null alanı payload'a koymaz.
  const [customerForm, setCustomerForm] = useState<{ name: string; company: string; email: string; phone: string; address: string; taxNo: string; taxOffice: string; notes: string; creditLimit: number | null; balance: number | null; riskGroup: 'Düşük' | 'Orta' | 'Yüksek' }>({ name: '', company: '', email: '', phone: '', address: '', taxNo: '', taxOffice: '', notes: '', creditLimit: null, balance: null, riskGroup: 'Düşük' });
  const [supplierForm, setSupplierForm] = useState<{ name: string; company: string; email: string; phone: string; address: string; taxNo: string; notes: string; balance: number | null; riskGroup: 'Düşük' | 'Orta' | 'Yüksek' }>({ name: '', company: '', email: '', phone: '', address: '', taxNo: '', notes: '', balance: null, riskGroup: 'Düşük' });
  const [serviceForm, setServiceForm] = useState({ code: '', name: '', type: 'Ürün' as 'Ürün' | 'Hizmet', unitPrice: 0, vatRate: 18, unit: 'Adet', notes: '' });
  const [transferForm, setTransferForm] = useState({ fromWarehouse: '', toWarehouse: '', productName: '', quantity: 0, date: format(new Date(), 'yyyy-MM-dd'), notes: '', status: 'Bekliyor' as Transfer['status'] });
  const [checkForm, setCheckForm] = useState({ checkNo: '', bankName: '', amount: 0, dueDate: format(new Date(), 'yyyy-MM-dd'), drawer: '', type: 'Alınan' as Check['type'], status: 'Aktif' as Check['status'] });
  const [employeeForm, setEmployeeForm] = useState<{ name: string; employeeId: string; tcId: string; position: string; department: string; salary: number | null; startDate: string; email: string; phone: string }>({ name: '', employeeId: '', tcId: '', position: '', department: '', salary: null, startDate: format(new Date(), 'yyyy-MM-dd'), email: '', phone: '' });
  const [budgetForm, setBudgetForm] = useState({ category: 'Genel Gider', amount: 0, period: format(new Date(), 'yyyy-MM') });
  const [waybillForm, setWaybillForm] = useState<{
    waybillNo: string;
    invoiceNo: string;
    party: string;
    date: string;
    items: WaybillItem[];
    status: Waybill['status'];
    warehouseId: string;
  }>({
    waybillNo: '', invoiceNo: '', party: '', date: format(new Date(), 'yyyy-MM-dd'),
    items: [], status: 'Bekliyor', warehouseId: ''
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
    const [{ jsPDF }, { default: autoTable }, { registerTurkishFont }, { pdfBaslik, pdfAltBilgi, pdfTabloStili, PDF_RENK }] = await Promise.all([
      import('jspdf'), import('jspdf-autotable'), import('../utils/pdfFont'), import('../utils/pdfTheme'),
    ]);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    await registerTurkishFont(doc);
    // Bant tek kaynak (pdfTheme): eski 26 mm elle bant → 32 mm standart; gövde dönen Y'den başlar (Faz 2 3/n).
    const govdeY = pdfBaslik(doc, { belgeAdi: 'KDV BEYANNAMESİ ÖZETİ', meta: normTR(`Dönem: ${kdvMonth}/${kdvYear}`) });
    autoTable(doc, {
      ...pdfTabloStili(PDF_RENK.dark),
      startY: govdeY,
      head: [['Kalem', 'Tutar']],
      body: [
        ['Hesaplanan KDV', normTR(formatTRY(hesaplananKDV))],
        ['İndirilecek KDV', normTR(formatTRY(indirilecekKDV))],
        ['Ödenecek/İade KDV', normTR(formatTRY(odenecekKDV))],
        // Tutarı bilinmeyen kayıt varsa net TÜRETİLMEZ ('—'); beyannamede sessiz kalmaz, sayısı yazılır.
        ...(kdvTutarsiz > 0 ? [['Not', normTR(`${kdvTutarsiz} kayıt tutarsız — net hesaplanamadı`)]] : []),
      ],
    });
    const oranBody = Object.entries(kdvOranBreakdown).map(([oran, data]) => [
      oran === 'karma' ? (oc(currentLanguage).karma) : oran === 'bilinmiyor' ? (oc(currentLanguage).bilinmiyor) : `%${oran}`,
      normTR(formatTRY(ekranTutari(data.matrah))), normTR(formatTRY(ekranTutari(data.kdv))),
    ]);
    autoTable(doc, {
      ...pdfTabloStili(),
      startY: ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60) + 6,
      head: [['Oran', 'Matrah', 'KDV']],
      body: oranBody.length ? oranBody : [['—', '—', '—']],
    });
    pdfAltBilgi(doc);
    doc.save(`KDV_Beyanname_${kdvMonth}_${kdvYear}.pdf`);
    showToast(t.declarationPreparing);
  };

  // Excel/pivot çıktısı (CSV): ham SAYI değerleri (₺/format YOK) — Excel'de
  // toplanabilir/pivotlanabilir. Noktalı virgül ayraç (TR Excel ondalık virgül),
  // UTF-8 BOM (Türkçe karakter).
  const downloadVatDeclarationCSV = () => {
    // Bilinmeyen → BOŞ hücre (Excel'de toplama girmez); `Math.round(NaN)` hücreye 'NaN' metni basardı.
    const csvSayi = (n: number): number | string => (Number.isFinite(n) ? Math.round(n * 100) / 100 : '');
    const rows: (string | number)[][] = [
      ['KDV Beyannamesi Ozeti'],
      ['Donem', `${kdvMonth}/${kdvYear}`],
      [],
      ['Kalem', 'Tutar'],
      ['Hesaplanan KDV', csvSayi(hesaplananKDV)],
      ['Indirilecek KDV', csvSayi(indirilecekKDV)],
      ['Odenecek/Iade KDV', csvSayi(odenecekKDV)],
      ...(kdvTutarsiz > 0 ? [['Not', `${kdvTutarsiz} kayit tutarsiz`]] : []),
      [],
      ['Oran (%)', 'Matrah', 'KDV'],
      ...Object.entries(kdvOranBreakdown).map(([oran, data]) => [
        oran, csvSayi(ekranTutari(data.matrah)), csvSayi(ekranTutari(data.kdv)),
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
      // BANKA EKSTRESİ CSV → MUHASEBE FİŞİ (2026-08-22'de üç hata düzeltildi)
      //
      // 1) TUTAR (C1, KRİTİK): düz `parseFloat` kullanılıyordu.
      //    parseFloat('1.234,56') === 1.234 ve parseFloat('5.000') === 5 —
      //    yani Türk biçimli her ekstre satırı muhasebeye 1000× KÜÇÜK
      //    giriyordu. Artık `parseTRNumber` (src/utils/trParse.ts, testli).
      // 2) CSV BÖLME: `line.split(',')` alıntı içindeki ondalık virgülü de
      //    ayraç sayıp `"1.234,56"` alanını sayının ortasından bölüyordu;
      //    üstelik sonraki tüm kolonlar bir sağa kayıyordu. Artık PapaParse
      //    (projede zaten var, BankStatementImportModal onu kullanıyor).
      // 3) ÇİFT TARAFLI KAYIT (C2): fiş tek taraflı yazılıyordu
      //    (borc=X, alacak=0). Elle giriş formu `|borç-alacak| > 0.01` ise
      //    reddediyor — yani import, formun dayattığı muhasebe kuralını
      //    ihlal ediyordu: mizan asla denk gelmiyordu ve gelir tablosundaki
      //    `e.alacak ?? e.borc` ifadesi alacak=0 SAYISAL olduğu için
      //    ??'yi tetiklemiyor, tahsilatı 0 TL gelir sayıyordu.
      Papa.parse<Record<string, string>>(file, {
        header: true, skipEmptyLines: true, encoding: 'UTF-8',
        transformHeader: (h: string) => h.replace(/"/g, '').trim().toLowerCase(),
        complete: (sonuc) => {
          try {
            let imported = 0; let atlanan = 0;
            for (const entry of sonuc.data) {
              const rawTutar = entry['tutar'] || entry['amount'] || entry['borc'] || entry['borç'] || entry['alacak'] || '';
              const amount = parseTRNumber(rawTutar);
              if (!Number.isFinite(amount) || amount === 0) { if (rawTutar.trim()) atlanan++; continue; }
              const kategori = amount > 0 ? 'Tahsilat' : 'Ödeme';
              const mutlak = Math.abs(amount);
              const borcHesap   = amount > 0 ? '102 - Bankalar' : '320 - Satıcılar';
              const alacakHesap = amount > 0 ? '600 - Yurt İçi Satışlar' : '102 - Bankalar';
              addDoc(collection(db, 'journalEntries'), {
                date: parseTRDate(entry['tarih'] || entry['date'] || format(new Date(), 'yyyy-MM-dd')),
                fiş: entry['fiş'] || entry['fis'] || entry['belge'] || `IMP-${Date.now()}-${imported}`,
                aciklama: entry['açıklama'] || entry['aciklama'] || entry['description'] || entry['işlem'] || t.importedLabel,
                debitHesap: borcHesap,
                alacakHesap,
                // ÇİFT TARAFLI: borç == alacak == tutar. Elle giriş formunun
                // dayattığı kuralın aynısı; hangi hesabın borç hangisinin
                // alacak olduğu yukarıdaki debitHesap/alacakHesap'ta duruyor.
                borc: mutlak,
                alacak: mutlak,
                kdvOran: 0,
                kategori,
                createdAt: serverTimestamp(),
              }).catch(err => {
                // Sessiz yutma YOK: yazma başarısız olursa kullanıcı görsün,
                // yoksa "N kayıt aktarıldı" der ama kayıt yoktur.
                console.error('[banka CSV] fiş yazılamadı:', err);
                showToast(t.csvError, 'error');
              });
              imported++;
            }
            setBankImportStatus(t.importedCount(imported));
            const notlar = [
              t.csvSuccess(imported),
              atlanan ? (currentLanguage === 'tr'
                ? `${atlanan} satır okunamadı (tutar çözülemedi)`
                : `${atlanan} rows unreadable (amount could not be parsed)`) : '',
            ].filter(Boolean).join(' — ');
            showToast(notlar, atlanan ? 'error' : 'success');
          } catch {
            showToast(t.csvError, 'error');
          }
        },
        error: () => showToast(t.csvError, 'error'),
      });
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
      // Hesap tek kaynakta (utils/muhasebe/cariImport.ts) — rol ayrımı, alan eşlemesi, bilinmeyen bakiye/limit.
      onSnapshot(collection(db, 'leads'), s => {
        const { musteriler, tedarikciler } = mikroCarileriAyir(
          s.docs.map(d => ({ id: d.id, veri: d.data() as Record<string, unknown> })),
        );
        // Mikro'dan gelen tedarikçiler (type==='Supplier') Tedarikçiler sekmesini besler
        setMikroSuppliers(tedarikciler);
        setCustomers(musteriler);
      }, (error) => logFirestoreError(error, OperationType.LIST, 'leads')),
      onSnapshot(collection(db, 'suppliers'), s => setSuppliers(s.docs.map(d => ({ id: d.id, ...d.data() } as Supplier))), (error) => logFirestoreError(error, OperationType.LIST, 'suppliers')),
      onSnapshot(collection(db, 'services'), s => setServices(s.docs.map(d => ({ id: d.id, ...d.data() } as Service))), (error) => logFirestoreError(error, OperationType.LIST, 'services')),
      onSnapshot(collection(db, 'warehouseItems'), s => setWarehouseItems(s.docs.map(d => ({ id: d.id, ...d.data() } as WarehouseItem))), (error) => logFirestoreError(error, OperationType.LIST, 'warehouseItems')),
      onSnapshot(collection(db, 'transfers'), s => setTransfers(s.docs.map(d => ({ id: d.id, ...d.data() } as Transfer))), (error) => logFirestoreError(error, OperationType.LIST, 'transfers')),
      onSnapshot(collection(db, 'checks'), s => setChecks(s.docs.map(d => ({ id: d.id, ...d.data() } as Check))), (error) => logFirestoreError(error, OperationType.LIST, 'checks')),
      onSnapshot(collection(db, 'budgets'), s => setBudgets(s.docs.map(d => ({ id: d.id, ...d.data() } as Budget))), (error) => logFirestoreError(error, OperationType.LIST, 'budgets')),
      onSnapshot(collection(db, 'waybills'), s => setWaybills(s.docs.map(d => ({ id: d.id, ...d.data() } as Waybill))), (error) => logFirestoreError(error, OperationType.LIST, 'waybills')),
      onSnapshot(doc(db, 'settings', 'workingCapital'), s => {
        // Cast `Partial<WCKalemleri>`: DB'ye null yazılan alan state'e null gelir ve 'bilinmiyor' GÖSTERİLİR —
        // eski `Partial<Record<WCField, number>>` cast'i null gelince tip düzeyinde yalan söylüyordu.
        if (s.exists()) setWorkingCapital(prev => ({ ...prev, ...(s.data() as Partial<WCKalemleri>) }));
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
  /** Kalıcı yazım: bilinmeyen (NaN) alan null yazılır — 0 yazmak "0 TL beyan edildi" demektir.
   *  (JSON.stringify NaN'ı zaten null'a çevirir; niyeti örtük bırakmıyoruz.) */
  const wcSayi = (x: unknown): number | null => (bilinenSayi(x) ? Number(x) : null);
  const wcYazilabilir = (wc: WCKalemleri): Record<WCField, number | null> => ({
    kasaBanka: wcSayi(wc.kasaBanka), ticariAlacaklar: wcSayi(wc.ticariAlacaklar), stoklar: wcSayi(wc.stoklar),
    ticariBorclar: wcSayi(wc.ticariBorclar), vergiSgk: wcSayi(wc.vergiSgk), krediler: wcSayi(wc.krediler),
  });
  const updateWC = (field: WCField, value: number) => {
    setWorkingCapital(prev => {
      const next: WCKalemleri = { ...prev, [field]: value };
      if (wcSaveTimer.current) clearTimeout(wcSaveTimer.current);
      wcSaveTimer.current = setTimeout(() => {
        void setDoc(doc(db, 'settings', 'workingCapital'), { ...wcYazilabilir(next), updatedAt: serverTimestamp() }, { merge: true })
          .then(() => { setWcSaved(true); setTimeout(() => setWcSaved(false), 1500); })
          .catch(() => { /* non-critical */ });
      }, 600);
      return next;
    });
  };
  // Gerçek veriden ön-doldur: alacaklar = ödenmemiş siparişler, stok = depo değeri.
  // Hesap tek kaynakta (utils/muhasebe/isletmeSermayesi.ts → prefillDegerleri; stok depoDeger.depoToplamlari,
  // alacak süzgeci utils/siparis.odemeTakipli).
  //
  // Mikro faturasindan turetilen siparislerde `paid` YOKTUR — tahsilat gercegi
  // Mikro cari hesabinda. Suzgec olmadan bu buton, bilinmeyeni "alacak" sayip
  // settings/workingCapital'a KALICI yaziyordu; sonrasinda cari oran/likidite
  // rakamlari silinmeyecek sekilde sisiyordu (2026-09-04 denetimi).
  const prefillWC = () => {
    const { alacak, stok } = prefillDegerleri(orders, warehouseItems);
    // Bu iki değer settings/workingCapital'a KALICI yazılıp cari oran/likiditeye girer → EKRAN değil
    // TÜRETME kapısı: `tamTutar`, bir kayıt bile tutarsızsa NaN döner ve o alan HİÇ yazılmaz. Kısmi
    // toplamı kalıcı yazmak sahte 0'ın başka bir biçimidir: ertesi gün kimse eksik olduğunu göremez.
    const arToplam = tamTutar(alacak);
    const stokToplam = tamTutar(stok);
    const next: WCKalemleri = {
      ...workingCapital,
      ...(Number.isFinite(arToplam) ? { ticariAlacaklar: Math.round(arToplam) } : {}),
      ...(Number.isFinite(stokToplam) ? { stoklar: Math.round(stokToplam) } : {}),
    };
    setWorkingCapital(next);
    void setDoc(doc(db, 'settings', 'workingCapital'), { ...wcYazilabilir(next), updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
    const tutarsiz = alacak.bilinmeyen + stok.bilinmeyen;
    if (tutarsiz > 0) showToast(currentLanguage === 'tr' ? `${tutarsiz} kayıt tutarsız — ilgili alan ön-doldurulmadı.` : `${tutarsiz} records have unknown amounts — the affected field was not prefilled.`, 'info');
  };

  const handleSyncMikroBank = async () => {
    if (!mikroEnabled || !mikroAccessToken) {
      showToast(ac(currentLanguage).mikro_erp_entegrasyonu_aktif_degil, 'error');
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
        showToast(ac(currentLanguage).mikro_jumpbulut_api_sinde_banka_hareketi_servisi, 'info');
      } else if (res?.Data) {
        setMikroBankMovements(res.Data as never[]);
        setMikroBankLastSync(new Date().toLocaleString());
        showToast(ac(currentLanguage).banka_hareketleri_basariyla_cekildi, 'success');
      } else {
        showToast(ac(currentLanguage).hareket_bulunamadi, 'info');
      }
    } catch (err) {
      console.error(err);
      showToast(ac(currentLanguage).mikro_api_hatasi, 'error');
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
      
      showToast(ac(currentLanguage).mikro_yapilandirmasi_kaydedildi);
    } catch (err) {
      logFirestoreError(err, OperationType.UPDATE, 'settings/mikro', auth.currentUser?.uid);
      showToast(t.errorOccurred, 'error');
    }
  };

  // Bank CRUD
  const openAddBank = () => {
    setEditingBank(null);
    setBankForm({ bankName: '', branch: '', accountHolder: '', accountNumber: '', iban: '', currency: 'TRY', balance: '', accountType: 'Vadesiz' });
    setShowBankModal(true);
  };

  const openEditBank = (acc: BankAccount) => {
    setEditingBank(acc);
    // DB'den sayı olmayan bakiye gelebilir (listener hiçbir alanı doğrulamıyor) → alan boş açılır, 0 yazılmaz
    setBankForm({ bankName: acc.bankName, branch: acc.branch, accountHolder: acc.accountHolder, accountNumber: acc.accountNumber, iban: acc.iban, currency: acc.currency, balance: bilinenSayi(acc.balance) ? Number(acc.balance) : '', accountType: acc.accountType });
    setShowBankModal(true);
  };

  const saveBank = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!bankForm.bankName.trim()) return showToast(t.bankNameRequired, 'error');
    // Bilinmeyen bakiye KAYDEDİLMEZ: boş alan eskiden `Number('') === 0` ile sessizce ₺0 yazıyordu
    if (!bilinenSayi(bankForm.balance)) return showToast(ac(currentLanguage).bakiye_sayi_olmali_bos_birakilirsa_kaydedilmez_b, 'error');
    const kayit = { ...bankForm, balance: Number(bankForm.balance) };
    try {
      if (editingBank) {
        await updateDoc(doc(db, 'bankAccounts', editingBank.id), { ...kayit, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'bankAccounts'), { ...kayit, updatedAt: serverTimestamp() });
        showToast(t.accountAdded);
      }
      setShowBankModal(false);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteBank = async (id: string) => {
    const ok = await confirmAction({
      title: ac(currentLanguage).hesabi_sil,
      message: t.confirmDeleteAccount,
      confirmLabel: oc(currentLanguage).sil,
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
      showToast(ac(currentLanguage).mikro_entegrasyonu_etkin_degil_veya_access_token, 'error');
      return;
    }
    setBankTxPulling(true);
    try {
      const config = { endpoint: mikroEndpoint, accessToken: mikroAccessToken, enabled: mikroEnabled };
      const today = format(new Date(), 'yyyy-MM-dd');
      const monthAgo = format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
      const result = await pullBankMovementsFromMikro({ baslangicTarihi: monthAgo, bitisTarihi: today }, config) as Record<string, unknown>;
      if (result?.notImplemented) {
        showToast(ac(currentLanguage).mikro_jumpbulut_api_sinde_banka_hareketi_servisi, 'info');
        setBankTxPulling(false);
        return;
      }
      const rows = (result?.data ?? result?.items ?? result?.list ?? []) as unknown[];

      // Hesap tek kaynakta (utils/muhasebe/bankaHesap.ts hareketleriAyikla): tutarı bilinmeyen satır
      // YAZILMAZ ve sayılır (eskiden "₺0 alacak" olarak kalıcı yazılıyordu); bakiyesi bilinmeyen satır
      // bakiyesiz yazılır (ekran '—'); tanınmayan döviz kodu tipe yalan söylenmeden atlanır ve sayılır.
      const ayik = hareketleriAyikla(rows, { bugun: today });
      const newTxs: Omit<BankTransaction, 'id'>[] = ayik.kayitlar.map(k => ({ ...k, createdAt: serverTimestamp() }));

      // Upsert to Firestore (skip duplicates by reference+date)
      const existing = new Set(bankTransactions.map(t => `${t.reference}_${t.date}`));
      const toAdd = newTxs.filter(t => !existing.has(`${t.reference}_${t.date}`));
      await Promise.all(toAdd.map(tx => addDoc(collection(db, 'bankTransactions'), tx)));

      const now = format(new Date(), 'dd.MM.yyyy HH:mm');
      setBankTxLastPull(now);
      const atlamaNotu = currentLanguage === 'tr'
        ? `${ayik.atlanan > 0 ? ` ${ayik.atlanan} satır atlandı (${ayik.tutarsiz} tutarı bilinmiyor, ${ayik.birimsiz} birimi tanınmadı).` : ''}${ayik.bakiyesiz > 0 ? ` ${ayik.bakiyesiz} hareketin bakiyesi bilinmiyor.` : ''}`
        : `${ayik.atlanan > 0 ? ` ${ayik.atlanan} row(s) skipped (${ayik.tutarsiz} without amount, ${ayik.birimsiz} unknown currency).` : ''}${ayik.bakiyesiz > 0 ? ` ${ayik.bakiyesiz} without balance.` : ''}`;
      showToast(
        (currentLanguage === 'tr'
          ? `${toAdd.length} yeni hareket çekildi.`
          : `${toAdd.length} new transactions pulled.`) + atlamaNotu,
        ayik.atlanan > 0 ? 'info' : 'success'
      );
    } catch (err) {
      console.error('Bank pull error:', err);
      showToast(ac(currentLanguage).banka_hareketleri_cekilemedi, 'error');
    } finally {
      setBankTxPulling(false);
    }
  };

  // Journal CRUD
  const saveJournal = async () => {
    if (!isAuthenticated) return showToast(t.loginRequired, 'error');
    if (!journalForm.aciklama.trim()) return showToast(t.descRequired, 'error');
    // Hesap tek kaynakta (utils/muhasebe/mizan.fisDogrula) — sıra: bilinmiyor → pozitif değil → dengesiz
    const fis = fisDogrula(journalForm.borc, journalForm.alacak);
    if (fis.hata === 'bilinmiyor') return showToast(ac(currentLanguage).borc_ve_alacak_tutari_sayi_olmali, 'error');
    if (fis.hata === 'pozitifDegil') return showToast(ac(currentLanguage).borc_ve_alacak_tutarlari_sifirdan_buyuk_olmali, 'error');
    if (fis.hata === 'dengesiz') return showToast(currentLanguage === 'tr' ? `Fiş dengesiz: borç (${fis.borc}) ≠ alacak (${fis.alacak}).` : `Unbalanced entry: debit (${fis.borc}) ≠ credit (${fis.alacak}).`, 'error');
    try {
      if (editingJournal) {
        await updateDoc(doc(db, 'journalEntries', editingJournal.id), { ...journalForm, borc: fis.borc, alacak: fis.alacak, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'journalEntries'), { ...journalForm, borc: fis.borc, alacak: fis.alacak, createdAt: serverTimestamp() });
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
      title: ac(currentLanguage).kaydi_sil,
      message: t.confirmDeleteEntry,
      confirmLabel: oc(currentLanguage).sil,
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
      // Bilinmeyen oran forma %0 yazılmaz — seçimde '—' kalır (kullanıcı seçmezse null kaydedilir).
      kdvOran: bilinenSayi(e.kdvOran) ? Number(e.kdvOran) : null,
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
      confirmLabel: oc(currentLanguage).sil,
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
      confirmLabel: oc(currentLanguage).sil,
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
        // KREDİ LİMİTİ KOŞULLU (2026-09-18 delta turu): limit bilinmiyorsa (form boş / kayıtta
        // alan hiç yok — Mikro cari importu bu alanı yazmaz) anahtar payload'a HİÇ girmez.
        // Eskiden form `c.creditLimit || 0` ile doluyor ve yalnız adresi düzeltmek için açılan
        // bir kaydın limiti KALICI ₺0 oluyordu; krediLimiti() null yerine 0 dönüp cari ekstre
        // kartı '—' yerine ₺0, export boş yerine 0 basıyordu.
        // Önceden BİLİNEN limiti kullanıcı boşalttıysa açıkça null yazılır (PATCH-merge eskiyi korur, silme
        // sessiz no-op olurdu — 2026-09-19 kapanış incelemesi, çalışan maaşıyla aynı sınıf): girilenAlanYamasi.
        ...girilenAlanYamasi('creditLimit', customerForm.creditLimit, editingCustomer?.creditLimit),
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
      setCustomerForm({ name: '', company: '', email: '', phone: '', address: '', taxNo: '', taxOffice: '', notes: '', creditLimit: null, balance: null, riskGroup: 'Düşük' });
      setEditingCustomer(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteCustomer = async (id: string) => {
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: oc(currentLanguage).sil,
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
      // BAKİYE KOŞULLU (2026-09-18 delta turu): bilinmiyorsa (form boş / kayıtta alan hiç yok —
      // Satın Alma'dan açılan tedarikçi `{name, createdAt}` olarak yazılıyor) anahtar payload'a
      // HİÇ girmez. `{ ...supplierForm }` spread'i eskiden `balance: 0` yazıyor ve yalnız telefonu
      // düzeltmek için açılan kaydın bakiyesi KALICI '₺0 / sıfır' oluyordu.
      const { balance, ...supplierRest } = supplierForm;
      // Önceden BİLİNEN bakiyeyi kullanıcı boşalttıysa açıkça null (girilenAlanYamasi; müşteri limiti / maaş ile aynı kural).
      const supplierVeri = { ...supplierRest, ...girilenAlanYamasi('balance', balance, editingSupplier?.balance) };
      if (editingSupplier) {
        await updateDoc(doc(db, 'suppliers', editingSupplier.id), { ...supplierVeri, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'suppliers'), { ...supplierVeri, createdAt: serverTimestamp() });
        showToast(t.accountAdded);
      }
      setShowSupplierModal(false);
      setSupplierForm({ name: '', company: '', email: '', phone: '', address: '', taxNo: '', notes: '', balance: null, riskGroup: 'Düşük' });
      setEditingSupplier(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteSupplier = async (id: string) => {
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: oc(currentLanguage).sil,
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
      confirmLabel: oc(currentLanguage).sil,
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
    // 0 / boş miktarlı transfer kaydedilmez: bu kayıt Mikro'ya giden depo transfer evrakının girdisidir.
    if (!pozitifSayi(transferForm.quantity)) return showToast(ac(currentLanguage).transfer_miktari_sifirdan_buyuk_olmali, 'error');
    try {
      if (editingTransfer) {
        await updateDoc(doc(db, 'transfers', editingTransfer.id), { ...transferForm, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'transfers'), { ...transferForm, createdAt: serverTimestamp() });
        showToast(t.accountAdded);
        if (createNotification) {
          await createNotification(
            ac(currentLanguage).yeni_transfer,
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
      confirmLabel: oc(currentLanguage).sil,
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
    if (!pozitifSayi(checkForm.amount)) return showToast(ac(currentLanguage).cek_tutari_sifirdan_buyuk_olmali, 'error');
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
      confirmLabel: oc(currentLanguage).sil,
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
    // Maaş bilinmiyorsa (alan boş) `salary` sahte ₺0 olarak YAZILMAZ — eski `{ ...employeeForm }` yayımı, yalnız
    // telefonu düzeltilen çalışanın bilinmeyen maaşını kalıcı ₺0 yapıyordu (MusterilerTab creditLimit ile aynı
    // sınıf). Önceden BİLİNEN maaşı kullanıcı boşalttıysa açıkça null yazılır (PATCH-merge eskiyi korurdu):
    // kural tek kaynakta — utils/muhasebe/irsaliyeCalisan.girilenAlanYamasi.
    const { salary, ...calisanAlanlari } = employeeForm;
    const calisanKaydi = { ...calisanAlanlari, ...girilenAlanYamasi('salary', salary, editingEmployee?.salary) };
    try {
      if (editingEmployee) {
        await updateDoc(doc(db, 'employees', editingEmployee.id), { ...calisanKaydi, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        await addDoc(collection(db, 'employees'), { ...calisanKaydi, createdAt: serverTimestamp() });
        showToast(t.accountAdded);
      }
      setShowEmployeeModal(false);
      setEmployeeForm({ name: '', employeeId: '', tcId: '', position: '', department: '', salary: null, startDate: format(new Date(), 'yyyy-MM-dd'), email: '', phone: '' });
      setEditingEmployee(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteEmployee = async (id: string) => {
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: oc(currentLanguage).sil,
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
    // Boşaltılan tutar alanı 0 üretir — ₺0 bütçe hedefi kaydedilmez (gerçekleşme oranı 0'a bölünürdü).
    if (!budgetForm.period) return showToast(ac(currentLanguage).donem_secilmeli, 'error');
    if (!pozitifSayi(budgetForm.amount)) return showToast(ac(currentLanguage).butce_tutari_sifirdan_buyuk_olmali, 'error');
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
      confirmLabel: oc(currentLanguage).sil,
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
    // Adedi okunamayan kalem (boşaltılmış sayı alanı) kaydedilmez: 'Tamamlandı' irsaliyede bu miktar aşağıda
    // warehouseItems.quantity'ye YAZILIR — NaN stok üretirdi.
    const adetsizKalem = adediBilinmeyenKalem(waybillForm.items);
    if (adetsizKalem > 0) return showToast(currentLanguage === 'tr' ? `${adetsizKalem} kalemin miktarı boş — irsaliye kaydedilmedi` : `${adetsizKalem} line(s) have no quantity — waybill not saved`, 'error');
    // Toplam kalemlerden TÜRETİLİR (utils/muhasebe/irsaliyeCalisan.irsaliyeToplami). Eski kod modalda toplamı
    // hesaplayıp gösteriyor ama forma yazmıyordu: her yeni irsaliye `total: 0` kaydediliyordu. Türetilemiyorsa
    // (kalemsiz / fiyatı ya da KDV'si boş kalem): yeni kayıtta `total` hiç yazılmaz; DÜZENLEMEDE açıkça null
    // yazılır — türetilen alanın girdileri değişti, PATCH-merge'in koruyacağı eski toplam artık YANLIŞ
    // (irsaliyeToplamYamasi; 2026-09-19 kapanış incelemesi). Liste her iki durumda '—' gösterir.
    const irsaliyeKaydi = { ...waybillForm, ...irsaliyeToplamYamasi(waybillForm.items, editingWaybill !== null) };
    try {
      let waybillId = '';
      if (editingWaybill) {
        waybillId = editingWaybill.id;
        await updateDoc(doc(db, 'waybills', waybillId), { ...irsaliyeKaydi, updatedAt: serverTimestamp() });
        showToast(t.accountUpdated);
      } else {
        const docRef = await addDoc(collection(db, 'waybills'), { ...irsaliyeKaydi, type: waybillType, createdAt: serverTimestamp() });
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
      setWaybillForm({ waybillNo: '', invoiceNo: '', party: '', date: format(new Date(), 'yyyy-MM-dd'), items: [], status: 'Bekliyor', warehouseId: '' });
      setEditingWaybill(null);
    } catch { showToast(t.errorOccurred, 'error'); }
  };

  const deleteWaybill = async (id: string) => {
    const ok = await confirmAction({
      title: t.confirmDeleteAccount,
      message: t.confirmDeleteEntry,
      confirmLabel: oc(currentLanguage).sil,
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

  // KPI computations — Hesap tek kaynakta (utils/muhasebe/bankaHesap.ts dovizBakiyeleri):
  // bakiyesi bilinmeyen (DB'de null/sayı olmayan) hesap toplama girmez, sayılır; hiç bilinen yoksa NaN → paraYaz '—'.
  const bankaBakiyeleri = dovizBakiyeleri(bankAccounts);
  const tryBalance = ekranTutari(bankaBakiyeleri.TRY);
  const usdBalance = ekranTutari(bankaBakiyeleri.USD);
  const eurBalance = ekranTutari(bankaBakiyeleri.EUR);
  const bakiyeBilinmeyen = { TRY: bankaBakiyeleri.TRY.bilinmeyen, USD: bankaBakiyeleri.USD.bilinmeyen, EUR: bankaBakiyeleri.EUR.bilinmeyen };

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
      // Sayısal sütunlar: bilinmeyen (DB null/NaN) 0 sayılmaz, listenin SONUNA gider (para.ts sayiSirala) — yönü `-cmp` ile çevirme
      if (journalSortKey === 'borc' || journalSortKey === 'alacak' || journalSortKey === 'kdvOran') return sayiSirala(a[journalSortKey], b[journalSortKey], journalSortDir === 'desc');
      let cmp = 0;
      if (journalSortKey === 'date') cmp = (a.date || '').localeCompare(b.date || '');
      else if (journalSortKey === 'kategori') cmp = (a.kategori || '').localeCompare(b.kategori || '', 'tr');
      else if (journalSortKey === 'fiş') cmp = (a.fiş || '').localeCompare(b.fiş || '', 'tr');
      else if (journalSortKey === 'aciklama') cmp = (a.aciklama || '').localeCompare(b.aciklama || '', 'tr');
      else if (journalSortKey === 'debitHesap') cmp = (a.debitHesap || '').localeCompare(b.debitHesap || '', 'tr');
      else if (journalSortKey === 'alacakHesap') cmp = (a.alacakHesap || '').localeCompare(b.alacakHesap || '', 'tr');
      return journalSortDir === 'asc' ? cmp : -cmp;
    });

  // Mizan computation — hesap tek kaynakta (utils/muhasebe/mizan.mikroMizanSatirlari + mizanHesapla);
  // 2026-08-13 Mikro-sentez gerekçesi (hesap planı yön tablosu, "alış stok hesabına düşer") da oraya taşındı.
  const mikroMizan = mikroMizanSatirlari(mikroFaturalar);          // { satirlar, bilinmeyen: matrah/KDV'si bilinmeyen fatura }
  const mizan = mizanHesapla(journalEntries, mikroMizan.satirlar);  // satır Tutar'ları + bakiye (NaN = türetilemedi) + dengeli boolean|null
  // MizanTab sayısal MizanRow bekler: satır/toplam tutarları EKRAN sözleşmesi (ekranTutari: kısmi toplam + not,
  // hiç bilinen yoksa NaN → '—'); bakiye TÜRETME (tamTutar kapısı, NaN → '—').
  const mizanRows = mizan.satirlar.map(r => ({
    hesap: r.hesap, borc: ekranTutari(r.borc), alacak: ekranTutari(r.alacak),
    borcBakiye: r.borcBakiye, alacakBakiye: r.alacakBakiye,
  }));
  const mizanBilinmeyen = mizan.bilinmeyen;           // tutarı bilinmeyen yevmiye kaydı sayısı
  const mizanMikroBilinmeyen = mikroMizan.bilinmeyen; // mizana alınamayan Mikro faturası sayısı

  const toggleMizanSort = (key: typeof mizanSortKey) => {
    if (mizanSortKey === key) setMizanSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setMizanSortKey(key); setMizanSortDir('asc'); }
  };

  const sortedMizanRows = [...mizanRows].sort((a, b) => {
    if (mizanSortKey === 'hesap') { const cmp = a.hesap.localeCompare(b.hesap, 'tr'); return mizanSortDir === 'asc' ? cmp : -cmp; }
    return sayiSirala(a[mizanSortKey], b[mizanSortKey], mizanSortDir === 'desc'); // bilinmeyen (NaN) sona
  });

  const mizanTotals = {
    borc: ekranTutari(mizan.toplam.borc), alacak: ekranTutari(mizan.toplam.alacak),
    borcBakiye: ekranTutari(mizan.toplam.borcBakiye), alacakBakiye: ekranTutari(mizan.toplam.alacakBakiye),
  };
  const mizanDengeli = mizan.dengeli; // boolean | null — null: bir taraf bilinmeyen içeriyor, rozet verilmez
  const displayedMizan = mizanSearch
    ? sortedMizanRows.filter(r => r.hesap.toLowerCase().includes(mizanSearch.toLowerCase()))
    : sortedMizanRows;

  // ── Mikro faturaları, Cetpa satışlarının YANINDA ────────────────────────
  // Mevcut `displayedSatis` (orders tabanlı) ve tüm KPI kartları AYNEN kalır;
  // burada yalnız EK satırlar hazırlanır. Varsayılan kaynak 'cetpa' olduğu için
  // ekran davranışı değişmez — Mikro'yu görmek opt-in.
  //
  // Hesap tek kaynakta (utils/muhasebe/satislar.cetpaEvrakNolari / cariAdHaritasi)
  // — mükerrer sayım elemesi ve Mikro cari kodu → müşteri adı eşlemesi orada.
  const cetpayaAitEvrakNo = cetpaEvrakNolari(orders);
  const cariAdMap = cariAdHaritasi(customers);
  // Hesap tek kaynakta (utils/muhasebe/faturalar.mikroFaturaSatirlari) — yön/yıl/e-belge türü
  // süzgeçleri, mükerrer sayım elemesi, "arama filtresi buradan kaldırıldı (2026-08-28)" ve
  // "KDV% kolonu tutara göre sıralanır (2026-08-17)" notları modülde. Bilinmeyen tutar/KDV
  // artık 0 sayılmaz, sıralamada her iki yönde de SONA gider (`para.sayiSirala`).
  // ⚠️ `sirala` SATIŞLAR sekmesinin durumunu kullanıyor (sayfa paritesi için korundu) — bkz. Açık İşler.
  const mikroFaturaSatirlari = mikroFaturaSatirlariHesapla(mikroFaturalar, {
    yon: faturaYon,
    yil: faturaYil,
    ebelgeTuru: invoiceTypeFilter,
    cetpaEvrakNolari: cetpayaAitEvrakNo,
    cariAdMap,
    sirala: { anahtar: satisSortKey, yon: satisSortDir },
  });
  // Satışlar sekmesi: yalnız giden (satış) faturaları.
  // Hesap tek kaynakta (utils/muhasebe/satislar.mikroSatisSatirlari) — yön/yıl/evrak
  // dışlamaları, arama ve sıralama (bilinmeyen tutar/KDV sona) orada; BAĞIMSIZ ZİNCİR
  // (2026-08-11) ve "KDV% kolonu tutara göre sıralanır" (2026-08-17) notları da modülde.
  const mikroSatisSatirlari = mikroSatisSatirlariHesapla(mikroFaturalar, {
    yil: satisYil,
    cetpaEvrakNolari: cetpayaAitEvrakNo,
    cariAdMap,
    arama: satisSearch,
    siralama: { anahtar: satisSortKey, azalan: satisSortDir === 'desc' },
  });
  // Mikro satış faturaları tanım gereği FATURALI. Satışlar KPI'larına additive
  // katılır (satisKaynak Mikro'yu içeriyorsa); orders mantığı (q-serisi faturasız
  // dahil) korunur — kullanıcının "bu modülü bozma" uyarısı gereği toplamlar
  // toplanır, drill-down/orders akışına dokunulmaz.
  const mikroDahil = satisKaynak !== 'cetpa';
  // Hesap tek kaynakta (utils/muhasebe/satislar.satisKpi) — additive toplama, Mikro
  // payı, müşteri/oran kırılımları; bilinmeyen tutar 0 sayılmaz, SAYILIR.
  const satisOzet = satisKpi(orders, mikroSatisSatirlari, mikroDahil);
  // Hesap tek kaynakta (utils/muhasebe/satislar.satisKayitlari) — Mikro faturaları
  // drill-down için orders şekline çevrilir (orders BOŞ olduğu için detaylar
  // "Kayıt bulunamadı" gösteriyordu — 2026-08-02).
  const satisKayitlari = satisKayitlariHesapla(orders, mikroSatisSatirlari, mikroDahil);

  // Satışlar computed — hesap tek kaynakta (utils/muhasebe/satislar.cetpaSatisSatirlari):
  // arama tr-TR küçük harf, bilinmeyen tutar/oran/tarih her iki yönde de sona.
  const displayedSatis = cetpaSatisSatirlari(orders, {
    arama: satisSearch,
    siralama: { anahtar: satisSortKey, azalan: satisSortDir === 'desc' },
  });

  const toggleSatisSort = (key: typeof satisSortKey) => {
    if (satisSortKey === key) setSatisSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSatisSortKey(key); setSatisSortDir('asc'); }
  };

  // Müşteriler computed — sıralama/arama tek kaynakta (utils/muhasebe/cariImport.ts): bilinmeyen bakiye sona.
  const displayedMusteriler = customers
    .filter(c => cariEslesir(c, customerSearch))
    .sort(cariKarsilastirici<Customer>(musteriSortKey, musteriSortDir));

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
    const kod = cariKodu(c);
    const m = !!kod && satisCariKodSet.has(kod);
    const td = !!kod && alisCariKodSet.has(kod);
    if (m && td) return { label: ac(currentLanguage).musteri_tedarikci, cls: 'bg-purple-100 text-purple-700' };
    if (td)      return { label: oc(currentLanguage).tedarikci, cls: 'bg-amber-100 text-amber-700' };
    if (m)       return { label: oc(currentLanguage).musteri, cls: 'bg-teal-100 text-teal-700' };
    // Satış/alış faturası YOK ama bakiyesi VAR → gider/diğer cari (7 Mehmet gibi).
    // "Gider" demiyoruz (personel/banka/vergi carisi de olabilir) — dürüst etiket "Diğer".
    if (!!kod && cariBalanceKodSet.has(kod)) return { label: oc(currentLanguage).diger, cls: 'bg-gray-100 text-gray-600' };
    return null;
  };
  // Hesap tek kaynakta (utils/muhasebe/cariImport.ts): musteridenTedarikci bakiye/risk/cari kodu KAYBETMEDEN taşır.
  const mikroTedarikcileri: Supplier[] = customers
    .filter(c => { const kod = cariKodu(c); return !!kod && alisCariKodSet.has(kod); })
    .map(musteridenTedarikci);
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
    .filter(s => cariEslesir(s, supplierSearch))
    .sort(cariKarsilastirici<Supplier>(tedarikciSortKey, tedarikciSortDir));

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
        const bd = (wi as unknown as { depoBreakdown?: Record<string, unknown> | null }).depoBreakdown;
        const q = depodakiAdet(bd, depoNo);
        // Anahtar VAR ama sayı okunamıyorsa (NaN) kalem listede KALIR: adet '—' görünür, depoToplamlari onu
        // "bilinmeyen" sayar. Eski `Number(bd[depoNo] ?? 0)` + `q > 0` bu kalemi depodan sessizce düşürüyordu.
        if (q > 0 || Number.isNaN(q)) out.push({ ...wi, quantity: q });
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
      // Maaş: bilinmeyen 0 sayılmaz, her iki yönde de SONA gider (para.sayiSirala) — yönü `-cmp` ile çevirme
      // Hücre 0'ı da '—' basar (eski sahte-sıfır kayıtları) — sıralayıcı aynı tanımı kullanır: gorunenTutar.
      if (calisanSortKey === 'salary') return sayiSirala(gorunenTutar(a.salary), gorunenTutar(b.salary), calisanSortDir === 'desc');
      let cmp: number;
      if (calisanSortKey === 'startDate') cmp = (a.startDate || '').localeCompare(b.startDate || '');
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
        // Toplam: bilinmeyen 0 sayılmaz, her iki yönde de SONA gider (para.sayiSirala) — yönü `-cmp` ile çevirme
        // Hücre 0'ı da '—' basar (eski `total: 0` kayıtları) — sıralayıcı aynı tanımı kullanır: gorunenTutar.
        if (irsaliyeSortKey === 'total') return sayiSirala(gorunenTutar(a.total), gorunenTutar(b.total), irsaliyeSortDir === 'desc');
        let cmp: number;
        if (irsaliyeSortKey === 'date') cmp = a.date.localeCompare(b.date);
        else if (irsaliyeSortKey === 'status') cmp = a.status.localeCompare(b.status, 'tr');
        else if (irsaliyeSortKey === 'party') cmp = a.party.localeCompare(b.party, 'tr');
        else cmp = a.waybillNo.localeCompare(b.waybillNo);
        return irsaliyeSortDir === 'asc' ? cmp : -cmp;
      });

  const toggleIrsaliyeSort = (key: typeof irsaliyeSortKey) => {
    if (irsaliyeSortKey === key) setIrsaliyeSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setIrsaliyeSortKey(key); setIrsaliyeSortDir('asc'); }
  };

  // Gelir/Gider — hesap tek kaynakta (utils/muhasebe/gelirGider.ts): fisTutari (C2 kuralı), dönem/aralık
  // süzgeci, Mikro giden = gelir / gelen ≠ gider kuralı, 12 aylık grafik, hesap kırılımı.
  // Bilinmeyen tutar 0 sayılmaz, SAYILIR.
  const ggOzeti = gelirGiderOzeti(journalEntries, mikroFaturalar, {
    yil: gelirYear, ay: gelirMonth,
    aralik: gelirUseRange ? { from: gelirDateFrom, to: gelirDateTo } : undefined,
  });
  const toplamGelir = ekranTutari(ggOzeti.gelir);   // kısmi toplam + sekmede "N kayıt tutarsız" notu; hiç bilinen yoksa NaN → '—'
  const toplamGider = ekranTutari(ggOzeti.gider);
  const netKar = ggOzeti.net;                        // tamTutar: bir kayıt bile bilinmiyorsa NaN → formatInCurrency '—'
  const monthlyData = ggOzeti.aylik.map((a, i) => ({ month: MONTHS[i], gelir: ekranTutari(a.gelir), gider: ekranTutari(a.gider) }));
  const maxChartVal = grafikTavani(ggOzeti.aylik);
  // `as const` tuple: Object.fromEntries'in tuple aşırı yüklemesini seçtirir — düz dizide dönüş `any` olurdu.
  const gelirBreakdown = Object.fromEntries(Object.entries(ggOzeti.gelirKirilimi).map(([h, t]) => [h, ekranTutari(t)] as const));
  const giderBreakdown = Object.fromEntries(Object.entries(ggOzeti.giderKirilimi).map(([h, t]) => [h, ekranTutari(t)] as const));

  // KDV computation — hesap tek kaynakta (utils/muhasebe/kdvBeyan.kdvDonemi):
  // dönem süzgeci, 391/191 KPI'ları, oran kırılımı (journal 6xx + Mikro giden bantları)
  // ve drill-down listeleri orada; açıklamalar modülün docblock'una taşındı.
  const kdvDonem = kdvDonemi(journalEntries, mikroFaturalar, kdvYear, kdvMonth);
  const hesaplananKDV = ekranTutari(kdvDonem.hesaplanan);   // hiç bilinen yoksa NaN → formatTRY '—'; kısmi toplam + not
  const indirilecekKDV = ekranTutari(kdvDonem.indirilecek);
  const odenecekKDV = kdvDonem.odenecek;                    // TÜRETME (tamTutar farkı): bir taraf eksikse NaN
  const kdvOranBreakdown = kdvDonem.oranKirilimi;
  const kdvTutarsiz = kdvDonem.hesaplanan.bilinmeyen + kdvDonem.indirilecek.bilinmeyen;

  const tabs = [
    { key: 'faturalar', label: ac(currentLanguage).faturalar, icon: FileText },
    { key: 'evrak_tasarimi', label: ac(currentLanguage).evrak_tasarimi, icon: Palette },
    { key: 'banka', label: t.bankAndCash, icon: Building2 },
    { key: 'yevmiye', label: t.journal, icon: BookOpen },
    { key: 'mizan', label: t.trialBalance, icon: ArrowUpDown },
    { key: 'gelir', label: t.incomeExpense, icon: BarChart3 },
    { key: 'kdv', label: t.vat, icon: Calculator },
    { key: 'banka_hareketleri', label: ac(currentLanguage).banka_hareketleri, icon: Landmark },
    { key: 'satislar', label: t.satislar, icon: ShoppingCart },
    { key: 'musteriler', label: t.musteriler, icon: Users },
    { key: 'tedarikciler', label: t.tedarikciler, icon: Truck },
    { key: 'urunler', label: t.urunler, icon: Package },
    { key: 'depo', label: t.depo, icon: Package },
    { key: 'warehouses', label: oc(currentLanguage).depo_tanimlari, icon: Home },
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
    { key: 'kasa', label: ac(currentLanguage).kasa, icon: Wallet },
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
          tryBalance={tryBalance} usdBalance={usdBalance} eurBalance={eurBalance} bakiyeBilinmeyen={bakiyeBilinmeyen} setDrillDown={setDrillDown}
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
          mizanDengeli={mizanDengeli} hasMikroMizan={mikroMizan.satirlar.length > 0}
          mizanNotu={[
            mizanBilinmeyen > 0 ? (currentLanguage === 'tr' ? `${mizanBilinmeyen} yevmiye kaydının tutarı bilinmiyor` : `${mizanBilinmeyen} journal entries have unknown amounts`) : null,
            mizanMikroBilinmeyen > 0 ? (currentLanguage === 'tr' ? `${mizanMikroBilinmeyen} Mikro faturası mizana alınamadı (matrah/KDV bilinmiyor)` : `${mizanMikroBilinmeyen} Mikro invoices not posted (net/VAT unknown)`) : null,
          ].filter(Boolean).join(' · ') || null}
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
          gelirTutarsiz={ggOzeti.gelir.bilinmeyen} giderTutarsiz={ggOzeti.gider.bilinmeyen} tarihsiz={ggOzeti.tarihsiz}
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
          hesaplananKDV={hesaplananKDV} indirilecekKDV={indirilecekKDV} odenecekKDV={odenecekKDV}
          kdvDonem={kdvDonem}
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
          t={t} currentLanguage={currentLanguage} satisKayitlari={satisKayitlari}
          setDrillDown={setDrillDown} formatConv={formatConv} kpiCurrency={kpiCurrency} setKpiCurrency={setKpiCurrency}
          satisKaynak={satisKaynak} setSatisKaynak={setSatisKaynak}
          satisOzet={satisOzet} mikroDahil={mikroDahil} mikroSatisSatirlari={mikroSatisSatirlari}
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
          t={t} currentLanguage={currentLanguage} transferSearch={transferSearch} setTransferSearch={setTransferSearch}
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                      <button onClick={() => setWaybillForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }))} className="absolute top-2 right-2 text-gray-400 hover:text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity">
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
                        <input type="number" value={Number.isFinite(item.quantity) ? item.quantity : ''} onChange={e => {
                          const newItems = [...waybillForm.items];
                          newItems[idx].quantity = formSayisi(e.target.value) ?? NaN; // boş = bilinmiyor (Number('') === 0 tuzağı)
                          setWaybillForm(prev => ({ ...prev, items: newItems }));
                        }} placeholder="Miktar" className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-brand" />
                        <input type="number" value={Number.isFinite(item.unitPrice) ? item.unitPrice : ''} onChange={e => {
                          const newItems = [...waybillForm.items];
                          newItems[idx].unitPrice = formSayisi(e.target.value) ?? NaN; // boş = bilinmiyor (Number('') === 0 tuzağı)
                          setWaybillForm(prev => ({ ...prev, items: newItems }));
                        }} placeholder="B.Fiyat" className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-brand" />
                        <input type="number" value={Number.isFinite(item.taxRate) ? item.taxRate : ''} onChange={e => {
                          const newItems = [...waybillForm.items];
                          newItems[idx].taxRate = formSayisi(e.target.value) ?? NaN; // boş = bilinmiyor (Number('') === 0 tuzağı)
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
                    <input type="number" value={irsaliyeToplami(waybillForm.items) ?? ''} placeholder="—" readOnly className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" />
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
              <div className="flex-1 bg-gray-100 p-4 overflow-auto flex flex-col items-center">
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
                        <div>CETPA A.Ş.</div>
                        <div>ANTALYA, TÜRKİYE</div>
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
              <div className="max-h-[60vh] overflow-auto">
                {drillDown.rows.length === 0 ? (
                  <div className="py-12 text-center text-gray-400 text-sm">{oc(currentLanguage).kayit_bulunamadi}</div>
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
          <SabitKiymetModule currentLanguage={currentLanguage} isAuthenticated={isAuthenticated} exchangeRates={exchangeRates} />
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
