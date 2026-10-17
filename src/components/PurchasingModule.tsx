import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingCart, Plus, Search, CheckCircle, Clock, AlertCircle, Trash2, Edit2, Package, Truck, DollarSign, X, Eye, TrendingUp, FileDown } from 'lucide-react';
import { collection, query, onSnapshot, addDoc, updateDoc, doc, setDoc, deleteDoc, serverTimestamp, incrementField } from '../lib/dbClient';
import { db } from '../firebase';
import MikroPushButton from './MikroPushButton';
import { satinAlmaTalepPayload } from '../services/mikroEvrak';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { confirmAction } from '../lib/confirm';
import ModuleHeader from './ModuleHeader';
import { logFirestoreError, OperationType } from '../utils/firebase';
import { eslesir } from '../utils/arama';
import { exportPurchaseOrderPDF, exportGoodsReceiptPDF } from '../utils/pdf';
import { InventoryItem, Order, Supplier } from '../types';
import { submitApprovalRequest } from './ApprovalQueue';
import { araMikroCari, cariAramaHataMetni, cariAramaMetniYeterli, syncSupplierToMikro, type MikroCariItem } from '../services/mikroService';
import { ucKapisindanGecer } from '../lib/mikroUcKapilari';
import { isAllowed, rolMu } from '../lib/rbac';
import { isimAnahtari } from '../lib/isimAnahtari';
import { useMikroSiparisler } from '../hooks/useMikroSiparisler';
import { kurCevir, paraYaz } from '../utils/currency';
import { toplaBilinen, ekranTutari, sayiSirala } from '../utils/para';
import { basHarf } from '../utils/buyukHarf';
import { oc } from '../i18n/ortak';

const SortHeader: React.FC<{ label: string; sortKey: string; currentSort: { key: string; direction: 'asc' | 'desc' } | null; onSort: (key: string) => void }> = ({ label, sortKey, currentSort, onSort }) => (
  <th 
    className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-600 group/header" 
    onClick={() => onSort(sortKey)}
  >
    <div className="flex items-center gap-2">
      {label}
      <TrendingUp className={cn(
        "w-3 h-3 transition-all opacity-0 group-hover/header:opacity-100",
        currentSort?.key === sortKey ? "opacity-100 text-brand" : "text-gray-300",
        currentSort?.key === sortKey && currentSort.direction === 'desc' ? "rotate-180" : ""
      )} />
    </div>
  </th>
);

interface PurchaseOrderItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  purchasePrice: number;
  price?: number;
}

interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplier: string;
  status: 'Taslak' | 'Beklemede' | 'Sipariş Edildi' | 'Teslim Alındı' | 'İptal Edildi';
  items: PurchaseOrderItem[];
  /** Tutar BİLİNMİYORSA alan HİÇ YOKTUR (Mikro `sip_tutar` NULL) — `paraYaz` '—' basar. */
  totalAmount?: number;
  expectedDate?: string | { toDate?: () => Date };
  createdAt: string | number | Date | { toDate?: () => Date };
  notes?: string;
  /** Kayıtta tedarikçi bağı (`suppliers` id'si) — yeni / güncellenen siparişte yazılır; eski siparişte YOK, bağsızsa `null`. */
  supplierId?: string | null;
  mikroCariKod?: string | null;
}

interface PurchasingModuleProps {
  /** GLOBAL döviz seçimi (2026-09-04): modül kendi lokal `kpiCurrency` state'ini
   *  tutuyordu ve sayfa başlığındaki seçiciyle bağlantısı YOKTU — aynı ekranda iki
   *  bağımsız TRY/USD/EUR düğmesi vardı, üsttekini değiştirince buradaki kart
   *  değişmiyordu. Artık tek kaynak: sayfa geçer, modül okur. */
  kpiCurrency?: 'TRY' | 'USD' | 'EUR';
  setKpiCurrency?: (c: 'TRY' | 'USD' | 'EUR') => void;
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
  userRole: string | null;
  inventory: InventoryItem[];
  orders: Order[];
  onNavigate?: (tab: string) => void;
  exchangeRates?: Record<string, number> | null;
  prefillProduct?: { name: string; sku: string };
  onPrefillConsumed?: () => void;
}

export default function PurchasingModule({ currentLanguage, isAuthenticated, userRole, inventory = [], onNavigate, exchangeRates, prefillProduct, onPrefillConsumed, kpiCurrency: kpiCurrencyProp, setKpiCurrency: setKpiCurrencyProp }: PurchasingModuleProps) {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [isAddingOrder, setIsAddingOrder] = useState(false);

  // ── MİKRO ENTEGRASYONU (Alış Siparişleri) ──
  const [poSourceTab, setPoSourceTab] = useState<'cetpa' | 'mikro'>('cetpa');
  const mikroSiparisler = useMikroSiparisler(true);
  // `totalAmount` yalnız BİLİNİYORSA yazılır (2026-09-19 delta bulgusu): hook eskiden
  // `Number(sip_tutar || 0)` ile bilinmeyeni ₺0 yapıyor, Mikro aynasında `sip_tutar` NULL gelen
  // alış siparişi "₺0 alış" gibi listeleniyor ve KPI toplamına 0 olarak giriyordu. Alanı hiç
  // yazmamak `paraYaz`ı '—' yaptırır ve `toplaBilinen` kaydı SAYAR (toplama katmaz).
  const mappedMikroSiparisler = mikroSiparisler.filter(ms => ms.tip === 1).map(ms => ({
    id: ms.id,
    orderNumber: ms.evrakNo,
    supplier: ms.cariKodu,
    status: 'Sipariş Edildi' as const,
    items: [], // Detay eklenecekse burası doldurulmalı
    ...(Number.isFinite(ms.tutar) ? { totalAmount: ms.tutar } : {}),
    createdAt: ms.tarih,
    expectedDate: ms.tarih,
    notes: ms.satirAciklamasi
  })) as PurchaseOrder[];
  
  const activePurchaseOrders = poSourceTab === 'cetpa' ? purchaseOrders : mappedMikroSiparisler;

  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  // Prop verilmişse GLOBAL seçim kullanılır; verilmemişse (modül başka bir yerden
  // tek başına kullanılırsa) eski lokal davranış korunur.
  const [yerelCurrency, setYerelCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const kpiCurrency = kpiCurrencyProp ?? yerelCurrency;
  const setKpiCurrency = setKpiCurrencyProp ?? setYerelCurrency;
  const [validationError, setValidationError] = useState('');
  const showValidationError = (msg: string) => { setValidationError(msg); setTimeout(() => setValidationError(''), 3500); };

  
  // New Order Form State
  const [newOrder, setNewOrder] = useState({
    supplier: '',
    items: [] as PurchaseOrderItem[],
    notes: '',
    expectedDate: format(new Date(), 'yyyy-MM-dd')
  });
  const [productSearch, setProductSearch] = useState('');

  // Tedarikçi: yerel 'suppliers' koleksiyonundan oto-tamamlama + yeni tedarikçi oluşturma + «Mikro'da ara» ile içe aktarma.
  // Müşteri (CRM) tarafındaki aynı mikroCariKod deseniyle tutarlı olması için suppliers koleksiyonuna mikroCariKod eklendi.
  //
  // «Mikro'da ara» kutusu GERİ GELDİ (şartname `.wf/SARTNAME-mikro-cari-arama.md` C8, 2026-10-17): karar turunda (2026-10-11,
  // K1 / H3) kaldırılmıştı — çağırdığı `cari/listesi` ucu sonuç DÖNDÜRMÜYOR, her aramada 200 cariye kadar `leads` yazıyordu.
  // Artık salt okuyan `POST /api/mikro/cari/ara` (`araMikroCari`) çağrılır; içe aktarma bu ekranın kendi `suppliers` yazımıdır.
  // Kutu yalnız İKİ koşul birlikteyken çizilir (İ3 — ölü düğme yok): rol arama ucunun kapısından geçer VE `suppliers` yazar
  // (sonraki adım tedarikçi yazımıdır). Muhasebe uca geçer ama tedarikçi yazamaz → kutu yok, çağrı yok. Rol PROP'tan
  // (`userRole`), `rolMu` korumasıyla daraltılır; tanınmayan değer kapalı başarısızlıktır.
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [supplierActionLoading, setSupplierActionLoading] = useState(false);
  const kapiRolu = rolMu(userRole) ? userRole : null;
  const mikroAranabilir = ucKapisindanGecer(kapiRolu, 'POST /api/mikro/cari/ara') && isAllowed(kapiRolu, 'suppliers', 'write');
  /** `null` = arama yapılmadı (ya da metin değişti); dizi = son aramanın sonucu. `undefined` OLAMAZ. */
  const [mikroSonuclari, setMikroSonuclari] = useState<MikroCariItem[] | null>(null);
  const [mikroSinirli, setMikroSinirli] = useState(false);
  const [mikroAraniyor, setMikroAraniyor] = useState(false);
  const [mikroHataMetni, setMikroHataMetni] = useState<string | null>(null);
  /** İstek sırası (inceleme 1): her sıfırlama (metin değişti, tedarikçi seçildi, pencere kapandı) ve her yeni arama sayacı artırır;
   *  yanıt geldiğinde sırası güncel değilse SONUÇ / HATA / «aranıyor» durumuna YAZILMAZ — uçuştaki «kaya» yanıtı, metin «kayalar»
   *  olduktan sonra sıfırlanmış kutuya bayat sonuç basmasın. */
  const mikroAramaSirasi = useRef(0);
  const mikroAramaSifirla = () => {
    mikroAramaSirasi.current++;
    setMikroAraniyor(false); setMikroSonuclari(null); setMikroSinirli(false); setMikroHataMetni(null);
  };

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'suppliers'), snap => {
      setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Supplier)));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'suppliers'));
    return () => unsub();
  }, []);

  // `s.name` null-korumalı (2026-08-30 canlı çökme): Mikro'dan gelen adsız bir
  // tedarikçi kaydı `undefined.toLowerCase()` ile TÜM Satın Alma modülünü
  // ErrorBoundary'ye düşürüyordu — bu find mount'ta koşulsuz çalışır.
  const supplierQuery = (newOrder.supplier ?? '').trim().toLowerCase();
  // Öneri listesi Türkçe-duyarlı arar (utils/arama.eslesir): "istanbul" yazan
  // "İSTANBUL YAPI"yı bulmalı — düz toLowerCase 'İ'yi i+U+0307'ye çevirip
  // eşleşmeyi kaçırıyor, kullanıcı tedarikçiyi mükerrer açıyordu (code-review).
  // Tam ad EŞİTLİĞİ (liste kapanır mı, «yeni tedarikçi» mevcut kaydı mı seçer) `eslesir` katlamasıyla YAPILMAZ: katla ASCII'ye
  // indirger, 'Şişli'yle 'SISLI'yı AYNI kayıt sayardı. Eşitlik `isimAnahtari` ile (Türkçe locale, katlama YOK — inceleme 2, İ2-1):
  // İ1-3'ten beri aynı adlı İKİ tedarikçi bilerek olabilir — elle açılan 'Kaya Yapı' ile Mikro'dan içe aktarılan 'KAYA YAPI'
  // (VKN'leri farklı). Eski `toLowerCase` bu ikiliyi aynı ad SAYMIYORDU ('yapı' ≠ 'yapi'; 'İ' → i + birleşik nokta), birden çok
  // eşleşme denetimi asıl ikilide hiç tetiklenmezdi; tek eşleşmede de ilk kaydı seçiyordu. Şimdi: TEK eşleşme → eski davranış (liste
  // kapanır); BİRDEN ÇOK → liste AÇIK, eşleşenler VKN'leriyle seçilebilir, hiçbiri kendiliğinden seçilmez, yeni kopya açılmaz.
  // (Şartname H13 bu eşitliği işin dışında tutmuştu; İ2-1 onu bu işe aldı.)
  const matchingSuppliers = supplierQuery
    ? suppliers.filter(s => eslesir(newOrder.supplier ?? '', s.name))
    : [];
  const supplierAnahtari = isimAnahtari(newOrder.supplier);
  const tamAdEslesenler = supplierAnahtari ? suppliers.filter(s => isimAnahtari(s.name) === supplierAnahtari) : [];
  const exactSupplierMatch = tamAdEslesenler.length === 1 ? tamAdEslesenler[0] : undefined;
  const adBelirsiz = tamAdEslesenler.length > 1;
  /** Siparişe yazılacak tedarikçi bağı (inceleme 3 — İ3-1). Önce açık seçim (`selectedSupplierId`: listeden seçildi, Mikro'dan içe
   *  aktarıldı, yeni açıldı ya da düzenlenen siparişin kayıtlı bağı); yoksa tam ad `isimAnahtari` ile TEK kayda eşleşiyorsa o kayıt —
   *  düzenleme yolunun kuralı (`siparisTedarikciBagi`). Birden çok eşleşmede bağ YOK (kullanıcı listeden seçer). Eskiden tam ad
   *  yazılınca liste kapanıyor (tek eşleşme) ama `selectedSupplierId` boş kaldığı için sipariş `supplierId: null` ile yazılıyordu;
   *  `isimAnahtari`'na geçiş bunu BÜYÜK harfli yazıma da yaymıştı. Yeşil onay göstergesi, «Siparişi Oluştur» ve «Güncelle» bu TEK
   *  değeri okur: gösterge «bağlı» derken yazım bağsız gitmesin. */
  const seciliTedarikciId = selectedSupplierId ?? exactSupplierMatch?.id ?? null;
  /** Tedarikçi açılır listesi çizili mi — çizim koşulu ve girdideki Enter (Mikro araması) AYNI koşulu okur. */
  const tedarikciListesiAcik = !viewingOrder && supplierDropdownOpen && !!supplierQuery && !exactSupplierMatch;

  /** Düzenlenen siparişin tedarikçi bağı (inceleme 2 — İ2-1). Önce siparişte KAYITLI `supplierId`: İ1-3'ten beri aynı adlı iki
   *  tedarikçi olabilir ve ada göre bulmak «Güncelle»de siparişin `supplierId` / `mikroCariKod`'unu ÖBÜR kayda geçirirdi. Kayıtlı
   *  bağ listede yoksa (kayıt silinmiş ya da liste henüz gelmemiş) de bağ KORUNUR — ada göre başka kayda geçilmez. Ad yalnız bağ hiç
   *  yoksa (eski sipariş) ve `isimAnahtari` ile TEK kayda eşleşiyorsa kullanılır; birden çok eşleşmede seçim boş (kullanıcı seçer). */
  const siparisTedarikciBagi = (order: PurchaseOrder): string | null => {
    if (order.supplierId) return order.supplierId;
    const anahtar = isimAnahtari(order.supplier);
    const eslesenler = anahtar ? suppliers.filter(s => isimAnahtari(s.name) === anahtar) : [];
    return eslesenler.length === 1 ? eslesenler[0].id : null;
  };

  // Klavye yolu (inceleme 2 — İ2-2): odak kutunun İÇİNDE başka öğeye geçiyorsa (`relatedTarget` kutuda: Tab ile kayıtlı tedarikçi,
  // «Mikro'da ara», Mikro sonuç düğmesi) kapatma zamanlayıcısı KURULMAZ. Zamanlayıcı girdide değil kutu kapsayıcısında kurulur ki
  // odak kutudan bir DÜĞMEDEN çıkınca da liste kapansın. Odak 150 ms içinde GİRDİYE dönerse bekleyen kapatma iptal edilir.
  const tedarikciGirdisiRef = useRef<HTMLInputElement>(null);
  const tedarikciKapatma = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tedarikciKapatmayiIptalEt = () => {
    if (tedarikciKapatma.current !== null) { clearTimeout(tedarikciKapatma.current); tedarikciKapatma.current = null; }
  };
  useEffect(() => tedarikciKapatmayiIptalEt, []);
  const tedarikciKutusuOdakKaybi = (e: React.FocusEvent<HTMLDivElement>) => {
    const hedef = e.relatedTarget;
    if (hedef instanceof Node && e.currentTarget.contains(hedef)) return;
    tedarikciKapatmayiIptalEt();
    tedarikciKapatma.current = setTimeout(() => { tedarikciKapatma.current = null; setSupplierDropdownOpen(false); }, 150);
  };

  const handleSelectSupplier = (s: Supplier) => {
    setNewOrder(prev => ({ ...prev, supplier: s.name }));
    setSelectedSupplierId(s.id);
    setSupplierDropdownOpen(false);
    mikroAramaSifirla();
  };

  const handleMikroAra = async () => {
    const metin = (newOrder.supplier ?? '').trim();
    if (mikroAraniyor || !mikroAranabilir || !cariAramaMetniYeterli(metin)) return;
    // Arama klavyeyle düğmeden başlatıldıysa odak girdiye döner (İ2-2): düğme sonuç gelince DOM'dan kalkar ve odak sayfanın başına
    // düşerdi; girdiden Tab sonuç düğmelerine ulaşır. Fareyle tıklamada odak zaten girdide (düğmenin `onMouseDown` preventDefault'u).
    tedarikciGirdisiRef.current?.focus();
    mikroAramaSifirla();
    const sira = ++mikroAramaSirasi.current;
    setMikroAraniyor(true);
    try {
      const sonuc = await araMikroCari(metin);
      if (sira !== mikroAramaSirasi.current) return;   // kutu bu arada sıfırlandı (metin değişti / tedarikçi seçildi): bayat yanıt
      if (sonuc.success) { setMikroSonuclari(sonuc.data); setMikroSinirli(sonuc.sinirli); }
      else setMikroHataMetni(cariAramaHataMetni(sonuc, currentLanguage === 'tr'));
    } finally {
      if (sira === mikroAramaSirasi.current) {
        setMikroAraniyor(false);
        // Liste açık kalsın (sonuç / hata görünsün). Düğmenin `onMouseDown` preventDefault'u girdinin odağını korur — odak kaybı
        // (kutunun `onBlur`'u → 150 ms sonra liste kapanır) hızlı yanıtı silemez.
        setSupplierDropdownOpen(true);
      }
    }
  };

  // VKN karşılaştırması rakam dışı karakterleri (boşluk / tire / nokta) yok sayar — Mikro ve yerel kayıt aynı numarayı farklı
  // biçimlendirebilir.
  const yalnizRakam = (v?: string) => (v ?? '').replace(/\D/g, '');

  const handleMikroIceAktar = async (c: MikroCariItem) => {
    if (!mikroAranabilir) return;
    setSupplierActionLoading(true);
    try {
      // Mükerrer önleme SIRAYLA: VKN → mikroCariKod → ad. Ad eşitliği `isimAnahtari` ile (Türkçe locale): Mikro unvanı BÜYÜK gelir
      // ('İSTANBUL YAPI'), elle açılan tedarikçi karışık ('İstanbul Yapı') — `toLowerCase` 'İ'yi i + birleşik noktaya çevirip
      // ikisini ayrı kayıt sayardı (her içe aktarımda mükerrer tedarikçi). Yerel `exactSupplierMatch` bu işin dışında (H13).
      // Ad eşleşmesi YALNIZ kimliği ÇELİŞMEYEN kayıtta (inceleme 1, kullanıcı kararı): kaydın VKN'si dolu ve Mikro'nunkinden farklıysa
      // ya da kayıt BAŞKA bir cariye bağlıysa aynı ad başka firmadır — yeni tedarikçi açılır (eski kayda Mikro VKN'si / kodu yazılmaz).
      const vkn = yalnizRakam(c.cari_vdaire_no);
      const unvan = isimAnahtari(c.cari_unvan1);
      const existing = (vkn ? suppliers.find(s => yalnizRakam(s.taxNo) === vkn) : undefined)
        ?? suppliers.find(s => !!s.mikroCariKod && s.mikroCariKod === c.cari_kod)
        ?? (unvan ? suppliers.find(s => isimAnahtari(s.name) === unvan
          && !(vkn && yalnizRakam(s.taxNo) && yalnizRakam(s.taxNo) !== vkn)
          && !(s.mikroCariKod && s.mikroCariKod !== c.cari_kod)) : undefined);

      let targetId: string;
      if (existing) {
        // Var olan tedarikçide YALNIZ BOŞ alan doldurulur; Mikro'da boş olan alan yazılmaz (boş dize uydurulmaz). Kayıt başka
        // bir cariye bağlıysa bağı DEĞİŞMEZ.
        const yama: Record<string, string> = {};
        if (!existing.email && c.cari_EMail) yama.email = c.cari_EMail;
        if (!existing.phone && c.cari_CepTel) yama.phone = c.cari_CepTel;
        if (!existing.taxNo && c.cari_vdaire_no) yama.taxNo = c.cari_vdaire_no;
        if (!existing.mikroCariKod) yama.mikroCariKod = c.cari_kod;
        if (Object.keys(yama).length > 0) await updateDoc(doc(db, 'suppliers', existing.id), yama);
        targetId = existing.id;
      } else {
        const docRef = await addDoc(collection(db, 'suppliers'), {
          name: c.cari_unvan1,
          mikroCariKod: c.cari_kod,
          ...(c.cari_EMail ? { email: c.cari_EMail } : {}),
          ...(c.cari_CepTel ? { phone: c.cari_CepTel } : {}),
          ...(c.cari_vdaire_no ? { taxNo: c.cari_vdaire_no } : {}),
          createdAt: serverTimestamp(),
        });
        targetId = docRef.id;
      }
      setNewOrder(prev => ({ ...prev, supplier: existing?.name || c.cari_unvan1 }));
      setSelectedSupplierId(targetId);
      setSupplierDropdownOpen(false);
      mikroAramaSifirla();
    } catch (error) {
      logFirestoreError(error as Error, OperationType.WRITE, 'suppliers');
      setMikroHataMetni(currentLanguage === 'tr' ? 'Tedarikçi kaydedilemedi.' : 'Supplier could not be saved.');
    } finally {
      setSupplierActionLoading(false);
    }
  };

  const handleCreateLocalSupplier = async () => {
    if (!supplierQuery) return;
    setSupplierActionLoading(true);
    try {
      // Ad zaten kayıtlıysa (TEK kayıt) yeni kopya açılmaz — mevcut olan seçilir. Aynı adlı BİRDEN ÇOK kayıtta (İ1-3) bu düğme hiç
      // ÇİZİLMEZ (yerine «listeden seçin» notu — inceleme 2, İ2-1): hiçbiri kendiliğinden seçilmez, yeni kopya da açılmaz; eskiden
      // burada ilk eşleşen seçiliyordu.
      const existing = exactSupplierMatch;
      if (existing) {
        handleSelectSupplier(existing);
        return;
      }
      const docRef = await addDoc(collection(db, 'suppliers'), {
        name: newOrder.supplier.trim(),
        createdAt: serverTimestamp(),
      });
      setSelectedSupplierId(docRef.id);
      setSupplierDropdownOpen(false);
      mikroAramaSifirla();
      // Yeni tedarikciyi hemen Mikro'ya da kaydetmeyi dene - basarisiz olursa
      // sessizce yerel kalir, kullanici istediginde daha sonra tekrar dener.
      void syncSupplierToMikro({ name: newOrder.supplier.trim() }, docRef.id);
    } catch (error) {
      logFirestoreError(error as Error, OperationType.WRITE, 'suppliers');
    } finally {
      setSupplierActionLoading(false);
    }
  };

  // Phase 102: auto-open form when a prefill product is passed from low-stock panel
  useEffect(() => {
    if (!prefillProduct) return;
    setIsAddingOrder(true);
    setProductSearch(prefillProduct.name);
    setNewOrder(prev => ({ ...prev, notes: `${currentLanguage === 'tr' ? 'Düşük stok uyarısı:' : 'Low-stock alert:'} ${prefillProduct.name} (${prefillProduct.sku})` }));
    onPrefillConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillProduct]);

  const handleAddOrderItem = (product: { id: string, name: string, sku: string, price?: number, prices?: Record<string, number> }) => {
    if (newOrder.items.find(i => i.id === product.id)) {
      handleRemoveItem(product.id);
      return;
    }
    const basePrice = product.price || product.prices?.Retail || 0;
    setNewOrder(prev => ({
      ...prev,
      items: [...prev.items, { ...product, quantity: 1, purchasePrice: basePrice * 0.7 }]
    }));
  };

  const handleRemoveItem = (id: string) => {
    setNewOrder(prev => ({
      ...prev,
      items: prev.items.filter(i => i.id !== id)
    }));
  };

  const handleUpdateItem = (id: string, field: string, value: string | number) => {
    // Sayısal alanlarda negatif/NaN engeli (totalAmount bozulmasın).
    const v = (field === 'quantity' || field === 'purchasePrice')
      ? Math.max(0, Number(value) || 0)
      : value;
    setNewOrder(prev => ({
      ...prev,
      items: prev.items.map(i => i.id === id ? { ...i, [field]: v } : i)
    }));
  };

  const calculateTotal = (items: PurchaseOrderItem[]) => {
    return items.reduce((acc, curr) => acc + ((Number(curr.purchasePrice) || 0) * (Number(curr.quantity) || 0)), 0);
  };

  const handleSubmitOrder = async () => {
    // İki ayrı, spesifik mesaj: "tedarikçi + ürün" birleşik hatası kullanıcıyı
    // yanlış alana yönlendiriyordu (ürün seçili olsa da tedarikçi boşsa mesaj
    // "ürün seçin" gibi okunuyordu). Önce tedarikçiyi kontrol et.
    if (!(newOrder.supplier ?? '').trim()) {
      showValidationError(oc(currentLanguage).lutfen_tedarikci_adi_girin);
      return;
    }
    if (newOrder.items.length === 0) {
      showValidationError(oc(currentLanguage).lutfen_en_az_bir_urun_secin);
      return;
    }

    const total = calculateTotal(newOrder.items);
    const isPrivileged = userRole === 'Admin' || userRole === 'Manager' || userRole === 'Purchasing';

    try {
      // Pre-generate doc ref so its ID drives the PO number — no random needed
      const poDocRef = doc(collection(db, 'purchaseOrders'));
      const orderNumber = `PO-${poDocRef.id.slice(0, 8).toUpperCase()}`;

      const bagliTedarikciId = seciliTedarikciId;
      const linkedSupplier = bagliTedarikciId ? suppliers.find(s => s.id === bagliTedarikciId) : undefined;

      if (isPrivileged) {
        // Admin/Manager/Purchasing → create directly
        await setDoc(poDocRef, {
          orderNumber,
          supplier: newOrder.supplier,
          supplierId: bagliTedarikciId,
          mikroCariKod: linkedSupplier?.mikroCariKod || null,
          items: newOrder.items,
          status: 'Taslak',
          totalAmount: total,
          expectedDate: newOrder.expectedDate,
          notes: newOrder.notes,
          createdAt: serverTimestamp()
        });
      } else {
        // Other roles → route through approval queue (eBA)
        await submitApprovalRequest({
          type: 'purchase_order',
          title: currentLanguage === 'tr'
            ? `Satınalma Talebi: ${newOrder.supplier} (${newOrder.items.length} kalem)`
            : `Purchase Request: ${newOrder.supplier} (${newOrder.items.length} items)`,
          description: currentLanguage === 'tr'
            ? `Tedarikçi: ${newOrder.supplier} · Toplam: ${paraYaz(total)} · Beklenen: ${newOrder.expectedDate}${newOrder.notes ? ' · Not: ' + newOrder.notes : ''}`
            : `Supplier: ${newOrder.supplier} · Total: ${paraYaz(total)} · Due: ${newOrder.expectedDate}${newOrder.notes ? ' · Note: ' + newOrder.notes : ''}`,
          requestedBy: 'current_user',
          requestedByRole: userRole || 'Employee',
          targetModule: 'satin-alma',
          status: 'pending',
          priority: total > 50000 ? 'high' : total > 10000 ? 'medium' : 'low',
          amount: total,
          payload: {
            orderNumber,
            supplier: newOrder.supplier,
            items: JSON.stringify(newOrder.items.map(i => `${i.name} x${i.quantity}`)),
            totalAmount: total,
            expectedDate: newOrder.expectedDate,
            notes: newOrder.notes || '',
          },
        });
        showValidationError(
          currentLanguage === 'tr'
            ? '✓ Talep yönetici onayına gönderildi!'
            : '✓ Request sent to manager for approval!'
        );
      }

      setIsAddingOrder(false);
      setNewOrder({ supplier: '', items: [], notes: '', expectedDate: format(new Date(), 'yyyy-MM-dd') });
      setSelectedSupplierId(null);
      mikroAramaSifirla();
    } catch (error) {
      console.error('Error adding purchase order:', error);
      showValidationError(currentLanguage === 'tr' ? 'Hata oluştu. Tekrar deneyin.' : 'Error occurred. Please try again.');
    }
  };

  const handleUpdateOrder = async () => {
    if (!editingOrder) return;
    if (!(newOrder.supplier ?? '').trim()) {
      showValidationError(oc(currentLanguage).lutfen_tedarikci_adi_girin);
      return;
    }
    if (newOrder.items.length === 0) {
      showValidationError(oc(currentLanguage).lutfen_en_az_bir_urun_secin);
      return;
    }

    try {
      // Bağ, yeni siparişle AYNI türetilmiş değerden (İ3-1): form ortak, yeşil onay göstergesi düzenlemede de bu değeri gösterir.
      const bagliTedarikciId = seciliTedarikciId;
      const linkedSupplier = bagliTedarikciId ? suppliers.find(s => s.id === bagliTedarikciId) : undefined;
      // Bağlı kayıt listede yoksa ve bağ siparişin KENDİ bağıysa (silinmiş / henüz gelmemiş kayıt — İ2-1) siparişin cari kodu korunur;
      // bağ değiştiyse ya da kalktıysa yeni bağın kodu (yoksa `null`) yazılır.
      const kendiBagi = !!bagliTedarikciId && bagliTedarikciId === editingOrder.supplierId;
      const mikroCariKod = linkedSupplier ? (linkedSupplier.mikroCariKod || null) : (kendiBagi ? (editingOrder.mikroCariKod || null) : null);
      await updateDoc(doc(db, 'purchaseOrders', editingOrder.id), {
        supplier: newOrder.supplier,
        supplierId: bagliTedarikciId,
        mikroCariKod,
        items: newOrder.items,
        totalAmount: calculateTotal(newOrder.items),
        expectedDate: newOrder.expectedDate,
        notes: newOrder.notes,
        updatedAt: serverTimestamp()
      });
      setEditingOrder(null);
      setNewOrder({ supplier: '', items: [], notes: '', expectedDate: format(new Date(), 'yyyy-MM-dd') });
      setSelectedSupplierId(null);
      mikroAramaSifirla();
    } catch (error) {
      console.error('Error updating purchase order:', error);
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, 'purchaseOrders', orderId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });

      // Teslim alındıysa stok girişi — idempotent (receivedApplied flag ile çift giriş
      // engeli) + atomik increment (önce read-modify-write + flag yoktu).
      if (newStatus === 'Teslim Alındı') {
        const order = purchaseOrders.find(o => o.id === orderId);
        if (order && (order as { receivedApplied?: boolean }).receivedApplied !== true) {
          for (const item of order.items) {
            const invItem = inventory.find(i => i.id === item.id || i.sku === item.sku);
            const qty = Number(item.quantity) || 0;
            if (invItem && qty > 0) {
              await incrementField('inventory', invItem.id, 'stockLevel', qty, 0);
              await addDoc(collection(db, 'inventoryMovements'), {
                productId: invItem.id, productName: invItem.name, type: 'in', quantity: qty,
                reason: `Satın Alma Siparişi #${order.orderNumber}`, notes: `Tedarikçi: ${order.supplier}`,
                timestamp: serverTimestamp()
              });
            }
          }
          await updateDoc(doc(db, 'purchaseOrders', orderId), { receivedApplied: true });
        }
      }
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const handleDeleteOrder = async (id: string) => {
    const ok = await confirmAction({
      title: currentLanguage === 'tr' ? 'Siparişi Sil' : 'Delete Order',
      message: currentLanguage === 'tr' ? 'Bu siparişi silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this order?',
      confirmLabel: oc(currentLanguage).sil,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'purchaseOrders', id));
    } catch (error) {
      logFirestoreError(error, OperationType.DELETE, `purchaseOrders/${id}`);
    }
  };

  useEffect(() => {
    if (!isAuthenticated || !userRole) return;
    const q = query(collection(db, 'purchaseOrders'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as PurchaseOrder[];
      setPurchaseOrders(ordersData);
    }, (error) => {
      logFirestoreError(error, OperationType.LIST, 'purchaseOrders');
    });
    return () => unsubscribe();
  }, [isAuthenticated, userRole]);

  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filteredOrders = activePurchaseOrders.filter(order => {
    // Türkçe-duyarlı + null-korumalı arama (2026-08-30 canlı çökme +
    // 2026-08-31 code-review): eksik alan modülü düşürmesin, "istanbul"
    // sorgusu "İSTANBUL"u bulsun.
    const matchesSearch = eslesir(searchTerm, order.orderNumber, order.supplier);
    const matchesStatus = statusFilter === 'All' || order.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  /**
   * Iki siralama degerini karsilastirir. Siralanabilir alanlar string (orderNumber,
   * supplier, status), number (totalAmount, expectedDate ms) ya da Date/number
   * (createdAt) — Date once ms'e indirilir ki Date ile ham sayi ayni olcekte
   * karsilastirilsin. Tur cifti eslesmezse 0 doner: `<` ve `>` ikisi de false
   * verdiginde eski kod da 0 donuyordu, yani sira UYDURULMAZ.
   */
  const karsilastir = (x: unknown, y: unknown): number => {
    const xv = x instanceof Date ? x.getTime() : x;
    const yv = y instanceof Date ? y.getTime() : y;
    if (typeof xv === 'number' && typeof yv === 'number') return xv < yv ? -1 : xv > yv ? 1 : 0;
    if (typeof xv === 'string' && typeof yv === 'string') return xv < yv ? -1 : xv > yv ? 1 : 0;
    return 0;
  };

  const sortedOrders = [...filteredOrders].sort((a, b) => {
    if (!sortConfig) return 0;
    const { key, direction } = sortConfig;
    let aVal = (a as unknown as Record<string, unknown>)[key];
    let bVal = (b as unknown as Record<string, unknown>)[key];

    // TUTAR SÜTUNU — `sayiSirala` (para.ts, testli): bilinmeyen tutar HER İKİ yönde de sonda.
    // 2026-09-19 delta bulgusu: Mikro aynasında `sip_tutar` NULL gelince `totalAmount` alanı
    // artık HİÇ yazılmıyor (`?: number`). Aşağıdaki `karsilastir` `undefined` ile sayıyı
    // kıyaslayınca 0 döndürüyor, karşılaştırıcı geçişsiz oluyor ve [₺50, —, ₺100] azalan
    // sıralandığında ₺100 en altta kalıyordu. Sonucu `-fark` ile ÇEVİRME: bilinmeyen başa gelir.
    if (key === 'totalAmount') return sayiSirala(a.totalAmount, b.totalAmount, direction === 'desc');

    if (key === 'createdAt') {
      aVal = a.createdAt && typeof (a.createdAt as { toDate?: () => Date }).toDate === 'function' ? (a.createdAt as { toDate: () => Date }).toDate() : (a.createdAt || 0);
      bVal = b.createdAt && typeof (b.createdAt as { toDate?: () => Date }).toDate === 'function' ? (b.createdAt as { toDate: () => Date }).toDate() : (b.createdAt || 0);
    }

    if (key === 'expectedDate') {
      const toEtaTime = (raw: PurchaseOrder['expectedDate']): number => {
        if (!raw) return 0;
        if (typeof raw === 'string') return new Date(raw).getTime() || 0;
        if (typeof raw === 'object' && 'toDate' in raw && typeof raw.toDate === 'function') return raw.toDate().getTime();
        return 0;
      };
      aVal = toEtaTime(a.expectedDate);
      bVal = toEtaTime(b.expectedDate);
    }

    const fark = karsilastir(aVal, bVal);
    return direction === 'asc' ? fark : -fark;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Taslak': return 'bg-gray-100 text-gray-600';
      case 'Beklemede': return 'bg-orange-100 text-orange-600';
      case 'Sipariş Edildi': return 'bg-blue-100 text-blue-600';
      case 'Teslim Alındı': return 'bg-green-100 text-green-600';
      case 'İptal Edildi': return 'bg-red-100 text-red-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const t = {
    title: currentLanguage === 'tr' ? 'Satınalma Yönetimi' : 'Purchasing Management',
    subtitle: currentLanguage === 'tr' ? 'Tedarikçi siparişlerini ve stok girişlerini yönetin.' : 'Manage supplier orders and stock entries.',
    newOrder: currentLanguage === 'tr' ? 'Yeni Satınalma Emri' : 'New Purchase Order',
    pending: currentLanguage === 'tr' ? 'Bekleyen Siparişler' : 'Pending Orders',
    inTransit: currentLanguage === 'tr' ? 'Yoldaki Ürünler' : 'In Transit',
    monthlyTotal: currentLanguage === 'tr' ? 'Bu Ay Toplam' : 'Monthly Total',
    criticalStock: currentLanguage === 'tr' ? 'Kritik Stok Uyarısı' : 'Critical Stock Alert',
    searchPlaceholder: currentLanguage === 'tr' ? 'Sipariş no veya tedarikçi ara...' : 'Search order no or supplier...',
    noOrders: currentLanguage === 'tr' ? 'Sipariş bulunamadı.' : 'No orders found.',
    orderNo: oc(currentLanguage).siparis_no,
    supplier: oc(currentLanguage).tedarikci,
    date: oc(currentLanguage).tarih,
    status: oc(currentLanguage).durum,
    total: oc(currentLanguage).toplam,
    actions: oc(currentLanguage).islemler,
    eta: oc(currentLanguage).son_tarih,
  };

  // ── Phase 44: ETA badge helper ────────────────────────────────────────────
  const getEtaBadge = (order: PurchaseOrder) => {
    const done = order.status === 'Teslim Alındı' || order.status === 'İptal Edildi';
    if (done || !order.expectedDate) return null;
    const raw = order.expectedDate;
    const etaDate = typeof raw === 'string'
      ? new Date(raw)
      : (raw && typeof raw === 'object' && 'toDate' in raw && typeof raw.toDate === 'function'
          ? raw.toDate()
          : null);
    if (!etaDate) return null;
    const daysLeft = Math.round((etaDate.getTime() - Date.now()) / 86400000);
    if (daysLeft < 0) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600">
        ⚠ {currentLanguage === 'tr' ? 'Gecikti' : 'Overdue'}
      </span>
    );
    if (daysLeft === 0) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">
        {oc(currentLanguage).bugun}
      </span>
    );
    return (
      <span className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold",
        daysLeft <= 3 ? "bg-orange-50 text-orange-600" : "bg-emerald-50 text-emerald-700"
      )}>
        {daysLeft}{currentLanguage === 'tr' ? ' gün' : 'd'}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <ModuleHeader
        title={t.title}
        subtitle={t.subtitle}
        icon={ShoppingCart}
        actionButton={
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <div className="flex bg-gray-100/50 p-1 rounded-xl">
              <button
                onClick={() => setPoSourceTab('cetpa')}
                className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2", poSourceTab === 'cetpa' ? "bg-white text-brand shadow-sm" : "text-gray-500 hover:text-gray-700")}
              >
                <Package className="w-4 h-4" />
                {currentLanguage === 'tr' ? 'Cetpa' : 'Cetpa'}
              </button>
              <button
                onClick={() => setPoSourceTab('mikro')}
                className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2", poSourceTab === 'mikro' ? "bg-white text-brand shadow-sm" : "text-gray-500 hover:text-gray-700")}
              >
                <DollarSign className="w-4 h-4" />
                {currentLanguage === 'tr' ? 'Mikro' : 'Mikro'}
              </button>
            </div>
            <button
              onClick={() => setIsAddingOrder(true)}
              className="apple-button-primary flex items-center gap-2 justify-center"
            >
              <Plus className="w-4 h-4" />
              {t.newOrder}
            </button>
          </div>
        }
      />

      {/* Stats */}
      {(() => {
        // `|| 0` KALDIRILDI (2026-09-19): tutarı bilinmeyen sipariş toplama 0 olarak giriyor,
        // KPI "eksik ama dolu" bir rakam basıyordu. `ekranTutari` kısmi toplamı verir, hiç bilinen
        // yoksa NaN döner ve `kurCevir`/`paraYaz` zinciri '—' gösterir; sayaç da altta yazılır.
        const alisTutar = toplaBilinen(activePurchaseOrders, o => o.totalAmount);
        const totalTRY = ekranTutari(alisTutar);
        // KUR UYDURMA YOK (2026-08-26). Eskiden `exchangeRates?.USD || 1` vardı:
        // kur gelmemişse TL tutar OLDUĞU GİBİ kalıp başına '$' konuyordu
        // (₺40.000 → "$40.000", ~38× şişkin). `kurCevir` kur yoksa null döner,
        // KPI da '—' gösterir. TRY seçiliyken kur gerekmez, davranış aynıdır.
        const convertedTotal = kurCevir(totalTRY, kpiCurrency, exchangeRates);
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: t.pending, value: activePurchaseOrders.filter(o => o.status === 'Beklemede').length, icon: Clock, color: 'text-orange-600', bg: 'bg-orange-50', status: 'Beklemede' },
              { label: t.inTransit, value: activePurchaseOrders.filter(o => o.status === 'Sipariş Edildi').length, icon: Truck, color: 'text-blue-600', bg: 'bg-blue-50', status: 'Sipariş Edildi' },
              { label: t.criticalStock, value: inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', tab: 'inventory' },
            ].map((stat, i) => (
              <button
                key={i}
                onClick={() => { if (stat.tab && onNavigate) { onNavigate(stat.tab); } else if (stat.status) { setStatusFilter(stat.status); } }}
                className={cn("p-4 rounded-2xl border border-transparent text-left transition-all hover:scale-[1.02] active:scale-[0.98]", stat.bg, "cursor-pointer hover:border-brand/20 shadow-sm")}
              >
                <div className="flex items-center gap-2 mb-1">
                  <stat.icon className={cn("w-4 h-4", stat.color)} />
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{stat.label}</span>
                </div>
                <p className={cn("text-xl font-black", stat.color)}>{stat.value}</p>
              </button>
            ))}

            {/* Monthly Total — with currency toggle */}
            <div className="p-4 rounded-2xl bg-green-50 shadow-sm text-left">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t.monthlyTotal}</span>
                </div>
                <div className="flex items-center gap-0.5 bg-white/70 rounded-lg p-0.5">
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <button key={c} onClick={() => setKpiCurrency(c)}
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all ${kpiCurrency === c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xl font-black text-green-600">
                {convertedTotal === null
                  ? <span className="text-gray-400" title={!Number.isFinite(totalTRY)
                      // '—'nin İKİ nedeni AYRI yazılır: toplam hiç yoksa (tüm tutarlar okunamadı) sorun kur DEĞİLDİR.
                      ? (currentLanguage === 'tr' ? 'Sipariş tutarları okunamadı' : 'Order amounts unavailable')
                      : (currentLanguage === 'tr' ? 'Güncel kur alınamadı' : 'Exchange rate unavailable')}>—</span>
                  : paraYaz(convertedTotal, { birim: kpiCurrency, ondalik: 0 })}
              </p>
              {/* Kısmi toplamın EKSİKLİĞİ yazılır (2026-09-19): sessiz eksiltme yapmıyoruz. */}
              {alisTutar.bilinmeyen > 0 && (
                <p className="text-[10px] text-amber-600 mt-0.5">
                  {currentLanguage === 'tr'
                    ? `${alisTutar.bilinmeyen} siparişin tutarı okunamadı — ${alisTutar.bilinen === 0 ? 'toplam hesaplanamadı' : 'toplama dahil değil'}.`
                    : `${alisTutar.bilinmeyen} order(s) unpriced — ${alisTutar.bilinen === 0 ? 'total not computable' : 'excluded from the total'}.`}
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={t.searchPlaceholder}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="apple-input w-full pl-10"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
          {['All', 'Taslak', 'Beklemede', 'Sipariş Edildi', 'Teslim Alındı', 'İptal Edildi'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap",
                statusFilter === status
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              )}
            >
              {status === 'All' ? (oc(currentLanguage).tumu) : status}
            </button>
          ))}
        </div>
      </div>

      {/* Orders List */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <SortHeader label={t.orderNo} sortKey="orderNumber" currentSort={sortConfig} onSort={handleSort} />
                <SortHeader label={t.supplier} sortKey="supplier" currentSort={sortConfig} onSort={handleSort} />
                <SortHeader label={t.date} sortKey="createdAt" currentSort={sortConfig} onSort={handleSort} />
                <SortHeader label={t.status} sortKey="status" currentSort={sortConfig} onSort={handleSort} />
                <SortHeader label={t.eta} sortKey="expectedDate" currentSort={sortConfig} onSort={handleSort} />
                <SortHeader label={t.total} sortKey="totalAmount" currentSort={sortConfig} onSort={handleSort} />
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">{t.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedOrders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {/* Numarasız eski kayıtlar '#' basıyordu (2026-08-31) — SKU'ya düş. */}
                      <span className="text-sm font-bold text-gray-900">#{order.orderNumber || (order as unknown as { sku?: string }).sku || '—'}</span>
                      <MikroPushButton
                        compact
                        method="SatinAlmaTalepKaydetV2"
                        entityType="purchaseOrder"
                        entityId={order.id}
                        buildPayload={() => {
                          const it = order.items?.[0];
                          if (!it?.sku) return null;
                          return satinAlmaTalepPayload({
                            sku: it.sku,
                            quantity: it.quantity,
                            belgeNo: order.orderNumber,
                            requestedBy: order.supplier,
                          });
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {/* Tedarikçisiz satırda '??' yerine ürün adı göster (2026-08-31):
                          auto-reorder taslakları ürün bazlı, tedarikçi veriden sonradan
                          doldurulur — boşken satırın NE olduğu yine de anlaşılmalı. */}
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-500">
                        {basHarf(order.supplier || (order as unknown as { productName?: string }).productName, 2)}
                      </div>
                      <span className="text-sm font-medium text-gray-700">
                        {order.supplier || (
                          <span className="text-gray-400 italic">
                            {(order as unknown as { productName?: string }).productName || '—'}
                          </span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs text-gray-500">
                      {typeof order.createdAt === 'object' && order.createdAt !== null && 'toDate' in order.createdAt && typeof order.createdAt.toDate === 'function' ? format(order.createdAt.toDate(), 'dd MMM yyyy', { locale: currentLanguage === 'tr' ? tr : undefined }) : '-'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", getStatusColor(order.status))}>
                      {currentLanguage === 'tr' ? (
                        order.status === 'Taslak' ? 'Taslak' :
                        order.status === 'Beklemede' ? 'Bekliyor' :
                        order.status === 'Sipariş Edildi' ? 'Sipariş Edildi' :
                        order.status === 'Teslim Alındı' ? 'Teslim Alındı' :
                        order.status === 'İptal Edildi' ? 'İptal Edildi' : order.status
                      ) : order.status}
                    </span>
                  </td>
                  {/* Phase 44: ETA badge */}
                  <td className="px-4 py-4">
                    {getEtaBadge(order) ?? <span className="text-[11px] text-gray-300">—</span>}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-bold text-gray-900">{paraYaz(order.totalAmount)}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      {order.status === 'Taslak' && (
                        <button 
                          onClick={() => handleUpdateStatus(order.id, 'Beklemede')}
                          className="p-2 hover:bg-orange-50 rounded-xl text-orange-600 transition-all"
                          title={oc(currentLanguage).onaya_gonder}
                        >
                          <Clock className="w-4 h-4" />
                        </button>
                      )}
                      {order.status === 'Beklemede' && (
                        <button 
                          onClick={() => handleUpdateStatus(order.id, 'Sipariş Edildi')}
                          className="p-2 hover:bg-blue-50 rounded-xl text-blue-600 transition-all"
                          title={currentLanguage === 'tr' ? 'Sipariş Geçildi' : 'Mark as Ordered'}
                        >
                          <Package className="w-4 h-4" />
                        </button>
                      )}
                      {order.status === 'Sipariş Edildi' && (
                        <button 
                          onClick={() => handleUpdateStatus(order.id, 'Teslim Alındı')}
                          className="p-2 hover:bg-green-50 rounded-xl text-green-600 transition-all"
                          title={currentLanguage === 'tr' ? 'Teslim Alındı' : 'Mark as Received'}
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          setViewingOrder(order);
                        }}
                        className="p-2 hover:bg-blue-50 rounded-xl text-blue-500 transition-all"
                        title={oc(currentLanguage).incele}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => {
                          setNewOrder({
                            supplier: order.supplier ?? '',
                            items: order.items,
                            notes: order.notes || '',
                            expectedDate: typeof order.expectedDate === 'string' ? order.expectedDate : (order.expectedDate && typeof order.expectedDate === 'object' && 'toDate' in order.expectedDate && typeof order.expectedDate.toDate === 'function' ? format(order.expectedDate.toDate(), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'))
                          });
                          setEditingOrder(order);
                          setSelectedSupplierId(siparisTedarikciBagi(order));
                          mikroAramaSifirla();
                        }}
                        className="p-2 hover:bg-gray-100 rounded-xl text-gray-500 transition-all"
                        title={oc(currentLanguage).duzenle}
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDeleteOrder(order.id)}
                        className="p-2 hover:bg-red-50 rounded-xl text-red-500 transition-all"
                        title={oc(currentLanguage).sil}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <ShoppingCart className="w-12 h-12 text-gray-100" />
                      <p className="text-sm text-gray-400">{t.noOrders}</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit/View Order Modal */}
      <AnimatePresence>
        {(isAddingOrder || editingOrder || viewingOrder) && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
            >
              {/* Modal Header */}
              <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center text-white shadow-lg shadow-brand/20">
                    <ShoppingCart className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-[#1D1D1F]">
                      {viewingOrder ? (currentLanguage === 'tr' ? 'Sipariş Detayı' : 'Order Details') : 
                       editingOrder ? (oc(currentLanguage).siparisi_duzenle) : 
                       t.newOrder}
                    </h2>
                    <p className="text-xs text-[#86868B]">
                      {viewingOrder ? (currentLanguage === 'tr' ? 'Sipariş bilgilerini görüntüleyin' : 'View order details') :
                       editingOrder ? (currentLanguage === 'tr' ? 'Sipariş bilgilerini güncelleyin' : 'Update order details') :
                       (currentLanguage === 'tr' ? 'Yeni bir satınalma talebi oluşturun' : 'Create a new purchase request')}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setIsAddingOrder(false);
                    setEditingOrder(null);
                    setViewingOrder(null);
                    setNewOrder({ supplier: '', items: [], notes: '', expectedDate: format(new Date(), 'yyyy-MM-dd') });
      setSelectedSupplierId(null);
      mikroAramaSifirla();
                  }}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Supplier & Date */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div
                    className="space-y-2 relative"
                    data-tedarikci-kutusu
                    onBlur={tedarikciKutusuOdakKaybi}
                  >
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider ml-1">{t.supplier}</label>
                    <div className="relative">
                      <input
                        ref={tedarikciGirdisiRef}
                        type="text"
                        placeholder={currentLanguage === 'tr' ? 'Tedarikçi adı girin veya arayın...' : 'Enter or search supplier...'}
                        value={viewingOrder ? viewingOrder.supplier : newOrder.supplier}
                        onChange={e => {
                          setNewOrder(prev => ({ ...prev, supplier: e.target.value }));
                          setSelectedSupplierId(null);
                          mikroAramaSifirla();
                          setSupplierDropdownOpen(true);
                        }}
                        onFocus={() => { tedarikciKapatmayiIptalEt(); setSupplierDropdownOpen(true); }}
                        onKeyDown={e => {
                          // Enter = «Mikro'da ara» (İ2-2), yalnız düğme çizili ve basılabilirken; aksi hâlde tuş olduğu gibi kalır.
                          if (e.key !== 'Enter') return;
                          if (!tedarikciListesiAcik || !mikroAranabilir || mikroSonuclari !== null || mikroAraniyor) return;
                          if (!cariAramaMetniYeterli(newOrder.supplier ?? '')) return;
                          e.preventDefault();
                          void handleMikroAra();
                        }}
                        disabled={!!viewingOrder}
                        className={cn(
                          "apple-input w-full",
                          !!validationError && !(newOrder.supplier ?? '').trim() && "ring-2 ring-red-400"
                        )}
                      />
                      {!viewingOrder && seciliTedarikciId && (
                        <CheckCircle className="w-4 h-4 text-emerald-500 absolute right-3 top-1/2 -translate-y-1/2" />
                      )}
                    </div>

                    {tedarikciListesiAcik && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-gray-100 rounded-2xl shadow-lg p-2 space-y-1 max-h-72 overflow-y-auto">
                        {matchingSuppliers.length > 0 && (
                          <div className="space-y-1 mb-2">
                            <p className="text-[9px] font-bold text-gray-400 uppercase px-2">{currentLanguage === 'tr' ? 'Kayıtlı tedarikçiler' : 'Saved suppliers'}</p>
                            {matchingSuppliers.map(s => (
                              <button
                                key={s.id}
                                onClick={() => handleSelectSupplier(s)}
                                className="w-full text-left px-3 py-2 rounded-xl hover:bg-gray-50 text-sm flex items-center justify-between"
                              >
                                {/* VKN (varsa) aynı adlı kayıtları ayırt ettirir (İ2-1). */}
                                <span>{s.name}{s.taxNo && <span className="text-gray-400 text-xs"> · VKN {s.taxNo}</span>}</span>
                                {s.mikroCariKod && <span className="text-[9px] text-emerald-600 font-bold">Mikro</span>}
                              </button>
                            ))}
                          </div>
                        )}

                        {mikroAranabilir && (
                          <div className="space-y-1 mb-2">
                            {mikroSonuclari === null && (
                              <>
                                <button
                                  // Odak girdide kalsın: aksi hâlde girdinin `onBlur`'u 150 ms sonra listeyi kapatır ve hızlı gelen yanıtı
                                  // (503 / 400 / 429 iletisi, sonuç) siler (inceleme 1).
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={() => void handleMikroAra()}
                                  disabled={mikroAraniyor || !cariAramaMetniYeterli(newOrder.supplier ?? '')}
                                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-blue-50 text-sm text-blue-600 font-medium flex items-center gap-2 disabled:opacity-40"
                                >
                                  <Search className="w-3.5 h-3.5" />
                                  {mikroAraniyor
                                    ? (currentLanguage === 'tr' ? 'Mikro\'da aranıyor…' : 'Searching Mikro…')
                                    : (currentLanguage === 'tr' ? `Mikro'da "${(newOrder.supplier ?? '').trim()}" ara` : `Search Mikro for "${(newOrder.supplier ?? '').trim()}"`)}
                                </button>
                                {!cariAramaMetniYeterli(newOrder.supplier ?? '') && (
                                  <p className="text-xs text-gray-400 px-3">{currentLanguage === 'tr' ? 'En az iki karakter yazın.' : 'Type at least two characters.'}</p>
                                )}
                              </>
                            )}
                            {mikroHataMetni && (
                              <p role="alert" className="text-xs text-red-600 px-3 py-1.5">{mikroHataMetni}</p>
                            )}
                            {mikroSonuclari !== null && mikroSonuclari.length > 0 && (
                              <>
                                <p className="text-[9px] font-bold text-gray-400 uppercase px-2">{currentLanguage === 'tr' ? 'Mikro sonuçları' : 'Mikro results'}</p>
                                {mikroSonuclari.map(c => (
                                  <button
                                    key={c.cari_kod}
                                    onMouseDown={e => e.preventDefault()}   // odak girdide: kayıt hatası iletisi liste kapanınca silinmesin
                                    onClick={() => void handleMikroIceAktar(c)}
                                    disabled={supplierActionLoading}
                                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-emerald-50 text-sm flex items-center justify-between disabled:opacity-40"
                                  >
                                    <span>{c.cari_unvan1} <span className="text-gray-400 text-xs">({c.cari_kod}{c.cari_vdaire_no ? ` · VKN ${c.cari_vdaire_no}` : ''})</span></span>
                                    <span className="text-[9px] text-emerald-600 font-bold">{oc(currentLanguage).ice_aktar}</span>
                                  </button>
                                ))}
                              </>
                            )}
                            {mikroSonuclari !== null && mikroSonuclari.length === 0 && (
                              <p className="text-xs text-gray-400 px-3 py-1.5">{currentLanguage === 'tr' ? 'Mikro\'da bulunamadı.' : 'Not found in Mikro.'}</p>
                            )}
                            {mikroSonuclari !== null && mikroSinirli && (
                              <p className="text-xs text-amber-700 px-3 py-1.5">{currentLanguage === 'tr' ? 'İlk 20 sonuç gösteriliyor, aramayı daraltın.' : 'Showing the first 20 results — narrow your search.'}</p>
                            )}
                          </div>
                        )}

                        {adBelirsiz ? (
                          // Aynı adlı birden çok kayıt (İ2-1): yeni kopya açılmaz, hiçbiri kendiliğinden seçilmez.
                          <p className="text-xs text-amber-700 px-3 py-2 border-t border-gray-50 pt-2.5">
                            {currentLanguage === 'tr'
                              ? 'Bu adla birden çok tedarikçi kayıtlı — VKN\'ye bakarak listeden seçin.'
                              : 'Several suppliers share this name — pick one from the list by tax number.'}
                          </p>
                        ) : (
                          <button
                            onClick={() => void handleCreateLocalSupplier()}
                            disabled={supplierActionLoading}
                            className="w-full text-left px-3 py-2 rounded-xl hover:bg-brand/5 text-sm text-brand font-medium flex items-center gap-2 disabled:opacity-40 border-t border-gray-50 pt-2.5"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            {currentLanguage === 'tr' ? `Yeni tedarikçi oluştur: "${newOrder.supplier}"` : `Create new supplier: "${newOrder.supplier}"`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider ml-1">{currentLanguage === 'tr' ? 'Beklenen Tarih' : 'Expected Date'}</label>
                    <input
                      type="date"
                      value={viewingOrder ? (typeof viewingOrder.expectedDate === 'string' ? viewingOrder.expectedDate : (viewingOrder.expectedDate && typeof viewingOrder.expectedDate === 'object' && 'toDate' in viewingOrder.expectedDate && typeof viewingOrder.expectedDate.toDate === 'function' ? format(viewingOrder.expectedDate.toDate(), 'yyyy-MM-dd') : '')) : newOrder.expectedDate}
                      onChange={e => setNewOrder(prev => ({ ...prev, expectedDate: e.target.value }))}
                      disabled={!!viewingOrder}
                      className="apple-input w-full"
                    />
                  </div>
                </div>

                {/* Item Selection */}
                {!viewingOrder && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider ml-1">{oc(currentLanguage).urunler}</label>
                      <span className="text-[10px] text-gray-400">{newOrder.items.length} {currentLanguage === 'tr' ? 'kalem seçildi' : 'items selected'}</span>
                    </div>

                    {/* Product Search Bar */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input 
                        type="text" 
                        placeholder={currentLanguage === 'tr' ? 'Ürün ara...' : 'Search products...'}
                        value={productSearch}
                        onChange={e => setProductSearch(e.target.value)}
                        className="apple-input w-full pl-10 py-2.5 text-xs"
                      />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-48 overflow-y-auto p-1 overflow-x-hidden">
                      {inventory.filter(p => eslesir(productSearch, p.name, p.sku)).map(product => (
                        <button
                          key={product.id}
                          onClick={() => handleAddOrderItem(product as any)}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-2xl border transition-all text-left",
                            newOrder.items.find(i => i.id === product.id)
                              ? "bg-brand/5 border-brand/20"
                              : "bg-white border-gray-100 hover:border-gray-200"
                          )}
                        >
                          <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-[10px] font-bold text-gray-400 overflow-hidden">
                            {product.image ? <img src={product.image} className="w-full h-full object-cover" /> : product.sku?.substring(0, 2)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-900 truncate">{product.name}</p>
                            <p className="text-[10px] text-gray-500">SKU: {product.sku} • Stok: {product.stockLevel}</p>
                          </div>
                          {newOrder.items.find(i => i.id === product.id) && (
                            <CheckCircle className="w-4 h-4 text-brand" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Selected Items Table */}
                {newOrder.items.length > 0 && (
                  <div className="border border-gray-100 rounded-3xl overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-gray-50/50">
                        <tr>
                          <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{oc(currentLanguage).urun}</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider w-24">{oc(currentLanguage).miktar}</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider w-32">{currentLanguage === 'tr' ? 'Alış Fiyatı' : 'Cost'}</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right w-32">{t.total}</th>
                          <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider w-12"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {newOrder.items.map(item => (
                          <tr key={item.id}>
                            <td className="px-4 py-3">
                              <p className="text-sm font-medium text-gray-900">{item.name}</p>
                              <p className="text-[10px] text-gray-400">{item.sku}</p>
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                value={item.quantity}
                                onChange={e => handleUpdateItem(item.id, 'quantity', Number(e.target.value))}
                                disabled={!!viewingOrder}
                                className="w-full bg-gray-50 border-none rounded-lg px-2 py-1 text-sm font-bold focus:ring-1 focus:ring-brand disabled:opacity-50"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">₺</span>
                                <input
                                  type="number"
                                  value={item.purchasePrice}
                                  onChange={e => handleUpdateItem(item.id, 'purchasePrice', Number(e.target.value))}
                                  disabled={!!viewingOrder}
                                  className="w-full bg-gray-50 border-none rounded-lg pl-5 pr-2 py-1 text-sm font-bold focus:ring-1 focus:ring-brand disabled:opacity-50"
                                />
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm font-bold text-gray-900">{paraYaz(item.purchasePrice * item.quantity)}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {!viewingOrder && (
                                <button onClick={() => handleRemoveItem(item.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50/30">
                        <tr>
                          <td colSpan={3} className="px-4 py-4 text-right text-xs font-bold text-gray-400 uppercase tracking-wider">
                            {oc(currentLanguage).genel_toplam_2}
                          </td>
                          <td className="px-4 py-4 text-right text-lg font-black text-brand">
                            {paraYaz(calculateTotal(newOrder.items))}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Notes */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider ml-1">{oc(currentLanguage).notlar}</label>
                  <textarea
                    placeholder={currentLanguage === 'tr' ? 'Sipariş notları...' : 'Order notes...'}
                    value={viewingOrder ? viewingOrder.notes : newOrder.notes}
                    onChange={e => setNewOrder(prev => ({ ...prev, notes: e.target.value }))}
                    disabled={!!viewingOrder}
                    className="apple-input w-full min-h-[100px] resize-none disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-8 py-6 bg-gray-50/50 border-t border-gray-100 flex items-center justify-end gap-3">
                {viewingOrder && (
                  <>
                    <button
                      onClick={() => exportPurchaseOrderPDF(viewingOrder, currentLanguage)}
                      className="apple-button-secondary flex items-center gap-2"
                    >
                      <FileDown className="w-4 h-4" />
                      {currentLanguage === 'tr' ? 'SAS PDF' : 'PO PDF'}
                    </button>
                    {viewingOrder.status === 'Teslim Alındı' && (
                      <button
                        onClick={() => exportGoodsReceiptPDF(viewingOrder, currentLanguage)}
                        className="apple-button-secondary flex items-center gap-2 text-green-600 border-green-200 bg-green-50 hover:bg-green-100"
                      >
                        <FileDown className="w-4 h-4" />
                        {currentLanguage === 'tr' ? 'Teslim Makbuzu' : 'Receipt Note'}
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={() => {
                    setIsAddingOrder(false);
                    setEditingOrder(null);
                    setViewingOrder(null);
                    setNewOrder({ supplier: '', items: [], notes: '', expectedDate: format(new Date(), 'yyyy-MM-dd') });
      setSelectedSupplierId(null);
      mikroAramaSifirla();
                  }}
                  className="apple-button-secondary"
                >
                  {viewingOrder ? (oc(currentLanguage).kapat) : (oc(currentLanguage).iptal)}
                </button>
                {validationError && (
                  <span className="text-xs text-red-500 font-medium flex-1">{validationError}</span>
                )}
                {!viewingOrder && (() => {
                  const isPrivileged = userRole === 'Admin' || userRole === 'Manager' || userRole === 'Purchasing';
                  return (
                    <>
                      {!isPrivileged && !editingOrder && (
                        <span className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {currentLanguage === 'tr' ? 'Yönetici onayına gönderilecek' : 'Will be sent for manager approval'}
                        </span>
                      )}
                      <button
                        onClick={editingOrder ? handleUpdateOrder : handleSubmitOrder}
                        className="apple-button-primary px-12"
                      >
                        {editingOrder
                          ? (oc(currentLanguage).guncelle)
                          : isPrivileged
                            ? (currentLanguage === 'tr' ? 'Siparişi Oluştur' : 'Create Order')
                            : (oc(currentLanguage).onaya_gonder)}
                      </button>
                    </>
                  );
                })()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
