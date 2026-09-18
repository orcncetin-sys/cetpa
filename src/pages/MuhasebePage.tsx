import React, { useState, useEffect, useMemo } from 'react';
import { mutabakatSatirlari, mutabakatDurumu, mutabakatOzeti, masrafOzeti } from '../utils/muhasebe/mutabakatMasraf';
import { finansalOranlar, cariBakiyeToplamlari } from '../utils/muhasebe/finansalOranlar';
import { arYaslandirma, toplamAlacak, kovaTutari, gecikmisSiparisler, KOVA_ADLARI, type KovaAdi } from '../utils/muhasebe/arYaslandirma';
import { faturaYaslandirma, satisTahmini, karMerkezleri, karMerkeziToplami, tahminTutari } from '../utils/muhasebe/faturaTakipTahmin';
import { bankaMutabakati, bankaBakiyesiOku, odemeEslestir, odenmemisFaturalar, eslestirmeOzeti, tutariBilinmeyenFaturaSayisi } from '../utils/muhasebe/bankaMutabakat';
import { kdvKaydiMi, kdvAylikOzet, tahsilatHatirlatma, yaslandirmaSeviyesi } from '../utils/muhasebe/kdvAylik';
import { motion } from 'motion/react';
import BankStatementImportModal from '../components/BankStatementImportModal';
import BankBalanceReport from '../components/BankBalanceReport';
import {
  Calculator, Building2, BarChart3, CreditCard, Users, Activity, TrendingUp, Wallet, FileText, Receipt,
  CheckCircle2, RefreshCw, Plus, AlertCircle, AlertTriangle,
  TrendingDown, X, Edit2, Trash2, Upload, Calendar, Scale, Globe, Tag,
} from 'lucide-react';
import { db } from '../firebase';
import { doc, setDoc, addDoc, collection, updateDoc, deleteDoc, serverTimestamp, onSnapshot } from '../lib/dbClient';
import { confirmDelete } from '../lib/confirm';
import AccountingModule from '../components/AccountingModule';
import { useMikroFaturalar, useCariAdMap } from '../hooks/useMikroFaturalar';
import { maliyetDurumu } from '../utils/cost';
import { bilinenSayi, satirTutari, ekranTutari } from '../utils/para';
import { nakitAkisi, dovizTopla, ticariAlacak, stokDegeri, duranVarlik, ticariBorc, kdvBorcu, bilanco } from '../utils/muhasebe/nakitBilanco';
import { paraYaz, tlYaz, kisaTutar, kurFarki } from '../utils/currency';
import { babsFormu, ciroTemeli, senaryoProjeksiyonu, kdvAnalizi, type BabsFormu } from '../utils/muhasebe/babsKdvAnaliz';
import { sonAylarKarZarar, karZararOzeti, cubukYuzdeleri, basabas, kurEtiketi } from '../utils/muhasebe/karZarar';
import { MUHASEBE_MENU } from '../lib/muhasebeMenu';
import TahsilatModule from '../components/TahsilatModule';
import UnauthorizedView from '../components/UnauthorizedView';
import ReadOnlyBanner from '../components/ReadOnlyBanner';
import ModuleHeader from '../components/ModuleHeader';
import type { Order, Employee, Warehouse, Supplier, InventoryItem, Lead } from '../types';
import { faturaTipiEtiketi } from '../utils/durumEtiketi';
import { zamanDate, zamanMs, gunAnahtari, gunBasi, bugunAnahtari, tarihYaz } from '../utils/zaman';
import { cariHareketleri, cariOzet, krediLimiti, krediKullanimi, onayBekleyenler } from '../utils/muhasebe/cariEkstreOnay';
import { butceGercekOzeti } from '../utils/muhasebe/butceGercek';
import { butceGercekYili, kdvMutabakat, gelirButceYili, varyansAnalizi, type VaryansKalemi } from '../utils/muhasebe/butceVaryans';
import { oc } from '../i18n/ortak';
import { mc } from '../i18n/muhasebe';

const SabitKiymetModule    = React.lazy(() => import('../components/SabitKiymetModule'));
const MaliyetMerkeziModule = React.lazy(() => import('../components/MaliyetMerkeziModule'));
const KasaModule           = React.lazy(() => import('../components/KasaModule'));
const CariEkstrePanel      = React.lazy(() => import('../components/CariEkstrePanel'));

// Lazy alt-modüller (kasa/sabit-kıymet/maliyet/cari) YEREL Suspense ile sarılır.
// Aksi halde bu sekmeye geçince chunk inene kadar App seviyesindeki Suspense
// devreye girip TÜM Muhasebe sayfası boşalıyor ("yüklemede kalıyor" — özellikle
// yavaş bağlantıda). Yerel fallback yalnız o paneli spinner gösterir, başlık+bar durur.
const LAZY_FALLBACK = (
  <div className="apple-card p-10 flex items-center justify-center">
    <div className="animate-spin w-6 h-6 border-4 border-brand border-t-transparent rounded-full" />
  </div>
);

// Boş/bozuk giriş 0 DEĞİL bilinmiyor (NaN → kur farkı '—'); eskiden `Number(x) || 0` silinen bakiyeyi ₺0 pozisyon sayıyordu.
const FxInput = ({ value, onChange, w = 'w-28' }: { value: number; onChange: (v: number) => void; w?: string }) => (
  <input type="number" step="0.01" value={Number.isFinite(value) ? value : ''} onChange={e => onChange(bankaBakiyesiOku(e.target.value))}
    placeholder="—" className={`${w} px-2 py-1 text-xs text-right bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-brand tabular-nums`} />
);

type BudgetEntry = { dept: string; budgetTRY: number };

type MuhasebeTab = 'genel'|'sabit-kiymet'|'maliyet'|'tahsilat'|'ap'|'butce'|'nakit-akis'|'banka'|'ar-aging'|'finansal-oranlar'|'pnl'|'kasa'|'bilanco'|'mutabakat'|'masraf'|'babs'|'kdv'|'cari'|'fatura-takip'|'fiyat-kural'|'butce-gercek'|'oto-fatura'|'gelir-tanima'|'kdv-mutabakat'|'gelir-gider-butce'|'varyans-analiz'|'kur-degerleme'|'tekrar-fatura'|'sirket-arasi';

interface Props {
  currentLanguage: 'tr' | 'en';
  currentT: Record<string, string>;
  canAccess: (tab: string) => boolean;
  hasFullAccess: (tab: string) => boolean;
  user: { email?: string | null; uid?: string; displayName?: string | null } | null;
  userRole: string | null;
  orders: Order[];
  employees: Employee[];
  warehouses: Warehouse[];
  suppliers: Supplier[];
  inventory: InventoryItem[];
  leads: Lead[];
  exchangeRates: Record<string, number> | null;
  fmtKpi: (value: number, format?: 'full' | 'K', decimals?: number) => string;
  // Tip App.tsx:1301'deki GERCEK imzayla ayni — `type?: string` demek,
  // gerceklestirimden GENIS bir sozlesme ilan etmekti ve strictFunctionTypes
  // bunu reddediyor (haklı olarak: 'foo' gecirilse calisma aninda dusuyordu).
  createNotification: (title: string, message: string, type?: 'info' | 'warning' | 'success') => Promise<void>;
  toast: (msg: string, type?: string) => void;
  setActiveTab: (tab: string) => void;
  kpiCurrency: 'TRY' | 'USD' | 'EUR';
  setKpiCurrency: React.Dispatch<React.SetStateAction<'TRY' | 'USD' | 'EUR'>>;
  fxPos: { usdBalance: number; usdBookRate: number; eurBalance: number; eurBookRate: number };
  updateFx: (field: 'usdBalance' | 'usdBookRate' | 'eurBalance' | 'eurBookRate', value: number) => void;
  refreshFxRates: () => Promise<void>;
  fxRefreshing: boolean;

  muhasebeTab: MuhasebeTab;
  setMuhasebeTab: React.Dispatch<React.SetStateAction<MuhasebeTab>>;
  // Birleşik menü (2026-07-21): AccountingModule iç sekmesini App seviyesinde
  // kontrol et — sidebar'dan doğrudan bir ERP sekmesi açılabilsin diye.
  muhasebeAccountingTab: string;
  setMuhasebeAccountingTab: (tab: string) => void;

  budgets: BudgetEntry[];
  setBudgets: React.Dispatch<React.SetStateAction<BudgetEntry[]>>;
  allBudgetsFirestore: Record<string, BudgetEntry[]>;
  setAllBudgetsFirestore: React.Dispatch<React.SetStateAction<Record<string, BudgetEntry[]>>>;
  budgetDraft: Record<string, string>;
  setBudgetDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  budgetMonth: string;
  setBudgetMonth: React.Dispatch<React.SetStateAction<string>>;
  butceCurrency: 'TRY' | 'USD' | 'EUR';
  setButceCurrency: React.Dispatch<React.SetStateAction<'TRY' | 'USD' | 'EUR'>>;

  apPurchaseOrders: Array<{ id: string; orderNumber: string; supplier: string; totalAmount: number; status: string; expectedDate?: unknown; createdAt?: unknown }>;
  setApPurchaseOrders: React.Dispatch<React.SetStateAction<Array<{ id: string; orderNumber: string; supplier: string; totalAmount: number; status: string; expectedDate?: unknown; createdAt?: unknown }>>>;
  apCurrency: 'TRY' | 'USD' | 'EUR';
  setApCurrency: React.Dispatch<React.SetStateAction<'TRY' | 'USD' | 'EUR'>>;

  p607ReminderDays: number[];
  setP607ReminderDays: React.Dispatch<React.SetStateAction<number[]>>;

  bankBalance: number;
  setBankBalance: React.Dispatch<React.SetStateAction<number>>;
  bankBalanceDraft: string;
  setBankBalanceDraft: React.Dispatch<React.SetStateAction<string>>;
  bankBalanceEditing: boolean;
  setBankBalanceEditing: React.Dispatch<React.SetStateAction<boolean>>;
  reconMonth: string;
  setReconMonth: React.Dispatch<React.SetStateAction<string>>;

  p547BankAccounts: Array<{ id: string; bankName: string; accountType: string; balance: number; currency: string }>;
  setP547BankAccounts: React.Dispatch<React.SetStateAction<Array<{ id: string; bankName: string; accountType: string; balance: number; currency: string }>>>;
  p547FixedAssets: Array<{ id: string; name: string; cost: number; depreciation: number }>;
  setP547FixedAssets: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; cost: number; depreciation: number }>>>;

  p548Masraflar: Array<{ id: string; employeeName: string; category: string; amount: number; currency: string; date: string; description: string; receiptUrl?: string; status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi'; createdAt?: unknown; rejectionNote?: string }>;
  setP548Masraflar: React.Dispatch<React.SetStateAction<Array<{ id: string; employeeName: string; category: string; amount: number; currency: string; date: string; description: string; receiptUrl?: string; status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi'; createdAt?: unknown; rejectionNote?: string }>>>;
  p548Form: boolean;
  setP548Form: React.Dispatch<React.SetStateAction<boolean>>;
  p548Draft: { employeeName: string; category: string; amount: string; currency: string; date: string; description: string };
  setP548Draft: React.Dispatch<React.SetStateAction<{ employeeName: string; category: string; amount: string; currency: string; date: string; description: string }>>;

  p555Period: string;
  setP555Period: React.Dispatch<React.SetStateAction<string>>;
  p559Customer: string;
  setP559Customer: React.Dispatch<React.SetStateAction<string>>;
  p560ApprovalThreshold: number;
  setP560ApprovalThreshold: React.Dispatch<React.SetStateAction<number>>;

  p563PnlCurrency: 'TRY' | 'USD' | 'EUR';
  setP563PnlCurrency: React.Dispatch<React.SetStateAction<'TRY' | 'USD' | 'EUR'>>;
  p564FaturaFilter: 'all' | 'missing' | 'synced' | 'pending';
  setP564FaturaFilter: React.Dispatch<React.SetStateAction<'all' | 'missing' | 'synced' | 'pending'>>;

  p573Rules: Array<{ id: string; name: string; type: 'bulk' | 'customer-tier' | 'promo'; minQty?: number; tierName?: string; discountPct: number; active: boolean }>;
  setP573Rules: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; type: 'bulk' | 'customer-tier' | 'promo'; minQty?: number; tierName?: string; discountPct: number; active: boolean }>>>;
  p573Draft: { name: string; type: 'bulk' | 'customer-tier' | 'promo'; minQty: string; tierName: string; discountPct: string; active: boolean };
  setP573Draft: React.Dispatch<React.SetStateAction<{ name: string; type: 'bulk' | 'customer-tier' | 'promo'; minQty: string; tierName: string; discountPct: string; active: boolean }>>;
  p573ShowForm: boolean;
  setP573ShowForm: React.Dispatch<React.SetStateAction<boolean>>;

  p557Scenario: 'base' | 'best' | 'worst';
  setP557Scenario: React.Dispatch<React.SetStateAction<'base' | 'best' | 'worst'>>;
  p558Year: string;
  setP558Year: React.Dispatch<React.SetStateAction<string>>;
  p580Year: string;
  setP580Year: React.Dispatch<React.SetStateAction<string>>;

  p591Schedules: Array<{ id: string; customerName: string; amount: number; frequency: 'monthly' | 'quarterly' | 'yearly'; nextDate: string; description: string; active: boolean }>;
  setP591Schedules: React.Dispatch<React.SetStateAction<Array<{ id: string; customerName: string; amount: number; frequency: 'monthly' | 'quarterly' | 'yearly'; nextDate: string; description: string; active: boolean }>>>;
  p591ShowForm: boolean;
  setP591ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p591Draft: { customerName: string; amount: string; frequency: 'monthly' | 'quarterly' | 'yearly'; nextDate: string; description: string };
  setP591Draft: React.Dispatch<React.SetStateAction<{ customerName: string; amount: string; frequency: 'monthly' | 'quarterly' | 'yearly'; nextDate: string; description: string }>>;

  p597Contracts: Array<{ id: string; customerName: string; totalValue: number; startDate: string; endDate: string; recognized: number }>;
  setP597Contracts: React.Dispatch<React.SetStateAction<Array<{ id: string; customerName: string; totalValue: number; startDate: string; endDate: string; recognized: number }>>>;
  p597ShowForm: boolean;
  setP597ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p597Draft: { customerName: string; totalValue: string; startDate: string; endDate: string; recognized: string };
  setP597Draft: React.Dispatch<React.SetStateAction<{ customerName: string; totalValue: string; startDate: string; endDate: string; recognized: string }>>;

  p610Period: 'this_month' | 'last_month' | 'ytd';
  setP610Period: React.Dispatch<React.SetStateAction<'this_month' | 'last_month' | 'ytd'>>;

  p617Month: string;
  setP617Month: React.Dispatch<React.SetStateAction<string>>;

  p623LCs: Array<{ id: string; bank: string; beneficiary: string; amount: number; currency: 'USD' | 'EUR'; expiryDate: string; status: 'Açık' | 'Kullanıldı' | 'Sona Erdi' | 'İptal'; ref: string }>;
  setP623LCs: React.Dispatch<React.SetStateAction<Array<{ id: string; bank: string; beneficiary: string; amount: number; currency: 'USD' | 'EUR'; expiryDate: string; status: 'Açık' | 'Kullanıldı' | 'Sona Erdi' | 'İptal'; ref: string }>>>;
  p623ShowForm: boolean;
  setP623ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p623Draft: { bank: string; beneficiary: string; amount: string; currency: 'USD' | 'EUR'; expiryDate: string; ref: string };
  setP623Draft: React.Dispatch<React.SetStateAction<{ bank: string; beneficiary: string; amount: string; currency: 'USD' | 'EUR'; expiryDate: string; ref: string }>>;

  p625BudgetYear: number;
  setP625BudgetYear: React.Dispatch<React.SetStateAction<number>>;
  p625BudgetData: Array<{ id?: string; month: number; budgetRevenue: number; budgetExpense: number }>;
  setP625BudgetData: React.Dispatch<React.SetStateAction<Array<{ month: number; budgetRevenue: number; budgetExpense: number }>>>;
  p625EditMonth: number | null;
  setP625EditMonth: React.Dispatch<React.SetStateAction<number | null>>;

  p630InvoicePeriod: '7d' | '30d' | '60d' | '90d';
  setP630InvoicePeriod: React.Dispatch<React.SetStateAction<'7d' | '30d' | '60d' | '90d'>>;

  p634Period: 'this_month' | 'last_month' | 'ytd';
  setP634Period: React.Dispatch<React.SetStateAction<'this_month' | 'last_month' | 'ytd'>>;

  p638MatchResults: Array<{ invoiceId: string; invoiceNo: string; customer: string; invoiceAmount: number; matchedAmount: number; confidence: number; status: 'Tam' | 'Kısmi' | 'Eşleşmedi' }>;
  setP638MatchResults: React.Dispatch<React.SetStateAction<Array<{ invoiceId: string; invoiceNo: string; customer: string; invoiceAmount: number; matchedAmount: number; confidence: number; status: 'Tam' | 'Kısmi' | 'Eşleşmedi' }>>>;
  p638Running: boolean;
  setP638Running: React.Dispatch<React.SetStateAction<boolean>>;

  p640Subs: Array<{ id: string; customerName: string; amount: number; frequency: 'Aylık' | '3 Aylık' | 'Yıllık'; nextDate: string; status: 'Aktif' | 'Pasif' | 'İptal' }>;
  setP640Subs: React.Dispatch<React.SetStateAction<Array<{ id: string; customerName: string; amount: number; frequency: 'Aylık' | '3 Aylık' | 'Yıllık'; nextDate: string; status: 'Aktif' | 'Pasif' | 'İptal' }>>>;
  p640ShowForm: boolean;
  setP640ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p640Draft: { customerName: string; amount: string; frequency: 'Aylık' | '3 Aylık' | 'Yıllık'; nextDate: string };
  setP640Draft: React.Dispatch<React.SetStateAction<{ customerName: string; amount: string; frequency: 'Aylık' | '3 Aylık' | 'Yıllık'; nextDate: string }>>;

  p643Txns: Array<{ id: string; from: string; to: string; amount: number; currency: 'TRY' | 'USD' | 'EUR'; desc: string; date: string; status: 'Bekliyor' | 'Netleştirildi' }>;
  setP643Txns: React.Dispatch<React.SetStateAction<Array<{ id: string; from: string; to: string; amount: number; currency: 'TRY' | 'USD' | 'EUR'; desc: string; date: string; status: 'Bekliyor' | 'Netleştirildi' }>>>;
  p643ShowForm: boolean;
  setP643ShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  p643Draft: { from: string; to: string; amount: string; currency: 'TRY' | 'USD' | 'EUR'; desc: string; date: string };
  setP643Draft: React.Dispatch<React.SetStateAction<{ from: string; to: string; amount: string; currency: 'TRY' | 'USD' | 'EUR'; desc: string; date: string }>>;
}

// Uydurma kur YOK (2026-08-26 kullanıcı kararı; eski FX_FALLBACK USD 38 / EUR 41 sabitleri kaldırıldı):
// döviz→TL çevirimi currency.ts `tlyeCevir` (kurCevir'in tersi), toplama nakitBilanco `dovizTopla` /
// mutabakatMasraf `masrafToplami`. Buradaki yerel `tlYap`/`tlTopla` kopyası hakem turunda (2026-09-13)
// ölü bulunup silindi — çevrilemeyen kalem toplama KATILMAZ, kaç kalem dışarıda kaldığı ekrana YAZILIR.

export default function MuhasebePage(props: Props) {
  const {
    currentLanguage, currentT, canAccess, hasFullAccess, user, userRole,
    orders, employees, warehouses, suppliers, inventory, leads, exchangeRates, fmtKpi, createNotification, toast,
    setActiveTab, kpiCurrency, setKpiCurrency,
    fxPos, updateFx, refreshFxRates, fxRefreshing,
    muhasebeTab, setMuhasebeTab, muhasebeAccountingTab, setMuhasebeAccountingTab,
    budgets, setBudgets, allBudgetsFirestore, setAllBudgetsFirestore, budgetDraft, setBudgetDraft, budgetMonth, setBudgetMonth, butceCurrency, setButceCurrency,
    apPurchaseOrders, setApPurchaseOrders, apCurrency, setApCurrency,
    p607ReminderDays, setP607ReminderDays,
    bankBalance, setBankBalance, bankBalanceDraft, setBankBalanceDraft, bankBalanceEditing, setBankBalanceEditing, reconMonth, setReconMonth,
    p547BankAccounts, setP547BankAccounts, p547FixedAssets, setP547FixedAssets,
    p548Masraflar, setP548Masraflar, p548Form, setP548Form, p548Draft, setP548Draft,
    p555Period, setP555Period, p559Customer, setP559Customer, p560ApprovalThreshold, setP560ApprovalThreshold,
    p563PnlCurrency, setP563PnlCurrency, p564FaturaFilter, setP564FaturaFilter,
    p573Rules, setP573Rules, p573Draft, setP573Draft, p573ShowForm, setP573ShowForm,
    p557Scenario, setP557Scenario, p558Year, setP558Year, p580Year, setP580Year,
    p591Schedules, setP591Schedules, p591ShowForm, setP591ShowForm, p591Draft, setP591Draft,
    p597Contracts, setP597Contracts, p597ShowForm, setP597ShowForm, p597Draft, setP597Draft,
    p610Period, setP610Period,
    p617Month, setP617Month,
    p623LCs, setP623LCs, p623ShowForm, setP623ShowForm, p623Draft, setP623Draft,
    p625BudgetYear, setP625BudgetYear, p625BudgetData, setP625BudgetData, p625EditMonth, setP625EditMonth,
    p630InvoicePeriod, setP630InvoicePeriod,
    p634Period, setP634Period,
    p638MatchResults, setP638MatchResults, p638Running, setP638Running,
    p640Subs, setP640Subs, p640ShowForm, setP640ShowForm, p640Draft, setP640Draft,
    p643Txns, setP643Txns, p643ShowForm, setP643ShowForm, p643Draft, setP643Draft,
  } = props;
  // Kalıcılaştırma (2026-07-21): düzenleme modu kimlikleri — hangi kayıt formda
  const [p591EditId, setP591EditId] = useState<string | null>(null);
  const [p573EditId, setP573EditId] = useState<string | null>(null);
  // e-Fatura Takip Paneli: satıra tıklayınca detay açılmıyordu (kullanıcı
  // bildirimi) — satırlar zaten hesaplanmış tüm alanları taşıyordu, yalnız
  // tıklama/modal eksikti. Id tutulur (obje değil) — orders canlı senkron
  // prop'u, modal açıkken güncellenirse (ör. başka sekmeden faturalandı)
  // gösterim otomatik tazelensin, tıklama anındaki donuk kopya kalmasın.
  const [p564DetayId, setP564DetayId] = useState<string | null>(null);

  // Banka ekstresi CSV içe aktarma modalı
  const [showBankImport, setShowBankImport] = useState(false);

  // ── Mikro faturaları (KDV Mutabakat / e-Fatura Takip / Ba-Bs / Finansal Oranlar) ─
  // Bu paneller `orders` (Cetpa) okuyordu; Cetpa siparişi boş → hepsi ₺0/boş.
  // mikroFaturalar hem GİDEN (satış) hem GELEN (alış) faturaları tutar; her panel
  // uygun yönü kullanır. Eşleme ortak hook'ta (useMikroFaturalar) — tek kaynak.
  const mikroFaturalar = useMikroFaturalar(!!userRole);
  const cariAdMap = useCariAdMap(leads as unknown as Array<Record<string, unknown>>);

  // Cari yıl faturaları — panellerin ortak zaman kapsamı (all-time ciro balonu YOK).
  const mikroFaturalarBuYil = useMemo(() => {
    const yil = String(new Date().getFullYear());
    return mikroFaturalar.filter(f => f.tarih.startsWith(yil));
  }, [mikroFaturalar]);

  // Cari bakiyeleri (Finansal Oranlar AR/AP). cariBalances /api/mikro/pull/bakiye
  // doldurur (doc id=cariKod, {bakiye}). Pozitif = müşteri borçlu (AR), eksi =
  // Cetpa borçlu (AP). Net bakiye havuzu — müşteri/tedarikçi ayrımı işaretle.
  // bilinen/bilinmeyen: tutarsız (sayı olmayan) bakiye kaydı ADEDİ — toplama girmez, sayılır
  // (finansalOranlar.cariBakiyeToplamlari; eskiden `bakiye ?? 0` ile 0 sayılıyordu). Bilanço (547)
  // `bilinmeyen`i tablo sayacına geçirir. BİLİNEN SINIR (hakem turu 2026-09-13, Açık İşler): snapshot
  // gelmeden ve hata dalında ar/ap 0 — yani "yüklenmedi" ile "gerçekten 0" ayırt edilmiyor; null
  // başlatmak 6 başka paneli de değiştirdiğinden ayrı tura bırakıldı.
  const [cariBalanceToplam, setCariBalanceToplam] = useState<ReturnType<typeof cariBakiyeToplamlari>>({ ar: 0, ap: 0, bilinen: 0, bilinmeyen: 0 });
  useEffect(() => {
    if (!userRole) return;
    const unsub = onSnapshot(collection(db, 'cariBalances'), (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => {
      setCariBalanceToplam(cariBakiyeToplamlari(snap.docs.map(d => d.data().bakiye)));
    }, () => setCariBalanceToplam({ ar: 0, ap: 0, bilinen: 0, bilinmeyen: 0 }));
    return () => unsub();
  }, [userRole]);

  // Fiyat Karşılaştırma SATIN ALMA sekmesine taşındı (2026-08-31 kullanıcı
  // isteği) — kod artık src/components/FiyatKarsilastirmaPanel.tsx'te.

  return (
            <motion.div key="muhasebe" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('muhasebe') ? <UnauthorizedView currentLanguage={currentLanguage} tab={oc(currentLanguage).muhasebe_finans} /> : (
                <>
                  {!hasFullAccess('muhasebe') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <ModuleHeader
                    title={oc(currentLanguage).muhasebe_finans}
                    subtitle={mc(currentLanguage).finansal_kayitlari_sabit_kiymetler_maliyet_merke}
                    icon={Calculator}
                  />

                  {/* ── Birleşik yatay menü — HER sekmede sabit kalır (rapora geçince kaybolmaz),
                       sidebar ile birebir aynı liste. AccountingModule kendi barını gizler (hideTabBar). ── */}
                  <div className="overflow-x-auto scrollbar-none -mx-1 px-1">
                    <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
                      {MUHASEBE_MENU.map(m => {
                        const Icon = m.icon;
                        const isActive = m.target.kind === 'accounting'
                          ? (muhasebeTab === 'genel' && muhasebeAccountingTab === m.target.tab)
                          : m.target.kind === 'muhasebe' ? muhasebeTab === m.target.tab : false;
                        return (
                          <button
                            key={m.id}
                            onClick={() => {
                              if (m.target.kind === 'accounting') { setMuhasebeTab('genel'); setMuhasebeAccountingTab(m.target.tab); }
                              else if (m.target.kind === 'muhasebe') setMuhasebeTab(m.target.tab as MuhasebeTab);
                              else setActiveTab(m.target.tab);
                            }}
                            className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${isActive ? 'bg-[#ff4000] text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            {currentLanguage === 'tr' ? m.tr : m.en}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Genel Muhasebe ── */}
                  {muhasebeTab === 'genel' && (
                    <motion.div key="muhasebe-genel" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                      <AccountingModule
                        orders={orders}
                        currentLanguage={currentLanguage}
                        isAuthenticated={!!user && hasFullAccess('muhasebe')}
                        userRole={userRole}
                        exchangeRates={exchangeRates ?? undefined}
                        createNotification={createNotification}
                        warehouses={warehouses}
                        employees={employees}
                        hideTabBar
                        controlledTab={muhasebeAccountingTab}
                        onControlledTabChange={setMuhasebeAccountingTab}
                      />
                    </motion.div>
                  )}

                  {/* ── Phase 146: VAT/KDV Monthly Dashboard ── */}
                  {muhasebeTab === 'genel' && orders.some(kdvKaydiMi) && (() => {
                    const ozet146 = kdvAylikOzet(orders, new Date());
                    const months146 = ozet146.aylar.map(a => ({ ...a, label: tarihYaz(a.tarih, { month: 'short', year: '2-digit' }, currentLanguage === 'tr' ? 'tr' : 'en') }));
                    const maxKDV = Math.max(...months146.map(m => m.kdv.toplam), 1);
                    return (
                      <div className="apple-card p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="font-bold text-gray-800">{mc(currentLanguage).kdv_ozeti_son_6_ay}</h3>
                            <p className="text-xs text-gray-400 mt-0.5">{mc(currentLanguage).tahsil_edilen_kdv_kdv_haric_ciro}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-500">{oc(currentLanguage).toplam_kdv}</p>
                            <p className="text-2xl font-bold text-purple-600">{paraYaz(ekranTutari(ozet146.toplamKdv), { ondalik: 0 })}</p>
                            {ozet146.toplamKdv.bilinmeyen > 0 && <p className="text-[10px] text-amber-600">{ozet146.toplamKdv.bilinmeyen} {mc(currentLanguage).kayit_tutarsiz}</p>}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 mb-5">
                          {[
                            { label: mc(currentLanguage).kdv_haric_ciro, value: paraYaz(ekranTutari(ozet146.toplamNet), { ondalik: 0 }), color: 'text-blue-600', tutarsiz: ozet146.toplamNet.bilinmeyen },
                            { label: mc(currentLanguage).kdv_tutari, value: paraYaz(ekranTutari(ozet146.toplamKdv), { ondalik: 0 }), color: 'text-purple-600', tutarsiz: ozet146.toplamKdv.bilinmeyen },
                            { label: mc(currentLanguage).efektif_kdv_orani, value: ozet146.efektifOran === null ? '—' : `%${ozet146.efektifOran.toFixed(1)}`, color: 'text-gray-700', tutarsiz: 0 },
                          ].map(k => (
                            <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                              <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                              <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                              {k.tutarsiz > 0 && <p className="text-[10px] text-amber-600">{k.tutarsiz} {mc(currentLanguage).kayit_tutarsiz}</p>}
                            </div>
                          ))}
                        </div>
                        <div className="space-y-3">
                          {months146.map(m => {
                            const w = Math.round((m.kdv.toplam / maxKDV) * 100);
                            return (
                              <div key={m.label} className="flex items-center gap-3">
                                <span className="text-xs text-gray-500 w-12 text-right shrink-0">{m.label}</span>
                                <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-purple-400 rounded-full transition-all" style={{ width: `${w}%` }} />
                                </div>
                                <span className="text-xs text-gray-600 tabular-nums shrink-0 w-24 text-right">
                                  {paraYaz(ekranTutari(m.kdv), { ondalik: 0 })}{m.kdv.bilinmeyen > 0 && <span className="text-amber-600" title={`${m.kdv.bilinmeyen} ${mc(currentLanguage).kayit_tutarsiz}`}> *</span>}
                                </span>
                                <span className="text-[10px] text-gray-400 shrink-0">{m.faturali} {mc(currentLanguage).fatura}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Tahsilat Takibi ── */}
                  {muhasebeTab === 'tahsilat' && (
                    <motion.div key="muhasebe-tahsilat" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      <TahsilatModule
                        currentLanguage={currentLanguage as 'tr' | 'en'}
                        isAuthenticated={!!user && hasFullAccess('muhasebe')}
                      />
                      {/* ── Phase 607: Tahsilat Hatırlatma Otomasyonu ───────────────────── */}
                      {(() => {
                        const tr607 = currentLanguage === 'tr';
                        const h607 = tahsilatHatirlatma(orders, p607ReminderDays, new Date());
                        const withDays = h607.satirlar;
                        if (withDays.length === 0) return null;
                        const getBucket = (days: number) => {
                          const s = yaslandirmaSeviyesi(days, p607ReminderDays);
                          if (s === 3) return {label:tr607?`${p607ReminderDays[2]}+ gün`:`${p607ReminderDays[2]}+ days`,color:'text-red-600',bg:'bg-red-50 border-red-200'};
                          if (s === 2) return {label:tr607?`${p607ReminderDays[1]}+ gün`:`${p607ReminderDays[1]}+ days`,color:'text-orange-600',bg:'bg-orange-50 border-orange-200'};
                          if (s === 1) return {label:tr607?`${p607ReminderDays[0]}+ gün`:`${p607ReminderDays[0]}+ days`,color:'text-amber-600',bg:'bg-amber-50 border-amber-200'};
                          return {label:mc(tr607).normal,color:'text-gray-500',bg:'bg-gray-50 border-gray-100'};
                        };
                        const criticalCount = h607.kritik;
                        return (
                          <div className="apple-card p-5 space-y-4">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <h3 className="font-bold text-gray-900 text-sm">🔔 {mc(tr607).tahsilat_hatirlatma_otomasyonu}</h3>
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                {mc(tr607).esikler_gun}
                                {p607ReminderDays.map((d,i)=>(
                                  <input key={i} type="number" value={d} onChange={e=>{
                                    const next=[...p607ReminderDays]; next[i]=Number(e.target.value); setP607ReminderDays(next);
                                  }} className="apple-input px-2 py-0.5 text-xs w-12 text-center"/>
                                ))}
                              </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div className="bg-red-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{oc(tr607).kritik}</p><p className="text-xl font-black text-red-600">{criticalCount}</p></div>
                              <div className="bg-amber-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{mc(tr607).acik_fatura}</p><p className="text-xl font-black text-amber-600">{withDays.length}</p>{h607.tarihsiz > 0 && <p className="text-[10px] text-amber-600">{h607.tarihsiz} {mc(tr607).kaydin_tarihi_yok}</p>}</div>
                              <div className="bg-orange-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{mc(tr607).toplam_bakiye}</p><p className="text-lg font-black text-orange-600">{paraYaz(ekranTutari(h607.bakiye), { ondalik: 0 })}</p>{h607.bakiye.bilinmeyen > 0 && <p className="text-[10px] text-amber-600">{h607.bakiye.bilinmeyen} {mc(tr607).siparisin_tutari_bilinmiyor}</p>}</div>
                            </div>
                            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                              {withDays.slice(0,20).map(o=>{
                                const bucket = getBucket(o.gunGecti);
                                return (
                                  <div key={o.id} className={`flex items-center justify-between border rounded-xl px-4 py-2.5 ${bucket.bg}`}>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-semibold text-gray-800 truncate">{o.customerName}</p>
                                      <p className="text-[10px] text-gray-400">{oc(tr607).siparis_3} #{o.id.slice(-6)} · {o.gunGecti}g</p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                      <span className={`text-xs font-bold ${bucket.color}`}>{bucket.label}</span>
                                      <span className="text-xs font-mono text-gray-700">{paraYaz(o.totalPrice, { ondalik: 0 })}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <p className="text-[10px] text-gray-400">* {mc(tr607).odenmemis_siparisler_gun_sirasina_gore_listeleni}</p>
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}

                  {/* ── Phase 110: Ödenecekler / AP Tracker ── */}
                  {muhasebeTab === 'ap' && (
                    <motion.div key="muhasebe-ap" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      {(() => {
                        const now110 = Date.now();
                        // Only include open/pending POs (not delivered/cancelled)
                        const openPOs = apPurchaseOrders.filter(po => !['Teslim Alındı', 'İptal Edildi'].includes(po.status));
                        // "Toplam Borç" eskiden yalnız native apPurchaseOrders'tı — gerçek iş
                        // hacmi Mikro'dan geçtiğinden hep ₺0'a yakın görünüyordu (2026-08-17
                        // bildirimi). cariBalanceToplam.ap (tüm tedarikçi/cari negatif
                        // bakiyelerin toplamı, /api/mikro/pull/bakiye kaynaklı) additive
                        // eklendi. Vade kovaları (0-30/31-60/60+) Mikro'da vade tarihi
                        // olmadığından yalnız native PO'lardan — sahte kesinlik üretmemek
                        // için o kısım değiştirilmedi.
                        const totalAP = openPOs.reduce((s, po) => s + po.totalAmount, 0) + cariBalanceToplam.ap;

                        type APBucket = { label: string; range: string; orders: typeof openPOs; color: string; bg: string; dot: string };
                        const apBuckets: APBucket[] = [
                          { label: mc(currentLanguage).vadesi_gelmedi_030_gun,  range: '0-30',  orders: [], color: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-400' },
                          { label: mc(currentLanguage).yaklasan_3160_gun, range: '31-60', orders: [], color: 'text-amber-700',   bg: 'bg-amber-50',   dot: 'bg-amber-400'  },
                          { label: mc(currentLanguage).gecikmis_60_gun,   range: '60+',   orders: [], color: 'text-red-700',     bg: 'bg-red-50',     dot: 'bg-red-500'    },
                        ];
                        openPOs.forEach(po => {
                          const created = zamanMs(po.createdAt);
                          const days = created ? Math.floor((now110 - created) / 86400000) : 0;
                          if (days <= 30) apBuckets[0].orders.push(po);
                          else if (days <= 60) apBuckets[1].orders.push(po);
                          else apBuckets[2].orders.push(po);
                        });
                        const maxAmt110 = Math.max(...apBuckets.map(b => b.orders.reduce((s, po) => s + po.totalAmount, 0)), 1);

                        // Kur yoksa FX_FALLBACK (2024'ten kalma sabit 38/41) ile bolunuyordu.
                        // tlYaz kur yoksa '—' doner; null'da sembol bile basmiyoruz ("$—" sacma). TL 0, doviz 2 ondalik.
                        const fmtAP = (n: number) => tlYaz(n, { birim: apCurrency, rates: exchangeRates, ondalik: apCurrency === 'TRY' ? 0 : 2 });
                        return (
                          <>
                            {/* Summary KPIs */}
                            <div className="grid grid-cols-3 gap-4">
                              {[
                                { label: mc(currentLanguage).toplam_borc, value: totalAP, color: 'text-red-600', bg: 'bg-red-50' },
                                { label: mc(currentLanguage).acik_po, value: openPOs.length, color: 'text-amber-600', bg: 'bg-amber-50', isCount: true },
                                { label: oc(currentLanguage).gecikmis_2, value: apBuckets[2].orders.reduce((s, po) => s + po.totalAmount, 0), color: 'text-red-700', bg: 'bg-red-100' },
                              ].map((k, i) => (
                                <div key={i} className={`apple-card p-5 ${k.bg}`}>
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{k.label}</p>
                                    {!((k as { isCount?: boolean }).isCount) && exchangeRates && (
                                      <div className="flex gap-0.5">
                                        {(['TRY','USD','EUR'] as const).map(c => (
                                          <button key={c} onClick={() => setApCurrency(c)}
                                            className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold transition-all ${apCurrency === c ? 'bg-[#ff4000] text-white' : 'text-gray-400 hover:bg-gray-100'}`}>
                                            {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <p className={`text-2xl font-black ${k.color}`}>
                                    {(k as { isCount?: boolean }).isCount ? k.value : fmtAP(k.value as number)}
                                  </p>
                                </div>
                              ))}
                            </div>

                            {/* AP Aging buckets */}
                            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                                <Building2 size={15} className="text-gray-400" />
                                <h3 className="font-bold text-gray-800">{mc(currentLanguage).tedarikci_borc_vade_analizi}</h3>
                              </div>
                              {openPOs.length === 0 ? (
                                <div className="py-12 text-center">
                                  <CheckCircle2 size={36} className="mx-auto mb-3 text-emerald-200" />
                                  <p className="text-sm text-gray-400">{mc(currentLanguage).acik_tedarikci_siparisi_yok}</p>
                                </div>
                              ) : (
                                <div className="divide-y divide-gray-50">
                                  {apBuckets.map((b, bi) => {
                                    if (b.orders.length === 0) return null;
                                    const amt = b.orders.reduce((s, po) => s + po.totalAmount, 0);
                                    const barW = Math.round((amt / maxAmt110) * 100);
                                    return (
                                      <div key={bi} className="px-5 py-3.5 flex items-center gap-4">
                                        <div className="flex items-center gap-2 w-32 sm:w-52 flex-shrink-0">
                                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${b.dot}`} />
                                          <span className="text-xs font-semibold text-gray-700 truncate">{b.label}</span>
                                        </div>
                                        <div className="flex-1 flex items-center gap-3">
                                          <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                                            <div className={`h-2 rounded-full transition-all duration-700 ${b.dot}`} style={{ width: `${barW}%` }} />
                                          </div>
                                          <span className={`text-xs font-bold flex-shrink-0 w-24 text-right ${b.color}`}>
                                            {fmtAP(amt)}
                                          </span>
                                        </div>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${b.bg} ${b.color}`}>
                                          {b.orders.length} {mc(currentLanguage).siparis}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* PO list */}
                            {openPOs.length > 0 && (
                              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                                <div className="px-5 py-4 border-b border-gray-100">
                                  <h3 className="font-bold text-gray-800 text-sm">{mc(currentLanguage).acik_siparisler}</h3>
                                </div>
                                <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                                  {openPOs.map(po => {
                                    const created110 = zamanMs(po.createdAt);
                                    const days110 = created110 ? Math.floor((now110 - created110) / 86400000) : 0;
                                    const late = days110 > 60;
                                    return (
                                      <div key={po.id} className="flex items-center gap-4 px-5 py-3">
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-semibold text-gray-800">#{po.orderNumber} · {po.supplier}</p>
                                          <p className="text-[10px] text-gray-400">{days110} {mc(currentLanguage).gun_once_olusturuldu}</p>
                                        </div>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                          po.status === 'Sipariş Edildi' ? 'bg-blue-50 text-blue-700' :
                                          po.status === 'Beklemede' ? 'bg-amber-50 text-amber-700' :
                                          'bg-gray-100 text-gray-600'
                                        }`}>{po.status}</span>
                                        <span className={`text-sm font-bold flex-shrink-0 ${late ? 'text-red-600' : 'text-gray-700'}`}>
                                          {fmtAP(po.totalAmount)}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </motion.div>
                  )}

                  {/* ── Phase 113: Budget vs Actuals ── */}
                  {muhasebeTab === 'butce' && (
                    <motion.div key="muhasebe-butce" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      {(() => {
                        const DEPTS = [
                          { key: 'satis',    label: oc(currentLanguage).satis },
                          { key: 'pazarlama',label: mc(currentLanguage).pazarlama },
                          { key: 'operasyon',label: mc(currentLanguage).operasyon },
                          { key: 'ik',       label: mc(currentLanguage).insan_kaynaklari },
                          { key: 'it',       label: 'IT' },
                          { key: 'genel',    label: mc(currentLanguage).genel_giderler },
                        ];

                        // Gerçekleşen: ayın siparişleri (createdAt ?? syncedAt) → ciro → GERCEKLESEN_PAYLARI ile bölümlere dağılım.
                        // Bilinmeyen tutar 0 sayılmaz: toplama girmez, sayılır (ozet.ciro.bilinmeyen / ozet.butce.bilinmeyen).
                        const ozet = butceGercekOzeti(orders, budgets, budgetMonth, DEPTS.map(d => d.key));
                        const totalBudget = ozet.butce.toplam;
                        const totalActual = ozet.gerceklesen.toplam;

                        const saveBudgets = (newBudgets: BudgetEntry[]) => {
                          setBudgets(newBudgets);
                          const updated = { ...allBudgetsFirestore, [budgetMonth]: newBudgets };
                          setAllBudgetsFirestore(updated);
                          setDoc(doc(db, 'settings', 'budgets'), { [budgetMonth]: newBudgets }, { merge: true }).catch(() => {});
                        };

                        const fmtButce = (n: number | null) => tlYaz(n, { birim: butceCurrency, rates: exchangeRates, ondalik: 0 });
                        return (
                          <>
                            {/* Month picker + summary */}
                            <div className="flex flex-wrap items-center gap-4">
                              <div className="flex items-center gap-2">
                                <label className="text-xs font-bold text-gray-500">{oc(currentLanguage).donem}:</label>
                                <input
                                  type="month"
                                  value={budgetMonth}
                                  onChange={e => setBudgetMonth(e.target.value)}
                                  className="apple-input text-sm px-3 py-1.5"
                                />
                              </div>
                              {exchangeRates && (
                                <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                                  {(['TRY','USD','EUR'] as const).map(c => (
                                    <button key={c} onClick={() => setButceCurrency(c)}
                                      className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${butceCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="flex items-center gap-6 ml-auto">
                                <div className="text-right">
                                  <p className="text-[10px] text-gray-400">{oc(currentLanguage).toplam_butce}</p>
                                  <p className="text-sm font-black text-gray-800">{fmtButce(totalBudget)}</p>
                                  {ozet.butce.bilinmeyen > 0 && <p className="text-[10px] text-amber-600">{ozet.butce.bilinmeyen} {mc(currentLanguage).butce_kalemi_okunamiyor}</p>}
                                </div>
                                <div className="text-right">
                                  <p className="text-[10px] text-gray-400">{oc(currentLanguage).gerceklesen}</p>
                                  <p className={`text-sm font-black ${totalActual > totalBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                                    {fmtButce(totalActual)}
                                  </p>
                                  {ozet.gerceklesen.bilinmeyen > 0 && <p className="text-[10px] text-amber-600">{ozet.gerceklesen.bilinmeyen} {mc(currentLanguage).siparisin_tutari_bilinmiyor}</p>}
                                </div>
                              </div>
                            </div>

                            {/* Dept rows */}
                            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                              <div className="divide-y divide-gray-50">
                                {DEPTS.map(dept => {
                                  const { butce: budget, gerceklesen: actual, oran: pct, asim: over, asimTutari } = ozet.satirlar[dept.key];
                                  return (
                                    <div key={dept.key} className="px-5 py-4">
                                      <div className="flex items-center gap-3 mb-2">
                                        <span className="text-sm font-bold text-gray-800 flex-1">{dept.label}</span>
                                        <div className="flex items-center gap-2">
                                          <div className="relative flex-shrink-0">
                                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">₺</span>
                                            <input
                                              type="number"
                                              value={budgetDraft[dept.key] ?? (Number.isFinite(budget) ? String(budget) : '')}
                                              onChange={e => setBudgetDraft(prev => ({ ...prev, [dept.key]: e.target.value }))}
                                              onBlur={() => {
                                                const val = Number(budgetDraft[dept.key]);
                                                if (!isNaN(val) && val >= 0) {
                                                  const updated = budgets.filter(b => b.dept !== dept.key);
                                                  if (val > 0) updated.push({ dept: dept.key, budgetTRY: val });
                                                  saveBudgets(updated);
                                                }
                                                setBudgetDraft(prev => { const n = { ...prev }; delete n[dept.key]; return n; });
                                              }}
                                              className="apple-input w-32 pl-6 pr-2 py-1.5 text-right text-sm font-bold"
                                              placeholder="0"
                                            />
                                          </div>
                                          <span className={`text-xs font-bold w-12 text-right ${over ? 'text-red-600' : pct !== null && pct > 80 ? 'text-amber-600' : pct === null ? 'text-gray-400' : 'text-emerald-600'}`}>
                                            {pct === null ? '—' : `${pct}%`}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                        <div
                                          className={`h-2 rounded-full transition-all duration-500 ${over ? 'bg-red-400' : pct !== null && pct > 80 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                                          style={{ width: `${pct === null ? 0 : Math.min(pct, 100)}%` }}
                                        />
                                      </div>
                                      <div className="flex justify-between mt-1">
                                        <span className="text-[10px] text-gray-400">
                                          {oc(currentLanguage).gerceklesen}: {fmtButce(actual)}
                                        </span>
                                        {over && (
                                          <span className="text-[10px] font-bold text-red-600">
                                            +{fmtButce(asimTutari)} {mc(currentLanguage).asim}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
                                {mc(currentLanguage).gerceklesen_degerler_aylik_siparislerden_maliyet}
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </motion.div>
                  )}

                  {/* ── Phase 118: Banka Mutabakatı ── */}
                  {muhasebeTab === 'banka' && (
                    <motion.div key="muhasebe-banka" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      {(() => {
                        // TEK KAYNAK (Faz 3, 2026-09-13): bilinmeyen tutar toplama girmez, sayılır; bakiye girilmemişse NaN.
                        const m118 = bankaMutabakati({ siparisler: orders, alisSiparisleri: apPurchaseOrders, donem: reconMonth, bankaBakiyesi: bankBalance });
                        // Satırlar para.ts ekranTutari (kısmi toplam + not; hiç bilinen yoksa '—'); hesaplanan bakiye modülde tamTutar kapısından (kısmi tahsilattan türetilmez).
                        const bookReceipts = ekranTutari(m118.tahsilat), openAPThisMonth = ekranTutari(m118.acikAlis), estimatedBalance = m118.hesaplananBakiye;
                        const gap = m118.fark, gapAbs = Math.abs(gap);
                        const balanced = m118.mutabik; // boolean | null — null: hüküm verilemez (bakiye girilmemiş; tutarsız ya da tarihsiz kayıt var)

                        return (
                          <>
                            <div className="flex flex-wrap items-center gap-4">
                              <div className="flex items-center gap-2">
                                <label className="text-xs font-bold text-gray-500">{oc(currentLanguage).donem}:</label>
                                <input type="month" value={reconMonth} onChange={e => setReconMonth(e.target.value)} className="apple-input text-sm px-3 py-1.5" />
                              </div>
                              <button onClick={() => setShowBankImport(true)} className="apple-button-secondary text-sm px-4 py-1.5 flex items-center gap-1.5 ml-auto">
                                <Upload className="w-4 h-4" />
                                {mc(currentLanguage).csv_ekstre_yukle}
                              </button>
                            </div>

                            {/* Main reconciliation card */}
                            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                                <CreditCard size={16} className="text-gray-400" />
                                <h3 className="font-bold text-gray-800">{mc(currentLanguage).banka_mutabakat_ozeti}</h3>
                                <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${balanced === null ? 'bg-gray-100 text-gray-500' : balanced ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {balanced === null ? (mc(currentLanguage).hukum_verilemez) : balanced ? (mc(currentLanguage).mutabik) : (mc(currentLanguage).fark_var)}
                                </span>
                              </div>
                              <div className="p-5 space-y-4">
                                {/* Bank balance entry */}
                                <div className="flex items-center justify-between p-4 bg-blue-50 rounded-xl">
                                  <div>
                                    <p className="text-xs font-bold text-blue-700">{mc(currentLanguage).banka_ekstresindeki_bakiye}</p>
                                    <p className="text-[10px] text-blue-500 mt-0.5">{mc(currentLanguage).manuel_olarak_girin}</p>
                                  </div>
                                  {bankBalanceEditing ? (
                                    <div className="flex items-center gap-2">
                                      <div className="relative">
                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-400">₺</span>
                                        <input
                                          autoFocus
                                          type="number"
                                          value={bankBalanceDraft}
                                          onChange={e => setBankBalanceDraft(e.target.value)}
                                          onBlur={() => { setBankBalance(bankaBakiyesiOku(bankBalanceDraft)); setBankBalanceEditing(false); }}
                                          onKeyDown={e => { if (e.key === 'Enter') { setBankBalance(bankaBakiyesiOku(bankBalanceDraft)); setBankBalanceEditing(false); } }}
                                          className="apple-input w-36 pl-6 text-right font-bold"
                                        />
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => { setBankBalanceDraft(Number.isFinite(bankBalance) ? String(bankBalance) : ''); setBankBalanceEditing(true); }}
                                      className="text-xl font-black text-blue-700 hover:text-blue-900 transition-colors"
                                    >
                                      {fmtKpi(bankBalance,'full',0)}
                                      <span className="text-[10px] text-blue-400 ml-1">✎</span>
                                    </button>
                                  )}
                                </div>

                                {/* Rows */}
                                {[
                                  { label: mc(currentLanguage).tahsil_edilen_odendi, value: bookReceipts,     color: 'text-emerald-600', sign: '+' },
                                  { label: mc(currentLanguage).acik_satin_alma_siparisleri,    value: openAPThisMonth, color: 'text-red-500',     sign: '−' },
                                  { label: mc(currentLanguage).hesaplanan_bakiye,      value: estimatedBalance, color: 'text-gray-800',    sign: '=' },
                                ].map((row, i) => (
                                  <div key={i} className={`flex items-center justify-between py-2.5 border-b border-gray-50 ${i === 2 ? 'border-t border-gray-200 pt-3 mt-1' : ''}`}>
                                    <span className="text-sm text-gray-600">{row.label}</span>
                                    <span className={`text-sm font-black ${row.color}`}>
                                      {Number.isFinite(row.value) ? row.sign : ''} {fmtKpi(Math.abs(row.value),'full',0)}
                                    </span>
                                  </div>
                                ))}

                                {(m118.bilinmeyen > 0 || m118.tarihsiz > 0) && (
                                  <p className="text-[10px] text-amber-600 pt-1">{currentLanguage === 'tr' ? `${m118.bilinmeyen} kayıt tutarsız, ${m118.tarihsiz} kayıt tarihsiz — toplama girmedi, mutabakat hükmü verilemedi` : `${m118.bilinmeyen} record(s) without amount, ${m118.tarihsiz} without date — excluded from totals; no reconciliation verdict`}</p>
                                )}
                                {/* Gap */}
                                {balanced === false && (
                                  <div className="flex items-center justify-between p-3 bg-amber-50 rounded-xl mt-2">
                                    <span className="text-sm font-bold text-amber-700">{mc(currentLanguage).aciklanamayan_fark}</span>
                                    <span className="text-sm font-black text-amber-700">
                                      {gap > 0 ? '+' : '−'} {fmtKpi(gapAbs,'full',0)}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
                                {mc(currentLanguage).banka_ekstrenizi_sisteme_girerek_otomatik_karsil}
                              </div>
                            </div>
                          </>
                        );
                      })()}

                      <BankBalanceReport
                        currentLanguage={currentLanguage}
                        exchangeRates={exchangeRates}
                        toast={toast}
                      />

                      <BankStatementImportModal
                        isOpen={showBankImport}
                        onClose={() => setShowBankImport(false)}
                        currentLanguage={currentLanguage}
                        bankAccounts={p547BankAccounts.map(a => ({ id: a.id, bankName: a.bankName, currency: a.currency }))}
                        toast={toast}
                      />

                      {/* ── Phase 623: Akreditif & Ödeme Belgesi ─────────────────── */}
                      {hasFullAccess('muhasebe') && (() => {
                        const tr623 = currentLanguage === 'tr';
                        const openLCs = p623LCs.filter(lc=>lc.status==='Açık');
                        const totalValue623 = openLCs.reduce((s,lc)=>s+lc.amount,0);
                        const sinir623 = Date.now()+30*86400000; // 30 günlük pencere sonu (gerçek şimdi)
                        const expiringSoon = openLCs.filter(lc=>{ const ms = zamanMs(lc.expiryDate); return ms !== null && ms <= sinir623; }).length; // çözülemeyen vade sayılmaz
                        const statCls:{[k:string]:string}={Açık:'bg-emerald-100 text-emerald-700','Kullanıldı':'bg-blue-100 text-blue-700','Sona Erdi':'bg-gray-100 text-gray-500',İptal:'bg-red-100 text-red-700'};
                        return (
                          <div className="apple-card p-5 space-y-4 mt-4">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <h3 className="font-bold text-gray-900 text-sm">📄 {mc(tr623).akreditif_l_c_takibi}</h3>
                              <button onClick={()=>setP623ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{mc(tr623).l_c_ekle}</button>
                            </div>
                            {expiringSoon>0&&<div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs font-bold text-amber-700">⚠️ {expiringSoon} {mc(tr623).l_c_30_gun_icinde_sona_eriyor}</div>}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{mc(tr623).acik_l_c}</p><p className="text-xl font-black text-emerald-600">{openLCs.length}</p></div>
                              <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{oc(tr623).toplam_deger}</p><p className="text-base font-black text-blue-600">{paraYaz(totalValue623, { birim: 'USD' })}</p></div>
                              <div className="bg-amber-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{mc(tr623).sona_yakin}</p><p className="text-xl font-black text-amber-600">{expiringSoon}</p></div>
                            </div>
                            {p623ShowForm && (
                              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                  <input className="apple-input" placeholder={oc(tr623).banka} value={p623Draft.bank} onChange={e=>setP623Draft(d=>({...d,bank:e.target.value}))}/>
                                  <input className="apple-input" placeholder={oc(tr623).lehtar} value={p623Draft.beneficiary} onChange={e=>setP623Draft(d=>({...d,beneficiary:e.target.value}))}/>
                                  <input className="apple-input" placeholder="Ref" value={p623Draft.ref} onChange={e=>setP623Draft(d=>({...d,ref:e.target.value}))}/>
                                  <input type="number" className="apple-input" placeholder={oc(tr623).tutar} value={p623Draft.amount} onChange={e=>setP623Draft(d=>({...d,amount:e.target.value}))}/>
                                  <select value={p623Draft.currency} onChange={e=>setP623Draft(d=>({...d,currency:e.target.value as typeof d.currency}))} className="apple-input">{['USD','EUR'].map(c=><option key={c}>{c}</option>)}</select>
                                  <input type="date" className="apple-input" value={p623Draft.expiryDate} onChange={e=>setP623Draft(d=>({...d,expiryDate:e.target.value}))}/>
                                </div>
                                <button onClick={async ()=>{
                                  if(!p623Draft.bank||!p623Draft.amount) return;
                                  try { await addDoc(collection(db,'letterOfCredit'),{bank:p623Draft.bank,beneficiary:p623Draft.beneficiary,amount:Number(p623Draft.amount),currency:p623Draft.currency,expiryDate:p623Draft.expiryDate,status:'Açık',ref:p623Draft.ref,createdAt:serverTimestamp()}); toast(mc(currentLanguage).akreditif_eklendi, 'success'); } catch(e){console.error("[firestore]", e); toast(mc(currentLanguage).akreditif_eklenemedi, 'error');}
                                  setP623Draft(d=>({...d,bank:'',beneficiary:'',amount:'',ref:'',expiryDate:''}));
                                  setP623ShowForm(false);
                                  toast(mc(tr623).l_c_eklendi,'success');
                                }} className="apple-button-primary text-xs px-6">{oc(tr623).kaydet}</button>
                              </div>
                            )}
                            {p623LCs.length > 0 && (
                              <div className="overflow-x-auto"><table className="w-full text-xs">
                                <thead><tr className="border-b border-gray-100 bg-gray-50">{[oc(tr623).banka,oc(tr623).lehtar,'Ref',oc(tr623).tutar,mc(tr623).vade,oc(tr623).durum].map(h=><th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>)}</tr></thead>
                                <tbody className="divide-y divide-gray-50">
                                  {[...p623LCs].sort((a,b)=>a.expiryDate.localeCompare(b.expiryDate)).map(lc=>(
                                    <tr key={lc.id} className="hover:bg-gray-50/50">
                                      <td className="px-3 py-2.5 font-medium text-gray-800">{lc.bank}</td>
                                      <td className="px-3 py-2.5 text-gray-600">{lc.beneficiary}</td>
                                      <td className="px-3 py-2.5 font-mono text-gray-500">{lc.ref}</td>
                                      <td className="px-3 py-2.5 font-bold">{paraYaz(lc.amount, { birim: lc.currency })}</td>
                                      <td className="px-3 py-2.5 text-gray-500">{tarihYaz(lc.expiryDate)}</td>
                                      <td className="px-3 py-2.5"><select value={lc.status} onChange={async e=>{try{await updateDoc(doc(db,'letterOfCredit',lc.id),{status:e.target.value});}catch(err){console.error(err);}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 ${statCls[lc.status]}`}>{['Açık','Kullanıldı','Sona Erdi','İptal'].map(s=><option key={s}>{s}</option>)}</select></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table></div>
                            )}
                          </div>
                        );
                      })()}

                      {/* ── Phase 638: Otomatik Ödeme Eşleştirme ─────────────────── */}
                      {(() => {
                        const tr638 = currentLanguage === 'tr';
                        const runMatch = () => {
                          // TEK KAYNAK (Faz 3, 2026-09-13): tutarı bilinmeyen fatura eşleştirilmez, sayılır (render notu aşağıda).
                          const { sonuclar: results } = odemeEslestir(orders);
                          setP638MatchResults(results);
                          setP638Running(false);
                          // KALICI (2026-07-21): eşleştirme koşusu tarihli saklanır; son koşu reload'da yüklenir.
                          void addDoc(collection(db,'bankMatchRuns'),{results,ranAt:serverTimestamp()}).catch(()=>{});
                        };
                        const statusCls:{[k:string]:string}={Tam:'bg-emerald-100 text-emerald-700',Kısmi:'bg-amber-100 text-amber-700',Eşleşmedi:'bg-red-100 text-red-700'};
                        const { tam: totalMatched, kismi: totalKismi, eslesmedi: totalUnmatched } = eslestirmeOzeti(p638MatchResults);
                        const odenmemisSayisi = odenmemisFaturalar(orders).length;
                        const tutarsizFatura = tutariBilinmeyenFaturaSayisi(orders);
                        return (
                          <div className="apple-card p-5 space-y-4 mt-4">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div><h3 className="font-bold text-gray-900 text-sm">🤖 {mc(tr638).otomatik_odeme_eslestirme}</h3>
                              <p className="text-xs text-gray-400">{mc(tr638).banka_hareketlerini_faturalara_ai_ile_eslestirir}</p></div>
                              <button onClick={()=>{setP638Running(true);setTimeout(runMatch,900);}} disabled={p638Running} className="apple-button-primary text-xs px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-50">
                                {p638Running?<span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"/>:'🤖'}
                                {mc(tr638).eslestir}</button>
                            </div>
                            {p638MatchResults.length > 0 && (
                              <>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{mc(tr638).tam_eslesme}</p><p className="text-xl font-black text-emerald-600">{totalMatched}</p></div>
                                  <div className="bg-amber-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{oc(tr638).kismi}</p><p className="text-xl font-black text-amber-600">{totalKismi}</p></div>
                                  <div className="bg-red-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{oc(tr638).eslesmedi}</p><p className="text-xl font-black text-red-600">{totalUnmatched}</p></div>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead><tr className="border-b border-gray-100 bg-gray-50">
                                      {[oc(tr638).fatura_no,oc(tr638).musteri,oc(tr638).tutar,oc(tr638).eslesen,mc(tr638).guven,oc(tr638).durum].map(h=>(
                                        <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                      ))}
                                    </tr></thead>
                                    <tbody className="divide-y divide-gray-50">
                                      {p638MatchResults.slice(0,10).map(r=>(
                                        <tr key={r.invoiceId} className="hover:bg-gray-50/50">
                                          <td className="px-3 py-2.5 font-mono text-gray-600">{r.invoiceNo}</td>
                                          <td className="px-3 py-2.5 font-medium text-gray-800">{r.customer}</td>
                                          <td className="px-3 py-2.5 font-mono text-gray-700">{paraYaz(r.invoiceAmount, { ondalik: 0 })}</td>
                                          <td className="px-3 py-2.5 font-mono text-emerald-600">{paraYaz(r.matchedAmount, { ondalik: 0 })}</td>
                                          <td className="px-3 py-2.5"><div className="flex items-center gap-1.5"><div className="w-12 bg-gray-100 rounded-full h-1.5 overflow-hidden"><div className={`h-full rounded-full ${r.confidence>80?'bg-emerald-400':r.confidence>60?'bg-amber-400':'bg-red-400'}`} style={{width:`${r.confidence}%`}}/></div><span className="text-gray-500">%{r.confidence}</span></div></td>
                                          <td className="px-3 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusCls[r.status]}`}>{r.status}</span></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            )}
                            {p638MatchResults.length===0&&!p638Running&&<p className="text-center text-gray-400 text-xs py-4">{tr638?`${odenmemisSayisi} ödenmemiş fatura için "Eşleştir" butonuna tıklayın.`:`Click "Match" to auto-match ${odenmemisSayisi} unpaid invoices.`}</p>}
                            {tutarsizFatura>0&&<p className="text-center text-amber-600 text-[10px]">{tr638?`${tutarsizFatura} faturanın tutarı bilinmiyor — eşleştirilemez, sonuçlara girmez.`:`${tutarsizFatura} invoice(s) have no amount — cannot be matched, excluded from results.`}</p>}
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}

                  {/* ── Sabit Kıymetler ── */}
                  {muhasebeTab === 'sabit-kiymet' && (
                    <motion.div key="muhasebe-sabit" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      <React.Suspense fallback={LAZY_FALLBACK}>
                        <SabitKiymetModule
                          currentLanguage={currentLanguage}
                          isAuthenticated={!!user && hasFullAccess('muhasebe')}
                          exchangeRates={exchangeRates}
                        />
                      </React.Suspense>
                    </motion.div>
                  )}

                  {/* ── Maliyet Merkezleri ── */}
                  {muhasebeTab === 'maliyet' && (
                    <motion.div key="muhasebe-maliyet" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      <React.Suspense fallback={LAZY_FALLBACK}>
                        <MaliyetMerkeziModule
                          currentLanguage={currentLanguage as 'tr' | 'en'}
                          isAuthenticated={!!user && hasFullAccess('muhasebe')}
                        />
                      </React.Suspense>
                    </motion.div>
                  )}

                  {/* ── Phase 131: AR Aging per Customer ── */}
                  {muhasebeTab === 'ar-aging' && (
                    <motion.div key="muhasebe-ar-aging" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      <ModuleHeader
                        title={mc(currentLanguage).musteri_alacak_yaslandirmasi}
                        subtitle={mc(currentLanguage).musteri_bazinda_odenmemis_alacaklarin_vade_anali}
                        icon={Users}
                      />
                      {(() => {
                        // Süzgeç (paid/Cancelled/odemeTakipli/faturali), tarih (createdAt ?? syncedAt;
                        // tarihsiz BUGÜNE düşmez, `tarihsiz` sayılır) ve kova dağıtımı tek kaynakta:
                        // utils/muhasebe/arYaslandirma. Tutarı bilinmeyen sipariş ₺0 değil, SAYILIR.
                        // faturali siparişler Mikro'ya gidip cariBalances'a (aşağıdaki
                        // cariBalanceToplam.ar) yansıdığından burada tekrar sayılmıyor.
                        const ozet131 = arYaslandirma(orders);
                        const custs = ozet131.musteriler;
                        // Yaş kovaları (0-30/31-60/61-90/90+) yalnız native orders'tan —
                        // Mikro faturalarında vade/tahsilat tarihi yok, o yüzden bunları
                        // yaşlandıramıyoruz (sahte kesinlik üretmemek için). Ama "Toplam
                        // Alacak" gerçek cari bakiyeleri (cariBalanceToplam.ar) içermeli,
                        // yoksa gerçek iş hacminin çoğu Mikro'dan geldiğinden hep ₺0'a
                        // yakın görünüyordu (2026-08-17 bildirimi).
                        const alacak131 = toplamAlacak(ozet131, cariBalanceToplam.ar);
                        const bilinmeyen131 = alacak131.bilinmeyen;
                        if (custs.length === 0 && ozet131.tarihsiz === 0 && cariBalanceToplam.ar <= 0) return (
                          <div className="text-center py-16 bg-white border border-gray-100 rounded-2xl">
                            <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-200" />
                            <p className="text-sm text-gray-400">{mc(currentLanguage).tum_siparisler_tahsil_edildi}</p>
                          </div>
                        );
                        // Sembol eskiden cagri yerinde ({s131}{f131(v)}) ekleniyordu; kur yokken
                        // "$—" cikmasin diye artik formatleyicinin ICINDE (tlYaz).
                        const f131 = (v: number) => tlYaz(v, { birim: kpiCurrency, rates: exchangeRates, ondalik: 0 });
                        return (
                          <div className="space-y-3">
                            {/* Summary cards */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              {[
                                { label: '0–30 gün', kova: 'b0_30' as const, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                                { label: '31–60 gün', kova: 'b31_60' as const, color: 'text-amber-600', bg: 'bg-amber-50' },
                                { label: '61–90 gün', kova: 'b61_90' as const, color: 'text-orange-600', bg: 'bg-orange-50' },
                                { label: '90+ gün', kova: 'b90p' as const, color: 'text-red-600', bg: 'bg-red-50' },
                              ].map(k => (
                                <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">{k.label}</p>
                                  <p className={`text-xl font-bold ${k.color}`}>{f131(kovaTutari(ozet131, k.kova))}</p>
                                  {ozet131.kovaBilinmeyen[k.kova] > 0 && <p className="text-[10px] text-amber-600">{ozet131.kovaBilinmeyen[k.kova]} {mc(currentLanguage).kayit_tutarsiz}</p>}
                                </div>
                              ))}
                            </div>
                            {/* Per-customer table */}
                            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 grid grid-cols-6 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                <span className="col-span-2">{oc(currentLanguage).musteri}</span>
                                <span className="text-right">0–30</span>
                                <span className="text-right">31–60</span>
                                <span className="text-right">61–90</span>
                                <span className="text-right">90+</span>
                              </div>
                              <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                                {custs.map(c => (
                                  <div key={c.ad} className="px-5 py-3 grid grid-cols-6 items-center hover:bg-gray-50/50 transition-all">
                                    <div className="col-span-2 min-w-0">
                                      <p className="text-xs font-bold text-gray-800 truncate">{c.ad}</p>
                                      <p className="text-[10px] text-gray-400">{oc(currentLanguage).toplam}: {f131(ekranTutari(c))} · {c.enEski}g{c.bilinmeyen > 0 ? ` · ${c.bilinmeyen} ${mc(currentLanguage).tutarsiz}` : ''}</p>
                                    </div>
                                    {KOVA_ADLARI.map(k => kovaTutari(c, k)).map((v, i) => (
                                      <span key={i} className={`text-xs font-bold text-right ${v > 0 ? i === 0 ? 'text-emerald-600' : i === 1 ? 'text-amber-600' : i === 2 ? 'text-orange-600' : 'text-red-600' : 'text-gray-200'}`}>
                                        {v > 0 ? f131(v) : '—'}
                                      </span>
                                    ))}
                                  </div>
                                ))}
                              </div>
                              <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex justify-between text-xs font-bold">
                                <span className="text-gray-500">{custs.length} {oc(currentLanguage).musteri_2}</span>
                                <span className="text-gray-800">{mc(currentLanguage).toplam_alacak}: {f131(ekranTutari(alacak131))}{bilinmeyen131 > 0 && <span className="ml-2 text-amber-600 font-normal">{bilinmeyen131} {mc(currentLanguage).kayit_tutarsiz}</span>}{ozet131.tarihsiz > 0 && <span className="ml-2 text-gray-400 font-normal">{ozet131.tarihsiz} {mc(currentLanguage).tarihsiz_kayit_yaslandirmaya_girmedi}</span>}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}

                  {/* ── Phase 178: Overdue Invoice Escalation ── */}
                  {muhasebeTab === 'ar-aging' && (() => {
                    // Eşik 30 (31+), en eski önce, en fazla 8 — tek kaynak utils/muhasebe/arYaslandirma.
                    // Tarih createdAt ?? syncedAt (Phase 131 ile aynı); çözülemeyen tarih 0 gün olup sessizce
                    // düşmez, `tarihsiz178` sayılır. Tutarı bilinmeyen gecikmiş kayıt LİSTEDE kalır ('—').
                    // BİLİNÇLİ FARK (2026-09-13 hakem): eski kod yalnız createdAt'lı siparişleri alıp Math.floor(ms/86400000)
                    // sayıyordu; Phase 131 (aynı sekme) zaten createdAt ?? syncedAt kullanıyordu — 45 gün ödenmemiş Shopify
                    // aynası yaşlandırma tablosundayken eskalasyon listesinde YOKTU. İki panel aynı tarih kuralına çekildi,
                    // gün sayımı zaman.ts gunFarki (Faz 2 tek kaynak). createdAt-only seçeneği bilerek eklenmedi.
                    const { liste: overdueOrders, tutarBilinmeyen: tutarsiz178, tarihsiz: tarihsiz178 } = gecikmisSiparisler(orders);
                    if (overdueOrders.length === 0) return null;
                    return (
                      <div className="apple-card p-5 border border-red-100 mt-4">
                        <div className="flex items-center gap-2 mb-3">
                          <AlertCircle className="w-4 h-4 text-red-500" />
                          <h3 className="font-bold text-gray-800 text-sm">{mc(currentLanguage).eskalasyon_gerektiren_faturalar}</h3>
                          <span className="ml-auto text-[10px] text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded-full">{overdueOrders.length} {mc(currentLanguage)._30g_gecikmis}{tutarsiz178 > 0 ? ` · ${tutarsiz178} ${mc(currentLanguage).tutarsiz}` : ''}{tarihsiz178 > 0 ? ` · ${tarihsiz178} ${mc(currentLanguage).tarihsiz}` : ''}</span>
                        </div>
                        <div className="space-y-2">
                          {overdueOrders.map(o => {
                            const escCls = { L3: 'bg-red-100 text-red-800', L2: 'bg-orange-100 text-orange-800', L1: 'bg-amber-100 text-amber-700' }[o.seviye];
                            return (
                              <div key={o.id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${escCls}`}>{o.seviye}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-gray-800 truncate">{o.customerName}</p>
                                  <p className="text-[10px] text-gray-400">{o.gecikmeGunu}g {oc(currentLanguage).gecikmis}</p>
                                </div>
                                <span className="text-xs font-bold text-red-600 shrink-0">{fmtKpi(o.totalPrice)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 132: Financial Ratios ── */}
                  {muhasebeTab === 'finansal-oranlar' && (
                    <motion.div key="muhasebe-ratios" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      <ModuleHeader
                        title={mc(currentLanguage).finansal_oranlar}
                        subtitle={mc(currentLanguage).sap_netsuite_benzeri_likidite_karlilik_ve_veriml}
                        icon={Activity}
                      />
                      {(() => {
                        // Tüm hesap tek kaynakta: utils/muhasebe/finansalOranlar (Faz 3, 2026-09-13).
                        // Revenue = Mikro GİDEN (satış) bu yıl + Cetpa orders (additive);
                        // çift sayım koruması (2026-09-01): source:'mikro-fatura' siparişler dışlanır.
                        // COGS yalnız Cetpa sipariş kalemlerinden; Mikro-only kurulumda bilinmiyor
                        // (0 DEĞİL) → COGS'a bağlı oranlar '—', YANILTICI %100 marj YAZILMAZ.
                        // AR/AP = Mikro cari bakiyeleri (pozitif=alacak, eksi=borç) + Cetpa.
                        // Tutarı bilinmeyen sipariş/kalem/PO/ürün/cari toplama GİRMEZ, sayılır
                        // (`bilinmeyen`); ekran o oranı '—' gösterir + "N kayıt tutarsız" notu.
                        const fo = finansalOranlar({ mikroFaturalar: mikroFaturalarBuYil, siparisler: orders, satinAlmaSiparisleri: apPurchaseOrders, envanter: inventory, cariBakiye: cariBalanceToplam });
                        const { brutKarMarji, cariOran, alacakDevirHizi, dso, stokDevirHizi } = fo.oranlar; // her biri { deger: number | null, bilinmeyen: number }
                        // Ekran kuralı: deger null YA DA bilinmeyen > 0 → '—' (sahte kesinlik yok).
                        const oranYaz = (o: { deger: number | null; bilinmeyen: number }, bicim: (n: number) => string) => o.deger !== null && o.bilinmeyen === 0 ? bicim(o.deger) : '—';
                        const oranDurum = (o: { deger: number | null; bilinmeyen: number }, sinif: (n: number) => 'good' | 'warn' | 'bad'): 'good' | 'warn' | 'bad' | 'neutral' => o.deger === null || o.bilinmeyen > 0 ? 'neutral' : sinif(o.deger);

                        const ratios = [
                          {
                            label: mc(currentLanguage).brut_kar_marji,
                            value: oranYaz(brutKarMarji, n => `%${n.toFixed(1)}`),
                            tutarsiz: brutKarMarji.bilinmeyen,
                            desc: mc(currentLanguage).brut_kar_yuzdesi_cogs_cetpa_siparisinden_mikro_f,
                            status: oranDurum(brutKarMarji, n => n >= 30 ? 'good' : n >= 15 ? 'warn' : 'bad'),
                            benchmark: mc(currentLanguage).ideal_30,
                          },
                          {
                            label: oc(currentLanguage).cari_oran,
                            value: oranYaz(cariOran, n => n.toFixed(2)),
                            tutarsiz: cariOran.bilinmeyen,
                            desc: mc(currentLanguage).donen_varliklar_kisa_vadeli_borclar,
                            status: oranDurum(cariOran, n => n >= 2 ? 'good' : n >= 1 ? 'warn' : 'bad'),
                            benchmark: mc(currentLanguage).ideal_1_52_5,
                          },
                          {
                            label: mc(currentLanguage).alacak_devir_hizi,
                            value: oranYaz(alacakDevirHizi, n => n.toFixed(1) + 'x'),
                            tutarsiz: alacakDevirHizi.bilinmeyen,
                            desc: mc(currentLanguage).yillik_ciro_alacak_bakiyesi,
                            status: oranDurum(alacakDevirHizi, n => n >= 8 ? 'good' : n >= 4 ? 'warn' : 'bad'),
                            benchmark: mc(currentLanguage).ideal_8x,
                          },
                          {
                            label: mc(currentLanguage).alacak_tahsilat_gunu_dso,
                            value: oranYaz(dso, n => `${Math.round(n)} gün`),
                            tutarsiz: dso.bilinmeyen,
                            desc: mc(currentLanguage).ortalama_tahsilat_suresi_gun,
                            status: oranDurum(dso, n => n <= 30 ? 'good' : n <= 60 ? 'warn' : 'bad'),
                            benchmark: mc(currentLanguage).ideal_30_gun,
                          },
                          {
                            label: oc(currentLanguage).stok_devir_hizi,
                            value: oranYaz(stokDevirHizi, n => n.toFixed(2) + 'x'),
                            tutarsiz: stokDevirHizi.bilinmeyen,
                            desc: mc(currentLanguage).maliyet_ortalama_stok_degeri,
                            status: oranDurum(stokDevirHizi, n => n >= 6 ? 'good' : n >= 3 ? 'warn' : 'bad'),
                            benchmark: mc(currentLanguage).ideal_6x,
                          },
                        ];

                        const statusCfg = { good: 'text-emerald-700 bg-emerald-50 border-emerald-100', warn: 'text-amber-700 bg-amber-50 border-amber-100', bad: 'text-red-700 bg-red-50 border-red-100', neutral: 'text-gray-700 bg-gray-50 border-gray-100' };
                        const dotCfg = { good: 'bg-emerald-400', warn: 'bg-amber-400', bad: 'bg-red-500', neutral: 'bg-gray-300' };

                        return (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {ratios.map(r => (
                              <div key={r.label} className={`border rounded-2xl p-5 ${statusCfg[r.status]}`}>
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <div>
                                    <p className="text-sm font-bold">{r.label}</p>
                                    <p className="text-[10px] opacity-70 mt-0.5">{r.desc}</p>
                                  </div>
                                  <span className={`w-3 h-3 rounded-full flex-shrink-0 mt-1 ${dotCfg[r.status]}`} />
                                </div>
                                <p className="text-3xl font-black mt-3">{r.value}</p>
                                <p className="text-[10px] opacity-60 mt-1">{r.benchmark}</p>
                                {r.tutarsiz > 0 && <p className="text-[10px] text-amber-700 mt-1">{currentLanguage === 'tr' ? `${r.tutarsiz} kayıt tutarsız — tutarı bilinmeyen kayıt var, oran hesaplanmadı` : `${r.tutarsiz} records inconsistent — unknown amounts, ratio not computed`}</p>}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}

                  {/* ── Fiyat Karşılaştırma (2026-08-13) ── */}

                  {/* ── Phase 143: Profit & Loss Statement ── */}
                  {muhasebeTab === 'pnl' && (() => {
                    // ── Shared currency setup (used by entire PnL tab) ──────────
                    const pnlSym  = p563PnlCurrency === 'USD' ? '$' : p563PnlCurrency === 'EUR' ? '€' : '₺';
                    // Kur ETIKETI ("₺1 = $x") — ₺1'in birim karşılığı (kurEtiketi); kur yoksa null ve rakam BASMIYORUZ.
                    const pnlKur = kurEtiketi(p563PnlCurrency, exchangeRates);
                    const fmtPnl  = (v: unknown) => tlYaz(v, { birim: p563PnlCurrency, rates: exchangeRates, ondalik: 0 });

                    // Gelir = native (faturasız, Mikro türetmesi olmayan) siparişler + Mikro 'giden' faturalar;
                    // maliyet TÜM ay siparişlerinden. Bilinmeyen tutar 0 DEĞİL — sayılır, etkilenen toplam '—' basılır.
                    const dil143 = currentLanguage === 'tr' ? 'tr' : 'en';
                    const months143 = sonAylarKarZarar(orders, mikroFaturalar, { simdi: new Date(), aySayisi: 6 })
                      .map(a => ({ ...a, label: tarihYaz(a.ay, { month: 'short', year: '2-digit' }, dil143) }));
                    const ozet = karZararOzeti(months143);
                    const yuzdeler143 = cubukYuzdeleri(months143);
                    const pnlRows = [
                      { label: mc(currentLanguage).gelir_satislar, value: ekranTutari(ozet.gelir), bold: true, indent: false, positive: true },
                      { label: mc(currentLanguage).satilan_malin_maliyeti_cogs, value: -ekranTutari(ozet.maliyet), bold: false, indent: true, positive: false },
                      { label: mc(currentLanguage).brut_kar, value: ozet.brutKar ?? NaN, bold: true, indent: false, positive: !(ozet.brutKar !== null && ozet.brutKar < 0) },
                      { label: mc(currentLanguage).isletme_giderleri_sg_a_12, value: -(ozet.isletmeGideri ?? NaN), bold: false, indent: true, positive: false },
                      { label: mc(currentLanguage).faaliyet_kari_ebit, value: ozet.ebit ?? NaN, bold: true, indent: false, positive: !(ozet.ebit !== null && ozet.ebit < 0) },
                    ];
                    return (
                      <motion.div key="muhasebe-pnl" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                        {/* Header + currency toggle in one row */}
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <ModuleHeader
                            title={mc(currentLanguage).gelir_tablosu_p_l}
                            subtitle={mc(currentLanguage).son_6_ay_ozeti}
                            icon={TrendingUp}
                          />
                          {/* Currency toggle — controls ALL numbers on this tab */}
                          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 self-start mt-1">
                            {(['TRY','USD','EUR'] as const).map(c => (
                              <button key={c} onClick={() => setP563PnlCurrency(c)}
                                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${p563PnlCurrency === c ? 'bg-white shadow text-gray-900' : 'text-gray-400 hover:text-gray-700'}`}>
                                {c === 'TRY' ? '₺ TRY' : c === 'USD' ? '$ USD' : '€ EUR'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Live rate notice when converted */}
                        {p563PnlCurrency !== 'TRY' && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-700">
                            <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>
                              {pnlKur === null
                                ? (mc(currentLanguage).kur_alinamadi_tutarlar_gosterilemiyor)
                                : currentLanguage === 'tr'
                                  ? `Kur: ₺1 = ${pnlSym}${pnlKur.toFixed(4)} — Frankfurter API (TCMB referans)`
                                  : `Rate: ₺1 = ${pnlSym}${pnlKur.toFixed(4)} — Frankfurter API`}
                            </span>
                          </div>
                        )}

                        {/* Summary KPIs */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {[
                            { label: oc(currentLanguage).toplam_gelir, value: fmtPnl(ekranTutari(ozet.gelir)), color: 'text-blue-600', bg: 'bg-blue-50' },
                            { label: oc(currentLanguage).brut_marj, value: ozet.brutMarj === null ? '—' : `%${ozet.brutMarj.toFixed(1)}`, color: ozet.brutMarj === null ? 'text-gray-400' : ozet.brutMarj >= 30 ? 'text-emerald-600' : 'text-amber-600', bg: ozet.brutMarj === null ? 'bg-gray-50' : ozet.brutMarj >= 30 ? 'bg-emerald-50' : 'bg-amber-50' },
                            { label: mc(currentLanguage).net_marj, value: ozet.netMarj === null ? '—' : `%${ozet.netMarj.toFixed(1)}`, color: ozet.netMarj === null ? 'text-gray-400' : ozet.netMarj >= 10 ? 'text-emerald-600' : 'text-amber-600', bg: ozet.netMarj === null ? 'bg-gray-50' : ozet.netMarj >= 10 ? 'bg-emerald-50' : 'bg-amber-50' },
                          ].map(k => (
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-xs text-gray-600 mb-1">{k.label}</p>
                              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                            </div>
                          ))}
                        </div>

                        {/* P&L table */}
                        <div className="apple-card p-6">
                          <h3 className="font-bold text-gray-800 mb-4">
                            {mc(currentLanguage).gelir_gider_ozeti_6_ay}
                          </h3>
                          <div className="space-y-0 divide-y divide-gray-100">
                            {pnlRows.map(row => (
                              <div key={row.label} className={`flex items-center justify-between py-3 ${row.bold ? 'bg-gray-50 -mx-2 px-2 rounded-xl' : ''}`}>
                                <span className={`text-sm ${row.indent ? 'pl-4 text-gray-500' : 'font-semibold text-gray-900'}`}>{row.label}</span>
                                <div className="flex items-center gap-3">
                                  {/* Show TRY reference when not in TRY mode */}
                                  {p563PnlCurrency !== 'TRY' && (
                                    <span className="text-xs text-gray-400 font-mono tabular-nums">
                                      {paraYaz(Math.abs(row.value), { ondalik: 0 })}
                                    </span>
                                  )}
                                  <span className={`text-sm font-bold tabular-nums ${Number.isNaN(row.value) ? 'text-gray-400' : row.positive ? 'text-emerald-600' : 'text-red-500'}`}>
                                    {row.value < 0 ? '– ' : ''}{fmtPnl(Math.abs(row.value))}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                          {(ozet.gelir.bilinmeyen > 0 || ozet.maliyet.bilinmeyen > 0) && (
                            <p className="text-[10px] text-amber-600 mt-3">{currentLanguage === 'tr'
                              ? `${ozet.gelir.bilinmeyen} kaydın tutarı, ${ozet.maliyet.bilinmeyen} siparişin maliyeti bilinmiyor — etkilenen toplamlar '—' gösterildi.`
                              : `${ozet.gelir.bilinmeyen} records without amount, ${ozet.maliyet.bilinmeyen} orders without cost — affected totals shown as '—'.`}</p>
                          )}
                          <p className="text-[10px] text-gray-400 mt-4">
                            * {currentLanguage === 'tr' ? 'İşletme giderleri %12 SG&A tahminidir. Gerçek giderler için muhasebe entegrasyonu gereklidir.' : 'Operating expenses estimated at 12% SG&A. Real-time opex requires accounting integration.'}
                          </p>
                        </div>

                        {/* Monthly chart */}
                        <div className="apple-card p-6">
                          <h3 className="font-semibold text-gray-800 mb-4 text-sm">
                            {mc(currentLanguage).aylik_gelir_brut_kar}
                          </h3>
                          <div className="space-y-3">
                            {months143.map((m, i) => {
                              const y = yuzdeler143[i];
                              return (
                                <div key={m.label} className="flex items-center gap-3">
                                  <span className="text-xs text-gray-500 w-12 shrink-0 text-right">{m.label}</span>
                                  <div className="flex-1 space-y-0.5">
                                    <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                                      <div className="h-full bg-blue-400 rounded-full" style={{ width: y.gelirYuzde === null ? '0%' : `${y.gelirYuzde}%` }} />
                                    </div>
                                    <div className="h-2 bg-emerald-100 rounded-full overflow-hidden">
                                      <div className="h-full bg-emerald-400 rounded-full" style={{ width: y.brutKarYuzde === null ? '0%' : `${y.brutKarYuzde}%` }} />
                                    </div>
                                  </div>
                                  <span className="text-xs text-gray-600 w-28 shrink-0 tabular-nums" title={m.gelirBilinmeyen > 0 ? `${m.gelirBilinmeyen} ${mc(currentLanguage).kayit_tutarsiz}` : undefined}>{fmtPnl(m.gelirBilinmeyen > 0 ? NaN : m.gelir)}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex items-center gap-4 mt-3">
                            <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-3 h-2 bg-blue-400 rounded-sm inline-block" />{oc(currentLanguage).gelir}</span>
                            <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-3 h-2 bg-emerald-400 rounded-sm inline-block" />{oc(currentLanguage).brut_kar}</span>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Break-Even Calculator ── */}
                  {muhasebeTab === 'pnl' && (() => {
                    // Tüm iptal-dışı siparişler (faturalı dahil; burada Mikro faturası eklenmediğinden çift sayım yok).
                    // Bilinmeyen tutar/maliyet 0 DEĞİL — marj/başabaş null, ekranda '—'.
                    const be = basabas(orders, inventory);
                    const beCiro = be.basabasCiro, ciroBE = ekranTutari(be.gelir);
                    const karBolgesi = beCiro !== null && Number.isFinite(ciroBE) ? ciroBE >= beCiro : null;
                    // Çubuk ölçeği: başabaşın 1,5 katı ya da gerçekleşen ciro (büyük olan); başabaş yoksa çubuk çizilmez.
                    const olcekBE = beCiro !== null && Number.isFinite(ciroBE) ? Math.max(beCiro * 1.5, ciroBE) : null;
                    const gerceklesenYuzde = olcekBE !== null && olcekBE > 0 ? Math.min((ciroBE / olcekBE) * 100, 100) : null;
                    const basabasYuzde = olcekBE !== null && olcekBE > 0 && beCiro !== null ? Math.min((beCiro / olcekBE) * 100, 100) : null;
                    return (
                      <div className="apple-card p-6 mt-4">
                        <h3 className="font-bold text-gray-800 mb-1">{mc(currentLanguage).basabas_noktasi_analizi}</h3>
                        <p className="text-xs text-gray-400 mb-5">{mc(currentLanguage).sabit_maliyet_tahmini_12_sg_a_uzerinden}</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                          {[
                            { label: oc(currentLanguage).brut_marj, value: be.brutMarj === null ? '—' : `%${be.brutMarj.toFixed(1)}`, color: be.brutMarj === null ? 'text-gray-400' : 'text-blue-600' },
                            { label: mc(currentLanguage).tahmini_sabit_gider, value: paraYaz(be.sabitGider, { ondalik: 0 }), color: be.sabitGider === null ? 'text-gray-400' : 'text-red-500' },
                            { label: mc(currentLanguage).basabas_cirosu, value: paraYaz(beCiro, { ondalik: 0 }), color: beCiro === null ? 'text-gray-400' : 'text-amber-600' },
                            { label: mc(currentLanguage).guvenlik_marji, value: be.guvenlikMarji === null ? '—' : `%${be.guvenlikMarji}`, color: be.guvenlikMarji === null ? 'text-gray-400' : be.guvenlikMarji >= 20 ? 'text-emerald-600' : 'text-red-500' },
                          ].map(k => (
                            <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                              <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                              <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{k.label}</p>
                            </div>
                          ))}
                        </div>
                        <div className="mb-3">
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="text-gray-600">{mc(currentLanguage).gerceklesen_basabas}</span>
                            <span className={`font-semibold ${karBolgesi === null ? 'text-gray-400' : karBolgesi ? 'text-emerald-600' : 'text-red-500'}`}>
                              {karBolgesi === null
                                ? (mc(currentLanguage).basabas_hesaplanamadi)
                                : karBolgesi ? (mc(currentLanguage).kar_bolgesinde) : (mc(currentLanguage).zarar_bolgesinde)}
                            </span>
                          </div>
                          <div className="h-4 bg-gray-100 rounded-full overflow-hidden relative">
                            <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: gerceklesenYuzde === null ? '0%' : `${gerceklesenYuzde}%` }} />
                            {basabasYuzde !== null && (
                              <div className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                                style={{ left: `${basabasYuzde}%` }} />
                            )}
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1">
                            <span>₺0</span>
                            <span className="text-red-500">▲ {mc(currentLanguage).basabas} {beCiro === null ? '—' : fmtKpi(beCiro,'K',0)}</span>
                            <span>{olcekBE === null ? '—' : fmtKpi(olcekBE,'K',0)}</span>
                          </div>
                        </div>
                        {be.basabasAdet !== null && (
                          <p className="text-xs text-gray-500 mt-2">{mc(currentLanguage).tahmini_basabas_siparis_adedi} <span className="font-bold text-gray-800">{be.basabasAdet.toLocaleString()}</span></p>
                        )}
                        {(be.gelir.bilinmeyen > 0 || be.maliyet.bilinmeyen > 0) && (
                          <p className="text-[10px] text-amber-600 mt-2">{currentLanguage === 'tr'
                            ? `${be.gelir.bilinmeyen} siparişin tutarı, ${be.maliyet.bilinmeyen} siparişin maliyeti bilinmiyor — etkilenen değerler '—' gösterildi.`
                            : `${be.gelir.bilinmeyen} orders without amount, ${be.maliyet.bilinmeyen} orders without cost — affected values shown as '—'.`}</p>
                        )}
                      </div>
                    );
                  })()}


                  {/* ── Nakit Akışı (Cash Flow) ── */}
                  {muhasebeTab === 'nakit-akis' && (() => {
                    // Son 6 ay nakit akışı — tek kaynak utils/muhasebe/nakitBilanco.
                    // Giriş: ödenmiş + odemeTakipli siparişler; çıkış: satır maliyeti (COGS).
                    // Tutarı/maliyeti bilinmeyen kayıt 0 GİRMEZ, sayılır (bilinmeyen*); hiç bilinen
                    // kayıt yokken ekranTutari '—' basar ('₺0*' değil); tarihi çözülemeyen sipariş
                    // sessizce düşmez (tarihsiz).
                    const nakit = nakitAkisi(orders, 6);
                    const rows = nakit.aylar.map(a => {
                      const [year, month] = a.key.split('-');
                      const label = tarihYaz(new Date(Number(year), Number(month) - 1, 1), { month: 'short', year: '2-digit' }, currentLanguage === 'tr' ? 'tr' : 'en');
                      return { key: a.key, label, inflow: ekranTutari(a.giris), outflow: ekranTutari(a.cikis), net: a.net, bilinmeyen: a.giris.bilinmeyen + a.cikis.bilinmeyen };
                    });
                    const totalInflow = ekranTutari(nakit.toplamGiris), totalOutflow = ekranTutari(nakit.toplamCikis), totalNet = nakit.toplamNet, maxVal = nakit.enBuyuk;
                    const nakitTutarsiz = nakit.toplamGiris.bilinmeyen + nakit.toplamCikis.bilinmeyen + nakit.tarihsiz;
                    const nakitSatirNotu = (n: number) => currentLanguage === 'tr' ? `${n} kayıt tutarsız — toplama girmedi` : `${n} records unknown — excluded from total`;
                    const fCF = (v: number) => paraYaz(Math.abs(v), { ondalik: 0 }); // NaN → '—'
                    // İşaret yalnız bilinen sayıya: '-—' basılmaz.
                    const isaretli = (v: number) => Number.isFinite(v) ? `${v >= 0 ? '+' : '-'}${fCF(v)}` : fCF(v);
                    const yuzde = (v: number) => Number.isFinite(v) ? (v / maxVal) * 100 : 0;
                    return (
                      <motion.div key="muhasebe-nakit" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                        <ModuleHeader
                          title={mc(currentLanguage).nakit_akisi}
                          subtitle={mc(currentLanguage).son_6_aylik_nakit_giris_cikis_analizi}
                          icon={Wallet}
                        />
                        {nakitTutarsiz > 0 && (
                          <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            <p className="text-xs leading-relaxed">
                              {currentLanguage === 'tr'
                                ? `${nakit.toplamGiris.bilinmeyen} ödenmiş siparişin tutarı, ${nakit.toplamCikis.bilinmeyen} kalemin maliyeti bilinmiyor, ${nakit.tarihsiz} sipariş tarihsiz — toplamlar eksik olabilir.`
                                : `${nakit.toplamGiris.bilinmeyen} paid order(s) with unknown amount, ${nakit.toplamCikis.bilinmeyen} line(s) with unknown cost, ${nakit.tarihsiz} undated order(s) — totals may be incomplete.`}
                            </p>
                          </div>
                        )}
                        {/* Summary KPIs */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {[
                            { label: mc(currentLanguage).toplam_giris, text: fCF(totalInflow), color: 'text-emerald-600', bg: 'bg-emerald-50' },
                            { label: mc(currentLanguage).toplam_cikis, text: fCF(totalOutflow), color: 'text-red-600', bg: 'bg-red-50' },
                            { label: mc(currentLanguage).net_nakit, text: isaretli(totalNet), color: totalNet < 0 ? 'text-red-700' : 'text-blue-700', bg: totalNet < 0 ? 'bg-red-50' : 'bg-blue-50' },
                          ].map(k => (
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">{k.label}</p>
                              <p className={`text-xl font-bold ${k.color}`}>{k.text}</p>
                            </div>
                          ))}
                        </div>
                        {/* Bar chart */}
                        <div className="apple-card p-5">
                          <h3 className="text-sm font-bold text-gray-800 mb-4">{mc(currentLanguage).aylik_nakit_akisi}</h3>
                          <div className="flex items-end gap-3 h-36">
                            {rows.map(r => (
                              <div key={r.key} className="flex-1 flex flex-col items-center gap-1">
                                <div className="w-full flex items-end gap-0.5 h-28">
                                  <div className="flex-1 rounded-t-md bg-emerald-400 transition-all" style={{ height: `${yuzde(r.inflow)}%` }} title={`Giriş: ${fCF(r.inflow)}`} />
                                  <div className="flex-1 rounded-t-md bg-red-400 transition-all" style={{ height: `${yuzde(r.outflow)}%` }} title={`Çıkış: ${fCF(r.outflow)}`} />
                                </div>
                                <span className="text-[9px] text-gray-400 font-medium" title={r.bilinmeyen > 0 ? nakitSatirNotu(r.bilinmeyen) : undefined}>{r.label}{r.bilinmeyen > 0 && <span className="text-amber-600" aria-hidden="true">*</span>}</span>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-4 mt-3 text-[10px] font-semibold text-gray-500">
                            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />{mc(currentLanguage).giris}</span>
                            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />{mc(currentLanguage).cikis}</span>
                          </div>
                        </div>
                        {/* Table */}
                        <div className="apple-card overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 border-b border-gray-100">
                                  <th className="text-left px-4 py-3 text-[10px] font-bold text-gray-400 uppercase">{oc(currentLanguage).donem}</th>
                                  <th className="text-right px-4 py-3 text-[10px] font-bold text-emerald-500 uppercase">{mc(currentLanguage).nakit_giris}</th>
                                  <th className="text-right px-4 py-3 text-[10px] font-bold text-red-500 uppercase">{mc(currentLanguage).nakit_cikis}</th>
                                  <th className="text-right px-4 py-3 text-[10px] font-bold text-blue-500 uppercase">Net</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {rows.map(r => (
                                  <tr key={r.key} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="px-4 py-3 font-semibold text-gray-800" title={r.bilinmeyen > 0 ? nakitSatirNotu(r.bilinmeyen) : undefined}>{r.label}{r.bilinmeyen > 0 && <span className="text-amber-600" aria-hidden="true">*</span>}</td>
                                    <td className="px-4 py-3 text-right font-medium text-emerald-600">{fCF(r.inflow)}</td>
                                    <td className="px-4 py-3 text-right font-medium text-red-500">{fCF(r.outflow)}</td>
                                    <td className={`px-4 py-3 text-right font-bold ${r.net < 0 ? 'text-red-600' : 'text-blue-700'}`}>{isaretli(r.net)}</td>
                                  </tr>
                                ))}
                                <tr className="bg-gray-50 border-t-2 border-gray-200">
                                  <td className="px-4 py-3 font-bold text-gray-800 text-[11px] uppercase">{oc(currentLanguage).toplam}</td>
                                  <td className="px-4 py-3 text-right font-bold text-emerald-600">{fCF(totalInflow)}</td>
                                  <td className="px-4 py-3 text-right font-bold text-red-500">{fCF(totalOutflow)}</td>
                                  <td className={`px-4 py-3 text-right font-bold text-base ${totalNet < 0 ? 'text-red-600' : 'text-blue-700'}`}>{isaretli(totalNet)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Kasa Yönetimi ── */}
                  {muhasebeTab === 'kasa' && (
                    <motion.div key="muhasebe-kasa" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      <ModuleHeader title={mc(currentLanguage).kasa} subtitle={mc(currentLanguage).nakit_giris_cikis_hareketleri_ve_kasa_bakiyeleri} icon={Wallet} />
                      <React.Suspense fallback={LAZY_FALLBACK}><KasaModule currentLanguage={currentLanguage as 'tr' | 'en'} isAuthenticated={!!user && hasFullAccess('muhasebe')} /></React.Suspense>
                    </motion.div>
                  )}

                  {/* ── Phase 547: Bilanço (Balance Sheet) ─────────────────────────────── */}
                  {muhasebeTab === 'bilanco' && (() => {
                    const tr547 = currentLanguage === 'tr';
                    // KUR UYDURMA YOK: kuru olmayan doviz hesabi bilancoya KATILMAZ,
                    // kac tanesinin disarida kaldigi asagida yaziliyor.
                    const kasaT547  = dovizTopla(p547BankAccounts.filter(b => b.accountType === 'Kasa'), b => b.balance, b => b.currency, exchangeRates);
                    const bankaT547 = dovizTopla(p547BankAccounts.filter(b => b.accountType !== 'Kasa'), b => b.balance, b => b.currency, exchangeRates);
                    const kurAtlanan547 = kasaT547.kurYok + bankaT547.kurYok;
                    const kurEksik547 = [...new Set([...kasaT547.birimler, ...bankaT547.birimler])].join('/');
                    // — Aktif (Assets) —
                    // Ticari Alacaklar/Borçlar: native (orders/apPurchaseOrders) bu caride
                    // neredeyse boş — satışlar/alışlar Mikro'dan geliyor. cariBalanceToplam
                    // (Finansal Oranlar'da zaten kullanılan, Mikro cariBalances'tan gerçek
                    // net bakiye toplamı) additive eklendi — aynı desen KDV/Satışlar'da da var.
                    // Tutarı bilinmeyen açık sipariş 0 DEĞİL — sayılır (bilinmeyen). Tutar
                    // siparis.ts `siparisTutari` (`totalPrice ?? totalAmount`, e-Mutabakat ve
                    // sunucuyla AYNI — eski `||` 0 tutarı totalAmount'a düşürüyordu).
                    // cariBalanceToplam.ar/ap her zaman sonlu (state {ar:0,ap:0} başlar — bkz.
                    // state notu, Açık İşler); okunamayan cari dokümanı sayısı `cariBilinmeyen`.
                    const arT547    = ticariAlacak(orders, cariBalanceToplam.ar);
                    // Stoklar MALİYETLE taşınır (TMS 2 / genel muhasebe ilkesi) — satış
                    // fiyatıyla değil. Eskiden i.prices.Retail (satış fiyatı) kullanılıyordu,
                    // bu Aktif'i ve dolayısıyla Toplam Aktif/Özkaynaklar'ı sistematik olarak
                    // şişiriyordu (2026-08-16 kullanıcı bildirimi: "hesap alış fiyatı x adet
                    // olmamalı mı?"). itemCostTRY = inventory.costPrice (Mikro gece senkronu).
                    // Maliyeti/adedi/kuru bilinmeyen kalem 0 DEĞİL — sayılır (itemCostTRY
                    // çevrilemeyende 0 döndüğü için maliyetDurumu ile sınıflandırılıyor).
                    const stokT547  = stokDegeri(inventory, i => {
                      if (!bilinenSayi(i.costPrice ?? i.cost)) return null; // maliyet alanı yok → bilinmiyor
                      const d = maliyetDurumu(i, exchangeRates);            // kur yok / birim tanınmıyor → null
                      return d.durum === 'tl' ? d.tl : null;
                    });
                    const duranT547 = duranVarlik(p547FixedAssets);
                    // — Pasif (Liabilities + Equity) —
                    const apT547    = ticariBorc(apPurchaseOrders, cariBalanceToplam.ap);
                    // KDV borcu DÖNEMSEL bir kalemdir (aylık beyan/ödeme) — mikroFaturalar'ın
                    // TAMAMINI toplamak (önceki hata, 2026-08-13 code review bulgusu) yıllarca
                    // tahsil edilmiş ve zaten ödenmiş KDV'yi de borç gibi gösterip bilançoyu
                    // şişiriyordu. Cari aya (henüz beyan edilmemiş varsayılan dönem) sınırlandı —
                    // aynı kapsam KDV Analizi/KDV Mutabakat sekmelerinde de kullanılıyor.
                    const guncelAy547 = bugunAnahtari().slice(0, 7); // yerel YYYY-MM (UTC ay kayması yok)
                    // kdvT547.mikroNet negatifse devreden KDV (borca 0 girer). ÜST AKIŞ DÜZELDİ (Faz 3 2/n,
                    // 2026-09-18): useMikroFaturalar artık bilinmeyen KDV'yi NaN veriyor (sunucudaki ISNULL(…,0)
                    // yedeği de kalktı) — KDV'si okunamayan Mikro faturası buraya BİLİNMEYEN olarak ulaşır ve sayılır.
                    // 2026-09-18 öncesi dokümanların bayat ₺0'ı da hook'taki korumayla yakalanır (tam import şart).
                    const kdvT547 = kdvBorcu(orders, mikroFaturalar, guncelAy547);
                    const b547 = bilanco({ kasa: kasaT547, banka: bankaT547, alacak: arT547, stok: stokT547, duranVarlik: duranT547, borc: apT547, kdv: kdvT547, cariBilinmeyen: cariBalanceToplam.bilinmeyen });
                    // ekranTutari: hiç bilinen kayıt yokken '—' ('₺0*' değil); özkaynak/pasif modülde zaten NaN-farkında.
                    const toplamAktif547 = ekranTutari(b547.aktif), toplamBorç547 = ekranTutari(b547.borc);
                    const ozkaynak547 = b547.ozkaynak, toplamPasif547 = b547.toplamPasif;
                    const tutarsiz547 = b547.bilinmeyen;
                    const satirNotu547 = (n: number) => tr547 ? `${n} kayıt tutarsız — toplama girmedi` : `${n} records unknown — excluded from total`;
                    const fB = (v: number) => paraYaz(v, { ondalik: 0 }); // NaN → '—'
                    const aktifRows = [
                      { group: oc(tr547).donen_varliklar, items: [
                        { label: mc(tr547).kasa_2,          v: ekranTutari(kasaT547),  bilinmeyen: kasaT547.bilinmeyen + kasaT547.kurYok },
                        { label: mc(tr547).bankalar,      v: ekranTutari(bankaT547), bilinmeyen: bankaT547.bilinmeyen + bankaT547.kurYok },
                        { label: mc(tr547).ticari_alacaklar,   v: ekranTutari(arT547),    bilinmeyen: arT547.bilinmeyen },
                        { label: mc(tr547).stoklar,         v: ekranTutari(stokT547),  bilinmeyen: stokT547.bilinmeyen },
                      ]},
                      { group: mc(tr547).duran_varliklar, items: [
                        { label: mc(tr547).sabit_kiymetler_net, v: ekranTutari(duranT547), bilinmeyen: duranT547.bilinmeyen },
                      ]},
                    ];
                    const pasifRows = [
                      { group: oc(tr547).kisa_vadeli_yukumlulukler, items: [
                        { label: oc(tr547).ticari_borclar, v: ekranTutari(apT547), bilinmeyen: apT547.bilinmeyen },
                        { label: mc(tr547).kdv_borcu,         v: ekranTutari(kdvT547), bilinmeyen: kdvT547.bilinmeyen },
                      ]},
                      { group: oc(tr547).ozkaynaklar, items: [
                        { label: mc(tr547).net_ozkaynaklar, v: ozkaynak547, bilinmeyen: tutarsiz547 },
                      ]},
                    ];
                    return (
                      <motion.div key="muhasebe-bilanco" initial={{ opacity:0,y:6 }} animate={{ opacity:1,y:0 }} className="space-y-4">
                        <ModuleHeader title={mc(tr547).bilanco} subtitle={mc(tr547).aktif_pasif_msugt_formati} icon={Scale} />
                        {kurAtlanan547 > 0 && (
                          <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            <p className="text-xs leading-relaxed">
                              {tr547
                                ? `${kurAtlanan547} kayıt için ${kurEksik547} kuru bulunamadı — bu tutarlar toplama DAHİL DEĞİL. Kur geldiğinde otomatik düzelir.`
                                : `Exchange rate missing for ${kurEksik547} on ${kurAtlanan547} record(s) — EXCLUDED from totals. Resolves automatically once rates arrive.`}
                            </p>
                          </div>
                        )}
                        {tutarsiz547 > 0 && (
                          <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            <p className="text-xs leading-relaxed">
                              {tr547
                                ? `${tutarsiz547} kayıt tutarsız (tutar/maliyet/adet bilinmiyor ya da Mikro cari bakiyesi okunamadı) — toplamlar kısmi; Özkaynak ve Toplam Pasif hesaplanamadı ('—').`
                                : `${tutarsiz547} records unknown (amount/cost/quantity unknown, or a Mikro account balance could not be read) — totals partial; Equity and Total Liabilities not computed ('—').`}
                            </p>
                          </div>
                        )}
                        {/* KPI strip */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            { label: mc(tr547).toplam_aktif,      v: toplamAktif547, color: 'text-blue-700',  bg: 'bg-blue-50' },
                            { label: mc(tr547).toplam_pasif, v: toplamPasif547, color: 'text-indigo-700', bg: 'bg-indigo-50' },
                            { label: mc(tr547).toplam_borc_2,         v: toplamBorç547, color: 'text-red-600',   bg: 'bg-red-50' },
                            { label: oc(tr547).ozkaynaklar,             v: ozkaynak547,   color: ozkaynak547<0?'text-red-600':'text-emerald-700', bg: ozkaynak547<0?'bg-red-50':'bg-emerald-50' },
                          ].map(k => (
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{k.label}</p>
                              <p className={`text-xl font-bold ${k.color}`}>{fB(k.v)}</p>
                            </div>
                          ))}
                        </div>
                        {Math.abs(toplamAktif547 - toplamPasif547) > 1 && (
                          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-sm text-amber-800 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                            {mc(tr547).bilanco_dengelenmedi_bazi_veriler_eksik_olabilir}
                          </div>
                        )}
                        {/* Two-column balance sheet */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* AKTİF */}
                          <div className="apple-card p-5">
                            <h3 className="font-bold text-blue-700 mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4" />{mc(tr547).aktif}</h3>
                            {aktifRows.map(grp => (
                              <div key={grp.group} className="mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">{grp.group}</p>
                                {grp.items.map(it => (
                                  <div key={it.label} className="flex justify-between py-1 border-b border-gray-50 text-sm">
                                    <span className="text-gray-600">{it.label}</span>
                                    <span className="font-semibold text-gray-900 tabular-nums" title={it.bilinmeyen > 0 ? satirNotu547(it.bilinmeyen) : undefined}>{fB(it.v)}{it.bilinmeyen > 0 && <span className="text-amber-600" aria-hidden="true">*</span>}</span>
                                  </div>
                                ))}
                              </div>
                            ))}
                            <div className="flex justify-between pt-2 border-t-2 border-blue-200 text-sm font-bold">
                              <span className="text-blue-700">{mc(tr547).toplam_aktif_2}</span>
                              <span className="text-blue-700 tabular-nums">{fB(toplamAktif547)}</span>
                            </div>
                          </div>
                          {/* PASİF */}
                          <div className="apple-card p-5">
                            <h3 className="font-bold text-indigo-700 mb-3 flex items-center gap-2"><TrendingDown className="w-4 h-4" />{mc(tr547).pasif}</h3>
                            {pasifRows.map(grp => (
                              <div key={grp.group} className="mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">{grp.group}</p>
                                {grp.items.map(it => (
                                  <div key={it.label} className="flex justify-between py-1 border-b border-gray-50 text-sm">
                                    <span className="text-gray-600">{it.label}</span>
                                    <span className="font-semibold text-gray-900 tabular-nums" title={it.bilinmeyen > 0 ? satirNotu547(it.bilinmeyen) : undefined}>{fB(it.v)}{it.bilinmeyen > 0 && <span className="text-amber-600" aria-hidden="true">*</span>}</span>
                                  </div>
                                ))}
                              </div>
                            ))}
                            <div className="flex justify-between pt-2 border-t-2 border-indigo-200 text-sm font-bold">
                              <span className="text-indigo-700">{mc(tr547).toplam_pasif_2}</span>
                              <span className="text-indigo-700 tabular-nums">{fB(toplamPasif547)}</span>
                            </div>
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-400 text-center">{mc(tr547).veriler_veritabanindan_anlik_hesaplanmaktadir_mu}</p>
                        <p className="text-[10px] text-gray-400 text-center">{mc(tr547).kasa_banka_bakiyeleri_elle_girilen_csv_ile_ice_a}</p>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 550: e-Mutabakat (Account Reconciliation) ────────────────── */}
                  {muhasebeTab === 'mutabakat' && (() => {
                    const tr550 = currentLanguage === 'tr';
                    // AR per customer from orders (faturali hariç — Mikro'ya gidip
                    // cariBalances'a yansıdığından üstteki toplamlarda tekrar sayılmasın).
                    // Tutarı bilinmeyen sipariş 0 DEĞİL `bilinmeyen`; Mikro kaynaklı siparişler
                    // (odemeTakipli=false) satırlara girmez — zaten cariBalanceToplam.ar içinde.
                    const { satirlar: mutRows, disi: mutDisi } = mutabakatSatirlari(orders);
                    const mutOzet = mutabakatOzeti(mutRows, cariBalanceToplam.ar);
                    const fM = (v: number) => paraYaz(v, { ondalik: 0 });
                    return (
                      <motion.div key="mutabakat" initial={{ opacity:0,y:6 }} animate={{ opacity:1,y:0 }} className="space-y-4">
                        <ModuleHeader title={mc(tr550).cari_mutabakat} subtitle={mc(tr550).musteri_bazinda_alacak_odeme_dengesi} icon={RefreshCw} />
                        {/* Toplam Alacak/Bakiye eskiden yalnız native orders'tı — gerçek iş
                            hacminin çoğu Mikro'dan geldiğinden hep ₺0'a yakın görünüyordu
                            (2026-08-17 bildirimi). cariBalanceToplam.ar (tüm carilerin net
                            pozitif bakiyesi) additive eklendi. "Tahsil Edilen" Mikro'da ayrı
                            bir alan olarak yok (yalnız güncel net bakiye var) — o yüzden
                            değiştirilmedi, alt tablo hâlâ native sipariş bazlı (satır bazında
                            Mikro carisi olmayan detay). */}
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-2">
                          {[
                            { label: mc(tr550).toplam_alacak,     v: mutOzet.toplamAlacak, color:'text-blue-700',   bg:'bg-blue-50' },
                            { label: oc(tr550).tahsil_edilen,     v: mutOzet.tahsilEdilen, color:'text-emerald-700', bg:'bg-emerald-50' },
                            { label: mc(tr550).bakiye,         v: mutOzet.bakiye,       color:'text-orange-700',  bg:'bg-orange-50' },
                          ].map(k=>(
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{k.label}</p>
                              <p className={`text-xl font-bold ${k.color}`}>{fM(k.v)}</p>
                            </div>
                          ))}
                        </div>
                        {mutOzet.bilinmeyen > 0 && (
                          <p role="status" className="text-xs text-amber-700">
                            {tr550 ? `${mutOzet.bilinmeyen} siparişin tutarı bilinmiyor — toplamlara dahil değil` : `${mutOzet.bilinmeyen} order(s) have unknown amount — excluded from totals`}
                          </p>
                        )}
                        <div className="apple-card overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead><tr className="border-b border-gray-100 bg-gray-50/60">
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase">{oc(tr550).musteri}</th>
                                <th className="px-4 py-2.5 text-right text-xs font-bold text-gray-400 uppercase">{mc(tr550).toplam_borc_3}</th>
                                <th className="px-4 py-2.5 text-right text-xs font-bold text-gray-400 uppercase">{oc(tr550).tahsil}</th>
                                <th className="px-4 py-2.5 text-right text-xs font-bold text-gray-400 uppercase">{oc(tr550).bakiye}</th>
                                <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{oc(tr550).durum}</th>
                              </tr></thead>
                              <tbody>
                                {mutRows.slice(0,30).map((r,i)=>(
                                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                    <td className="px-4 py-2.5 font-medium text-gray-800">{r.name}</td>
                                    <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">{r.bilinmeyen > 0 ? '—' : fM(r.ar)}</td>
                                    <td className="px-4 py-2.5 text-right text-emerald-600 tabular-nums">{r.bilinmeyen > 0 ? '—' : fM(r.paid)}</td>
                                    <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${r.balance>0?'text-orange-600':'text-emerald-600'}`} title={r.bilinmeyen > 0 ? (tr550 ? `${r.bilinmeyen} kayıt tutarsız` : `${r.bilinmeyen} records unknown`) : undefined}>{r.bilinmeyen > 0 ? '—' : fM(r.balance)}</td>
                                    <td className="px-4 py-2.5 text-center">
                                      {(() => { const d = mutabakatDurumu(r);
                                        const stil = { kapali: 'bg-emerald-100 text-emerald-700', yuksek: 'bg-red-100 text-red-700', kismi: 'bg-orange-100 text-orange-700', belirsiz: 'bg-gray-100 text-gray-500' }[d];
                                        const etiket = d === 'kapali' ? oc(tr550).kapali : d === 'yuksek' ? (mc(tr550).yuksek_bakiye) : d === 'kismi' ? oc(tr550).kismi : (mc(tr550).tutar_eksik);
                                        return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${stil}`}>{etiket}</span>; })()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {mutDisi.mikro > 0 && (
                            <p role="status" className="px-4 py-2 text-xs text-gray-500">
                              {tr550 ? `${mutDisi.mikro} Mikro kaynaklı sipariş üstteki cari bakiyede sayıldı` : `${mutDisi.mikro} Mikro-sourced order(s) counted in the cari balance above`}
                            </p>
                          )}
                          {mutRows.length === 0 && (
                            <p className="text-center py-8 text-gray-400 text-sm">
                              {cariBalanceToplam.ar > 0
                                ? (mc(tr550).siparis_bazli_detay_yok_ustteki_toplamlar_mikro_)
                                : (oc(tr550).henuz_siparis_verisi_yok)}
                            </p>
                          )}
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 548: Masraf Yönetimi (Expense Management) ───────────────── */}
                  {muhasebeTab === 'masraf' && (() => {
                    const tr548 = currentLanguage === 'tr';
                    const cats548 = [oc(tr548).ulasim, mc(tr548).konaklama, mc(tr548).yemek, mc(tr548).temsil, mc(tr548).kirtasiye, oc(tr548).diger];
                    // KUR UYDURMA YOK: kuru olmayan döviz toplama KATILMAZ; tutarı bilinmeyen kayıt 0 SAYILMAZ (bilinmeyen).
                    const masraf548 = masrafOzeti(p548Masraflar, exchangeRates);
                    const kurAtlanan548 = masraf548.kurAtlanan;
                    const kurEksik548 = masraf548.kurEksikBirimler.join('/');
                    const fE = (v:number, c:string='TRY') => paraYaz(v, { birim: c, ondalik: c === 'TRY' ? 0 : 2 });
                    return (
                      <motion.div key="masraf" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader
                          title={mc(tr548).masraf_yonetimi}
                          subtitle={mc(tr548).calisan_harcama_talepleri_ve_onay_sureci}
                          icon={Receipt}
                          actionButton={hasFullAccess('muhasebe') ? (
                            <button onClick={()=>setP548Form(true)} className="apple-button-primary px-4 py-2 text-sm flex items-center gap-1.5">
                              <Plus className="w-3.5 h-3.5" />{mc(tr548).masraf_ekle}
                            </button>
                          ) : undefined}
                        />
                        {kurAtlanan548 > 0 && (
                          <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            <p className="text-xs leading-relaxed">
                              {tr548
                                ? `${kurAtlanan548} kayıt için ${kurEksik548} kuru bulunamadı — bu tutarlar toplama DAHİL DEĞİL. Kur geldiğinde otomatik düzelir.`
                                : `Exchange rate missing for ${kurEksik548} on ${kurAtlanan548} record(s) — EXCLUDED from totals. Resolves automatically once rates arrive.`}
                            </p>
                          </div>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            // ekranTutari: tek bekleyen masrafın tutarı yoksa '— · 1 kayıt tutarsız' ('₺0 · 1 kayıt tutarsız' değil)
                            { label: mc(tr548).bekleyen_talep, v: masraf548.bekleyen.adet, sub: paraYaz(ekranTutari(masraf548.bekleyen), { ondalik: 0 }) + (masraf548.bekleyen.bilinmeyen > 0 ? (tr548 ? ` · ${masraf548.bekleyen.bilinmeyen} kayıt tutarsız` : ` · ${masraf548.bekleyen.bilinmeyen} unknown`) : ''), color:'text-orange-600', bg:'bg-orange-50' },
                            { label: oc(tr548).onaylanan,     v: masraf548.onaylanan.adet, sub: paraYaz(ekranTutari(masraf548.onaylanan), { ondalik: 0 }) + (masraf548.onaylanan.bilinmeyen > 0 ? (tr548 ? ` · ${masraf548.onaylanan.bilinmeyen} kayıt tutarsız` : ` · ${masraf548.onaylanan.bilinmeyen} unknown`) : ''), color:'text-emerald-600', bg:'bg-emerald-50' },
                            { label: oc(tr548).reddedilen,    v: masraf548.reddedilenAdet, sub:'', color:'text-red-500', bg:'bg-red-50' },
                            { label: mc(tr548).toplam_kayit,     v: masraf548.toplamAdet, sub:'', color:'text-gray-600', bg:'bg-gray-50' },
                          ].map(k=>(
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{k.label}</p>
                              <p className={`text-2xl font-bold ${k.color}`}>{k.v}</p>
                              {k.sub && <p className="text-xs text-gray-500 mt-0.5">{k.sub}</p>}
                            </div>
                          ))}
                        </div>
                        {/* Add expense form */}
                        {p548Form && (
                          <div className="apple-card p-5 border-2 border-brand/20 space-y-3">
                            <h4 className="font-bold text-gray-800">{mc(tr548).yeni_masraf_talebi}</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              <input value={p548Draft.employeeName} onChange={e=>setP548Draft(d=>({...d,employeeName:e.target.value}))} placeholder={oc(tr548).calisan_adi_2} className="apple-input px-3 py-2 text-sm" />
                              <select value={p548Draft.category} onChange={e=>setP548Draft(d=>({...d,category:e.target.value}))} className="apple-input px-3 py-2 text-sm">
                                {cats548.map(c=><option key={c}>{c}</option>)}
                              </select>
                              <div className="flex gap-2">
                                <input type="number" value={p548Draft.amount} onChange={e=>setP548Draft(d=>({...d,amount:e.target.value}))} placeholder={oc(tr548).tutar} className="apple-input px-3 py-2 text-sm flex-1" />
                                <select value={p548Draft.currency} onChange={e=>setP548Draft(d=>({...d,currency:e.target.value}))} className="apple-input px-3 py-2 text-sm w-20">
                                  {['TRY','USD','EUR'].map(c=><option key={c}>{c}</option>)}
                                </select>
                              </div>
                              <input type="date" value={p548Draft.date} onChange={e=>setP548Draft(d=>({...d,date:e.target.value}))} className="apple-input px-3 py-2 text-sm" />
                              <input value={p548Draft.description} onChange={e=>setP548Draft(d=>({...d,description:e.target.value}))} placeholder={oc(tr548).aciklama} className="apple-input px-3 py-2 text-sm md:col-span-2" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={async()=>{
                                const amt=parseFloat(p548Draft.amount);
                                if(!p548Draft.employeeName||!Number.isFinite(amt)||amt<=0){ toast(oc(tr548).gecerli_bir_tutar_girin,'error'); return; }
                                try{ await addDoc(collection(db,'masraflar'),{...p548Draft,amount:amt,status:'Bekliyor',createdAt:serverTimestamp()});
                                setP548Form(false); setP548Draft({employeeName:'',category:oc(tr548).ulasim,amount:'',currency:'TRY',date:bugunAnahtari(),description:''}); }
                                catch(e){ console.error('[masraf save]',e); toast(mc(tr548).kaydedilemedi,'error'); }
                              }} className="apple-button-primary px-4 py-2 text-sm">{oc(tr548).kaydet}</button>
                              <button onClick={()=>setP548Form(false)} className="apple-button-secondary px-4 py-2 text-sm">{oc(tr548).iptal}</button>
                            </div>
                          </div>
                        )}
                        {/* Expense list */}
                        <div className="apple-card overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead><tr className="border-b border-gray-100 bg-gray-50/60">
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase">{oc(tr548).calisan}</th>
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase hidden sm:table-cell">{oc(tr548).kategori}</th>
                                <th className="px-4 py-2.5 text-right text-xs font-bold text-gray-400 uppercase">{oc(tr548).tutar}</th>
                                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase hidden md:table-cell">{oc(tr548).tarih}</th>
                                <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{oc(tr548).durum}</th>
                                {hasFullAccess('muhasebe') && <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-400 uppercase">{oc(tr548).islem}</th>}
                              </tr></thead>
                              <tbody>
                                {p548Masraflar.map(m=>(
                                  <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                                    <td className="px-4 py-2.5">
                                      <p className="font-medium text-gray-800">{m.employeeName}</p>
                                      <p className="text-xs text-gray-400 hidden sm:block">{m.description}</p>
                                    </td>
                                    <td className="px-4 py-2.5 text-gray-500 hidden sm:table-cell">{m.category}</td>
                                    <td className="px-4 py-2.5 text-right font-bold text-gray-800 tabular-nums">{fE(m.amount,m.currency)}</td>
                                    <td className="px-4 py-2.5 text-gray-500 text-xs hidden md:table-cell">{m.date}</td>
                                    <td className="px-4 py-2.5 text-center">
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${m.status==='Onaylandı'?'bg-emerald-100 text-emerald-700':m.status==='Reddedildi'?'bg-red-100 text-red-700':'bg-orange-100 text-orange-700'}`}>{m.status}</span>
                                    </td>
                                    {hasFullAccess('muhasebe') && (
                                      <td className="px-4 py-2.5 text-center">
                                        {m.status==='Bekliyor' && (
                                          <div className="flex justify-center gap-1">
                                            <button onClick={async()=>{try{await updateDoc(doc(db,'masraflar',m.id),{status:'Onaylandı',approvedBy:user?.displayName||user?.email||''});}catch(e){console.error('[masraf approve]',e);toast(mc(tr548).islem_basarisiz,'error');}}} className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-1 rounded-full hover:bg-emerald-200 transition-colors">{oc(tr548).onayla}</button>
                                            <button onClick={async()=>{try{await updateDoc(doc(db,'masraflar',m.id),{status:'Reddedildi'});}catch(e){console.error('[masraf reject]',e);toast(mc(tr548).islem_basarisiz,'error');}}} className="text-[10px] bg-red-100 text-red-700 font-bold px-2 py-1 rounded-full hover:bg-red-200 transition-colors">{oc(tr548).reddet}</button>
                                          </div>
                                        )}
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {p548Masraflar.length===0 && (
                            <div className="text-center py-12 space-y-2">
                              <Receipt className="w-10 h-10 text-gray-200 mx-auto" />
                              <p className="text-gray-400 text-sm">{mc(tr548).masraf_ekle_ile_ilk_talebi_olusturun}</p>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 555: Ba/Bs Formu (Turkish VAT Transaction Lists) ────────── */}
                  {muhasebeTab === 'babs' && (() => {
                    const tr555 = currentLanguage === 'tr';
                    // Filter orders by selected period
                    const [yr555, mo555] = p555Period.split('-').map(Number);
                    // KAYNAK: Mikro faturaları (vergi formu = fatura bazlı tek kaynak;
                    // orders/apPurchaseOrders boştu → panel hep boş). Mükerrer sayım YOK:
                    // Cetpa siparişi Mikro'ya gönderilince zaten fatura oluyor. Dönem
                    // eşleşmesi tarih 'YYYY-MM' önekiyle (p555Period).
                    // Ba = GELEN (alış) faturaları, cari bazında ≥ ₺5.000.
                    // Hesap tek kaynakta: babsKdvAnaliz.babsFormu — tutarı bilinmeyen fatura 0 sayılıp cari
                    // eşiğin altına düşürülmez (belirsiz listesi), tarihi çözülemeyen fatura sayılır (tarihsiz).
                    // ÜST AKIŞ DÜZELDİ (Faz 3 2/n, 2026-09-18): useMikroFaturalar meblağı okunamayan faturayı
                    // artık NaN (= bilinmiyor) veriyor — `belirsiz` listesi GERÇEKTEN dolar ve eşiğin altına
                    // düşürülemeyen cariler mali müşavire sorulmak üzere burada görünür.
                    // 2026-09-18 öncesi dokümanların bayat ₺0'ı da hook'taki korumayla yakalanır (tam import şart).
                    const ba = babsFormu(mikroFaturalar, 'gelen', p555Period, k => cariAdMap.get(k));
                    const baRows = ba.satirlar.map(s => ({ name: s.ad, amount: ekranTutari(s.tutar), bilinmeyen: s.tutar.bilinmeyen }));
                    // Bs = GİDEN (satış) faturaları, cari bazında ≥ ₺5.000.
                    const bs = babsFormu(mikroFaturalar, 'giden', p555Period, k => cariAdMap.get(k));
                    const bsRows = bs.satirlar.map(s => ({ name: s.ad, amount: ekranTutari(s.tutar), bilinmeyen: s.tutar.bilinmeyen }));
                    const fBabs = (v:number) => paraYaz(v, { ondalik: 0 });
                    const tutarsizNotu = (n: number) => n > 0 && <span className="ml-1 text-[10px] font-normal text-amber-600">· {n} {mc(tr555).fatura_tutarsiz}</span>;
                    // Eşik kararı verilemeyen cariler (bilinen toplam < ₺5.000 ama tutarsız faturası var) beyandan
                    // DÜŞÜRÜLEMEZ — mali müşavire sorulmalı; tarihsiz faturalar hiçbir döneme girmiyor.
                    const babsUyari = (f: BabsFormu, yonTr: string, yonEn: string) => (
                      <>
                        {f.belirsiz.length > 0 && (
                          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-800">
                            <p className="font-bold">{tr555 ? `Eşik kararı verilemeyen ${f.belirsiz.length} cari (tutarı bilinmeyen faturası var) — beyandan düşürülemez, mali müşavire sorun:` : `${f.belirsiz.length} accounts with undecidable threshold (invoices with unknown amount) — cannot be dropped from the declaration, ask your accountant:`}</p>
                            <p>{f.belirsiz.map(s => s.tutar.bilinen > 0
                              ? `${s.ad} (${mc(tr555).bilinen} ${fBabs(s.tutar.toplam)} + ${s.tutar.bilinmeyen} ${mc(tr555).tutarsiz_2})`
                              : `${s.ad} (${s.tutar.bilinmeyen} ${mc(tr555).tutarsiz_2})`).join(' · ')}</p>
                          </div>
                        )}
                        {f.tarihsiz > 0 && (
                          <p className="mt-2 text-[11px] text-amber-700">{tr555 ? `${f.tarihsiz} ${yonTr} faturanın tarihi çözülemedi — hiçbir döneme girmiyor.` : `${f.tarihsiz} ${yonEn} invoices have no resolvable date — they fall into no period.`}</p>
                        )}
                      </>
                    );
                    return (
                      <motion.div key="babs" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={mc(tr555).ba_bs_formu} subtitle={mc(tr555)._5_000_ve_uzeri_alim_ba_ve_satis_bs_bildirimi_lo} icon={FileText} />
                        {/* Period picker */}
                        <div className="flex items-center gap-3 flex-wrap">
                          <label className="text-sm font-semibold text-gray-600">{oc(tr555).donem_2}</label>
                          <input type="month" value={p555Period} onChange={e=>setP555Period(e.target.value)} className="apple-input px-3 py-2 text-sm" />
                          <div className="flex gap-3 text-sm text-gray-500">
                            <span className="font-bold text-rose-600">{baRows.length} Ba</span>
                            <span className="font-bold text-blue-600">{bsRows.length} Bs</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* Ba formu - Alımlar */}
                          <div className="apple-card p-5">
                            <h4 className="font-bold text-rose-700 mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4" />Ba {mc(tr555).formu_alimlar}
                            </h4>
                            <p className="text-xs text-gray-400 mb-3">{tr555?`${yr555}/${String(mo555).padStart(2,'0')} dönemine ait ₺5.000 ve üzeri tedarikçi alımları`:`Supplier purchases ≥ ₺5,000 for ${yr555}/${String(mo555).padStart(2,'0')}`}</p>
                            {baRows.length > 0 ? (
                              <table className="w-full text-sm">
                                <thead><tr className="border-b border-gray-100">
                                  <th className="py-1.5 text-left text-xs font-bold text-gray-400 uppercase">{oc(tr555).tedarikci}</th>
                                  <th className="py-1.5 text-right text-xs font-bold text-gray-400 uppercase">{oc(tr555).tutar}</th>
                                </tr></thead>
                                <tbody>
                                  {baRows.map((r,i)=>(
                                    <tr key={i} className="border-b border-gray-50">
                                      <td className="py-1.5 text-gray-700">{r.name}</td>
                                      <td className="py-1.5 text-right font-bold text-rose-700 tabular-nums">{fBabs(r.amount)}{tutarsizNotu(r.bilinmeyen)}</td>
                                    </tr>
                                  ))}
                                  <tr className="border-t-2 border-rose-200">
                                    <td className="py-1.5 font-bold text-gray-800">{oc(tr555).toplam}</td>
                                    <td className="py-1.5 text-right font-bold text-rose-700 tabular-nums">{fBabs(ekranTutari(ba.toplam))}{tutarsizNotu(ba.toplam.bilinmeyen)}</td>
                                  </tr>
                                </tbody>
                              </table>
                            ) : <p className="text-sm text-gray-400 text-center py-6">{mc(tr555).bu_donemde_5_000_uzeri_alim_yok}</p>}
                            {babsUyari(ba, 'gelen', 'incoming')}
                          </div>
                          {/* Bs formu - Satışlar */}
                          <div className="apple-card p-5">
                            <h4 className="font-bold text-blue-700 mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4" />Bs {mc(tr555).formu_satislar}
                            </h4>
                            <p className="text-xs text-gray-400 mb-3">{tr555?`${yr555}/${String(mo555).padStart(2,'0')} dönemine ait ₺5.000 ve üzeri müşteri satışları`:`Customer sales ≥ ₺5,000 for ${yr555}/${String(mo555).padStart(2,'0')}`}</p>
                            {bsRows.length > 0 ? (
                              <table className="w-full text-sm">
                                <thead><tr className="border-b border-gray-100">
                                  <th className="py-1.5 text-left text-xs font-bold text-gray-400 uppercase">{oc(tr555).musteri}</th>
                                  <th className="py-1.5 text-right text-xs font-bold text-gray-400 uppercase">{oc(tr555).tutar}</th>
                                </tr></thead>
                                <tbody>
                                  {bsRows.map((r,i)=>(
                                    <tr key={i} className="border-b border-gray-50">
                                      <td className="py-1.5 text-gray-700">{r.name}</td>
                                      <td className="py-1.5 text-right font-bold text-blue-700 tabular-nums">{fBabs(r.amount)}{tutarsizNotu(r.bilinmeyen)}</td>
                                    </tr>
                                  ))}
                                  <tr className="border-t-2 border-blue-200">
                                    <td className="py-1.5 font-bold text-gray-800">{oc(tr555).toplam}</td>
                                    <td className="py-1.5 text-right font-bold text-blue-700 tabular-nums">{fBabs(ekranTutari(bs.toplam))}{tutarsizNotu(bs.toplam.bilinmeyen)}</td>
                                  </tr>
                                </tbody>
                              </table>
                            ) : <p className="text-sm text-gray-400 text-center py-6">{mc(tr555).bu_donemde_5_000_uzeri_satis_yok}</p>}
                            {babsUyari(bs, 'giden', 'outgoing')}
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-400 text-center">{mc(tr555).beyan_limiti_5_000_dir_gercek_ba_bs_bildirimi_ic}</p>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 557: Senaryo Bütçesi (Scenario-Based Budgeting) ─────────── */}
                  {muhasebeTab === 'butce' && (() => {
                    const tr557 = currentLanguage === 'tr';
                    // Get last 6 months revenue as baseline
                    const now557 = new Date();
                    // Hesap tek kaynakta: babsKdvAnaliz.ciroTemeli — tutarsız sipariş ₺0 ciro sayılmaz,
                    // hiç cirolu ay yoksa taban null (₺0K projeksiyon uydurulmaz).
                    const temel = ciroTemeli(orders, now557);
                    const scenarios: Record<string,{growth:number;expGrowth:number;color:string;label:string}> = {
                      best:  { growth: 0.20, expGrowth: 0.10, color:'emerald', label: mc(tr557).iyimser_20 },
                      base:  { growth: 0.05, expGrowth: 0.05, color:'blue',    label: mc(tr557).baz_5 },
                      worst: { growth: -0.10, expGrowth: 0.02, color:'red',   label: mc(tr557).kotumser_10 },
                    };
                    const sc = scenarios[p557Scenario];
                    const proj = senaryoProjeksiyonu(temel.ortalama, { buyume: sc.growth, giderBuyume: sc.expGrowth }, now557);
                    const months12 = (proj?.aylar ?? []).map(m => ({ label: tarihYaz(m.tarih, { month: 'short', year: '2-digit' }, tr557 ? 'tr' : 'en'), revenue: m.ciro, expense: m.gider, net: m.net, marj: m.marj }));
                    const totalRev12 = proj ? proj.toplamCiro : NaN, totalExp12 = proj ? proj.toplamGider : NaN, totalProfit12 = proj ? proj.toplamNet : NaN;
                    // kisaTutar: bilinmeyen (NaN/null) → '—'; eski fS '₺NaNK' basardı.
                    const fS = (v: number) => kisaTutar(v, { fmt: 'K' });
                    const colMap: Record<string,string> = {emerald:'text-emerald-700 bg-emerald-50',blue:'text-blue-700 bg-blue-50',red:'text-red-700 bg-red-50'};
                    return (
                      <motion.div key="butce-senaryo" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={mc(tr557).butce_senaryo_planlamasi} subtitle={mc(tr557)._12_aylik_gelir_gider_tahmini_iyimser_baz_ve_kot} icon={BarChart3} />
                        {/* Scenario selector */}
                        <div className="flex gap-2 flex-wrap">
                          {(Object.entries(scenarios) as Array<[string,typeof scenarios[string]]>).map(([key,s])=>(
                            <button key={key} onClick={()=>setP557Scenario(key as typeof p557Scenario)}
                              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border-2 ${p557Scenario===key ? `border-${s.color}-500 bg-${s.color}-50 text-${s.color}-700` : 'border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                              {s.label}
                            </button>
                          ))}
                        </div>
                        {/* 12-month KPIs */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {[
                            { label:oc(tr557)._12_ay_ciro, v:totalRev12, color:'text-blue-700',  bg:'bg-blue-50' },
                            { label:mc(tr557)._12_ay_gider, v:totalExp12, color:'text-red-600',   bg:'bg-red-50' },
                            { label:mc(tr557)._12_ay_net,        v:totalProfit12, color:totalProfit12>=0?'text-emerald-700':'text-red-700', bg:totalProfit12>=0?'bg-emerald-50':'bg-red-50' },
                          ].map(k=>(
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{k.label}</p>
                              <p className={`text-xl font-bold ${k.color}`}>{fS(k.v)}</p>
                            </div>
                          ))}
                        </div>
                        {/* Month-by-month table */}
                        <div className="apple-card p-5">
                          <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colMap[sc.color]}`}>{sc.label}</span>
                            {mc(tr557).aylik_projeksiyon}
                          </h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead><tr className="border-b border-gray-100">
                                <th className="py-2 text-left text-xs font-bold text-gray-400 uppercase">{oc(tr557).ay}</th>
                                <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{oc(tr557).ciro}</th>
                                <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{mc(tr557).gider}</th>
                                <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{oc(tr557).net_kar}</th>
                                <th className="py-2 text-right text-xs font-bold text-gray-400 uppercase">{oc(tr557).marj}</th>
                              </tr></thead>
                              <tbody>
                                {months12.length === 0 && (
                                  <tr><td colSpan={5} className="py-6 text-center text-sm text-gray-400">{mc(tr557).son_6_ayda_bilinen_ciro_yok_projeksiyon_uretilem}</td></tr>
                                )}
                                {months12.map((m,i)=>{
                                  const net = m.net;
                                  const margin = m.marj;
                                  return (
                                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                      <td className="py-1.5 text-gray-700 font-medium">{m.label}</td>
                                      <td className="py-1.5 text-right text-blue-700 tabular-nums font-semibold">{fS(m.revenue)}</td>
                                      <td className="py-1.5 text-right text-red-500 tabular-nums">{fS(m.expense)}</td>
                                      <td className={`py-1.5 text-right font-bold tabular-nums ${net>=0?'text-emerald-700':'text-red-700'}`}>{fS(net)}</td>
                                      <td className="py-1.5 text-right text-gray-500 tabular-nums">{margin === null ? '—' : `${margin}%`}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-400 text-center">{tr557?`Temel: Son 6 aylık ortalama ciro ${kisaTutar(temel.ortalama, { fmt: 'K' })} (${temel.ciroluAy} cirolu ay) · Gider tahmini cironun %65\'i varsayıldı.`:`Baseline: Last 6-month avg revenue ${kisaTutar(temel.ortalama, { fmt: 'K' })} (${temel.ciroluAy} months with revenue) · Expenses assumed at 65% of revenue.`}{temel.bilinmeyen > 0 && ` · ${temel.bilinmeyen} ${mc(tr557).siparisin_tutari_bilinmiyor_tabana_girmedi}`}{temel.tarihsiz > 0 && ` · ${temel.tarihsiz} ${mc(tr557).siparisin_tarihi_cozulemedi}`}</p>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 558: KDV Analiz Raporu ──────────────────────────────────── */}
                  {muhasebeTab === 'kdv' && (() => {
                    const tr558 = currentLanguage === 'tr';
                    const yearNum = Number(p558Year);

                    // KAYNAK: Mikro faturaları (giden=satış → tahsil edilen KDV, gelen=alış
                    // → ödenen KDV). Önceki sürüm yalnız native orders'a bakıyordu — bu
                    // carinin satışları Mikro'dan geldiği için orders.kdvTutari hep boş
                    // kalıyor, ekran hep ₺0 gösteriyordu (KDV Mutabakat/Phase 617'de aynı
                    // kök sebep zaten çözülmüştü, burada unutulmuştu). "Ödenen KDV" de
                    // artık gerçek alış faturası KDV'si — eski %30-tahmin kaldırıldı.
                    // Hesap tek kaynakta: babsKdvAnaliz.kdvAnalizi — KDV'si bilinmeyen fatura toplama girmez,
                    // SAYILIR (bilinmeyen); tarihi çözülemeyen fatura hiçbir yıla girmez (tarihsiz).
                    // ÜST AKIŞ DÜZELDİ (Faz 3 2/n, 2026-09-18): useMikroFaturalar `kdv`yi 0'a zorlamıyor —
                    // `bilinmeyen` sayacı Mikro faturaları için de dolar. 2026-09-18 öncesi dokümanların
                    // bayat ₺0'ı da hook'taki korumayla yakalanır (kesin çözüm tam yeniden import).
                    const kdv = kdvAnalizi(mikroFaturalar, yearNum);
                    const monthlyData = kdv.aylar.map(a => ({ m: a.ay, collected: ekranTutari(a.tahsil), paidEst: ekranTutari(a.odenen), net: a.net, bilinmeyen: a.bilinmeyen }));

                    const totCol = ekranTutari(kdv.toplamTahsil), totPaid = ekranTutari(kdv.toplamOdenen), totNet = kdv.toplamNet;
                    const kdvBilinmeyen = kdv.toplamTahsil.bilinmeyen + kdv.toplamOdenen.bilinmeyen;
                    const monthNames = tr558
                      ? ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']
                      : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    // NaN (bilinmeyen ay) ölçeğe girmez; `, 1` sıfıra-bölme koruması (para iddiası değil).
                    const maxVal = Math.max(...monthlyData.map(d => d.collected).filter(v => Number.isFinite(v)), 1);

                    // KDV by rate breakdown — Mikro giden (satış) faturalarından, gerçek oran.
                    // Karma oranlı faturalar (hem %10 hem %20) tek f.oran'a göre kovalanırsa
                    // KDV'si yanlış orana yazılır — ayrı "karma" kovası (task #27, #18'in
                    // aynı kök nedenli devamı).
                    const rateMap = kdv.oranDagilimi;

                    return (
                      <motion.div key="kdv" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="font-bold text-gray-800 flex items-center gap-2">
                            <Receipt className="w-5 h-5 text-brand" />
                            {mc(tr558).kdv_analiz_raporu}
                          </h3>
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-500">{mc(tr558).yil}</label>
                            <select className="apple-input text-sm px-3 py-1.5" value={p558Year} onChange={e => setP558Year(e.target.value)}>
                              {[0,1,2].map(i => { const y = String(new Date().getFullYear() - i); return <option key={y} value={y}>{y}</option>; })}
                            </select>
                          </div>
                        </div>

                        {kdv.faturaSayisi === 0 && (
                          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-sm text-amber-800 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                            {tr558 ? `${yearNum} yılında Mikro faturası bulunamadı. "Faturalar" çekilmiş mi?` : `No Mikro invoices found for ${yearNum}.`}
                          </div>
                        )}

                        {/* KPI bar */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {[
                            { label: mc(tr558).tahsil_edilen_kdv, val: totCol, color:'text-emerald-700', bg:'bg-emerald-50' },
                            { label: mc(tr558).odenen_kdv, val: totPaid, color:'text-red-600', bg:'bg-red-50' },
                            { label: mc(tr558).net_kdv_borcu, val: totNet, color: totNet>0?'text-amber-700':'text-blue-700', bg: totNet>0?'bg-amber-50':'bg-blue-50' },
                          ].map(k => (
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-[10px] font-bold text-gray-400">{k.label}</p>
                              <p className={`text-xl font-black mt-1 ${k.color}`}>{fmtKpi(k.val,'full',0)}</p>
                            </div>
                          ))}
                        </div>
                        {kdvBilinmeyen > 0 && (
                          <p className="text-[11px] text-amber-700">{tr558 ? `${kdvBilinmeyen} faturanın KDV tutarı bilinmiyor — toplama girmedi.` : `${kdvBilinmeyen} invoices have an unknown VAT amount — excluded from totals.`}</p>
                        )}
                        {kdv.tarihsiz > 0 && (
                          <p className="text-[11px] text-amber-700">{tr558 ? `${kdv.tarihsiz} faturanın tarihi çözülemedi — hiçbir yıla girmiyor.` : `${kdv.tarihsiz} invoices have no resolvable date — they fall into no year.`}</p>
                        )}

                        {/* Monthly bar chart */}
                        <div className="apple-card p-5">
                          <h4 className="font-bold text-gray-700 text-sm mb-4">{mc(tr558).aylik_kdv_tahsilati} — {p558Year}</h4>
                          <div className="flex items-end gap-1 h-32">
                            {monthlyData.map(d => (
                              <div key={d.m} className="flex-1 flex flex-col items-center gap-1">
                                <div className="w-full bg-brand/10 rounded-t relative flex flex-col justify-end" style={{height:'100px'}}>
                                  <div className="bg-brand/70 rounded-t transition-all duration-500 w-full"
                                    style={{height: `${Number.isFinite(d.collected) ? (d.collected/maxVal)*100 : 0}%`, minHeight: d.collected>0?'2px':'0'}} />
                                  {d.paidEst > 0 && (
                                    <div className="absolute bottom-0 left-0 right-0 bg-red-300/50 rounded-t" style={{height:`${(d.paidEst/maxVal)*100}%`}} />
                                  )}
                                </div>
                                <span className="text-[9px] text-gray-400">{monthNames[d.m-1]}</span>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-brand/70 inline-block" />{oc(tr558).tahsil}</span>
                            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-300/50 inline-block" />{oc(tr558).odenen}</span>
                          </div>
                        </div>

                        {/* Monthly table */}
                        <div className="apple-card p-5">
                          <h4 className="font-bold text-gray-700 text-sm mb-3">{mc(tr558).donem_detayi}</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-100">
                                  {[oc(tr558).ay, mc(tr558).tahsil_edilen_kdv_2, mc(tr558).odenen_kdv_2, mc(tr558).net_kdv].map(h => (
                                    <th key={h} className="py-2 px-3 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {monthlyData.map(d => (
                                  <tr key={d.m} className="hover:bg-gray-50/50">
                                    <td className="px-3 py-2 font-semibold text-gray-700">{monthNames[d.m-1]}{d.bilinmeyen > 0 && <span className="ml-1 text-[10px] font-normal text-amber-600">· {d.bilinmeyen} {mc(tr558).fatura_kdv_si_bilinmiyor}</span>}</td>
                                    <td className="px-3 py-2 text-emerald-700 font-mono">{d.collected > 0 ? paraYaz(d.collected) : '—'}</td>
                                    <td className="px-3 py-2 text-red-500 font-mono">{d.paidEst > 0 ? paraYaz(d.paidEst) : '—'}</td>
                                    <td className={`px-3 py-2 font-bold font-mono ${d.net > 0 ? 'text-amber-700' : d.net < 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                                      {d.net !== 0 ? paraYaz(d.net) : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-gray-200 font-bold bg-gray-50">
                                  <td className="px-3 py-2 text-[10px] uppercase text-gray-500">{oc(tr558).toplam}</td>
                                  <td className="px-3 py-2 text-emerald-700 font-mono">{paraYaz(totCol)}</td>
                                  <td className="px-3 py-2 text-red-500 font-mono">{paraYaz(totPaid)}</td>
                                  <td className={`px-3 py-2 font-mono ${totNet>0?'text-amber-700':'text-blue-700'}`}>{paraYaz(totNet)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                          {Object.keys(rateMap).length > 0 && (
                            <div className="mt-4 pt-4 border-t border-gray-100">
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">{tr558 ? `KDV Oranına Göre Dağılım (${yearNum})` : `Distribution by VAT Rate (${yearNum})`}</p>
                              <div className="flex flex-wrap gap-3">
                                {/* 'karma' ve 'bilinmiyor' ikisi de Number()'da NaN'a
                                    düşüp aynı -1 rütbesine kayardı — 'karma' önce gelsin. */}
                                {Object.entries(rateMap).sort((a,b) => {
                                  const rank = (k: string) => k === 'karma' ? -0.5 : (Number(k) || -1);
                                  return rank(b[0]) - rank(a[0]);
                                }).map(([rate, total]) => (
                                  <div key={rate} className="bg-gray-50 rounded-xl px-3 py-2">
                                    <p className="text-[10px] text-gray-400">{rate === 'bilinmiyor' ? (oc(tr558).oran_yok) : rate === 'karma' ? (oc(tr558).karma_oran) : `%${rate} KDV`}</p>
                                    <p className="font-bold text-gray-800 text-sm">{paraYaz(ekranTutari(total))}{total.bilinmeyen > 0 && <span className="ml-1 text-[10px] font-normal text-amber-600">· {total.bilinmeyen} {mc(tr558).fatura_kdv_si_bilinmiyor}</span>}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <p className="text-[10px] text-gray-400 mt-3">* {mc(tr558).tahsil_edilen_ve_odenen_kdv_mikro_dan_cekilen_sa}</p>
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Vade Analizi & Cari Ekstre — Cari Hesap sekmesinin doğal yeri ── */}
                  {muhasebeTab === 'cari' && (
                    <div className="mb-6">
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-1.5">
                        <span>{mc(currentLanguage).vade_analizi_cari_ekstre}</span>
                      </h4>
                      <React.Suspense fallback={LAZY_FALLBACK}><CariEkstrePanel currentLanguage={currentLanguage} mikroArTotal={cariBalanceToplam.ar} /></React.Suspense>
                    </div>
                  )}

                  {/* ── Phase 559: Müşteri Cari Hesap Ekstresi ────────────────────────── */}
                  {muhasebeTab === 'cari' && (() => {
                    const tr559 = currentLanguage === 'tr';
                    // Build customer list from orders + leads
                    const customerNames = Array.from(new Set([
                      ...orders.map(o => o.customerName),
                      ...leads.map(l => l.name),
                    ])).filter(Boolean).sort();

                    const selCustomer = p559Customer || customerNames[0] || '';
                    const custOrders = orders.filter(o => o.customerName === selCustomer);
                    // Tek kaynak: cariEkstreOnay.ts — tarihsiz kayıt 1970'e değil SONA; bilinmeyen tutar 0 DEĞİL, sayılır
                    const { hareketler: ledger, bilinmeyen: tutarsizSayisi, tarihsiz: tarihsizSayisi } = cariHareketleri(custOrders);
                    const custLead = leads.find(l => l.name === selCustomer);
                    const creditLimit = krediLimiti(custLead); // number | null — bilinmeyen limit 0 DEĞİL

                    const ozet = cariOzet(custOrders);
                    // para.ts ekranTutari (TEK sözleşme): hiç bilinen yokken '—', kısmi bilinmeyen kısmi toplam —
                    // aşağıdaki "N kaydın tutarı bilinmiyor" notu (ozet.fatura.bilinmeyen) yanına düşer.
                    const totalInvoiced = ekranTutari(ozet.fatura);
                    const totalPaid = ekranTutari(ozet.tahsil);
                    const outstanding = ekranTutari(ozet.bekleyen);
                    const creditUtil = krediKullanimi(creditLimit, ozet); // number | null

                    return (
                      <motion.div key="cari" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="font-bold text-gray-800 flex items-center gap-2">
                            <Users className="w-5 h-5 text-brand" />
                            {mc(tr559).musteri_cari_hesap_ekstresi}
                          </h3>
                          <select className="apple-input text-sm px-3 py-1.5 max-w-xs"
                            value={selCustomer} onChange={e => setP559Customer(e.target.value)}>
                            {customerNames.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>

                        {/* Customer KPI row */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: mc(tr559).toplam_fatura, val: totalInvoiced, color:'text-gray-800', bg:'bg-gray-50' },
                            { label: oc(tr559).tahsil_edilen, val: totalPaid, color:'text-emerald-700', bg:'bg-emerald-50' },
                            { label: mc(tr559).bekleyen_alacak, val: outstanding, color: Number.isFinite(outstanding) && outstanding>0 ? 'text-amber-700' : Number.isFinite(outstanding) ? 'text-emerald-700' : 'text-gray-400', bg:'bg-amber-50' },
                            { label: oc(tr559).kredi_limiti_2, val: creditLimit ?? NaN, color: creditUtil !== null && creditUtil>80?'text-red-600':'text-blue-700', bg: creditUtil !== null && creditUtil>80?'bg-red-50':'bg-blue-50' },
                          ].map(k => (
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-[10px] font-bold text-gray-400">{k.label}</p>
                              <p className={`text-xl font-black mt-1 ${k.color}`}>{fmtKpi(k.val,'full',0)}</p>
                            </div>
                          ))}
                        </div>
                        {(ozet.fatura.bilinmeyen > 0 || ozet.odemeBilinmeyen > 0) && (
                          <p className="text-xs text-gray-500">
                            {ozet.fatura.bilinmeyen > 0 && (tr559
                              ? `${ozet.fatura.bilinmeyen} kaydın tutarı bilinmiyor. `
                              : `${ozet.fatura.bilinmeyen} record(s) with unknown amount. `)}
                            {ozet.odemeBilinmeyen > 0 && (tr559
                              ? `${ozet.odemeBilinmeyen} kaydın tahsilatı Mikro cari hesapta izleniyor — Bekleyen Alacak'a dahil değil.`
                              : `${ozet.odemeBilinmeyen} record(s) tracked in Mikro — not included in Outstanding.`)}
                          </p>
                        )}

                        {/* Credit utilization bar */}
                        {creditLimit !== null && creditLimit > 0 && creditUtil === null && (
                          <p className="text-xs text-gray-500">{tr559
                            ? `Kredi kullanım oranı hesaplanamadı: ${ozet.bekleyen.bilinmeyen} kaydın tutarı bilinmiyor / ${ozet.odemeBilinmeyen} kaydın tahsilatı Mikro'da`
                            : `Credit utilization not computed: ${ozet.bekleyen.bilinmeyen} record(s) with unknown amount / ${ozet.odemeBilinmeyen} tracked in Mikro`}</p>
                        )}
                        {creditUtil !== null && (
                          <div className="apple-card px-5 py-4">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-bold text-gray-600">{mc(tr559).kredi_kullanim_orani}</p>
                              <span className={`text-xs font-bold ${creditUtil>80?'text-red-600':creditUtil>60?'text-amber-600':'text-emerald-600'}`}>{creditUtil.toFixed(1)}%</span>
                            </div>
                            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-700 ${creditUtil>80?'bg-red-500':creditUtil>60?'bg-amber-400':'bg-emerald-500'}`}
                                style={{width:`${Math.min(creditUtil,100)}%`}} />
                            </div>
                            {creditUtil > 80 && (
                              <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />{mc(tr559).kredi_limitinin_80_uzerinde}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Ledger table */}
                        <div className="apple-card p-5">
                          <h4 className="font-bold text-gray-700 text-sm mb-3">
                            {mc(tr559).hareket_ozeti} — {selCustomer}
                          </h4>
                          {ledger.length === 0 ? (
                            <div className="text-center py-10 space-y-2">
                              <Users className="w-10 h-10 text-gray-200 mx-auto" />
                              <p className="text-gray-400 text-sm">{mc(tr559).bu_musteri_icin_islem_bulunamadi}</p>
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-gray-100">
                                    {[oc(tr559).tarih,'#',oc(tr559).durum,oc(tr559).tutar,oc(tr559).odeme,oc(tr559).bakiye].map(h => (
                                      <th key={h} className="py-2 px-3 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                  {ledger.map(row => (
                                    <tr key={row.id} className="hover:bg-gray-50/50 transition-colors">
                                      <td className="px-3 py-2 text-gray-500">{tarihYaz(row.tarih)}</td>
                                      <td className="px-3 py-2 font-mono text-gray-600">{row.id.slice(0,8)}</td>
                                      <td className="px-3 py-2">
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                          row.status==='Delivered'?'bg-emerald-100 text-emerald-700':
                                          row.status==='Shipped'?'bg-blue-100 text-blue-700':
                                          row.status==='Cancelled'?'bg-gray-100 text-gray-500':
                                          'bg-amber-100 text-amber-700'
                                        }`}>{row.status}</span>
                                      </td>
                                      <td className="px-3 py-2 font-bold text-gray-800 font-mono">{paraYaz(row.totalPrice)}</td>
                                      <td className="px-3 py-2">
                                        {row.odeme === 'odendi'
                                          ? <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">✓ {oc(tr559).odendi}</span>
                                          : row.odeme === 'bekliyor'
                                            ? <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">⏳ {oc(tr559).bekliyor}</span>
                                            : <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{mc(tr559).mikro_da}</span>
                                        }
                                      </td>
                                      <td className={`px-3 py-2 font-bold font-mono ${Number.isFinite(row.bakiye) ? (row.bakiye>0?'text-amber-700':'text-emerald-700') : 'text-gray-400'}`}>
                                        {paraYaz(row.bakiye)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {(tutarsizSayisi > 0 || tarihsizSayisi > 0) && (
                                <p className="text-xs text-gray-500 mt-2">{tr559
                                  ? `${tutarsizSayisi} kaydın tutarı, ${tarihsizSayisi} kaydın tarihi bilinmiyor — bakiye o satırdan itibaren hesaplanamaz.`
                                  : `${tutarsizSayisi} record(s) with unknown amount, ${tarihsizSayisi} with unknown date — balance cannot be computed from that row on.`}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 560: Sipariş Onay Akışı (Order Approval Workflow) ────────── */}
                  {muhasebeTab === 'genel' && (() => {
                    const tr560 = currentLanguage === 'tr';
                    // Tek kaynak: onayBekleyenler — tutarı bilinmeyen Pending sipariş kapıdan sessizce geçmez, tutarsiz'e düşer
                    const { liste: approvalOrders, tutarsiz: tutarsizOnay, esikGecerli } = onayBekleyenler(orders, p560ApprovalThreshold);
                    if (approvalOrders.length === 0 && tutarsizOnay.length === 0) return null;
                    return (
                      <div className="apple-card p-5 border-l-4 border-amber-400 bg-amber-50/30">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-amber-500" />
                            <h4 className="font-bold text-amber-800 text-sm">
                              {mc(tr560).onay_bekleyen_yuksek_degerli_siparisler}
                            </h4>
                            <span className="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{approvalOrders.length + tutarsizOnay.length}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <label>{mc(tr560).limit}</label>
                            <input type="number" className="apple-input text-xs px-2 py-1 w-24" value={p560ApprovalThreshold}
                              onChange={e => setP560ApprovalThreshold(Number(e.target.value))} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          {approvalOrders.map(o => (
                            <div key={o.id} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-amber-100">
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-gray-800 text-sm">{o.customerName}</p>
                                <p className="text-xs text-gray-400">#{o.id.slice(0,8)} · {paraYaz(o.totalPrice)}</p>
                              </div>
                              {hasFullAccess('muhasebe') && (
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <button onClick={async () => {
                                    await updateDoc(doc(db, 'orders', o.id), { status: 'Processing' });
                                    toast(mc(tr560).siparis_onaylandi, 'success');
                                  }} className="text-xs font-bold text-emerald-600 bg-emerald-100 hover:bg-emerald-200 px-3 py-1.5 rounded-lg transition-colors">
                                    {oc(tr560).onayla}
                                  </button>
                                  <button onClick={async () => {
                                    await updateDoc(doc(db, 'orders', o.id), { status: 'Cancelled' });
                                    toast(mc(tr560).siparis_reddedildi, 'error');
                                  }} className="text-xs font-bold text-red-600 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg transition-colors">
                                    {oc(tr560).reddet}
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                          {tutarsizOnay.map(o => (
                            <div key={o.id} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-gray-200">
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-gray-800 text-sm">{o.customerName}</p>
                                <p className="text-xs text-gray-400">#{o.id.slice(0,8)} · — <span className="text-amber-700 font-semibold">{mc(tr560).tutar_bilinmiyor_elle_incele}</span></p>
                              </div>
                            </div>
                          ))}
                        </div>
                        {!esikGecerli && (
                          <p className="text-xs text-red-600 mt-2">{mc(tr560).esik_gecersiz_onay_listesi_hesaplanmadi}</p>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── Phase 564: e-Fatura Takip ─────────────────────────────────────── */}
                  {muhasebeTab === 'fatura-takip' && (() => {
                    const tr564 = currentLanguage === 'tr';
                    const allBillable = orders.filter(o => o.status !== 'Cancelled');
                    const filtered564 = allBillable.filter(o => {
                      if (p564FaturaFilter === 'missing') return !o.hasInvoice && !o.mikroFaturaNo && !o.lucaFaturaNo;
                      if (p564FaturaFilter === 'synced') return o.mikroSynced || o.lucaSynced;
                      if (p564FaturaFilter === 'pending') return o.hasInvoice && !o.mikroSynced && !o.lucaSynced;
                      return true;
                    });
                    const missingCount = allBillable.filter(o => !o.hasInvoice && !o.mikroFaturaNo && !o.lucaFaturaNo).length;
                    const syncedCount = allBillable.filter(o => o.mikroSynced || o.lucaSynced).length;
                    const pendingCount = allBillable.filter(o => o.hasInvoice && !o.mikroSynced && !o.lucaSynced).length;

                    return (
                      <motion.div key="fatura-takip" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-4">
                        <ModuleHeader
                          title={mc(tr564).e_fatura_takip_paneli}
                          subtitle={mc(tr564).siparislerin_fatura_durumunu_ve_erp_senkronizasy}
                          icon={FileText}
                        />

                        {/* Mikro faturaları özeti — panel altta yalnız Cetpa siparişi
                            izliyor (boş). Kullanıcı: "Mikro'da girişini yapmadığım gelen
                            faturalar var (Metro vb.)". Mikro giden/gelen faturaları burada. */}
                        {mikroFaturalar.length > 0 && (() => {
                          const giden564 = mikroFaturalar.filter(f => f.yon === 'giden');
                          const gelen564 = mikroFaturalar.filter(f => f.yon === 'gelen');
                          const buAy564 = bugunAnahtari().slice(0, 7); // yerel YYYY-MM
                          const gelenBuAy564 = gelen564.filter(f => f.tarih.startsWith(buAy564));
                          return (
                            <div className="apple-card p-4 space-y-3">
                              <h4 className="font-bold text-sm text-gray-800">{mc(tr564).mikro_faturalari}</h4>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {[
                                  { label: mc(tr564).toplam_fatura_2, val: mikroFaturalar.length, color:'text-gray-700', bg:'bg-gray-50' },
                                  { label: mc(tr564).giden_satis, val: giden564.length, color:'text-blue-700', bg:'bg-blue-50' },
                                  { label: mc(tr564).gelen_alis, val: gelen564.length, color:'text-emerald-700', bg:'bg-emerald-50' },
                                  { label: mc(tr564).gelen_bu_ay, val: gelenBuAy564.length, color:'text-amber-700', bg:'bg-amber-50' },
                                ].map(k => (
                                  <div key={k.label} className={`rounded-xl p-3 ${k.bg}`}>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">{k.label}</p>
                                    <p className={`text-2xl font-black ${k.color}`}>{k.val}</p>
                                  </div>
                                ))}
                              </div>
                              {gelen564.length > 0 && (
                                <div className="overflow-x-auto">
                                  <p className="text-[11px] font-semibold text-gray-500 mb-1">{mc(tr564).son_gelen_alis_faturalari}</p>
                                  <table className="w-full text-xs">
                                    <thead><tr className="bg-gray-50 border-b border-gray-100">
                                      {[oc(tr564).tarih, mc(tr564).cari, mc(tr564).fatura_no, oc(tr564).tutar].map(h=>(
                                        <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                      ))}
                                    </tr></thead>
                                    <tbody className="divide-y divide-gray-50">
                                      {gelen564.slice(0, 20).map(f => (
                                        <tr key={f.id}>
                                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{f.tarih}</td>
                                          <td className="px-3 py-2 text-gray-700">{cariAdMap.get(f.cariKod) || f.cariKod}</td>
                                          <td className="px-3 py-2 text-gray-500">{f.faturaNo}</td>
                                          <td className="px-3 py-2 text-right font-bold tabular-nums whitespace-nowrap">{paraYaz(f.tutar, { ondalik: 0 })}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* KPI strip */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: oc(tr564).toplam_siparis,  val: allBillable.length, color:'text-gray-700', bg:'bg-gray-50' },
                            { label: mc(tr564).fatura_eksik, val: missingCount, color: missingCount>0?'text-red-600':'text-emerald-600', bg: missingCount>0?'bg-red-50':'bg-emerald-50' },
                            { label: mc(tr564).fatura_bekliyor, val: pendingCount, color:'text-amber-700', bg:'bg-amber-50' },
                            { label: mc(tr564).erp_senkron, val: syncedCount, color:'text-emerald-700', bg:'bg-emerald-50' },
                          ].map(k => (
                            <div key={k.label} className={`apple-card p-4 ${k.bg}`}>
                              <p className="text-[10px] font-bold text-gray-400">{k.label}</p>
                              <p className={`text-2xl font-black mt-1 ${k.color}`}>{k.val}</p>
                            </div>
                          ))}
                        </div>

                        {/* Filter tabs */}
                        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
                          {([
                            { id: 'missing', label: mc(tr564).fatura_eksik_2, count: missingCount },
                            { id: 'pending', label: oc(tr564).bekliyor, count: pendingCount },
                            { id: 'synced',  label: mc(tr564).senkron, count: syncedCount },
                            { id: 'all',     label: oc(tr564).tumu, count: allBillable.length },
                          ] as const).map(f => (
                            <button key={f.id} onClick={() => setP564FaturaFilter(f.id)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${p564FaturaFilter===f.id?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
                              {f.label}
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${p564FaturaFilter===f.id?'bg-gray-100 text-gray-600':'bg-gray-200 text-gray-500'}`}>{f.count}</span>
                            </button>
                          ))}
                        </div>

                        {/* Order table */}
                        <div className="apple-card overflow-hidden">
                          {filtered564.length === 0 ? (
                            <div className="text-center py-12 space-y-2">
                              <FileText className="w-10 h-10 text-gray-200 mx-auto" />
                              <p className="text-gray-400 text-sm">{mc(tr564).bu_filtreyle_siparis_bulunamadi}</p>
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-gray-50 border-b border-gray-100">
                                    {[oc(tr564).tarih, oc(tr564).musteri, oc(tr564).tutar,
                                      oc(tr564).fatura_tipi, oc(tr564).fatura_no,
                                      oc(tr564).erp_durumu, ''].map(h => (
                                      <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase whitespace-nowrap">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                  {filtered564.slice(0,50).map(o => {
                                    const invoiceNo = o.mikroFaturaNo || o.lucaFaturaNo || o.irsaliyeNo || '—';
                                    const isSynced = o.mikroSynced || o.lucaSynced;
                                    const hasFatura = o.hasInvoice || !!o.mikroFaturaNo || !!o.lucaFaturaNo;
                                    const dateStr = tarihYaz(o.createdAt ?? o.syncedAt);
                                    return (
                                      <tr key={o.id} onClick={() => setP564DetayId(o.id)} className={`hover:bg-gray-50/50 transition-colors cursor-pointer ${!hasFatura?'bg-red-50/20':''}`}>
                                        <td className="px-3 py-2.5 text-gray-400">{dateStr}</td>
                                        <td className="px-3 py-2.5 font-semibold text-gray-800 max-w-[150px] truncate">{o.customerName}</td>
                                        <td className="px-3 py-2.5 font-mono text-gray-700">{paraYaz(o.totalPrice)}</td>
                                        <td className="px-3 py-2.5">
                                          {o.faturaTipi ? (
                                            <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{faturaTipiEtiketi(o.faturaTipi, currentLanguage)}</span>
                                          ) : (
                                            <span className="text-[10px] text-gray-400">—</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2.5 font-mono text-gray-500">{invoiceNo}</td>
                                        <td className="px-3 py-2.5">
                                          {isSynced ? (
                                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">✓ {o.lucaSynced?'Luca':o.mikroSynced?'Mikro':'Sync'}</span>
                                          ) : hasFatura ? (
                                            <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">⏳ {oc(tr564).bekliyor}</span>
                                          ) : (
                                            <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">✗ {oc(tr564).fatura_yok}</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2.5">
                                          {!hasFatura && hasFullAccess('muhasebe') && (
                                            <button onClick={async (e) => {
                                              e.stopPropagation();
                                              await updateDoc(doc(db, 'orders', o.id), { hasInvoice: true });
                                              toast(mc(tr564).fatura_kesildi_olarak_isaretlendi, 'success');
                                            }} className="text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors">
                                              {mc(tr564).faturalandi}
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>

                        {p564DetayId && (() => {
                          const d = orders.find(o => o.id === p564DetayId);
                          if (!d) return null;
                          const dInvoiceNo = d.mikroFaturaNo || d.lucaFaturaNo || d.irsaliyeNo || '—';
                          const dSynced = d.mikroSynced || d.lucaSynced;
                          const satir564 = (etiket: string, deger: React.ReactNode) => (
                            <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                              <span className="text-xs text-gray-500">{etiket}</span>
                              <span className="text-sm font-semibold text-[#1D1D1F] text-right">{deger}</span>
                            </div>
                          );
                          return (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setP564DetayId(null)}>
                              <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                                <div className="flex items-start justify-between p-5 border-b border-gray-100">
                                  <div>
                                    <h3 className="font-bold text-[#1D1D1F]">{mc(tr564).fatura_siparis_detayi}</h3>
                                    <p className="text-xs text-gray-500 mt-0.5 font-mono">{d.id}</p>
                                  </div>
                                  <button onClick={() => setP564DetayId(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-[18px] h-[18px]" /></button>
                                </div>
                                <div className="p-5 overflow-y-auto flex-1 min-h-0">
                                  {satir564(oc(tr564).musteri, d.customerName)}
                                  {d.customerEmail && satir564(oc(tr564).e_posta, d.customerEmail)}
                                  {d.shippingAddress && satir564(oc(tr564).adres, <span className="font-normal text-xs">{d.shippingAddress}</span>)}
                                  {satir564(oc(tr564).tutar, paraYaz(d.totalPrice))}
                                  {typeof d.kdvOran === 'number' && satir564('KDV', `%${d.kdvOran}${d.kdvTutari ? ` · ${paraYaz(d.kdvTutari)}` : ''}`)}
                                  {d.faturaTipi && satir564(oc(tr564).fatura_turu, faturaTipiEtiketi(d.faturaTipi, currentLanguage))}
                                  {satir564(oc(tr564).fatura_no, dInvoiceNo)}
                                  {d.ettn && satir564('ETTN', <span className="font-mono text-[11px]">{d.ettn}</span>)}
                                  {d.irsaliyeNo && satir564(mc(tr564).irsaliye_no, d.irsaliyeNo)}
                                  {satir564(oc(tr564).erp_durumu, dSynced
                                    ? <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">✓ {d.lucaSynced?'Luca':'Mikro'}</span>
                                    : (d.hasInvoice || d.mikroFaturaNo || d.lucaFaturaNo)
                                      ? <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">⏳ {oc(tr564).bekliyor}</span>
                                      : <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">✗ {oc(tr564).fatura_yok}</span>)}
                                  {satir564(oc(tr564).siparis_durumu, d.status)}
                                  {d.notes && satir564(oc(tr564).not, <span className="font-normal text-xs">{d.notes}</span>)}
                                  {!!d.lineItems?.length && (
                                    <div className="mt-3">
                                      <p className="text-xs font-bold text-gray-500 mb-1.5">{oc(tr564).kalemler} · {d.lineItems.length}</p>
                                      <div className="space-y-1">
                                        {d.lineItems.map((li, i) => (
                                          <div key={li.id || i} className="flex items-center justify-between text-xs text-gray-600 py-1 border-b border-gray-50 last:border-0">
                                            <span>{li.name} {li.quantity ? `× ${li.quantity}` : ''}</span>
                                            <span className="font-semibold tabular-nums">{paraYaz(satirTutari(li.price, li.quantity))}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 630: Fatura Yaşlandırma Analizi ───────────────────────── */}
                  {muhasebeTab === 'fatura-takip' && orders.length > 0 && (() => {
                    const tr630 = currentLanguage === 'tr';
                    const daysMap630:{[k:string]:number} = {'7d':7,'30d':30,'60d':60,'90d':90};
                    const maxDays = daysMap630[p630InvoicePeriod];
                    // Süzgeç + kova + tutar tek kaynakta (faturaTakipTahmin.faturaYaslandirma):
                    // !paid, iptal değil, odemeTakipli (mikro-fatura türevinde `paid` YOK — "ödenmemiş" sayılamaz),
                    // tarih createdAt ?? syncedAt (Phase 131 ile aynı), gün yaşı yerel gün farkı, gün <= dönem.
                    // Tutarı bilinmeyen kayıt kova ADEDİNE girer (gecikme gerçektir), toplama girmez — ekranda para.ts
                    // ekranTutari/kovaTutari sözleşmesi: hiç bilinen yokken '—', kısmi bilinmeyen kısmi toplam + not.
                    const y630 = faturaYaslandirma(orders, { donemGun: maxDays });
                    const buckets: { kova: KovaAdi; label: string; color: string; bg: string }[] = [
                      { kova: 'b0_30',  label: mc(tr630)._0_30_gun,  color:'text-emerald-600', bg:'bg-emerald-50' },
                      { kova: 'b31_60', label: mc(tr630)._31_60_gun, color:'text-amber-600',   bg:'bg-amber-50' },
                      { kova: 'b61_90', label: mc(tr630)._61_90_gun, color:'text-orange-600',  bg:'bg-orange-50' },
                      { kova: 'b90p',   label: mc(tr630)._90_gun,     color:'text-red-600',     bg:'bg-red-50' },
                    ];
                    if (y630.adet === 0 && y630.tarihsiz === 0) return null;
                    return (
                      <div className="apple-card p-5 space-y-4 mt-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">📋 {mc(tr630).fatura_yaslandirma}</h3>
                          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                            {([{k:'7d',l:'7d'},{k:'30d',l:'30d'},{k:'60d',l:'60d'},{k:'90d',l:'90d'}] as {k:'7d'|'30d'|'60d'|'90d';l:string}[]).map(t=>(
                              <button key={t.k} onClick={()=>setP630InvoicePeriod(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p630InvoicePeriod===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {buckets.map(b=>(
                            <div key={b.label} className={`rounded-xl p-3 ${b.bg}`}>
                              <p className="text-[10px] font-bold text-gray-400 uppercase">{b.label}</p>
                              <p className={`text-xl font-black ${b.color}`}>{y630.kovaAdet[b.kova]}</p>
                              <p className="text-xs text-gray-500">{paraYaz(kovaTutari(y630, b.kova), { ondalik: 0 })}{y630.kovaBilinmeyen[b.kova] > 0 && <span className="ml-1 text-[10px] text-amber-600">({y630.kovaBilinmeyen[b.kova]} {mc(tr630).kayit_tutarsiz})</span>}</p>
                            </div>
                          ))}
                        </div>
                        <div className="text-xs text-gray-500">{mc(tr630).toplam_bekleyen} <span className="font-bold text-red-600">{paraYaz(ekranTutari(y630), { ondalik: 0 })}</span> ({y630.adet} {oc(tr630).siparis}){y630.bilinmeyen > 0 && <span className="ml-2 text-amber-600">· {y630.bilinmeyen} {mc(tr630).kayit_tutarsiz}</span>}{y630.tarihsiz > 0 && <span className="ml-2 text-gray-400">· {y630.tarihsiz} {mc(tr630).tarihsiz}</span>}</div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 565: Satış Tahmini (Sales Forecast) ─────────────────────── */}
                  {muhasebeTab === 'pnl' && (() => {
                    const tr565 = currentLanguage === 'tr';
                    // 6 ay geçmiş + ağırlıklı hareketli ortalama + eğim + ±%15 bant tek kaynakta
                    // (faturaTakipTahmin.satisTahmini). Tarih createdAt ?? syncedAt (Phase 131/630 ile aynı);
                    // tarihi çözülemeyen sipariş t565.tarihsiz, tutarı bilinmeyen t565.bilinmeyen — 0 sayılmaz.
                    // Çubuklar bilinen toplamla çizilir (alt sınır); tahmin rakamı tahminTutari → para.ts ekranTutari
                    // sözleşmesi: pencerede hiç bilinen ciro yokken '—', kısmi bilinmeyen tahmin + not (aşağıda).
                    const t565 = satisTahmini(orders);
                    const ayEtiketi = (d: Date) => d.toLocaleString(tr565?'tr-TR':'en-US', {month:'short', year:'2-digit'});
                    const hist = t565.gecmis.map(a => a.toplam);
                    const histLabels = t565.gecmis.map(a => ayEtiketi(a.ay));
                    const forecast = t565.tahmin.map(f => ({ label: ayEtiketi(f.ay), value: f.deger, low: f.alt, high: f.ust }));
                    const allValues = [...hist, ...forecast.map(f => f.high)].filter(v => v > 0);
                    const maxV = Math.max(...allValues, 1);

                    return (
                      <div className="apple-card p-5 mt-4">
                        <div className="flex items-center gap-2 mb-4">
                          <TrendingUp className="w-4 h-4 text-emerald-500" />
                          <h4 className="font-bold text-gray-800 text-sm">{mc(tr565).satis_tahmini_agirlikli_hareketli_ortalama}</h4>
                        </div>

                        {/* Combined chart: history + forecast */}
                        <div className="flex items-end gap-1" style={{height:'100px'}}>
                          {hist.map((v, i) => (
                            <div key={`h${i}`} className="flex-1 flex flex-col items-center gap-0.5">
                              <div className="w-full bg-blue-100 rounded-t" style={{height:`${(v/maxV)*90}px`, minHeight: v>0?'2px':'0'}} />
                              <span className="text-[8px] text-gray-400 rotate-0 whitespace-nowrap">{histLabels[i]}</span>
                            </div>
                          ))}
                          <div className="w-px bg-gray-300 self-stretch mx-1" />
                          {forecast.map((f, i) => (
                            <div key={`f${i}`} className="flex-1 flex flex-col items-center gap-0.5 relative">
                              {/* High band */}
                              <div className="w-full bg-emerald-100 rounded-t relative" style={{height:`${(f.high/maxV)*90}px`}}>
                                <div className="absolute bottom-0 left-0 right-0 bg-emerald-400 rounded-t" style={{height:`${(f.value/f.high)*100}%`}} />
                              </div>
                              <span className="text-[8px] text-emerald-600 font-bold">{f.label}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-100 inline-block" />{oc(tr565).gerceklesen}</span>
                          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-emerald-400 inline-block" />{mc(tr565).tahmin}</span>
                          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-emerald-100 inline-block" />{mc(tr565)._15_aralik}</span>
                        </div>

                        {/* Forecast table */}
                        <div className="mt-4 space-y-2">
                          {forecast.map(f => (
                            <div key={f.label} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                              <span className="text-sm font-semibold text-gray-700">{f.label}</span>
                              <div className="flex items-center gap-4 text-xs">
                                <span className="text-gray-400">{fmtKpi(tahminTutari(t565, f.low),'K',0)} – {fmtKpi(tahminTutari(t565, f.high),'K',0)}</span>
                                <span className="font-bold text-emerald-700">{fmtKpi(tahminTutari(t565, f.value),'K',0)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-2">* {mc(tr565)._6_aylik_gecmis_veriye_dayali_agirlikli_hareketl}{t565.bilinmeyen > 0 && ` · ${t565.bilinmeyen} ${t565.bilinen > 0 ? (mc(tr565).siparis_tutarsiz_tahmin_eksik_ciroyla_hesaplandi) : (mc(tr565).siparis_tutarsiz_tahmin_hesaplanamadi)}`}{t565.tarihsiz > 0 && ` · ${t565.tarihsiz} ${mc(tr565).tarihsiz_siparis_sayilmadi}`}</p>
                      </div>
                    );
                  })()}

                  {/* ── Phase 566: Kar Merkezi Raporu (Profit Center) ─────────────────── */}
                  {muhasebeTab === 'pnl' && (() => {
                    const tr566 = currentLanguage === 'tr';
                    // Kanal bazlı gelir/COGS/marj tek kaynakta (faturaTakipTahmin.karMerkezleri):
                    // customerType || 'Diğer', iptal hariç, gelire göre azalan. Tutarı bilinmeyen sipariş
                    // gelire ₺0 girmez (sayılır); maliyeti/miktarı bilinmeyen kalem COGS'a ₺0 girmez (eskiden %100 marj).
                    // Ekran para.ts ekranTutari (TEK sözleşme): hiç bilinen yokken '—', kısmi bilinmeyen kısmi tutar + not;
                    // brüt kâr/marj modülde aynı sözleşmeyle (bir taraf tümüyle bilinmiyorsa NaN/null).
                    const pcList = karMerkezleri(orders, oc(tr566).diger);
                    if (pcList.length === 0) return null;

                    return (
                      <div className="apple-card p-5 mt-4">
                        <div className="flex items-center gap-2 mb-4">
                          <BarChart3 className="w-4 h-4 text-purple-500" />
                          <h4 className="font-bold text-gray-800 text-sm">{mc(tr566).kar_merkezi_raporu}</h4>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-gray-100">
                                {[mc(tr566).kanal, oc(tr566).siparis_2, oc(tr566).gelir,
                                  'COGS', oc(tr566).brut_kar, oc(tr566).marj].map(h => (
                                  <th key={h} className="py-2 px-3 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {pcList.map(pc => {
                                const gelir566 = ekranTutari(pc.gelir), smm566 = ekranTutari(pc.maliyet);
                                return (
                                <tr key={pc.ad} className="hover:bg-gray-50/50">
                                  <td className="px-3 py-2.5 font-semibold text-gray-800">
                                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${pc.ad==='B2B'?'bg-blue-100 text-blue-700':'bg-purple-100 text-purple-700'}`}>
                                      {pc.ad === 'B2B' ? '🏢' : '🛒'} {pc.ad}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5 text-gray-500">{pc.adet}</td>
                                  <td className="px-3 py-2.5 font-bold text-gray-800 font-mono">{fmtKpi(gelir566,'K',0)}{pc.gelir.bilinmeyen > 0 && <span className="ml-1 text-[10px] text-amber-600">({pc.gelir.bilinmeyen} {mc(tr566).tutarsiz_3})</span>}</td>
                                  <td className="px-3 py-2.5 text-red-500 font-mono">{Number.isFinite(smm566) ? '−' : ''}{fmtKpi(smm566,'K',0)}{pc.maliyet.bilinmeyen > 0 && <span className="ml-1 text-[10px] text-amber-600">({pc.maliyet.bilinmeyen} {mc(tr566).kalem_maliyetsiz})</span>}</td>
                                  <td className="px-3 py-2.5 font-bold text-emerald-700 font-mono">{fmtKpi(pc.brutKar,'K',0)}</td>
                                  <td className="px-3 py-2.5">
                                    {pc.marj === null ? (
                                      <span className="font-bold text-gray-400">—</span>
                                    ) : (<>
                                      <span className={`font-bold ${pc.marj>=30?'text-emerald-600':pc.marj>=15?'text-amber-600':'text-red-500'}`}>%{pc.marj.toFixed(1)}</span>
                                      <div className="w-16 h-1.5 bg-gray-100 rounded-full mt-0.5 overflow-hidden">
                                        <div className={`h-full rounded-full ${pc.marj>=30?'bg-emerald-400':pc.marj>=15?'bg-amber-400':'bg-red-400'}`} style={{width:`${Math.min(pc.marj,100)}%`}} />
                                      </div>
                                    </>)}
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

                  {/* ── Phase 573: Dinamik Fiyatlandırma Kuralları ─────────────────────── */}
                  {muhasebeTab === 'fiyat-kural' && (() => {
                    const tr573 = currentLanguage === 'tr';
                    const typeLabels573: Record<string, string> = {
                      'bulk': mc(tr573).toplu_alim_indirimi,
                      'customer-tier': mc(tr573).musteri_segmenti,
                      'promo': mc(tr573).promosyon,
                    };
                    const typeColors573: Record<string, string> = {
                      'bulk': 'bg-blue-100 text-blue-700',
                      'customer-tier': 'bg-purple-100 text-purple-700',
                      'promo': 'bg-amber-100 text-amber-700',
                    };
                    const addRule573 = async () => {
                      if (!p573Draft.name || !p573Draft.discountPct) return;
                      const payload = {
                        name: p573Draft.name,
                        type: p573Draft.type,
                        minQty: p573Draft.minQty ? Number(p573Draft.minQty) : 0,
                        tierName: p573Draft.tierName || '',
                        discountPct: Number(p573Draft.discountPct),
                      };
                      try {
                        if (p573EditId) { await updateDoc(doc(db,'pricingRules',p573EditId), payload); }
                        else { await addDoc(collection(db,'pricingRules'), { ...payload, active: true, createdAt: serverTimestamp() }); }
                        setP573Draft({ name: '', type: 'bulk', minQty: '', tierName: '', discountPct: '', active: true });
                        setP573ShowForm(false); setP573EditId(null);
                      } catch(e){ toast((oc(currentLanguage).kaydedilemedi)+(e instanceof Error?e.message:String(e)),'error'); }
                    };
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={mc(tr573).fiyatlandirma_kurallari}
                          subtitle={mc(tr573).toplu_alim_segment_ve_promosyon_kurallarini_yone}
                          icon={Tag}
                          actionButton={hasFullAccess('muhasebe') && (
                            <button onClick={()=>setP573ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm">
                              <Plus className="w-4 h-4"/>{oc(tr573).kural_ekle}
                            </button>
                          )} />

                        {p573ShowForm && (
                          <div className="apple-card p-5 space-y-4">
                            <h4 className="font-bold text-gray-800 text-sm">{mc(tr573).yeni_fiyat_kurali}</h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              <input className="apple-input px-3 py-2 text-sm" placeholder={oc(tr573).kural_adi} value={p573Draft.name} onChange={e=>setP573Draft(d=>({...d,name:e.target.value}))} />
                              <select className="apple-input px-3 py-2 text-sm" value={p573Draft.type} onChange={e=>setP573Draft(d=>({...d,type:e.target.value as typeof d.type}))}>
                                <option value="bulk">{typeLabels573['bulk']}</option>
                                <option value="customer-tier">{typeLabels573['customer-tier']}</option>
                                <option value="promo">{typeLabels573['promo']}</option>
                              </select>
                              <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={mc(tr573).indirim_or_10} value={p573Draft.discountPct} onChange={e=>setP573Draft(d=>({...d,discountPct:e.target.value}))} />
                              {p573Draft.type==='bulk' && <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={mc(tr573).min_adet} value={p573Draft.minQty} onChange={e=>setP573Draft(d=>({...d,minQty:e.target.value}))} />}
                              {p573Draft.type==='customer-tier' && <input className="apple-input px-3 py-2 text-sm" placeholder={mc(tr573).segment_b2b_bayi} value={p573Draft.tierName} onChange={e=>setP573Draft(d=>({...d,tierName:e.target.value}))} />}
                            </div>
                            <div className="flex gap-2">
                              <button onClick={addRule573} className="apple-button-primary text-sm px-4 py-1.5">{oc(tr573).kaydet}</button>
                              <button onClick={()=>setP573ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{oc(tr573).iptal}</button>
                            </div>
                          </div>
                        )}

                        {p573Rules.length === 0 ? (
                          <div className="apple-card p-12 text-center">
                            <Tag className="w-12 h-12 text-gray-200 mx-auto mb-3"/>
                            <p className="text-gray-400 text-sm">{mc(tr573).henuz_fiyat_kurali_eklenmemis}</p>
                            <p className="text-gray-300 text-xs mt-1">{mc(tr573).kural_ekle_ile_toplu_alim_segment_veya_promosyon}</p>
                          </div>
                        ) : (
                          <div className="apple-card overflow-hidden"><div className="overflow-x-auto">
                            <table className="w-full text-sm min-w-[560px]">
                              <thead><tr className="border-b border-gray-100 bg-gray-50">
                                {[oc(tr573).kural_adi, oc(tr573).tur, mc(tr573).indirim, mc(tr573).kosul, oc(tr573).durum, ''].map(h=>(
                                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                ))}
                              </tr></thead>
                              <tbody className="divide-y divide-gray-50">
                                {p573Rules.map(r=>(
                                  <tr key={r.id} className={`hover:bg-gray-50/50 ${!r.active?'opacity-40':''}`}>
                                    <td className="px-4 py-3 font-semibold text-gray-800">{r.name}</td>
                                    <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeColors573[r.type]}`}>{typeLabels573[r.type]}</span></td>
                                    <td className="px-4 py-3 text-emerald-700 font-bold">%{r.discountPct}</td>
                                    <td className="px-4 py-3 text-gray-500 text-xs">{r.type==='bulk'&&r.minQty?`Min ${r.minQty} ${oc(tr573).adet}`:r.type==='customer-tier'&&r.tierName?r.tierName:oc(tr573).genel}</td>
                                    <td className="px-4 py-3">
                                      <button onClick={async ()=>{try{await updateDoc(doc(db,'pricingRules',r.id),{active:!r.active});}catch(e){toast((oc(tr573).guncellenemedi)+(e instanceof Error?e.message:String(e)),'error');}}}
                                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.active?'bg-green-100 text-green-700':'bg-gray-100 text-gray-500'}`}>
                                        {r.active?(oc(tr573).aktif):(oc(tr573).pasif)}
                                      </button>
                                    </td>
                                    <td className="px-4 py-3">
                                      <button onClick={()=>{setP573Draft({name:r.name,type:r.type,minQty:r.minQty?String(r.minQty):'',tierName:r.tierName||'',discountPct:String(r.discountPct),active:r.active});setP573EditId(r.id);setP573ShowForm(true);}} className="text-blue-400 hover:text-blue-600 text-xs mr-2">{oc(tr573).duzenle}</button>
                                      <button onClick={async ()=>{try{await deleteDoc(doc(db,'pricingRules',r.id));}catch(e){toast((oc(tr573).silinemedi)+(e instanceof Error?e.message:String(e)),'error');}}} className="text-red-400 hover:text-red-600 text-xs">{oc(tr573).sil}</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table></div>
                            {p573Rules.filter(r=>r.active).length > 0 && (
                              <div className="px-4 py-3 bg-emerald-50 border-t border-emerald-100">
                                <p className="text-xs text-emerald-700 font-semibold">{p573Rules.filter(r=>r.active).length} {mc(tr573).aktif_kural_toplam_etkin_indirim} %{p573Rules.filter(r=>r.active).reduce((s,r)=>s+r.discountPct,0).toFixed(0)}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 580: Bütçe vs Gerçekleşen ───────────────────────────────── */}
                  {muhasebeTab === 'butce-gercek' && (() => {
                    const tr580 = currentLanguage === 'tr';
                    const year580 = Number(p580Year);
                    const months580 = Array.from({length:12},(_,i)=>i);
                    const monthLabels = tr580
                      ? ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']
                      : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    // Hesap tek kaynakta (utils/muhasebe/butceVaryans.butceGercekYili): native faturasız
                    // sipariş + Mikro giden fatura (ayKarZarar) vs allBudgetsFirestore[yyyy-MM] aylık bütçe.
                    // Bilinmeyen tutar 0 DEĞİL — toplama girmez, sayılır; ekranda '—' + "N kayıt tutarsız".
                    const ozet580 = butceGercekYili(orders, mikroFaturalar, allBudgetsFirestore, year580);
                    const hasBudget580 = ozet580.butceVar;
                    const overallPct = ozet580.oran;   // number | null — bütçe yok ya da bilinmeyen kayıt varsa null (eski kod "%0" basıyordu)
                    const tutarsiz580 = (n: number) => `${n} ${mc(tr580).kayit_tutarsiz}`;
                    const now580 = new Date();
                    const currentMonth = year580 === now580.getFullYear() ? now580.getMonth() : 11;
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <div className="flex items-center justify-between">
                          <ModuleHeader title={mc(tr580).butce_vs_gerceklesen} subtitle={mc(tr580).aylik_butce_hedeflerine_karsi_gerceklesen_gelir} icon={BarChart3} />
                          <select className="apple-input px-3 py-2 text-sm w-28" value={p580Year} onChange={e=>setP580Year(e.target.value)}>
                            {[String(now580.getFullYear()-1), String(now580.getFullYear()), String(now580.getFullYear()+1)].map(y=><option key={y}>{y}</option>)}
                          </select>
                        </div>
                        {!hasBudget580 && (
                          <div className="apple-card p-3 bg-amber-50 border border-amber-200 text-[12px] text-amber-700 flex items-center gap-2">
                            <span>ℹ</span>
                            <span>{tr580 ? `${year580} için bütçe tanımlanmamış. Muhasebe → Bütçe & Senaryo'dan aylık bütçe girince burada karşılaştırılır.` : `No budget defined for ${year580}. Add monthly budgets under Accounting → Budget & Scenario.`}</span>
                          </div>
                        )}
                        {/* Summary KPIs */}
                        <div className="grid grid-cols-3 gap-4">
                          {[
                            {label:oc(tr580).butce, val:fmtKpi(ekranTutari(ozet580.toplamButce),'K',1), color:'text-blue-600', bg:'bg-blue-50', not: ozet580.toplamButce.bilinmeyen > 0 ? `${ozet580.toplamButce.bilinmeyen} ${mc(tr580).butce_kalemi_okunamiyor}` : null},
                            {label:oc(tr580).gerceklesen, val:fmtKpi(ekranTutari(ozet580.toplamGerceklesen),'K',1), color:'text-emerald-600', bg:'bg-emerald-50', not: ozet580.toplamGerceklesen.bilinmeyen > 0 ? tutarsiz580(ozet580.toplamGerceklesen.bilinmeyen) : null},
                            {label:mc(tr580).gerceklesme, val:overallPct === null ? '—' : overallPct.toFixed(1)+'%', color:overallPct === null ? 'text-gray-400' : overallPct>=90?'text-emerald-700':overallPct>=70?'text-amber-600':'text-red-600', bg:overallPct === null ? 'bg-gray-50' : overallPct>=90?'bg-emerald-50':overallPct>=70?'bg-amber-50':'bg-red-50', not: null},
                          ].map(k=>(
                            <div key={k.label} className={`apple-card flex items-center gap-3 p-4 ${k.bg}`}>
                              <div><p className="text-xs text-gray-500">{k.label}</p><p className={`text-xl font-bold ${k.color}`}>{k.val}</p>{k.not && <p className="text-[10px] text-amber-600">{k.not}</p>}</div>
                            </div>
                          ))}
                        </div>
                        {/* Monthly bar breakdown */}
                        <div className="apple-card p-5">
                          <h4 className="text-sm font-bold text-gray-800 mb-4">{mc(tr580).aylik_karsilastirma}</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead><tr className="border-b border-gray-100">
                                {[oc(tr580).ay, oc(tr580).butce, oc(tr580).gerceklesen, oc(tr580).fark, mc(tr580).gerceklesme_2].map(h=>(
                                  <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                ))}
                              </tr></thead>
                              <tbody className="divide-y divide-gray-50">
                                {months580.map(m=>{
                                  const satir = ozet580.aylar[m];
                                  const bud = ekranTutari(satir.butce), act = ekranTutari(satir.gerceklesen);   // kısmi toplam (+ * notu); hiç bilinen yoksa NaN → '—'
                                  const diff = satir.fark, pct = satir.oran;   // ikisi de number | null (bilinmeyen kayıt ya da bütçesiz ay)
                                  const isFuture = m > currentMonth && year580 === now580.getFullYear();
                                  const tutarsizNot = satir.gerceklesen.bilinmeyen > 0 ? tutarsiz580(satir.gerceklesen.bilinmeyen) : undefined;
                                  const butceNot = satir.butce.bilinmeyen > 0 ? `${satir.butce.bilinmeyen} ${mc(tr580).butce_kalemi_okunamiyor}` : undefined;
                                  return (
                                    <tr key={m} className={`hover:bg-gray-50/50 ${isFuture?'opacity-40':''}`}>
                                      <td className="px-3 py-2.5 font-semibold text-gray-800">{monthLabels[m]}</td>
                                      <td className="px-3 py-2.5 text-gray-500 font-mono" title={butceNot}>{fmtKpi(bud,'K',0)}{butceNot && <span className="text-amber-600"> *</span>}</td>
                                      <td className="px-3 py-2.5 font-bold font-mono text-gray-800" title={tutarsizNot}>{fmtKpi(act,'K',0)}{tutarsizNot && <span className="text-amber-600"> *</span>}</td>
                                      <td className="px-3 py-2.5">
                                        {!isFuture && (diff === null ? <span className="text-gray-400">—</span> : <span className={`font-bold font-mono ${diff>=0?'text-emerald-600':'text-red-500'}`}>{diff>=0?'+':''}{fmtKpi(diff,'K',0)}</span>)}
                                      </td>
                                      <td className="px-3 py-2.5">
                                        {!isFuture && (pct === null ? <span className="text-[10px] font-bold text-gray-400">—</span> : (
                                          <div className="flex items-center gap-2">
                                            <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                              <div className={`h-full rounded-full ${pct>=90?'bg-emerald-400':pct>=70?'bg-amber-400':'bg-red-400'}`} style={{width:`${Math.min(pct,100)}%`}} />
                                            </div>
                                            <span className={`text-[10px] font-bold ${pct>=90?'text-emerald-700':pct>=70?'text-amber-600':'text-red-500'}`}>{pct.toFixed(0)}%</span>
                                          </div>
                                        ))}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-3">* {mc(tr580).butce_kpi_hedef_takibi_sayfasindaki_aylik_gelir_}</p>
                          {ozet580.butceliAyAdedi < 12 && <p className="text-[10px] text-gray-400 mt-1">{tr580 ? `Fark ve gerçekleşme yalnız bütçesi girilen ${ozet580.butceliAyAdedi} ay için hesaplanır; bütçesiz ay '—'.` : `Variance and achievement cover only the ${ozet580.butceliAyAdedi} budgeted months; unbudgeted months show '—'.`}</p>}
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 591: Otomatik Fatura Takvimi ─────────────────────────── */}
                  {muhasebeTab === 'oto-fatura' && (() => {
                    const tr591 = currentLanguage === 'tr';
                    const freqLabels591: Record<string,string> = {'monthly':oc(tr591).aylik,'quarterly':oc(tr591)._3_aylik,'yearly':oc(tr591).yillik};
                    const getNextDate = (freq: string, from: string) => {
                      // Giriş ve çıkış aynı YEREL gün ekseninde (gunBasi/gunAnahtari) — UTC gün kayması yok.
                      const d = gunBasi(from || bugunAnahtari());
                      if (!d) throw new Error(`Geçersiz tarih: ${from}`); // eski davranış da fırlatıyordu (Invalid Date → toISOString RangeError)
                      if (freq==='monthly') d.setMonth(d.getMonth()+1);
                      else if (freq==='quarterly') d.setMonth(d.getMonth()+3);
                      else d.setFullYear(d.getFullYear()+1);
                      return gunAnahtari(d) ?? '';
                    };
                    const today591 = bugunAnahtari();
                    const haftaSonu591 = gunAnahtari(Date.now()+7*86400000) ?? '';
                    const due591 = p591Schedules.filter(s=>s.active&&s.nextDate<=haftaSonu591);
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={mc(tr591).otomatik_fatura_takvimi} subtitle={mc(tr591).tekrarlayan_faturalari_otomatik_olarak_planlayin} icon={Calendar}
                          actionButton={hasFullAccess('muhasebe')&&(<button onClick={()=>setP591ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{mc(tr591).takvim_ekle}</button>)} />
                        {due591.length>0&&(<div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3"><p className="text-sm font-bold text-amber-800">🔔 {due591.length} {mc(tr591).fatura_bu_hafta_kesilecek}</p></div>)}
                        {p591ShowForm && (
                          <div className="apple-card p-5 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              <input className="apple-input px-3 py-2 text-sm" placeholder={oc(tr591).musteri} value={p591Draft.customerName} onChange={e=>setP591Draft(d=>({...d,customerName:e.target.value}))} />
                              <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={oc(tr591).tutar_2} value={p591Draft.amount} onChange={e=>setP591Draft(d=>({...d,amount:e.target.value}))} />
                              <select className="apple-input px-3 py-2 text-sm" value={p591Draft.frequency} onChange={e=>setP591Draft(d=>({...d,frequency:e.target.value as typeof d.frequency}))}>
                                <option value="monthly">{freqLabels591['monthly']}</option>
                                <option value="quarterly">{freqLabels591['quarterly']}</option>
                                <option value="yearly">{freqLabels591['yearly']}</option>
                              </select>
                              <input type="date" className="apple-input px-3 py-2 text-sm" value={p591Draft.nextDate} onChange={e=>setP591Draft(d=>({...d,nextDate:e.target.value}))} />
                              <input className="apple-input px-3 py-2 text-sm col-span-2 md:col-span-1" placeholder={oc(tr591).aciklama} value={p591Draft.description} onChange={e=>setP591Draft(d=>({...d,description:e.target.value}))} />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={async ()=>{
                                if(!p591Draft.customerName||!p591Draft.amount) return;
                                const payload={customerName:p591Draft.customerName,amount:Number(p591Draft.amount),frequency:p591Draft.frequency,nextDate:p591Draft.nextDate||today591,description:p591Draft.description};
                                try {
                                  if(p591EditId){ await updateDoc(doc(db,'autoInvoiceSchedules',p591EditId),payload); }
                                  else { await addDoc(collection(db,'autoInvoiceSchedules'),{...payload,active:true,createdAt:serverTimestamp()}); }
                                  setP591Draft({customerName:'',amount:'',frequency:'monthly',nextDate:'',description:''});
                                  setP591ShowForm(false); setP591EditId(null);
                                } catch(e){ toast((oc(tr591).kaydedilemedi)+(e instanceof Error?e.message:String(e)),'error'); }
                              }} className="apple-button-primary text-sm px-4 py-1.5">{oc(tr591).kaydet}</button>
                              <button onClick={()=>{setP591ShowForm(false);setP591EditId(null);}} className="apple-button-secondary text-sm px-4 py-1.5">{oc(tr591).iptal}</button>
                            </div>
                          </div>
                        )}
                        {p591Schedules.length===0 ? (
                          <div className="apple-card p-12 text-center"><Calendar className="w-12 h-12 text-gray-200 mx-auto mb-3"/><p className="text-gray-400 text-sm">{mc(tr591).henuz_otomatik_fatura_takvimi_yok}</p></div>
                        ) : (
                          <div className="apple-card overflow-hidden"><div className="overflow-x-auto">
                            <table className="w-full text-xs min-w-[560px]">
                              <thead><tr className="border-b border-gray-100 bg-gray-50">
                                {[oc(tr591).musteri,oc(tr591).tutar,mc(tr591).siklik,oc(tr591).sonraki_tarih,mc(tr591).aciklama,oc(tr591).aktif].map(h=>(
                                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                ))}
                              </tr></thead>
                              <tbody className="divide-y divide-gray-50">
                                {p591Schedules.map(s=>{
                                  const isDue = s.active&&s.nextDate<=today591;
                                  return (
                                    <tr key={s.id} className={`hover:bg-gray-50/50 ${isDue?'bg-amber-50/30':''}`}>
                                      <td className="px-4 py-2.5 font-medium text-gray-800">{s.customerName}</td>
                                      <td className="px-4 py-2.5 font-bold font-mono text-gray-700">{paraYaz(s.amount)}</td>
                                      <td className="px-4 py-2.5"><span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{freqLabels591[s.frequency]}</span></td>
                                      <td className="px-4 py-2.5"><span className={isDue?'text-amber-600 font-bold':'text-gray-600'}>{s.nextDate}</span></td>
                                      <td className="px-4 py-2.5 text-gray-500 max-w-[120px] truncate">{s.description||'—'}</td>
                                      <td className="px-4 py-2.5">
                                        <div className="flex items-center gap-1.5">
                                          <button onClick={async ()=>{try{await updateDoc(doc(db,'autoInvoiceSchedules',s.id),{active:!s.active});}catch(e){toast((oc(tr591).guncellenemedi)+(e instanceof Error?e.message:String(e)),'error');}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.active?'bg-green-100 text-green-700':'bg-gray-100 text-gray-400'}`}>{s.active?(oc(tr591).aktif):(mc(tr591).pasif_2)}</button>
                                          {isDue&&s.active&&(<button onClick={async ()=>{try{await updateDoc(doc(db,'autoInvoiceSchedules',s.id),{nextDate:getNextDate(s.frequency,s.nextDate)});}catch(e){toast((oc(tr591).guncellenemedi)+(e instanceof Error?e.message:String(e)),'error');}}} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{mc(tr591).kesildi}</button>)}
                                          <button type="button" onClick={()=>{setP591Draft({customerName:s.customerName,amount:String(s.amount),frequency:s.frequency,nextDate:s.nextDate,description:s.description});setP591EditId(s.id);setP591ShowForm(true);}} title={oc(tr591).duzenle} className="text-gray-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                                          <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'autoInvoiceSchedules',s.id));}catch(e){toast((oc(tr591).silinemedi)+(e instanceof Error?e.message:String(e)),'error');}}} title={oc(tr591).sil} className="text-gray-300 hover:text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table></div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 597: Gelir Tanıma Takvimi ────────────────────────────── */}
                  {muhasebeTab === 'gelir-tanima' && (() => {
                    const tr597 = currentLanguage === 'tr';
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={mc(tr597).gelir_tanima_takvimi} subtitle={mc(tr597).sozlesme_gelirini_donemler_arasi_otomatik_olarak} icon={BarChart3}
                          actionButton={hasFullAccess('muhasebe')&&(<button onClick={()=>setP597ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{oc(tr597).sozlesme_ekle}</button>)} />
                        {p597ShowForm && (
                          <div className="apple-card p-5 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              <input className="apple-input px-3 py-2 text-sm" placeholder={oc(tr597).musteri} value={p597Draft.customerName} onChange={e=>setP597Draft(d=>({...d,customerName:e.target.value}))} />
                              <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={mc(tr597).toplam_deger} value={p597Draft.totalValue} onChange={e=>setP597Draft(d=>({...d,totalValue:e.target.value}))} />
                              <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={mc(tr597).taninan} value={p597Draft.recognized} onChange={e=>setP597Draft(d=>({...d,recognized:e.target.value}))} />
                              <input type="date" className="apple-input px-3 py-2 text-sm" value={p597Draft.startDate} onChange={e=>setP597Draft(d=>({...d,startDate:e.target.value}))} />
                              <input type="date" className="apple-input px-3 py-2 text-sm" value={p597Draft.endDate} onChange={e=>setP597Draft(d=>({...d,endDate:e.target.value}))} />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={async ()=>{
                                if(!p597Draft.customerName||!p597Draft.totalValue) return;
                                // Sayısal olmayan metin 0/NaN olarak KAYDEDİLMEZ (eskiden `Number(x)||0`); boş "tanınan" yeni sözleşmede gerçek 0.
                                const taninan597 = p597Draft.recognized.trim() === '' ? 0 : bilinenSayi(p597Draft.recognized) ? Number(p597Draft.recognized) : NaN;
                                if(!bilinenSayi(p597Draft.totalValue) || !Number.isFinite(taninan597)) { toast(oc(currentLanguage).gecerli_bir_tutar_girin, 'error'); return; }
                                try { await addDoc(collection(db,'revenueContracts'),{customerName:p597Draft.customerName,totalValue:Number(p597Draft.totalValue),startDate:p597Draft.startDate,endDate:p597Draft.endDate,recognized:taninan597,createdAt:serverTimestamp()}); toast(mc(currentLanguage).sozlesme_eklendi, 'success'); } catch(e){console.error("[firestore]", e); toast(mc(currentLanguage).sozlesme_eklenemedi, 'error');}
                                setP597Draft({customerName:'',totalValue:'',startDate:'',endDate:'',recognized:''});
                                setP597ShowForm(false);
                              }} className="apple-button-primary text-sm px-4 py-1.5">{oc(tr597).kaydet}</button>
                              <button onClick={()=>setP597ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{oc(tr597).iptal}</button>
                            </div>
                          </div>
                        )}
                        {p597Contracts.length===0?(
                          <div className="apple-card p-12 text-center"><BarChart3 className="w-12 h-12 text-gray-200 mx-auto mb-3"/><p className="text-gray-400 text-sm">{mc(tr597).henuz_gelir_tanima_kaydi_yok}</p></div>
                        ):(
                          <div className="space-y-3">
                            {p597Contracts.map(c=>{
                              const deferred = c.totalValue-c.recognized;
                              const recPct = c.totalValue>0?(c.recognized/c.totalValue)*100:0;
                              // Monthly recognition
                              let monthlyRec = 0;
                              const ms = zamanMs(c.startDate), me = zamanMs(c.endDate);
                              if (ms!==null&&me!==null) {
                                const months = Math.max(1,Math.round((me-ms)/(30*86400000)));
                                monthlyRec = c.totalValue/months;
                              }
                              return (
                                <div key={c.id} className="apple-card p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <p className="font-semibold text-gray-800">{c.customerName}</p>
                                    <button onClick={async ()=>{if(!await confirmDelete(undefined, currentLanguage==='tr'?'tr':'en'))return;try{await deleteDoc(doc(db,'revenueContracts',c.id));}catch(e){console.error("[firestore]", e);}}} className="text-gray-300 hover:text-red-400 text-xs">✕</button>
                                  </div>
                                  <div className="grid grid-cols-3 gap-3 text-xs mb-3">
                                    <div><p className="text-gray-400">{oc(tr597).toplam}</p><p className="font-bold text-gray-700">{paraYaz(c.totalValue)}</p></div>
                                    <div><p className="text-gray-400">{oc(tr597).taninan}</p><p className="font-bold text-emerald-600">{paraYaz(c.recognized)}</p></div>
                                    <div><p className="text-gray-400">{mc(tr597).ertelenmis}</p><p className="font-bold text-amber-600">{paraYaz(deferred)}</p></div>
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-2 mb-1.5 overflow-hidden">
                                    <div className="h-full bg-emerald-400 rounded-full" style={{width:`${recPct}%`}}/>
                                  </div>
                                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                                    <span>{recPct.toFixed(0)}% {oc(tr597).tanindi}</span>
                                    {monthlyRec>0&&<span>{mc(tr597).aylik} {paraYaz(monthlyRec, { ondalik: 0 })}</span>}
                                    <button onClick={async ()=>{try{await updateDoc(doc(db,'revenueContracts',c.id),{recognized:Math.min(c.totalValue,c.recognized+monthlyRec)});}catch(e){console.error("[firestore]", e);}}} className="text-blue-500 hover:text-blue-700 font-semibold">{mc(tr597).bu_ayi_tani}</button>
                                  </div>
                                </div>
                              );
                            })}
                            <div className="apple-card p-4 bg-blue-50/30 text-sm">
                              <p className="font-bold text-gray-700">{mc(tr597).toplam_ertelenmis_gelir} <span className="text-amber-600">{paraYaz(p597Contracts.reduce((s,c)=>s+(c.totalValue-c.recognized),0))}</span></p>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 617: KDV Mutabakat ────────────────────────────────────── */}
                  {muhasebeTab === 'kdv-mutabakat' && (() => {
                    const tr617 = currentLanguage === 'tr';
                    // KAYNAK: Mikro GİDEN (satış) faturaları — seçili dönem (YYYY-MM).
                    // orders (Cetpa) boştu → panel hep 0. matrah/kdv/oran Mikro'da ZATEN
                    // ayrık (fatura-listesi import'u STOK_HAREKETLERI'nden JOIN'liyor);
                    // eski kod totalPrice'ı 1.18'e bölüyordu — burada bölme YOK, gerçek
                    // matrah/kdv kullanılır (daha doğru). oran vergiPntr'den (20/10/0/1).
                    // Hesap tek kaynakta (utils/muhasebe/butceVaryans.kdvMutabakat): giden fatura + faturasız
                    // (iptal/faturalı/hasInvoice/Mikro-kaynaklı DIŞI) sipariş; oran bantları veriden, karma
                    // bantta tek oran uydurulmaz (null). Bilinmeyen tutar 0 değil — toplama girmez, sayılır;
                    // ekranda '—' + "N kayıt tutarsız".
                    const m617 = kdvMutabakat(mikroFaturalar, orders, p617Month);
                    const donemFaturalar = { length: m617.faturaAdedi };
                    const donemFaturasiz = { length: m617.faturasizAdedi };
                    const faturasizTutar = ekranTutari(m617.faturasizTutar);
                    const totalRevenue = ekranTutari(m617.ciro);
                    const totalMatrah = ekranTutari(m617.matrah);
                    const totalKdv = ekranTutari(m617.kdv);
                    const oranRows = m617.bantlar;
                    const tutarsiz617 = (n: number) => n > 0 ? `${n} ${mc(tr617).kayit_tutarsiz}` : null;
                    const bandColor = (oran: number | null) => oran === 20 ? 'text-purple-600' : oran === 10 ? 'text-amber-600' : oran === 0 ? 'text-gray-500' : 'text-blue-600';
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={mc(tr617).kdv_mutabakat} subtitle={mc(tr617).donem_bazinda_mikro_satis_faturalarindan_kdv_ana} icon={FileText}/>
                        <div className="flex items-center gap-3">
                          <input type="month" value={p617Month} onChange={e=>setP617Month(e.target.value)} className="apple-input px-3 py-2 text-sm"/>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          {[
                            {label:oc(tr617).toplam_ciro,val:paraYaz(totalRevenue, { ondalik: 0 }),color:'text-blue-600',bg:'bg-blue-50',not:tutarsiz617(m617.ciro.bilinmeyen)},
                            {label:mc(tr617).toplam_matrah,val:paraYaz(totalMatrah, { ondalik: 0 }),color:'text-purple-600',bg:'bg-purple-50',not:tutarsiz617(m617.matrah.bilinmeyen)},
                            {label:oc(tr617).toplam_kdv,val:paraYaz(totalKdv, { ondalik: 0 }),color:'text-emerald-600',bg:'bg-emerald-50',not:tutarsiz617(m617.kdv.bilinmeyen)},
                            {label:mc(tr617).fatura_sayisi,val:String(donemFaturalar.length),color:'text-amber-600',bg:'bg-amber-50',not:null},
                          ].map(k=>(
                            <div key={k.label} className={`apple-card p-5 ${k.bg}`}>
                              <p className="text-[10px] font-bold text-gray-400 uppercase">{k.label}</p>
                              <p className={`text-xl font-black ${k.color}`}>{k.val}</p>
                              {k.not && <p className="text-[10px] text-amber-600">{k.not}</p>}
                            </div>
                          ))}
                        </div>
                        <div className="apple-card overflow-hidden">
                          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50"><h3 className="font-bold text-gray-800 text-sm">{mc(tr617).kdv_dilimi_analizi}</h3></div>
                          <div className="divide-y divide-gray-50">
                            {oranRows.map(row=>(
                              <div key={row.anahtar} className="grid grid-cols-2 sm:grid-cols-4 gap-y-1 px-4 py-3 text-xs">
                                <span className={`font-bold ${bandColor(row.oran)}`}>{row.oranKarma ? (oc(tr617).karma_oran) : row.oran === null ? (oc(tr617).oran_yok) : `%${row.oran} KDV`}</span>
                                <span className="tabular-nums text-gray-600">{paraYaz(ekranTutari(row.matrah), { ondalik: 0 })}</span>
                                <span className="tabular-nums font-bold text-gray-800">{paraYaz(ekranTutari(row.kdv), { ondalik: 0 })}</span>
                                <span className="text-gray-400">{row.adet} {mc(tr617).fatura_2}{row.tutarsiz > 0 && <span className="text-amber-600"> · {tutarsiz617(row.tutarsiz)}</span>}</span>
                              </div>
                            ))}
                            {donemFaturasiz.length > 0 && (
                              <div key="faturasiz" className="grid grid-cols-4 px-4 py-3 text-xs bg-gray-50/60">
                                <span className="font-bold text-gray-500">{mc(tr617).faturasiz_muaf}</span>
                                <span className="tabular-nums text-gray-600">{paraYaz(faturasizTutar, { ondalik: 0 })}</span>
                                <span className="tabular-nums font-bold text-gray-800">₺0</span>
                                <span className="text-gray-400">{donemFaturasiz.length} {mc(tr617).islem}{m617.faturasizTutar.bilinmeyen > 0 && <span className="text-amber-600"> · {tutarsiz617(m617.faturasizTutar.bilinmeyen)}</span>}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        {donemFaturalar.length === 0 && donemFaturasiz.length === 0 && (
                          <p className="text-center text-gray-400 text-sm py-8">{tr617?`${p617Month} döneminde Mikro satış faturası bulunamadı. "Faturalar" çekilmiş mi?`:`No Mikro sales invoices for ${p617Month}.`}</p>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 625: Gelir/Gider Bütçe Karşılaştırması ───────────────── */}
                  {muhasebeTab === 'gelir-gider-butce' && (() => {
                    const tr625 = currentLanguage === 'tr';
                    const year625 = p625BudgetYear;
                    // Hesap tek kaynakta (utils/muhasebe/butceVaryans.gelirButceYili): native faturasız sipariş
                    // + Mikro giden fatura (ayKarZarar) vs revExpBudgets aylık gelir bütçesi. Bilinmeyen tutar
                    // 0 değil — toplama girmez, sayılır; ekranda '—' + "N kayıt tutarsız".
                    const ozet625 = gelirButceYili(orders, mikroFaturalar, p625BudgetData, year625);
                    const monthNames = tr625?['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const totalActRev = ekranTutari(ozet625.toplamGerceklesen);
                    const totalBudRev = ekranTutari(ozet625.toplamButce);
                    const variance = ozet625.sapma;   // number | null — bir taraf bilinmiyorsa null
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={mc(tr625).gelir_gider_butce_karsilastirmasi} subtitle={mc(tr625).yillik_butce_hedefleri_ve_gerceklesen_gelir_kars} icon={BarChart3}/>
                        <div className="flex items-center gap-3 flex-wrap">
                          <input type="number" value={year625} onChange={e=>setP625BudgetYear(Number(e.target.value))} className="apple-input px-3 py-2 text-sm w-24" placeholder="Year"/>
                          <span className="text-xs text-gray-500">• {mc(tr625).butce_hucrelerine_tiklayarak_duzenleyin}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="apple-card p-4 bg-blue-50"><p className="text-xs text-gray-500">{mc(tr625).butce_ciro}</p><p className="text-lg font-black text-blue-600">{paraYaz(totalBudRev, { ondalik: 0 })}</p>{ozet625.toplamButce.bilinmeyen > 0 && <p className="text-[10px] text-amber-600">{ozet625.toplamButce.bilinmeyen} {mc(tr625).ayin_butcesi_okunamiyor}</p>}</div>
                          <div className="apple-card p-4 bg-emerald-50"><p className="text-xs text-gray-500">{mc(tr625).gerceklesen_ciro}</p><p className="text-lg font-black text-emerald-600">{paraYaz(totalActRev, { ondalik: 0 })}</p>{ozet625.toplamGerceklesen.bilinmeyen > 0 && <p className="text-[10px] text-amber-600">{ozet625.toplamGerceklesen.bilinmeyen} {mc(tr625).kayit_tutarsiz}</p>}</div>
                          <div className={`apple-card p-4 ${variance === null ? 'bg-gray-50' : variance>=0?'bg-emerald-50':'bg-red-50'}`}><p className="text-xs text-gray-500">{oc(tr625).sapma}</p><p className={`text-lg font-black ${variance === null ? 'text-gray-400' : variance>=0?'text-emerald-600':'text-red-600'}`}>{variance === null ? '—' : (variance>=0?'+':'') + paraYaz(Math.abs(variance), { ondalik: 0 })}</p></div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-100 bg-gray-50">
                              {[oc(tr625).ay,mc(tr625).butce_ciro_2,oc(tr625).gerceklesen,mc(tr625).sapma,'%'].map(h=>(
                                <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                              ))}
                            </tr></thead>
                            <tbody className="divide-y divide-gray-50">
                              {Array.from({length:12},(_,i)=>{
                                const satir = ozet625.aylar[i];
                                const bud = satir.butce;                            // null = kalem yok (bütçesiz); NaN = kalem var, değer okunamıyor
                                const act = ekranTutari(satir.gerceklesen);        // kısmi toplam (+ title notu); hiç bilinen yoksa NaN → '—'
                                const vari = satir.sapma, pct = satir.sapmaYuzde;   // number | null
                                const isEditing = p625EditMonth===i;
                                return (
                                  <tr key={i} className="hover:bg-gray-50/50">
                                    <td className="px-3 py-2.5 font-medium text-gray-700">{monthNames[i]}</td>
                                    <td className="px-3 py-2.5" onClick={()=>setP625EditMonth(i)}>
                                      {isEditing?(
                                        <input type="number" autoFocus defaultValue={bud !== null && Number.isFinite(bud) ? bud : ''} onBlur={async e=>{
                                          // Boş bırakılıp çıkılan hücre ₺0 bütçe olarak KAYDEDİLMEZ (Number('') = 0 → ay "bütçeli" sayılır, yıl sapmasına tüm cirosu girerdi — 2. hakem).
                                          if(e.target.value.trim()===''){ setP625EditMonth(null); return; }
                                          const val=Number(e.target.value);
                                          const existing=p625BudgetData.find(b=>b.month===i);
                                          setP625BudgetData(prev=>{
                                            const idx=prev.findIndex(b=>b.month===i);
                                            if(idx>=0) return prev.map((b,j)=>j===idx?{...b,budgetRevenue:val}:b);
                                            return [...prev,{month:i,budgetRevenue:val,budgetExpense:0}];
                                          });
                                          setP625EditMonth(null);
                                          // KALICI (2026-07-21): ay bazında revExpBudgets dokümanı
                                          try {
                                            if(existing?.id){ await updateDoc(doc(db,'revExpBudgets',existing.id),{budgetRevenue:val}); }
                                            else { await addDoc(collection(db,'revExpBudgets'),{year:p625BudgetYear,month:i,budgetRevenue:val,budgetExpense:0,createdAt:serverTimestamp()}); }
                                          } catch(err){ toast((oc(currentLanguage).kaydedilemedi)+(err instanceof Error?err.message:String(err)),'error'); }
                                        }} className="apple-input px-2 py-0.5 text-xs w-28"/>
                                      ):(
                                        <span className="tabular-nums cursor-pointer text-blue-600 hover:underline">{bud !== null && Number.isFinite(bud)?paraYaz(bud, { ondalik: 0 }):'—'}</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 tabular-nums text-gray-700" title={satir.gerceklesen.bilinmeyen > 0 ? `${satir.gerceklesen.bilinmeyen} ${mc(tr625).kayit_tutarsiz}` : undefined}>{act>0?paraYaz(act, { ondalik: 0 }):'—'}{satir.gerceklesen.bilinmeyen > 0 && <span className="text-amber-600"> *</span>}</td>
                                    <td className={`px-3 py-2.5 tabular-nums font-bold ${vari === null ? 'text-gray-400' : vari>=0?'text-emerald-600':'text-red-600'}`}>{vari !== null?(vari>=0?'+':'')+paraYaz(Math.abs(vari), { ondalik: 0 }):'—'}</td>
                                    <td className={`px-3 py-2.5 font-bold ${pct === null?'text-gray-400':pct>=0?'text-emerald-600':'text-red-600'}`}>{pct!==null?`${pct>=0?'+':''}${pct.toFixed(1)}%`:'—'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-[10px] text-gray-400">* {mc(tr625).butce_degerlerini_duzenlemek_icin_butce_ciro_sut}</p>
                        {ozet625.butceliAyAdedi < 12 && <p className="text-[10px] text-gray-400">{tr625 ? `Sapma yalnız bütçesi girilen ${ozet625.butceliAyAdedi} ay için hesaplanır; bütçesiz ayın cirosu sapmaya girmez.` : `Variance covers only the ${ozet625.butceliAyAdedi} budgeted months; unbudgeted revenue is not counted.`}</p>}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 634: Varyans Analizi (Budget vs Actual by Category) ── */}
                  {muhasebeTab === 'varyans-analiz' && (() => {
                    const tr634 = currentLanguage === 'tr';
                    const now634 = new Date();
                    // Hesap tek kaynakta (utils/muhasebe/butceVaryans.varyansAnalizi): dönem ayları
                    // (varyansAylari) × ayKarZarar; bütçe tarafı sayfadaki SİMÜLASYON (VARYANS_VARSAYIMLARI:
                    // ciro×1,15 / SMM ×0,55 / OPEX ×0,20; OPEX gerçekleşen ×0,18) — panelde rozetle söylenir.
                    // Eski `actualCogs || revenue*0.48` yedeği KALDIRILDI: satır maliyeti bilinmiyorsa
                    // SMM/brüt kâr/FAVÖK '—' (bilinmeyen sayısı tablonun altında).
                    const v634 = varyansAnalizi(orders, mikroFaturalar, p634Period, now634);
                    const etiket634: Record<VaryansKalemi, string> = {
                      gelir: mc(tr634).gelir_net,
                      smm: mc(tr634).satilan_malin_maliyeti_smm,
                      brutKar: oc(tr634).brut_kar,
                      opex: mc(tr634).faaliyet_giderleri,
                      favok: mc(tr634).favok,
                    };
                    const rows634 = v634.satirlar.map(r => ({ ...r, label: etiket634[r.anahtar] }));
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <ModuleHeader title={mc(tr634).varyans_analizi} subtitle={mc(tr634).butce_gerceklesen_sapma_analizi_kategori_bazinda} icon={BarChart3}/>
                          {v634.butceVarsayimsal && <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">{mc(tr634).butce_simulasyon_ciro1_15}</span>}
                        </div>
                        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
                          {([['this_month',oc(tr634).bu_ay],['last_month',oc(tr634).gecen_ay],['ytd','YTD']] as [typeof p634Period,string][]).map(([v,l])=>(
                            <button key={v} onClick={()=>setP634Period(v)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${p634Period===v?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{l}</button>
                          ))}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-100 bg-gray-50">
                              {[oc(tr634).kategori,oc(tr634).butce,oc(tr634).gerceklesen,oc(tr634).sapma,mc(tr634).sapma_2].map(h=>(
                                <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                              ))}
                            </tr></thead>
                            <tbody className="divide-y divide-gray-50">
                              {rows634.map(r=>{
                                const variance = r.sapma, pct = r.sapmaYuzde, favorable = r.olumlu;   // üçü de null olabilir (bilinmeyen tutar)
                                const araToplam = r.anahtar === 'brutKar' || r.anahtar === 'favok';
                                const renk = favorable === null ? 'text-gray-400' : favorable ? 'text-emerald-600' : 'text-red-600';
                                return (
                                  <tr key={r.anahtar} className={`hover:bg-gray-50/50 ${araToplam?'font-bold bg-gray-50/30':''}`}>
                                    <td className="px-4 py-2.5 text-gray-800">{r.label}</td>
                                    <td className="px-4 py-2.5 text-gray-600">{paraYaz(r.butce, { ondalik: 0 })}</td>
                                    <td className="px-4 py-2.5 font-semibold text-gray-900" title={r.gerceklesenVarsayimsal ? (mc(tr634).tahmini_gercek_gider_verisi_yok) : undefined}>{r.gerceklesenVarsayimsal && Number.isFinite(r.gerceklesen) ? '~' : ''}{paraYaz(r.gerceklesen, { ondalik: 0 })}</td>
                                    <td className={`px-4 py-2.5 font-bold ${renk}`}>{variance === null ? '—' : (variance>=0?'+':'') + paraYaz(Math.abs(variance), { ondalik: 0 })}</td>
                                    <td className={`px-4 py-2.5 font-bold ${renk}`}>{pct === null ? '—' : `${pct>=0?'+':''}${pct.toFixed(1)}%`}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {v634.gelir.bilinen === 0 && v634.gelir.bilinmeyen === 0 && <p className="text-[10px] text-gray-400">{mc(tr634).donemde_tutari_bilinen_kayit_yok_sapma_ve_hukum_}</p>}
                        {v634.gelir.bilinmeyen > 0 && <p className="text-[10px] text-amber-600">{v634.gelir.bilinmeyen} {v634.gelir.bilinen > 0 ? (mc(tr634).kayit_tutarsiz_gelir_kismi_butce_sapma_ve_tureti) : (mc(tr634).kayit_tutarsiz_gelir_hesaplanamadi_butce_sapma_v)}</p>}
                        {v634.smm.bilinmeyen > 0 && <p className="text-[10px] text-amber-600">{v634.smm.bilinmeyen} {v634.smm.bilinen > 0 ? (mc(tr634).siparisin_satir_maliyeti_yok_smm_kismi_sapmasi_b) : (mc(tr634).siparisin_satir_maliyeti_yok_smm_hesaplanamadi_b)}</p>}
                        <p className="text-[10px] text-gray-400">* {mc(tr634).butce_degerleri_onceki_donem_gelirinin_115_i_ola}</p>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 635: Kur Değerleme (FX Revaluation) ───────────────── */}
                  {muhasebeTab === 'kur-degerleme' && (() => {
                    const tr635 = currentLanguage === 'tr';
                    // Güncel kur CANLI TCMB'den (exchangeRates); açık bakiye + defterdeki kur editlenebilir.
                    const gecerliKur = (v: number | undefined): number | null =>
                      typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
                    const curUSD = gecerliKur(exchangeRates?.USD);
                    const curEUR = gecerliKur(exchangeRates?.EUR);
                    // Kur farkı = döviz bakiyesi × (güncel kur − defterdeki kur)  [TL cinsinden]
                    // Kur yokken `?? 0` kullaniliyordu: gain = −bakiye × defterKuru, yani
                    // TAMAMEN uydurma bir "zarar" rakami basiliyordu. Artik null → '—'.
                    // Hesap tek kaynakta (utils/currency.kurFarki): bakiye/defter kuru bilinmiyorsa (boş giriş) da null → '—'.
                    const gainUSD = kurFarki(fxPos.usdBalance, fxPos.usdBookRate, curUSD);
                    const gainEUR = kurFarki(fxPos.eurBalance, fxPos.eurBookRate, curEUR);
                    const netGain = gainUSD === null || gainEUR === null ? null : gainUSD + gainEUR;
                    const positions = [
                      { cur: 'USD', bal: fxPos.usdBalance, balField: 'usdBalance' as const, book: fxPos.usdBookRate, bookField: 'usdBookRate' as const, curRate: curUSD, gain: gainUSD },
                      { cur: 'EUR', bal: fxPos.eurBalance, balField: 'eurBalance' as const, book: fxPos.eurBookRate, bookField: 'eurBookRate' as const, curRate: curEUR, gain: gainEUR },
                    ];
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={mc(tr635).kur_degerleme_fx_revaluation} subtitle={mc(tr635).acik_doviz_pozisyonlarinin_donem_sonu_kur_farki_} icon={TrendingUp}/>
                        <div className="flex items-center gap-4 flex-wrap">
                          <span className="text-xs text-gray-500">{mc(tr635).guncel_kur_tcmb}</span>
                          <span className="text-sm font-bold text-gray-900">USD {curUSD === null ? '—' : `₺${curUSD.toFixed(4)}`}</span>
                          <span className="text-sm font-bold text-gray-900">EUR {curEUR === null ? '—' : `₺${curEUR.toFixed(4)}`}</span>
                          <button onClick={() => void refreshFxRates()} disabled={fxRefreshing} className="apple-button-secondary px-3 py-1.5 text-xs">
                            <RefreshCw className={`w-3.5 h-3.5 ${fxRefreshing?'animate-spin':''}`} /> {mc(tr635).kur_guncelle}
                          </button>
                          {(curUSD === null || curEUR === null) && <span className="text-[11px] text-amber-600">{mc(tr635).kur_cekilemedi_kur_guncelle_ye_basin}</span>}
                        </div>
                        <p className="text-[11px] text-gray-400">{mc(tr635).acik_bakiye_doviz_cinsinden_ve_defterdeki_kuru_g}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {positions.map(fx=>(
                            <div key={fx.cur} className={`apple-card p-5 border-l-4 ${fx.gain === null ? 'border-l-gray-200' : fx.gain>=0?'border-l-emerald-400':'border-l-red-400'}`}>
                              <p className="text-xs font-bold text-gray-500 mb-3">{fx.cur} {mc(tr635).pozisyonu}</p>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between items-center"><span className="text-gray-500">{mc(tr635).acik_bakiye} ({fx.cur})</span><FxInput value={fx.bal} onChange={v=>updateFx(fx.balField, v)} /></div>
                                <div className="flex justify-between items-center"><span className="text-gray-500">{mc(tr635).defterdeki_kur}</span><FxInput value={fx.book} onChange={v=>updateFx(fx.bookField, v)} w="w-24" /></div>
                                <div className="flex justify-between"><span className="text-gray-500">{mc(tr635).guncel_kur}</span><span className="font-semibold">{fx.curRate === null ? '—' : `₺${fx.curRate.toFixed(4)}`}</span></div>
                                <div className={`flex justify-between pt-2 border-t border-gray-100 font-black ${fx.gain === null ? 'text-gray-400' : fx.gain>=0?'text-emerald-600':'text-red-600'}`}>
                                  <span>{mc(tr635).kur_farki}</span>
                                  <span>{fx.gain === null ? '—' : `${fx.gain>=0?'+':'-'}${paraYaz(Math.abs(fx.gain), { ondalik: 0 })}`}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className={`apple-card p-4 flex items-center gap-3 ${netGain === null ? 'bg-gray-50' : netGain>=0?'bg-emerald-50':'bg-red-50'}`}>
                          <TrendingUp className={`w-5 h-5 ${netGain === null ? 'text-gray-400' : netGain>=0?'text-emerald-600':'text-red-600'}`}/>
                          <div>
                            <p className="text-xs text-gray-500">{mc(tr635).net_kur_farki_degerleme_sonucu}</p>
                            <p className={`text-lg font-black ${netGain === null ? 'text-gray-400' : netGain>=0?'text-emerald-700':'text-red-700'}`}>{netGain === null ? '—' : `${netGain>=0?'+':'-'}${paraYaz(Math.abs(netGain), { ondalik: 0 })}`}</p>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 640: Tekrarlayan Fatura / Abonelik Yönetimi ────────── */}
                  {muhasebeTab === 'tekrar-fatura' && (() => {
                    const tr640 = currentLanguage === 'tr';
                    const haftaSonu640 = gunAnahtari(Date.now()+7*86400000) ?? '';
                    const due640 = p640Subs.filter(s=>s.status==='Aktif'&&s.nextDate<=haftaSonu640).length;
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={mc(tr640).tekrarlayan_fatura_abonelik} subtitle={mc(tr640).b2b_abonelik_ve_periyodik_fatura_yonetimi} icon={RefreshCw}
                          actionButton={hasFullAccess('muhasebe')&&<button onClick={()=>setP640ShowForm(v=>!v)} className="apple-button-primary px-4 py-2 text-sm flex items-center gap-2"><Plus className="w-4 h-4"/>{oc(tr640).yeni_abonelik}</button>}
                        />
                        {due640>0&&<div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-500"/><p className="text-xs font-semibold text-amber-800">{due640} {mc(tr640).abonelik_onumuzdeki_7_gun_icinde_fatura_kesilece}</p></div>}
                        {p640ShowForm&&(
                          <div className="apple-card p-5 space-y-3 border border-brand/20">
                            <h4 className="font-bold text-sm text-gray-900">{oc(tr640).yeni_abonelik}</h4>
                            <div className="grid grid-cols-2 gap-3">
                              <input placeholder={oc(tr640).musteri_adi} value={p640Draft.customerName} onChange={e=>setP640Draft(d=>({...d,customerName:e.target.value}))} className="apple-input px-3 py-2 text-sm"/>
                              <input type="number" placeholder={oc(tr640).tutar_2} value={p640Draft.amount} onChange={e=>setP640Draft(d=>({...d,amount:e.target.value}))} className="apple-input px-3 py-2 text-sm"/>
                              <select value={p640Draft.frequency} onChange={e=>setP640Draft(d=>({...d,frequency:e.target.value as typeof p640Draft.frequency}))} className="apple-input px-3 py-2 text-sm">
                                <option value="Aylık">{oc(tr640).aylik}</option>
                                <option value="3 Aylık">{oc(tr640)._3_aylik}</option>
                                <option value="Yıllık">{mc(tr640).yillik}</option>
                              </select>
                              <input type="date" value={p640Draft.nextDate} onChange={e=>setP640Draft(d=>({...d,nextDate:e.target.value}))} className="apple-input px-3 py-2 text-sm"/>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={async ()=>{
                                if(!p640Draft.customerName||!p640Draft.amount) return;
                                try { await addDoc(collection(db,'recurringBilling'),{customerName:p640Draft.customerName,amount:Number(p640Draft.amount),frequency:p640Draft.frequency,nextDate:p640Draft.nextDate,status:'Aktif',createdAt:serverTimestamp()}); toast(mc(currentLanguage).abonelik_eklendi, 'success'); } catch(e){console.error("[firestore]", e); toast(mc(currentLanguage).abonelik_eklenemedi, 'error');}
                                setP640ShowForm(false);setP640Draft({customerName:'',amount:'',frequency:'Aylık',nextDate:bugunAnahtari()});
                              }} className="apple-button-primary px-4 py-2 text-sm">{oc(tr640).kaydet}</button>
                              <button onClick={()=>setP640ShowForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{oc(tr640).iptal}</button>
                            </div>
                          </div>
                        )}
                        {p640Subs.length===0?(
                          <div className="text-center py-12 space-y-2"><RefreshCw className="w-10 h-10 text-gray-200 mx-auto"/><p className="text-sm text-gray-400">{mc(tr640).henuz_abonelik_kaydi_yok}</p></div>
                        ):(
                          <div className="space-y-2">
                            {p640Subs.map(s=>{
                              const nextMs = zamanMs(s.nextDate);
                              const daysLeft = nextMs===null ? null : Math.ceil((nextMs-Date.now())/86400000);
                              return (
                                <div key={s.id} className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-white gap-4">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-gray-900 truncate">{s.customerName}</p>
                                    <p className="text-xs text-gray-400">{s.frequency} • {mc(tr640).sonraki} {tarihYaz(s.nextDate)}</p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-sm font-black text-[#ff4000]">{paraYaz(s.amount)}</p>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${daysLeft!==null&&daysLeft<=7?'bg-amber-100 text-amber-700':s.status==='Aktif'?'bg-emerald-100 text-emerald-700':'bg-gray-100 text-gray-500'}`}>
                                      {s.status==='Aktif'?daysLeft!==null&&daysLeft<=7?`${daysLeft}g kaldı`:oc(tr640).aktif:s.status}
                                    </span>
                                  </div>
                                  <button onClick={async ()=>{if(!await confirmDelete(undefined, currentLanguage==='tr'?'tr':'en'))return;try{await deleteDoc(doc(db,'recurringBilling',s.id));}catch(e){console.error("[firestore]", e);}}} className="text-gray-300 hover:text-red-400 text-sm flex-shrink-0">✕</button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 643: Şirketlerarası İşlemler ──────────────────────── */}
                  {muhasebeTab === 'sirket-arasi' && (() => {
                    const tr643 = currentLanguage === 'tr';
                    const entities643 = ['Cetpa A.Ş.','Cetpa Lojistik Ltd.','Cetpa Dış Ticaret'];
                    const pending643 = p643Txns.filter(t=>t.status==='Bekliyor');
                    const totalPending = pending643.reduce((s,t)=>s+t.amount,0);
                    return (
                      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                        <ModuleHeader title={mc(tr643).sirketlerarasi_islemler} subtitle={mc(tr643).holding_bunyesindeki_sirketler_arasi_borc_alacak} icon={Building2}
                          actionButton={hasFullAccess('muhasebe')&&<button onClick={()=>setP643ShowForm(v=>!v)} className="apple-button-primary px-4 py-2 text-sm flex items-center gap-2"><Plus className="w-4 h-4"/>{oc(tr643).islem_ekle}</button>}
                        />
                        {pending643.length>0&&<div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-500"/><p className="text-xs font-semibold text-amber-800">{pending643.length} {mc(tr643).islem_netlestirme_bekliyor} {paraYaz(totalPending, { ondalik: 0 })}</p></div>}
                        {p643ShowForm&&(
                          <div className="apple-card p-5 space-y-3 border border-brand/20">
                            <h4 className="font-bold text-sm">{mc(tr643).yeni_sirketlerarasi_islem}</h4>
                            <div className="grid grid-cols-2 gap-3">
                              <div><label className="text-xs text-gray-500 mb-1 block">{oc(tr643).gonderen}</label><select value={p643Draft.from} onChange={e=>setP643Draft(d=>({...d,from:e.target.value}))} className="apple-input px-3 py-2 text-sm w-full">{entities643.map(e=><option key={e}>{e}</option>)}</select></div>
                              <div><label className="text-xs text-gray-500 mb-1 block">{oc(tr643).alici}</label><select value={p643Draft.to} onChange={e=>setP643Draft(d=>({...d,to:e.target.value}))} className="apple-input px-3 py-2 text-sm w-full">{entities643.map(e=><option key={e}>{e}</option>)}</select></div>
                              <input type="number" placeholder={oc(tr643).tutar} value={p643Draft.amount} onChange={e=>setP643Draft(d=>({...d,amount:e.target.value}))} className="apple-input px-3 py-2 text-sm"/>
                              <select value={p643Draft.currency} onChange={e=>setP643Draft(d=>({...d,currency:e.target.value as 'TRY'|'USD'|'EUR'}))} className="apple-input px-3 py-2 text-sm">
                                <option value="TRY">TRY</option><option value="USD">USD</option><option value="EUR">EUR</option>
                              </select>
                              <input placeholder={oc(tr643).aciklama} value={p643Draft.desc} onChange={e=>setP643Draft(d=>({...d,desc:e.target.value}))} className="apple-input px-3 py-2 text-sm col-span-2"/>
                              <input type="date" value={p643Draft.date} onChange={e=>setP643Draft(d=>({...d,date:e.target.value}))} className="apple-input px-3 py-2 text-sm"/>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={async ()=>{
                                if(!p643Draft.amount||!p643Draft.desc) return;
                                try { await addDoc(collection(db,'intercompanyTxns'),{from:p643Draft.from,to:p643Draft.to,amount:Number(p643Draft.amount),currency:p643Draft.currency,desc:p643Draft.desc,date:p643Draft.date,status:'Bekliyor',createdAt:serverTimestamp()}); toast(mc(currentLanguage).islem_eklendi, 'success'); } catch(e){console.error("[firestore]", e); toast(mc(currentLanguage).islem_eklenemedi, 'error');}
                                setP643ShowForm(false);
                              }} className="apple-button-primary px-4 py-2 text-sm">{oc(tr643).kaydet}</button>
                              <button onClick={()=>setP643ShowForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{oc(tr643).iptal}</button>
                            </div>
                          </div>
                        )}
                        {p643Txns.length===0?(
                          <div className="text-center py-12"><Building2 className="w-10 h-10 text-gray-200 mx-auto mb-3"/><p className="text-sm text-gray-400">{mc(tr643).henuz_sirketlerarasi_islem_yok}</p></div>
                        ):(
                          <div className="space-y-2">
                            {p643Txns.map(t=>(
                              <div key={t.id} className="flex items-center gap-4 p-3 rounded-xl border border-gray-100 bg-white">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold text-gray-800">{t.from} → {t.to}</p>
                                  <p className="text-xs text-gray-400">{t.desc} • {tarihYaz(t.date)}</p>
                                </div>
                                <span className="font-black text-sm text-gray-900">{paraYaz(t.amount, { birim: t.currency })}</span>
                                <button onClick={async ()=>{try{await updateDoc(doc(db,'intercompanyTxns',t.id),{status:'Netleştirildi'});}catch(e){console.error("[firestore]", e);}}}
                                  className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-colors ${t.status==='Netleştirildi'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700 hover:bg-emerald-100 hover:text-emerald-700'}`}>
                                  {t.status==='Netleştirildi'?(mc(tr643).netlestirildi):(mc(tr643).netlestir)}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* ── Phase 610: Kâr Merkezi Analizi ──────────────────────────────── */}
                  {muhasebeTab === 'pnl' && (() => {
                    const tr610 = currentLanguage === 'tr';
                    const now610 = new Date();
                    let start610: Date;
                    if (p610Period==='this_month') start610 = new Date(now610.getFullYear(), now610.getMonth(), 1);
                    else if (p610Period==='last_month') start610 = new Date(now610.getFullYear(), now610.getMonth()-1, 1);
                    else start610 = new Date(now610.getFullYear(), 0, 1); // YTD
                    const end610 = p610Period==='last_month' ? new Date(now610.getFullYear(), now610.getMonth(), 0, 23, 59, 59, 999) : now610;   // ayın son günü dahil
                    const periodOrders = orders.filter(o => {
                      if (!o.createdAt) return false;   // iptal dışlaması karMerkezleri'nde
                      const d=zamanDate(o.createdAt);
                      return !!d&&d>=start610&&d<=end610;
                    });
                    // TEK KAYNAK (Faz 3, 2026-09-14): Phase 566 ile aynı fonksiyon (faturaTakipTahmin.karMerkezleri). Burada
                    // `o.totalPrice||0`, `costPrice||0`, `quantity||0` ve "gelirsiz kanal %0 marj" kopyası vardı: tutarı bilinmeyen
                    // sipariş ₺0 ciro, maliyetsiz kalem ₺0 maliyet (= %100 marj) sayılıyordu. Gelir/maliyet ekranTutari (kısmi + not;
                    // hiç bilinen yoksa '—'); brüt kâr/marj bir taraf eksikse null → '—' (toplam satırı dâhil: karMerkeziToplami).
                    const rows = karMerkezleri(periodOrders, oc(tr610).diger);
                    const toplam610 = karMerkeziToplami(rows, oc(tr610).toplam);
                    const tutarsiz610 = (t: { bilinmeyen: number }, etiket: string) => t.bilinmeyen > 0 ? <span className="ml-1 text-[10px] font-normal text-amber-600">({t.bilinmeyen} {etiket})</span> : null;
                    const marj610 = (m: number | null, esik: readonly [number, number]) => m === null ? <span className="text-gray-400">—</span> : <span className={m>=esik[0]?'text-emerald-600':m>=esik[1]?'text-amber-600':'text-red-600'}>%{m.toFixed(1)}</span>;
                    if (rows.length === 0) return null;
                    return (
                      <div className="apple-card p-5 mt-4 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">🏢 {mc(tr610).kar_merkezi_analizi}</h3>
                          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                            {([{k:'this_month',l:oc(tr610).bu_ay},{k:'last_month',l:oc(tr610).gecen_ay},{k:'ytd',l:'YTD'}] as {k:'this_month'|'last_month'|'ytd';l:string}[]).map(t=>(
                              <button key={t.k} onClick={()=>setP610Period(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p610Period===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                            ))}
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-100 bg-gray-50">
                              {[mc(tr610).merkez,oc(tr610).ciro,oc(tr610).maliyet,oc(tr610).kar_marji,oc(tr610).siparis_2].map(h=>(
                                <th key={h} className="px-4 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                              ))}
                            </tr></thead>
                            <tbody className="divide-y divide-gray-50">
                              {rows.map(r=>(
                                <tr key={r.ad} className="hover:bg-gray-50/50">
                                  <td className="px-4 py-2.5 font-medium text-gray-800">{r.ad}</td>
                                  <td className="px-4 py-2.5 font-mono text-gray-700">{paraYaz(ekranTutari(r.gelir), { ondalik: 0 })}{tutarsiz610(r.gelir, mc(tr610).kayit_tutarsiz)}</td>
                                  <td className="px-4 py-2.5 font-mono text-gray-500">{paraYaz(ekranTutari(r.maliyet), { ondalik: 0 })}{tutarsiz610(r.maliyet, mc(tr610).kalem_maliyetsiz)}</td>
                                  <td className="px-4 py-2.5 font-bold">{marj610(r.marj, [50, 20])}</td>
                                  <td className="px-4 py-2.5 text-gray-500">{r.adet}</td>
                                </tr>
                              ))}
                              <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                                <td className="px-4 py-2 text-gray-700">{toplam610.ad}</td>
                                <td className="px-4 py-2 font-mono text-gray-700">{paraYaz(ekranTutari(toplam610.gelir), { ondalik: 0 })}{tutarsiz610(toplam610.gelir, mc(tr610).kayit_tutarsiz)}</td>
                                <td className="px-4 py-2 font-mono text-gray-500">{paraYaz(ekranTutari(toplam610.maliyet), { ondalik: 0 })}{tutarsiz610(toplam610.maliyet, mc(tr610).kalem_maliyetsiz)}</td>
                                <td className="px-4 py-2">{marj610(toplam610.marj, [30, -Infinity])}</td>
                                <td className="px-4 py-2 text-gray-500">{toplam610.adet}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}

                </>
              )}
            </motion.div>
  );
}
