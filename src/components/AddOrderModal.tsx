import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Search, Scan, Package, Trash2, FileText, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { paraYaz } from '../utils/currency';
const BarcodeScanner = React.lazy(() => import('./BarcodeScanner'));
import CustomerCombobox from './CustomerCombobox';
import type { Lead, InventoryItem, Order, OrderLineItem, Warehouse } from '../types';
// Depo numarası çözümü TEK KAYNAK — ad/id'den Mikro `dep_no`; belirsizse undefined.
import SevkDeposuSecici from './SevkDeposuSecici';
import { musteriBelgeTipi } from '../utils/siparisler/belgeTipi';
import { formSayisi } from '../utils/muhasebe/irsaliyeCalisan';
import { miktarDuzelt, kurusaYuvarla } from '../utils/para';
import { oc } from '../i18n/ortak';
import { eslesir } from '../utils/arama';
import {
  musteriFiyatKademesi, urunSiparisFiyati, kalemSorunu, fiyatGirdisi, fiyatKademesiEtiketi, kopyaKalemi,
  siparisTutarlari, satirTutarlari, gorunenFiyat, kayitFiyati, kayitAlanlari, fiyatBirimiMi, VARSAYILAN_FIYAT_BIRIMI,
  type KalemSorunu, type FiyatBirimi, type SiparisTutarlari,
} from '../utils/siparisler/siparisKalemFiyati';

/** Pencerenin kalemi: fiyat girilene / çözülene kadar `null` (kayıtta sayıya çevrilir — `kalemSorunu` kapısından sonra).
 *  `fiyatBirimi`: `price`'ın ÇAPA birimi (KDV hariç / dâhil — girildiği birim; yoksa KDV hariç). Kayda KDV HARİÇ net birim gider.
 *  `fiyatElle`: kullanıcı fiyatı kendisi yazdı → müşteri (fiyat kademesi) değişince yeniden fiyatlanmaz. */
type Kalem = Omit<OrderLineItem, 'price'> & { price: number | null; fiyatBirimi?: FiyatBirimi; fiyatElle?: boolean };

/** Ürün listesinde bir seferde çizilen satır tavanı — 2.000+ stok kartının hepsini düğme olarak çizmek pencereyi kilitliyordu. */
const URUN_LISTE_TAVANI = 60;

interface AddOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLead: Lead | null;
  setSelectedLead: (lead: Lead | null) => void;
  leads: Lead[];
  inventory: InventoryItem[];
  /** Depo seçicisinin kaynağı — yalnız Mikro `dep_no`su ÇÖZÜLEBİLEN depolar listelenir. */
  warehouses: Warehouse[];
  branchNames: string[];
  currentLanguage: 'tr' | 'en';
  currentT: Record<string, string>;
  /** Güncel kurlar (TCMB) — dövizli stok kartının fiyatı TL'ye bununla çevrilir; kur yoksa fiyat "bilinmiyor" sayılır. */
  kurlar: Record<string, number> | null | undefined;
  /** "Siparişi kopyala" tohumu: pencere açılırken bu sipariş ve kalemlerle dolar (eskiden App'teki kopya durum okunmuyor,
   *  "sipariş kopyalandı" denip pencere BOŞ açılıyordu). */
  tohum?: { order: Partial<Order>; kalemler: OrderLineItem[] } | null;
  /** Kayıt BAŞARISIZSA fırlatır (pencere açık kalır ve nedeni gösterir). */
  /** `lineItems[].price` KDV HARİÇ net birimdir; `tutarlar` siparişin matrah / KDV / toplamı (faturasızda KDV 0). */
  onSubmit: (orderData: Partial<Order>, lineItems: OrderLineItem[], tutarlar: SiparisTutarlari) => Promise<void>;
  onAddLeadClick: () => void;
  onGoToInventory: () => void;
}

export default function AddOrderModal({
  isOpen,
  onClose,
  selectedLead,
  setSelectedLead,
  leads,
  inventory,
  warehouses,
  branchNames,
  currentLanguage,
  currentT,
  kurlar,
  tohum,
  onSubmit,
  onAddLeadClick,
  onGoToInventory
}: AddOrderModalProps) {
  const tr = currentLanguage === 'tr';
  const [newOrder, setNewOrder] = useState<Partial<Order>>({ status: 'Pending', shippingAddress: '', faturali: true, kdvOran: 20 });
  const [orderLineItems, setOrderLineItems] = useState<Kalem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Kaydı engelleyen neden (boş sipariş, fiyatı girilmemiş kalem, müşteri adı yok) ya da kayıt hatası — alt bantta görünür. */
  const [hata, setHata] = useState<string | null>(null);
  /** Kalem fiyat girdisinin HAM metni (kalem id → metin): "12," yazılırken sayıya çevrilip silinmesin. */
  const [fiyatHam, setFiyatHam] = useState<Record<string, string>>({});
  /** Müşterinin fiyat kademesi (yoksa perakende) — ürün fiyatı buna göre çözülür. */
  const kademe = musteriFiyatKademesi(selectedLead);
  const [belgeTipiEksik, setBelgeTipiEksik] = useState(false);
  /** Belge tipi seçicisi kaydırılabilir gövdenin içinde; kapı tetiklenince GÖRÜNÜR olsun diye kaydırılır. */
  const belgeTipiRef = useRef<HTMLDivElement>(null);
  /** Kalem miktarı girdisinin HAM metni (kalem id → metin): "2," / "0." yazılırken sayıya çevrilip silinmesin. */
  const [miktarHam, setMiktarHam] = useState<Record<string, string>>({});
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [isOrderScannerOpen, setIsOrderScannerOpen] = useState(false);

  /** KDV oranının TEK okuması: seçici, hızlı düğmeler, özet ve alt bant aynı değeri gösterir; kayıt (handleAddOrder) da
   *  `kdvOran ?? 20` okur. Eskiden seçici `?? 20`, özet `|| 0` okuyordu — oran boşken biri %20 diğeri %0 gösteriyordu. */
  const kdvOranEtkin = newOrder.kdvOran ?? 20;
  /** Tutar hesabına giren oran: faturasız siparişte KDV YOKTUR (0 — iki fiyat birimi aynı sayıdır). */
  const hesapOrani = newOrder.faturali ? kdvOranEtkin : 0;
  /** Birim fiyatın GİRİŞ birimi (kullanıcı 2026-10-03: «KDV dâhil ya da KDV hariç birim fiyat girişi seçilebilmeli»).
   *  Yalnız giriş ve gösterim birimidir: değiştirmek siparişin tutarını DEĞİŞTİRMEZ — her kalem girildiği birimi çapa olarak
   *  taşır, öteki birimde çevrilmiş değeri gösterilir. Faturasız siparişte seçici gizlidir (KDV yok). */
  const [fiyatModu, setFiyatModu] = useState<FiyatBirimi>(VARSAYILAN_FIYAT_BIRIMI);
  const gosterimBirimi: FiyatBirimi = newOrder.faturali ? fiyatModu : 'kdvHaric';
  /** Siparişin matrah / KDV / toplamı — TEK hesap (utils/siparisler/siparisKalemFiyati.siparisTutarlari). Fiyatı girilmemiş
   *  kalem varken BİLİNMİYOR (null) — eksik kalem 0 sayılıp toplanmaz. */
  const tutarlar = siparisTutarlari(orderLineItems, hesapOrani);
  /** Kalemdeki KDV oranı (yeni üründe kart oranı, kopyada kaynak siparişin oranı) sipariş oranından FARKLI olan kalemler —
   *  uyarıdaki SAYI bunların adedidir. */
  const kartOraniFarkliKalemler = newOrder.faturali
    ? orderLineItems.filter(k => typeof k.vatRate === 'number' && k.vatRate !== kdvOranEtkin)
    : [];
  /** Aynı kalemlerin BENZERSİZ oran etiketleri (ör. ['%10']) — uyarıdaki parantez. */
  const kartOraniFarkli = [...new Set(kartOraniFarkliKalemler.map(k => `%${k.vatRate}`))];
  /** Adres kutusundaki, kullanıcının YAZMADIĞI (müşteri kaydından / kopyalanan siparişten gelen) adres. Müşteri değişince
   *  kutu yalnız boşsa ya da hâlâ bu değeri taşıyorsa yeni müşterinin adresiyle değişir: kullanıcının yazdığı adres ezilmez,
   *  önceki müşterinin adresi de yeni müşterinin siparişinde kalmaz. */
  const otoAdresRef = useRef('');
  /** Pencere kopya tohumuyla açıldı: açılıştaki müşteri doldurması kopyalanan siparişin adresini EZMEZ. */
  const adresKoruRef = useRef(false);


  // Modal kapanınca form durumunu sıfırla — `if (!isOpen) return null` unmount ETMEZ, state aksi halde
  // taşınır ve yeniden açılışta eski sipariş verisi görünür (yanlışlıkla mükerrer sipariş riski).
  useEffect(() => {
    if (!isOpen) {
      setNewOrder({ status: 'Pending', shippingAddress: '', faturali: true, kdvOran: 20 });
      setOrderLineItems([]);
      setProductSearch('');
      setShowProductPicker(false);
      setBelgeTipiEksik(false);   // kapanışta sıfırla: bileşen unmount OLMAZ, kırmızı uyarı sonraki açılışa taşınırdı
      setMiktarHam({});
      setFiyatHam({});
      setHata(null);
      setFiyatModu(VARSAYILAN_FIYAT_BIRIMI);
      otoAdresRef.current = '';
      adresKoruRef.current = false;
    }
  }, [isOpen]);

  // "Siparişi kopyala": pencere açılırken tohumla dol.
  const tohumRef = useRef(tohum);
  tohumRef.current = tohum;
  /** Açılış anındaki seçili müşteri (tohum effect'i `[isOpen]` ile koşar; müşteriyi bağımlılığa almadan okur). */
  const seciliMusteriRef = useRef(selectedLead);
  seciliMusteriRef.current = selectedLead;
  useEffect(() => {
    const t = tohumRef.current;
    if (!isOpen || !t) return;   // kalemsiz siparişin kopyası da müşteri / adres / notu taşır
    // Tohumdaki TANIMSIZ alan varsayılanı ezmez (kopyalanan siparişte `kdvOran` yoksa %20 varsayılanı `undefined` olmasın;
    // Firestore `undefined` alanı da reddeder).
    const dolu = Object.fromEntries(Object.entries(t.order).filter(([, v]) => v !== undefined && v !== null)) as Partial<Order>;
    setNewOrder(prev => ({ ...prev, ...dolu, status: 'Pending' }));
    if (fiyatBirimiMi(dolu.fiyatGirisi)) setFiyatModu(dolu.fiyatGirisi);   // kopya, kaynağın giriş birimiyle açılır
    // Adres koruması yalnız kopyanın adresi DOLUYSA ve açılışta müşteri SEÇİLİYSE kurulur:
    //   • adressiz kopya (Mikro faturasından türeyen sipariş adres taşımaz) → müşterinin kayıtlı adresi dolar;
    //   • müşterisiz açılan kopya → bayrak açılış turunda tüketilemez (müşteri effect'i koşmaz) ve ilk müşteri seçimine
    //     sarkardı; bunun yerine kopyanın adresi "yazılmamış" sayılır: sonradan seçilen müşterinin adresiyle değişir.
    const tohumAdresi = String(dolu.shippingAddress ?? '').trim();
    if (seciliMusteriRef.current) adresKoruRef.current = tohumAdresi !== '';
    else otoAdresRef.current = tohumAdresi;
    // Alanlar beyaz listeyle, birim fiyat ÇAPA birimiyle — bkz. `kopyaKalemi`. Fiyat çözülemiyorsa kalem fiyatsız açılır ve
    // kullanıcı girer. `fiyatElle`: kopyalanan fiyat müşteri kademesiyle yeniden fiyatlanmaz.
    setOrderLineItems(t.kalemler.map(k => ({ ...kopyaKalemi(k), fiyatElle: true })));
  }, [isOpen]);

  // Müşteri (fiyat kademesi) ya da kur değişince, fiyatı ELLE girilmemiş kalemler yeniden fiyatlanır: önce ürün, sonra müşteri
  // seçilirse kalemler perakende fiyatla kalmasın.
  useEffect(() => {
    if (!isOpen) return;
    setOrderLineItems(prev => {
      let degisti = false;
      const yeni = prev.map(k => {
        if (k.fiyatElle || !k.inventoryId) return k;
        const kart = inventory.find(i => i.id === k.inventoryId);
        if (!kart) return k;
        const fiyat = urunSiparisFiyati(kart, kademe, kurlar).fiyat;
        if (fiyat === k.price) return k;
        degisti = true;
        return { ...k, price: fiyat, fiyatBirimi: 'kdvHaric' as const };   // stok kartı fiyatı KDV hariçtir
      });
      return degisti ? yeni : prev;
    });
  }, [isOpen, kademe, kurlar, inventory]);

  // Auto-fill from selectedLead — açılışta (veya seçili lead değişince) müşteri bilgisini doldur
  useEffect(() => {
    if (isOpen && selectedLead) {
      // Belge tipi MÜŞTERİNİN e-Fatura kaydından türer (utils/siparisler/belgeTipi). Eski sezgi — "B2B ya da VKN ≥ 10
      // hane → e-fatura" — kayıtlı olmayan firmaya e-Fatura, kayıtlı olana e-Arşiv kestirebiliyordu. Kayıt BİLİNMİYORSA
      // tip seçilmez (önceki müşteriden kalan seçim de TEMİZLENİR); kullanıcı aşağıdaki seçiciden seçer.
      const tip = musteriBelgeTipi(selectedLead);
      const musteriAdresi = (selectedLead.address ?? '').trim();
      const oncekiOto = otoAdresRef.current;
      const koru = adresKoruRef.current;
      adresKoruRef.current = false;
      setNewOrder(prev => {
        const { faturaTipi: oncekiTip, ...kalan } = prev;
        // 'ihracat' yalnız ELLE seçilir (müşteri kaydından türemez) — müşteri değişince sessizce ezilmez.
        const yeniTip = oncekiTip === 'ihracat' ? 'ihracat' : tip;
        // Teslimat adresi müşterinin ADRESİNDEN (eskiden firma ADI yazılıyordu) — ama yalnız kutu boşsa ya da kullanıcının
        // yazmadığı adresi taşıyorsa (bkz. `otoAdresRef`). "Faturalı / faturasız" seçimine DOKUNULMAZ.
        const mevcut = (prev.shippingAddress ?? '').trim();
        const degistir = !koru && (mevcut === '' || mevcut === oncekiOto);
        return {
          ...kalan,
          customerName: selectedLead.name,
          shippingAddress: degistir ? musteriAdresi : (prev.shippingAddress ?? ''),
          ...(yeniTip ? { faturaTipi: yeniTip } : {}),
        };
      });
      // Kopya açılışında kutudaki adres kopyalanan siparişindir — sonraki müşteri değişiminde o da "yazılmamış" sayılır.
      otoAdresRef.current = koru ? (tohumRef.current?.order.shippingAddress ?? '').trim() : musteriAdresi;
    }
  }, [isOpen, selectedLead]);

  // Handle adding a line item
  const handleAddLineItem = (item: InventoryItem) => {
    // Ürünün KDV oranı BİLİNİYORSA sipariş oranı ona çekilir. Bilinmiyorsa %20 UYDURULMAZ (eski `|| 20`: oran
    // kaleme yazılıp Mikro'ya "bilinen %20" diye gidiyordu, üstelik gerçek %0'ı da 20'ye çeviriyordu — `0 || 20`).
    // O durumda kullanıcının formda seçtiği oran korunur ve kaleme oran YAZILMAZ; sunucu başlık oranına düşer
    // (govdeSiparis: `sayi(k.vatRate) ?? sayi(siparis.kdvOran)`).
    const urunOrani = typeof item.vatRate === 'number' && Number.isFinite(item.vatRate) ? item.vatRate : undefined;
    setNewOrder(prev => ({ ...prev, ...(urunOrani !== undefined ? { kdvOran: urunOrani } : {}) }));
    setHata(null);

    const existingIndex = orderLineItems.findIndex(i => i.inventoryId === item.id);
    if (existingIndex >= 0) {
      // Yeni nesneyle (eski `updated[i].quantity += 1` durum nesnesini YERİNDE değiştiriyordu; StrictMode'da çift artar).
      setOrderLineItems(orderLineItems.map((k, i) => (i === existingIndex ? { ...k, quantity: miktarDuzelt(k.quantity + 1) } : k)));
    } else {
      setOrderLineItems([...orderLineItems, {
        id: crypto.randomUUID(),
        inventoryId: item.id,
        name: item.name,
        title: item.name,
        sku: item.sku,
        // Fiyat: müşterinin kademesi → kartın düz fiyatı → (dövizliyse) kur. Bilinmiyorsa null: kutu BOŞ açılır, 0 yazılmaz
        // (utils/siparisler/siparisKalemFiyati). Eski `price || prices.Retail || 0` kademeye ve para birimine bakmıyordu.
        price: urunSiparisFiyati(item, kademe, kurlar).fiyat,
        fiyatBirimi: 'kdvHaric',   // stok kartı fiyatı KDV HARİÇTİR (teklif formu ve Mikro ile aynı anlam)
        quantity: 1,
        ...(urunOrani !== undefined ? { vatRate: urunOrani } : {}),   // Firestore `undefined` alanı reddeder
      }]);
    }
    setProductSearch('');
    setShowProductPicker(false);
  };

  const handleUpdateLineItemPrice = (idx: number, newPrice: number | null) => {
    setHata(null);
    // Yazılan sayı SEÇİLİ giriş birimine çapalanır (KDV dâhil modda yazılan 300, oran değişse de 300 KDV dâhil kalır).
    // `fiyatModu` — `gosterimBirimi` DEĞİL: faturasızken (seçici gizli, KDV yok) yazılan fiyat da seçili birimi taşır; sipariş
    // sonradan faturalıya çevrilince seçicide görünen birimle okunur (varsayılan KDV hariç → üstüne KDV eklenir).
    setOrderLineItems(orderLineItems.map((k, i) => (i === idx ? { ...k, price: newPrice, fiyatBirimi: fiyatModu, fiyatElle: true } : k)));
  };

  const handleUpdateLineItemQty = (idx: number, newQty: number) => {
    // Tek boğaz: '+/−' düğmeleri `quantity ± 1` yapıyor — kesirli miktarda 1.1 − 1 = 0.10000000000000009 kaleme,
    // oradan siparişe, Mikro gövdesine ve PDF'e akardı (2026-09-19). Artık temizlenir: 0.1.
    const miktar = miktarDuzelt(newQty);
    if (miktar <= 0) {
      setOrderLineItems(orderLineItems.filter((_, i) => i !== idx));
    } else {
      setOrderLineItems(orderLineItems.map((k, i) => (i === idx ? { ...k, quantity: miktar } : k)));
    }
  };

  const sorunMetni = (sorun: KalemSorunu): string => ({
    kalemYok: tr ? 'Siparişe en az bir ürün ekleyin.' : 'Add at least one product to the order.',
    fiyatEksik: tr ? 'Fiyatı girilmemiş kalem var — her kalemin birim fiyatını girin (0 kabul edilmez).' : 'Some items have no price — enter a unit price for every item (0 is not accepted).',
    miktarGecersiz: tr ? 'Miktarı geçersiz kalem var.' : 'Some items have an invalid quantity.',
  })[sorun];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Faturalı siparişte belge tipi ZORUNLU ve varsayılanı YOK (eski kayıt yolu tip yoksa 'e-fatura' yazıyordu).
    if (newOrder.faturali && !newOrder.faturaTipi) {
      setBelgeTipiEksik(true);
      // Seçici kaydırılabilir gövdede, gönder düğmesi sabit alt bantta: kaydırmazsak kullanıcı NEDEN kaydedemediğini görmez.
      belgeTipiRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // Kayıt kapıları (eskiden hiçbiri yoktu: müşterisiz "Unknown Customer", kalemsiz ₺0 ve fiyatı 0 kalemli sipariş
    // kaydedilip faturalıysa yevmiyeye ve Mikro'ya 0 TL'lik satır olarak gidebiliyordu).
    const musteriAdi = (selectedLead?.name ?? newOrder.customerName ?? '').trim();
    if (!musteriAdi) { setHata(tr ? 'Müşteri seçin ya da müşteri adını yazın.' : 'Select a customer or type the customer name.'); return; }
    const sorun = kalemSorunu(orderLineItems);
    if (sorun || tutarlar === null) { setHata(sorunMetni(sorun ?? 'fiyatEksik')); return; }
    setHata(null);
    setIsSubmitting(true);
    try {
      // Kayda giden kalem fiyatı HER ZAMAN KDV HARİÇ net birimdir (Mikro gövdesi, raporlar ve Mikro faturasından türeyen
      // kalemle AYNI anlam); pencereye özel `fiyatElle` kayda girmez.
      // `fiyatGirisi` siparişin "pencereden açıldı: kalem fiyatı net, tutarlar kalemlerden" İŞARETİDİR (düzenleme formu okur);
      // değeri yalnız kopyanın hangi görünümle açılacağını söyler (para kuralı kalemin kendi çapasındadır). Faturasız siparişte
      // KDV yoktur, alan yazılmaz.
      // FATURALIDA kaleme çapa, yazılan KDV dâhil birim ve SATIR tutarları da yazılır (`kayitAlanlari` — düzenleme formu oran
      // değişince AYNI işlevle yeniden yazar; fatura gövdesi satır KDV'sini kalemden alır: kayıt = belge). Kalemin KDV oranı =
      // tutarların hesaplandığı SİPARİŞ oranı: Mikro sipariş gövdesi kalem oranını başlık oranından ÖNCE okur — kalemde ürün
      // kartının oranı kalırsa, oranı seçiciden değiştirilmiş siparişte Cetpa toplamı ile Mikro siparişi ayrışırdı.
      // FATURASIZDA KDV yoktur: yalnız fiyat yazılır, kalemin kart oranına dokunulmaz.
      const kalemler: OrderLineItem[] = orderLineItems.map(k => {
        const { fiyatElle: _elle, fiyatBirimi: _birim, ...yalin } = k;
        return newOrder.faturali
          ? { ...yalin, ...kayitAlanlari(k, hesapOrani), vatRate: hesapOrani }
          : { ...yalin, price: kayitFiyati(k, hesapOrani) };
      });
      const { fiyatGirisi: _eskiGiris, ...siparis } = newOrder;
      await onSubmit({ ...siparis, customerName: musteriAdi, ...(newOrder.faturali ? { fiyatGirisi: fiyatModu } : {}) }, kalemler, tutarlar);
      onClose(); // form, kapanış effect'inde (isOpen=false) sıfırlanır
    } catch (err) {
      // Pencere AÇIK kalır ve nedeni gösterir (eskiden hata yutuluyor, pencere kapanıp form siliniyordu — kullanıcı
      // siparişin kaydedildiğini sanıyordu).
      console.error(err);
      setHata((tr ? 'Sipariş kaydedilemedi: ' : 'The order could not be saved: ') + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => { if (!isSubmitting) onClose(); }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl relative z-10 overflow-hidden border border-gray-200 max-h-[90vh] flex flex-col">

          {/* Header */}
          <div className="p-6 border-b border-gray-100 flex items-center justify-between shrink-0">
            <div>
              <h3 className="text-xl font-bold">{selectedLead ? `${currentT.new_order} — ${selectedLead.name}` : currentT.create_new_order}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{currentT.products_pulled_from_shopify}</p>
            </div>
            <button onClick={() => { if (!isSubmitting) onClose(); }}
              className="text-gray-400 hover:text-gray-600"><Plus className="w-6 h-6 rotate-45" /></button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            <div className="overflow-y-auto flex-1 p-6 space-y-5">

              {/* Resmi / Faturasız toggle */}
              <div className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${newOrder.faturali ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="min-w-0">
                  <p className={`text-xs font-bold ${newOrder.faturali ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {newOrder.faturali
                      ? (currentLanguage === 'tr' ? 'Resmi (Faturalı) İşlem' : 'Official (Invoiced) Sale')
                      : (currentLanguage === 'tr' ? 'Faturasız İşlem' : 'Unofficial Sale')}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${newOrder.faturali ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {newOrder.faturali
                      ? (currentLanguage === 'tr' ? 'KDV hesaplanır, yevmiye kaydı atılır ve Mikro\'ya sipariş kaydı gönderilir.' : 'VAT applied, journal entry created, order pushed to Mikro.')
                      : (currentLanguage === 'tr' ? 'Mikro\'ya kayıt GÖNDERİLMEZ — stok yalnızca yerel sistemde düşülür.' : 'NOT sent to Mikro — stock tracked locally only.')}
                  </p>
                </div>
                {/* TEK anahtar (eskiden aşağıda ikinci bir "Faturalı Satış" anahtarı vardı ve KDV oranını farklı yönetiyordu).
                    Top `left-0.5` ile raya çapalanır: `left` yokken düğmenin ortasından başlayıp kaydırılınca rayın DIŞINA taşıyordu. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!newOrder.faturali}
                  onClick={() => setNewOrder(prev => ({ ...prev, faturali: !prev.faturali }))}
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${newOrder.faturali ? 'bg-emerald-500' : 'bg-gray-300'}`}
                  aria-label={tr ? 'Resmi (faturalı) işlem' : 'Official (invoiced) sale'}
                >
                  <span className={`absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${newOrder.faturali ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Customer */}
              {selectedLead && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.customer_name}</label>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#1D2226] truncate">{selectedLead.name}</p>
                      <p className="text-[10px] text-gray-400 truncate">
                        {tr ? 'Fiyat kademesi' : 'Price tier'}: {fiyatKademesiEtiketi(kademe, tr)}
                      </p>
                    </div>
                    {/* Eskiden müşteri bir kez seçilince değiştirilemiyordu: pencereyi kapatıp kalemleri kaybetmek gerekiyordu. */}
                    <button type="button" onClick={() => {
                      // Bırakılan müşterinin kayıtlı adresi kutuda kalmaz (yeni müşteri elle yazılırsa sipariş eski müşterinin
                      // adresine gitmesin); kullanıcının kendi yazdığı adres korunur.
                      const oto = otoAdresRef.current;
                      otoAdresRef.current = '';
                      setSelectedLead(null);
                      setNewOrder(prev => {
                        const { faturaTipi: _tip, ...kalan } = prev;
                        return { ...kalan, customerName: '', shippingAddress: (prev.shippingAddress ?? '').trim() === oto ? '' : (prev.shippingAddress ?? '') };
                      });
                    }}
                      className="text-xs font-bold text-brand hover:underline shrink-0">
                      {tr ? 'Değiştir' : 'Change'}
                    </button>
                  </div>
                </div>
              )}
              {!selectedLead && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.customer_name}</label>
                  <CustomerCombobox
                    leads={leads}
                    value={newOrder.customerName || ''}
                    onChange={text => setNewOrder({ ...newOrder, customerName: text })}
                    // Ad, adres ve belge tipi TEK yerden dolar: yukarıdaki müşteri effect'i (burada ikinci bir kopyası vardı ve
                    // adres kuralı ondan ayrışıyordu).
                    onSelect={lead => setSelectedLead(lead)}
                    placeholder={currentLanguage === 'tr' ? 'Müşteri ara veya yaz...' : 'Search or type customer...'}
                    maxResults={8}
                    inputClassName="apple-input pl-9 w-full"
                    dropdownMaxHeightClass="max-h-48"
                    renderSecondaryLine={lead => <>{lead.company} • {lead.email}</>}
                    emptyText={currentLanguage === 'tr' ? 'Henüz müşteri yok' : 'No customers yet'}
                    footer={
                      <button type="button"
                        // Sipariş penceresi KAPANMAZ (eskiden kapanıyor, girilen kalemler siliniyor ve pencere yeniden
                        // açılmıyordu): müşteri penceresi üstte açılır (z-110 > z-100); kayıtta App yeni müşteriyi seçer ve
                        // yukarıdaki müşteri effect'i adı / adresi / belge tipini doldurur.
                        onMouseDown={e => { e.preventDefault(); onAddLeadClick(); }}
                        className="w-full text-left px-4 py-2.5 text-xs font-bold text-brand hover:bg-brand/5 flex items-center gap-2">
                        <Plus className="w-3.5 h-3.5" />
                        {currentLanguage === 'tr' ? 'Yeni müşteri adayı ekle' : 'Add new lead'}
                      </button>
                    }
                  />
                </div>
              )}

              {/* Product Picker */}
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
                        <Scan className="w-3.5 h-3.5" /> {oc(currentLanguage).tara}
                      </button>
                      <button type="button" onClick={() => setShowProductPicker(!showProductPicker)}
                        className="text-brand text-xs font-bold flex items-center gap-1 hover:underline">
                        <Plus className="w-3.5 h-3.5" /> {currentT.add_product}
                      </button>
                    </div>
                  </div>
                </div>

                <React.Suspense fallback={null}>
                  <BarcodeScanner
                  isOpen={isOrderScannerOpen}
                  onClose={() => setIsOrderScannerOpen(false)}
                  currentLanguage={currentLanguage}
                  title={oc(currentLanguage).urun_barkodu_tara}
                  onScan={(barcode) => {
                  const match = inventory.find(i => i.sku === barcode || i.sku.toLowerCase() === barcode.toLowerCase() || (i as unknown as { barcode?: string }).barcode === barcode)
                    ?? inventory.find(i => eslesir(barcode, i.name));
                  if (match) handleAddLineItem(match);
                  else setProductSearch(barcode);
                  setShowProductPicker(true);
                  }}
                  />
                </React.Suspense>

                {showProductPicker && (
                  <div className="border border-gray-200 rounded-xl overflow-hidden shadow-lg">
                    <div className="p-3 border-b border-gray-100 bg-gray-50">
                      <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-gray-400 shrink-0" />
                        {/* Enter formu GÖNDERMEZ: arama kutusunda Enter'a basmak yarım siparişi kaydediyordu. */}
                        <input autoFocus type="text" placeholder={currentT.search_products} value={productSearch}
                          onChange={e => setProductSearch(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                          className="flex-1 bg-transparent outline-none text-sm" />
                      </div>
                    </div>
                    <div className="max-h-52 overflow-y-auto">
                      {inventory.length === 0 ? (
                        <div className="p-6 text-center text-sm text-gray-400">
                          <Package className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                          {currentT.no_inventory_synced}{' '}
                          <button type="button" onClick={() => { onClose(); onGoToInventory(); }}
                            className="text-brand font-bold hover:underline">{currentT.go_sync_shopify}</button>
                        </div>
                      ) : (() => {
                        // Türkçe harfe duyarlı arama (`eslesir`: "sprey" → "SPREY", "siyah" → "SİYAH"; eski dil ayarsız
                        // toLowerCase İ/ı'da eşleşmiyordu). Liste tavanlı: 2.000+ kartın hepsi düğme olarak çizilmez.
                        const eslesen = inventory.filter(item => eslesir(productSearch, item.name, item.sku));
                        return (
                          <>
                            {eslesen.slice(0, URUN_LISTE_TAVANI).map(item => {
                              const f = urunSiparisFiyati(item, kademe, kurlar);
                              const stokYok = typeof item.stockLevel === 'number' && item.stockLevel <= 0;
                              const stokDusuk = !stokYok && item.stockLevel <= item.lowStockThreshold;
                              return (
                                <button key={item.id} type="button" onClick={() => handleAddLineItem(item)}
                                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0">
                                  <div className="min-w-0">
                                    <p className="font-bold text-sm text-[#1D2226]">{item.name}</p>
                                    <p className="text-[10px] text-gray-400">{item.sku} • {oc(currentLanguage).stok}: {item.stockLevel}</p>
                                  </div>
                                  <div className="text-right shrink-0 ml-4">
                                    {f.fiyat !== null ? (
                                      <>
                                        {/* Kart fiyatı KDV hariçtir; KDV dâhil girişte ürünün (yoksa siparişin) oranıyla çevrilmiş hâli görünür. */}
                                        <p className="font-bold text-sm text-brand">{paraYaz(gosterimBirimi === 'kdvDahil'
                                          ? kurusaYuvarla(f.fiyat * (1 + (typeof item.vatRate === 'number' && Number.isFinite(item.vatRate) ? item.vatRate : kdvOranEtkin) / 100))
                                          : f.fiyat)}</p>
                                        {newOrder.faturali && (
                                          <p className="text-[9px] text-gray-400 leading-none mt-0.5">{gosterimBirimi === 'kdvDahil' ? (tr ? 'KDV dâhil' : 'incl. VAT') : (tr ? '+ KDV' : '+ VAT')}</p>
                                        )}
                                      </>
                                    ) : (
                                      // Fiyat BİLİNMİYOR: "0,00" basılmaz — kalem fiyat kutusu boş açılır, kullanıcı girer.
                                      <p className="font-bold text-[11px] text-amber-600">
                                        {f.neden === 'kurYok' ? (tr ? 'Kur yok — fiyat çevrilemedi' : 'No rate — price not converted') : (tr ? 'Fiyat yok' : 'No price')}
                                      </p>
                                    )}
                                    {(stokYok || stokDusuk) && (
                                      <span className="text-[9px] font-bold text-red-500">
                                        {stokYok ? (tr ? 'Stokta yok' : 'Out of stock') : (tr ? 'Düşük stok' : 'Low stock')}
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                            {eslesen.length === 0 && (
                              <p className="p-4 text-center text-xs text-gray-400">{tr ? 'Eşleşen ürün yok.' : 'No matching products.'}</p>
                            )}
                            {eslesen.length > URUN_LISTE_TAVANI && (
                              <p className="p-3 text-center text-[11px] text-gray-400">
                                {tr ? `${eslesen.length} üründen ilk ${URUN_LISTE_TAVANI} tanesi gösteriliyor — daraltmak için arayın.` : `Showing the first ${URUN_LISTE_TAVANI} of ${eslesen.length} products — search to narrow down.`}
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* GİRİŞ BİRİMİ (yalnız faturalıda — faturasızda KDV yok). Değiştirmek siparişin tutarını değiştirmez: yalnız
                    fiyat kutularının hangi birimde gösterildiğini ve YENİ yazılan fiyatın nasıl okunacağını belirler. */}
                {newOrder.faturali && (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-gray-700">{tr ? 'Birim fiyat girişi' : 'Unit price entry'}</p>
                      <p className="text-[10px] text-gray-400 leading-tight">
                        {fiyatModu === 'kdvDahil'
                          ? (tr ? 'Yazdığınız fiyatın İÇİNDE KDV var; yazdığınız tutar korunur, KDV içinden ayrılır.' : 'The price you type INCLUDES VAT; the amount you type is kept and VAT is split out of it.')
                          : (tr ? 'Yazdığınız fiyat KDV HARİÇ; KDV üstüne eklenir.' : 'The price you type EXCLUDES VAT; VAT is added on top.')}
                      </p>
                    </div>
                    <div role="radiogroup" aria-label={tr ? 'Birim fiyat girişi' : 'Unit price entry'} className="flex shrink-0 rounded-lg border border-gray-200 bg-white p-0.5">
                      {([['kdvHaric', tr ? 'KDV hariç' : 'Excl. VAT'], ['kdvDahil', tr ? 'KDV dâhil' : 'Incl. VAT']] as const).map(([deger, etiket]) => (
                        <button key={deger} type="button" role="radio" aria-checked={fiyatModu === deger}
                          // Okunabilen ham girdi eski birimde yazılmıştı — birim değişince kutu çevrilmiş değeri göstersin. Okunamayan
                          // metin ("1.250") hiçbir birimde sayı değildir: ipucuyla birlikte KALIR (onBlur ile aynı kural). Birim
                          // değişmediyse hiçbir şey silinmez.
                          onClick={() => {
                            if (deger === fiyatModu) return;
                            setFiyatModu(deger);
                            setFiyatHam(prev => Object.fromEntries(Object.entries(prev).filter(([, ham]) => ham.trim() !== '' && fiyatGirdisi(ham) === null)));
                          }}
                          className={cn('px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors',
                            fiyatModu === deger ? 'bg-brand text-white shadow-sm' : 'text-gray-500 hover:text-brand')}>
                          {etiket}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {orderLineItems.length > 0 ? (
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500">{tr ? 'ÜRÜN' : 'PRODUCT'}</th>
                          <th className="px-4 py-2 text-center text-[10px] font-bold text-gray-500">
                            {tr ? 'BİRİM FİYAT (₺)' : 'UNIT PRICE (₺)'}
                            {newOrder.faturali && <span className="block font-semibold text-gray-400 normal-case">{gosterimBirimi === 'kdvDahil' ? (tr ? 'KDV dâhil' : 'incl. VAT') : (tr ? 'KDV hariç' : 'excl. VAT')}</span>}
                          </th>
                          <th className="px-4 py-2 text-center text-[10px] font-bold text-gray-500">{tr ? 'MİKTAR' : 'QTY'}</th>
                          <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-500">{tr ? 'TUTAR' : 'TOTAL'}</th>
                          <th className="px-2 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {orderLineItems.map((item, idx) => (
                          <tr key={item.id}>
                            <td className="px-4 py-2.5">
                              <p className="font-bold text-[#1D2226]">{item.title}</p>
                              <p className="text-[10px] text-gray-400">{item.sku}</p>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-center gap-1">
                                <span className="text-gray-400 text-xs">₺</span>
                                {/* Fiyat bilinmiyorsa kutu BOŞTUR (eski `parseFloat(...) || 0` boş kutuyu 0'a çeviriyordu). Ham metin ayrı
                                    tutulur ("12," yazılırken silinmesin); geniş kutu: 5 haneli tutar sığsın. */}
                                <input type="text" inputMode="decimal"
                                  aria-label={tr ? 'Birim fiyat' : 'Unit price'}
                                  placeholder={tr ? 'Fiyat girin' : 'Enter price'}
                                  value={fiyatHam[item.id] ?? (() => { const g = gorunenFiyat(item, gosterimBirimi, hesapOrani); return g === null ? '' : String(g).replace('.', ','); })()}
                                  onChange={e => {
                                    const ham = e.target.value;
                                    setFiyatHam(prev => ({ ...prev, [item.id]: ham }));
                                    handleUpdateLineItemPrice(idx, fiyatGirdisi(ham));
                                  }}
                                  // Ham metin yalnız boşsa ya da OKUNABİLDİYSE silinir: okunamayan metin ("1.250") kutudan çıkınca
                                  // (sekme / Kaydet'e tıklama) ipucuyla birlikte kalır — yoksa kullanıcı yazdığının neden yok olduğunu görmezdi.
                                  onBlur={() => setFiyatHam(prev => {
                                    const ham = prev[item.id];
                                    if (ham !== undefined && ham.trim() !== '' && fiyatGirdisi(ham) === null) return prev;
                                    const { [item.id]: _birak, ...kalan } = prev;
                                    return kalan;
                                  })}
                                  onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                                  className={cn('w-24 text-center font-bold text-sm bg-gray-50 border rounded px-1 py-0.5 focus:ring-0',
                                    item.price === null || item.price <= 0 ? 'border-amber-400' : 'border-gray-100')} />
                              </div>
                              {/* Yazılan metin fiyat olarak OKUNAMADI ("1.250" belirsizdir): kutu sessizce sarı kalmaz, nedeni söylenir. */}
                              {(fiyatHam[item.id] ?? '').trim() !== '' && item.price === null && (
                                <p className="text-[10px] text-red-600 text-center mt-0.5">
                                  {tr ? 'Okunamadı — 1250,50 biçiminde yazın' : 'Not readable — type it as 1250,50'}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-center gap-1">
                                <button type="button" onClick={() => handleUpdateLineItemQty(idx, item.quantity - 1)}
                                  className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold text-sm leading-none">−</button>
                                {/* KESİRLİ miktar (2,5 ton / 0,75 m³ — 2026-09-19): eski `parseInt(...) || 0` kesri atıyor, alan boşaltılınca
                                    0 üretip KALEMİ SİLİYORDU. Ham metin ayrı tutulur; yalnız geçerli pozitif sayı kaleme yazılır. */}
                                <input type="number" step="any" min="0" inputMode="decimal"
                                  value={miktarHam[item.id] ?? String(item.quantity)}
                                  onChange={e => {
                                    const ham = e.target.value;
                                    setMiktarHam(prev => ({ ...prev, [item.id]: ham }));
                                    // Kapı YUVARLANMIŞ değere bakar: 0 < n < 0,00005 girdisi 4 ondalıkta 0 olur ve
                                    // `handleUpdateLineItemQty` kalemi SİLERDİ. Yazarken kalem hiç silinmez — silme yalnız '−' düğmesinden.
                                    const sayi = formSayisi(ham);
                                    const duzgun = sayi === null ? 0 : miktarDuzelt(sayi);
                                    if (duzgun > 0) handleUpdateLineItemQty(idx, duzgun);
                                  }}
                                  onBlur={() => setMiktarHam(prev => { const { [item.id]: _birak, ...kalan } = prev; return kalan; })}
                                  onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                                  className="w-14 text-center font-bold text-sm bg-transparent border-none focus:ring-0 p-0" />
                                <button type="button" onClick={() => handleUpdateLineItemQty(idx, item.quantity + 1)}
                                  className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold text-sm leading-none">+</button>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-[#1D2226]">
                              {/* Satır tutarı fiyat sütunuyla AYNI birimde (sütun, alt toplamla toplanır). */}
                              {(() => { const t = satirTutarlari(item, hesapOrani); return t === null ? '—' : paraYaz(kurusaYuvarla(gosterimBirimi === 'kdvDahil' ? t.dahil : t.haric)); })()}
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
                          {/* Alt toplam, TUTAR sütununun toplamıdır (aynı birim). Faturalıda hangi tutar olduğu yazılır; KDV ve genel
                              toplam aşağıdaki «Fatura ve KDV» özetindedir. */}
                          {/* Etiket üç sütunu kaplar: değer TUTAR sütununun altına düşer (eskiden `colSpan={2}` ile MİKTAR'ın altındaydı
                              ve sağda boş bir hücre kalıyordu). */}
                          <td colSpan={3} className="px-4 py-3 text-sm font-bold text-gray-500">
                            {!newOrder.faturali ? currentT.order_total
                              : gosterimBirimi === 'kdvDahil' ? (tr ? 'Toplam (KDV dâhil)' : 'Total (incl. VAT)')
                              : (tr ? 'Ara toplam (KDV hariç)' : 'Subtotal (excl. VAT)')}
                          </td>
                          <td className="px-4 py-3 text-right text-lg font-bold text-brand">
                            {paraYaz(tutarlar === null ? null : gosterimBirimi === 'kdvDahil' ? tutarlar.toplam : tutarlar.matrah)}
                          </td>
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
                {branchNames.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">
                      {oc(currentLanguage).sube}
                    </label>
                    <select
                      value={(newOrder as any).subeAdi || ''}
                      onChange={e => setNewOrder({ ...newOrder, subeAdi: e.target.value } as any)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors"
                    >
                      <option value="">{currentLanguage === 'tr' ? '— Şube seç (opsiyonel) —' : '— Select branch (optional) —'}</option>
                      {branchNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Fatura / KDV Seçimi — yalnız FATURALI siparişte (anahtar yukarıda, tek). */}
              {newOrder.faturali && (
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-3">
                <p className="text-xs font-bold text-gray-700">{tr ? 'Fatura ve KDV' : 'Invoice and VAT'}</p>
                {(
                  <div className="space-y-3">
                    <div ref={belgeTipiRef}>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 block">{oc(currentLanguage).fatura_turu}</label>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { value: 'e-fatura', label: 'e-Fatura', desc: oc(currentLanguage).kayitli_mukellef },
                          { value: 'e-arsiv', label: 'e-Arşiv', desc: currentLanguage==='tr'?'Kayıtsız / bireysel':'Unregistered / individual' },
                          { value: 'ihracat', label: oc(currentLanguage).ihracat, desc: currentLanguage==='tr'?'Yurt dışı satış':'International sale' },
                        ] as const).map(type => (
                          <button key={type.value} type="button"
                            onClick={() => { setBelgeTipiEksik(false); setNewOrder(prev => ({ ...prev, faturaTipi: type.value })); }}
                            className={cn('p-2 rounded-xl border text-left transition-all',
                              newOrder.faturaTipi === type.value ? 'border-brand bg-brand/5' : belgeTipiEksik ? 'border-red-300' : 'border-gray-200 hover:border-gray-300'
                            )}>
                            <p className={`text-[10px] font-bold ${newOrder.faturaTipi === type.value ? 'text-brand' : 'text-gray-700'}`}>{type.label}</p>
                            <p className="text-[9px] text-gray-400 leading-tight mt-0.5">{type.desc}</p>
                          </button>
                        ))}
                      </div>
                      {!newOrder.faturaTipi && (
                        <p className={`text-[10px] mt-1.5 ${belgeTipiEksik ? 'text-red-600 font-bold' : 'text-amber-600'}`}>
                          {selectedLead
                            ? (currentLanguage === 'tr'
                                ? 'Bu müşterinin e-Fatura kaydı bilinmiyor — belge tipini seçin. (Kayıt Mikro cari importuyla gelir; kayıtlı müşteriye e-Fatura, kayıtsıza e-Arşiv kesilir.)'
                                : 'This customer’s e-Invoice registration is unknown — choose the document type. (It comes with the Mikro customer import.)')
                            : (currentLanguage === 'tr' ? 'Belge tipini seçin.' : 'Choose the document type.')}
                        </p>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase">{currentLanguage === 'tr' ? 'KDV Oranı' : 'VAT Rate'}</label>
                        {/* Rozet yalnız oran GERÇEKTEN üründen geldiyse; KDV oranı bilinmeyen kalem varsa kullanıcı uyarılır
                            (eski kod bilinmeyen oranı %20 sayıp "üründen otomatik" diyordu). */}
                        {/* "Üründen otomatik" YALNIZ oran gerçekten bu pencerede üründen geldiyse: kart oranı sipariş oranından farklıysa
                            (elle değiştirildi — aşağıdaki uyarı bunu söyler) ya da pencere kopyayla açıldıysa (kalem oranı kaynak
                            SİPARİŞİN oranıdır, ürün kartının değil) rozet çıkmaz. */}
                        {orderLineItems.length > 0 && (!orderLineItems.every(k => typeof k.vatRate === 'number') ? (
                          <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">
                            {currentLanguage === 'tr' ? 'Ürünün KDV oranı bilinmiyor — elle seçin' : 'Product VAT rate unknown — choose manually'}
                          </span>
                        ) : kartOraniFarkli.length === 0 && !tohum ? (
                          <span className="text-[9px] font-bold text-brand bg-brand/10 px-1.5 py-0.5 rounded-full">
                            ↑ {currentLanguage === 'tr' ? 'üründen otomatik' : 'auto from product'}
                          </span>
                        ) : null)}
                      </div>
                      <select
                        value={kdvOranEtkin}
                        onChange={e => setNewOrder(prev => ({ ...prev, kdvOran: Number(e.target.value) }))}
                        className="apple-input w-full mb-2 text-sm font-bold text-gray-700"
                      >
                        {[0, 1, 8, 10, 18, 20].map(rate => (
                          <option key={rate} value={rate}>
                            {'%' + rate + ' ' + oc(currentLanguage).kdv + (rate === 0 ? (tr ? ' — İstisna/İhracat' : ' — Exempt/Export') : rate === 1 ? (tr ? ' — Temel Gıda' : ' — Basic food') : rate === 8 ? (tr ? ' — İndirimli' : ' — Reduced') : rate === 20 ? (tr ? ' — Genel Oran' : ' — Standard') : '')}
                          </option>
                        ))}
                      </select>
                      {/* Sipariş TEK KDV oranıyla hesaplanır ve kaydedilir. Kartındaki oran farklı olan ürün varsa (farklı oranlı iki
                          ürün, ya da oran elle değiştirildi) kullanıcı kaydetmeden önce görsün — sessizce tek orana çekilmesin. */}
                      {kartOraniFarkli.length > 0 && (
                        <p role="note" className="text-[10px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mb-2 leading-snug">
                          {tr
                            ? `Sipariş tek KDV oranıyla (%${kdvOranEtkin}) hesaplanır. ${tohum ? 'Kalemde kayıtlı oranı' : 'Ürün kartındaki oranı'} farklı ${kartOraniFarkliKalemler.length} kalem var (${kartOraniFarkli.join(', ')}) — ${tohum ? 'kayıtta hepsi seçili orana çekilir; oranı doğrulayın.' : 'farklı oranlı ürünleri ayrı siparişe girin.'}`
                            : `The order is calculated with a single VAT rate (%${kdvOranEtkin}). ${kartOraniFarkliKalemler.length} item(s) have a different ${tohum ? 'recorded rate' : 'rate on the product card'} (${kartOraniFarkli.join(', ')}) — ${tohum ? 'all items are saved with the selected rate; verify it.' : 'enter products with different rates as separate orders.'}`}
                        </p>
                      )}
                      <div className="flex gap-1.5">
                        {[0, 1, 8, 10, 18, 20].map(rate => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => setNewOrder(prev => ({ ...prev, kdvOran: rate }))}
                            className={cn(
                              'flex-1 py-1 rounded-lg text-[10px] font-bold transition-colors',
                              kdvOranEtkin === rate ? 'bg-brand text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-500 hover:border-brand hover:text-brand'
                            )}
                          >
                            %{rate}
                          </button>
                        ))}
                      </div>
                    </div>
                    {orderLineItems.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-200 space-y-0.5 text-xs text-gray-500">
                        {/* Üç satır da TEK hesaptan (`tutarlar`): matrah + KDV = toplam. Kayıt (handleAddOrder), yevmiye fişi ve
                            Mikro'ya giden sipariş aynı değerleri kullanır. Toplam bilinmiyorsa (fiyatı girilmemiş kalem) '—'. */}
                        <div className="flex justify-between">
                          <span>{oc(currentLanguage).matrah_kdv_haric}</span>
                          <span className="font-semibold">{paraYaz(tutarlar === null ? null : tutarlar.matrah)}</span>
                        </div>
                        <div className="flex justify-between text-brand">
                          <span>{oc(currentLanguage).kdv} %{kdvOranEtkin}</span>
                          <span className="font-semibold">{paraYaz(tutarlar === null ? null : tutarlar.kdv)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-gray-800 pt-0.5">
                          <span>{tr ? 'Toplam (KDV dâhil)' : 'Total (incl. VAT)'}</span>
                          <span>{paraYaz(tutarlar === null ? null : tutarlar.toplam)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}

              {/* SEVK DEPOSU — tek kaynak bileşen (SevkDeposuSecici; sipariş düzenleme formu da aynısını kullanır).
                  Kaydedilince Mikro'ya yazılacak siparişte (faturalı + carisi seçili — handleAddOrder koşulu) ZORUNLU:
                  seçilmezse sunucu 400 döner ve sipariş Mikro'ya hiç düşmez (varsayılan depo YOK). */}
              <SevkDeposuSecici
                warehouses={warehouses}
                deger={newOrder.depoNo}
                currentLanguage={currentLanguage}
                zorunlu={!!newOrder.faturali && !!selectedLead}
                onDegis={depoNo => setNewOrder(prev => {
                  // Boş seçim alanı KALDIRIR (undefined ATAMAZ): sipariş dokümanı `{...newOrder}` ile yazılıyor ve
                  // Firestore `undefined` alan değerini reddeder. 0/NaN yazmak ise sahte bir depo numarasıdır.
                  const { depoNo: _secilmemis, ...kalan } = prev;
                  return depoNo === undefined ? kalan : { ...kalan, depoNo };
                })}
              />

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.notes}</label>
                <textarea value={newOrder.notes || ''} onChange={e => setNewOrder({ ...newOrder, notes: e.target.value })} rows={2}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors resize-none" placeholder={currentT.add_notes} />
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-100 shrink-0 space-y-2">
              {newOrder.faturali ? (
                <div className="flex items-center justify-center gap-2 text-[10px] font-bold text-green-600 bg-green-50 rounded-lg py-1.5">
                  <FileText className="w-3 h-3" />
                  {currentLanguage === 'tr' ? `Faturalı • KDV %${kdvOranEtkin}` : `Invoiced • VAT %${kdvOranEtkin}`}
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 text-[10px] font-bold text-gray-400 bg-gray-50 rounded-lg py-1.5">
                  <FileText className="w-3 h-3" />
                  {currentLanguage === 'tr' ? 'Faturasız sevkiyat — KDV yok' : 'Shipped without invoice — no VAT'}
                </div>
              )}
              {/* Faturalı sipariş Mikro'ya yalnız müşteri LİSTEDEN seçildiyse gider (cari kartı gerekir) — yazılan adla kayıtta
                  yevmiye fişi oluşur ama Mikro'ya gönderim sessizce atlanıyordu; kullanıcı kaydetmeden önce bilsin. */}
              {newOrder.faturali && !selectedLead && (
                <p className="text-[11px] text-center text-amber-600">
                  {tr ? 'Müşteri listeden seçilmedi — sipariş Mikro\'ya gönderilmez (yalnız Cetpa\'ya kaydedilir).' : 'No customer selected from the list — the order will not be sent to Mikro (saved in Cetpa only).'}
                </p>
              )}
              {newOrder.faturali && !newOrder.faturaTipi && (
                <p className={`text-[11px] text-center font-bold ${belgeTipiEksik ? 'text-red-600' : 'text-amber-600'}`}>
                  {currentLanguage === 'tr' ? 'Belge tipi seçilmedi — e-Fatura / e-Arşiv seçin.' : 'Document type not selected — choose e-Invoice / e-Archive.'}
                </p>
              )}
              {hata && <p role="alert" className="text-[11px] text-center font-bold text-red-600">{hata}</p>}
              <button type="submit" disabled={isSubmitting}
                className="apple-button-primary w-full">
                {isSubmitting ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> {currentT.saving_and_pushing}</>
                ) : (
                  <>{currentT.create_order} {tutarlar !== null && orderLineItems.length > 0 && `• ${paraYaz(tutarlar.toplam)}`}</>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
