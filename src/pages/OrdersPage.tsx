import { kartMaliyetiTL } from '../utils/cost';
const CanliSevkiyatPanel = React.lazy(() => import('../components/CanliSevkiyatPanel'));
import { eslesir } from '../utils/arama';
import { gorunenSiparisNo, siparisTarih, siparisTarihMs, odemeTakipli } from '../utils/siparis';
import { irsaliyeIstegi, irsaliyeNedenMetni } from '../utils/siparisler/irsaliyeGonder';
import { faturaKesilebilir, mikroyaFaturaGonderilebilir } from '../utils/siparisler/faturaDurumu';
import { yerelDegistirilebilir, sevkiyatEngeli, sevkiyatEngeliMetni, yerelDegistirilemezMetni } from '../utils/siparisler/siparisIslemleri';
import { useMikroSiparisKalemleri } from '../hooks/useMikroSiparisKalemleri';
import MikroSiparisKalemleri from '../components/siparis/MikroSiparisKalemleri';
import { kalemleriMikrodanOkunacak, mikroFaturaKalemleriGetir, mikroKalemTablosu, kayitliKalemTablosu, kayitliMikroKalemleri } from '../services/mikroFaturaKalemleri';
import { kalemTutari, kalemBirimFiyati, kdvDahilKalemVar } from '../utils/pano/stokSevkiyat';
import { authFetch } from '../services/authFetch';
import { mikroDepoSecenekleri } from '../utils/muhasebe/depoNo';
import { onayAcikMi } from '../lib/confirm';
import { siparisBelgeTipi, type BelgeTipi } from '../utils/siparisler/belgeTipi';
import { zamanMs, zamanDate, gunBasi, gunAnahtari, ayAnahtari, tarihYaz, tarihSaatYaz, bugunAnahtari } from '../utils/zaman';
import type { BinSatiri } from '../hooks/useSekmeVerileri';
import type { VehiclePosition } from '../types';
import React, { useState, useEffect, useMemo } from 'react';
import { pdfBaslik, pdfAltBilgi, pdfTabloStili, PDF_RENK, PDF_ALT_BANT_YUKSEKLIK } from '../utils/pdfTheme';
import { confirmDelete } from '../lib/confirm';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Search, X, ChevronDown,
  ArrowLeft, Package, TrendingUp,
  Clock, CheckCircle2, AlertTriangle, AlertCircle,
  Truck, MapPin, RefreshCw, Edit2, Trash2,
  Copy, Download,
  FileText, FileDown, FileUp, MessageSquare, GripVertical, Building2, Globe,
  Navigation, Users, Bell, Check, CreditCard,
  ArrowRightLeft, Link, Route, Ship, History, QrCode,
} from 'lucide-react';
import { db, auth } from '../firebase';
import {
  doc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, serverTimestamp, incrementField, onSnapshot, query,
} from '../lib/dbClient';
import { logFirestoreError as handleFirestoreError, OperationType } from '../utils/firebase';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { exportOrdersCSV } from '../utils/export';
import { formatInCurrency, paraYaz, kisaTutar } from '../utils/currency';
import { registerTurkishFont } from '../utils/pdfFont';
import AIInlineNudge from '../components/AIInlineNudge';
import ModuleHeader from '../components/ModuleHeader';
import KpiCurrencyToggle from '../components/KpiCurrencyToggle';
import AccountingModule from '../components/AccountingModule';
const CargoTrackingTab = React.lazy(() => import('../components/CargoTrackingTab'));
const LogisticsMapLazy = React.lazy(() => import('../components/LogisticsMap'));
const LogisticsMap = LogisticsMapLazy;
import type { Lead, Order, OrderLineItem, Employee, InventoryItem, RouteStop, Shipment, Warehouse, Vehicle, LocationStock } from '../types';
import LocationQRModal from '../components/LocationQRModal';
import TransferScanPanel from '../components/TransferScanPanel';
import CustomerCombobox from '../components/CustomerCombobox';
import { useMikroSiparisler } from "../hooks/useMikroSiparisler";
import { mikroSiparisindenPanoSiparisi } from '../utils/pano/mikroBirlesim';
import LocationStockReport from '../components/LocationStockReport';
import { faturaTipiEtiketi, siparisDurumEtiketi } from '../utils/durumEtiketi';
import { sablonGetir, sablonRengi, bankaBilgisiBasilir, belgeAltBilgisiCiz } from '../utils/belgeSablonu';
import { siparisStokPlani, stokGecisi, ATLANMA_SEBEBI } from '../utils/siparisStok';
import { satirTutari, ekranTutari, sayiSirala, toplaBilinen } from '../utils/para';
import { teslimPerformansi, oranYuzde, ihracatToplami, ihracatToplamiYaz, memnuniyetOrtalamasi } from '../utils/siparisler/lojistikKpi';
import { siparisKarliligi, mesajTutari, kalemlerTutari, stokKartiBul, BILINMIYOR } from '../utils/siparisler/siparisKarlilik';
import { odenmemisOzeti, kovaTutari } from '../utils/siparisler/tahsilatVade';
import { iadeTutariDogrula, iadeOnTutar, iadeTutarYamasi, iadeGorunenTutar } from '../utils/siparisler/iadeTalep';
import { kdvEtiketi, sayiGirdisi, miktarDogrula, degerDogrula, gorunenDeger, sevkiyatDegeriKaydi, kdvOraniDogrula, siparisDuzenlemeYamasi, yerelTutar, yerelSayi } from '../utils/siparisler/formKayit';
import SevkDeposuSecici from '../components/SevkDeposuSecici';
import { formSayisi, girilenAlanYamasi } from '../utils/muhasebe/irsaliyeCalisan';
import { oc } from '../i18n/ortak';
import { op } from '../i18n/orders';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

const SortIcon = ({ col, config }: { col: string; config: { key: string; dir: 'asc' | 'desc' } }) => (
  <span className="inline-flex flex-col ml-0.5 opacity-40">
    <span style={{ fontSize: 8 }}>{config.key === col && config.dir === 'asc' ? '▲' : '▴'}</span>
    <span style={{ fontSize: 8 }}>{config.key === col && config.dir === 'desc' ? '▼' : '▾'}</span>
  </span>
);

// Maliyet sınıflandırması tek kaynaktan: src/utils/cost.ts (kopyasi 2026-08-26'da kaldirildi).
// `itemCostTRY` BU SAYFADA KULLANILMAZ: çevrilemeyen kalem için 0 döner (cost.ts'te belgeli),
// o kalem sessizce "maliyetsiz" olup marjı şişirirdi. `maliyetDurumu(...).durum === 'tl'` süzgeci
// de YETMİYOR — maliyeti hiç girilmemiş kart {durum:'tl', tl:0} döndüğü için o süzgeci geçiyor ve
// marj %100 çıkıyordu (2026-09-19 hakem bulgusu). Doğru kapı: `kartMaliyetiTL` (bilinmiyorsa null).

type TimelineEntry = { action: string; actor: string; ts: number; note?: string };

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
        {oc(isTR).siparis_durumu}
      </p>
      {isCancelled ? (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <X className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <p className="font-bold text-red-600 text-sm">{oc(isTR).siparis_iptal_edildi}</p>
            <p className="text-[11px] text-red-400">{op(isTR).bu_siparis_iptal_edilmistir}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-end">
          {ORDER_STATUS_STEPS.map((step, idx) => {
            const done = activeIdx >= idx;
            const active = activeIdx === idx;
            const Icon = step.icon;
            return (
              <React.Fragment key={step.key}>
                <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 ${done ? 'bg-brand text-white' : 'bg-gray-100 text-gray-300'} ${active ? 'ring-4 ring-brand/20 scale-110' : ''}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`text-[9px] text-center font-bold leading-tight max-w-[60px] ${done ? 'text-brand' : 'text-gray-300'}`}>
                    {isTR ? step.labelTR : step.labelEN}
                  </span>
                </div>
                {idx < ORDER_STATUS_STEPS.length - 1 && (
                  <div className={`flex-1 h-[3px] mb-[22px] mx-1.5 rounded-full transition-all duration-500 ${activeIdx > idx ? 'bg-brand' : 'bg-gray-100'}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

type DepotKey = 'eski_sanayi' | 'havalimani';
interface Depot { name: string; lat: number; lng: number; }

interface Props {
  selectedOrder: Order | null;
  setSelectedOrder: React.Dispatch<React.SetStateAction<Order | null>>;
  lojistikTab: string;
  setLojistikTab: (tab: string) => void;
  routeStops: RouteStop[];
  isRouteOptimized: boolean;
  selectedDepot: DepotKey;
  setSelectedDepot: (d: DepotKey) => void;
  DEPOTS: Record<DepotKey, Depot>;
  recurringOrders: Array<{ id: string; templateName: string; customerName: string; totalPrice: number; frequency: 'weekly' | 'monthly' | 'quarterly'; nextDue: string; active: boolean }>;
  hasFullAccess: (tab: string) => boolean;
  currentLanguage: 'tr' | 'en';
  currentT: Record<string, string>;
  orders: Order[];
  leads: Lead[];
  inventory: InventoryItem[];
  exchangeRates: Record<string, number> | null;
  employees: Employee[];
  userRole: string;
  user: { email?: string | null; uid?: string; displayName?: string | null } | null;
  kpiCurrency: 'TRY' | 'USD' | 'EUR';
  /** 2026-09-04: sayfa `kpiCurrency`'yi OKUYUP tutarları çeviriyordu ama hiçbir
   *  seçici RENDER ETMİYORDU — kullanıcı Siparişler'deyken para birimini
   *  değiştiremiyordu (başka sayfada değiştirip geri gelmesi gerekiyordu). */
  setKpiCurrency: (c: 'TRY' | 'USD' | 'EUR') => void;
  activeTab: string;
  darkMode: boolean;
  warehouses: Warehouse[];
  vehicles: Vehicle[];
  /** Araçların son bilinen konumu — Canlı Sevkiyat ekranı için. */
  aracKonumlari: VehiclePosition[];
  /** Konum YAZMA yetkisi (Admin/Manager/Logistics) — yoksa 403 alınırdı. */
  konumYazabilir: boolean;
  /** e-İrsaliye kesme yetkisi — sunucudaki kapıyla AYNI kural: `shipments` yazma (Admin/Manager/Logistics). */
  irsaliyeKesebilir: boolean;
  /** Konumu kimin paylastigi kaydedilsin (izlenebilirlik). */
  kullaniciUid?: string;
  locationStocks: LocationStock[];
  shipments: Shipment[];
  newOrder: Partial<Order>;
  setNewOrder: React.Dispatch<React.SetStateAction<Partial<Order>>>;
  orderLineItems: OrderLineItem[];
  setOrderLineItems: React.Dispatch<React.SetStateAction<OrderLineItem[]>>;
  handleMikroFatura: (order: Order) => Promise<void>;
  handleEIrsaliye: (order: Order) => Promise<void>;
  /**
   * id → e-İrsaliye gönderimi SÜRÜYOR. App.tsx'ten gelir (istek orada atılıyor).
   * Düğme bunu okumazsa yanıt beklerken etkin kalır ve ikinci tıklama Mikro'da İKİNCİ
   * resmî belge üretir. Sayfa-yerel `useState` ile taklit EDİLEMEZ: bu sayfadaki
   * `faturaLoading` / `iyzicoLinkLoading` setter'sız yerel state, yani kalıcı `{}` —
   * o düğmelerin "yükleniyor" koruması fiilen ÖLÜ (ayrı açık madde).
   */
  eIrsaliyeGonderiliyor: Record<string, boolean>;
  handleIyzicoPaymentLink: (order: Order) => Promise<void>;
  setRouteStops: React.Dispatch<React.SetStateAction<RouteStop[]>>;
  /**
   * p554Bins — kancadan (useSekmeVerileri) gelen CANLI veri.
   *
   * Burada eskiden `const [p554Bins] = useState<...>([])` vardi: setter'siz,
   * kalici olarak BOS bir yerel state. Ekran onu okuyordu, dolayisiyla
   * sayaclar hep 0 gorunuyor ve eklenen kayit listede cikmiyordu — oysa veri
   * DB'ye yaziliyor ve kancadaki dinleyici okuyordu. Prop olarak alinmali.
   */
  p554Bins: BinSatiri[];
  handleBuildRoute: () => void;
  handleClearRoute: () => void;
  handleToggleOrderPaid: (order: Order) => void;
  trackView: (item: { type: 'order' | 'lead' | 'product'; id: string; label: string; tab: string }) => void;
  openConfirm: (opts: { title: string; message: string; confirmLabel?: string; variant?: 'danger' | 'default'; onConfirm: () => void }) => void;
  toast: (msg: string, type?: string) => void;
  setActiveTab: (tab: string) => void;
  setSelectedLead: React.Dispatch<React.SetStateAction<Lead | null>>;
  setIsAddingOrder: React.Dispatch<React.SetStateAction<boolean>>;
  logAuditAction: (action: string, details: string) => Promise<void>;
}

export default function OrdersPage({
  selectedOrder, setSelectedOrder, lojistikTab, setLojistikTab,
  routeStops, isRouteOptimized, selectedDepot, setSelectedDepot, DEPOTS,
  recurringOrders, hasFullAccess, currentLanguage, currentT,
  orders, leads, inventory, exchangeRates, employees,
  userRole, user, kpiCurrency, setKpiCurrency, activeTab, darkMode, warehouses, vehicles, aracKonumlari, konumYazabilir, irsaliyeKesebilir, kullaniciUid, locationStocks, shipments,
  newOrder, setNewOrder, orderLineItems, setOrderLineItems,
  handleMikroFatura, handleEIrsaliye, eIrsaliyeGonderiliyor, handleIyzicoPaymentLink, setRouteStops, handleBuildRoute, handleClearRoute, p554Bins,
  handleToggleOrderPaid, trackView, openConfirm,
  toast, setActiveTab, setSelectedLead, setIsAddingOrder,
  logAuditAction,
}: Props) {
  const [orderSearch, setOrderSearch] = useState('');
  const [orderSort, setOrderSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'syncedAt', dir: 'desc' });
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('All');
  const [orderCustomerFilter, setOrderCustomerFilter] = useState<string|null>(null);
  const [orderDateRange, setOrderDateRange] = useState<'all'|'today'|'week'|'month'|'quarter'>('all');
  const [expandedOrderId, setExpandedOrderId] = useState<string|null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [copiedOrderId, setCopiedOrderId] = useState<string|null>(null);
  const [starredOrders, setStarredOrders] = useState<Set<string>>(new Set());
  const [showQuickShipment, setShowQuickShipment] = useState<Order|null>(null);
  /** Detay/pencere bir anın kopyasını tutar; kural kararları canlı listedeki GÜNCEL kayıttan verilir. */
  const guncelSiparis = (o: Order): Order => orders.find(x => x.id === o.id) ?? o;
  /** Mikro faturasından türeyip kalemleri Cetpa'ya aktarılmamış siparişin kalemleri — Mikro'dan canlı (MF-383, 2026-09-25). */
  const mikroKalemler = useMikroSiparisKalemleri(selectedOrder, currentLanguage === 'tr');
  /** "Alacak Toplam" kartı: ödeme takibi Cetpa'da OLMAYAN (Mikro kaynaklı) siparişlerde alacağın gerçeği Mikro cari
   *  bakiyesindedir — /api/reports/mikro-cari-alacak (2026-09-25: tüm siparişler Mikro kaynaklıyken kart '—' idi). */
  const [mikroAlacak, setMikroAlacak] = useState<{ alacak: number | null; cariSayisi: number; bilinmeyenCari: number; guncellemeMs: number | null } | 'yok' | null>(null);
  useEffect(() => {
    let iptal = false;
    authFetch('/api/reports/mikro-cari-alacak')
      .then(r => r.json())
      .then((d: { success?: boolean; veriYok?: boolean; alacak?: unknown; cariSayisi?: unknown; bilinmeyenCari?: unknown; guncellemeMs?: unknown }) => {
        if (iptal) return;
        // 'yok' = uç yetki vermedi / hata / Mikro bakiyesi hiç çekilmemiş → kart eski metinle '—'.
        if (!d || !d.success || d.veriYok) { setMikroAlacak('yok'); return; }
        setMikroAlacak({
          alacak: typeof d.alacak === 'number' && Number.isFinite(d.alacak) ? d.alacak : null,   // null = hiçbir bakiye okunamadı → '—'
          cariSayisi: Number(d.cariSayisi), bilinmeyenCari: Number(d.bilinmeyenCari),
          guncellemeMs: typeof d.guncellemeMs === 'number' ? d.guncellemeMs : null,
        });
      })
      .catch(() => { if (!iptal) setMikroAlacak('yok'); });
    return () => { iptal = true; };
  }, []);
  const [showInvoiceAging, setShowInvoiceAging] = useState(false);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [editingOrderData, setEditingOrderData] = useState<Partial<Order>>({});
  // Tutar kutusunun HAM metni ayrı tutulur: Partial<Order>.totalPrice `number` olduğu için
  // boş kutu ancak `Number('') === 0` ile temsil edilebiliyordu (sahte ₺0). '' = bilinmiyor.
  const [editingTutarHam, setEditingTutarHam] = useState('');
  /** KDV oranı kutusunun HAM metni — aynı sebeple ayrı: '' = bilinmiyor, `?? 20` uydurulmaz. */
  const [editingKdvHam, setEditingKdvHam] = useState('');
  const [isAddingShipment, setIsAddingShipment] = useState(false);
  const [newShipment, setNewShipment] = useState<Partial<Shipment>>({ status: 'Pending' });
  const [editingShipmentId, setEditingShipmentId] = useState<string|null>(null);
  const [deliveryNoteOrder, setDeliveryNoteOrder] = useState<Order|null>(null);
  const [deliveryNoteText, setDeliveryNoteText] = useState('');
  const [orderNoteText, setOrderNoteText] = useState('');
  const [orderNoteSaved, setOrderNoteSaved] = useState(false);
  const [orderNoteSaving, setOrderNoteSaving] = useState(false);
  const [orderTimeline] = useState<TimelineEntry[]>([]);
  const [faturaLoading] = useState<Record<string, boolean>>({});
  const [iyzicoLinkLoading] = useState<Record<string, boolean>>({});
  const [returnModal, setReturnModal] = useState<{ open: boolean; order: Order | null }>({ open: false, order: null });
  const [returnReason, setReturnReason] = useState('');
  const [returnItems, setReturnItems] = useState<string>('');
  // BOŞ = bilinmiyor (₺0 DEĞİL): ön-dolum sipariş toplamı bilinmeyince alanı boş bırakır.
  const [returnAmount, setReturnAmount] = useState<number | null>(null);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  // `totalPrice` HAM metin tutulur ('' = bilinmiyor): sayı tutulduğunda boş kutu ancak
  // `Number('') === 0` ile temsil edilebiliyordu ve ₺0 şablon sessizce ₺0 sipariş üretiyordu.
  const [recurringForm, setRecurringForm] = useState({ templateName: '', customerName: '', totalPrice: '', frequency: 'monthly' as 'weekly' | 'monthly' | 'quarterly', nextDue: '' });
  const [shipmentSort, setShipmentSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [dragIndex, setDragIndex] = useState<number|null>(null);

  // ── MİKRO ENTEGRASYONU ──
  const [orderSourceTab, setOrderSourceTab] = useState<'cetpa' | 'mikro'>('cetpa');
  const mikroSiparisler = useMikroSiparisler(true);
  // Eşleme KOPYASI KALDIRILDI (2026-09-19 delta bulgusu): burada elle yazılan
  // `totalPrice: ms.tutar` alanı HER ZAMAN yazılıyordu ve hook o alanı `Number(sip_tutar || 0)`
  // ile ürettiği için Mikro aynasında `sip_tutar` NULL gelen sipariş "₺0,00" tutarlı bir kayıt
  // gibi listeleniyor, KPI ve CSV toplamlarına 0 olarak giriyordu. Aynı kayıt Pano'da (ham
  // kolonu okuyan `mikroBirlesim`) "tutarı okunamadı" diye '—' basılıyordu — bir kayıt, iki
  // ekran, iki farklı anlam. Tutar kuralı artık TEK yerde: `mikroSiparisindenPanoSiparisi`
  // tutarı bilinmiyorsa `totalPrice` alanını HİÇ YAZMAZ (`siparisTutari` NaN döner, `toplaBilinen`
  // kaydı toplama katmaz ama SAYAR).
  //
  // `tip === 0` süzgeci ve ekstra alanlar (belge no / açıklama / boş kalem listesi) bu sayfaya
  // özgü olduğu için burada kaldı; modülün kendi `panoMikroSiparisleri` süzgeci `tip`i bilinmeyen
  // kaydı da alıyor — davranışı değiştirmemek için parite korundu.
  // NOT: `status: 'Pending'` sabiti de sahte kesinlik (Mikro sipariş durumu bilinmiyor) — Açık İş.
  const mappedMikroSiparisler = mikroSiparisler.filter(ms => ms.tip === 0).map(ms => ({
    ...mikroSiparisindenPanoSiparisi(ms),
    mikroBelgeNo: ms.belgeNo,
    notes: ms.satirAciklamasi,
    lineItems: [],
  })) as unknown as Order[];
  
  const activeOrders = orderSourceTab === 'cetpa' ? orders : mappedMikroSiparisler;

  // Faz 3 4/n: ödenmemiş (alacak) özetinin TEK hesabı — Phase 522 KPI şeridi ile Phase 521
  // yaşlandırması artık AYNI kümeyi görüyor. Eskiden iki ayrı süzgeç vardı: KPI tarihi
  // çözülemeyen siparişi sayıyor, yaşlandırma (565'teki `zamanMs(...) !== null`) onu sessizce
  // düşürüyordu; iki panel farklı rakam basıyordu. Tarihsizler artık `vadeOzeti.tarihsiz`.
  // useMemo YOK: `odenmemisOzeti` varsayılan `new Date()` alır, memolanırsa gece yarısını
  // geçince yaş kovaları bayatlar (eski kod da her render'da `Date.now()` okuyordu).
  const vadeOzeti = odenmemisOzeti(activeOrders);

  // Sipariş kârlılığı TEK hesap: Phase 513 popup'ı ile Phase 74 kutusu ARTIK aynı sayıyı gösterir
  // (eskiden iki ayrı kural aynı modalde iki farklı marj basabiliyordu). Kalemin kendi costPrice'ı
  // yoksa stok kartına bakılır; çözüm `kartMaliyetiTL` ile yapılır — `itemCostTRY` ÇEVRİLEMEYEN
  // kalem için 0 döner, `maliyetDurumu(...).durum === 'tl'` süzgeci ise maliyeti hiç GİRİLMEMİŞ
  // kartı ({durum:'tl', tl:0}) eleyemez; ikisi de o kalemi sessizce "maliyetsiz" yapıp marjı
  // %100'e çıkarıyordu (2026-09-19 hakem bulgusu). Uydurma %60 oranı da kalkmıştı.
  // Kart eşleşmesi `stokKartiBul` ile: ham `i.sku === li.sku` kuralı BOŞ SKU'da ('' === '')
  // serbest satırı (nakliye bedeli, kanal siparişi kalemi) katalogdaki SKU'suz İLK karta
  // bağlıyor ve o ilgisiz kartın maliyetini "bilinen maliyet" sayıyordu (2026-09-19 delta).
  const siparisKar = useMemo(
    () => selectedOrder ? siparisKarliligi(selectedOrder, li => {
      const inv = stokKartiBul(inventory, li);
      if (!inv) return null;
      return kartMaliyetiTL(inv, exchangeRates);
    }) : null,
    [selectedOrder, inventory, exchangeRates],
  );

  const [p513Selected, setP513Selected] = useState<string|null>(null);
  const [p554AddForm, setP554AddForm] = useState(false);
  const [p554Draft, setP554Draft] = useState({ warehouseId: '', binCode: '', productSku: '', productName: '', quantity: '', minQty: '', notes: '' });
  const [p554Search, setP554Search] = useState('');
  const [p575Returns, setP575Returns] = useState<Array<{id:string;orderId:string;customerName:string;reason:string;status:'Bekliyor'|'Onaylandı'|'Reddedildi'|'Tamamlandı';amount:number|null;createdAt?:unknown}>>([]);
  const [p575ShowForm, setP575ShowForm] = useState(false);
  const [p575Draft, setP575Draft] = useState({orderId:'',customerName:'',reason:'',amount:''});
  const [p576Period, setP576Period] = useState<'7d'|'30d'|'90d'>('30d');
  const [p583Requests, setP583Requests] = useState<Array<{id:string;customerName:string;productName:string;serialNo?:string;issueDate?:string;warrantyEnd?:string;description:string;status:'Açık'|'İşlemde'|'Kapatıldı';priority:'Düşük'|'Orta'|'Yüksek'}>>([]);
  const [p583ShowForm, setP583ShowForm] = useState(false);
  const [p583Draft, setP583Draft] = useState({customerName:'',productName:'',serialNo:'',warrantyEnd:'',description:'',priority:'Orta' as 'Düşük'|'Orta'|'Yüksek'});
  // Araçlar artık kalıcı (Firestore 'vehicles', vehicles prop). Eski in-memory
  // p593Vehicles kaldırıldı; ekleme/güncelleme/silme Firestore'a yazar.
  const p593Vehicles = vehicles;
  const [p593ShowForm, setP593ShowForm] = useState(false);
  // Depo/araç QR etiket modalı
  const [locationQrModal, setLocationQrModal] = useState<{ type: 'warehouse' | 'vehicle'; id: string; name: string; subtitle?: string } | null>(null);
  const [p593Draft, setP593Draft] = useState({plate:'',driver:'',driverPhone:'',model:'',status:'Müsait' as 'Müsait'|'Yolda'|'Bakımda'|'Arızalı',lastService:'',nextService:'',km:'',fuel:'Dizel' as 'Benzin'|'Dizel'|'LPG'|'Elektrik'});
  const [p609Tickets, setP609Tickets] = useState<Array<{id:string;customer:string;subject:string;priority:'Düşük'|'Orta'|'Yüksek'|'Kritik';status:'Açık'|'İşlemde'|'Çözüldü'|'Kapatıldı';createdAt:string;resolvedAt?:string;slaHours:number;satisfaction?:1|2|3|4|5}>>([]);
  const [p609ShowForm, setP609ShowForm] = useState(false);
  const [p609Draft, setP609Draft] = useState({customer:'',subject:'',priority:'Orta' as 'Düşük'|'Orta'|'Yüksek'|'Kritik',slaHours:'24'});
  const [p621Demands] = useState<Array<{id:string;productName:string;sku:string;requestedQty:number;requestedBy:string;priority:'Düşük'|'Orta'|'Yüksek';status:'Bekliyor'|'Onaylandı'|'Reddedildi'|'Sipariş Verildi';notes?:string;createdAt:string}>>([]);
  const [p621ShowForm, setP621ShowForm] = useState(false);
  const [p621Draft, setP621Draft] = useState({productName:'',sku:'',requestedQty:'',requestedBy:'',priority:'Orta' as 'Düşük'|'Orta'|'Yüksek',notes:''});
  // `value: number | null` — null = tutar BİLİNMİYOR. Eski `Number(v) || 0` kaydı sahte $0
  // yazıyordu; o kayıtların düzeltilebilmesi için alan açıkça null'lanabilmeli (2026-09-19 delta).
  const [p622Shipments, setP622Shipments] = useState<Array<{id:string;orderRef:string;destination:string;incoterm:'EXW'|'FOB'|'CIF'|'DDP';currency:'USD'|'EUR'|'TRY';value:number|null;status:'Hazırlanıyor'|'Gümrükte'|'Yolda'|'Teslim Edildi';exportDate:string;customsRef?:string}>>([]);
  const [p622ShowForm, setP622ShowForm] = useState(false);
  const [p622Draft, setP622Draft] = useState({orderRef:'',destination:'',incoterm:'FOB' as 'EXW'|'FOB'|'CIF'|'DDP',currency:'USD' as 'USD'|'EUR'|'TRY',value:'',status:'Hazırlanıyor' as 'Hazırlanıyor'|'Gümrükte'|'Yolda'|'Teslim Edildi',exportDate:bugunAnahtari(),customsRef:''});

  // ── Kalıcılaştırma (2026-07-21): iade/talep/ticket/sevkiyat artık DB'de ────
  // Sayfa yalnız kendi sekmesinde mount olduğu için abonelikler doğal-tembel.
  const [p575EditId, setP575EditId] = useState<string | null>(null);
  const [p583EditId, setP583EditId] = useState<string | null>(null);
  const [p609EditId, setP609EditId] = useState<string | null>(null);
  const [p622EditId, setP622EditId] = useState<string | null>(null);
  useEffect(() => {
    const u: (() => void)[] = [];
    const sub = (col: string, setter: (d: unknown[]) => void) =>
      u.push(onSnapshot(query(collection(db, col)), s => setter(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => {}));
    sub('salesReturns',    (d) => setP575Returns(d as typeof p575Returns));
    sub('serviceRequests', (d) => setP583Requests(d as typeof p583Requests));
    sub('helpdeskTickets', (d) => setP609Tickets(d as typeof p609Tickets));
    sub('exportShipments', (d) => setP622Shipments(d as typeof p622Shipments));
    return () => u.forEach(fn => fn());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Siralama anahtarini karsilastirilabilir tek bir ilkel degere indirger:
  // Firestore Timestamp -> ms, metin -> kucuk harf, null/undefined -> ''.
  // (Once `let av: unknown` idi; strictNullChecks altinda '<' / '>' unknown'a uygulanamiyor.)
  const sortKeyOf = (raw: unknown): string | number => {
    if (typeof raw === 'string') return raw.toLowerCase();
    if (typeof raw === 'number') return raw;
    if (raw == null) return '';
    // Timestamp / {seconds} / {_seconds} / Date -> ms (tek kaynak: utils/zaman)
    const ms = zamanMs(raw);
    if (ms !== null) return ms;
    // boolean/nesne: JS'in '<' operatorunun bu tipler icin zaten yaptigi metin cevrimi
    return String(raw);
  };

  const sortData = <T,>(arr: T[], key: string, dir: 'asc' | 'desc'): T[] =>
    [...arr].sort((a: T, b: T) => {
      const av = sortKeyOf((a as Record<string, unknown>)[key]);
      const bv = sortKeyOf((b as Record<string, unknown>)[key]);
      if (dir === 'asc') return av < bv ? -1 : av > bv ? 1 : 0;
      return av > bv ? -1 : av < bv ? 1 : 0;
    });

  /** Siparişe özel sıralama: 'syncedAt' anahtarı istendiğinde GÖSTERİLEN tarihi
   *  (siparisTarih: syncedAt→createdAt→orderDate) kullanır. Aksi halde mikro-fatura
   *  türevlerinde syncedAt olmadığı için hepsi '' anahtarıyla aynı kovaya düşüp
   *  tarih sütunu dolu görünürken sıralama rastgele kalıyordu (2026-09-03). */
  const siparisSirala = (arr: Order[], key: string, dir: 'asc' | 'desc'): Order[] => {
    // HÜCRE İLE SIRALAYICI AYNI TANIM: tutarı bilinmeyen siparişte `totalPrice` alanı YOKTUR (hücre '—' basar);
    // genel `sortData` onu '' → 0 sayıp bilinen ₺0 gibi diziyordu. `sayiSirala` bilinmeyeni HER İKİ yönde sona
    // koyar — yön `-fark` ile ÇEVRİLMEZ (para.ts uyarısı: çevrilirse bilinmeyen başa gelir).
    if (key === 'totalPrice') return [...arr].sort((a, b) => sayiSirala(a.totalPrice, b.totalPrice, dir === 'desc'));
    if (key !== 'syncedAt') return sortData(arr, key, dir);
    return [...arr].sort((a, b) => {
      const av = siparisTarihMs(a), bv = siparisTarihMs(b);
      return dir === 'asc' ? av - bv : bv - av;
    });
  };

  const toggleSort = (
    current: { key: string; dir: 'asc' | 'desc' },
    key: string,
    setter: (v: { key: string; dir: 'asc' | 'desc' }) => void
  ) => setter({ key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' });

  // Tek kaynak (Faz 2 1/n, 2026-09-05): kisaTutar — kur yoksa '—' (sembol de basılmaz),
  // 'K' kısaltması, birim sembolü ve yerel gruplama orada. İmza korundu, çağrı yerleri değişmedi.
  const fmtKpi = (v: number, fmt: 'full' | 'K' = 'full', decimals = 0): string =>
    kisaTutar(v, { fmt, ondalik: decimals, birim: kpiCurrency, rates: exchangeRates });

  const createNotification = async (title: string, message: string, type: 'info' | 'warning' | 'success' = 'info') => {
    try { await addDoc(collection(db, 'notifications'), { title, message, type, read: false, createdAt: serverTimestamp() }); } catch { /* ignore */ }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      logAuditAction(currentT.order_deletion || 'Order Deleted', orderId);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `orders/${orderId}`);
    }
  };

  // Sevkiyatta stok düş, iptalde geri yükle (idempotent — order.stockApplied flag).
  // Plan SAF ve TESTLİ: `siparisStokPlani` (utils/siparisStok.ts). Eski gövde
  // `Number(li.quantity) || 0` ile miktarı bilinmeyen satırı ve envanterde bulunmayan
  // ürünü SESSİZCE atlıyordu; sipariş yine "stok uygulandı" damgalanıyordu. Artık
  // atlanan satırlar sebebiyle "düşürülemedi" listesine girer (Faz 1 4/n).
  const applyOrderStock = async (order: Order, direction: 'out' | 'in', reason: string): Promise<string[]> => {
    const plan = siparisStokPlani(order, inventory);
    const dil = currentLanguage === 'tr' ? 'tr' : 'en';
    const basarisiz: string[] = plan.atlanan.map(a => `${a.satir} (${ATLANMA_SEBEBI[a.sebep][dil]})`);  // stoğu GÜNCELLENEMEYEN ürünler (P1)
    for (const h of plan.hareketler) {
      try {
        await incrementField('inventory', h.invId, 'stockLevel', direction === 'out' ? -h.miktar : h.miktar, 0);
        await addDoc(collection(db, 'inventoryMovements'), {
          type: direction, productId: h.invId, productName: h.urunAdi,
          quantity: h.miktar, reason, orderId: order.id, timestamp: serverTimestamp(),
        });
      } catch (err) {
        console.error('[applyOrderStock]', err);
        basarisiz.push(h.urunAdi);
      }
    }
    return basarisiz;
  };

  /**
   * e-İrsaliye HER ZAMAN ONAYLA gider (2026-09-19 kullanıcı kararı: "kendiliğinden gitmesin, onay alsın").
   * Mikro'da RESMÎ belge keser ve geri alınamaz; onay penceresi NEYİN gönderileceğini söyler (müşteri, kalem sayısı,
   * sevk deposu, KDV). Gönderilemeyen siparişte pencere AÇILMAZ (false döner) — nedeni düğmenin ipucunda yazar.
   */
  const eIrsaliyeOnayiAc = (order: Order, giris?: string): boolean => {
    if (!irsaliyeKesebilir) return false;                                  // sunucu da 403 döner (shipments:write)
    const cari = leads.find(l => l.id === order.leadId);
    const istek = irsaliyeIstegi(order, cari);
    if (!istek.gonderilebilir || !istek.govde || order.irsaliyeNo || order.irsaliyeGonderildi) return false;
    // KENDİLİĞİNDEN açılan teklif ("Kargoda" akışı — `giris` dolu) başka bir onayın YERİNE GEÇMEZ: `confirmAction`
    // bekleyen diyaloğu sessizce iptal eder; kullanıcının o pencere için vereceği tıklama resmî belge onayına dönüşürdü.
    if (giris && onayAcikMi()) {
      toast(op(currentLanguage).siparis_kargoda_e_irsaliye_icin_siparis_detayind, 'info');
      return false;
    }
    const depo = mikroDepoSecenekleri(warehouses).find(d => d.no === order.depoNo);
    const depoMetni = depo ? `${depo.no} — ${depo.ad}` : String(order.depoNo);
    const kalem = istek.govde.shipment.items?.length ?? 0;
    // Belgenin GERÇEK alıcısı: sipariş üzerindeki serbest metin ad değil, bağlı CARİ (ad + Mikro cari kodu) — kod
    // gönderilecek GÖVDEDEN okunur ki pencere ile istek aynı kaynaktan beslensin. Adlar ayrışıyorsa açıkça uyarılır.
    const cariAdi = (cari?.company || cari?.name || '').trim();
    const cariKodu = istek.govde.shipment.mikroCariKod;
    const adFarkli = cariAdi !== '' && order.customerName.trim() !== '' && cariAdi !== order.customerName.trim() && (cari?.name || '').trim() !== order.customerName.trim();
    const tr = currentLanguage === 'tr';
    openConfirm({
      title: op(tr).e_irsaliye_gonderilsin_mi,
      message: tr
        ? `${giris ? giris + ' ' : ''}Alıcı cari: ${cariAdi || '—'} (${cariKodu})${adFarkli ? ` — DİKKAT: siparişteki ad "${order.customerName}"` : ''} · ${kalem} kalem · sevk deposu: ${depoMetni} · KDV %${order.kdvOran}. Bu işlem Mikro'da RESMÎ e-İrsaliye keser ve geri alınamaz.`
        : `${giris ? giris + ' ' : ''}Recipient: ${cariAdi || '—'} (${cariKodu})${adFarkli ? ` — NOTE: the order says "${order.customerName}"` : ''} · ${kalem} line(s) · warehouse: ${depoMetni} · VAT ${order.kdvOran}%. This issues an OFFICIAL e-waybill in Mikro and cannot be undone.`,
      confirmLabel: op(tr).e_irsaliye_gonder,
      onConfirm: () => { void handleEIrsaliye(order); },
    });
    return true;
  };

  /**
   * `irsaliyeSor: false` — TOPLU durum değişikliğinde sorulmaz (her sipariş için ayrı onay penceresi açılamaz;
   * toplu işlemde e-İrsaliye sipariş detayındaki düğmeyle tek tek gönderilir).
   */
  /**
   * YAZIM KAPISI — bu sayfa yalnız `orders` koleksiyonunda GERÇEKTEN var olan siparişe yazar.
   *
   * Mikro sekmesindeki satırlar (`source:'mikro-siparis'`) DOKÜMAN DEĞİLDİR: `mikroSiparisler` aynasından
   * ekranda üretilen sözde siparişlerdir. İstemci `updateDoc`'u var olmayan dokümanı UPSERT eder
   * (server.ts PATCH yolu; "update diriltmez" güvencesi yalnız sunucu içi `pgShim.update` içindir) → bu
   * satırda durum/not/düzenleme yazmak `orders/<mikro id>` diye alansız bir HAYALET kayıt doğuruyordu:
   * `customerName`'siz kayıt süzgeçleri düşürüyor, `panoSiparisleri` (native kazanır) gerçek Mikro satırını
   * listeden atıyordu (2026-09-19 son inceleme). Dönen değer yoksa çağıran YAZMAZ.
   */
  /** `orders`ta GERÇEKTEN var mı (sözde Mikro siparişi satırı değil). Yalnız Cetpa'ya ait alanlar (iç not) bu kapıdan
   *  geçer — iç not Mikro verisiyle çelişmez, Mikro kaynaklı siparişe de yazılır. */
  const ordersKaydi = (orderId: string): Order | undefined => {
    const ord = orders.find(o => o.id === orderId);
    if (!ord) toast(currentLanguage === 'tr'
      ? "Bu sipariş Mikro'dan okunuyor — Cetpa'da değiştirilemez."
      : 'This order is read from Mikro — it cannot be changed in Cetpa.', 'warning');
    return ord;
  };
  /** Siparişin KENDİSİNİ değiştiren yazmalar (durum, teslim notu, düzenleme) — Mikro faturasından türeyen sipariş
   *  `orders`ta DURUR ama değiştirilmez: gerçeği Mikro'dadır (inceleme 2026-09-25 — durum seçici ve toplu işlem bu
   *  kapıdan geçiyordu). İç not bu kapıdan GEÇMEZ (`ordersKaydi`). */
  const yazilabilirSiparis = (orderId: string): Order | undefined => {
    const ord = ordersKaydi(orderId);
    if (ord && !yerelDegistirilebilir(ord)) { toast(yerelDegistirilemezMetni(currentLanguage), 'warning'); return undefined; }
    return ord;
  };

  /** Dönen değer: durum GERÇEKTEN yazıldı mı. Çağıran yerel (iyimser) durumu yalnız `true`da günceller. */
  const handleUpdateOrderStatus = async (orderId: string, status: Order['status'], secenek: { irsaliyeSor?: boolean } = {}): Promise<boolean> => {
    const ord = yazilabilirSiparis(orderId);
    if (!ord) return false;
    try {
      await updateDoc(doc(db, 'orders', orderId), { status, updatedAt: serverTimestamp(), ...(status === 'Delivered' ? { deliveredAt: serverTimestamp() } : {}) });
      const applied = (ord as unknown as Record<string, unknown> | undefined)?.stockApplied === true;
      // BAYRAK YALNIZ TAM BAŞARIDA (2026-08-22 denetim bulgusu P1→CONFIRMED):
      // eskiden satır hatası yutulup (console.error) bayrak KOŞULSUZ true
      // yapılıyordu — stok hiç düşmemişken sipariş "stok uygulandı" sayılıyor,
      // idempotency bayrağı da yeniden denemeyi sonsuza dek engelliyordu.
      // Kısmi başarıda bayrağı yine set ediyoruz (başarılı satırları ikinci kez
      // düşmemek için) ama kullanıcıya YÜKSEK SESLE hangi satırların düşmediğini
      // söylüyoruz — sessiz yanlış stok, gürültülü eksik stoktan kötüdür.
      const gecis = stokGecisi(status, applied);   // 'out' | 'in' | null — saf, testli (siparisStok.ts)
      if (ord && gecis === 'out') {
        const hatalilar = await applyOrderStock(ord, 'out', oc(currentLanguage).sevkiyat);
        await updateDoc(doc(db, 'orders', orderId), { stockApplied: true });
        if (hatalilar.length) createNotification(oc(currentLanguage).stok_uyarisi, currentLanguage === 'tr'
          ? `DİKKAT: ${hatalilar.length} ürünün stoğu düşürülemedi: ${hatalilar.join(', ')} — elle düzeltin.`
          : `WARNING: stock not decremented for ${hatalilar.length} item(s): ${hatalilar.join(', ')} — fix manually.`, 'warning');
      } else if (ord && gecis === 'in') {
        const hatalilar = await applyOrderStock(ord, 'in', oc(currentLanguage).siparis_iptali);
        await updateDoc(doc(db, 'orders', orderId), { stockApplied: false });
        if (hatalilar.length) createNotification(oc(currentLanguage).stok_uyarisi, currentLanguage === 'tr'
          ? `DİKKAT: ${hatalilar.length} ürünün stoğu geri yüklenemedi: ${hatalilar.join(', ')} — elle düzeltin.`
          : `WARNING: stock not restored for ${hatalilar.length} item(s): ${hatalilar.join(', ')} — fix manually.`, 'warning');
      }
      // "KARGODA" → e-İrsaliye OTOMATİK GİTMEZ, SORULUR (kullanıcı kararı 2026-09-19). Durum güncellemesi ve stok
      // düşümü BİTTİKTEN sonra, yalnız gönderilebilir (faturalı + carili + depolu + KDV'li) ve irsaliyesi kesilmemiş
      // siparişte. Gönderilemiyorsa sessiz kalınır: nedeni sipariş detayındaki düğmenin ipucunda yazar.
      if (status === 'Shipped' && secenek.irsaliyeSor !== false && ord) {
        eIrsaliyeOnayiAc({ ...ord, status: 'Shipped' }, op(currentLanguage).siparis_kargoda_olarak_isaretlendi);
      }
      return true;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
      return false;
    }
  };

  const handleSaveOrderNote = async () => {
    if (!selectedOrder || orderNoteText === (selectedOrder.notes ?? '')) return;
    if (!ordersKaydi(selectedOrder.id)) return;          // iç not: Mikro kaynaklı siparişe de yazılır (delta hakemi 2026-09-25)
    setOrderNoteSaving(true);
    try {
      await updateDoc(doc(db, 'orders', selectedOrder.id), { notes: orderNoteText, updatedAt: serverTimestamp() });
      // İŞLEVSEL güncelleyici (bkz. sayfa başındaki "bayat selectedOrder" notu): `await`
      // sırasında App.tsx e-İrsaliye işaretini yazmış olabilir; kapanıştaki nesneyi yaymak
      // o işareti yerelde siler ve düğme yeniden etkinleşir.
      setSelectedOrder(o => (o && o.id === selectedOrder.id ? { ...o, notes: orderNoteText } : o));
      setOrderNoteSaved(true);
      setTimeout(() => setOrderNoteSaved(false), 2000);
    } catch (e) {
      console.error('[handleSaveOrderNote]', e);
      toast(op(currentLanguage).not_kaydedilemedi, 'error');
    } finally { setOrderNoteSaving(false); }
  };

  const handleDeleteShipment = async (shipmentId: string) => {
    if (!await confirmDelete(undefined, currentLanguage === 'tr' ? 'tr' : 'en')) return;
    try { await deleteDoc(doc(db, 'shipments', shipmentId)); }
    catch (error) { handleFirestoreError(error, OperationType.DELETE, `shipments/${shipmentId}`); }
  };

  const handleEditShipment = (shipment: Shipment) => {
    setEditingShipmentId(shipment.id);
    setNewShipment({ ...shipment });
    setIsAddingShipment(true);
  };

  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragEnd = () => setDragIndex(null);
  const handleDragOver = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === toIndex) return;
    setRouteStops(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setDragIndex(toIndex);
  };

  return (
    <>
      {activeTab === 'orders' && !selectedOrder && (
        <motion.div key="orders-list" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              <AIInlineNudge
                context="orders"
                currentLanguage={currentLanguage}
                data={{
                  pendingOrderCount: activeOrders.filter(o=>o.status==='Pending').length,
                  topRisk: activeOrders.filter(o=>o.status==='Processing').length > 5
                    ? (currentLanguage==='tr' ? `${activeOrders.filter(o=>o.status==='Processing').length} sipariş işlemde bekliyor` : `${activeOrders.filter(o=>o.status==='Processing').length} orders stuck in processing`)
                    : undefined
                }}
                onAction={() => {}}
              />
              <ModuleHeader
                title={currentT.all_orders}
                subtitle={currentT.manage_orders}
                icon={Package}
                actionButton={
                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    <KpiCurrencyToggle kpiCurrency={kpiCurrency} setKpiCurrency={setKpiCurrency} />
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
                        const filtered = activeOrders.filter(o =>
                          (orderStatusFilter === 'All' || o.status === orderStatusFilter) &&
                          ((o.customerName ?? '').toLowerCase().includes(orderSearch.toLowerCase()) ||
                          gorunenSiparisNo(o).toLowerCase().includes(orderSearch.toLowerCase()) ||
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
                      title={op(currentLanguage).filtrelenmis_siparisleri_csv_olarak_indir}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {orderStatusFilter !== 'All'
                        ? `CSV (${activeOrders.filter(o => o.status === orderStatusFilter).length})`
                        : 'CSV'}
                    </button>
                    <button onClick={() => { setSelectedLead(null); setIsAddingOrder(true); }}
                      className="apple-button-primary">
                      <Plus className="w-4 h-4" /> {currentT.new_order}
                    </button>
                  </div>
                }
              />
              <div className="flex gap-2 mb-4 bg-gray-100/50 p-1 rounded-xl w-fit">
                <button
                  onClick={() => setOrderSourceTab('cetpa')}
                  className={clsx("px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2", orderSourceTab === 'cetpa' ? "bg-white text-brand shadow-sm" : "text-gray-500 hover:text-gray-700")}
                >
                  <Package className="w-4 h-4" />
                  {op(currentLanguage).cetpa_siparisleri}
                </button>
                <button
                  onClick={() => setOrderSourceTab('mikro')}
                  className={clsx("px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2", orderSourceTab === 'mikro' ? "bg-white text-brand shadow-sm" : "text-gray-500 hover:text-gray-700")}
                >
                  <RefreshCw className="w-4 h-4" />
                  {op(currentLanguage).mikro_siparisleri}
                </button>
              </div>

              {/* ── Phase 522: Order Fulfillment Rate KPI strip ── */}
              {activeOrders.length >= 3 && (() => {
                const total522 = activeOrders.filter(o => o.status !== 'Cancelled').length;
                const delivered522 = activeOrders.filter(o => o.status === 'Delivered').length;
                const pending522 = activeOrders.filter(o => o.status === 'Pending').length;
                const inProgress522 = activeOrders.filter(o => o.status === 'Processing' || o.status === 'Shipped').length;
                // Teslimat oranı tek kaynaktan (`oranYuzde`): payda 0 → BİLİNMİYOR. Şerit
                // `activeOrders.length >= 3` ile açılıyor ama payda İPTAL OLMAYAN siparişleri
                // sayıyor — hepsi 'Cancelled' ise (yeni kiracının deneme siparişleri) eski
                // `: 0` dalı KIRMIZI "0%" + "0 / 0" basıyor, ölçülemeyen oran "teslimat
                // performansı sıfır" diye okunuyordu. Aynı sayfadaki Lojistik KPI kartları
                // aynı durumda gri '—' basıyordu — iki yüzey iki sözleşme (2026-09-19 kapanış).
                // PARİTE: bilinen paydada `Math.round(oranYuzde(...))` eski ifadeyle aynı sayı.
                const fulfillRate = oranYuzde(delivered522, total522);
                // Alacak toplamı: bilinenlerin KISMİ toplamı; hiç bilinen tutar yoksa NaN → kisaTutar '—' basar
                // (eski `|| 0` tutarı bilinmeyen siparişi ₺0 sayıyor, toplam sessizce EKSİK çıkıyordu).
                const unpaidTotal = ekranTutari(vadeOzeti.toplam);
                // "Tahsilatı Cetpa'da izlenen kayıt var mı": Mikro sekmesinde (source 'mikro-*') HİÇ yok
                // (odemeTakipli). Orada boş liste `ekranTutari` sözleşmesince gerçek 0'dır — ama ekranda
                // yeşil "₺0K" = "alacağın yok" diye okunuyordu; oysa alacak Mikro cari hesapta YAŞIYOR,
                // yalnız burada izlenmiyor. Bilinmeyeni 0 göstermemek için '—' + açık not basılır.
                // Süzgeç veriden türetilir, sekmeden değil: hepsi ÖDENMİŞ olduğu için 0 çıkan gerçek
                // "alacağın yok" durumu (izlenen kayıt VAR) eskisi gibi yeşil ₺0 kalır.
                const izlenenVar = activeOrders.some(odemeTakipli);
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: op(currentLanguage).teslimat_orani,
                        // Ölçülemeyen oranda eşik RENGİ ÇİZİLMEZ (nötr gri) — kırmızı "%0" bir
                        // ölçüm değil, uydurulmuş kötü haberdi.
                        value: fulfillRate === null ? '—' : `${Math.round(fulfillRate)}%`,
                        color: fulfillRate === null ? 'text-gray-400' : fulfillRate >= 80 ? 'text-emerald-600' : fulfillRate >= 60 ? 'text-amber-600' : 'text-red-600',
                        bg: 'bg-white',
                        sub: fulfillRate === null
                          ? (op(currentLanguage).iptal_disi_siparis_yok)
                          : `${delivered522} / ${total522}` },
                      { label: oc(currentLanguage).bekleyen, value: pending522.toString(), color: pending522 > 0 ? 'text-amber-600' : 'text-gray-400', bg: 'bg-white', sub: null },
                      { label: op(currentLanguage).hazirlaniyor_kargoda, value: inProgress522.toString(), color: inProgress522 > 0 ? 'text-blue-600' : 'text-gray-400', bg: 'bg-white', sub: null },
                      { label: op(currentLanguage).alacak_toplam,
                        // Cetpa'da izlenen sipariş yoksa Mikro cari bakiyelerinden (Muhasebe ile AYNI kural: pozitif bakiye = alacak).
                        value: izlenenVar ? kisaTutar(unpaidTotal, { fmt: Number.isFinite(unpaidTotal) && unpaidTotal >= 1e6 ? 'M' : 'K', ondalik: 1 })
                          : mikroAlacak !== null && mikroAlacak !== 'yok' && mikroAlacak.alacak !== null ? kisaTutar(mikroAlacak.alacak, { fmt: mikroAlacak.alacak >= 1e6 ? 'M' : 'K', ondalik: 1 }) : '—',
                        // BİLİNMİYOR yeşil DEĞİL: eski `unpaidTotal > 0 ? kırmızı : yeşil` kapısı, tutarların
                        // hepsi bilinmediğinde (NaN > 0 === false) kartı yeşile çevirip "alacağın yok" diyordu.
                        color: !izlenenVar
                          ? (mikroAlacak !== null && mikroAlacak !== 'yok' && mikroAlacak.alacak !== null ? 'text-gray-900' : 'text-gray-400')
                          : !Number.isFinite(unpaidTotal) ? 'text-gray-400' : unpaidTotal > 0 ? 'text-red-600' : 'text-emerald-600',
                        bg: izlenenVar && Number.isFinite(unpaidTotal) && unpaidTotal > 0 ? 'bg-red-50' : 'bg-white',
                        sub: !izlenenVar
                          ? (mikroAlacak !== null && mikroAlacak !== 'yok'
                            ? (currentLanguage === 'tr'
                              ? `Mikro cari bakiyeleri · ${mikroAlacak.cariSayisi} cari${mikroAlacak.bilinmeyenCari > 0 ? ` · ${mikroAlacak.bilinmeyenCari} cari okunamadı` : ''}${mikroAlacak.guncellemeMs !== null ? ` · ${tarihYaz(mikroAlacak.guncellemeMs)} güncel` : ''}`
                              : `Mikro account balances · ${mikroAlacak.cariSayisi} accounts${mikroAlacak.bilinmeyenCari > 0 ? ` · ${mikroAlacak.bilinmeyenCari} unreadable` : ''}${mikroAlacak.guncellemeMs !== null ? ` · as of ${tarihYaz(mikroAlacak.guncellemeMs)}` : ''}`)
                            : (op(currentLanguage).mikro_cari_hesapta_izleniyor))
                          : vadeOzeti.adet > 0
                            ? `${vadeOzeti.adet} ${oc(currentLanguage).siparis}${vadeOzeti.toplam.bilinmeyen > 0 ? (currentLanguage === 'tr' ? ` · ${vadeOzeti.toplam.bilinmeyen} kayıt tutarsız` : ` · ${vadeOzeti.toplam.bilinmeyen} without amount`) : ''}`
                            : null },
                    ].map((k, i) => (
                      <div key={i} className={cn("rounded-xl border border-gray-100 shadow-sm px-4 py-3", k.bg)}>
                        <p className={cn("text-xl font-black", k.color)}>{k.value}</p>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">{k.label}</p>
                        {k.sub && <p className="text-[9px] text-gray-400 mt-0.5">{k.sub}</p>}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ── Phase 521: Invoice Aging Alert ── */}
              {(() => {
                // Kova sınırları (≤30/≤60/≤90/90+), aday süzgeci ve gecikme günü tek kaynakta:
                // utils/siparisler/tahsilatVade → utils/muhasebe/arYaslandirma. Tarihi okunamayan
                // ödenmemiş sipariş artık SESSİZCE DÜŞMÜYOR — `vadeOzeti.tarihsiz` ile ayrı gösterilir.
                if (vadeOzeti.adet === 0) return null;
                const buckets521 = vadeOzeti.kovalar;
                const hasOld = vadeOzeti.eskiVar;
                if (!hasOld && !showInvoiceAging) return (
                  <button onClick={() => setShowInvoiceAging(true)}
                    className="text-[10px] font-semibold text-gray-400 hover:text-red-600 transition-colors flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {vadeOzeti.adet} {op(currentLanguage).odenmemis_siparis_alacak_yaslandirmasi_goruntule}
                  </button>
                );
                return (
                  <div className={cn("rounded-2xl border overflow-hidden", hasOld ? "border-red-200 bg-red-50/30" : "border-gray-200 bg-white")}>
                    <button onClick={() => setShowInvoiceAging(!showInvoiceAging)} className="w-full flex items-center justify-between px-5 py-3 text-left">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={cn("w-4 h-4", hasOld ? "text-red-500" : "text-amber-400")} />
                        <span className="text-xs font-bold text-gray-800">
                          {op(currentLanguage).alacak_yaslandirma_raporu}
                        </span>
                        <span className={cn("text-[10px] font-black px-2 py-0.5 rounded-full", hasOld ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>
                          {vadeOzeti.yaslandirilanAdet} {oc(currentLanguage).acik_2}
                        </span>
                        {vadeOzeti.tarihsiz > 0 && (
                          <span className="text-[10px] font-semibold text-gray-400"
                            title={op(currentLanguage).tarihi_okunamadigi_icin_hicbir_yas_kovasina_konu}>
                            +{vadeOzeti.tarihsiz} {op(currentLanguage).tarihsiz}
                          </span>
                        )}
                      </div>
                      <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform", showInvoiceAging && "rotate-180")} />
                    </button>
                    {showInvoiceAging && (
                      <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {buckets521.map(b => (
                          <div key={b.ad} className={cn("rounded-xl border p-3 text-center", b.adet > 0 ? (b.ad === 'b90p' ? 'bg-red-100 border-red-200' : b.ad === 'b61_90' ? 'bg-orange-50 border-orange-100' : b.ad === 'b31_60' ? 'bg-amber-50 border-amber-100' : 'bg-white border-gray-100') : 'bg-white border-gray-100 opacity-50')}>
                            <p className={cn("text-2xl font-black", b.adet > 0 && b.ad === 'b90p' ? 'text-red-600' : b.adet > 0 ? 'text-amber-700' : 'text-gray-300')}>
                              {b.adet}
                            </p>
                            <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">{currentLanguage === 'tr' ? b.etiketTR : b.etiket}</p>
                            <p className="text-[9px] text-gray-500 mt-1">
                              {paraYaz(kovaTutari(b), { ondalik: 0 })}
                            </p>
                            {b.tutar.bilinmeyen > 0 && (
                              <p className="text-[9px] text-gray-400">
                                {b.tutar.bilinmeyen} {op(currentLanguage).kayit_tutarsiz}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Bulk action bar (appears when orders are selected) ── */}
              {selectedOrderIds.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#1a3a5c] text-white px-5 py-3 rounded-2xl shadow-2xl border border-white/10">
                  <span className="text-sm font-bold">{selectedOrderIds.size} {op(currentLanguage).siparis_secildi}</span>
                  <div className="w-px h-5 bg-white/20" />
                  {(['Processing', 'Shipped', 'Delivered'] as Order['status'][]).map(s => (
                    <button
                      key={s}
                      disabled={bulkActionLoading}
                      onClick={() => openConfirm({
                        title: op(currentLanguage).toplu_guncelleme,
                        message: `${selectedOrderIds.size} ${op(currentLanguage).siparisin_durumunu} "${s}" ${op(currentLanguage).olarak_guncellensin_mi}`,
                        onConfirm: async () => {
                          setBulkActionLoading(true);
                          // Toplu işlemde e-İrsaliye SORULMAZ; kaç siparişin onay beklediği söylenir (sessiz kalmasın).
                          const irsaliyeBekleyen = s === 'Shipped' && irsaliyeKesebilir
                            ? orders.filter(o => selectedOrderIds.has(o.id) && !o.irsaliyeNo && !o.irsaliyeGonderildi
                                && irsaliyeIstegi(o, leads.find(l => l.id === o.leadId)).gonderilebilir).length
                            : 0;
                          // Mikro kaynaklı kayıtlar ATLANIR (Cetpa'da değiştirilmez) — kaç tane olduğu söylenir, tek tek uyarı basılmaz.
                          const atlanan = [...selectedOrderIds].filter(id => { const x = orders.find(o => o.id === id); return !x || !yerelDegistirilebilir(x); }).length;
                          for (const id of selectedOrderIds) {
                            const x = orders.find(o => o.id === id);
                            if (!x || !yerelDegistirilebilir(x)) continue;
                            await handleUpdateOrderStatus(id, s, { irsaliyeSor: false });
                          }
                          if (atlanan > 0) toast(currentLanguage === 'tr'
                            ? `${atlanan} Mikro kaydı atlandı — durumları Mikro'da değişir.`
                            : `${atlanan} Mikro record(s) skipped — change them in Mikro.`, 'info');
                          if (irsaliyeBekleyen > 0) toast(currentLanguage === 'tr'
                            ? `${irsaliyeBekleyen} sipariş e-İrsaliye bekliyor — sipariş detayından onaylayarak gönderin.`
                            : `${irsaliyeBekleyen} order(s) await an e-waybill — send them from the order detail.`, 'info');
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
                  {/* Phase 97: Bulk mark as paid */}
                  <button
                    disabled={bulkActionLoading}
                    onClick={() => openConfirm({
                      title: op(currentLanguage).toplu_odeme_onayla,
                      message: `${selectedOrderIds.size} ${op(currentLanguage).siparis_odendi_olarak_isaretlensin_mi}`,
                      confirmLabel: op(currentLanguage).odendi_yap,
                      onConfirm: async () => {
                        setBulkActionLoading(true);
                        const sel = activeOrders.filter(o => selectedOrderIds.has(o.id));
                        for (const o of sel) {
                          if (!o.paid && odemeTakipli(o)) await handleToggleOrderPaid(o);
                        }
                        setSelectedOrderIds(new Set());
                        setBulkActionLoading(false);
                        toast(
                          currentLanguage === 'tr'
                            ? `${sel.length} sipariş ödendi olarak işaretlendi ✓`
                            : `${sel.length} order${sel.length !== 1 ? 's' : ''} marked as paid ✓`,
                          'success'
                        );
                      },
                    })}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-500/80 hover:bg-emerald-500 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    {op(currentLanguage).odendi}
                  </button>
                  <div className="w-px h-5 bg-white/20" />
                  <button
                    onClick={() => {
                      // Bulk PDF export: generate one PDF with all selected orders
                      const sel = activeOrders.filter(o => selectedOrderIds.has(o.id));
                      import('jspdf').then(({ jsPDF }) => {
                        import('jspdf-autotable').then(async ({ default: autoTable }) => {
                          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                          await registerTurkishFont(pdf);
                          // Marka basligi + ortak tablo stili (src/utils/pdfTheme.ts).
                          // Bu belge duz metin baslik ve autoTable'in VARSAYILAN
                          // MAVI tablosuyla cikiyordu.
                          const govdeY = pdfBaslik(pdf, {
                            belgeAdi: op(currentLanguage).siparis_listesi,
                            meta: tarihYaz(new Date()),
                          });
                          autoTable(pdf, {
                            ...pdfTabloStili(),
                            startY: govdeY,
                            head: [['#', oc(currentLanguage).musteri, oc(currentLanguage).durum, oc(currentLanguage).tutar]],
                            // Para 2 ondalik: locale verilse de ondalik verilmezse
                            // tarayici 3 haneye kadar basabiliyor.
                            body: sel.map(o => [gorunenSiparisNo(o), o.customerName, o.status,
                              paraYaz(o.totalPrice)]),
                          });
                          pdfAltBilgi(pdf);
                          pdf.save(`siparisler_${bugunAnahtari()}.pdf`);
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

              {/* ── Phase 119: Recurring Order Templates ── */}
              {(() => {
                const dueToday = recurringOrders.filter(r => { const due = gunBasi(r.nextDue); return r.active && !!due && due <= new Date(); });
                return (
                  <div className="space-y-3">
                    {/* Due now alert */}
                    {dueToday.length > 0 && (
                      <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-2xl px-5 py-3">
                        <RefreshCw size={15} className="text-blue-500 flex-shrink-0" />
                        <p className="text-sm font-semibold text-blue-800">
                          {currentLanguage === 'tr'
                            ? `${dueToday.length} tekrarlayan sipariş bugün/geçmiş vadede.`
                            : `${dueToday.length} recurring order${dueToday.length !== 1 ? 's' : ''} due today or overdue.`}
                        </p>
                      </div>
                    )}

                    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <RefreshCw size={14} className="text-gray-400" />
                          <h3 className="text-sm font-bold text-gray-700">
                            {op(currentLanguage).tekrarlayan_siparisler}
                          </h3>
                          {recurringOrders.length > 0 && (
                            <span className="text-[10px] bg-gray-100 text-gray-500 font-bold px-1.5 py-0.5 rounded-full">
                              {recurringOrders.filter(r => r.active).length}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => setShowRecurringForm(v => !v)}
                          className="text-[10px] font-bold text-brand hover:underline flex items-center gap-1"
                        >
                          <Plus size={11} />{op(currentLanguage).sablon_ekle}
                        </button>
                      </div>

                      {/* Add form */}
                      <AnimatePresence>
                        {showRecurringForm && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                            <div className="p-4 bg-gray-50 border-b border-gray-100 space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <input className="apple-input text-sm" placeholder={oc(currentLanguage).sablon_adi}
                                  value={recurringForm.templateName} onChange={e => setRecurringForm(f => ({ ...f, templateName: e.target.value }))} />
                                <input className="apple-input text-sm" placeholder={oc(currentLanguage).musteri_adi_2}
                                  value={recurringForm.customerName} onChange={e => setRecurringForm(f => ({ ...f, customerName: e.target.value }))} />
                                <div className="relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">₺</span>
                                  <input type="number" className="apple-input text-sm pl-6 w-full" placeholder={oc(currentLanguage).tutar}
                                    value={recurringForm.totalPrice} onChange={e => setRecurringForm(f => ({ ...f, totalPrice: e.target.value }))} />
                                </div>
                                <select className="apple-input text-sm" value={recurringForm.frequency} onChange={e => setRecurringForm(f => ({ ...f, frequency: e.target.value as typeof recurringForm.frequency }))}>
                                  <option value="weekly">{oc(currentLanguage).haftalik}</option>
                                  <option value="monthly">{oc(currentLanguage).aylik}</option>
                                  <option value="quarterly">{oc(currentLanguage)._3_aylik}</option>
                                </select>
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-gray-500">{op(currentLanguage).sonraki_vade}</label>
                                <input type="date" className="apple-input text-sm" value={recurringForm.nextDue} onChange={e => setRecurringForm(f => ({ ...f, nextDue: e.target.value }))} />
                                <button
                                  disabled={!recurringForm.templateName || !recurringForm.customerName}
                                  onClick={async () => {
                                    if (!recurringForm.templateName) return;
                                    const sablonTutar = degerDogrula(recurringForm.totalPrice);
                                    if (!sablonTutar.gecerli) { toast(sablonTutar.hata === 'deger_bos'
                                      ? (op(currentLanguage).sablon_tutari_girin_bos_alan_0_olarak_kaydedilme)
                                      : (op(currentLanguage).sablon_tutari_0_dan_buyuk_olmali), 'error'); return; }
                                    await addDoc(collection(db, 'recurringOrders'), { ...recurringForm, totalPrice: sablonTutar.deger, active: true, createdAt: serverTimestamp() });
                                    setRecurringForm({ templateName: '', customerName: '', totalPrice: '', frequency: 'monthly', nextDue: '' });
                                    setShowRecurringForm(false);
                                    toast(op(currentLanguage).sablon_eklendi, 'success');
                                  }}
                                  className="apple-button-primary text-xs px-4 ml-auto disabled:opacity-50"
                                >{oc(currentLanguage).ekle}</button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {recurringOrders.length === 0 ? (
                        <div className="py-8 text-center">
                          <RefreshCw size={28} className="mx-auto mb-2 text-gray-200" />
                          <p className="text-xs text-gray-400">{op(currentLanguage).tekrarlayan_siparis_sablonu_yok}</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-50">
                          {recurringOrders.map(r => {
                            const due = gunBasi(r.nextDue);
                            const overdue = due && due <= new Date();
                            return (
                              <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${r.active ? (overdue ? 'bg-red-400' : 'bg-emerald-400') : 'bg-gray-200'}`} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold text-gray-800 truncate">{r.templateName}</p>
                                  <p className="text-[10px] text-gray-400">{r.customerName} · {fmtKpi(r.totalPrice)}</p>
                                </div>
                                <span className="text-[10px] text-gray-500 flex-shrink-0">
                                  {r.frequency === 'weekly' ? (oc(currentLanguage).haftalik)
                                    : r.frequency === 'monthly' ? (oc(currentLanguage).aylik)
                                    : (oc(currentLanguage)._3_aylik)}
                                </span>
                                {due && (
                                  <span className={`text-[10px] font-bold flex-shrink-0 ${overdue ? 'text-red-600' : 'text-gray-500'}`}>
                                    {overdue ? '⚠ ' : ''}{tarihYaz(due, { day: 'numeric', month: 'short' }, currentLanguage === 'tr' ? 'tr' : 'en')}
                                  </span>
                                )}
                                <button
                                  onClick={async () => {
                                    await updateDoc(doc(db, 'recurringOrders', r.id), { active: !r.active });
                                  }}
                                  className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-colors flex-shrink-0 ${r.active ? 'bg-emerald-100 text-emerald-700 hover:bg-red-100 hover:text-red-700' : 'bg-gray-100 text-gray-500 hover:bg-emerald-100 hover:text-emerald-700'}`}
                                >
                                  {r.active ? (oc(currentLanguage).aktif) : (op(currentLanguage).pasif)}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Phase 55: Status Filter Chips ── */}
              <div className="flex flex-wrap gap-1.5">
                {(['All', 'Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'] as const).map(s => {
                  const count = s === 'All' ? activeOrders.length : activeOrders.filter(o => o.status === s).length;
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
                {/* Phase 509: Starred filter chip */}
                {starredOrders.size > 0 && (
                  <button
                    onClick={() => setOrderStatusFilter(orderStatusFilter === '__starred__' ? 'All' : '__starred__')}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border",
                      orderStatusFilter === '__starred__'
                        ? "bg-amber-400 text-white border-transparent shadow-sm"
                        : darkMode ? "bg-white/5 border-white/10 text-white/60 hover:bg-white/10" : "bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-amber-600"
                    )}
                  >
                    ★ {op(currentLanguage).yildizli}
                    <span className={cn("text-[9px] px-1 py-0.5 rounded-full", orderStatusFilter === '__starred__' ? "bg-white/20" : darkMode ? "bg-white/10" : "bg-gray-100")}>{starredOrders.size}</span>
                  </button>
                )}
              </div>

              {/* Phase 523: Active customer filter chip */}
              {orderCustomerFilter && (
                <div className="flex items-center gap-2 px-3 py-2 bg-brand/10 border border-brand/20 rounded-xl text-xs font-bold text-brand">
                  <Users className="w-3.5 h-3.5 flex-shrink-0" />
                  {orderCustomerFilter}
                  <button onClick={() => setOrderCustomerFilter(null)} className="ml-1 hover:text-red-600 transition-colors"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}

              {/* ── Phase 501: Date Range Quick Filter ── */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className={cn("text-[10px] font-semibold uppercase tracking-wider", darkMode ? "text-white/65" : "text-gray-400")}>
                  {oc(currentLanguage).donem}:
                </span>
                {([
                  { v: 'all',     tr: 'Tümü',       en: 'All Time' },
                  { v: 'today',   tr: 'Bugün',       en: 'Today' },
                  { v: 'week',    tr: 'Bu Hafta',    en: 'This Week' },
                  { v: 'month',   tr: 'Bu Ay',       en: 'This Month' },
                  { v: 'quarter', tr: 'Bu Çeyrek',   en: 'This Quarter' },
                ] as { v: 'all'|'today'|'week'|'month'|'quarter'; tr: string; en: string }[]).map(({ v, tr, en }) => (
                  <button key={v} onClick={() => setOrderDateRange(v)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-semibold transition-all border",
                      orderDateRange === v
                        ? "bg-brand text-white border-transparent shadow-sm"
                        : darkMode
                          ? "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                          : "bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-800"
                    )}>
                    {currentLanguage === 'tr' ? tr : en}
                  </button>
                ))}
              </div>

              {/* ── Phase 70: Order Aging Alert ── */}
              {(() => {
                const now = Date.now();
                const THREE_DAYS = 3 * 86400000;
                const stuckOrders = activeOrders.filter(o => {
                  if (o.status !== 'Pending' && o.status !== 'Processing') return false;
                  const ms = zamanMs(o.createdAt ?? o.syncedAt);
                  if (ms === null) return false;
                  return now - ms > THREE_DAYS;
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
                      {op(currentLanguage).incele}
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
                              const filtered = activeOrders.filter(o =>
                                (o.customerName ?? '').toLowerCase().includes(orderSearch.toLowerCase()) ||
                                gorunenSiparisNo(o).toLowerCase().includes(orderSearch.toLowerCase())
                              );
                              return filtered.every(o => selectedOrderIds.has(o.id));
                            })()}
                            onChange={e => {
                              const filtered = activeOrders.filter(o =>
                                (o.customerName ?? '').toLowerCase().includes(orderSearch.toLowerCase()) ||
                                gorunenSiparisNo(o).toLowerCase().includes(orderSearch.toLowerCase())
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
                        const filtered = activeOrders.filter(o => {
                          if (orderStatusFilter === '__starred__' && !starredOrders.has(o.id)) return false;
                          if (orderStatusFilter !== 'All' && orderStatusFilter !== '__starred__' && o.status !== orderStatusFilter) return false;
                          // Phase 523: customer filter
                          if (orderCustomerFilter && o.customerName !== orderCustomerFilter) return false;
                          const q = orderSearch.toLowerCase();
                          if (q && !(o.customerName ?? '').toLowerCase().includes(q) && !gorunenSiparisNo(o).toLowerCase().includes(q) && !o.shippingAddress?.toLowerCase().includes(q)) return false;
                          // Phase 501: date range filter
                          if (orderDateRange !== 'all') {
                            // Tarihi çözülemeyen sipariş eskisi gibi filtreden GEÇER (raw yokken de geçiyordu)
                            const d = zamanDate(o.createdAt ?? o.syncedAt);
                            if (d) {
                              const now = new Date();
                              if (orderDateRange === 'today' && d.toDateString() !== now.toDateString()) return false;
                              if (orderDateRange === 'week') { const ws = new Date(now); ws.setDate(now.getDate() - now.getDay()); ws.setHours(0,0,0,0); if (d < ws) return false; }
                              if (orderDateRange === 'month' && ayAnahtari(d) !== ayAnahtari(now)) return false;
                              if (orderDateRange === 'quarter' && (Math.floor(d.getMonth()/3) !== Math.floor(now.getMonth()/3) || d.getFullYear() !== now.getFullYear())) return false;
                            }
                          }
                          return true;
                        });
                        const sorted = siparisSirala(filtered, orderSort.key, orderSort.dir);
                        return sorted.length === 0 ? (
                          <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500">{currentT.no_orders_found}</td></tr>
                        ) : sorted.map(order => (
                          <React.Fragment key={order.id}>
                          <tr
                            className={cn("hover:bg-gray-50 transition-colors cursor-pointer", selectedOrderIds.has(order.id) && "bg-brand/5")}
                            onClick={() => { setSelectedOrder(order); trackView({ type: 'order', id: order.id, label: `${gorunenSiparisNo(order)} — ${order.customerName}`, tab: 'orders' }); }}
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
                            {/* Phase 525: order ID + expand toggle */}
                            <td className="px-6 py-4 font-medium text-[#1D2226]" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5">
                                {/* Phase 530: copy order ID */}
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await navigator.clipboard.writeText(gorunenSiparisNo(order)).catch(() => {});
                                    setCopiedOrderId(order.id);
                                    setTimeout(() => setCopiedOrderId(null), 1500);
                                  }}
                                  className="text-gray-400 hover:text-brand transition-colors p-2 -m-2"
                                  title={op(currentLanguage).siparis_id_yi_kopyala}
                                >
                                  {copiedOrderId === order.id
                                    ? <Check className="w-3 h-3 text-emerald-500" />
                                    : <Copy className="w-3 h-3" />}
                                </button>
                                <span className="cursor-pointer" onClick={() => { setSelectedOrder(order); trackView({ type: 'order', id: order.id, label: `${gorunenSiparisNo(order)} — ${order.customerName}`, tab: 'orders' }); }}>
                                  {gorunenSiparisNo(order)}
                                </span>
                                {order.lineItems && order.lineItems.length > 0 && (
                                  <button
                                    onClick={e => { e.stopPropagation(); setExpandedOrderId(expandedOrderId === order.id ? null : order.id); }}
                                    className={cn("ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full transition-colors flex items-center gap-0.5",
                                      expandedOrderId === order.id
                                        ? "bg-brand text-white"
                                        : "bg-gray-100 text-gray-500 hover:bg-brand/10 hover:text-brand"
                                    )}
                                    title={expandedOrderId === order.id
                                      ? (op(currentLanguage).urunleri_gizle)
                                      : (op(currentLanguage).urunleri_goster)}
                                  >
                                    {order.lineItems.length} {op(currentLanguage).urun + (order.lineItems.length !== 1 ? 's' : '')}
                                    <ChevronDown className={cn("w-2.5 h-2.5 transition-transform", expandedOrderId === order.id && "rotate-180")} />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                {/* Phase 523: clickable customer name filters to that customer */}
                                <button
                                  onClick={e => { e.stopPropagation(); setOrderCustomerFilter(orderCustomerFilter === order.customerName ? null : order.customerName); }}
                                  className={cn("text-left transition-colors font-medium", orderCustomerFilter === order.customerName ? "text-brand font-bold" : "text-gray-600 hover:text-brand")}
                                  title={currentLanguage === 'tr' ? `Bu müşterinin siparişlerini filtrele` : `Filter orders by this customer`}
                                >
                                  {order.customerName}
                                </button>
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
                              {(() => { const d = siparisTarih(order); return d ? tarihYaz(d) : (oc(currentLanguage).tarih_yok); })()}
                            </td>
                            <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                              {/* Phase 534: days in current status */}
                              {(() => {
                                const ms534 = zamanMs(order.createdAt ?? order.syncedAt);
                                if (ms534 === null) return null;
                                const days534 = Math.floor((Date.now() - ms534) / 86400000);
                                if (days534 < 1) return null;
                                const warn534 = order.status === 'Pending' && days534 > 3;
                                return (
                                  <span className={cn("block text-[8px] font-bold mb-1 px-1.5 py-0.5 rounded-full w-fit",
                                    warn534 ? "bg-red-50 text-red-400" : "bg-gray-100 text-gray-400"
                                  )}>
                                    {days534}{oc(currentLanguage).g}
                                  </span>
                                );
                              })()}
                              <select value={order.status}
                                // Sözde Mikro siparişinin durumu Cetpa'da tutulmaz ('Pending' sabit bir yer tutucudur); Mikro faturasından
                                // türeyen sipariş de Cetpa'da değiştirilmez — kilitli (siparisIslemleri.yerelDegistirilebilir).
                                disabled={!yerelDegistirilebilir(order)}
                                title={order.source === 'mikro-siparis' ? (op(currentLanguage).mikro_siparisi_durumu_mikro_da_izlenir) : !yerelDegistirilebilir(order) ? yerelDegistirilemezMetni(currentLanguage) : undefined}
                                onChange={(e) => {
                                e.stopPropagation();
                                const newStatus = e.target.value as Order['status'];
                                // Phase 506: delivery note modal
                                if (newStatus === 'Delivered') { setDeliveryNoteOrder(order); setDeliveryNoteText(''); return; }
                                openConfirm({
                                  title: currentT.status,
                                  // `newStatus` KULLAN — `e.target.value` onay ANINDA okunursa kontrollü <select> çoktan eski
                                  // değere dönmüştür ve ESKİ durum yazılır (2026-06-12'den beri liste seçicisi durumu
                                  // hiç değiştirmiyordu; 2026-09-19 uçtan uca inceleme). Değişmez testi: onayDegismez.test.ts
                                  message: `${siparisDurumEtiketi(newStatus, currentLanguage)}?`,
                                  onConfirm: () => handleUpdateOrderStatus(order.id, newStatus)
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
                              {/* TL yolu birebir korundu; USD/EUR artık kur yoksa '—' (eskiden `||1` ile
                                  TL tutar '$' ile basılıyordu — ~38× şişkin). Sembol biçimleyicinin içinde. */}
                              <div>{kpiCurrency === 'TRY'
                                ? paraYaz(order.totalPrice)
                                : formatInCurrency(order.totalPrice, kpiCurrency, exchangeRates ?? undefined)}</div>
                              <div className="flex flex-col items-end gap-0.5 mt-0.5">
                                {/* SIRA KRİTİK (2026-09-03 code-review): mikro-fatura dalı ÖNCE
                                    test edilmeli. Sunucu bu kayıtlara `faturali: true` yazıyor ama
                                    faturaTipi/kdvOran YAZMIYOR; faturali dalı önce gelirse
                                    "e-FATURA • KDV%0" uydurulur (sahte kesinlik). */}
                                {order.source === 'mikro-fatura' ? (
                                  <span className="text-[9px] font-bold bg-[#1a3a5c]/10 text-[#1a3a5c] px-1.5 py-0.5 rounded-full"
                                    title={currentLanguage === 'tr' ? `Mikro satış faturasından türetildi (${order.mikroEvrak ? order.mikroEvrak.seri + order.mikroEvrak.sira : ''})` : 'Derived from Mikro sales invoice'}>
                                    {op(currentLanguage).mikro_fatura}
                                  </span>
                                ) : order.faturali ? (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${order.faturaTipi==='ihracat' ? 'bg-blue-100 text-blue-600' : order.faturaTipi==='e-arsiv' ? 'bg-purple-100 text-purple-600' : 'bg-green-100 text-green-600'}`}>
                                    {order.faturaTipi ? faturaTipiEtiketi(order.faturaTipi, currentLanguage) : 'e-FATURA'} • {kdvEtiketi(order.kdvOran)}
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-bold bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">
                                    {op(currentLanguage).faturasiz}
                                  </span>
                                )}
                                {/* Phase 67: Mikro sync badge */}
                                {order.mikroFaturaNo ? (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#1a3a5c]/10 text-[#1a3a5c] inline-flex items-center gap-0.5 max-w-[120px] truncate" title={`Mikro: ${order.mikroFaturaNo}`}>
                                    ✓ {order.mikroFaturaNo}
                                  </span>
                                ) : order.faturali ? (
                                  <span className="text-[9px] text-amber-500 font-medium inline-flex items-center gap-0.5" title={op(currentLanguage).mikro_ya_gonderilmedi}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                                    Mikro
                                  </span>
                                ) : null}
                                {/* Phase 89 + Phase 532 + Phase 535: Payment status badge + method */}
                                {odemeTakipli(order) ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleToggleOrderPaid(order); }}
                                  title={order.paid ? (oc(currentLanguage).odendi_tikla_odenmedi_yap) : (op(currentLanguage).odenmedi_tikla_odendi_yap)}
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full transition-colors ${order.paid ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
                                >
                                  {order.paid ? (oc(currentLanguage).odendi_2) : (oc(currentLanguage).odenmedi)}
                                </button>
                                ) : (
                                  <span className="text-[9px] font-medium text-gray-400"
                                    title={oc(currentLanguage).tahsilat_durumu_mikro_cari_hesapta_izlenir_sipar}>
                                    {op(currentLanguage).tahsilat_mikro_cari}
                                  </span>
                                )}
                                {/* Phase 535: payment method micro-badge */}
                                {order.paid && order.paymentMethod && (() => {
                                  const pmLabels: Record<string, string> = {
                                    cash: oc(currentLanguage).nakit,
                                    bank_transfer: op(currentLanguage).eft,
                                    credit_card: op(currentLanguage).kart,
                                    check: oc(currentLanguage).cek,
                                    other: oc(currentLanguage).diger,
                                  };
                                  return (
                                    <span className="text-[8px] font-semibold px-1 py-0.5 rounded bg-gray-100 text-gray-500">
                                      {pmLabels[order.paymentMethod] ?? order.paymentMethod}
                                    </span>
                                  );
                                })()}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-2">
                                {order.status === 'Pending' && order.source !== 'mikro-siparis' && (
                                  <button onClick={() => openConfirm({
                                    title: currentT.confirm_approve_title,
                                    message: currentT.confirm_approve_msg,
                                    confirmLabel: currentT.approve,
                                    onConfirm: () => handleUpdateOrderStatus(order.id, 'Processing')
                                  })} className="text-emerald-500 hover:text-emerald-700 transition-colors" title={currentT.approve_order}>
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>
                                )}
                                {/* Faturası OLAN satırda (Mikro faturası / mikroFaturaNo / hasInvoice) düğme KAPALI —
                                    kullanıcı kuralı 2026-09-24: "faturası olan bir şeye tekrar fatura kestiremeyiz".
                                    `faturali` bayrağı fatura KANITI değildir (faturalı satış tipi) — utils/siparisler/faturaDurumu. */}
                                {faturaKesilebilir(order) && (
                                  <button
                                    onClick={() => setActiveTab('muhasebe')}
                                    className="text-xs font-bold px-2 py-1 bg-brand/10 text-brand hover:bg-brand hover:text-white rounded-lg transition-all flex items-center gap-1"
                                    title={oc(currentLanguage).fatura_kes}
                                  >
                                    <FileText className="w-3.5 h-3.5"/>
                                    {op(currentLanguage).fatura_kes}
                                  </button>
                                )}
                                {order.hasInvoice && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 bg-green-100 text-green-600 rounded-full flex items-center gap-0.5">
                                    <CheckCircle2 className="w-3 h-3"/>{op(currentLanguage).faturali}
                                  </span>
                                )}
                                {/* Mikro e-Fatura push */}
                                {mikroyaFaturaGonderilebilir(order) && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); void handleMikroFatura(order); }}
                                    disabled={!!faturaLoading[order.id]}
                                    className="text-xs font-bold px-2 py-1 bg-[#1a3a5c]/10 text-[#1a3a5c] hover:bg-[#1a3a5c] hover:text-white rounded-lg transition-all flex items-center gap-1 disabled:opacity-40"
                                    title={op(currentLanguage).mikro_ya_e_fatura_gonder}
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
                                {/* Phase 509: Star/Pin order */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const next = new Set(starredOrders);
                                    if (next.has(order.id)) next.delete(order.id); else next.add(order.id);
                                    setStarredOrders(next);
                                    const uid = auth.currentUser?.uid;
                                    if (uid) setDoc(doc(db, 'userPrefs', uid), { starredOrders: [...next] }, { merge: true }).catch(() => {});
                                  }}
                                  className={cn("transition-colors", starredOrders.has(order.id) ? "text-amber-400 hover:text-amber-500" : "text-gray-200 hover:text-amber-300")}
                                  title={starredOrders.has(order.id) ? (op(currentLanguage).yildizi_kaldir) : (op(currentLanguage).onemli_olarak_isaretle)}
                                >
                                  ★
                                </button>
                                <button onClick={() => { if (!yerelDegistirilebilir(order)) return; openConfirm({
                                  title: currentT.confirm_delete_title,
                                  message: currentT.confirm_delete,
                                  confirmLabel: currentT.delete,
                                  variant: 'danger',
                                  onConfirm: () => handleDeleteOrder(order.id)
                                }); }}
                                  disabled={!yerelDegistirilebilir(order)}
                                  className="p-2 -m-2 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-400"
                                  title={yerelDegistirilebilir(order) ? currentT.delete_order : yerelDegistirilemezMetni(currentLanguage)}>
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {/* ── Phase 525: Inline line items expand row ── */}
                          {expandedOrderId === order.id && order.lineItems && order.lineItems.length > 0 && (
                            <tr className="bg-gray-50/80">
                              <td colSpan={7} className="px-8 py-3">
                                {/* Sürüm-2 MF kalemi (2026-09-25): detay ve fişle AYNI tablo (kayitliMikroKalemleri) — satırlar KDV hariç
                                    net, alt satırlar KDV/masraf/genel toplam; eski tabloda net satırlar KDV dâhil toplamla yan yana kalıyordu. */}
                                {kayitliMikroKalemleri(order) ? (
                                  <MikroSiparisKalemleri
                                    durum="hazir"
                                    kalemler={[]}
                                    kayitli={kayitliMikroKalemleri(order) ?? undefined}
                                    hata={null}
                                    genelToplam={order.totalPrice}
                                    evrakNo={[order.mikroEvrak?.seri, order.mikroEvrak?.sira].filter(Boolean).join('') || gorunenSiparisNo(order)}
                                    dil={currentLanguage}
                                  />
                                ) : (
                                <div className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="bg-gray-50 border-b border-gray-100">
                                        <th className="text-left px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">SKU</th>
                                        <th className="text-left px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{oc(currentLanguage).urun}</th>
                                        <th className="text-right px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{oc(currentLanguage).adet_2}</th>
                                        <th className="text-right px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{oc(currentLanguage).birim_fiyat}</th>
                                        <th className="text-right px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{oc(currentLanguage).toplam}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {order.lineItems.map((li, idx) => (
                                        <tr key={idx} className="border-b border-gray-50 last:border-0">
                                          <td className="px-4 py-2 text-gray-400 font-mono">{li.sku}</td>
                                          <td className="px-4 py-2 text-gray-700 font-medium">{li.title ?? li.name}</td>
                                          <td className="px-4 py-2 text-right text-gray-600">{li.quantity}</td>
                                          {/* Mikro türevi kalem `price` taşımaz; `price * quantity` NaN → '—' idi (ortak seçiciler, 2026-09-25). */}
                                          <td className="px-4 py-2 text-right text-gray-600">{paraYaz(kalemBirimFiyati(li))}</td>
                                          <td className="px-4 py-2 text-right font-bold text-gray-800">{paraYaz(kalemTutari(li))}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className="bg-gray-50">
                                        <td colSpan={4} className="px-4 py-2 text-right text-[10px] font-bold text-gray-500 uppercase tracking-wider">{oc(currentLanguage).genel_toplam_2}</td>
                                        <td className="px-4 py-2 text-right font-black text-brand">{paraYaz(order.totalPrice)}</td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                                )}
                              </td>
                            </tr>
                          )}
                          </React.Fragment>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-4">
                {siparisSirala(activeOrders.filter(o =>
                  (orderStatusFilter === 'All' || o.status === orderStatusFilter) &&
                  ((o.customerName ?? '').toLowerCase().includes(orderSearch.toLowerCase()) ||
                  gorunenSiparisNo(o).toLowerCase().includes(orderSearch.toLowerCase()) ||
                  o.shippingAddress?.toLowerCase().includes(orderSearch.toLowerCase()))
                ), orderSort.key, orderSort.dir).map(order => (
                  <div key={order.id} className="apple-card p-4 space-y-3" onClick={() => setSelectedOrder(order)}>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold text-sm text-[#1D2226]">{gorunenSiparisNo(order)}</p>
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
                        {(() => { const d = siparisTarih(order); return d ? tarihYaz(d) : (oc(currentLanguage).tarih_yok); })()}
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-brand">{paraYaz(order.totalPrice)}</p>
                        {/* Phase 67: invoice mini-badge on mobile */}
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          {order.source === 'mikro-fatura' ? (
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded-full bg-[#1a3a5c]/10 text-[#1a3a5c]">
                              {op(currentLanguage).mikro_ftr}
                            </span>
                          ) : order.faturali ? (
                            <span className={`text-[8px] font-bold px-1 py-0.5 rounded-full ${order.faturaTipi === 'ihracat' ? 'bg-blue-100 text-blue-600' : order.faturaTipi === 'e-arsiv' ? 'bg-purple-100 text-purple-600' : 'bg-green-100 text-green-600'}`}>
                              {order.faturaTipi ? faturaTipiEtiketi(order.faturaTipi, currentLanguage) : 'e-FTR'}
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
          {/* ── Phase 575: Müşteri İade / Şikayet Yönetimi ────────────────── */}
          {activeTab === 'orders' && !selectedOrder && (() => {
            const tr575 = currentLanguage === 'tr';
            const statusColors575: Record<string,string> = {
              'Bekliyor': 'bg-amber-100 text-amber-700',
              'Onaylandı': 'bg-green-100 text-green-700',
              'Reddedildi': 'bg-red-100 text-red-700',
              'Tamamlandı': 'bg-blue-100 text-blue-700',
            };
            return (
              <div className="apple-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900 text-sm">{op(tr575).iade_sikayet_yonetimi}</h3>
                  {hasFullAccess('orders') && (
                    <button onClick={()=>setActiveTab('iade')} className="apple-button-primary flex items-center gap-2 text-sm" title={op(tr575).iade_degisim_sayfasinda_yonet}>
                      <Plus className="w-4 h-4"/>{op(tr575).iade_talebi}
                    </button>
                  )}
                </div>
                {p575ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <input className="apple-input px-3 py-2 text-sm" placeholder={oc(tr575).siparis_id} value={p575Draft.orderId} onChange={e=>setP575Draft(d=>({...d,orderId:e.target.value}))} />
                      <input className="apple-input px-3 py-2 text-sm" placeholder={oc(tr575).musteri_adi} value={p575Draft.customerName} onChange={e=>setP575Draft(d=>({...d,customerName:e.target.value}))} />
                      <input className="apple-input px-3 py-2 text-sm col-span-2" placeholder={oc(tr575).iade_nedeni} value={p575Draft.reason} onChange={e=>setP575Draft(d=>({...d,reason:e.target.value}))} />
                      <input type="number" className="apple-input px-3 py-2 text-sm" placeholder={oc(tr575).tutar_2} value={p575Draft.amount} onChange={e=>setP575Draft(d=>({...d,amount:e.target.value}))} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async ()=>{
                        if(!p575Draft.customerName||!p575Draft.reason) return;
                        // Tutar OPSİYONEL alan: boş = BİLİNMİYOR (eski `Number('')||0` ₺0 kaydediyordu).
                        // Girildiyse pozitif olmalı. Bu formda sipariş seçili değil (orderId serbest metin) → üst sınır yok.
                        const iade575 = iadeTutariDogrula(p575Draft.amount, null);
                        if(iade575.hata === 'pozitifDegil'){ toast(op(tr575).iade_tutari_sifirdan_buyuk_olmali,'error'); return; }
                        const onceki575 = p575EditId ? p575Returns.find(r=>r.id===p575EditId)?.amount : undefined;
                        const payload={orderId:p575Draft.orderId,customerName:p575Draft.customerName,reason:p575Draft.reason,...iadeTutarYamasi(iade575,onceki575)};
                        try {
                          if(p575EditId){ await updateDoc(doc(db,'salesReturns',p575EditId),payload); }
                          else { await addDoc(collection(db,'salesReturns'),{...payload,status:'Bekliyor',createdAt:serverTimestamp()}); }
                          setP575Draft({orderId:'',customerName:'',reason:'',amount:''});
                          setP575ShowForm(false); setP575EditId(null);
                          toast(tr575?(p575EditId?'İade güncellendi.':'İade talebi oluşturuldu.'):(p575EditId?'Return updated.':'Return request created.'),'success');
                        } catch(e){ toast((oc(tr575).kaydedilemedi)+(e instanceof Error?e.message:String(e)),'error'); }
                      }} className="apple-button-primary text-sm px-4 py-1.5">{oc(tr575).kaydet}</button>
                      <button onClick={()=>{setP575ShowForm(false);setP575EditId(null);}} className="apple-button-secondary text-sm px-4 py-1.5">{oc(tr575).iptal}</button>
                    </div>
                  </div>
                )}
                {p575Returns.length === 0 ? (
                  <p className="text-center py-6 text-gray-400 text-sm">{op(tr575).henuz_iade_sikayet_kaydi_yok}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-gray-100 bg-gray-50">
                        {[oc(tr575).musteri, oc(tr575).siparis_id, oc(tr575).neden, oc(tr575).tutar, oc(tr575).durum].map(h=>(
                          <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody className="divide-y divide-gray-50">
                        {p575Returns.map(r=>(
                          <tr key={r.id} className="hover:bg-gray-50/50">
                            <td className="px-3 py-2.5 font-medium text-gray-800">{r.customerName}</td>
                            <td className="px-3 py-2.5 font-mono text-gray-500">{r.orderId||'—'}</td>
                            <td className="px-3 py-2.5 text-gray-600 max-w-[200px] truncate">{r.reason}</td>
                            {/* Hücre ile düzenleme ön-dolumu AYNI "gösterilebilir tutar" tanımını kullanır
                                (iadeGorunenTutar): hücre '—' gösterirken form '0' ile açılıyor ve kullanıcı
                                tutara dokunmadan kaydedince doğrulama 'pozitifDegil' deyip kaydı durduruyordu. */}
                            <td className="px-3 py-2.5 font-bold font-mono text-gray-700">{paraYaz(iadeGorunenTutar(r.amount))}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                              <select value={r.status} onChange={async e=>{try{await updateDoc(doc(db,'salesReturns',r.id),{status:e.target.value});}catch(err){toast((oc(tr575).guncellenemedi)+(err instanceof Error?err.message:String(err)),'error');}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 cursor-pointer ${statusColors575[r.status]}`}>
                                {(['Bekliyor','Onaylandı','Reddedildi','Tamamlandı'] as const).map(s=>(
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                              <button type="button" onClick={()=>{const gorunen=iadeGorunenTutar(r.amount);setP575Draft({orderId:r.orderId,customerName:r.customerName,reason:r.reason,amount:gorunen===null?'':String(gorunen)});setP575EditId(r.id);setP575ShowForm(true);}} title={oc(tr575).duzenle} className="text-gray-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                              <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'salesReturns',r.id));}catch(e){toast((oc(tr575).silinemedi)+(e instanceof Error?e.message:String(e)),'error');}}} title="Sil" className="text-gray-300 hover:text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                              </div>
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

          {/* ── Phase 583: Garanti & Servis Talepleri ─────────────────────── */}
          {activeTab === 'orders' && !selectedOrder && (() => {
            const tr583 = currentLanguage === 'tr';
            const statusColors583: Record<string,string> = {'Açık':'bg-red-100 text-red-700','İşlemde':'bg-amber-100 text-amber-700','Kapatıldı':'bg-green-100 text-green-700'};
            const prioColors583: Record<string,string> = {'Yüksek':'bg-red-50 border-l-red-400','Orta':'bg-amber-50 border-l-amber-300','Düşük':'bg-gray-50 border-l-gray-300'};
            return (
              <div className="apple-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900 text-sm">{op(tr583).garanti_servis_talepleri}</h3>
                  {hasFullAccess('orders') && (
                    <button onClick={()=>setP583ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm">
                      <Plus className="w-4 h-4"/>{op(tr583).talep_ekle}
                    </button>
                  )}
                </div>
                {p583ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <input className="apple-input px-3 py-2 text-sm" placeholder={oc(tr583).musteri} value={p583Draft.customerName} onChange={e=>setP583Draft(d=>({...d,customerName:e.target.value}))} />
                      <input className="apple-input px-3 py-2 text-sm" placeholder={op(tr583).urun_adi} value={p583Draft.productName} onChange={e=>setP583Draft(d=>({...d,productName:e.target.value}))} />
                      <input className="apple-input px-3 py-2 text-sm" placeholder={oc(tr583).seri_no} value={p583Draft.serialNo} onChange={e=>setP583Draft(d=>({...d,serialNo:e.target.value}))} />
                      <input type="date" className="apple-input px-3 py-2 text-sm" placeholder={oc(tr583).garanti_bitis} value={p583Draft.warrantyEnd} onChange={e=>setP583Draft(d=>({...d,warrantyEnd:e.target.value}))} />
                      <select className="apple-input px-3 py-2 text-sm" value={p583Draft.priority} onChange={e=>setP583Draft(d=>({...d,priority:e.target.value as 'Düşük'|'Orta'|'Yüksek'}))}>
                        <option value="Düşük">{op(tr583).dusuk_oncelik}</option>
                        <option value="Orta">{op(tr583).orta_oncelik}</option>
                        <option value="Yüksek">{op(tr583).yuksek_oncelik}</option>
                      </select>
                      <input className="apple-input px-3 py-2 text-sm col-span-2 md:col-span-1" placeholder={op(tr583).sorun_aciklamasi} value={p583Draft.description} onChange={e=>setP583Draft(d=>({...d,description:e.target.value}))} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async ()=>{
                        if(!p583Draft.customerName||!p583Draft.description) return;
                        const payload={customerName:p583Draft.customerName,productName:p583Draft.productName,serialNo:p583Draft.serialNo||'',warrantyEnd:p583Draft.warrantyEnd||'',description:p583Draft.description,priority:p583Draft.priority};
                        try {
                          if(p583EditId){ await updateDoc(doc(db,'serviceRequests',p583EditId),payload); }
                          else { await addDoc(collection(db,'serviceRequests'),{...payload,issueDate:bugunAnahtari(),status:'Açık',createdAt:serverTimestamp()}); }
                          setP583Draft({customerName:'',productName:'',serialNo:'',warrantyEnd:'',description:'',priority:'Orta'});
                          setP583ShowForm(false); setP583EditId(null);
                          toast(tr583?(p583EditId?'Talep güncellendi.':'Servis talebi oluşturuldu.'):(p583EditId?'Request updated.':'Service request created.'),'success');
                        } catch(e){ toast((oc(tr583).kaydedilemedi)+(e instanceof Error?e.message:String(e)),'error'); }
                      }} className="apple-button-primary text-sm px-4 py-1.5">{oc(tr583).kaydet}</button>
                      <button onClick={()=>{setP583ShowForm(false);setP583EditId(null);}} className="apple-button-secondary text-sm px-4 py-1.5">{oc(tr583).iptal}</button>
                    </div>
                  </div>
                )}
                {p583Requests.length === 0 ? (
                  <p className="text-center py-6 text-gray-400 text-sm">{op(tr583).henuz_servis_talebi_yok}</p>
                ) : (
                  <div className="space-y-2">
                    {p583Requests.map(r=>(
                      <div key={r.id} className={`flex items-start justify-between p-3 rounded-xl border border-l-4 ${prioColors583[r.priority]}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-gray-800 text-sm">{r.customerName}</p>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors583[r.status]}`}>{r.status}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{r.productName} {r.serialNo?`• S/N: ${r.serialNo}`:''} • {r.issueDate}</p>
                          <p className="text-xs text-gray-600 mt-1 line-clamp-1">{r.description}</p>
                        </div>
                        <div className="ml-3 flex items-center gap-2 shrink-0">
                        <select value={r.status} onChange={async e=>{try{await updateDoc(doc(db,'serviceRequests',r.id),{status:e.target.value});}catch(err){toast((oc(tr583).guncellenemedi)+(err instanceof Error?err.message:String(err)),'error');}}} className="text-[10px] font-bold bg-transparent border-0 cursor-pointer">
                          <option>Açık</option><option>İşlemde</option><option>Kapatıldı</option>
                        </select>
                        <button type="button" onClick={()=>{setP583Draft({customerName:r.customerName,productName:r.productName,serialNo:r.serialNo||'',warrantyEnd:r.warrantyEnd||'',description:r.description,priority:r.priority});setP583EditId(r.id);setP583ShowForm(true);}} title={oc(tr583).duzenle} className="text-gray-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                        <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'serviceRequests',r.id));}catch(e){toast((oc(tr583).silinemedi)+(e instanceof Error?e.message:String(e)),'error');}}} title="Sil" className="text-gray-300 hover:text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Phase 609: SLA & Müşteri Destek Takibi ────────────────────────── */}
          {activeTab === 'orders' && !selectedOrder && (() => {
            const tr609 = currentLanguage === 'tr';
            const openTickets = p609Tickets.filter(t=>t.status==='Açık'||t.status==='İşlemde');
            const resolvedTickets = p609Tickets.filter(t=>t.status==='Çözüldü'||t.status==='Kapatıldı');
            const memnuniyet609 = memnuniyetOrtalamasi(resolvedTickets);
            const avgSatScore = memnuniyet609 === null ? '—' : memnuniyet609.toFixed(1);
            const slaBreached = p609Tickets.filter(t=>{
              if (t.status==='Kapatıldı'||t.status==='Çözüldü') return false;
              const createdMs = zamanMs(t.createdAt);
              if (createdMs === null) return false; // tarihi bilinmeyen bilet ihlal sayılmaz
              const hours = (Date.now()-createdMs)/3600000;
              return hours>t.slaHours;
            }).length;
            const priorityColor:{[k:string]:string} = {'Kritik':'text-red-600 bg-red-50','Yüksek':'text-orange-600 bg-orange-50','Orta':'text-amber-600 bg-amber-50','Düşük':'text-gray-600 bg-gray-50'};
            return (
              <div className="apple-card p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-bold text-gray-900 text-sm">🎫 {op(tr609).sla_destek_biletleri}</h3>
                  <button onClick={()=>setP609ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{op(tr609).bilet_ac}</button>
                </div>
                {p609ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <input className="apple-input col-span-2" placeholder={oc(tr609).musteri} value={p609Draft.customer} onChange={e=>setP609Draft(d=>({...d,customer:e.target.value}))}/>
                      <input className="apple-input col-span-2" placeholder={oc(tr609).konu} value={p609Draft.subject} onChange={e=>setP609Draft(d=>({...d,subject:e.target.value}))}/>
                      <select value={p609Draft.priority} onChange={e=>setP609Draft(d=>({...d,priority:e.target.value as typeof d.priority}))} className="apple-input">
                        {['Düşük','Orta','Yüksek','Kritik'].map(p=><option key={p}>{p}</option>)}
                      </select>
                      <input type="number" className="apple-input" placeholder="SLA (h)" value={p609Draft.slaHours} onChange={e=>setP609Draft(d=>({...d,slaHours:e.target.value}))}/>
                    </div>
                    <button onClick={async ()=>{
                      if(!p609Draft.customer||!p609Draft.subject) return;
                      const payload={customer:p609Draft.customer,subject:p609Draft.subject,priority:p609Draft.priority,slaHours:Number(p609Draft.slaHours)||24};
                      try {
                        if(p609EditId){ await updateDoc(doc(db,'helpdeskTickets',p609EditId),payload); }
                        else { await addDoc(collection(db,'helpdeskTickets'),{...payload,status:'Açık',createdAt:new Date().toISOString()}); }
                        setP609Draft({customer:'',subject:'',priority:'Orta',slaHours:'24'});
                        setP609ShowForm(false); setP609EditId(null);
                        toast(tr609?(p609EditId?'Bilet güncellendi.':'Bilet açıldı.'):(p609EditId?'Ticket updated.':'Ticket created.'),'success');
                      } catch(e){ toast((oc(tr609).kaydedilemedi)+(e instanceof Error?e.message:String(e)),'error'); }
                    }} className="apple-button-primary text-xs px-6">{op(tr609).ac}</button>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    {label:oc(tr609).acik,val:openTickets.length,color:'text-blue-600',bg:'bg-blue-50'},
                    {label:op(tr609).sla_ihlali,val:slaBreached,color:'text-red-600',bg:'bg-red-50'},
                    {label:op(tr609).cozulen,val:resolvedTickets.length,color:'text-emerald-600',bg:'bg-emerald-50'},
                    {label:op(tr609).musteri_skoru,val:avgSatScore,color:'text-amber-600',bg:'bg-amber-50'},
                  ].map(k=>(
                    <div key={k.label} className={`rounded-xl p-3 ${k.bg}`}><p className="text-[10px] font-bold text-gray-400 uppercase">{k.label}</p><p className={`text-xl font-black ${k.color}`}>{k.val}</p></div>
                  ))}
                </div>
                {p609Tickets.length > 0 && (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {[...p609Tickets].sort((a,b)=>{const pr={Kritik:0,Yüksek:1,Orta:2,Düşük:3};return pr[a.priority]-pr[b.priority];}).map(t=>{
                      const createdMs = zamanMs(t.createdAt);
                      const hoursOpen = createdMs === null ? null : (Date.now()-createdMs)/3600000;
                      const slaOk = hoursOpen===null||hoursOpen<=t.slaHours||t.status==='Çözüldü'||t.status==='Kapatıldı';
                      return (
                        <div key={t.id} className={`flex items-center gap-3 border rounded-xl px-4 py-2.5 ${slaOk?'border-gray-100':'border-red-200 bg-red-50/30'}`}>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${priorityColor[t.priority]}`}>{t.priority}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-800 truncate">{t.customer} — {t.subject}</p>
                            <p className="text-[10px] text-gray-400">{hoursOpen===null?'—':`${Math.round(hoursOpen)}h`} {oc(tr609).acik_2} · SLA: {t.slaHours}h{!slaOk?' ⚠️':''}</p>
                          </div>
                          <select value={t.status} onChange={async e=>{try{await updateDoc(doc(db,'helpdeskTickets',t.id),{status:e.target.value,...(['Çözüldü','Kapatıldı'].includes(e.target.value)?{resolvedAt:new Date().toISOString()}:{})});}catch(err){toast((oc(tr609).guncellenemedi)+(err instanceof Error?err.message:String(err)),'error');}}} className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white shrink-0">
                            {['Açık','İşlemde','Çözüldü','Kapatıldı'].map(s=><option key={s}>{s}</option>)}
                          </select>
                          <button type="button" onClick={()=>{setP609Draft({customer:t.customer,subject:t.subject,priority:t.priority,slaHours:String(t.slaHours)});setP609EditId(t.id);setP609ShowForm(true);}} title={oc(tr609).duzenle} className="text-gray-300 hover:text-blue-600 transition-colors shrink-0"><Edit2 className="w-3.5 h-3.5"/></button>
                          <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'helpdeskTickets',t.id));}catch(e){toast((oc(tr609).silinemedi)+(e instanceof Error?e.message:String(e)),'error');}}} title="Sil" className="text-gray-300 hover:text-red-600 transition-colors shrink-0"><Trash2 className="w-3.5 h-3.5"/></button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {p609Tickets.length === 0 && <p className="text-center text-gray-400 text-xs py-4">{op(tr609).henuz_destek_bileti_yok}</p>}
              </div>
            );
          })()}

          {/* ── Phase 621: Talep Yönetimi (Demand Management) ──────────────── */}
          {activeTab === 'orders' && !selectedOrder && (() => {
            const tr621 = currentLanguage === 'tr';
            const statusCls:{[k:string]:string}={Bekliyor:'bg-amber-100 text-amber-700',Onaylandı:'bg-emerald-100 text-emerald-700',Reddedildi:'bg-red-100 text-red-700','Sipariş Verildi':'bg-blue-100 text-blue-700'};
            const pending621 = p621Demands.filter(d=>d.status==='Bekliyor').length;
            return (
              <div className="apple-card p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-bold text-gray-900 text-sm">📋 {op(tr621).talep_yonetimi}</h3>
                  <button onClick={()=>setP621ShowForm(v=>!v)} className="apple-button-secondary text-xs flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>{oc(tr621).talep_ekle}</button>
                </div>
                {pending621>0&&<div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-amber-700">{pending621} {op(tr621).bekleyen_talep}</div>}
                {p621ShowForm && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <input className="apple-input col-span-2 md:col-span-1" placeholder={oc(tr621).urun_adi} value={p621Draft.productName} onChange={e=>setP621Draft(d=>({...d,productName:e.target.value}))}/>
                      <input className="apple-input" placeholder="SKU" value={p621Draft.sku} onChange={e=>setP621Draft(d=>({...d,sku:e.target.value}))}/>
                      <input type="number" className="apple-input" placeholder={oc(tr621).miktar} value={p621Draft.requestedQty} onChange={e=>setP621Draft(d=>({...d,requestedQty:e.target.value}))}/>
                      <input className="apple-input" placeholder={op(tr621).talep_eden} value={p621Draft.requestedBy} onChange={e=>setP621Draft(d=>({...d,requestedBy:e.target.value}))}/>
                      <select value={p621Draft.priority} onChange={e=>setP621Draft(d=>({...d,priority:e.target.value as typeof d.priority}))} className="apple-input">
                        {['Düşük','Orta','Yüksek'].map(p=><option key={p}>{p}</option>)}
                      </select>
                      <input className="apple-input col-span-2 md:col-span-1" placeholder={oc(tr621).notlar} value={p621Draft.notes} onChange={e=>setP621Draft(d=>({...d,notes:e.target.value}))}/>
                    </div>
                    <button onClick={async ()=>{
                      if(!p621Draft.productName||!p621Draft.requestedQty) return;
                      try { await addDoc(collection(db,'demandRequests'),{productName:p621Draft.productName,sku:p621Draft.sku,requestedQty:Number(p621Draft.requestedQty),requestedBy:p621Draft.requestedBy,priority:p621Draft.priority,status:'Bekliyor',notes:p621Draft.notes||'',createdAt:new Date().toISOString()}); toast(op(currentLanguage).talep_olusturuldu, 'success'); } catch(e){console.error("[firestore]", e); toast(op(currentLanguage).talep_olusturulamadi, 'error');}
                      setP621Draft(d=>({...d,productName:'',sku:'',requestedQty:'',requestedBy:'',notes:''}));
                      setP621ShowForm(false);
                      toast(op(tr621).talep_olusturuldu_2,'success');
                    }} className="apple-button-primary text-xs px-6">{oc(tr621).olustur}</button>
                  </div>
                )}
                {p621Demands.length > 0 && (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {[...p621Demands].sort((a,b)=>{const pr={Yüksek:0,Orta:1,Düşük:2};return pr[a.priority]-pr[b.priority];}).map(d=>(
                      <div key={d.id} className="flex items-center gap-3 border border-gray-100 rounded-xl px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-800">{d.productName} {d.sku&&<span className="text-gray-400 font-normal">({d.sku})</span>}</p>
                          <p className="text-[10px] text-gray-400">{d.requestedBy} · {d.requestedQty} {oc(tr621).adet} · {d.priority}</p>
                        </div>
                        <select value={d.status} onChange={async e=>{try{await updateDoc(doc(db,'demandRequests',d.id),{status:e.target.value});}catch(err){console.error(err);}}} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 shrink-0 ${statusCls[d.status]}`}>
                          {['Bekliyor','Onaylandı','Reddedildi','Sipariş Verildi'].map(s=><option key={s}>{s}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
                {p621Demands.length===0&&<p className="text-center text-gray-400 text-xs py-4">{op(tr621).urun_talepleri_ekleyin}</p>}
              </div>
            );
          })()}


        </motion.div>
      )}
      {selectedOrder && (
        <motion.div key="order-detail" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setSelectedOrder(null)} className="text-gray-500 hover:text-gray-900 bg-white p-2 rounded-full shadow-sm border border-gray-200 shrink-0">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <ModuleHeader
                  title={`${op(currentLanguage).siparis} ${gorunenSiparisNo(selectedOrder)}`}
                  subtitle={`Customer: ${selectedOrder.customerName}`}
                  className="mb-0 w-full"
                  actionButton={
                    <div className="flex gap-2 flex-wrap">
                      {/* LİSTE İLE AYNI TANIM (son inceleme): sözde Mikro siparişinde onay yok; yerel durum yalnız yazım
                          GERÇEKLEŞTİYSE değişir — eskiden kapı reddetse de detay "Processing" gösteriyordu. */}
                      {selectedOrder.status === 'Pending' && selectedOrder.source !== 'mikro-siparis' && (
                        <button onClick={() => { const id = selectedOrder.id; openConfirm({
                          title: currentT.confirm_approve_title,
                          message: currentT.confirm_approve_msg,
                          confirmLabel: currentT.approve,
                          onConfirm: async () => { if (await handleUpdateOrderStatus(id, 'Processing')) setSelectedOrder(o => (o && o.id === id ? { ...o, status: 'Processing' } : o)); }
                        }); }}
                          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-emerald-200 transition-colors">
                          Approve
                        </button>
                      )}
                      {/* Mikro e-Fatura button in order detail */}
                      {/* Satirdaki dugmeyle AYNI kaynak (faturaDurumu) — detay penceresi yarim duzeltme kalmasin (code-review 2026-09-24). */}
                      {mikroyaFaturaGonderilebilir(selectedOrder) && (
                        <button
                          onClick={() => void handleMikroFatura(selectedOrder)}
                          disabled={!!faturaLoading[selectedOrder.id]}
                          className="bg-[#1a3a5c]/10 hover:bg-[#1a3a5c] text-[#1a3a5c] hover:text-white px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-[#1a3a5c]/20 transition-colors disabled:opacity-40"
                        >
                          {faturaLoading[selectedOrder.id] ? <RefreshCw className="w-4 h-4 animate-spin"/> : <FileUp className="w-4 h-4"/>}
                          {op(currentLanguage).mikro_ya_fatura}
                        </button>
                      )}
                      {selectedOrder.mikroFaturaNo && (
                        <span className="bg-[#1a3a5c]/10 text-[#1a3a5c] px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-[#1a3a5c]/20">
                          <CheckCircle2 className="w-4 h-4"/> Mikro: {selectedOrder.mikroFaturaNo}
                        </span>
                      )}
                      {/* e-İrsaliye — sevk edilmiş, irsaliyesi HENÜZ KESİLMEMİŞ siparişte.
                          Gönderilemiyorsa düğme DEVRE DIŞI ve nedeni ipucunda yazar (sessizce
                          çalışmayan düğme yok). Kapı, Shipped otomatiğiyle AYNI tanımdan
                          (irsaliyeIstegi) türer.
                          "Kesilmiş mi?" sorusunun yanıtı `irsaliyeNo` DEĞİL: Mikro başarı dönüp
                          numara döndürmeyebilir; o durumda numara uydurulmadığı için tek işaret
                          `irsaliyeGonderildi` olur. Yalnız numaraya bakmak düğmeyi açık bırakır
                          ve aynı sevkiyat ikinci kez resmî belge olarak kesilir. */}
                      {/* "Kesilmiş mi?" sorusu CANLI listeden (`orders`) de sorulur: `selectedOrder`
                          bu sayfanın yerel kopyasıdır ve bir yazıcı onu bayat kapanıştan yayarsa
                          işaret yerelde kaybolur, düğme yeniden etkin görünürdü (2026-09-19 delta).
                          App.tsx'teki `eIrsaliyeKilidiAl` ikinci POST'u zaten durduruyor; bu kapı
                          düğmeyi HİÇ göstermeyerek kullanıcıyı yanıltmayı da önler. */}
                      {(selectedOrder.status === 'Shipped' || selectedOrder.status === 'Delivered')
                        && !selectedOrder.irsaliyeNo && !selectedOrder.irsaliyeGonderildi
                        && !orders.some(o => o.id === selectedOrder.id && (o.irsaliyeGonderildi === true || !!o.irsaliyeNo)) && (() => {
                        const istek = irsaliyeIstegi(selectedOrder, leads.find(l => l.id === selectedOrder.leadId));
                        const suruyor = !!eIrsaliyeGonderiliyor[selectedOrder.id];
                        return (
                          <span title={!irsaliyeKesebilir ? (op(currentLanguage).e_irsaliye_kesme_yetkiniz_yok_yonetici_lojistik_) : istek.neden ? irsaliyeNedenMetni(istek.neden, currentLanguage) : ''} className="inline-flex">
                            <button
                              onClick={() => { eIrsaliyeOnayiAc(selectedOrder); }}
                              disabled={!istek.gonderilebilir || suruyor || !irsaliyeKesebilir}
                              className="bg-[#1a3a5c]/10 hover:bg-[#1a3a5c] text-[#1a3a5c] hover:text-white px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-[#1a3a5c]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#1a3a5c]/10 disabled:hover:text-[#1a3a5c]"
                            >
                              {suruyor ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Truck className="w-4 h-4"/>}
                              {suruyor
                                ? (op(currentLanguage).gonderiliyor)
                                : (op(currentLanguage).e_irsaliye_gonder)}
                            </button>
                          </span>
                        );
                      })()}
                      {/* Numara bilinmiyorsa UYDURULMAZ: rozet "kesildi ama numara gelmedi" der. */}
                      {(selectedOrder.irsaliyeNo || selectedOrder.irsaliyeGonderildi) && (
                        <span className="bg-[#1a3a5c]/10 text-[#1a3a5c] px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-[#1a3a5c]/20">
                          <CheckCircle2 className="w-4 h-4"/> e-İrsaliye: {selectedOrder.irsaliyeNo
                            || (op(currentLanguage).gonderildi_numara_gelmedi)}
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
                          {oc(currentLanguage).odeme_linki}
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
                      {/* Phase 504: Clone/Duplicate Order */}
                      <button
                        onClick={() => {
                          const o = selectedOrder;
                          setNewOrder({
                            customerName: o.customerName,
                            customerEmail: o.customerEmail,
                            shippingAddress: o.shippingAddress,
                            status: 'Pending',
                            customerType: o.customerType,
                            cargoCompany: o.cargoCompany,
                            faturali: o.faturali,
                            faturaTipi: o.faturaTipi,
                            kdvOran: o.kdvOran,
                            notes: o.notes,
                            totalPrice: o.totalPrice,
                          });
                          setOrderLineItems((o.lineItems || []).map(li => ({ ...li, id: `${li.id}-clone-${Date.now()}` })));
                          setSelectedLead(leads.find(l => l.id === o.leadId) || null);
                          setIsAddingOrder(true);
                          toast(op(currentLanguage).siparis_kopyalandi_duzenleyebilirsiniz, 'success');
                        }}
                        className="bg-white hover:bg-indigo-50 text-gray-700 hover:text-indigo-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 hover:border-indigo-200 transition-colors"
                        title={op(currentLanguage).siparisi_klonla_yeni_taslak_olarak_ac}
                      >
                        <Copy className="w-4 h-4" />
                        {op(currentLanguage).klonla}
                      </button>
                      {/* Phase 505: Print Order Receipt PDF */}
                      <button
                        onClick={async () => {
                          const o = selectedOrder;
                          try {
                          const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
                          const doc505 = new jsPDF({ format: 'a4', unit: 'mm' });
                          await registerTurkishFont(doc505);
                          const W = doc505.internal.pageSize.getWidth();
                          // Belge Tasarimcisi sablonu (Ayarlar → Belge Tasarimcisi → Siparis).
                          // Okunamazsa null doner, asagidaki varsayilanlar gecerli kalir.
                          const sablon505 = await sablonGetir('siparis');
                          const marka505 = sablonRengi(sablon505);
                          const oDate = tarihYaz(o.createdAt ?? o.syncedAt);
                          // Baslik bandi TEK KAYNAK (src/utils/pdfTheme.ts) — eskiden 28 mm elle bant
                          // cizen kopya vardi; 32 mm standardi bilincli, govde donen Y'den baslar.
                          // 'SİPARİŞ FIŞI' yaziyordu — noktasiz I yanlis, dogrusu 'FİŞİ'.
                          const govdeY505 = pdfBaslik(doc505, {
                            belgeAdi: sablon505?.title?.trim() || (op(currentLanguage).siparis_fisi),
                            meta: `${gorunenSiparisNo(o)}  |  ${oDate}`,
                            renk: marka505,
                          });
                          doc505.setTextColor(30, 30, 30);
                          doc505.setFontSize(11); doc505.setFont('Roboto', 'bold');
                          doc505.text(o.customerName, 14, govdeY505);
                          doc505.setFontSize(9); doc505.setFont('Roboto', 'normal');
                          doc505.setTextColor(120, 120, 120);
                          if (o.shippingAddress) doc505.text(o.shippingAddress, 14, govdeY505 + 6);
                          if (o.customerEmail) doc505.text(o.customerEmail, 14, govdeY505 + 11);
                          const lineItems505 = (o.lineItems || []);
                          // Kalemleri Cetpa'ya aktarılmamış Mikro faturası siparişi: kalemler Mikro'dan canlı (MF-383, 2026-09-25:
                          // "fiş pdf diyince detayı olmadığı için çekemiyor"). Tutarlar KDV hariç; iskonto ayrı sütun (services/mikroFaturaKalemleri.mikroKalemTablosu).
                          const mikroEvrak505 = lineItems505.length === 0 ? kalemleriMikrodanOkunacak(o) : null;
                          const mikroKalem505 = mikroEvrak505 ? await mikroFaturaKalemleriGetir(mikroEvrak505, currentLanguage === 'tr') : null;
                          // Sürüm-2 MF kalemi (importun yazdığı, 2026-09-25): canlı okumayla AYNI tablo (kayitliKalemTablosu).
                          const kayitli505 = kayitliMikroKalemleri(o);
                          if (lineItems505.length > 0 && !kayitli505) {
                            autoTable(doc505, {
                              ...pdfTabloStili(marka505),
                              startY: govdeY505 + 20,
                              // Alt marj: tablo, alt bant (14 mm) + Durum/Business Suite satirlari (+16)
                              // icin yer birakarak kirilsin. autoTable varsayilani 14,11 mm ile finalY
                              // 283'e dayanabiliyor; Durum satiri (finalY+10) sonradan cizilen banda
                              // gomuluyordu (inceleme buldu). Gorunur geometri degismez, yalniz esik.
                              margin: { bottom: PDF_ALT_BANT_YUKSEKLIK + 20 },
                              head: [[ oc(currentLanguage).urun, 'SKU', oc(currentLanguage).adet_2, oc(currentLanguage).birim_fiyat, oc(currentLanguage).toplam ]],
                              // Mikro türevi kalem `price` taşımaz — ortak seçiciler (ekrandaki tabloyla aynı).
                              body: lineItems505.map(li => [ li.name || li.title || '', li.sku || '', li.quantity, paraYaz(kalemBirimFiyati(li)), paraYaz(kalemTutari(li)) ]),
                              foot: [
                                [{ content: oc(currentLanguage).toplam_2, colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } }, paraYaz(o.totalPrice)],
                                ...(kdvDahilKalemVar([o]) ? [[{ content: currentLanguage === 'tr' ? 'Mikro faturasından gelen kalemlerde tutar KDV dâhildir.' : 'Amounts on lines from Mikro invoices include VAT.', colSpan: 5, styles: { halign: 'right' as const, fontStyle: 'normal' as const, fontSize: 7, textColor: [120, 120, 120] as [number, number, number] } }]] : []),
                              ],
                              footStyles: { fillColor: PDF_RENK.light, fontStyle: 'bold', fontSize: 10 },
                            });
                          } else if (kayitli505 || (mikroKalem505 && mikroKalem505.ok && mikroKalem505.kalemler.length > 0)) {
                            // Tablo modeli ekranla ORTAK (services/mikroFaturaKalemleri.mikroKalemTablosu): aynı sütunlar (birim fiyat →
                            // iskonto → net, K-İSKONTO), aynı alt satırlar (masraf dahil) ve aynı notlar — ikisi ayrı kuruluyordu.
                            const tablo505 = kayitli505
                              ? kayitliKalemTablosu(kayitli505, o.totalPrice, currentLanguage)
                              : mikroKalemTablosu(mikroKalem505 && mikroKalem505.ok ? mikroKalem505.kalemler : [], o.totalPrice, currentLanguage);
                            const tr505 = currentLanguage === 'tr';
                            const iskontoVar505 = tablo505.iskonto.toplam > 0;   // ekranla AYNI kural (MikroSiparisKalemleri)
                            const alt505 = (etiket: string, tutar: string, kalin = false) =>
                              [{ content: etiket, colSpan: 5, styles: { halign: 'right' as const, ...(kalin ? { fontStyle: 'bold' as const } : {}) } }, tutar];
                            autoTable(doc505, {
                              ...pdfTabloStili(marka505),
                              startY: govdeY505 + 20,
                              margin: { bottom: PDF_ALT_BANT_YUKSEKLIK + 20 },
                              head: [[ oc(currentLanguage).urun, 'SKU', oc(currentLanguage).adet_2, tr505 ? 'Birim fiyat (KDV hariç)' : 'Unit price (excl. VAT)', tr505 ? 'İskonto' : 'Discount', tr505 ? 'Tutar (net, KDV hariç)' : 'Amount (net, excl. VAT)' ]],
                              body: tablo505.satirlar.map(r => [
                                r.ad,
                                r.sku ?? '',
                                r.miktarMetni,
                                paraYaz(r.birimFiyat),
                                r.iskonto === null ? '—' : r.iskonto > 0 ? `−${paraYaz(r.iskonto)}` : paraYaz(0),
                                paraYaz(r.net),
                              ]),
                              foot: [
                                ...(iskontoVar505 ? [
                                  alt505(tr505 ? 'Brüt toplam (KDV hariç)' : 'Gross total (excl. VAT)', paraYaz(ekranTutari(tablo505.brut))),
                                  alt505(tr505 ? 'İskonto' : 'Discount', `−${paraYaz(ekranTutari(tablo505.iskonto))}`),
                                ] : []),
                                alt505(tr505 ? 'Ara toplam (net, KDV hariç)' : 'Subtotal (net, excl. VAT)', paraYaz(ekranTutari(tablo505.ara))),
                                ...(tablo505.masraf !== null && tablo505.masraf > 0 ? [alt505(tr505 ? 'Masraf' : 'Charges', paraYaz(tablo505.masraf))] : []),
                                alt505(oc(currentLanguage).kdv, paraYaz(ekranTutari(tablo505.kdv))),
                                alt505(oc(currentLanguage).toplam_2, paraYaz(o.totalPrice), true),
                                ...tablo505.notlar.map(n => [{ content: n, colSpan: 6, styles: { halign: 'right' as const, fontStyle: 'normal' as const, fontSize: 7, textColor: [180, 90, 0] as [number, number, number] } }]),
                              ],
                              footStyles: { fillColor: PDF_RENK.light, fontStyle: 'bold', fontSize: 10 },
                            });
                          } else {
                            const y505 = govdeY505 + 20;
                            doc505.setFontSize(10); doc505.setTextColor(30,30,30);
                            doc505.text(`${oc(currentLanguage).toplam_tutar}: ${paraYaz(o.totalPrice)}`, 14, y505);
                            // Mikro'dan kalem okunamadıysa ya da faturada kalem yoksa SESSİZ geçme — fişte neden yazılır
                            // (ekrandaki metinlerle aynı).
                            if (mikroKalem505) {
                              doc505.setFontSize(8); doc505.setTextColor(180, 90, 0);
                              doc505.text(!mikroKalem505.ok
                                ? `${currentLanguage === 'tr' ? 'Kalemler Mikro faturasından alınamadı' : 'Lines could not be read from the Mikro invoice'}: ${mikroKalem505.hata}`
                                : (currentLanguage === 'tr' ? 'Mikro faturasında kalem bulunamadı.' : 'No lines on the Mikro invoice.'), 14, y505 + 6);
                            }
                          }
                          const finalY505 = (doc505 as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 80;
                          doc505.setFontSize(8); doc505.setTextColor(150,150,150);
                          // Durum ARTIK cevriliyor (eskiden ham 'Delivered' basiyordu).
                          // Odeme satiri: Mikro faturasindan TURETILEN siparislerde `paid`
                          // alani YOKTUR — bu "odenmedi" demek DEGIL, "bilinmiyor" demektir.
                          // Eskiden kosulsuz "Ödeme Bekleniyor" basiliyordu; musteriye giden
                          // fise yanlis bilgi yaziyordu.
                          const durum505 = siparisDurumEtiketi(o.status, currentLanguage);
                          const odeme505 = odemeTakipli(o)
                            ? (o.paid
                                ? (op(currentLanguage).odendi_2)
                                : (op(currentLanguage).odeme_bekleniyor))
                            : null;
                          doc505.text(
                            `${oc(currentLanguage).durum}: ${durum505}${odeme505 ? ` · ${odeme505}` : ''}`,
                            14, finalY505 + 10);

                          // Banka + alt bilgi ORTAK cizicide — sigmiyorsa yeni sayfa acar.
                          // Eskiden burada birikimli `altY505` akisi vardi ve sayfa sonu
                          // denetimi yoktu: 20 kalemli siparise IBAN A4'un altina tasip
                          // SESSIZCE kayboluyordu (inceleme olctu: son satir y≈305, sayfa 297).
                          const altY505 = belgeAltBilgisiCiz(doc505, {
                            baslangicY: finalY505 + 12,
                            banka: bankaBilgisiBasilir(sablon505),
                            footer: sablon505?.footer,
                            etiket: op(currentLanguage).banka_bilgileri,
                          });
                          doc505.setFontSize(8); doc505.setTextColor(150,150,150);
                          doc505.text('CETPA Business Suite — app.cetpa.com.tr', W / 2, altY505 + 4, { align: 'center' });
                          // Her sayfaya sablon renginde alt bant + gercek sayfa numarasi (pdfTheme).
                          pdfAltBilgi(doc505, { bant: marka505 });
                          doc505.save(`receipt-${(o.orderNumber || o.shopifyOrderId || o.id.slice(-8)).replace(/[^\w-]/g, '_')}.pdf`);
                          } catch (e) {
                            // Eskiden hata SESSIZDI: font/sablon/import basarisizliginda dosya
                            // inmiyor, kullanici butonu bozuk saniyordu.
                            console.error('Siparis fisi PDF hatasi:', e);
                            toast(op(currentLanguage).fis_pdf_olusturulamadi, 'error');
                          }
                        }}
                        className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 transition-colors"
                        title={op(currentLanguage).siparis_fisi_pdf_indir}
                      >
                        <FileDown className="w-4 h-4" />
                        {op(currentLanguage).fis_pdf}
                      </button>
                      {/* Phase 512: Quick Shipment from Order */}
                      {/* Teslim edilmiş / iptal / açık sevkiyatı olan siparişe sevkiyat AÇILMAZ (2026-09-25: "teslim edilen bir
                          şeye tekrar sevkiyat oluşturulamaz") — kural utils/siparisler/siparisIslemleri.sevkiyatEngeli. */}
                      <button
                        onClick={() => { if (sevkiyatEngeli(guncelSiparis(selectedOrder), shipments) === null) setShowQuickShipment(selectedOrder); }}
                        disabled={sevkiyatEngeli(guncelSiparis(selectedOrder), shipments) !== null}
                        className="bg-white hover:bg-blue-50 text-gray-700 hover:text-blue-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 hover:border-blue-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-gray-700 disabled:hover:border-gray-200"
                        title={(() => { const e = sevkiyatEngeli(guncelSiparis(selectedOrder), shipments); return e ? sevkiyatEngeliMetni(e, currentLanguage) : op(currentLanguage).sevkiyat_olustur; })()}
                      >
                        <Truck className="w-4 h-4" />
                        {oc(currentLanguage).sevkiyat}
                      </button>
                      {/* Copy public tracking link */}
                      <button
                        onClick={() => {
                          const url = `${window.location.origin}/?track=${selectedOrder.id}`;
                          navigator.clipboard.writeText(url).then(() =>
                            toast(op(currentLanguage).takip_linki_kopyalandi, 'success')
                          ).catch(() => toast(oc(currentLanguage).kopyalanamadi_tarayici_pano_iznini_engelledi, 'error'));
                        }}
                        className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 transition-colors"
                        title={op(currentLanguage).musteri_takip_linkini_kopyala}
                      >
                        <Link className="w-4 h-4" />
                        {op(currentLanguage).takip_linki}
                      </button>
                      {/* Phase 57: Copy Order Summary (WhatsApp-ready) */}
                      <button
                        onClick={() => {
                          const o = selectedOrder;
                          const trackUrl = `${window.location.origin}/?track=${o.id}`;
                          // Tutar ya da kur bilinmiyorsa mesaj HİÇ üretilmez: ne '—' ne de "₺0" müşteriye giden
                          // metne akar. Eski `||0` tutarı bilinmeyen siparişi "₺0" diye müşteriye yazıyordu.
                          const _waAmt = mesajTutari(o, kpiCurrency, exchangeRates);
                          if (_waAmt === BILINMIYOR) {
                            toast(currentLanguage === 'tr'
                              ? 'Tutar ya da kur bilinmiyor — özet kopyalanmadı.'
                              : 'Amount or exchange rate unknown — summary not copied.', 'error');
                            return;
                          }
                          const summary = currentLanguage === 'tr'
                            ? `📦 *Sipariş Özeti*\nSipariş No: ${gorunenSiparisNo(o)}\nMüşteri: ${o.customerName}\nDurum: ${o.status}\nTutar: ${_waAmt}\n${o.trackingNumber ? `Kargo Takip: ${o.trackingNumber}\n` : ''}Takip Linki: ${trackUrl}`
                            : `📦 *Order Summary*\nOrder: ${gorunenSiparisNo(o)}\nCustomer: ${o.customerName}\nStatus: ${o.status}\nTotal: ${_waAmt}\n${o.trackingNumber ? `Tracking: ${o.trackingNumber}\n` : ''}Link: ${trackUrl}`;
                          navigator.clipboard.writeText(summary).then(() =>
                            toast(op(currentLanguage).siparis_ozeti_kopyalandi, 'success')
                          ).catch(() => toast(oc(currentLanguage).kopyalanamadi_tarayici_pano_iznini_engelledi, 'error'));
                        }}
                        className="bg-white hover:bg-green-50 text-gray-700 hover:text-green-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 hover:border-green-200 transition-colors"
                        title={op(currentLanguage).whatsapp_ozeti_kopyala}
                      >
                        <MessageSquare className="w-4 h-4" />
                        {op(currentLanguage).ozet_kopyala}
                      </button>
                      {/* Phase 511: Payment Reminder copy button */}
                      {!selectedOrder.paid && odemeTakipli(selectedOrder) && (
                        <button
                          onClick={() => {
                            const o = selectedOrder;
                            // Ödeme hatırlatması MÜŞTERİYE gider: tutar ya da kur bilinmiyorsa mesaj üretilmez.
                            // Eski TL dalı `kurCevir`i ATLIYORDU: tutarı bilinmeyen siparişte metne '—' akıyor,
                            // müşteri "… için — tutarındaki ödemeniz" yazısını görüyordu.
                            const amt = mesajTutari(o, kpiCurrency, exchangeRates, 2);
                            if (amt === BILINMIYOR) {
                              toast(currentLanguage === 'tr'
                                ? 'Tutar ya da kur bilinmiyor — hatırlatma oluşturulmadı.'
                                : 'Amount or exchange rate unknown — reminder not generated.', 'error');
                              return;
                            }
                            const msg = currentLanguage === 'tr'
                              ? `Sayın ${o.customerName},\n\nSipariş No: ${gorunenSiparisNo(o)} için ${amt} tutarındaki ödemeniz henüz tarafımıza ulaşmamıştır.\n\nÖdemenizi en kısa sürede gerçekleştirmenizi rica ederiz.\n\nSaygılarımızla,\nCETPA`
                              : `Dear ${o.customerName},\n\nPayment of ${amt} for Order ${gorunenSiparisNo(o)} has not yet been received.\n\nPlease arrange payment at your earliest convenience.\n\nBest regards,\nCETPA`;
                            navigator.clipboard.writeText(msg).then(() =>
                              toast(op(currentLanguage).odeme_hatirlatmasi_kopyalandi, 'success')
                            ).catch(() => toast(oc(currentLanguage).kopyalanamadi_tarayici_pano_iznini_engelledi, 'error'));
                          }}
                          className="bg-amber-50 hover:bg-amber-100 text-amber-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-amber-200 transition-colors"
                          title={op(currentLanguage).odeme_hatirlatma_mesajini_kopyala}
                        >
                          <Bell className="w-4 h-4" />
                          {op(currentLanguage).hatirlatma}
                        </button>
                      )}
                      {/* Phase 513: Order Profitability popup */}
                      {selectedOrder.lineItems && selectedOrder.lineItems.length > 0 && siparisKar && (() => {
                        const { ciro: revenue, maliyet: cogs, kar: gp, marjYuzde, maliyetsizKalem } = siparisKar;
                        const marjSinif = marjYuzde === null ? 'bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200'
                          : marjYuzde >= 30 ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                          : marjYuzde >= 10 ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
                          : 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200';
                        return (
                          <div className="relative">
                            <button
                              onClick={() => setP513Selected(p513Selected === selectedOrder.id ? null : selectedOrder.id)}
                              className={cn(
                                "px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border transition-colors",
                                marjSinif
                              )}
                              title={op(currentLanguage).kar_analizi}
                            >
                              <TrendingUp className="w-4 h-4" />
                              {/* Rozet rengi bir YARGI bildirir: marj bilinmiyorken kırmızı '%0,0' basmak
                                  (eski `revenue > 0 ? … : 0`) zarar iddiasıydı — bilinmeyende nötr gri + '—'. */}
                              {marjYuzde === null
                                ? (op(currentLanguage).kar)
                                : (currentLanguage === 'tr' ? `Kâr %${marjYuzde.toFixed(1)}` : `Margin ${marjYuzde.toFixed(1)}%`)}
                            </button>
                            {p513Selected === selectedOrder.id && (
                              <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 p-5">
                                <div className="flex items-center justify-between mb-4">
                                  <h4 className="font-bold text-sm">{op(currentLanguage).kar_analizi_2}</h4>
                                  <button onClick={() => setP513Selected(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                                </div>
                                <div className="space-y-2.5 text-sm">
                                  <div className="flex justify-between">
                                    {/* Etiket netleştirildi: taban artık kalem cirosu (Σ fiyat×miktar), başlık
                                        `totalPrice` DEĞİL — maliyet kalemlerden geldiği için kârın iki tarafı
                                        aynı tabanda olmalı. Mikro faturasından türetilen siparişte başlık tutarı
                                        KDV dahildi ve marjı ~KDV kadar şişiriyordu. */}
                                    <span className="text-gray-500">{op(currentLanguage).kalem_cirosu}</span>
                                    <span className="font-bold text-emerald-600">{paraYaz(revenue)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">{op(currentLanguage).maliyet_cogs}</span>
                                    {/* '−' öneki elle yazıldığı için bilinmeyende "−—" olurdu; guard şart. */}
                                    <span className="font-bold text-red-500">{Number.isFinite(cogs) ? `−${paraYaz(cogs)}` : '—'}</span>
                                  </div>
                                  <div className="h-px bg-gray-100" />
                                  <div className="flex justify-between">
                                    <span className="font-bold">{oc(currentLanguage).brut_kar}</span>
                                    {/* Renk de bir iddiadır: `NaN >= 0` false olduğu için bilinmeyen kâr KIRMIZI (zarar) görünüyordu. */}
                                    <span className={cn("font-black", !Number.isFinite(gp) ? "text-gray-400" : gp >= 0 ? "text-emerald-600" : "text-red-600")}>{paraYaz(gp)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">{oc(currentLanguage).kar_marji}</span>
                                    <span className={cn("font-bold px-2 py-0.5 rounded-full text-xs", marjYuzde === null ? "bg-gray-100 text-gray-500" : marjYuzde >= 30 ? "bg-emerald-100 text-emerald-700" : marjYuzde >= 10 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
                                      {marjYuzde === null ? '—' : `%${marjYuzde.toFixed(1)}`}
                                    </span>
                                  </div>
                                  {/* maliyeti bilinmeyen kalem varsa kâr/marj neden '—' — açık not (CLAUDE.md: '—' VEYA açık not) */}
                                  {maliyetsizKalem > 0 && (
                                    <p className="text-[10px] text-amber-600 pt-1">
                                      {currentLanguage === 'tr'
                                        ? `${maliyetsizKalem} kalemin maliyeti bilinmiyor — kâr ve marj hesaplanmadı.`
                                        : `Cost unknown for ${maliyetsizKalem} item(s) — profit and margin not calculated.`}
                                    </p>
                                  )}
                                  {/* Item-level breakdown */}
                                  {selectedOrder.lineItems!.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                                      {selectedOrder.lineItems!.map((li, i) => {
                                        const s = siparisKar.satirlar[i];   // aynı sırada, aynı çözücüyle hesaplandı
                                        return (
                                          <div key={i} className="flex justify-between text-[11px]">
                                            <span className="text-gray-500 truncate max-w-[160px]">{li.name} ×{li.quantity}</span>
                                            <span className={!Number.isFinite(s.kar) ? "text-gray-400" : s.kar >= 0 ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>
                                              {paraYaz(s.kar)}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {/* Phase 112: RMA / Return button */}
                      {selectedOrder.status === 'Delivered' && (
                        <button
                          onClick={() => { setReturnModal({ open: true, order: selectedOrder }); setReturnAmount(iadeOnTutar(selectedOrder)); setReturnItems(''); setReturnReason(''); }}
                          className="bg-white hover:bg-orange-50 text-gray-700 hover:text-orange-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 hover:border-orange-200 transition-colors"
                          title={op(currentLanguage).iade_talebi_olustur}
                        >
                          <RefreshCw className="w-4 h-4" />
                          {op(currentLanguage).iade}
                        </button>
                      )}

                      {/* Phase 89: Mark Paid / Unpaid toggle in detail header.
                          Mikro faturasından türetilen siparişte GİZLİ: tahsilat gerçeği
                          Mikro cari hesapta, buradaki `paid` alanı anlamsız (2026-09-03). */}
                      {odemeTakipli(selectedOrder) && (
                      <button
                        onClick={() => handleToggleOrderPaid(selectedOrder)}
                        className={`px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border transition-colors ${
                          selectedOrder.paid
                            ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
                        }`}
                        title={selectedOrder.paid ? (oc(currentLanguage).odendi_tikla_odenmedi_yap) : (op(currentLanguage).bekliyor_tikla_odendi_yap)}
                      >
                        <CreditCard className="w-4 h-4" />
                        {selectedOrder.paid
                          ? (oc(currentLanguage).odendi_2)
                          : (oc(currentLanguage).odenmedi)}
                      </button>
                      )}
                      {/* Düzenle ONAY İSTEMEZ: eskiden silme onayının kopyasıyla ("Kaydı Sil — silmek istediğinize emin
                          misiniz?", onay düğmesi "Düzenle") açılıyordu (2026-09-25 bildirimi). Düzenleme yıkıcı değil; kalıcı
                          adım kaydetmedir. Mikro kaynaklı kayıt Cetpa'da düzenlenmez/silinmez — gerçeği Mikro'da
                          (utils/siparisler/siparisIslemleri.yerelDegistirilebilir). Etiketler dil sözlüğünden ("Edit"/"Delete"
                          sabit İngilizceydi). */}
                      <button
                        onClick={() => { if (!yerelDegistirilebilir(selectedOrder)) return; setEditingOrderData(selectedOrder); setEditingTutarHam(sayiGirdisi(selectedOrder.totalPrice)); setEditingKdvHam(sayiGirdisi(selectedOrder.kdvOran)); setIsEditingOrder(true); }}
                        disabled={!yerelDegistirilebilir(selectedOrder)}
                        title={yerelDegistirilebilir(selectedOrder) ? undefined : yerelDegistirilemezMetni(currentLanguage)}
                        className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white">
                        <Edit2 className="w-4 h-4" /> {oc(currentLanguage).duzenle}
                      </button>
                      <button
                        onClick={() => { if (!yerelDegistirilebilir(selectedOrder)) return; openConfirm({
                          title: currentT.confirm_delete_title,
                          message: currentT.confirm_delete,
                          confirmLabel: currentT.delete,
                          variant: 'danger',
                          onConfirm: () => { handleDeleteOrder(selectedOrder.id); setSelectedOrder(null); }
                        }); }}
                        disabled={!yerelDegistirilebilir(selectedOrder)}
                        title={yerelDegistirilebilir(selectedOrder) ? undefined : yerelDegistirilemezMetni(currentLanguage)}
                        className="bg-white hover:bg-red-50 text-red-600 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border border-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white">
                        <Trash2 className="w-4 h-4" /> {oc(currentLanguage).sil}
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
                        {/* İŞLEVSEL güncelleyici ZORUNLU: onay penceresi açıkken (kullanıcı
                            bekletebilir) e-İrsaliye yanıtı dönüp `irsaliyeGonderildi`
                            yazılabilir; kapanıştaki bayat `selectedOrder`ı yaymak o işareti
                            yerelde siler, düğme 'Delivered' koşuluyla yeniden ETKİN olur ve
                            aynı sevkiyat için İKİNCİ resmî belge kesilir (2026-09-19 delta). */}
                        <select value={selectedOrder.status}
                          disabled={!yerelDegistirilebilir(selectedOrder)}
                          title={selectedOrder.source === 'mikro-siparis' ? op(currentLanguage).mikro_siparisi_durumu_mikro_da_izlenir : !yerelDegistirilebilir(selectedOrder) ? yerelDegistirilemezMetni(currentLanguage) : undefined}
                          onChange={(e) => {
                          const yeniDurum = e.target.value as 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled';
                          const id = selectedOrder.id;
                          openConfirm({
                          title: currentT.status,
                          message: `Update status to "${yeniDurum}"?`,
                          onConfirm: async () => { if (await handleUpdateOrderStatus(id, yeniDurum)) setSelectedOrder(o => (o && o.id === id ? { ...o, status: yeniDurum } : o)); }
                        }); }}
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
                        <span className="font-bold text-lg">{paraYaz(selectedOrder.totalPrice)}</span>
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
                        <span className="font-medium">{(() => { const d = siparisTarih(selectedOrder); return d ? tarihSaatYaz(d) : currentT.unknown_date; })()}</span>
                      </div>
                      {/* Phase 95: Payment status + estimated delivery in detail grid */}
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-bold">
                          {oc(currentLanguage).odeme}
                        </span>
                        {odemeTakipli(selectedOrder) ? (
                        <button
                          onClick={() => handleToggleOrderPaid(selectedOrder)}
                          className={`mt-0.5 text-xs font-bold px-2.5 py-1 rounded-full transition-colors ${selectedOrder.paid ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
                        >
                          {selectedOrder.paid ? (oc(currentLanguage).odendi_2) : (oc(currentLanguage).odenmedi)}
                        </button>
                        ) : (
                          <span className="mt-0.5 inline-block text-xs font-medium text-gray-400"
                            title={oc(currentLanguage).tahsilat_durumu_mikro_cari_hesapta_izlenir_sipar}>
                            {op(currentLanguage).tahsilat_mikro_cari_hesapta}
                          </span>
                        )}
                      </div>
                      {/* estimatedDelivery tipi `unknown`; `x && <jsx>` sonucu unknown olup ReactNode'a atanamiyor -> dogruluk kontrolunu boolean'a indirge */}
                      {!!selectedOrder.estimatedDelivery && (() => {
                        const ed = zamanDate(selectedOrder.estimatedDelivery);
                        if (!ed) return null;
                        const isOverdue = ed < new Date() && selectedOrder.status !== 'Delivered' && selectedOrder.status !== 'Cancelled';
                        return (
                          <div>
                            <span className="text-gray-500 block text-[10px] uppercase font-bold">
                              {oc(currentLanguage).tahmini_teslimat}
                            </span>
                            <span className={`font-medium text-sm flex items-center gap-1.5 mt-0.5 ${isOverdue ? 'text-red-600' : 'text-gray-800'}`}>
                              {isOverdue && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                              {tarihYaz(ed)}
                              {isOverdue && <span className="text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{op(currentLanguage).gecikti}</span>}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  {/* Phase 40: Order Quick Note */}
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold">{currentT.notes}</h3>
                      {orderNoteSaved && <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{oc(currentLanguage).kaydedildi_2}</span>}
                    </div>
                    <textarea
                      value={orderNoteText}
                      onChange={e => { setOrderNoteText(e.target.value); setOrderNoteSaved(false); }}
                      onBlur={() => void handleSaveOrderNote()}
                      rows={4}
                      placeholder={currentT.no_notes_available}
                      className="w-full text-sm text-gray-700 bg-gray-50 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand/20 resize-none leading-relaxed"
                    />
                    {orderNoteSaving && <p className="text-[10px] text-gray-400 mt-1">{oc(currentLanguage).kaydediliyor_2}</p>}
                  </div>

                  {/* ── Phase 101: Order Activity Timeline ── */}
                  {(() => {
                    const events: TimelineEntry[] = [
                      // creation event from order data
                      ...((() => {
                        const ts = zamanMs(selectedOrder.createdAt ?? selectedOrder.syncedAt);
                        if (ts === null) return [] as TimelineEntry[];
                        return [{ action: op(currentLanguage).siparis_olusturuldu, actor: selectedOrder.customerName || '—', ts }] as TimelineEntry[];
                      })()),
                      // Firestore-stored timeline entries
                      ...orderTimeline,
                    ].sort((a, b) => a.ts - b.ts);

                    if (events.length === 0) return null;
                    return (
                      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                          <History className="w-4 h-4 text-brand" />
                          {op(currentLanguage).siparis_gecmisi}
                        </h3>
                        <div className="relative pl-5">
                          {/* vertical line */}
                          <div className="absolute left-2 top-1.5 bottom-1.5 w-px bg-gray-100" />
                          <div className="space-y-4">
                            {events.map((ev, i) => {
                              const isLast = i === events.length - 1;
                              return (
                                <div key={i} className="relative flex gap-3 items-start">
                                  <div className={`absolute -left-5 mt-0.5 w-3 h-3 rounded-full border-2 ${isLast ? 'bg-brand border-brand' : 'bg-white border-gray-300'}`} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-gray-800">{ev.action}</p>
                                    <p className="text-[10px] text-gray-400 mt-0.5">
                                      {ev.actor} · {tarihSaatYaz(ev.ts, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                    {ev.note && <p className="text-[10px] text-gray-500 mt-0.5 italic">"{ev.note}"</p>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                </div>
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h3 className="font-bold mb-4 flex items-center gap-2">
                      <Package className="w-5 h-5 text-brand" /> {currentT.order_items}
                    </h3>
                    {kayitliMikroKalemleri(selectedOrder) ? (
                      <MikroSiparisKalemleri
                        durum="hazir"
                        kalemler={[]}
                        kayitli={kayitliMikroKalemleri(selectedOrder) ?? undefined}
                        hata={null}
                        genelToplam={selectedOrder.totalPrice}
                        evrakNo={[selectedOrder.mikroEvrak?.seri, selectedOrder.mikroEvrak?.sira].filter(Boolean).join('') || gorunenSiparisNo(selectedOrder)}
                        dil={currentLanguage}
                      />
                    ) : selectedOrder.lineItems && selectedOrder.lineItems.length > 0 ? (
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
                                  <p className="font-bold text-[#1D2226]">{item.title || item.name}</p>
                                  {item.sku && <p className="text-[10px] text-gray-400">{item.sku}</p>}
                                </td>
                                <td className="px-4 py-3 text-center font-medium">{item.quantity}</td>
                                {/* Mikro türevi kalemde `price` yok, tutar `total`da (KDV dâhil) — ortak seçici (MF-383, 2026-09-25). */}
                                <td className="px-4 py-3 text-right text-gray-500">{paraYaz(kalemBirimFiyati(item))}</td>
                                <td className="px-4 py-3 text-right font-bold text-[#1D2226]">{paraYaz(kalemTutari(item))}</td>
                              </tr>
                            ))}
                          </tbody>
                          {/* İKİ ARIZA birden kalktı: (1) baştaki `$` JSX'te LİTERAL karakterdi — TL tutarı
                              dolar sembolü + `toFixed(2)` ile ABD biçiminde basılıyordu ('$11000.00');
                              (2) fiyatı/miktarı bilinmeyen kalemde toplam '$NaN' oluyordu. Bu alt toplam
                              EKRAN sözleşmesidir (kısmi toplam + yazılı sayaç) — kârın ciro tabanından
                              (TÜRETME, tek eksikte '—') BİLEREK ayrıdır. */}
                          <tfoot className="border-t border-gray-200 bg-gray-50">
                            {(() => {
                              const kalemT = toplaBilinen(selectedOrder.lineItems ?? [], kalemTutari);
                              const kdvDahil = kdvDahilKalemVar([selectedOrder]);
                              return (
                                <tr>
                                  <td colSpan={3} className="px-4 py-3 font-bold text-gray-500 text-sm">
                                    {currentT.total}
                                    {kalemT.bilinmeyen > 0 && (
                                      <span className="block text-[10px] font-normal text-amber-600">
                                        {currentLanguage === 'tr'
                                          ? `${kalemT.bilinmeyen} kalemin tutarı bilinmiyor — toplama girmedi.`
                                          : `Amount unknown for ${kalemT.bilinmeyen} item(s) — excluded from total.`}
                                      </span>
                                    )}
                                    {kdvDahil && (
                                      <span className="block text-[10px] font-normal text-gray-400">
                                        {currentLanguage === 'tr' ? 'Mikro faturasından gelen kalemlerde tutar KDV dâhildir.' : 'Amounts on lines from Mikro invoices include VAT.'}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right text-lg font-bold text-brand">
                                    {paraYaz(ekranTutari(kalemT))}
                                  </td>
                                </tr>
                              );
                            })()}
                          </tfoot>
                        </table>
                      </div>
                    ) : mikroKalemler.durum !== 'gerekmez' ? (
                      <MikroSiparisKalemleri
                        durum={mikroKalemler.durum}
                        kalemler={mikroKalemler.kalemler}
                        hata={mikroKalemler.hata}
                        genelToplam={selectedOrder.totalPrice}
                        evrakNo={[selectedOrder.mikroEvrak?.seri, selectedOrder.mikroEvrak?.sira].filter(Boolean).join('') || gorunenSiparisNo(selectedOrder)}
                        dil={currentLanguage}
                      />
                    ) : (
                      <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-xl">
                        <Package className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                        <p className="text-sm text-gray-500 font-medium">{currentT.no_items_on_order}</p>
                        <p className="text-xs text-gray-400 mt-1">{currentT.product_picker_hint}</p>
                      </div>
                    )}

                    {/* ── Phase 74: Gross Profit Summary ── */}
                    {selectedOrder.lineItems && selectedOrder.lineItems.length > 0 && siparisKar && (() => {
                      const { maliyet: cost, kar: gp, marjYuzde, maliyetsizKalem, satirlar } = siparisKar;
                      // HİÇBİR kalemin maliyeti bilinmiyorsa kutu hiç çizilmez (eski `hasCost` davranışı korunur).
                      // Eski kapı yalnız "HİÇ maliyet yok" hâlini eliyordu: KARIŞIK siparişte (biri biliniyor,
                      // öteki bilinmiyor) kapı açılıyor, eksik maliyet 0 sayılıp marj şişiyordu.
                      if (maliyetsizKalem === satirlar.length) return null;
                      const gpPct    = marjYuzde === null ? null : Math.round(marjYuzde);
                      const gpColor  = gpPct === null ? 'text-gray-400' : gpPct >= 40 ? 'text-emerald-700' : gpPct >= 20 ? 'text-amber-700' : 'text-red-600';
                      const gpBg     = gpPct === null ? 'bg-gray-50 border-gray-100' : gpPct >= 40 ? 'bg-emerald-50 border-emerald-100' : gpPct >= 20 ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100';
                      const barColor = gpPct === null ? '' : gpPct >= 40 ? 'bg-emerald-400' : gpPct >= 20 ? 'bg-amber-400' : 'bg-red-400';
                      return (
                        <div className={`rounded-xl border px-4 py-3 ${gpBg} mt-3`}>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                            {op(currentLanguage).tahmini_brut_kar}
                          </p>
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className={`text-xl font-black ${gpColor}`}>
                                {paraYaz(gp)}
                              </p>
                              <p className="text-[10px] text-gray-500 mt-0.5">
                                {op(currentLanguage).maliyet}: {paraYaz(cost)}
                              </p>
                              {maliyetsizKalem > 0 && (
                                <p className="text-[10px] text-amber-600 mt-1">
                                  {currentLanguage === 'tr'
                                    ? `${maliyetsizKalem} kalemin maliyeti bilinmiyor — kâr hesaplanmadı.`
                                    : `Cost unknown for ${maliyetsizKalem} item(s) — profit not calculated.`}
                                </p>
                              )}
                            </div>
                            <div className="flex-1 max-w-[120px]">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] text-gray-400">{oc(currentLanguage).marj}</span>
                                <span className={`text-sm font-black ${gpColor}`}>{gpPct === null ? '—' : `${gpPct}%`}</span>
                              </div>
                              {/* Marj bilinmiyorken çubuk ÇİZİLMEZ — `Math.min(NaN, 100)` zaten `width: NaN%` üretiyordu. */}
                              {gpPct !== null && (
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                  <div className={`${barColor} h-2 rounded-full transition-all duration-700`} style={{ width: `${Math.min(gpPct, 100)}%` }} />
                                </div>
                              )}
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
                title={oc(currentLanguage).lojistik_depo} 
                subtitle={op(currentLanguage).sevkiyatlar_depo_yonetimi_ve_transferler}
                icon={Truck}
              />
              {/* Lojistik Sub-tabs (hidden on desktop — sidebar handles nav) */}
              <div className="lg:hidden overflow-x-auto scrollbar-none -mx-3 px-3">
                <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max mb-2">
                  {[
                    { id: 'sevkiyat', label: op(currentLanguage).sevkiyatlar, icon: Truck },
                    { id: 'kargo_takip', label: op(currentLanguage).kargo_takip, icon: Navigation },
                    { id: 'depo', label: oc(currentLanguage).depo, icon: Building2 },
                    { id: 'wms', label: op(currentLanguage).bin_lokasyon, icon: MapPin },
                    { id: 'transfer', label: op(currentLanguage).depolar_arasi, icon: ArrowRightLeft },
                    { id: 'qr-transfer', label: currentLanguage === 'tr' ? 'QR Transfer' : 'QR Transfer', icon: QrCode },
                    { id: 'arac-takip', label: op(currentLanguage).arac_takip, icon: Truck },
                    { id: 'canli', label: oc(currentLanguage).canli_sevkiyat, icon: Navigation },
                    { id: 'giden_irsaliye', label: op(currentLanguage).giden_irsaliye, icon: FileUp },
                    { id: 'gelen_irsaliye', label: op(currentLanguage).gelen_irsaliye, icon: FileDown },
                  ].map(tab => {
                    const Icon = tab.icon;
                    return (
                      <button key={tab.id} onClick={() => setLojistikTab(tab.id)}
                        className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${lojistikTab === tab.id ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}>
                        <Icon size={13} /><span>{tab.label}</span>
                      </button>
                    );
                  })}
                  <div className="w-px h-5 bg-gray-200 self-center mx-0.5 shrink-0" />
                  <button onClick={() => setActiveTab('ihracat')} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap">
                    <Ship size={13} />
                    <span>{oc(currentLanguage).ithalat_ihracat}</span>
                  </button>
                </div>
              </div>

              {/* ── Kargo Takip ── */}
              {lojistikTab === 'kargo_takip' && (
                <CargoTrackingTab darkMode={darkMode} currentLanguage={currentLanguage} />
              )}
              {/* Lojistik sub-tab: Depo/Transfer/İrsaliye via AccountingModule */}
              {lojistikTab === 'depo' && (
                <AccountingModule key="loj-depo" orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} userRole={userRole} exchangeRates={exchangeRates ?? undefined} initialTab="depo" allowedTabs={['depo']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}
              {lojistikTab === 'transfer' && (
                <AccountingModule key="loj-transfer" orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} userRole={userRole} exchangeRates={exchangeRates ?? undefined} initialTab="transfer" allowedTabs={['transfer']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}
              {lojistikTab === 'giden_irsaliye' && (
                <AccountingModule key="loj-giden" orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} userRole={userRole} exchangeRates={exchangeRates ?? undefined} initialTab="giden_irsaliye" allowedTabs={['giden_irsaliye']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}
              {lojistikTab === 'gelen_irsaliye' && (
                <AccountingModule key="loj-gelen" orders={orders} currentLanguage={currentLanguage} isAuthenticated={!!user} userRole={userRole} exchangeRates={exchangeRates ?? undefined} initialTab="gelen_irsaliye" allowedTabs={['gelen_irsaliye']} createNotification={createNotification} warehouses={warehouses} employees={employees} />
              )}

              {/* ── Phase 554: WMS Bin/Location Management ─────────────────────────── */}
              {lojistikTab === 'wms' && (() => {
                const tr554 = currentLanguage === 'tr';
                // Türkçe-duyarlı arama (bkz. utils/arama.ts): düz toLowerCase
                // 'IŞIK'ı 'işık' yapıp 'ışık' aramasını sessizce boş döndürüyordu.
                const filtered554 = p554Bins.filter(b =>
                  eslesir(p554Search, b.binCode, b.productSku, b.productName, b.warehouseName));
                const warehouseGroups = filtered554.reduce<Record<string,typeof p554Bins>>((acc, b) => {
                  // OPERATÖR ÖNCELİĞİ HATASI DÜZELTİLDİ (2026-08-28):
                  // `a || b || tr554 ? 'Depo' : 'Warehouse'` ifadesi
                  // `(a || b || tr554) ? 'Depo' : 'Warehouse'` diye çözülüyordu,
                  // yani depo adı GRUP BAŞLIĞINDA HİÇ kullanılmıyor, tüm binler
                  // tek bir 'Depo' başlığı altında toplanıyordu.
                  const key = b.warehouseName || b.warehouseId || (oc(tr554).depo);
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(b);
                  return acc;
                }, {});
                const lowStock = p554Bins.filter(b => b.minQty !== undefined && b.quantity < b.minQty).length;

                return (
                  <motion.div key="wms" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} className="space-y-4">
                    <ModuleHeader
                      title={op(tr554).bin_lokasyon_yonetimi}
                      subtitle={op(tr554).depo_ici_raf_ve_lokasyon_bazli_stok_takibi}
                      icon={MapPin}
                      actionButton={hasFullAccess('lojistik') ? (
                        <button onClick={() => setP554AddForm(v => !v)} className="apple-button-primary px-4 py-2 text-sm flex items-center gap-1.5">
                          <Plus className="w-3.5 h-3.5" />{op(tr554).lokasyon_ekle}
                        </button>
                      ) : undefined}
                    />

                    {/* KPI strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: op(tr554).toplam_bin,          val: p554Bins.length,   color: 'text-blue-700',    bg: 'bg-blue-50',    icon: MapPin },
                        { label: op(tr554).depolar,             val: Object.keys(warehouseGroups).length, color: 'text-purple-700', bg: 'bg-purple-50', icon: Building2 },
                        { label: op(tr554).dusuk_stok_bin,  val: lowStock,          color: lowStock>0?'text-red-600':'text-emerald-600', bg: lowStock>0?'bg-red-50':'bg-emerald-50', icon: AlertTriangle },
                        { label: op(tr554).toplam_sku,         val: new Set(p554Bins.map(b => b.productSku).filter(Boolean)).size, color: 'text-amber-700', bg: 'bg-amber-50', icon: Package },
                      ].map(k => (
                        <div key={k.label} className={`apple-card p-4 flex items-center gap-3 ${k.bg}`}>
                          <k.icon className={`w-5 h-5 flex-shrink-0 ${k.color}`} />
                          <div><p className="text-xs text-gray-500">{k.label}</p><p className={`text-2xl font-bold ${k.color}`}>{k.val}</p></div>
                        </div>
                      ))}
                    </div>

                    {/* Add form */}
                    <AnimatePresence>
                      {p554AddForm && (
                        <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="overflow-hidden">
                          <div className="apple-card p-5 border-l-4 border-brand space-y-3">
                            <h4 className="font-bold text-gray-800 text-sm">{op(tr554).yeni_lokasyon}</h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase">{oc(tr554).depo}</label>
                                <select className="apple-input text-sm w-full" value={p554Draft.warehouseId}
                                  onChange={e => {
                                    const wh = warehouses.find(w => w.id === e.target.value);
                                    setP554Draft(d => ({ ...d, warehouseId: e.target.value, warehouseName: wh?.name || '' } as typeof d));
                                  }}>
                                  <option value="">{oc(tr554).depo_secin}</option>
                                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase">{oc(tr554).bin_kodu}</label>
                                <input className="apple-input text-sm w-full" placeholder="A1-03" value={p554Draft.binCode}
                                  onChange={e => setP554Draft(d => ({ ...d, binCode: e.target.value }))} />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase">SKU</label>
                                {/* ENVANTERDEN SEÇİM (2026-08-28 kullanıcı isteği).
                                    Eskiden serbest metindi: yazım hatası sessizce
                                    var olmayan bir SKU'ya bin açıyordu. `inventory`
                                    zaten bu sayfanın prop'uydu, kullanılmıyordu.
                                    Desen: AccountingModule'deki irsaliye ürün
                                    seçicisiyle aynı (datalist + otomatik doldurma) —
                                    serbest yazmaya da izin verir, çünkü Mikro'da
                                    olmayan bir SKU'yu elle girmek meşru olabilir. */}
                                <input className="apple-input text-sm w-full" list="p554SkuListesi"
                                  placeholder={op(tr554).sku_secin_veya_yazin}
                                  value={p554Draft.productSku}
                                  onChange={e => {
                                    const kod = e.target.value;
                                    const urun = inventory.find(i => i.sku === kod);
                                    setP554Draft(d => ({
                                      ...d,
                                      productSku: kod,
                                      // Ürün bulunduysa adı OTOMATİK dolsun; bulunamadıysa
                                      // kullanıcının elle yazdığını EZME.
                                      productName: urun ? urun.name : d.productName,
                                    }));
                                  }} />
                                <datalist id="p554SkuListesi">
                                  {inventory.map(i => (
                                    <option key={i.id} value={i.sku}>{i.name}</option>
                                  ))}
                                </datalist>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase">{oc(tr554).urun_adi}</label>
                                <input className="apple-input text-sm w-full" placeholder={oc(tr554).urun_adi_2} value={p554Draft.productName}
                                  onChange={e => setP554Draft(d => ({ ...d, productName: e.target.value }))} />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase">{oc(tr554).miktar}</label>
                                <input type="number" min="0" className="apple-input text-sm w-full" placeholder="0" value={p554Draft.quantity}
                                  onChange={e => setP554Draft(d => ({ ...d, quantity: e.target.value }))} />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase">{op(tr554).min_stok}</label>
                                <input type="number" min="0" className="apple-input text-sm w-full" placeholder="0" value={p554Draft.minQty}
                                  onChange={e => setP554Draft(d => ({ ...d, minQty: e.target.value }))} />
                              </div>
                            </div>
                            <input className="apple-input text-sm w-full" placeholder={op(tr554).not_opsiyonel} value={p554Draft.notes}
                              onChange={e => setP554Draft(d => ({ ...d, notes: e.target.value }))} />
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => setP554AddForm(false)} className="apple-button-secondary px-4 py-2 text-sm">{oc(tr554).iptal}</button>
                              <button
                                disabled={!p554Draft.warehouseId || !p554Draft.binCode}
                                onClick={async () => {
                                  // Bilinen 0 GEÇERLİ (boş raf adresi önceden tanımlanır); yalnız
                                  // boş alan ve negatif reddedilir — bkz. formKayit.miktarDogrula.
                                  const miktar = miktarDogrula(p554Draft.quantity);
                                  if (!miktar.gecerli) {
                                    toast(miktar.hata === 'miktar_bos'
                                      ? (op(tr554).miktar_girin_bos_birakilan_alan_0_adet_olarak_ka)
                                      : (op(tr554).miktar_negatif_olamaz), 'error');
                                    return;
                                  }
                                  const wh = warehouses.find(w => w.id === p554Draft.warehouseId);
                                  await addDoc(collection(db, 'warehouseBins'), {
                                    warehouseId: p554Draft.warehouseId,
                                    warehouseName: wh?.name || '',
                                    binCode: p554Draft.binCode,
                                    productSku: p554Draft.productSku,
                                    productName: p554Draft.productName,
                                    quantity: miktar.deger,
                                    ...girilenAlanYamasi('minQty', formSayisi(p554Draft.minQty), undefined),
                                    notes: p554Draft.notes || undefined,
                                    lastCounted: bugunAnahtari(),
                                    createdAt: serverTimestamp(),
                                  });
                                  setP554Draft({ warehouseId: '', binCode: '', productSku: '', productName: '', quantity: '', minQty: '', notes: '' });
                                  setP554AddForm(false);
                                  toast(op(tr554).lokasyon_eklendi, 'success');
                                }}
                                className="apple-button-primary px-5 py-2 text-sm disabled:opacity-50"
                              >{oc(tr554).kaydet}</button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Search */}
                    <div className="apple-card p-4">
                      <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input className="apple-input pl-9 w-full text-sm" placeholder={op(tr554).bin_kodu_sku_veya_urun_adi_ara}
                          value={p554Search} onChange={e => setP554Search(e.target.value)} />
                      </div>

                      {p554Bins.length === 0 ? (
                        <div className="text-center py-12 space-y-3">
                          <MapPin className="w-10 h-10 text-gray-200 mx-auto" />
                          <p className="text-gray-400 text-sm">{op(tr554).lokasyon_ekle_ile_depo_ici_bin_takibine_baslayin}</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {Object.entries(warehouseGroups).map(([whName, bins]) => (
                            <div key={whName}>
                              <div className="flex items-center gap-2 mb-2">
                                <Building2 className="w-4 h-4 text-gray-400" />
                                <h4 className="font-bold text-gray-700 text-sm">{whName}</h4>
                                <span className="text-xs text-gray-400">({bins.length} bin)</span>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-gray-100">
                                      {[oc(tr554).bin_kodu, 'SKU', oc(tr554).urun, oc(tr554).miktar, tr554?'Min':'Min', op(tr554).son_sayim, ''].map(h => (
                                        <th key={h} className="py-2 px-3 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50">
                                    {bins.map(b => {
                                      const isLow = b.minQty !== undefined && b.quantity < b.minQty;
                                      return (
                                        <tr key={b.id} className={`hover:bg-gray-50/50 transition-colors ${isLow ? 'bg-red-50/30' : ''}`}>
                                          <td className="px-3 py-2.5">
                                            <span className="font-mono font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded text-xs">{b.binCode}</span>
                                          </td>
                                          <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{b.productSku || '—'}</td>
                                          <td className="px-3 py-2.5 text-gray-700 max-w-[180px] truncate">{b.productName || '—'}</td>
                                          <td className="px-3 py-2.5">
                                            <span className={`font-bold ${isLow ? 'text-red-600' : 'text-gray-800'}`}>{b.quantity}</span>
                                            {isLow && <span className="ml-1 text-[9px] font-bold text-red-500 bg-red-100 px-1 py-0.5 rounded">LOW</span>}
                                          </td>
                                          <td className="px-3 py-2.5 text-gray-400 text-xs">{b.minQty ?? '—'}</td>
                                          <td className="px-3 py-2.5 text-gray-400 text-xs">{b.lastCounted || '—'}</td>
                                          <td className="px-3 py-2.5">
                                            <button onClick={async () => {
                                              const qty = window.prompt(op(tr554).yeni_miktar_girin, String(b.quantity));
                                              if (qty === null) return;      // Vazgeç
                                              // AYNI kapı ekleme formuyla: `Number('')` 0 verip `isNaN(0)` false döndüğü
                                              // için prompt boş onaylanınca sahte `quantity: 0` yazılıyor ve "güncellendi"
                                              // deniyordu; iki yüzey aynı alana çelişen sözleşme uyguluyordu (2026-09-19 delta).
                                              const miktar = miktarDogrula(qty);
                                              if (!miktar.gecerli) {
                                                toast(miktar.hata === 'miktar_bos'
                                                  ? (op(tr554).miktar_girin_bos_birakilan_alan_0_adet_olarak_ka)
                                                  : (op(tr554).miktar_negatif_olamaz), 'error');
                                                return;                      // `lastCounted` da YAZILMAZ: sayım yapılmadı
                                              }
                                              await updateDoc(doc(db, 'warehouseBins', b.id), { quantity: miktar.deger, lastCounted: bugunAnahtari() });
                                              toast(op(tr554).miktar_guncellendi, 'success');
                                            }} className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors">
                                              {op(tr554).duzelt}
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })()}

              {/* ── Phase 576: Tedarik Zinciri Performans KPI ─────────────────────── */}
              {lojistikTab === 'tedarik-kpi' && (() => {
                const tr576 = currentLanguage === 'tr';
                const now576 = new Date();
                const daysBack = p576Period === '7d' ? 7 : p576Period === '30d' ? 30 : 90;
                const from576 = new Date(now576.getTime() - daysBack * 86400000);
                // Dönem filtresi + tüm sipariş KPI'ları tek sözleşmeden: src/utils/siparisler/lojistikKpi.ts
                // (payda 0 → oran BİLİNMİYOR; tarihi okunamayan sipariş döneme girmez ama SAYILIR;
                //  zamanında teslim artık gerçek `deliveredAt` ile ölçülür, tahmin yoksa ölçülemez sayılır).
                const perf576 = teslimPerformansi(orders, { baslangic: from576, bitis: now576 });
                const periodOrders = perf576.donem;
                // Düşük stok oranı: katalog boşsa oran BİLİNMİYOR (eski `: 0` "%0" + YEŞİL rozet basıyordu).
                const lowStockItems = inventory.filter(item => item.stockLevel <= item.lowStockThreshold);
                const lowStockRatio = oranYuzde(lowStockItems.length, inventory.length);
                // `value: null` = ölçülemedi → '—' basılır, iyi/kötü ROZETİ ÇİZİLMEZ (good: null = nötr gri).
                const kpis576: Array<{ label: string; value: number | null; unit: string; good: boolean | null; icon: string }> = [
                  { label: op(tr576).siparis_doluluk_orani, value: perf576.dolulukOrani, unit: '%', good: perf576.dolulukOrani === null ? null : perf576.dolulukOrani >= 90, icon: '📦' },
                  { label: op(tr576).zamaninda_teslimat, value: perf576.zamanindaOrani, unit: '%', good: perf576.zamanindaOrani === null ? null : perf576.zamanindaOrani >= 90, icon: '🚚' },
                  { label: op(tr576).iptal_orani, value: perf576.iptalOrani, unit: '%', good: perf576.iptalOrani === null ? null : perf576.iptalOrani <= 5, icon: '❌' },
                  { label: op(tr576).ort_islem_suresi, value: perf576.ortGecenGun, unit: op(tr576).gun, good: perf576.ortGecenGun === null ? null : perf576.ortGecenGun <= 3, icon: '⏱' },
                  { label: op(tr576).dusuk_stok_orani, value: lowStockRatio, unit: '%', good: lowStockRatio === null ? null : lowStockRatio <= 10, icon: '⚠️' },
                  { label: oc(tr576).aktif_siparis, value: perf576.aktif, unit: '', good: true, icon: '📋' },
                ];
                const cargoMap576: Record<string, number> = {};
                periodOrders.forEach(o => {
                  const c = o.cargoCompany || (oc(tr576).bilinmiyor);
                  cargoMap576[c] = (cargoMap576[c]||0) + 1;
                });
                const cargos576 = Object.entries(cargoMap576).sort((a,b)=>b[1]-a[1]).slice(0,5);
                return (
                  <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <ModuleHeader title={oc(tr576).tedarik_zinciri_kpi} subtitle={op(tr576).siparis_teslimat_ve_stok_performans_gostergeleri} icon={TrendingUp} />
                      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                        {(['7d','30d','90d'] as const).map(p=>(
                          <button key={p} onClick={()=>setP576Period(p)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${p576Period===p?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
                            {p==='7d'?op(tr576)._7_gun:p==='30d'?op(tr576)._30_gun:op(tr576)._90_gun}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {kpis576.map(k=>(
                        <div key={k.label} className={`apple-card p-4 ${k.good===false?'border border-red-100':''}`}>
                          <p className="text-lg mb-1">{k.icon}</p>
                          <p className="text-xs text-gray-500 font-semibold">{k.label}</p>
                          <p className={`text-2xl font-bold mt-1 ${k.good===null?'text-gray-400':k.good?'text-emerald-600':'text-red-500'}`}>{k.value===null?'—':`${k.value.toFixed(k.unit===''?0:1)}${k.unit}`}</p>
                        </div>
                      ))}
                    </div>
                    {(perf576.tarihsiz > 0 || perf576.zamanindaOlculemeyen > 0) && (
                      <p className="text-[11px] text-gray-400">
                        {tr576
                          ? `${perf576.tarihsiz} siparişin tarihi okunamadı (döneme girmedi) · ${perf576.zamanindaOlculemeyen} teslimat ölçülemedi (tahmini ya da gerçek teslim tarihi eksik).`
                          : `${perf576.tarihsiz} orders have an unreadable date (excluded) · ${perf576.zamanindaOlculemeyen} deliveries not measurable (missing estimated or actual delivery date).`}
                      </p>
                    )}
                    {cargos576.length > 0 && (
                      <div className="apple-card p-5">
                        <h4 className="font-bold text-sm text-gray-800 mb-3">{op(tr576).kargo_firmasi_dagilimi}</h4>
                        <div className="space-y-2">
                          {cargos576.map(([name,cnt])=>{
                            const pct = periodOrders.length>0?(cnt/periodOrders.length)*100:0;
                            return (
                              <div key={name} className="flex items-center gap-3">
                                <span className="text-xs text-gray-600 w-28 truncate font-medium">{name}</span>
                                <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                                  <div className="h-full bg-brand rounded-full" style={{width:`${pct}%`}} />
                                </div>
                                <span className="text-xs font-bold text-gray-700 w-10 text-right">{cnt}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })()}

              {/* ── Phase 593: Araç Filosu Takibi ──────────────────────────────── */}
              {lojistikTab === 'qr-transfer' && (
                <div className="space-y-4">
                  <TransferScanPanel
                    currentLanguage={currentLanguage}
                    inventory={inventory}
                    warehouses={warehouses}
                    vehicles={vehicles}
                    locationStocks={locationStocks}
                    hasFullAccess={hasFullAccess}
                    toast={toast}
                  />
                  <LocationStockReport currentLanguage={currentLanguage} locationStocks={locationStocks} />
                </div>
              )}

              {lojistikTab === 'canli' && (
                <React.Suspense fallback={<div className="apple-card p-8 text-center text-sm text-gray-400">…</div>}>
                  <CanliSevkiyatPanel
                    currentLanguage={currentLanguage}
                    shipments={shipments}
                    vehicles={vehicles}
                    warehouses={warehouses}
                    aracKonumlari={aracKonumlari}
                    konumYazabilir={konumYazabilir}
                    kullaniciUid={kullaniciUid}
                  />
                </React.Suspense>
              )}

              {lojistikTab === 'arac-takip' && (() => {
                const tr593 = currentLanguage === 'tr';
                const statusColors593: Record<string,string> = {'Müsait':'bg-green-100 text-green-700','Yolda':'bg-blue-100 text-blue-700','Bakımda':'bg-amber-100 text-amber-700','Arızalı':'bg-red-100 text-red-700'};
                const today593 = bugunAnahtari();
                const haftaya593 = bugunAnahtari(new Date(Date.now()+7*86400000));
                const maintenanceDue = p593Vehicles.filter(v=>v.nextService&&v.nextService<=haftaya593);
                const stats = {müsait:p593Vehicles.filter(v=>v.status==='Müsait').length, yolda:p593Vehicles.filter(v=>v.status==='Yolda').length, bakimda:p593Vehicles.filter(v=>v.status==='Bakımda'||v.status==='Arızalı').length};
                return (
                  <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                    <ModuleHeader title={op(tr593).arac_filosu_takibi} subtitle={op(tr593).araclarin_durum_surucu_ve_bakim_bilgilerini_taki} icon={Truck}
                      actionButton={hasFullAccess('lojistik')&&(<button onClick={()=>setP593ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{op(tr593).arac_ekle}</button>)} />
                    <div className="grid grid-cols-3 gap-4">
                      {[{label:op(tr593).musait,val:stats.müsait,color:'text-green-700',bg:'bg-green-50'},{label:op(tr593).yolda,val:stats.yolda,color:'text-blue-700',bg:'bg-blue-50'},{label:op(tr593).bakim_ariza,val:stats.bakimda,color:'text-amber-700',bg:'bg-amber-50'}].map(k=>(
                        <div key={k.label} className={`apple-card p-4 ${k.bg}`}><p className="text-xs text-gray-500">{k.label}</p><p className={`text-2xl font-bold ${k.color}`}>{k.val}</p></div>
                      ))}
                    </div>
                    {maintenanceDue.length>0&&(<div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3"><p className="text-sm font-bold text-amber-800">🔧 {maintenanceDue.length} {op(tr593).arac_bu_hafta_bakima_giriyor} {maintenanceDue.map(v=>v.plate).join(', ')}</p></div>)}
                    {p593ShowForm && (
                      <div className="apple-card p-5 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <input className="apple-input px-3 py-2 text-sm" placeholder={op(tr593).plaka} value={p593Draft.plate} onChange={e=>setP593Draft(d=>({...d,plate:e.target.value.toUpperCase()}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={oc(tr593).surucu} value={p593Draft.driver} onChange={e=>setP593Draft(d=>({...d,driver:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" type="tel" placeholder={op(tr593).surucu_telefonu} value={p593Draft.driverPhone} onChange={e=>setP593Draft(d=>({...d,driverPhone:e.target.value}))} />
                          <input className="apple-input px-3 py-2 text-sm" placeholder={op(tr593).marka_model} value={p593Draft.model} onChange={e=>setP593Draft(d=>({...d,model:e.target.value}))} />
                          <select className="apple-input px-3 py-2 text-sm" value={p593Draft.fuel} onChange={e=>setP593Draft(d=>({...d,fuel:e.target.value as typeof d.fuel}))}>
                            {(['Benzin','Dizel','LPG','Elektrik'] as const).map(f=><option key={f}>{f}</option>)}
                          </select>
                          <input type="number" className="apple-input px-3 py-2 text-sm" placeholder="KM" value={p593Draft.km} onChange={e=>setP593Draft(d=>({...d,km:e.target.value}))} />
                          <input type="date" className="apple-input px-3 py-2 text-sm" placeholder={op(tr593).son_bakim} value={p593Draft.lastService} onChange={e=>setP593Draft(d=>({...d,lastService:e.target.value}))} />
                          <input type="date" className="apple-input px-3 py-2 text-sm" placeholder={oc(tr593).sonraki_bakim} value={p593Draft.nextService} onChange={e=>setP593Draft(d=>({...d,nextService:e.target.value}))} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={async ()=>{
                            // Plaka boşken eskiden SESSİZCE return ediliyordu: düğme hiçbir
                            // şey yapmıyor, mesaj da çıkmıyordu → "araç ekle çalışmıyor".
                            if(!p593Draft.plate.trim()){ toast(op(tr593).plaka_zorunlu,'error'); return; }
                            try {
                              // `km` kayıt kapısı DEĞİL, opsiyonel GİRİLEN alandır: 0 km meşrudur
                              // (sıfır kilometre araç) ama BOŞ alan 0 km değil BİLİNMİYOR demektir —
                              // bakım planlaması (`maintenanceDue`) o sahte sıfıra bakıyordu.
                              // `driverPhone` formda toplanıyor ve CanliSevkiyatPanel'deki "Ara"
                              // düğmesi onu okuyor, ama payload'a hiç konmamıştı (sessiz veri kaybı).
                              await addDoc(collection(db,'vehicles'),{plate:p593Draft.plate.trim(),driver:p593Draft.driver||'',driverPhone:p593Draft.driverPhone||'',model:p593Draft.model||'',status:p593Draft.status,lastService:p593Draft.lastService||'',nextService:p593Draft.nextService||'',...girilenAlanYamasi('km', formSayisi(p593Draft.km), undefined),fuel:p593Draft.fuel,createdAt:serverTimestamp()});
                              setP593Draft({plate:'',driver:'',driverPhone:'',model:'',status:'Müsait',lastService:'',nextService:'',km:'',fuel:'Dizel'});
                              setP593ShowForm(false);
                            } catch(e){
                              // Sunucunun gerçek mesajını göster (örn. yetki reddi) — genel
                              // metin, RBAC 403'ünü "bilinmeyen hata" gibi gösteriyordu.
                              console.error('[vehicle add]',e);
                              const msg = e instanceof Error && e.message ? e.message : (op(tr593).arac_kaydedilemedi);
                              toast(msg,'error');
                            }
                          }} className="apple-button-primary text-sm px-4 py-1.5">{oc(tr593).kaydet}</button>
                          <button onClick={()=>setP593ShowForm(false)} className="apple-button-secondary text-sm px-4 py-1.5">{oc(tr593).iptal}</button>
                        </div>
                      </div>
                    )}
                    {p593Vehicles.length===0?(
                      <div className="apple-card p-12 text-center"><Truck className="w-12 h-12 text-gray-200 mx-auto mb-3"/><p className="text-gray-400 text-sm">{op(tr593).arac_ekle_ile_filo_takibini_baslatin}</p></div>
                    ):(
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {p593Vehicles.map(v=>{
                          const isDue = v.nextService&&v.nextService<=today593;
                          return (
                            <div key={v.id} className={`apple-card p-4 ${isDue?'border border-amber-200':''}`}>
                              <div className="flex items-start justify-between mb-3">
                                <div>
                                  <p className="font-bold text-gray-900 text-sm font-mono">{v.plate}</p>
                                  <p className="text-xs text-gray-500">{v.model} {v.fuel?`• ${v.fuel}`:''}</p>
                                </div>
                                <select value={v.status} onChange={async e=>{ try{ await updateDoc(doc(db,'vehicles',v.id),{status:e.target.value}); }catch(err){ console.error('[vehicle status]',err); } }} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 cursor-pointer ${statusColors593[v.status]}`}>
                                  {(['Müsait','Yolda','Bakımda','Arızalı'] as const).map(s=><option key={s}>{s}</option>)}
                                </select>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div><p className="text-gray-400">{oc(tr593).surucu}</p><p className="font-medium text-gray-700">{v.driver||'—'}</p></div>
                                <div><p className="text-gray-400">KM</p><p className="font-medium text-gray-700">{v.km?.toLocaleString()||'—'}</p></div>
                                {v.nextService&&<div className="col-span-2"><p className="text-gray-400">{oc(tr593).sonraki_bakim}</p><p className={`font-medium ${isDue?'text-amber-600 font-bold':'text-gray-700'}`}>{v.nextService} {isDue?'⚠️':''}</p></div>}
                              </div>
                              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                                <button onClick={()=>setLocationQrModal({type:'vehicle',id:v.id,name:v.plate,subtitle:v.driver||v.model})} className="flex-1 text-[11px] font-bold px-2 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition-colors flex items-center justify-center gap-1.5">
                                  <QrCode className="w-3.5 h-3.5" />{oc(tr593).qr_etiketi}
                                </button>
                                {hasFullAccess('lojistik')&&(
                                  <button onClick={async()=>{ if(!await confirmDelete(v.plate,currentLanguage))return; try{ await deleteDoc(doc(db,'vehicles',v.id)); }catch(err){ console.error('[vehicle delete]',err); } }} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Depo QR etiketleri — transfer taramasında kaynak/hedef olarak okunur */}
                    <div className="apple-card p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Building2 className="w-4 h-4 text-brand" />
                        <h4 className="font-bold text-gray-900 text-sm">{op(tr593).depo_qr_etiketleri}</h4>
                      </div>
                      {warehouses.length===0?(
                        <p className="text-xs text-gray-400">{op(tr593).henuz_depo_tanimli_degil_muhasebe_depo_bolumunde}</p>
                      ):(
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {warehouses.map(w=>(
                            <div key={w.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-gray-50">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-800 truncate">{w.name}</p>
                                {w.location&&<p className="text-[10px] text-gray-400 truncate">{w.location}</p>}
                              </div>
                              <button onClick={()=>setLocationQrModal({type:'warehouse',id:w.id,name:w.name,subtitle:w.location})} className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition-colors flex items-center gap-1 shrink-0">
                                <QrCode className="w-3 h-3" />QR
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })()}

              {/* ── Phase 622: İhracat & Gümrük Takibi ───────────────────────── */}
              {lojistikTab === 'ihracat-gumruk' && (() => {
                const tr622 = currentLanguage === 'tr';
                const statusColor:{[k:string]:string} = {'Hazırlanıyor':'bg-gray-100 text-gray-600','Gümrükte':'bg-amber-100 text-amber-700','Yolda':'bg-blue-100 text-blue-700','Teslim Edildi':'bg-emerald-100 text-emerald-700'};
                // USD/EUR/TRY tek toplamda BİRLEŞMEZ (kur yok → çeviri yok): para birimi başına ayrı Tutar.
                const ihracat622 = ihracatToplami(p622Shipments);
                const inTransit = p622Shipments.filter(sh=>sh.status==='Yolda'||sh.status==='Gümrükte').length;
                return (
                  <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                    <ModuleHeader title={op(tr622).ihracat_gumruk_takibi} subtitle={op(tr622).ihracat_sevkiyatlari_ve_gumruk_surecleri} icon={Globe}
                      actionButton={hasFullAccess('lojistik')&&(<button onClick={()=>setP622ShowForm(v=>!v)} className="apple-button-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4"/>{op(tr622).sevkiyat_ekle}</button>)} />
                    <div className="grid grid-cols-3 gap-4">
                      <div className="apple-card p-4 bg-blue-50"><p className="text-xs text-gray-500">{op(tr622).toplam_sevkiyat}</p><p className="text-2xl font-black text-blue-600">{p622Shipments.length}</p></div>
                      <div className="apple-card p-4 bg-amber-50"><p className="text-xs text-gray-500">{op(tr622).yolda_gumruk}</p><p className="text-2xl font-black text-amber-600">{inTransit}</p></div>
                      <div className="apple-card p-4 bg-emerald-50"><p className="text-xs text-gray-500">{oc(tr622).toplam_deger}</p><p className="text-lg font-black text-emerald-600 break-words">{ihracatToplamiYaz(ihracat622)}</p>{ihracat622.bilinmeyenTutar > 0 && (<p className="text-[10px] text-gray-400 mt-0.5">{tr622 ? `${ihracat622.bilinmeyenTutar} sevkiyatın tutarı bilinmiyor` : `${ihracat622.bilinmeyenTutar} shipments have no value`}</p>)}</div>
                    </div>
                    {p622ShowForm && (
                      <div className="apple-card p-5 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <input className="apple-input" placeholder={op(tr622).siparis_ref} value={p622Draft.orderRef} onChange={e=>setP622Draft(d=>({...d,orderRef:e.target.value}))}/>
                          <input className="apple-input" placeholder={oc(tr622).destinasyon} value={p622Draft.destination} onChange={e=>setP622Draft(d=>({...d,destination:e.target.value}))}/>
                          <select value={p622Draft.incoterm} onChange={e=>setP622Draft(d=>({...d,incoterm:e.target.value as typeof d.incoterm}))} className="apple-input">
                            {['EXW','FOB','CIF','DDP'].map(i=><option key={i}>{i}</option>)}
                          </select>
                          <select value={p622Draft.currency} onChange={e=>setP622Draft(d=>({...d,currency:e.target.value as typeof d.currency}))} className="apple-input">
                            {['USD','EUR','TRY'].map(c=><option key={c}>{c}</option>)}
                          </select>
                          <input type="number" className="apple-input" placeholder={oc(tr622).deger} value={p622Draft.value} onChange={e=>setP622Draft(d=>({...d,value:e.target.value}))}/>
                          <select value={p622Draft.status} onChange={e=>setP622Draft(d=>({...d,status:e.target.value as typeof d.status}))} className="apple-input">
                            {['Hazırlanıyor','Gümrükte','Yolda','Teslim Edildi'].map(s=><option key={s}>{s}</option>)}
                          </select>
                          <input type="date" className="apple-input" value={p622Draft.exportDate} onChange={e=>setP622Draft(d=>({...d,exportDate:e.target.value}))}/>
                          <input className="apple-input" placeholder={op(tr622).gumruk_ref} value={p622Draft.customsRef} onChange={e=>setP622Draft(d=>({...d,customsRef:e.target.value}))}/>
                        </div>
                        <button onClick={async ()=>{
                          if(!p622Draft.orderRef||!p622Draft.destination) return;
                          // Kapı DÜZENLEMEDE farklı davranır: boş bırakmak "tutarı bilmiyorum"dur ve
                          // kayıt durmaz (eski `value: 0` sevkiyatı aksi hâlde kilitleniyordu — satırda
                          // durum seçici yok, ilerletmenin tek yolu bu form). bkz. sevkiyatDegeriKaydi.
                          const oncekiSevkiyat = p622EditId ? p622Shipments.find(s=>s.id===p622EditId) : undefined;
                          const deger = sevkiyatDegeriKaydi(p622Draft.value, oncekiSevkiyat?.value, !!p622EditId);
                          if(!deger.gecerli){ toast(deger.hata === 'deger_bos'
                            ? (op(tr622).sevkiyat_degeri_girin_bos_alan_0_olarak_kaydedil)
                            : (op(tr622).sevkiyat_degeri_0_dan_buyuk_olmali), 'error'); return; }
                          const payload={orderRef:p622Draft.orderRef,destination:p622Draft.destination,incoterm:p622Draft.incoterm,currency:p622Draft.currency,...deger.yama,status:p622Draft.status,exportDate:p622Draft.exportDate,customsRef:p622Draft.customsRef||''};
                          try {
                            if(p622EditId){ await updateDoc(doc(db,'exportShipments',p622EditId),payload); }
                            else { await addDoc(collection(db,'exportShipments'),{...payload,createdAt:serverTimestamp()}); }
                            setP622Draft(d=>({...d,orderRef:'',destination:'',value:'',customsRef:''}));
                            setP622ShowForm(false); setP622EditId(null);
                            toast(tr622?(p622EditId?'Sevkiyat güncellendi.':'Sevkiyat eklendi.'):(p622EditId?'Shipment updated.':'Shipment added.'),'success');
                          } catch(e){ toast((oc(tr622).kaydedilemedi)+(e instanceof Error?e.message:String(e)),'error'); }
                        }} className="apple-button-primary text-xs px-6">{oc(tr622).kaydet}</button>
                      </div>
                    )}
                    {p622Shipments.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-gray-100 bg-gray-50">
                            {[tr622?'Ref':'Ref',oc(tr622).destinasyon,'Incoterm',oc(tr622).deger,oc(tr622).durum,oc(tr622).tarih].map(h=>(
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                            ))}
                            <th className="px-3 py-2 w-8"></th>
                          </tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {[...p622Shipments].sort((a,b)=>b.exportDate.localeCompare(a.exportDate)).map(sh=>(
                              <tr key={sh.id} className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5 font-mono text-gray-700">{sh.orderRef}</td>
                                <td className="px-3 py-2.5 font-medium text-gray-800">{sh.destination}</td>
                                <td className="px-3 py-2.5 text-gray-500">{sh.incoterm}</td>
                                {/* Hücre ile düzenleme ön-dolumu AYNI tanımı kullanır (`gorunenDeger`):
                                    eski sahte 0 kaydı '—' basar, kutu BOŞ açılır. */}
                                <td className="px-3 py-2.5 font-bold text-gray-700">{paraYaz(gorunenDeger(sh.value), { birim: sh.currency })}</td>
                                <td className="px-3 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColor[sh.status]}`}>{sh.status}</span></td>
                                <td className="px-3 py-2.5 text-gray-500">{tarihYaz(sh.exportDate)}</td>
                                <td className="px-3 py-2.5 text-right"><div className="flex items-center justify-end gap-2">
                                  <button type="button" onClick={()=>{const gd=gorunenDeger(sh.value);setP622Draft({orderRef:sh.orderRef,destination:sh.destination,incoterm:sh.incoterm,currency:sh.currency,value:gd===null?'':String(gd),status:sh.status,exportDate:sh.exportDate,customsRef:sh.customsRef||''});setP622EditId(sh.id);setP622ShowForm(true);}} title={oc(tr622).duzenle} className="text-gray-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                                  <button type="button" onClick={async ()=>{try{await deleteDoc(doc(db,'exportShipments',sh.id));}catch(e){toast((oc(tr622).silinemedi)+(e instanceof Error?e.message:String(e)),'error');}}} title="Sil" className="text-gray-300 hover:text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                                </div></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {p622Shipments.length===0&&<div className="text-center py-10"><Globe className="w-10 h-10 text-gray-200 mx-auto mb-3"/><p className="text-gray-400 text-sm">{op(tr622).ihracat_sevkiyati_ekleyin}</p></div>}
                  </motion.div>
                );
              })()}

              {/* Lojistik sub-tab: Sevkiyatlar (existing logistics content) */}
              {lojistikTab === 'sevkiyat' && <>
              {/* ── Phase 60: Today's Shipment Summary ── */}
              {(() => {
                const bugun60 = bugunAnahtari();
                const shipped   = orders.filter(o => o.status === 'Shipped');
                const delivered = orders.filter(o => o.status === 'Delivered');
                const todayShipped = orders.filter(o =>
                  o.status === 'Shipped' && gunAnahtari(o.createdAt ?? o.syncedAt) === bugun60);
                const pending = orders.filter(o => o.status === 'Processing');
                const stats = [
                  { label: oc(currentLanguage).kargoda,      value: shipped.length,     color: 'text-blue-700',    bg: 'bg-blue-50',    icon: Truck        },
                  { label: op(currentLanguage).bugun_gonderildi, value: todayShipped.length, color: 'text-purple-700', bg: 'bg-purple-50', icon: Package     },
                  { label: op(currentLanguage).hazirlaniyor,   value: pending.length,     color: 'text-amber-700',   bg: 'bg-amber-50',   icon: Clock        },
                  { label: oc(currentLanguage).teslim_edildi,  value: delivered.length,   color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
                ];
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-4 flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                      <Truck className="w-3.5 h-3.5" />
                      {op(currentLanguage).sevkiyat_ozeti}
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

              {/* ── Phase 108: Delivery SLA Strip ── */}
              {(() => {
                const SLA_DAYS = 7; // on-time = delivered within 7 days of creation
                const deliveredOrders = orders.filter(o => o.status === 'Delivered');
                if (deliveredOrders.length === 0) return null;

                let onTimeCount = 0, totalDays = 0;
                for (const o of deliveredOrders) {
                  const created = zamanMs(o.createdAt ?? o.syncedAt);
                  const synced  = zamanMs(o.syncedAt ?? o.createdAt);
                  const days = created !== null && synced !== null ? Math.abs(synced - created) / 86400000 : SLA_DAYS;
                  if (days <= SLA_DAYS) onTimeCount++;
                  totalDays += Math.max(0, days);
                }
                const slaRate   = Math.round((onTimeCount / deliveredOrders.length) * 100);
                const avgDays   = totalDays / deliveredOrders.length;
                const lateCount = deliveredOrders.length - onTimeCount;
                const slaColor  = slaRate >= 80 ? 'text-emerald-600' : slaRate >= 50 ? 'text-amber-600' : 'text-red-500';
                const barColor  = slaRate >= 80 ? 'bg-emerald-400' : slaRate >= 50 ? 'bg-amber-400' : 'bg-red-400';

                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className={cn("text-[10px] font-bold uppercase tracking-wider flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {op(currentLanguage).teslimat_sla_performansi}
                      </h3>
                      <span className="text-[10px] text-gray-400">
                        {currentLanguage === 'tr' ? `≤${SLA_DAYS} gün = zamanında` : `≤${SLA_DAYS} days = on-time`}
                      </span>
                    </div>
                    {/* SLA bar */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div
                          className={`h-3 rounded-full transition-all duration-700 ${barColor}`}
                          style={{ width: `${slaRate}%` }}
                        />
                      </div>
                      <span className={`text-lg font-black flex-shrink-0 ${slaColor}`}>{slaRate}%</span>
                    </div>
                    {/* Metric grid */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: op(currentLanguage).zamaninda,      value: onTimeCount,             color: 'text-emerald-600', bg: 'bg-emerald-50' },
                        { label: oc(currentLanguage).gecikmeli,         value: lateCount,               color: 'text-red-500',     bg: 'bg-red-50'     },
                        { label: op(currentLanguage).ort_gun,     value: avgDays.toFixed(1),      color: 'text-blue-600',    bg: 'bg-blue-50'    },
                      ].map((m, i) => (
                        <div key={i} className={cn("rounded-xl p-3 text-center", darkMode ? "bg-white/5" : m.bg)}>
                          <p className={`text-xl font-black ${m.color}`}>{m.value}</p>
                          <p className={cn("text-[10px] font-bold mt-0.5", darkMode ? "text-white/65" : "text-gray-400")}>{m.label}</p>
                        </div>
                      ))}
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
                  // `: 0` dalı burada ULAŞILAMAZ: bir anahtar ancak `cargoMap[k].total += 1`
                  // ile oluşuyor, yani her kovada total >= 1. Sahte "%0 + yeşil rozet" sınıfının
                  // (bkz. yukarıdaki Teslimat Oranı kartı) bu kopyası zararsız — dal, yapı
                  // değişirse yanlış olmasın diye gerekçesiyle bırakıldı (2026-09-19 kapanış).
                  .map(([name, d]) => ({ name, ...d, rate: d.total > 0 ? Math.round((d.delivered / d.total) * 100) : 0 }))
                  .sort((a, b) => b.total - a.total)
                  .slice(0, 5);
                if (cargoList.length === 0) return null;
                return (
                  <div className={cn("rounded-2xl border p-5", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                    <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-4 flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                      <Truck className="w-3.5 h-3.5" />
                      {op(currentLanguage).kargo_firmasi_performansi}
                    </h3>
                    <div className="space-y-3">
                      {cargoList.map(c => (
                        <div key={c.name} className="space-y-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-semibold text-gray-700 truncate flex-1">{c.name}</span>
                            <div className="flex items-center gap-3 flex-shrink-0 text-[10px]">
                              <span className="text-blue-500 font-bold">{c.inTransit} {op(currentLanguage).yolda_2}</span>
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
                      {op(currentLanguage).teslimat_basari_orani_tamamlanan_toplam}
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
                        <th className="text-right">İşlemler</th>
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
                          <td className="text-right">
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => handleEditShipment(shipment)} className="action-btn-edit"><Edit2 className="w-4 h-4" /></button>
                              <button onClick={() => handleDeleteShipment(shipment.id)} className="action-btn-delete"><Trash2 className="w-4 h-4" /></button>
                            </div>
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
                    <p className="text-sm font-medium">{op(currentLanguage).tum_aktif_siparisler_icin_en_verimli_teslimat_si}</p>
                  </div>
                )}
              </div>

              {/* Map + Shipments */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 order-2 lg:order-1">
                  <React.Suspense fallback={<div className="h-[400px] md:h-[600px] w-full rounded-xl bg-gray-100 flex items-center justify-center"><div className="w-8 h-8 rounded-full border-2 border-[#ff4000] border-t-transparent animate-spin" /></div>}>
                    <LogisticsMap orders={orders} routeStops={routeStops} depot={DEPOTS[selectedDepot]} currentT={currentT} />
                  </React.Suspense>
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
                            <p className="text-[10px] text-gray-500">ID: {gorunenSiparisNo(order)}</p>
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

      {/* ── İADE MODAL ── */}
      <AnimatePresence>
        {returnModal.open && returnModal.order && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setReturnModal({ open: false, order: null })} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{oc(currentLanguage).iade_olustur} — #{returnModal.order.id.slice(0, 6)}</h3>
                <button onClick={() => setReturnModal({ open: false, order: null })} className="p-2.5 -m-1 rounded-lg hover:bg-gray-100"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 flex-1 overflow-y-auto">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{op(currentLanguage).iade_tutari}</label>
                  <input type="number" className="apple-input w-full text-sm" value={returnAmount === null ? '' : returnAmount} onChange={e => setReturnAmount(formSayisi(e.target.value))} />
                  {iadeOnTutar(returnModal.order) === null ? (
                    <p className="text-[11px] text-amber-600 mt-1">{op(currentLanguage).siparis_tutari_bilinmiyor_ust_sinir_dogrulanamiy}</p>
                  ) : (
                    <p className="text-[11px] text-gray-400 mt-1">{(op(currentLanguage).en_cok) + paraYaz(iadeOnTutar(returnModal.order))}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{op(currentLanguage).iade_edilen_urunler}</label>
                  <input type="text" className="apple-input w-full text-sm" placeholder={op(currentLanguage).urun_adlari_adet} value={returnItems} onChange={e => setReturnItems(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{op(currentLanguage).iade_sebebi}</label>
                  <textarea className="apple-input w-full text-sm resize-none" rows={3} value={returnReason} onChange={e => setReturnReason(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setReturnModal({ open: false, order: null })} className="apple-button-secondary text-sm">{oc(currentLanguage).iptal}</button>
                <button
                  disabled={!returnReason.trim()}
                  onClick={async () => {
                    const o = returnModal.order!;
                    // İade tutarı 0 < x ≤ sipariş toplamı olmalı (negatif/aşırı engeli).
                    // Sipariş toplamı BİLİNMİYORSA üst sınır uygulanmaz: eski `Number(o.totalPrice) || 0`
                    // bilinmeyeni ₺0 sınıra çevirip HER iadeyi "0 ile 0 arasında olmalı" ile reddediyordu.
                    const iade = iadeTutariDogrula(returnAmount, iadeOnTutar(o));
                    if (!iade.gecerli || iade.tutar === null) {
                      toast(
                        iade.hata === 'bos'
                          ? (op(currentLanguage).iade_tutarini_girin)
                          : iade.hata === 'pozitifDegil'
                            ? (op(currentLanguage).iade_tutari_sifirdan_buyuk_olmali)
                            : (currentLanguage === 'tr' ? `İade tutarı sipariş toplamını (${paraYaz(iade.ustSinir)}) aşamaz.` : `Return amount cannot exceed the order total (${paraYaz(iade.ustSinir)}).`),
                        'error',
                      );
                      return;
                    }
                    try {
                      // KOLEKSIYON DUZELTILDI (2026-09-04): burasi `orderReturns`e
                      // yaziyordu ama ayni sayfadaki Iade Yonetimi sekmesi (satir 279)
                      // `salesReturns` dinliyor — kullanici "Iade kaydi olusturuldu"
                      // toast'ini goruyor, sekmeye gidince kayit YOK. `orderReturns`
                      // koleksiyonunu okuyan tek bir yer bile yoktu.
                      // Durum degeri de p575 sozlugune uyduruldu ('Pending' -> 'Bekliyor').
                      await addDoc(collection(db, 'salesReturns'), {
                        orderId: o.id, customerName: o.customerName ?? '', amount: iade.tutar,
                        items: returnItems, reason: returnReason, status: 'Bekliyor',
                        companyId: (o as unknown as { companyId?: string }).companyId ?? null,
                        createdAt: serverTimestamp(),
                      });
                      createNotification(op(currentLanguage).iade_olusturuldu, `#${o.id.slice(0, 6)} — ${paraYaz(iade.tutar)}`, 'info');
                      toast(op(currentLanguage).iade_kaydi_olusturuldu, 'success');
                      setReturnModal({ open: false, order: null });
                    } catch { toast(op(currentLanguage).hata_olustu, 'error'); }
                  }}
                  className="apple-button-primary text-sm disabled:opacity-50"
                >{oc(currentLanguage).iade_olustur}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── SEVKİYAT EKLE/DÜZENLE MODAL ── */}
      <AnimatePresence>
        {isAddingShipment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setIsAddingShipment(false); setEditingShipmentId(null); }} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{editingShipmentId ? (op(currentLanguage).sevkiyat_duzenle) : (op(currentLanguage).yeni_sevkiyat)}</h3>
                <button onClick={() => { setIsAddingShipment(false); setEditingShipmentId(null); }} className="p-2.5 -m-1 rounded-lg hover:bg-gray-100"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{oc(currentLanguage).musteri}</label>
                  <CustomerCombobox
                    leads={leads}
                    value={newShipment.customerName ?? ''}
                    onChange={text => setNewShipment(s => ({ ...s, customerName: text }))}
                    onSelect={lead => setNewShipment(s => ({ ...s, customerName: lead.name }))}
                    placeholder={op(currentLanguage).musteri_adi_yazin_veya_secin}
                    maxResults={20}
                    blurDelayMs={150}
                    showIcon={false}
                    inputClassName="apple-input w-full text-sm"
                    dropdownMaxHeightClass="max-h-56"
                  />
                </div>
                {[
                  { k: 'destination', label: oc(currentLanguage).varis_noktasi },
                  { k: 'driver', label: oc(currentLanguage).surucu },
                  { k: 'cargoFirm', label: op(currentLanguage).kargo_firmasi },
                  { k: 'trackingNo', label: oc(currentLanguage).takip_no },
                ].map(f => (
                  <div key={f.k}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                    <input type="text" className="apple-input w-full text-sm" value={(newShipment[f.k as keyof Shipment] as string) ?? ''} onChange={e => setNewShipment(s => ({ ...s, [f.k]: e.target.value }))} />
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{oc(currentLanguage).tarih}</label>
                    <input type="date" className="apple-input w-full text-sm" value={newShipment.date ?? ''} onChange={e => setNewShipment(s => ({ ...s, date: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{oc(currentLanguage).durum}</label>
                    <select className="apple-input w-full text-sm" value={newShipment.status ?? 'Pending'} onChange={e => setNewShipment(s => ({ ...s, status: e.target.value as Shipment['status'] }))}>
                      {(['Pending', 'In Transit', 'Delivered', 'Cancelled'] as const).map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => { setIsAddingShipment(false); setEditingShipmentId(null); }} className="apple-button-secondary text-sm">{oc(currentLanguage).iptal}</button>
                <button
                  disabled={!newShipment.customerName}
                  onClick={async () => {
                    try {
                      if (editingShipmentId) {
                        await updateDoc(doc(db, 'shipments', editingShipmentId), { ...newShipment, updatedAt: serverTimestamp() });
                        toast(op(currentLanguage).sevkiyat_guncellendi, 'success');
                      } else {
                        await addDoc(collection(db, 'shipments'), { status: 'Pending', ...newShipment, createdAt: serverTimestamp() });
                        toast(op(currentLanguage).sevkiyat_eklendi, 'success');
                      }
                      setIsAddingShipment(false); setEditingShipmentId(null); setNewShipment({ status: 'Pending' });
                    } catch { toast(op(currentLanguage).hata_olustu, 'error'); }
                  }}
                  className="apple-button-primary text-sm disabled:opacity-50"
                >{oc(currentLanguage).kaydet}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── İRSALİYE (DELIVERY NOTE) MODAL ── */}
      <AnimatePresence>
        {deliveryNoteOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeliveryNoteOrder(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{op(currentLanguage).irsaliye_teslimat_notu} — #{deliveryNoteOrder.id.slice(0, 6)}</h3>
                <button onClick={() => setDeliveryNoteOrder(null)} className="p-2.5 -m-1 rounded-lg hover:bg-gray-100"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 flex-1 overflow-y-auto">
                <p className="text-xs text-gray-500">{op(currentLanguage).siparis_teslim_edildi_olarak_isaretlenecek_tesli}</p>
                <textarea className="apple-input w-full text-sm resize-none" rows={4} placeholder={op(currentLanguage).teslim_alan_tarih_not} value={deliveryNoteText} onChange={e => setDeliveryNoteText(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setDeliveryNoteOrder(null)} className="apple-button-secondary text-sm">{oc(currentLanguage).iptal}</button>
                <button
                  onClick={async () => {
                    const o = deliveryNoteOrder;
                    // Sözde Mikro siparişi: `handleUpdateOrderStatus` kapıda döner; not da YAZILMAZ, "kaydedildi" DENMEZ.
                    if (!orders.some(x => x.id === o.id)) { yazilabilirSiparis(o.id); setDeliveryNoteOrder(null); return; }
                    try {
                      // Durum TEK yoldan değişir (`handleUpdateOrderStatus`: stok geçişi + stockApplied + deliveredAt). Eski ham
                      // `updateDoc({status:'Delivered', …})` bunu baypas ediyordu — 'Kargoda' atlanıp doğrudan 'Teslim Edildi'
                      // yapılan siparişin stoğu hiç düşmüyordu (2026-09-19 son parti incelemesi). Not ayrıca yazılır.
                      if (!(await handleUpdateOrderStatus(o.id, 'Delivered'))) return;
                      if (deliveryNoteText.trim()) await updateDoc(doc(db, 'orders', o.id), { deliveryNote: deliveryNoteText.trim(), updatedAt: serverTimestamp() });
                      createNotification(oc(currentLanguage).teslim_edildi, `#${o.id.slice(0, 6)}`, 'info');
                      toast(op(currentLanguage).teslimat_kaydedildi, 'success');
                      setDeliveryNoteOrder(null);
                    } catch { toast(op(currentLanguage).hata_olustu, 'error'); }
                  }}
                  className="apple-button-primary text-sm"
                >{op(currentLanguage).teslim_et}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── SİPARİŞ DÜZENLE MODAL ── */}
      <AnimatePresence>
        {isEditingOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsEditingOrder(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{oc(currentLanguage).siparisi_duzenle}</h3>
                <button onClick={() => setIsEditingOrder(false)} className="p-2.5 -m-1 rounded-lg hover:bg-gray-100"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3 flex-1 overflow-y-auto">
                {/* MÜŞTERİ — serbest metin DEĞİL, cari kaydına BAĞLAYAN seçici.
                    2026-09-19 kapanış bulgusu: `handleAddOrder` müşteri adı elle yazılınca
                    `leadId: null` yazıyor; o siparişte `leads.find(...)` undefined döner ve
                    e-İrsaliye düğmesi kalıcı kilitli kalıyordu ('musteriBagliDegil'). Siparişe
                    sonradan lead bağlayan HİÇBİR ekran yoktu — artık bu form o ekrandır.
                    Ad ile OTOMATİK eşleştirme YAPILMIYOR (mükerrer lead riski, resmî belge):
                    bağ yalnız listeden seçilerek kurulur.
                    Belge kesildikten SONRA cari BAĞI değiştirilemez (kesilen e-İrsaliye/e-Fatura
                    başka bir cariye taşınamaz); ad düzenlenebilir kalır — yazım hatası düzeltmek
                    eski davranıştı ve kısıtlanması bu bulgunun kapsamı dışı. */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{oc(currentLanguage).musteri}</label>
                  {(() => {
                    const belgeKesildi = !!selectedOrder && (selectedOrder.irsaliyeGonderildi === true || !!selectedOrder.irsaliyeNo || !!selectedOrder.mikroFaturaNo);
                    const bagliCari = editingOrderData.leadId ? leads.find(l => l.id === editingOrderData.leadId) : undefined;
                    if (belgeKesildi) {
                      // Ad DÜZENLENEBİLİR kalır (eski davranış — yazım hatası düzeltilebilmeli);
                      // kilitlenen yalnız CARİ BAĞIDIR: kesilmiş resmî belge başka bir cariye taşınamaz.
                      return (
                        <>
                          <input type="text" className="apple-input w-full text-sm" value={(editingOrderData.customerName as string) ?? ''} onChange={e => setEditingOrderData(d => ({ ...d, customerName: e.target.value }))} />
                          <p className="text-[10px] text-gray-400 mt-1">
                            {currentLanguage === 'tr'
                              ? `Resmî belge kesilmiş — cari bağı değiştirilemez${bagliCari ? ` (${bagliCari.name})` : ''}.`
                              : `An official document was issued — the linked account cannot be changed${bagliCari ? ` (${bagliCari.name})` : ''}.`}
                          </p>
                        </>
                      );
                    }
                    return (
                      <>
                        <CustomerCombobox
                          leads={leads}
                          value={(editingOrderData.customerName as string) ?? ''}
                          onChange={v => setEditingOrderData(d => ({ ...d, customerName: v }))}
                          onSelect={lead => setEditingOrderData(d => ({ ...d, customerName: lead.name, leadId: lead.id }))}
                          inputClassName="apple-input w-full text-sm pl-9"
                          placeholder={op(currentLanguage).musteri_adi_listeden_secin}
                          renderSecondaryLine={l => l.mikroCariKod || l.cariKod || (op(currentLanguage).mikro_cari_kodu_yok)}
                        />
                        <p className={cn('text-[10px] mt-1', bagliCari ? 'text-gray-400' : 'text-amber-600')}>
                          {!bagliCari
                            ? (currentLanguage === 'tr'
                                ? 'Müşteri kaydına bağlı değil — e-İrsaliye kesilemez. Listeden seçin.'
                                : 'Not linked to a customer record — no e-waybill can be issued. Pick from the list.')
                            : `${op(currentLanguage).cari}: ${bagliCari.name} · ${
                                bagliCari.mikroCariKod || bagliCari.cariKod
                                  || (op(currentLanguage).mikro_cari_kodu_yok)}`}
                        </p>
                      </>
                    );
                  })()}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{oc(currentLanguage).teslimat_adresi}</label>
                  <input type="text" className="apple-input w-full text-sm" value={(editingOrderData.shippingAddress as string) ?? ''} onChange={e => setEditingOrderData(d => ({ ...d, shippingAddress: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{op(currentLanguage).tutar}</label>
                    <input type="number" className="apple-input w-full text-sm" placeholder={oc(currentLanguage).bilinmiyor} value={editingTutarHam} onChange={e => setEditingTutarHam(e.target.value)} />
                  </div>
                  {/* DURUM alanı BURADAN KALDIRILDI (2026-09-19): bu pencere durumu yamayla doğrudan yazıyordu —
                      `handleUpdateOrderStatus`'tan GEÇMEDİĞİ için 'Kargoda' yapılınca stok DÜŞMÜYOR, `stockApplied`
                      işaretlenmiyor ve e-İrsaliye teklifi çıkmıyordu. Durum tek yoldan değişir: liste / detay seçicisi. */}
                </div>
                {/* SEVK DEPOSU + KDV ORANI — e-İrsaliye düğmesi bu iki alan eksikken DEVRE DIŞI kalıyor
                    ve ipucu "siparişi düzenleyip depoyu/oranı tamamlayın" diyor. 2026-09-19 delta bulgusu:
                    o alanlar yalnız hiçbir yerden AÇILAMAYAN bir formdaydı (components/EditOrderModal;
                    `isEditingOrder` state'ini true yapan satır yoktu) — yönlendirme karşılıksız, düğme
                    kalıcı kilitliydi. Eski/kanal siparişine depo eklemenin yolu artık BU form.
                    Değişmez testi: utils/siparisler/formKayit.test.ts (kaynak taraması). */}
                <SevkDeposuSecici
                  warehouses={warehouses}
                  deger={editingOrderData.depoNo}
                  currentLanguage={currentLanguage}
                  bosSecenekYok
                  onDegis={depoNo => setEditingOrderData(d => {
                    const { depoNo: _secilmemis, ...kalan } = d;
                    return depoNo === undefined ? kalan : { ...kalan, depoNo };
                  })}
                />
                {/* BELGE TİPİ — e-Fatura gönderimi tipi bilinmeyen siparişte "siparişi düzenleyip belge tipini seçin" der;
                    o alanı ÜRETEN yüzey burasıdır (üretici yüzey şartı). Seçilmemişse müşterinin e-Fatura kaydından
                    türeyen tip ipucu olarak gösterilir, o da bilinmiyorsa kullanıcı uyarılır. Boş seçim yazılmaz. */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{op(currentLanguage).belge_tipi}</label>
                  <select className="apple-input w-full text-sm" value={editingOrderData.faturaTipi ?? ''}
                    onChange={e => setEditingOrderData(d => {
                      const { faturaTipi: _secilmemis, ...kalan } = d;
                      return e.target.value === '' ? kalan : { ...kalan, faturaTipi: e.target.value as BelgeTipi };
                    })}>
                    {!editingOrderData.faturaTipi && <option value="">{op(currentLanguage).secilmedi}</option>}
                    <option value="e-fatura">e-Fatura</option>
                    <option value="e-arsiv">e-Arşiv</option>
                    <option value="ihracat">{oc(currentLanguage).ihracat}</option>
                  </select>
                  {!editingOrderData.faturaTipi && (() => {
                    const turetilen = siparisBelgeTipi({}, leads.find(l => l.id === editingOrderData.leadId));
                    return (
                      <p className={`text-[10px] mt-1 ${turetilen ? 'text-gray-500' : 'text-amber-600'}`}>
                        {turetilen
                          ? (currentLanguage === 'tr' ? `Seçilmezse müşterinin e-Fatura kaydına göre: ${turetilen === 'e-fatura' ? 'e-Fatura' : 'e-Arşiv'}.` : `If not selected, from the customer’s registration: ${turetilen === 'e-fatura' ? 'e-Invoice' : 'e-Archive'}.`)
                          : (op(currentLanguage).musterinin_e_fatura_kaydi_bilinmiyor_secilmezse_)}
                      </p>
                    );
                  })()}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{op(currentLanguage).kdv_orani}</label>
                  {/* Boş = BİLİNMİYOR (`?? 20` uydurması Mikro'ya yanlış vergi işaretçisi yazar);
                      bilinen 0 gerçek orandır (KDV'siz ihracat). */}
                  <input type="number" min="0" max="100" className="apple-input w-full text-sm" placeholder={oc(currentLanguage).bilinmiyor}
                    value={editingKdvHam} onChange={e => setEditingKdvHam(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setIsEditingOrder(false)} className="apple-button-secondary text-sm">{oc(currentLanguage).iptal}</button>
                <button
                  onClick={async () => {
                    if (!selectedOrder) return;
                    const kdv = kdvOraniDogrula(editingKdvHam);
                    if (!kdv.gecerli) {
                      toast(op(currentLanguage).kdv_orani_0_ile_100_arasinda_olmali, 'error');
                      return;
                    }
                    const duzenlenenId = selectedOrder.id;
                    // Açık tip argümanı: `status` artık bu formdan yazılmıyor, çıkarım `string`e düşerdi.
                    const yama = siparisDuzenlemeYamasi<Order['status']>({
                      customerName: editingOrderData.customerName,
                      shippingAddress: editingOrderData.shippingAddress,
                      tutarHam: editingTutarHam,
                      kdvHam: editingKdvHam,
                      depoNo: editingOrderData.depoNo,
                      // Yalnız GERÇEKTEN değiştiyse yaz (leadId ile aynı gerekçe).
                      faturaTipi: editingOrderData.faturaTipi && editingOrderData.faturaTipi !== selectedOrder.faturaTipi ? editingOrderData.faturaTipi : undefined,
                      // Yalnız GERÇEKTEN değiştiyse yaz — aksi hâlde her kayıt aynı leadId'yi
                      // gereksizce geri yazar (PATCH-merge'de eşzamanlı değişikliği ezme riski).
                      leadId: editingOrderData.leadId === selectedOrder.leadId ? undefined : editingOrderData.leadId,
                    }, selectedOrder);
                    if (!yazilabilirSiparis(duzenlenenId)) return;
                    try {
                      await updateDoc(doc(db, 'orders', duzenlenenId), { ...yama, updatedAt: serverTimestamp() });
                      // İŞLEVSEL güncelleyici: `await` sırasında App.tsx e-İrsaliye işaretini yazmış
                      // olabilir; bayat kapanışı yaymak işareti yerelde siler ve düğme yeniden
                      // etkinleşir (aynı sevkiyat için ikinci resmî belge — 2026-09-19 delta).
                      // `totalPrice` tipi `number` olduğu için silinen tutar NaN'la temsil edilir
                      // (paraYaz NaN'ı '—' basar). OPSİYONEL alanlarda (kdvOran/kdvTutari/
                      // kdvHaricTutar) NaN YANLIŞTIR: `JSON.stringify(NaN) === 'null'` ve o null
                      // `handleMikroFatura` gövdesinde `z.number().optional()` kapısına takılıp
                      // kullanıcıya alan-bazlı gerekçe yerine ham şema hatası gösteriyordu
                      // (2026-09-19 kapanış). Bilinmeyen = alan YOK → `yerelSayi`.
                      setSelectedOrder(o => (o && o.id === duzenlenenId ? {
                        ...o, ...yama,
                        totalPrice: yerelTutar(yama.totalPrice, o.totalPrice),
                        kdvOran: yerelSayi(yama.kdvOran, o.kdvOran),
                        kdvHaricTutar: yerelSayi(yama.kdvHaricTutar, o.kdvHaricTutar),
                        kdvTutari: yerelSayi(yama.kdvTutari, o.kdvTutari),
                      } : o));
                      toast(op(currentLanguage).siparis_guncellendi, 'success');
                      setIsEditingOrder(false);
                    } catch { toast(op(currentLanguage).hata_olustu, 'error'); }
                  }}
                  className="apple-button-primary text-sm"
                >{oc(currentLanguage).kaydet}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── HIZLI SEVKİYAT MODAL ── */}
      <AnimatePresence>
        {showQuickShipment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowQuickShipment(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm relative z-10 overflow-hidden max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{oc(currentLanguage).hizli_sevkiyat}</h3>
                <button onClick={() => setShowQuickShipment(null)} className="p-2.5 -m-1 rounded-lg hover:bg-gray-100"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-2 text-sm text-gray-600">
                <p>{op(currentLanguage).bu_siparisten_sevkiyat_olusturulsun_mu}</p>
                <p className="font-semibold text-gray-800">{showQuickShipment.customerName} — {gorunenSiparisNo(showQuickShipment)}</p>
                <p className="text-xs text-gray-400">{showQuickShipment.shippingAddress}</p>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
                <button onClick={() => setShowQuickShipment(null)} className="apple-button-secondary text-sm">{oc(currentLanguage).iptal}</button>
                <button
                  onClick={async () => {
                    // İkinci çit: pencere açıkken durum değişmiş olabilir (başka sekmeden teslim/sevkiyat) — GÜNCEL kayıt okunur,
                    // pencerenin açıldığı andaki kopya değil (inceleme 2026-09-25).
                    const o = guncelSiparis(showQuickShipment);
                    const engel = sevkiyatEngeli(o, shipments);
                    if (engel) { toast(sevkiyatEngeliMetni(engel, currentLanguage), 'error'); setShowQuickShipment(null); return; }
                    try {
                      await addDoc(collection(db, 'shipments'), {
                        customerName: o.customerName ?? '', destination: o.shippingAddress ?? '',
                        driver: '', cargoFirm: '', trackingNo: '', status: 'Pending',
                        date: bugunAnahtari(), orderId: o.id,
                        companyId: (o as unknown as { companyId?: string }).companyId ?? null,
                        createdAt: serverTimestamp(),
                      });
                      toast(op(currentLanguage).sevkiyat_olusturuldu, 'success');
                      setShowQuickShipment(null);
                    } catch { toast(op(currentLanguage).hata_olustu, 'error'); }
                  }}
                  className="apple-button-primary text-sm"
                >{oc(currentLanguage).olustur}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {locationQrModal && (
        <LocationQRModal
          isOpen={true}
          onClose={() => setLocationQrModal(null)}
          currentLanguage={currentLanguage}
          locationType={locationQrModal.type}
          locationId={locationQrModal.id}
          locationName={locationQrModal.name}
          subtitle={locationQrModal.subtitle}
        />
      )}
    </>
  );
}
