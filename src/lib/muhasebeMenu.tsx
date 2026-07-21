/**
 * muhasebeMenu.tsx — Muhasebe & Finans için TEK kaynak menü tanımı.
 *
 * Amaç (2026-07-21 kullanıcı isteği): dikey sidebar alt menüsü ile AccountingModule
 * yatay sekme barı AYNI listeyi göstersin, tekrar olmasın. İkisi de bu diziden
 * render edilir → garantili aynı, tek yerden yönetilir.
 *
 * Çakışan ~7 kavram (Banka, Kasa, Tahsilat, KDV, Bütçe, Sabit Kıymet, Maliyet)
 * TEKE indirildi: ERP kayıt ekranı (AccountingModule sekmesi) tutuldu, analiz
 * kopyaları (muhasebeTab) menüden çıkarıldı — ekranlar kodda durur, sadece bu
 * menüde listelenmez. Değiştirmek için ilgili satırın target'ını 'muhasebe' yap.
 *
 * target.kind:
 *  - 'accounting' → AccountingModule iç sekmesi (muhasebeTab='genel' altında)
 *  - 'muhasebe'   → MuhasebePage muhasebeTab içeriği (analiz/rapor ekranları)
 *  - 'app'        → üst seviye activeTab (ayrı sayfalar)
 */
import {
  FileText, Link as LinkIcon, Palette, Building2, BookOpen, ArrowUpDown,
  Landmark, CreditCard, Wallet, Calculator, BarChart3, ShoppingCart, Users,
  Truck, Package, Home, ArrowRightLeft, FileUp, FileDown, Layers, Briefcase,
  Scale, TrendingUp, Activity, Receipt, PieChart, RefreshCw, Percent, Bell,
  Building, CalendarDays, GitCompare, Repeat, Network, LineChart, FileCheck2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type MuhasebeTarget =
  | { kind: 'accounting'; tab: string }
  | { kind: 'muhasebe'; tab: string }
  | { kind: 'app'; tab: string };

export interface MuhasebeMenuItem {
  id: string;      // sidebar subId + benzersiz anahtar
  tr: string;
  en: string;
  icon: LucideIcon;
  target: MuhasebeTarget;
}

const A = (tab: string): MuhasebeTarget => ({ kind: 'accounting', tab });
const M = (tab: string): MuhasebeTarget => ({ kind: 'muhasebe', tab });
const P = (tab: string): MuhasebeTarget => ({ kind: 'app', tab });

export const MUHASEBE_MENU: MuhasebeMenuItem[] = [
  // ── ERP kayıt / işlem ekranları (AccountingModule) ──────────────────────────
  { id: 'faturalar',        tr: 'Faturalar',           en: 'Invoices',        icon: FileText,      target: A('faturalar') },
  { id: 'e-fatura',         tr: 'e-Fatura',            en: 'e-Invoice',       icon: LinkIcon,      target: A('e-fatura') },
  { id: 'evrak_tasarimi',   tr: 'Evrak Tasarımı',      en: 'Doc Design',      icon: Palette,       target: A('evrak_tasarimi') },
  { id: 'yevmiye',          tr: 'Yevmiye',             en: 'Journal',         icon: BookOpen,      target: A('yevmiye') },
  { id: 'mizan',            tr: 'Mizan',               en: 'Trial Balance',   icon: ArrowUpDown,   target: A('mizan') },
  { id: 'banka',            tr: 'Banka & Kasa',        en: 'Bank & Cash',     icon: Building2,     target: A('banka') },           // ← 'banka' analiz kopyası buraya indirgendi
  { id: 'banka_hareketleri',tr: 'Banka Hareketleri',   en: 'Bank Movements',  icon: Landmark,      target: A('banka_hareketleri') },
  { id: 'cekler',           tr: 'Çekler',              en: 'Checks',          icon: CreditCard,    target: A('cekler') },
  { id: 'tahsilat',         tr: 'Tahsilat',            en: 'Collections',     icon: Wallet,        target: A('tahsilat') },        // ← 'tahsilat' analiz kopyası indirgendi
  { id: 'kasa',             tr: 'Kasa',                en: 'Cash Desk',       icon: Wallet,        target: A('kasa') },            // ← 'kasa' analiz kopyası indirgendi
  { id: 'kdv',              tr: 'KDV',                 en: 'VAT',             icon: Calculator,    target: A('kdv') },             // ← 'kdv' (KDV Analiz) indirgendi
  { id: 'gelir',            tr: 'Gelir/Gider',         en: 'Income/Expense',  icon: BarChart3,     target: A('gelir') },
  { id: 'satislar',         tr: 'Satışlar',            en: 'Sales',           icon: ShoppingCart,  target: A('satislar') },
  { id: 'musteriler',       tr: 'Müşteriler',          en: 'Customers',       icon: Users,         target: A('musteriler') },
  { id: 'tedarikciler',     tr: 'Tedarikçiler',        en: 'Suppliers',       icon: Truck,         target: A('tedarikciler') },
  { id: 'urunler',          tr: 'Hizmet & Ürünler',    en: 'Services & Items',icon: Package,       target: A('urunler') },
  { id: 'calisanlar',       tr: 'Çalışanlar',          en: 'Employees',       icon: Users,         target: A('calisanlar') },
  { id: 'depo',             tr: 'Depo',                en: 'Warehouse',       icon: Package,       target: A('depo') },
  { id: 'warehouses',       tr: 'Depo Tanımları',      en: 'Warehouse Defs',  icon: Home,          target: A('warehouses') },
  { id: 'transfer',         tr: 'Depolar Arası',       en: 'Transfers',       icon: ArrowRightLeft,target: A('transfer') },
  { id: 'giden_irsaliye',   tr: 'Giden İrsaliye',      en: 'Outbound Waybill',icon: FileUp,        target: A('giden_irsaliye') },
  { id: 'gelen_irsaliye',   tr: 'Gelen İrsaliye',      en: 'Inbound Waybill', icon: FileDown,      target: A('gelen_irsaliye') },
  { id: 'sabit_kiymet',     tr: 'Sabit Kıymet',        en: 'Fixed Assets',    icon: Landmark,      target: A('sabit_kiymet') },    // ← 'sabit-kiymet' indirgendi
  { id: 'maliyet_merkezi',  tr: 'Maliyet Merkezleri',  en: 'Cost Centers',    icon: Layers,        target: A('maliyet_merkezi') }, // ← 'maliyet' indirgendi
  { id: 'isletme_sermayesi',tr: 'İşletme Sermayesi',   en: 'Working Capital', icon: Briefcase,     target: A('isletme_sermayesi') },
  { id: 'butce',            tr: 'Bütçe',               en: 'Budget',          icon: BarChart3,     target: A('butce') },           // ← 'butce' (Bütçe & Senaryo) indirgendi

  // ── Rapor / analiz ekranları (MuhasebePage muhasebeTab) ─────────────────────
  { id: 'bilanco',          tr: 'Bilanço',             en: 'Balance Sheet',   icon: Scale,         target: M('bilanco') },
  { id: 'pnl',              tr: 'P & L',               en: 'P & L',           icon: TrendingUp,    target: M('pnl') },
  { id: 'nakit-akis',       tr: 'Nakit Akışı',         en: 'Cash Flow',       icon: Wallet,        target: M('nakit-akis') },
  { id: 'cari',             tr: 'Cari Hesap',          en: 'Acct Statement',  icon: FileText,      target: M('cari') },
  { id: 'ar-aging',         tr: 'AR Yaşlandırma',      en: 'AR Aging',        icon: Users,         target: M('ar-aging') },
  { id: 'ap',               tr: 'Borç Yönetimi',       en: 'Payables',        icon: Building,      target: M('ap') },
  { id: 'mutabakat',        tr: 'Mutabakat',           en: 'Reconciliation',  icon: RefreshCw,     target: M('mutabakat') },
  { id: 'masraf',           tr: 'Masraf Yönetimi',     en: 'Expenses',        icon: Receipt,       target: M('masraf') },
  { id: 'babs',             tr: 'Ba/Bs Formu',         en: 'Ba/Bs Form',      icon: FileCheck2,    target: M('babs') },
  { id: 'fatura-takip',     tr: 'e-Fatura Takip',      en: 'e-Invoice Track', icon: LinkIcon,      target: M('fatura-takip') },
  { id: 'finansal-oranlar', tr: 'Finansal Oranlar',    en: 'Fin. Ratios',     icon: Activity,      target: M('finansal-oranlar') },
  { id: 'fiyat-kural',      tr: 'Fiyat Kuralları',     en: 'Pricing Rules',   icon: Percent,       target: M('fiyat-kural') },
  { id: 'butce-gercek',     tr: 'Bütçe vs Gerçekleşen',en: 'Budget vs Actual',icon: BarChart3,     target: M('butce-gercek') },
  { id: 'oto-fatura',       tr: 'Oto. Fatura',         en: 'Auto-Invoice',    icon: Repeat,        target: M('oto-fatura') },
  { id: 'gelir-tanima',     tr: 'Gelir Tanıma',        en: 'Rev. Recognition',icon: PieChart,      target: M('gelir-tanima') },
  { id: 'kdv-mutabakat',    tr: 'KDV Mutabakat',       en: 'VAT Recon',       icon: Calculator,    target: M('kdv-mutabakat') },
  { id: 'gelir-gider-butce',tr: 'Gelir/Gider Bütçe',   en: 'Rev/Exp Budget',  icon: BarChart3,     target: M('gelir-gider-butce') },
  { id: 'varyans-analiz',   tr: 'Varyans Analizi',     en: 'Variance',        icon: LineChart,     target: M('varyans-analiz') },
  { id: 'kur-degerleme',    tr: 'Kur Değerleme',       en: 'FX Revaluation',  icon: RefreshCw,     target: M('kur-degerleme') },
  { id: 'tekrar-fatura',    tr: 'Tekrarlayan Fatura',  en: 'Recurring',       icon: Repeat,        target: M('tekrar-fatura') },
  { id: 'sirket-arasi',     tr: 'Şirketlerarası',      en: 'Intercompany',    icon: GitCompare,    target: M('sirket-arasi') },

  // ── Analiz/rapor ekranları — ERP kayıt ekranından FARKLI (2026-07-21 geri
  //    getirildi). Aynı isimliler değil: bunlar rapor, ERP tarafı kayıt.
  //    (kasa/sabit-kıymet/maliyet GERİ GETİRİLMEDİ — onlar ERP ile AYNI component.)
  { id: 'banka-mutabakat',  tr: 'Banka Mutabakatı',    en: 'Bank Reconciliation', icon: Landmark,  target: M('banka') },
  { id: 'tahsilat-takip',   tr: 'Tahsilat Takibi',     en: 'Collection Tracking', icon: Wallet,    target: M('tahsilat') },
  { id: 'kdv-analiz',       tr: 'KDV Analizi',         en: 'VAT Analysis',    icon: Calculator,    target: M('kdv') },
  { id: 'butce-plan',       tr: 'Bütçe Planı',         en: 'Budget Plan',     icon: BarChart3,     target: M('butce') },

  // ── Ayrı sayfalar (üst seviye activeTab) ────────────────────────────────────
  { id: 'dunning',          tr: 'Otomatik Hatırlatıcı',en: 'Dunning',         icon: Bell,          target: P('dunning') },
  { id: 'holding',          tr: 'Holding Yönetimi',    en: 'Holding',         icon: Network,       target: P('holding') },
  { id: 'gelirtanima',      tr: 'IFRS 15 Gelir Tanıma',en: 'IFRS 15',         icon: PieChart,      target: P('gelirtanima') },
  { id: 'finance',          tr: 'Finans Paneli',       en: 'Finance Panel',   icon: BarChart3,     target: P('finance') },
  { id: 'ebelge',           tr: 'E-Belge Merkezi',     en: 'E-Documents',     icon: FileText,      target: P('ebelge') },
  { id: 'vergi',            tr: 'Vergi Takvimi',       en: 'Tax Calendar',    icon: CalendarDays,  target: P('vergi') },
];

/** AccountingModule iç sekmesine karşılık gelen menü id'leri (bar aktif-highlight için). */
export const MUHASEBE_ACCOUNTING_TABS = MUHASEBE_MENU
  .filter(m => m.target.kind === 'accounting')
  .map(m => (m.target as { kind: 'accounting'; tab: string }).tab);
